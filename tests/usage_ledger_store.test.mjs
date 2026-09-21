// The usage tracker's second ledger: every assistant turn OpenCode's store
// holds, read on the eyes worker by folder, bounded by time, and kept warm
// across reads so the turn OpenCode is still writing shows its final tokens.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createEyesClient, wrapEyes } = require("../scripts/eyes-client.cjs");
const { createProjects } = require("../scripts/projects.cjs");
const { mergeLedgers, aggregateUsage } = require("../scripts/usage-tracker.cjs");
const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 86400000;

function assistant({ provider, model, cost, input, output, cacheRead = 0, created, completed = created + 1000, error = null, cwd = null }) {
  return JSON.stringify({
    role: "assistant", agent: "build", providerID: provider, modelID: model, cost,
    tokens: { total: input + output + cacheRead, input, output, reasoning: 0, cache: { read: cacheRead, write: 0 } },
    time: { created, completed }, finish: completed === null ? null : "stop",
    ...(error ? { error: { name: error } } : {}),
    ...(cwd ? { path: { cwd, root: cwd } } : {}),
  });
}

async function fixtureStore() {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mefi-usage-ledger-"));
  const project = path.join(folder, "project");
  const file = path.join(folder, "store.db");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, agent TEXT, model TEXT, directory TEXT, cost REAL,
      tokens_input INTEGER, tokens_output INTEGER, tokens_cache_read INTEGER, summary_files INTEGER, summary_additions INTEGER,
      summary_deletions INTEGER, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE todo (session_id TEXT, content TEXT, status TEXT, priority TEXT, position INTEGER, time_created INTEGER, time_updated INTEGER);`);
  const session = db.prepare("INSERT INTO session VALUES (?, NULL, ?, 'build', '{}', ?, 0, 0, 0, 0, 0, 0, 0, ?, ?)");
  session.run("inside", "Inside", project, 1, 1);
  session.run("nested", "Nested", path.join(project, "src"), 1, 1);
  session.run("elsewhere", "Elsewhere", path.join(folder, "other"), 1, 1);
  return { folder, project, file, db, message: db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)") };
}

test("the store read scopes by folder, bounds by time and ignores everything but assistant turns", async () => {
  const store = await fixtureStore();
  const now = Date.now();
  const { message } = store;
  message.run("u1", "inside", now - 5000, now - 5000, JSON.stringify({ role: "user", time: { created: now - 5000 } }));
  message.run("a1", "inside", now - 4000, now - 3000, assistant({ provider: "opencode-go", model: "deepseek-v4.1-flash", cost: 0.5, input: 100, output: 20, cacheRead: 400, created: now - 4000 }));
  message.run("a2", "nested", now - 3000, now - 2000, assistant({ provider: "mefi-zai", model: "glm-5.3-flash", cost: 0, input: 50, output: 10, created: now - 3000 }));
  message.run("a3", "elsewhere", now - 2000, now - 1000, assistant({ provider: "openrouter", model: "x", cost: 0.1, input: 5, output: 5, created: now - 2000 }));
  message.run("old", "inside", now - 40 * DAY, now - 40 * DAY, assistant({ provider: "opencode-go", model: "old", cost: 9, input: 1, output: 1, created: now - 40 * DAY }));
  message.run("broken", "inside", now - 1500, now - 1500, "{not json");
  message.run("failed", "inside", now - 1000, now - 900, assistant({ provider: "opencode-go", model: "deepseek-v4.1-flash", cost: 0, input: 0, output: 0, created: now - 1000, error: "MessageAbortedError" }));
  store.db.close();
  const eyes = await import("../scripts/eyes.mjs");
  try {
    const scoped = eyes.usageLedger({ dbPath: store.file, root: store.project, now });
    assert.equal(scoped.ok, true);
    assert.equal(scoped.warm, false, "the first read is a cold scan");
    assert.deepEqual(scoped.rows.map((row) => row.id), ["a1", "a2", "failed"], "only assistant turns inside the folder and the window, oldest first");
    const first = scoped.rows[0];
    assert.equal(first.provider, "opencode-go");
    assert.equal(first.cost, 0.5);
    assert.deepEqual(first.tokens, { input: 100, output: 20, reasoning: 0, cacheRead: 400, cacheWrite: 0, total: 520 });
    assert.equal(first.completedAt, now - 3000);
    assert.equal(first.directory, store.project);
    assert.equal(first.agent, "build");
    assert.equal(scoped.rows[2].error, "MessageAbortedError");
    assert.equal(scoped.rows.some((row) => row.rowid !== undefined), false, "row ids stay inside the reader");
    const unscoped = eyes.usageLedger({ dbPath: store.file, now });
    assert.deepEqual(unscoped.rows.map((row) => row.id), ["a1", "a2", "a3", "failed"], "no root keeps every folder");
    assert.equal(unscoped.warm, true, "the second read reuses the cache");
    const wide = eyes.usageLedger({ dbPath: store.file, since: now - 60 * DAY, now });
    assert.ok(wide.rows.some((row) => row.id === "old"), "a wider window rebuilds the cache and reaches the older turn");
    assert.equal(wide.warm, false);
    // The merged report prices each turn by its account's rule.
    const report = aggregateUsage(mergeLedgers({ store: scoped.rows }), { now });
    assert.deepEqual(report.providers.map((row) => [row.provider, row.calls, row.usage.costUsd.known, row.usage.costUsd.unknownRecords]), [["opencode-go", 2, 0.5, 0], ["zai", 1, null, 1]]);
    assert.equal(report.totals.cancelled, 1);
  } finally {
    eyes.closeReadDb();
    await rm(store.folder, { recursive: true, force: true });
  }
});

test("a warm read sees a turn's tokens and cost once OpenCode finishes writing them, even past the tail", async () => {
  const store = await fixtureStore();
  const now = Date.now();
  const { message } = store;
  // A turn that is still running: no completion time, no tokens yet.
  message.run("open", "inside", now - 60000, now - 60000, assistant({ provider: "opencode-go", model: "m", cost: 0, input: 0, output: 0, created: now - 60000, completed: null }));
  // Enough later turns to push the open one out of the re-read tail.
  const filler = store.db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)");
  for (let index = 0; index < 450; index += 1) filler.run(`f${index}`, "inside", now - 50000 + index, now - 50000 + index, assistant({ provider: "mefi-zai", model: "glm", cost: 0, input: 1, output: 1, created: now - 50000 + index }));
  message.run("latest", "inside", now - 2000, now - 2000, assistant({ provider: "opencode-go", model: "m", cost: 0, input: 0, output: 0, created: now - 2000, completed: null }));
  const eyes = await import("../scripts/eyes.mjs");
  try {
    const cold = eyes.usageLedger({ dbPath: store.file, root: store.project, now });
    assert.equal(cold.rows.length, 452);
    assert.equal(cold.rows.find((row) => row.id === "open").completedAt, null);
    assert.equal(cold.rows.find((row) => row.id === "latest").cost, 0);
    // OpenCode completes both turns in place and appends one more.
    const update = store.db.prepare("UPDATE message SET data = ?, time_updated = ? WHERE id = ?");
    update.run(assistant({ provider: "opencode-go", model: "m", cost: 0.25, input: 300, output: 40, created: now - 60000, completed: now - 500 }), now - 500, "open");
    update.run(assistant({ provider: "opencode-go", model: "m", cost: 0.75, input: 10, output: 5, created: now - 2000, completed: now - 100 }), now - 100, "latest");
    message.run("newer", "inside", now, now, assistant({ provider: "openrouter", model: "r", cost: 0.01, input: 2, output: 2, created: now }));
    const warm = eyes.usageLedger({ dbPath: store.file, root: store.project, now: now + 1000 });
    assert.equal(warm.warm, true);
    assert.ok(warm.scanned < 452, `a warm read scans the tail, not the table (${warm.scanned} rows)`);
    assert.equal(warm.rows.find((row) => row.id === "latest").cost, 0.75, "the tail re-read picked up the completed turn");
    const open = warm.rows.find((row) => row.id === "open");
    assert.equal(open.cost, 0.25, "the running turn beyond the tail was re-read by id");
    assert.equal(open.tokens.input, 300);
    assert.equal(warm.rows.at(-1).id, "newer", "the appended turn arrived");
    assert.equal(warm.rows.length, 453);
  } finally {
    eyes.closeReadDb();
    store.db.close();
    await rm(store.folder, { recursive: true, force: true });
  }
});

test("the read runs on the eyes worker and the project facade holds it to the project folder", async () => {
  const store = await fixtureStore();
  const now = Date.now();
  store.message.run("a1", "inside", now - 4000, now - 3000, assistant({ provider: "opencode-go", model: "m", cost: 0.5, input: 100, output: 20, created: now - 4000 }));
  store.message.run("a3", "elsewhere", now - 2000, now - 1000, assistant({ provider: "openrouter", model: "x", cost: 0.1, input: 5, output: 5, created: now - 2000 }));
  store.db.close();
  const client = createEyesClient({ studioRoot });
  try {
    const direct = await client.call("usageLedger", { dbPath: store.file, root: store.project, now });
    assert.deepEqual(direct.rows.map((row) => row.id), ["a1"]);
    const eyes = await import("../scripts/eyes.mjs");
    const projects = createProjects({ defaultRoot: store.project, studioRoot: store.folder, isDirectory: () => true });
    projects.select(projects.add(store.project).id);
    const scoped = projects.eyes(wrapEyes(eyes, client));
    const result = await scoped.usageLedger({ dbPath: store.file, now });
    assert.equal(result.ok, true);
    assert.deepEqual(result.rows.map((row) => row.id), ["a1"], "the facade adds the project root");
    // A reader that ignores the root (a fixture) is still held to the folder.
    const loose = projects.eyes({ usageLedger: async () => ({ ok: true, rows: [{ id: "x", directory: store.project }, { id: "y", directory: path.join(store.folder, "other") }] }) });
    assert.deepEqual((await loose.usageLedger()).rows.map((row) => row.id), ["x"]);
  } finally {
    await client.call("closeReadDb").catch(() => {});
    await client.close();
    await rm(store.folder, { recursive: true, force: true });
  }
});
