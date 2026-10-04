//! Running git, gh and the two Windows tools the Git chip needs, as
//! scripts/git-actions.cjs `run` does: no shell, prompts off, the variables
//! that would point git at another repository dropped, Studio's own keys
//! withheld, bounded time and output, and a timed-out command ended with
//! everything it started.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::js;
use crate::js_regex;

pub const MIB: usize = 1024 * 1024;

/// What one command did (git-actions' `run` answer).
#[derive(Clone, Debug, Default)]
pub struct Ran {
    pub ok: bool,
    pub stdout: String,
    /// Already cleaned (no logins, no tokens), as the JavaScript keeps it.
    pub stderr: String,
    pub timed_out: bool,
    pub missing: bool,
}

pub struct Options<'a> {
    pub cwd: Option<&'a str>,
    pub timeout_ms: u64,
    pub reads: bool,
    pub input: Option<String>,
    pub max_buffer: usize,
}

impl Default for Options<'_> {
    fn default() -> Self {
        Options { cwd: None, timeout_ms: 20000, reads: false, input: None, max_buffer: 4 * MIB }
    }
}

const REDIRECTS: &[&str] = &["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"];

/// The child's environment: the engine's, without redirects or Studio's keys, with prompts off.
pub fn child_env(env: &Value, reads: bool) -> Vec<(String, String)> {
    let mut set: Vec<(&str, &str)> = vec![("GIT_TERMINAL_PROMPT", "0"), ("GCM_INTERACTIVE", "never"), ("GH_PROMPT_DISABLED", "1"), ("GH_NO_UPDATE_NOTIFIER", "1"), ("NO_COLOR", "1"), ("LC_ALL", "C")];
    if reads {
        set.push(("GIT_OPTIONAL_LOCKS", "0"));
    }
    let mut out: Vec<(String, String)> = Vec::new();
    if let Value::Object(map) = env {
        for (name, value) in map {
            let upper = name.to_uppercase();
            if REDIRECTS.contains(&upper.as_str()) || set.iter().any(|(key, _)| *key == upper) {
                continue;
            }
            // platform.cjs withholdCredentials: MEFI_STUDIO_*KEY and *TOKEN never reach a child.
            if js_regex!(r"^MEFI_STUDIO_[A-Z0-9_]*(KEY|TOKEN)$", "").is_match(&upper) {
                continue;
            }
            let text = match value {
                Value::String(text) => text.clone(),
                Value::Null => continue,
                other => js::string(other),
            };
            out.push((name.clone(), text));
        }
    }
    out.extend(set.into_iter().map(|(key, value)| (key.to_string(), value.to_string())));
    out
}

/// Where a bare command name is found: the child's PATH, trying `.com` then
/// `.exe` (libuv's rule, which Node's execFile follows; a name with an
/// extension is tried as written first). None is ENOENT.
pub fn locate(command: &str, env: &[(String, String)]) -> Option<PathBuf> {
    let given = Path::new(command);
    if given.components().count() > 1 || given.is_absolute() {
        return given.is_file().then(|| given.to_path_buf());
    }
    let path = env.iter().find(|(key, _)| key.eq_ignore_ascii_case("PATH")).map(|(_, value)| value.clone())?;
    let has_extension = given.extension().is_some();
    for dir in std::env::split_paths(&path) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let mut tries: Vec<PathBuf> = Vec::new();
        if has_extension {
            tries.push(dir.join(command));
        }
        if cfg!(windows) {
            tries.push(dir.join(format!("{command}.com")));
            tries.push(dir.join(format!("{command}.exe")));
        } else if !has_extension {
            tries.push(dir.join(command));
        }
        if let Some(found) = tries.into_iter().find(|candidate| candidate.is_file()) {
            return Some(found);
        }
    }
    None
}

fn reader(stream: Option<impl Read + Send + 'static>, cap: usize, over: Arc<AtomicBool>) -> mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut stream) = stream {
            let mut buf = [0u8; 65536];
            loop {
                match stream.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let room = cap.saturating_sub(bytes.len());
                        bytes.extend_from_slice(&buf[..n.min(room)]);
                        if n > room {
                            over.store(true, Ordering::SeqCst);
                            break;
                        }
                    }
                }
            }
        }
        let _ = tx.send(bytes);
    });
    rx
}

/// Ends a process and everything it started.
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let system = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let _ = Command::new(Path::new(&system).join("System32").join("taskkill.exe"))
            .args(["/pid", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .status();
    }
    let _ = child.kill();
}

/// What one command did, as bytes, with its exit code (attempt snapshots read
/// file contents and `git diff --quiet`'s answer).
#[derive(Clone, Debug, Default)]
pub struct Raw {
    pub ok: bool,
    /// The exit code; None when the command was ended (time, output) or never ran.
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    /// Already cleaned, as `Ran::stderr`.
    pub stderr: String,
    pub timed_out: bool,
    pub overflow: bool,
    pub missing: bool,
}

