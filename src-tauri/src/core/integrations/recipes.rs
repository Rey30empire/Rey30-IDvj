use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

const FILE_LIMIT: u64 = 8 * 1024 * 1024;
const TREE_LIMIT: u64 = 128 * 1024 * 1024;
const ENTRY_LIMIT: usize = 10_000;

#[derive(Clone, Debug)]
pub struct McpRecipe {
    pub name: String,
    pub description: String,
    pub config: Value,
    pub warnings: Vec<String>,
    pub preparation: Option<Preparation>,
}

#[derive(Default)]
pub(crate) struct Discovery {
    pub recipes: Vec<McpRecipe>,
    pub warnings: Vec<String>,
}

impl Discovery {
    fn warn(&mut self, message: String) {
        if self.warnings.len() < 200 {
            self.warnings.push(message.chars().take(1024).collect());
        }
    }

    fn absorb(&mut self, source: &str, result: Result<Vec<McpRecipe>, String>) {
        match result {
            Ok(recipes) => self.recipes.extend(recipes),
            Err(error) => self.warn(format!("{source}: {error}")),
        }
    }
}

#[derive(Clone, Debug)]
struct Source {
    root: PathBuf,
    files: Vec<(PathBuf, String)>,
}

#[derive(Clone, Debug)]
enum Kind {
    NodeLocal {
        source: Source,
        entry: PathBuf,
        build: bool,
    },
    PythonLocal {
        source: Source,
        entry: String,
    },
    Npm {
        package: String,
        version: String,
    },
    Pypi {
        package: String,
        version: String,
    },
}

#[derive(Clone, Debug)]
pub struct Preparation {
    kind: Kind,
}

fn quoted(value: &str) -> String {
    // A display representation of one argv element, never passed to a shell.
    serde_json::to_string(value).unwrap_or_else(|_| "\"[valor oculto]\"".into())
}

impl Preparation {
    pub fn preview(&self) -> String {
        let location = "INSTALL_DIR es una carpeta nueva y privada elegida al confirmar. Cada línea representa argv, sin shell. Instalar código no lo aísla del sistema; requiere confiar en su origen.";
        let python = if cfg!(windows) {
            "$INSTALL_DIR/venv/Scripts/python.exe"
        } else {
            "$INSTALL_DIR/venv/bin/python"
        };
        let commands = match &self.kind {
            Kind::NodeLocal { build, .. } => {
                let mut commands = "bun install --cwd \"$INSTALL_DIR/source\" --ignore-scripts".to_owned();
                if *build { commands.push_str("\nbun run --cwd \"$INSTALL_DIR/source\" build"); }
                commands
            }
            Kind::PythonLocal { .. } => format!("uv --no-config venv \"$INSTALL_DIR/venv\"\nuv --no-config pip install --python {} \"$INSTALL_DIR/source\"",quoted(python)),
            Kind::Npm { package, version } => format!("bun add --cwd \"$INSTALL_DIR/source\" --ignore-scripts --exact {}", quoted(&format!("{package}@{version}"))),
            Kind::Pypi { package, version } => format!("uv --no-config venv \"$INSTALL_DIR/venv\"\nuv --no-config pip install --python {} --only-binary=:all: {}",quoted(python), quoted(&format!("{package}=={version}"))),
        };
        let runtime = match &self.kind {
            Kind::NodeLocal { .. } | Kind::Npm { .. } => "El servidor requiere Node.js instalado y compatible con engines.node del paquete. Se ejecutará con Node.js, sin sustitución por Bun. --ignore-scripts impide postinstall: algunas dependencias nativas requieren preparación manual y comprobar el servidor después.",
            _ => "Python debe estar instalado; no se descarga automáticamente.",
        };
        let publication = if matches!(self.kind, Kind::Npm { .. } | Kind::Pypi { .. }) {
            "La receta del registro instala el paquete publicado de esa versión; no compila ni incorpora los cambios locales de un fork del repositorio.\n"
        } else {
            ""
        };
        format!("{location}\n{commands}\n{runtime}\n{publication}El MCP se guarda inactivo. Los valores de entorno, cabeceras y argumentos de conexión están ocultos. No se ejecuta el servidor durante la instalación.")
    }
}

fn is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

fn safe_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err("La receta requiere una ruta absoluta sin '..'.".into());
    }
    let mut current = PathBuf::new();
    for part in path.components() {
        current.push(part);
        if matches!(part, Component::Prefix(_)) {
            continue;
        }
        let metadata = fs::symlink_metadata(&current)
            .map_err(|_| "No se pudo inspeccionar la ruta de la receta.")?;
        if is_link(&metadata) {
            return Err("Las recetas no siguen enlaces simbólicos ni junctions.".into());
        }
    }
    path.canonicalize()
        .map_err(|_| "No se pudo resolver la ruta de la receta.".into())
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    let path = safe_path(path)?;
    let metadata =
        fs::metadata(&path).map_err(|_| "No se pudo inspeccionar el archivo de receta.")?;
    if !metadata.is_file() || metadata.len() > FILE_LIMIT {
        return Err("El archivo de receta supera su límite o no es regular.".into());
    }
    let bytes = fs::read(&path).map_err(|_| "No se pudo leer la receta.")?;
    if bytes.len() as u64 > FILE_LIMIT {
        return Err("El archivo de receta cambió de tamaño durante la lectura.".into());
    }
    Ok(bytes)
}

fn json_file(path: &Path) -> Result<Value, String> {
    serde_json::from_slice(&read(path)?).map_err(|_| {
        format!(
            "{} no contiene JSON válido.",
            path.file_name().unwrap_or_default().to_string_lossy()
        )
    })
}

fn inactive(mut config: Value) -> Value {
    config["active"] = json!(false);
    config["official"] = json!(false);
    config
}

fn plain_string_map(value: Option<&Value>, field: &str) -> Result<(), String> {
    if let Some(value) = value {
        if !value
            .as_object()
            .is_some_and(|map| map.values().all(Value::is_string))
        {
            return Err(format!("{field} debe ser un mapa de cadenas."));
        }
    }
    Ok(())
}

fn normalize(config: &Value) -> Result<Value, String> {
    let mut config = config
        .as_object()
        .cloned()
        .ok_or("La configuración de cada MCP debe ser un objeto.")?;
    if let Some(transport) = config.get("type").and_then(Value::as_str) {
        match transport {
            "stdio" | "http" | "sse" => {}
            "streamable-http" => {
                config.insert("type".into(), json!("http"));
            }
            _ => return Err("La receta declara un transporte MCP no compatible.".into()),
        }
    }
    if let Some(command) = config.get("command") {
        if config
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|transport| transport != "stdio")
        {
            return Err("Un comando local debe usar transporte stdio.".into());
        }
        if !command
            .as_str()
            .is_some_and(|text| !text.trim().is_empty() && !text.contains(['\0', '\n', '\r']))
        {
            return Err("El comando MCP no es válido.".into());
        }
        if config.get("args").is_some_and(|args| {
            !args
                .as_array()
                .is_some_and(|args| args.iter().all(Value::is_string))
        }) {
            return Err("Los argumentos MCP deben ser un array de cadenas.".into());
        }
        if config.contains_key("url") {
            return Err("Una receta MCP no puede mezclar comando y URL.".into());
        }
        config.entry("args").or_insert_with(|| json!([]));
    } else {
        let text = config
            .get("url")
            .and_then(Value::as_str)
            .ok_or("La receta no declara un comando ni una URL MCP.")?;
        let url = url::Url::parse(text).map_err(|_| "La URL MCP no es válida.")?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err("La URL MCP debe usar HTTP o HTTPS.".into());
        }
        if !config.contains_key("type") {
            config.insert("type".into(), json!("http"));
        }
    }
    plain_string_map(config.get("env"), "env")?;
    plain_string_map(config.get("headers"), "headers")?;
    Ok(inactive(Value::Object(config)))
}

