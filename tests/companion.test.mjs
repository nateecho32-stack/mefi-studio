// The roaming companion (renderer/companion.js): its pure rules — which of the
// agents' requests it may settle for you, when it works queued requests, what
// it says about a change, how it reads a typed request and where it stands —
// and the character itself against the shared fake DOM, with a stand-in for
// the workspace's snapshot and actions (MefiWorkspace.companion).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { createDom } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/companion.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
// Values made inside the vm context carry its prototypes; compare them as data.
const plain = (value) => JSON.parse(JSON.stringify(value));

const retry = (id, taskId, extra = {}) => ({ id, status: "open", source: "issue", title: `Task ${taskId} stopped`, context: { issueKind: "run-failed", taskId },
  options: [{ id: "retry", label: "Try again", recommended: true, action: { kind: "issue", action: "retry", payload: { taskId } } }, { id: "hold", label: "Leave it for review", dismiss: true }], ...extra });
const permission = (id, taskId) => ({ id, status: "open", source: "issue", title: `Task ${taskId} wants network`, context: { issueKind: "permission", taskId },
  options: [{ id: "grant", label: "Grant it", action: { kind: "issue", action: "grant" } }, { id: "deny", label: "Keep it out of scope", recommended: true, action: { kind: "issue", action: "narrow" } }] });
const offer = (id) => ({ id, status: "open", source: "offer", kind: "suggestion", title: "Pick the next piece of work",
  options: [{ id: "offer_1", label: "Work on \"Docs\"", reply: "work on \"Docs\"", recommended: true }, { id: "not_now", label: "Not now", dismiss: true }] });

function snapshot(overrides = {}) {
  return {
    projectId: "p1", projectName: "Demo", desktop: true, name: "Mefi", person: "", headline: "Mefi is here", narration: "Tell me what you have in mind.",
    station: "listen", busy: false, pending: false, switching: false,
    run: { label: "Ready", note: "", tone: "ok", held: false, launchHold: false },
    paused: false, admissionOff: false, autoBuild: true, keyMissing: false,
    running: [], questions: [], review: { total: 0, approvals: 0, blocked: 0, checks: 0, first: "" },
    next: null, ready: 0, backlog: { draining: false, paused: false }, reply: null,
    ...overrides,
  };
}

