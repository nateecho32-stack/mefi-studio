// The tab strip in a real renderer: a copied booklet in layout v2, a synthetic bridge and a fixture-only stand-in for FRAME's
// tab region (tests/fixtures/tabs-render-electron.cjs). Five window sizes with a dozen tabs (nothing overflows, no scroller
// reserves width, no text under 12 px, menus stay inside the window), real pointer and keyboard input, real pages, the
// reload, v1 untouched, the host's switch, and Ctrl+W against the window's own menu. Set MEFI_TABS_CAPTURE_DIR to an
// absolute folder to keep the screenshots.
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

test("the tab strip fits, folds and menus at five window sizes, takes real input, opens real pages, survives a reload, and in v1 draws, stores and hears nothing", { skip: !canRun, timeout: 560000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-tabs-render-"));
  try {
    await mkdir(path.join(fixture, "renderer")); await mkdir(path.join(fixture, "data"));
    const sources = (await readdir(path.join(studio, "renderer"))).filter((name) => /\.(?:js|css)$/.test(name) || name === "booklet.template.html");
    await Promise.all(sources.map((name) => copyFile(path.join(studio, "renderer", name), path.join(fixture, "renderer", name))));
    await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
    await build({ root: fixture });
    const env = { ...process.env, MEFI_TABS_FIXTURE: fixture }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "tabs-render-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-18000); });
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill());
      } else child.kill();
    }, 540000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch {}
    const artifacts = process.env.MEFI_TABS_CAPTURE_DIR;
    if (artifacts && path.isAbsolute(artifacts)) {
      await mkdir(artifacts, { recursive: true });
      const files = (await readdir(fixture)).filter((name) => name === "report.json" || name.endsWith(".png"));
      await Promise.all(files.map((name) => copyFile(path.join(fixture, name), path.join(artifacts, name))));
      t.diagnostic(`Tab strip screenshots: ${artifacts}`);
    }
    assert.equal(code, 0, `${report?.failure || "No renderer report"}\n${output}`);
    assert.deepEqual(report.errors, [], "no console errors");
    assert.deepEqual(report.networkAttempts, []);
    assert.deepEqual(report.processAttempts, []);
    assert.ok(report.complete, "the fixture ran to its end");
    assert.deepEqual(Object.keys(report.sizes), ["1920x1080@1", "1440x900@1", "1100x720@1", "600x560@1", "600x560@1.5"], "all five window sizes were walked");
    assert.ok(report.v1Untouched, "v1 was checked");
    assert.equal(report.keys.ctrlWClosedATabNotTheWindow, true);
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(tmpdir()));
    assert.ok(path.basename(fixture).startsWith("mefi-tabs-render-"));
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
