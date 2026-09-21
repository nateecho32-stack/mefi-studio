import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, mkdtemp, unlink, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as eyes from "../scripts/eyes.mjs";
import * as assistant from "../scripts/assistant.mjs";
import backlog from "../scripts/backlog.cjs";
import executorResume from "../scripts/executor-resume.cjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};

test("worker-only config disables snapshots while preserving provider, permissions and inherited settings", () => {
  const inherited = { snapshot: true, permission: { edit: "ask", bash: { "git status": "allow" } }, provider: { custom: { name: "Other" }, "mefi-zai": { options: { timeout: 55 } } }, instructions: ["RULES.md"] };
  const environment = { OPENCODE_CONFIG_CONTENT: JSON.stringify(inherited), OTHER: "unchanged" };
  const env = vm.createContext({ process: { env: environment } });
  vm.runInContext(section("function executorOpencodeEnv(", "// Which route an autopilot"), env);
  const extra = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: { "mefi-zai": { options: { apiKey: "{env:FIXTURE_KEY}" }, models: { fixture: {} } } } }), FIXTURE_KEY: "fixture-value" };
  const result = env.executorOpencodeEnv(extra);
  const config = JSON.parse(result.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.snapshot, false);
  assert.deepEqual(config.permission, inherited.permission);
  assert.deepEqual(config.instructions, inherited.instructions);
  assert.equal(config.provider.custom.name, "Other");
  assert.equal(config.provider["mefi-zai"].options.timeout, 55);
  assert.equal(config.provider["mefi-zai"].options.apiKey, "{env:FIXTURE_KEY}");
  assert.equal(result.FIXTURE_KEY, "fixture-value");
  assert.equal(JSON.parse(environment.OPENCODE_CONFIG_CONTENT).snapshot, true, "no ambient or personal configuration is changed");
  environment.OPENCODE_CONFIG_CONTENT = "private-secret-broken-config";
  assert.throws(() => env.executorOpencodeEnv(), (error) => /JSON object/.test(error.message) && !error.message.includes("private-secret"));
});

