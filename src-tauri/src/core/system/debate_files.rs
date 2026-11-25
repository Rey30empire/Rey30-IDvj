//! Pluma's recorded debates, kept in Lore so the person finds them with the
//! rest of their material: `Lore/debates/<fecha título>/` holds the whole
//! debate, one track per voice, the script and where each line falls.
//!
//! The page only names files inside one debate folder; it never sends a path.
//! Exporting asks for the destination with the system dialog here.

use super::lore::{lore_root, plain_dir};
use super::pluma_realtime::require_main;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::WebviewWindow;

const DEBATES: &str = "debates";
const MAX_FILES: usize = 12;
const MAX_FILE_BYTES: usize = 400 * 1024 * 1024;
const MAX_NAME: usize = 80;
const EXTENSIONS: [&str; 3] = ["wav", "md", "json"];

#[derive(Debug, Deserialize)]
pub struct DebateFile {
    name: String,
    data: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedDebate {
    folder: String,
    files: Vec<String>,
}

/// A name Windows accepts for a file or folder, from the page's text: no
/// separators, reserved characters or control characters, no leading or
/// trailing dots and spaces, not a device name, at most `MAX_NAME` characters.
fn clean_name(name: &str) -> Option<String> {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { ' ' } else { c })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned: String = cleaned.chars().take(MAX_NAME).collect();
    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c == ' ').to_string();
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit());
    (!cleaned.is_empty() && !device).then_some(cleaned)
}

/// A file of a debate: a clean name with one of the kept extensions, unchanged by cleaning.
fn debate_file_name(name: &str) -> Option<String> {
    let clean = clean_name(name).filter(|clean| clean == name)?;
    let extension = Path::new(&clean).extension()?.to_str()?.to_ascii_lowercase();
    EXTENSIONS.contains(&extension.as_str()).then_some(clean)
}

fn is_wav(audio: &[u8]) -> bool {
    audio.len() > 44 && &audio[..4] == b"RIFF" && &audio[8..12] == b"WAVE"
}

fn decode(file: &DebateFile) -> Result<Vec<u8>, String> {
    if file.data.len() > MAX_FILE_BYTES / 3 * 4 + 4 {
        return Err(format!("«{}» es demasiado grande para guardarlo.", file.name));
    }
    let bytes = STANDARD
        .decode(file.data.as_bytes())
        .map_err(|_| format!("«{}» llegó dañado.", file.name))?;
    if file.name.to_ascii_lowercase().ends_with(".wav") && !is_wav(&bytes) {
        return Err(format!("«{}» no es un WAV válido.", file.name));
    }
    Ok(bytes)
}

/// `Lore/debates`, created when missing, and a plain folder.
fn debates_dir(root: &Path) -> Result<PathBuf, String> {
    let dir = root.join(DEBATES);
    fs::create_dir_all(&dir).map_err(|_| "No se pudo crear la carpeta de debates en Lore.")?;
    if !plain_dir(&dir) {
        return Err("La carpeta de debates de Lore no es una carpeta normal.".into());
    }
    Ok(dir)
}

/// An existing debate folder named by the page.
fn debate_dir(root: &Path, folder: &str) -> Result<PathBuf, String> {
    let name = clean_name(folder).filter(|clean| clean == folder).ok_or("Ese debate no existe.")?;
    let dir = debates_dir(root)?.join(name);
    if !plain_dir(&dir) {
        return Err("Ese debate ya no está en Lore.".into());
    }
    Ok(dir)
}

/// Writes the files into a new folder named after `title` (« (2)» and so on
/// when taken). Nothing is replaced; on a failure the new folder is removed.
fn save(root: &Path, title: &str, files: &[(String, Vec<u8>)]) -> Result<SavedDebate, String> {
    let base = clean_name(title).unwrap_or_else(|| "Debate".into());
    let dir = debates_dir(root)?;
    let (folder, path) = (1..=99)
        .map(|n| if n == 1 { base.clone() } else { format!("{base} ({n})") })
        .find_map(|name| {
            let path = dir.join(&name);
            fs::create_dir(&path).ok().map(|_| (name, path))
        })
        .ok_or("Ya hay demasiados debates con ese nombre en Lore.")?;
    let written = files.iter().try_for_each(|(name, bytes)| {
        use std::io::Write;
        let mut out = fs::OpenOptions::new().write(true).create_new(true).open(path.join(name))?;
        out.write_all(bytes)?;
        out.sync_all()
    });
    if written.is_err() {
        let _ = fs::remove_dir_all(&path);
        return Err("No se pudo guardar el debate en Lore.".into());
    }
    Ok(SavedDebate { folder, files: files.iter().map(|(name, _)| name.clone()).collect() })
}

