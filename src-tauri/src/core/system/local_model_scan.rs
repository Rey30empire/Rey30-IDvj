//! "Modelos del PC": finds the GGUF models already on this computer, so one
//! click can load them on the GPU instead of going through the import dialog.
//!
//! The walk is bounded on purpose. It looks where models usually live: the
//! shared models folder (`models_root`), the app's own llama.cpp models,
//! LM Studio, the Hugging Face cache and Downloads, and on Windows the root of
//! each fixed drive plus a couple of levels into the folders there whose names
//! say they hold models. It never follows symlinks or junctions, skips system
//! and tooling folders, never opens an "online-only" cloud file (reading it
//! would download it), and stops at an entry count and a time limit.
//!
//! The scan also decides what the web view may read afterwards. Loading a
//! model imports it in place, which stats the file through the read-grant
//! scope, so [`local_models_allow`] grants exactly the files the last scan
//! returned for that model, the same way a pick in the import dialog does.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, WebviewWindow};

/// How long one scan may take before it stops and reports what it found.
const TIME_LIMIT: Duration = Duration::from_secs(5);
/// Folder entries looked at per scan, across every root.
const MAX_ENTRIES: usize = 60_000;
/// Models returned per scan.
const MAX_MODELS: usize = 500;

/// Folders never walked into, compared lowercase. Names starting with `.` or
/// `$` (`.git`, `$Recycle.Bin`) are skipped as well; see [`skipped_folder`].
const SKIPPED_FOLDERS: &[&str] = &[
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
    "system volume information",
    "recovery",
    "perflogs",
    "appdata",
    "node_modules",
    "__pycache__",
    "site-packages",
    "venv",
];

/// Words that make a folder at the root of a drive worth a look.
const MODEL_FOLDER_WORDS: &[&str] = &[
    "ai",
    "ia",
    "llm",
    "llms",
    "gguf",
    "model",
    "models",
    "modelo",
    "modelos",
    "lmstudio",
    "huggingface",
    "hf",
    "llama",
    "llamacpp",
    "koboldcpp",
    "gpt4all",
];

/// Name parts of files that are not chat models on their own: speculative
/// draft heads, importance matrices and LoRA adapters.
const HELPER_PARTS: &[&str] = &["mtp", "dflash", "dspark", "eagle", "imatrix", "lora"];

/// `general.architecture` values of GGUF files llama.cpp cannot chat with:
/// the image and video diffusion models ComfyUI-GGUF converts.
const DIFFUSION_ARCHITECTURES: &[&str] = &[
    "flux",
    "sd1",
    "sd2",
    "sd3",
    "sdxl",
    "aura",
    "hidream",
    "cosmos",
    "ltxv",
    "hyvid",
    "wan",
    "lumina2",
    "chroma",
    "qwen_image",
];

/// One model found on disk.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    /// Readable name: the file name without `.gguf`, or the folder's name for
    /// a file called `model.gguf`.
    name: String,
    file_name: String,
    /// Full path of the file to load (the first part of a split model).
    path: String,
    /// The folder that holds it.
    folder: String,
    /// Bytes on disk, every part of a split model included.
    size_bytes: u64,
    /// Parts of a split model; 1 for a single file.
    shard_count: u32,
    /// The vision projector (`mmproj-*.gguf`) paired with it, if any.
    projector_path: Option<String>,
    /// Id of the llama.cpp model already registered for this file.
    installed_model_id: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelScan {
    models: Vec<LocalModel>,
    /// The places that were looked at and exist.
    searched_folders: Vec<String>,
    /// The scan stopped early (time, entry or model limit).
    truncated: bool,
    elapsed_ms: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AllowedLocalModel {
    path: String,
    projector_path: Option<String>,
}

/// Where to look and how deep.
#[derive(Debug, Clone)]
pub(crate) struct ScanRoot {
    path: PathBuf,
    /// Folder levels below `path` to descend; 0 reads only `path` itself.
    max_depth: usize,
    /// At the first level, only enter folders whose names look like they
    /// hold models (the root of a drive).
    model_folders_only: bool,
    /// Folders to leave out at the first level, lowercase.
    skip_top: &'static [&'static str],
}

impl ScanRoot {
    fn new(path: PathBuf, max_depth: usize) -> Self {
        Self {
            path,
            max_depth,
            model_folders_only: false,
            skip_top: &[],
        }
    }
}

/// Limits of one walk.
pub(crate) struct Budget {
    deadline: Instant,
    max_entries: usize,
    max_models: usize,
    entries: usize,
    exhausted: bool,
}

impl Budget {
    #[cfg(test)]
    fn new(time: Duration, max_entries: usize, max_models: usize) -> Self {
        Self::until(Instant::now() + time, max_entries, max_models)
    }

    fn until(deadline: Instant, max_entries: usize, max_models: usize) -> Self {
        Self {
            deadline,
            max_entries,
            max_models,
            entries: 0,
            exhausted: false,
        }
    }

    /// Counts one folder entry; false once the scan must stop.
    fn take_entry(&mut self) -> bool {
        if self.exhausted {
            return false;
        }
        self.entries += 1;
        if self.entries > self.max_entries || Instant::now() >= self.deadline {
            self.exhausted = true;
        }
        !self.exhausted
    }
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Busca los modelos del PC desde la ventana principal.".into());
    }
    Ok(())
}

/// The key two spellings of one path share: on Windows, whose file systems
/// ignore case and take either slash, lowercase with backslashes; and never a
/// trailing separator.
fn path_key(path: &Path) -> String {
    let text = path.to_string_lossy();
    let text = text.trim_end_matches(['\\', '/']);
    if cfg!(windows) {
        text.replace('/', "\\").to_lowercase()
    } else {
        text.to_string()
    }
}

