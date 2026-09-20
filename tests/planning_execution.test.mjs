// Approved plans use the real queue claim and verification boundary. Only the
// external child and evidence source are faked; all stores are disposable.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createPlanningStore } from "../scripts/planning.cjs";
import { createPlanningService } from "../scripts/planning-service.cjs";
import * as assistant from "../scripts/assistant.mjs";
import { sessionCheckEvidence } from "../scripts/eyes.mjs";
import * as history from "../scripts/task-history.mjs";
import backlog from "../scripts/backlog.cjs";
import taskHandoffs from "../scripts/task-handoffs.cjs";
import { buildTaskHandoff } from "../scripts/task-context.cjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

test("an approved plan joins the paused queue and its dependent dispatches only after prerequisite verification", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "studio-plan-execution-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = { id: "planning-execution-fixture", path: root, name: "Planning fixture" };
  const store = createPlanningStore({ filePath: path.join(root, "planning.json"), project });
  let board = { tasks: [], requests: [], ideas: [] };
  const mutateBoard = async (mutate) => {
    const next = structuredClone(board), patch = mutate(next) ?? {};
    if (patch.ok === false) return patch;
    for (const key of ["tasks", "requests", "ideas"]) if (patch[key]) next[key] = patch[key];
    board = next;
    return { ...patch, ...board, written: ["tasks"] };
  };
  const autopilot = { execute: false, parallel: 3, jobs: [] };
  const launched = [], admitted = [];
  let checkEvidenceAvailable = false;
  const checkWindows = [];
  const env = vm.createContext({
    Date, console, path, crypto, taskHandoffs, process: { pid: 321 }, backlog, assistantModule: assistant, assistantCache: { store: {} }, autopilot, autopilotJobSeq: 0,
    projectSwitching: false, assistantState: { status: "paused", prefs: {} }, SMOKE: false, CAPTURE: false, CLI_MODE: false, executorUpdateHold: () => null,
    projects: { current: () => project }, projectRoot: () => root,
    getMachine: async () => ({ leaseStatus: async () => ({ exclusive: false }) }), executorRunEnv: async () => ({ cli: "fixture" }),
    getEyes: async () => ({
      readJson: async (key) => structuredClone(board[key]),
      listChanges: () => [{ file: "src/serializer.js", status: "completed" }],
      listSessionChecks: ({ sessionId, since, until }) => {
        checkWindows.push({ sessionId, since, until });
        if (!checkEvidenceAvailable) return { available: false, checks: [], truncated: false };
        const check = sessionCheckEvidence({ id: "fixture-check", session_id: sessionId, time_created: since + 100,
          data: { type: "tool", tool: "bash", state: { status: "completed", input: { command: "node --test tests/csv-roundtrip.test.mjs" },
            metadata: { exit: 0 }, time: { start: since + 100, end: until - 100 }, output: "1 passed, 0 failed" } },
        }, { sessionId, since, until });
        assert.equal(check?.passed, true, "the real evidence parser accepts only the recorded process outcome in this attempt");
        return { available: true, checks: [check], truncated: false };
      },
    }),
    getAssistant: async () => assistant, loadModule: async () => history, getReceiptsModule: async () => null, policyRecord() {},
    getPolicyModule: async () => null, warmPolicyBaseline() {}, resolveActivePolicyIdentity: async () => null,
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", workTitleKey: (value) => value,
    conflictsWithLiveFix: () => false, queuedWorkCount: () => board.tasks.filter((task) => task.status === "open").length,
    compareWork: (a, b) => a.createdAt - b.createdAt, mutateBoard, withBoardLock: async (fn) => fn(),
    logLine() {}, setAutopilotWaiting: (reason) => { autopilot.waiting = reason; }, pushAutopilotHistory() {},
    refreshAutopilotQueue: async () => {}, assistantClip: (value, limit) => String(value ?? "").slice(0, limit),
    EXECUTOR_STAGGER_MS: 3000, setTimeout: (fn) => { queueMicrotask(fn); return { unref() {} }; },
    fakeSpawn: (entry) => { launched.push(entry.taskId); return "spawned"; },
  });
  t.after(() => { for (const job of autopilot.jobs) assistant.releaseWrite?.([], job.id); });
  vm.runInContext(section("async function spawnNextJob()", "  // Policy Lab PR1 — the attempt's identity:") + "return fakeSpawn(entry);\n}" +
    section("let executorFillInFlight = null;", "// Work the assistant does on its own plumbing") +
    section("const VERIFY_DWELL_MS =", "// One autopilot tick:"), env);
  const service = createPlanningService({ project, store, mutateBoard,
    onConverted: async (tasks) => { admitted.push(...tasks); await env.executeNextRequest(); },
    complete: async () => assert.fail("Manual planning needs no model call"),
  });
  const action = async (action, fields = {}) => {
    const plan = (await store.list())[0];
    const result = await service.action({ projectId: project.id, planId: plan?.id, version: plan?.version, action, ...fields });
    assert.equal(result.ok, true, result.error);
    return result;
  };
  await action("create", { title: "CSV exports", destination: "Export filtered rows", outOfScope: "Email delivery" });
  await action("draft-spec", { text: "Serialize visible rows and add a download control.", tasks: [
    { id: "serializer", title: "Implement CSV export", prompt: "Implement CSV field escaping.", acceptance: ["Round-trip comma and newline fields"], dependsOn: [] },
    { id: "download", title: "Implement CSV export", prompt: "Use the serializer from the prerequisite.", acceptance: ["Download only visible rows"], dependsOn: ["serializer"] },
  ] });
  await action("approve-spec");
  assert.equal(board.tasks.length, 0, "approval alone never admits or schedules work");
  await action("convert");
  assert.equal(board.tasks.length, 2);
  assert.equal(admitted.length, 2);
  assert.deepEqual(launched, [], "conversion respects saved Pause even when its callback requests work");
  const [first, second] = board.tasks;
  assert.equal(backlog.workState(second, Date.now(), { tasks: board.tasks }).stage, "waiting");
  autopilot.execute = true;
  env.assistantState.status = "running";
  await env.executeNextRequest();
  assert.deepEqual(launched, [first.id]);
  assert.equal(board.tasks.find((task) => task.id === first.id).status, "active");
  const worker = autopilot.jobs[0];
  assistant.releaseWrite?.([], worker.id);
  autopilot.jobs = [];
  const attemptStartedAt = Date.now() - 62000, attemptFinishedAt = attemptStartedAt + 2000;
  Object.assign(board.tasks[0], { status: "awaiting_verification", lastAttempt: { startedAt: attemptStartedAt, at: attemptFinishedAt, code: 0, sessionId: "fixture-session", runId: worker.id, result: { parts: { done: "Serializer ready in src/serializer.js", tests: "CSV round-trip passed", remaining: "none" } } } });
  delete board.tasks[0].runId;
  await env.executeNextRequest();
  assert.deepEqual(launched, [first.id], "a successful process exit still waits for verification");
  await env.autopilotHousekeeping();
  assert.equal(board.tasks[0].status, "awaiting_verification", "reported passing tests do not replace unavailable process evidence");
  assert.equal(board.tasks[0].verifyAttempts ?? 0, 0, "a temporarily unavailable evidence reader does not consume retry budget");
  assert.equal(backlog.workState(board.tasks[1], Date.now(), { tasks: board.tasks }).stage, "waiting");
  await env.executeNextRequest();
  assert.deepEqual(launched, [first.id]);
  checkEvidenceAvailable = true;
  await env.autopilotHousekeeping();
  assert.deepEqual(checkWindows, [
    { sessionId: "fixture-session", since: attemptStartedAt, until: attemptFinishedAt },
    { sessionId: "fixture-session", since: attemptStartedAt, until: attemptFinishedAt },
  ], "the host requests checks from this exact attempt window");
  assert.equal(board.tasks[0].status, "done");
  assert.equal(board.tasks[0].verification.state, "verified");
  const handoff = buildTaskHandoff(board.tasks[1], { tasks: board.tasks });
  assert.match(handoff, /Serializer ready in src\/serializer.js/);
  assert.match(handoff, /Download only visible rows/);
  assert.match(handoff, /Email delivery/);
  await env.executeNextRequest();
  assert.deepEqual(launched, [first.id, second.id]);
  assert.equal(board.tasks[1].status, "active");
});
