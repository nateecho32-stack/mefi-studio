// The shell's layout contract in a real renderer: a copied booklet and a
// synthetic bridge (tests/fixtures/layout-contract-electron.cjs). v1 must give
// back, to the hundredth of a pixel, the geometry recorded on the base commit
// (tests/fixtures/layout-contract-v1.json); v2 with sample regions must keep
// every page clear of them. Set MEFI_LAYOUT_CAPTURE_DIR to an absolute folder
// to keep the screenshots; set MEFI_LAYOUT_RECORD_TO to an absolute file path
// to write a new v1 record instead of comparing (only ever on purpose).
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

test("the layout contract keeps v1 where it was, and in v2 keeps every page clear of the list, the inspector, the tab strip and the status bar", { skip: !canRun, timeout: 780000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-layout-render-"));
  try {
    await mkdir(path.join(fixture, "renderer")); await mkdir(path.join(fixture, "data"));
    const sources = (await readdir(path.join(studio, "renderer"))).filter((name) => /\.(?:js|css)$/.test(name) || name === "booklet.template.html");
    await Promise.all(sources.map((name) => copyFile(path.join(studio, "renderer", name), path.join(fixture, "renderer", name))));
    await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
    await build({ root: fixture });
    const env = { ...process.env, MEFI_LAYOUT_FIXTURE: fixture }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "layout-contract-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-18000); });
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill());
      } else child.kill();
    }, 760000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch {}
    const artifacts = process.env.MEFI_LAYOUT_CAPTURE_DIR;
    if (artifacts && path.isAbsolute(artifacts)) {
      await mkdir(artifacts, { recursive: true });
      const files = (await readdir(fixture)).filter((name) => name === "report.json" || name.endsWith(".png"));
      await Promise.all(files.map((name) => copyFile(path.join(fixture, name), path.join(artifacts, name))));
      t.diagnostic(`Layout screenshots: ${artifacts}`);
    }
    assert.equal(code, 0, `${report?.failure || "No renderer report"}\n${output}`);
    assert.deepEqual(report.errors, []); assert.deepEqual(report.networkAttempts, []); assert.deepEqual(report.processAttempts, []);
    assert.ok(report.complete, "the fixture ran to its end");
    if (process.env.MEFI_LAYOUT_RECORD_TO) return;
    assert.ok(report.v1Identical, "v1 reproduces the recorded geometry");
    assert.ok(report.v2.checked, "v2 was measured too");
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(tmpdir()));
    assert.ok(path.basename(fixture).startsWith("mefi-layout-render-"));
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
