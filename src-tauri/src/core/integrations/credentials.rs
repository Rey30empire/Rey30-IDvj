//! Opaque references in MCP config; values enter only the selected transport.
use crate::core::server::provider_secrets;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

const REFS: &str = "rey30CredentialRefs";
const OAUTH_INDEX: &str = "mcp_oauth_refs.json";
static OAUTH_LOCK: Mutex<()> = Mutex::new(());

pub(crate) enum OAuthRecord {
    Absent,
    Cleared,
    Present(Box<crate::core::mcp::oauth::StoredCredentials>),
}

fn read_oauth_index(data: &Path) -> Result<BTreeMap<String, Option<String>>, String> {
    let path = data.join(OAUTH_INDEX);
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    super::imports::secure_dir(data)?;
    let metadata =
        std::fs::symlink_metadata(&path).map_err(|_| "No se pudo leer el índice OAuth seguro.")?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("El índice OAuth no puede ser un enlace.".into());
        }
    }
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 1024 * 1024 {
        return Err("El índice OAuth seguro no es válido.".into());
    }
    serde_json::from_slice(
        &std::fs::read(path).map_err(|_| "No se pudo leer el índice OAuth seguro.")?,
    )
    .map_err(|_| "El índice OAuth seguro no es válido; se conservó sin cambios.".into())
}

fn write_oauth_index(data: &Path, index: &BTreeMap<String, Option<String>>) -> Result<(), String> {
    use std::io::Write;
    super::imports::secure_dir(data)?;
    let temp = data.join(format!(".mcp-oauth-refs-{}.json", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp)
        .map_err(|_| "No se pudo preparar el índice OAuth seguro.")?;
    let bytes =
        serde_json::to_vec(index).map_err(|_| "No se pudo preparar el índice OAuth seguro.")?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "No se pudo guardar el índice OAuth seguro.")?;
    drop(file);
    std::fs::rename(&temp, data.join(OAUTH_INDEX))
        .map_err(|_| "No se pudo publicar el índice OAuth seguro.".into())
}

#[cfg(test)]
static TEST_OAUTH_RECORDS: std::sync::OnceLock<Mutex<BTreeMap<String, String>>> =
    std::sync::OnceLock::new();

#[cfg(all(test, feature = "cli"))]
fn real_qa_store() -> bool {
    if std::env::var("REY30_QA_REAL_SECRET_STORE").as_deref() != Ok("1") {
        return false;
    }
    let folder = std::env::var_os("REY30_DATA_FOLDER")
        .expect("An explicit isolated data folder is required for secure-store QA");
    assert!(std::path::PathBuf::from(folder).is_absolute());
    provider_secrets::force_file_secrets();
    true
}

#[cfg_attr(test, allow(clippy::needless_return))]
fn oauth_secret_store(key: &str, value: &str) -> Result<(), String> {
    #[cfg(all(test, feature = "cli"))]
    if real_qa_store() {
        return provider_secrets::store_secret_record(key, value);
    }
    #[cfg(test)]
    {
        TEST_OAUTH_RECORDS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "Almacén de pruebas ocupado")?
            .insert(key.into(), value.into());
        return Ok(());
    }
    #[cfg(not(test))]
    provider_secrets::store_secret_record(key, value)
}

#[cfg_attr(test, allow(clippy::needless_return))]
fn oauth_secret_load(key: &str) -> Option<String> {
    #[cfg(all(test, feature = "cli"))]
    if real_qa_store() {
        return provider_secrets::load_secret_record(key);
    }
    #[cfg(test)]
    {
        return TEST_OAUTH_RECORDS
            .get_or_init(Default::default)
            .lock()
            .ok()?
            .get(key)
            .cloned();
    }
    #[cfg(not(test))]
    provider_secrets::load_secret_record(key)
}

