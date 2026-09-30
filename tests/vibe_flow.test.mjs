// Vibe's long waits, live (renderer/vibe-flow.js): the planner looking for
// next steps and the lead sizing a request each show one strip that follows
// the host's vibe:progress steps. The real vibe-flow.js, vibe-panels.js and
// vibe.js run here in the shared fake DOM against a stand-in bridge whose
// planningExplore and vibeBuild answer when the test says, with timers the
// test releases, so every in-between state can be read.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom, templateIds } from "./fixtures/renderer-dom.mjs";

const flowSource = await readFile(new URL("../renderer/vibe-flow.js", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../renderer/vibe-panels.js", import.meta.url), "utf8");
const vibeSource = await readFile(new URL("../renderer/vibe.js", import.meta.url), "utf8");
const P = "p1";
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let turn = 0; turn < 16; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };

// A deferred reply the test settles by hand.
function later() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// studio-ui.js MefiUi.arm's contract: the first press shows the question
// (.danger-armed), the second runs, and unpressed it lapses after 3 s on
// the test's clock.
const armStub = (setTimer) => ({ arm(button, { run, armed }) {
  let timer = 0, resting = "";
  const disarm = () => { if (!timer) return; timer = 0; button.textContent = resting; button.classList.remove("danger-armed"); };
  button.addEventListener("click", (event) => { if (!timer) { resting = button.textContent; button.textContent = armed; button.classList.add("danger-armed"); timer = setTimer(disarm, 3000); return; } disarm(); run(event); });
  return button;
} });

function load({ vibe = false, storage = new Map(), bridge = {}, ui = false } = {}) {
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("vibe-")) });
  const lookup = document.getElementById;
  document.getElementById = (id) => lookup(id) ?? document.querySelector(`#${id}`);
  document.documentElement.dataset = {};
  for (const id of ["vibe-layer", "vibe-ask", "vibe-chat", "vibe-panel", "vibe-gate", "vibe-panel-back", "vibe-flow"]) get(id).hidden = true;
  const subscribers = {};
  const calls = [];
  const api = {
    onVibeProgress: (callback) => { (subscribers.progress ||= []).push(callback); },
    projectsList: async () => ({ projects: [{ id: P, name: "Sunrise" }], activeId: P }),
    tasksList: async () => ({ ok: true, projectId: P, tasks: [] }),
    assistantState: async () => ({ ok: true, state: { projectId: P, status: "running", questions: [], messages: [], ai: { keyPresent: true } } }),
    assistantStatus: async () => ({ ok: true, status: { held: false, execute: true, autoBuild: true, running: [] } }),
    backlogStatus: async () => ({ ok: true, projectId: P, counts: {}, next: [], approval: [], blocked: [], taskStates: [] }),
    ideasList: async () => ({ ok: true, projectId: P, ideas: [] }),
    planningList: async () => ({ ok: true, projectId: P, plans: [] }),
    ...bridge,
  };
  // Timers wait until the test runs them; ids let clearTimeout drop one.
  const timers = new Map();
  let nextTimer = 1;
  const setTimer = (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; };
  const window = {
    addEventListener() {}, dispatchEvent() { return true; },
    mefiStudio: api,
    MefiNav: { register() {}, current: () => "vibe", go: (id, params) => calls.push(["go", id, params ?? null]) },
    ...(ui ? { MefiUi: armStub(setTimer) } : {}),
  };
  const context = vm.createContext({
    window, document, console,
    location: { search: "" },
    localStorage: { getItem: (key) => storage.get(key) ?? (key === "mefiStudio.uiMode" ? "vibe" : null), setItem: (key, value) => storage.set(key, String(value)), length: 0, key: () => null },
    requestAnimationFrame: () => 0,
    setTimeout: setTimer,
    clearTimeout: (id) => { timers.delete(id); },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  });
  vm.runInContext(flowSource, context);
  if (vibe) { vm.runInContext(panelSource, context); vm.runInContext(vibeSource, context); }
  // Runs every timer due within `ms` (the clock's own ticks re-arm, so a pass is bounded).
  const runTimers = (ms = Infinity) => {
    for (const [id, timer] of [...timers]) if (timer.ms <= ms) { timers.delete(id); timer.fn(); }
  };
  const push = (payload) => { for (const callback of subscribers.progress || []) callback(payload); };
  return { window, document, get, flow: window.MefiVibeFlow, push, runTimers, timers, calls, storage };
}

