//! scripts/worktree-actions.mjs: what Studio may do to a worktree. Merge its
//! branch into the default branch, remove it (keeping a rescue ref first when
//! anything would be lost), forget folders that are gone. Never pushes,
//! fetches or forces a shared branch; a path is only used when git lists it.

use serde_json::{json, Map, Value};

use super::worktrees::inspect_worktree;
use super::{git_in, plural, run_git, scrub, Git, Result};
use crate::callbacks::{invoke, Callbacks};
use crate::js;

const RESCUE_MAX_FILES: f64 = 3000.0;

fn refuse(error: &str, extra: Value) -> Value {
    let mut out = Map::new();
    out.insert("ok".into(), json!(false));
    out.insert("error".into(), json!(scrub(error)));
    if let Value::Object(extra) = extra {
        out.extend(extra);
    }
    Value::Object(out)
}

/// worktree-actions.mjs firstLine (not scrubbed; refuse scrubs).
fn first_line(text: &str) -> String {
    text.split('\n').map(str::trim).find(|line| !line.is_empty()).unwrap_or("").to_string()
}

fn git(folder: &str, args: &[&str]) -> Git {
    run_git(folder, &args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>(), 30_000)
}

/// The link a task run gets to the shared node_modules goes as a link.
fn drop_node_modules_link(folder: &str) {
    let link = std::path::Path::new(folder).join("node_modules");
    if std::fs::symlink_metadata(&link).is_ok_and(|meta| meta.file_type().is_symlink()) {
        if std::fs::remove_file(&link).is_err() {
            let _ = std::fs::remove_dir(&link);
        }
    }
}

fn midway(folder: &str) -> Option<&'static str> {
    for marker in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"] {
        if git(folder, &["rev-parse", "-q", "--verify", marker]).ok {
            return Some(match marker {
                "MERGE_HEAD" => "a merge",
                "REVERT_HEAD" => "a revert",
                _ => "a cherry-pick",
            });
        }
    }
    for dir in ["rebase-merge", "rebase-apply"] {
        let found = git(folder, &["rev-parse", "--git-path", dir]);
        if found.ok && std::fs::symlink_metadata(std::path::Path::new(folder).join(&found.stdout)).is_ok() {
            return Some("a rebase");
        }
    }
    None
}

/// One worktree found, or the refusal.
fn find(root: &str, target: &str) -> std::result::Result<Value, Value> {
    let found = inspect_worktree(root, target);
    if found["repo"] != json!(true) {
        return Err(refuse("This folder is not a Git repository.", Value::Null));
    }
    if found["row"].is_null() {
        return Err(refuse("That folder is not one of this project's worktrees.", Value::Null));
    }
    Ok(found)
}

fn in_use(options: &Value, folder: &str, callbacks: &dyn Callbacks) -> bool {
    match js::get(options, "inUse") {
        Some(handle) if crate::callbacks::is_function(handle) => invoke(callbacks, handle, vec![json!(folder)]).is_ok_and(|answer| js::truthy(&answer)),
        _ => false,
    }
}

fn flag(options: &Value, key: &str) -> bool {
    js::get(options, key).is_some_and(js::truthy)
}

fn number(value: &Value) -> f64 {
    value.as_f64().unwrap_or(0.0)
}

