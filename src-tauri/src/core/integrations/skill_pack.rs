//! Install the embedded, text-only resource pack without replacing user files.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri_plugin_agent_tools::{skills, workspace};

use super::imports::secure_dir;

const PACK: &str = include_str!("../../../resources/rey30-skills.pack.json");
const MARKER: &str = ".rey30-skills-pack.json";
const LOCK: &str = ".rey30-skills-pack.lock";
const MAX_FILE: usize = 256 * 1024;
const MAX_PAYLOAD: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Pack {
    schema: u32,
    version: String,
    items: Vec<PackItem>,
    units: Vec<Unit>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackItem {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub origin: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    pub license: String,
    pub requires: Vec<String>,
    pub aliases: Vec<String>,
    pub triggers: Vec<String>,
    pub skill_names: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Skill,
    Agent,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Unit {
    id: String,
    kind: Kind,
    name: String,
    files: Vec<PackFile>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PackFile {
    path: String,
    content: String,
    sha256: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InstallStatus {
    Installed,
    Modified,
    Missing,
    Conflict,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackItemStatus {
    #[serde(flatten)]
    pub item: PackItem,
    pub status: InstallStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackStatus {
    pub version: String,
    pub items: Vec<PackItemStatus>,
    pub warnings: Vec<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Marker {
    schema: u32,
    version: String,
    units: BTreeMap<String, Record>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    kind: Kind,
    name: String,
    installed: bool,
    files: BTreeMap<String, String>,
}

fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        && !name.ends_with('.')
        && workspace::workspace_filename(name).is_ok()
}

fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|c| c.is_ascii_graphic())
}

fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 240
        && !path.contains('\\')
        && path.split('/').all(safe_name)
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit())
}

fn validate(pack: &Pack) -> Result<(), String> {
    if pack.schema != 1 || pack.version.is_empty() || pack.version.len() > 128 {
        return Err("El paquete de skills tiene una versión o esquema no compatible.".into());
    }
    if pack.units.len() > 4096 || pack.items.len() > 4096 {
        return Err("El paquete contiene demasiadas unidades o entradas.".into());
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    let mut payload = 0usize;
    for unit in &pack.units {
        if !safe_id(&unit.id)
            || !ids.insert(&unit.id)
            || !safe_name(&unit.name)
            || unit.name.ends_with(".md")
        {
            return Err(
                "El paquete contiene una identidad de unidad no válida o duplicada.".into(),
            );
        }
        if !names.insert((unit.kind as u8, unit.name.to_ascii_lowercase())) {
            return Err("El paquete contiene destinos duplicados.".into());
        }
        if unit.files.is_empty() || unit.files.len() > 1024 {
            return Err(format!("La unidad {} no contiene archivos.", unit.id));
        }
        let mut files = HashSet::new();
        for file in &unit.files {
            if !safe_relative(&file.path) || !files.insert(file.path.to_ascii_lowercase()) {
                return Err(format!(
                    "Ruta de archivo no válida o duplicada en {}.",
                    unit.id
                ));
            }
            let leaf = file.path.rsplit('/').next().unwrap_or_default();
            let license = leaf.to_ascii_uppercase();
            let text_file = [".md", ".txt", ".json", ".yaml", ".yml", ".toml"]
                .iter()
                .any(|extension| leaf.ends_with(extension))
                || matches!(
                    license.as_str(),
                    "LICENSE" | "LICENSE.TXT" | "LICENCE" | "LICENCE.TXT" | "NOTICE" | "NOTICE.TXT"
                )
                || license.starts_with("LICENSE-")
                    && leaf
                        .rsplit_once('.')
                        .is_none_or(|(_, suffix)| suffix.bytes().all(|c| c.is_ascii_digit()));
            if unit.kind == Kind::Skill && !text_file {
                return Err(
                    "El paquete sólo admite Markdown, metadatos y licencias de texto en skills."
                        .into(),
                );
            }
            if file.content.len() > MAX_FILE
                || file
                    .content
                    .chars()
                    .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
                || !valid_hash(&file.sha256)
                || !hash(file.content.as_bytes()).eq_ignore_ascii_case(&file.sha256)
            {
                return Err(format!(
                    "Contenido, tamaño o SHA-256 no válido en {}.",
                    file.path
                ));
            }
            payload = payload
                .checked_add(file.content.len())
                .ok_or("Paquete demasiado grande.")?;
            if payload > MAX_PAYLOAD {
                return Err("El paquete supera 8 MiB de contenido.".into());
            }
        }
        for file in &unit.files {
            let mut ancestor = Path::new(&file.path).parent();
            while let Some(parent) = ancestor.filter(|path| !path.as_os_str().is_empty()) {
                if files.contains(
                    &parent
                        .to_string_lossy()
                        .replace('\\', "/")
                        .to_ascii_lowercase(),
                ) {
                    return Err(format!(
                        "Un archivo del paquete también se usa como carpeta en {}.",
                        unit.id
                    ));
                }
                ancestor = parent.parent();
            }
        }
        match unit.kind {
            Kind::Skill if !unit.files.iter().any(|f| f.path == "SKILL.md") => {
                return Err(format!("Falta SKILL.md en {}.", unit.id));
            }
            Kind::Agent
                if unit.files.len() != 1 || unit.files[0].path != format!("{}.toml", unit.name) =>
            {
                return Err(format!(
                    "El agente {} necesita un único TOML con su nombre.",
                    unit.id
                ));
            }
            _ => {}
        }
    }
    let mut item_ids = HashSet::new();
    for item in &pack.items {
        if !safe_id(&item.id)
            || !item_ids.insert(&item.id)
            || item.label.trim().is_empty()
            || item.license.trim().is_empty()
            || item.skill_names.is_empty() && item.agent_name.is_none()
        {
            return Err("El paquete contiene metadatos incompletos o duplicados.".into());
        }
        for name in &item.skill_names {
            if !pack
                .units
                .iter()
                .any(|u| u.kind == Kind::Skill && u.name == *name)
            {
                return Err(format!(
                    "La skill {name} declarada no existe en el paquete."
                ));
            }
        }
        if let Some(name) = &item.agent_name {
            if !pack
                .units
                .iter()
                .any(|u| u.kind == Kind::Agent && u.name == *name)
            {
                return Err(format!(
                    "El agente {name} declarado no existe en el paquete."
                ));
            }
        }
    }
    Ok(())
}

fn parse(raw: &str) -> Result<Pack, String> {
    if raw.len() > MAX_PAYLOAD * 2 {
        return Err("El manifiesto del paquete supera la cuota permitida.".into());
    }
    let pack: Pack =
        serde_json::from_str(raw).map_err(|_| "El manifiesto del paquete no es válido.")?;
    validate(&pack)?;
    Ok(pack)
}

fn check_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("El destino del paquete debe ser absoluto.".into());
    }
    let mut part = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir | Component::CurDir) {
            return Err("El destino contiene navegación relativa no permitida.".into());
        }
        part.push(component);
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        let meta = match fs::symlink_metadata(&part) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("No se pudo inspeccionar el destino: {error}")),
        };
        #[cfg(windows)]
        let linked = {
            use std::os::windows::fs::MetadataExt;
            meta.file_type().is_symlink() || meta.file_attributes() & 0x400 != 0
        };
        #[cfg(not(windows))]
        let linked = meta.file_type().is_symlink();
        if linked {
            return Err(format!(
                "No se siguen enlaces o reparse points: {}",
                part.display()
            ));
        }
    }
    Ok(())
}

