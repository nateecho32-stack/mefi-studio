//! The project's git checkout: multi-PC sync (scripts/sync.mjs), the worktree
//! table (scripts/worktrees.mjs) and what Studio may do to a worktree
//! (scripts/worktree-actions.mjs), in Rust. Git runs as a child process with
//! sync.mjs's rules: no shell, no terminal prompt, no optional index lock,
//! bounded output and time, and no credentials in any text that leaves.

mod actions;
mod sync;
mod worktrees;

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use regex::Regex;
use serde_json::{json, Value};

use crate::callbacks::Callbacks;
use crate::js;

pub type Result<T> = std::result::Result<T, String>;

/// The module functions the engine may call, as `<module>.<function>`.
pub const FUNCTIONS: &[&str] = &[
    "sync.sync",
    "sync.inspect",
    "sync.remoteMoved",
    "sync.changedFiles",
    "sync.lostWork",
    "worktrees.listWorktrees",
    "worktrees.inspectWorktree",
    "worktree-actions.mergeWorktree",
    "worktree-actions.removeWorktree",
    "worktree-actions.pruneWorktrees",
    "worktree-actions.worktreeFolder",
];

pub(crate) const REMOTE: &str = "origin";
const MAX_OUTPUT: usize = 4 * 1024 * 1024;

/// What one git command did, in runGit's shape.
#[derive(Clone, Debug)]
pub struct Git {
    pub ok: bool,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
}

fn credentials() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)([a-z][a-z0-9+.-]*://)[^/@\s]+@").expect("valid pattern"))
}

/// scrub: a remote URL loses any user:password part.
pub fn scrub(text: &str) -> String {
    credentials().replace_all(text, "$1").into_owned()
}

/// The non-empty lines of a text (sync.mjs `lines`).
pub fn lines(text: &str) -> Vec<&str> {
    text.split('\n').map(|line| line.strip_suffix('\r').unwrap_or(line)).filter(|line| !line.is_empty()).collect()
}

/// The first non-blank trimmed line, scrubbed.
pub fn first_line(text: &str) -> String {
    scrub(text.split('\n').map(str::trim).find(|line| !line.is_empty()).unwrap_or(""))
}

pub fn last_line(text: &str) -> String {
    scrub(text.split('\n').map(str::trim).filter(|line| !line.is_empty()).last().unwrap_or(""))
}

pub fn plural(count: f64, word: &str) -> String {
    plural_as(count, word, &format!("{word}s"))
}

pub fn plural_as(count: f64, word: &str, many: &str) -> String {
    format!("{} {}", js::number_string(count), if count == 1.0 { word } else { many })
}

fn read_capped(stream: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<(Vec<u8>, bool)> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut over = false;
        if let Some(mut stream) = stream {
            let mut buf = [0u8; 65536];
            loop {
                match stream.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if bytes.len() + n > MAX_OUTPUT {
                            over = true;
                            bytes.extend_from_slice(&buf[..MAX_OUTPUT.saturating_sub(bytes.len())]);
                        } else {
                            bytes.extend_from_slice(&buf[..n]);
                        }
                    }
                }
            }
        }
        (bytes, over)
    })
}

/// runGit(cwd, args, { timeout }).
pub fn run_git(cwd: &str, args: &[String], timeout_ms: u64) -> Git {
    let failed = |message: String| Git { ok: false, timed_out: false, stdout: String::new(), stderr: scrub(&message) };
    if !std::path::Path::new(cwd).is_dir() {
        return failed("spawn git ENOENT".into());
    }
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return failed(format!("spawn git {error}")),
    };
    let out = read_capped(child.stdout.take());
    let err = read_capped(child.stderr.take());
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() >= Duration::from_millis(timeout_ms) => {
                timed_out = true;
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(5)),
            Err(_) => break None,
        }
    };
    let (stdout, out_over) = out.join().unwrap_or_default();
    let (stderr, err_over) = err.join().unwrap_or_default();
    let ok = status.is_some_and(|status| status.success()) && !out_over && !err_over;
    let stdout = String::from_utf8_lossy(&stdout).trim().to_string();
    let stderr_text = String::from_utf8_lossy(&stderr).trim().to_string();
    // execFile's error message stands in for an empty stderr, as runGit did.
    let stderr = if !stderr_text.is_empty() {
        stderr_text
    } else if ok {
        String::new()
    } else {
        format!("Command failed: git {}\n", args.join(" "))
    };
    Git { ok, timed_out, stdout, stderr: scrub(&stderr) }
}

/// A git runner bound to one folder, with the default 30 s.
pub(crate) fn git_in(cwd: &str) -> impl Fn(&[&str]) -> Git + '_ {
    move |args: &[&str]| run_git(cwd, &args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>(), 30_000)
}

pub(crate) fn as_text(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(value) => js::string(value),
    }
}

/// One module function by its JavaScript name, with its argument list.
pub fn call(function: &str, args: &[Value], callbacks: &dyn Callbacks) -> Result<Value> {
    let arg = |index: usize| args.get(index).cloned().unwrap_or(Value::Null);
    let options = arg(2);
    match function {
        "sync.sync" => sync::sync(&as_text(args.first()), &arg(1), callbacks),
        "sync.inspect" => Ok(sync::inspect(&as_text(args.first()))),
        "sync.remoteMoved" => Ok(sync::remote_moved(&as_text(args.first()), &arg(1))),
        "sync.changedFiles" => Ok(json!(sync::changed_files(&as_text(args.first())))),
        "sync.lostWork" => Ok(sync::lost_work(&as_text(args.first()), &arg(1))),
        "worktrees.listWorktrees" => Ok(worktrees::list_worktrees(&as_text(args.first()))),
        "worktrees.inspectWorktree" => Ok(worktrees::inspect_worktree(&as_text(args.first()), &as_text(args.get(1)))),
        "worktree-actions.mergeWorktree" => actions::merge_worktree(&as_text(args.first()), &as_text(args.get(1)), &options, callbacks),
        "worktree-actions.removeWorktree" => actions::remove_worktree(&as_text(args.first()), &as_text(args.get(1)), &options, callbacks),
        "worktree-actions.pruneWorktrees" => Ok(actions::prune_worktrees(&as_text(args.first()))),
        "worktree-actions.worktreeFolder" => Ok(actions::worktree_folder(&as_text(args.first()), &as_text(args.get(1)))),
        other => Err(format!("{other} has not moved to Rust")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_drops_credentials() {
        assert_eq!(scrub("fatal: https://user:token@github.com/x.git"), "fatal: https://github.com/x.git");
        assert_eq!(scrub("ssh://git@host/x and HTTP://a:b@c"), "ssh://host/x and HTTP://c");
    }

    #[test]
    fn lines_and_plurals() {
        assert_eq!(lines("a\r\n\nb\n"), vec!["a", "b"]);
        assert_eq!(first_line("\n  first \nsecond"), "first");
        assert_eq!(last_line("one\n two \n\n"), "two");
        assert_eq!(plural(1.0, "file"), "1 file");
        assert_eq!(plural_as(2.0, "stash", "stashes"), "2 stashes");
    }
}
