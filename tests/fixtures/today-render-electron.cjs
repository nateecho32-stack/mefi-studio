"use strict";

// Today and the Inbox in a real Chromium (layout v2, Vibe mode): a copied booklet and a
// synthetic bridge that keeps a small world of its own. The project holds one of everything
// that waits on the owner (a decision, a permission, a failed check, an approval, steps to
// approve, a stuck task, a result to check), a job running, one up next, one being checked,
// a plan and three things finished today. The bridge answers the host calls Today makes
// (assistant:answer, backlog:control, tasks:action, autonomy:undo), changes its world the
// way the host would and pushes what changed, so what is checked here is what a person sees.
//
// It opens Today at five window sizes (with the node tree behind it), then the Inbox as a
// popover under a stand-in for the top bar's "N need you" pill and as a page, and checks the
// real geometry: nothing overflows the page, no scroller reserves width for a bar, no text is
// under 12 px, everything is reachable, the backdrop and the media are not covered. Then it
// drives the page the way a person does (answer on a card, answer in the popover, approve,
// drop and undo, retry, refuse, keys, the notification hand-off). No application main process or live state is loaded;
// network, permissions and child processes are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_TODAY_FIXTURE;
const source = process.env.MEFI_TODAY_SOURCE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Today fixture directory is required");
if (!source || !path.isAbsolute(source)) throw new Error("The studio source directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], checks: [] };
app.setName("Today Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
}
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-prefers-reduced-motion", "reduce");
const childProcess = require("node:child_process");
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = () => { report.processAttempts.push(name); throw new Error("Child execution is disabled in this fixture"); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
function finish(error) {
  if (finished) return; finished = true;
  if (error) { report.failure = error.stack || String(error); console.error(report.failure); }
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);

// ---- the world: what the host knows -------------------------------------------------------------------
const MINUTE = 60000;
function seedWorld(now) {
  const projectId = "today-project";
  const task = (id, title, more = {}) => ({ id, projectId, title, status: "open", createdAt: now - 90 * MINUTE, updatedAt: now - 30 * MINUTE, ...more });
  const tasks = [
    task("t_run", "Add dark mode to the settings page", { status: "active", runId: "run-1", updatedAt: now - 2 * MINUTE }),
    // The decision question's own task, waiting for the answer and not running: a run that waits on you is under Needs you only.
    task("t_tags", "Treat #Work and #work as one tag", { status: "open", updatedAt: now - 4 * MINUTE }),
    task("t_next", "Translate the help page into German", { updatedAt: now - 45 * MINUTE }),
    task("t_check", "Polish the onboarding copy", { status: "awaiting_verification", awaitingAt: now - 6 * MINUTE, updatedAt: now - 6 * MINUTE }),
    task("t_review", "Rename the settings tab to Preferences", { status: "awaiting_verification", awaitingAt: now - 55 * MINUTE, updatedAt: now - 55 * MINUTE, verification: { state: "failed", reason: "The checker could not start a browser to look at the page." } }),
    task("t_approve", "Add a changelog page linked from the footer", { needsApproval: true, buildScope: "scope-approve", updatedAt: now - 12 * MINUTE }),
    task("t_family", "Split the settings page into tabs", { delegation: { intake: true, childTaskIds: ["t_step1", "t_step2"], summary: "Two steps, then a final check." }, updatedAt: now - 20 * MINUTE }),
    task("t_step1", "Move the account fields into an Account tab", { needsApproval: true, buildScope: "scope-s1", delegatedFrom: { intake: true, parentTaskId: "t_family" }, parentTaskId: "t_family", updatedAt: now - 20 * MINUTE }),
    task("t_step2", "Move the notification switches into a Notifications tab", { needsApproval: true, buildScope: "scope-s2", delegatedFrom: { intake: true, parentTaskId: "t_family" }, parentTaskId: "t_family", updatedAt: now - 20 * MINUTE }),
    task("t_stuck", "Fix the login redirect loop", { parkedAt: now - 25 * MINUTE, runFailures: 5, updatedAt: now - 25 * MINUTE }),
    task("t_sidebar", "Keep the sidebar scroll position", { status: "active", runId: "run-2", updatedAt: now - 17 * MINUTE }),
    task("t_done1", "Fix the typo on the about page", { status: "done", doneAt: now - 50 * MINUTE, verification: { state: "verified", reason: "The page loads and the text reads correctly." } }),
    task("t_done2", "Tidy the footer links", { status: "done", doneAt: now - 95 * MINUTE, verification: { state: "verified", reason: "All seven links open." } }),
    task("t_done3", "Make the export button keyboard reachable", { status: "done", doneAt: now - 130 * MINUTE }),
  ];
  const at = (minutes) => now - minutes * MINUTE;
  const questions = [
    { id: "q_decision", projectId, status: "open", source: "issue", title: "Should #Work and #work count as the same tag?", detail: "The tag filter matches exactly today; every other filter in this project ignores case.", at: at(4),
      context: { taskId: "t_tags", taskTitle: "Treat #Work and #work as one tag", severity: "decision", suggestion: { optionId: "yes", reason: "every other filter here ignores case" }, evidence: ["filters.js:41  compares tags with ===", "search.js:88  lowercases both sides"] },
      options: [{ id: "yes", label: "Yes, ignore case", recommended: true }, { id: "no", label: "Keep them separate" }, { id: "say", label: "Answer it in one line", text: true }] },
    { id: "q_permission", projectId, status: "open", source: "issue", title: "builder-3 wants to write outside its task folder", detail: "It asked for write access to ./shared/tokens.json.", at: at(9),
      context: { taskId: "t_next", taskTitle: "Translate the help page into German", issueKind: "permission", severity: "blocker" },
      options: [{ id: "grant", label: "Grant it for this task" }, { id: "deny", label: "Deny", recommended: true }, { id: "hold", label: "Leave it for review", dismiss: true }] },
    { id: "q_failure", projectId, status: "open", source: "issue", title: "The checks failed twice on the sidebar fix. Try a different approach?", at: at(17),
      context: { taskId: "t_sidebar", taskTitle: "Keep the sidebar scroll position", issueKind: "check-failed", severity: "decision" },
      options: [{ id: "retry", label: "Try a different approach", recommended: true }, { id: "stop", label: "Stop here" }] },
  ];
  const decisions = [{ id: "decision-1", label: "Merged a duplicate card", choice: "merge", reason: "Two cards asked for the same footer change.", at: at(20), taskId: "t_next" }];
  const messages = [
    { id: "m1", role: "assistant", kind: "notice", taskId: "t_done1", text: "Finished the typo fix on the about page and checked it.", at: at(48) },
    { id: "m2", role: "assistant", kind: "notice", taskId: "t_done2", text: "Tidied the footer links: all seven open.", at: at(93) },
  ];
  return {
    projectId, now,
    projects: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Sunrise", path: root }, { id: "other-project", name: "Second project", path: `${root}/second` }] },
    tasks, plans: [{ id: "plan_1", projectId, title: "Offline mode", status: "draft", archivedAt: null, createdAt: at(200), updatedAt: at(120), spec: { approvedAt: null, stale: false }, questions: [] }],
    assistant: { projectId, status: "running", agents: [], messages, prefs: {}, work: [], questions, decisions, todos: [], ai: { keyPresent: true }, needsYou: { items: [], counts: { total: 0 } } },
    status: { projectId, enabled: true, execute: true, autoBuild: true, mode: "swarm", history: [], running: [{ taskId: "t_run", runId: "run-1", title: "Add dark mode to the settings page", route: "Fixture builder", phase: "running", currentStep: "Bash running · checking the preview response", startedAt: at(2), lastOutputAt: at(1), progress: 0.45 }] },
    backlog: { paused: false, draining: false, counts: { ready: 1, running: 1 }, taskStates: [], next: [{ id: "t_next", title: "Translate the help page into German", stage: "ready", kind: "task" }], approval: [], blocked: [] },
    autonomy: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions, todos: [] },
  };
}

// ---- the host, inside the page's own world (a preload) -----------------------------------------------------
// Written as a function so it is checked like any other code, then sent to the page as source.
function hostLogic(seed, electron, extraResponses) {
  const { contextBridge } = electron;
  const MINUTE = 60000;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const world = clone(seed);
  const calls = [];
  const failures = {};
  const subscribers = {};
  const subscribe = (name) => (callback) => { (subscribers[name] ||= []).push(callback); return () => { subscribers[name] = (subscribers[name] || []).filter((entry) => entry !== callback); }; };
  const emit = (name, payload) => { for (const callback of [...(subscribers[name] || [])]) callback(clone(payload)); };
  const byId = (id) => world.tasks.find((task) => task.id === id);
  const queued = (task) => !task.status || ["open", "pending", "queued"].includes(task.status);
  const snapshots = {};

  // What scripts/companion.cjs queue() would list for these tasks and questions (the fixture checks the two agree).
  const ORDER = ["question", "approval", "held", "parked", "review"];
  function need(task, now) {
    if (!task.id || task.absorbedInto) return null;
    if (task.status === "awaiting_verification") { const at = Number(task.awaitingAt) || Number(task.lastAttempt?.at) || Number(task.updatedAt) || 0; return at && now - at >= 30 * MINUTE ? { kind: "review", at } : null; }
    if (!queued(task)) return null;
    const cooling = Number(task.nextRunAt) > now;
    const parked = Number(task.parkedAt) > 0 || Number(task.verifyAttempts) >= 3 || Number(task.runFailures) >= 5 || task.verification?.state === "failed";
    if (task.ownerHold || task.loopGuard) return { kind: "held", at: Number(task.ownerHold?.at) || Number(task.updatedAt) };
    if (parked && !cooling) return { kind: "parked", at: Number(task.parkedAt) || Number(task.updatedAt) };
    if (task.needsApproval) return { kind: "approval", at: Number(task.updatedAt) || Number(task.createdAt) };
    return null;
  }
  function digest(now) {
    const items = [];
    const asked = new Set();
    for (const question of world.assistant.questions) {
      if (question.status !== "open") continue;
      const taskId = question.context?.taskId ? String(question.context.taskId) : null;
      if (taskId) asked.add(taskId);
      items.push({ id: String(question.id), kind: "question", taskId, title: question.title, at: Number(question.at), issueKind: question.context?.issueKind || null, actions: (question.options || []).map((option) => ({ id: option.id, label: option.label })) });
    }
    const families = new Map();
    for (const task of world.tasks) {
      const found = need(task, now);
      if (!found || asked.has(String(task.id))) continue;
      const parentId = found.kind === "approval" && task.delegatedFrom?.intake ? task.parentTaskId || task.delegatedFrom.parentTaskId : null;
      if (parentId) {
        if (!families.has(parentId)) { const parent = byId(parentId); const family = { id: `approval:${parentId}`, kind: "approval", taskId: parentId, memberIds: [], title: parent?.title || "Your request", at: found.at, actions: [{ id: "approve", label: "Review these steps" }] }; families.set(parentId, family); items.push(family); }
        families.get(parentId).memberIds.push(String(task.id));
        continue;
      }
      items.push({ id: `${found.kind}:${task.id}`, kind: found.kind, taskId: String(task.id), title: task.title, at: found.at, actions: [] });
    }
    items.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const counts = { total: items.length };
    return { items, counts };
  }
  function rebuild() {
    const now = Date.now();
    world.assistant.needsYou = digest(now);
    world.backlog.approval = world.tasks.filter((task) => queued(task) && task.needsApproval).map((task) => ({ id: task.id, kind: "task", title: task.title, canApprove: true, buildScope: task.buildScope || null }));
    world.backlog.blocked = world.tasks.filter((task) => { const found = need(task, now); return found && (found.kind === "held" || found.kind === "parked"); }).map((task) => ({ id: task.id, kind: "task", title: task.title, blockedBy: task.ownerHold ? "owner" : "loop", reason: "The same check failed three times in a row.", canRetry: true }));
    world.backlog.taskStates = world.tasks.filter((task) => queued(task)).map((task) => ({ id: task.id, stage: task.needsApproval ? "approval" : task.parkedAt ? "blocked" : "ready" }));
  }
  function pushAll() {
    rebuild();
    emit("onTasks", world.tasks);
    emit("onAssistant", { state: world.assistant });
    emit("onAssistantStatus", world.status);
  }
  rebuild();

  const bridge = {};
  for (const [key, value] of Object.entries(extraResponses)) bridge[key] = async () => clone(value);
  bridge.projectsList = async () => clone(world.projects);
  bridge.tasksList = async () => ({ ok: true, projectId: world.projectId, tasks: clone(world.tasks) });
  bridge.assistantState = async () => ({ ok: true, state: clone(world.assistant) });
  bridge.assistantStatus = async () => ({ ok: true, status: clone(world.status) });
  bridge.backlogStatus = async () => ({ ok: true, projectId: world.projectId, ...clone(world.backlog) });
  bridge.planningList = async () => ({ ok: true, projectId: world.projectId, plans: clone(world.plans) });
  bridge.autonomyState = async () => clone(world.autonomy);
  const record = (name, run) => async (...args) => {
    calls.push({ name, args: clone(args) });
    if (failures[name]?.length) return failures[name].shift();
    return run(...args);
  };
  bridge.assistantAnswer = record("assistantAnswer", (payload) => {
    const question = world.assistant.questions.find((entry) => entry.id === payload.id);
    if (!question || question.status !== "open") return { ok: false, gone: true, error: "That question is no longer waiting." };
    question.status = "answered"; question.answer = { optionId: payload.optionId || null, text: payload.text || "" };
    pushAll();
    return { ok: true, state: clone(world.assistant) };
  });
  bridge.backlogControl = record("backlogControl", (payload) => {
    const task = byId(payload.taskId);
    if (!task) return { ok: false, error: "That task is gone." };
    if (payload.expectedScope !== task.buildScope) return { ok: false, error: "That brief changed. Open it and read it again." };
    task.needsApproval = false; task.updatedAt = Date.now();
    pushAll();
    return { ok: true };
  });
  bridge.tasksAction = record("tasksAction", (payload) => {
    const task = byId(payload.taskId);
    if (!task) return { ok: false, error: "That task is gone." };
    if (payload.action === "retry") { snapshots[task.id] = clone(task); delete task.parkedAt; task.runFailures = 0; task.nextRunAt = Date.now() + 10 * 60000; task.status = "open"; if (task.verification?.state === "failed") delete task.verification; }
    else if (payload.action === "drop") { snapshots[task.id] = clone(task); task.dropped = true; task.status = "done"; task.doneAt = Date.now(); }
    else if (payload.action === "status" && payload.status === "done") { snapshots[task.id] = clone(task); task.status = "done"; task.doneAt = Date.now(); }
    else if (payload.action === "status" && payload.status === "open") { Object.assign(task, snapshots[task.id] || { status: "open" }); delete task.dropped; }
    else if (payload.action === "merge-steps") { for (const id of task.delegation?.childTaskIds || []) { const step = byId(id); if (step) { step.dropped = true; step.status = "done"; } } }
    task.updatedAt = Date.now();
    pushAll();
    return { ok: true };
  });
  bridge.autonomyUndo = record("autonomyUndo", (payload) => {
    const decision = world.autonomy.decisions.find((entry) => entry.id === payload.id);
    if (decision) decision.undone = Date.now();
    return { ok: true };
  });
  bridge.vibeBuild = record("vibeBuild", () => ({ ok: true, steps: 0, task: { id: "t_new" }, state: clone(world.assistant) }));
  bridge.tasksCreate = record("tasksCreate", () => ({ ok: true, task: { id: "t_new" } }));
  bridge.assistantMessage = record("assistantMessage", () => ({ ok: true }));
  bridge.planningExplore = record("planningExplore", (payload) => ({ ok: true, projectId: payload.projectId, summary: "Mefi read the project's pages and found two small, safe steps.", suggestions: [
    { label: "Keep the sidebar scroll position", text: "When a task finishes the sidebar jumps to the top; keep where the owner was.", reason: "It happens on every finished task.", files: ["renderer/sidebar.js"] },
    { label: "Name the export button", text: "The export button has an icon and no name for screen readers.", files: [] },
  ] }));
  bridge.ideasAction = record("ideasAction", (payload) => ({ ok: true, projectId: payload.projectId, idea: { id: "idea_1" }, ideas: [] }));
  for (const name of ["onTasks", "onProjects", "onAssistant", "onAssistantStatus", "onProjectPreview", "onIdeas", "onSettingsChanged", "onStudioLog", "onAutoSetup"]) bridge[name] = subscribe(name);
  bridge.prefsSet = async (patch) => ({ ok: true, prefs: patch });
  contextBridge.exposeInMainWorld("mefiStudio", bridge);
  contextBridge.exposeInMainWorld("todayFixture", {
    calls: () => clone(calls), clear: () => { calls.length = 0; },
    fail: (name, result) => { (failures[name] ||= []).push(result); },
    digest: () => clone(world.assistant.needsYou),
    world: () => clone({ tasks: world.tasks, backlog: world.backlog }),
  });
  for (const [key, value] of Object.entries({ "mefiStudio.commandHome": "0", "mefiStudio.zen": "0", "mefiStudio.zenReactive": "0", "mefiStudio.keyHint.v1": "1", "mefiStudio.walkthrough.v1": JSON.stringify({ version: 1, step: 0, status: "complete" }) })) localStorage.setItem(key, value);
}

// The host's other answers: what the pages around Vibe ask for while they start. Nothing here is Today's.
function otherResponses(projectId, catalog) {
  const configuration = { aiProvider: "auto", executorCli: "opencode", executorTier: "auto", aiAutoProviders: ["zai", "opencode"], agentBrain: { contextScout: true, deskTool: false } };
  const routing = { provider: "auto", roleProviders: {}, models: {}, providerModels: {}, hasZen: true, hasOpenCode: false, hasZai: false, hasOpenRouter: false, hasCustom: false, autoProviders: ["zai", "opencode"], autoFallback: false, subscriptionFirst: true, modelSelection: "jev", executorCli: "opencode", executorTier: "auto", executorTierDefaults: {}, lmStudioEndpoint: "http://127.0.0.1:1234/v1", customEndpoint: "", autoSetup: null };
  return {
    ideasList: { ok: true, ideas: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: true, useReference: true, useTree: true, useWeb: false } },
    projectPreviewStatus: { ok: true, projectId, phase: "idle", available: false, message: "", logs: [] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: catalog, getAiRouting: routing, cliStatus: [], jevStatus: { enabled: true, route: "zen", routes: { vercel: false, typesafe: false, zen: true, openrouter: false } }, getApiKey: { saved: false }, launchStudio: { ok: true },
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [], skills: [], mcpTools: [], routing, seats: {}, choices: {}, efforts: ["minimal", "low", "medium", "high", "xhigh", "max"] },
    cliSetupStatus: { ok: true, selected: "auto", clis: [] }, firstRunStatus: { ok: true, firstRun: null },
    machineGet: { ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } }, updateStatus: { ok: true, status: { auto: true } },
    companionState: { ok: true, projectId, projectName: "Sunrise", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: true, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
    openrouterModels: { ok: true, models: [] }, agentModels: { ok: true, models: [] },
    brainState: { ok: true, tasks: [], recent: [], pipelines: {} }, brainPlaybook: { ok: true, shelf: [], recipes: [] }, brainMap: { ok: true, map: { systems: [], edges: [], files: [] } },
    companionWelcome: { ok: true }, companionSeen: { ok: true },
  };
}

