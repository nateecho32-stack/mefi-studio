//! Who edited which file when: collisions (files two live sessions edited in
//! overlapping windows, grouped by session set, with owners and hand-offs)
//! and presence (who is editing each file right now). eyes.mjs's
//! editWindowsByFile, collisions, filePresence and their memo.

use std::cmp::Ordering;
use std::collections::HashSet;
use std::time::Instant;

use indexmap::IndexMap;
use rusqlite::Connection;
use serde_json::{json, Value};

use super::{all, arg, field, now_ms, one, scan_recent_parts, window_covers, Result, Store};
use crate::{js, paths};

/// A session is active while its newest edit is this recent.
const ACTIVE_EDIT_MS: f64 = 10.0 * 60.0 * 1000.0;
const EDIT_ROWS_MEMO_MS: u128 = 30 * 1000;

#[derive(Clone)]
pub(crate) struct EditRow {
    session: String,
    file: Value,
    time: f64,
}

/// The last scan's edit rows, valid while the store's data_version holds.
pub(crate) struct EditMemo {
    path: String,
    generation: u64,
    version: i64,
    since: f64,
    rows: Vec<EditRow>,
    at: Instant,
}

#[derive(Clone)]
struct Window {
    first: f64,
    last: f64,
    edits: f64,
    finished: bool,
    finished_at: Option<f64>,
    started_at: Option<f64>,
}

fn time_of(value: &Value) -> f64 {
    value.as_f64().unwrap_or(f64::NAN)
}

fn data_version(db: &Connection) -> Option<i64> {
    one(db, "pragma data_version", &[]).ok().flatten().and_then(|row| field(&row, "data_version").as_i64())
}

fn recent_edit_rows(store: &mut Store, path: &str, since: f64) -> Result<Vec<EditRow>> {
    let generation = store.generation();
    let db = store.db(path)?;
    let version = data_version(db);
    if let (Some(memo), Some(version)) = (&store.edit_memo, version) {
        if memo.path == path && memo.generation == generation && memo.version == version && memo.since <= since && memo.at.elapsed().as_millis() < EDIT_ROWS_MEMO_MS {
            return Ok(if memo.since == since { memo.rows.clone() } else { memo.rows.iter().filter(|row| row.time > since).cloned().collect() });
        }
    }
    let db = store.db(path)?;
    let since_value = js::num(since);
    let rows = scan_recent_parts(
        db,
        &mut |lower| {
            all(
                db,
                "select session_id, json_extract(data,'$.state.input.filePath') file, time_created
       from part
       where rowid > ? and time_created > ?
         and json_extract(data,'$.type') = 'tool'
         and json_extract(data,'$.tool') in ('edit','write')
       order by time_created desc",
                &[js::num(lower), since_value.clone()],
            )
        },
        &mut |_, lower| window_covers(db, lower, &since_value),
    )?;
    let rows: Vec<EditRow> = rows
        .iter()
        .map(|row| EditRow { session: js::string(field(row, "session_id")), file: field(row, "file").clone(), time: time_of(field(row, "time_created")) })
        .collect();
    let generation = store.generation();
    store.edit_memo = version.map(|version| EditMemo { path: path.to_string(), generation, version, since, rows: rows.clone(), at: Instant::now() });
    Ok(rows)
}

type ByFile = IndexMap<String, (Value, IndexMap<String, Window>)>;