fn skipped_folder(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with('.') || lower.starts_with('$') || SKIPPED_FOLDERS.contains(&lower.as_str())
}

/// Whether a folder at the root of a drive looks like it holds models:
/// `D:\Modelos`, `E:\AI`, `D:\LLM-gguf`, `C:\Modelos IA Rey30`, `D:\lmstudio`.
pub(crate) fn looks_like_model_folder(name: &str) -> bool {
    let lower = name.to_lowercase();
    if lower.contains("model") || lower.contains("lmstudio") || lower.contains("lm studio") {
        return true;
    }
    lower
        .split(|c: char| !c.is_alphanumeric())
        .any(|word| MODEL_FOLDER_WORDS.contains(&word))
}

fn name_parts(lower: &str) -> impl Iterator<Item = &str> {
    lower.split(['-', '_', '.', ' '])
}

/// `name-00001-of-00003` → (`name`, 1, 3), the way llama.cpp names the parts
/// of a split model.
fn split_part(stem: &str) -> Option<(&str, u32, u32)> {
    const TAIL: usize = "-00001-of-00003".len();
    if stem.len() <= TAIL || !stem.is_char_boundary(stem.len() - TAIL) {
        return None;
    }
    let (base, tail) = stem.split_at(stem.len() - TAIL);
    let tail = tail.as_bytes();
    let digits = |range: std::ops::Range<usize>| -> Option<u32> {
        let part = &tail[range];
        if !part.iter().all(u8::is_ascii_digit) {
            return None;
        }
        std::str::from_utf8(part).ok()?.parse().ok()
    };
    if tail[0] != b'-' || &tail[6..10] != b"-of-" {
        return None;
    }
    let index = digits(1..6)?;
    let total = digits(10..15)?;
    (index >= 1 && total >= index).then_some((base, index, total))
}

fn is_projector_name(lower: &str) -> bool {
    name_parts(lower).any(|part| part == "mmproj")
}

/// Files that are not chat models: helpers and text-to-speech voices.
fn is_helper_name(lower: &str) -> bool {
    lower.contains("tts") || name_parts(lower).any(|part| HELPER_PARTS.contains(&part))
}

/// What the first bytes of a GGUF file say: its size when it is one, and its
/// `general.architecture` when that comes first among the metadata keys (as
/// every converter writes it).
fn read_gguf(path: &Path) -> Option<(u64, Option<String>)> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() < 24 {
        return None;
    }
    let mut file = fs::File::open(path).ok()?.take(64 * 1024);
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).ok()?;
    if &magic != b"GGUF" {
        return None;
    }
    Some((metadata.len(), read_architecture(&mut file)))
}

/// Reads `general.architecture` from the key/value list after the magic.
/// Gives up (None) on anything unexpected: the answer is only a hint.
fn read_architecture(reader: &mut impl Read) -> Option<String> {
    fn u32_le(reader: &mut impl Read) -> Option<u32> {
        let mut b = [0u8; 4];
        reader.read_exact(&mut b).ok()?;
        Some(u32::from_le_bytes(b))
    }
    fn u64_le(reader: &mut impl Read) -> Option<u64> {
        let mut b = [0u8; 8];
        reader.read_exact(&mut b).ok()?;
        Some(u64::from_le_bytes(b))
    }
    fn string(reader: &mut impl Read) -> Option<String> {
        let len = u64_le(reader)?;
        if len > 4096 {
            return None;
        }
        let mut bytes = vec![0u8; len as usize];
        reader.read_exact(&mut bytes).ok()?;
        String::from_utf8(bytes).ok()
    }

    let version = u32_le(reader)?;
    if version < 2 {
        return None;
    }
    let _tensors = u64_le(reader)?;
    let kv_count = u64_le(reader)?;
    for _ in 0..kv_count.min(32) {
        let key = string(reader)?;
        let value_type = u32_le(reader)?;
        if key == "general.architecture" {
            return (value_type == 8).then(|| string(reader)).flatten();
        }
        let skip = match value_type {
            0 | 1 | 7 => 1,
            2 | 3 => 2,
            4..=6 => 4,
            10..=12 => 8,
            8 => {
                string(reader)?;
                0
            }
            _ => return None, // arrays come after the architecture in practice
        };
        let mut sink = vec![0u8; skip];
        reader.read_exact(&mut sink).ok()?;
    }
    None
}

/// A `.gguf` file seen in one folder.
struct Candidate {
    path: PathBuf,
    file_name: String,
    lower_stem: String,
    size: u64,
}

/// Picks the projector for a model among those in its folder: the only one,
/// or the one whose name (without `mmproj` and precision words) is part of the
/// model's name. Several unnamed ones are the same projector in different
/// precisions, so f16 wins, else the first by name.
fn pick_projector<'a>(model_stem: &str, projectors: &'a [Candidate]) -> Option<&'a Candidate> {
    if projectors.len() <= 1 {
        return projectors.first();
    }
    let core = |stem: &str| {
        name_parts(stem)
            .filter(|part| {
                !part.is_empty()
                    && !matches!(
                        *part,
                        "mmproj" | "model" | "f16" | "f32" | "bf16" | "fp16" | "q8" | "0"
                    )
            })
            .collect::<Vec<_>>()
            .join("-")
    };
    let model_core = core(model_stem);
    let named = projectors
        .iter()
        .map(|p| (p, core(&p.lower_stem)))
        .filter(|(_, c)| !c.is_empty() && model_core.contains(c.as_str()))
        .max_by_key(|(_, c)| c.len())
        .map(|(p, _)| p);
    if named.is_some() {
        return named;
    }
    if projectors.iter().all(|p| core(&p.lower_stem).is_empty()) {
        return projectors
            .iter()
            .find(|p| name_parts(&p.lower_stem).any(|part| part == "f16"))
            .or_else(|| {
                projectors
                    .iter()
                    .min_by(|a, b| a.file_name.cmp(&b.file_name))
            });
    }
    None
}

