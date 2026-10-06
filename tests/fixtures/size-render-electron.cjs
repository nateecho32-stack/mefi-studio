"use strict";

// Size and density in a real Chromium: a copied booklet launched with ?layout=v2, a
// synthetic bridge, and a host whose interface scale really zooms the window. It opens
// the page at five window sizes (1920x1080, 1440x900, 1100x720, 600x560 and 600x560 at
// 150% zoom) and measures real geometry: nothing overflows the page, no scroller takes
// width for a bar, no text in it is under 12 px, the miniature sits inside its column.
// Then it drives the controls the way a person does, with real pointer and key events:
// a drag of each slider, a click on each choice, Tab through the page, and reads the
// miniature's real computed sizes (a row's padding, the tab strip's height, the words'
// font size, what a row shows) change while the window's root does not. Apply then moves
// the root, a probe that uses the same rules as the miniature row comes out the same as
// the miniature showed a moment before (what you see is what Apply gives you), the page's
// own rows follow, Undo and Reset put it back, and the interface scale zooms the real
// window and follows the keys. Every combination of text size, density and detail is
// applied and swept for overflow and small text, the way in from Settings, Configuration
// and Search is used.
// Screenshots: Compact, Comfortable and Spacious at 80, 100 and 130% text, and each size.
// No application main process or live state is loaded; network, permissions and child
// processes are blocked.
const { app, BrowserWindow, ipcMain, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_SIZE_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Size fixture directory is required");
const studio = path.resolve(__dirname, "..", "..");
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], shots: [], zoomCalls: [], tabTrail: [], matrix: 0, complete: false };
app.setName("Size Fixture");
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

