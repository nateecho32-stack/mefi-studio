// The host's creation paths run through the one admission ladder
// (scripts/work-admission.cjs): real main.cjs sections in vm sandboxes, with
// the real pure modules and memory-only boards. Each test here failed on the
// snapshot the ladder replaced.
//
// Run: node --test tests/work_admission_host.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import workAdmission from "../scripts/work-admission.cjs";
import boardGrowth from "../scripts/board-growth.cjs";
import agentIssues from "../scripts/agent-issues.cjs";
import brains from "../scripts/brains.cjs";
import * as assistant from "../scripts/assistant.mjs";
import * as eyesModule from "../scripts/eyes.mjs";
import * as history from "../scripts/task-history.mjs";
import { applyRequestAction } from "../scripts/idea-actions.cjs";
import { BAND, baselineCompareWork, baselineTaskPriority, baselineWorkPriority } from "../scripts/policy.mjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const HOUR = 3600 * 1000;

// A board gateway over one in-memory board: the mutator edits it in place and
// any collection it returns replaces the saved one.
function gateway(board) {
  return async (mutate) => {
    const patch = mutate(board, {}) ?? {};
    for (const key of ["tasks", "requests", "ideas"]) if (Array.isArray(patch[key])) board[key] = patch[key];
    return { ...patch, ...board };
  };
}

function intake(board) {
  const jev = [];
  const env = vm.createContext({
    Date, boardGrowth, workAdmission, projects: { stamp: (row) => row }, workTitleKey: assistant.compactKey,
    mutateBoard: gateway(board), jevShadowIntake: (rows) => { if (rows?.length) jev.push(...rows); },
  });
  vm.runInContext(section("async function queueRequests(", "// Jev classifies admitted observations"), env);
  vm.runInContext(section("// The pinned-request half of Work on it", "// A tree click hands the assistant"), env);
  return { env, jev };
}

// ---- filers see the board (a promoted request is not filed again) ---------------

test("the filers' baseline holds every card not archived, so a promoted collision is not filed again", async () => {
  const collision = { file: "C:/p/a.lua", files: ["C:/p/a.lua"], owner: "ses_a", sessions: [{ sessionId: "ses_a", edits: 3 }, { sessionId: "ses_b", edits: 1 }] };
  const [filed] = eyesModule.requestsFromCollisions([collision], []);
  assert.ok(filed, "fixture: the collision files a request on an empty baseline");
  // Promoted to a card, its inbox copy absorbed by compaction.
  const card = { ...filed, id: "task_c", status: "open" };
  const store = { requests: [], history: [], tasks: [card, { id: "task_d", title: "Old", status: "done", source: "collision", files: ["C:/p/b.lua"] },
    { id: "task_e", title: "Older", status: "archived", source: "collision", files: ["C:/p/c.lua"] }] };
  const env = vm.createContext({ Date, workAdmission, REQUESTS_PATH: "requests", ASSISTANT_HISTORY_PATH: "history", TASKS_PATH: "tasks" });
  vm.runInContext(section("async function requestBaseline(eyes)", "// briefing.expand[] items become real queue entries here"), env);
  const eyes = { readJson: async (key) => structuredClone(store[key] ?? []) };
  const known = await env.requestBaseline(eyes);
  assert.deepEqual(eyesModule.requestsFromCollisions([collision], known), [], "the live card stands for the collision");
  // Deliberately changed: a done card stands too until it is archived, the
  // rule promotion and compaction apply (it used to be left out, so the
  // finding was re-filed every pass for promotion to refuse).
  assert.ok(known.some((row) => row.id === "task_d"), "a done card does");
  assert.ok(!known.some((row) => row.id === "task_e"), "an archived card does not");
});

