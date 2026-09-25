import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// The shared renderer DOM stand-in, so a template restructure lands in one
// place instead of nineteen private copies. See tests/fixtures/renderer-dom.mjs.
import { Element } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const feedSource = source.slice(source.indexOf("  function feedLine("), source.indexOf("  // The composer is a textarea"));
const preferenceSource = source.slice(source.indexOf("  async function autopilotPrefs("), source.indexOf("  // A message must always produce a reply"));
const chatSource = source.slice(source.indexOf("  function commandChatActivity("), source.indexOf("  // The right-side chat log:"));
function environment({ assistant = {}, full = {}, backlog = null, requests = [], nodes = [], bridge = {}, timers = {} } = {}) {
  const el = Object.fromEntries(["feed", "feedDot", "feedState", "feedNow", "feedMetrics", "feedAttention", "feedQueue", "feedQueueCount", "feedAgents", "feedAgentsCount", "feedAgentsSection", "feedRecentAgents", "feedRecentCount", "feedRecentList", "feedMenu", "feedDrop", "feedList", "feedMeta", "feedActivity", "feedParallel", "feedBuildMode", "feedAgentMode", "feedAgentModeNote"].map((key) => [key, new Element()]));
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
  vm.runInContext(`${preferenceSource}\n${chatSource}\n${feedSource}\nthis.api = { commandJobDetail, commandQueue, renderFeed, refreshCommandBacklog, commandChatActivity, changeBuildParallel, createBuildParallelControl, changeBuildMode, changeAgentMode };`, context);
  return { ...context.api, state, el, document: context.document, navigations };
}
const descendants = (element) => [element, ...element.children.flatMap(descendants)];
const byClass = (element, name) => descendants(element).find((item) => item.className?.split(" ").includes(name));
const flush = async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve(); };

test("Agent mode saves only coordination, serializes changes and preserves paused workers", async () => {
  const calls = []; let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const env = environment({ assistant: { mode: "swarm", enabled: false, execute: false }, bridge: { assistantAutopilot: (patch) => { calls.push(patch); return pending; } } });
  env.renderFeed();
  assert.equal(env.el.feedAgentMode.value, "swarm");
  assert.match(env.el.feedAgentModeNote.textContent, /one builder per ready task/);
  const saving = env.changeAgentMode("cluster");
  assert.equal(env.el.feedAgentMode.disabled, true);
  assert.equal(env.el.feedAgentMode.attrs["aria-busy"], "true");
  assert.equal(await env.changeAgentMode("swarm"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ mode: "cluster" }]);
  finish({ mode: "cluster", enabled: false, execute: false });
  assert.equal(await saving, true);
  assert.equal(env.el.feedAgentMode.value, "cluster");
  assert.equal(env.el.feedAgentMode.disabled, false);
  assert.equal(env.state.assistant.execute, false);
  assert.equal(env.state.assistant.enabled, false);
});

test("Agent mode recovers saved preference after lost acknowledgement and ignores stale recovery", async () => {
  let finishRead;
  const env = environment({ assistant: { mode: "swarm" }, bridge: {
    assistantAutopilot: async () => { throw new Error("Acknowledgement lost"); },
    assistantStatus: async () => ({ ok: true, status: { mode: "cluster" } }),
  } });
  assert.equal(await env.changeAgentMode("cluster"), false);
  assert.equal(env.el.feedAgentMode.value, "cluster");
  assert.equal(await env.changeAgentMode("unrecognized"), false);
  const late = environment({ assistant: { mode: "swarm" }, bridge: {
    assistantAutopilot: async () => ({ ok: false }),
    assistantStatus: () => new Promise((resolve) => { finishRead = resolve; }),
  } });
  const saving = late.changeAgentMode("cluster"); await flush();
  late.state.assistant = { mode: "swarm", execute: false };
  finishRead({ ok: true, status: { mode: "cluster", execute: true } });
  assert.equal(await saving, false);
  assert.equal(late.el.feedAgentMode.value, "swarm");
  assert.equal(late.state.assistant.execute, false);
});

