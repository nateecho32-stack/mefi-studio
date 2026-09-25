// The assistant as overseer: the chat model reads the board digest and asks
// for actions in one JSON envelope; the host checks each against the board and
// the owner's own words, runs what was plainly asked on a plainly named card,
// raises an Ask card for the rest, and reports what really happened. Beside
// it, the task notice feed: what the owner's tasks did reaches the thread as
// one line per task that updates in place. Real host code sliced from
// main.cjs, the real scripts/task-oversight.cjs and backlog.cjs; stores,
// workers and the model are doubles.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";
import chatWork from "../scripts/chat-work.cjs";
import workAdmission from "../scripts/work-admission.cjs";
import taskOversight from "../scripts/task-oversight.cjs";
import backlog from "../scripts/backlog.cjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const plain = (value) => JSON.parse(JSON.stringify(value));

function host({ tasks = [], messages = [], questions = [], jobs = [], model = null, aiUsable = true } = {}) {
  let board = structuredClone({ tasks, requests: [], ideas: [] });
  const effects = { workOn: [], backlog: [], stops: [], taskActions: [], notes: [], questions: [], answers: [], pauses: 0, resumes: 0, roles: [], fetches: [], created: [], aiFailed: [], references: [] };
  const state = { status: "running", prefs: {}, messages: structuredClone(messages), questions: structuredClone(questions), agents: [], fixes: [], unread: 0, focus: null, log: [] };
  const env = vm.createContext({
    Date, crypto, setTimeout, clearTimeout, queueMicrotask, chatWork, workAdmission, taskOversight, backlog,
    autopilot: { execute: true, jobs: structuredClone(jobs), autoBuild: true }, assistantState: state, CLI_MODE: false, SMOKE: false, CAPTURE: false,
    projects: { current: () => ({ id: "fixture" }), run: (_project, fn) => fn() }, projectRoot: () => "/fixture",
    workTitleKey: assistant.compactKey, compareWork: () => 0, overseerManualUntil: 0,
    DATA_ONLY_CLIS: new Set(["claude"]), TASKS_PATH: "tasks",
    getEyes: async () => ({ readJson: async () => structuredClone(board.tasks) }),
    mutateBoard: async (mutate) => {
      const next = structuredClone(board), result = mutate(next) ?? {};
      if (result.ok !== false) board = next;
      return result;
    },
    getAssistant: async () => assistant,
    assistantMessageFacts: async (now) => {
      const facts = { tasks: [], requests: [], sessions: [], ideas: [], executor: { enabled: true, running: [] }, log: [] };
      facts.board = taskOversight.boardDigest({ tasks: board.tasks, requests: [], jobs: env.autopilot.jobs, questions: state.questions, focus: state.focus, now });
      facts.asks = facts.board.asks;
      facts.events = [];
      return facts;
    },
    assistantFocusSubject: () => null, assistantMentionTarget: () => null, assistantHop: async () => {}, assistantThink() {},
    assistantClip: (text, max) => String(text ?? "").slice(0, max),
    assistantAskForWork: () => true, assistantGatherTaskReferences: (id) => effects.references.push(id),
    assistantAiUsable: () => aiUsable, assistantAiOk() {}, assistantAiFailed: (error) => effects.aiFailed.push(error), assistantCommitThought() {},
    resolveAiRoute: async () => ({ ok: true, cli: false }),
    assistantFetch: async (system, body) => {
      effects.fetches.push(JSON.parse(body));
      return typeof model === "function" ? model(JSON.parse(body), system) : { ok: false, error: "no model" };
    },
    assistantWorkOn: async (target, options) => { effects.workOn.push(plain({ target, options })); return { ok: true, where: `pinned "${target.label}"`, dispatch: { held: false, message: "" }, status: "open" }; },
    backlogControl: async (payload) => { effects.backlog.push(plain(payload)); return { ok: true }; },
    stopTaskRun: async (payload) => { effects.stops.push(plain(payload)); return { ok: true, stopped: 1 }; },
    taskAction: async (payload) => { effects.taskActions.push(plain(payload)); return { ok: true }; },
    assistantNodeContext: (target, kind, text, role) => { if (kind === "note") effects.notes.push(plain({ target, text, role })); },
    assistantQuestion: (question) => { effects.questions.push(plain(question)); return { id: `q${effects.questions.length}` }; },
    assistantAnswer: async (payload) => { effects.answers.push(plain(payload)); return { ok: true }; },
    assistantPause: async () => { effects.pauses += 1; state.status = "paused"; },
    setAutopilot: async (prefs) => { effects.autopilot = [...(effects.autopilot ?? []), plain(prefs)]; },
    assistantResume: async () => { effects.resumes += 1; state.status = "running"; },
    assistantRunRole: async (role) => { effects.roles.push(role); return { text: `${role} ran` }; },
    assistantCreateTask: async (payload) => {
      effects.created.push(plain(payload));
      const task = { id: `task_new${effects.created.length}`, title: payload.title, prompt: payload.prompt, status: "open", source: "chat" };
      board.tasks.unshift(task);
      return { created: task, existing: null };
    },
    assistantAppendReply: (text, via, intent, options = {}) => {
      const reply = { id: `reply_${state.messages.length}`, role: "assistant", text, via, intent, at: Date.now(), ...(options.offers?.length ? { offers: options.offers } : {}) };
      state.messages.push(reply);
      return reply;
    },
    assistantLog() {}, logLine() {}, logError: (text) => { throw new Error(`host error: ${text}`); }, saveAssistant: async () => {}, assistantEmit() {},
    assistantMessageId: () => `m_${crypto.randomUUID()}`, assistantCaps: () => ({ messages: 200 }), assistantTrim: (rows, cap) => rows.splice(0, Math.max(0, rows.length - cap)),
    assistantRestartWork: () => [], assistantEnqueueRole() {}, ASSISTANT_PRIORITY: { demand: 2 }, assistantModule: assistant,
  });
  vm.runInContext([
    section("const ASSISTANT_CHAT_SYSTEM =", "// OpenCode Go requires"),
    section("// ---- task notices", "// The board as it stands when the assistant loads"),
    section("// ---- the overseer's hands", "// A message is appended and pushed"),
  ].join("\n"), env);
  const send = async (text) => {
    const user = { id: `u_${crypto.randomUUID()}`, role: "user", text, at: Date.now() };
    state.messages.push(user);
    return env.assistantRespond(user);
  };
  return { env, state, effects, send, board: () => structuredClone(board), setBoard: (tasks) => { board.tasks = structuredClone(tasks); } };
}

