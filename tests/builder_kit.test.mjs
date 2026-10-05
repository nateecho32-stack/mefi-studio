// What renderer/builder.js hands the v2 session panels (renderer/sessions.js), so the two layouts decide
// everything about a task the same way: the stage groups, what a task offers, a question's answer, a note, an
// Ask and a Change, what "Done when" says, the chips' host calls, and the change announcement. The real builder.js
// runs here in the shared fake DOM with the sessions layout OFF (the classic default), which is how the v2 panels
// meet it: nothing is drawn, nothing listens, and every one of these still works. The sessions layout's own behaviour
// is pinned, unchanged, by tests/builder_sessions.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createEnv, createPage } from "./fixtures/builder-env.mjs";

const NOW = new Date(2026, 6, 15, 14, 30).getTime();
const at = (daysAgo, hour = 12, minute = 0) => new Date(2026, 6, 15 - daysAgo, hour, minute).getTime();
const clean = (value) => JSON.parse(JSON.stringify(value));
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
};
const task = (id, extra = {}) => ({ id, projectId: "p1", title: `Task ${id}`, prompt: `Do ${id}`, status: "open", createdAt: at(30), updatedAt: at(30), ...extra });
const LABELS = { running: "Working", review: "Checking", blocked: "Blocked", approval: "Needs approval", waiting: "Waiting", done: "Done", ready: "Ready to start" };
const summary = (stage, more = {}) => ({ stage, label: LABELS[stage] ?? stage, checks: "No completion checks recorded", worker: "", action: "", activityAge: "", blocker: "", nextAction: "", ...more });

function bridge(seed = {}) {
  const calls = [];
  const state = { attempts: [], fail: {}, reply: { ok: true, state: { messages: [] } }, ...seed };
  const answer = (name, value) => async (...args) => { calls.push([name, ...args]); return state.fail[name] ? { ok: false, error: state.fail[name] } : value; };
  const api = {
    tasksAttempts: async (payload) => { calls.push(["tasksAttempts", payload]); return state.fail.tasksAttempts ? { ok: false, error: state.fail.tasksAttempts } : { ok: true, attempts: state.attempts }; },
    tasksSave: answer("tasksSave", { ok: true }), tasksCreate: answer("tasksCreate", { ok: true }), tasksAction: answer("tasksAction", { ok: true }),
    backlogControl: answer("backlogControl", { ok: true }), assistantAnswer: answer("assistantAnswer", { ok: true }),
    assistantMessage: async (...args) => { calls.push(["assistantMessage", ...args]); return state.fail.assistantMessage ? { ok: false, error: state.fail.assistantMessage } : state.reply; },
    workWhere: async () => { calls.push(["workWhere"]); return { ok: true, projectId: "p1", repo: true, branch: "main", head: "abc1234", dirty: 0, worktrees: { on: false, forced: false } }; },
    getAiRouting: async () => { calls.push(["getAiRouting"]); return { ok: true, executorCli: "opencode", executorTier: "auto" }; },
    setAiRouting: async (patch) => { calls.push(["setAiRouting", patch]); return { ok: true }; },
    workWorktrees: async (on) => { calls.push(["workWorktrees", on]); return { ok: true, worktrees: { on, forced: false } }; },
    cliStatus: async () => [{ id: "opencode", installed: true }],
    onTasks() {}, onAssistant() {}, onAssistantStatus() {}, onProjects() {},
  };
  return Object.assign(api, { calls, state });
}

/** builder.js loaded into a classic-layout page: the way the v2 panels find it. */
async function app({ tasks = [], stages = {}, questions = [], running = [], messages = [], backlog = null, preview = null, api = bridge(), search = "", panes = false } = {}) {
  for (const rows of [tasks, questions, running, messages]) rows.forEach(deepFreeze);
  const env = createEnv({ storage: new Map(), now: NOW, search });
  createPage(env);
  const calls = { go: [], toasts: [], refresh: 0, started: [] };
  const data = { projectId: "p1", project: { id: "p1", name: "Snake trial" }, projects: [], tasks, ideas: [], assistant: { messages, questions }, status: { running }, backlog, preview, mode: "work", pending: false };
  const { window } = env;
  window.MefiVibe = { mode: () => "build" };
  window.MefiNav = { register() {}, go: (...args) => calls.go.push(args), historyState: () => ({}), taskContext: () => null, selectTask() {}, saveResume() {}, back() {}, forward() {} };
  window.MefiWorkspace = { isActive: () => true, snapshot: () => data, setComposerMode() {}, refresh: () => { calls.refresh += 1; }, startTask: (row) => { calls.started.push(row.id); return Promise.resolve(); }, previewAction: (name) => { calls.started.push(`preview:${name}`); } };
  window.MefiTasks = { workflowSummary: (item) => summary(stages[item.id] ?? (item.status === "done" ? "done" : item.status === "active" ? "running" : item.status === "awaiting_verification" ? "review" : "ready")), shortTitle: (item) => String(item.title || item.prompt || "").slice(0, 60) };
  window.MefiToast = (message, kind) => calls.toasts.push([message, kind]);
  window.mefiStudio = api;
  if (panes) await env.load("panes.js");
  await env.load("builder.js");
  return { env, window, B: window.MefiBuilder, calls, api, data, settle: async () => { env.flush(); await env.settle(); env.flush(); } };
}