test("a run follows only its own named steps, in order, and ends with its reply", () => {
  const { flow, push } = load();
  const heard = [];
  flow.on((run) => heard.push(run.stage));
  const run = flow.begin("explore", { projectId: P, title: "Improve this project" });
  assert.match(run.id, /^vibe-explore-/);
  assert.deepEqual(plain(flow.stages(run).map((stage) => stage.state)), ["now", "next", "next"], "reading the project comes first");
  push({ requestId: "someone-else", projectId: P, stage: "read", scanned: 9 });
  push({ requestId: run.id, projectId: "p2", stage: "read", scanned: 9 });
  push({ requestId: run.id, projectId: P, stage: "painting" });
  assert.deepEqual(plain(run.seen), {}, "another request, another project and an unknown stage are ignored");
  push({ requestId: run.id, projectId: P, stage: "read", scanned: 214, files: ["src/main.lua", "src/player.lua", 7] });
  push({ requestId: run.id, projectId: P, stage: "asking", seat: "routine", provider: "zen", model: "gpt-6-luna" });
  const stages = flow.stages(run);
  assert.deepEqual(plain(stages.map((stage) => stage.state)), ["done", "now", "next"]);
  assert.equal(stages[0].detail, "214 files scanned · 2 files look relevant");
  assert.equal(stages[1].detail, "GPT 6 Luna is thinking");
  assert.deepEqual(plain(run.seen.read.files), ["src/main.lua", "src/player.lua"], "only file names are kept");
  flow.end(run.id, { ok: true, count: 3 });
  assert.deepEqual(plain(flow.stages(run).map((stage) => stage.state)), ["done", "done", "done"]);
  assert.equal(flow.headline(run), "Found 3 next steps");
  push({ requestId: run.id, projectId: P, stage: "asking", model: "late" });
  assert.equal(run.seen.asking.model, "gpt-6-luna", "a step after the reply changes nothing");
  assert.deepEqual(heard, ["start", "read", "asking", "asking"], "listeners hear the start, each step and the end");
});

test("sizing names the lead, its tool turns and the planned steps; a small ask skips the split", () => {
  const { flow, push } = load();
  const run = flow.begin("size", { projectId: P, title: "Add a save system" });
  push({ requestId: run.id, projectId: P, stage: "quick", verdict: "maybe", reason: "names a body of work" });
  push({ requestId: run.id, projectId: P, stage: "sizing", seat: "lead", provider: "zen", model: "gpt-6-sol" });
  push({ requestId: run.id, projectId: P, stage: "tool", name: "web_search", ok: true });
  let stages = flow.stages(run);
  assert.deepEqual(plain(stages.map((stage) => stage.state)), ["done", "now", "next"]);
  assert.equal(stages[1].detail, "GPT 6 Sol is splitting it · searched the web");
  assert.equal(flow.line(run), "Plan the steps: GPT 6 Sol is splitting it · searched the web", "Team's one line for it");
  push({ requestId: run.id, projectId: P, stage: "sized", size: "steps", steps: [{ title: "Save data", after: [] }, { title: "Slots menu", after: [0] }] });
  push({ requestId: run.id, projectId: P, stage: "adding" });
  assert.equal(flow.headline(run), "Splitting it into 2 steps");
  flow.end(run.id, { ok: true, steps: 2 });
  stages = flow.stages(run);
  assert.deepEqual(plain(stages.map((stage) => stage.state)), ["done", "done", "done"]);
  assert.equal(stages[2].detail, "2 steps and a final check");
  assert.equal(flow.headline(run), "Split into 2 steps");

  const small = flow.begin("size", { projectId: P, title: "Fix the jump sound" });
  push({ requestId: small.id, projectId: P, stage: "quick", verdict: "one", reason: "a short ask" });
  push({ requestId: small.id, projectId: P, stage: "adding" });
  assert.deepEqual(plain(flow.stages(small).map((stage) => stage.state)), ["done", "skipped", "now"]);
  flow.end(small.id, { ok: true, steps: 0 });
  assert.equal(flow.headline(small), "Added as one task");
});