test("queueRequests checks board cards too, and a represented row never reaches Jev", async () => {
  const request = { title: "Audit: 3 errors in renderer/tasks.js", prompt: "Fix the audit errors: undefined name in renderer/tasks.js", source: "audit", at: 1 };
  const board = { tasks: [{ ...request, id: "task_a", status: "open" }], requests: [] };
  const { env, jev } = intake(board);
  assert.equal(await env.queueRequests([{ ...request, at: 2 }]), 0);
  assert.deepEqual(board.requests, []);
  assert.deepEqual(jev, [], "no paid classification for work already on the board");
  // Deliberately changed: a done card still stands for its finding until it
  // is archived (promotion would refuse the re-file and compaction absorb it).
  board.tasks[0].status = "done";
  assert.equal(await env.queueRequests([{ ...request, at: 3 }]), 0);
  assert.deepEqual(jev, []);
  // Archived, the finding filed again is new work.
  board.tasks[0].status = "archived";
  assert.equal(await env.queueRequests([{ ...request, at: 4 }]), 1);
  assert.equal(jev.length, 1);
});

// ---- Work on it ------------------------------------------------------------------

test("Work on it admits by target: two todos with one label in two sessions are two requests", async () => {
  const board = { tasks: [], requests: [] };
  const { env } = intake(board);
  assert.match(await env.assistantQueuePinnedWork({ kind: "todo", id: "ses_a:t1", label: "Run tests", now: 1 }), /^queued "Run tests"/);
  assert.match(await env.assistantQueuePinnedWork({ kind: "todo", id: "ses_b:t1", label: "Run tests", now: 2 }), /^queued "Run tests"/);
  assert.deepEqual(plain(board.requests.map((row) => row.target.id)).sort(), ["ses_a:t1", "ses_b:t1"]);
  // The same node again re-pins its standing request.
  assert.match(await env.assistantQueuePinnedWork({ kind: "todo", id: "ses_a:t1", label: "Run tests", now: 3 }), /^kept "Run tests" at the front of the inbox/);
  assert.equal(board.requests.length, 2);
  assert.equal(board.requests.find((row) => row.target.id === "ses_a:t1").pinAt, 3);
});