/// The kept files of a debate folder, in name order.
fn list(dir: &Path) -> Vec<String> {
    let mut files: Vec<String> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| fs::symlink_metadata(entry.path()).is_ok_and(|meta| meta.is_file()))
                .filter_map(|entry| entry.file_name().to_str().and_then(debate_file_name))
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

/// Saves a recorded debate (WAVs, the script and its timing) in `Lore/debates`.
#[tauri::command]
pub async fn debate_save(window: WebviewWindow, title: String, files: Vec<DebateFile>) -> Result<SavedDebate, String> {
    require_main(&window)?;
    if files.is_empty() || files.len() > MAX_FILES {
        return Err("El debate no tiene archivos que guardar.".into());
    }
    let mut decoded = Vec::with_capacity(files.len());
    for file in &files {
        let name = debate_file_name(&file.name).ok_or_else(|| format!("«{}» no es un nombre de archivo válido.", file.name))?;
        if decoded.iter().any(|(other, _): &(String, Vec<u8>)| other.eq_ignore_ascii_case(&name)) {
            return Err(format!("«{name}» está repetido."));
        }
        decoded.push((name, decode(file)?));
    }
    let root = lore_root().ok_or("No se encontró la carpeta Lore del proyecto.")?;
    tokio::task::spawn_blocking(move || save(&root, &title, &decoded))
        .await
        .map_err(|_| "No se pudo guardar el debate en Lore.".to_string())?
}

/// The files of a saved debate; empty when the folder is gone.
#[tauri::command]
pub async fn debate_files(window: WebviewWindow, folder: String) -> Result<Vec<String>, String> {
    require_main(&window)?;
    let root = lore_root().ok_or("No se encontró la carpeta Lore del proyecto.")?;
    Ok(debate_dir(&root, &folder).map(|dir| list(&dir)).unwrap_or_default())
}

/// One file of a saved debate, in base64.
#[tauri::command]
pub async fn debate_read(window: WebviewWindow, folder: String, file: String) -> Result<String, String> {
    require_main(&window)?;
    let root = lore_root().ok_or("No se encontró la carpeta Lore del proyecto.")?;
    let dir = debate_dir(&root, &folder)?;
    let name = debate_file_name(&file).ok_or("Ese archivo no es parte del debate.")?;
    tokio::task::spawn_blocking(move || {
        let path = dir.join(name);
        if !fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_file() && (meta.len() as usize) <= MAX_FILE_BYTES) {
            return Err("Ese archivo del debate ya no está.".to_string());
        }
        fs::read(&path).map(|bytes| STANDARD.encode(bytes)).map_err(|_| "No se pudo leer el debate.".to_string())
    })
    .await
    .map_err(|_| "No se pudo leer el debate.".to_string())?
}

/// Opens a saved debate's folder in the file explorer.
#[tauri::command]
pub async fn debate_open(window: WebviewWindow, folder: String) -> Result<(), String> {
    require_main(&window)?;
    let root = lore_root().ok_or("No se encontró la carpeta Lore del proyecto.")?;
    let dir = debate_dir(&root, &folder)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(&dir)
            .spawn()
            .map_err(|_| "No se pudo abrir el explorador de archivos.")?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        Err("Abrir la carpeta del debate está disponible en Windows.".into())
    }
}