test("a failed run marks the stage it stopped at, and only model runs teach the usual time", () => {
  const { flow, push, storage } = load();
  const failed = flow.begin("explore", { projectId: P });
  push({ requestId: failed.id, projectId: P, stage: "read", scanned: 3, files: [] });
  flow.end(failed.id, { ok: false, error: "No connection configured" });
  const stages = flow.stages(failed);
  assert.equal(stages[1].state, "failed");
  assert.equal(stages[1].detail, "No connection configured");
  assert.equal(flow.headline(failed), "Mefi couldn't finish looking");
  assert.equal(storage.has("mefiStudio.vibe.flowTimes"), false, "a failure is no measure of the usual time");

  const quick = flow.begin("size", { projectId: P });
  quick.startedAt -= 5000;
  flow.end(quick.id, { ok: true });
  assert.equal(storage.has("mefiStudio.vibe.flowTimes"), false, "a request sized without a model call is not timed");

  for (const ms of [20000, 30000, 40000]) {
    const run = flow.begin("explore", { projectId: P });
    run.startedAt -= ms;
    flow.end(run.id, { ok: true, count: 1 });
  }
  assert.ok(Math.abs(flow.typical("explore") - 30000) < 1000, "the median of this machine's runs");
  assert.equal(flow.typical("size"), null, "no guess before two runs");
});

test("one view per run is updated in place: stages, files once each, the clock, then the outcome", () => {
  const { flow, push } = load();
  const run = flow.begin("explore", { projectId: P });
  const view = flow.view(run);
  assert.equal(flow.view(run), view, "the same element every time");
  assert.equal(view.dataset.state, "running");
  assert.ok(Number(view.querySelector(".vibe-flow-clock").dataset.flowSince) > 0, "a running clock");
  push({ requestId: run.id, projectId: P, stage: "read", scanned: 40, files: ["src/a.js", "src/b.js"] });
  push({ requestId: run.id, projectId: P, stage: "read", scanned: 40, files: ["src/a.js", "src/b.js", "src/c.js"] });
  assert.deepEqual(view.querySelectorAll(".vibe-flow-file").map((chip) => chip.dataset.file), ["src/a.js", "src/b.js", "src/c.js"], "a file already shown is not added again");
  assert.deepEqual(view.querySelectorAll(".vibe-flow-stage").map((stage) => stage.className), ["vibe-flow-stage is-done", "vibe-flow-stage is-now", "vibe-flow-stage is-next"]);
  flow.end(run.id, { ok: true, count: 2 });
  assert.equal(view.dataset.state, "done");
  assert.equal(view.querySelector(".vibe-flow-clock").dataset.flowSince, undefined, "a finished clock stops");
  assert.match(view.querySelector(".vibe-flow-clock").textContent, /^\d+ s$/);
  assert.equal(view.querySelector(".vibe-flow-title").textContent, "Found 2 next steps");
  const button = flow.action(run, { label: "Show the plan →", run: () => {} });
  assert.equal(view.querySelector(".vibe-flow-actions").children[0], button);

  const size = flow.begin("size", { projectId: P });
  const steps = flow.view(size);
  push({ requestId: size.id, projectId: P, stage: "sized", size: "steps", steps: [{ title: "One", after: [] }, { title: "Two", after: [0] }] });
  assert.deepEqual(steps.querySelectorAll(".vibe-flow-step").map((item) => item.textContent), ["1One", "2Twoafter 1", "✓Then: put it together and check the whole thing"]);
});

test("the Team panel's list is the runs still going, for the open project", () => {
  const { flow } = load();
  const mine = flow.begin("explore", { projectId: P });
  const other = flow.begin("size", { projectId: "p2" });
  assert.deepEqual(plain(flow.active(P).map((run) => run.id)), [mine.id]);
  flow.end(mine.id, { ok: true });
  assert.deepEqual(plain(flow.active(P)), []);
  assert.deepEqual(plain(flow.active("p2").map((run) => run.id)), [other.id]);
});

