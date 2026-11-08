use super::pluma_realtime::windows::{amd_device, engine_path, reap_with_app};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{fs, io, path::PathBuf, process::Stdio, time::Duration};
use tauri::{ipc::Channel, AppHandle, Manager};
use tokio::{io::AsyncWriteExt, process::Command};
use uuid::Uuid;

/// ACE-Step's folder under the shared models root.
fn ace_step_dir() -> PathBuf {
    super::models_root::models_root()
        .join("Musica")
        .join("ACE-Step-1.5")
}

fn runtime() -> PathBuf {
    ace_step_dir().join("runtime").join("ace-synth.exe")
}

fn language_runtime() -> PathBuf {
    ace_step_dir().join("runtime").join("ace-lm.exe")
}

fn model_dir() -> PathBuf {
    ace_step_dir().join("models")
}

const MODEL_FILES: [&str; 4] = [
    "acestep-v15-turbo-Q8_0.gguf",
    "Qwen3-Embedding-0.6B-Q8_0.gguf",
    "vae-BF16.gguf",
    "acestep-5Hz-lm-1.7B-Q8_0.gguf",
];
const DEFAULT_CAPTION: &str = "A cappella female voice, no instruments, Spanish folk pop melody";
/// A full song, like a normal one: about a minute and a half.
const SONG_SECONDS: u32 = 90;
/// 150 s of 48 kHz stereo 16-bit audio, the longest song the generator makes.
const MAX_WAV_BYTES: u64 = 32 * 1024 * 1024;
const PCM_PACKET_BYTES: usize = 6_000;

fn runner(app: &AppHandle) -> Option<PathBuf> {
    let root = app.path().resource_dir().ok()?;
    [
        root.join("resources/pluma-music/generate.ps1"),
        root.join("pluma-music/generate.ps1"),
    ]
    .into_iter()
    .find(|file| file.is_file())
}

pub(super) fn available(app: &AppHandle) -> bool {
    local_assets() && runner(app).is_some()
}

fn local_assets() -> bool {
    let models = model_dir();
    runtime().is_file()
        && language_runtime().is_file()
        && MODEL_FILES.iter().all(|name| models.join(name).is_file())
}

struct SongDirectory(PathBuf);

impl SongDirectory {
    fn create() -> io::Result<Self> {
        let path = std::env::temp_dir().join(format!("rey30-pluma-song-{}", Uuid::new_v4()));
        fs::create_dir(&path)?;
        Ok(Self(path))
    }
}

impl Drop for SongDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(super) async fn sing(
    app: &AppHandle,
    lyrics: &str,
    style: &str,
    events: Channel<Value>,
) -> Result<(), String> {
    let (lyrics, style) = (lyrics.trim(), style.trim());
    if lyrics.is_empty() || lyrics.chars().count() > 1200 || style.chars().count() > 240 {
        return Err("La letra o el estilo de la canción excede el límite.".into());
    }
    let script = runner(app)
        .filter(|_| local_assets())
        .ok_or("El generador local de canciones de Pluma todavía no está disponible.")?;
    let device = amd_device(&engine_path(app)?).await?;
    let directory =
        SongDirectory::create().map_err(|_| "No se pudo preparar el audio de la canción.")?;
    // Sing with the cloned voice: ACE-Step takes its timbre from the same
    // sample Pluma speaks with. Without a sample she sings with ACE's own voice.
    let reference = super::pluma_clone::song_voice_reference(app).and_then(|(audio, format)| {
        let path = directory.0.join(format!("voz-referencia.{format}"));
        fs::write(&path, audio).ok().map(|_| path)
    });
    let mut command = Command::new("powershell.exe");
    command
        .creation_flags(0x0800_0000)
        .kill_on_drop(true)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(script)
        .arg("-OutputDirectory")
        .arg(&directory.0)
        .arg("-Device")
        .arg(device)
        .arg("-EngineRoot")
        .arg(ace_step_dir());
    // Script parameters go after `-File <script>`; before it PowerShell
    // would read them as its own options.
    if let Some(reference) = &reference {
        command.arg("-ReferenceAudio").arg(reference);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "No se pudo iniciar el generador local de canciones.")?;
    let _job = reap_with_app(&child).ok_or("No se pudo aislar el generador de canciones.")?;
    let seed = (Uuid::new_v4().as_u128() as u32) & 0x7fff_ffff;
    let request = json!({
        "caption": if style.is_empty() { DEFAULT_CAPTION } else { style },
        "lyrics": lyrics,
        "seconds": SONG_SECONDS,
        "seed": seed,
    });
    let mut input = child.stdin.take().ok_or("No se pudo enviar la letra.")?;
    input
        .write_all(request.to_string().as_bytes())
        .await
        .map_err(|_| "No se pudo enviar la letra.")?;
    drop(input);
    let status = tokio::time::timeout(Duration::from_secs(360), child.wait())
        .await
        .map_err(|_| "La canción tardó demasiado en generarse.")?
        .map_err(|_| "El generador local de canciones se detuvo.")?;
    if !status.success() {
        return Err("El generador local no pudo crear la canción.".into());
    }
    let path = directory.0.join("cancion.wav");
    let size = fs::metadata(&path)
        .map_err(|_| "La canción no produjo un archivo de audio.")?
        .len();
    if size > MAX_WAV_BYTES {
        return Err("El audio de la canción excede el tamaño permitido.".into());
    }
    let wav = tokio::fs::read(path)
        .await
        .map_err(|_| "No se pudo leer el audio de la canción.")?;
    let (sample_rate, pcm) =
        decode_wav(&wav).ok_or("El generador devolvió un formato de audio incompatible.")?;
    for (index, frame) in pcm.chunks(PCM_PACKET_BYTES).enumerate() {
        events
            .send(json!({"data": STANDARD.encode(frame), "sampleRate": sample_rate}))
            .map_err(|_| "La llamada se cerró antes de reproducir la canción.")?;
        if index % 16 == 15 {
            tokio::task::yield_now().await;
        }
    }
    events
        .send(json!({"done": true}))
        .map_err(|_| "La llamada se cerró.".into())
}

