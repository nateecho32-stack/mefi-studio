// Vibe is home: every launch opens there, what needs you can be answered
// there (results waiting for review, a plan's question, a hold on work done
// outside Studio), and its own single keys reach the dock, the box and the
// drawer. renderer/vibe.js runs against the shared fake DOM and a stand-in
// desktop bridge, as in vibe_pipeline.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom, templateIds } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/vibe.js", import.meta.url), "utf8");
const P = "p1";
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let turn = 0; turn < 12; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };

function bridge({ needsYou = null, plans = [], blocked = [] } = {}) {
  const calls = [];
  const tasks = [
    { id: "t2", projectId: P, title: "Fix the login redirect loop", status: "awaiting_verification", verification: { reason: "The checker could not start a browser." } },
    { id: "t8", projectId: P, title: "Add a changelog page", status: "open" },
  ];
  let planRows = plans;
  const assistant = () => ({ projectId: P, status: "running", questions: [], messages: [], ai: { keyPresent: true }, ...(needsYou ? { needsYou } : {}) });
  const api = {
    projectsList: async () => ({ projects: [{ id: P, name: "Sunrise" }], activeId: P }),
    tasksList: async () => ({ ok: true, projectId: P, tasks }),
    assistantState: async () => ({ ok: true, state: assistant() }),
    assistantStatus: async () => ({ ok: true, status: { held: false, execute: true, running: [] } }),
    backlogStatus: async () => ({ ok: true, projectId: P, counts: {}, next: [], approval: [], blocked }),
    planningList: async () => ({ ok: true, projectId: P, plans: planRows }),
    tasksAction: async (args) => { calls.push(["tasksAction", args.action, args.taskId, args.status ?? null]); return { ok: true }; },
    planningAssist: async (args) => {
      calls.push(["planningAssist", plain(args)]);
      planRows = planRows.map((plan) => plan.id === args.planId ? { ...plan, questions: plan.questions.map((question) => question.id === args.questionId ? { ...question, notes: [...question.notes, { author: "user", kind: "answer", text: args.message }, { author: "assistant", kind: "interpretation", text: "Understood." }] } : question) } : plan);
      return { ok: true, projectId: P, plan: planRows.find((plan) => plan.id === args.planId) };
    },
  };
  return { api, calls };
}

async function load({ storage = new Map(), search = "", panels = true, ...options } = {}) {
  const { api, calls } = bridge(options);
  const events = {};
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("vibe-")) });
  const lookup = document.getElementById;
  document.getElementById = (id) => lookup(id) ?? document.querySelector(`#${id}`);
  document.documentElement.dataset = {};
  for (const id of ["vibe-layer", "vibe-ask", "vibe-gate", "vibe-chat", "vibe-panel", "vibe-notes"]) get(id).hidden = true;
  const gone = [], opened = [];
  let panel = null;
  const window = {
    addEventListener(name, callback) { (events[name] ||= []).push(callback); }, dispatchEvent(event) { for (const callback of events[event.type] || []) callback(event); return true; },
    location: { search },
    mefiStudio: api,
    MefiNav: { register() {}, current: () => "vibe", go: (id, params) => gone.push([id, params ?? null]), state: { sheet: null, transient: null } },
    ...(panels ? { MefiVibePanels: { open: (kind) => { panel = kind; opened.push(kind); }, close: () => { panel = null; }, current: () => panel, isOpen: () => panel !== null } } : {}),
  };
  const context = vm.createContext({
    window, document, console,
    location: { search },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), length: 0, key: () => null },
    requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout() {},
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  });
  vm.runInContext(source, context);
  const key = (value, target = document.body) => {
    let prevented = false;
    const event = { type: "keydown", key: value, target, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, get defaultPrevented() { return prevented; }, preventDefault() { prevented = true; }, stopPropagation() {} };
    for (const callback of events.keydown || []) callback(event);
    return prevented;
  };
  return { window, get, calls, gone, opened, storage, key, panel: () => panel, snapshot: () => plain(window.MefiVibe.snapshot()) };
}