test("names: a readable model id, a tool's own name, and a worker's tool and step", () => {
  const { flow } = load();
  assert.equal(flow.modelName("deepseek-v4.1-flash"), "Deepseek V4.1 Flash");
  assert.equal(flow.modelName("opencode-go/glm-5.3"), "GLM 5.3");
  assert.equal(flow.providerName("claude"), "Claude Code");
  assert.deepEqual(plain(flow.doing({ route: "opencode", currentStep: "Edit running · 3s · src/player.lua" })), { tool: "OpenCode", step: "Edit running · 3s · src/player.lua" });
  assert.deepEqual(plain(flow.doing({ route: "codex", activity: "Reading the tests" })), { tool: "Codex", step: "Reading the tests" });
  assert.deepEqual(plain(flow.doing(null)), { tool: "", step: "" });
});

// ---- inside Vibe ------------------------------------------------------------------

test("Suggest a next step names its request, shows the live run over placeholders, then the ideas", async () => {
  const reply = later();
  const asks = [];
  const h = load({ vibe: true, bridge: { planningExplore: async (payload) => { asks.push(plain(payload)); return reply.promise; } } });
  await h.window.MefiVibe.enter(); await settle();
  h.get("vibe-input").value = "Improve the preview.";
  const pending = h.window.MefiVibe.suggestEvolution();
  const results = h.get("vibe-sparks").querySelector(".vibe-evolution-results");
  const view = results.querySelector(".vibe-flow-run");
  assert.ok(view, "the live run shows in the results");
  assert.match(asks[0].requestId, /^vibe-explore-/, "the host is told which run it reports to");
  assert.equal(results.querySelectorAll(".vibe-flow-ghost").length, 3, "placeholders where the ideas will land");
  h.push({ requestId: asks[0].requestId, projectId: P, stage: "read", scanned: 12, files: ["renderer/preview.js"] });
  assert.equal(results.querySelector(".vibe-flow-run"), view, "a step updates the same strip");
  assert.equal(view.querySelector(".vibe-flow-file").textContent, "preview.js");
  assert.equal(h.flow.active(P).length, 1, "Team can list it while it runs");
  reply.resolve({ ok: true, projectId: P, summary: "The preview has a toolbar.", suggestions: [
    { id: "suggestion-0", label: "Preview contrast", text: "Increase preview text contrast.", files: ["renderer/preview.js"] },
    { id: "suggestion-1", label: "Zoom buttons", text: "Add zoom in and out.", files: [] },
  ] });
  await pending;
  assert.equal(results.querySelector(".vibe-flow-run"), null, "the strip steps aside for the ideas");
  assert.match(results.querySelector(".vibe-evolution-facts").textContent, /^2 ideas · found in \d+ s · 12 files scanned$/);
  assert.equal(h.flow.active(P).length, 0);
  assert.match(h.get("vibe-sparks").querySelector("[role=status]").textContent, /2 suggestions ready/);
});

test("adding one suggestion keeps the rest of its set usable, and Clear puts them away", async () => {
  const h = load({ vibe: true, bridge: { planningExplore: async () => ({ ok: true, projectId: P, summary: "Two ideas.", suggestions: [
    { id: "suggestion-0", label: "First", text: "Do the first thing." }, { id: "suggestion-1", label: "Second", text: "Do the second thing." },
  ] }) } });
  await h.window.MefiVibe.enter(); await settle();
  h.get("vibe-input").value = "Improve it.";
  await h.window.MefiVibe.suggestEvolution();
  const cards = () => h.get("vibe-sparks").querySelectorAll(".vibe-evolution-suggestion");
  cards()[0].querySelector(".vibe-btn").click();
  assert.match(h.get("vibe-input").value, /Improve: First/);
  assert.equal(cards()[0].querySelector(".vibe-btn").textContent, "Added to draft");
  assert.equal(cards()[0].querySelector(".vibe-btn").disabled, true);
  assert.equal(cards()[1].querySelector(".vibe-btn").disabled, false, "the second suggestion can still be added");
  assert.doesNotMatch(h.get("vibe-sparks").textContent, /Your draft changed/);
  cards()[1].querySelector(".vibe-btn").click();
  assert.match(h.get("vibe-input").value, /Improve: First[\s\S]*Improve: Second/);
  h.get("vibe-sparks").querySelector(".vibe-evolution-clear").click();
  assert.equal(cards().length, 0);
  assert.equal(h.get("vibe-sparks").querySelector(".vibe-evolution-results").hidden, true);
});

