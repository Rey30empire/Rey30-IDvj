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
    /// The voice from the Lore folder this sample came from, if any.
    name: Option<String>,
}

impl ReferenceStatus {
    pub(crate) fn with_name(self, name: Option<String>) -> Self {
        Self { name: name.filter(|_| self.ready), ..self }
    }
}

/// Whose voice samples a request is about: Pluma's (`None`, also for her id
/// `literatura`), or another assistant's by its id (`beto`, `coder`…).
pub(crate) fn voice_owner(owner: Option<String>) -> Result<Option<String>, String> {
    match owner.filter(|id| id != "literatura") {
        None => Ok(None),
        Some(id) if valid_owner(&id) => Ok(Some(id)),
        Some(_) => Err("Ese asistente no es válido.".into()),
    }
}

/// An assistant id as the app writes them: lower case letters, digits and dashes.
fn valid_owner(id: &str) -> bool {
    (1..=80).contains(&id.len())
        && id.starts_with(|c: char| c.is_ascii_lowercase())
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !matches!(id, "constructor" | "prototype")
}

/// The folder of an assistant's samples inside the data folder: Pluma keeps
/// `pluma-voice`, any other assistant `pluma-voice/asistentes/<id>`.
pub(crate) fn voice_folder(owner: Option<&str>) -> std::path::PathBuf {
    let base = std::path::PathBuf::from("pluma-voice");
    match owner {
        None => base,
        Some(id) => base.join("asistentes").join(id),
    }
}

/// The Lore voice behind a sample, shown by its name without the extension.
fn lore_name(app: &AppHandle, owner: Option<&str>, singing: bool) -> Option<String> {
    super::lore::selected_voice(app, owner, singing).map(|file| {
        std::path::Path::new(&file)
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or(file)
    })
}

/// `singing` picks the optional singing sample instead of the speaking one;
/// `owner` an assistant other than Pluma.
#[tauri::command]
pub async fn pluma_clone_reference_status(
    app: AppHandle,
    window: WebviewWindow,
    singing: Option<bool>,
    owner: Option<String>,
) -> Result<ReferenceStatus, String> {
    require_main(&window)?;
    let singing = singing.unwrap_or(false);
    let owner = voice_owner(owner)?;
    let name = lore_name(&app, owner.as_deref(), singing);
    platform::reference_status(app, owner.as_deref(), singing).map(|status| status.with_name(name))
}

#[tauri::command]
pub async fn pluma_clone_reference_choose(
    app: AppHandle,
    window: WebviewWindow,
    singing: Option<bool>,
    owner: Option<String>,
) -> Result<ReferenceStatus, String> {
    require_main(&window)?;
    let singing = singing.unwrap_or(false);
    let owner = voice_owner(owner)?;
    let previous = lore_name(&app, owner.as_deref(), singing);
    let status = platform::choose_reference(app.clone(), owner.clone(), singing).await?;
    // A sample picked by hand replaces the Lore voice; a cancelled picker keeps it.
    if status.chosen {
        super::lore::remember_voice(&app, owner.as_deref(), singing, None);
        return Ok(status.status);
    }
    Ok(status.status.with_name(previous))
}

#[tauri::command]
pub async fn pluma_clone_reference_clear(
    app: AppHandle,
    window: WebviewWindow,
    singing: Option<bool>,
    owner: Option<String>,
) -> Result<ReferenceStatus, String> {
    require_main(&window)?;
    let singing = singing.unwrap_or(false);
    let owner = voice_owner(owner)?;
    let status = platform::clear_reference(app.clone(), owner.as_deref(), singing)?;
    super::lore::remember_voice(&app, owner.as_deref(), singing, None);
    Ok(status)
}

