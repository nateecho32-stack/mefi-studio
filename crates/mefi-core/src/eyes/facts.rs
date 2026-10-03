//! assistantFacts: the store's facts for the always-on assistant (sessions,
//! collisions, presence, work that exists only uncommitted), and the git
//! porcelain parsing it rests on (eyes.mjs parsePorcelain, unquoteGitPath,
//! uncommittedOnly).

use indexmap::IndexSet;
use serde_json::{json, Value};

use super::{arg, call_locked, Result, Store};
use crate::{js, paths};

// ---- git status --porcelain=v1 ----

/// Git's C-quoted path ("caf\303\251.js") back to text; anything else as is.
pub fn unquote_git_path(field: &str) -> String {
    let chars: Vec<char> = field.chars().collect();
    if !(chars.len() > 1 && chars[0] == '"' && chars[chars.len() - 1] == '"') {
        return field.to_string();
    }
    let inner = &chars[1..chars.len() - 1];
    let mut bytes: Vec<u8> = Vec::new();
    let mut i = 0;
    while i < inner.len() {
        if inner[i] != '\\' {
            let mut buf = [0u8; 4];
            bytes.extend_from_slice(inner[i].encode_utf8(&mut buf).as_bytes());
            i += 1;
            continue;
        }
        let Some(&next) = inner.get(i + 1) else {
            bytes.push(b'\\');
            i += 1;
            continue;
        };
        if ('0'..='7').contains(&next) {
            let digits: String = inner[i + 1..].iter().take(3).take_while(|c| ('0'..='7').contains(*c)).collect();
            bytes.push((u32::from_str_radix(&digits, 8).unwrap_or(0) & 0xff) as u8);
            i += 1 + digits.chars().count();
            continue;
        }
        let code = match next {
            'a' => 7,
            'b' => 8,
            't' => 9,
            'n' => 10,
            'v' => 11,
            'f' => 12,
            'r' => 13,
            other => {
                // escaped.charCodeAt(0): the code unit, as one byte in the buffer.
                let mut buf = [0u16; 2];
                (other.encode_utf16(&mut buf)[0] & 0xff) as u8
            }
        };
        bytes.push(code);
        i += 2;
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// RENAME_FIELDS: `orig -> new`, either side possibly C-quoted.
fn split_rename(rest: &str) -> Option<(String, String)> {
    fn quoted_end(text: &str) -> Option<usize> {
        let bytes = text.as_bytes();
        if bytes.first() != Some(&b'"') {
            return None;
        }
        let mut i = 1;
        while i < bytes.len() {
            match bytes[i] {
                b'\\' => i += 2,
                b'"' => return Some(i + 1),
                _ => i += 1,
            }
        }
        None
    }
    let (left, after) = match quoted_end(rest) {
        Some(end) if rest[end..].starts_with(" -> ") => (&rest[..end], &rest[end + 4..]),
        _ => {
            let at = rest.find(" -> ")?;
            (&rest[..at], &rest[at + 4..])
        }
    };
    let right = match quoted_end(after) {
        Some(end) if end == after.len() => after,
        _ => after,
    };
    Some((left.to_string(), right.to_string()))
}

pub struct DirtyRow {
    pub path: String,
    pub untracked: bool,
}

pub fn parse_porcelain(text: &str) -> Vec<(DirtyRow, Value)> {
    let mut rows = Vec::new();
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        let line = raw.trim_end();
        let chars: Vec<char> = line.chars().collect();
        if chars.len() < 4 || chars[2] != ' ' {
            continue;
        }
        let (index, worktree) = (chars[0], chars[1]);
        let rest: String = chars[3..].iter().collect();
        let mut orig = Value::Null;
        let mut file = unquote_git_path(&rest);
        let renamed = matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C');
        if renamed {
            if let Some((left, right)) = split_rename(&rest) {
                orig = json!(unquote_git_path(&left));
                file = unquote_git_path(&right);
            }
        }
        let untracked = index == '?' && worktree == '?';
        let deleted = (index == 'D' || worktree == 'D') && !untracked;
        if deleted {
            continue;
        }
        let staged = index != ' ' && index != '?';
        if !(worktree != ' ' || staged || untracked) {
            continue;
        }
        let path = file.replace('\\', "/");
        let shape = json!({ "path": path, "orig": orig, "index": index.to_string(), "worktree": worktree.to_string(), "untracked": untracked, "staged": staged });
        rows.push((DirtyRow { path, untracked }, shape));
    }
    rows
}

fn unique(ids: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = IndexSet::new();
    for id in ids {
        if !id.is_empty() {
            seen.insert(id);
        }
    }
    seen.into_iter().collect()
}

fn absolute_like(text: &str) -> bool {
    let bytes = text.as_bytes();
    let rooted = |at: usize| bytes.get(at).is_some_and(|b| *b == b'/' || *b == b'\\');
    rooted(0) || (bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && rooted(2))
}

/// uncommittedOnly: dirty files a session already edited, with a warning
/// that HEAD lacks them.
pub fn uncommitted_only(porcelain: &str, sessions: &Value, changes: &Value, root: Option<&str>) -> Value {
    let dirty = parse_porcelain(porcelain);
    if dirty.is_empty() {
        return json!([]);
    }
    let empty = Vec::new();
    let sessions_list = sessions.as_array().unwrap_or(&empty);
    let mut session_files: Vec<(Value, String)> = Vec::new();
    for change in changes.as_array().unwrap_or(&empty) {
        let file = js::get(change, "file");
        let session = js::get(change, "sessionId");
        if let (Some(file), Some(session)) = (file, session) {
            if js::truthy(file) && js::truthy(session) {
                session_files.push((file.clone(), js::string(session)));
            }
        }
    }
    let id_of = |session: &Value| -> Value {
        match js::get(session, "id") {
            Some(id) if !id.is_null() => id.clone(),
            _ => js::or_null(js::get(session, "sessionId")),
        }
    };
    for session in sessions_list {
        let id = id_of(session);
        if let Some(Value::Array(files)) = js::path(session, &["changed", "files"]) {
            for file in files {
                if js::truthy(file) && js::truthy(&id) {
                    session_files.push((file.clone(), js::string(&id)));
                }
            }
        }
    }
    // (row?.id ?? row?.sessionId) === id, with id a string.
    let title_of = |id: &str| -> String {
        let found = sessions_list.iter().find(|row| matches!(id_of(row), Value::String(ref text) if text == id));
        match found.and_then(|row| js::get(row, "title")) {
            Some(title) if js::truthy(title) => js::string(title),
            _ => id.to_string(),
        }
    };
    let mut result: Vec<(Value, usize, String)> = Vec::new();
    for (row, _) in &dirty {
        let file = paths::join_root(root, &json!(row.path));
        let holders = unique(
            session_files
                .iter()
                .filter(|(hit, _)| paths::same_path(hit, &json!(file)) || (!absolute_like(&js::string(hit)) && paths::same_path(hit, &json!(row.path))))
                .map(|(_, session)| session.clone()),
        );
        if holders.is_empty() {
            continue;
        }
        let titles = unique(holders.iter().map(|id| title_of(id)));
        let name = file.rsplit('/').next().unwrap_or_default().to_string();
        let feature = if titles.is_empty() { name.clone() } else { titles.iter().map(|title| format!("\"{title}\"")).collect::<Vec<_>>().join(", ") };
        let place = if row.untracked { "the file is untracked and not in committed HEAD" } else { "it exists only as uncommitted changes, not in committed HEAD" };
        let count = holders.len();
        result.push((
            json!({
                "file": file,
                "path": row.path,
                "untracked": row.untracked,
                "sessions": holders,
                "titles": titles,
                "warning": format!("HEAD does not have {feature} — {place} ({name}). Do not assume the committed tree contains this work."),
            }),
            count,
            row.path.clone(),
        ));
    }
    result.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| js::locale_compare(&a.2, &b.2)));
    Value::Array(result.into_iter().map(|row| row.0).collect())
}

