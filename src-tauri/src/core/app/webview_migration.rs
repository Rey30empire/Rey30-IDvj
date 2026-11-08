//! Additive first-run migration of Windows WebView local storage. Cookies,
//! caches and downloaded models are deliberately outside this copy.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::ffi::OsStrExt;
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

use sha2::{Digest, Sha256};

const SOURCE_ID: &str = "jan.ai.app";
const LOCAL_STORAGE: &str = "EBWebView/Default/Local Storage";
const REPARSE_POINT: u32 = 0x400;
const OPEN_REPARSE_POINT: u32 = 0x0020_0000;

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    IsolatedRun,
    NoSource,
    DestinationExists,
    Migrated { files: usize },
}

/// Call before constructing any WebView. Explicit QA/state overrides never
/// import a real user's browser storage.
pub fn before_webviews() -> Result<Outcome, String> {
    let overrides = [
        "REY30_DATA_ROOT", "REY30_DATA_FOLDER", "JAN_DATA_ROOT", "JAN_DATA_FOLDER",
        "WEBVIEW2_USER_DATA_FOLDER",
    ];
    if cfg!(feature = "e2e") || overrides.iter().any(|key| std::env::var_os(key).is_some()) {
        return Ok(Outcome::IsolatedRun);
    }
    let root = dirs::data_local_dir().ok_or("No se pudo resolver el perfil local de Windows")?;
    migrate_in(&root, super::constants::TAURI_BUNDLE_IDENTIFIER)
        .map_err(|error| format!("No se pudieron migrar los ajustes de la interfaz: {error}. Cierra Jan y vuelve a abrir Rey30 IDvj. El perfil original se conserva."))
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn check_directory(metadata: &fs::Metadata) -> io::Result<()> {
    if metadata.file_attributes() & REPARSE_POINT != 0 || !metadata.is_dir() {
        return Err(invalid("la ruta contiene un enlace, junction o un directorio inválido"));
    }
    Ok(())
}

/// Inspect every existing component without following a junction or symlink.
/// `false` means the path is absent; an unsafe existing component is an error.
fn plain_directory(root: &Path, relative: &Path) -> io::Result<bool> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(invalid("componente de perfil no permitido"));
        };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => check_directory(&metadata)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        }
    }
    Ok(true)
}

#[derive(Debug, PartialEq, Eq)]
struct Entry {
    relative: PathBuf,
    directory: bool,
    bytes: u64,
    modified: Option<SystemTime>,
}

fn entries(source: &Path) -> io::Result<Vec<Entry>> {
    fn visit(source: &Path, relative: &Path, output: &mut Vec<Entry>) -> io::Result<()> {
        for child in fs::read_dir(source.join(relative))? {
            let child = child?;
            let path = relative.join(child.file_name());
            let metadata = fs::symlink_metadata(source.join(&path))?;
            if metadata.file_attributes() & REPARSE_POINT != 0 {
                return Err(invalid("Local Storage contiene un enlace o junction"));
            }
            let directory = metadata.is_dir();
            if !directory && !metadata.is_file() {
                return Err(invalid("Local Storage contiene un archivo especial"));
            }
            output.push(Entry {
                relative: path.clone(), directory,
                bytes: if directory { 0 } else { metadata.len() },
                modified: if directory { None } else { metadata.modified().ok() },
            });
            if directory { visit(source, &path, output)?; }
        }
        Ok(())
    }
    let mut output = Vec::new();
    visit(source, Path::new(""), &mut output)?;
    output.sort_by(|a, b| a.relative.cmp(&b.relative));
    Ok(output)
}

struct StagingDirectory {
    root: PathBuf,
    path: PathBuf,
}

impl Drop for StagingDirectory {
    fn drop(&mut self) {
        // The only recursive removal is this uniquely created sibling. Source
        // and destination profiles never enter this cleanup path.
        if self.path.file_name().is_some_and(|name| name.to_string_lossy().starts_with(".rey30-idvj-profile-"))
            && fs::symlink_metadata(&self.path).is_ok_and(|metadata| check_directory(&metadata).is_ok())
        {
            if let Ok(target) = self.path.canonicalize() {
                if target.is_absolute() && target.parent() == Some(self.root.as_path()) {
                    let _ = fs::remove_dir_all(&target);
                }
            }
        }
    }
}

fn publish_without_overwrite(source: &Path, destination: &Path) -> io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    // No MOVEFILE_REPLACE_EXISTING: another launch's new profile always wins.
    let moved = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), MOVEFILE_WRITE_THROUGH) };
    if moved == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}

