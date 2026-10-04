//! Attempt snapshots' rules (scripts/attempt-snapshots.cjs): how a ref is
//! named, how a commit message carries its facts, which files a snapshot
//! leaves out, how git's raw diff, numstat and diff text read, which attempts
//! to prune, and what a revert may touch. Pure: time comes in.
//!
//!   refs/mefi/attempts/<task>/<n>/before|after|reverted-<stamp>

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::js;
use crate::js_regex;

pub const NAMESPACE: &str = "refs/mefi/attempts";
pub const KEEP_ATTEMPTS: usize = 20;
pub const KEEP_TASKS: usize = 300;
const MIB: f64 = 1024.0 * 1024.0;
pub const TEXT_BYTES: f64 = 5.0 * MIB;
pub const BINARY_BYTES: f64 = 2.0 * MIB;
pub const TOTAL_BYTES: f64 = 64.0 * MIB;
pub const CANDIDATES: usize = 20000;
pub const SKIPPED_LISTED: usize = 50;
pub const LISTED_FILES: usize = 1000;
pub const DIFF_BYTES: usize = 200 * 1024;
pub const DIFF_LINES: usize = 2500;
pub const REVERT_FILES: usize = 2000;
pub const RECEIPT_PATHS: usize = 500;
pub const PATH_CHARS: usize = 1024;
pub const LIST_FORMAT: &str = "%(refname)%09%(objectname)%09%(committerdate:unix)%09%(contents:subject)";

// ---- names ----

/// A task id as one path part of a ref: letters, digits, "_" and "-" stay, anything else is %xx of its UTF-8 bytes.
pub fn task_key(task_id: &Value) -> Option<String> {
    let id = task_id.as_str().filter(|id| !id.is_empty() && js::utf16_len(id) <= 200)?;
    let mut key = String::new();
    for byte in id.bytes() {
        if byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-' {
            key.push(byte as char);
        } else {
            key.push_str(&format!("%{byte:02x}"));
        }
    }
    (key.len() <= 120).then_some(key)
}

pub fn safe_run_id(run_id: &Value) -> Option<String> {
    run_id.as_str().filter(|id| js_regex!(r"^[A-Za-z0-9_-]{1,80}$", "").is_match(id)).map(String::from)
}

pub fn whole_number(value: &Value) -> Option<f64> {
    let n = value.as_f64()?;
    (n.fract() == 0.0 && (1.0..=999_999.0).contains(&n) && value.is_number()).then_some(n)
}

/// 20260930T151203123Z.
pub fn stamp_of(ms: f64) -> Option<String> {
    let iso = js::iso_string(ms)?;
    Some(iso.replace(['-', ':'], "").replacen('.', "", 1))
}

pub fn ref_name(task_id: &Value, n: &Value, phase: &str, stamp: Option<&str>) -> Option<String> {
    let key = task_key(task_id)?;
    let number = whole_number(n)?;
    match phase {
        "before" | "after" => Some(format!("{NAMESPACE}/{key}/{}/{phase}", js::number_string(number))),
        "reverted" if stamp.is_some_and(|stamp| js_regex!(r"^\d{8}T\d{9}Z$", "").is_match(stamp)) => Some(format!("{NAMESPACE}/{key}/{}/reverted-{}", js::number_string(number), stamp.unwrap_or(""))),
        _ => None,
    }
}

pub fn subject_of(n: &Value, phase: &str, run_id: &Value, stamp: Option<&str>) -> String {
    let what = if phase == "reverted" { format!("reverted {}", stamp.unwrap_or("null")) } else { phase.to_string() };
    let run = if js::truthy(run_id) { js::string(run_id) } else { "unknown run".to_string() };
    format!("Mefi attempt {} {what}: {run}", js::string(n))
}

/// Rows of LIST_FORMAT: { ref, key, n, kind, stamp, sha, at, runId }.
pub fn parse_refs(text: &str) -> Vec<Value> {
    let mut rows = Vec::new();
    for line in js::split_lines(text) {
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        let reference = fields.first().copied().unwrap_or("");
        let sha = fields.get(1).copied().unwrap_or("");
        let unix = fields.get(2).copied();
        let subject = if fields.len() > 3 { fields[3..].join("\t") } else { String::new() };
        let Some(found) = js_regex!(r"^refs\/mefi\/attempts\/([^/]+)\/(\d{1,6})\/(before|after|reverted-(\d{8}T\d{9}Z))$", "").captures(reference) else { continue };
        if !js_regex!(r"^[0-9a-f]{40,64}$", "").is_match(sha) {
            continue;
        }
        let run_id = js_regex!(r": (\S+)$", "").captures(&subject).map(|found| found[1].to_string());
        let kind = if found[3].starts_with("reverted") { "reverted".to_string() } else { found[3].to_string() };
        let unix_n = js::to_number(unix.map(|unix| Value::String(unix.to_string())).as_ref());
        let at = if unix_n.is_finite() && unix_n != 0.0 { unix_n * 1000.0 } else { 0.0 };
        rows.push(json!({
            "ref": reference, "key": &found[1], "n": js::num(found[2].parse::<f64>().unwrap_or(0.0)), "kind": kind,
            "stamp": found.get(4).map(|stamp| json!(stamp.as_str())).unwrap_or(Value::Null), "sha": sha, "at": js::num(at),
            "runId": run_id.filter(|id| id != "unknown").map(Value::String).unwrap_or(Value::Null),
        }));
    }
    rows
}

