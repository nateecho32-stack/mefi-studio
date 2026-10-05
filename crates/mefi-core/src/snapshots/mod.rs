//! Attempt snapshots, the host half (scripts/attempt-snapshots-host.cjs): runs
//! git and touches the project folder. `rules` (attempt-snapshots.cjs) names
//! the refs, reads git's answers and decides what a revert may do.
//!
//!   begin / end      a picture of the folder a builder works in, as a commit
//!                    only refs/mefi/attempts/<task>/<n>/before|after points at
//!   changes / diff   the files an attempt changed, and one file's diff
//!   revert / undo    put files back to the "before" picture, or undo that
//!   prune / drop     keep each task's newest attempts; drop a start that never ran
//!
//! The picture is made on a temporary copy of the index (GIT_INDEX_FILE), so
//! the person's index, HEAD, branch and files are never touched by a snapshot.
//! A revert writes each file to a temporary name beside it and renames it over
//! the original, only for the attempt's own files, only while they still hold
//! what the attempt left, and only after a safety picture of the folder.
//!
//! The engine's collaborators come first in every call: `disabled()` (the
//! kill switch), `log(line)`, and for tests `env`, `now` and `timeoutScale`. A revert's and an
//! undo's `busy(root)` comes with the request. Every method answers.

pub mod rules;

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::Duration;

use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::callbacks::{invoke, is_function, Callbacks};
use crate::git::run::{run_raw, Options, Raw, MIB};
use crate::js;
use crate::js_regex;
use crate::paths;

use rules::{Message, CANDIDATES, DIFF_BYTES, DIFF_LINES, KEEP_ATTEMPTS, KEEP_TASKS, LISTED_FILES, LIST_FORMAT, NAMESPACE, REVERT_FILES, SKIPPED_LISTED, TEXT_BYTES};

type Result<T> = std::result::Result<T, String>;

const KILL_GRACE_MS: u64 = 5000;
const SNIFF_BYTES: u64 = 8000;
const HEAVY: usize = 3;
const LIVE_MS: f64 = 8000.0;
const LIVE_KEPT: usize = 40;
const IDENTITY: [(&str, &str); 4] = [
    ("GIT_AUTHOR_NAME", "Mefi's Studio"),
    ("GIT_AUTHOR_EMAIL", "studio@invalid.local"),
    ("GIT_COMMITTER_NAME", "Mefi's Studio"),
    ("GIT_COMMITTER_EMAIL", "studio@invalid.local"),
];
const RAW_FLAGS: [&str; 5] = ["--no-color", "--no-ext-diff", "--no-textconv", "-M", "--no-abbrev"];
const BUSY_NOW: &str = "A builder is working in this folder. Wait for it to finish or pause it, so nothing changes under it.";

/// The host's scrub for what leaves: a login in a link goes, then the credential shapes.
fn clean(value: &str) -> String {
    let out = js_regex!(r"(:\/\/)[^\s/]*@", "g").replace_all(value, "${1}");
    crate::git::rules::mask_credentials(&out)
}

fn first_line(text: &str, root: &str) -> String {
    let mut line = js::split_lines(text).into_iter().map(js::trim).find(|part| !part.is_empty()).unwrap_or("").to_string();
    if !root.is_empty() {
        line = line.split(root).collect::<Vec<_>>().join("<project>");
    }
    js::slice(&js_regex!(r"^(fatal|error):\s*", "i").replace(&line, ""), 0, Some(160))
}

fn unreadable() -> Value {
    json!({ "ok": false, "reason": "unreadable", "error": rules::unavailable("unreadable") })
}

fn refused(reason: &str) -> Value {
    json!({ "ok": false, "reason": reason, "error": rules::unavailable(reason) })
}

fn is_sha(text: &str) -> bool {
    js_regex!(r"^[0-9a-f]{40,64}$", "").is_match(text)
}

fn text_of(raw: &Raw) -> String {
    String::from_utf8_lossy(&raw.stdout).into_owned()
}

fn fold(path: String) -> String {
    if cfg!(windows) {
        path.to_lowercase()
    } else {
        path
    }
}

/// `fs.realpath`, without Windows' `\\?\` prefix.
fn real_path(path: &str) -> Option<String> {
    let found = std::fs::canonicalize(path).ok()?;
    let text = found.to_string_lossy().into_owned();
    Some(match text.strip_prefix(r"\\?\UNC\") {
        Some(rest) => format!(r"\\{rest}"),
        None => text.strip_prefix(r"\\?\").map(String::from).unwrap_or(text),
    })
}

fn is_absolute(path: &str) -> bool {
    Path::new(path).is_absolute() || (cfg!(windows) && path.starts_with(['/', '\\']))
}

/// `path.resolve(root, item)`.
fn resolve_from(root: &str, item: &str) -> String {
    if is_absolute(item) {
        paths::resolve(item)
    } else {
        paths::resolve(&paths::join(root, item))
    }
}

/// `os.tmpdir()`.
fn tmpdir() -> String {
    let found = if cfg!(windows) {
        std::env::var("TEMP").or_else(|_| std::env::var("TMP")).unwrap_or_else(|_| format!(r"{}\temp", std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into())))
    } else {
        std::env::var("TMPDIR").or_else(|_| std::env::var("TMP")).or_else(|_| std::env::var("TEMP")).unwrap_or_else(|_| "/tmp".into())
    };
    if found.len() > 1 && found.ends_with(['/', '\\']) && !found.ends_with(":\\") {
        found[..found.len() - 1].to_string()
    } else {
        found
    }
}

fn random_hex(count: usize) -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut out = String::new();
    while out.len() < count {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        hasher.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
        out.push_str(&format!("{:016x}", hasher.finish()));
    }
    out[..count].to_string()
}

/// A path from git under the project folder.
fn in_folder(root: &str, name: &str) -> PathBuf {
    let mut path = PathBuf::from(root);
    for part in name.split('/') {
        path.push(part);
    }
    path
}

fn missing_kind(error: &std::io::Error) -> bool {
    matches!(error.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory)
}

/// Node's words for a failed file call: `CODE: description`.
fn io_message(error: &std::io::Error) -> String {
    use std::io::ErrorKind::*;
    let (code, words) = match error.kind() {
        NotFound => ("ENOENT", "no such file or directory"),
        PermissionDenied => ("EPERM", "operation not permitted"),
        AlreadyExists => ("EEXIST", "file already exists"),
        NotADirectory => ("ENOTDIR", "not a directory"),
        IsADirectory => ("EISDIR", "illegal operation on a directory"),
        ResourceBusy => ("EBUSY", "resource busy or locked"),
        _ => ("EIO", "i/o error"),
    };
    format!("{code}: {words}")
}

// ---- one writer per folder, three heavy reads at once ----

fn queues() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    static QUEUES: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    QUEUES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn key_of(root: &Value) -> String {
    fold(paths::resolve(&js::string(root)))
}

fn serial<T>(root: &Value, task: impl FnOnce() -> T) -> T {
    let lock = queues().lock().unwrap_or_else(|poison| poison.into_inner()).entry(key_of(root)).or_default().clone();
    let _held = lock.lock().unwrap_or_else(|poison| poison.into_inner());
    task()
}