test("Build it shows the sizing strip under the box only when the wait outlasts a blink", async () => {
  const replies = [];
  const h = load({ vibe: true, bridge: { vibeBuild: (payload) => { const reply = later(); replies.push({ payload: plain(payload), reply }); return reply.promise; } } });
  await h.window.MefiVibe.enter(); await settle();
  const slot = h.get("vibe-flow");
  const build = async (text) => { h.get("vibe-input").value = text; for (const fn of h.get("vibe-compose").listeners.submit) fn({ preventDefault() {} }); await settle(); };

  await build("Fix the jump sound");
  assert.match(replies[0].payload.requestId, /^vibe-size-/);
  replies[0].reply.resolve({ ok: true, task: { id: "t1" } });
  await settle();
  h.runTimers(350);
  assert.equal(slot.hidden, true, "a quick answer never flashes the strip");

  await build("Add a save system with three slots, autosave and a load menu");
  const { payload, reply } = replies[1];
  assert.equal(h.get("vibe-feedback").textContent, "", "the strip speaks while it waits, not a second line");
  h.runTimers(350);
  assert.equal(slot.hidden, false, "a longer wait shows the strip");
  const view = slot.querySelector(".vibe-flow-run");
  h.push({ requestId: payload.requestId, projectId: P, stage: "quick", verdict: "maybe" });
  h.push({ requestId: payload.requestId, projectId: P, stage: "sizing", seat: "lead", model: "gpt-6-sol" });
  assert.deepEqual(view.querySelectorAll(".vibe-flow-stage").map((stage) => stage.className), ["vibe-flow-stage is-done", "vibe-flow-stage is-now", "vibe-flow-stage is-next"]);
  h.push({ requestId: payload.requestId, projectId: P, stage: "sized", size: "steps", steps: [{ title: "Save data", after: [] }, { title: "Slots menu", after: [0] }, { title: "Load menu", after: [1] }] });
  reply.resolve({ ok: true, task: { id: "f0" }, steps: 3 });
  await settle();
  assert.equal(view.dataset.state, "done");
  assert.match(h.get("vibe-feedback").textContent, /^Split into 3 steps, then a final check\./);
  const show = view.querySelector(".vibe-flow-action");
  assert.equal(show.textContent, "Show the plan →");
  show.click();
  assert.equal(slot.hidden, true, "Show the plan puts the strip away");
  assert.equal(h.window.MefiVibePanels.current(), "plans");
  assert.deepEqual(plain(h.window.MefiVibePanels.view()), { view: "family", id: "f0" });
});

test("a failed sizing marks where it stopped and leaves the text in the box", async () => {
  const h = load({ vibe: true, bridge: { vibeBuild: async () => { await new Promise((resolve) => setImmediate(resolve)); return { ok: false, error: "The lead did not answer." }; } } });
  await h.window.MefiVibe.enter(); await settle();
  h.get("vibe-input").value = "Add a save system with three slots, autosave and a load menu";
  for (const fn of h.get("vibe-compose").listeners.submit) fn({ preventDefault() {} });
  await settle();
  assert.equal(h.flow.active(P).length, 0, "the run ended with the reply");
  assert.match(h.get("vibe-feedback").textContent, /The lead did not answer\. Your text is still in the box\./);
  assert.equal(h.get("vibe-input").value, "Add a save system with three slots, autosave and a load menu");
});

// ---- the agent team on a split request ----------------------------------------------

