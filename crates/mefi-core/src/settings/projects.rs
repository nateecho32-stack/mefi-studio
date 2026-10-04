//! A project's identity and the saved project list (scripts/projects.cjs's
//! pure rules): the id a folder gets, the list settings.json's `projects`
//! block makes (the hidden legacy store, the migration that drops the app's
//! own root, MEFI_STUDIO_REPO's preferred folder, the placeholder), add,
//! select, remove, `saved()` and `dataPath`. The engine's live registry stays
//! JavaScript: every caller reads it synchronously, and its `current()`
//! follows the async context an operation captured. Rust modules build this
//! one from the same saved block when they need the project list.

use indexmap::IndexMap;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::js;
use crate::paths;

const SEP: char = std::path::MAIN_SEPARATOR;

/// `path.isAbsolute`.
fn is_absolute(path: &str) -> bool {
    std::path::Path::new(path).is_absolute() || (cfg!(windows) && path.starts_with(['/', '\\']))
}

/// `path.basename` of a resolved folder: "" for a root.
fn basename(root: &str) -> String {
    if root.ends_with(['/', '\\']) {
        return String::new();
    }
    root.rsplit(['/', '\\']).next().unwrap_or("").to_string()
}

/// projectFromPath(value, { name, legacy, explicit }).
pub fn project_from_path(value: &Value, name: &Value, legacy: bool, explicit: bool) -> Result<Value, String> {
    let Some(value) = value.as_str().filter(|value| is_absolute(value)) else { return Err("Choose an absolute project folder.".into()) };
    let root = paths::resolve(value);
    let digest = Sha256::digest(paths::path_key(&root).as_bytes());
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    let label = if js::truthy(name) {
        js::string(name)
    } else {
        let base = basename(&root);
        if base.is_empty() { root.clone() } else { base }
    };
    let mut project = Map::new();
    project.insert("id".into(), json!(format!("project_{}", &hex[..16])));
    project.insert("name".into(), json!(js::slice(&label, 0, Some(100))));
    project.insert("path".into(), json!(root));
    if legacy {
        project.insert("legacy".into(), json!(true));
    }
    if explicit {
        project.insert("explicit".into(), json!(true));
    }
    Ok(Value::Object(project))
}

fn flag(project: &Value, key: &str) -> bool {
    project.get(key) == Some(&Value::Bool(true))
}

fn with(project: &Value, key: &str, value: Value) -> Value {
    let mut next = project.as_object().cloned().unwrap_or_default();
    next.insert(key.into(), value);
    Value::Object(next)
}

fn exposed(project: &Value) -> Option<Value> {
    if flag(project, "exposed") {
        Some(project.clone())
    } else if flag(project, "placeholder") {
        None
    } else {
        Some(with(project, "exposed", json!(true)))
    }
}

fn hidden(project: &Value) -> Value {
    let mut next = project.as_object().cloned().unwrap_or_default();
    next.shift_remove("exposed");
    next.shift_remove("explicit");
    Value::Object(next)
}

fn is_directory(path: &Value) -> bool {
    path.as_str().is_some_and(|path| std::fs::metadata(path).is_ok_and(|meta| meta.is_dir()))
}

fn id_of(project: &Value) -> String {
    js::string(&project["id"])
}

/// createProjects({ defaultRoot, studioRoot, saved, preferredRoot }) without
/// the async context and the store facades.
pub struct Registry {
    studio_root: String,
    legacy: Value,
    projects: IndexMap<String, Value>,
    placeholder: Value,
    active: Value,
}

