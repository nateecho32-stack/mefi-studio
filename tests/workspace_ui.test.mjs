import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// The shared renderer DOM stand-in, so a template restructure lands in one
// place instead of nineteen private copies. See tests/fixtures/renderer-dom.mjs.
import { Element } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/workspace.js", import.meta.url), "utf8");
const stageSource = await readFile(new URL("../renderer/stage-labels.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("Home starts the named task while paused without requesting a backlog run", async () => {
  const requests = [], pending = deferred();
  const env = await environment({ bridgeOverrides: {
    assistantStatus: async () => ({ ok: true, status: { projectId: "project-a", held: true, execute: false, running: [] } }),
    assistantWorkOn: (target) => { requests.push(target); return pending.promise; },
    backlogControl: () => { throw new Error("must not drain the backlog"); },
  } });
  assert.equal(env.el("focus-state").textContent, "Task ready · agents paused");
  assert.equal(env.el("focus-primary").textContent, "Start this task");
  await env.el("focus-primary").trigger("click"); await flush();
  await env.el("focus-primary").trigger("click"); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ kind: "task", id: "original", projectId: "project-a", start: true }]);
  pending.resolve({ ok: true, dispatch: { requested: true, phase: "queued", message: "Start requested for this task; waiting for machine capacity." } }); await flush();
  assert.equal(env.el("feedback").textContent, "Start requested for this task; waiting for machine capacity.");
  assert.equal(env.el("focus-reason").textContent, "Start requested for this task; waiting for machine capacity.");
  assert.equal(env.el("focus-primary").disabled, false);
});

test("global Start agents releases the launch hold and saved pause in one request", async () => {
  const calls = [];
  const env = await environment({ bridgeOverrides: {
    assistantState: async () => ({ ok: true, state: { status: "paused", prefs: { paused: true }, messages: [] } }),
    assistantStatus: async () => ({ ok: true, status: { held: true, execute: false, running: [] } }),
    assistantControl: async (action) => { calls.push(action); return { ok: true, state: { status: "running", prefs: { paused: false } }, autopilot: { held: false, execute: true, running: [] } }; },
  } });
  assert.equal(env.el("pause").textContent, "Start agents");
  await env.el("pause").trigger("click");
  assert.deepEqual(calls, ["start-work"]);
  assert.equal(env.el("pause").textContent, "Pause");
  assert.doesNotMatch(env.el("feedback").textContent, /press Resume/);
});

test("Home keeps selected task context and consumes the shared workflow evidence", async () => {
  const env = await environment();
  let context = { projectId: "project-a", taskId: "second" };
  env.nav.taskContext = () => context;
  env.nav.selectTask = (value) => { context = value; };
  env.window.MefiTasks.workflowSummary = (task) => ({ label: "Testing", worker: "Builder A", action: `Testing ${task.id}`, activityAge: "Updated 42s ago", checks: "2 recorded checks passed", blocker: "Waiting for dependency test", nextAction: "View checks" });
  env.events.tasks([{ id: "original", title: "Original task", status: "active" }, { id: "second", title: "Second task", status: "active" }]);
  assert.equal(env.el("focus-title").textContent, "Second task");
  assert.equal(env.el("focus-worker").textContent, "Builder A");
  assert.equal(env.el("focus-action").textContent, "Testing second");
  assert.equal(env.el("focus-age").textContent, "Updated 42s ago");
  assert.equal(env.el("focus-checks").textContent, "2 recorded checks passed");
  assert.equal(env.el("focus-reason").textContent, "Waiting for dependency test");
  env.el("focus-task").value = "original"; await env.el("focus-task").trigger("change");
  assert.equal(context.taskId, "original");
  const navigations = []; env.nav.go = (...args) => navigations.push(args);
  await env.el("focus-check").trigger("click");
  assert.equal(navigations[0][0], "tasks");
  assert.equal(navigations[0][1].taskId, "original");
  assert.equal(navigations[0][1].panel, "evidence");
  await env.el("focus-live").trigger("click");
  assert.equal(navigations[1][1].selected, "task:original");
});

test("preview readiness stays separate from worker completion and only owned servers can stop", async () => {
  const calls = [];
  const env = await environment({ bridgeOverrides: {
    projectPreviewStatus: async () => ({ ok: true, projectId: "project-a", phase: "stopped", available: true }),
    projectPreviewStart: async (args) => { calls.push(["start", args]); return { ok: true, projectId: "project-a", phase: "starting", available: true, owned: true, canStop: true }; },
    projectPreviewOpen: async (args) => { calls.push(["open", args]); return { ok: true, projectId: "project-a", phase: "ready", available: true, owned: true, canStop: true, url: "http://127.0.0.1:4173/" }; },
    projectPreviewStop: async (args) => { calls.push(["stop", args]); return { ok: true, projectId: "project-a", phase: "stopped", available: true, owned: false, canStop: false }; },
  } });
  assert.equal(env.el("preview-start").disabled, false);
  await env.el("preview-start").trigger("click");
  assert.equal(env.el("preview-state").textContent, "Starting preview");
  assert.equal(env.el("preview-open").disabled, true);
  env.events.status({ projectId: "project-a", running: [{ taskId: "original", currentStep: "Checking collision rules" }] });
  env.events.preview({ ok: true, projectId: "project-a", phase: "ready", available: true, owned: false, canStop: false, url: "http://127.0.0.1:4173/" });
  assert.match(env.el("preview-worker").textContent, /agent is still working/);
  assert.equal(env.el("preview-state").textContent, "Preview ready");
  assert.equal(env.el("preview-open").disabled, false);
  assert.equal(env.el("preview-stop").disabled, true);
  assert.match(env.el("preview-stop").title, /outside Studio/);
  env.events.status({ projectId: "project-a", running: [] });
  assert.match(env.el("preview-worker").textContent, /No agent is running/);
  await env.el("preview-open").trigger("click");
  assert.equal(env.el("preview-stop").disabled, false);
  await env.el("preview-stop").trigger("click");
  assert.equal(env.el("preview-state").textContent, "Stopped");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [["start", { projectId: "project-a" }], ["open", { projectId: "project-a" }], ["stop", { projectId: "project-a" }]]);
});

test("a late preview snapshot cannot overwrite a newer event or another project", async () => {
  const env = await environment({ bridgeOverrides: { projectPreviewStatus: async () => ({ ok: true, projectId: "project-a", phase: "stopped", available: true }) } });
  const pending = deferred(); env.bridge.projectPreviewStatus = () => pending.promise;
  const read = env.workspace.refresh(true); await flush();
  env.events.preview({ ok: true, projectId: "project-a", phase: "ready", url: "http://localhost:4300/", available: true, owned: true, canStop: true });
  pending.resolve({ ok: true, projectId: "project-a", phase: "stopped" }); await read;
  assert.equal(env.el("preview-state").textContent, "Preview ready");
  env.events.preview({ ok: true, projectId: "project-b", phase: "failed", error: "Other project failure" });
  assert.equal(env.el("preview-state").textContent, "Preview ready");
  env.bridge.projectPreviewStatus = async () => { throw new Error("Disconnected"); };
  await env.workspace.refresh(true);
  assert.equal(env.el("preview-open").disabled, true);
  assert.match(env.el("preview-message").textContent, /status unavailable/);
});

