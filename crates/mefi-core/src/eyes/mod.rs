//! The OpenCode session store, read-only: scripts/eyes.mjs's worker methods
//! (EYES_WORKER_METHODS in scripts/eyes-client.cjs) in Rust. Under the Rust
//! host the engine's store reads land here instead of on the eyes worker
//! thread; the answers are the same JSON the worker posted back.
//!
//! The store is OpenCode's own `opencode.db`, never written. One connection
//! is kept open per path, as openDb cached one, and every read takes the
//! store lock in turn, as the single worker thread ran them in turn.

mod collisions;
mod facts;
mod git;
mod reads;
mod usage;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Map, Value};

use crate::js;

pub type Result<T> = std::result::Result<T, String>;

/// The methods the engine may call (EYES_WORKER_METHODS).
pub const METHODS: &[&str] = &[
    "listSessions", "listSessionIds", "sessionDirectory", "findRunSession", "listChanges", "listReads",
    "listSessionChecks", "listSessionActiveTools", "listTodos", "activitySince", "collisions", "filePresence",
    "listChatTexts", "assistantFacts", "usageLedger", "storeStatus", "gitPorcelain", "commitEvidence", "closeReadDb",
];

const SESSION_TABLES: &[&str] = &["session", "message", "part", "todo"];

pub(crate) struct Store {
    open: Option<(String, Connection, u64)>,
    generation: u64,
    schema_checks: HashMap<String, (Instant, Option<Vec<String>>)>,
    pub(crate) edit_memo: Option<collisions::EditMemo>,
    pub(crate) usage: HashMap<String, usage::UsageCache>,
}

fn store() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(|| {
        Mutex::new(Store { open: None, generation: 0, schema_checks: HashMap::new(), edit_memo: None, usage: HashMap::new() })
    })
}

/// ~/.local/share/opencode/opencode.db, eyes.mjs DEFAULT_DB.
pub fn default_db() -> String {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default();
    home.join(".local").join("share").join("opencode").join("opencode.db").to_string_lossy().into_owned()
}

pub(crate) fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

// ---- arguments: a missing key is JavaScript's undefined, so its default applies ----

pub(crate) fn arg<'a>(args: &'a Value, key: &str) -> Option<&'a Value> {
    js::get(args, key)
}

pub(crate) fn db_path(args: &Value) -> String {
    match arg(args, "dbPath") {
        None => default_db(),
        Some(Value::String(path)) => path.clone(),
        Some(other) => js::string(other),
    }
}

/// `value ?? fallback` for a numeric argument passed to SQL as is.
pub(crate) fn arg_or(args: &Value, key: &str, fallback: Value) -> Value {
    match arg(args, key) {
        None => fallback,
        Some(value) => value.clone(),
    }
}

// ---- SQL ----

pub(crate) fn bind(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(flag) => SqlValue::Integer(i64::from(*flag)),
        Value::Number(n) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => SqlValue::Integer(i),
            (None, Some(f)) if f.fract() == 0.0 && f.abs() < 9.2e18 => SqlValue::Integer(f as i64),
            (None, Some(f)) => SqlValue::Real(f),
            _ => SqlValue::Null,
        },
        Value::String(text) => SqlValue::Text(text.clone()),
        other => SqlValue::Text(js::string(other)),
    }
}

fn column(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => js::num(f),
        ValueRef::Text(bytes) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    }
}

pub(crate) type Row = Map<String, Value>;

/// Every row of a query as an object keyed by column name (node:sqlite's .all()).
pub(crate) fn all(db: &Connection, sql: &str, params: &[Value]) -> Result<Vec<Row>> {
    let mut statement = db.prepare_cached(sql).map_err(|error| error.to_string())?;
    let names: Vec<String> = statement.column_names().iter().map(|name| name.to_string()).collect();
    let bound: Vec<SqlValue> = params.iter().map(bind).collect();
    let mut rows = statement.query(rusqlite::params_from_iter(bound)).map_err(|error| error.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let mut object = Map::new();
        for (index, name) in names.iter().enumerate() {
            object.insert(name.clone(), column(row.get_ref(index).map_err(|error| error.to_string())?));
        }
        out.push(object);
    }
    Ok(out)
}

/// The first row (node:sqlite's .get()), or None.
pub(crate) fn one(db: &Connection, sql: &str, params: &[Value]) -> Result<Option<Row>> {
    Ok(all(db, sql, params)?.into_iter().next())
}

pub(crate) fn field<'a>(row: &'a Row, key: &str) -> &'a Value {
    row.get(key).unwrap_or(&Value::Null)
}

// ---- the store ----

