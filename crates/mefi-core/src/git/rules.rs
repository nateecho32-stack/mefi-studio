//! The rules the Git chip's actions read, in Rust: the parts of
//! scripts/git-link.cjs that scripts/git-actions.cjs calls (scrubbing, what a
//! git or gh failure means, which paths never go in a commit, repository
//! names, the starting .gitignore and license, the publish plan), with
//! pc-setup.cjs's three readers, redaction.cjs's maskCredentials and the
//! share-review.cjs rules a save scans for. `describe` and `chip` stay in
//! JavaScript with scripts/git-host.cjs, which reads them.

use std::sync::OnceLock;

use serde_json::{json, Map, Value};

use crate::js;
use crate::js_regex;

pub const FOLDER_MISSING: &str = "That project folder is unavailable. Reconnect it before switching.";

fn text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        _ => String::new(),
    }
}

/// `count`: a whole number above zero, else 0.
pub fn count(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value.floor()
    } else {
        0.0
    }
}

pub fn plural(count: f64, word: &str) -> String {
    format!("{} {}", js::number_string(count), if count == 1.0 { word.to_string() } else { format!("{word}s") })
}

fn article(name: &str) -> String {
    let vowel = name.chars().next().is_some_and(|c| "aeiouAEIOU".contains(c));
    format!("{} {name}", if vowel { "an" } else { "a" })
}

