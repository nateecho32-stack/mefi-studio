import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

// The real preload.cjs, with executeInMainWorld running its installer against
// a vm context that stands in for the page's window. A push is copied into the
// page once, however many on* subscribers a channel has, and eyes:assistant
// state keys the page already holds come back from its kept copies
// (scripts/assistant-push.cjs builds the host side).

const require = createRequire(import.meta.url);
const { createAssistantPush } = require("../scripts/assistant-push.cjs");
const preloadSource = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
// Objects built inside the vm have its prototypes; compare their content.
const plain = (value) => JSON.parse(JSON.stringify(value));

function page() {
  const listeners = [];
  const sent = [];
  const reported = [];
  const context = {
    reportError: (error) => reported.push(error),
    require: (name) => {
      assert.equal(name, "electron");
      return {
        contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) },
        ipcRenderer: {
          invoke: async (channel, ...args) => ({ channel, args }),
          on: (channel, listener) => listeners.push({ channel, listener }),
          send: (channel, ...args) => sent.push([channel, ...args]),
        },
        webUtils: {},
      };
    },
  };
  vm.runInNewContext(preloadSource, context);
  // What Electron does to a webContents.send payload before the listener sees it.
  const push = (channel, payload) => {
    for (const entry of listeners.filter((item) => item.channel === channel)) entry.listener({ sender: "ipc-event" }, structuredClone(payload));
  };
  return { bridge: context.mefiStudio, context, listeners, sent, reported, push };
}

test("each push channel gets one preload listener and every subscriber the same copy, in order", () => {
  const p = page();
  const seen = [];
  for (let index = 0; index < 7; index += 1) p.bridge.onTasks((tasks) => seen.push({ index, tasks }));
  p.bridge.onMachineStatus(() => {});
  p.bridge.onMachineStatus(() => {});
  assert.equal(p.listeners.filter((entry) => entry.channel === "eyes:tasks").length, 1);
  assert.equal(p.listeners.filter((entry) => entry.channel === "machine:status").length, 1);
  p.push("eyes:tasks", [{ id: "task_1", title: "One" }]);
  assert.deepEqual(seen.map((entry) => entry.index), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(seen.every((entry) => entry.tasks === seen[0].tasks), "one copy, shared");
  assert.deepEqual(plain(seen[0].tasks), [{ id: "task_1", title: "One" }]);
});

test("a subscriber that throws is reported and the ones after it still run", () => {
  const p = page();
  const seen = [];
  p.bridge.onIdeas(() => seen.push("first"));
  p.bridge.onIdeas(() => { throw new Error("paint failed"); });
  p.bridge.onIdeas(() => seen.push("third"));
  p.push("eyes:ideas", []);
  assert.deepEqual(seen, ["first", "third"]);
  assert.deepEqual(p.reported.map((error) => error.message), ["paint failed"]);
});

test("log lines still reach every subscriber one at a time, and a non-function subscribes nothing", () => {
  const p = page();
  const lines = [];
  p.bridge.onStudioLog((line) => lines.push(["a", line]));
  p.bridge.onStudioLog((line) => lines.push(["b", line]));
  p.bridge.onRequests(null);
  p.push("studio:log", ["one", "two"]);
  assert.deepEqual(lines, [["a", "one"], ["b", "one"], ["a", "two"], ["b", "two"]]);
  assert.equal(p.listeners.some((entry) => entry.channel === "eyes:requests"), false);
});

test("the page sees a frozen, read-only bridge whose calls still reach the preload", async () => {
  const p = page();
  const descriptor = Object.getOwnPropertyDescriptor(p.context, "mefiStudio");
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, false);
  assert.ok(Object.isFrozen(p.bridge));
  assert.deepEqual(JSON.parse(JSON.stringify(await p.bridge.tasksList())), { channel: "tasks:list", args: [] });
  assert.equal(typeof p.bridge.onAssistant, "function");
  assert.ok(!("assistantSync" in p.bridge), "the resync request is the bridge's own, not the page's");
});

function assistantState(overrides = {}) {
  return {
    status: "running",
    projectId: "project_a",
    tickCount: 1,
    messages: [{ role: "user", text: "hello", at: 1 }],
    log: [{ kind: "tick", text: "tick", at: 1 }],
    questions: [
      { id: "q1", status: "open", text: "First?" },
      { id: "q2", status: "open", text: "Second?" },
    ],
    thinking: null,
    ai: { online: true },
    ...overrides,
  };
}

