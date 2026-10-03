// The OpenCode store reads, JavaScript (scripts/eyes.mjs) against Rust
// (crates/mefi-core, docs/rust-migration.md stage 2): the same calls on the
// same fixture stores must give the same answers, so the Rust host can serve
// the engine's store reads without anything downstream noticing.
//
// Needs the mefi-core binary (node scripts/rust-host.mjs core-build); without
// it the suite skips, like the Electron fixtures without Electron.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import * as eyes from "../scripts/eyes.mjs";
import { coreBinary } from "../scripts/rust-host.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = coreBinary();
const skip = existsSync(binary) ? false : `mefi-core is not built (${binary}); run node scripts/rust-host.mjs core-build`;

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const ROOT = process.platform === "win32" ? "C:/fixture" : "/fixture";
const OUTSIDE = process.platform === "win32" ? "C:/elsewhere" : "/elsewhere";

function store(dir, name, build) {
  const dbPath = path.join(dir, name);
  const db = new DatabaseSync(dbPath);
  build(db);
  db.close();
  return dbPath;
}

function fullSchema(db) {
  db.exec(`
    create table session (id text primary key, parent_id text, title text, agent text, model text, directory text, cost real,
      tokens_input integer, tokens_output integer, tokens_cache_read integer, summary_files integer, summary_additions integer,
      summary_deletions integer, time_created integer, time_updated integer);
    create table message (id text primary key, session_id text, time_created integer, data text);
    create table part (id text primary key, session_id text, message_id text, time_created integer, time_updated integer, data text);
    create table todo (session_id text, content text, status text, priority text, position integer, time_created integer, time_updated integer);
  `);
}