// ---- what is measured in the page ----------------------------------------------------------------------------
// One function, sent to the page as source: what a surface looks like right now, in real pixels.
function measureIn(rootSelector) {
  const roots = [...document.querySelectorAll(rootSelector)];
  const root = roots.find((node) => node.getClientRects().length) || roots[0];
  if (!root) return { missing: true, selector: rootSelector };
  const visible = (node) => {
    for (let walk = node; walk && walk !== document.documentElement; walk = walk.parentElement) { const style = getComputedStyle(walk); if (style.display === "none" || style.visibility === "hidden") return false; }
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const name = (node) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${typeof node.className === "string" && node.className ? `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}`;
  const everything = [root, ...root.querySelectorAll("*")].filter(visible);
  const ownText = (node) => [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
  const small = everything.filter((node) => ownText(node) && parseFloat(getComputedStyle(node).fontSize) < 12 && !node.closest("svg")).map((node) => `${name(node)}:${getComputedStyle(node).fontSize}`);
  const scrollers = everything.filter((node) => /(auto|scroll)/.test(`${getComputedStyle(node).overflowX} ${getComputedStyle(node).overflowY}`)).map((node) => {
    const style = getComputedStyle(node);
    return { name: name(node), gutter: node.offsetWidth - node.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth), sideways: node.scrollWidth > node.clientWidth + 1, scrollbarWidth: style.scrollbarWidth, scrolls: node.scrollHeight > node.clientHeight + 1 };
  });
  const box = (node) => { const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const outside = everything.filter((node) => { const r = node.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).filter((node) => !node.closest("[aria-hidden='true']")).map((node) => `${name(node)}:${Math.round(node.getBoundingClientRect().left)}..${Math.round(node.getBoundingClientRect().right)}`);
  // For a failure message: the first element outside the window and the boxes of what holds it, innermost first.
  const first = everything.find((node) => { const r = node.getBoundingClientRect(); return (r.right > innerWidth + 1 || r.left < -1) && !node.closest("[aria-hidden='true']"); });
  const trail = [];
  for (let walk = first; walk && walk !== document.body; walk = walk.parentElement) { const r = walk.getBoundingClientRect(); trail.push(`${name(walk)} ${Math.round(r.left)}..${Math.round(r.right)} (${getComputedStyle(walk).display})`); }
  return {
    trail,
    inner: { w: innerWidth, h: innerHeight }, root: box(root), rootName: name(root),
    pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
    small, scrollers, outside,
    clippedText: everything.filter((node) => ownText(node) && node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflow === "visible" && getComputedStyle(node).display !== "inline").map(name),
  };
}

// The lowest contrast (WCAG ratio) of each kind of text in a surface, against the colours painted under it (translucent layers composited from the page down; gradients
// and blurs are not seen, so it is a floor for a smoke test, not a verdict). One function, sent to the page as source.
function contrastIn(groups) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => { const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const backdrop = (node) => {
    const chain = []; for (let walk = node; walk; walk = walk.parentElement) chain.unshift(walk);
    let base = over(rgba(getComputedStyle(document.documentElement).backgroundColor), { r: 255, g: 255, b: 255, a: 1 });
    for (const link of chain) { const style = getComputedStyle(link); const paint = rgba(style.backgroundColor); if (paint.a > 0) base = over({ ...paint, a: paint.a * (Number(style.opacity) || 1) }, base); }
    return base;
  };
  const out = {};
  for (const [name, selector] of Object.entries(groups)) {
    let lowest = null;
    for (const node of document.querySelectorAll(selector)) {
      const box = node.getBoundingClientRect();
      if (!(box.width > 0 && box.height > 0) || getComputedStyle(node).visibility === "hidden" || !node.textContent.trim()) continue;
      const style = getComputedStyle(node), under = backdrop(node), ink = over(rgba(style.color), under);
      const value = ratio(ink, under);
      if (lowest === null || value < lowest.ratio) lowest = { ratio: Math.round(value * 100) / 100, text: node.textContent.trim().slice(0, 24) };
    }
    out[name] = lowest;
  }
  return out;
}

// ---- the run -----------------------------------------------------------------------------------------------------
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url);
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const now = Date.now();
  const seed = seedWorld(now);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8"));
  const preload = path.join(root, "today-preload.cjs");
  fs.writeFileSync(preload, `(${hostLogic.toString()})(${JSON.stringify(seed)}, require('electron'), ${JSON.stringify(otherResponses(seed.projectId, catalog))});`);
  const open = async (query) => {
    const window = new BrowserWindow({ show: false, width: 1920, height: 1080, enableLargerThanScreen: true, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
    const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
    await window.loadFile(path.join(root, "renderer", "booklet.html"), { query });
    return { window, contents };
  };
  let { window, contents } = await open({ capture: "1", layout: "v2" });
  // Runs code in the page; what it throws comes back as its own message and stack, not as "Script failed to execute".
  const run = async (code) => {
    const answer = await contents.executeJavaScript(`(async()=>{try{${code}}catch(error){return {__pageError:String(error&&error.stack||error)};}})()`, true);
    if (answer && typeof answer === "object" && answer.__pageError) throw new Error(`${answer.__pageError}\n  while running: ${code.replace(/\s+/g, " ").slice(0, 260)}`);
    return answer;
  };
  const until = async (condition, label) => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    report.lastState = await run("return { route: window.MefiNav?.current?.(), today: window.MefiToday?.snapshot?.(), layout: document.documentElement.dataset.layout };").catch(() => null);
    fs.writeFileSync(path.join(root, "today-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${label}`);
  };
  const capture = async (name) => {
    await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(200);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
  };
  const measure = (selector) => run(`return (${measureIn.toString()})(${JSON.stringify(selector)});`);
  const calls = (name) => run(`return window.todayFixture.calls().filter((call) => call.name === ${JSON.stringify(name)}).map((call) => call.args[0]);`);
  const check = (label) => report.checks.push(label);
  const text = (selector) => run(`return document.querySelector(${JSON.stringify(selector)})?.textContent ?? null;`);
  const cardOf = (key) => `#today-board [data-key="${key}"]`;
  const popCard = (key) => `#today-inbox [data-key="${key}"]`;
  const click = (selector) => run(`const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.focus(); node.click(); return true;`);
  const press = (selector, label) => run(`const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => item.textContent.trim() === ${JSON.stringify(label)}); if (!node || node.disabled) return false; node.focus(); node.click(); return true;`);
  const pillCount = () => run("const n = document.querySelector('#shell-need .shell-pill-n'), l = document.querySelector('#shell-need .shell-pill-l'); return n && l ? (n.textContent + ' ' + l.textContent).replace(/\\s+/g, ' ').trim() : null;");

  await until("window.MefiVibe && window.MefiNav && window.MefiToday && !window.MefiBoot?.isActive?.()", "studio ready");
  assert.equal(await run("return document.documentElement.dataset.layout;"), "v2", "layout v2 is on for this window");
  report.registered = await run("return ['today', 'inbox', 'inbox-open'].map((id) => { const record = window.MefiNav.get(id); return record ? { id: record.id, kind: record.kind, layer: record.layer, element: record.element || null } : null; });");
  assert.deepEqual(report.registered, [{ id: "today", kind: "overlay", layer: "sheet", element: "today-overlay" }, { id: "inbox", kind: "overlay", layer: "sheet", element: "inbox-overlay" }, { id: "inbox-open", kind: "action", layer: null, element: null }]);

  // The real digest the companion module keeps, against this bridge's own: the same needs, in the same order.
  const companion = require(path.join(source, "scripts", "companion.cjs"));
  const realQueue = companion.queue({ questions: seed.assistant.questions, tasks: seed.tasks, now: Date.now(), project: "Sunrise" });
  const bridgeQueue = await run("return window.todayFixture.digest();");
  assert.deepEqual(bridgeQueue.items.map((item) => item.id), realQueue.items.map((item) => item.id), "the synthetic needs-you list is the companion's own");
  assert.equal(bridgeQueue.counts.total, realQueue.counts.total);
  report.digest = bridgeQueue.items.map((item) => `${item.kind}:${item.id}`);

  // The top bar's pill is the frame's own (renderer/shell.js, in this window): it reads count() and opens the Inbox; the bars take their room from
  // the window the way the real regions do.
  await until("window.MefiShell && window.MefiShell.active() && document.getElementById('shell-need')", "the frame's bar and its need pill are up");

  // ---- Today, at five sizes ----------------------------------------------------------------------------------
  await run("await window.MefiVibe.setMode('vibe'); await window.MefiVibe.refresh();");
  await until("document.getElementById('vibe-layer') && !document.getElementById('vibe-layer').hidden && document.querySelector('#today-board .today-card')", "Today is up in Vibe");
  await sleep(400);
  await run("await window.MefiAutonomy?.refresh?.();");
  assert.equal(await run("return document.getElementById('vibe-layer').dataset.today;"), "on");
  assert.equal(await pillCount(), "7 need you", "the pill reads the digest's count");
  assert.equal(await run("return window.MefiToday.count();"), 7);
  report.board = await run("return window.MefiToday.snapshot().groups;");
  assert.deepEqual(report.board, {
    needs: ["need:question:q_failure", "need:question:q_permission", "need:question:q_decision", "need:family:t_family", "need:approval:t_approve", "need:blocked:t_stuck"],
    // t_next asked for a permission (q_permission), so it waits under Needs you and is not also up next under Running.
    running: ["run:t_run"], review: ["need:review:t_review", "check:t_check", "plan:plan_1"], done: ["done:t_done1", "done:t_done2", "done:t_done3"],
  });
  const view = async (label, zoom) => {
    const at = `${label}@${zoom}`;
    // Today itself.
    const m = await measure("#today-page");
    const topBar = await measure("#vibe-layer > .vibe-top");
    assert.deepEqual(topBar.small, [], `no text under 12 px in Vibe's own top bar, which stays over Today, at ${at}`);
    assert.equal(topBar.pageOverflow, false);
    assert.deepEqual(topBar.outside, [], `Vibe's own top bar stays inside the window over Today at ${at}`);
    const layer = await run(`
      const layer = document.getElementById('vibe-layer'), sky = layer.querySelector('.vibe-sky'), page = document.getElementById('today-page'), scroll = document.getElementById('today-scroll');
      const box = (node) => { const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const compose = document.getElementById('vibe-compose'), hero = page.querySelector('.vibe-hero'), board = document.getElementById('today-board'), first = board.querySelector('.today-card');
      const idle = document.getElementById('idle-layer'), idleFar = document.getElementById('idle-layer-far');
      const cards = [...board.querySelectorAll('.today-card')];
      return { layer: box(layer), sky: box(sky), page: box(page), col: box(page.querySelector('.today-col')), scroll: { ...box(scroll), scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight, gutter: scroll.offsetWidth - scroll.clientWidth },
        compose: box(compose), hero: box(hero), words: { kicker: document.getElementById('vibe-kicker').textContent, title: document.getElementById('vibe-title').textContent }, board: box(board), firstCard: box(first), groups: [...board.querySelectorAll('.today-group')].map((group) => ({ group: group.dataset.group, ...box(group) })),
        backdrop: { layerAlpha: (() => { const c = getComputedStyle(layer).backgroundColor, slash = c.lastIndexOf('/'); if (slash > 0) return parseFloat(c.slice(slash + 1)); return c.startsWith('rgba') ? parseFloat(c.split(',').pop()) : 1; })(), skyVisible: getComputedStyle(sky).display !== 'none', idle: idle ? { hidden: idle.hidden, ...box(idle) } : null, idleFar: idleFar ? { hidden: idleFar.hidden, ...box(idleFar) } : null },
        cards: cards.map((card) => ({ key: card.dataset.key, ...box(card), title: box(card.querySelector('.today-card-title')), open: box(card.querySelector('.today-card-open')) })),
        top: [...layer.querySelectorAll(':scope > .vibe-top button')].filter((node) => node.getClientRects().length).map((node) => ({ text: node.textContent.trim().slice(0, 24), ...box(node) })) };`);
    report.layouts.push({ label: at, today: { small: m.small, scrollers: m.scrollers, outside: m.outside }, backdrop: layer.backdrop, scrollHeight: layer.scroll.scrollHeight, clientHeight: layer.scroll.clientHeight });
    assert.equal(m.missing, undefined, `Today is drawn at ${at}`);
    assert.equal(m.pageOverflow, false, `the page overflows at ${at}`);
    assert.deepEqual(m.small, [], `no text under 12 px in Today at ${at}`);
    assert.deepEqual(m.outside, [], `nothing of Today leaves the window sideways at ${at}`);
    for (const scroller of m.scrollers) { assert.equal(scroller.gutter, 0, `${scroller.name} reserves ${scroller.gutter}px for a bar at ${at}`); assert.equal(scroller.sideways, false, `${scroller.name} scrolls sideways at ${at}`); assert.equal(scroller.scrollbarWidth, "none", `${scroller.name} shows a native bar at ${at}`); }
    // The page sits inside the layer, which sits on the window: the node tree shows behind and around it.
    assert.ok(layer.page.w > 300 && layer.page.h > 150, `Today has a size at ${at}: ${JSON.stringify(layer.page)}`);
    assert.ok(Math.abs(layer.sky.w - layer.layer.w) < 2 && Math.abs(layer.sky.h - layer.layer.h) < 2 && layer.backdrop.skyVisible, `the sky fills the layer at ${at}`);
    assert.ok(layer.backdrop.layerAlpha < 0.9, `the layer is a veil, not a wall, at ${at}: alpha ${layer.backdrop.layerAlpha}`);
    if (layer.backdrop.idle && !layer.backdrop.idle.hidden) assert.ok(layer.backdrop.idle.w > 100 && layer.backdrop.idle.h > 100, `the node tree has a size at ${at}`);
    assert.ok(layer.compose.w > 200 && layer.compose.h > 40, `the box has a size at ${at}`);
    assert.ok(layer.hero.w > 100 && layer.hero.h > 20, `the greeting has a size at ${at}`);
    assert.match(layer.words.kicker, /^(Up late|Good (morning|afternoon|evening))/, `the greeting says something at ${at}: ${JSON.stringify(layer.words)}`);
    assert.ok(layer.compose.r <= layer.layer.r + 1 && layer.compose.x >= layer.layer.x - 1, `the box fits the width at ${at}`);
    for (const card of layer.cards) {
      assert.ok(card.w > 100 && card.h > 20, `${card.key} has a size at ${at}`);
      assert.ok(card.x >= layer.layer.x - 1 && card.r <= layer.layer.r + 1, `${card.key} is inside the window at ${at}`);
      assert.ok(card.title.w > 40 && card.title.h > 10, `the title of ${card.key} is drawn at ${at}`);
    }
    for (const [index, a] of layer.groups.entries()) for (const b of layer.groups.slice(index + 1)) assert.ok(a.r <= b.x + 1 || b.r <= a.x + 1 || a.b <= b.y + 1 || b.b <= a.y + 1, `the groups ${a.group} and ${b.group} overlap at ${at}`);
    // What does not fit on the screen is reached by scrolling the page, never sideways.
    await run("document.getElementById('today-scroll').scrollTop = 0;");
    return { m, layer };
  };
  const sizes = [[1920, 1080, 1], [1440, 900, 1], [1100, 720, 1], [600, 560, 1], [600, 560, 1.5]];
  for (const [width, height, zoom] of sizes) {
    window.setContentSize(width, height); contents.setZoomFactor(zoom); await sleep(400);
    const label = `${width}x${height}`;
    const { layer } = await view(label, zoom);
    if (width >= 1100) {
      assert.ok(layer.compose.y >= 0 && layer.compose.b <= layer.layer.b, `the box is on screen without scrolling at ${label}@${zoom}`);
      assert.ok(layer.firstCard.y < layer.layer.b, `the first card starts on screen at ${label}@${zoom}`);
    }
    // A wide window is for the page and the conversation, not empty sides (2026-10-07): the column runs from the layer's left
    // edge to the conversation, docked at the right with the box at the foot of its thread (renderer/vibe.js syncDock).
    if (width === 1920) {
      const wide = await run("const box = (node) => { const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }; const layer = document.getElementById('vibe-layer'); return { dock: layer.dataset.dock || null, layer: box(layer), col: box(document.querySelector('#today-page .today-col')), chat: box(document.getElementById('vibe-chat')), compose: box(document.getElementById('vibe-compose')), boxIn: document.getElementById('vibe-compose').parentNode.id, toggle: getComputedStyle(document.getElementById('vibe-chat-toggle')).display, last: document.getElementById('vibe-last').hidden };");
      report.wide = wide;
      assert.equal(wide.dock, "chat", `a wide Home docks the conversation: ${JSON.stringify(wide)}`);
      assert.equal(wide.boxIn, "today-chat-box", "with the box at the foot of its thread");
      assert.ok(wide.col.x - wide.layer.x < 60 && wide.col.r <= wide.chat.x - 8 && wide.layer.r - wide.chat.r < 40, `the page, then the conversation, edge to edge: ${JSON.stringify(wide)}`);
      assert.ok(wide.compose.x >= wide.chat.x && wide.compose.r <= wide.chat.r && wide.compose.b <= wide.chat.b, `the box sits inside the conversation: ${JSON.stringify(wide)}`);
      assert.equal(wide.toggle, "none", "its own close button stands for the toggle while it is docked");
      assert.equal(wide.last, true, "and Mefi's last line under the box has nothing to add while the thread shows");
    }
    await capture(`today-${label}@${zoom}.png`);

    // The Inbox popover under the pill, then from the status-bar item, then as a page.
    await click("#shell-need");
    await until("!document.getElementById('today-inbox').hidden && document.querySelectorAll('#today-inbox .today-need').length === 7", `the Inbox opens at ${label}@${zoom}`);
    await sleep(150);
    const popover = await measure("#today-inbox");
    const placed = await run(`const node = document.getElementById('today-inbox'), pill = document.getElementById('shell-need'); const b = node.getBoundingClientRect(), p = pill.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, pill: { x: p.left, r: p.right, b: p.bottom }, expanded: pill.getAttribute('aria-expanded'), focusIn: node.contains(document.activeElement), side: node.dataset.side, open: node.querySelectorAll('.today-need').length };`);
    report.layouts.at(-1).popover = { small: popover.small, scrollers: popover.scrollers, box: placed };
    assert.deepEqual(popover.small, [], `no text under 12 px in the popover at ${label}@${zoom}`);
    assert.equal(popover.pageOverflow, false, `the popover overflows the page at ${label}@${zoom}`);
    assert.deepEqual(popover.outside, [], `nothing of the popover leaves the window at ${label}@${zoom}`);
    for (const scroller of popover.scrollers) { assert.equal(scroller.gutter, 0, `${scroller.name} reserves ${scroller.gutter}px at ${label}@${zoom}`); assert.equal(scroller.sideways, false, `${scroller.name} scrolls sideways at ${label}@${zoom}`); assert.equal(scroller.scrollbarWidth, "none"); }
    assert.ok(placed.x >= 0 && placed.r <= popover.inner.w + 1 && placed.y >= 0 && placed.b <= popover.inner.h + 1, `the popover is inside the window at ${label}@${zoom}: ${JSON.stringify(placed)}`);
    assert.equal(placed.side, "below", "it hangs under its pill");
    assert.ok(Math.abs(placed.y - (placed.pill.b + 8)) <= 1, `eight pixels under the pill at ${label}@${zoom}: ${placed.y} vs ${placed.pill.b}`);
    assert.equal(placed.expanded, "true");
    assert.equal(placed.focusIn, true, "the keyboard is inside it");
    await capture(`inbox-${label}@${zoom}.png`);
    await run("document.getElementById('today-inbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
    await until("document.getElementById('today-inbox').hidden", `Esc closes the Inbox at ${label}@${zoom}`);
    assert.equal(await run("return document.activeElement === document.getElementById('shell-need');"), true, "and the keyboard goes back to the pill");
    // From the status bar it opens upward.
    await click(".shell-waiting");
    await until("!document.getElementById('today-inbox').hidden", `the Inbox opens from the status item at ${label}@${zoom}`);
    await sleep(120);
    const up = await run(`const node = document.getElementById('today-inbox'), item = document.querySelector('.shell-waiting'); const b = node.getBoundingClientRect(), s = item.getBoundingClientRect(); return { y: b.top, b: b.bottom, r: b.right, x: b.left, statusTop: s.top, side: node.dataset.side };`);
    assert.equal(up.side, "above", `a pill at the bottom opens it upward at ${label}@${zoom}`);
    assert.ok(up.y >= 0 && up.b <= up.statusTop + 1 && up.x >= 0, `the popover stays above the status item at ${label}@${zoom}: ${JSON.stringify(up)}`);
    await run("document.getElementById('today-inbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
    await until("document.getElementById('today-inbox').hidden", "closed again");

    await run("window.MefiNav.go('inbox');");
    await until("!document.getElementById('inbox-overlay').hidden && document.querySelectorAll('#inbox-list .today-need').length === 7", `the Inbox page opens at ${label}@${zoom}`);
    await sleep(250);
    const pageM = await measure("#inbox-overlay .inbox-sheet");
    report.layouts.at(-1).inboxPage = { small: pageM.small, scrollers: pageM.scrollers };
    assert.equal(pageM.missing, undefined);
    assert.deepEqual(pageM.small, [], `no text under 12 px on the Inbox page at ${label}@${zoom}`);
    assert.equal(pageM.pageOverflow, false);
    assert.deepEqual(pageM.outside, [], `nothing of the Inbox page leaves the window at ${label}@${zoom} (sheet ${JSON.stringify(pageM.root)}, window ${JSON.stringify(pageM.inner)}) ${pageM.trail.join(" < ")}`);
    for (const scroller of pageM.scrollers) { assert.equal(scroller.gutter, 0, `${scroller.name} reserves ${scroller.gutter}px at ${label}@${zoom}`); assert.equal(scroller.sideways, false, `${scroller.name} scrolls sideways at ${label}@${zoom}`); }
    await capture(`inbox-page-${label}@${zoom}.png`);
    await run("window.MefiNav.close('inbox');");
    await until("document.getElementById('inbox-overlay').hidden", "the Inbox page closes");
    await until("!document.getElementById('vibe-layer').hidden && document.getElementById('vibe-layer').dataset.today === 'on'", "Vibe is back under it");
    // A drawer (the conversation) moves Today over from 1400 px instead of covering the board, as it does Vibe's own stage; under 1400 it lies over it, as in v1.
    // From a layer 1440 px wide it is docked instead (1920 below).
    if (width === 1440) {
      await click("#vibe-chat-toggle");
      await until("!document.getElementById('vibe-chat').hidden", `the conversation drawer opens over Today at ${label}`);
      await sleep(500);
      const drawer = await run("const chat = document.getElementById('vibe-chat'), col = document.querySelector('#today-page .today-col'); const c = chat.getBoundingClientRect(), k = col.getBoundingClientRect(); return { inner: innerWidth, chatLeft: c.left, colRight: k.right, colLeft: k.left };");
      assert.ok(drawer.colRight <= drawer.chatLeft - 8 && drawer.colLeft >= 0, `the board moves over for the drawer at ${label}: ${JSON.stringify(drawer)}`);
      await capture(`today-drawer-${label}.png`);
      await click("#vibe-chat-toggle");
      await until("document.getElementById('vibe-chat').hidden", "and closes");
      await sleep(400);
      assert.ok(await run(`return document.querySelector('#today-page .today-col').getBoundingClientRect().right > ${drawer.colRight} + 40;`), `the board takes its room back when the drawer closes at ${label}`);
      report.drawer = { ...(report.drawer || {}), [label]: drawer };
    }
    // Docked, its close button puts the conversation away (and the box back on the page, the page taking the room), and the
    // toggle docks it again.
    if (width === 1920) {
      const docked = await run("const c = document.getElementById('vibe-chat').getBoundingClientRect(), k = document.querySelector('#today-page .today-col').getBoundingClientRect(); return { chatLeft: c.left, colRight: k.right };");
      await click("#vibe-chat-close");
      await until("document.getElementById('vibe-chat').hidden && !document.getElementById('vibe-layer').dataset.dock", `its close button puts the docked conversation away at ${label}`);
      await sleep(400);
      const away = await run("const k = document.querySelector('#today-page .today-col').getBoundingClientRect(); return { colRight: k.right, boxIn: document.getElementById('vibe-compose').parentNode.className, toggle: getComputedStyle(document.getElementById('vibe-chat-toggle')).display };");
      assert.ok(away.colRight > docked.colRight + 200, `the page takes the room back at ${label}: ${JSON.stringify({ docked, away })}`);
      assert.equal(away.boxIn, "today-box", "and the box is the page's again");
      assert.notEqual(away.toggle, "none", "the toggle is back in the top bar");
      await click("#vibe-chat-toggle");
      await until("document.getElementById('vibe-layer').dataset.dock === 'chat' && !document.getElementById('vibe-chat').hidden && document.getElementById('vibe-compose').parentNode.id === 'today-chat-box'", `the toggle docks it again at ${label}`);
      await sleep(400);
      report.dock = { docked, away };
    }
  }
  check("a drawer moves Today over from 1400 px; a wide Home docks the conversation with its box, and its close button gives the room back");
  check("five sizes: Today, the popover (under the pill and upward from the status bar) and the Inbox page");

  // ---- detail follows html[data-detail] even when only the attribute changes (a preview on the Size and density page sends no event) ----
  window.setContentSize(1440, 900); contents.setZoomFactor(1); await sleep(300);
  const cardFacts = () => run("const card = document.querySelector('#today-board [data-key=\"run:t_run\"]'); return { meta: Boolean(card.querySelector('.today-card-meta')), bar: Boolean(card.querySelector('.today-bar')), more: card.querySelectorAll('.today-card-more').length, quick: Boolean(document.querySelector('#today-board .today-card-quick')) };");
  await run("document.documentElement.dataset.detail = 'titles';");
  await until("!document.querySelector('#today-board [data-key=\"run:t_run\"] .today-card-meta')", "titles: a title and nothing else, from the attribute alone");
  assert.deepEqual(await cardFacts(), { meta: false, bar: false, more: 0, quick: false });
  await run("document.documentElement.dataset.detail = 'status';");
  await until("document.querySelector('#today-board [data-key=\"run:t_run\"] .today-card-meta')", "status: the line under the title");
  await run("document.documentElement.dataset.detail = 'all';");
  await until("document.querySelectorAll('#today-board [data-key=\"done:t_done2\"] .today-card-more').length === 1", "everything: what the checker said");
  await run("delete document.documentElement.dataset.detail;");
  await until("document.querySelectorAll('#today-board [data-key=\"done:t_done2\"] .today-card-more').length === 0", "no value reads as the default (status)");
  check("detail follows html[data-detail] from the attribute alone");

  // ---- Build: the same board as a page ------------------------------------------------------------------------
  window.setContentSize(1440, 900); contents.setZoomFactor(1); await sleep(400);
  await run("await window.MefiVibe.setMode('build');");
  await sleep(500);
  assert.equal(await run("return window.MefiNav.get('today').hidden();"), false, "in Build Today is listed");
  await run("window.MefiNav.go('today');");
  await until("!document.getElementById('today-overlay').hidden && document.querySelector('#today-overlay-board .today-card')", "the Build host draws Today");
  await sleep(300);
  const buildM = await measure("#today-overlay .today-sheet");
  assert.deepEqual(buildM.small, [], "no text under 12 px on the Build host");
  assert.equal(buildM.pageOverflow, false);
  for (const scroller of buildM.scrollers) assert.equal(scroller.gutter, 0, `${scroller.name} reserves width`);
  assert.equal(await text("#today-overlay-summary .is-need .today-chip-text"), "7 need you");
  await capture("today-build-1440x900.png");
  await click("#today-overlay-summary .is-need");
  await until("!document.getElementById('today-inbox').hidden", "in Build the pill's popover opens from the page too");
  await run("document.getElementById('today-inbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
  await run("window.MefiNav.close('today');");
  await until("document.getElementById('today-overlay').hidden", "the Build host closes");
  assert.equal(await run("return document.getElementById('vibe-layer').dataset.today === 'on' && !document.getElementById('vibe-layer').hidden;"), false, "Vibe's Today does not draw in Build");
  await click("#shell-need");
  await until("!document.getElementById('today-inbox').hidden", "in Build the Inbox opens as a popover");
  await capture("inbox-build-1440x900.png");
  await run("document.getElementById('today-inbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
  check("Build: Today is a page, the Inbox a popover");
  await run("await window.MefiVibe.setMode('vibe'); await window.MefiVibe.refresh();");
  await until("document.getElementById('vibe-layer').dataset.today === 'on' && !document.getElementById('vibe-layer').hidden", "Vibe is back");
  await sleep(300);

  // ---- a light palette: every colour is a theme token, so the light ones keep their own (the app's own custom palette, light) ----
  window.setContentSize(1440, 900); contents.setZoomFactor(1); await sleep(300);
  const TEXT = { title: ".today-card-title", meta: ".today-card-meta", group: ".today-group > h3", chip: ".today-chip", button: "#today-board .today-btn:not(.primary)", link: "#today-board .today-link", muted: ".today-latest-row, .today-latest > h3" };
  report.contrast = { dark: await run(`return (${contrastIn.toString()})(${JSON.stringify(TEXT)});`) };
  assert.equal(await run("return window.MefiMusic.applyCustomColors({ accent: '#8A5A00', background: '#F4F0E6', surface: '#FFFFFF', text: '#1D1B17' });"), true);
  await sleep(1800); // the theme's colours glide in; a picture taken sooner shows them half way
  assert.equal(await run("return document.documentElement.dataset.studioThemeTone;"), "light", "the app itself calls this palette light");
  await capture("today-light-1440x900.png");
  report.contrast.light = await run(`return (${contrastIn.toString()})(${JSON.stringify(TEXT)});`);
  for (const tone of ["dark", "light"]) for (const [kind, found] of Object.entries(report.contrast[tone])) if (found) assert.ok(found.ratio >= 3, `${kind} text reads against what is under it in a ${tone} palette: ${JSON.stringify(found)}`);
  const lightSmall = await measure("#today-page");
  assert.deepEqual(lightSmall.small, [], "no text under 12 px in a light palette either");
  await click("#shell-need");
  await until("!document.getElementById('today-inbox').hidden", "the Inbox opens in a light palette");
  await sleep(600);
  await capture("inbox-light-1440x900.png");
  await run("document.getElementById('today-inbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
  await until("document.getElementById('today-inbox').hidden", "closed again");
  await run("window.MefiMusic.applyTheme('chrome', false);");
  await sleep(600);
  check("a light palette: the page and the popover read, with no text under 12 px");

  // ---- acting, the way a person does (1440x900) -----------------------------------------------------------------
  await run("window.todayFixture.clear();");
  // A question answered on its own card.
  assert.deepEqual(await run(`return [...document.querySelectorAll(${JSON.stringify(`${cardOf("need:question:q_decision")} .today-card-quick button`)})].map((node) => node.textContent);`), ["Yes, ignore case", "Keep them separate", "More"], "the two answers that stand alone, and More");
  assert.equal(await press(`${cardOf("need:question:q_decision")} .today-card-quick button`, "Yes, ignore case"), true);
  await until(`document.querySelector(${JSON.stringify(cardOf("need:question:q_decision"))})?.classList.contains('is-decided')`, "the card turns into its Decided line");
  assert.deepEqual(await calls("assistantAnswer"), [{ id: "q_decision", optionId: "yes", projectId: "today-project" }]);
  await until("window.MefiToday.count() === 6", "the count drops at once");
  assert.equal(await pillCount(), "6 need you", "and the pill hears it");
  assert.match(await text(cardOf("need:question:q_decision")), /^Decided · Answered: Yes, ignore case/);
  await capture("today-decided-1440x900.png");
  await until("!document.querySelector(" + JSON.stringify(cardOf("need:question:q_decision")) + ")", "the Decided line leaves by itself");
  assert.equal(await run("return window.MefiToday.count();"), 6, "and the question is gone for good");
  check("answering on a card: one host call, a Decided line, the count follows");

  // The Inbox popover: a free answer, Decide later, the keys.
  await click("#shell-need");
  await until("!document.getElementById('today-inbox').hidden && document.querySelectorAll('#today-inbox .today-need').length === 6", "the popover lists what is left");
  assert.deepEqual(await run("return [...document.querySelectorAll('#today-inbox .today-need')].map((card) => card.dataset.key);"), ["question:q_failure", "question:q_permission", "family:t_family", "approval:t_approve", "blocked:t_stuck", "review:t_review"], "the list the app keeps: questions first, the longest waiting first");
  assert.equal(await text(`${popCard("question:q_permission")} .today-need-label`), "Permission");
  assert.deepEqual(await run(`return [...document.querySelectorAll(${JSON.stringify(`${popCard("question:q_permission")} [data-option]`)})].map((node) => node.dataset.option);`), ["deny", "grant", "hold"], "the safe answer first");
  await run("window.todayFixture.clear();");
  // The box for your own words waits behind its link (the owner's choice): the link opens it.
  assert.equal(await run(`return document.querySelector(${JSON.stringify(`${popCard("question:q_failure")} .today-need-free`)}).hidden;`), true, "the box is folded behind its link");
  await run(`document.querySelector(${JSON.stringify(`${popCard("question:q_failure")} .today-own-words`)}).click();`);
  await until(`document.querySelector(${JSON.stringify(`${popCard("question:q_failure")} .today-need-free`)}).hidden === false`, "Answer in my own words opens the box");
  await run(`const input = document.querySelector(${JSON.stringify(`${popCard("question:q_failure")} .today-need-input`)}); input.focus(); input.value = "Try it with the old router first"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));`);
  await until("window.todayFixture.calls().some((call) => call.name === 'assistantAnswer')", "Enter sends a free answer");
  assert.deepEqual(await calls("assistantAnswer"), [{ id: "q_failure", text: "Try it with the old router first", projectId: "today-project", optionId: null }]);
  await until(`document.querySelector(${JSON.stringify(popCard("question:q_failure"))})?.classList.contains('is-decided')`, "a Decided line in the popover");
  await capture("inbox-decided-1440x900.png");
  // Keys: J moves, a number answers with that option, Enter opens the task, Esc gives the keyboard back.
  await run(`window.__sessions = []; window.__realSessions = window.MefiSessions; window.MefiSessions = { active: () => true, open: (...args) => { window.__sessions.push(args); return true; } };`);
  await run("window.todayFixture.clear();");
  await run("document.getElementById('today-inbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));");
  assert.equal(await run("return [...document.querySelectorAll('#today-inbox .today-need')].findIndex((card) => card.classList.contains('is-current'));"), 1, "J moves down one");
  await run("const event = new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }); document.getElementById('today-inbox').dispatchEvent(event); window.__prevented = event.defaultPrevented;");
  assert.equal(await run("return window.__prevented;"), true, "the digit is the popover's: Studio's own '2' stays out of it");
  await until("window.todayFixture.calls().some((call) => call.name === 'assistantAnswer')", "a number answers the current card");
  assert.deepEqual(await calls("assistantAnswer"), [{ id: "q_permission", optionId: "grant", projectId: "today-project" }], "2 is the second option of the current card");
  // Approve with the scope the host gave, a refusal read on the card, a drop that asks twice, and its Undo.
  await run("window.todayFixture.clear();");
  assert.equal(await press(`${popCard("approval:t_approve")} .today-need-options button`, "Approve build"), true);
  await until("window.todayFixture.calls().some((call) => call.name === 'backlogControl')", "Approve reaches the host");
  assert.deepEqual(await calls("backlogControl"), [{ action: "approve", taskId: "t_approve", projectId: "today-project", expectedScope: "scope-approve" }]);
  await until(`document.querySelector(${JSON.stringify(popCard("approval:t_approve"))})?.classList.contains('is-decided')`, "Approved reads as a Decided line");
  assert.equal(await run(`return [...document.querySelectorAll(${JSON.stringify(`${popCard("approval:t_approve")} button`)})].length;`), 0, "an approval has no Undo");
  await run("window.todayFixture.clear(); window.todayFixture.fail('backlogControl', { ok: false, error: 'That brief changed. Open it and read it again.' });");
  assert.equal(await press(`${popCard("family:t_family")} .today-need-options button`, "Start all 2 steps"), true);
  await until(`document.querySelector(${JSON.stringify(`${popCard("family:t_family")} .today-need-note`)})`, "a refusal is said on the card");
  assert.match(await text(`${popCard("family:t_family")} .today-need-note`), /^That brief changed\./);
  assert.equal(await run(`return document.querySelector(${JSON.stringify(`${popCard("family:t_family")} .today-need-note`)}).getAttribute('role');`), "alert");
  assert.equal((await calls("backlogControl")).length, 1, "the refusal stopped the steps at the first");
  await run("window.todayFixture.clear();");
  assert.equal(await press(`${popCard("family:t_family")} .today-need-options button`, "Start all 2 steps"), true);
  await until("window.todayFixture.calls().filter((call) => call.name === 'backlogControl').length === 2", "both steps, in order");
  assert.deepEqual((await calls("backlogControl")).map((call) => call.taskId), ["t_step1", "t_step2"]);
  check("the popover: free answer, keys, approve, a refusal, steps in order");
  await run("window.todayFixture.clear();");
  assert.equal(await press(`${popCard("blocked:t_stuck")} .today-need-options button`, "Drop it"), true);
  assert.deepEqual(await calls("tasksAction"), [], "the first press only asks");
  assert.equal(await press(`${popCard("blocked:t_stuck")} .today-need-options button`, "Drop this task?"), true);
  await until("window.todayFixture.calls().some((call) => call.name === 'tasksAction')", "the second press drops it");
  assert.deepEqual(await calls("tasksAction"), [{ taskId: "t_stuck", projectId: "today-project", action: "drop" }]);
  await until(`[...document.querySelectorAll(${JSON.stringify(`${popCard("blocked:t_stuck")} button`)})].some((node) => node.textContent === 'Undo')`, "a drop offers Undo");
  await run("window.todayFixture.clear();");
  assert.equal(await press(`${popCard("blocked:t_stuck")} button`, "Undo"), true);
  await until("window.todayFixture.calls().some((call) => call.name === 'tasksAction')", "Undo reopens it");
  assert.deepEqual(await calls("tasksAction"), [{ taskId: "t_stuck", projectId: "today-project", action: "status", status: "open" }]);
  await until(`document.querySelector(${JSON.stringify(`${popCard("blocked:t_stuck")} .today-need-options`)})`, "and it is back as a card that waits on you");
  // The result to check.
  await run("window.todayFixture.clear();");
  assert.equal(await press(`${popCard("review:t_review")} .today-need-options button`, "Approve and finish"), true);
  await until("window.todayFixture.calls().some((call) => call.name === 'tasksAction')", "Approve and finish reaches the host");
  assert.deepEqual(await calls("tasksAction"), [{ taskId: "t_review", projectId: "today-project", action: "status", status: "done" }]);
  // What Mefi decided for you, with its Undo.
  assert.match(await text("#today-inbox .today-inbox-foot"), /^Mefi decided · Merged a duplicate cardUndoAll 1$/);
  await run("window.todayFixture.clear();");
  assert.equal(await press("#today-inbox .today-inbox-foot button", "Undo"), true);
  await until("window.todayFixture.calls().some((call) => call.name === 'autonomyUndo')", "Undo of Mefi's own decision");
  assert.deepEqual(await calls("autonomyUndo"), [{ id: "decision-1", projectId: "today-project" }]);
  // Esc, and the keyboard returns to the pill.
  await run("document.getElementById('today-inbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
  await until("document.getElementById('today-inbox').hidden", "Esc closes");
  assert.equal(await run("return document.activeElement === document.getElementById('shell-need');"), true);
  check("the popover: drop twice, Undo, confirm, Mefi's own Undo, Esc returns to the pill");
  // Ctrl J opens it from anywhere and closes it again.
  await run("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true, cancelable: true }));");
  await until("!document.getElementById('today-inbox').hidden", "Ctrl J opens the Inbox");
  await run("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true, cancelable: true }));");
  await until("document.getElementById('today-inbox').hidden", "and closes it");
  // The pill is a toggle: a real press on it while open closes it, and the click that follows does not reopen it.
  await click("#shell-need");
  await until("!document.getElementById('today-inbox').hidden", "open again");
  const point = await run("const r = document.getElementById('shell-need').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };");
  contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point }); contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
  await sleep(300);
  assert.equal(await run("return document.getElementById('today-inbox').hidden;"), true, "a real press on the pill while it is open closes it, and stays closed");
  contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point }); contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
  await until("!document.getElementById('today-inbox').hidden", "the next press opens it");
  // A press elsewhere closes it (the real pointer, on the board behind).
  contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x: 40, y: 500 }); contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: 40, y: 500 });
  await until("document.getElementById('today-inbox').hidden", "a press elsewhere closes it");
  check("Ctrl J and the pill as a toggle, with real pointer presses");

  // ---- the front door's own pieces still work, in their new place -------------------------------------------------
  await run("window.todayFixture.clear();");
  await run("const input = document.getElementById('vibe-input'); input.focus(); input.value = 'Add a dark theme to the settings page'; input.dispatchEvent(new Event('input', { bubbles: true }));");
  assert.equal(await click("#vibe-build"), true);
  await until("window.todayFixture.calls().some((call) => call.name === 'vibeBuild')", "Build it reaches the host through Vibe's own path");
  assert.equal((await calls("vibeBuild"))[0].projectId, "today-project");
  assert.match((await calls("vibeBuild"))[0].title, /^Add a dark theme to the settings page$/);
  assert.equal(await run("return document.getElementById('vibe-input').value;"), "", "and the box empties, as it always did");
  await until("!document.getElementById('vibe-build').disabled", "Build it is ready again");
  assert.equal(await click(".today [data-evolution-action='suggest']"), true);
  await until("document.querySelector('#today-page .vibe-evolution-suggestion')", "Suggest a next step shows its suggestions inside Today");
  const suggestM = await measure("#today-page");
  assert.deepEqual(suggestM.small, [], `no text under 12 px with suggestions open: ${JSON.stringify(suggestM.small)}`);
  assert.deepEqual(suggestM.outside, [], "suggestions stay inside the window");
  await capture("today-suggestions-1440x900.png");
  await click("#today-page .vibe-evolution-clear");
  check("Build it and Suggest a next step work from the moved box");
  // A draft survives Today being hidden and shown again (Vibe's own logic, untouched).
  await run("const input = document.getElementById('vibe-input'); input.value = 'half a thought'; input.dispatchEvent(new Event('input', { bubbles: true }));");
  await run("await window.MefiVibe.setMode('build'); await window.MefiVibe.setMode('vibe');");
  await until("document.getElementById('vibe-layer').dataset.today === 'on' && !document.getElementById('vibe-layer').hidden", "Vibe again");
  assert.equal(await run("return document.getElementById('vibe-input').value;"), "half a thought", "the draft outlives a trip to Build");
  await run("const input = document.getElementById('vibe-input'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));");

  // ---- opening a session, and the notification hand-off -------------------------------------------------------
  await run("delete window.MefiSessions; window.__went = []; window.__go = window.MefiNav.go; window.MefiNav.go = (...args) => { window.__went.push(args); return true; };");
  await click(`${cardOf("run:t_run")} .today-card-open`);
  assert.deepEqual(await run("return window.__went.map((args) => [args[0], args[1].taskId, args[1].projectId, args[1].filter]);"), [["tasks", "t_run", "today-project", "all"]], "a card opens its session through the route when the session panels are not there");
  // In Social a task's details are Studio's (renderer/social.js): the mode switches first, under the page.
  assert.equal(await run("return window.MefiVibe.mode();"), "build", "a task opened from Social opens in Studio");
  await run("window.MefiNav.go = window.__go; await window.MefiVibe.setMode('vibe'); window.MefiNav.go = (...args) => { window.__went.push(args); return true; };");
  await until("document.getElementById('vibe-layer').dataset.today === 'on' && !document.getElementById('vibe-layer').hidden", "back in Social");
  await run("window.__went.length = 0; window.__sessions.length = 0; window.MefiSessions = { active: () => true, open: (...args) => { window.__sessions.push(args); return true; } };");
  await click(`${cardOf("done:t_done1")} .today-card-open`);
  assert.deepEqual(await run("return window.__sessions;"), [["t_done1", { preview: true }]], "in its thread when the session panels are there");
  assert.deepEqual(await run("return window.__went;"), [], "and the router is not asked");
  await run("window.__sessions.length = 0;");
  assert.equal(await run("return window.MefiToday.openFromAlert({ kind: 'need', id: 'a', taskId: 't_run', projectId: 'today-project', count: 3 });"), true);
  await until("!document.getElementById('today-inbox').hidden", "a burst of notifications lands on the Inbox");
  assert.deepEqual(await run("return window.__sessions;"), []);
  await run("document.getElementById('today-inbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
  assert.equal(await run("return window.MefiToday.openFromAlert({ kind: 'fail', id: 't_next', taskId: 't_next', projectId: 'today-project' });"), true);
  assert.deepEqual(await run("return window.__sessions;"), [["t_next", { preview: true }]], "one notification lands on its task");
  assert.equal(await run("return window.MefiToday.openFromAlert({ kind: 'test' });"), false, "the test notification is alerts.js's own");
  await run("window.MefiNav.go = window.__go; window.MefiSessions = window.__realSessions;");
  await run("await window.MefiVibe.setMode('vibe');");
  await until("document.getElementById('vibe-layer').dataset.today === 'on' && !document.getElementById('vibe-layer').hidden", "Social again");
  check("cards open their sessions in Studio; a notification lands on the task, or the Inbox when it told several");

  // ---- a reload resumes in Vibe with Today up, and a push repaints without rebuilding ---------------------------
  await run("window.__kept = document.querySelector('#today-board [data-key=\"run:t_run\"]'); window.__keptNext = document.querySelector('#today-board [data-key=\"next:t_next\"]');");
  await run("window.todayFixture.clear();");
  await run("await window.MefiVibe.refresh();");
  await sleep(300);
  assert.equal(await run("return document.querySelector('#today-board [data-key=\"run:t_run\"]') === window.__kept && document.querySelector('#today-board [data-key=\"next:t_next\"]') === window.__keptNext;"), true, "a read that changes nothing rebuilds nothing");

  // ---- the keyboard: real Tab presses walk the page in the order it reads, and every stop of Today's own shows a ring -------------------
  // The window is shown for this (a hidden page has no focus, so no :focus-visible and no ring), which the window system then holds to the screen's size: it is the last thing done in this window.
  // A click on the empty page gives the window the keyboard (an unfocused page matches no :focus-visible, so no ring could show).
  window.show(); window.focus(); contents.focus();
  await sleep(300);
  contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x: 40, y: 500 }); contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: 40, y: 500 });
  await sleep(120);
  report.documentFocus = await run("return document.hasFocus();");
  assert.equal(report.documentFocus, true, "the window has the keyboard, so :focus-visible can match and a ring can show");
  await run("document.activeElement?.blur?.(); document.getElementById('vibe-layer').focus({ preventScroll: true });");
  const stops = [];
  for (let index = 0; index < 60; index += 1) {
    contents.sendInputEvent({ type: "keyDown", keyCode: "Tab" }); contents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    await sleep(40);
    stops.push(await run(`const node = document.activeElement; if (!node || node === document.body) return null; const r = node.getBoundingClientRect(), style = getComputedStyle(node); return { under: Boolean(node.closest('body > main, body > header.page-head')), id: node.id || '', cls: typeof node.className === 'string' ? node.className.split(' ')[0] : '', text: (node.textContent || '').trim().slice(0, 28), x: Math.round(r.left), y: Math.round(r.top), ring: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0, today: Boolean(node.closest('#today-page')), group: node.closest('.today-group')?.dataset.group || '', ours: /^today-/.test(typeof node.className === 'string' ? node.className.split(' ')[0] : '') };`));
  }
  report.tabStops = stops.map((stop) => (stop ? `${stop.id || stop.cls}:${stop.text}@${stop.x},${stop.y}` : null));
  // Past the page's last control the order leaves the document for one press (Chromium's wrap) and comes back at the
  // frame's first control. It never lands on the tab pages under the frame's layers: before the frame left them out of
  // the flow while Today is the page, the Model catalog's 28 controls sat in the order there, invisible.
  const outs = stops.flatMap((stop, index) => (stop ? [] : [index]));
  assert.ok(outs.every((index) => index === stops.length - 1 || stops[index + 1]?.id === "shell-list-toggle"), `focus leaves the page only where the order wraps, back to the frame's first control: ${JSON.stringify(report.tabStops)}`);
  assert.ok(stops.every((stop) => !stop?.under), `no stop lands on a page under the frame's layers: ${JSON.stringify(stops.filter((stop) => stop?.under))}`);
  const at = (match) => stops.findIndex((stop) => stop && match(stop));
  const order = [at((stop) => stop.id === "vibe-project"), at((stop) => stop.id === "vibe-new-app"), at((stop) => stop.id === "vibe-chat-toggle"), at((stop) => stop.cls === "today-chip"), at((stop) => stop.id === "vibe-input"), at((stop) => stop.id === "vibe-talk"), at((stop) => stop.cls === "social-link"), at((stop) => stop.cls === "today-card-open")];
  assert.ok(order.every((found) => found >= 0), `every stop is reached by Tab: ${JSON.stringify(order)} in ${JSON.stringify(report.tabStops)}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in the order the page reads: project, the summary, the box and Send, Your work's links, the list");
  // Social's box has one action (a QA pass on 2026-10-06): Build it is a key there (Ctrl Enter) and the starting points are Studio's.
  assert.equal(at((stop) => stop.id === "vibe-build"), -1, "Build it is not a stop in Social");
  assert.equal(at((stop) => stop.cls === "vibe-evolution-intent"), -1, "nor are the starting points");
  const firstCards = stops.filter((stop) => stop && (stop.cls === "today-card-open" || stop.cls === "today-btn" || stop.cls === "today-link" || stop.cls === "today-chip" || stop.cls === "social-link"));
  assert.ok(firstCards.length >= 4, "the board's own controls are in the tab order");
  assert.ok(firstCards.every((stop) => stop.ring), `a focus ring on every stop of Today's own: ${JSON.stringify(firstCards.filter((stop) => !stop.ring))}`);
  // Down the list the order follows the groups: the first card of Needs you comes before the first of Running.
  const needsAt = at((stop) => stop.group === "needs"), runningAt = at((stop) => stop.group === "running");
  assert.ok(needsAt >= 0 && (runningAt < 0 || needsAt < runningAt), "Needs you is walked before Running");
  await run("document.activeElement?.blur?.();");
  check("Tab walks Today in reading order with a ring on its own stops");

  assert.deepEqual(report.errors, [], "no console errors");
  report.complete = true;
  finish();
}).catch(finish);