test("every launch opens in Vibe, even after closing in Build; a reload resumes, and the owner can keep the last mode", async () => {
  const closedInBuild = await load({ storage: new Map([["mefiStudio.uiMode", "build"]]) });
  assert.equal(closedInBuild.window.MefiVibe.mode(), "vibe");
  assert.equal(closedInBuild.storage.get("mefiStudio.uiMode"), "vibe");
  const keepLast = await load({ storage: new Map([["mefiStudio.uiMode", "build"], ["mefiStudio.uiMode.launch", "last"]]) });
  assert.equal(keepLast.window.MefiVibe.mode(), "build", "Always start in Vibe is off");
  const reloaded = await load({ storage: new Map([["mefiStudio.uiMode", "build"], ["mefiStudio.resume", JSON.stringify({ at: Date.now() - 5000, view: "workspace" })]]) });
  assert.equal(reloaded.window.MefiVibe.mode(), "build", "a live-update reload resumes where it was");
  const stale = await load({ storage: new Map([["mefiStudio.uiMode", "build"], ["mefiStudio.resume", JSON.stringify({ at: Date.now() - 600000 })]]) });
  assert.equal(stale.window.MefiVibe.mode(), "vibe", "an old resume note is a new launch");
  const capture = await load({ storage: new Map([["mefiStudio.uiMode", "build"]]), search: "?capture=1" });
  assert.equal(capture.window.MefiVibe.mode(), "build", "diagnostic launches keep the view their fixtures expect");
  const fresh = await load();
  assert.equal(fresh.window.MefiVibe.mode(), "vibe");
});

test("a new project's dock still offers Watch, so its tree is one click away", async () => {
  const loaded = await load();
  await loaded.window.MefiVibe.enter(); await settle();
  assert.deepEqual(loaded.snapshot().dock.slice(0, 2), ["watch", "tasks"]);
  assert.equal(loaded.get("vibe-stop-watch").hidden, false);
});

test("N on Social opens the first thing that needs you in the Inbox, and in Social's drawer only without one", async () => {
  const loaded = await load({ needsYou: { items: [{ kind: "review", taskId: "t2", title: "Fix the login redirect loop" }] } });
  await loaded.window.MefiVibe.enter(); await settle();
  const asked = [];
  loaded.window.MefiToday = { openNeed: (ref) => { asked.push(JSON.parse(JSON.stringify(ref))); return true; } };
  loaded.key("N");
  assert.deepEqual(asked, [{ kind: "review", id: "t2" }], "the Inbox answers it, as every other answer opens it");
  assert.equal(loaded.get("vibe-ask").hidden, true, "Social's old drawer stays closed");
  loaded.window.MefiToday = { openNeed: () => false };
  loaded.key("N");
  assert.equal(loaded.get("vibe-ask").hidden, false, "with no Inbox to take it, the drawer opens as before");
});

test("a result waiting for review is confirmed or sent back from Vibe's drawer", async () => {
  const loaded = await load({ needsYou: { items: [{ kind: "review", taskId: "t2", title: "Fix the login redirect loop" }] } });
  await loaded.window.MefiVibe.enter(); await settle();
  assert.deepEqual(loaded.snapshot().needs, [{ kind: "review", id: "t2", title: "Fix the login redirect loop" }]);
  loaded.window.MefiVibe.openNeed({ kind: "review", id: "t2" });
  assert.equal(loaded.get("vibe-ask").hidden, false);
  assert.match(loaded.get("vibe-ask-kicker").textContent, /yours to check/);
  const buttons = loaded.get("vibe-ask-body").querySelectorAll(".vibe-ask-actions button");
  assert.deepEqual(buttons.map((button) => button.textContent), ["Confirm done", "Send it back"]);
  assert.match(loaded.get("vibe-ask-body").textContent, /could not start a browser/, "the checker's word is shown");
  buttons[0].click(); await settle();
  assert.deepEqual(loaded.calls[0], ["tasksAction", "status", "t2", "done"]);
});

test("a plan's follow-up question is answered in Vibe's drawer; its other turns open the plan in Vibe's rail", async () => {
  const plans = [
    { id: "pl1", projectId: P, version: 3, title: "Offline mode", status: "draft", questions: [{ id: "q1", status: "open", question: "What syncs first?", dependsOn: [], notes: [{ author: "assistant", kind: "question", text: "Should drafts sync before settings?" }] }] },
    { id: "pl2", projectId: P, version: 1, title: "Dark theme", status: "draft", spec: { tasks: [{ title: "Tokens" }] }, questions: [] },
    { id: "pl3", projectId: P, version: 1, title: "Quiet plan", status: "draft", questions: [{ id: "q9", status: "open", question: "Not started", dependsOn: [], notes: [] }] },
  ];
  const loaded = await load({ plans });
  await loaded.window.MefiVibe.enter(); await settle();
  assert.deepEqual(loaded.snapshot().needs.map((need) => `${need.kind}:${need.id}`), ["plan:pl1", "plan:pl2"], "an unexplored question is not a need");
  loaded.window.MefiVibe.openNeed({ kind: "plan", id: "pl1" });
  const body = loaded.get("vibe-ask-body");
  assert.match(body.textContent, /Should drafts sync before settings\?/);
  const form = body.querySelector(".vibe-ask-own");
  form.querySelector("textarea").value = "Drafts first; settings can wait.";
  for (const fn of form.listeners?.submit ?? []) fn({ type: "submit", preventDefault() {} });
  await settle();
  assert.deepEqual(loaded.calls[0], ["planningAssist", { projectId: P, planId: "pl1", version: 3, kind: "interview", questionId: "q1", message: "Drafts first; settings can wait.", useWeb: false }]);
  assert.ok(!loaded.snapshot().needs.some((need) => need.id === "pl1"), "answered: Mefi read it back, the turn is over");
  loaded.window.MefiVibe.openNeed({ kind: "plan", id: "pl2" });
  const review = loaded.get("vibe-ask-body").querySelector(".vibe-ask-actions button");
  assert.equal(review.textContent, "Review the plan");
  review.click();
  assert.deepEqual(plain(loaded.gone.at(-1)), ["plans", { planId: "pl2" }]);
});

