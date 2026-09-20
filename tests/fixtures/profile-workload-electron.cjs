"use strict";

const { app, BrowserWindow, ipcMain, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_PROFILE_WORKLOAD;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated workload directory is required");
const config = JSON.parse(fs.readFileSync(path.join(root, "workload.json"), "utf8"));
const report = { schemaVersion: 1, configuration: { ...config, rendering: "Electron offscreen, software rendering, 1280x900, 60Hz callback target; Command draws about 30Hz", note: "Synthetic task graph rendered by production code; no injected stalls. Timings are diagnostic, not performance assertions." }, scenarios: [], errors: [], networkAttempts: [], processAttempts: [] };
const started = Date.now();
app.setName("Studio Isolated Performance Workload");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath(name, directory);
}
app.disableHardwareAcceleration();
const childProcess = require("node:child_process");
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[method] = () => {
  report.processAttempts.push(method);
  throw new Error("Child processes are disabled in the isolated performance workload");
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  if (error) report.failure = error.stack || String(error);
  report.elapsedMs = Date.now() - started;
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  if (error) console.error(report.failure);
  app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);
// The next scenario opens a fresh renderer after destroying the previous one.
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url);
    if (details.url.startsWith("file:")) {
      const relative = path.relative(root, fileURLToPath(details.url));
      allowed = !relative.startsWith("..") && !path.isAbsolute(relative);
    }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const { createPerformanceProfiler } = require(path.join(root, "scripts", "performance-profiler.cjs"));
  const hostProfiler = createPerformanceProfiler({ getAppMetrics: () => app.getAppMetrics() });
  hostProfiler.attachIpc(ipcMain);
  ipcMain.handle("performance:control", (event, request) => hostProfiler.control(request?.action, event.sender));
  ipcMain.handle("performance:snapshot", () => ({ ok: true, ...hostProfiler.snapshot() }));
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8"));
  for (const name of config.scenarios) {
    const [, countText, view] = name.split("-");
    const count = Number(countText), now = Date.now();
    const tasks = Array.from({ length: count }, (_, index) => ({ id: `profile_task_${index}`, title: `Workload task ${index + 1}: verify a representative change`, status: "open", createdAt: now - index * 1000, updatedAt: now, dependsOn: index > 4 ? [`profile_task_${Math.floor((index - 1) / 3)}`] : [] }));
    const sessions = Array.from({ length: count === 150 ? 8 : 2 }, (_, index) => ({ id: `profile_session_${index}`, title: `Project session ${index + 1}`, timeCreated: now - 10000, timeUpdated: now - index * 1000 }));
    const todos = sessions.flatMap((session) => Array.from({ length: count === 150 ? 16 : 6 }, (_, index) => ({ id: `${session.id}_todo_${index}`, sessionId: session.id, position: index, content: `Representative work item ${index + 1}`, status: index === 0 ? "in_progress" : "pending" })));
    const agents = [{ role: "reference", status: "running", target: { kind: "task", id: "profile_task_0" } }, { role: "auditor", status: "running", target: { kind: "task", id: "profile_task_1" } }];
    const responses = {
      eyesState: { ok: true, sessions, todos, changes: [], pngs: [] },
      tasksList: { ok: true, tasks }, ideasList: { ok: true, ideas: [] }, prefsGet: { ok: true, prefs: { commandHome: false } },
      assistantState: { ok: true, state: { status: "running", agents, organization: { policy: { maxSessions: 8, maxTodosPerSession: 16 } }, messages: [], prefs: {}, work: [] } },
      assistantStatus: { ok: true, status: { enabled: false, execute: false, parallel: 2, running: [{ taskId: "profile_task_2", title: "Fixture builder", startedAt: now }], history: [] } },
      eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] },
      backlogStatus: { ok: true, counts: { ready: count, running: 0, verifying: 0, blocked: 0 }, next: [] }, speedMeasurements: { ok: true, measurements: {} }, readCatalog: catalog,
    };
    const preload = path.join(root, `${name}-preload.cjs`);
    fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');const responses=${JSON.stringify(responses)};
      contextBridge.exposeInMainWorld('mefiStudio',{
        ...Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]])),
        performanceControl:request=>ipcRenderer.invoke('performance:control',request),performanceSnapshot:()=>ipcRenderer.invoke('performance:snapshot')
      });
      for(const key of ['zen','zenReactive','commandHome'])localStorage.setItem('mefiStudio.'+key,'0');
    `);
    const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
    const contents = window.webContents;
    contents.setFrameRate(60);
    contents.setAudioMuted(true);
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("console-message", (_event, detail, oldMessage) => {
      const level = typeof detail === "object" ? detail.level : detail;
      if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage));
    });
    contents.on("render-process-gone", (_event, detail) => finish(new Error(`Renderer exited: ${detail.reason}`)));
    const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
    // A starved compositor can reject a single frame grab with UnknownVizError
    // while the page itself stays healthy; poll for a frame instead of failing.
    const capturePage = async () => {
      const deadline = Date.now() + 30000;
      for (;;) {
        try { return await contents.capturePage(); } catch (error) {
          if (!/UnknownVizError/i.test(String(error?.message ?? error)) || Date.now() > deadline) throw error;
          await sleep(120);
        }
      }
    };
    await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
    await run(`window.MefiNav.go('command');await window.MefiIdle.ready();window.MefiIdle.setView(${JSON.stringify(view)});window.MefiIdle.setOrbit('auto');window.MefiIdle.setMusicReactive(false);window.MefiProfiler.close();`);
    await sleep(config.warmupMs);
    const before = await run("return {status:window.MefiIdle.status(),geometry:window.MefiIdle.geometryStatus(),nodes:window.MefiIdle.debugNodes()};");
    assert.ok(before.nodes.filter((node) => Number.isFinite(node.x)).length >= (count === 150 ? 140 : 25), `${name}: populated fixture graph must actually paint (${before.nodes.length} nodes)`);
    assert.deepEqual(report.errors, []);
    await run("await window.MefiProfiler.start();");
    await sleep(config.durationMs);
    const measured = await run("await window.MefiProfiler.stop();return {capture:window.MefiProfiler.snapshot(),geometry:window.MefiIdle.geometryStatus(),panelClosed:document.getElementById('profiler-overlay').hidden};");
    assert.ok(measured.panelClosed && !measured.capture.renderer.recording && measured.capture.renderer.frameCount > 0, "A real stopped capture with the panel closed is required");
    assert.ok(measured.capture.renderer.spans.some((span) => span.name === "command.frame" && span.count > 0), "Production Command rendering scopes must be measured");
    const sample = { name, taskCount: count, sessionCount: sessions.length, todoCount: todos.length, view, paintedNodes: before.nodes.length, paintedKinds: Object.fromEntries([...new Set(before.nodes.map((node) => node.kind))].map((kind) => [kind, before.nodes.filter((node) => node.kind === kind).length])), rotating: Math.abs(before.geometry.angle - measured.geometry.angle) > 0.001, capture: measured.capture };
    report.scenarios.push(sample);
    const renderer = sample.capture.renderer;
    console.log(`${name}: frame p95 ${renderer.frameStats.p95Ms.toFixed(2)} ms, ${renderer.hitchCount} hitches; ${renderer.spans.slice(0, 5).map((span) => `${span.name} self ${span.selfMeanMs.toFixed(3)} ms (${span.count} calls)`).join('; ')}`);
    if (config.capture) {
      // Let the compositor publish the stopped HUD before saving visual evidence.
      // The numeric capture is already frozen, so this cannot affect its timings.
      await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
      fs.writeFileSync(path.join(root, `${name}.png`), (await capturePage()).toPNG());
    }
    window.destroy();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.networkAttempts, []);
  assert.deepEqual(report.processAttempts, []);
  finish();
}).catch(finish);