async function environment({ snap = snapshot(), bridge = {}, storage = {}, motion = "on", current = "workspace", reach = {} } = {}) {
  const dom = createDom({ ids: ["companion-mode", "companion-auto", "workspace-motion", "workspace-companion-perch"] });
  dom.document.readyState = "complete";
  dom.documentElement.dataset.motion = motion;
  dom.get("companion-mode").value = "roam";
  // Past the first-run greeting, which has its own test.
  const store = new Map(Object.entries({ "mefiStudio.companion.greeted": "1", ...storage }));
  const timers = [];
  const listeners = {};
  const calls = { nav: [], control: [], ask: [], task: [], answers: [], show: [] };
  const registered = [];
  let snap$ = snap;
  const workspaceReach = {
    snapshot: () => snap$,
    control: async (action) => { calls.control.push(action); return { ok: true, message: `did ${action}` }; },
    ask: async (text) => { calls.ask.push(text); return { ok: true, reply: `Reply to ${text}` }; },
    createTask: async (text) => { calls.task.push(text); return { ok: true, message: "Task added to the queue." }; },
    showWork: (filter) => calls.show.push(filter),
    ...reach,
  };
  const window = {
    innerWidth: 1440, innerHeight: 900,
    addEventListener(name, fn) { (listeners[name] ??= []).push(fn); },
    dispatchEvent(event) { for (const fn of listeners[event.type] ?? []) fn(event); return true; },
    mefiStudio: { assistantAnswer: async (payload) => { calls.answers.push(payload); return { ok: true }; }, eyesRequestsRead: async () => ({ ok: true, requests: [] }), ...bridge },
    MefiNav: {
      go: (id, params) => calls.nav.push([id, params ?? {}]),
      get: (id) => ({ id, label: { studio: "Settings", tasks: "Task board" }[id] ?? id }),
      list: () => [{ id: "tasks", label: "Task board", short: "Tasks" }, { id: "studio", label: "Settings", short: "Settings" }],
      current: () => current,
      register: (dest) => registered.push(dest),
      state: { transient: null },
    },
    MefiWorkspace: { isActive: () => current === "workspace", companion: workspaceReach },
    MefiBoot: { isActive: () => false },
    MefiIdle: { isActive: () => current === "command" },
  };
  const context = vm.createContext({
    window, document: dom.document, console, Promise, JSON, Math, Date,
    localStorage: { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  });
  // The module runs its own init when the document is ready, as in the bundle.
  vm.runInContext(source, context);
  await flush();
  const root = dom.body.querySelector(".companion");
  // Run the timers that are due now (not the ones they arm), `rounds` times.
  const tick = async (rounds = 1, { upTo = Infinity } = {}) => {
    for (let round = 0; round < rounds; round += 1) {
      const due = timers.filter((timer) => timer.live && timer.ms <= upTo);
      for (const timer of due) { timer.live = false; timer.fn(); }
      await flush();
    }
  };
  const publish = (next) => { snap$ = next; window.dispatchEvent(new context.CustomEvent("mefi:companion-state", { detail: next })); };
  return { window, dom, store, calls, registered, root, tick, publish, companion: window.MefiCompanion, rules: window.MefiCompanion.rules, el: (selector) => root.querySelector(selector) };
}

// ---- rules -----------------------------------------------------------------

test("it answers only a recommended choice that re-arms or narrows the same task", async () => {
  const { rules } = await environment();
  const now = 1_000_000_000;
  assert.deepEqual({ ...rules.autoAnswer(retry("q1", "t1"), { now }) }, { optionId: "retry", label: "Try again", taskId: "t1" });
  const narrow = retry("q2", "t2", { context: { issueKind: "scope", taskId: "t2" }, options: [{ id: "narrow", label: "Keep to the brief", recommended: true, action: { kind: "issue", action: "narrow" } }] });
  assert.equal(rules.autoAnswer(narrow, { now }).optionId, "narrow");
  const deep = retry("q3", "t3", { options: [{ id: "retry-deep", label: "Try again with a heavier model", recommended: true, action: { kind: "issue", action: "retry-deep" } }] });
  assert.equal(rules.autoAnswer(deep, { now }).optionId, "retry-deep");
  assert.equal(rules.autoAnswer(offer("q4"), { now }).optionId, "offer_1", "the assistant's suggested next task is a routine yes");
});

test("it never grants access, accepts a risk, picks a duplicate or speaks for you", async () => {
  const { rules } = await environment();
  const skip = (question) => { const pick = rules.autoAnswer(question); assert.equal(pick.optionId, undefined, JSON.stringify(question)); assert.ok(pick.skip); };
  skip(permission("q1", "t1"));
  skip(retry("q2", "t2", { context: { issueKind: "risk", taskId: "t2" } }));
  skip(retry("q3", "t3", { source: "family" }));
  skip(retry("q4", "t4", { options: [{ id: "grant", label: "Grant it", recommended: true, action: { kind: "issue", action: "grant" } }] }));
  skip(retry("q5", "t5", { options: [{ id: "proceed", label: "Go ahead", recommended: true, action: { kind: "issue", action: "proceed" } }] }));
  skip(retry("q6", "t6", { options: [{ id: "acknowledge", label: "I'll take care of it", recommended: true, action: { kind: "issue", action: "acknowledge" } }] }));
  skip(retry("q7", "t7", { options: [{ id: "instruct", label: "Answer it in one line", recommended: true, text: true, action: { kind: "issue", action: "instruct" } }] }));
  skip(retry("q8", "t8", { options: [{ id: "hold", label: "Leave it for review", recommended: true, dismiss: true }] }));
  skip(retry("q9", "t9", { options: [{ id: "a", label: "Maybe" }] }));
  skip({ ...retry("q10", "t10"), status: "answered" });
  skip({ id: "q11", status: "open", source: "assistant", title: "Anything", options: [{ id: "yes", label: "Yes", reply: "yes", recommended: true }] });
});

test("a task gets one answer from it a day, so a failing loop comes back to you", async () => {
  const { rules } = await environment();
  const now = Date.UTC(2026, 8, 24, 12);
  const hour = 60 * 60 * 1000;
  assert.ok(rules.autoAnswer(retry("q1", "t1"), { answered: { t1: now - 2 * hour }, now }).skip);
  assert.equal(rules.autoAnswer(retry("q1", "t1"), { answered: { t1: now - 25 * hour }, now }).optionId, "retry");
  assert.equal(rules.autoAnswer(retry("q1", "t1"), { answered: { t2: now }, now }).optionId, "retry");
});

test("queued requests are worked only while new work may start, after the host had its turn", async () => {
  const { rules } = await environment();
  const now = 10_000_000;
  const settled = { waiting: 2, waitingSince: now - 3 * 60 * 1000, lastRun: 0, now };
  assert.equal(rules.shouldWorkRequests(snapshot(), settled), true);
  assert.equal(rules.shouldWorkRequests(snapshot(), { ...settled, waiting: 0 }), false);
  assert.equal(rules.shouldWorkRequests(snapshot(), { ...settled, waitingSince: now - 30 * 1000 }), false, "the host promotes on its own ticks first");
  assert.equal(rules.shouldWorkRequests(snapshot(), { ...settled, lastRun: now - 5 * 60 * 1000 }), false, "not again for a while");
  assert.equal(rules.shouldWorkRequests(snapshot({ running: [{ title: "x" }] }), settled), false);
  assert.equal(rules.shouldWorkRequests(snapshot({ backlog: { draining: true, paused: false } }), settled), false, "the backlog is already being worked");
  for (const run of [{ held: true, launchHold: false }, { held: false, launchHold: true }]) {
    assert.equal(rules.shouldWorkRequests(snapshot({ run: { ...snapshot().run, ...run } }), { ...settled, explicit: true }), false, "a pause or the launch hold is never overridden");
  }
  assert.equal(rules.shouldWorkRequests(snapshot({ running: [{ title: "x" }] }), { ...settled, waitingSince: now, explicit: true }), true, "asking skips the waits");
});

test("notices name what changed and leave out the cards it is about to settle", async () => {
  const { rules } = await environment();
  const base = snapshot();
  const handles = (question) => question.id === "routine";
  const asked = rules.notices(base, snapshot({ questions: [retry("routine", "t1"), permission("yours", "t2")] }), { handles });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].id, "ask:yours");
  assert.equal(asked[0].priority, 3);
  assert.match(asked[0].text, /needs your answer/);
  assert.equal(rules.notices(base, snapshot({ questions: [retry("routine", "t1")] }), { handles }).length, 0, "a routine card is announced when it is settled");
  const approval = rules.notices(base, snapshot({ review: { total: 1, approvals: 1, blocked: 0, checks: 0, first: "Pause menu" } }));
  assert.match(approval[0].text, /approval/);
  assert.equal(approval[0].actions[0].do, "open-review");
  const started = rules.notices(base, snapshot({ running: [{ title: "Pause menu", taskId: "t1" }] }));
  assert.match(started[0].text, /started on “Pause menu”/);
  const finished = rules.notices(snapshot({ running: [{ title: "Pause menu", taskId: "t1" }] }), snapshot({ review: { total: 1, approvals: 0, blocked: 0, checks: 1, first: "" } }));
  assert.ok(finished.some((notice) => notice.id === "finished"));
  assert.ok(finished.some((notice) => notice.id === "idle" && /Review/.test(notice.text)));
  const held = rules.notices(base, snapshot({ run: { ...base.run, held: true } }));
  assert.equal(held[0].actions[0].do, "resume");
  const reply = rules.notices(base, snapshot({ reply: { id: "m2", at: 5, text: "Here is the plan." } }));
  assert.equal(reply[0].kind, "reply");
  const first = rules.notices(null, snapshot({ person: "Sam", run: { ...base.run, launchHold: true } }));
  assert.equal(first[0].id, "launch-hold");
  assert.match(first[0].text, /waiting for you, Sam/);
  assert.equal(rules.notices(base, base).length, 0, "nothing changed, nothing said");
});

