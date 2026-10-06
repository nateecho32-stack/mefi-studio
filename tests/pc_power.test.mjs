import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const power = require("../scripts/pc-power.cjs");

const battery = (level, onBattery = true) => ({ level, status: onBattery ? 1 : 2, onBattery, charging: false });

test("Windows' battery line is read, and a desktop has none", () => {
  assert.deepEqual(power.parseBattery('{"EstimatedChargeRemaining":57,"BatteryStatus":1}'), { level: 57, status: 1, onBattery: true, charging: false });
  assert.deepEqual(power.parseBattery('{"EstimatedChargeRemaining":80,"BatteryStatus":6}'), { level: 80, status: 6, onBattery: false, charging: true });
  assert.deepEqual(power.parseBattery('{"EstimatedChargeRemaining":100,"BatteryStatus":2}'), { level: 100, status: 2, onBattery: false, charging: false });
  // Electron's on-battery answer wins over a status that says otherwise.
  assert.equal(power.parseBattery('{"EstimatedChargeRemaining":40,"BatteryStatus":2}', { onBatteryPower: true }).onBattery, true);
  assert.equal(power.parseBattery(""), null);
  assert.equal(power.parseBattery("not json"), null);
  assert.equal(power.parseBattery('{"BatteryStatus":1}'), null);
});

test("readBattery asks PowerShell once and never on another platform", async () => {
  const calls = [];
  const spawn = (exe, args) => {
    calls.push([exe, args]);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    queueMicrotask(() => { child.stdout.emit("data", '{"EstimatedChargeRemaining":12,"BatteryStatus":1}'); child.emit("close", 0); });
    return child;
  };
  assert.deepEqual(await power.readBattery({ spawn, platform: "win32" }), { level: 12, status: 1, onBattery: true, charging: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "powershell");
  assert.ok(calls[0][1].includes(power.QUERY));
  assert.equal(await power.readBattery({ spawn, platform: "linux" }), null);
  assert.equal(calls.length, 1);
  const broken = await power.readBattery({ spawn: () => { throw new Error("no powershell"); }, platform: "win32" });
  assert.match(broken.error, /no powershell/);
});

test("readBattery gives up when Windows does not answer", async () => {
  let fire = null;
  const hung = () => { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.kill = () => {}; return child; };
  const pending = power.readBattery({ spawn: hung, platform: "win32", setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {} });
  fire();
  assert.match((await pending).error, /did not answer/);
});

test("the lines: 20% winds down, 10% stops, 25% or mains comes back", () => {
  let state = { stage: "ok", continuedAt: null };
  const step = (reading) => (state = power.nextStage(state, reading));
  assert.equal(step(battery(50)).stage, "ok");
  assert.equal(step(battery(21)).stage, "ok");
  assert.deepEqual(step(battery(20)), { stage: "low", continuedAt: null, changed: true });
  // Hysteresis: not back to ok until five points above the line.
  assert.equal(step(battery(23)).stage, "low");
  assert.equal(step(battery(25)).stage, "ok");
  assert.equal(step(battery(19)).stage, "low");
  // Plugged in ends the wind-down at once.
  assert.equal(step(battery(19, false)).stage, "ok");
  assert.equal(step(battery(15)).stage, "low");
  assert.deepEqual(step(battery(10)), { stage: "stopped", continuedAt: null, changed: true });
});

test("stopped waits for Continue, plugged in or not, and stops again lower", () => {
  let state = power.nextStage({ stage: "low" }, battery(9));
  assert.equal(state.stage, "stopped");
  state = power.nextStage(state, battery(30, false));
  assert.equal(state.stage, "stopped", "plugging in does not restart it");
  state = power.continueStage(battery(9));
  assert.deepEqual(state, { stage: "ok", continuedAt: 9, changed: true });
  // Working on after Continue: no wind-down, a stop again at 9 - 4 = 5.
  assert.equal(power.nextStage(state, battery(7)).stage, "ok");
  assert.equal(power.nextStage(state, battery(5)).stage, "stopped");
  // Continue at 5 stops again at the floor, 3%, never lower.
  const late = power.continueStage(battery(5));
  assert.equal(power.nextStage(late, battery(4)).stage, "ok");
  assert.equal(power.nextStage(late, battery(3)).stage, "stopped");
  // Plugged in forgets the Continue.
  assert.deepEqual(power.nextStage(state, battery(9, false)), { stage: "ok", continuedAt: null, changed: false });
  // Continue while plugged in is a plain ok.
  assert.equal(power.continueStage(battery(50, false)).continuedAt, null);
});

test("no battery, an unreadable battery and custom lines", () => {
  assert.equal(power.nextStage({ stage: "low" }, null).stage, "ok");
  assert.equal(power.nextStage({ stage: "low" }, { error: "x" }).stage, "ok");
  assert.equal(power.nextStage({ stage: "stopped" }, null).stage, "stopped");
  assert.deepEqual(power.normalizeLines({ low: 30, stop: 15 }), { low: 30, stop: 15 });
  assert.deepEqual(power.normalizeLines({ low: 10, stop: 20 }), power.DEFAULT_LINES, "stop above low falls back");
  assert.deepEqual(power.normalizeLines({ low: 99, stop: 1 }), { low: 50, stop: 5 });
  assert.equal(power.nextStage({ stage: "ok" }, battery(29), { low: 30, stop: 15 }).stage, "low");
});

test("how often it looks, and the words", () => {
  assert.equal(power.nextLookMs(null), 30 * 60_000);
  assert.equal(power.nextLookMs(battery(80, false)), 5 * 60_000);
  assert.equal(power.nextLookMs(battery(80)), 3 * 60_000);
  assert.equal(power.nextLookMs(battery(39)), 60_000);
  assert.equal(power.nextLookMs(battery(24)), 30_000);
  assert.equal(power.describe(null), "Plugged in (no battery)");
  assert.equal(power.describe(battery(18), "low"), "Battery 18%, on battery: finishing up, starting nothing new");
  assert.equal(power.describe(battery(9), "stopped"), "Battery 9%, on battery: stopped, waiting for you");
});
