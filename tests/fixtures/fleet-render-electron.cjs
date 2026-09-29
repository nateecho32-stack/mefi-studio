"use strict";

// Live > Fleet in a real Chromium: a copied booklet and a synthetic bridge fed
// by the real fleet model (scripts/fleet.cjs). It opens the page at four window
// sizes (1440x900, 1100x720, 600x560 and 1100x720 at 125% zoom) and checks the
// real geometry: nothing overflows the page, every seat card is on screen and
// none overlap, every wire has length, the tabs each paint, a push updates the
// page, the keyboard reaches seats, and Escape closes it. No application main
// process or live state is loaded; network, permissions and child processes
// are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_FLEET_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Fleet fixture directory is required");
const fleet = require(path.join(__dirname, "..", "..", "scripts", "fleet.cjs"));
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], calls: [], tabs: [] };
app.setName("Fleet Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
}
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-prefers-reduced-motion", "reduce");
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

// A busy team: six builders, a question the desk passed on, a kept branch, a
// retry loop, mail across pods and a lead-to-check skip, so every wire route
// and every tab has something to draw.
const T0 = Date.now() - 20 * 60 * 1000;
function team({ progress = 0.42, step = "Editing main.cjs", extra = false } = {}) {
  const state = fleet.emptyState();
  const tasks = Array.from({ length: 7 }, (_, index) => ({ id: `task_${index + 1}`, title: `Task number ${index + 1}: a fairly long title that has to be clipped`, status: "active" }));
  fleet.observeTasks(state, tasks, T0);
  const running = tasks.slice(0, 6).map((task, index) => ({ id: `run_${index + 1}`, taskId: task.id, title: task.title, startedAt: T0 + index * 1000, phase: "building", currentStep: index === 0 ? step : `Reading file ${index}`, progress: index === 0 ? progress : 0.1 * (index + 1), lastOutputAt: T0 + 900000 }));
  fleet.observeStatus(state, { parallel: 6, loop: { state: "running", on: true, tone: "live", headline: "Agents are running", reason: "", ready: 3, running: 6 }, running }, T0 + 5000);
  running.forEach((run, index) => fleet.observeEvent(state, { kind: "agent.out", at: T0 + index * 1000, runId: run.id, taskId: run.taskId, title: run.title, model: index % 2 ? "sonnet-5" : "fable-5", text: index % 2 ? "claude" : "opencode" }));
  fleet.observeEvent(state, { kind: "help.ask", at: T0 + 30000, runId: "run_2", taskId: "task_2", text: "Which test file owns the fleet view?" });
  fleet.observeEvent(state, { kind: "help.answer", at: T0 + 40000, runId: "run_3", taskId: "task_3", ok: false, text: "escalated: needs the owner" });
  fleet.observeEvent(state, { kind: "mail", at: T0 + 50000, from: "overseer", to: "foreman", text: "two cards repeat work" });
  fleet.observeEvent(state, { kind: "mail", at: T0 + 51000, from: "lead", to: "overseer", text: "check the newest card first" });
  fleet.observeEvent(state, { kind: "report", at: T0 + 52000, taskId: "task_1", from: "task_4", runId: "run_4", text: "added the reducer" });
  if (extra) fleet.observeEvent(state, { kind: "mail", at: Date.now(), from: "foreman", to: "lead", text: "a new card is ready" });
  const context = { projectId: "project_fixture", projectName: "Fleet fixture", roster: [{ role: "foreman", status: "running", runs: 5 }, { role: "watcher", status: "done", runs: 2 }, { role: "keeper", status: "idle", runs: 1 }], team: { executorCli: "opencode", executorModel: "fable-5" }, at: Date.now() };
  const view = { ...fleet.snapshot(state, context), rev: extra ? 2 : 1 };
  const details = Object.fromEntries(view.pods.flatMap((pod) => pod.seats).map((seat) => [seat.id, fleet.seatDetail(state, seat.id, context)]));
  return { view, details };
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
  const projectId = "project_fixture";
  const configuration = { aiProvider: "auto", executorCli: "opencode", executorTier: "auto", aiAutoProviders: ["zai", "opencode"], agentBrain: { contextScout: true, deskTool: false } };
  const routing = { provider: "auto", roleProviders: {}, models: {}, providerModels: {}, hasZen: true, hasOpenCode: false, hasZai: false, hasOpenRouter: false, hasCustom: false, autoProviders: ["zai", "opencode"], autoFallback: false, subscriptionFirst: true, modelSelection: "jev", executorCli: "opencode", executorTier: "auto", executorTierDefaults: {}, lmStudioEndpoint: "http://127.0.0.1:1234/v1", customEndpoint: "", autoSetup: null };
  const first = team();
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Fleet fixture", path: root }] },
    tasksList: { ok: true, projectId, tasks: [] }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: true, useReference: true, useTree: true, useWeb: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: { proactive: true, parallel: 8, aiParallel: 4, memoryAlign: true, loopGuard: true, loopGuardApply: true, compactHistory: true, keepAwake: true, background: true }, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, autoBuild: true, minutes: 5, parallel: 2, adaptiveParallel: true, mode: "swarm", running: [], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, draining: false, counts: {}, taskStates: [], next: [] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getAiRouting: routing, cliStatus: [], jevStatus: { enabled: true, route: "zen", routes: { vercel: false, typesafe: false, zen: true, openrouter: false } },
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [], skills: [], mcpTools: [], routing, seats: {}, choices: {} },
    cliSetupStatus: { ok: true, selected: "auto", clis: [] }, firstRunStatus: { ok: true, firstRun: null },
    machineGet: { ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } }, updateStatus: { ok: true, status: { auto: true } },
    companionState: { ok: true, projectId, projectName: "Fleet fixture", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: true, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
    openrouterModels: { ok: true, models: [] }, agentModels: { ok: true, models: [] },
  };
  const preload = path.join(root, "fleet-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const calls=[];const subscribers=[];
    const views={current:${JSON.stringify(first.view)}};const details=${JSON.stringify(first.details)};
    const bridge=Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]]));
    const record=(name,result)=>async(...args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return typeof result==='function'?result(...args):result;};
    bridge.fleetSnapshot=record('fleetSnapshot',()=>views.current);bridge.fleetWatch=record('fleetWatch',{ok:true,watching:true});
    bridge.fleetSeat=record('fleetSeat',id=>details[id]||{ok:false,error:'That seat is not on this team.'});
    bridge.fleetAction=record('fleetAction',{ok:true});bridge.onFleetUpdate=callback=>{subscribers.push(callback);};
    bridge.assistantControl=record('assistantControl',{ok:true});
    for(const name of ['onTasks','onProjects','onAssistantStatus','onAssistant','onProjectPreview','onSettingsChanged','onStudioLog','onAutoSetup'])bridge[name]=()=>()=>{};
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('fleetFixture',{calls:()=>calls,push:view=>{views.current=view;for(const callback of subscribers)callback(view);}});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "fleet-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${label}`);
  };
  const capture = async (name) => {
    await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(150);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
  };
  const key = async (keyCode, modifiers = []) => { contents.sendInputEvent({ type: "keyDown", keyCode, modifiers }); contents.sendInputEvent({ type: "keyUp", keyCode, modifiers }); await sleep(60); };

  // What the page looks like right now, in real pixels.
  const measure = `
    const box = (node) => { const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const stage = document.querySelector('.fleet-stage'), viewport = document.querySelector('.fleet-viewport');
    return {
      inner: { w: innerWidth, h: innerHeight }, sheet: box(document.querySelector('#fleet-overlay .fleet-sheet')),
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      shown: [...document.querySelectorAll('.fleet-panel')].filter((panel) => !panel.hidden).map((panel) => panel.id),
      viewport: viewport && !viewport.closest('[hidden]') ? box(viewport) : null,
      scale: stage && viewport && !viewport.closest('[hidden]') ? new DOMMatrix(getComputedStyle(stage).transform).a : null,
      cards: viewport && !viewport.closest('[hidden]') ? [...document.querySelectorAll('.fleet-seat')].map((node) => ({ id: node.dataset.seat, ...box(node) })) : [],
      wires: viewport && !viewport.closest('[hidden]') ? [...document.querySelectorAll('.fleet-wire-line')].map((path) => path.getTotalLength()) : [],
      tree: box(document.getElementById('fleet-tree')), inspector: box(document.getElementById('fleet-inspector')),
      rows: { table: document.querySelectorAll('#fleet-table .fleet-tr').length, recent: document.querySelectorAll('#fleet-recent .fleet-recent-row').length, nodes: document.querySelectorAll('#fleet-nodes .fleet-tnode').length, health: document.querySelectorAll('#fleet-health .fleet-signal').length },
    };`;
  const seats = first.view.pods.flatMap((pod) => pod.seats).length;
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await until("window.MefiFleet && window.MefiNav && !window.MefiBoot?.isActive?.()", "studio ready");
  report.registered = await run("const record = window.MefiNav.get('fleet'); return record ? { id: record.id, kind: record.kind, layer: record.layer, section: record.section, key: record.key, tools: record.showIn.tools, palette: record.showIn.palette, element: record.element } : null;");
  assert.deepEqual(report.registered, { id: "fleet", kind: "overlay", layer: "sheet", section: "agents", key: null, tools: true, palette: true, element: "fleet-overlay" });

  for (const [width, height, zoom] of [[1720, 900, 1], [1440, 900, 1], [1100, 720, 1], [600, 560, 1], [1100, 720, 1.25]]) {
    window.setContentSize(width, height); contents.setZoomFactor(zoom); await sleep(300);
    await run("if (window.MefiFleet.isOpen()) window.MefiFleet.close(); window.MefiNav.go('fleet', { tab: 'graph' });");
    await until(`document.querySelectorAll('.fleet-seat').length >= ${seats}`, `seats painted at ${width}x${height}@${zoom}`);
    await sleep(200);
    const label = `${width}x${height}@${zoom}`;
    for (const tab of ["graph", "table", "recent", "nodes", "health"]) {
      await run(`document.getElementById('fleet-tab-${tab}').click();`);
      await until(`!document.getElementById('fleet-${tab}').hidden`, `${tab} shown at ${label}`);
      await sleep(120);
      const m = await run(measure);
      report.layouts.push({ label, tab, ...m, cards: m.cards.length, wires: m.wires.length });
      assert.equal(m.pageOverflow, false, `${tab} overflows the page at ${label}`);
      assert.ok(m.sheet.x >= -1 && m.sheet.y >= -1 && m.sheet.r <= m.inner.w + 1 && m.sheet.b <= m.inner.h + 1, `the sheet fits at ${label}: ${JSON.stringify(m.sheet)}`);
      assert.deepEqual(m.shown, [`fleet-${tab}`], `only the ${tab} view shows at ${label}`);
      if (tab === "graph") {
        assert.ok(m.cards.length >= seats, `a card per seat at ${label}`);
        assert.ok(m.scale >= 0.3 && m.scale <= 1.25, `the fit scale is sane at ${label}: ${m.scale}`);
        for (const card of m.cards) {
          assert.ok(card.w > 40 && card.h > 15, `${card.id} has a size at ${label}`);
          assert.ok(card.x >= m.viewport.x - 1 && card.r <= m.viewport.r + 1 && card.y >= m.viewport.y - 1 && card.b <= m.viewport.b + 1, `${card.id} is in view after the fit at ${label}: ${JSON.stringify(card)} in ${JSON.stringify(m.viewport)}`);
        }
        for (const [index, a] of m.cards.entries()) for (const b of m.cards.slice(index + 1)) assert.ok(a.r <= b.x + 1 || b.r <= a.x + 1 || a.b <= b.y + 1 || b.b <= a.y + 1, `${a.id} overlaps ${b.id} at ${label}`);
        assert.ok(m.wires.length >= 8 && m.wires.every((length) => length > 10), `every wire has length at ${label}: ${m.wires.join(",")}`);
      }
      if (tab === "table") assert.equal(m.rows.table, seats, `a row per seat at ${label}`);
      if (tab === "recent") assert.ok(m.rows.recent >= 5, `recent rows at ${label}`);
      if (tab === "nodes") assert.ok(m.rows.nodes >= seats, `tree nodes at ${label}`);
      if (tab === "health") assert.ok(m.rows.health >= 1, `health signals at ${label}`);
      if (zoom === 1 && [1720, 1440, 600].includes(width)) await capture(`fleet-${width}-${tab}.png`);
    }
  }

  // Selection, the keyboard, a live push and Escape, at the desktop size.
  window.setContentSize(1440, 900); contents.setZoomFactor(1); await sleep(300);
  // A user arrives from another Agents page, so Back (the nav's Escape) has somewhere to go.
  await run("window.MefiFleet.close(); window.MefiNav.go('agents'); window.MefiNav.go('fleet', { tab: 'graph' });");
  await until(`document.querySelectorAll('.fleet-seat').length >= ${seats}`, "seats painted again");
  await run("document.querySelector('.fleet-seat[data-seat=\"builder-1\"]').click();");
  await until("document.getElementById('fleet-inspector').dataset.mode === 'seat' && document.querySelector('#fleet-inspector .fleet-gens')", "the inspector shows builder-1 and its runs");
  report.inspector = await run("const box = document.getElementById('fleet-inspector'); return { text: box.textContent.slice(0, 700), buttons: [...box.querySelectorAll('button')].map((button) => button.textContent) };");
  assert.match(report.inspector.text, /builder-1@fleet-fixture/);
  assert.match(report.inspector.text, /Editing main\.cjs/);
  assert.ok(report.inspector.buttons.includes("Open task") && report.inspector.buttons.includes("Open in Command"));
  assert.equal(await run("return document.querySelector('.fleet-stage').dataset.focus;"), "1", "selecting dims the other wires");
  await sleep(200);
  const drawer = await run("const card = document.querySelector('.fleet-seat[data-seat=\"builder-1\"]').getBoundingClientRect(), box = document.getElementById('fleet-inspector'), rect = box.getBoundingClientRect(); return { over: getComputedStyle(box).position === 'absolute', shown: rect.width > 0 && rect.height > 0, card: { l: card.left, r: card.right }, box: { l: rect.left, r: rect.right } };");
  assert.ok(drawer.shown, "the inspector is shown for a selected seat");
  if (drawer.over) assert.ok(drawer.card.r <= drawer.box.l + 1 || drawer.card.l >= drawer.box.r - 1, "the drawer does not cover the selected seat: " + JSON.stringify(drawer));
  report.drawer = drawer;
  await capture("fleet-selected.png");

  await run("document.querySelector('#fleet-tree .fleet-row[data-kind=\"team\"]').focus();");
  const stops = await run("return [...document.querySelectorAll('#fleet-tree .fleet-row')].filter((row) => row.tabIndex === 0).length;");
  assert.equal(stops, 1, "the explorer has one tab stop");
  await key("Down"); await key("Down");
  report.focusAfterDown = await run("return document.activeElement.dataset.kind + ':' + document.activeElement.querySelector('.fleet-row-name').textContent;");
  assert.match(report.focusAfterDown, /^(pod|seat):/, "the arrows move the focus down the tree");
  await run("document.querySelector('.fleet-seat[data-seat=\"builder-1\"]').focus();");
  await key("Down");
  await until("window.MefiFleet.current().selected === 'builder-2'", "the arrow key selects the next seat in the pod");

  const second = team({ progress: 0.9, step: "Running the tests", extra: true }).view;
  await run(`window.fleetFixture.push(${JSON.stringify(second)});`);
  await until("document.querySelector('.fleet-seat[data-seat=\"builder-1\"] .fleet-seat-line').textContent === 'Running the tests'", "a push updates the card");
  await run("document.getElementById('fleet-tab-recent').click();");
  await until("[...document.querySelectorAll('#fleet-recent .fleet-recent-text')].some((node) => /foreman to lead: a new card is ready/.test(node.textContent))", "the pushed row is in Recent");
  await run("document.getElementById('fleet-tab-graph').click();");
  report.calls = await run("return window.fleetFixture.calls().filter((call) => call.name.startsWith('fleet')).map((call) => call.name + ':' + JSON.stringify(call.args));");

  // What the review of the first version found, in a real renderer.
  // 1. A push that only moves progress leaves the inspector alone, so a Stop armed in it stays armed and focused.
  await run(`window.MefiFleet.select('builder-1');`);
  await until(`document.getElementById('fleet-inspector').dataset.mode === 'seat' && [...document.querySelectorAll('#fleet-inspector button')].some((button) => button.textContent === 'Stop this run')`, "the inspector offers Stop for builder-1");
  await sleep(700);
  const reads = "window.fleetFixture.calls().filter((call) => call.name === 'fleetSeat' && call.args[0] === 'builder-1').length";
  const readsBefore = await run(`return ${reads};`);
  await run(`window.__stop = [...document.querySelectorAll('#fleet-inspector button')].find((button) => button.textContent === 'Stop this run'); window.__stop.focus(); window.__stop.click();`);
  assert.equal(await run(`return window.__stop.textContent;`), "Stop it?", "the first press arms Stop");
  // Every push from the host carries a higher rev; that alone must not rebuild what the seat shows.
  const third = { ...team({ progress: 0.95, step: "Almost there", extra: true }).view, rev: 3 };
  await run(`window.fleetFixture.push(${JSON.stringify(third)});`);
  await until(`document.querySelector('.fleet-seat[data-seat="builder-1"] .fleet-seat-line').textContent === 'Almost there'`, "the push reaches the card");
  await sleep(900);
  assert.deepEqual(await run(`return { kept: document.querySelector('#fleet-inspector .fleet-ins-actions').contains(window.__stop), text: window.__stop.textContent, focused: document.activeElement === window.__stop, reads: ${reads} };`), { kept: true, text: "Stop it?", focused: true, reads: readsBefore }, "the push left the armed Stop where it was and did not read the runs again");
  await run(`window.__stop.blur();`);
  // 2. Pressing Stop in the table is about the button: the drawer must not slide over it.
  await run(`window.MefiFleet.select(null); document.getElementById('fleet-tab-table').click();`);
  await until(`!document.getElementById('fleet-table').hidden`, "the table shows");
  await run(`document.querySelectorAll('#fleet-table tr[data-key="builder-1"] .fleet-act')[1].click();`);
  await sleep(250);
  report.tableStop = await run(`return { selected: window.MefiFleet.current().selected, mode: document.getElementById('fleet-inspector').dataset.mode, text: document.querySelectorAll('#fleet-table tr[data-key="builder-1"] .fleet-act')[1].textContent };`);
  assert.deepEqual(report.tableStop, { selected: null, mode: "fleet", text: "Stop it?" }, "the press armed Stop and did not select the seat");
  // 3. The feed has one tab stop, and an empty or unread inspector never opens the drawer.
  await run(`document.getElementById('fleet-tab-recent').click();`);
  await until(`!document.getElementById('fleet-recent').hidden`, "the feed shows");
  assert.equal(await run(`return [...document.querySelectorAll('#fleet-recent .fleet-recent-text')].filter((button) => button.tabIndex === 0).length;`), 1, "the feed has one tab stop");
  report.emptyDrawer = await run(`const box = document.getElementById('fleet-inspector'); const mode = box.dataset.mode; delete box.dataset.mode; const display = getComputedStyle(box).display; box.dataset.mode = mode; return display;`);
  assert.equal(report.emptyDrawer, "none", "before the first read no empty drawer covers the graph");
  // 4. A pod that collapses or opens keeps the keyboard where it was.
  await run(`document.querySelector('#fleet-tree .fleet-item[data-key="pod:check"] .fleet-row').focus();`);
  await key("Left"); await sleep(150);
  assert.equal(await run(`return document.activeElement.closest('.fleet-item')?.dataset.key || '';`), "pod:check", "collapsing a pod keeps the focus on it");
  assert.equal(await run(`return document.querySelector('#fleet-tree .fleet-item[data-key="seat:desk"]') === null;`), true, "and the pod did collapse");
  await key("Right"); await sleep(150);
  assert.equal(await run(`return document.activeElement.closest('.fleet-item')?.dataset.key || '';`), "pod:check", "opening it keeps the focus too");
  await run(`document.getElementById('fleet-tab-graph').click(); window.MefiFleet.select('builder-1');`);
  await until(`document.getElementById('fleet-inspector').dataset.mode === 'seat'`, "builder-1 is selected again");

  // Escape steps back inside the page: a selected seat is cleared first and the page stays open.
  // (What Escape does after that is the nav's, and belongs to the menu overhaul.)
  // With the focus on the page's own body (the inspector just closed under it) Escape also hands it back to the seat.
  await run(`document.activeElement?.blur?.();`);
  await key("Escape");
  await until("window.MefiFleet.current().selected === null", "the first Escape clears the selection");
  assert.equal(await run(`return document.activeElement?.dataset?.seat || '';`), "builder-1", "and the keyboard goes back to the seat's card");
  assert.equal(await run("return window.MefiFleet.isOpen();"), true, "and leaves the page open");
  // The page's own Close button goes through the nav (Back) and gives the lease back.
  await run("document.getElementById('fleet-close').click();");
  await until("!window.MefiFleet.isOpen()", "the Close button leaves the page");
  const watches = await run("return window.fleetFixture.calls().filter((call) => call.name === 'fleetWatch').map((call) => call.args[0].on);");
  assert.equal(watches[0], true);
  assert.equal(watches.at(-1), false, "closing gives the lease back");
  assert.ok(report.calls.some((call) => call.startsWith("fleetSnapshot")) && report.calls.some((call) => call.startsWith("fleetSeat:")));
  assert.deepEqual(report.errors, [], "no console errors");
  report.complete = true;
  finish();
}).catch(finish);