impl Registry {
    pub fn new(default_root: &str, studio_root: &str, saved: &Value, preferred_root: Option<&str>) -> Result<Registry, String> {
        let legacy_root = saved.get("legacyPath").and_then(Value::as_str).filter(|path| is_absolute(path)).unwrap_or(default_root);
        let legacy = project_from_path(&json!(legacy_root), &Value::Null, true, false)?;
        let mut projects: IndexMap<String, Value> = IndexMap::new();
        projects.insert(id_of(&legacy), legacy.clone());
        for item in saved.get("items").and_then(Value::as_array).into_iter().flatten() {
            let explicit = item.get("explicit") == Some(&Value::Bool(true));
            let Ok(project) = project_from_path(item.get("path").unwrap_or(&Value::Null), item.get("name").unwrap_or(&Value::Null), false, explicit) else { continue };
            // Settings written before projects became opt-in carry the app's own root: drop that seed unless chosen again.
            if paths::path_key(&js::string(&project["path"])) == paths::path_key(default_root) && !explicit {
                continue;
            }
            let id = id_of(&project);
            match projects.get(&id) {
                None => {
                    if let Some(shown) = exposed(&project) {
                        projects.insert(id, shown);
                    }
                }
                Some(kept) if explicit => {
                    if let Some(shown) = exposed(&with(kept, "explicit", json!(true))) {
                        projects.insert(id, shown);
                    }
                }
                _ => {}
            }
        }
        let mut preferred = None;
        if let Some(root) = preferred_root.filter(|root| is_absolute(root)) {
            let project = project_from_path(&json!(root), &Value::Null, false, false)?;
            let id = id_of(&project);
            let base = projects.get(&id).cloned().unwrap_or(project);
            if let Some(shown) = exposed(&base) {
                projects.insert(id, shown.clone());
                preferred = Some(shown);
            }
        }
        let placeholder = json!({ "id": "project_none", "name": "No project", "path": paths::join(studio_root, ".no-project"), "placeholder": true });
        let mut registry = Registry { studio_root: studio_root.to_string(), legacy, projects, placeholder: placeholder.clone(), active: placeholder };
        let saved_active = saved.get("activeId").and_then(Value::as_str).and_then(|id| registry.projects.get(id)).cloned();
        let chosen = [preferred, saved_active].into_iter().flatten().find(|candidate| flag(candidate, "exposed") && is_directory(&candidate["path"]));
        registry.active = chosen.or_else(|| registry.first_openable()).unwrap_or(registry.placeholder.clone());
        Ok(registry)
    }

    fn exposed_projects(&self) -> Vec<Value> {
        self.projects.values().filter(|project| flag(project, "exposed")).cloned().collect()
    }

    fn first_openable(&self) -> Option<Value> {
        self.exposed_projects().into_iter().find(|project| is_directory(&project["path"]))
    }

    pub fn open(&self) -> Option<Value> {
        flag(&self.active, "exposed").then(|| self.active.clone())
    }

    pub fn active(&self) -> Value {
        self.active.clone()
    }

    pub fn has_projects(&self) -> bool {
        !self.exposed_projects().is_empty()
    }

    pub fn list(&self) -> Value {
        let open = self.open();
        json!({ "ok": true, "projects": self.exposed_projects(), "activeId": open.as_ref().map_or(Value::Null, |project| project["id"].clone()), "activeProject": open })
    }

    pub fn find(&self, id: &str) -> Value {
        self.projects.get(id).filter(|project| flag(project, "exposed")).cloned().unwrap_or(Value::Null)
    }

    pub fn saved(&self) -> Value {
        let items: Vec<Value> = self
            .exposed_projects()
            .iter()
            .map(|project| {
                let mut item = json!({ "id": project["id"], "name": project["name"], "path": project["path"] });
                if js::truthy(project.get("explicit").unwrap_or(&Value::Null)) {
                    item["explicit"] = json!(true);
                }
                item
            })
            .collect();
        json!({ "activeId": self.open().map_or(Value::Null, |project| project["id"].clone()), "legacyPath": self.legacy["path"], "items": items })
    }

    pub fn add(&mut self, value: &Value) -> Result<Value, String> {
        let project = project_from_path(value, &Value::Null, false, false)?;
        if !is_directory(&project["path"]) {
            return Err("The selected project folder is unavailable.".into());
        }
        let id = id_of(&project);
        let base = self.projects.get(&id).cloned().unwrap_or(project);
        let next = with(&with(&base, "exposed", json!(true)), "explicit", json!(true));
        self.projects.insert(id, next.clone());
        Ok(next)
    }

