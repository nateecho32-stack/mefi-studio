//! scripts/sync.mjs: keeps a checkout's default branch in step with GitHub and
//! lists what has not reached it yet, including merges that left another
//! branch's work out (lost work).

use std::collections::BTreeSet;
use std::sync::{Mutex, OnceLock};

use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde_json::{json, Value};

use super::{first_line, git_in, last_line, lines, plural, plural_as, run_git, scrub, Git, Result, REMOTE};
use crate::callbacks::{invoke, Callbacks};
use crate::{js, paths};

/// Work that exists only on this PC.
const LOCAL_ONLY: &[&str] = &["uncommitted", "unpushed", "stash", "worktree", "local-branch"];
/// Notes, not work waiting to be saved.
const INFO_ONLY: &[&str] = &["site-branch", "unrelated"];
const LOST_MIN_LINES: f64 = 200.0;
const LOST_WINDOW_COMMITS: u32 = 30;
const LOST_BINARY_LINES: f64 = 20.0;

fn network_failure() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)could not resolve (host|proxy)|failed to connect|connection (timed out|refused|reset)|operation timed out|network is unreachable|no route to host|temporary failure in name resolution|recv failure|early eof|ssl_(error|connect)|getaddrinfo|enotfound|etimedout|econnreset|econnrefused").expect("valid pattern")
    })
}

fn sha_pattern() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[0-9a-f]{40,64}$").expect("valid pattern"))
}

fn acknowledged() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?im)^Lost-work-ok:\s*\S").expect("valid pattern"))
}

pub fn fetch_failure(result: &Git) -> &'static str {
    if result.timed_out || network_failure().is_match(&result.stderr) {
        "offline"
    } else {
        "fetch-failed"
    }
}

/// os.hostname().
pub fn hostname() -> String {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::{ComputerNameDnsHostname, GetComputerNameExW};
        let mut buf = [0u16; 256];
        let mut size = buf.len() as u32;
        // SAFETY: the buffer and its size are passed together.
        if unsafe { GetComputerNameExW(ComputerNameDnsHostname, buf.as_mut_ptr(), &mut size) } != 0 {
            return String::from_utf16_lossy(&buf[..size as usize]);
        }
        std::env::var("COMPUTERNAME").unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        std::fs::read_to_string("/etc/hostname").map(|text| text.trim().to_string()).unwrap_or_default()
    }
}

pub fn default_branch(git: &dyn Fn(&[&str]) -> Git) -> String {
    let head = git(&["symbolic-ref", "--quiet", "--short", &format!("refs/remotes/{REMOTE}/HEAD")]);
    if head.ok && head.stdout.starts_with(&format!("{REMOTE}/")) {
        return head.stdout[REMOTE.len() + 1..].to_string();
    }
    for name in ["main", "master"] {
        if git(&["rev-parse", "--verify", "--quiet", &format!("refs/remotes/{REMOTE}/{name}")]).ok {
            return name.into();
        }
    }
    "main".into()
}

pub fn remote_moved(cwd: &str, options: &Value) -> Value {
    let git = git_in(cwd);
    let main = default_branch(&git);
    let timeout = js::get(options, "timeout").and_then(Value::as_f64).unwrap_or(15000.0) as u64;
    let remote = run_git(cwd, &["ls-remote".into(), REMOTE.into(), format!("refs/heads/{main}")], timeout);
    if !remote.ok {
        return json!({ "ok": false, "offline": fetch_failure(&remote) == "offline" });
    }
    let sha = remote.stdout.split_whitespace().next().unwrap_or("").to_string();
    if !sha_pattern().is_match(&sha) {
        return json!({ "ok": true, "moved": false, "main": main });
    }
    let local = git(&["rev-parse", "--verify", "--quiet", &format!("refs/remotes/{REMOTE}/{main}")]);
    json!({ "ok": true, "moved": !local.ok || local.stdout.trim() != sha, "main": main })
}

/// changedFiles: files with changes of their own, not line-ending noise.
pub fn changed_files(cwd: &str) -> f64 {
    let git = git_in(cwd);
    let status = git(&["status", "--porcelain"]);
    let status_lines = lines(&status.stdout).len();
    if status_lines == 0 {
        return 0.0;
    }
    let mut names = IndexSet::new();
    for args in [&["diff", "--name-only", "-z"][..], &["diff", "--cached", "--name-only", "-z"], &["ls-files", "--others", "--exclude-standard", "--directory", "-z"]] {
        let result = git(args);
        if !result.ok {
            return status_lines as f64;
        }
        for name in result.stdout.split('\0').filter(|name| !name.is_empty()) {
            names.insert(name.to_string());
        }
    }
    names.len() as f64
}