fn heavy() -> &'static (Mutex<usize>, Condvar) {
    static HEAVY_NOW: OnceLock<(Mutex<usize>, Condvar)> = OnceLock::new();
    HEAVY_NOW.get_or_init(|| (Mutex::new(0), Condvar::new()))
}

struct HeavySlot;

impl Drop for HeavySlot {
    fn drop(&mut self) {
        let (count, wake) = heavy();
        *count.lock().unwrap_or_else(|poison| poison.into_inner()) -= 1;
        wake.notify_one();
    }
}

/// The heavy part (git reading a whole folder) runs for three folders at once and no more.
fn gated<T>(task: impl FnOnce() -> T) -> T {
    let (count, wake) = heavy();
    let mut now = count.lock().unwrap_or_else(|poison| poison.into_inner());
    while *now >= HEAVY {
        now = wake.wait(now).unwrap_or_else(|poison| poison.into_inner());
    }
    *now += 1;
    drop(now);
    let _slot = HeavySlot;
    task()
}

/// A change list read from a folder that is still changing, kept a few seconds.
fn live() -> &'static Mutex<IndexMap<String, (f64, Value)>> {
    static LIVE: OnceLock<Mutex<IndexMap<String, (f64, Value)>>> = OnceLock::new();
    LIVE.get_or_init(|| Mutex::new(IndexMap::new()))
}

// ---- running git ----

struct Git {
    timeout: u64,
    reads: bool,
    input: Option<String>,
    extra: Vec<(String, String)>,
    max_buffer: usize,
}

impl Default for Git {
    fn default() -> Self {
        Git { timeout: 30000, reads: false, input: None, extra: Vec::new(), max_buffer: 16 * MIB }
    }
}

fn reads(timeout: u64) -> Git {
    Git { timeout, reads: true, ..Git::default() }
}

/// What git runs with: the engine's environment and the config every call carries.
#[derive(Clone)]
struct Runner {
    env: Value,
    config: Vec<String>,
    /// Every git time limit times this (`timeoutScale`, at least 1), as in the JavaScript.
    scale: f64,
}

impl Runner {
    /// No shell, prompts off, credentials withheld, a hard limit. A read never takes the index lock.
    fn git(&self, cwd: &str, args: &[&str], options: Git) -> Raw {
        let mut all = self.config.clone();
        all.extend(args.iter().map(|arg| arg.to_string()));
        let run = Options { cwd: Some(cwd), timeout_ms: (options.timeout as f64 * self.scale) as u64, reads: options.reads, input: options.input, max_buffer: options.max_buffer };
        run_raw("git", &all, &run, &self.env, &options.extra, KILL_GRACE_MS, &clean)
    }

    fn refs_of(&self, root: &str, key: Option<&str>) -> Vec<Value> {
        let pattern = match key {
            Some(key) => format!("{NAMESPACE}/{key}/"),
            None => format!("{NAMESPACE}/"),
        };
        let listed = self.git(root, &["for-each-ref", &format!("--format={LIST_FORMAT}"), &pattern], reads(30000));
        if listed.ok {
            rules::parse_refs(&text_of(&listed))
        } else {
            Vec::new()
        }
    }

    fn prune_refs(&self, root: &str) -> Value {
        let doomed = rules::prune_plan(&self.refs_of(root, None), KEEP_ATTEMPTS, KEEP_TASKS);
        for batch in doomed.chunks(100) {
            let input = format!("{}\n", batch.iter().map(|reference| format!("delete {reference}")).collect::<Vec<_>>().join("\n"));
            self.git(root, &["update-ref", "--stdin"], Git { input: Some(input), ..Git::default() });
        }
        json!({ "ok": true, "pruned": doomed.len() })
    }
}

struct Shot {
    tree: String,
    skipped: Vec<Value>,
    skipped_count: f64,
}

struct Host<'a> {
    collaborators: &'a Value,
    callbacks: &'a dyn Callbacks,
    runner: Runner,
}

