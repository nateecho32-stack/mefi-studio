//! The open project's files by name, for the @ picker (scripts/project-files.cjs,
//! with scripts/gitignore-lite.cjs and mentions.cjs cleanPath). Names only; no
//! contents are read except .gitignore files. What is listed is what Studio's
//! own read tool could read: no hidden paths, no data/dist/node_modules, no
//! credential-looking files, no build/out/coverage/__pycache__, nothing a
//! .gitignore ignores, and never a link. Walked breadth first within bounds,
//! kept for 15 seconds.

pub mod gitignore;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde_json::{json, Value};

use crate::callbacks::{invoke, Callbacks};
use crate::js;
use gitignore::Rule;

const MAX_FILES: f64 = 30000.0;
const MAX_DIRS: f64 = 6000.0;
const MAX_DEPTH: f64 = 12.0;
const BUDGET_MS: f64 = 1500.0;
const FRESH_MS: f64 = 15000.0;
const MAX_QUERY: usize = 120;
const DEFAULT_LIMIT: f64 = 8.0;
const MAX_LIMIT: f64 = 25.0;
const IGNORE_FILE_BYTES: u64 = 64 * 1024;
const MENTION_MAX_FILES: usize = 8;
const SKIPPED_FOLDERS: &[&str] = &["build", "out", "coverage", "__pycache__"];

pub type Result<T> = std::result::Result<T, String>;

/// True for a project-relative path the read tool refuses.
pub fn excluded(relative: &str) -> bool {
    let hidden = relative.split(['/', '\\']).any(|part| part.starts_with('.') || ["data", "dist", "node_modules"].iter().any(|name| part.eq_ignore_ascii_case(name)));
    let lower = relative.to_lowercase();
    hidden || [".pem", ".key", ".db", "credentials.json", "settings.json"].iter().any(|end| lower.ends_with(end))
}

/// A name a message can carry and read back: no quote, no control character.
fn speakable(name: &str) -> bool {
    js::utf16_len(name) <= 200 && !name.chars().any(|c| (c as u32) < 0x20 || c == '"')
}

#[derive(Clone)]
struct Entry {
    path: String,
    name: String,
    dir: String,
    depth: f64,
    lname: Vec<u16>,
    lpath: Vec<u16>,
}

fn units(text: &str) -> Vec<u16> {
    text.to_lowercase().encode_utf16().collect()
}

/// `haystack.indexOf(needle, from)` on UTF-16 units.
fn index_of(haystack: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() {
        return (from <= haystack.len()).then_some(from);
    }
    if needle.len() > haystack.len() {
        return None;
    }
    (from..=haystack.len() - needle.len()).find(|at| &haystack[*at..*at + needle.len()] == needle)
}

/// Letters of the query in order, the gaps between them, or None.
fn scattered(text: &[u16], query: &str) -> Option<f64> {
    let mut at: isize = -1;
    let mut gaps = 0.0;
    for c in query.chars() {
        let mut buf = [0u16; 2];
        let char_units = c.encode_utf16(&mut buf);
        let next = index_of(text, char_units, (at + 1) as usize)? as isize;
        if at >= 0 {
            gaps += (next - at - 1) as f64;
        }
        at = next;
    }
    Some(gaps)
}

fn score(entry: &Entry, query: &str) -> Option<f64> {
    if query.is_empty() {
        return Some(100.0 - entry.depth * 5.0);
    }
    let q: Vec<u16> = query.encode_utf16().collect();
    let has_slash = query.contains('/');
    let lname_len = entry.lname.len() as f64;
    let lpath_len = entry.lpath.len() as f64;
    if !has_slash {
        if entry.lname == q {
            return Some(1000.0);
        }
        if entry.lname.starts_with(&q) {
            return Some(900.0 - lname_len / 100.0);
        }
        if let Some(at) = index_of(&entry.lname, &q, 0) {
            return Some(800.0 - at as f64 - lname_len / 100.0);
        }
    }
    if let Some(at) = index_of(&entry.lpath, &q, 0) {
        return Some(700.0 - at as f64 / 10.0 - lpath_len / 100.0);
    }
    if !has_slash {
        if let Some(gaps) = scattered(&entry.lname, query) {
            return Some(500.0 - gaps - lname_len / 100.0);
        }
    }
    scattered(&entry.lpath, query).map(|gaps| 300.0 - gaps / 10.0 - lpath_len / 200.0)
}

fn utf16_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// The best `limit` entries for `query`.
fn rank<'a>(entries: &'a [Entry], query: &str, limit: usize) -> Vec<&'a Entry> {
    let cleaned = query.trim().replace('\\', "/");
    let cleaned = cleaned.strip_prefix("./").unwrap_or(&cleaned);
    let q = js::slice(cleaned, 0, Some(MAX_QUERY as isize)).to_lowercase();
    let mut scored: Vec<(&Entry, f64)> = entries.iter().filter_map(|entry| score(entry, &q).map(|value| (entry, value))).collect();
    scored.sort_by(|a, b| {
        let difference = b.1 - a.1;
        let by_value = if difference > 0.0 { std::cmp::Ordering::Greater } else if difference < 0.0 { std::cmp::Ordering::Less } else { std::cmp::Ordering::Equal };
        by_value
            .then_with(|| a.0.depth.partial_cmp(&b.0.depth).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| a.0.lpath.cmp(&b.0.lpath))
            .then_with(|| utf16_cmp(&a.0.path, &b.0.path))
    });
    scored.into_iter().take(limit).map(|(entry, _)| entry).collect()
}