test("the classic layout still exports the kit: the layout is off, nothing is drawn and nothing listens", async () => {
  const a = await app({ tasks: [task("t1")] });
  assert.equal(a.B.layout(), "classic");
  assert.equal(a.B.active(), false);
  for (const name of ["stageGroups", "taskActionSpecs", "dropSpec", "perform", "busy", "answerQuestion", "INTENTS", "defaultIntent", "sendWords", "checksNodes", "acceptanceOf", "timeline", "loadAttempts", "attempts", "asks", "pins", "setPinned", "chips", "resetProject", "subscribe", "lastMoved", "stampOf", "ago", "span", "isDone"]) {
    assert.ok(a.B[name] !== undefined, `MefiBuilder.${name} is there`);
  }
  assert.equal(a.env.listeners("mefi:workspace-state"), 0, "no listener was added for the classic layout");
  assert.equal(a.env.frames.length, 0, "and no frame was asked for");
});

// ---- the stage groups --------------------------------------------------------------------------------------------

test("stage groups: Needs you, Running, Review, Queued and Done in that order, newest first, the pinned on top, archived work left out", async () => {
  const board = [
    task("ready-old", { updatedAt: at(9) }), task("ready-new", { updatedAt: at(1) }), task("ready-pinned", { updatedAt: at(20) }),
    task("asking"), task("blocked", { updatedAt: at(2) }), task("working", { status: "active", runId: "r1" }), task("checking", { status: "awaiting_verification" }),
    task("waiting", { updatedAt: at(3) }), task("finished", { status: "done", doneAt: at(2), updatedAt: at(2) }), task("finished-later", { status: "done", doneAt: at(1), updatedAt: at(1) }),
    task("dropped", { status: "done", doneAt: at(4), updatedAt: at(4), dropped: { at: at(4) } }), task("archived", { status: "archived" }), task("flagged", { archived: true }),
  ];
  const questions = [{ id: "q1", status: "open", context: { taskId: "asking" }, title: "Which?" }, { id: "q2", status: "answered", context: { taskId: "ready-new" }, title: "Old" }];
  const a = await app({ tasks: board, questions, stages: { blocked: "blocked", working: "running", checking: "review", waiting: "waiting" }, running: [{ taskId: "working", runId: "r1" }] });
  const groups = a.B.stageGroups(a.data.tasks, { pinned: new Set(["ready-pinned"]) });
  assert.deepEqual(clean(groups.map((group) => [group.key, group.title])), [["needs", "Needs you"], ["running", "Running"], ["review", "Review"], ["queued", "Queued"], ["done", "Done"]], "every group, in the order a person looks at them");
  const ids = clean(Object.fromEntries(groups.map((group) => [group.key, group.rows.map((row) => row.id)])));
  assert.deepEqual(ids.needs, ["blocked", "asking"], "an open question and a block both need you, the one that moved last on top");
  assert.deepEqual(ids.running, ["working"]);
  assert.deepEqual(ids.review, ["checking"]);
  assert.deepEqual(ids.queued, ["ready-pinned", "ready-new", "waiting", "ready-old"], "pinned first, then newest first, in the queue");
  assert.deepEqual(ids.done, ["finished-later", "finished", "dropped"], "finished work, newest first, a dropped task among it");
  assert.ok(!Object.values(ids).flat().some((id) => ["archived", "flagged"].includes(id)), "archived work stays on the board's own page");
  assert.equal(a.B.stageGroups([]).every((group) => group.rows.length === 0), true, "an empty board still names every group");
  assert.deepEqual(clean(a.B.stageGroups(null).map((group) => group.rows.length)), [0, 0, 0, 0, 0], "and a board that is not a list is an empty one");
});

test("stage groups read the same tone as the menu's groups, so the two can never disagree about what needs you", async () => {
  const board = [task("a", { updatedAt: at(1) }), task("b", { updatedAt: at(2), status: "active" }), task("c", { updatedAt: at(3), status: "awaiting_verification" }), task("d", { updatedAt: at(4), status: "done" })];
  const a = await app({ tasks: board, questions: [{ id: "q", status: "open", taskId: "a", title: "Sure?" }] });
  const tone = clean(Object.fromEntries(board.map((row) => [row.id, a.B.reading(row, a.data).tone])));
  assert.deepEqual(tone, { a: "ask", b: "run", c: "check", d: "done" });
  const byStage = clean(Object.fromEntries(a.B.stageGroups(board, { pinned: new Set(), data: a.data }).flatMap((group) => group.rows.map((row) => [row.id, group.key]))));
  assert.deepEqual(byStage, { a: "needs", b: "running", c: "review", d: "done" });
  // The old grouping puts the same tasks in the same places: Needs you first, Working for a run and a check.
  const older = Object.fromEntries(a.B.groups(board, { now: NOW, pinned: new Set(), data: a.data }).flatMap((group) => group.rows.map((row) => [row.id, group.key])));
  assert.equal(older.a, "needs"); assert.equal(older.b, "working"); assert.equal(older.c, "working");
});