/// Saves `audio` as an assistant's speaking or singing sample (used for the
/// voices in the Lore folder). Allowed during Pluma's call: she speaks with it
/// from her next sentence.
pub(crate) async fn install_reference(
    app: AppHandle,
    owner: Option<String>,
    singing: bool,
    audio: Vec<u8>,
) -> Result<ReferenceStatus, String> {
    platform::install_reference(app, owner, singing, audio).await
}

/// Reads `text` aloud with an assistant's cloned voice (its speaking sample),
/// through a small local Qwen3-TTS engine started on first use. A new request
/// cuts the one still speaking.
#[tauri::command]
pub async fn assistant_voice_speak(
    app: AppHandle,
    window: WebviewWindow,
    owner: Option<String>,
    text: String,
    style: Option<Value>,
    events: Channel<Value>,
) -> Result<(), String> {
    require_main(&window)?;
    let owner = voice_owner(owner)?;
    platform::assistant_speak(app, owner, text, style, events).await
}

/// Stops the assistant voice that is speaking, if any.
#[tauri::command]
pub async fn assistant_voice_cancel(window: WebviewWindow) -> Result<(), String> {
    require_main(&window)?;
    platform::assistant_cancel();
    Ok(())
}

/// What the file picker left: the sample now in place, and whether a new file was chosen.
pub(crate) struct ChosenReference {
    status: ReferenceStatus,
    chosen: bool,
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
#[allow(clippy::too_many_arguments)]
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

/// The sample Pluma sings with: the singing sample chosen in the call options
/// when present, otherwise her speaking sample.
#[cfg(windows)]
pub(crate) fn song_voice_reference(app: &AppHandle) -> Option<(Vec<u8>, &'static str)> {
    let singing = platform::sample_path(app.clone(), None, true);
    platform::read_reference(&singing)
        .ok()
        .and_then(|audio| platform::reference_format(&audio).map(|format| (audio, format)))
        .or_else(|| voice_reference(app))
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    const UNAVAILABLE: &str = "La voz clonada de Pluma está disponible en Windows con Vulkan.";

    pub fn reference_status(_: AppHandle, _: Option<&str>, _: bool) -> Result<ReferenceStatus, String> {
        Err(UNAVAILABLE.into())
    }
    pub async fn choose_reference(_: AppHandle, _: Option<String>, _: bool) -> Result<ChosenReference, String> {
        Err(UNAVAILABLE.into())
    }
    pub async fn install_reference(_: AppHandle, _: Option<String>, _: bool, _: Vec<u8>) -> Result<ReferenceStatus, String> {
        Err(UNAVAILABLE.into())
    }
    pub fn clear_reference(_: AppHandle, _: Option<&str>, _: bool) -> Result<ReferenceStatus, String> {
        Err(UNAVAILABLE.into())
    }
    pub async fn assistant_speak(_: AppHandle, _: Option<String>, _: String, _: Option<Value>, _: Channel<Value>) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
    pub fn assistant_cancel() {}
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
        /// The speaking sample, base64. A voice picked mid-call replaces it,
        /// so her next sentence already uses the new voice.
        reference: std::sync::RwLock<String>,
    }

    impl Engines {
        fn reference(&self) -> String {
            self.reference.read().map(|value| value.clone()).unwrap_or_default()
        }
    }

    #[derive(Clone)]
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

    /// The voice style the page asked for. Nothing is passed on yet: the
    /// styles the engine accepts are added here.
    fn apply_style(_body: &mut Value, _style: Option<&Value>) {}

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
            let mut body = speech_body("Hola.", &local.reference());
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

