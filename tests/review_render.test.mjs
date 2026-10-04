// The review section of a task's Evidence tab in a real renderer: the booklet built from the copied
// renderer sources, the real tasks.js and studio-ui.js, and a synthetic bridge for the host's answers
// (tests/fixtures/review-render-electron.cjs). Set MEFI_REVIEW_CAPTURE_DIR to an absolute folder to keep
// the screenshots and the report.
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

test("the review section in the real Tasks page: changed files, diff as text, Accept, two-press Revert with Undo, checks, shots, switches, pushes, and three window sizes without overflow, a scroller of its own or text under 12 px", { skip: !canRun, timeout: 240000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-review-render-"));
  try {
    await mkdir(path.join(fixture, "renderer")); await mkdir(path.join(fixture, "data"));
    const files = (await readdir(path.join(studio, "renderer"))).filter((name) => /\.(?:js|css)$/.test(name) || name === "booklet.template.html");
    await Promise.all(files.map((name) => copyFile(path.join(studio, "renderer", name), path.join(fixture, "renderer", name))));
    await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
    await build({ root: fixture });
    const env = { ...process.env, MEFI_REVIEW_FIXTURE: fixture };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "review-render-electron.cjs")], { cwd: fixture, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-14000); });
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill());
      } else child.kill();
    }, 200000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch { /* reported below */ }
    const artifacts = process.env.MEFI_REVIEW_CAPTURE_DIR;
    if (artifacts && path.isAbsolute(artifacts)) {
      await mkdir(artifacts, { recursive: true });
      const kept = (await readdir(fixture)).filter((name) => name === "report.json" || name.endsWith(".png"));
      await Promise.all(kept.map((name) => copyFile(path.join(fixture, name), path.join(artifacts, name))));
      t.diagnostic(`Review screenshots: ${artifacts}`);
    }
    assert.equal(code, 0, `${report?.failure || "No fixture report"}\n${output}`);
    assert.deepEqual(report.errors, []); assert.deepEqual(report.networkAttempts, []); assert.deepEqual(report.processAttempts, []);
    assert.ok(report.complete);
    assert.equal(report.idleHasSection, false, "a task no worker touched has no review section");
    assert.equal(report.heading, "Changes and checks · 6 files changed");
    assert.ok(report.layouts.length >= 9, `the section was inspected ${report.layouts.length} times`);
    assert.ok(report.layouts.every((layout) => !layout.pageOverflow && !layout.clipped.length && !layout.tiny.length && !layout.scrollers.length), JSON.stringify(report.layouts.filter((layout) => layout.pageOverflow || layout.clipped.length || layout.tiny.length || layout.scrollers.length)));
  } finally {
    assert.ok(path.dirname(fixture) === path.resolve(tmpdir()) && path.basename(fixture).startsWith("mefi-review-render-"));
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
      .catch((error) => t.diagnostic(`fixture folder left behind (${error.code ?? error.message}): ${fixture}`));
  }
});
