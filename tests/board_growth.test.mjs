import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import boardGrowth from "../scripts/board-growth.cjs";
import * as assistant from "../scripts/assistant.mjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
}
const task = (id, status = "open") => ({ id, title: `Work ${id}`, prompt: `Finish obligation ${id}`, status });
const proposal = (id, source = "overseer") => ({ title: `Proposal ${id}`, prompt: `Build obligation ${id}`, source });

test("growth counts all unfinished obligations once, including review and held work", () => {
  const board = { tasks: [task("ready"), task("running", "active"), task("review", "awaiting_verification"), task("done", "done"),
    { ...task("grouped", "absorbed"), absorbedInto: "ready" }], requests: [task("ready"), proposal("next"), proposal("next")] };
  const result = boardGrowth.summarize(board);
  assert.equal(result.outstanding, 4);
  assert.equal(result.available, 0);
  assert.equal(result.growthHeld, true);
  assert.equal(board.tasks.length, 5, "summaries never remove accepted work");
});

test("board context remains complete JSON and states the unseen count for a large board", () => {
  const board = { tasks: Array.from({ length: 95 }, (_, id) => ({ ...task(id), prompt: "Acceptance detail. ".repeat(50) })) };
  const result = boardGrowth.summarize(board);
  assert.equal(result.outstanding, 95);
  assert.ok(result.omitted > 0);
  assert.equal(result.existingWork.length + result.omitted, 95);
  assert.ok(JSON.stringify(result.existingWork).length <= 5500);
});

test("exact automatic repeats include archived records and full group snapshots without swallowing new scope", () => {
  const existing = { ...proposal("saved"), status: "archived" };
  const board = { tasks: [{ ...task("plan"), members: [existing] }] };
  assert.equal(boardGrowth.represented(board, { ...existing, title: `Overseer: ${existing.title}!` }), true);
  assert.equal(boardGrowth.represented(board, { ...existing, prompt: `${existing.prompt} Also retain drafts.` }), false);
  assert.equal(boardGrowth.represented(board, { ...existing, acceptance: ["Retain unsent text"] }), false);
  assert.equal(boardGrowth.represented(board, { ...existing, files: ["renderer/tasks.js"] }), false);
  assert.equal(boardGrowth.represented(board, { ...existing, projectId: "another-project" }), false);
  assert.equal(boardGrowth.represented(board, { ...existing, handoffId: "child", fromRun: "parent" }), false);
  assert.equal(boardGrowth.represented(board, { ...existing, source: "chat" }), false);
});

function intakeHost(board) {
  let tail = Promise.resolve();
  const accepted = [];
  const env = vm.createContext({
    boardGrowth, projects: { stamp: (row) => row },
    workTitleKey: (title) => String(title ?? "").toLowerCase().trim(),
    mutateBoard(mutate) { const next = tail.then(() => mutate(board)); tail = next.catch(() => {}); return next; },
    jevShadowIntake(rows) { accepted.push(...(rows ?? [])); },
  });
  vm.runInContext(section("async function queueRequests(", "// Jev classifies admitted observations"), env);
  return { env, accepted };
}

test("concurrent automatic batches atomically share three discovery slots", async () => {
  const board = { tasks: [task("existing")], requests: [] };
  const { env, accepted } = intakeHost(board);
  const results = await Promise.all([
    env.queueRequests([proposal("a"), proposal("b")], { automaticGrowth: true }),
    env.queueRequests([proposal("c"), proposal("d")], { automaticGrowth: true }),
  ]);
  assert.equal(results.reduce((a, b) => a + b), 2);
  assert.equal(board.requests.length, 2);
  assert.equal(accepted.length, 2);
  assert.equal(boardGrowth.summarize(board).outstanding, 3);
});

test("manual requests, defect repairs, handoffs and explicit growth bypass a full discovery buffer", async () => {
  const board = { tasks: [task("one"), task("two"), task("three")], requests: [] };
  const { env } = intakeHost(board);
  assert.equal(await env.queueRequests([proposal("held")], { automaticGrowth: true }), 0);
  assert.equal(await env.queueRequests([proposal("manual", "chat"), proposal("repair", "audit"),
    { ...proposal("handoff"), handoffId: "child", fromRun: "parent" }], { automaticGrowth: true }), 3);
  assert.equal(await env.queueRequests([proposal("explicit")], { automaticGrowth: false }), 1);
});