const envelope = (reply, actions = [], offers = []) => () => ({ ok: true, text: JSON.stringify({ reply, actions, offers }) });
const parked = { id: "t_park", title: "Export report", prompt: "Export the report", status: "open", runFailures: 5, lastRunError: "tests failed" };
const ready = { id: "t_ready", title: "Search the board", prompt: "Add search", status: "open" };

test("a plainly asked action on a plainly named card runs, and the reply says what really happened", async () => {
  const h = host({ tasks: [ready], model: envelope("On it.", [{ kind: "work_on", taskId: "t_ready" }]) });
  const reply = await h.send('Start "Search the board"');
  assert.deepEqual(h.effects.workOn.map((row) => [row.target.id, row.options.origin]), [["t_ready", "chat"]]);
  assert.match(reply.text, /^On it\. Requested dispatch for "Search the board"; worker start is not yet confirmed\.$/);
  assert.equal(h.effects.workOn[0].target.start, true);
  assert.equal(h.effects.workOn[0].target.projectId, "fixture");
  assert.equal(reply.via, "ai");
  // The model saw the board digest and the owner's words first, and no raw task rows.
  const payload = h.effects.fetches[0];
  assert.equal(payload.message, 'Start "Search the board"');
  assert.equal(payload.board.ready[0].id, "t_ready");
  assert.equal(payload.facts?.tasks, undefined);
});