// ---- assistantFacts ----

/// `a === b` for values that came through JSON: primitives by value, an
/// object or array never equal to another, undefined only to undefined.
fn strict_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(Value::Object(_) | Value::Array(_)), _) | (_, Some(Value::Object(_) | Value::Array(_))) => false,
        (Some(Value::Number(x)), Some(Value::Number(y))) => x.as_f64() == y.as_f64(),
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}

/// A Map key with JavaScript's SameValueZero for the values the engine uses.
fn map_key(value: Option<&Value>) -> String {
    match value {
        None => "u:".into(),
        Some(Value::String(text)) => format!("s:{text}"),
        Some(Value::Number(n)) => format!("n:{}", js::number_string(n.as_f64().unwrap_or(f64::NAN))),
        Some(other) => format!("v:{other}"),
    }
}

pub fn assistant_facts(store: &mut Store, args: &Value, porcelain: &str) -> Result<Value> {
    let path = super::db_path(args);
    let now = match arg(args, "now") {
        None => super::now_ms(),
        Some(value) => js::to_number(Some(value)),
    };
    let scoped = |key: &str| arg(args, key).filter(|value| !value.is_null()).cloned();
    let with_db = |extra: Value| {
        let mut object = json!({ "dbPath": path });
        if let (Some(map), Value::Object(more)) = (object.as_object_mut(), extra) {
            map.extend(more);
        }
        object
    };
    let session_limit = arg(args, "sessionLimit").cloned().unwrap_or(json!(10));
    let change_limit = arg(args, "changeLimit").cloned().unwrap_or(json!(60));
    let todo_limit = match arg(args, "todoLimitPerSession") {
        None => 12.0,
        Some(value) => js::to_number(Some(value)),
    };
    let sessions = match scoped("sessions") {
        Some(sessions) => sessions,
        None => call_locked(store, "listSessions", &with_db(json!({ "limit": session_limit })))?,
    };
    let changes = match scoped("changes") {
        Some(changes) => changes,
        None => call_locked(store, "listChanges", &with_db(json!({ "limit": change_limit })))?,
    };
    let todos = match scoped("todos") {
        Some(todos) => todos,
        None => call_locked(store, "listTodos", &with_db(json!({})))?,
    };
    let root = arg(args, "root").filter(|root| !root.is_null()).cloned();
    let root_text = root.as_ref().filter(|root| js::truthy(root)).map(js::string);

    // Per session: the files it changed and its line counts.
    let empty = Vec::new();
    let mut by_session: indexmap::IndexMap<String, (IndexSet<String>, Vec<Value>, f64, f64)> = indexmap::IndexMap::new();
    for change in changes.as_array().unwrap_or(&empty) {
        let key = map_key(js::get(change, "sessionId"));
        let entry = by_session.entry(key).or_insert_with(|| (IndexSet::new(), Vec::new(), 0.0, 0.0));
        if let Some(file) = js::get(change, "file").filter(|file| js::truthy(file)) {
            if entry.0.insert(js::string(file)) {
                entry.1.push(file.clone());
            }
        }
        entry.2 += js::get(change, "additions").map_or(f64::NAN, |value| js::to_number(Some(value)));
        entry.3 += js::get(change, "deletions").map_or(f64::NAN, |value| js::to_number(Some(value)));
    }
    let todo_rows = todos.as_array().unwrap_or(&empty);
    let session_rows: Vec<Value> = sessions
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .map(|session| {
            let model = match js::path(session, &["model", "id"]) {
                Some(model) if !model.is_null() => model.clone(),
                _ => json!("?"),
            };
            let updated = js::get(session, "timeUpdated").map_or(f64::NAN, |value| js::to_number(Some(value)));
            let cost = match js::get(session, "cost") {
                None | Some(Value::Null) => 0.0,
                Some(cost) => js::to_number(Some(cost)),
            };
            let todos: Vec<Value> = todo_rows
                .iter()
                .filter(|todo| strict_eq(js::get(todo, "sessionId"), js::get(session, "id")))
                .take(if todo_limit.is_nan() { 0 } else { todo_limit.max(0.0) as usize })
                .map(|todo| {
                    let mut out = serde_json::Map::new();
                    for key in ["content", "status"] {
                        if let Some(value) = js::get(todo, key) {
                            out.insert(key.into(), value.clone());
                        }
                    }
                    Value::Object(out)
                })
                .collect();
            let changed = by_session.get(&map_key(js::get(session, "id"))).map_or(Value::Null, |entry| {
                json!({ "files": entry.1.iter().take(5).cloned().collect::<Vec<_>>(), "additions": js::num(entry.2), "deletions": js::num(entry.3) })
            });
            // A property the caller's session lacks is undefined, which JSON leaves out.
            let mut out = serde_json::Map::new();
            for (key, value) in [("id", js::get(session, "id")), ("parentId", js::get(session, "parentId")), ("title", js::get(session, "title")), ("agent", js::get(session, "agent"))] {
                if let Some(value) = value {
                    out.insert(key.into(), value.clone());
                }
            }
            out.insert("model".into(), model);
            out.insert("updatedMinutesAgo".into(), js::num(js::round((now - updated) / 60000.0)));
            out.insert("cost".into(), json!(js::to_fixed(cost, 3)));
            out.insert("finished".into(), json!(js::get(session, "finished") == Some(&json!(true))));
            out.insert("todos".into(), Value::Array(todos));
            out.insert("changed".into(), changed);
            Value::Object(out)
        })
        .collect();

    let root_arg = root.clone().unwrap_or(Value::Null);
    let collisions = call_locked(store, "collisions", &with_db(json!({ "root": root_arg, "now": js::num(now) })))?;
    let collision_rows: Vec<Value> = collisions
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .filter(|row| js::get(row, "historyOnly") != Some(&json!(true)))
        .take(8)
        .map(|row| {
            let sessions: Vec<Value> = js::get(row, "sessions")
                .and_then(Value::as_array)
                .unwrap_or(&empty)
                .iter()
                .map(|entry| {
                    json!({
                        "sessionId": js::get(entry, "sessionId").cloned().unwrap_or(Value::Null),
                        "edits": js::get(entry, "edits").cloned().unwrap_or(Value::Null),
                        "firstEdit": js::get(entry, "firstEdit").cloned().unwrap_or(Value::Null),
                        "lastEdit": js::get(entry, "lastEdit").cloned().unwrap_or(Value::Null),
                        "files": js::get(entry, "files").cloned().unwrap_or(Value::Null),
                        "active": js::get(entry, "active") == Some(&json!(true)),
                        "finished": js::get(entry, "finished") == Some(&json!(true)),
                    })
                })
                .collect();
            let active_sessions: Vec<Value> = sessions.iter().filter(|entry| entry["active"] == json!(true)).map(|entry| entry["sessionId"].clone()).collect();
            json!({
                "file": row["file"],
                "files": row["files"],
                "sessions": sessions,
                "owner": row["owner"],
                "ownership": row["ownership"],
                "overlap": row["overlap"],
                "active": row["active"],
                "handoff": row["handoff"] == json!(true),
                "activeSessions": active_sessions,
            })
        })
        .collect();
    let presence = call_locked(store, "filePresence", &with_db(json!({ "root": root.clone().unwrap_or(Value::Null), "now": js::num(now) })))?;
    let presence_rows: Vec<Value> = presence
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .take(12)
        .map(|row| {
            json!({
                "file": row["file"],
                "owner": row["owner"],
                "colliding": row["colliding"],
                "editors": row["editors"].as_array().unwrap_or(&empty).iter().map(|entry| json!({
                    "sessionId": entry["sessionId"], "edits": entry["edits"], "lastEdit": entry["lastEdit"], "active": entry["active"] == json!(true),
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    let uncommitted = uncommitted_only(porcelain, &sessions, &changes, root_text.as_deref());
    let uncommitted_rows: Vec<Value> = uncommitted
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .take(8)
        .map(|row| json!({ "file": row["file"], "path": row["path"], "untracked": row["untracked"], "sessions": row["sessions"], "titles": row["titles"], "warning": row["warning"] }))
        .collect();
    Ok(json!({
        "generatedAt": js::iso_string(now).map_or(Value::Null, Value::String),
        "sessions": session_rows,
        "collisions": collision_rows,
        "presence": presence_rows,
        "uncommitted": uncommitted_rows,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn porcelain_parses_quotes_and_renames() {
        let rows = parse_porcelain(" M a.js\n?? \"caf\\303\\251.js\"\nR  old.js -> new.js\n D gone.js\nR  \"a b.js\" -> \"c d.js\"\n");
        let paths: Vec<&str> = rows.iter().map(|(row, _)| row.path.as_str()).collect();
        assert_eq!(paths, vec!["a.js", "café.js", "new.js", "c d.js"]);
        assert_eq!(rows[2].1["orig"], "old.js");
        assert!(rows[1].0.untracked);
    }

    #[test]
    fn uncommitted_names_the_feature() {
        let rows = uncommitted_only(
            " M mefi-studio/main.cjs\n?? mefi-studio/renderer/boot.js\n D gone.lua\n M other.lua\n",
            &json!([{ "id": "ses_peer", "title": "Wire the parallel executor", "changed": { "files": ["C:/repo/mefi-studio/main.cjs"] } }]),
            &json!([{ "file": "C:/repo/mefi-studio/main.cjs", "sessionId": "ses_peer" }, { "file": "C:/repo/mefi-studio/renderer/boot.js", "sessionId": "ses_boot" }]),
            Some("C:/repo"),
        );
        assert_eq!(rows.as_array().unwrap().len(), 2);
        assert_eq!(rows[0]["file"], "C:/repo/mefi-studio/main.cjs");
        assert!(rows[0]["warning"].as_str().unwrap().starts_with("HEAD does not have \"Wire the parallel executor\""));
        assert_eq!(rows[1]["titles"], json!(["ses_boot"]));
    }
}
