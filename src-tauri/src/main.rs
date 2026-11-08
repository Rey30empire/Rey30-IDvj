// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Windows: from here on, every DLL the process loads is resolved from System32 only,
/// including the dependencies that System32 DLLs load lazily (e.g. `windows.storage.dll`
/// pulling in `profapi.dll` the first time a shell folder is queried). Without it those
/// loads search the install folder first, so a DLL planted there runs inside Rey30 IDvj.
/// The `/DEPENDENTLOADFLAG` link arg in build.rs only covers the exe's own static
/// imports, which are resolved before `main`. The setting is per process and is not
/// inherited by the engine worker or other helpers Rey30 IDvj spawns.
#[cfg(windows)]
fn restrict_dll_search_to_system32() {
    use windows_sys::Win32::System::LibraryLoader::{
        SetDefaultDllDirectories, LOAD_LIBRARY_SEARCH_SYSTEM32,
    };
    // SAFETY: plain Win32 call with a constant flag and no pointers. It only fails on
    // Windows builds that predate the API, where there is nothing to restrict.
    let _ = unsafe { SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32) };
}

fn main() {
    // Must stay first: nothing below may load a DLL before the search path is restricted.
    #[cfg(windows)]
    restrict_dll_search_to_system32();

    // Fix PATH before anything that may spawn subprocesses, so the engine
    // worker (and any other child) inherits directories added by fix_path_env.
    let _ = fix_path_env::fix();

    // Exits early if invoked as the Windows sandbox helper for a `bash` tool call.
    tauri_plugin_agent_tools::run_sandbox_helper_if_requested();

    // The portable installer can register the pack without opening a model or webview.
    let mut args = std::env::args_os().skip(1);
    if let Some(command) = args.next() {
        let install = command == "--install-skill-pack";
        if install || command == "--skill-pack-status" {
            let result = match (args.next(), args.next()) {
                (Some(folder), None) => {
                    let folder = std::path::PathBuf::from(folder);
                    if !folder.is_absolute() {
                        Err("La carpeta de datos debe ser absoluta.".to_string())
                    } else if install {
                        app_lib::core::integrations::skill_pack::install(&folder)
                    } else {
                        app_lib::core::integrations::skill_pack::status(&folder)
                    }
                }
                _ => Err("Uso: Rey30-IDvj --install-skill-pack <carpeta absoluta> o --skill-pack-status <carpeta absoluta>.".to_string()),
            };
            match result {
                Ok(status) => match serde_json::to_string_pretty(&status) {
                    Ok(json) => println!("{json}"),
                    Err(error) => {
                        eprintln!("No se pudo serializar el estado del paquete: {error}");
                        std::process::exit(1);
                    }
                },
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
    }

    app_lib::run();
}
