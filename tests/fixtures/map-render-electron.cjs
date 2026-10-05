"use strict";

// The Map in the 0.5 layout, in a real Chromium: a copied booklet launched with ?layout=v2 and a synthetic bridge.
// The prototype's Map (docs/prototype/mefi-studio-0.5-v5.html, mapView) is the sessions drawn as a graph: the list column
// keeps the session list, and Map | Fleet | Pipelines is a switch over each of the three pages (renderer/idle.js #map-bar
// over the tree; renderer/nav.js syncMapSwitch in Fleet's and the Agent brain's heads). This opens the Map, measures
// its bar (the switch, Running only, View ▾ with its four groups and the way to Map look), the colours of the four
// states, Fit and zoom, the list column and the breadcrumb; moves between the three pages with a real pointer from each
// switch; checks Running only and View ▾'s choices act; and that nothing reads under 12 px. A second launch without
// ?layout=v2 shows Command as it was. Screenshots are kept when the test is given a capture folder
// (MEFI_MAP_CAPTURE_DIR). No application main process or live state is loaded; network, permissions and child processes
// are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_MAP_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Map fixture directory is required");
const studio = path.resolve(__dirname, "..", "..");
const report = { errors: [], networkAttempts: [], processAttempts: [], pages: [], shots: [], steps: [], complete: false };
app.setName("Map Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
}
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-prefers-reduced-motion", "reduce");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const childProcess = require("node:child_process");
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = () => { report.processAttempts.push(name); throw new Error("Child execution is disabled in this fixture"); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
function finish(error) {
  if (finished) return; finished = true;
  if (error) { report.failure = error.stack || String(error); console.error(report.failure); }
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);

async function bridgeNames() {
  const source = fs.readFileSync(path.join(studio, "preload.cjs"), "utf8");
  return [...new Set([...source.matchAll(/^  ([A-Za-z][A-Za-z0-9_]*):/gm)].map((match) => match[1]))];
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url);
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const now = Date.now(), projectId = "map-project";
  const task = (id, title, more = {}) => ({ id, projectId, title, prompt: title, status: "open", createdAt: now - 3600000, updatedAt: now - 600000, ...more });
  const tasks = [
    task("t_run", "Search notes by tag", { status: "active", runId: "run-1", updatedAt: now - 60000 }),
    task("t_ready", "Keyboard shortcut for a new note"),
    task("t_done", "Pin favourite notes", { status: "done", doneAt: now - 7200000, verification: { state: "verified" } }),
  ];
  const routing = { provider: "zen", roleProviders: {}, models: { routine: "gpt-6-luna", heavy: "gpt-6-sol" }, providerModels: {}, hasZen: true, autoProviders: ["zen"], autoFallback: true, modelSelection: "fixed", executorCli: "codex", executorModels: {}, executorTierModels: {}, executorTier: "auto" };
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Notes app", path: root }] },
    tasksList: { ok: true, projectId, tasks }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: {}, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, autoBuild: true, mode: "swarm", running: [{ taskId: "t_run", runId: "run-1", title: "Search notes by tag", route: "builder-2", phase: "running", currentStep: "Writing parseTags()", startedAt: now - 2400000 }], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, counts: { ready: 1, running: 1 }, taskStates: [{ id: "t_run", stage: "running" }, { id: "t_ready", stage: "ready" }], next: [{ id: "t_ready", title: "Keyboard shortcut for a new note", stage: "ready" }] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getApiKey: { saved: false }, getAiRouting: routing, cliStatus: [], launchStudio: { ok: true }, firstRunStatus: { ok: true, firstRun: null },
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration: { aiProvider: "zen", aiModels: routing.models, executorCli: "codex" }, defaults: {}, presets: [], skills: [], mcpTools: [], routing, seats: {}, efforts: ["low", "medium", "high"] },
    companionState: { ok: true, projectId, projectName: "Notes app", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: false, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    brainState: { ok: true, tasks: [], recent: [], pipelines: {} }, brainPlaybook: { ok: true, shelf: [], recipes: [] }, brainMap: { ok: true, map: { systems: [], edges: [], files: [] } },
    worktreesList: { ok: true, repo: false, projectId, enabled: { on: false, forced: false } }, skillsList: { ok: true, skills: [], roots: [] },
  };
  const names = await bridgeNames();
  const preload = path.join(root, "map-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const names=${JSON.stringify(names)};const calls=[];
    const bridge={};
    for(const name of names){
      if(/^on[A-Z]/.test(name))bridge[name]=()=>()=>{};
      else bridge[name]=async(...args)=>{calls.push(name);return name in responses?JSON.parse(JSON.stringify(responses[name])):{ok:true};};
    }
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));localStorage.setItem('mefiStudio.whatsNew.seen','vibe-build-1');localStorage.setItem('mefiStudio.setupHelper.seen','setup-helper-1');
  `);
  const window = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, frame: false, enableLargerThanScreen: true, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, what, ms = 15000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "map-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${what}`);
  };
  const capture = async (name) => {
    await run("for (const notice of document.querySelectorAll('#toast-host .toast')) notice.remove(); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(250);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
    report.shots.push(name);
  };
  const click = async (selector) => {
    const box = await run(`const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, reached: Boolean(hit) && (hit === node || node.contains(hit)), on: hit ? (hit.id || hit.className || hit.tagName) : null };`);
    assert.ok(box && box.w > 0, `${selector} is on screen`);
    assert.equal(box.reached, true, `a pointer reaches ${selector} (${box.on} is on top)`);
    const point = { x: Math.round(box.x), y: Math.round(box.y) };
    contents.sendInputEvent({ type: "mouseMove", ...point }); contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point }); contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
    await sleep(300);
  };
  // What a region says in real pixels: its text under 12 px, and whether it is shown.
  const small = (selector) => run(`const shown = (node) => { if (!node || !node.getClientRects().length) return false; for (let n = node; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
    const own = (node) => [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
    return [...document.querySelectorAll(${JSON.stringify(selector)})].flatMap((root) => [root, ...root.querySelectorAll('*')]).filter((node) => shown(node) && own(node) && !node.closest('[aria-hidden="true"]') && parseFloat(getComputedStyle(node).fontSize) < 11.95).map((node) => (node.id || String(node.className).slice(0, 30) || node.tagName) + ':' + getComputedStyle(node).fontSize + ':' + node.textContent.trim().slice(0, 24));`);
  const where = () => run(`return {
    route: window.MefiNav.current(), crumbs: [...document.querySelectorAll('.shell-trail .shell-crumb')].map((node) => node.textContent.trim()),
    pagesList: document.getElementById('shell-pages')?.hidden === false, list: document.getElementById('shell-list')?.getClientRects().length > 0,
    sessions: [...document.querySelectorAll('#shell-list [data-task-id], #shell-list .sx-row')].length,
  };`);
  const switchOf = (scope) => run(`return [...document.querySelectorAll(${JSON.stringify(`${scope} .map-pages .map-page`)})].map((node) => node.textContent.trim() + (node.getAttribute('aria-current') ? ' *' : ''));`);

  // ---- v1: Command as it was -------------------------------------------------------------------------
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await until("window.MefiNav && window.MefiIdle && !window.MefiBoot?.isActive?.()", "studio ready (v1)");
  await run("window.MefiNav.go('command');");
  await until("window.MefiNav.current() === 'command' && document.getElementById('idle-hud')?.hidden === false", "Command is up (v1)");
  await sleep(600);
  report.v1 = await run(`const shown = (id) => { const node = document.getElementById(id); return Boolean(node && node.getClientRects().length && getComputedStyle(node).display !== 'none'); };
    return { bar: shown('map-bar'), zoom: shown('map-zoom'), legend: shown('map-legend'), top: Boolean(document.querySelector('#idle-hud .cmd-top')?.getClientRects().length) };`);
  assert.deepEqual(report.v1, { bar: false, zoom: false, legend: false, top: true }, "with the layout off Command keeps its toolbar and has none of the Map's");
  report.steps.push("v1 is untouched");

  // ---- v2 ------------------------------------------------------------------------------------------
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1", layout: "v2" } });
  await until("window.MefiNav && window.MefiIdle && window.MefiShell && window.MefiShell.active() && !window.MefiBoot?.isActive?.()", "studio ready (v2)");
  await run("window.MefiVibe?.setMode?.('build', { go: false }); window.MefiNav.setRailPinned?.(false, { save: false });");
  await run(`document.querySelector('#app-rail .app-rail-head[data-section="map"]').click();`);
  await until("window.MefiNav.current() === 'command' && document.getElementById('idle-hud')?.hidden === false", "the rail's Map opens the Map");
  await sleep(900);
  const map = await where();
  report.pages.push({ id: "map", ...map });
  assert.deepEqual(map.crumbs.slice(-1), ["Map"], "the breadcrumb says Map once");
  assert.equal(map.pagesList, false, "no page list over the Map: the column keeps the sessions");
  assert.deepEqual(await switchOf("#idle-hud"), ["Map *", "Fleet", "Pipelines"], "the Map's own switch, Map current");
  report.bar = await run(`const box = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
    return { bar: box('map-bar'), zoom: box('map-zoom'), legend: [...document.querySelectorAll('#map-legend .map-legend-row')].map((row) => row.textContent.trim()), classicTop: Boolean(document.querySelector('#idle-hud .cmd-top')?.getClientRects().length) };`);
  assert.deepEqual(report.bar.legend, ["Running", "Needs you", "Review", "Done"], "the colours of the four states, as the prototype names them");
  assert.equal(report.bar.classicTop, false, "the classic top bar folds away");
  assert.ok(report.bar.bar[2] > 200 && report.bar.zoom[2] > 60, `the bar and Fit and zoom are drawn: ${JSON.stringify(report.bar)}`);
  await capture("map-1920x1080.png");
  // Running only dims, and says so; again shows it all.
  await click("#map-running-only");
  assert.equal(await run("return document.getElementById('map-running-only').getAttribute('aria-pressed');"), "true", "Running only is on");
  await click("#map-running-only");
  assert.equal(await run("return document.getElementById('map-running-only').getAttribute('aria-pressed');"), "false");
  // View ▾: four groups, its choices act, Map look leads to Settings.
  await click("#map-view-menu");
  await until("document.getElementById('map-view-pop')?.hidden === false", "View ▾ opens");
  report.menu = await run(`return { heads: [...document.querySelectorAll('#map-view-pop .map-menu-head')].map((node) => node.firstChild.textContent.trim()), layouts: document.querySelectorAll('#map-layouts [data-map-layout]').length };`);
  assert.deepEqual(report.menu.heads, ["Layout", "Labels", "Camera", "View"]);
  assert.equal(report.menu.layouts, 5, "the five layouts Settings › Map look has");
  await capture("map-view-menu-1920x1080.png");
  await click('#map-view-pop [data-map-labels="all"]');
  assert.equal(await run(`return document.querySelector('#map-view-pop [data-map-labels="all"]').getAttribute('aria-checked');`), "true", "a choice is marked as soon as it is made");
  await click('#map-view-pop [data-map-labels="auto"]');
  const tooSmall = [...await small("#map-bar"), ...await small("#map-view-pop"), ...await small("#map-legend"), ...await small("#map-zoom")];
  await run("document.getElementById('map-view-pop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));");
  await until("document.getElementById('map-view-pop')?.hidden === true", "Escape closes View ▾");
  // The switch moves between the three pages, from each.
  await click('#idle-hud .map-pages [data-nav="fleet"]');
  await until("window.MefiNav.current() === 'fleet' && document.getElementById('fleet-overlay')?.hidden === false", "Fleet from the Map's switch");
  await sleep(600);
  const fleet = await where();
  report.pages.push({ id: "fleet", ...fleet });
  assert.deepEqual(fleet.crumbs.slice(-2), ["Map", "Fleet"]);
  assert.equal(fleet.pagesList, false, "the column keeps the sessions on Fleet too");
  assert.deepEqual(await switchOf("#fleet-overlay"), ["Map", "Fleet *", "Pipelines"], "Fleet's head has the switch, Fleet current");
  tooSmall.push(...await small("#fleet-overlay .map-pages"));
  await capture("map-fleet-1920x1080.png");
  await click('#fleet-overlay .map-pages [data-nav="agent-brain"]');
  await until("window.MefiNav.current() === 'agent-brain' && window.MefiAgentBrain?.tab?.() === 'live'", "Pipelines from Fleet's switch: the Agent brain's live work");
  await sleep(600);
  const pipelines = await where();
  report.pages.push({ id: "pipelines", ...pipelines });
  assert.deepEqual(pipelines.crumbs.slice(-2), ["Map", "Pipelines"]);
  assert.deepEqual(await switchOf("#agent-brain-overlay"), ["Map", "Fleet", "Pipelines *"], "the Agent brain's head has the switch, Pipelines current");
  await capture("map-pipelines-1920x1080.png");
  await click('#agent-brain-overlay .map-pages [data-nav="command"]');
  await until("window.MefiNav.current() === 'command' && document.getElementById('idle-hud')?.hidden === false", "back to the Map from the Pipelines' switch");
  assert.deepEqual(tooSmall, [], "nothing in the Map's bar, its menu, its corner or the switch reads under 12 px");
  report.steps.push("the switch moves between the three pages");
  report.complete = true;
  finish();
}).catch(finish);
