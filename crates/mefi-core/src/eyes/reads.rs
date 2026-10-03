//! The direct store reads of scripts/eyes.mjs: sessions, changes, checks,
//! reads, active tools, todos, activity and chat texts.

use serde_json::{json, Map, Value};

use super::{all, arg, arg_or, field, one, scan_recent_parts, window_covers, Result, Row, Store};
use crate::{js, paths};

const SESSION_COLUMNS: &str = "id, parent_id, title, agent, model, directory, cost,
              tokens_input, tokens_output, tokens_cache_read,
              summary_files, summary_additions, summary_deletions,
              time_created, time_updated";

/// parseModel: the session's model column, JSON or a bare id.
fn parse_model(raw: &Value) -> Value {
    let none = |id: Value| json!({ "id": id, "provider": null, "variant": null });
    let text = match raw {
        Value::Null => return none(Value::Null),
        Value::String(text) => text.clone(),
        other => js::string(other),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(parsed)) => json!({
            "id": js::or_null(parsed.get("id")),
            "provider": js::or_null(parsed.get("providerID")),
            "variant": js::or_null(parsed.get("variant")),
        }),
        // JSON.parse("null").id throws, which the catch turns into the raw id.
        Ok(Value::Null) | Err(_) => none(raw.clone()),
        Ok(_) => none(Value::Null),
    }
}

/// The final part of a session is a step-finish with reason "stop".
fn finished_sessions(db: &rusqlite::Connection, ids: &[Value]) -> Vec<bool> {
    ids.iter()
        .map(|id| {
            one(
                db,
                "select json_extract(data,'$.type') type, json_extract(data,'$.reason') reason
     from part where rowid = (
       select rowid from part where session_id = ? order by time_created desc, id desc limit 1)",
                &[id.clone()],
            )
            .ok()
            .flatten()
            .is_some_and(|row| field(&row, "type") == "step-finish" && field(&row, "reason") == "stop")
        })
        .collect()
}

pub fn list_sessions(store: &mut Store, path: &str, args: &Value) -> Result<Value> {
    if !store.present(path) {
        return Ok(json!([]));
    }
    let limit = arg_or(args, "limit", json!(40));
    let root = arg(args, "root").filter(|root| js::truthy(root)).map(js::string);
    let db = store.db(path)?;
    let rows = match &root {
        Some(root) => {
            let rows = all(db, &format!("select {SESSION_COLUMNS} from session order by time_updated desc"), &[])?;
            let cap = js::to_number(Some(&limit));
            let take = if cap.is_nan() { 0 } else { cap.max(0.0) as usize };
            rows.into_iter().filter(|row| paths::contains_path(root, field(row, "directory"))).take(take).collect::<Vec<_>>()
        }
        None => all(db, &format!("select {SESSION_COLUMNS} from session order by time_updated desc limit ?"), &[limit])?,
    };
    let ids: Vec<Value> = rows.iter().map(|row| field(row, "id").clone()).collect();
    let finished = finished_sessions(db, &ids);
    let or_zero = |value: &Value| if value.is_null() { json!(0) } else { value.clone() };
    Ok(Value::Array(
        rows.iter()
            .zip(finished)
            .map(|(row, finished)| {
                json!({
                    "id": field(row, "id"),
                    "parentId": field(row, "parent_id"),
                    "title": field(row, "title"),
                    "agent": field(row, "agent"),
                    "model": parse_model(field(row, "model")),
                    "directory": field(row, "directory"),
                    "cost": field(row, "cost"),
                    "finished": finished,
                    "tokens": { "input": field(row, "tokens_input"), "output": field(row, "tokens_output"), "cacheRead": field(row, "tokens_cache_read") },
                    "summary": { "files": or_zero(field(row, "summary_files")), "additions": or_zero(field(row, "summary_additions")), "deletions": or_zero(field(row, "summary_deletions")) },
                    "timeCreated": field(row, "time_created"),
                    "timeUpdated": field(row, "time_updated"),
                })
            })
            .collect(),
    ))
}