fn map_recipes(value: &Value) -> Result<Vec<McpRecipe>, String> {
    let map = value
        .get("mcpServers")
        .or_else(|| value.get("servers"))
        .or_else(|| value.get("mcp_servers"));
    let Some(map) = map else {
        return Ok(Vec::new());
    };
    let map = map
        .as_object()
        .ok_or("mcpServers/servers/mcp_servers debe ser un mapa de objetos.")?;
    if map.len() > 300 {
        return Err("La configuración declara demasiados servidores MCP.".into());
    }
    map.iter().map(|(name, config)| {
        if name.trim().is_empty() || name.len() > 160 { return Err("Un MCP tiene un nombre vacío o demasiado largo.".into()); }
        let mut config = config.clone();
        if let Some(object) = config.as_object_mut() {
            if let Some(headers) = object.remove("http_headers") { object.insert("headers".into(), headers); }
            if let Some(env_vars) = object.remove("env_vars") {
                if env_vars.as_array().is_some_and(|vars| !vars.is_empty()) { return Err("El MCP referencia variables heredadas; añade sus valores manualmente antes de importarlo.".into()); }
            }
            object.remove("enabled");
        }
        Ok(McpRecipe { name: name.clone(), description: "Configuración MCP declarada por el editor o repositorio.".into(),
            config: normalize(&config)?, preparation: None,
            warnings: vec!["Se conserva la configuración declarada, incluidos env y headers; sus valores no aparecen en la vista previa. Revisa el comando y las credenciales antes de activarlo.".into()] })
    }).collect()
}

fn relative(value: &str) -> Result<PathBuf, String> {
    let value = value.trim_start_matches("./");
    let path = Path::new(value);
    if value.is_empty()
        || value.contains(['\\', ':'])
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("La entrada ejecutable debe permanecer dentro del repositorio.".into());
    }
    Ok(path.to_owned())
}

fn skip(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | ".venv"
            | "venv"
            | "target"
            | "__pycache__"
            | ".env"
            | ".npmrc"
            | ".pypirc"
            | "bunfig.toml"
            | ".bunfig.toml"
    ) || (name.starts_with(".env.")
        && !matches!(name, ".env.example" | ".env.template" | ".env.sample"))
}

fn source(root: &Path) -> Result<Source, String> {
    let root = safe_path(root)?;
    let mut pending = vec![root.clone()];
    let mut files = Vec::new();
    let mut size = 0u64;
    let mut entries = 0usize;
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory)
            .map_err(|_| "No se pudo inspeccionar el código de la receta.")?
        {
            let entry = entry.map_err(|_| "No se pudo enumerar el código de la receta.")?;
            let name = entry.file_name();
            if skip(&name.to_string_lossy()) {
                continue;
            }
            entries += 1;
            if entries > ENTRY_LIMIT {
                return Err("El código de la receta contiene demasiados archivos.".into());
            }
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|_| "No se pudo inspeccionar el código de la receta.")?;
            if is_link(&metadata) {
                return Err("El código de la receta contiene enlaces o junctions; requiere preparación manual.".into());
            }
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if metadata.is_file() {
                size = size
                    .checked_add(metadata.len())
                    .ok_or("Tamaño de receta no válido.")?;
                if metadata.len() > FILE_LIMIT || size > TREE_LIMIT {
                    return Err("El código de la receta supera los límites de importación.".into());
                }
                let bytes = read(&entry.path())?;
                files.push((
                    entry
                        .path()
                        .strip_prefix(&root)
                        .map_err(|_| "Ruta de receta no válida.")?
                        .to_owned(),
                    hex::encode(Sha256::digest(bytes)),
                ));
            } else {
                return Err("El código contiene un archivo no regular.".into());
            }
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(Source { root, files })
}

fn package_bins(value: &Value) -> Result<Vec<(String, PathBuf)>, String> {
    let Some(bin) = value.get("bin") else {
        return Ok(Vec::new());
    };
    if let Some(path) = bin.as_str() {
        let name = value["name"]
            .as_str()
            .and_then(|name| name.rsplit('/').next())
            .unwrap_or("mcp-server");
        return Ok(vec![(entry_name(name)?, relative(path)?)]);
    }
    let object = bin
        .as_object()
        .ok_or("package.json bin debe ser una cadena o un mapa.")?;
    object
        .iter()
        .map(|(name, path)| {
            Ok((
                entry_name(name)?,
                relative(path.as_str().ok_or("Una entrada bin no es una cadena.")?)?,
            ))
        })
        .collect()
}

fn entry_name(name: &str) -> Result<String, String> {
    if name.is_empty()
        || matches!(name, "." | "..")
        || name.len() > 120
        || name.starts_with('-')
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
    {
        return Err("La receta contiene un nombre de ejecutable no compatible.".into());
    }
    Ok(name.to_owned())
}

fn local_node(root: &Path) -> Result<Vec<McpRecipe>, String> {
    let package = json_file(&root.join("package.json"))?;
    let indicates_mcp = ["dependencies", "devDependencies", "peerDependencies"]
        .iter()
        .any(|key| {
            package
                .get(key)
                .and_then(Value::as_object)
                .is_some_and(|deps| deps.contains_key("@modelcontextprotocol/sdk"))
        })
        || package
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|name| name.to_ascii_lowercase().contains("mcp"))
        || package
            .get("scripts")
            .and_then(Value::as_object)
            .is_some_and(|scripts| {
                scripts
                    .keys()
                    .any(|name| name.to_ascii_lowercase().contains("mcp"))
            });
    if !indicates_mcp {
        return Ok(Vec::new());
    }
    let bins = package_bins(&package)?;
    if bins.is_empty() {
        return Ok(Vec::new());
    }
    let source = source(root)?;
    let build = package
        .pointer("/scripts/build")
        .is_some_and(Value::is_string);
    bins.into_iter().map(|(name,entry)| {
        if !build && !root.join(&entry).is_file() { return Err("El paquete declara un bin ausente y no proporciona scripts.build; requiere preparación manual.".into()); }
        Ok(McpRecipe { name, description: package["description"].as_str().unwrap_or("Ejecutable declarado en package.json; compatibilidad MCP sin verificar.").into(),
            config: inactive(json!({"command":"node","args":[root.join(&entry).to_string_lossy()]})),
            warnings: vec!["Fallback de package.json: declarar bin no demuestra que implemente MCP. Prueba el servidor después de instalarlo.".into(),
                if build { "La confirmación autoriza descargar dependencias y ejecutar scripts.build del repositorio. No se ejecutan postinstall.".into() } else { "La confirmación autoriza descargar dependencias; los scripts de instalación de dependencias quedan desactivados.".into() },
                "Se omiten .git, credenciales .env/.npmrc/.pypirc y configuraciones globales de Bun. El servidor requiere Node.js compatible con engines.node; las dependencias nativas con postinstall pueden necesitar preparación manual y una comprobación posterior.".into()],
            preparation: Some(Preparation { kind: Kind::NodeLocal { source: source.clone(), entry, build } }) })
    }).collect()
}

