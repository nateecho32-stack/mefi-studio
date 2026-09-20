import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const feedSource = source.slice(source.indexOf("  function feedLine("), source.indexOf("  // The composer is a textarea"));
const preferenceSource = source.slice(source.indexOf("  async function autopilotPrefs("), source.indexOf("  // A message must always produce a reply"));
const chatSource = source.slice(source.indexOf("  function commandChatActivity("), source.indexOf("  // The right-side chat log:"));
class Element {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {}; this.attrs = {}; this.hidden = false; this.classList = { add() {} }; }
  set textContent(text) { this.text = String(text); this.children = []; }
  get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  closest() { return null; }
  click() { return this.listeners.click?.(); }
}
function environment({ assistant = {}, full = {}, backlog = null, requests = [], nodes = [], bridge = {}, timers = {} } = {}) {
  const el = Object.fromEntries(["feed", "feedDot", "feedState", "feedNow", "feedMetrics", "feedAttention", "feedQueue", "feedQueueCount", "feedAgents", "feedAgentsCount", "feedMenu", "feedDrop", "feedList", "feedMeta", "feedActivity", "feedParallel", "feedBuildMode"].map((key) => [key, new Element()]));
  const state = { active: false, feedDirty: true, assistant, requests, nodes, feed: [], tasks: [], backlog, backlogRevision: 0, backlogReadAt: 0, backlogReadPending: false, feedMenuOpen: false };
  const navigations = [];
  const context = vm.createContext({
    el, state,
    window: { mefiStudio: bridge }, document: { createElement: (tag) => new Element(tag) },
    autopilotJobs: (assistant) => Array.isArray(assistant?.running) ? assistant.running : assistant?.running ? [assistant.running] : [],
    assistantFull: () => full, agentHex: () => "#abc", agoShort: () => "just now", agoLabel: () => "just now",
    chatMode: () => false, paintChatLog() {}, nav: (...args) => navigations.push(args), setFeedMenu() {},
    updateAssistantPill() {}, renderInfo() {},
    setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout,
  });
  vm.runInContext(`${preferenceSource}\n${chatSource}\n${feedSource}\nthis.api = { commandJobDetail, commandQueue, renderFeed, refreshCommandBacklog, commandChatActivity, changeBuildParallel, changeBuildMode };`, context);
  return { ...context.api, state, el, navigations };
}
const descendants = (element) => [element, ...element.children.flatMap(descendants)];
const byClass = (element, name) => descendants(element).find((item) => item.className?.split(" ").includes(name));
const flush = async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve(); };

test("Command current work uses the matching live step and never invents progress", () => {
  const env = environment();
  const nodes = [{ kind: "todo", sessionId: "other", status: "in_progress", label: "Wrong session" }, { kind: "todo", sessionId: "here", status: "in_progress", label: "Checking the menu layout" }];
  const detail = env.commandJobDetail({ title: "Improve menu", sessionId: "here", startedAt: Date.now() - 92000 }, nodes);
  assert.equal(detail.stage, "Checking the menu layout");
  assert.equal(detail.progress, null);
  assert.match(detail.elapsed, /^1m \d+s elapsed$/);
  assert.equal(env.commandJobDetail({ progress: NaN }).progress, null);
  assert.equal(env.commandJobDetail({ progress: Infinity }).progress, null);
  assert.match(env.commandJobDetail({ progress: 1 }).stage, /finishing the run/);
  assert.match(env.commandJobDetail({}, [{ kind: "todo", status: "in_progress", label: "Unrelated step" }]).stage, /waiting for its next update/);
});

test("Command queue uses scheduler ordering and excludes running or finished fallback requests", () => {
  const env = environment();
  const assistant = { running: [{ title: "Current task" }] };
  const requests = [
    { title: " Current task ", status: "open" }, { title: "Already done", status: "done" },
    { title: "Checking result", status: "verifying" }, { title: "Active elsewhere", status: "running" },
    { title: "Queued request", status: "queued" },
  ];
  assert.deepEqual(Array.from(env.commandQueue(assistant, requests, null), (item) => item.title), ["Queued request"]);
  const snapshot = { next: [{ kind: "task", id: "pinned", title: "Pinned goes first" }, { kind: "task", id: "old", title: "Older second" }] };
  assert.deepEqual(Array.from(env.commandQueue(assistant, requests, snapshot), (item) => item.id), ["pinned", "old"]);
});

