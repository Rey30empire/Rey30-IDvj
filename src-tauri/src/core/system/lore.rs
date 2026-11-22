//! Lore: the folder in the project that holds what Pluma is made of.
//!
//! ```text
//! Lore/
//!   biblioteca/       her literary library (searched with buscar_biblioteca)
//!   voces/hablar/     WAV or MP3 samples she can speak with
//!   voces/cantar/     WAV or MP3 samples she can sing with
//!   canciones/        lyrics (.txt, .md, .lrc) she can sing by title
//! ```
//!
//! Files dropped there show up in the app without rebuilding it: the build only
//! bakes in where the folder is (the project the app was built from), and
//! `REY30_LORE_DIR` can point a copy of the app somewhere else.

use super::pluma_realtime::require_main;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, WebviewWindow};

pub const LORE_ENV: &str = "REY30_LORE_DIR";
const SELECTION_FILE: &str = "pluma-voice/lore.json";
const VOICE_LIMIT: u64 = 10 * 1024 * 1024;
const MAX_VOICES: usize = 200;
const MAX_SONGS: usize = 60;
const MAX_SONG_FILE: u64 = 64 * 1024;
const MAX_LYRICS: usize = 2_400;
const MAX_TITLE: usize = 80;
/// The folders the app may open for the person, relative to Lore.
const FOLDERS: [&str; 5] = ["", "biblioteca", "voces/hablar", "voces/cantar", "canciones"];

/// Lore as written into the build: the `Lore` folder next to `src-tauri`.
fn built_in_root() -> Option<PathBuf> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|project| project.join("Lore"))
}

/// The Lore folder, when it exists: `REY30_LORE_DIR` if set to an absolute
/// path, else the one in the project the app was built from.
pub fn lore_root() -> Option<PathBuf> {
    std::env::var_os(LORE_ENV)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(built_in_root)
        .filter(|path| path.is_dir())
}

/// Pluma's library inside Lore, when it exists.
pub fn library_dir() -> Option<PathBuf> {
    lore_root()
        .map(|root| root.join("biblioteca"))
        .filter(|path| path.is_dir())
}

fn voices_dir(root: &Path, singing: bool) -> PathBuf {
    root.join("voces").join(if singing { "cantar" } else { "hablar" })
}

fn extension(path: &Path) -> String {
    path.extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

/// A plain file directly in `dir`, never a link: names come from the page.
fn plain_file(dir: &Path, name: &str) -> Option<PathBuf> {
    let valid = !name.is_empty()
        && name.len() <= 255
        && !name.contains(['/', '\\', ':', '\0'])
        && name != "."
        && name != "..";
    if !valid {
        return None;
    }
    let path = dir.join(name);
    let metadata = fs::symlink_metadata(&path).ok()?;
    (metadata.is_file() && !is_link(&metadata)).then_some(path)
}

/// Files in `dir` (not in subfolders) with one of `extensions`, in name order.
fn files_in(dir: &Path, extensions: &[&str], limit: usize) -> Vec<(String, PathBuf, u64)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let metadata = fs::symlink_metadata(entry.path()).ok()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let wanted = metadata.is_file()
                && !is_link(&metadata)
                && extensions.contains(&extension(&entry.path()).as_str());
            wanted.then(|| (name, entry.path(), metadata.len()))
        })
        .collect();
    files.sort_by(|a, b| super::pluma_reading::natural_cmp(&a.0, &b.0));
    files.truncate(limit);
    files
}

