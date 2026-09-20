// Live-Chromium proof of the occlusion probe contract pinned statically by
// tests/worker_responsiveness.test.mjs: an Electron fixture loads the real
// renderer/booklet.html, proves the blob worker constructs under the page CSP
// (worker-src blob:), then covers the window with an always-on-top window —
// native occlusion, never minimize — and proves rAF stays silent for 3s while
// the worker / MessageChannel channel answers and the extracted measureWorkerLag
// probe expression from main.cjs reads ~0 lag instead of the 1000ms sentinel.
//
// Run: node --test tests/occlusion_probe.test.mjs

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

test("an occluded booklet window's worker/MessageChannel channel answers while rAF stays silent under the page CSP", { skip: !canRun, timeout: 90000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-occlusion-"));
  let assertionError;
  try {
    const env = { ...process.env, MEFI_OCCLUSION_FIXTURE: fixture };
    delete env.ELECTRON_RUN_AS_NODE;
    // Chromium helpers inherit cwd and can retain its Windows directory
    // handle briefly after the main process exits. All fixture paths are
    // absolute, so never make the disposable directory a subprocess cwd.
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "occlusion-probe-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-10000); });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-10000); });
    const timer = setTimeout(() => child.kill(), 80000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch {}
    assert.equal(code, 0, `${output}\n${report?.failure || "No occlusion fixture report"}`);
    assert.ok(report && !report.failure, report?.failure || "No occlusion fixture report");

    assert.match(report.csp, /worker-src[^;]*blob:/, "booklet.html CSP must allow blob workers");
    assert.deepEqual(report.cspViolations, [], `CSP violations in the live page: ${JSON.stringify(report.cspViolations)}`);

    assert.ok(report.visible.state.ticks >= 5, `rAF must advance while visible (ticks=${report.visible.state.ticks})`);
    assert.equal(report.visible.probe.answered.frames, true);
    assert.equal(report.visible.worker.constructed, true, "blob worker must construct under the page CSP while visible");
    assert.ok(Array.isArray(report.visible.probeSamples) && report.visible.probeSamples.length >= 1, "fixture must report every visible probe sample");
    assert.ok(report.visible.probe.lagMs < 100, `visible lag ~0 expected, got ${report.visible.probe.lagMs}ms (samples=${JSON.stringify(report.visible.probeSamples.map((sample) => sample.lagMs))})`);

    assert.equal(report.occluded.windowState.minimized, false, "occlusion must be coverage, not minimize");
    assert.equal(report.occluded.rafGrowth, 0, `rAF must stay silent while occluded (growth=${report.occluded.rafGrowth})`);
    assert.ok(Array.isArray(report.occluded.probeSamples) && report.occluded.probeSamples.length >= 1, "fixture must report every occluded probe sample");
    for (const [index, sample] of report.occluded.probeSamples.entries()) {
      assert.notEqual(sample.answered?.frames, true, `occluded probe sample ${index + 1}/${report.occluded.probeSamples.length} must not answer via frames: ${JSON.stringify(sample)}`);
      assert.ok(Number.isFinite(sample.answered?.workerDriftMs), `occluded probe sample ${index + 1} must answer via the unthrottled channel: ${JSON.stringify(sample)}`);
    }
    assert.ok(report.occluded.probe.lagMs < 100, `occluded lag must be ~0 on the cleanest of ${report.occluded.probeSamples.length} samples, got ${report.occluded.probe.lagMs}ms (sentinel is 1000, samples=${JSON.stringify(report.occluded.probeSamples.map((sample) => sample.lagMs))})`);
    assert.equal(report.occluded.worker.constructed, true, "blob worker must still construct and answer while occluded");
    assert.ok(Number.isFinite(report.occluded.messageChannelMs) && report.occluded.messageChannelMs < 200, `occluded MessageChannel round trip too slow: ${report.occluded.messageChannelMs}ms`);

    assert.ok(report.recovered, "rAF must resume after the cover is removed");

    t.diagnostic(`occlusion via ${report.occluded.detection.signal}; occluded rAF growth ${report.occluded.rafGrowth}; probe ${JSON.stringify(report.occluded.probe.answered)}; lag ${report.occluded.probe.lagMs}ms of ${report.occluded.probeSamples.length} samples (${report.occluded.probeSamples.map((sample) => sample.lagMs).join(", ")}); worker drift ${report.occluded.worker.driftMs}ms; MessageChannel ${report.occluded.messageChannelMs}ms; console errors ${report.consoleErrors.length}`);
  } catch (error) {
    assertionError = error;
    throw error;
  } finally {
    assert.ok(path.dirname(fixture) === path.resolve(tmpdir()) && path.basename(fixture).startsWith("mefi-occlusion-"));
    try {
      await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    } catch (cleanupError) {
      if (assertionError) throw new AggregateError([assertionError, cleanupError], "Occlusion probe assertions and fixture cleanup both failed");
      throw cleanupError;
    }
  }
});
