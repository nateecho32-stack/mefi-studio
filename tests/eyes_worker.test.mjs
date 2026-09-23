// The eyes worker: OpenCode-store reads leave the main thread. A fixture
// module stands in for scripts/eyes.mjs to provoke a busy read, a hang, a
// crash and a bad result; the real module runs once against a temporary
// SQLite store to prove the folder scoping the facade now relies on.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { threadId } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import * as fixtureModule from "./fixtures/eyes-worker-fixture.mjs";

const require = createRequire(import.meta.url);
const { createEyesClient, wrapEyes, EYES_WORKER_METHODS } = require("../scripts/eyes-client.cjs");
const { createProjects } = require("../scripts/projects.cjs");
const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(studioRoot, "tests", "fixtures", "eyes-worker-fixture.mjs");

function fixtureClient(options = {}) {
  return createEyesClient({ studioRoot, modulePath: fixturePath, ...options });
}

test("store reads run on another thread and leave the caller's event loop turning", async () => {
  const client = fixtureClient();
  try {
    let ticks = 0;
    let worstGapMs = 0;
    let last = performance.now();
    const timer = setInterval(() => { const now = performance.now(); worstGapMs = Math.max(worstGapMs, now - last); last = now; ticks += 1; }, 10);
    const rows = await client.call("listSessions", { busyMs: 400, limit: 2 });
    clearInterval(timer);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].threadId, threadId, "the read ran on a worker thread, not the caller's");
    assert.ok(ticks >= 5, `the caller's timers kept firing during a 400 ms read (${ticks} ticks)`);
    assert.ok(worstGapMs < 350, `the caller's event loop never waited out the read (worst gap ${worstGapMs.toFixed(0)} ms)`);
    assert.equal(client.status().spawns, 1);
  } finally {
    await client.close();
  }
});

test("arguments and results round-trip; a thrown store error keeps its message and code", async () => {
  const client = fixtureClient();
  try {
    const args = { since: 5, list: [1, 2], nested: { root: "C:/x" } };
    const echoed = await client.call("activitySince", args);
    assert.deepEqual(echoed.echoed, args);
    await assert.rejects(client.call("collisions"), (error) => error.message.includes("database not found") && error.code === "ENOENT");
    // A result that cannot cross the thread boundary fails that read only.
    await assert.rejects(client.call("filePresence"));
    assert.equal((await client.call("listSessions", { limit: 1 })).length, 1, "the worker survived the failed read");
    assert.equal(client.status().spawns, 1);
  } finally {
    await client.close();
  }
});

test("only store reads are callable; openDb never runs on the main thread", async () => {
  const client = fixtureClient();
  try {
    await assert.rejects(client.call("openDb"), TypeError);
    await assert.rejects(client.call("readJson"), TypeError);
    assert.ok(EYES_WORKER_METHODS.includes("listSessions") && !EYES_WORKER_METHODS.includes("openDb"));
    const wrapped = wrapEyes(fixtureModule, client);
    assert.throws(() => wrapped.openDb(), /eyes worker/);
    assert.ok(wrapped.listSessions({ limit: 1 }) instanceof Promise, "store reads become worker calls");
    assert.equal((await wrapped.listSessions({ limit: 1 })).length, 1);
    assert.equal(wrapped.eyesWorkerStatus().calls, 2, "both listSessions calls above went to the worker");
  } finally {
    await client.close();
  }
});

test("a worker that dies mid-read rejects the pending read and the next read respawns it", async () => {
  const client = fixtureClient();
  try {
    await assert.rejects(client.call("listChanges"), /worker exited/);
    assert.equal(client.status().running, false);
    assert.equal((await client.call("listSessions", { limit: 1 })).length, 1);
    const status = client.status();
    assert.equal(status.spawns, 2);
    assert.equal(status.failures, 1);
  } finally {
    await client.close();
  }
});

test("a read past the timeout rejects and restarts the worker instead of queueing behind it", async () => {
  const client = fixtureClient({ timeoutMs: 150 });
  try {
    await assert.rejects(client.call("listTodos"), /timed out after 150 ms/);
    assert.equal(client.status().restarts, 1);
    // The read after the respawn pays for a fresh worker thread and its module
    // load; 150 ms is the hang budget under test, not a startup budget, and a
    // loaded desktop blew it (the "read past the timeout" flake).
    assert.equal((await client.call("listSessions", { limit: 1 }, { timeoutMs: 15000 })).length, 1);
    assert.equal(client.status().spawns, 2);
  } finally {
    await client.close();
  }
});