fn num_of(value: &Value) -> f64 {
    value.as_f64().unwrap_or(0.0)
}

/// One task's rows as attempts, newest first: { n, runId, before, after, reverts, startedAt, endedAt }.
pub fn attempts_of(rows: &[Value], key: &str) -> Vec<Value> {
    let mut by_number: IndexMap<String, Map<String, Value>> = IndexMap::new();
    for row in rows {
        if row["key"].as_str() != Some(key) {
            continue;
        }
        let n = row["n"].clone();
        let attempt = by_number.entry(js::string(&n)).or_insert_with(|| {
            let mut map = Map::new();
            map.insert("n".into(), n.clone());
            map.insert("runId".into(), Value::Null);
            map.insert("before".into(), Value::Null);
            map.insert("after".into(), Value::Null);
            map.insert("reverts".into(), json!([]));
            map
        });
        match row["kind"].as_str() {
            Some("before") => {
                attempt.insert("before".into(), row.clone());
            }
            Some("after") => {
                attempt.insert("after".into(), row.clone());
            }
            _ => {
                if let Some(list) = attempt.get_mut("reverts").and_then(Value::as_array_mut) {
                    list.push(row.clone());
                }
            }
        }
        if attempt["runId"].is_null() {
            attempt.insert("runId".into(), row["runId"].clone());
        }
    }
    let mut out: Vec<Value> = by_number
        .into_values()
        .map(|mut attempt| {
            let mut reverts = attempt["reverts"].as_array().cloned().unwrap_or_default();
            reverts.sort_by(|a, b| {
                num_of(&b["at"]).partial_cmp(&num_of(&a["at"])).unwrap_or(std::cmp::Ordering::Equal).then_with(|| js::utf16_cmp(&js::string(&b["stamp"]), &js::string(&a["stamp"])))
            });
            attempt.insert("reverts".into(), Value::Array(reverts));
            let before_at = attempt["before"].get("at").cloned();
            let after_at = attempt["after"].get("at").cloned();
            attempt.insert("startedAt".into(), before_at.clone().or_else(|| after_at.clone()).unwrap_or(json!(0)));
            attempt.insert("endedAt".into(), after_at.unwrap_or(Value::Null));
            Value::Object(attempt)
        })
        .collect();
    out.sort_by(|a, b| num_of(&b["n"]).partial_cmp(&num_of(&a["n"])).unwrap_or(std::cmp::Ordering::Equal));
    out
}

pub fn next_attempt(lists: &[Vec<Value>]) -> f64 {
    let mut top = 0.0;
    for list in lists {
        for value in list {
            if let Some(n) = value.as_f64().filter(|n| n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0 && value.is_number()) {
                if n > top {
                    top = n;
                }
            }
        }
    }
    top + 1.0
}

/// Refs to delete so each task keeps its newest `keep` attempts and only the newest `keep_tasks` tasks keep any.
pub fn prune_plan(rows: &[Value], keep: usize, keep_tasks: usize) -> Vec<String> {
    let mut tasks: IndexMap<String, (f64, Vec<&Value>)> = IndexMap::new();
    for row in rows {
        let held = tasks.entry(js::string(&row["key"])).or_insert((0.0, Vec::new()));
        held.0 = held.0.max(num_of(&row["at"]));
        held.1.push(row);
    }
    let mut ordered: Vec<(String, f64, Vec<&Value>)> = tasks.into_iter().map(|(key, (at, rows))| (key, at, rows)).collect();
    ordered.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then_with(|| js::utf16_cmp(&a.0, &b.0)));
    let mut doomed = Vec::new();
    for (index, (_, _, rows)) in ordered.iter().enumerate() {
        if index >= keep_tasks {
            doomed.extend(rows.iter().map(|row| js::string(&row["ref"])));
            continue;
        }
        let mut numbers: Vec<f64> = Vec::new();
        for row in rows {
            let n = num_of(&row["n"]);
            if !numbers.contains(&n) {
                numbers.push(n);
            }
        }
        numbers.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
        let kept: Vec<f64> = numbers.into_iter().take(keep.max(1)).collect();
        doomed.extend(rows.iter().filter(|row| !kept.contains(&num_of(&row["n"]))).map(|row| js::string(&row["ref"])));
    }
    doomed
}

// ---- the commit message ----

/// `String(value ?? "")`.
fn text_of(value: &Value) -> String {
    if value.is_null() { String::new() } else { js::string(value) }
}