fn display_name(file_name: &str, folder: &Path) -> String {
    let stem = file_name
        .get(..file_name.len().saturating_sub(".gguf".len()))
        .unwrap_or(file_name);
    let stem = split_part(stem).map_or(stem, |(base, _, _)| base);
    if stem.eq_ignore_ascii_case("model") {
        if let Some(folder_name) = folder.file_name() {
            return folder_name.to_string_lossy().into_owned();
        }
    }
    stem.to_string()
}

/// Turns the `.gguf` files of one folder into models: projectors are paired
/// instead of listed, later parts of a split model are counted into the first.
fn models_in_folder(
    folder: &Path,
    candidates: Vec<Candidate>,
    installed: &HashMap<String, String>,
    out: &mut Vec<LocalModel>,
) {
    let mut projectors = Vec::new();
    let mut models = Vec::new();
    let mut later_parts: HashMap<String, u64> = HashMap::new();
    for candidate in candidates {
        if is_projector_name(&candidate.lower_stem) {
            projectors.push(candidate);
            continue;
        }
        match split_part(&candidate.lower_stem) {
            Some((base, index, _)) if index > 1 => {
                *later_parts.entry(base.to_string()).or_default() += candidate.size;
            }
            _ => models.push(candidate),
        }
    }
    projectors.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    for model in models {
        let (size_bytes, shard_count) = match split_part(&model.lower_stem) {
            Some((base, _, total)) => (
                model.size + later_parts.get(base).copied().unwrap_or(0),
                total,
            ),
            None => (model.size, 1),
        };
        let projector = pick_projector(&model.lower_stem, &projectors);
        out.push(LocalModel {
            name: display_name(&model.file_name, folder),
            file_name: model.file_name.clone(),
            path: model.path.to_string_lossy().into_owned(),
            folder: folder.to_string_lossy().into_owned(),
            size_bytes,
            shard_count,
            projector_path: projector.map(|p| p.path.to_string_lossy().into_owned()),
            installed_model_id: installed.get(&path_key(&model.path)).cloned(),
        });
    }
}

/// A link, a junction or a cloud file whose data is not on this disk.
#[cfg(windows)]
fn is_link_or_online_only(entry: &fs::DirEntry) -> bool {
    use std::os::windows::fs::MetadataExt;
    const REPARSE_POINT: u32 = 0x400;
    const OFFLINE: u32 = 0x1000;
    const RECALL_ON_OPEN: u32 = 0x4_0000;
    const RECALL_ON_DATA_ACCESS: u32 = 0x40_0000;
    entry.metadata().map_or(true, |m| {
        m.file_attributes() & (REPARSE_POINT | OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS)
            != 0
    })
}

#[cfg(not(windows))]
fn is_link_or_online_only(_entry: &fs::DirEntry) -> bool {
    false
}

/// Walks one root. Returns false when the budget ran out.
fn walk(
    root: &ScanRoot,
    budget: &mut Budget,
    visited: &mut HashSet<String>,
    installed: &HashMap<String, String>,
    out: &mut Vec<LocalModel>,
) -> bool {
    let mut pending = vec![(root.path.clone(), 0usize)];
    while let Some((folder, depth)) = pending.pop() {
        if !visited.insert(path_key(&folder)) {
            continue;
        }
        let Ok(entries) = fs::read_dir(&folder) else {
            continue;
        };
        let mut candidates = Vec::new();
        let mut complete = true;
        for entry in entries.flatten() {
            if !budget.take_entry() {
                complete = false;
                break;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() || is_link_or_online_only(&entry) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if kind.is_dir() {
                let lower = name.to_lowercase();
                let wanted = depth < root.max_depth
                    && !skipped_folder(&name)
                    && !(depth == 0 && root.skip_top.contains(&lower.as_str()))
                    && (!root.model_folders_only || depth > 0 || looks_like_model_folder(&name));
                if wanted {
                    pending.push((entry.path(), depth + 1));
                }
                continue;
            }
            let lower = name.to_lowercase();
            let Some(lower_stem) = lower.strip_suffix(".gguf") else {
                continue;
            };
            if !kind.is_file() || is_helper_name(lower_stem) {
                continue;
            }
            let path = entry.path();
            let Some((size, architecture)) = read_gguf(&path) else {
                continue;
            };
            let lower_stem = match architecture.as_deref() {
                Some(arch) if DIFFUSION_ARCHITECTURES.contains(&arch) => continue,
                // A projector whose name does not say so.
                Some("clip") if !is_projector_name(lower_stem) => format!("mmproj-{lower_stem}"),
                _ => lower_stem.to_string(),
            };
            candidates.push(Candidate {
                path,
                file_name: name,
                lower_stem,
                size,
            });
        }
        models_in_folder(&folder, candidates, installed, out);
        if out.len() >= budget.max_models {
            out.truncate(budget.max_models);
            return false;
        }
        if !complete {
            return false;
        }
    }
    true
}

/// Walks `roots` in order until one runs out of budget. Returns whether all
/// of them were walked to the end.
fn walk_roots(
    roots: &[ScanRoot],
    budget: &mut Budget,
    visited: &mut HashSet<String>,
    installed: &HashMap<String, String>,
    out: &mut Vec<LocalModel>,
) -> bool {
    roots
        .iter()
        .all(|root| walk(root, budget, visited, installed, out))
}

/// One entry per file, sorted by name, at most `max_models`.
fn finish(mut models: Vec<LocalModel>, max_models: usize) -> Vec<LocalModel> {
    let mut seen = HashSet::new();
    models.retain(|model| seen.insert(path_key(Path::new(&model.path))));
    models.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    models.truncate(max_models);
    models
}

/// Scans `roots` in order, on this thread. Returns the models found, sorted
/// by name, and whether the scan stopped early. The walk rules' tests use it;
/// the command goes through [`scan_pc`].
#[cfg(test)]
fn scan(
    roots: &[ScanRoot],
    installed: &HashMap<String, String>,
    budget: &mut Budget,
) -> (Vec<LocalModel>, bool) {
    let mut visited = HashSet::new();
    let mut models = Vec::new();
    let complete = walk_roots(roots, budget, &mut visited, installed, &mut models);
    (finish(models, budget.max_models), !complete)
}

/// The whole scan: the likely places first, in order, then every drive on a
/// thread of its own. A drive that has to spin up blocks inside the system
/// call where no time check can reach it, so the answer is given at the
/// deadline with whatever the other drives found; a late thread stops at its
/// next entry and its result is dropped.
pub(crate) fn scan_pc(
    likely: &[ScanRoot],
    drives: Vec<ScanRoot>,
    installed: HashMap<String, String>,
    time: Duration,
    max_entries: usize,
    max_models: usize,
) -> (Vec<LocalModel>, bool) {
    use std::sync::{mpsc, Arc};

    let deadline = Instant::now() + time;
    let mut budget = Budget::until(deadline, max_entries, max_models);
    let mut visited = HashSet::new();
    let mut models = Vec::new();
    if !walk_roots(likely, &mut budget, &mut visited, &installed, &mut models) {
        return (finish(models, max_models), true);
    }

    let visited = Arc::new(visited);
    let installed = Arc::new(installed);
    let (sender, receiver) = mpsc::channel();
    for drive in drives {
        let (sender, visited, installed) = (sender.clone(), visited.clone(), installed.clone());
        std::thread::spawn(move || {
            let mut budget = Budget::until(deadline, max_entries, max_models);
            let mut visited = (*visited).clone();
            let mut found = Vec::new();
            let complete = walk(&drive, &mut budget, &mut visited, &installed, &mut found);
            let _ = sender.send((found, complete));
        });
    }
    drop(sender);

    let mut truncated = false;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(left + Duration::from_millis(200)) {
            Ok((found, complete)) => {
                models.extend(found);
                truncated |= !complete;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                truncated = true;
                break;
            }
        }
    }
    truncated |= models.len() > max_models;
    (finish(models, max_models), truncated)
}

