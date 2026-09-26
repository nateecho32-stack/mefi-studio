// Vibe's own menus: the cards under the box and the stops in the dock come
// and go with what they have to show, and Tasks, Plans, Ideas, Team and
// Settings open as compact panels beside the front door (renderer/
// vibe-panels.js) instead of Build's sheets. The real vibe.js and
// vibe-panels.js run here in the shared fake DOM against a stand-in bridge.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom, templateIds } from "./fixtures/renderer-dom.mjs";

const vibeSource = await readFile(new URL("../renderer/vibe.js", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../renderer/vibe-panels.js", import.meta.url), "utf8");
const navSource = await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8");
const P = "p1";
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let turn = 0; turn < 16; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
const now = Date.now();

function bridge({ quiet = false, running = false, ideas = false, plans = false, finished = false } = {}) {
  const calls = [];
  const status = { held: false, execute: true, autoBuild: true, running: running ? [{ taskId: "t1", projectId: P, title: "Build the login page", phase: "editing", startedAt: now - 60000 }] : [] };
  const tasks = quiet ? [] : [
    { id: "t1", projectId: P, title: "Build the login page", status: running ? "active" : "open", prompt: "A login page with email and password.", updatedAt: now - 1000, contextVersion: 2 },
    { id: "t2", projectId: P, title: "Fix the login redirect loop", status: "awaiting_verification", updatedAt: now - 2000 },
    { id: "t3", projectId: P, title: "Add a sitemap", status: "open", prompt: "Generate sitemap.xml from the routes.", updatedAt: now - 3000, contextVersion: 1 },
    { id: "t7", projectId: P, title: "Upgrade the charts", status: "open", lastRunError: "peer dependency conflict", updatedAt: now - 4000 },
    ...(finished ? [{ id: "t9", projectId: P, title: "Dark mode", status: "done", verification: { state: "verified" }, updatedAt: now - 3600000 }] : []),
  ];
  const openQuestions = quiet ? [] : [{ id: "q1", projectId: P, status: "open", title: "Follow the system theme?", options: [{ id: "a", label: "Yes", recommended: true }, { id: "b", label: "No" }] }];
  const blocked = quiet ? [] : [{ id: "t7", kind: "task", title: "Upgrade the charts", stage: "blocked", blockedBy: "loop", reason: "The same failure repeated." }];
  const ideaRows = ideas ? [{ id: "i1", title: "Cache the tile atlas", source: "thinker", at: now - 5000, read: false }, { id: "i2", title: "Old idea", read: true }] : [];
  const planRows = plans ? [{ id: "plan1", title: "Save system", status: "planning", questions: [{ id: "q", status: "resolved" }, { id: "r", status: "open" }] }, { id: "plan2", title: "Shipped", status: "converted" }] : [];
  const backlog = () => ({ ok: true, projectId: P, counts: { ready: 1 }, next: quiet ? [] : [{ id: "t3", kind: "task", title: "Add a sitemap", stage: "ready" }], approval: [], blocked,
    taskStates: quiet ? [] : [{ id: "t1", stage: running ? "running" : "ready" }, { id: "t2", stage: "review" }, { id: "t3", stage: "ready" }, { id: "t7", stage: "blocked", blockedBy: "loop" }] });
  const api = {
    projectsList: async () => ({ projects: [{ id: P, name: "Sunrise" }], activeId: P }),
    tasksList: async () => ({ ok: true, projectId: P, tasks }),
    assistantState: async () => ({ ok: true, state: { projectId: P, status: "running", questions: openQuestions, messages: [], ai: { keyPresent: true } } }),
    assistantStatus: async () => ({ ok: true, status: { ...status } }),
    backlogStatus: async () => backlog(),
    ideasList: async () => ({ ok: true, projectId: P, ideas: ideaRows }),
    planningList: async ({ projectId }) => { calls.push(["planningList", projectId]); return { ok: true, projectId: P, plans: planRows }; },
    backlogControl: async (args) => { calls.push(["backlogControl", args.action, args.ideaId ?? args.taskId]); return { ok: true, taskIds: ["t10"] }; },
    tasksAction: async (args) => { calls.push(["tasksAction", args.action, args.taskId]); return { ok: true }; },
    tasksSave: async (rows) => { calls.push(["tasksSave", rows[0].id, rows[0].notes]); return { ok: true, tasks: [] }; },
    ideasAction: async (args) => { calls.push(["ideasAction", args.action, args.ideaId]); return { ok: true, ideas: [] }; },
    assistantWorkOn: async (args) => { calls.push(["assistantWorkOn", args.id, args.start]); return { ok: true }; },
    assistantAnswer: async ({ id, optionId }) => { calls.push(["assistantAnswer", id, optionId]); return { ok: true }; },
    agentsState: async () => ({ ok: true, configuration: { executorCli: "opencode", executorModels: { opencode: "deepseek-v4.1-flash" } }, choices: { companion: { ok: true, provider: "zen", model: "gpt-6-luna" }, lead: { ok: true, provider: "zen", model: "gpt-6-sol" } } }),
  };
  return { api, calls };
}

async function load(options = {}) {
  const { api, calls } = bridge(options);
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("vibe-")) });
  const lookup = document.getElementById;
  document.getElementById = (id) => lookup(id) ?? document.querySelector(`#${id}`);
  document.documentElement.dataset = {};
  for (const id of ["vibe-layer", "vibe-ask", "vibe-chat", "vibe-panel", "vibe-gate", "vibe-panel-back"]) get(id).hidden = true;
  // The stops the dock starts without, as the template ships them.
  for (const id of ["vibe-stop-watch", "vibe-stop-plans", "vibe-stop-ideas"]) get(id).hidden = true;
  const gone = [];
  const window = {
    addEventListener() {}, dispatchEvent() { return true; },
    mefiStudio: api,
    MefiNav: { register() {}, current: () => "vibe", go: (id, params) => gone.push([id, params ?? null]) },
  };
  const context = vm.createContext({
    window, document, console,
    location: { search: "" },
    localStorage: { getItem: (key) => (key === "mefiStudio.uiMode" ? "vibe" : null), setItem() {}, length: 0, key: () => null },
    requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout() {},
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  });
  vm.runInContext(panelSource, context);
  vm.runInContext(vibeSource, context);
  await window.MefiVibe.enter();
  await settle();
  const fire = (element, type, extra = {}) => { for (const fn of element.listeners?.[type] ?? []) fn({ type, target: element, preventDefault() {}, stopPropagation() {}, ...extra }); };
  const snapshot = () => plain(window.MefiVibe.snapshot());
  const panelRows = () => get("vibe-panel-body").querySelectorAll(".vibe-row-main");
  const panelButtons = () => get("vibe-panel-body").querySelectorAll(".vibe-ask-actions button");
  return { window, calls, gone, get, fire, snapshot, panelRows, panelButtons };
}

