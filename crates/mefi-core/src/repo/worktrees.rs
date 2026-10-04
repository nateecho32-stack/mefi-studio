//! scripts/worktrees.mjs: one row per git worktree of a project, worst first,
//! with what to do about each. Read-only.

use serde_json::{json, Map, Value};

use super::sync::{changed_files, default_branch};
use super::{git_in, plural, scrub, Git, REMOTE};
use crate::{js, paths};

#[derive(Clone)]
pub(crate) struct Entry {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub detached: bool,
    pub bare: bool,
    pub locked: Value,
    pub prunable: Value,
}

/// `git worktree list --porcelain`.
pub(crate) fn parse_worktrees(text: &str) -> Vec<Entry> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut open = false;
    for raw in text.split('\n').map(|line| line.strip_suffix('\r').unwrap_or(line)) {
        if raw.is_empty() {
            open = false;
            continue;
        }
        let (key, value) = match raw.find(' ') {
            Some(at) => (&raw[..at], &raw[at + 1..]),
            None => (raw, ""),
        };
        if key == "worktree" {
            entries.push(Entry { path: paths::resolve(value), head: String::new(), branch: None, detached: false, bare: false, locked: json!(false), prunable: json!(false) });
            open = true;
            continue;
        }
        let Some(entry) = entries.last_mut().filter(|_| open) else { continue };
        let flag = |value: &str| if value.is_empty() { json!(true) } else { json!(value) };
        match key {
            "HEAD" => entry.head = value.to_string(),
            "branch" => entry.branch = Some(value.strip_prefix("refs/heads/").unwrap_or(value).to_string()),
            "detached" => entry.detached = true,
            "bare" => entry.bare = true,
            "locked" => entry.locked = flag(value),
            "prunable" => entry.prunable = flag(value),
            _ => {}
        }
    }
    entries
}

fn kind_of(entry: &Entry, index: usize) -> &'static str {
    if index == 0 {
        return "primary";
    }
    let branch = entry.branch.clone().unwrap_or_default();
    if branch.starts_with("mefi/") || entry.path.replace('\\', "/").contains("/.mefi/worktrees/") {
        return "run";
    }
    if entry.detached || entry.branch.is_none() {
        "detached"
    } else {
        "dev"
    }
}

/// classify: one verdict per worktree and what to do.
fn classify(row: &Map<String, Value>, kind: &str) -> (String, String) {
    let number = |key: &str| row.get(key).and_then(Value::as_f64).unwrap_or(0.0);
    let dirty = number("dirty");
    if kind == "primary" {
        return ("primary".into(), if dirty != 0.0 { format!("{} in the main checkout.", plural(dirty, "uncommitted file")) } else { String::new() });
    }
    if row.get("missing") == Some(&json!(true)) {
        return ("missing".into(), "The folder is gone. Run `git worktree prune` to forget it.".into());
    }
    if dirty != 0.0 {
        return ("dirty".into(), format!("{}: commit, stash or discard them before anything else.", plural(dirty, "uncommitted file")));
    }
    let ahead = number("ahead");
    if ahead != 0.0 && row.get("pushed") == Some(&json!(false)) {
        if kind == "detached" {
            return ("unpushed".into(), format!("Detached HEAD with {} on no branch: put them on a branch and push it.", plural(ahead, "commit")));
        }
        let target = match row.get("branch").and_then(Value::as_str) {
            Some(branch) if !branch.is_empty() => branch.strip_prefix("wip/").unwrap_or(branch).to_string(),
            _ => js::string(row.get("name").unwrap_or(&Value::Null)),
        };
        return ("unpushed".into(), format!("{} only on this PC: push them (git push {REMOTE} HEAD:refs/heads/wip/{target}) or land them.", plural(ahead, "commit")));
    }
    let upstream = js::string(row.get("upstreamName").unwrap_or(&Value::Null));
    if ahead != 0.0 {
        return ("on-github".into(), format!("{} on GitHub, not merged into {upstream}: land it or leave it parked.", plural(ahead, "commit")));
    }
    ("merged".into(), format!("Merged into {upstream} and clean: safe to remove (git worktree remove {}).", js::string(row.get("path").unwrap_or(&Value::Null))))
}

pub(crate) struct Look {
    pub top: String,
    pub entries: Vec<Entry>,
    pub main: String,
    pub upstream: String,
    pub has_upstream: bool,
    cwd: String,
}