pub fn list_session_ids(store: &mut Store, path: &str, args: &Value) -> Result<Value> {
    if !store.present(path) {
        return Ok(json!([]));
    }
    let root = arg(args, "root").filter(|root| js::truthy(root)).map(js::string);
    let rows = all(store.db(path)?, "select id, directory from session", &[])?;
    Ok(Value::Array(
        rows.iter()
            .filter(|row| root.as_ref().is_none_or(|root| paths::contains_path(root, field(row, "directory"))))
            .map(|row| field(row, "id").clone())
            .collect(),
    ))
}

pub fn session_directory(store: &mut Store, path: &str, args: &Value) -> Result<Value> {
    let Some(Value::String(session)) = arg(args, "sessionId").filter(|id| matches!(id, Value::String(text) if !text.is_empty())) else {
        return Ok(Value::Null);
    };
    if !store.present(path) {
        return Ok(Value::Null);
    }
    let row = one(store.db(path)?, "select directory from session where id = ?", &[json!(session)])?;
    Ok(row.map(|row| field(&row, "directory").clone()).filter(Value::is_string).unwrap_or(Value::Null))
}

pub fn find_run_session(store: &mut Store, path: &str, args: &Value) -> Result<Value> {
    // String(runId ?? "")
    let run = match arg(args, "runId") {
        None | Some(Value::Null) => String::new(),
        Some(value) => js::string(value),
    };
    let valid = run.len() > 4 && run.starts_with("run_") && run[4..].chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !valid || !store.present(path) {
        return Ok(Value::Null);
    }
    let since = js::to_number(arg(args, "since"));
    let since = if since.is_nan() || since == 0.0 { 0.0 } else { since };
    let rows = all(
        store.db(path)?,
        "
    select distinct s.id, s.directory, s.time_created
    from session s
    join part p on p.session_id = s.id
    join message m on m.id = p.message_id and m.session_id = s.id
    where s.parent_id is null and s.time_created >= ?
      and json_extract(m.data, '$.role') = 'user'
      and json_extract(p.data, '$.type') = 'text'
      and (instr(json_extract(p.data, '$.text'), ?) > 0
        or instr(json_extract(p.data, '$.text'), ?) > 0)
    limit 2
  ",
        &[js::num(since), json!(format!("This dispatch is run {run}.")), json!(format!("This dispatch is run {run} for task "))],
    )?;
    if rows.len() != 1 {
        return Ok(Value::Null);
    }
    Ok(json!({ "id": field(&rows[0], "id"), "directory": field(&rows[0], "directory"), "timeCreated": field(&rows[0], "time_created") }))
}

// ---- changes ----

fn count_diff(diff: &Value) -> (f64, f64) {
    let (mut additions, mut deletions) = (0.0, 0.0);
    for line in js::string(diff).split('\n') {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            additions += 1.0;
        } else if line.starts_with('-') {
            deletions += 1.0;
        }
    }
    (additions, deletions)
}

fn file_of(input: &Value) -> Value {
    match js::get(input, "filePath") {
        Some(value) if !value.is_null() => value.clone(),
        _ => js::or_null(js::get(input, "file_path")),
    }
}

