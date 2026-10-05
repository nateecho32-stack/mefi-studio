// The Map in the 0.5 layout, in a real renderer: a copied booklet launched with ?layout=v2 and a synthetic bridge
// (tests/fixtures/map-render-electron.cjs). Set MEFI_MAP_CAPTURE_DIR to an absolute folder to keep the screenshots.
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

test("the Map in the 0.5 layout: the session list stays in the column, its bar (Map | Fleet | Pipelines, Running only, View ▾ with four groups) and the state colours over the tree, the switch on Fleet and Pipelines moves between the three by real pointer, nothing reads under 12 px, and the classic Command view untouched", { skip: !canRun, timeout: 360000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-map-render-"));
  try {
    await mkdir(path.join(fixture, "renderer")); await mkdir(path.join(fixture, "data"));
    const sources = (await readdir(path.join(studio, "renderer"))).filter((name) => /\.(?:js|css)$/.test(name) || name === "booklet.template.html");
    await Promise.all(sources.map((name) => copyFile(path.join(studio, "renderer", name), path.join(fixture, "renderer", name))));
    await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
    await build({ root: fixture });
    const env = { ...process.env, MEFI_MAP_FIXTURE: fixture }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "map-render-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-18000); });
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill());
      } else child.kill();
    }, 340000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch {}
    const artifacts = process.env.MEFI_MAP_CAPTURE_DIR;
    if (artifacts && path.isAbsolute(artifacts)) {
      await mkdir(artifacts, { recursive: true });
      const files = (await readdir(fixture)).filter((name) => name === "report.json" || name.endsWith(".png"));
      await Promise.all(files.map((name) => copyFile(path.join(fixture, name), path.join(artifacts, name))));
      t.diagnostic(`Map screenshots: ${artifacts}`);
    }
    assert.equal(code, 0, `${report?.failure || "No renderer report"}\n${output}`);
    assert.deepEqual(report.errors, []); assert.deepEqual(report.networkAttempts, []); assert.deepEqual(report.processAttempts, []);
    assert.equal(report.pages.length, 3, "the Map, Fleet and Pipelines were each opened from a switch");
    assert.ok(report.shots.length >= 4, `the screenshots were taken (${report.shots.length})`);
    assert.ok(report.complete, "the fixture ran to its end");
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(tmpdir()));
    assert.ok(path.basename(fixture).startsWith("mefi-map-render-"));
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
