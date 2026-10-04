//! settings.json and auth.json (main.cjs readSettings / writeSettings /
//! settingsFromDisk with scripts/auth-store.cjs): one merged view for every
//! caller, preferences from settings.json and credential ciphertext from
//! auth.json. A legacy file that still holds ciphertext migrates on read (the
//! keys reach auth.json first, then leave the preferences). A missing file
//! reads as {}; anything else unreadable never does: its bytes are copied
//! aside once, and the view falls back to the last copy parsed or written
//! here. With no such copy, saves are held in memory instead of replacing
//! every saved preference.
//!
//! The file's health (the last good text, held saves, the bytes last copied
//! aside, whether it is unreadable now) is kept per settings path, seeded
//! once from the engine's own startup read. Each call names the two files and
//! carries `projects` (projects.saved(), written with every save); `log(line)`
//! is called back, and `now()` in tests.
//!
//! `keys` holds the credential fields and their environment variables,
//! `projects` the project identity rules.

pub mod keys;
pub mod projects;

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use serde_json::{Map, Value};

use crate::callbacks::{invoke, is_function, Callbacks};
use crate::js;
use crate::paths;

type Result<T> = std::result::Result<T, String>;

/// settings.json's health.
#[derive(Clone, Default)]
struct Disk {
    good: Option<String>,
    held: Option<String>,
    broken: Option<String>,
    copy: Option<String>,
    unreadable: bool,
}

fn disks() -> &'static Mutex<HashMap<String, Disk>> {
    static DISKS: OnceLock<Mutex<HashMap<String, Disk>>> = OnceLock::new();
    DISKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn seed_of(value: Option<&Value>) -> Disk {
    let text = |key: &str| value.and_then(|seed| seed.get(key)).and_then(Value::as_str).map(String::from);
    Disk { good: text("good"), held: text("held"), broken: text("broken"), copy: text("copy"), unreadable: value.and_then(|seed| seed.get("unreadable")) == Some(&Value::Bool(true)) }
}

/// Node's words for a failed file call: `CODE: description`.
fn io_message(error: &std::io::Error, verb: &str) -> String {
    use std::io::ErrorKind::*;
    let (code, words) = match error.kind() {
        NotFound => ("ENOENT", "no such file or directory"),
        PermissionDenied => ("EPERM", "operation not permitted"),
        IsADirectory => ("EISDIR", "illegal operation on a directory"),
        NotADirectory => ("ENOTDIR", "not a directory"),
        ResourceBusy => ("EBUSY", "resource busy or locked"),
        _ => ("EIO", "i/o error"),
    };
    format!("{code}: {words}, {verb}")
}

/// A JSON object, or why not (JSON.parse's verdict, in serde's words).
fn parse_object(text: &str) -> std::result::Result<Map<String, Value>, String> {
    if js::trim(text).is_empty() {
        return Err("Unexpected end of JSON input".into());
    }
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err("not a JSON object".into()),
        Err(error) => Err(format!("Unexpected token in JSON ({error})")),
    }
}

/// auth-store.cjs splitAuthFields: the credential slice, and a plain copy without it.
pub fn split(settings: &Map<String, Value>) -> (Map<String, Value>, Map<String, Value>) {
    let mut auth = Map::new();
    let mut plain = settings.clone();
    for field in keys::auth_fields() {
        if let Some(value) = plain.shift_remove(field) {
            auth.insert(field.to_string(), value);
        }
    }
    (auth, plain)
}

/// auth-store.cjs mergeAuthFields: the auth file's fields back onto a plain view.
pub fn merge(plain: &Map<String, Value>, auth: &Map<String, Value>) -> Map<String, Value> {
    let mut merged = plain.clone();
    for field in keys::auth_fields() {
        if let Some(value) = auth.get(field) {
            merged.insert(field.to_string(), value.clone());
        }
    }
    merged
}

/// A missing, empty or unreadable auth file reads as "no keys saved".
pub fn read_auth(path: &str) -> Map<String, Value> {
    std::fs::read(path).ok().and_then(|bytes| parse_object(&String::from_utf8_lossy(&bytes)).ok()).unwrap_or_default()
}