/// encodeURIComponent.
pub fn encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// decodeURIComponent, or the text itself when it does not decode.
pub fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes.get(index + 1..index + 3).filter(|pair| pair.iter().all(u8::is_ascii_hexdigit)).and_then(|pair| std::str::from_utf8(pair).ok()).and_then(|pair| u8::from_str_radix(pair, 16).ok());
            let Some(value) = hex else { return text.to_string() };
            out.push(value);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_string())
}

pub struct Message<'a> {
    pub task_id: &'a Value,
    pub n: &'a Value,
    pub phase: &'a str,
    pub run_id: &'a Value,
    pub at: f64,
    pub worktree: bool,
    pub overlap: &'a Value,
    pub skipped: &'a [Value],
    pub skipped_count: Option<f64>,
    pub paths: &'a [String],
    pub stamp: Option<&'a str>,
}

pub fn message_of(m: &Message) -> String {
    let mut lines = vec![subject_of(m.n, m.phase, m.run_id, m.stamp), String::new()];
    let mut add = |key: &str, value: String| lines.push(format!("Mefi-{key}: {value}"));
    add("Snapshot", m.phase.to_string());
    add("Task", encode(&text_of(m.task_id)));
    add("Attempt", js::string(m.n));
    add("Run", if js::truthy(m.run_id) { js::string(m.run_id) } else { "unknown".to_string() });
    add("At", js::iso_string(if m.at.is_finite() { m.at } else { 0.0 }).unwrap_or_default());
    add("Worktree", if m.worktree { "yes" } else { "no" }.to_string());
    let others: Vec<String> = m.overlap.as_array().into_iter().flatten().filter_map(safe_run_id).take(20).collect();
    if !others.is_empty() {
        add("Overlap", others.join(","));
    }
    let left: Vec<&Value> = m.skipped.iter().take(SKIPPED_LISTED).collect();
    add("Skipped", js::number_string(m.skipped_count.filter(|count| count.is_finite()).unwrap_or(left.len() as f64)));
    for row in left {
        let size = js::to_number(row.get("size"));
        add("Skipped-File", format!("{} {} {}", js::string(&row["reason"]), js::number_string(if size.is_finite() { size } else { 0.0 }), encode(&text_of(&row["path"]))));
    }
    for path in m.paths.iter().take(RECEIPT_PATHS) {
        add("Path", encode(path));
    }
    format!("{}\n", lines.join("\n"))
}

/// Date.parse for the ISO strings messageOf writes (and their variants without milliseconds).
fn parse_iso(text: &str) -> Option<f64> {
    let found = js_regex!(r"^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?(Z|[+-]\d{2}:\d{2})$", "").captures(text)?;
    let n = |i: usize| found.get(i).map_or(0, |m| m.as_str().parse::<i64>().unwrap_or(0));
    let (year, month, day) = (n(1), n(2), n(3));
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || n(4) > 24 || n(5) > 59 || n(6) > 59 {
        return None;
    }
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let millis = found.get(7).map_or(0, |m| format!("{:0<3}", m.as_str()).parse::<i64>().unwrap_or(0));
    let mut ms = ((days * 86400 + n(4) * 3600 + n(5) * 60 + n(6)) * 1000) + millis;
    let zone = &found[8];
    if zone != "Z" {
        let sign = if zone.starts_with('-') { -1 } else { 1 };
        let offset = zone[1..3].parse::<i64>().unwrap_or(0) * 60 + zone[4..6].parse::<i64>().unwrap_or(0);
        ms -= sign * offset * 60_000;
    }
    Some(ms as f64)
}

pub fn parse_message(text: &str) -> Value {
    let mut facts = json!({ "phase": null, "taskId": null, "n": null, "runId": null, "at": null, "worktree": false, "overlap": [], "skipped": [], "skippedCount": 0, "paths": [] });
    for line in js::split_lines(text) {
        let Some(found) = js_regex!(r"^Mefi-([A-Za-z-]+): (.*)$", "").captures(line) else { continue };
        let value = found[2].to_string();
        match &found[1] {
            "Snapshot" => facts["phase"] = json!(value),
            "Task" => facts["taskId"] = json!(decode(&value)),
            "Attempt" => facts["n"] = whole_number(&js::num(js::to_number(Some(&Value::String(value))))).map(js::num).unwrap_or(Value::Null),
            "Run" => facts["runId"] = if value == "unknown" { Value::Null } else { safe_run_id(&json!(value)).map(Value::String).unwrap_or(Value::Null) },
            "At" => facts["at"] = parse_iso(&value).filter(|at| *at != 0.0).map(js::num).unwrap_or(Value::Null),
            "Worktree" => facts["worktree"] = json!(value == "yes"),
            "Overlap" => facts["overlap"] = json!(value.split(',').filter_map(|part| safe_run_id(&json!(part))).collect::<Vec<_>>()),
            "Skipped" => {
                let count = js::to_number(Some(&Value::String(value)));
                facts["skippedCount"] = js::num(if count.is_finite() && count != 0.0 { count } else { 0.0 });
            }
            "Skipped-File" => {
                if let Some(part) = js_regex!(r"^(\S+) (\d+) (.*)$", "").captures(&value) {
                    let size = part[2].parse::<f64>().unwrap_or(0.0);
                    if let Some(list) = facts["skipped"].as_array_mut() {
                        list.push(json!({ "reason": &part[1], "size": js::num(size), "path": decode(&part[3]) }));
                    }
                }
            }
            "Path" => {
                if let Some(list) = facts["paths"].as_array_mut() {
                    list.push(json!(decode(&value)));
                }
            }
            _ => {}
        }
    }
    facts
}

