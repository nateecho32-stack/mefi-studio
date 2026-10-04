//! The Git chip's vocabulary (scripts/git-link.cjs `STATES`, `describe`,
//! `chip`): the facts the host gathered in, the chip model out, by priority:
//! working, problems, linking, both changed, to pull, other branch, to push,
//! changes, in sync. Every surface reads its words from here, so a state
//! never has two names.

use serde_json::{json, Map, Value};

use super::rules::{classify_push, plural, scrub};
use crate::js;
use crate::js_regex;

/// One row of the state table: label, tone, glyph, sentence and two actions.
pub struct Row {
    pub id: &'static str,
    pub label: &'static str,
    pub label_one: Option<&'static str>,
    pub tone: &'static str,
    pub sentence: &'static str,
    pub dirty_sentence: Option<&'static str>,
    pub clean_sentence: Option<&'static str>,
    pub primary: Option<(&'static str, &'static str)>,
    pub secondary: Option<(&'static str, &'static str)>,
}

const fn row(id: &'static str, label: &'static str, tone: &'static str, sentence: &'static str, primary: Option<(&'static str, &'static str)>, secondary: Option<(&'static str, &'static str)>) -> Row {
    Row { id, label, label_one: None, tone, sentence, dirty_sentence: None, clean_sentence: None, primary, secondary }
}

pub const ROWS: [Row; 31] = [
    row("not-repo", "Not a repo", "neutral", "This project folder is not a Git repository, so there is nothing to sync.", Some(("setup-git", "Set up Git and GitHub")), Some(("not-now", "Not now"))),
    row("no-commits", "No commits yet", "neutral", "No commits yet. Save a first commit, then publish.", Some(("save-first", "Save a first commit")), Some(("publish-later", "Publish later"))),
    row("no-remote", "Only on this PC", "neutral", "This project is only on this PC. Publish it to GitHub once to link your PCs.", Some(("publish", "Publish to GitHub")), Some(("link", "Link to a repo I already have"))),
    row("other-remote", "Linked elsewhere", "neutral", "This project is linked somewhere other than GitHub, so Studio leaves it alone.", None, Some(("show-address", "Show address"))),
    row("signed-out", "Sign in", "warn", "Sign in to GitHub first.", Some(("sign-in", "Sign in to GitHub")), Some(("not-now", "Not now"))),
    row("checking", "Checking…", "neutral", "Looking at GitHub. Nothing is being changed.", None, None),
    row("in-sync", "In sync", "good", "This PC matches GitHub {m}.", Some(("check", "Check GitHub")), Some(("open-github", "Open on GitHub"))),
    row("ahead", "{n} to push", "info", "Some work on this PC is not on GitHub yet.", Some(("push", "Push {ahead}")), Some(("show-push", "Show what will be pushed"))),
    row("behind", "{n} to pull", "info", "GitHub has {behind} this PC has not pulled yet.", Some(("pull", "Pull {behind}")), Some(("show-changes", "Show what changed"))),
    Row {
        dirty_sentence: Some("{m} changed on this PC and on GitHub. Commit or set aside the uncommitted files, then put this PC's commits on top of GitHub's."),
        ..row("diverged", "Both changed", "warn", "{m} changed on this PC and on GitHub. Put this PC's commits on top of GitHub's, then sync.", Some(("rebase", "Put my commits on top of GitHub's")), Some(("ask-mefi-combine", "Ask Mefi to combine them")))
    },
    Row { label_one: Some("1 change"), ..row("uncommitted", "{n} changes", "info", "{uncommitted} in this checkout.", Some(("save-and-push", "Save and push {changed}")), Some(("save", "Save only"))) },
    row("other-branch", "On {branch}", "warn", "This checkout is on {where}, not {m}.", Some(("push", "Push this branch")), Some(("details", "Details"))),
    row("no-upstream", "Not pushed yet", "info", "GitHub does not have {m} yet. Push it once to link your PCs.", Some(("push", "Push {m} to GitHub")), Some(("open-github", "Open on GitHub"))),
    Row {
        clean_sentence: Some("GitHub could not be reached. As of the last check, this PC matched GitHub."),
        ..row("offline", "Offline", "neutral", "GitHub could not be reached. Some work on this PC is not on GitHub yet.", Some(("retry", "Try again")), Some(("save", "Save on this PC")))
    },
    row("fetch-failed", "Can't check GitHub", "bad", "Couldn't check GitHub ({detail}). Sign in to GitHub again or check this project's GitHub address; nothing was changed.", Some(("sign-in", "Sign in again")), Some(("retry", "Try again"))),
    row("agents-working", "Agents building", "info", "Agents are still changing files in this project. Pull now anyway?", Some(("pull-anyway", "Pull now")), Some(("wait", "Wait"))),
    row("saving", "Saving…", "info", "Saving {changed} on this PC.", None, None),
    row("pushing", "Pushing…", "info", "Checking nothing was left out. Running the project's check. Uploading {ahead}.", None, Some(("details", "Details"))),
    row("pulling", "Pulling…", "info", "Getting {behind} from GitHub…", None, None),
    row("publishing", "Publishing…", "info", "Saving a first commit. Creating {repo}. Uploading.", None, None),
    row("check-failed", "Check failed", "bad", "The project's check failed, so nothing was pushed. Fix it, then sync again.", Some(("ask-mefi-fix", "Ask Mefi to fix it")), Some(("show-output", "Show check output"))),
    row("lost-work", "Held back", "bad", "Nothing was pushed. Merge {sha} ({subject}) left out {lines} of {fileCount} another branch changed ({names}). Restore them, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message.", Some(("ask-mefi-restore", "Ask Mefi to restore them")), Some(("show-files", "Show the files"))),
    row("conflict", "Needs merging", "bad", "Your commits and GitHub's both change {names}. Nothing was changed; merge them by hand or ask Mefi.", Some(("ask-mefi-merge", "Ask Mefi to merge")), Some(("open-folder", "Open the folder"))),
    row("push-refused", "GitHub said no", "bad", "GitHub refused the push: {detail}", Some(("retry", "Try again")), Some(("details", "Details"))),
    row("blocked-secret", "Stopped", "bad", "Stopped: {what} in {file}.", Some(("leave-out", "Leave that file out")), Some(("show-where", "Show where"))),
    row("too-large", "File too big", "warn", "{file} is {mb} MB; GitHub refuses files over 100 MB.", Some(("leave-out-ignore", "Leave it out and ignore it")), Some(("show-file", "Show the file"))),
    row("folder-missing", "Folder missing", "warn", "That project folder is unavailable. Reconnect it before switching.", Some(("find-folder", "Find the folder")), Some(("remove", "Remove from list"))),
    row("unknown", "Not checked", "neutral", "Git state not read yet.", None, None),
    row("success", "Done", "good", "Pushed {commits} to GitHub.", Some(("open-github", "Open on GitHub")), Some(("done", "Done"))),
    row("pull-refused", "Can't pull now", "warn", "Could not fast-forward {m} (uncommitted edits in the way?): {detail}", Some(("save", "Save my changes")), Some(("show-files", "Show the files"))),
    row("error", "Sync did not run", "bad", "Sync could not run: {message}", Some(("retry", "Try again")), Some(("details", "Details"))),
];