test("Command shows the actual job once, continues the queue without duplication, and opens its details", () => {
  const backlog = { counts: { ready: 12, review: 2, blocked: 1, waiting: 3, cooling: 1 }, next: Array.from({ length: 8 }, (_, index) => ({ id: `task_${index}`, kind: "task", title: `Next task ${index}` })) };
  const env = environment({ assistant: { enabled: true, execute: true, running: [{ taskId: "active", title: "Fix the Command menu", progress: .4, startedAt: Date.now() - 5000 }] }, backlog });
  env.renderFeed();
  assert.equal(env.el.feedNow.children.length, 1);
  assert.match(env.el.feedNow.textContent, /Fix the Command menu/);
  assert.match(env.el.feedNow.textContent, /40% of reported steps · verification follows/);
  assert.equal(byClass(env.el.feedNow, "feed-current-progress").value, .4);
  byClass(env.el.feedNow, "feed-current-title").click();
  assert.equal(env.navigations[0][1].taskId, "active");
  assert.equal(env.el.feedQueue.children.length, 3);
  assert.equal(env.el.feedDrop.children.length, 6, "five remaining entries plus a board link");
  assert.equal(env.el.feedDrop.hidden, true);
  assert.ok(!env.el.feedQueue.textContent.includes("Fix the Command menu"));
  assert.ok(!env.el.feedDrop.textContent.includes("Next task 0"));
  assert.equal(env.el.feedQueueCount.textContent, "12");
  assert.equal(env.el.feedMetrics.children[2].textContent, "4Waiting");
  assert.equal(env.el.feedMetrics.children[3].textContent, "1Needs attention");
  const focusedCurrent = byClass(env.el.feedNow, "feed-current-title");
  const focusedQueue = env.el.feedQueue.children[0].children[1];
  const focusedMetric = env.el.feedMetrics.children[0];
  env.state.feedDirty = true;
  env.renderFeed();
  assert.equal(byClass(env.el.feedNow, "feed-current-title"), focusedCurrent, "live logs do not replace a focused current-task button");
  assert.equal(env.el.feedQueue.children[0].children[1], focusedQueue, "unchanged queue buttons retain focus");
  assert.equal(env.el.feedMetrics.children[0], focusedMetric, "unchanged summary buttons retain focus");
  env.state.feedMenuOpen = true;
  env.state.feedDirty = true;
  env.renderFeed();
  assert.equal(env.el.feedDrop.hidden, false);
  assert.equal(env.el.feedMenu.textContent, "Show less");
});

test("Command preserves a current hold reason instead of presenting old completion history as current work", () => {
  const env = environment({ assistant: { enabled: true, execute: false, history: [{ text: "Old task complete" }] }, backlog: { waiting: "Waiting for credentials", counts: { ready: 1 }, next: [] } });
  env.renderFeed();
  assert.match(env.el.feedNow.textContent, /New work is paused/);
  assert.match(env.el.feedNow.textContent, /Waiting for credentials/);
  assert.ok(!env.el.feedNow.textContent.includes("Old task complete"));
  assert.equal(byClass(env.el.feedNow, "feed-current-progress"), undefined);
});

test("Command readiness reads coalesce, discard project-stale results and recover after failure", async () => {
  let resolve;
  let calls = 0;
  let promise = new Promise((yes) => { resolve = yes; });
  const env = environment({ bridge: { backlogStatus: () => { calls += 1; return promise; } } });
  env.state.active = true;
  const first = env.refreshCommandBacklog();
  await env.refreshCommandBacklog();
  assert.equal(calls, 1);
  env.state.backlogRevision += 1;
  resolve({ ok: true, summary: "Previous project", counts: {}, next: [] });
  await first;
  assert.equal(env.state.backlog, null);
  env.state.backlogReadAt = 0;
  promise = Promise.reject(new Error("Unavailable"));
  await env.refreshCommandBacklog();
  assert.equal(env.state.backlog, null);
  env.state.backlogReadAt = 0;
  promise = Promise.resolve({ ok: true, summary: "Current project", counts: {}, next: [] });
  await env.refreshCommandBacklog();
  await flush();
  assert.equal(env.state.backlog.summary, "Current project");
  assert.equal(calls, 3);
});