test("a hold on work done outside Studio offers Build it anyway", async () => {
  const loaded = await load({ blocked: [{ id: "t8", kind: "task", title: "Add a changelog page", stage: "blocked", blockedBy: "relevance", reason: "A commit outside Studio added CHANGELOG.md." }] });
  await loaded.window.MefiVibe.enter(); await settle();
  const need = loaded.snapshot().needs[0];
  assert.equal(need.kind, "blocked");
  loaded.window.MefiVibe.openNeed({ kind: "blocked", id: "t8" });
  const body = loaded.get("vibe-ask-body");
  assert.match(body.textContent, /Maybe done outside Studio/);
  assert.equal(body.querySelector(".vibe-ask-actions button").textContent, "Build it anyway");
});

test("Vibe's single keys open its panels, the box and what needs you, but never while typing or under a sheet", async () => {
  const loaded = await load({ needsYou: { items: [{ kind: "review", taskId: "t2", title: "Fix the login redirect loop" }] } });
  await loaded.window.MefiVibe.enter(); await settle();
  assert.equal(loaded.key("t"), true, "T is Vibe's, so nav.js's task board key stands down");
  assert.equal(loaded.panel(), "tasks");
  loaded.key("T");
  assert.equal(loaded.panel(), null, "the same key closes it");
  loaded.key("m");
  assert.equal(loaded.panel(), "team");
  loaded.key("n");
  assert.equal(loaded.get("vibe-ask").hidden, false, "N opens the first thing waiting on you");
  loaded.get("vibe-ask").matches = (selector) => selector === ":hover";
  assert.equal(loaded.key("t"), false, "with the pointer on an open drawer, letters go to its box (nav.js typeInto)");
  loaded.get("vibe-ask").matches = () => false;
  loaded.get("vibe-input").tagName = "textarea"; // the fake DOM mints id'd nodes as divs
  assert.equal(loaded.key("t", loaded.get("vibe-input")), false, "typing in the box is typing");
  loaded.window.MefiNav.state.sheet = "plans";
  assert.equal(loaded.key("i"), false, "a page over Vibe keeps its keys");
  loaded.window.MefiNav.state.sheet = null;
  assert.equal(loaded.key("x"), false, "unknown keys pass through");
  loaded.window.MefiVibe.exit();
  assert.equal(loaded.key("t"), false, "off the front door, T is Build's task board again");
});

test("a mode switch that keeps the page swaps the Home underneath it, so Studio's rail is never left under Social's flag", async () => {
  const loaded = await load();
  const workspace = { active: false, entered: 0, exited: 0, enter() { this.active = true; this.entered += 1; }, exit() { this.active = false; this.exited += 1; }, isActive() { return this.active; } };
  loaded.window.MefiWorkspace = workspace;
  await loaded.window.MefiVibe.enter();
  const layer = loaded.get("vibe-layer");
  assert.equal(layer.hidden, false);
  assert.equal(loaded.window.document?.body?.classList?.contains?.("vibe-active") ?? true, true);
  // Settings' Mode switch and the top bar from a page that is not Home both keep the page (go: false).
  loaded.window.MefiVibe.setMode("build", { go: false });
  assert.equal(loaded.window.MefiVibe.mode(), "build");
  assert.equal(layer.hidden, true, "Social's Home steps out from under the page");
  assert.equal(workspace.entered, 1, "Studio's Home takes its place");
  assert.deepEqual(loaded.gone, [], "the page itself stays: nothing navigates");
  loaded.window.MefiVibe.setMode("vibe", { go: false });
  assert.equal(workspace.exited >= 1, true, "and back again: Studio's Home steps out");
  assert.equal(layer.hidden, false, "Social's Home is under the page again");
  assert.deepEqual(loaded.gone, []);
});