/// git-actions `run(command, args, options)`; `clean` is its credential scrub.
pub fn run(command: &str, args: &[String], options: &Options, env: &Value, kill_grace_ms: u64, clean: &dyn Fn(&str) -> String) -> Ran {
    let raw = run_raw(command, args, options, env, &[], kill_grace_ms, clean);
    Ran { ok: raw.ok, stdout: String::from_utf8_lossy(&raw.stdout).into_owned(), stderr: raw.stderr, timed_out: raw.timed_out, missing: raw.missing }
}

/// `run`, with variables set after the engine's (`extra`, which may name
/// `GIT_INDEX_FILE`: the redirect filter applies to inherited ones only), and
/// the answer as bytes with its exit code.
pub fn run_raw(command: &str, args: &[String], options: &Options, env: &Value, extra: &[(String, String)], kill_grace_ms: u64, clean: &dyn Fn(&str) -> String) -> Raw {
    let mut child_env = child_env(env, options.reads);
    child_env.retain(|(key, _)| !extra.iter().any(|(name, _)| name.eq_ignore_ascii_case(key)));
    child_env.extend(extra.iter().cloned());
    let missing = |message: String| Raw { ok: false, code: None, stdout: Vec::new(), stderr: clean(&message), timed_out: false, overflow: false, missing: true };
    // Node reports a missing working folder as the command missing (spawn ENOENT).
    if options.cwd.is_some_and(|cwd| !Path::new(cwd).is_dir()) {
        return missing(format!("spawn {command} ENOENT"));
    }
    let Some(program) = locate(command, &child_env) else { return missing(format!("spawn {command} ENOENT")) };
    let mut process = Command::new(&program);
    process.args(args).env_clear().envs(child_env.iter().map(|(key, value)| (key, value)));
    if let Some(cwd) = options.cwd {
        process.current_dir(cwd);
    }
    process.stdin(if options.input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x0800_0000); // CREATE_NO_WINDOW, as execFile's windowsHide
    }
    let mut child = match process.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return missing(format!("spawn {command} ENOENT")),
        Err(error) => return Raw { ok: false, code: None, stdout: Vec::new(), stderr: clean(&format!("spawn {command} {error}")), timed_out: false, overflow: false, missing: false },
    };
    if let (Some(input), Some(mut stdin)) = (options.input.clone(), child.stdin.take()) {
        std::thread::spawn(move || {
            let _ = stdin.write_all(input.as_bytes());
        });
    }
    let over_out = Arc::new(AtomicBool::new(false));
    let over_err = Arc::new(AtomicBool::new(false));
    let out = reader(child.stdout.take(), options.max_buffer, over_out.clone());
    let err = reader(child.stderr.take(), options.max_buffer, over_err.clone());
    let started = Instant::now();
    let timeout = Duration::from_millis(options.timeout_ms.max(1));
    let mut timed_out = false;
    let mut pause = Duration::from_millis(1);
    let status = loop {
        if over_out.load(Ordering::SeqCst) || over_err.load(Ordering::SeqCst) {
            kill_tree(&mut child);
            let _ = child.wait();
            break None;
        }
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() >= timeout => {
                timed_out = true;
                kill_tree(&mut child);
                let _ = child.wait();
                break None;
            }
            Ok(None) => {
                std::thread::sleep(pause);
                pause = (pause * 2).min(Duration::from_millis(20));
            }
            Err(_) => break None,
        }
    };
    // A helper the command started can hold the pipes open after it ends: wait a little, then give up on them.
    let grace = Duration::from_millis(if status.is_some() { kill_grace_ms.max(1000) } else { kill_grace_ms });
    let deadline = Instant::now() + grace;
    let take = |rx: &mpsc::Receiver<Vec<u8>>| rx.recv_timeout(deadline.saturating_duration_since(Instant::now())).unwrap_or_default();
    let stdout = take(&out);
    let stderr = take(&err);
    let overflow = over_out.load(Ordering::SeqCst) || over_err.load(Ordering::SeqCst);
    let exit_ok = status.is_some_and(|status| status.success());
    let ok = exit_ok && !overflow;
    let stderr_text = String::from_utf8_lossy(&stderr).into_owned();
    let trimmed = js::trim(&stderr_text);
    // execFile's error message stands in for an empty stderr.
    let message = if !trimmed.is_empty() {
        trimmed.to_string()
    } else if ok {
        String::new()
    } else if overflow {
        format!("{} maxBuffer length exceeded", if over_out.load(Ordering::SeqCst) { "stdout" } else { "stderr" })
    } else {
        format!("Command failed: {command} {}\n", args.join(" "))
    };
    Raw { ok, code: if overflow { None } else { status.and_then(|status| status.code()) }, stdout, stderr: clean(&message), timed_out: timed_out && !overflow, overflow, missing: false }
}