/// toChange: an edit, write or patch part as a change row; None for anything
/// else. A part whose data is JSON null throws, as `null.type` did.
fn to_change(part: &Row) -> Result<Option<Value>> {
    let text = js::string(field(part, "data"));
    let Ok(data) = serde_json::from_str::<Value>(&text) else {
        return Ok(None);
    };
    if data.is_null() {
        return Err("Cannot read properties of null (reading 'type')".into());
    }
    let session = field(part, "session_id");
    let time = field(part, "time_created");
    let kind = js::get(&data, "type");
    if kind == Some(&json!("patch")) {
        if let Some(Value::Array(files)) = js::get(&data, "files") {
            return Ok(Some(json!({
                "id": field(part, "id"), "sessionId": session, "time": time, "tool": "patch",
                "file": files.first().map_or(Value::Null, |first| js::or_null(Some(first))), "files": files,
                "additions": 0, "deletions": 0, "diff": null, "status": "completed", "hash": js::or_null(js::get(&data, "hash")),
            })));
        }
    }
    if kind != Some(&json!("tool")) {
        return Ok(None);
    }
    let tool = js::get(&data, "tool");
    if !matches!(tool, Some(Value::String(name)) if name == "edit" || name == "write") {
        return Ok(None);
    }
    let state = js::get(&data, "state");
    let input = state.and_then(|state| js::get(state, "input")).filter(|input| !input.is_null()).cloned().unwrap_or_else(|| json!({}));
    let diff = js::or_null(state.and_then(|state| js::path(state, &["metadata", "diff"])));
    let (mut additions, mut deletions) = (0.0, 0.0);
    if js::truthy(&diff) {
        (additions, deletions) = count_diff(&diff);
    } else if tool == Some(&json!("write")) {
        if let Some(Value::String(content)) = js::get(&input, "content") {
            additions = content.split('\n').count() as f64;
        }
    }
    let file = file_of(&input);
    let files = if js::truthy(&file) { json!([file.clone()]) } else { json!([]) };
    let status = match state.and_then(|state| js::get(state, "status")) {
        Some(value) if !value.is_null() => value.clone(),
        _ => json!("completed"),
    };
    Ok(Some(json!({
        "id": field(part, "id"), "sessionId": session, "time": time, "tool": tool.cloned().unwrap_or(Value::Null),
        "file": file, "files": files, "additions": js::num(additions), "deletions": js::num(deletions),
        "diff": diff, "status": status, "hash": null,
    })))
}

fn changes_of(rows: &[Row]) -> Result<Value> {
    let mut out = Vec::new();
    for row in rows {
        if let Some(change) = to_change(row)? {
            out.push(change);
        }
    }
    Ok(Value::Array(out))
}

