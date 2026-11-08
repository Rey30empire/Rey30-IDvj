use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::recipes::{self, McpRecipe};
use crate::core::agent::subagent;
use tauri_plugin_agent_tools::{skills, workspace};

const MAX_PLANS: usize = 4;
const MAX_RESOURCES: usize = 600;
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PLAN_BYTES: usize = 64 * 1024 * 1024;
const MAX_BUNDLE_FILES: usize = 512;
const MAX_SCAN_DEPTH: usize = 12;
const MAX_AGENT_NAME: usize = 64;
const TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub description: String,
    pub source: String,
    pub source_path: String,
    pub preview: String,
    pub warnings: Vec<String>,
    pub conflict: bool,
    pub importable: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct ImportPlan {
    pub id: String,
    pub candidates: Vec<Candidate>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct Installed {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Default, Serialize)]
pub struct ImportReceipt {
    pub installed: Vec<Installed>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone)]
enum Payload {
    Bundle(Vec<(PathBuf, Vec<u8>)>),
    Agent(Vec<u8>),
    Mcp(Box<McpRecipe>),
}

#[derive(Clone)]
struct Entry {
    meta: Candidate,
    payload: Payload,
}

struct StoredPlan {
    data: PathBuf,
    created: Instant,
    entries: Vec<Entry>,
    warnings: Vec<String>,
}

static PLANS: OnceLock<Mutex<HashMap<String, StoredPlan>>> = OnceLock::new();
static COMMIT: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

fn plans() -> &'static Mutex<HashMap<String, StoredPlan>> {
    PLANS.get_or_init(Default::default)
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn slug(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars().take(90) {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let value = out.trim_matches('-');
    if value.is_empty() {
        "recurso".into()
    } else {
        value.into()
    }
}

fn imported_skills_dir(data: &Path) -> PathBuf {
    skills::skills_dir(&workspace::permanent_store(data))
}

fn agent_location(path: &Path) -> bool {
    path.ancestors().skip(1).any(|parent| {
        parent
            .file_name()
            .is_some_and(|name| name == "agents" || name == "subagents")
    })
}

fn copilot_agent(path: &Path) -> bool {
    if !path.extension().is_some_and(|extension| extension == "md") {
        return false;
    }
    path.file_name()
        .is_some_and(|name| name.to_string_lossy().ends_with(".agent.md"))
        || path.ancestors().skip(1).any(|parent| {
            parent.file_name().is_some_and(|name| name == "agents")
                && parent.parent().is_some_and(|root| {
                    root.file_name()
                        .is_some_and(|name| name == ".github" || name == ".copilot")
                })
        })
}

fn agent_definition(path: &Path, text: &str) -> Result<subagent::SubagentDefinition, String> {
    if !copilot_agent(path) {
        return subagent::parse_plugin_agent(text)
            .ok_or("El agente necesita frontmatter name válido.".into());
    }
    let (yaml, body) = crate::core::agent::skills::split_frontmatter(text);
    if body.trim().is_empty() {
        return Err("El agente no contiene instrucciones.".into());
    }
    let mut fields: serde_yaml::Mapping = match yaml {
        Some(yaml) => serde_yaml::from_str(&yaml)
            .map_err(|_| "El frontmatter del agente no es un mapa YAML válido.")?,
        None => serde_yaml::Mapping::new(),
    };
    let name_key = serde_yaml::Value::String("name".into());
    if let Some(name) = fields.get(&name_key) {
        if !name.as_str().is_some_and(|name| !name.trim().is_empty()) {
            return Err("El nombre declarado del agente no es una cadena válida.".into());
        }
    } else {
        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or("El agente no tiene un nombre de archivo compatible.")?;
        fields.insert(
            name_key,
            serde_yaml::Value::String(stem.strip_suffix(".agent").unwrap_or(stem).into()),
        );
    }
    let yaml = serde_yaml::to_string(&fields)
        .map_err(|_| "No se pudo normalizar el frontmatter del agente.")?;
    subagent::parse_plugin_agent(&format!("---\n{yaml}---\n{body}"))
        .ok_or("El perfil del agente contiene campos no compatibles.".into())
}

fn link(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| {
        if m.file_type().is_symlink() {
            return true;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if m.file_attributes() & 0x400 != 0 {
                return true;
            }
        }
        false
    })
}

fn safe_existing(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Elige una ruta absoluta.".into());
    }
    let mut part = PathBuf::new();
    for c in path.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return Err("No se admiten rutas con '..'.".into());
        }
        part.push(c);
        if matches!(c, std::path::Component::Prefix(_)) {
            continue;
        }
        if link(&part) {
            return Err(format!(
                "No se siguen enlaces o junctions: {}",
                part.display()
            ));
        }
    }
    path.canonicalize()
        .map_err(|e| format!("No se puede abrir {}: {e}", path.display()))
}

pub(crate) fn secure_dir(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("El destino debe ser absoluto.".into());
    }
    let mut part = PathBuf::new();
    for c in path.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return Err("Destino con '..' no permitido.".into());
        }
        part.push(c);
        if matches!(c, std::path::Component::Prefix(_)) {
            continue;
        }
        if link(&part) {
            return Err(format!("Destino con enlace o junction: {}", part.display()));
        }
        if part.exists() {
            if !part.is_dir() {
                return Err("El destino contiene un archivo donde se esperaba una carpeta.".into());
            }
        } else {
            fs::create_dir(&part).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn resource_markdown(path: &Path) -> bool {
    let file = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    if matches!(
        file.as_str(),
        "readme.md" | "license.md" | "notice.md" | "changelog.md"
    ) {
        return false;
    }
    matches!(
        file.as_str(),
        "skill.md"
            | "agents.md"
            | "claude.md"
            | "gemini.md"
            | ".cursorrules"
            | ".windsurfrules"
            | ".clinerules"
            | "copilot-instructions.md"
    ) || (path.extension().is_some_and(|e| e == "md" || e == "mdc")
        && path.parent().is_some_and(|p| {
            p.file_name().is_some_and(|n| {
                matches!(
                    n.to_str(),
                    Some("skills" | "agents" | "subagents" | "commands" | "rules")
                )
            })
        }))
        || copilot_agent(path)
        || (path.extension().is_some_and(|extension| extension == "md") && agent_location(path))
        || (file.ends_with(".instructions.md")
            && path.ancestors().skip(1).any(|parent| {
                parent
                    .file_name()
                    .is_some_and(|name| name == "instructions")
                    && parent
                        .parent()
                        .is_some_and(|root| root.file_name().is_some_and(|name| name == ".github"))
            }))
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    if link(path) {
        return Err("No se siguen enlaces de archivos.".into());
    }
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "Archivo no regular o mayor de 8 MiB: {}",
            path.display()
        ));
    }
    fs::read(path).map_err(|e| e.to_string())
}

