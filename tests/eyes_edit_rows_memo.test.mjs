// collisions (1 h) and filePresence (10 min) share one scan of the recent
// edit parts while the store's data_version holds. Results must be exactly
// what a fresh scan reads, and any commit by another connection (a new part
// or an in-place update) must be seen at once.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collisions, filePresence, closeReadDb } from "../scripts/eyes.mjs";

const NOW = 1_800_000_000_000;
const dirs = [];
test.after(() => {
  closeReadDb();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
});

const data = (file, tool = "edit") => JSON.stringify({ type: "tool", tool, state: { status: "completed", input: { filePath: `C:/fixture/${file}` } } });

function store() {
  const dir = mkdtempSync(path.join(tmpdir(), "mefi-edit-rows-"));
  dirs.push(dir);
  const dbPath = path.join(dir, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec("create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text)");
  // collisions() reads each session's start (sequential lifetimes retire an alert).
  db.exec("create table message (id text primary key, session_id text, data text)");
  db.exec("create table session (id text primary key, parent_id text, directory text, title text, time_created integer, time_updated integer)");
  for (const id of ["s_a", "s_b", "s_c", "s_d"]) db.prepare("insert into session (id, time_created, time_updated) values (?,?,?)").run(id, NOW - 90 * 60000, NOW);
  const insert = db.prepare("insert into part values (?,?,?,?,?,?)");
  const rows = [
    ["p1", "s_a", "shared.lua", NOW - 50 * 60000], ["p2", "s_b", "shared.lua", NOW - 45 * 60000],
    ["p3", "s_a", "live.lua", NOW - 5 * 60000], ["p4", "s_b", "live.lua", NOW - 4 * 60000],
    ["p5", "s_c", "solo.lua", NOW - 3 * 60000], ["p6", "s_c", "old.lua", NOW - 70 * 60000],
  ];
  for (const [id, session, file, at] of rows) insert.run(id, `m_${id}`, session, at, at, data(file));
  return { dbPath, writer: db };
}

const fresh = (read) => { closeReadDb(); return read(); };

test("presence read after collisions matches a fresh scan, and new or updated parts are seen at once", () => {
  const { dbPath, writer } = store();
  const root = "C:/fixture";
  const clash = collisions({ dbPath, now: NOW, root });
  const presence = filePresence({ dbPath, now: NOW, root });
  assert.deepEqual(presence, fresh(() => filePresence({ dbPath, now: NOW, root })));
  assert.deepEqual(clash, fresh(() => collisions({ dbPath, now: NOW, root })));
  assert.deepEqual(presence.map((row) => row.file), ["C:/fixture/live.lua", "C:/fixture/solo.lua"]);
  assert.deepEqual(clash.flatMap((row) => row.files ?? [row.file]).sort(), ["C:/fixture/live.lua", "C:/fixture/shared.lua"]);
  // A narrower root reuses the same rows and filters them the same way.
  assert.deepEqual(filePresence({ dbPath, now: NOW, root: "C:/elsewhere" }), []);

  collisions({ dbPath, now: NOW, root });
  writer.prepare("insert into part values (?,?,?,?,?,?)").run("p7", "m_p7", "s_d", NOW - 60000, NOW - 60000, data("solo.lua", "write"));
  const joined = filePresence({ dbPath, now: NOW, root });
  assert.equal(joined.find((row) => row.file === "C:/fixture/solo.lua").editors.length, 2, "a part committed after the scan is read");
  assert.deepEqual(joined, fresh(() => filePresence({ dbPath, now: NOW, root })));

  collisions({ dbPath, now: NOW, root });
  writer.prepare("update part set data = ? where id = ?").run(data("moved.lua"), "p5");
  const moved = filePresence({ dbPath, now: NOW, root });
  assert.ok(moved.some((row) => row.file === "C:/fixture/moved.lua"), "an in-place update is read");
  assert.deepEqual(moved, fresh(() => filePresence({ dbPath, now: NOW, root })));

  // A wider window than the kept scan reads the store again.
  const wide = collisions({ dbPath, now: NOW, root, windowMs: 2 * 60 * 60000 });
  assert.deepEqual(wide, fresh(() => collisions({ dbPath, now: NOW, root, windowMs: 2 * 60 * 60000 })));
  writer.close();
});