#[derive(Clone)]
struct Limits {
    files: f64,
    dirs: f64,
    depth: f64,
    budget_ms: f64,
    fresh_ms: f64,
}

fn limits_of(options: &Value) -> Limits {
    let limits = js::get(options, "limits").cloned().unwrap_or(Value::Null);
    let get = |key: &str, fallback: f64| js::get(&limits, key).and_then(Value::as_f64).unwrap_or(fallback);
    Limits { files: get("files", MAX_FILES), dirs: get("dirs", MAX_DIRS), depth: get("depth", MAX_DEPTH), budget_ms: get("budgetMs", BUDGET_MS), fresh_ms: get("freshMs", FRESH_MS) }
}

struct Index {
    root: PathBuf,
    at: Instant,
    entries: Vec<Entry>,
    truncated: bool,
}

fn cache() -> &'static Mutex<Option<Index>> {
    static CACHE: OnceLock<Mutex<Option<Index>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn read_ignore(file: &Path) -> Option<Vec<Rule>> {
    let meta = std::fs::symlink_metadata(file).ok()?;
    if !meta.is_file() || meta.len() > IGNORE_FILE_BYTES {
        return None;
    }
    let text = std::fs::read_to_string(file).ok()?;
    Some(gitignore::parse(&text))
}

struct RuleSet {
    base: String,
    rules: Vec<Rule>,
}

fn walk(base: &Path, limits: &Limits) -> (Vec<Entry>, bool) {
    let started = Instant::now();
    let mut entries = Vec::new();
    let mut dirs = 0.0;
    let mut truncated = false;
    let mut queue: std::collections::VecDeque<(String, f64, std::rc::Rc<Vec<RuleSet>>)> = std::collections::VecDeque::new();
    queue.push_back((String::new(), 0.0, std::rc::Rc::new(Vec::new())));
    while let Some(next) = queue.front() {
        let _ = next;
        if entries.len() as f64 >= limits.files || dirs >= limits.dirs || started.elapsed().as_secs_f64() * 1000.0 > limits.budget_ms {
            truncated = true;
            break;
        }
        let (rel, depth, rules) = queue.pop_front().expect("checked above");
        dirs += 1.0;
        let folder = if rel.is_empty() { base.to_path_buf() } else { rel.split('/').fold(base.to_path_buf(), |path, part| path.join(part)) };
        let Ok(read) = std::fs::read_dir(&folder) else { continue };
        let mut dirents: Vec<(String, std::fs::FileType)> = read.filter_map(|entry| entry.ok()).filter_map(|entry| Some((entry.file_name().to_string_lossy().into_owned(), entry.file_type().ok()?))).collect();
        dirents.sort_by(|a, b| utf16_cmp(&a.0, &b.0));
        let mut here = rules.clone();
        if dirents.iter().any(|(name, kind)| name == ".gitignore" && kind.is_file()) {
            if let Some(parsed) = read_ignore(&folder.join(".gitignore")).filter(|parsed| !parsed.is_empty()) {
                let mut joined: Vec<RuleSet> = rules.iter().map(|set| RuleSet { base: set.base.clone(), rules: set.rules.clone() }).collect();
                joined.push(RuleSet { base: rel.clone(), rules: parsed });
                here = std::rc::Rc::new(joined);
            }
        }
        let ignored = |child: &str, is_directory: bool| {
            let mut verdict = None;
            for set in here.iter() {
                let inside = if set.base.is_empty() { child.to_string() } else { js::slice(child, js::utf16_len(&set.base) as isize + 1, None) };
                if let Some(answer) = gitignore::verdict(&set.rules, &inside, is_directory) {
                    verdict = Some(answer);
                }
            }
            verdict == Some(true)
        };
        for (name, kind) in &dirents {
            if kind.is_symlink() {
                continue;
            }
            let child = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            if excluded(&child) || !speakable(name) {
                continue;
            }
            if kind.is_dir() {
                if SKIPPED_FOLDERS.contains(&name.as_str()) || depth + 1.0 >= limits.depth || ignored(&child, true) {
                    continue;
                }
                queue.push_back((child, depth + 1.0, here.clone()));
            } else if kind.is_file() {
                if js::utf16_len(&child) > 300 || ignored(&child, false) {
                    continue;
                }
                entries.push(Entry { lname: units(name), lpath: units(&child), path: child, name: name.clone(), dir: rel.clone(), depth });
            }
        }
    }
    (entries, truncated || !queue.is_empty())
}

