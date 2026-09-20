"use strict";

const { app, BrowserWindow, ipcMain, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_PERFORMANCE_RENDER_FIXTURE;
const desktopHost = process.env.MEFI_PERFORMANCE_DESKTOP_HOST === "1";
if (!root || !path.isAbsolute(root)) throw new Error("An isolated performance renderer fixture directory is required");
const started = Date.now();
const report = { errors: [], networkAttempts: [], processAttempts: [] };
app.setName("Studio Performance Renderer Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath(name, directory);
}
app.disableHardwareAcceleration();
const childProcess = require("node:child_process");
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  childProcess[method] = () => { report.processAttempts.push(method); throw new Error("Child process execution is disabled in the performance fixture"); };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
const finish = (error) => {
  if (finished) return;
  finished = true;
  if (error) report.failure = error.stack || String(error);
  report.elapsedMs = Date.now() - started;
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  if (error) console.error(error.stack || error);
  else console.log(`Performance renderer fixture passed in ${report.elapsedMs}ms`);
  app.exit(error ? 1 : 0);
};
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);

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
  let hostProfiler;
  if (desktopHost) {
    const { createPerformanceProfiler } = require(path.join(root, "scripts", "performance-profiler.cjs"));
    hostProfiler = createPerformanceProfiler({ getAppMetrics: () => app.getAppMetrics() });
    hostProfiler.attachIpc(ipcMain);
    ipcMain.handle("performance:control", (event, request) => hostProfiler.control(request?.action, event.sender));
    ipcMain.handle("performance:snapshot", () => ({ ok: true, ...hostProfiler.snapshot() }));
    ipcMain.handle("fixture:measured", async (_event, payload) => {
      await sleep(120);
      const deadline = performance.now() + 100;
      while (performance.now() < deadline) { /* Deliberately stall this isolated host. */ }
      return { ok: true, received: payload };
    });
  }
  const now = Date.now();
  const responses = {
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] },
    tasksList: { ok: true, tasks: [{ id: "performance_fixture", title: "Check performance capture", status: "open", createdAt: now, updatedAt: now }] },
    ideasList: { ok: true, ideas: [] },
    prefsGet: { ok: true, prefs: { commandHome: false } },
    assistantState: { ok: true, state: { status: "paused", agents: [], messages: [], prefs: {}, work: [] } },
    assistantStatus: { ok: true, status: { enabled: false, execute: false, parallel: 1, running: [], history: [] } },
    eyesCheckpointsRead: { ok: true, checkpoints: {} },
    eyesRequestsRead: { ok: true, requests: [] },
    eyesBriefingRead: { ok: true, briefing: null },
    eyesCollisions: { ok: true, collisions: [], presence: [] },
    backlogStatus: { ok: true, counts: { ready: 1, running: 0, verifying: 0, blocked: 0 }, next: [] },
    speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
  };
  const preload = path.join(root, "read-only-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require("electron");
    const responses=${JSON.stringify(responses)};
    contextBridge.exposeInMainWorld("mefiStudio",{
      ...Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]]))
      ${desktopHost ? `,performanceControl:request=>ipcRenderer.invoke("performance:control",request),
      performanceSnapshot:()=>ipcRenderer.invoke("performance:snapshot")` : ""}
    });
    ${desktopHost ? `contextBridge.exposeInMainWorld("performanceFixture",{request:payload=>ipcRenderer.invoke("fixture:measured",payload)});` : ""}
    localStorage.setItem("mefiStudio.zen","0");
    localStorage.setItem("mefiStudio.zenReactive","0");
    localStorage.setItem("mefiStudio.commandHome","0");
  `);
  const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents;
  contents.setAudioMuted(true);
  contents.setFrameRate(60);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => {
    const level = typeof detail === "object" ? detail.level : detail;
    if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage));
  });
  contents.on("render-process-gone", (_event, detail) => finish(new Error(`Renderer exited: ${detail.reason}`)));
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (expression, label) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      assert.deepEqual(report.errors, [], `Renderer errors before ${label}: ${JSON.stringify(report.errors)}`);
      if (await run(`return Boolean(${expression});`)) return;
      await sleep(35);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const downloadCapture = async () => {
    const download = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Profiler JSON download timed out")), 5000);
      session.defaultSession.once("will-download", (_event, item) => {
        item.setSavePath(path.join(root, "capture.json"));
        item.once("done", (_downloadEvent, state) => {
          clearTimeout(timeout);
          if (state === "completed") resolve();
          else reject(new Error(`Profiler JSON download ${state}`));
        });
      });
    });
    await run("document.getElementById('profiler-export').click();");
    await download;
    return JSON.parse(fs.readFileSync(path.join(root, "capture.json"), "utf8"));
  };
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await until("window.MefiProfiler && window.MefiNav", "profiler and navigation startup");
  await run("window.MefiNav.go('profiler');");
  await until("!document.getElementById('profiler-overlay').hidden", "profiler opens from navigation");
  assert.equal(await run("return window.MefiProfiler.snapshot().renderer.recording;"), false, "opening the panel never starts profiling implicitly");
  await run("document.getElementById('profiler-start').click();");
  await until("window.MefiProfiler.snapshot().renderer.frameCount>=4", "real frame samples");
  report.sampledFrames = await run("return window.MefiProfiler.snapshot().renderer.frameCount;");
  if (desktopHost) {
    const secret = "synthetic-private-fixture-payload-8f930d";
    const received = await run(`return window.performanceFixture.request({token:${JSON.stringify(secret)},taskText:'PRIVATE FIXTURE TASK',path:${JSON.stringify(root)}});`);
    assert.equal(received.received.token, secret, "the measured IPC still delivers its original result");
    await until("window.MefiProfiler.snapshot().host?.samples.length>=2 && window.MefiProfiler.snapshot().host.samples.some(row=>Number.isFinite(row.cpuPercent))", "warm real Electron CPU samples");
    report.capture = await run("return window.MefiProfiler.snapshot();");
    const samples = report.capture.host.samples;
    const warmed = samples.find((row) => Number.isFinite(row.cpuPercent));
    assert.ok(warmed && warmed.cpuPercent >= 0 && warmed.rssMB > 0 && Number.isFinite(warmed.hostLagMs), "actual host CPU, memory and lag are measured");
    assert.ok(warmed.processes.length >= 2 && warmed.processes.every((row) => Number.isFinite(row.cpuPercent) && row.memoryMB > 0), "Electron process rows contain real CPU and working sets");
    report.hostSamples = samples.length;
    report.processMetricsMeasured = true;
    const request = report.capture.host.spans.find((row) => row.name === "fixture:measured");
    assert.ok(request && request.count === 1 && request.meanMs >= 210 && request.errors === 0, "real IPC is timed including asynchronous waiting");
    assert.ok(report.capture.host.incidents.some((row) => row.kind === "slow-ipc" && row.name === "fixture:measured"), "slow IPC reaches incident diagnostics");
    assert.ok(!report.capture.host.spans.some((row) => row.name.startsWith("performance:")), "profiler controls do not measure themselves");
    report.ipcMeasured = true;
    await until("document.getElementById('profiler-ipc').textContent.includes('fixture:measured') && document.getElementById('profiler-processes').textContent.includes('Browser')", "real host diagnostics render into the panel");
    await run("await window.MefiProfiler.stop();");
    const stopped = await run("return window.MefiProfiler.snapshot();");
    assert.equal(stopped.host.recording, false);
    const stoppedHost = hostProfiler.snapshot();
    await sleep(1150);
    assert.deepEqual(hostProfiler.snapshot(), stoppedHost, "stopping cancels real host sampling across its next interval");
    assert.deepEqual(await run("return window.MefiProfiler.snapshot();"), stopped, "stopping freezes the combined renderer and host capture");
    report.hostFrozen = true;
    const exported = await downloadCapture();
    assert.deepEqual(exported, stopped, "downloaded desktop capture retains measured process and IPC rows");
    const json = JSON.stringify(exported);
    for (const privateValue of [secret, "PRIVATE FIXTURE TASK", root, "Check performance capture"]) {
      assert.ok(!json.includes(JSON.stringify(privateValue).slice(1, -1)), "capture excludes IPC payloads, results, task text and paths");
    }
    assert.ok(exported.host.samples.every((row) => row.processes.every((process) => !Object.hasOwn(process, "pid"))), "process identifiers do not leave the host profiler");
    report.payloadExcluded = true;
    report.exportedCapture = true;
    fs.writeFileSync(path.join(root, "profiler-host.png"), (await contents.capturePage()).toPNG());
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.networkAttempts, []);
    assert.deepEqual(report.processAttempts, []);
    finish();
    return;
  }
  await run(`
    const busy=milliseconds=>{const until=performance.now()+milliseconds;while(performance.now()<until){}};
    window.MefiProfiler.measure('fixture.outer',()=>{
      busy(30);
      window.MefiProfiler.measure('fixture.inner',()=>busy(120));
      busy(30);
    });
  `);
  await until("window.MefiProfiler.snapshot().renderer.longTaskCount>0 && window.MefiProfiler.snapshot().renderer.frameStats.maxMs>=80", "blocking work reaches frame and long-task diagnostics");
  report.capture = await run("return window.MefiProfiler.snapshot();");
  const inner = report.capture.renderer.spans.find((row) => row.name === "fixture.inner");
  const outer = report.capture.renderer.spans.find((row) => row.name === "fixture.outer");
  assert.ok(inner && outer && inner.count === 1 && outer.count === 1, "named nested measurements are retained");
  assert.ok(inner.totalMs >= 115 && outer.totalMs >= inner.totalMs + 55, "real busy work reaches inclusive scope timings");
  assert.ok(Math.abs(outer.selfMs - (outer.totalMs - inner.totalMs)) < 2 && inner.selfMs === inner.totalMs,
    "outer self time excludes child work, avoiding double counting");
  report.namedScopesMeasured = true;
  assert.ok(report.capture.renderer.incidents.some((item) => item.kind === "long-task" && item.durationMs >= 80));
  assert.ok(report.capture.renderer.frameStats.maxMs >= 80, "the blocked UI produces a slow frame");
  report.longTaskDetected = true;
  await until("document.getElementById('profiler-spans').textContent.includes('fixture.outer') && document.getElementById('profiler-incidents').textContent.length>0", "captured measurements render into the panel");
  await run("document.getElementById('profiler-close').click();");
  await until("document.getElementById('profiler-overlay').hidden && !document.getElementById('profiler-hud').hidden", "closing a recording panel leaves the live HUD");
  await run("document.getElementById('profiler-hud').click();");
  await until("!document.getElementById('profiler-overlay').hidden", "HUD reopens the profiler");
  await run("document.getElementById('profiler-stop').click();");
  await until("!window.MefiProfiler.snapshot().renderer.recording", "stop freezes the capture");
  const stopped = await run("return window.MefiProfiler.snapshot().renderer;");
  await sleep(300);
  await run("window.MefiProfiler.measure('fixture.afterStop',()=>42);");
  assert.deepEqual(await run("return window.MefiProfiler.snapshot().renderer;"), stopped,
    "frames, elapsed time, incidents and scopes remain stable after stop");
  report.captureFrozen = true;
  const exported = await downloadCapture();
  assert.equal(exported.schemaVersion, 1);
  assert.deepEqual(exported.renderer, stopped, "the downloaded JSON preserves the frozen capture");
  assert.equal(exported.host, null, "renderer-only profiling works when the host bridge is unavailable");
  assert.ok(!JSON.stringify(exported).includes("Check performance capture"), "exports do not copy task text");
  report.exportedCapture = true;
  await sleep(300);
  const chart = await run(`
    const canvas=document.getElementById('profiler-chart');
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let colored=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]&&Math.max(pixels[i],pixels[i+1],pixels[i+2])>60)colored++;
    return {width:canvas.width,height:canvas.height,colored};
  `);
  assert.ok(chart.width > 0 && chart.height > 0 && chart.colored > 40, "the frame chart paints real canvas pixels");
  fs.writeFileSync(path.join(root, "profiler-wide.png"), (await contents.capturePage()).toPNG());
  window.setContentSize(600, 840);
  await sleep(350);
  report.narrowLayout = await run(`
    const panel=document.getElementById('profiler-overlay'),rect=panel.getBoundingClientRect();
    const controls=['profiler-start','profiler-stop','profiler-reset','profiler-export','profiler-close'].map(id=>{
      const button=document.getElementById(id),bounds=button.getBoundingClientRect();
      return {id,left:bounds.left,right:bounds.right,width:bounds.width};
    });
    return {width:innerWidth,overlayWidth:rect.width,overflow:document.documentElement.scrollWidth>innerWidth+1,controls};
  `);
  assert.ok(report.narrowLayout.overlayWidth <= 600 && !report.narrowLayout.overflow, "the profiler fits a 600px content window without page overflow");
  for (const button of report.narrowLayout.controls) {
    assert.ok(button.width > 0 && button.left >= 0 && button.right <= 600, `${button.id} remains reachable in the narrow layout`);
  }
  fs.writeFileSync(path.join(root, "profiler-narrow.png"), (await contents.capturePage()).toPNG());
  await run("document.getElementById('profiler-reset').click();");
  await until("window.MefiProfiler.snapshot().renderer.frameCount===0", "reset clears the stopped capture");
  const cleared = await run("return window.MefiProfiler.snapshot().renderer;");
  assert.equal(cleared.recording, false);
  assert.equal(cleared.startedAt, null);
  assert.equal(await run("return document.getElementById('profiler-export').disabled;"), true, "reset removes the empty export action");
  assert.deepEqual(cleared.spans, []);
  assert.deepEqual(cleared.incidents, []);
  assert.equal(cleared.longTaskCount, 0);
  report.resetCleared = true;
  await run("document.getElementById('profiler-start').click();");
  await until("window.MefiProfiler.snapshot().renderer.frameCount>=3", "second capture starts");
  // Offscreen BrowserWindows have no OS minimize state. Change only the
  // browser visibility signal; the frame clock and all samples remain real.
  const hiddenAt = await run(`
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
    return window.MefiProfiler.snapshot().renderer.frameCount;
  `);
  await sleep(1100);
  assert.equal(await run("return window.MefiProfiler.snapshot().renderer.frameCount;"), hiddenAt,
    "hidden application time does not add artificial frames");
  await run(`
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  await until(`window.MefiProfiler.snapshot().renderer.frameCount>=${hiddenAt + 3}`, "sampling resumes after the app becomes visible");
  const resumed = await run("return window.MefiProfiler.snapshot().renderer;");
  assert.ok(resumed.frames.every((frame) => frame.durationMs < 1000), "the 1.1 second hidden gap is excluded from frame timings");
  report.hiddenGapExcluded = true;
  await run("await window.MefiProfiler.stop();");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.networkAttempts, []);
  assert.deepEqual(report.processAttempts, []);
  finish();
}).catch(finish);
