//! Open a fully resolved path without following any link along it.
//!
//! The filesystem tools decide where a path lands ([`super::sandbox::landing`])
//! and only then touch it. Reopening the path by name afterwards would resolve
//! it a second time, and a link swapped into it in between (the sandboxed shell
//! can write the project) would carry the write somewhere the check never saw.
//! These helpers take the already-resolved path, which contains no links, and
//! walk it one directory at a time refusing any link they meet, so the file
//! they open is the one that was checked or nothing at all.
//!
//! Unix walks with `openat(O_NOFOLLOW)` relative to the previous directory's
//! descriptor. Windows has no `openat` in std, so each ancestor is held open
//! without `FILE_SHARE_DELETE`, which keeps it from being renamed or replaced
//! while the walk below it runs, and each node is probed with
//! `FILE_FLAG_OPEN_REPARSE_POINT` and refused if it is a link or junction. The
//! leaf is then reopened normally, so cloud placeholders still download.

use std::io::{self, Read, Write};
use std::path::Path;

/// Marker for "a link was found where the resolved path had none": the path was
/// changed between the containment check and the open.
#[derive(Debug)]
pub struct LinkRefused;

impl std::fmt::Display for LinkRefused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("a path component became a symbolic link")
    }
}

impl std::error::Error for LinkRefused {}

/// True iff `e` is the [`LinkRefused`] refusal rather than an ordinary I/O error.
pub fn is_link_refused(e: &io::Error) -> bool {
    e.get_ref().is_some_and(|inner| inner.is::<LinkRefused>())
}

fn refused() -> io::Error {
    io::Error::other(LinkRefused)
}

fn invalid(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("not an absolute resolved path: {}", path.display()),
    )
}

/// Read the file at the resolved `path`.
pub fn read(path: &Path) -> io::Result<Vec<u8>> {
    let mut file = imp::open_leaf(path, false, false)?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    Ok(buf)
}

/// Read a bounded regular file and refuse all reparse points on Windows,
/// including cloud placeholders that could initiate a download.
pub fn read_regular_capped(path: &Path, limit: u64) -> io::Result<Vec<u8>> {
    let file = open_regular_capped(path, limit)?;
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(1)).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "file exceeds read limit",
        ));
    }
    Ok(bytes)
}

/// Open the same kind of checked file for a bounded random-access parser.
pub fn open_regular_capped(path: &Path, limit: u64) -> io::Result<std::fs::File> {
    let file = imp::open_leaf(path, false, true)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "not a bounded regular file",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(refused());
        }
    }
    Ok(file)
}

/// Create or truncate the file at the resolved `path` and write `bytes`,
/// creating any missing parent directories on the way.
pub fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = imp::open_leaf(path, true, false)?;
    file.write_all(bytes)?;
    file.flush()
}

#[cfg(unix)]
mod imp {
    use super::{invalid, refused};
    use nix::errno::Errno;
    use nix::fcntl::{openat, AtFlags, OFlag, AT_FDCWD};
    use nix::sys::stat::{fstatat, mkdirat, Mode, SFlag};
    use std::ffi::OsStr;
    use std::fs::File;
    use std::io;
    use std::os::fd::OwnedFd;
    use std::path::{Component, Path};