pub(crate) fn look_at(cwd: &str) -> Option<Look> {
    let git = git_in(cwd);
    let top = git(&["rev-parse", "--show-toplevel"]);
    if !top.ok {
        return None;
    }
    let entries = parse_worktrees(&git(&["worktree", "list", "--porcelain"]).stdout);
    let main = default_branch(&git);
    let upstream = format!("{REMOTE}/{main}");
    let has_upstream = git(&["rev-parse", "--verify", "--quiet", &format!("refs/remotes/{upstream}")]).ok;
    Some(Look { top: paths::resolve(&top.stdout.replace('\\', "/")), entries, main, upstream, has_upstream, cwd: cwd.to_string() })
}

fn count(git: &dyn Fn(&[&str]) -> Git, range: &str) -> f64 {
    let n = js::to_number(Some(&json!(git(&["rev-list", "--count", range]).stdout)));
    if n.is_nan() {
        0.0
    } else {
        n
    }
}

/// inspectOne: a worktree's row.
pub(crate) fn inspect_one(entry: &Entry, index: usize, look: &Look) -> Value {
    let git = git_in(&look.cwd);
    let kind = kind_of(entry, index);
    let name = entry.path.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or_default().to_string();
    let missing = js::truthy(&entry.prunable) || !std::path::Path::new(&entry.path).exists();
    let mut row = Map::new();
    row.insert("path".into(), json!(entry.path));
    row.insert("name".into(), json!(name));
    row.insert("kind".into(), json!(kind));
    row.insert("branch".into(), entry.branch.as_ref().map_or(Value::Null, |branch| json!(branch)));
    row.insert("detached".into(), json!(entry.detached || entry.branch.is_none()));
    row.insert("head".into(), json!(js::slice(&entry.head, 0, Some(7))));
    row.insert("sha".into(), json!(entry.head));
    row.insert("locked".into(), json!(js::truthy(&entry.locked)));
    row.insert("lockedReason".into(), json!(entry.locked.as_str().unwrap_or("")));
    row.insert("missing".into(), json!(missing));
    row.insert("dirty".into(), json!(0));
    row.insert("ahead".into(), json!(0));
    row.insert("behind".into(), json!(0));
    row.insert("pushed".into(), Value::Null);
    row.insert("upstreamName".into(), json!(if look.has_upstream { &look.upstream } else { &look.main }));
    row.insert("last".into(), Value::Null);
    if entry.bare {
        let (state, action) = classify(&row, "primary");
        row.insert("state".into(), json!(state));
        row.insert("action".into(), json!(action));
        return Value::Object(row);
    }
    if !missing {
        row.insert("dirty".into(), js::num(changed_files(&entry.path)));
    }
    let reference = entry.branch.clone().unwrap_or_else(|| entry.head.clone());
    if !missing && !reference.is_empty() {
        let against = if look.has_upstream { &look.upstream } else { &look.main };
        row.insert("ahead".into(), js::num(count(&git, &format!("{against}..{reference}"))));
        row.insert("behind".into(), js::num(count(&git, &format!("{reference}..{against}"))));
        let pushed = match &entry.branch {
            Some(branch) => {
                let on_github = git(&["rev-parse", "--verify", "--quiet", &format!("refs/remotes/{REMOTE}/{branch}")]).ok;
                on_github && count(&git, &format!("{REMOTE}/{branch}..{branch}")) == 0.0
            }
            None => !git(&["branch", "-r", "--contains", &reference]).stdout.trim().is_empty(),
        };
        row.insert("pushed".into(), json!(pushed));
        let last = git(&["log", "-1", "--format=%h%x09%cs%x09%s", &reference]).stdout;
        let parts: Vec<&str> = last.split('\t').collect();
        if parts.len() >= 3 {
            row.insert("last".into(), json!({ "sha": parts[0], "date": parts[1], "subject": js::slice(&scrub(&parts[2..].join("\t")), 0, Some(100)) }));
        }
    }
    let (state, action) = classify(&row, kind);
    row.insert("state".into(), json!(state));
    row.insert("action".into(), json!(action));
    Value::Object(row)
}

