//! Scratch: the drive as a slower tier of memory for agents and the engine
//! (docs/plans/scratch-tier.md, WP1). Bytes live in a memory-mapped arena
//! file, the OS page cache is the only RAM they take, and nothing is parsed
//! until asked for. The JavaScript side (scripts/scratch-rules.cjs,
//! scripts/scratch-host.cjs) owns the key grammar, the kinds table and the
//! settings; this module takes a kind's name and flags with each put.
//!
//! Every call's first argument is the collaborators object `{ dir, capMB, now? }`
//! (`now` in ms, so tests get the same answers twice), then the request:
//!
//!   open                                        { ok, generation, keys, replayed, dropped, cleanShutdown }
//!   put { key, kind, text, meta?, ttlMs?, searchable? }   { ok, hash, bytes, dedup } | { ok: false, reason: "full" }
//!   get { key } | { hash }                      { ok, text, kind, at, meta } | { ok: false, reason: "missing" }
//!   has { key }                                 { ok, has }
//!   list { prefix?, kind?, limit? }             { ok, items: [{ key, hash, bytes, kind, at }] }
//!   search { query, kind?, prefix?, limit? }    { ok, items: [{ key, hash, score, snippet, at }] }
//!   stats                                       { ok, bytes, capBytes, liveBytes, deadBytes, keys, blobs, hits, misses, generation, lastCompactAt }
//!   compact                                     { ok, generation, freedBytes }
//!   evict { prefix }                            { ok, evicted }
//!   close                                       { ok }   (the final snapshot; the lock goes)
//!
//! Every answer carries `ok`; a refusal is `{ ok: false, reason }` (`locked`
//! when another process holds the arena, `io` with the error's text), and
//! only a malformed request is an Err. One arena per folder per process.

pub mod arena;
pub mod bm25;
pub mod buddy;
pub mod index;
pub mod journal;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};

use crate::callbacks::{invoke, is_function, Callbacks};
use crate::js;
use arena::{Arena, Refusal};

/// `capMB` when the collaborators do not say.
pub const DEFAULT_CAP_MB: f64 = 512.0;
const MAX_KEY_CHARS: usize = 512;
const LIST_LIMIT: f64 = 100.0;
const LIST_MAX: f64 = 1000.0;
const SEARCH_LIMIT: f64 = 10.0;
const SEARCH_MAX: f64 = 100.0;

type Result<T> = std::result::Result<T, String>;

fn registry() -> &'static Mutex<HashMap<PathBuf, Arena>> {
    static ARENAS: OnceLock<Mutex<HashMap<PathBuf, Arena>>> = OnceLock::new();
    ARENAS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct Collaborators {
    dir: PathBuf,
    cap_bytes: u64,
    now: f64,
}

fn collaborators(value: &Value, callbacks: &dyn Callbacks) -> Result<Collaborators> {
    let dir = match js::get(value, "dir") {
        Some(Value::String(dir)) if !dir.trim().is_empty() => PathBuf::from(dir),
        _ => return Err("scratch: the collaborators need a dir".into()),
    };
    let cap_mb = js::get(value, "capMB").and_then(js::finite).filter(|cap| *cap > 0.0).unwrap_or(DEFAULT_CAP_MB);
    let cap_bytes = (cap_mb * 1024.0 * 1024.0).min(u64::MAX as f64) as u64;
    let now = match js::get(value, "now") {
        Some(handle) if is_function(handle) => invoke(callbacks, handle, vec![]).ok().as_ref().and_then(js::finite).unwrap_or_else(js::now_ms),
        Some(given) => js::finite(given).unwrap_or_else(js::now_ms),
        None => js::now_ms(),
    };
    Ok(Collaborators { dir, cap_bytes, now })
}

fn folder_key(dir: &PathBuf) -> PathBuf {
    let text = std::fs::canonicalize(dir).map(|real| real.to_string_lossy().into_owned()).unwrap_or_else(|_| crate::paths::resolve(&dir.to_string_lossy()));
    PathBuf::from(if cfg!(windows) { text.to_lowercase() } else { text })
}

fn refused(refusal: Refusal) -> Value {
    match refusal {
        Refusal::Locked(pid) => json!({ "ok": false, "reason": "locked", "pid": pid }),
        Refusal::Io(error) => json!({ "ok": false, "reason": "io", "error": error }),
    }
}

/// A key: a string of 1 to 512 printable characters.
fn key_of(request: &Value, name: &str, function: &str) -> Result<Option<String>> {
    match js::get(request, name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(key)) if !key.is_empty() && key.chars().count() <= MAX_KEY_CHARS && !key.chars().any(|c| (c as u32) < 0x20 || c == '\u{7f}') => Ok(Some(key.clone())),
        _ => Err(format!("scratch.{function}: {name} must be a string of 1 to {MAX_KEY_CHARS} printable characters")),
    }
}

fn text_of(request: &Value, name: &str, function: &str) -> Result<Option<String>> {
    match js::get(request, name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        _ => Err(format!("scratch.{function}: {name} must be a string")),
    }
}