// A request split into four steps: one done, one being built by OpenCode, one
// waiting on the step being built, one waiting on the first.
function familyBridge(extra = {}) {
  const now = Date.now();
  const calls = [];
  const tasks = [
    { id: "f0", projectId: P, title: "Save system", status: "open", updatedAt: now, delegation: { version: 1, intake: true, summary: "Data first, then menus.", childTaskIds: ["f1", "f2", "f3", "f4"] } },
    { id: "f1", projectId: P, title: "Save data", status: "done", parentTaskId: "f0", delegatedFrom: { intake: true, parentTaskId: "f0" }, updatedAt: now - 60000 },
    { id: "f2", projectId: P, title: "Slots menu", status: "active", parentTaskId: "f0", delegatedFrom: { intake: true, parentTaskId: "f0" }, dependsOn: ["f1"], updatedAt: now - 5000 },
    { id: "f3", projectId: P, title: "Load menu", status: "open", parentTaskId: "f0", delegatedFrom: { intake: true, parentTaskId: "f0" }, dependsOn: ["f2"], updatedAt: now - 4000 },
    { id: "f4", projectId: P, title: "Autosave", status: "open", parentTaskId: "f0", delegatedFrom: { intake: true, parentTaskId: "f0" }, dependsOn: ["f1"], updatedAt: now - 3000 },
  ];
  const job = { taskId: "f2", projectId: P, title: "Slots menu", phase: "building", startedAt: now - 120000, progress: 0.4, route: "opencode", currentStep: "Edit running · 3s · src/menu.lua" };
  return {
    calls,
    bridge: {
      tasksList: async () => ({ ok: true, projectId: P, tasks }),
      assistantStatus: async () => ({ ok: true, status: { held: false, execute: true, autoBuild: true, running: [job] } }),
      backlogStatus: async () => ({ ok: true, projectId: P, counts: {}, next: [], approval: [], blocked: [], taskStates: [{ id: "f2", stage: "running" }, { id: "f3", stage: "waiting" }, { id: "f4", stage: "ready" }] }),
      tasksAction: async (args) => { calls.push([args.action, args.taskId]); return { ok: true }; },
      ...extra,
    },
  };
}

test("the plan card draws the steps as a track and names who is on the step being built", async () => {
  const { bridge } = familyBridge();
  const h = load({ vibe: true, bridge });
  await h.window.MefiVibe.enter(); await settle();
  const [row, track, line] = h.get("vibe-lane-plan").children;
  assert.match(row.textContent, /Save system1 of 4 steps done/);
  assert.deepEqual(track.children.map((node) => node.className), ["vibe-step is-done", "vibe-step is-running", "vibe-step is-waiting", "vibe-step is-waiting"]);
  assert.deepEqual(track.children.map((node) => node.textContent), ["1", "2", "3", "4"], "numbered nodes; the titles are their tooltips");
  assert.equal(track.children[1].title, "2. Slots menu: building");
  assert.equal(track.dataset.final, "waiting", "the final check waits for the last step");
  assert.equal(line.className, "vibe-plan-now is-live");
  assert.equal(line.children[0].textContent, "Step 2 · Slots menu");
  assert.equal(line.children[1].textContent, "OpenCode · Edit running · 3s · src/menu.lua");
  const building = h.get("vibe-lane-building").children[0];
  assert.match(building.querySelector(".vibe-row-meta").textContent, /^OpenCode · building · started 2 min ago$/);
  assert.equal(building.querySelector(".vibe-row-now").textContent, "Edit running · 3s · src/menu.lua", "what the worker is doing, under its row");
});

test("the plan panel is a timeline of who does what, and Make it one task is one host call", async () => {
  const { bridge, calls } = familyBridge();
  const h = load({ vibe: true, bridge });
  await h.window.MefiVibe.enter(); await settle();
  h.window.MefiVibe.openPanel("plans", { familyId: "f0" });
  const body = h.get("vibe-panel-body");
  assert.ok(body.querySelector(".vibe-timeline"), "the steps sit on one line");
  const rows = body.querySelectorAll(".vibe-row-main");
  assert.deepEqual(rows.map((row) => row.children[1].textContent), ["1. Save data", "2. Slots menu", "3. Load menu", "4. Autosave", "Then: put it together and check the whole thing"]);
  const meta = rows.map((row) => row.querySelector(".vibe-row-meta")?.textContent);
  assert.match(meta[0], /^done · \d+ min ago$/);
  assert.equal(meta[1], "building · OpenCode · started 2 min ago");
  assert.equal(rows[1].querySelector(".vibe-row-now").textContent, "Edit running · 3s · src/menu.lua");
  assert.equal(meta[2], "waits for step 2");
  assert.equal(meta[3], "waiting its turn", "a step whose prerequisite is done just waits its turn");
  assert.deepEqual(body.querySelectorAll(".vibe-ask-chip").map((chip) => chip.textContent), ["1 of 4 done", "1 building now"]);
  const merge = body.querySelectorAll(".vibe-ask-actions button").find((button) => button.textContent === "Make it one task");
  merge.click(); await settle();
  assert.deepEqual(calls, [["merge-steps", "f0"]], "the atomic host action, never a drop per step");
});