// ---- which files a snapshot leaves out ----

pub fn plan_snapshot(candidates: &Value) -> Value {
    let list: Vec<&Value> = candidates.as_array().into_iter().flatten().filter(|item| item.get("path").and_then(Value::as_str).is_some_and(|path| !path.is_empty())).collect();
    if list.len() > CANDIDATES {
        return json!({ "tooMany": true, "count": list.len(), "leaveOut": [], "skipped": [], "skippedCount": 0 });
    }
    let mut sorted = list.clone();
    sorted.sort_by(|a, b| js::utf16_cmp(&js::string(&a["path"]), &js::string(&b["path"])));
    let mut skipped: Vec<Value> = Vec::new();
    let mut used = 0.0;
    for item in sorted {
        let path = js::string(&item["path"]);
        let raw = js::to_number(item.get("size"));
        let size = if raw.is_finite() && raw > 0.0 { raw } else { 0.0 };
        let binary = js::truthy(item.get("binary").unwrap_or(&Value::Null));
        if js::utf16_len(&path) > PATH_CHARS {
            skipped.push(json!({ "path": path, "size": js::num(size), "reason": "long-name" }));
            continue;
        }
        if if binary { size > BINARY_BYTES } else { size > TEXT_BYTES } {
            skipped.push(json!({ "path": path, "size": js::num(size), "reason": if binary { "binary-too-large" } else { "too-large" } }));
            continue;
        }
        if used + size > TOTAL_BYTES {
            skipped.push(json!({ "path": path, "size": js::num(size), "reason": "over-budget" }));
            continue;
        }
        used += size;
    }
    let leave_out: Vec<Value> = skipped.iter().map(|row| row["path"].clone()).collect();
    json!({ "tooMany": false, "count": list.len(), "leaveOut": leave_out, "skipped": skipped.iter().take(SKIPPED_LISTED).cloned().collect::<Vec<_>>(), "skippedCount": skipped.len(), "bytes": js::num(used) })
}

pub fn add_pathspec(leave_out: &Value) -> String {
    let mut entries = vec![".".to_string()];
    entries.extend(leave_out.as_array().into_iter().flatten().map(|path| format!(":(exclude,literal){}", js::string(path))));
    entries.iter().map(|entry| format!("{entry}\0")).collect()
}

pub fn skipped_sentence(skipped: &[Value], count: Option<f64>) -> String {
    let total = match count.filter(|count| count.is_finite()) {
        Some(count) => count.max(skipped.len() as f64),
        None => skipped.len() as f64,
    };
    if total == 0.0 {
        return String::new();
    }
    let shown = skipped.len().min(3);
    let names = skipped.iter().take(3).map(|row| text_of(&row["path"])).collect::<Vec<_>>().join(", ");
    let more = if total > shown as f64 { format!(" and {} more", js::number_string(total - shown as f64)) } else { String::new() };
    let one = total == 1.0;
    format!(
        "{} left out of the snapshot ({names}{more}): too large to keep a copy of, so {} not listed and cannot be reverted.",
        if one { "1 file was".to_string() } else { format!("{} files were", js::number_string(total)) },
        if one { "it is" } else { "they are" }
    )
}

// ---- reading git's answers ----

fn mode_kind(mode: &str) -> &'static str {
    match mode {
        "120000" => "symlink",
        "160000" => "submodule",
        _ => "file",
    }
}

pub fn parse_raw(text: &str) -> Vec<Value> {
    let parts: Vec<&str> = text.split('\0').collect();
    let mut rows = Vec::new();
    let mut index = 0;
    while index < parts.len() {
        let Some(head) = js_regex!(r"^:(\d{6}) (\d{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])(\d*)$", "").captures(parts[index]) else {
            index += 1;
            continue;
        };
        let (old_mode, new_mode, old_blob, new_blob, letter, score) = (&head[1], &head[2], &head[3], &head[4], &head[5], &head[6]);
        let renamed = letter == "R" || letter == "C";
        let path = parts.get(index + if renamed { 2 } else { 1 }).copied();
        let old_path = if renamed { parts.get(index + 1).copied() } else { None };
        index += if renamed { 2 } else { 1 };
        index += 1;
        let Some(path) = path.filter(|path| !path.is_empty()) else { continue };
        let zero = |blob: &str| js_regex!(r"^0+$", "").is_match(blob);
        let status = match letter {
            "A" => "added",
            "D" => "deleted",
            "R" => "renamed",
            _ => "modified",
        };
        rows.push(json!({
            "status": status, "path": path, "oldPath": if letter == "R" { old_path.map(|p| json!(p)).unwrap_or(Value::Null) } else { Value::Null },
            "oldMode": old_mode, "newMode": new_mode,
            "oldBlob": if zero(old_blob) { Value::Null } else { json!(old_blob) },
            "newBlob": if zero(new_blob) { Value::Null } else { json!(new_blob) },
            "typeChanged": letter == "T", "score": if score.is_empty() { Value::Null } else { js::num(score.parse::<f64>().unwrap_or(0.0)) },
            "kind": mode_kind(if zero(new_blob) { old_mode } else { new_mode }),
        }));
    }
    rows
}