    /// A directory descriptor that needs only search permission on the
    /// directory, so a `711` parent (common for `/home/<user>`) still walks.
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    const DIR: OFlag = OFlag::O_PATH;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    const DIR: OFlag = OFlag::O_SEARCH;
    #[cfg(not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "freebsd",
        target_os = "macos",
        target_os = "ios"
    )))]
    const DIR: OFlag = OFlag::O_RDONLY;

    /// Map a failed no-follow open of `name` under `dir`: a link there is the
    /// swap this module exists to catch. Platforms disagree on the errno
    /// (`ELOOP`, or `ENOTDIR` when `O_DIRECTORY` sees the link), so ask the
    /// directory what the entry is instead of trusting the code.
    fn classify(dir: &OwnedFd, name: &OsStr, err: Errno) -> io::Error {
        match fstatat(dir, name, AtFlags::AT_SYMLINK_NOFOLLOW) {
            Ok(st) if SFlag::from_bits_truncate(st.st_mode) & SFlag::S_IFMT == SFlag::S_IFLNK => {
                refused()
            }
            _ => err.into(),
        }
    }

    pub(super) fn open_leaf(path: &Path, create: bool, _strict: bool) -> io::Result<File> {
        let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
            return Err(invalid(path));
        };
        let mut comps = parent.components();
        if comps.next() != Some(Component::RootDir) {
            return Err(invalid(path));
        }
        let dir_flags = DIR | OFlag::O_DIRECTORY | OFlag::O_NOFOLLOW | OFlag::O_CLOEXEC;
        let mut dir = openat(AT_FDCWD, "/", dir_flags, Mode::empty())?;
        for c in comps {
            let Component::Normal(part) = c else {
                return Err(invalid(path));
            };
            if create {
                match mkdirat(&dir, part, Mode::from_bits_truncate(0o777)) {
                    Ok(()) | Err(Errno::EEXIST) => {}
                    Err(e) => return Err(e.into()),
                }
            }
            dir = match openat(&dir, part, dir_flags, Mode::empty()) {
                Ok(next) => next,
                Err(e) => return Err(classify(&dir, part, e)),
            };
        }
        let flags = if create {
            OFlag::O_WRONLY | OFlag::O_CREAT | OFlag::O_TRUNC
        } else {
            OFlag::O_RDONLY
        } | OFlag::O_NOFOLLOW
            | OFlag::O_CLOEXEC;
        match openat(&dir, name, flags, Mode::from_bits_truncate(0o666)) {
            Ok(fd) => Ok(File::from(fd)),
            Err(e) => Err(classify(&dir, name, e)),
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::{invalid, refused};
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::os::windows::io::AsRawHandle;
    use std::path::{Component, Path, PathBuf};
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    /// No `FILE_SHARE_DELETE`: while this handle lives, nobody can rename,
    /// delete or replace the node, which is what pins the walked chain.
    const SHARE: u32 = FILE_SHARE_READ | FILE_SHARE_WRITE;

    /// Refuse a link or junction. `File::metadata` reads the reparse tag, so
    /// `is_symlink` is true only for name-surrogate tags: a OneDrive
    /// placeholder is also a reparse point and must stay writable.
    fn reject_link(file: &File, strict: bool) -> io::Result<std::fs::Metadata> {
        let meta = file.metadata()?;
        if meta.file_type().is_symlink()
            || (strict && meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
        {
            return Err(refused());
        }
        Ok(meta)
    }

    fn pin_dir(path: &Path, strict: bool) -> io::Result<File> {
        let dir = OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES)
            .share_mode(SHARE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        if !reject_link(&dir, strict)?.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                format!("not a directory: {}", path.display()),
            ));
        }
        Ok(dir)
    }

    /// Open the leaf itself, never what a link there points at, holding it
    /// against rename and delete. With `create`, a missing leaf is created as
    /// a plain file: `create_new` refuses to reuse anything already there,
    /// a dangling link included, so the retry re-probes what appeared.
    fn probe_leaf(path: &Path, create: bool) -> io::Result<File> {
        let probe = || {
            OpenOptions::new()
                .access_mode(FILE_READ_ATTRIBUTES)
                .share_mode(SHARE)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(path)
        };
        match probe() {
            Err(e) if create && e.kind() == io::ErrorKind::NotFound => {}
            other => return other,
        }
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .share_mode(SHARE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
        {
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => probe(),
            other => other,
        }
    }

    pub(super) fn open_leaf(path: &Path, create: bool, strict: bool) -> io::Result<File> {
        let (Some(parent), Some(_)) = (path.parent(), path.file_name()) else {
            return Err(invalid(path));
        };
        if !parent.has_root() {
            return Err(invalid(path));
        }
        let mut walked = PathBuf::new();
        let mut held: Vec<File> = Vec::new();
        for c in parent.components() {
            match c {
                Component::Prefix(_) => {
                    walked.push(c.as_os_str());
                    continue;
                }
                Component::RootDir => walked.push(c.as_os_str()),
                Component::Normal(part) => {
                    walked.push(part);
                    if create {
                        match std::fs::create_dir(&walked) {
                            Ok(()) => {}
                            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
                            Err(e) => return Err(e),
                        }
                    }
                }
                _ => return Err(invalid(path)),
            }
            held.push(pin_dir(&walked, strict)?);
        }
        // The leaf is checked through a probe and used through a second, plain
        // open. Opening it with OPEN_REPARSE_POINT for real would hand back a
        // cloud-only OneDrive placeholder undownloaded, so reads would see the
        // stub. The probe holds the leaf without FILE_SHARE_DELETE, so it is
        // still the same file when the plain open follows.
        let probe = probe_leaf(path, create)?;
        reject_link(&probe, strict)?;
        let mut opts = OpenOptions::new();
        opts.share_mode(if strict { FILE_SHARE_READ } else { SHARE });
        if create {
            // Not `truncate`: kept symmetric with the probe; emptied below.
            opts.write(true);
        } else {
            opts.read(true);
        }
        if strict {
            opts.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        }
        let file = opts.open(path)?;
        if strict {
            reject_link(&file, true)?;
            let mut info = BY_HANDLE_FILE_INFORMATION::default();
            // SAFETY: file owns a live handle and info has the native output layout.
            if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
                return Err(io::Error::last_os_error());
            }
            if info.nNumberOfLinks != 1 {
                return Err(refused());
            }
        }
        drop(probe);
        if create {
            file.set_len(0)?;
        }
        drop(held);
        Ok(file)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A directory link. Windows uses a junction: it needs no privilege, so the
    /// test runs on every Windows machine, and it is the link a sandboxed
    /// process could actually plant.
    fn link_dir(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        {
            let status = std::process::Command::new("cmd")
                .arg("/C")
                .arg("mklink")
                .arg("/J")
                .arg(link)
                .arg(target)
                .stdout(std::process::Stdio::null())
                .status()
                .unwrap();
            assert!(status.success(), "mklink /J failed");
        }
    }

    /// A file link, or `false` where the platform will not make one: Windows
    /// file symlinks need Developer Mode or elevation. CI runners have it, so
    /// there a refusal is a failure, not a skip.
    fn link_file(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(target, link);
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file(target, link);
        match made {
            Ok(()) => true,
            Err(e) if std::env::var_os("CI").is_none() => {
                eprintln!("skipping: cannot create a file symlink here: {e}");
                false
            }
            Err(e) => panic!("file symlink on CI: {e}"),
        }
    }

    fn dir() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let d =
            std::env::temp_dir().join(format!("rey30_nofollow_test_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&d).unwrap();
        // Unix: macOS's temp dir sits behind the `/var -> /private/var` link,
        // which the walk would rightly refuse. Windows: keep the plain
        // spelling, since `mklink` does not take a `\\?\` path.
        #[cfg(unix)]
        let d = d.canonicalize().unwrap();
        d
    }

    #[test]
    fn writes_and_reads_creating_parents() {
        let root = dir();
        let target = root.join("a").join("b").join("c.txt");
        write(&target, b"hello").unwrap();
        assert_eq!(read(&target).unwrap(), b"hello");
        write(&target, b"hi").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"hi", "truncates");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A link swapped in for a directory after the path was resolved: the walk
    /// must stop there instead of writing on the far side.
    #[test]
    fn a_link_in_a_directory_component_is_refused() {
        let root = dir();
        let outside = dir();
        link_dir(&outside, &root.join("sub"));
        let through = root.join("sub").join("x.txt");
        for create in [true, false] {
            let err = if create {
                write(&through, b"x").unwrap_err()
            } else {
                read(&through).unwrap_err()
            };
            assert!(is_link_refused(&err), "create={create}: {err}");
        }
        assert!(!outside.join("x.txt").exists());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// The leaf itself swapped for a link, dangling or not: neither is followed.
    #[test]
    fn a_link_at_the_leaf_is_refused() {
        let root = dir();
        let outside = dir();
        std::fs::write(outside.join("existing"), b"keep").unwrap();
        if !link_file(&outside.join("existing"), &root.join("a"))
            || !link_file(&outside.join("new"), &root.join("b"))
        {
            return;
        }
        assert!(is_link_refused(&write(&root.join("a"), b"x").unwrap_err()));
        assert!(is_link_refused(&write(&root.join("b"), b"x").unwrap_err()));
        assert!(is_link_refused(&read(&root.join("a")).unwrap_err()));
        assert_eq!(std::fs::read(outside.join("existing")).unwrap(), b"keep");
        assert!(!outside.join("new").exists());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn a_relative_path_is_rejected() {
        let err = write(Path::new("rel/x.txt"), b"x").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }
}