/// Each fixed drive: its top level, and up to three levels into the folders
/// there whose names say they hold models.
pub(crate) fn drive_roots(drives: Vec<PathBuf>) -> Vec<ScanRoot> {
    drives
        .into_iter()
        .map(|drive| ScanRoot {
            model_folders_only: true,
            ..ScanRoot::new(drive, 3)
        })
        .collect()
}

/// The places models usually live, most likely first: an early stop then
/// costs the least.
pub(crate) fn likely_roots(
    models_root: PathBuf,
    data_folder: &Path,
    home: Option<&Path>,
    downloads: Option<PathBuf>,
    hf_cache: Option<PathBuf>,
) -> Vec<ScanRoot> {
    let mut roots = vec![
        ScanRoot {
            skip_top: &["musica"],
            ..ScanRoot::new(models_root, 6)
        },
        ScanRoot::new(data_folder.join("llamacpp").join("models"), 4),
    ];
    if let Some(home) = home {
        roots.push(ScanRoot::new(home.join(".lmstudio").join("models"), 4));
        roots.push(ScanRoot::new(
            home.join(".cache").join("lm-studio").join("models"),
            4,
        ));
        let hub = hf_cache.unwrap_or_else(|| home.join(".cache").join("huggingface").join("hub"));
        roots.push(ScanRoot::new(hub, 5));
        roots.push(ScanRoot::new(
            downloads.unwrap_or_else(|| home.join("Downloads")),
            3,
        ));
    }
    let mut seen = HashSet::new();
    roots.retain(|root| seen.insert(path_key(&root.path)));
    roots
}

/// The Hugging Face cache the `huggingface_hub` library uses.
fn hf_cache_from_env() -> Option<PathBuf> {
    let absolute = |name: &str| {
        std::env::var_os(name)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
    };
    absolute("HF_HUB_CACHE").or_else(|| absolute("HF_HOME").map(|home| home.join("hub")))
}

#[cfg(windows)]
fn fixed_drives() -> Vec<PathBuf> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    const DRIVE_FIXED: u32 = 3;
    // SAFETY: no arguments; returns a bitmask of the drive letters in use.
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|bit| mask & (1 << bit) != 0)
        .filter_map(|bit| {
            let root = format!("{}:\\", (b'A' + bit) as char);
            let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
            // SAFETY: `wide` is a NUL-terminated UTF-16 string that outlives the call.
            let kind = unsafe { GetDriveTypeW(wide.as_ptr()) };
            (kind == DRIVE_FIXED).then(|| PathBuf::from(root))
        })
        .collect()
}

#[cfg(not(windows))]
fn fixed_drives() -> Vec<PathBuf> {
    Vec::new()
}