test("Cluster shows actual task preparation, helper failures and the shared focus", () => {
  const env = environment({ assistant: { mode: "cluster", enabled: true, execute: true,
    clusterFocus: { source: "task", id: "focus", title: "Improve search" },
    clusterAgents: [{ id: "planner", role: "planner", status: "running", taskId: "focus", taskTitle: "Improve search", step: "Inspecting entry points" }, { id: "reviewer", role: "reviewer", status: "failed", step: "Provider unavailable" }],
  } });
  env.renderFeed();
  assert.match(env.el.feedAgentModeNote.textContent, /agents focus on: Improve search/);
  assert.equal(env.el.feedState.textContent, "task preparation");
  assert.match(env.el.feedNow.textContent, /Task preparation.*Improve search.*Inspecting entry points/);
  assert.equal(env.el.feedAgentsCount.textContent, "1 need attention");
  assert.match(env.el.feedAgents.textContent, /RUNNINGPlanner.*Inspecting entry points/);
  assert.match(env.el.feedAgents.textContent, /ERRORReviewer.*Provider unavailable/);
  assert.doesNotMatch(env.el.feedNow.textContent, /percent|%/);
  env.state.assistant.clusterAgents = [];
  env.state.assistant.clusterFocus = null;
  env.state.assistant.running = [{ taskId: "a", title: "Current A" }, { taskId: "b", title: "Current B" }];
  env.state.feedDirty = true; env.renderFeed();
  assert.match(env.el.feedAgentModeNote.textContent, /current workers finish/);
  assert.equal(env.el.feedNow.children.length, 2);
});

test("Cluster helper status merges with the service roster without counting the same agent twice", () => {
  const env = environment({ assistant: { mode: "cluster", execute: true, clusterFocus: { title: "Fix export" }, clusterAgents: [{ role: "planner", status: "running", step: "Checking paths" }] },
    full: { agents: [{ role: "cluster-planner", status: "running", text: "Duplicate planner" }, { role: "watcher", status: "running", text: "Checking workspace" }] },
  });
  env.renderFeed();
  assert.equal(env.el.feedAgentsCount.textContent, "2 working");
  assert.equal(env.el.feedAgents.children.length, 2);
  assert.doesNotMatch(env.el.feedAgents.textContent, /Duplicate planner/);
});

test("Swarm presents shared-task preparation and concurrent helper roles without implying a build started", () => {
  const env = environment({ assistant: { mode: "swarm", enabled: true, execute: true, adaptiveParallel: true,
    running: [{ taskId: "one", title: "Shared export task", phase: "preparing" }, { taskId: "two", title: "Shared search task", phase: "building" }],
    clusterAgents: [
      { id: "one-planner", mode: "swarm", role: "planner", status: "running", taskId: "one", taskTitle: "Shared export task", step: "Splitting export work" },
      { id: "two-planner", mode: "swarm", role: "planner", status: "running", taskId: "two", taskTitle: "Shared search task", step: "Planning search checks" },
    ],
  }, full: { agents: [{ role: "cluster-planner", status: "running", text: "Duplicate planner" }] } });
  env.renderFeed();
  assert.equal(env.el.feedState.textContent, "1 building · 1 preparing");
  assert.equal(env.el.feedMeta.textContent, "1 preparing · 1 building · machine managed");
  assert.equal(env.el.feedAgentsCount.textContent, "2 working");
  assert.equal(env.el.feedAgents.children.length, 2);
  assert.match(env.el.feedNow.textContent, /Task preparation.*Shared export task.*Splitting export work/);
  assert.match(env.el.feedAgents.textContent, /Planner.*Shared export task.*Planner.*Shared search task/);
  assert.doesNotMatch(env.el.feedNow.textContent + env.el.feedAgents.textContent, /Cluster|Duplicate planner/);
});

