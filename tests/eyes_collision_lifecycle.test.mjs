import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { assistantFacts, closeReadDb, collisions, filePresence, requestsFromCollisions } from "../scripts/eyes.mjs";

const NOW = 1_800_000_000_000;
const MINUTE = 60000;

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "mefi-collision-life-"));
  const dbPath = path.join(dir, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec("create table session (id text primary key, time_created integer); create table part (id text primary key, session_id text, time_created integer, data text)");
  let seq = 0;
  const part = (session, at, data) => db.prepare("insert into part values (?,?,?,?)").run(`p${++seq}`, session, at, JSON.stringify(data));
  t.after(() => {
    closeReadDb(); db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return {
    dbPath,
    start: (id, at) => db.prepare("insert into session values (?,?)").run(id, at),
    edit: (id, file, at) => part(id, at, { type: "tool", tool: "edit", state: { status: "completed", input: { filePath: `C:/fixture/${file}` } } }),
    finish: (id, at) => part(id, at, { type: "step-finish", reason: "stop" }),
  };
}

test("a completed sequential handoff stays inspectable but cannot mint a collision repair", async (t) => {
  const f = fixture(t);
  f.start("first", NOW - 10 * MINUTE);
  f.edit("first", "game.js", NOW - 9 * MINUTE);
  f.edit("first", "index.html", NOW - 8.5 * MINUTE);
  f.finish("first", NOW - 8 * MINUTE);
  f.start("followup", NOW - 3 * MINUTE);
  f.edit("followup", "game.js", NOW - MINUTE);
  f.edit("followup", "index.html", NOW - 30000);
  const options = { dbPath: f.dbPath, now: NOW, root: "C:/fixture" };
  const rows = collisions(options);
  assert.equal(rows.length, 1, "the inspector retains the same recent edit history");
  assert.equal(rows[0].historyOnly, true);
  assert.equal(rows[0].concurrent, false);
  assert.equal(rows[0].sessions.find((row) => row.sessionId === "first").active, false);
  assert.equal(rows[0].sessions.find((row) => row.sessionId === "first").finished, true);
  assert.deepEqual(requestsFromCollisions(rows), [], "the history must not create a speculative repair task");
  assert.ok(filePresence(options).every((row) => row.editors.every((editor) => editor.sessionId === "followup")), "an ended worker is no longer a live editor");
  assert.deepEqual((await assistantFacts({ ...options, sessions: [], changes: [], todos: [], porcelain: "" })).collisions, [], "history is not an actionable assistant finding");
});

test("finished peers do not hide genuine overlapping edits or get instructions to stop", (t) => {
  const f = fixture(t);
  f.start("finished", NOW - 5 * MINUTE);
  f.start("live", NOW - 4 * MINUTE);
  f.edit("finished", "game.js", NOW - 90000);
  f.edit("live", "game.js", NOW - 60000);
  f.edit("finished", "game.js", NOW - 40000);
  f.finish("finished", NOW - 30000);
  f.edit("live", "game.js", NOW - 20000);
  const rows = collisions({ dbPath: f.dbPath, now: NOW });
  assert.equal(rows[0].concurrent, true);
  assert.equal(rows[0].historyOnly, false);
  const [request] = requestsFromCollisions(rows);
  assert.ok(request);
  assert.doesNotMatch(request.prompt, /finished must stop/);
  assert.match(request.prompt, /other sessions have finished/);
  assert.equal(rows[0].sessions.find((row) => row.sessionId === "finished").active, false);
});

test("concurrent session lifetimes remain a possible conflict even with nonoverlapping single edits", (t) => {
  const f = fixture(t);
  f.start("a", NOW - 5 * MINUTE);
  f.start("b", NOW - 4 * MINUTE);
  f.edit("a", "game.js", NOW - 2 * MINUTE);
  f.finish("a", NOW - 90000);
  f.edit("b", "game.js", NOW - MINUTE);
  const rows = collisions({ dbPath: f.dbPath, now: NOW });
  assert.equal(rows[0].concurrent, false);
  assert.equal(rows[0].historyOnly, false, "completion after a peer started does not establish a sequential handoff");
  assert.equal(requestsFromCollisions(rows).length, 1);
});

test("a three-session overlap chain survives an empty overall intersection", (t) => {
  const f = fixture(t);
  for (const id of ["a", "b", "c"]) f.start(id, NOW - 5 * MINUTE);
  for (const [id, offsets] of [["a", [-100000, -60000]], ["b", [-70000, -30000]], ["c", [-40000, -10000]]]) {
    for (const offset of offsets) f.edit(id, "game.js", NOW + offset);
  }
  f.finish("a", NOW - 50000);
  const rows = collisions({ dbPath: f.dbPath, now: NOW });
  assert.ok(rows[0].overlap.first > rows[0].overlap.last);
  assert.equal(rows[0].concurrent, true);
  assert.equal(rows[0].historyOnly, false);
  assert.equal(requestsFromCollisions(rows).length, 1);
});

test("a resumed session becomes a live editor after its newer part", (t) => {
  const f = fixture(t);
  f.start("resumed", NOW - 5 * MINUTE);
  f.edit("resumed", "game.js", NOW - 2 * MINUTE);
  f.finish("resumed", NOW - MINUTE);
  assert.deepEqual(filePresence({ dbPath: f.dbPath, now: NOW }), []);
  f.edit("resumed", "game.js", NOW - 1000);
  assert.equal(filePresence({ dbPath: f.dbPath, now: NOW })[0].editors[0].sessionId, "resumed");
});

test("the host cache used by watcher, compaction and dispatch excludes history-only handoffs", async () => {
  const source = readFileSync(new URL("../main.cjs", import.meta.url), "utf8");
  const start = source.indexOf("async function assistantReadStore(");
  const end = source.indexOf("async function assistantOrganize(", start);
  assert.ok(start >= 0 && end > start);
  const historic = { file: "old.js", historyOnly: true }, live = { file: "live.js", historyOnly: false };
  const rows = [historic, live];
  const eyes = {
    listSessions: () => [], listTodos: () => [], collisions: () => rows,
    filePresence: () => [], listChanges: () => [], uncommittedOnly: () => [],
  };
  const env = vm.createContext({
    assistantStoreReadInFlight: null, getEyes: async () => eyes, readPorcelain: () => "", projectRoot: () => "C:/fixture",
    assistantCache: { chatsAt: Date.now() }, MINUTE_MS: MINUTE,
  });
  vm.runInContext(source.slice(start, end), env);
  const store = await env.assistantReadStore();
  assert.deepEqual(Array.from(store.collisions), [live]);
  assert.equal(env.assistantCache.store, store);
  assert.equal(rows.length, 2, "the source history remains available to the inspector");
});