test("in the 0.5 layout Needs you is the Inbox's list: a session the Inbox holds for a decision is there, one the reading calls blocked that the Inbox does not hold waits with the queue", async () => {
  const board = [task("asking"), task("held"), task("cooling", { verification: { state: "failed" } }), task("step"), task("parked"), task("checking", { status: "awaiting_verification" }), task("plain")];
  const stages = { held: "blocked", cooling: "blocked", step: "approval", parked: "ready", checking: "review" };
  const a = await app({ tasks: board, stages, questions: [{ id: "q", status: "open", taskId: "asking", title: "Sure?" }] });
  // No Inbox (the classic layout): the reading alone decides, as before.
  const before = clean(Object.fromEntries(a.B.stageGroups(board, { pinned: new Set(), data: a.data }).flatMap((group) => group.rows.map((row) => [row.id, group.key]))));
  assert.deepEqual(before, { asking: "needs", held: "needs", cooling: "needs", step: "needs", parked: "queued", checking: "review", plain: "queued" });
  // The Inbox holds the question's task, the held one and a parked one the reading does not call blocked; not the failed check
  // that will retry by itself, nor a step whose go-ahead is asked once for its whole request.
  a.window.MefiToday = { isOn: () => true, needTasks: () => new Set(["asking", "held", "parked"]) };
  const after = clean(Object.fromEntries(a.B.stageGroups(board, { pinned: new Set(), data: a.data }).flatMap((group) => group.rows.map((row) => [row.id, group.key]))));
  // The owner's rule (2026-10-04): the check that retries by itself is with the running work, fixing itself; the step that
  // goes ahead with its request waits with the queue and says so.
  assert.deepEqual(after, { asking: "needs", held: "needs", cooling: "running", step: "queued", parked: "needs", checking: "review", plain: "queued" }, "Needs you is exactly what the Inbox holds; a result waits under Review");
  assert.deepEqual([a.B.reading(board[2], a.data).tone, a.B.reading(board[2], a.data).label, a.B.reading(board[2], a.data).fixing], ["run", "Fixing itself", true], "the tabs and the list read the same tone");
  assert.equal(a.B.reading(board[3], a.data).label, "Goes ahead with its request");
  // An Inbox that is off, or that throws, leaves the reading as it was.
  a.window.MefiToday = { isOn: () => false, needTasks: () => new Set() };
  assert.equal(a.B.reading(board[1], a.data).tone, "ask");
  a.window.MefiToday = { isOn: () => true, needTasks: () => { throw new Error("no"); } };
  assert.equal(a.B.reading(board[1], a.data).tone, "ask");
});

// ---- what a task offers ----------------------------------------------------------------------------------------------

