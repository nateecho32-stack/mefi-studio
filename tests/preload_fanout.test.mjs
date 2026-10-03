import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

// The real preload.cjs, with executeInMainWorld running its installer against
// a vm context that stands in for the page's window. A push is copied into the
// page once, however many on* subscribers a channel has, and eyes:assistant
// state keys the page already holds come back from its kept copies
// (scripts/assistant-push.cjs builds the host side). Board lists and the
// checkpoint store arrive as row deltas (scripts/row-push.cjs) and leave the
// bridge as whole plain lists again (mergeRows).

const require = createRequire(import.meta.url);
const { createAssistantPush } = require("../scripts/assistant-push.cjs");
const { createRowPush } = require("../scripts/row-push.cjs");
const preloadSource = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
// Objects built inside the vm have its prototypes; compare their content.
const plain = (value) => JSON.parse(JSON.stringify(value));

function page() {
  const listeners = [];
  const sent = [];
  const reported = [];
  const installed = {};
  const context = {
    reportError: (error) => reported.push(error),
    require: (name) => {
      assert.equal(name, "electron");
      return {
        contextBridge: { executeInMainWorld: ({ func, args }) => { installed.host = args[1]; return func(...args); } },
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
  return { bridge: context.mefiStudio, context, listeners, sent, reported, push, host: () => installed.host };
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
  assert.ok(!("rowsSync" in p.bridge), "so is the list resync");
  assert.equal(typeof p.bridge.taskProgress, "function");
  assert.equal(typeof p.bridge.onTaskProgress, "function");
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

// ---- board lists as row deltas (mergeRows) ----

const card = (id, extra = {}) => ({ id, title: `Card ${id}`, status: "open", ...extra });

test("board lists cross as row deltas, and every subscriber gets a new plain list reusing unchanged rows", () => {
  const p = page();
  const host = createRowPush({ start: 10 });
  const seen = [];
  p.bridge.onTasks((tasks) => seen.push(["a", tasks]));
  p.bridge.onTasks((tasks) => seen.push(["b", tasks]));
  assert.equal(p.listeners.filter((entry) => entry.channel === "eyes:tasks").length, 1);
  assert.equal(p.listeners.filter((entry) => entry.channel === "eyes:progress").length, 1, "progress is heard from the first task subscriber on");
  const first = [card("a"), card("b"), card("c")];
  p.push("eyes:tasks", host.payload(first, { projectId: "p" }));
  const [[, whole], [, shared]] = seen;
  assert.equal(whole, shared, "one list, shared by the subscribers");
  assert.ok(Array.isArray(whole));
  assert.deepEqual(plain(whole), first);

  const second = [card("a"), card("b", { status: "running" }), card("c")];
  const delta = host.payload(second, { projectId: "p" });
  assert.deepEqual(delta.upsert.map((row) => row.id), ["b"], "only the changed card crosses");
  p.push("eyes:tasks", delta);
  const next = seen.at(-1)[1];
  assert.equal(seen.at(-2)[1], next);
  assert.notEqual(next, whole, "a new list each push");
  assert.equal(next[0], whole[0], "an unchanged card is the object delivered before");
  assert.equal(next[2], whole[2]);
  assert.notEqual(next[1], whole[1]);
  assert.deepEqual(plain(next), second);
  assert.deepEqual(plain(whole), first, "the list delivered before is left as it was");

  const third = [card("d"), card("a"), card("c")];
  p.push("eyes:tasks", host.payload(third, { projectId: "p" }));
  assert.deepEqual(plain(seen.at(-1)[1]), third, "added at the front, one removed");
  assert.equal(seen.at(-1)[1][1], whole[0]);
  assert.deepEqual(p.sent, [], "nothing went missing, so nothing was asked for");
});

test("a list push the page cannot place is dropped, asked for once, and the whole list resumes the deltas", () => {
  const p = page();
  const host = createRowPush();
  const seen = [];
  p.bridge.onIdeas((ideas) => seen.push(ideas));
  host.payload([card("a")], { projectId: "p" }); // went out before this page listened (a reload)
  p.push("eyes:ideas", host.payload([card("a"), card("b")], { projectId: "p" }));
  assert.deepEqual(seen, [], "a delta without its base never reaches a subscriber");
  assert.deepEqual(p.sent, [["eyes:rows-sync", "eyes:ideas"]]);
  p.push("eyes:ideas", host.payload([card("a"), card("b"), card("c")], { projectId: "p" }));
  assert.deepEqual(seen, []);
  assert.equal(p.sent.length, 1, "asked once while the whole list is on its way");

  host.resync(); // main's eyes:rows-sync handler
  p.push("eyes:ideas", host.payload([card("a"), card("b"), card("c")], { projectId: "p" }));
  assert.deepEqual(plain(seen[0]), [card("a"), card("b"), card("c")]);
  p.push("eyes:ideas", host.payload([card("a"), card("c")], { projectId: "p" }));
  assert.deepEqual(plain(seen[1]), [card("a"), card("c")]);

  host.payload([card("c")], { projectId: "p" }); // lost on the way
  p.push("eyes:ideas", host.payload([card("c"), card("e")], { projectId: "p" }));
  assert.equal(seen.length, 2);
  assert.deepEqual(p.sent.slice(1), [["eyes:rows-sync", "eyes:ideas"]], "a gap asks again");
});

test("whole lists in the old shape (MEFI_STUDIO_FULL_PUSHES=1) reach subscribers as they came", () => {
  const p = page();
  const tasks = [];
  const requests = [];
  p.bridge.onTasks((list) => tasks.push(list));
  p.bridge.onRequests((list) => requests.push(list));
  p.push("eyes:tasks", [card("a")]);
  p.push("eyes:requests", [{ title: "No id", prompt: "x" }]);
  assert.deepEqual(plain(tasks), [[card("a")]]);
  assert.deepEqual(plain(requests), [[{ title: "No id", prompt: "x" }]]);
  // An inbox without ids travels whole from a row push too.
  const host = createRowPush();
  const inbox = [{ title: "One", prompt: "1" }, { title: "Two", prompt: "2" }];
  p.push("eyes:requests", host.payload(inbox, { projectId: "p" }));
  p.push("eyes:requests", host.payload(inbox.slice(1), { projectId: "p" }));
  assert.deepEqual(plain(requests.slice(1)), [inbox, inbox.slice(1)]);
  assert.deepEqual(p.sent, []);
});

test("the checkpoint store merges by key and reaches subscribers as a plain object", () => {
  const p = page();
  const host = createRowPush();
  const seen = [];
  p.bridge.onCheckpoints((store) => seen.push(store));
  const store = { s1: [{ note: "one", at: 1 }], s2: [{ note: "two", at: 2 }] };
  p.push("eyes:checkpoints", host.payload(store, { projectId: "p" }));
  const next = { s2: [{ note: "two again", at: 3 }, ...store.s2], s3: [{ note: "three", at: 4 }] };
  const delta = host.payload(next, { projectId: "p" });
  assert.deepEqual(Object.keys(delta.set), ["s2", "s3"]);
  assert.deepEqual(delta.del, ["s1"]);
  p.push("eyes:checkpoints", delta);
  assert.deepEqual(plain(seen[1]), next);
  assert.equal(Object.getPrototypeOf(seen[1]), Object.getPrototypeOf(seen[0]), "a plain object, like before");
  p.push("eyes:checkpoints", host.payload({ ...next, s4: [{ note: "four", at: 5 }] }, { projectId: "p" }));
  assert.equal(seen[2].s3, seen[1].s3, "an unchanged session's list is the one delivered before");
  assert.deepEqual(Object.keys(seen[2]), ["s2", "s3", "s4"]);
});

test("eyes:progress reaches onTaskProgress and taskProgress, and the next list lays it over its card as a copy", () => {
  const p = page();
  const host = createRowPush();
  const lists = [];
  const progress = [];
  p.bridge.onTasks((tasks) => lists.push(tasks));
  p.bridge.onTaskProgress((payload) => progress.push(payload));
  const started = { runId: "r1", at: 1, progress: 0.1 };
  let board = [card("a", { status: "active", runId: "r1", runProgress: started }), card("b")];
  p.push("eyes:tasks", host.payload(board, { projectId: "p" }));
  const delivered = lists[0][0];
  assert.equal(p.bridge.taskProgress("a"), null, "nothing pushed yet: callers read the row's own");

  const checkpoint = { runId: "r1", at: 5, progress: 0.5 };
  board = [{ ...board[0], runProgress: checkpoint }, board[1]];
  assert.equal(host.payload(board, { projectId: "p" }), null, "the checkpoint sends no list");
  p.push("eyes:progress", { projectId: "p", byTask: { a: checkpoint } });
  assert.deepEqual(plain(progress), [{ projectId: "p", byTask: { a: checkpoint } }]);
  assert.deepEqual(plain(p.bridge.taskProgress("a")), checkpoint);
  assert.equal(delivered.runProgress.progress, 0.1, "a delivered card is never edited");
  assert.equal(lists.length, 1, "progress alone rebuilds no list");

  board = [board[0], card("b", { status: "done" })];
  p.push("eyes:tasks", host.payload(board, { projectId: "p" }));
  const carried = lists[1][0];
  assert.notEqual(carried, delivered, "the card with newer progress is a copy");
  assert.deepEqual(plain(carried), board[0], "and matches the host's card");
  board = [board[0], card("b", { status: "archived" })];
  p.push("eyes:tasks", host.payload(board, { projectId: "p" }));
  assert.equal(lists[2][0], carried, "the copy is kept for the next lists");

  // The card itself changed: its row carries its own progress, as new.
  board = [{ ...board[0], title: "Renamed", runProgress: { runId: "r1", at: 6, progress: 0.6 } }, board[1]];
  p.push("eyes:tasks", host.payload(board, { projectId: "p" }));
  assert.equal(p.bridge.taskProgress("a"), null, "a row that caught up drops the pushed progress");
  assert.deepEqual(plain(lists[3][0]), board[0]);

  // A late checkpoint of an ended run is kept apart from the card.
  p.push("eyes:progress", { projectId: "p", byTask: { a: { runId: "r0", at: 9, progress: 1 } } });
  assert.equal(lists[3][0].runProgress.progress, 0.6);
  board = [{ ...board[0], status: "done", runId: undefined, runProgress: undefined }, board[1]];
  p.push("eyes:tasks", host.payload(board, { projectId: "p" }));
  assert.equal(p.bridge.taskProgress("a"), null, "a run the card no longer holds is forgotten");
  assert.equal(lists[4][0].runProgress, undefined);

  // Another project's progress is not this board's.
  p.push("eyes:progress", { projectId: "q", byTask: { b: { runId: "rb", at: 1 } } });
  assert.equal(p.bridge.taskProgress("b"), null);
  assert.equal(progress.length, 2);
});

test("progress that arrives before its card's claim waits for the card to hold that run", () => {
  const p = page();
  const host = createRowPush();
  const lists = [];
  p.bridge.onTasks((tasks) => lists.push(tasks));
  p.push("eyes:tasks", host.payload([card("a")], { projectId: "p" }));
  const checkpoint = { runId: "r1", at: 5, progress: 0.3 };
  p.push("eyes:progress", { projectId: "p", byTask: { a: checkpoint } }); // the claim's list is still coalescing
  assert.deepEqual(plain(p.bridge.taskProgress("a")), checkpoint);
  p.push("eyes:tasks", host.payload([card("a", { status: "active", runId: "r1", runProgress: { runId: "r1", at: 2, progress: 0 } })], { projectId: "p" }));
  assert.equal(lists[1][0].runProgress.progress, 0.3, "the claim's card shows the newer progress");
  assert.deepEqual(plain(p.bridge.taskProgress("a")), checkpoint);
});

// The real host module and the real bridge through structured clones, the way
// main.cjs sends them: a seeded walk of edits, checkpoints and switches. Every
// list a subscriber sees equals the host's board, progress included.
test("a long run of edits and checkpoints always delivers the host's board", () => {
  let seed = 11;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const p = page();
  const host = createRowPush({ start: 5000 });
  const lists = [];
  p.bridge.onTasks((tasks) => lists.push(tasks));
  let project = "p";
  let serial = 8;
  let board = Array.from({ length: serial }, (_, at) => card(`t${at}`, { runId: `r${at}`, runProgress: { runId: `r${at}`, at: 0 } }));
  const send = () => {
    const payload = host.payload(board, { projectId: project });
    if (payload) p.push("eyes:tasks", payload);
    return payload;
  };
  send();
  for (let step = 1; step < 500; step += 1) {
    const roll = random();
    const at = Math.floor(random() * board.length);
    if (roll < 0.4) {
      // A checkpoint: main sends eyes:progress, and the list carries nothing new.
      const row = board[at];
      const runProgress = { runId: row.runId, at: step, progress: random() };
      board = board.map((item, index) => (index === at ? { ...item, runProgress } : item));
      assert.equal(send(), null, `step ${step}: a checkpoint sent a list`);
      p.push("eyes:progress", { projectId: project, byTask: { [row.id]: runProgress } });
      continue;
    }
    if (roll < 0.6) board = board.map((item, index) => (index === at ? { ...item, title: `${item.title}+` } : item));
    else if (roll < 0.7) board = [card(`t${serial}`, { runId: `r${serial}`, runProgress: { runId: `r${serial++}`, at: step } }), ...board];
    else if (roll < 0.8 && board.length > 3) board = board.filter((_, index) => index !== at);
    else if (roll < 0.9) board = [board[at], ...board.filter((_, index) => index !== at)];
    else if (roll < 0.95) { project = project === "p" ? "q" : "p"; }
    else {
      // A push lost on the way (a reload): the page asks, main resyncs.
      host.payload([...board, card(`lost${step}`)], { projectId: project });
      const before = p.sent.length;
      board = board.map((item, index) => (index === at ? { ...item, status: `s${step}` } : item));
      send();
      assert.equal(p.sent.length, before + 1, `step ${step}: the gap asked for the list`);
      host.resync();
    }
    if (send()) assert.deepEqual(plain(lists.at(-1)), plain(board), `step ${step}`);
  }
  assert.ok(lists.length > 150, `${lists.length} lists delivered`);
});

test("the list resync request names only the four list channels", () => {
  const p = page();
  p.host().rowsSync("eyes:tasks");
  p.host().rowsSync("eyes:checkpoints");
  p.host().rowsSync("eyes:assistant");
  p.host().rowsSync("settings:changed");
  assert.deepEqual(p.sent, [["eyes:rows-sync", "eyes:tasks"], ["eyes:rows-sync", "eyes:checkpoints"]]);
});

test("main.cjs sends lists through sendRows and resends one whole on the page's request", () => {
  assert.match(mainSource, /window\.webContents\.ipc\.on\("eyes:rows-sync", \(_event, channel\) => resyncRows\(channel\)\);/);
  assert.match(preloadSource, /ipcRenderer\.send\("eyes:rows-sync", channel\)/);
  assert.match(preloadSource, /ipcRenderer\.on\("eyes:progress"/);
  assert.match(mainSource, /send\("eyes:progress", \{ projectId: project\?\.id \?\? null, byTask: patch\.progressOnly \}\);/);
  assert.match(mainSource, /const rowPushes = process\.env\.MEFI_STUDIO_FULL_PUSHES === "1" \? null/);
});
