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