test("what a task offers is described once: the sessions layout's buttons and the v2 thread's come from the same specs", async () => {
  const board = [
    task("ready"), task("resumable", { continuation: { note: "x" } }), task("approval", { buildScope: "scope-1" }), task("blocked"), task("owner"), task("failed", { verification: { state: "failed" } }),
    task("finished", { status: "done", doneAt: at(1) }), task("checking", { status: "awaiting_verification" }), task("working"),
  ];
  const stages = { approval: "approval", blocked: "blocked", checking: "review" };
  const backlog = { taskStates: [{ id: "approval", buildScope: "scope-2" }, { id: "owner", blockedBy: "owner" }] };
  const a = await app({ tasks: board, stages, backlog, preview: { phase: "ready" }, running: [{ taskId: "working", runId: "r-w" }] });
  const specs = (id) => {
    const row = board.find((item) => item.id === id);
    const run = a.data.status.running.find((job) => job.taskId === id);
    return a.B.taskActionSpecs(row, a.B.reading(row, a.data), run, a.data);
  };
  const labels = (id) => clean(specs(id).map((spec) => spec.label));
  assert.deepEqual(labels("ready"), ["Start"]);
  assert.deepEqual(labels("resumable"), ["Resume"]);
  assert.deepEqual(labels("approval"), ["Approve build"]);
  assert.deepEqual(labels("blocked"), ["Try again"]);
  assert.deepEqual(labels("owner"), ["Resume"], "held by you: Resume, not Try again");
  assert.deepEqual(labels("failed"), ["Try again"]);
  assert.deepEqual(labels("finished"), ["Open app", "Request a change"]);
  assert.deepEqual(labels("checking"), [], "while checks run there is nothing to press");
  assert.deepEqual(labels("working"), ["Stop", "Watch live"]);
  assert.deepEqual(clean(specs("working").map((spec) => [spec.id, spec.kind, Boolean(spec.call), Boolean(spec.open), spec.armed ?? null])), [["stop", "ghost", true, false, "Stop it?"], ["watch", "ghost", false, true, null]]);
  assert.deepEqual(clean(specs("finished").map((spec) => [spec.id, spec.kind, spec.intent ?? null])), [["open-app", "primary", null], ["change", "ghost", "change"]]);
  // Each call goes to the host the way the sessions layout's buttons do.
  await specs("approval")[0].call();
  await specs("blocked")[0].call();
  await specs("working")[0].call();
  await specs("ready")[0].call();
  assert.deepEqual(clean(a.api.calls.filter((call) => ["backlogControl", "tasksAction"].includes(call[0]))), [
    ["backlogControl", { action: "approve", taskId: "approval", projectId: "p1", expectedScope: "scope-2" }],
    ["tasksAction", { taskId: "blocked", projectId: "p1", action: "retry" }],
    ["tasksAction", { taskId: "working", projectId: "p1", action: "stop" }],
  ], "an approval names the scope it was shown, a stop and a retry name the task");
  assert.deepEqual(clean(a.calls.started), ["ready"], "Start goes through Home's own start");
  specs("working")[1].open();
  assert.deepEqual(clean(a.calls.go.at(-1)), ["command", { taskId: "working", projectId: "p1", selected: "task:working", rail: "work" }]);
  assert.deepEqual(clean(specs("working").map((spec) => spec.done ?? null)), ["Stopped. Its progress is saved.", null]);
  // A drop is offered only for a task nobody holds.
  const drop = (id) => { const row = board.find((item) => item.id === id); return a.B.dropSpec(row, a.data.status.running.find((job) => job.taskId === id), a.data); };
  assert.equal(drop("ready").label, "Drop this task");
  assert.equal(drop("ready").armed, "Drop?");
  assert.equal(drop("working"), null, "not while a worker runs it");
  assert.equal(drop("finished"), null, "not once it is done");
  assert.equal(drop("checking"), null, "not while it is being checked");
  assert.equal(a.B.dropSpec(task("claimed", { runId: "r9" }), undefined, a.data), null, "nor with a worker's claim on it");
  for (const status of ["active", "running", "awaiting_verification", "verifying"]) assert.equal(a.B.dropSpec(task("held", { status }), undefined, a.data), null, `nor while its status is ${status}`);
  assert.ok(a.B.dropSpec(task("idle", { status: "open" }), undefined, a.data), "an open task nobody holds can be dropped");
  a.data.preview = { phase: "starting" };
  assert.deepEqual(labels("finished"), ["Request a change"], "Open app only when the preview is ready");
  a.data.preview = { phase: "ready" };
  a.window.MefiAutonomy = { state: () => ({ level: "accept" }) };
  assert.deepEqual(labels("approval"), ["Accept this task"], "where the permission mode accepts for you, the approval says so");
  a.window.MefiAutonomy = { state: () => ({ level: "auto" }) };
  assert.deepEqual(labels("approval"), ["Approve build"]);
  await drop("ready").call();
  assert.deepEqual(clean(a.api.calls.at(-1)), ["tasksAction", { taskId: "ready", projectId: "p1", action: "drop" }]);
});

test("perform is the one place a call runs: busy while it is out, the host's refusal said plainly, the board read again after a good one", async () => {
  const a = await app({ tasks: [task("t1")] });
  assert.equal(a.B.busy(), null);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = a.B.perform("retry", () => gate.then(() => ({ ok: true })), "Back in the queue.");
  assert.equal(a.B.busy(), "retry", "busy while the call is out");
  await a.B.perform("second", async () => ({ ok: true }), "Second."); // refused while another is out
  assert.deepEqual(clean(a.calls.toasts), [], "a second press is dropped, not queued");
  release();
  await first;
  assert.equal(a.B.busy(), null);
  assert.deepEqual(clean(a.calls.toasts), [["Back in the queue.", "good"]]);
  assert.equal(a.calls.refresh, 1, "and Home reads the board again");
  await a.B.perform("retry", async () => ({ ok: false, error: "That worker already finished." }), "Never said.");
  assert.equal(a.calls.toasts.at(-1)[1], "bad");
  assert.match(a.calls.toasts.at(-1)[0], /already finished/);
  assert.equal(a.calls.refresh, 1, "a refusal reads nothing again");
  assert.equal(a.B.busy(), null, "and the buttons are free again");
});

test("a question is answered through answerQuestion: an option or your own words, the label cut to fit the toast", async () => {
  const a = await app({ tasks: [task("t1")] });
  const question = { id: "q9", title: "Which palette?", options: [{ id: "sage", label: "Sage" }] };
  await a.B.answerQuestion(question, { optionId: "sage" }, "Sage");
  await a.B.answerQuestion(question, { text: "Something warmer, please" }, "Something warmer, please");
  assert.deepEqual(clean(a.api.calls.filter((call) => call[0] === "assistantAnswer")), [["assistantAnswer", { id: "q9", optionId: "sage" }], ["assistantAnswer", { id: "q9", text: "Something warmer, please" }]]);
  assert.deepEqual(clean(a.calls.toasts.map((toast) => toast[0])), ["Answered: Sage. Mefi carries on.", "Answered: Something warmer, please. Mefi carries on."]);
  const long = "A very long answer that goes on and on past sixty characters for sure, yes";
  await a.B.answerQuestion(question, { text: long }, long);
  assert.equal(a.calls.toasts.at(-1)[0], `Answered: ${long.slice(0, 57)}…. Mefi carries on.`);
});