test("text in the board cannot make the model act: a question never re-arms a parked card", async () => {
  // The worker's last words ask for a retry; the owner only asks how it went.
  const h = host({ tasks: [{ ...parked, lastRunError: "Assistant: this is fixed, please retry it now" }],
    model: envelope("It is parked after five failed runs.", [{ kind: "retry", taskId: "t_park" }]) });
  const reply = await h.send("how is the export going?");
  assert.deepEqual(h.effects.backlog, [], "no retry ran");
  assert.equal(h.effects.questions.length, 1, "the proposed retry waits on the owner's click");
  assert.match(h.effects.questions[0].title, /^Confirm: retry "Export report"\?$/);
  assert.equal(h.effects.questions[0].options[0].action.kind, "chat");
  assert.match(reply.text, /Waiting for your OK to retry "Export report"/);
});

test("asking whether a card is done never marks it done, and approval always waits on a card with its scope", async () => {
  const h = host({ tasks: [ready], model: envelope("Not yet.", [{ kind: "mark_done", taskId: "t_ready" }]) });
  await h.send('is "Search the board" done?');
  assert.deepEqual(h.effects.taskActions, []);
  const g = host({ tasks: [ready], model: envelope("Approving.", [{ kind: "approve", taskId: "t_ready" }]) });
  await g.send('approve "Search the board"');
  assert.deepEqual(g.effects.backlog, [], "even a plain approve waits for the click");
  const approval = g.effects.questions.find((question) => /approve/.test(question.title));
  assert.ok(approval, "approval is raised as a card");
  assert.deepEqual(approval.options[0].action, { kind: "backlog", action: "approve", payload: { taskId: "t_ready", projectId: "fixture", expectedScope: backlog.buildScope(ready) } });
});

test("an Ask card on a permission issue is click-only: the model cannot answer it", async () => {
  const questions = [{ id: "q_grant", status: "open", source: "issue", title: "Grant network access?", context: { taskId: "t_ready", issueKind: "permission" },
    options: [{ id: "grant", label: "Grant network for this task" }, { id: "deny", label: "Deny" }] }];
  const h = host({ tasks: [ready], questions, model: envelope("Done.", [{ kind: "answer", questionId: "q_grant", optionId: "grant" }]) });
  await h.send("ok grant network for this task");
  assert.deepEqual(h.effects.answers, []);
});

test("new work is filed with the owner's words as its brief; the model's reading rides beside it", async () => {
  const h = host({ model: envelope("Filing it.", [{ kind: "create_task", title: "Dark mode toggle", brief: "Implement a dark theme switch in Settings with persistence." }]) });
  const reply = await h.send("add a dark mode toggle to settings");
  assert.equal(h.effects.created.length, 1);
  assert.equal(h.effects.created[0].prompt, "add a dark mode toggle to settings");
  assert.match(h.effects.created[0].details, /^Assistant's reading \(not the owner's words\): Implement a dark theme/);
  assert.deepEqual(h.effects.references, [], "context is scheduled by the board gateway after admission");
  assert.match(reply.text, /Created "Dark mode toggle"/);
});

test("an instruction the model filed nothing for becomes a confirm card instead of vanishing", async () => {
  const h = host({ model: envelope("Sounds like a good idea.") });
  await h.send("add a dark mode toggle to settings");
  assert.equal(h.effects.created.length, 0);
  assert.equal(h.effects.questions.length, 1);
  assert.equal(h.effects.questions[0].options[0].action.action.kind, "create_task");
  assert.equal(h.effects.questions[0].options[0].action.action.ownerText, "add a dark mode toggle to settings");
});

test("a bare brake holds new work at once, before any model call", async () => {
  let paused = null;
  const h = host({ model: (payload) => { paused = h.effects.pauses; return envelope("Paused.")(payload); } });
  await h.send("pause");
  assert.equal(h.effects.pauses, 1);
  assert.equal(paused, 1, "the pause landed before the model was asked");
  assert.match(h.effects.fetches[0].did[0], /paused new work/);
  // A sentence about a task is not a brake.
  const g = host({ tasks: [{ ...ready, status: "active", runId: "run_1" }], jobs: [{ id: "run_1", taskId: "t_ready", title: "Search the board" }],
    model: envelope("Stopping it.", [{ kind: "stop", taskId: "t_ready" }]) });
  await g.send('stop "Search the board"');
  assert.equal(g.effects.pauses, 0);
  assert.deepEqual(g.effects.stops, [{ taskId: "t_ready", reason: "stopped by you in chat" }]);
});