pub fn state(id: &str) -> Option<&'static Row> {
    ROWS.iter().find(|row| row.id == id)
}

fn outcome_sentence(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "pushed" => "Pushed {commits} to GitHub.",
        "pulled" => "Pulled {commits} from GitHub.",
        "rebased" => "Put {commits} from this PC on top of GitHub's.",
        "published" => "Published {repo}.",
        "saved" => "Saved {changed} on this PC.",
        _ => return None,
    })
}

const CONFIRM: [&str; 3] = ["push", "push-branch", "rebase"];
pub const BUSY: [&str; 5] = ["saving", "pushing", "pulling", "publishing", "checking"];
const PROBLEM_RANK: [&str; 10] = ["error", "fetch-failed", "conflict", "lost-work", "blocked-secret", "too-large", "check-failed", "push-refused", "pull-refused", "offline"];
const DETAIL_CAP: usize = 12;
const PENDING_LINES: [&str; 5] = ["stash", "worktree", "local-branch", "github-branch", "lost-work"];

/// `typeof value === "string" ? value : ""`.
fn text(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or("").to_string()
}

/// `Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(...) : 0`.
pub fn count(value: Option<&Value>) -> f64 {
    let n = js::to_number(value);
    if n.is_finite() && n > 0.0 {
        n.floor()
    } else {
        0.0
    }
}

/// `value && typeof value === "object"`: an object or an array.
fn objectish(value: Option<&Value>) -> Option<&Value> {
    value.filter(|value| value.is_object() || value.is_array())
}

fn article(name: &str) -> String {
    format!("{} {name}", if name.chars().next().is_some_and(|c| "aeiouAEIOU".contains(c)) { "an" } else { "a" })
}

/// `{name}` blanks filled from `vars`, an unknown one with "".
fn fill(template: &str, vars: &Map<String, Value>) -> String {
    js_regex!(r"\{(\w+)\}", "g")
        .replace_all(template, |found: &regex::Captures| match vars.get(&found[1]) {
            None | Some(Value::Null) => String::new(),
            Some(value) => js::string(value),
        })
        .into_owned()
}

