import { join } from 'node:path'

/**
 * The directory the Rust side resolves for app data, inside a throwaway profile.
 *
 * Mirrors `app_data_dir_with_fallback()` -> `data_dir()/Rey30-IDvj`
 * (src-tauri/src/core/app/commands.rs, core/app/paths.rs). Kept as a plain
 * function of the test HOME so specs can assert against real on-disk paths
 * rather than against the environment the harness itself injected.
 */
export function rey30DataDir(testHome: string) {
  return process.platform === 'darwin'
    ? join(testHome, 'Library/Application Support/Rey30-IDvj')
    : process.platform === 'win32'
      ? join(testHome, 'AppData/Roaming/Rey30-IDvj')
      : join(testHome, '.local/share/Rey30-IDvj')
}

/**
 * The folder Rey30 IDvj stores user data in -- threads, and everything else the Rust
 * side writes per-thread.
 *
 * Not the same directory as rey30DataDir(): that one holds `settings.json`, and
 * `settings.json` in turn points `data_folder` at this subdirectory. The Rust
 * thread code takes that folder as an argument
 * (core/threads/utils.rs get_thread_dir), so a spec checking for a thread on
 * disk has to go through the extra `data` segment or it asserts against a path
 * that never existed -- which passes for the wrong reason when the assertion is
 * that something is absent.
 */
export function rey30UserDataDir(testHome: string) {
  return join(rey30DataDir(testHome), 'data')
}