test("typed requests are read the way a person means them", async () => {
  const { rules } = await environment();
  const destinations = [{ id: "tasks", label: "Task board", short: "Tasks" }, { id: "profiler", label: "Performance profiler", short: "Profiler" }];
  const read = (text) => rules.intent(text, { destinations });
  assert.deepEqual({ ...read("pause") }, { kind: "control", action: "pause" });
  assert.deepEqual({ ...read("Mefi, please resume!") }, { kind: "control", action: "resume" });
  assert.deepEqual({ ...read("start agents") }, { kind: "control", action: "resume" });
  assert.deepEqual({ ...read("stop all the agents") }, { kind: "control", action: "stop-all" });
  for (const text of ["handle the requests", "answer them", "handle it", "work through the backlog", "take care of the questions"]) assert.equal(read(text).kind, "handle", text);
  assert.equal(read("what's waiting?").kind, "status");
  assert.deepEqual({ ...read("open settings") }, { kind: "nav", id: "studio" });
  assert.deepEqual({ ...read("take me to the task board") }, { kind: "nav", id: "tasks" });
  assert.deepEqual({ ...read("go to command view") }, { kind: "nav", id: "command" });
  assert.deepEqual({ ...read("open performance profiler") }, { kind: "nav", id: "profiler" });
  assert.deepEqual({ ...read("show me the review") }, { kind: "action", do: "open-review" });
  assert.deepEqual({ ...read("open requests") }, { kind: "action", do: "open-ask" });
  assert.deepEqual({ ...read("Make a task to add a pause menu") }, { kind: "task", text: "add a pause menu" });
  assert.deepEqual({ ...read("task: write the docs") }, { kind: "task", text: "write the docs" });
  assert.deepEqual({ ...read("stay here") }, { kind: "companion", action: "stay" });
  assert.deepEqual({ ...read("go away") }, { kind: "companion", action: "hidden" });
  assert.deepEqual({ ...read("be quiet") }, { kind: "companion", action: "quiet" });
  assert.deepEqual({ ...read("open a folder on my desktop") }, { kind: "chat", text: "open a folder on my desktop" }, "an unknown page is a question, not a jump");
  assert.equal(read("mefistudio keeps crashing").kind, "chat", "the name prefix is a whole word");
  assert.equal(read("Why did the save-slot fix fail?").kind, "chat");
});