    fn listed(&self, id: &str) -> Result<Value, String> {
        self.projects.get(id).filter(|project| flag(project, "exposed")).cloned().ok_or_else(|| "Choose a project from your project list.".to_string())
    }

    pub fn select(&mut self, id: &str) -> Result<Value, String> {
        let project = self.listed(id)?;
        if !is_directory(&project["path"]) {
            return Err("That project folder is unavailable. Reconnect it before switching.".into());
        }
        self.active = project.clone();
        Ok(project)
    }

    /// Removing never touches the folder or its data; the legacy identity stays hidden.
    pub fn remove(&mut self, id: &str) -> Result<Value, String> {
        let project = self.listed(id)?;
        if flag(&project, "legacy") {
            self.projects.insert(id.to_string(), hidden(&project));
        } else {
            self.projects.shift_remove(id);
        }
        let changed = id_of(&self.active) == id;
        if changed {
            self.active = self.first_openable().unwrap_or(self.placeholder.clone());
        }
        Ok(json!({
            "removed": { "id": project["id"], "name": project["name"], "path": project["path"] },
            "activeChanged": changed, "activeId": self.open().map_or(Value::Null, |project| project["id"].clone()),
        }))
    }

    /// Where a data file lives for a project: operational files under data/projects/<id>/.
    pub fn data_path(&self, file: &str, project: &Value) -> String {
        let data_root = paths::join(&self.studio_root, "data");
        if flag(project, "legacy") || !paths::contains_path(&data_root, &json!(file)) {
            return file.to_string();
        }
        let resolved = paths::resolve(file);
        let root_len = paths::resolve(&data_root).len();
        let relative = resolved.get(root_len..).map(|rest| rest.trim_start_matches(['/', '\\']).to_string()).unwrap_or_default();
        if relative.split(SEP).next() == Some("projects") || relative == "curated.json" || relative == "models.json" {
            return file.to_string();
        }
        let base = paths::join(&paths::join(&data_root, "projects"), &id_of(project));
        if relative.is_empty() {
            base
        } else {
            paths::join(&base, &relative)
        }
    }
}

/// A sequence of registry steps, for the parity tests: each answers its value or `{ thrown }`.
pub fn run(options: &Value, steps: &Value) -> Value {
    let text = |key: &str| options.get(key).and_then(Value::as_str).unwrap_or("").to_string();
    let preferred = options.get("preferredRoot").and_then(Value::as_str).map(String::from);
    let mut registry = match Registry::new(&text("defaultRoot"), &text("studioRoot"), options.get("saved").unwrap_or(&Value::Null), preferred.as_deref()) {
        Ok(registry) => registry,
        Err(error) => return json!([{ "thrown": error }]),
    };
    let mut out = Vec::new();
    for step in steps.as_array().into_iter().flatten() {
        let arg = step.get("arg").cloned().unwrap_or(Value::Null);
        let answer = match step.get("op").and_then(Value::as_str).unwrap_or("") {
            "list" => Ok(registry.list()),
            "saved" => Ok(registry.saved()),
            "active" => Ok(registry.active()),
            "open" => Ok(registry.open().unwrap_or(Value::Null)),
            "hasProjects" => Ok(json!(registry.has_projects())),
            "find" => Ok(registry.find(&js::string(&arg))),
            "add" => registry.add(&arg),
            "select" => registry.select(&js::string(&arg)),
            "remove" => registry.remove(&js::string(&arg)),
            "dataPath" => Ok(json!(registry.data_path(&js::string(&arg), &registry.active()))),
            other => Err(format!("no such step: {other}")),
        };
        out.push(answer.unwrap_or_else(|error| json!({ "thrown": error })));
    }
    Value::Array(out)
}