pub fn list_changes(store: &mut Store, path: &str, args: &Value) -> Result<Value> {
    if !store.present(path) {
        return Ok(json!([]));
    }
    let session = js::or_null(arg(args, "sessionId"));
    let limit = arg_or(args, "limit", json!(300));
    let since = js::or_null(arg(args, "since"));
    let until = js::or_null(arg(args, "until"));
    let db = store.db(path)?;
    const KINDS: &str = "json_extract(data,'$.type') in ('tool','patch')";
    if !since.is_null() || !until.is_null() {
        // A verification window: only parts that started and ended inside it.
        let (Some(from), Some(to)) = (js::finite_time(&since), js::finite_time(&until)) else {
            return Ok(json!([]));
        };
        if to < from || !js::truthy(&session) {
            return Ok(json!([]));
        }
        let rows = all(
            db,
            &format!("select id, session_id, time_created, data from part
      where {KINDS} and session_id = ? and time_created >= ? and time_created <= ?
      order by time_created desc limit ?"),
            &[session, since.clone(), until.clone(), limit],
        )?;
        let kept: Vec<Row> = rows
            .into_iter()
            .filter(|row| {
                let Ok(data) = serde_json::from_str::<Value>(&js::string(field(row, "data"))) else {
                    return false;
                };
                if js::get(&data, "type") == Some(&json!("patch")) {
                    return true;
                }
                let start = js::path(&data, &["state", "time", "start"]).and_then(js::finite_time);
                let end = js::path(&data, &["state", "time", "end"]).and_then(js::finite_time);
                matches!((start, end), (Some(start), Some(end)) if start >= from && end >= start && end <= to)
            })
            .collect();
        return changes_of(&kept);
    }
    let rows = if js::truthy(&session) {
        all(
            db,
            &format!("select id, session_id, time_created, data from part
           where {KINDS} and session_id = ? order by time_created desc limit ?"),
            &[session, limit],
        )?
    } else {
        let cap = js::to_number(Some(&limit));
        scan_recent_parts(
            db,
            &mut |lower| {
                all(
                    db,
                    &format!("select id, session_id, time_created, data from part
           where rowid > ? and {KINDS} order by time_created desc limit ?"),
                    &[js::num(lower), limit.clone()],
                )
            },
            &mut |found, _| Ok(found.len() as f64 >= cap),
        )?
    };
    changes_of(&rows)
}

// ---- check evidence ----

const CHECK_COMMAND_LIMIT: usize = 4000;
const CHECK_OUTPUT_LIMIT: usize = 2000;

struct CheckWindow {
    session: String,
    since: f64,
    until: f64,
}

fn check_window(args: &Value) -> Option<CheckWindow> {
    let session = match arg(args, "sessionId") {
        Some(Value::String(text)) if !text.trim().is_empty() => text.clone(),
        _ => return None,
    };
    let since = arg(args, "since").and_then(js::finite_time)?;
    let until = arg(args, "until").and_then(js::finite_time)?;
    (until >= since).then_some(CheckWindow { session, since, until })
}

fn cap_of(args: &Value, max: f64, fallback: f64) -> f64 {
    match arg(args, "limit") {
        None => fallback,
        Some(value) => match js::finite(value) {
            Some(limit) => limit.floor().max(1.0).min(max),
            None => fallback,
        },
    }
}

/// sessionCheckEvidence: one recorded bash run as check evidence, or None.
fn check_evidence(part: &Row, window: &CheckWindow) -> Option<Value> {
    if field(part, "session_id").as_str() != Some(window.session.as_str()) {
        return None;
    }
    let created = js::finite_time(field(part, "time_created"))?;
    if created < window.since || created > window.until {
        return None;
    }
    let data: Value = match field(part, "data") {
        Value::String(text) => serde_json::from_str(text).ok()?,
        other => other.clone(),
    };
    if js::get(&data, "type") != Some(&json!("tool")) || js::get(&data, "tool") != Some(&json!("bash")) {
        return None;
    }
    let state = js::get(&data, "state").filter(|state| !state.is_null()).cloned().unwrap_or_else(|| json!({}));
    let command = match js::path(&state, &["input", "command"]) {
        Some(Value::String(command)) if !command.trim().is_empty() => command.clone(),
        _ => return None,
    };
    let started = js::path(&state, &["time", "start"]).and_then(js::finite_time);
    let finished = js::path(&state, &["time", "end"]).and_then(js::finite_time);
    if started.is_some_and(|at| at < window.since || at > window.until) || finished.is_some_and(|at| at < window.since || at > window.until) {
        return None;
    }
    let valid_timing = matches!((started, finished), (Some(start), Some(end)) if end >= start);
    let exit = js::path(&state, &["metadata", "exit"]).and_then(js::safe_integer);
    let status = match js::get(&state, "status") {
        Some(Value::String(status)) if ["completed", "error", "running", "pending"].contains(&status.as_str()) => status.clone(),
        _ => "unknown".into(),
    };
    let output = match (js::get(&state, "output"), js::path(&state, &["metadata", "output"])) {
        (Some(Value::String(output)), _) => output.clone(),
        (_, Some(Value::String(output))) => output.clone(),
        _ => String::new(),
    };
    let passed = if status == "error" {
        json!(false)
    } else if status == "completed" && valid_timing && exit.is_some() {
        json!(exit == Some(0.0))
    } else {
        Value::Null
    };
    Some(json!({
        "id": field(part, "id").as_str().map_or(Value::Null, |id| json!(id)),
        "sessionId": field(part, "session_id"),
        "tool": "bash",
        "command": js::slice(&command, 0, Some(CHECK_COMMAND_LIMIT as isize)),
        "commandTruncated": js::utf16_len(&command) > CHECK_COMMAND_LIMIT,
        "status": status,
        "exitCode": exit.map_or(Value::Null, js::num),
        "startedAt": started.map_or(Value::Null, js::num),
        "finishedAt": finished.map_or(Value::Null, js::num),
        "outputExcerpt": js::slice(&output, -(CHECK_OUTPUT_LIMIT as isize), None),
        "outputTruncated": js::path(&state, &["metadata", "truncated"]) == Some(&json!(true)) || js::utf16_len(&output) > CHECK_OUTPUT_LIMIT,
        "passed": passed,
    }))
}

pub fn list_session_checks(store: &mut Store, path: &str, args: &Value) -> Value {
    let unavailable = || json!({ "available": false, "checks": [], "truncated": false, "error": "Session check evidence is unavailable" });
    let Some(window) = check_window(args) else {
        return unavailable();
    };
    let cap = cap_of(args, 1000.0, 200.0);
    let mut read = || -> Result<Value> {
        let rows = all(
            store.db(path)?,
            "
      with scoped as (
        select id, session_id, time_created,
          case when json_valid(data) then data else '{}' end payload
        from part where session_id = ? and time_created >= ? and time_created <= ?
      )
      select id, session_id, time_created, json_object(
        'type', 'tool', 'tool', 'bash',
        'state', json_object(
          'status', json_extract(payload, '$.state.status'),
          'input', json_object('command', substr(json_extract(payload, '$.state.input.command'), 1, ?)),
          'metadata', json_object(
            'exit', case when json_type(payload, '$.state.metadata.exit') in ('integer', 'real') then json_extract(payload, '$.state.metadata.exit') else null end,
            'truncated', json(case when json_type(payload, '$.state.metadata.truncated') = 'true' then 'true' else 'false' end)),
          'time', json_object(
            'start', case when json_type(payload, '$.state.time.start') in ('integer', 'real') then json_extract(payload, '$.state.time.start') else null end,
            'end', case when json_type(payload, '$.state.time.end') in ('integer', 'real') then json_extract(payload, '$.state.time.end') else null end),
          'output', substr(coalesce(json_extract(payload, '$.state.output'), json_extract(payload, '$.state.metadata.output'), ''), -?)
        )
      ) data
      from scoped where json_extract(payload, '$.type') = 'tool' and json_extract(payload, '$.tool') = 'bash' and json_type(payload, '$.state.input.command') = 'text'
      order by time_created desc, id desc limit ?
    ",
            &[json!(window.session), js::num(window.since), js::num(window.until), json!(CHECK_COMMAND_LIMIT + 1), json!(CHECK_OUTPUT_LIMIT + 1), js::num(cap + 1.0)],
        )?;
        let checks: Vec<Value> = rows.iter().take(cap as usize).filter_map(|part| check_evidence(part, &window)).collect();
        Ok(json!({ "available": true, "checks": checks, "truncated": rows.len() as f64 > cap }))
    };
    read().unwrap_or_else(|_| unavailable())
}

pub fn list_reads(store: &mut Store, path: &str, args: &Value) -> Value {
    let unavailable = || json!({ "available": false, "files": [], "truncated": false });
    let Some(window) = check_window(args) else {
        return unavailable();
    };
    let cap = cap_of(args, 2000.0, 400.0);
    let mut read = || -> Result<Value> {
        let rows = all(
            store.db(path)?,
            "
      select distinct coalesce(
        json_extract(data, '$.state.input.filePath'),
        json_extract(data, '$.state.input.file_path')) file
      from part
      where session_id = ? and time_created >= ? and time_created <= ?
        and json_valid(data)
        and json_extract(data, '$.type') = 'tool'
        and json_extract(data, '$.tool') = 'read'
        and file is not null
      limit ?
    ",
            &[json!(window.session), js::num(window.since), js::num(window.until), js::num(cap + 1.0)],
        )?;
        let files: Vec<Value> = rows
            .iter()
            .take(cap as usize)
            .map(|row| field(row, "file").clone())
            .filter(|file| matches!(file, Value::String(text) if !text.trim().is_empty()))
            .collect();
        Ok(json!({ "available": true, "files": files, "truncated": rows.len() as f64 > cap }))
    };
    read().unwrap_or_else(|_| unavailable())
}

pub fn list_session_active_tools(store: &mut Store, path: &str, args: &Value) -> Value {
    let unavailable = || json!({ "available": false, "tools": [], "truncated": false });
    let Some(window) = check_window(args) else {
        return unavailable();
    };
    let cap = match arg(args, "limit") {
        None => 4.0,
        Some(value) => js::finite(value).map_or(4.0, |limit| limit.floor().min(12.0).max(1.0)),
    };
    let mut read = || -> Result<Value> {
        let rows = all(
            store.db(path)?,
            "
      with scoped as (
        select id, session_id, time_created, time_updated,
          case when json_valid(data) then data else '{}' end payload
        from part where session_id = ? and time_created >= ? and time_created <= ?
      )
      select id, session_id sessionId, time_created, time_updated updatedAt,
        substr(json_extract(payload, '$.tool'), 1, 40) tool,
        json_extract(payload, '$.state.status') status,
        substr(coalesce(nullif(json_extract(payload, '$.state.input.description'), ''), json_extract(payload, '$.state.title'), ''), 1, 240) description,
        substr(coalesce(json_extract(payload, '$.state.input.command'), ''), 1, 2000) command,
        json_extract(payload, '$.state.time.start') startedAt
      from scoped where json_extract(payload, '$.type') = 'tool'
        and json_extract(payload, '$.state.status') in ('running', 'pending')
        and json_extract(payload, '$.state.time.end') is null
      order by case json_extract(payload, '$.state.status') when 'running' then 0 else 1 end, time_created asc limit ?
    ",
            &[json!(window.session), js::num(window.since), js::num(window.until), js::num(cap + 1.0)],
        )?;
        let tools: Vec<Value> = rows
            .iter()
            .take(cap as usize)
            .filter(|row| {
                let started = field(row, "startedAt");
                started.is_null() || js::finite_time(started).is_some_and(|at| at >= window.since && at <= window.until)
            })
            .map(|row| {
                let created = field(row, "time_created");
                let text = |key: &str| field(row, key).as_str().map_or(json!(""), |text| json!(text));
                json!({
                    "id": field(row, "id"),
                    "sessionId": field(row, "sessionId"),
                    "tool": field(row, "tool").as_str().map_or(json!("tool"), |tool| json!(tool)),
                    "status": field(row, "status"),
                    "description": text("description"),
                    "command": text("command"),
                    "startedAt": if js::finite_time(field(row, "startedAt")).is_some() { field(row, "startedAt").clone() } else { created.clone() },
                    "updatedAt": if js::finite_time(field(row, "updatedAt")).is_some() { field(row, "updatedAt").clone() } else { created.clone() },
                })
            })
            .collect();
        Ok(json!({ "available": true, "tools": tools, "truncated": rows.len() as f64 > cap }))
    };
    read().unwrap_or_else(|_| unavailable())
}

pub fn list_todos(store: &mut Store, path: &str, args: &Value) -> Result<Value> {
    if !store.present(path) {
        return Ok(json!([]));
    }
    let session = js::or_null(arg(args, "sessionId"));
    let db = store.db(path)?;
    let rows = if js::truthy(&session) {
        all(db, "select * from todo where session_id = ? order by position asc", &[session])?
    } else {
        all(db, "select * from todo order by time_updated desc limit 400", &[])?
    };
    // A column the table lacks reads as undefined, which JSON leaves out.
    let pick = [("sessionId", "session_id"), ("content", "content"), ("status", "status"), ("priority", "priority"), ("position", "position"), ("timeCreated", "time_created"), ("timeUpdated", "time_updated")];
    Ok(Value::Array(
        rows.iter()
            .map(|row| {
                let mut out = Map::new();
                for (key, column) in pick {
                    if let Some(value) = row.get(column) {
                        out.insert(key.into(), value.clone());
                    }
                }
                Value::Object(out)
            })
            .collect(),
    ))
}

pub fn activity_since(store: &mut Store, path: &str, args: &Value) -> Result<Value> {
    if !store.present(path) {
        return Ok(json!([]));
    }
    let since = arg_or(args, "since", json!(0));
    let limit = arg_or(args, "limit", json!(60));
    let db = store.db(path)?;
    let rows = scan_recent_parts(
        db,
        &mut |lower| {
            all(
                db,
                "select id, session_id, time_created, json_extract(data,'$.tool') tool,
              json_extract(data,'$.state.input.filePath') file,
              substr(data, 1, 200) head
       from part
       where rowid > ? and time_created > ? and json_extract(data,'$.type') = 'tool'
       order by time_created asc limit ?",
                &[js::num(lower), since.clone(), limit.clone()],
            )
        },
        &mut |_, lower| window_covers(db, lower, &since),
    )?;
    Ok(Value::Array(
        rows.iter()
            .map(|row| json!({ "id": field(row, "id"), "sessionId": field(row, "session_id"), "time": field(row, "time_created"), "tool": field(row, "tool"), "file": field(row, "file") }))
            .collect(),
    ))
}

pub fn list_chat_texts(store: &mut Store, path: &str, args: &Value) -> Result<Value> {
    if !store.present(path) {
        return Ok(json!([]));
    }
    // seed = after && typeof after === "object" ? after : { at: Number(after) || 0, id: "" }
    let after = arg_or(args, "after", json!({ "at": 0, "id": "" }));
    let seed = if js::truthy(&after) && matches!(after, Value::Object(_) | Value::Array(_)) {
        after.clone()
    } else {
        let at = js::to_number(Some(&after));
        json!({ "at": js::num(if at.is_nan() { 0.0 } else { at }), "id": "" })
    };
    // afterAt = Number.isFinite(Number(since ?? seed.at)) ? Number(since ?? seed.at) : 0
    let source = match arg(args, "since") {
        Some(since) if !since.is_null() => Some(since),
        _ => js::get(&seed, "at"),
    };
    let candidate = js::to_number(source);
    let after_at = if candidate.is_finite() { candidate } else { 0.0 };
    let after_id = match js::get(&seed, "id") {
        None | Some(Value::Null) => String::new(),
        Some(id) => js::string(id),
    };
    let ascending = arg(args, "order") == Some(&json!("asc"));
    let direction = if ascending { "asc" } else { "desc" };
    let limit = arg_or(args, "limit", json!(400));
    let min_length = arg_or(args, "minLength", json!(40));
    let max_length = arg_or(args, "maxLength", json!(400));
    let cap = js::to_number(Some(&limit));
    let db = store.db(path)?;
    let after_value = js::num(after_at);
    let rows = scan_recent_parts(
        db,
        &mut |lower| {
            all(
                db,
                &format!(
                    "select id, session_id, time_created, json_extract(data,'$.text') text
       from part
       where rowid > ? and json_extract(data,'$.type') = 'text'
         and (time_created > ? or (time_created = ? and (? = '' or id > ?)))
         and length(json_extract(data,'$.text')) between ? and ?
       order by time_created {direction}, id {direction}
       limit ?"
                ),
                &[js::num(lower), after_value.clone(), after_value.clone(), json!(after_id), json!(after_id), min_length.clone(), max_length.clone(), limit.clone()],
            )
        },
        &mut |found, lower| Ok((!ascending && found.len() as f64 >= cap) || window_covers(db, lower, &after_value)?),
    )?;
    Ok(Value::Array(
        rows.iter()
            .map(|row| json!({ "id": field(row, "id"), "sessionId": field(row, "session_id"), "at": field(row, "time_created"), "text": field(row, "text") }))
            .collect(),
    ))
}
