//! Speech recognition with Whisper: whisper.cpp's server (large-v3-turbo,
//! quantized, on the CPU) started on first use and kept until the app closes.
//! It writes what the person said in calls and dictation; the small Vosk model
//! stays as the fallback when Whisper is missing or fails.
#![cfg_attr(not(windows), allow(dead_code))]

const SAMPLE_RATE: u32 = 16_000;
const MODEL: &str = "ggml-large-v3-turbo-q5_0.bin";
/// Names Whisper should spell right; it continues the prompt's spelling.
const PROMPT: &str = "Conversación en español con Pluma. Nombres: Pluma, Plumita, Beto, Coder, Strata, Lore, Gemma, Qwen.";

/// Lines Whisper writes over silence or noise, learnt from subtitled videos.
/// Compared without case, accents or punctuation.
const HALLUCINATIONS: [&str; 9] = [
    "gracias por ver el video",
    "gracias por ver",
    "gracias por ver el video hasta la proxima",
    "subtitulos realizados por la comunidad de amaraorg",
    "subtitulado por la comunidad de amaraorg",
    "suscribete",
    "suscribete al canal",
    "no olvides suscribirte",
    "hasta el proximo video",
];

fn comparable(text: &str) -> String {
    text.chars()
        .filter_map(|c| match c {
            'á' | 'Á' => Some('a'),
            'é' | 'É' => Some('e'),
            'í' | 'Í' => Some('i'),
            'ó' | 'Ó' => Some('o'),
            'ú' | 'Ú' | 'ü' | 'Ü' => Some('u'),
            'ñ' | 'Ñ' => Some('n'),
            c if c.is_alphanumeric() => Some(c.to_ascii_lowercase()),
            c if c.is_whitespace() => Some(' '),
            _ => None,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whisper's text as the app uses it: trimmed, and empty when it is only
/// punctuation or one of the lines it invents over silence.
pub(crate) fn clean_transcript(text: &str) -> String {
    let text = text.trim();
    let words = comparable(text);
    if words.is_empty() || HALLUCINATIONS.contains(&words.as_str()) {
        return String::new();
    }
    text.to_string()
}

/// The part of Whisper's 30-second window a quick transcription uses: the
/// audio's length plus about five seconds of margin (50 positions a second).
/// A window cut too tight drops the start of the phrase or loops.
pub(crate) fn quick_audio_ctx(pcm_bytes: usize) -> usize {
    let seconds = pcm_bytes as f64 / (SAMPLE_RATE as f64 * 2.0);
    ((seconds * 50.0).ceil() as usize + 256).min(1500)
}

/// Whisper sometimes repeats one sentence over and over when its window is
/// short: three or more times means the text is not what was said.
pub(crate) fn looks_looped(text: &str) -> bool {
    let sentences: Vec<String> = text
        .split(['.', '!', '?', '¿', '¡'])
        .map(comparable)
        .filter(|sentence| sentence.len() > 8)
        .collect();
    sentences.iter().any(|sentence| sentences.iter().filter(|other| *other == sentence).count() >= 3)
}

/// 16 kHz mono 16-bit PCM wrapped in a WAV header.
pub(crate) fn wav(pcm: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(44 + pcm.len());
    out.extend(b"RIFF");
    out.extend((36 + pcm.len() as u32).to_le_bytes());
    out.extend(b"WAVEfmt ");
    out.extend(16u32.to_le_bytes());
    out.extend([1, 0, 1, 0]);
    out.extend(SAMPLE_RATE.to_le_bytes());
    out.extend((SAMPLE_RATE * 2).to_le_bytes());
    out.extend([2, 0, 16, 0]);
    out.extend(b"data");
    out.extend((pcm.len() as u32).to_le_bytes());
    out.extend(pcm);
    out
}

/// A multipart/form-data body with the WAV as `file` and plain fields.
pub(crate) fn form(boundary: &str, audio: &[u8], fields: &[(&str, &str)]) -> Vec<u8> {
    let mut body = Vec::with_capacity(audio.len() + 1024);
    for (name, value) in fields {
        body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
    }
    body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"voz.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes());
    body.extend(audio);
    body.extend(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

#[cfg(windows)]
mod platform {
    use super::*;
    use crate::core::system::pluma_realtime::windows::{engine_command, reap_with_app};
    use reqwest::Client;
    use std::{
        net::{Ipv4Addr, TcpListener},
        os::windows::io::OwnedHandle,
        path::{Path, PathBuf},
        process::Stdio,
        time::Duration,
    };
    use tauri::{AppHandle, Manager};
    use tokio::process::Child;

    struct Server {
        child: Child,
        _job: OwnedHandle,
        port: u16,
        client: Client,
    }

    static SERVER: tokio::sync::Mutex<Option<Server>> = tokio::sync::Mutex::const_new(None);

    fn engine(app: &AppHandle) -> Option<PathBuf> {
        let resources = app.path().resource_dir().ok()?;
        [
            resources.join("resources/pluma-whisper/whisper-server.exe"),
            resources.join("pluma-whisper/whisper-server.exe"),
        ]
        .into_iter()
        .find(|path| path.is_file())
    }

    fn model() -> Option<PathBuf> {
        [
            std::env::var_os("REY30_WHISPER_DIR")
                .map(PathBuf::from)
                .filter(|path| path.is_absolute()),
            Some(super::super::models_root::models_root().join("Pluma").join("Whisper-large-v3-turbo")),
        ]
        .into_iter()
        .flatten()
        .map(|dir| dir.join(MODEL))
        .find(|path| path.is_file())
    }

    /// Half the logical processors (the physical cores on most PCs), 2 to 8:
    /// more threads were slower in tests.
    fn threads() -> usize {
        std::thread::available_parallelism()
            .map(|count| count.get() / 2)
            .unwrap_or(4)
            .clamp(2, 8)
    }

    async fn start(engine: &Path, model: &Path) -> Result<Server, String> {
        let port = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .and_then(|listener| listener.local_addr())
            .map_err(|_| "No se pudo reservar el puerto de Whisper.")?
            .port();
        let mut child = engine_command(engine)
            .arg("-m")
            .arg(model)
            .args(["--host", "127.0.0.1", "--port", &port.to_string(), "-l", "es", "-t", &threads().to_string()])
            .args(["-nt", "-sns", "--prompt", PROMPT])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("No se pudo iniciar Whisper. {error}"))?;
        let job = reap_with_app(&child).ok_or("Windows no pudo aislar Whisper.")?;
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(90))
            .build()
            .map_err(|_| "No se pudo conectar con Whisper.")?;
        for _ in 0..240 {
            if child.try_wait().ok().flatten().is_some() {
                return Err("Whisper se cerró al arrancar.".into());
            }
            if client.get(format!("http://127.0.0.1:{port}/")).send().await.is_ok() {
                return Ok(Server { child, _job: job, port, client });
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Err("Whisper tardó demasiado en arrancar.".into())
    }

    /// What the person said in `pcm` (16 kHz mono 16-bit), written by Whisper.
    /// `quick`: someone is waiting for it, so the window is cut to the audio
    /// (1.5 to 3.5 s instead of about 6 on this PC's processor); a looped
    /// result is done again with the whole window.
    pub async fn transcribe(app: &AppHandle, pcm: &[u8], quick: bool) -> Result<String, String> {
        if quick {
            let text = transcribe_with(app, pcm, Some(quick_audio_ctx(pcm.len()))).await?;
            if !looks_looped(&text) {
                return Ok(text);
            }
        }
        transcribe_with(app, pcm, None).await
    }

    async fn transcribe_with(app: &AppHandle, pcm: &[u8], audio_ctx: Option<usize>) -> Result<String, String> {
        let engine = engine(app).ok_or("Falta el motor de Whisper.")?;
        let model = model().ok_or("Falta el modelo de Whisper.")?;
        let (client, port) = {
            let mut slot = SERVER.lock().await;
            if slot.as_mut().is_some_and(|server| server.child.try_wait().ok().flatten().is_some()) {
                *slot = None;
            }
            if slot.is_none() {
                *slot = Some(start(&engine, &model).await?);
            }
            let server = slot.as_ref().ok_or("Whisper no está disponible.")?;
            (server.client.clone(), server.port)
        };
        let boundary = format!("rey30-{}", uuid::Uuid::new_v4().simple());
        let window = audio_ctx.map(|value| value.to_string());
        let mut fields = vec![("response_format", "json"), ("temperature", "0"), ("language", "es")];
        if let Some(window) = window.as_deref() {
            fields.push(("audio_ctx", window));
        }
        let body = form(&boundary, &wav(pcm), &fields);
        let response: serde_json::Value = client
            .post(format!("http://127.0.0.1:{port}/inference"))
            .header("content-type", format!("multipart/form-data; boundary={boundary}"))
            .body(body)
            .send()
            .await
            .map_err(|_| "Se perdió la conexión con Whisper.")?
            .error_for_status()
            .map_err(|error| format!("Whisper rechazó el audio. {error}"))?
            .json()
            .await
            .map_err(|_| "Whisper devolvió una respuesta no válida.")?;
        let text = response.get("text").and_then(|text| text.as_str()).ok_or("Whisper no devolvió texto.")?;
        Ok(clean_transcript(text))
    }
}

#[cfg(windows)]
pub use platform::transcribe;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_what_whisper_invents_over_silence_and_keeps_real_speech() {
        assert_eq!(clean_transcript("  Gracias por ver el video. "), "");
        assert_eq!(clean_transcript("Subtítulos realizados por la comunidad de Amara.org"), "");
        assert_eq!(clean_transcript(" - "), "");
        assert_eq!(clean_transcript("..."), "");
        assert_eq!(clean_transcript(" No tiene voz para funcionar. "), "No tiene voz para funcionar.");
        assert_eq!(clean_transcript("Gracias a todos."), "Gracias a todos.");
        assert_eq!(clean_transcript("Sí."), "Sí.");
    }

    #[test]
    fn a_quick_window_fits_the_audio_with_margin_and_a_loop_is_caught() {
        assert_eq!(quick_audio_ctx(32_000 * 4), 456);
        assert_eq!(quick_audio_ctx(32_000 * 30), 1500);
        assert!(looks_looped("Entiendo. ¿Quieres que busquemos una frase? Entiendo. ¿Quieres que busquemos una frase? ¿Quieres que busquemos una frase?"));
        assert!(!looks_looped("No tiene voz para funcionar. Sí, sí, sí."));
    }

    #[test]
    fn wraps_pcm_as_a_16_khz_mono_wav_and_a_form() {
        let audio = wav(&[1, 0, 2, 0]);
        assert_eq!(&audio[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(audio[24..28].try_into().unwrap()), 16_000);
        assert_eq!(u32::from_le_bytes(audio[40..44].try_into().unwrap()), 4);
        assert_eq!(audio.len(), 48);
        let body = String::from_utf8_lossy(&form("b", b"WAV", &[("language", "es")])).into_owned();
        assert!(body.starts_with("--b\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nes\r\n"));
        assert!(body.contains("name=\"file\"; filename=\"voz.wav\"\r\nContent-Type: audio/wav\r\n\r\nWAV\r\n--b--\r\n"));
    }
}
