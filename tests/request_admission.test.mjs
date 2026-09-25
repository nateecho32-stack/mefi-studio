import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { baselineCompareWork } from "../scripts/policy.mjs";
import boardGrowth from "../scripts/board-growth.cjs";
import chatWork from "../scripts/chat-work.cjs";
import workAdmission from "../scripts/work-admission.cjs";
import * as assistant from "../scripts/assistant.mjs";

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
    boardGrowth, chatWork, workAdmission,
    Date, crypto: { randomBytes: () => ({ toString: () => String(++serial) }) },
    projects: { current: () => ({ id: "fixture" }), stamp: (row) => row }, projectRoot: () => "/fixture",
    workTitleKey: assistant.compactKey,
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

test("a Work on it request does not promote a duplicate beside the task it points at", async () => {
  const { context, board } = host({
    tasks: [{ id: "gate", title: "Post-commit quiet-tree gate rerun", prompt: "Diff the landed bytes and rerun once", status: "active" }],
    requests: [{ title: 'Work on "Post-commit quiet-tree gate rerun"',
      prompt: 'Work on "Post-commit quiet-tree gate rerun". Queued with Work on it — the user pointed at session (id: ses_fixture).',
      source: "chat", at: 5, target: { kind: "session", id: "ses_fixture" } }],
  });
  assert.equal(await context.promoteRequestsToTasks(), 0);
  assert.equal(board.tasks.length, 1);
  assert.equal(board.tasks[0].id, "gate");
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
  // Deliberately changed: the promoted row is stamped with its card (and
  // never promoted again); every held row is untouched.
  assert.deepEqual(copy(board.requests), requests.map((row) => row.title === "Ready" ? { ...row, promotedTo: board.tasks[0].id } : row));
});

test("a promoted request is linked to its card, whatever its title key", async () => {
  const long = "Expand the explorer tree so collapsed folders remember their state across project switches and restarts";
  for (const request of [
    { title: long, prompt: "Persist collapsed folder state per project.", at: 5, source: "expand" },
    { title: "修复登录页面的错误", prompt: "登录页面在提交后崩溃，请修复。", at: 5, source: "manual" },
  ]) {
    const { context, board } = host({ requests: [request] });
    assert.equal(await context.promoteRequestsToTasks(), 1);
    assert.equal(await context.promoteRequestsToTasks(), 0, "a second pass does not promote the same request again");
    assert.equal(board.tasks.length, 1);
    assert.equal(board.requests[0].promotedTo, board.tasks[0].id);
    const compacted = assistant.compact({ requests: copy(board.requests), tasks: copy(board.tasks), ideas: [], now: 10 });
    assert.equal(compacted.requests.length, 0, "the compactor absorbs the request into its card");
  }
});

test("two different titles with no compact key are not each other's duplicate", async () => {
  const { context, board } = host();
  assert.ok(await context.assistantCreateTask({ title: "修复登录页面" }));
  assert.ok(await context.assistantCreateTask({ title: "添加深色模式" }), "an unrelated non-Latin title is new work");
  assert.equal(await context.assistantCreateTask({ title: "修复登录页面" }), null, "the same title is still a duplicate");
  assert.equal(board.tasks.length, 2);
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
    assistantGatherTaskReferences: () => null, setTimeout, clearTimeout, logError: (text) => { throw new Error(text); },
  });
  vm.runInContext(section("// ---- the overseer's hands", "// A message is appended and pushed"), context);
  const reply = await context.assistantRespond({ text, id: "fixture-message" });
  assert.equal(board.tasks.length, 1, reply.text);
  assert.equal(board.tasks[0].prompt, text);
});
