use serde_json::Value;
use tauri::{ipc::Channel, AppHandle, WebviewWindow};

use super::pluma_realtime::require_main;

#[tauri::command]
pub async fn pluma_first_asr_start(
    app: AppHandle,
    window: WebviewWindow,
    events: Channel<Value>,
) -> Result<String, String> {
    require_main(&window)?;
    #[cfg(windows)]
    return windows::start(app, events);
    #[cfg(not(windows))]
    {
        let _ = (app, events);
        Err("El reconocimiento local de Pluma está disponible en Windows.".into())
    }
}

#[tauri::command]
pub async fn pluma_first_asr_send(
    window: WebviewWindow,
    session_id: String,
    pcm_base64: String,
) -> Result<(), String> {
    require_main(&window)?;
    #[cfg(windows)]
    return windows::send(&session_id, &pcm_base64);
    #[cfg(not(windows))]
    {
        let _ = (session_id, pcm_base64);
        Err("El reconocimiento local de Pluma no está disponible.".into())
    }
}

#[tauri::command]
pub async fn pluma_first_asr_finish(
    window: WebviewWindow,
    session_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    #[cfg(windows)]
    return windows::finish(&session_id);
    #[cfg(not(windows))]
    {
        let _ = session_id;
        Err("El reconocimiento local de Pluma no está disponible.".into())
    }
}

#[tauri::command]
pub async fn pluma_first_asr_stop(window: WebviewWindow, session_id: String) -> Result<(), String> {
    require_main(&window)?;
    #[cfg(windows)]
    if let Some(task) = windows::take_task(Some(&session_id)) {
        task.abort();
        let _ = task.await;
    }
    #[cfg(not(windows))]
    let _ = session_id;
    Ok(())
}

