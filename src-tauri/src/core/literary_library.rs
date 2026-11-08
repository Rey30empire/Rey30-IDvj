use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use tauri_plugin_agent_tools::tools::nofollow::{open_regular_capped, read_regular_capped};
use tauri_plugin_agent_tools::workspace::{pluma_library_root, set_pluma_library_root};
use tokio::sync::Mutex;
use zip::read::{ArchiveOffset, Config};
use zip::{CompressionMethod, ZipArchive};

const MAX_ENTRIES: usize = 30_000;
const MAX_DEPTH: usize = 32;
const MAX_FILE_BYTES: u64 = 12 * 1024 * 1024;
const MAX_INPUT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 128 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: usize = 12 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 192 * 1024 * 1024;
const MAX_ARCHIVE_TEXT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: u16 = 2_000;
const MAX_ARCHIVE_DIRECTORY_BYTES: u32 = 2 * 1024 * 1024;
const EXCERPT_BYTES: usize = 1_350;
const EXCERPT_OVERLAP: usize = 160;
const MAX_MATCHES: usize = 5;
const MAX_QUERY_BYTES: usize = 12_000;
const MAX_QUERY_TERMS: usize = 16;
const PLUMA_ID: &str = "character:literatura";
const ACCESS_DENIED: &str = "La biblioteca local está reservada a Pluma.";

static LIBRARY: Mutex<Option<LibraryIndex>> = Mutex::const_new(None);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStatus {
    root: String,
    indexed: bool,
    indexed_files: usize,
    skipped_files: usize,
    total_files: usize,
    physical_files: usize,
    archive_members: usize,
    indexed_archive_members: usize,
    unsupported_files: usize,
    unreadable_files: usize,
    limit_reached: bool,
}