pub fn parse_numstat(text: &str) -> HashMap<String, Value> {
    let parts: Vec<&str> = text.split('\0').collect();
    let mut stats = HashMap::new();
    let mut index = 0;
    while index < parts.len() {
        if let Some(found) = js_regex!(r"^(\d+|-)\t(\d+|-)\t([\s\S]*)$", "").captures(parts[index]) {
            let binary = &found[1] == "-" || &found[2] == "-";
            let mut path = found[3].to_string();
            if path.is_empty() {
                path = parts.get(index + 2).copied().unwrap_or("").to_string();
                index += 2;
            }
            if !path.is_empty() {
                let count = |text: &str| if binary { 0.0 } else { text.parse::<f64>().unwrap_or(0.0) };
                stats.insert(path, json!({ "additions": js::num(count(&found[1])), "deletions": js::num(count(&found[2])), "binary": binary }));
            }
        }
        index += 1;
    }
    stats
}

pub fn change_set(raw: &str, numstat: &str) -> Vec<Value> {
    let stats = parse_numstat(numstat);
    let mut rows: Vec<Value> = parse_raw(raw)
        .into_iter()
        .map(|mut entry| {
            let stat = stats.get(&js::string(&entry["path"])).cloned().unwrap_or_else(|| json!({ "additions": 0, "deletions": 0, "binary": false }));
            for key in ["additions", "deletions", "binary"] {
                entry[key] = stat[key].clone();
            }
            entry
        })
        .collect();
    rows.sort_by(|a, b| js::utf16_cmp(&js::string(&a["path"]), &js::string(&b["path"])));
    rows
}

pub fn totals_of(entries: &[Value]) -> Value {
    let sum = |key: &str| entries.iter().map(|entry| entry[key].as_f64().filter(|n| *n != 0.0 && n.is_finite()).unwrap_or(0.0)).sum::<f64>();
    json!({ "files": entries.len(), "additions": js::num(sum("additions")), "deletions": js::num(sum("deletions")), "binary": entries.iter().filter(|entry| js::truthy(&entry["binary"])).count() })
}

pub fn public_entry(entry: &Value, state: Option<&str>) -> Value {
    let path = js::string(&entry["path"]);
    let (dir, name) = match path.rfind('/') {
        Some(cut) => (path[..=cut].to_string(), path[cut + 1..].to_string()),
        None => (String::new(), path.clone()),
    };
    let or_zero = |key: &str| entry.get(key).filter(|value| !value.is_null()).cloned().unwrap_or(json!(0));
    let mut out = json!({
        "path": path, "dir": dir, "name": name, "oldPath": entry.get("oldPath").cloned().unwrap_or(Value::Null), "status": entry["status"],
        "additions": or_zero("additions"), "deletions": or_zero("deletions"), "binary": js::truthy(entry.get("binary").unwrap_or(&Value::Null)),
        "kind": entry.get("kind").filter(|value| !value.is_null()).cloned().unwrap_or(json!("file")),
    });
    if let Some(state) = state {
        out["state"] = json!(state);
    }
    out
}

pub fn parse_diff(text: &str, max_lines: usize, max_bytes: usize) -> Value {
    let mut truncated = js::utf16_len(text) > max_bytes;
    let source = if truncated { js::slice(text, 0, Some(max_bytes as isize)) } else { text.to_string() };
    let mut lines: Vec<Value> = Vec::new();
    let mut binary = false;
    let (mut old_no, mut new_no) = (0.0, 0.0);
    let mut in_hunk = false;
    for line in source.split('\n') {
        if js_regex!(r"^Binary files .* differ$|^GIT binary patch", "").is_match(line) {
            binary = true;
            continue;
        }
        if let Some(hunk) = js_regex!(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$", "").captures(line) {
            old_no = hunk[1].parse().unwrap_or(0.0);
            new_no = hunk[2].parse().unwrap_or(0.0);
            in_hunk = true;
            if lines.len() >= max_lines {
                truncated = true;
                break;
            }
            lines.push(json!({ "k": "h", "t": line }));
            continue;
        }
        if !in_hunk || line.starts_with('\\') {
            continue;
        }
        let mark = line.chars().next();
        if !matches!(mark, Some('+' | '-' | ' ')) {
            continue;
        }
        if lines.len() >= max_lines {
            truncated = true;
            break;
        }
        let rest = &line[1..];
        match mark {
            Some('+') => {
                lines.push(json!({ "k": "+", "t": rest, "b": js::num(new_no) }));
                new_no += 1.0;
            }
            Some('-') => {
                lines.push(json!({ "k": "-", "t": rest, "a": js::num(old_no) }));
                old_no += 1.0;
            }
            _ => {
                lines.push(json!({ "k": " ", "t": rest, "a": js::num(old_no), "b": js::num(new_no) }));
                old_no += 1.0;
                new_no += 1.0;
            }
        }
    }
    json!({ "binary": binary, "lines": lines, "truncated": truncated })
}