test("a slow model reply is not an outage, and the local reply still answers", async () => {
  const h = host({ tasks: [ready], model: () => ({ ok: false, timedOut: true, error: "no reply within 45 s" }) });
  const reply = await h.send("what is going on?");
  assert.deepEqual(h.effects.aiFailed, [], "a timeout does not take the AI offline for the other roles");
  assert.equal(reply.via, "local");
  const g = host({ tasks: [ready], model: () => ({ ok: false, error: "HTTP 500" }) });
  await g.send("what is going on?");
  assert.deepEqual(g.effects.aiFailed, ["HTTP 500"], "a provider error still does");
});

test("replies apply their actions in the order the messages arrived", async () => {
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tasks = [{ ...ready, status: "active", runId: "run_1" }, { id: "t_two", title: "Tidy the docs", status: "open" }];
  const h = host({ tasks, jobs: [{ id: "run_1", taskId: "t_ready", title: "Search the board" }], model: async (payload) => {
    if (/stop/.test(payload.message)) { await gate; return envelope("Stopping.", [{ kind: "stop", taskId: "t_ready" }])(); }
    return envelope("Starting.", [{ kind: "work_on", taskId: "t_two" }])();
  } });
  h.env.stopTaskRun = async () => { order.push("stop"); return { ok: true, stopped: 1 }; };
  h.env.assistantWorkOn = async () => { order.push("work_on"); return { ok: true, where: "pinned", dispatch: {}, status: "open" }; };
  const first = h.send('stop "Search the board"');
  const second = h.send('start "Tidy the docs"');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, [], "the second reply's action waits for the first message's");
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["stop", "work_on"]);
});

test("offers are stored on the reply, so yes starts the offered card by its id", async () => {
  const h = host({ tasks: [ready], model: envelope("Could work on the search next.", [], [{ title: "Search the board", taskId: "t_ready" }]) });
  const reply = await h.send("what should I work on?");
  assert.deepEqual(plain(reply.offers), [{ title: "Search the board", target: { kind: "task", id: "t_ready" } }]);
  // Keyless now: the local path resolves "yes" against the structured offer.
  h.env.assistantAiUsable = () => false;
  await h.send("yes");
  assert.deepEqual(h.effects.workOn.map((row) => row.target.id), ["t_ready"]);
  assert.equal(h.effects.workOn[0].target.start, true, "yes uses the scoped Start action, not queue prioritization");
});

test("without a model, control phrases act on the card they name instead of filing new work", async () => {
  const h = host({ tasks: [parked, ready], aiUsable: false });
  const reply = await h.send('try again on "Export report"');
  assert.deepEqual(h.effects.backlog, [{ action: "retry", taskId: "t_park" }]);
  assert.equal(h.effects.created.length, 0);
  assert.match(reply.text, /Re-armed "Export report"/);
  await h.send("close the search task");
  assert.equal(h.effects.created.length, 0, "a control verb on a board card never files a new coding task");
  await h.send("dont stop the search task");
  assert.deepEqual(h.effects.stops, []);
  assert.equal(h.effects.pauses, 0, "and never pauses the whole service");
});