impl LibraryStatus {
    fn empty() -> Self {
        Self {
            root: pluma_library_root().display().to_string(),
            indexed: false,
            indexed_files: 0,
            skipped_files: 0,
            total_files: 0,
            physical_files: 0,
            archive_members: 0,
            indexed_archive_members: 0,
            unsupported_files: 0,
            unreadable_files: 0,
            limit_reached: false,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySearch {
    #[serde(flatten)]
    status: LibraryStatus,
    matches: Vec<LibraryMatch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryMatch {
    path: String,
    start_line: usize,
    excerpt: String,
}

struct LibraryIndex {
    status: LibraryStatus,
    documents: Vec<Document>,
}

struct Document {
    path: String,
    name_terms: Vec<u64>,
    text: String,
    chunks: Vec<Chunk>,
}

struct Chunk {
    start: usize,
    end: usize,
    start_line: usize,
    terms: Vec<u64>,
}

/// The drive letter and folder names of a local `X:\a\b` path, or `None` for a
/// network share, a relative path, `.`/`..`, or a bare drive root (a library
/// at `D:\` would wall the whole drive off from every other tool).
#[cfg(windows)]
fn local_folder_parts(path: &Path) -> Option<(u8, Vec<String>)> {
    use std::path::Prefix;
    let mut parts = path.components();
    let letter = match parts.next()? {
        Component::Prefix(prefix) => match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => letter.to_ascii_uppercase(),
            _ => return None,
        },
        _ => return None,
    };
    if parts.next()? != Component::RootDir {
        return None;
    }
    let names = parts
        .map(|part| match part {
            Component::Normal(name) => Some(name.to_string_lossy().to_lowercase()),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    (!names.is_empty()).then_some((letter, names))
}

#[cfg(windows)]
fn library_root() -> Result<PathBuf, String> {
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;

    let path = pluma_library_root();
    let shown = path.display().to_string();
    let (letter, names) = local_folder_parts(&path)
        .ok_or("La biblioteca debe ser una carpeta dentro de una unidad local, por ejemplo D:\\Libreria General.")?;
    let drive = [letter as u16, b':' as u16, b'\\' as u16, 0];
    // SAFETY: the four UTF-16 code units are a terminated drive root.
    let drive_type = unsafe { GetDriveTypeW(drive.as_ptr()) };
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    if !matches!(drive_type, DRIVE_REMOVABLE | DRIVE_FIXED) {
        return Err(format!(
            "La biblioteca necesita que la unidad local {}: esté disponible.",
            letter as char
        ));
    }
    let metadata = fs::symlink_metadata(&path).map_err(|_| format!("No se encuentra {shown}."))?;
    if !metadata.is_dir() || is_link(&metadata) {
        return Err("La biblioteca debe ser una carpeta local sin redirecciones.".into());
    }
    let root = path
        .canonicalize()
        .map_err(|_| "No se pudo abrir la carpeta de la biblioteca.")?;
    // The resolved folder must be the one named: a junction anywhere on the
    // way would otherwise point Pluma (and the reservation) somewhere else.
    if local_folder_parts(&root) != Some((letter, names)) {
        return Err("La ubicación de la biblioteca no coincide con la carpeta autorizada.".into());
    }
    Ok(root)
}

#[cfg(not(windows))]
fn library_root() -> Result<PathBuf, String> {
    Err("La biblioteca local de Pluma está disponible en Windows.".into())
}

/// Where the folder chosen in the app is remembered between launches.
fn saved_root_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path().app_config_dir().ok().map(|dir| dir.join("pluma-library-root.txt"))
}

/// Restore the library folder chosen in an earlier session. Called at startup.
pub fn load_saved_library_root(app: &tauri::AppHandle) {
    let saved = saved_root_file(app)
        .and_then(|file| fs::read_to_string(file).ok())
        .map(|text| PathBuf::from(text.trim()))
        .filter(|path| path.is_absolute());
    set_pluma_library_root(saved);
}

/// Choose the folder Pluma's library is read from (`None` restores
/// `D:\Libreria General`). The folder is checked before it is saved, and the
/// index of the previous folder is dropped.
#[tauri::command]
pub async fn literary_library_set_root(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: Option<String>,
) -> Result<LibraryStatus, String> {
    if window.label() != "main" {
        return Err(ACCESS_DENIED.into());
    }
    let chosen = path
        .map(|value| PathBuf::from(value.trim()))
        .filter(|path| !path.as_os_str().is_empty());
    let mut cache = LIBRARY.lock().await;
    let previous = pluma_library_root();
    set_pluma_library_root(chosen.clone());
    if let Err(error) = tokio::task::spawn_blocking(library_root)
        .await
        .map_err(|_| "No se pudo comprobar la carpeta de la biblioteca.".to_string())
        .and_then(|result| result)
    {
        set_pluma_library_root(Some(previous));
        return Err(error);
    }
    let file = saved_root_file(&app).ok_or("No se pudo guardar la ubicación de la biblioteca.")?;
    let saved = match &chosen {
        Some(path) => fs::create_dir_all(file.parent().unwrap_or(Path::new(".")))
            .and_then(|_| fs::write(&file, path.to_string_lossy().as_bytes())),
        None => match fs::remove_file(&file) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        },
    };
    if saved.is_err() {
        set_pluma_library_root(Some(previous));
        return Err("No se pudo guardar la ubicación de la biblioteca.".into());
    }
    *cache = None;
    Ok(LibraryStatus::empty())
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn text_format(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "txt" | "md" | "pdf" | "docx" | "html" | "htm" | "pptx" | "csv"
    )
    .then_some(ext)
}

fn index_library(root: &Path) -> Result<LibraryIndex, String> {
    let mut status = LibraryStatus::empty();
    let mut files = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0)];
    let mut entries = 0;
    'scan: while let Some((directory, depth)) = stack.pop() {
        let children = match fs::read_dir(directory) {
            Ok(children) => children,
            Err(_) if depth == 0 => {
                return Err("No se pudo leer la carpeta de la biblioteca.".into())
            }
            Err(_) => {
                status.limit_reached = true;
                continue;
            }
        };
        for child in children {
            entries += 1;
            if entries > MAX_ENTRIES {
                status.limit_reached = true;
                break 'scan;
            }
            let Ok(child) = child else {
                status.limit_reached = true;
                continue;
            };
            let Ok(metadata) = child.metadata() else {
                status.limit_reached = true;
                continue;
            };
            let path = child.path();
            if metadata.is_dir() {
                if is_link(&metadata) || depth >= MAX_DEPTH {
                    status.limit_reached = true;
                } else {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            status.total_files += 1;
            if !metadata.is_file() || is_link(&metadata) {
                status.unreadable_files += 1;
                continue;
            }
            if path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
            {
                files.push((path, "zip".into()));
            } else if let Some(format) = text_format(&path) {
                files.push((path, format));
            } else {
                status.unsupported_files += 1;
            }
        }
    }
    files.sort_unstable_by(|left, right| left.0.cmp(&right.0));

    status.physical_files = status.total_files;
    let mut index = LibraryIndex {
        status,
        documents: Vec::new(),
    };
    let mut remaining_input = MAX_INPUT_BYTES;
    let mut remaining_text = MAX_TEXT_BYTES;
    for (path, format) in files {
        if remaining_input == 0 || remaining_text == 0 {
            index.status.limit_reached = true;
            break;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "Un archivo quedó fuera de la biblioteca.")?;
        let source = relative.to_string_lossy().replace('\\', "/");
        if format == "zip" {
            index.index_archive(&path, &source, &mut remaining_input, &mut remaining_text);
            continue;
        }
        let budget = remaining_input.min(MAX_FILE_BYTES);
        let Ok(bytes) = read_regular_capped(&path, budget) else {
            index.status.unreadable_files += 1;
            index.status.limit_reached |= budget < MAX_FILE_BYTES;
            continue;
        };
        remaining_input -= bytes.len() as u64;
        index.add_document(source, &format, &bytes, &mut remaining_text);
    }
    index.status.indexed = true;
    index.status.indexed_files = index.documents.len();
    index.status.skipped_files = index.status.total_files - index.status.indexed_files;
    Ok(index)
}

// Check the standard ZIP footer before asking the decoder to allocate a
// central directory. This library does not accept split, prefixed or ZIP64 archives.
fn allowed_zip_directory(file: &mut fs::File, size: u64) -> std::io::Result<bool> {
    let tail_size = size.min(42 + u16::MAX as u64);
    let mut tail = vec![0; tail_size as usize];
    file.seek(SeekFrom::Start(size - tail_size))?;
    file.read_exact(&mut tail)?;
    let Some((offset, footer)) = tail.windows(22).enumerate().rev().find(|(offset, footer)| {
        footer.starts_with(b"PK\x05\x06")
            && offset + 22 + u16::from_le_bytes([footer[20], footer[21]]) as usize == tail.len()
    }) else {
        return Ok(false);
    };
    let count = u16::from_le_bytes([footer[10], footer[11]]);
    let directory_size = u32::from_le_bytes([footer[12], footer[13], footer[14], footer[15]]);
    let directory_start = u32::from_le_bytes([footer[16], footer[17], footer[18], footer[19]]);
    let zip64 = offset >= 20 && tail[offset - 20..].starts_with(b"PK\x06\x07");
    Ok(!zip64
        && footer[4..8] == [0, 0, 0, 0]
        && footer[8..10] == footer[10..12]
        && count <= MAX_ARCHIVE_ENTRIES
        && directory_size <= MAX_ARCHIVE_DIRECTORY_BYTES
        && u64::from(directory_start) + u64::from(directory_size)
            == size - tail_size + offset as u64)
}

impl LibraryIndex {
    fn add_document(
        &mut self,
        path: String,
        format: &str,
        bytes: &[u8],
        remaining_text: &mut usize,
    ) -> bool {
        let text =
            std::panic::catch_unwind(|| tauri_plugin_rag::parse_document_bytes(bytes, format));
        let Ok(Ok(text)) = text else {
            self.status.unreadable_files += 1;
            return false;
        };
        let text = text.trim();
        if text.is_empty() || text.contains('\0') {
            self.status.unreadable_files += 1;
            return false;
        }
        if text.len() > MAX_EXTRACTED_BYTES || text.len() > *remaining_text {
            self.status.unreadable_files += 1;
            self.status.limit_reached = true;
            return false;
        }
        *remaining_text -= text.len();
        self.documents.push(Document {
            name_terms: terms(&path, usize::MAX),
            chunks: chunks(text),
            text: text.to_owned(),
            path,
        });
        true
    }

    fn index_archive(
        &mut self,
        path: &Path,
        source: &str,
        remaining_input: &mut u64,
        remaining_text: &mut usize,
    ) {
        let budget = (*remaining_input).min(MAX_ARCHIVE_BYTES);
        let archive = (|| -> Option<_> {
            let mut file = open_regular_capped(path, budget).ok()?;
            let size = file.metadata().ok()?.len();
            *remaining_input -= size;
            if !allowed_zip_directory(&mut file, size).ok()? {
                return None;
            }
            ZipArchive::with_config(
                Config {
                    archive_offset: ArchiveOffset::Known(0),
                },
                file,
            )
            .ok()
        })();
        let Some(mut archive) =
            archive.filter(|archive| archive.len() <= MAX_ARCHIVE_ENTRIES as usize)
        else {
            self.status.unreadable_files += 1;
            self.status.limit_reached = true;
            return;
        };
        // Count regular members as sources. The container itself is not a text source.
        self.status.total_files -= 1;
        let mut archive_remaining = MAX_ARCHIVE_TEXT_BYTES;
        for i in 0..archive.len() {
            let Ok(raw) = archive.by_index_raw(i) else {
                self.status.limit_reached = true;
                continue;
            };
            if raw.is_dir() {
                continue;
            }
            self.status.archive_members += 1;
            self.status.total_files += 1;
            let Some(name) = raw.enclosed_name().filter(|name| {
                name.components()
                    .all(|part| matches!(part, Component::Normal(_)))
            }) else {
                self.status.unreadable_files += 1;
                continue;
            };
            let Some(format) = text_format(&name) else {
                self.status.unsupported_files += 1;
                continue;
            };
            if raw.encrypted()
                || raw.is_symlink()
                || !matches!(
                    raw.compression(),
                    CompressionMethod::Stored | CompressionMethod::Deflated
                )
            {
                self.status.unreadable_files += 1;
                continue;
            }
            let limit = archive_remaining.min(MAX_FILE_BYTES);
            if raw.size() > limit || *remaining_text == 0 {
                self.status.limit_reached = true;
                continue;
            }
            drop(raw);
            let Ok(member) = archive.by_index(i) else {
                self.status.unreadable_files += 1;
                continue;
            };
            let mut bytes = Vec::new();
            if member.take(limit + 1).read_to_end(&mut bytes).is_err() || bytes.len() as u64 > limit
            {
                self.status.unreadable_files += 1;
                self.status.limit_reached = true;
                continue;
            }
            archive_remaining -= bytes.len() as u64;
            let name = name.to_string_lossy().replace('\\', "/");
            if self.add_document(format!("{source}::{name}"), &format, &bytes, remaining_text) {
                self.status.indexed_archive_members += 1;
            }
        }
    }
}

fn folded_char(c: char) -> char {
    match c {
        'á' => 'a',
        'é' => 'e',
        'í' => 'i',
        'ó' => 'o',
        'ú' | 'ü' => 'u',
        _ => c,
    }
}

fn terms(text: &str, limit: usize) -> Vec<u64> {
    let folded: String = text
        .chars()
        .flat_map(char::to_lowercase)
        .map(folded_char)
        .collect();
    let mut tokens = Vec::new();
    for word in folded.split(|c: char| !c.is_alphanumeric()) {
        if word.len() < 3
            || word.len() > 70
            || matches!(
                word,
                "ante"
                    | "aqui"
                    | "asi"
                    | "con"
                    | "como"
                    | "cual"
                    | "cuales"
                    | "del"
                    | "desde"
                    | "donde"
                    | "ella"
                    | "ellas"
                    | "ello"
                    | "ellos"
                    | "entre"
                    | "esa"
                    | "esas"
                    | "eso"
                    | "esta"
                    | "este"
                    | "estos"
                    | "esto"
                    | "han"
                    | "hace"
                    | "hacer"
                    | "las"
                    | "los"
                    | "mas"
                    | "mientras"
                    | "mis"
                    | "muy"
                    | "nos"
                    | "otra"
                    | "otro"
                    | "para"
                    | "pero"
                    | "por"
                    | "que"
                    | "quien"
                    | "sea"
                    | "ser"
                    | "sin"
                    | "sobre"
                    | "son"
                    | "sus"
                    | "tambien"
                    | "tan"
                    | "tengo"
                    | "tiene"
                    | "todo"
                    | "tras"
                    | "tres"
                    | "tus"
                    | "una"
                    | "uno"
                    | "unos"
                    | "unas"
                    | "vez"
                    | "quiero"
                    | "puedes"
                    | "busca"
                    | "buscar"
                    | "escribe"
                    | "escribeme"
                    | "crea"
                    | "dime"
                    | "hazme"
                    | "prepara"
                    | "biblioteca"
                    | "libreria"
                    | "general"
                    | "txt"
                    | "pdf"
                    | "html"
                    | "docx"
                    | "pptx"
            )
        {
            continue;
        }
        let stem = if word.len() > 5 {
            word.strip_suffix('s').unwrap_or(word)
        } else {
            word
        };
        let mut hasher = DefaultHasher::new();
        stem.hash(&mut hasher);
        let value = hasher.finish();
        if limit == usize::MAX || !tokens.contains(&value) {
            tokens.push(value);
            if tokens.len() == limit {
                break;
            }
        }
    }
    tokens.sort_unstable();
    tokens.dedup();
    tokens
}

fn char_boundary(text: &str, mut at: usize) -> usize {
    while !text.is_char_boundary(at) {
        at -= 1;
    }
    at
}

fn chunks(text: &str) -> Vec<Chunk> {
    let mut result = Vec::new();
    let mut start = 0;
    let mut start_line = 1;
    while start < text.len() {
        let mut end = char_boundary(text, (start + EXCERPT_BYTES).min(text.len()));
        if end < text.len() {
            if let Some(cut) = text[start..end].rfind('\n') {
                if cut > EXCERPT_BYTES / 2 {
                    end = start + cut + 1;
                }
            }
        }
        result.push(Chunk {
            start,
            end,
            start_line,
            terms: terms(&text[start..end], usize::MAX),
        });
        if end == text.len() {
            break;
        }
        let next = char_boundary(text, end - EXCERPT_OVERLAP);
        start_line += text.as_bytes()[start..next]
            .iter()
            .filter(|&&c| c == b'\n')
            .count();
        start = next;
    }
    result
}

fn hit_count(terms: &[u64], query: &[u64]) -> usize {
    query
        .iter()
        .filter(|word| terms.binary_search(word).is_ok())
        .count()
}

impl LibraryIndex {
    fn search(&self, query: &str) -> Vec<LibraryMatch> {
        let query = terms(
            &query[..char_boundary(query, MAX_QUERY_BYTES.min(query.len()))],
            MAX_QUERY_TERMS,
        );
        if query.is_empty() {
            return Vec::new();
        }
        let mut hits = Vec::new();
        for document in &self.documents {
            let title_hits = hit_count(&document.name_terms, &query);
            let best = document
                .chunks
                .iter()
                .map(|chunk| {
                    let body_hits = hit_count(&chunk.terms, &query);
                    let coverage = query
                        .iter()
                        .filter(|word| {
                            document.name_terms.binary_search(word).is_ok()
                                || chunk.terms.binary_search(word).is_ok()
                        })
                        .count();
                    let score = coverage * coverage * 5 + title_hits * 7 + body_hits * 3;
                    (score, chunk)
                })
                .max_by_key(|(score, chunk)| (*score, std::cmp::Reverse(chunk.start)));
            if let Some((score, chunk)) = best.filter(|(score, _)| *score > 0) {
                hits.push((score, document, chunk));
            }
        }
        hits.sort_unstable_by(|left, right| {
            right
                .0
                .cmp(&left.0)
                .then_with(|| left.1.path.cmp(&right.1.path))
        });
        let mut results: Vec<LibraryMatch> = Vec::new();
        for (_, document, chunk) in hits {
            let excerpt = &document.text[chunk.start..chunk.end];
            if results.iter().any(|item| item.excerpt == excerpt) {
                continue;
            }
            results.push(LibraryMatch {
                path: document.path.clone(),
                start_line: chunk.start_line,
                excerpt: excerpt.to_owned(),
            });
            if results.len() == MAX_MATCHES {
                break;
            }
        }
        results
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LibraryAccess {
    Chat { thread_id: String },
    Clone { session_id: String },
    Realtime { session_id: String },
}

impl LibraryAccess {
    async fn authorize<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>) -> Result<(), String> {
        let allowed = match self {
            Self::Chat { thread_id } => {
                crate::core::threads::commands::get_thread_assistant(app.clone(), thread_id.clone())
                    .await
                    .is_ok_and(|assistant| {
                        assistant.get("id").and_then(serde_json::Value::as_str) == Some(PLUMA_ID)
                    })
            }
            Self::Clone { session_id } => {
                crate::core::system::pluma_clone::library_session_active(session_id)
            }
            Self::Realtime { session_id } => {
                crate::core::system::pluma_realtime::library_session_active(session_id)
            }
        };
        if allowed {
            Ok(())
        } else {
            Err(ACCESS_DENIED.into())
        }
    }
}

#[tauri::command]
pub async fn literary_library_status(
    window: tauri::WebviewWindow,
    refresh: Option<bool>,
) -> Result<LibraryStatus, String> {
    if window.label() != "main" {
        return Err(ACCESS_DENIED.into());
    }
    let mut cache = LIBRARY.lock().await;
    tokio::task::spawn_blocking(move || {
        let root = library_root()?;
        if refresh.unwrap_or(false) {
            // Drop the old index before rebuilding to keep peak memory bounded.
            *cache = None;
            *cache = Some(index_library(&root)?);
        }
        Ok(cache
            .as_ref()
            .map_or_else(LibraryStatus::empty, |index| index.status.clone()))
    })
    .await
    .map_err(|_| "No se pudo consultar el índice de la biblioteca.")?
}

#[tauri::command]
pub async fn literary_library_search(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    query: String,
    access: LibraryAccess,
) -> Result<LibrarySearch, String> {
    if window.label() != "main" {
        return Err(ACCESS_DENIED.into());
    }
    access.authorize(&app).await?;
    let mut cache = LIBRARY.lock().await;
    let result = tokio::task::spawn_blocking(move || -> Result<LibrarySearch, String> {
        let root = library_root()?;
        if cache.is_none() {
            *cache = Some(index_library(&root)?);
        }
        let index = cache
            .as_ref()
            .ok_or("El índice local de la biblioteca no está disponible.")?;
        let matches = index.search(&query);
        Ok(LibrarySearch {
            status: index.status.clone(),
            matches,
        })
    })
    .await
    .map_err(|_| "No se pudo buscar en la biblioteca.")??;
    access.authorize(&app).await?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn requires_an_explicit_thread_or_voice_session() {
        use serde_json::{from_value, json};

        assert!(matches!(from_value::<LibraryAccess>(json!({"kind": "chat", "threadId": "thread-1"})),
            Ok(LibraryAccess::Chat { thread_id }) if thread_id == "thread-1"));
        assert!(matches!(from_value::<LibraryAccess>(json!({"kind": "clone", "sessionId": "session-1"})),
            Ok(LibraryAccess::Clone { session_id }) if session_id == "session-1"));
        assert!(from_value::<LibraryAccess>(json!({"kind": "chat", "assistantId": PLUMA_ID})).is_err());
        assert!(from_value::<LibraryAccess>(json!({"kind": "realtime"})).is_err());
    }

    #[tokio::test]
    async fn native_authorization_checks_persisted_pluma_and_rejects_aliases() {
        use crate::core::threads::commands::{create_thread, delete_thread, modify_thread};
        use serde_json::json;

        let app = tauri::test::mock_app();
        let handle = app.handle();
        let mut thread = create_thread(handle.clone(), json!({
            "assistants": [{ "id": PLUMA_ID, "name": "Nombre editado" }],
            "metadata": { "literaryLibrary": true },
        }))
        .await
        .unwrap();
        let thread_id = thread["id"].as_str().unwrap().to_owned();
        let chat = LibraryAccess::Chat { thread_id: thread_id.clone() };
        assert!(chat.authorize(handle).await.is_ok());

        thread["assistants"][0] = json!({ "id": "character:otro", "name": "Pluma" });
        modify_thread(handle.clone(), thread).await.unwrap();
        assert_eq!(chat.authorize(handle).await.unwrap_err(), ACCESS_DENIED);

        for session in [
            LibraryAccess::Clone { session_id: "session-unknown".into() },
            LibraryAccess::Realtime { session_id: "session-unknown".into() },
        ] {
            assert_eq!(session.authorize(handle).await.unwrap_err(), ACCESS_DENIED);
        }
        delete_thread(handle.clone(), thread_id).await.unwrap();
    }

    #[test]
    fn searches_a_later_passage_and_keeps_its_relative_source() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let folder = root.join("Ficción");
        fs::create_dir(&folder).unwrap();
        let unrelated = "Otro pasaje de la novela que habla de un parque.\n";
        let needle = "La protagonista vio una metáfora del miedo detrás del espejo.";
        fs::write(folder.join("novela.md"), unrelated.repeat(120) + needle).unwrap();
        fs::write(root.join("otra.md"), "El parque tiene una fuente antigua.").unwrap();
        fs::write(root.join("ignorada.png"), "Este archivo no aporta pasajes.").unwrap();
        let index = index_library(&root).unwrap();
        assert_eq!(index.status.total_files, 3);
        assert_eq!(index.status.indexed_files, 2);
        assert_eq!(index.status.unsupported_files, 1);
        let hits = index.search("Busca metafora del miedo");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "Ficción/novela.md");
        assert!(hits[0].start_line > 90);
        assert!(hits[0].excerpt.contains(needle));
        assert!(hits[0].excerpt.len() <= EXCERPT_BYTES);
        assert!(index.search("sin resultados extraterrestres").is_empty());
    }

    #[test]
    fn excludes_hardlinks_and_rejects_reads_past_the_cap() {
        let fixture = tempfile::tempdir().unwrap();
        let canonical = fixture.path().canonicalize().unwrap();
        let root = canonical.join("library");
        fs::create_dir(&root).unwrap();
        let outside = canonical.join("outside.txt");
        let inside = root.join("inside.txt");
        fs::write(&outside, "secretoinaccesible").unwrap();
        fs::hard_link(&outside, root.join("linked.txt")).unwrap();
        fs::write(&inside, "poema del sol").unwrap();
        assert!(read_regular_capped(&inside, 1).is_err());
        let index = index_library(&root).unwrap();
        assert_eq!(index.status.indexed_files, 1);
        assert_eq!(index.status.unreadable_files, 1);
        assert!(index.search("secretoinaccesible").is_empty());
    }

    #[test]
    fn reads_html_as_text_and_bounds_deduplicated_results() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        fs::write(
            root.join("poema.html"),
            "<h1>Rosa</h1><p>Un verso para el amanecer.</p>",
        )
        .unwrap();
        for i in 0..10 {
            fs::write(
                root.join(format!("poema-{i}.txt")),
                format!("Verso {i} del amanecer."),
            )
            .unwrap();
        }
        fs::write(root.join("copia.txt"), "Verso 0 del amanecer.").unwrap();
        let index = index_library(&root).unwrap();
        let html = index.search("rosa");
        assert_eq!(html.len(), 1);
        assert!(!html[0].excerpt.contains("<h1>"));
        assert_eq!(index.search("verso amanecer").len(), MAX_MATCHES);
        assert_eq!(
            index
                .search("verso 0 amanecer")
                .iter()
                .filter(|hit| hit.excerpt == "Verso 0 del amanecer.")
                .count(),
            1
        );
    }