fn migrate_in(local_root: &Path, destination_id: &str) -> io::Result<Outcome> {
    if !local_root.is_absolute() || destination_id.is_empty()
        || Path::new(destination_id).components().count() != 1
        || !matches!(Path::new(destination_id).components().next(), Some(Component::Normal(_)))
        || destination_id == SOURCE_ID
    {
        return Err(invalid("raíces de migración no válidas"));
    }
    check_directory(&fs::symlink_metadata(local_root)?)?;
    let root = local_root.canonicalize()?;
    let destination = root.join(destination_id);
    if plain_directory(&root, Path::new(destination_id))? {
        return Ok(Outcome::DestinationExists);
    }
    let source_relative = Path::new(SOURCE_ID).join(LOCAL_STORAGE);
    if !plain_directory(&root, &source_relative)? { return Ok(Outcome::NoSource); }
    let source = root.join(source_relative);
    let snapshot = entries(&source)?;
    if !snapshot.iter().any(|entry| !entry.directory) { return Ok(Outcome::NoSource); }

    // LOCK first. Keeping every handle exclusive prevents a live LevelDB from
    // being copied and prevents it from opening midway through this snapshot.
    let mut files: Vec<_> = snapshot.iter().filter(|entry| !entry.directory).collect();
    files.sort_by_key(|entry| (entry.relative.file_name().is_none_or(|name| name != "LOCK"), &entry.relative));
    let mut locked = Vec::new();
    for entry in files {
        let handle = OpenOptions::new().read(true).share_mode(0)
            .custom_flags(OPEN_REPARSE_POINT).open(source.join(&entry.relative))?;
        let metadata = handle.metadata()?;
        if metadata.file_attributes() & REPARSE_POINT != 0 || !metadata.is_file()
            || metadata.len() != entry.bytes || metadata.modified().ok() != entry.modified
        { return Err(invalid("Local Storage cambió durante la preparación")); }
        locked.push((entry, handle));
    }
    if snapshot != entries(&source)? { return Err(invalid("Local Storage está cambiando")); }

    let stage = root.join(format!(".rey30-idvj-profile-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&stage)?;
    let _cleanup = StagingDirectory { root: root.clone(), path: stage.clone() };
    let stage_storage = stage.join(LOCAL_STORAGE);
    fs::create_dir_all(&stage_storage)?;
    for entry in snapshot.iter().filter(|entry| entry.directory) {
        fs::create_dir_all(stage_storage.join(&entry.relative))?;
    }
    for (entry, source_handle) in &mut locked {
        let mut output = OpenOptions::new().write(true).create_new(true)
            .open(stage_storage.join(&entry.relative))?;
        let mut expected_hash = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        let mut bytes = 0;
        loop {
            let count = source_handle.read(&mut buffer)?;
            if count == 0 { break; }
            output.write_all(&buffer[..count])?;
            expected_hash.update(&buffer[..count]);
            bytes += count as u64;
        }
        output.sync_all()?;
        drop(output);
        if bytes != entry.bytes { return Err(invalid("copia de Local Storage incompleta")); }
        let mut copied = File::open(stage_storage.join(&entry.relative))?;
        let mut actual_hash = Sha256::new();
        loop {
            let count = copied.read(&mut buffer)?;
            if count == 0 { break; }
            actual_hash.update(&buffer[..count]);
        }
        if expected_hash.finalize() != actual_hash.finalize() {
            return Err(invalid("la copia de Local Storage no coincide con el origen"));
        }
        source_handle.seek(SeekFrom::Start(0))?;
    }
    if snapshot != entries(&source)? { return Err(invalid("Local Storage cambió durante la copia")); }
    if plain_directory(&root, Path::new(destination_id))? { return Ok(Outcome::DestinationExists); }
    match publish_without_overwrite(&stage, &destination) {
        Ok(()) => Ok(Outcome::Migrated { files: locked.len() }),
        Err(_) if plain_directory(&root, Path::new(destination_id))? => Ok(Outcome::DestinationExists),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(root: &Path) -> PathBuf {
        let storage = root.join(SOURCE_ID).join(LOCAL_STORAGE);
        fs::create_dir_all(storage.join("leveldb")).unwrap();
        fs::write(storage.join("leveldb/LOCK"), b"").unwrap();
        fs::write(storage.join("leveldb/CURRENT"), b"MANIFEST-000001\n").unwrap();
        fs::write(storage.join("leveldb/000001.log"), b"saved-theme-and-provider-settings").unwrap();
        fs::write(root.join(SOURCE_ID).join("Cookies"), b"private-cookie").unwrap();
        storage
    }

    #[test]
    fn only_local_storage_is_copied_and_source_bytes_survive() {
        let root = tempfile::tempdir().unwrap();
        let source = fixture(root.path());
        assert_eq!(migrate_in(root.path(), "new.app").unwrap(), Outcome::Migrated { files: 3 });
        let copied = root.path().join("new.app").join(LOCAL_STORAGE).join("leveldb/000001.log");
        assert_eq!(fs::read(copied).unwrap(), fs::read(source.join("leveldb/000001.log")).unwrap());
        assert!(!root.path().join("new.app/Cookies").exists());
        assert!(root.path().join(SOURCE_ID).join("Cookies").exists());
    }

    #[test]
    fn existing_destination_has_priority() {
        let root = tempfile::tempdir().unwrap();
        fixture(root.path());
        fs::create_dir(root.path().join("new.app")).unwrap();
        fs::write(root.path().join("new.app/keep"), b"existing").unwrap();
        assert_eq!(migrate_in(root.path(), "new.app").unwrap(), Outcome::DestinationExists);
        assert_eq!(fs::read(root.path().join("new.app/keep")).unwrap(), b"existing");
        assert!(!root.path().join("new.app").join(LOCAL_STORAGE).exists());
    }

    #[test]
    fn active_leveldb_is_rejected_before_creating_the_destination() {
        let root = tempfile::tempdir().unwrap();
        let storage = fixture(root.path());
        let _active = File::open(storage.join("leveldb/LOCK")).unwrap();
        assert!(migrate_in(root.path(), "new.app").is_err());
        assert!(!root.path().join("new.app").exists());
    }

    #[test]
    fn absent_source_does_not_create_a_profile() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(migrate_in(root.path(), "new.app").unwrap(), Outcome::NoSource);
        assert!(!root.path().join("new.app").exists());
    }

    #[test]
    fn destinations_cannot_escape_the_root_or_replace_the_source() {
        let root = tempfile::tempdir().unwrap();
        for invalid in ["../elsewhere", SOURCE_ID, "", "C:\\outside"] {
            assert!(migrate_in(root.path(), invalid).is_err());
        }
    }
}