test("automatic build roles wait before spending an AI call; an explicit growth request may continue", async () => {
  const calls = [], admitted = [];
  const env = vm.createContext({
    assistantState: { prefs: {} }, assistantCache: {},
    growthBoardFacts: async () => ({ outstanding: 95, growthHeld: true }),
    assistantBriefCall: async () => { calls.push("AI"); return { ok: true, briefing: { summary: "Scoped follow-up" } }; },
    assistantAiOk() {}, assistantSetProblems() {}, getEyes: async () => ({}), requestBaseline: async () => [],
    requestsFromExpand: () => [proposal("explicit")], queueRequests: async (rows, options) => { admitted.push(options); return rows.length; },
    assistantLog() {}, assistantAskForWork() {},
  });
  vm.runInContext(section("async function assistantBuildJob(", "const assistantImproverJob"), env);
  const held = await env.assistantBuildJob("grower", "grow", { automaticGrowth: true });
  assert.match(held.text, /95 existing obligations/);
  assert.equal(calls.length, 0);
  env.assistantState.prefs.backlogMode = true;
  await env.assistantBuildJob("grower", "grow", { automaticGrowth: false });
  assert.equal(calls.length, 1);
  assert.equal(admitted[0].automaticGrowth, false);
});

test("demand priority from an automatic agent never grants explicit growth authorization", async () => {
  const calls = [];
  const env = vm.createContext({
    assistantState: { prefs: {} }, ASSISTANT_PRIORITY: { cadence: 1, demand: 2 },
    ASSISTANT_ROLE_JOBS: { improver: (_now, entry) => { calls.push(entry.automaticGrowth); } },
    enqueue: (_role, job) => job({}),
  });
  vm.runInContext(section("function assistantEnqueueRole(", "// On-demand roles"), env);
  await env.assistantEnqueueRole("improver", 2);
  await env.assistantEnqueueRole("improver", 2, { automatic: true });
  await env.assistantEnqueueRole("improver", 2, { explicitGrowth: true });
  assert.deepEqual(calls, [true, true, false]);
});

test("overseer still reviews and repairs a large board while speculative upgrades stay held", async () => {
  const state = assistant.emptyState(1000), effects = [], added = [];
  const env = vm.createContext({
    assistantState: state, getAssistant: async () => assistant, overseerManualUntil: 0,
    assistantOverseerRepair: async () => { effects.push("repair"); return { fixed: [], directives: [], rescued: 0, staleCount: 0 }; },
    growthBoardFacts: async () => ({ outstanding: 95, growthHeld: true, existingWork: [task("existing")] }),
    SMOKE: false, assistantAiUsable: () => true, ASSISTANT_OVERSEER_SYSTEM: "fixture",
    overseerFacts: (_now, board) => ({ board }),
    assistantFetch: async (_system, payload) => {
      assert.equal(JSON.parse(payload).board.outstanding, 95);
      effects.push("review");
      return { ok: true, text: JSON.stringify({ upgrades: [{ title: "New speculative upgrade", prompt: "Create more work" }] }) };
    },
    assistantAiOk() {}, assistantSetProblems() {}, assistantSetPrefs: async () => {},
    getEyes: async () => ({}), isStudioProject: () => true,
    requestsFromExpand: (briefing) => briefing.expand, requestBaseline: async () => [],
    queueRequests: async (rows) => { added.push(...rows); return rows.length; },
    assistantLog() {}, assistantClip: (value, max) => String(value ?? "").slice(0, max),
    assistantCommitThought() {}, assistantAppendReply() {}, assistantEnqueueRole() {}, ASSISTANT_PRIORITY: { demand: 2 },
    assistantAskForWork() {}, saveAssistant: async () => {},
  });
  vm.runInContext(section("async function assistantOverseerJob(", "// An assistant call that hovers"), env);
  const result = await env.assistantOverseerJob(1000);
  assert.equal(result.ok, true);
  assert.deepEqual(effects, ["repair", "review"]);
  assert.equal(state.overseer.reviews, 1);
  assert.equal(added.length, 0);
});

test("timer still settles and dispatches backlog but does not run duplicate expansion", async () => {
  const effects = [];
  const env = vm.createContext({
    Date, projectSwitching: false, SMOKE: false, CAPTURE: false, CLI_MODE: false,
    assistantState: { status: "running", prefs: {} }, autopilot: { enabled: true, execute: true }, TASKS_PATH: "tasks",
    projects: { open: () => ({ id: "fixture" }) },
    getEyes: async () => ({ readJson: async () => [] }),
    autopilotProactivePass: async () => ({ added: 0 }), growthBoardFacts: async () => ({ growthHeld: true }),
    runAssistant: () => assert.fail("automatic discovery must wait for existing work"),
    autopilotHousekeeping: async () => effects.push("settle"), classifyPendingWork: async () => ({ ok: true }), promoteRequestsToTasks: async () => effects.push("promote"),
    refreshAutopilotQueue: async () => {}, pushAutopilotHistory() {}, emitAutopilot() {},
    assistantAskForWork: () => effects.push("dispatch"), logLine: (line) => assert.fail(line),
  });
  vm.runInContext(`let autopilotTicks = 11;\n${section("let autopilotPassInFlight = null;", "async function setAutopilot(")}`, env);
  await env.autopilotPass();
  assert.deepEqual(effects, ["settle", "promote", "dispatch"]);
});
