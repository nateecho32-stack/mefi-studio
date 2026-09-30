// The hidden capture window in a real Chromium (tests/fixtures/evidence-capture-electron.cjs):
// a local page becomes a non-blank PNG of exactly 1280 x 800, the window is hidden,
// sandboxed and without Node, nothing outside the preview's own origin is requested,
// a page that never answers is given up on, and no window is left behind.
// Set MEFI_EVIDENCE_CAPTURE_DIR to an absolute folder to keep report.json and the PNG.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const evidence = require("../scripts/attempt-evidence.cjs");
const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(studio, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const canRun = existsSync(executable) && (process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY));

test("a real offscreen capture of a local page is a non-blank 1280 x 800 PNG from a hidden, sandboxed window that reaches nothing else", { skip: !canRun, timeout: 180000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-evidence-"));
  try {
    const env = { ...process.env, MEFI_EVIDENCE_FIXTURE: fixture, MEFI_STUDIO_ROOT: studio };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "evidence-capture-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-12000); });
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill());
      } else child.kill();
    }, 160000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch { /* reported below */ }
    const keep = process.env.MEFI_EVIDENCE_CAPTURE_DIR;
    if (keep && path.isAbsolute(keep)) {
      await mkdir(keep, { recursive: true });
      for (const name of ["report.json", "preview.png"]) await copyFile(path.join(fixture, name), path.join(keep, name)).catch(() => {});
      t.diagnostic(`Evidence capture files: ${keep}`);
    }
    assert.equal(code, 0, `${report?.failure || "No fixture report"}\n${output}`);
    assert.deepEqual(report.errors, []);

    const shot = report.results.preview;
    assert.equal(shot.ok, true, shot.error);
    const png = await readFile(path.join(fixture, "preview.png"));
    assert.deepEqual(evidence.pngSize(png), { width: evidence.LIMITS.width, height: evidence.LIMITS.height }, "the file itself says 1280 x 800");
    assert.deepEqual([shot.decoded.width, shot.decoded.height], [1280, 800], "and so does the decoded image");
    assert.ok(shot.decoded.colors >= 20, `a real page has colours, not one flat fill (${shot.decoded.colors})`);
    assert.ok(shot.decoded.nonWhiteShare > 0.25, `most of the page is drawn (${shot.decoded.nonWhiteShare})`);
    assert.equal(evidence.keepable(png.length), true, "and small enough to keep");

    assert.ok(report.windows.length >= 1);
    for (const window of report.windows) {
      assert.deepEqual(window, { visible: false, focusable: false, offscreen: true, sandbox: true, nodeIntegration: false, contextIsolation: true, preload: false }, "hidden, unfocusable, offscreen, sandboxed, no Node, isolated, no preload");
    }
    assert.deepEqual(report.hits.other, [], "the image, the script, the fetch and the redirect on the page reached nothing outside the preview's own origin");
    assert.equal(report.results.redirect.ok, false, "a redirect to another origin is stopped");
    assert.equal(report.results.stuck.ok, false);
    assert.match(report.results.stuck.error, /timed out/);
    assert.ok(report.results.stuck.ms < 8000, `given up on at the limit (${report.results.stuck.ms} ms)`);
    assert.deepEqual([report.results.remote.ok, report.results.remote.windowsMade], [false, 0], "an address that is not this PC's own opens no window");
    assert.deepEqual([report.results.mismatch.ok, report.results.mismatch.windowsMade], [false, 0], "nor does one that is not the origin it was planned for");
    assert.equal(report.results.windowsAfterPreview, 0, "the window is gone after the shot");
    assert.equal(report.results.windowsAtEnd, 0, "and none is left at the end");
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(tmpdir()));
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
