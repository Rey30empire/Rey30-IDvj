//! One CLI session's run-time provider overrides, and the in-memory model
//! roster of its *session-scoped* provider.
//!
//! The overrides (`--provider`, `--api-key`, `--base-url` and their environment
//! fallbacks, see [`ProviderOverrides::with_env`]) are resolved once by the
//! binary and recorded here, so every later rebuild of the provider map -- a
//! TUI reload after `/login`, the `/model` probe, `cli models list` -- applies
//! the same set rather than silently dropping the session's key on the first
//! one. The agent loop never reads this module: it sees only the
//! `ProviderConfig`s built from it, and the desktop does not compile `core::cli`
//! at all.
//!
//! **RPC** installs nothing: `rey30-idvj cli agent rpc` takes no provider overrides by
//! design, because an ADK host brings its own per session, so its sessions build
//! with `ProviderOverrides::default()`. The `session-overrides` capability
//! describes the TUI, `run` and `step`.
//!
//! **Session-scoped provider.** One named with an explicit `--provider` whose
//! base URL or key came from these overrides
//! ([`ProviderOverrides::session_scoped_provider`]). Its model ids and prices
//! describe the endpoint this session points at, not the one `~/.rey30-idvj` was
//! written for, so they live here, in memory, and never reach `config.toml` or
//! `model_catalog.json`:
//!
//! - the overlay **replaces** that provider's roster and catalog entries; it
//!   never merges with them, since a native entry's ids are ids the session's
//!   endpoint may not serve;
//! - once the base URL came from the session, the overlay is authoritative even
//!   while empty. A failed probe then leaves no roster and no prices, rather
//!   than the file's (another endpoint's) or another provider's for the same id
//!   -- a price nobody quoted would meter a spend cap against the wrong rates;
//! - when only the key came from the session, the endpoint is the configured
//!   one, so until a probe answers the file's roster and prices still describe
//!   it and stay in effect.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, RwLock};

use super::model_catalog::{Catalog, ModelInfo};
use super::providers::ProviderOverrides;
use crate::core::state::ProviderConfig;

#[derive(Debug, Clone)]
struct State {
    overrides: ProviderOverrides,
    overlay: Option<Overlay>,
}

#[derive(Debug, Clone)]
struct Overlay {
    provider: String,
    /// Whether the file's roster and prices describe this provider's endpoint:
    /// only the key came from the session, not the base URL.
    inherit_disk: bool,
    /// What the endpoint listed, once a probe answered.
    listing: Option<Listing>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct Listing {
    ids: Vec<String>,
    info: BTreeMap<String, ModelInfo>,
}

static STATE: RwLock<Option<State>> = RwLock::new(None);

/// A one-line report of the startup probe, for a surface that could not print
/// it when it happened (the TUI's alternate screen hides stderr).
static STARTUP_NOTICE: Mutex<Option<String>> = Mutex::new(None);

fn read() -> std::sync::RwLockReadGuard<'static, Option<State>> {
    STATE.read().unwrap_or_else(|e| e.into_inner())
}

fn write() -> std::sync::RwLockWriteGuard<'static, Option<State>> {
    STATE.write().unwrap_or_else(|e| e.into_inner())
}

/// Record `overrides` as the session's, starting an empty overlay for the
/// session-scoped provider when there is one. Replaces anything recorded before.
pub(crate) fn install(overrides: &ProviderOverrides) {
    let overlay = overrides.session_scoped_provider().map(|provider| Overlay {
        provider: provider.to_string(),
        inherit_disk: overrides.base_url.is_none(),
        listing: None,
    });
    *write() = Some(State {
        overrides: overrides.clone(),
        overlay,
    });
}

/// The overrides recorded by [`install`], if any.
pub(crate) fn overrides() -> Option<ProviderOverrides> {
    read().as_ref().map(|state| state.overrides.clone())
}

/// The session-scoped provider, if this session has one.
pub(crate) fn scoped_provider() -> Option<String> {
    read()
        .as_ref()
        .and_then(|state| state.overlay.as_ref())
        .map(|overlay| overlay.provider.clone())
}

/// Whether `provider` is this session's session-scoped provider.
pub(crate) fn is_session_scoped(provider: &str) -> bool {
    scoped_provider().as_deref() == Some(provider)
}