// A store with something for every read: sessions in and out of the root,
// finished and not, edits, writes, patches, checks, reads, running tools,
// chat texts, a dispatch prompt, assistant turns, todos, and bad rows.
function richStore(db) {
  fullSchema(db);
  const session = db.prepare("insert into session values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const sessions = [
    ["ses_A1", null, "Wire the parallel executor", "build", JSON.stringify({ id: "gpt-6", providerID: "openai", variant: "high" }), `${ROOT}/app`, 1.0625, 100, 200, 50, 3, 10, 2, NOW - 60 * MINUTE, NOW - 2 * MINUTE],
    ["ses_a2", null, "Fix the idle camera", "build", "claude-opus", `${ROOT}`, 0.12345, 10, 20, 0, null, null, null, NOW - 50 * MINUTE, NOW - 3 * MINUTE],
    ["ses_b", "ses_A1", "Child task", "general", null, `${OUTSIDE}/x`, null, 1, 2, 3, 1, 1, 1, NOW - 40 * MINUTE, NOW - 30 * MINUTE],
    ["ses_c", null, "Old finished work", "plan", "{not json", `${ROOT}/old`, 0.9995, 0, 0, 0, 0, 0, 0, NOW - 300 * MINUTE, NOW - 200 * MINUTE],
    ["ses_D", null, "Runs the checks", "build", JSON.stringify({ providerID: "zen" }), `${ROOT}/app/sub`, 2, 5, 5, 5, 2, 4, 0, NOW - 20 * MINUTE, NOW - MINUTE],
    ["ses_e", null, "Sequential follower", "build", "null", `${ROOT}`, 0, 0, 0, 0, 0, 0, 0, NOW - 9 * MINUTE, NOW - 4 * MINUTE],
  ];
  for (const row of sessions) session.run(...row);
  let seq = 0;
  const part = db.prepare("insert into part values (?,?,?,?,?,?)");
  const add = (sessionId, at, data, { message = null, updated = at } = {}) => part.run(`p${String(++seq).padStart(4, "0")}`, sessionId, message, at, updated, typeof data === "string" ? data : JSON.stringify(data));
  const edit = (sessionId, file, at, extra = {}) => add(sessionId, at, { type: "tool", tool: "edit", state: { status: "completed", input: { filePath: file }, metadata: { diff: "--- a\n+++ b\n+one\n+two\n-three\n" }, time: { start: at - 1000, end: at }, ...extra } });
  // Collisions: A1 and a2 overlap on game.js and index.html; D edits alone; e follows c after c finished.
  edit("ses_A1", `${ROOT}/game.js`, NOW - 8 * MINUTE);
  edit("ses_a2", `${ROOT}/game.js`, NOW - 7 * MINUTE);
  edit("ses_A1", `${ROOT}/index.html`, NOW - 6 * MINUTE);
  edit("ses_a2", `${ROOT}/index.html`, NOW - 6 * MINUTE);
  edit("ses_D", `${ROOT}/app/sub/main.lua`, NOW - 5 * MINUTE);
  edit("ses_c", `${ROOT}/handoff.js`, NOW - 50 * MINUTE);
  add("ses_c", NOW - 45 * MINUTE, { type: "step-finish", reason: "stop" });
  edit("ses_e", `${ROOT}/handoff.js`, NOW - 5 * MINUTE);
  edit("ses_b", `${OUTSIDE}/x/far.js`, NOW - 6 * MINUTE);
  // Same edits and same newest edit: the owner falls to the id's locale order.
  edit("ses_Tie", `${ROOT}/tie.js`, NOW - 3 * MINUTE);
  edit("ses_tie", `${ROOT}/tie.js`, NOW - 3 * MINUTE);
  add("ses_A1", NOW - 4 * MINUTE, { type: "tool", tool: "write", state: { status: "completed", input: { file_path: `${ROOT}/new.txt`, content: "a\nb\nc" } } });
  add("ses_A1", NOW - 4 * MINUTE + 1, { type: "patch", files: [`${ROOT}/p1.js`, `${ROOT}/p2.js`], hash: "abc123" });
  add("ses_A1", NOW - 4 * MINUTE + 2, { type: "patch", files: "not-a-list" });
  add("ses_A1", NOW - 4 * MINUTE + 4, { type: "tool", tool: "edit", state: { input: { filePath: "" } } });
  // Checks for ses_D.
  add("ses_D", NOW - 10 * MINUTE, { type: "tool", tool: "bash", state: { status: "completed", input: { command: "npm test" }, metadata: { exit: 0, output: "ok\n" }, time: { start: NOW - 10 * MINUTE, end: NOW - 9 * MINUTE } } });
  add("ses_D", NOW - 8 * MINUTE, { type: "tool", tool: "bash", state: { status: "completed", input: { command: "npm run lint" }, metadata: { exit: 1 }, output: "x".repeat(2500), time: { start: NOW - 8 * MINUTE, end: NOW - 7 * MINUTE } } });
  add("ses_D", NOW - 7 * MINUTE, { type: "tool", tool: "bash", state: { status: "error", input: { command: "c".repeat(4100) }, metadata: { exit: 2.0, truncated: true }, time: { start: NOW - 7 * MINUTE } } });
  add("ses_D", NOW - 6 * MINUTE, { type: "tool", tool: "bash", state: { status: "weird", input: { command: "echo 😀 done" }, metadata: { exit: 0 }, time: { start: NOW - 6 * MINUTE, end: NOW - 6 * MINUTE + 10 } } });
  add("ses_D", NOW - 5 * MINUTE + 1, { type: "tool", tool: "bash", state: { status: "completed", input: { command: "   " } } });
  // Reads and running tools.
  add("ses_D", NOW - 9 * MINUTE, { type: "tool", tool: "read", state: { status: "completed", input: { filePath: `${ROOT}/README.md` } } });
  add("ses_D", NOW - 9 * MINUTE + 1, { type: "tool", tool: "read", state: { status: "completed", input: { file_path: `${ROOT}/docs/a.md` } } });
  add("ses_D", NOW - 9 * MINUTE + 2, { type: "tool", tool: "read", state: { status: "completed", input: { filePath: `${ROOT}/README.md` } } });
  add("ses_D", NOW - 2 * MINUTE, { type: "tool", tool: "bash", state: { status: "running", input: { command: "npm run build", description: "Build it" }, time: { start: NOW - 2 * MINUTE } } }, { updated: NOW - MINUTE });
  add("ses_D", NOW - 2 * MINUTE + 5, { type: "tool", tool: "webfetch", state: { status: "pending", title: "Fetching docs", input: {} } });
  add("ses_D", NOW - 2 * MINUTE + 6, { type: "tool", tool: "bash", state: { status: "running", input: { command: "old" }, time: { start: NOW - 900 * MINUTE } } });
  // Chat texts and a dispatch.
  db.prepare("insert into message values (?,?,?,?)").run("m_user", "ses_A1", NOW - 59 * MINUTE, JSON.stringify({ role: "user" }));
  add("ses_A1", NOW - 59 * MINUTE, { type: "text", text: "This dispatch is run run_abc_1 for task t1. Please wire the parallel executor carefully." }, { message: "m_user" });
  add("ses_a2", NOW - 49 * MINUTE, { type: "text", text: "short" });
  add("ses_a2", NOW - 48 * MINUTE, { type: "text", text: "A long enough chat message that the companion should be able to read later on." });
  add("ses_a2", NOW - 48 * MINUTE, { type: "text", text: "Another chat message with the very same timestamp, read by its id order." });
  // Finished sessions.
  add("ses_a2", NOW - 2 * MINUTE, { type: "step-finish", reason: "stop" });
  add("ses_D", NOW - 30000, { type: "step-finish", reason: "tool-calls" });
  // Assistant turns for the usage ledger.
  const message = db.prepare("insert into message values (?,?,?,?)");
  message.run("m_a1", "ses_A1", NOW - 30 * MINUTE, JSON.stringify({ role: "assistant", providerID: "openai", modelID: "gpt-6", cost: 0.25, finish: "stop", time: { created: NOW - 30 * MINUTE, completed: NOW - 29 * MINUTE }, tokens: { input: 1000, output: 200, reasoning: 50, total: 1250, cache: { read: 10, write: 5 } } }));
  message.run("m_a2", "ses_a2", NOW - 20 * MINUTE, JSON.stringify({ role: "assistant", agent: "build", modelID: 7, time: { created: "late" }, tokens: [], error: { name: "ProviderAuthError" } }));
  message.run("m_a3", "ses_zz", NOW - 10 * MINUTE, JSON.stringify({ role: "assistant", path: { cwd: `${ROOT}/cwd` }, cost: Number.MAX_VALUE, error: true }));
  message.run("m_old", "ses_c", NOW - 90 * 24 * 60 * MINUTE, JSON.stringify({ role: "assistant", cost: 1 }));
  message.run("m_bad", "ses_c", NOW - 5 * MINUTE, "not json");
  // Todos.
  const todo = db.prepare("insert into todo values (?,?,?,?,?,?,?)");
  todo.run("ses_A1", "Wire it", "in_progress", "high", 1, NOW - 50 * MINUTE, NOW - 5 * MINUTE);
  todo.run("ses_A1", "Test it", "pending", "medium", 2, NOW - 50 * MINUTE, NOW - 6 * MINUTE);
  todo.run("ses_a2", "Fix camera", "completed", "low", 1, NOW - 40 * MINUTE, NOW - 4 * MINUTE);
}