/// The facts, read once.
struct Context {
    g: Option<Value>,
    sync: Option<Value>,
    project: Value,
    remote_kind: &'static str,
    remote_repo: Option<String>,
    account_known: bool,
    account_name: Option<String>,
    account_gh: bool,
    detached: bool,
    branch: Option<String>,
    main: String,
    on_default: bool,
    ahead: f64,
    behind: f64,
    dirty: f64,
    upstream: Option<String>,
    busy: Option<String>,
    agents: bool,
    checked_at: Value,
    outcome: Option<Value>,
    refusal: Option<Value>,
    needs_github: bool,
}

fn glance_of(glance: Option<&Value>, sync: Option<&Value>) -> Option<Value> {
    if let Some(glance) = objectish(glance).filter(|glance| glance.get("isRepo").is_some_and(Value::is_boolean)) {
        return Some(glance.clone());
    }
    let state = objectish(sync.and_then(|sync| sync.get("state")))?;
    let repo = state.get("repo").filter(|repo| repo.is_boolean())?;
    let detached = state.get("branch").and_then(Value::as_str) == Some("HEAD");
    let branch = text(state.get("branch"));
    let main = text(state.get("main"));
    Some(json!({
        "isRepo": repo, "unborn": false, "branch": if detached || branch.is_empty() { Value::Null } else { json!(branch) }, "detached": detached,
        "dirty": js::or_null(state.get("dirty")), "ahead": js::or_null(state.get("ahead")), "behind": js::or_null(state.get("behind")),
        "upstream": if state.get("hasUpstream").is_some_and(js::truthy) { json!(text(state.get("upstream"))) } else { Value::Null },
        "remote": if state.get("remote").is_some_and(js::truthy) { json!(true) } else { Value::Null },
        "main": if main.is_empty() { Value::Null } else { json!(main) },
        "onDefault": !detached && state.get("branch") == state.get("main"), "available": true,
    }))
}

fn context(input: &Value) -> Context {
    let empty = json!({});
    let i = if input.is_object() || input.is_array() { input } else { &empty };
    let sync = objectish(i.get("sync")).cloned();
    let g = glance_of(i.get("glance"), sync.as_ref());
    let project = objectish(i.get("project")).cloned().unwrap_or_else(|| json!({}));
    let remote = g.as_ref().and_then(|g| g.get("remote")).cloned().unwrap_or(Value::Null);
    let (remote_kind, remote_repo) = match &remote {
        Value::Bool(true) => ("github", None),
        Value::String(text) if !text.is_empty() => {
            if js_regex!(r"^[^/\s]+\/[^/\s]+$", "").is_match(text) {
                ("github", Some(text.clone()))
            } else {
                ("other", None)
            }
        }
        _ => ("none", None),
    };
    let (account_known, account_name, account_gh) = match i.get("account") {
        None => (false, None, true),
        Some(value @ (Value::Object(_) | Value::Array(_))) => {
            let known = value.get("ok") != Some(&Value::Bool(false)) && value.get("account").is_some();
            let name = if known { Some(text(value.get("account"))).filter(|name| !name.is_empty()) } else { None };
            (known, name, value.get("ghInstalled") != Some(&Value::Bool(false)))
        }
        Some(value) => (true, value.as_str().filter(|name| !name.is_empty()).map(String::from), true),
    };
    let field = |key: &str| g.as_ref().and_then(|g| g.get(key));
    let detached = g.is_some() && !field("unborn").is_some_and(js::truthy) && (field("detached") == Some(&Value::Bool(true)) || field("branch").and_then(Value::as_str) == Some("HEAD"));
    let branch = if g.is_some() && !detached { field("branch").and_then(Value::as_str).filter(|branch| !branch.is_empty() && *branch != "HEAD").map(String::from) } else { None };
    let main = [text(field("main")), text(sync.as_ref().and_then(|sync| sync.get("state")).and_then(|state| state.get("main")))]
        .into_iter()
        .find(|name| !name.is_empty())
        .or_else(|| if field("onDefault") == Some(&Value::Bool(true)) { branch.clone() } else { None })
        .unwrap_or_else(|| "main".into());
    let on_default = match &g {
        None => true,
        Some(_) if detached => false,
        Some(g) => match g.get("onDefault") {
            Some(Value::Bool(flag)) => *flag,
            _ => branch.as_ref().is_none_or(|branch| *branch == main),
        },
    };
    let finite = |value: Option<&Value>| value.and_then(Value::as_f64).filter(|n| n.is_finite());
    let checked = finite(i.get("checkedAt")).or_else(|| finite(sync.as_ref().and_then(|sync| sync.get("checkedAt"))));
    let busy = i.get("busy").and_then(Value::as_str).filter(|busy| BUSY.contains(busy)).map(String::from);
    let outcome = objectish(i.get("outcome")).filter(|outcome| outcome.get("kind").and_then(Value::as_str).is_some_and(|kind| outcome_sentence(kind).is_some())).cloned();
    let refusal = objectish(i.get("refusal")).filter(|refusal| refusal.get("kind").is_some_and(Value::is_string)).cloned();
    let upstream = Some(text(field("upstream"))).filter(|upstream| !upstream.is_empty());
    Context {
        needs_github: project.get("needsGitHub") == Some(&Value::Bool(true)) || remote_kind == "github",
        ahead: count(field("ahead")),
        behind: count(field("behind")),
        dirty: count(field("dirty")),
        g, sync, project, remote_kind, remote_repo, account_known, account_name, account_gh, detached, branch, main, on_default, upstream, busy,
        agents: i.get("agentsBuilding").is_some_and(js::truthy),
        checked_at: checked.map_or(Value::Null, js::num),
        outcome, refusal,
    }
}

