//! scripts/git-actions.cjs in Rust: everything that reads or changes a
//! project's Git state for the Git chip, the launch list, Save-and-push,
//! Publish and Link. Same answers for the same folders, same rules: git and
//! gh run without a shell from argv lists, prompts off; only the paths the
//! preview lists are ever committed (never `git add -A`, never --no-verify);
//! nothing forces, rebases, merges, stashes or deletes; every message that
//! leaves is scrubbed of logins and tokens.
//!
//! The JavaScript's injected IO (execFile, fs) is real IO here. What stays in
//! the engine and is called back: the engine's environment (`env`, so a PATH
//! refreshed at run time is the one git and gh are found on), a push's
//! project `check`, and link's `isListed`.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use super::rules;
use super::run::{self, Options, Ran, MIB};
use crate::callbacks::{self, Callbacks};
use crate::js;
use crate::js_regex;
use crate::paths;

const WARN_BYTES: f64 = 50.0 * MIB as f64;
const REFUSE_BYTES: f64 = 100.0 * MIB as f64;
const SCAN_BYTES: f64 = MIB as f64;
const MAX_FILES: usize = 5000;
const SHOWN_FILES: usize = 500;
pub const GLANCE_CAP_MS: u64 = 1500;
const GLANCE_CONCURRENCY: usize = 3;
const LOCK_DELAYS: [u64; 3] = [0, 250, 1500];
const ARGV_LIMIT: usize = 8000;
const KILL_GRACE_MS: u64 = 5000;
const CHECK_CAP_MS: u64 = 15 * 60 * 1000;

mod say {
    pub const GIT_MISSING: &str = "Git is not installed.";
    pub const TIMEOUT: &str = "Git took too long to answer. Try again.";
    pub const NOT_REPO: &str = "This project folder is not a Git repository, so there is nothing to save.";
    pub const NOTHING: &str = "Nothing to save.";
    pub const BUILDERS: &str = "Agents are still changing files in this project. Wait for them, or save anyway.";
    pub const LOCKED: &str = "Another session is committing; try again.";
    pub const IDENTITY: &str = "Git does not know who you are on this PC. Sign in to GitHub, or set your name and email in Git.";
    pub const WEAK_DRIVE: &str = "This drive cannot keep a Git project reliably. Move the project to an NTFS drive first.";
    pub const NO_REMOTE: &str = "This project is only on this PC. Publish it to GitHub once to link your PCs.";
    pub const NO_COMMITS: &str = "No commits yet. Save a first commit, then publish.";
    pub const SIGNED_OUT: &str = "Sign in to GitHub first.";
    pub const NOT_LISTED: &str = "Choose a repository from your list.";
    pub const GH_MISSING: &str = "GitHub CLI is not installed on this PC.";
    pub const TOO_BROAD: &str = "This folder is your whole user folder or a whole drive, which is too much for one project. Choose the project's own folder.";
    pub const HAS_REMOTE: &str = "This project already has a GitHub address. Studio never replaces it.";
}

fn refusal_text(kind: &str) -> String {
    match kind {
        "nested" => "This folder is inside another Git project, so Studio leaves saving to that project.".into(),
        "merge" => "A merge is in progress in this project. Finish or abort it, then save.".into(),
        "rebase" => "A rebase is in progress in this project. Finish or abort it, then save.".into(),
        "cherry-pick" => "A cherry-pick is in progress in this project. Finish or abort it, then save.".into(),
        "revert" => "A revert is in progress in this project. Finish or abort it, then save.".into(),
        "unmerged" => "Some files are in conflict. Resolve them, then save.".into(),
        "detached" => "This checkout is not on a branch. Start a branch here, then save.".into(),
        _ => format!("More than {MAX_FILES} files changed. Ignore generated folders in a .gitignore, or save fewer at a time."),
    }
}

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut out = Map::new();
    for (key, value) in pairs {
        out.insert(key.to_string(), value);
    }
    Value::Object(out)
}

fn opt(value: Option<String>) -> Value {
    value.map_or(Value::Null, Value::String)
}

fn fold(value: &str) -> String {
    value.to_lowercase()
}

/// `Math.ceil(bytes / MIB)`.
fn mb(bytes: f64) -> f64 {
    (bytes / MIB as f64).ceil()
}

/// Runs `task` over `items` on up to `workers` threads, answers in order.
fn par_map<T: Sync, R: Send + Default + Clone>(items: &[T], workers: usize, task: impl Fn(&T) -> R + Sync) -> Vec<R> {
    if items.len() <= 1 || workers <= 1 {
        return items.iter().map(&task).collect();
    }
    let out: Mutex<Vec<R>> = Mutex::new(vec![R::default(); items.len()]);
    let next = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..workers.min(items.len()) {
            scope.spawn(|| loop {
                let index = next.fetch_add(1, Ordering::SeqCst);
                let Some(item) = items.get(index) else { break };
                let value = task(item);
                out.lock().unwrap_or_else(|poison| poison.into_inner())[index] = value;
            });
        }
    });
    out.into_inner().unwrap_or_else(|poison| poison.into_inner())
}

// ---- pure helpers (git-actions `parts`) ----

#[derive(Default, Debug, Clone)]
pub struct Headers {
    pub oid: Option<String>,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ab: Option<(f64, f64)>,
    pub entries: usize,
}

/// `parseHeaders(text)`: `git status --porcelain=v2 --branch` headers, and how many entries follow.
pub fn parse_headers(text: &str) -> Headers {
    let mut head = Headers::default();
    for line in js::split_lines(text) {
        if line.is_empty() {
            continue;
        }
        if !line.starts_with("# ") {
            head.entries += 1;
            continue;
        }
        let parts: Vec<&str> = line.split(' ').collect();
        let key = parts.get(1).copied().unwrap_or("");
        let value = parts.get(2..).map(|rest| rest.join(" ")).unwrap_or_default();
        match key {
            "branch.oid" => head.oid = Some(value),
            "branch.head" => head.branch = Some(value),
            "branch.upstream" => head.upstream = Some(value),
            "branch.ab" => {
                if let Some(found) = js_regex!(r"^\+(\d+) -(\d+)$", "").captures(&value) {
                    head.ab = Some((js::to_number(Some(&json!(&found[1]))), js::to_number(Some(&json!(&found[2])))));
                }
            }
            _ => {}
        }
    }
    head
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub kind: char,
    pub xy: String,
    pub path: String,
    pub from: Option<String>,
}

/// `parseStatusZ(text)`: the -z form, a rename's old path in the next token.
pub fn parse_status_z(text: &str) -> (Headers, Vec<Entry>) {
    let tokens: Vec<&str> = text.split('\0').collect();
    let mut head = Headers::default();
    let mut entries = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        let token = tokens[index];
        if token.is_empty() {
            index += 1;
            continue;
        }
        if token.starts_with("# ") {
            let parts: Vec<&str> = token.split(' ').collect();
            let value = parts.get(2..).map(|rest| rest.join(" ")).unwrap_or_default();
            match parts.get(1).copied().unwrap_or("") {
                "branch.oid" => head.oid = Some(value),
                "branch.head" => head.branch = Some(value),
                "branch.upstream" => head.upstream = Some(value),
                _ => {}
            }
            index += 1;
            continue;
        }
        let first = token.chars().next().unwrap_or(' ');
        let found = match first {
            '1' => js_regex!(r"^1 (\S{2}) (?:\S+ ){6}([\s\S]+)$", "").captures(token),
            '2' => js_regex!(r"^2 (\S{2}) (?:\S+ ){7}([\s\S]+)$", "").captures(token),
            'u' => js_regex!(r"^u (\S{2}) (?:\S+ ){8}([\s\S]+)$", "").captures(token),
            _ => None,
        };
        if let Some(found) = found {
            let from = (first == '2').then(|| tokens.get(index + 1).copied().unwrap_or("").to_string());
            entries.push(Entry { kind: first, xy: found[1].to_string(), path: found[2].to_string(), from });
            if first == '2' {
                index += 1;
            }
        } else if first == '?' {
            entries.push(Entry { kind: '?', xy: "??".into(), path: js::slice(token, 2, None), from: None });
        }
        index += 1;
    }
    (head, entries)
}

fn status_of(xy: &str) -> &'static str {
    if xy.contains('D') {
        "deleted"
    } else if xy.contains('A') || xy == "??" {
        "new"
    } else {
        "changed"
    }
}

