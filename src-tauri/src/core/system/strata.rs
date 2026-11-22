//! Strata (github.com/Niko1221/Strata): a local engine for large
//! mixture-of-experts models. It keeps the experts in use in VRAM, more of
//! them in RAM and reads the rest from the model file on the SSD, so a model
//! larger than the graphics card still runs.
//!
//! When the Strata app is installed, the editor starts its server with one of
//! the model setups made in Strata (`install/strata-*.json`): on loopback only,
//! with a key only the editor knows, and without opening a browser. The editor
//! then talks to it like any OpenAI-compatible local provider, and stopping it
//! (or closing the editor) ends the server and its engine.
// Starting Strata is Windows-only for now; elsewhere only the tests read its folders.
#![cfg_attr(not(windows), allow(dead_code))]

use super::pluma_realtime::require_main;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, WebviewWindow};

/// Strata's default port, used when a setup names none.
const DEFAULT_PORT: u16 = 8080;
const MAX_SETUPS: usize = 40;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StrataSetup {
    /// The setup file's name in Strata's install folder.
    file: String,
    /// The model it serves, as Strata names it.
    model: String,
    port: u16,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StrataRunning {
    setup: String,
    model: String,
    port: u16,
    base_url: String,
    api_key: String,
    /// The card it runs on: `amd`, `nvidia`, or empty when Strata chose.
    gpu: String,
}

/// The engine family for a card: Strata's `STRATA_ENGINE_BACKEND`. With both
/// installed, Strata alone would pick NVIDIA; the editor prefers the AMD card,
/// which has the most memory on this kind of PC.
fn backend_for(gpu: Option<&str>, engines: &[String]) -> Result<Option<(&'static str, &'static str)>, String> {
    let has = |family: &str| engines.iter().any(|name| name.contains(family));
    match gpu {
        Some("amd") if has("-hip-") => Ok(Some(("hip", "amd"))),
        Some("nvidia") if has("-cuda-") => Ok(Some(("cuda", "nvidia"))),
        Some("amd") => Err("Strata no tiene el motor para AMD. Descárgalo con su actualizador (motor rx9070).".into()),
        Some("nvidia") => Err("Strata no tiene el motor para NVIDIA (CUDA).".into()),
        Some(_) => Err("Esa tarjeta no es AMD ni NVIDIA.".into()),
        None if has("-hip-") => Ok(Some(("hip", "amd"))),
        None => Ok(None),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrataStatus {
    installed: bool,
    /// Engine builds Strata has downloaded, such as `...-cuda-cuda13` or `...-hip-rx9070`.
    engines: Vec<String>,
    setups: Vec<StrataSetup>,
    /// The server the editor started, if it is still running.
    running: Option<StrataRunning>,
    /// Its model is loaded and answers.
    ready: bool,
    /// Why the last server stopped on its own, with where its log is.
    stopped: Option<String>,
}

/// Strata's folder: `STRATA_HOME` if set, else `%LOCALAPPDATA%\Strata`.
fn strata_home() -> Option<PathBuf> {
    std::env::var_os("STRATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(|local| PathBuf::from(local).join("Strata")))
        .filter(|path| path.is_dir())
}

/// A folder name read from Strata's files, used only as one path component.
fn plain_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':', '\0'])
}

/// The Python and server script of the control component Strata has active.
fn control(home: &Path) -> Option<(PathBuf, PathBuf, PathBuf)> {
    let base = home.join("components").join("control");
    let active: serde_json::Value = serde_json::from_slice(&fs::read(base.join("active.json")).ok()?).ok()?;
    let folder = active.get("folder").and_then(|value| value.as_str()).filter(|name| plain_name(name))?;
    let dir = base.join(folder);
    let python = dir.join("python").join("python.exe");
    let server = dir.join("serve").join("server.py");
    (python.is_file() && server.is_file()).then_some((python, server, dir))
}

fn engines(home: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(home.join("components").join("engine"))
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.path().is_dir())
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .filter(|name| !name.starts_with('.'))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// The folders Strata installed model setups into (its `app-settings.json`), or its own `install`.
fn install_dirs(home: &Path) -> Vec<PathBuf> {
    let listed: Vec<PathBuf> = fs::read(home.join("app-settings.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|settings| settings.get("installs").and_then(|value| value.as_array()).cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|value| value.as_str().map(PathBuf::from))
        .filter(|path| path.is_absolute() && path.is_dir())
        .collect();
    if listed.is_empty() {
        vec![home.join("install")]
    } else {
        listed
    }
}

/// The model setups made in Strata: `strata-*.json` files with the model they serve.
fn setups(home: &Path) -> Vec<(StrataSetup, PathBuf)> {
    let mut found = Vec::new();
    for dir in install_dirs(home) {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            if !(name.starts_with("strata-") && name.ends_with(".json") && path.is_file()) {
                continue;
            }
            let Some(config) = fs::read(&path).ok().and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok()) else {
                continue;
            };
            let model = config
                .get("model_name")
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| name.trim_start_matches("strata-").trim_end_matches(".json").to_string());
            let port = config
                .get("port")
                .and_then(|value| value.as_u64())
                .and_then(|port| u16::try_from(port).ok())
                .filter(|port| *port >= 1024)
                .unwrap_or(DEFAULT_PORT);
            found.push((StrataSetup { file: name, model, port }, path));
        }
    }
    found.sort_by(|a, b| a.0.file.cmp(&b.0.file));
    found.truncate(MAX_SETUPS);
    found
}