test("every OpenCode route, including Grok fallback, receives snapshot-free worker config", async () => {
  let settings = { aiProvider: "opencode" };
  const env = vm.createContext({
    process: { env: {} }, AI_PROVIDERS: ["auto", "opencode", "zai"], AI_AUTO_PROVIDERS: ["zai", "opencode", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"], ZAI_MODEL_ROUTINE: "fixture", ZAI_MODEL_HEAVY: "fixture-heavy",
    readSettings: async () => settings, zaiOpencodeEnv: async () => ({ OPENCODE_CONFIG_CONTENT: '{"provider":{"fixture":{}}}', FIXTURE_KEY: "value" }),
    grokCliAvailable: async () => true, claudeCliAvailable: async () => true, codexCliAvailable: async () => true, antigravityCliAvailable: async () => true, logLine() {}, pushAutopilotHistory() {},
  });
  vm.runInContext(section("function executorModelOverride(", "// Auto setup:") + section("function executorOpencodeEnv(", "// Which route an autopilot") + section("async function executorRunEnv()", "async function assistantFetch("), env);
  for (const value of [{ aiProvider: "opencode" }, { aiProvider: "zai" }, { aiProvider: "auto", executorCli: "grok" }, { aiProvider: "auto", executorCli: "claude" }, { aiProvider: "auto", executorCli: "codex" }, { aiProvider: "auto", executorCli: "antigravity" }]) {
    settings = value;
    const route = await env.executorRunEnv();
    assert.equal(JSON.parse((route.opencode ?? route).env.OPENCODE_CONFIG_CONTENT).snapshot, false);
  }
});

test("the auto order decides which account the opencode builder runner uses", async () => {
  let settings = { aiProvider: "auto", aiAutoProviders: ["zai", "opencode"] };
  const env = vm.createContext({
    process: { env: {} }, AI_PROVIDERS: ["auto", "opencode", "zai"], AI_AUTO_PROVIDERS: ["zai", "opencode", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"], ZAI_MODEL_ROUTINE: "fixture", ZAI_MODEL_HEAVY: "fixture-heavy",
    readSettings: async () => settings, zaiOpencodeEnv: async () => ({ OPENCODE_CONFIG_CONTENT: '{"provider":{"fixture":{}}}', FIXTURE_KEY: "value" }),
    grokCliAvailable: async () => true, claudeCliAvailable: async () => true, codexCliAvailable: async () => true, antigravityCliAvailable: async () => true, logLine() {}, pushAutopilotHistory() {},
  });
  vm.runInContext(section("function executorModelOverride(", "// Auto setup:") + section("function executorOpencodeEnv(", "// Which route an autopilot") + section("async function executorRunEnv()", "async function assistantFetch("), env);
  let route = await env.executorRunEnv();
  assert.equal(route.modelProvider, "zai");
  assert.match(route.modelArgs, /--model mefi-zai\/fixture/, "z.ai listed first rides the coding plan");
  settings = { aiProvider: "auto", aiAutoProviders: ["opencode", "zai"] };
  route = await env.executorRunEnv();
  assert.equal(route.modelProvider, undefined);
  assert.equal(route.modelArgs, "", "OpenCode listed first keeps builders on OpenCode's account");
  settings = { aiProvider: "auto", aiAutoProviders: ["grok"] };
  route = await env.executorRunEnv();
  assert.equal(route.modelArgs, "", "an order without a keyed runner keeps the OpenCode default");
});

test("manual mode retains its two-worker default and one-to-three worker limits", async () => {
  let saved = {};
  const autopilot = { enabled: false, execute: false, parallel: 2, jobs: [], minutes: 5 };
  const env = vm.createContext({
    os: { cpus: () => Array(16).fill({}) }, autopilot,
    EXECUTOR_PARALLEL_MAX: 12, EXECUTOR_PARALLEL_CAP: 3,
    readSettings: async () => ({ ui: { marker: "retained" } }), writeSettings: async (next) => { saved = next; },
    proactiveTimer: null, emitAutopilot() {}, autopilotStatus: () => ({ parallel: autopilot.parallel }), assistantAskForWork() {},
  });
  vm.runInContext(section("async function setAutopilot(", "// Settings may override the defaults"), env);
  assert.equal(env.machineParallelDefault(), 2);
  assert.equal(env.savedExecutorParallel({ parallel: 1 }), 1);
  assert.equal(env.savedExecutorParallel({ parallel: 3 }), 3);
  assert.equal(env.savedExecutorParallel({ parallel: 99 }), 3);
  assert.equal(env.savedExecutorParallel({}), 2);
  await env.setAutopilot({ parallel: 99 });
  assert.equal(autopilot.parallel, 3);
  assert.equal(saved.ui.autopilot.parallel, 3);
  assert.equal(saved.ui.marker, "retained");
  await env.setAutopilot({ parallel: 1 });
  assert.equal(autopilot.parallel, 1);
  env.os.cpus = () => [{}];
  assert.equal(env.machineParallelDefault(), 1);
});

test("real selection, file claims and fill loop run independent tasks together but hold overlapping files", async () => {
  const board = { requests: [], tasks: [
    { id: "a", title: "Edit first module", status: "open", files: ["C:/fixture/src/a.js"], createdAt: 1 },
    { id: "overlap", title: "Another edit to first module", status: "open", files: ["src\\a.js"], createdAt: 2 },
    { id: "b", title: "Edit separate module", status: "open", files: ["src/b.js"], createdAt: 3 },
  ] };
  const launched = [];
  const autopilot = { execute: true, parallel: 2, jobs: [] };
  const env = vm.createContext({
    Date, console, path, process: { pid: 321 }, backlog, executorResume, assistantModule: assistant, getAssistant: async () => assistant, assistantCache: { store: {} }, autopilot, autopilotJobSeq: 0,
    projectSwitching: false, assistantState: { status: "running" }, SMOKE: false, CAPTURE: false, CLI_MODE: false, executorUpdateHold: () => null,
    projects: { current: () => ({ id: "fixture", path: "C:/fixture" }), open: () => ({ id: "fixture", path: "C:/fixture" }) }, projectRoot: () => "C:/fixture",
    measureWorkerLag: async () => 0, getAssistant: async () => assistant, machineLagGate: null,
    getMachine: async () => ({ workerCapacity: async () => ({ canStart: true }), leaseStatus: async () => ({ exclusive: false }) }), executorRunEnv: async () => ({ cli: "fixture" }),
    getEyes: async () => ({ readJson: async (key) => structuredClone(board[key]) }),
    getPolicyModule: async () => null, warmPolicyBaseline() {}, resolveActivePolicyIdentity: async () => null,
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", workTitleKey: (value) => value,
    conflictsWithLiveFix: () => false, queuedWorkCount: () => board.tasks.filter((task) => task.status === "open").length,
    compareWork: (a, b) => a.createdAt - b.createdAt, mutateBoard: async (fn) => fn(board), withBoardLock: async (fn) => fn(),
    logLine() {}, setAutopilotWaiting: (reason) => { autopilot.waiting = reason; }, pushAutopilotHistory() {}, readSettings: async () => ({}), machineMemoryWarnOverride: () => false,
    EXECUTOR_STAGGER_MS: 3000, setTimeout: (fn) => { queueMicrotask(fn); return { unref() {} }; },
    fakeSpawn: (entry) => { launched.push(entry.taskId); return "spawned"; },
  });
  // Keep the real pre-spawn selection and atomic claim boundary. Replace only
  // the process-launch/output half: the held jobs are deliberately unfinished.
  const pick = section("async function spawnNextJob()", "  // Policy Lab PR1 — the attempt's identity:") + "return fakeSpawn(entry);\n}";
  vm.runInContext(pick + section("let executorFillInFlight = null;", "// Work the assistant does on its own plumbing"), env);
  await env.executeNextRequest();
  assert.deepEqual(launched, ["a", "b"]);
  assert.equal(autopilot.jobs.length, 2, "both independent tasks coexist before either finishes");
  assert.equal(board.tasks[1].status, "open", "slash spelling does not bypass another worker's file claim");
  await env.executeNextRequest();
  assert.equal(launched.length, 2, "a full configured pool cannot overspawn");
  const finished = autopilot.jobs.find((job) => job.taskId === "a");
  assistant.releaseWrite?.([], finished.id);
  autopilot.jobs = autopilot.jobs.filter((job) => job !== finished);
  board.tasks[0].status = "done";
  await env.executeNextRequest();
  assert.deepEqual(launched, ["a", "b", "overlap"], "the held file becomes eligible after its owner finishes");
  for (const job of autopilot.jobs) assistant.releaseWrite?.([], job.id);
});

test("session tool edits remain attributable without snapshot hashes or diffs", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mefi-evidence-"));
  const file = path.join(folder, "fixture.db");
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE TABLE part (id TEXT, session_id TEXT, time_created INTEGER, data TEXT)");
    const insert = db.prepare("INSERT INTO part VALUES (?, ?, ?, ?)");
    for (const [id, session, tool, status] of [["edit", "ours", "edit", "completed"], ["write", "ours", "write", "completed"], ["failed", "ours", "edit", "error"], ["other", "other", "write", "completed"]]) {
      insert.run(id, session, 1, JSON.stringify({ type: "tool", tool, state: { status, input: { filePath: `${id}.js`, content: "two\nlines" } } }));
    }
    const changes = eyes.listChanges({ dbPath: file, sessionId: "ours" });
    assert.equal(changes.length, 3);
    const completed = changes.filter((change) => change.status === "completed");
    assert.deepEqual(completed.map((change) => change.file).sort(), ["edit.js", "write.js"]);
    assert.ok(completed.every((change) => change.diff === null && change.hash === null));
    assert.equal(assistant.verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: completed.length }).state, "verified");
  } finally {
    eyes.openDb(file).close();
    db.close();
    await unlink(file);
    await rmdir(folder);
  }
});