/// `unquote(value)`: a name git quoted (a quote, a backslash or a control character in it).
pub fn unquote(value: &str) -> String {
    let inner: Vec<u16> = js::slice(value, 1, Some(-1)).encode_utf16().collect();
    let mut bytes: Vec<u8> = Vec::new();
    let unit_char = |unit: u16| char::from_u32(u32::from(unit));
    let mut index = 0;
    while index < inner.len() {
        let unit = inner[index];
        let octal: Option<u32> = (unit == u16::from(b'\\'))
            .then(|| inner.get(index + 1..index + 4))
            .flatten()
            .filter(|digits| digits.iter().all(|d| (u16::from(b'0')..=u16::from(b'7')).contains(d)))
            .map(|digits| digits.iter().fold(0u32, |sum, d| sum * 8 + u32::from(*d - u16::from(b'0'))));
        let named = |next: Option<&u16>| match next.copied().and_then(unit_char) {
            Some('t') => Some(9u8),
            Some('n') => Some(10),
            Some('r') => Some(13),
            Some('"') => Some(34),
            Some('\\') => Some(92),
            _ => None,
        };
        if let Some(code) = octal {
            bytes.push((code & 0xff) as u8);
            index += 4;
            continue;
        }
        if unit == u16::from(b'\\') {
            if let Some(byte) = named(inner.get(index + 1)) {
                bytes.push(byte);
                index += 2;
                continue;
            }
        }
        // One UTF-16 unit as UTF-8; half a surrogate pair becomes U+FFFD, as Buffer.from does.
        match unit_char(unit) {
            Some(c) => {
                let mut buf = [0u8; 4];
                bytes.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            }
            None => bytes.extend_from_slice(&[0xef, 0xbf, 0xbd]),
        }
        index += 1;
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// `addedLines(diff)`: the lines a `git diff HEAD -U0` adds, by file, in first-seen order.
pub fn added_lines(diff: &str) -> Vec<(String, String)> {
    let mut order: Vec<String> = Vec::new();
    let mut added: HashMap<String, Vec<String>> = HashMap::new();
    let mut file: Option<String> = None;
    let mut old_left: f64 = 0.0;
    let mut new_left: f64 = 0.0;
    for line in diff.split('\n') {
        if old_left > 0.0 || new_left > 0.0 {
            if line.starts_with('-') {
                old_left -= 1.0;
            } else if line.starts_with('+') {
                new_left -= 1.0;
                if let Some(name) = &file {
                    added.get_mut(name).expect("listed").push(js::slice(line, 1, None));
                }
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("+++ ") {
            let mut name = js_regex!(r"\t.*$", "").replace(rest, "").into_owned();
            if name.starts_with('"') {
                name = unquote(&name);
            }
            file = if name == "/dev/null" { None } else { Some(js_regex!(r"^b\/", "").replace(&name, "").into_owned()) };
            if let Some(name) = &file {
                if !added.contains_key(name) {
                    added.insert(name.clone(), Vec::new());
                    order.push(name.clone());
                }
            }
        } else if line.starts_with("@@") {
            if let Some(hunk) = js_regex!(r"^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@", "").captures(line) {
                old_left = hunk.get(1).map_or(1.0, |m| js::to_number(Some(&json!(m.as_str()))));
                new_left = hunk.get(2).map_or(1.0, |m| js::to_number(Some(&json!(m.as_str()))));
            }
        }
    }
    order.into_iter().map(|name| {
        let lines = added.remove(&name).unwrap_or_default().join("\n");
        (name, lines)
    }).collect()
}

/// `ignoreMatcher(text)`: .gitignore lines for a folder with no git to ask.
pub fn ignore_matcher(text: &str) -> impl Fn(&str, bool) -> bool {
    let mut parsed: Vec<(bool, bool, regex::Regex)> = Vec::new();
    for raw in js::split_lines(text) {
        let mut line = js::trim(raw).to_string();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let negate = line.starts_with('!');
        if negate {
            line = js::slice(&line, 1, None);
        }
        let dir_only = line.ends_with('/');
        if dir_only {
            line = js::slice(&line, 0, Some(-1));
        }
        let anchored = line.contains('/');
        let line = line.strip_prefix('/').unwrap_or(&line).to_string();
        let mut body = String::new();
        for c in line.chars() {
            match c {
                '*' => body.push_str("[^/]*"),
                '?' => body.push_str("[^/]"),
                '.' | '+' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\' => {
                    body.push('\\');
                    body.push(c);
                }
                other => body.push(other),
            }
        }
        let source = if anchored { format!("^{body}$") } else { format!("(?:^|/){body}$") };
        // A line JavaScript cannot build throws there; here it is skipped (a malformed line matches nothing either way).
        let built = std::panic::catch_unwind(|| crate::jsre::compile(&source, ""));
        if let Ok(re) = built {
            parsed.push((negate, dir_only, re));
        }
    }
    move |rel_path: &str, is_dir: bool| {
        let mut ignored = false;
        for (negate, dir_only, re) in &parsed {
            if (!dir_only || is_dir) && re.is_match(rel_path) {
                ignored = !negate;
            }
        }
        ignored
    }
}

fn ignore_lines(text: &str) -> Vec<String> {
    js::split_lines(text).into_iter().map(js::trim).filter(|line| !line.is_empty() && !line.starts_with('#')).map(String::from).collect()
}

/// `pathspec(list)`: on the command line while short, else NUL-separated on stdin.
pub fn pathspec(list: &[String]) -> (Vec<String>, Option<String>) {
    let total: usize = list.iter().map(|item| js::utf16_len(item) + 3).sum();
    if total <= ARGV_LIMIT {
        let mut args = vec!["--".to_string()];
        args.extend(list.iter().cloned());
        return (args, None);
    }
    (vec!["--pathspec-from-file=-".into(), "--pathspec-file-nul".into()], Some(format!("{}\0", list.join("\0"))))
}

// ---- a changed file, as the preview carries it ----

#[derive(Clone, Debug, Default)]
struct FileRow {
    path: String,
    status: &'static str,
    /// None for a tracked file of a first publish (it has no `untracked` key).
    untracked: Option<bool>,
    unmerged: bool,
    tracked: bool,
    bytes: Option<f64>,
    blocked: Option<Value>,
    warn: Option<Value>,
}

impl FileRow {
    fn new(path: String, status: &'static str, untracked: bool) -> FileRow {
        FileRow { path, status, untracked: Some(untracked), ..FileRow::default() }
    }

    fn blocked_kind(&self) -> Option<&str> {
        self.blocked.as_ref().and_then(|blocked| blocked["kind"].as_str())
    }
}

fn stopped(kind: &str, rule: Option<String>, label: &str, text: String) -> Value {
    obj(vec![("kind", json!(kind)), ("rule", opt(rule)), ("label", json!(label)), ("text", json!(text))])
}

fn flag_name(file: &mut FileRow) {
    let Some(hit) = rules::path_blocked(&file.path) else { return };
    if hit.kind == "secret" && file.status != "deleted" {
        file.blocked = Some(stopped("secret", Some(hit.rule), hit.label, format!("Stopped: {} in {}.", hit.label, file.path)));
    } else if hit.kind == "generated" && file.status == "new" {
        file.blocked = Some(stopped("generated", Some(hit.rule), hit.label, format!("{} is {}; Studio leaves it out.", file.path, hit.label)));
    }
}

fn flag_size(file: &mut FileRow) {
    let bytes = file.bytes.unwrap_or(0.0);
    if bytes == 0.0 || bytes.is_nan() || file.status == "deleted" || file.blocked.is_some() {
        return;
    }
    let size = js::number_string(mb(bytes));
    if bytes > REFUSE_BYTES {
        let mut blocked = stopped("too-large", None, &format!("{size} MB"), format!("{} is {size} MB; GitHub refuses files over 100 MB.", file.path));
        blocked["mb"] = js::num(mb(bytes));
        file.blocked = Some(blocked);
    } else if bytes > WARN_BYTES {
        file.warn = Some(obj(vec![
            ("kind", json!("large")),
            ("label", json!(format!("{size} MB"))),
            ("text", json!(format!("{} is {size} MB. GitHub warns about files over 50 MB.", file.path))),
            ("mb", js::num(mb(bytes))),
        ]));
    }
}

fn flag_text(file: &mut FileRow, text: Option<&str>) {
    let Some(text) = text.filter(|text| !text.is_empty()) else { return };
    let mut body = std::borrow::Cow::Borrowed(text);
    if text.contains('\0') {
        // UTF-16 text reads as letters with a NUL between them: look at the letters. Anything else with NULs is binary.
        if text.matches('\0').count() * 4 < js::utf16_len(text) {
            return;
        }
        body = std::borrow::Cow::Owned(text.replace(['\0', '\u{fffd}', '\u{feff}'], ""));
    }
    let (stop, maybe) = rules::scan_text(&body);
    if let Some(rule) = stop {
        file.blocked = Some(stopped("secret", Some(rule.id.into()), rule.label, format!("Stopped: {} in {}.", rule.label, file.path)));
    } else if let Some(rule) = maybe {
        if file.warn.is_none() {
            file.warn = Some(obj(vec![("kind", json!("maybe-secret")), ("label", json!(rule.label)), ("text", json!(format!("{} may be in {}. Look before saving.", rule.label, file.path)))]));
        }
    }
}

fn blocked_refusal(file: &FileRow) -> Value {
    let blocked = file.blocked.clone().unwrap_or(Value::Null);
    let text = blocked["text"].clone();
    if blocked["kind"] == "too-large" {
        return obj(vec![("kind", json!("too-large")), ("text", text.clone()), ("fix", json!("leave-out-ignore")), ("state", json!("too-large")), ("detail", text), ("file", json!(file.path)), ("mb", blocked["mb"].clone())]);
    }
    obj(vec![("kind", json!("secret")), ("text", text.clone()), ("fix", json!("leave-out")), ("state", json!("blocked-secret")), ("detail", text), ("file", json!(file.path)), ("label", blocked["label"].clone())])
}

fn shown(file: &FileRow) -> Value {
    let mut pairs = vec![
        ("path", json!(file.path)),
        ("status", json!(file.status)),
        ("bytes", js::num(file.bytes.unwrap_or(0.0))),
        ("include", json!(file.blocked.is_none())),
    ];
    if let Some(untracked) = file.untracked {
        pairs.push(("untracked", json!(untracked)));
    }
    if let Some(blocked) = &file.blocked {
        pairs.push(("blocked", blocked.clone()));
    }
    if let Some(warn) = &file.warn {
        pairs.push(("warn", warn.clone()));
    }
    obj(pairs)
}

/// One folder's view of what changed (git-actions `changes`).
struct View {
    is_repo: bool,
    unborn: bool,
    detached: bool,
    branch: Option<String>,
    files: Vec<FileRow>,
    refusal: Option<Value>,
}

/// What readGlance found in a repository.
struct Read {
    unborn: bool,
    detached: bool,
    branch: Option<String>,
    upstream: Option<String>,
    ahead: f64,
    behind: f64,
    dirty: usize,
    url: String,
    started: Instant,
    budget_ms: u64,
}

impl Read {
    fn left(&self) -> u64 {
        if self.budget_ms > 0 {
            self.budget_ms.saturating_sub(self.started.elapsed().as_millis() as u64).max(100)
        } else {
            20000
        }
    }
}

enum Glanced {
    Read(Read),
    NotRepo,
    Failed { kind: &'static str, error: String },
}

fn binary_name(path: &str) -> bool {
    js_regex!(r"\.(?:png|jpe?g|gif|webp|bmp|ico|icns|tiff?|psd|mp[34]|m4[av]|wav|ogg|oga|ogv|flac|aac|mov|avi|mkv|webm|zip|gz|tgz|7z|rar|bz2|xz|tar|pdf|woff2?|ttf|otf|eot|exe|dll|so|dylib|bin|dat|wasm|node|pak|asar|blend|fbx|glb|db|sqlite3?|pyc|class|jar)$", "i").is_match(path)
}

/// `fs.realpath.native`, without Windows' `\\?\` prefix.
fn real_path(path: &str) -> Option<String> {
    let found = std::fs::canonicalize(path).ok()?;
    let text = found.to_string_lossy().into_owned();
    Some(match text.strip_prefix(r"\\?\UNC\") {
        Some(rest) => format!(r"\\{rest}"),
        None => text.strip_prefix(r"\\?\").map(String::from).unwrap_or(text),
    })
}

/// A path is a root when its parent is itself: `C:\` or `\\server\share\`.
fn is_root(path: &str) -> bool {
    if cfg!(windows) {
        let lower = path.replace('/', "\\");
        if lower.len() <= 3 && js_regex!(r"^[A-Za-z]:\\?$", "").is_match(&lower) {
            return true;
        }
        if let Some(rest) = lower.strip_prefix("\\\\") {
            return rest.trim_end_matches('\\').split('\\').count() <= 2;
        }
        lower == "\\"
    } else {
        path == "/"
    }
}

/// Whether `target` lies outside `base` (path.relative gives "..", "..\x" or an absolute path).
fn leads_out(base: &str, target: &str) -> bool {
    let norm = |value: &str| paths::resolve(value).to_lowercase().trim_end_matches(['\\', '/']).to_string();
    let base = norm(base);
    let target = norm(target);
    if target == base {
        return false;
    }
    !target.starts_with(&format!("{base}{}", paths::SEP))
}

fn path_join_all(root: &str, rel: &str) -> String {
    rel.split('/').fold(root.to_string(), |at, part| paths::join(&at, part))
}

fn is_absolute(path: &str) -> bool {
    if cfg!(windows) {
        js_regex!(r"^(?:[A-Za-z]:[\\/]|[\\/])", "").is_match(path)
    } else {
        path.starts_with('/')
    }
}

/// `path.resolve(root, item)`.
fn resolve_in(root: &str, item: &str) -> String {
    if is_absolute(item) {
        paths::resolve(item)
    } else {
        paths::resolve(&paths::join(root, item))
    }
}

/// One public call's world: the engine's environment and the collaborators it was handed.
pub struct Ctx<'a> {
    callbacks: &'a dyn Callbacks,
    options: &'a Value,
    env: Value,
    kill_grace_ms: u64,
    check_cap_ms: u64,
    pub glance_cap_ms: u64,
}

fn number_option(options: &Value, key: &str) -> Option<u64> {
    js::get(options, key).and_then(js::finite).filter(|value| *value >= 0.0).map(|value| value as u64)
}

impl<'a> Ctx<'a> {
    pub fn new(options: &'a Value, callbacks: &'a dyn Callbacks) -> Ctx<'a> {
        let env = match js::get(options, "env") {
            Some(handle) if callbacks::is_function(handle) => callbacks::invoke(callbacks, handle, vec![]).ok().filter(Value::is_object),
            Some(value @ Value::Object(_)) => Some(value.clone()),
            _ => None,
        }
        .unwrap_or_else(|| Value::Object(std::env::vars().map(|(key, value)| (key, Value::String(value))).collect()));
        Ctx {
            callbacks,
            options,
            env,
            kill_grace_ms: number_option(options, "killGraceMs").unwrap_or(KILL_GRACE_MS),
            check_cap_ms: number_option(options, "checkCapMs").unwrap_or(CHECK_CAP_MS),
            glance_cap_ms: number_option(options, "glanceCapMs").unwrap_or(GLANCE_CAP_MS),
        }
    }

    fn env_text(&self, key: &str) -> Option<String> {
        js::get(&self.env, key).and_then(Value::as_str).map(String::from)
    }

    fn now_ms(&self) -> f64 {
        match js::get(self.options, "now") {
            Some(handle) if callbacks::is_function(handle) => callbacks::invoke(self.callbacks, handle, vec![]).ok().and_then(|value| value.as_f64()).unwrap_or_else(js::now_ms),
            _ => js::now_ms(),
        }
    }

    fn homes(&self) -> Vec<Value> {
        match js::get(self.options, "homes") {
            Some(handle) if callbacks::is_function(handle) => match callbacks::invoke(self.callbacks, handle, vec![]) {
                Ok(Value::Array(list)) => list,
                _ => vec![],
            },
            _ => std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map(|home| vec![json!(home)]).unwrap_or_default(),
        }
    }

    // ---- failures ----

    fn fail(&self, kind: &str, error: &str, extra: Vec<(&str, Value)>) -> Value {
        let mut out = Map::new();
        out.insert("ok".into(), json!(false));
        out.insert("kind".into(), json!(kind));
        out.insert("error".into(), json!(clean(error)));
        for (key, value) in extra {
            let value = match (key, &value) {
                ("detail", Value::String(text)) => json!(clean(text)),
                _ => value,
            };
            out.insert(key.to_string(), value);
        }
        Value::Object(out)
    }

    fn last_line(&self, value: &str) -> String {
        let lead = js_regex!(r"^(?:remote|error|fatal):\s*", "i");
        let hint = js_regex!(r"^hint:", "i");
        let line = js::split_lines(value)
            .into_iter()
            .map(|line| js::trim(&lead.replace(line, "")).to_string())
            .filter(|line| !line.is_empty() && !hint.is_match(line))
            .next_back()
            .unwrap_or_default();
        clean(&line)
    }

    fn git_failure(&self, result: &Ran, what: &str) -> Value {
        if result.missing {
            return self.fail("git-missing", say::GIT_MISSING, vec![]);
        }
        if result.timed_out {
            return self.fail("timeout", say::TIMEOUT, vec![]);
        }
        let line = self.last_line(&result.stderr);
        self.fail("git", &format!("{what}{}", if line.is_empty() { ".".to_string() } else { format!(": {line}") }), vec![])
    }

    fn gh_failure(&self, result: &Ran, repo: &str) -> Value {
        let stderr = if !result.stderr.is_empty() { result.stderr.clone() } else if result.missing { "spawn gh ENOENT".into() } else { String::new() };
        let cls = rules::classify_gh(&stderr, repo, "", "");
        self.fail(cls["kind"].as_str().unwrap_or(""), cls["text"].as_str().unwrap_or(""), vec![("fix", cls["fix"].clone()), ("detail", cls["detail"].clone())])
    }

    fn push_failure(&self, result: &Ran, branch: &str) -> Value {
        if result.missing {
            return self.fail("git-missing", say::GIT_MISSING, vec![]);
        }
        let cls = rules::classify_push(&result.stderr, result.timed_out, branch);
        let refusal = match &cls {
            Value::Object(map) => Value::Object(map.iter().map(|(key, value)| (key.clone(), match value {
                Value::String(text) => json!(clean(text)),
                other => other.clone(),
            })).collect()),
            other => other.clone(),
        };
        self.fail(cls["kind"].as_str().unwrap_or(""), cls["text"].as_str().unwrap_or(""), vec![("fix", cls["fix"].clone()), ("refusal", refusal)])
    }

    fn folder_missing(&self) -> Value {
        self.fail("folder-missing", rules::FOLDER_MISSING, vec![])
    }

    // ---- running git and gh ----

    fn run(&self, command: &str, args: &[&str], cwd: Option<&str>, timeout_ms: u64, reads: bool, input: Option<String>, max_buffer: usize) -> Ran {
        let args: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
        run::run(command, &args, &Options { cwd, timeout_ms, reads, input, max_buffer }, &self.env, self.kill_grace_ms, &clean)
    }

    fn git_read(&self, cwd: &str, args: &[&str], timeout_ms: u64) -> Ran {
        self.run("git", args, Some(cwd), timeout_ms, true, None, 4 * MIB)
    }

    fn git_read_big(&self, cwd: &str, args: &[&str], timeout_ms: u64, max_buffer: usize) -> Ran {
        self.run("git", args, Some(cwd), timeout_ms, true, None, max_buffer)
    }

    fn git_write(&self, cwd: &str, args: &[&str], timeout_ms: u64, input: Option<String>) -> Ran {
        self.run("git", args, Some(cwd), timeout_ms, false, input, 4 * MIB)
    }

    fn gh(&self, args: &[&str], cwd: Option<&str>, timeout_ms: u64) -> Ran {
        self.run("gh", args, cwd, timeout_ms, false, None, 4 * MIB)
    }

    /// A write that finds the index busy tries again after 250 ms and 1.5 s; `locked` says the last answer was that.
    fn git_locked(&self, cwd: &str, args: &[&str], timeout_ms: u64, input: Option<String>) -> (Ran, bool) {
        let mut last = Ran::default();
        for delay in LOCK_DELAYS {
            if delay > 0 {
                std::thread::sleep(Duration::from_millis(delay));
            }
            last = self.git_write(cwd, args, timeout_ms, input.clone());
            if last.ok || !js_regex!(r"index\.lock|Unable to create '[^']*\.lock'|another git process seems to be running", "i").is_match(&last.stderr) {
                return (last, false);
            }
        }
        (last, true)
    }

    // ---- the local look ----

    fn read_glance(&self, root: &str, budget_ms: u64) -> Glanced {
        let started = Instant::now();
        let read = Read { unborn: false, detached: false, branch: None, upstream: None, ahead: 0.0, behind: 0.0, dirty: 0, url: String::new(), started, budget_ms };
        let left = read.left();
        let (status, remote) = std::thread::scope(|scope| {
            let remote = scope.spawn(|| self.git_read(root, &["remote", "get-url", "origin"], left));
            let status = self.git_read(root, &["status", "--porcelain=v2", "--branch"], left);
            (status, remote.join().unwrap_or_default())
        });
        if !status.ok {
            if status.missing {
                return Glanced::Failed { kind: "git-missing", error: String::new() };
            }
            if js_regex!(r"not a git repository", "i").is_match(&status.stderr) {
                return Glanced::NotRepo;
            }
            return Glanced::Failed { kind: if status.timed_out { "timeout" } else { "git" }, error: self.last_line(&status.stderr) };
        }
        let head = parse_headers(&status.stdout);
        let unborn = head.oid.as_deref() == Some("(initial)");
        let detached = head.branch.as_deref() == Some("(detached)");
        Glanced::Read(Read {
            unborn,
            detached,
            branch: if detached { None } else { head.branch.filter(|branch| !branch.is_empty()) },
            // A branch whose upstream is gone has no ahead/behind line: it counts as not pushed.
            upstream: if head.ab.is_some() { head.upstream.filter(|upstream| !upstream.is_empty()) } else { None },
            ahead: head.ab.map_or(0.0, |ab| ab.0),
            behind: head.ab.map_or(0.0, |ab| ab.1),
            dirty: head.entries,
            url: if remote.ok { js::trim(&remote.stdout).to_string() } else { String::new() },
            ..read
        })
    }

    fn not_a_repo(available: bool) -> Value {
        json!({ "isRepo": false, "unborn": false, "branch": null, "detached": false, "dirty": 0, "ahead": 0, "behind": 0, "upstream": null, "remote": null, "main": null, "onDefault": true, "available": available })
    }

    /// `glance(root, { budgetMs })`: the chip's local look, or null when nothing could be read.
    pub fn glance(&self, root: &Value, budget_ms: u64) -> Value {
        let Some(root) = root.as_str().filter(|root| !root.is_empty()) else { return Value::Null };
        if !Path::new(root).exists() {
            return Self::not_a_repo(false);
        }
        let read = match self.read_glance(root, budget_ms) {
            Glanced::Read(read) => read,
            Glanced::NotRepo => return Self::not_a_repo(true),
            Glanced::Failed { .. } => return Value::Null,
        };
        let mut main = match read.branch.as_deref() {
            Some(branch @ ("main" | "master")) => Some(branch.to_string()),
            _ => None,
        };
        if main.is_none() && !read.url.is_empty() {
            let head = self.git_read(root, &["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], read.left());
            main = if head.ok { js_regex!(r"^origin\/(.+)$", "").captures(js::trim(&head.stdout)).map(|found| found[1].to_string()) } else { None };
        }
        let main = main.unwrap_or_else(|| "main".into());
        let remote = if read.url.is_empty() { Value::Null } else { json!(rules::github_remote(&read.url).unwrap_or_else(|| "other".into())) };
        let on_default = read.unborn || (!read.detached && read.branch.as_deref() == Some(main.as_str()));
        obj(vec![
            ("isRepo", json!(true)),
            ("unborn", json!(read.unborn)),
            ("branch", opt(read.branch)),
            ("detached", json!(read.detached)),
            ("dirty", json!(read.dirty)),
            ("ahead", js::num(read.ahead)),
            ("behind", js::num(read.behind)),
            ("upstream", opt(read.upstream)),
            ("remote", remote),
            ("main", json!(main)),
            ("onDefault", json!(on_default)),
            ("available", json!(true)),
        ])
    }

    /// `glanceMany(list)`: [{ id, root }] in, [{ id, glance }] out, three at a time, each capped.
    pub fn glance_many(&self, list: &Value) -> Value {
        let items: Vec<Value> = list.as_array().map(|items| items.iter().take(200).cloned().collect()).unwrap_or_default();
        let cap = self.glance_cap_ms;
        let answers = par_map(&items, GLANCE_CONCURRENCY, |item| {
            let root = match js::get(item, "root") {
                Some(value) if !value.is_null() => value.clone(),
                _ => js::get(item, "path").cloned().unwrap_or(Value::Null),
            };
            let started = Instant::now();
            let glance = if root.as_str().is_some_and(|root| !root.is_empty()) { self.glance(&root, cap) } else { Value::Null };
            // An answer that came after the cap counts as none, as the JavaScript's timer does.
            let glance = if started.elapsed() > Duration::from_millis(cap) { Value::Null } else { glance };
            json!({ "id": js::or_null(js::get(item, "id")), "glance": glance })
        });
        Value::Array(answers)
    }

    // ---- who commits ----

    pub fn account(&self) -> Value {
        let (version, auth) = std::thread::scope(|scope| {
            let auth = scope.spawn(|| self.gh(&["auth", "status", "--hostname", "github.com"], None, 20000));
            let version = self.run("git", &["--version"], None, 10000, false, None, 4 * MIB);
            (version, auth.join().unwrap_or_default())
        });
        let gh_installed = !auth.missing;
        let account = if gh_installed { rules::signed_in_account(&format!("{}\n{}", auth.stdout, auth.stderr)) } else { None };
        json!({ "ok": true, "account": account, "ghInstalled": gh_installed, "gitInstalled": !version.missing })
    }

    pub fn identity(&self) -> Value {
        let who = self.account();
        if who["ghInstalled"] != json!(true) {
            return self.fail("gh-missing", say::GH_MISSING, vec![("fix", json!("install-gh"))]);
        }
        let Some(account) = who["account"].as_str().map(String::from) else {
            return self.fail("not-signed-in", say::SIGNED_OUT, vec![("fix", json!("sign-in"))]);
        };
        let numbered = self.gh(&["api", "user", "--jq", r#".login + " " + (.id | tostring)"#], None, 15000);
        let found = if numbered.ok { js_regex!(r"^([A-Za-z0-9-]{1,39}) (\d{1,12})\s*$", "").captures(js::trim(&numbered.stdout)).map(|found| (found[1].to_string(), found[2].to_string())) } else { None };
        let email = match found {
            Some((login, id)) => format!("{id}+{login}@users.noreply.github.com"),
            None => format!("{account}@users.noreply.github.com"),
        };
        json!({ "ok": true, "name": account, "email": email })
    }

    fn clean_ident(value: Option<&Value>) -> String {
        let raw = match value {
            None | Some(Value::Null) => String::new(),
            Some(value) => js::string(value),
        };
        let out = js_regex!(r"[\u0000-\u001f\u007f<>]", "g").replace_all(&raw, " ");
        let out = js_regex!(r"\s+", "g").replace_all(&out, " ");
        js::slice(js::trim(&out), 0, Some(200))
    }

    /// Git's own name and address, else the one supplied, else one made from the signed-in login.
    fn identity_of(&self, root: &str, supplied: &Value) -> Value {
        let own = self.git_read(root, &["var", "GIT_AUTHOR_IDENT"], 10000);
        let found = if own.ok { js_regex!(r"^(.*) <([^<>]*)> \d+ [+-]\d{4}\s*$", "").captures(js::trim(&own.stdout)).map(|found| (found[1].to_string(), found[2].to_string())) } else { None };
        if let Some((name, email)) = found.filter(|(name, email)| !name.is_empty() && !email.is_empty()) {
            return json!({ "ok": true, "name": clean(&name), "email": clean(&email), "fromAccount": false });
        }
        let name = Self::clean_ident(js::get(supplied, "name"));
        let email = Self::clean_ident(js::get(supplied, "email"));
        if !name.is_empty() && !email.is_empty() {
            return json!({ "ok": true, "name": name, "email": email, "fromAccount": true });
        }
        let who = self.account();
        if let Some(account) = who["account"].as_str() {
            return json!({ "ok": true, "name": account, "email": format!("{account}@users.noreply.github.com"), "fromAccount": true });
        }
        json!({ "ok": false, "fromAccount": false })
    }

    // ---- what a save would take ----

    fn detect_stacks(&self, root: &str) -> Value {
        let names: Vec<String> = std::fs::read_dir(root).map(|items| items.filter_map(|item| item.ok().map(|item| item.file_name().to_string_lossy().into_owned())).collect()).unwrap_or_default();
        let has = |name: &str| names.iter().any(|item| item == name);
        let mut stacks = Vec::new();
        if has("package.json") {
            stacks.push("node");
        }
        if has("pyproject.toml") || has("requirements.txt") || has("setup.py") {
            stacks.push("python");
        }
        if has("main.lua") || has("conf.lua") {
            stacks.push("love");
        }
        json!(stacks)
    }

    /// Sizes and the by-content stops (`assess`). `added` is the diff's added lines, or None to read files whole.
    fn assess(&self, root: &str, files: &mut [FileRow], added: Option<&HashMap<String, String>>, has_head: bool) {
        for file in files.iter_mut() {
            flag_name(file);
        }
        self.mark_links(root, files);
        let wanted: Vec<usize> = (0..files.len()).filter(|&i| files[i].status != "deleted" && files[i].bytes.is_none() && files[i].blocked_kind() != Some("outside")).collect();
        let sizes = par_map(&wanted, 16, |&index| {
            match std::fs::metadata(path_join_all(root, &files[index].path)) {
                Ok(meta) if meta.is_file() => meta.len() as f64,
                _ => 0.0,
            }
        });
        for (index, size) in wanted.into_iter().zip(sizes) {
            files[index].bytes = Some(size);
        }
        for file in files.iter_mut() {
            flag_size(file);
        }
        let readable: Vec<usize> = (0..files.len()).filter(|&i| files[i].status != "deleted" && files[i].blocked.is_none()).collect();
        // What each file is judged by: the lines its diff adds, nothing (too big to read), or the file itself.
        let texts = par_map(&readable, 16, |&index| -> Option<Option<String>> {
            let file = &files[index];
            if file.status == "changed" && has_head {
                if let Some(lines) = added.and_then(|added| added.get(&file.path)) {
                    return Some(Some(lines.clone()));
                }
            }
            if file.bytes.unwrap_or(0.0) > SCAN_BYTES {
                return None;
            }
            Some(std::fs::read(path_join_all(root, &file.path)).ok().map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))
        });
        for (index, text) in readable.into_iter().zip(texts) {
            let file = &mut files[index];
            match text {
                Some(text) => flag_text(file, text.as_deref()),
                None => {
                    if file.warn.is_none() && !binary_name(&file.path) {
                        file.warn = Some(obj(vec![
                            ("kind", json!("unscanned")),
                            ("label", json!("not checked for keys")),
                            ("text", json!(format!("{} is over 1 MB, so Studio did not look inside it for keys. Look before saving.", file.path))),
                        ]));
                    }
                }
            }
        }
    }

    /// A path reached through a link to somewhere outside the project is left out (`markLinks`).
    fn mark_links(&self, root: &str, files: &mut [FileRow]) {
        let live: Vec<usize> = (0..files.len()).filter(|&i| files[i].status != "deleted" && files[i].blocked.is_none() && !files[i].path.ends_with('/')).collect();
        if live.is_empty() {
            return;
        }
        let Some(base) = real_path(root) else { return };
        let seen: Mutex<HashMap<String, bool>> = Mutex::new(HashMap::new());
        let out_of = |rel: &str| -> bool {
            if let Some(known) = seen.lock().unwrap_or_else(|poison| poison.into_inner()).get(rel) {
                return *known;
            }
            let at = path_join_all(root, rel);
            let answer = match std::fs::symlink_metadata(&at) {
                Ok(meta) if meta.file_type().is_symlink() => real_path(&at).is_some_and(|target| leads_out(&base, &target)),
                _ => false,
            };
            seen.lock().unwrap_or_else(|poison| poison.into_inner()).insert(rel.to_string(), answer);
            answer
        };
        let outside = par_map(&live, 16, |&index| {
            let parts: Vec<&str> = files[index].path.split('/').filter(|part| !part.is_empty()).collect();
            (1..=parts.len()).any(|count| out_of(&parts[..count].join("/")))
        });
        for (index, out) in live.into_iter().zip(outside) {
            if out {
                let path = files[index].path.clone();
                files[index].blocked = Some(stopped("outside", None, "a link to another folder", format!("{path} is reached through a link to somewhere outside this project; Studio leaves it out.")));
            }
        }
    }

    /// Everything different in a folder, ready to show (`changes`). Err is a failure answer.
    fn changes(&self, root: &str) -> Result<View, Value> {
        if !Path::new(root).exists() {
            return Err(self.folder_missing());
        }
        let status = self.git_read_big(root, &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=normal"], 30000, 32 * MIB);
        if !status.ok {
            if js_regex!(r"not a git repository", "i").is_match(&status.stderr) {
                return Ok(View { is_repo: false, unborn: false, detached: false, branch: None, files: vec![], refusal: Some(json!({ "kind": "not-repo", "text": say::NOT_REPO })) });
            }
            return Err(self.git_failure(&status, "Could not read this project's changes"));
        }
        let (head, entries) = parse_status_z(&status.stdout);
        let unborn = head.oid.as_deref() == Some("(initial)");
        let detached = head.branch.as_deref() == Some("(detached)");
        let branch = if detached { None } else { head.branch.clone() };

        let probe = self.git_read(root, &["rev-parse", "--show-prefix", "--git-path", "MERGE_HEAD", "--git-path", "rebase-merge", "--git-path", "rebase-apply", "--git-path", "CHERRY_PICK_HEAD", "--git-path", "REVERT_HEAD"], 10000);
        let mut refusal_kind: Option<&str> = None;
        if probe.ok {
            let lines = js::split_lines(&probe.stdout);
            let at = |index: usize| lines.get(index).copied().unwrap_or("");
            let there = |item: &str| !item.is_empty() && Path::new(&resolve_in(root, item)).exists();
            if !js::trim(at(0)).is_empty() {
                refusal_kind = Some("nested");
            } else if there(at(1)) {
                refusal_kind = Some("merge");
            } else if there(at(2)) || there(at(3)) {
                refusal_kind = Some("rebase");
            } else if there(at(4)) {
                refusal_kind = Some("cherry-pick");
            } else if there(at(5)) {
                refusal_kind = Some("revert");
            }
        }
        if refusal_kind.is_none() && entries.iter().any(|entry| entry.kind == 'u') {
            refusal_kind = Some("unmerged");
        }
        if refusal_kind.is_none() && detached {
            refusal_kind = Some("detached");
        }

        let mut files: Vec<FileRow> = Vec::new();
        let mut folders: Vec<String> = Vec::new();
        for entry in &entries {
            match entry.kind {
                '?' => {
                    if entry.path.ends_with('/') {
                        folders.push(entry.path.clone());
                    } else {
                        files.push(FileRow::new(entry.path.clone(), "new", true));
                    }
                }
                '2' => {
                    files.push(FileRow::new(entry.path.clone(), status_of(&entry.xy), false));
                    // A rename leaves the old path behind as a deletion; a copy keeps it.
                    if entry.xy.starts_with('R') && entry.from.as_deref().is_some_and(|from| !from.is_empty()) {
                        files.push(FileRow::new(entry.from.clone().unwrap_or_default(), "deleted", false));
                    }
                }
                kind => {
                    let mut row = FileRow::new(entry.path.clone(), status_of(&entry.xy), false);
                    row.unmerged = kind == 'u';
                    files.push(row);
                }
            }
        }
        // Untracked folders: a generated or secret one stays one row; the rest open up to their files.
        let mut openable: Vec<String> = Vec::new();
        for folder in folders {
            match rules::path_blocked(&folder) {
                Some(hit) => {
                    let blocked = if hit.kind == "secret" {
                        stopped("secret", Some(hit.rule), hit.label, format!("Stopped: {} in {folder}.", hit.label))
                    } else {
                        stopped("generated", Some(hit.rule), hit.label, format!("{folder} is {}; Studio leaves it out.", hit.label))
                    };
                    let mut row = FileRow::new(folder, "new", true);
                    row.bytes = Some(0.0);
                    row.blocked = Some(blocked);
                    files.push(row);
                }
                None => openable.push(folder),
            }
        }
        let opened = par_map(&openable, 4, |folder| self.git_read_big(root, &["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", "--", folder], 60000, 32 * MIB));
        for listing in opened {
            if !listing.ok {
                return Err(self.git_failure(&listing, "Could not list the new files"));
            }
            for name in listing.stdout.split('\0').filter(|name| !name.is_empty()) {
                let mut row = FileRow::new(name.to_string(), "new", true);
                // A folder that is a Git project of its own shows up as one entry with a slash.
                if name.ends_with('/') {
                    row.bytes = Some(0.0);
                    row.blocked = Some(stopped("nested", None, "a Git project inside this one", format!("{name} is a Git project of its own; Studio leaves it out.")));
                }
                files.push(row);
            }
            if files.len() > MAX_FILES {
                break;
            }
        }
        let mut refusal = refusal_kind.map(|kind| json!({ "kind": kind, "text": refusal_text(kind) }));
        if files.len() > MAX_FILES {
            files.truncate(MAX_FILES);
            refusal = refusal.or_else(|| Some(json!({ "kind": "too-many", "text": refusal_text("too-many") })));
        }

        // The lines each changed file adds, in one diff (a repository with no commit has nothing to compare).
        let mut added: Option<HashMap<String, String>> = None;
        if !unborn && files.iter().any(|file| file.status == "changed" && file.untracked != Some(true)) {
            let diff = self.git_read_big(root, &["-c", "core.quotepath=false", "diff", "HEAD", "-U0", "--no-color", "--no-ext-diff", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "--diff-filter=d"], 60000, 64 * MIB);
            added = diff.ok.then(|| added_lines(&diff.stdout).into_iter().collect());
        }
        self.assess(root, &mut files, added.as_ref(), !unborn);
        files.sort_by(|a, b| js::utf16_cmp(&a.path, &b.path));
        Ok(View { is_repo: true, unborn, detached, branch, files, refusal })
    }

    /// `preview(root, { builders, identity })`: what a save would take.
    pub fn preview(&self, root: &str, options: &Value) -> Value {
        let view = match self.changes(root) {
            Ok(view) => view,
            Err(failure) => return failure,
        };
        let supplied = js::get(options, "identity").cloned().unwrap_or(Value::Null);
        let who = if view.is_repo { self.identity_of(root, &supplied) } else { json!({ "ok": false, "fromAccount": false }) };
        let rows: Vec<Value> = view.files.iter().map(shown).collect();
        let included = rows.iter().filter(|row| row["include"] == json!(true)).count();
        obj(vec![
            ("ok", json!(true)),
            ("files", Value::Array(rows)),
            ("message", json!(rules::save_message(included as f64))),
            ("branch", opt(view.branch)),
            ("unborn", json!(view.unborn)),
            ("detached", json!(view.detached)),
            ("identity", who),
            ("refusal", view.refusal.unwrap_or(Value::Null)),
            ("builders", json!(js::get(options, "builders").is_some_and(js::truthy))),
        ])
    }

    // ---- saving ----

    fn unadd(&self, root: &str, names: &[String]) {
        let (args, input) = pathspec(names);
        let mut argv: Vec<&str> = vec!["--literal-pathspecs", "reset", "-q"];
        argv.extend(args.iter().map(String::as_str));
        self.git_write(root, &argv, 60000, input);
    }

    /// The one commit (`commitPaths`): only listed, unblocked paths, path-limited, never every file.
    fn commit_paths(&self, root: &str, wanted: &Value, message: &Value, builders: bool, ignore_builders: bool, supplied: &Value, given: Option<View>) -> Value {
        let mut list: Vec<String> = Vec::new();
        for item in wanted.as_array().into_iter().flatten() {
            if let Some(text) = item.as_str().filter(|text| !text.is_empty()) {
                if !list.iter().any(|seen| seen == text) {
                    list.push(text.to_string());
                }
            }
        }
        if list.is_empty() {
            return self.fail("nothing", say::NOTHING, vec![]);
        }
        let view = match given.map(Ok).unwrap_or_else(|| self.changes(root)) {
            Ok(view) => view,
            Err(failure) => return failure,
        };
        if !view.is_repo {
            return self.fail("not-repo", say::NOT_REPO, vec![]);
        }
        if let Some(refusal) = &view.refusal {
            return self.fail(refusal["kind"].as_str().unwrap_or(""), refusal["text"].as_str().unwrap_or(""), vec![("refusal", refusal.clone())]);
        }
        if builders && !ignore_builders {
            return self.fail("builders", say::BUILDERS, vec![]);
        }
        let by_path: HashMap<&str, &FileRow> = view.files.iter().map(|file| (file.path.as_str(), file)).collect();
        let mut chosen: Vec<&FileRow> = Vec::new();
        for item in &list {
            let Some(file) = by_path.get(item.as_str()) else {
                return self.fail("not-in-preview", &format!("{item} is not one of the changed files."), vec![]);
            };
            if let Some(blocked) = &file.blocked {
                let mut detail = Map::new();
                detail.insert("path".into(), json!(file.path));
                if let Value::Object(fields) = blocked {
                    for (key, value) in fields {
                        detail.insert(key.clone(), value.clone());
                    }
                }
                return self.fail("blocked", blocked["text"].as_str().unwrap_or(""), vec![("blocked", Value::Object(detail)), ("refusal", blocked_refusal(file))]);
            }
            chosen.push(file);
        }
        let who = self.identity_of(root, supplied);
        if who["ok"] != json!(true) {
            return self.fail("identity", say::IDENTITY, vec![]);
        }
        let raw = match message {
            Value::Null => String::new(),
            other => js::string(other),
        };
        let text = js::slice(js::trim(&raw.replace('\0', "")), 0, Some(5000));
        let text = if text.is_empty() { rules::save_message(chosen.len() as f64) } else { text };
        let names: Vec<String> = chosen.iter().map(|file| file.path.clone()).collect();
        let fresh: Vec<String> = chosen.iter().filter(|file| file.untracked == Some(true)).map(|file| file.path.clone()).collect();
        let mut lead: Vec<String> = vec!["--literal-pathspecs".into()];
        if who["fromAccount"] == json!(true) {
            lead.extend(["-c".to_string(), format!("user.name={}", who["name"].as_str().unwrap_or("")), "-c".to_string(), format!("user.email={}", who["email"].as_str().unwrap_or(""))]);
        }
        if !fresh.is_empty() {
            let (args, input) = pathspec(&fresh);
            let mut argv: Vec<&str> = vec!["--literal-pathspecs", "add", "-N"];
            argv.extend(args.iter().map(String::as_str));
            // Judged by the exit code: git warns about line ends on stderr and still succeeds.
            let (known, locked) = self.git_locked(root, &argv, 60000, input);
            if !known.ok {
                self.unadd(root, &fresh);
                return if locked { self.fail("locked", say::LOCKED, vec![]) } else { self.git_failure(&known, "Could not add the new files") };
            }
        }
        let (args, input) = pathspec(&names);
        let mut argv: Vec<&str> = lead.iter().map(String::as_str).collect();
        argv.extend(["commit", "-m", text.as_str()]);
        argv.extend(args.iter().map(String::as_str));
        // Five minutes: the project's own pre-commit hook runs here, and Studio never skips it.
        let (made, locked) = self.git_locked(root, &argv, 5 * 60 * 1000, input);
        if !made.ok {
            if !fresh.is_empty() {
                self.unadd(root, &fresh);
            }
            if locked {
                return self.fail("locked", say::LOCKED, vec![]);
            }
            if js_regex!(r"nothing (?:added )?to commit|no changes added to commit", "i").is_match(&format!("{}\n{}", made.stdout, made.stderr)) {
                return self.fail("nothing", say::NOTHING, vec![]);
            }
            return self.git_failure(&made, "Could not save");
        }
        let sha = js::trim(&self.git_read(root, &["rev-parse", "HEAD"], 10000).stdout).to_string();
        json!({ "ok": true, "sha": sha, "short": js::slice(&sha, 0, Some(7)), "files": chosen.len(), "branch": view.branch })
    }

    pub fn save(&self, root: &str, options: &Value) -> Value {
        let flag = |key: &str| js::get(options, key).is_some_and(js::truthy);
        self.commit_paths(
            root,
            js::get(options, "paths").unwrap_or(&Value::Null),
            js::get(options, "message").unwrap_or(&Value::Null),
            flag("builders"),
            flag("ignoreBuilders"),
            js::get(options, "identity").unwrap_or(&Value::Null),
            None,
        )
    }

    // ---- pushing ----

    /// `pushBranch(root, { check })`: the current branch to origin with -u, after the project's check.
    pub fn push_branch(&self, root: &str, options: &Value) -> Value {
        if !Path::new(root).exists() {
            return self.folder_missing();
        }
        let head = self.git_read(root, &["symbolic-ref", "--quiet", "--short", "HEAD"], 10000);
        if !head.ok {
            if head.missing || head.timed_out {
                return self.git_failure(&head, "Could not read the branch");
            }
            let text = refusal_text("detached").replacen("save", "push", 1);
            return self.fail("detached", &text, vec![("refusal", json!({ "kind": "detached", "text": text }))]);
        }
        let branch = js::trim(&head.stdout).to_string();
        // HEAD can be pointed at "refs/heads/-f" by hand: as a word after `push` that would be a flag.
        if branch.is_empty() || branch.starts_with('-') {
            return self.fail("branch-name", "This branch has a name Studio will not push. Rename it, then sync again.", vec![("branch", json!(branch))]);
        }
        if !self.git_read(root, &["rev-parse", "--verify", "--quiet", "HEAD"], 10000).ok {
            return self.fail("no-commits", say::NO_COMMITS, vec![]);
        }
        if !self.git_read(root, &["remote", "get-url", "origin"], 10000).ok {
            return self.fail("no-remote", say::NO_REMOTE, vec![]);
        }
        let unpushed = self.git_read(root, &["rev-list", "--count", "HEAD", "--not", "--remotes=origin"], 30000);
        let commits = js::to_number(Some(&json!(js::trim(&unpushed.stdout))));
        let commits = if commits.is_nan() { 0.0 } else { commits };
        if let Some(check) = js::get(options, "check").filter(|check| callbacks::is_function(check)) {
            // The check may hang; the folder's queue would wait behind it for good.
            let gate = match callbacks::invoke_within(self.callbacks, check, vec![], Duration::from_millis(self.check_cap_ms)) {
                Ok(value) => value,
                Err(error) if error == callbacks::TIMED_OUT => json!({ "ok": false, "detail": "the check took too long" }),
                Err(error) => json!({ "ok": false, "detail": error }),
            };
            if !js::get(&gate, "ok").is_some_and(js::truthy) {
                let detail = match js::get(&gate, "detail") {
                    Some(detail) if js::truthy(detail) => js::string(detail),
                    _ => "the check failed".into(),
                };
                return self.fail("check-failed", "The project's check failed, so nothing was pushed. Fix it, then sync again.", vec![("detail", json!(clean(&detail))), ("fix", json!("ask-mefi-fix"))]);
            }
        }
        let pushed = self.git_write(root, &["push", "-u", "origin", &branch], 10 * 60 * 1000, None);
        if !pushed.ok {
            let mut failure = self.push_failure(&pushed, &branch);
            failure["branch"] = json!(branch);
            return failure;
        }
        json!({ "ok": true, "branch": branch, "commits": js::num(commits), "upstream": format!("origin/{branch}") })
    }

    // ---- owners, names, publishing ----

    pub fn owners(&self) -> Value {
        let who = self.account();
        if who["ghInstalled"] != json!(true) {
            return self.fail("gh-missing", say::GH_MISSING, vec![("fix", json!("install-gh"))]);
        }
        if who["account"].is_null() {
            return self.fail("not-signed-in", say::SIGNED_OUT, vec![("fix", json!("sign-in"))]);
        }
        let listed = self.gh(&["api", "user/orgs", "--paginate", "--jq", ".[].login"], None, 30000);
        let orgs: Vec<String> = if listed.ok {
            js::split_lines(&listed.stdout).into_iter().map(js::trim).filter(|line| js_regex!(r"^[A-Za-z0-9-]{1,39}$", "").is_match(line)).map(String::from).collect()
        } else {
            vec![]
        };
        let mut out = vec![("ok", json!(true)), ("account", who["account"].clone()), ("orgs", json!(orgs))];
        if !listed.ok {
            out.push(("orgsError", json!(self.last_line(&listed.stderr))));
        }
        obj(out)
    }

    /// `nameCheck(owner, name)`: valid, the sanitized name, and whether GitHub has it already.
    pub fn name_check(&self, owner: &Value, name: &Value) -> Value {
        let valid = rules::valid_repo(Some(owner), Some(name));
        let name_text = if name.is_null() { String::new() } else { js::string(name) };
        let sanitized = rules::repo_name(&name_text);
        let issue = rules::repo_issue(owner.as_str().unwrap_or(""), name.as_str().unwrap_or(""));
        if !valid {
            return json!({ "ok": true, "valid": valid, "sanitized": sanitized, "taken": false, "issue": issue, "suggestions": [] });
        }
        let repo = format!("{}/{}", js::string(owner), name_text);
        let seen = self.gh(&["repo", "view", &repo, "--json", "nameWithOwner"], None, 20000);
        if seen.ok {
            return json!({ "ok": true, "valid": valid, "sanitized": sanitized, "taken": true, "issue": null, "suggestions": rules::name_suggestions(&name_text) });
        }
        let stderr = if !seen.stderr.is_empty() { seen.stderr.clone() } else if seen.missing { "spawn gh ENOENT".into() } else { String::new() };
        let cls = rules::classify_gh(&stderr, &repo, "", "");
        if cls["kind"] == "not-found" {
            return json!({ "ok": true, "valid": valid, "sanitized": sanitized, "taken": false, "issue": null, "suggestions": [] });
        }
        json!({ "ok": true, "valid": valid, "sanitized": sanitized, "taken": null, "issue": null, "suggestions": [], "checked": false, "kind": cls["kind"], "error": clean(cls["text"].as_str().unwrap_or("")) })
    }

    /// Which file system a folder's drive has, and whether it can keep Git (exFAT and FAT cannot).
    fn drive_of(&self, root: &str) -> (Option<String>, bool) {
        let Some((command, args, timeout)) = (if cfg!(windows) { rules::filesystem_query(root) } else { None }) else {
            return (None, false);
        };
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        let answer = self.run(&command, &args, None, timeout, false, None, 4 * MIB);
        let filesystem = rules::filesystem_of(&answer.stdout);
        let weak = filesystem.as_deref().is_some_and(|name| ["EXFAT", "FAT", "FAT32"].contains(&name.to_uppercase().as_str()));
        (filesystem, weak)
    }

    /// The facts a publish plan needs (`look`).
    fn look(&self, root: &str) -> Result<Look, Value> {
        let read = match self.read_glance(root, 0) {
            Glanced::Read(read) => read,
            Glanced::NotRepo => return Ok(Look { is_repo: false, unborn: false, has_commits: false, branch: None, detached: false, upstream: None, url: String::new(), nested: false }),
            Glanced::Failed { kind: "git-missing", .. } => return Err(self.fail("git-missing", say::GIT_MISSING, vec![])),
            Glanced::Failed { kind, error } => {
                let text = if kind == "timeout" { say::TIMEOUT.to_string() } else { format!("Could not read this project's Git state: {}", if error.is_empty() { "git did not answer" } else { &error }) };
                return Err(self.fail(kind, &text, vec![]));
            }
        };
        let prefix = self.git_read(root, &["rev-parse", "--show-prefix"], 10000);
        Ok(Look {
            is_repo: true,
            unborn: read.unborn,
            has_commits: !read.unborn,
            branch: read.branch,
            detached: read.detached,
            upstream: read.upstream,
            url: read.url,
            nested: prefix.ok && !js::trim(&prefix.stdout).is_empty(),
        })
    }

    /// Whether origin already points at owner/name.
    fn origin_is(&self, root: &str, repo: &str) -> bool {
        let shown = self.git_read(root, &["remote", "get-url", "origin"], 10000);
        let raw = self.git_read(root, &["config", "--get", "remote.origin.url"], 10000);
        [shown, raw].iter().any(|answer| answer.ok && rules::github_remote(js::trim(&answer.stdout)).is_some_and(|found| fold(&found) == fold(repo)))
    }

    /// The files a first publish would put in the repository (`publishFiles`).
    fn publish_files(&self, root: &str, facts: &Look, gitignore: bool, stacks: &Value) -> (Vec<FileRow>, bool) {
        let ignore_path = paths::join(root, ".gitignore");
        let existing: Option<String> = if Path::new(&ignore_path).exists() { std::fs::read(&ignore_path).ok().map(|bytes| String::from_utf8_lossy(&bytes).into_owned()) } else { None };
        let mut listed: Vec<FileRow> = Vec::new();
        if facts.has_commits {
            let tree = self.git_read_big(root, &["ls-tree", "-r", "-l", "-z", "HEAD"], 60000, 64 * MIB);
            if tree.ok {
                for entry in tree.stdout.split('\0').filter(|entry| !entry.is_empty()) {
                    if let Some(found) = js_regex!(r"^\d+ (\w+) \w+ +(\d+|-)\t([\s\S]+)$", "").captures(entry) {
                        if &found[1] == "blob" {
                            let bytes = js::to_number(Some(&json!(&found[2])));
                            listed.push(FileRow { path: found[3].to_string(), status: "tracked", untracked: None, tracked: true, bytes: Some(if bytes.is_nan() { 0.0 } else { bytes }), ..FileRow::default() });
                        }
                    }
                }
            }
        } else if facts.is_repo {
            let patterns: Vec<String> = if existing.is_none() && gitignore { ignore_lines(&rules::gitignore_for(stacks)).into_iter().flat_map(|line| ["-x".to_string(), line]).collect() } else { vec![] };
            let mut argv: Vec<&str> = vec!["--literal-pathspecs", "ls-files", "-z", "--cached", "--others", "--exclude-standard"];
            argv.extend(patterns.iter().map(String::as_str));
            let all = self.git_read_big(root, &argv, 60000, 64 * MIB);
            if all.ok {
                for name in all.stdout.split('\0').filter(|name| !name.is_empty() && !name.ends_with('/')) {
                    listed.push(FileRow::new(name.to_string(), "new", true));
                }
            }
        } else {
            let source = existing.clone().unwrap_or_else(|| if gitignore { rules::gitignore_for(stacks) } else { String::new() });
            let ignored = ignore_matcher(&source);
            let mut queue: std::collections::VecDeque<String> = std::collections::VecDeque::from([String::new()]);
            while listed.len() <= MAX_FILES {
                let Some(rel) = queue.pop_front() else { break };
                let dir = if rel.is_empty() { root.to_string() } else { path_join_all(root, &rel) };
                let Ok(items) = std::fs::read_dir(&dir) else { continue };
                for item in items.flatten() {
                    let name = item.file_name().to_string_lossy().into_owned();
                    if name == ".git" {
                        continue;
                    }
                    let child = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
                    let Ok(meta) = item.metadata() else { continue };
                    // A link or a junction is not walked (Node's readdir calls both links; a OneDrive
                    // placeholder is a reparse point too, but a plain folder or file to both).
                    if meta.file_type().is_symlink() {
                        continue;
                    }
                    if meta.is_dir() {
                        // Generated folders are never walked (node_modules can hold a hundred thousand files).
                        if rules::path_blocked(&format!("{child}/")).is_some_and(|hit| hit.kind == "generated") || ignored(&child, true) {
                            continue;
                        }
                        queue.push_back(child);
                    } else if !ignored(&child, false) {
                        listed.push(FileRow::new(child, "new", true));
                    }
                }
            }
        }
        let mut truncated = false;
        if listed.len() > MAX_FILES {
            listed.truncate(MAX_FILES);
            truncated = true;
        }
        // A tracked file is judged by name and size only: its history is already written.
        let mut tracked: Vec<FileRow> = Vec::new();
        let mut fresh: Vec<FileRow> = Vec::new();
        let mut order: Vec<(bool, usize)> = Vec::new();
        for file in listed {
            if file.tracked {
                order.push((true, tracked.len()));
                tracked.push(file);
            } else {
                order.push((false, fresh.len()));
                fresh.push(file);
            }
        }
        for file in tracked.iter_mut() {
            flag_name(file);
            flag_size(file);
        }
        self.assess(root, &mut fresh, None, false);
        let files: Vec<FileRow> = order
            .into_iter()
            .map(|(is_tracked, index)| if is_tracked { tracked[index].clone() } else { fresh[index].clone() })
            .filter(|file| file.blocked_kind() != Some("generated"))
            .collect();
        (files, truncated)
    }

    /// Whether a folder is a drive root, the user's profile, or a folder that holds it (`tooBroad`).
    fn too_broad(&self, root: &str) -> bool {
        let canon = |folder: &str| -> Vec<String> {
            let given = paths::resolve(folder);
            let real = real_path(&given).filter(|real| !real.is_empty()).unwrap_or_else(|| given.clone());
            let mut out = vec![fold(&given)];
            let second = fold(&paths::resolve(&real));
            if !out.contains(&second) {
                out.push(second);
            }
            out
        };
        let own = canon(root);
        if own.iter().any(|item| is_root(item)) {
            return true;
        }
        let mut homes: Vec<String> = self.homes().iter().filter_map(|home| home.as_str().map(String::from)).collect();
        homes.extend(self.env_text("USERPROFILE"));
        homes.extend(self.env_text("HOME"));
        for home in homes.iter().filter(|home| !home.is_empty()) {
            for inner in canon(home) {
                for outer in &own {
                    let prefix = if outer.ends_with(paths::SEP) { outer.clone() } else { format!("{outer}{}", paths::SEP) };
                    if inner == *outer || inner.starts_with(&prefix) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// What the Publish dialog shows before anything is made (`publishPreview`).
    pub fn publish_preview(&self, root: &str, options: &Value) -> Value {
        if !Path::new(root).exists() {
            return self.folder_missing();
        }
        let owner = js::get(options, "owner").cloned().unwrap_or(Value::Null);
        let name = js::get(options, "name").cloned().unwrap_or(Value::Null);
        let repo = format!("{}/{}", template_text(&owner), template_text(&name));
        let facts = match self.look(root) {
            Ok(facts) => facts,
            Err(failure) => return failure,
        };
        let stacks = self.detect_stacks(root);
        let gitignore = js::get(options, "gitignore").is_none_or(|value| *value != json!(false));
        let (who, checked, drive, inventory) = std::thread::scope(|scope| {
            let who = scope.spawn(|| self.account());
            let checked = scope.spawn(|| self.name_check(&owner, &name));
            let drive = scope.spawn(|| self.drive_of(root));
            let inventory = self.publish_files(root, &facts, gitignore, &stacks);
            (who.join().unwrap_or(Value::Null), checked.join().unwrap_or(Value::Null), drive.join().unwrap_or((None, false)), inventory)
        });
        let (files, truncated) = inventory;
        let mut rows: Vec<(Value, bool, bool, String)> = files
            .iter()
            .map(|file| {
                let mut pairs = vec![("path", json!(file.path)), ("bytes", js::num(file.bytes.unwrap_or(0.0)))];
                if let Some(blocked) = &file.blocked {
                    pairs.push(("blocked", blocked.clone()));
                }
                if let Some(warn) = &file.warn {
                    pairs.push(("warn", warn.clone()));
                }
                (obj(pairs), file.blocked.is_some(), file.warn.is_some(), file.path.clone())
            })
            .collect();
        rows.sort_by(|a, b| b.1.cmp(&a.1).then(b.2.cmp(&a.2)).then_with(|| js::utf16_cmp(&a.3, &b.3)));
        let spread = |row: &Value, key: &str| {
            let mut out = Map::new();
            out.insert("path".into(), row["path"].clone());
            if let Value::Object(fields) = &row[key] {
                for (field, value) in fields {
                    out.insert(field.clone(), value.clone());
                }
            }
            Value::Object(out)
        };
        let issue = if self.too_broad(root) {
            json!({ "kind": "too-broad", "text": say::TOO_BROAD })
        } else if facts.nested {
            json!({ "kind": "nested", "text": refusal_text("nested").replacen("saving", "publishing", 1) })
        } else if drive.1 {
            json!({ "kind": "weak-drive", "text": say::WEAK_DRIVE })
        } else if !facts.url.is_empty() && !self.origin_is(root, &repo) {
            json!({ "kind": "has-remote", "text": say::HAS_REMOTE })
        } else if facts.is_repo && facts.detached && facts.has_commits {
            json!({ "kind": "detached", "text": "This checkout is not on a branch. Start a branch here, then publish." })
        } else if facts.has_commits && facts.branch.as_deref().is_some_and(|branch| !branch.is_empty() && branch != "main") && facts.upstream.is_some() {
            json!({ "kind": "has-upstream", "text": format!("This branch already follows {}. Studio does not rename it.", clean(facts.upstream.as_deref().unwrap_or(""))) })
        } else {
            Value::Null
        };
        let gh_installed = who["ghInstalled"] == json!(true);
        let rename_branch = facts.is_repo && facts.branch.as_deref().is_some_and(|branch| !branch.is_empty() && branch != "main") && !facts.detached && (facts.unborn || facts.upstream.is_none());
        let remote = if facts.url.is_empty() { Value::Null } else { json!(rules::github_remote(&facts.url).unwrap_or_else(|| "other".into())) };
        let total = rows.len();
        obj(vec![
            ("ok", json!(true)),
            ("repo", json!(repo)),
            ("valid", checked["valid"].clone()),
            ("sanitized", checked["sanitized"].clone()),
            ("taken", checked["taken"].clone()),
            ("nameIssue", js::or_null(js::get(&checked, "issue"))),
            ("suggestions", js::get(&checked, "suggestions").filter(|value| !value.is_null()).cloned().unwrap_or_else(|| json!([]))),
            ("files", Value::Array(rows.iter().take(SHOWN_FILES).map(|row| row.0.clone()).collect())),
            ("total", json!(total)),
            ("truncated", json!(truncated)),
            ("warn", Value::Array(rows.iter().filter(|row| row.2).map(|row| spread(&row.0, "warn")).collect())),
            ("blocked", Value::Array(rows.iter().filter(|row| row.1).map(|row| spread(&row.0, "blocked")).collect())),
            ("oneDrive", json!(rules::one_drive(root, &self.env))),
            ("weakDrive", json!(drive.1)),
            ("filesystem", opt(drive.0)),
            ("renameBranch", json!(rename_branch)),
            ("needsSignIn", json!(!(gh_installed && who["account"].is_string()))),
            ("ghInstalled", json!(gh_installed)),
            ("account", who["account"].clone()),
            ("needsFirstCommit", json!(!facts.has_commits)),
            ("isRepo", json!(facts.is_repo)),
            ("branch", opt(facts.branch.clone())),
            ("remote", remote),
            ("publishIssue", issue),
        ])
    }

    /// A repository GitHub already has under this name: the account's own, empty, the visibility asked for?
    fn existing_repo(&self, root: &str, repo: &str, visibility: &str, login: &str, need_empty: bool) -> Value {
        let view = self.gh(&["repo", "view", repo, "--json", "nameWithOwner,owner,isEmpty,isPrivate"], Some(root), 20000);
        if !view.ok {
            return if need_empty { self.gh_failure(&view, repo) } else { json!({ "ok": true, "unknown": true }) };
        }
        let data: Value = serde_json::from_str(&view.stdout).unwrap_or(Value::Null);
        if !js::truthy(&data) {
            return if need_empty { self.fail("unknown", "GitHub's answer could not be read.", vec![]) } else { json!({ "ok": true, "unknown": true }) };
        }
        let owner_login = js::path(&data, &["owner", "login"]).map(|value| if value.is_null() { String::new() } else { js::string(value) }).unwrap_or_default();
        let own = fold(&owner_login) == fold(login);
        let empty = js::get(&data, "isEmpty") == Some(&json!(true));
        if need_empty && (!own || !empty) {
            return self.fail("name-taken", &format!("{repo} already exists. Link to it, or pick another name."), vec![("fix", json!("link"))]);
        }
        let private = js::get(&data, "isPrivate").is_some_and(js::truthy);
        if private != (visibility == "private") {
            return self.fail("visibility-mismatch", &format!("{repo} is {} on GitHub, not {visibility}. Studio will not push into it.", if private { "private" } else { "public" }), vec![]);
        }
        json!({ "ok": true, "empty": empty })
    }

    /// Publish the folder as a new repository, step by step (`publish`).
    pub fn publish(&self, root: &str, options: &Value) -> Value {
        let field = |key: &str| js::get(options, key).cloned().unwrap_or(Value::Null);
        let owner = field("owner");
        let name = field("name");
        let visibility = js::get(options, "visibility").cloned().unwrap_or_else(|| json!("private"));
        let description = js::get(options, "description").cloned().unwrap_or_else(|| json!(""));
        let gitignore = js::get(options, "gitignore").is_none_or(|value| *value != json!(false));
        let license = js::get(options, "license").cloned().unwrap_or_else(|| json!("none"));
        let confirm_public = js::get(options, "confirmPublic").cloned().unwrap_or_else(|| json!(""));
        let supplied = field("identity");
        let on_progress = js::get(options, "onProgress").filter(|handle| callbacks::is_function(handle)).cloned();
        if !Path::new(root).exists() {
            return self.folder_missing();
        }
        if self.too_broad(root) {
            return self.fail("too-broad", say::TOO_BROAD, vec![("steps", json!([]))]);
        }
        let facts = match self.look(root) {
            Ok(facts) => facts,
            Err(failure) => return failure,
        };
        let repo = format!("{}/{}", template_text(&owner), template_text(&name));
        if facts.nested {
            return self.fail("nested", &refusal_text("nested").replacen("saving", "publishing", 1), vec![("steps", json!([]))]);
        }
        let valid = rules::valid_repo(Some(&owner), Some(&name));
        if !valid {
            let issue = rules::repo_issue(owner.as_str().unwrap_or(""), name.as_str().unwrap_or("")).unwrap_or("That is not a GitHub name.");
            return self.fail("name", issue, vec![("steps", json!([]))]);
        }
        let has_remote = !facts.url.is_empty();
        let resuming = has_remote && self.origin_is(root, &repo);
        let year = {
            let now = self.now_ms();
            local_year(now)
        };
        let plan = rules::publish_plan(&rules::PlanInput {
            owner: &owner,
            name: &name,
            visibility: &visibility,
            description: &description,
            gitignore,
            license: &license,
            holder: if owner.is_null() { String::new() } else { js::string(&owner) },
            year,
            stacks: self.detect_stacks(root),
            confirm_public: &confirm_public,
            is_repo: facts.is_repo,
            unborn: facts.unborn,
            has_commits: facts.has_commits,
            branch: facts.branch.clone(),
            detached: facts.detached,
            has_remote: has_remote && !resuming,
        });
        if plan["ok"] != json!(true) {
            return self.fail(plan["kind"].as_str().unwrap_or(""), plan["error"].as_str().unwrap_or(""), vec![("steps", json!([]))]);
        }
        if facts.has_commits && facts.branch.as_deref() != Some("main") && facts.upstream.is_some() {
            return self.fail("has-upstream", &format!("This branch already follows {}. Studio does not rename it.", clean(facts.upstream.as_deref().unwrap_or(""))), vec![("steps", json!([]))]);
        }
        if self.drive_of(root).1 {
            return self.fail("weak-drive", say::WEAK_DRIVE, vec![("steps", json!([]))]);
        }
        let who = self.account();
        if who["ghInstalled"] != json!(true) {
            return self.fail("gh-missing", say::GH_MISSING, vec![("fix", json!("install-gh")), ("steps", json!([]))]);
        }
        let Some(login) = who["account"].as_str().map(String::from) else {
            return self.fail("not-signed-in", say::SIGNED_OUT, vec![("fix", json!("sign-in")), ("steps", json!([]))]);
        };
        let plan_visibility = plan["visibility"].as_str().unwrap_or("private").to_string();
        if resuming {
            let mut same = self.existing_repo(root, &repo, &plan_visibility, &login, false);
            if same["ok"] != json!(true) {
                same["steps"] = json!([]);
                return same;
            }
        }

        let mut written: Vec<String> = Vec::new();
        let mut left: Vec<Value> = Vec::new();
        let mut done: Vec<Value> = Vec::new();
        let tell = |event: Value| {
            if let Some(handle) = &on_progress {
                // The dialog's listener is not this run's business: its failure never stops a publish half-way.
                let _ = callbacks::invoke(self.callbacks, handle, vec![event]);
            }
        };
        let steps: Vec<Value> = plan["steps"].as_array().cloned().unwrap_or_default().into_iter().filter(|step| !(resuming && step["id"] == "create")).collect();
        for step in &steps {
            let id = step["id"].as_str().unwrap_or("").to_string();
            let label = step["label"].clone();
            let stage = step["stage"].clone();
            tell(json!({ "id": id, "label": label, "stage": stage, "state": "start" }));
            let outcome = self.one_step(root, step, &facts, &repo, &plan_visibility, &login, &supplied, &mut written, &mut left);
            let ok = outcome["ok"] == json!(true);
            done.push(json!({ "id": id, "label": label, "stage": stage, "ok": outcome["ok"].clone() }));
            tell(json!({ "id": id, "label": label, "stage": stage, "state": if ok { "done" } else { "failed" } }));
            if !ok {
                let mut out = match outcome {
                    Value::Object(map) => map,
                    _ => Map::new(),
                };
                out.insert("repo".into(), json!(repo));
                out.insert("steps".into(), Value::Array(done));
                if !left.is_empty() {
                    out.insert("left".into(), Value::Array(left));
                }
                return Value::Object(out);
            }
        }
        let mut out = vec![("ok", json!(true)), ("repo", json!(repo)), ("url", json!(format!("https://github.com/{repo}"))), ("visibility", json!(plan_visibility)), ("branch", json!("main")), ("steps", Value::Array(done))];
        if !left.is_empty() {
            out.push(("left", Value::Array(left)));
        }
        obj(out)
    }

    #[allow(clippy::too_many_arguments)]
    fn one_step(&self, root: &str, step: &Value, facts: &Look, repo: &str, visibility: &str, login: &str, supplied: &Value, written: &mut Vec<String>, left: &mut Vec<Value>) -> Value {
        let id = step["id"].as_str().unwrap_or("");
        let timeout = step["timeoutMs"].as_u64().unwrap_or(30000);
        let argv_of = |step: &Value| -> Vec<String> { step["argv"].as_array().into_iter().flatten().map(|arg| arg.as_str().unwrap_or("").to_string()).collect() };
        match step["kind"].as_str().unwrap_or("") {
            "git" => {
                let mut argv = argv_of(step);
                if id == "init" && facts.is_repo {
                    // Naming the branch main never takes the name from a branch that already has it.
                    if self.git_read(root, &["show-ref", "--verify", "--quiet", "refs/heads/main"], 10000).ok {
                        return self.fail("branch-exists", "This project already has a different branch called main. Studio will not replace it. Rename one of them, then publish.", vec![]);
                    }
                    if argv.first().map(String::as_str) == Some("branch") && argv.get(1).map(String::as_str) == Some("-M") {
                        argv = vec!["branch".into(), "-m".into(), "main".into()];
                    }
                }
                let args: Vec<&str> = argv.iter().map(String::as_str).collect();
                let result = self.git_write(root, &args, timeout, None);
                if result.ok {
                    return json!({ "ok": true });
                }
                match id {
                    "push" => self.push_failure(&result, "main"),
                    "fetch" => self.gh_failure(&result, repo),
                    _ => self.git_failure(&result, &format!("{} did not finish", step["label"].as_str().unwrap_or(""))),
                }
            }
            "write" => {
                let rel = step["path"].as_str().unwrap_or("");
                let target = paths::join(root, rel);
                let skip = step["skipIfExists"] == json!(true);
                // A link left at the name counts as a file there (writing would go through it).
                let present = Path::new(&target).exists() || std::fs::symlink_metadata(&target).is_ok();
                if skip && present {
                    return json!({ "ok": true });
                }
                if let Some(parent) = Path::new(&target).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let wrote = std::fs::OpenOptions::new().write(true).create_new(true).open(&target).and_then(|mut file| {
                    use std::io::Write;
                    file.write_all(step["text"].as_str().unwrap_or("").as_bytes())
                });
                if let Err(error) = wrote {
                    if skip && error.kind() == std::io::ErrorKind::AlreadyExists {
                        return json!({ "ok": true });
                    }
                    return self.fail("write", &format!("Could not write {rel}: {error}"), vec![]);
                }
                written.push(rel.to_string());
                json!({ "ok": true })
            }
            "save" => {
                let view = match self.changes(root) {
                    Ok(view) => view,
                    Err(failure) => return failure,
                };
                let chosen: Vec<String> = if step["paths"] == "written" {
                    // What this run wrote, and any of them an earlier try left new and unsaved (never the owner's own edits).
                    let mut candidates: Vec<String> = written.clone();
                    for file in &view.files {
                        if file.status == "new" && (file.path == ".gitignore" || file.path == "LICENSE") {
                            candidates.push(file.path.clone());
                        }
                    }
                    let chosen: Vec<String> = view.files.iter().filter(|file| candidates.contains(&file.path) && file.blocked.is_none()).map(|file| file.path.clone()).collect();
                    if chosen.is_empty() {
                        return json!({ "ok": true });
                    }
                    chosen
                } else {
                    for file in &view.files {
                        if let Some(blocked) = &file.blocked {
                            if blocked["kind"] != "generated" {
                                left.push(json!({ "path": file.path, "why": blocked["text"] }));
                            }
                        }
                    }
                    let chosen: Vec<String> = view.files.iter().filter(|file| file.blocked.is_none()).map(|file| file.path.clone()).collect();
                    if chosen.is_empty() {
                        return self.fail("nothing", "There is nothing to save yet. Add a file, then publish.", vec![]);
                    }
                    chosen
                };
                let saved = self.commit_paths(root, &json!(chosen), &step["message"], false, false, supplied, Some(view));
                if saved["ok"] == json!(true) {
                    json!({ "ok": true, "sha": saved["sha"] })
                } else {
                    saved
                }
            }
            _ => {
                // gh repo create: a name taken by the account's own empty repository is a retry, not a failure.
                let argv = argv_of(step);
                let args: Vec<&str> = argv.iter().map(String::as_str).collect();
                let made = self.gh(&args, Some(root), timeout);
                if made.ok {
                    return json!({ "ok": true });
                }
                if made.timed_out {
                    return self.fail("timeout", &format!("Making {repo} took too long. Try again; Studio picks up where it stopped."), vec![]);
                }
                let stderr = if !made.stderr.is_empty() { made.stderr.clone() } else if made.missing { "spawn gh ENOENT".into() } else { String::new() };
                let cls = rules::classify_gh(&stderr, repo, "create", "");
                if cls["kind"] != "name-taken" {
                    return self.fail(cls["kind"].as_str().unwrap_or(""), cls["text"].as_str().unwrap_or(""), vec![("fix", cls["fix"].clone()), ("detail", cls["detail"].clone())]);
                }
                let same = self.existing_repo(root, repo, visibility, login, true);
                if same["ok"] != json!(true) {
                    return if same["kind"] == "name-taken" { self.fail("name-taken", cls["text"].as_str().unwrap_or(""), vec![("fix", json!("link"))]) } else { same };
                }
                if !self.git_read(root, &["remote", "get-url", "origin"], 10000).ok {
                    let url = format!("https://github.com/{repo}.git");
                    let added = self.git_write(root, &["remote", "add", "origin", &url], 20000, None);
                    if !added.ok {
                        return self.git_failure(&added, "Could not link this folder to the repository");
                    }
                } else if !self.origin_is(root, repo) {
                    // An origin that came from somewhere else since the look is not this repository: the push would go there.
                    return self.fail("has-remote", say::HAS_REMOTE, vec![]);
                }
                json!({ "ok": true })
            }
        }
    }

    // ---- linking to a repository that already exists ----

    /// Whether link may take `repo`: link's own `isListed`, else the factory's (a function or the list).
    fn listed_now(&self, repo: &str, given: Option<&Value>) -> Result<bool, String> {
        let source = given.filter(|value| !value.is_null()).or_else(|| js::get(self.options, "isListed").filter(|value| !value.is_null()));
        Ok(match source {
            Some(handle) if callbacks::is_function(handle) => js::truthy(&callbacks::invoke(self.callbacks, handle, vec![json!(repo)])?),
            Some(Value::Array(list)) => list.iter().any(|item| item.as_str() == Some(repo)),
            _ => false,
        })
    }

    /// `link(root, { repo, isListed })`: a listed repository that shares this folder's history.
    pub fn link(&self, root: &str, options: &Value) -> Value {
        let repo_value = js::get(options, "repo").cloned().unwrap_or(Value::Null);
        let repo = if repo_value.is_null() { String::new() } else { js::string(&repo_value) };
        let mut halves = repo.split('/');
        let (link_owner, link_name) = (halves.next().map(String::from), halves.next().map(String::from));
        let shaped = js_regex!(r"^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$", "").is_match(&repo);
        let valid = shaped && rules::valid_repo(link_owner.map(Value::String).as_ref(), link_name.map(Value::String).as_ref());
        let listed = if valid {
            match self.listed_now(&repo, js::get(options, "isListed")) {
                Ok(listed) => listed,
                // A list that throws ends the call the way the JavaScript's guard does.
                Err(error) => return self.fail("error", &format!("Something went wrong: {error}"), vec![]),
            }
        } else {
            false
        };
        if !listed {
            return self.fail("not-listed", say::NOT_LISTED, vec![]);
        }
        if !Path::new(root).exists() {
            return self.folder_missing();
        }
        let read = match self.read_glance(root, 0) {
            Glanced::Read(read) => read,
            Glanced::NotRepo => return self.fail("not-repo", "This project folder is not a Git repository. Start Git in it first.", vec![]),
            Glanced::Failed { kind: "git-missing", .. } => return self.fail("git-missing", say::GIT_MISSING, vec![]),
            Glanced::Failed { kind, error } => return self.fail(kind, if error.is_empty() { say::TIMEOUT } else { &error }, vec![]),
        };
        if read.unborn {
            return self.fail("no-commits", say::NO_COMMITS, vec![]);
        }
        // A folder inside another project would give that project the address.
        let prefix = self.git_read(root, &["rev-parse", "--show-prefix"], 10000);
        if prefix.ok && !js::trim(&prefix.stdout).is_empty() {
            return self.fail("nested", &refusal_text("nested").replacen("saving", "linking", 1), vec![]);
        }
        let remotes = self.git_read(root, &["remote"], 10000);
        if js::split_lines(&remotes.stdout).into_iter().map(js::trim).any(|line| line == "origin") {
            return self.fail("exists", say::HAS_REMOTE, vec![]);
        }
        let url = format!("https://github.com/{repo}.git");
        let added = self.git_write(root, &["remote", "add", "origin", &url], 20000, None);
        if !added.ok {
            return self.git_failure(&added, "Could not link this folder to the repository");
        }
        let undo = || self.git_write(root, &["remote", "remove", "origin"], 20000, None);
        // No tags: they would stay behind after an unrelated history is refused and the link undone.
        let fetched = self.git_write(root, &["fetch", "origin", "--prune", "--no-tags"], 120000, None);
        if !fetched.ok {
            undo();
            if fetched.timed_out {
                return self.fail("timeout", say::TIMEOUT, vec![]);
            }
            let mut failure = self.gh_failure(&fetched, &repo);
            failure["repo"] = json!(repo);
            return failure;
        }
        let heads = self.git_read(root, &["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"], 20000);
        let branches: Vec<String> = js::split_lines(&heads.stdout)
            .into_iter()
            .map(|line| js_regex!(r"^origin\/", "").replace(js::trim(line), "").into_owned())
            .filter(|line| !line.is_empty() && line != "origin" && line != "HEAD")
            .collect();
        if branches.is_empty() {
            return json!({ "ok": true, "repo": repo, "empty": true, "related": false, "upstream": false });
        }
        // The default names first; a folder shares history if it shares any commit with any of them.
        let mut candidates: Vec<String> = Vec::new();
        for name in ["main", "master"].iter().map(|name| name.to_string()).filter(|name| branches.contains(name)).chain(branches.iter().cloned()) {
            if !candidates.contains(&name) {
                candidates.push(name);
            }
        }
        candidates.truncate(20);
        let related = candidates.iter().any(|branch| self.git_read(root, &["merge-base", "HEAD", &format!("origin/{branch}")], 30000).ok);
        if !related {
            undo();
            return self.fail("unrelated", &format!("GitHub's copy of {repo} is a different project (no shared history)."), vec![("fix", json!("clone")), ("repo", json!(repo))]);
        }
        let mut upstream = false;
        if let Some(branch) = read.branch.as_deref().filter(|branch| !branch.starts_with('-') && branches.iter().any(|item| item == branch)) {
            upstream = self.git_write(root, &["branch", &format!("--set-upstream-to=origin/{branch}"), branch], 20000, None).ok;
        }
        json!({ "ok": true, "repo": repo, "empty": false, "related": true, "upstream": upstream })
    }
}

/// `${value}` in a template literal.
fn template_text(value: &Value) -> String {
    if value.is_null() {
        // Both undefined and null arrive as null; the engine only ever passes strings here.
        "undefined".into()
    } else {
        js::string(value)
    }
}

struct Look {
    is_repo: bool,
    unborn: bool,
    has_commits: bool,
    branch: Option<String>,
    detached: bool,
    upstream: Option<String>,
    url: String,
    nested: bool,
}

/// `new Date(ms).getFullYear()`: the year in this PC's time zone.
#[cfg(windows)]
fn local_year(ms: f64) -> Option<f64> {
    use windows_sys::Win32::Foundation::{FILETIME, SYSTEMTIME};
    use windows_sys::Win32::System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime};
    if !ms.is_finite() {
        return None;
    }
    let ticks = ((ms + 11_644_473_600_000.0) * 10_000.0) as u64;
    let file = FILETIME { dwLowDateTime: ticks as u32, dwHighDateTime: (ticks >> 32) as u32 };
    let mut utc: SYSTEMTIME = unsafe { std::mem::zeroed() };
    let mut local: SYSTEMTIME = unsafe { std::mem::zeroed() };
    // SAFETY: plain out-parameters on the stack; a null time zone means this PC's own.
    let ok = unsafe { FileTimeToSystemTime(&file, &mut utc) != 0 && SystemTimeToTzSpecificLocalTime(std::ptr::null(), &utc, &mut local) != 0 };
    if ok {
        Some(f64::from(local.wYear))
    } else {
        js::iso_string(ms).and_then(|iso| iso.get(0..4).and_then(|year| year.parse().ok()))
    }
}

#[cfg(not(windows))]
fn local_year(ms: f64) -> Option<f64> {
    js::iso_string(ms).and_then(|iso| iso.get(0..4).and_then(|year| year.parse().ok()))
}

/// git-actions' `clean`: a login in a link goes whole, then git-link's scrub, then the credential shapes.
pub fn clean(value: &str) -> String {
    let out = js_regex!(r"(:\/\/)[^\s/]*@", "g").replace_all(value, "${1}");
    rules::mask_credentials(&rules::scrub(&out))
}

// ---- one writer per folder ----

fn queues() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    static QUEUES: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    QUEUES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Runs `task` while holding the folder's lock: its canonical spelling, so a junction or another case shares one.
pub fn serial<T>(root: &str, task: impl FnOnce() -> T) -> T {
    let given = paths::resolve(root);
    let key = fold(&paths::resolve(&real_path(&given).filter(|real| !real.is_empty()).unwrap_or(given)));
    let lock = queues().lock().unwrap_or_else(|poison| poison.into_inner()).entry(key).or_default().clone();
    let _held = lock.lock().unwrap_or_else(|poison| poison.into_inner());
    task()
}
