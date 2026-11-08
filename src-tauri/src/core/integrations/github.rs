//! Optional GitHub access through the installed GitHub CLI. Credentials stay
//! with gh; this module never reads a token or a repository's executable code.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};

const JSON_LIMIT: usize = 4 * 1024 * 1024;
const ARCHIVE_LIMIT: usize = 32 * 1024 * 1024;
const EXPANDED_LIMIT: u64 = 128 * 1024 * 1024;
const FILE_LIMIT: u64 = 16 * 1024 * 1024;
const GLOBAL_PAX_LIMIT: u64 = 16 * 1024;
const ENTRY_LIMIT: usize = 10_000;
const LOGIN_LIMIT: usize = 32 * 1024;
const LOGIN_TIMEOUT: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    pub available: bool,
    pub authenticated: bool,
    pub login: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubLogin {
    pub id: String,
    pub status: String,
    pub code: Option<String>,
    pub url: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub full_name: String,
    pub description: String,
    pub private: bool,
    pub default_branch: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoPage {
    pub repos: Vec<Repo>,
    pub page: u32,
    pub has_more: bool,
}

#[derive(Clone, Debug)]
pub struct RepositorySnapshot {
    pub root: PathBuf,
    pub repository: String,
    pub sha: String,
}

fn executable() -> Option<PathBuf> {
    let file = if cfg!(windows) { "gh.exe" } else { "gh" };
    std::env::split_paths(&std::env::var_os("PATH")?)
        .filter(|directory| directory.is_absolute())
        .map(|directory| directory.join(file))
        .find(|candidate| candidate.is_file())
        .and_then(|candidate| candidate.canonicalize().ok())
}

fn command(program: &Path, arguments: &[&str]) -> Command {
    let mut child = Command::new(program);
    child.args(arguments).env_clear();
    // Retain gh's own config location and normal OS/proxy support, without
    // forwarding model-provider keys, debug HTTP logging, or token overrides.
    for key in [
        "PATH",
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "XDG_CONFIG_HOME",
        "SYSTEMROOT",
        "WINDIR",
        "SYSTEMDRIVE",
        "TEMP",
        "TMP",
        "TMPDIR",
        "COMSPEC",
        "PATHEXT",
        "LANG",
        "LC_ALL",
        "GH_CONFIG_DIR",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "no_proxy",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
    ] {
        if let Some(value) = std::env::var_os(key) {
            child.env(key, value);
        }
    }
    child
        .env("GH_HOST", "github.com")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("GH_NO_EXTENSION_UPDATE_NOTIFIER", "1")
        .env("GH_TELEMETRY", "false")
        .env("NO_COLOR", "1")
        .env("CLICOLOR", "0")
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        child.creation_flags(0x0800_0000);
    }
    child
}