/// git-link `scrub`: no login in a URL, no token.
pub fn scrub(raw: &str) -> String {
    let out = js_regex!(r"(:\/\/)[^/@\s]+@", "g").replace_all(raw, "${1}");
    let out = js_regex!(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b", "g").replace_all(&out, "[token]");
    let out = js_regex!(r#"\b(authorization\s*[:=]\s*(?:bearer|basic|token)\s+)[^\s'"]+"#, "gi").replace_all(&out, "${1}[token]");
    js_regex!(r#"\b((?:GH|GITHUB)_TOKEN\s*[:=]\s*)[^\s'"]+"#, "g").replace_all(&out, "${1}[token]").into_owned()
}

/// git-link `usefulLine`: the last line worth showing, not git's hints.
fn useful_line(value: &str) -> String {
    let scrubbed = scrub(value);
    let lead = js_regex!(r"^(?:remote|error|fatal):\s*", "i");
    let lines: Vec<String> = js::split_lines(&scrubbed)
        .into_iter()
        .map(js::trim)
        .filter(|line| !line.is_empty())
        .map(|line| js::trim(&lead.replace(line, "")).to_string())
        .filter(|line| !line.is_empty())
        .collect();
    let hint = js_regex!(r"^hint:", "i");
    lines.iter().filter(|line| !hint.is_match(line)).next_back().or(lines.last()).cloned().unwrap_or_default()
}

const RAW_CAP: isize = 20000;

fn tail_of(value: &str) -> String {
    let whole = scrub(value);
    if js::utf16_len(&whole) as isize > RAW_CAP {
        js::slice(&whole, -RAW_CAP, None)
    } else {
        whole
    }
}

fn network_failure(raw: &str) -> bool {
    js_regex!(r"could not resolve (host|proxy)|failed to connect|connection (timed out|refused|reset)|operation timed out|network is unreachable|no route to host|temporary failure in name resolution|recv failure|early eof|ssl_(error|connect)|getaddrinfo|enotfound|etimedout|econnreset|econnrefused|error connecting to|dial tcp|no such host|check your internet connection|connection was reset|forcibly closed by the remote host|ssl_(?:read|write)|context deadline exceeded|i\/o timeout|wsa(?:recv|send)", "i").is_match(raw)
}

fn push_state(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "non-fast-forward" | "protected-branch" | "workflow-scope" | "auth" | "unknown" => "push-refused",
        "not-found" => "fetch-failed",
        "offline" => "offline",
        "too-large" => "too-large",
        "secret" => "blocked-secret",
        _ => return None,
    })
}

/// git-link `classifyPush(stderr, { timedOut, branch })`.
pub fn classify_push(stderr: &str, timed_out: bool, branch: &str) -> Value {
    let raw = tail_of(stderr);
    let detail = useful_line(&raw);
    let done = |kind: &str, sentence: String, fix: &str, extra: Vec<(&str, Value)>| {
        let mut out = Map::new();
        out.insert("kind".into(), json!(kind));
        out.insert("text".into(), json!(sentence));
        out.insert("fix".into(), json!(fix));
        out.insert("state".into(), push_state(kind).map_or(Value::Null, |state| json!(state)));
        out.insert("detail".into(), json!(detail));
        for (key, value) in extra {
            out.insert(key.into(), value);
        }
        Value::Object(out)
    };
    if timed_out {
        return json!({ "kind": "timeout", "text": "Still uploading.", "fix": "wait", "state": null, "detail": detail });
    }
    if network_failure(&raw) {
        return done("offline", "GitHub could not be reached. Nothing was pushed.".into(), "retry", vec![]);
    }
    if js_regex!(r"refusing to allow (?:an? )?[^`]*to create or update workflow|without `?workflow`? scope", "i").is_match(&raw) {
        return done("workflow-scope", "Your GitHub sign-in cannot push workflow files.".into(), "add-permission", vec![]);
    }
    if js_regex!(r"GITHUB PUSH PROTECTION|push cannot contain secrets|secret scanning", "i").is_match(&raw) {
        let label = js_regex!(r"[—―]{2,}\s*([^—―\r\n]*[^\s—―])\s*[—―]{2,}", "")
            .captures(&raw)
            .and_then(|found| found.get(1))
            .map(|found| js::trim(found.as_str()).to_string())
            .unwrap_or_default();
        let file = js_regex!(r"path:\s*(\S{1,500}?)(?::\d+)?(?:\s|$)", "i").captures(&raw).and_then(|found| found.get(1)).map(|found| found.as_str().to_string()).unwrap_or_default();
        let sentence = format!("Stopped: {} in {}.", if label.is_empty() { "a secret".to_string() } else { article(&label) }, if file.is_empty() { "this push" } else { &file });
        return done("secret", sentence, "leave-out", vec![("file", json!(file)), ("label", json!(label))]);
    }
    if js_regex!(r"GH001|Large files detected|exceeds GitHub's file size limit", "i").is_match(&raw) {
        let sizes: Vec<regex::Captures> = js_regex!(r"File\s+(.{1,500}?)\s+is\s+([\d.]+)\s*Mi?B\b", "gi").captures_iter(&raw).collect();
        let size_of = |found: &regex::Captures| js::to_number(Some(&json!(found.get(2).map_or("", |m| m.as_str()))));
        let error_before = js_regex!(r"error:\s*$", "i");
        let found = sizes
            .iter()
            .find(|item| size_of(item) > 100.0)
            .or_else(|| sizes.iter().find(|item| error_before.is_match(&raw[..item.get(0).map_or(0, |m| m.start())])))
            .or(sizes.first());
        return match found {
            Some(found) => {
                let mb = js::round(size_of(found));
                let name = found.get(1).map_or("", |m| m.as_str()).to_string();
                done("too-large", format!("{name} is {} MB; GitHub refuses files over 100 MB.", js::number_string(mb)), "leave-out-ignore", vec![("file", json!(name)), ("mb", js::num(mb))])
            }
            None => done("too-large", "A file in this push is over GitHub's 100 MB limit.".into(), "leave-out-ignore", vec![]),
        };
    }
    if js_regex!(r"non-fast-forward|\(fetch first\)|Updates were rejected because|tip of your current branch is behind|Note about fast-forwards", "i").is_match(&raw) {
        return done("non-fast-forward", "GitHub has newer work. Pull first.".into(), "pull", vec![]);
    }
    if js_regex!(r"GH006|protected branch (?:hook )?declined|Protected branch update failed|GH013|Repository rule violations|Changes must be made through a pull request|required status check", "i").is_match(&raw) {
        let named = js_regex!(r#"refs\/heads\/([^\s'":]+)"#, "")
            .captures(&raw)
            .and_then(|found| found.get(1))
            .map(|found| js_regex!(r"[.,;)]+$", "").replace(found.as_str(), "").into_owned())
            .filter(|name| !name.is_empty())
            .or_else(|| js_regex!(r"\]\s+\S+\s+->\s+(\S+)", "").captures(&raw).and_then(|found| found.get(1)).map(|found| found.as_str().to_string()));
        let target = if !branch.is_empty() { branch.to_string() } else { named.unwrap_or_else(|| "this branch".into()) };
        return done("protected-branch", format!("GitHub does not allow direct pushes to {target}."), "push-branch", vec![]);
    }
    if js_regex!(r"Repository not found|repository '[^']*' not found", "i").is_match(&raw) {
        return done("not-found", "GitHub could not find this project's repository. It may have been renamed or removed.".into(), "link", vec![]);
    }
    if js_regex!(r"Authentication failed|could not read (?:Username|Password)|terminal prompts disabled|Permission to .+ denied|Invalid username or password|Bad credentials|requested URL returned error: 40[13]|Write access to repository not granted|Permission denied \(publickey\)|HTTP 401|Could not read from remote repository", "i").is_match(&raw) {
        return done("auth", "GitHub did not accept this PC's sign-in.".into(), "sign-in", vec![]);
    }
    let sentence = if detail.is_empty() { "GitHub refused the push.".to_string() } else { format!("GitHub refused the push: {detail}") };
    done("unknown", sentence, "details", vec![])
}

/// git-link `classifyGh(stderr, { repo, action, scope })`.
pub fn classify_gh(stderr: &str, repo: &str, action: &str, scope: &str) -> Value {
    let raw = tail_of(stderr);
    let detail = useful_line(&raw);
    let done = |kind: &str, sentence: String, fix: &str, extra: Vec<(&str, Value)>| {
        let mut out = Map::new();
        out.insert("kind".into(), json!(kind));
        out.insert("text".into(), json!(sentence));
        out.insert("fix".into(), json!(fix));
        out.insert("detail".into(), json!(detail));
        for (key, value) in extra {
            out.insert(key.into(), value);
        }
        Value::Object(out)
    };
    if js_regex!(r#"spawn gh(?:\.exe)? ENOENT|['"]?gh(?:\.exe)?['"]? is not recognized|gh: (?:command )?not found"#, "i").is_match(&raw) {
        return done("gh-missing", "GitHub CLI is not installed on this PC.".into(), "install-gh", vec![]);
    }
    if js_regex!(r#"spawn git(?:\.exe)? ENOENT|['"]?git(?:\.exe)?['"]? is not recognized|git: (?:command )?not found"#, "i").is_match(&raw) {
        return done("git-missing", "Git is not installed.".into(), "install-git", vec![]);
    }
    if network_failure(&raw) {
        return done("offline", if action == "create" { "You're offline. Nothing was created." } else { "GitHub could not be reached." }.into(), "retry", vec![]);
    }
    if js_regex!(r"name already exists|already exists on this account|repositor(?:y|ies)[^\n]*already exists", "i").is_match(&raw) {
        let sentence = if repo.is_empty() { "That name is already taken on GitHub. Link to it, or pick another name.".to_string() } else { format!("{repo} already exists. Link to it, or pick another name.") };
        return done("name-taken", sentence, "link", vec![]);
    }
    if let Some(missing) = js_regex!(r#"missing required scopes?[^\n]*?\[([^\]]+)\]|needs the "([^"]+)" scope|refresh[^\n]*?-s\s+(\S+)"#, "i").captures(&raw) {
        let found = [1, 2, 3].iter().filter_map(|index| missing.get(*index)).map(|m| m.as_str()).find(|value| !value.is_empty()).unwrap_or(scope);
        let need = found.replace(['"', '\''], "");
        let sentence = if need == "workflow" { "Your GitHub sign-in cannot push workflow files." } else { "Your GitHub sign-in needs one more permission." };
        return done("missing-scope", sentence.into(), "add-permission", vec![("scope", json!(need))]);
    }
    if js_regex!(r"SAML|\bSSO\b|Resource protected by organization|authorize (?:the|your|this)", "i").is_match(&raw) {
        return done("sso", "This organization asks you to authorize Studio's GitHub sign-in first.".into(), "details", vec![]);
    }
    if js_regex!(r"not logged in|not logged into any GitHub hosts|gh auth login|To get started with GitHub CLI|HTTP 401|Bad credentials|authentication (?:required|failed)|GH_TOKEN", "i").is_match(&raw) {
        return done("not-signed-in", "Sign in to GitHub first.".into(), "sign-in", vec![]);
    }
    if js_regex!(r"rate limit|abuse detection|HTTP 429|too many requests", "i").is_match(&raw) {
        return done("rate-limit", "GitHub asked Studio to slow down. Try again in a few minutes.".into(), "retry", vec![]);
    }
    if js_regex!(r"cannot create a repository for|not allowed to create|permission to create|must be a member of the organization|does not have the correct permissions to execute", "i").is_match(&raw) {
        return done("org-permission", "You can't create repositories in that organization. Pick your own account or another owner.".into(), "pick-owner", vec![]);
    }
    if js_regex!(r"HTTP 403|Resource not accessible|Forbidden", "i").is_match(&raw) {
        return done("forbidden", "GitHub did not accept this PC's sign-in.".into(), "sign-in", vec![]);
    }
    if js_regex!(r"name is invalid|invalid repository name|Repository creation failed|Unprocessable|HTTP 422", "i").is_match(&raw) {
        return done("invalid-name", "GitHub does not accept that name.".into(), "rename", vec![]);
    }
    if js_regex!(r"Could not resolve to a Repository|HTTP 404|Not Found|Repository not found", "i").is_match(&raw) {
        return done("not-found", "GitHub could not find that repository.".into(), "link", vec![]);
    }
    let sentence = if detail.is_empty() { "GitHub did not accept that.".to_string() } else { format!("GitHub said: {detail}") };
    done("unknown", sentence, "details", vec![])
}

// ---- paths that never belong in a commit ----

struct SecretName {
    rule: &'static str,
    label: &'static str,
    test: fn(&str) -> bool,
}

const SECRET_NAMES: &[SecretName] = &[
    SecretName { rule: ".env*", label: "an environment file", test: |name| js_regex!(r"^\.env", "i").is_match(name) && !js_regex!(r"^\.env\.(?:example|sample|template|dist)$", "i").is_match(name) },
    SecretName { rule: "*.pem", label: "a private key file", test: |name| js_regex!(r"\.pem$", "i").is_match(name) },
    SecretName { rule: "*.key", label: "a private key file", test: |name| js_regex!(r"\.key$", "i").is_match(name) },
    SecretName { rule: "id_rsa*", label: "a private key file", test: |name| js_regex!(r"^id_(?:rsa|dsa|ecdsa|ed25519)", "i").is_match(name) },
    SecretName { rule: "auth.json", label: "a saved sign-in file", test: |name| js_regex!(r"^auth\.json$", "i").is_match(name) },
    SecretName { rule: "credentials.json", label: "a saved sign-in file", test: |name| js_regex!(r"^credentials\.json$", "i").is_match(name) },
    SecretName { rule: ".netrc", label: "a saved sign-in file", test: |name| js_regex!(r"^[._]netrc$", "i").is_match(name) },
    SecretName { rule: ".git-credentials", label: "a saved sign-in file", test: |name| js_regex!(r"^\.git-credentials$", "i").is_match(name) },
    SecretName { rule: ".pypirc", label: "a saved sign-in file", test: |name| js_regex!(r"^\.pypirc$", "i").is_match(name) },
    SecretName { rule: ".pgpass", label: "a saved sign-in file", test: |name| js_regex!(r"^\.pgpass$", "i").is_match(name) },
    SecretName { rule: ".htpasswd", label: "a saved sign-in file", test: |name| js_regex!(r"^\.htpasswd$", "i").is_match(name) },
    SecretName { rule: "*.pfx", label: "a private key file", test: |name| js_regex!(r"\.(?:pfx|p12)$", "i").is_match(name) },
    SecretName { rule: "*.ppk", label: "a private key file", test: |name| js_regex!(r"\.ppk$", "i").is_match(name) },
    SecretName { rule: "*.keystore", label: "a private key file", test: |name| js_regex!(r"\.(?:keystore|jks)$", "i").is_match(name) },
];

/// The name Windows ends up with: "server.pem." and "server.pem::$DATA" are server.pem.
fn settled(part: &str) -> String {
    let out = js_regex!(r"::\$[A-Za-z_]+$", "").replace(part, "");
    let out = js_regex!(r"[. ]+$", "").replace(&out, "").into_owned();
    if out.is_empty() {
        part.to_string()
    } else {
        out
    }
}

/// What `pathBlocked` answers: a secret (a stop) or a generated folder.
#[derive(Clone, Debug)]
pub struct Blocked {
    pub kind: &'static str,
    pub rule: String,
    pub label: &'static str,
}

/// git-link `pathBlocked(relPath)`.
pub fn path_blocked(rel_path: &str) -> Option<Blocked> {
    let swapped = rel_path.replace('\\', "/");
    let stripped = js_regex!(r"^(?:\.\/)+", "").replace(&swapped, "");
    let parts: Vec<String> = stripped.split('/').filter(|part| !part.is_empty()).map(settled).collect();
    if parts.is_empty() {
        return None;
    }
    let is_directory = rel_path.ends_with('/') || rel_path.ends_with('\\');
    let folders = if is_directory { &parts[..] } else { &parts[..parts.len() - 1] };
    let name = if is_directory { "" } else { parts.last().map_or("", String::as_str) };
    for folder in folders {
        if js_regex!(r"^\.?secrets$", "i").is_match(folder) {
            return Some(Blocked { kind: "secret", rule: "secrets/".into(), label: "a secrets folder" });
        }
    }
    if !name.is_empty() {
        if let Some(hit) = SECRET_NAMES.iter().find(|entry| (entry.test)(name)) {
            return Some(Blocked { kind: "secret", rule: hit.rule.into(), label: hit.label });
        }
    }
    for folder in folders {
        if js_regex!(r"^\.(?:ssh|aws|gnupg)$", "i").is_match(folder) {
            return Some(Blocked { kind: "secret", rule: format!("{}/", folder.to_lowercase()), label: "a credentials folder" });
        }
    }
    for folder in folders {
        if js_regex!(r"^node_modules$", "i").is_match(folder) {
            return Some(Blocked { kind: "generated", rule: "node_modules/".into(), label: "installed packages" });
        }
        if js_regex!(r"^dist$", "i").is_match(folder) {
            return Some(Blocked { kind: "generated", rule: "dist/".into(), label: "build output" });
        }
    }
    None
}

/// git-link `oneDrive(absPath, env)`.
pub fn one_drive(abs_path: &str, env: &Value) -> bool {
    let norm = |value: &str| js_regex!(r"\/+$", "").replace(&value.replace('\\', "/"), "").to_lowercase();
    let target = norm(abs_path);
    if target.is_empty() {
        return false;
    }
    if let Value::Object(map) = env {
        for (key, value) in map {
            if !js_regex!(r"^onedrive(?:consumer|commercial)?$", "i").is_match(key) {
                continue;
            }
            let root = norm(&if value.is_null() { String::new() } else { js::string(value) });
            if !root.is_empty() && (target == root || target.starts_with(&format!("{root}/"))) {
                return true;
            }
        }
    }
    js_regex!(r"(?:^|\/)onedrive(?: - [^/]+)?(?:\/|$)", "").is_match(&target)
}

/// git-link `saveMessage(files)`.
pub fn save_message(files: f64) -> String {
    let files = count(files);
    if files > 0.0 {
        format!("Studio save: {}", plural(files, "file"))
    } else {
        "Studio save".into()
    }
}

// ---- repository names ----

/// git-link `repoIssue(owner, name)`.
pub fn repo_issue(owner: &str, name: &str) -> Option<&'static str> {
    if !js_regex!(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$", "").is_match(owner) {
        return Some("That GitHub account name is not valid.");
    }
    if name.is_empty() {
        return Some("Give the project a GitHub name.");
    }
    if js::utf16_len(name) > 100 {
        return Some("A GitHub name can be up to 100 characters.");
    }
    if name == "." || name == ".." {
        return Some("GitHub does not accept \".\" or \"..\" as a name.");
    }
    if js_regex!(r"\.git$", "i").is_match(name) {
        return Some("A GitHub name cannot end with .git.");
    }
    if !js_regex!(r"^[A-Za-z0-9._-]{1,100}$", "").is_match(name) {
        return Some("Use letters, numbers, dots, dashes and underscores.");
    }
    None
}

/// git-link `validRepo(owner, name)` (both must be strings).
pub fn valid_repo(owner: Option<&Value>, name: Option<&Value>) -> bool {
    match (owner, name) {
        (Some(Value::String(owner)), Some(Value::String(name))) => repo_issue(owner, name).is_none(),
        _ => false,
    }
}

/// git-link `repoName(folderName)`: "Mefi's Studio AI+" -> "Mefis-Studio-AI".
pub fn repo_name(folder_name: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let folded: String = folder_name.nfkd().collect();
    let name = js_regex!(r"[̀-ͯ]", "g").replace_all(&folded, "");
    let name = js_regex!(r"['‘’ʼ`]", "g").replace_all(&name, "");
    let name = js_regex!(r"[^A-Za-z0-9._-]+", "g").replace_all(&name, "-");
    let mut name = js_regex!(r"-{2,}", "g").replace_all(&name, "-").into_owned();
    let settle = |name: &mut String| loop {
        let before = name.clone();
        let next = js_regex!(r"\.git$", "i").replace(name, "").into_owned();
        let next = js_regex!(r"^[-.]+", "").replace(&next, "").into_owned();
        *name = js_regex!(r"[-.]+$", "").replace(&next, "").into_owned();
        if *name == before {
            break;
        }
    };
    settle(&mut name);
    name = js::slice(&name, 0, Some(100));
    settle(&mut name);
    name
}

/// git-link `nameSuggestions(name)`.
pub fn name_suggestions(name: &str) -> Vec<String> {
    let base = repo_name(name);
    if base.is_empty() {
        return vec![];
    }
    let mut out = Vec::new();
    for suffix in ["-2", "-3", "-app", "-4"] {
        let cut = js::slice(&base, 0, Some(100 - suffix.len() as isize));
        let candidate = format!("{}{suffix}", js_regex!(r"[-.]+$", "").replace(&cut, ""));
        if repo_issue("owner", &candidate).is_none() {
            out.push(candidate);
        }
        if out.len() == 3 {
            break;
        }
    }
    out
}

// ---- what a new project starts with ----

const IGNORE_BASE: &[&str] = &[
    "# Dependencies and build output", "node_modules/", "dist/",
    "", "# Local credentials and environment: these stay on this PC",
    ".env", ".env.*", "!.env.example", "auth.json", "credentials.json", "secrets/", "*.pem", "*.key",
    "", "# Logs, databases and editor leftovers",
    "*.log", "*.db", ".DS_Store", "Thumbs.db", "desktop.ini", ".vscode/", ".idea/", "*.swp",
];

fn ignore_stack(stack: &str) -> Option<&'static [&'static str]> {
    Some(match stack {
        "node" => &["coverage/", "npm-debug.log*", "yarn-error.log*"],
        "python" => &["__pycache__/", "*.pyc", ".venv/", "venv/", ".pytest_cache/", "*.egg-info/", "build/"],
        "love" => &["*.love", "build/"],
        _ => return None,
    })
}