// ---- paths the host may write ----

pub fn safe_relative(path: &Value) -> bool {
    let Some(path) = path.as_str().filter(|path| !path.is_empty() && js::utf16_len(path) <= PATH_CHARS) else { return false };
    if path.starts_with('/') || path.contains('\\') || path.contains(':') || path.contains(['\0', '\r', '\n']) {
        return false;
    }
    path.split('/').all(|part| !part.is_empty() && part != "." && part != ".." && part.to_lowercase() != ".git" && !part.ends_with(['.', ' ']))
}

// ---- what a revert may do ----

fn same(a: &Value, b: &Value) -> bool {
    a == b
}

fn refusal(path: &str, reason: &str) -> Value {
    json!({ "path": path, "reason": reason })
}

/// planRevert({ entries, scope, path, current, partial, symlinks }).
pub fn plan_revert(entries: &[Value], scope: &str, path: &Value, current: &Value, partial: bool, symlinks: bool) -> Value {
    // current[name]: Some(blob or null) when the host looked; None when it did not.
    let now = |name: &str| -> Option<Value> { current.as_object().and_then(|map| map.get(name)).map(|held| held.get("blob").cloned().filter(|blob| !blob.is_null()).unwrap_or(Value::Null)) };
    let chosen: Vec<&Value> = match scope {
        "file" => {
            let wanted: Vec<&Value> = entries.iter().filter(|entry| &entry["path"] == path || &entry["oldPath"] == path).collect();
            if wanted.is_empty() {
                let shown = if path.is_null() { String::new() } else { js::string(path) };
                return json!({ "ok": false, "restore": [], "already": [], "refused": [refusal(&shown, "not-in-attempt")], "message": "That file is not part of this attempt, so Studio leaves it alone." });
            }
            wanted
        }
        "attempt" => entries.iter().collect(),
        _ => return json!({ "ok": false, "restore": [], "already": [], "refused": [], "message": "Choose one file or the whole attempt." }),
    };
    if chosen.len() > REVERT_FILES {
        return json!({ "ok": false, "restore": [], "already": [], "refused": [refusal("", "too-many")], "message": format!("This attempt changed {} files, more than Studio puts back at once. Revert it in Git instead.", chosen.len()) });
    }
    let (mut restore, mut already, mut refused): (Vec<Value>, Vec<Value>, Vec<Value>) = (Vec::new(), Vec::new(), Vec::new());
    for entry in chosen {
        let kind = entry["kind"].as_str().unwrap_or("file");
        let type_changed = js::truthy(&entry["typeChanged"]);
        if kind == "submodule" || (kind == "symlink" && !symlinks) || type_changed {
            let detail = if kind == "submodule" { "a submodule" } else if type_changed { "its type changed" } else { "a symbolic link" };
            refused.push(json!({ "path": entry["path"], "reason": "unsupported", "detail": detail }));
            continue;
        }
        let names: Vec<&Value> = [&entry["path"], &entry["oldPath"]].into_iter().filter(|name| js::truthy(name)).collect();
        let mut unsafe_name = false;
        for name in &names {
            if !safe_relative(name) {
                refused.push(json!({ "path": name, "reason": "unsafe-name" }));
                unsafe_name = true;
            }
        }
        if unsafe_name {
            continue;
        }
        let path = js::string(&entry["path"]);
        let mode = if entry["oldMode"].as_str() == Some("100755") { 0o755 } else { 0o644 };
        let (old_blob, new_blob) = (&entry["oldBlob"], &entry["newBlob"]);
        let unknown = |refused: &mut Vec<Value>| refused.push(refusal(&path, "unknown"));
        match entry["status"].as_str() {
            Some("added") => match now(&path) {
                None => unknown(&mut refused),
                Some(Value::Null) => already.push(json!(path)),
                Some(held) if same(&held, new_blob) => restore.push(json!({ "path": path, "action": "delete" })),
                Some(_) => refused.push(refusal(&path, "changed-since")),
            },
            Some("deleted") => match now(&path) {
                None => unknown(&mut refused),
                Some(Value::Null) => restore.push(json!({ "path": path, "action": "write", "blob": old_blob, "mode": mode })),
                Some(held) if same(&held, old_blob) => already.push(json!(path)),
                Some(_) => refused.push(refusal(&path, "changed-since")),
            },
            Some("renamed") => {
                let old_path = js::string(&entry["oldPath"]);
                let (held_new, held_old) = (now(&path), now(&old_path));
                let (Some(held_new), Some(held_old)) = (held_new, held_old) else {
                    unknown(&mut refused);
                    continue;
                };
                let new_fine = held_new.is_null() || same(&held_new, new_blob);
                let old_fine = held_old.is_null() || same(&held_old, old_blob);
                if !new_fine {
                    refused.push(refusal(&path, "changed-since"));
                }
                if !old_fine {
                    refused.push(refusal(&old_path, "changed-since"));
                }
                if !new_fine || !old_fine {
                    continue;
                }
                if held_new.is_null() && same(&held_old, old_blob) {
                    already.push(json!(path));
                    continue;
                }
                if held_old.is_null() {
                    restore.push(json!({ "path": old_path, "action": "write", "blob": old_blob, "mode": mode }));
                }
                if !held_new.is_null() {
                    restore.push(json!({ "path": path, "action": "delete" }));
                }
            }
            _ => match now(&path) {
                None => unknown(&mut refused),
                Some(held) if same(&held, old_blob) && !same(old_blob, new_blob) => already.push(json!(path)),
                Some(held) if same(&held, new_blob) => restore.push(json!({ "path": path, "action": "write", "blob": old_blob, "mode": mode })),
                Some(_) => refused.push(refusal(&path, "changed-since")),
            },
        }
    }
    let blocked = !refused.is_empty();
    let go: Vec<Value> = if blocked && !partial { Vec::new() } else { restore };
    let mut ordered: Vec<Value> = go.iter().filter(|row| row["action"] == "write").cloned().collect();
    ordered.extend(go.iter().filter(|row| row["action"] == "delete").cloned());
    let message = refusal_sentence(&refused, partial, ordered.len());
    json!({ "ok": if blocked { partial && !ordered.is_empty() } else { true }, "restore": ordered, "already": already, "refused": refused, "message": message })
}

