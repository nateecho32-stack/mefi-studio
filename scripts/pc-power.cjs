"use strict";

// My PCs' battery (docs/my-pcs.md "Battery"): reading it from Windows, and
// the stage a laptop is in. The stages are pure; readBattery takes the spawn
// it uses, so tests never start PowerShell. main.cjs "My PCs" owns the timer
// and what each stage does to the work.
// - "ok": works normally.
// - "low" (at or under the low line, not plugged in): starts nothing new,
//   finishes what runs, offers ready cards to the other PCs. Back to "ok" at
//   five points above the line or when plugged in.
// - "stopped" (at or under the stop line): running work is stopped with its
//   progress saved and parked for the other PCs. It stays stopped, plugged in
//   or not, until the owner chooses Continue. After a Continue below the line
//   it stops again four points lower, and always at the floor.
// Guarded by tests/pc_power.test.mjs.

const DEFAULT_LINES = Object.freeze({ low: 20, stop: 10 });
const RESUME_ABOVE = 5;
const AGAIN_BELOW = 4;
const FLOOR = 3;
const STAGES = Object.freeze(["ok", "low", "stopped"]);
// Win32_Battery.BatteryStatus values that mean the battery is running the PC:
// 1 discharging, 4 low, 5 critical. 2 is "on mains", 3 full, 6-9 charging.
const DISCHARGING = new Set([1, 4, 5]);
const CHARGING = new Set([6, 7, 8, 9]);
// One query, one JSON line, nothing else on stdout; no battery prints nothing.
const QUERY = "Get-CimInstance -ClassName Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress";

const whole = (value, min, max) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : null);

// The battery lines from settings.pcs.battery: low 10-50, stop 5-30, low above stop.
function normalizeLines(raw) {
  const low = whole(raw?.low, 10, 50) ?? DEFAULT_LINES.low;
  const stop = whole(raw?.stop, 5, 30) ?? DEFAULT_LINES.stop;
  return stop < low ? { low, stop } : { ...DEFAULT_LINES };
}

// What PowerShell printed -> { level, status, onBattery, charging }, or null
// when the PC has no battery (a desktop prints nothing).
function parseBattery(text, { onBatteryPower = null } = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  let row;
  try { row = JSON.parse(raw); } catch { return null; }
  if (Array.isArray(row)) row = row[0];
  const level = whole(row?.EstimatedChargeRemaining, 0, 100);
  if (level === null) return null;
  const status = Number.isInteger(row?.BatteryStatus) ? row.BatteryStatus : null;
  // Electron's own answer wins when it says "on battery"; the shim under the
  // Rust host always says false, so Windows' status decides there.
  const onBattery = onBatteryPower === true || (status !== null && DISCHARGING.has(status));
  return { level, status, onBattery, charging: !onBattery && status !== null && CHARGING.has(status) };
}

// Reads the battery once. -> a reading, null (no battery) or { error }.
function readBattery({ spawn, platform = process.platform, onBatteryPower = null, timeoutMs = 15_000, setTimer, clearTimer } = {}) {
  if (platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    let out = "", settled = false, timer = null;
    const done = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== null && typeof clearTimer === "function") clearTimer(timer);
      resolve(value);
    };
    let child;
    try {
      child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", QUERY], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch (error) {
      done({ error: String(error?.message ?? error).slice(0, 160) });
      return;
    }
    child.stdout?.on?.("data", (chunk) => { if (out.length < 4096) out += String(chunk); });
    child.on?.("error", (error) => done({ error: String(error?.message ?? error).slice(0, 160) }));
    child.on?.("close", () => done(parseBattery(out, { onBatteryPower })));
    if (typeof setTimer === "function") {
      timer = setTimer(() => {
        try { child.kill?.(); } catch {}
        done({ error: "Windows did not answer about the battery in time." });
      }, timeoutMs);
    }
  });
}

// The next stage from the last one and a reading. `prior` is
// { stage, continuedAt } (continuedAt: the level a Continue was given at, or
// null). -> { stage, continuedAt, changed }.
function nextStage(prior, reading, lines = DEFAULT_LINES) {
  const was = STAGES.includes(prior?.stage) ? prior.stage : "ok";
  const continuedAt = Number.isFinite(prior?.continuedAt) ? prior.continuedAt : null;
  const out = (stage, after = continuedAt) => ({ stage, continuedAt: after, changed: stage !== was });
  // Stopped holds until the owner's Continue, whatever the power does.
  if (was === "stopped") return out("stopped");
  if (!reading || reading.error || !reading.onBattery) return out("ok", null);
  const { low, stop } = normalizeLines(lines);
  const level = reading.level;
  const stopAt = continuedAt === null ? stop : Math.max(FLOOR, Math.min(stop, continuedAt - AGAIN_BELOW));
  if (level <= stopAt || level <= FLOOR) return out("stopped", null);
  // After a Continue the owner asked for work: no winding down until it stops again.
  if (continuedAt !== null) return out("ok");
  if (level <= low) return out("low");
  if (was === "low" && level < low + RESUME_ABOVE) return out("low");
  return out("ok");
}

// The owner's Continue: work again, and stop again lower if it keeps falling.
function continueStage(reading, lines = DEFAULT_LINES) {
  const { low } = normalizeLines(lines);
  const below = reading && !reading.error && reading.onBattery && reading.level <= low;
  return { stage: "ok", continuedAt: below ? reading.level : null, changed: true };
}

// How long until the next look, in ms.
function nextLookMs(reading) {
  if (reading === null) return 30 * 60_000;
  if (!reading || reading.error) return 5 * 60_000;
  if (!reading.onBattery) return 5 * 60_000;
  return reading.level < 25 ? 30_000 : reading.level < 40 ? 60_000 : 3 * 60_000;
}

// One line for the row: "Battery 18%, not plugged in".
function describe(reading, stage) {
  if (reading === null) return "Plugged in (no battery)";
  if (!reading || reading.error) return "Battery unknown";
  const power = reading.onBattery ? "on battery" : reading.charging ? "charging" : "plugged in";
  const text = `Battery ${reading.level}%, ${power}`;
  if (stage === "stopped") return `${text}: stopped, waiting for you`;
  if (stage === "low") return `${text}: finishing up, starting nothing new`;
  return text;
}

module.exports = { DEFAULT_LINES, STAGES, FLOOR, QUERY, normalizeLines, parseBattery, readBattery, nextStage, continueStage, nextLookMs, describe };