pub fn merge_worktree(root: &str, target: &str, options: &Value, callbacks: &dyn Callbacks) -> Result<Value> {
    let found = match find(root, target) {
        Ok(found) => found,
        Err(refusal) => return Ok(refusal),
    };
    let (row, primary, main) = (&found["row"], &found["primary"], js::string(&found["main"]));
    let mode_merge = js::get(options, "mode") == Some(&json!("merge"));
    if primary.is_null() {
        return Ok(refuse(&format!("That is the main checkout, so there is nothing to merge into {main}."), Value::Null));
    }
    if row["missing"] == json!(true) {
        return Ok(refuse("That worktree's folder is gone. Forget it first.", Value::Null));
    }
    let branch = row["branch"].as_str().map(String::from);
    if row["detached"] == json!(true) || branch.is_none() {
        return Ok(refuse("It is on no branch. Put its commits on a branch first, then merge.", Value::Null));
    }
    let branch = branch.unwrap_or_default();
    let row_path = js::string(&row["path"]);
    if in_use(options, &row_path, callbacks) {
        return Ok(refuse("A run is still working in this worktree. Wait for it to finish.", json!({ "busy": true })));
    }
    let dirty = number(&row["dirty"]);
    if dirty != 0.0 {
        return Ok(refuse(&format!("It has {}. Commit them in the worktree first: a merge only takes what is committed.", plural(dirty, "uncommitted file")), json!({ "dirty": row["dirty"] })));
    }
    let primary_path = js::string(&primary["path"]);
    let to_merge = js::to_number(Some(&json!(git(&primary_path, &["rev-list", "--count", &format!("{main}..{branch}")]).stdout)));
    if to_merge.is_nan() || to_merge == 0.0 {
        return Ok(refuse(&format!("Nothing to merge: {branch} has no commits that {main} lacks."), json!({ "alreadyMerged": true })));
    }
    if primary["branch"].as_str() != Some(main.as_str()) {
        let on = primary["branch"].as_str().map_or_else(|| "no branch".to_string(), String::from);
        return Ok(refuse(&format!("The main checkout is on {on}, not {main}. Switch it to {main} first."), json!({ "primaryBranch": primary["branch"] })));
    }
    let primary_dirty = number(&primary["dirty"]);
    if primary_dirty != 0.0 {
        return Ok(refuse(&format!("The main checkout has {}. Commit or stash them first, so the merge does not mix with them.", plural(primary_dirty, "uncommitted file")), json!({ "primaryDirty": primary["dirty"] })));
    }
    if let Some(busy) = midway(&primary_path) {
        return Ok(refuse(&format!("The main checkout is in the middle of {busy}. Finish or abort it first."), Value::Null));
    }
    if flag(options, "builders") && !flag(options, "anyway") {
        return Ok(refuse("Agents are still changing files in this project. Merge anyway?", json!({ "needsAnyway": true })));
    }
    let mut how = "fast-forward";
    let mut merged = git(&primary_path, &["merge", "--ff-only", &branch]);
    if !merged.ok {
        if !mode_merge {
            return Ok(refuse(&format!("{main} has moved on since {branch} started, so it cannot be fast-forwarded. Bring {main} into the worktree first, or merge with a merge commit."), json!({ "needsMergeCommit": true })));
        }
        how = "merge commit";
        merged = git(&primary_path, &["merge", "--no-edit", &branch]);
        if !merged.ok {
            if midway(&primary_path).is_some() {
                git(&primary_path, &["merge", "--abort"]);
            }
            let both = format!("{}\n{}", merged.stdout, merged.stderr);
            let conflict = both.to_lowercase().contains("conflict");
            let why = if conflict { "it conflicts with" } else { "it could not be merged into" };
            let first = first_line(&merged.stderr);
            let extra = if !first.is_empty() && !merged.stderr.to_lowercase().contains("conflict") { format!(" ({})", js::slice(&first, 0, Some(160))) } else { String::new() };
            return Ok(refuse(&format!("{branch}: {why} {main}. Nothing was changed.{extra}"), json!({ "conflict": conflict })));
        }
    }
    let head = git(&primary_path, &["rev-parse", "--short", "HEAD"]).stdout;
    let mut result = json!({ "ok": true, "merged": true, "branch": branch, "into": main, "head": head, "how": how, "note": format!("Merged on this PC only. Save and push, or run npm run sync, to put {main} on GitHub.") });
    if flag(options, "remove") {
        let mut remove_options = json!({ "deleteBranch": true });
        if let Some(handle) = js::get(options, "inUse") {
            remove_options["inUse"] = handle.clone();
        }
        result["removed"] = remove_worktree(root, &row_path, &remove_options, callbacks)?;
    }
    Ok(result)
}

/// A copy of everything a folder holds that no commit does, kept as a ref.
fn rescue(row: &Value) -> std::result::Result<String, String> {
    let folder = js::string(&row["path"]);
    let run = git_in(&folder);
    let stamp: String = js::iso_string(js::now_ms()).unwrap_or_default().chars().filter(|c| *c != '-' && *c != ':').take(15).collect();
    let name: String = js::string(&row["name"]).chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '-' }).collect();
    let name = js::slice(&name, 0, Some(60));
    let name = if name.is_empty() { "worktree".to_string() } else { name };
    let reference = format!("refs/mefi/rescue/{name}-{stamp}");
    let dirty = number(&row["dirty"]);
    if dirty > RESCUE_MAX_FILES {
        return Err(format!("{} changed files is too many to keep a copy of.", js::number_string(dirty)));
    }
    let head = run(&["rev-parse", "HEAD"]);
    if !head.ok {
        let line = first_line(&head.stderr);
        return Err(if line.is_empty() { "It has no commit to keep a copy on.".into() } else { line });
    }
    let staged = run(&["add", "-A"]);
    if !staged.ok {
        return Err(first_line(&staged.stderr));
    }
    let tree = run(&["write-tree"]);
    if !tree.ok {
        return Err(first_line(&tree.stderr));
    }
    let known = run(&["config", "user.email"]).stdout;
    let message = format!("Kept before Studio removed the worktree {} ({})", js::string(&row["name"]), row["branch"].as_str().unwrap_or("no branch"));
    let mut args: Vec<&str> = Vec::new();
    if known.is_empty() {
        args.extend(["-c", "user.name=Mefi's Studio", "-c", "user.email=studio@invalid.local"]);
    }
    args.extend(["commit-tree", &tree.stdout, "-p", &head.stdout, "-m", &message]);
    let made = run(&args);
    if !made.ok {
        return Err(first_line(&made.stderr));
    }
    let saved = run(&["update-ref", &reference, &made.stdout]);
    if !saved.ok {
        return Err(first_line(&saved.stderr));
    }
    Ok(reference)
}

