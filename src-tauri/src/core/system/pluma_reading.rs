//! Books Pluma reads aloud in reading mode: one file (text, Markdown, PDF,
//! Word, EPUB or HTML) or a folder of them, in name order. Only the text comes
//! back; the call reads it with her voice.

use super::pluma_realtime::require_main;
use serde::Serialize;
use std::{
    cmp::Ordering,
    fs,
    io::{Cursor, Read},
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
};
use tauri::WebviewWindow;

const READABLE: [&str; 8] = ["txt", "md", "markdown", "pdf", "docx", "epub", "html", "htm"];
const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 20 * 1024 * 1024;
const MAX_FILES: usize = 400;
const MAX_DEPTH: usize = 3;
const UNREADABLE: &str =
    "Ese archivo no se puede leer. Usa texto, Markdown, PDF, Word, EPUB, HTML o una carpeta con ellos.";

#[derive(Debug, Serialize)]
pub struct ReadingSection {
    title: String,
    text: String,
}

#[derive(Debug, Serialize)]
pub struct ReadingBook {
    title: String,
    sections: Vec<ReadingSection>,
}

fn extension(path: &Path) -> Option<String> {
    path.extension().map(|value| value.to_string_lossy().to_lowercase())
}

fn readable(path: &Path) -> bool {
    extension(path).is_some_and(|ext| READABLE.contains(&ext.as_str()))
}

fn stem(path: &Path) -> String {
    path.file_stem()
        .or_else(|| path.file_name())
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Lectura".into())
}

/// Name order as a person expects it: «Capítulo 2» before «Capítulo 10».
pub(crate) fn natural_cmp(left: &str, right: &str) -> Ordering {
    let (mut a, mut b) = (left.chars().peekable(), right.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |chars: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut digits = String::new();
                    while let Some(c) = chars.peek().copied().filter(char::is_ascii_digit) {
                        digits.push(c);
                        chars.next();
                    }
                    digits
                };
                let (x, y) = (take(&mut a), take(&mut b));
                let (x, y) = (x.trim_start_matches('0'), y.trim_start_matches('0'));
                let order = x.len().cmp(&y.len()).then_with(|| x.cmp(y));
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(x), Some(y)) => {
                let order = x.to_lowercase().cmp(y.to_lowercase());
                if order != Ordering::Equal {
                    return order;
                }
                a.next();
                b.next();
            }
        }
    }
}

/// Readable files under `dir`, folders included in their own place in the order.
fn collect(dir: &Path, depth: usize, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries
        .flatten()
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .collect();
    entries.sort_by(|a, b| natural_cmp(&a.file_name().to_string_lossy(), &b.file_name().to_string_lossy()));
    for entry in entries {
        if files.len() >= MAX_FILES {
            return;
        }
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() && depth < MAX_DEPTH {
            collect(&path, depth + 1, files);
        } else if kind.is_file() && readable(&path) {
            files.push(path);
        }
    }
}

/// The attributes of one opening tag, `name="value"` or `name='value'`.
fn attribute(tag: &str, name: &str) -> Option<String> {
    let mut rest = tag;
    while let Some(at) = rest.find('=') {
        let key = rest[..at].trim_end().rsplit(|c: char| c.is_whitespace() || c == '<').next()?;
        let value = rest[at + 1..].trim_start();
        let quote = value.chars().next().filter(|c| *c == '"' || *c == '\'')?;
        let end = value[1..].find(quote)?;
        if key == name || key.rsplit(':').next() == Some(name) {
            let raw = &value[1..1 + end];
            return Some(
                raw.replace("&quot;", "\"")
                    .replace("&apos;", "'")
                    .replace("&lt;", "<")
                    .replace("&gt;", ">")
                    .replace("&amp;", "&"),
            );
        }
        rest = &value[1 + end + 1..];
    }
    None
}

/// Every opening `<name …>` tag in the document, namespace prefixes ignored.
fn tags<'a>(xml: &'a str, name: &'a str) -> impl Iterator<Item = &'a str> + 'a {
    xml.match_indices('<').filter_map(move |(at, _)| {
        let rest = &xml[at + 1..];
        let end = rest.find('>')?;
        let tag = &rest[..end];
        let tag_name = tag.split(|c: char| c.is_whitespace() || c == '/').next()?;
        (tag_name == name || tag_name.rsplit(':').next() == Some(name)).then_some(tag)
    })
}

