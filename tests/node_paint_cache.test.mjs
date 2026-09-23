// Isolated Chromium pixel and cache checks; no Studio stores, providers or workers.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(studio, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const canRun = existsSync(executable) && (process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY));

test("cached orb gradients retain exact radii, colors and screen-space geometry across pixel densities", { skip: !canRun, timeout: 90000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-node-paint-"));
  let assertionError;
  try {
    await copyFile(path.join(studio, "renderer", "idle.js"), path.join(fixture, "idle.js"));
    await copyFile(path.join(studio, "renderer", "node-styles.js"), path.join(fixture, "node-styles.js"));
    const env = { ...process.env, MEFI_NODE_PAINT_FIXTURE: fixture };
    delete env.ELECTRON_RUN_AS_NODE;
    // Chromium helpers inherit cwd and can retain its Windows directory
    // handle briefly after the main process exits. All fixture paths are
    // absolute, so never make the disposable directory a subprocess cwd.
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "node-paint-cache-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-10000); });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-10000); });
    const timer = setTimeout(() => child.kill(), 30000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch {}
    assert.equal(code, 0, `${output}\n${report?.failure || "No pixel fixture report"}`);
    assert.ok(report && !report.failure, report?.failure || "No pixel fixture report");
    assert.deepEqual(report.networkAttempts, []);
    assert.equal(report.scenes.length, 3);
    for (const scene of report.scenes) {
      assert.equal(scene.samples, 192);
      // Normalizing gradient coordinates can round a handful of channels by
      // 1–4/255. Paths, outlines, highlights and glyphs retain their original
      // screen coordinates; larger edge shifts must fail this comparison.
      assert.ok(scene.maxDelta <= 4, `DPR ${scene.dpr}: channel delta ${scene.maxDelta}`);
      assert.ok(scene.meanDelta <= 0.002, `DPR ${scene.dpr}: widespread pixel changes (${scene.meanDelta})`);
    }
    assert.equal(report.warmGradientCreates, 2);
    assert.equal(report.movingGradientCreates, 2, "continuous radius, position and opacity changes reuse the same gradients");
    assert.ok(report.cacheEntries > 0 && report.cacheEntries <= 128, "retained gradients stay bounded per context");
    assert.equal(report.recentReused, true);
    assert.equal(report.oldestEvicted, true);
    assert.equal(report.secondContextCreates, 2, "each canvas owns its own bounded gradient cache");
    assert.equal(report.contextRestored, true, "node painting must restore the caller's transform and opacity");
    t.diagnostic(`Pixel deltas by DPR: ${report.scenes.map((scene) => `${scene.dpr}: max ${scene.maxDelta}, mean ${scene.meanDelta.toFixed(6)}`).join("; ")}`);
  } catch (error) {
    assertionError = error;
    throw error;
  } finally {
    assert.ok(path.dirname(fixture) === path.resolve(tmpdir()) && path.basename(fixture).startsWith("mefi-node-paint-"));
    try {
      // Bound transient antivirus/Chromium locks without hiding a leak.
      await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    } catch (cleanupError) {
      if (assertionError) throw new AggregateError([assertionError, cleanupError], "Node paint assertions and fixture cleanup both failed");
      throw cleanupError;
    }
  }
});