test("it stands on a thing's corner, inside the window and clear of the rail", async () => {
  const { rules } = await environment();
  const view = { width: 1440, height: 900 };
  const inset = { left: 70, top: 12, right: 14, bottom: 14 };
  const spot = rules.besideRect({ left: 540, right: 746, top: 286, bottom: 378, width: 206, height: 92 }, view, 52, inset);
  assert.ok(spot.x > 540 && spot.x + 52 > 746 - 52, "at the right-hand corner");
  assert.ok(spot.y < 286, "above the top edge, not over its words");
  const top = rules.besideRect({ left: 900, right: 1100, top: 4, bottom: 60, width: 200, height: 56 }, view, 52, inset);
  assert.ok(top.y > 4, "no room above: the bottom corner");
  const corner = rules.besideRect({ left: 1400, right: 1440, top: 880, bottom: 900, width: 40, height: 20 }, view, 52, inset);
  assert.ok(corner.x + 52 <= 1440 - 14 && corner.y + 52 <= 900 - 14);
  assert.deepEqual(plain(rules.clampSpot({ x: -40, y: 5000 }, view, 52, inset)), { x: 70, y: 834 });
});

// ---- the character -----------------------------------------------------------

test("it handles the routine request itself and leaves yours, once per card", async () => {
  const snap = snapshot({ questions: [retry("q1", "t1"), permission("q2", "t2")] });
  const env = await environment({ snap });
  assert.equal(env.companion.willHandle(snap.questions[0]), true);
  assert.equal(env.companion.willHandle(snap.questions[1]), false, "nav.js still toasts this one");
  const summary = await env.companion.handleNow({ explicit: true });
  assert.deepEqual(plain(env.calls.answers), [{ id: "q1", optionId: "retry" }]);
  assert.match(summary, /^I chose Try again for Task t1 stopped\.$/);
  assert.ok(JSON.parse(env.store.get("mefiStudio.companion.answered")).t1 > 0, "the task's answer is remembered");
  await env.companion.handleNow({ explicit: true });
  assert.equal(env.calls.answers.length, 1, "a card is tried once");
  assert.equal(env.el(".companion-count").textContent, "1", "the badge counts what waits for you");
});