fn read_optional(path: &Path, limit: usize) -> Result<Option<Vec<u8>>, String> {
    check_path(path)?;
    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("No se pudo leer {}: {error}", path.display())),
    };
    if !meta.is_file() || meta.len() > limit as u64 {
        return Err(format!(
            "Archivo no regular o demasiado grande: {}",
            path.display()
        ));
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("El archivo cambió y supera la cuota permitida.".into());
    }
    Ok(Some(bytes))
}

fn load_marker(root: &Path) -> Result<(Marker, Option<Vec<u8>>), String> {
    let raw = read_optional(&root.join(MARKER), MAX_PAYLOAD)?;
    let marker = match &raw {
        Some(raw) => serde_json::from_slice::<Marker>(raw)
            .map_err(|_| "El registro del paquete no es válido; no se modificó.")?,
        None => Marker {
            schema: 1,
            ..Marker::default()
        },
    };
    if marker.schema != 1
        || marker.units.len() > 4096
        || marker.units.iter().any(|(id, record)| {
            !safe_id(id)
                || !safe_name(&record.name)
                || record.installed && record.files.is_empty()
                || record.files.len() > 1024
                || record
                    .files
                    .iter()
                    .any(|(path, sha)| !safe_relative(path) || !valid_hash(sha))
        })
    {
        return Err("El registro del paquete contiene un esquema o rutas no compatibles.".into());
    }
    Ok((marker, raw))
}

