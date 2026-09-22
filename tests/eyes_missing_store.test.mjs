// First-run Studio has no OpenCode store until OpenCode is used. Listing reads
// must treat "no store yet" as an empty store — the boot's session-tree step
// then shows "no recent sessions" instead of gating the whole app on
// "store unavailable" — while a store that exists but cannot be read still
// surfaces the failure. Regression for the fresh-profile startup gate.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  activitySince, assistantFacts, closeReadDb, collisions, filePresence,
  findRunSession, listChanges, listChatTexts, listSessionChecks, listSessions, listTodos,
} from "../scripts/eyes.mjs";

const missingPath = () => path.join(os.tmpdir(), `mefi-eyes-missing-${process.pid}-${Math.random().toString(36).slice(2)}`, "opencode.db");

test("a never-created OpenCode store reads as empty, not as a failure", () => {
  const dbPath = missingPath();
  assert.deepEqual(listSessions({ dbPath }), []);
  assert.deepEqual(listChanges({ dbPath }), []);
  assert.deepEqual(listTodos({ dbPath }), []);
  assert.deepEqual(activitySince({ dbPath }), []);
  assert.deepEqual(listChatTexts({ dbPath }), []);
  assert.deepEqual(collisions({ dbPath }), []);
  assert.deepEqual(filePresence({ dbPath }), []);
  assert.equal(findRunSession({ dbPath, runId: "run_absent" }), null);
  const checks = listSessionChecks({ dbPath, sessionId: "ses_missing", since: 1, until: 2 });
  assert.equal(checks.available, false, "check evidence stays explicitly unavailable without a store");
  const facts = assistantFacts({ dbPath, root: null, porcelain: "" });
  assert.deepEqual(facts.sessions, []);
  assert.deepEqual(facts.collisions, []);
  assert.deepEqual(facts.presence, []);
  assert.deepEqual(facts.uncommitted, []);
});

test("a store that exists but cannot be read still surfaces the read failure", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mefi-eyes-broken-"));
  t.after(async () => {
    closeReadDb();
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  });
  const dbPath = path.join(directory, "opencode.db");
  await writeFile(dbPath, "this is not a sqlite database");
  assert.throws(() => listSessions({ dbPath }), /not a database/i);
  closeReadDb();
});

// A store file without its session schema — OpenCode created opencode.db but
// never finished its first start, or an upgrade left only migration
// bookkeeping — must read as an empty store with a diagnosis, not gate the
// Command view on "no such table: session". Regression for a reported
// "Store unavailable · no such table: session" first launch.
test("a store file without the session table reads as empty and storeStatus says why", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const directory = await mkdtemp(path.join(os.tmpdir(), "mefi-eyes-noschema-"));
  t.after(async () => {
    closeReadDb();
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  });
  const dbPath = path.join(directory, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec("create table migration (id integer primary key, name text)");
  db.close();
  const { storeStatus, usageLedger } = await import("../scripts/eyes.mjs");
  assert.deepEqual(listSessions({ dbPath }), []);
  assert.deepEqual(listTodos({ dbPath }), []);
  assert.deepEqual(listChanges({ dbPath }), []);
  assert.deepEqual(collisions({ dbPath }), []);
  assert.equal(usageLedger({ dbPath }).rows.length, 0);
  const status = storeStatus({ dbPath });
  assert.equal(status.ok, false);
  assert.equal(status.present, true);
  assert.equal(status.reason, "no-session-table");
  assert.match(status.note, /no session table/);
  assert.match(status.note, /migration/);
  assert.match(status.note, /open OpenCode once/i);
  closeReadDb();
  // The schema gains its tables (OpenCode's first start) and the same path
  // reads normally afterwards.
  const grown = new DatabaseSync(dbPath);
  grown.exec("create table session (id text primary key, parent_id text, title text, agent text, model text, directory text, cost real, tokens_input integer, tokens_output integer, tokens_cache_read integer, summary_files integer, summary_additions integer, summary_deletions integer, time_created integer, time_updated integer)");
  grown.exec("create table message (id text primary key, session_id text, time_created integer, data text)");
  grown.exec("create table part (id text primary key, session_id text, message_id text, time_created integer, data text)");
  grown.exec("create table todo (id text primary key, session_id text, data text)");
  grown.exec("insert into session (id, title, directory, time_created, time_updated) values ('ses_1', 'first', '/tmp/x', 1, 2)");
  grown.close();
  assert.equal(storeStatus({ dbPath }).ok, true);
  assert.equal(listSessions({ dbPath }).length, 1);
});

test("storeStatus names a missing store and the legacy JSON layout", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mefi-eyes-legacy-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const { storeStatus } = await import("../scripts/eyes.mjs");
  const dbPath = path.join(directory, "opencode.db");
  const missing = storeStatus({ dbPath });
  assert.equal(missing.ok, false);
  assert.equal(missing.present, false);
  assert.match(missing.note, /Run OpenCode once/);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(directory, "storage", "session"), { recursive: true });
  const legacy = storeStatus({ dbPath });
  assert.equal(legacy.legacy, true);
  assert.match(legacy.note, /storage\//);
});