test("a preview action acknowledgement cannot replace a newer readiness event", async () => {
  const pending = deferred();
  const env = await environment({ bridgeOverrides: {
    projectPreviewStatus: async () => ({ ok: true, projectId: "project-a", phase: "stopped", available: true }),
    projectPreviewStart: () => pending.promise,
  } });
  const action = env.workspace.previewAction("start"); await flush();
  env.events.preview({ ok: true, projectId: "project-a", phase: "ready", url: "http://localhost:4300/", available: true, owned: true, canStop: true });
  pending.resolve({ ok: true, projectId: "project-a", phase: "starting", available: true });
  await action;
  assert.equal(env.el("preview-state").textContent, "Preview ready");
  assert.equal(env.el("preview-start").hidden, true);
});

test("an owner-stopped task offers a scoped resume while other blockers stay in review", async () => {
  const env = await environment({ bridgeOverrides: {
    tasksList: async () => ({ ok: true, tasks: [{ id: "held", title: "Held task", status: "open", ownerHold: { reason: "stopped by you" } }] }),
    backlogStatus: async () => ({ ok: true, projectId: "project-a", paused: true, counts: { blocked: 1 }, taskStates: [{ id: "held", stage: "blocked", blockedBy: "owner", reason: "Stopped by you" }] }),
  } });
  assert.equal(env.el("focus-primary").textContent, "Resume this task");
  env.bridge.backlogStatus = async () => ({ ok: true, projectId: "project-a", paused: true, counts: { blocked: 1 }, taskStates: [{ id: "held", stage: "blocked", blockedBy: "dependencies", reason: "Missing prerequisite", canRetry: false }] });
  await env.workspace.refresh(true);
  assert.equal(env.el("focus-primary").textContent, "View task");
});

test("completed work offers checks and a change draft without sending or erasing previous input", async () => {
  const sent = [];
  const task = { id: "done-task", projectId: "project-a", title: "Build Snake", prompt: "Complete full prompt remains on the original task.", status: "done", doneAt: 42 };
  const env = await environment({ bridgeOverrides: { tasksList: async () => ({ ok: true, tasks: [task] }), tasksCreate: (value) => { sent.push(value); } } });
  assert.equal(env.el("focus-change").hidden, false);
  assert.match(env.el("work-list").textContent, /Queue is empty/);
  env.storage.set("mefiStudio.workspace.draft.project-a.work", "Keep my existing draft");
  await env.el("focus-change").trigger("click");
  assert.match(env.el("input").value, /^Keep my existing draft\n\nFollow-up to task "Build Snake" \(done-task\)/);
  assert.match(env.el("input").value, /Requested change:/);
  assert.equal(sent.length, 0);
  assert.equal(env.el("mode-work").getAttribute("aria-pressed"), "true");
  assert.equal(env.workspace.requestChange({ ...task, projectId: "project-b" }), false);
});

test("the Activity panel follows a worker until the owner closes it, while progress stays visible", async () => {
  const env = await environment();
  assert.equal(env.el("activity-drawer").hidden, true);
  assert.equal(env.el("progress").hidden, false);
  assert.equal(env.el("progress-title").textContent, "Original task");
  env.events.status({ projectId: "project-a", running: [{ taskId: "original", route: "Builder", phase: "building", step: "Running the checks", startedAt: Date.now() - 1000 }] });
  assert.equal(env.el("activity-drawer").hidden, false);
  assert.equal(env.el("activity-toggle").getAttribute("aria-expanded"), "true");
  assert.match(env.el("progress-facts").textContent, /Builder/);
  await env.el("activity-close").trigger("click");
  assert.equal(env.el("activity-drawer").hidden, true);
  env.events.status({ projectId: "project-a", running: [{ taskId: "original", route: "Builder", phase: "building", startedAt: Date.now() - 2000 }] });
  assert.equal(env.el("activity-drawer").hidden, true, "a live update preserves the owner's choice");
  assert.equal(env.el("progress").hidden, false);
  await env.el("progress-open").trigger("click");
  assert.equal(env.el("activity-drawer").hidden, false);
});

test("New task opens the authoring mode with its saved draft and never submits it", async () => {
  const sent = [], routes = [];
  const env = await environment({ bridgeOverrides: { tasksCreate: (value) => sent.push(value) } });
  env.nav.go = (view) => routes.push(view);
  env.storage.set("mefiStudio.workspace.draft.project-a.work", "Keep my task draft");
  env.el("input").value = "Keep my chat draft";
  await env.el("input").trigger("input");
  env.workspace.composeTask();
  assert.deepEqual(routes, ["workspace"]);
  assert.equal(env.el("input").value, "Keep my task draft");
  assert.equal(env.storage.get("mefiStudio.workspace.draft.project-a.chat"), "Keep my chat draft");
  assert.equal(env.el("mode-work").getAttribute("aria-pressed"), "true");
  assert.deepEqual(sent, []);
});

test("a region header and churn hint alone never create a work task", async () => {
  const env = await environment(); let calls = 0;
  env.bridge.tasksCreate = async () => { calls += 1; return { ok: true }; };
  await env.el("mode-work").trigger("click");
  env.el("input").value =
    "In ui (ui/):\n\nFiles agents changed most here: ui/intro/figures.lua, ui/common.lua, ui/text_popup.lua";
  await env.el("form").trigger("submit");
  assert.equal(calls, 0);
  assert.match(env.el("feedback").textContent, /Describe what to change/);
  assert.equal(env.el("input").value.includes("Files agents changed most here"), true);
});

test("an empty change scaffold is refused but a described change creates the task", async () => {
  const calls = [];
  const env = await environment({ bridgeOverrides: { tasksCreate: (value) => { calls.push(value); return { ok: true }; } } });
  await env.el("mode-work").trigger("click");
  env.el("input").value = 'Follow-up to task "Build Snake" (done-task).\n\nRequested change:\n\nDone when:\n- ';
  await env.el("form").trigger("submit");
  assert.equal(calls.length, 0);
  assert.match(env.el("feedback").textContent, /Describe what to change/);
  env.el("input").value = 'Follow-up to task "Build Snake" (done-task).\n\nRequested change:\n\nRender the guard message inline, and check it with node --test.';
  await env.el("form").trigger("submit");
  assert.equal(calls.length, 1);
});

