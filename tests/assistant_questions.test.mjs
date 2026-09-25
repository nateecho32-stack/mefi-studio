import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";
import taskOversight from "../scripts/task-oversight.cjs";
import executorCore from "../scripts/executor-core.cjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};

function questionHost({ executorLog = "", offers = [], tasks = [] } = {}) {
  const state = assistant.emptyState(1000);
  const events = [], logs = [], messages = [], backlog = [], controls = [], saves = [], writes = [];
  let ledger = executorLog;
  const env = vm.createContext({
    console,
    assistantState: state,
    assistantModule: assistant,
    taskOversight,
    projects: { current: () => ({ id: "fixture" }) },
    ASSISTANT_CAPS: assistant.CAPS,
    EXECUTOR_LOG_PATH: "executor-log.jsonl",
    TASKS_PATH: "tasks.json",
    executorCore,
    getEyes: async () => ({ readJson: async () => tasks }),
    projectDataPath: (file) => file,
    readFile: async () => ledger,
    writeFile: async (file, text) => { writes.push({ file, text }); ledger = text; },
    rename: async () => {},
    rm: async () => {},
    assistantCaps: () => assistant.CAPS,
    assistantTrim(list, cap) { if (list.length > cap) list.splice(0, list.length - cap); },
    assistantClip(value, max) { const line = String(value ?? "").replace(/\s+/g, " ").trim(); return line.length > max ? `${line.slice(0, max - 1)}…` : line; },
    assistantLog(kind, text) { logs.push({ kind, text }); },
    assistantEmit(event) { events.push(event); },
    saveAssistant: async (options) => { saves.push(options ?? null); },
    ensureAssistant: async () => state,
    logError(text) { logs.push({ kind: "error", text }); },
    getAssistant: async () => ({ pendingOffers: () => offers }),
    assistantMessage: async (text) => { messages.push(text); return { ok: true }; },
    assistantAppendReply: (text) => { messages.push(text); },
    assistantWorkOn: async (target) => { controls.push({ kind: "work-on", target }); return { ok: true }; },
    backlogControl: async (payload) => { backlog.push(payload); return { ok: true }; },
    assistantControl: async (action) => { controls.push({ kind: "control", action }); return { ok: true }; },
  });
  vm.runInContext(section("// ---- agent questions", "async function assistantSetPrefs("), env);
  return { env, state, events, logs, messages, backlog, controls, saves, writes };
}

test("normalizeState keeps questions with their options and answers", () => {
  const raw = assistant.emptyState(1000);
  raw.questions = [{
    id: "q1",
    at: 900,
    kind: "suggestion",
    source: "offer",
    title: "Pick the next piece of work",
    detail: "The assistant suggested: \"Fix the renderer\".",
    status: "answered",
    options: [
      { id: "offer_1", label: "Work on \"Fix the renderer\"", reply: "work on \"Fix the renderer\"", recommended: true },
      { id: "not_now", label: "Not now", dismiss: true },
      { id: "", label: "" },
    ],
    answer: { at: 950, optionId: "offer_1", label: "Work on \"Fix the renderer\"", via: "option" },
  }];
  const state = assistant.normalizeState(raw, 2000);
  assert.equal(state.questions.length, 1);
  const [question] = state.questions;
  assert.equal(question.kind, "suggestion");
  assert.equal(question.status, "answered");
  assert.equal(question.options.length, 2);
  assert.equal(question.options[0].recommended, true);
  assert.equal(question.options[1].dismiss, true);
  assert.equal(question.answer.optionId, "offer_1");
});

test("normalizeState keeps why an answer was not applied, and no error key when it was", () => {
  const raw = assistant.emptyState(1000);
  const answered = (id, error) => ({ id, at: 900, title: "Split the extra work out?", status: "answered",
    options: [{ id: "split", label: "Split the extra work out" }], answer: { at: 950, optionId: "split", label: "Split the extra work out", via: "option", error } });
  raw.questions = [answered("q1", `  ${"x".repeat(300)}`), answered("q2", null), answered("q3", "   "), answered("q4", { not: "text" })];
  const state = assistant.normalizeState(raw, 2000);
  assert.equal(state.questions[0].answer.error, "x".repeat(200));
  for (const question of state.questions.slice(1)) assert.equal("error" in question.answer, false, question.id);
});