test("Command distinguishes service agents from coding builds and states verification without inventing workers", () => {
  const env = environment();
  const summary = env.commandChatActivity({ agents: [{ role: "reference", status: "running", text: "Reading the current files" }, { role: "auditor", status: "running", text: "Checking syntax" }, { role: "keeper", status: "done" }] }, [{ title: "Menu layout" }], { counts: { review: 2 } });
  assert.equal(summary.line, "2 agents · 1 build");
  assert.equal(summary.running, 3);
  assert.match(summary.detail, /reference: Reading the current files/);
  assert.match(summary.detail, /Build: Menu layout/);
  assert.match(summary.detail, /2 finished attempts are awaiting verification/);
  assert.equal(env.commandChatActivity({}, [], { counts: { review: 2 } }).line, "2 awaiting verification");
  assert.equal(env.commandChatActivity({ status: "paused" }, []).line, "Paused");
  assert.equal(env.commandChatActivity({ status: "paused" }, [{ title: "Still finishing" }]).line, "1 build");
  assert.equal(env.commandChatActivity({}, [], { waiting: "Waiting for a prerequisite" }).detail, "Waiting for a prerequisite");
});

test("Parallel build selection saves capacity only, serializes clicks and preserves pause", async () => {
  let resolve;
  const calls = [];
  const answer = new Promise((yes) => { resolve = yes; });
  const env = environment({ assistant: { parallel: 2, execute: false, enabled: false }, bridge: { assistantAutopilot: (patch) => { calls.push(patch); return answer; } } });
  env.renderFeed();
  assert.equal(env.el.feedParallel.value, "2");
  env.el.feedParallel.value = "3";
  const saving = env.changeBuildParallel("3");
  assert.equal(env.el.feedParallel.disabled, true);
  assert.equal(env.el.feedParallel.attrs["aria-busy"], "true");
  assert.equal(await env.changeBuildParallel("1"), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]), ["parallel"]);
  assert.equal(calls[0].parallel, 3);
  resolve({ parallel: 3, execute: false, enabled: false });
  assert.equal(await saving, true);
  assert.equal(env.el.feedParallel.disabled, false);
  assert.equal(env.el.feedParallel.value, "3");
  assert.equal(env.state.assistant.execute, false);
  assert.equal(env.state.assistant.enabled, false);
});

test("Parallel build errors restore the authoritative value and reject out-of-range input", async () => {
  let calls = 0;
  const env = environment({ assistant: { parallel: 2 }, bridge: { assistantAutopilot: async () => { calls += 1; throw new Error("Connection interrupted"); } } });
  env.renderFeed();
  env.el.feedParallel.value = "3";
  assert.equal(await env.changeBuildParallel("3"), false);
  assert.equal(env.el.feedParallel.value, "2");
  assert.equal(env.el.feedParallel.disabled, false);
  for (const value of ["0", "4", "2.5", "invalid"]) assert.equal(await env.changeBuildParallel(value), false);
  assert.equal(calls, 1);
});

test("Build mode saves only approval preference, serializes input and keeps scheduling paused", async () => {
  const calls = []; let finish;
  const result = new Promise((resolve) => { finish = resolve; });
  const env = environment({ assistant: { autoBuild: true, enabled: false, execute: false }, bridge: { assistantAutopilot: (patch) => { calls.push(patch); return result; } } });
  env.renderFeed();
  assert.equal(env.el.feedBuildMode.value, "auto");
  env.el.feedBuildMode.value = "verify";
  const saving = env.changeBuildMode("verify");
  assert.equal(env.el.feedBuildMode.disabled, true);
  assert.equal(env.el.feedBuildMode.attrs["aria-busy"], "true");
  assert.equal(await env.changeBuildMode("auto"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ autoBuild: false }]);
  finish({ autoBuild: false, enabled: false, execute: false });
  assert.equal(await saving, true);
  assert.equal(env.el.feedBuildMode.value, "verify");
  assert.equal(env.el.feedBuildMode.disabled, false);
  assert.equal(env.state.assistant.execute, false);
  assert.equal(env.state.assistant.enabled, false);
});

test("Failed mode saves restore the saved choice; Verify first never guesses pending requests are ready", async () => {
  let calls = 0;
  const env = environment({ assistant: { autoBuild: false }, bridge: { assistantAutopilot: async () => { calls += 1; throw new Error("Connection interrupted"); } } });
  env.renderFeed();
  env.el.feedBuildMode.value = "auto";
  assert.equal(await env.changeBuildMode("auto"), false);
  assert.equal(env.el.feedBuildMode.value, "verify");
  assert.equal(env.el.feedBuildMode.disabled, false);
  assert.equal(await env.changeBuildMode("unknown"), false);
  assert.equal(calls, 1);
  assert.equal(env.commandQueue({ autoBuild: false }, [{ id: "unapproved", status: "open", title: "Needs review" }], null).length, 0);
});

