//! Terminal sign-in UX: the plain-stdout counterpart to the TUI's `/login`
//! overlay. Both drive [`super::auth::providers::login_with_api_key`]; only
//! presentation differs.
//!
//! `rey30-idvj login` runs this directly. The TUI never forces this flow on a
//! fresh install -- it launches with an empty model and shows a one-line
//! notice, letting the user run `/login` (or `rey30-idvj login`) when they are
//! ready instead of being dropped into a masked key prompt immediately.

use std::io::IsTerminal;

use super::auth::{self, LoginError, LoginResult, ProviderDefinition};
use super::secret_input;

/// Max key prompts before giving up, so a wrong paste is retryable but a script
/// piping garbage at us can't loop forever.
const MAX_ATTEMPTS: usize = 3;

/// Reject a non-interactive run with nothing configured: there is no terminal
/// to show the sign-in notice in and nobody to act on it. No-op otherwise --
/// an interactive run with no provider proceeds and the TUI shows its own
/// notice instead of forcing a login flow here.
pub fn reject_headless_without_provider(
    project_root: Option<&std::path::Path>,
) -> Result<(), String> {
    if super::providers::has_usable_provider(project_root) {
        return Ok(());
    }
    if !std::io::stdin().is_terminal() {
        return Err(headless_message());
    }
    Ok(())
}

/// Sign in to a catalog provider with an API key from a plain terminal.
///
/// With `provider` unset an interactive run asks which provider to use; a piped
/// stdin (`echo $KEY | rey30-idvj login --provider openai`) must name one.
pub async fn run_login(provider: Option<String>) -> Result<(), String> {
    let interactive = std::io::stdin().is_terminal();
    let definition = match provider {
        Some(id) => resolve_provider(&id)?,
        None if interactive => match choose_provider().await? {
            Some(definition) => definition,
            None => return Err(cancelled_message()),
        },
        None => return Err(piped_without_provider_message()),
    };
    if interactive {
        login_by_paste(&definition).await
    } else {
        login_from_stdin(&definition).await
    }
}

fn resolve_provider(id: &str) -> Result<ProviderDefinition, String> {
    auth::provider_by_id(id.trim()).ok_or_else(|| {
        format!(
            "unknown provider '{id}'. Known providers: {}",
            provider_ids().join(", ")
        )
    })
}

fn provider_ids() -> Vec<&'static str> {
    auth::provider_catalog().iter().map(|p| p.id).collect()
}

/// Ask which catalog provider to sign in to. `None` when the user abandons it.
async fn choose_provider() -> Result<Option<ProviderDefinition>, String> {
    let catalog = auth::provider_catalog();
    println!();
    println!("Sign in to a provider with an API key:");
    for (index, provider) in catalog.iter().enumerate() {
        println!("  {}. {} ({})", index + 1, provider.name, provider.id);
    }
    println!();
    let answer = tokio::task::spawn_blocking(|| {
        use std::io::Write as _;
        print!("Provider number or id: ");
        let _ = std::io::stdout().flush();
        let mut line = String::new();
        std::io::stdin()
            .read_line(&mut line)
            .map(|read| (read > 0).then_some(line))
    })
    .await
    .map_err(|e| format!("provider prompt failed: {e}"))?
    .map_err(|e| format!("could not read the provider: {e}"))?;
    let Some(answer) = answer.map(|a| a.trim().to_string()).filter(|a| !a.is_empty()) else {
        return Ok(None);
    };
    if let Ok(number) = answer.parse::<usize>() {
        return catalog
            .into_iter()
            .nth(number.wrapping_sub(1))
            .map(Some)
            .ok_or_else(|| format!("no provider numbered {number}"));
    }
    resolve_provider(&answer).map(Some)
}

/// The paste-a-key login, interactive.
async fn login_by_paste(definition: &ProviderDefinition) -> Result<(), String> {
    println!();
    println!("Sign in to {} with an API key:", definition.name);
    println!("  {}", definition.api_key.keys_url);
    println!("  ({})", definition.api_key.hint);
    println!();
    println!("The key is masked as you type or paste. Enter verifies, Esc cancels.");

    let prompt = format!("Paste your {} API key: ", definition.name);
    let mut last_error = None;
    for attempt in 1..=MAX_ATTEMPTS {
        let entered = match prompt_for_key(prompt.clone()).await? {
            Some(key) => key,
            // Ctrl-C / Ctrl-D at the prompt: the user chose not to sign in.
            None => return Err(cancelled_message()),
        };
        // Validate before announcing a request, so an empty line or a
        // mis-paste doesn't read as a rejection by the provider.
        let result = match auth::providers::sanitize_key(&entered) {
            Ok(key) => {
                println!("Verifying...");
                auth::providers::login_with_api_key(definition, &key)
                    .await
                    .map_err(|e| error_message(definition, e))
            }
            Err(e) => Err(e),
        };
        match result {
            Ok(login) => {
                report(definition, &login);
                return Ok(());
            }
            Err(e) => {
                if attempt < MAX_ATTEMPTS {
                    eprintln!("{e}");
                    println!();
                }
                last_error = Some(e);
            }
        }
    }
    Err(last_error.unwrap_or_else(|| "sign-in failed".to_string()))
}

