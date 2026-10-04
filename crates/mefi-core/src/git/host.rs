//! The Git chip's host layer (scripts/git-host.cjs createGitHost): between
//! main.cjs's git:* handlers and the actions under it, which run here in
//! Rust. It captures the open project once per call and refuses a call for
//! another one; runs pull, push, rebase, save, publish and link one at a time
//! in the order asked, with the chip saying what runs; sends the default
//! branch with an upstream through the engine's sync (its check, lost-work
//! guard and heartbeat) and anything else through push_branch with the
//! project's check; and keeps per project the last sync result, the refusal
//! or failed check still standing, and the outcome of the last action (6 s).
//!
//! The engine's `context`, `listProjects`, `syncProject`, `projectCheck` /
//! `runCheck`, `pcRepos`, `isListed` and `send` are called back; `actions`
//! holds the Git actions' own collaborators. The "Done" state's expiry is
//! the engine's timer: a writer whose answer carries `__settle` asks for
//! `settle` again a moment after 6 s. Every string that leaves is scrubbed.

use std::cell::OnceCell;
use std::collections::{HashMap, HashSet};
use std::sync::{Condvar, Mutex, OnceLock};

use serde_json::{json, Value};

use super::actions::{self, Ctx};
use super::describe::{self, chip, describe};
use super::rules::{classify_push, scrub};
use crate::callbacks::{invoke, is_function, Callbacks};
use crate::js;

const OUTCOME_MS: f64 = 6000.0;
const PATH_CAP: usize = 5000;
const PROJECT_CAP: usize = 500;
const NO_PROJECT: &str = "Open a project first.";
const CHANGED: &str = "The selected project changed. Try again in its intended project.";
const BUILDERS: &str = "Agents are still changing files in this project. Pull now anyway?";
const SYNC_FAILED: &str = "Sync could not run.";

type Result<T> = std::result::Result<T, String>;

fn is_object(value: &Value) -> bool {
    value.is_object()
}

fn str_of(value: Option<&Value>, cap: isize) -> String {
    value.and_then(Value::as_str).map(|text| js::slice(text, 0, Some(cap))).unwrap_or_default()
}

fn count(value: Option<&Value>) -> f64 {
    value.and_then(Value::as_f64).filter(|n| n.is_finite() && *n > 0.0).map_or(0.0, f64::floor)
}

/// Two spellings of one folder are one key.
pub fn key_of(folder: &str) -> String {
    let resolved = crate::paths::resolve(folder);
    let trimmed = resolved.trim_end_matches(['/', '\\']).to_string();
    if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed
    }
}

/// Whether a sync result could be about this folder: the same one, or the repository around it.
fn related(a: &str, b: &str) -> bool {
    let (a, b) = (key_of(a), key_of(b));
    if a == b {
        return true;
    }
    let inside = |child: &str, parent: &str| child.starts_with(parent) && child[parent.len()..].starts_with(['/', '\\']);
    inside(&a, &b) || inside(&b, &a)
}

/// Every string in a result that leaves is scrubbed; too deep to vouch for is dropped.
fn clean(value: &Value, depth: usize) -> Value {
    match value {
        Value::String(text) => Value::String(scrub(text)),
        Value::Array(_) | Value::Object(_) if depth > 6 => Value::Null,
        Value::Array(items) => Value::Array(items.iter().map(|item| clean(item, depth + 1)).collect()),
        Value::Object(map) => Value::Object(map.iter().map(|(key, item)| (key.clone(), clean(item, depth + 1))).collect()),
        other => other.clone(),
    }
}

fn say(error: &str) -> String {
    let said = scrub(error);
    if said.is_empty() {
        SYNC_FAILED.into()
    } else {
        said
    }
}

fn failed(error: &str, extra: Value) -> Value {
    let mut out = json!({ "ok": false, "error": say(error) });
    for (key, value) in extra.as_object().into_iter().flatten() {
        out[key] = value.clone();
    }
    out
}

// ---- what is remembered ----

#[derive(Default)]
struct Entry {
    sync: Value,
    checked_at: Value,
    refusal: Value,
    problem: Value,
    outcome: Value,
    /// Which outcome this is: settle refreshes only the one it was asked for.
    outcome_seq: u64,
}

#[derive(Default)]
struct Shared {
    entries: HashMap<String, Entry>,
    /// The account as last asked: None = never asked (never "signed out").
    who: Option<(Option<String>, bool)>,
    busy: Option<(String, String)>,
    checking: HashMap<String, usize>,
    last: Value,
    epoch: u64,
    seq: u64,
}

impl Shared {
    fn entry(&mut self, root: &str) -> &mut Entry {
        self.entries.entry(key_of(root)).or_default()
    }

    fn set_outcome(&mut self, root: &str, outcome: Value) {
        self.seq += 1;
        let seq = self.seq;
        let entry = self.entry(root);
        entry.outcome = outcome;
        entry.outcome_seq = seq;
    }