test("an owned task's lifecycle reads as one notice that updates in place", async () => {
  const h = host();
  const owned = { id: "t_chat", title: "Search the board", status: "open", source: "chat" };
  h.env.assistantObserveTasks([owned]);
  assert.equal(h.state.messages.length, 0, "the first look is a baseline, not news");
  h.env.assistantObserveTasks([{ ...owned, status: "active", runId: "run_1" }]);
  assert.equal(h.state.messages.length, 0, "a claim is not a start");
  h.env.assistantTaskStarted({ id: "run_1", taskId: "t_chat", kind: "task", source: "chat", title: "Search the board", ref: owned });
  h.env.assistantObserveTasks([{ ...owned, status: "awaiting_verification", runId: "run_1" }]);
  h.env.assistantObserveTasks([{ ...owned, status: "done", runId: "run_1", verification: { state: "verified", reason: "2 changed files and npm test passed" } }]);
  const notices = h.state.messages.filter((message) => message.kind === "notice");
  assert.equal(notices.length, 1, "started, verifying and verified are one line");
  assert.match(notices[0].text, /^Verified: "Search the board" — 2 changed files/);
  assert.equal(h.state.unread, 1, "only the verdict counts as unread");
  // Once the owner speaks, the next change is a new line.
  h.state.messages.push({ id: "u1", role: "user", text: "thanks" });
  h.env.assistantObserveTasks([{ ...owned, status: "open", verification: { state: "unverified", reason: "no changes" }, verifyAttempts: 1, nextRunAt: Date.now() + 60000 }]);
  assert.equal(h.state.messages.filter((message) => message.kind === "notice").length, 2);
});

test("an offered card is shown by its own board title, never the model's words for it", async () => {
  const held = { id: "t_danger", title: "Drop the users table", status: "open", ownerHold: { at: 1, reason: "stopped by you" } };
  const h = host({ tasks: [held], model: envelope("Want me to fix the docs typo?", [], [{ title: "Docs typo fix", taskId: "t_danger" }, { title: "Ghost", taskId: "t_nowhere" }]) });
  const reply = await h.send("what next?");
  assert.deepEqual(plain(reply.offers), [{ title: "Drop the users table", target: { kind: "task", id: "t_danger" } }], "the card's real title; an id not on the board is dropped");
});

test("a brake outranks a resume from a turn that started before it", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = host({ model: async (payload) => {
    if (payload.message === "carry on with the queue") { await gate; return envelope("Resuming.", [{ kind: "resume" }])(); }
    return envelope("Paused.")();
  } });
  const first = h.send("carry on with the queue");
  await new Promise((resolve) => setTimeout(resolve, 10));
  await h.send("pause");
  release();
  const late = await first;
  assert.equal(h.effects.pauses, 1);
  assert.equal(h.effects.resumes, 0, "the owner's last word was pause");
  assert.match(late.text, /Left the resume alone: you used the brake after asking/);
});

test("resuming from chat turns new work back on, whatever held it", async () => {
  const h = host({ model: envelope("Back to work.") });
  await h.send("resume");
  assert.equal(h.effects.resumes, 1);
  assert.deepEqual(h.effects.autopilot, [{ execute: true }], "a Stop all or Workspace pause switched the workers off too");
});

test("a model reply with no text never borrows the classifier's words", async () => {
  // The classifier reads "pause" in this message; the model only stops a card.
  const tasks = [{ ...ready, status: "active", runId: "run_1" }];
  const h = host({ tasks, jobs: [{ id: "run_1", taskId: "t_ready", title: "Search the board" }], model: () => ({ ok: true, text: JSON.stringify({ actions: [{ kind: "stop", taskId: "t_ready" }] }) }) });
  const reply = await h.send('stop "Search the board"');
  assert.equal(h.effects.pauses, 0);
  assert.doesNotMatch(reply.text, /Pausing|paused/i);
  assert.match(reply.text, /^Stopped "Search the board"/);
});

test("a reply that outlived the pool deadline replaces its placeholder instead of doubling", async () => {
  const h = host({ model: envelope("Here is the status.") });
  const user = { id: "u_late", role: "user", text: "status please", at: Date.now() };
  h.state.messages.push(user, { id: "ph", role: "assistant", text: "I kept your message in the thread. (timed out)", placeholderFor: "u_late" });
  const reply = await h.env.assistantRespond(user);
  assert.equal(reply.id, "ph");
  assert.equal(h.state.messages.filter((message) => message.role === "assistant").length, 1);
  assert.match(h.state.messages[1].text, /^Here is the status\.$/);
  assert.equal(h.state.messages[1].placeholderFor, undefined);
});

