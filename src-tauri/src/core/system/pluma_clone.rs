use super::pluma_realtime::require_main;
use serde::Serialize;
use serde_json::Value;
use std::future::Future;
use tauri::{ipc::Channel, AppHandle, WebviewWindow};

#[derive(Serialize)]
pub struct ReferenceStatus {
    ready: bool,
    format: Option<&'static str>,
    bytes: Option<usize>,
}

#[tauri::command]
pub async fn pluma_clone_reference_status(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<ReferenceStatus, String> {
    require_main(&window)?;
    platform::reference_status(app)
}

#[tauri::command]
pub async fn pluma_clone_reference_choose(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<ReferenceStatus, String> {
    require_main(&window)?;
    platform::choose_reference(app).await
}

#[tauri::command]
pub async fn pluma_clone_reference_clear(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<ReferenceStatus, String> {
    require_main(&window)?;
    platform::clear_reference(app)
}

#[tauri::command]
pub async fn pluma_clone_start(
    app: AppHandle,
    window: WebviewWindow,
    events: Channel<Value>,
) -> Result<String, String> {
    require_main(&window)?;
    platform::start(app, events)
}

#[tauri::command]
pub async fn pluma_clone_stop(window: WebviewWindow, session_id: String) -> Result<(), String> {
    require_main(&window)?;
    platform::stop(Some(&session_id)).await;
    Ok(())
}

#[tauri::command]
pub async fn pluma_clone_cancel_turn(
    window: WebviewWindow,
    session_id: String,
    turn_id: u32,
) -> Result<(), String> {
    require_main(&window)?;
    platform::cancel_turn(&session_id, turn_id)
}

#[tauri::command]
pub async fn pluma_clone_chat(
    window: WebviewWindow,
    session_id: String,
    turn_id: Option<u32>,
    messages: Vec<Value>,
    tools: Option<Vec<Value>>,
) -> Result<Value, String> {
    require_main(&window)?;
    platform::with_turn(
        &session_id,
        turn_id,
        platform::chat(&session_id, messages, tools.unwrap_or_default()),
    )
    .await
}

#[tauri::command]
pub async fn pluma_clone_chat_stream(
    window: WebviewWindow,
    session_id: String,
    turn_id: Option<u32>,
    messages: Vec<Value>,
    tools: Option<Vec<Value>>,
    events: Channel<Value>,
) -> Result<Value, String> {
    require_main(&window)?;
    platform::with_turn(
        &session_id,
        turn_id,
        platform::chat_stream(&session_id, messages, tools.unwrap_or_default(), events),
    )
    .await
}

#[tauri::command]
pub async fn pluma_clone_speak(
    window: WebviewWindow,
    session_id: String,
    turn_id: Option<u32>,
    text: String,
    events: Channel<Value>,
) -> Result<(), String> {
    require_main(&window)?;
    platform::with_turn(
        &session_id,
        turn_id,
        platform::speak(&session_id, &text, events),
    )
    .await
}

#[tauri::command]
pub async fn pluma_clone_sing(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
    turn_id: u32,
    lyrics: String,
    style: String,
    seconds: Option<u32>,
    events: Channel<Value>,
) -> Result<(), String> {
    require_main(&window)?;
    #[cfg(windows)]
    {
        platform::reserve_song(&session_id, turn_id)?;
        return platform::with_turn(
            &session_id,
            Some(turn_id),
            super::pluma_music::sing(&app, &lyrics, &style, seconds, events),
        )
        .await;
    }
    #[cfg(not(windows))]
    {
        let _ = (app, session_id, turn_id, lyrics, style, seconds, events);
        Err("Las canciones de Pluma están disponibles en Windows.".into())
    }
}

pub fn stop_all() {
    platform::close_all();
    super::pluma_first_asr::stop_all();
}

pub(crate) fn library_session_active(session_id: &str) -> bool {
    #[cfg(windows)]
    return platform::library_session_active(session_id);
    #[cfg(not(windows))]
    {
        let _ = session_id;
        false
    }
}

/// The cloned-voice sample and its format (`wav` or `mp3`), so songs can be
/// sung with the same timbre as Pluma's cloned speaking voice.
#[cfg(windows)]
pub(crate) fn voice_reference(app: &AppHandle) -> Option<(Vec<u8>, &'static str)> {
    let audio = platform::read_reference(&platform::reference_path(app.clone())).ok()?;
    let format = platform::reference_format(&audio)?;
    Some((audio, format))
}

/// The sample Pluma sings with: `pluma-voice/reference-canto.wav` (a clean
/// recording of her singing) when present, otherwise her speaking sample.
#[cfg(windows)]
pub(crate) fn song_voice_reference(app: &AppHandle) -> Option<(Vec<u8>, &'static str)> {
    let singing = crate::core::app::commands::get_rey30_data_folder_path(app.clone())
        .join("pluma-voice/reference-canto.wav");
    platform::read_reference(&singing)
        .ok()
        .and_then(|audio| platform::reference_format(&audio).map(|format| (audio, format)))
        .or_else(|| voice_reference(app))
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    const UNAVAILABLE: &str = "La voz clonada de Pluma está disponible en Windows con Vulkan.";

    pub fn reference_status(_: AppHandle) -> Result<ReferenceStatus, String> {
        Err(UNAVAILABLE.into())
    }
    pub async fn choose_reference(_: AppHandle) -> Result<ReferenceStatus, String> {
        Err(UNAVAILABLE.into())
    }
    pub fn clear_reference(_: AppHandle) -> Result<ReferenceStatus, String> {
        Err(UNAVAILABLE.into())
    }
    pub fn start(_: AppHandle, _: Channel<Value>) -> Result<String, String> {
        Err(UNAVAILABLE.into())
    }
    pub async fn stop(_: Option<&str>) {}
    pub fn close_all() {}
    pub fn cancel_turn(_: &str, _: u32) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
    pub async fn with_turn<T>(
        _: &str,
        _: Option<u32>,
        _: impl Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        Err(UNAVAILABLE.into())
    }
    pub async fn chat(_: &str, _: Vec<Value>, _: Vec<Value>) -> Result<Value, String> {
        Err(UNAVAILABLE.into())
    }
    pub async fn chat_stream(
        _: &str,
        _: Vec<Value>,
        _: Vec<Value>,
        _: Channel<Value>,
    ) -> Result<Value, String> {
        Err(UNAVAILABLE.into())
    }
    pub async fn speak(_: &str, _: &str, _: Channel<Value>) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use crate::core::system::pluma_realtime::windows::{
        amd_device, engine_command, engine_path, reap_with_app, wait_for_engine,
    };
    use base64::{engine::general_purpose::STANDARD, Engine};
    use reqwest::{Client, Response};
    use serde_json::json;
    use std::{
        fs::{self, File},
        io::{self, Read},
        net::{Ipv4Addr, TcpListener},
        os::windows::io::OwnedHandle,
        path::{Path, PathBuf},
        process::Stdio,
        sync::{Arc, Mutex, OnceLock},
        time::{Duration, Instant},
    };
    use tokio::{process::Child, task::JoinHandle};
    use tokio_util::sync::CancellationToken;
    use uuid::Uuid;

    const REFERENCE_LIMIT: usize = 10 * 1024 * 1024;
    // Keep base64 PCM frames below Tauri's 8 KiB direct IPC threshold.
    const PCM_FRAME_BYTES: usize = 6_000;
    const GEMMA_MODEL: &str = "gemma-4-12b-it-qat-q4_0.gguf";
    const GEMMA_PROJECTOR: &str = "mmproj-gemma-4-12b-it-qat-q4_0.gguf";
    const TTS_MODEL: &str = "Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf";
    const TTS_PROJECTOR: &str = "mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf";
    static ACTIVE: Mutex<Option<Call>> = Mutex::new(None);

    struct Call {
        id: String,
        events: Channel<Value>,
        ready: Arc<OnceLock<Engines>>,
        task: JoinHandle<()>,
        cancel: CancellationToken,
        turn: Option<(u32, CancellationToken)>,
        last_song_turn: Option<u32>,
    }

    impl Call {
        fn turn_token(&mut self, turn_id: u32) -> Result<CancellationToken, &'static str> {
            if turn_id == 0 {
                return Err("Identificador de turno de voz no válido.");
            }
            if let Some((current_id, token)) = &self.turn {
                if turn_id < *current_id {
                    return Err("El turno de Pluma ya terminó.");
                }
                if turn_id == *current_id {
                    return Ok(token.clone());
                }
                token.cancel();
            }
            let token = self.cancel.child_token();
            self.turn = Some((turn_id, token.clone()));
            Ok(token)
        }
    }

    struct Engines {
        client: Client,
        gemma: Endpoint,
        tts: Endpoint,
        reference: String,
    }

    struct Endpoint {
        port: u16,
        key: String,
    }

    impl Endpoint {
        async fn post(
            &self,
            client: &Client,
            route: &str,
            body: Value,
        ) -> Result<Response, String> {
            client
                .post(format!("http://127.0.0.1:{}{route}", self.port))
                .bearer_auth(&self.key)
                .json(&body)
                .send()
                .await
                .map_err(|_| "Se perdió la conexión local con el motor de Pluma.".to_string())?
                .error_for_status()
                .map_err(|error| format!("El motor local de Pluma rechazó la petición. {error}"))
        }
    }

    fn warmup_audio() -> String {
        const RATE: u32 = 16_000;
        const BYTES: u32 = RATE * 2 * 2 / 5;
        let mut wav = Vec::with_capacity(44 + BYTES as usize);
        wav.extend(b"RIFF");
        wav.extend((36 + BYTES).to_le_bytes());
        wav.extend(b"WAVEfmt ");
        wav.extend(16u32.to_le_bytes());
        wav.extend([1, 0, 1, 0]);
        wav.extend(RATE.to_le_bytes());
        wav.extend((RATE * 2).to_le_bytes());
        wav.extend([2, 0, 16, 0]);
        wav.extend(b"data");
        wav.extend(BYTES.to_le_bytes());
        wav.resize(44 + BYTES as usize, 0);
        STANDARD.encode(wav)
    }

    fn speech_body(text: &str, reference: &str) -> Value {
        json!({
            "input": text, "lang": "es", "speaker_ref_b64": reference,
            "response_format": "pcm", "stream": true
        })
    }

    async fn prime_engines(local: &Engines) {
        let started = Instant::now();
        let gemma = async {
            local.gemma.post(&local.client, "/v1/chat/completions", json!({
                "model": "pluma-gemma", "max_tokens": 1, "reasoning_effort": "none",
                "messages": [{"role": "user", "content": [
                    {"type": "text", "text": "Prueba local del micrófono. Responde sí."},
                    {"type": "input_audio", "input_audio": {"data": warmup_audio(), "format": "wav"}}
                ]}]
            })).await?.bytes().await.map_err(|_| "La preparación de Gemma se interrumpió.")?;
            Ok::<_, String>(started.elapsed().as_millis())
        };
        let tts = async {
            let mut body = speech_body("Hola.", &local.reference);
            body["n_predict"] = json!(32);
            body["seed"] = json!(42);
            let mut response = local.tts.post(&local.client, "/tts", body).await?;
            let mut received = 0;
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "La preparación de Qwen se interrumpió.")?
            {
                received += chunk.len();
                if received > 2 * 1024 * 1024 {
                    return Err("La preparación de Qwen devolvió demasiado audio.".into());
                }
            }
            if received == 0 {
                return Err("La preparación de Qwen terminó sin audio.".into());
            }
            Ok::<_, String>(started.elapsed().as_millis())
        };
        let timeout = Duration::from_secs(25);
        let (gemma, tts) = tokio::join!(
            tokio::time::timeout(timeout, gemma),
            tokio::time::timeout(timeout, tts)
        );
        match gemma {
            Ok(Ok(ms)) => log::info!("Pluma preparó la entrada de voz de Gemma en {ms} ms."),
            _ => log::warn!(
                "Pluma no pudo preparar la entrada de voz de Gemma antes del primer turno."
            ),
        }
        match tts {
            Ok(Ok(ms)) => log::info!("Pluma preparó la síntesis de voz de Qwen en {ms} ms."),
            Ok(Err(error)) => log::warn!("Pluma no pudo preparar Qwen: {error}"),
            Err(_) => log::warn!("Pluma agotó el tiempo de preparación de Qwen."),
        }
    }

    pub(super) fn reference_path(app: AppHandle) -> PathBuf {
        crate::core::app::commands::get_rey30_data_folder_path(app)
            .join("pluma-voice/reference.audio")
    }

    pub(super) fn reference_format(audio: &[u8]) -> Option<&'static str> {
        if audio.len() < 44 || audio.len() > REFERENCE_LIMIT {
            return None;
        }
        if audio.starts_with(b"RIFF") && audio.get(8..12) == Some(b"WAVE") {
            Some("wav")
        } else if audio.starts_with(b"ID3") || (audio[0] == 0xff && audio[1] & 0xe0 == 0xe0) {
            Some("mp3")
        } else {
            None
        }
    }

    pub(super) fn read_reference(path: &Path) -> io::Result<Vec<u8>> {
        let mut bytes = Vec::new();
        File::open(path)?
            .take((REFERENCE_LIMIT + 1) as u64)
            .read_to_end(&mut bytes)?;
        Ok(bytes)
    }

    fn status_for(path: &Path) -> ReferenceStatus {
        let audio = read_reference(path).ok();
        let format = audio.as_deref().and_then(reference_format);
        ReferenceStatus {
            ready: format.is_some(),
            format,
            bytes: audio.map(|bytes| bytes.len()).filter(|_| format.is_some()),
        }
    }

    fn ensure_idle() -> Result<(), String> {
        if ACTIVE
            .lock()
            .map_err(|_| "La llamada de Pluma no está disponible.")?
            .is_some()
        {
            Err("Pausa la llamada para cambiar el audio de referencia.".into())
        } else {
            Ok(())
        }
    }

    pub fn reference_status(app: AppHandle) -> Result<ReferenceStatus, String> {
        Ok(status_for(&reference_path(app)))
    }

    pub async fn choose_reference(app: AppHandle) -> Result<ReferenceStatus, String> {
        ensure_idle()?;
        tokio::task::spawn_blocking(move || {
            let path = reference_path(app.clone());
            let Some(source) = rfd::FileDialog::new()
                .set_title("Seleccionar audio de referencia para Pluma")
                .add_filter("Audio WAV o MP3", &["wav", "mp3"])
                .pick_file()
            else {
                return Ok(status_for(&path));
            };
            let audio = read_reference(&source).map_err(|_| "No se pudo leer el audio elegido.")?;
            let format = reference_format(&audio)
                .ok_or("Elige una grabación WAV o MP3 válida de hasta 10 MB.")?;
            ensure_idle()?;
            let parent = path
                .parent()
                .ok_or("No se encontró la carpeta de voz de Pluma.")?;
            fs::create_dir_all(parent)
                .map_err(|_| "No se pudo crear la carpeta de voz de Pluma.")?;
            let temporary = parent.join(format!("{}.partial", Uuid::new_v4()));
            fs::write(&temporary, &audio)
                .map_err(|_| "No se pudo guardar el audio de referencia.")?;
            if fs::rename(&temporary, &path).is_err() {
                let _ = fs::remove_file(temporary);
                return Err("No se pudo sustituir el audio de referencia.".into());
            }
            Ok(ReferenceStatus {
                ready: true,
                format: Some(format),
                bytes: Some(audio.len()),
            })
        })
        .await
        .map_err(|_| "Se interrumpió el selector de audio.".to_string())?
    }

    pub fn clear_reference(app: AppHandle) -> Result<ReferenceStatus, String> {
        ensure_idle()?;
        match fs::remove_file(reference_path(app)) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err("No se pudo quitar el audio de referencia.".into()),
        }
        Ok(ReferenceStatus {
            ready: false,
            format: None,
            bytes: None,
        })
    }

    pub fn start(app: AppHandle, events: Channel<Value>) -> Result<String, String> {
        let mut active = ACTIVE
            .lock()
            .map_err(|_| "No se pudo iniciar la voz clonada.")?;
        if active.is_some() {
            return Err("Ya hay una llamada de voz clonada.".into());
        }
        let id = Uuid::new_v4().to_string();
        let task_id = id.clone();
        let ready = Arc::new(OnceLock::new());
        let task_ready = ready.clone();
        let task_events = events.clone();
        let task = tokio::spawn(async move {
            let result = run(app, task_ready, &task_events).await;
            if let Ok(mut active) = ACTIVE.lock() {
                if active.as_ref().is_some_and(|call| call.id == task_id) {
                    if let Some(call) = active.take() {
                        call.cancel.cancel();
                    }
                }
            }
            if let Err(message) = result {
                log::warn!("Voz clonada de Pluma: {message}");
                let _ = task_events.send(json!({"type": "clone.error", "message": message}));
            }
        });
        *active = Some(Call {
            id: id.clone(),
            events,
            ready,
            task,
            cancel: CancellationToken::new(),
            turn: None,
            last_song_turn: None,
        });
        Ok(id)
    }

    fn take_call(id: Option<&str>) -> Option<Call> {
        let mut active = ACTIVE.lock().ok()?;
        if active
            .as_ref()
            .is_some_and(|call| id.is_none_or(|id| call.id == id))
        {
            active.take()
        } else {
            None
        }
    }

    pub async fn stop(id: Option<&str>) {
        if let Some(call) = take_call(id) {
            call.cancel.cancel();
            call.task.abort();
            let _ = call.task.await;
        }
    }

    pub fn close_all() {
        if let Some(call) = take_call(None) {
            call.cancel.cancel();
            call.task.abort();
            let _ = call.events.send(json!({
                "type": "clone.error",
                "message": "La llamada de Pluma se cerró al cerrar la ventana."
            }));
        }
    }

    pub fn cancel_turn(id: &str, turn_id: u32) -> Result<(), String> {
        let mut active = ACTIVE
            .lock()
            .map_err(|_| "No se pudo interrumpir el turno.")?;
        if let Some(call) = active.as_mut().filter(|call| call.id == id) {
            if call
                .turn
                .as_ref()
                .is_none_or(|(current, _)| turn_id >= *current)
            {
                call.turn_token(turn_id)?.cancel();
            }
        }
        Ok(())
    }

    pub fn reserve_song(id: &str, turn_id: u32) -> Result<(), String> {
        let mut active = ACTIVE
            .lock()
            .map_err(|_| "La llamada no está disponible.")?;
        let call = active
            .as_mut()
            .filter(|call| call.id == id && call.ready.get().is_some())
            .ok_or("La voz clonada de Pluma todavía no está disponible.")?;
        if call.turn_token(turn_id)?.is_cancelled() {
            return Err("Se interrumpió el turno de Pluma.".into());
        }
        if call.last_song_turn == Some(turn_id) {
            return Err("Pluma solo genera una canción por intervención.".into());
        }
        call.last_song_turn = Some(turn_id);
        Ok(())
    }

    pub async fn with_turn<T>(
        id: &str,
        turn_id: Option<u32>,
        request: impl Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        let token = {
            let mut active = ACTIVE
                .lock()
                .map_err(|_| "La llamada no está disponible.")?;
            let call = active
                .as_mut()
                .filter(|call| call.id == id && call.ready.get().is_some())
                .ok_or("La voz clonada de Pluma todavía no está disponible.")?;
            match turn_id {
                Some(turn_id) => call.turn_token(turn_id)?,
                None => call.cancel.clone(),
            }
        };
        tokio::select! {
            biased;
            _ = token.cancelled() => Err("Se interrumpió el turno de Pluma.".into()),
            result = request => result,
        }
    }

    /// Folder holding `model` and `projector`: the `env` override when set,
    /// otherwise `<models root>\Pluma\<folder>`.
    fn models(
        env: &str,
        folder: &str,
        model: &str,
        projector: &str,
    ) -> Result<PathBuf, String> {
        [
            std::env::var_os(env)
                .map(PathBuf::from)
                .filter(|path| path.is_absolute()),
            Some(super::super::models_root::models_root().join("Pluma").join(folder)),
        ]
        .into_iter()
        .flatten()
        .find(|path| path.join(model).is_file() && path.join(projector).is_file())
        .ok_or_else(|| {
            format!(
                "Faltan {model} y su proyector en {}.",
                super::super::models_root::models_root()
                    .join("Pluma")
                    .join(folder)
                    .display()
            )
        })
    }

    fn spawn_engine(
        engine: &Path,
        device: &str,
        dir: &Path,
        model: &str,
        projector: &str,
        alias: &str,
        options: &[&str],
    ) -> Result<(Child, OwnedHandle, Endpoint), String> {
        let port = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .and_then(|listener| listener.local_addr())
            .map_err(|_| "No se pudo reservar el puerto local de Pluma.")?
            .port();
        let key = Uuid::new_v4().simple().to_string();
        let mut command = engine_command(engine);
        if dir.to_string_lossy().starts_with(r"\\") {
            command.args(["--load-mode", "none", "--lazy-mode", "off"]);
        }
        let child = command
            .args([
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
                "--no-webui",
            ])
            .args([
                "--device",
                device,
                "--mmproj-device",
                device,
                "--n-gpu-layers",
                "all",
            ])
            .args(["--parallel", "1", "--alias", alias, "--jinja"])
            .args(options)
            .arg("--model")
            .arg(dir.join(model))
            .arg("--mmproj")
            .arg(dir.join(projector))
            .env("LLAMA_API_KEY", &key)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("No se pudo iniciar {alias}. {error}"))?;
        let job = reap_with_app(&child).ok_or("Windows no pudo aislar el motor de Pluma.")?;
        Ok((child, job, Endpoint { port, key }))
    }

    async fn run(
        app: AppHandle,
        ready: Arc<OnceLock<Engines>>,
        events: &Channel<Value>,
    ) -> Result<(), String> {
        let engine = engine_path(&app)?;
        let tts_engine = engine
            .parent()
            .and_then(Path::parent)
            .map(|resources| resources.join("pluma-llama-tts/llama-server.exe"))
            .filter(|path| path.is_file());
        let can_sing = super::super::pluma_music::available(&app);
        let reference = read_reference(&reference_path(app))
            .map_err(|_| "Agrega un WAV o MP3 como audio de referencia de Pluma.")?;
        if reference_format(&reference).is_none() {
            return Err("El audio de referencia de Pluma no es un WAV o MP3 válido.".into());
        }
        let gemma = models(
            "REY30_PLUMA_GEMMA_DIR",
            "Gemma-4-12B-it-GGUF",
            GEMMA_MODEL,
            GEMMA_PROJECTOR,
        )?;
        let tts = models(
            "REY30_PLUMA_TTS_DIR",
            "Qwen3-TTS-12Hz-1.7B-Base-GGUF",
            TTS_MODEL,
            TTS_PROJECTOR,
        )?;
        let device = amd_device(&engine).await?;
        log::info!("Pluma usa AMD Radeon AI PRO R9700 en {device} para Gemma 4 y Qwen3-TTS.");
        let (mut gemma_child, _gemma_job, gemma) = spawn_engine(
            &engine,
            &device,
            &gemma,
            GEMMA_MODEL,
            GEMMA_PROJECTOR,
            "pluma-gemma",
            &[
                "--ctx-size",
                "8192",
                "--reasoning",
                "auto",
                "--reasoning-format",
                "deepseek",
            ],
        )?;
        let (mut tts_child, _tts_job, tts) = spawn_engine(
            tts_engine.as_deref().unwrap_or(&engine),
            &device,
            &tts,
            TTS_MODEL,
            TTS_PROJECTOR,
            "pluma-tts",
            &["--ctx-size", "4096"],
        )?;
        tokio::try_join!(
            wait_for_engine(&mut gemma_child, gemma.port, Duration::from_secs(195)),
            wait_for_engine(&mut tts_child, tts.port, Duration::from_secs(195))
        )?;
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|_| "No se pudo conectar con los motores locales de Pluma.")?;
        let local = Engines {
            client,
            gemma,
            tts,
            reference: STANDARD.encode(reference),
        };
        prime_engines(&local).await;
        ready
            .set(local)
            .map_err(|_| "Ya se prepararon los motores de Pluma.")?;
        if events
            .send(json!({"type": "clone.ready", "canSing": can_sing}))
            .is_err()
        {
            return Ok(());
        }
        tokio::select! {
            _ = gemma_child.wait() => Err("El motor local de Gemma se cerró.".into()),
            _ = tts_child.wait() => Err("El motor local de Qwen3-TTS se cerró.".into()),
        }
    }

    pub(super) fn library_session_active(id: &str) -> bool {
        engines(id).is_ok()
    }

    fn engines(id: &str) -> Result<Arc<OnceLock<Engines>>, String> {
        ACTIVE
            .lock()
            .ok()
            .and_then(|active| {
                active
                    .as_ref()
                    .filter(|call| call.id == id && call.ready.get().is_some())
                    .map(|call| call.ready.clone())
            })
            .ok_or_else(|| "La voz clonada de Pluma todavía no está disponible.".into())
    }

    /// Pluma's own tools, plus MCP tools the person trusts in every
    /// conversation, which the window names `mcp_<server>_<tool>`. Each name
    /// at most once, sixteen tools at most.
    pub(super) fn tools_allowed(tools: &[Value]) -> bool {
        const OWN: [&str; 8] = [
            "buscar_biblioteca", "cantar_cancion", "recordar", "olvidar",
            "listar_documentos", "leer_documento", "crear_documento", "editar_documento",
        ];
        let mut seen = std::collections::HashSet::new();
        tools.len() <= 16
            && tools.iter().all(|tool| {
                let Some(name) = tool.pointer("/function/name").and_then(Value::as_str) else {
                    return false;
                };
                let mcp = name.strip_prefix("mcp_").is_some_and(|rest| {
                    (1..=60).contains(&rest.len())
                        && rest.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
                });
                (OWN.contains(&name) || mcp) && seen.insert(name)
            })
    }

    fn chat_body(messages: Vec<Value>, tools: Vec<Value>, stream: bool) -> Result<Value, String> {
        let mut body = json!({
            "model": "pluma-gemma", "messages": messages,
            // Room for a full poem, story or song lyrics; everyday answers stay
            // short because the prompt asks for it.
            "temperature": 0.35, "max_tokens": 1024, "stream": stream,
            "reasoning_effort": "none"
        });
        if !tools_allowed(&tools) {
            return Err("La llamada de Pluma recibió una herramienta no autorizada.".into());
        }
        if !tools.is_empty() {
            // Writing a document goes through the tool arguments, which need
            // more room than a spoken answer.
            if tools.iter().any(|tool| {
                tool.pointer("/function/name").and_then(Value::as_str).is_some_and(|name| {
                    name == "crear_documento" || name == "editar_documento"
                })
            }) {
                body["max_tokens"] = json!(1536);
            }
            body["tools"] = json!(tools);
        }
        if body.to_string().len() > 4 * 1024 * 1024 {
            return Err("La petición de voz de Pluma es demasiado larga.".into());
        }
        Ok(body)
    }

    pub async fn chat(id: &str, messages: Vec<Value>, tools: Vec<Value>) -> Result<Value, String> {
        let body = chat_body(messages, tools, false)?;
        let engines = engines(id)?;
        let local = engines.get().ok_or("Gemma todavía no está preparada.")?;
        local
            .gemma
            .post(&local.client, "/v1/chat/completions", body)
            .await?
            .json()
            .await
            .map_err(|_| "Gemma devolvió una respuesta no válida.".into())
    }

    /// A streamed Gemma reply put back together: its text and any tool calls,
    /// whose name and arguments arrive spread over several events.
    #[derive(Default)]
    pub(super) struct StreamedReply {
        text: String,
        calls: Vec<(String, String, String)>,
    }

    impl StreamedReply {
        /// Adds one `choices[0].delta`. Returns the text to read aloud now:
        /// none once a tool call has started, since that text is not the answer.
        pub(super) fn apply(&mut self, delta: &Value) -> Result<Option<String>, String> {
            if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
                for call in calls {
                    let index = call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                    if index >= 4 {
                        return Err("Gemma pidió demasiadas herramientas en un turno.".into());
                    }
                    while self.calls.len() <= index {
                        self.calls.push(Default::default());
                    }
                    let entry = &mut self.calls[index];
                    if let Some(id) = call.get("id").and_then(Value::as_str) {
                        entry.0 = id.to_string();
                    }
                    if let Some(name) = call.pointer("/function/name").and_then(Value::as_str) {
                        entry.1.push_str(name);
                    }
                    if let Some(arguments) =
                        call.pointer("/function/arguments").and_then(Value::as_str)
                    {
                        entry.2.push_str(arguments);
                    }
                    if entry.1.len() + entry.2.len() > 16 * 1024 {
                        return Err("Gemma devolvió una herramienta demasiado larga.".into());
                    }
                }
            }
            let Some(text) = delta.get("content").and_then(Value::as_str) else {
                return Ok(None);
            };
            if self.text.len() + text.len() > 16 * 1024 {
                return Err("La respuesta de Gemma es demasiado larga para la llamada.".into());
            }
            self.text.push_str(text);
            Ok((self.calls.is_empty() && !text.is_empty()).then(|| text.to_string()))
        }

        /// The finished reply in the shape of a non-streamed completion.
        pub(super) fn finish(self) -> Result<Value, String> {
            if self.calls.is_empty() {
                if self.text.trim().is_empty() {
                    return Err("Gemma terminó sin texto para leer en voz alta.".into());
                }
                return Ok(
                    json!({"choices": [{"message": {"role": "assistant", "content": self.text}}]}),
                );
            }
            let calls: Vec<Value> = self
                .calls
                .into_iter()
                .map(|(id, name, arguments)| {
                    json!({"id": id, "type": "function", "function": {"name": name, "arguments": arguments}})
                })
                .collect();
            let content = if self.text.trim().is_empty() { Value::Null } else { json!(self.text) };
            Ok(json!({"choices": [{"message": {"role": "assistant", "content": content, "tool_calls": calls}}]}))
        }
    }

    pub async fn chat_stream(
        id: &str,
        messages: Vec<Value>,
        tools: Vec<Value>,
        events: Channel<Value>,
    ) -> Result<Value, String> {
        let body = chat_body(messages, tools, true)?;
        let engines = engines(id)?;
        let local = engines.get().ok_or("Gemma todavía no está preparada.")?;
        let mut response = local
            .gemma
            .post(&local.client, "/v1/chat/completions", body)
            .await?;
        let mut line = Vec::new();
        let mut reply = StreamedReply::default();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Se interrumpió la respuesta de Gemma.")?
        {
            // Decode complete lines so an HTTP chunk can split a Spanish character.
            for part in chunk.split_inclusive(|byte| *byte == b'\n') {
                if line.len() + part.len() > 64 * 1024 {
                    return Err("Gemma devolvió un evento demasiado grande.".into());
                }
                line.extend_from_slice(part);
                if part.last() != Some(&b'\n') {
                    continue;
                }
                let raw = std::str::from_utf8(&line)
                    .map_err(|_| "Gemma devolvió un evento no válido.")?;
                if let Some(data) = raw.strip_prefix("data:").map(str::trim) {
                    if data == "[DONE]" {
                        let completion = std::mem::take(&mut reply).finish()?;
                        events
                            .send(json!({"done": true}))
                            .map_err(|_| "La ventana dejó de recibir la respuesta de Pluma.")?;
                        return Ok(completion);
                    }
                    let event: Value = serde_json::from_str(data)
                        .map_err(|_| "Gemma devolvió un evento no válido.")?;
                    if event.get("error").is_some() {
                        return Err("Gemma no pudo completar la respuesta en voz.".into());
                    }
                    if let Some(delta) = event.pointer("/choices/0/delta") {
                        if let Some(text) = reply.apply(delta)? {
                            events
                                .send(json!({"textDelta": text}))
                                .map_err(|_| "La ventana dejó de recibir la respuesta de Pluma.")?;
                        }
                    }
                }
                line.clear();
            }
        }
        Err("La respuesta de Gemma terminó antes de completarse.".into())
    }

    pub async fn speak(id: &str, text: &str, events: Channel<Value>) -> Result<(), String> {
        let text = text.trim();
        if text.is_empty() || text.chars().count() > 2500 {
            return Err(
                "La respuesta para la voz de Pluma está vacía o es demasiado larga.".into(),
            );
        }
        let engines = engines(id)?;
        let local = engines
            .get()
            .ok_or("Qwen3-TTS todavía no está preparado.")?;
        let mut response = local
            .tts
            .post(&local.client, "/tts", speech_body(text, &local.reference))
            .await?;
        let sample_rate = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .filter(|value| {
                value.starts_with("audio/pcm")
                    && value.contains("encoding=float")
                    && value.contains("bits=32")
            })
            .and_then(|value| {
                value
                    .split(';')
                    .map(str::trim)
                    .find_map(|part| part.strip_prefix("rate="))
            })
            .and_then(|rate| rate.parse::<u32>().ok())
            .filter(|rate| (8_000..=48_000).contains(rate))
            .ok_or("Qwen3-TTS no devolvió audio PCM compatible.")?;
        let mut carry = Vec::new();
        let mut delivered = false;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Se interrumpió el audio de Qwen3-TTS.")?
        {
            carry.extend_from_slice(&chunk);
            let size = carry.len() - carry.len() % 4;
            for frame in carry[..size].chunks(PCM_FRAME_BYTES) {
                let data = STANDARD.encode(frame);
                events
                    .send(json!({"data": data, "sampleRate": sample_rate}))
                    .map_err(|_| "La ventana dejó de recibir el audio de Pluma.")?;
                delivered = true;
            }
            carry.drain(..size);
        }
        if !delivered || !carry.is_empty() {
            return Err("Qwen3-TTS terminó sin una respuesta de audio completa.".into());
        }
        events
            .send(json!({"done": true}))
            .map_err(|_| "La ventana dejó de recibir el audio de Pluma.")?;
        Ok(())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::platform::StreamedReply;
    use serde_json::json;

    #[test]
    fn streams_plain_text_and_returns_it_as_the_answer() {
        let mut reply = StreamedReply::default();
        assert_eq!(reply.apply(&json!({"content": "Hola, "})).unwrap().as_deref(), Some("Hola, "));
        assert_eq!(reply.apply(&json!({"content": "Reinier."})).unwrap().as_deref(), Some("Reinier."));
        let done = reply.finish().unwrap();
        assert_eq!(done["choices"][0]["message"]["content"], "Hola, Reinier.");
        assert!(done["choices"][0]["message"].get("tool_calls").is_none());
    }

    #[test]
    fn assembles_a_tool_call_spread_over_events_and_stops_reading_aloud() {
        let mut reply = StreamedReply::default();
        let first = json!({"tool_calls": [{"index": 0, "id": "c1", "type": "function",
            "function": {"name": "recordar", "arguments": "{\"dato\":"}}]});
        assert_eq!(reply.apply(&first).unwrap(), None);
        let rest = json!({"tool_calls": [{"index": 0, "function": {"arguments": "\"Le gusta el jazz\"}"}}]});
        assert_eq!(reply.apply(&rest).unwrap(), None);
        assert_eq!(reply.apply(&json!({"content": "texto tras la llamada"})).unwrap(), None);
        let message = &reply.finish().unwrap()["choices"][0]["message"];
        let call = &message["tool_calls"][0];
        assert_eq!(call["id"], "c1");
        assert_eq!(call["function"]["name"], "recordar");
        assert_eq!(call["function"]["arguments"], "{\"dato\":\"Le gusta el jazz\"}");
    }

    #[test]
    fn rejects_an_empty_answer_and_too_many_tools() {
        assert!(StreamedReply::default().finish().is_err());
        let mut reply = StreamedReply::default();
        assert!(reply.apply(&json!({"tool_calls": [{"index": 9}]})).is_err());
    }
}

#[cfg(all(test, windows))]
mod tool_tests {
    use super::platform::tools_allowed;
    use serde_json::json;

    fn tool(name: &str) -> serde_json::Value {
        json!({"type": "function", "function": {"name": name}})
    }

    #[test]
    fn allows_own_tools_and_trusted_mcp_names_only_once() {
        assert!(tools_allowed(&[tool("buscar_biblioteca"), tool("crear_documento"), tool("mcp_fetch_fetch")]));
        assert!(!tools_allowed(&[tool("recordar"), tool("recordar")]));
        assert!(!tools_allowed(&[tool("ejecutar_comando")]));
        assert!(!tools_allowed(&[tool("mcp_Fetch-Tool")]));
        assert!(!tools_allowed(&[tool("mcp_")]));
        let many: Vec<_> = (0..17).map(|i| tool(&format!("mcp_t{i}"))).collect();
        assert!(!tools_allowed(&many));
    }
}
