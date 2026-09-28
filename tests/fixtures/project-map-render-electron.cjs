"use strict";
// Real Chromium gestures and canvas pixels, with a synthetic project only.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_PROJECT_MAP_RENDER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated map fixture directory is required");
const report = { errors: [], networkAttempts: [], layouts: [] };
app.setName("Studio Map Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) { const folder = path.join(root, name); fs.mkdirSync(folder, { recursive: true }); app.setPath(name, folder); }
app.disableHardwareAcceleration();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let finished = false;
function finish(error) {
  if (finished) return; finished = true;
  if (error) { report.failure = error.stack || String(error); console.error(report.failure); }
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2)); app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url);
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.networkAttempts.push(details.url); callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const systems = ["Game engine", "World & terrain", "Player movement", "Interface", "Audio", "Story & quests", "Verification", "Build tools"].map((name, i) => {
    const files = ["core", "effects", "state"].flatMap(folder => Array.from({ length: folder === "core" && i === 0 ? 130 : 5 }, (_, j) => ({ path: `src/system-${i}/${folder}/${j === 129 ? "distant-module" : `module-${j}`}.js`, present: j !== 3, edits: j % 4, lastAt: Date.now() - j * 3600000 })));
    if (i === 0) files.push({ path: "src/system-0/index.js", present: true, edits: 1 }, { path: "src/system-0/Files/readme.md", present: true, edits: 0 });
    return { id: `system-${i}`, name, path: `src/system-${i}/`, what: `The ${name.toLowerCase()} system and its supporting parts.`, fileCount: files.filter(file => file.present).length, historicalCount: 3, catalog: files, files: files.slice(0, 10), tasks: { done: i, active: i < 2 ? 1 : 0, open: 2 }, edits: 10 - i, heat: 8 - i, taskIds: ["task-1"], exploration: { observedFiles: i + 2, knownFiles: files.length, unexploredFiles: files.length - i - 2 } };
  });
  const map = { systems, links: [{ a: "system-0", b: "system-1", strength: .8, weight: 8 }, { a: "system-0", b: "system-2", strength: .65, weight: 6 }, { a: "system-1", b: "system-3", strength: .4, weight: 3 }], sources: { present: 224, commits: 48, runs: 7 }, builtAt: Date.now() };
  const idea = { id: "idea:movement", kind: "idea", sourceId: "movement", title: "Make movement feel weightless", summary: "Experiment with gentler acceleration and clearer landing feedback.", status: "new", stage: "ideas", systemId: "system-0", match: "inferred", children: [] };
  const task = { id: "task:motion", kind: "task", sourceId: "motion", title: "Refine movement through the world", summary: "Keep the existing controls while testing acceleration.", status: "active", stage: "active", systemId: "system-0", match: "files", children: [] };
  map.ideaTree = { v: 1, counts: { ideas: 1, active: 1, queued: 0, done: 0, total: 2 }, groups: [{ id: "system:system-0", name: "Game engine", systemId: "system-0", stages: [{ id: "ideas", name: "Ideas", items: [idea] }, { id: "active", name: "In progress", items: [task] }] }] };
  const responses = {
    projectsList: { ok: true, activeId: "map-demo", projects: [{ id: "map-demo", name: "Wanderlight", path: root }, { id: "map-other", name: "Second project", path: root + "/other" }] },
    prefsGet: { ok: true, prefs: { commandHome: false } },
    tasksList: { ok: true, projectId: "map-demo", tasks: [{ id: "task-1", title: "Refine movement through the world", status: "active" }] },
    ideasList: { ok: true, ideas: [] }, planningList: { ok: true, plans: [] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] },
    assistantState: { ok: true, state: { status: "paused", agents: [], messages: [], prefs: {}, work: [] } },
    assistantStatus: { ok: true, status: { enabled: false, execute: false, parallel: 1, running: [], history: [] } },
    eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] },
    backlogStatus: { ok: true, counts: { ready: 0, running: 0, verifying: 0, blocked: 0 }, next: [] }, speedMeasurements: { ok: true, measurements: {} }, assistantDoneLog: { ok: true, entries: [] },
    brainMap: { ok: true, map }, brainState: { ok: true, pipelines: {}, running: [], recent: [] },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
  };
  const preload = path.join(root, "map-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)},listeners={};
    const bridge=Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]]));
    for(const name of ['onProjects','onBrainUpdate'])bridge[name]=fn=>(listeners[name]??=[]).push(fn);
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('mapFixture',{project:()=>{responses.projectsList.activeId='map-other';responses.brainMap.map={systems:[],links:[],sources:{present:0}};for(const fn of listeners.onProjects||[])fn(responses.projectsList);},refresh:()=>{responses.brainMap.map.systems[0].name='Renamed engine';for(const fn of listeners.onBrainUpdate||[])fn({what:'map'});},evolve:()=>{const g=responses.brainMap.map.ideaTree.groups[0],idea=g.stages[0].items.pop();idea.match='linked';g.stages[1].items[0].children.push(idea);for(const fn of listeners.onBrainUpdate||[])fn({what:'map'});},empty:()=>{responses.brainMap.map.systems=[];for(const fn of listeners.onBrainUpdate||[])fn({what:'map'});}});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,status:'complete'}));
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(60); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail) => { if (detail?.level === "error") report.errors.push(detail.message); });
  const run = code => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async condition => { const deadline = Date.now() + 12000; while (Date.now() < deadline) { if (await run(`return Boolean(${condition});`)) return; await sleep(40); } throw new Error(`Timed out: ${condition}`); };
  const state = () => run("return window.MefiAgentBrain.mapState();");
  const settle = async () => { await run("await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));"); await until("!window.MefiAgentBrain.mapState().moving"); };
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click();`);
  const key = (key, extra = {}) => run(`document.getElementById('agent-brain-map-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,...${JSON.stringify(extra)}}));`);
  const capture = async name => {
    await settle(); contents.invalidate(); await sleep(160);
    for (let attempt = 0; ; attempt++) {
      try { fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG()); return; }
      catch (error) { if (!/UnknownVizError/.test(error.message) || attempt >= 3) throw error; await sleep(200); }
    }
  };
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  contents.debugger.attach("1.3");
  await contents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  await contents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await until("window.MefiAgentBrain && window.MefiWorkspace?.activeProjectId()==='map-demo'");
  await run("await window.MefiNav.go('agent-brain',{tab:'map'});");
  await until("window.MefiAgentBrain.mapState()?.count===8"); await settle();
  await capture("map-overview.png");
  const initial = await state();
  assert.equal(initial.edges.length, 3, "observed relationships are drawn and exposed to the accessible list");
  assert.ok(initial.edges.every(edge => edge.label === "Changed together"));
  await click('.pm-mode[data-mode="ideas"]');
  assert.equal((await state()).mode, "ideas");
  assert.equal(await run("return document.querySelectorAll('.pm-idea-card').length;"), 2);
  assert.ok(await run("return document.querySelector('.pm-ideas').textContent.includes('Suggested grouping');"));
  await capture("map-ideas.png");
  await run("window.mapFixture.evolve();");
  await until("document.querySelectorAll('.pm-idea-children .pm-idea-card').length===1");
  assert.equal(await run("return document.querySelectorAll('.pm-idea-card').length;"), 2, "an idea moves under its task without duplication");
  await run("const group=document.querySelector('.pm-idea-group');group.open=false;await new Promise(r=>setTimeout(r,20));window.mapFixture.refresh();");
  await until("document.querySelector('.ab-index-item[data-id=\"system-0\"]').textContent.includes('Renamed engine')");
  assert.equal(await run("return document.querySelector('.pm-idea-group').open;"), false, "live refresh preserves collapsed branches");
  await run("document.querySelector('.pm-idea-group').open=true;");
  await click('.pm-mode[data-mode="systems"]'); await settle();
  assert.deepEqual((await state()).nodes.map(node => [node.id, node.worldX, node.worldY]), initial.nodes.map(node => [node.id, node.worldX, node.worldY]), "new work metadata keeps system positions stable");
  report.relationships = true; report.ideasTree = true;
  await click('.ab-index-item[data-id="system-0"]');
  assert.equal((await state()).level, "systems", "single selection inspects without losing the overview");
  await settle();
  assert.ok(await run("return document.getElementById('agent-brain-map-detail').textContent.includes('Changes together');"));
  const overview = await state();
  await key("Enter"); assert.equal((await state()).level, "parts");
  assert.ok((await state()).moving, "drill-down has a finite scene transition"); await settle();
  assert.equal((await state()).count, 5, "root files and a folder named Files stay distinct");
  await capture("map-parts.png");
  await click('.ab-index-item[data-id="core"]'); await key("Enter"); await settle();
  assert.equal((await state()).count, 130);
  assert.equal(await run("return document.querySelectorAll('.ab-index-item').length;"), 60, "large folders page their accessible contents");
  await click('.pm-more'); await click('.pm-more');
  assert.equal(await run("return document.querySelectorAll('.ab-index-item').length;"), 130, "no file is truncated out of navigation");
  await click('.pm-history[aria-label="Back in map (Alt+Left)"]'); await settle();
  assert.equal((await state()).level, "parts");
  await click('.pm-history[aria-label="Back in map (Alt+Left)"]'); await settle();
  const restored = await state(); assert.equal(restored.selected, "system-0");
  for (const k of ["x", "y", "scale"]) assert.ok(Math.abs(restored.camera[k] - overview.camera[k]) < .1, `Back restores ${k}`);
  await click('.pm-history[aria-label="Forward in map (Alt+Right)"]'); await settle();
  assert.equal((await state()).level, "parts"); report.history = true;
  // Search spans all systems, including files outside the initial 60 rows.
  await run("document.querySelector('.pm-browse').getAttribute('aria-expanded')==='false'&&document.querySelector('.pm-browse').click();const input=document.querySelector('.pm-search');input.value='distant-module';input.dispatchEvent(new Event('input',{bubbles:true}));");
  assert.equal(await run("return document.querySelectorAll('.ab-index-item').length;"), 1);
  await click('.ab-index-item'); await settle();
  assert.equal((await state()).selected, "src/system-0/core/distant-module.js");
  assert.match(await run("return document.getElementById('agent-brain-map-detail').textContent;"), /Work on this file/);
  await capture("map-file.png"); report.search = true;
  await run("[...document.querySelectorAll('#agent-brain-map-detail button')].find(el=>el.textContent==='Work on this file').click();");
  await until("document.getElementById('workspace-input').value.includes('src/system-0/core/distant-module.js')");
  await run("await window.MefiNav.go('agent-brain',{tab:'map'});"); await settle();
  assert.equal((await state()).selected, "src/system-0/core/distant-module.js", "task draft handoff retains the map's location");
  // A plain refresh updates metadata without erasing the route or camera.
  const beforeRefresh = await state(); await run("window.mapFixture.refresh();");
  await until("document.querySelector('.ab-map-breadcrumb').textContent.includes('Renamed engine')"); await settle();
  const afterRefresh = await state(); assert.equal(afterRefresh.selected, beforeRefresh.selected); assert.equal(afterRefresh.level, "files");
  assert.ok(Math.abs(afterRefresh.camera.y - beforeRefresh.camera.y) < .1);
  // Pointer drag uses Chromium pointer capture and then settles with momentum.
  const point = await run("const r=document.getElementById('agent-brain-map-canvas').getBoundingClientRect();return {x:Math.round(r.x+r.width*.7),y:Math.round(r.y+r.height*.55)};");
  const beforeDrag = await state();
  contents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y }); contents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
  for (let i = 1; i <= 5; i++) { contents.sendInputEvent({ type: "mouseMove", x: point.x - i * 14, y: point.y - i * 12, movementX: -14, movementY: -12 }); await sleep(16); }
  contents.sendInputEvent({ type: "mouseUp", x: point.x - 70, y: point.y - 60, button: "left", clickCount: 1 });
  await settle(); const afterDrag = await state();
  assert.notEqual(afterDrag.camera.y, beforeDrag.camera.y); assert.equal(afterDrag.level, "files", "drag does not navigate"); assert.equal(afterDrag.selected, beforeDrag.selected, "drag does not select another file");
  await key("+", {}); assert.ok((await state()).moving, "zoom eases toward a destination"); await settle();
  const settled = await state(); await sleep(180); assert.deepEqual((await state()).camera, settled.camera, "camera stops at rest");
  await key("Home"); await settle();
  assert.ok((await state()).camera.scale < .55, "Fit includes a large folder");
  await click('.pm-minimap'); await settle(); report.gestures = true;
  // Rapid navigation cancels the previous transition without stale hit targets.
  await key("Backspace"); await key("Backspace"); await key("ArrowDown"); await key("Enter"); await settle();
  assert.equal((await state()).level, "parts");
  // Both motion sources stop active camera movement.
  await key("+"); await run("document.documentElement.dataset.motion='off';"); await settle();
  assert.deepEqual((await state()).camera, (await state()).target);
  await run("document.documentElement.dataset.motion='on';");
  await contents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await key("+"); await settle(); assert.deepEqual((await state()).camera, (await state()).target); report.reducedMotion = true;
  await key("Backspace"); await settle();
  for (const [w, h, zoom] of [[1440, 900, 1], [1100, 760, 1], [600, 560, 1], [600, 560, 1.5]]) {
    window.setContentSize(w, h); contents.setZoomFactor(zoom); await sleep(120); await settle();
    const layout = await run("const p=document.getElementById('agent-brain-map'),s=p.querySelector('.pm-stage'),c=p.querySelector('.pm-camera'),r=c.getBoundingClientRect();return {height:s.clientHeight,scroll:s.scrollHeight-s.clientHeight,inside:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,body:document.documentElement.scrollWidth<=innerWidth+2};");
    assert.ok(layout.height > 35 && layout.scroll <= 2 && layout.inside && layout.body, JSON.stringify({w,h,zoom,...layout}));
    report.layouts.push({ w, h, zoom, ...layout }); await capture(`map-${w}-${zoom}.png`);
    await click('.pm-mode[data-mode="ideas"]');
    assert.ok(await run("const p=document.querySelector('.pm-ideas');return p.scrollWidth<=p.clientWidth+2 && p.clientHeight>35;"), "ideas tree stays within the map at every window size");
    if (w === 600 && zoom === 1) await capture("map-ideas-narrow.png");
    await click('.pm-mode[data-mode="systems"]');
  }
  await click('.ab-index-item[data-id="system-0"]');
  await click('.ab-narrow-open');
  assert.ok(await run("return document.getElementById('agent-brain-map-detail').getClientRects().length>0&&!document.querySelector('.pm-stage').getClientRects().length;"));
  // An explicit Vibe map destination must escape a previous narrow detail
  // pane, otherwise the details and Ideas view both become hidden.
  await run("await window.MefiNav.go('vibe');await window.MefiNav.go('agent-brain',{tab:'map',mapMode:'ideas'});");
  await until("window.MefiAgentBrain.mapState().mode==='ideas'");
  assert.ok(await run("const p=document.querySelector('.pm-ideas');return p.getClientRects().length>0&&p.clientHeight>35&&document.querySelector('.pm-stage').getClientRects().length>0&&p.querySelectorAll('.pm-idea-card').length===2;"), "Ideas opens visibly after leaving narrow details");
  assert.match(await run("return document.querySelector('.pm-idea-root').textContent;"), /0 queued/, "root includes queued work in its summary");
  await run("await window.MefiNav.go('vibe');await window.MefiNav.go('agent-brain',{tab:'map',mapMode:'systems'});");
  await until("window.MefiAgentBrain.mapState().mode==='systems'"); await settle();
  assert.ok(await run("return document.getElementById('agent-brain-map-canvas').getClientRects().length>0&&getComputedStyle(document.getElementById('agent-brain-map-canvas')).visibility==='visible';"), "System map route leaves Ideas mode");
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    window.setContentSize(w, h); contents.setZoomFactor(1);
    await run("await window.MefiNav.go('vibe');"); await sleep(180);
    await capture(`vibe-${w}.png`);
    assert.ok(await run("return document.documentElement.scrollWidth<=innerWidth+2;"), "Vibe has no horizontal page overflow");
  }
  await run("await window.MefiNav.go('agent-brain',{tab:'map'});");
  await run("window.mapFixture.project();");
  await until("window.MefiWorkspace.activeProjectId()==='map-other' && window.MefiAgentBrain.mapState().count===0");
  assert.equal((await state()).history.length, 1); assert.equal((await state()).systemId, null); assert.equal((await state()).selected, null); report.projectIsolation = true;
  await capture("map-empty.png");
  assert.deepEqual(report.errors, []); assert.deepEqual(report.networkAttempts, []); finish();
}).catch(finish);