fn zip_text(archive: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Option<Vec<u8>> {
    let mut entry = archive.by_name(name).ok()?;
    if entry.size() > MAX_FILE_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

/// Joins an EPUB href onto the folder of its package file, resolving `..` and `%20`.
fn epub_path(base: &str, href: &str) -> String {
    let href = href.split('#').next().unwrap_or_default().replace("%20", " ");
    let mut parts: Vec<&str> = base.split('/').filter(|part| !part.is_empty()).collect();
    for part in href.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    parts.join("/")
}

/// The chapters of an EPUB in reading (spine) order.
fn epub_text(bytes: &[u8]) -> Result<String, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "El EPUB está dañado.")?;
    let container = zip_text(&mut archive, "META-INF/container.xml").ok_or("El EPUB no tiene índice.")?;
    let container = String::from_utf8_lossy(&container);
    let package = tags(&container, "rootfile")
        .find_map(|tag| attribute(tag, "full-path"))
        .ok_or("El EPUB no tiene índice.")?;
    let opf = zip_text(&mut archive, &package).ok_or("El EPUB no tiene índice.")?;
    let opf = String::from_utf8_lossy(&opf);
    let base = package.rsplit_once('/').map(|(dir, _)| dir).unwrap_or_default();
    let items: Vec<(String, String)> = tags(&opf, "item")
        .filter_map(|tag| Some((attribute(tag, "id")?, attribute(tag, "href")?)))
        .collect();
    let mut chapters: Vec<String> = tags(&opf, "itemref")
        .filter_map(|tag| attribute(tag, "idref"))
        .filter_map(|id| items.iter().find(|(item, _)| *item == id).map(|(_, href)| epub_path(base, href)))
        .collect();
    if chapters.is_empty() {
        chapters = items
            .iter()
            .filter(|(_, href)| href.ends_with("html") || href.ends_with("htm"))
            .map(|(_, href)| epub_path(base, href))
            .collect();
    }
    let mut text = String::new();
    for chapter in chapters {
        let Some(page) = zip_text(&mut archive, &chapter) else { continue };
        let Ok(page) = tauri_plugin_rag::parse_document_bytes(&page, "html") else { continue };
        if !page.trim().is_empty() {
            text.push_str(page.trim());
            text.push_str("\n\n");
        }
        if text.len() > MAX_TEXT_BYTES {
            break;
        }
    }
    Ok(text)
}

fn extract(path: &Path) -> Result<String, String> {
    let ext = extension(path).ok_or(UNREADABLE)?;
    if !READABLE.contains(&ext.as_str()) {
        return Err(UNREADABLE.into());
    }
    let size = fs::metadata(path).map_err(|_| "No se pudo abrir ese archivo.")?.len();
    if size > MAX_FILE_BYTES {
        return Err("El archivo pasa de 100 MB.".into());
    }
    let bytes = fs::read(path).map_err(|_| "No se pudo leer ese archivo.")?;
    let kind = match ext.as_str() {
        "markdown" => "md",
        "htm" => "html",
        other => other,
    };
    if kind == "epub" {
        return epub_text(&bytes);
    }
    // A damaged PDF can make the parser panic; it must not take the app down.
    catch_unwind(AssertUnwindSafe(|| tauri_plugin_rag::parse_document_bytes(&bytes, kind)))
        .map_err(|_| "Ese archivo está dañado o no se pudo interpretar.".to_string())?
        .map_err(|_| "Ese archivo está dañado o no se pudo interpretar.".to_string())
}

