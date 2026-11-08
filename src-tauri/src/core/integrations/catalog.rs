//! Read-only discovery in the official registry. Installation uses the existing
//! expiring import plans and never trusts a frontend-supplied package command.
use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};

use super::{imports, recipes};

const REGISTRY: &str = "https://registry.modelcontextprotocol.io";
const RESPONSE_LIMIT: usize = 4 * 1024 * 1024;
const PAGE_SIZE: usize = 50;
const OPENCLAW_TEMPLATE: &str = "io.rey30/openclaw-cli";
const OPENCLAW_TEMPLATE_VERSION: &str = "1";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogServer {
    pub name: String,
    pub title: String,
    pub description: String,
    pub version: String,
    pub transports: Vec<String>,
    pub packages: Vec<String>,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPage {
    pub servers: Vec<CatalogServer>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRequirement {
    pub field: String,
    pub key: String,
    pub description: String,
    pub secret: bool,
    pub required: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAlternative {
    pub candidate_id: String,
    pub requirements: Vec<CatalogRequirement>,
    pub remote: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogReview {
    pub server: CatalogServer,
    pub plan: imports::ImportPlan,
    pub alternatives: Vec<CatalogAlternative>,
    pub parameters: Vec<CatalogParameter>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogParameter {
    pub id: String,
    pub label: String,
    pub description: String,
    pub required: bool,
    pub default_value: String,
    pub choices: Vec<String>,
}

fn resolve_parameter(
    id: String,
    label: String,
    variable: &Value,
    values: &BTreeMap<String, String>,
    parameters: &mut Vec<CatalogParameter>,
    url_component: bool,
) -> Result<String, String> {
    if parameters.len() >= 200 || id.len() > 512 {
        return Err(
            "La alternativa declara demasiados parámetros o nombres demasiado largos.".into(),
        );
    }
    if variable["isSecret"] == true {
        return Err("Un argumento o URL declara una credencial secreta: requiere configuración manual sin persistirla en comandos o URLs.".into());
    }
    let default = variable["default"].as_str().unwrap_or_default();
    let choices: Vec<String> = variable["choices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .take(100)
        .map(str::to_owned)
        .collect();
    let value = values.get(&id).map(String::as_str).unwrap_or(default);
    let valid = value.len() <= 1024
        && !value.chars().any(char::is_control)
        && (choices.is_empty() || value.is_empty() || choices.iter().any(|choice| choice == value))
        && (!url_component
            || value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~')
            }));
    parameters.push(CatalogParameter {
        id,
        label,
        description: text(variable, "description", 1000),
        required: variable["isRequired"] == true || url_component,
        default_value: default.into(),
        choices,
    });
    if !valid {
        return Err(
            "Un parámetro de revisión no cumple el formato o las opciones declaradas.".into(),
        );
    }
    if value.is_empty() {
        return Err(
            "Completa los parámetros no secretos de esta alternativa y actualiza la revisión."
                .into(),
        );
    }
    Ok(value.into())
}

fn parameterize_entry(
    entry: &Value,
    key: &str,
    index: usize,
    values: &BTreeMap<String, String>,
    parameters: &mut Vec<CatalogParameter>,
) -> Result<Value, String> {
    let mut entry = entry.clone();
    let mut errors = Vec::new();
    if key == "remotes" {
        let mut url = entry["url"].as_str().unwrap_or_default().to_owned();
        if let Some(variables) = entry["variables"].as_object() {
            for (name, variable) in variables.iter().take(100) {
                let marker = format!("{{{name}}}");
                if !url.contains(&marker) {
                    continue;
                }
                match resolve_parameter(
                    format!("remotes/{index}/url/{name}"),
                    format!("Conexión {} · {name}", index + 1),
                    variable,
                    values,
                    parameters,
                    true,
                ) {
                    Ok(value) => url = url.replace(&marker, &value),
                    Err(error) => errors.push(error),
                }
            }
        }
        if errors.is_empty() && !url.contains(['{', '}']) {
            entry["url"] = json!(url);
            entry.as_object_mut().unwrap().remove("variables");
        }
    } else if let Some(arguments) = entry
        .get_mut("packageArguments")
        .and_then(Value::as_array_mut)
    {
        for (arg_index, argument) in arguments.iter_mut().enumerate().take(100) {
            if argument["isSecret"] == true {
                return Err("Los argumentos secretos requieren configuración manual; no se guardan en comandos.".into());
            }
            let id = format!("packages/{index}/argument/{arg_index}");
            let label = argument["name"]
                .as_str()
                .or_else(|| argument["valueHint"].as_str())
                .unwrap_or("argumento")
                .to_owned();
            let mut literal = argument
                .get("value")
                .or_else(|| argument.get("default"))
                .and_then(Value::as_str)
                .map(str::to_owned);
            if let Some(variables) = argument["variables"].as_object() {
                let mut next = literal.unwrap_or_default();
                for (name, variable) in variables.iter().take(100) {
                    match resolve_parameter(
                        format!("{id}/{name}"),
                        format!("Paquete {} · {label} · {name}", index + 1),
                        variable,
                        values,
                        parameters,
                        false,
                    ) {
                        Ok(value) => next = next.replace(&format!("{{{name}}}"), &value),
                        Err(error) => errors.push(error),
                    }
                }
                literal = Some(next);
                argument
                    .as_object_mut()
                    .ok_or("Argumento MCP no válido.")?
                    .remove("variables");
            } else if literal.is_none() && argument["isRequired"] == true {
                match resolve_parameter(
                    id,
                    format!("Paquete {} · {label}", index + 1),
                    argument,
                    values,
                    parameters,
                    false,
                ) {
                    Ok(value) => literal = Some(value),
                    Err(error) => errors.push(error),
                }
            }
            if let Some(value) = literal {
                argument["value"] = json!(value);
            }
        }
    }
    if errors.is_empty() {
        Ok(entry)
    } else {
        Err(errors.join(" "))
    }
}

fn text(value: &Value, key: &str, limit: usize) -> String {
    value[key]
        .as_str()
        .unwrap_or_default()
        .chars()
        .take(limit)
        .collect()
}

fn parameter(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

fn list_url(base: &str, search: Option<&str>, cursor: Option<&str>) -> Result<url::Url, String> {
    let mut url = url::Url::parse(base)
        .map_err(|_| "El registro MCP no es válido.")?
        .join("/v0.1/servers")
        .map_err(|_| "No se pudo construir la consulta MCP.")?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("version", "latest")
            .append_pair("limit", &PAGE_SIZE.to_string());
        if let Some(search) = search.map(str::trim).filter(|value| !value.is_empty()) {
            if !parameter(search, 256) || search.chars().count() < 3 {
                return Err(
                    "Escribe al menos tres caracteres para buscar en el registro MCP.".into(),
                );
            }
            query.append_pair("search", search);
        }
        if let Some(cursor) = cursor.filter(|value| !value.is_empty()) {
            if !parameter(cursor, 4096) {
                return Err("El cursor del catálogo MCP no es válido.".into());
            }
            query.append_pair("cursor", cursor);
        }
    }
    Ok(url)
}

fn detail_url(base: &str, name: &str, version: &str) -> Result<url::Url, String> {
    if !parameter(name, 256)
        || !name.contains('/')
        || !parameter(version, 160)
        || version == "latest"
    {
        return Err("Selecciona un nombre y una versión concreta del registro MCP.".into());
    }
    let mut url = url::Url::parse(base).map_err(|_| "El registro MCP no es válido.")?;
    url.path_segments_mut()
        .map_err(|_| "No se pudo construir la revisión MCP.")?
        .extend(["v0.1", "servers", name, "versions", version]);
    Ok(url)
}

async fn fetch(url: url::Url) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(25))
        .user_agent("Rey30-IDvj MCP catalog")
        .build()
        .map_err(|_| "No se pudo preparar la conexión al registro MCP.")?;
    let response = client.get(url).header(reqwest::header::ACCEPT, "application/json").send().await
        .map_err(|_| "No se pudo consultar el registro oficial MCP. Revisa la conexión y vuelve a intentarlo.")?;
    if !response.status().is_success() {
        return Err(format!(
            "El registro oficial MCP respondió HTTP {}. Vuelve a intentarlo más tarde.",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > RESPONSE_LIMIT as u64)
    {
        return Err("La respuesta del registro MCP supera el límite de 4 MiB.".into());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "La respuesta del registro MCP quedó incompleta.")?;
        if bytes.len().saturating_add(chunk.len()) > RESPONSE_LIMIT {
            return Err("La respuesta del registro MCP supera el límite de 4 MiB.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "El registro MCP no devolvió JSON válido.".into())
}

fn server(value: &Value) -> Result<CatalogServer, String> {
    let name = text(value, "name", 256);
    let version = text(value, "version", 160);
    detail_url(REGISTRY, &name, &version)?;
    let mut transports = Vec::new();
    let mut packages = Vec::new();
    for remote in value["remotes"].as_array().into_iter().flatten().take(300) {
        let transport = text(remote, "type", 40);
        if !transport.is_empty() && !transports.contains(&transport) {
            transports.push(transport);
        }
    }
    for package in value["packages"].as_array().into_iter().flatten().take(300) {
        let registry = text(package, "registryType", 40);
        if !registry.is_empty() && !packages.contains(&registry) {
            packages.push(registry);
        }
    }
    let title = text(value, "title", 200);
    Ok(CatalogServer {
        title: if title.is_empty() {
            name.clone()
        } else {
            title
        },
        name,
        description: text(value, "description", 2000),
        version,
        transports,
        packages,
        status: "active".into(),
    })
}

fn registry_status(envelope: &Value) -> &str {
    envelope
        .pointer("/_meta/io.modelcontextprotocol.registry~1official/status")
        .and_then(Value::as_str)
        .unwrap_or("active")
}

fn page(value: &Value) -> Result<CatalogPage, String> {
    let entries = value["servers"]
        .as_array()
        .ok_or("El registro MCP no devolvió una lista de servidores.")?;
    if entries.len() > PAGE_SIZE {
        return Err("El registro MCP devolvió más resultados de los solicitados.".into());
    }
    let mut seen = HashSet::new();
    let mut servers = Vec::new();
    for entry in entries {
        if registry_status(entry) != "active" {
            continue;
        }
        let summary = server(&entry["server"])?;
        if seen.insert(summary.name.clone()) {
            servers.push(summary);
        }
    }
    let next_cursor = match value.pointer("/metadata/nextCursor") {
        None | Some(Value::Null) => None,
        Some(Value::String(cursor)) if cursor.is_empty() => None,
        Some(Value::String(cursor)) if parameter(cursor, 4096) => Some(cursor.clone()),
        _ => return Err("El registro MCP devolvió un cursor no válido.".into()),
    };
    Ok(CatalogPage {
        servers,
        next_cursor,
    })
}

pub async fn list(search: Option<&str>, cursor: Option<&str>) -> Result<CatalogPage, String> {
    page(&fetch(list_url(REGISTRY, search, cursor)?).await?)
}

fn requirements(entry: &Value, remote: bool) -> Vec<CatalogRequirement> {
    let (key, field) = if remote {
        ("headers", "headers")
    } else {
        ("environmentVariables", "env")
    };
    entry[key]
        .as_array()
        .into_iter()
        .flatten()
        .take(160)
        .filter_map(|variable| {
            if variable
                .get("value")
                .or_else(|| variable.get("default"))
                .and_then(Value::as_str)
                .is_some()
            {
                return None;
            }
            let name = variable["name"].as_str()?;
            if !parameter(name, 160) {
                return None;
            }
            Some(CatalogRequirement {
                field: field.into(),
                key: name.into(),
                description: text(variable, "description", 1000),
                secret: variable["isSecret"] == true,
                required: variable["isRequired"] == true,
            })
        })
        .collect()
}

fn review_metadata(
    data: PathBuf,
    envelope: &Value,
    name: &str,
    version: &str,
    values: &BTreeMap<String, String>,
) -> Result<CatalogReview, String> {
    if values.len() > 200 {
        return Err("Demasiados parámetros para la revisión MCP.".into());
    }
    if registry_status(envelope) != "active" {
        return Err("Esta versión del servidor ya no está activa en el registro MCP.".into());
    }
    let value = &envelope["server"];
    let summary = server(value)?;
    if summary.name != name || summary.version != version {
        return Err(
            "El registro devolvió una versión distinta. Vuelve a buscar antes de instalar.".into(),
        );
    }
    let mut found = Vec::new();
    let mut fields = Vec::new();
    let mut parameters = Vec::new();
    let mut warnings = vec!["El registro publica metadatos del proveedor; aparecer aquí no demuestra que el código sea seguro. Revisa el paquete, los permisos y las condiciones del servicio.".into()];
    for (key, remote) in [("remotes", true), ("packages", false)] {
        let Some(entries) = value[key].as_array() else {
            continue;
        };
        if entries.len() > 300 {
            return Err("El servidor declara demasiadas alternativas MCP.".into());
        }
        for (index, entry) in entries.iter().enumerate() {
            let entry = match parameterize_entry(entry, key, index, values, &mut parameters) {
                Ok(entry) => entry,
                Err(error) => {
                    warnings.push(format!("{key} {}: {error}", index + 1));
                    continue;
                }
            };
            let mut one = value
                .as_object()
                .ok_or("Los metadatos MCP no son un objeto.")?
                .clone();
            one.remove("remotes");
            one.remove("packages");
            one.insert(key.into(), json!([entry]));
            let report = recipes::registry_report(&Value::Object(one))?;
            warnings.extend(report.warnings.into_iter().take(200));
            for mut recipe in report.recipes {
                recipe.name = format!("{} ({key} {})", summary.title, index + 1);
                fields.push((requirements(&entry, remote), remote));
                found.push(recipe);
            }
        }
    }
    let source = format!("Registro oficial MCP {name}@{version}");
    let plan = imports::plan_recipes(data, &source, found, warnings)?;
    let alternatives = plan
        .candidates
        .iter()
        .zip(fields)
        .map(|(candidate, (requirements, remote))| CatalogAlternative {
            candidate_id: candidate.id.clone(),
            requirements,
            remote,
        })
        .collect();
    Ok(CatalogReview {
        server: summary,
        plan,
        alternatives,
        parameters,
    })
}

pub async fn review(
    data: PathBuf,
    name: &str,
    version: &str,
    parameters: BTreeMap<String, String>,
) -> Result<CatalogReview, String> {
    if name == OPENCLAW_TEMPLATE {
        if version != OPENCLAW_TEMPLATE_VERSION || parameters.keys().any(|key| key != "launcher") {
            return Err("La configuración local de OpenClaw no admite esos parámetros.".into());
        }
        return review_openclaw(data, parameters.get("launcher").map(String::as_str));
    }
    let value = fetch(detail_url(REGISTRY, name, version)?).await?;
    review_metadata(data, &value, name, version, &parameters)
}

fn review_openclaw(data: PathBuf, launcher: Option<&str>) -> Result<CatalogReview, String> {
    let title = "OpenClaw";
    let description = "Consulta conversaciones de canales vinculados a tu Gateway de OpenClaw y responde por esos canales.";
    let default_launcher = if cfg!(windows) {
        "openclaw.cmd"
    } else {
        "openclaw"
    };
    let launcher = launcher
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_launcher);
    let launcher_path = std::path::Path::new(launcher);
    #[cfg(windows)]
    let local_path = matches!(
        launcher_path.components().next(),
        Some(std::path::Component::Prefix(prefix))
            if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_))
    ) && !launcher.contains(['"', '<', '>', '|', '?', '*']);
    #[cfg(not(windows))]
    let local_path = true;
    let supported_name = launcher_path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            if cfg!(windows) {
                ["openclaw.cmd", "openclaw.exe"]
                    .iter()
                    .any(|supported| name.eq_ignore_ascii_case(supported))
            } else {
                name == default_launcher
            }
        });
    if launcher != default_launcher
        && (!parameter(launcher, 1024)
            || !launcher_path.is_absolute()
            || !local_path
            || !supported_name)
    {
        return Err("Usa la ruta absoluta del lanzador oficial de OpenClaw o deja el comando predeterminado.".into());
    }
    let args = ["mcp", "serve", "--claude-channel-mode", "off"];
    let plan = imports::plan_recipes(
        data,
        "OpenClaw CLI · https://docs.openclaw.ai/cli/mcp/serve",
        vec![recipes::McpRecipe {
            name: title.into(),
            description: description.into(),
            config: json!({
                "type": "stdio",
                "command": launcher,
                "args": args,
                "env": {},
                "active": false,
                "description": description,
            }),
            warnings: vec![
                format!("Comando de conexión: {launcher} {}", args.join(" ")),
                "Requiere la CLI oficial y un Gateway configurado. Si la CLI no está en el PATH de Rey30, indica arriba la ruta de su lanzador y actualiza la revisión.".into(),
                "Al conectar, la CLI usa la configuración de su Gateway. Comprueba el destino y los permisos del canal antes de autorizar el acceso al historial o el envío de mensajes.".into(),
            ],
            preparation: None,
        }],
        Vec::new(),
    )?;
    let alternatives = plan
        .candidates
        .iter()
        .map(|candidate| CatalogAlternative {
            candidate_id: candidate.id.clone(),
            requirements: Vec::new(),
            remote: false,
        })
        .collect();
    Ok(CatalogReview {
        server: CatalogServer {
            name: OPENCLAW_TEMPLATE.into(),
            title: title.into(),
            description: description.into(),
            version: OPENCLAW_TEMPLATE_VERSION.into(),
            transports: vec!["stdio".into()],
            packages: Vec::new(),
            status: "local".into(),
        },
        plan,
        alternatives,
        parameters: vec![CatalogParameter {
            id: "launcher".into(),
            label: "Lanzador de OpenClaw".into(),
            description: "Escribe la ruta absoluta del lanzador oficial si no está en el PATH. Los datos de acceso se configuran en OpenClaw.".into(),
            required: false,
            default_value: default_launcher.into(),
            choices: Vec::new(),
        }],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_and_detail_paths_cannot_change_the_registry_origin() {
        let url = list_url(REGISTRY, Some("filesystem"), Some("opaque&search=other")).unwrap();
        let query: Vec<_> = url.query_pairs().collect();
        assert!(query.contains(&("version".into(), "latest".into())));
        assert!(query.contains(&("cursor".into(), "opaque&search=other".into())));
        assert!(list_url(REGISTRY, Some("ab"), None).is_err());
        assert!(list_url(REGISTRY, Some("   "), None).is_ok());
        let url = detail_url(REGISTRY, "io.fixture/test?host=evil", "1.0.0").unwrap();
        assert_eq!(url.host_str(), Some("registry.modelcontextprotocol.io"));
        assert!(url.query().is_none());
        assert!(url.path().contains("%2F"));
        assert!(detail_url(REGISTRY, "io.fixture/test", "latest").is_err());
    }

    #[test]
    fn page_uses_real_metadata_and_opaque_cursor_without_deleted_entries() {
        let entry = json!({"server":{"name":"io.fixture/one","version":"1.2.3","title":"Owned fixture","packages":[{"registryType":"npm"}]}});
        let deleted = json!({"server":{"name":"io.fixture/old","version":"1.0.0"},"_meta":{"io.modelcontextprotocol.registry/official":{"status":"deleted"}}});
        let result =
            page(&json!({"servers":[entry,deleted],"metadata":{"nextCursor":"opaque:one"}}))
                .unwrap();
        assert_eq!(result.servers.len(), 1);
        assert_eq!(result.servers[0].packages, ["npm"]);
        assert_eq!(result.next_cursor.as_deref(), Some("opaque:one"));
    }

    #[tokio::test]
    async fn openclaw_review_saves_the_official_stdio_bridge_inactive_and_preserves_existing_config(
    ) {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().to_owned();
        let config_path = data.join("mcp_config.json");
        let original = br#"{"mcpServers":{"existing":{"command":"untouched"}},"customFlag":true}"#;
        std::fs::write(&config_path, original).unwrap();

        let preset = review(
            data.clone(),
            OPENCLAW_TEMPLATE,
            OPENCLAW_TEMPLATE_VERSION,
            BTreeMap::new(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&config_path).unwrap(), original);
        let candidate = &preset.plan.candidates[0];
        assert_eq!(candidate.name, "openclaw");
        assert!(!candidate.conflict);
        assert!(preset.alternatives[0].requirements.is_empty());
        assert!(review_openclaw(data.clone(), Some("relative/openclaw.cmd")).is_err());
        let receipt = imports::commit(&preset.plan.id, std::slice::from_ref(&candidate.id), &data)
            .await
            .unwrap();
        assert_eq!(receipt.installed.len(), 1);
        let config: Value = serde_json::from_slice(&std::fs::read(&config_path).unwrap()).unwrap();
        assert_eq!(config["customFlag"], true);
        assert_eq!(config["mcpServers"]["existing"]["command"], "untouched");
        let claw = &config["mcpServers"]["openclaw"];
        assert_eq!(claw["active"], false);
        assert_eq!(claw["type"], "stdio");
        assert_eq!(
            claw["command"],
            if cfg!(windows) {
                "openclaw.cmd"
            } else {
                "openclaw"
            }
        );
        assert_eq!(
            claw["args"],
            json!(["mcp", "serve", "--claude-channel-mode", "off"])
        );
        assert_eq!(claw["env"], json!({}));
        assert!(!data.join("integration-installs").exists());
        assert!(review_openclaw(data, None).unwrap().plan.candidates[0].conflict);
    }

    #[tokio::test]
    async fn network_response_limits_and_redirects_are_enforced() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        async fn response(bytes: String) -> url::Url {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0; 4096];
                let _ = stream.read(&mut request).await;
                let _ = stream.write_all(bytes.as_bytes()).await;
            });
            url::Url::parse(&format!("http://{address}/owned-fixture")).unwrap()
        }
        let redirect=response("HTTP/1.1 302 Found\r\nLocation: https://fixture.invalid/never-follow\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()).await;
        assert!(fetch(redirect).await.unwrap_err().contains("302"));
        let large = response(format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            RESPONSE_LIMIT + 1
        ))
        .await;
        assert!(fetch(large).await.unwrap_err().contains("4 MiB"));
        let invalid =
            response("HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nbad".into())
                .await;
        assert!(fetch(invalid).await.unwrap_err().contains("JSON"));
    }

    #[tokio::test]
    async fn review_is_inert_and_commit_preserves_config_and_requests_credentials() {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().join("data");
        std::fs::create_dir(&data).unwrap();
        std::fs::write(data.join("mcp_config.json"), br#"{"mcpServers":{"existing":{"command":"owned-never-run","active":false}},"customFlag":{"preserve":true},"mcpSettings":{"future":{"preserve":true}}}"#).unwrap();
        let envelope = json!({"server":{"name":"io.fixture/catalog","version":"1.0.0","remotes":[{"type":"streamable-http","url":"https://fixture.invalid/mcp","headers":[{"name":"Authorization","isSecret":true,"isRequired":true,"description":"Your service token"}]}],"packages":[{"registryType":"unsupported"}]}});
        let review = review_metadata(
            data.clone(),
            &envelope,
            "io.fixture/catalog",
            "1.0.0",
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(review.plan.candidates.len(), 1);
        assert_eq!(review.alternatives[0].requirements[0].key, "Authorization");
        assert!(review.alternatives[0].requirements[0].secret);
        assert!(!data.join("integration-installs").exists());
        let receipt = imports::commit(
            &review.plan.id,
            &[review.plan.candidates[0].id.clone()],
            &data,
        )
        .await
        .unwrap();
        assert_eq!(receipt.installed.len(), 1);
        let config: Value =
            serde_json::from_slice(&std::fs::read(data.join("mcp_config.json")).unwrap()).unwrap();
        assert_eq!(config["customFlag"]["preserve"], true);
        assert_eq!(config["mcpSettings"]["future"]["preserve"], true);
        assert_eq!(
            config["mcpServers"][&receipt.installed[0].name]["active"],
            false
        );
        assert!(review_metadata(
            data,
            &envelope,
            "io.fixture/catalog",
            "2.0.0",
            &BTreeMap::new()
        )
        .is_err());
    }

    #[test]
    fn public_url_and_argument_parameters_are_reviewed_but_secrets_are_never_interpolated() {
        let temp = tempfile::tempdir().unwrap();
        let envelope = json!({"server":{"name":"io.fixture/parameters","version":"1.0.0","remotes":[{"type":"streamable-http","url":"https://fixture.invalid/{tenant}","variables":{"tenant":{"isRequired":true,"choices":["owned","other"]}}}],"packages":[{"registryType":"npm","identifier":"@owned/fixture","version":"1.0.0","transport":{"type":"stdio"},"packageArguments":[{"type":"named","name":"--folder","isRequired":true}]}]}});
        let before = review_metadata(
            temp.path().to_owned(),
            &envelope,
            "io.fixture/parameters",
            "1.0.0",
            &BTreeMap::new(),
        )
        .unwrap();
        assert!(before.plan.candidates.is_empty());
        assert_eq!(before.parameters.len(), 2);
        let values = BTreeMap::from([
            ("remotes/0/url/tenant".into(), "owned".into()),
            ("packages/0/argument/0".into(), "C:/owned fixture".into()),
        ]);
        let after = review_metadata(
            temp.path().to_owned(),
            &envelope,
            "io.fixture/parameters",
            "1.0.0",
            &values,
        )
        .unwrap();
        assert_eq!(after.plan.candidates.len(), 2);
        let mut secret = envelope.clone();
        secret["server"]["remotes"][0]["variables"]["tenant"]["isSecret"] = json!(true);
        let blocked = review_metadata(
            temp.path().to_owned(),
            &secret,
            "io.fixture/parameters",
            "1.0.0",
            &values,
        )
        .unwrap();
        assert_eq!(blocked.plan.candidates.len(), 1);
        assert!(blocked
            .plan
            .warnings
            .iter()
            .any(|warning| warning.contains("credencial secreta")));
    }

    #[tokio::test]
    #[ignore = "Read-only request to the official registry; no package or model installation"]
    async fn official_registry_paginates_real_metadata() {
        let mut cursor = None;
        let mut names = HashSet::new();
        for _ in 0..6 {
            let page = list(None, cursor.as_deref()).await.unwrap();
            for server in page.servers {
                names.insert(server.name);
            }
            assert_ne!(page.next_cursor, cursor, "pagination must advance");
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        assert!(
            names.len() >= 200,
            "expected hundreds of distinct published servers, got {}",
            names.len()
        );
        println!("official_registry_distinct_servers={}", names.len());
    }
}