fn local_python(root: &Path) -> Result<Vec<McpRecipe>, String> {
    let text = String::from_utf8(read(&root.join("pyproject.toml"))?)
        .map_err(|_| "pyproject.toml no es UTF-8.")?;
    let project: toml::Value =
        toml::from_str(&text).map_err(|_| "pyproject.toml no es TOML válido.")?;
    let indicates_mcp = project
        .get("project")
        .and_then(|project| project.get("name"))
        .and_then(toml::Value::as_str)
        .is_some_and(|name| name.to_ascii_lowercase().contains("mcp"))
        || project
            .get("project")
            .and_then(|project| project.get("dependencies"))
            .and_then(toml::Value::as_array)
            .is_some_and(|deps| {
                deps.iter().filter_map(toml::Value::as_str).any(|dep| {
                    let name = dep
                        .split(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
                        .next()
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    matches!(name.as_str(), "mcp" | "fastmcp")
                })
            })
        || project
            .get("project")
            .and_then(|project| project.get("scripts"))
            .and_then(toml::Value::as_table)
            .is_some_and(|scripts| {
                scripts
                    .keys()
                    .any(|name| name.to_ascii_lowercase().contains("mcp"))
            });
    if !indicates_mcp {
        return Ok(Vec::new());
    }
    let Some(scripts) = project
        .get("project")
        .and_then(|p| p.get("scripts"))
        .and_then(toml::Value::as_table)
    else {
        return Ok(Vec::new());
    };
    if scripts.len() > 100 {
        return Err("El proyecto declara demasiados ejecutables Python.".into());
    }
    let source = source(root)?;
    scripts.iter().map(|(name,target)| {
        let name = entry_name(name)?;
        if !target.as_str().is_some_and(|target| target.contains(':') && !target.contains(['\n','\r','\0'])) {
            return Err("El script Python no declara una entrada módulo:función compatible.".into());
        }
        Ok(McpRecipe { name: name.clone(), description: project.get("project").and_then(|p|p.get("description")).and_then(toml::Value::as_str).unwrap_or("Ejecutable Python declarado; compatibilidad MCP sin verificar.").into(),
            config: inactive(json!({"command":name,"args":[]})),
            warnings: vec!["Fallback de project.scripts: la compatibilidad MCP no está verificada. Prueba el servidor después de instalarlo.".into(),
                "La confirmación autoriza descargar dependencias y ejecutar el backend de construcción Python del repositorio dentro de un entorno virtual; no es una sandbox del sistema.".into()],
            preparation: Some(Preparation { kind: Kind::PythonLocal { source: source.clone(), entry: name } }) })
    }).collect()
}

fn exact_version(value: &str) -> bool {
    value.as_bytes().first().is_some_and(u8::is_ascii_digit)
        && value.len() <= 100
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+' | b'_' | b'!')
        })
}

fn npm_version(value: &str) -> bool {
    if !exact_version(value) {
        return false;
    }
    let core = value.split(['-', '+']).next().unwrap_or("");
    let parts: Vec<_> = core.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|c| c.is_ascii_digit()))
}

fn npm_name(name: &str) -> bool {
    let allowed = |s: &str| {
        !s.is_empty()
            && !s.starts_with(['-', '.'])
            && s.bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
    };
    if let Some(scope) = name.strip_prefix('@') {
        let parts: Vec<_> = scope.split('/').collect();
        parts.len() == 2 && parts.iter().all(|s| allowed(s))
    } else {
        allowed(name)
    }
}

fn arguments(value: Option<&Value>, warnings: &mut Vec<String>) -> Result<Vec<String>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let entries = value
        .as_array()
        .ok_or("Los argumentos de server.json deben ser un array.")?;
    let mut output = Vec::new();
    for argument in entries {
        if argument
            .get("variables")
            .is_some_and(|vars| vars.as_object().is_none_or(|vars| !vars.is_empty()))
        {
            return Err("server.json contiene variables de argumento sin resolver; requiere configuración manual.".into());
        }
        let literal = argument
            .get("value")
            .or_else(|| argument.get("default"))
            .and_then(Value::as_str);
        if literal.is_some_and(|value| value.contains(['{', '}'])) {
            return Err("server.json contiene plantillas de argumentos sin resolver.".into());
        }
        match argument["type"].as_str() {
            Some("named") => {
                let name = argument["name"]
                    .as_str()
                    .filter(|name| name.starts_with('-') && !name.contains(['\n', '\r', '\0']))
                    .ok_or("Un argumento nombrado no declara un nombre válido.")?;
                if let Some(value) = literal {
                    output.push(name.into());
                    output.push(value.into());
                } else if argument["isRequired"] == true {
                    return Err(
                        "Un argumento obligatorio no tiene valor; completa la receta manualmente."
                            .into(),
                    );
                } else {
                    warnings.push(format!(
                        "Argumento opcional {name} omitido porque no tiene valor declarado."
                    ));
                }
            }
            Some("positional") => {
                if let Some(value) = literal {
                    output.push(value.into());
                } else if argument["isRequired"] == true {
                    return Err(
                        "Un argumento obligatorio no tiene valor; completa la receta manualmente."
                            .into(),
                    );
                }
            }
            _ => return Err("server.json contiene un tipo de argumento no compatible.".into()),
        }
    }
    Ok(output)
}

fn declared_variables(
    value: Option<&Value>,
    warnings: &mut Vec<String>,
) -> Result<Map<String, Value>, String> {
    let mut output = Map::new();
    let Some(value) = value else {
        return Ok(output);
    };
    for variable in value
        .as_array()
        .ok_or("Las variables de server.json deben ser un array.")?
    {
        let name = variable["name"]
            .as_str()
            .filter(|name| {
                !name.is_empty()
                    && name.len() <= 160
                    && name
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
            })
            .ok_or("Una variable de server.json tiene un nombre no válido.")?;
        if variable["isSecret"] == true {
            warnings.push(format!(
                "{name} es una credencial: complétala en configuración antes de activar el MCP."
            ));
        }
        if let Some(value) = variable
            .get("value")
            .or_else(|| variable.get("default"))
            .and_then(Value::as_str)
        {
            if value.contains(['{', '}']) {
                return Err("server.json contiene variables sin resolver.".into());
            }
            output.insert(name.into(), json!(value));
        } else if variable["isRequired"] == true {
            warnings.push(format!("Falta el valor obligatorio {name}; el servidor permanece inactivo hasta completarlo."));
        }
    }
    Ok(output)
}

fn registry(value: &Value) -> Result<Vec<McpRecipe>, String> {
    if !value.is_object() {
        return Err("server.json debe ser un objeto.".into());
    }
    let title = value
        .get("title")
        .or_else(|| value.get("name"))
        .and_then(Value::as_str)
        .ok_or("server.json no declara nombre.")?;
    let description = value["description"]
        .as_str()
        .unwrap_or("Servidor declarado en el registro MCP.");
    let mut output = Vec::new();
    if let Some(remotes) = value.get("remotes") {
        for (index, remote) in remotes
            .as_array()
            .ok_or("server.json remotes no es un array.")?
            .iter()
            .enumerate()
        {
            let transport = remote["type"]
                .as_str()
                .ok_or("Un remote no declara transporte.")?;
            if !matches!(transport, "streamable-http" | "sse") {
                continue;
            }
            if remote["url"]
                .as_str()
                .is_some_and(|url| url.contains(['{', '}']))
            {
                return Err("El remote de server.json contiene una URL con variables sin resolver; complétala manualmente.".into());
            }
            let mut warnings = vec!["La conexión se guarda inactiva; comprueba autenticación y confianza antes de probarla.".into()];
            let headers = declared_variables(remote.get("headers"), &mut warnings)?;
            let config = normalize(
                &json!({"type":if transport=="sse" {"sse"} else {"http"},"url":remote["url"],"headers":headers}),
            )?;
            output.push(McpRecipe {
                name: format!("{title} (remote {})", index + 1),
                description: description.into(),
                config,
                warnings,
                preparation: None,
            });
        }
    }
    if let Some(packages) = value.get("packages") {
        for package in packages
            .as_array()
            .ok_or("server.json packages no es un array.")?
        {
            if package.pointer("/transport/type").and_then(Value::as_str) != Some("stdio") {
                continue;
            }
            let registry = package["registryType"].as_str().unwrap_or("");
            if !matches!(registry, "npm" | "pypi") {
                continue;
            }
            if let Some(hint) = package.get("runtimeHint") {
                let supported = match registry {
                    "npm" => hint
                        .as_str()
                        .is_some_and(|hint| matches!(hint, "npx" | "node" | "nodejs")),
                    "pypi" => hint
                        .as_str()
                        .is_some_and(|hint| matches!(hint, "uvx" | "uv" | "python")),
                    _ => false,
                };
                if !supported {
                    return Err(format!("server.json declara runtimeHint incompatible con el runtime {registry} admitido. Requiere preparación manual; no se sustituye el runtime explícito."));
                }
            }
            let name = package["identifier"]
                .as_str()
                .ok_or("Un paquete MCP no declara identifier.")?;
            let version = package["version"]
                .as_str()
                .filter(|version| exact_version(version))
                .ok_or("El paquete MCP requiere una versión exacta, sin rangos ni latest.")?;
            let mut warnings = vec!["Se instalará la versión declarada en server.json; no se ejecutará el servidor ni se activará automáticamente.".into()];
            if package
                .get("runtimeArguments")
                .is_some_and(|args| args.as_array().is_none_or(|args| !args.is_empty()))
            {
                return Err("Los runtimeArguments de server.json requieren configuración manual; no se ejecutaron.".into());
            }
            let args = arguments(package.get("packageArguments"), &mut warnings)?;
            let env = declared_variables(package.get("environmentVariables"), &mut warnings)?;
            let base = package.get("registryBaseUrl").and_then(Value::as_str);
            let (kind, command) = match registry {
                "npm"
                    if npm_name(name)
                        && npm_version(version)
                        && base.is_none_or(|base| base == "https://registry.npmjs.org") =>
                {
                    warnings.push("Bun instala sin scripts postinstall; Node.js ejecutará el servidor. Requiere Node.js compatible con engines.node y, si hay dependencias nativas, puede necesitar preparación manual y una comprobación posterior.".into());
                    warnings.push("server.json apunta a un paquete publicado en npm; instalarlo no compila ni incluye los cambios locales de un fork del repositorio.".into());
                    (
                        Kind::Npm {
                            package: name.into(),
                            version: version.into(),
                        },
                        "node",
                    )
                }
                "pypi"
                    if entry_name(name).is_ok()
                        && base.is_none_or(|base| base == "https://pypi.org") =>
                {
                    warnings.push("Solo se aceptan wheels de PyPI; los paquetes que requieran compilar fuentes se preparan manualmente.".into());
                    (
                        Kind::Pypi {
                            package: name.into(),
                            version: version.into(),
                        },
                        "uv",
                    )
                }
                _ => continue,
            };
            output.push(McpRecipe {
                name: format!("{title} ({registry})"),
                description: description.into(),
                config: inactive(json!({"command":command,"args":args,"env":env})),
                warnings,
                preparation: Some(Preparation { kind }),
            });
        }
    }
    if output.is_empty() {
        return Err("server.json no contiene una receta compatible: se admiten remotes HTTP/SSE y paquetes npm/PyPI stdio con versión exacta. Otros registros, MCPB y metadatos incompletos requieren instalación manual.".into());
    }
    Ok(output)
}