fn load(path: &str) -> Result<ReadingBook, String> {
    // «Copiar como ruta» in Windows wraps the path in quotes.
    let path = PathBuf::from(path.trim().trim_matches('"'));
    if path.as_os_str().is_empty() {
        return Err("Escribe la ruta de un archivo o una carpeta.".into());
    }
    let files = if path.is_dir() {
        let mut files = Vec::new();
        collect(&path, 0, &mut files);
        files
    } else if path.is_file() {
        vec![path.clone()]
    } else {
        return Err("No encontré ese archivo o carpeta.".into());
    };
    if files.is_empty() {
        return Err("Esa carpeta no tiene textos, PDF, Word, EPUB ni HTML.".into());
    }
    let mut sections = Vec::new();
    let mut total = 0;
    let mut first_error = None;
    for file in &files {
        match extract(file) {
            Ok(text) if !text.trim().is_empty() => {
                total += text.len();
                sections.push(ReadingSection { title: stem(file), text });
                if total > MAX_TEXT_BYTES {
                    break;
                }
            }
            Ok(_) => {}
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    if sections.is_empty() {
        return Err(first_error.unwrap_or_else(|| {
            "No encontré texto para leer. Si es un PDF escaneado, primero necesita reconocimiento de texto.".into()
        }));
    }
    Ok(ReadingBook { title: stem(&path), sections })
}

/// The person picks what to read; `None` when they close the dialog.
#[tauri::command]
pub async fn pluma_reading_choose(window: WebviewWindow, folder: bool) -> Result<Option<String>, String> {
    require_main(&window)?;
    tokio::task::spawn_blocking(move || {
        let dialog = rfd::FileDialog::new().set_title(if folder {
            "Elegir la carpeta que leerá Pluma"
        } else {
            "Elegir el libro o documento que leerá Pluma"
        });
        let picked = if folder {
            dialog.pick_folder()
        } else {
            dialog
                .add_filter("Libros y documentos", &READABLE)
                .pick_file()
        };
        picked.map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| "Se interrumpió el selector.".to_string())
}

#[tauri::command]
pub async fn pluma_reading_open(window: WebviewWindow, path: String) -> Result<ReadingBook, String> {
    require_main(&window)?;
    tokio::task::spawn_blocking(move || load(&path))
        .await
        .map_err(|_| "Se interrumpió la lectura del archivo.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn orders_names_like_a_person() {
        let mut names = vec!["Capítulo 10.txt", "capítulo 2.txt", "Capítulo 1.txt", "Anexo.txt", "Capítulo 02b.txt"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, ["Anexo.txt", "Capítulo 1.txt", "capítulo 2.txt", "Capítulo 02b.txt", "Capítulo 10.txt"]);
    }

    #[test]
    fn reads_attributes_without_mixing_similar_names() {
        let tag = r#"itemref idref="cap2" linear='yes'"#;
        assert_eq!(attribute(tag, "idref").as_deref(), Some("cap2"));
        assert_eq!(attribute(tag, "id"), None);
        let tag = r#"item id="c&amp;1" href="Text/uno%20dos.xhtml" media-type="application/xhtml+xml""#;
        assert_eq!(attribute(tag, "id").as_deref(), Some("c&1"));
        assert_eq!(epub_path("OEBPS", &attribute(tag, "href").unwrap()), "OEBPS/Text/uno dos.xhtml");
        assert_eq!(epub_path("OEBPS/Text", "../Images/a.xhtml#x"), "OEBPS/Images/a.xhtml");
    }

    fn epub() -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut bytes);
        let mut add = |name: &str, body: &str| {
            zip.start_file(name, SimpleFileOptions::default()).unwrap();
            zip.write_all(body.as_bytes()).unwrap();
        };
        add("META-INF/container.xml", r#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#);
        add(
            "OEBPS/content.opf",
            r#"<package><manifest><item id="b" href="dos.xhtml"/><item id="a" href="uno.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>"#,
        );
        add("OEBPS/uno.xhtml", "<html><body><h1>Uno</h1><p>Primera página.</p></body></html>");
        add("OEBPS/dos.xhtml", "<html><body><p>Segunda página.</p></body></html>");
        zip.finish().unwrap();
        bytes.into_inner()
    }

    #[test]
    fn reads_an_epub_in_spine_order() {
        let text = epub_text(&epub()).unwrap();
        let first = text.find("Primera").unwrap();
        let second = text.find("Segunda").unwrap();
        assert!(first < second, "{text}");
        assert!(epub_text(b"no es un zip").is_err());
    }

    #[test]
    fn reads_a_folder_in_order_and_skips_what_it_cannot_read() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Capítulo 10.txt"), "Diez.").unwrap();
        fs::write(dir.path().join("Capítulo 2.md"), "Dos.").unwrap();
        fs::write(dir.path().join("portada.png"), [0u8; 8]).unwrap();
        fs::write(dir.path().join(".oculto.txt"), "No.").unwrap();
        fs::create_dir(dir.path().join("Parte 3")).unwrap();
        fs::write(dir.path().join("Parte 3").join("libro.epub"), epub()).unwrap();
        let book = load(&format!("\"{}\"", dir.path().display())).unwrap();
        let titles: Vec<_> = book.sections.iter().map(|section| section.title.as_str()).collect();
        assert_eq!(titles, ["Capítulo 2", "Capítulo 10", "libro"]);
        assert!(book.sections[0].text.contains("Dos."));
    }

    #[test]
    fn explains_what_it_cannot_open() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load("").is_err());
        assert!(load(&dir.path().join("no-existe.txt").display().to_string()).is_err());
        assert_eq!(load(&dir.path().display().to_string()).unwrap_err(), "Esa carpeta no tiene textos, PDF, Word, EPUB ni HTML.");
        let image = dir.path().join("foto.png");
        fs::write(&image, [0u8; 8]).unwrap();
        assert_eq!(load(&image.display().to_string()).unwrap_err(), UNREADABLE);
        let empty = dir.path().join("vacio.txt");
        fs::write(&empty, "   ").unwrap();
        assert!(load(&empty.display().to_string()).unwrap_err().starts_with("No encontré texto"));
    }
}