fn bundle(root: &Path) -> Result<Vec<(PathBuf, Vec<u8>)>, String> {
    fn visit(
        root: &Path,
        dir: &Path,
        out: &mut Vec<(PathBuf, Vec<u8>)>,
        bytes: &mut usize,
        depth: usize,
    ) -> Result<(), String> {
        if depth > 12 {
            return Err("Skill con demasiados niveles de carpetas.".into());
        }
        for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let path = item.path();
            if link(&path) {
                return Err("La skill contiene enlaces; revísala antes de importarla.".into());
            }
            let name = item.file_name().to_string_lossy().to_string();
            if matches!(
                name.as_str(),
                ".git" | "node_modules" | ".venv" | "__pycache__" | "target"
            ) {
                continue;
            }
            if path.is_dir() {
                visit(root, &path, out, bytes, depth + 1)?;
            } else {
                let data = read_bytes(&path)?;
                *bytes += data.len();
                if *bytes > MAX_PLAN_BYTES || out.len() >= MAX_BUNDLE_FILES {
                    return Err("La skill supera la cuota de importación.".into());
                }
                out.push((
                    path.strip_prefix(root)
                        .map_err(|e| e.to_string())?
                        .to_path_buf(),
                    data,
                ));
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    visit(root, root, &mut out, &mut 0, 0)?;
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

struct Scanner {
    data: PathBuf,
    entries: Vec<Entry>,
    warnings: Vec<String>,
    seen: HashSet<String>,
    reserved: HashSet<String>,
    bytes: usize,
    visited: usize,
}

impl Scanner {
    fn warn(&mut self, warning: String) {
        if self.warnings.len() < 200 {
            self.warnings.push(warning.chars().take(1024).collect());
        }
    }
    fn new(data: PathBuf) -> Self {
        Self {
            data,
            entries: vec![],
            warnings: vec![],
            seen: HashSet::new(),
            reserved: HashSet::new(),
            bytes: 0,
            visited: 0,
        }
    }

    fn destination(&self, kind: &str, name: &str) -> PathBuf {
        match kind {
            "agent" => subagent::desktop_subagents_dir(&self.data).join(format!("{name}.toml")),
            "mcp" => self.data.join("mcp_config.json"),
            _ => imported_skills_dir(&self.data).join(name),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn add(
        &mut self,
        kind: &str,
        proposed: &str,
        description: &str,
        source: &str,
        path: &Path,
        preview: String,
        mut warnings: Vec<String>,
        payload: Payload,
    ) {
        if self.entries.len() >= MAX_RESOURCES {
            return;
        }
        let key = match &payload {
            Payload::Mcp(recipe) => format!(
                "mcp:{proposed}:{}:{}",
                digest(recipe.config.to_string().as_bytes()),
                recipe
                    .preparation
                    .as_ref()
                    .map(|p| p.preview())
                    .unwrap_or_default()
            ),
            _ => format!("{kind}:{}:{proposed}", path.display()),
        };
        if !self.seen.insert(key.clone()) {
            return;
        }
        let mut base = slug(proposed);
        if kind == "agent" {
            base.truncate(MAX_AGENT_NAME);
        }
        if kind != "mcp" && skills::safe_stem(&base).is_err() {
            base = format!("recurso-{base}");
        }
        if kind == "agent" {
            base.truncate(MAX_AGENT_NAME);
        }
        let mut name = base.clone();
        let mut conflict = false;
        let existing_mcp = if kind == "mcp" {
            read_mcp(&self.data).ok()
        } else {
            None
        };
        for n in 1..10000 {
            let scope = format!(
                "{}:{name}",
                if kind == "instruction" { "skill" } else { kind }
            );
            let exists = self.reserved.contains(&scope)
                || if kind == "mcp" {
                    existing_mcp
                        .as_ref()
                        .and_then(|v| v.get("mcpServers"))
                        .and_then(Value::as_object)
                        .is_some_and(|m| m.contains_key(&name))
                } else {
                    self.destination(kind, &name).exists()
                        || (kind != "agent"
                            && imported_skills_dir(&self.data)
                                .join(format!("{name}.md"))
                                .exists())
                };
            if !exists {
                self.reserved.insert(scope);
                break;
            }
            conflict = true;
            let suffix = format!("-importado-{n}");
            let length = if kind == "agent" {
                base.len().min(MAX_AGENT_NAME - suffix.len())
            } else {
                base.len()
            };
            name = format!("{}{suffix}", &base[..length]);
        }
        if conflict {
            warnings.push(format!(
                "Ya existe un recurso llamado {base}; se creará {name} sin reemplazarlo."
            ));
        }
        let size = match &payload {
            Payload::Bundle(f) => f.iter().map(|(_, b)| b.len()).sum(),
            Payload::Agent(b) => b.len(),
            Payload::Mcp(_) => 0,
        };
        if self.bytes + size > MAX_PLAN_BYTES {
            self.warn("Se alcanzó la cuota de 64 MiB. Selecciona una carpeta más concreta.".into());
            return;
        }
        self.bytes += size;
        self.entries.push(Entry {
            meta: Candidate {
                id: digest(key.as_bytes()),
                kind: kind.into(),
                name,
                description: description.into(),
                source: source.into(),
                source_path: path.display().to_string(),
                preview,
                warnings,
                conflict,
                importable: true,
            },
            payload,
        });
    }

    fn inspect_file(&mut self, path: &Path, source: &str) -> Result<(), String> {
        let file = path.file_name().unwrap_or_default().to_string_lossy();
        let bytes = read_bytes(path)?;
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| "El recurso debe contener texto UTF-8.".to_string())?;
        if file.eq_ignore_ascii_case("SKILL.md") {
            let root = path.parent().ok_or("Skill sin carpeta")?;
            let name = root.file_name().unwrap_or_default().to_string_lossy();
            let parsed = tauri_plugin_agent_tools::skills::parse(text);
            self.add(
                "skill",
                &name,
                parsed.description.as_deref().unwrap_or("Skill importada"),
                source,
                path,
                parsed.body.chars().take(4000).collect(),
                vec!["Los scripts se copian como archivos y no se ejecutan al importar.".into()],
                Payload::Bundle(bundle(root)?),
            );
        } else if path.extension().is_some_and(|e| e == "md")
            && !file.eq_ignore_ascii_case("AGENTS.md")
            && (agent_location(path) || copilot_agent(path))
        {
            let def = agent_definition(path, text)?;
            let policy = def
                .allowed_tools
                .as_ref()
                .map(|t| {
                    if t.is_empty() {
                        "Sin herramientas: política externa no traducida o restricción explícita."
                            .into()
                    } else {
                        format!("Herramientas permitidas: {}", t.join(", "))
                    }
                })
                .unwrap_or_else(|| {
                    "Hereda las herramientas que permita el runtime; no altera sus aprobaciones."
                        .into()
                });
            let mut value = json!({"name":def.name,"description":def.description,"system_prompt":def.system_prompt});
            if let Some(tools) = def.allowed_tools {
                value["allowed_tools"] = json!(tools);
            }
            if let Some(model) = def.model {
                value["model"] = json!(model);
            }
            let toml = toml::to_string(&value).map_err(|e| e.to_string())?;
            self.add("agent", &def.name, &def.description, source, path, format!("{policy}\n\n{}",def.system_prompt.chars().take(4000).collect::<String>()), vec!["Preparado para el runtime de agentes/Cowork. El chat clásico no ejecuta subagentes; no se habilita Cowork ni se cambian sus permisos al importar.".into()], Payload::Agent(toml.into_bytes()));
        } else if path.extension().is_some_and(|e| e == "toml") && agent_location(path) {
            let value: toml::Value = toml::from_str(text).map_err(|e| e.to_string())?;
            let name = value
                .get("name")
                .and_then(toml::Value::as_str)
                .or_else(|| path.file_stem().and_then(|n| n.to_str()))
                .ok_or("Agente sin nombre")?;
            let prompt = value
                .get("system_prompt")
                .or_else(|| value.get("developer_instructions"))
                .and_then(toml::Value::as_str)
                .ok_or("Agente sin instrucciones compatibles")?;
            let mut normalized = json!({"name":name,"description":value.get("description").and_then(toml::Value::as_str).unwrap_or("Agente importado"),"system_prompt":prompt});
            let mut warnings = vec![
                "Agente preparado para Cowork; no cambia el modelo seleccionado del chat.".into(),
            ];
            if let Some(tools) = value.get("allowed_tools") {
                if !tools
                    .as_array()
                    .is_some_and(|a| a.iter().all(toml::Value::is_str))
                {
                    return Err("allowed_tools debe ser una lista de nombres.".into());
                }
                normalized["allowed_tools"] =
                    serde_json::to_value(tools).map_err(|e| e.to_string())?;
            }
            if value.as_table().is_some_and(|t| {
                t.keys().any(|k| {
                    let k = k.to_ascii_lowercase();
                    k.contains("sandbox")
                        || k.contains("permission")
                        || k.contains("approval")
                        || k.contains("disallowed")
                        || k.contains("readonly")
                        || k.contains("read_only")
                })
            }) {
                normalized["allowed_tools"] = json!([]);
                warnings.push("Las restricciones de este editor no se traducen: agente importado sin herramientas. Revisa su política antes de habilitarlas.".into());
            }
            let policy = normalized
                .get("allowed_tools")
                .map(|t| format!("Herramientas permitidas: {t}"))
                .unwrap_or_else(|| "Hereda la política del runtime de agentes.".into());
            self.add(
                "agent",
                name,
                normalized["description"].as_str().unwrap_or_default(),
                source,
                path,
                format!(
                    "{policy}\n\n{}",
                    prompt.chars().take(4000).collect::<String>()
                ),
                warnings,
                Payload::Agent(
                    toml::to_string(&normalized)
                        .map_err(|e| e.to_string())?
                        .into_bytes(),
                ),
            );
        } else if path.extension().is_some_and(|e| e == "md" || e == "mdc")
            || resource_markdown(path)
        {
            let stem = path.file_stem().unwrap_or_default().to_string_lossy();
            let parsed = tauri_plugin_agent_tools::skills::parse(text);
            let content = format!(
                "---\nname: {}\ndescription: {}\n---\n\n{}",
                slug(&stem),
                serde_json::to_string(&format!("Instrucciones importadas de {source}: {file}"))
                    .unwrap_or_default(),
                parsed.body
            );
            self.add("instruction", &stem, "Instrucciones disponibles como skill de invocación explícita", source, path, parsed.body.chars().take(4000).collect(), vec!["Las reglas se convierten a una skill; sus condiciones automáticas específicas del editor no se activan.".into()], Payload::Bundle(vec![(PathBuf::from("SKILL.md"), content.into_bytes())]));
        }
        Ok(())
    }

    fn walk(&mut self, root: &Path, source: &str, depth: usize) {
        if depth > MAX_SCAN_DEPTH {
            let warning="Se alcanzó el límite de profundidad de exploración; elige una subcarpeta para ver los recursos restantes.";
            if !self.warnings.iter().any(|existing| existing == warning) {
                self.warn(warning.into());
            }
            return;
        }
        if self.visited >= 20000 || self.entries.len() >= MAX_RESOURCES {
            return;
        }
        if link(root) {
            self.warn(format!("Enlace omitido: {}", root.display()));
            return;
        }
        self.visited += 1;
        if root.is_file() {
            let file = root.file_name().unwrap_or_default().to_string_lossy();
            if resource_markdown(root)
                || (root.extension().is_some_and(|e| e == "toml") && agent_location(root))
            {
                if let Err(e) = self.inspect_file(root, source) {
                    self.warn(format!("{}: {e}", root.display()));
                }
            }
            if file.ends_with(".json") || file == "config.toml" || file == "pyproject.toml" {
                self.inspect_recipes(root, source);
            }
            return;
        }
        let own_skill = root.join("SKILL.md").is_file();
        if own_skill {
            if let Err(e) = self.inspect_file(&root.join("SKILL.md"), source) {
                self.warn(format!("{}: {e}", root.display()));
            }
        }
        let Ok(children) = fs::read_dir(root) else {
            return;
        };
        let mut paths: Vec<_> = children.flatten().map(|e| e.path()).collect();
        paths.sort();
        for path in paths {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if own_skill && name == "SKILL.md" {
                continue;
            }
            if matches!(
                name.as_ref(),
                ".git"
                    | "node_modules"
                    | "target"
                    | "dist"
                    | "build"
                    | "artifacts"
                    | ".venv"
                    | "venv"
                    | "__pycache__"
                    | ".yarn"
                    | "cache"
                    | "logs"
                    | "memories"
                    | "sessions"
            ) {
                continue;
            }
            self.walk(&path, source, depth + 1);
        }
    }

    fn inspect_recipes(&mut self, root: &Path, source: &str) {
        match recipes::discover_report(root) {
            Ok(report) => {
                for warning in report.warnings {
                    self.warn(format!("{}: {warning}", root.display()));
                }
                for recipe in report.recipes {
                    let name = recipe.name.clone();
                    let description = recipe.description.clone();
                    let preview = recipe
                        .preparation
                        .as_ref()
                        .map(|p| p.preview())
                        .unwrap_or_else(|| mcp_preview(&recipe.config));
                    self.add(
                        "mcp",
                        &name,
                        &description,
                        source,
                        root,
                        preview,
                        recipe.warnings.clone(),
                        Payload::Mcp(Box::new(recipe)),
                    );
                }
            }
            Err(e) => self.warn(format!("{}: {e}", root.display())),
        }
    }

    fn editor(&mut self, root: &Path, source: &str) {
        for dir in [
            "skills",
            "agents",
            "subagents",
            "rules",
            "commands",
            "instructions",
        ] {
            if root.join(dir).is_dir() {
                self.walk(&root.join(dir), source, 0);
            }
        }
        for file in [
            "mcp.json",
            ".mcp.json",
            "mcp_config.json",
            "config.toml",
            "AGENTS.md",
            "CLAUDE.md",
            "GEMINI.md",
            ".cursorrules",
            ".windsurfrules",
            ".clinerules",
            "copilot-instructions.md",
        ] {
            if root.join(file).is_file() {
                self.walk(&root.join(file), source, 0);
            }
        }
    }

    fn finish(mut self) -> Result<ImportPlan, String> {
        if self.visited >= 20000 || self.entries.len() >= MAX_RESOURCES {
            self.warnings.push("Se alcanzó el límite de exploración; elige una carpeta más concreta para ver el resto.".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let view = ImportPlan {
            id: id.clone(),
            candidates: self.entries.iter().map(|e| e.meta.clone()).collect(),
            warnings: self.warnings.clone(),
        };
        let mut saved = plans().lock().map_err(|_| "Importador ocupado")?;
        saved.retain(|_, p| p.created.elapsed() < TTL);
        if saved.len() >= MAX_PLANS {
            if let Some(oldest) = saved
                .iter()
                .min_by_key(|(_, p)| p.created)
                .map(|(k, _)| k.clone())
            {
                saved.remove(&oldest);
            }
        }
        saved.insert(
            id,
            StoredPlan {
                data: self.data,
                created: Instant::now(),
                entries: self.entries,
                warnings: self.warnings,
            },
        );
        Ok(view)
    }
}

pub fn scan(
    data: PathBuf,
    home: Option<PathBuf>,
    project: Option<PathBuf>,
    selected: Option<PathBuf>,
) -> Result<ImportPlan, String> {
    let mut scan = Scanner::new(data);
    if let Some(path) = selected {
        let path = safe_existing(&path)?;
        if path.is_file() && path.extension().is_some_and(|e| e == "md" || e == "mdc") {
            scan.inspect_file(&path, "Archivo seleccionado")?;
        } else {
            scan.walk(&path, "Carpeta o archivo seleccionado", 0);
        }
        if path.is_dir() {
            scan.inspect_recipes(&path, "Carpeta seleccionada");
        }
    } else {
        if let Some(home) = home {
            for (dir, label) in [
                (".agents", "Skills compartidas"),
                (".codex", "Codex"),
                (".claude", "Claude Code"),
                (".cursor", "Cursor"),
                (".codeium/windsurf", "Windsurf"),
                (".gemini", "Gemini CLI"),
                (".continue", "Continue"),
                (".copilot", "GitHub Copilot"),
            ] {
                scan.editor(&home.join(dir), label);
            }
            for file in [
                home.join(".claude.json"),
                home.join(".codeium/windsurf/mcp_config.json"),
            ] {
                if file.is_file() {
                    scan.walk(&file, "Configuración de editor", 0);
                }
            }
        }
        if let Some(root) = dirs::config_dir() {
            for (path,label) in [("Code/User/mcp.json","VS Code"),("Cursor/User/mcp.json","Cursor"),("Claude/claude_desktop_config.json","Claude Desktop"),("Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json","Cline"),("Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json","Roo Code")] {
                let path = root.join(path);
                if path.is_file() { scan.walk(&path,label,0); }
            }
        }
        if let Some(project) = project {
            let project = safe_existing(&project)?;
            scan.editor(&project, "Proyecto");
            for dir in [
                ".agents",
                ".codex",
                ".claude",
                ".cursor",
                ".windsurf",
                ".gemini",
                ".vscode",
                ".github",
            ] {
                scan.editor(&project.join(dir), "Editor del proyecto");
            }
        }
    }
    scan.finish()
}

pub fn scan_repository(
    data: PathBuf,
    root: &Path,
    repository: &str,
    sha: &str,
) -> Result<ImportPlan, String> {
    let mut scan = Scanner::new(data);
    scan.walk(
        &safe_existing(root)?,
        &format!("GitHub {repository}@{sha}"),
        0,
    );
    scan.inspect_recipes(root, &format!("GitHub {repository}@{sha}"));
    scan.finish()
}

pub(crate) fn plan_recipes(
    data: PathBuf,
    source: &str,
    recipes: Vec<McpRecipe>,
    warnings: Vec<String>,
) -> Result<ImportPlan, String> {
    let mut scan = Scanner::new(data);
    for warning in warnings {
        scan.warn(warning);
    }
    for recipe in recipes {
        let mut preview = recipe
            .preparation
            .as_ref()
            .map(|preparation| preparation.preview())
            .unwrap_or_else(|| mcp_preview(&recipe.config));
        if let Some(url) = recipe.config["url"]
            .as_str()
            .and_then(|value| url::Url::parse(value).ok())
        {
            let mut destination = url;
            destination.set_query(None);
            destination.set_fragment(None);
            let _ = destination.set_username("");
            let _ = destination.set_password(None);
            preview = format!("Destino: {destination}\n{preview}");
        }
        let name = recipe.name.clone();
        let description = recipe.description.clone();
        scan.add(
            "mcp",
            &name,
            &description,
            source,
            Path::new(source),
            preview,
            recipe.warnings.clone(),
            Payload::Mcp(Box::new(recipe)),
        );
    }
    scan.finish()
}

fn mcp_preview(config: &Value) -> String {
    let command = config
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or("Conexión HTTP/SSE");
    let command = Path::new(command)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let argc = config
        .get("args")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let vars = config
        .get("env")
        .and_then(Value::as_object)
        .map(|v| v.keys().cloned().collect::<Vec<_>>().join(", "))
        .unwrap_or_default();
    format!("Comando: {command}\nArgumentos: {argc} (valores ocultos para no revelar credenciales)\nVariables: {vars} (valores ocultos)\nSe añadirá desactivado. Conecta y comprueba sus herramientas desde MCP.")
}

fn read_mcp(data: &Path) -> Result<Value, String> {
    let path = data.join("mcp_config.json");
    if !path.exists() {
        return Ok(json!({"mcpServers":{}}));
    }
    let root = safe_existing(&path)?;
    let value: Value = serde_json::from_slice(&read_bytes(&root)?)
        .map_err(|_| "La configuración MCP existente no es JSON válido; no se modificó.")?;
    if !value.is_object() || !value.get("mcpServers").is_some_and(Value::is_object) {
        return Err(
            "La configuración MCP existente no tiene un mapa mcpServers válido; no se modificó."
                .into(),
        );
    }
    Ok(value)
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        secure_dir(parent)?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("No se reemplazó {}: {e}", path.display()))?;
    if let Err(e) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(e.to_string());
    }
    Ok(())
}

fn commit_bundle(
    data: &Path,
    entry: &Entry,
    files: &[(PathBuf, Vec<u8>)],
) -> Result<PathBuf, String> {
    let parent = imported_skills_dir(data);
    secure_dir(&parent)?;
    let dest = parent.join(&entry.meta.name);
    // Exclusive directory creation reserves ownership; rollback only removes this directory.
    fs::create_dir(&dest).map_err(|e| format!("El destino ya existe o no es escribible: {e}"))?;
    let result = (|| {
        for (rel, bytes) in files {
            if !rel
                .components()
                .all(|c| matches!(c, std::path::Component::Normal(_)))
            {
                return Err("Ruta de recurso no válida".into());
            }
            write_new(&dest.join(rel), bytes)?;
        }
        let provenance = json!({"source":entry.meta.source,"sourcePath":entry.meta.source_path,"snapshotFiles":files.iter().map(|(p,b)|json!({"path":p,"sha256":digest(b)})).collect::<Vec<_>>()});
        let metadata = if dest.join(".rey30-import.json").exists() {
            dest.join(format!(".rey30-import-{}.json", uuid::Uuid::new_v4()))
        } else {
            dest.join(".rey30-import.json")
        };
        write_new(
            &metadata,
            serde_json::to_string_pretty(&provenance)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        )?;
        Ok(dest.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&dest);
    }
    result
}

fn merge_mcp(data: &Path, name: &str, mut config: Value) -> Result<PathBuf, String> {
    secure_dir(data)?;
    let dest = data.join("mcp_config.json");
    let before = if dest.exists() {
        safe_existing(&dest)?;
        Some(read_bytes(&dest)?)
    } else {
        None
    };
    let mut current = if let Some(bytes) = &before {
        serde_json::from_slice::<Value>(bytes)
            .map_err(|_| "La configuración MCP existente no es JSON válido; no se modificó.")?
    } else {
        json!({"mcpServers":{}})
    };
    if !current.is_object() {
        return Err("Configuración MCP no válida; no se modificó.".into());
    }
    let servers = current["mcpServers"]
        .as_object_mut()
        .ok_or("Mapa MCP no válido")?;
    if servers.contains_key(name) {
        return Err(
            "El nombre MCP ya existe. Vuelve a explorar para generar un nombre nuevo.".into(),
        );
    }
    if !config.is_object() {
        return Err("Receta MCP no válida".into());
    }
    config["active"] = json!(false);
    config["official"] = json!(false);
    servers.insert(name.into(), config);
    let temp = data.join(format!(".mcp-import-{}.json", uuid::Uuid::new_v4()));
    write_new(
        &temp,
        serde_json::to_string_pretty(&current)
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )?;
    // Preserve a recoverable copy before the atomic replacement, and abort if another writer won.
    let current_bytes = if dest.exists() {
        Some(read_bytes(&dest)?)
    } else {
        None
    };
    if before != current_bytes {
        let _ = fs::remove_file(&temp);
        return Err(
            "La configuración MCP cambió durante la importación. Vuelve a explorar.".into(),
        );
    }
    if let Some(bytes) = before {
        write_new(
            &data.join(format!(
                "mcp_config.before-import-{}.json",
                uuid::Uuid::new_v4()
            )),
            &bytes,
        )?;
    }
    fs::rename(&temp, &dest).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("No se pudo publicar la configuración MCP: {e}")
    })?;
    Ok(dest)
}

pub async fn commit(
    plan_id: &str,
    ids: &[String],
    expected_data: &Path,
) -> Result<ImportReceipt, String> {
    let _guard = COMMIT.get_or_init(Default::default).lock().await;
    let plan = {
        let mut saved = plans().lock().map_err(|_| "Importador ocupado")?;
        let plan = saved
            .get(plan_id)
            .ok_or("La vista previa caducó. Vuelve a explorar.")?;
        if plan.created.elapsed() >= TTL || plan.data != expected_data {
            return Err("La vista previa caducó o cambió la carpeta de datos.".into());
        }
        if ids.is_empty()
            || ids
                .iter()
                .any(|id| !plan.entries.iter().any(|e| &e.meta.id == id))
        {
            return Err("Selecciona únicamente recursos de la vista previa actual.".into());
        }
        saved
            .remove(plan_id)
            .ok_or("La vista previa ya se utilizó.")?
    };
    let selected: HashSet<_> = ids.iter().collect();
    let mut receipt = ImportReceipt {
        warnings: plan.warnings,
        ..Default::default()
    };
    for entry in plan
        .entries
        .into_iter()
        .filter(|e| selected.contains(&e.meta.id))
    {
        let result = match &entry.payload {
            Payload::Bundle(files) => commit_bundle(&plan.data, &entry, files),
            Payload::Agent(bytes) => {
                let mut parsed: toml::Value =
                    toml::from_str(std::str::from_utf8(bytes).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                parsed["name"] = toml::Value::String(entry.meta.name.clone());
                let path = subagent::desktop_subagents_dir(&plan.data)
                    .join(format!("{}.toml", entry.meta.name));
                write_new(
                    &path,
                    toml::to_string(&parsed)
                        .map_err(|e| e.to_string())?
                        .as_bytes(),
                )
                .map(|_| path)
            }
            Payload::Mcp(recipe) => {
                match recipes::prepare(recipe, &plan.data.join("integration-packages")).await {
                    Ok(config) => merge_mcp(&plan.data, &entry.meta.name, config),
                    Err(e) => Err(e),
                }
            }
        };
        match result {
            Ok(path) => receipt.installed.push(Installed {
                id: entry.meta.id,
                kind: entry.meta.kind,
                name: entry.meta.name,
                path: path.display().to_string(),
            }),
            Err(e) => receipt.errors.push(format!("{}: {e}", entry.meta.name)),
        }
    }
    Ok(receipt)
}

pub async fn configure_catalog_credentials(
    data: &Path,
    name: &str,
    values: Vec<super::credentials::CredentialValue>,
) -> Result<(), String> {
    let _guard = COMMIT.get_or_init(Default::default).lock().await;
    let dest = data.join("mcp_config.json");
    safe_existing(&dest)?;
    let before = read_bytes(&dest)?;
    let mut current = read_mcp(data)?;
    let config = current["mcpServers"]
        .get(name)
        .ok_or("El servidor MCP ya no existe.")?;
    let updated = super::credentials::save(data, name, config, values)?;
    current["mcpServers"][name] = updated;
    let temp = data.join(format!(".mcp-credentials-{}.json", uuid::Uuid::new_v4()));
    write_new(
        &temp,
        &serde_json::to_vec_pretty(&current)
            .map_err(|_| "No se pudo preparar la configuración MCP.")?,
    )?;
    if read_bytes(&dest)? != before {
        let _ = fs::remove_file(&temp);
        return Err(
            "La configuración MCP cambió. Vuelve a intentarlo sin reemplazar otros cambios.".into(),
        );
    }
    fs::rename(&temp, &dest).map_err(|_| "No se pudo guardar la configuración MCP.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let root = std::env::temp_dir().join(format!("rey30-import-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    #[tokio::test]
    async fn preview_is_inert_and_commit_preserves_source_and_collisions() {
        let root = temp();
        let source = root.join("source/skills/demo");
        fs::create_dir_all(source.join("scripts")).unwrap();
        fs::write(
            source.join("SKILL.md"),
            "---\nname: demo\ndescription: QA\n---\nResponde IMPORTADO.",
        )
        .unwrap();
        fs::write(
            source.join("scripts/helper.py"),
            "raise RuntimeError('must not run')",
        )
        .unwrap();
        let data = root.join("data");
        let store = workspace::permanent_store(&data);
        let skill_dir = skills::skills_dir(&store);
        fs::create_dir_all(skill_dir.join("demo")).unwrap();
        fs::write(skill_dir.join("demo/SKILL.md"), "existing").unwrap();
        let plan = scan(data.clone(), None, None, Some(root.join("source"))).unwrap();
        assert_eq!(plan.candidates.len(), 1);
        assert!(plan.candidates[0].conflict);
        assert!(!skill_dir.join("demo-importado-1").exists());
        let receipt = commit(&plan.id, &[plan.candidates[0].id.clone()], &data)
            .await
            .unwrap();
        assert!(receipt.errors.is_empty());
        assert_eq!(receipt.installed.len(), 1);
        assert_eq!(
            fs::read_to_string(skill_dir.join("demo/SKILL.md")).unwrap(),
            "existing"
        );
        assert!(skill_dir
            .join("demo-importado-1/scripts/helper.py")
            .is_file());
        assert!(skills::list_meta(&store)
            .iter()
            .any(|s| s.name == "demo-importado-1"));
        let (invoked, _) =
            skills::build_invocation_message(&store, "demo-importado-1", "ARGUMENTO_QA").unwrap();
        assert!(invoked.contains("IMPORTADO") && invoked.contains("ARGUMENTO_QA"));
        assert_eq!(
            fs::read_to_string(source.join("SKILL.md")).unwrap(),
            "---\nname: demo\ndescription: QA\n---\nResponde IMPORTADO."
        );
        assert!(commit(&plan.id, &[plan.candidates[0].id.clone()], &data)
            .await
            .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_existing_mcp_fails_closed() {
        let root = temp();
        fs::write(root.join("mcp_config.json"), b"not json").unwrap();
        assert!(merge_mcp(&root, "demo", json!({"command":"test","args":[]})).is_err());
        assert_eq!(fs::read(root.join("mcp_config.json")).unwrap(), b"not json");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn mcp_merge_preserves_settings_and_keeps_import_inactive() {
        let root = temp();
        let old = json!({"mcpServers":{"existing":{"command":"old","active":true}},"mcpSettings":{"toolCallTimeoutSeconds":91},"future":true});
        fs::write(root.join("mcp_config.json"), old.to_string()).unwrap();
        merge_mcp(
            &root,
            "added",
            json!({"command":"new","args":[],"env":{},"active":true,"official":true}),
        )
        .unwrap();
        let result = read_mcp(&root).unwrap();
        assert_eq!(
            result["mcpServers"]["existing"],
            old["mcpServers"]["existing"]
        );
        assert_eq!(result["mcpSettings"], old["mcpSettings"]);
        assert_eq!(result["future"], true);
        assert_eq!(result["mcpServers"]["added"]["active"], false);
        assert_eq!(result["mcpServers"]["added"]["official"], false);
        assert!(merge_mcp(&root, "added", json!({})).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reserved_names_cannot_escape_store() {
        for name in ["../x", "C:\\keys", "/absolute", ".", "a/b"] {
            let s = slug(name);
            assert!(!s.contains(['.', '/', '\\', ':']));
            assert!(!s.is_empty());
        }
    }

    #[test]
    fn preview_does_not_expose_mcp_values() {
        let preview = mcp_preview(
            &json!({"command":"node","args":["--token","fixture-secret"],"env":{"API_KEY":"fixture-secret"},"headers":{"Authorization":"fixture-secret"},"url":"https://example.test/?token=fixture-secret"}),
        );
        assert!(!preview.contains("fixture-secret"));
        assert!(preview.contains("API_KEY"));
    }

    #[tokio::test]
    async fn imported_provenance_is_preserved_and_the_skill_is_invocable() {
        let root = temp();
        let source = root.join("source/roundtrip");
        fs::create_dir_all(&source).unwrap();
        fs::write(
            source.join("SKILL.md"),
            "---\nname: roundtrip\ndescription: Roundtrip\n---\nKeep source provenance.",
        )
        .unwrap();
        fs::write(source.join(".rey30-import.json"), "original provenance").unwrap();
        let data = root.join("data");
        let plan = scan(data.clone(), None, None, Some(source)).unwrap();
        let receipt = commit(&plan.id, &[plan.candidates[0].id.clone()], &data)
            .await
            .unwrap();
        assert!(receipt.errors.is_empty(), "{:?}", receipt.errors);
        let store = workspace::permanent_store(&data);
        assert_eq!(
            fs::read_to_string(skills::skills_dir(&store).join("roundtrip/.rey30-import.json"))
                .unwrap(),
            "original provenance"
        );
        assert!(skills::build_invocation_message(&store, "roundtrip", "")
            .unwrap()
            .0
            .contains("Keep source provenance"));
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn codex_read_only_agent_remains_restricted_in_the_real_registry() {
        let root = temp();
        let source = root.join("source/.codex/agents");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("reader.toml"),"name = 'reader'\ndescription = 'QA read only'\ndeveloper_instructions = 'Review without modifications.'\nsandbox_mode = 'read-only'\n").unwrap();
        fs::write(
            root.join("source/README.md"),
            "Documentation, not an editor rule.",
        )
        .unwrap();
        let data = root.join("data");
        let plan = scan(data.clone(), None, None, Some(root.join("source"))).unwrap();
        assert_eq!(plan.candidates.len(), 1);
        assert_eq!(plan.candidates[0].kind, "agent");
        assert!(plan.candidates[0]
            .warnings
            .iter()
            .any(|w| w.contains("sin herramientas")));
        let receipt = commit(&plan.id, &[plan.candidates[0].id.clone()], &data)
            .await
            .unwrap();
        assert!(receipt.errors.is_empty(), "{:?}", receipt.errors);
        let registry = subagent::SubagentRegistry::load_one(
            &subagent::desktop_subagents_dir(&data),
            subagent::SubagentScope::User,
        );
        let reader = registry
            .list()
            .into_iter()
            .find(|d| d.name == "reader")
            .unwrap();
        assert_eq!(reader.allowed_tools, Some(vec![]));
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn foreign_plan_selection_cannot_write_and_does_not_consume_preview() {
        let root = temp();
        let source = root.join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("AGENTS.md"), "Keep changes scoped.").unwrap();
        let data = root.join("data");
        let plan = scan(data.clone(), None, None, Some(source)).unwrap();
        assert!(commit(&plan.id, &["unknown-id".into()], &data)
            .await
            .is_err());
        assert!(!data.exists());
        let receipt = commit(&plan.id, &[plan.candidates[0].id.clone()], &data)
            .await
            .unwrap();
        assert_eq!(receipt.installed.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn mixed_repository_with_root_skill_keeps_nested_skills_agents_and_mcp_visible() {
        let root = temp();
        let source = root.join("source");
        let data = root.join("data");
        fs::create_dir_all(source.join("collections/team/skills/nested-review")).unwrap();
        fs::create_dir_all(source.join(".github/agents/team")).unwrap();
        fs::create_dir_all(source.join(".github/instructions/rust")).unwrap();
        fs::create_dir_all(source.join("tools/mcp")).unwrap();
        fs::write(
            source.join("SKILL.md"),
            "---\ndescription: Parent skill\n---\nParent instructions.",
        )
        .unwrap();
        fs::write(
            source.join("collections/team/skills/nested-review/SKILL.md"),
            "---\ndescription: Nested review\n---\nNESTED_OWNED_CONTENT",
        )
        .unwrap();
        fs::write(source.join(".github/agents/team/research.agent.md"),"---\ndescription: Repository reader\ntools: [Read]\nreadonly: true\n---\nAGENT_OWNED_CONTENT").unwrap();
        fs::write(
            source.join(".github/agents/README.md"),
            "Documentation about the collection, not an agent.",
        )
        .unwrap();
        fs::write(
            source.join(".github/instructions/rust/check.instructions.md"),
            "---\napplyTo: '**/*.rs'\n---\nRUST_OWNED_CONTENT",
        )
        .unwrap();
        fs::write(
            source.join(".github/copilot-instructions.md"),
            "REPOSITORY_OWNED_CONTENT",
        )
        .unwrap();
        fs::write(source.join("tools/mcp/.mcp.json"),r#"{"mcpServers":{"owned-stdio":{"command":"never-execute-owned-fixture","args":[],"env":{},"active":true}}}"#).unwrap();
        fs::write(source.join("tools/mcp/server.json"),r#"{"name":"org/declared-package","packages":[{"registryType":"npm","identifier":"@owned-fixture/mcp-server","version":"2.3.4","transport":{"type":"stdio"}}]}"#).unwrap();
        let before =
            fs::read(source.join("collections/team/skills/nested-review/SKILL.md")).unwrap();
        let plan = scan_repository(
            data.clone(),
            &source,
            "example/mixed-resources",
            "1111111111111111111111111111111111111111",
        )
        .unwrap();
        assert_eq!(
            plan.candidates
                .iter()
                .filter(|entry| entry.kind == "skill")
                .count(),
            2
        );
        assert!(plan
            .candidates
            .iter()
            .any(|entry| entry.kind == "agent" && entry.name == "research"));
        assert_eq!(
            plan.candidates
                .iter()
                .filter(|entry| entry.kind == "mcp")
                .count(),
            2
        );
        assert_eq!(
            plan.candidates
                .iter()
                .filter(|entry| entry.kind == "instruction")
                .count(),
            2
        );
        let selected: Vec<String> = plan
            .candidates
            .iter()
            .filter(|entry| {
                entry.name == "nested-review"
                    || entry.name == "research"
                    || entry.name == "owned-stdio"
            })
            .map(|entry| entry.id.clone())
            .collect();
        assert_eq!(selected.len(), 3);
        let receipt = commit(&plan.id, &selected, &data).await.unwrap();
        assert!(receipt.errors.is_empty(), "{:?}", receipt.errors);
        let store = workspace::permanent_store(&data);
        assert!(skills::list_meta(&store)
            .iter()
            .any(|skill| skill.name == "nested-review"));
        assert!(
            skills::build_invocation_message(&store, "nested-review", "ARGUMENT")
                .unwrap()
                .0
                .contains("NESTED_OWNED_CONTENT")
        );
        let registry = subagent::SubagentRegistry::load_one(
            &subagent::desktop_subagents_dir(&data),
            subagent::SubagentScope::User,
        );
        let agent = registry
            .list()
            .into_iter()
            .find(|agent| agent.name == "research")
            .unwrap();
        assert_eq!(agent.allowed_tools, Some(vec![]));
        assert_eq!(
            read_mcp(&data).unwrap()["mcpServers"]["owned-stdio"]["active"],
            false
        );
        assert_eq!(
            fs::read(source.join("collections/team/skills/nested-review/SKILL.md")).unwrap(),
            before
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn agent_names_and_collision_suffixes_fit_the_real_registry_limit() {
        let root = temp();
        let source = root.join("source/agents");
        let data = root.join("data");
        fs::create_dir_all(&source).unwrap();
        let long = "a".repeat(100);
        let base = "a".repeat(MAX_AGENT_NAME);
        fs::write(
            source.join("long.md"),
            format!("---\nname: {long}\ntools: [Read]\n---\nKeep source identity in provenance."),
        )
        .unwrap();
        let agents = subagent::desktop_subagents_dir(&data);
        fs::create_dir_all(&agents).unwrap();
        let existing = format!("name = '{base}'\nsystem_prompt = 'ORIGINAL'\n");
        fs::write(agents.join(format!("{base}.toml")), &existing).unwrap();
        let plan = scan(data.clone(), None, None, Some(source)).unwrap();
        assert_eq!(plan.candidates.len(), 1);
        let candidate = &plan.candidates[0];
        assert!(candidate.name.len() <= MAX_AGENT_NAME);
        assert!(candidate.conflict);
        let receipt = commit(&plan.id, std::slice::from_ref(&candidate.id), &data)
            .await
            .unwrap();
        assert!(receipt.errors.is_empty());
        let registry = subagent::SubagentRegistry::load_one(&agents, subagent::SubagentScope::User);
        assert!(registry
            .list()
            .iter()
            .any(|agent| agent.name == candidate.name));
        assert_eq!(
            fs::read_to_string(agents.join(format!("{base}.toml"))).unwrap(),
            existing
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bounded_nested_collections_and_body_only_agent_files_are_detected() {
        let root = temp();
        let source = root.join("source");
        let mut nested = source.clone();
        for _ in 0..8 {
            nested = nested.join("group");
        }
        nested = nested.join("deep-skill");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("SKILL.md"), "Deep owned instructions.").unwrap();
        fs::create_dir_all(source.join(".github/agents")).unwrap();
        fs::write(
            source.join(".github/agents/plain.agent.md"),
            "Body-only owned agent instructions.",
        )
        .unwrap();
        let plan = scan(root.join("data"), None, None, Some(source)).unwrap();
        assert!(plan
            .candidates
            .iter()
            .any(|entry| entry.name == "deep-skill" && entry.kind == "skill"));
        assert!(plan
            .candidates
            .iter()
            .any(|entry| entry.name == "plain" && entry.kind == "agent"));
        fs::remove_dir_all(root).unwrap();
    }
}