test("Make it one task drops the unstarted steps only on the second press", async () => {
  const { bridge, calls } = familyBridge();
  const h = load({ vibe: true, bridge, ui: true });
  await h.window.MefiVibe.enter(); await settle();
  h.window.MefiVibe.openPanel("plans", { familyId: "f0" });
  const merge = h.get("vibe-panel-body").querySelectorAll(".vibe-ask-actions button").find((button) => button.textContent === "Make it one task");
  merge.click(); await settle();
  assert.deepEqual(calls, [], "the first press only asks");
  assert.equal(merge.textContent, "Drop the unstarted steps?");
  merge.click(); await settle();
  assert.deepEqual(calls, [["merge-steps", "f0"]]);
});

test("a worker's push between the two presses keeps Make it one task asking; the panel catches up after", async () => {
  let step = "Edit running · 3s · src/menu.lua";
  const { bridge, calls } = familyBridge({ assistantStatus: async () => ({ ok: true, status: { held: false, execute: true, autoBuild: true, running: [{ taskId: "f2", projectId: P, title: "Slots menu", phase: "building", startedAt: Date.now() - 120000, route: "opencode", currentStep: step }] } }) });
  const h = load({ vibe: true, bridge, ui: true });
  await h.window.MefiVibe.enter(); await settle();
  h.window.MefiVibe.openPanel("plans", { familyId: "f0" });
  const body = h.get("vibe-panel-body");
  const merge = () => body.querySelectorAll(".vibe-ask-actions button").find((button) => ["Make it one task", "Drop the unstarted steps?"].includes(button.textContent));
  const live = () => body.querySelector(".vibe-row-now").textContent;
  const asking = merge();
  asking.click();
  step = "Write running · 1s · src/slots.lua";
  await h.window.MefiVibe.refresh(); await settle();
  assert.equal(merge(), asking, "the asking button is not swapped for a fresh one");
  assert.equal(asking.textContent, "Drop the unstarted steps?");
  assert.equal(live(), "Edit running · 3s · src/menu.lua", "the panel waits while it asks");
  // Left alone, the question lapses and the panel shows what it missed.
  h.runTimers(3200);
  assert.equal(live(), "Write running · 1s · src/slots.lua");
  assert.equal(merge().textContent, "Make it one task");
  assert.deepEqual(calls, []);
  merge().click();
  step = "Bash running · 2s · npm test";
  await h.window.MefiVibe.refresh(); await settle();
  merge().click(); await settle();
  assert.deepEqual(calls, [["merge-steps", "f0"]], "the second press merges");
});

test("Team lists what Mefi is thinking about beside what the agents build", async () => {
  const { bridge } = familyBridge({ agentsState: async () => ({ ok: true, configuration: {}, choices: {} }) });
  const h = load({ vibe: true, bridge });
  await h.window.MefiVibe.enter(); await settle();
  const run = h.flow.begin("size", { projectId: P, title: "Add a save system" });
  h.push({ requestId: run.id, projectId: P, stage: "sizing", seat: "lead", model: "gpt-6-sol" });
  h.window.MefiVibe.openPanel("team"); await settle();
  const folds = () => h.get("vibe-panel-body").querySelectorAll(".vibe-fold-label").map((label) => label.textContent);
  assert.deepEqual(folds().slice(0, 2), ["Thinking now", "Working now"]);
  const thinking = h.get("vibe-panel-body").querySelectorAll(".vibe-row-main")[0];
  assert.equal(thinking.children[1].textContent, "Sizing “Add a save system”");
  assert.equal(thinking.querySelector(".vibe-row-meta").textContent, "Take a look: Reading your request");
  h.push({ requestId: run.id, projectId: P, stage: "quick", verdict: "maybe" });
  assert.equal(h.get("vibe-panel-body").querySelectorAll(".vibe-row-main")[0].querySelector(".vibe-row-meta").textContent, "Plan the steps: GPT 6 Sol is splitting it", "a step repaints the list");
  const working = h.get("vibe-panel-body").querySelectorAll(".vibe-row-main")[1];
  assert.equal(working.querySelector(".vibe-row-meta").textContent, "OpenCode · building · started 2 min ago");
  assert.equal(working.querySelector(".vibe-row-now").textContent, "Edit running · 3s · src/menu.lua");
  h.flow.end(run.id, { ok: true, steps: 0 });
  assert.equal(folds()[0], "Working now", "a finished run leaves the list");
});

