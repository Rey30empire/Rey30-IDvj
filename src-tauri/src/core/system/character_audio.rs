use base64::Engine;
use serde_json::{json, Value};
#[cfg(windows)]
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
#[cfg(windows)]
use tauri::Manager;
#[cfg(windows)]
use tokio::io::AsyncWriteExt;
use tokio::sync::oneshot;

type AudioJob = Option<(String, u64, oneshot::Sender<()>)>;
static AUDIO_JOB: LazyLock<Mutex<AudioJob>> = LazyLock::new(|| Mutex::new(None));
#[cfg(windows)]
static AUDIO_SEQUENCE: AtomicU64 = AtomicU64::new(0);
#[cfg(windows)]
const SCRIPT: &str = include_str!("character_audio.ps1");

#[cfg(any(windows, test))]
async fn read_bounded(
    reader: impl tokio::io::AsyncRead + Unpin,
    limit: usize,
) -> std::io::Result<Vec<u8>> {
    use tokio::io::AsyncReadExt;
    let mut bytes = Vec::new();
    reader
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .await?;
    if bytes.len() > limit {
        return Err(std::io::Error::other(
            "La salida de audio excedió su límite.",
        ));
    }
    Ok(bytes)
}

fn validate_job_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 80 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("El identificador de audio no es válido.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn character_audio_cancel(job_id: String) -> Result<(), String> {
    validate_job_id(&job_id)?;
    let mut current = AUDIO_JOB
        .lock()
        .map_err(|_| "No se pudo detener el audio.")?;
    if current.as_ref().is_some_and(|(id, _, _)| id == &job_id) {
        if let Some((_, _, cancel)) = current.take() {
            let _ = cancel.send(());
        }
    }
    Ok(())
}

#[cfg(windows)]
async fn execute(
    app: tauri::AppHandle,
    job_id: String,
    mut request: Value,
) -> Result<Value, String> {
    use std::process::Stdio;
    validate_job_id(&job_id)?;
    let root = app
        .path()
        .resource_dir()
        .map_err(|_| "No se encontraron los recursos de audio.")?
        .join("resources")
        .join("character-audio");
    request["resourceDir"] = json!(root);
    let windows = std::env::var_os("SystemRoot").ok_or("No se encontró Windows PowerShell.")?;
    let program =
        std::path::PathBuf::from(windows).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let encoded = base64::engine::general_purpose::STANDARD.encode(
        SCRIPT
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let (cancel, cancelled) = oneshot::channel();
    let serial = AUDIO_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let tracked = request["operation"] != "catalog";
    let _catalog_cancel = if tracked {
        let mut current = AUDIO_JOB
            .lock()
            .map_err(|_| "El servicio de audio está ocupado.")?;
        if let Some((_, _, previous)) = current.replace((job_id.clone(), serial, cancel)) {
            let _ = previous.send(());
        }
        None
    } else {
        Some(cancel)
    };
    let operation = async {
        let mut command = tokio::process::Command::new(program);
        command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                &encoded,
            ])
            .creation_flags(0x08000000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|_| "No se pudo iniciar el audio local de Windows.")?;
        let mut input = child
            .stdin
            .take()
            .ok_or("No se pudo preparar el audio local.")?;
        input
            .write_all(
                serde_json::to_string(&request)
                    .map_err(|_| "Petición de audio no válida.")?
                    .as_bytes(),
            )
            .await
            .map_err(|_| "No se pudo preparar el audio local.")?;
        drop(input);
        let stdout = child
            .stdout
            .take()
            .ok_or("No se pudo leer el audio local.")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("No se pudo leer el estado de audio.")?;
        let (status, stdout, _) = tokio::try_join!(
            child.wait(),
            read_bounded(stdout, 24 * 1024 * 1024),
            read_bounded(stderr, 64 * 1024)
        )
        .map_err(|_| "El audio local se interrumpió o excedió sus límites.")?;
        if !status.success() {
            return Err(
                "No se pudo generar o reconocer el audio local. Revisa los recursos instalados."
                    .into(),
            );
        }
        let result: Value = serde_json::from_slice(&stdout)
            .map_err(|_| "El motor de audio no devolvió una respuesta válida.")?;
        if let Some(error) = result.get("error").and_then(Value::as_str) {
            return Err(error.to_owned());
        }
        Ok(result)
    };
    let result = tokio::select! {
        output = tokio::time::timeout(std::time::Duration::from_secs(60), operation) => output.unwrap_or_else(|_| Err("El audio local superó el tiempo de espera.".into())),
        _ = cancelled => Err("Audio cancelado.".into()),
    };
    if let Ok(mut current) = AUDIO_JOB.lock() {
        if current
            .as_ref()
            .is_some_and(|(id, token, _)| id == &job_id && *token == serial)
        {
            current.take();
        }
    }
    result
}