function calls(dbPath) {
  const window = { sessionId: "ses_D", since: NOW - 20 * MINUTE, until: NOW };
  return [
    ["storeStatus", { dbPath }],
    ["listSessions", { dbPath }],
    ["listSessions", { dbPath, limit: 2 }],
    ["listSessions", { dbPath, root: ROOT }],
    ["listSessions", { dbPath, root: `${ROOT}/app`, limit: 1 }],
    ["listSessionIds", { dbPath }],
    ["listSessionIds", { dbPath, root: ROOT.toUpperCase() }],
    ["sessionDirectory", { dbPath, sessionId: "ses_D" }],
    ["sessionDirectory", { dbPath, sessionId: "missing" }],
    ["sessionDirectory", { dbPath, sessionId: 5 }],
    ["findRunSession", { dbPath, runId: "run_abc_1" }],
    ["findRunSession", { dbPath, runId: "run_abc_1", since: NOW }],
    ["findRunSession", { dbPath, runId: "bad id" }],
    ["listChanges", { dbPath }],
    ["listChanges", { dbPath, limit: 3 }],
    ["listChanges", { dbPath, sessionId: "ses_A1" }],
    ["listChanges", { dbPath, sessionId: "ses_A1", since: NOW - 10 * MINUTE, until: NOW }],
    ["listChanges", { dbPath, sessionId: "ses_A1", since: NOW, until: NOW - 1 }],
    ["listChanges", { dbPath, since: NOW - 10 * MINUTE }],
    ["listSessionChecks", { dbPath, ...window }],
    ["listSessionChecks", { dbPath, ...window, limit: 2 }],
    ["listSessionChecks", { dbPath, ...window, limit: "x" }],
    ["listSessionChecks", { dbPath, sessionId: " ", since: 0, until: NOW }],
    ["listSessionChecks", { dbPath: path.join(path.dirname(dbPath), "nope.db"), ...window }],
    ["listReads", { dbPath, ...window }],
    ["listReads", { dbPath, ...window, limit: 1 }],
    ["listSessionActiveTools", { dbPath, ...window }],
    ["listSessionActiveTools", { dbPath, ...window, limit: 1 }],
    ["listSessionActiveTools", { dbPath, sessionId: "ses_D", since: NOW - 1000 * MINUTE, until: NOW }],
    ["listTodos", { dbPath }],
    ["listTodos", { dbPath, sessionId: "ses_A1" }],
    ["activitySince", { dbPath }],
    ["activitySince", { dbPath, since: NOW - 7 * MINUTE, limit: 3 }],
    ["listChatTexts", { dbPath }],
    ["listChatTexts", { dbPath, order: "asc", minLength: 10 }],
    ["listChatTexts", { dbPath, after: { at: NOW - 48 * MINUTE, id: "p0001" }, minLength: 10 }],
    ["listChatTexts", { dbPath, after: NOW - 49 * MINUTE, limit: 1 }],
    ["listChatTexts", { dbPath, since: NOW - 60 * MINUTE, after: null }],
    ["collisions", { dbPath, now: NOW }],
    ["collisions", { dbPath, now: NOW, root: ROOT }],
    ["collisions", { dbPath, now: NOW, since: 0, overlapMs: 0 }],
    ["collisions", { dbPath, now: NOW, windowMs: 4 * MINUTE }],
    ["filePresence", { dbPath, now: NOW }],
    ["filePresence", { dbPath, now: NOW, since: 0, root: `${ROOT}/app` }],
    ["assistantFacts", { dbPath, now: NOW, porcelain: "" }],
    ["assistantFacts", { dbPath, now: NOW, root: ROOT, porcelain: " M game.js\n?? new.txt\n D gone.js\nR  old.js -> index.html\n" }],
    ["assistantFacts", { dbPath, now: NOW, sessionLimit: 2, changeLimit: 4, todoLimitPerSession: 1, porcelain: " M app/sub/main.lua\n", root: ROOT }],
    ["assistantFacts", { dbPath, now: NOW, porcelain: "", sessions: [{ id: "x", timeUpdated: NOW - 90000, cost: "1.5" }], changes: [{ sessionId: "x", file: "a.js", additions: 2, deletions: 1 }], todos: [] }],
    ["usageLedger", { dbPath, now: NOW }],
    ["usageLedger", { dbPath, now: NOW, root: ROOT }],
    ["usageLedger", { dbPath, now: NOW, since: NOW - 25 * MINUTE }],
    ["usageLedger", { dbPath, now: NOW, limit: 1 }],
    ["closeReadDb", {}],
    ["listSessions", { dbPath, root: ROOT }],
  ];
}

