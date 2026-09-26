// Vibe can be vibed in: from the one box to finished work without opening a
// Build surface. renderer/vibe.js runs here against the shared fake DOM and a
// stand-in desktop bridge, so these checks break when something that stops
// the agents (the launch hold, a pause, no AI, Verify first, a stuck task, a
// decision) can no longer be seen and cleared from Vibe itself.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom, templateIds } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/vibe.js", import.meta.url), "utf8");
const P = "p1";
// Values made inside the vm carry its prototypes; compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let turn = 0; turn < 12; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };

// A desktop bridge holding one project's state. Every call is logged, and
// the calls Vibe makes change that state the way the host would.
function bridge({ held = false, execute = true, paused = false, keyPresent = true, autoBuild = false, questions = true, approvals = true, stuck = true } = {}) {
  const calls = [];
  const status = { held, execute, autoBuild, running: [] };
  const tasks = [
    { id: "t2", projectId: P, title: "Fix the login redirect loop", status: "awaiting_verification" },
    { id: "t6", projectId: P, title: "Add a CSV export", status: "open", prompt: "Add a CSV export to the reports page, next to the date filter." },
    { id: "t7", projectId: P, title: "Upgrade the charts", status: "open", lastRunError: "peer dependency conflict" },
  ];
  let open = questions ? [{ id: "q1", projectId: P, status: "open", title: "Follow the system theme?", options: [{ id: "a", label: "Yes", recommended: true }, { id: "b", label: "No" }] }] : [];
  let approval = approvals ? [{ id: "t6", kind: "task", title: "Add a CSV export", stage: "approval", canApprove: true, buildScope: "scope-t6" }] : [];
  let blocked = stuck ? [{ id: "t7", kind: "task", title: "Upgrade the charts", stage: "blocked", blockedBy: "loop", reason: "The same failure repeated." }] : [];
  const backlog = () => ({ ok: true, projectId: P, counts: { ready: 1 }, next: [{ id: "t5", kind: "task", title: "Add a sitemap", stage: "ready" }], approval, blocked });
  const assistant = () => ({ projectId: P, status: paused ? "paused" : "running", questions: open, messages: [], ai: { keyPresent } });
  const api = {
    projectsList: async () => ({ projects: [{ id: P, name: "Sunrise" }], activeId: P }),
    tasksList: async () => ({ ok: true, projectId: P, tasks }),
    assistantState: async () => ({ ok: true, state: assistant() }),
    assistantStatus: async () => ({ ok: true, status: { ...status } }),
    backlogStatus: async () => backlog(),
    tasksCreate: async (args) => { calls.push(["tasksCreate", args.title]); return { ok: true, task: { id: "t9", projectId: P, title: args.title, status: "open" } }; },
    assistantControl: async (action) => { calls.push(["assistantControl", action]); status.held = false; status.execute = true; paused = false; return { ok: true, state: assistant(), autopilot: { ...status } }; },
    backlogControl: async (args) => { calls.push(["backlogControl", args.action, args.taskId, args.expectedScope]); approval = approval.filter((row) => row.id !== args.taskId); return { ok: true, backlog: backlog() }; },
    tasksAction: async (args) => { calls.push(["tasksAction", args.action, args.taskId]); blocked = blocked.filter((row) => row.id !== args.taskId); return { ok: true, backlog: backlog() }; },
    assistantAnswer: async ({ id, optionId }) => { calls.push(["assistantAnswer", id, optionId]); open = open.map((item) => item.id === id ? { ...item, status: "answered" } : item); return { ok: true, state: assistant() }; },
  };
  return { api, calls };
}

async function load(options = {}) {
  const { api, calls } = bridge(options);
  const storage = options.storage || new Map(), events = {};
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("vibe-")) });
  const lookup = document.getElementById;
  document.getElementById = (id) => lookup(id) ?? document.querySelector(`#${id}`);
  document.documentElement.dataset = {};
  get("vibe-layer").hidden = true;
  get("vibe-ask").hidden = true;
  get("vibe-gate").hidden = true;
  const gone = [];
  const window = {
    addEventListener(name, callback) { (events[name] ||= []).push(callback); }, dispatchEvent(event) { for (const callback of events[event.type] || []) callback(event); return true; },
    mefiStudio: api,
    MefiNav: { register() {}, current: () => "vibe", go: (id, params) => gone.push([id, params ?? null]) },
  };
  const context = vm.createContext({
    window, document, console,
    location: { search: "" },
    localStorage: { getItem: (key) => storage.get(key) ?? (key === "mefiStudio.uiMode" ? "vibe" : null), setItem: (key, value) => storage.set(key, value), length: 0, key: () => null },
    requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout() {},
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  });
  vm.runInContext(source, context);
  await window.MefiVibe.enter();
  await settle();
  const fire = (element, type) => { for (const fn of element.listeners?.[type] ?? []) fn({ type, preventDefault() {}, stopPropagation() {} }); };
  const vibe = { ...window.MefiVibe, snapshot: () => plain(window.MefiVibe.snapshot()) };
  return { vibe, calls, gone, get, fire, storage, window };
}