async fn read_bounded<R: AsyncRead + Unpin>(
    mut stream: R,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let count = stream
            .read(&mut buffer)
            .await
            .map_err(|_| "No se pudo leer GitHub CLI")?;
        if count == 0 {
            break;
        }
        if bytes.len() + count > limit {
            return Err("La respuesta de GitHub supera el límite permitido".into());
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    Ok(bytes)
}

struct Captured {
    success: bool,
    stdout: Vec<u8>,
}

async fn run(arguments: &[&str], timeout: Duration, limit: usize) -> Result<Captured, String> {
    let program = executable().ok_or("GitHub CLI (gh) no está instalado o no está en PATH")?;
    let mut child = command(&program, arguments)
        .spawn()
        .map_err(|_| "No se pudo iniciar GitHub CLI")?;
    let stdout = child.stdout.take().ok_or("GitHub CLI no abrió su salida")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("GitHub CLI no abrió su salida de errores")?;
    let work = async {
        tokio::try_join!(
            async {
                child
                    .wait()
                    .await
                    .map_err(|_| "No se pudo esperar a GitHub CLI".to_string())
            },
            read_bounded(stdout, limit),
            read_bounded(stderr, 16 * 1024),
        )
    };
    match tokio::time::timeout(timeout, work).await {
        Ok(Ok((exit, stdout, _))) => Ok(Captured {
            success: exit.success(),
            stdout,
        }),
        Ok(Err(error)) => {
            let _ = child.kill().await;
            Err(error)
        }
        Err(_) => {
            let _ = child.kill().await;
            Err("GitHub CLI agotó el tiempo de espera".into())
        }
    }
}

pub async fn status() -> Result<GithubStatus, String> {
    if executable().is_none() {
        return Ok(GithubStatus { available: false, authenticated: false, login: None,
            message: Some("Instala GitHub CLI (gh) para conectar una cuenta. La aplicación sigue disponible sin conexión a GitHub.".into()) });
    }
    // jq executes inside gh: token fields, including masked tokens, never
    // cross this process boundary.
    let output = run(
        &[
            "auth",
            "status",
            "--active",
            "--hostname",
            "github.com",
            "--json",
            "hosts",
            "--jq",
            "[.hosts[][] | {login: .login, state: .state, active: .active}]",
        ],
        Duration::from_secs(20),
        JSON_LIMIT,
    )
    .await?;
    if !output.success {
        return Ok(GithubStatus {
            available: true,
            authenticated: false,
            login: None,
            message: Some("GitHub CLI no tiene una sesión disponible para github.com.".into()),
        });
    }
    status_from_json(&output.stdout)
}

fn status_from_json(bytes: &[u8]) -> Result<GithubStatus, String> {
    let accounts: Vec<serde_json::Value> = serde_json::from_slice(bytes)
        .map_err(|_| "GitHub CLI devolvió un estado de sesión no compatible")?;
    let active = accounts.iter().find(|account| account["active"] == true);
    let login = active
        .and_then(|account| account["login"].as_str())
        .filter(|name| valid_owner(name))
        .map(str::to_owned);
    let authenticated =
        active.is_some_and(|account| account["state"] == "success") && login.is_some();
    Ok(GithubStatus {
        available: true,
        authenticated,
        login,
        message: (!authenticated).then(|| {
            "Conecta una cuenta de GitHub CLI o revisa su sesión con gh auth status.".into()
        }),
    })
}

struct LoginSession {
    state: Arc<Mutex<GithubLogin>>,
    cancel: Option<oneshot::Sender<()>>,
    started: Instant,
}

fn sessions() -> &'static Mutex<HashMap<String, LoginSession>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, LoginSession>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub async fn login() -> Result<GithubLogin, String> {
    let existing = status().await?;
    let id = uuid::Uuid::new_v4().to_string();
    if existing.authenticated {
        return Ok(GithubLogin {
            id,
            status: "complete".into(),
            code: None,
            url: None,
            message: Some(format!(
                "Se utiliza la sesión existente de {}.",
                existing.login.unwrap_or_default()
            )),
        });
    }
    if !existing.available {
        return Err("Instala GitHub CLI (gh) antes de conectar GitHub".into());
    }
    if existing.login.is_some() {
        return Err("GitHub CLI ya tiene una cuenta configurada con un problema de sesión. Revisa gh auth status; no se cambió la cuenta activa.".into());
    }
    let mut map = sessions().lock().await;
    map.retain(|_, session| session.started.elapsed() < LOGIN_TIMEOUT + Duration::from_secs(60));
    for session in map.values() {
        let state = session.state.lock().await;
        if state.status == "pending" {
            return Ok(state.clone());
        }
    }
    let state = Arc::new(Mutex::new(GithubLogin {
        id: id.clone(),
        status: "pending".into(),
        code: None,
        url: Some("https://github.com/login/device".into()),
        message: Some("Esperando autorización en GitHub.".into()),
    }));
    let (sender, receiver) = oneshot::channel();
    map.insert(
        id.clone(),
        LoginSession {
            state: state.clone(),
            cancel: Some(sender),
            started: Instant::now(),
        },
    );
    drop(map);
    let background_state = state.clone();
    tokio::spawn(async move {
        login_worker(background_state, receiver).await;
    });
    tokio::time::sleep(Duration::from_millis(150)).await;
    let result = state.lock().await.clone();
    Ok(result)
}

