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

function bridge({ quiet = false, running = false, ideas = false, plans = false, finished = false, family = false, sized = 0, deferred = false } = {}) {
  const calls = [];
  const status = { held: false, execute: true, autoBuild: true, running: running ? [{ taskId: "t1", projectId: P, title: "Build the login page", phase: "editing", startedAt: now - 60000 }] : [] };
  const tasks = quiet ? [] : [
    { id: "t1", projectId: P, title: "Build the login page", status: running ? "active" : "open", prompt: "A login page with email and password.", updatedAt: now - 1000, contextVersion: 2 },
    { id: "t2", projectId: P, title: "Fix the login redirect loop", status: "awaiting_verification", updatedAt: now - 2000 },
    { id: "t3", projectId: P, title: "Add a sitemap", status: "open", prompt: "Generate sitemap.xml from the routes.", updatedAt: now - 3000, contextVersion: 1, ...(deferred ? { deferUntil: now + 60000 } : {}) },
    { id: "t7", projectId: P, title: "Upgrade the charts", status: "open", lastRunError: "peer dependency conflict", updatedAt: now - 4000 },
    ...(finished ? [{ id: "t9", projectId: P, title: "Dark mode", status: "done", verification: { state: "verified" }, updatedAt: now - 3600000 }] : []),
    // A request Build it split into steps (main.cjs vibeBuild), under Verify first.
    ...(family ? [
      { id: "f0", projectId: P, title: "Save system", status: "open", updatedAt: now, delegation: { version: 1, intake: true, summary: "Data first, then menus.", childTaskIds: ["f1", "f2", "f3"] } },
      { id: "f1", projectId: P, title: "Save data model", status: "done", parentTaskId: "f0", delegatedFrom: { intake: true, parentTaskId: "f0" }, updatedAt: now - 5000 },
      { id: "f2", projectId: P, title: "Save slots menu", status: "open", parentTaskId: "f0", delegatedFrom: { intake: true, parentTaskId: "f0" }, buildScope: "scope-f2", updatedAt: now - 4000 },
      { id: "f3", projectId: P, title: "Load menu", status: "open", parentTaskId: "f0", delegatedFrom: { intake: true, parentTaskId: "f0" }, buildScope: "scope-f3", updatedAt: now - 3000 },
    ] : []),
  ];
  const openQuestions = quiet ? [] : [{ id: "q1", projectId: P, status: "open", title: "Follow the system theme?", options: [{ id: "a", label: "Yes", recommended: true }, { id: "b", label: "No" }] }];
  const blocked = quiet ? [] : [{ id: "t7", kind: "task", title: "Upgrade the charts", stage: "blocked", blockedBy: "loop", reason: "The same failure repeated." }];
  let approval = family ? [{ id: "f2", kind: "task", title: "Save slots menu", stage: "approval", canApprove: true, buildScope: "scope-f2" }, { id: "f3", kind: "task", title: "Load menu", stage: "approval", canApprove: true, buildScope: "scope-f3" }] : [];
  const ideaRows = ideas ? [{ id: "i1", title: "Cache the tile atlas", source: "thinker", at: now - 5000, read: false }, { id: "i2", title: "Old idea", read: true }] : [];
  const planRows = plans ? [{ id: "plan1", title: "Save system", status: "planning", questions: [{ id: "q", status: "resolved" }, { id: "r", status: "open" }] }, { id: "plan2", title: "Shipped", status: "converted" }] : [];
  const backlog = () => ({ ok: true, projectId: P, counts: { ready: 1 }, next: quiet ? [] : [{ id: "t3", kind: "task", title: "Add a sitemap", stage: "ready" }], approval, blocked,
    taskStates: quiet ? [] : [{ id: "t1", stage: running ? "running" : "ready" }, { id: "t2", stage: "review" }, { id: "t3", stage: deferred ? "deferred" : "ready" }, { id: "t7", stage: "blocked", blockedBy: "loop" }, ...approval.map((row) => ({ id: row.id, stage: "approval" }))] });
  const api = {
    projectsList: async () => ({ projects: [{ id: P, name: "Sunrise" }], activeId: P }),
    tasksList: async () => ({ ok: true, projectId: P, tasks }),
    assistantState: async () => ({ ok: true, state: { projectId: P, status: "running", questions: openQuestions, messages: [], ai: { keyPresent: true } } }),
    assistantStatus: async () => ({ ok: true, status: { ...status } }),
    assistantControl: async (action) => { calls.push(["assistantControl", action]); return { ok: true }; },
    assistantAutopilot: async (prefs) => { calls.push(["assistantAutopilot", prefs]); Object.assign(status, prefs); return { ok: true }; },
    backlogStatus: async () => backlog(),
    ideasList: async () => ({ ok: true, projectId: P, ideas: ideaRows }),
    planningList: async ({ projectId }) => { calls.push(["planningList", projectId]); return { ok: true, projectId: P, plans: planRows }; },
    backlogControl: async (args) => { calls.push(["backlogControl", args.action, args.ideaId ?? args.taskId, ...(args.expectedScope ? [args.expectedScope] : [])]); approval = approval.filter((row) => row.id !== args.taskId); return { ok: true, taskIds: ["t10"] }; },
    ...(sized ? { vibeBuild: async (args) => { calls.push(["vibeBuild", args.title]); return { ok: true, task: { id: "f0" }, steps: sized }; } } : {}),
    projectsCreate: async (args) => { calls.push(["projectsCreate", args.name, args.about]); return { ok: true, selectedId: "p9", folder: "C:/Users/me/Mefi Apps/pixel-garden" }; },
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

test("the dock's stops come and go: Watch always stands (a new project's tree too), Plans while a plan is in play, Ideas while fresh ones wait", async () => {
  const quiet = await load({ quiet: true });
  assert.deepEqual(quiet.snapshot().dock, ["watch", "tasks", "team", "more"]);
  assert.equal(quiet.get("vibe-stop-watch").hidden, false, "the tree is one click away before anything has started");
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

test("a request split into steps shows on the plan card, waits as one row, and starts together", async () => {
  const { window, get, snapshot, calls, panelRows } = await load({ family: true });
  const snap = snapshot();
  assert.ok(snap.cards.includes("plan"), "the plan card is up");
  assert.ok(snap.dock.includes("plans"), "Plans steps into the dock");
  assert.deepEqual(snap.needs.filter((need) => need.id.startsWith("f")), [{ kind: "family", id: "f0", title: "Save system" }], "two waiting steps are one row");
  const card = get("vibe-lane-plan").children;
  assert.equal(card[0].children[0].children[1].textContent, "Save system");
  assert.match(card[0].children[0].children[2].textContent, /1 of 3 steps done · waiting for your go-ahead/);
  assert.deepEqual(card[1].children.map((mark) => mark.className), ["vibe-step is-done", "vibe-step is-approval", "vibe-step is-approval"]);
  card[0].children[1].click(); // Start all
  assert.deepEqual(snapshot().open, { kind: "family", id: "f0" });
  const start = get("vibe-ask-body").querySelector(".vibe-ask-actions").children[0];
  assert.equal(start.textContent, "Start all 2 steps");
  start.click();
  await settle();
  assert.deepEqual(calls.filter(([name]) => name === "backlogControl"), [["backlogControl", "approve", "f2", "scope-f2"], ["backlogControl", "approve", "f3", "scope-f3"]], "each step approved with its reviewed scope");
  window.MefiVibe.openPanel("plans", { familyId: "f0" });
  assert.equal(get("vibe-panel-title").textContent, "Plan");
  assert.deepEqual(panelRows().map((row) => row.children[1].textContent), ["1. Save data model", "2. Save slots menu", "3. Load menu", "Then: put it together and check the whole thing"]);
});

test("Build it asks the host to size the request and says when it was split", async () => {
  const { get, fire, calls } = await load({ quiet: true, sized: 3 });
  get("vibe-input").value = "Add a save system with three slots and a load menu";
  for (const fn of get("vibe-compose").listeners.submit) fn({ preventDefault() {} });
  await settle();
  assert.deepEqual(calls.find(([name]) => name === "vibeBuild"), ["vibeBuild", "Add a save system with three slots and a load menu"]);
  assert.match(get("vibe-feedback").textContent, /^Split into 3 steps, then a final check\./);
});

test("New app makes the folder, then sends its description through Build it", async () => {
  const { window, get, calls, snapshot } = await load({ quiet: true, sized: 2 });
  window.MefiVibe.openPanel("newapp");
  assert.equal(get("vibe-panel-title").textContent, "New app");
  assert.equal(get("vibe-panel-full").hidden, true, "nothing in Build to open");
  const form = get("vibe-panel-body").querySelector("form");
  const [nameField, aboutField] = form.children;
  nameField.children[1].value = "Pixel Garden";
  for (const fn of nameField.children[1].listeners.input) fn({});
  aboutField.children[1].value = "A cosy game where you grow pixel plants.";
  for (const fn of aboutField.children[1].listeners.input) fn({});
  assert.equal(form.children[2].textContent, "Folder: Mefi Apps/pixel-garden");
  for (const fn of form.listeners.submit) fn({ preventDefault() {} });
  await settle();
  assert.deepEqual(calls.find(([name]) => name === "projectsCreate"), ["projectsCreate", "Pixel Garden", "A cosy game where you grow pixel plants."]);
  assert.deepEqual(calls.find(([name]) => name === "vibeBuild"), ["vibeBuild", "Set up Pixel Garden"]);
  assert.equal(snapshot().panel, null, "the panel closes once the app is made");
  assert.equal(get("vibe-feedback").textContent, "Pixel Garden is ready, and its first build is split into 2 steps.");
});

test("making a family one task uses the atomic host action", async () => {
  const { window, get, calls } = await load({ family: true });
  window.MefiVibe.openNeed({ kind: "family", id: "f0" });
  get("vibe-ask-body").querySelector(".vibe-ask-actions").children[1].click();
  await settle();
  assert.deepEqual(calls.filter(([name]) => name === "tasksAction"), [["tasksAction", "merge-steps", "f0"]]);
});

test("New app retries a failed first build without recreating its folder", async () => {
  const { window, get, calls } = await load({ quiet: true, sized: 2 });
  let attempts = 0;
  window.mefiStudio.vibeBuild = async () => ++attempts === 1 ? { ok: false, error: "Try again" } : { ok: true };
  window.MefiVibe.openPanel("newapp");
  const form = get("vibe-panel-body").querySelector("form");
  for (const [index, value] of [[0, "Pixel Garden"], [1, "Grow plants"]]) {
    const input = form.children[index].children[1]; input.value = value;
    for (const fn of input.listeners.input) fn({});
  }
  for (const fn of form.listeners.submit) fn({ preventDefault() {} });
  await settle();
  const retry = get("vibe-panel-body").querySelector("form");
  assert.equal(retry.children[3].textContent, "Retry first build");
  for (const fn of retry.listeners.submit) fn({ preventDefault() {} });
  await settle();
  assert.equal(attempts, 2);
  assert.equal(calls.filter(([name]) => name === "projectsCreate").length, 1);
});

test("New app retries opening a folder when a running build prevented the first switch", async () => {
  const { window, get, fire } = await load({ quiet: true, sized: 2 });
  let creates = 0; const selections = [];
  window.mefiStudio.projectsCreate = async () => { creates++; return { ok: false, created: true, addedId: "p9", error: "A build is running" }; };
  window.mefiStudio.projectsSelect = async (args) => { selections.push(args.id); return { activeId: "p9" }; };
  window.MefiVibe.openPanel("newapp");
  const form = get("vibe-panel-body").querySelector("form");
  for (const [index, value] of [[0, "Notes"], [1, "A notes app"]]) { const input = form.children[index].children[1]; input.value = value; fire(input, "input"); }
  fire(form, "submit"); await settle();
  const retry = get("vibe-panel-body").querySelector("form");
  assert.equal(retry.children[3].textContent, "Open app and start building");
  fire(retry, "submit"); await settle();
  assert.equal(creates, 1); assert.deepEqual(selections, ["p9"]);
  assert.equal(get("vibe-panel").hidden, true);
});

test("Tasks lanes count each task once, keep deferred work in Later, and open its inspector", async () => {
  const { window, get } = await load({ running: true, deferred: true, finished: true });
  window.MefiVibe.openPanel("tasks");
  get("vibe-panel-body").querySelector(".vibe-task-views").children[1].click();
  const lanes = get("vibe-panel-body").querySelectorAll(".vibe-task-lane");
  assert.deepEqual(lanes.map((lane) => lane.children[0].textContent), ["Needs you · 1", "Ready · 0", "Building · 1", "Checking · 1", "Later · 1", "Done · 1"]);
  assert.equal(lanes.flatMap((lane) => lane.querySelectorAll(".vibe-row-main")).length, 5);
  lanes[4].querySelector(".vibe-row-main").click();
  assert.equal(get("vibe-panel-title").textContent, "Task");
  assert.equal(get("vibe-panel-body").querySelector(".vibe-ask-actions").children[0].textContent, "Return to queue");
  assert.ok(get("vibe-panel-body").querySelector(".vibe-inspector"));
  window.MefiVibePanels.back();
  assert.ok(get("vibe-panel-body").querySelector(".vibe-task-lanes"), "Back remembers Lanes");
});

test("queue controls use the host pause and worker-limit controls", async () => {
  const { window, get, fire, calls } = await load({ running: true });
  window.MefiVibe.openPanel("tasks");
  assert.match(get("vibe-panel-body").querySelector(".vibe-governor-counts").textContent, /^1 building · 1 ready · 2 need you$/, "the count matches the Needs you list, questions included");
  const limit = get("vibe-panel-body").querySelector(".vibe-worker-limit select");
  limit.value = "3"; fire(limit, "change"); await settle();
  assert.deepEqual(plain(calls.find(([name]) => name === "assistantAutopilot")), ["assistantAutopilot", { adaptiveParallel: false, parallel: 3 }]);
  get("vibe-panel-body").querySelector(".vibe-governor-controls button").click(); await settle();
  assert.ok(calls.some(([name, action]) => name === "backlogControl" && action === "pause"));
});

test("Inspector saves the task revision and retains unsaved input through pushes and failed saves", async () => {
  const { window, get, fire } = await load();
  const writes = [];
  window.mefiStudio.tasksSave = async (rows) => { writes.push(plain(rows[0])); return { ok: false, error: "Changed elsewhere" }; };
  window.MefiVibe.openPanel("tasks", { taskId: "t3" });
  const form = get("vibe-panel-body").querySelector(".vibe-inspector-form");
  const values = ["high", "45", "Sitemap includes all routes\nValid XML", "2030-01-01T09:30"];
  form.querySelectorAll("select, input, textarea").forEach((input, index) => { input.value = values[index]; fire(input, "input"); });
  await window.MefiVibe.refresh(); await settle();
  const current = get("vibe-panel-body").querySelector(".vibe-inspector-form");
  fire(current, "submit"); await settle();
  assert.equal(writes[0].id, "t3"); assert.equal(writes[0].projectId, P); assert.equal(writes[0].contextVersion, 1);
  assert.equal(writes[0].priority, "high"); assert.equal(writes[0].estimateMinutes, 45);
  assert.deepEqual(writes[0].acceptance, ["Sitemap includes all routes", "Valid XML"]);
  assert.equal(writes[0].deferUntil, new Date(values[3]).getTime());
  assert.deepEqual(get("vibe-panel-body").querySelector(".vibe-inspector-form").querySelectorAll("select, input, textarea").map((input) => input.value), values);
  assert.match(get("vibe-panel-note").textContent, /Changed elsewhere/);
});

test("Inspector is read only during a run or verification and changes project safely", async () => {
  const { window, get } = await load({ running: true });
  for (const taskId of ["t1", "t2"]) {
    window.MefiVibe.openPanel("tasks", { taskId });
    const form = get("vibe-panel-body").querySelector(".vibe-inspector-form");
    assert.ok(form.querySelectorAll("select, input, textarea, button").every((input) => input.disabled));
  }
  window.MefiVibePanels.update({ projectId: "p2", projectName: "Other", tasks: [] });
  assert.equal(get("vibe-panel-title").textContent, "Tasks");
  assert.equal(get("vibe-panel-body").querySelector(".vibe-inspector"), null);
});

test("Inspector changes one field without rewriting a legacy acceptance list", async () => {
  const { window, get, fire } = await load();
  const acceptance = ["A saved requirement ".repeat(30)];
  const task = { id: "legacy", projectId: P, contextVersion: 1, title: "Existing work", status: "open", acceptance };
  let saved;
  window.mefiStudio.tasksSave = async (rows) => { saved = plain(rows[0]); return { ok: true }; };
  window.MefiVibePanels.open("tasks", { data: { projectId: P, tasks: [task] }, taskId: task.id });
  const form = get("vibe-panel-body").querySelector(".vibe-inspector-form");
  const priority = form.querySelector("select"); priority.value = "high"; fire(priority, "change");
  fire(form, "submit"); await settle();
  assert.equal(saved.priority, "high"); assert.deepEqual(saved.acceptance, acceptance);
  assert.equal("estimateMinutes" in saved, false);
  assert.equal("deferUntil" in saved, false);
});