test("a claimed Cluster task remains preparation until the coding process starts", () => {
  const job = { taskId: "focus", title: "Improve search", phase: "preparing", progress: 1 };
  const env = environment({ assistant: { mode: "cluster", enabled: true, execute: true, running: [job],
    clusterFocus: { source: "task", id: "focus", title: "Improve search" },
    clusterAgents: [{ role: "planner", status: "running", taskId: "focus", step: "Inspecting search entry points" }],
  } });
  env.renderFeed();
  assert.equal(env.el.feedState.textContent, "task preparation");
  assert.match(env.el.feedNow.textContent, /Task preparation.*Improve search.*Inspecting search entry points/);
  assert.doesNotMatch(env.el.feedNow.textContent, /Working now|Worker is running|%/);
  assert.equal(env.el.feedMeta.textContent, "1 preparing · 0 building · cluster focus");
  assert.equal(env.commandJobDetail(job).progress, null);
  env.state.assistant.clusterAgents[0].step = "Checking acceptance gaps";
  env.state.feedDirty = true; env.renderFeed();
  assert.match(env.el.feedNow.textContent, /Checking acceptance gaps/);
  job.phase = "building"; job.progress = null;
  env.state.assistant.clusterAgents[0].status = "done";
  env.state.feedDirty = true; env.renderFeed();
  assert.match(env.el.feedNow.textContent, /Worker is running/);
  assert.equal(env.el.feedState.textContent, "running");
  assert.equal(env.el.feedMeta.textContent, "1 building · cluster focus");
});

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
  assert.equal(env.el.feedMetrics.children[3].textContent, "1Attention");
  assert.equal(env.el.feedMetrics.children[3].attrs["aria-label"], "1 task needing attention");
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
  const env = environment({ assistant: { parallel: 2, adaptiveParallel: false, execute: false, enabled: false }, bridge: { assistantAutopilot: (patch) => { calls.push(patch); return answer; } } });
  env.renderFeed();
  assert.equal(env.el.feedParallel.value, "2");
  env.el.feedParallel.value = "3";
  const saving = env.changeBuildParallel("3");
  assert.equal(env.el.feedParallel.disabled, true);
  assert.equal(env.el.feedParallel.attrs["aria-busy"], "true");
  assert.equal(await env.changeBuildParallel("1"), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]), ["adaptiveParallel", "parallel"]);
  assert.equal(calls[0].adaptiveParallel, false);
  assert.equal(calls[0].parallel, 3);
  resolve({ parallel: 3, adaptiveParallel: false, execute: false, enabled: false });
  assert.equal(await saving, true);
  assert.equal(env.el.feedParallel.disabled, false);
  assert.equal(env.el.feedParallel.value, "3");
  assert.equal(env.state.assistant.execute, false);
  assert.equal(env.state.assistant.enabled, false);
});

test("Parallel build errors restore the authoritative value and reject out-of-range input", async () => {
  let calls = 0;
  const env = environment({ assistant: { parallel: 2, adaptiveParallel: false }, bridge: { assistantAutopilot: async () => { calls += 1; throw new Error("Connection interrupted"); } } });
  env.renderFeed();
  env.el.feedParallel.value = "3";
  assert.equal(await env.changeBuildParallel("3"), false);
  assert.equal(env.el.feedParallel.value, "2");
  assert.equal(env.el.feedParallel.disabled, false);
  for (const value of ["0", "4", "2.5", "invalid"]) assert.equal(await env.changeBuildParallel(value), false);
  assert.equal(calls, 1);
});

test("Machine managed is the default and opting into a manual limit updates both capacity controls", async () => {
  const calls = [];
  const env = environment({ assistant: { parallel: 2, execute: false, enabled: false }, bridge: { assistantAutopilot: async (patch) => { calls.push(patch); return { ...env.state.assistant, ...patch }; } } });
  env.renderFeed();
  const detail = env.createBuildParallelControl();
  const picker = detail.children.find((child) => child.tagName === "select");
  assert.equal(env.el.feedParallel.value, "machine", "legacy saved width does not imply manual mode");
  assert.equal(picker.value, "machine");
  assert.equal(picker.children[0].textContent, "Machine managed");
  assert.equal(picker.attrs["aria-label"], "Build scheduling capacity");
  assert.match(picker.title, /while Studio remains responsive/);
  assert.match(picker.title, /staggered to recheck performance/);
  picker.value = "3";
  await picker.trigger("change");
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ adaptiveParallel: false, parallel: 3 }]);
  assert.equal(picker.value, "3");
  assert.equal(env.el.feedParallel.value, "3");
  assert.equal(await env.changeBuildParallel("machine"), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), { adaptiveParallel: true });
  assert.equal(env.state.assistant.parallel, 3, "automatic mode preserves the saved manual cap");
  assert.equal(env.state.assistant.execute, false);
  assert.equal(env.state.assistant.enabled, false);
  assert.equal(picker.value, "machine");
  assert.equal(env.el.feedParallel.value, "machine");
});