test("a new module version restarts the worker and a closed client rejects every later read", async () => {
  const client = fixtureClient();
  await client.call("listSessions", { limit: 1 });
  client.setVersion(1);
  assert.equal(client.status().running, false);
  await client.call("listSessions", { limit: 1 });
  assert.equal(client.status().spawns, 2);
  await client.close();
  await assert.rejects(client.call("listSessions"), /closed/);
});

test("the real reader scopes sessions by folder through the worker and the project facade", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mefi-eyes-worker-"));
  const project = path.join(folder, "project");
  const file = path.join(folder, "sessions.db");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, agent TEXT, model TEXT, directory TEXT, cost REAL,
      tokens_input INTEGER, tokens_output INTEGER, tokens_cache_read INTEGER, summary_files INTEGER, summary_additions INTEGER,
      summary_deletions INTEGER, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE todo (session_id TEXT, content TEXT, status TEXT, priority TEXT, position INTEGER, time_created INTEGER, time_updated INTEGER);`);
  const session = db.prepare("INSERT INTO session VALUES (?, NULL, ?, 'build', '{}', ?, 0, 0, 0, 0, 0, 0, 0, ?, ?)");
  const todo = db.prepare("INSERT INTO todo VALUES (?, ?, 'pending', 'medium', 0, 1, 1)");
  const rows = [
    ["inside", project, 30],
    ["nested", path.join(project, "src"), 20],
    ["neighbor", `${project}-neighbor`, 40],
    ["elsewhere", path.join(folder, "other"), 50],
  ];
  for (const [id, directory, at] of rows) { session.run(id, `Session ${id}`, directory, at, at); todo.run(id, `todo of ${id}`); }
  db.close();
  const client = createEyesClient({ studioRoot });
  try {
    const dbPath = file;
    assert.deepEqual((await client.call("listSessionIds", { dbPath, root: project })).sort(), ["inside", "nested"], "only sessions under the folder");
    assert.deepEqual((await client.call("listSessions", { dbPath, root: project, limit: 1 })).map((row) => row.id), ["inside"]);
    assert.deepEqual((await client.call("listSessions", { dbPath, limit: 10 })).map((row) => row.id), ["elsewhere", "neighbor", "inside", "nested"], "no root keeps the old unscoped listing");
    assert.equal(await client.call("sessionDirectory", { dbPath, sessionId: "nested" }), path.join(project, "src"));
    assert.equal(await client.call("sessionDirectory", { dbPath, sessionId: "missing" }), null);
    const eyes = await import("../scripts/eyes.mjs");
    const projects = createProjects({ defaultRoot: project, studioRoot: folder, isDirectory: () => true });
    projects.select(projects.add(project).id);
    const scoped = projects.eyes(wrapEyes(eyes, client));
    assert.deepEqual((await scoped.listSessions({ dbPath })).map((row) => row.id), ["inside", "nested"]);
    assert.deepEqual((await scoped.listTodos({ dbPath })).map((row) => row.sessionId).sort(), ["inside", "nested"], "todo reads are scoped by the folder's session ids");
    assert.equal((await scoped.listSessionChecks({ dbPath, sessionId: "elsewhere", since: 1, until: 2 })).available, false, "another folder's session yields no evidence");
    assert.equal(await scoped.findRunSession({ dbPath, runId: "run_1_1" }), null);
    assert.throws(() => scoped.openDb(dbPath), /eyes worker/, "the facade never opens the store on the main thread");
  } finally {
    await client.call("closeReadDb").catch(() => {});
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test("the facade shares one session-scope read across the reads of an operation", async () => {
  let idReads = 0;
  const fake = {
    listSessionIds: async () => { idReads += 1; return ["a"]; },
    listSessions: async () => [{ id: "a", directory: "C:/proj" }],
    listTodos: async () => [{ sessionId: "a" }, { sessionId: "b" }],
    listChanges: async () => [{ sessionId: "a", file: "C:/elsewhere/x.js" }, { sessionId: "a", file: "C:/proj/y.js" }],
    readJson: async () => [],
    writeJson: async () => {},
  };
  const projects = createProjects({ defaultRoot: "C:/proj", studioRoot: "C:/studio", isDirectory: () => true });
  projects.select(projects.add("C:/proj").id);
  const scoped = projects.eyes(fake);
  const [todos, changes] = await Promise.all([scoped.listTodos(), scoped.listChanges()]);
  assert.deepEqual(todos, [{ sessionId: "a" }]);
  assert.deepEqual(changes, [{ sessionId: "a", file: "C:/proj/y.js" }]);
  assert.equal(idReads, 1, "two concurrent reads shared one scope read");
  await scoped.listTodos();
  assert.equal(idReads, 1, "a read inside the scope window reuses it");
});
