//! The one folder that holds the models Rey30 IDvj runs locally: Pluma's
//! Gemma 4, LFM3 and Qwen3-TTS, and ACE-Step for songs. It lives on the NVMe
//! system drive so a call loads its models in seconds; `REY30_MODELS_DIR`
//! points it somewhere else.

use std::path::PathBuf;

/// Default location of the local models.
pub const DEFAULT_MODELS_ROOT: &str = r"C:\Modelos IA Rey30";

/// Folder the local models are read from: `REY30_MODELS_DIR` when it is an
/// absolute path, the default location otherwise.
pub fn models_root() -> PathBuf {
    root_from(std::env::var_os("REY30_MODELS_DIR").map(PathBuf::from))
}

fn root_from(configured: Option<PathBuf>) -> PathBuf {
    configured
        .filter(|path| path.is_absolute())
        .unwrap_or_else(|| PathBuf::from(DEFAULT_MODELS_ROOT))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_the_system_drive_folder() {
        assert_eq!(root_from(None), PathBuf::from(DEFAULT_MODELS_ROOT));
    }

    #[test]
    fn an_absolute_override_wins_and_a_relative_one_is_ignored() {
        let absolute = std::env::temp_dir().join("modelos");
        assert_eq!(root_from(Some(absolute.clone())), absolute);
        assert_eq!(
            root_from(Some(PathBuf::from("relativa"))),
            PathBuf::from(DEFAULT_MODELS_ROOT)
        );
    }
}