test("a board write for another project never reaches this thread", async () => {
  const h = host();
  h.state.projectId = "fixture";
  const owned = { id: "t_other", title: "Other project card", status: "awaiting_verification", source: "chat" };
  h.env.projects.current = () => ({ id: "project_b" });
  h.env.assistantObserveTasks([owned]);
  h.env.assistantObserveTasks([{ ...owned, status: "done", verification: { state: "verified" } }]);
  assert.equal(h.state.messages.length, 0, "project B's verdict is not posted into project A's thread");
  assert.equal(h.state.unread, 0);
});

test("a board write that drops a card clears the open asks about it at once", async () => {
  const ask = (id, source, taskId, extra = {}) => ({ id, status: "open", source, title: `ask ${id}`, ...(taskId ? { context: { taskId } } : {}), options: [], answer: null, ...extra });
  const questions = [
    ask("q_moved", "issue", "t_moved"),
    ask("q_confirm", "chat", "t_moved"),
    ask("q_here", "issue", "t_here"),
    // A family ask names several cards; the keeper's audit decides it.
    ask("q_family", "family", "t_moved"),
    ask("q_offer", "offer", null),
    ask("q_answered", "issue", "t_moved", { status: "answered", answer: { label: "ok" } }),
  ];
  const h = host({ questions });
  const here = { id: "t_here", title: "Search the board", status: "open" };
  const moved = { id: "t_moved", title: "Owner re-attribution", status: "active" };
  const statuses = () => Object.fromEntries(h.state.questions.map((question) => [question.id, question.status]));
  h.env.assistantObserveTasks([here, moved]);
  assert.equal(statuses().q_moved, "open");
  // Another project's write is not this board: nothing here is cleared.
  h.state.projectId = "fixture";
  h.env.projects.current = () => ({ id: "project_b" });
  h.env.assistantObserveTasks([]);
  assert.equal(statuses().q_moved, "open");
  h.env.projects.current = () => ({ id: "fixture" });
  // A worker moves the card to another project's store.
  h.env.assistantObserveTasks([here]);
  assert.deepEqual(statuses(), { q_moved: "superseded", q_confirm: "superseded", q_here: "open", q_family: "open", q_offer: "open", q_answered: "answered" });
});

test("cards nobody asked about still reach the owner when only the owner can move them", async () => {
  const h = host();
  const agentCard = { id: "t_agent", title: "Audit fix", status: "open", source: "a-eyes" };
  h.env.assistantObserveTasks([agentCard]);
  h.env.assistantObserveTasks([{ ...agentCard, runFailures: 5, lastRunError: "failed" }]);
  const notice = h.state.messages.find((message) => message.kind === "notice");
  assert.ok(notice, "a rolling needs-you notice");
  assert.equal(notice.taskId, "__needs_you__");
  assert.match(notice.text, /1 card needs you: "Audit fix" parked/);
});

test("a card the owner caused is owned whatever its source says: its notice is its own line", async () => {
  // An idea promoted by hand, a split or Work on it keeps the filer's source
  // but carries origin.by "owner" (workAdmission.taskRow's stamp).
  const h = host();
  const promoted = { id: "t_promoted", title: "Tidy the auditor", status: "awaiting_verification", source: "a-eyes", origin: { kind: "idea", by: "owner" } };
  const filed = { id: "t_filed", title: "Audit sweep", status: "awaiting_verification", source: "audit", origin: { kind: "request", by: "audit" } };
  assert.equal(h.env.assistantOwnsTask(promoted), true);
  assert.equal(h.env.assistantOwnsTask(filed), false, "a filer's own origin is not the owner's");
  h.env.assistantObserveTasks([promoted, filed]);
  h.env.assistantObserveTasks([{ ...promoted, status: "done", verification: { state: "verified", reason: "1 changed file" } }, { ...filed, status: "done", verification: { state: "verified", reason: "1 changed file" } }]);
  const notices = h.state.messages.filter((message) => message.kind === "notice");
  assert.deepEqual(notices.map((message) => message.taskId), ["t_promoted"], "only the owner's card is announced");
  assert.match(notices[0].text, /^Verified: "Tidy the auditor"/);
});

