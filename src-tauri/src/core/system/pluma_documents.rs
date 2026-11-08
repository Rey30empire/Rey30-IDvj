//! Documents Pluma can read, create and edit by voice. Everything stays inside
//! one folder (`Documentos\Pluma` by default, `REY30_PLUMA_DOCS_DIR` to move
//! it): plain `.md` and `.txt` files, no subfolders, no links. Creating never
//! overwrites, and every edit first keeps the previous version in
//! `.versiones`, so nothing Pluma writes can lose text.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::WebviewWindow;

const MAX_DOCUMENT_BYTES: usize = 200 * 1024;
const MAX_DOCUMENTS: usize = 200;
const VERSIONS: &str = ".versiones";

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlumaDocument {
    name: String,
    size_bytes: u64,
}

fn documents_root() -> PathBuf {
    std::env::var_os("REY30_PLUMA_DOCS_DIR")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| dirs::document_dir().map(|documents| documents.join("Pluma")))
        .unwrap_or_else(|| PathBuf::from("Pluma"))
}

/// A bare `.md`/`.txt` file name; a missing extension becomes `.md`.
fn document_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    let name = if Path::new(name).extension().is_none() { format!("{name}.md") } else { name.to_string() };
    let extension = Path::new(&name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase);
    let valid = !name.is_empty()
        && name.chars().count() <= 120
        && !name.starts_with('.')
        && !name.ends_with(' ')
        && !name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        && matches!(extension.as_deref(), Some("md" | "txt"));
    if valid {
        Ok(name)
    } else {
        Err("El nombre del documento no es válido. Usa un nombre sencillo terminado en .md o .txt.".into())
    }
}

fn document_path(root: &Path, name: &str) -> Result<(String, PathBuf), String> {
    let name = document_name(name)?;
    let path = root.join(&name);
    if fs::symlink_metadata(&path).is_ok_and(|meta| !meta.is_file()) {
        return Err("Ese nombre no corresponde a un documento.".into());
    }
    Ok((name, path))
}

fn check_size(text: &str) -> Result<(), String> {
    if text.len() > MAX_DOCUMENT_BYTES {
        return Err("El documento superaría los 200 KB que Pluma puede manejar.".into());
    }
    Ok(())
}

pub(crate) fn list(root: &Path) -> Result<Vec<PlumaDocument>, String> {
    let Ok(entries) = fs::read_dir(root) else { return Ok(Vec::new()) };
    let mut documents: Vec<PlumaDocument> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            document_name(&name).ok().filter(|valid| *valid == name)?;
            Some(PlumaDocument { name, size_bytes: entry.metadata().ok()?.len() })
        })
        .collect();
    documents.sort_by_key(|document| document.name.to_lowercase());
    documents.truncate(MAX_DOCUMENTS);
    Ok(documents)
}

pub(crate) fn read(root: &Path, name: &str) -> Result<String, String> {
    let (name, path) = document_path(root, name)?;
    let bytes = fs::read(&path).map_err(|_| format!("No existe el documento {name}."))?;
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err("El documento es demasiado grande para leerlo en la llamada.".into());
    }
    String::from_utf8(bytes).map_err(|_| "El documento no es texto UTF-8.".into())
}

pub(crate) fn create(root: &Path, name: &str, text: &str) -> Result<String, String> {
    check_size(text)?;
    fs::create_dir_all(root).map_err(|_| "No se pudo crear la carpeta de documentos de Pluma.")?;
    let (name, path) = document_path(root, name)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| format!("Ya existe un documento llamado {name}. Elige otro nombre o edítalo."))?;
    std::io::Write::write_all(&mut file, text.as_bytes())
        .map_err(|_| format!("No se pudo escribir {name}."))?;
    Ok(name)
}

fn keep_version(root: &Path, name: &str, previous: &str) -> Result<(), String> {
    let versions = root.join(VERSIONS);
    fs::create_dir_all(&versions).map_err(|_| "No se pudo guardar la versión anterior.")?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S%.3f");
    fs::write(versions.join(format!("{stamp}-{name}")), previous)
        .map_err(|_| "No se pudo guardar la versión anterior.".into())
}

