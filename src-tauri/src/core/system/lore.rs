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
const MAX_VOICE_NAME: usize = 60;
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

/// Formats the voice engine reads as they are.
const DIRECT_AUDIO: [&str; 2] = ["wav", "mp3"];
/// Formats people drop in too (phone and WhatsApp voice notes): the app turns
/// them into a WAV when one is chosen, and the file in Lore stays as it is.
const CONVERTED_AUDIO: [&str; 6] = ["m4a", "mp4", "aac", "ogg", "opus", "webm"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoreVoice {
    /// File name inside `voces/hablar` or `voces/cantar`.
    file: String,
    /// What the selector shows: the file name without its extension.
    name: String,
    bytes: u64,
    /// True when the app has to turn it into a WAV before using it.
    convert: bool,
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
    let extensions = [DIRECT_AUDIO.as_slice(), CONVERTED_AUDIO.as_slice()].concat();
    files_in(&voices_dir(root, singing), &extensions, MAX_VOICES)
        .into_iter()
        .filter(|(_, _, bytes)| *bytes > 44 && *bytes <= VOICE_LIMIT)
        .map(|(file, path, bytes)| LoreVoice {
            name: stem(&file),
            convert: !DIRECT_AUDIO.contains(&extension(&path).as_str()),
            file,
            bytes,
        })
        .collect()
}

/// A voice file in Lore by name, never outside its folder.
fn voice_file(root: &Path, singing: bool, file: &str) -> Result<PathBuf, String> {
    plain_file(&voices_dir(root, singing), file)
        .filter(|path| {
            let kind = extension(path);
            DIRECT_AUDIO.contains(&kind.as_str()) || CONVERTED_AUDIO.contains(&kind.as_str())
        })
        .ok_or_else(|| "Esa voz ya no está en la carpeta de voces de Lore.".to_string())
}

async fn read_voice(path: PathBuf) -> Result<Vec<u8>, String> {
    tokio::task::spawn_blocking(move || {
        let mut bytes = Vec::new();
        fs::File::open(&path)
            .and_then(|file| file.take(VOICE_LIMIT + 1).read_to_end(&mut bytes))
            .map(|_| bytes)
    })
    .await
    .map_err(|_| "No se pudo leer la voz elegida.".to_string())?
    .map_err(|_| "No se pudo leer la voz elegida.".to_string())
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

/// A voice file from Lore in base64, for the app to turn into a WAV when the
/// engine cannot read its format.
#[tauri::command]
pub async fn lore_voice_read(
    window: WebviewWindow,
    singing: Option<bool>,
    file: String,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    require_main(&window)?;
    let root = lore_root().ok_or("No se encontró la carpeta Lore del proyecto.")?;
    let audio = read_voice(voice_file(&root, singing.unwrap_or(false), &file)?).await?;
    if audio.len() as u64 > VOICE_LIMIT {
        return Err("Esa voz pesa más de 10 MB.".into());
    }
    Ok(STANDARD.encode(audio))
}

/// Makes a voice from Lore Pluma's speaking or singing sample. A WAV or MP3 is
/// used as it is; any other format comes with `audio`, the app's WAV of it.
#[tauri::command]
pub async fn lore_voice_use(
    app: AppHandle,
    window: WebviewWindow,
    singing: Option<bool>,
    file: String,
    audio: Option<String>,
) -> Result<super::pluma_clone::ReferenceStatus, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    require_main(&window)?;
    let singing = singing.unwrap_or(false);
    let root = lore_root().ok_or("No se encontró la carpeta Lore del proyecto.")?;
    let path = voice_file(&root, singing, &file)?;
    let audio = if DIRECT_AUDIO.contains(&extension(&path).as_str()) {
        read_voice(path).await?
    } else {
        audio
            .and_then(|audio| STANDARD.decode(audio.as_bytes()).ok())
            .filter(|audio| is_wav(audio) && audio.len() as u64 <= VOICE_LIMIT)
            .ok_or("Hay que convertir esa voz a WAV antes de usarla.")?
    };
    let status = super::pluma_clone::install_reference(app.clone(), singing, audio).await?;
    remember_voice(&app, singing, Some(&file));
    Ok(status.with_name(Some(stem(&file))))
}

/// A file name for a recorded voice from what the person typed: no path or
/// reserved characters, never empty, short enough for the selector.
fn voice_file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { ' ' } else { c })
        .collect();
    let words = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let short: String = words.chars().take(MAX_VOICE_NAME).collect();
    // Windows drops trailing dots and spaces, and a leading dot hides the file.
    let base = short.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if base.is_empty() {
        "Mi voz".into()
    } else {
        base.into()
    }
}