impl<'a> Host<'a> {
    fn new(collaborators: &'a Value, callbacks: &'a dyn Callbacks) -> Host<'a> {
        let env = match js::get(collaborators, "env") {
            Some(handle) if is_function(handle) => invoke(callbacks, handle, vec![]).ok().filter(Value::is_object),
            Some(value @ Value::Object(_)) => Some(value.clone()),
            _ => None,
        }
        .unwrap_or_else(|| Value::Object(std::env::vars().map(|(key, value)| (key, Value::String(value))).collect()));
        let nowhere = paths::join(&tmpdir(), "mefi-no-hooks");
        let config = ["-c", "core.quotepath=false", "-c", "core.safecrlf=false", "-c", "core.fsmonitor=false", "-c", &format!("core.hooksPath={nowhere}"), "-c", "gc.auto=0"].iter().map(|part| part.to_string()).collect();
        let scale = js::get(collaborators, "timeoutScale").and_then(js::finite).filter(|scale| *scale > 1.0).unwrap_or(1.0);
        Host { collaborators, callbacks, runner: Runner { env, config, scale } }
    }

    fn git(&self, cwd: &str, args: &[&str], options: Git) -> Raw {
        self.runner.git(cwd, args, options)
    }

    fn collaborator(&self, name: &str) -> Option<&Value> {
        js::get(self.collaborators, name).filter(|handle| is_function(handle))
    }

    fn clock(&self) -> f64 {
        self.collaborator("now").and_then(|handle| invoke(self.callbacks, handle, vec![]).ok()).and_then(|value| value.as_f64()).unwrap_or_else(js::now_ms)
    }

    /// The kill switch: the engine's setting, or the environment when none was given.
    fn off(&self) -> bool {
        match self.collaborator("disabled") {
            Some(handle) => invoke(self.callbacks, handle, vec![]).is_ok_and(|value| value == Value::Bool(true)),
            None => js::get(&self.runner.env, "MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS").and_then(Value::as_str) == Some("1"),
        }
    }

    fn log(&self, line: String) {
        if let Some(handle) = self.collaborator("log") {
            let _ = invoke(self.callbacks, handle, vec![json!(line)]);
        }
    }

    fn busy(&self, request: &Value, root: &Value) -> Result<bool> {
        match js::get(request, "busy").filter(|handle| is_function(handle)) {
            Some(handle) => invoke(self.callbacks, handle, vec![root.clone()]).map(|value| js::truthy(&value)),
            None => Ok(false),
        }
    }

    // ---- the folder ----

    fn canonical(&self, folder: &str) -> String {
        let mut real = paths::resolve(folder);
        if let Some(found) = real_path(&real) {
            real = found;
        }
        fold(paths::resolve(&real))
    }

    /// Whether the folder is the top of a git working tree. Err is the reason it is not.
    fn probe(&self, root: &Value) -> std::result::Result<(), &'static str> {
        if self.off() {
            return Err("off");
        }
        let Some(root) = root.as_str().filter(|root| !root.is_empty()) else { return Err("not-a-repo") };
        let top = self.git(root, &["rev-parse", "--show-toplevel"], reads(10000));
        if top.missing {
            return Err("git-missing");
        }
        if !top.ok {
            return Err(if js_regex!("not a git repository", "i").is_match(&top.stderr) {
                "not-a-repo"
            } else if top.timed_out || js_regex!(r"dubious ownership|safe\.directory", "i").is_match(&top.stderr) {
                "unreadable"
            } else {
                "not-a-repo"
            });
        }
        if self.canonical(js::trim(&text_of(&top))) != self.canonical(root) {
            return Err("nested");
        }
        Ok(())
    }

    fn read_message(&self, root: &str, sha: &str) -> Value {
        let shown = self.git(root, &["cat-file", "commit", sha], reads(10000));
        if !shown.ok {
            return rules::parse_message("");
        }
        let text = text_of(&shown);
        let body = js_regex!(r"\r?\n\r?\n", "").find(&text).map_or("", |gap| &text[gap.end()..]);
        rules::parse_message(body)
    }

    // ---- making a snapshot ----

    fn stat_all(&self, root: &str, names: &[String]) -> Vec<Value> {
        let one = |name: &String| -> Option<Value> {
            let file = in_folder(root, name);
            let info = std::fs::symlink_metadata(&file).ok()?;
            if !info.is_file() {
                return None;
            }
            let size = info.len();
            let binary = size > 0
                && std::fs::File::open(&file).is_ok_and(|handle| {
                    let mut head = Vec::new();
                    handle.take(SNIFF_BYTES).read_to_end(&mut head).is_ok() && head.contains(&0)
                });
            Some(json!({ "path": name, "size": size, "binary": binary }))
        };
        if names.len() <= 64 {
            return names.iter().filter_map(one).collect();
        }
        let threads = 8;
        let size = names.len().div_ceil(threads);
        std::thread::scope(|scope| {
            let parts: Vec<_> = names.chunks(size).map(|chunk| scope.spawn(move || chunk.iter().filter_map(one).collect::<Vec<_>>())).collect();
            parts.into_iter().flat_map(|part| part.join().unwrap_or_default()).collect()
        })
    }

    /// The folder's files as a git tree, built on a copy of the index. Err is the reason there is none.
    fn snapshot_tree(&self, root: &str, deadline: f64) -> std::result::Result<Shot, &'static str> {
        let left = || (deadline - self.clock()).max(1000.0) as u64;
        let found = self.git(root, &["ls-files", "-m", "-o", "--exclude-standard", "-z"], reads(left()));
        if !found.ok {
            return Err(if found.missing { "git-missing" } else { "unreadable" });
        }
        let listed = text_of(&found);
        let mut seen = HashSet::new();
        let names: Vec<String> = listed.split('\0').filter(|name| !name.is_empty() && seen.insert(*name)).map(String::from).collect();
        if names.len() > CANDIDATES {
            return Err("too-many");
        }
        let plan = rules::plan_snapshot(&Value::Array(self.stat_all(root, &names)));
        if plan["tooMany"] == json!(true) {
            return Err("too-many");
        }
        let place = self.git(root, &["rev-parse", "--git-path", "index"], reads(10000));
        if !place.ok {
            return Err("unreadable");
        }
        let real_index = resolve_from(root, js::trim(&text_of(&place)));
        let base = tmpdir();
        let folder = (0..8).map(|_| PathBuf::from(format!("{}-{}", paths::join(&base, "mefi-snapshot"), random_hex(6)))).find(|folder| std::fs::create_dir(folder).is_ok()).ok_or("unreadable")?;
        let index = folder.join("index");
        let made = (|| {
            // The copy keeps git's cached file stats, so only files that really changed are read again.
            if let Err(error) = std::fs::copy(&real_index, &index) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err("unreadable");
                }
            }
            let extra = vec![("GIT_INDEX_FILE".to_string(), index.to_string_lossy().into_owned())];
            let input = rules::add_pathspec(&plan["leaveOut"]);
            let added = self.git(root, &["add", "-A", "--ignore-errors", "--pathspec-from-file=-", "--pathspec-file-nul"], Git { input: Some(input), extra: extra.clone(), timeout: left(), max_buffer: 4 * MIB, ..Git::default() });
            // --ignore-errors adds what it can and still exits non-zero for a file it could not read; that is not a failed snapshot.
            let unreadable = if added.ok { 0 } else { added.stderr.split('\n').filter(|line| line.starts_with("error: ")).count() };
            if !added.ok && unreadable == 0 {
                return Err("unreadable");
            }
            let written = self.git(root, &["write-tree"], Git { extra, timeout: left(), ..Git::default() });
            let tree = js::trim(&text_of(&written)).to_string();
            if !written.ok || !is_sha(&tree) {
                return Err("unreadable");
            }
            Ok(Shot { tree, skipped: plan["skipped"].as_array().cloned().unwrap_or_default(), skipped_count: plan["skippedCount"].as_f64().unwrap_or(0.0) + unreadable as f64 })
        })();
        for attempt in 0..4 {
            if std::fs::remove_dir_all(&folder).is_ok() || !folder.exists() {
                break;
            }
            if attempt < 3 {
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        made
    }

    fn commit_tree(&self, root: &str, tree: &str, parents: &[String], message: String) -> Option<String> {
        let mut args = vec!["commit-tree", tree];
        for parent in parents {
            args.extend(["-p", parent.as_str()]);
        }
        args.extend(["-F", "-"]);
        let date = js::iso_string(self.clock())?;
        let mut extra: Vec<(String, String)> = IDENTITY.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect();
        extra.push(("GIT_AUTHOR_DATE".into(), date.clone()));
        extra.push(("GIT_COMMITTER_DATE".into(), date));
        let made = self.git(root, &args, Git { input: Some(message), extra, timeout: 20000, ..Git::default() });
        let sha = js::trim(&text_of(&made)).to_string();
        (made.ok && is_sha(&sha)).then_some(sha)
    }

    fn head_of(&self, root: &str) -> Option<String> {
        let head = self.git(root, &["rev-parse", "--verify", "-q", "HEAD"], reads(10000));
        let sha = js::trim(&text_of(&head)).to_string();
        (head.ok && is_sha(&sha)).then_some(sha)
    }

    /// Create-only: an existing ref is never moved.
    fn make_ref(&self, root: &str, reference: &str, sha: &str) -> Raw {
        self.git(root, &["update-ref", reference, sha, ""], Git { timeout: 15000, ..Git::default() })
    }

    fn verified(&self, root: &str, reference: &str) -> Raw {
        self.git(root, &["rev-parse", "--verify", "-q", reference], reads(10000))
    }

    // ---- begin and end of an attempt ----

    fn begin(&self, request: &Value) -> Result<Value> {
        let field = |key: &str| js::get(request, key).cloned().unwrap_or(Value::Null);
        let (root, task_id, run_id) = (field("root"), field("taskId"), field("runId"));
        let Some(key) = rules::task_key(&task_id) else { return Ok(unreadable()) };
        if rules::safe_run_id(&run_id).is_none() {
            return Ok(unreadable());
        }
        if let Err(reason) = self.probe(&root) {
            return Ok(refused(reason));
        }
        let folder = js::string(&root);
        let budget = budget_of(request, 20000.0);
        let shot = match gated(|| self.snapshot_tree(&folder, self.clock() + budget)) {
            Ok(shot) => shot,
            Err(reason) => {
                self.log(format!("[review] no before snapshot ({reason})"));
                return Ok(refused(reason));
            }
        };
        let overlap = field("overlap");
        let numbers = field("numbers").as_array().cloned().unwrap_or_default();
        // Only the numbering waits its turn: two attempts starting together take two numbers.
        Ok(serial(&root, || {
            let head = self.head_of(&folder);
            for _ in 0..4 {
                let rows = self.runner.refs_of(&folder, Some(&key));
                let n = js::num(rules::next_attempt(&[rows.iter().map(|row| row["n"].clone()).collect(), numbers.clone()]));
                let Some(reference) = rules::ref_name(&task_id, &n, "before", None) else { return unreadable() };
                let message = rules::message_of(&Message {
                    task_id: &task_id, n: &n, phase: "before", run_id: &run_id, at: self.clock(), worktree: js::truthy(&field("worktree")),
                    overlap: &overlap, skipped: &shot.skipped, skipped_count: Some(shot.skipped_count), paths: &[], stamp: None,
                });
                let Some(sha) = self.commit_tree(&folder, &shot.tree, head.as_slice(), message) else { return unreadable() };
                let set = self.make_ref(&folder, &reference, &sha);
                if set.ok {
                    let (runner, prune_root) = (self.runner.clone(), folder.clone());
                    std::thread::spawn(move || runner.prune_refs(&prune_root));
                    return json!({ "ok": true, "n": n, "sha": sha, "tree": shot.tree, "skippedCount": js::num(shot.skipped_count), "skipped": shot.skipped });
                }
                if !js_regex!("already exists|cannot lock ref", "i").is_match(&set.stderr) {
                    return unreadable();
                }
            }
            unreadable()
        }))
    }

    /// The picture when it ends, parented on the "before" one. `changed` says whether the folder differs.
    fn end(&self, request: &Value) -> Result<Value> {
        let field = |key: &str| js::get(request, key).cloned().unwrap_or(Value::Null);
        let (root, task_id, n, run_id) = (field("root"), field("taskId"), field("n"), field("runId"));
        let Some(reference) = rules::ref_name(&task_id, &n, "before", None) else { return Ok(unreadable()) };
        if rules::safe_run_id(&run_id).is_none() {
            return Ok(unreadable());
        }
        if let Err(reason) = self.probe(&root) {
            return Ok(refused(reason));
        }
        let folder = js::string(&root);
        let before = self.verified(&folder, &reference);
        let before_sha = js::trim(&text_of(&before)).to_string();
        if !before.ok || before_sha.is_empty() {
            return Ok(json!({ "ok": false, "reason": "no-before", "error": "There is no snapshot of this attempt's start." }));
        }
        let budget = budget_of(request, 30000.0);
        let shot = match gated(|| self.snapshot_tree(&folder, self.clock() + budget)) {
            Ok(shot) => shot,
            Err(reason) => {
                self.log(format!("[review] no after snapshot ({reason})"));
                return Ok(refused(reason));
            }
        };
        let message = rules::message_of(&Message {
            task_id: &task_id, n: &n, phase: "after", run_id: &run_id, at: self.clock(), worktree: js::truthy(&field("worktree")),
            overlap: &field("overlap"), skipped: &shot.skipped, skipped_count: Some(shot.skipped_count), paths: &[], stamp: None,
        });
        let Some(sha) = self.commit_tree(&folder, &shot.tree, std::slice::from_ref(&before_sha), message) else { return Ok(unreadable()) };
        let Some(after) = rules::ref_name(&task_id, &n, "after", None) else { return Ok(unreadable()) };
        if !self.make_ref(&folder, &after, &sha).ok {
            return Ok(unreadable());
        }
        let same = self.git(&folder, &["diff", "--quiet", &before_sha, &sha], reads(20000));
        let changed = if same.code == Some(1) { json!(true) } else if same.ok { json!(false) } else { Value::Null };
        Ok(json!({ "ok": true, "n": n, "sha": sha, "changed": changed, "skippedCount": js::num(shot.skipped_count), "skipped": shot.skipped }))
    }

    // ---- reading an attempt ----

    fn change_entries(&self, root: &str, from: &str, to: &str) -> Option<Vec<Value>> {
        let numstat_flags: Vec<&str> = RAW_FLAGS.iter().copied().filter(|flag| *flag != "--no-abbrev").collect();
        let (raw, stat) = std::thread::scope(|scope| {
            let stat = scope.spawn(|| {
                let mut args = vec!["diff", "--numstat", "-z"];
                args.extend(&numstat_flags);
                args.extend([from, to]);
                self.runner.git(root, &args, Git { max_buffer: 32 * MIB, ..reads(60000) })
            });
            let mut args = vec!["diff", "--raw", "-z"];
            args.extend(RAW_FLAGS);
            args.extend([from, to]);
            let raw = self.runner.git(root, &args, Git { max_buffer: 32 * MIB, ..reads(60000) });
            (raw, stat.join().unwrap_or_default())
        });
        if !raw.ok {
            return None;
        }
        Some(rules::change_set(&text_of(&raw), &if stat.ok { text_of(&stat) } else { String::new() }))
    }

    /// What the folder holds now for each path, the way `git add` would hash it ({ blob }; null: no file).
    fn current_blobs(&self, root: &str, names: &[String]) -> Value {
        let mut current = Map::new();
        let mut to_hash: Vec<&String> = Vec::new();
        for name in names {
            if !rules::safe_relative(&json!(name)) {
                current.insert(name.clone(), json!({ "blob": "unsafe" }));
                continue;
            }
            let file = in_folder(root, name);
            let info = match std::fs::symlink_metadata(&file) {
                Ok(info) => info,
                Err(error) => {
                    current.insert(name.clone(), json!({ "blob": if missing_kind(&error) { Value::Null } else { json!("unreadable") } }));
                    continue;
                }
            };
            if info.file_type().is_symlink() {
                let blob = std::fs::read_link(&file).ok().map(|target| {
                    let hashed = self.git(root, &["hash-object", "--stdin"], Git { input: Some(target.to_string_lossy().into_owned()), ..reads(10000) });
                    if hashed.ok { js::trim(&text_of(&hashed)).to_string() } else { "unreadable".to_string() }
                });
                current.insert(name.clone(), match blob {
                    Some(blob) => json!({ "blob": blob, "kind": "symlink" }),
                    None => json!({ "blob": "unreadable" }),
                });
            } else if !info.is_file() {
                current.insert(name.clone(), json!({ "blob": "not-a-file" }));
            } else if info.len() as f64 > 2.0 * TEXT_BYTES {
                current.insert(name.clone(), json!({ "blob": "too-large" }));
            } else if name.contains(['\r', '\n']) {
                current.insert(name.clone(), json!({ "blob": "odd-name" }));
            } else {
                to_hash.push(name);
            }
        }
        for batch in to_hash.chunks(500) {
            // A name that starts with a quote would be read as C-style quoted text: quote it ourselves.
            let lines: Vec<String> = batch.iter().map(|name| if name.starts_with('"') { format!("\"{}\"", name.replace('\\', "\\\\").replace('"', "\\\"")) } else { name.to_string() }).collect();
            let hashed = self.git(root, &["hash-object", "--stdin-paths"], Git { input: Some(format!("{}\n", lines.join("\n"))), ..reads(60000) });
            let listed = if hashed.ok { text_of(&hashed) } else { String::new() };
            let ids: Vec<&str> = js::split_lines(&listed).into_iter().filter(|id| !id.is_empty()).collect();
            for (index, name) in batch.iter().enumerate() {
                let id = ids.get(index).copied().filter(|id| is_sha(id) && ids.len() == batch.len());
                current.insert(name.to_string(), json!({ "blob": id.unwrap_or("unreadable") }));
            }
        }
        Value::Object(current)
    }

    /// Which state each file is in, for the page: can be put back, already back, or changed since.
    fn states_of(entries: &[Value], current: &Value) -> HashMap<String, &'static str> {
        let plan = rules::plan_revert(entries, "attempt", &Value::Null, current, true, false);
        let names = |key: &str| -> HashSet<String> { plan[key].as_array().into_iter().flatten().map(|row| js::string(&row["path"])).collect() };
        let (refused, restoring) = (names("refused"), names("restore"));
        let mut state = HashMap::new();
        for entry in entries {
            let own: Vec<String> = [&entry["path"], &entry["oldPath"]].into_iter().filter(|name| js::truthy(name)).map(js::string).collect();
            let label = if own.iter().any(|name| refused.contains(name)) {
                "changed"
            } else if own.iter().any(|name| restoring.contains(name)) {
                "can-revert"
            } else {
                "reverted"
            };
            state.insert(js::string(&entry["path"]), label);
        }
        state
    }

    fn changes(&self, request: &Value) -> Result<Value> {
        let field = |key: &str| js::get(request, key).cloned().unwrap_or(Value::Null);
        let running = js::get(request, "running").cloned().unwrap_or(Value::Bool(false));
        let task = js::get(request, "taskId").map_or("undefined".to_string(), js::string);
        let live_key = format!("{}\0{task}\0{}\0{}\0{}", key_of(&field("root")), js::string(&field("attempt")), js::string(&field("runId")), js::string(&running));
        let kept = live().lock().unwrap_or_else(|poison| poison.into_inner()).get(&live_key).cloned();
        if let Some((at, value)) = kept {
            if self.clock() - at < LIVE_MS {
                return Ok(value);
            }
        }
        let value = self.read_changes(request)?;
        let mut held = live().lock().unwrap_or_else(|poison| poison.into_inner());
        if value["ok"] == json!(true) && value["state"] != json!("ended") {
            held.insert(live_key, (self.clock(), value.clone()));
        } else {
            held.shift_remove(&live_key);
        }
        if held.len() > LIVE_KEPT {
            held.shift_remove_index(0);
        }
        Ok(value)
    }

    fn chosen(&self, root: &str, key: &str, request: &Value) -> (Vec<Value>, Option<Value>) {
        let attempts = rules::attempts_of(&self.runner.refs_of(root, Some(key)), key);
        let chosen = resolve_attempt(&attempts, js::get(request, "attempt").unwrap_or(&Value::Null), js::get(request, "runId").unwrap_or(&Value::Null));
        (attempts, chosen)
    }

    fn read_changes(&self, request: &Value) -> Result<Value> {
        let field = |key: &str| js::get(request, key).cloned().unwrap_or(Value::Null);
        let none = |reason: &str| json!({ "ok": true, "available": false, "reason": reason, "note": rules::unavailable(reason) });
        let Some(key) = rules::task_key(&field("taskId")) else { return Ok(none("unreadable")) };
        let root = field("root");
        if let Err(reason) = self.probe(&root) {
            return Ok(none(reason));
        }
        let folder = js::string(&root);
        let (attempts, chosen) = self.chosen(&folder, &key, request);
        let Some(chosen) = chosen.filter(|chosen| js::truthy(&chosen["before"])) else {
            return Ok(json!({ "ok": true, "available": true, "attempts": described(&attempts, None), "attempt": null, "files": [], "totals": rules::totals_of(&[]), "more": 0, "skipped": { "count": 0, "files": [], "sentence": "" }, "state": "none", "note": "" }));
        };
        let ended = js::truthy(&chosen["after"]);
        let state = if ended { "ended" } else if js::truthy(&field("running")) { "running" } else { "unfinished" };
        let before_sha = js::string(&chosen["before"]["sha"]);
        let entries = if ended {
            self.change_entries(&folder, &before_sha, &js::string(&chosen["after"]["sha"]))
        } else {
            // No end picture: the folder as it is now against the start, without keeping one.
            gated(|| self.snapshot_tree(&folder, self.clock() + 20000.0)).ok().and_then(|shot| self.change_entries(&folder, &before_sha, &shot.tree))
        };
        let Some(entries) = entries else { return Ok(none("unreadable")) };
        let reviewed = &entries[..entries.len().min(REVERT_FILES)];
        let states = if ended { Self::states_of(reviewed, &self.current_blobs(&folder, &rules::names_of(reviewed))) } else { HashMap::new() };
        let before_facts = self.read_message(&folder, &before_sha);
        let after_facts = ended.then(|| self.read_message(&folder, &js::string(&chosen["after"]["sha"])));
        let list = |facts: Option<&Value>, key: &str| facts.and_then(|facts| facts[key].as_array().cloned()).unwrap_or_default();
        let mut skipped_rows = list(Some(&before_facts), "skipped");
        skipped_rows.extend(list(after_facts.as_ref(), "skipped"));
        let skipped_count = before_facts["skippedCount"].as_f64().unwrap_or(0.0).max(after_facts.as_ref().and_then(|facts| facts["skippedCount"].as_f64()).unwrap_or(0.0)).max(skipped_rows.len() as f64);
        let listed = &entries[..entries.len().min(LISTED_FILES)];
        let mut overlap: Vec<Value> = Vec::new();
        for run in list(Some(&before_facts), "overlap").into_iter().chain(list(after_facts.as_ref(), "overlap")) {
            if !overlap.contains(&run) {
                overlap.push(run);
            }
        }
        Ok(json!({
            "ok": true, "available": true, "attempt": chosen["n"], "runId": chosen["runId"], "state": state,
            "attempts": described(&attempts, Some(&chosen)),
            "files": listed.iter().map(|entry| rules::public_entry(entry, states.get(&js::string(&entry["path"])).copied())).collect::<Vec<_>>(),
            "totals": rules::totals_of(&entries), "more": entries.len() - listed.len(),
            "skipped": { "count": js::num(skipped_count), "files": skipped_rows.iter().take(SKIPPED_LISTED).cloned().collect::<Vec<_>>(), "sentence": rules::skipped_sentence(&skipped_rows, Some(skipped_count)) },
            "overlap": overlap, "worktree": js::truthy(&before_facts["worktree"]),
            "startedAt": chosen["startedAt"], "endedAt": chosen["endedAt"],
        }))
    }

    /// One file's diff, on demand and bounded.
    fn diff(&self, request: &Value) -> Result<Value> {
        let field = |key: &str| js::get(request, key).cloned().unwrap_or(Value::Null);
        let key = rules::task_key(&field("taskId"));
        let file = field("path").as_str().filter(|file| !file.is_empty()).map(String::from);
        let (Some(key), Some(file)) = (key, file) else { return Ok(json!({ "ok": false, "error": "Choose a file from the list." })) };
        let root = field("root");
        if let Err(reason) = self.probe(&root) {
            return Ok(refused(reason));
        }
        let folder = js::string(&root);
        let (_, chosen) = self.chosen(&folder, &key, request);
        let Some(chosen) = chosen.filter(|chosen| js::truthy(&chosen["before"])) else { return Ok(json!({ "ok": false, "error": "That attempt has no snapshot to read." })) };
        let target = match chosen["after"]["sha"].as_str() {
            Some(sha) => sha.to_string(),
            None => match gated(|| self.snapshot_tree(&folder, self.clock() + 20000.0)) {
                Ok(shot) => shot.tree,
                Err(reason) => return Ok(refused(reason)),
            },
        };
        let before_sha = js::string(&chosen["before"]["sha"]);
        let entries = self.change_entries(&folder, &before_sha, &target).unwrap_or_default();
        let Some(entry) = entries.iter().find(|item| item["path"].as_str() == Some(&file) || item["oldPath"].as_str() == Some(&file)) else {
            return Ok(json!({ "ok": false, "error": "That file is not part of this attempt." }));
        };
        let names: Vec<String> = [&entry["oldPath"], &entry["path"]].into_iter().filter(|name| js::truthy(name)).map(|name| format!(":(literal){}", js::string(name))).collect();
        let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--no-textconv", "-U3", "-M", &before_sha, &target, "--"];
        args.extend(names.iter().map(String::as_str));
        let shown = self.git(&folder, &args, Git { max_buffer: 32 * MIB, ..reads(30000) });
        if !shown.ok && !shown.overflow {
            return Ok(json!({ "ok": false, "error": "Git could not read that file's diff." }));
        }
        let parsed = if shown.overflow { json!({ "binary": false, "lines": [], "truncated": true }) } else { rules::parse_diff(&text_of(&shown), DIFF_LINES, DIFF_BYTES) };
        let view = rules::public_entry(entry, None);
        Ok(json!({
            "ok": true, "path": view["path"], "oldPath": view["oldPath"], "status": view["status"], "additions": view["additions"], "deletions": view["deletions"],
            "binary": js::truthy(&parsed["binary"]) || js::truthy(&view["binary"]), "lines": parsed["lines"], "truncated": js::truthy(&parsed["truncated"]) || shown.overflow,
        }))
    }

    // ---- writing files back ----

    /// The file's content as it goes to disk (git's own checkout conversions apply).
    fn blob_bytes(&self, root: &str, blob: &str, name: &str) -> Option<Vec<u8>> {
        let got = self.git(root, &["cat-file", "--filters", &format!("--path={name}"), blob], Git { max_buffer: (TEXT_BYTES as usize) * 2 + MIB, ..reads(60000) });
        got.ok.then_some(got.stdout)
    }

    /// Applies a revert plan: every new content is read first, then each file is swapped in.
    /// A failure part-way puts back the ones already done.
    fn apply(&self, root: &str, plan: &Value, before: &HashMap<String, Option<Vec<u8>>>) -> Value {
        let steps = plan["restore"].as_array().cloned().unwrap_or_default();
        let mut bytes: HashMap<String, Vec<u8>> = HashMap::new();
        for step in steps.iter().filter(|step| step["action"] == "write") {
            let path = js::string(&step["path"]);
            let content = step["blob"].as_str().filter(|blob| !blob.is_empty()).and_then(|blob| self.blob_bytes(root, blob, &path));
            let Some(content) = content else { return json!({ "ok": false, "error": format!("Git could not read the earlier copy of {path}. Nothing was changed.") }) };
            bytes.insert(path, content);
        }
        let mut done: Vec<(&Value, Option<&Vec<u8>>)> = Vec::new();
        for step in &steps {
            let path = js::string(&step["path"]);
            let was = before.get(&path).and_then(Option::as_ref);
            let result = if step["action"] == "write" { write_atomic(root, &path, bytes.get(&path).map_or(&[][..], Vec::as_slice), &step["mode"]) } else { remove_file(root, &path) };
            if let Err(error) = result {
                let stuck = steps.get(done.len()).map_or("a file".to_string(), |step| js::string(&step["path"]));
                for (step, was) in done.into_iter().rev() {
                    let path = js::string(&step["path"]);
                    let _ = match was {
                        None => remove_file(root, &path),
                        Some(was) => write_atomic(root, &path, was, &step["mode"]),
                    };
                }
                return json!({ "ok": false, "error": format!("{stuck} could not be replaced ({}), so the files already put back were restored. Nothing was changed.", first_line(&error, "")) });
            }
            done.push((step, was));
        }
        json!({ "ok": true, "count": done.len() })
    }

    /// Puts files back to the "before" picture.
    fn revert(&self, request: &Value) -> Result<Value> {
        let field = |key: &str| js::get(request, key).cloned().unwrap_or(Value::Null);
        let task_id = field("taskId");
        let Some(key) = rules::task_key(&task_id) else { return Ok(json!({ "ok": false, "error": "Choose a task first." })) };
        let root = field("root");
        if let Err(reason) = self.probe(&root) {
            return Ok(refused(reason));
        }
        let folder = js::string(&root);
        serial(&root, || {
            if self.busy(request, &root)? {
                return Ok(json!({ "ok": false, "busy": true, "error": BUSY_NOW }));
            }
            let (_, chosen) = self.chosen(&folder, &key, request);
            let Some(chosen) = chosen.filter(|chosen| js::truthy(&chosen["before"]) && js::truthy(&chosen["after"])) else {
                return Ok(json!({ "ok": false, "error": "This attempt has no end snapshot, so Studio cannot tell what it changed. Nothing was reverted." }));
            };
            let after_sha = js::string(&chosen["after"]["sha"]);
            let Some(entries) = self.change_entries(&folder, &js::string(&chosen["before"]["sha"]), &after_sha) else { return Ok(json!({ "ok": false, "error": rules::unavailable("unreadable") })) };
            let scope = field("scope");
            let scope = scope.as_str().unwrap_or("");
            let file = field("path");
            let wanted: Vec<Value> = if scope == "file" { entries.iter().filter(|entry| entry["path"] == file || entry["oldPath"] == file).cloned().collect() } else { entries.clone() };
            let current = self.current_blobs(&folder, &rules::names_of(&wanted));
            let plan = rules::plan_revert(&entries, scope, &file, &current, js::truthy(&field("partial")), !cfg!(windows));
            let message = js::string(&plan["message"]);
            if plan["ok"] != json!(true) {
                return Ok(json!({ "ok": false, "refused": plan["refused"], "error": if message.is_empty() { "Nothing to put back.".to_string() } else { message } }));
            }
            let restore = plan["restore"].as_array().cloned().unwrap_or_default();
            let already = plan["already"].as_array().map_or(0, Vec::len);
            if restore.is_empty() {
                return Ok(json!({ "ok": true, "reverted": 0, "already": already, "refused": plan["refused"], "note": if already > 0 { "Those files are already as they were before the attempt." } else { "This attempt changed no files." } }));
            }
            // The safety picture: the folder exactly as it is, before a byte moves.
            let stamp = rules::stamp_of(self.clock());
            let shot = match gated(|| self.snapshot_tree(&folder, self.clock() + 30000.0)) {
                Ok(shot) => shot,
                Err(reason) => return Ok(json!({ "ok": false, "reason": reason, "error": format!("Studio could not keep a copy of the folder first, so it changed nothing. {}", rules::unavailable(reason)) })),
            };
            let touched: Vec<String> = restore.iter().map(|step| js::string(&step["path"])).collect();
            let message = rules::message_of(&Message {
                task_id: &task_id, n: &chosen["n"], phase: "reverted", run_id: &chosen["runId"], at: self.clock(), worktree: false,
                overlap: &json!([]), skipped: &shot.skipped, skipped_count: Some(shot.skipped_count), paths: &touched, stamp: stamp.as_deref(),
            });
            let made = self.commit_tree(&folder, &shot.tree, std::slice::from_ref(&after_sha), message);
            let receipt = rules::ref_name(&task_id, &chosen["n"], "reverted", stamp.as_deref());
            let kept = match (&made, &receipt) {
                (Some(sha), Some(receipt)) => self.make_ref(&folder, receipt, sha).ok,
                _ => false,
            };
            if !kept {
                return Ok(json!({ "ok": false, "error": "Studio could not keep a copy of the folder first, so it changed nothing." }));
            }
            // The checks above and the copy took a moment: look again before a byte moves.
            if self.busy(request, &root)? {
                return Ok(json!({ "ok": false, "busy": true, "error": "A builder started working in this folder. Nothing was changed.", "receipt": stamp }));
            }
            let held = contents_now(&folder, &restore);
            let applied = self.apply(&folder, &plan, &held);
            if applied["ok"] != json!(true) {
                return Ok(json!({ "ok": false, "error": applied["error"], "receipt": stamp }));
            }
            let refused_any = plan["refused"].as_array().is_some_and(|rows| !rows.is_empty());
            Ok(json!({ "ok": true, "reverted": applied["count"], "files": touched.len(), "already": already, "refused": plan["refused"], "receipt": stamp, "note": if refused_any { plan["message"].clone() } else { json!("") } }))
        })
    }

    /// Undoes a revert: the files it touched go back, only while they still hold what the revert wrote.
    fn undo(&self, request: &Value) -> Result<Value> {
        let field = |key: &str| js::get(request, key).cloned().unwrap_or(Value::Null);
        let key = rules::task_key(&field("taskId"));
        let receipt = field("receipt").as_str().filter(|receipt| js_regex!(r"^\d{8}T\d{9}Z$", "").is_match(receipt)).map(String::from);
        let (Some(key), Some(receipt)) = (key, receipt) else { return Ok(json!({ "ok": false, "error": "Choose a revert to undo." })) };
        let root = field("root");
        if let Err(reason) = self.probe(&root) {
            return Ok(refused(reason));
        }
        let folder = js::string(&root);
        serial(&root, || {
            if self.busy(request, &root)? {
                return Ok(json!({ "ok": false, "busy": true, "error": BUSY_NOW }));
            }
            let gone = || Ok(json!({ "ok": false, "error": "That revert can no longer be undone." }));
            let (_, chosen) = self.chosen(&folder, &key, request);
            let Some(chosen) = chosen.filter(|chosen| js::truthy(&chosen["before"]) && js::truthy(&chosen["after"])) else { return gone() };
            let Some(saved) = chosen["reverts"].as_array().into_iter().flatten().find(|row| row["stamp"].as_str() == Some(&receipt)) else { return gone() };
            let facts = self.read_message(&folder, &js::string(&saved["sha"]));
            let entries = self.change_entries(&folder, &js::string(&chosen["before"]["sha"]), &js::string(&chosen["after"]["sha"])).unwrap_or_default();
            let touched: HashSet<String> = facts["paths"].as_array().into_iter().flatten().map(js::string).collect();
            let picked: Vec<Value> = entries.into_iter().filter(|entry| touched.contains(&js::string(&entry["path"])) || (entry["oldPath"].is_string() && touched.contains(&js::string(&entry["oldPath"])))).collect();
            let inverse = rules::invert_entries(&picked);
            if inverse.is_empty() {
                return gone();
            }
            let current = self.current_blobs(&folder, &rules::names_of(&inverse));
            let plan = rules::plan_revert(&inverse, "attempt", &Value::Null, &current, false, !cfg!(windows));
            let message = js::string(&plan["message"]);
            if plan["ok"] != json!(true) {
                return Ok(json!({ "ok": false, "refused": plan["refused"], "error": if message.is_empty() { "Nothing to put back.".to_string() } else { message } }));
            }
            let restore = plan["restore"].as_array().cloned().unwrap_or_default();
            if restore.is_empty() {
                return Ok(json!({ "ok": true, "reverted": 0, "note": "Those files are already back." }));
            }
            if self.busy(request, &root)? {
                return Ok(json!({ "ok": false, "busy": true, "error": "A builder started working in this folder. Nothing was changed." }));
            }
            let held = contents_now(&folder, &restore);
            let applied = self.apply(&folder, &plan, &held);
            Ok(if applied["ok"] == json!(true) { json!({ "ok": true, "reverted": applied["count"] }) } else { json!({ "ok": false, "error": applied["error"] }) })
        })
    }

    /// A start picture whose run never began goes, unless an end picture exists.
    fn drop_start(&self, request: &Value) -> Result<Value> {
        let field = |key: &str| js::get(request, key).cloned().unwrap_or(Value::Null);
        let (task_id, n) = (field("taskId"), field("n"));
        let (Some(before), Some(after)) = (rules::ref_name(&task_id, &n, "before", None), rules::ref_name(&task_id, &n, "after", None)) else { return Ok(json!({ "ok": false, "dropped": false })) };
        let root = field("root");
        if self.probe(&root).is_err() {
            return Ok(json!({ "ok": false, "dropped": false }));
        }
        let folder = js::string(&root);
        Ok(serial(&root, || {
            if self.verified(&folder, &after).ok || !self.verified(&folder, &before).ok {
                return json!({ "ok": true, "dropped": false });
            }
            let gone = self.git(&folder, &["update-ref", "-d", &before], Git { timeout: 15000, ..Git::default() });
            json!({ "ok": gone.ok, "dropped": gone.ok })
        }))
    }

    fn attempts(&self, request: &Value) -> Result<Value> {
        let field = |key: &str| js::get(request, key).cloned().unwrap_or(Value::Null);
        let root = field("root");
        let ready = match rules::task_key(&field("taskId")) {
            Some(key) => self.probe(&root).map(|_| key),
            None => Err("unreadable"),
        };
        Ok(match ready {
            Ok(key) => json!({ "ok": true, "attempts": rules::attempts_of(&self.runner.refs_of(&js::string(&root), Some(&key)), &key) }),
            Err(reason) => json!({ "ok": false, "reason": reason, "attempts": [] }),
        })
    }
}