/// git-link `gitignoreFor(stacks)`.
pub fn gitignore_for(stacks: &Value) -> String {
    let mut lines: Vec<String> = IGNORE_BASE.iter().map(|line| line.to_string()).collect();
    let mut seen: Vec<String> = Vec::new();
    for raw in stacks.as_array().into_iter().flatten() {
        let stack = if raw.is_null() { String::new() } else { js::string(raw) }.to_lowercase();
        let Some(block) = ignore_stack(&stack) else { continue };
        if seen.contains(&stack) {
            continue;
        }
        seen.push(stack.clone());
        lines.push(String::new());
        lines.push(format!("# {}", match stack.as_str() {
            "love" => "LOVE",
            "node" => "Node.js",
            _ => "Python",
        }));
        lines.extend(block.iter().map(|line| line.to_string()));
    }
    format!("# Written by Mefi's Studio AI+ before the first commit. Edit it freely.\n\n{}\n", lines.join("\n"))
}

fn template(id: &str) -> Option<&'static str> {
    static MIT: OnceLock<String> = OnceLock::new();
    static APACHE: OnceLock<String> = OnceLock::new();
    // A checkout that turned the files' line ends into CRLF still writes LF, as the JavaScript does.
    Some(match id {
        "none" => "",
        "mit" => MIT.get_or_init(|| include_str!("licenses/mit.txt").replace("\r\n", "\n")),
        "apache-2.0" => APACHE.get_or_init(|| include_str!("licenses/apache-2.0.txt").replace("\r\n", "\n")),
        _ => return None,
    })
}

