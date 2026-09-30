// Layout v2 gives Vibe's data a second reader. Today and the Inbox
// (renderer/today.js) read what vibe.js holds through MefiVibe.data() and
// watch() while the front door itself is not up, Today draws the front door's
// own pieces through enter() and exit(), and a decision raised anywhere opens in
// the Inbox. Every one of those is a no-op when nobody asks, which is what keeps
// Vibe as it was in v1. renderer/vibe.js runs against the shared fake DOM and a
// stand-in desktop bridge, as in vibe_home.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom, templateIds } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/vibe.js", import.meta.url), "utf8");
const P = "p1";
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let turn = 0; turn < 12; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };

const QUESTION = { id: "q1", status: "open", title: "Should #Work and #work count as the same tag?", at: 1, context: { taskId: "t1", taskTitle: "Search notes by tag" }, options: [{ id: "yes", label: "Yes, ignore case", recommended: true }, { id: "no", label: "Keep them separate" }] };

async function load({ mefiToday, needsYou = null } = {}) {
  const calls = { backlog: 0, list: 0 };
  const subscribers = {};
  const tasks = [{ id: "t1", projectId: P, title: "Search notes by tag", status: "active" }, { id: "t2", projectId: P, title: "Fix the login redirect loop", status: "awaiting_verification" }];
  const assistant = { projectId: P, status: "running", questions: [QUESTION], messages: [], ai: { keyPresent: true }, ...(needsYou ? { needsYou } : {}) };
  const api = {
    projectsList: async () => { calls.list += 1; return { projects: [{ id: P, name: "Sunrise" }], activeId: P }; },
    tasksList: async () => ({ ok: true, projectId: P, tasks }),
    assistantState: async () => ({ ok: true, state: assistant }),
    assistantStatus: async () => ({ ok: true, status: { held: false, execute: true, running: [] } }),
    backlogStatus: async () => { calls.backlog += 1; return { ok: true, projectId: P, counts: {}, next: [], approval: [], blocked: [] }; },
    planningList: async () => ({ ok: true, projectId: P, plans: [] }),
    ...Object.fromEntries(["onIdeas", "onProjects", "onTasks", "onAssistant", "onAssistantStatus"].map((name) => [name, (callback) => { (subscribers[name] ||= []).push(callback); }])),
  };
  const events = {};
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("vibe-")) });
  const lookup = document.getElementById;
  document.getElementById = (id) => lookup(id) ?? document.querySelector(`#${id}`);
  document.documentElement.dataset = {};
  for (const id of ["vibe-layer", "vibe-ask", "vibe-gate", "vibe-chat", "vibe-panel", "vibe-notes"]) get(id).hidden = true;
  const timers = [];
  const window = {
    addEventListener(name, callback) { (events[name] ||= []).push(callback); }, dispatchEvent(event) { for (const callback of events[event.type] || []) callback(event); return true; },
    location: { search: "" }, mefiStudio: api,
    MefiNav: { register() {}, current: () => "vibe", go() {}, state: { sheet: null, transient: null } },
    ...(mefiToday ? { MefiToday: mefiToday } : {}),
  };
  const context = vm.createContext({
    window, document, console, location: { search: "" },
    localStorage: { getItem: () => null, setItem() {}, length: 0, key: () => null },
    requestAnimationFrame: () => 0, setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout() {},
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  });
  vm.runInContext(source, context);
  const push = (name, payload) => { for (const callback of subscribers[name] || []) callback(payload); };
  const fireTimers = async () => { while (timers.length) { await timers.shift()(); } await settle(); };
  return { window, get, calls, push, subscribers, fireTimers, tasks, assistant, document };
}

test("with nobody watching, Vibe reads nothing while it is not up", async () => {
  const loaded = await load();
  assert.equal(loaded.calls.list, 0, "loading the script asks the host for nothing");
  assert.deepEqual(Object.keys(loaded.subscribers), [], "and subscribes to nothing until the front door first opens");
  await loaded.window.MefiVibe.enter(); await settle();
  assert.equal(loaded.calls.list, 1, "the front door reads once when it opens, as it always did");
  assert.deepEqual(Object.keys(loaded.subscribers).sort(), ["onAssistant", "onAssistantStatus", "onIdeas", "onProjects", "onTasks"], "init wires the same five pushes");
  loaded.window.MefiVibe.exit();
  loaded.calls.backlog = 0;
  loaded.push("onTasks", [{ id: "t9", projectId: P, title: "A new task", status: "open" }]);
  await loaded.fireTimers();
  assert.equal(loaded.calls.backlog, 0, "a push while Vibe is away costs no backlog read: v1's rule");
  assert.equal(loaded.window.MefiVibe.data().tasks.length, 1, "but the state still follows the push, as it did");
});