test("a pause or the launch hold stops it handling anything, and says so when asked", async () => {
  for (const run of [{ held: true }, { launchHold: true }]) {
    const snap = snapshot({ run: { ...snapshot().run, ...run }, questions: [retry("q1", "t1")] });
    const env = await environment({ snap });
    assert.equal(env.companion.willHandle(snap.questions[0]), false);
    const summary = await env.companion.handleNow({ explicit: true });
    assert.equal(env.calls.answers.length, 0);
    assert.match(summary, run.held ? /on hold/ : /waiting for Start/);
  }
});

test("turned off, it answers nothing on its own and the Settings switch follows", async () => {
  const snap = snapshot({ questions: [retry("q1", "t1")] });
  const env = await environment({ snap, storage: { "mefiStudio.companion.auto": "off" } });
  assert.equal(env.dom.get("companion-auto").checked, false);
  assert.equal(env.companion.willHandle(snap.questions[0]), false);
  await env.tick(3);
  assert.equal(env.calls.answers.length, 0);
  env.dom.get("companion-auto").checked = true;
  await env.dom.get("companion-auto").trigger("change");
  await env.tick(1, { upTo: 1000 });
  await flush();
  assert.deepEqual(plain(env.calls.answers), [{ id: "q1", optionId: "retry" }], "switching it on handles what is waiting");
});

test("queued inbox requests are worked through once they have waited", async () => {
  const requests = [{ title: "Tidy the assets", status: "open", at: 1 }];
  const env = await environment({ bridge: { eyesRequestsRead: async () => ({ ok: true, requests }) } });
  await flush();
  const explicit = await env.companion.handleNow({ explicit: true });
  assert.deepEqual(env.calls.control, ["run-backlog"]);
  assert.match(explicit, /started working through 1 waiting request/);
  await env.companion.handleNow();
  assert.deepEqual(env.calls.control, ["run-backlog"], "not again straight away");
});

test("talking to it: pages, controls, tasks and questions for the assistant", async () => {
  const env = await environment();
  env.companion.open();
  assert.equal(env.el(".companion-panel").hidden, false);
  const say = async (text) => { env.el(".companion-input").value = text; await env.el(".companion-form").trigger("submit"); await flush(); };
  await say("open settings");
  assert.deepEqual(env.calls.nav.at(-1), ["studio", {}]);
  env.companion.open();
  await say("pause");
  assert.deepEqual(env.calls.control, ["pause"]);
  await say("make a task to write the docs");
  assert.deepEqual(env.calls.task, ["write the docs"]);
  await say("How is the save-slot fix going?");
  assert.deepEqual(env.calls.ask, ["How is the save-slot fix going?"]);
  const lines = env.dom.body.querySelectorAll(".companion-line").map((line) => line.textContent);
  assert.ok(lines.some((line) => line.includes("did pause")));
  assert.ok(lines.some((line) => line.includes("Task added to the queue.")));
  assert.ok(lines.some((line) => line.includes("Reply to How is the save-slot fix going?")));
  assert.equal(env.el(".companion-input").value, "");
});