    /// Pluma's speaking sample.
    pub(super) fn reference_path(app: AppHandle) -> PathBuf {
        sample_path(app, None, false)
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
            name: None,
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

    /// WAV or MP3 despite the names: samples are recognized by their content.
    const SPEAKING_SAMPLE: &str = "reference.audio";
    const SINGING_SAMPLE: &str = "reference-canto.wav";

    /// An assistant's speaking or singing sample (Pluma's when `owner` is
    /// `None`). The singing one is optional: without it she sings with her
    /// speaking sample.
    pub(super) fn sample_path(app: AppHandle, owner: Option<&str>, singing: bool) -> PathBuf {
        crate::core::app::commands::get_rey30_data_folder_path(app)
            .join(super::voice_folder(owner))
            .join(if singing { SINGING_SAMPLE } else { SPEAKING_SAMPLE })
    }

    pub fn reference_status(app: AppHandle, owner: Option<&str>, singing: bool) -> Result<ReferenceStatus, String> {
        Ok(status_for(&sample_path(app, owner, singing)))
    }

    /// A new speaking sample takes over in the call that is running, from her
    /// next sentence on. A call still starting reads the file when it is ready.
    fn use_in_active_call(audio: &[u8]) {
        let Ok(active) = ACTIVE.lock() else { return };
        if let Some(engines) = active.as_ref().and_then(|call| call.ready.get()) {
            if let Ok(mut reference) = engines.reference.write() {
                *reference = STANDARD.encode(audio);
            }
        }
    }

    /// Checks `audio` and puts it in place of the speaking or singing sample in
    /// one step. Allowed during a call: songs read their sample each time, and
    /// Pluma's speaking one is swapped into the running call.
    fn write_reference(app: AppHandle, owner: Option<&str>, singing: bool, audio: &[u8]) -> Result<ReferenceStatus, String> {
        let path = &sample_path(app, owner, singing);
        let format = reference_format(audio)
            .ok_or("Elige una grabación WAV o MP3 válida de hasta 10 MB.")?;
        let parent = path
            .parent()
            .ok_or("No se encontró la carpeta de voz de Pluma.")?;
        fs::create_dir_all(parent).map_err(|_| "No se pudo crear la carpeta de voz de Pluma.")?;
        let temporary = parent.join(format!("{}.partial", Uuid::new_v4()));
        fs::write(&temporary, audio).map_err(|_| "No se pudo guardar el audio de referencia.")?;
        if fs::rename(&temporary, path).is_err() {
            let _ = fs::remove_file(temporary);
            return Err("No se pudo sustituir el audio de referencia.".into());
        }
        if !singing && owner.is_none() {
            use_in_active_call(audio);
        }
        Ok(ReferenceStatus {
            ready: true,
            format: Some(format),
            bytes: Some(audio.len()),
            name: None,
        })
    }

    pub async fn choose_reference(app: AppHandle, owner: Option<String>, singing: bool) -> Result<ChosenReference, String> {
        tokio::task::spawn_blocking(move || {
            let path = sample_path(app.clone(), owner.as_deref(), singing);
            let Some(source) = rfd::FileDialog::new()
                .set_title(if singing {
                    "Seleccionar audio de canto"
                } else {
                    "Seleccionar audio de referencia de la voz"
                })
                .add_filter("Audio WAV o MP3", &["wav", "mp3"])
                .pick_file()
            else {
                return Ok(ChosenReference { status: status_for(&path), chosen: false });
            };
            let audio = read_reference(&source).map_err(|_| "No se pudo leer el audio elegido.")?;
            Ok(ChosenReference { status: write_reference(app, owner.as_deref(), singing, &audio)?, chosen: true })
        })
        .await
        .map_err(|_| "Se interrumpió el selector de audio.".to_string())?
    }

    pub async fn install_reference(
        app: AppHandle,
        owner: Option<String>,
        singing: bool,
        audio: Vec<u8>,
    ) -> Result<ReferenceStatus, String> {
        tokio::task::spawn_blocking(move || write_reference(app, owner.as_deref(), singing, &audio))
            .await
            .map_err(|_| "No se pudo cambiar la voz.".to_string())?
    }

    pub fn clear_reference(app: AppHandle, owner: Option<&str>, singing: bool) -> Result<ReferenceStatus, String> {
        if owner.is_none() {
            ensure_idle()?;
        }
        match fs::remove_file(sample_path(app, owner, singing)) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err("No se pudo quitar el audio de referencia.".into()),
        }
        Ok(ReferenceStatus {
            ready: false,
            format: None,
            bytes: None,
            name: None,
        })
    }