/// Put the overlay's roster on the session-scoped provider's config. Only for a
/// load made with the session's own overrides naming that provider, so a load
/// with other overrides (RPC's `default()`, a test) sees the files alone.
pub(crate) fn apply_roster(
    configs: &mut HashMap<String, ProviderConfig>,
    overrides: &ProviderOverrides,
) {
    let Some(provider) = overrides.session_scoped_provider() else {
        return;
    };
    let guard = read();
    let Some(overlay) = guard
        .as_ref()
        .and_then(|state| state.overlay.as_ref())
        .filter(|overlay| overlay.provider == provider)
    else {
        return;
    };
    let Some(config) = configs.get_mut(provider) else {
        return;
    };
    match &overlay.listing {
        Some(listing) => config.models = listing.ids.clone(),
        None if !overlay.inherit_disk => config.models.clear(),
        None => {}
    }
}

/// The overlay as a one-provider catalog, when it is authoritative for its
/// provider (see the module docs); `None` when the disk catalog still speaks
/// for it, or there is no session-scoped provider.
pub(crate) fn overlay_catalog() -> Option<(String, BTreeMap<String, ModelInfo>)> {
    let guard = read();
    let overlay = guard.as_ref()?.overlay.as_ref()?;
    match &overlay.listing {
        Some(listing) => Some((overlay.provider.clone(), listing.info.clone())),
        None if !overlay.inherit_disk => Some((overlay.provider.clone(), BTreeMap::new())),
        None => None,
    }
}

/// Lay the overlay over `catalog`, replacing the session-scoped provider's
/// entries -- with an empty map when that is what the overlay holds, so a
/// lookup under that provider finds nothing rather than searching the others.
pub(crate) fn apply_catalog(catalog: &mut Catalog) {
    if let Some((provider, models)) = overlay_catalog() {
        catalog.overlay_provider(&provider, models);
    }
}

/// Store what the session-scoped provider's endpoint listed. `info` empty keeps
/// metadata an earlier answer carried, the rule the disk catalog follows too: an
/// id-only answer says nothing about prices. Returns whether the roster moved.
pub(crate) fn record_listing(
    provider: &str,
    ids: Vec<String>,
    info: BTreeMap<String, ModelInfo>,
) -> bool {
    let mut guard = write();
    let Some(overlay) = guard
        .as_mut()
        .and_then(|state| state.overlay.as_mut())
        .filter(|overlay| overlay.provider == provider)
    else {
        return false;
    };
    let previous = overlay.listing.take().unwrap_or_default();
    let info = if info.is_empty() { previous.info } else { info };
    let changed = previous.ids != ids;
    overlay.listing = Some(Listing { ids, info });
    changed
}

/// Leave a line for the TUI to show once it is on screen.
pub(crate) fn set_startup_notice(notice: String) {
    *STARTUP_NOTICE.lock().unwrap_or_else(|e| e.into_inner()) = Some(notice);
}

/// The startup probe's report, handed out once.
pub(crate) fn take_startup_notice() -> Option<String> {
    STARTUP_NOTICE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
}

/// Forget everything recorded, for tests: the store is process-wide and the
/// test binary runs every test in one process.
#[cfg(test)]
pub(crate) fn reset() {
    *write() = None;
    STARTUP_NOTICE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();
}

