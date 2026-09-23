// Exercise the profiler in real Chromium using an isolated, read-only app
// bridge. Studio's application entry point, stores, providers and workers are
// never loaded; the desktop variant imports only the host measurement module.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../scripts/build-booklet.mjs";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(studio, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const canRun = existsSync(executable) && (process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY));

async function runFixture(t, desktopHost = false, resumeSheet = "") {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-performance-render-"));
  try {
    await mkdir(path.join(fixture, "renderer"));
    await mkdir(path.join(fixture, "data"));
    if (desktopHost) {
      await mkdir(path.join(fixture, "scripts"));
      await copyFile(path.join(studio, "scripts", "performance-profiler.cjs"), path.join(fixture, "scripts", "performance-profiler.cjs"));
    }
    const files = (await readdir(path.join(studio, "renderer"))).filter((name) => /\.(?:js|css)$/.test(name) || name === "booklet.template.html");
    await Promise.all(files.map((name) => copyFile(path.join(studio, "renderer", name), path.join(fixture, "renderer", name))));
    await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
    await build({ root: fixture });
    const env = { ...process.env, MEFI_PERFORMANCE_RENDER_FIXTURE: fixture, MEFI_PERFORMANCE_DESKTOP_HOST: desktopHost ? "1" : "0" };
    if (resumeSheet) env.MEFI_PERFORMANCE_RESUME_SHEET = resumeSheet;
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "performance-render-electron.cjs")], { cwd: fixture, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-14000); });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-14000); });
    // A healthy fixture measured ~25s inside a loaded parallel stage (TESTRUNS,
    // 2026-09-22); the old 40s kill left only 1.6x headroom, so a concurrent
    // build or sibling suite could kill a legitimate pass. Keep the kill bound
    // well clear of a loaded-but-healthy run - command_render and
    // occlusion_probe use the same 80s convention. The enclosing node:test
    // timeout below adds 60s of prelude (mkdtemp + copy + booklet build under
    // load) plus teardown, so this kill always gets to emit its classification
    // before the runner cancels the test.
    const timer = setTimeout(() => {
      output += `\nPerformance fixture timed out: PID ${child.pid}, root ${fixture}\n`;
      if (child.exitCode !== null) {
        // A helper retaining inherited pipes after its parent exits cannot
        // keep the test's exit event pending indefinitely.
        child.stdout.destroy(); child.stderr.destroy();
      } else if (process.platform === "win32" && child.pid) {
        // Kill only this fixture's process tree; Chromium helpers otherwise
        // survive electron.exe, retain the pipes and hold the fixture folder.
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill());
      } else child.kill();
    }, 80000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch {}
    if (process.env.MEFI_PERFORMANCE_CAPTURE_DIR && path.isAbsolute(process.env.MEFI_PERFORMANCE_CAPTURE_DIR)) {
      const artifacts = path.resolve(process.env.MEFI_PERFORMANCE_CAPTURE_DIR, desktopHost ? "desktop-host" : ".");
      await mkdir(artifacts, { recursive: true });
      await Promise.all(["report.json", "profiler-wide.png", "profiler-narrow.png", "profiler-host.png"].filter((name) => existsSync(path.join(fixture, name)))
        .map((name) => copyFile(path.join(fixture, name), path.join(artifacts, name))));
      t.diagnostic(`Profiler screenshots and report: ${artifacts}`);
    }
    assert.equal(code, 0, `${output}\n${report?.failure || "No fixture failure report"}`);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.networkAttempts, []);
    assert.deepEqual(report.processAttempts, []);
    return report;
  } finally {
    // mkdtemp fixes the cleanup target to this invocation's disposable folder.
    assert.ok(path.dirname(fixture) === path.resolve(tmpdir()) && path.basename(fixture).startsWith("mefi-performance-render-"));
    // Electron can still hold the folder for a moment after it exits. A locked
    // leftover in the temp dir is reported, not failed: throwing here also
    // replaced the test's real assertion error with EBUSY.
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
      .catch((error) => t.diagnostic(`fixture folder left behind (${error.code ?? error.message}): ${fixture}`));
  }
}

test("real performance profiler catches blocking work, freezes captures and fits a narrow window", { skip: !canRun, timeout: 140000 }, async (t) => {
  const report = await runFixture(t);
  assert.ok(report.sampledFrames >= 4, "requestAnimationFrame produces real frame timings");
  assert.ok(report.longTaskDetected, "the browser observer identifies the injected blocking work");
  assert.ok(report.namedScopesMeasured, "nested scopes retain inclusive and exclusive timings");
  assert.ok(report.captureFrozen && report.hiddenGapExcluded && report.resetCleared && report.exportedCapture);
  // Windows display scaling can round a 600px content size to 601 CSS px.
  assert.ok(report.narrowLayout.width <= 601 && !report.narrowLayout.overflow, JSON.stringify(report.narrowLayout));
});

test("desktop performance capture measures real Electron processes and IPC without exporting payloads", { skip: !canRun, timeout: 140000 }, async (t) => {
  const report = await runFixture(t, true);
  assert.ok(report.hostSamples >= 2 && report.processMetricsMeasured && report.ipcMeasured);
  assert.ok(report.hostFrozen && report.exportedCapture && report.payloadExcluded);
});

// Opt-in: MEFI_PERFORMANCE_RESUME_SHEET=explorer node --test tests/performance_render.test.mjs
// Seeds localStorage["mefiStudio.resume"] in the preload and requires the real
// Chromium boot to land on that sheet. Unset (the default) the fixture keeps
// its existing capture path and this test is skipped.
test("the seeded resume key deep-links to the explorer sheet in real Chromium", { skip: !canRun || !process.env.MEFI_PERFORMANCE_RESUME_SHEET, timeout: 140000 }, async (t) => {
  const report = await runFixture(t, false, process.env.MEFI_PERFORMANCE_RESUME_SHEET);
  assert.equal(report.resumeSheet, process.env.MEFI_PERFORMANCE_RESUME_SHEET);
  assert.equal(report.resumeRestored, true);
});