fn edit_windows_by_file(store: &mut Store, path: &str, since: f64, root: Option<&str>) -> Result<ByFile> {
    if !store.present(path) {
        return Ok(IndexMap::new());
    }
    let rows = recent_edit_rows(store, path, since)?;
    let mut by_file: ByFile = IndexMap::new();
    for row in &rows {
        if !js::truthy(&row.file) || !paths::within_root(&js::string(&row.file), root) {
            continue;
        }
        let entry = by_file.entry(js::string(&row.file)).or_insert_with(|| (row.file.clone(), IndexMap::new()));
        let window = entry.1.entry(row.session.clone()).or_insert(Window { first: row.time, last: row.time, edits: 0.0, finished: false, finished_at: None, started_at: None });
        window.first = window.first.min(row.time);
        window.last = window.last.max(row.time);
        window.edits += 1.0;
    }
    // Recent edits are not proof a worker still runs: its final part says so.
    let db = store.db(path)?;
    const LAST_PART: &str = "select time_created, json_extract(data,'$.type') type, json_extract(data,'$.reason') reason
    from part where rowid = (select rowid from part where session_id = ? order by time_created desc, id desc limit 1)";
    const SESSION_START: &str = "select time_created from session where id = ?";
    db.prepare_cached(LAST_PART).map_err(|error| error.to_string())?;
    db.prepare_cached(SESSION_START).map_err(|error| error.to_string())?;
    let ids: Vec<String> = {
        let mut seen = IndexMap::new();
        for (_, sessions) in by_file.values() {
            for id in sessions.keys() {
                seen.insert(id.clone(), ());
            }
        }
        seen.into_keys().collect()
    };
    let mut lifecycle: IndexMap<String, (bool, Option<f64>, Option<f64>)> = IndexMap::new();
    for id in ids {
        let last = one(db, LAST_PART, &[json!(id)])?;
        let finished = last.as_ref().is_some_and(|row| field(row, "type") == "step-finish" && field(row, "reason") == "stop");
        let finished_at = if finished { last.as_ref().and_then(|row| field(row, "time_created").as_f64()) } else { None };
        let started_at = one(db, SESSION_START, &[json!(id)])?.and_then(|row| field(&row, "time_created").as_f64());
        lifecycle.insert(id, (finished, finished_at, started_at));
    }
    for (_, sessions) in by_file.values_mut() {
        for (id, window) in sessions.iter_mut() {
            if let Some((finished, finished_at, started_at)) = lifecycle.get(id) {
                window.finished = *finished;
                window.finished_at = *finished_at;
                window.started_at = *started_at;
            }
        }
    }
    Ok(by_file)
}

/// Sessions whose edits on one file overlapped within `overlap` ms.
fn overlapping(sessions: &IndexMap<String, Window>, overlap: f64) -> HashSet<String> {
    let windows: Vec<(&String, &Window)> = sessions.iter().collect();
    let mut found = HashSet::new();
    for i in 0..windows.len() {
        for j in i + 1..windows.len() {
            let (a, b) = (windows[i].1, windows[j].1);
            let gap = (a.first - b.last).max(b.first - a.last);
            if gap <= overlap {
                found.insert(windows[i].0.clone());
                found.insert(windows[j].0.clone());
            }
        }
    }
    found
}

/// `b - a` as a sort answer, NaN and 0 meaning "look further".
fn descending(a: f64, b: f64) -> Ordering {
    let difference = b - a;
    if difference > 0.0 {
        Ordering::Greater
    } else if difference < 0.0 {
        Ordering::Less
    } else {
        Ordering::Equal
    }
}

struct OwnerEntry {
    session: String,
    edits: f64,
    last_edit: f64,
}

/// pickOwner: most edits, then latest edit, then the id in locale order.
fn pick_owner(entries: &[OwnerEntry]) -> Value {
    let mut sorted: Vec<&OwnerEntry> = entries.iter().collect();
    sorted.sort_by(|a, b| descending(a.edits, b.edits).then_with(|| descending(a.last_edit, b.last_edit)).then_with(|| js::locale_compare(&a.session, &b.session)));
    sorted.first().map_or(Value::Null, |entry| json!(entry.session))
}

#[derive(Default)]
struct Group {
    by_session: IndexMap<String, f64>,
    last_edit: IndexMap<String, f64>,
    first_edit: IndexMap<String, f64>,
    file_entries: Vec<(String, Value, f64)>,
    file_sessions: IndexMap<String, Vec<(String, f64, f64, f64)>>,
    finished: HashSet<String>,
    concurrent: bool,
    sequential: bool,
}

fn now_of(args: &Value) -> f64 {
    match arg(args, "now") {
        None => now_ms(),
        Some(value) => js::to_number(Some(value)),
    }
}

fn number_arg(args: &Value, key: &str, fallback: f64) -> f64 {
    match arg(args, key) {
        None => fallback,
        Some(value) => js::to_number(Some(value)),
    }
}