// The Ask rail's card, run from the renderer source against a bare document.
const idleSource = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
function askCardHost() {
  const node = (tag) => ({
    tag, children: [], dataset: {}, className: "", textContent: "", title: "",
    append(...items) { this.children.push(...items); },
    setAttribute() {}, addEventListener() {},
  });
  const context = vm.createContext({ document: { createElement: node }, agoLabel: () => "now", nav() {} });
  const from = idleSource.indexOf("  function askCard(");
  const to = idleSource.indexOf("  async function answerQuestion(", from);
  assert.ok(from >= 0 && to > from, "renderer section exists: askCard");
  vm.runInContext(`${idleSource.slice(from, to)}\nthis.askCard = askCard;`, context);
  const find = (item, className) => item.className === className ? item : item.children.map((child) => find(child, className)).find(Boolean) ?? null;
  return { askCard: context.askCard, find };
}

test("an answered card says when its answer could not be applied", async () => {
  const { askCard, find } = askCardHost();
  const card = (answer) => askCard({ id: "q1", at: 900, kind: "question", source: "issue", title: "Split the extra work out?", status: "answered", options: [], answer });
  const refused = card({ label: "Split the extra work out", error: "This follow-up chain is 3 deep; edit the parent or create a task by hand." });
  assert.equal(refused.dataset.applied, "false");
  assert.equal(find(refused, "ask-answer-note").textContent, "You chose: Split the extra work out — not applied: This follow-up chain is 3 deep; edit the parent or create a task by hand.");
  const applied = card({ label: "Keep to the brief" });
  assert.equal(applied.dataset.applied, undefined);
  assert.equal(find(applied, "ask-answer-note").textContent, "You chose: Keep to the brief");
  // The warning reads in the rail's warn colour, from the shared token.
  const css = await readFile(new URL("../renderer/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.ask-card\[data-applied="false"\][^{]*\{[^}]*color:\s*var\(--warn\)/);
});

test("normalizeState drops malformed questions and clamps the tail", () => {
  const raw = assistant.emptyState(1000);
  raw.questions = [{ title: "" }, null, { title: "kept", options: [] }];
  const state = assistant.normalizeState(raw, 2000);
  assert.deepEqual(state.questions.map((question) => question.title), ["kept"]);
});

test("pendingOffers only counts replies that asked for a decision", () => {
  const state = assistant.emptyState(1000);
  state.messages = [{ role: "assistant", text: "Could work on \"Fix the renderer\" or \"Tidy the board\"." }];
  assert.deepEqual(assistant.pendingOffers(state), ["Fix the renderer", "Tidy the board"]);
  state.messages = [{ role: "assistant", text: "The status shows \"Fix the renderer\" is open." }];
  assert.deepEqual(assistant.pendingOffers(state), []);
});

test("assistantQuestion validates input, flags the recommendation and pushes", () => {
  const h = questionHost();
  assert.equal(h.env.assistantQuestion({ title: "   " }), null);
  assert.equal(h.env.assistantQuestion({ title: "Decide", options: [{ label: "" }] }), null);
  const question = h.env.assistantQuestion({
    title: "Retry the failed build?",
    kind: "question",
    source: "build",
    detail: "The worker stopped early.",
    options: [
      { id: "retry", label: "Retry once more", recommended: true, action: { kind: "backlog", action: "retry", payload: { taskId: "task_1" } } },
      { id: "hold", label: "Leave it", dismiss: true },
    ],
  });
  assert.equal(h.state.questions.length, 1);
  assert.equal(question.options[0].recommended, true);
  assert.equal(question.options[0].action.payload.taskId, "task_1");
  assert.equal(question.options[1].dismiss, true);
  assert.deepEqual(h.logs.map((row) => row.kind), ["question"]);
  assert.equal(h.events.at(-1).kind, "question");
  assert.equal(h.saves.length, 1);
});

test("answering an option records it and runs the action", async () => {
  const h = questionHost();
  const question = h.env.assistantQuestion({
    title: "Retry?",
    options: [{ id: "retry", label: "Retry once more", recommended: true, action: { kind: "backlog", action: "retry", payload: { taskId: "task_1" } } }],
  });
  const result = await h.env.assistantAnswer({ id: question.id, optionId: "retry" });
  assert.equal(result.ok, true);
  assert.equal(h.state.questions[0].status, "answered");
  assert.equal(h.state.questions[0].answer.optionId, "retry");
  assert.equal(h.backlog.length, 1);
  assert.equal(h.backlog[0].action, "retry");
  assert.equal(h.backlog[0].taskId, "task_1");
  assert.equal(h.messages.length, 0);
});

test("a Yes-start answer forwards scoped start and keeps the actual blocked dispatch result", async () => {
  const h = questionHost();
  const dispatch = { taskId: "named", requested: false, held: true, phase: "approval", reason: "approval", message: "Review and approve this task before starting it." };
  h.env.assistantWorkOn = async (target) => { h.controls.push({ target }); return { ok: true, dispatch }; };
  const question = h.env.assistantQuestion({ title: "Start the named task?", options: [{ id: "yes", label: "Yes, start", action: { kind: "work-on", target: { kind: "task", id: "named" } } }] });
  const result = await h.env.assistantAnswer({ id: question.id, optionId: "yes" });
  assert.equal(h.controls[0].target.start, true, "even a pre-upgrade stored offer uses explicit scoped Start");
  assert.equal(result.dispatch.message, dispatch.message);
  assert.equal(question.answer.dispatch.phase, "approval");
  const restored = assistant.normalizeState(h.state, Date.now()).questions[0].answer.dispatch;
  assert.equal(restored.message, dispatch.message);
  assert.equal(restored.held, true);
  assert.equal(restored.requested, false);
});

test("a clicked chat confirmation reports its dispatch outcome instead of merely saying answered", async () => {
  const h = questionHost();
  const dispatch = { taskId: "named", requested: true, held: false, phase: "preparing", message: "Assigned; waiting for the worker process to start." };
  h.env.assistantChatAction = async () => ({ ok: true, dispatch });
  const question = h.env.assistantQuestion({ title: "Confirm: start named?", options: [{ id: "yes", label: "Yes, start", action: { kind: "chat", action: { kind: "work_on", taskId: "named" } } }] });
  const result = await h.env.assistantAnswer({ id: question.id, optionId: "yes" });
  assert.equal(result.dispatch.phase, "preparing");
  assert.deepEqual(h.messages, [dispatch.message]);
});

test("answering with dismiss marks the question without replying", async () => {
  const h = questionHost();
  const question = h.env.assistantQuestion({
    title: "Queue it?",
    options: [{ id: "not_now", label: "Not now", dismiss: true }],
  });
  const result = await h.env.assistantAnswer({ id: question.id, optionId: "not_now" });
  assert.equal(result.ok, true);
  assert.equal(h.state.questions[0].status, "dismissed");
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.backlog, []);
});

test("a written answer or a reply option goes through the chat path", async () => {
  const h = questionHost();
  const first = h.env.assistantQuestion({ title: "Which one?", options: [{ id: "a", label: "Fix the renderer", reply: "work on \"Fix the renderer\"" }] });
  await h.env.assistantAnswer({ id: first.id, optionId: "a" });
  assert.deepEqual(h.messages, ["work on \"Fix the renderer\""]);
  const second = h.env.assistantQuestion({ title: "Anything else?", options: [{ id: "b", label: "Just do this" }] });
  await h.env.assistantAnswer({ id: second.id, text: "do the smaller thing first" });
  assert.deepEqual(h.messages, ["work on \"Fix the renderer\"", "do the smaller thing first"]);
  assert.equal(h.state.questions[1].answer.via, "text");
});

test("a stale or unknown question is refused instead of answered", async () => {
  const h = questionHost();
  const question = h.env.assistantQuestion({ title: "Once", options: [{ id: "a", label: "Yes" }] });
  await h.env.assistantAnswer({ id: question.id, optionId: "a" });
  const again = await h.env.assistantAnswer({ id: question.id, optionId: "a" });
  assert.equal(again.ok, false);
  const unknown = await h.env.assistantAnswer({ id: "missing", optionId: "a" });
  assert.equal(unknown.ok, false);
});

test("open questions expire after their time to live", () => {
  const h = questionHost();
  const question = h.env.assistantQuestion({ title: "Old ask", options: [{ id: "a", label: "Yes" }] });
  question.at -= 49 * 60 * 60 * 1000;
  assert.equal(h.env.assistantPruneQuestions(), 1);
  assert.equal(h.state.questions[0].status, "expired");
});

test("the offer question recommends the first title and supersedes the last", async () => {
  const h = questionHost({ offers: ["Fix the renderer", "Tidy the board"] });
  const first = await h.env.assistantOfferQuestion();
  assert.equal(first.kind, "suggestion");
  assert.equal(first.options[0].recommended, true);
  assert.equal(first.options[0].reply, "work on \"Fix the renderer\"");
  assert.equal(first.options.at(-1).dismiss, true);
  assert.equal(await h.env.assistantOfferQuestion(), first, "the same offer is not asked twice");
  assert.equal(first.title, 'Start "Fix the renderer" or "Tidy the board" next?', "the card is named after the work it offers");
});

test("an offer the owner turned down or took is not filed again by the next reply", async () => {
  const offers = ["Fix the renderer"];
  const h = questionHost({ offers });
  const first = await h.env.assistantOfferQuestion();
  assert.equal(first.title, 'Start "Fix the renderer" next?');
  assert.equal((await h.env.assistantAnswer({ id: first.id, optionId: "not_now" })).ok, true);
  assert.equal(await h.env.assistantOfferQuestion(), null, "Not now keeps it off the rail");
  assert.equal(h.state.questions.length, 1);
  // A different pick is still offered, without the declined one.
  offers.push("Tidy the board");
  const next = await h.env.assistantOfferQuestion();
  assert.equal(next.title, 'Start "Tidy the board" next?');
  assert.deepEqual(next.options.map((option) => option.id), ["offer_1", "not_now"]);
  // After a day the declined offer may come back.
  h.state.questions[0].answer.at -= 25 * 60 * 60 * 1000;
  h.state.questions[0].at -= 25 * 60 * 60 * 1000;
  offers.splice(1);
  const again = await h.env.assistantOfferQuestion();
  assert.equal(again.title, 'Start "Fix the renderer" next?');
});

test("a newer offer supersedes the previous open one", async () => {
  const offers = ["First pick"];
  const h = questionHost({ offers });
  const first = await h.env.assistantOfferQuestion();
  offers.length = 0;
  offers.push("Second pick");
  const second = await h.env.assistantOfferQuestion();
  assert.notEqual(second.id, first.id);
  assert.equal(h.state.questions[0].status, "superseded");
  assert.equal(h.state.questions[1].status, "open");
});

test("recent runs group retries by task and show the current board state", async () => {
  const lines = [
    JSON.stringify({ at: 100, event: "start", title: "ignored" }),
    JSON.stringify({ at: 200, event: "finish", kind: "task", task: "task_1", title: "Build the rail", ok: false, error: "exit 1" }),
    JSON.stringify({ at: 250, event: "finish", kind: "task", task: "task_1", title: "Build the rail", ok: true, seconds: 42 }),
    JSON.stringify({ at: 300, event: "finish", kind: "task", task: "task_2", title: "Broken build", ok: false, error: "exit 1" }),
  ].join("\n");
  const h = questionHost({ executorLog: lines, tasks: [
    { id: "task_1", status: "done", verification: { state: "verified" } },
    { id: "task_2", status: "open", runFailures: 5 },
  ] });
  // Assistant passes are not finished nodes: they stay in the activity log
  // and never land in the done log.
  h.state.log = [{ at: 400, kind: "fix", text: "repaired the catalog" }, { at: 50, kind: "tick", text: "noise" }];
  const result = await h.env.assistantDoneLog({ limit: 10 });
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.entries, (entry) => entry.title), ["Broken build", "Build the rail"]);
  assert.ok(result.entries.every((entry) => entry.kind !== "pass"), "no pass rows in the done log");
  assert.equal(result.entries[0].ok, false);
  assert.equal(result.entries[0].state, "attention");
  assert.equal(result.entries[1].taskId, "task_1");
  assert.equal(result.entries[1].state, "verified");
  assert.equal(result.entries[1].attempts, 2);
  assert.equal(result.entries[1].failures, 1);
  assert.match(result.entries[1].detail, /42s/);
});