async fn login_stream<R: AsyncRead + Unpin>(
    mut stream: R,
    state: Arc<Mutex<GithubLogin>>,
) -> Result<(), String> {
    let mut retained = Vec::new();
    let mut buffer = [0u8; 1024];
    loop {
        let count = stream
            .read(&mut buffer)
            .await
            .map_err(|_| "No se pudo leer la autorización de GitHub")?;
        if count == 0 {
            return Ok(());
        }
        if retained.len() + count > LOGIN_LIMIT {
            return Err("La autorización excedió su límite de salida".into());
        }
        retained.extend_from_slice(&buffer[..count]);
        if let Some(code) = device_code(&String::from_utf8_lossy(&retained)) {
            let mut state = state.lock().await;
            if state.status == "pending" {
                state.code = Some(code);
            }
        }
    }
}

fn device_code(text: &str) -> Option<String> {
    text.split(|character: char| {
        !(character.is_ascii_uppercase() || character.is_ascii_digit() || character == '-')
    })
    .find(|word| {
        word.len() == 9
            && word.as_bytes()[4] == b'-'
            && word.bytes().enumerate().all(|(index, byte)| {
                index == 4 || byte.is_ascii_uppercase() || byte.is_ascii_digit()
            })
    })
    .map(str::to_owned)
}

async fn login_worker(state: Arc<Mutex<GithubLogin>>, mut cancel: oneshot::Receiver<()>) {
    let result = async {
        let program = executable().ok_or("GitHub CLI ya no está disponible")?;
        let mut child = command(&program, &["auth", "login", "--hostname", "github.com", "--web", "--skip-ssh-key"])
            .stdin(Stdio::piped()).spawn().map_err(|_| "No se pudo iniciar la autorización de GitHub")?;
        if let Some(mut input) = child.stdin.take() { let _ = input.write_all(b"\n").await; }
        let stdout = child.stdout.take().ok_or("La autorización no abrió su salida")?;
        let stderr = child.stderr.take().ok_or("La autorización no abrió su salida de errores")?;
        let work = async {
            tokio::try_join!(
                async { child.wait().await.map_err(|_| "No se pudo esperar la autorización".to_string()) },
                login_stream(stdout, state.clone()), login_stream(stderr, state.clone()),
            )
        };
        let outcome = tokio::select! {
            _ = &mut cancel => Err("cancelled".to_string()),
            result = tokio::time::timeout(LOGIN_TIMEOUT, work) => match result {
                Ok(Ok((exit, _, _))) if exit.success() => Ok(()),
                Ok(Ok(_)) => Err("GitHub no completó la autorización. Puedes volver a conectar.".into()),
                Ok(Err(error)) => Err(error),
                Err(_) => Err("La autorización de GitHub agotó su tiempo de espera.".into()),
            }
        };
        if outcome.is_err() { let _ = child.kill().await; }
        outcome
    }.await;
    let mut final_state = state.lock().await;
    final_state.code = None;
    final_state.url = None;
    if final_state.status == "cancelled" {
        return;
    }
    match result {
        Ok(()) => {
            final_state.status = "complete".into();
            final_state.message = Some("GitHub conectado mediante GitHub CLI.".into());
        }
        Err(error) if error == "cancelled" => {
            final_state.status = "cancelled".into();
            final_state.message = Some("Autorización cancelada.".into());
        }
        Err(error) => {
            final_state.status = "error".into();
            final_state.message = Some(error);
        }
    }
}

pub async fn poll(session_id: &str) -> Result<GithubLogin, String> {
    let state = sessions()
        .lock()
        .await
        .get(session_id)
        .map(|session| session.state.clone())
        .ok_or("La sesión de autorización ya no está disponible")?;
    let result = state.lock().await.clone();
    Ok(result)
}

pub async fn cancel(session_id: &str) -> Result<(), String> {
    let mut map = sessions().lock().await;
    let Some(session) = map.get_mut(session_id) else {
        return Ok(());
    };
    let mut state = session.state.lock().await;
    if state.status == "pending" {
        state.status = "cancelled".into();
        state.code = None;
        state.url = None;
        state.message = Some("Autorización cancelada.".into());
        if let Some(sender) = session.cancel.take() {
            let _ = sender.send(());
        }
    }
    Ok(())
}

