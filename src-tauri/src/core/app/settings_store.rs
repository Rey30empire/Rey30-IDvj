//! Backend-owned settings store for webview Zustand stores.
//!
//! Persists non-secret settings to `<rey30_data_folder>/settings.json` as a flat
//! JSON object (`{ "<namespace>": "<serialized-store-blob>" }`). The webview
//! reaches this via the async `StateStorage` adapter; an out-of-process consumer
//! (rey30-idvj CLI) can read the same file without an `AppHandle`. Secrets never land
//! here -- they go to the OS keyring via the provider-config path.
//!
//! The map is held in memory and mutated in place; disk writes are coalesced by
//! a background thread on a short debounce so a burst of `settings_set` calls
//! (each carrying the whole Zustand store blob) collapses into a single
//! whole-file rewrite instead of one O(total-size) rewrite per call. A
//! synchronous [`flush_settings`] drains the debounce on app exit so rey30-idvj CLI
//! never reads a stale file.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::commands::resolve_rey30_data_folder;
use crate::core::app::constants::CONFIGURATION_FILE_NAME;

/// How long to wait after the last mutation before flushing to disk. Bursts of
/// writes within this window coalesce into one rewrite.
const FLUSH_DEBOUNCE: Duration = Duration::from_millis(500);

/// In-memory settings map plus flush bookkeeping.
struct SettingsMap {
    map: BTreeMap<String, String>,
    /// Set on mutation, cleared once the current contents reach disk.
    dirty: bool,
    /// Earliest instant at which the background thread may flush; pushed
    /// forward on each write so rapid successive writes keep coalescing.
    flush_at: Option<Instant>,
    /// Keys changed since the last flush, for the dev-build write log. Only
    /// populated under `debug_assertions`.
    pending_keys: BTreeSet<String>,
    /// Set once a factory reset has deleted `settings.json`. From then on the
    /// store refuses writes, so neither the webview nor the exit flush can
    /// recreate the file before the app restarts.
    discarded: bool,
}

impl SettingsMap {
    /// Returns true if the value changed (i.e. a flush is warranted).
    fn set(&mut self, key: String, value: String) -> bool {
        if self.discarded || self.map.get(&key).is_some_and(|v| *v == value) {
            return false;
        }
        #[cfg(debug_assertions)]
        self.pending_keys.insert(key.clone());
        self.map.insert(key, value);
        true
    }

    /// Returns true if a key was actually removed.
    fn remove(&mut self, key: &str) -> bool {
        if self.discarded || self.map.remove(key).is_none() {
            return false;
        }
        #[cfg(debug_assertions)]
        self.pending_keys.insert(key.to_string());
        true
    }

    /// Drop everything, pending writes included, and refuse further changes.
    fn discard(&mut self) {
        self.map.clear();
        self.pending_keys.clear();
        self.dirty = false;
        self.flush_at = None;
        self.discarded = true;
    }

    fn mark_dirty(&mut self) {
        self.dirty = true;
        self.flush_at = Some(Instant::now() + FLUSH_DEBOUNCE);
    }

    /// Snapshot the contents for disk and clear the dirty/pending state.
    fn take_flush_batch(&mut self) -> (BTreeMap<String, String>, Vec<String>) {
        let snapshot = self.map.clone();
        let keys = std::mem::take(&mut self.pending_keys).into_iter().collect();
        self.dirty = false;
        self.flush_at = None;
        (snapshot, keys)
    }
}

/// Dev-only: report which settings keys just hit disk. Compiled out of release
/// builds (`make dev` / `yarn dev:tauri` build with `debug_assertions`).
fn log_flushed_keys(keys: &[String]) {
    #[cfg(debug_assertions)]
    if !keys.is_empty() {
        log::debug!(
            "settings: flushed {} key(s) to disk: {}",
            keys.len(),
            keys.join(", ")
        );
    }
    #[cfg(not(debug_assertions))]
    let _ = keys;
}

type Store = (Mutex<SettingsMap>, Condvar);

static STORE: OnceLock<Store> = OnceLock::new();

/// Disk writers and discard acquire WRITE before the map, including explicit
/// commits. A delayed writer must select current values after acquiring WRITE.
static WRITE: Mutex<()> = Mutex::new(());

fn settings_file_path() -> PathBuf {
    resolve_rey30_data_folder().join(CONFIGURATION_FILE_NAME)
}

fn read_map(path: &PathBuf) -> BTreeMap<String, String> {
    match fs::read_to_string(path) {
        Ok(content) if !content.trim().is_empty() => {
            serde_json::from_str(&content).unwrap_or_default()
        }
        _ => BTreeMap::new(),
    }
}