// ---- lost work ----

fn nul_lines(text: &str) -> Vec<String> {
    text.split('\0').filter(|line| !line.is_empty()).map(String::from).collect()
}

fn changed_paths(cwd: &str, from: &str, to: &str) -> Option<BTreeSet<String>> {
    let out = run_git(cwd, &["diff".into(), "--name-only".into(), "--no-renames".into(), "-z".into(), from.into(), to.into()], 60000);
    out.ok.then(|| nul_lines(&out.stdout).into_iter().collect())
}

fn changed_lines(cwd: &str, from: &str, to: &str) -> Option<IndexMap<String, f64>> {
    let out = run_git(cwd, &["diff".into(), "--numstat".into(), "--no-renames".into(), "-z".into(), from.into(), to.into()], 60000);
    if !out.ok {
        return None;
    }
    let mut weights = IndexMap::new();
    for entry in nul_lines(&out.stdout) {
        let mut parts = entry.splitn(3, '\t');
        let (Some(added), Some(removed), Some(file)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let numeric = |text: &str| text == "-" || (!text.is_empty() && text.bytes().all(|b| b.is_ascii_digit()));
        if !numeric(added) || !numeric(removed) || file.is_empty() {
            continue;
        }
        let lines = if added == "-" { LOST_BINARY_LINES } else { added.parse::<f64>().unwrap_or(0.0) + removed.parse::<f64>().unwrap_or(f64::NAN) };
        weights.insert(file.to_string(), lines);
    }
    Some(weights)
}

fn exempt(file: &str) -> bool {
    file == "renderer/booklet.html" || file == "TESTRUNS.md" || file.starts_with("docs/archive/testruns-")
}

fn lost_cache() -> &'static Mutex<IndexMap<String, Value>> {
    static CACHE: OnceLock<Mutex<IndexMap<String, Value>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(IndexMap::new()))
}

/// lostWork: merges in `range` whose tip holds exactly one side's copy of
/// paths the other side changed, weighed in lines.
pub fn lost_work(cwd: &str, options: &Value) -> Value {
    let range = super::as_text(js::get(options, "range"));
    let tip = js::get(options, "tip").filter(|tip| !tip.is_null()).map_or_else(|| "HEAD".to_string(), js::string);
    let first = js::get(options, "first") == Some(&json!(true));
    let limit = js::get(options, "limit").and_then(Value::as_f64).unwrap_or(0.0);
    let min_lines = js::get(options, "minLines").and_then(Value::as_f64).unwrap_or(LOST_MIN_LINES);
    let empty = json!({ "findings": [], "acknowledged": [] });
    if range.is_empty() {
        return empty;
    }
    let git = git_in(cwd);
    let tip_sha = git(&["rev-parse", "--verify", "--quiet", &format!("{tip}^{{commit}}")]).stdout;
    if !sha_pattern().is_match(&tip_sha) {
        return empty;
    }
    let key = format!("{cwd}|{tip_sha}|{range}|{first}|{}|{}", js::number_string(limit), js::number_string(min_lines));
    if let Some(found) = lost_cache().lock().ok().and_then(|cache| cache.get(&key).cloned()) {
        return found;
    }
    let mut list_args: Vec<String> = vec!["rev-list".into()];
    if first {
        list_args.push("--first-parent".into());
    }
    list_args.push("--parents".into());
    if limit != 0.0 {
        list_args.push("-n".into());
        list_args.push(js::number_string(limit));
    }
    list_args.push(range.clone());
    let listed = run_git(cwd, &list_args, 30000);
    let merges: Vec<Vec<String>> = if listed.ok {
        listed
            .stdout
            .split('\n')
            .map(|line| line.trim().split_whitespace().map(String::from).collect::<Vec<_>>())
            .filter(|parts| parts.len() == 3 && parts.iter().all(|part| sha_pattern().is_match(part)))
            .collect()
    } else {
        Vec::new()
    };
    let mut findings = Vec::new();
    let mut acknowledged_list = Vec::new();
    for parts in merges.iter().rev() {
        let (merge, first1, second) = (&parts[0], &parts[1], &parts[2]);
        let base = git(&["merge-base", first1, second]).stdout;
        if !sha_pattern().is_match(&base) {
            continue;
        }
        let (Some(side1), Some(side2), Some(tip1), Some(tip2)) =
            (changed_paths(cwd, &base, first1), changed_paths(cwd, &base, second), changed_paths(cwd, &tip_sha, first1), changed_paths(cwd, &tip_sha, second))
        else {
            continue;
        };
        // Each side in turn may be the one whose work was left out. (The
        // files are sorted below, so the order they are found in never shows.)
        for (lost, kept, lost_paths, lost_tip, kept_tip) in [(second, first1, &side2, &tip2, &tip1), (first1, second, &side1, &tip1, &tip2)] {
            let gone: Vec<String> = lost_paths.iter().filter(|file| lost_tip.contains(*file) && !kept_tip.contains(*file) && !exempt(file)).cloned().collect();
            if gone.is_empty() {
                continue;
            }
            let Some(weights) = changed_lines(cwd, &base, lost) else { continue };
            let mut files: Vec<(String, f64)> = gone.iter().map(|file| (file.clone(), weights.get(file).copied().unwrap_or(0.0))).collect();
            files.sort_by(|a, b| {
                let difference = b.1 - a.1;
                if difference > 0.0 {
                    std::cmp::Ordering::Greater
                } else if difference < 0.0 {
                    std::cmp::Ordering::Less
                } else {
                    js::locale_compare(&a.0, &b.0)
                }
            });
            let total: f64 = files.iter().map(|file| file.1).sum();
            if total < min_lines {
                continue;
            }
            let subject = git(&["log", "-1", "--format=%s", merge]).stdout;
            let finding = json!({
                "merge": merge,
                "subject": js::slice(&scrub(&subject), 0, Some(120)),
                "lostFrom": lost,
                "keptFrom": kept,
                "lines": js::num(total),
                "count": files.len(),
                "files": files.iter().take(8).map(|(path, lines)| json!({ "path": path, "lines": js::num(*lines) })).collect::<Vec<_>>(),
            });
            let notes = [git(&["log", "-1", "--format=%B", merge]).stdout, git(&["log", "--format=%B", &format!("{merge}..{tip_sha}")]).stdout];
            if notes.iter().any(|note| acknowledged().is_match(note)) {
                acknowledged_list.push(finding);
            } else {
                findings.push(finding);
            }
        }
    }
    let result = json!({ "findings": findings, "acknowledged": acknowledged_list });
    if let Ok(mut cache) = lost_cache().lock() {
        cache.insert(key, result.clone());
        if cache.len() > 12 {
            cache.shift_remove_index(0);
        }
    }
    result
}