pub fn stop_all() {
    #[cfg(windows)]
    if let Some(task) = windows::take_task(None) {
        task.abort();
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use crate::core::system::pluma_realtime::windows::reap_with_app;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde::{Deserialize, Serialize};
    use serde_json::json;
    use std::{path::PathBuf, process::Stdio, sync::Mutex, time::Duration};
    use tauri::Manager;
    use tokio::{
        io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
        process::{ChildStdin, ChildStdout, Command},
        sync::mpsc,
        task::JoinHandle,
        time::timeout,
    };

    const SCRIPT: &str = include_str!("pluma_first_asr.ps1");
    const MAX_PCM_BYTES: usize = 102_400;
    const MAX_WIRE_LINE: usize = 24_000;
    const ASR_FAILED: &str = "El reconocimiento local de Pluma se interrumpió.";
    static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);

    enum Input {
        Audio(Vec<u8>),
        Finish,
    }

    struct Active {
        id: String,
        sender: mpsc::Sender<Input>,
        task: JoinHandle<()>,
        bytes: usize,
        finished: bool,
    }

    #[derive(Deserialize, Serialize)]
    struct Word {
        word: String,
        start: f32,
        end: f32,
        conf: f32,
    }

    #[derive(Deserialize)]
    struct Segment {
        #[serde(default)]
        text: String,
        #[serde(default)]
        result: Vec<Word>,
    }

    pub(super) fn start(app: AppHandle, events: Channel<Value>) -> Result<String, String> {
        let root = app
            .path()
            .resource_dir()
            .map_err(|_| "No se encontraron los recursos de audio.")?
            .join("resources/character-audio");
        if !root.join("libvosk.dll").is_file()
            || !root.join("vosk-model-small-es-0.42/am/final.mdl").is_file()
        {
            return Err("El reconocimiento local en español no está instalado.".into());
        }
        let mut active = ACTIVE.lock().map_err(|_| ASR_FAILED)?;
        if active.is_some() {
            return Err("Ya hay un reconocimiento local de Pluma abierto.".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let task_id = id.clone();
        let (sender, receiver) = mpsc::channel(64);
        let task = tokio::spawn(async move {
            let result = run(root, &events, receiver).await;
            if let Ok(mut current) = ACTIVE.lock() {
                if current
                    .as_ref()
                    .is_some_and(|session| session.id == task_id)
                {
                    current.take();
                }
            }
            if let Err(message) = result {
                let _ = events.send(json!({ "type": "error", "message": message }));
            }
        });
        *active = Some(Active {
            id: id.clone(),
            sender,
            task,
            bytes: 0,
            finished: false,
        });
        Ok(id)
    }

    pub(super) fn send(id: &str, pcm_base64: &str) -> Result<(), String> {
        if pcm_base64.len() > 4 * MAX_PCM_BYTES.div_ceil(3) {
            return Err("El audio breve de Pluma admite hasta 3,2 segundos.".into());
        }
        let pcm = STANDARD
            .decode(pcm_base64)
            .map_err(|_| "El audio de Pluma no es válido.")?;
        if pcm.is_empty() || pcm.len() % 2 != 0 {
            return Err("Se necesita audio PCM mono de 16 kHz y 16 bits.".into());
        }
        submit(id, Input::Audio(pcm))
    }

    pub(super) fn finish(id: &str) -> Result<(), String> {
        submit(id, Input::Finish)
    }

    fn submit(id: &str, input: Input) -> Result<(), String> {
        let mut active = ACTIVE.lock().map_err(|_| ASR_FAILED)?;
        let session = active
            .as_mut()
            .filter(|session| session.id == id && !session.finished)
            .ok_or("El reconocimiento local de Pluma se cerró.")?;
        let (bytes, finished) = match &input {
            Input::Audio(pcm) => (session.bytes + pcm.len(), false),
            Input::Finish => (session.bytes, true),
        };
        if bytes > MAX_PCM_BYTES {
            return Err("El audio breve de Pluma admite hasta 3,2 segundos.".into());
        }
        session.sender.try_send(input).map_err(|_| ASR_FAILED)?;
        session.bytes = bytes;
        session.finished = finished;
        Ok(())
    }

    pub(super) fn take_task(id: Option<&str>) -> Option<JoinHandle<()>> {
        let mut active = ACTIVE.lock().ok()?;
        if active
            .as_ref()
            .is_some_and(|session| id.is_none_or(|id| session.id == id))
        {
            return active.take().map(|session| session.task);
        }
        None
    }

    async fn run(
        root: PathBuf,
        events: &Channel<Value>,
        receiver: mpsc::Receiver<Input>,
    ) -> Result<(), String> {
        let windows = std::env::var_os("SystemRoot").ok_or("No se encontró Windows PowerShell.")?;
        let program = PathBuf::from(windows).join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let script = STANDARD.encode(
            SCRIPT
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>(),
        );
        let mut child = Command::new(program)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                &script,
            ])
            .env("REY30_PLUMA_ASR_RESOURCE_DIR", root)
            .creation_flags(0x08000000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| "No se pudo iniciar el reconocimiento local de Pluma.")?;
        let _job = reap_with_app(&child);
        let stdin = child.stdin.take().ok_or(ASR_FAILED)?;
        let mut stdout = BufReader::new(child.stdout.take().ok_or(ASR_FAILED)?);
        let ready = timeout(Duration::from_secs(12), read_line(&mut stdout))
            .await
            .map_err(|_| "El reconocimiento local de Pluma no quedó listo a tiempo.")??;
        if ready != b"ready" {
            return Err(ASR_FAILED.into());
        }
        events
            .send(json!({ "type": "ready" }))
            .map_err(|_| ASR_FAILED)?;
        let ((), (text, words)) = timeout(Duration::from_secs(120), async {
            tokio::try_join!(write_audio(stdin, receiver), read_result(&mut stdout))
        })
        .await
        .map_err(|_| "El reconocimiento local de Pluma superó el tiempo de espera.")??;
        events
            .send(json!({ "type": "result", "text": text, "words": words }))
            .map_err(|_| ASR_FAILED)?;
        let _ = timeout(Duration::from_secs(2), child.wait()).await;
        Ok(())
    }

    async fn write_audio(
        mut stdin: ChildStdin,
        mut receiver: mpsc::Receiver<Input>,
    ) -> Result<(), String> {
        while let Some(input) = receiver.recv().await {
            match input {
                Input::Audio(pcm) => {
                    stdin
                        .write_u32_le(pcm.len() as u32)
                        .await
                        .map_err(|_| ASR_FAILED)?;
                    stdin.write_all(&pcm).await.map_err(|_| ASR_FAILED)?;
                }
                Input::Finish => {
                    stdin.write_u32_le(0).await.map_err(|_| ASR_FAILED)?;
                    return Ok(());
                }
            }
        }
        Err(ASR_FAILED.into())
    }

    async fn read_line(stdout: &mut BufReader<ChildStdout>) -> Result<Vec<u8>, String> {
        let mut line = Vec::new();
        stdout
            .take((MAX_WIRE_LINE + 1) as u64)
            .read_until(b'\n', &mut line)
            .await
            .map_err(|_| ASR_FAILED)?;
        if line.len() > MAX_WIRE_LINE || line.last() != Some(&b'\n') {
            return Err(ASR_FAILED.into());
        }
        while matches!(line.last(), Some(b'\r' | b'\n')) {
            line.pop();
        }
        Ok(line)
    }

    async fn read_result(
        stdout: &mut BufReader<ChildStdout>,
    ) -> Result<(String, Vec<Word>), String> {
        let mut text = String::new();
        let mut words = Vec::new();
        for _ in 0..32 {
            let line = read_line(stdout).await?;
            if line == b"done" {
                return Ok((text, words));
            }
            let payload = STANDARD.decode(line).map_err(|_| ASR_FAILED)?;
            let segment: Segment = serde_json::from_slice(&payload).map_err(|_| ASR_FAILED)?;
            if text.len() + segment.text.len() > 4096 || words.len() + segment.result.len() > 128 {
                return Err(ASR_FAILED.into());
            }
            if !segment.text.is_empty() {
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(&segment.text);
            }
            words.extend(segment.result);
        }
        Err(ASR_FAILED.into())
    }
}
