//! Audio kept from Pluma's voice calls. Recordings live inside their thread's
//! folder, so deleting the thread removes them with it.

use super::pluma_realtime::require_main;
use crate::core::app::commands::get_rey30_data_folder_path;
use crate::core::threads::utils::get_thread_dir;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, WebviewWindow};
use uuid::Uuid;

const FOLDER: &str = "voice";
const MAX_WAV_BYTES: usize = 40 * 1024 * 1024;

/// Only names this module generated: `<uuid>.wav`, never a path.
fn is_recording_name(file: &str) -> bool {
    file.strip_suffix(".wav").is_some_and(|id| {
        Uuid::try_parse(id).is_ok_and(|uuid| uuid.hyphenated().to_string() == id)
    })
}

fn recording_path(data: &Path, thread_id: &str, file: &str) -> Result<PathBuf, String> {
    if !is_recording_name(file) {
        return Err("El nombre del audio no es válido.".into());
    }
    Ok(get_thread_dir(data, thread_id)?.join(FOLDER).join(file))
}

fn decode_wav(wav_base64: &str) -> Result<Vec<u8>, String> {
    if wav_base64.len() > MAX_WAV_BYTES / 3 * 4 + 4 {
        return Err("El audio excede el tamaño permitido.".into());
    }
    let wav = STANDARD
        .decode(wav_base64)
        .map_err(|_| "El audio recibido no es válido.")?;
    if wav.len() <= 44 || &wav[..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err("El audio recibido no es un WAV.".into());
    }
    Ok(wav)
}

/// A file name the person can keep: no path parts, no characters Windows rejects.
fn download_name(suggested: &str) -> String {
    let stem: String = suggested
        .trim()
        .trim_end_matches(".wav")
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '-'
            } else {
                c
            }
        })
        .take(120)
        .collect();
    let stem = stem.trim().trim_matches('.');
    format!("{}.wav", if stem.is_empty() { "grabacion" } else { stem })
}

#[tauri::command]
pub async fn pluma_recording_save(
    app: AppHandle,
    window: WebviewWindow,
    thread_id: String,
    wav_base64: String,
) -> Result<String, String> {
    require_main(&window)?;
    let wav = decode_wav(&wav_base64)?;
    let thread = get_thread_dir(&get_rey30_data_folder_path(app), &thread_id)?;
    if !thread.is_dir() {
        return Err("El chat de esta llamada ya no existe.".into());
    }
    let folder = thread.join(FOLDER);
    tokio::fs::create_dir_all(&folder)
        .await
        .map_err(|_| "No se pudo preparar la carpeta de audio.")?;
    let file = format!("{}.wav", Uuid::new_v4());
    tokio::fs::write(folder.join(&file), wav)
        .await
        .map_err(|_| "No se pudo guardar el audio.")?;
    Ok(file)
}

#[tauri::command]
pub async fn pluma_recording_path(
    app: AppHandle,
    window: WebviewWindow,
    thread_id: String,
    file: String,
) -> Result<String, String> {
    require_main(&window)?;
    let path = recording_path(&get_rey30_data_folder_path(app), &thread_id, &file)?;
    if !path.is_file() {
        return Err("Este audio ya no está disponible.".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Asks where to save here, so the page never names a destination itself.
/// `false` means the person closed the dialog.
#[tauri::command]
pub async fn pluma_recording_download(
    app: AppHandle,
    window: WebviewWindow,
    thread_id: String,
    file: String,
    suggested_name: String,
) -> Result<bool, String> {
    require_main(&window)?;
    let source = recording_path(&get_rey30_data_folder_path(app), &thread_id, &file)?;
    if !source.is_file() {
        return Err("Este audio ya no está disponible.".into());
    }
    let Some(target) = rfd::AsyncFileDialog::new()
        .set_file_name(download_name(&suggested_name))
        .add_filter("Audio WAV", &["wav"])
        .save_file()
        .await
    else {
        return Ok(false);
    };
    tokio::fs::copy(source, target.path())
        .await
        .map_err(|_| "No se pudo guardar el audio en esa carpeta.")?;
    Ok(true)
}

#[tauri::command]
pub async fn pluma_recording_delete(
    app: AppHandle,
    window: WebviewWindow,
    thread_id: String,
    file: String,
) -> Result<(), String> {
    require_main(&window)?;
    let path = recording_path(&get_rey30_data_folder_path(app), &thread_id, &file)?;
    match tokio::fs::remove_file(path).await {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            Err("No se pudo eliminar el audio.".into())
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NAME: &str = "67e55044-10b1-426f-9247-bb680e5fe0c8.wav";

    fn wav_base64(body: usize) -> String {
        let mut wav = b"RIFF\0\0\0\0WAVE".to_vec();
        wav.resize(12 + body, 0);
        STANDARD.encode(wav)
    }

    #[test]
    fn accepts_only_the_names_it_generates() {
        assert!(is_recording_name(NAME));
        for bad in [
            "../secreto.wav",
            "..\\secreto.wav",
            "a.wav",
            "67e55044-10b1-426f-9247-bb680e5fe0c8",
            "67e55044-10b1-426f-9247-bb680e5fe0c8.mp3",
            "67e5504410b1426f9247bb680e5fe0c8.wav",
            "{67e55044-10b1-426f-9247-bb680e5fe0c8}.wav",
            "67E55044-10B1-426F-9247-BB680E5FE0C8.wav",
        ] {
            assert!(!is_recording_name(bad), "{bad}");
        }
    }

    #[test]
    fn keeps_recordings_inside_the_thread_folder() {
        let data = Path::new("datos");
        let path = recording_path(data, "01JABCDEFG", NAME).unwrap();
        assert!(path.ends_with(Path::new("01JABCDEFG").join(FOLDER).join(NAME)));
        assert!(recording_path(data, "../otro", NAME).is_err());
        assert!(recording_path(data, "01JABCDEFG", "../messages.jsonl").is_err());
    }

    #[test]
    fn accepts_a_wav_and_rejects_anything_else() {
        assert!(decode_wav(&wav_base64(40)).is_ok());
        assert!(decode_wav(&wav_base64(10)).is_err());
        assert!(decode_wav(&STANDARD.encode([b'x'; 64])).is_err());
        assert!(decode_wav("no es base64").is_err());
        assert!(decode_wav(&"A".repeat(MAX_WAV_BYTES / 3 * 4 + 8)).is_err());
    }

    #[test]
    fn download_names_cannot_escape_the_chosen_folder() {
        assert_eq!(download_name("Canción 2026-11-09"), "Canción 2026-11-09.wav");
        assert_eq!(download_name("a/b\\c:d.wav"), "a-b-c-d.wav");
        assert_eq!(download_name("  ...  "), "grabacion.wav");
        assert!(download_name(&"x".repeat(500)).len() <= 124);
    }
}