fn destination(root: &Path, kind: Kind, name: &str) -> PathBuf {
    match kind {
        Kind::Skill => skills::skills_dir(root).join(name),
        Kind::Agent => root.join("subagents").join(format!("{name}.toml")),
    }
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    check_path(path)?;
    secure_dir(
        path.parent()
            .ok_or("El archivo no tiene carpeta de destino.")?,
    )?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("No se reemplazó {}: {e}", path.display()))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("No se pudo guardar {}: {e}", path.display()))
}

struct InstallLock {
    path: PathBuf,
    token: Vec<u8>,
}

impl InstallLock {
    fn acquire(root: &Path) -> Result<Self, String> {
        let path = root.join(LOCK);
        let token = uuid::Uuid::new_v4().to_string().into_bytes();
        write_new(&path, &token).map_err(|e| format!("El paquete tiene una instalación concurrente o un bloqueo pendiente. Revisa {}. {e}", path.display()))?;
        Ok(Self { path, token })
    }
}

impl Drop for InstallLock {
    fn drop(&mut self) {
        if read_optional(&self.path, 128)
            .is_ok_and(|bytes| bytes.as_deref() == Some(self.token.as_slice()))
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn save_marker(root: &Path, marker: &Marker, previous: Option<&[u8]>) -> Result<(), String> {
    let path = root.join(MARKER);
    let bytes = serde_json::to_vec_pretty(marker).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PAYLOAD {
        return Err("El registro del paquete supera su cuota.".into());
    }
    let temp = root.join(format!(".rey30-skills-pack-{}.tmp", uuid::Uuid::new_v4()));
    write_new(&temp, &bytes)?;
    let result = (|| {
        if read_optional(&path, MAX_PAYLOAD)?.as_deref() != previous {
            return Err(
                "El registro del paquete cambió durante la instalación; se conservó.".into(),
            );
        }
        check_path(&temp)?;
        fs::rename(&temp, &path)
            .map_err(|e| format!("No se pudo confirmar el registro del paquete: {e}"))?;
        #[cfg(unix)]
        fs::File::open(root)
            .and_then(|dir| dir.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err()
        && read_optional(&temp, MAX_PAYLOAD)
            .is_ok_and(|raw| raw.as_deref() == Some(bytes.as_slice()))
    {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn install_unit(root: &Path, unit: &Unit) -> Result<(), String> {
    let dest = destination(root, unit.kind, &unit.name);
    check_path(&dest)?;
    if unit.kind == Kind::Skill {
        secure_dir(dest.parent().ok_or("Destino de skill no válido.")?)?;
        fs::create_dir(&dest).map_err(|e| format!("No se reservó {}: {e}", dest.display()))?;
        let mut files = unit.files.iter().collect::<Vec<_>>();
        files.sort_by_key(|file| file.path == "SKILL.md");
        for file in files {
            write_new(&dest.join(&file.path), file.content.as_bytes())?;
        }
    } else {
        write_new(&dest, unit.files[0].content.as_bytes())?;
    }
    Ok(())
}

fn has_extra_files(
    dir: &Path,
    expected: &BTreeMap<String, String>,
    base: &Path,
    depth: usize,
    budget: &mut usize,
) -> Result<bool, String> {
    if depth > 12 {
        return Ok(true);
    }
    check_path(dir)?;
    for child in fs::read_dir(dir).map_err(|e| e.to_string())? {
        if *budget == 0 {
            return Ok(true);
        }
        *budget -= 1;
        let path = child.map_err(|e| e.to_string())?.path();
        check_path(&path)?;
        let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            if has_extra_files(&path, expected, base, depth + 1, budget)? {
                return Ok(true);
            }
        } else {
            let relative = path
                .strip_prefix(base)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if !expected.contains_key(&relative) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn unit_status(root: &Path, unit: &Unit, record: Option<&Record>) -> Result<InstallStatus, String> {
    let dest = destination(root, unit.kind, &unit.name);
    check_path(&dest)?;
    if !dest.try_exists().map_err(|e| e.to_string())? {
        return Ok(InstallStatus::Missing);
    }
    let Some(record) = record else {
        return Ok(InstallStatus::Conflict);
    };
    if !record.installed || record.kind != unit.kind || record.name != unit.name {
        return Ok(InstallStatus::Conflict);
    }
    if unit.kind == Kind::Skill && !dest.is_dir() || unit.kind == Kind::Agent && !dest.is_file() {
        return Ok(InstallStatus::Conflict);
    }
    for (relative, expected) in &record.files {
        let file = if unit.kind == Kind::Skill {
            dest.join(relative)
        } else {
            dest.clone()
        };
        let Some(content) = read_optional(&file, MAX_FILE)? else {
            return Ok(InstallStatus::Modified);
        };
        if !hash(&content).eq_ignore_ascii_case(expected) {
            return Ok(InstallStatus::Modified);
        }
    }
    if unit.kind == Kind::Skill && has_extra_files(&dest, &record.files, &dest, 0, &mut 4096)? {
        return Ok(InstallStatus::Modified);
    }
    Ok(InstallStatus::Installed)
}

fn describe(root: &Path, pack: &Pack, marker: &Marker) -> PackStatus {
    let mut warnings = Vec::new();
    let mut states = HashMap::new();
    for unit in &pack.units {
        let record = marker.units.get(&unit.id);
        let state = match unit_status(root, unit, record) {
            Ok(state) => state,
            Err(error) => {
                warnings.push(format!("{}: {error}", unit.name));
                InstallStatus::Conflict
            }
        };
        if let Some(record) = record {
            let current: BTreeMap<_, _> = unit
                .files
                .iter()
                .map(|f| (f.path.clone(), f.sha256.to_ascii_lowercase()))
                .collect();
            if record.installed && record.files != current {
                warnings.push(format!("{} conserva su versión instalada; una actualización del paquete no reemplaza archivos existentes.", unit.name));
            }
        }
        states.insert((unit.kind as u8, unit.name.as_str()), state);
    }
    let items = pack
        .items
        .iter()
        .map(|item| {
            let mut item_states = item
                .skill_names
                .iter()
                .filter_map(|name| states.get(&(Kind::Skill as u8, name.as_str())))
                .copied()
                .collect::<Vec<_>>();
            if let Some(name) = &item.agent_name {
                if let Some(state) = states.get(&(Kind::Agent as u8, name.as_str())) {
                    item_states.push(*state);
                }
            }
            let status = [
                InstallStatus::Conflict,
                InstallStatus::Modified,
                InstallStatus::Missing,
            ]
            .into_iter()
            .find(|state| item_states.contains(state))
            .unwrap_or(InstallStatus::Installed);
            PackItemStatus {
                item: item.clone(),
                status,
            }
        })
        .collect();
    PackStatus {
        version: pack.version.clone(),
        items,
        warnings,
    }
}

fn install_pack(data: &Path, pack: &Pack) -> Result<PackStatus, String> {
    validate(pack)?;
    let root = workspace::permanent_store(data);
    check_path(&root)?;
    secure_dir(&root)?;
    let _lock = InstallLock::acquire(&root)?;
    let (mut marker, previous) = load_marker(&root)?;
    let mut changed = marker.version != pack.version;
    for unit in &pack.units {
        if marker.units.contains_key(&unit.id) {
            continue;
        }
        let dest = destination(&root, unit.kind, &unit.name);
        check_path(&dest)?;
        let exists = dest.try_exists().map_err(|e| e.to_string())?;
        let mut record = Record {
            kind: unit.kind,
            name: unit.name.clone(),
            installed: false,
            files: unit
                .files
                .iter()
                .map(|f| (f.path.clone(), f.sha256.to_ascii_lowercase()))
                .collect(),
        };
        if !exists {
            if let Err(error) = install_unit(&root, unit) {
                marker.units.insert(unit.id.clone(), record);
                marker.version = pack.version.clone();
                let commit = save_marker(&root, &marker, previous.as_deref());
                return Err(format!("La unidad {} quedó pendiente o parcial; no se sustituyó ni borró contenido. {error}{}", unit.name, commit.err().map(|e| format!(" Registro: {e}")).unwrap_or_default()));
            }
            record.installed = true;
        }
        marker.units.insert(unit.id.clone(), record);
        changed = true;
    }
    if changed {
        marker.version = pack.version.clone();
        save_marker(&root, &marker, previous.as_deref())?;
    }
    Ok(describe(&root, pack, &marker))
}

/// Install only units never considered before. Existing destinations are retained as conflicts.
pub fn install(data: &Path) -> Result<PackStatus, String> {
    install_pack(data, &parse(PACK)?)
}

/// Inspect the embedded pack and its tracked files without creating directories or files.
pub fn status(data: &Path) -> Result<PackStatus, String> {
    let pack = parse(PACK)?;
    let root = workspace::permanent_store(data);
    check_path(&root)?;
    let (marker, _) = load_marker(&root)?;
    Ok(describe(&root, &pack, &marker))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Pack {
        let body =
            "---\ndescription: Fixture local de prueba\n---\n# Fixture\nNo ejecutar scripts.\n";
        let reference = "# Referencia\nTexto propio de prueba.\n";
        Pack {
            schema: 1,
            version: "fixture-1".into(),
            items: vec![PackItem {
                id: "demo".into(),
                label: "Demo".into(),
                kind: "skill".into(),
                origin: "fixture".into(),
                source: "local-owned-fixture".into(),
                commit: None,
                license: "Apache-2.0".into(),
                requires: vec![],
                aliases: vec![],
                triggers: vec![],
                skill_names: vec!["demo".into()],
                agent_name: None,
                notes: None,
            }],
            units: vec![Unit {
                id: "skill-demo".into(),
                kind: Kind::Skill,
                name: "demo".into(),
                files: vec![
                    PackFile {
                        path: "SKILL.md".into(),
                        content: body.into(),
                        sha256: hash(body.as_bytes()),
                    },
                    PackFile {
                        path: "references/guide.md".into(),
                        content: reference.into(),
                        sha256: hash(reference.as_bytes()),
                    },
                ],
            }],
        }
    }

    fn state(data: &Path, pack: &Pack) -> InstallStatus {
        let root = workspace::permanent_store(data);
        let (marker, _) = load_marker(&root).unwrap();
        describe(&root, pack, &marker).items[0].status
    }

    #[test]
    fn embedded_pack_is_valid() {
        let pack = parse(PACK).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let status = install_pack(dir.path(), &pack).unwrap();
        assert!(status
            .items
            .iter()
            .all(|item| item.status == InstallStatus::Installed));
        let root = workspace::permanent_store(dir.path());
        let listed = skills::list_meta(&root);
        let registry = crate::core::agent::subagent::SubagentRegistry::load_one(
            &root.join("subagents"),
            crate::core::agent::subagent::SubagentScope::Project,
        );
        for unit in &pack.units {
            match unit.kind {
                Kind::Skill => assert!(
                    listed.iter().any(|skill| skill.name == unit.name),
                    "{}",
                    unit.name
                ),
                Kind::Agent => assert!(registry.get(&unit.name).is_some(), "{}", unit.name),
            }
        }
    }

    #[test]
    fn install_is_idempotent_and_discovered_by_real_consumer() {
        let dir = tempfile::tempdir().unwrap();
        let pack = fixture();
        assert_eq!(
            install_pack(dir.path(), &pack).unwrap().items[0].status,
            InstallStatus::Installed
        );
        let root = workspace::permanent_store(dir.path());
        let before = fs::read(root.join(MARKER)).unwrap();
        assert_eq!(skills::list_meta(&root)[0].name, "demo");
        let (body, _) = skills::build_invocation_message(&root, "demo", "argumento").unwrap();
        assert!(body.contains("No ejecutar scripts."));
        assert!(body.contains("User: argumento"));
        install_pack(dir.path(), &pack).unwrap();
        assert_eq!(fs::read(root.join(MARKER)).unwrap(), before);
        assert!(!root.join(LOCK).exists());
    }

    #[test]
    fn edited_and_removed_units_are_not_replaced_or_recreated() {
        let dir = tempfile::tempdir().unwrap();
        let pack = fixture();
        install_pack(dir.path(), &pack).unwrap();
        let root = workspace::permanent_store(dir.path());
        let entry = root.join("skills/demo/SKILL.md");
        fs::write(&entry, "Edición del usuario").unwrap();
        assert_eq!(state(dir.path(), &pack), InstallStatus::Modified);
        install_pack(dir.path(), &pack).unwrap();
        assert_eq!(fs::read_to_string(&entry).unwrap(), "Edición del usuario");
        fs::remove_file(&entry).unwrap();
        fs::remove_file(root.join("skills/demo/references/guide.md")).unwrap();
        fs::remove_dir(root.join("skills/demo/references")).unwrap();
        fs::remove_dir(root.join("skills/demo")).unwrap();
        assert_eq!(
            install_pack(dir.path(), &pack).unwrap().items[0].status,
            InstallStatus::Missing
        );
        assert!(!entry.exists());
    }

    #[test]
    fn occupied_destination_is_never_overwritten_or_claimed() {
        let dir = tempfile::tempdir().unwrap();
        let root = workspace::permanent_store(dir.path());
        secure_dir(&root.join("skills/demo")).unwrap();
        fs::write(root.join("skills/demo/SKILL.md"), "Recurso anterior").unwrap();
        assert_eq!(
            install_pack(dir.path(), &fixture()).unwrap().items[0].status,
            InstallStatus::Conflict
        );
        assert_eq!(
            fs::read_to_string(root.join("skills/demo/SKILL.md")).unwrap(),
            "Recurso anterior"
        );
        fs::remove_file(root.join("skills/demo/SKILL.md")).unwrap();
        fs::remove_dir(root.join("skills/demo")).unwrap();
        install_pack(dir.path(), &fixture()).unwrap();
        assert!(!root.join("skills/demo").exists());
    }

    #[test]
    fn new_version_adds_only_new_units_and_retains_previous_baseline() {
        let dir = tempfile::tempdir().unwrap();
        let mut pack = fixture();
        install_pack(dir.path(), &pack).unwrap();
        pack.version = "fixture-2".into();
        pack.units[0].files[0].content = "Nuevo contenido del proveedor".into();
        pack.units[0].files[0].sha256 = hash(pack.units[0].files[0].content.as_bytes());
        let mut next = pack.units[0].clone();
        next.id = "skill-next".into();
        next.name = "next".into();
        pack.units.push(next);
        let result = install_pack(dir.path(), &pack).unwrap();
        assert_eq!(result.items[0].status, InstallStatus::Installed);
        assert!(result
            .warnings
            .iter()
            .any(|w| w.contains("conserva su versión")));
        let root = workspace::permanent_store(dir.path());
        assert!(fs::read_to_string(root.join("skills/demo/SKILL.md"))
            .unwrap()
            .contains("Fixture"));
        assert!(root.join("skills/next/SKILL.md").exists());
    }

    #[test]
    fn rejects_traversal_bad_hash_binary_and_oversized_content_before_writing() {
        let dir = tempfile::tempdir().unwrap();
        for path in [
            "../escape.md",
            "nested/../escape.md",
            "C:/escape.md",
            "nested\\escape.md",
            "/absolute.md",
            "aux.md",
            "trailing./x.md",
        ] {
            let mut pack = fixture();
            pack.units[0].files[1].path = path.into();
            assert!(install_pack(dir.path(), &pack).is_err(), "{path}");
        }
        let mut pack = fixture();
        pack.units[0].files[0].sha256 = "0".repeat(64);
        assert!(install_pack(dir.path(), &pack).is_err());
        for body in ["\0".to_string(), "x".repeat(MAX_FILE + 1)] {
            let mut pack = fixture();
            pack.units[0].files[0].sha256 = hash(body.as_bytes());
            pack.units[0].files[0].content = body;
            assert!(install_pack(dir.path(), &pack).is_err());
        }
        let mut pack = fixture();
        let body = "x".repeat(MAX_FILE);
        for index in 0..33 {
            pack.units[0].files.push(PackFile {
                path: format!("references/large-{index}.md"),
                sha256: hash(body.as_bytes()),
                content: body.clone(),
            });
        }
        assert!(install_pack(dir.path(), &pack).is_err());
        assert!(!workspace::permanent_store(dir.path()).exists());
    }

    #[test]
    fn duplicate_paths_names_and_missing_entrypoint_are_rejected() {
        let mut pack = fixture();
        pack.units[0].files[1].path = "skill.MD".into();
        assert!(validate(&pack).is_err());
        let mut pack = fixture();
        pack.units[0].name = "x".repeat(65);
        assert!(validate(&pack).is_err());
        let mut pack = fixture();
        pack.units[0].files.remove(0);
        assert!(validate(&pack).is_err());
        let mut pack = fixture();
        let mut unit = pack.units[0].clone();
        unit.id = "other".into();
        unit.name = "DEMO".into();
        pack.units.push(unit);
        assert!(validate(&pack).is_err());
    }

    #[test]
    fn malformed_or_unwritable_marker_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        let root = workspace::permanent_store(dir.path());
        secure_dir(&root).unwrap();
        fs::write(root.join(MARKER), "not JSON").unwrap();
        assert!(install_pack(dir.path(), &fixture()).is_err());
        assert_eq!(fs::read_to_string(root.join(MARKER)).unwrap(), "not JSON");
        fs::remove_file(root.join(MARKER)).unwrap();
        fs::create_dir(root.join(MARKER)).unwrap();
        assert!(install_pack(dir.path(), &fixture()).is_err());
        assert!(!root.join("skills/demo").exists());
        assert!(!root.join(LOCK).exists());
    }

    #[test]
    fn marker_race_is_detected_without_overwriting_external_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let root = workspace::permanent_store(dir.path());
        secure_dir(&root).unwrap();
        fs::write(root.join(MARKER), "external-change").unwrap();
        let marker = Marker {
            schema: 1,
            ..Marker::default()
        };
        assert!(save_marker(&root, &marker, None).is_err());
        assert_eq!(
            fs::read_to_string(root.join(MARKER)).unwrap(),
            "external-change"
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    }

    #[test]
    fn lock_conflict_and_invalid_layout_do_not_expose_entrypoint() {
        let dir = tempfile::tempdir().unwrap();
        let root = workspace::permanent_store(dir.path());
        secure_dir(&root).unwrap();
        fs::write(root.join(LOCK), "another-installation").unwrap();
        assert!(install_pack(dir.path(), &fixture()).is_err());
        assert_eq!(
            fs::read_to_string(root.join(LOCK)).unwrap(),
            "another-installation"
        );
        fs::remove_file(root.join(LOCK)).unwrap();
        let mut pack = fixture();
        pack.units[0].files[1].path = "references.md/guide.md".into();
        let file = "# conflict";
        pack.units[0].files.push(PackFile {
            path: "references.md".into(),
            content: file.into(),
            sha256: hash(file.as_bytes()),
        });
        assert!(install_pack(dir.path(), &pack).is_err());
        assert!(!root.join("skills/demo/SKILL.md").exists());
        assert!(skills::list_meta(&root).is_empty());
        assert!(!root.join("skills/demo").exists());
    }

    #[test]
    fn agent_install_and_read_only_status_use_existing_store_contract() {
        let dir = tempfile::tempdir().unwrap();
        let mut pack = fixture();
        let body = "name = \"reviewer\"\ndescription = \"Fixture\"\nsystem_prompt = \"Revisa sin ejecutar.\"\nallowed_tools = []\n";
        pack.units.push(Unit {
            id: "agent-reviewer".into(),
            kind: Kind::Agent,
            name: "reviewer".into(),
            files: vec![PackFile {
                path: "reviewer.toml".into(),
                content: body.into(),
                sha256: hash(body.as_bytes()),
            }],
        });
        pack.items[0].agent_name = Some("reviewer".into());
        assert_eq!(
            install_pack(dir.path(), &pack).unwrap().items[0].status,
            InstallStatus::Installed
        );
        let root = workspace::permanent_store(dir.path());
        let registry = crate::core::agent::subagent::SubagentRegistry::load_one(
            &root.join("subagents"),
            crate::core::agent::subagent::SubagentScope::Project,
        );
        assert_eq!(
            registry.get("reviewer").unwrap().allowed_tools,
            Some(vec![])
        );
        let before = fs::read(root.join(MARKER)).unwrap();
        describe(&root, &pack, &load_marker(&root).unwrap().0);
        assert_eq!(fs::read(root.join(MARKER)).unwrap(), before);
        let missing = dir.path().join("absent");
        let root = workspace::permanent_store(&missing);
        let (marker, _) = load_marker(&root).unwrap();
        assert_eq!(
            describe(&root, &pack, &marker).items[0].status,
            InstallStatus::Missing
        );
        assert!(!missing.exists());
    }

    #[test]
    fn symlink_or_junction_destination_is_rejected_without_touching_target() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("sentinel.md"), "preservar").unwrap();
        let root = workspace::permanent_store(dir.path());
        secure_dir(&root).unwrap();
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let quote = |path: &Path| path.to_string_lossy().replace('\'', "''");
            let result = std::process::Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", &format!("New-Item -ItemType Junction -Path '{}' -Target '{}' -ErrorAction Stop | Out-Null", quote(&root.join("skills")), quote(outside.path()))]).creation_flags(0x08000000).status().unwrap();
            assert!(result.success());
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), root.join("skills")).unwrap();
        assert!(install_pack(dir.path(), &fixture()).is_err());
        assert_eq!(
            fs::read_to_string(outside.path().join("sentinel.md")).unwrap(),
            "preservar"
        );
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 1);
    }
}
