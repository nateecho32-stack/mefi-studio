//! The two git reads that ran on the eyes worker: the working tree's dirty
//! files (gitPorcelain) and whether a claimed commit exists and left its
//! paths clean (commitEvidence). git runs as a child with eyes.mjs's limits:
//! 8 s, 1 MiB of output; a child that fails or is killed reads as status null.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::{js, paths};

const TIMEOUT: Duration = Duration::from_secs(8);
const MAX_OUTPUT: usize = 1024 * 1024;

/// (status, stdout): status None when git could not start, timed out, or wrote too much.
fn run_git(args: &[String]) -> (Option<i32>, String) {
    let mut command = Command::new("git");
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW, execFile's windowsHide
    }
    let Ok(mut child) = command.spawn() else {
        return (None, String::new());
    };
    let mut stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(stream) = stdout.as_mut() {
            let _ = stream.take(MAX_OUTPUT as u64 + 1).read_to_end(&mut bytes);
        }
        bytes
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) if started.elapsed() >= TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => break None,
        }
    };
    let bytes = reader.join().unwrap_or_default();
    let status = if bytes.len() > MAX_OUTPUT { None } else { status };
    (status, String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_OUTPUT)]).into_owned())
}

pub fn git_porcelain(root: Option<&Value>) -> String {
    let Some(root) = root.filter(|root| js::truthy(root)).map(js::string) else {
        return String::new();
    };
    if !std::path::Path::new(&paths::join(&root, ".git")).exists() {
        return String::new();
    }
    match run_git(&["-C".into(), root, "status".into(), "--porcelain=v1".into()]) {
        (Some(0), stdout) => stdout,
        _ => String::new(),
    }
}

pub fn commit_evidence(args: &Value) -> Value {
    let root = js::get(args, "root").filter(|root| js::truthy(root)).map(js::string);
    let claim = match js::get(args, "hash") {
        None | Some(Value::Null) => String::new(),
        Some(hash) => js::string(hash),
    };
    let claim = claim.trim().to_string();
    let valid = (7..=40).contains(&claim.len()) && claim.chars().all(|c| c.is_ascii_hexdigit());
    let Some(root) = root.filter(|_| valid) else {
        return json!({ "hash": null, "clean": null, "error": "no claimable commit hash" });
    };
    let (status, stdout) = run_git(&["-C".into(), root.clone(), "rev-parse".into(), "--verify".into(), "--quiet".into(), format!("{claim}^{{commit}}")]);
    if status != Some(0) {
        return json!({ "hash": null, "clean": null, "error": "commit not found in the repository" });
    }
    let resolved = match stdout.trim().to_lowercase() {
        text if text.is_empty() => claim.to_lowercase(),
        text => text,
    };
    let scope: Vec<String> = js::get(args, "paths")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(|value| value.as_str()).filter(|value| !value.trim().is_empty()).map(String::from).collect())
        .unwrap_or_default();
    let mut git_args = vec!["-C".to_string(), root, "status".into(), "--porcelain=v1".into()];
    if !scope.is_empty() {
        git_args.push("--".into());
        // Pathspecs match case-sensitively even where the filesystem does not.
        git_args.extend(scope.iter().map(|value| if cfg!(windows) { format!(":(icase){value}") } else { value.clone() }));
    }
    match run_git(&git_args) {
        (Some(0), stdout) => json!({ "hash": resolved, "clean": stdout.trim().is_empty() }),
        _ => json!({ "hash": resolved, "clean": null, "error": "path status could not be read" }),
    }
}