fn explicit_report(path: &Path) -> Result<Discovery, String> {
    let value = if path
        .extension()
        .is_some_and(|extension| extension == "toml")
    {
        let text = String::from_utf8(read(path)?).map_err(|_| "El TOML MCP no es UTF-8.")?;
        let value: toml::Value =
            toml::from_str(&text).map_err(|_| "La configuración MCP no es TOML válido.")?;
        serde_json::to_value(value).map_err(|_| "No se pudo convertir la configuración TOML.")?
    } else {
        json_file(path)?
    };
    let mut report = Discovery::default();
    for key in ["mcpServers", "servers", "mcp_servers"] {
        let Some(map) = value.get(key) else {
            continue;
        };
        let Some(map) = map.as_object() else {
            report
                .warnings
                .push(format!("{key} debe ser un mapa de objetos."));
            continue;
        };
        if map.len() > 300 {
            return Err("La configuración declara demasiados servidores MCP.".into());
        }
        for (name, config) in map {
            let mut one = Map::new();
            one.insert(name.clone(), config.clone());
            report.absorb(
                &format!("{key}/{name}"),
                map_recipes(&json!({"mcpServers":one})),
            );
        }
    }
    Ok(report)
}

pub(crate) fn registry_report(value: &Value) -> Result<Discovery, String> {
    let object = value.as_object().ok_or("server.json debe ser un objeto.")?;
    let mut report = Discovery::default();
    let mut found = false;
    for key in ["remotes", "packages"] {
        let Some(entries) = object.get(key) else {
            continue;
        };
        found = true;
        let Some(entries) = entries.as_array() else {
            report
                .warnings
                .push(format!("server.json {key} debe ser un array."));
            continue;
        };
        if entries.len() > 300 {
            return Err("server.json declara demasiadas alternativas MCP.".into());
        }
        for (index, entry) in entries.iter().enumerate() {
            let mut one = object.clone();
            one.remove("packages");
            one.remove("remotes");
            one.insert(key.into(), json!([entry]));
            report.absorb(
                &format!("server.json/{key}/{}", index + 1),
                registry(&Value::Object(one)),
            );
        }
    }
    if !found {
        report.absorb("server.json", registry(value));
    }
    Ok(report)
}

