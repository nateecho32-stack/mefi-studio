// Real renderer integration, using only a copied booklet and synthetic bridge.
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

test("Home, Work and Live retain task context with distinct preview readiness and usable completion actions", { skip: !canRun, timeout: 95000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-workflow-render-"));
  try {
    await mkdir(path.join(fixture, "renderer")); await mkdir(path.join(fixture, "data"));
    const sources = (await readdir(path.join(studio, "renderer"))).filter((name) => /\.(?:js|css)$/.test(name) || name === "booklet.template.html");
    await Promise.all(sources.map((name) => copyFile(path.join(studio, "renderer", name), path.join(fixture, "renderer", name))));
    await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
    await build({ root: fixture });
    const env = { ...process.env, MEFI_WORKFLOW_RENDER_FIXTURE: fixture }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "workflow-render-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-18000); });
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill());
      } else child.kill();
    }, 65000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch {}
    const artifacts = process.env.MEFI_WORKFLOW_CAPTURE_DIR;
    if (artifacts && path.isAbsolute(artifacts)) {
      await mkdir(artifacts, { recursive: true });
      const files = (await readdir(fixture)).filter((name) => name === "report.json" || name.endsWith(".png"));
      await Promise.all(files.map((name) => copyFile(path.join(fixture, name), path.join(artifacts, name))));
      t.diagnostic(`Workflow screenshots: ${artifacts}`);
    }
    assert.equal(code, 0, `${report?.failure || "No renderer report"}\n${output}`);
    assert.deepEqual(report.errors, []); assert.deepEqual(report.networkAttempts, []); assert.deepEqual(report.processAttempts, []);
    assert.ok(report.previewWhileBuilding && report.contextRoundTrip && report.fullBrief && report.requestChangeDraft && report.newTaskPreservesDraft && report.startScoped);
    assert.ok(report.defaultCollapsed);
    assert.ok(report.attentionReachable && report.attentionNavigated);
    assert.deepEqual(report.conversationLayouts.map((layout) => layout.width), [1440, 1100, 600]);
    for (const layout of report.conversationLayouts) assert.ok(layout.before.visible && layout.before.controls && layout.before.gap>=0 && layout.before.gap<=40 && layout.stationary && layout.scroll.moved && layout.scroll.outerStable && layout.oldestReachable && layout.latestReachable && layout.progressReachable && layout.drawerReachable && layout.draftIntact && layout.noOverflow, JSON.stringify(layout));
    assert.deepEqual(report.layouts.map((layout) => layout.width), [1440, 1100, 600]);
    for (const layout of report.layouts) assert.ok(!layout.homeOverflow && !layout.workOverflow && layout.checksReachable && layout.homeReachable && layout.inputReachable && layout.sendReachable && layout.workReachable && layout.compactDefault && layout.previewControlsReachable && layout.authoringLayout.correct && layout.initialComposerVisible, JSON.stringify(layout));
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(tmpdir()));
    assert.ok(path.basename(fixture).startsWith("mefi-workflow-render-"));
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