// ---- the words of a session ------------------------------------------------------------------------------------------

test("sendWords does what each purpose of the box means: a dated note, a question to Mefi, a linked follow-up", async () => {
  const a = await app({ tasks: [task("t1", { title: "Add a sitemap", notes: "- earlier" })] });
  const row = a.data.tasks[0];
  assert.equal(await a.B.sendWords(row, "note", "Prefer the static generator", { data: a.data }), true);
  const saved = a.api.calls.find((call) => call[0] === "tasksSave")[1][0];
  assert.equal(saved.notes, "- earlier\n- Prefer the static generator");
  assert.deepEqual(clean(saved.logs.at(-1)).kind, "note");
  assert.deepEqual(clean(a.calls.toasts.at(-1)), ["Saved. Its next run reads it.", "good"]);

  assert.equal(await a.B.sendWords(row, "ask", "What is left?", { data: a.data }), true);
  assert.deepEqual(clean(a.api.calls.find((call) => call[0] === "assistantMessage")), ["assistantMessage", 'About the task "Add a sitemap" (t1): What is left?', "p1", { view: "Build · task", companion: "Mefi", taskId: "t1" }], "no pictures: the call is exactly what it always was");
  assert.equal(a.B.asks("t1").length, 1, "the question and its reply are kept for the feed");
  assert.equal(a.B.asks("t1")[0].reply, "Sent. The reply is in the chat.");

  assert.equal(await a.B.sendWords(row, "change", "Make it smaller\nand faster", { data: a.data }), true);
  assert.deepEqual(clean(a.api.calls.find((call) => call[0] === "tasksCreate")), ["tasksCreate", { title: "Change: Make it smaller", prompt: 'Follow-up to task "Add a sitemap" (t1).\n\nRequested change:\nMake it smaller\nand faster', projectId: "p1" }]);
  assert.deepEqual(clean(a.calls.toasts.at(-1)), ["Follow-up task created. It shows in the menu.", "good"]);
  assert.equal(a.calls.refresh, 3, "after each one the board is read again");
});

test("a note is kept to the last four thousand characters and the log to its last forty lines, so a long-lived task does not grow without end", async () => {
  const logs = Array.from({ length: 45 }, (_, index) => ({ at: at(2, 9, index), kind: "log", text: `line ${index}` }));
  const a = await app({ tasks: [task("t1", { notes: "x".repeat(3990), logs })] });
  assert.equal(await a.B.sendWords(a.data.tasks[0], "note", "y".repeat(50), { data: a.data }), true);
  const saved = a.api.calls.find((call) => call[0] === "tasksSave")[1][0];
  assert.equal(saved.notes.length, 4000);
  assert.ok(saved.notes.endsWith(`- ${"y".repeat(50)}`), "the newest words are the ones kept");
  assert.equal(saved.logs.length, 40);
  assert.equal(saved.logs.at(-1).kind, "note", "with the new note last");
  assert.equal(saved.logs[0].text, "line 6", "and the oldest lines dropped");
});

test("sendWords carries the box's pictures with an Ask and a Change, and never with a note", async () => {
  const a = await app({ tasks: [task("t1", { title: "Add a sitemap" })] });
  const row = a.data.tasks[0];
  const ids = ["img_" + "a".repeat(24), "img_" + "b".repeat(24)];
  await a.B.sendWords(row, "ask", "What do you see?", { data: a.data, images: ids });
  assert.deepEqual(clean(a.api.calls.find((call) => call[0] === "assistantMessage").slice(-1)), [ids], "an Ask sends them as the message's pictures");
  await a.B.sendWords(row, "change", "Match this", { data: a.data, images: ids });
  assert.deepEqual(clean(a.api.calls.find((call) => call[0] === "tasksCreate")[1].images), ids, "a Change names them in the follow-up");
  await a.B.sendWords(row, "note", "Remember this", { data: a.data, images: ids });
  assert.equal(JSON.stringify(a.api.calls.find((call) => call[0] === "tasksSave")).includes("img_"), false, "a note has no way to carry a picture, and says nothing about one");
});