/// Whether the last sync's complaint still describes the checkout.
fn live(kind: &str, c: &Context) -> bool {
    if c.g.is_none() {
        return true;
    }
    match kind {
        "diverged" | "rebase-conflict" => c.ahead > 0.0 && c.behind > 0.0,
        "push-refused" | "check-failed" | "lost-work" => c.ahead > 0.0 || c.upstream.is_none(),
        "pull-refused" => c.behind > 0.0,
        _ => true,
    }
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

/// A decision: the state id and what its sentence needs.
#[derive(Clone, Default)]
struct Decision {
    id: String,
    detail: Option<String>,
    message: Option<String>,
    cls: Option<Value>,
    file: Option<Value>,
    label: Option<Value>,
    mb: Option<Value>,
    files: Vec<String>,
    findings: Vec<Value>,
}

fn decided(id: &str) -> Decision {
    Decision { id: id.into(), ..Decision::default() }
}

fn classified(cls: &Value) -> Option<Decision> {
    let id = push_state(cls.get("kind").and_then(Value::as_str)?)?;
    Some(Decision {
        id: id.into(), cls: Some(cls.clone()), detail: Some(scrub(&text(cls.get("detail")))),
        file: cls.get("file").cloned(), label: cls.get("label").cloned(), mb: cls.get("mb").cloned(), ..Decision::default()
    })
}

fn sync_problem(raw: &Value, c: &Context) -> Option<Decision> {
    objectish(Some(raw))?;
    let detail = scrub(&text(raw.get("detail")));
    let kind = raw.get("kind").and_then(Value::as_str)?;
    let with_detail = |id: &str| Decision { id: id.into(), detail: Some(detail.clone()), ..Decision::default() };
    match kind {
        "offline" => Some(with_detail("offline")),
        "fetch-failed" => Some(with_detail("fetch-failed")),
        "rebase-conflict" => live(kind, c).then(|| Decision {
            id: "conflict".into(),
            files: raw.get("files").and_then(Value::as_array).map(|files| files.iter().map(|file| text(Some(file))).filter(|file| !file.is_empty()).collect()).unwrap_or_default(),
            ..Decision::default()
        }),
        "lost-work" => live(kind, c).then(|| Decision { findings: raw.get("findings").and_then(Value::as_array).cloned().unwrap_or_default(), ..with_detail("lost-work") }),
        "check-failed" => live(kind, c).then(|| with_detail("check-failed")),
        "pull-refused" => live(kind, c).then(|| with_detail("pull-refused")),
        "push-refused" => {
            if !live(kind, c) {
                return None;
            }
            let stderr = text(raw.get("stderr"));
            let cls = classify_push(if stderr.is_empty() { &detail } else { &stderr }, false, "");
            classified(&cls).or(Some(Decision { cls: Some(cls), ..with_detail("push-refused") }))
        }
        "error" => {
            let headline = text(c.sync.as_ref().and_then(|sync| sync.get("headline")));
            let message = scrub(&js_regex!(r"^Sync could not run:\s*", "i").replace(&headline, ""));
            Some(Decision { message: Some(if message.is_empty() { detail.clone() } else { message }), ..decided("error") })
        }
        _ => None,
    }
}

fn worst_problem(c: &Context) -> Option<Decision> {
    let mut found = Vec::new();
    if let Some(refusal) = &c.refusal {
        let mut cls = refusal.clone();
        cls["detail"] = js::or_null(refusal.get("detail"));
        if cls["detail"].is_null() {
            cls["detail"] = json!("");
        }
        match classified(&cls) {
            Some(problem) => found.push(problem),
            None if cls.get("kind").and_then(Value::as_str) != Some("timeout") => {
                let said = text(cls.get("text"));
                found.push(Decision { message: Some(if said.is_empty() { "GitHub said no.".into() } else { said }), cls: Some(cls.clone()), ..decided("error") });
            }
            None => {}
        }
    }
    for raw in c.sync.as_ref().and_then(|sync| sync.get("problems")).and_then(Value::as_array).into_iter().flatten() {
        if let Some(problem) = sync_problem(raw, c) {
            found.push(problem);
        }
    }
    let rank = |id: &str| PROBLEM_RANK.iter().position(|item| *item == id).map_or(-1, |index| index as i64);
    found.sort_by_key(|problem| rank(&problem.id));
    found.into_iter().next()
}

fn decide(c: &Context) -> Decision {
    if c.g.as_ref().and_then(|g| g.get("available")) == Some(&Value::Bool(false)) {
        return decided("folder-missing");
    }
    if let Some(busy) = &c.busy {
        return decided(busy);
    }
    if let Some(problem) = worst_problem(c) {
        return problem;
    }
    if c.outcome.is_some() {
        return decided("success");
    }
    let Some(g) = &c.g else { return decided("unknown") };
    if c.needs_github && c.account_known && c.account_name.is_none() {
        return decided("signed-out");
    }
    if !g.get("isRepo").is_some_and(js::truthy) {
        return decided("not-repo");
    }
    if g.get("unborn").is_some_and(js::truthy) {
        return decided("no-commits");
    }
    match c.remote_kind {
        "none" => return decided("no-remote"),
        "other" => return decided("other-remote"),
        _ => {}
    }
    let (ahead, behind) = (c.ahead > 0.0, c.behind > 0.0);
    if c.on_default && c.upstream.is_none() {
        return decided("no-upstream");
    }
    if c.on_default && ahead && behind {
        return decided("diverged");
    }
    if c.on_default && behind {
        return decided(if c.agents { "agents-working" } else { "behind" });
    }
    if !c.on_default {
        return decided("other-branch");
    }
    if ahead {
        return decided("ahead");
    }
    if c.dirty > 0.0 {
        return decided("uncommitted");
    }
    decided("in-sync")
}

/// scripts/sync.mjs lostWorkText, as git-link words one lost-work finding.
fn lost_work_sentence(finding: &Value, blocked: bool) -> String {
    let files: Vec<String> = finding.get("files").and_then(Value::as_array).map(|files| files.iter().map(|file| text(file.get("path"))).filter(|path| !path.is_empty()).collect()).unwrap_or_default();
    let counted = count(finding.get("count"));
    let total = if counted > 0.0 { counted } else { files.len() as f64 };
    let named: Vec<String> = files.iter().take(3).cloned().collect();
    let more = total - named.len() as f64;
    let merge = js::slice(&text(finding.get("merge")), 0, Some(7));
    let subject = Some(text(finding.get("subject"))).filter(|subject| !subject.is_empty()).unwrap_or_else(|| "no subject".into());
    format!(
        "{}Merge {merge} ({subject}) left out {} of {} another branch changed ({}{}). Restore them, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message.",
        if blocked { "Nothing was pushed. " } else { "" },
        plural(count(finding.get("lines")), "line"),
        plural(total, "file"),
        named.join(", "),
        if more > 0.0 { format!(" and {} more", js::number_string(more)) } else { String::new() },
    )
}

fn action(spec: Option<(&str, &str)>, vars: &Map<String, Value>) -> Value {
    match spec {
        None => Value::Null,
        Some((id, label)) => json!({ "id": id, "label": fill(label, vars), "confirm": CONFIRM.contains(&id) }),
    }
}

fn details_for(id: &str, c: &Context, decision: &Decision, vars: &Map<String, Value>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |line: String| {
        let value = js::trim(&line).to_string();
        if !value.is_empty() && !out.contains(&value) {
            out.push(value);
        }
    };
    let (ahead, behind, dirty) = (c.ahead, c.behind, c.dirty);
    let m = &c.main;
    match id {
        "ahead" => add(format!("{} on {m} not pushed yet.", plural(ahead, "commit"))),
        "behind" | "agents-working" => add(format!("{} on {m} not pulled yet.", plural(behind, "commit"))),
        _ => {}
    }
    if id == "diverged" {
        add(format!("{} on this PC not on GitHub.", plural(ahead, "commit")));
        add(format!("{} on GitHub not on this PC.", plural(behind, "commit")));
        if dirty == 0.0 {
            add("Both sets of work stay. If the same lines clash, nothing is changed.".into());
        }
    }
    if id == "uncommitted" {
        add("Uncommitted files stay on this PC unless you save them.".into());
    }
    if id == "other-branch" {
        if c.detached {
            add("Start a branch here to save or push this work.".into());
        } else if c.upstream.is_none() {
            add("This branch is not on GitHub yet.".into());
        } else if ahead > 0.0 {
            add(format!("{} on {} not pushed yet.", plural(ahead, "commit"), c.branch.clone().unwrap_or_else(|| "null".into())));
        }
    }
    if id == "no-remote" {
        add("You choose the name and who can see it next. Private is the default.".into());
    }
    if id == "signed-out" {
        add("You sign in on GitHub's own page. Studio never asks for your password.".into());
    }
    let detail = decision.detail.clone().unwrap_or_default();
    if id == "offline" && !detail.is_empty() {
        add(format!("Could not reach GitHub: {detail}"));
    }
    if id == "check-failed" && !detail.is_empty() {
        add(format!("npm run check: {detail}"));
    }
    let unnamed = decision.cls.as_ref().is_none_or(|cls| cls.get("kind").and_then(Value::as_str) == Some("unknown"));
    if id == "push-refused" && !detail.is_empty() && unnamed {
        add(format!("GitHub refused the push: {detail}"));
    }
    if id == "lost-work" {
        for finding in decision.findings.iter().skip(1) {
            add(lost_work_sentence(finding, false));
        }
    }
    let var = |key: &str| vars.get(key).map(js::string).unwrap_or_default();
    if id == "pushing" {
        add("Checking nothing was left out".into());
        add("Running the project's check".into());
        add(format!("Uploading {}", var("ahead")));
    }
    if id == "publishing" {
        add("Saving a first commit".into());
        add(format!("Creating {}", var("repo")));
        add("Uploading".into());
    }
    if id == "success" && c.outcome.as_ref().and_then(|outcome| outcome.get("kind")).and_then(Value::as_str) == Some("published") {
        let public = c.outcome.as_ref().and_then(|outcome| outcome.get("visibility")).and_then(Value::as_str) == Some("public");
        add(if public { "Public. Anyone on GitHub can see it." } else { "Private. Only you can see it." }.into());
    }
    let working = BUSY.contains(&id);
    if dirty > 0.0 && !["uncommitted", "saving", "folder-missing"].contains(&id) && !working {
        add(format!("{} in this checkout.", plural(dirty, "uncommitted file")));
    }
    for item in c.sync.as_ref().and_then(|sync| sync.get("pending")).and_then(Value::as_array).into_iter().flatten() {
        if item.get("kind").and_then(Value::as_str).is_some_and(|kind| PENDING_LINES.contains(&kind)) {
            add(scrub(&text(item.get("text"))));
        }
    }
    if out.len() > DETAIL_CAP {
        let rest = out.len() - DETAIL_CAP + 1;
        out.truncate(DETAIL_CAP - 1);
        out.push(format!("and {rest} more."));
    }
    out
}

fn pending_length(c: &Context) -> usize {
    match c.sync.as_ref().and_then(|sync| sync.get("pending")) {
        Some(Value::Array(items)) => items.len(),
        Some(Value::String(text)) => js::utf16_len(text),
        _ => 0,
    }
}

/// The sentence a value stands for: `String(value)`, nothing for null or undefined.
fn said(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(value) => js::string(value),
    }
}

