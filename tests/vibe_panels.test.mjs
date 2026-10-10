// Vibe's own menus: the cards under the box and the stops in the dock come
// and go with what they have to show, and Tasks, Plans, Ideas, Team and
// Settings open as compact panels beside the front door (renderer/
// vibe-panels.js) instead of Build's sheets. The real vibe.js and
// vibe-panels.js run here in the shared fake DOM against a stand-in bridge.
// New app's GitHub choice (a private repository, one you already have, or
// this PC only) runs against that bridge's fake GitHub calls and a stand-in
// for the chip's dialogs: what it calls and in which order, that a refusal
// never costs the folder, the signed-out row, and that its copy of the
// repository-name rule is scripts/git-link.cjs's.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { createDom, templateIds } from "./fixtures/renderer-dom.mjs";

const vibeSource = await readFile(new URL("../renderer/vibe.js", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../renderer/vibe-panels.js", import.meta.url), "utf8");
const navSource = await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const P = "p1";
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let turn = 0; turn < 16; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
const now = Date.now();

// studio-ui.js MefiUi.arm's contract: the first press shows the question,
// the second runs it.
function armStub() {
  return { arm(button, { run, armed }) { button.classList.add("danger"); let ready = false, resting = ""; button.addEventListener("click", (event) => { if (!ready) { ready = true; resting = button.textContent; button.textContent = armed; button.classList.add("danger-armed"); return; } ready = false; button.textContent = resting; button.classList.remove("danger-armed"); run(event); }); return button; } };
}

function bridge({ quiet = false, running = false, ideas = false, plans = false, finished = false, family = false, sized = 0, deferred = false, closed = false, github = null } = {}) {
  const calls = [];
  // The project the host has open: a test switches it to play a user who moves on mid-publish.
  const active = { id: P };
  const status = { held: false, execute: true, autoBuild: true, running: running ? [{ taskId: "t1", projectId: P, title: "Build the login page", phase: "editing", startedAt: now - 60000 }] : [] };
  const tasks = quiet ? [] : [
    { id: "t1", projectId: P, title: "Build the login page", status: running ? "active" : "open", prompt: "A login page with email and password.", updatedAt: now - 1000, contextVersion: 2 },
    { id: "t2", projectId: P, title: "Fix the login redirect loop", status: "awaiting_verification", updatedAt: now - 2000 },
    { id: "t3", projectId: P, title: "Add a sitemap", status: "open", prompt: "Generate sitemap.xml from the routes.", updatedAt: now - 3000, contextVersion: 1, ...(deferred ? { deferUntil: now + 60000 } : {}) },
    { id: "t7", projectId: P, title: "Upgrade the charts", status: "open", lastRunError: "peer dependency conflict", updatedAt: now - 4000 },
    ...(finished ? [{ id: "t9", projectId: P, title: "Dark mode", status: "done", verification: { state: "verified" }, updatedAt: now - 3600000 }] : []),
    // Closed cards Freshly done must not call new: one dropped a minute ago
    // (main.cjs dropTask), one finished days ago with a note written just
    // now, one finished last week and archived just now.
    ...(closed ? [
      { id: "t10", projectId: P, title: "Drop the old parser", status: "archived", dropped: { at: now - 60000, by: "owner" }, updatedAt: now - 60000 },
      { id: "t11", projectId: P, title: "Old result", status: "done", doneAt: now - 3 * 86400000, verification: { state: "manual", at: now - 3 * 86400000 }, notes: "- a later note", updatedAt: now - 5000 },
      { id: "t12", projectId: P, title: "Archived last week", status: "archived", doneAt: now - 7 * 86400000, updatedAt: now - 1000 },
    ] : []),
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
    projectsList: async () => ({ projects: [{ id: P, name: "Sunrise" }], activeId: active.id }),
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
    projectsCreate: async (args) => { calls.push(["projectsCreate", args.name, args.about]); active.id = "p9"; return { ok: true, selectedId: "p9", folder: "C:/Users/me/Mefi Apps/pixel-garden" }; },
    // GitHub, as the host answers it: only when a test hands over `github`,
    // so every other test keeps the bridge New app shipped with. Its fields
    // are read at call time, so a test can sign in or refuse mid-flight.
    ...(github ? {
      githubAccount: async () => { calls.push(["githubAccount"]); return { ok: true, account: github.account ?? null, ghInstalled: github.ghInstalled !== false, gitInstalled: github.gitInstalled !== false }; },
      gitPublishPreview: async (args) => {
        calls.push(["gitPublishPreview", plain(args)]);
        return github.preview ? github.preview(args) : { ok: true, repo: `${args.owner}/${args.name}`, valid: true, sanitized: args.name, taken: false, oneDrive: false, weakDrive: false, needsSignIn: false, needsFirstCommit: true };
      },
      gitPublish: async (args) => { calls.push(["gitPublish", plain(args)]); return github.publish ? github.publish(args) : { ok: true, repo: `${args.owner}/${args.name}`, url: `https://github.com/${args.owner}/${args.name}`, steps: [] }; },
      pcSetupAction: async (action) => { calls.push(["pcSetupAction", action]); return { ok: true, launched: true }; },
    } : {}),
    tasksAction: async (args) => { calls.push(["tasksAction", args.action, args.taskId]); return { ok: true }; },
    tasksSave: async (rows) => { calls.push(["tasksSave", rows[0].id, rows[0].notes]); return { ok: true, tasks: [] }; },
    ideasAction: async (args) => { calls.push(["ideasAction", args.action, args.ideaId]); return { ok: true, ideas: [] }; },
    assistantWorkOn: async (args) => { calls.push(["assistantWorkOn", args.id, args.start]); return { ok: true }; },
    assistantAnswer: async ({ id, optionId }) => { calls.push(["assistantAnswer", id, optionId]); return { ok: true }; },
    agentsState: async () => ({ ok: true, configuration: { executorCli: "opencode", executorModels: { opencode: "deepseek-v4.1-flash" } }, choices: { companion: { ok: true, provider: "zen", model: "gpt-6-luna" }, lead: { ok: true, provider: "zen", model: "gpt-6-sol" } } }),
  };
  return { api, calls, active };
}

async function load(options = {}) {
  const { api, calls, active } = bridge(options);
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("vibe-")) });
  const lookup = document.getElementById;
  document.getElementById = (id) => lookup(id) ?? document.querySelector(`#${id}`);
  document.documentElement.dataset = {};
  for (const id of ["vibe-layer", "vibe-ask", "vibe-chat", "vibe-panel", "vibe-gate", "vibe-panel-back"]) get(id).hidden = true;
  // The stops the dock starts without, as the template ships them.
  for (const id of ["vibe-stop-watch", "vibe-stop-plans", "vibe-stop-ideas"]) get(id).hidden = true;
  const gone = [];
  // Toasts, and the timers the panel asks for (a sign-in poll): held, and
  // run only when a test says so.
  const toasts = [];
  const timers = [];
  const window = {
    addEventListener() {}, dispatchEvent() { return true; },
    mefiStudio: api,
    MefiNav: { register() {}, current: () => "vibe", go: (id, params) => gone.push([id, params ?? null]) },
    ...(options.ui ? { MefiUi: armStub() } : {}),
    MefiToast: (text, tone) => toasts.push([text, tone]),
    // The chip's dialogs (renderer/git-sync.js), when a test brings them.
    ...(options.sync ? { MefiGitSync: options.sync(calls) } : {}),
  };
  const context = vm.createContext({
    window, document, console,
    location: { search: "" },
    localStorage: { getItem: (key) => (key === "mefiStudio.uiMode" ? "vibe" : null), setItem() {}, length: 0, key: () => null },
    requestAnimationFrame: () => 0, setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout() {},
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
  return { window, calls, active, gone, get, fire, snapshot, panelRows, panelButtons, toasts, timers };
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
  window.mefiStudio.projectsSelect = async (id) => { selections.push(id); return { activeId: "p9" }; };
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

test("New app: work still running offers to stop the agents, and the second click opens the folder with progress saved", async () => {
  const { window, get, fire } = await load({ quiet: true, sized: 2 });
  let creates = 0; const selections = [];
  const busy = "The assistant is finishing work in this project. Pause it, let the current work finish, then switch.";
  window.mefiStudio.projectsCreate = async () => { creates++; return { ok: false, busy: true, created: true, addedId: "p9", error: busy }; };
  window.mefiStudio.projectsSelect = async (id, options) => { selections.push([id, options?.saveProgress === true]); return options?.saveProgress ? { activeId: "p9" } : { ok: false, busy: true, error: busy }; };
  window.MefiVibe.openPanel("newapp");
  const form = get("vibe-panel-body").querySelector("form");
  for (const [index, value] of [[0, "Notes"], [1, "A notes app"]]) { const input = form.children[index].children[1]; input.value = value; fire(input, "input"); }
  fire(form, "submit"); await settle();
  let retry = get("vibe-panel-body").querySelector("form");
  assert.equal(retry.children[3].textContent, "Stop agents, open app and start building", "the button says it will stop the agents");
  assert.deepEqual(selections, [], "nothing was stopped by the first click");
  fire(retry, "submit"); await settle();
  assert.deepEqual(selections, [["p9", true]], "the second click is the word to stop and open");
  assert.equal(creates, 1);
  assert.equal(get("vibe-panel").hidden, true);
});

// ---- New app: what happens on GitHub ---------------------------------------------------
// A stand-in for the chip's dialogs (renderer/git-sync.js): what the panel
// calls, and nothing else. `picker` decides what showLink does.
const gitSync = ({ picker, signIn = true } = {}) => (calls) => ({
  ...(picker === null ? {} : { showLink: (...args) => { calls.push(["showLink", args.length]); return picker ? picker() : new Promise(() => {}); } }),
  ...(signIn ? { showSignIn: () => { calls.push(["showSignIn"]); return Promise.resolve(); } } : {}),
});
const ACCOUNT = "nateecho32-stack";
const later = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function openNewApp(options = {}) {
  const h = await load({ quiet: true, sized: 2, github: { account: ACCOUNT }, sync: gitSync(), ...options });
  h.window.MefiVibe.openPanel("newapp");
  await settle();
  const body = () => h.get("vibe-panel-body");
  const form = () => body().querySelector("form");
  const radios = () => body().querySelectorAll(".vibe-gh-choice");
  const status = () => body().querySelector(".vibe-gh-status");
  const make = () => form().querySelector(".vibe-btn.primary");
  const type = (index, value) => { const input = form().children[index].children[1]; input.value = value; h.fire(input, "input"); };
  const start = async () => { h.fire(form(), "submit"); await settle(); };
  // What the panel asked the host for, in order; the front door's own reads and
  // the account look are not part of the story.
  const names = () => h.calls.map(([name]) => name).filter((name) => name !== "planningList" && name !== "githubAccount");
  return { ...h, body, form, radios, status, make, type, start, names };
}

test("without GitHub in the bridge, New app is what it always was", async () => {
  const h = await load({ quiet: true });
  h.window.MefiVibe.openPanel("newapp");
  await settle();
  assert.equal(h.get("vibe-panel-body").querySelector(".vibe-gh"), null, "no choice to make");
  assert.equal(h.get("vibe-panel-body").querySelector("form").children.length, 4);
  assert.equal(h.get("vibe-panel-body").querySelector("form").children[3].textContent, "Make it and start building");
  // The account can be asked, but nothing can publish or link: still no section.
  const bare = await load({ quiet: true, github: { account: ACCOUNT }, sync: gitSync({ picker: null }) });
  delete bare.window.mefiStudio.gitPublish;
  bare.window.MefiVibe.openPanel("newapp");
  await settle();
  assert.equal(bare.get("vibe-panel-body").querySelector(".vibe-gh"), null);
});

test("New app asks what happens on GitHub and starts on a private repository once signed in", async () => {
  const h = await openNewApp();
  const group = h.body().querySelector(".vibe-gh-choices");
  assert.equal(group.getAttribute("role"), "radiogroup");
  assert.equal(group.getAttribute("aria-label"), "What happens on GitHub");
  assert.deepEqual(h.radios().map((radio) => [radio.getAttribute("role"), radio.querySelector("b").textContent]), [
    ["radio", "Create a private GitHub repository"], ["radio", "Link a repository I already have"], ["radio", "Only on this PC for now"]]);
  assert.deepEqual(h.radios().map((radio) => radio.getAttribute("aria-checked")), ["true", "false", "false"], "a private repository is the default once GitHub knows who you are");
  assert.deepEqual(h.radios().map((radio) => radio.getAttribute("tabindex")), ["0", "-1", "-1"], "one tab stop, arrows move inside");
  assert.equal(h.body().querySelector(".vibe-gh-account").textContent, `Signed in as ${ACCOUNT}`);
  assert.equal(h.make().textContent, "Start and publish");
  assert.equal(h.status().getAttribute("role"), "status");

  // The final name follows what is typed, as account/name, and says it is private.
  assert.equal(h.body().querySelector(".vibe-gh-repo").textContent, `${ACCOUNT}/your-app`, "until there is a name");
  h.type(0, "Pixel Garden!");
  assert.equal(h.body().querySelector(".vibe-gh-repo").textContent, `${ACCOUNT}/pixel-garden`);
  assert.equal(h.body().querySelector(".vibe-gh-pill").textContent, "Private");
  assert.equal(h.form().children[2].textContent, "Folder: Mefi Apps/pixel-garden", "the folder line stays where it was");
  assert.equal(h.form().children[0].children[1].value, "Pixel Garden!", "typing is never repainted under");

  h.radios()[1].click();
  assert.deepEqual(h.radios().map((radio) => radio.getAttribute("aria-checked")), ["false", "true", "false"]);
  assert.deepEqual(h.radios().map((radio) => radio.getAttribute("tabindex")), ["-1", "0", "-1"]);
  assert.equal(h.make().textContent, "Start and link");
  assert.match(h.status().textContent, /asks which of your repositories to link it to/);
  assert.equal(h.body().querySelector(".vibe-gh-repo"), null);

  h.radios()[2].click();
  assert.equal(h.make().textContent, "Start project");
  assert.equal(h.status().textContent, "The project stays on this PC. You can publish it to GitHub any time later.");

  // Arrow keys walk the radios and wrap.
  const group2 = h.body().querySelector(".vibe-gh-choices");
  h.fire(group2, "keydown", { key: "ArrowDown" });
  assert.equal(h.radios()[0].getAttribute("aria-checked"), "true");
  h.fire(group2, "keydown", { key: "ArrowUp" });
  assert.equal(h.radios()[2].getAttribute("aria-checked"), "true");
  h.fire(group2, "keydown", { key: "ArrowLeft" });
  assert.equal(h.radios()[1].getAttribute("aria-checked"), "true");
  h.fire(group2, "keydown", { key: "a" });
  assert.equal(h.radios()[1].getAttribute("aria-checked"), "true", "other keys are left alone");
});

test("Start and publish makes the folder, publishes it privately, then queues the first build", async () => {
  const h = await openNewApp();
  const deal = later();
  h.window.mefiStudio.gitPublish = async (args) => { h.calls.push(["gitPublish", plain(args)]); return deal.promise; };
  h.type(0, "Pixel Garden"); h.type(1, "A cosy game where you grow pixel plants.");
  h.fire(h.form(), "submit"); await settle();
  // Mid-publish: the choice is fixed, the button says what is going on, the note says where.
  assert.equal(h.get("vibe-panel-note").textContent, "Publishing to GitHub…");
  assert.equal(h.make().textContent, "Making it…");
  assert.ok(h.radios().every((radio) => radio.disabled), "nothing changes while it runs");
  assert.deepEqual(h.names(), ["projectsCreate", "gitPublishPreview", "gitPublish"], "the build waits for the publish");
  deal.resolve({ ok: true, repo: `${ACCOUNT}/pixel-garden`, url: `https://github.com/${ACCOUNT}/pixel-garden`, steps: [] });
  await settle();
  assert.deepEqual(h.names(), ["projectsCreate", "gitPublishPreview", "gitPublish", "vibeBuild"]);
  assert.deepEqual(h.calls.find(([name]) => name === "gitPublishPreview")[1], { owner: ACCOUNT, name: "pixel-garden", projectId: "p9" }, "the host is asked about the name only once the folder exists, and about the project just made");
  assert.deepEqual(h.calls.find(([name]) => name === "gitPublish")[1], { owner: ACCOUNT, name: "pixel-garden", visibility: "private", gitignore: true, license: "none", projectId: "p9" }, "private, with the .gitignore, never a public confirmation, and bound to the project just made");
  assert.equal(h.snapshot().panel, null);
  assert.equal(h.get("vibe-feedback").textContent, `Pixel Garden is ready, and its first build is split into 2 steps. Published ${ACCOUNT}/pixel-garden (private).`);
  assert.deepEqual(h.toasts, []);
});

test("the host's final name and OneDrive note come through", async () => {
  const h = await openNewApp({ github: { account: ACCOUNT, preview: (args) => ({ ok: true, valid: true, sanitized: `${args.name}-2`, taken: false, oneDrive: true, weakDrive: false, needsSignIn: false }) } });
  h.type(0, "Notes");
  await h.start();
  assert.equal(h.calls.find(([name]) => name === "gitPublish")[1].name, "notes-2", "the host's sanitised name wins");
  assert.equal(h.get("vibe-feedback").textContent, `Notes is ready and open. Published ${ACCOUNT}/notes-2 (private). This folder syncs with OneDrive. Git works, but OneDrive can lock or duplicate .git files.`);
});

test("a refused publish never fails the folder: it toasts the reason and the build goes on", async () => {
  const refusals = [
    ["GitHub says no", { publish: () => ({ ok: false, error: "GitHub did not accept this PC's sign-in.", kind: "auth" }) }, "GitHub did not accept this PC's sign-in.", ["projectsCreate", "gitPublishPreview", "gitPublish", "vibeBuild"]],
    ["a crash", { publish: () => { throw new Error("socket hang up"); } }, "socket hang up", ["projectsCreate", "gitPublishPreview", "gitPublish", "vibeBuild"]],
    ["a silent host", { publish: () => null }, "GitHub did not accept the project.", ["projectsCreate", "gitPublishPreview", "gitPublish", "vibeBuild"]],
    ["a taken name", { preview: (args) => ({ ok: true, valid: true, sanitized: args.name, taken: true }) }, `${ACCOUNT}/pixel-garden already exists. Link to it, or pick another name.`, ["projectsCreate", "gitPublishPreview", "vibeBuild"]],
    ["a lapsed sign-in", { preview: () => ({ ok: true, valid: true, sanitized: "pixel-garden", needsSignIn: true }) }, "Sign in to GitHub first.", ["projectsCreate", "gitPublishPreview", "vibeBuild"]],
    ["an exFAT drive", { preview: () => ({ ok: true, valid: true, sanitized: "pixel-garden", weakDrive: true }) }, "Publishing needs a folder on an NTFS drive. The project is open and stays on this PC.", ["projectsCreate", "gitPublishPreview", "vibeBuild"]],
    ["an unusable name", { preview: () => ({ ok: true, valid: false, sanitized: "" }) }, "That name cannot be a GitHub repository name.", ["projectsCreate", "gitPublishPreview", "vibeBuild"]],
    ["a preview that fails", { preview: () => ({ ok: false, error: "You're offline. Nothing was created." }) }, "You're offline. Nothing was created.", ["projectsCreate", "gitPublishPreview", "vibeBuild"]],
  ];
  for (const [label, github, reason, order] of refusals) {
    const h = await openNewApp({ github: { account: ACCOUNT, ...github } });
    h.type(0, "Pixel Garden"); h.type(1, "A cosy game.");
    await h.start();
    assert.deepEqual(h.names(), order, `${label}: the folder is made, the build is still queued`);
    assert.equal(h.calls.filter(([name]) => name === "projectsCreate").length, 1, label);
    assert.deepEqual(h.toasts, [[reason, "warn"]], `${label}: the classified reason is toasted`);
    assert.equal(h.snapshot().panel, null, `${label}: the project stays open and the panel closes as it always does`);
    assert.equal(h.get("vibe-feedback").textContent, "Pixel Garden is ready, and its first build is split into 2 steps. It is only on this PC for now.", label);
    assert.ok(h.calls.filter(([name]) => name === "githubAccount").length >= 2, `${label}: who is signed in is looked at again`);
  }
});

test("Only on this PC calls nothing on GitHub and says nothing more than before", async () => {
  const h = await openNewApp();
  h.radios()[2].click();
  h.type(0, "Pixel Garden"); h.type(1, "A cosy game.");
  await h.start();
  assert.deepEqual(h.names(), ["projectsCreate", "vibeBuild"]);
  assert.equal(h.get("vibe-feedback").textContent, "Pixel Garden is ready, and its first build is split into 2 steps.");
  assert.deepEqual(h.toasts, []);
});

test("a description is still what starts the first build, publishing or not", async () => {
  const h = await openNewApp();
  h.type(0, "Notes");
  await h.start();
  assert.deepEqual(h.names(), ["projectsCreate", "gitPublishPreview", "gitPublish"], "no description, no build");
  assert.equal(h.get("vibe-feedback").textContent, `Notes is ready and open. Published ${ACCOUNT}/notes (private).`);
});

test("Start and link opens the picker once the folder exists and never holds the build for it", async () => {
  const h = await openNewApp();
  h.radios()[1].click();
  h.type(0, "Pixel Garden"); h.type(1, "A cosy game.");
  await h.start();
  assert.deepEqual(h.names(), ["projectsCreate", "showLink", "vibeBuild"], "the picker never resolves and the build still ran");
  assert.equal(h.calls.find(([name]) => name === "showLink")[1], 0, "the picker chooses; the panel names nothing");
  assert.equal(h.calls.some(([name]) => name === "gitPublish" || name === "gitPublishPreview"), false, "linking never publishes");
  assert.equal(h.get("vibe-feedback").textContent, "Pixel Garden is ready, and its first build is split into 2 steps. Choose the repository to link it to in the window that opened.");

  // What the picker says about a refusal is toasted; a picker that breaks costs nothing.
  const refused = await openNewApp({ sync: gitSync({ picker: async () => ({ ok: false, error: "GitHub's copy of a/b is a different project (no shared history)." }) }) });
  refused.radios()[1].click(); refused.type(0, "Notes");
  await refused.start();
  assert.deepEqual(refused.toasts, [["GitHub's copy of a/b is a different project (no shared history).", "warn"]]);
  const broken = await openNewApp({ sync: gitSync({ picker: () => { throw new Error("The picker is not ready."); } }) });
  broken.radios()[1].click(); broken.type(0, "Notes"); broken.type(1, "A notes app");
  await broken.start();
  assert.deepEqual(broken.toasts, [["The picker is not ready.", "warn"]]);
  assert.ok(broken.names().includes("vibeBuild"));
  assert.equal(broken.get("vibe-feedback").textContent, "Notes is ready, and its first build is split into 2 steps. It is only on this PC for now.");
});

test("without the link picker the panel offers only what it can do", async () => {
  const h = await openNewApp({ sync: gitSync({ picker: null }) });
  assert.deepEqual(h.radios().map((radio) => radio.dataset.choice), ["create", "local"]);
  const bare = await openNewApp({ sync: null });
  assert.deepEqual(bare.radios().map((radio) => radio.dataset.choice), ["create", "local"]);
});

test("signed out, New app offers the sign-in and keeps the folder on this PC", async () => {
  const github = { account: null };
  const h = await openNewApp({ github });
  assert.equal(h.body().querySelector(".vibe-gh-account").textContent, "Not signed in");
  assert.deepEqual(h.radios().map((radio) => [radio.dataset.choice, radio.disabled, radio.getAttribute("aria-checked")]), [["create", true, "false"], ["link", true, "false"], ["local", false, "true"]]);
  assert.deepEqual(h.radios().map((radio) => radio.querySelector("small").textContent), ["Sign in first", "Sign in first", "Publish any time later"]);
  assert.match(h.status().textContent, /Sign in to GitHub first to publish this project or link it to a repo\./);
  assert.match(h.status().textContent, /Studio never sees your password or token\./);
  assert.equal(h.make().textContent, "Start project");
  h.radios()[0].click();
  assert.equal(h.radios()[2].getAttribute("aria-checked"), "true", "a disabled choice cannot be picked");

  // Signing in: the chip's dialog when it is there, and the panel notices by itself.
  h.type(0, "Pixel Garden"); h.type(1, "A cosy game.");
  const typed = h.form().children[0].children[1];
  const button = h.body().querySelector(".vibe-gh-signin-go");
  assert.equal(button.textContent, "Sign in to GitHub");
  button.click(); await settle();
  assert.deepEqual(h.calls.filter(([name]) => name === "showSignIn"), [["showSignIn"]]);
  assert.equal(h.calls.some(([name]) => name === "pcSetupAction"), false);
  assert.match(h.status().textContent, /Finish in the window that opened\. This updates by itself\./);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 2000, "looks again every two seconds");
  await h.timers.shift().fn(); await settle();
  assert.equal(h.timers.length, 1, "still signed out: it keeps looking");
  github.account = ACCOUNT;
  await h.timers.shift().fn(); await settle();
  assert.equal(h.timers.length, 0, "signed in: it stops looking");
  assert.equal(h.body().querySelector(".vibe-gh-account").textContent, `Signed in as ${ACCOUNT}`);
  assert.deepEqual(h.radios().map((radio) => [radio.disabled, radio.getAttribute("aria-checked")]), [[false, "true"], [false, "false"], [false, "false"]], "a private repository becomes the default");
  assert.equal(h.make().textContent, "Start and publish");
  assert.equal(h.body().querySelector(".vibe-gh-repo").textContent, `${ACCOUNT}/pixel-garden`);
  assert.equal(h.form().children[0].children[1], typed, "the fields were not rebuilt");
  assert.equal(typed.value, "Pixel Garden");
});

test("a choice made before signing in survives it, and the panel stops looking when it closes", async () => {
  const github = { account: null };
  const h = await openNewApp({ github });
  h.radios()[2].click();
  h.body().querySelector(".vibe-gh-signin-go").click(); await settle();
  github.account = ACCOUNT;
  await h.timers.shift().fn(); await settle();
  assert.equal(h.radios()[2].getAttribute("aria-checked"), "true", "Only on this PC was picked, so signing in does not change it");
  assert.equal(h.make().textContent, "Start project");
  assert.equal(h.radios()[0].disabled, false, "though the repository can now be chosen");

  const closing = await openNewApp({ github: { account: null } });
  closing.body().querySelector(".vibe-gh-signin-go").click(); await settle();
  closing.window.MefiVibePanels.close({ quiet: true });
  await closing.timers.shift().fn(); await settle();
  assert.equal(closing.timers.length, 0, "a closed panel is not looked at again");
});

test("a New app with no name asks for one and touches nothing", async () => {
  const h = await openNewApp();
  await h.start();
  assert.equal(h.get("vibe-panel-note").textContent, "Give the new app a name.");
  assert.deepEqual(h.names(), []);
});

test("without the chip's dialog, signing in uses the setup window", async () => {
  const h = await openNewApp({ github: { account: null }, sync: gitSync({ signIn: false }) });
  h.body().querySelector(".vibe-gh-signin-go").click(); await settle();
  assert.deepEqual(h.calls.filter(([name]) => name === "pcSetupAction"), [["pcSetupAction", "github-login"]]);
  const bare = await openNewApp({ github: { account: null }, sync: null });
  bare.body().querySelector(".vibe-gh-signin-go").click(); await settle();
  assert.deepEqual(bare.calls.filter(([name]) => name === "pcSetupAction"), [["pcSetupAction", "github-login"]]);
  const refused = await openNewApp({ github: { account: null }, sync: null });
  refused.window.mefiStudio.pcSetupAction = async () => ({ ok: false, error: "That setup window is already open. Finish or close it first." });
  refused.body().querySelector(".vibe-gh-signin-go").click(); await settle();
  assert.deepEqual(refused.toasts, [["That setup window is already open. Finish or close it first.", "warn"]]);
});

test("a missing Git or GitHub CLI is installed from the same row", async () => {
  const noCli = await openNewApp({ github: { account: null, ghInstalled: false } });
  assert.match(noCli.status().textContent, /^GitHub CLI is not installed on this PC\./);
  const install = noCli.body().querySelector(".vibe-gh-signin-go");
  assert.equal(install.textContent, "Install GitHub CLI");
  install.click(); await settle();
  assert.deepEqual(noCli.calls.filter(([name]) => name === "pcSetupAction"), [["pcSetupAction", "install-gh"]]);
  const noGit = await openNewApp({ github: { account: null, gitInstalled: false, ghInstalled: false } });
  assert.match(noGit.status().textContent, /^Git is not installed\./);
  noGit.body().querySelector(".vibe-gh-signin-go").click(); await settle();
  assert.deepEqual(noGit.calls.filter(([name]) => name === "pcSetupAction"), [["pcSetupAction", "install-git"]]);
});

test("a host that cannot say who is signed in leaves the choice on this PC", async () => {
  const h = await openNewApp();
  h.window.mefiStudio.githubAccount = async () => { throw new Error("no host"); };
  h.window.MefiVibePanels.close({ quiet: true });
  h.window.MefiVibe.openPanel("newapp"); await settle();
  assert.equal(h.radios()[0].disabled, false, "a look that fails keeps what was known");
  const cold = await load({ quiet: true, github: { account: ACCOUNT }, sync: gitSync() });
  cold.window.mefiStudio.githubAccount = async () => ({ ok: false, error: "no gh" });
  cold.window.MefiVibe.openPanel("newapp"); await settle();
  assert.deepEqual([...cold.get("vibe-panel-body").querySelectorAll(".vibe-gh-choice")].map((radio) => radio.disabled), [true, true, false]);
});

test("retrying the first build never publishes twice, and the choice stays where it was", async () => {
  const h = await openNewApp();
  let attempts = 0;
  h.window.mefiStudio.vibeBuild = async () => (++attempts === 1 ? { ok: false, error: "Try again" } : { ok: true });
  h.type(0, "Pixel Garden"); h.type(1, "Grow plants");
  await h.start();
  assert.equal(h.calls.filter(([name]) => name === "gitPublish").length, 1);
  assert.equal(h.make().textContent, "Retry first build");
  assert.ok(h.radios().every((radio) => radio.disabled), "it was done once; the choice is settled");
  assert.equal(h.status().textContent, `Published ${ACCOUNT}/pixel-garden (private).`, "and the panel says how it went");
  h.radios()[2].click();
  assert.equal(h.radios()[0].getAttribute("aria-checked"), "true", "a settled choice cannot be changed");
  await h.start();
  assert.equal(attempts, 2);
  assert.equal(h.calls.filter(([name]) => name === "gitPublish").length, 1, "still once");
  assert.equal(h.calls.filter(([name]) => name === "projectsCreate").length, 1);
});

test("a folder that could not be opened is published once it opens", async () => {
  const h = await openNewApp();
  let creates = 0;
  h.window.mefiStudio.projectsCreate = async () => { creates++; return { ok: false, created: true, addedId: "p9", error: "A build is running" }; };
  h.window.mefiStudio.projectsSelect = async () => { h.active.id = "p9"; return { activeId: "p9" }; };
  h.type(0, "Notes"); h.type(1, "A notes app");
  await h.start();
  assert.equal(h.calls.some(([name]) => name === "gitPublish"), false, "nothing is published before the project is open");
  assert.equal(h.make().textContent, "Open app and start building");
  assert.equal(h.radios().some((radio) => radio.disabled), false, "and the choice can still change");
  await h.start();
  assert.equal(creates, 1);
  assert.equal(h.calls.filter(([name]) => name === "gitPublish").length, 1);
});

test("a git that would not start in the new folder is said, not published", async () => {
  const h = await openNewApp();
  h.window.mefiStudio.projectsCreate = async () => { h.active.id = "p9"; return { ok: true, selectedId: "p9", folder: "C:/Apps/notes", git: false }; };
  h.type(0, "Notes");
  await h.start();
  assert.equal(h.calls.some(([name]) => name === "gitPublish" || name === "gitPublishPreview"), false);
  assert.deepEqual(h.toasts, [["Git could not start in the new folder, so there is nothing to publish.", "warn"]]);
});

test("switching projects while GitHub answers stops the publish, never the folder", async () => {
  let h;
  const switched = "You switched projects, so nothing was published. Open the new app and publish it from the GitHub chip.";
  h = await openNewApp({ github: { account: ACCOUNT, preview: (args) => { h.active.id = "p2"; return { ok: true, valid: true, sanitized: args.name, taken: false }; } } });
  h.type(0, "Pixel Garden"); h.type(1, "A cosy game.");
  await h.start();
  assert.deepEqual(h.names(), ["projectsCreate", "gitPublishPreview", "vibeBuild"], "the host acts on the open project, so it is never asked once another one is open");
  assert.deepEqual(h.toasts, [[switched, "warn"]]);
  assert.equal(h.get("vibe-feedback").textContent, "Pixel Garden is ready, and its first build is split into 2 steps. It is only on this PC for now.");
  // A host that cannot say which project is open is not a reason to hold the publish back.
  const blind = await openNewApp();
  blind.window.mefiStudio.projectsList = async () => { throw new Error("no host"); };
  blind.type(0, "Notes");
  await blind.start();
  assert.ok(blind.names().includes("gitPublish"));
});

test("a second Start while the first still waits on GitHub is told to wait, not run again", async () => {
  const h = await openNewApp();
  const deal = later();
  h.window.mefiStudio.gitPublish = async (args) => { h.calls.push(["gitPublish", plain(args)]); return deal.promise; };
  h.type(0, "Pixel Garden"); h.type(1, "A cosy game.");
  await h.start();
  // Closing the panel and opening it again clears "busy" while the publish is still out.
  h.window.MefiVibePanels.close({ quiet: true });
  h.window.MefiVibe.openPanel("newapp"); await settle();
  await h.start();
  assert.equal(h.get("vibe-panel-note").textContent, "Still making it…");
  deal.resolve({ ok: true, repo: `${ACCOUNT}/pixel-garden` });
  await settle();
  assert.deepEqual(h.names(), ["projectsCreate", "gitPublishPreview", "gitPublish", "vibeBuild"], "one folder, one publish, one first build");
  // And once it is over the panel starts fresh.
  h.window.MefiVibe.openPanel("newapp"); await settle();
  h.type(0, "Second"); await h.start();
  assert.equal(h.calls.filter(([name]) => name === "projectsCreate").length, 2);
});

test("a toast that cannot show never fails the folder", async () => {
  const h = await openNewApp({ github: { account: ACCOUNT, publish: () => ({ ok: false, error: "GitHub did not accept the project." }) } });
  h.window.MefiToast = () => { throw new Error("no toasts here"); };
  h.type(0, "Pixel Garden"); h.type(1, "A cosy game.");
  await h.start();
  assert.deepEqual(h.names(), ["projectsCreate", "gitPublishPreview", "gitPublish", "vibeBuild"]);
  assert.equal(h.get("vibe-feedback").textContent, "Pixel Garden is ready, and its first build is split into 2 steps. It is only on this PC for now.");
});

test("a double Start while it runs leaves the progress line alone", async () => {
  const h = await openNewApp();
  const deal = later();
  h.window.mefiStudio.gitPublish = async (args) => { h.calls.push(["gitPublish", plain(args)]); return deal.promise; };
  h.type(0, "Pixel Garden");
  await h.start();
  assert.equal(h.get("vibe-panel-note").textContent, "Publishing to GitHub…");
  await h.start(); await h.start();
  assert.equal(h.get("vibe-panel-note").textContent, "Publishing to GitHub…", "the panel is still busy: a second Start says nothing and does nothing");
  deal.resolve({ ok: true, repo: `${ACCOUNT}/pixel-garden` });
  await settle();
  assert.equal(h.calls.filter(([name]) => name === "projectsCreate").length, 1);
  assert.equal(h.calls.filter(([name]) => name === "gitPublish").length, 1);
});

test("typing a name changes the final name in place and never rewrites the live region", async () => {
  const h = await openNewApp();
  h.type(0, "Pixel");
  const before = Array.from(h.status().children);
  const repo = h.body().querySelector(".vibe-gh-repo");
  assert.equal(repo.getAttribute("aria-live"), "off", "the name is not read out again on every key");
  h.type(0, "Pixel Garden");
  assert.equal(h.body().querySelector(".vibe-gh-repo"), repo, "the same node, new text");
  assert.equal(repo.textContent, `${ACCOUNT}/pixel-garden`);
  assert.ok(Array.from(h.status().children).every((node, index) => node === before[index]), "nothing is added to the region");
  // A change of choice is a change of what the region says: that one is rewritten.
  h.radios()[2].click();
  assert.notEqual(h.status().children[0], before[0]);
  h.type(0, "Pixel Garden 2");
  assert.equal(h.body().querySelector(".vibe-gh-repo"), null, "no name to keep in step when nothing is created");
});

test("a project somebody switched to before the publish is never the one published", async () => {
  const h = await openNewApp();
  // The host opened p9 for the new app; by the time GitHub is asked, another project is open.
  h.window.mefiStudio.projectsCreate = async () => { h.calls.push(["projectsCreate"]); h.active.id = "p2"; return { ok: true, selectedId: "p9", folder: "C:/Apps/notes" }; };
  h.type(0, "Notes"); h.type(1, "A notes app");
  await h.start();
  assert.equal(h.calls.some(([name]) => name === "gitPublish"), false);
  assert.deepEqual(h.toasts, [["You switched projects, so nothing was published. Open the new app and publish it from the GitHub chip.", "warn"]]);
  assert.ok(h.names().includes("vibeBuild"), "the folder and the first build go on");
});

test("whatever goes wrong in the GitHub step, the folder and the first build go on", async () => {
  const h = await openNewApp();
  // A result that throws when read is nothing a host does, and exactly what a guard is for.
  h.window.mefiStudio.projectsCreate = async () => ({ ok: true, selectedId: "p9", folder: "C:/Apps/notes", get git() { throw new Error("the folder result could not be read"); } });
  h.type(0, "Notes"); h.type(1, "A notes app");
  await h.start();
  assert.deepEqual(h.toasts, [["the folder result could not be read", "warn"]]);
  assert.ok(h.names().includes("vibeBuild"));
  assert.equal(h.get("vibe-feedback").textContent, "Notes is ready, and its first build is split into 2 steps. It is only on this PC for now.");
});

test("a panel opened while GitHub answers is left open when the new app is done", async () => {
  const h = await openNewApp();
  const deal = later();
  h.window.mefiStudio.gitPublish = async (args) => { h.calls.push(["gitPublish", plain(args)]); return deal.promise; };
  h.type(0, "Pixel Garden");
  await h.start();
  h.window.MefiVibePanels.close({ quiet: true });
  h.window.MefiVibe.openPanel("tasks"); await settle();
  deal.resolve({ ok: true, repo: `${ACCOUNT}/pixel-garden` });
  await settle();
  assert.equal(h.window.MefiVibePanels.current(), "tasks", "the new app finished; the panel somebody moved on to stays");
  assert.equal(h.get("vibe-feedback").textContent, `Pixel Garden is ready and open. Published ${ACCOUNT}/pixel-garden (private).`);
});

test("signed in without Git, nothing can be made or linked, and the row says what is missing", async () => {
  const h = await openNewApp({ github: { account: ACCOUNT, gitInstalled: false } });
  assert.deepEqual(h.radios().map((radio) => [radio.dataset.choice, radio.disabled, radio.getAttribute("aria-checked")]), [["create", true, "false"], ["link", true, "false"], ["local", false, "true"]]);
  assert.deepEqual(h.radios().map((radio) => radio.querySelector("small").textContent), ["Install Git first", "Install Git first", "Publish any time later"]);
  assert.equal(h.make().textContent, "Start project", "no doomed default");
  assert.match(h.status().textContent, /^Git is not installed\./);
  h.body().querySelector(".vibe-gh-signin-go").click(); await settle();
  assert.deepEqual(h.calls.filter(([name]) => name === "pcSetupAction"), [["pcSetupAction", "install-git"]]);
  h.type(0, "Notes");
  await h.start();
  assert.equal(h.calls.some(([name]) => name === "gitPublish" || name === "gitPublishPreview"), false);
});

test("the finish-in-the-window line belongs to the window that was opened", async () => {
  const github = { account: null, gitInstalled: false, ghInstalled: false };
  const h = await openNewApp({ github });
  h.body().querySelector(".vibe-gh-signin-go").click(); await settle();
  assert.match(h.status().textContent, /Finish in the window that opened/);
  github.gitInstalled = true;
  await h.timers.shift().fn(); await settle();
  assert.match(h.status().textContent, /^GitHub CLI is not installed on this PC\./);
  assert.doesNotMatch(h.status().textContent, /Finish in the window that opened/, "no window was opened for this one yet");
  assert.equal(h.timers.length, 1, "it keeps looking");
  h.body().querySelector(".vibe-gh-signin-go").click(); await settle();
  assert.match(h.status().textContent, /Finish in the window that opened/);
});

test("the repository name the panel shows is the one scripts/git-link.cjs would make", async () => {
  const { repoName } = require("../scripts/git-link.cjs");
  const { slugOf } = require("../scripts/new-app.cjs");
  const { window } = await load({ quiet: true });
  const folders = ["pixel-garden", "field-notes", "a", "x-1", "Mefi's Studio AI+", "Pixel Garden", "  spaced   out  ", "café déjà vu", "UPPER lower", "under_score", "dots.and.dashes-2.0",
    ".git", "app.git", "app.GIT", "a.git.git", ".github", "..", ".", "-lead-", "trail.", "a--b", "x".repeat(120), `${"y".repeat(98)}.git`, "日本語", "emoji 🚀 app", "", "   ",
    // Apostrophes vanish, and cutting to 100 can uncover a trailing dot, hyphen or ".git".
    "O'Brien’s Café", "itʼs `mine`", "Mefi's Studio AI+", `${"z".repeat(99)}-y`, `${"w".repeat(96)}.git-git`, `${"v".repeat(97)}.git.git`, "a.git-", "-.git.-", ".-.", "x.git.", "My App.git"];
  for (const folder of folders) {
    assert.equal(window.MefiVibePanels.repoName(folder), repoName(folder), `folder ${JSON.stringify(folder)}`);
    assert.equal(window.MefiVibePanels.repoName(slugOf(folder)), repoName(slugOf(folder)), `slug of ${JSON.stringify(folder)}`);
  }
  // And a few thousand made-up names from the pieces that trip a sanitiser: dots, hyphens, ".git", quotes, accents, other scripts.
  const pieces = ["a", "B", "z", "0", "9", ".", "-", "_", " ", "'", "\u2019", "`", "é", "ñ", "\u0301", "日", "😀", ".git", ".GIT", "..", "--", "/", "+", "ß", "ǆ", "ﬁ"];
  let seed = 20260929;
  const roll = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let round = 0; round < 3000; round += 1) {
    let made = "";
    for (let piece = 0, length = 1 + roll(130); piece < length; piece += 1) made += pieces[roll(pieces.length)];
    assert.equal(window.MefiVibePanels.repoName(made), repoName(made), `made-up name ${JSON.stringify(made)}`);
    assert.equal(window.MefiVibePanels.repoName(slugOf(made)), repoName(slugOf(made)), `slug of made-up name ${JSON.stringify(made)}`);
  }
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

test("Ask for a change keeps the draft, cites the task like Build does and puts the caret on the change", async () => {
  const { window, get, fire, panelButtons, snapshot } = await load({ finished: true });
  const input = get("vibe-input");
  input.setSelectionRange = (start, end) => { input.selection = [start, end]; };
  input.value = "Keep my existing draft";
  fire(input, "input");
  window.MefiVibe.openPanel("tasks", { taskId: "t9" });
  assert.deepEqual(panelButtons().map((button) => button.textContent), ["Ask for a change"]);
  panelButtons()[0].click();
  assert.equal(input.value, 'Keep my existing draft\n\nFollow-up to task "Dark mode" (t9).\n\nRequested change:\n\nDone when:\n- ');
  assert.equal(snapshot().panel, null, "the panel steps aside for the box");
  assert.equal(input.focused, true);
  assert.equal(input.selection[0], input.selection[1]);
  assert.ok(input.value.slice(0, input.selection[0]).endsWith("Requested change:\n"), "the caret waits on the change's own line");
  assert.equal(input.value.slice(input.selection[0]), "\nDone when:\n- ");
  // Another project's task never lands in this project's draft.
  const refused = plain(window.MefiVibe.requestChange({ id: "x1", projectId: "p2", title: "Elsewhere", status: "done" }));
  assert.equal(refused.ok, false);
  assert.match(input.value, /^Keep my existing draft\n\nFollow-up to task "Dark mode"/);
});

test("Freshly done shows what finished lately: never dropped work, never an old card written to again", async () => {
  const { window, get, panelRows } = await load({ finished: true, closed: true });
  const lane = get("vibe-lane-done").children;
  assert.deepEqual(lane.map((row) => row.children[0].children[1].textContent), ["Dark mode"], "the dropped card and the old ones stay out");
  assert.equal(lane[0].children[0].children[2].textContent, "verified · 1 h ago");
  // The Tasks panel keeps them all, dated by when they closed.
  window.MefiVibe.openPanel("tasks", { fold: "done" });
  const done = panelRows().filter((row) => ["Drop the old parser", "Dark mode", "Old result", "Archived last week"].includes(row.children[1].textContent));
  assert.deepEqual(done.map((row) => [row.children[1].textContent, row.children[2].textContent]), [
    ["Drop the old parser", "dropped · 1 min ago"], ["Dark mode", "verified · 1 h ago"], ["Old result", "done · 3 d ago"], ["Archived last week", "done · 7 d ago"],
  ]);
});

test("a Building now row stops its worker with the Tasks panel's two-press Stop", async () => {
  const { window, get, calls } = await load({ running: true, ui: true });
  const rows = get("vibe-lane-building").children;
  const stop = rows[0].children[1];
  assert.equal(stop.textContent, "Stop");
  assert.ok(stop.classList.contains("danger"));
  assert.equal(rows[1].children.length, 1, "a card being checked has no worker to stop");
  stop.click();
  assert.equal(stop.textContent, "Stop it?", "the first press asks");
  assert.equal(calls.filter(([name]) => name === "tasksAction").length, 0);
  // The worker's live line moves on while it asks: the asking button stays.
  const status = await window.mefiStudio.assistantStatus();
  window.mefiStudio.assistantStatus = async () => ({ ...status, status: { ...status.status, running: status.status.running.map((job) => ({ ...job, progress: 0.5 })) } });
  await window.MefiVibe.refresh();
  assert.equal(get("vibe-lane-building").children[0].children[1], stop);
  assert.equal(stop.textContent, "Stop it?");
  stop.click();
  await settle();
  assert.deepEqual(calls.filter(([name]) => name === "tasksAction"), [["tasksAction", "stop", "t1"]]);
  assert.equal(get("vibe-feedback").textContent, "Stopped. It waits for you under Needs you.");
});
