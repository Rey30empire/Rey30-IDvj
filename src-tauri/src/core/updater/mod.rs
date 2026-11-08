// The desktop commands report when updates are disabled. HMAC signing also
// serves the separate model-download mirror.
#[cfg(not(feature = "cli"))]
pub mod commands;
pub mod custom_updater;
pub mod hmac_client;
#[cfg(not(feature = "cli"))]
pub mod session;
