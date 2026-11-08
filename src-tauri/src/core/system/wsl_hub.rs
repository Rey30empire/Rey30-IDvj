//! Local model catalog: the GGUF models under the shared models folder
//! (`C:\Modelos IA Rey30` by default, see `models_root`), read straight from
//! Windows. It used to read a hub inside WSL; the command names keep that
//! history so saved UI state and callers stay valid.
//!
//! Models that cannot chat are left out: ACE-Step under `Musica` and the
//! text-to-speech voices (`*tts*`). Pluma's Gemma 4 is listed, so it can also
//! be chosen as a chat model, reading the same file her calls use.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, WebviewWindow};

/// Top-level folders holding models that are not chat models.
const ENGINE_FOLDERS: [&str; 1] = ["Musica"];

/// Text-to-speech voices, such as Qwen3-TTS, are not chat models.
fn is_voice_model(name: &str) -> bool {
    name.to_ascii_lowercase().contains("tts")
}
const MAX_DEPTH: usize = 6;
const MAX_ENTRIES: usize = 12_000;
const MAX_MODELS: usize = 1_000;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WslModel {
    id: String,
    name: String,
    size_bytes: u64,
    has_projector: bool,
}

#[derive(Serialize)]
pub struct WslCatalog {
    root: String,
    models: Vec<WslModel>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedWslModel {
    id: String,
    name: String,
    path: String,
    size_bytes: u64,
    projector_path: Option<String>,
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Abre los modelos locales desde la ventana principal.".into());
    }
    Ok(())
}

fn is_projector(name: &str) -> bool {
    name.to_ascii_lowercase()
        .split(['-', '_', '.'])
        .any(|part| part == "mmproj")
}

/// A single-file chat model: a `.gguf` that is not a projector, a split shard
/// or a draft/speculative helper.
fn is_model_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let Some(stem) = lower.strip_suffix(".gguf") else { return false };
    let split = stem.len() > 15 && {
        let tail = &stem[stem.len() - 15..];
        tail.starts_with('-')
            && tail[1..6].chars().all(|c| c.is_ascii_digit())
            && &tail[6..10] == "-of-"
            && tail[10..].chars().all(|c| c.is_ascii_digit())
    };
    let helper = stem
        .split(['-', '_', '.'])
        .any(|part| matches!(part, "mtp" | "dflash" | "dspark" | "eagle" | "draft"));
    !is_projector(name) && !split && !helper && !is_voice_model(name)
}

fn is_gguf(path: &Path) -> Option<u64> {
    use std::io::Read;
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() < 24 {
        return None;
    }
    let mut magic = [0; 4];
    std::fs::File::open(path).ok()?.read_exact(&mut magic).ok()?;
    (&magic == b"GGUF").then_some(metadata.len())
}

/// The one projector next to a model, if there is exactly one.
fn projector_in(directory: &Path) -> Option<PathBuf> {
    let mut found = None;
    for entry in std::fs::read_dir(directory).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.to_ascii_lowercase().ends_with(".gguf") && is_projector(&name) {
            let path = entry.path();
            if is_gguf(&path).is_some() {
                if found.is_some() {
                    return None;
                }
                found = Some(path);
            }
        }
    }
    found
}

fn identifier(root: &Path, file: &Path) -> Option<String> {
    let relative = file.strip_prefix(root).ok()?;
    let parts: Vec<&str> = relative
        .components()
        .map(|component| match component {
            Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Option<_>>()?;
    Some(parts.join("/"))
}

pub(crate) fn scan(root: &Path) -> Vec<WslModel> {
    let mut models = Vec::new();
    let mut pending = vec![(root.to_path_buf(), 0usize)];
    let mut scanned = 0;
    while let Some((directory, depth)) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else { continue };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
        let mut has_projector = None;
        for entry in entries {
            scanned += 1;
            if scanned > MAX_ENTRIES || models.len() >= MAX_MODELS {
                return models;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                let engine = depth == 0 && ENGINE_FOLDERS.iter().any(|f| f.eq_ignore_ascii_case(&name));
                if !engine && depth < MAX_DEPTH {
                    pending.push((path, depth + 1));
                }
                continue;
            }
            if !is_model_name(&name) {
                continue;
            }
            let (Some(size_bytes), Some(id)) = (is_gguf(&path), identifier(root, &path)) else {
                continue;
            };
            let has_projector = *has_projector.get_or_insert_with(|| projector_in(&directory).is_some());
            let name = Path::new(&name)
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            // `model.gguf` says nothing; the folder names the model.
            let name = if name.eq_ignore_ascii_case("model") {
                directory
                    .file_name()
                    .map(|folder| folder.to_string_lossy().into_owned())
                    .unwrap_or(name)
            } else {
                name
            };
            models.push(WslModel { id, name, size_bytes, has_projector });
        }
    }
    models.sort_by_key(|model| model.id.to_lowercase());
    models
}

pub(crate) fn resolve(root: &Path, id: &str) -> Result<(ResolvedWslModel, Vec<PathBuf>), String> {
    let parts: Vec<&str> = id.split('/').collect();
    let usable = |part: &&str| {
        !part.is_empty()
            && *part != "."
            && *part != ".."
            && part.trim() == *part
            && !part.chars().any(|c| c.is_control() || "<>:\"\\|?*".contains(c))
    };
    if id.len() > 512 || !parts.iter().all(usable) || !is_model_name(parts[parts.len() - 1]) {
        return Err("El identificador del modelo local no es válido.".into());
    }
    if ENGINE_FOLDERS.iter().any(|folder| folder.eq_ignore_ascii_case(parts[0])) {
        return Err("Ese modelo es de música y no se carga como modelo de chat.".into());
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|_| format!("No existe la carpeta de modelos {}.", root.display()))?;
    let file = parts.iter().fold(root.to_path_buf(), |path, part| path.join(part));
    let canonical = file
        .canonicalize()
        .map_err(|_| "El modelo ya no está disponible. Actualiza la lista.".to_string())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("El modelo queda fuera de la carpeta de modelos.".into());
    }
    let size_bytes = is_gguf(&canonical).ok_or("El archivo no es un modelo GGUF válido.")?;
    let projector = canonical.parent().and_then(projector_in);
    let mut files = vec![canonical.clone()];
    files.extend(projector.iter().cloned());
    let name = canonical
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok((
        ResolvedWslModel {
            id: id.to_string(),
            name,
            path: canonical.to_string_lossy().into_owned(),
            size_bytes,
            projector_path: projector.map(|path| path.to_string_lossy().into_owned()),
        },
        files,
    ))
}