fn budget_of(request: &Value, fallback: f64) -> f64 {
    match js::get(request, "budgetMs") {
        None => fallback,
        Some(value) => js::to_number(Some(value)),
    }
}

fn resolve_attempt(attempts: &[Value], attempt: &Value, run_id: &Value) -> Option<Value> {
    if let Some(n) = js::safe_integer(attempt) {
        return attempts.iter().find(|item| item["n"].as_f64() == Some(n)).cloned();
    }
    if js::truthy(run_id) {
        return attempts.iter().find(|item| &item["runId"] == run_id).cloned();
    }
    attempts.iter().find(|item| js::truthy(&item["before"])).or_else(|| attempts.first()).cloned()
}

fn described(attempts: &[Value], chosen: Option<&Value>) -> Vec<Value> {
    attempts
        .iter()
        .map(|item| {
            json!({
                "n": item["n"], "runId": item["runId"], "startedAt": item["startedAt"], "endedAt": item["endedAt"], "ended": js::truthy(&item["after"]),
                "selected": chosen.is_some_and(|chosen| chosen["n"] == item["n"]),
                "reverts": item["reverts"].as_array().into_iter().flatten().map(|row| json!({ "stamp": row["stamp"], "at": row["at"] })).collect::<Vec<_>>(),
            })
        })
        .collect()
}