#[cfg(windows)]
mod platform {
    use super::*;
    use crate::core::system::pluma_realtime::windows::reap_with_app;
    use std::{
        os::windows::io::OwnedHandle,
        process::Stdio,
        sync::Mutex,
        time::Duration,
    };
    use tokio::process::{Child, Command};

    struct Server {
        info: StrataRunning,
        child: Child,
        /// Closing it ends the server and the engine it started.
        _job: OwnedHandle,
        log: PathBuf,
    }

    static SERVER: Mutex<Option<Server>> = Mutex::new(None);
    static STOPPED: Mutex<Option<String>> = Mutex::new(None);

    fn log_path(app: &AppHandle) -> PathBuf {
        crate::core::app::commands::get_rey30_data_folder_path(app.clone())
            .join("strata")
            .join("server.log")
    }

    /// The server the editor started, if it still runs; one that ended is cleared with the reason.
    fn running() -> Option<StrataRunning> {
        let mut server = SERVER.lock().ok()?;
        let ended = match server.as_mut() {
            Some(current) => current.child.try_wait().ok().flatten().map(|status| (status, current.log.clone())),
            None => return None,
        };
        if let Some((status, log)) = ended {
            *server = None;
            if let Ok(mut stopped) = STOPPED.lock() {
                *stopped = Some(format!(
                    "Strata se cerró solo ({status}). Su registro está en {}.",
                    log.display()
                ));
            }
            return None;
        }
        server.as_ref().map(|current| current.info.clone())
    }