test("sendWords sends one thing at a time, says a failure in words and leaves the words with the caller", async () => {
  const api = bridge({ fail: { assistantMessage: "No model is available." } });
  const a = await app({ tasks: [task("t1")], api });
  const row = a.data.tasks[0];
  const order = [];
  assert.equal(await a.B.sendWords(row, "ask", "Hello?", { data: a.data, started: () => order.push("started"), sent: () => order.push("sent") }), false);
  assert.deepEqual(clean(order), ["started"], "a failure never calls `sent`, so the caller keeps its words");
  assert.equal(a.calls.toasts.at(-1)[1], "bad");
  assert.match(a.calls.toasts.at(-1)[0], /No model is available/);
  assert.equal(a.calls.refresh, 0, "and reads nothing again");
  assert.equal(a.B.asks("t1")[0].error.includes("No model"), true, "the feed shows the question with why it failed");
  assert.equal(a.B.busy(), null, "the box is free again");
  assert.equal(await a.B.sendWords(row, "note", "   ", { data: a.data }), false, "no words, nothing to send");
  assert.equal(await a.B.sendWords(null, "note", "x", { data: a.data }), false, "no task, nothing to send");
  // While one send is out, another is refused.
  let release;
  api.state.reply = undefined;
  a.api.assistantMessage = async () => { await new Promise((resolve) => { release = resolve; }); return { ok: true, state: { messages: [] } }; };
  const first = a.B.sendWords(row, "ask", "First", { data: a.data });
  assert.equal(a.B.busy(), "compose");
  assert.equal(await a.B.sendWords(row, "note", "Second", { data: a.data }), false, "one at a time");
  release();
  assert.equal(await first, true);
  order.length = 0;
  assert.equal(await a.B.sendWords(row, "note", "Third", { data: a.data, started: () => order.push("started"), sent: () => order.push("sent") }), true);
  assert.deepEqual(clean(order), ["started", "sent"], "started once the box is locked, sent once the words went");
});

test("the purposes keep their words: Change for a finished task, Ask while a worker runs, Note for the rest", async () => {
  const a = await app({ tasks: [task("t1")] });
  const d = (row, run) => a.B.defaultIntent(row, null, run);
  assert.equal(d(task("done", { status: "done" }), null), "change");
  assert.equal(d(task("open"), { taskId: "open" }), "ask");
  assert.equal(d(task("open"), null), "note");
  assert.deepEqual(clean(Object.keys(a.B.INTENTS)), ["note", "ask", "change"]);
  assert.equal(a.B.INTENTS.change.send, "Create follow-up");
});

// ---- what a task must pass -----------------------------------------------------------------------------------------

test("checksNodes says what a task must pass and how the last run went, the same words as the Checks pane", async () => {
  const row = task("t1", { acceptance: ["sitemap.xml exists", "  ", "routes are listed"], verificationRun: { state: "failed", results: [{ ok: true, name: "npm test" }, { ok: false, command: "npm run lint", detail: "3 errors" }, { name: "build" }] }, verification: { state: "failed", reason: "Lint failed" } });
  const a = await app({ tasks: [row] });
  const nodes = a.B.checksNodes(a.data.tasks[0], a.data);
  assert.equal(nodes[0].textContent, "No completion checks recorded", "the lead line is the reading's own");
  assert.deepEqual(clean(nodes.map((node) => node.tagName)), ["p", "h3", "ul", "h3", "ul", "p"]);
  assert.deepEqual(clean(nodes[2].children.map((li) => li.textContent)), ["sitemap.xml exists", "routes are listed"], "blank lines are left out");
  assert.deepEqual(clean(nodes[4].children.map((li) => [li.className, li.children[0].textContent, li.children[1].textContent, li.children[2]?.textContent ?? null])), [["ok", "Passed", "npm test", null], ["bad", "Failed", "npm run lint", "3 errors"], ["", "Ran", "build", null]]);
  assert.equal(nodes[5].textContent, "Not accepted: Lint failed");
  assert.deepEqual(clean(a.B.checksNodes(a.data.tasks[0], a.data).map((node) => node.textContent)), clean(nodes.map((node) => node.textContent)), "drawing it twice says the same");
  const quiet = await app({ tasks: [task("t2")] });
  assert.deepEqual(clean(quiet.B.checksNodes(quiet.data.tasks[0], quiet.data).map((node) => node.textContent)), ["No completion checks recorded"]);
  assert.deepEqual(clean(quiet.B.acceptanceOf({ acceptance: "one\ntwo\r\nthree" })), ["one", "two", "three"], "a saved string is split into lines");
  assert.deepEqual(clean(quiet.B.acceptanceOf(null)), []);
});

// ---- a task's runs, and being told when anything moved ------------------------------------------------------------------

test("a host that refuses a note or a follow-up without saying why gets our words, and a task with no title is still named", async () => {
  const api = bridge();
  api.tasksSave = async () => ({ ok: false });
  api.tasksCreate = async () => ({ ok: false });
  const a = await app({ tasks: [task("t1", { title: "", prompt: "" }), task("t2", { title: "", prompt: "Fix the thing" })], api });
  const [bare, worded] = a.data.tasks;
  assert.equal(await a.B.sendWords(bare, "note", "Hello", { data: a.data }), false);
  assert.deepEqual(clean(a.calls.toasts.at(-1)), ["The note could not be saved.", "bad"]);
  assert.equal(await a.B.sendWords(bare, "change", "Do more", { data: a.data }), false);
  assert.deepEqual(clean(a.calls.toasts.at(-1)), ["The follow-up could not be created.", "bad"]);
  assert.equal(await a.B.sendWords(bare, "ask", "And this?", { data: a.data }), true);
  assert.equal(a.api.calls.find((call) => call[0] === "assistantMessage")[1], 'About the task "this task" (t1): And this?', "no title and no words: still a name to ask about");
  api.tasksCreate = async (payload) => { a.api.calls.push(["tasksCreate", payload]); return { ok: true }; };
  await a.B.sendWords(bare, "change", "Do more", { data: a.data });
  assert.match(a.api.calls.find((call) => call[0] === "tasksCreate")[1].prompt, /^Follow-up to task "the last result" \(t1\)\./);
  await a.B.sendWords(worded, "ask", "What now?", { data: a.data });
  assert.equal(a.api.calls.filter((call) => call[0] === "assistantMessage").at(-1)[1], 'About the task "Fix the thing" (t2): What now?', "the short title the board uses stands in for a missing one");
});

