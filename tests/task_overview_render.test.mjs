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

test("task overview and delegated details show confirmed progress, navigate subtasks, and fit 600px", { skip: !canRun, timeout: 95000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-task-overview-render-"));
  try {
    await mkdir(path.join(fixture, "renderer")); await mkdir(path.join(fixture, "data"));
    const files = (await readdir(path.join(studio, "renderer"))).filter((name) => /\.(?:js|css)$/.test(name) || name === "booklet.template.html");
    await Promise.all(files.map((name) => copyFile(path.join(studio, "renderer", name), path.join(fixture, "renderer", name))));
    await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
    await build({ root: fixture });
    const env = { ...process.env, MEFI_TASK_OVERVIEW_FIXTURE: fixture };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "task-overview-render-electron.cjs")], { cwd: fixture, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-12000); });
    const timer = setTimeout(() => child.kill(), 35000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch {}
    const artifacts = process.env.MEFI_TASK_OVERVIEW_CAPTURE_DIR;
    if (artifacts && path.isAbsolute(artifacts)) {
      await mkdir(artifacts, { recursive: true });
      await Promise.all(["report.json", "task-overview-wide.png", "task-overview-narrow.png", "task-overview-detail.png", "task-overview-discussion.png", "task-delegation-wide.png", "task-delegation-narrow.png"].filter((name) => existsSync(path.join(fixture, name))).map((name) => copyFile(path.join(fixture, name), path.join(artifacts, name))));
      t.diagnostic(`Task overview screenshots: ${artifacts}`);
    }
    assert.equal(code, 0, `${output}\n${report?.failure || "No fixture report"}`);
    assert.deepEqual(report.errors, []); assert.deepEqual(report.networkAttempts, []); assert.deepEqual(report.processAttempts, []);
    assert.equal(report.rawTaskCount, 95);
    assert.ok(report.confirmedProgress && report.discussionProgress && report.preservedSearch && report.originalDetail);
    assert.ok(report.narrowLayout.width <= 601 && !report.narrowLayout.overflow, JSON.stringify(report.narrowLayout));
    for (const detail of [report.delegationWide, report.delegationNarrow]) {
      assert.ok(detail.childAndParentNavigation && !detail.overflow);
      assert.equal(detail.links.length, 2);
      assert.match(detail.text, /1\/2 confirmed/);
    }
    assert.ok(report.delegationNarrow.width <= 601);
    assert.equal(Number(report.sharedOverview.value), 1);
    assert.equal(Number(report.sharedOverview.max), 3, "the parent integration step remains part of the shared goal");
  } finally {
    assert.ok(path.dirname(fixture) === path.resolve(tmpdir()) && path.basename(fixture).startsWith("mefi-task-overview-render-"));
    await rm(fixture, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});
