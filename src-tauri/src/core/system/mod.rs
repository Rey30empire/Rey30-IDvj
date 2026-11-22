pub mod commands;
pub mod character_audio;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod models_root;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod lore;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod pluma_clone;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod pluma_documents;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod pluma_first_asr;
#[cfg(windows)]
mod pluma_music;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod avatar_images;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod pluma_reading;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod pluma_recordings;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod pluma_realtime;
pub mod shutdown;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod wsl_hub;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod local_model_scan;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod strata;
// Process-table sweep; desktop-only, `sysinfo` is not a mobile dependency.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod orphans;