fn decode_wav(wav: &[u8]) -> Option<(u32, Vec<u8>)> {
    if wav.get(..4)? != b"RIFF" || wav.get(8..12)? != b"WAVE" {
        return None;
    }
    fn u16_at(bytes: &[u8], offset: usize) -> Option<u16> {
        Some(u16::from_le_bytes(
            bytes.get(offset..offset + 2)?.try_into().ok()?,
        ))
    }
    fn u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
        Some(u32::from_le_bytes(
            bytes.get(offset..offset + 4)?.try_into().ok()?,
        ))
    }

    let (mut format, mut data) = (None, None);
    let mut offset = 12;
    while offset + 8 <= wav.len() {
        let size = u32_at(wav, offset + 4)? as usize;
        let end = (offset + 8).checked_add(size)?;
        let chunk = wav.get(offset + 8..end)?;
        match &wav[offset..offset + 4] {
            b"fmt " => format = Some(chunk),
            b"data" => data = Some(chunk),
            _ => {}
        }
        if format.is_some() && data.is_some() {
            break;
        }
        offset = end.checked_add(size % 2)?;
    }
    let (format, data) = (format?, data?);
    let encoding = match u16_at(format, 0)? {
        0xfffe => u16_at(format, 24)?,
        other => other,
    };
    let channels = u16_at(format, 2)? as usize;
    let rate = u32_at(format, 4)?;
    let bytes = match (encoding, u16_at(format, 14)?) {
        (1, 16) => 2,
        (3, 32) => 4,
        _ => return None,
    };
    if !(1..=2).contains(&channels) || !(8000..=48000).contains(&rate) {
        return None;
    }
    let block = channels * bytes;
    if u16_at(format, 12)? as usize != block || data.len() % block != 0 {
        return None;
    }
    let frames = data.len() / block;
    if frames < rate as usize || frames > rate as usize * 40 {
        return None;
    }
    let mut pcm = Vec::with_capacity(frames * 4);
    for frame in data.chunks_exact(block) {
        let mut value = 0.0;
        for sample in frame.chunks_exact(bytes) {
            value += if bytes == 2 {
                i16::from_le_bytes(sample.try_into().ok()?) as f32 / 32768.0
            } else {
                f32::from_le_bytes(sample.try_into().ok()?)
            };
        }
        if !value.is_finite() {
            return None;
        }
        pcm.extend_from_slice(&(value / channels as f32).clamp(-1.0, 1.0).to_le_bytes());
    }
    Some((rate, pcm))
}