#[cfg_attr(test, allow(clippy::needless_return))]
fn oauth_secret_delete(key: &str) -> Result<(), String> {
    #[cfg(all(test, feature = "cli"))]
    if real_qa_store() {
        return provider_secrets::delete_secret_record(key);
    }
    #[cfg(test)]
    {
        TEST_OAUTH_RECORDS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "Almacén de pruebas ocupado")?
            .remove(key);
        return Ok(());
    }
    #[cfg(not(test))]
    provider_secrets::delete_secret_record(key)
}

fn profile(data: &Path) -> String {
    data.canonicalize()
        .unwrap_or_else(|_| data.to_owned())
        .to_string_lossy()
        .into_owned()
}

pub(crate) fn load_oauth(data: &Path, name: &str) -> Result<OAuthRecord, String> {
    let index = read_oauth_index(data)?;
    let Some(reference) = index.get(name) else {
        return Ok(OAuthRecord::Absent);
    };
    let Some(id) = reference else {
        return Ok(OAuthRecord::Cleared);
    };
    if uuid::Uuid::parse_str(id).is_err() {
        return Err("Referencia OAuth segura no válida.".into());
    }
    let record = oauth_secret_load(&format!("mcp-oauth:{id}"))
        .ok_or("No se encontró la credencial OAuth segura; vuelve a autorizar el servidor.")?;
    let record: Value =
        serde_json::from_str(&record).map_err(|_| "La credencial OAuth segura no es válida.")?;
    if record["profile"] != profile(data) || record["name"] != name {
        return Err("La credencial OAuth no pertenece a este perfil o servidor.".into());
    }
    let creds = serde_json::from_value(record["credentials"].clone())
        .map_err(|_| "La credencial OAuth segura no es válida.")?;
    Ok(OAuthRecord::Present(Box::new(creds)))
}

pub(crate) fn save_oauth(
    data: &Path,
    name: &str,
    creds: &crate::core::mcp::oauth::StoredCredentials,
) -> Result<(), String> {
    let _guard = OAUTH_LOCK
        .lock()
        .map_err(|_| "El almacén OAuth está ocupado.")?;
    super::imports::secure_dir(data)?;
    let mut index = read_oauth_index(data)?;
    let id = uuid::Uuid::new_v4().to_string();
    let record = json!({"profile":profile(data),"name":name,"credentials":creds});
    oauth_secret_store(&format!("mcp-oauth:{id}"), &record.to_string())
        .map_err(|_| "No se pudo guardar OAuth en el almacén seguro.")?;
    let previous = index.insert(name.into(), Some(id.clone()));
    if let Err(error) = write_oauth_index(data, &index) {
        let _ = oauth_secret_delete(&format!("mcp-oauth:{id}"));
        return Err(error);
    }
    if let Some(Some(previous)) = previous {
        let _ = oauth_secret_delete(&format!("mcp-oauth:{previous}"));
    }
    Ok(())
}

