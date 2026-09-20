import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { baselineCompareWork } from "../scripts/policy.mjs";
import boardGrowth from "../scripts/board-growth.cjs";
import chatWork from "../scripts/chat-work.cjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
}
const copy = (value) => JSON.parse(JSON.stringify(value));

function host({ requests = [], tasks = [] } = {}) {
  const board = { requests: copy(requests), tasks: copy(tasks), ideas: [] };
  const accepted = [];
  let serial = 0;
  const context = vm.createContext({
    boardGrowth, chatWork,
    Date, crypto: { randomBytes: () => ({ toString: () => String(++serial) }) },
    projects: { current: () => ({ id: "fixture" }), stamp: (row) => row }, projectRoot: () => "/fixture",
    workTitleKey: (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(),
    taskPriority: (row) => row.source === "chat" ? 4 : 1,
    compareWork: baselineCompareWork, workPlanTheme: () => null, workFixTheme: () => null, isFixWork: () => false,
    mutateBoard: async (mutate) => ({ ...mutate(board, {}), ...board }),
    jevShadowIntake: (rows) => { if (rows?.length) accepted.push(...rows); },
    refreshAutopilotQueue: async () => {}, assistantLog: () => {}, assistantNodeContext: () => null,
  });
  vm.runInContext(section("async function queueRequests(", "// Jev classifies admitted observations"), context);
  vm.runInContext(section("async function promoteRequestsToTasks()", "// The `opencode run` child"), context);
  return { context, board, accepted };
}

test("one intake batch admits each repeated request once before classification and promotion", async () => {
  const { context, board, accepted } = host();
  const first = { title: "Repair saved tabs", prompt: "Restore tabs after restart", source: "audit", at: 1 };
  const repeated = { ...first, title: "Repair saved tabs!" };
  const second = { title: "Retain task drafts", prompt: "Restore unsent task drafts", source: "audit", at: 2 };
  assert.equal(await context.queueRequests([first, repeated, second, second]), 2);
  assert.deepEqual(copy(board.requests), [first, second]);
  assert.deepEqual(copy(accepted), [first, second]);
  assert.equal(await context.promoteRequestsToTasks(), 2);
  assert.equal(board.tasks.length, 2);
  assert.equal(await context.promoteRequestsToTasks(), 0);
});

test("legacy duplicate inbox entries cannot create multiple task cards in one promotion pass", async () => {
  const { context, board } = host({ requests: [
    { title: "Restore tabs", prompt: "Retain the tabs", at: 1 },
    { title: "Restore tabs!", prompt: "Retain the tabs", at: 2 },
    { title: "Restore tabs", prompt: "Retain the tabs", at: 3 },
    { title: "Retain drafts", prompt: "Retain the drafts", at: 4 },
  ] });
  assert.equal(await context.promoteRequestsToTasks(), 2);
  assert.equal(board.tasks.length, 2);
  assert.equal(board.requests.length, 4, "promotion keeps the original requests until compaction");
});

test("promotion honors the same explicit pin ranking as dispatch", async () => {
  const { context, board } = host({ requests: [
    { title: "First ordinary task", source: "chat", at: 1 },
    { title: "Second ordinary task", source: "chat", at: 2 },
    { title: "Third ordinary task", source: "chat", at: 3 },
    { title: "User chose this next", source: "audit", at: 10, pin: true, pinAt: 12 },
  ] });
  assert.equal(await context.promoteRequestsToTasks(), 3);
  assert.ok(board.tasks.some((task) => task.title === "User chose this next"));
  assert.ok(!board.tasks.some((task) => task.title === "Third ordinary task"));
});

test("batch dedupe preserves different scopes and title-only requests", async () => {
  for (const requests of [
    [
      { title: "Repair tabs", prompt: "Restore tabs after restart", source: "audit", at: 1 },
      { title: "Repair tabs", prompt: "Retain unsaved buffers", source: "audit", at: 2 },
    ],
    [{ title: "Restore tabs" }, { title: "Retain unsaved buffers" }],
  ]) {
    const { context, board, accepted } = host();
    assert.equal(await context.queueRequests(requests), 2);
    assert.deepEqual(copy(accepted), requests);
    assert.equal(await context.promoteRequestsToTasks(), 2);
    assert.deepEqual(copy(board.tasks.map((task) => task.prompt).sort()), requests.map((request) => request.prompt ?? "").sort());
  }
});

test("promotion does not reopen completed, held, grouped or reviewing inbox work", async () => {
  const held = ["done", "archived", "running", "active", "verifying", "awaiting_verification", "blocked", "absorbed"];
  const requests = held.map((status, index) => ({ title: `Held ${status}`, status, at: index }));
  requests.push({ title: "Ready", status: "pending", at: 20 }, { title: "Claimed", runId: "live-run", at: 21 });
  const { context, board } = host({ requests });
  assert.equal(await context.promoteRequestsToTasks(), 1);
  assert.deepEqual(copy(board.tasks.map((task) => task.title)), ["Ready"]);
  assert.deepEqual(copy(board.requests), requests);
});

test("explicit task admission retains a full brief and focused handoff beyond the old character cap", async () => {
  const { context, board } = host();
  const prompt = `${"Detailed requirement. ".repeat(100)}Final acceptance: verify keyboard navigation.`;
  const task = await context.assistantCreateTask({ title: "Implement task picker", prompt,
    focused: { title: "Original discussion", target: { kind: "session", id: "session-fixture" } } });
  assert.ok(task.prompt.startsWith(prompt));
  assert.match(task.prompt, /Final acceptance: verify keyboard navigation/);
  assert.match(task.prompt, /Original discussion.*session-fixture/);
  assert.equal(board.tasks[0].prompt, task.prompt);
});

test("chat request routing preserves the complete user instruction before task admission", async () => {
  const { context, board } = host();
  const text = `${"Detailed requirement. ".repeat(80)}Final acceptance: verify keyboard navigation.`;
  Object.assign(context, {
    assistantState: { status: "paused" }, autopilot: { execute: false },
    getAssistant: async () => ({ classifyIntent: () => "request", localReply: () => ({ text: "Request saved", actions: ["queue-request"] }) }),
    assistantMessageFacts: async () => ({}), assistantThink: () => {}, assistantClip: (value, max) => String(value).slice(0, max),
    assistantFocusSubject: () => null, assistantAskForWork: () => {}, assistantAiUsable: () => false,
    assistantAppendReply: (text) => ({ role: "assistant", text }), saveAssistant: async () => {},
  });
  vm.runInContext(section("async function assistantRespond(", "// A message is appended and pushed"), context);
  const reply = await context.assistantRespond({ text, id: "fixture-message" });
  assert.equal(board.tasks.length, 1, reply.text);
  assert.equal(board.tasks[0].prompt, text);
});
