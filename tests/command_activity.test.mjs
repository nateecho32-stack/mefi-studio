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
function environment({ assistant = {}, full = {}, backlog = null, requests = [], nodes = [], bridge = {} } = {}) {
  const el = Object.fromEntries(["feed", "feedDot", "feedState", "feedNow", "feedMetrics", "feedQueue", "feedQueueCount", "feedAgents", "feedAgentsCount", "feedMenu", "feedDrop", "feedList", "feedMeta", "feedActivity", "feedParallel"].map((key) => [key, new Element()]));
  const state = { active: false, feedDirty: true, assistant, requests, nodes, feed: [], tasks: [], backlog, backlogRevision: 0, backlogReadAt: 0, backlogReadPending: false, feedMenuOpen: false };
  const navigations = [];
  const context = vm.createContext({
    el, state,
    window: { mefiStudio: bridge }, document: { createElement: (tag) => new Element(tag) },
    autopilotJobs: (assistant) => Array.isArray(assistant?.running) ? assistant.running : assistant?.running ? [assistant.running] : [],
    assistantFull: () => full, agentHex: () => "#abc", agoShort: () => "just now", agoLabel: () => "just now",
    chatMode: () => false, paintChatLog() {}, nav: (...args) => navigations.push(args), setFeedMenu() {},
    updateAssistantPill() {}, renderInfo() {},
  });
  vm.runInContext(`${preferenceSource}\n${chatSource}\n${feedSource}\nthis.api = { commandJobDetail, commandQueue, renderFeed, refreshCommandBacklog, commandChatActivity, changeBuildParallel };`, context);
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
  assert.equal(env.el.feedMetrics.children[2].textContent, "5Waiting");
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

test("All concurrent builders have separate current-work cards and actual slot counts", () => {
  const running = Array.from({ length: 3 }, (_, index) => ({ title: `Independent build ${index + 1}`, taskId: `build_${index}`, startedAt: Date.now() - 5000 }));
  const env = environment({ assistant: { parallel: 3, enabled: true, execute: true, running } });
  env.renderFeed();
  assert.equal(env.el.feedNow.children.length, 3);
  for (const job of running) assert.match(env.el.feedNow.textContent, new RegExp(job.title));
  assert.equal(env.el.feedMeta.textContent, "3 of 3 worker slots in use");
});