test("a lost build-mode acknowledgement recovers the actual saved mode through a read-only status request", async () => {
  let reads = 0;
  const env = environment({ assistant: { autoBuild: true, execute: false }, bridge: {
    assistantAutopilot: async () => { throw new Error("Acknowledgement lost"); },
    assistantStatus: async () => { reads += 1; return { ok: true, status: { autoBuild: false, execute: false } }; },
  } });
  assert.equal(await env.changeBuildMode("verify"), false);
  assert.equal(reads, 1);
  assert.equal(env.el.feedBuildMode.value, "verify");
  assert.equal(env.el.feedBuildMode.disabled, false);
  assert.equal(env.state.assistant.execute, false);
});

test("a failed mode recovery cannot overwrite a newer pushed status", async () => {
  let finishStatus;
  const lateStatus = new Promise((resolve) => { finishStatus = resolve; });
  const env = environment({ assistant: { autoBuild: true }, bridge: {
    assistantAutopilot: async () => ({ ok: false, error: "Write interrupted" }),
    assistantStatus: () => lateStatus,
  } });
  const saving = env.changeBuildMode("verify"); await flush();
  env.state.assistant = { autoBuild: false, execute: false };
  finishStatus({ ok: true, status: { autoBuild: true, execute: true } });
  assert.equal(await saving, false);
  assert.equal(env.el.feedBuildMode.value, "verify");
  assert.equal(env.state.assistant.execute, false);
});

test("Command exposes held builds under Needs attention and opens the approval brief", () => {
  const approval = [{ id: "needs-approval", kind: "task", stage: "approval", title: "Review export scope", reason: "Review and approve this brief before building." }];
  const env = environment({ assistant: { autoBuild: false }, backlog: { counts: { ready: 0, blocked: 1, approval: 1 }, approval, blocked: [{ kind: "task", id: "broken", title: "Missing prerequisite", reason: "Prerequisite is missing." }], next: [] } });
  env.renderFeed();
  assert.equal(env.el.feedMetrics.children[3].textContent, "2Needs attention");
  assert.match(env.el.feedAttention.textContent, /Review export scope.*Review and approve this brief/);
  assert.doesNotMatch(env.el.feedQueue.textContent, /Review export scope/);
  byClass(env.el.feedAttention, "feed-attention-title").click();
  assert.deepEqual(JSON.parse(JSON.stringify(env.navigations.at(-1))), ["tasks", { taskId: "needs-approval", filter: "all" }]);
  descendants(env.el.feedAttention).find((item) => item.attrs["aria-label"] === "Review all tasks needing attention or approval").click();
  assert.equal(env.navigations.at(-1)[1].readiness, "blocked");
});

test("All concurrent builders have separate current-work cards and actual slot counts", () => {
  const running = Array.from({ length: 3 }, (_, index) => ({ title: `Independent build ${index + 1}`, taskId: `build_${index}`, startedAt: Date.now() - 5000 }));
  const env = environment({ assistant: { parallel: 3, enabled: true, execute: true, running } });
  env.renderFeed();
  assert.equal(env.el.feedNow.children.length, 3);
  for (const job of running) assert.match(env.el.feedNow.textContent, new RegExp(job.title));
  assert.equal(env.el.feedMeta.textContent, "3 of 3 worker slots in use");
});

test("Command separates actionable blockers from automatic waits and opens the matching board state", () => {
  const blocked = Array.from({ length: 4 }, (_, index) => ({ id: `blocked_${index}`, kind: "task", title: `Held task ${index}`, reason: index ? "Completion checks failed. Review the result." : "Missing prerequisite: deleted-task" }));
  const env = environment({ backlog: { counts: { ready: 2, review: 1, waiting: 3, cooling: 1, blocked: 4 }, blocked, nextRetryAt: Date.now() + 120000, next: [] } });
  env.renderFeed();
  assert.equal(env.el.feedMetrics.children[2].textContent, "4Waiting");
  assert.equal(env.el.feedMetrics.children[3].textContent, "4Needs attention");
  env.el.feedMetrics.children[3].click();
  assert.deepEqual(JSON.parse(JSON.stringify(env.navigations.at(-1))), ["tasks", { filter: "all", readiness: "blocked" }]);
  assert.match(env.el.feedAttention.textContent, /Missing prerequisite: deleted-task/);
  assert.match(env.el.feedAttention.textContent, /Next automatic retry in 2m/);
  assert.doesNotMatch(env.el.feedAttention.textContent, /Held task 3/);
  byClass(env.el.feedAttention, "feed-attention-title").click();
  assert.equal(env.navigations.at(-1)[1].taskId, "blocked_0");
  descendants(env.el.feedAttention).find((item) => item.attrs["aria-label"] === "Review all blocked tasks").click();
  assert.equal(env.navigations.at(-1)[1].readiness, "blocked");
  const retained = byClass(env.el.feedAttention, "feed-attention-title");
  env.state.feedDirty = true; env.renderFeed();
  assert.equal(byClass(env.el.feedAttention, "feed-attention-title"), retained, "unrelated activity preserves focused recovery links");
});