/// What each path holds right now, so a failed step can put it back.
fn contents_now(root: &str, steps: &[Value]) -> HashMap<String, Option<Vec<u8>>> {
    steps.iter().map(|step| js::string(&step["path"])).map(|path| (path.clone(), std::fs::read(in_folder(root, &path)).ok())).collect()
}

/// `path.relative(root, target)` stays inside.
fn within(root_real: &str, target: &str) -> bool {
    let (root, target) = (fold(root_real.to_string()), fold(target.to_string()));
    if root == target {
        return true;
    }
    let prefix = if root.ends_with(['/', '\\']) { root } else { format!("{root}{}", std::path::MAIN_SEPARATOR) };
    target.strip_prefix(&prefix).is_some_and(|rest| !rest.starts_with(".."))
}

/// A write goes only where the folder's own real path says it is inside the project.
fn checked_folder(root: &str, folder: &Path) -> std::result::Result<(), String> {
    let root_real = real_path(root).ok_or_else(|| "ENOENT: no such file or directory".to_string())?;
    let mut nearest = folder.to_path_buf();
    let found = loop {
        match std::fs::canonicalize(&nearest) {
            Ok(_) => break real_path(&nearest.to_string_lossy()).unwrap_or_default(),
            Err(error) => {
                let up = nearest.parent().map(Path::to_path_buf);
                match up {
                    Some(up) if up != nearest && missing_kind(&error) => nearest = up,
                    _ => return Err("outside".into()),
                }
            }
        }
    };
    if within(&root_real, &found) {
        Ok(())
    } else {
        Err("outside".into())
    }
}