fn build(decision: &Decision, c: &Context) -> Value {
    let row = state(&decision.id).unwrap_or_else(|| state("unknown").expect("the table has unknown"));
    let id = row.id;
    let (ahead, behind, dirty) = (c.ahead, c.behind, c.dirty);
    let n = match id {
        "ahead" => ahead,
        "behind" => behind,
        "uncommitted" => dirty,
        _ => 0.0,
    };
    let empty = json!({});
    let outcome = c.outcome.as_ref().unwrap_or(&empty);
    let repo = c.remote_repo.clone().or_else(|| Some(text(c.project.get("repo"))).filter(|repo| !repo.is_empty()));
    let mut vars = Map::new();
    vars.insert("m".into(), json!(c.main));
    vars.insert("branch".into(), json!(c.branch.clone().unwrap_or_default()));
    vars.insert("n".into(), js::num(n));
    vars.insert("ahead".into(), json!(if ahead > 0.0 { plural(ahead, "commit") } else { "your commits".into() }));
    vars.insert("behind".into(), json!(if behind > 0.0 { plural(behind, "commit") } else { "new commits".into() }));
    vars.insert("uncommitted".into(), json!(plural(dirty, "uncommitted file")));
    vars.insert("changed".into(), json!(if dirty > 0.0 { plural(dirty, "file") } else { "your files".into() }));
    vars.insert("repo".into(), json!(repo.clone().unwrap_or_else(|| "the GitHub project".into())));
    vars.insert("detail".into(), json!(decision.detail.clone().unwrap_or_default()));
    vars.insert("message".into(), json!(decision.message.clone().unwrap_or_default()));
    vars.insert("where".into(), json!(if c.detached { "a detached HEAD".to_string() } else { format!("branch {}", c.branch.clone().unwrap_or_else(|| "HEAD".into())) }));
    vars.insert("commits".into(), json!(plural(count(outcome.get("commits")), "commit")));
    vars.insert("what".into(), json!(match &decision.label {
        Some(label) if js::truthy(label) => article(&js::string(label)),
        _ => "a secret".into(),
    }));
    vars.insert("file".into(), json!(Some(text(decision.file.as_ref())).filter(|file| !file.is_empty()).unwrap_or_else(|| "a file".into())));
    vars.insert("mb".into(), decision.mb.clone().filter(|mb| !mb.is_null()).unwrap_or(json!("")));
    vars.insert("names".into(), json!(Some(decision.files.iter().take(3).cloned().collect::<Vec<_>>().join(", ")).filter(|names| !names.is_empty()).unwrap_or_else(|| "the same lines".into())));

    let mut label = row.label;
    if id == "uncommitted" && dirty == 1.0 {
        label = row.label_one.unwrap_or(label);
    }
    let label = if id == "other-branch" && c.detached { "Not on a branch".to_string() } else { fill(label, &vars) };

    let cls = decision.cls.as_ref();
    let cls_text = || said(cls.and_then(|cls| cls.get("text")));
    let cls_kind = cls.and_then(|cls| cls.get("kind")).and_then(Value::as_str);
    let sentence = if id == "diverged" && dirty > 0.0 {
        fill(row.dirty_sentence.unwrap_or(row.sentence), &vars)
    } else if id == "offline" {
        let own = cls.and_then(|cls| cls.get("text")).is_some_and(js::truthy) && cls_kind == Some("offline");
        let base = if own { cls_text() } else if pending_length(c) > 0 || dirty > 0.0 || ahead > 0.0 { row.sentence.to_string() } else { row.clean_sentence.unwrap_or(row.sentence).to_string() };
        fill(&base, &vars)
    } else if id == "success" {
        let mut more = vars.clone();
        more.insert("changed".into(), json!(plural(count(outcome.get("files")), "file")));
        let repo_text = text(outcome.get("repo"));
        if !repo_text.is_empty() {
            more.insert("repo".into(), json!(repo_text));
        }
        fill(outcome.get("kind").and_then(Value::as_str).and_then(outcome_sentence).unwrap_or(row.sentence), &more)
    } else if id == "lost-work" {
        match decision.detail.clone().filter(|detail| !detail.is_empty()) {
            Some(detail) => detail,
            None => match decision.findings.first() {
                Some(finding) => lost_work_sentence(finding, true),
                None => "Nothing was pushed. A merge left out work another branch changed. Restore it, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message.".into(),
            },
        }
    } else if id == "push-refused" {
        if cls.is_some() && cls_kind != Some("unknown") {
            cls_text()
        } else if decision.detail.as_ref().is_some_and(|detail| !detail.is_empty()) {
            fill(row.sentence, &vars)
        } else {
            "GitHub refused the push.".into()
        }
    } else if id == "fetch-failed" && cls.is_some() {
        cls_text()
    } else if id == "blocked-secret" || id == "too-large" {
        let own = cls_text();
        if cls.and_then(|cls| cls.get("text")).is_some_and(js::truthy) { own } else { fill(row.sentence, &vars) }
    } else if id == "error" && decision.message.as_ref().is_none_or(|message| message.is_empty()) {
        "Sync could not run.".into()
    } else if id == "folder-missing" || id == "unknown" {
        row.sentence.into()
    } else {
        fill(row.sentence, &vars)
    };

    let short = if ["ahead", "behind", "uncommitted"].contains(&id) && n > 0.0 { js::number_string(n) } else { String::new() };
    let mut model = json!({
        "id": id, "label": label, "short": short, "tone": row.tone, "glyph": id, "sentence": scrub(&sentence),
        "details": details_for(id, c, decision, &vars),
        "branch": if c.detached { Value::Null } else { c.branch.clone().map_or(Value::Null, Value::String) },
        "repo": repo.map_or(Value::Null, Value::String), "checkedAt": c.checked_at,
        "counts": { "ahead": js::num(ahead), "behind": js::num(behind), "dirty": js::num(dirty) },
        "primary": action(row.primary, &vars), "secondary": action(row.secondary, &vars),
        "busy": if BUSY.contains(&id) { json!(id) } else { Value::Null },
    });
    refine(&mut model, c, decision, &vars);
    model
}