pub(crate) fn clear_oauth(data: &Path, name: &str) -> Result<Option<bool>, String> {
    let _guard = OAUTH_LOCK
        .lock()
        .map_err(|_| "El almacén OAuth está ocupado.")?;
    let mut index = read_oauth_index(data)?;
    let Some(previous) = index.get(name).cloned() else {
        return Ok(None);
    };
    let Some(previous) = previous else {
        return Ok(Some(false));
    };
    // A tombstone prevents an older plaintext record from becoming active again.
    index.insert(name.into(), None);
    write_oauth_index(data, &index)?;
    oauth_secret_delete(&format!("mcp-oauth:{previous}"))
        .map_err(|_| "La autorización se desactivó, pero no se pudo borrar su registro seguro.")?;
    Ok(Some(true))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialValue {
    pub field: String,
    pub key: String,
    pub value: String,
}

fn binding(data: &Path, name: &str, config: &Value, field: &str, key: &str) -> String {
    let data = data.canonicalize().unwrap_or_else(|_| data.to_owned());
    let target = json!([
        data.to_string_lossy(),
        name,
        config.get("command"),
        config.get("args"),
        config.get("url"),
        config.get("type"),
        field,
        key
    ]);
    hex::encode(Sha256::digest(target.to_string().as_bytes()))
}

fn valid_field(field: &str, key: &str) -> bool {
    matches!(field, "env" | "headers")
        && !key.is_empty()
        && key.len() <= 160
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn save_with(
    data: &Path,
    name: &str,
    config: &Value,
    values: Vec<CredentialValue>,
    mut store: impl FnMut(&str, &str) -> Result<(), String>,
) -> Result<Value, String> {
    if values.len() > 160 || !config.is_object() {
        return Err("Demasiados valores MCP o configuración no válida.".into());
    }
    for item in &values {
        if !valid_field(&item.field, &item.key)
            || item.value.len() > 16_384
            || item.value.contains(['\0', '\r', '\n'])
        {
            return Err(
                "Uno de los campos MCP no tiene un formato válido. No se guardaron valores.".into(),
            );
        }
    }
    let mut updated = config.clone();
    if updated.get(REFS).is_some_and(|refs| !refs.is_object()) {
        return Err("Las referencias de credenciales MCP no son válidas.".into());
    }
    if updated.get(REFS).is_none() {
        updated[REFS] = json!({});
    }
    for item in values.into_iter().filter(|item| !item.value.is_empty()) {
        let id = uuid::Uuid::new_v4().to_string();
        let account = format!("mcp:{id}");
        let record =
            json!({"binding":binding(data,name,config,&item.field,&item.key),"value":item.value});
        store(&account, &record.to_string())
            .map_err(|_| "No se pudo guardar la credencial MCP en el almacén seguro.")?;
        if updated[REFS].get(&item.field).is_none() {
            updated[REFS][&item.field] = json!({});
        }
        if !updated[REFS][&item.field].is_object() {
            return Err("Las referencias de credenciales MCP no son válidas.".into());
        }
        updated[REFS][&item.field][&item.key] = json!(id);
        if let Some(fields) = updated.get_mut(&item.field).and_then(Value::as_object_mut) {
            fields.remove(&item.key);
        }
    }
    updated["active"] = json!(false);
    Ok(updated)
}

pub(crate) fn save(
    data: &Path,
    name: &str,
    config: &Value,
    values: Vec<CredentialValue>,
) -> Result<Value, String> {
    save_with(
        data,
        name,
        config,
        values,
        provider_secrets::store_secret_record,
    )
}

fn resolve_with(
    data: &Path,
    name: &str,
    config: &Value,
    mut load: impl FnMut(&str) -> Option<String>,
) -> Result<Value, String> {
    let mut resolved = config.clone();
    let Some(refs) = config.get(REFS) else {
        return Ok(resolved);
    };
    let refs = refs
        .as_object()
        .ok_or("Las referencias de credenciales MCP no son válidas.")?;
    for (field, entries) in refs {
        let entries = entries
            .as_object()
            .ok_or("Las referencias de credenciales MCP no son válidas.")?;
        if entries.len() > 160 {
            return Err("Demasiadas referencias de credenciales MCP.".into());
        }
        for (key, reference) in entries {
            if !valid_field(field, key) {
                return Err("Campo de credencial MCP no válido.".into());
            }
            let id = reference
                .as_str()
                .filter(|id| uuid::Uuid::parse_str(id).is_ok())
                .ok_or("La referencia de credencial MCP no es válida.")?;
            let record = load(&format!("mcp:{id}")).ok_or(
                "Falta una credencial MCP guardada. Vuelve a completarla desde el catálogo.",
            )?;
            let record: Value = serde_json::from_str(&record)
                .map_err(|_| "La credencial MCP guardada no es válida.")?;
            if record["binding"] != binding(data, name, config, field, key) {
                return Err("La credencial MCP pertenece a otra configuración. Vuelve a completarla para este servidor.".into());
            }
            let value = record["value"]
                .as_str()
                .ok_or("La credencial MCP guardada no es válida.")?;
            if resolved.get(field).is_none() {
                resolved[field] = json!({});
            }
            if !resolved[field].is_object() {
                return Err("El mapa de valores MCP no es válido.".into());
            }
            resolved[field][key] = json!(value);
        }
    }
    Ok(resolved)
}

pub(crate) fn resolve(data: &Path, name: &str, config: &Value) -> Result<Value, String> {
    resolve_with(data, name, config, provider_secrets::load_secret_record)
}

pub(crate) fn sensitive_values(config: &Value) -> Vec<String> {
    let mut values: Vec<String> = Vec::new();
    for field in ["env", "headers"] {
        for key in config
            .pointer(&format!("/{REFS}/{field}"))
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|map| map.keys())
        {
            if let Some(value) = config[field][key]
                .as_str()
                .filter(|value| !value.is_empty())
            {
                values.push(value.into());
            }
        }
    }
    values.sort_by_key(|value| std::cmp::Reverse(value.len()));
    values
}

pub(crate) fn redact(message: &str, values: &[String]) -> String {
    values.iter().fold(message.to_owned(), |text, value| {
        text.replace(value, "[credencial oculta]")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    #[test]
    fn config_contains_only_refs_and_resolution_is_bound_to_server_target_and_profile() {
        let data = std::env::temp_dir().join("owned-credential-test");
        let config = json!({"command":"owned-fixture","args":["mcp"],"env":{"KEEP":"preserved"},"active":false});
        let mut store = HashMap::new();
        let saved = save_with(
            &data,
            "owned",
            &config,
            vec![CredentialValue {
                field: "env".into(),
                key: "TOKEN".into(),
                value: "owned-secret-nonce".into(),
            }],
            |key, value| {
                store.insert(key.to_string(), value.to_string());
                Ok(())
            },
        )
        .unwrap();
        assert!(!saved.to_string().contains("owned-secret-nonce"));
        assert_eq!(saved["env"]["KEEP"], "preserved");
        let resolved = resolve_with(&data, "owned", &saved, |key| store.get(key).cloned()).unwrap();
        assert_eq!(resolved["env"]["TOKEN"], "owned-secret-nonce");
        assert!(resolve_with(&data, "other", &saved, |key| store.get(key).cloned()).is_err());
        assert!(
            resolve_with(&data.join("other"), "owned", &saved, |key| store
                .get(key)
                .cloned())
            .is_err()
        );
        let mut changed = saved.clone();
        changed["command"] = json!("different");
        assert!(resolve_with(&data, "owned", &changed, |key| store.get(key).cloned()).is_err());
    }

    #[cfg(feature = "cli")]
    #[test]
    #[ignore = "Requires explicit isolated REY30_DATA_FOLDER; exercises the real encrypted fallback without touching OS keyring"]
    fn encrypted_store_round_trip_uses_only_opaque_config_refs() {
        let _guard = provider_secrets::SECRET_STORE_TEST_LOCK.lock().unwrap();
        let explicit =
            std::env::var_os("REY30_DATA_FOLDER").expect("isolated data folder required");
        let data = crate::core::app::commands::resolve_rey30_data_folder();
        assert_eq!(data, std::path::PathBuf::from(explicit));
        provider_secrets::force_file_secrets();
        let config =
            json!({"type":"http","url":"https://owned.invalid/mcp","headers":{},"active":false});
        let saved = save(
            &data,
            "owned-qa",
            &config,
            vec![CredentialValue {
                field: "headers".into(),
                key: "Authorization".into(),
                value: "owned-catalog-secret-nonce".into(),
            }],
        )
        .unwrap();
        assert!(!saved.to_string().contains("owned-catalog-secret-nonce"));
        assert!(!std::fs::read(data.join("provider_secrets.enc"))
            .unwrap()
            .windows(b"owned-catalog-secret-nonce".len())
            .any(|bytes| bytes == b"owned-catalog-secret-nonce"));
        assert_eq!(
            resolve(&data, "owned-qa", &saved).unwrap()["headers"]["Authorization"],
            "owned-catalog-secret-nonce"
        );
        assert!(crate::core::mcp::oauth::has_static_authorization(&saved));
        let id = saved[REFS]["headers"]["Authorization"].as_str().unwrap();
        provider_secrets::delete_secret_record(&format!("mcp:{id}")).unwrap();
    }
}
