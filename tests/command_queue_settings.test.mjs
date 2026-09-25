import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const controls = source.slice(source.indexOf("  function newWorkStatus()"), source.indexOf("  function renderNewWorkControl()"));
const adoption = source.slice(source.indexOf("  const GRAPH_SUMMARY_KEYS"), source.indexOf("  function commandAgentRoster"));

function fixture(save, { initial = { enabled: false, execute: false, parallel: 2, adaptiveParallel: false, autoBuild: false, mode: "cluster" }, full = { status: "paused" }, bridge = {} } = {}) {
  const state = { assistant: initial };
  const events = [], patches = [], calls = [];
  const context = vm.createContext({
    state, assistantFull: () => full, renderSettingsPanel() {}, renderFeed() {}, refreshAssistantCache() {},
    window: {
      mefiStudio: { assistantAutopilot: async (patch) => { patches.push(patch); return save(patch); }, ...bridge },
      MefiTree: { applyAssistant: ({ state }) => { full = state; } },
      dispatchEvent: (event) => events.push(event), MefiToast() {},
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    changeNewWork: async (value) => { calls.push(["admission", value]); return true; },
    changeBuildParallel: async (value) => { calls.push(["capacity", value]); return true; },
    changeBuildMode: async (value) => { calls.push(["approval", value]); return true; },
    changeAgentMode: async (value) => { calls.push(["coordination", value]); return true; },
  });
  vm.runInContext(`${controls}\n${adoption}\nthis.api = {queueSettings,refreshQueueSettings,setQueueSetting,adoptAssistantStatus,publishQueueSettings};`, context);
  return { ...context.api, state, events, patches, calls, pushService: (next) => { full = next; } };
}

test("Settings queue save uses confirmed host state and emits a synchronized snapshot", async () => {
  const env = fixture(async (patch) => ({ ok: true, ...patch }));
  assert.equal(env.queueSettings().newWork, false);
  assert.equal(await env.setQueueSetting("enabled", true), true);
  assert.equal(env.state.assistant.enabled, true);
  assert.equal(env.state.assistant.parallel, 2);
  assert.equal(env.events.at(-1).detail.enabled, true);
  assert.equal(env.events.at(-1).detail.newWork, false, "queue enable does not invent an unpaused service state");
});

test("rejected queue save leaves confirmed state intact and allows retry", async () => {
  const env = fixture(async () => { throw new Error("Unavailable"); });
  assert.equal(await env.setQueueSetting("enabled", true), false);
  assert.equal(env.state.assistant.enabled, false);
  assert.equal(env.state.queueSaving, false);
  assert.equal(env.events.at(-1).detail.enabled, false);
});

test("Settings admission, capacity and approval use their distinct existing operations", async () => {
  const env = fixture(async () => assert.fail("No queue-enable patch expected"));
  await env.setQueueSetting("newWork", true);
  await env.setQueueSetting("parallel", "machine");
  await env.setQueueSetting("autoBuild", false);
  await env.setQueueSetting("mode", "swarm");
  assert.deepEqual(env.calls, [["admission", true], ["capacity", "machine"], ["approval", "verify"], ["coordination", "swarm"]]);
  assert.equal(env.patches.length, 0);
});


test("executor status adoption publishes the final cache and ignores repeated snapshots", () => {
  const env = fixture(async () => ({ ok: true }));
  env.adoptAssistantStatus({ enabled: true, execute: true, parallel: 3, adaptiveParallel: false, autoBuild: true, mode: "swarm" });
  assert.equal(env.events.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(env.events[0].detail)), JSON.parse(JSON.stringify(env.queueSettings())), "listeners receive the adopted snapshot");
  assert.equal(env.events[0].detail.parallel, 3);
  assert.equal(env.events[0].detail.autoBuild, true);
  assert.equal(env.events[0].detail.newWork, false, "the independent service remains paused");
  env.adoptAssistantStatus({ enabled: true, execute: true, parallel: 3, adaptiveParallel: false, autoBuild: true, mode: "swarm", running: [{ taskId: "work" }] });
  env.publishQueueSettings();
  assert.equal(env.events.length, 1, "work updates without preference changes do not repaint Settings");
  env.adoptAssistantStatus(null);
  assert.equal(env.events.length, 2);
  assert.equal(env.events.at(-1).detail.known, false);
  assert.equal(env.events.at(-1).detail.newWorkKnown, false);
});

test("Automation hydrates cold queue and service state without entering Command or saving", async () => {
  let statusReads = 0, serviceReads = 0, finishStatus, finishService;
  const env = fixture(() => assert.fail("loading cannot save"), { initial: null, full: null, bridge: {
    assistantStatus: () => { statusReads += 1; return new Promise((resolve) => { finishStatus = resolve; }); },
    assistantState: () => { serviceReads += 1; return new Promise((resolve) => { finishService = resolve; }); },
  } });
  const first = env.refreshQueueSettings();
  const second = env.refreshQueueSettings();
  assert.equal(first, second, "concurrent Settings/search visits share the read");
  await Promise.resolve();
  assert.equal(statusReads, 1); assert.equal(serviceReads, 1);
  assert.equal(env.queueSettings().known, false);
  finishService({ ok: true, state: { status: "idle" } });
  finishStatus({ ok: true, status: { enabled: true, execute: true, parallel: 3, adaptiveParallel: false, autoBuild: false, mode: "cluster" } });
  const confirmed = await first;
  assert.equal(confirmed.known, true); assert.equal(confirmed.newWorkKnown, true);
  assert.equal(confirmed.newWork, true); assert.equal(confirmed.parallel, 3);
  assert.equal(confirmed.autoBuild, false); assert.equal(confirmed.mode, "cluster");
  assert.equal(env.events.at(-1).detail.newWork, true);
  await env.refreshQueueSettings();
  assert.equal(statusReads, 1, "confirmed state needs no repeated initial read");
  assert.equal(env.patches.length, 0);
});

test("a cold Settings read cannot overwrite newer executor and service pushes", async () => {
  let finishStatus, finishService;
  const env = fixture(() => assert.fail("loading cannot save"), { initial: null, full: null, bridge: {
    assistantStatus: () => new Promise((resolve) => { finishStatus = resolve; }),
    assistantState: () => new Promise((resolve) => { finishService = resolve; }),
  } });
  const pending = env.refreshQueueSettings(); await Promise.resolve();
  env.adoptAssistantStatus({ enabled: true, execute: true, parallel: 2, mode: "swarm" });
  env.pushService({ status: "paused" });
  finishStatus({ ok: true, status: { enabled: false, execute: false, parallel: 1, mode: "cluster" } });
  finishService({ ok: true, state: { status: "idle" } });
  const confirmed = await pending;
  assert.equal(confirmed.enabled, true); assert.equal(confirmed.parallel, 2);
  assert.equal(confirmed.newWork, false, "the newer service pause survives");
});

test("a refused initial queue read stays unknown and can be retried", async () => {
  let reads = 0;
  const env = fixture(() => assert.fail("loading cannot save"), { initial: null, bridge: {
    assistantStatus: async () => ++reads === 1 ? { ok: false, error: "Unavailable" } : { ok: true, status: { enabled: false, execute: false, parallel: 1 } },
  } });
  assert.equal((await env.refreshQueueSettings()).known, false);
  assert.equal((await env.refreshQueueSettings()).known, true);
  assert.equal(reads, 2);
});