test("cards show only while they have something to say, and a quiet project gets one calm line", async () => {
  const busy = await load();
  assert.deepEqual(busy.snapshot().cards, ["needs", "building"], "a decision, a stuck task and checking work; nothing fresh done, no ideas");
  assert.equal(busy.get("vibe-card-needs").hidden, false);
  assert.equal(busy.get("vibe-card-building").hidden, false);
  assert.equal(busy.get("vibe-card-done").hidden, true);
  assert.equal(busy.get("vibe-card-ideas").hidden, true);
  assert.equal(busy.get("vibe-quiet").hidden, true);

  const quiet = await load({ quiet: true });
  assert.deepEqual(quiet.snapshot().cards, []);
  for (const card of ["needs", "building", "done", "ideas"]) assert.equal(quiet.get(`vibe-card-${card}`).hidden, true, `${card} stays down`);
  assert.equal(quiet.get("vibe-quiet").hidden, false, "one calm line instead of empty boxes");

  const lively = await load({ ideas: true, finished: true });
  assert.deepEqual(lively.snapshot().cards, ["needs", "building", "done", "ideas"]);
  assert.equal(lively.get("vibe-lane-ideas").children.length, 1, "only the unread idea is fresh");
});

test("the dock's stops come and go: Watch while agents work, Plans while a plan is in play, Ideas while fresh ones wait", async () => {
  const quiet = await load({ quiet: true });
  assert.deepEqual(quiet.snapshot().dock, ["tasks", "team", "more"]);
  assert.equal(quiet.get("vibe-stop-watch").hidden, true);
  assert.equal(quiet.get("vibe-stop-plans").hidden, true);

  const busy = await load({ running: true, ideas: true, plans: true });
  assert.deepEqual(busy.snapshot().dock, ["watch", "tasks", "plans", "ideas", "team", "more"]);
  for (const stop of ["watch", "plans", "ideas"]) assert.equal(busy.get(`vibe-stop-${stop}`).hidden, false, `${stop} stepped in`);
  assert.ok(busy.calls.some(([name, id]) => name === "planningList" && id === P), "plans are read for the open project");
});

test("the dock opens Vibe's own panels, one side panel at a time, and never a Build sheet", async () => {
  const { window, get, fire, snapshot, gone } = await load();
  const layer = get("vibe-layer");
  const stop = get("vibe-stop-tasks");
  stop.setAttribute("data-vibe-panel", "tasks");
  stop.setAttribute("data-vibe-stop", "tasks");
  layer.append(stop);
  fire(layer, "click", { target: stop });
  assert.equal(snapshot().panel, "tasks");
  assert.equal(get("vibe-panel").hidden, false);
  assert.equal(get("vibe-panel-title").textContent, "Tasks");
  assert.equal(get("vibe-panel-kicker").textContent, "Sunrise");
  assert.equal(stop.getAttribute("aria-pressed"), "true", "the dock marks the open panel");
  // A decision takes the side panel's place.
  window.MefiVibe.openNeed({ kind: "question", id: "q1" });
  assert.equal(get("vibe-panel").hidden, true);
  assert.deepEqual(snapshot().open, { kind: "question", id: "q1" });
  // And a panel takes the decision's.
  window.MefiVibe.openPanel("team");
  assert.equal(get("vibe-ask").hidden, true);
  assert.equal(snapshot().panel, "team");
  // The same stop again closes its panel.
  window.MefiVibe.openPanel("tasks");
  fire(layer, "click", { target: stop });
  assert.equal(snapshot().panel, null);
  assert.deepEqual(gone, [], "nothing left Vibe");
});