fn root_of(args: &Value) -> Option<String> {
    arg(args, "root").filter(|root| js::truthy(root)).map(js::string)
}

pub fn collisions(store: &mut Store, path: &str, args: &Value) -> Result<Value> {
    let now = now_of(args);
    let from = match arg(args, "since") {
        None | Some(Value::Null) => now - number_arg(args, "windowMs", 3_600_000.0),
        Some(since) => js::to_number(Some(since)),
    };
    let overlap_ms = number_arg(args, "overlapMs", 600_000.0);
    let root = root_of(args);
    let by_file = edit_windows_by_file(store, path, from, root.as_deref())?;
    let mut groups: IndexMap<String, Group> = IndexMap::new();
    for (key, (file, sessions)) in &by_file {
        if sessions.len() < 2 {
            continue;
        }
        let close = overlapping(sessions, overlap_ms);
        if close.len() < 2 {
            continue;
        }
        let included: Vec<(&String, &Window)> = sessions.iter().filter(|(id, _)| close.contains(*id)).collect();
        let mut ids: Vec<&String> = included.iter().map(|(id, _)| *id).collect();
        ids.sort();
        let group_key = ids.iter().map(|id| id.as_str()).collect::<Vec<_>>().join("|");
        let group = groups.entry(group_key).or_insert_with(|| Group { sequential: true, ..Default::default() });
        group.concurrent = group.concurrent || overlapping(sessions, 0.0).len() > 1;
        // Only proven sequential lifetimes retire an alert.
        let ended_before = |a: &Window, b: &Window| a.finished && matches!((a.finished_at, b.started_at), (Some(end), Some(start)) if end.is_finite() && start.is_finite() && end <= start);
        group.sequential = group.sequential
            && included.iter().enumerate().all(|(i, (_, a))| included.iter().enumerate().all(|(j, (_, b))| i == j || ended_before(a, b) || ended_before(b, a)));
        for (id, window) in &included {
            *group.by_session.entry((*id).clone()).or_insert(0.0) += window.edits;
            let last = group.last_edit.get(*id).copied().unwrap_or(0.0).max(window.last);
            group.last_edit.insert((*id).clone(), last);
            let first = group.first_edit.get(*id).copied().unwrap_or(window.first).min(window.first);
            group.first_edit.insert((*id).clone(), first);
            if window.finished {
                group.finished.insert((*id).clone());
            }
        }
        let latest = included.iter().map(|(_, window)| window.last).fold(f64::NEG_INFINITY, f64::max);
        group.file_entries.push((key.clone(), file.clone(), latest));
        group.file_sessions.insert(key.clone(), included.iter().map(|(id, window)| ((*id).clone(), window.edits, window.first, window.last)).collect());
    }
    let mut result: Vec<(Value, usize, f64, usize)> = Vec::new();
    for group in groups.values_mut() {
        group.file_entries.sort_by(|a, b| descending(a.2, b.2));
        let files: Vec<Value> = group.file_entries.iter().map(|(_, file, _)| file.clone()).collect();
        let sessions: Vec<(String, f64, f64, f64, bool, bool, Vec<Value>)> = group
            .by_session
            .iter()
            .map(|(id, edits)| {
                let first = group.first_edit.get(id).copied().unwrap_or(0.0);
                let last = group.last_edit.get(id).copied().unwrap_or(0.0);
                let finished = group.finished.contains(id);
                let active = !finished && now - last <= ACTIVE_EDIT_MS;
                let touched: Vec<Value> = group
                    .file_entries
                    .iter()
                    .filter(|(key, _, _)| group.file_sessions.get(key).is_some_and(|rows| rows.iter().any(|row| &row.0 == id)))
                    .map(|(_, file, _)| file.clone())
                    .collect();
                (id.clone(), *edits, first, last, finished, active, touched)
            })
            .collect();
        let owners: Vec<OwnerEntry> = sessions.iter().map(|s| OwnerEntry { session: s.0.clone(), edits: s.1, last_edit: s.3 }).collect();
        let owner = pick_owner(&owners);
        let overlap_first = sessions.iter().map(|s| s.2).fold(f64::NEG_INFINITY, f64::max);
        let overlap_last = sessions.iter().map(|s| s.3).fold(f64::INFINITY, f64::min);
        let ownership: Vec<Value> = group
            .file_entries
            .iter()
            .map(|(key, file, _)| {
                let rows: Vec<OwnerEntry> = group.file_sessions.get(key).map_or_else(Vec::new, |rows| rows.iter().map(|row| OwnerEntry { session: row.0.clone(), edits: row.1, last_edit: row.3 }).collect());
                json!({ "file": file, "owner": pick_owner(&rows) })
            })
            .collect();
        let edits: f64 = sessions.iter().map(|s| s.1).sum();
        let active = sessions.iter().any(|s| s.5);
        let handoff = owner.as_str().is_some_and(|owner| sessions.iter().find(|s| s.0 == owner).is_some_and(|s| !s.5));
        let session_values: Vec<Value> = sessions
            .iter()
            .map(|(id, edits, first, last, finished, active, touched)| {
                json!({ "sessionId": id, "edits": js::num(*edits), "firstEdit": js::num(*first), "lastEdit": js::num(*last), "finished": finished, "active": active, "files": touched })
            })
            .collect();
        let count = sessions.len();
        let file_count = files.len();
        result.push((
            json!({
                "file": files.first().cloned().unwrap_or(Value::Null),
                "files": files,
                "owner": owner,
                "ownership": ownership,
                "sessions": session_values,
                "overlap": { "first": js::num(overlap_first), "last": js::num(overlap_last) },
                "edits": js::num(edits),
                "active": active,
                "handoff": handoff,
                "concurrent": group.concurrent,
                "historyOnly": !group.concurrent && group.sequential,
            }),
            count,
            edits,
            file_count,
        ));
    }
    result.sort_by(|a, b| descending(a.1 as f64, b.1 as f64).then_with(|| descending(a.2, b.2)).then_with(|| descending(a.3 as f64, b.3 as f64)));
    Ok(Value::Array(result.into_iter().map(|row| row.0).collect()))
}