fn write_atomic(root: &str, name: &str, bytes: &[u8], mode: &Value) -> std::result::Result<(), String> {
    let target = in_folder(root, name);
    let folder = target.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from(root));
    checked_folder(root, &folder)?;
    std::fs::create_dir_all(&folder).map_err(|error| io_message(&error))?;
    checked_folder(root, &folder)?;
    match std::fs::symlink_metadata(&target) {
        Ok(info) if info.file_type().is_symlink() || info.is_dir() => return Err("not a plain file".into()),
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(io_message(&error)),
        _ => {}
    }
    let temp = folder.join(format!(".mefi-restore-{}.tmp", random_hex(12)));
    let written = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(bytes)?;
        drop(file);
        #[cfg(unix)]
        if let Some(mode) = mode.as_u64() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(mode as u32));
        }
        #[cfg(not(unix))]
        let _ = mode;
        std::fs::rename(&temp, &target)
    })();
    written.map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        io_message(&error)
    })
}

fn remove_file(root: &str, name: &str) -> std::result::Result<(), String> {
    let target = in_folder(root, name);
    let folder = target.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from(root));
    checked_folder(root, &folder)?;
    let info = std::fs::symlink_metadata(&target).map_err(|error| io_message(&error))?;
    if info.is_dir() {
        return Err("not a plain file".into());
    }
    std::fs::remove_file(&target).map_err(|error| io_message(&error))?;
    // The folders the attempt made, left empty: only empty ones go, up to the project folder.
    let top = paths::resolve(root);
    let mut dir = folder;
    loop {
        let here = paths::resolve(&dir.to_string_lossy());
        if here == top || !here.starts_with(&top) || std::fs::remove_dir(&dir).is_err() {
            break;
        }
        match dir.parent() {
            Some(up) => dir = up.to_path_buf(),
            None => break,
        }
    }
    Ok(())
}