test("the Tasks panel folds what needs you, what is in progress and what is done; a row opens its detail and Esc steps back out", async () => {
  const { window, get, fire, snapshot, panelRows, panelButtons, calls } = await load();
  window.MefiVibe.openPanel("tasks");
  const titles = panelRows().map((row) => row.children[1].textContent);
  assert.deepEqual(titles.slice(0, 2), ["Follow the system theme?", "Upgrade the charts"], "Needs you comes first");
  assert.ok(titles.includes("Fix the login redirect loop") && titles.includes("Add a sitemap"), "work in progress is listed");
  const sitemap = panelRows().find((row) => row.children[1].textContent === "Add a sitemap");
  assert.equal(sitemap.children[2].textContent, "up next");
  sitemap.click();
  assert.equal(get("vibe-panel-title").textContent, "Task");
  assert.equal(get("vibe-panel-back").hidden, false);
  assert.deepEqual(panelButtons().map((button) => button.textContent), ["Start now", "Drop it"]);
  panelButtons()[1].click();
  await settle();
  assert.deepEqual(calls.find(([name]) => name === "tasksAction"), ["tasksAction", "drop", "t3"]);
  // Esc: out of the detail first, then out of the panel.
  window.MefiVibe.openPanel("tasks", { taskId: "t3" });
  const layer = get("vibe-layer");
  fire(layer, "keydown", { key: "Escape" });
  assert.equal(get("vibe-panel-title").textContent, "Tasks");
  assert.equal(snapshot().panel, "tasks");
  fire(layer, "keydown", { key: "Escape" });
  assert.equal(snapshot().panel, null);
});

test("a note for a queued task is saved for its next attempt, and Full view opens the Build page inside Vibe's rail", async () => {
  const { window, get, calls, gone } = await load();
  window.MefiVibe.openPanel("tasks", { taskId: "t3" });
  const form = get("vibe-panel-body").querySelector("form");
  form.children[0].value = "Use the router's route table";
  for (const fn of form.listeners.submit) fn({ preventDefault() {} });
  await settle();
  assert.deepEqual(calls.find(([name]) => name === "tasksSave"), ["tasksSave", "t3", "- Use the router's route table"]);
  get("vibe-panel-full").onclick();
  assert.deepEqual(plain(gone.at(-1)), ["tasks", { taskId: "t3", filter: "all" }]);
  assert.equal(get("vibe-panel").hidden, true);
});

test("an idea is built from its card, and the Ideas panel can set one aside", async () => {
  const { window, get, calls, panelButtons } = await load({ ideas: true });
  const card = get("vibe-lane-ideas").children[0];
  card.children[1].click();
  await settle();
  assert.deepEqual(calls.find(([name]) => name === "backlogControl"), ["backlogControl", "promote", "i1"]);
  window.MefiVibe.openPanel("ideas", { ideaId: "i2" });
  assert.equal(get("vibe-panel-title").textContent, "Idea");
  assert.deepEqual(panelButtons().map((button) => button.textContent), ["Build it", "Keep for later", "Dismiss"]);
  panelButtons()[2].click();
  await settle();
  assert.deepEqual(calls.find(([name]) => name === "ideasAction"), ["ideasAction", "done", "i2"]);
});

test("the pill opens what it names, and Team shows who is working on which models", async () => {
  const { get, fire, snapshot } = await load({ running: true });
  fire(get("vibe-pulse"), "click");
  assert.deepEqual(snapshot().open, { kind: "question", id: "q1" }, "a need opens its drawer");
  const quiet = await load({ quiet: true, running: true });
  fire(quiet.get("vibe-pulse"), "click");
  assert.equal(quiet.snapshot().panel, "tasks", "with nothing waiting, the pill opens the work");
  quiet.window.MefiVibe.openPanel("team");
  await settle();
  const roster = quiet.get("vibe-panel-body").querySelectorAll(".vibe-seat-model").map((node) => node.textContent);
  assert.deepEqual(roster, ["OpenCode · deepseek-v4.1-flash", "OpenCode Zen · gpt-6-luna", "OpenCode Zen · gpt-6-sol"]);
  assert.deepEqual(quiet.panelButtons().map((button) => button.textContent), ["Pause new work"]);
});

test("a decision toast answers in Vibe's drawer while Vibe is the mode", () => {
  assert.match(navSource, /vibeMode\(\) && window\.MefiVibe\?\.openNeed \? window\.MefiVibe\.openNeed\(\{ kind: "question", id: question\.id \}\) : go\("command", \{ rail: "ask" \}\)/);
});