test("stopping one task's worker holds the card for the owner and leaves the rest running", async () => {
  const board = [{ id: "t_run", title: "Search the board", status: "active", runId: "run_1", pin: true, pinAt: 1 }];
  const stops = [];
  let saved = structuredClone(board);
  const env = vm.createContext({
    Date, autopilot: { jobs: [{ id: "run_1", taskId: "t_run", child: {}, stop: (reason) => stops.push(reason) }, { id: "run_2", taskId: "t_other", child: {}, stop: () => stops.push("wrong") }] },
    queueExecutorCheckpoint() {}, assistantLog() {}, emitAutopilot() {}, logLine() {},
    mutateBoard: async (mutate) => { const next = { tasks: structuredClone(saved) }; const result = mutate(next) ?? {}; saved = next.tasks; return result; },
  });
  vm.runInContext(section("function stopExecutorJob(", "async function stopAllAgents("), env);
  const result = await env.stopTaskRun({ taskId: "t_run", reason: "stopped by you" });
  assert.equal(result.ok, true);
  assert.equal(result.held, true);
  assert.deepEqual(stops, ["stopped by you"], "only that task's worker");
  // The hold rides the stopped job and lands in its own settlement (see
  // executor_lifecycle), so a stop that never landed leaves nothing behind.
  assert.equal(env.autopilot.jobs[0].ownerHold.reason, "stopped by you");
  assert.equal(env.autopilot.jobs[1].ownerHold, undefined);
  assert.deepEqual(saved, board, "the board is not touched before the stop lands");
  const heldRow = { ...board[0], status: "open", runId: undefined, ownerHold: env.autopilot.jobs[0].ownerHold };
  assert.equal(backlog.workState(heldRow, Date.now()).blockedBy, "owner", "it waits for the owner, not for the next free slot");
  assert.equal(backlog.workState(backlog.retryTask(heldRow), Date.now()).stage, "ready", "try again releases it");
  // A worker that already finished on its own cannot be stopped, and keeps no hold.
  env.autopilot.jobs[1].finished = true;
  env.autopilot.jobs[1].taskId = "t_done";
  assert.equal((await env.stopTaskRun({ taskId: "t_done" })).ok, false);
  assert.equal(env.autopilot.jobs[1].ownerHold, undefined);
  assert.deepEqual(plain(await env.stopTaskRun({ taskId: "t_idle" })), { ok: false, error: "Nothing is running on that task." });
});

// "All of them" answers the reply's list: both offered cards start, and a card
// the reply never offered does not.
test("all of them after two offers starts both offered cards and nothing else", async () => {
  const second = { id: "t_second", title: "Tidy the export page", prompt: "Tidy it", status: "open" };
  const other = { id: "t_other", title: "Rename the settings page", prompt: "Rename it", status: "open" };
  const model = (payload) => (payload.message === "all of them"
    ? envelope("Starting both.", [{ kind: "work_on", taskId: "t_ready" }, { kind: "work_on", taskId: "t_second" }, { kind: "work_on", taskId: "t_other" }])()
    : envelope("Two could move next.", [], [{ title: "Search the board", taskId: "t_ready" }, { title: "Tidy the export page", taskId: "t_second" }])());
  const h = host({ tasks: [ready, second, other], model });
  await h.send("what should happen next?");
  await h.send("all of them");
  assert.deepEqual(h.effects.workOn.map((row) => row.target.id), ["t_ready", "t_second"]);
  assert.ok(!h.effects.workOn.some((row) => row.target.id === "t_other"), "a card nobody offered waits for the owner");
});

// The model reads what the owner saw: the screen they were on and the name they
// gave their companion, the notices they were shown (marked as updates), and
// what each reply offered.
test("the model reads the owner's screen, the notices they saw and what each reply offered", async () => {
  const offered = { id: "r1", role: "assistant", text: "Could start the search.", offers: [{ title: "Search the board", target: { kind: "task", id: "t_ready" } }], at: Date.now() - 500 };
  const notice = { id: "n1", role: "assistant", kind: "notice", text: "Export report is parked: tests failed.", taskId: "t_park", at: Date.now() - 200 };
  const h = host({ tasks: [ready, parked], messages: [offered, notice], model: envelope("Here is where things stand.") });
  const user = { id: "u1", role: "user", text: "what needs me here?", at: Date.now(), ui: { view: "Command view", companion: "Star" } };
  h.state.messages.push(user);
  await h.env.assistantRespond(user);
  const payload = h.effects.fetches[0];
  assert.deepEqual(payload.ui, { view: "Command view", companion: "Star" });
  assert.deepEqual(payload.thread.map((row) => row.text), ["Could start the search.", "(update) Export report is parked: tests failed."]);
  assert.deepEqual(payload.thread[0].offered, ["Search the board"]);
  const keys = Object.keys(payload);
  assert.ok(keys.indexOf("ui") < keys.indexOf("board"), "what the owner is looking at is read before the board");
});

