use serde_json::Value;
use tauri::{ipc::Channel, AppHandle, WebviewWindow};

#[tauri::command]
pub async fn pluma_realtime_start(
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
        Err("La llamada local de Pluma está disponible en Windows con Vulkan.".into())
    }
}

#[tauri::command]
pub async fn pluma_realtime_send(
    window: WebviewWindow,
    session_id: String,
    event: Value,
) -> Result<(), String> {
    require_main(&window)?;
    #[cfg(windows)]
    return windows::send(&session_id, event);
    #[cfg(not(windows))]
    {
        let _ = (session_id, event);
        Err("La llamada de Pluma no está disponible.".into())
    }
}

#[tauri::command]
pub async fn pluma_realtime_stop(window: WebviewWindow, session_id: String) -> Result<(), String> {
    require_main(&window)?;
    #[cfg(windows)]
    windows::stop(&session_id).await;
    #[cfg(not(windows))]
    let _ = session_id;
    Ok(())
}

pub(super) fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("La llamada de Pluma se controla desde la ventana principal.".into())
    }
}

pub fn stop_all() {
    #[cfg(windows)]
    windows::stop_all();
}

pub(crate) fn library_session_active(session_id: &str) -> bool {
    #[cfg(windows)]
    return windows::library_session_active(session_id);
    #[cfg(not(windows))]
    {
        let _ = session_id;
        false
    }
}