    pub fn start(app: AppHandle, events: Channel<Value>) -> Result<String, String> {
        let mut active = ACTIVE
            .lock()
            .map_err(|_| "No se pudo iniciar la voz clonada.")?;
        // One call per window: a page reloaded mid-call leaves its call with no
        // one to stop it, and a stop sent just before this start may not have
        // arrived. The new call replaces the old one instead of being refused.
        if let Some(previous) = active.take() {
            previous.cancel.cancel();
            previous.task.abort();
            let _ = previous.events.send(json!({
                "type": "clone.error",
                "message": "La llamada anterior de Pluma se cerró al empezar otra."
            }));
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
        let reference = read_reference(&reference_path(app.clone()))
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
        // A voice picked while the engines were starting counts too.
        let reference = read_reference(&reference_path(app))
            .ok()
            .filter(|audio| reference_format(audio).is_some())
            .unwrap_or(reference);
        let local = Engines {
            client,
            gemma,
            tts,
            reference: std::sync::RwLock::new(STANDARD.encode(reference)),
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
    /// at most once, twenty-four tools at most.
    pub(super) fn tools_allowed(tools: &[Value]) -> bool {
        const OWN: [&str; 14] = [
            "buscar_biblioteca", "cantar_cancion", "leer_libro", "recordar", "olvidar",
            "listar_documentos", "leer_documento", "crear_documento", "editar_documento",
            "proyecto_listar", "proyecto_buscar", "proyecto_leer", "proyecto_crear", "proyecto_editar",
        ];
        let mut seen = std::collections::HashSet::new();
        tools.len() <= 24
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
                    matches!(name, "crear_documento" | "editar_documento" | "proyecto_crear" | "proyecto_editar")
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
                    if let Some(timings) = event.get("timings") {
                        log::info!("Tiempos de Gemma en la llamada de Pluma: {timings}");
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
        stream_speech(&local.client, &local.tts, speech_body(text, &local.reference()), &events).await
    }

    /// Sends Qwen3-TTS's PCM to the window as it arrives, in frames small
    /// enough for Tauri's direct IPC, then `{"done": true}`.
    async fn stream_speech(client: &Client, tts: &Endpoint, body: Value, events: &Channel<Value>) -> Result<(), String> {
        let mut response = tts.post(client, "/tts", body).await?;
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

    /// The Qwen3-TTS engine the assistants speak with outside Pluma's call: one
    /// small server, started on first use and kept until the app closes.
    struct AssistantTts {
        child: Child,
        _job: OwnedHandle,
        endpoint: Endpoint,
        client: Client,
    }

    static ASSISTANT_TTS: tokio::sync::Mutex<Option<AssistantTts>> = tokio::sync::Mutex::const_new(None);
    static ASSISTANT_TURN: Mutex<Option<CancellationToken>> = Mutex::new(None);

    /// The running assistant engine, starting it when there is none (or it died).
    async fn assistant_engine(app: &AppHandle) -> Result<(Client, Endpoint), String> {
        let mut slot = ASSISTANT_TTS.lock().await;
        if let Some(engine) = slot.as_mut() {
            if engine.child.try_wait().ok().flatten().is_none() {
                return Ok((engine.client.clone(), engine.endpoint.clone()));
            }
            *slot = None;
        }
        let engine = engine_path(app)?;
        let tts_engine = engine
            .parent()
            .and_then(Path::parent)
            .map(|resources| resources.join("pluma-llama-tts/llama-server.exe"))
            .filter(|path| path.is_file())
            .unwrap_or_else(|| engine.clone());
        let dir = models("REY30_PLUMA_TTS_DIR", "Qwen3-TTS-12Hz-1.7B-Base-GGUF", TTS_MODEL, TTS_PROJECTOR)?;
        let device = amd_device(&engine).await?;
        log::info!("La voz clonada de los asistentes usa Qwen3-TTS en {device}.");
        let (mut child, job, endpoint) = spawn_engine(&tts_engine, &device, &dir, TTS_MODEL, TTS_PROJECTOR, "asistentes-tts", &["--ctx-size", "4096"])?;
        wait_for_engine(&mut child, endpoint.port, Duration::from_secs(195)).await?;
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|_| "No se pudo conectar con el motor de voz local.")?;
        let ready = (client.clone(), endpoint.clone());
        *slot = Some(AssistantTts { child, _job: job, endpoint, client });
        Ok(ready)
    }

    /// Reads `text` with the assistant's speaking sample. A new request (or
    /// `assistant_cancel`) cuts the one still speaking.
    pub async fn assistant_speak(app: AppHandle, owner: Option<String>, text: String, style: Option<Value>, events: Channel<Value>) -> Result<(), String> {
        let text = text.trim().to_string();
        if text.is_empty() || text.chars().count() > 2500 {
            return Err("El texto para la voz está vacío o es demasiado largo.".into());
        }
        let token = CancellationToken::new();
        if let Ok(mut turn) = ASSISTANT_TURN.lock() {
            if let Some(previous) = turn.replace(token.clone()) {
                previous.cancel();
            }
        }
        let reference = read_reference(&sample_path(app.clone(), owner.as_deref(), false))
            .ok()
            .filter(|audio| reference_format(audio).is_some())
            .ok_or("Este asistente todavía no tiene voz: elige una de Lore, graba la tuya o elige un archivo en Configurar personaje → Voz.")?;
        let speech = async {
            let (client, endpoint) = assistant_engine(&app).await?;
            let mut body = speech_body(&text, &STANDARD.encode(reference));
            apply_style(&mut body, style.as_ref());
            stream_speech(&client, &endpoint, body, &events).await
        };
        tokio::select! {
            biased;
            _ = token.cancelled() => Err("Se detuvo la voz.".into()),
            result = speech => result,
        }
    }

    pub fn assistant_cancel() {
        if let Ok(mut turn) = ASSISTANT_TURN.lock() {
            if let Some(token) = turn.take() {
                token.cancel();
            }
        }
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
        assert!(tools_allowed(&[tool("proyecto_leer"), tool("proyecto_editar")]));
        assert!(!tools_allowed(&[tool("proyecto_borrar")]));
        let many: Vec<_> = (0..25).map(|i| tool(&format!("mcp_t{i}"))).collect();
        assert!(!tools_allowed(&many));
    }
}

#[cfg(test)]
mod owner_tests {
    use super::{voice_folder, voice_owner};
    use std::path::Path;

    #[test]
    fn each_assistant_keeps_its_samples_apart_and_pluma_keeps_hers() {
        assert_eq!(voice_owner(None).unwrap(), None);
        assert_eq!(voice_owner(Some("literatura".into())).unwrap(), None);
        assert_eq!(voice_owner(Some("beto".into())).unwrap().as_deref(), Some("beto"));
        assert_eq!(voice_owner(Some("mi-asistente-2".into())).unwrap().as_deref(), Some("mi-asistente-2"));
        assert_eq!(voice_folder(None), Path::new("pluma-voice"));
        assert_eq!(voice_folder(Some("beto")), Path::new("pluma-voice").join("asistentes").join("beto"));
    }

    #[test]
    fn an_assistant_id_cannot_point_outside_its_folder() {
        for id in ["", "..", "../pluma", "beto/..", "Beto", "a\\b", "c:", "constructor", "-x", "1beto", &"a".repeat(81)] {
            assert!(voice_owner(Some(id.to_string())).is_err(), "{id}");
        }
    }
}
