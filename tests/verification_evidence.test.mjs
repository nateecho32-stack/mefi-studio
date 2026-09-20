// Recorded tool outcomes, never model prose: fixture DBs only, no commands run.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import * as eyes from "../scripts/eyes.mjs";
const { createProjects } = createRequire(import.meta.url)("../scripts/projects.cjs");

const scope = { sessionId: "ours", since: 100, until: 500 };
const part = ({ id = "check", session = "ours", at = 120, tool = "bash", type = "tool", command = "npm test", status = "completed", exit = 0, start = 120, end = 140, output = "All checks passed", truncated = false } = {}) => ({
  id, session_id: session, time_created: at,
  data: JSON.stringify({ type, tool, state: { status, input: { command }, metadata: { exit, truncated }, time: { start, end }, output } }),
});

async function fixture(run) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mefi-check-evidence-"));
  const file = path.join(folder, "sessions.db");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT); CREATE TABLE part (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)");
  db.prepare("INSERT INTO session VALUES (?, ?)").run("ours", folder);
  db.prepare("INSERT INTO session VALUES (?, ?)").run("foreign", path.join(os.tmpdir(), "somewhere-else"));
  const insert = db.prepare("INSERT INTO part VALUES (?, ?, ?, ?)");
  const add = (row) => insert.run(row.id, row.session_id, row.time_created, row.data);
  try { await run({ folder, file, db, add }); }
  finally {
    try { eyes.openDb(file).close(); } catch {}
    db.close();
    await rm(folder, { recursive: true, force: true });
  }
}

test("only the recorded completed process with explicit exit zero can pass", () => {
  const good = eyes.sessionCheckEvidence(part(), scope);
  assert.equal(good.passed, true);
  assert.equal(good.exitCode, 0);
  assert.equal(good.command, "npm test");
  assert.equal(good.sessionId, "ours");
  for (const exit of [null, "0", NaN]) assert.equal(eyes.sessionCheckEvidence(part({ exit }), scope).passed, null);
  assert.equal(eyes.sessionCheckEvidence(part({ exit: 1, output: "All tests passed" }), scope).passed, false, "prose cannot overrule a failed process");
  assert.equal(eyes.sessionCheckEvidence(part({ status: "error", exit: 0 }), scope).passed, false);
  for (const status of ["pending", "running", "unknown"]) assert.equal(eyes.sessionCheckEvidence(part({ status }), scope).passed, null);
  const missing = JSON.parse(part().data);delete missing.state.metadata.exit;
  assert.equal(eyes.sessionCheckEvidence({ ...part(), data: missing }, scope).passed, null, "missing exit is unknown, never zero");
});

test("worker text, edits, and other sessions are never execution evidence", () => {
  assert.equal(eyes.sessionCheckEvidence(part({ type: "text" }), scope), null);
  assert.equal(eyes.sessionCheckEvidence(part({ tool: "edit" }), scope), null);
  assert.equal(eyes.sessionCheckEvidence(part({ session: "foreign" }), scope), null);
  assert.equal(eyes.sessionCheckEvidence({ ...part(), data: "malformed" }, scope), null);
  assert.equal(eyes.sessionCheckEvidence(part({ command: " " }), scope), null);
  assert.equal(eyes.sessionCheckEvidence(part({ command: { name: "npm test" } }), scope), null);
  assert.equal(eyes.sessionCheckEvidence(part(), { ...scope, since: undefined }), null);
  assert.equal(eyes.sessionCheckEvidence(part(), { ...scope, until: 90 }), null);
  // Low-level evidence deliberately does not call a harmless echo a test.
  assert.equal(eyes.sessionCheckEvidence(part({ command: 'echo "npm test passed"' }), scope).passed, true);
});

test("checks stay inside the exact attempt's time window", () => {
  for (const patch of [{ at: 99 }, { at: 501 }, { start: 99 }, { start: 501 }, { end: 99 }, { end: 501 }]) assert.equal(eyes.sessionCheckEvidence(part(patch), scope), null, JSON.stringify(patch));
  assert.equal(eyes.sessionCheckEvidence(part({ at: 100, start: 100, end: 500 }), scope).passed, true, "inclusive attempt boundaries");
  for (const patch of [{ start: null }, { end: null }, { start: "120" }, { end: 110 }]) assert.equal(eyes.sessionCheckEvidence(part(patch), scope).passed, null, "unknown or inverted timing is not passing evidence");
});

test("tool output and commands are bounded without hiding their truncation", () => {
  const long = eyes.sessionCheckEvidence(part({ command: "a".repeat(6000), output: "b".repeat(3000) + "THE END" }), scope);
  assert.equal(long.command.length, 4000);assert.equal(long.commandTruncated, true);
  assert.equal(long.outputExcerpt.length, 2000);assert(long.outputExcerpt.endsWith("THE END"));
  assert.equal(long.outputTruncated, true);
  assert.equal(eyes.sessionCheckEvidence(part({ truncated: true }), scope).outputTruncated, true);
});