/// git-link `licenseText(id, { holder, year })`: null for an id Studio does not know.
pub fn license_text(id: &str, holder: &str, year: Option<f64>) -> Option<String> {
    let template = template(&id.to_lowercase())?;
    let cleaned = js_regex!(r"[\u0000-\u001f\u007f]", "g").replace_all(holder, " ");
    let cleaned = js_regex!(r"\s+", "g").replace_all(&cleaned, " ");
    let year_text = year.filter(|year| year.fract() == 0.0 && *year > 0.0 && year.is_finite()).map(js::number_string).unwrap_or_default();
    let parts: Vec<String> = [year_text, js::trim(&cleaned).to_string()].into_iter().filter(|part| !part.is_empty()).collect();
    let notice = if parts.is_empty() { "the authors".to_string() } else { parts.join(" ") };
    Some(template.replacen("{notice}", &notice, 1))
}

// ---- publishing ----

pub const FIRST_MESSAGE: &str = "First commit from Studio";

/// The inputs `publishPlan` reads.
pub struct PlanInput<'a> {
    pub owner: &'a Value,
    pub name: &'a Value,
    pub visibility: &'a Value,
    pub description: &'a Value,
    pub gitignore: bool,
    pub license: &'a Value,
    pub holder: String,
    pub year: Option<f64>,
    pub stacks: Value,
    pub confirm_public: &'a Value,
    pub is_repo: bool,
    pub unborn: bool,
    pub has_commits: bool,
    pub branch: Option<String>,
    pub detached: bool,
    pub has_remote: bool,
}

