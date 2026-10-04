"use strict";

// The shell's layout contract in a real Chromium (docs/unified-studio.md,
// "Layout contract"): a copied booklet, a synthetic bridge, no live state. The
// window is put through four sizes (1920x1080, 1440x900, 1100x720 and 600x560
// at zoom 1.5), Build and Vibe, the menu closed and pinned, and every place
// something is drawn is measured: the rail, the local navigation, every
// destination the registry says has a layer, Home, Vibe and Command, the tab
// pages, the toasts and a few computed offsets.
//
//   1. v1 (no html[data-layout]) must reproduce tests/fixtures/layout-contract-v1.json
//      to the hundredth of a pixel. That file was recorded on the base commit,
//      before the layout contract touched a single rule; set MEFI_LAYOUT_RECORD_TO
//      to an absolute path to write a new one instead of comparing (only ever
//      done on purpose, with the reason in the commit).
//   2. v2 with sample regions (list 280, inspector 400, tab strip 36, status
//      bar 28, drawn here as fixture-only boxes because the real regions are
//      built later): no page overlaps a region or leaves the window, the
//      floating things stay inside MefiNav.usable(), small windows fold the
//      list and the inspector, and nothing gets a scrollbar. Then v1 again:
//      turning v2 off must give the recorded numbers back.
//
// Network, permissions and child processes are blocked. Set the capture
// folder variable of the test file to keep the screenshots.
//
// For debugging only, never for the gate: MEFI_LAYOUT_PHASE=v1 stops after the
// v1 comparison and =v2 takes the record as given and goes straight to v2;
// MEFI_LAYOUT_ONLY=<text> walks only the v1 configurations whose label contains
// it (1440x900@1/build/closed); MEFI_LAYOUT_V2_ONLY=<window>/<mode>,... walks
// only those v2 windows (1100x720@1/vibe,600x560@1.5/build). The test file then
// reports that v1 was not compared, which is the point.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_LAYOUT_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated layout fixture directory is required");
const studio = path.resolve(__dirname, "..", "..");
const recordTo = process.env.MEFI_LAYOUT_RECORD_TO || "";
const baselinePath = path.join(__dirname, "layout-contract-v1.json");
const report = { errors: [], networkAttempts: [], processAttempts: [], v1: {}, v2: {}, shots: [] };
app.setName("Layout Contract Fixture");
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

// The four window sizes of the contract, in device pixels plus the zoom the
// person would have. 600x560 at 150% is about 400 CSS px, the smallest window.
const SIZES = [[1920, 1080, 1], [1440, 900, 1], [1100, 720, 1], [600, 560, 1.5]];
const MODES = ["build", "vibe"];
// Pages added after the base commit the record was made on (996db71) that v1 opens: Skills came with the Skills page. (Size and density registers its page in v2 only, so v1 has nothing of it to compare.)
const ADDED_SINCE_RECORD = ["skills"];
const RAILS = ["closed", "pinned"];
const sizeLabel = ([width, height, zoom]) => `${width}x${height}@${zoom}`;