/// Copies a saved debate out of Lore: one file to where the person saves it,
/// or with no `file` the whole folder into the folder the person picks.
/// Resolves to where it went, or `None` when the dialog was closed.
#[tauri::command]
pub async fn debate_export(window: WebviewWindow, folder: String, file: Option<String>) -> Result<Option<String>, String> {
    require_main(&window)?;
    let root = lore_root().ok_or("No se encontró la carpeta Lore del proyecto.")?;
    let dir = debate_dir(&root, &folder)?;
    match file {
        Some(file) => {
            let name = debate_file_name(&file).ok_or("Ese archivo no es parte del debate.")?;
            let source = dir.join(&name);
            if !fs::symlink_metadata(&source).is_ok_and(|meta| meta.is_file()) {
                return Err("Ese archivo del debate ya no está.".into());
            }
            let extension = Path::new(&name).extension().and_then(|e| e.to_str()).unwrap_or("wav").to_string();
            let Some(target) = rfd::AsyncFileDialog::new()
                .set_file_name(format!("{folder} - {name}"))
                .add_filter(extension.to_ascii_uppercase(), &[extension.as_str()])
                .save_file()
                .await
            else {
                return Ok(None);
            };
            let target = target.path().to_path_buf();
            tokio::task::spawn_blocking(move || fs::copy(&source, &target).map(|_| target))
                .await
                .map_err(|_| "No se pudo copiar el debate.".to_string())?
                .map(|target| Some(target.to_string_lossy().into_owned()))
                .map_err(|_| "No se pudo copiar el debate ahí.".into())
        }
        None => {
            let Some(picked) = rfd::AsyncFileDialog::new().pick_folder().await else {
                return Ok(None);
            };
            let parent = picked.path().to_path_buf();
            tokio::task::spawn_blocking(move || {
                let files = list(&dir);
                let target = (1..=99)
                    .map(|n| parent.join(if n == 1 { folder.clone() } else { format!("{folder} ({n})") }))
                    .find(|path| fs::create_dir(path).is_ok())
                    .ok_or("Ya hay una carpeta con ese nombre ahí.")?;
                for name in files {
                    fs::copy(dir.join(&name), target.join(&name)).map_err(|_| "No se pudo copiar el debate ahí.")?;
                }
                Ok(Some(target.to_string_lossy().into_owned()))
            })
            .await
            .map_err(|_| "No se pudo copiar el debate.".to_string())?
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rey30-debates-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn wav() -> Vec<u8> {
        let mut bytes = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        bytes.resize(64, 0);
        bytes
    }

    #[test]
    fn names_are_cleaned_and_never_paths() {
        assert_eq!(clean_name("2026-11-23 21:40 Carta / a Ana?").as_deref(), Some("2026-11-23 21 40 Carta a Ana"));
        assert_eq!(clean_name("..\\..\\Windows"), Some("Windows".into()));
        assert_eq!(clean_name(" . "), None);
        assert_eq!(clean_name("CON"), None);
        assert_eq!(clean_name("com1.wav"), None);
        assert_eq!(debate_file_name("Pluma.wav").as_deref(), Some("Pluma.wav"));
        assert_eq!(debate_file_name("Guion.md").as_deref(), Some("Guion.md"));
        assert_eq!(debate_file_name("../Pluma.wav"), None);
        assert_eq!(debate_file_name("Pluma.exe"), None);
        assert_eq!(debate_file_name("Pluma"), None);
    }

    #[test]
    fn saves_into_a_new_folder_and_lists_what_it_wrote() {
        let root = scratch("save");
        let files = vec![("Debate completo.wav".to_string(), wav()), ("Guion.md".to_string(), b"Pluma: hola".to_vec())];
        let first = save(&root, "2026-11-23 Carta", &files).unwrap();
        assert_eq!(first, SavedDebate { folder: "2026-11-23 Carta".into(), files: vec!["Debate completo.wav".into(), "Guion.md".into()] });
        let second = save(&root, "2026-11-23 Carta", &files).unwrap();
        assert_eq!(second.folder, "2026-11-23 Carta (2)");
        let dir = debate_dir(&root, &first.folder).unwrap();
        assert_eq!(list(&dir), vec!["Debate completo.wav".to_string(), "Guion.md".to_string()]);
        assert_eq!(fs::read(dir.join("Guion.md")).unwrap(), b"Pluma: hola");
        assert!(debate_dir(&root, "../voces").is_err());
        assert!(debate_dir(&root, "No existe").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn only_real_wavs_are_taken() {
        let bad = DebateFile { name: "Pluma.wav".into(), data: STANDARD.encode(b"no es audio") };
        assert!(decode(&bad).is_err());
        let good = DebateFile { name: "Pluma.wav".into(), data: STANDARD.encode(wav()) };
        assert_eq!(decode(&good).unwrap(), wav());
        let text = DebateFile { name: "Guion.md".into(), data: STANDARD.encode("Pluma: hola") };
        assert_eq!(decode(&text).unwrap(), b"Pluma: hola");
    }
}