    fn who_json(&self) -> Option<Value> {
        self.who.as_ref().map(|(account, gh)| json!({ "account": account, "ghInstalled": gh }))
    }
}

fn shared() -> &'static Mutex<Shared> {
    static SHARED: OnceLock<Mutex<Shared>> = OnceLock::new();
    SHARED.get_or_init(|| Mutex::new(Shared::default()))
}

fn with_shared<T>(task: impl FnOnce(&mut Shared) -> T) -> T {
    task(&mut shared().lock().unwrap_or_else(|poison| poison.into_inner()))
}

/// One writer at a time, in the order asked.
fn tickets() -> &'static (Mutex<(u64, u64)>, Condvar) {
    static TICKETS: OnceLock<(Mutex<(u64, u64)>, Condvar)> = OnceLock::new();
    TICKETS.get_or_init(|| (Mutex::new((0, 0)), Condvar::new()))
}

struct Turn;

impl Turn {
    fn take() -> Turn {
        let (lock, wake) = tickets();
        let mut held = lock.lock().unwrap_or_else(|poison| poison.into_inner());
        let mine = held.0;
        held.0 += 1;
        while held.1 != mine {
            held = wake.wait(held).unwrap_or_else(|poison| poison.into_inner());
        }
        Turn
    }
}

impl Drop for Turn {
    fn drop(&mut self) {
        let (lock, wake) = tickets();
        lock.lock().unwrap_or_else(|poison| poison.into_inner()).1 += 1;
        wake.notify_all();
    }
}

/// The open project, as captured for one call.
#[derive(Clone)]
struct Open {
    root: String,
    project_id: Value,
    builders: bool,
    epoch: u64,
}

struct Verdict {
    ok: bool,
    errored: bool,
    error: String,
    refusal: Option<Value>,
}

struct Host<'a> {
    collaborators: &'a Value,
    callbacks: &'a dyn Callbacks,
    actions: OnceCell<Ctx<'a>>,
}