fn with(base: &Value, more: Value) -> Value {
    let mut out = base.as_object().cloned().unwrap_or_default();
    for (key, value) in more.as_object().into_iter().flatten() {
        out.insert(key.clone(), value.clone());
    }
    Value::Object(out)
}

/// The moves that depend on more than the state's own row.
fn refine(model: &mut Value, c: &Context, decision: &Decision, vars: &Map<String, Value>) {
    let id = model["id"].as_str().unwrap_or("").to_string();
    let dirty = c.dirty;
    let primary = model["primary"].clone();
    match id.as_str() {
        "signed-out" if !c.account_gh => {
            model["primary"] = json!({ "id": "install-gh", "label": "Install GitHub CLI", "confirm": false });
            model["sentence"] = json!("GitHub CLI is not installed on this PC.");
        }
        "no-remote" if c.project.get("weakDrive") == Some(&Value::Bool(true)) => {
            model["primary"] = with(&primary, json!({ "disabled": true, "why": "This drive cannot keep a Git project reliably. Move the project to an NTFS drive first." }));
        }
        "diverged" => {
            model["primary"] = if dirty > 0.0 { json!({ "id": "save", "label": "Save my changes", "confirm": false }) } else { with(&primary, json!({ "confirm": true })) };
        }
        "other-branch" => {
            model["primary"] = if c.detached {
                json!({ "id": "start-branch", "label": "Start a branch here", "confirm": false })
            } else if c.upstream.is_none() || c.ahead > 0.0 {
                with(&primary, json!({ "confirm": true }))
            } else {
                with(&primary, json!({ "confirm": true, "disabled": true, "why": "Nothing on this branch is waiting to be pushed." }))
            };
        }
        "offline" => {
            if dirty == 0.0 {
                model["secondary"] = Value::Null;
            }
        }
        "pull-refused" => {
            if dirty == 0.0 {
                model["primary"] = json!({ "id": "pull", "label": "Try again", "confirm": false });
            }
        }
        "push-refused" if decision.cls.is_some() => {
            let fix = decision.cls.as_ref().and_then(|cls| cls.get("fix")).and_then(Value::as_str);
            match fix {
                Some("pull") => model["primary"] = json!({ "id": "pull", "label": "Pull, then push", "confirm": false }),
                Some("sign-in") => model["primary"] = json!({ "id": "sign-in", "label": "Sign in again", "confirm": false }),
                Some("add-permission") => model["primary"] = json!({ "id": "add-permission", "label": "Add permission", "confirm": false }),
                Some("push-branch") => model["primary"] = json!({ "id": "push-branch", "label": "Push a branch", "confirm": true }),
                _ => {}
            }
        }
        "success" => {
            let saved = c.outcome.as_ref().and_then(|outcome| outcome.get("kind")).and_then(Value::as_str) == Some("saved");
            if c.remote_kind != "github" || saved {
                model["primary"] = Value::Null;
            }
        }
        _ => {}
    }
    // Push never commits silently: with files to save, the primary is the dialog that shows them.
    if dirty > 0.0 && ["ahead", "no-upstream", "other-branch"].contains(&id.as_str()) && model["primary"].get("id").and_then(Value::as_str) == Some("push") {
        let label = if id == "ahead" { format!("Push {} only", vars.get("ahead").map(js::string).unwrap_or_default()) } else { "Push without saving".into() };
        model["secondary"] = json!({ "id": "push", "label": label, "confirm": true });
        model["primary"] = json!({ "id": "save-and-push", "label": format!("Save and push {}", plural(dirty, "file")), "confirm": false });
    }
}

/// The chip model for one project.
pub fn describe(input: &Value) -> Value {
    let c = context(input);
    build(&decide(&c), &c)
}

/// What a launch row carries: the chip, or nothing when nothing was read.
pub fn chip(model: &Value) -> Value {
    match model.get("id").and_then(Value::as_str) {
        None | Some("unknown") => Value::Null,
        Some(_) => json!({ "id": model["id"], "label": model["label"], "tone": model["tone"], "glyph": model["glyph"], "sentence": model["sentence"] }),
    }
}
