//! Optional resource imports; discovery never activates a tool or executes a repository.
pub mod catalog;
pub mod credentials;
pub mod github;
pub mod imports;
pub mod recipes;
pub mod skill_pack;

#[cfg(feature = "tauri-app")]
pub mod commands;