test("an emptied box keeps suggestions usable for the next draft; a new direction typed over them locks them", async () => {
  const h = load({ vibe: true, bridge: {
    planningExplore: async () => ({ ok: true, projectId: P, summary: "Two ideas.", suggestions: [{ id: "suggestion-0", label: "First", text: "Do the first thing." }, { id: "suggestion-1", label: "Second", text: "Do the second thing." }] }),
    vibeBuild: async () => ({ ok: true, task: { id: "t1" } }),
  } });
  await h.window.MefiVibe.enter(); await settle();
  h.get("vibe-input").value = "Improve it.";
  await h.window.MefiVibe.suggestEvolution();
  const cards = () => h.get("vibe-sparks").querySelectorAll(".vibe-evolution-suggestion");
  cards()[0].querySelector(".vibe-btn").click();
  for (const fn of h.get("vibe-compose").listeners.submit) fn({ preventDefault() {} });
  await settle();
  assert.equal(h.get("vibe-input").value, "", "the build took the draft");
  assert.doesNotMatch(h.get("vibe-sparks").textContent, /Your draft changed/);
  assert.equal(cards()[1].querySelector(".vibe-btn").disabled, false, "the next suggestion can start the next draft");
  cards()[1].querySelector(".vibe-btn").click();
  assert.match(h.get("vibe-input").value, /^Improve: Second/);
  h.get("vibe-input").value = "Something else entirely.";
  for (const fn of h.get("vibe-input").listeners.input) fn({});
  assert.match(h.get("vibe-sparks").textContent, /Your draft changed/, "a new direction over the set locks it");
  assert.equal(cards()[1].querySelector(".vibe-ask-link").disabled, true);
});

test("New app shows its first build being sized, even when Enter in a field sent the form", async () => {
  const reply = later();
  let asked = null;
  const h = load({ vibe: true, bridge: {
    projectsCreate: async () => ({ ok: true, created: true, addedId: P, selectedId: P }),
    vibeBuild: async (payload) => { asked = plain(payload); return reply.promise; },
  } });
  // The panel body sits inside the panel, as in the template, so focus inside it counts.
  h.get("vibe-panel").append(h.get("vibe-panel-body"));
  await h.window.MefiVibe.enter(); await settle();
  h.window.MefiVibe.openPanel("newapp");
  const form = h.get("vibe-panel-body").querySelector("form");
  const [nameField, aboutField] = form.children;
  const name = nameField.children[1], about = aboutField.children[1];
  name.value = "Pixel Garden"; for (const fn of name.listeners.input) fn({});
  about.value = "A cosy garden game."; for (const fn of about.listeners.input) fn({});
  // Enter in the Name field: it still has focus when the form is sent.
  name.tagName = "INPUT"; // as a browser reports it
  h.document.activeElement = name;
  name.blur = () => { h.document.activeElement = null; };
  for (const fn of form.listeners.submit) fn({ preventDefault() {} });
  await settle();
  const body = h.get("vibe-panel-body");
  assert.match(asked.requestId, /^vibe-size-/);
  assert.equal(body.querySelector("form").querySelector(".vibe-btn").textContent, "Making it…", "the busy state paints");
  assert.ok(body.querySelector(".vibe-flow-run"), "the first build's sizing shows in the panel");
  reply.resolve({ ok: true, steps: 2, task: { id: "f0" } });
  await settle();
  assert.equal(h.window.MefiVibePanels.current(), null, "the panel closes once the app is made");
  assert.equal(h.get("vibe-feedback").textContent, "Pixel Garden is ready, and its first build is split into 2 steps.");
  assert.equal(h.flow.active(P).length, 0, "its run ended with the reply");
});