/// Which llama.cpp model each file already belongs to: the `model_path` of
/// every `model.yml` under `<data>/llamacpp/models`, keyed by [`path_key`].
/// Relative paths are data-folder paths. Paths are compared as written, not
/// canonicalized: resolving one on a sleeping disk would wait for it to spin
/// up, and the import dialog stores the path the way the scan spells it.
pub(crate) fn installed_models(data_folder: &Path) -> HashMap<String, String> {
    let models_dir = data_folder.join("llamacpp").join("models");
    let mut configs = Vec::new();
    collect_model_configs(&models_dir, 4, &mut configs);
    let mut installed = HashMap::new();
    for config in configs {
        let Some(id) = config.parent().and_then(|dir| model_id(&models_dir, dir)) else {
            continue;
        };
        let Ok(text) = fs::read_to_string(&config) else {
            continue;
        };
        let Ok(yaml) = serde_yaml::from_str::<serde_yaml::Value>(&text) else {
            continue;
        };
        let Some(model_path) = yaml.get("model_path").and_then(|v| v.as_str()) else {
            continue;
        };
        let model_path = Path::new(model_path);
        let file = if model_path.is_absolute() {
            model_path.to_path_buf()
        } else {
            data_folder.join(model_path)
        };
        installed.insert(path_key(&file), id);
    }
    installed
}