fn write_map_atomic(path: &PathBuf, map: &BTreeMap<String, String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let serialized = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .map_err(|e| e.to_string())?;
    let result = (|| {
        file.write_all(serialized.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn store() -> &'static Store {
    STORE.get_or_init(|| {
        let initial = SettingsMap {
            map: read_map(&settings_file_path()),
            dirty: false,
            flush_at: None,
            pending_keys: BTreeSet::new(),
            discarded: false,
        };
        std::thread::Builder::new()
            .name("settings-flush".into())
            .spawn(flush_loop)
            .ok();
        (Mutex::new(initial), Condvar::new())
    })
}

fn lock(store: &Store) -> std::sync::MutexGuard<'_, SettingsMap> {
    lock_map(&store.0)
}

fn lock_map(map: &Mutex<SettingsMap>) -> std::sync::MutexGuard<'_, SettingsMap> {
    map.lock().unwrap_or_else(|e| e.into_inner())
}

/// Persist current values while serializing both the snapshot and disk write.
/// Failures retain pending keys and back off before the background retry.
fn persist(state: &Mutex<SettingsMap>, path: &PathBuf) -> Result<bool, String> {
    let _write = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let mut guard = lock_map(state);
    if guard.discarded {
        return Ok(false);
    }
    match write_map_atomic(path, &guard.map) {
        Ok(()) => {
            let (_, keys) = guard.take_flush_batch();
            log_flushed_keys(&keys);
            Ok(true)
        }
        Err(error) => {
            guard.mark_dirty();
            Err(error)
        }
    }
}

/// Background thread: waits for dirty state, honors the debounce deadline
/// (re-waiting if a newer write pushed it forward), then persists current values.
fn flush_loop() {
    let store = store();
    let cvar = &store.1;
    loop {
        let mut guard = lock(store);
        while !guard.dirty {
            guard = cvar.wait(guard).unwrap_or_else(|e| e.into_inner());
        }
        while let Some(deadline) = guard.flush_at {
            match deadline.checked_duration_since(Instant::now()) {
                Some(remaining) if !remaining.is_zero() => {
                    let (g, _) = cvar
                        .wait_timeout(guard, remaining)
                        .unwrap_or_else(|e| e.into_inner());
                    guard = g;
                }
                _ => break,
            }
        }
        drop(guard);
        match persist(&store.0, &settings_file_path()) {
            Ok(_) => {}
            Err(e) => log::warn!("settings flush failed: {}", e),
        }
    }
}

/// Synchronously write pending changes to disk. Call on app exit so the
/// debounce window can't drop the last writes or strand rey30-idvj CLI with a stale
/// file. No-op when nothing is dirty.
pub fn flush_settings() {
    let store = store();
    let guard = lock(store);
    if !guard.dirty {
        return;
    }
    drop(guard);
    match persist(&store.0, &settings_file_path()) {
        Ok(_) => {}
        Err(e) => log::warn!("settings exit flush failed: {}", e),
    }
}

/// Forget the in-memory settings and stop persisting them for the rest of
/// this process. Factory reset calls this after deleting `settings.json`;
/// without it a pending debounced write or the exit flush would write the
/// pre-reset settings straight back.
pub fn discard_settings() {
    let store = store();
    // Wait out a write already in flight; any later one sees `discarded`.
    let _write = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    lock(store).discard();
}

#[tauri::command]
pub fn settings_get(key: String) -> Option<String> {
    let store = store();
    lock(store).map.get(&key).cloned()
}

#[tauri::command]
pub fn settings_set(key: String, value: String) -> Result<(), String> {
    let store = store();
    let mut guard = lock(store);
    if guard.set(key, value) {
        guard.mark_dirty();
        store.1.notify_one();
    }
    Ok(())
}

#[tauri::command]
pub fn settings_remove(key: String) -> Result<(), String> {
    let store = store();
    let mut guard = lock(store);
    if guard.remove(&key) {
        guard.mark_dirty();
        store.1.notify_one();
    }
    Ok(())
}

#[tauri::command]
pub fn settings_commit() -> Result<(), String> {
    if persist(&store().0, &settings_file_path())? {
        Ok(())
    } else {
        Err("El almacenamiento de ajustes ya no admite escrituras.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_map() -> SettingsMap {
        SettingsMap {
            map: BTreeMap::new(),
            dirty: false,
            flush_at: None,
            pending_keys: BTreeSet::new(),
            discarded: false,
        }
    }

    #[test]
    fn set_reports_change_and_ignores_noop() {
        let mut m = new_map();
        assert!(m.set("a".into(), "1".into()));
        assert!(!m.set("a".into(), "1".into())); // unchanged -> no flush
        assert!(m.set("a".into(), "2".into()));
        assert_eq!(m.map.get("a"), Some(&"2".to_string()));
    }

    #[test]
    fn remove_reports_whether_present() {
        let mut m = new_map();
        m.set("a".into(), "1".into());
        assert!(m.remove("a"));
        assert!(!m.remove("a"));
        assert!(!m.remove("missing"));
    }

    #[test]
    fn mark_dirty_arms_flush() {
        let mut m = new_map();
        assert!(!m.dirty);
        assert!(m.flush_at.is_none());
        m.mark_dirty();
        assert!(m.dirty);
        assert!(m.flush_at.is_some());
    }

    #[test]
    fn take_flush_batch_snapshots_and_clears() {
        let mut m = new_map();
        m.set("a".into(), "1".into());
        m.set("b".into(), "2".into());
        m.mark_dirty();
        let (snapshot, keys) = m.take_flush_batch();
        assert_eq!(snapshot.len(), 2);
        assert!(!m.dirty);
        assert!(m.flush_at.is_none());
        assert!(m.pending_keys.is_empty());
        // pending_keys only tracked under debug_assertions (tests run debug).
        assert_eq!(keys, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn discard_empties_the_map_and_ignores_later_writes() {
        let mut m = new_map();
        m.set("a".into(), "1".into());
        m.mark_dirty();
        m.discard();
        assert!(m.map.is_empty());
        assert!(!m.dirty);
        assert!(m.flush_at.is_none());
        assert!(m.pending_keys.is_empty());
        // A webview write racing the factory-reset restart must not bring a
        // wiped settings.json back.
        assert!(!m.set("b".into(), "2".into()));
        assert!(!m.remove("a"));
        assert!(m.map.is_empty());
    }

    #[test]
    fn persist_skips_the_write_once_discarded() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut map = BTreeMap::new();
        map.insert("theme".to_string(), "\"dark\"".to_string());
        let state = Mutex::new(new_map());
        state.lock().unwrap().map = map;

        assert_eq!(persist(&state, &path), Ok(true));
        assert!(path.is_file());

        // A flush that snapshotted before the reset must not recreate the file.
        fs::remove_file(&path).unwrap();
        state.lock().unwrap().discard();
        assert_eq!(persist(&state, &path), Ok(false));
        assert!(!path.exists());
    }

    #[test]
    fn set_preserves_other_keys() {
        let mut m = new_map();
        m.set("a".into(), "1".into());
        m.set("b".into(), "2".into());
        m.set("a".into(), "3".into());
        assert_eq!(m.map.get("a"), Some(&"3".to_string()));
        assert_eq!(m.map.get("b"), Some(&"2".to_string()));
    }

    #[test]
    fn write_then_read_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut map = BTreeMap::new();
        map.insert("model-provider".to_string(), "{\"a\":1}".to_string());
        map.insert("theme".to_string(), "\"dark\"".to_string());
        write_map_atomic(&path, &map).unwrap();
        assert_eq!(read_map(&path), map);
    }

    #[test]
    fn read_missing_or_empty_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope.json");
        assert!(read_map(&missing).is_empty());
        let empty = dir.path().join("empty.json");
        fs::write(&empty, "   ").unwrap();
        assert!(read_map(&empty).is_empty());
    }

    #[test]
    fn delayed_writer_persists_the_latest_point_without_reverting_it() {
        use std::sync::{Arc, Barrier};
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let state = Arc::new(Mutex::new(new_map()));
        state.lock().unwrap().set("point".into(), "old".into());
        let gate = WRITE.lock().unwrap_or_else(|e| e.into_inner());
        let ready = Arc::new(Barrier::new(2));
        let worker_state = state.clone();
        let worker_ready = ready.clone();
        let worker_path = path.clone();
        let writer = std::thread::spawn(move || {
            worker_ready.wait();
            persist(&worker_state, &worker_path)
        });
        ready.wait();
        state.lock().unwrap().set("point".into(), "new".into());
        drop(gate);
        assert_eq!(writer.join().unwrap(), Ok(true));
        assert_eq!(read_map(&path).get("point"), Some(&"new".into()));
        assert!(!state.lock().unwrap().dirty);
    }

    #[test]
    fn failed_commit_preserves_pending_values_and_can_be_retried() {
        let dir = tempfile::tempdir().unwrap();
        let blocked = dir.path().join("blocked");
        fs::write(&blocked, b"owned obstacle").unwrap();
        let path = blocked.join("settings.json");
        let state = Mutex::new(new_map());
        state.lock().unwrap().set("point".into(), "saved".into());
        assert!(persist(&state, &path).is_err());
        assert_eq!(fs::read(&blocked).unwrap(), b"owned obstacle");
        assert!(state.lock().unwrap().dirty);
        assert!(state.lock().unwrap().flush_at.is_some());
        fs::remove_file(&blocked).unwrap();
        assert_eq!(persist(&state, &path), Ok(true));
        assert_eq!(read_map(&path).get("point"), Some(&"saved".into()));
    }
}
