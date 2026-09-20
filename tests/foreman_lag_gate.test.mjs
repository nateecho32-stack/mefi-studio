// Foreman lag-gate contract: main.cjs adopts scripts/assistant.mjs's
// createMachineLagGate as an additive admission factor. The gate counts the
// foreman's own renderer-lag samples (one spike is a resample, two consecutive
// readings above the busy threshold hold); machine.mjs's latched hold keeps
// host lag, single critical spikes and recovery hysteresis. The behavioral
// state machine itself is pinned by tests/assistant_lag_gate.test.mjs; this
// suite pins the wiring and the adopt-without-replacing decision.
import test from "node:test";
import assert from "node:assert/strict";
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
  assert.match(mainSource, /machine\.workerCapacity\(\{ running, force, lagMs \}\)/, "the sampler verdict must stay in charge");
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
