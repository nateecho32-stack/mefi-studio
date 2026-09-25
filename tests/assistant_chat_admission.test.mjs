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

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};

// Real responder and admission, with serialized memory stores and no providers,
// workers or live project data. Facts deliberately lag behind durable state.
function host({ tasks = [], requests = [], jobs = [], messages = [], focused = null } = {}) {
  let board = structuredClone({ tasks, requests, ideas: [] }), tail = Promise.resolve();
  const effects = { references: [], dispatch: 0, accepted: [], errors: [], workOn: [], questions: [] };
  const state = { status: "paused", prefs: {}, messages: structuredClone(messages), agents: [],
    focus: focused ? { ...focused.target, label: focused.title } : null };
  const env = vm.createContext({
    Date, crypto, chatWork, workAdmission, setTimeout, clearTimeout, autopilot: { execute: false, jobs }, assistantState: state,
    projects: { current: () => ({ id: "fixture" }) }, projectRoot: () => "/fixture",
    workTitleKey: assistant.compactKey,
    mutateBoard: (mutate) => {
      const pending = tail.then(() => {
        const next = structuredClone(board), result = mutate(next) ?? {};
        board = next;
        return result;
      });
      tail = pending.catch(() => {});
      return pending;
    },
    getAssistant: async () => assistant,
    assistantMessageFacts: async () => ({ tasks: [], requests: [], sessions: [], ideas: [], executor: { enabled: false, running: [] } }),
    assistantFocusSubject: () => focused, assistantThink() {},
    assistantClip: (text, max) => String(text).slice(0, max),
    assistantAskForWork: () => { effects.dispatch++; },
    assistantGatherTaskReferences: (id) => { effects.references.push(id); },
    assistantWorkOn: async (target, options) => {
      effects.workOn.push({ target, options });
      return { ok: true, where: `pinned "${target.label}" to the front of the board`, dispatch: { message: "Dispatch requested." }, status: "open" };
    },
    assistantAiUsable: () => false, assistantAiOk() {}, assistantAiFailed() {}, assistantCommitThought() {}, logLine() {},
    resolveAiRoute: async () => ({ ok: true }), DATA_ONLY_CLIS: new Set(["claude"]), taskOversight, backlog,
    getEyes: async () => ({ readJson: async () => structuredClone(board.tasks) }), TASKS_PATH: "tasks",
    assistantQuestion: (question) => { effects.questions.push(question); return question; },
    assistantAppendReply: (text) => { const reply = { role: "assistant", text }; state.messages.push(reply); return reply; },
    assistantNodeContext() {}, assistantLog() {}, saveAssistant: async () => {}, refreshAutopilotQueue: async () => {},
    jevShadowIntake: (rows) => effects.accepted.push(...rows), logError: (text) => effects.errors.push(text),
  });
  vm.runInContext([
    section("const ASSISTANT_CHAT_SYSTEM =", "// OpenCode Go requires"),
    section("async function assistantCreateTask(", "function executorProcessAlive("),
    section("// ---- the overseer's hands", "// A message is appended and pushed"),
  ].join("\n"), env);
  return { env, effects, state, board: () => structuredClone(board),
    send: (text) => env.assistantRespond({ id: crypto.randomUUID(), text }) };
}

test("rephrased chat work reuses its saved task without scheduling another task", async () => {
  const h = host();
  await h.send("Add search to the task board");
  const saved = h.board();
  const reply = await h.send("Please add search to the task board.");
  assert.deepEqual(h.board(), saved);
  assert.equal(h.effects.accepted.length, 1);
  assert.equal(h.effects.references.length, 0);
  assert.equal(h.effects.dispatch, 1);
  assert.match(reply.text, /already queued.*No extra task was queued/);
  assert.doesNotMatch(reply.text, /put on the task board|roster goes out/);
  assert.deepEqual(h.effects.errors, []);
});

test("simultaneous chat sends check the current board inside the write lock", async () => {
  const h = host();
  await Promise.all(Array.from({ length: 8 }, (_, index) => h.send(index % 2 ? "Please add search to the task board." : "Add search to the task board")));
  assert.equal(h.board().tasks.length, 1);
  assert.equal(h.effects.references.length, 0);
  assert.equal(h.effects.dispatch, 1);
  assert.equal(h.state.messages.length, 8, "every message still receives a reply");
  assert.deepEqual(h.effects.errors, []);
});