impl Store {
    /// eyes.mjs openDb: one cached read-only connection per path.
    pub(crate) fn db(&mut self, path: &str) -> Result<&Connection> {
        if self.open.as_ref().map(|(open, _, _)| open.as_str()) != Some(path) {
            if !Path::new(path).exists() {
                return Err(format!("OpenCode database not found at {path}"));
            }
            let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI)
                .map_err(|error| error.to_string())?;
            self.generation += 1;
            self.open = Some((path.to_string(), connection, self.generation));
        }
        Ok(&self.open.as_ref().expect("opened above").1)
    }

    pub(crate) fn generation(&self) -> u64 {
        self.open.as_ref().map_or(0, |(_, _, generation)| *generation)
    }

    fn tables(&mut self, path: &str) -> Option<Vec<String>> {
        if let Some((at, tables)) = self.schema_checks.get(path) {
            if at.elapsed().as_millis() < 5000 {
                return tables.clone();
            }
        }
        let tables = self
            .db(path)
            .and_then(|db| all(db, "select name from sqlite_master where type = 'table'", &[]))
            .ok()
            .map(|rows| rows.iter().filter_map(|row| field(row, "name").as_str().map(String::from)).collect());
        self.schema_checks.insert(path.to_string(), (Instant::now(), tables.clone()));
        tables
    }

    /// storePresent: the file exists and holds at least one session table
    /// (an unreadable file counts as present, so its read throws).
    pub(crate) fn present(&mut self, path: &str) -> bool {
        if !Path::new(path).exists() {
            return false;
        }
        match self.tables(path) {
            None => true,
            Some(tables) => SESSION_TABLES.iter().any(|name| tables.iter().any(|table| table == name)),
        }
    }

    fn close(&mut self) {
        self.schema_checks.clear();
        self.edit_memo = None;
        self.open = None;
    }
}

/// storeStatus: why a listing came back empty, in the owner's words.
fn store_status(store: &mut Store, path: &str) -> Value {
    let legacy = Path::new(path).parent().map(|dir| dir.join("storage").join("session").exists()).unwrap_or(false);
    if !Path::new(path).exists() {
        let note = if legacy {
            format!("No opencode.db at {path}; this OpenCode keeps sessions as JSON under storage/, which Studio does not read. Update OpenCode and run it once so it migrates them.")
        } else {
            format!("No OpenCode store yet at {path}. Run OpenCode once in this folder and the sessions appear here.")
        };
        return json!({ "ok": false, "present": false, "schema": false, "path": path, "tables": [], "legacy": legacy, "reason": "missing", "note": note });
    }
    let tables = match store.tables(path) {
        Some(tables) => Ok(tables),
        None => store.db(path).and_then(|db| all(db, "select name from sqlite_master where type = 'table'", &[])).map(|_| Vec::new()),
    };
    let tables = match tables {
        Ok(tables) => tables,
        Err(error) => {
            return json!({ "ok": false, "present": true, "schema": false, "path": path, "tables": [], "legacy": legacy, "reason": "unreadable",
                "note": format!("The OpenCode store at {path} could not be read: {error}") });
        }
    };
    let missing: Vec<&str> = SESSION_TABLES.iter().copied().filter(|name| !tables.iter().any(|table| table == name)).collect();
    if missing.contains(&"session") {
        let listed = if tables.is_empty() {
            "it is empty".to_string()
        } else {
            format!("it holds {} table(s): {}{}", tables.len(), tables.iter().take(6).cloned().collect::<Vec<_>>().join(", "), if tables.len() > 6 { ", …" } else { "" })
        };
        let legacy_note = if legacy { " Sessions from an older OpenCode still sit under storage/ as JSON and migrate on that first start." } else { "" };
        return json!({ "ok": false, "present": true, "schema": false, "path": path, "tables": tables, "legacy": legacy, "reason": "no-session-table",
            "note": format!("The OpenCode store at {path} has no session table yet ({listed}). OpenCode fills the schema on its first start: open OpenCode once (`opencode` in any folder), let it finish starting, then Retry.{legacy_note}") });
    }
    let note = if missing.is_empty() { Value::Null } else { json!(format!("The OpenCode store is missing {}; some views stay empty until OpenCode updates it.", missing.join(", "))) };
    json!({ "ok": true, "present": true, "schema": true, "path": path, "tables": tables, "legacy": legacy, "reason": null, "note": note })
}

// ---- the part table's newest-first window (scanRecentParts, windowCovers) ----

const PART_WINDOW: f64 = 2000.0;

pub(crate) fn scan_recent_parts(
    db: &Connection,
    query: &mut dyn FnMut(f64) -> Result<Vec<Row>>,
    enough: &mut dyn FnMut(&[Row], f64) -> Result<bool>,
) -> Result<Vec<Row>> {
    let top = one(db, "select max(rowid) top from part", &[])?.and_then(|row| js::number(field(&row, "top"))).unwrap_or(0.0);
    let mut size = PART_WINDOW;
    loop {
        let lower = (top - size).max(0.0);
        let rows = query(lower)?;
        if lower == 0.0 || enough(&rows, lower)? {
            return Ok(rows);
        }
        size *= 4.0;
    }
}

