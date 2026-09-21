"use strict";

// Only copied renderer files and synthetic bridge responses are loaded. The
// real app entry point, local stores, providers and coding workers stay absent.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_TASK_OVERVIEW_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated task overview fixture directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [] };
app.setName("Studio Task Overview Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
}
app.disableHardwareAcceleration();
const childProcess = require("node:child_process");
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[method] = () => { report.processAttempts.push(method); throw new Error("Child processes are disabled in the task overview fixture"); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
const finish = (error) => {
  if (finished) return; finished = true;
  if (error) report.failure = error.stack || String(error);
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  if (error) console.error(error.stack || error);
  app.exit(error ? 1 : 0);
};
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url);
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const now = Date.now();
  const task = (id, title, extra = {}) => ({ id, title, prompt: `${title}. Preserve the accepted scope and validate the result.`, status: "open", projectId: "fixture", createdAt: now - 1000, updatedAt: now, ...extra });
  const members = [
    task("export-format", "Preserve export formats", { status: "done", absorbedInto: "group", verification: { state: "verified", reason: "Format checks passed" } }),
    task("export-files", "Write downloadable export files", { status: "active", absorbedInto: "group", prompt: "PRESERVED_UNICODE_SCOPE: keep accented names and final blank fields." }),
    task("export-check", "Verify export on reopening", { status: "awaiting_verification", absorbedInto: "group", verification: { state: "unverified", reason: "Review reopening evidence" } }),
  ];
  const tasks = [
    task("group", "Portable export workflow", { members: structuredClone(members), source: "a-eyes" }), ...members,
    task("family", "Make saved settings reliable", { status: "done", verification: { state: "verified" } }),
    task("family-next", "Restore settings on startup", { parentTaskId: "family", status: "active" }),
    task("family-check", "Check settings after a restart", { parentTaskId: "family", status: "awaiting_verification" }),
    task("review", "Review the import result", { status: "open", verification: { state: "failed", reason: "A malformed input check needs review" } }),
    task("plan-build", "Build the approved offline format", { planningId: "converted" }),
    task("shared-task", "Build a shared export flow", { delegation: { version: 1, childTaskIds: ["shared-format", "shared-check"], summary: "Build the format and independent UI checks, then integrate their results." } }),
    task("shared-format", "Implement the export format", { parentTaskId: "shared-task", delegatedFrom: { parentTaskId: "shared-task" }, status: "done", verification: { state: "verified", reason: "Format checks passed" } }),
    task("shared-check", "Verify the export controls", { parentTaskId: "shared-task", delegatedFrom: { parentTaskId: "shared-task" }, status: "awaiting_verification", verification: { state: "unverified", reason: "The control checks await confirmation" } }),
  ];
  let index = 0;
  while (tasks.length < 95) {
    const family = Math.floor(index / 8), child = index % 8, familyId = `saved-family-${family}`;
    tasks.push(task(child ? `${familyId}-${child}` : familyId, child ? `Saved workflow ${family + 1}: requirement ${child}` : `Improve saved workflow ${family + 1}`, { ...(child ? { parentTaskId: familyId } : {}), updatedAt: now - (family + 1) * 1000 }));
    index += 1;
  }
  const plans = [
    { id: "discussion", projectId: "fixture", title: "Discuss offline sharing", status: "planning", destination: "Share without accounts", outOfScope: "Cloud sync", unknowns: [], questions: [{ id: "q1", type: "discussion", question: "Which format?", status: "resolved", resolution: "JSON", dependsOn: [] }, { id: "q2", type: "discussion", question: "How should conflicts be handled?", status: "open", dependsOn: ["q1"] }], createdAt: now, updatedAt: now },
    { id: "converted", projectId: "fixture", title: "Approved offline format", status: "converted", destination: "Keep exported data portable", outOfScope: "Servers", unknowns: [], questions: [], taskIds: ["plan-build"], conversion: { taskIds: ["plan-build"] }, createdAt: now, updatedAt: now },
  ];
  const taskStates = tasks.filter((row) => !row.absorbedInto).map((row) => ({ id: row.id, stage: row.status === "active" ? "running" : row.status === "awaiting_verification" ? "verifying" : row.verification?.state === "failed" ? "blocked" : row.status === "done" ? "done" : "ready", reason: row.status === "active" ? "A worker is applying this step" : "Ready when scheduling resumes" }));
  Object.assign(taskStates.find((row) => row.id === "shared-task"), { stage: "waiting", reason: "Waiting for delegated subtasks to finish before combining their results" });
  Object.assign(taskStates.find((row) => row.id === "shared-format"), { reason: "Format checks passed" });
  Object.assign(taskStates.find((row) => row.id === "shared-check"), { reason: "Completion checks are pending" });
  const responses = {
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, tasksList: { ok: true, projectId: "fixture", tasks }, ideasList: { ok: true, ideas: [] },
    planningList: { ok: true, projectId: "fixture", projectName: "Isolated review project", plans },
    projectsList: { ok: true, activeId: "fixture", projects: [{ id: "fixture", name: "Isolated review project", path: root }] },
    prefsGet: { ok: true, prefs: { commandHome: false, taskFilter: "all", autoReference: false } },
    assistantState: { ok: true, state: { status: "paused", agents: [], messages: [], prefs: {}, work: [] } }, assistantStatus: { ok: true, status: { enabled: false, execute: false, running: [], history: [] } },
    eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] },
    backlogStatus: { ok: true, projectId: "fixture", counts: Object.fromEntries(["ready", "running", "verifying", "blocked", "done", "waiting"].map((stage) => [stage, taskStates.filter((row) => row.stage === stage).length])), taskStates, next: [] },
    speedMeasurements: { ok: true, measurements: {} }, readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
  };
  report.rawTaskCount = tasks.length;
  const preload = path.join(root, "read-only-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};contextBridge.exposeInMainWorld('mefiStudio',Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]])));localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zenReactive','0');`);
  const window = new BrowserWindow({ show: false, width: 1360, height: 980, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  contents.on("render-process-gone", (_event, detail) => finish(new Error(`Renderer exited: ${detail.reason}`)));
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (expression, label) => { const deadline = Date.now() + 6500; while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${expression});`)) return; await sleep(35); } throw new Error(`Timed out: ${label}`); };
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
  const capture = async (name) => { await sleep(160); fs.writeFileSync(path.join(root, name), (await capturePage()).toPNG()); };
  const inspectDelegation = async (size) => {
    await run("const search=document.getElementById('task-search');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));await window.MefiTasks.open({taskId:'shared-task'});");
    await until("document.querySelector('[data-task-panel=delegation]')?.textContent.includes('1/2 confirmed')", `${size} delegated task details`);
    await run("document.querySelector('[data-task-panel=delegation]').scrollIntoView({block:'center',behavior:'instant'});");
    const detail = await run(`const panel=document.querySelector('[data-task-panel=delegation]');const bounds=panel.getBoundingClientRect();return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,text:panel.textContent,bounds:{left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom},links:[...panel.querySelectorAll('[data-task-action=view-subtask]')].map(link=>{const rect=link.getBoundingClientRect();return {id:link.dataset.taskId,text:link.textContent,disabled:link.disabled,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};})};`);
    assert.match(detail.text, /Delegated subtasks · 1\/2 confirmed/);
    assert.match(detail.text, /Implement the export formatDone · Verified/);
    assert.match(detail.text, /Verify the export controlsVerifying/);
    assert.match(detail.text, /parent resumes to combine and verify results/i);
    assert.equal(detail.links.length, 2);
    assert.ok(!detail.overflow && detail.bounds.left >= 0 && detail.bounds.right <= detail.width + 1 && detail.links.every((link) => !link.disabled && link.left >= 0 && link.right <= detail.width + 1 && link.top >= 0 && link.bottom <= detail.height), JSON.stringify(detail));
    await capture(`task-delegation-${size}.png`);
    await run("document.querySelector('[data-task-action=view-subtask][data-task-id=shared-check]').click();");
    await until("document.querySelector('[data-task-action=view-parent]')?.textContent.includes('Build a shared export flow')", `${size} child links back to its shared task`);
    await run("document.querySelector('[data-task-action=view-parent]').click();");
    await until("document.querySelector('[data-task-panel=delegation]')?.textContent.includes('1/2 confirmed')", `${size} parent link returns to delegated progress`);
    return { ...detail, childAndParentNavigation: true };
  };
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await until("window.MefiTasks && window.MefiNav", "task board startup");
  await run("window.MefiNav.go('tasks');");
  await until("document.querySelector('.task-overview-card[data-overview-id=\"planning:discussion\"]') && document.querySelectorAll('.task-overview-card').length >= 3", "overview cards and saved discussion");
  await until("!document.getElementById('boot-layer') || document.getElementById('boot-layer').hidden", "startup fade finishes before visual inspection");
  // UI assertions are kept against visible text/ARIA, not implementation APIs.
  report.cards = await run("return [...document.querySelectorAll('.task-overview-card')].map(card=>({id:card.dataset.overviewId,text:card.textContent}));");
  const grouped = await run(`const card=[...document.querySelectorAll('.task-overview-card')].find(card=>card.textContent.includes('Portable export workflow'));if(!card)throw new Error('Missing grouped workflow');const progress=card.querySelector('[role=progressbar]');return {text:card.textContent,next:card.querySelector('.task-overview-next')?.textContent,value:progress?.getAttribute('aria-valuenow'),max:progress?.getAttribute('aria-valuemax'),label:progress?.getAttribute('aria-valuetext')};`);
  assert.equal(Number(grouped.value), 1); assert.equal(Number(grouped.max), 3); assert.match(grouped.label, /confirmed/i); assert.match(grouped.text, /33%/); assert.match(grouped.next, /Write downloadable export files/);
  report.grouped = grouped; report.confirmedProgress = true;
  const discussion = await run(`const card=[...document.querySelectorAll('.task-overview-card')].find(card=>card.textContent.includes('Discuss offline sharing'));if(!card)throw new Error('Missing discussion plan');const progress=card.querySelector('[role=progressbar]');return {text:card.textContent,next:card.querySelector('.task-overview-next')?.textContent,value:progress?.getAttribute('aria-valuenow'),max:progress?.getAttribute('aria-valuemax'),label:progress?.getAttribute('aria-valuetext')};`);
  assert.match(discussion.text, /discussion|planning|talk|decisions/i); assert.equal(Number(discussion.value), 1); assert.equal(Number(discussion.max), 2); assert.match(discussion.label, /decision/i); assert.doesNotMatch(discussion.label, /tasks confirmed/i); assert.match(discussion.next, /How should conflicts be handled/);
  report.discussion = discussion; report.discussionProgress = true;
  report.sharedOverview = await run(`const card=document.querySelector('.task-overview-card[data-overview-id="shared-task"]');const progress=card?.querySelector('[role=progressbar]');return {text:card?.textContent,value:progress?.getAttribute('aria-valuenow'),max:progress?.getAttribute('aria-valuemax')};`);
  assert.match(report.sharedOverview.text, /SHARED TASK & SUBTASKS/);
  assert.equal(Number(report.sharedOverview.value), 1); assert.equal(Number(report.sharedOverview.max), 3);
  await capture("task-overview-wide.png");
  await run("const search=document.getElementById('task-search');search.value='PRESERVED_UNICODE_SCOPE';search.dispatchEvent(new Event('input',{bubbles:true}));");
  await until("document.getElementById('task-list').textContent.includes('Portable export workflow')", "search finds a preserved member through its parent");
  report.preservedSearch = await run("return document.querySelectorAll('.task-overview-card').length===1;");
  assert.ok(report.preservedSearch);
  await run("await window.MefiTasks.open({taskId:'export-files'});");
  await until("document.getElementById('task-detail').textContent.includes('PRESERVED_UNICODE_SCOPE')", "original task detail");
  report.originalDetail = true; await capture("task-overview-detail.png");
  report.delegationWide = await inspectDelegation("wide");
  await run("window.MefiTasks.selectTask(null);await window.MefiTasks.open({filter:'all'});const search=document.getElementById('task-search');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));");
  await run("for(const details of document.querySelectorAll('.task-overview-details'))details.open=false;");
  window.setContentSize(600, 900);
  await sleep(160);
  report.narrowLayout = await run("return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,cards:[...document.querySelectorAll('.task-overview-card')].slice(0,4).map(card=>({left:card.getBoundingClientRect().left,right:card.getBoundingClientRect().right}))};");
  assert.ok(!report.narrowLayout.overflow && report.narrowLayout.cards.every((card) => card.left >= 0 && card.right <= report.narrowLayout.width + 1), JSON.stringify(report.narrowLayout));
  await capture("task-overview-narrow.png");
  await run("const search=document.getElementById('task-search');search.value='Discuss offline sharing';search.dispatchEvent(new Event('input',{bubbles:true}));");
  await capture("task-overview-discussion.png");
  report.delegationNarrow = await inspectDelegation("narrow");
  assert.deepEqual(report.errors, []); assert.deepEqual(report.networkAttempts, []); assert.deepEqual(report.processAttempts, []);
  finish();
}).catch(finish);