/// `base.wav`, else `base 2.wav`, `base 3.wav`…: a recording never replaces a
/// voice already in Lore.
fn free_voice_file(dir: &Path, base: &str) -> Option<String> {
    (1..=MAX_VOICES)
        .map(|n| if n == 1 { format!("{base}.wav") } else { format!("{base} {n}.wav") })
        .find(|file| fs::symlink_metadata(dir.join(file)).is_err())
}

fn is_wav(audio: &[u8]) -> bool {
    audio.len() > 44 && audio.starts_with(b"RIFF") && audio.get(8..12) == Some(b"WAVE")
}

/// Writes a recording to a new file in `dir`, failing rather than replacing one.
fn save_recording(dir: &Path, base: &str, audio: &[u8]) -> Result<String, String> {
    use std::io::Write;
    fs::create_dir_all(dir).map_err(|_| "No se pudo crear la carpeta de voces de Lore.")?;
    let file = free_voice_file(dir, base).ok_or("Ya hay demasiadas voces con ese nombre en Lore.")?;
    let path = dir.join(&file);
    let mut out = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| "No se pudo guardar la grabación en Lore.")?;
    if out.write_all(audio).and_then(|_| out.sync_all()).is_err() {
        drop(out);
        let _ = fs::remove_file(&path);
        return Err("No se pudo guardar la grabación en Lore.".into());
    }
    Ok(file)
}

/// Saves a voice recorded in the app (a WAV in base64) into Lore's speaking or
/// singing voices and makes it Pluma's sample at once.
#[tauri::command]
pub async fn lore_voice_save(
    app: AppHandle,
    window: WebviewWindow,
    singing: Option<bool>,
    name: String,
    audio: String,
) -> Result<super::pluma_clone::ReferenceStatus, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    require_main(&window)?;
    let singing = singing.unwrap_or(false);
    let audio = STANDARD
        .decode(audio.as_bytes())
        .map_err(|_| "La grabación llegó dañada. Grábala de nuevo.")?;
    if !is_wav(&audio) || audio.len() as u64 > VOICE_LIMIT {
        return Err("La grabación no es un WAV válido de hasta 10 MB.".into());
    }
    let root = lore_root().ok_or("No se encontró la carpeta Lore del proyecto.")?;
    let dir = voices_dir(&root, singing);
    let base = voice_file_stem(&name);
    let (file, audio) = tokio::task::spawn_blocking(move || save_recording(&dir, &base, &audio).map(|file| (file, audio)))
        .await
        .map_err(|_| "No se pudo guardar la grabación en Lore.".to_string())??;
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
        fs::write(speaking.join("WhatsApp Audio.mp4"), &sample).unwrap();
        fs::write(voices_dir(&root, true).join("Canto.wav"), &sample).unwrap();
        let listed: Vec<_> = list_voices(&root, false).into_iter().map(|voice| (voice.name, voice.convert)).collect();
        let expected = [("Voz 2", false), ("Voz 10", false), ("WhatsApp Audio", true)].map(|(name, convert)| (name.to_string(), convert));
        assert_eq!(listed, expected);
        assert!(voice_file(&root, false, "WhatsApp Audio.mp4").is_ok());
        assert!(voice_file(&root, false, "notas.txt").is_err());
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
    fn a_recorded_voice_gets_a_safe_name_and_never_replaces_another() {
        assert_eq!(voice_file_stem("  Mi   voz\tnueva "), "Mi voz nueva");
        assert_eq!(voice_file_stem("..\\..\\sistema/voz:1?"), "sistema voz 1");
        assert_eq!(voice_file_stem(" ... "), "Mi voz");
        assert_eq!(voice_file_stem(&"a".repeat(200)).chars().count(), MAX_VOICE_NAME);
        let root = scratch("record");
        let wav = [b"RIFF".as_slice(), &[0; 4], b"WAVE", &[0; 40]].concat();
        assert!(is_wav(&wav));
        assert!(!is_wav(b"ID3 not a wav at all, just some bytes to pass the length check"));
        assert_eq!(save_recording(&root, "Mi voz", &wav).unwrap(), "Mi voz.wav");
        assert_eq!(save_recording(&root, "Mi voz", &wav).unwrap(), "Mi voz 2.wav");
        assert_eq!(fs::read(root.join("Mi voz.wav")).unwrap(), wav);
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