fn augment_explicit(root: &Path, recipes: &mut [McpRecipe]) -> Result<(), String> {
    for recipe in recipes {
        let command = recipe.config["command"].as_str().unwrap_or("");
        let leaf = Path::new(command)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(command);
        let args: Vec<String> = recipe.config["args"]
            .as_array()
            .map(|args| {
                args.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        if matches!(leaf, "npx" | "npx.exe") {
            let start = usize::from(
                args.first()
                    .is_some_and(|arg| matches!(arg.as_str(), "-y" | "--yes")),
            );
            if let Some((package, version)) = args
                .get(start)
                .and_then(|arg| arg.rsplit_once('@'))
                .filter(|(package, version)| npm_name(package) && npm_version(version))
            {
                recipe.preparation = Some(Preparation {
                    kind: Kind::Npm {
                        package: package.into(),
                        version: version.into(),
                    },
                });
                recipe.config["args"] = json!(&args[start + 1..]);
                recipe.warnings.push("npx se sustituye por una instalación privada de esa versión publicada mediante Bun, sin postinstall, y ejecución con Node.js instalado compatible con engines.node. No compila cambios del fork; algunas dependencias nativas requieren preparación manual y comprobar el servidor.".into());
                continue;
            }
            recipe.warnings.push("npx sin paquete y versión exactos no se prepara automáticamente. Su primera ejecución puede descargar código; fija una versión y vuelve a explorar antes de instalar.".into());
        } else if matches!(leaf, "uvx" | "uvx.exe") {
            if let Some((package, version)) = args
                .first()
                .and_then(|arg| arg.split_once("=="))
                .filter(|(package, version)| entry_name(package).is_ok() && exact_version(version))
            {
                recipe.preparation = Some(Preparation {
                    kind: Kind::Pypi {
                        package: package.into(),
                        version: version.into(),
                    },
                });
                recipe.config["args"] = json!(&args[1..]);
                recipe.warnings.push("uvx se sustituye por una instalación privada de esa versión exacta. Solo se aceptan wheels; no se compilan paquetes de PyPI.".into());
                continue;
            }
            recipe.warnings.push("uvx sin versión exacta requiere preparación manual; su primera ejecución puede descargar código.".into());
        } else if matches!(leaf, "node" | "node.exe") && root.join("package.json").is_file() {
            if let Some(entry) = args.first().and_then(|entry| relative(entry).ok()) {
                let package = json_file(&root.join("package.json"))?;
                if package_bins(&package)?.iter().any(|(_, bin)| bin == &entry) {
                    let build = package
                        .pointer("/scripts/build")
                        .is_some_and(Value::is_string);
                    if !build && !root.join(&entry).is_file() {
                        return Err("El bin MCP declarado no existe y falta scripts.build; requiere preparación manual.".into());
                    }
                    recipe.preparation = Some(Preparation {
                        kind: Kind::NodeLocal {
                            source: source(root)?,
                            entry,
                            build,
                        },
                    });
                    recipe.warnings.push(if build {"Se copiará el código y se ejecutará scripts.build después de instalar dependencias sin postinstall. La confirmación autoriza ese código de construcción; el servidor se ejecutará con Node.js instalado compatible con engines.node.".into()}else{"Se copiará el código y se instalarán dependencias sin postinstall. El servidor usará Node.js instalado compatible con engines.node; algunas dependencias nativas requieren preparación manual y una comprobación posterior.".into()});
                    continue;
                }
            }
        }
        if !command.is_empty() {
            recipe.warnings.push("Esta configuración se conserva sin ejecutar ni instalar dependencias. Las rutas relativas, variables del editor y requisitos externos pueden necesitar ajuste manual.".into());
        }
    }
    Ok(())
}

pub(crate) fn discover_report(root: &Path) -> Result<Discovery, String> {
    let root = safe_path(root)?;
    if root.is_file() {
        if root
            .file_name()
            .is_some_and(|name| name == "package.json" || name == "pyproject.toml")
        {
            return discover_report(
                root.parent()
                    .ok_or("El manifiesto no tiene carpeta de proyecto.")?,
            );
        }
        return if root.file_name().is_some_and(|name| name == "server.json") {
            registry_report(&json_file(&root)?)
        } else {
            let mut report = explicit_report(&root)?;
            if let Some(parent) = root.parent() {
                augment_report(parent, &mut report);
            }
            Ok(report)
        };
    }
    let mut report = Discovery::default();
    for file in [
        ".mcp.json",
        "mcp.json",
        "mcp_config.json",
        "claude_desktop_config.json",
        ".claude.json",
        ".vscode/mcp.json",
        ".cursor/mcp.json",
        ".codex/config.toml",
        "config.toml",
    ] {
        let path = root.join(file);
        if path.is_file() {
            match explicit_report(&path) {
                Ok(found) => {
                    report.recipes.extend(found.recipes);
                    report.warnings.extend(
                        found
                            .warnings
                            .into_iter()
                            .map(|warning| format!("{file}: {warning}")),
                    );
                }
                Err(error) => report.warnings.push(format!("{file}: {error}")),
            }
        }
    }
    augment_report(&root, &mut report);
    if root.join("server.json").is_file() {
        match json_file(&root.join("server.json")).and_then(|value| registry_report(&value)) {
            Ok(found) => {
                report.recipes.extend(found.recipes);
                report.warnings.extend(found.warnings);
            }
            Err(error) => report.warnings.push(error),
        }
    }
    if !report.recipes.is_empty() {
        let mut seen = HashSet::new();
        report
            .recipes
            .retain(|recipe| seen.insert(format!("{}:{}", recipe.name, recipe.config)));
        return Ok(report);
    }
    if root.join("package.json").is_file() {
        report.absorb("package.json", local_node(&root));
    }
    if root.join("pyproject.toml").is_file() {
        report.absorb("pyproject.toml", local_python(&root));
    }
    Ok(report)
}

fn augment_report(root: &Path, report: &mut Discovery) {
    for recipe in &mut report.recipes {
        let original = recipe.clone();
        if let Err(error) = augment_explicit(root, std::slice::from_mut(recipe)) {
            *recipe = original;
            recipe.warnings.push(format!("Preparación automática no disponible: {error} Configuración conservada inactiva para revisión manual."));
            report.warnings.push(format!("{}: {error}", recipe.name));
        }
    }
}

pub fn discover(root: &Path) -> Result<Vec<McpRecipe>, String> {
    let report = discover_report(root)?;
    if report.recipes.is_empty() && !report.warnings.is_empty() {
        return Err(report.warnings.join("\n"));
    }
    Ok(report.recipes)
}

fn runtime(name: &str) -> Result<PathBuf, String> {
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let mut directories = Vec::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            directories.extend([
                parent.join("resources/bin"),
                parent.join("bin"),
                parent.to_owned(),
            ]);
            if let Some(root) = parent.parent() {
                directories.push(root.join("Resources/bin"));
            }
            for ancestor in parent.ancestors().take(5) {
                directories.push(ancestor.join("resources/bin"));
            }
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path).filter(|path| path.is_absolute()));
    }
    let target = if cfg!(target_os = "windows") {
        "x86_64-pc-windows-msvc"
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        }
    } else if cfg!(target_arch = "aarch64") {
        "aarch64-unknown-linux-gnu"
    } else {
        "x86_64-unknown-linux-gnu"
    };
    for directory in directories {
        for file in [
            format!("{name}{suffix}"),
            format!("{name}-{target}{suffix}"),
        ] {
            let path = directory.join(file);
            if path.is_file() {
                return path
                    .canonicalize()
                    .map_err(|_| format!("No se pudo resolver {name}."));
            }
        }
    }
    Err(format!("No se encontró {name} en los recursos de la aplicación ni en PATH. Instálalo antes de confirmar esta receta."))
}

fn node_launch_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    #[cfg(windows)]
    if let Some(Component::Prefix(prefix)) = path.components().next() {
        // Node's main-module realpath resolver rejects verbatim drive roots.
        // Convert only at the process boundary, after canonical safety checks.
        match prefix.kind() {
            std::path::Prefix::VerbatimDisk(_) => return text[4..].to_owned(),
            std::path::Prefix::VerbatimUNC(_, _) => return format!("\\\\{}", &text[8..]),
            _ => {}
        }
    }
    text.into_owned()
}

fn destination(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || path.parent().is_none()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err(
            "La carpeta de instalación debe ser absoluta y no puede ser la raíz del disco.".into(),
        );
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) if is_link(&metadata) || !metadata.is_dir() => {
                return Err("La instalación no puede atravesar enlaces o archivos.".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => fs::create_dir(&current)
                .map_err(|_| "No se pudo crear la carpeta privada de instalación.")?,
            Err(_) => return Err("No se pudo comprobar la carpeta de instalación.".into()),
        }
    }
    let path = safe_path(path)?;
    if path.parent().is_none() {
        return Err("No se permite instalar en la raíz del disco.".into());
    }
    Ok(path)
}

fn copy_source(source: &Source, destination: &Path) -> Result<(), String> {
    let actual = self::source(&source.root)?;
    if actual.files != source.files {
        return Err(
            "El código cambió después de la vista previa. Vuelve a explorar antes de instalar."
                .into(),
        );
    }
    fs::create_dir(destination).map_err(|_| "No se pudo preparar la copia privada del código.")?;
    for (relative, hash) in &source.files {
        let bytes = read(&source.root.join(relative))?;
        if hex::encode(Sha256::digest(&bytes)) != *hash {
            return Err("El código cambió durante la copia. Vuelve a explorar.".into());
        }
        let path = destination.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|_| "No se pudo crear una carpeta de código.")?;
        }
        fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .and_then(|mut file| std::io::Write::write_all(&mut file, &bytes))
            .map_err(|_| "No se pudo copiar el código privado.")?;
    }
    Ok(())
}

async fn drain<R: AsyncRead + Unpin>(mut reader: R) -> Result<(), String> {
    let mut total = 0usize;
    let mut buffer = [0u8; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .await
            .map_err(|_| "No se pudo leer el instalador.")?;
        if count == 0 {
            return Ok(());
        }
        total += count;
        if total > 1024 * 1024 {
            return Err("El instalador superó su límite de salida; se detuvo.".into());
        }
    }
}

async fn install(
    program: &Path,
    args: &[String],
    directory: &Path,
    private: &Path,
) -> Result<(), String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(directory)
        .env_clear()
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in [
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "SYSTEMDRIVE",
        "TEMP",
        "TMP",
        "TMPDIR",
        "COMSPEC",
        "PATHEXT",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "no_proxy",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    let home = private.join("home");
    fs::create_dir_all(&home)
        .map_err(|_| "No se pudo preparar el entorno privado del instalador.")?;
    command
        .env("HOME", &home)
        .env("USERPROFILE", &home)
        .env("APPDATA", home.join("appdata"))
        .env("LOCALAPPDATA", home.join("localappdata"))
        .env("UV_CACHE_DIR", private.join("uv-cache"))
        .env("UV_NO_CONFIG", "1")
        .env("UV_NO_PROGRESS", "1")
        .env("UV_PYTHON_DOWNLOADS", "never")
        .env("UV_PYTHON_INSTALL_DIR", private.join("python"))
        .env("UV_TOOL_DIR", private.join("uv-tools"))
        .env("XDG_CACHE_HOME", private.join("cache"))
        .env("XDG_CONFIG_HOME", private.join("config"))
        .env("BUN_INSTALL_CACHE_DIR", private.join("bun-cache"))
        .env("CI", "1")
        .env("NO_COLOR", "1");
    #[cfg(windows)]
    {
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "No se pudo iniciar el instalador de dependencias.")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("El instalador no abrió su salida.")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("El instalador no abrió su salida de errores.")?;
    let work = async {
        tokio::try_join!(
            async {
                child
                    .wait()
                    .await
                    .map_err(|_| "No se pudo esperar al instalador.".to_owned())
            },
            drain(stdout),
            drain(stderr)
        )
    };
    match tokio::time::timeout(Duration::from_secs(10*60),work).await {
        Ok(Ok((status,_,_))) if status.success()=>Ok(()),
        Ok(Ok(_))=>Err("La instalación falló. No se activó ni ejecutó el servidor MCP. Revisa requisitos del paquete y la conexión de red.".into()),
        Ok(Err(error))=>{let _=child.kill().await;Err(error)},
        Err(_)=>{let _=child.kill().await;Err("La instalación agotó su tiempo de espera; no se activó el MCP.".into())},
    }
}

