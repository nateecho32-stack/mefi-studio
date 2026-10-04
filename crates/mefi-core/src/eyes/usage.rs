//! usageLedger: every assistant turn's tokens and cost from the store's
//! message table, for Health and usage. A cold read pages down from the
//! newest row until it passes the window; a warm one reads the new rows, the
//! recent tail (OpenCode fills tokens in when a turn completes), and turns
//! still open by id. eyes.mjs usageRowOf and usageLedger.

use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use super::{all, arg, field, now_ms, one, Result, Row, Store};
use crate::{js, paths};

const PAGE: f64 = 4000.0;
const TAIL: f64 = 400.0;
const DAY_MS: f64 = 86_400_000.0;
const COLUMNS: &str = "m.rowid rid, m.id, m.session_id, m.time_created, m.data, s.directory, s.agent
     from message m left join session s on s.id = m.session_id";

/// One ledger row, kept serialised: a warm read of tens of thousands of rows
/// joins their text instead of copying a JSON tree per row.
#[derive(Clone)]
struct UsageRow {
    rowid: f64,
    at: f64,
    completed: bool,
    id: Value,
    directory: Value,
    json: String,
}

pub(crate) struct UsageCache {
    since: f64,
    top: f64,
    rows: IndexMap<String, UsageRow>,
}

fn finite_number(value: Option<&Value>) -> Value {
    value.and_then(js::finite).map_or(Value::Null, js::num)
}

/// usageRowOf: one message row as a ledger row, or None when it is not an assistant turn.
fn usage_row(raw: &Row) -> Option<UsageRow> {
    let data: Value = serde_json::from_str(&js::string(field(raw, "data"))).ok()?;
    if !js::truthy(&data) || !matches!(data, Value::Object(_) | Value::Array(_)) || js::get(&data, "role") != Some(&json!("assistant")) {
        return None;
    }
    let empty = json!({});
    let tokens = js::get(&data, "tokens").filter(|t| js::truthy(t) && matches!(t, Value::Object(_) | Value::Array(_))).unwrap_or(&empty);
    let cache = js::get(tokens, "cache").filter(|c| js::truthy(c) && matches!(c, Value::Object(_) | Value::Array(_))).unwrap_or(&empty);
    let text = |value: Option<&Value>| value.filter(|v| v.is_string()).cloned().unwrap_or(Value::Null);
    let directory = match field(raw, "directory") {
        Value::Null => text(js::path(&data, &["path", "cwd"])),
        other => other.clone(),
    };
    let agent = match js::get(&data, "agent") {
        Some(Value::String(agent)) => json!(agent),
        _ => js::or_null(raw.get("agent")),
    };
    let at = match finite_number(js::path(&data, &["time", "created"])) {
        Value::Null => field(raw, "time_created").clone(),
        created => created,
    };
    let completed = finite_number(js::path(&data, &["time", "completed"]));
    let count = |source: &Value, key: &str| match finite_number(js::get(source, key)) {
        Value::Null => json!(0),
        value => value,
    };
    let error = match js::path(&data, &["error", "name"]) {
        Some(Value::String(name)) => json!(name),
        _ if js::get(&data, "error").is_some_and(js::truthy) => json!("error"),
        _ => Value::Null,
    };
    let mut out = Map::new();
    out.insert("id".into(), field(raw, "id").clone());
    out.insert("sessionId".into(), field(raw, "session_id").clone());
    out.insert("directory".into(), directory);
    out.insert("agent".into(), agent);
    out.insert("at".into(), at.clone());
    out.insert("completedAt".into(), completed.clone());
    out.insert("provider".into(), text(js::get(&data, "providerID")));
    out.insert("model".into(), text(js::get(&data, "modelID")));
    out.insert("cost".into(), finite_number(js::get(&data, "cost")));
    out.insert(
        "tokens".into(),
        json!({
            "input": count(tokens, "input"),
            "output": count(tokens, "output"),
            "reasoning": count(tokens, "reasoning"),
            "cacheRead": count(cache, "read"),
            "cacheWrite": count(cache, "write"),
            "total": finite_number(js::get(tokens, "total")),
        }),
    );
    out.insert("finish".into(), text(js::get(&data, "finish")));
    out.insert("error".into(), error);
    let id = out["id"].clone();
    let directory = out["directory"].clone();
    let json = Value::Object(out).to_string();
    Some(UsageRow { rowid: js::to_number(Some(field(raw, "rid"))), at: js::to_number(Some(&at)), completed: !completed.is_null(), id, directory, json })
}

fn id_key(value: &Value) -> String {
    js::string(value)
}

pub fn usage_ledger(store: &mut Store, path: &str, args: &Value) -> Result<Value> {
    serde_json::from_str(&usage_ledger_json(store, path, args)?).map_err(|error| error.to_string())
}