/// Atomic rename so a reader never sees a torn document; a plain write when the rename is refused.
pub fn atomic_write_json(file: &str, payload: &Value) -> Result<()> {
    if let Some(folder) = Path::new(file).parent() {
        std::fs::create_dir_all(folder).map_err(|error| io_message(&error, "mkdir"))?;
    }
    let body = js::stringify(payload, "  ");
    let temporary = format!("{file}.tmp-{}", std::process::id());
    let written = std::fs::write(&temporary, &body).map_err(|error| io_message(&error, "open")).and_then(|_| {
        if std::fs::rename(&temporary, file).is_err() {
            std::fs::write(file, &body).map_err(|error| io_message(&error, "open"))?;
        }
        Ok(())
    });
    let _ = std::fs::remove_file(&temporary);
    written
}

struct Store<'a> {
    context: &'a Value,
    callbacks: &'a dyn Callbacks,
    settings_path: String,
    auth_path: String,
}

impl<'a> Store<'a> {
    fn new(context: &'a Value, callbacks: &'a dyn Callbacks) -> Result<Store<'a>> {
        let path = |key: &str| context.get(key).and_then(Value::as_str).filter(|path| !path.is_empty()).map(String::from).ok_or_else(|| format!("no {key}"));
        Ok(Store { context, callbacks, settings_path: path("settingsPath")?, auth_path: path("authPath")? })
    }

    fn log(&self, lines: Vec<String>) {
        if let Some(handle) = self.context.get("log").filter(|handle| is_function(handle)) {
            for line in lines {
                let _ = invoke(self.callbacks, handle, vec![Value::String(line)]);
            }
        }
    }

    fn now(&self) -> f64 {
        self.context.get("now").filter(|handle| is_function(handle)).and_then(|handle| invoke(self.callbacks, handle, vec![]).ok()).and_then(|value| value.as_f64()).unwrap_or_else(js::now_ms)
    }

    fn projects(&self) -> Value {
        self.context.get("projects").cloned().unwrap_or(Value::Null)
    }

    /// Runs with this settings file's health, seeded from the engine the first time.
    fn with_disk<T>(&self, task: impl FnOnce(&mut Disk) -> T) -> T {
        let mut all = disks().lock().unwrap_or_else(|poison| poison.into_inner());
        let disk = all.entry(self.settings_path.clone()).or_insert_with(|| seed_of(self.context.get("seed")));
        task(disk)
    }

    /// settingsFromDisk: one verdict for every read of settings.json.
    fn from_disk(&self, disk: &mut Disk, logs: &mut Vec<String>) -> Map<String, Value> {
        match std::fs::read(&self.settings_path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                disk.unreadable = false;
                return Map::new();
            }
            Err(error) => {
                let message = io_message(&error, "read");
                if !disk.unreadable {
                    logs.push(format!("[settings] settings.json could not be read: {message}"));
                }
            }
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                match parse_object(&text) {
                    Ok(parsed) => {
                        disk.good = Some(text);
                        disk.held = None;
                        disk.unreadable = false;
                        return parsed;
                    }
                    Err(message) => {
                        if disk.broken.as_deref() != Some(text.as_str()) {
                            disk.broken = Some(text);
                            let stamp = js::iso_string(self.now()).unwrap_or_default().replace([':', '.'], "-");
                            let folder = Path::new(&self.settings_path).parent().map(|folder| folder.to_string_lossy().into_owned()).unwrap_or_default();
                            let copy = paths::join(&folder, &format!("settings.broken-{stamp}.json"));
                            match std::fs::write(&copy, &bytes) {
                                Ok(()) => {
                                    logs.push(format!("[settings] settings.json is unreadable ({message}); copied it to {copy}"));
                                    disk.copy = Some(copy);
                                }
                                Err(error) => logs.push(format!("[settings] settings.json is unreadable ({message}) and could not be copied aside: {}", io_message(&error, "open"))),
                            }
                        }
                    }
                }
            }
        }
        disk.unreadable = true;
        disk.good.as_deref().or(disk.held.as_deref()).filter(|text| !text.is_empty()).and_then(|text| parse_object(text).ok()).unwrap_or_default()
    }

    /// readSettings: the merged view; a legacy file's keys move to auth.json on the way.
    fn read(&self) -> Result<Value> {
        let mut logs = Vec::new();
        let settings = self.with_disk(|disk| self.from_disk(disk, &mut logs));
        self.log(logs);
        let (stale, plain) = split(&settings);
        let auth = read_auth(&self.auth_path);
        if !stale.is_empty() {
            let mut both = auth.clone();
            for (field, value) in stale {
                both.insert(field, value);
            }
            atomic_write_json(&self.auth_path, &Value::Object(both.clone()))?;
            let mut saved = plain.clone();
            saved.insert("projects".into(), self.projects());
            atomic_write_json(&self.settings_path, &Value::Object(saved))?;
            return Ok(Value::Object(merge(&plain, &both)));
        }
        Ok(Value::Object(merge(&settings, &auth)))
    }

    /// writeSettings: preferences to settings.json (or held while nothing good was ever read), keys to auth.json.
    fn write(&self, next: &Value) -> Result<Value> {
        let next = next.as_object().cloned().unwrap_or_default();
        let (auth, plain) = split(&next);
        let mut saved = plain;
        saved.insert("projects".into(), self.projects());
        let saved = Value::Object(saved);
        let mut logs = Vec::new();
        self.with_disk(|disk| -> Result<()> {
            if disk.unreadable && disk.good.is_none() {
                disk.held = Some(js::stringify(&saved, ""));
                let copied = disk.copy.as_ref().map_or(String::new(), |copy| format!(" (copied to {copy})"));
                logs.push(format!("[settings] change kept until restart only: settings.json is unreadable{copied}; fix or remove it to save again"));
            } else {
                atomic_write_json(&self.settings_path, &saved)?;
                disk.good = Some(js::stringify(&saved, ""));
                disk.held = None;
                disk.unreadable = false;
            }
            Ok(())
        })?;
        self.log(logs);
        if !auth.is_empty() || !read_auth(&self.auth_path).is_empty() {
            atomic_write_json(&self.auth_path, &Value::Object(auth))?;
        }
        Ok(Value::Null)
    }

    /// The health as the engine keeps it, for the tests.
    fn health(&self) -> Value {
        let disk = self.with_disk(|disk| disk.clone());
        serde_json::json!({ "good": disk.good, "held": disk.held, "broken": disk.broken, "copy": disk.copy, "unreadable": disk.unreadable })
    }
}