/// Verify a key piped in on stdin. Reports to stdout exactly like the
/// interactive path so a script's log shows what changed.
async fn login_from_stdin(definition: &ProviderDefinition) -> Result<(), String> {
    let mut piped = String::new();
    std::io::Read::read_to_string(&mut std::io::stdin(), &mut piped)
        .map_err(|e| format!("could not read the API key from stdin: {e}"))?;
    if piped.trim().is_empty() {
        return Err(piped_empty_message(definition.id));
    }
    let login = auth::providers::login_with_api_key(definition, &piped)
        .await
        .map_err(|e| error_message(definition, e))?;
    report(definition, &login);
    Ok(())
}

/// Read the key, echoing a mask so the user can see a paste land. `None` means
/// the user abandoned the prompt. Runs on a blocking thread: the prompt owns the
/// terminal while it waits, which must not stall the async runtime.
async fn prompt_for_key(prompt: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || secret_input::read_masked_line(&prompt))
        .await
        .map_err(|e| format!("key prompt failed: {e}"))?
}

/// Safe, credential-free text for a failed sign-in.
fn error_message(definition: &ProviderDefinition, error: LoginError) -> String {
    let message = match error {
        LoginError::InvalidKey(message) | LoginError::Unavailable(message) => message,
        LoginError::Persist(_) => "could not save sign-in securely".to_string(),
        LoginError::OAuth(_) => "could not complete browser sign-in".to_string(),
        LoginError::Unauthorized => "that API key was not accepted".to_string(),
        LoginError::RateLimited => "that API key is rate limited - wait and try again".to_string(),
    };
    format!("{} sign-in failed: {message}", definition.name)
}

/// Why we stopped when there is nobody at the keyboard to paste a key.
fn headless_message() -> String {
    "no AI provider is configured. Run `rey30-idvj login` to sign in with an API key, or set one \
     manually:\n  rey30-idvj config set --provider <id> --api-key <key> --base-url <url>\nA key can \
     also be passed per run with --api-key or $REY30_API_KEY."
        .to_string()
}

/// `rey30-idvj login` piped without `--provider`: there is nobody to ask.
fn piped_without_provider_message() -> String {
    format!(
        "no provider named. Pipe the key with one, e.g.:\n  echo $OPENAI_API_KEY | rey30-idvj login \
         --provider openai\nKnown providers: {}\nor set it directly with `rey30-idvj config set`.",
        provider_ids().join(", ")
    )
}

/// `rey30-idvj login` with nothing on a piped stdin: say how to feed it one, rather
/// than repeating "run `rey30-idvj login`" at someone who just did.
fn piped_empty_message(provider: &str) -> String {
    format!(
        "no API key on stdin. Either run `rey30-idvj login` from a terminal, pipe the key in:\n  echo \
         $API_KEY | rey30-idvj login --provider {provider}\nor set it directly:\n  rey30-idvj config \
         set --provider {provider} --api-key <key>"
    )
}

fn cancelled_message() -> String {
    "sign-in cancelled. Run `rey30-idvj login` when you have a key, or configure a provider manually \
     with `rey30-idvj config set`.\nAlready running a model locally? Point Rey30 IDvj at the desktop app's API \
     server:\n  rey30-idvj config set --provider rey30-idvj --base-url http://localhost:1337/v1 --model <model>"
        .to_string()
}

fn report(definition: &ProviderDefinition, login: &LoginResult) {
    println!();
    match login.models.len() {
        0 => println!(
            "Signed in to {}, but the account exposes no models yet. Pick one with /model \
             once it does.",
            definition.name
        ),
        1 => println!("Signed in to {} - 1 model available.", definition.name),
        n => println!("Signed in to {} - {n} models available.", definition.name),
    }
    println!("  configuration saved to {}", login.config_path.display());
    if let Some(model) = &login.default_model {
        println!("  default model: {model}");
    }
    println!();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_dead_end_points_at_a_way_forward() {
        for message in [
            cancelled_message(),
            headless_message(),
            piped_empty_message("openai"),
        ] {
            assert!(message.contains("rey30-idvj login"), "{message}");
            assert!(message.contains("rey30-idvj config set"), "{message}");
        }
        // The piped variant must not tell the user to re-run what just failed as
        // if nothing else were possible.
        assert!(piped_empty_message("openai").contains("| rey30-idvj login --provider openai"));
        assert!(piped_without_provider_message().contains("--provider"));
    }

    #[test]
    fn unknown_provider_lists_the_catalog() {
        let error = resolve_provider("nope").unwrap_err();
        for id in provider_ids() {
            assert!(error.contains(id), "{error}");
        }
        assert_eq!(resolve_provider(" openai ").unwrap().id, "openai");
    }

    #[test]
    fn report_survives_every_model_count() {
        let definition = auth::provider_by_id("openai").unwrap();
        for models in [
            Vec::new(),
            vec!["m".to_string()],
            vec!["a".into(), "b".into()],
        ] {
            report(
                &definition,
                &LoginResult {
                    provider: "openai".to_string(),
                    models,
                    config_path: std::path::PathBuf::from("/tmp/config.toml"),
                    default_model: Some("a".to_string()),
                },
            );
        }
    }

    #[test]
    fn error_messages_never_carry_persistence_details() {
        let definition = auth::provider_by_id("openai").unwrap();
        let message = error_message(
            &definition,
            LoginError::Persist("/home/alice/.rey30-idvj/config.toml sk-secret".to_string()),
        );
        assert!(!message.contains("sk-secret"), "{message}");
        assert!(!message.contains("alice"), "{message}");
    }
}