fn python(venv: &Path) -> PathBuf {
    if cfg!(windows) {
        venv.join("Scripts/python.exe")
    } else {
        venv.join("bin/python")
    }
}
fn python_entry(venv: &Path, name: &str) -> PathBuf {
    if cfg!(windows) {
        venv.join("Scripts").join(format!("{name}.exe"))
    } else {
        venv.join("bin").join(name)
    }
}

fn installed_python_entry(venv: &Path, package: &str) -> Result<String, String> {
    let normalized = |value: &str| value.to_ascii_lowercase().replace(['-', '.'], "_");
    let mut roots = vec![venv.join("Lib/site-packages")];
    if let Ok(libs) = fs::read_dir(venv.join("lib")) {
        for lib in libs.flatten() {
            roots.push(lib.path().join("site-packages"));
        }
    }
    let mut names = Vec::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".dist-info")
                || !normalized(&name).starts_with(&format!("{}_", normalized(package)))
            {
                continue;
            }
            let metadata_path = entry.path().join("METADATA");
            if !metadata_path.is_file() {
                continue;
            }
            let metadata = String::from_utf8(read(&metadata_path)?)
                .map_err(|_| "El paquete instaló metadatos Python no compatibles.")?;
            let distribution = metadata
                .lines()
                .find_map(|line| line.strip_prefix("Name:").map(str::trim));
            if !distribution.is_some_and(|name| normalized(name) == normalized(package)) {
                continue;
            }
            let path = entry.path().join("entry_points.txt");
            if !path.is_file() {
                continue;
            }
            let text = String::from_utf8(read(&path)?)
                .map_err(|_| "El paquete instaló metadatos de ejecutables no compatibles.")?;
            let mut console = false;
            for line in text.lines().map(str::trim) {
                if line.starts_with('[') {
                    console = line == "[console_scripts]";
                    continue;
                }
                if console {
                    if let Some((name, _)) = line.split_once('=') {
                        names.push(entry_name(name.trim())?);
                    }
                }
            }
        }
    }
    if let Some(name) = names
        .iter()
        .find(|name| normalized(name) == normalized(package))
    {
        return Ok(name.clone());
    }
    if names.len() == 1 {
        return Ok(names.remove(0));
    }
    Err("El paquete no declara un único console_script verificable; completa la configuración manualmente.".into())
}