pub fn invert_entries(entries: &[Value]) -> Vec<Value> {
    entries
        .iter()
        .map(|entry| {
            let mut out = entry.clone();
            let status = entry["status"].as_str().unwrap_or("");
            out["status"] = json!(match status {
                "added" => "deleted",
                "deleted" => "added",
                other => other,
            });
            out["path"] = if status == "renamed" { entry["oldPath"].clone() } else { entry["path"].clone() };
            out["oldPath"] = if status == "renamed" { entry["path"].clone() } else { Value::Null };
            out["oldBlob"] = entry.get("newBlob").cloned().unwrap_or(Value::Null);
            out["newBlob"] = entry.get("oldBlob").cloned().unwrap_or(Value::Null);
            out["oldMode"] = entry.get("newMode").cloned().unwrap_or(Value::Null);
            out["newMode"] = entry.get("oldMode").cloned().unwrap_or(Value::Null);
            out
        })
        .collect()
}

fn reason_words(reason: &str) -> Option<&'static str> {
    Some(match reason {
        "changed-since" => "changed since the attempt ended",
        "unsupported" => "not a plain file",
        "unsafe-name" => "has a name Studio will not write",
        "unknown" => "could not be read",
        "not-in-attempt" => "is not part of this attempt",
        _ => return None,
    })
}

pub fn refusal_sentence(refused: &[Value], partial: bool, restoring: usize) -> String {
    if refused.is_empty() {
        return String::new();
    }
    let named = refused.iter().take(5).filter(|row| js::truthy(&row["path"])).map(|row| js::string(&row["path"])).collect::<Vec<_>>().join(", ");
    let more = if refused.len() > 5 { format!(" and {} more", refused.len() - 5) } else { String::new() };
    let changed = refused.iter().all(|row| row["reason"] == "changed-since");
    let one = refused.len() == 1;
    let why = if changed { "changed since the attempt ended" } else if one { reason_words(refused[0]["reason"].as_str().unwrap_or("")).unwrap_or("cannot be put back") } else { "cannot be put back" };
    let count = if one { "1 file".to_string() } else { format!("{} files", refused.len()) };
    if partial {
        return format!(
            "{}{count} {} left alone because {} {why}: {named}{more}.",
            if restoring > 0 { format!("{restoring} put back. ") } else { String::new() },
            if one { "was" } else { "were" },
            if one { "it" } else { "they" }
        );
    }
    format!(
        "Nothing was reverted. {count} {} {}: {named}{more}. Studio does not overwrite work it did not make.",
        if one { "has" } else { "have" },
        if changed { "changed since the attempt ended".to_string() } else { format!("a problem ({why})") }
    )
}

pub fn unavailable(reason: &str) -> &'static str {
    match reason {
        "off" => "Before-and-after snapshots are switched off on this PC.",
        "not-a-repo" => "This project is not a Git repository, so Studio has no before-and-after record of its files.",
        "nested" => "This folder is inside another Git project, so Studio leaves the list of changed files to that project.",
        "git-missing" => "Git is not installed on this PC, so Studio cannot list the files an attempt changed.",
        "too-many" => "Too many files changed at once to keep a snapshot. Ignore generated folders in a .gitignore.",
        _ => "Git could not read this folder just now.",
    }
}