async function runJs(list) {
  const out = [];
  for (const [method, args] of list) {
    try {
      const value = await eyes[method](args);
      out.push({ ok: true, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) });
    } catch (error) {
      out.push({ ok: false, error: String(error?.message ?? error) });
    }
  }
  return out;
}

function runRust(list) {
  const result = spawnSync(binary, ["eyes-batch"], { input: JSON.stringify(list.map(([method, args]) => ({ method, args }))), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function compare(list, js, rust) {
  assert.equal(rust.length, js.length);
  list.forEach(([method, args], index) => {
    const label = `${method}(${JSON.stringify(args).slice(0, 140)})`;
    assert.equal(rust[index].ok, js[index].ok, `${label}: JS ${js[index].ok ? "answered" : `threw ${js[index].error}`}, Rust ${rust[index].ok ? "answered" : `failed ${rust[index].error}`}`);
    if (js[index].ok) assert.deepEqual(rust[index].value, js[index].value, label);
  });
}

test("every store read answers the same in Rust", { skip }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "mefi-parity-eyes-"));
  t.after(() => {
    eyes.closeReadDb();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const dbPath = store(dir, "opencode.db", richStore);
  const list = calls(dbPath);
  compare(list, await runJs(list), runRust(list));
});

test("missing, empty and partial stores answer the same", { skip }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "mefi-parity-eyes-edge-"));
  t.after(() => {
    eyes.closeReadDb();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const missing = path.join(dir, "missing", "opencode.db");
  const bookkeeping = store(dir, "migrations.db", (db) => db.exec("create table migration (id integer primary key, name text)"));
  const partOnly = store(dir, "part-only.db", (db) => {
    db.exec("create table part (id text primary key, session_id text, time_created integer, data text)");
    db.prepare("insert into part values (?,?,?,?)").run("p1", "s1", NOW - MINUTE, JSON.stringify({ type: "tool", tool: "edit", state: { input: { filePath: `${ROOT}/a.js` } } }));
  });
  // SQLite's json_extract throws on a malformed row, in both languages alike.
  const broken = store(dir, "broken.db", (db) => {
    fullSchema(db);
    db.prepare("insert into part values (?,?,?,?,?,?)").run("p1", "s1", null, NOW - MINUTE, NOW - MINUTE, "{broken json");
  });
  const list = [];
  for (const dbPath of [missing, bookkeeping, partOnly, broken]) {
    for (const method of ["storeStatus", "listSessions", "listSessionIds", "listTodos", "activitySince", "listChatTexts", "usageLedger"]) list.push([method, { dbPath, now: NOW }]);
    list.push(["listChanges", { dbPath }], ["collisions", { dbPath, now: NOW }], ["filePresence", { dbPath, now: NOW }], ["listReads", { dbPath, sessionId: "s1", since: 0, until: NOW }]);
    // eyes.mjs keeps one connection and only closes it here; move on cleanly.
    list.push(["closeReadDb", {}]);
  }
  compare(list, await runJs(list), runRust(list));
});

test("the CLI dump matches eyes.mjs --dump", { skip }, (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "mefi-parity-dump-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const dbPath = store(dir, "opencode.db", richStore);
  const porcelain = " M game.js\n?? new.txt\n D gone.js\n";
  const args = ["--dump", "--fixture", dbPath, "--root", ROOT, "--now", String(NOW), "--porcelain", porcelain.replace(/\n/g, "\\n")];
  const js = JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts", "eyes.mjs"), ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const rust = JSON.parse(execFileSync(binary, ["eyes-dump", ...args.slice(1)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true }));
  assert.deepEqual(rust, js);
});

test("git porcelain and commit evidence answer the same", { skip }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "mefi-parity-git-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true }).trim();
  git("init", "-q");
  git("config", "user.email", "parity@example.invalid");
  git("config", "user.name", "Parity");
  writeFileSync(path.join(dir, "kept.js"), "one\n");
  writeFileSync(path.join(dir, "Mixed Case.js"), "two\n");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  const head = git("rev-parse", "HEAD");
  writeFileSync(path.join(dir, "kept.js"), "changed\n");
  writeFileSync(path.join(dir, "café new.js"), "untracked\n");
  const list = [
    ["gitPorcelain", { root: dir }],
    ["gitPorcelain", { root: path.join(dir, "not-a-repo") }],
    ["gitPorcelain", {}],
    ["commitEvidence", { root: dir, hash: head }],
    ["commitEvidence", { root: dir, hash: head.slice(0, 9).toUpperCase(), paths: ["mixed case.js"] }],
    ["commitEvidence", { root: dir, hash: head, paths: ["kept.js", 5, " "] }],
    ["commitEvidence", { root: dir, hash: "deadbeefdeadbeef" }],
    ["commitEvidence", { root: dir, hash: "xyz" }],
    ["commitEvidence", { hash: head }],
  ];
  compare(list, await runJs(list), runRust(list));
});