test("the panel offers what the moment needs", async () => {
  const snap = snapshot({ run: { ...snapshot().run, launchHold: true, label: "Waiting for you" }, questions: [permission("q2", "t2")], review: { total: 2, approvals: 1, blocked: 0, checks: 1, first: "" } });
  const env = await environment({ snap });
  env.companion.open();
  const labels = env.el(".companion-actions").children.map((button) => button.textContent);
  assert.equal(labels[0], "Start agents");
  assert.ok(labels.includes("Answer 1 question"));
  assert.ok(labels.includes("Review 2"));
  assert.ok(!labels.includes("Handle requests now"), "nothing is handled during the launch hold");
  await env.el(".companion-actions").children[0].click();
  await flush();
  assert.deepEqual(env.calls.control, ["start"]);
});

test("hidden, stay and roam persist, the Settings select follows, and J brings it back", async () => {
  const env = await environment();
  env.companion.setMode("hidden");
  assert.equal(env.root.hidden, true);
  assert.equal(env.store.get("mefiStudio.companion.mode"), "hidden");
  assert.equal(env.dom.get("companion-mode").value, "hidden");
  const action = env.registered.find((dest) => dest.id === "companion");
  assert.equal(action.key, "J");
  assert.equal(action.kind, "action");
  action.run();
  assert.equal(env.root.hidden, false);
  assert.equal(env.companion.state().mode, "roam");
  assert.equal(env.companion.state().panel, true);
  env.dom.get("companion-mode").value = "stay";
  await env.dom.get("companion-mode").trigger("change");
  assert.equal(env.companion.state().mode, "stay");
  assert.ok(env.store.get("mefiStudio.companion.spot"), "staying remembers the spot");
});

test("dragging it somewhere means stay there", async () => {
  const env = await environment();
  const body = env.el(".companion-body");
  const from = env.companion.state().pos;
  await body.trigger("pointerdown", { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
  await body.trigger("pointermove", { pointerId: 1, clientX: 60, clientY: 40 });
  await body.trigger("pointerup", { pointerId: 1, clientX: 60, clientY: 40 });
  const to = env.companion.state().pos;
  assert.deepEqual([to.x, to.y], [from.x - 40, from.y - 60]);
  assert.equal(env.companion.state().mode, "stay");
  await body.click();
  assert.equal(env.companion.state().panel, false, "the drop is not also a click");
  await body.trigger("pointerdown", { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
  await body.trigger("pointerup", { pointerId: 2, clientX: 11, clientY: 11 });
  await body.click();
  assert.equal(env.companion.state().panel, true, "a press without a drag opens the panel");
});

test("Calm keeps it where it is: no walking and no wandering", async () => {
  const env = await environment({ motion: "calm", current: "tasks" });
  assert.equal(env.root.classList.contains("still"), true);
  env.companion.say({ id: "x", priority: 3, text: "Look here", anchor: "#workspace-companion-perch" });
  assert.equal(env.root.style.transitionDuration, "0ms");
  const full = await environment({ motion: "on", current: "tasks" });
  assert.equal(full.root.classList.contains("still"), false);
  full.companion.say({ id: "x", priority: 3, text: "Look here", anchor: "#workspace-companion-perch" });
  assert.equal(full.dom.body.querySelector(".companion-bubble").hidden, false);
  assert.notEqual(full.root.style.transitionDuration, "0ms", "on Full it walks over to what it is talking about");
  assert.equal(full.root.classList.contains("walking"), true);
});

test("quiet mode keeps only what needs you, and a reply on the workspace is left to the thread", async () => {
  const env = await environment({ storage: { "mefiStudio.companion.chatter": "quiet" } });
  env.companion.say({ id: "a", priority: 1, text: "Just saying hi" });
  assert.equal(env.companion.state().bubble, null);
  env.companion.say({ id: "b", priority: 3, text: "An agent needs your answer" });
  assert.equal(env.companion.state().bubble, "An agent needs your answer");
  const chatty = await environment();
  chatty.companion.say({ id: "r", priority: 2, kind: "reply", text: "“Here is the plan.”" });
  assert.equal(chatty.companion.state().bubble, null, "on the workspace the thread already shows it");
});