test("clearing the done log drops finish rows, keeps start rows and leaves passes alone", async () => {
  const lines = [
    JSON.stringify({ at: 100, event: "start", title: "Build the rail" }),
    JSON.stringify({ at: 200, event: "finish", kind: "task", task: "task_1", title: "Build the rail", ok: true }),
    JSON.stringify({ at: 300, event: "finish", kind: "task", title: "Broken build", ok: false, error: "exit 1" }),
  ].join("\n");
  const h = questionHost({ executorLog: lines });
  h.state.log = [{ at: 400, kind: "fix", text: "repaired the catalog" }];
  const result = await h.env.assistantClearDoneLog();
  assert.equal(result.ok, true);
  assert.equal(result.records, 2);
  assert.equal(h.writes.length, 1, "the ledger is rewritten once");
  assert.ok(!h.writes[0].text.includes('"finish"'), "finish rows are gone");
  assert.ok(h.writes[0].text.includes('"start"'), "start rows stay");
  assert.equal(h.saves.length, 1);
  assert.equal(h.state.log.some((row) => row.kind === "fix"), true, "the activity log keeps the pass");
  const after = await h.env.assistantDoneLog({ limit: 10 });
  assert.deepEqual(Array.from(after.entries, (entry) => entry.title), [], "the tab reads empty");
});

test("clearing an empty ledger is a no-op", async () => {
  const h = questionHost();
  h.state.log = [{ at: 400, kind: "audit", text: "audited" }];
  const result = await h.env.assistantClearDoneLog();
  assert.equal(result.ok, true);
  assert.equal(result.records, 0);
  assert.equal(h.writes.length, 0, "a missing ledger is never written");
  assert.equal(h.saves.length, 0, "nothing to record when nothing was cleared");
  assert.equal((await h.env.assistantDoneLog({ limit: 10 })).entries.length, 0);
});