pub async fn prepare(recipe: &McpRecipe, work_root: &Path) -> Result<Value, String> {
    let Some(preparation) = recipe.preparation.as_ref() else {
        return normalize(&recipe.config);
    };
    let root = destination(work_root)?;
    let private = root.join(format!("mcp-{}", uuid::Uuid::new_v4()));
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&private)
            .map_err(|_| "No se pudo preparar la instalación privada.")?;
    }
    #[cfg(not(unix))]
    fs::create_dir(&private).map_err(|_| "No se pudo preparar la instalación privada.")?;
    let source_dir = private.join("source");
    let mut config = normalize(&recipe.config)?;
    let original_args = config
        .get("args")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let result=async {
        match &preparation.kind {
            Kind::NodeLocal{source,entry,build}=>{
                let node=runtime("node").map_err(|_|"Se requiere Node.js instalado y disponible en PATH, compatible con engines.node del paquete. Instálalo antes de preparar esta receta; no se sustituye por Bun.".to_string())?;
                let source=source.clone();let destination=source_dir.clone();
                tokio::task::spawn_blocking(move||copy_source(&source,&destination)).await.map_err(|_|"No se pudo copiar el código de la receta.")??;
                let bun=runtime("bun")?;
                install(&bun,&["install".into(),"--cwd".into(),source_dir.to_string_lossy().into(),"--ignore-scripts".into()],&source_dir,&private).await?;
                if *build{install(&bun,&["run".into(),"--cwd".into(),source_dir.to_string_lossy().into(),"build".into()],&source_dir,&private).await?;}
                let executable=safe_path(&source_dir.join(entry))?;
                if !executable.starts_with(&source_dir)||!executable.is_file(){return Err("El bin declarado no se generó dentro de la copia privada.".into());}
                let mut args=vec![json!(node_launch_path(&executable))];args.extend(original_args.iter().skip(1).cloned());
                config["command"]=json!(node_launch_path(&node));config["args"]=json!(args);
            }
            Kind::PythonLocal{source,entry}=>{
                let source=source.clone();let destination=source_dir.clone();
                tokio::task::spawn_blocking(move||copy_source(&source,&destination)).await.map_err(|_|"No se pudo copiar el código de la receta.")??;
                let uv=runtime("uv")?;let venv=private.join("venv");let python=python(&venv);
                install(&uv,&["--no-config".into(),"venv".into(),venv.to_string_lossy().into()],&private,&private).await?;
                install(&uv,&["--no-config".into(),"pip".into(),"install".into(),"--python".into(),python.to_string_lossy().into(),source_dir.to_string_lossy().into()],&private,&private).await?;
                let executable=python_entry(&venv,entry);
                if !executable.is_file(){return Err("La instalación Python no generó el ejecutable declarado.".into());}
                config["command"]=json!(executable.to_string_lossy());config["args"]=json!([]);
            }
            Kind::Npm{package,version}=>{
                let node=runtime("node").map_err(|_|"Se requiere Node.js instalado y disponible en PATH, compatible con engines.node del paquete. Instálalo antes de preparar esta receta; no se sustituye por Bun.".to_string())?;
                fs::create_dir(&source_dir).map_err(|_|"No se pudo preparar el paquete npm.")?;
                fs::write(source_dir.join("package.json"),b"{\"private\":true}").map_err(|_|"No se pudo preparar package.json.")?;
                let bun=runtime("bun")?;
                install(&bun,&["add".into(),"--cwd".into(),source_dir.to_string_lossy().into(),"--ignore-scripts".into(),"--exact".into(),format!("{package}@{version}")],&source_dir,&private).await?;
                let package_root=source_dir.join("node_modules").join(package);
                let bins=package_bins(&json_file(&package_root.join("package.json"))?)?;
                let leaf=package.rsplit('/').next().unwrap_or(package);
                let entry=bins.iter().find(|(name,_)|name==leaf).or_else(||if bins.len()==1{bins.first()}else{None}).ok_or("El paquete npm no declara un único bin verificable; requiere configuración manual.")?;
                let executable=safe_path(&package_root.join(&entry.1))?;
                if !executable.starts_with(&source_dir)||!executable.is_file(){return Err("El paquete no generó un bin seguro dentro de la instalación.".into());}
                let mut args=vec![json!(node_launch_path(&executable))];args.extend(original_args.clone());
                config["command"]=json!(node_launch_path(&node));config["args"]=json!(args);
            }
            Kind::Pypi{package,version}=>{
                let uv=runtime("uv")?;let venv=private.join("venv");let python=python(&venv);
                install(&uv,&["--no-config".into(),"venv".into(),venv.to_string_lossy().into()],&private,&private).await?;
                install(&uv,&["--no-config".into(),"pip".into(),"install".into(),"--python".into(),python.to_string_lossy().into(),"--only-binary=:all:".into(),format!("{package}=={version}")],&private,&private).await?;
                let entry=installed_python_entry(&venv,package)?;let executable=python_entry(&venv,&entry);
                if !executable.is_file(){return Err("El paquete PyPI no generó un console_script ejecutable.".into());}
                config["command"]=json!(executable.to_string_lossy());config["args"]=json!(original_args);
            }
        }
        Ok(inactive(config))
    }.await;
    // Installation/build code is authorized only by commit. A failed install
    // is kept for inspection instead of recursively deleting untrusted output.
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_config_has_priority_and_retains_secrets_without_previewing_them() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join(".mcp.json"),r#"{"mcpServers":{"declared":{"command":"node","args":["--token","fixture-secret"],"env":{"KEY":"fixture-secret"},"headers":{"Authorization":"fixture-secret"},"active":true}}}"#).unwrap();
        fs::write(
            root.path().join("package.json"),
            r#"{"name":"fallback","bin":"missing.js"}"#,
        )
        .unwrap();
        let recipes = discover(root.path()).unwrap();
        assert_eq!(recipes.len(), 1);
        assert_eq!(recipes[0].name, "declared");
        assert_eq!(recipes[0].config["env"]["KEY"], "fixture-secret");
        assert_eq!(recipes[0].config["active"], false);
        assert!(recipes[0].preparation.is_none());
    }

    #[test]
    fn vscode_and_codex_maps_are_normalized() {
        let value = json!({"servers":{"remote":{"type":"streamable-http","url":"https://example.test/mcp","headers":{"Authorization":"fixture-secret"}}}});
        assert_eq!(map_recipes(&value).unwrap()[0].config["type"], "http");
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("config.toml");
        fs::write(&path,"[mcp_servers.test]\ncommand='node'\nargs=['server.js']\n[mcp_servers.test.env]\nKEY='fixture-secret'\n").unwrap();
        assert_eq!(
            discover(&path).unwrap()[0].config["env"]["KEY"],
            "fixture-secret"
        );
        for value in [
            json!({"mcpServers":null}),
            json!({"mcpServers":[]}),
            json!({"servers":{"bad":null}}),
        ] {
            assert!(map_recipes(&value).is_err());
        }
    }

    #[test]
    fn registry_prefers_declared_packages_and_redacts_secrets_in_preview() {
        let recipe=registry(&json!({"name":"org/server","packages":[{"registryType":"npm","identifier":"@org/server","version":"1.2.3","transport":{"type":"stdio"},"packageArguments":[{"type":"named","name":"--token","value":"fixture-secret"}],"environmentVariables":[{"name":"API_KEY","isSecret":true,"isRequired":true}]}]})).unwrap().remove(0);
        let preview = recipe.preparation.unwrap().preview();
        assert!(preview.contains("@org/server@1.2.3"));
        assert!(preview.contains("Node.js instalado"));
        assert!(preview.contains("paquete publicado"));
        assert!(preview.contains("fork"));
        assert_eq!(recipe.config["command"], "node");
        assert!(!preview.contains("fixture-secret"));
        assert_eq!(recipe.config["args"], json!(["--token", "fixture-secret"]));
        assert!(registry(&json!({"name":"unsupported","packages":[{"registryType":"oci","identifier":"org/image","version":"1.2.3","transport":{"type":"stdio"}}]})).is_err());
        for version in ["latest", "^1.2.3", "1.*", "https://evil.test/pkg"] {
            assert!(!exact_version(version));
        }
    }

    #[test]
    fn local_bins_cannot_traverse_and_changed_source_cannot_install() {
        for value in [
            "../outside.js",
            "/absolute.js",
            "a/../../x",
            "C:/outside",
            "a\\outside",
        ] {
            assert!(relative(value).is_err(), "{value}");
        }
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("package.json"),
            r#"{"name":"mcp-fixture","bin":"server.js"}"#,
        )
        .unwrap();
        fs::write(root.path().join("server.js"), "fixture").unwrap();
        fs::write(root.path().join(".env"), "fixture-secret").unwrap();
        let recipe = discover(root.path()).unwrap().remove(0);
        let Kind::NodeLocal { source, .. } = recipe.preparation.unwrap().kind else {
            panic!("wrong fixture");
        };
        assert!(!source
            .files
            .iter()
            .any(|(path, _)| path == Path::new(".env")));
        fs::write(root.path().join("server.js"), "changed").unwrap();
        let target = tempfile::tempdir().unwrap();
        assert!(copy_source(&source, &target.path().join("copy")).is_err());
    }

    #[tokio::test]
    async fn explicit_prepare_is_inactive_and_does_not_create_installation() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("untouched");
        let recipe = McpRecipe {
            name: "test".into(),
            description: "".into(),
            config: json!({"command":"never-executed","args":[],"active":true}),
            warnings: Vec::new(),
            preparation: None,
        };
        assert_eq!(
            prepare(&recipe, &destination).await.unwrap()["active"],
            false
        );
        assert!(!destination.exists());
    }

    #[test]
    fn generic_clis_are_not_mcp_and_declared_build_is_previewed() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("package.json"),
            r#"{"name":"generic-cli","bin":"cli.js"}"#,
        )
        .unwrap();
        fs::write(root.path().join("cli.js"), "fixture").unwrap();
        assert!(discover(root.path()).unwrap().is_empty());
        fs::write(root.path().join("package.json"),r#"{"name":"mcp-fixture","bin":"dist/server.js","scripts":{"build":"bun build src/server.ts --outfile dist/server.js"}}"#).unwrap();
        let recipes = discover(root.path()).unwrap();
        assert_eq!(recipes.len(), 1);
        assert!(recipes[0]
            .preparation
            .as_ref()
            .unwrap()
            .preview()
            .contains("build"));
        assert_eq!(
            discover(&root.path().join("package.json")).unwrap().len(),
            1
        );
    }

    #[test]
    fn python_scripts_need_mcp_evidence_and_registry_ignores_unsupported_alternatives() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("pyproject.toml");
        fs::write(
            &path,
            "[project]\nname='generic-cli'\n[project.scripts]\ncli='example:main'\n",
        )
        .unwrap();
        assert!(discover(&path).unwrap().is_empty());
        fs::write(&path,"[project]\nname='fixture'\ndependencies=['fastmcp>=2']\n[project.scripts]\nserver='example:main'\n").unwrap();
        let recipe = discover(&path).unwrap().remove(0);
        assert!(recipe
            .preparation
            .unwrap()
            .preview()
            .contains("pip install"));
        let recipes=registry(&json!({"name":"hybrid","packages":[{"registryType":"npm","identifier":"mcp-test","version":"1.2.3","transport":{"type":"stdio"}},{"registryType":"oci","identifier":"org/image:latest","transport":{"type":"stdio"},"runtimeArguments":[{"type":"named","name":"-v","value":"{host}"}]}]})).unwrap();
        assert_eq!(recipes.len(), 1);
    }

    #[test]
    fn installed_python_entry_belongs_to_the_exact_distribution() {
        let root = tempfile::tempdir().unwrap();
        let site = root.path().join("Lib/site-packages");
        let dependency = site.join("example_helper-1.0.dist-info");
        fs::create_dir_all(&dependency).unwrap();
        fs::write(
            dependency.join("METADATA"),
            "Name: example-helper\nVersion: 1.0\n",
        )
        .unwrap();
        fs::write(
            dependency.join("entry_points.txt"),
            "[console_scripts]\nwrong = helper:main\n",
        )
        .unwrap();
        assert!(installed_python_entry(root.path(), "example").is_err());
        let package = site.join("example-1.0.dist-info");
        fs::create_dir_all(&package).unwrap();
        fs::write(package.join("METADATA"), "Name: example\nVersion: 1.0\n").unwrap();
        fs::write(
            package.join("entry_points.txt"),
            "[console_scripts]\nserver = example:main\n",
        )
        .unwrap();
        assert_eq!(
            installed_python_entry(root.path(), "example").unwrap(),
            "server"
        );
    }

    #[test]
    fn pinned_npx_is_prepared_and_remote_templates_are_not_guessed() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join(".mcp.json"),r#"{"mcpServers":{"pinned":{"command":"npx","args":["-y","@org/server@1.2.3","--token","fixture-secret"],"env":{"KEY":"fixture-secret"}}}}"#).unwrap();
        let recipe = discover(root.path()).unwrap().remove(0);
        assert_eq!(recipe.config["args"], json!(["--token", "fixture-secret"]));
        let preview = recipe.preparation.unwrap().preview();
        assert!(preview.contains("@org/server@1.2.3"));
        assert!(!preview.contains("fixture-secret"));
        assert!(registry(&json!({"name":"remote","remotes":[{"type":"streamable-http","url":"https://example.test/{tenant}"}]})).is_err());
    }

    #[test]
    fn explicit_bun_configuration_is_preserved_without_a_node_conversion() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("package.json"),
            r#"{"name":"mcp-bun-fixture","bin":"server.js"}"#,
        )
        .unwrap();
        fs::write(root.path().join("server.js"), "console.log(Bun.version);").unwrap();
        fs::write(root.path().join(".mcp.json"),r#"{"mcpServers":{"bun-fixture":{"command":"bun","args":["server.js"],"env":{},"active":true}}}"#).unwrap();
        let recipe = discover(root.path()).unwrap().remove(0);
        assert!(recipe.preparation.is_none());
        assert_eq!(recipe.config["command"], "bun");
        assert_eq!(recipe.config["args"], json!(["server.js"]));
        assert_eq!(recipe.config["active"], false);
    }

    #[test]
    fn explicit_registry_runtime_hints_are_never_silently_replaced() {
        let package = |registry: &str| json!({"name":"owned-fixture","packages":[{"registryType":registry,"identifier":"mcp-fixture","version":"1.2.3","transport":{"type":"stdio"}}]});
        assert!(registry(&package("npm")).is_ok());
        assert!(registry(&package("pypi")).is_ok());
        for hint in ["npx", "node", "nodejs"] {
            let mut metadata = package("npm");
            metadata["packages"][0]["runtimeHint"] = json!(hint);
            assert!(registry(&metadata).is_ok(), "{hint}");
        }
        for hint in ["uvx", "uv", "python"] {
            let mut metadata = package("pypi");
            metadata["packages"][0]["runtimeHint"] = json!(hint);
            assert!(registry(&metadata).is_ok(), "{hint}");
        }
        for (kind, hint) in [
            ("npm", "bun"),
            ("npm", "bunx"),
            ("npm", "deno"),
            ("pypi", "bun"),
            ("pypi", "npx"),
        ] {
            let mut metadata = package(kind);
            metadata["packages"][0]["runtimeHint"] = json!(hint);
            let error = registry(&metadata).unwrap_err();
            assert!(error.contains("preparación manual"));
        }
        let mut malformed = package("npm");
        malformed["packages"][0]["runtimeHint"] = Value::Null;
        assert!(registry(&malformed).is_err());
        let recipe=registry(&json!({"name":"rea-declared-metadata-fixture","packages":[{"registryType":"npm","identifier":"rea-agents","version":"6.4.0","runtimeHint":"npx","transport":{"type":"stdio"},"packageArguments":[{"type":"positional","value":"mcp"}]}]})).unwrap().remove(0);
        assert_eq!(recipe.config["command"], "node");
        assert_eq!(recipe.config["args"], json!(["mcp"]));
        assert!(recipe
            .preparation
            .unwrap()
            .preview()
            .contains("rea-agents@6.4.0"));
    }

    #[tokio::test]
    async fn private_fixture_bun_build_runs_with_real_node_and_preserves_source() {
        if runtime("bun").is_err() {
            return;
        }
        let node = runtime("node").expect(
            "The owned build fixture requires installed Node.js; Bun must not substitute it",
        );
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("fixture");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("package.json"),r#"{"name":"mcp-fixture","private":true,"bin":"dist/server.cjs","scripts":{"build":"bun build server.ts --target=node --format=cjs --outfile=dist/server.cjs"}}"#).unwrap();
        fs::write(
            project.join("server.ts"),
            "import { versions, argv } from 'node:process'; console.log(JSON.stringify({ runtime: versions.bun ? 'bun' : 'node', argument: argv[2] }));",
        )
        .unwrap();
        let source_before = source(&project).unwrap().files;
        let mut recipe = discover(&project).unwrap().remove(0);
        recipe.config["args"]
            .as_array_mut()
            .unwrap()
            .push(json!("owned-fixture-argument"));
        let output = prepare(&recipe, &root.path().join("installed"))
            .await
            .unwrap();
        assert_eq!(output["active"], false);
        assert_eq!(
            Path::new(output["command"].as_str().unwrap())
                .canonicalize()
                .unwrap(),
            node
        );
        assert_eq!(output["args"].as_array().unwrap().len(), 2);
        assert_eq!(output["args"][1], "owned-fixture-argument");
        let entry = output["args"][0].as_str().unwrap();
        assert!(Path::new(entry).is_file());
        assert!(Path::new(entry)
            .canonicalize()
            .unwrap()
            .starts_with(root.path().canonicalize().unwrap().join("installed")));
        assert!(!project.join("node_modules").exists());
        assert!(!project.join("dist").exists());
        let mut command = Command::new(output["command"].as_str().unwrap());
        command
            .args(
                output["args"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|arg| arg.as_str().unwrap()),
            )
            .env_clear()
            .current_dir(root.path())
            .kill_on_drop(true);
        if let Some(system_root) = std::env::var_os("SYSTEMROOT") {
            command.env("SYSTEMROOT", system_root);
        }
        let execution = tokio::time::timeout(Duration::from_secs(10), command.output())
            .await
            .expect("The owned Node fixture timed out")
            .expect("The installed Node executable could not run the fixture");
        assert!(
            execution.status.success(),
            "Node fixture failed: {}",
            String::from_utf8_lossy(&execution.stderr)
        );
        let result: Value = serde_json::from_slice(&execution.stdout).unwrap();
        assert_eq!(
            result,
            json!({"runtime":"node","argument":"owned-fixture-argument"})
        );
        assert_eq!(source(&project).unwrap().files, source_before);
    }

    #[test]
    fn mixed_configs_and_manifest_alternatives_keep_valid_recipes_and_report_the_rest() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join(".vscode")).unwrap();
        fs::write(root.path().join(".mcp.json"),r#"{"mcpServers":{"valid-local":{"command":"owned-local-command","args":[],"env":{"TOKEN":"fixture-secret"}},"broken":null},"servers":{"valid-http":{"type":"streamable-http","url":"https://example.test/mcp"}}}"#).unwrap();
        fs::write(root.path().join(".vscode/mcp.json"), "invalid JSON").unwrap();
        fs::write(root.path().join("server.json"),r#"{"name":"org/generic-mcp","packages":[{"registryType":"npm","identifier":"@owned-fixture/mcp","version":"2.3.4","runtimeHint":"npx","transport":{"type":"stdio"}},{"registryType":"npm","identifier":"@owned-fixture/manual","version":"2.3.4","runtimeHint":"bun","transport":{"type":"stdio"}}],"remotes":[{"type":"streamable-http","url":"https://example.test/remote"}]}"#).unwrap();
        let report = discover_report(root.path()).unwrap();
        assert_eq!(report.recipes.len(), 4);
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.contains("broken")));
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.contains(".vscode/mcp.json")));
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.contains("runtimeHint")));
        assert!(!report.warnings.join("\n").contains("fixture-secret"));
        assert!(report
            .recipes
            .iter()
            .all(|recipe| recipe.config["active"] == false));
        assert_eq!(
            report
                .recipes
                .iter()
                .find(|recipe| recipe.name == "valid-local")
                .unwrap()
                .config["env"]["TOKEN"],
            "fixture-secret"
        );
    }

    #[test]
    fn invalid_recipes_are_not_importable_and_diagnostics_are_bounded() {
        let root = tempfile::tempdir().unwrap();
        let mut entries = Map::new();
        for index in 0..300 {
            entries.insert(format!("invalid-{index}"), Value::Null);
        }
        fs::write(
            root.path().join(".mcp.json"),
            json!({"mcpServers":entries}).to_string(),
        )
        .unwrap();
        let report = discover_report(root.path()).unwrap();
        assert!(report.recipes.is_empty());
        assert!(report.warnings.len() <= 200);
        assert!(discover(root.path()).is_err());
    }
}