/// One store call, or one rule (`keys.*`, `projects.*`, `auth.*`).
pub fn call(function: &str, args: &[Value], callbacks: &dyn Callbacks) -> Result<Value> {
    let arg = |index: usize| args.get(index).cloned().unwrap_or(Value::Null);
    if let Some(name) = function.strip_prefix("keys.") {
        return keys::call(name, args).ok_or_else(|| format!("no such function: settings.{function}"));
    }
    match function {
        "projects.run" => return Ok(projects::run(&arg(0), &arg(1))),
        "projects.fromPath" => {
            let options = arg(1);
            return Ok(projects::project_from_path(&arg(0), options.get("name").unwrap_or(&Value::Null), options.get("legacy") == Some(&Value::Bool(true)), options.get("explicit") == Some(&Value::Bool(true))).unwrap_or_else(|error| serde_json::json!({ "thrown": error })));
        }
        "auth.split" => {
            let (auth, plain) = split(&arg(0).as_object().cloned().unwrap_or_default());
            return Ok(serde_json::json!({ "auth": auth, "plain": plain }));
        }
        "auth.merge" => return Ok(Value::Object(merge(&arg(0).as_object().cloned().unwrap_or_default(), &arg(1).as_object().cloned().unwrap_or_default()))),
        "stringify" => return Ok(Value::String(js::stringify(&arg(0), &js::string(&arg(1))))),
        _ => {}
    }
    let context = arg(0);
    let store = Store::new(&context, callbacks)?;
    match function {
        "read" => store.read(),
        "write" => store.write(&arg(1)),
        "health" => Ok(store.health()),
        // Forget a settings path's health (tests start each case fresh).
        "forget" => {
            disks().lock().unwrap_or_else(|poison| poison.into_inner()).remove(&store.settings_path);
            Ok(Value::Null)
        }
        _ => Err(format!("no such function: settings.{function}")),
    }
}
