//! Update commands for Rey30 IDvj. An owned, signed release feed is not
//! configured, so this build never fetches or installs another application's
//! binaries. Model downloads use their separate download service.

use std::cmp::Ordering;
use std::path::PathBuf;
use std::time::Duration;

pub const MANUAL_CHECK_TIMEOUT: Duration = Duration::from_secs(15);
const UNAVAILABLE: &str = "Automatic updates are disabled: no signed Rey30 IDvj release feed is configured.";

#[derive(Debug, Clone)]
pub struct AvailableUpdate {
    pub channel: &'static str,
    pub current: String,
    pub latest: String,
    pub url: Option<String>,
    pub sha256: Option<String>,
}

#[derive(Debug)]
pub enum UpdateOutcome {
    UpToDate { version: String },
    Installed { from: String, to: String, path: PathBuf },
}

pub fn build_version() -> &'static str {
    option_env!("REY30_CLI_BUILD_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
}

fn compare_versions(a: &str, b: &str) -> Ordering {
    let seg = |v: &str| -> Vec<String> {
        v.trim_start_matches('v')
            .split(['.', '-', '+'])
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect()
    };
    let (a, b) = (seg(a), seg(b));
    for i in 0..a.len().max(b.len()) {
        let ord = match (a.get(i), b.get(i)) {
            (Some(x), Some(y)) => match (x.parse::<u64>(), y.parse::<u64>()) {
                (Ok(x), Ok(y)) => x.cmp(&y),
                _ => x.cmp(y),
            },
            (Some(_), None) => Ordering::Greater,
            (None, Some(_)) => Ordering::Less,
            (None, None) => Ordering::Equal,
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
    Ordering::Equal
}


impl AvailableUpdate {
    pub fn is_newer(&self) -> bool {
        compare_versions(&self.latest, &self.current) == Ordering::Greater
    }

    pub fn summary(&self) -> String {
        format!("A new {} build is available: {} -> {}", self.channel, self.current, self.latest)
    }
}

pub async fn check_for_update(_timeout: Duration) -> Result<AvailableUpdate, String> {
    Err(UNAVAILABLE.to_string())
}

pub async fn available_update() -> Option<AvailableUpdate> {
    None
}

pub async fn print_update_notice_if_available() {}

pub async fn self_update(_force: bool) -> Result<UpdateOutcome, String> {
    Err(UNAVAILABLE.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn startup_and_explicit_update_never_replace_this_fork() {
        assert!(available_update().await.is_none());
        assert!(check_for_update(Duration::ZERO).await.unwrap_err().contains("disabled"));
        assert!(self_update(true).await.unwrap_err().contains("Rey30 IDvj"));
    }
}