pub(crate) fn window_covers(db: &Connection, lower: f64, since: &Value) -> Result<bool> {
    if lower == 0.0 {
        return Ok(true);
    }
    let oldest = one(db, "select min(time_created) t from part where rowid > ?", &[js::num(lower)])?.map(|row| field(&row, "t").clone()).unwrap_or(Value::Null);
    // `oldest <= since` with JavaScript's coercion: a number against a number.
    Ok(match (oldest.as_f64(), js::to_number(Some(since))) {
        (Some(oldest), since) => oldest <= since,
        (None, _) => false,
    })
}

// ---- the dispatcher ----

/// One store read, by its JavaScript name, with its JavaScript argument object.
pub fn call(method: &str, args: &Value) -> Result<Value> {
    let empty = Value::Object(Map::new());
    let args = if args.is_object() { args } else { &empty };
    // git runs as a child process without holding the store, as the worker's
    // async children never held its queued reads.
    match method {
        "gitPorcelain" => return Ok(json!(git::git_porcelain(arg(args, "root")))),
        "commitEvidence" => return Ok(git::commit_evidence(args)),
        "assistantFacts" => {
            let porcelain = match arg(args, "porcelain") {
                Some(value) if !value.is_null() => js::string(value),
                _ => git::git_porcelain(arg(args, "root")),
            };
            let mut guard = store().lock().map_err(|_| "the store lock was poisoned".to_string())?;
            return facts::assistant_facts(&mut guard, args, &porcelain);
        }
        _ => {}
    }
    let mut guard = store().lock().map_err(|_| "the store lock was poisoned".to_string())?;
    call_locked(&mut guard, method, args)
}

/// A store read as JSON text, the form the host sends on. The usage ledger
/// joins its kept rows' text directly; the rest serialise their answer.
pub fn call_json(method: &str, args: &Value) -> Result<String> {
    if method == "usageLedger" {
        let empty = Value::Object(Map::new());
        let args = if args.is_object() { args } else { &empty };
        let mut guard = store().lock().map_err(|_| "the store lock was poisoned".to_string())?;
        return usage::usage_ledger_json(&mut guard, &db_path(args), args);
    }
    call(method, args).map(|value| value.to_string())
}

/// A store read with the store already held (assistantFacts reads several).
pub(crate) fn call_locked(store: &mut Store, method: &str, args: &Value) -> Result<Value> {
    let path = db_path(args);
    match method {
        "storeStatus" => Ok(store_status(store, &path)),
        "closeReadDb" => {
            store.close();
            Ok(Value::Null)
        }
        "listSessions" => reads::list_sessions(store, &path, args),
        "listSessionIds" => reads::list_session_ids(store, &path, args),
        "sessionDirectory" => reads::session_directory(store, &path, args),
        "findRunSession" => reads::find_run_session(store, &path, args),
        "listChanges" => reads::list_changes(store, &path, args),
        "listSessionChecks" => Ok(reads::list_session_checks(store, &path, args)),
        "listReads" => Ok(reads::list_reads(store, &path, args)),
        "listSessionActiveTools" => Ok(reads::list_session_active_tools(store, &path, args)),
        "listTodos" => reads::list_todos(store, &path, args),
        "activitySince" => reads::activity_since(store, &path, args),
        "listChatTexts" => reads::list_chat_texts(store, &path, args),
        "collisions" => collisions::collisions(store, &path, args),
        "filePresence" => collisions::file_presence(store, &path, args),
        "usageLedger" => usage::usage_ledger(store, &path, args),
        other => Err(format!("eyes worker: {other} is not a store read")),
    }
}

/// The CLI dump eyes.mjs prints with `--dump --fixture <db> [--root] [--now] [--porcelain]`,
/// so the parity test can hold the two side by side.
pub fn dump(fixture: &str, root: Option<&str>, now: f64, porcelain: &str) -> Result<Value> {
    let base = |extra: Value| {
        let mut object = json!({ "dbPath": fixture });
        if let (Some(map), Value::Object(more)) = (object.as_object_mut(), extra) {
            map.extend(more);
        }
        object
    };
    let root_value = root.map_or(Value::Null, |root| json!(root));
    let sessions = call("listSessions", &base(json!({})))?;
    let changes = call("listChanges", &base(json!({ "limit": 50 })))?;
    Ok(json!({
        "sessions": sessions,
        "changes": changes,
        "todos": call("listTodos", &base(json!({})))?,
        "activity": call("activitySince", &base(json!({ "since": 0 })))?,
        "collisions": call("collisions", &base(json!({ "since": 0, "now": now })))?,
        "collisionsScoped": call("collisions", &base(json!({ "since": 0, "root": root_value, "now": now })))?,
        "presence": call("filePresence", &base(json!({ "since": 0, "root": root_value, "now": now })))?,
        "uncommitted": facts::uncommitted_only(porcelain, &sessions, &changes, root),
        "facts": call("assistantFacts", &base(json!({ "root": root_value, "now": now, "porcelain": porcelain })))?,
    }))
}