async function environment({ timerQueue = null, bridgeOverrides = {}, autoEnter = true, desktop = true, bootActive = () => false, windowOverrides = {}, now = null } = {}) {
  const elements = new Map(); const storage = new Map(); const events = {}; const dispatched = [];
  const windowListeners = new Map();
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const el = (name) => get(`workspace-${name}`);
  for (const stage of ["all", "open", "review", "done", "ideas"]) {
    const button = new Element("button"); button.dataset.workFilter = stage; button.append(new Element("span")); el("layer").append(button); elements.set(`workspace-${stage}`, button);
  }
  const currentProject = { id: "project-a", name: "Project A", path: "C:/projects/a" };
  const projects = { ok: true, activeId: currentProject.id, projects: [currentProject, { id: "project-b", name: "Project B", path: "C:/projects/b" }] };
  const bridge = {
    projectsList: async () => projects,
    projectsAdd: async () => ({ ...projects, canceled: true }),
    tasksList: async () => ({ ok: true, projectId: "project-a", tasks: [{ id: "original", projectId: "project-a", title: "Original task", status: "open" }] }),
    assistantState: async () => ({ ok: true, state: { projectId: "project-a", messages: [], ai: { keyPresent: true } } }),
    assistantStatus: async () => ({ ok: true, status: { projectId: "project-a", running: [] } }),
    jevStatus: async () => ({ configured: true, enabled: true, phase: "idle", lastSuccessAt: 1 }),
    assistantMessage: async () => ({ ok: false, error: "Connection unavailable" }),
    tasksCreate: async () => ({ ok: true }),
    ideasList: async () => ({ ok: true, ideas: [] }),
    backlogStatus: async () => ({ ok: true, projectId: "project-a", counts: { ready: 1, running: 0, blocked: 0 }, taskStates: [], next: [], paused: false, draining: false }),
    backlogControl: async () => ({ ok: true }),
    onProjects: (fn) => { events.projects = fn; },
    onTasks: (fn) => { events.tasks = fn; },
    onIdeas: (fn) => { events.ideas = fn; },
    onAssistant: (fn) => { events.assistant = fn; },
    onAssistantStatus: (fn) => { events.status = fn; },
    onProjectPreview: (fn) => { events.preview = fn; },
    ...bridgeOverrides,
  };
  const context = vm.createContext({
    Date: now ? class extends Date { static now() { return now(); } } : Date,
    window: {
      mefiStudio: desktop ? bridge : undefined, dispatchEvent: (event) => { dispatched.push(event); return true; },
      addEventListener: (name, fn) => { const list = windowListeners.get(name) || []; list.push(fn); windowListeners.set(name, list); },
      MefiNav: { list: () => [], go() {} }, MefiIdle: { exit() {} }, MefiBoot: { pollStart() {}, isActive: bootActive },
      MefiTasks: { describe: (task) => ({ stage: task.status === "done" ? "done" : task.status === "awaiting_verification" ? "review" : "open", label: task.status, summary: task.prompt || "" }) },
      ...windowOverrides,
    },
    document: { body: new Element(), hidden: false, getElementById: get, createElement: (tag) => new Element(tag), addEventListener() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    CustomEvent: class { constructor(name, options) { this.type = name; this.detail = options?.detail; } },
    setTimeout: timerQueue ? (fn, delay) => { const timer = { fn, delay }; timerQueue.push(timer); return timer; } : setTimeout,
    clearTimeout: timerQueue ? (timer) => { if (timer) timer.cancelled = true; } : clearTimeout, console,
  });
  vm.runInContext(stageSource, context);
  vm.runInContext(source, context);
  await flush();
  if (autoEnter) context.window.MefiWorkspace.enter();
  await flush();
  return { workspace: context.window.MefiWorkspace, el, bridge, events, dispatched, storage, projects, nav: context.window.MefiNav,
    window: context.window, emit: (name, detail) => { for (const fn of windowListeners.get(name) || []) fn({ detail }); } };
}

test("Void theme previews color Preferences without saving its accent", async () => {
  const env = await environment();
  let currentTheme = "aurora";
  env.window.MefiMusic = {
    applyTheme(theme) { currentTheme = theme; env.emit("mefi-theme-change", { theme, preview: true }); return theme; },
    status: () => ({ theme: currentTheme }),
  };
  env.el("accent").value = "void";
  await env.el("accent").trigger("input");
  assert.equal(env.el("layer").dataset.accent, "void");
  assert.equal(env.storage.get("mefiStudio.workspace.accent"), undefined);
  env.el("person-name").value = "Mefi";
  await env.el("person-name").trigger("input");
  assert.equal(env.el("layer").dataset.accent, "void", "another preference redraw keeps the live preview");
  assert.equal(env.storage.get("mefiStudio.workspace.accent"), undefined);
  currentTheme = "aurora";
  env.emit("mefi-theme-change", { theme: "aurora", tier: "free" });
  assert.equal(env.el("accent").value, "aurora");
  assert.equal(env.el("layer").dataset.accent, "aurora");
  assert.equal(env.storage.get("mefiStudio.workspace.accent"), undefined);
  currentTheme = "void";
  env.emit("mefi-theme-change", { theme: "void", tier: "premium" });
  assert.equal(env.storage.get("mefiStudio.workspace.accent"), "void", "an unlocked choice can be saved");
});

test("startup readiness waits for projects and populated panels without duplicating cold enters", async () => {
  const projects = deferred(), tasks = deferred(); let projectCalls = 0, taskCalls = 0, loading = true;
  const env = await environment({ autoEnter: false, bootActive: () => loading, bridgeOverrides: {
    projectsList: () => { projectCalls += 1; return projects.promise; },
    tasksList: () => { taskCalls += 1; return tasks.promise; },
  } });
  const ready = env.workspace.ready(); let settled = false;
  ready.then(() => { settled = true; });
  assert.equal(env.workspace.ready(), ready, "all startup consumers join the same attempt");
  assert.equal(env.workspace.enter(), ready);
  assert.equal(env.workspace.enter(), ready);
  await flush();
  assert.equal(projectCalls, 1);
  assert.equal(taskCalls, 0, "project context loads before project panels");
  assert.equal(settled, false);
  projects.resolve(env.projects); await flush();
  assert.equal(taskCalls, 1);
  assert.equal(settled, false, "a selected project alone is not a prepared workspace");
  tasks.resolve({ ok: true, tasks: [{ id: "loaded", title: "Prepared startup task", status: "open" }] });
  assert.equal(await ready, true);
  assert.match(env.el("work-list").textContent, /Prepared startup task/);
  await env.workspace.enter();
  assert.equal(taskCalls, 1, "revealing the prepared workspace beneath the boot gate does not refetch");
  loading = false;
  await env.workspace.enter();
  assert.equal(taskCalls, 2, "later visits still refresh current data");
});

test("Home shows the live tree behind its glass, after the startup layer lifts, and hands it back on leaving", async () => {
  const calls = []; let loading = true; const boot = deferred();
  const idle = { exit() { calls.push("exit"); }, setHomeBackdrop(on) { calls.push(on ? "backdrop on" : "backdrop off"); return on; } };
  const env = await environment({ autoEnter: false, bootActive: () => loading, windowOverrides: { MefiIdle: idle, MefiBoot: { pollStart() {}, isActive: () => loading, ready: () => boot.promise } } });
  env.workspace.enter(); await flush();
  assert.deepEqual(calls, ["exit"], "Command lets go first; the tree waits for the startup layer");
  loading = false; boot.resolve(true); await flush();
  assert.deepEqual(calls, ["exit", "backdrop on"]);
  env.workspace.exit();
  assert.deepEqual(calls, ["exit", "backdrop on", "backdrop off"]);
  calls.length = 0;
  env.workspace.enter(); await flush();
  assert.deepEqual(calls, ["exit", "backdrop on"], "a later visit shows it at once");
  env.workspace.exit(); calls.length = 0;
  loading = true; const late = deferred();
  const lateEnv = await environment({ autoEnter: false, windowOverrides: { MefiIdle: idle, MefiBoot: { pollStart() {}, isActive: () => loading, ready: () => late.promise } } });
  lateEnv.workspace.enter(); await flush(); lateEnv.workspace.exit(); calls.length = 0;
  late.resolve(true); await flush();
  assert.deepEqual(calls, [], "Home already left: the startup handoff does not start the tree");
});

test("startup reports project and panel failures and an explicit retry recovers", async () => {
  let projectCalls = 0;
  const env = await environment({ autoEnter: false, bridgeOverrides: {
    projectsList: () => { projectCalls += 1; throw new Error("Project store unavailable"); },
  } });
  assert.equal(await env.workspace.ready(), false);
  assert.equal(env.el("retry").hidden, false);
  assert.match(env.el("feedback").textContent, /Project store unavailable/);
  assert.equal(await env.workspace.ready(), false);
  assert.equal(projectCalls, 1, "reading readiness cannot silently retry a failed load");
  env.bridge.projectsList = async () => { projectCalls += 1; return env.projects; };
  env.bridge.tasksList = async () => { throw new Error("Task store unavailable"); };
  assert.equal(await env.workspace.ready({ retry: true }), false);
  assert.match(env.el("feedback").textContent, /Couldn't refresh work/);
  env.bridge.tasksList = async () => ({ ok: true, tasks: [] });
  assert.equal(await env.workspace.ready({ retry: true }), true);
  assert.equal(projectCalls, 3);
  assert.equal(env.el("retry").hidden, true);
});

test("startup project reads have a deadline and can retry after an unanswered IPC", async () => {
  const timerQueue = [];
  const env = await environment({ autoEnter: false, timerQueue, bridgeOverrides: { projectsList: () => new Promise(() => {}) } });
  const ready = env.workspace.ready();
  const waiting = timerQueue.filter((timer) => timer.delay === 12000 && !timer.cancelled);
  assert.equal(waiting.length, 1);
  waiting[0].fn();
  assert.equal(await ready, false);
  env.bridge.projectsList = async () => env.projects;
  assert.equal(await env.workspace.ready({ retry: true }), true);
});

test("startup retries fence late project selection and earlier panel snapshots", async () => {
  const oldProjects = deferred();
  const env = await environment({ autoEnter: false, bridgeOverrides: { projectsList: () => oldProjects.promise } });
  const initial = env.workspace.ready();
  env.bridge.projectsList = async () => env.projects;
  assert.equal(await env.workspace.ready({ retry: true }), true);
  oldProjects.resolve({ ok: true, activeId: "old", projects: [{ id: "old", name: "Stale project" }] });
  assert.equal(await initial, false);
  assert.equal(env.el("project-name").textContent, "Project A");

  const oldTasks = deferred(), newProjects = deferred();
  env.bridge.tasksList = () => oldTasks.promise;
  const oldAttempt = env.workspace.ready({ retry: true }); await flush();
  env.bridge.projectsList = () => newProjects.promise;
  const retry = env.workspace.ready({ retry: true }); await flush();
  oldTasks.resolve({ ok: true, tasks: [{ id: "stale", title: "Stale startup task", status: "open" }] });
  assert.equal(await oldAttempt, false);
  assert.doesNotMatch(env.el("work-list").textContent, /Stale startup task/);
  env.bridge.tasksList = async () => ({ ok: true, tasks: [{ id: "fresh", title: "Fresh retry task", status: "open" }] });
  newProjects.resolve(env.projects);
  assert.equal(await retry, true);
  assert.match(env.el("work-list").textContent, /Fresh retry task/);
});

test("browser-only workspace readiness succeeds without a desktop store", async () => {
  const env = await environment({ autoEnter: false, desktop: false });
  assert.equal(await env.workspace.ready(), true);
  assert.equal(await env.workspace.ready({ retry: true }), true);
});

test("Home agent mode saves once and reflects focus and lost-acknowledgement recovery", async () => {
  const env = await environment(); const pending = deferred(); const changes = [];
  assert.equal(env.el("agent-mode").disabled, true, "wait for an authoritative saved setting");
  let mode = "swarm";
  env.bridge.assistantStatus = async () => ({ ok: true, status: { mode, execute: false, running: [] } });
  env.bridge.assistantAutopilot = (patch) => { changes.push(patch); return pending.promise; };
  await env.workspace.refresh(true);
  assert.equal(env.el("agent-mode").value, "swarm");
  assert.match(env.el("agent-mode-note").textContent, /One builder per ready task/);
  env.el("agent-mode").value = "cluster";
  const save = env.el("agent-mode").trigger("change");
  assert.equal(env.el("agent-mode").disabled, true);
  await env.el("agent-mode").trigger("change");
  assert.deepEqual(JSON.parse(JSON.stringify(changes)), [{ mode: "cluster" }]);
  mode = "cluster"; pending.resolve({ ok: true, mode, execute: false }); await save;
  assert.equal(env.el("agent-mode").value, "cluster");
  assert.equal(env.el("agent-mode").disabled, false);
  env.events.status({ mode: "cluster", clusterFocus: { title: "Improve search" }, running: [] });
  assert.match(env.el("agent-mode-note").textContent, /focus on: Improve search/);
  env.bridge.assistantAutopilot = async () => { mode = "swarm"; throw new Error("Acknowledgement lost"); };
  env.el("agent-mode").value = "swarm"; await env.el("agent-mode").trigger("change");
  assert.equal(env.el("agent-mode").value, "swarm");
  assert.match(env.el("feedback").textContent, /Acknowledgement lost/);
  await assert.rejects(() => env.workspace.setAgentMode("invalid"), /Choose Swarm or Cluster/);
  assert.equal(changes.length, 1);
});

test("Home ignores a late mode-recovery response after newer status arrives", async () => {
  const env = await environment(); const pending = deferred();
  env.bridge.assistantAutopilot = async () => ({ ok: false, error: "Save uncertain" });
  env.bridge.assistantStatus = () => pending.promise;
  env.events.status({ mode: "swarm", running: [] });
  const save = env.workspace.setAgentMode("cluster"); await flush();
  env.events.status({ mode: "swarm", running: [] });
  pending.resolve({ ok: true, status: { mode: "cluster" } });
  await assert.rejects(save, /Save uncertain/);
  assert.equal(env.el("agent-mode").value, "swarm");
});

test("build mode saves once without changing worker controls and restores the saved value on failure", async () => {
  const env = await environment(); const pending = deferred(); const changes = [];
  let autoBuild = true;
  env.bridge.assistantStatus = async () => ({ ok: true, status: { autoBuild, execute: true, running: [] } });
  env.bridge.assistantAutopilot = (patch) => { changes.push(patch); return pending.promise; };
  await env.workspace.refresh(true);
  assert.equal(env.el("auto-build").checked, true);
  env.el("auto-build").checked = false;
  const save = env.el("auto-build").trigger("change");
  assert.equal(env.el("auto-build").disabled, true);
  await env.el("auto-build").trigger("change");
  assert.equal(changes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(changes)), [{ autoBuild: false }]);
  autoBuild = false; pending.resolve({ ok: true, status: { autoBuild: false } }); await save;
  assert.equal(env.el("auto-build").checked, false);
  assert.equal(env.el("build-mode-label").textContent, "Verify first");
  assert.match(env.el("build-mode-note").textContent, /Open Review/);
  env.bridge.assistantAutopilot = async () => ({ ok: false, error: "Settings could not be saved" });
  env.el("auto-build").checked = true; await env.el("auto-build").trigger("change");
  assert.equal(env.el("auto-build").checked, false);
  assert.match(env.el("feedback").textContent, /Settings could not be saved/);
  autoBuild = true; await env.workspace.refresh(true);
  env.bridge.assistantAutopilot = async () => { autoBuild = false; throw new Error("Unable to persist; current session is held"); };
  env.el("auto-build").checked = false; await env.el("auto-build").trigger("change");
  assert.equal(env.el("auto-build").checked, false, "read the host's immediate hold after a failed persistence attempt");
  assert.match(env.el("feedback").textContent, /Unable to persist/);
});

test("unapproved builds appear in Review and open scope details without approving or prioritizing", async () => {
  const env = await environment(); const routes = []; let mutations = 0;
  env.nav.go = (...args) => routes.push(args);
  env.bridge.backlogControl = async () => { mutations++; return { ok: true }; };
  env.bridge.assistantStatus = async () => ({ ok: true, status: { autoBuild: false, running: [] } });
  env.bridge.backlogStatus = async () => ({ ok: true, counts: { approval: 1, ready: 0 }, taskStates: [{ id: "original", stage: "approval", reason: "Review the scope before building" }], next: [] });
  await env.workspace.refresh(true);
  await env.el("review").trigger("click");
  assert.match(env.el("work-list").textContent, /Awaiting approval/);
  const review = env.el("work-list").querySelectorAll("button").find((button) => button.textContent === "Review build ↗");
  assert.ok(review); await review.trigger("click");
  assert.equal(routes[0][0], "tasks"); assert.equal(routes[0][1].taskId, "original");
  assert.equal(mutations, 0);
  assert.doesNotMatch(env.el("work-list").textContent, /Do next|Try again/);
  assert.match(env.el("backlog-metrics").textContent, /1to approve/);
  await env.el("mode-work").trigger("click"); env.el("input").value = "A considered new feature";
  await env.el("form").trigger("submit");
  assert.match(env.el("feedback").textContent, /Task added for approval/);
  assert.equal(env.el("review").attrs["aria-pressed"], "true");
});

test("conversation and task drafts stay separate across mode and project changes", async () => {
  const env = await environment();
  env.el("input").value = "A question I am still thinking about";
  await env.el("input").trigger("input");
  await env.el("mode-work").trigger("click");
  assert.equal(env.el("input").value, "");
  env.el("input").value = "Export the garden journal";
  await env.el("input").trigger("input");
  await env.el("mode-chat").trigger("click");
  assert.equal(env.el("input").value, "A question I am still thinking about");
  await env.el("mode-work").trigger("click");
  assert.equal(env.el("input").value, "Export the garden journal");
  env.events.projects({ ...env.projects, activeId: "project-b" });
  await flush();
  assert.equal(env.el("input").value, "");
  assert.equal(env.el("mode-chat").attrs["aria-pressed"], "true");
  env.events.projects(env.projects);
  await flush();
  assert.equal(env.el("mode-work").attrs["aria-pressed"], "true");
  assert.equal(env.el("input").value, "Export the garden journal");
});

test("an unanswered status read cannot freeze refreshed work or prevent recovery", async () => {
  const timerQueue = []; const env = await environment({ timerQueue });
  env.bridge.assistantStatus = () => new Promise(() => {});
  env.bridge.tasksList = async () => ({ ok: true, projectId: "project-a", tasks: [{ id: "updated", title: "Fresh task while status hangs", status: "open" }] });
  const refresh = env.workspace.refresh(true);
  await flush();
  const waiting = timerQueue.filter((timer) => timer.delay === 12000 && !timer.cancelled);
  assert.equal(waiting.length, 1);
  waiting[0].fn();
  assert.equal(await refresh, false);
  assert.match(env.el("work-list").textContent, /Fresh task while status hangs/);
  assert.match(env.el("feedback").textContent, /Couldn't refresh activity/);
  assert.equal(env.el("retry").hidden, false);
  env.bridge.assistantStatus = async () => ({ ok: true, status: { running: [] } });
  assert.equal(await env.workspace.refresh(true), true);
  assert.equal(env.el("retry").hidden, true);
});

test("task creation submits once, preserves a later draft, and distinguishes saved work from a failed refresh", async () => {
  const env = await environment(); const pending = deferred(); let calls = 0; let destination;
  env.bridge.tasksCreate = () => { calls += 1; return pending.promise; };
  env.nav.go = (...args) => { destination = args; };
  await env.el("mode-work").trigger("click");
  env.el("input").value = "Create the journal export";
  const submission = env.el("form").trigger("submit");
  await env.el("form").trigger("submit");
  assert.equal(calls, 1);
  env.el("input").value = "A different task for later";
  env.bridge.tasksList = async () => { throw new Error("Read interrupted"); };
  pending.resolve({ ok: true, task: { id: "created" } });
  await submission;
  assert.equal(env.el("input").value, "A different task for later");
  assert.match(env.el("feedback").textContent, /Task added.*couldn't refresh/);
  assert.doesNotMatch(env.el("feedback").textContent, /draft is still here/);
  assert.equal(env.el("created-task").hidden, false);
  assert.equal(env.el("retry").hidden, false);
  await env.el("created-task").trigger("click");
  assert.equal(destination[0], "tasks"); assert.equal(destination[1].taskId, "created");
});

test("a saved task announces the walkthrough event and a failed creation never does", async () => {
  const env = await environment();
  env.bridge.tasksCreate = async () => ({ ok: true, task: { id: "created", projectId: "project-a" } });
  await env.el("mode-work").trigger("click");
  env.el("input").value = "Announce this task";
  await env.el("form").trigger("submit");
  const created = env.dispatched.filter((event) => event.type === "mefi:task-created");
  assert.equal(created.length, 1);
  assert.equal(created[0].detail.taskId, "created");
  const failed = await environment();
  failed.bridge.tasksCreate = async () => ({ ok: false, error: "Store busy" });
  await failed.el("mode-work").trigger("click");
  failed.el("input").value = "Never announced";
  await failed.el("form").trigger("submit");
  assert.deepEqual(failed.dispatched.filter((event) => event.type === "mefi:task-created"), []);
});

test("the optional task outline retains existing intent and never sends work", async () => {
  const env = await environment(); let calls = 0;
  env.bridge.tasksCreate = async () => { calls += 1; return { ok: true }; };
  await env.el("mode-work").trigger("click");
  env.el("input").value = "Improve the garden journal";
  await env.el("task-outline").trigger("click");
  assert.match(env.el("input").value, /^Improve the garden journal\n\nDone when:/);
  assert.equal(calls, 0);
  assert.equal(env.storage.get("mefiStudio.workspace.draft.project-a.work"), env.el("input").value);
});

test("saved tasks explain disabled workers separately from a paused assistant", async () => {
  const env = await environment();
  env.bridge.assistantStatus = async () => ({ ok: true, status: { execute: false, running: [] } });
  env.bridge.backlogStatus = async () => ({ ok: true, paused: true, counts: {}, taskStates: [] });
  await env.workspace.refresh(true);
  assert.match(env.el("narration").textContent, /Coding workers are off/);
  await env.el("mode-work").trigger("click");
  env.el("input").value = "Export the journal";
  await env.el("form").trigger("submit");
  assert.match(env.el("feedback").textContent, /Work through backlog/);
  assert.doesNotMatch(env.el("feedback").textContent, /Resume/);
});

test("a delayed same-project refresh cannot erase newer task and conversation broadcasts", async () => {
  const env = await environment();
  const tasks = deferred(); const assistant = deferred();
  env.bridge.tasksList = () => tasks.promise;
  env.bridge.assistantState = () => assistant.promise;
  const pending = env.workspace.refresh(true);
  env.events.tasks([{ id: "new", projectId: "project-a", title: "Newly added task", status: "open" }]);
  env.events.assistant({ state: { projectId: "project-a", messages: [{ role: "assistant", id: "reply", text: "Your latest reply", at: 100 }] } });
  tasks.resolve({ ok: true, projectId: "project-a", tasks: [{ id: "old", projectId: "project-a", title: "Stale task", status: "open" }] });
  assistant.resolve({ ok: true, state: { projectId: "project-a", messages: [] } });
  await pending;
  assert.match(env.el("work-list").textContent, /Newly added task/);
  assert.doesNotMatch(env.el("work-list").textContent, /Stale task/);
  assert.match(env.el("thread").textContent, /Your latest reply/);
});

test("the latest forced refresh wins when same-project reads finish out of order", async () => {
  const env = await environment(); const first = deferred();
  env.bridge.tasksList = () => first.promise;
  const oldRead = env.workspace.refresh(true);
  env.bridge.tasksList = async () => ({ ok: true, projectId: "project-a", tasks: [{ id: "fresh", projectId: "project-a", title: "Fresh snapshot", status: "open" }] });
  await env.workspace.refresh(true);
  first.resolve({ ok: true, projectId: "project-a", tasks: [{ id: "stale", projectId: "project-a", title: "Stale snapshot", status: "open" }] });
  await oldRead;
  assert.match(env.el("work-list").textContent, /Fresh snapshot/);
  assert.doesNotMatch(env.el("work-list").textContent, /Stale snapshot/);
});

test("a failed send preserves the draft and explains the failure", async () => {
  const env = await environment();
  env.el("input").value = "Keep this idea for later";
  await env.el("input").trigger("input");
  await env.el("form").trigger("submit");
  assert.equal(env.el("input").value, "Keep this idea for later");
  assert.equal(env.storage.get("mefiStudio.workspace.draft.project-a"), "Keep this idea for later");
  assert.match(env.el("feedback").textContent, /Connection unavailable/);
  assert.equal(env.el("send").disabled, false);
});

test("another project's snapshot and events cannot replace the visible project", async () => {
  const env = await environment();
  env.bridge.tasksList = async () => ({ ok: true, projectId: "project-b", tasks: [{ id: "foreign", projectId: "project-b", title: "Foreign task", status: "open" }] });
  env.bridge.assistantState = async () => ({ ok: true, state: { projectId: "project-b", messages: [{ id: "foreign-message", role: "assistant", text: "Foreign conversation" }] } });
  await env.workspace.refresh(true);
  env.events.assistant({ state: { projectId: "project-b", messages: [{ role: "assistant", text: "Foreign conversation" }] } });
  env.events.tasks([{ id: "foreign", projectId: "project-b", title: "Foreign task", status: "open" }]);
  assert.match(env.el("work-list").textContent, /Original task/);
  assert.doesNotMatch(env.el("thread").textContent, /Foreign conversation/);
  assert.equal(env.el("project-name").textContent, "Project A");
});

test("Jev errors supersede configured-key status and refresh after Settings changes", async () => {
  const env = await environment();
  env.bridge.jevStatus = async () => ({ configured: true, enabled: true, phase: "error", lastError: "Gateway rejected key", lastSuccessAt: null, nextAt: Date.now() + 60000 });
  await env.workspace.refresh(true);
  assert.doesNotMatch(env.el("jev").textContent, /connected for task intake/i);
  assert.match(env.el("jev").textContent, /error|rejected|retry|attention|unavailable|failed/i);
  env.bridge.jevStatus = async () => ({ configured: true, enabled: false });
  await env.workspace.refresh(true);
  assert.match(env.el("jev").textContent, /paused|disabled/i);
});

test("canceling Add project does not announce that a project was added", async () => {
  const env = await environment();
  await env.el("add-project").trigger("click");
  assert.doesNotMatch(env.el("feedback").textContent, /project added/i);
});

test("failed refresh preserves known work and offers a retry instead of an empty board", async () => {
  const env = await environment();
  env.bridge.tasksList = async () => { throw new Error("Board offline"); };
  await env.workspace.refresh(true);
  assert.match(env.el("work-list").textContent, /Original task/);
  assert.match(env.el("feedback").textContent, /Couldn't refresh work/);
  assert.equal(env.el("retry").hidden, false);
  env.bridge.tasksList = async () => ({ ok: true, tasks: [] });
  await env.el("retry").trigger("click");
  assert.equal(env.el("retry").hidden, true);
  assert.equal(env.el("feedback").textContent, "");
});

test("a large idea backlog is searchable past the initial page and promotes by durable project identity", async () => {
  const env = await environment();
  const ideas = Array.from({ length: 100 }, (_, i) => ({ id: `idea-${i + 1}`, title: `Garden idea ${i + 1}`, detail: i === 99 ? "unusual orchid" : "some detail", at: i + 1, status: "new", projectId: "project-a" }));
  env.bridge.ideasList = async () => ({ ok: true, ideas });
  await env.workspace.refresh(true);
  await env.el("ideas").trigger("click");
  assert.equal(env.el("work-list").children.length, 20);
  assert.match(env.el("show-more").textContent, /80 remaining/);
  await env.el("show-more").trigger("click");
  assert.equal(env.el("work-list").children.length, 40);
  env.el("work-search").value = "unusual orchid";
  await env.el("work-search").trigger("input");
  assert.equal(env.el("work-list").children.length, 1);
  assert.match(env.el("work-list").textContent, /Garden idea 100/);
  let payload;
  env.bridge.backlogControl = async (value) => { payload = value; return { ok: true }; };
  const promote = env.el("work-list").querySelectorAll("button").find((button) => button.dataset.backlogAction === "promote");
  await promote.trigger("click");
  assert.equal(payload.action, "promote");
  assert.equal(payload.ideaId, "idea-100");
  assert.equal(payload.projectId, "project-a");
  assert.equal(env.el("work-search").value, "");
  assert.match(env.el("feedback").textContent, /Idea linked/);
});

test("search exposes matches in other views and All opens tasks and ideas through their own routes", async () => {
  const env = await environment(); const destinations = [];
  env.nav.go = (...args) => destinations.push(args);
  env.bridge.tasksList = async () => ({ ok: true, tasks: [
    { id: "open", title: "Garden paths", status: "open", projectId: "project-a" },
    { id: "finished", title: "Orchid export", status: "done", projectId: "project-a" },
    { id: "foreign", title: "Orchid from elsewhere", status: "done", projectId: "project-b" },
  ] });
  env.bridge.ideasList = async () => ({ ok: true, ideas: [
    { id: "seed", title: "Orchid reminder", status: "new", projectId: "project-a" },
  ] });
  await env.workspace.refresh(true);
  env.el("work-search").value = "orchid";
  await env.el("work-search").trigger("input");
  assert.match(env.el("work-list").textContent, /No matches in queue.*2 matches are available in other views/);
  assert.equal(env.el("all").querySelector("span").textContent, "2");
  assert.equal(env.el("done").querySelector("span").textContent, "1");
  assert.equal(env.el("ideas").querySelector("span").textContent, "1");
  assert.equal(env.el("clear-search").hidden, false);
  const searchAll = env.el("work-list").querySelectorAll("button").find((button) => button.textContent === "Search all work");
  await searchAll.trigger("click");
  assert.equal(env.el("all").attrs["aria-pressed"], "true");
  assert.equal(env.el("work-summary").textContent, "All work · 2 matches");
  assert.doesNotMatch(env.el("work-list").textContent, /elsewhere/);
  const buttons = env.el("work-list").querySelectorAll("button");
  await buttons.find((button) => button.dataset.taskId === "finished").trigger("click");
  await buttons.find((button) => button.dataset.ideaId === "seed").trigger("click");
  assert.equal(destinations[0][0], "tasks"); assert.equal(destinations[0][1].taskId, "finished");
  assert.equal(destinations[1][0], "ideas"); assert.equal(destinations[1][1].ideaId, "seed");
  assert.ok(buttons.find((button) => button.dataset.backlogAction === "promote"));
  await env.el("clear-search").trigger("click");
  assert.equal(env.el("work-search").value, "");
  assert.equal(env.el("work-search").focused, true);
  assert.equal(env.el("clear-search").hidden, true);
  assert.equal(env.el("work-summary").textContent, "All work · 3 items");
});

test("All work searches across pages and updates an empty view when matches arrive elsewhere", async () => {
  const env = await environment();
  const tasks = Array.from({ length: 30 }, (_, i) => ({ id: `t-${i}`, title: `Task ${i}`, status: "open", projectId: "project-a" }));
  env.bridge.tasksList = async () => ({ ok: true, tasks });
  env.bridge.ideasList = async () => ({ ok: true, ideas: [{ id: "idea", title: "Hidden orchid idea", projectId: "project-a" }] });
  await env.workspace.refresh(true);
  await env.el("all").trigger("click");
  assert.equal(env.el("work-summary").textContent, "All work · 20 of 31 items");
  await env.el("show-more").trigger("click");
  assert.equal(env.el("work-summary").textContent, "All work · 31 items");
  assert.match(env.el("work-list").textContent, /Hidden orchid idea/);
  await env.el("open").trigger("click");
  env.el("work-search").value = "later result";
  await env.el("work-search").trigger("input");
  assert.doesNotMatch(env.el("work-list").textContent, /Search all work/);
  env.events.tasks([...tasks, { id: "later", title: "Later result", status: "done", projectId: "project-a" }]);
  assert.match(env.el("work-list").textContent, /1 match is available in other views.*Search all work/);
  await env.el("done").trigger("click");
  assert.equal(env.el("work-summary").textContent, "Done · 1 match");
  assert.match(env.el("work-list").textContent, /Later result/);
});

test("exhausted tasks expose their blocker and explicit retry in Review", async () => {
  const env = await environment();
  env.bridge.backlogStatus = async () => ({ ok: true, projectId: "project-a", counts: { ready: 0, running: 0, blocked: 1 }, taskStates: [{ id: "original", stage: "blocked", reason: "Verification limit reached; inspect before retrying." }], next: [], draining: false, paused: false });
  await env.workspace.refresh(true);
  await env.el("review").trigger("click");
  assert.match(env.el("work-list").textContent, /Verification limit reached/);
  let payload;
  env.bridge.backlogControl = async (value) => { payload = value; return { ok: true }; };
  const retry = env.el("work-list").querySelectorAll("button").find((button) => button.dataset.backlogAction === "retry");
  assert.ok(retry);
  await retry.trigger("click");
  assert.equal(payload.taskId, "original");
  assert.equal(payload.projectId, "project-a");
});

test("backlog mode starts once, reports failure honestly and can pause without pretending a task finished", async () => {
  const env = await environment();
  const pending = deferred(); const calls = [];
  env.bridge.backlogControl = (value) => { calls.push(value); return pending.promise; };
  const first = env.el("run-backlog").trigger("click");
  await env.el("run-backlog").trigger("click");
  assert.equal(calls.length, 1);
  assert.equal(env.el("run-backlog").disabled, true);
  pending.resolve({ ok: false, error: "Finish the active project switch first." });
  await first;
  assert.match(env.el("feedback").textContent, /Finish the active project switch/);
  assert.equal(env.el("run-backlog").disabled, false);
  env.bridge.backlogStatus = async () => ({ ok: true, projectId: "project-a", draining: true, paused: false, counts: { ready: 1, running: 0, blocked: 0 }, taskStates: [], next: [] });
  await env.workspace.refresh(true);
  assert.equal(env.el("run-backlog").textContent, "Pause backlog");
  env.bridge.backlogControl = async (value) => { calls.push(value); return { ok: true }; };
  await env.el("run-backlog").trigger("click");
  assert.equal(calls.at(-1).action, "pause");
  assert.match(env.el("feedback").textContent, /Running jobs finish normally/);
});

test("a foreign or failed backlog snapshot never replaces the project's work plan", async () => {
  const env = await environment();
  env.bridge.backlogStatus = async () => ({ ok: true, projectId: "project-b", counts: { ready: 999 }, next: [{ title: "Foreign task" }] });
  await env.workspace.refresh(true);
  assert.doesNotMatch(env.el("backlog-next").textContent, /Foreign task/);
  env.bridge.backlogStatus = async () => { throw new Error("Backlog offline"); };
  await env.workspace.refresh(true);
  assert.match(env.el("backlog-title").textContent, /unavailable/i);
  assert.match(env.el("feedback").textContent, /backlog/);
  assert.equal(env.el("run-backlog").disabled, true);
});

test("dependency waits and grouped work remain visible without offering an unsafe retry", async () => {
  const env = await environment();
  env.bridge.tasksList = async () => ({ ok: true, projectId: "project-a", tasks: [
    { id: "waiting", status: "open", title: "Publish the gallery" },
    { id: "grouped", status: "absorbed", title: "Resize thumbnails" },
    { id: "plan", status: "open", title: "Gallery plan" },
  ] });
  env.bridge.backlogStatus = async () => ({ ok: true, projectId: "project-a", counts: { ready: 1, waiting: 1, grouped: 1 }, taskStates: [
    { id: "waiting", stage: "waiting", reason: "Waiting for Gallery plan", dependencies: [{ id: "plan", done: false }] },
    { id: "grouped", stage: "grouped", reason: "Included in Gallery plan", groupId: "plan" },
    { id: "plan", stage: "ready" },
  ], next: [{ title: "Gallery plan" }], paused: true, summary: "Paused. Current workers can finish; new work will wait.", waiting: "Paused. Current workers can finish; new work will wait." });
  await env.workspace.refresh(true);
  assert.match(env.el("work-list").textContent, /Waiting/);
  assert.match(env.el("work-list").textContent, /Waiting for Gallery plan/);
  assert.match(env.el("work-list").textContent, /In a plan/);
  assert.match(env.el("work-list").textContent, /View plan/);
  assert.doesNotMatch(env.el("work-list").textContent, /Try again/);
  assert.match(env.el("backlog-metrics").textContent, /1waiting/);
  assert.equal(env.el("backlog-next").textContent, "Up next: Gallery plan");
});

test("the dashboard reads the real run state, workers and waiting decisions from pushes", async () => {
  const env = await environment();
  assert.equal(env.el("dash-service-value").textContent, "Ready");
  assert.equal(env.el("pause").textContent, "Pause");
  env.events.status({ projectId: "project-a", running: [{ title: "Write tests" }], execute: true, parallel: 2 });
  assert.equal(env.el("dash-service-value").textContent, "Working");
  assert.equal(env.el("dash-workers-value").textContent, "1 building");
  assert.match(env.el("dash-workers-note").textContent, /Write tests/);
  env.events.assistant({ state: { projectId: "project-a", messages: [], ai: { keyPresent: true }, questions: [{ id: "q1", title: "Ship it?", status: "open" }, { id: "q2", title: "Old", status: "answered" }] } });
  assert.equal(env.el("dash-attention-value").textContent, "1 waiting");
  assert.match(env.el("dash-attention-note").textContent, /1 question to answer/);
  assert.equal(env.el("dash-attention").dataset.target, "ask");
  env.events.status({ projectId: "project-a", running: [], execute: false });
  assert.equal(env.el("dash-service-value").textContent, "New work held");
  env.events.assistant({ state: { projectId: "project-a", messages: [], ai: { keyPresent: true }, status: "paused", questions: [] } });
  assert.equal(env.el("dash-service-value").textContent, "Paused");
  assert.equal(env.el("pause").textContent, "Resume");
  assert.equal(env.el("connection").textContent, "Paused");
});

test("Home distinguishes preparation from building and shows observed worker output and age", async () => {
  const env = await environment();
  const job = { taskId: "original", title: "Original task", phase: "preparing", startedAt: Date.now() - 70000 };
  env.events.status({ projectId: "project-a", running: [job], execute: true });
  assert.equal(env.el("dash-workers-value").textContent, "1 preparing");
  assert.match(env.el("narration").textContent, /Preparing: Original task/);
  assert.match(env.el("work-list").textContent, /No update yet.*1m elapsed/);
  env.events.status({ projectId: "project-a", running: [{ ...job, phase: "building", route: "Codex CLI", activity: "Checking keyboard controls", lastOutputAt: Date.now() - 10000 }], execute: true });
  assert.equal(env.el("dash-workers-value").textContent, "1 building");
  assert.match(env.el("narration").textContent, /Worker output: Checking keyboard controls/);
  assert.match(env.el("work-list").textContent, /Codex CLI.*Updated 10s ago/);
  env.events.status({ projectId: "project-a", running: [{ ...job, phase: "finishing" }], execute: true });
  assert.equal(env.el("dash-workers-value").textContent, "1 finishing");
  assert.match(env.el("narration").textContent, /Worker reported completion.*waiting for its process/);
});

test("Home ages a quiet worker's last update without replacing its task card", async () => {
  let now = 200000;
  const job = { taskId: "original", title: "Original task", phase: "building", route: "Codex CLI", startedAt: 180000, lastOutputAt: 190000, activity: "Checking controls" };
  const env = await environment({ now: () => now, bridgeOverrides: {
    assistantStatus: async () => ({ ok: true, status: { projectId: "project-a", running: [job], execute: true } }),
  } });
  const card = env.el("work-list").children[0];
  assert.match(env.el("work-list").textContent, /Updated 10s ago/);
  now += 60000;
  await env.workspace.refresh(true);
  assert.equal(env.el("work-list").children[0], card);
  assert.match(env.el("work-list").textContent, /Updated 1m ago/);
});

test("one pause control holds all new work and resumes through start-work", async () => {
  const calls = [];
  const env = await environment({ bridgeOverrides: {
    backlogControl: async (payload) => { calls.push(["backlog", payload]); return { ok: true, backlog: { paused: true, counts: { ready: 1 }, next: [], taskStates: [] } }; },
    assistantControl: async (action) => { calls.push(["control", action]); return { ok: true, state: { projectId: "project-a", messages: [], ai: { keyPresent: true } }, autopilot: { execute: true, running: [] } }; },
  } });
  await env.el("pause").trigger("click"); await flush();
  assert.equal(calls.at(-1)[0], "backlog");
  assert.equal(calls.at(-1)[1].action, "pause");
  assert.equal(env.el("pause").textContent, "Resume");
  assert.equal(env.el("dash-service-value").textContent, "New work held");
  await env.el("pause").trigger("click"); await flush();
  assert.deepEqual(calls.at(-1), ["control", "start-work"]);
  assert.equal(env.el("pause").textContent, "Pause");
  assert.equal(env.el("dash-service-value").textContent, "Ready");
});

test("the Needs you tile names which decision each waiting task needs", async () => {
  const env = await environment({ bridgeOverrides: {
    tasksList: async () => ({ ok: true, projectId: "project-a", tasks: [
      { id: "scope", projectId: "project-a", title: "Scope to approve", status: "open" },
      { id: "stuck", projectId: "project-a", title: "Parked task", status: "open" },
      { id: "check", projectId: "project-a", title: "Finished worker", status: "awaiting_verification" },
      { id: "plain", projectId: "project-a", title: "Ready task", status: "open" },
    ] }),
    backlogStatus: async () => ({ ok: true, projectId: "project-a", counts: { approval: 1, blocked: 1, ready: 1 }, taskStates: [{ id: "scope", stage: "approval" }, { id: "stuck", stage: "blocked", reason: "Verification limit reached" }, { id: "plain", stage: "ready" }], next: [], paused: false, draining: false }),
  } });
  await env.workspace.refresh(true); await flush();
  assert.equal(env.el("dash-attention-value").textContent, "3 waiting");
  assert.equal(env.el("dash-attention-note").textContent, "1 awaiting approval · 1 blocked · 1 to review");
  assert.equal(env.el("dash-attention").dataset.target, "review");
});

test("status pushes leave unchanged work tabs untouched and read the backlog at most once per 3.5 s", async () => {
  const timerQueue = [];
  const env = await environment({ timerQueue });
  const tab = env.el("open"), badge = tab.children[0];
  const writes = [];
  const setAttribute = tab.setAttribute.bind(tab);
  tab.setAttribute = (name, value) => { writes.push(name); setAttribute(name, value); };
  let text = badge.textContent;
  Object.defineProperty(badge, "textContent", { get: () => text, set: (value) => { writes.push("count"); text = String(value); } });
  const pending = () => timerQueue.filter((timer) => !timer.cancelled && timer.delay !== 12000);
  const before = pending().length;
  env.events.status({ projectId: "project-a", running: [], execute: true });
  env.events.status({ projectId: "project-a", running: [], execute: true });
  assert.deepEqual(writes, [], "an unchanged push rewrites neither the counts nor the tab attributes");
  const queued = pending().slice(before);
  assert.equal(queued.length, 1, "pushes share one queued backlog read");
  assert.ok(queued[0].delay > 3000 && queued[0].delay <= 3500, `a push right after a refresh waits out the interval (queued ${queued[0].delay} ms)`);
  env.events.tasks([{ id: "original", projectId: "project-a", title: "Original task", status: "open" }, { id: "second", projectId: "project-a", title: "Second task", status: "open" }]);
  assert.equal(text, "2", "a real change still updates the count");
  assert.equal(pending().slice(before).length, 1, "and joins the same queued read");
});
