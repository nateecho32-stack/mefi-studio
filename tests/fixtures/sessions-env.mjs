// A bench for the v2 session panels (renderer/sessions.js): the list, the thread and the inspector, run the way the booklet
// runs them, in a vm context over the shared fake DOM (tests/fixtures/builder-env.mjs). The real renderer/builder.js and
// renderer/tasks.js's usage words are what the panels lean on, so they are loaded for real; everything else the panels meet
// (the shell's regions, the router, the workspace, the review panels, the picture button and the picker, the toasts) is a
// stand-in that records what it was asked, so a test can say exactly what the panels did and what they asked of each.
//
// Nothing here reads the network or the host. It is not a browser: geometry, the cascade and real focus belong to the
// Electron fixture (tests/sessions_render.test.mjs).
import { readFileSync } from "node:fs";
import { runInContext } from "node:vm";
import { createEnv, createPage } from "./builder-env.mjs";

export const NOW = new Date(2026, 6, 15, 14, 30).getTime();
export const at = (daysAgo, hour = 12, minute = 0) => new Date(2026, 6, 15 - daysAgo, hour, minute).getTime();
export const mins = (count) => NOW - count * 60000;
export const clean = (value) => JSON.parse(JSON.stringify(value));
export const task = (id, extra = {}) => ({ id, projectId: "p1", title: `Task ${id}`, prompt: `Do ${id}`, status: "open", createdAt: at(30), updatedAt: at(30), ...extra });
const LABELS = { running: "Working", review: "Checking the result", blocked: "Needs attention", approval: "Needs approval", waiting: "Waiting", done: "Done", ready: "Ready to start" };
export const summary = (stage, more = {}) => ({ stage, label: LABELS[stage] ?? stage, checks: "No completion checks recorded", worker: "No worker running", action: "Ready for a worker", activityAge: "", blocker: "", nextAction: "Start this task when you are ready.", ...more });

const studioUi = readFileSync(new URL("../../renderer/studio-ui.js", import.meta.url), "utf8");
const controls = studioUi.slice(studioUi.indexOf("  function arm("), studioUi.indexOf("  window.MefiUi = Object.assign("));
const tasksSource = readFileSync(new URL("../../renderer/tasks.js", import.meta.url), "utf8");
const usageWords = tasksSource.slice(tasksSource.indexOf("  const durationText = "), tasksSource.indexOf("  function requestTaskUsage("));

export const PICTURE = (n) => `img_${n.toString(16).padStart(24, "a")}`;
export const DATA_URL = (label = "x") => `data:image/png;base64,${Buffer.from(`png:${label}`).toString("base64")}`;