test("read-only session scan includes failed and unknown outcomes, not unrelated parts", async () => fixture(({ file, add }) => {
  add(part({ id: "passing" }));add(part({ id: "failed", at: 150, exit: 3 }));
  add(part({ id: "unknown", at: 160, exit: null }));
  add(part({ id: "boolean-exit", at: 165, exit: false }));
  add(part({ id: "string-exit", at: 166, exit: "0" }));
  add(part({ id: "running", at: 170, status: "running", end: null }));
  add(part({ id: "foreign", session: "foreign" }));add(part({ id: "old", at: 80, start: 80, end: 90 }));
  add(part({ id: "future", at: 600, start: 600, end: 620 }));add(part({ id: "text", type: "text" }));
  add({ ...part({ id: "invalid" }), data: "malformed" });
  add(part({ id: "object-command", command: { name: "npm test" } }));
  const result = eyes.listSessionChecks({ dbPath: file, ...scope });
  assert.equal(result.available, true);assert.equal(result.truncated, false);
  assert.deepEqual(result.checks.map((row) => [row.id, row.passed]), [["running", null], ["string-exit", null], ["boolean-exit", null], ["unknown", null], ["failed", false], ["passing", true]]);
  assert.throws(() => eyes.openDb(file).exec("DELETE FROM part"), /readonly/i, "the evidence reader cannot mutate live sessions");
}));

test("scan truncation, output truncation, empty windows, and unavailable stores are distinct", async () => fixture(({ file, folder, add }) => {
  add(part({ id: "first", at: 120 }));add(part({ id: "second", at: 130, truncated: true }));
  add(part({ id: "third", at: 140, command: "x".repeat(5000), output: "x".repeat(5000) }));
  const result = eyes.listSessionChecks({ dbPath: file, ...scope, limit: 2 });
  assert.equal(result.available, true);assert.equal(result.truncated, true);
  assert.equal(result.checks[0].commandTruncated, true);assert.equal(result.checks[0].outputTruncated, true);
  assert.equal(result.checks[1].outputTruncated, true, "provider's explicit truncation survives SQLite boolean encoding");
  assert.deepEqual(eyes.listSessionChecks({ dbPath: file, sessionId: "ours", since: 300, until: 400 }), { available: true, checks: [], truncated: false });
  assert.equal(eyes.listSessionChecks({ dbPath: path.join(folder, "missing.db"), ...scope }).available, false);
  assert.equal(eyes.listSessionChecks({ dbPath: file, sessionId: "ours" }).available, false);
}));

test("project facade reads only an exact session owned by this project", async () => fixture(({ file, folder, add }) => {
  add(part());add(part({ id: "foreign", session: "foreign" }));
  const projects = createProjects({ defaultRoot: folder, studioRoot: folder, isDirectory: () => true });
  const project = projects.add(folder);
  projects.select(project.id);
  const scoped = projects.eyes(eyes);
  assert.equal(scoped.listSessionChecks({ dbPath: file, ...scope }).checks.length, 1);
  const other = scoped.listSessionChecks({ dbPath: file, ...scope, sessionId: "foreign" });
  assert.equal(other.available, false);assert.deepEqual(other.checks, []);
  assert.equal(scoped.listSessionChecks({ dbPath: file, ...scope, sessionId: "missing" }).available, false);
}));

test("attempt-scoped edits cannot borrow earlier or later writes in a resumed session", async () => fixture(({ file, folder, add }) => {
  const write = (id, at, start, end) => ({ id, session_id: "ours", time_created: at, data: JSON.stringify({ type: "tool", tool: "write", state: { status: "completed", input: { filePath: "inside.js", content: "x" }, time: { start, end } } }) });
  add(write("earlier", 90, 90, 110));add(write("current", 120, 120, 140));
  add(write("previous-start", 130, 90, 140));add(write("later-finish", 140, 140, 510));
  add(write("unknown-time", 150, null, null));add(write("future", 550, 550, 570));
  add({ id: "patch", session_id: "ours", time_created: 160, data: JSON.stringify({ type: "patch", files: ["patch.js"] }) });
  const options = { dbPath: file, ...scope };
  assert.deepEqual(eyes.listChanges(options).map((row) => row.id), ["patch", "current"]);
  assert.equal(eyes.listChanges({ dbPath: file, sessionId: "ours" }).length, 7, "timeline callers still see historical changes");
  const projects = createProjects({ defaultRoot: folder, studioRoot: folder, isDirectory: () => true });
  const project = projects.add(folder);
  projects.select(project.id);
  // Existing listChanges project filtering uses listSessions. Supply a local
  // fixture implementation so its full historical schema is unnecessary.
  const scoped = projects.eyes({ ...eyes, listSessions: () => [{ id: "ours", directory: folder }] });
  assert.deepEqual(scoped.listChanges(options).map((row) => row.id), ["patch", "current"], "the project facade forwards the attempt window");
  assert.deepEqual(eyes.listChanges({ ...options, until: 90 }), []);
}));
