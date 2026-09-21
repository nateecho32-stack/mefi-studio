// Foreman lag-gate contract: main.cjs adopts scripts/assistant.mjs's
// createMachineLagGate as an additive admission factor. The gate counts the
// foreman's own renderer-lag samples (one spike is a resample, two consecutive
// readings above the busy threshold hold); machine.mjs's latched hold keeps
// host lag, single critical spikes and recovery hysteresis. The behavioral
// state machine itself is pinned by tests/assistant_lag_gate.test.mjs; this
// suite pins the wiring and the adopt-without-replacing decision.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createMachineLagGate } from "../scripts/assistant.mjs";
import { WORKER_CAPACITY_DEFAULTS } from "../scripts/machine.mjs";

const mainSource = await readFile(fileURLToPath(new URL("../main.cjs", import.meta.url)), "utf8");
const machineSource = await readFile(fileURLToPath(new URL("../scripts/machine.mjs", import.meta.url)), "utf8");

test("the foreman consults the assistant's lag gate at the sampler's busy threshold", () => {
  assert.match(
    mainSource,
    /machineLagGate \?\?= assistant\.createMachineLagGate\(\{ threshold: 100 \}\)/,
    "readCapacity must create the gate from the assistant module, mirroring the sampler's lagBusyMs",
  );
  assert.equal(WORKER_CAPACITY_DEFAULTS.lagBusyMs, 100, "the mirrored threshold must stay in step with the sampler");
});