impl<'a> Host<'a> {
    fn new(collaborators: &'a Value, callbacks: &'a dyn Callbacks) -> Host<'a> {
        Host { collaborators, callbacks, actions: OnceCell::new() }
    }

    fn actions(&self) -> &Ctx<'a> {
        self.actions.get_or_init(|| Ctx::new(self.collaborators.get("actions").unwrap_or(&Value::Null), self.callbacks))
    }

    fn handle(&self, name: &str) -> Option<&'a Value> {
        self.collaborators.get(name).filter(|handle| is_function(handle))
    }

    fn call(&self, name: &str, args: Vec<Value>) -> Result<Value> {
        match self.handle(name) {
            Some(handle) => invoke(self.callbacks, handle, args),
            None => Err(format!("{name} is not available")),
        }
    }

    fn clock(&self) -> f64 {
        self.handle("now").and_then(|handle| invoke(self.callbacks, handle, vec![]).ok()).and_then(|value| value.as_f64()).unwrap_or_else(js::now_ms)
    }

    // ---- which project ----

    fn read(&self) -> Option<Open> {
        let raw = self.call("context", vec![]).ok()?;
        let root = raw.get("root").and_then(Value::as_str).filter(|root| !root.is_empty())?.to_string();
        Some(Open { root, project_id: js::or_null(raw.get("projectId")), builders: raw.get("builders") == Some(&Value::Bool(true)), epoch: with_shared(|shared| shared.epoch) })
    }

    fn bind(&self, o: &Value) -> std::result::Result<Open, Value> {
        let Some(ctx) = self.read() else { return Err(json!({ "ok": false, "error": NO_PROJECT })) };
        if let Some(wanted) = o.as_object().and_then(|o| o.get("projectId")) {
            if !wanted.is_null() && wanted != &json!("") && wanted != &ctx.project_id {
                return Err(json!({ "ok": false, "error": CHANGED }));
            }
        }
        Ok(ctx)
    }

    // ---- the chip model ----

    fn build(&self, ctx: &Open) -> Value {
        let key = key_of(&ctx.root);
        let now = self.clock();
        with_shared(|shared| {
            let entry = shared.entry(&ctx.root);
            if !entry.outcome.is_null() {
                let age = now - entry.outcome.get("at").and_then(Value::as_f64).unwrap_or(f64::NAN);
                if !(age >= 0.0 && age < OUTCOME_MS) {
                    entry.outcome = Value::Null;
                }
            }
        });
        let glance = self.actions().glance(&json!(ctx.root), 0);
        let input = with_shared(|shared| {
            let running = match &shared.busy {
                Some((kind, busy_key)) if *busy_key == key => json!(kind),
                _ if shared.checking.get(&key).is_some_and(|n| *n > 0) => json!("checking"),
                _ => Value::Null,
            };
            let who = shared.who_json();
            let entry = shared.entry(&ctx.root);
            let sync = if entry.problem.is_null() {
                entry.sync.clone()
            } else {
                let mut sync = entry.sync.as_object().cloned().unwrap_or_default();
                let mut problems = entry.sync.get("problems").and_then(Value::as_array).cloned().unwrap_or_default();
                problems.push(entry.problem.clone());
                sync.insert("problems".into(), Value::Array(problems));
                Value::Object(sync)
            };
            let mut input = json!({
                "glance": glance, "sync": sync, "busy": running, "outcome": entry.outcome, "refusal": entry.refusal,
                "checkedAt": entry.checked_at, "agentsBuilding": ctx.builders, "project": {},
            });
            if let Some(who) = who {
                input["account"] = who;
            }
            input
        });
        let mut model = clean(&describe(&input), 0);
        model["projectId"] = if ctx.project_id.is_string() { ctx.project_id.clone() } else { Value::Null };
        model
    }

    fn emit(&self, model: &Value, ctx: &Open) {
        let current = with_shared(|shared| {
            if ctx.epoch != shared.epoch {
                return false;
            }
            shared.last = model.clone();
            true
        });
        if current {
            let _ = self.call("send", vec![json!("git:state"), model.clone()]);
        }
    }

    fn refresh(&self, ctx: &Open) -> Value {
        let model = self.build(ctx);
        self.emit(&model, ctx);
        model
    }

    /// What `settle` needs to bring the model back once the outcome has had its 6 s.
    fn settle_token(&self, ctx: &Open) -> Option<Value> {
        with_shared(|shared| {
            let entry = shared.entry(&ctx.root);
            (!entry.outcome.is_null()).then(|| json!({ "epoch": ctx.epoch, "key": key_of(&ctx.root), "projectId": ctx.project_id, "seq": entry.outcome_seq }))
        })
    }

    // ---- one writer at a time ----

    fn writer(&self, kind: &str, ctx: &Open, task: impl FnOnce(&dyn Fn(&str)) -> Result<Value>) -> Value {
        let _turn = Turn::take();
        let key = key_of(&ctx.root);
        with_shared(|shared| {
            let entry = shared.entry(&ctx.root);
            entry.refusal = Value::Null;
            entry.problem = Value::Null;
            entry.outcome = Value::Null;
            shared.busy = Some((kind.into(), key.clone()));
        });
        self.refresh(ctx);
        let phase = |next: &str| {
            with_shared(|shared| shared.busy = Some((next.into(), key.clone())));
            self.refresh(ctx);
        };
        let result = task(&phase).unwrap_or_else(|error| failed(&error, json!({})));
        with_shared(|shared| shared.busy = None);
        let mut result = if is_object(&result) { result } else { failed(SYNC_FAILED, json!({})) };
        result["model"] = self.refresh(ctx);
        if let Some(token) = self.settle_token(ctx) {
            result["__settle"] = token;
        }
        result
    }

    // ---- talking to sync ----

    fn store(&self, ctx: &Open, result: &Value) {
        if !is_object(result) {
            return;
        }
        if let Some(root) = result.get("state").and_then(|state| state.get("root")).and_then(Value::as_str) {
            if !related(root, &ctx.root) {
                return;
            }
        }
        let now = self.clock();
        with_shared(|shared| {
            let entry = shared.entry(&ctx.root);
            entry.sync = result.clone();
            entry.checked_at = result.get("checkedAt").filter(|at| at.as_f64().is_some_and(f64::is_finite)).cloned().unwrap_or_else(|| js::num(now));
        });
    }

    fn still_open(&self, ctx: &Open) -> bool {
        self.read().is_some_and(|now| key_of(&now.root) == key_of(&ctx.root) && now.project_id == ctx.project_id)
    }

    /// syncProject works on whichever project is open: an answer for another one is refused.
    fn call_sync(&self, ctx: &Open, args: Vec<Value>) -> std::result::Result<Value, String> {
        if !self.still_open(ctx) {
            return Err(CHANGED.into());
        }
        let result = self.call("syncProject", args).map_err(|error| say(&error))?;
        self.store(ctx, &result);
        Ok(result)
    }

    fn judge(&self, answer: &std::result::Result<Value, String>) -> Verdict {
        let result = match answer {
            Err(threw) => return Verdict { ok: false, errored: true, error: threw.clone(), refusal: None },
            Ok(result) if !is_object(result) => return Verdict { ok: false, errored: true, error: SYNC_FAILED.into(), refusal: None },
            Ok(result) => result,
        };
        let problems: Vec<&Value> = result.get("problems").and_then(Value::as_array).into_iter().flatten().filter(|item| is_object(item)).collect();
        if result.get("ok") == Some(&Value::Bool(true)) && problems.is_empty() {
            return Verdict { ok: true, errored: false, error: String::new(), refusal: None };
        }
        let bad = problems.iter().find(|item| item.get("kind").and_then(Value::as_str) == Some("push-refused"));
        let headline = str_of(result.get("headline"), 2000);
        let first = str_of(problems.first().and_then(|item| item.get("detail")), 2000);
        let error = scrub(if !headline.is_empty() { &headline } else if !first.is_empty() { &first } else { SYNC_FAILED });
        let refusal = bad.map(|bad| {
            let mut stderr = str_of(bad.get("stderr"), 4000);
            if stderr.is_empty() {
                stderr = str_of(bad.get("detail"), 4000);
            }
            clean(&classify_push(&stderr, false, ""), 0)
        });
        Verdict { ok: false, errored: problems.iter().any(|item| item.get("kind").and_then(Value::as_str) == Some("error")), error, refusal }
    }

    fn outcome_of(&self, result: &Value) -> Option<Value> {
        let done: Vec<&Value> = result.get("actions").and_then(Value::as_array).into_iter().flatten().filter(|item| is_object(item)).collect();
        for kind in ["pushed", "rebased", "pulled"] {
            if let Some(found) = done.iter().find(|item| item.get("kind").and_then(Value::as_str) == Some(kind)) {
                return Some(json!({ "kind": kind, "commits": js::num(count(found.get("commits"))), "at": js::num(self.clock()) }));
            }
        }
        None
    }

    /// A sync-backed action: run it, remember the answer, set the outcome.
    fn via_sync(&self, ctx: &Open, args: Vec<Value>) -> (Verdict, f64) {
        let answer = self.call_sync(ctx, args);
        let verdict = self.judge(&answer);
        let outcome = answer.as_ref().ok().and_then(|result| self.outcome_of(result));
        if verdict.ok {
            if let Some(outcome) = &outcome {
                with_shared(|shared| shared.set_outcome(&ctx.root, outcome.clone()));
            }
        }
        let commits = outcome.as_ref().and_then(|outcome| outcome["commits"].as_f64()).unwrap_or(0.0);
        (verdict, commits)
    }

    // ---- pushing ----

    fn push_now(&self, ctx: &Open) -> Value {
        let g = self.actions().glance(&json!(ctx.root), 0);
        let g = js::truthy(&g).then_some(g);
        if let Some(g) = &g {
            if g.get("available") == Some(&Value::Bool(false)) {
                return failed(describe::state("folder-missing").map_or("", |row| row.sentence), json!({}));
            }
            if g.get("isRepo") == Some(&Value::Bool(false)) {
                return failed(describe::state("not-repo").map_or("", |row| row.sentence), json!({}));
            }
        }
        let through_sync = match &g {
            Some(g) => g.get("onDefault") == Some(&Value::Bool(true)) && g.get("detached") != Some(&Value::Bool(true)) && !g.get("unborn").is_some_and(js::truthy) && g.get("upstream").is_some_and(js::truthy),
            None => with_shared(|shared| {
                let state = shared.entry(&ctx.root).sync.get("state").cloned().unwrap_or(Value::Null);
                state.get("repo").is_some_and(js::truthy) && state.get("hasUpstream").is_some_and(js::truthy) && state.get("branch") == state.get("main")
            }),
        };
        if through_sync {
            let (verdict, commits) = self.via_sync(ctx, vec![json!(true)]);
            return if verdict.ok { json!({ "ok": true, "commits": js::num(commits) }) } else { failed(&verdict.error, verdict.refusal.map_or(json!({}), |refusal| json!({ "refusal": refusal }))) };
        }
        // A check that cannot be read is not a check that passed: the push waits.
        let mut options = json!({});
        if self.handle("projectCheck").is_some() {
            match self.call("projectCheck", vec![json!(ctx.root)]) {
                Err(error) => {
                    let detail = say(&error);
                    with_shared(|shared| shared.entry(&ctx.root).problem = json!({ "kind": "check-failed", "detail": detail }));
                    return failed(js::trim(&format!("The project's check could not be run, so nothing was pushed. {detail}")), json!({}));
                }
                Ok(found) => {
                    if found.get("present") == Some(&Value::Bool(true)) {
                        if let Some(run) = self.handle("runCheck") {
                            options["check"] = run.clone();
                        }
                    }
                }
            }
        }
        let res = actions::serial(&ctx.root, || self.actions().push_branch(&ctx.root, &options));
        if res.get("ok").is_some_and(js::truthy) {
            let commits = count(res.get("commits"));
            let at = self.clock();
            with_shared(|shared| shared.set_outcome(&ctx.root, json!({ "kind": "pushed", "commits": js::num(commits), "at": js::num(at) })));
            return json!({ "ok": true, "commits": js::num(commits) });
        }
        let refusal = res.get("refusal").filter(|refusal| is_object(refusal)).map(|refusal| clean(refusal, 0));
        with_shared(|shared| {
            let entry = shared.entry(&ctx.root);
            if let Some(refusal) = refusal.as_ref().filter(|refusal| refusal.get("state").is_some_and(Value::is_string)) {
                entry.refusal = refusal.clone();
            }
            if res.get("kind").and_then(Value::as_str) == Some("check-failed") {
                entry.problem = json!({ "kind": "check-failed", "detail": scrub(&str_of(res.get("detail"), 2000)) });
            }
        });
        let error = res.get("error").filter(|error| js::truthy(error)).map(js::string).unwrap_or_else(|| SYNC_FAILED.into());
        failed(&error, refusal.map_or(json!({}), |refusal| json!({ "refusal": refusal })))
    }

    fn identity(&self) -> Value {
        with_shared(|shared| match &shared.who {
            Some((Some(account), _)) => json!({ "name": account, "email": format!("{account}@users.noreply.github.com") }),
            _ => Value::Null,
        })
    }

    fn note_account(&self, account: &Value, gh_installed: bool) -> bool {
        let next = (account.as_str().filter(|name| !name.is_empty()).map(String::from), gh_installed);
        with_shared(|shared| {
            let changed = shared.who.as_ref() != Some(&next);
            shared.who = Some(next);
            changed
        })
    }

    fn refresh_open(&self) {
        if let Some(ctx) = self.read() {
            self.refresh(&ctx);
        }
    }

    // ---- the methods main.cjs calls ----

    fn state(&self, o: &Value) -> Value {
        let ctx = match self.bind(o) {
            Ok(ctx) => ctx,
            Err(failure) => return failure,
        };
        let model = self.build(&ctx);
        with_shared(|shared| {
            if ctx.epoch == shared.epoch {
                shared.last = model.clone();
            }
        });
        json!({ "ok": true, "model": model })
    }

    fn check(&self, o: &Value) -> Value {
        let ctx = match self.bind(o) {
            Ok(ctx) => ctx,
            Err(failure) => return failure,
        };
        let key = key_of(&ctx.root);
        with_shared(|shared| *shared.checking.entry(key.clone()).or_insert(0) += 1);
        self.refresh(&ctx);
        let verdict = self.judge(&self.call_sync(&ctx, vec![json!(false)]));
        with_shared(|shared| {
            let left = shared.checking.get(&key).copied().unwrap_or(1).saturating_sub(1);
            if left > 0 {
                shared.checking.insert(key.clone(), left);
            } else {
                shared.checking.remove(&key);
            }
        });
        let model = self.refresh(&ctx);
        // Offline, a lapsed sign-in and a divergence are states the chip shows; only a sync that could not run is an error.
        if verdict.errored {
            json!({ "ok": false, "error": verdict.error, "model": model })
        } else {
            json!({ "ok": true, "model": model })
        }
    }

    fn pull(&self, o: &Value) -> Value {
        let ctx = match self.bind(o) {
            Ok(ctx) => ctx,
            Err(failure) => return failure,
        };
        let anyway = o.get("anyway") == Some(&Value::Bool(true));
        if ctx.builders && !anyway {
            return json!({ "ok": false, "needsConfirm": "builders", "error": BUILDERS, "model": self.refresh(&ctx) });
        }
        self.writer("pulling", &ctx, |_| {
            // Agents may have started while this waited its turn: the question is asked again then.
            if !anyway {
                if let Some(now) = self.read() {
                    if now.builders && key_of(&now.root) == key_of(&ctx.root) {
                        return Ok(json!({ "ok": false, "needsConfirm": "builders", "error": BUILDERS }));
                    }
                }
            }
            let (verdict, _) = self.via_sync(&ctx, vec![json!(false), json!({ "pullOnly": true })]);
            Ok(if verdict.ok { json!({ "ok": true }) } else { failed(&verdict.error, json!({})) })
        })
    }

    fn push(&self, o: &Value) -> Value {
        let ctx = match self.bind(o) {
            Ok(ctx) => ctx,
            Err(failure) => return failure,
        };
        self.writer("pushing", &ctx, |_| {
            let pushed = self.push_now(&ctx);
            Ok(if pushed["ok"] == json!(true) { json!({ "ok": true }) } else { failed(&js::string(&pushed["error"]), pushed.get("refusal").map_or(json!({}), |refusal| json!({ "refusal": refusal }))) })
        })
    }

    fn rebase(&self, o: &Value) -> Value {
        let ctx = match self.bind(o) {
            Ok(ctx) => ctx,
            Err(failure) => return failure,
        };
        self.writer("pushing", &ctx, |_| {
            let (verdict, _) = self.via_sync(&ctx, vec![json!(true), json!({ "rebase": true })]);
            Ok(if verdict.ok { json!({ "ok": true }) } else { failed(&verdict.error, json!({})) })
        })
    }

    fn save_preview(&self, o: &Value) -> Value {
        let ctx = match self.bind(o) {
            Ok(ctx) => ctx,
            Err(failure) => return failure,
        };
        clean(&self.actions().preview(&ctx.root, &json!({ "builders": ctx.builders, "identity": self.identity() })), 0)
    }

    fn save(&self, o: &Value) -> Value {
        let ctx = match self.bind(o) {
            Ok(ctx) => ctx,
            Err(failure) => return failure,
        };
        let paths: Vec<Value> = o.get("paths").and_then(Value::as_array).into_iter().flatten().filter(|item| item.as_str().is_some_and(|path| !path.is_empty())).take(PATH_CAP).cloned().collect();
        self.writer("saving", &ctx, |phase| {
            let options = json!({
                "paths": paths, "message": str_of(o.get("message"), 5000), "builders": ctx.builders,
                "ignoreBuilders": o.get("ignoreBuilders") == Some(&Value::Bool(true)), "identity": self.identity(),
            });
            let res = actions::serial(&ctx.root, || self.actions().save(&ctx.root, &options));
            if !res.get("ok").is_some_and(js::truthy) {
                let refusal = res.get("refusal").filter(|refusal| is_object(refusal)).map(|refusal| clean(refusal, 0));
                if let Some(refusal) = refusal.as_ref().filter(|refusal| refusal.get("state").is_some_and(Value::is_string)) {
                    with_shared(|shared| shared.entry(&ctx.root).refusal = refusal.clone());
                }
                let mut extra = json!({});
                if let Some(kind) = res.get("kind").filter(|kind| js::truthy(kind)) {
                    extra["kind"] = kind.clone();
                }
                if let Some(blocked) = res.get("blocked").filter(|blocked| is_object(blocked)) {
                    extra["blocked"] = clean(blocked, 0);
                }
                if let Some(refusal) = refusal {
                    extra["refusal"] = refusal;
                }
                let error = res.get("error").filter(|error| js::truthy(error)).map(js::string).unwrap_or_else(|| "Could not save.".into());
                return Ok(failed(&error, extra));
            }
            let saved = json!({ "ok": true, "sha": js::or_null(res.get("sha")), "files": js::or_null(res.get("files")) });
            let files = count(res.get("files"));
            let at = self.clock();
            with_shared(|shared| shared.set_outcome(&ctx.root, json!({ "kind": "saved", "files": js::num(files), "at": js::num(at) })));
            if o.get("push") != Some(&Value::Bool(true)) {
                return Ok(saved);
            }
            phase("pushing");
            let pushed = self.push_now(&ctx);
            // The save landed: it stays ok, and `pushed: false` (with why) is what the dialog shows.
            let mut answer = saved;
            if pushed["ok"] != json!(true) {
                answer["pushed"] = json!(false);
                answer["error"] = pushed["error"].clone();
                if let Some(refusal) = pushed.get("refusal") {
                    answer["refusal"] = refusal.clone();
                }
                return Ok(answer);
            }
            with_shared(|shared| {
                let entry = shared.entry(&ctx.root);
                if !entry.outcome.is_null() {
                    entry.outcome["files"] = js::num(files);
                }
            });
            answer["pushed"] = json!(true);
            Ok(answer)
        })
    }

    fn owners(&self) -> Value {
        let res = clean(&self.actions().owners(), 0);
        let changed = if res.get("ok").is_some_and(js::truthy) {
            self.note_account(res.get("account").unwrap_or(&Value::Null), true)
        } else {
            match res.get("kind").and_then(Value::as_str) {
                Some("not-signed-in") => self.note_account(&Value::Null, true),
                Some("gh-missing") => self.note_account(&Value::Null, false),
                _ => false,
            }
        };
        if changed {
            self.refresh_open();
        }
        res
    }

    fn account(&self) -> Value {
        let res = clean(&self.actions().account(), 0);
        let ok = res.get("ok") != Some(&Value::Bool(false));
        if ok && self.note_account(res.get("account").unwrap_or(&Value::Null), res.get("ghInstalled") != Some(&Value::Bool(false))) {
            self.refresh_open();
        }
        json!({
            "ok": ok, "account": res.get("account").filter(|name| name.as_str().is_some_and(|name| !name.is_empty())).cloned().unwrap_or(Value::Null),
            "ghInstalled": res.get("ghInstalled") != Some(&Value::Bool(false)), "gitInstalled": res.get("gitInstalled") != Some(&Value::Bool(false)),
        })
    }

    fn publish_preview(&self, o: &Value) -> Value {
        let ctx = match self.bind(o) {
            Ok(ctx) => ctx,
            Err(failure) => return failure,
        };
        let license = Some(str_of(o.get("license"), 40)).filter(|license| !license.is_empty()).unwrap_or_else(|| "none".into());
        let options = json!({ "owner": str_of(o.get("owner"), 100), "name": str_of(o.get("name"), 200), "gitignore": o.get("gitignore") != Some(&Value::Bool(false)), "license": license });
        let mut res = clean(&self.actions().publish_preview(&ctx.root, &options), 0);
        if res.get("ok").is_some_and(js::truthy) {
            if let Some(Value::Bool(gh)) = res.get("ghInstalled") {
                if self.note_account(res.get("account").unwrap_or(&Value::Null), *gh) {
                    self.refresh(&ctx);
                }
            }
        }
        // The Publish dialog reads the name's own complaint as `issue`.
        if let Some(issue) = res.get("nameIssue").and_then(Value::as_str).filter(|issue| !issue.is_empty()).map(String::from) {
            if is_object(&res) && !res.get("issue").is_some_and(Value::is_string) {
                res["issue"] = json!(issue);
            }
        }
        res
    }

    fn publish(&self, o: &Value) -> Value {
        let ctx = match self.bind(o) {
            Ok(ctx) => ctx,
            Err(failure) => return failure,
        };
        self.writer("publishing", &ctx, |_| {
            let license = Some(str_of(o.get("license"), 40)).filter(|license| !license.is_empty()).unwrap_or_else(|| "none".into());
            let options = json!({
                "owner": str_of(o.get("owner"), 100), "name": str_of(o.get("name"), 200),
                "visibility": if o.get("visibility").and_then(Value::as_str) == Some("public") { "public" } else { "private" },
                "description": str_of(o.get("description"), 350), "gitignore": o.get("gitignore") != Some(&Value::Bool(false)), "license": license,
                "confirmPublic": str_of(o.get("confirmPublic"), 300), "identity": self.identity(),
            });
            let res = clean(&actions::serial(&ctx.root, || self.actions().publish(&ctx.root, &options)), 0);
            let steps = res.get("steps").filter(|steps| steps.is_array()).cloned().unwrap_or_else(|| json!([]));
            if !res.get("ok").is_some_and(js::truthy) {
                match res.get("kind").and_then(Value::as_str) {
                    Some("not-signed-in") => {
                        self.note_account(&Value::Null, true);
                    }
                    Some("gh-missing") => {
                        self.note_account(&Value::Null, false);
                    }
                    _ => {}
                }
                let mut answer = if is_object(&res) { res.clone() } else { json!({}) };
                let error = res.get("error").filter(|error| js::truthy(error)).map(js::string).unwrap_or_else(|| "Could not publish.".into());
                answer["ok"] = json!(false);
                answer["error"] = json!(say(&error));
                answer["steps"] = steps;
                return Ok(answer);
            }
            let at = self.clock();
            let outcome = json!({
                "kind": "published", "repo": str_of(res.get("repo"), 200),
                "visibility": if res.get("visibility").and_then(Value::as_str) == Some("public") { "public" } else { "private" }, "at": js::num(at),
            });
            with_shared(|shared| {
                let entry = shared.entry(&ctx.root);
                entry.sync = Value::Null;
                entry.checked_at = Value::Null;
                shared.set_outcome(&ctx.root, outcome);
            });
            let mut answer = res;
            answer["ok"] = json!(true);
            answer["steps"] = steps;
            Ok(answer)
        })
    }

    fn link_repos(&self) -> Value {
        match self.call("pcRepos", vec![]) {
            Ok(res) if is_object(&res) => clean(&res, 0),
            Ok(_) => failed("Could not list your GitHub repositories.", json!({})),
            Err(error) => failed(&error, json!({})),
        }
    }

    fn link(&self, o: &Value) -> Value {
        let ctx = match self.bind(o) {
            Ok(ctx) => ctx,
            Err(failure) => return failure,
        };
        let repo = str_of(o.get("repo"), 200);
        self.writer("checking", &ctx, |_| {
            let mut options = json!({ "repo": repo });
            if let Some(listed) = self.handle("isListed") {
                options["isListed"] = listed.clone();
            }
            let res = clean(&actions::serial(&ctx.root, || self.actions().link(&ctx.root, &options)), 0);
            let mut answer = if is_object(&res) { res.clone() } else { json!({}) };
            if !res.get("ok").is_some_and(js::truthy) {
                let error = res.get("error").filter(|error| js::truthy(error)).map(js::string).unwrap_or_else(|| "Could not link this folder.".into());
                answer["ok"] = json!(false);
                answer["error"] = json!(say(&error));
                return Ok(answer);
            }
            with_shared(|shared| {
                let entry = shared.entry(&ctx.root);
                entry.sync = Value::Null;
                entry.checked_at = Value::Null;
            });
            answer["ok"] = json!(true);
            Ok(answer)
        })
    }

    /// The launch list: a chip for each project, local only.
    fn glance(&self, ids: &Value) -> Value {
        let listed: Vec<Value> = self
            .call("listProjects", vec![])
            .ok()
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .filter(|project| is_object(project) && project.get("id").is_some_and(Value::is_string) && project.get("path").and_then(Value::as_str).is_some_and(|path| !path.is_empty()))
            .collect();
        let wanted: Option<HashSet<String>> = ids.as_array().map(|ids| ids.iter().filter_map(Value::as_str).map(String::from).collect());
        let projects: Vec<Value> = listed.into_iter().filter(|project| wanted.as_ref().is_none_or(|wanted| wanted.contains(project["id"].as_str().unwrap_or("")))).take(PROJECT_CAP).collect();
        let availability: Vec<bool> = projects.iter().map(|project| std::path::Path::new(project["path"].as_str().unwrap_or("")).exists()).collect();
        let found: Vec<Value> = projects.iter().zip(&availability).filter(|(_, avail)| **avail).map(|(project, _)| json!({ "id": project["id"], "root": project["path"] })).collect();
        let looked = self.actions().glance_many(&Value::Array(found));
        let by_id: HashMap<String, Value> = looked.as_array().into_iter().flatten().filter_map(|row| Some((row.get("id")?.as_str()?.to_string(), js::or_null(row.get("glance"))))).collect();
        let (who, syncs) = with_shared(|shared| {
            let syncs: HashMap<String, Value> = projects.iter().map(|project| {
                let key = key_of(project["path"].as_str().unwrap_or(""));
                (key.clone(), shared.entries.get(&key).map_or(Value::Null, |entry| entry.sync.clone()))
            }).collect();
            (shared.who_json(), syncs)
        });
        let items: Vec<Value> = projects
            .iter()
            .zip(&availability)
            .map(|(project, avail)| {
                let g = if *avail { by_id.get(project["id"].as_str().unwrap_or("")).cloned().unwrap_or(Value::Null) } else { json!({ "isRepo": false, "available": false }) };
                let mut input = json!({ "glance": g, "sync": syncs.get(&key_of(project["path"].as_str().unwrap_or(""))).cloned().unwrap_or(Value::Null) });
                if let Some(who) = &who {
                    input["account"] = who.clone();
                }
                let model = describe(&input);
                let counts = &model["counts"];
                json!({
                    "id": project["id"], "available": avail, "chip": chip(&model), "branch": js::or_null(model.get("branch")), "repo": js::or_null(model.get("repo")),
                    "ahead": counts.get("ahead").cloned().unwrap_or(json!(0)), "behind": counts.get("behind").cloned().unwrap_or(json!(0)), "dirty": counts.get("dirty").cloned().unwrap_or(json!(0)),
                })
            })
            .collect();
        json!({ "ok": true, "items": clean(&Value::Array(items), 0) })
    }

    fn on_sync_event(&self, result: &Value) {
        if !is_object(result) {
            return;
        }
        let Some(ctx) = self.read() else { return };
        let Some(root) = result.get("state").and_then(|state| state.get("root")).and_then(Value::as_str) else { return };
        if !related(root, &ctx.root) {
            return;
        }
        let now = self.clock();
        with_shared(|shared| {
            let entry = shared.entry(&ctx.root);
            entry.sync = result.clone();
            entry.checked_at = result.get("checkedAt").filter(|at| at.as_f64().is_some_and(f64::is_finite)).cloned().unwrap_or_else(|| js::num(now));
        });
        self.refresh(&ctx);
    }

    fn on_project_changed(&self) {
        with_shared(|shared| {
            shared.entries.clear();
            shared.checking.clear();
            shared.last = Value::Null;
            shared.epoch += 1;
        });
        self.refresh_open();
    }

    /// The outcome has had its 6 s: draw the chip again, unless another action or project took over.
    fn settle(&self, token: &Value) {
        let Some(now) = self.read() else { return };
        if Some(now.epoch) != token.get("epoch").and_then(Value::as_u64) || Some(key_of(&now.root).as_str()) != token.get("key").and_then(Value::as_str) || Some(&now.project_id) != token.get("projectId") {
            return;
        }
        let same = with_shared(|shared| {
            let entry = shared.entry(&now.root);
            !entry.outcome.is_null() && Some(entry.outcome_seq) == token.get("seq").and_then(Value::as_u64)
        });
        if same {
            self.refresh(&now);
        }
    }
}

