import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
function section(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, from);
  return source.slice(start, end);
}

function host({ saveAt = 15000 } = {}) {
  let now = 0, selected = { id: "old", path: "/old" }, adopted = false;
  const next = { id: "next", path: "/next" };
  const worker = { id: "worker", child: {}, finished: false, stop() { this.finished = true; } };
  const env = vm.createContext({
    projects: { active: () => selected, open: () => true, find: () => next, list: () => ({ activeId: selected.id }) },
    projectSwitching: false, autopilot: { jobs: [worker] }, assistantState: null, assistantLoop: false,
    projectOperations: 0, projectAgentJobs: 0, projectBoardWrites: 0,
    pool: { running: new Map(), queue: [] }, assistantTickInFlight: null, assistantTickDemand: null,
    autopilotPassInFlight: null, executorFillInFlight: null, assistantWriting: null, assistantLoading: null, machineReadInFlight: null,
    Date: { now: () => now }, statSync: () => ({ isDirectory: () => true }),
    setTimeout(callback, delay) {
      queueMicrotask(() => {
        now += delay;
        if (now >= saveAt) env.autopilot.jobs = [];
        callback();
      });
      return { unref() {} };
    },
    queueExecutorCheckpoint() {}, emitAutopilot() {}, autopilotStatus: () => ({}), logLine() {},
  });
  vm.runInContext(section("function executorIdle(", '// Manual "restart Studio"') +
    section("function projectBusyReason(", "function createCatalogFileReader("), env);
  env.adoptProject = async (_previous, target, { savedAgents }) => {
    assert.equal(env.autopilot.jobs.length, 0, "project adoption must wait for the saved result");
    selected = target;
    adopted = true;
    return { ok: true, activeId: target.id, saved: savedAgents };
  };
  return { env, worker, now: () => now, adopted: () => adopted };
}

test("Save & switch waits through a slow normal settlement after the worker exits", async () => {
  const h = host();
  const result = await h.env.selectProject("next", { saveProgress: true });
  assert.equal(h.worker.finished, true);
  assert.equal(h.worker.stopUser, true);
  assert.equal(result.ok, true, "a save within the 20-second stop budget must not hit the old 10-second project timeout");
  assert.equal(result.activeId, "next");
  assert.equal(result.saved, 1);
  assert.equal(h.now(), 15000);
  assert.equal(h.env.projectSwitching, false);
});

test("adopting a project recounts the loop status from the new board, not the one just left", async () => {
  const require = createRequire(import.meta.url);
  const sent = [], emitted = [];
  const board = [
    { id: "held", title: "Held", status: "open", ownerHold: { reason: "wait" } },
    { id: "failing", title: "Failing", status: "open", runFailures: 5 },
    { id: "done", title: "Done", status: "done" },
  ];
  const env = vm.createContext({
    backlog: require("../scripts/backlog.cjs"), path: { dirname: (value) => value }, mkdir: async () => {},
    autopilot: { jobs: [], autoBuild: true, approve: null, queueCounts: { ready: 0, approval: 2, blocked: 0 } },
    assistantTimer: null, assistantSaveTimer: null, assistantEmitTimer: null, assistantState: null, assistantCache: {},
    projects: { run: async (_project, callback) => callback(), dataPath: (file) => file, select() {}, list: () => ({ activeId: "next" }) },
    ensureAssistant() { env.assistantState = {}; }, updateSettings: async () => {}, kickProjectScan() {},
    getEyes: async () => ({ readJson: async (file, fallback) => file === "tasks" ? board : fallback }),
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", IDEAS_PATH: "ideas", taskView: (task) => task,
    send: (...args) => sent.push(args), emitAutopilot: () => emitted.push({ ...env.autopilot.queueCounts }),
  });
  vm.runInContext(section("function boardCounts(", "// A changed count can change") + section("async function adoptProject(", "// Only a running build"), env);
  await env.adoptProject({ id: "old", path: "/old" }, { id: "next", path: "/next", name: "Next" }, { selected: true });
  assert.deepEqual({ ...env.autopilot.queueCounts }, { ready: 0, approval: 0, blocked: 2 });
  assert.deepEqual(emitted, [{ ready: 0, approval: 0, blocked: 2 }], "the status sent after the switch already carries the new counts");
  assert.ok(sent.some(([channel]) => channel === "eyes:tasks"));
});

test("an unsaved stopped worker keeps the original project after the bounded wait", async () => {
  const h = host({ saveAt: Infinity });
  const result = await h.env.selectProject("next", { saveProgress: true });
  assert.equal(result.ok, false);
  assert.equal(result.busy, true);
  assert.equal(result.activeId, "old");
  assert.equal(h.adopted(), false);
  assert.equal(h.env.projectSwitching, false);
  assert.equal(h.env.autopilot.jobs.length, 1, "a timeout cannot discard unsaved work");
});