/// The ledger as JSON text, the form the host sends on.
pub fn usage_ledger_json(store: &mut Store, path: &str, args: &Value) -> Result<String> {
    if !store.present(path) {
        return Ok(json!({ "ok": true, "rows": [], "scanned": 0, "since": null, "warm": false, "total": 0 }).to_string());
    }
    let now = match arg(args, "now") {
        None => now_ms(),
        Some(value) => js::to_number(Some(value)),
    };
    let from = arg(args, "since").and_then(js::finite).unwrap_or(now - 35.0 * DAY_MS);
    let limit = match arg(args, "limit") {
        None => 60000.0,
        Some(value) => js::to_number(Some(value)),
    };
    let root = arg(args, "root").filter(|root| js::truthy(root)).map(js::string);
    let mut cache = match store.usage.remove(path) {
        Some(cache) if cache.since <= from => cache,
        _ => UsageCache { since: from, top: 0.0, rows: IndexMap::new() },
    };
    let read = (|| -> Result<(f64, bool, f64)> {
        let db = store.db(path)?;
        let top = one(db, "select max(rowid) top from message", &[])?.and_then(|row| field(&row, "top").as_f64()).unwrap_or(0.0);
        let page_sql = format!("select {COLUMNS} where m.rowid > ? and m.rowid <= ? order by m.rowid desc");
        let warm = cache.top > 0.0;
        let mut scanned = 0.0;
        let mut absorb = |rows: Vec<Row>, cache: &mut UsageCache| -> Option<f64> {
            let mut oldest: Option<f64> = None;
            for raw in rows {
                scanned += 1.0;
                let created = js::to_number(Some(field(&raw, "time_created")));
                oldest = Some(oldest.map_or(created, |old| old.min(created)));
                match usage_row(&raw) {
                    None => {
                        cache.rows.shift_remove(&id_key(field(&raw, "id")));
                    }
                    Some(row) if row.at < from => {}
                    Some(row) => {
                        cache.rows.insert(id_key(field(&raw, "id")), row);
                    }
                }
            }
            oldest
        };
        if !warm {
            let mut upper = top;
            while upper > 0.0 {
                let lower = (upper - PAGE).max(0.0);
                let oldest = absorb(all(db, &page_sql, &[js::num(lower), js::num(upper)])?, &mut cache);
                upper = lower;
                if oldest.is_some_and(|oldest| oldest < from) {
                    break;
                }
            }
        } else {
            let lower = (cache.top.min(top) - TAIL).max(0.0);
            absorb(all(db, &page_sql, &[js::num(lower), js::num(top)])?, &mut cache);
            let open: Vec<(String, Value)> = cache
                .rows
                .iter()
                .filter(|(_, row)| !row.completed && row.rowid <= top - TAIL)
                .take(200)
                .map(|(key, row)| (key.clone(), row.id.clone()))
                .collect();
            let by_id = format!("select {COLUMNS} where m.id = ?");
            for (key, id) in open {
                match one(db, &by_id, &[id])? {
                    Some(fresh) => {
                        absorb(vec![fresh], &mut cache);
                    }
                    None => {
                        cache.rows.shift_remove(&key);
                    }
                }
            }
        }
        Ok((top, warm, scanned))
    })();
    let (top, warm, scanned) = match read {
        Ok(result) => result,
        Err(error) => {
            store.usage.insert(path.to_string(), cache);
            return Err(error);
        }
    };
    cache.top = top;
    cache.since = from;
    cache.rows.retain(|_, row| !(row.at < from));
    let mut rows: Vec<&UsageRow> = cache
        .rows
        .values()
        .filter(|row| root.as_ref().is_none_or(|root| paths::contains_path(root, &row.directory)))
        .collect();
    rows.sort_by(|a, b| {
        let difference = a.at - b.at;
        if difference < 0.0 {
            std::cmp::Ordering::Less
        } else if difference > 0.0 {
            std::cmp::Ordering::Greater
        } else if js::string(&a.id).encode_utf16().lt(js::string(&b.id).encode_utf16()) {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });
    let skip = if (rows.len() as f64) > limit { rows.len() - limit.max(0.0) as usize } else { 0 };
    let kept = &rows[skip..];
    let mut text = String::with_capacity(kept.iter().map(|row| row.json.len() + 1).sum::<usize>() + 128);
    text.push_str("{\"ok\":true,\"rows\":[");
    for (index, row) in kept.iter().enumerate() {
        if index > 0 {
            text.push(',');
        }
        text.push_str(&row.json);
    }
    let total = cache.rows.len();
    text.push_str(&format!("],\"scanned\":{},\"since\":{},\"warm\":{warm},\"total\":{total}}}", js::num(scanned), js::num(from)));
    store.usage.insert(path.to_string(), cache);
    Ok(text)
}