    #[test]
    fn reads_zip_members_without_extracting_and_excludes_unsafe_names() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let path = root.join("cartas.zip");
        let mut archive = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        archive.start_file("cartas/amanecer.txt", options).unwrap();
        archive
            .write_all("Una carta de amor para el primer amanecer.".as_bytes())
            .unwrap();
        archive.start_file("../escape.txt", options).unwrap();
        archive.write_all(b"fueradelabiblioteca").unwrap();
        archive.start_file("nested.zip", options).unwrap();
        archive.write_all(b"unsupported").unwrap();
        archive.finish().unwrap();
        let index = index_library(&root).unwrap();
        assert_eq!(index.status.physical_files, 1);
        assert_eq!(index.status.archive_members, 3);
        assert_eq!(index.status.indexed_archive_members, 1);
        assert_eq!(index.status.indexed_files, 1);
        let hits = index.search("amor amanecer");
        assert_eq!(hits[0].path, "cartas.zip::cartas/amanecer.txt");
        assert!(index.search("fueradelabiblioteca").is_empty());
        assert_eq!(fs::read_dir(root).unwrap().count(), 1);
    }

    #[test]
    #[ignore = "requires the owner's local library"]
    fn owner_library_read_only_inventory() {
        let root = library_root().unwrap();
        let start = std::time::Instant::now();
        let index = index_library(&root).unwrap();
        println!(
            "Índice local en {} ms. {}",
            start.elapsed().as_millis(),
            serde_json::to_string(&index.status).unwrap()
        );
        assert!(index.status.indexed_files > 0);
        for (category, query) in [
            ("novela", "novela psicologica"),
            ("carta", "carta amor"),
            ("poema", "poema amor"),
        ] {
            let start = std::time::Instant::now();
            let hits = index.search(query);
            println!(
                "{category}: {} pasajes, {} ms",
                hits.len(),
                start.elapsed().as_millis()
            );
            assert!(!hits.is_empty());
        }
    }
}