/// One factory method by its JavaScript name, or one rule as `rules.<name>`.
pub fn call(function: &str, args: &[Value], callbacks: &dyn Callbacks) -> Result<Value> {
    if let Some(name) = function.strip_prefix("rules.") {
        return rules::call(name, args).ok_or_else(|| format!("no such function: snapshots.{function}"));
    }
    let collaborators = args.first().cloned().unwrap_or(Value::Null);
    let request = args.get(1).cloned().unwrap_or(Value::Null);
    let host = Host::new(&collaborators, callbacks);
    let answer = match function {
        "begin" => host.begin(&request),
        "end" => host.end(&request),
        "drop" => host.drop_start(&request),
        "changes" => host.changes(&request),
        "diff" => host.diff(&request),
        "revert" => host.revert(&request),
        "undo" => host.undo(&request),
        "attempts" => host.attempts(&request),
        "prune" => Ok(match js::get(&request, "root").and_then(Value::as_str) {
            Some(root) => host.runner.prune_refs(root),
            None => json!({ "ok": true, "pruned": 0 }),
        }),
        // probe(root): the folder itself, not a request.
        "probe" => Ok(match host.probe(&request) {
            Ok(()) => json!({ "ok": true }),
            Err(reason) => json!({ "ok": false, "reason": reason }),
        }),
        _ => return Err(format!("no such function: snapshots.{function}")),
    };
    Ok(answer.unwrap_or_else(|_| {
        host.log(format!("[review] {function} failed (error)"));
        unreadable()
    }))
}
