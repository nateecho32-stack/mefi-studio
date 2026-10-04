//! The Git chip's host actions (scripts/git-actions.cjs) and the rules they
//! read (scripts/git-link.cjs's, with pc-setup.cjs, redaction.cjs and
//! share-review.cjs parts), behind a Rust-backed factory: the engine's
//! `createGitActions` collaborators arrive as the first argument of every
//! call, and the functions among them are called back.
//!
//! `parts.*` and `rules.*` answer the pure helpers on their own, so the parity
//! test can hold each one to its JavaScript.

mod actions;
mod rules;
mod run;

use serde_json::{json, Value};

use crate::callbacks::Callbacks;
use crate::js;

pub use actions::clean;

type Result<T> = std::result::Result<T, String>;

fn text(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(value) => js::string(value),
    }
}

/// A root argument. Anything but a string is a folder that is not there
/// (existsSync answers false for it), which every method reports as such.
fn root_of(args: &[Value]) -> String {
    match args.get(1) {
        Some(Value::String(root)) => root.clone(),
        _ => String::new(),
    }
}

fn headers_json(head: &actions::Headers) -> Value {
    json!({
        "oid": head.oid, "branch": head.branch, "upstream": head.upstream,
        "ab": head.ab.map(|(ahead, behind)| json!({ "ahead": js::num(ahead), "behind": js::num(behind) })),
        "entries": head.entries,
    })
}

fn blocked_json(hit: Option<rules::Blocked>) -> Value {
    hit.map_or(Value::Null, |hit| json!({ "kind": hit.kind, "rule": hit.rule, "label": hit.label }))
}