test("Command explains a failed status read and offers a coalesced read-only refresh", async () => {
  let calls = 0;
  const env = environment({ bridge: { backlogStatus: async () => ++calls === 1 ? { ok: false, error: "Project store is unavailable" } : { ok: true, counts: { ready: 1 }, next: [] } } });
  env.state.active = true;
  await env.refreshCommandBacklog();
  assert.match(env.el.feedAttention.textContent, /Queue status unavailable.*Project store is unavailable/);
  assert.match(env.el.feedQueue.textContent, /Queue status unavailable/);
  const refresh = descendants(env.el.feedAttention).find((item) => item.textContent === "Refresh status");
  await refresh.click();
  assert.equal(calls, 2, "manual retry bypasses the poll cooldown without scheduling work");
  assert.equal(env.el.feedAttention.hidden, true);
  assert.equal(env.el.feedMetrics.children[0].textContent, "1Ready");
});

test("A worker awaiting safe termination remains in use and never reports completed progress", () => {
  const env = environment({ assistant: { parallel: 1, running: [{ taskId: "stuck", title: "Slow worker", progress: 1, startedAt: Date.now() - 80000, stopping: { since: Date.now() - 5000, reason: "No activity before the deadline", error: "Stop command failed; retry scheduled" } }] } });
  env.renderFeed();
  assert.match(env.el.feedNow.textContent, /Stopping safely/);
  assert.match(env.el.feedNow.textContent, /No activity before the deadline/);
  assert.match(env.el.feedNow.textContent, /Stop command failed; retry scheduled/);
  assert.equal(byClass(env.el.feedNow, "feed-current-progress"), undefined);
  assert.equal(env.el.feedMeta.textContent, "1 of 1 worker slots in use");
});

test("an unanswered readiness read releases its gate at the deadline and ignores a late reply after recovery", async () => {
  const callbacks = new Map(); let timerId = 0, calls = 0, resolveLate;
  const delays = [];
  const stuck = new Promise((resolve) => { resolveLate = resolve; });
  const env = environment({ timers: {
    setTimeout: (callback, ms) => { callbacks.set(++timerId, callback); delays.push(ms); return timerId; },
    clearTimeout: (id) => callbacks.delete(id),
  }, bridge: { backlogStatus: () => ++calls === 1 ? stuck : Promise.resolve({ ok: true, summary: "Recovered snapshot", counts: { ready: 2 }, next: [] }) } });
  env.state.active = true;
  const pending = env.refreshCommandBacklog();
  await env.refreshCommandBacklog(true);
  assert.equal(calls, 1, "the in-flight read remains coalesced before its deadline");
  assert.deepEqual(delays, [12000]);
  callbacks.get(1)(); await pending;
  assert.equal(env.state.backlogReadPending, false);
  assert.match(env.el.feedAttention.textContent, /took too long to respond/);
  assert.equal(callbacks.size, 0);
  const refresh = descendants(env.el.feedAttention).find((item) => item.textContent === "Refresh status");
  await refresh.click();
  assert.equal(calls, 2);
  assert.equal(env.state.backlog.summary, "Recovered snapshot");
  assert.equal(env.state.backlogReadPending, false);
  assert.equal(callbacks.size, 0, "successful reads clear their deadline timer");
  resolveLate({ ok: true, summary: "Late obsolete snapshot", counts: { ready: 90 }, next: [] });
  await flush();
  assert.equal(env.state.backlog.summary, "Recovered snapshot");
  assert.equal(env.el.feedMetrics.children[0].textContent, "2Ready");
});