test("chat reuses inbox work and pending verification without changing scope or approval", async () => {
  for (const status of ["open", "active", "awaiting_verification", "blocked", "failed"]) {
    const item = { id: "saved", title: "Add search to the task board", prompt: "Add search to the task board", status,
      runFailures: 2, buildApproval: { approvedAt: 7 }, logs: [{ text: "Prior context" }] };
    for (const kind of ["tasks", "requests"]) {
      const h = host({ [kind]: [item] }), before = h.board();
      const reply = await h.send("Please add search to the task board.");
      assert.deepEqual(h.board(), before);
      assert.match(reply.text, /No extra task was queued/);
      assert.equal(h.effects.references.length, 0);
      assert.equal(h.effects.dispatch, 0);
      assert.deepEqual(h.effects.errors, []);
    }
  }
});

test("a worker saving a removed inbox request still owns repeated chat work", async () => {
  const h = host({ jobs: [{ id: "run", title: "Add search to the task board", projectId: "fixture", finished: true,
    settlementPending: true, ref: { title: "Add search to the task board", prompt: "Add search to the task board" } }] });
  const reply = await h.send("Please add search to the task board");
  assert.equal(h.board().tasks.length, 0);
  assert.match(reply.text, /already assigned to a worker.*No extra task/);
  assert.equal(h.effects.references.length, 0);
});

test("resolved yes and work on it reuse the saved task's full brief", async () => {
  for (const text of ["yes", "work on it"]) {
    const h = host({ tasks: [{ id: "saved", title: "Search the task board", prompt: "Add keyboard accessible search, with tests and an empty state.", status: "open" }],
      messages: [{ role: "assistant", text: 'Could work on "Search the task board" — say work on it.' }] });
    const before = h.board();
    const reply = await h.send(text);
    assert.deepEqual(h.board(), before);
    assert.match(reply.text, /No extra task was queued/);
    assert.equal(h.effects.references.length, 0);
  }
});

test("different requirements sharing a truncated title remain separate work", async () => {
  const h = host();
  // Longer than the admission cap (workAdmission.TITLE_MAX, 90; the local path
  // clipped at 60 until the cap was shared), so both titles clip alike.
  const prefix = "Add keyboard accessible search to the task board, keep the saved filters, and display results ";
  assert.ok(prefix.length >= workAdmission.TITLE_MAX);
  await h.send(`${prefix}in a popup.`);
  await h.send(`${prefix}in the sidebar.`);
  assert.equal(h.board().tasks.length, 2);
  assert.equal(h.board().tasks[0].title, h.board().tasks[1].title);
  assert.notEqual(h.board().tasks[0].prompt, h.board().tasks[1].prompt);
});

test("a quoted focused title starts that task the way its Work on it button does", async () => {
  const title = 'Add "Export" button';
  const h = host({ tasks: [{ id: "saved", title, prompt: "Export the full report as CSV and retain active filters.", status: "open" }],
    focused: { title, target: { kind: "task", id: "saved" } } });
  const before = h.board();
  const reply = await h.send("work on it");
  // No second card: the named card is pinned, re-armed and dispatched through
  // assistantWorkOn (stubbed here), told the owner's words are already said.
  assert.deepEqual(h.board(), before);
  assert.equal(h.effects.workOn.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.effects.workOn[0].target)), { kind: "task", id: "saved", projectId: "fixture", start: true, label: title });
  assert.equal(h.effects.workOn[0].options.origin, "chat");
  assert.match(reply.text, /pinned "Add "Export" button" to the front of the board/);
  assert.equal(h.effects.references.length, 0);
});

test("a quoted Work on it inbox label reuses the saved request on a later chat instruction", async () => {
  const title = 'Add "Export" button';
  const saved = { id: "saved", title: `Work on "${title}"`,
    prompt: `Work on "${title}". Queued with Work on it — the user pointed at session (id: session-1).`,
    source: "chat", status: "open" };
  const h = host({ requests: [saved] }), before = h.board();
  const reply = await h.send('Please add "Export" button');
  assert.deepEqual(h.board(), before);
  assert.match(reply.text, /No extra task was queued/);
  assert.equal(h.effects.references.length, 0);
  assert.equal(h.effects.dispatch, 0);
});

test("an ambiguous named follow-up stays in chat instead of creating a third task", async () => {
  const h = host({ tasks: [
    { id: "one", title: "Search control", prompt: "Add keyboard search", status: "open" },
    { id: "two", title: "Search control", prompt: "Add project search", status: "open" },
  ], messages: [{ role: "assistant", text: 'Could work on "Search control" — say work on it.' }] });
  const before = h.board();
  const reply = await h.send("yes");
  assert.deepEqual(h.board(), before);
  assert.match(reply.text, /Several existing tasks.*Select the intended task card.*No extra task/);
  assert.equal(h.effects.references.length, 0);
});

