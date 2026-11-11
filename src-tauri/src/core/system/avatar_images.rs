//! Pictures chosen for an assistant's hologram. They are copied into the data
//! folder, so the original can be moved or deleted, and handed to the page as
//! data URLs, which a canvas can read without becoming cross-origin.

use super::pluma_realtime::require_main;
use crate::core::app::commands::get_rey30_data_folder_path;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, WebviewWindow};
use uuid::Uuid;

const FOLDER: &str = "avatars";
const MAX_IMAGE_BYTES: u64 = 15 * 1024 * 1024;

/// The format by content, not by extension: (extension, MIME type).
fn image_kind(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("png", "image/png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("jpg", "image/jpeg"))
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else {
        None
    }
}

/// Only names this module generated: `<uuid>.png|jpg|webp`, never a path.
fn is_image_name(file: &str) -> bool {
    let Some((id, ext)) = file.rsplit_once('.') else { return false };
    ["png", "jpg", "webp"].contains(&ext)
        && Uuid::try_parse(id).is_ok_and(|uuid| uuid.hyphenated().to_string() == id)
}

fn image_path(data: &Path, file: &str) -> Result<PathBuf, String> {
    if !is_image_name(file) {
        return Err("El nombre de la imagen no es válido.".into());
    }
    Ok(data.join(FOLDER).join(file))
}

/// Copies the picked picture in; `None` when the person closes the dialog.
#[tauri::command]
pub async fn avatar_image_choose(app: AppHandle, window: WebviewWindow) -> Result<Option<String>, String> {
    require_main(&window)?;
    let folder = get_rey30_data_folder_path(app).join(FOLDER);
    tokio::task::spawn_blocking(move || {
        let Some(source) = rfd::FileDialog::new()
            .set_title("Elegir la imagen del holograma")
            .add_filter("Imagen PNG, JPG o WebP", &["png", "jpg", "jpeg", "webp"])
            .pick_file()
        else {
            return Ok(None);
        };
        let size = std::fs::metadata(&source).map_err(|_| "No se pudo abrir la imagen.")?.len();
        if size > MAX_IMAGE_BYTES {
            return Err("La imagen pasa de 15 MB.".into());
        }
        let bytes = std::fs::read(&source).map_err(|_| "No se pudo leer la imagen.")?;
        let (ext, _) = image_kind(&bytes).ok_or("Elige una imagen PNG, JPG o WebP.")?;
        std::fs::create_dir_all(&folder).map_err(|_| "No se pudo preparar la carpeta de imágenes.")?;
        let file = format!("{}.{ext}", Uuid::new_v4());
        std::fs::write(folder.join(&file), bytes).map_err(|_| "No se pudo guardar la imagen.")?;
        Ok(Some(file))
    })
    .await
    .map_err(|_| "Se interrumpió el selector de imagen.".to_string())?
}

#[tauri::command]
pub async fn avatar_image_data(app: AppHandle, window: WebviewWindow, file: String) -> Result<String, String> {
    require_main(&window)?;
    let path = image_path(&get_rey30_data_folder_path(app), &file)?;
    let bytes = tokio::fs::read(path).await.map_err(|_| "Esta imagen ya no está disponible.")?;
    let (_, mime) = image_kind(&bytes).ok_or("La imagen guardada está dañada.")?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub async fn avatar_image_delete(app: AppHandle, window: WebviewWindow, file: String) -> Result<(), String> {
    require_main(&window)?;
    let path = image_path(&get_rey30_data_folder_path(app), &file)?;
    match tokio::fs::remove_file(path).await {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err("No se pudo borrar la imagen.".into()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_images_by_their_content() {
        assert_eq!(image_kind(b"\x89PNG\r\n\x1a\nresto"), Some(("png", "image/png")));
        assert_eq!(image_kind(&[0xff, 0xd8, 0xff, 0xe0, 1]), Some(("jpg", "image/jpeg")));
        assert_eq!(image_kind(b"RIFF\0\0\0\0WEBPVP8 "), Some(("webp", "image/webp")));
        assert_eq!(image_kind(b"RIFF\0\0\0\0WAVEfmt "), None);
        assert_eq!(image_kind(b"<svg onload=alert(1)>"), None);
    }

    #[test]
    fn opens_only_the_images_it_saved() {
        let data = Path::new("datos");
        let name = "67e55044-10b1-426f-9247-bb680e5fe0c8.png";
        assert!(image_path(data, name).unwrap().ends_with(Path::new(FOLDER).join(name)));
        for bad in [
            "../settings.json",
            "..\\x.png",
            "67e55044-10b1-426f-9247-bb680e5fe0c8.svg",
            "67e55044-10b1-426f-9247-bb680e5fe0c8",
            "foto.png",
            "67E55044-10B1-426F-9247-BB680E5FE0C8.png",
        ] {
            assert!(image_path(data, bad).is_err(), "{bad}");
        }
    }
}