fn valid_owner(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        && !value.starts_with('-')
        && !value.ends_with('-')
}

pub fn validate_repository(repository: &str) -> Result<String, String> {
    let repository = repository.trim();
    let parts: Vec<_> = repository.split('/').collect();
    if parts.len() != 2
        || !valid_owner(parts[0])
        || parts[1].is_empty()
        || parts[1].len() > 100
        || parts[1] == "."
        || parts[1] == ".."
        || !parts[1]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(
            "El repositorio debe tener el formato propietario/repositorio de GitHub".into(),
        );
    }
    Ok(repository.to_owned())
}

pub async fn repos(page: u32) -> Result<RepoPage, String> {
    if !(1..=10_000).contains(&page) {
        return Err("Página de repositorios no válida".into());
    }
    let endpoint = format!("/user/repos?per_page=100&page={page}&sort=updated&direction=desc&visibility=all&affiliation=owner,collaborator,organization_member");
    let result = run(
        &[
            "api",
            "--hostname",
            "github.com",
            "--method",
            "GET",
            &endpoint,
        ],
        Duration::from_secs(30),
        JSON_LIMIT,
    )
    .await?;
    if !result.success {
        return Err("No se pudieron listar los repositorios. Revisa la conexión y los permisos de GitHub CLI.".into());
    }
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&result.stdout)
        .map_err(|_| "GitHub devolvió una lista de repositorios no válida")?;
    let has_more = entries.len() == 100;
    let mut repositories = Vec::new();
    for entry in entries {
        let name = entry["full_name"]
            .as_str()
            .ok_or("Un repositorio de GitHub no tiene nombre")?;
        repositories.push(Repo {
            full_name: validate_repository(name)?,
            description: entry["description"].as_str().unwrap_or("").to_owned(),
            private: entry["private"]
                .as_bool()
                .ok_or("Un repositorio no indica su visibilidad")?,
            default_branch: entry["default_branch"].as_str().unwrap_or("").to_owned(),
        });
    }
    Ok(RepoPage {
        repos: repositories,
        page,
        has_more,
    })
}

fn reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn cache_directory(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || path.parent().is_none()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err("La caché de repositorios debe ser una carpeta absoluta".into());
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) if reparse(&metadata) || !metadata.is_dir() => {
                return Err("La caché no puede atravesar enlaces o archivos".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                fs::create_dir(&current)
                    .map_err(|_| "No se pudo crear la caché de repositorios")?;
            }
            Err(_) => return Err("No se pudo comprobar la caché de repositorios".into()),
        }
    }
    path.canonicalize()
        .map_err(|_| "No se pudo resolver la caché de repositorios".into())
}

pub async fn snapshot(repository: &str, cache_root: &Path) -> Result<RepositorySnapshot, String> {
    let repository = validate_repository(repository)?;
    let endpoint = format!("/repos/{repository}/commits?per_page=1");
    let revision = run(
        &[
            "api",
            "--hostname",
            "github.com",
            "--method",
            "GET",
            &endpoint,
            "--jq",
            ".[0].sha",
        ],
        Duration::from_secs(30),
        1024,
    )
    .await?;
    let sha = String::from_utf8(revision.stdout)
        .map_err(|_| "GitHub devolvió un commit no válido")?
        .trim()
        .to_owned();
    if !revision.success || sha.len() != 40 || !sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("No se pudo resolver un commit inmutable del repositorio".into());
    }
    let endpoint = format!("/repos/{repository}/tarball/{sha}");
    let archive = run(
        &[
            "api",
            "--hostname",
            "github.com",
            "--method",
            "GET",
            &endpoint,
        ],
        Duration::from_secs(120),
        ARCHIVE_LIMIT,
    )
    .await?;
    if !archive.success {
        return Err("No se pudo descargar el snapshot del repositorio".into());
    }
    let cache_root = cache_root.to_path_buf();
    let snapshot_name = format!("repo-{}-{}", &sha[..12], uuid::Uuid::new_v4());
    let root = tokio::task::spawn_blocking(move || {
        let cache = cache_directory(&cache_root)?;
        let stage = cache.join(format!(".snapshot-{}", uuid::Uuid::new_v4()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            fs::DirBuilder::new()
                .mode(0o700)
                .create(&stage)
                .map_err(|_| "No se pudo preparar el snapshot")?;
        }
        #[cfg(not(unix))]
        fs::create_dir(&stage).map_err(|_| "No se pudo preparar el snapshot")?;
        let result = extract_archive(&archive.stdout, &stage);
        if let Err(error) = result {
            // The stage is a generated direct child of the canonical cache.
            if stage
                .canonicalize()
                .is_ok_and(|resolved| resolved.parent() == Some(cache.as_path()))
            {
                let _ = fs::remove_dir_all(&stage);
            }
            return Err(error);
        }
        let destination = cache.join(snapshot_name);
        fs::rename(&stage, &destination).map_err(|_| "No se pudo publicar el snapshot completo")?;
        Ok(destination)
    })
    .await
    .map_err(|_| "Falló la inspección del snapshot")??;
    Ok(RepositorySnapshot {
        root,
        repository,
        sha,
    })
}