test("a long Work on it label is clipped inside the quotes, so the title still keys to the label", async () => {
  const board = { tasks: [], requests: [] };
  const { env } = intake(board);
  const label = "Post-commit quiet-tree gate rerun after the landing of the shared bytes";
  await env.assistantQueuePinnedWork({ kind: "session", id: "ses_l", label, now: 1 });
  const [row] = board.requests;
  assert.ok(row.title.length <= 60);
  assert.match(row.title, /…"$/, "the closing quote survives");
  assert.equal(assistant.compactKey(row.title), assistant.compactKey(label.slice(0, 49)), "the title alone unwraps");
  assert.equal(workAdmission.titleKey(row.title, row.prompt), workAdmission.titleKey(label), "with its prompt it is the whole label");
  assert.ok(row.prompt.includes(`"${label}"`));
});

test("Work on it never pins a row the verifier holds, and says what that row is doing", async () => {
  const verifying = { title: 'Work on "Map the tabs"', prompt: 'Work on "Map the tabs". Queued with Work on it — the user pointed at session (id: ses_v).',
    source: "chat", at: 1, target: { kind: "session", id: "ses_v" }, status: "verifying" };
  const board = { tasks: [], requests: [structuredClone(verifying)] };
  const { env } = intake(board);
  const where = await env.assistantQueuePinnedWork({ kind: "session", id: "ses_v", label: "Map the tabs", now: 5 });
  assert.match(where, /awaiting verification/);
  assert.equal(board.requests.length, 1);
  assert.equal(board.requests[0].pin, undefined, "no Next ring on work nothing will run");
});

test("a stale-session rescue and Work on it on that session are one piece of work", async () => {
  const now = 7 * 24 * HOUR;
  const sessions = [{ id: "ses_q", title: "Map the tabs", timeUpdated: 0 }];
  const todos = [{ sessionId: "ses_q", status: "in_progress", content: "wire the tab store" }];
  const [rescue] = assistant.staleRescues({ sessions, todos, now });
  assert.ok(rescue, "fixture: the quiet session is rescued");
  assert.deepEqual(plain(rescue.request.target ?? null), { kind: "session", id: "ses_q" }, "a rescue carries its session as its target");
  const board = { tasks: [], requests: [] };
  const { env } = intake(board);
  assert.equal(await env.queueRequests([{ ...rescue.request, source: "overseer" }]), 1);
  assert.match(await env.assistantQueuePinnedWork({ kind: "session", id: "ses_q", label: "Map the tabs", now }), /^kept "Map the tabs"/);
  assert.equal(board.requests.length, 1, "the button pins the rescue instead of filing a second card");
  assert.equal(board.requests[0].pin, true);
  // And the rescue pass leaves a session Work on it already queued alone.
  const workOn = { title: 'Work on "Map the tabs"', prompt: 'Work on "Map the tabs". Queued with Work on it — the user pointed at session (id: ses_q).', source: "chat", target: { kind: "session", id: "ses_q" } };
  assert.deepEqual(assistant.staleRescues({ sessions, todos, existing: [workOn], now }), []);
});

// ---- a split answer ------------------------------------------------------------------

function splitHost({ tasks = [{ id: "task_1", title: "Add the retry banner", status: "open", logs: [] }], ids = null } = {}) {
  const state = assistant.emptyState(1000);
  const board = { tasks: structuredClone(tasks), requests: [] };
  const jev = [];
  const env = vm.createContext({
    console, Date, assistantState: state, agentIssues, workAdmission, workTitleKey: assistant.compactKey,
    crypto: ids ? { randomBytes: () => ({ toString: () => ids.shift() }) } : crypto,
    projects: { current: () => ({ id: "fixture" }) }, projectRoot: () => "/fixture", autopilot: { jobs: [] },
    assistantCaps: () => assistant.CAPS,
    assistantTrim(list, cap) { if (list.length > cap) list.splice(0, list.length - cap); },
    assistantClip: (value, max) => String(value ?? "").slice(0, max),
    assistantLog() {}, assistantEmit() {}, saveAssistant: async () => {}, ensureAssistant: async () => state, logError() {},
    activeIssuePolicy: async () => brains.issuePolicyFor(brains.defaultMap()),
    mutateBoard: gateway(board), backlogControl: async () => ({ ok: true }), rememberWorkShape() {}, assistantAskForWork() {},
    assistantAppendReply: () => null, assistantMessage: async () => ({ ok: true }), assistantWorkOn: async () => ({ ok: true }),
    getAssistant: async () => ({ pendingOffers: () => [] }), assistantModule: assistant, EXECUTOR_START_FAILURE_GRACE: 5,
    jevShadowIntake: (rows) => jev.push(...rows), refreshAutopilotQueue: async () => {}, assistantNodeContext() {},
  });
  vm.runInContext([
    section("// ---- agent issues", "async function assistantSetPrefs("),
    section("async function assistantCreateTask(", "function executorProcessAlive("),
  ].join("\n"), env);
  const split = (note) => env.assistantIssueAction({ action: "split", payload: { taskId: "task_1", issueKind: "scope", ask: "more than the brief" } }, note);
  return { env, board, jev, split, parent: () => board.tasks.find((task) => task.id === "task_1"), followUps: () => board.tasks.filter((task) => task.splitFrom === "task_1") };
}

test("a second split of one card with another note is new work, and the same note again is the card already filed", async () => {
  const h = splitHost();
  assert.equal((await h.split("the store belongs in its own task")).ok, true);
  const second = await h.split("the reader belongs in its own task too");
  assert.equal(second.ok, true, second.error);
  assert.deepEqual(h.followUps().map((task) => task.prompt).sort(), ["the reader belongs in its own task too", "the store belongs in its own task"]);
  assert.equal((await h.split("the store belongs in its own task")).ok, true);
  assert.equal(h.followUps().length, 2, "the same answer again files nothing new");
  assert.equal(h.parent().decisions.length, 3, "every answer is recorded");
  assert.equal(h.jev.length, 2, "each new follow-up is classified once");
  assert.deepEqual(plain(h.followUps()[0].origin), { kind: "split", by: "owner" });
});

test("a follow-up that cannot be created leaves the card without the split decision", async () => {
  // The id allocator hands out the parent's own id, so the admission refuses.
  const h = splitHost({ ids: ["1", "1"] });
  const result = await h.split("the store belongs in its own task");
  assert.equal(result.ok, false);
  assert.match(result.error, /follow-up task could not be created/);
  assert.equal(h.board.tasks.length, 1);
  assert.equal(h.parent().decisions, undefined, "nothing is recorded for a split that made no card");
  assert.equal(h.parent().logs.length, 0);
});

// ---- promotion keeps who filed the work -------------------------------------------------

test("promotion keeps the request's source and origin, so its band is the one it had in the inbox", async () => {
  const requests = [
    { title: "Fix: flaky scheduler test", prompt: "Find the root cause of the flaky scheduler test", source: "fix", at: 1 },
    { title: "Audit: 2 errors in renderer/tasks.js", prompt: "Fix the audit errors in renderer/tasks.js", source: "audit", at: 2 },
    { title: 'Work on "Map the tabs"', prompt: 'Work on "Map the tabs". Queued with Work on it — the user pointed at session (id: ses_q).', source: "chat", at: 3, pin: true, pinAt: 3,
      target: { kind: "session", id: "ses_q" }, origin: { kind: "work-on", by: "owner" } },
  ];
  const board = { tasks: [], requests: structuredClone(requests) };
  let serial = 0;
  const env = vm.createContext({
    Date, workAdmission, crypto: { randomBytes: () => ({ toString: () => String(++serial) }), createHash: crypto.createHash },
    projects: { current: () => ({ id: "fixture" }) }, projectRoot: () => "/fixture", workTitleKey: assistant.compactKey,
    compareWork: baselineCompareWork, workPlanTheme: () => null, workFixTheme: () => null, isFixWork: () => false, mutateBoard: gateway(board),
  });
  vm.runInContext(section("async function promoteRequestsToTasks()", "// Chat work lands straight on the task board."), env);
  assert.equal(await env.promoteRequestsToTasks(), 3);
  for (const request of requests) {
    const card = board.tasks.find((task) => task.title === request.title);
    assert.equal(card.source, request.source, `${request.title} keeps its source`);
    assert.equal(baselineWorkPriority(card), baselineWorkPriority(request), `${request.title} keeps its band`);
  }
  assert.deepEqual(plain(board.tasks.find((task) => task.source === "fix").origin), { kind: "request", by: "fix" });
  assert.deepEqual(plain(board.tasks.find((task) => task.source === "chat").origin), { kind: "work-on", by: "owner" });
});

// ---- the gateway bypasses ----------------------------------------------------------------

test("a view's idea list merges by id inside the gateway and cannot revert a promotion", async () => {
  const board = { tasks: [], requests: [], ideas: [
    { id: "i1", title: "Promoted", status: "planned", taskId: "task_x", read: true },
    { id: "i2", title: "Unread", status: "new", read: false },
    { id: "i3", title: "Arrived after the view loaded", status: "new" },
  ] };
  let handler = null, written = null;
  const env = vm.createContext({
    Date, IDEAS_PATH: "ideas", projects: { current: () => ({ id: "fixture" }) },
    ipcMain: { handle: (_name, callback) => { handler = callback; } }, mutateBoard: gateway(board),
    withBoardLock: async (fn) => fn(), getEyes: async () => ({ writeJson: async (_key, rows) => { written = rows; board.ideas = rows; } }), send() {},
  });
  vm.runInContext(section('  ipcMain.handle("ideas:save",', '  ipcMain.handle("ideas:scan",'), env);
  // The view loaded before i1 was promoted and before i3 arrived.
  const stale = [{ id: "i1", title: "Promoted", status: "new", read: true }, { id: "i2", title: "Unread", status: "keep", read: true }, { id: "gone", title: "Deleted since", status: "new" }];
  assert.equal((await handler(null, stale)).ok, true);
  assert.equal(written, null, "no whole-array write");
  const byId = new Map(board.ideas.map((idea) => [idea.id, idea]));
  assert.equal(byId.get("i1").taskId, "task_x");
  assert.equal(byId.get("i1").status, "planned");
  assert.equal(byId.get("i2").status, "keep");
  assert.equal(byId.get("i2").read, true);
  assert.ok(byId.has("i3"), "a row the view never listed stays");
  assert.ok(!byId.has("gone"), "a deleted row is not revived");
});

// ---- the inbox review: promotion, intake and the composer agree -------------------------

// The real promotion section over one in-memory board. `themes` loads the
// host's real plan and fix theme helpers (with the real assistant module and
// the real eyes module as the gateway's eyes); otherwise they are stubbed off.
function promotion(board, { themes = false } = {}) {
  let serial = 0;
  const env = vm.createContext({
    Date, workAdmission, crypto: { randomBytes: () => ({ toString: () => `p${++serial}` }), createHash: crypto.createHash },
    projects: { current: () => ({ id: "fixture" }) }, projectRoot: () => "/fixture", workTitleKey: assistant.compactKey,
    compareWork: baselineCompareWork, assistantModule: assistant,
    mutateBoard: async (mutate) => {
      const patch = mutate(board, eyesModule) ?? {};
      for (const key of ["tasks", "requests", "ideas"]) if (Array.isArray(patch[key])) board[key] = patch[key];
      return { ...patch, ...board };
    },
  });
  if (themes) vm.runInContext(section("function workPlanTheme(", "function liveFixShape("), env);
  else Object.assign(env, { workPlanTheme: () => null, workFixTheme: () => null, isFixWork: () => false });
  vm.runInContext(section("async function promoteRequestsToTasks()", "// Chat work lands straight on the task board."), env);
  return env;
}

// The composer's IPC handler (tasks:create) over the real assistantCreateTask.
function composer(board) {
  let serial = 0, handler = null;
  const jev = [], asked = [];
  const env = vm.createContext({
    Date, workAdmission, crypto: { randomBytes: () => ({ toString: () => `c${++serial}` }) },
    autopilot: { jobs: [] }, projects: { current: () => ({ id: "fixture" }) }, projectRoot: () => "/fixture",
    ipcMain: { handle: (name, callback) => { if (name === "tasks:create") handler = callback; } },
    ensureAssistant: async () => {}, TASKS_PATH: "tasks", getEyes: async () => ({ readJson: async (key) => structuredClone(board[key] ?? []) }),
    assistantAskForWork: (reason) => asked.push(reason), taskView: (task) => task, mutateBoard: gateway(board),
    jevShadowIntake: (rows) => jev.push(...rows), refreshAutopilotQueue: async () => {}, assistantNodeContext() {}, assistantLog() {}, logError() {},
  });
  vm.runInContext([
    section("async function assistantCreateTask(", "function executorProcessAlive("),
    section('  ipcMain.handle("tasks:create",', "  // The committed catalog is available immediately"),
  ].join("\n"), env);
  return { create: (title, prompt = title) => handler(null, { title, prompt }), jev, asked };
}

test("a Fix: request is compared by fix theme against fix work only, as compaction compares it", async () => {
  const [fix] = eyesModule.requestsFromBriefing({ alerts: [{ severity: "warn", title: "stale lock file blocks the updater", detail: "The updater waits on a stale lock.", sessionIds: ["ses_u"] }] });
  assert.ok(fix, "fixture: the briefing files the fix");
  const chat = { id: "chat", title: "Dim stale sessions in the rail", prompt: "Dim stale sessions in the rail", source: "chat", status: "done", doneAt: 1 };
  const sweep = { id: "sweep", title: "Sweep stale lock files on start", prompt: "Sweep stale lock files on start", source: "chat", status: "open" };
  assert.ok(eyesModule.sameFixProblem(fix, chat), "fixture: the loose themes meet");
  assert.equal(assistant.fixThemeKey(fix), assistant.fixThemeKey(sweep), "fixture: so do the scoped ones");
  const board = { requests: [structuredClone(fix)], tasks: [chat, sweep] };
  // Nothing else runs an inbox request, so a refusal here was never running.
  assert.equal(await promotion(board, { themes: true }).promoteRequestsToTasks(), 1);
  assert.equal(board.tasks[0].title, fix.title);
  // A fix ticket on the same problem still stands for it.
  const ticket = { id: "ticket", title: "Fix: stale session lock lingers", prompt: "A-Eyes warn alert: stale session lock lingers. Find the root cause, fix it.", source: "fix",
    alertTitle: "stale session lock lingers", problemFamily: "stale", status: "open" };
  assert.equal(await promotion({ requests: [structuredClone(fix)], tasks: [ticket] }, { themes: true }).promoteRequestsToTasks(), 0);
});

test("an ask typed into the Explorer inbox becomes a card, and so does a title-less row an older build saved", async () => {
  const board = { tasks: [], requests: [] };
  board.requests = applyRequestAction([], { action: "add", requests: [{ prompt: "Make the save button bigger", source: "manual" }] }, 1000).requests;
  board.requests.push({ prompt: "Keep the swamp torches lit\nThey go dark after a reload", at: 1001, source: "manual" });
  const promote = promotion(board);
  assert.equal(await promote.promoteRequestsToTasks(), 2);
  assert.deepEqual(plain(board.tasks.map((task) => task.title)).sort(), ["Keep the swamp torches lit", "Make the save button bigger"]);
  assert.equal(board.tasks.find((task) => task.title === "Keep the swamp torches lit").prompt, "Keep the swamp torches lit\nThey go dark after a reload", "the brief keeps every word");
  assert.equal(await promote.promoteRequestsToTasks(), 0, "each is promoted once");
  // Compaction drops both promoted copies, the legacy one included (its
  // title key is its whole brief, which its card's title no longer matches).
  assert.deepEqual(assistant.compact({ requests: board.requests, tasks: board.tasks, now: 2000 }).requests, []);
});

test("a finding filed again against its done card is not admitted, refused and absorbed on every pass; archived, it is new work", async () => {
  const finding = { title: "Audit: 3 errors in renderer/tasks.js", prompt: "Fix the audit errors: undefined name in renderer/tasks.js", source: "audit" };
  const board = { tasks: [{ ...finding, id: "task_k", status: "done", at: 1 }], requests: [] };
  const { env, jev } = intake(board);
  const promote = promotion(board);
  for (let pass = 0; pass < 3; pass += 1) {
    assert.equal(await env.queueRequests([{ ...finding, at: 10 + pass }]), 0, `pass ${pass}: the done card stands for it`);
    assert.equal(await promote.promoteRequestsToTasks(), 0);
    board.requests = assistant.compact({ requests: board.requests, tasks: board.tasks, now: 100 }).requests;
  }
  assert.deepEqual(jev, [], "no classification is paid for a finding its card already covers");
  assert.deepEqual(board.requests, []);
  board.tasks[0].status = "archived";
  assert.equal(await env.queueRequests([{ ...finding, at: 20 }]), 1);
  assert.equal(await promote.promoteRequestsToTasks(), 1, "and promotion agrees with intake");
});

test("the composer's ask that matches an inbox request makes that request its card now, pinned as the owner's", async () => {
  const grow = { title: "Add a dark mode toggle", prompt: "Add a dark mode toggle", source: "grow", at: 1 };
  // A done card of that title: promotion would refuse the request and compaction absorb it.
  const done = { id: "task_done", title: "Add a dark mode toggle", prompt: "An older brief for the toggle", status: "done" };
  const board = { tasks: [structuredClone(done)], requests: [structuredClone(grow)] };
  const h = composer(board);
  const added = await h.create("Add a dark mode toggle");
  assert.equal(added.ok, true, added.error);
  const card = board.tasks.find((task) => task.id !== "task_done");
  assert.ok(card, "the request is on the board");
  assert.equal(card.pin, true, "with the owner's pin");
  assert.deepEqual(plain(card.origin), { kind: "composer", by: "owner" });
  assert.equal(baselineTaskPriority(card), BAND.CHAT, "in the owner band, not the grower's");
  assert.equal(card.source, "grow", "it is still the grower's request");
  assert.equal(board.requests[0].promotedTo, card.id, "the inbox copy is its card's now");
  assert.deepEqual(h.jev, [], "the request was classified when it was filed");
  assert.deepEqual(h.asked, ["you added a task"]);
  const again = await h.create("Add a dark mode toggle");
  assert.equal(again.ok, false);
  assert.match(again.error, /"Add a dark mode toggle" is already on the board/);
  // A row an older build's run still holds is reported where it is.
  const held = composer({ tasks: [], requests: [{ ...grow, status: "running", runId: "run_old", lease: { pid: 7, at: 1 } }] });
  const refused = await held.create("Add a dark mode toggle");
  assert.equal(refused.ok, false);
  assert.match(refused.error, /is already queued in the request inbox/);
});

test("a Work on it request is promoted once: closing its card does not bring it back, and a new click is new work", async () => {
  const board = { tasks: [], requests: [] };
  const { env } = intake(board);
  const promote = promotion(board);
  await env.assistantQueuePinnedWork({ kind: "todo", id: "ses_a:t1", label: "Run tests", now: 1 });
  assert.equal(await promote.promoteRequestsToTasks(), 1);
  assert.equal(await promote.promoteRequestsToTasks(), 0);
  board.tasks[0].status = "done";
  assert.equal(await promote.promoteRequestsToTasks(), 0, "the inbox copy is its card's, not a second pinned card");
  assert.equal(board.tasks.length, 1);
  // The owner clicking Work on it again after the card closed is a new ask.
  assert.match(await env.assistantQueuePinnedWork({ kind: "todo", id: "ses_a:t1", label: "Run tests", now: 5 }), /^queued "Run tests"/);
  assert.equal(await promote.promoteRequestsToTasks(), 1);
  assert.deepEqual(plain(board.tasks.map((task) => task.status)).sort(), ["done", "open"]);
  // The stale-session rescue carries the same target identity.
  const rescueBoard = { tasks: [], requests: [] };
  const [rescue] = assistant.staleRescues({ sessions: [{ id: "ses_q", title: "Map the tabs", timeUpdated: 0 }], todos: [{ sessionId: "ses_q", status: "in_progress", content: "wire the tab store" }], now: 7 * 24 * HOUR });
  assert.equal(await intake(rescueBoard).env.queueRequests([{ ...rescue.request, source: "overseer" }]), 1);
  const rescuePromote = promotion(rescueBoard);
  assert.equal(await rescuePromote.promoteRequestsToTasks(), 1);
  rescueBoard.tasks[0].status = "done";
  assert.equal(await rescuePromote.promoteRequestsToTasks(), 0);
  // Compaction drops the promoted copies.
  assert.deepEqual(assistant.compact({ requests: board.requests, tasks: board.tasks, now: 10 }).requests, []);
});

test("the owner's inbox asks rank in the owner band on the board, above auto-filed work", async () => {
  const board = { tasks: [], requests: [] };
  board.requests = applyRequestAction([], { action: "add", requests: [
    { prompt: "Make the save button bigger", source: "manual" },
    { title: "Torch flicker", prompt: "Add flicker to the swamp torches", source: "expand" },
  ] }, 5).requests;
  board.requests.push({ title: "Audit: 2 errors in renderer/tasks.js", prompt: "Fix the audit errors in renderer/tasks.js", source: "audit", at: 1 },
    { title: "Keep the tar torches", prompt: "Please keep the swamp tar torches", source: "manual", at: 2 });
  const promote = promotion(board);
  assert.equal(await promote.promoteRequestsToTasks(), 3);
  assert.equal(await promote.promoteRequestsToTasks(), 1);
  const bands = Object.fromEntries(board.tasks.map((task) => [task.title, baselineTaskPriority(task)]));
  // An older build's owner row carries no origin; its source still names the owner.
  assert.deepEqual(plain(bands), { "Make the save button bigger": BAND.CHAT, "Torch flicker": BAND.CHAT, "Keep the tar torches": BAND.CHAT, "Audit: 2 errors in renderer/tasks.js": BAND.EYES });
  assert.equal([...board.tasks].sort(baselineCompareWork).at(-1).source, "audit", "the auto-filed card goes last, not the owner's");
});

test("a legacy verifying row's card and the same request promoted carry one source, origin and band", async () => {
  for (const source of ["manual", "expand", "fix", "grow", undefined]) {
    const request = { title: `Work from ${source}`, prompt: "p", at: 1, ...(source ? { source } : {}) };
    const board = { tasks: [], requests: [structuredClone(request)] };
    await promotion(board).promoteRequestsToTasks();
    const [promoted] = board.tasks;
    const [migrated] = history.migrateLegacyRequests([{ ...request, status: "verifying", lastAttempt: { runId: `run-${source}` } }], { now: 5 }).tasks;
    assert.equal(migrated.source, promoted.source, String(source));
    assert.deepEqual(plain(migrated.origin), plain(promoted.origin), String(source));
    assert.equal(baselineTaskPriority({ ...migrated, status: "open" }), baselineTaskPriority(promoted), String(source));
  }
});
