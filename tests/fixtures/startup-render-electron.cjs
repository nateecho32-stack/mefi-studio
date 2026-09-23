"use strict";

const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_STARTUP_RENDER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated startup fixture directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [] };
app.setName("Studio Startup Renderer Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
}
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-prefers-reduced-motion", "reduce");
// Each scenario has a genuinely new renderer; closing one must not quit before
// the next cold launch. finish() owns the fixture's final exit.
app.on("window-all-closed", () => {});
const childProcess = require("node:child_process");
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  childProcess[method] = () => { report.processAttempts.push(method); throw new Error("Child process execution is disabled in the startup fixture"); };
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
const closeWindow = (window) => window.isDestroyed() ? Promise.resolve() : new Promise((resolve) => { window.once("closed", resolve); window.close(); });
async function finish(error) {
  if (finished) return; finished = true;
  const failures = error ? [error] : [];
  try {
    await Promise.all(BrowserWindow.getAllWindows().map(closeWindow));
    if (app.isReady()) { session.defaultSession.flushStorageData(); await session.defaultSession.closeAllConnections(); }
  } catch (shutdownError) { failures.push(shutdownError); }
  if (failures.length) report.failure = failures.map((failure) => failure.stack || String(failure)).join("\nShutdown also failed:\n");
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  if (report.failure) console.error(report.failure); else console.log("Startup loading fixture passed");
  process.exitCode = failures.length ? 1 : 0;
  app.quit();
}
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);

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
  const now = Date.now();
  const responses = {
    projectsList: { ok: true, activeId: "startup-project", projects: [{ id: "startup-project", name: "Startup fixture project", path: root }] },
    tasksList: { ok: true, projectId: "startup-project", tasks: [{ id: "startup-task", title: "Workspace loaded before access", status: "open", createdAt: now, updatedAt: now }] },
    ideasList: { ok: true, ideas: [] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] },
    prefsGet: { ok: true, prefs: { commandHome: true } },
    assistantState: { ok: true, state: { status: "paused", agents: [], messages: [], prefs: { paused: true }, work: [] } },
    assistantStatus: { ok: true, status: { enabled: false, execute: false, autoBuild: true, mode: "swarm", running: [], history: [] } },
    eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] },
    eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] },
    backlogStatus: { ok: true, projectId: "startup-project", counts: { ready: 1, running: 0, verifying: 0, blocked: 0 }, next: [] },
    speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
  };
  async function launch(mode, width = 1280) {
    const preload = path.join(root, `startup-${mode}-preload.cjs`);
    const fixtureResponses = mode === "delayed" ? {
      ...responses,
      assistantState: {
        ...responses.assistantState,
        state: {
          ...responses.assistantState.state,
          messages: Array.from({ length: 40 }, (_, index) => ({
            id: `synthetic-${index}`, role: "assistant", text: `Synthetic project update ${index}`, at: now + index,
          })),
        },
      },
    } : responses;
    fs.writeFileSync(preload, `const {contextBridge}=require('electron');
      const responses=${JSON.stringify(fixtureResponses)};
      let released=${mode !== "delayed"}, catalogReleased=${mode !== "delayed"}, failing=${mode !== "delayed"}, projectReads=0, release, releaseCatalog;
      const pending=new Promise(resolve=>{release=resolve}),catalogPending=new Promise(resolve=>{releaseCatalog=resolve});
      contextBridge.exposeInMainWorld('mefiStudio',Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>{
        if(key==='projectsList'){projectReads++;if(!released)await pending;if(failing)return {ok:false,error:'Fixture project read unavailable'};}
        if(key==='readCatalog'&&!catalogReleased)await catalogPending;
        return responses[key];
      }])));
      contextBridge.exposeInMainWorld('startupFixture',{
        releaseProjects:()=>{released=true;release();},releaseCatalog:()=>{catalogReleased=true;releaseCatalog();},allowProjects:()=>{failing=false;released=true;release();},projectReads:()=>projectReads
      });
      localStorage.setItem('mefiStudio.commandHome','1');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');
      ${mode === "delayed" ? "localStorage.removeItem('mefiStudio.walkthrough.v1');" : "localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));"}
    `);
    const window = new BrowserWindow({ show: false, width, height: 800, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
    const contents = window.webContents;
    contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("console-message", (_event, detail, oldMessage) => {
      const level = typeof detail === "object" ? detail.level : detail;
      if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage));
    });
    contents.on("render-process-gone", (_event, detail) => finish(new Error(`Startup renderer exited: ${detail.reason}`)));
    const run = (source) => contents.executeJavaScript(`(async()=>{${source}})()`, true);
    const until = async (condition, label) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        assert.deepEqual(report.errors, [], `Renderer errors while awaiting ${label}`);
        if (await run(`return Boolean(${condition});`)) return;
        await pause(30);
      }
      throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(await run("return window.MefiBoot?.state?.();"))}`);
    };
    const capture = async (name) => {
      if (!process.env.MEFI_STARTUP_CAPTURE_DIR) return;
      await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
      // Wait for the compositor itself rather than an arbitrary screenshot delay.
      let image;
      // Offscreen Chromium can already have a previous frame in flight. Drain
      // that frame and the next submission before keeping the stable image.
      for (let frame = 0; frame < 3; frame += 1) {
        // Match the fixture's 30Hz compositor cadence, allowing each queued
        // visual update to reach the offscreen surface before invalidating it.
        await pause(Math.ceil(1000 / 30));
        const painted = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Startup screenshot did not paint")), 5000);
          contents.once("paint", (_event, _dirty, next) => { clearTimeout(timer); resolve(next); });
        });
        contents.invalidate(); image = await painted;
      }
      fs.writeFileSync(path.join(root, name), image.toPNG());
    };
    // Deliberately no capture/smoke query: exercise the user's real cold launch.
    await window.loadFile(path.join(root, "renderer", "booklet.html"));
    await until("window.MefiBoot?.state && window.MefiBoot.isActive()", "startup gate");
    await run("window.__startupResult='pending';window.MefiBoot.ready().then(result=>{window.__startupResult=result;});");
    return { window, contents, run, until, capture };
  }

  const first = await launch("delayed");
  await first.until("window.MefiBoot.state().steps.filter(step=>step.status==='ready').length===3 && window.startupFixture.projectReads()>0", "completed independent startup steps");
  report.loading = await first.run(`
    const gate=document.getElementById('boot-layer'), workspace=document.getElementById('workspace-layer');
    const onboarding=document.getElementById('walkthrough-overlay');
    const state=window.MefiBoot.state();
    return {gated:window.MefiBoot.isActive()&&document.documentElement.hasAttribute('data-starting')&&getComputedStyle(gate).display!=='none',
      inert:workspace.inert||Boolean(workspace.closest('[inert]')),progress:state.progress,steps:state.steps,
      nativeProgress:document.getElementById('boot-progress').value,onboardingHidden:onboarding.hidden,
      workspaceHidden:getComputedStyle(workspace).visibility==='hidden'};
  `);
  assert.ok(report.loading.gated && report.loading.inert && report.loading.workspaceHidden && report.loading.onboardingHidden);
  assert.ok(report.loading.progress > 0 && report.loading.progress < 100);
  assert.equal(report.loading.nativeProgress, report.loading.progress);
  assert.equal(report.loading.progress, Math.floor(report.loading.steps.filter((step) => step.status === "ready").length / report.loading.steps.length * 100));
  await first.run("window.startupFixture.releaseCatalog();");
  await first.until("window.MefiBoot.state().steps.find(step=>step.id==='catalog')?.status==='ready'", "catalog release advances progress");
  report.catalogProgress = await first.run("return window.MefiBoot.state().progress;");
  assert.ok(report.catalogProgress > report.loading.progress && report.catalogProgress < 100);
  await first.capture("startup-loading.png");
  first.contents.sendInputEvent({ type: "mouseDown", x: 32, y: 32, button: "left", clickCount: 1 });
  first.contents.sendInputEvent({ type: "mouseUp", x: 32, y: 32, button: "left", clickCount: 1 });
  first.contents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  first.contents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  report.cannotSkip = await first.run("await new Promise(resolve=>requestAnimationFrame(resolve));return window.MefiBoot.isActive()&&window.__startupResult==='pending';");
  assert.ok(report.cannotSkip, "Clicks and Escape cannot bypass unfinished reads");
  await first.run("window.startupFixture.releaseProjects();");
  await first.until("!window.MefiBoot.isActive() && window.__startupResult===true", "actual startup completion");
  await first.until("!document.getElementById('walkthrough-overlay').hidden", "onboarding after startup");
  report.ready = await first.run(`
    const workspace=document.getElementById('workspace-layer');
    return {result:window.__startupResult,progress:window.MefiBoot.state().progress,
      populated:document.getElementById('workspace-project-name').textContent==='Startup fixture project'&&document.getElementById('workspace-work-list').textContent.includes('Workspace loaded before access'),
      onboarding:!document.getElementById('walkthrough-overlay').hidden,
      gated:document.documentElement.hasAttribute('data-starting'),inert:workspace.inert};
  `);
  assert.ok(report.ready.populated && report.ready.onboarding && !report.ready.gated && !report.ready.inert);
  await first.run("window.MefiOnboarding.close();");
  report.conversation = await first.run(`
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const thread = document.getElementById('workspace-thread');
    return { messages: thread.children.length, scrollTop: thread.scrollTop,
      clientHeight: thread.clientHeight, scrollHeight: thread.scrollHeight };
  `);
  assert.equal(report.conversation.messages, 40);
  assert.ok(report.conversation.scrollHeight > report.conversation.clientHeight + 100, "synthetic conversation must overflow");
  assert.ok(report.conversation.scrollTop + report.conversation.clientHeight >= report.conversation.scrollHeight - 60,
    `Home should reveal the newest synthetic message: ${JSON.stringify(report.conversation)}`);
  report.projectsToggle = await first.run(`
    const brand = document.getElementById('app-rail-brand');
    const sidebar = window.MefiSidebar;
    const before = sidebar.isOpen();
    const pressProjects = () => {
      brand.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    };
    pressProjects();
    brand.click();
    const opened = sidebar.isOpen();
    document.getElementById('workspace-sidebar-panel').dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    brand.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await new Promise((resolve) => setTimeout(resolve, 160));
    const hoveredOpen = sidebar.isOpen();
    pressProjects();
    brand.focus();
    await new Promise((resolve) => setTimeout(resolve, 160));
    const heldOpen = sidebar.isOpen();
    brand.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return { before, opened, hoveredOpen, heldOpen, closed: !sidebar.isOpen(), expanded: brand.getAttribute('aria-expanded') };
  `);
  assert.deepEqual(report.projectsToggle, { before: false, opened: true, hoveredOpen: true, heldOpen: true, closed: true, expanded: "false" });
  await first.capture("startup-ready.png");
  await closeWindow(first.window);

  const failed = await launch("failed", 600);
  await failed.until("!document.getElementById('boot-actions').hidden && window.MefiBoot.state().steps.some(step=>step.status==='error')", "failed startup recovery controls");
  report.failed = await failed.run(`
    const card=document.querySelector('.boot-card').getBoundingClientRect();
    return {gated:window.MefiBoot.isActive(),progress:window.MefiBoot.state().progress,
      reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches&&getComputedStyle(document.querySelector('.boot-spinner')).animationName==='none',
      fits:Math.abs(innerWidth-600)<=2&&card.left>=0&&card.right<=innerWidth&&card.top>=0&&card.bottom<=innerHeight,
      bounds:{width:innerWidth,height:innerHeight,left:card.left,right:card.right,top:card.top,bottom:card.bottom},
      result:window.__startupResult,reads:window.startupFixture.projectReads()};
  `);
  await failed.capture("startup-error-600.png");
  assert.ok(report.failed.gated && report.failed.reducedMotion && report.failed.fits);
  assert.equal(report.failed.result, "pending");
  await failed.run("window.startupFixture.allowProjects();document.getElementById('boot-retry').click();");
  await failed.until("window.__startupResult===true&&!window.MefiBoot.isActive()", "retry releases only after successful reads");
  report.retried = await failed.run(`return window.startupFixture.projectReads()>${report.failed.reads}&&document.getElementById('workspace-project-name').textContent==='Startup fixture project';`);
  assert.ok(report.retried);
  await closeWindow(failed.window);

  const continued = await launch("continued", 600);
  await continued.until("!document.getElementById('boot-actions').hidden", "explicit continue action");
  report.lightTheme = await continued.run(`
    const applied=window.MefiMusic.applyCustomColors({accent:'#775B2B',background:'#F0F2F5',surface:'#FFFFFF',text:'#20242A'},false);
    const card=getComputedStyle(document.querySelector('.boot-card')),layer=getComputedStyle(document.getElementById('boot-layer'));
    const title=getComputedStyle(document.getElementById('boot-title')),spinner=getComputedStyle(document.querySelector('.boot-spinner'));
    return {applied,lightSurfaces:card.backgroundImage.includes('rgb(255, 255, 255)')&&card.backgroundImage.includes('rgb(240, 242, 245)')&&layer.backgroundColor==='rgb(240, 242, 245)',
      darkText:title.color==='rgb(32, 36, 42)',spinnerStopped:spinner.animationPlayState==='paused'||spinner.animationName==='none',
      animationName:spinner.animationName,animationPlayState:spinner.animationPlayState,
      background:card.backgroundImage,color:title.color};
  `);
  assert.ok(report.lightTheme.applied && report.lightTheme.lightSurfaces && report.lightTheme.darkText && report.lightTheme.spinnerStopped, JSON.stringify(report.lightTheme));
  await continued.capture("startup-light-600.png");
  await continued.run("document.getElementById('boot-continue').click();");
  await continued.until("window.__startupResult===false&&!window.MefiBoot.isActive()", "explicit degraded startup");
  report.continued = await continued.run("return {result:window.__startupResult,gated:document.documentElement.hasAttribute('data-starting')};");
  await closeWindow(continued.window);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.networkAttempts, []); assert.deepEqual(report.processAttempts, []);
  finish();
}).catch(finish);