fn stem(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoreVoice {
    /// File name inside `voces/hablar` or `voces/cantar`.
    file: String,
    /// What the selector shows: the file name without its extension.
    name: String,
    bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoreVoices {
    root: Option<String>,
    voices: Vec<LoreVoice>,
    /// The Lore voice now in use, if the sample came from Lore.
    selected: Option<String>,
}

fn list_voices(root: &Path, singing: bool) -> Vec<LoreVoice> {
    files_in(&voices_dir(root, singing), &["wav", "mp3"], MAX_VOICES)
        .into_iter()
        .filter(|(_, _, bytes)| *bytes > 44 && *bytes <= VOICE_LIMIT)
        .map(|(file, _, bytes)| LoreVoice {
            name: stem(&file),
            file,
            bytes,
        })
        .collect()
}

#[derive(Default, Deserialize, Serialize)]
struct Selection {
    #[serde(default)]
    speaking: Option<String>,
    #[serde(default)]
    singing: Option<String>,
}

fn selection_path(app: &AppHandle) -> PathBuf {
    crate::core::app::commands::get_rey30_data_folder_path(app.clone()).join(SELECTION_FILE)
}

fn read_selection(app: &AppHandle) -> Selection {
    fs::read(selection_path(app))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// The Lore voice behind the current sample, if it came from Lore.
pub fn selected_voice(app: &AppHandle, singing: bool) -> Option<String> {
    let selection = read_selection(app);
    if singing {
        selection.singing
    } else {
        selection.speaking
    }
}

/// Remembers which Lore voice the sample came from; `None` when the sample was
/// chosen by hand or removed.
pub fn remember_voice(app: &AppHandle, singing: bool, file: Option<&str>) {
    let mut selection = read_selection(app);
    let value = file.map(str::to_string);
    if singing {
        selection.singing = value;
    } else {
        selection.speaking = value;
    }
    let path = selection_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec(&selection) {
        let _ = fs::write(path, bytes);
    }
}

/// The voices in Lore, speaking ones or with `singing` the singing ones.
#[tauri::command]
pub async fn lore_voices(
    app: AppHandle,
    window: WebviewWindow,
    singing: Option<bool>,
) -> Result<LoreVoices, String> {
    require_main(&window)?;
    let singing = singing.unwrap_or(false);
    let root = lore_root();
    let voices = match &root {
        Some(root) => {
            let root = root.clone();
            tokio::task::spawn_blocking(move || list_voices(&root, singing))
                .await
                .map_err(|_| "No se pudieron leer las voces de Lore.".to_string())?
        }
        None => Vec::new(),
    };
    Ok(LoreVoices {
        root: root.map(|path| path.display().to_string()),
        voices,
        selected: selected_voice(&app, singing),
    })
}

/// Makes a voice from Lore Pluma's speaking or singing sample.
#[tauri::command]
pub async fn lore_voice_use(
    app: AppHandle,
    window: WebviewWindow,
    singing: Option<bool>,
    file: String,
) -> Result<super::pluma_clone::ReferenceStatus, String> {
    require_main(&window)?;
    let singing = singing.unwrap_or(false);
    let root = lore_root().ok_or("No se encontró la carpeta Lore del proyecto.")?;
    let path = plain_file(&voices_dir(&root, singing), &file)
        .filter(|path| matches!(extension(path).as_str(), "wav" | "mp3"))
        .ok_or("Esa voz ya no está en la carpeta de voces de Lore.")?;
    let audio = tokio::task::spawn_blocking(move || {
        let mut bytes = Vec::new();
        fs::File::open(&path)
            .and_then(|file| file.take(VOICE_LIMIT + 1).read_to_end(&mut bytes))
            .map(|_| bytes)
    })
    .await
    .map_err(|_| "No se pudo leer la voz elegida.".to_string())?
    .map_err(|_| "No se pudo leer la voz elegida.".to_string())?;
    let status = super::pluma_clone::install_reference(app.clone(), singing, audio).await?;
    remember_voice(&app, singing, Some(&file));
    Ok(status.with_name(Some(stem(&file))))
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoreSong {
    title: String,
    lyrics: String,
}

/// Lyrics as the song generator wants them: no LRC timestamps or metadata
/// lines, no carriage returns, cut at a line before the limit.
fn clean_lyrics(text: &str) -> String {
    let mut lyrics = String::new();
    for line in text.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let mut line = line.trim_end();
        // `[ar: Artist]`-style LRC metadata says nothing to sing.
        if line.starts_with('[') && line.ends_with(']') && line.contains(':') {
            continue;
        }
        // `[01:23.45]` timestamps, possibly several, before the words.
        while let Some(rest) = line.strip_prefix('[').and_then(|rest| {
            let end = rest.find(']')?;
            let stamp = &rest[..end];
            (stamp.contains(':') && stamp.chars().all(|c| c.is_ascii_digit() || c == ':' || c == '.'))
                .then(|| &rest[end + 1..])
        }) {
            line = rest;
        }
        if lyrics.len() + line.len() + 1 > MAX_LYRICS {
            break;
        }
        lyrics.push_str(line);
        lyrics.push('\n');
    }
    lyrics.trim().to_string()
}

fn list_songs(root: &Path) -> Vec<LoreSong> {
    files_in(&root.join("canciones"), &["txt", "md", "lrc"], MAX_SONGS)
        .into_iter()
        .filter(|(_, _, bytes)| *bytes <= MAX_SONG_FILE)
        .filter_map(|(name, path, _)| {
            let text = fs::read_to_string(path).ok()?;
            let lyrics = clean_lyrics(text.trim_start_matches('\u{feff}'));
            let title: String = stem(&name).chars().take(MAX_TITLE).collect();
            (!lyrics.is_empty() && !title.trim().is_empty()).then_some(LoreSong {
                title: title.trim().to_string(),
                lyrics,
            })
        })
        .collect()
}

/// The songs saved in `Lore/canciones`, with their lyrics.
#[tauri::command]
pub async fn lore_songs(window: WebviewWindow) -> Result<Vec<LoreSong>, String> {
    require_main(&window)?;
    let Some(root) = lore_root() else {
        return Ok(Vec::new());
    };
    tokio::task::spawn_blocking(move || list_songs(&root))
        .await
        .map_err(|_| "No se pudieron leer las canciones de Lore.".to_string())
}

/// Opens a Lore folder in the file explorer so the person can add files.
#[tauri::command]
pub async fn lore_open(window: WebviewWindow, folder: Option<String>) -> Result<(), String> {
    require_main(&window)?;
    let folder = folder.unwrap_or_default();
    if !FOLDERS.contains(&folder.as_str()) {
        return Err("Esa carpeta no es parte de Lore.".into());
    }
    let root = lore_root().ok_or("No se encontró la carpeta Lore del proyecto.")?;
    let path = root.join(&folder);
    fs::create_dir_all(&path).map_err(|_| "No se pudo crear la carpeta de Lore.")?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .spawn()
            .map_err(|_| "No se pudo abrir el explorador de archivos.")?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("Abrir la carpeta Lore está disponible en Windows.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rey30-lore-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn lists_speaking_and_singing_voices_in_name_order() {
        let root = scratch("voices");
        let speaking = voices_dir(&root, false);
        fs::create_dir_all(&speaking).unwrap();
        fs::create_dir_all(voices_dir(&root, true)).unwrap();
        let sample = vec![0u8; 100];
        fs::write(speaking.join("Voz 10.wav"), &sample).unwrap();
        fs::write(speaking.join("Voz 2.mp3"), &sample).unwrap();
        fs::write(speaking.join("notas.txt"), &sample).unwrap();
        fs::write(speaking.join("vacia.wav"), [0u8; 10]).unwrap();
        fs::write(voices_dir(&root, true).join("Canto.wav"), &sample).unwrap();
        let names: Vec<_> = list_voices(&root, false).into_iter().map(|voice| voice.name).collect();
        assert_eq!(names, ["Voz 2", "Voz 10"]);
        let singing: Vec<_> = list_voices(&root, true).into_iter().map(|voice| voice.file).collect();
        assert_eq!(singing, ["Canto.wav"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_voice_name_cannot_leave_its_folder() {
        let root = scratch("names");
        fs::write(root.join("bien.wav"), [1u8; 64]).unwrap();
        assert!(plain_file(&root, "bien.wav").is_some());
        for name in ["../bien.wav", "..\\bien.wav", "C:bien.wav", "..", "", "falta.wav"] {
            assert!(plain_file(&root, name).is_none(), "{name}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn songs_drop_lrc_timestamps_and_metadata() {
        let root = scratch("songs");
        let songs = root.join("canciones");
        fs::create_dir_all(&songs).unwrap();
        fs::write(songs.join("Lluvia.lrc"), "[ar: Pluma]\n[00:01.00]Cae la lluvia\n[00:04.50][00:20.00]sobre el mar\n").unwrap();
        fs::write(songs.join("Sol.md"), "\u{feff}[Verse]\r\nSale el sol\r\n").unwrap();
        fs::write(songs.join("vacia.txt"), "  \n").unwrap();
        let listed = list_songs(&root);
        assert_eq!(
            listed,
            [
                LoreSong { title: "Lluvia".into(), lyrics: "Cae la lluvia\nsobre el mar".into() },
                LoreSong { title: "Sol".into(), lyrics: "[Verse]\nSale el sol".into() },
            ]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn long_lyrics_are_cut_at_a_line() {
        let text = "verso largo de la canción\n".repeat(200);
        let lyrics = clean_lyrics(&text);
        assert!(lyrics.len() <= MAX_LYRICS);
        assert!(lyrics.ends_with("canción"));
    }

    #[test]
    fn the_built_in_lore_is_the_project_folder() {
        let root = built_in_root().unwrap();
        assert!(root.ends_with("Lore"));
        assert!(!root.components().any(|part| part == std::path::Component::ParentDir));
    }
}