const SIZES = [[1920, 1080, 1], [1440, 900, 1], [1100, 720, 1], [600, 560, 1], [600, 560, 1.5]];
const label = ([width, height, zoom]) => `${width}x${height}@${zoom}`;
const DENSITY = { compact: { row: 5, gh: 8, stp: 5, gap: 10, pad: 11, bub: 9, top: 44, tab: 34, set: 7 }, comfortable: { row: 8, gh: 12, stp: 8, gap: 14, pad: 14, bub: 12, top: 48, tab: 38, set: 10 }, spacious: { row: 11, gh: 16, stp: 11, gap: 20, pad: 18, bub: 15, top: 52, tab: 42, set: 13 } };
const SHOWS = { titles: { meta: "none", prog: "none", more: "none" }, status: { meta: "block", prog: "block", more: "none" }, all: { meta: "block", prog: "block", more: "flex" } };
const near = (a, b, tolerance = 0.02) => Math.abs(a - b) <= tolerance;

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
  const now = Date.now(), projectId = "size-project";
  const task = { id: "size-task", projectId, title: "Make the text bigger", prompt: "Let me choose how big the words are", status: "active", runId: "size-run", createdAt: now - 60000, updatedAt: now };
  const routing = { provider: "zen", roleProviders: {}, models: { routine: "gpt-6-luna", heavy: "gpt-6-sol" }, providerModels: {}, hasZen: true, hasOpenCode: false, hasZai: false, hasOpenRouter: false, hasCustom: false, autoProviders: ["zen", "codex"], autoFallback: true, modelSelection: "fixed", executorCli: "codex", executorModels: {}, executorTierModels: {}, executorTier: "auto", subscriptionFirst: true, lmStudioEndpoint: "http://127.0.0.1:1234/v1", customEndpoint: "", executorTierDefaults: {}, autoSetup: null };
  const configuration = { aiProvider: "zen", aiModels: routing.models, executorCli: "codex", agentBrain: { contextScout: true, deskTool: false, headDrafts: false, nestedDelegation: false } };
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Size fixture", path: root }] },
    tasksList: { ok: true, projectId, tasks: [task] }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: false, useReference: true, useTree: true, useWeb: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: {}, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, autoBuild: true, mode: "swarm", minutes: 5, parallel: 2, running: [], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, counts: { ready: 1, running: 1, blocked: 0, review: 0 }, taskStates: [], next: [] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getApiKey: { saved: false }, getAiRouting: routing, cliStatus: [], launchStudio: { ok: true }, jevStatus: { ok: true, enabled: false, route: "zen", routes: { vercel: false, typesafe: false, zen: true, openrouter: false } }, openrouterModels: { ok: true, models: [] }, agentModels: { ok: true, models: [] },
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [], skills: [], mcpTools: [], routing, seats: {}, choices: {}, efforts: ["minimal", "low", "medium", "high", "xhigh", "max"] },
    cliSetupStatus: { ok: true, selected: "auto", clis: [] }, firstRunStatus: { ok: true, firstRun: null },
    machineGet: { ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } }, updateStatus: { ok: true, status: { auto: true } },
    companionState: { ok: true, projectId, projectName: "Size fixture", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: false, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
    brainState: { ok: true, tasks: [], recent: [], pipelines: {} }, brainPlaybook: { ok: true, shelf: [], recipes: [] }, brainMap: { ok: true, map: { systems: [], edges: [], files: [] } },
    worktreesList: { ok: true, repo: false, projectId, enabled: { on: false, forced: false } }, skillsList: { ok: true, skills: [], roots: [] },
  };
  const names = await bridgeNames();
  const preload = path.join(root, "size-preload.cjs");
  // The window's scale is the real thing: the host zooms the page and answers with the factor it kept.
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');const responses=${JSON.stringify(responses)};const names=${JSON.stringify(names)};const calls=[];const subscribers={};
    const bridge={};
    for(const name of names){
      if(/^on[A-Z]/.test(name))bridge[name]=callback=>{(subscribers[name]??=[]).push(callback);return()=>{};};
      else bridge[name]=async(...args)=>{calls.push(name);return name in responses?JSON.parse(JSON.stringify(responses[name])):{ok:true};};
    }
    bridge.uiZoom=async(payload)=>{calls.push('uiZoom');return ipcRenderer.invoke('size-fixture:zoom',payload);};
    bridge.uiZoomGet=async()=>{calls.push('uiZoomGet');return ipcRenderer.invoke('size-fixture:zoom-get');};
    bridge.onUiZoom=callback=>{ipcRenderer.on('ui:zoom-changed',(_event,payload)=>callback(payload));};
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('sizeFixture',{calls:()=>calls.slice(),clear:()=>{calls.length=0;}});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));localStorage.setItem('mefiStudio.whatsNew.seen','vibe-build-1');
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(60); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  ipcMain.handle("size-fixture:zoom", (_event, { factor } = {}) => {
    const value = Math.min(1.5, Math.max(0.7, Math.round(Number(factor) * 20) / 20));
    contents.setZoomFactor(value); report.zoomCalls.push(value);
    return { ok: true, factor: value };
  });
  ipcMain.handle("size-fixture:zoom-get", () => ({ ok: true, factor: contents.getZoomFactor() }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, what, ms = 15000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "size-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${what}`);
  };
  const capture = async (name, keepToasts = false) => {
    // Notices from earlier steps (Configuration's "Interface scale 130%" echo of a zoom push, an old Undo) are not what a screenshot is for.
    await run(`if (!${keepToasts}) for (const notice of document.querySelectorAll('#toast-host .toast')) notice.remove(); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
    await sleep(150);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
    report.shots.push(name);
  };
  const key = async (keyCode, modifiers = []) => { contents.sendInputEvent({ type: "keyDown", keyCode, modifiers }); contents.sendInputEvent({ type: "keyUp", keyCode, modifiers }); await sleep(70); };
  // The window's real zoom, as the host has it; the page hears about a change the way the app does (Ctrl + pushes).
  const pageZoom = () => contents.getZoomFactor();
  const dip = (x, y) => ({ x: Math.round(x * pageZoom()), y: Math.round(y * pageZoom()) });
  const rectOf = (selector) => run(`const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; const box = node.getBoundingClientRect(); return { x: box.left, y: box.top, r: box.right, b: box.bottom, w: box.width, h: box.height };`);
  const click = async (selector) => {
    // Where the page has one column a picture is kept in view above the controls, so the middle of the pane may be under it: try where a
    // pointer reaches the control (the frame leaves the page less room than the window has).
    let reached = false;
    for (const block of ["center", "end", "start"]) {
      await run(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: ${JSON.stringify(block)}, behavior: "instant" }); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));`); await sleep(80);
      reached = await run(`const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return Boolean(hit) && (hit === node || node.contains(hit));`);
      if (reached) break;
    }
    const box = await rectOf(selector); assert.ok(box && box.w > 0, `${selector} is on screen to be clicked`);
    assert.equal(reached, true, `${selector} can be reached by a pointer (not under the kept picture or a bar)`);
    const point = dip(box.x + box.w / 2, box.y + box.h / 2);
    contents.sendInputEvent({ type: "mouseMove", ...point }); contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point }); contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
    await sleep(120);
  };
  // A real drag of a range input's thumb to a value: press it where it is, move, release.
  const drag = async (id, to) => {
    // The page scrolls inside itself, and where it has one column a picture is kept in view above the controls: bring the slider to
    // somewhere a pointer can reach it (the frame leaves the page less room than the window has, so the controls are not always in view).
    let reached = false;
    for (const block of ["end", "center", "start"]) {
      await run(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: ${JSON.stringify(block)}, behavior: "instant" }); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));`);
      reached = await run(`const input = document.getElementById(${JSON.stringify(id)}); const r = input.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === input || input.contains(hit);`);
      if (reached) break;
    }
    assert.equal(reached, true, `a pointer reaches the ${id} slider`);
    const box = await rectOf(`#${id}`); const { min, max, value } = await run(`const input = document.getElementById(${JSON.stringify(id)}); return { min: Number(input.min), max: Number(input.max), value: Number(input.value) };`);
    const at = (v) => ({ x: box.x + 9 + (box.w - 18) * ((v - min) / (max - min)), y: box.y + box.h / 2 });
    const start = dip(at(value).x, at(value).y), end = dip(at(to).x, at(to).y);
    contents.sendInputEvent({ type: "mouseMove", ...start });
    contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...start });
    for (const step of [0.25, 0.5, 0.75, 1]) { contents.sendInputEvent({ type: "mouseMove", x: Math.round(start.x + (end.x - start.x) * step), y: start.y, button: "left", modifiers: ["leftButtonDown"] }); await sleep(30); }
    contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...end });
    await sleep(150);
  };
  const resize = async ([width, height, zoom]) => {
    const before = pageZoom();
    window.setContentSize(width, height); contents.setZoomFactor(zoom);
    // The window's scale is the page's to know: the host says so when it changes, as it does for Ctrl + and Ctrl -.
    if (Math.abs(before - zoom) > 0.0001) contents.send("ui:zoom-changed", { factor: zoom });
    const wanted = Math.round(width / zoom);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { const inner = await run("return innerWidth;"); if (Math.abs(inner - wanted) <= 1) break; await sleep(60); }
    await sleep(250);
    const inner = await run("return [innerWidth, innerHeight];");
    assert.ok(Math.abs(inner[0] - wanted) <= 1, `the window is ${inner[0]} CSS px wide, expected ${wanted}`);
  };
  const open = async () => { await run("window.MefiNav.go('size');"); await until("!document.getElementById('size-overlay').hidden && document.getElementById('size-mini')", "the page is up"); await sleep(250); };
  const shut = () => run("if (window.MefiSize.isOpen()) window.MefiNav.closeAll(); await new Promise((resolve) => setTimeout(resolve, 100));");

  // What the page looks like right now, in real pixels.
  const measure = `
    const box = (node) => { const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const overlay = document.getElementById('size-overlay'), sheet = overlay.querySelector('.size-sheet'), body = document.getElementById('size-body');
    const side = document.getElementById('size-preview'), host = document.getElementById('size-mini-host'), win = overlay.querySelector('.size-mini-win');
    const all = [...overlay.querySelectorAll('*')];
    const textOf = (node) => [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
    const visible = (node) => { for (let n = node; n && n !== overlay; n = n.parentElement) if (getComputedStyle(n).display === 'none') return false; return true; };
    const scrollers = all.filter((node) => /(auto|scroll)/.test(getComputedStyle(node).overflowY + getComputedStyle(node).overflowX)).map((node) => ({ name: node.className || node.id, gutter: node.offsetWidth - node.clientWidth, vgutter: node.offsetHeight - node.clientHeight }));
    const small = all.filter((node) => textOf(node) && visible(node) && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => (node.className || node.tagName) + ':' + getComputedStyle(node).fontSize);
    const bodyBox = box(body), bodyStyle = getComputedStyle(body);
    const wide = all.filter((node) => !node.closest('.size-mini-host') && visible(node) && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().right > bodyBox.r + 1).map((node) => (node.className || node.tagName) + ' ' + Math.round(node.getBoundingClientRect().right) + '>' + Math.round(bodyBox.r));
    return {
      inner: { w: innerWidth, h: innerHeight }, sheet: box(sheet), body: bodyBox, side: box(side), host: box(host), win: box(win),
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      bodyOverflowX: body.scrollWidth > body.clientWidth + 1, scrollbarWidth: getComputedStyle(body).scrollbarWidth,
      scrollers, small, wide, fit: parseFloat(document.getElementById('size-mini').style.getPropertyValue('--mini-fit')) || 1, paneHeight: body.clientHeight,
      room: body.clientWidth - parseFloat(bodyStyle.paddingLeft) - parseFloat(bodyStyle.paddingRight), stuck: getComputedStyle(side).position, columns: getComputedStyle(document.querySelector('.size-wrap')).gridTemplateColumns.split(' ').length,
    };`;
  const assertFits = (m, tag) => {
    assert.equal(m.pageOverflow, false, `${tag}: the page overflows`);
    assert.equal(m.bodyOverflowX, false, `${tag}: the page scrolls sideways`);
    assert.equal(m.scrollbarWidth, "none", `${tag}: native bars stay hidden`);
    for (const scroller of m.scrollers) assert.deepEqual([scroller.gutter, scroller.vgutter], [0, 0], `${tag}: ${scroller.name} reserves width or height for a bar`);
    assert.deepEqual(m.small, [], `${tag}: no text under 12 px`);
    assert.deepEqual(m.wide, [], `${tag}: nothing leaves the page's right edge`);
    assert.ok(m.sheet.x >= -1 && m.sheet.y >= -1 && m.sheet.r <= m.inner.w + 1 && m.sheet.b <= m.inner.h + 1, `${tag}: the page fits the window ${JSON.stringify(m.sheet)}`);
    assert.ok(m.host.x >= m.side.x - 1 && m.host.r <= m.side.r + 1, `${tag}: the miniature sits inside its column ${JSON.stringify(m.host)} in ${JSON.stringify(m.side)}`);
    assert.ok(m.win.r <= m.host.r + 1 && m.win.x >= m.host.x - 1 && m.win.w > 50 && m.win.h > 28, `${tag}: and is whole inside its frame ${JSON.stringify(m.win)}`);
    assert.ok(near(m.win.w / m.win.h, 760 / 440, 0.02), `${tag}: with the window's proportions`);
    assert.ok(m.fit >= 0.2 && m.fit <= 1.25, `${tag}: shrunk by ${m.fit}`);
  };
  // Where the labels under a slider really are against where its thumb is at 100%: the middle one is not mid-way.
  const assertTicks = async (id, tag) => {
    const t = await run(`
      const input = document.getElementById(${JSON.stringify(id)}), box = input.getBoundingClientRect();
      const spans = [...input.parentNode.querySelectorAll('.size-ticks span')].map((node) => { const r = node.getBoundingClientRect(); return { label: node.textContent, left: r.left, right: r.right, mid: (r.left + r.right) / 2 }; });
      return { x: box.left, w: box.width, min: Number(input.min), max: Number(input.max), spans };`);
    assert.equal(t.spans.length, 3, `${tag}: three labels under ${id}`);
    assert.ok(near(t.spans[0].left, t.x, 1.5) && near(t.spans[2].right, t.x + t.w, 1.5), `${tag}: the first label starts and the last ends with the track`);
    const share = (100 - t.min) / (t.max - t.min), thumb = t.x + 9 + (t.w - 18) * share;
    assert.ok(near(t.spans[1].mid, thumb, 4), `${tag}: the 100% label (${Math.round(t.spans[1].mid)}) is under the thumb's place for 100% (${Math.round(thumb)}) on ${id}`);
  };
  // The miniature's real computed sizes, the root's, and a probe that reads the root's (same rules, outside the miniature).
  const minis = () => run(`
    const mini = document.getElementById('size-mini'), cs = (selector, scope = mini) => getComputedStyle(scope.querySelector(selector));
    const length = (value) => parseFloat(value);
    return { density: mini.dataset.miniDensity, detail: mini.dataset.miniDetail,
      row: length(cs('.sm-row').paddingTop), gh: length(cs('.sm-gh').paddingTop), top: length(cs('.sm-top').height), tab: length(cs('.sm-tabs').height), chip: length(cs('.sm-tab').height), gap: length(cs('.sm-thread').rowGap), pad: length(cs('.sm-ipad').paddingTop), bub: length(cs('.sm-bubble').paddingTop),
      title: length(cs('.sm-t').fontSize), meta: length(cs('.sm-m').fontSize), bubbleText: length(cs('.sm-bubble').fontSize), shows: { meta: cs('.sm-m').display, prog: cs('.sm-rp').display, more: cs('.sm-rx').display },
      scale: getComputedStyle(mini).getPropertyValue('--text-scale').trim(), zoom: getComputedStyle(mini).getPropertyValue('--mini-zoom').trim() };`);
  const rootNow = () => run(`
    const root = document.documentElement, style = getComputedStyle(root);
    return { density: root.dataset.density, detail: root.dataset.detail, scale: style.getPropertyValue('--text-scale').trim(), row: style.getPropertyValue('--d-row').trim(), tab: style.getPropertyValue('--d-tab').trim(), meta: style.getPropertyValue('--dt-meta').trim(), stored: localStorage.getItem('mefiStudio.appearance') };`);
  const probeNow = () => run(`
    let probe = document.getElementById('size-probe');
    if (!probe) { probe = document.createElement('div'); probe.id = 'size-probe'; probe.style.cssText = 'position:absolute;left:0;top:0;width:260px;visibility:hidden;pointer-events:none'; probe.innerHTML = '<div class="sm-row"><span class="sm-dot sm-run"></span><div class="sm-rb"><span class="sm-t">Probe</span><div class="sm-m">probe</div></div></div><div class="sm-gh">Group</div><div class="sm-bubble">Bubble</div>'; document.getElementById('size-body').append(probe); }
    const cs = (selector) => getComputedStyle(probe.querySelector(selector)), length = (value) => parseFloat(value);
    return { row: length(cs('.sm-row').paddingTop), gh: length(cs('.sm-gh').paddingTop), bub: length(cs('.sm-bubble').paddingTop), title: length(cs('.sm-t').fontSize), meta: length(cs('.sm-m').fontSize), metaDisplay: cs('.sm-m').display };`);
  const pageRows = () => run(`const hint = document.querySelector('.size-hint'), second = document.querySelectorAll('.size-row')[1]; return { set: parseFloat(getComputedStyle(second).paddingTop), hint: parseFloat(getComputedStyle(hint).fontSize), label: parseFloat(getComputedStyle(document.querySelector('.size-label label')).fontSize) };`);
  const expectMini = (m, { density, detail, text }, tag) => {
    const d = DENSITY[density], s = SHOWS[detail];
    assert.deepEqual([m.density, m.detail], [density, detail], `${tag}: the miniature's own scope`);
    // The picture is zoomed, so a length comes back as a device pixel count over the zoom: a hair off a whole number.
    const real = [m.row, m.gh, m.top, m.tab, m.chip, m.gap, m.pad, m.bub], want = [d.row, d.gh, d.top, d.tab, d.tab - 10, d.gap, d.pad, d.bub];
    assert.ok(real.every((value, index) => near(value, want[index], 0.1)), `${tag}: its real paddings, bar heights and gaps are ${density}'s: ${JSON.stringify(real)} for ${JSON.stringify(want)}`);
    assert.ok(near(m.title, Math.max(12, 13.5 * text)) && near(m.meta, Math.max(12, 12 * text)) && near(m.bubbleText, Math.max(12, 14 * text)), `${tag}: its real text sizes are max(12px, N * ${text}): ${m.title} ${m.meta} ${m.bubbleText}`);
    assert.deepEqual(m.shows, s, `${tag}: a row shows what ${detail} says`);
  };

  // ---- the page, in v2 --------------------------------------------------------------------------
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1", layout: "v2" } });
  await until("window.MefiSize && window.MefiNav && window.MefiVibe && window.MefiConfig && !window.MefiBoot?.isActive?.()", "studio ready");
  await until("window.MefiNav.get('size')", "the page is registered");
  assert.equal(await run("return document.documentElement.dataset.layout;"), "v2");
  report.registered = await run("const record = window.MefiNav.get('size'); return { id: record.id, kind: record.kind, layer: record.layer, section: record.section, key: record.key, element: record.element, glyph: record.glyph, label: record.label, palette: record.showIn.palette, tools: record.showIn.tools, dock: record.showIn.dock, focus: record.focus };");
  assert.deepEqual(report.registered, { id: "size", kind: "overlay", layer: "sheet", section: "settings", key: null, element: "size-overlay", glyph: "g-textsize", label: "Size and density", palette: true, tools: false, dock: false, focus: "#size-zoom" });
  assert.equal(await run("return Boolean(document.getElementById('g-textsize'));"), true, "the glyph is in the sprite");
  assert.equal(await run("return window.MefiNav.list({ showIn: 'palette' }).some((record) => record.id === 'size' && record.label === 'Size and density');"), true, "Search lists it by its name");
  const first = await rootNow();
  assert.deepEqual([first.density, first.detail, first.scale, first.row, first.tab], ["comfortable", "status", "1", "8px", "38px"], "a v2 window starts with the defaults on its root");
  assert.equal(first.stored, null, "and stores nothing it was not asked to");

  // ---- five window sizes ------------------------------------------------------------------------------
  for (const size of SIZES) {
    await resize(size); await shut(); await open();
    const tag = label(size);
    const m = await run(measure);
    report.layouts.push({ label: tag, columns: m.columns, sticky: m.stuck, fit: m.fit, win: [Math.round(m.win.w), Math.round(m.win.h)] });
    assertFits(m, tag);
    await assertTicks("size-zoom", tag); await assertTicks("size-text", tag);
    // The page lays itself out by the room it is given (a container query at 720 px), and with the new layout's frame that is what the
    // window leaves beside the rail, the list and the inspector, not the window's own width.
    assert.equal(m.columns === 2, m.room > 720, `${tag}: two columns when the page has room for them, one when it has not (${Math.round(m.room)} px of room)`);
    if (m.columns === 1) assert.equal(m.stuck, size[1] / size[2] > 520 ? "sticky" : "static", `${tag}: the picture is kept in view unless the window is too short`);
    if (m.stuck === "sticky") assert.ok(m.side.h <= m.paneHeight * 0.68, `${tag}: a picture that is kept in view leaves room for the controls: ${Math.round(m.side.h)} of ${m.paneHeight}`);
    if (m.columns === 2) assert.ok(m.fit > 0.5, `${tag}: a wide page draws the picture large: ${m.fit}`);
    assert.equal(await run("return document.activeElement.id;"), "size-zoom", `${tag}: the first control has the keyboard`);
    assert.deepEqual(await run("return [...document.querySelectorAll('#size-overlay [hidden]')].map((node) => node.id);"), ["size-discard"], `${tag}: only Discard is hidden, and only because there is no draft`);
    await capture(`size-${tag}.png`);
  }

  // ---- the controls, at the size most people use --------------------------------------------------------
  await resize([1440, 900, 1]); await shut(); await open();
  const startRoot = await rootNow();
  const startMini = await minis();
  expectMini(startMini, { density: "comfortable", detail: "status", text: 1 }, "at the start");
  assert.equal(await run("return document.getElementById('size-apply').disabled;"), true, "nothing to apply yet");
  // Tab walks the page in order: two sliders, the two choices (one stop each), then the buttons that can be pressed.
  await run("document.getElementById('size-zoom').focus();");
  const trail = [];
  // An "i" circle (MefiUi.info) has no id or text of its own: it is named by its aria-label.
  const here = () => run("const node = document.activeElement; return node ? (node.id || node.dataset.value || (node.classList.contains('info-dot') ? node.getAttribute('aria-label') : '') || node.textContent.trim().slice(0, 20)) + (document.getElementById('size-overlay').contains(node) ? '' : ' (outside)') : 'none';");
  trail.push(await here());
  for (let step = 0; step < 6; step += 1) { await key("Tab"); trail.push(await here()); }
  report.tabTrail = trail;
  assert.deepEqual(trail, ["size-zoom", "size-text", "comfortable", "status", "More about Panels", "More about Preview", "size-reset"], "sliders, then the checked choice of each group, the Panels and Preview \"i\" circles, then Reset: Apply is disabled and Discard is hidden, so neither takes a stop");
  for (let step = 0; step < 3; step += 1) await key("Tab", ["shift"]);
  assert.equal(await here(), "status", "Shift+Tab goes back past the two circles to Detail's stop");
  await key("Left"); // on Detail: a radio moves with the arrow
  assert.equal(await run("return window.MefiSize.draft().detail;"), "titles", "an arrow moves a choice");
  assert.equal(await here(), "titles", "and takes the keyboard with it");
  await key("Right"); await key("Right");
  assert.equal(await run("return window.MefiSize.draft().detail;"), "all");
  await key("Home");
  assert.equal(await run("return window.MefiSize.draft().detail;"), "titles");
  await run("window.MefiSize.discard(); document.getElementById('size-zoom').focus();");
  await key("Right");
  assert.equal(await run("return window.MefiSize.draft().zoom;"), 105, "a slider moves by its step");
  await key("End");
  assert.equal(await run("return window.MefiSize.draft().zoom;"), 150);
  await run("window.MefiSize.discard();");

  // Drag each control. The miniature's real sizes change; the root's do not.
  await drag("size-zoom", 130);
  let m = await minis();
  assert.equal(await run("return window.MefiSize.draft().zoom;"), 130, "a real drag moves the scale");
  assert.equal(m.zoom, "1.3", "and the miniature is drawn zoomed by 130 over the 100 the window has");
  await drag("size-text", 130);
  m = await minis();
  expectMini(m, { density: "comfortable", detail: "status", text: 1.3 }, "after dragging the text size");
  assert.equal(await run("return document.getElementById('size-text-out').textContent;"), "130% · Very large");
  await click('#size-density button[data-value="compact"]');
  await click('#size-detail button[data-value="all"]');
  m = await minis();
  expectMini(m, { density: "compact", detail: "all", text: 1.3 }, "after clicking a density and a detail");
  assert.deepEqual(await rootNow(), startRoot, "the window's root has none of it: not its density, its detail, its text scale, its tokens, nor its storage");
  assert.equal(await run("return document.getElementById('size-apply').disabled;"), false, "there is something to apply");
  assert.equal(await run("return document.getElementById('size-discard').hidden;"), false);
  assert.equal(await run("return document.getElementById('size-state').textContent;"), "Not applied yet");
  assert.equal(report.zoomCalls.length, 0, "and the window was never zoomed by a preview");
  assert.ok((await run("return window.sizeFixture.calls().filter((name) => name === 'uiZoom').length;")) === 0);
  await capture("size-draft-compact-all-130.png");

  // Apply: the root moves, a probe that reads the root comes out the same as the miniature did, the page follows.
  const shown = m;
  await run("window.sizeFixture.clear();");
  await click("#size-apply");
  await until("document.documentElement.dataset.density === 'compact'", "Apply reaches the root");
  await sleep(250);
  const applied = await rootNow();
  assert.deepEqual([applied.density, applied.detail, applied.scale, applied.row, applied.tab, applied.meta], ["compact", "all", "1.3", "5px", "34px", "block"], "the root has the draft now");
  assert.deepEqual(JSON.parse(applied.stored), { preset: "studio", density: "compact", glass: 45, glow: 35, v: 2, text: 1.3, detail: "all" }, "saved in the appearance store with the keys it always had");
  assert.deepEqual(report.zoomCalls, [1.3], "and the window was zoomed, once, by the host");
  assert.ok(near(pageZoom(), 1.3), "really");
  await until("Math.abs(innerWidth * 1.3 - 1440) < 3", "the window is 1.3 times closer");
  const probe = await probeNow();
  assert.deepEqual([probe.row, probe.gh, probe.bub], [shown.row, shown.gh, shown.bub], "what the miniature showed is what the window gives: the same rows, from the same tokens");
  assert.ok(near(probe.title, shown.title) && near(probe.meta, shown.meta), "and the same text");
  assert.equal(probe.metaDisplay, shown.shows.meta);
  const rows = await pageRows();
  assert.ok(near(rows.set, DENSITY.compact.set) && near(rows.hint, Math.max(12, 12.5 * 1.3)) && near(rows.label, Math.max(12, 13.5 * 1.3)), `the page's own rows are a v2 region too: ${JSON.stringify(rows)}`);
  assert.equal(await run("return document.getElementById('size-apply').disabled;"), true);
  assert.equal(await run("return document.getElementById('size-zoom').value;"), "130", "the scale slider says what the window has");
  assert.equal((await minis()).zoom, "1", "and the picture is the window again, not a zoomed copy of it");
  assert.match(await run("return document.getElementById('toast-host').textContent;"), /Applied to the whole window: 130% · very large text · compact · everything\.Undo/);
  assert.equal(await run("return document.getElementById('size-applied').textContent;"), "The window now: 130% · very large text · compact · everything.");
  assert.deepEqual(await run("return window.sizeFixture.calls().filter((name) => name === 'uiZoom');"), ["uiZoom"]);
  assertFits(await run(measure), "applied at 130%");
  await capture("size-applied-compact-all-130.png", true);

  // Undo puts all four back, for real.
  await click("#toast-host .toast-action");
  await until("document.documentElement.dataset.density === 'comfortable'", "Undo reaches the root");
  await sleep(250);
  assert.deepEqual({ ...(await rootNow()), stored: null }, { ...startRoot, stored: null }, "the root is as it was");
  assert.ok(near(pageZoom(), 1), "and the window's zoom");
  assert.deepEqual(report.zoomCalls, [1.3, 1]);
  assert.equal(await run("return document.getElementById('size-text').value + '/' + document.getElementById('size-zoom').value;"), "100/100");
  expectMini(await minis(), { density: "comfortable", detail: "status", text: 1 }, "after Undo");

  // Reset from somewhere else, and Discard.
  await run("await window.MefiSize.apply({ zoom: 115, text: 0.8, density: 'spacious', detail: 'titles' });");
  await sleep(250);
  assert.ok(near(pageZoom(), 1.15));
  await run("window.MefiSize.preview({ text: 1.4 });");
  await click("#size-discard");
  assert.equal(await run("return window.MefiSize.dirty();"), false, "Discard drops the draft");
  assert.equal(await run("return document.getElementById('size-text').value;"), "80");
  await click("#size-reset");
  await until("document.documentElement.dataset.density === 'comfortable'", "Reset reaches the root");
  await sleep(250);
  assert.deepEqual({ ...(await rootNow()), stored: null }, { ...startRoot, stored: null });
  assert.ok(near(pageZoom(), 1));
  assert.match(await run("return document.getElementById('toast-host').textContent;"), /Back to the defaults: 100%, default text, comfortable, titles and status\./);

  // Leaving with a draft keeps it.
  await run("window.MefiSize.preview({ density: 'spacious', text: 1.2 });");
  await shut();
  assert.equal(await run("return window.MefiSize.isOpen();"), false);
  await open();
  assert.deepEqual(await run("return [document.getElementById('size-text').value, document.getElementById('size-apply').disabled, document.getElementById('size-state').textContent];"), ["120", false, "Not applied yet"], "the draft is where it was left");
  await run("window.MefiSize.discard();");

  // The interface scale follows the keys, and a chosen one is not taken away.
  contents.send("ui:zoom-changed", { factor: 1.2 }); contents.setZoomFactor(1.2); await sleep(250);
  assert.equal(await run("return document.getElementById('size-zoom').value;"), "120", "Ctrl + moved the slider");
  assert.equal(await run("return document.getElementById('size-apply').disabled;"), true, "and left nothing to apply");
  await drag("size-zoom", 100);
  contents.send("ui:zoom-changed", { factor: 1.3 }); contents.setZoomFactor(1.3); await sleep(250);
  assert.equal(await run("return document.getElementById('size-zoom').value;"), "100", "a scale that was chosen stays");
  assert.equal((await minis()).zoom, String(Math.round((100 / 130) * 10000) / 10000), "and the picture is that against what the window has");
  contents.send("ui:zoom-changed", { factor: 1 }); contents.setZoomFactor(1); await sleep(250);
  await run("window.MefiSize.discard();");

  // ---- every combination of text, density and detail, applied and swept --------------------------------
  let combos = 0;
  for (const text of [0.8, 1, 1.4]) for (const density of ["compact", "comfortable", "spacious"]) for (const detail of ["titles", "status", "all"]) {
    await run(`await window.MefiSize.apply({ text: ${text}, density: ${JSON.stringify(density)}, detail: ${JSON.stringify(detail)} });`);
    await sleep(140);
    const tag = `${text}/${density}/${detail}`;
    const at = await run(measure);
    assertFits(at, tag);
    const root = await rootNow();
    assert.deepEqual([root.density, root.detail, root.scale], [density, detail, String(text)], tag);
    expectMini(await minis(), { density, detail, text }, `${tag} (applied)`);
    const probeAt = await probeNow();
    assert.ok(near(probeAt.title, Math.max(12, 13.5 * text)) && probeAt.row === DENSITY[density].row, `${tag}: a probe on the root`);
    combos += 1;
  }
  report.matrix = combos;
  assert.equal(combos, 27);
  // The worst of them in the smallest window at 150%.
  await resize([600, 560, 1.5]);
  await run("await window.MefiSize.apply({ text: 1.4, density: 'spacious', detail: 'all' });");
  await sleep(300);
  for (const [text, density, detail] of [[1.4, "spacious", "all"], [1.4, "spacious", "titles"], [0.8, "compact", "titles"]]) {
    await run(`await window.MefiSize.apply({ text: ${text}, density: ${JSON.stringify(density)}, detail: ${JSON.stringify(detail)} });`);
    await sleep(200);
    assertFits(await run(measure), `600x560@1.5 at ${text}/${density}/${detail}`);
  }
  await run("await window.MefiSize.apply({ text: 1.4, density: 'spacious', detail: 'all' });");
  await sleep(250);
  await capture("size-600x560@1.5-largest.png");
  // The page does not trap the person in it at the largest setting: Reset is reachable and works.
  await run("document.getElementById('size-body').scrollTop = document.getElementById('size-body').scrollHeight;");
  await run("await window.MefiSize.reset();");
  await resize([1440, 900, 1]);
  await sleep(250);

  // ---- the pictures: Compact, Comfortable and Spacious at 80, 100 and 130% text ------------------------------
  for (const density of ["compact", "comfortable", "spacious"]) for (const text of [0.8, 1, 1.3]) {
    await run(`window.MefiSize.preview({ density: ${JSON.stringify(density)}, text: ${text}, detail: 'status' });`);
    await sleep(200);
    expectMini(await minis(), { density, detail: "status", text }, `the picture at ${density}/${text}`);
    await capture(`size-${density}-${Math.round(text * 100)}.png`);
  }
  await run("window.MefiSize.discard();");

  // ---- the way in --------------------------------------------------------------------------------------
  // Settings > Appearance: the Density list is now a pointer to this page.
  await shut();
  await run("window.MefiNav.go('studio', { section: 'appearance' });");
  await until("document.querySelector('[data-appearance-section=\"interface\"]')?.getClientRects().length > 0", "the Appearance editor is up");
  await click('[data-appearance-section="interface"]');
  await until("document.querySelector('[data-size-link=\"row\"]') && document.querySelector('[data-size-link=\"row\"]').getClientRects().length > 0", "the Appearance card shows the row");
  report.settingsRow = await run("const row = document.querySelector('[data-size-link=\"row\"]'); const old = document.getElementById('studio-density').closest('.studio-field'); return { text: row.textContent, oldHidden: old.hidden, oldShown: old.getClientRects().length > 0 };");
  assert.deepEqual([report.settingsRow.oldHidden, report.settingsRow.oldShown], [true, false], "the old Density row is out of the way");
  assert.match(report.settingsRow.text, /Size and density100% · default text · comfortable · titles and statusOpen Size and density/);
  await click('[data-size-link="row"] button');
  await until("window.MefiSize.isOpen()", "the row opens the page");
  // Back with no history behind it goes to Settings.
  await click("#size-close");
  await until("!window.MefiSize.isOpen() && window.MefiNav.current() === 'studio'", "Close goes back to Settings");
  // Configuration > UI & Surfaces lists it, and picking it opens it (from Home: the Appearance editor would take the click for one outside it).
  await run("window.MefiNav.go('workspace');");
  await until("document.body.classList.contains('workspace-active') && document.getElementById('app-rail')", "Home is up");
  await run("window.MefiConfig.open({ category: 'ui' });");
  await until("[...document.querySelectorAll('#config-pane .config-item-title')].some((node) => node.textContent === 'Size and density')", "Configuration lists it");
  assert.equal(await run("return [...document.querySelectorAll('#config-pane .config-group-name')].map((node) => node.textContent).includes('Settings › Appearance');"), true);
  await click('#config-pane .config-item[data-setting="settings:size"]');
  await until("window.MefiSize.isOpen() && document.getElementById('config-overlay').hidden", "picking it opens the page and Configuration steps aside");
  await shut();
  // Search finds it by name.
  await run("window.MefiPalette.open();");
  await until("!document.getElementById('palette-overlay').hidden", "Search is up");
  await run("const input = document.getElementById('palette-input'); input.value = 'size and density'; input.dispatchEvent(new Event('input', { bubbles: true }));");
  await sleep(300);
  report.palette = await run("return [...document.querySelectorAll('#palette-overlay [role=\"option\"], #palette-overlay .palette-item, #palette-overlay li')].map((node) => node.textContent.trim().slice(0, 80)).slice(0, 4);");
  assert.ok(report.palette.some((text) => /Size and density/.test(text)), `Search lists Size and density: ${JSON.stringify(report.palette)}`);
  await run("window.MefiPalette.close();");
  // Another module (the status bar's Layout menu) opens it with MefiSize.open(): through the navigation, so it is a route of Settings like any other.
  await run("window.MefiNav.go('workspace');");
  await until("document.body.classList.contains('workspace-active')", "Home is up");
  assert.equal(await run("return window.MefiSize.open();"), true);
  await until("window.MefiSize.isOpen() && window.MefiNav.current() === 'size'", "open() enters the page through the navigation");
  await click("#size-close");
  await until("!window.MefiSize.isOpen() && window.MefiNav.current() === 'studio'", "Back is within Settings, where the page lives, whichever way it was entered");

  assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
  report.complete = true;
  finish();
}).catch(finish);