/// One host method by its JavaScript name (`host.<name>` in core.git).
pub fn call(function: &str, args: &[Value], callbacks: &dyn Callbacks) -> Value {
    let collaborators = args.first().cloned().unwrap_or(Value::Null);
    let payload = args.get(1).cloned().unwrap_or(Value::Null);
    let host = Host::new(&collaborators, callbacks);
    let o = if is_object(&payload) { payload.clone() } else { json!({}) };
    match function {
        "state" => host.state(&o),
        "check" => host.check(&o),
        "pull" => host.pull(&o),
        "push" => host.push(&o),
        "rebase" => host.rebase(&o),
        "savePreview" => host.save_preview(&o),
        "save" => host.save(&o),
        "owners" => host.owners(),
        "publishPreview" => host.publish_preview(&o),
        "publish" => host.publish(&o),
        "linkRepos" => host.link_repos(),
        "link" => host.link(&o),
        "account" => host.account(),
        "glance" => host.glance(&payload),
        "onSyncEvent" => {
            host.on_sync_event(&payload);
            Value::Null
        }
        "onProjectChanged" => {
            host.on_project_changed();
            Value::Null
        }
        "settle" => {
            host.settle(&payload);
            Value::Null
        }
        "model" => with_shared(|shared| shared.last.clone()),
        // Tests start each run from nothing.
        "reset" => {
            with_shared(|shared| *shared = Shared::default());
            Value::Null
        }
        "describe" => describe(&payload),
        "chip" => chip(&payload),
        _ => json!({ "ok": false, "error": format!("no such method: {function}") }),
    }
}