// What the page reports, run in the renderer. It walks the registry the way a
// person would (MefiNav.go for every destination that has a layer), so a new
// destination is measured without this file learning about it. Each thing is
// measured once per rail state while it is on screen (the menu is pinned and
// unpinned under it), which is what a person does, and is much cheaper than
// opening every page twice.
async function walker(options) {
  const tick = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const round = (value) => Math.round(value * 100) / 100;
  const shown = (node) => Boolean(node && !node.hidden && !node.closest("[hidden]") && node.getClientRects().length);
  const rect = (node) => {
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return box.width > 0 || box.height > 0 ? [round(box.left), round(box.top), round(box.width), round(box.height)] : null;
  };
  const across = (node) => { const box = node.getBoundingClientRect(); return [round(box.left), round(box.width)]; };
  const nav = window.MefiNav;
  const began = performance.now();
  const rails = options.rails || ["closed"];
  const out = Object.fromEntries(rails.map((rail) => [rail, { viewport: [innerWidth, innerHeight], pages: {}, views: {}, tabs: {}, computed: {} }]));
  const timing = {};
  // Waits for the layer to be on screen, then a frame or two for it to settle.
  const slow = [];
  const settle = async (find, frames = 2, what = "") => {
    let turn = 0;
    for (; turn < 90 && !shown(find()); turn += 1) await tick();
    if (turn > 30) slow.push(`settle ${what}: ${turn} frames`);
    for (let frame = 0; frame < frames; frame += 1) await tick();
  };
  const style = (node, names) => Object.fromEntries(names.map((name) => [name, node ? getComputedStyle(node)[name] : null]));
  const chrome = () => ({ rail: rect(document.getElementById("app-rail")), vibeRail: rect(document.getElementById("vibe-rail")), localNav: rect(document.getElementById("app-local-nav")), ...(window.__layoutRegions ? { regions: window.__layoutRegions() } : {}), ...(window.__layoutProbe ? { probe: window.__layoutProbe() } : {}) });
  // The free area the floating things keep to: what they each measured for themselves on the
  // base commit (the rail's box, the local navigation's box, the window), and MefiNav.usable() once it exists.
  // The record was made with the first, and v1 must give it back from the second.
  const free = () => {
    if (typeof nav.usable === "function") { const area = nav.usable(); return [round(area.left), round(area.top), round(area.right), round(area.bottom)]; }
    const rail = document.getElementById("app-rail")?.getBoundingClientRect(), bar = document.getElementById("app-local-nav")?.getBoundingClientRect();
    return [round(rail?.width > 0 ? rail.right : 0), round(bar?.height > 0 ? bar.bottom : 0), round(innerWidth), round(innerHeight)];
  };
  const home = () => document.getElementById(nav.current() === "vibe" ? "vibe-layer" : "workspace-layer");
  const toastHost = () => { const box = document.getElementById("toast-host").getBoundingClientRect(); return [round(box.left), round(innerHeight - box.bottom)]; };
  // Run one measurement under each rail state, leaving the menu closed.
  const each = async (measure) => {
    for (const rail of rails) {
      if (rails.length > 1) { nav.setRailPinned(rail === "pinned", { save: false }); await tick(); await tick(); }
      await measure(out[rail], rail);
    }
    if (rails.length > 1) { nav.setRailPinned(false, { save: false }); await tick(); }
  };

  // closeAll() hides the layers after their exit, and Vibe's rules look at whether a page is still up, so wait for it.
  // Some dialogs (Configuration) are not tracked by the nav's layers and stay up through closeAll(): close what is still shown by its own close.
  const records = nav.list().filter((record) => record.layer && record.element);
  const blocker = () => document.querySelector(".workspace-page:not([hidden]), .overlay:not([hidden])");
  const clear = async (what = "") => {
    nav.closeAll();
    for (const record of records) if (shown(document.getElementById(record.element))) record.close?.();
    let turn = 0;
    for (; turn < 90 && blocker(); turn += 1) await tick();
    if (turn > 30) slow.push(`clear ${what}: ${turn} frames, still ${blocker()?.id || blocker()?.className}`);
    await tick();
  };
  const measurePage = async (record, key) => {
    const find = () => document.getElementById(record.element);
    await nav.go(record.id);
    await settle(find, 1, key);
    await each((into) => {
      const element = find();
      into.pages[key] = shown(element) ? { box: rect(element), kids: [...element.children].filter(shown).map(across), usable: free(), ...chrome() } : null;
      if (record.id === "agents") into.computed.agentsMenu = style(document.querySelector(".agents-nav-subsections"), ["maxWidth"]);
    });
  };
  if (options.pages !== false) {
    // Every destination with a layer, sheets first, then the transient ones. A
    // transient layer is measured over Home and again over a page, because Vibe
    // gives the whole window to a sheet over its own Home and only the free area over a page.
    records.sort((a, b) => (a.layer === b.layer ? 0 : a.layer === "sheet" ? -1 : 1));
    await clear("start");
    const walked = options.only ? records.filter((record) => options.only.includes(record.id)) : records;
    let group = walked[0]?.layer;
    for (const record of walked) {
      const at = performance.now();
      if (record.layer !== group) { await clear(`group ${record.id}`); group = record.layer; }
      await measurePage(record, record.id);
      if (record.layer === "transient" && document.documentElement.dataset.uiMode === "vibe") {
        await clear(`${record.id} over home`);
        await nav.go("tasks"); await settle(() => document.getElementById("tasks-overlay"), 1, "tasks");
        await measurePage(record, `${record.id}@page`);
        await clear(`${record.id} over page`);
      } else if (record.layer === "transient") await clear(`${record.id}`);
      timing[record.id] = Math.round(performance.now() - at);
    }
    await clear("end");
  }
  if (options.views !== false) {
    // Home in the mode's own words, and Command; the toast stack sits differently over each.
    await nav.go("workspace"); await settle(home, 3);
    await each((into) => { into.views.home = { home: rect(document.getElementById("workspace-layer")), vibe: rect(document.getElementById("vibe-layer")), toasts: toastHost(), usable: free(), ...chrome() }; });
    await nav.go("command"); await settle(() => document.getElementById("idle-hud"), 3);
    await each((into) => { into.views.command = { hud: rect(document.getElementById("idle-hud")), canvas: rect(document.getElementById("idle-layer")), toasts: toastHost(), coach: style(document.getElementById("walkthrough-coach"), ["right", "bottom"]), usable: free(), ...chrome() }; });
    await nav.go("workspace"); await settle(home, 3);
  }
  if (options.tabs !== false) {
    for (const id of Array.isArray(options.tabs) ? options.tabs : ["studio", "booklet", "graph", "eyes"]) {
      await nav.go(id);
      const find = () => document.getElementById(`tab-${id}`);
      await settle(find, 2);
      await each((into) => {
        const body = getComputedStyle(document.body);
        into.tabs[id] = shown(find()) ? { x: across(find()), body: [round(parseFloat(body.paddingLeft)), round(parseFloat(body.paddingRight)), round(parseFloat(body.paddingTop)), round(parseFloat(body.paddingBottom))], ...chrome() } : null;
        if (id === "studio") into.computed.settings = { nav: style(document.querySelector(".settings-nav"), ["top", "maxHeight"]), card: style(document.querySelector(".settings-card"), ["scrollMarginTop"]) };
      });
    }
    await nav.go("workspace"); await settle(home, 3);
  }
  if (options.computed !== false) {
    // Rules only a state reaches, read where the state can be made cheaply.
    await each((into) => {
      into.computed.coach = style(document.getElementById("walkthrough-coach"), ["right", "bottom", "left", "width"]);
      into.computed.profilerHud = style(document.querySelector(".profiler-hud"), ["right", "bottom"]);
      into.computed.sidebarPanel = style(document.getElementById("workspace-sidebar-panel"), ["left"]);
    });
    // The Appearance editor floats over Command with its own offsets.
    const stage = document.querySelector(".appearance-stage");
    const studioTab = document.getElementById("tab-studio");
    if (stage && studioTab) {
      const hidden = [stage.hidden, studioTab.hidden];
      stage.hidden = false; studioTab.hidden = false; document.body.classList.add("appearance-settings-active"); await tick(); await tick();
      await each((into) => { into.computed.appearance = { studio: rect(studioTab), stage: rect(stage), toasts: toastHost() }; });
      document.body.classList.remove("appearance-settings-active"); stage.hidden = hidden[0]; studioTab.hidden = hidden[1]; await tick();
    }
    // Where the toasts go beside the Appearance preview sheet.
    document.body.classList.add("music-preview-active"); await tick();
    await each((into) => { into.computed.musicToasts = toastHost(); });
    document.body.classList.remove("music-preview-active"); await tick();
    // Sheets and menus no destination opens here, built the way their modules build them.
    const probes = {
      gitSheet: '<div class="overlay gs-overlay"><div class="gs-sheet sheet"></div></div>',
      agentStep1: '<div class="overlay"><section class="sheet walkthrough-sheet" data-agent-step="1"></section></div>',
      agentStep2: '<div class="overlay"><section class="sheet walkthrough-sheet" data-agent-step="2"></section></div>',
      toolsMenu: '<div class="sheet-actions"><div class="surface-tools"><div class="surface-tools-menu"></div></div></div>',
    };
    const holder = document.createElement("div");
    holder.id = "layout-probes";
    holder.innerHTML = Object.entries(probes).map(([name, html]) => `<div data-probe="${name}">${html}</div>`).join("");
    document.body.append(holder); await tick(); await tick();
    await each((into) => {
      const find = (name, selector) => holder.querySelector(`[data-probe="${name}"] ${selector}`);
      into.computed.probes = {
        gitSheet: rect(find("gitSheet", ".gs-sheet")), agentStep1: across(find("agentStep1", ".walkthrough-sheet")), agentStep2: across(find("agentStep2", ".walkthrough-sheet")),
        toolsMenu: style(find("toolsMenu", ".surface-tools-menu"), ["maxWidth"]),
      };
    });
    holder.remove(); await tick();
  }
  await each((into) => { Object.assign(into, chrome()); into.usable = free(); into.overflow = { x: document.documentElement.scrollWidth > innerWidth + 1, y: document.documentElement.scrollHeight > innerHeight + 1 }; });
  timing.total = Math.round(performance.now() - began);
  timing.slow = slow;
  return { out, timing };
}