test("Machine-managed builders show actual concurrency and machine holds without inventing a slot limit", () => {
  const running = Array.from({ length: 5 }, (_, index) => ({ taskId: `job_${index}`, title: `Independent work ${index}` }));
  const env = environment({ assistant: { parallel: 2, adaptiveParallel: true, execute: true, running, capacity: { canStart: true, reason: null } } });
  env.renderFeed();
  assert.equal(env.el.feedNow.children.length, 5);
  assert.equal(env.el.feedMeta.textContent, "5 building · machine managed");
  env.state.assistant.capacity = { canStart: false, reason: "Studio is responding slowly" };
  env.state.feedDirty = true;
  env.renderFeed();
  assert.equal(env.el.feedMeta.textContent, "5 building · machine managed · Studio is responding slowly");
  assert.doesNotMatch(env.el.feedMeta.textContent, /slots/);
  env.state.assistant.capacity = { canStart: true, reason: null };
  env.state.feedDirty = true;
  env.renderFeed();
  assert.equal(env.el.feedMeta.textContent, "5 building · machine managed");
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
  assert.equal(env.el.feedMetrics.children[3].textContent, "2Attention");
  assert.match(env.el.feedAttention.textContent, /Review export scope.*Review and approve this brief/);
  assert.doesNotMatch(env.el.feedQueue.textContent, /Review export scope/);
  byClass(env.el.feedAttention, "feed-attention-title").click();
  assert.deepEqual(JSON.parse(JSON.stringify(env.navigations.at(-1))), ["tasks", { taskId: "needs-approval", filter: "all" }]);
  descendants(env.el.feedAttention).find((item) => item.attrs["aria-label"] === "Review all tasks needing attention or approval").click();
  assert.equal(env.navigations.at(-1)[1].readiness, "blocked");
});