/// Run `f` in a temp home with `overrides` installed as the session's, then
/// reset. Nested inside `with_temp_home` so it is serialized with every other
/// test that touches `~/.rey30-idvj` -- the provider rebuilds read both.
#[cfg(test)]
pub(crate) fn with_session<T>(
    overrides: ProviderOverrides,
    f: impl FnOnce(&std::path::Path) -> T,
) -> T {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            reset();
        }
    }
    crate::core::agent::global_config::with_temp_home(|home| {
        let _reset = Reset;
        reset();
        overrides.install();
        f(home)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::global_config::{load_global_config, set_provider, ProviderUpdate};
    use crate::core::cli::providers::load_provider_configs;

    fn gateway(base_url: Option<&str>) -> ProviderOverrides {
        ProviderOverrides {
            provider: Some("gateway".into()),
            api_key: Some("gw-session".into()),
            base_url: base_url.map(str::to_string),
            explicit_provider: true,
            ..Default::default()
        }
    }

    fn native_gateway() {
        set_provider(
            "gateway",
            ProviderUpdate {
                api_key: Some("gw-native".into()),
                base_url: Some("https://gateway.example/v1".into()),
                models: Some(vec!["native-only".into()]),
                ..Default::default()
            },
        )
        .unwrap();
        let mut catalog = Catalog::default();
        catalog.set_provider(
            "gateway",
            BTreeMap::from([(
                "native-only".to_string(),
                ModelInfo {
                    prompt_usd: Some(1.0),
                    completion_usd: Some(2.0),
                    ..Default::default()
                },
            )]),
        );
        catalog.save().unwrap();
    }

    /// With the base URL from the session, the file's roster and prices
    /// describe another endpoint: they are replaced, never merged, even before
    /// (or without) an answer from the session's endpoint.
    #[test]
    fn a_session_base_url_replaces_the_native_roster_and_prices() {
        with_session(gateway(Some("https://staging.gateway.example/v1")), |_| {
            native_gateway();
            let configs = load_provider_configs(None, &ProviderOverrides::session()).unwrap();
            assert!(
                configs["gateway"].models.is_empty(),
                "nothing from the native roster"
            );
            let effective = crate::core::cli::model_catalog::effective();
            assert!(effective.get(Some("gateway"), "native-only").is_none());

            assert!(record_listing(
                "gateway",
                vec!["band-only".into()],
                BTreeMap::from([(
                    "band-only".to_string(),
                    ModelInfo {
                        context_length: Some(1000),
                        ..Default::default()
                    },
                )]),
            ));
            let configs = load_provider_configs(None, &ProviderOverrides::session()).unwrap();
            assert_eq!(configs["gateway"].models, vec!["band-only".to_string()]);
            let effective = crate::core::cli::model_catalog::effective();
            assert!(effective.get(Some("gateway"), "band-only").is_some());
            assert!(effective.get(Some("gateway"), "native-only").is_none());
            // The disk is where it was.
            assert_eq!(
                load_global_config().unwrap()["gateway"].models,
                vec!["native-only".to_string()]
            );
            assert!(crate::core::cli::model_catalog::load()
                .get(Some("gateway"), "native-only")
                .is_some());
        });
    }

    /// With only the key from the session the endpoint is the configured one,
    /// so its roster and prices stand until the endpoint says otherwise.
    #[test]
    fn a_session_key_alone_keeps_the_files_roster_until_a_probe_answers() {
        with_session(gateway(None), |_| {
            native_gateway();
            let configs = load_provider_configs(None, &ProviderOverrides::session()).unwrap();
            assert_eq!(configs["gateway"].models, vec!["native-only".to_string()]);
            assert_eq!(
                configs["gateway"].bearer_key_chain(),
                vec!["gw-session".to_string()]
            );
            assert!(crate::core::cli::model_catalog::effective()
                .get(Some("gateway"), "native-only")
                .is_some());

            record_listing("gateway", vec!["listed".into()], BTreeMap::new());
            let configs = load_provider_configs(None, &ProviderOverrides::session()).unwrap();
            assert_eq!(configs["gateway"].models, vec!["listed".to_string()]);
        });
    }

    /// The overlay applies to a load made with the session's own overrides
    /// only: RPC builds with `default()` and must see the files alone.
    #[test]
    fn a_load_with_other_overrides_sees_only_the_files() {
        with_session(gateway(Some("https://staging.gateway.example/v1")), |_| {
            native_gateway();
            record_listing("gateway", vec!["band-only".into()], BTreeMap::new());
            let configs = load_provider_configs(None, &ProviderOverrides::default()).unwrap();
            assert_eq!(configs["gateway"].models, vec!["native-only".to_string()]);
            assert_eq!(
                configs["gateway"].base_url.as_deref(),
                Some("https://gateway.example/v1")
            );
        });
    }

    /// An id-only answer keeps the prices an earlier one carried, as the disk
    /// catalog does; a roster change is reported as one.
    #[test]
    fn an_id_only_answer_keeps_earlier_prices() {
        with_session(gateway(Some("https://staging.gateway.example/v1")), |_| {
            let priced = BTreeMap::from([(
                "m".to_string(),
                ModelInfo {
                    prompt_usd: Some(1.0),
                    completion_usd: Some(1.0),
                    ..Default::default()
                },
            )]);
            assert!(record_listing("gateway", vec!["m".into()], priced));
            assert!(!record_listing(
                "gateway",
                vec!["m".into()],
                BTreeMap::new()
            ));
            assert!(crate::core::cli::model_catalog::effective()
                .get(Some("gateway"), "m")
                .and_then(|i| i.rates())
                .is_some());
            assert!(
                !record_listing("openrouter", vec!["x".into()], BTreeMap::new()),
                "not ours"
            );
        });
    }

    #[test]
    fn only_an_explicit_session_provider_is_scoped() {
        with_session(
            ProviderOverrides {
                explicit_provider: false,
                ..gateway(None)
            },
            |_| {
                assert_eq!(scoped_provider(), None);
                assert!(!is_session_scoped("gateway"));
            },
        );
        with_session(gateway(None), |_| {
            assert!(is_session_scoped("gateway"));
        });
    }
}
