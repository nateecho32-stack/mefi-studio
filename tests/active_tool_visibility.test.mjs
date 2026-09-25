// Current worker tools are observations, not completion claims. Disposable
// SQLite stores and pure formatter calls only; no live sessions or commands.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import * as eyes from "../scripts/eyes.mjs";
import projectsModule from "../scripts/projects.cjs";
import activity from "../scripts/executor-activity.cjs";

const { createProjects } = projectsModule;
const { workerActivity } = activity;
const scope = { sessionId: "ours", since: 100, until: 500 };
const controls = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
const part = ({
  id = "running", session = "ours", at = 120, updated = 130,
  type = "tool", tool = "bash", status = "running", start = at, end,
  description = "Checking game controls", command = "node --test tests/game.test.mjs",
  output = "synthetic-private-tool-output", metadataOutput = "synthetic-private-metadata-output",
} = {}) => ({
  id, session, at, updated,
  data: JSON.stringify({ type, tool, state: {
    status, input: { description, command }, time: { start, end }, output,
    metadata: { output: metadataOutput },
  } }),
});

async function fixture(run) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mefi-active-tools-"));
  const file = path.join(folder, "sessions.db");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT); CREATE TABLE part (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  const session = db.prepare("INSERT INTO session VALUES (?, ?)");
  session.run("ours", folder);
  session.run("nested", path.join(folder, "src"));
  session.run("foreign", `${folder}-neighbor`);
  const insert = db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)");
  const add = (row) => insert.run(row.id, row.session, row.at, row.updated, row.data);
  try { await run({ folder, file, add }); }
  finally {
    eyes.closeReadDb();
    db.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

test("an observed Bash tool replaces a stale checklist step and names its running time", () => {
  const entry = {
    routeLabel: "OpenCode",
    todos: [{ status: "in_progress", content: "Write the game" }],
    todosUpdatedAt: 500,
    activeTool: { id: "tool-1", sessionId: "ours", tool: "bash", status: "running", startedAt: 1000, updatedAt: 2000,
      command: 'powershell -Command "Start-Process python -ArgumentList server.py -WindowStyle Hidden"' },
  };
  const before = JSON.stringify(entry);
  const result = workerActivity(entry, 361000);
  assert.equal(result.currentStep, "Bash running · 6m · Starting a background process");
  assert.equal(JSON.stringify(entry), before, "rendering active work never changes the worker record");
  assert.deepEqual(Object.keys(result).sort(), ["route", "activity", "activityAt", "lastOutputAt", "currentStep", "stepUpdatedAt"].sort(), "the existing UI contract stays unchanged");
});

test("active-tool descriptions are preferred over raw commands and sanitized before display", () => {
  const result = workerActivity({
    activeTool: {
      tool: "bash", status: "running", startedAt: 1000, updatedAt: 2000,
      description: `\u001b[32mChecking keyboard controls\u001b[0m Authorization: Bearer synthetic-secret-credential\u202e ${"extra ".repeat(80)}`,
      command: "node internal-command-name-that-should-not-be-shown.mjs",
    },
  }, 361000);
  assert.match(result.currentStep, /^Bash running · 6m · Checking keyboard controls/);
  assert.doesNotMatch(result.currentStep, /synthetic-secret-credential|internal-command-name/);
  assert.doesNotMatch(result.currentStep, controls);
  assert.ok(result.currentStep.length <= 240);
});

test("active-tool command fallback is bounded and hides credentials", () => {
  const secret = `ghp_${"a".repeat(36)}`;
  const result = workerActivity({
    activeTool: { tool: "bash", status: "running", startedAt: 1000, updatedAt: 2000,
      command: `\u001b[31mnode inspect.mjs --token ${secret} ${"argument ".repeat(80)}\u2066` },
  }, 361000);
  assert.match(result.currentStep, /node inspect\.mjs/);
  assert.doesNotMatch(result.currentStep, /ghp_|\[31m/);
  assert.doesNotMatch(result.currentStep, controls);
  assert.ok(result.currentStep.length <= 240);
});

test("a settled long-lived tool is shown stopped, never as running or completed", () => {
  const result = workerActivity({
    todos: [{ status: "in_progress", content: "Launch the preview server" }],
    todosUpdatedAt: 500,
    activeTool: { id: "launch", sessionId: "ours", tool: "bash", status: "timed_out", timedOut: true, startedAt: 1000, updatedAt: 2000,
      description: "Start the preview server" },
  }, 361000);
  assert.equal(result.currentStep, "Bash stopped after 6m · Start the preview server");
  assert.doesNotMatch(result.currentStep, /running/);
});

test("without an active tool the recorded checklist remains the current step", () => {
  const entry = { todos: [{ status: "in_progress", content: "Check collision rules" }], todosUpdatedAt: 3000 };
  assert.equal(workerActivity(entry, 361000).currentStep, "Check collision rules");
  assert.equal(workerActivity(entry, 361000).stepUpdatedAt, 3000);
  assert.equal(workerActivity({}, 361000).currentStep, null, "unknown work cannot become an invented active tool");
});

test("active-tool reads include pending and running tools, excluding settled tools and output bodies", async () => fixture(({ file, add }) => {
  add(part());
  add(part({ id: "pending", at: 170, updated: 180, status: "pending", start: null, tool: "read", command: "", description: "Read the game rules" }));
  add(part({ id: "completed", at: 210, status: "completed", end: 220 }));
  add(part({ id: "error", at: 220, status: "error", end: 230 }));
  add(part({ id: "ended-running", at: 230, status: "running", end: 240 }));
  add(part({ id: "ended-pending", at: 240, status: "pending", end: 250 }));
  add(part({ id: "unknown", at: 250, status: "unknown" }));
  add(part({ id: "text", at: 260, type: "text" }));
  add({ ...part({ id: "malformed", at: 270 }), data: "not JSON" });
  const result = eyes.listSessionActiveTools({ dbPath: file, ...scope });
  assert.equal(result.available, true);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.tools.map((row) => row.id).sort(), ["pending", "running"]);
  const running = result.tools.find((row) => row.id === "running");
  assert.deepEqual(running, {
    id: "running", sessionId: "ours", tool: "bash", status: "running",
    description: "Checking game controls", command: "node --test tests/game.test.mjs",
    startedAt: 120, updatedAt: 130,
  });
  for (const row of result.tools) {
    assert.deepEqual(Object.keys(row).sort(), ["id", "sessionId", "tool", "status", "description", "command", "startedAt", "updatedAt"].sort());
  }
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private|outputExcerpt|metadata|"output"/);
  assert.throws(() => eyes.openDb(file).exec("DELETE FROM part"), /readonly/i);
}));