#[cfg(not(windows))]
async fn execute(_app: tauri::AppHandle, job_id: String, _request: Value) -> Result<Value, String> {
    validate_job_id(&job_id)?;
    Err(
        "Esta distribución ofrece audio local de personajes en Windows. El chat sigue disponible."
            .into(),
    )
}

#[tauri::command]
pub async fn character_audio_capabilities(
    app: tauri::AppHandle,
    job_id: String,
) -> Result<Value, String> {
    execute(app, job_id, json!({"operation":"catalog"})).await
}

#[tauri::command]
pub async fn character_audio_synthesize(
    app: tauri::AppHandle,
    job_id: String,
    text: String,
    voice_id: String,
    rate: f32,
    pitch: f32,
    volume: f32,
) -> Result<Value, String> {
    validate_synthesis(&text, &voice_id, rate, pitch, volume)?;
    execute(app, job_id, json!({"operation":"synthesize","text":text,"voiceId":voice_id,"rate":rate,"pitch":pitch,"volume":volume})).await
}

fn validate_synthesis(
    text: &str,
    voice: &str,
    rate: f32,
    pitch: f32,
    volume: f32,
) -> Result<(), String> {
    if text.trim().is_empty() || text.chars().count() > 4000 || text.contains('\0') {
        return Err("El texto de voz debe contener entre 1 y 4000 caracteres.".into());
    }
    if voice.is_empty()
        || voice.len() > 256
        || voice.contains(['\0', '\r', '\n'])
        || !(voice.starts_with("espeak:") || voice.starts_with("windows:"))
    {
        return Err("Selecciona una voz del catálogo local.".into());
    }
    if !rate.is_finite()
        || !(0.5..=1.8).contains(&rate)
        || !pitch.is_finite()
        || !(0.5..=2.0).contains(&pitch)
        || !volume.is_finite()
        || !(0.0..=1.0).contains(&volume)
    {
        return Err("Los parámetros de voz están fuera de rango.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn character_audio_transcribe(
    app: tauri::AppHandle,
    job_id: String,
    pcm_base64: String,
) -> Result<Value, String> {
    if pcm_base64.len() > 1_300_000 {
        return Err("El dictado admite hasta 30 segundos.".into());
    }
    let pcm = base64::engine::general_purpose::STANDARD
        .decode(&pcm_base64)
        .map_err(|_| "El audio de dictado no es válido.")?;
    if pcm.is_empty() || pcm.len() > 960_000 || pcm.len() % 2 != 0 {
        return Err("Se necesita PCM mono de 16 kHz y 16 bits, de hasta 30 segundos.".into());
    }
    execute(
        app,
        job_id,
        json!({"operation":"transcribe","pcmBase64":pcm_base64}),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn subprocess_output_is_bounded_while_reading() {
        assert_eq!(read_bounded(&b"ok"[..], 2).await.unwrap(), b"ok");
        assert!(read_bounded(&b"oversized"[..], 3).await.is_err());
    }
    #[test]
    fn synthesis_rejects_invalid_or_unbounded_input() {
        assert!(validate_synthesis("hola", "espeak:es+m1", 1., 1., 0.8).is_ok());
        for text in ["".to_owned(), "x".repeat(4001), "hola\0".to_owned()] {
            assert!(validate_synthesis(&text, "espeak:es+m1", 1., 1., 1.).is_err());
        }
        assert!(validate_synthesis("hola", "https://voice", 1., 1., 1.).is_err());
        assert!(validate_synthesis("hola", "espeak:es+m1", f32::NAN, 1., 1.).is_err());
        assert!(validate_synthesis("hola", "espeak:es+m1", 1., 3., 1.).is_err());
    }
    #[test]
    fn cancel_is_scoped_to_job() {
        assert!(validate_job_id("../job").is_err());
        assert!(character_audio_cancel("owned-audio-job".into()).is_ok());
    }
}