test("a gate hold blocks the start and the verdict rides autopilot.capacity", () => {
  assert.match(
    mainSource,
    /capacity = \{ \.\.\.capacity, lagGate \};/,
    "the gate verdict must be exposed on the capacity object the briefing facts read",
  );
  assert.match(
    mainSource,
    /if \(lagGate\.hold\) \{\s*\n\s*capacity = \{ \.\.\.capacity, canStart: false, reason: `Renderer responsiveness is high two samples in a row/,
    "a hold must force canStart:false with a reason naming the two-sample rule",
  );
});

test("a hot-swapped assistant.mjs resets the gate", () => {
  assert.match(
    mainSource,
    /if \(swapped\.includes\("scripts\/assistant\.mjs"\)\) \{\s*\n\s*resetMachineLagGate\(\);/,
    "applyModules must drop the old gate so the swapped module's logic is adopted",
  );
});

test("the gate is additive: machine.mjs's latched hold is not replaced", () => {
  assert.match(mainSource, /machine\.workerCapacity\(\{ running, force, lagMs, memoryWarnOverride: machineMemoryWarnOverride\(capacitySettings\) \}\)/, "the sampler verdict must stay in charge");
  assert.match(machineSource, /if \(lagMs >= options\.lagCriticalMs \|\| highSamples >= options\.pressureSamples\) lagPressure = true;/, "the critical-spike latch must survive");
  assert.match(machineSource, /if \(recoverySamples >= options\.recoverySamples\) lagPressure = false;/, "the recovery hysteresis must survive");
});

test("the wired gate semantics: two spikes hold, one spike is a resample, a healthy or hidden sample releases", () => {
  const gate = createMachineLagGate({ threshold: 100 });
  const spike = gate(150);
  assert.equal(spike.hold, false, "one spike must not hold the foreman");
  assert.equal(spike.resample, true);
  const held = gate(150);
  assert.equal(held.hold, true);
  assert.equal(held.consecutive, 2);
  const released = gate(0);
  assert.equal(released.hold, false, "a responsive reading must release the hold");
  assert.equal(gate(null).hold, false, "a hidden window's null reading must never hold");
});

test("the gate counts each probe once and a live hold re-samples before blocking", async () => {
  const gateBlock = mainSource.slice(mainSource.indexOf("let machineLagGate = null;"), mainSource.indexOf("// The renderer writes localStorage"));
  const capacityStart = mainSource.indexOf("  const readCapacity = async (running, force = false) => {");
  const capacityEnd = mainSource.indexOf("return capacity.canStart === true;", capacityStart);
  const capacityBlock = mainSource.slice(capacityStart, mainSource.indexOf("};", capacityEnd) + 2);
  assert.ok(gateBlock.includes("resetMachineLagGate") && capacityBlock.includes("createMachineLagGate"), "the tested source slices are present");
  let now = 10000;
  let nextLag = 0;
  let probeSeq = 0;
  const autopilot = { execute: true, jobs: [], capacityFaultLogged: false, resourceBackoffUntil: 0, capacity: null };
  const lagCalls = [], freshProbes = [], capacityCalls = [];
  const env = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    autopilot,
    logLine() {},
    getMachine: async () => ({ workerCapacity: async (options) => { capacityCalls.push(options); return { canStart: true, reason: null }; } }),
    getAssistant: async () => ({ createMachineLagGate: (options) => createMachineLagGate(options) }),
    // The admission read now consults the saved settings for the memory warn
    // override; the stubs mirror main.cjs's scope with defaults off.
    readSettings: async () => ({}),
    machineMemoryWarnOverride: () => false,
  });
  // Mimic the real sampler: a fresh probe stamps the 750ms cache on the
  // function itself with its identity; cached replays and in-flight joins
  // return that same probe.
  env.measureWorkerLag = async ({ force = false } = {}) => {
    lagCalls.push(force);
    const cached = env.measureWorkerLag.cache;
    if (!force && cached && now - cached.at < 750) return cached.lagMs;
    const lagMs = nextLag;
    freshProbes.push(lagMs);
    env.measureWorkerLag.cache = { at: now, lagMs, probe: ++probeSeq };
    return lagMs;
  };
  vm.runInContext(`${gateBlock}\n${capacityBlock}`, env);
  const readCapacity = vm.runInContext("readCapacity", env);

  // Tick 1 — the first spike is a resample, not a hold.
  nextLag = 150;
  assert.equal(await readCapacity(0), true);
  assert.equal(autopilot.capacity.lagGate.hold, false);
  assert.equal(autopilot.capacity.lagGate.consecutive, 1);

  // Tick 2 — a cached replay of the same probe must not become a second sample.
  now += 100;
  assert.equal(await readCapacity(0), true);
  assert.equal(freshProbes.length, 1, "the 750ms cache replays the same probe");
  assert.equal(autopilot.capacity.lagGate.consecutive, 1, "a replay must not manufacture two samples in a row");
  assert.equal(autopilot.capacity.lagGate.hold, false);

  // Tick 3 — a genuinely fresh second spike holds starts.
  now += 800;
  assert.equal(await readCapacity(0), false);
  assert.equal(freshProbes.length, 2);
  assert.equal(autopilot.capacity.lagGate.hold, true);
  assert.match(autopilot.capacity.reason, /two samples in a row/);

  // Tick 4 — a live hold must re-sample: forcing the probe lets one responsive
  // reading lift the hold instead of coasting on cached lag.
  now += 100;
  nextLag = 0;
  assert.equal(await readCapacity(0), true);
  assert.equal(lagCalls.at(-1), true, "the held read forces a fresh probe");
  assert.equal(freshProbes.length, 3, "the hold must rest on a current reading");
  assert.equal(autopilot.capacity.lagGate.hold, false);
  assert.equal(autopilot.capacity.canStart, true);
});

test("a silent probe (unanswered channels) is unmeasured: the sampler gets null and the gate resets", async () => {
  const gateBlock = mainSource.slice(mainSource.indexOf("let machineLagGate = null;"), mainSource.indexOf("// The renderer writes localStorage"));
  const capacityStart = mainSource.indexOf("  const readCapacity = async (running, force = false) => {");
  const capacityEnd = mainSource.indexOf("return capacity.canStart === true;", capacityStart);
  const capacityBlock = mainSource.slice(capacityStart, mainSource.indexOf("};", capacityEnd) + 2);
  let now = 20000;
  let nextLag = 0;
  let nextSilent = false;
  let probeSeq = 0;
  const autopilot = { execute: true, jobs: [], capacityFaultLogged: false, resourceBackoffUntil: 0, capacity: null };
  const capacityCalls = [];
  const env = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    autopilot,
    logLine() {},
    getMachine: async () => ({ workerCapacity: async (options) => { capacityCalls.push(options); return { canStart: true, reason: null }; } }),
    getAssistant: async () => ({ createMachineLagGate: (options) => createMachineLagGate(options) }),
    readSettings: async () => ({}),
    machineMemoryWarnOverride: () => false,
  });
  env.measureWorkerLag = async ({ force = false } = {}) => {
    const cached = env.measureWorkerLag.cache;
    if (!force && cached && now - cached.at < 750) return cached.lagMs;
    env.measureWorkerLag.cache = { at: now, lagMs: nextLag, probe: ++probeSeq, silent: nextSilent };
    return nextLag;
  };
  vm.runInContext(`${gateBlock}\n${capacityBlock}`, env);
  const readCapacity = vm.runInContext("readCapacity", env);

  // A session-frozen page reads the 1000ms sentinel while the host idles.
  nextLag = 1000;
  nextSilent = true;
  assert.equal(await readCapacity(0), true);
  assert.equal(capacityCalls.at(-1).lagMs, null, "the sampler must receive an unmeasured renderer, not the sentinel");
  assert.equal(autopilot.capacity.lagGate.consecutive, 0, "silence never counts as a high gate sample");
  assert.equal(autopilot.capacity.canStart, true, "an idle host must start work while the renderer is unmeasurable");
  assert.equal(autopilot.capacity.lagGate.hold, false, "no hold rides the capacity when the gate released");

  // A real high reading afterwards is counted as fresh evidence again.
  now += 800;
  nextLag = 150;
  nextSilent = false;
  assert.equal(await readCapacity(0), true);
  assert.equal(capacityCalls.at(-1).lagMs, 150);
  assert.equal(autopilot.capacity.lagGate.consecutive, 1, "answered readings are counted like any other sample");
});

test("the resource pass applies the same silence rule: an unmeasured renderer never feeds the sampler's latch", async () => {
  // Regression: resourcePass fed the raw 1000ms silent sentinel into the
  // shared sampler every poll — one reading latched the critical-spike hold
  // and each pass reset recoverySamples, so the two-responsive-readings
  // recovery could never complete (the sustained "Machine lag holds
  // capacity" hold). It must gate on the host alone exactly like readCapacity.
  const resourceStart = mainSource.indexOf("async function resourcePass(");
  const resourceEnd = mainSource.indexOf("function startMachineWatch()");
  const resourceBlock = mainSource.slice(resourceStart, resourceEnd);
  assert.ok(resourceBlock.includes("measureWorkerLag.cache?.silent === true"), "the resource pass must consult the silent stamp");
  let now = 30000;
  let nextLag = 0;
  let nextSilent = false;
  let probeSeq = 0;
  const autopilot = { jobs: [], capacity: null, resourceBackoffUntil: 0 };
  const capacityCalls = [];
  const env = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    autopilot,
    logLine() {},
    getMachine: async () => ({
      leaseStatus: async () => ({ busy: false, exclusive: false, totalWidth: 0, holders: [] }),
      workerCapacity: async (options) => { capacityCalls.push(options); return { canStart: true, reason: null, resources: {} }; },
      describe: () => "",
    }),
    getEyes: async () => ({ writeJson: async () => {} }),
    readSettings: async () => ({}),
    machineMemoryWarnOverride: () => false,
    MACHINE_DEFAULTS: {},
    MACHINE_STATUS_PATH: "status.json",
    RESOURCE_LOG_PATH: "resource.json",
    machineEvents: [],
    machinePreviousCpu: new Map(),
    spawn() {},
    queueRequests: async () => {},
    send() {},
    projectRoot: () => ".",
  });
  env.measureWorkerLag = async () => {
    env.measureWorkerLag.cache = { at: now, lagMs: nextLag, probe: ++probeSeq, silent: nextSilent };
    return nextLag;
  };
  vm.runInContext(resourceBlock, env);
  const resourcePass = vm.runInContext("resourcePass", env);

  // A session-frozen page reads the 1000ms sentinel while the host idles:
  // the sampler must see an unmeasured renderer, never the sentinel.
  nextLag = 1000;
  nextSilent = true;
  await resourcePass({ kill: false, reason: "test", withProcesses: false });
  assert.equal(capacityCalls.at(-1).lagMs, null, "the sampler must receive null for a silent probe");
  assert.equal(autopilot.capacity.canStart, true, "an idle host must admit work while the renderer is unmeasurable");

  // An answered healthy reading flows through as evidence.
  now += 1000;
  nextLag = 12;
  nextSilent = false;
  await resourcePass({ kill: false, reason: "test", withProcesses: false });
  assert.equal(capacityCalls.at(-1).lagMs, 12);

  // A genuinely answered high reading is still real evidence for the latch.
  now += 1000;
  nextLag = 450;
  await resourcePass({ kill: false, reason: "test", withProcesses: false });
  assert.equal(capacityCalls.at(-1).lagMs, 450, "answered lag must keep feeding the sampler's critical-spike latch");
});
