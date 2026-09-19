import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ids = process.argv.slice(2);
if (!ids.length || ids.some((id) => !/^ses_[\w-]+$/.test(id))) {
  console.error("Usage: node scripts/_dump_sessions.mjs <session-id> [session-id ...]");
  process.exit(1);
}
const dbPath = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
const db = new DatabaseSync(dbPath, { readOnly: true });

for (const table of ["message", "session_input", "session_message", "session_share", "event"]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  console.log("TABLE", table, cols.join(","));
  for (const id of ids) {
    let rows = [];
    try {
      rows = db.prepare(`select * from ${table} where session_id = ?`).all(id);
    } catch {
      try {
        rows = db.prepare(`select * from ${table} where id = ?`).all(id);
      } catch (err) {
        console.log(table, "query err", err.message);
        continue;
      }
    }
    console.log(table, id, "count", rows.length);
    for (const row of rows) {
      const copy = { ...row };
      for (const key of Object.keys(copy)) {
        if (typeof copy[key] === "string" && copy[key].length > 1500) copy[key] = copy[key].slice(0, 1500) + "…";
      }
      console.log(JSON.stringify(copy));
    }
  }
}

console.log("\nEVENTS for selected sessions");
try {
  const events = db.prepare(`select id, aggregate_id, seq, type, substr(data,1,800) data from event where aggregate_id in (${ids.map(() => "?").join(", ")}) order by seq desc limit 40`).all(...ids);
  console.log("event count", events.length);
  for (const e of events) console.log(JSON.stringify(e));
} catch (err) {
  console.log("event err", err.message);
}

console.log("\nSELECTED SESSIONS");
const around = db.prepare(`select id, title, agent, parent_id, slug, time_created, time_updated from session where id in (${ids.map(() => "?").join(", ")}) order by time_created`).all(...ids);
for (const r of around) {
  console.log(JSON.stringify({ ...r, created: new Date(r.time_created).toISOString() }));
}

const logPath = path.join(os.homedir(), ".local", "share", "opencode", "log", "opencode.log");
if (existsSync(logPath)) {
  const text = readFileSync(logPath, "utf8");
  const lines = text.split(/\r?\n/);
  const hits = lines.filter((line) => ids.some((id) => line.includes(id)));
  console.log("\n==== LOG HITS", hits.length);
  for (const line of hits.slice(-80)) console.log(line.slice(0, 500));
}
db.close();