async function bridgeNames() {
  const source = fs.readFileSync(path.join(studio, "preload.cjs"), "utf8");
  return [...new Set([...source.matchAll(/^  ([A-Za-z][A-Za-z0-9_]*):/gm)].map((match) => match[1]))];
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url) || details.url.startsWith("https://www.youtube-nocookie.com/embed/");
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const now = Date.now(), projectId = "layout-project";
  const task = { id: "layout-task", projectId, title: "Give the tab strip room", prompt: "Keep every page inside the free area", status: "active", runId: "layout-run", createdAt: now - 60000, updatedAt: now };
  const ready = { id: "layout-ready", projectId, title: "Add the session list", prompt: "One column, right of the rail", status: "open", createdAt: now, updatedAt: now };
  const routing = { provider: "zen", roleProviders: {}, models: { routine: "gpt-6-luna", heavy: "gpt-6-sol" }, providerModels: {}, hasZen: true, hasOpenCode: false, hasZai: false, hasOpenRouter: false, hasCustom: false, autoProviders: ["zen", "codex"], autoFallback: true, modelSelection: "fixed", executorCli: "codex", executorModels: {}, executorTierModels: {}, executorTier: "auto", subscriptionFirst: true, lmStudioEndpoint: "http://127.0.0.1:1234/v1", customEndpoint: "", executorTierDefaults: {}, autoSetup: null };
  const configuration = { aiProvider: "zen", aiModels: routing.models, executorCli: "codex", agentBrain: { contextScout: true, deskTool: false, headDrafts: false, nestedDelegation: false } };
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Layout fixture", path: root }] },
    tasksList: { ok: true, projectId, tasks: [task, ready] }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: false, useReference: true, useTree: true, useWeb: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: {}, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, autoBuild: true, mode: "swarm", minutes: 5, parallel: 2, running: [], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, counts: { ready: 1, running: 1, blocked: 0, review: 0 }, taskStates: [], next: [] },
    projectPreviewStatus: { ok: true, projectId, phase: "ready", available: true, kind: "static", url: "http://127.0.0.1:44173/", owned: true, canStop: true, message: "App preview is ready", logs: [], checkedAt: now },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getApiKey: { saved: false }, getAiRouting: routing, cliStatus: [], launchStudio: { ok: true }, jevStatus: { ok: true, enabled: false, route: "zen", routes: { vercel: false, typesafe: false, zen: true, openrouter: false } }, openrouterModels: { ok: true, models: [] }, agentModels: { ok: true, models: [] },
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [], skills: [], mcpTools: [], routing, seats: {}, choices: {}, efforts: ["minimal", "low", "medium", "high", "xhigh", "max"] },
    cliSetupStatus: { ok: true, selected: "auto", clis: [] }, firstRunStatus: { ok: true, firstRun: null },
    machineGet: { ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } }, updateStatus: { ok: true, status: { auto: true } },
    companionState: { ok: true, projectId, projectName: "Layout fixture", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: false, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
    brainState: { ok: true, tasks: [], recent: [], pipelines: {} }, brainPlaybook: { ok: true, shelf: [], recipes: [] }, brainMap: { ok: true, map: { systems: [], edges: [], files: [] } },
    worktreesList: { ok: true, repo: false, projectId, enabled: { on: false, forced: false } },
    skillsList: { ok: true, projectId, writable: true, blocked: "", skills: [], starters: [], others: [] },
  };
  const names = await bridgeNames();
  const preload = path.join(root, "layout-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const names=${JSON.stringify(names)};const calls=[];const subscribers={};
    const bridge={};
    for(const name of names){
      if(/^on[A-Z]/.test(name))bridge[name]=callback=>{(subscribers[name]??=[]).push(callback);return()=>{};};
      else bridge[name]=async(...args)=>{calls.push(name);return name in responses?JSON.parse(JSON.stringify(responses[name])):{ok:true};};
    }
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('layoutFixture',{calls:()=>calls.slice(),push:(name,value)=>{for(const callback of subscribers[name]||[])callback(value);},answer:(name,value)=>{responses[name]=value;}});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));localStorage.setItem('mefiStudio.whatsNew.seen','vibe-build-1');
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(60); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "layout-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${label}`);
  };
  const capture = async (name) => {
    await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(150);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
    report.shots.push(name);
  };
  const resize = async ([width, height, zoom]) => {
    window.setContentSize(width, height); contents.setZoomFactor(zoom);
    const wanted = Math.round(width / zoom);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { const inner = await run("return innerWidth;"); if (Math.abs(inner - wanted) <= 1) break; await sleep(60); }
    await sleep(250);
    const inner = await run("return [innerWidth, innerHeight];");
    assert.ok(Math.abs(inner[0] - wanted) <= 1, `the window is ${inner[0]} CSS px wide, expected ${wanted}`);
  };
  const setup = async ({ mode, rail }) => {
    await run(`window.MefiNav.closeAll(); window.MefiVibe.closeNotes(); window.MefiVibe.setMode(${JSON.stringify(mode)}, { go: false }); window.MefiNav.applyShell(true); window.MefiNav.setRailPinned(${rail === "pinned"}, { save: false });`);
    await sleep(200);
  };
  // Named so the diff of a mismatch points at the thing that moved.
  const differences = (actual, expected, where = "", found = []) => {
    if (found.length >= 30) return found;
    if (actual && expected && typeof actual === "object" && typeof expected === "object") {
      for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) differences(actual[key], expected[key], `${where}/${key}`, found);
    } else if (JSON.stringify(actual) !== JSON.stringify(expected)) found.push(`${where}: now ${JSON.stringify(actual)}, was ${JSON.stringify(expected)}`);
    return found;
  };

  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await until("window.MefiNav && window.MefiVibe && window.MefiWorkspace && window.MefiTasks && !window.MefiBoot?.isActive?.()", "studio ready");
  await run(`window.__layoutWalk = ${walker.toString()};`);
  assert.equal(await run("return document.documentElement.dataset.layout === undefined;"), true, "a diagnostic launch is v1 unless ?layout=v2 is given");
  // Some modules register their destination a beat after the page is up; the
  // walk must see the same registry every time.
  for (let last = -1, quiet = 0; quiet < 12;) { const size = await run("return window.MefiNav.list().length;"); quiet = size === last ? quiet + 1 : 0; last = size; await sleep(125); }

  // ---- 1. v1, everywhere, against the record --------------------------------
  // MEFI_LAYOUT_PHASE=v1 stops after this; =v2 takes the record as given and goes straight to v2 (both for debugging, never for the gate).
  const phase = process.env.MEFI_LAYOUT_PHASE || "all";
  const recorded = {}, timings = {};
  const only = process.env.MEFI_LAYOUT_ONLY || "";
  const configs = [];
  for (const size of SIZES) for (const mode of MODES) for (const rail of RAILS) configs.push({ size, mode, rail, label: `${sizeLabel(size)}/${mode}/${rail}` });
  for (const size of SIZES) configs.push({ size, mode: "classic", rail: "none", label: `${sizeLabel(size)}/classic/none` });
  if (phase !== "v2") {
    for (const size of SIZES) {
      await resize(size);
      for (const mode of [...MODES, "classic"]) {
        const wanted = configs.filter((item) => item.size === size && item.mode === mode && item.label.includes(only));
        if (!wanted.length) continue;
        if (mode === "classic") await run("window.MefiVibe.closeNotes(); window.MefiVibe.setMode('build', { go: false }); window.MefiNav.applyShell(false);");
        else await setup({ mode, rail: "closed" });
        const { out, timing } = await run(`return await window.__layoutWalk({ rails: ${JSON.stringify(mode === "classic" ? ["none"] : RAILS)} });`);
        for (const item of wanted) recorded[item.label] = out[item.rail];
        timings[`${sizeLabel(size)}/${mode}`] = timing;
        assert.deepEqual(report.errors, [], `${sizeLabel(size)}/${mode}: ${JSON.stringify(report.errors)}`);
      }
    }
    await run("window.MefiNav.applyShell(true);");
    report.timing = timings;
    const firstPages = Object.values(recorded)[0].pages;
    report.v1Opened = Object.entries(firstPages).filter(([, page]) => page).map(([id]) => id);
    report.v1Missed = Object.entries(firstPages).filter(([, page]) => !page).map(([id]) => id);
  }

  if (recordTo) {
    const lines = Object.entries(recorded).map(([label, value]) => `${JSON.stringify(label)}: ${JSON.stringify(value)}`);
    fs.writeFileSync(recordTo, `{\n"about": ${JSON.stringify("Bounding rects of the shell and of every place it draws, recorded on the base commit (996db71) before the layout contract changed a rule; tests/layout_contract_render.test.mjs compares v1 with it. CSS px rounded to 0.01. A box is [left, top, width, height]; kids are the layer's children as [left, width] (their height follows the font). One entry per window size (device px @ zoom), mode (build, vibe, classic) and rail (closed, pinned).")},\n"configs": {\n${lines.join(",\n")}\n}\n}\n`);
    report.recorded = recordTo;
    report.complete = true;
    finish();
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (phase === "v2") Object.assign(recorded, baseline.configs);
  else {
    // Destinations that did not exist on the base commit have no record: v1 is measured for them (the v2 checks compare v2 with this run's v1) but not compared with the file. Naming them keeps a renamed or vanished page from slipping through.
    const comparable = JSON.parse(JSON.stringify(recorded));
    for (const [label, config] of Object.entries(comparable)) for (const id of ADDED_SINCE_RECORD) {
      assert.equal(baseline.configs[label]?.pages?.[id], undefined, `${id} is listed as added since the record, but ${label} records it`);
      assert.ok(config.pages?.[id], `${id} is listed as added since the record, but ${label} did not open it`);
      delete config.pages[id];
    }
    const moved = differences(comparable, Object.fromEntries(Object.keys(comparable).map((label) => [label, baseline.configs[label]])));
    assert.deepEqual(moved, [], `v1 geometry moved:\n${moved.join("\n")}`);
    report.v1Identical = true;
  }

  if (phase === "v1" || await run("return typeof window.MefiNav.layout === 'undefined';")) { report.complete = true; finish(); return; }
  await require("./layout-contract-v2.cjs")({ window, contents, run, until, capture, resize, setup, configs, recorded, report, sleep, root, differences });
  assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
  report.complete = true;
  finish();
}).catch(finish);
