// Live-Chromium execution of the eyes log-tail acceptance: the shipped
// renderer/boot.js poll guard plus the shipped renderer/eyes.js refreshLog
// tick and visibilitychange listener run in a real Electron renderer, the
// window is hidden and shown exactly once (a real visibility toggle), and the
// eyesLog fetch calls are counted: visible cadence, zero fetches while
// hidden, exactly one immediate snap-back fetch on show, then the baseline
// cadence with no doubled count. Throttling stays at the production default,
// so the hidden silence is the code's gate, not a fixture-disarmed Chromium.
// Lower-bound counts are awaited with deadlines inside the fixture and phases
// are judged from the fetch stamps and timestamps, so a busy machine's timer
// drift cannot fail the acceptance — only a real cadence bug can.
// Run: node --test tests/eyes_toggle_electron.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(studio, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const canRun = existsSync(executable) && (process.platform === "win32" || process.platform === "darwin" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY));

test("one hide/show visibility toggle: the eyes log tail pauses hidden, snaps one fetch on show, resumes without duplicates", { skip: !canRun, timeout: 90000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-log-toggle-"));
  let assertionError;
  try {
    const env = { ...process.env, MEFI_LOG_TOGGLE_FIXTURE: fixture };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "log-tail-toggle-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-10000); });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-10000); });
    const timer = setTimeout(() => child.kill(), 80000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch {}
    assert.equal(code, 0, `${output}\n${report?.failure || "No log-toggle fixture report"}`);
    assert.ok(report && !report.failure, report?.failure || "No log-toggle fixture report");

    assert.equal(report.mefiBootLoaded, true, "shipped boot.js must load on the probe page");
    assert.equal(report.shippedCadenceMs, "5000", "shipped eyes.js must register the log tail at 5000ms");
    assert.ok(report.baseline.fetches >= 2, `visible baseline must fetch at least twice (got ${report.baseline.fetches} over ${report.baseline.spanMs}ms)`);
    assert.equal(report.hiddenState.windowMinimized, false, "the hidden phase must be a real window hide, not a minimize");
    assert.equal(report.hiddenState.hidden, true, "the renderer must report document.hidden while the window is hidden");
    assert.equal(report.hidden.fetches, 0, `the hidden phase must fetch nothing (got ${report.hidden.fetches} over ${report.hidden.spanMs}ms)`);
    assert.equal(report.resume.immediateFetches, 1, `restore must snap exactly one immediate fetch (got ${report.resume.immediateFetches})`);
    assert.ok(report.resumedCadence.fetches >= 3, `the resumed cadence must tick once per interval (got ${report.resumedCadence.fetches})`);
    // Doubling is judged from the fetch timestamps like the fixture does: a
    // leaked interval or listener halves the time three fetches need, which a
    // count-based upper window cannot distinguish from load-induced drift.
    const cadenceMs = report.probeIntervalMs ?? 300;
    assert.ok(report.resumedCadence.spanMs >= cadenceMs * 1.5, `the resumed cadence must not be doubled by a leaked interval or listener (three fetches within ${report.resumedCadence.spanMs}ms at ${cadenceMs}ms cadence; the baseline rate needs about twice that)`);
    assert.ok(Array.isArray(report.fetches) && report.fetches.every((fetch) => fetch.hidden === false), "every fetch must be stamped visible");
    t.diagnostic(`baseline ${report.baseline.fetches}/${report.baseline.spanMs}ms; hidden ${report.hidden.fetches}/${report.hidden.spanMs}ms; resume snap ${report.resume.immediateFetches}; resumed ${report.resumedCadence.fetches}/${report.resumedCadence.spanMs}ms; fetch gaps ${report.fetchGapMs?.min}-${report.fetchGapMs?.max}ms; total fetches ${report.fetches.length}`);
  } catch (error) {
    assertionError = error;
    throw error;
  } finally {
    assert.ok(path.dirname(fixture) === path.resolve(tmpdir()) && path.basename(fixture).startsWith("mefi-log-toggle-"));
    try {
      await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    } catch (cleanupError) {
      if (assertionError) throw new AggregateError([assertionError, cleanupError], "Log-toggle probe assertions and fixture cleanup both failed");
      throw cleanupError;
    }
  }
});