/** The host, as the panels see it. Every call is recorded in `calls` as [name, ...args]; `fail` names calls that answer an error. */
export function bridge(seed = {}) {
  const calls = [];
  const state = {
    attempts: {}, fail: {}, reply: { ok: true, state: { messages: [] } }, pictures: {}, history: { ok: true, entries: [], hasMore: false }, metrics: null, evidence: {}, where: null,
    routing: { ok: true, executorCli: "opencode", executorTier: "auto" }, deleted: [], prefs: { ok: true, prefs: { composerPicker: true } }, read: [], holdPictures: false, held: [], ...seed,
  };
  const reply = (name, value) => async (...args) => { calls.push([name, ...args]); return state.fail[name] ? { ok: false, error: state.fail[name] } : typeof value === "function" ? value(...args) : value; };
  const api = {
    tasksAttempts: async (payload) => { calls.push(["tasksAttempts", payload]); return state.fail.tasksAttempts ? { ok: false, error: state.fail.tasksAttempts } : { ok: true, attempts: state.attempts[payload?.taskId] ?? [] }; },
    tasksSave: reply("tasksSave", { ok: true }), tasksCreate: reply("tasksCreate", { ok: true }), tasksAction: reply("tasksAction", { ok: true }), backlogControl: reply("backlogControl", { ok: true }),
    assistantAnswer: reply("assistantAnswer", { ok: true }),
    assistantMessage: async (...args) => { calls.push(["assistantMessage", ...args]); return state.fail.assistantMessage ? { ok: false, error: state.fail.assistantMessage } : state.reply; },
    assistantImageRead: async (payload) => {
      calls.push(["assistantImageRead", payload]);
      if (state.holdPictures) return new Promise((resolve) => state.held.push(() => resolve(state.pictures[payload.id] ?? { ok: false, error: "That picture is no longer saved." })));
      return state.fail.assistantImageRead ? { ok: false, error: state.fail.assistantImageRead } : state.pictures[payload.id] ?? { ok: false, error: "That picture is no longer saved." };
    },
    assistantImage: reply("assistantImage", { ok: true, off: false }),
    tasksEvidence: async (payload) => { calls.push(["tasksEvidence", payload]); return state.evidence[payload.taskId] ?? { ok: true, shots: [] }; },
    tasksDelete: reply("tasksDelete", (payload) => { state.deleted.push(payload.taskId); return { ok: true, trashed: [{ kind: "task", id: payload.taskId }] }; }),
    tasksUndelete: reply("tasksUndelete", { ok: true }),
    tasksHistory: async (payload) => { calls.push(["tasksHistory", payload]); return state.fail.tasksHistory ? { ok: false, error: state.fail.tasksHistory } : state.history; },
    tasksRestore: reply("tasksRestore", { ok: true }),
    taskMetrics: async (payload) => { calls.push(["taskMetrics", payload]); return state.fail.taskMetrics ? { ok: false, error: state.fail.taskMetrics } : state.metrics ?? { ok: false, error: "No report." }; },
    tasksCap: reply("tasksCap", { ok: true }),
    autonomyUndo: reply("autonomyUndo", { ok: true }),
    prefsGet: async () => { calls.push(["prefsGet"]); return state.prefs; },
    shellReveal: reply("shellReveal", { ok: true }),
    workWhere: async () => { calls.push(["workWhere"]); return state.where ?? { ok: true, projectId: "p1", repo: true, branch: "main", head: "abc1234", dirty: 2, worktrees: { on: false, forced: false } }; },
    getAiRouting: async () => { calls.push(["getAiRouting"]); return state.routing; },
    setAiRouting: reply("setAiRouting", { ok: true }),
    workWorktrees: async (on) => { calls.push(["workWorktrees", on]); return { ok: true, worktrees: { on, forced: false } }; },
    cliStatus: async () => [{ id: "opencode", installed: true }, { id: "claude", installed: true }],
    onTasks(callback) { state.pushes.tasks.push(callback); }, onAssistant(callback) { state.pushes.assistant.push(callback); }, onAssistantStatus(callback) { state.pushes.status.push(callback); },
    onProjects(callback) { state.pushes.projects.push(callback); }, onReviewChanged(callback) { state.pushes.review.push(callback); },
  };
  state.pushes = { tasks: [], assistant: [], status: [], projects: [], review: [] };
  return Object.assign(api, { calls, state, of: (name) => calls.filter((call) => call[0] === name) });
}

/** The shell's regions: a mount is recorded (the panel joins the page, as a region's would) and answers a handle that remembers being shown and hidden. */
export function stubShell({ mount = null, document = null } = {}) {
  const mounts = [];
  const shell = {
    active: () => true,
    region: () => null,
    size: () => 300,
    resize() {},
    mount(region, key, element, options) {
      if (mount) return mount(region, key, element, options, mounts);
      const entry = { region, key, element, options, shown: true, shows: 0, hides: 0, unmounted: false };
      mounts.push(entry);
      document?.body.append(element);
      return { show() { entry.shown = true; entry.shows += 1; }, hide() { entry.shown = false; entry.hides += 1; }, unmount() { entry.unmounted = true; entry.shown = false; element.remove(); } };
    },
  };
  return { shell, mounts, of: (region) => mounts.find((entry) => entry.region === region) };
}

/**
 * Real focus for the fake DOM: every element made after this call moves document.activeElement when it is focused, and gives it up
 * when it is blurred or taken out of the page. Call it before the panels draw what should be tracked.
 */
export function trackFocus(document) {
  const make = document.createElement.bind(document);
  document.createElement = (tag) => {
    const node = make(tag);
    const focus = node.focus.bind(node), blur = node.blur.bind(node), remove = node.remove.bind(node);
    node.focus = (...args) => { document.activeElement = node; return focus(...args); };
    node.blur = (...args) => { if (document.activeElement === node) document.activeElement = null; return blur(...args); };
    node.remove = (...args) => { if (document.activeElement === node) document.activeElement = null; return remove(...args); };
    return node;
  };
  return { active: () => document.activeElement };
}