test("a task's runs are read once per change, kept with the task, and the timeline lists them with its notes in the order they happened", async () => {
  const attempts = [{ runId: "r1", outcome: "failed", startedAt: at(2, 11), seconds: 95, via: "claude cli", error: "Tests failed", tail: ["npm test"] }, { runId: "r2", outcome: "finished-ok", startedAt: at(2, 14), seconds: 3700, via: "opencode", result: "Done." }];
  const api = bridge({ attempts });
  const row = task("t1", { title: "Add a sitemap", status: "done", createdAt: at(3), doneAt: at(1), logs: [{ at: at(3, 13), kind: "note", text: "Prefer the static generator" }], verification: { state: "verified", at: at(1, 9), reason: "21 tests passed" } });
  const messages = [{ kind: "notice", taskId: "t1", text: "Picked up by a worker", at: at(2, 10) }, { kind: "notice", taskId: "t2", text: "Another task's notice", at: at(2, 10) }];
  const a = await app({ tasks: [row], api, messages });
  assert.equal(a.B.attempts("t1"), null, "nothing is read until somebody asks");
  a.B.loadAttempts(a.data.tasks[0]);
  a.B.loadAttempts(a.data.tasks[0]);
  await a.settle();
  assert.equal(api.calls.filter((call) => call[0] === "tasksAttempts").length, 1, "the same task in the same state is read once");
  assert.equal(a.B.attempts("t1").attempts.length, 2);
  assert.deepEqual(clean(a.B.timeline(a.data.tasks[0], a.data).map((item) => item.kind)), ["brief", "note", "notice", "run", "run", "verdict"], "the clock decides the order, and only this task's notices are in it");
  assert.equal(a.B.timeline(a.data.tasks[0], a.data).find((item) => item.kind === "notice").text, "Picked up by a worker");
  // A question asked here is kept for the feed, and a project change forgets it with the runs.
  await a.B.sendWords(a.data.tasks[0], "ask", "What is left?", { data: a.data });
  assert.equal(a.B.asks("t1").length, 1);
  a.B.resetProject();
  assert.equal(a.B.attempts("t1"), null, "a project change forgets them");
  assert.deepEqual(clean(a.B.asks("t1")), [], "and the questions asked");
});

test("a task whose state moved is read again without the runs it had being forgotten meanwhile, and a read that fails says why", async () => {
  const api = bridge({ attempts: [{ runId: "r1", outcome: "finished-ok", startedAt: at(2, 11), seconds: 95, via: "opencode", result: "Done." }] });
  const row = task("t1", { status: "active", runId: "r1" });
  const a = await app({ tasks: [row], api });
  a.B.loadAttempts(a.data.tasks[0]);
  await a.settle();
  assert.equal(a.B.attempts("t1").attempts.length, 1);
  const moved = { ...row, status: "done", runId: null, lastAttempt: { at: at(1), runId: "r1" } };
  a.B.loadAttempts(moved);
  assert.equal(a.B.attempts("t1").loading, true, "a new read is under way");
  assert.equal(a.B.attempts("t1").attempts.length, 1, "and what was known stays on screen until it lands");
  await a.settle();
  // A host that refuses, with or without words, and one that throws.
  for (const [answer, words] of [[async () => ({ ok: false, error: "The ledger is locked." }), "The ledger is locked."], [async () => ({ ok: false }), "The run history could not be loaded."], [async () => { throw new Error("no window"); }, "no window"]]) {
    const failing = await app({ tasks: [task("t1")], api: Object.assign(bridge(), { tasksAttempts: answer }) });
    failing.B.loadAttempts(failing.data.tasks[0]);
    await failing.settle();
    assert.equal(failing.B.attempts("t1").error, words);
    assert.equal(failing.B.attempts("t1").loading, false);
  }
});

test("subscribe is told once per frame when the kit's own state moved, stops when asked, and one listener never stops another", async () => {
  const a = await app({ tasks: [task("t1")] });
  const heard = [];
  const off = a.B.subscribe(() => heard.push("one"));
  a.B.subscribe(() => { throw new Error("a listener that breaks"); });
  a.B.subscribe(() => heard.push("three"));
  a.B.setPinned("t1", true);
  a.B.setPinned("t1", false);
  assert.deepEqual(clean(heard), [], "nothing is told before the frame");
  await a.settle();
  assert.deepEqual(clean(heard), ["one", "three"], "told once for the two changes, and the broken listener did not stop the third");
  off();
  a.B.setPinned("t1", true);
  await a.settle();
  assert.deepEqual(clean(heard), ["one", "three", "three"], "a listener that left is not told");
  assert.equal(typeof a.B.subscribe(null), "function", "a listener that is not a function is ignored, and leaving still works");
  assert.deepEqual(clean([...a.B.pins()]), ["t1"], "pins are the ones the sessions layout keeps too");
});