fn string_or(value: &Value, fallback: &str) -> String {
    if value.is_null() { fallback.to_string() } else { js::string(value) }
}

/// git-link `publishPlan(...)`.
pub fn publish_plan(input: &PlanInput) -> Value {
    let owner = if input.owner.is_null() { "undefined".to_string() } else { js::string(input.owner) };
    let name = if input.name.is_null() { "undefined".to_string() } else { js::string(input.name) };
    let owner_text = text(Some(input.owner));
    let name_text = text(Some(input.name));
    if let Some(problem) = repo_issue(&owner_text, &name_text) {
        return json!({ "ok": false, "kind": "name", "error": problem });
    }
    let repo = format!("{owner}/{name}");
    let visibility = match input.visibility {
        Value::String(value) if value == "private" || value == "public" => value.clone(),
        _ => return json!({ "ok": false, "kind": "visibility", "error": "Choose who can see it." }),
    };
    if visibility == "public" && js::trim(&string_or(input.confirm_public, "")) != repo {
        return json!({ "ok": false, "kind": "confirm-public", "error": format!("Type {repo} to make it public.") });
    }
    let license_id = string_or(input.license, "none").to_lowercase();
    if !["none", "mit", "apache-2.0"].contains(&license_id.as_str()) {
        return json!({ "ok": false, "kind": "license", "error": "Choose None, MIT or Apache-2.0." });
    }
    if input.has_remote {
        return json!({ "ok": false, "kind": "has-remote", "error": "This project already has a GitHub address. Studio never replaces it." });
    }
    if input.is_repo && input.detached && input.has_commits {
        return json!({ "ok": false, "kind": "detached", "error": "This checkout is not on a branch. Start a branch here, then publish." });
    }
    let mut steps: Vec<Value> = Vec::new();
    let mut add = |step: Value| {
        let mut out = Map::new();
        out.insert("timeoutMs".into(), json!(30000));
        if let Value::Object(fields) = step {
            for (key, value) in fields {
                out.insert(key, value);
            }
        }
        steps.push(Value::Object(out));
    };
    let on_main = input.branch.as_deref() == Some("main");
    if !input.is_repo {
        add(json!({ "id": "init", "stage": "saving", "label": "Starting Git in the folder", "kind": "git", "argv": ["init", "-b", "main"] }));
    } else if input.unborn && !on_main {
        add(json!({ "id": "init", "stage": "saving", "label": "Naming the branch main", "kind": "git", "argv": ["symbolic-ref", "HEAD", "refs/heads/main"] }));
    } else if input.has_commits && !on_main {
        add(json!({ "id": "init", "stage": "saving", "label": "Naming the branch main", "kind": "git", "argv": ["branch", "-M", "main"] }));
    }
    let mut writes: Vec<&str> = Vec::new();
    if input.gitignore {
        add(json!({ "id": "ignore", "stage": "saving", "label": "Writing .gitignore", "kind": "write", "path": ".gitignore", "text": gitignore_for(&input.stacks), "skipIfExists": true }));
        writes.push(".gitignore");
    }
    if license_id != "none" {
        add(json!({ "id": "license", "stage": "saving", "label": "Writing LICENSE", "kind": "write", "path": "LICENSE", "text": license_text(&license_id, &input.holder, input.year), "skipIfExists": true }));
        writes.push("LICENSE");
    }
    if !input.has_commits {
        add(json!({ "id": "save", "stage": "saving", "label": "Saving a first commit", "kind": "save", "paths": "previewed", "message": FIRST_MESSAGE }));
    } else if !writes.is_empty() {
        add(json!({ "id": "save", "stage": "saving", "label": format!("Saving {}", writes.join(" and ")), "kind": "save", "paths": "written", "message": format!("Add {}", writes.join(" and ")) }));
    }
    let about = js_regex!(r"[\u0000-\u001f\u007f]", "g").replace_all(&string_or(input.description, ""), " ").into_owned();
    let about = js_regex!(r"\s+", "g").replace_all(&about, " ").into_owned();
    let about = js::slice(js::trim(&about), 0, Some(350));
    let mut argv = vec![json!("repo"), json!("create"), json!(repo), json!(if visibility == "public" { "--public" } else { "--private" }), json!("--source"), json!("."), json!("--remote"), json!("origin")];
    if !about.is_empty() {
        argv.push(json!("--description"));
        argv.push(json!(about));
    }
    add(json!({ "id": "create", "stage": "creating", "label": format!("Creating {repo}"), "kind": "gh", "timeoutMs": 120000, "argv": argv }));
    add(json!({ "id": "push", "stage": "uploading", "label": "Uploading", "kind": "git", "timeoutMs": 600000, "argv": ["push", "-u", "origin", "main"] }));
    add(json!({ "id": "fetch", "stage": "uploading", "label": "Checking GitHub has it", "kind": "git", "argv": ["fetch", "origin", "--prune"] }));
    add(json!({ "id": "upstream", "stage": "uploading", "label": "Linking main to GitHub", "kind": "git", "argv": ["branch", "--set-upstream-to=origin/main", "main"] }));
    let stage_label = |id: &str| match id {
        "saving" => "Saving a first commit".to_string(),
        "creating" => format!("Creating {repo}"),
        _ => "Uploading".to_string(),
    };
    let stages: Vec<Value> = ["saving", "creating", "uploading"]
        .iter()
        .filter(|id| steps.iter().any(|step| step["stage"] == json!(id)))
        .map(|id| json!({ "id": id, "label": stage_label(id) }))
        .collect();
    json!({ "ok": true, "repo": repo, "visibility": visibility, "stages": stages, "steps": steps })
}