/** review.js's panels, as far as the inspector is concerned: what was mounted where, for which task, and what it says it holds. */
export function stubReview() {
  const mounts = [], watchers = new Set();
  const counts = new Map();
  const review = {
    mount(host, options) {
      const entry = { host, options, unmounted: false };
      mounts.push(entry);
      return { record: entry, unmount() { entry.unmounted = true; } };
    },
    counts: (taskId, projectId) => counts.get(`${projectId}/${taskId}`) ?? null,
    onChange(callback) { watchers.add(callback); return () => watchers.delete(callback); },
  };
  return { review, mounts, live: () => mounts.filter((entry) => !entry.unmounted), watchers, setCounts(taskId, value, projectId = "p1") { if (value === null) counts.delete(`${projectId}/${taskId}`); else counts.set(`${projectId}/${taskId}`, value); watchers.forEach((callback) => callback({ taskId, projectId })); } };
}

/**
 * builder.js and sessions.js loaded into a v2 page.
 *   layout      "v2" (default) or "v1": what html[data-layout] says
 *   shell       false for a page with no MefiShell
 *   lateShell   true to install the shell after sessions.js ran
 *   focus       true for real focus: document.activeElement follows what was focused (see trackFocus)
 */
export async function sessionsApp({
  tasks = [], ideas = [], questions = [], running = [], messages = [], stages = {}, backlog = null, preview = null, decisions = [], worktrees = null, layout = "v2", shell = true,
  api = bridge(), storage = new Map(), search = "", innerHeight = 1080, detail = null, load = true, status = {}, tabs = true, review = true, pictures = true, picker = true, sessionsOff = false, focus = false,
} = {}) {
  const env = createEnv({ storage, now: NOW, search });
  const { window, document } = env;
  // The page's intervals are the env's list; which of them the page cleared is kept here (env.cleared: the ids, as setInterval handed them out).
  env.cleared = [];
  env.context.clearInterval = (id) => { env.cleared.push(id); };
  // The page's clock is the test's: `clock.t` moves by hand, and `new Date()` and `Date.now()` answer it.
  const clock = { t: NOW };
  env.context.Date = class extends Date { constructor(...args) { if (args.length) super(...args); else super(clock.t); } static now() { return clock.t; } };
  createPage(env);
  if (focus) trackFocus(document);
  window.innerHeight = innerHeight;
  if (layout === "v2") document.documentElement.dataset.layout = "v2";
  if (detail) document.documentElement.dataset.detail = detail;
  if (sessionsOff) storage.set("mefiStudio.sessions", "off");
  const calls = { go: [], toasts: [], refresh: 0, started: [], selected: [], compose: 0, tabsOpened: [], confirms: [], sidebar: [], preview: [], picked: [] };
  const data = { projectId: "p1", project: { id: "p1", name: "Snake trial", path: "/work/snake" }, projects: [{ id: "p1", name: "Snake trial" }], tasks, ideas, assistant: { messages, questions }, status: { running, parallel: 3, ...status }, backlog, preview, mode: "work", pending: false };
  window.MefiVibe = { mode: () => "build", isActive: () => false };
  const nav = { current: "workspace", topOverlay: null };
  window.MefiNav = {
    register() {}, go: (...args) => calls.go.push(args), historyState: () => ({}), taskContext: () => null, selectTask: (value) => calls.selected.push(value), saveResume() {}, back() {}, forward() {},
    current: () => nav.current, top: () => nav.topOverlay,
  };
  window.MefiWorkspace = {
    isActive: () => nav.current === "workspace", snapshot: () => data, setComposerMode() {}, refresh: () => { calls.refresh += 1; }, startTask: (row) => { calls.started.push(row.id); return Promise.resolve(); },
    previewAction: (name) => { calls.preview.push(name); return Promise.resolve(true); }, composeTask: () => { calls.compose += 1; },
  };
  window.MefiTasks = { workflowSummary: (item) => { const said = stages[item.id]; const stage = (said && typeof said === "object" ? said.stage : said) ?? (item.status === "done" ? "done" : item.status === "active" ? "running" : item.status === "awaiting_verification" ? "review" : "ready"); return summary(stage, said && typeof said === "object" ? said : {}); }, shortTitle: (item) => String(item.title || item.prompt || "").slice(0, 60) };
  window.MefiToast = (message, kind, options) => { calls.toasts.push({ message, kind, options }); return { element: null }; };
  window.MefiConfirm = async (message, options) => { calls.confirms.push([message, options]); return window.__confirmWith !== false; };
  window.MefiSidebar = { open: (options) => calls.sidebar.push(options) };
  window.MefiAutonomy = { mount: (host, options) => { host.mounted = options; }, state: () => ({ projectId: "p1", level: "auto", decisions }), label: () => "Auto", refresh() {} };
  window.MefiSelect = { refresh() {} };
  window.MefiWorktrees = worktrees ?? { state: () => ({ list: null }), summary: () => ({ repo: false, tasks: [] }), peek: () => Promise.resolve() };
  if (tabs) window.MefiTabs = { open: (...args) => calls.tabsOpened.push(args) };
  const bench = { shell: stubShell({ document }), review: stubReview() };
  if (shell) window.MefiShell = bench.shell.shell;
  if (review) window.MefiReview = bench.review.review;
  if (pictures) window.MefiComposerPictures = { bind(input, options) { const box = { input, options, images: [], busy: false, cleared: 0, refreshed: 0, row: document.createElement("div") }; box.row.className = "composer-attach"; input.parentNode?.append(box.row); calls.picked.push(box); window.MefiComposerPictures.box = box; return window.MefiComposerPictures.lookup.set(input, { take: () => box.images.map((image) => image.id), clear: () => { box.cleared += 1; box.images = []; }, refresh: () => { box.refreshed += 1; }, isBusy: () => box.busy, count: () => box.images.length, addFiles() {} }).get(input); }, lookup: new Map(), get(input) { return this.lookup.get(input) ?? null; }, box: null };
  if (picker) window.MefiComposerPicker = { bind(input, options) { const box = { input, options, on: true, refreshed: 0 }; window.MefiComposerPicker.box = box; return window.MefiComposerPicker.lookup.set(input, { refresh: () => { box.refreshed += 1; }, setPicker: (on) => { box.on = on; }, close() {}, isOpen: () => false }).get(input); }, lookup: new Map(), get(input) { return this.lookup.get(input) ?? null; }, pickerPreference: (prefs) => prefs?.composerPicker !== false, box: null };
  vm_run(env, `${controls}\nwindow.MefiUi = { arm, plainError };`);
  vm_run(env, `(function () { "use strict"; ${usageWords}\n window.MefiTasks.usage = { durationText, usageTokens, usageCost, countText }; })();`);
  window.mefiStudio = api;
  await env.load("builder.js");
  if (load) await env.load("sessions.js");
  const app = {
    env, window, document, clock, tick: (ms) => { clock.t += ms; }, S: window.MefiSessions, B: window.MefiBuilder, calls, api, data, nav, bench, storage,
    shell: bench.shell.shell, mounts: bench.shell.mounts, reviews: bench.review,
    /** Run the page's queued frames and timers and the promises they wait on, a few rounds. */
    async settle(rounds = 3) { for (let round = 0; round < rounds; round += 1) { env.flush(); for (let turn = 0; turn < 10; turn += 1) await Promise.resolve(); await env.settle(); env.flush(); } },
    /** What the panels drew: the roots the shell was given, by region. */
    panel: (region) => bench.shell.of(region)?.element ?? null,
    list: () => bench.shell.of("list")?.element ?? null,
    thread: () => bench.shell.of("main")?.element ?? null,
    inspector: () => bench.shell.of("inspector")?.element ?? null,
    /** Every node under a region's panel that matches. */
    all: (region, selector) => bench.shell.of(region)?.element?.querySelectorAll(selector) ?? [],
    one: (region, selector) => bench.shell.of(region)?.element?.querySelector(selector) ?? null,
    text: (region, selector) => bench.shell.of(region)?.element?.querySelector(selector)?.textContent ?? null,
    attach: async () => { const ok = window.MefiSessions.attach(); await app.settle(); return ok; },
    rowKeys: () => app.all("list", ".sx-row").map((node) => node.dataset.key),
    row: (id) => app.all("list", ".sx-row").find((node) => node.dataset.key === id) ?? null,
    /** The app navigates: what nav.current() answers, and the event the router dispatches. */
    navigate(id, params = {}) { nav.current = id; env.emit("mefi:nav", { id, action: "open", params }); },
  };
  return app;
}

// A script run in the page's own context (the vm the fake DOM lives in).
const vm_run = (env, code) => runInContext(code, env.context);