pub fn file_presence(store: &mut Store, path: &str, args: &Value) -> Result<Value> {
    let now = now_of(args);
    let from = match arg(args, "since") {
        None | Some(Value::Null) => now - number_arg(args, "windowMs", ACTIVE_EDIT_MS),
        Some(since) => js::to_number(Some(since)),
    };
    let root = root_of(args);
    let by_file = edit_windows_by_file(store, path, from, root.as_deref())?;
    let mut result: Vec<(Value, bool, usize, f64)> = Vec::new();
    for (file, sessions) in by_file.values() {
        let mut editors: Vec<(String, f64, f64)> = sessions
            .iter()
            .filter(|(_, window)| !window.finished && now - window.last <= ACTIVE_EDIT_MS)
            .map(|(id, window)| (id.clone(), window.edits, window.last))
            .collect();
        editors.sort_by(|a, b| descending(a.2, b.2).then_with(|| descending(a.1, b.1)).then_with(|| js::locale_compare(&a.0, &b.0)));
        if editors.is_empty() {
            continue;
        }
        let owners: Vec<OwnerEntry> = editors.iter().map(|e| OwnerEntry { session: e.0.clone(), edits: e.1, last_edit: e.2 }).collect();
        let colliding = editors.len() > 1;
        let newest = editors[0].2;
        result.push((
            json!({
                "file": file,
                "editors": editors.iter().map(|(id, edits, last)| json!({ "sessionId": id, "edits": js::num(*edits), "lastEdit": js::num(*last), "active": true })).collect::<Vec<_>>(),
                "owner": pick_owner(&owners),
                "colliding": colliding,
            }),
            colliding,
            editors.len(),
            newest,
        ));
    }
    result.sort_by(|a, b| descending(f64::from(u8::from(a.1)), f64::from(u8::from(b.1))).then_with(|| descending(a.2 as f64, b.2 as f64)).then_with(|| descending(a.3, b.3)));
    Ok(Value::Array(result.into_iter().map(|row| row.0).collect()))
}