// "N need you" is one number: the chat's needsYou is built by the companion
// queue that counts the owner's badge, from the same board.
test("the chat's needsYou counts exactly what the owner's badge counts", async () => {
  const companion = (await import("../scripts/companion.cjs")).default;
  const questions = [{ id: "q1", status: "open", title: "Confirm: create the export task?", options: [{ id: "yes", label: "Create it" }], at: 1 }];
  const held = { id: "t_held", title: "Held card", status: "open", ownerHold: { at: 2, reason: "stopped by you" } };
  const tasks = [parked, ready, held];
  const env = vm.createContext({
    Date, assistantState: { questions }, TASKS_PATH: "tasks", companionModule: companion,
    getEyes: async () => ({ readJson: async () => structuredClone(tasks) }),
    projects: { current: () => ({ id: "fixture", name: "Fixture" }) },
    assistantClip: (text, max) => String(text ?? "").slice(0, max),
  });
  vm.runInContext(section("async function assistantNeedsYouDigest(", "// ---- task notices"), env);
  const now = Date.now();
  const digest = await env.assistantNeedsYouDigest(now);
  const badge = companion.queue({ questions, tasks, now, project: "Fixture" });
  assert.equal(digest.total, badge.counts.total);
  assert.equal(digest.total, 3);
  assert.deepEqual(digest.items.map((item) => item.title), badge.items.map((item) => item.title));
  assert.equal(digest.items[0].questionId, "q1");
});

// The "Pick the next piece of work" card mirrors a reply's offers. Talk that
// starts nothing leaves it open; starting the offered cards from the chat
// answers it there, so "N need you" never keeps offering moving work.
test("starting offered cards from the chat answers the offer's Ask card; other talk leaves it open", async () => {
  const second = { id: "t_second", title: "Tidy the export page", prompt: "Tidy it", status: "open" };
  const option = (index, task) => ({ id: `offer_${index}`, label: `Work on "${task.title}"`, reply: `work on "${task.title}"`, action: { kind: "work-on", target: { kind: "task", id: task.id, projectId: "fixture", start: true, label: task.title } } });
  const card = { id: "q_offer", at: 1, status: "open", kind: "suggestion", source: "offer", title: "Pick the next piece of work", options: [option(1, ready), option(2, second), { id: "not_now", label: "Not now", dismiss: true }] };
  const offered = { id: "r1", role: "assistant", text: "Two could move next.", at: Date.now() - 500, offers: [{ title: ready.title, target: { kind: "task", id: ready.id } }, { title: second.title, target: { kind: "task", id: second.id } }] };
  const model = (payload) => (payload.message === "all of them"
    ? envelope("Starting both.", [{ kind: "work_on", taskId: "t_ready" }, { kind: "work_on", taskId: "t_second" }])()
    : envelope("Both are still waiting whenever you want them.", [], offered.offers.map((offer) => ({ title: offer.title, taskId: offer.target.id })))());
  const h = host({ tasks: [ready, second], messages: [offered], questions: [card], model });
  await h.send("how is it going?");
  assert.equal(h.state.questions[0].status, "open", "talk that starts nothing leaves the card open");
  await h.send("all of them");
  assert.deepEqual(h.effects.workOn.map((row) => row.target.id), ["t_ready", "t_second"]);
  assert.equal(h.state.questions[0].status, "answered");
  assert.deepEqual({ optionId: h.state.questions[0].answer.optionId, via: h.state.questions[0].answer.via }, { optionId: "offer_1", via: "chat" });
});