/// The rules by name, for the parity tests.
pub fn call(function: &str, args: &[Value]) -> Option<Value> {
    let arg = |index: usize| args.get(index).cloned().unwrap_or(Value::Null);
    let text = |index: usize| js::string(&arg(index));
    let option = |index: usize, key: &str| arg(index).get(key).cloned().unwrap_or(Value::Null);
    Some(match function {
        "taskKey" => task_key(&arg(0)).map(Value::String).unwrap_or(Value::Null),
        "safeRunId" => safe_run_id(&arg(0)).map(Value::String).unwrap_or(Value::Null),
        "wholeNumber" => whole_number(&arg(0)).map(js::num).unwrap_or(Value::Null),
        "stampOf" => stamp_of(js::to_number(Some(&arg(0)))).map(Value::String).unwrap_or(Value::Null),
        "refName" => ref_name(&arg(0), &arg(1), &text(2), arg(3).as_str()).map(Value::String).unwrap_or(Value::Null),
        "parseRefs" => json!(parse_refs(&text(0))),
        "attemptsOf" => json!(attempts_of(arg(0).as_array().map(Vec::as_slice).unwrap_or(&[]), &text(1))),
        "nextAttempt" => js::num(next_attempt(&args.iter().map(|list| list.as_array().cloned().unwrap_or_default()).collect::<Vec<_>>())),
        "prunePlan" => {
            let keep = option(1, "keep").as_f64().map(|n| n as usize).unwrap_or(KEEP_ATTEMPTS);
            let keep_tasks = option(1, "keepTasks").as_f64().map(|n| n as usize).unwrap_or(KEEP_TASKS);
            json!(prune_plan(arg(0).as_array().map(Vec::as_slice).unwrap_or(&[]), keep, keep_tasks))
        }
        "messageOf" => {
            let m = arg(0);
            let skipped = m["skipped"].as_array().cloned().unwrap_or_default();
            let paths: Vec<String> = m["paths"].as_array().into_iter().flatten().map(text_of).collect();
            let stamp = m["stamp"].as_str().map(String::from);
            json!(message_of(&Message {
                task_id: &m["taskId"], n: &m["n"], phase: m["phase"].as_str().unwrap_or(""), run_id: &m["runId"], at: js::to_number(m.get("at")),
                worktree: js::truthy(&m["worktree"]), overlap: &m["overlap"], skipped: &skipped,
                skipped_count: m["skippedCount"].as_f64(), paths: &paths, stamp: stamp.as_deref(),
            }))
        }
        "parseMessage" => parse_message(&text(0)),
        "planSnapshot" => plan_snapshot(&arg(0)),
        "addPathspec" => json!(add_pathspec(&arg(0))),
        "skippedSentence" => json!(skipped_sentence(arg(0).as_array().map(Vec::as_slice).unwrap_or(&[]), arg(1).as_f64())),
        "parseRaw" => json!(parse_raw(&text(0))),
        "parseNumstat" => {
            let stats = parse_numstat(&text(0));
            let mut keys: Vec<&String> = stats.keys().collect();
            keys.sort();
            json!(keys.into_iter().map(|key| json!([key, stats[key]])).collect::<Vec<_>>())
        }
        "changeSet" => json!(change_set(&text(0), &text(1))),
        "totalsOf" => totals_of(arg(0).as_array().map(Vec::as_slice).unwrap_or(&[])),
        "publicEntry" => public_entry(&arg(0), arg(1).as_str()),
        "parseDiff" => {
            let max_lines = option(1, "maxLines").as_f64().map(|n| n as usize).unwrap_or(DIFF_LINES);
            let max_bytes = option(1, "maxBytes").as_f64().map(|n| n as usize).unwrap_or(DIFF_BYTES);
            parse_diff(&text(0), max_lines, max_bytes)
        }
        "safeRelative" => json!(safe_relative(&arg(0))),
        "planRevert" => {
            let o = arg(0);
            plan_revert(o["entries"].as_array().map(Vec::as_slice).unwrap_or(&[]), o["scope"].as_str().unwrap_or(""), &o["path"], &o["current"], js::truthy(&o["partial"]), js::truthy(&o["symlinks"]))
        }
        "invertEntries" => json!(invert_entries(arg(0).as_array().map(Vec::as_slice).unwrap_or(&[]))),
        "refusalSentence" => json!(refusal_sentence(arg(0).as_array().map(Vec::as_slice).unwrap_or(&[]), js::truthy(&option(1, "partial")), option(1, "restoring").as_f64().unwrap_or(0.0) as usize)),
        "unavailable" => json!(unavailable(&text(0))),
        _ => return None,
    })
}

/// The set of names a change set touches.
pub fn names_of(entries: &[Value]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for entry in entries {
        for name in [&entry["path"], &entry["oldPath"]] {
            if js::truthy(name) && seen.insert(js::string(name)) {
                out.push(js::string(name));
            }
        }
    }
    out
}