fn real_root(options: &Value, callbacks: &dyn Callbacks) -> Option<PathBuf> {
    let root = js::get(options, "root")?;
    let given = if crate::callbacks::is_function(root) { invoke(callbacks, root, vec![]).ok()? } else { root.clone() };
    if !js::truthy(&given) {
        return None;
    }
    let real = std::fs::canonicalize(js::string(&given)).ok()?;
    let text = real.to_string_lossy().into_owned();
    Some(text.strip_prefix(r"\\?\").map(PathBuf::from).unwrap_or(real))
}

/// search({ query, limit }): { ok, files: [{ path, name, dir }], truncated, scanned }.
pub fn search(options: &Value, request: &Value, callbacks: &dyn Callbacks) -> Value {
    let limits = limits_of(options);
    let Some(root) = real_root(options, callbacks) else {
        return json!({ "ok": false, "error": "Open a project first." });
    };
    let mut slot = cache().lock().unwrap_or_else(|poison| poison.into_inner());
    let fresh = slot.as_ref().is_some_and(|index| index.root == root && (index.at.elapsed().as_secs_f64() * 1000.0) < limits.fresh_ms);
    if !fresh {
        let (entries, truncated) = walk(&root, &limits);
        *slot = Some(Index { root: root.clone(), at: Instant::now(), entries, truncated });
    }
    let index = slot.as_ref().expect("built above");
    let wanted = js::get(request, "limit").map_or(f64::NAN, |limit| js::to_number(Some(limit)));
    let count = if wanted.is_finite() { wanted.floor() } else { DEFAULT_LIMIT };
    let count = count.min(MAX_LIMIT).max(1.0) as usize;
    let query = match js::get(request, "query") {
        Some(Value::String(query)) => query.clone(),
        _ => String::new(),
    };
    let top = rank(&index.entries, &query, count);
    json!({
        "ok": true,
        "files": top.iter().map(|entry| json!({ "path": entry.path, "name": entry.name, "dir": entry.dir })).collect::<Vec<_>>(),
        "truncated": index.truncated,
        "scanned": index.entries.len(),
    })
}

/// mentions.cjs cleanPath.
pub fn clean_path(raw: &Value) -> Option<String> {
    let text = if raw.is_null() { String::new() } else { js::string(raw) };
    let path = text.trim().replace('\\', "/");
    let path = path.strip_prefix("./").unwrap_or(&path).to_string();
    if path.is_empty() || js::utf16_len(&path) > 300 || path.chars().any(|c| (c as u32) < 0x20 || c == '"') {
        return None;
    }
    if path.starts_with('/') || path.contains(':') {
        return None;
    }
    let parts: Vec<&str> = path.split('/').collect();
    if parts.iter().any(|part| part.is_empty() || *part == "." || *part == "..") {
        return None;
    }
    Some(parts.join("/"))
}

/// resolve(paths): which named paths are files inside the project, through real folders only.
pub fn resolve(options: &Value, paths: &Value, callbacks: &dyn Callbacks) -> Value {
    let Some(list) = paths.as_array() else { return json!([]) };
    let Some(root) = real_root(options, callbacks) else { return json!([]) };
    let mut found: Vec<String> = Vec::new();
    for candidate in list.iter().take(MENTION_MAX_FILES * 2) {
        if found.len() >= MENTION_MAX_FILES {
            break;
        }
        let Some(clean) = clean_path(candidate) else { continue };
        if excluded(&clean) || !speakable(&clean) || found.contains(&clean) {
            continue;
        }
        let parts: Vec<&str> = clean.split('/').collect();
        let mut current = root.clone();
        let mut ok = true;
        for (index, part) in parts.iter().enumerate() {
            current = current.join(part);
            match std::fs::symlink_metadata(&current) {
                Ok(meta) => ok = if index == parts.len() - 1 { meta.is_file() } else { meta.is_dir() },
                Err(_) => {
                    ok = false;
                }
            }
            if !ok {
                break;
            }
        }
        if ok {
            found.push(clean);
        }
    }
    json!(found)
}

pub fn forget() {
    if let Ok(mut slot) = cache().lock() {
        *slot = None;
    }
}

/// gitignore-lite for the parity tests: verdicts of `text`'s rules for [path, isDirectory] pairs.
pub fn gitignore_verdicts(text: &str, pairs: &Value) -> Value {
    let rules = gitignore::parse(text);
    Value::Array(
        pairs
            .as_array()
            .into_iter()
            .flatten()
            .map(|pair| match gitignore::verdict(&rules, &js::string(&pair[0]), pair[1] == json!(true)) {
                Some(answer) => json!(answer),
                None => Value::Null,
            })
            .collect(),
    )
}

pub fn call(function: &str, args: &[Value], callbacks: &dyn Callbacks) -> Result<Value> {
    let arg = |index: usize| args.get(index).cloned().unwrap_or(Value::Null);
    match function {
        "search" => Ok(search(&arg(0), &arg(1), callbacks)),
        "resolve" => Ok(resolve(&arg(0), &arg(1), callbacks)),
        "forget" => {
            forget();
            Ok(Value::Null)
        }
        "gitignoreVerdicts" => Ok(gitignore_verdicts(&js::string(&arg(0)), &arg(1))),
        other => Err(format!("files.{other} has not moved to Rust")),
    }
}