test("eyes:assistant carries only changed keys once the page listens, and every subscriber still sees the whole state", () => {
  const p = page();
  const host = createAssistantPush({ start: 100 });
  const seen = [];
  p.bridge.onAssistant((payload) => seen.push(["a", payload]));
  p.bridge.onAssistant((payload) => seen.push(["b", payload]));
  assert.deepEqual(p.sent, [["eyes:assistant-sync"]], "the first subscriber asks for whole keys");
  assert.equal(p.listeners.filter((entry) => entry.channel === "eyes:assistant").length, 1);

  // Before the host hears the sync, a push is the whole state as before.
  const before = host.payload(assistantState(), { kind: "tick" });
  assert.equal(before.same, undefined);
  p.push("eyes:assistant", before);
  host.resync();

  let state = assistantState({ tickCount: 2 });
  const whole = host.payload(state, { kind: "tick" });
  assert.deepEqual(Object.keys(whole.same), [], "the first push after the sync carries every key");
  p.push("eyes:assistant", whole);

  state = assistantState({ tickCount: 3, thinking: { text: "planning", role: "thinker" } });
  const slim = host.payload(state, { kind: "think", text: "planning" });
  assert.deepEqual(Object.keys(slim.same).sort(), ["ai", "log", "messages", "questions"]);
  assert.equal(slim.state.messages, undefined, "an unchanged array does not cross");
  p.push("eyes:assistant", slim);

  const [a, b] = seen.slice(-2).map(([, payload]) => payload);
  assert.equal(a, b, "both subscribers get one merged copy");
  assert.deepEqual(plain(a), plain({ state, event: { kind: "think", text: "planning" } }), "the merged state equals the host's, and rev/same stay in the bridge");
  const previous = seen.at(-3)[1];
  assert.equal(a.state.messages, previous.state.messages, "an unchanged key is the kept object");
  assert.notEqual(a.state, previous.state, "the state object itself is new each push");

  // A question answered in place, mid-list: the list is the same length and
  // ends with the same entry, and still has to cross.
  state = assistantState({ tickCount: 4, questions: [{ id: "q1", status: "superseded", text: "First?" }, { id: "q2", status: "open", text: "Second?" }] });
  const edited = host.payload(state, { kind: "question", id: "q1" });
  assert.ok(edited.state.questions, "an in-place edit is found by content");
  p.push("eyes:assistant", edited);
  assert.deepEqual(plain(seen.at(-1)[1].state), plain(state));
  assert.deepEqual(p.sent, [["eyes:assistant-sync"]], "nothing went missing, so no second sync");
});

test("a push the page never got is covered by its kept copy once while whole keys are asked for again", () => {
  const p = page();
  const host = createAssistantPush({ start: 0 });
  const seen = [];
  p.bridge.onAssistant((payload) => seen.push(payload));
  host.resync();
  p.push("eyes:assistant", host.payload(assistantState(), { kind: "tick" }));

  // Dropped on the way (main.cjs send() skips pushes for a background project).
  const lost = assistantState({ messages: [...assistantState().messages, { role: "assistant", text: "hi", at: 2 }] });
  host.payload(lost, { kind: "message" });
  const next = host.payload({ ...lost, tickCount: 9 }, { kind: "tick" });
  assert.ok("messages" in next.same, "the host believes the page holds the lost messages");
  p.push("eyes:assistant", next);
  assert.equal(seen.length, 2, "delivered with the kept copy rather than dropped");
  assert.equal(seen[1].state.messages.length, 1, "the kept copy is one push old");
  assert.deepEqual(p.sent.slice(1), [["eyes:assistant-sync"]], "and whole keys are asked for");

  host.resync();
  p.push("eyes:assistant", host.payload({ ...lost, tickCount: 10 }, { kind: "tick" }));
  assert.deepEqual(plain(seen.at(-1).state), plain({ ...lost, tickCount: 10 }));
});

test("a page with nothing kept drops a push that refers to kept keys, and a project switch starts over whole", () => {
  const p = page();
  const host = createAssistantPush({ start: 0 });
  host.resync();
  host.payload(assistantState(), { kind: "tick" }); // went to the page before a reload
  const seen = [];
  p.bridge.onAssistant((payload) => seen.push(payload));
  p.push("eyes:assistant", host.payload(assistantState({ tickCount: 2 }), { kind: "tick" }));
  assert.deepEqual(seen, [], "a state with holes never reaches a subscriber");
  assert.equal(p.sent.length, 2, "the subscription's sync, then one for the gap");

  host.resync();
  p.push("eyes:assistant", host.payload(assistantState({ tickCount: 3 }), { kind: "tick" }));
  const other = assistantState({ projectId: "project_b", messages: [], tickCount: 1 });
  const switched = host.payload(other, { kind: "tick" });
  assert.deepEqual(Object.keys(switched.same), [], "another project's state crosses whole");
  p.push("eyes:assistant", switched);
  assert.deepEqual(plain(seen.at(-1).state), plain(other));
});

test("main.cjs builds eyes:assistant through assistantPush and resyncs on the page's request", () => {
  assert.match(mainSource, /send\("eyes:assistant", assistantPush\.payload\(assistantState, event\)\);/);
  assert.match(mainSource, /window\.webContents\.ipc\.on\("eyes:assistant-sync", \(\) => assistantPush\.resync\(\)\);/);
  assert.match(preloadSource, /ipcRenderer\.send\("eyes:assistant-sync"\)/);
});