test("active tools stay inside the exact session and attempt time window", async () => fixture(({ file, add }) => {
  add(part({ id: "current", at: 150, updated: 160 }));
  add(part({ id: "at-lower-bound", at: 100, updated: 100, start: 100 }));
  add(part({ id: "at-upper-bound", at: 500, updated: 500, start: 500 }));
  add(part({ id: "foreign", session: "foreign", at: 180 }));
  add(part({ id: "nested-other-session", session: "nested", at: 190 }));
  add(part({ id: "created-before", at: 99, start: 120 }));
  add(part({ id: "started-before", at: 120, start: 99 }));
  add(part({ id: "created-after", at: 501, start: 501 }));
  add(part({ id: "started-after", at: 140, start: 501 }));
  const result = eyes.listSessionActiveTools({ dbPath: file, ...scope, limit: 20 });
  assert.equal(result.available, true);
  assert.deepEqual(result.tools.map((row) => row.id).sort(), ["at-lower-bound", "at-upper-bound", "current"]);
  assert.deepEqual(eyes.listSessionActiveTools({ dbPath: file, sessionId: "ours", since: 300, until: 400 }), { available: true, tools: [], truncated: false });
}));

test("active-tool query bounds fields and reports row truncation without returning tool output", async () => fixture(({ file, add }) => {
  for (let index = 0; index < 6; index += 1) {
    add(part({ id: `tool-${index}`, at: 120 + index, updated: 130 + index,
      tool: "tool".repeat(30), description: "description ".repeat(100), command: "command ".repeat(1000),
      output: "large-private-output-".repeat(10000), metadataOutput: "large-private-metadata-output-".repeat(10000) }));
  }
  const result = eyes.listSessionActiveTools({ dbPath: file, ...scope });
  assert.equal(result.available, true);
  assert.equal(result.tools.length, 4, "the default query returns at most four active tools");
  assert.equal(result.truncated, true);
  for (const row of result.tools) {
    assert.ok(row.tool.length <= 40);
    assert.ok(row.description.length <= 240);
    assert.ok(row.command.length <= 2000);
  }
  assert.doesNotMatch(JSON.stringify(result), /large-private/);
  const limited = eyes.listSessionActiveTools({ dbPath: file, ...scope, limit: 2 });
  assert.equal(limited.tools.length, 2);
  assert.equal(limited.truncated, true);
}));

test("missing or corrupt stores and invalid attempt windows stay explicitly unavailable", async () => fixture(async ({ file, folder }) => {
  const corrupt = path.join(folder, "corrupt.db");
  await writeFile(corrupt, "not a SQLite store");
  for (const options of [
    { dbPath: path.join(folder, "missing.db"), ...scope },
    { dbPath: corrupt, ...scope },
    { dbPath: file, sessionId: "ours" },
    { dbPath: file, ...scope, sessionId: "" },
    { dbPath: file, ...scope, until: 99 },
  ]) {
    const result = eyes.listSessionActiveTools(options);
    assert.equal(result.available, false);
    assert.deepEqual(result.tools, []);
    assert.equal(result.truncated, false);
  }
}));

test("the project facade refuses foreign active tools and forwards an owned session's window", async () => fixture(async ({ file, folder, add }) => {
  add(part({ id: "current" }));
  add(part({ id: "old", at: 90, start: 90 }));
  add(part({ id: "foreign", session: "foreign" }));
  add(part({ id: "nested", session: "nested" }));
  const projects = createProjects({ defaultRoot: folder, studioRoot: folder, isDirectory: () => true });
  projects.select(projects.add(folder).id);
  const scoped = projects.eyes(eyes);
  const own = await scoped.listSessionActiveTools({ dbPath: file, ...scope });
  assert.equal(own.available, true);
  assert.deepEqual(own.tools.map((row) => row.id), ["current"]);
  const nested = await scoped.listSessionActiveTools({ dbPath: file, ...scope, sessionId: "nested" });
  assert.deepEqual(nested.tools.map((row) => row.id), ["nested"], "nested project folders remain owned");
  for (const sessionId of ["foreign", "missing"]) {
    const refused = await scoped.listSessionActiveTools({ dbPath: file, ...scope, sessionId });
    assert.equal(refused.available, false);
    assert.deepEqual(refused.tools, []);
  }
}));