fn model_id(models_dir: &Path, dir: &Path) -> Option<String> {
    let parts: Vec<String> = dir
        .strip_prefix(models_dir)
        .ok()?
        .components()
        .map(|c| match c {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Option<_>>()?;
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn collect_model_configs(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_file() && entry.file_name() == "model.yml" {
            out.push(entry.path());
        } else if kind.is_dir() && depth > 0 {
            collect_model_configs(&entry.path(), depth - 1, out);
        }
    }
}

/// The files each model of the last scan may grant: the model and its
/// projector, keyed by the model's path. Only what a scan returned is here, so
/// the web view cannot name another file to be granted.
#[derive(Default)]
pub(crate) struct ScannedFiles(Mutex<HashMap<String, Vec<PathBuf>>>);

impl ScannedFiles {
    fn remember(&self, models: &[LocalModel]) {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.clear();
        for model in models {
            let mut files = vec![PathBuf::from(&model.path)];
            files.extend(model.projector_path.as_ref().map(PathBuf::from));
            map.insert(path_key(Path::new(&model.path)), files);
        }
    }

    fn files_for(&self, path: &str) -> Option<Vec<PathBuf>> {
        let map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.get(&path_key(Path::new(path))).cloned()
    }
}

fn scanned_files() -> &'static ScannedFiles {
    static FILES: OnceLock<ScannedFiles> = OnceLock::new();
    FILES.get_or_init(ScannedFiles::default)
}

/// Checks the files are still regular GGUF files before granting them. A
/// projector that went away is dropped rather than failing the model.
fn still_there(files: Vec<PathBuf>) -> Result<AllowedLocalModel, String> {
    let mut files = files.into_iter();
    let model = files
        .next()
        .filter(|path| read_gguf(path).is_some())
        .ok_or("El archivo del modelo ya no está o cambió. Vuelve a buscar los modelos del PC.")?;
    let projector = files.next().filter(|path| read_gguf(path).is_some());
    Ok(AllowedLocalModel {
        path: model.to_string_lossy().into_owned(),
        projector_path: projector.map(|p| p.to_string_lossy().into_owned()),
    })
}

/// Looks for GGUF models on this PC. Runs off the async runtime.
#[tauri::command]
pub async fn local_models_scan(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<LocalModelScan, String> {
    require_main(&window)?;
    let data_folder = crate::core::app::commands::get_rey30_data_folder_path(app);
    let home = dirs::home_dir();
    let downloads = dirs::download_dir();
    let started = Instant::now();
    let scan_result = tokio::task::spawn_blocking(move || {
        let likely = likely_roots(
            super::models_root::models_root(),
            &data_folder,
            home.as_deref(),
            downloads,
            hf_cache_from_env(),
        );
        let drives = drive_roots(fixed_drives());
        // Drives are listed without a check: asking a sleeping disk whether
        // its root exists would wait for it to spin up.
        let searched_folders = likely
            .iter()
            .filter(|root| root.path.is_dir())
            .chain(&drives)
            .map(|root| root.path.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        let installed = installed_models(&data_folder);
        let (models, truncated) = scan_pc(
            &likely,
            drives,
            installed,
            TIME_LIMIT,
            MAX_ENTRIES,
            MAX_MODELS,
        );
        (models, searched_folders, truncated)
    })
    .await
    .map_err(|_| "No se pudo terminar la búsqueda de modelos.".to_string())?;
    let (models, searched_folders, truncated) = scan_result;
    scanned_files().remember(&models);
    Ok(LocalModelScan {
        models,
        searched_folders,
        truncated,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

/// Lets the web view read one model the last scan found (and its projector),
/// so it can be imported in place. Same grant as picking the file in the
/// import dialog.
#[tauri::command]
pub async fn local_models_allow(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
) -> Result<AllowedLocalModel, String> {
    require_main(&window)?;
    let files = scanned_files()
        .files_for(&path)
        .ok_or("Ese modelo no salió en la última búsqueda. Vuelve a buscar los modelos del PC.")?;
    let allowed = tokio::task::spawn_blocking(move || still_there(files))
        .await
        .map_err(|_| "No se pudo comprobar el archivo del modelo.".to_string())??;
    let mut grant = vec![PathBuf::from(&allowed.path)];
    grant.extend(allowed.projector_path.as_ref().map(PathBuf::from));
    crate::core::filesystem::grants::record_picks(&app, &grant);
    Ok(allowed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// A minimal GGUF: magic, version 3, no tensors, and an optional
    /// `general.architecture`.
    fn gguf_bytes(architecture: Option<&str>) -> Vec<u8> {
        let mut bytes = b"GGUF".to_vec();
        bytes.extend(3u32.to_le_bytes());
        bytes.extend(0u64.to_le_bytes());
        match architecture {
            Some(arch) => {
                bytes.extend(1u64.to_le_bytes());
                let key = b"general.architecture";
                bytes.extend((key.len() as u64).to_le_bytes());
                bytes.extend(key);
                bytes.extend(8u32.to_le_bytes());
                bytes.extend((arch.len() as u64).to_le_bytes());
                bytes.extend(arch.as_bytes());
            }
            None => bytes.extend(0u64.to_le_bytes()),
        }
        bytes.resize(bytes.len().max(64), 0);
        bytes
    }

    fn gguf(path: &Path) {
        gguf_arch(path, Some("llama"));
    }

    /// Size of what [`gguf`] writes.
    fn model_size() -> u64 {
        gguf_bytes(Some("llama")).len() as u64
    }

    fn gguf_arch(path: &Path, architecture: Option<&str>) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, gguf_bytes(architecture)).unwrap();
    }

    fn budget() -> Budget {
        Budget::new(Duration::from_secs(30), 100_000, 1_000)
    }

    fn scan_one(root: ScanRoot) -> (Vec<LocalModel>, bool) {
        scan(&[root], &HashMap::new(), &mut budget())
    }

    fn names(models: &[LocalModel]) -> Vec<&str> {
        models.iter().map(|m| m.name.as_str()).collect()
    }

    #[test]
    fn finds_models_and_pairs_projectors_instead_of_listing_them() {
        let tmp = TempDir::new().unwrap();
        let r = tmp.path();
        gguf(&r.join("Qwen3.5-9B-Q4_K_M/model.gguf"));
        gguf(&r.join("Vision/gemma-vl-Q4_K_M.gguf"));
        gguf_arch(&r.join("Vision/mmproj-gemma-vl-f16.gguf"), Some("clip"));
        gguf(&r.join("Plain/phi-4.gguf"));
        fs::write(r.join("Plain/notes.txt"), "x").unwrap();

        let (models, truncated) = scan_one(ScanRoot::new(r.to_path_buf(), 6));

        assert!(!truncated);
        assert_eq!(
            names(&models),
            ["gemma-vl-Q4_K_M", "phi-4", "Qwen3.5-9B-Q4_K_M"]
        );
        let vision = &models[0];
        assert_eq!(
            vision.projector_path.as_deref().map(Path::new),
            Some(r.join("Vision").join("mmproj-gemma-vl-f16.gguf").as_path())
        );
        assert_eq!(vision.folder, r.join("Vision").to_string_lossy());
        assert_eq!(
            vision.size_bytes,
            model_size(),
            "the projector is not counted in"
        );
        assert_eq!(models[1].projector_path, None);
        assert_eq!(
            models[2].file_name, "model.gguf",
            "model.gguf is named after its folder"
        );
    }

    #[test]
    fn several_projectors_pair_by_name() {
        let tmp = TempDir::new().unwrap();
        let r = tmp.path();
        gguf(&r.join("gemma-3-4b-it-Q4_K_M.gguf"));
        gguf(&r.join("qwen2.5-vl-7b-Q4_K_M.gguf"));
        gguf(&r.join("mmproj-gemma-3-4b-it-f16.gguf"));
        gguf(&r.join("mmproj-qwen2.5-vl-7b-f16.gguf"));

        let (models, _) = scan_one(ScanRoot::new(r.to_path_buf(), 0));

        let projector = |name: &str| {
            models
                .iter()
                .find(|m| m.name == name)
                .and_then(|m| m.projector_path.clone())
                .map(|p| {
                    Path::new(&p)
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .into_owned()
                })
        };
        assert_eq!(
            projector("gemma-3-4b-it-Q4_K_M").as_deref(),
            Some("mmproj-gemma-3-4b-it-f16.gguf")
        );
        assert_eq!(
            projector("qwen2.5-vl-7b-Q4_K_M").as_deref(),
            Some("mmproj-qwen2.5-vl-7b-f16.gguf")
        );
    }

    #[test]
    fn lists_the_first_part_of_a_split_model_with_the_total_size() {
        let tmp = TempDir::new().unwrap();
        let r = tmp.path();
        gguf(&r.join("big-Q4_K_M-00001-of-00003.gguf"));
        gguf(&r.join("big-Q4_K_M-00002-of-00003.gguf"));
        gguf(&r.join("big-Q4_K_M-00003-of-00003.gguf"));

        let (models, _) = scan_one(ScanRoot::new(r.to_path_buf(), 0));

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "big-Q4_K_M");
        assert_eq!(models[0].file_name, "big-Q4_K_M-00001-of-00003.gguf");
        assert_eq!(models[0].shard_count, 3);
        assert_eq!(models[0].size_bytes, 3 * model_size());
    }

    #[test]
    fn skips_helpers_voices_diffusion_models_and_files_that_are_not_gguf() {
        let tmp = TempDir::new().unwrap();
        let r = tmp.path();
        gguf(&r.join("chat.gguf"));
        gguf(&r.join("chat-mtp.gguf"));
        gguf(&r.join("Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf"));
        gguf(&r.join("my-lora-adapter.gguf"));
        gguf(&r.join("imatrix.gguf"));
        gguf_arch(&r.join("flux1-dev-Q4_0.gguf"), Some("flux"));
        gguf_arch(&r.join("no-arch.gguf"), None);
        fs::write(r.join("fake.gguf"), [b'X'; 64]).unwrap();
        fs::write(r.join("tiny.gguf"), b"GGUF").unwrap();

        let (models, _) = scan_one(ScanRoot::new(r.to_path_buf(), 0));

        assert_eq!(names(&models), ["chat", "no-arch"]);
    }

    #[test]
    fn a_clip_file_with_an_ordinary_name_is_paired_as_a_projector() {
        let tmp = TempDir::new().unwrap();
        let r = tmp.path();
        gguf(&r.join("llava-v1.6.gguf"));
        gguf_arch(&r.join("vision-encoder.gguf"), Some("clip"));

        let (models, _) = scan_one(ScanRoot::new(r.to_path_buf(), 0));

        assert_eq!(names(&models), ["llava-v1.6"]);
        assert!(models[0]
            .projector_path
            .as_deref()
            .unwrap()
            .ends_with("vision-encoder.gguf"));
    }

    #[test]
    fn respects_the_depth_limit_and_skips_system_and_tooling_folders() {
        let tmp = TempDir::new().unwrap();
        let r = tmp.path();
        gguf(&r.join("a/b/shallow.gguf"));
        gguf(&r.join("a/b/c/d/deep.gguf"));
        for skipped in [
            "node_modules",
            ".git",
            "Windows",
            "Program Files",
            "$Recycle.Bin",
            "AppData",
        ] {
            gguf(&r.join(skipped).join("hidden.gguf"));
        }

        let (models, _) = scan_one(ScanRoot::new(r.to_path_buf(), 2));

        assert_eq!(names(&models), ["shallow"]);
    }

    #[test]
    fn the_models_root_leaves_out_its_music_engine_folder() {
        let tmp = TempDir::new().unwrap();
        let r = tmp.path();
        gguf(&r.join("Musica/ACE-Step/acestep.gguf"));
        gguf(&r.join("Chat/llama.gguf"));
        let roots = likely_roots(r.to_path_buf(), &tmp.path().join("data"), None, None, None);

        let (models, _) = scan(&roots, &HashMap::new(), &mut budget());

        assert_eq!(names(&models), ["llama"]);
    }

    #[test]
    fn a_drive_root_is_read_at_its_top_and_inside_model_folders_only() {
        let tmp = TempDir::new().unwrap();
        let drive = tmp.path();
        gguf(&drive.join("at-the-root.gguf"));
        gguf(&drive.join("Modelos/qwen/qwen.gguf"));
        gguf(&drive.join("AI/lmstudio-community/repo/gemma.gguf"));
        gguf(&drive.join("AI/a/b/c/too-deep.gguf"));
        gguf(&drive.join("Games/somewhere/not-looked-at.gguf"));
        let roots = drive_roots(vec![drive.to_path_buf()]);

        let (models, _) = scan(&roots, &HashMap::new(), &mut budget());

        assert_eq!(names(&models), ["at-the-root", "gemma", "qwen"]);
    }

    #[test]
    fn model_folder_names() {
        for yes in [
            "Modelos IA Rey30",
            "models",
            "AI",
            "LLM-gguf",
            "lmstudio",
            "LM Studio",
            "huggingface",
            "MisModelos",
        ] {
            assert!(looks_like_model_folder(yes), "{yes}");
        }
        for no in ["Games", "Users", "Steam", "Fotos", "Brain"] {
            assert!(!looks_like_model_folder(no), "{no}");
        }
    }

    #[test]
    fn a_folder_reached_from_two_roots_is_listed_once() {
        let tmp = TempDir::new().unwrap();
        let models_root = tmp.path().join("Modelos");
        gguf(&models_root.join("qwen/model.gguf"));
        let likely = likely_roots(
            models_root.clone(),
            &tmp.path().join("data"),
            None,
            None,
            None,
        );
        let drives = drive_roots(vec![tmp.path().to_path_buf()]);

        let (models, truncated) = scan_pc(
            &likely,
            drives,
            HashMap::new(),
            Duration::from_secs(30),
            100_000,
            1_000,
        );

        assert!(!truncated);
        assert_eq!(names(&models), ["qwen"]);
    }

    #[test]
    fn stops_at_the_entry_limit_and_says_so() {
        let tmp = TempDir::new().unwrap();
        for i in 0..20 {
            gguf(&tmp.path().join(format!("m{i:02}.gguf")));
        }
        let mut small = Budget::new(Duration::from_secs(30), 5, 1_000);

        let (models, truncated) = scan(
            &[ScanRoot::new(tmp.path().to_path_buf(), 0)],
            &HashMap::new(),
            &mut small,
        );

        assert!(truncated);
        assert!(models.len() <= 5);
    }

    #[test]
    fn stops_at_the_model_limit() {
        let tmp = TempDir::new().unwrap();
        for i in 0..10 {
            gguf(&tmp.path().join(format!("d{i}/m.gguf")));
        }
        let mut small = Budget::new(Duration::from_secs(30), 100_000, 3);

        let (models, truncated) = scan(
            &[ScanRoot::new(tmp.path().to_path_buf(), 2)],
            &HashMap::new(),
            &mut small,
        );

        assert!(truncated);
        assert_eq!(models.len(), 3);
    }

    #[test]
    fn stops_when_the_time_is_up() {
        let tmp = TempDir::new().unwrap();
        gguf(&tmp.path().join("m.gguf"));
        let mut expired = Budget::new(Duration::ZERO, 100_000, 1_000);

        let (models, truncated) = scan(
            &[ScanRoot::new(tmp.path().to_path_buf(), 0)],
            &HashMap::new(),
            &mut expired,
        );

        assert!(truncated);
        assert!(models.is_empty());
    }

    #[test]
    fn marks_models_already_installed_in_llamacpp() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let external = tmp.path().join("Modelos/qwen/qwen.gguf");
        let own = data.join("llamacpp/models/phi/model.gguf");
        gguf(&external);
        gguf(&own);
        gguf(&tmp.path().join("Modelos/new/new.gguf"));
        let write_yml = |id: &str, body: String| {
            let dir = data.join("llamacpp/models").join(id);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("model.yml"), body).unwrap();
        };
        write_yml(
            "qwen-local",
            format!("model_path: '{}'\nname: qwen\n", external.display()),
        );
        write_yml(
            "phi",
            "model_path: llamacpp/models/phi/model.gguf\n".to_string(),
        );
        let roots = likely_roots(tmp.path().join("Modelos"), &data, None, None, None);

        let installed = installed_models(&data);
        let (models, _) = scan(&roots, &installed, &mut budget());

        let id = |name: &str| {
            models
                .iter()
                .find(|m| m.name == name)
                .unwrap()
                .installed_model_id
                .clone()
        };
        assert_eq!(id("qwen").as_deref(), Some("qwen-local"));
        assert_eq!(id("phi").as_deref(), Some("phi"));
        assert_eq!(id("new"), None);
    }

    #[test]
    fn roots_come_most_likely_first_and_once() {
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().join("home");
        let roots = likely_roots(
            tmp.path().join("Modelos"),
            &tmp.path().join("data"),
            Some(&home),
            Some(home.join("Downloads")),
            None,
        );
        let paths: Vec<PathBuf> = roots.iter().map(|r| r.path.clone()).collect();
        assert_eq!(
            paths,
            [
                tmp.path().join("Modelos"),
                tmp.path().join("data/llamacpp/models"),
                home.join(".lmstudio/models"),
                home.join(".cache/lm-studio/models"),
                home.join(".cache/huggingface/hub"),
                home.join("Downloads"),
            ]
        );
    }

    #[test]
    fn the_whole_scan_merges_the_likely_places_and_every_drive() {
        let tmp = TempDir::new().unwrap();
        let models_root = tmp.path().join("Modelos IA");
        gguf(&models_root.join("qwen").join("model.gguf"));
        let drive_a = tmp.path().join("A");
        let drive_b = tmp.path().join("B");
        gguf(&drive_a.join("models").join("phi.gguf"));
        gguf(&drive_b.join("LLM").join("x").join("gemma.gguf"));
        gguf(&drive_b.join("Juegos").join("hidden.gguf"));
        let likely = likely_roots(models_root, &tmp.path().join("data"), None, None, None);

        let (models, truncated) = scan_pc(
            &likely,
            drive_roots(vec![drive_a, drive_b]),
            HashMap::new(),
            Duration::from_secs(30),
            100_000,
            1_000,
        );

        assert!(!truncated);
        assert_eq!(names(&models), ["gemma", "phi", "qwen"]);
    }

    #[test]
    fn the_whole_scan_skips_the_drives_when_the_likely_places_used_the_time() {
        let tmp = TempDir::new().unwrap();
        gguf(&tmp.path().join("Modelos").join("m.gguf"));
        let likely = likely_roots(
            tmp.path().join("Modelos"),
            &tmp.path().join("data"),
            None,
            None,
            None,
        );

        let (models, truncated) = scan_pc(
            &likely,
            drive_roots(vec![tmp.path().to_path_buf()]),
            HashMap::new(),
            Duration::ZERO,
            100_000,
            1_000,
        );

        assert!(truncated);
        assert!(models.is_empty());
    }

    #[test]
    fn only_files_from_the_last_scan_can_be_granted() {
        let tmp = TempDir::new().unwrap();
        let model = tmp.path().join("m").join("model.gguf");
        let projector = tmp.path().join("m").join("mmproj-f16.gguf");
        gguf(&model);
        gguf_arch(&projector, Some("clip"));
        let (models, _) = scan_one(ScanRoot::new(tmp.path().to_path_buf(), 1));
        let files = ScannedFiles::default();
        files.remember(&models);

        let granted = files.files_for(&model.to_string_lossy()).unwrap();
        assert_eq!(granted, vec![model.clone(), projector.clone()]);
        assert_eq!(
            files.files_for(&projector.to_string_lossy()),
            None,
            "a projector is not a model"
        );
        assert_eq!(
            files.files_for(&tmp.path().join("other.gguf").to_string_lossy()),
            None
        );

        let allowed = still_there(granted.clone()).unwrap();
        assert_eq!(
            allowed.projector_path.as_deref(),
            Some(projector.to_string_lossy().as_ref())
        );
        fs::remove_file(&projector).unwrap();
        assert_eq!(still_there(granted.clone()).unwrap().projector_path, None);
        fs::remove_file(&model).unwrap();
        assert!(still_there(granted).is_err());
    }

    #[test]
    fn split_part_names() {
        assert_eq!(split_part("model-00001-of-00002"), Some(("model", 1, 2)));
        assert_eq!(split_part("model-00002-of-00002"), Some(("model", 2, 2)));
        assert_eq!(split_part("model-0001-of-00002"), None);
        assert_eq!(split_part("model-00003-of-00002"), None);
        assert_eq!(split_part("-00001-of-00002"), None);
        assert_eq!(split_part("modèle-00001-of-00002"), Some(("modèle", 1, 2)));
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_symlinks() {
        let tmp = TempDir::new().unwrap();
        let outside = tmp.path().join("outside");
        gguf(&outside.join("secret.gguf"));
        let root = tmp.path().join("root");
        fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("linked-dir")).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.gguf"), root.join("linked.gguf")).unwrap();

        let (models, _) = scan_one(ScanRoot::new(root, 3));

        assert!(models.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn never_follows_junctions() {
        let tmp = TempDir::new().unwrap();
        let outside = tmp.path().join("outside");
        gguf(&outside.join("secret.gguf"));
        let root = tmp.path().join("root");
        fs::create_dir_all(&root).unwrap();
        let junction = root.join("junction");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside)
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
        if !made {
            eprintln!("skipped: could not create a junction here");
            return;
        }
        assert!(junction.join("secret.gguf").exists(), "the junction works");

        let (models, _) = scan_one(ScanRoot::new(root, 3));

        assert!(models.is_empty());
    }
}