// ---- pc-setup.cjs ----

/// `signedInAccount(output)`: the login `gh auth status` names.
pub fn signed_in_account(output: &str) -> Option<String> {
    js_regex!(r"Logged in to github\.com (?:account|as) ([A-Za-z0-9-]{1,39})", "i").captures(output).and_then(|found| found.get(1)).map(|found| found.as_str().to_string())
}

/// `filesystemOf(output)`: fsutil's "File System Name : NTFS".
pub fn filesystem_of(output: &str) -> Option<String> {
    js_regex!(r"File System Name\s*:\s*([A-Za-z0-9]+)", "i").captures(output).and_then(|found| found.get(1)).map(|found| found.as_str().to_string())
}

/// `githubRemote(url)`: owner/name for a github.com remote, else null.
pub fn github_remote(url: &str) -> Option<String> {
    js_regex!(r"^(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$", "")
        .captures(js::trim(url))
        .and_then(|found| found.get(1))
        .map(|found| found.as_str().to_string())
}

// ---- redaction.cjs ----

/// `maskCredentials(text)`.
pub fn mask_credentials(text: &str) -> String {
    let out = js_regex!(r"-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?(?:-----END [\s\S]*?PRIVATE KEY-----|$)", "g").replace_all(text, "[redacted private key]");
    let out = js_regex!(r"\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9_]{16,}|AKIA[A-Z0-9]{16})\b", "g").replace_all(&out, "[redacted credential]");
    let out = js_regex!(r#"((?:password|secret|token|api[_-]?key|authorization)["']?\s*[=:]\s*(?:(?:bearer|basic|token)\s+)?)(?:["'][^"'\r\n]*["']|[^\s,;}]+)"#, "gi").replace_all(&out, "${1}[redacted]");
    js_regex!(r"(https?:\/\/)[^\s/@]+:[^\s/@]+@", "gi").replace_all(&out, "${1}[redacted]@").into_owned()
}

// ---- what a save scans files for (share-review.cjs RULES, and git-actions' own) ----

pub struct ScanRule {
    pub id: &'static str,
    pub label: &'static str,
    re: fn() -> &'static regex::Regex,
}

/// share-review's private-key, api-key, jwt, assigned-secret and url-credential, then git-actions' three.
pub const SCAN_RULES: &[ScanRule] = &[
    ScanRule { id: "private-key", label: "a private key", re: || js_regex!(r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "") },
    ScanRule { id: "api-key", label: "an API key or token", re: || js_regex!(r"\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{16,})\b", "") },
    ScanRule { id: "jwt", label: "a sign-in token", re: || js_regex!(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b", "") },
    ScanRule { id: "assigned-secret", label: "a password or secret value", re: || js_regex!(r#"(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']?[^\s"',;}{]{6,}"#, "i") },
    ScanRule { id: "url-credential", label: "a link with a login in it", re: || js_regex!(r"\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@", "i") },
    ScanRule { id: "api-key", label: "an API key or token", re: || js_regex!(r"\b(?:[sr]k_live_[0-9A-Za-z]{16,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|pypi-[A-Za-z0-9_-]{50,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b", "") },
    ScanRule { id: "bot-token", label: "a chat bot token or webhook", re: || js_regex!(r"\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b|\b(?:hooks\.slack\.com\/services|discord(?:app)?\.com\/api\/webhooks)\/[A-Za-z0-9\/_-]{20,}", "") },
    ScanRule { id: "cloud-secret", label: "a cloud secret key", re: || js_regex!(r#"\baws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9\/+=]{30,}"#, "i") },
];

/// The link rule tries every word start in a long run of scheme characters: keep the last 40 of any run of 80 or more.
fn cap_runs(text: &str) -> String {
    js_regex!(r"[a-z0-9+.-]{80,}", "gi").replace_all(text, |found: &regex::Captures| js::slice(&found[0], -40, None)).into_owned()
}

/// git-actions `scanText(text)`: the first stop, else the first warning.
pub fn scan_text(text: &str) -> (Option<&'static ScanRule>, Option<&'static ScanRule>) {
    let mut maybe: Option<&'static ScanRule> = None;
    let mut capped: Option<String> = None;
    for rule in SCAN_RULES {
        let hit = if rule.id == "url-credential" {
            (rule.re)().is_match(capped.get_or_insert_with(|| cap_runs(text)))
        } else {
            (rule.re)().is_match(text)
        };
        if !hit {
            continue;
        }
        if rule.id == "assigned-secret" {
            maybe = maybe.or(Some(rule));
        } else {
            return (Some(rule), None);
        }
    }
    (None, maybe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_and_mask() {
        assert_eq!(scrub("https://me:pw@github.com/x and ghp_abcdefghijklmnopqrstuvwxyz"), "https://github.com/x and [token]");
        assert_eq!(scrub("Authorization: Bearer abc.def"), "Authorization: Bearer [token]");
        assert_eq!(mask_credentials("password = hunter22"), "password = [redacted]");
    }

    #[test]
    fn names_and_paths() {
        assert_eq!(repo_name("Mefi's Studio AI+"), "Mefis-Studio-AI");
        assert_eq!(repo_name("Café Été.git"), "Cafe-Ete");
        assert_eq!(name_suggestions("app"), vec!["app-2", "app-3", "app-app"]);
        assert_eq!(path_blocked("config/.env").map(|hit| hit.rule), Some(".env*".to_string()));
        assert!(path_blocked(".env.example").is_none());
        assert_eq!(path_blocked("a/node_modules/x.js").map(|hit| hit.kind), Some("generated"));
        assert_eq!(path_blocked(".SSH/config").map(|hit| hit.rule), Some(".ssh/".to_string()));
        assert_eq!(github_remote("https://github.com/owner/repo.git").as_deref(), Some("owner/repo"));
        assert_eq!(github_remote("https://gitlab.com/owner/repo.git"), None);
    }

    #[test]
    fn license_text_fills_the_notice() {
        let text = license_text("MIT", "Nate", Some(2026.0)).expect("known");
        assert!(text.contains("Copyright (c) 2026 Nate\n"));
        assert_eq!(license_text("gpl", "", None), None);
        assert_eq!(license_text("none", "", None).as_deref(), Some(""));
    }

    #[test]
    fn classifies_failures() {
        assert_eq!(classify_push("! [rejected] main -> main (non-fast-forward)", false, "main")["kind"], "non-fast-forward");
        assert_eq!(classify_push("remote: error: File big.bin is 120.50 MB; this exceeds GitHub's file size limit", false, "")["mb"], 121);
        assert_eq!(classify_gh("spawn gh ENOENT", "", "", "")["kind"], "gh-missing");
        assert_eq!(classify_gh("GraphQL: Name already exists on this account (createRepository)", "o/n", "create", "")["kind"], "name-taken");
    }
}
