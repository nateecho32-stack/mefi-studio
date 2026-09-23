// A cold, real Chromium launch with synthetic read-only data. This never runs
// Studio's main process, touches its saved workspace, or starts a worker.
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

test("cold startup gates access on actual readiness, shows progress, and recovers failed reads", { skip: !canRun, timeout: 115000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-startup-render-"));
  try {
    await mkdir(path.join(fixture, "renderer")); await mkdir(path.join(fixture, "data"));
    const sources = (await readdir(path.join(studio, "renderer"))).filter((name) => /\.(?:js|css)$/.test(name) || name === "booklet.template.html");
    await Promise.all(sources.map((name) => copyFile(path.join(studio, "renderer", name), path.join(fixture, "renderer", name))));
    await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
    await build({ root: fixture });
    const env = { ...process.env, MEFI_STARTUP_RENDER_FIXTURE: fixture }; delete env.ELECTRON_RUN_AS_NODE;
    // Keep inherited Windows directory handles out of the disposable fixture.
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "startup-render-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-12000); });
    const timer = setTimeout(() => {
      output += `\nStartup fixture timed out: PID ${child.pid}, root ${fixture}\n`;
      if (child.exitCode !== null) {
        // A helper retaining inherited pipes after its parent exits cannot
        // keep the test's close event pending indefinitely.
        child.stdout.destroy(); child.stderr.destroy();
      } else if (process.platform === "win32" && child.pid) {
        // Kill only this fixture's process tree; Chromium helpers otherwise
        // retain pipes and profile handles after killing just electron.exe.
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill());
      } else child.kill();
    }, 55000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch {}
    const artifacts = process.env.MEFI_STARTUP_CAPTURE_DIR;
    if (artifacts && path.isAbsolute(artifacts)) {
      await mkdir(artifacts, { recursive: true });
      const names = ["report.json", "startup-loading.png", "startup-ready.png", "startup-error-600.png", "startup-light-600.png"];
      await Promise.all(names.filter((name) => existsSync(path.join(fixture, name))).map((name) => copyFile(path.join(fixture, name), path.join(artifacts, name))));
      t.diagnostic(`Startup screenshots: ${artifacts}`);
    }
    assert.equal(code, 0, `${report?.failure || ""}\n${output}`);
    assert.ok(report, "Electron must save its startup result");
    assert.equal(report.failure, undefined, `${report.failure || ""}\n${output}`);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.networkAttempts, []);
    assert.deepEqual(report.processAttempts, []);
    assert.ok(report.loading.gated && report.loading.inert && report.loading.progress > 0 && report.loading.progress < 100);
    assert.ok(report.catalogProgress > report.loading.progress && report.catalogProgress < 100);
    assert.ok(report.cannotSkip && report.ready.result && report.ready.populated && report.ready.onboarding);
    assert.equal(report.ready.progress, 100);
    assert.equal(report.conversation.messages, 40);
    assert.ok(report.conversation.scrollTop + report.conversation.clientHeight >= report.conversation.scrollHeight - 60);
    assert.ok(report.failed.gated && report.failed.reducedMotion && report.failed.fits && report.retried);
    assert.ok(report.lightTheme.applied && report.lightTheme.lightSurfaces && report.lightTheme.darkText && report.lightTheme.spinnerStopped);
    assert.equal(report.continued.result, false);
    assert.equal(report.continued.gated, false);
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(tmpdir()));
    assert.ok(path.basename(fixture).startsWith("mefi-startup-render-"));
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