fn limit_of(request: &Value, fallback: f64, max: f64) -> usize {
    let wanted = js::get(request, "limit").map_or(f64::NAN, |limit| js::to_number(Some(limit)));
    let count = if wanted.is_finite() { wanted.floor() } else { fallback };
    count.clamp(1.0, max) as usize
}

fn with_arena(given: &Collaborators, work: impl FnOnce(&mut Arena) -> Result<Value>) -> Result<Value> {
    let mut arenas = registry().lock().unwrap_or_else(|poison| poison.into_inner());
    let key = folder_key(&given.dir);
    if !arenas.contains_key(&key) {
        match Arena::open(&given.dir, given.cap_bytes, given.now) {
            Ok(arena) => {
                arenas.insert(key.clone(), arena);
            }
            Err(refusal) => return Ok(refused(refusal)),
        }
    }
    let arena = arenas.get_mut(&key).ok_or_else(|| "the arena was not opened".to_string())?;
    work(arena)
}

fn io_answer(result: Result<Value>) -> Result<Value> {
    Ok(match result {
        Ok(answer) => answer,
        Err(error) => json!({ "ok": false, "reason": "io", "error": error }),
    })
}

pub fn call(function: &str, args: &[Value], callbacks: &dyn Callbacks) -> Result<Value> {
    let given = collaborators(args.first().unwrap_or(&Value::Null), callbacks)?;
    let request = args.get(1).cloned().unwrap_or(Value::Null);
    if !matches!(request, Value::Null | Value::Object(_)) {
        return Err(format!("scratch.{function}: the request must be an object"));
    }
    match function {
        "open" => with_arena(&given, |arena| Ok(arena.opened())),
        "put" => {
            let key = key_of(&request, "key", "put")?.ok_or("scratch.put: key must be a string of 1 to 512 printable characters")?;
            let text = text_of(&request, "text", "put")?.ok_or("scratch.put: text must be a string")?;
            let kind = match js::get(&request, "kind") {
                None | Some(Value::Null) => "note".to_string(),
                Some(Value::String(kind)) if !kind.is_empty() && kind.chars().count() <= 64 => kind.clone(),
                _ => return Err("scratch.put: kind must be a short string".into()),
            };
            let meta = js::or_null(js::get(&request, "meta"));
            let ttl = js::get(&request, "ttlMs").and_then(js::finite).filter(|ttl| *ttl >= 0.0);
            let searchable = js::get(&request, "searchable").is_some_and(js::truthy);
            let now = given.now;
            with_arena(&given, |arena| io_answer(arena.put(&key, &kind, &text, meta, ttl, searchable, now)))
        }
        "get" => {
            let key = key_of(&request, "key", "get")?;
            let hash = text_of(&request, "hash", "get")?;
            if key.is_none() && hash.is_none() {
                return Err("scratch.get: a key or a hash is needed".into());
            }
            let now = given.now;
            with_arena(&given, |arena| Ok(arena.get(key.as_deref(), hash.as_deref(), now)))
        }
        "has" => {
            let key = key_of(&request, "key", "has")?.ok_or("scratch.has: key must be a string of 1 to 512 printable characters")?;
            with_arena(&given, |arena| Ok(arena.has(&key)))
        }
        "list" => {
            let prefix = text_of(&request, "prefix", "list")?;
            let kind = text_of(&request, "kind", "list")?;
            let limit = limit_of(&request, LIST_LIMIT, LIST_MAX);
            with_arena(&given, |arena| Ok(arena.list(prefix.as_deref(), kind.as_deref(), limit)))
        }
        "search" => {
            let query = text_of(&request, "query", "search")?.ok_or("scratch.search: query must be a string")?;
            let prefix = text_of(&request, "prefix", "search")?;
            let kind = text_of(&request, "kind", "search")?;
            let limit = limit_of(&request, SEARCH_LIMIT, SEARCH_MAX);
            with_arena(&given, |arena| Ok(arena.search(&query, kind.as_deref(), prefix.as_deref(), limit)))
        }
        "stats" => with_arena(&given, |arena| Ok(arena.stats())),
        "compact" => {
            let now = given.now;
            with_arena(&given, |arena| io_answer(arena.compact(now)))
        }
        "evict" => {
            let prefix = key_of(&request, "prefix", "evict")?.ok_or("scratch.evict: prefix must be a string of 1 to 512 printable characters")?;
            let now = given.now;
            with_arena(&given, |arena| io_answer(arena.evict(&prefix, now)))
        }
        "close" => {
            let mut arenas = registry().lock().unwrap_or_else(|poison| poison.into_inner());
            let key = folder_key(&given.dir);
            match arenas.remove(&key) {
                Some(mut arena) => io_answer(arena.close().map(|()| json!({ "ok": true }))),
                None => Ok(json!({ "ok": true, "open": false })),
            }
        }
        other => Err(format!("scratch.{other} has not moved to Rust")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::callbacks::NoCallbacks;

    fn temp(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        std::env::temp_dir().join(format!("mefi-scratch-wire-{name}-{}-{nanos}", std::process::id()))
    }

    #[test]
    fn the_wire_shapes_and_malformed_requests() {
        let dir = temp("shapes");
        let given = json!({ "dir": dir.to_string_lossy(), "capMB": 1, "now": 1_700_000_000_000.0 });
        let run = |function: &str, request: Value| call(function, &[given.clone(), request], &NoCallbacks);
        let opened = run("open", Value::Null).expect("open");
        assert_eq!(opened["ok"], true);
        assert_eq!(opened["keys"], 0);
        let put = run("put", json!({ "key": "run/1/log", "kind": "output", "text": "the build log says hello", "meta": { "step": 2 }, "searchable": true })).expect("put");
        assert_eq!(put["ok"], true);
        assert_eq!(put["bytes"], 24);
        assert_eq!(put["dedup"], false);
        assert_eq!(put["hash"].as_str().map(str::len), Some(64));
        let got = run("get", json!({ "key": "run/1/log" })).expect("get");
        assert_eq!(got, json!({ "ok": true, "text": "the build log says hello", "kind": "output", "at": 1_700_000_000_000u64, "meta": { "step": 2 } }));
        assert_eq!(run("get", json!({ "hash": put["hash"] })).expect("get")["ok"], true);
        assert_eq!(run("get", json!({ "key": "nope" })).expect("get"), json!({ "ok": false, "reason": "missing" }));
        assert_eq!(run("has", json!({ "key": "run/1/log" })).expect("has"), json!({ "ok": true, "has": true }));
        let listed = run("list", json!({ "prefix": "run/", "limit": 5 })).expect("list");
        assert_eq!(listed["items"][0]["key"], "run/1/log");
        assert_eq!(listed["items"][0]["bytes"], 24);
        let found = run("search", json!({ "query": "hello build" })).expect("search");
        assert_eq!(found["items"][0]["key"], "run/1/log");
        assert_eq!(found["items"][0]["snippet"], "the build log says hello");
        let stats = run("stats", Value::Null).expect("stats");
        assert_eq!(stats["keys"], 1);
        assert_eq!(stats["capBytes"], 1024 * 1024);
        assert_eq!(stats["hits"], 2);
        assert_eq!(stats["misses"], 1);
        let compacted = run("compact", Value::Null).expect("compact");
        assert_eq!(compacted["generation"], 1);
        assert_eq!(run("evict", json!({ "prefix": "run/1/" })).expect("evict")["evicted"], 1);
        assert_eq!(run("stats", Value::Null).expect("stats")["keys"], 0);

        for (function, request) in [
            ("put", json!({ "kind": "x", "text": "y" })),
            ("put", json!({ "key": "", "text": "y" })),
            ("put", json!({ "key": "a\nb", "text": "y" })),
            ("put", json!({ "key": "k", "text": 5 })),
            ("put", json!({ "key": "k", "text": "y", "kind": 7 })),
            ("get", json!({})),
            ("has", json!({ "key": 1 })),
            ("search", json!({})),
            ("evict", json!({})),
            ("put", json!("not an object")),
            ("nothing", Value::Null),
        ] {
            assert!(run(function, request.clone()).is_err(), "{function} {request}");
        }
        assert!(call("stats", &[json!({})], &NoCallbacks).is_err(), "no dir");
        assert_eq!(run("close", Value::Null).expect("close"), json!({ "ok": true }));
        assert_eq!(run("close", Value::Null).expect("close")["open"], false);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn now_may_be_a_function_and_a_locked_folder_is_refused() {
        let dir = temp("now");
        let given = json!({ "dir": dir.to_string_lossy(), "now": { "$mefi": "const", "value": 42 } });
        let put = call("put", &[given.clone(), json!({ "key": "k", "text": "t" })], &NoCallbacks).expect("put");
        assert_eq!(put["ok"], true);
        assert_eq!(call("list", &[given.clone(), Value::Null], &NoCallbacks).expect("list")["items"][0]["at"], 42);
        assert_eq!(call("close", &[given.clone(), Value::Null], &NoCallbacks).expect("close")["ok"], true);
        let mut command = if cfg!(windows) { std::process::Command::new("cmd") } else { std::process::Command::new("sleep") };
        if cfg!(windows) {
            command.args(["/c", "ping", "-n", "4", "127.0.0.1"]);
        } else {
            command.arg("3");
        }
        let mut child = command.stdout(std::process::Stdio::null()).spawn().expect("a child process");
        std::fs::write(dir.join("scratch.lock"), format!(r#"{{"pid":{},"at":1}}"#, child.id())).expect("lock");
        let answer = call("stats", &[given.clone(), Value::Null], &NoCallbacks).expect("stats");
        assert_eq!(answer["reason"], "locked");
        assert_eq!(answer["pid"], child.id());
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(call("stats", &[given.clone(), Value::Null], &NoCallbacks).expect("stats")["keys"], 1);
        let _ = call("close", &[given, Value::Null], &NoCallbacks);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