fn safe_parts(path: &Path) -> Result<Vec<String>, String> {
    if path.as_os_str().to_string_lossy().contains('\\') {
        return Err("El snapshot contiene separadores de ruta no permitidos.".into());
    }
    let mut parts = Vec::new();
    for component in path.components() {
        let Component::Normal(value) = component else {
            return Err("El archivo contiene una ruta fuera del repositorio".into());
        };
        let value = value
            .to_str()
            .ok_or("El archivo contiene un nombre no compatible")?;
        let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
        if value.contains(['\\', ':'])
            || value.ends_with(['.', ' '])
            || value.chars().any(char::is_control)
            || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        {
            return Err("El archivo contiene un nombre de ruta no seguro".into());
        }
        parts.push(value.to_owned());
    }
    if parts.is_empty() {
        return Err("El archivo contiene una ruta vacía".into());
    }
    Ok(parts)
}

fn extract_archive(bytes: &[u8], destination: &Path) -> Result<(), String> {
    let decoder = GzDecoder::new(Cursor::new(bytes)).take(EXPANDED_LIMIT + 16 * 1024 * 1024);
    let mut archive = tar::Archive::new(decoder);
    let mut prefix = None;
    let mut expanded = 0u64;
    let mut count = 0usize;
    for entry in archive
        .entries()
        .map_err(|_| "El snapshot no es un archivo tar.gz válido")?
    {
        let mut entry = entry.map_err(|_| "El snapshot está dañado")?;
        count += 1;
        if count > ENTRY_LIMIT {
            return Err("El repositorio contiene demasiados archivos".into());
        }
        let path = entry
            .path()
            .map_err(|_| "El snapshot contiene una ruta no válida")?;
        let parts = safe_parts(&path)?;
        let kind = entry.header().entry_type();
        if kind.is_pax_global_extensions() {
            let size = entry.size();
            if size > GLOBAL_PAX_LIMIT {
                return Err("Los metadatos PAX globales superan su límite permitido.".into());
            }
            expanded = expanded
                .checked_add(size)
                .ok_or("Tamaño de snapshot no válido")?;
            if expanded > EXPANDED_LIMIT {
                return Err("El snapshot excede el límite de expansión permitido".into());
            }
            let mut metadata = Vec::new();
            entry
                .read_to_end(&mut metadata)
                .map_err(|_| "Los metadatos PAX globales están incompletos.")?;
            let comment = metadata
                .strip_prefix(b"52 comment=")
                .and_then(|value| value.strip_suffix(b"\n"));
            if metadata.len() as u64 != size
                || !comment
                    .is_some_and(|sha| sha.len() == 40 && sha.iter().all(u8::is_ascii_hexdigit))
            {
                return Err("El snapshot contiene metadatos PAX globales no compatibles; solo se admite el comentario de commit de Git.".into());
            }
            // GitHub git archives precede their root with this inert commit
            // comment. It is never a filesystem entry or a path override.
            continue;
        }
        if prefix.as_ref().is_some_and(|root| root != &parts[0]) {
            return Err("El snapshot contiene más de una raíz".into());
        }
        prefix.get_or_insert_with(|| parts[0].clone());
        if !kind.is_dir() && !kind.is_file() {
            return Err("El snapshot contiene enlaces o archivos especiales; no se importó".into());
        }
        if parts.len() == 1 {
            if kind.is_dir() {
                continue;
            }
            return Err("El snapshot no contiene una carpeta raíz válida".into());
        }
        let relative: PathBuf = parts[1..].iter().collect();
        let output = destination.join(relative);
        if output.as_os_str().to_string_lossy().len() > 245 {
            return Err("El snapshot contiene rutas demasiado largas para este equipo".into());
        }
        if kind.is_dir() {
            fs::create_dir_all(&output).map_err(|_| "No se pudo crear una carpeta del snapshot")?;
            continue;
        }
        let size = entry.size();
        expanded = expanded
            .checked_add(size)
            .ok_or("Tamaño de snapshot no válido")?;
        if size > FILE_LIMIT || expanded > EXPANDED_LIMIT {
            return Err("El snapshot excede el límite de expansión permitido".into());
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|_| "No se pudo crear una carpeta del snapshot")?;
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output)
            .map_err(|_| "El snapshot contiene rutas duplicadas o no escribibles")?;
        let copied = io::copy(&mut entry, &mut file)
            .map_err(|_| "No se pudo copiar un archivo del snapshot")?;
        if copied != size {
            return Err("El snapshot está incompleto".into());
        }
        file.flush().map_err(|_| "No se pudo guardar el snapshot")?;
    }
    if count == 0 || prefix.is_none() {
        return Err("El snapshot está vacío".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archive(kind: tar::EntryType, path: &str, contents: &[u8]) -> Vec<u8> {
        archive_entries(&[(kind, path, contents)])
    }

    fn archive_entries(entries: &[(tar::EntryType, &str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for (kind, path, contents) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(*kind);
            header.set_size(contents.len() as u64);
            header.set_mode(0o600);
            if kind.is_symlink() || kind.is_hard_link() {
                header.set_link_name("../../outside").unwrap();
            }
            builder.append_data(&mut header, path, *contents).unwrap();
        }
        let bytes = builder.into_inner().unwrap();
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gzip.write_all(&bytes).unwrap();
        gzip.finish().unwrap()
    }

    #[test]
    fn repository_names_cannot_be_options_urls_or_api_paths() {
        assert_eq!(
            validate_repository("owner/repo-name.2").unwrap(),
            "owner/repo-name.2"
        );
        for input in [
            "--help",
            "https://github.com/a/b",
            "a/b/c",
            "a/..",
            "a/r?x=1",
            "a/r#tag",
            "a/r\\file",
        ] {
            assert!(validate_repository(input).is_err(), "{input}");
        }
    }

    #[test]
    fn archive_paths_reject_escape_and_windows_aliases() {
        for path in [
            "../outside",
            "/absolute",
            "root/../outside",
            "root/C:evil",
            "root/CON",
            "root/a\\b",
            "root/ends.",
        ] {
            assert!(safe_parts(Path::new(path)).is_err(), "{path}");
        }
    }

    #[test]
    fn extraction_copies_regular_files_and_refuses_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        extract_archive(
            &archive(
                tar::EntryType::Regular,
                "owner-repo-sha/skills/a/SKILL.md",
                b"safe",
            ),
            directory.path(),
        )
        .unwrap();
        assert_eq!(
            fs::read(directory.path().join("skills/a/SKILL.md")).unwrap(),
            b"safe"
        );
        let second = tempfile::tempdir().unwrap();
        assert!(extract_archive(
            &archive(tar::EntryType::Symlink, "root/link", b""),
            second.path()
        )
        .is_err());
        assert!(!second.path().join("link").exists());
    }

    #[test]
    fn auth_status_and_device_codes_do_not_expose_tokens() {
        let status =
            status_from_json(br#"[{"login":"owner","state":"success","active":true}]"#).unwrap();
        assert!(status.authenticated);
        assert_eq!(
            device_code("First copy your one-time code: ABCD-1234"),
            Some("ABCD-1234".into())
        );
        assert!(device_code("ghp_private_token_never_a_device_code").is_none());
        assert!(serde_json::to_string(&status)
            .unwrap()
            .contains("authenticated"));
    }

    #[tokio::test]
    async fn process_output_is_bounded() {
        assert_eq!(read_bounded(&b"abc"[..], 3).await.unwrap(), b"abc");
        assert!(read_bounded(&b"abcd"[..], 3).await.is_err());
    }

    #[tokio::test]
    async fn cancelled_login_never_reintroduces_a_device_code() {
        let state = Arc::new(Mutex::new(GithubLogin {
            id: "fixture".into(),
            status: "cancelled".into(),
            code: None,
            url: None,
            message: None,
        }));
        login_stream(
            &b"First copy your one-time code: ABCD-1234"[..],
            state.clone(),
        )
        .await
        .unwrap();
        assert!(state.lock().await.code.is_none());
    }

    #[test]
    fn github_global_pax_commit_comment_is_inert_before_repository_root() {
        let directory = tempfile::tempdir().unwrap();
        let archive = archive_entries(&[
            (
                tar::EntryType::XGlobalHeader,
                "pax_global_header",
                b"52 comment=0365454a573eb52c7089320fd74bfd4a673b78ae\n",
            ),
            (tar::EntryType::Regular, "owner-repo-sha/server.json", b"{}"),
        ]);
        extract_archive(&archive, directory.path()).unwrap();
        assert_eq!(
            fs::read(directory.path().join("server.json")).unwrap(),
            b"{}"
        );
        assert!(!directory.path().join("pax_global_header").exists());
    }

    #[test]
    fn global_pax_path_size_linkpath_and_special_payloads_remain_rejected() {
        let sha = b"52 comment=0365454a573eb52c7089320fd74bfd4a673b78ae\n";
        for contents in [
            b"20 path=../outside\n".as_slice(),
            b"25 linkpath=../../secret\n",
            b"13 size=9999\n",
            b"",
            b"52 comment=0365454a573eb52c7089320fd74bfd4a673b78ae\n\n13 size=9999\n",
        ] {
            let directory = tempfile::tempdir().unwrap();
            assert!(extract_archive(
                &archive_entries(&[
                    (tar::EntryType::XGlobalHeader, "pax_global_header", contents),
                    (tar::EntryType::Regular, "root/file", b"safe")
                ]),
                directory.path()
            )
            .is_err());
            assert!(!directory.path().join("file").exists());
        }
        let directory = tempfile::tempdir().unwrap();
        assert!(extract_archive(
            &archive(
                tar::EntryType::XGlobalHeader,
                "pax_global_header",
                &vec![b'x'; GLOBAL_PAX_LIMIT as usize + 1]
            ),
            directory.path()
        )
        .is_err());
        for kind in [
            tar::EntryType::Symlink,
            tar::EntryType::Link,
            tar::EntryType::Char,
            tar::EntryType::Block,
            tar::EntryType::Fifo,
        ] {
            let directory = tempfile::tempdir().unwrap();
            assert!(extract_archive(
                &archive_entries(&[
                    (tar::EntryType::XGlobalHeader, "pax_global_header", sha),
                    (kind, "root/special", b"")
                ]),
                directory.path()
            )
            .is_err());
            assert!(!directory.path().join("special").exists());
        }
    }

    #[test]
    #[ignore = "Requires an explicitly supplied downloaded GitHub archive; no network or code execution"]
    fn inspect_explicit_local_github_archive_without_executing_repository() {
        let path = PathBuf::from(
            std::env::var_os("REY30_GITHUB_TEST_ARCHIVE")
                .expect("Provide an absolute path in REY30_GITHUB_TEST_ARCHIVE"),
        );
        assert!(path.is_absolute());
        let metadata = fs::metadata(&path).unwrap();
        assert!(metadata.is_file() && metadata.len() <= ARCHIVE_LIMIT as u64);
        let directory = tempfile::tempdir().unwrap();
        extract_archive(&fs::read(&path).unwrap(), directory.path()).unwrap();
        assert!(
            directory.path().join("server.json").is_file(),
            "The selected fixture must expose the repository's server.json"
        );
    }
}