/// `append` adds `text` at the end; otherwise `find` must appear exactly once
/// and is replaced by `text`.
pub(crate) fn edit(root: &Path, name: &str, find: Option<&str>, text: &str) -> Result<String, String> {
    let previous = read(root, name)?;
    let (name, path) = document_path(root, name)?;
    let updated = match find.filter(|find| !find.is_empty()) {
        None => {
            let separator = if previous.is_empty() || previous.ends_with('\n') { "" } else { "\n" };
            format!("{previous}{separator}{text}")
        }
        Some(find) => match previous.matches(find).count() {
            1 => previous.replacen(find, text, 1),
            0 => return Err("No encontré ese fragmento en el documento. Léelo y cita el texto exacto.".into()),
            _ => return Err("Ese fragmento aparece varias veces. Cita un trozo más largo y único.".into()),
        },
    };
    check_size(&updated)?;
    keep_version(root, &name, &previous)?;
    fs::write(&path, updated).map_err(|_| format!("No se pudo guardar {name}."))?;
    Ok(name)
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Pluma solo edita documentos desde la ventana principal.".into());
    }
    Ok(())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce(PathBuf) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(move || work(documents_root()))
        .await
        .map_err(|_| "No se pudo acceder a los documentos de Pluma.".to_string())?
}

#[tauri::command]
pub async fn pluma_documents_list(window: WebviewWindow) -> Result<Vec<PlumaDocument>, String> {
    require_main(&window)?;
    blocking(|root| list(&root)).await
}

#[tauri::command]
pub async fn pluma_documents_read(window: WebviewWindow, name: String) -> Result<String, String> {
    require_main(&window)?;
    blocking(move |root| read(&root, &name)).await
}

#[tauri::command]
pub async fn pluma_documents_create(
    window: WebviewWindow,
    name: String,
    text: String,
) -> Result<String, String> {
    require_main(&window)?;
    blocking(move |root| create(&root, &name, &text)).await
}

#[tauri::command]
pub async fn pluma_documents_edit(
    window: WebviewWindow,
    name: String,
    find: Option<String>,
    text: String,
) -> Result<String, String> {
    require_main(&window)?;
    blocking(move |root| edit(&root, &name, find.as_deref(), &text)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_reads_lists_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Pluma");
        assert_eq!(create(&root, "Notas del capítulo", "Uno").unwrap(), "Notas del capítulo.md");
        assert_eq!(read(&root, "Notas del capítulo.md").unwrap(), "Uno");
        assert!(create(&root, "Notas del capítulo.md", "Dos").is_err());
        assert_eq!(read(&root, "Notas del capítulo").unwrap(), "Uno");
        create(&root, "lista.txt", "").unwrap();
        let names: Vec<String> = list(&root).unwrap().into_iter().map(|doc| doc.name).collect();
        assert_eq!(names, vec!["lista.txt", "Notas del capítulo.md"]);
    }

    #[test]
    fn edits_append_or_replace_once_and_keep_the_previous_version() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        create(root, "cuento.md", "Había una vez un gato.").unwrap();
        edit(root, "cuento.md", None, "Fin.").unwrap();
        assert_eq!(read(root, "cuento.md").unwrap(), "Había una vez un gato.\nFin.");
        edit(root, "cuento.md", Some("un gato"), "una gata").unwrap();
        assert_eq!(read(root, "cuento.md").unwrap(), "Había una vez una gata.\nFin.");
        assert!(edit(root, "cuento.md", Some("perro"), "x").is_err());
        let versions = fs::read_dir(root.join(VERSIONS)).unwrap().count();
        assert_eq!(versions, 2);
    }

    #[test]
    fn refuses_paths_other_formats_and_oversized_text() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for bad in ["../fuera.md", "sub/doc.md", r"C:\x.md", "script.exe", ".oculto.md", ""] {
            assert!(create(root, bad, "x").is_err(), "{bad}");
        }
        assert!(create(root, "grande.md", &"a".repeat(MAX_DOCUMENT_BYTES + 1)).is_err());
        assert!(read(root, "no-existe.md").is_err());
    }
}
