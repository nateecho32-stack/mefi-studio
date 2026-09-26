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
test("tree shape, music and video controls transform real painted nodes while retaining graph anchors", { skip: !canRun, timeout: 90000 }, async t => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-tree-dynamics-"));
  try {
    await mkdir(path.join(fixture, "renderer")); await mkdir(path.join(fixture, "data"));
    const files = (await readdir(path.join(studio, "renderer"))).filter(n => /\.(js|css)$/.test(n) || n === "booklet.template.html");
    await Promise.all(files.map(n => copyFile(path.join(studio, "renderer", n), path.join(fixture, "renderer", n))));
    await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
    await build({ root: fixture });
    const env = { ...process.env, MEFI_COMMAND_RENDER_FIXTURE: fixture, MEFI_TREE_DYNAMICS_CAPTURE: "1" }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "command-render-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-12000); });
    const timer = setTimeout(() => child.kill(), 65000);
    const code = await new Promise((resolve, reject) => { child.once("close", resolve); child.once("error", reject); }).finally(() => clearTimeout(timer));
    let report; try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch {}
    const capture = process.env.MEFI_TREE_DYNAMICS_OUTPUT;
    if (capture && path.isAbsolute(capture)) {
      await mkdir(capture, { recursive: true });
      for (const name of (await readdir(fixture)).filter(n => n.endsWith(".png") || n === "report.json")) await copyFile(path.join(fixture, name), path.join(capture, name));
      t.diagnostic(`Tree captures: ${capture}`);
    }
    assert.equal(code, 0, `${report?.failure || "No tree report"}\n${output}`);
    assert.ok(report.treeDynamics.count >= 3);
    assert.deepEqual(report.errors, []); assert.deepEqual(report.networkAttempts, []); assert.deepEqual(report.processAttempts, []);
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(tmpdir())); assert.ok(path.basename(fixture).startsWith("mefi-tree-dynamics-"));
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