    async fn loaded(port: u16) -> bool {
        let Ok(client) = reqwest::Client::builder().timeout(Duration::from_millis(1500)).no_proxy().build() else {
            return false;
        };
        let Ok(response) = client.get(format!("http://127.0.0.1:{port}/health")).send().await else {
            return false;
        };
        response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|health| health.get("loaded").and_then(|value| value.as_bool()))
            .unwrap_or(false)
    }

    async fn port_taken(port: u16) -> bool {
        tokio::time::timeout(Duration::from_millis(400), tokio::net::TcpStream::connect(("127.0.0.1", port)))
            .await
            .map(|connected| connected.is_ok())
            .unwrap_or(false)
    }

    pub async fn status() -> StrataStatus {
        let home = strata_home();
        let installed = home.as_deref().and_then(control).is_some();
        let running = running();
        let ready = match &running {
            Some(server) => loaded(server.port).await,
            None => false,
        };
        StrataStatus {
            installed,
            engines: home.as_deref().map(engines).unwrap_or_default(),
            setups: home.as_deref().map(setups).unwrap_or_default().into_iter().map(|(setup, _)| setup).collect(),
            running,
            ready,
            stopped: STOPPED.lock().ok().and_then(|stopped| stopped.clone()),
        }
    }

    pub async fn start(app: AppHandle, setup: String, gpu: Option<String>) -> Result<StrataRunning, String> {
        if let Some(current) = running() {
            if current.setup == setup {
                return Ok(current);
            }
            return Err(format!("Strata ya está sirviendo {}. Detenlo antes de cambiar de modelo.", current.model));
        }
        let home = strata_home().ok_or("No se encontró Strata en este equipo. Instálalo desde su página y crea un modelo en él.")?;
        let (python, server, dir) = control(&home).ok_or("La instalación de Strata está incompleta: ábrelo una vez para que termine de prepararse.")?;
        let (chosen, config) = setups(&home)
            .into_iter()
            .find(|(candidate, _)| candidate.file == setup)
            .ok_or("Ese modelo ya no está entre los de Strata.")?;
        let card = backend_for(gpu.as_deref(), &engines(&home))?;
        if port_taken(chosen.port).await {
            return Err(format!(
                "El puerto {} ya está en uso: si Strata está abierto en su propia ventana, ciérralo y vuelve a intentarlo.",
                chosen.port
            ));
        }
        let log = log_path(&app);
        if let Some(parent) = log.parent() {
            fs::create_dir_all(parent).map_err(|_| "No se pudo crear la carpeta del registro de Strata.")?;
        }
        let output = fs::File::create(&log).map_err(|_| "No se pudo crear el registro de Strata.")?;
        let errors = output.try_clone().map_err(|_| "No se pudo crear el registro de Strata.")?;
        let api_key = uuid::Uuid::new_v4().simple().to_string();
        let port = chosen.port.to_string();
        let mut command = Command::new(&python);
        command
            .creation_flags(0x0800_0000)
            .kill_on_drop(true)
            .current_dir(&dir)
            .arg(&server)
            .args(["--engine", "strata", "--config"])
            .arg(&config)
            .args(["--host", "127.0.0.1", "--port", &port, "--api-key", &api_key])
            .env("PYTHONUNBUFFERED", "1")
            .env_remove("STRATA_ENGINE_BACKEND")
            .stdin(Stdio::null())
            .stdout(Stdio::from(output))
            .stderr(Stdio::from(errors));
        if let Some((backend, _)) = card {
            command.env("STRATA_ENGINE_BACKEND", backend);
        }
        let child = command.spawn().map_err(|_| "No se pudo iniciar el servidor de Strata.")?;
        let job = reap_with_app(&child).ok_or("No se pudo atar Strata al editor.")?;
        let info = StrataRunning {
            setup: chosen.file,
            model: chosen.model,
            port: chosen.port,
            base_url: format!("http://127.0.0.1:{}/v1", chosen.port),
            api_key,
            gpu: card.map(|(_, name)| name.to_string()).unwrap_or_default(),
        };
        if let Ok(mut stopped) = STOPPED.lock() {
            *stopped = None;
        }
        *SERVER.lock().map_err(|_| "Strata no está disponible.")? = Some(Server {
            info: info.clone(),
            child,
            _job: job,
            log,
        });
        Ok(info)
    }

    pub fn stop() -> Result<(), String> {
        let server = SERVER.lock().map_err(|_| "Strata no está disponible.")?.take();
        if let Some(mut server) = server {
            let _ = server.child.start_kill();
            // Dropping the job ends the engine the server started, too.
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    pub async fn status() -> StrataStatus {
        StrataStatus { installed: false, engines: Vec::new(), setups: Vec::new(), running: None, ready: false, stopped: None }
    }

    pub async fn start(_: AppHandle, _: String, _: Option<String>) -> Result<StrataRunning, String> {
        Err("Iniciar Strata desde el editor está disponible en Windows.".into())
    }

    pub fn stop() -> Result<(), String> {
        Ok(())
    }
}

/// Whether Strata is installed, its model setups, and the server the editor runs.
#[tauri::command]
pub async fn strata_status(window: WebviewWindow) -> Result<StrataStatus, String> {
    require_main(&window)?;
    Ok(platform::status().await)
}

/// Starts Strata's server with one of its model setups, on the `amd` or
/// `nvidia` card (AMD when its engine is installed and none is named); it
/// loads the model in the background.
#[tauri::command]
pub async fn strata_start(
    app: AppHandle,
    window: WebviewWindow,
    setup: String,
    gpu: Option<String>,
) -> Result<StrataRunning, String> {
    require_main(&window)?;
    platform::start(app, setup, gpu).await
}

/// Stops the Strata server the editor started, and its engine.
#[tauri::command]
pub async fn strata_stop(window: WebviewWindow) -> Result<(), String> {
    require_main(&window)?;
    platform::stop()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rey30-strata-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_the_model_setups_made_in_strata() {
        let home = scratch("setups");
        let install = home.join("install");
        fs::create_dir_all(&install).unwrap();
        fs::write(install.join("strata-iq3_s.json"), r#"{"model_name": "qwen3.8-flash-next-iq3_s", "port": 8080}"#).unwrap();
        fs::write(install.join("strata-q4.json"), r#"{"port": 80}"#).unwrap();
        fs::write(install.join("strata-iq3_s.json.bak"), "{}").unwrap();
        fs::write(install.join("strata-roto.json"), "no es json").unwrap();
        fs::write(install.join("otro.json"), "{}").unwrap();
        let found: Vec<_> = setups(&home).into_iter().map(|(setup, _)| setup).collect();
        assert_eq!(
            found,
            [
                StrataSetup { file: "strata-iq3_s.json".into(), model: "qwen3.8-flash-next-iq3_s".into(), port: 8080 },
                StrataSetup { file: "strata-q4.json".into(), model: "q4".into(), port: DEFAULT_PORT },
            ]
        );
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn prefers_the_amd_card_when_its_engine_is_installed() {
        let cuda = "0.1.60-windows-x86_64-cuda-cuda13".to_string();
        let hip = "0.1.65-windows-x86_64-hip-rx9070".to_string();
        let both = [cuda.clone(), hip.clone()];
        assert_eq!(backend_for(None, &both).unwrap(), Some(("hip", "amd")));
        assert_eq!(backend_for(Some("nvidia"), &both).unwrap(), Some(("cuda", "nvidia")));
        assert_eq!(backend_for(None, std::slice::from_ref(&cuda)).unwrap(), None);
        assert!(backend_for(Some("amd"), &[cuda]).is_err());
        assert_eq!(backend_for(Some("amd"), std::slice::from_ref(&hip)).unwrap(), Some(("hip", "amd")));
        assert!(backend_for(Some("intel"), &[hip]).is_err());
    }

    #[test]
    fn uses_the_control_component_strata_marks_active() {
        let home = scratch("control");
        let base = home.join("components").join("control");
        let version = base.join("0.1.60.1");
        fs::create_dir_all(version.join("python")).unwrap();
        fs::create_dir_all(version.join("serve")).unwrap();
        fs::write(version.join("python").join("python.exe"), "").unwrap();
        fs::write(version.join("serve").join("server.py"), "").unwrap();
        fs::write(base.join("active.json"), r#"{"folder": "0.1.60.1"}"#).unwrap();
        let (python, server, dir) = control(&home).unwrap();
        assert!(python.ends_with("python.exe") && server.ends_with("server.py") && dir.ends_with("0.1.60.1"));
        fs::write(base.join("active.json"), r#"{"folder": "..\\..\\otro"}"#).unwrap();
        assert!(control(&home).is_none());
        fs::create_dir_all(home.join("components").join("engine").join("0.1.60-windows-x86_64-hip-rx9070")).unwrap();
        assert_eq!(engines(&home), ["0.1.60-windows-x86_64-hip-rx9070"]);
        fs::remove_dir_all(home).unwrap();
    }
}
