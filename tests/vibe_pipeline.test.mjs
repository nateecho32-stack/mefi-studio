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
function bridge({ held = false, execute = true, paused = false, keyPresent = true, autoBuild = false, questions = true, approvals = true, stuck = true, checkingLong = false } = {}) {
  const calls = [];
  const now = Date.now();
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
  // The companion's queue (scripts/companion.cjs queue): a finished attempt
  // still waiting on its check after half an hour is listed as "review".
  const needsYou = () => {
    const waiting = tasks.find((task) => task.id === "t2" && task.status === "awaiting_verification");
    const items = checkingLong && waiting ? [{ id: "review:t2", kind: "review", taskId: "t2", title: waiting.title, at: now - 45 * 60000, actions: [{ id: "checks", label: "View checks" }] }] : [];
    return { items, counts: { total: items.length, review: items.length } };
  };
  const assistant = () => ({ projectId: P, status: paused ? "paused" : "running", questions: open, messages: [], ai: { keyPresent }, ...(checkingLong ? { needsYou: needsYou() } : {}) });
  const api = {
    projectsList: async () => ({ projects: [{ id: P, name: "Sunrise" }], activeId: P }),
    tasksList: async () => ({ ok: true, projectId: P, tasks }),
    assistantState: async () => ({ ok: true, state: assistant() }),
    assistantStatus: async () => ({ ok: true, status: { ...status } }),
    backlogStatus: async () => backlog(),
    tasksCreate: async (args) => { calls.push(["tasksCreate", args.title]); return { ok: true, task: { id: "t9", projectId: P, title: args.title, status: "open" } }; },
    assistantControl: async (action) => { calls.push(["assistantControl", action]); status.held = false; status.execute = true; paused = false; return { ok: true, state: assistant(), autopilot: { ...status } }; },
    backlogControl: async (args) => { calls.push(["backlogControl", args.action, args.taskId, args.expectedScope]); approval = approval.filter((row) => row.id !== args.taskId); return { ok: true, backlog: backlog() }; },
    tasksAction: async (args) => {
      calls.push(["tasksAction", args.action, args.taskId]); blocked = blocked.filter((row) => row.id !== args.taskId);
      const task = tasks.find((item) => item.id === args.taskId);
      if (args.action === "status" && task) task.status = args.status;
      return { ok: true, backlog: backlog(), ...(args.action === "status" && task ? { task: { ...task } } : {}) };
    },
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
    // studio-ui.js MefiUi.arm's contract: the first press shows the question (.danger-armed), the second runs it.
    ...(options.ui ? { MefiUi: { arm(button, { run, armed }) { let ready = false, resting = ""; button.addEventListener("click", (event) => { if (!ready) { ready = true; resting = button.textContent; button.textContent = armed; button.classList.add("danger-armed"); return; } ready = false; button.textContent = resting; button.classList.remove("danger-armed"); run(event); }); return button; } } } : {}),
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
  assert.equal(get("vibe-pulse-text").textContent, "Agents off");
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

test("Drop it and It's done in the drawer ask first, then act, as the Tasks panel's Drop does", async () => {
  const { vibe, calls, get } = await load({ ui: true, questions: false });
  const buttons = () => get("vibe-ask-body").querySelector(".vibe-ask-actions").children;
  vibe.openNeed({ kind: "approval", id: "t6" });
  assert.deepEqual(buttons().map((button) => button.textContent), ["Approve build", "Drop it"]);
  buttons()[1].click();
  assert.equal(buttons()[1].textContent, "Drop this task?");
  assert.equal(calls.length, 0, "one press only asks");
  vibe.openNeed({ kind: "blocked", id: "t7" });
  assert.deepEqual(buttons().map((button) => button.textContent), ["Try again", "It's done", "Drop it"]);
  buttons()[1].click();
  assert.equal(buttons()[1].textContent, "Mark it done?");
  assert.equal(calls.length, 0);
  buttons()[1].click();
  await settle();
  assert.deepEqual(calls, [["tasksAction", "status", "t7"]], "the second press acts");
  vibe.openNeed({ kind: "approval", id: "t6" });
  buttons()[1].click(); buttons()[1].click();
  await settle();
  assert.deepEqual(calls.at(-1), ["tasksAction", "drop", "t6"]);
});

test("a check that runs long says Studio is still checking, how long, and never offers Drop", async () => {
  const { vibe, calls, get, gone } = await load({ checkingLong: true, questions: false, approvals: false, stuck: false });
  assert.deepEqual(vibe.snapshot().needs, [{ kind: "review", id: "t2", title: "Fix the login redirect loop" }]);
  const row = get("vibe-lane-needs").children[0];
  assert.ok(row.classList.contains("is-check"));
  assert.equal(row.children[0].children[2].textContent, "checking its work · 45 min so far");
  assert.equal(row.children[1].textContent, "Check on it");
  row.children[1].click();
  assert.deepEqual(vibe.snapshot().open, { kind: "review", id: "t2" });
  assert.equal(get("vibe-ask-kicker").textContent, "Still checking");
  const body = get("vibe-ask-body");
  assert.deepEqual(body.querySelector(".vibe-ask-chips").children.map((node) => node.textContent), ["Checking its work", "for 45 min"]);
  assert.equal(body.querySelector(".vibe-ask-detail").textContent, "The worker finished, and Studio has been checking the result for 45 min, longer than usual. You can look at the checks, or mark it done if you have checked it yourself.");
  assert.doesNotMatch(body.textContent, /Stuck|needed from you/, "it is listed under Needs you, so it never says you are not needed");
  const buttons = body.querySelector(".vibe-ask-actions").children;
  assert.deepEqual(buttons.map((button) => button.textContent), ["View checks", "It's done"], "no Try again, no Drop: the check holds the card");
  buttons[0].click();
  assert.deepEqual(plain(gone.at(-1)), ["tasks", { taskId: "t2", filter: "all" }]);
  assert.equal(get("vibe-ask").hidden, true);
  // Confirming it yourself closes it, and it does not come back.
  vibe.openNeed({ kind: "review", id: "t2" });
  get("vibe-ask-body").querySelector(".vibe-ask-actions").children[1].click();
  await settle();
  assert.deepEqual(calls, [["tasksAction", "status", "t2"]]);
  assert.deepEqual(vibe.snapshot().needs, []);
});

test("a push while It's done asks keeps the question up, and the second press marks it done", async () => {
  const { vibe, calls, get, window } = await load({ ui: true, checkingLong: true, questions: false, approvals: false, stuck: false });
  vibe.openNeed({ kind: "review", id: "t2" });
  const done = () => get("vibe-ask-body").querySelector(".vibe-ask-actions").children[1];
  const asking = done();
  asking.click();
  assert.equal(asking.textContent, "Mark it done?");
  // The check writes the card while the button asks.
  const list = await window.mefiStudio.tasksList();
  window.mefiStudio.tasksList = async () => ({ ...list, tasks: list.tasks.map((task) => task.id === "t2" ? { ...task, updatedAt: Date.now() } : task) });
  await vibe.refresh(); await settle();
  assert.equal(done(), asking, "the asking button is not swapped for a fresh one");
  assert.equal(asking.textContent, "Mark it done?");
  asking.click(); await settle();
  assert.deepEqual(calls, [["tasksAction", "status", "t2"]]);
});

test("Ask for a change waits while a request is still sending, so the follow-up is not joined to it", async () => {
  const { vibe, calls, get, fire, window } = await load({ questions: false, approvals: false, stuck: false });
  const input = get("vibe-input");
  let land;
  window.mefiStudio.tasksCreate = (args) => { calls.push(["tasksCreate", args.title]); return new Promise((resolve) => { land = () => resolve({ ok: true, task: { id: "t9", projectId: P, title: args.title, status: "open" } }); }); };
  input.value = "Add a dark mode toggle";
  fire(get("vibe-compose"), "submit");
  await settle();
  const refused = plain(vibe.requestChange({ id: "t1", projectId: P, title: "Login page", status: "done" }));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /^Wait for the request you just sent/);
  assert.equal(input.value, "Add a dark mode toggle", "the text being sent is left alone");
  land(); await settle();
  assert.equal(input.value, "", "the sent text clears once it lands");
  assert.equal(plain(vibe.requestChange({ id: "t1", projectId: P, title: "Login page", status: "done" })).ok, true);
  assert.equal(input.value, 'Follow-up to task "Login page" (t1).\n\nRequested change:\n\nDone when:\n- ');
  assert.deepEqual(calls, [["tasksCreate", "Add a dark mode toggle"]], "the first request is created once");
});

test("a follow-up is added under this project's draft only, and the bare scaffold is not sent", async () => {
  const storage = new Map([["mefiStudio.vibe.draft.p1", "First project's draft"]]);
  const env = await load({ storage, questions: false, approvals: false, stuck: false });
  const input = env.get("vibe-input");
  assert.equal(input.value, "First project's draft");
  // Another project opens without a project-changed event reaching Vibe yet.
  env.window.MefiWorkspace = { activeProjectId: () => "p2" };
  assert.equal(plain(env.vibe.requestChange({ id: "t1", projectId: "p1", title: "Login page", status: "done" })).ok, false, "p1's task is refused while p2 is open");
  assert.equal(plain(env.vibe.requestChange({ id: "t8", projectId: "p2", title: "Header", status: "done" })).ok, true);
  assert.equal(input.value, 'Follow-up to task "Header" (t8).\n\nRequested change:\n\nDone when:\n- ');
  assert.equal(env.storage.get("mefiStudio.vibe.draft.p1"), "First project's draft", "the first project's saved draft is untouched");
  assert.equal(env.storage.get("mefiStudio.vibe.draft.p2"), input.value);
  env.window.MefiWorkspace = { activeProjectId: () => "p1" };
  assert.equal(plain(env.vibe.requestChange({ id: "t1", projectId: "p1", title: "Login page", status: "done" })).ok, true);
  assert.equal(input.value, 'First project\'s draft\n\nFollow-up to task "Login page" (t1).\n\nRequested change:\n\nDone when:\n- ');
  assert.equal(env.storage.get("mefiStudio.vibe.draft.p2"), 'Follow-up to task "Header" (t8).\n\nRequested change:\n\nDone when:\n- ', "p2's draft stays p2's");
  // The scaffold alone says nothing to build.
  input.value = 'Follow-up to task "Login page" (t1).\n\nRequested change:\n\nDone when:\n- ';
  env.fire(env.get("vibe-compose"), "submit");
  await settle();
  assert.deepEqual(env.calls, []);
  assert.match(env.get("vibe-feedback").textContent, /Say what to change first/);
  input.value = 'Follow-up to task "Login page" (t1).\n\nRequested change:\nKeep the email after a failed sign-in.\n\nDone when:\n- ';
  env.fire(env.get("vibe-compose"), "submit");
  await settle();
  assert.deepEqual(env.calls, [["tasksCreate", 'Follow-up to task "Login page" (t1).']]);
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

test("Mefi stages map context beside the owner's draft without sending or creating work", async () => {
  const h = await load();
  h.get("vibe-input").value = "Keep my existing requirement.";
  h.fire(h.get("vibe-input"), "input");
  assert.equal(h.vibe.composeEvolution({ projectId: P, intent: "fix", system: { id: "auth", name: "Account access" }, file: { path: "renderer/login.js" }, idea: { title: "Repair the redirect", detail: "Return to the page after signing in." } }), true);
  assert.match(h.get("vibe-input").value, /^Keep my existing requirement\.\n\nFix: Repair the redirect/);
  assert.match(h.get("vibe-input").value, /System: Account access/);
  assert.match(h.get("vibe-input").value, /renderer\/login\.js/);
  assert.deepEqual(h.calls, []);
  assert.equal(h.vibe.composeEvolution({ projectId: "other", prompt: "Wrong project" }), false);
  assert.doesNotMatch(h.get("vibe-input").value, /Wrong project/);
  const reopened = await load({ storage: h.storage });
  assert.equal(reopened.get("vibe-input").value, h.get("vibe-input").value);
  assert.match(reopened.get("vibe-sparks").querySelector(".vibe-evolution-scope").textContent, /Account access/);
  assert.equal(reopened.get("vibe-sparks").querySelector('[data-intent="fix"]').getAttribute("aria-pressed"), "true");
});

test("Mefi's four approaches preserve custom draft text and carry intent to an explicit build", async () => {
  const h = await load();
  h.get("vibe-input").value = "Make the preview easier to read.";
  h.get("vibe-sparks").querySelector('[data-intent="experiment"]').click();
  assert.equal(h.get("vibe-input").value, "Make the preview easier to read.");
  const builds = [];
  h.window.mefiStudio.vibeBuild = async payload => { builds.push(plain(payload)); return { ok: true, task: { id: "created" } }; };
  assert.equal(builds.length, 0);
  h.fire(h.get("vibe-compose"), "submit"); await settle();
  assert.equal(builds.length, 1);
  assert.match(builds[0].prompt, /MEFI · Experiment/);
  assert.match(builds[0].prompt, /bounded, reversible experiment/);
  assert.match(builds[0].prompt, /Make the preview easier to read/);
  assert.equal(builds[0].projectId, P);
  assert.equal(Object.hasOwn(builds[0], "ideaId"), false);
});

test("a saved map idea retains its identity across draft restoration and explicit building", async () => {
  const h = await load();
  h.vibe.composeEvolution({ projectId: P, intent: "improve", idea: { sourceId: "idea-original", id: "map-node", title: "Readable preview", text: "Increase the preview contrast." } });
  const reopened = await load({ storage: h.storage });
  const builds = [];
  reopened.window.mefiStudio.vibeBuild = async payload => { builds.push(plain(payload)); return { ok: true, task: { id: "built" } }; };
  reopened.fire(reopened.get("vibe-compose"), "submit"); await settle();
  assert.equal(builds[0].ideaId, "idea-original");
  assert.equal(builds[0].projectId, P);
  reopened.get("vibe-input").value = "Add a different feature.";
  reopened.fire(reopened.get("vibe-input"), "input"); reopened.fire(reopened.get("vibe-compose"), "submit"); await settle();
  assert.equal(Object.hasOwn(builds[1], "ideaId"), false, "a finished handoff does not label unrelated future work");
});

test("an explicit idea identity stays out of another project's draft and older-host task payloads", async () => {
  const h = await load();
  const tasks = [];
  h.window.mefiStudio.tasksCreate = async payload => { tasks.push(plain(payload)); return { ok: true, task: { id: "created" } }; };
  h.vibe.composeEvolution({ projectId: P, ideaId: "idea-1", title: "Add a filter" });
  h.fire(h.get("vibe-compose"), "submit"); await settle();
  assert.equal(Object.hasOwn(tasks[0], "ideaId"), false, "an older host cannot perform a linked handoff");
  h.vibe.composeEvolution({ projectId: P, idea: { id: "idea-2", title: "Add a chart" } });
  h.window.MefiWorkspace = { activeProjectId: () => "p2" };
  h.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p2" } });
  const builds = [];
  h.window.mefiStudio.vibeBuild = async payload => { builds.push(plain(payload)); return { ok: true, task: { id: "created-p2" } }; };
  h.get("vibe-input").value = "A different project task."; h.fire(h.get("vibe-compose"), "submit"); await settle();
  assert.equal(builds[0].projectId, "p2");
  assert.equal(Object.hasOwn(builds[0], "ideaId"), false);
});

test("appending several saved ideas preserves every identity through unsaved additions and draft restoration", async () => {
  const h = await load();
  h.vibe.composeEvolution({ projectId: P, ideaId: "idea-first", title: "Improve contrast" });
  h.vibe.composeEvolution({ projectId: P, idea: { id: "idea-second", title: "Increase target size" } });
  h.vibe.composeEvolution({ projectId: P, ideaId: "idea-first", title: "Add a keyboard check" });
  h.vibe.composeEvolution({ projectId: P, idea: { title: "Unsaved related thought", text: "Consider the empty state too." } });
  const reopened = await load({ storage: h.storage });
  const builds = [];
  reopened.window.mefiStudio.vibeBuild = async payload => { builds.push(plain(payload)); return { ok: true, task: { id: "combined" } }; };
  reopened.fire(reopened.get("vibe-compose"), "submit"); await settle();
  assert.deepEqual(builds[0].ideaIds, ["idea-first", "idea-second"]);
  assert.match(builds[0].prompt, /Improve contrast/);
  assert.match(builds[0].prompt, /Increase target size/);
  assert.match(builds[0].prompt, /Consider the empty state too/);
});

test("clearing the draft clears saved idea identities before unrelated typing or staging", async () => {
  const h = await load();
  h.vibe.composeEvolution({ projectId: P, ideaId: "discarded", title: "An abandoned direction" });
  h.get("vibe-input").value = ""; h.fire(h.get("vibe-input"), "input");
  const reopened = await load({ storage: h.storage });
  reopened.get("vibe-input").value = "A completely different feature."; reopened.fire(reopened.get("vibe-input"), "input");
  const builds = [];
  reopened.window.mefiStudio.vibeBuild = async payload => { builds.push(plain(payload)); return { ok: true, task: { id: "new-direction" } }; };
  reopened.fire(reopened.get("vibe-compose"), "submit"); await settle();
  assert.equal(Object.hasOwn(builds[0], "ideaId"), false);
  assert.equal(Object.hasOwn(builds[0], "ideaIds"), false);
  reopened.vibe.composeEvolution({ projectId: P, ideaId: "fresh", title: "A fresh idea" });
  reopened.fire(reopened.get("vibe-compose"), "submit"); await settle();
  assert.equal(builds[1].ideaId, "fresh");
});

test("oversized map additions reveal the preserved draft and refuse a seventeenth saved identity", async () => {
  const h = await load();
  h.get("vibe-input").value = "Keep the original draft."; h.fire(h.get("vibe-input"), "input");
  h.vibe.exit();
  assert.equal(h.vibe.composeEvolution({ projectId: P, ideaId: "too-long", prompt: "x".repeat(16000) }), false);
  assert.deepEqual(h.gone.at(-1), ["vibe", null]);
  assert.equal(h.get("vibe-input").value, "Keep the original draft.");
  assert.match(h.get("vibe-feedback").textContent, /will not fit/);
  const ids = Array.from({ length: 16 }, (_, index) => `idea-${index}`);
  assert.equal(h.vibe.composeEvolution({ projectId: P, ideaIds: ids, title: "Sixteen related ideas" }), true);
  const before = h.get("vibe-input").value;
  assert.equal(h.vibe.composeEvolution({ projectId: P, ideaId: "idea-17", title: "One too many" }), false);
  assert.equal(h.get("vibe-input").value, before);
  assert.match(h.get("vibe-feedback").textContent, /16 saved ideas/);
  const builds = [];
  h.window.mefiStudio.vibeBuild = async payload => { builds.push(plain(payload)); return { ok: true, task: { id: "sixteen" } }; };
  h.fire(h.get("vibe-compose"), "submit"); await settle();
  assert.deepEqual(builds[0].ideaIds, ids);
});

test("suggesting a next step only explores, and an accepted suggestion appends to the editable draft", async () => {
  const h = await load();
  const requests = [];
  h.window.mefiStudio.planningExplore = async payload => {
    requests.push(plain(payload));
    return { ok: true, projectId: P, summary: "The preview already has a toolbar.", suggestions: [{ id: "suggestion-0", label: "Preview contrast", text: "Increase preview text contrast.", reason: "Makes small text readable.", files: ["renderer/preview.js"] }] };
  };
  h.get("vibe-input").value = "Improve the preview."; h.fire(h.get("vibe-input"), "input");
  await h.vibe.suggestEvolution();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].projectId, P);
  assert.match(requests[0].draft.destination, /Improve the preview/);
  assert.deepEqual(h.calls, [], "a suggestion cannot build, promote, or start agents");
  const card = h.get("vibe-sparks").querySelector(".vibe-evolution-suggestion");
  assert.match(card.textContent, /renderer\/preview.js/);
  card.querySelector(".vibe-btn").click();
  assert.match(h.get("vibe-input").value, /^Improve the preview\.\n\nImprove: Preview contrast/);
  assert.match(h.get("vibe-input").value, /Increase preview text contrast/);
  assert.deepEqual(h.calls, []);
  const builds = [];
  h.window.mefiStudio.vibeBuild = async payload => { builds.push(plain(payload)); return { ok: true, task: { id: "created" } }; };
  h.fire(h.get("vibe-compose"), "submit"); await settle();
  assert.equal(Object.hasOwn(builds[0], "ideaId"), false, "a transient suggestion id never becomes a board idea id");
});

test("saving a suggested idea uses the scoped append action without promoting it", async () => {
  const h = await load();
  const additions = [];
  h.window.mefiStudio.planningExplore = async () => ({ ok: true, projectId: P, summary: "A small improvement.", suggestions: [{ label: "Readable preview", text: "Increase preview contrast.", files: ["preview.js"] }] });
  h.window.mefiStudio.ideasAction = async payload => { additions.push(plain(payload)); return { ok: true, projectId: P, idea: { id: "idea-1" }, ideas: [] }; };
  await h.vibe.suggestEvolution();
  h.get("vibe-sparks").querySelector(".vibe-evolution-actions").querySelector(".vibe-ask-link").click();
  await settle();
  assert.equal(additions.length, 1);
  assert.equal(additions[0].action, "add");
  assert.equal(additions[0].projectId, P);
  assert.equal(additions[0].title, "Readable preview");
  assert.deepEqual(additions[0].files, ["preview.js"]);
  assert.deepEqual(h.calls, []);
  assert.match(h.get("vibe-feedback").textContent, /saved for later/);
  h.get("vibe-sparks").querySelector(".vibe-evolution-actions").querySelector(".vibe-btn").click();
  const builds = [];
  h.window.mefiStudio.vibeBuild = async payload => { builds.push(plain(payload)); return { ok: true, task: { id: "created" } }; };
  h.fire(h.get("vibe-compose"), "submit"); await settle();
  assert.equal(builds[0].ideaId, "idea-1", "the saved suggestion follows its draft into the new task");
});

test("late suggestions never enter another project's draft or results", async () => {
  const h = await load();
  let resolve;
  h.window.mefiStudio.planningExplore = () => new Promise(done => { resolve = done; });
  const pending = h.vibe.suggestEvolution();
  h.window.MefiWorkspace = { activeProjectId: () => "p2" };
  h.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p2" } });
  h.get("vibe-input").value = "The second project's direction."; h.fire(h.get("vibe-input"), "input");
  resolve({ ok: true, projectId: P, summary: "Old project reply", suggestions: [{ label: "Old idea", text: "Old idea text" }] });
  await pending;
  assert.equal(h.get("vibe-input").value, "The second project's direction.");
  assert.doesNotMatch(h.get("vibe-sparks").textContent, /Old project reply|Old idea/);
  assert.deepEqual(h.calls, []);
});

test("suggestions for a changed draft remain readable but cannot overwrite its newer direction", async () => {
  const h = await load();
  let resolve;
  h.window.mefiStudio.planningExplore = () => new Promise(done => { resolve = done; });
  h.get("vibe-input").value = "Improve login."; h.fire(h.get("vibe-input"), "input");
  const pending = h.vibe.suggestEvolution();
  h.get("vibe-input").value = "Improve the dashboard instead."; h.fire(h.get("vibe-input"), "input");
  resolve({ ok: true, projectId: P, summary: "Login suggestion", suggestions: [{ label: "Login", text: "Add login help" }] }); await pending;
  const actions = h.get("vibe-sparks").querySelector(".vibe-evolution-actions");
  assert.equal(actions.querySelector(".vibe-btn").disabled, true);
  assert.equal(actions.querySelector(".vibe-ask-link").disabled, true);
  assert.match(h.get("vibe-sparks").textContent, /Your draft changed/);
  assert.equal(h.get("vibe-input").value, "Improve the dashboard instead.");
});

test("late errors stay on their question, and a suggested one-line option waits for the owner's text", async () => {
  const h = await load({ approvals: false, stuck: false });
  const questions = [{ id: "one", projectId: P, status: "open", title: "First question", context: { suggestion: { optionId: "line", reason: "Name the intended scope." } }, options: [{ id: "retry", label: "Retry" }, { id: "line", label: "Answer it in one line", text: true }] }, { id: "two", projectId: P, status: "open", title: "Second question", options: [{ id: "yes", label: "Yes" }] }];
  h.window.mefiStudio.assistantState = async () => ({ ok: true, state: { projectId: P, status: "running", questions, messages: [], ai: { keyPresent: true } } });
  let reject;
  h.window.mefiStudio.assistantAnswer = () => new Promise((_resolve, no) => { reject = no; });
  await h.vibe.refresh(); h.vibe.openNeed("one");
  assert.match(h.get("vibe-ask-body").textContent, /Mefi suggests: Answer it in one line — Name the intended scope/);
  h.get("vibe-ask-body").querySelector(".vibe-ask-option").click();
  h.vibe.openNeed("two"); reject(new Error("First question failed")); await settle();
  assert.doesNotMatch(h.get("vibe-ask-note").textContent, /First question failed/);
  h.vibe.openNeed("one"); assert.match(h.get("vibe-ask-note").textContent, /First question failed/);
  const answers = [];
  h.window.mefiStudio.assistantAnswer = async value => { answers.push(plain(value)); return { ok: true }; };
  h.get("vibe-ask-body").querySelectorAll(".vibe-ask-option")[1].click();
  assert.equal(answers.length, 0, "selecting the line option sends nothing yet");
  const form = h.get("vibe-ask-body").querySelector(".vibe-ask-own");
  form.querySelector("textarea").value = "Only update the palette"; h.fire(form, "submit"); await settle();
  assert.deepEqual(answers[0], { id: "one", optionId: "line", text: "Only update the palette" });
});

test("the unread dot follows message ids after the sixty-message window fills", async () => {
  const h = await load({ questions: false, approvals: false, stuck: false });
  let messages = Array.from({ length: 61 }, (_, i) => ({ id: `m${i}`, role: "assistant", projectId: P, text: `Reply ${i}` }));
  h.window.mefiStudio.assistantState = async () => ({ ok: true, state: { projectId: P, status: "running", questions: [], messages, ai: { keyPresent: true } } });
  await h.vibe.refresh(); assert.equal(h.get("vibe-chat-dot").hidden, false);
  h.get("vibe-chat-toggle").click(); h.get("vibe-chat-close").click();
  assert.equal(h.get("vibe-chat-dot").hidden, true);
  messages = [...messages.slice(1), { id: "m61", role: "assistant", projectId: P, text: "New reply" }];
  await h.vibe.refresh(); assert.equal(h.get("vibe-chat-dot").hidden, false);
});