pub fn lost_work_text(item: &Value, blocked: bool) -> String {
    let files = item["files"].as_array().cloned().unwrap_or_default();
    let named: Vec<String> = files.iter().take(3).map(|file| js::string(&file["path"])).collect();
    let count = item["count"].as_f64().unwrap_or(0.0);
    let more = count - named.len() as f64;
    let list = format!("{}{}", named.join(", "), if more > 0.0 { format!(" and {} more", js::number_string(more)) } else { String::new() });
    let merge = js::string(&item["merge"]);
    let subject = item["subject"].as_str().filter(|subject| !subject.is_empty()).unwrap_or("no subject");
    format!(
        "{}Merge {} ({subject}) left out {} of {} another branch changed ({list}). Restore them, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message.",
        if blocked { "Nothing was pushed. " } else { "" },
        js::slice(&merge, 0, Some(7)),
        plural(item["lines"].as_f64().unwrap_or(0.0), "line"),
        plural(count, "file"),
    )
}

// ---- the checkout as it stands ----

fn count(text: &str) -> f64 {
    let n = js::to_number(Some(&json!(text)));
    if n.is_nan() {
        0.0
    } else {
        n
    }
}

pub fn inspect(cwd: &str) -> Value {
    let git = git_in(cwd);
    let top = git(&["rev-parse", "--show-toplevel"]);
    if !top.ok {
        return json!({ "repo": false, "root": paths::resolve(cwd), "device": hostname() });
    }
    let root = paths::resolve(&top.stdout);
    let remote = git(&["remote", "get-url", REMOTE]).ok;
    let main = default_branch(&git);
    let upstream = format!("{REMOTE}/{main}");
    let has_upstream = remote && git(&["rev-parse", "--verify", "--quiet", &format!("refs/remotes/{upstream}")]).ok;
    let has_main = git(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{main}")]).ok;
    let linked = if has_upstream && has_main { git(&["merge-base", &main, &upstream]).ok } else { true };
    let shallow = if linked { false } else { git(&["rev-parse", "--is-shallow-repository"]).stdout.trim() == "true" };
    let comparable = linked || !shallow;
    let (ahead, behind) = if has_upstream && has_main && comparable {
        let out = git(&["rev-list", "--left-right", "--count", &format!("{main}...{upstream}")]).stdout;
        let mut parts = out.split_whitespace().map(|part| js::to_number(Some(&json!(part))));
        (parts.next().unwrap_or(f64::NAN), parts.next().unwrap_or(f64::NAN))
    } else {
        (0.0, 0.0)
    };
    let branch = Some(git(&["rev-parse", "--abbrev-ref", "HEAD"]).stdout).filter(|b| !b.is_empty()).unwrap_or_else(|| "HEAD".into());
    let dirty = changed_files(cwd);
    let stashes = lines(&git(&["stash", "list"]).stdout).len();
    let mut trees: Vec<(String, Option<String>, Option<String>)> = Vec::new();
    for line in lines(&git(&["worktree", "list", "--porcelain"]).stdout) {
        if let Some(path) = line.strip_prefix("worktree ") {
            trees.push((paths::resolve(path), None, None));
        } else if let (Some(last), Some(head)) = (trees.last_mut(), line.strip_prefix("HEAD ")) {
            last.2 = Some(head.to_string());
        } else if let (Some(last), Some(branch)) = (trees.last_mut(), line.strip_prefix("branch refs/heads/")) {
            last.1 = Some(branch.to_string());
        }
    }
    let mut worktrees = Vec::new();
    for (path, tree_branch, head) in &trees {
        if *path == root {
            continue;
        }
        let changed = changed_files(path);
        let mut loose = 0.0;
        if let (None, Some(head), true) = (tree_branch, head, has_upstream) {
            let held = git(&["for-each-ref", "--contains", head, "--count=1", "--format=%(refname)", "refs/heads", &format!("refs/remotes/{REMOTE}")]).stdout;
            if held.is_empty() {
                loose = count(&git(&["rev-list", "--count", head, "--not", &format!("--remotes={REMOTE}")]).stdout);
            }
        }
        if changed != 0.0 || loose != 0.0 {
            worktrees.push(json!({ "path": path, "branch": tree_branch, "dirty": js::num(changed), "loose": js::num(loose) }));
        }
    }
    let missing = |reference: &str| if has_upstream { count(&git(&["rev-list", "--count", &format!("{upstream}..{reference}")]).stdout) } else { 0.0 };
    let refs = |pattern: &str| lines(&git(&["for-each-ref", "--format=%(refname:short)", pattern]).stdout).into_iter().map(String::from).collect::<Vec<_>>();
    let site_ref = format!("{REMOTE}/gh-pages");
    let has_site = git(&["rev-parse", "--verify", "--quiet", &format!("refs/remotes/{site_ref}")]).ok;
    let mut remote_branches: Vec<(String, f64)> = Vec::new();
    let mut site_branches = Vec::new();
    for reference in refs(&format!("refs/remotes/{REMOTE}")) {
        if [REMOTE.to_string(), format!("{REMOTE}/HEAD"), upstream.clone(), site_ref.clone()].contains(&reference) {
            continue;
        }
        let commits = missing(&reference);
        if commits == 0.0 {
            continue;
        }
        if has_site && git(&["merge-base", &site_ref, &reference]).ok && !git(&["merge-base", &upstream, &reference]).ok {
            let on_site = count(&git(&["rev-list", "--count", &format!("{site_ref}..{reference}")]).stdout);
            if on_site != 0.0 {
                site_branches.push(json!({ "name": &reference[REMOTE.len() + 1..], "commits": js::num(on_site) }));
            }
            continue;
        }
        remote_branches.push((reference[REMOTE.len() + 1..].to_string(), commits));
    }
    let mut local_branches = Vec::new();
    for reference in refs("refs/heads") {
        if reference == main {
            continue;
        }
        let commits = missing(&reference);
        if commits == 0.0 {
            continue;
        }
        if count(&git(&["rev-list", "--count", &reference, "--not", &format!("--remotes={REMOTE}")]).stdout) == 0.0 {
            continue;
        }
        let published = remote_branches.iter().any(|(name, _)| *name == reference);
        if published && count(&git(&["rev-list", "--count", &format!("{REMOTE}/{reference}..{reference}")]).stdout) == 0.0 {
            continue;
        }
        local_branches.push(json!({ "name": reference, "commits": js::num(commits) }));
    }
    let or_zero = |n: f64| if n.is_nan() || n == 0.0 { 0.0 } else { n };
    json!({
        "repo": true, "root": root, "device": hostname(), "remote": remote, "main": main, "upstream": upstream, "hasUpstream": has_upstream,
        "unrelated": !comparable, "shallow": shallow, "branch": branch, "ahead": js::num(or_zero(ahead)), "behind": js::num(or_zero(behind)),
        "dirty": js::num(dirty), "stashes": stashes, "worktrees": worktrees, "localBranches": local_branches,
        "remoteBranches": remote_branches.iter().map(|(name, commits)| json!({ "name": name, "commits": js::num(*commits) })).collect::<Vec<_>>(),
        "siteBranches": site_branches,
    })
}

fn base_name(path: &str) -> String {
    path.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or_default().to_string()
}

/// pending: everything not on GitHub's default branch yet, one item each.
pub fn pending(state: &Value) -> Vec<Value> {
    if state["repo"] != json!(true) {
        return Vec::new();
    }
    let main = js::string(&state["main"]);
    let number = |key: &str| state[key].as_f64().unwrap_or(0.0);
    let mut items = Vec::new();
    let branch = js::string(&state["branch"]);
    if branch != main {
        let on = if branch == "HEAD" { "a detached HEAD".to_string() } else { format!("branch {branch}") };
        items.push(json!({ "kind": "branch", "text": format!("This checkout is on {on}, not {main}.") }));
    }
    if number("dirty") != 0.0 {
        items.push(json!({ "kind": "uncommitted", "count": state["dirty"], "text": format!("{} in this checkout.", plural(number("dirty"), "uncommitted file")) }));
    }
    if number("ahead") != 0.0 {
        items.push(json!({ "kind": "unpushed", "count": state["ahead"], "text": format!("{} on {main} not pushed yet.", plural(number("ahead"), "commit")) }));
    }
    if number("stashes") != 0.0 {
        items.push(json!({ "kind": "stash", "count": state["stashes"], "text": format!("{} saved on this PC.", plural_as(number("stashes"), "stash", "stashes")) }));
    }
    for tree in state["worktrees"].as_array().into_iter().flatten() {
        let dirty = tree["dirty"].as_f64().unwrap_or(0.0);
        let loose = tree["loose"].as_f64().unwrap_or(0.0);
        let parts: Vec<String> = [
            if dirty != 0.0 { plural(dirty, "uncommitted file") } else { String::new() },
            if loose != 0.0 { format!("{} on no branch and not on GitHub", plural(loose, "commit")) } else { String::new() },
        ]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect();
        let tree_branch = tree["branch"].as_str().filter(|b| !b.is_empty()).unwrap_or("detached");
        items.push(json!({
            "kind": "worktree", "path": tree["path"], "count": js::num(dirty + loose),
            "text": format!("Worktree {} ({tree_branch}): {}.", base_name(&js::string(&tree["path"])), parts.join(" and ")),
        }));
    }
    for item in state["localBranches"].as_array().into_iter().flatten() {
        let name = js::string(&item["name"]);
        items.push(json!({ "kind": "local-branch", "name": name, "count": item["commits"], "text": format!("Branch {name} on this PC: {} not on {main}.", plural(item["commits"].as_f64().unwrap_or(0.0), "commit")) }));
    }
    if state["unrelated"] == json!(true) {
        items.push(json!({ "kind": "unrelated", "text": format!("This is a shallow clone and local {main} shares no history with {} in what it fetched, so their commits were not compared.", js::string(&state["upstream"])) }));
    }
    for item in state["siteBranches"].as_array().into_iter().flatten() {
        let name = js::string(&item["name"]);
        items.push(json!({ "kind": "site-branch", "name": name, "count": item["commits"], "text": format!("Site branch {name} on GitHub: {} not on gh-pages yet. It never merges into {main}; publish the site separately.", plural(item["commits"].as_f64().unwrap_or(0.0), "commit")) }));
    }
    for item in state["remoteBranches"].as_array().into_iter().flatten() {
        let name = js::string(&item["name"]);
        items.push(json!({ "kind": "github-branch", "name": name, "count": item["commits"], "text": format!("Branch {name} on GitHub: {} not on {main}.", plural(item["commits"].as_f64().unwrap_or(0.0), "commit")) }));
    }
    items
}

pub fn at_risk(items: &[Value]) -> Vec<Value> {
    items.iter().filter(|item| item["kind"].as_str().is_some_and(|kind| LOCAL_ONLY.contains(&kind))).cloned().collect()
}

fn headline(state: &Value, problems: &[Value], waiting: &[Value]) -> String {
    let kind_is = |item: &Value, kind: &str| item["kind"] == json!(kind);
    if state["repo"] != json!(true) {
        return "This project folder is not a Git repository, so there is nothing to sync.".into();
    }
    if state["remote"] != json!(true) {
        return format!("This project has no {REMOTE} remote yet. Publish it to GitHub once to link your PCs.");
    }
    if let Some(unchecked) = problems.iter().find(|item| kind_is(item, "fetch-failed")) {
        return format!("Couldn't check GitHub ({}). Sign in to GitHub again or check this project's GitHub address; nothing was changed.", js::string(&unchecked["detail"]));
    }
    let main = js::string(&state["main"]);
    let upstream = js::string(&state["upstream"]);
    if state["hasUpstream"] != json!(true) {
        return format!("GitHub has no {upstream} yet. Push {main} once to link your PCs.");
    }
    if state["unrelated"] == json!(true) {
        return format!("This is a shallow clone, and local {main} shares no history with {upstream} in what it fetched, so they were not compared. Nothing was changed.");
    }
    if let Some(conflict) = problems.iter().find(|item| kind_is(item, "rebase-conflict")) {
        let files: Vec<String> = conflict["files"].as_array().into_iter().flatten().take(3).map(js::string).collect();
        let what = if files.is_empty() { "the same lines".to_string() } else { files.join(", ") };
        return format!("Your commits and GitHub's both change {what}. Nothing was changed; merge them by hand or ask Mefi.");
    }
    if let Some(lost) = problems.iter().find(|item| kind_is(item, "lost-work")) {
        return lost_work_text(&lost["findings"][0], true);
    }
    if problems.iter().any(|item| kind_is(item, "check-failed")) {
        return "The project's check failed, so nothing was pushed. Fix it, then sync again.".into();
    }
    if problems.iter().any(|item| kind_is(item, "diverged")) {
        return if state["dirty"].as_f64().unwrap_or(0.0) != 0.0 {
            format!("{main} changed on this PC and on GitHub. Commit or set aside the uncommitted files, then put this PC's commits on top of GitHub's.")
        } else {
            format!("{main} changed on this PC and on GitHub. Put this PC's commits on top of GitHub's, then sync.")
        };
    }
    let offline = problems.iter().any(|item| kind_is(item, "offline"));
    let behind = state["behind"].as_f64().unwrap_or(0.0);
    let ahead = state["ahead"].as_f64().unwrap_or(0.0);
    if behind != 0.0 && ahead == 0.0 {
        return format!("GitHub has {} this PC has not pulled yet.", plural(behind, "commit"));
    }
    if waiting.iter().any(|item| !item["kind"].as_str().is_some_and(|kind| INFO_ONLY.contains(&kind))) {
        return if offline { "GitHub could not be reached. Some work on this PC is not on GitHub yet.".into() } else { "Some work on this PC is not on GitHub yet.".into() };
    }
    if offline {
        "GitHub could not be reached. As of the last check, this PC matched GitHub.".into()
    } else {
        format!("This PC matches GitHub {main}.")
    }
}

fn option_bool(options: &Value, key: &str, fallback: bool) -> bool {
    match js::get(options, key) {
        None => fallback,
        Some(value) => js::truthy(value),
    }
}

/// sync: fetch, then at most one of rebase, fast-forward or a checked push,
/// then report. Nothing throws.
pub fn sync(cwd: &str, options: &Value, callbacks: &dyn Callbacks) -> Result<Value> {
    let fetch = option_bool(options, "fetch", true);
    let pull = option_bool(options, "pull", true);
    let push = option_bool(options, "push", true);
    let rebase = option_bool(options, "rebase", false);
    let allow_lost_work = option_bool(options, "allowLostWork", false);
    let timeout = js::get(options, "timeout").and_then(Value::as_f64).unwrap_or(30000.0) as u64;
    let check = js::get(options, "check").filter(|check| crate::callbacks::is_function(check)).cloned();
    let git_t = |args: &[&str], ms: u64| run_git(cwd, &args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>(), ms);
    let git = git_in(cwd);
    let mut actions: Vec<Value> = Vec::new();
    let mut problems: Vec<Value> = Vec::new();
    let mut state = inspect(cwd);
    let flag = |state: &Value, key: &str| state[key] == json!(true);
    let number = |state: &Value, key: &str| state[key].as_f64().unwrap_or(0.0);
    if flag(&state, "repo") && flag(&state, "remote") && fetch {
        let fetched = git_t(&["fetch", REMOTE, "--prune"], timeout);
        if fetched.ok {
            state = inspect(cwd);
        } else {
            let detail = Some(first_line(&fetched.stderr)).filter(|line| !line.is_empty()).unwrap_or_else(|| "git fetch failed".into());
            problems.push(json!({ "kind": fetch_failure(&fetched), "detail": detail }));
        }
        if fetched.ok && flag(&state, "unrelated") && flag(&state, "shallow") {
            let main = js::string(&state["main"]);
            let tip = git(&["log", "-1", "--format=%cI", &main]).stdout;
            if let Some(ms) = parse_iso_ms(tip.trim()) {
                let since = js::iso_string(ms - 86_400_000.0).unwrap_or_default();
                let deepened = git_t(&["fetch", REMOTE, &format!("--shallow-since={since}"), &main], timeout * 4);
                if deepened.ok {
                    state = inspect(cwd);
                }
            }
        }
    }
    let online = flag(&state, "hasUpstream") && problems.is_empty();
    let on_main = state["branch"] == state["main"];
    let upstream = js::string(&state["upstream"]);
    let main = js::string(&state["main"]);
    if online && on_main && number(&state, "ahead") != 0.0 && number(&state, "behind") != 0.0 && rebase && number(&state, "dirty") == 0.0 {
        let rebased = git_t(&["rebase", "--quiet", "--no-autostash", &upstream], 120_000);
        if rebased.ok {
            actions.push(json!({ "kind": "rebased", "commits": state["ahead"] }));
            state = inspect(cwd);
        } else {
            let files: Vec<String> = lines(&git(&["diff", "--name-only", "--diff-filter=U"]).stdout).into_iter().take(20).map(String::from).collect();
            git(&["rebase", "--abort"]);
            state = inspect(cwd);
            problems.push(json!({ "kind": "rebase-conflict", "files": files, "detail": first_line(&rebased.stderr) }));
        }
    }
    let ahead = number(&state, "ahead");
    let behind = number(&state, "behind");
    if online && on_main && ahead != 0.0 && behind != 0.0 {
        if problems.is_empty() {
            problems.push(json!({ "kind": "diverged", "ahead": state["ahead"], "behind": state["behind"], "detail": format!("{} and {} on GitHub.", plural(ahead, "local commit"), plural(behind, "commit")) }));
        }
    } else if online && on_main && pull && behind != 0.0 {
        let merged = git(&["merge", "--ff-only", "--quiet", "--no-autostash", &upstream]);
        if merged.ok {
            actions.push(json!({ "kind": "pulled", "commits": state["behind"] }));
        } else {
            problems.push(json!({ "kind": "pull-refused", "detail": first_line(&merged.stderr) }));
        }
    } else if online && on_main && push && ahead != 0.0 && problems.is_empty() {
        let lost = if allow_lost_work { json!({ "findings": [] }) } else { lost_work(cwd, &json!({ "range": format!("{upstream}..{main}"), "tip": main })) };
        let findings = lost["findings"].as_array().cloned().unwrap_or_default();
        let gate = if !findings.is_empty() {
            Value::Null
        } else if let Some(check) = &check {
            invoke(callbacks, check, vec![]).unwrap_or_else(|error| json!({ "ok": false, "detail": error }))
        } else {
            json!({ "ok": true })
        };
        if !findings.is_empty() {
            problems.push(json!({ "kind": "lost-work", "findings": findings, "detail": lost_work_text(&findings[0], true) }));
        } else if !js::truthy(&gate["ok"]) {
            let detail = Some(js::string(&gate["detail"])).filter(|detail| !gate["detail"].is_null() && !detail.is_empty()).unwrap_or_else(|| "the check failed".into());
            problems.push(json!({ "kind": "check-failed", "detail": scrub(&detail) }));
        } else {
            let pushed = git_t(&["push", REMOTE, &format!("{main}:{main}")], timeout);
            if pushed.ok {
                actions.push(json!({ "kind": "pushed", "commits": state["ahead"] }));
            } else {
                problems.push(json!({ "kind": "push-refused", "detail": last_line(&pushed.stderr) }));
            }
        }
    }
    if actions.iter().any(|item| item["kind"] != json!("rebased")) {
        state = inspect(cwd);
    }
    let mut waiting = pending(&state);
    if flag(&state, "repo") && flag(&state, "hasUpstream") && !problems.iter().any(|item| item["kind"] == json!("fetch-failed")) {
        let refused: BTreeSet<String> = problems
            .iter()
            .filter(|item| item["kind"] == json!("lost-work"))
            .flat_map(|item| item["findings"].as_array().cloned().unwrap_or_default())
            .map(|finding| js::string(&finding["merge"]))
            .collect();
        let state_main = js::string(&state["main"]);
        let recent = lost_work(cwd, &json!({ "range": state_main, "tip": state_main, "first": true, "limit": LOST_WINDOW_COMMITS }));
        for item in recent["findings"].as_array().into_iter().flatten() {
            if !refused.contains(&js::string(&item["merge"])) {
                waiting.push(json!({ "kind": "lost-work", "merge": item["merge"], "count": item["count"], "text": lost_work_text(item, false) }));
            }
        }
    }
    let mut notes: Vec<Value> = actions
        .iter()
        .map(|item| {
            let commits = item["commits"].as_f64().unwrap_or(0.0);
            match item["kind"].as_str() {
                Some("pulled") => json!(format!("Pulled {} from GitHub.", plural(commits, "commit"))),
                Some("pushed") => json!(format!("Pushed {} to GitHub.", plural(commits, "commit"))),
                Some("rebased") => json!(format!("Put {} from this PC on top of GitHub's.", plural(commits, "commit"))),
                _ => Value::Null,
            }
        })
        .collect();
    for item in problems.iter().filter(|item| item["kind"] == json!("lost-work")) {
        for finding in item["findings"].as_array().into_iter().flatten().skip(1) {
            notes.push(json!(lost_work_text(finding, false)));
        }
    }
    let state_main = js::string(&state["main"]);
    for item in problems.iter().filter(|item| !["diverged", "rebase-conflict", "fetch-failed", "lost-work"].contains(&item["kind"].as_str().unwrap_or(""))) {
        let detail = js::string(&item["detail"]);
        notes.push(match item["kind"].as_str() {
            Some("offline") => json!(format!("Could not reach GitHub: {detail}")),
            Some("pull-refused") => json!(format!("Could not fast-forward {state_main} (uncommitted edits in the way?): {detail}")),
            Some("push-refused") => json!(format!("GitHub refused the push: {detail}")),
            Some("check-failed") => json!(format!("npm run check: {detail}")),
            _ => Value::Null,
        });
    }
    let summary = headline(&state, &problems, &waiting);
    let checked_at = match js::get(options, "now").filter(|now| crate::callbacks::is_function(now)) {
        Some(now) => invoke(callbacks, now, vec![]).unwrap_or(Value::Null),
        None => js::num(js::now_ms()),
    };
    let risk = at_risk(&waiting).len();
    let can_rebase = flag(&state, "repo")
        && on_main
        && number(&state, "ahead") != 0.0
        && number(&state, "behind") != 0.0
        && number(&state, "dirty") == 0.0
        && !problems.iter().any(|item| ["offline", "fetch-failed"].contains(&item["kind"].as_str().unwrap_or("")));
    let mut all_lines = vec![json!(summary)];
    all_lines.extend(notes);
    all_lines.extend(waiting.iter().map(|item| item["text"].clone()));
    Ok(json!({
        "ok": flag(&state, "repo") && flag(&state, "remote") && !problems.iter().any(|item| item["kind"] != json!("offline")),
        "checkedAt": checked_at,
        "state": state,
        "actions": actions,
        "problems": problems,
        "pending": waiting,
        "risk": risk,
        "canRebase": can_rebase,
        "headline": summary,
        "lines": all_lines,
    }))
}

/// Date.parse for git's strict ISO 8601 (%cI): 2026-10-03T17:16:00-05:00.
fn parse_iso_ms(text: &str) -> Option<f64> {
    let re = Regex::new(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|([+-])(\d{2}):(\d{2}))$").ok()?;
    let caps = re.captures(text)?;
    let n = |i: usize| caps.get(i).map_or(0, |m| m.as_str().parse::<i64>().unwrap_or(0));
    let (year, month, day) = (n(1), n(2), n(3));
    // days_from_civil
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let mut seconds = days * 86400 + n(4) * 3600 + n(5) * 60 + n(6);
    if caps.get(8).is_some() {
        let offset = n(9) * 3600 + n(10) * 60;
        seconds -= if &caps[8] == "+" { offset } else { -offset };
    }
    Some(seconds as f64 * 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_offsets_parse_like_date_parse() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0.0));
        assert_eq!(parse_iso_ms("2026-10-03T17:16:00-05:00"), Some(1_791_065_760_000.0));
    }

    #[test]
    fn pending_lists_local_work_first() {
        let state = json!({ "repo": true, "main": "main", "branch": "feature", "dirty": 2, "ahead": 1, "stashes": 1, "worktrees": [], "localBranches": [], "remoteBranches": [{ "name": "wip/x", "commits": 3 }], "siteBranches": [], "unrelated": false });
        let items = pending(&state);
        let kinds: Vec<&str> = items.iter().map(|item| item["kind"].as_str().unwrap()).collect();
        assert_eq!(kinds, vec!["branch", "uncommitted", "unpushed", "stash", "github-branch"]);
        assert_eq!(at_risk(&items).len(), 3);
        assert_eq!(items[3]["text"], "1 stash saved on this PC.");
    }
}
