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

test("Floating media renders borderless, reveals controls and retains its iframe through movement and navigation", { skip: !canRun, timeout: 75000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-media-render-"));
  try {
    await mkdir(path.join(fixture, "renderer")); await mkdir(path.join(fixture, "data"));
    const sources = (await readdir(path.join(studio, "renderer"))).filter(name => /\.(js|css)$/.test(name) || name === "booklet.template.html");
    await Promise.all(sources.map(name => copyFile(path.join(studio, "renderer", name), path.join(fixture, "renderer", name))));
    await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
    await build({ root: fixture });
    const env = { ...process.env, MEFI_MEDIA_RENDER_FIXTURE: fixture }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "media-window-render-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-16000); });
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill());
      } else child.kill();
    }, 55000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch {}
    const captures = process.env.MEFI_MEDIA_CAPTURE_DIR;
    if (captures && path.isAbsolute(captures)) {
      await mkdir(captures, { recursive: true });
      for (const name of (await readdir(fixture)).filter(name => name.endsWith(".png") || name === "report.json")) await copyFile(path.join(fixture, name), path.join(captures, name));
      t.diagnostic(`Media captures: ${captures}`);
    }
    assert.equal(code, 0, `${report?.failure || "No media report"}\n${output}`);
    assert.deepEqual(report.errors, []);
    assert.equal(report.playerLoads, 1, "one provider load across all movement, resizing, minimize and navigation");
    assert.ok(report.borderless && report.hover && report.drag && report.resize && report.dodge && report.follow && report.pin && report.minimize && report.closed);
    assert.deepEqual(report.layouts.map(layout => layout.width), [1440, 600]);
    assert.ok(report.layouts.every(layout => layout.contained && layout.controlsFit));
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(tmpdir()));
    assert.ok(path.basename(fixture).startsWith("mefi-media-render-"));
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
