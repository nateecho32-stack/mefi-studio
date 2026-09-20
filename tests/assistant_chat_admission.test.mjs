import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";
import chatWork from "../scripts/chat-work.cjs";

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
  const effects = { agents: 0, dispatch: 0, accepted: [], errors: [] };
  const state = { status: "paused", prefs: {}, messages: structuredClone(messages), agents: [],
    focus: focused ? { ...focused.target, label: focused.title } : null };
  const env = vm.createContext({
    Date, crypto, chatWork, setTimeout, clearTimeout, autopilot: { execute: false, jobs }, assistantState: state,
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
    assistantDispatchAgents: async () => { effects.agents++; return "helpers requested"; },
    assistantAiUsable: () => false,
    assistantAppendReply: (text) => { const reply = { role: "assistant", text }; state.messages.push(reply); return reply; },
    assistantNodeContext() {}, assistantLog() {}, saveAssistant: async () => {}, refreshAutopilotQueue: async () => {},
    jevShadowIntake: (rows) => effects.accepted.push(...rows), logError: (text) => effects.errors.push(text),
  });
  vm.runInContext([
    section("const ASSISTANT_CHAT_SYSTEM =", "// OpenCode Go requires"),
    section("async function assistantCreateTask(", "function executorProcessAlive("),
    section("async function assistantRespond(", "// A message is appended and pushed"),
  ].join("\n"), env);
  return { env, effects, state, board: () => structuredClone(board),
    send: (text) => env.assistantRespond({ id: crypto.randomUUID(), text }) };
}

test("rephrased chat work reuses its saved task without dispatching helpers again", async () => {
  const h = host();
  await h.send("Add search to the task board");
  const saved = h.board();
  const reply = await h.send("Please add search to the task board.");
  assert.deepEqual(h.board(), saved);
  assert.equal(h.effects.accepted.length, 1);
  assert.equal(h.effects.agents, 1);
  assert.equal(h.effects.dispatch, 1);
  assert.match(reply.text, /already queued.*No extra task was queued/);
  assert.doesNotMatch(reply.text, /put on the task board|roster goes out/);
  assert.deepEqual(h.effects.errors, []);
});

test("simultaneous chat sends check the current board inside the write lock", async () => {
  const h = host();
  await Promise.all(Array.from({ length: 8 }, (_, index) => h.send(index % 2 ? "Please add search to the task board." : "Add search to the task board")));
  assert.equal(h.board().tasks.length, 1);
  assert.equal(h.effects.agents, 1);
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
      assert.equal(h.effects.agents, 0);
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
  assert.equal(h.effects.agents, 0);
});

test("resolved yes and work on it reuse the saved task's full brief", async () => {
  for (const text of ["yes", "work on it"]) {
    const h = host({ tasks: [{ id: "saved", title: "Search the task board", prompt: "Add keyboard accessible search, with tests and an empty state.", status: "open" }],
      messages: [{ role: "assistant", text: 'Could work on "Search the task board" — say work on it.' }] });
    const before = h.board();
    const reply = await h.send(text);
    assert.deepEqual(h.board(), before);
    assert.match(reply.text, /No extra task was queued/);
    assert.equal(h.effects.agents, 0);
  }
});

test("different requirements sharing a truncated title remain separate work", async () => {
  const h = host();
  const prefix = "Add keyboard accessible search to the task board and display results ";
  await h.send(`${prefix}in a popup.`);
  await h.send(`${prefix}in the sidebar.`);
  assert.equal(h.board().tasks.length, 2);
  assert.equal(h.board().tasks[0].title, h.board().tasks[1].title);
  assert.notEqual(h.board().tasks[0].prompt, h.board().tasks[1].prompt);
});

test("a quoted focused title reuses its task identity when the user says work on it", async () => {
  const title = 'Add "Export" button';
  const h = host({ tasks: [{ id: "saved", title, prompt: "Export the full report as CSV and retain active filters.", status: "open" }],
    focused: { title, target: { kind: "task", id: "saved" } } });
  const before = h.board();
  const reply = await h.send("work on it");
  assert.deepEqual(h.board(), before);
  assert.match(reply.text, /No extra task was queued/);
  assert.equal(h.effects.agents, 0);
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
  assert.equal(h.effects.agents, 0);
});

test("questions stay in conversation even when existing work uses the same subject", async () => {
  const h = host({ tasks: [{ id: "saved", title: "Add search to the task board", status: "active" }] });
  for (const question of ["Can you explain search on the task board?", "Show me how search works", "Why is the search broken?", "How do I fix search?"]) {
    await h.send(question);
  }
  assert.equal(h.board().tasks.length, 1);
  assert.equal(h.effects.agents, 0);
  assert.equal(h.effects.dispatch, 0);
  assert.deepEqual(h.effects.errors, []);
});

test("failed task admission cannot launch a fresh helper pass", async () => {
  const h = host();
  h.env.mutateBoard = async () => { throw new Error("fixture save failed"); };
  const reply = await h.send("Add search to the task board");
  assert.equal(h.board().tasks.length, 0);
  assert.equal(h.effects.agents, 0);
  assert.equal(h.effects.dispatch, 0);
  assert.match(reply.text, /queue-request failed: fixture save failed/);
});

test("a failed refresh after saving still acknowledges the durable task", async () => {
  const h = host();
  h.env.refreshAutopilotQueue = async () => { throw new Error("fixture refresh failed"); };
  const reply = await h.send("Add search to the task board");
  assert.equal(h.board().tasks.length, 1);
  assert.equal(h.effects.agents, 1);
  assert.equal(h.effects.dispatch, 1);
  assert.doesNotMatch(reply.text, /could not save|queue-request failed/);
  assert.match(h.effects.errors[0], /task saved; follow-up refresh failed/);
  await h.send("Please add search to the task board");
  assert.equal(h.board().tasks.length, 1);
  assert.equal(h.effects.agents, 1);
});

test("AI replies receive the actual reuse result even when their board facts are stale", async () => {
  const h = host({ tasks: [{ id: "saved", title: "Add search to the task board", status: "open" }] });
  Object.assign(h.env, {
    assistantAiUsable: () => true, assistantAiOk() {}, assistantAiFailed: assert.fail,
    assistantFetch: async (system, body) => {
      assert.match(system, /Never claim a new task or helper run when did reports reuse/);
      const payload = JSON.parse(body);
      assert.deepEqual(payload.facts.tasks, []);
      assert.match(payload.did[0], /already queued.*No extra task was queued/);
      return { ok: true, text: "Following the existing search task." };
    },
  });
  const reply = await h.send("Please add search to the task board");
  assert.match(reply.text, /Following the existing search task.*No extra task was queued/);
  assert.equal(h.effects.agents, 0);
  assert.equal(h.board().tasks.length, 1);
  assert.deepEqual(h.effects.errors, []);
});