/// One factory method, or one pure helper, by its JavaScript name.
pub fn call(function: &str, args: &[Value], callbacks: &dyn Callbacks) -> Result<Value> {
    let arg = |index: usize| args.get(index).cloned().unwrap_or(Value::Null);
    let options = arg(0);
    let ctx = || actions::Ctx::new(&options, callbacks);
    let root = root_of(args);
    let root = root.as_str();
    Ok(match function {
        "glance" => {
            let budget = js::get(&arg(2), "budgetMs").and_then(js::finite).filter(|ms| *ms > 0.0).map_or(0, |ms| ms as u64);
            ctx().glance(&arg(1), budget)
        }
        "glanceMany" => ctx().glance_many(&arg(1)),
        "preview" => ctx().preview(root, &arg(2)),
        "save" => actions::serial(root, || ctx().save(root, &arg(2))),
        "pushBranch" => actions::serial(root, || ctx().push_branch(root, &arg(2))),
        "publish" => actions::serial(root, || ctx().publish(root, &arg(2))),
        "link" => actions::serial(root, || ctx().link(root, &arg(2))),
        "owners" => ctx().owners(),
        "nameCheck" => ctx().name_check(&arg(1), &arg(2)),
        "publishPreview" => ctx().publish_preview(root, &arg(2)),
        "account" => ctx().account(),
        "identity" => ctx().identity(),

        // ---- the pure helpers, for the parity test ----
        "parts.parseHeaders" => headers_json(&actions::parse_headers(&text(args.first()))),
        "parts.parseStatusZ" => {
            let (head, entries) = actions::parse_status_z(&text(args.first()));
            json!({
                "head": { "oid": head.oid, "branch": head.branch, "upstream": head.upstream },
                "entries": entries.iter().map(|entry| {
                    let mut out = json!({ "kind": entry.kind.to_string(), "xy": entry.xy, "path": entry.path });
                    if let Some(from) = &entry.from {
                        out["from"] = json!(from);
                    }
                    out
                }).collect::<Vec<_>>(),
            })
        }
        "parts.addedLines" => Value::Array(actions::added_lines(&text(args.first())).into_iter().map(|(name, lines)| json!([name, lines])).collect()),
        "parts.unquote" => json!(actions::unquote(&text(args.first()))),
        "parts.ignoreMatcher" => {
            let matcher = actions::ignore_matcher(&text(args.first()));
            Value::Array(arg(1).as_array().into_iter().flatten().map(|pair| json!(matcher(&text(pair.get(0)), pair.get(1) == Some(&json!(true))))).collect())
        }
        "parts.pathspec" => {
            let list: Vec<String> = arg(0).as_array().into_iter().flatten().map(|item| text(Some(item))).collect();
            let (args, input) = actions::pathspec(&list);
            json!({ "args": args, "input": input })
        }
        "parts.scanText" => {
            let (stop, maybe) = rules::scan_text(&text(args.first()));
            json!({ "stop": stop.map(|rule| rule.id), "maybe": maybe.map(|rule| rule.id) })
        }
        "rules.scrub" => json!(rules::scrub(&text(args.first()))),
        "rules.clean" => json!(clean(&text(args.first()))),
        "rules.maskCredentials" => json!(rules::mask_credentials(&text(args.first()))),
        "rules.classifyPush" => {
            let options = arg(1);
            rules::classify_push(&text(args.first()), js::get(&options, "timedOut").is_some_and(js::truthy), &text(js::get(&options, "branch").filter(|value| value.is_string())))
        }
        "rules.classifyGh" => {
            let options = arg(1);
            let field = |key: &str| text(js::get(&options, key).filter(|value| value.is_string()));
            rules::classify_gh(&text(args.first()), &field("repo"), &field("action"), &field("scope"))
        }
        "rules.pathBlocked" => blocked_json(rules::path_blocked(&text(args.first()))),
        "rules.publishPlan" => {
            let input = arg(0);
            // A missing key takes the JavaScript's destructuring default; null does not.
            let field = |key: &str, default: Value| js::get(&input, key).cloned().unwrap_or(default);
            let (owner, name) = (field("owner", Value::Null), field("name", Value::Null));
            let (visibility, description, license, confirm) = (field("visibility", json!("private")), field("description", json!("")), field("license", json!("none")), field("confirmPublic", json!("")));
            let flag = |key: &str| js::get(&input, key).is_some_and(js::truthy);
            rules::publish_plan(&rules::PlanInput {
                owner: &owner,
                name: &name,
                visibility: &visibility,
                description: &description,
                gitignore: js::get(&input, "gitignore").is_none_or(js::truthy),
                license: &license,
                holder: text(js::get(&input, "holder")),
                year: js::get(&input, "year").and_then(Value::as_f64),
                stacks: field("stacks", json!([])),
                confirm_public: &confirm,
                is_repo: flag("isRepo"),
                unborn: flag("unborn"),
                has_commits: flag("hasCommits"),
                branch: js::get(&input, "branch").and_then(Value::as_str).map(String::from),
                detached: flag("detached"),
                has_remote: flag("hasRemote"),
            })
        }
        "rules.oneDrive" => json!(rules::one_drive(&text(args.first()), &arg(1))),
        "rules.saveMessage" => json!(rules::save_message(js::to_number(args.first()))),
        "rules.repoIssue" => json!(rules::repo_issue(arg(0).as_str().unwrap_or(""), arg(1).as_str().unwrap_or(""))),
        "rules.validRepo" => json!(rules::valid_repo(args.first(), args.get(1))),
        "rules.repoName" => json!(rules::repo_name(&text(args.first()))),
        "rules.nameSuggestions" => json!(rules::name_suggestions(&text(args.first()))),
        "rules.gitignoreFor" => json!(rules::gitignore_for(&arg(0))),
        "rules.licenseText" => {
            let options = arg(1);
            let holder = text(js::get(&options, "holder"));
            let year = js::get(&options, "year").and_then(Value::as_f64);
            json!(rules::license_text(&text(args.first()), &holder, year))
        }
        "rules.signedInAccount" => json!(rules::signed_in_account(&text(args.first()))),
        "rules.filesystemOf" => json!(rules::filesystem_of(&text(args.first()))),
        "rules.githubRemote" => json!(rules::github_remote(&text(args.first()))),
        other => return Err(format!("git.{other} has not moved to Rust")),
    })
}