// ---- the chips' host calls -----------------------------------------------------------------------------------------------

test("the chips' host calls are the kit's: where the folder is, the worker and its tier, and the Worktree choice", async () => {
  const api = bridge();
  const a = await app({ tasks: [task("t1")], api });
  const chips = a.B.chips;
  assert.equal(chips.CLI_NAMES.claude, "Claude Code");
  assert.deepEqual(clean(chips.TIERS.map(([id]) => id)), ["auto", "free", "fast", "heavy"]);
  assert.equal(chips.shortModel("opencode-go/glm-5.1"), "glm-5.1");
  chips.loadWhere(a.data);
  chips.loadRouting(true);
  await a.settle();
  assert.equal(chips.state.where.branch, "main");
  assert.equal(chips.state.routing.executorCli, "opencode");
  assert.deepEqual(clean(chips.state.clis.map((row) => row.id)), ["opencode"]);
  await chips.setWorktrees(true);
  assert.deepEqual(clean(api.calls.find((call) => call[0] === "workWorktrees")), ["workWorktrees", true]);
  assert.deepEqual(clean(a.calls.toasts.at(-1)), ["Each run now gets its own worktree.", "good"]);
  assert.equal(chips.state.where.worktrees.on, true, "the chip follows the answer");
  await chips.saveRouting({ executorCli: "claude" }, "Claude Code builds your tasks now.");
  assert.deepEqual(clean(api.calls.find((call) => call[0] === "setAiRouting")), ["setAiRouting", { executorCli: "claude" }]);
  assert.match(a.calls.toasts.at(-1)[0], /Claude Code builds your tasks now\. This project's team keeps it\./);
  a.B.resetProject();
  assert.equal(chips.state.where, null, "a project change forgets where the last one's folder was");
});

test("tasks.js hands the words of its Usage & limit fold to the inspector's Agent tab, so the two say a time, a token count and a cost the same way", () => {
  const source = readFileSync(new URL("../renderer/tasks.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const exported = /\n    usage: \{ ([^}]*) \},/.exec(source);
  assert.ok(exported, "the object window.MefiTasks is assigned carries them");
  assert.deepEqual(exported[1].split(", "), ["durationText", "usageTokens", "usageCost", "countText"]);
  const words = source.slice(source.indexOf("  const durationText = "), source.indexOf("  function requestTaskUsage("));
  for (const name of ["durationText", "usageTokens", "usageCost", "countText"]) assert.match(words, new RegExp(`const ${name} = `), `${name} is one of the fold's own`);
});

test("the classic sessions layout's Checks pane still says what a task must pass and how its last check run went, from the same nodes the inspector draws", async () => {
  const row = task("t1", { acceptance: ["The list says No notes yet"], verificationRun: { state: "failed", results: [{ name: "unit tests", ok: true }, { name: "first paint", ok: false, detail: "2.4 s" }] }, verification: { state: "failed", reason: "The budget failed." } });
  const a = await app({ tasks: [row], search: "?home=sessions", panes: true });
  assert.equal(a.B.layout(), "sessions");
  await a.settle();
  a.window.MefiPanes.open("checks");
  a.B.openTask("t1");
  await a.settle(); await a.settle();
  const box = a.env.document.getElementById("builder-checks");
  assert.ok(box, "the pane is on the page");
  assert.match(box.textContent, /The list says No notes yet/);
  assert.match(box.textContent, /Passed/); assert.match(box.textContent, /unit tests/); assert.match(box.textContent, /Failed/); assert.match(box.textContent, /first paint/); assert.match(box.textContent, /2\.4 s/);
  assert.match(box.textContent, /Not accepted: The budget failed\./);
  const nodes = a.B.checksNodes(row, a.data);
  assert.equal(box.children.length, nodes.length, "the pane is exactly what the kit gives");
  const none = await app({ tasks: [row], search: "?home=sessions", panes: true });
  await none.settle();
  none.window.MefiPanes.open("checks");
  await none.settle(); await none.settle();
  assert.equal(none.env.document.getElementById("builder-checks").textContent, "Open a task to see what it must pass.", "with no task open it says what it is for");
});

test("the classic sessions layout's Request a change turns its box to a Change", async () => {
  const a = await app({ tasks: [task("t1", { status: "done", doneAt: at(1) })], search: "?home=sessions", panes: true });
  await a.settle();
  a.B.openTask("t1");
  await a.settle(); await a.settle();
  const change = a.env.document.querySelectorAll("button").find((node) => node.textContent === "Request a change");
  assert.ok(change, "a finished task offers it");
  await change.click(); await a.settle();
  assert.equal(a.env.document.getElementById("builder-intent-change").getAttribute("aria-pressed"), "true");
  assert.equal(a.env.document.getElementById("builder-intent-note").getAttribute("aria-pressed"), "false");
});