test("data() is the picture the panels get, and moves with the pushes", async () => {
  const loaded = await load({ needsYou: { items: [{ kind: "question", id: "q1", title: QUESTION.title }], counts: { total: 1, question: 1 } } });
  assert.deepEqual(plain(loaded.window.MefiVibe.data()).needs, [], "nothing is known before the first read");
  const off = loaded.window.MefiVibe.watch(() => {});
  await settle();
  const picture = plain(loaded.window.MefiVibe.data());
  assert.equal(picture.projectId, P);
  assert.equal(picture.projectName, "Sunrise");
  assert.deepEqual(picture.needs.map((need) => `${need.kind}:${need.id}`), ["question:q1"]);
  assert.deepEqual(picture.checking.map((task) => task.id), ["t2"], "a finished attempt still being checked");
  assert.ok(Array.isArray(picture.running) && Array.isArray(picture.families) && Array.isArray(picture.plans), "the same keys the panels read");
  off();
});

test("watch() starts the reads once, tells a burst of pushes once, and stops when asked", async () => {
  const loaded = await load();
  const told = [];
  const off = loaded.window.MefiVibe.watch(() => told.push("a"));
  const second = loaded.window.MefiVibe.watch(() => told.push("b"));
  await settle();
  assert.equal(loaded.calls.list, 1, "the first watcher starts one read, the second none");
  assert.deepEqual(told.sort(), ["a", "b"], "both readers are told when the read lands");
  assert.deepEqual(Object.keys(loaded.subscribers).sort(), ["onAssistant", "onAssistantStatus", "onIdeas", "onProjects", "onTasks"], "the pushes are wired without the front door ever opening");
  assert.equal(loaded.get("vibe-layer").hidden, true, "and the front door stayed shut");
  told.length = 0;
  loaded.calls.backlog = 0;
  loaded.push("onTasks", [{ id: "t1", projectId: P, title: "Search notes by tag", status: "active" }]);
  loaded.push("onAssistant", { state: { ...loaded.assistant, questions: [] } });
  loaded.push("onAssistantStatus", { held: false, execute: true, running: [{ taskId: "t1", title: "Search notes by tag" }] });
  await settle();
  assert.deepEqual(told.sort(), ["a", "b"], "three pushes in a turn are one telling each");
  assert.equal(loaded.window.MefiVibe.data().running.length, 1);
  assert.equal(loaded.window.MefiVibe.data().needs.length, 0, "the answered question left");
  await loaded.fireTimers();
  assert.equal(loaded.calls.backlog, 1, "a watcher keeps the backlog (approvals, stuck work) read after a push, once for the burst");
  second();
  told.length = 0;
  loaded.push("onTasks", [{ id: "t3", projectId: P, title: "Another", status: "open" }]);
  await settle();
  assert.deepEqual(told, ["a"], "a reader that went is not told");
  off();
  told.length = 0;
  loaded.push("onTasks", []);
  await settle();
  assert.deepEqual(told, [], "and nobody is told when nobody reads");
  assert.equal(loaded.window.MefiVibe.watch("not a function")(), undefined, "a bad watcher is ignored, its off switch is harmless");
});

test("a watcher that throws never stops another", async () => {
  const loaded = await load();
  const told = [];
  loaded.window.MefiVibe.watch(() => { throw new Error("boom"); });
  loaded.window.MefiVibe.watch(() => told.push("ok"));
  await settle();
  assert.deepEqual(told, ["ok"]);
});

test("entering and leaving the front door tell Today, and a need raised anywhere opens where Today says", async () => {
  const seen = [];
  let claims = false;
  const loaded = await load({ mefiToday: { show: () => seen.push("show"), hide: () => seen.push("hide"), openNeed: (ref) => { seen.push(["need", plain(ref)]); return claims; } } });
  await loaded.window.MefiVibe.enter(); await settle();
  assert.deepEqual(seen, ["show"], "Today draws its page once the layer is up");
  loaded.window.MefiVibe.openNeed({ kind: "question", id: "q1" });
  assert.equal(loaded.get("vibe-ask").hidden, false, "Today not claiming it leaves Vibe's own drawer, as in v1");
  loaded.window.MefiVibe.exit();
  assert.deepEqual(seen.filter((entry) => typeof entry === "string"), ["show", "hide"]);
  claims = true;
  await loaded.window.MefiVibe.enter(); await settle();
  loaded.get("vibe-ask").hidden = true;
  assert.equal(loaded.window.MefiVibe.openNeed("q1"), true, "a string is a question's id");
  assert.deepEqual(seen.filter((entry) => Array.isArray(entry)).at(-1), ["need", { kind: "question", id: "q1" }], "the Inbox is asked for that question");
  assert.equal(loaded.get("vibe-ask").hidden, true, "and the v1 drawer stays shut");
});

test("without Today in the page (v1), Vibe's enter and exit and openNeed are what they always were", async () => {
  const loaded = await load();
  await loaded.window.MefiVibe.enter(); await settle();
  assert.equal(loaded.window.MefiToday, undefined);
  assert.equal(loaded.window.MefiVibe.isActive(), true);
  loaded.window.MefiVibe.openNeed({ kind: "question", id: "q1" });
  assert.equal(loaded.get("vibe-ask").hidden, false);
  loaded.window.MefiVibe.exit();
  assert.equal(loaded.window.MefiVibe.isActive(), false);
});