test("All concurrent builders have separate current-work cards and actual slot counts", () => {
  const running = Array.from({ length: 3 }, (_, index) => ({ title: `Independent build ${index + 1}`, taskId: `build_${index}`, startedAt: Date.now() - 5000 }));
  const env = environment({ assistant: { parallel: 3, adaptiveParallel: false, enabled: true, execute: true, running } });
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
  assert.equal(env.el.feedMetrics.children[3].textContent, "4Attention");
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
  const env = environment({ assistant: { parallel: 1, adaptiveParallel: false, running: [{ taskId: "stuck", title: "Slow worker", progress: 1, startedAt: Date.now() - 80000, stopping: { since: Date.now() - 5000, reason: "No activity before the deadline", error: "Stop command failed; retry scheduled" } }] } });
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

// The feed folds a repeat of the same line, keeps different lines apart, and
// folds a streaming worker transcript into one live row so a single run cannot
// push the run-history rows out of the 40.
test("feed rows fold repeats and a worker transcript but keep distinct lines", () => {
  const text = source.replace(/\r\n/g, "\n");
  const from = text.indexOf("  const transcriptRow = ");
  const to = text.indexOf("  function feedLine(item) {", from);
  assert.ok(from > 0 && to > from, "pushFeed boundary");
  const env = vm.createContext({ state: { feed: [], active: false }, renderFeed() {}, Date, Math });
  vm.runInContext(text.slice(from, to), env);
  env.pushFeed({ id: "hist-1-started", noFold: true, kind: "run", text: "started: Fix the settings panel" });
  env.pushFeed({ kind: "log", text: "[autopilot] verified \"Fix the settings panel\"" });
  env.pushFeed({ kind: "log", text: "[assistant] foreman asked to hand out work (queue waiting for dispatch)" });
  env.pushFeed({ kind: "log", text: "[assistant] foreman asked to hand out work (queue waiting for dispatch)" });
  for (let step = 0; step < 60; step += 1) env.pushFeed({ kind: "log", text: `[opencode] step ${step}: read src/file${step}.js` });
  const rows = env.state.feed.map((row) => `${row.kind}:${row.count ?? 1}:${row.text}`);
  assert.deepEqual(rows, [
    "log:60:[opencode] step 59: read src/file59.js",
    "log:2:[assistant] foreman asked to hand out work (queue waiting for dispatch)",
    "log:1:[autopilot] verified \"Fix the settings panel\"",
    "run:1:started: Fix the settings panel",
  ]);
});

test("Command shows sessionless output, worker route and fresh update age", () => {
  const job = { taskId: "current", title: "Build Snake", phase: "building", route: "Codex CLI", activity: "Running collision checks", startedAt: Date.now() - 60000, lastOutputAt: Date.now() - 5000 };
  const env = environment({ assistant: { execute: true, running: [job] } });
  env.renderFeed();
  assert.match(env.el.feedNow.textContent, /Worker output: Running collision checks/);
  assert.match(env.el.feedNow.textContent, /Codex CLI.*Updated 5s ago/);
  assert.doesNotMatch(env.el.feedNow.textContent, /%/);
  job.currentStep = "Verify keyboard input";
  env.state.feedDirty = true; env.renderFeed();
  assert.match(env.el.feedNow.textContent, /Verify keyboard input/);
  job.phase = "finishing";
  env.state.feedDirty = true; env.renderFeed();
  assert.match(env.el.feedNow.textContent, /Finishing run.*Worker reported completion/);
});

test("long worker activity expands on demand and stays open through live updates for the same run", () => {
  const job = { id: "run-one", taskId: "current", title: "Inspect project files", startedAt: Date.now() - 60000,
    currentStep: `Bash running · 25s · Get-ChildItem -LiteralPath ${"sample-project/".repeat(12)} -Recurse` };
  const env = environment({ assistant: { execute: true, running: [job] } });
  env.renderFeed();
  const details = byClass(env.el.feedNow, "feed-current-details");
  assert.equal(details.open, false);
  assert.equal(details.children[0].textContent, "Bash running · 25s");
  assert.equal(byClass(details, "feed-current-stage").textContent, job.currentStep);
  details.open = true;
  env.document.activeElement = details.children[0];
  env.state.assistant.running = [{ ...job, currentStep: job.currentStep.replace("25s", "35s") }];
  env.state.feedDirty = true; env.renderFeed();
  assert.equal(byClass(env.el.feedNow, "feed-current-details").open, true);
  assert.equal(byClass(env.el.feedNow, "feed-current-details").children[0].focused, true, "the activity disclosure retains keyboard focus across updates");
  assert.equal(byClass(env.el.feedNow, "feed-current-details").children[0].textContent, "Bash running · 35s");
  env.state.assistant.running = [{ ...job, id: "run-two", startedAt: Date.now() }];
  env.state.feedDirty = true; env.renderFeed();
  assert.equal(byClass(env.el.feedNow, "feed-current-details").open, false, "a new run starts folded");
});

test("Work keeps running agents and failures visible while folding routine and intentionally stopped roles", () => {
  const full = { agents: [
    { role: "watcher", status: "done", text: "36 sessions checked" },
    { role: "keeper", status: "idle", text: "Waiting for the next pass" },
    { role: "auditor", status: "running", text: "Checking results" },
    { role: "cluster-planner", status: "error", error: "Mode changed or work paused" },
    { role: "cluster-reviewer", status: "error", error: "Provider unavailable" },
  ] };
  const env = environment({ full });
  env.renderFeed();
  assert.equal(env.el.feedAgentsCount.textContent, "1 need attention");
  assert.equal(env.el.feedAgents.children.length, 2);
  assert.match(env.el.feedAgents.textContent, /auditor.*Checking results.*Reviewer.*Provider unavailable/);
  assert.equal(env.el.feedRecentCount.textContent, "3");
  assert.match(env.el.feedRecentList.textContent, /STOPPEDPlanner.*Mode changed or work paused/);
  env.el.feedRecentAgents.open = true;
  full.agents = full.agents.filter((agent) => ["done", "idle"].includes(agent.status));
  env.state.feedDirty = true; env.renderFeed();
  assert.equal(env.el.feedAgentsSection.hidden, true);
  assert.equal(env.el.feedRecentAgents.hidden, false);
  assert.equal(env.el.feedRecentAgents.open, true, "live roster refresh keeps the owner's disclosure choice");
});

// A worker's stdout reaches the feed a line at a time, a dozen a second with
// several running, and each renderFeed rebuilds the whole rail. A push after
// a quiet window paints at once; pushes inside it share one trailing paint.
test("feed pushes paint at once after a quiet window and share one trailing paint in a burst", () => {
  const text = source.replace(/\r\n/g, "\n");
  const from = text.indexOf("  const transcriptRow = ");
  const to = text.indexOf("  function feedLine(item) {", from);
  let clock = 10_000, renders = 0;
  const timers = [];
  const state = { feed: [], active: true, feedDirty: false };
  const env = vm.createContext({
    state, Math, Date: { now: () => clock },
    renderFeed() { if (!state.feedDirty) return; state.feedDirty = false; renders += 1; },
    setTimeout: (fn, ms) => { timers.push({ fn, at: clock + ms }); return timers.length; },
  });
  vm.runInContext(text.slice(from, to), env);
  env.pushFeed({ kind: "log", text: "[assistant] foreman asked to hand out work" });
  assert.equal(renders, 1, "the first push after a quiet window paints immediately");
  for (let step = 0; step < 30; step += 1) { clock += 5; env.pushFeed({ kind: "log", text: `[opencode] step ${step}` }); }
  assert.equal(renders, 1, "a burst inside the window does not repaint per line");
  assert.equal(timers.length, 1, "the burst shares one trailing paint");
  assert.equal(timers[0].at, 10_000 + 250, "the trailing paint lands when the window closes");
  clock = timers[0].at; timers.shift().fn();
  assert.equal(renders, 2, "the trailing paint shows the burst's last line");
  assert.equal(state.feed[0].text, "[opencode] step 29");
  clock += 400; env.pushFeed({ kind: "alert", text: "worker CLI not starting" });
  assert.equal(renders, 3, "a push after the window is quiet again paints at once");
  clock += 10; env.pushFeed({ kind: "log", text: "[opencode] later" });
  state.active = false;
  clock = timers[0].at; timers.shift().fn();
  assert.equal(renders, 3, "leaving Command drops the trailing paint");
});

// The chat log repaints on every feed push; the thread under it only rebuilds
// (and measures its scroll, a forced layout) when what it shows changed.
test("the chat thread rebuilds only when a bubble, its age label or the pending reply changed", () => {
  const text = source.replace(/\r\n/g, "\n");
  const from = text.indexOf("  // Drop a just-repeated user/assistant pair.");
  const to = text.indexOf("  function commandChatActivity(", from);
  assert.ok(from > 0 && to > from, "thread boundary");
  let label = "2m ago";
  const env = vm.createContext({
    window: { mefiStudio: { assistantMessage() {} } },
    document: { createElement: (tag) => new Element(tag) },
    agoLabel: () => label,
    replyPending: (full) => Boolean(full?.pending),
    thinkingBubble: () => { const bubble = new Element("div"); bubble.className = "assistant-msg assistant thinking"; return bubble; },
  });
  vm.runInContext(`${text.slice(from, to)}\nthis.fillThread = fillThread;`, env);
  const thread = new Element("div");
  const full = { messages: [{ role: "user", text: "status?", at: 1 }, { role: "assistant", text: "Two builds running.", at: 2, via: "local" }] };
  env.fillThread(thread, full);
  const first = thread.children.slice();
  assert.equal(first.length, 2);
  assert.match(first[1].textContent, /Two builds running\.2m ago · local/);
  thread.scrollTop = 40; thread.scrollHeight = 900;
  env.fillThread(thread, { messages: full.messages.map((message) => ({ ...message })) });
  assert.ok(thread.children.every((child, index) => child === first[index]), "an unchanged thread keeps its bubbles");
  assert.equal(thread.scrollTop, 40, "and leaves the reader's scroll alone");
  label = "3m ago";
  env.fillThread(thread, full);
  assert.notEqual(thread.children[0], first[0], "a new age label repaints");
  const relabelled = thread.children.slice();
  env.fillThread(thread, { ...full, pending: true });
  assert.equal(thread.children.length, 3, "a pending reply adds the thinking bubble");
  assert.notEqual(thread.children[0], relabelled[0]);
  env.fillThread(thread, { messages: [...full.messages, { role: "assistant", text: "Done.", at: 3 }] });
  assert.equal(thread.children.length, 3);
  assert.match(thread.children[2].textContent, /^Done\./);
});