#[cfg(windows)]
pub(super) mod windows {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use futures_util::{SinkExt, StreamExt};
    use serde_json::json;
    use std::{
        net::{Ipv4Addr, TcpListener},
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
        path::{Path, PathBuf},
        process::Stdio,
        sync::Mutex,
        time::Duration,
    };
    use tauri::Manager;
    use tokio::{
        net::TcpStream,
        process::{Child, Command},
        sync::mpsc,
        task::JoinHandle,
        time::{sleep, timeout},
    };
    use tokio_tungstenite::{
        client_async, tungstenite::client::IntoClientRequest, tungstenite::Message, WebSocketStream,
    };
    use uuid::Uuid;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    const BASE_MODEL: &str = "LFM3-Omni-2B-Q4_K_M.gguf";
    const AUDIO_PROJECTOR: &str = "mmproj-LFM3-Omni-2B-Q8_0.gguf";
    const MAX_EVENT_BYTES: usize = 196_608;
    static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);

    struct Active {
        id: String,
        sender: mpsc::Sender<String>,
        events: Channel<Value>,
        task: JoinHandle<()>,
    }

    pub(super) fn library_session_active(id: &str) -> bool {
        ACTIVE.lock().is_ok_and(|active| {
            active.as_ref().is_some_and(|call| call.id == id && !call.task.is_finished())
        })
    }

    pub fn start(app: AppHandle, events: Channel<Value>) -> Result<String, String> {
        let engine = engine_path(&app)?;
        let models = model_dir(app)?;
        let mut active = ACTIVE.lock().map_err(|_| "No se pudo iniciar Pluma.")?;
        if active.is_some() {
            return Err("Ya hay una llamada de Pluma abierta.".into());
        }
        let id = Uuid::new_v4().to_string();
        let task_id = id.clone();
        let (sender, receiver) = mpsc::channel(32);
        let task_events = events.clone();
        let task = tokio::spawn(async move {
            let result = run_call(engine, models, &task_events, receiver).await;
            if let Ok(mut current) = ACTIVE.lock() {
                if current.as_ref().is_some_and(|call| call.id == task_id) {
                    current.take();
                }
            }
            if let Err(message) = result {
                log::warn!("Pluma: {message}");
                let _ = task_events.send(json!({ "type": "rey30.error", "message": message }));
            }
        });
        *active = Some(Active {
            id: id.clone(),
            sender,
            events,
            task,
        });
        Ok(id)
    }

    pub fn send(session_id: &str, event: Value) -> Result<(), String> {
        if !matches!(
            event.get("type").and_then(Value::as_str),
            Some(
                "session.update"
                    | "input_audio_buffer.append"
                    | "input_audio_buffer.commit"
                    | "input_audio_buffer.clear"
                    | "conversation.item.create"
                    | "response.create"
                    | "response.cancel"
            )
        ) {
            return Err("Pluma recibió un evento de voz desconocido.".into());
        }
        let body = event.to_string();
        if body.len() > MAX_EVENT_BYTES {
            return Err("El fragmento de audio de Pluma es demasiado grande.".into());
        }
        let active = ACTIVE.lock().map_err(|_| "La llamada de Pluma se cerró.")?;
        let call = active
            .as_ref()
            .filter(|call| call.id == session_id)
            .ok_or("La llamada de Pluma se cerró.")?;
        call.sender
            .try_send(body)
            .map_err(|_| "La conexión local de voz no está aceptando más audio.".into())
    }

    pub async fn stop(session_id: &str) {
        let task = ACTIVE.lock().ok().and_then(|mut active| {
            if active.as_ref().is_some_and(|call| call.id == session_id) {
                active.take().map(|call| call.task)
            } else {
                None
            }
        });
        if let Some(task) = task {
            task.abort();
            let _ = task.await;
        }
    }

    pub fn stop_all() {
        let call = ACTIVE.lock().ok().and_then(|mut active| active.take());
        if let Some(call) = call {
            call.task.abort();
            // Closing to the tray keeps the WebView alive, including its microphone.
            let _ = call.events.send(json!({
                "type": "rey30.error",
                "message": "La llamada de Pluma se cerró al cerrar la ventana."
            }));
        }
    }

    pub(in crate::core::system) fn engine_path(app: &AppHandle) -> Result<PathBuf, String> {
        let resources = app
            .path()
            .resource_dir()
            .map_err(|_| "No se encontró la carpeta de recursos de Rey30.")?;
        [
            resources.join("resources/pluma-llama/llama-server.exe"),
            resources.join("pluma-llama/llama-server.exe"),
        ]
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "Falta el motor de voz Vulkan de Pluma. Vuelve a preparar la distribución de Rey30."
                .into()
        })
    }

    fn model_dir(app: AppHandle) -> Result<PathBuf, String> {
        let data = crate::core::app::commands::get_rey30_data_folder_path(app);
        let candidates = [
            std::env::var_os("REY30_PLUMA_MODEL_DIR").map(PathBuf::from),
            Some(data.join("models/Pluma/LFM3-Omni-2B-GGUF")),
            Some(
                super::super::models_root::models_root()
                    .join("Pluma")
                    .join("LFM3-Omni-2B-GGUF"),
            ),
        ];
        candidates.into_iter().flatten().find(|dir| {
            dir.join(BASE_MODEL).is_file() && dir.join(AUDIO_PROJECTOR).is_file()
        }).ok_or_else(|| "Faltan el modelo LFM3-Omni-2B y su proyector de audio. Define REY30_PLUMA_MODEL_DIR con la carpeta de ambos archivos.".into())
    }

    pub(in crate::core::system) fn engine_command(engine: &Path) -> Command {
        let mut command = Command::new(engine);
        if let Some(directory) = engine.parent() {
            command.current_dir(directory);
        }
        command
            .creation_flags(0x0800_0000)
            .kill_on_drop(true)
            .env_remove("GGML_VK_VISIBLE_DEVICES")
            .stdin(Stdio::null());
        command
    }

    fn r9700_device(listing: &str) -> Option<&str> {
        listing.lines().find_map(|line| {
            let (id, name) = line.trim().split_once(':')?;
            let index = id.strip_prefix("Vulkan")?;
            (!index.is_empty()
                && index.bytes().all(|byte| byte.is_ascii_digit())
                && name.contains("AMD Radeon AI PRO R9700"))
            .then_some(id)
        })
    }

    pub(in crate::core::system) fn reap_with_app(child: &Child) -> Option<OwnedHandle> {
        let process = child.raw_handle()?;
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return None;
        }
        let job = unsafe { OwnedHandle::from_raw_handle(job) };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let handle = job.as_raw_handle();
        let assigned = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&limits).cast(),
                std::mem::size_of_val(&limits) as u32,
            ) != 0
                && AssignProcessToJobObject(handle, process) != 0
        };
        assigned.then_some(job)
    }

    pub(in crate::core::system) async fn amd_device(engine: &Path) -> Result<String, String> {
        let output = timeout(
            Duration::from_secs(15),
            engine_command(engine).arg("--list-devices").output(),
        )
        .await
        .map_err(|_| "El motor de Pluma tardó demasiado en detectar Vulkan.")?
        .map_err(|error| format!("No se pudo comprobar Vulkan para Pluma. {error}"))?;
        let listing = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
        r9700_device(&listing)
            .filter(|_| output.status.success())
            .map(str::to_string)
            .ok_or_else(|| {
                "El motor de Pluma no encontró la AMD Radeon AI PRO R9700 en Vulkan.".into()
            })
    }

    async fn start_engine(
        engine: &Path,
        models: &Path,
        port: u16,
        key: &str,
    ) -> Result<Child, String> {
        let device = amd_device(engine).await?;
        log::info!("Pluma usa AMD Radeon AI PRO R9700 en {device} para voz local.");
        engine_command(engine)
            .args([
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
                "--no-webui",
            ])
            .args(["--device", &device, "--mmproj-device", &device])
            .args(["--n-gpu-layers", "all", "--reasoning", "off"])
            .args(["--ctx-size", "4096", "--parallel", "1"])
            .arg("--model")
            .arg(models.join(BASE_MODEL))
            .arg("--mmproj")
            .arg(models.join(AUDIO_PROJECTOR))
            .env("LLAMA_API_KEY", key)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("No se pudo iniciar el motor local de Pluma. {error}"))
    }

    pub(in crate::core::system) async fn wait_for_engine(
        child: &mut Child,
        port: u16,
        startup_timeout: Duration,
    ) -> Result<(), String> {
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(1))
            .build()
            .map_err(|_| "No se pudo comprobar el motor de Pluma.")?;
        let health = format!("http://127.0.0.1:{port}/health");
        timeout(startup_timeout, async {
            loop {
                if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                    return Err(format!(
                        "El motor de Pluma se cerró durante la preparación. {status}"
                    ));
                }
                if client
                    .get(&health)
                    .send()
                    .await
                    .is_ok_and(|r| r.status().is_success())
                {
                    return Ok(());
                }
                sleep(Duration::from_millis(120)).await;
            }
        })
        .await
        .map_err(|_| "El motor de Pluma tardó demasiado en preparar la llamada.".to_string())?
    }

    async fn connect(port: u16, key: &str) -> Result<WebSocketStream<TcpStream>, String> {
        let mut request = format!("ws://127.0.0.1:{port}/v1/realtime")
            .into_client_request()
            .map_err(|_| "La dirección local de voz no es válida.")?;
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {key}")
                .parse()
                .map_err(|_| "No se pudo autenticar la llamada local.")?,
        );
        let (socket, _) = timeout(Duration::from_secs(10), async {
            let stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))
                .await
                .map_err(|error| error.to_string())?;
            stream
                .set_nodelay(true)
                .map_err(|error| error.to_string())?;
            client_async(request, stream)
                .await
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|_| "La conexión local de voz tardó demasiado.")?
        .map_err(|error| format!("No se pudo conectar la voz local. {error}"))?;
        Ok(socket)
    }

    async fn warm_audio(port: u16, key: &str) -> Result<(), String> {
        let mut socket = connect(port, key).await?;
        let Some(Ok(Message::Text(first))) = socket.next().await else {
            return Err("LFM3 no abrió la sesión de calentamiento.".into());
        };
        let session: Value = serde_json::from_str(first.as_str()).map_err(|e| e.to_string())?;
        let sample_rate = session
            .pointer("/session/audio/input/format/rate")
            .and_then(Value::as_u64)
            .filter(|rate| (8000..=48000).contains(rate))
            .ok_or("LFM3 no indicó la frecuencia de entrada.")?;
        let silence = STANDARD.encode(vec![0_u8; (sample_rate * 2 / 50) as usize]);
        let configure = json!({"type": "session.update", "session": {
            "type": "realtime", "instructions": "Di exactamente «hola» en voz alta.",
            "output_modalities": ["text", "audio"], "max_output_tokens": 64
        }});
        socket
            .send(Message::Text(configure.to_string().into()))
            .await
            .map_err(|e| e.to_string())?;
        let append = json!({"type": "input_audio_buffer.append", "audio": silence}).to_string();
        for _ in 0..33 {
            socket
                .send(Message::Text(append.clone().into()))
                .await
                .map_err(|e| e.to_string())?;
        }
        for event in [
            json!({"type": "input_audio_buffer.commit"}),
            json!({"type": "response.create"}),
        ] {
            socket
                .send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| e.to_string())?;
        }
        let mut received_audio = false;
        while let Some(Ok(Message::Text(text))) = socket.next().await {
            let event: Value = serde_json::from_str(text.as_str()).map_err(|e| e.to_string())?;
            match event.get("type").and_then(Value::as_str) {
                Some("response.output_audio.delta") => received_audio = true,
                Some("response.done") | Some("error") => break,
                _ => {}
            }
        }
        let _ = socket.close(None).await;
        let _ = timeout(Duration::from_secs(1), async {
            while socket.next().await.is_some() {}
        })
        .await;
        if received_audio {
            Ok(())
        } else {
            Err("LFM3 completó el calentamiento sin audio.".into())
        }
    }

    async fn run_call(
        engine: PathBuf,
        models: PathBuf,
        events: &Channel<Value>,
        mut commands: mpsc::Receiver<String>,
    ) -> Result<(), String> {
        let port = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .and_then(|listener| listener.local_addr())
            .map_err(|_| "No se pudo reservar un puerto local de voz.")?
            .port();
        let key = Uuid::new_v4().simple().to_string();
        let mut child = start_engine(&engine, &models, port, &key).await?;
        let _job =
            reap_with_app(&child).ok_or("Windows no pudo aislar el proceso de voz de Pluma.")?;
        wait_for_engine(&mut child, port, Duration::from_secs(120)).await?;
        // Keep codec warmup out of the microphone session and its conversation history.
        if !matches!(
            timeout(Duration::from_secs(30), warm_audio(port, &key)).await,
            Ok(Ok(()))
        ) {
            log::warn!(
                "Pluma no completó el calentamiento de audio. Se intentará abrir la llamada."
            );
        }
        let mut socket = connect(port, &key).await?;
        loop {
            tokio::select! {
                message = commands.recv() => {
                    let Some(message) = message else { return Ok(()) };
                    socket.send(Message::Text(message.into())).await
                        .map_err(|_| "Se interrumpió el envío de audio a Pluma.")?;
                }
                frame = socket.next() => {
                    match frame {
                        Some(Ok(Message::Text(text))) => {
                            let event = serde_json::from_str(text.as_str())
                                .map_err(|_| "El motor de voz devolvió un evento no válido.")?;
                            if events.send(event).is_err() {
                                return Ok(());
                            }
                        }
                        Some(Ok(Message::Ping(_))) => {
                            socket.flush().await.map_err(|_| "Se cerró la conexión local de voz.")?;
                        }
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                            return Err("Se cerró la conexión local de voz de Pluma.".into());
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::r9700_device;

        #[test]
        fn selects_amd_vulkan_without_falling_back() {
            let list = "  Vulkan0: NVIDIA GeForce RTX 3060 Ti (8192 MiB)\n  Vulkan1: AMD Radeon AI PRO R9700 (32626 MiB)";
            assert_eq!(r9700_device(list), Some("Vulkan1"));
            assert_eq!(r9700_device("  Vulkan0: NVIDIA GeForce RTX 3060 Ti"), None);
            assert_eq!(r9700_device("  CUDA1: AMD Radeon AI PRO R9700"), None);
        }
    }
}