test("questions stay in conversation even when existing work uses the same subject", async () => {
  const h = host({ tasks: [{ id: "saved", title: "Add search to the task board", status: "active" }] });
  for (const question of ["Can you explain search on the task board?", "Show me how search works", "Why is the search broken?", "How do I fix search?"]) {
    await h.send(question);
  }
  assert.equal(h.board().tasks.length, 1);
  assert.equal(h.effects.references.length, 0);
  assert.equal(h.effects.dispatch, 0);
  assert.deepEqual(h.effects.errors, []);
});

test("failed task admission cannot launch a fresh helper pass", async () => {
  const h = host();
  h.env.mutateBoard = async () => { throw new Error("fixture save failed"); };
  const reply = await h.send("Add search to the task board");
  assert.equal(h.board().tasks.length, 0);
  assert.equal(h.effects.references.length, 0);
  assert.equal(h.effects.dispatch, 0);
  assert.match(reply.text, /queue-request failed: fixture save failed/);
});

test("a failed refresh after saving still acknowledges the durable task", async () => {
  const h = host();
  h.env.refreshAutopilotQueue = async () => { throw new Error("fixture refresh failed"); };
  const reply = await h.send("Add search to the task board");
  assert.equal(h.board().tasks.length, 1);
  assert.equal(h.effects.references.length, 0);
  assert.equal(h.effects.dispatch, 1);
  assert.doesNotMatch(reply.text, /could not save|queue-request failed/);
  assert.match(h.effects.errors[0], /task saved; follow-up refresh failed/);
  await h.send("Please add search to the task board");
  assert.equal(h.board().tasks.length, 1);
  assert.equal(h.effects.references.length, 0);
});

test("a prose model reply still gets the actual reuse result from the local admission", async () => {
  const h = host({ tasks: [{ id: "saved", title: "Add search to the task board", status: "open" }] });
  Object.assign(h.env, {
    assistantAiUsable: () => true, assistantAiOk() {}, assistantAiFailed: assert.fail,
    assistantFetch: async (system, body) => {
      assert.match(system, /Never claim a new task or helper run when did reports reuse/);
      const payload = JSON.parse(body);
      // The model is asked first: the owner's words lead, nothing is done yet,
      // and the raw task rows never ride along (the board digest replaces them).
      assert.equal(payload.message, "Please add search to the task board");
      assert.deepEqual(payload.did, []);
      assert.equal(payload.facts?.tasks, undefined);
      // Prose, not the JSON envelope: the local classifier's admission stands in.
      return { ok: true, text: "Following the existing search task." };
    },
  });
  const reply = await h.send("Please add search to the task board");
  assert.match(reply.text, /Following the existing search task.*No extra task was queued/);
  assert.equal(h.effects.references.length, 0);
  assert.equal(h.board().tasks.length, 1);
  assert.deepEqual(h.effects.errors, []);
});

test("the model's differing reading of the same owner words never makes a second card", async () => {
  const h = host();
  const first = await h.env.assistantCreateTask({ title: "Login page", prompt: "add a login page", conversation: {},
    details: "Assistant's reading (not the owner's words): Build the login page with email and password." });
  const second = await h.env.assistantCreateTask({ title: "Login page", prompt: "add a login page", conversation: {},
    details: "Assistant's reading (not the owner's words): Create a sign-in screen." });
  assert.ok(first.created);
  assert.equal(second.created, null, "admission compares the owner's words, not the model's reading");
  assert.equal(second.existing?.item?.id, first.created.id);
  assert.equal(h.board().tasks.length, 1);
  assert.match(h.board().tasks[0].details, /Build the login page/, "the first reading stays on the card");
});

test("the local chat path titles a card with the admission cap, as the composer and the model do", async () => {
  const h = host();
  const text = "Add a keyboard accessible search field to the task board that filters cards by title, brief and source as you type";
  await h.send(text);
  const [card] = h.board().tasks;
  assert.ok(card, "the local classifier filed the work");
  assert.equal(workAdmission.TITLE_MAX, 90);
  assert.equal(card.title, text.slice(0, workAdmission.TITLE_MAX), "not the old 60-character clip");
  assert.equal(card.prompt, text, "the brief keeps the whole message");
});