test("a held launch shows Start agents in Vibe, and it releases the agents", async () => {
  const { vibe, calls, get } = await load({ held: true, questions: false, approvals: false, stuck: false });
  assert.equal(vibe.snapshot().gate, "held");
  assert.equal(get("vibe-gate").hidden, false, "the banner shows");
  assert.equal(get("vibe-gate-action").textContent, "Start agents");
  assert.equal(get("vibe-pulse-text").textContent, "Waiting for you");
  get("vibe-gate-action").onclick();
  await settle();
  assert.deepEqual(calls, [["assistantControl", "start-work"]], "the same call as Build's Start agents");
  assert.equal(vibe.snapshot().gate, null);
  assert.equal(get("vibe-gate").hidden, true);
});

test("Build it while held says where the task went and how to start it", async () => {
  const { calls, get, fire } = await load({ held: true, questions: false, approvals: false, stuck: false });
  get("vibe-input").value = "Add a dark mode toggle";
  fire(get("vibe-compose"), "submit");
  await settle();
  assert.deepEqual(calls, [["tasksCreate", "Add a dark mode toggle"]]);
  assert.match(get("vibe-feedback").textContent, /Start agents/);
  assert.equal(get("vibe-feedback").dataset.tone, "warn");
});

test("a pause offers Resume, and no AI offers Connect an AI inside Vibe", async () => {
  const paused = await load({ paused: true, questions: false, approvals: false, stuck: false });
  assert.equal(paused.vibe.snapshot().gate, "paused");
  assert.equal(paused.get("vibe-gate-action").textContent, "Resume");
  const nokey = await load({ keyPresent: false, questions: false, approvals: false, stuck: false });
  assert.equal(nokey.vibe.snapshot().gate, "key");
  nokey.get("vibe-gate-action").onclick();
  assert.deepEqual(plain(nokey.gone.at(-1)), ["agents", { section: "setup", pane: "connections" }]);
});

test("Needs you holds only what cannot move without you; checking work is building", async () => {
  const { vibe } = await load();
  const snap = vibe.snapshot();
  assert.deepEqual(snap.needs.map((need) => `${need.kind}:${need.id}`), ["question:q1", "approval:t6", "blocked:t7"]);
  assert.deepEqual(snap.checking, ["t2"], "a finished attempt the checker is verifying is not waiting on you");
  assert.equal(snap.gate, null);
});

test("approve, retry and answer from the drawer, in order, without leaving Vibe", async () => {
  const { vibe, calls, get, gone } = await load();
  const rows = get("vibe-lane-needs").children;
  rows[1].children[1].click(); // Review on the approval
  await settle();
  assert.deepEqual(vibe.snapshot().open, { kind: "approval", id: "t6" });
  const approve = get("vibe-ask-body").querySelector(".vibe-ask-actions").children[0];
  assert.equal(approve.textContent, "Approve build");
  approve.click();
  await settle();
  assert.deepEqual(calls.at(-1), ["backlogControl", "approve", "t6", "scope-t6"], "the reviewed scope rides with the approval");
  assert.deepEqual(vibe.snapshot().open, { kind: "blocked", id: "t7" }, "moves forward to the next thing waiting");
  const retry = get("vibe-ask-body").querySelector(".vibe-ask-actions").children[0];
  assert.equal(retry.textContent, "Try again");
  retry.click();
  await settle();
  assert.deepEqual(calls.at(-1), ["tasksAction", "retry", "t7"]);
  assert.deepEqual(vibe.snapshot().open, { kind: "question", id: "q1" });
  get("vibe-ask-body").querySelector(".vibe-ask-option").click();
  await settle();
  assert.deepEqual(calls.at(-1), ["assistantAnswer", "q1", "a"], "the recommended option is first");
  assert.equal(vibe.snapshot().open, null, "the drawer closes when nothing is left");
  assert.deepEqual(vibe.snapshot().needs, []);
  assert.equal(gone.length, 0, "nothing navigated away from Vibe");
});


test("Vibe restores unsent file text after restart and keeps drafts separate across projects", async () => {
  const env = await load();
  env.get("vibe-input").value = "Continue this plan\n--- Attached file: plan.md ---\nKeep the old decisions";
  env.fire(env.get("vibe-input"), "input");
  const reopened = await load({ storage: env.storage });
  assert.equal(reopened.get("vibe-input").value, env.get("vibe-input").value);
  let activeId = "p2";
  reopened.window.MefiWorkspace = { activeProjectId: () => activeId };
  reopened.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: activeId } });
  assert.equal(reopened.get("vibe-input").value, "");
  reopened.get("vibe-input").value = "Second project's draft"; reopened.fire(reopened.get("vibe-input"), "input");
  activeId = "p1";
  reopened.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: activeId } });
  assert.equal(reopened.get("vibe-input").value, env.get("vibe-input").value);
  assert.equal(reopened.storage.get("mefiStudio.vibe.draft.p2"), "Second project's draft");
  assert.deepEqual(reopened.calls, []);
});