pub fn remove_worktree(root: &str, target: &str, options: &Value, callbacks: &dyn Callbacks) -> Result<Value> {
    let found = match find(root, target) {
        Ok(found) => found,
        Err(refusal) => return Ok(refusal),
    };
    let (row, primary, main) = (&found["row"], &found["primary"], js::string(&found["main"]));
    let force = flag(options, "force");
    if primary.is_null() {
        return Ok(refuse("That is the main checkout. Studio never removes it.", Value::Null));
    }
    if row["locked"] == json!(true) {
        let reason = row["lockedReason"].as_str().filter(|reason| !reason.is_empty()).map_or(String::new(), |reason| format!(" ({reason})"));
        return Ok(refuse(&format!("It is locked{reason}: another session may be using it. Unlock it with git worktree unlock first."), json!({ "locked": true })));
    }
    let row_path = js::string(&row["path"]);
    if in_use(options, &row_path, callbacks) {
        return Ok(refuse("A run is still working in this worktree. Wait for it to finish.", json!({ "busy": true })));
    }
    if row["missing"] == json!(true) {
        return Ok(prune_worktrees(root));
    }
    let sha = js::string(&row["sha"]);
    let orphaned = row["detached"] == json!(true) && !sha.is_empty() && git(root, &["for-each-ref", "--contains", &sha, "--count=1", "--format=%(refname)"]).stdout.is_empty();
    let dirty = number(&row["dirty"]);
    let risky = dirty > 0.0 || orphaned;
    if risky && !force {
        let lose: Vec<String> = [if dirty != 0.0 { plural(dirty, "uncommitted file") } else { String::new() }, if orphaned { "commits that are on no branch".into() } else { String::new() }]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect();
        return Ok(refuse(&format!("Removing it would lose {}. A copy is kept as a ref if you remove it anyway.", lose.join(" and ")), json!({ "needsForce": true, "dirty": row["dirty"], "orphaned": orphaned })));
    }
    let mut kept = Value::Null;
    if force && risky {
        match rescue(row) {
            Ok(reference) => kept = json!(reference),
            Err(error) => return Ok(refuse(&format!("A copy could not be kept, so nothing was removed: {error}"), Value::Null)),
        }
    }
    drop_node_modules_link(&row_path);
    let primary_path = js::string(&primary["path"]);
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&row_path);
    let gone = git(&primary_path, &args);
    if !gone.ok {
        if !kept.is_null() {
            git(&row_path, &["reset", "-q"]);
        }
        let lower = gone.stderr.to_lowercase();
        let untracked = lower.contains("modified or untracked") || lower.contains("use --force");
        let message = if untracked { "It holds files git does not track. Remove it anyway to keep a copy first.".to_string() } else { format!("Git could not remove it: {}", js::slice(&first_line(&gone.stderr), 0, Some(200))) };
        return Ok(refuse(&message, json!({ "needsForce": untracked })));
    }
    let mut result = json!({ "ok": true, "removed": true, "name": row["name"], "path": row["path"], "branch": row["branch"], "rescued": kept });
    if flag(options, "deleteBranch") {
        if let Some(branch) = row["branch"].as_str().filter(|branch| !branch.is_empty() && *branch != main) {
            let deleted = git(root, &["branch", "-d", branch]);
            result["branchDeleted"] = json!(deleted.ok);
            if !deleted.ok {
                let why = js::slice(&first_line(&deleted.stderr), 0, Some(160));
                result["branchKept"] = json!(format!("{branch} stays: {}", if why.is_empty() { "it is not fully merged".to_string() } else { why }));
            }
        }
    }
    Ok(result)
}

pub fn prune_worktrees(root: &str) -> Value {
    if !git(root, &["rev-parse", "--show-toplevel"]).ok {
        return refuse("This folder is not a Git repository.", Value::Null);
    }
    let pruned = git(root, &["worktree", "prune", "--verbose"]);
    if !pruned.ok {
        return refuse(&format!("Git could not forget them: {}", js::slice(&first_line(&pruned.stderr), 0, Some(200))), Value::Null);
    }
    let names: Vec<String> = format!("{}\n{}", pruned.stdout, pruned.stderr)
        .split('\n')
        .filter_map(|line| {
            let line = line.trim().strip_prefix("Removing ")?;
            let line = line.strip_prefix("worktrees/").unwrap_or(line);
            let name = &line[..line.find(':')?];
            (!name.is_empty()).then(|| name.to_string())
        })
        .collect();
    json!({ "ok": true, "pruned": names.len(), "names": names })
}

pub fn worktree_folder(root: &str, target: &str) -> Value {
    match find(root, target) {
        Err(refusal) => refusal,
        Ok(found) if found["row"]["missing"] == json!(true) => refuse("That worktree's folder is gone.", Value::Null),
        Ok(found) => json!({ "ok": true, "path": found["row"]["path"] }),
    }
}