fn models_root() -> PathBuf {
    super::models_root::models_root()
}

#[tauri::command]
pub async fn wsl_hub_list(window: WebviewWindow) -> Result<WslCatalog, String> {
    require_main(&window)?;
    let root = models_root();
    if !root.is_dir() {
        return Err(format!("No existe la carpeta de modelos {}.", root.display()));
    }
    let scan_root = root.clone();
    let models = tokio::task::spawn_blocking(move || scan(&scan_root))
        .await
        .map_err(|_| "No se pudo leer la carpeta de modelos.")?;
    Ok(WslCatalog { root: root.to_string_lossy().into_owned(), models })
}

#[tauri::command]
pub async fn wsl_hub_resolve_model(
    app: AppHandle,
    window: WebviewWindow,
    model_id: String,
) -> Result<ResolvedWslModel, String> {
    require_main(&window)?;
    let root = models_root();
    let (model, files) = tokio::task::spawn_blocking(move || resolve(&root, &model_id))
        .await
        .map_err(|_| "No se pudo leer la carpeta de modelos.")??;
    crate::core::filesystem::grants::record_picks(&app, &files);
    Ok(model)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gguf(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut bytes = b"GGUF".to_vec();
        bytes.resize(64, 0);
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn lists_chat_models_with_projectors_and_skips_engines_and_helpers() {
        let root = tempfile::tempdir().unwrap();
        let r = root.path();
        gguf(&r.join("Qwen3.5-9B-Q4_K_M/model.gguf"));
        gguf(&r.join("Vision/gemma-vl.gguf"));
        gguf(&r.join("Vision/mmproj-gemma-vl.gguf"));
        gguf(&r.join("Split/big-00001-of-00002.gguf"));
        gguf(&r.join("Split/helper-mtp.gguf"));
        gguf(&r.join("Pluma/Gemma-4-12B-it-GGUF/gemma-4-12b.gguf"));
        gguf(&r.join("Pluma/Gemma-4-12B-it-GGUF/mmproj-gemma-4-12b.gguf"));
        gguf(&r.join("Pluma/Qwen3-TTS-12Hz-1.7B-Base-GGUF/Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf"));
        gguf(&r.join("Musica/ACE-Step-1.5/models/acestep.gguf"));
        std::fs::create_dir_all(r.join("Broken")).unwrap();
        std::fs::write(r.join("Broken/not-a-model.gguf"), b"nope").unwrap();

        let models = scan(r);
        assert_eq!(
            models,
            vec![
                WslModel { id: "Pluma/Gemma-4-12B-it-GGUF/gemma-4-12b.gguf".into(), name: "gemma-4-12b".into(), size_bytes: 64, has_projector: true },
                WslModel { id: "Qwen3.5-9B-Q4_K_M/model.gguf".into(), name: "Qwen3.5-9B-Q4_K_M".into(), size_bytes: 64, has_projector: false },
                WslModel { id: "Vision/gemma-vl.gguf".into(), name: "gemma-vl".into(), size_bytes: 64, has_projector: true },
            ]
        );
    }

    #[test]
    fn resolves_inside_the_root_and_refuses_escapes_and_engines() {
        let root = tempfile::tempdir().unwrap();
        let r = root.path();
        gguf(&r.join("Vision/gemma-vl.gguf"));
        gguf(&r.join("Vision/mmproj-gemma-vl.gguf"));
        gguf(&r.join("Pluma/gemma.gguf"));
        gguf(&r.join("Musica/acestep.gguf"));
        let (model, files) = resolve(r, "Vision/gemma-vl.gguf").unwrap();
        assert!(model.projector_path.is_some());
        assert_eq!(files.len(), 2);
        assert!(resolve(r, "Pluma/gemma.gguf").is_ok());
        assert!(resolve(r, "../outside.gguf").is_err());
        assert!(resolve(r, "Vision/mmproj-gemma-vl.gguf").is_err());
        assert!(resolve(r, "Musica/acestep.gguf").is_err());
        assert!(resolve(r, "Vision/missing.gguf").is_err());
    }
}