/// canonical: what is on disk, lowercased on Windows; a missing folder keeps
/// its name on its deepest existing ancestor.
pub(crate) fn canonical(value: &str) -> String {
    let resolved = paths::resolve(value);
    let mut ancestor = std::path::PathBuf::from(&resolved);
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    let real = loop {
        if let Ok(real) = std::fs::canonicalize(&ancestor) {
            break Some(real);
        }
        match (ancestor.parent().map(std::path::Path::to_path_buf), ancestor.file_name().map(std::ffi::OsStr::to_os_string)) {
            (Some(parent), Some(name)) if parent != ancestor => {
                rest.insert(0, name);
                ancestor = parent;
            }
            _ => break None,
        }
    };
    let whole = match real {
        None => resolved,
        Some(real) => {
            let mut path = real;
            for name in rest {
                path.push(name);
            }
            let text = path.to_string_lossy().into_owned();
            text.strip_prefix(r"\\?\").map(String::from).unwrap_or(text)
        }
    };
    if cfg!(windows) {
        whole.to_lowercase()
    } else {
        whole
    }
}

pub fn inspect_worktree(cwd: &str, target: &str) -> Value {
    let Some(look) = look_at(cwd) else {
        return json!({ "repo": false, "root": paths::resolve(cwd) });
    };
    let wanted = canonical(target);
    let at = look.entries.iter().position(|entry| canonical(&entry.path) == wanted);
    let mut out = json!({ "repo": true, "root": look.top, "main": look.main, "upstream": look.upstream, "hasUpstream": look.has_upstream, "count": look.entries.len() });
    match at {
        None => {
            out["row"] = Value::Null;
            out["primary"] = look.entries.first().map_or(Value::Null, |entry| inspect_one(entry, 0, &look));
        }
        Some(at) => {
            out["row"] = inspect_one(&look.entries[at], at, &look);
            out["primary"] = if at == 0 { Value::Null } else { inspect_one(&look.entries[0], 0, &look) };
        }
    }
    out
}

fn order(state: &str) -> u8 {
    match state {
        "primary" => 0,
        "dirty" => 1,
        "unpushed" => 2,
        "on-github" => 3,
        "missing" => 4,
        _ => 5,
    }
}

pub fn list_worktrees(cwd: &str) -> Value {
    let Some(look) = look_at(cwd) else {
        return json!({ "repo": false, "root": paths::resolve(cwd) });
    };
    let mut rows: Vec<Value> = look.entries.iter().enumerate().map(|(index, entry)| inspect_one(entry, index, &look)).collect();
    rows.sort_by(|a, b| {
        order(a["state"].as_str().unwrap_or("")).cmp(&order(b["state"].as_str().unwrap_or(""))).then_with(|| js::locale_compare(a["name"].as_str().unwrap_or(""), b["name"].as_str().unwrap_or("")))
    });
    let count = |state: &str| rows.iter().filter(|row| row["state"] == json!(state)).count() as f64;
    let (total, at_risk, to_land, safe, missing) = (rows.len() as f64, count("dirty") + count("unpushed"), count("on-github"), count("merged"), count("missing"));
    let summary = json!({ "total": js::num(total), "atRisk": js::num(at_risk), "toLand": js::num(to_land), "safeToRemove": js::num(safe), "missing": js::num(missing) });
    let headline = {
        if total == 1.0 && at_risk == 0.0 {
            "One checkout, no other worktrees.".to_string()
        } else {
            let mut parts = Vec::new();
            if at_risk != 0.0 {
                parts.push(format!("{} {} work that exists only on this PC", js::number_string(at_risk), if at_risk == 1.0 { "holds" } else { "hold" }));
            }
            if to_land != 0.0 {
                parts.push(format!("{} {} on GitHub but not merged", js::number_string(to_land), if to_land == 1.0 { "is" } else { "are" }));
            }
            if safe != 0.0 {
                parts.push(format!("{} {} merged and safe to remove", js::number_string(safe), if safe == 1.0 { "is" } else { "are" }));
            }
            if missing != 0.0 {
                parts.push(format!("{} {} gone", js::number_string(missing), if missing == 1.0 { "folder is" } else { "folders are" }));
            }
            let base = format!("{}{}.", plural(total, "worktree"), if parts.is_empty() { String::new() } else { format!(": {}", parts.join(", ")) });
            if look.has_upstream {
                base
            } else {
                format!("{base} (There is no {} to compare with, so the local default branch was used.)", look.upstream)
            }
        }
    };
    json!({ "repo": true, "root": look.top, "main": look.main, "upstream": look.upstream, "hasUpstream": look.has_upstream, "rows": rows, "summary": summary, "headline": headline })
}
