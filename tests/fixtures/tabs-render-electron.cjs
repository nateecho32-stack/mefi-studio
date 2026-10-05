"use strict";

// The tab strip (renderer/tabs.js, tabs.css) in a real Chromium: a copied booklet, a synthetic bridge, layout v2, and a
// fixture-only MefiShell. FRAME builds the real shell's regions at the same time as this; what stands in for its tab
// region here is one box placed the way docs/unified-studio.md says a region is placed (from MefiNav.usable() and the
// contract's variables), sized through MefiNav.layout.set, which is what MefiShell.resize does. So what is measured is
// the strip itself: its geometry and its behaviour with real pages, real pointer and keyboard input, the real nav, the
// real Configuration and Search. Once the renderer has a shell.js of its own (FRAME's MefiShell), the stand-in is not put
// in and the strip runs in the real regions; report.shell says which it was.
//
//   1. five window sizes (1920x1080, 1440x900, 1100x720, 600x560, 600x560 at 150%): with a dozen tabs open the strip
//      fits, folds into "N more" or becomes one menu below the fold; nothing overflows the page, no scroller reserves
//      width for a bar, no text under 12 px, every menu stays inside the window, every glyph exists in the sprite;
//   2. real input: click, the close button, middle-click, right-click, a drag to reorder, the keys, Escape leaving the
//      page under a menu alone, the focus ring, typing in the Add menu, the cap's Undo toast, Search and Configuration;
//   3. real pages: each tab opens the page it stands for (sheets, Home, Agents with its panes, a session), and going
//      back through the nav's own history moves the strip;
//   4. the tabs survive a reload; v1 (no layout attribute) draws, stores and listens to nothing; the host's switch
//      turns the management off; Ctrl+W closes the tab and not the window, where a page that does not take the key
//      loses its window (so the test can see a close at all).
//
// Network, permissions and child processes are blocked. Screenshots: the test file's capture folder variable.
const { app, BrowserWindow, Menu, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_TABS_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated tabs fixture directory is required");
const studio = path.resolve(__dirname, "..", "..");
const report = { errors: [], networkAttempts: [], processAttempts: [], sizes: {}, shots: [], keys: {}, notes: [] };
app.setName("Tabs Fixture");
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
const sizeLabel = ([width, height, zoom]) => `${width}x${height}@${zoom}`;

// ---- what stands in for FRAME's regions (runs in the page, before the booklet's own scripts) ---------------------------------------
const SHELL_STUB = `(() => {
  "use strict";
  const made = {}, mounts = [];
  const STYLE = {
    tabs: "position:fixed;z-index:81;box-sizing:border-box;overflow:hidden;display:none;",
    main: "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;",
  };
  const region = (name) => {
    if (!STYLE[name]) return null;
    if (made[name]) return made[name];
    if (!document.body) return null;
    const node = document.createElement("div");
    node.id = "fx-region-" + name;
    node.style.cssText = STYLE[name];
    document.body.append(node);
    made[name] = node;
    return node;
  };
  // Where the contract puts a tab strip: right of the rail and the list, under the local navigation, to the window's edge, at the level
  // of the local navigation itself (styles.css: --z-shell is 82 and the local navigation sits one under it), above Home's backdrop.
  const place = () => {
    const node = made.tabs;
    if (!node) return;
    const nav = window.MefiNav;
    const height = nav && nav.layout ? nav.layout.used("tabs") : 0;
    const free = nav && nav.usable ? nav.usable() : null;
    if (!free || !height) { node.style.display = "none"; return; }
    Object.assign(node.style, { display: "block", left: free.left + "px", right: "0px", top: (free.top - height) + "px", height: height + "px" });
  };
  let frame = 0;
  const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
  window.MefiShell = {
    active: () => document.documentElement.dataset.layout === "v2",
    region,
    mount(name, key, content, options = {}) {
      const node = region(name);
      if (!node) return null;
      const element = typeof content === "function" ? content() : content;
      node.append(element);
      const handle = { region: name, key, options, element, show() { element.hidden = false; }, hide() { element.hidden = true; }, unmount() { element.remove(); } };
      mounts.push(handle);
      later();
      return handle;
    },
    resize(name, px) {
      const got = window.MefiNav.layout.set(name, px);
      window.dispatchEvent(new CustomEvent("mefi:shell-layout", { detail: { region: name, px: got } }));
      later();
      return got;
    },
    size: (name) => window.MefiNav.layout.used(name),
    onChange: (callback) => { window.addEventListener("mefi:shell-layout", callback); return () => window.removeEventListener("mefi:shell-layout", callback); },
    mode: () => (window.MefiVibe && window.MefiVibe.mode ? window.MefiVibe.mode() : "build"),
    mounts: () => mounts.map((item) => ({ region: item.region, key: item.key, title: item.options.title, order: item.options.order })),
    place,
  };
  for (const type of ["mefi:layout", "mefi:nav", "mefi:shell", "resize"]) window.addEventListener(type, later);
  new MutationObserver(later).observe(document.documentElement, { attributes: true });
  if (document.body) new MutationObserver(later).observe(document.body, { attributes: true, attributeFilter: ["class"] });
})();`;

// ---- what the walk measures with (runs in the page) --------------------------------------------------------------------------------
const PAGE = `window.__fx = (() => {
  const round = (value) => Math.round(value * 100) / 100;
  const shown = (node) => Boolean(node && !node.hidden && !node.closest("[hidden]") && node.getClientRects().length && getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).display !== "none");
  const rect = (node) => { if (!node) return null; const box = node.getBoundingClientRect(); return { x: round(box.left), y: round(box.top), r: round(box.right), b: round(box.bottom), w: round(box.width), h: round(box.height) }; };
  const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const small = (scope) => [...scope.querySelectorAll("*")].filter((node) => shown(node) && [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim()) && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.className + ":" + getComputedStyle(node).fontSize);
  const gutter = (node) => { const style = getComputedStyle(node); return round(node.offsetWidth - node.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)); };
  const overflowX = (node) => node.scrollWidth > node.clientWidth + 1;
  const missingGlyphs = (scope) => [...scope.querySelectorAll("use")].map((use) => (use.getAttribute("href") || "").replace(/^#/, "")).filter((id) => id && !document.getElementById(id));
  const item = (node) => ({ id: node.dataset.id, title: node.querySelector(".ts-title").textContent, shown: shown(node), box: rect(node), active: node.dataset.active === "true", pinned: node.dataset.pinned === "true", preview: node.dataset.preview === "true", attn: node.dataset.attn === "true", home: node.dataset.home === "true", closeShown: shown(node.querySelector(".ts-close")) });
  const strip = () => {
    const root = document.querySelector(".ts-strip");
    if (!root) return null;
    const list = root.querySelector(".ts-list"), more = root.querySelector(".ts-more"), menu = root.querySelector(".ts-menu"), add = root.querySelector(".ts-add"), cfg = root.querySelector(".ts-cfg"), chip = root.querySelector(".ts-suggest");
    return {
      inner: [innerWidth, innerHeight],
      region: rect(root.parentElement), strip: rect(root), height: parseFloat(getComputedStyle(root).height),
      usable: window.MefiNav.usable(), used: window.MefiNav.layout.used("tabs"), variable: document.documentElement.style.getPropertyValue("--shell-tabs-h"),
      list: { shown: shown(list), box: rect(list), overflowX: overflowX(list), gutter: gutter(list), role: list.getAttribute("role") },
      more: { shown: shown(more), text: more.textContent, box: rect(more) },
      menu: { shown: shown(menu), box: rect(menu), text: menu.textContent, label: menu.getAttribute("aria-label") },
      add: { shown: shown(add), box: rect(add) }, cfg: { shown: shown(cfg), box: rect(cfg) }, chip: { shown: shown(chip), text: chip.textContent },
      items: [...list.querySelectorAll(".ts-item")].map(item),
      small: small(root), missing: missingGlyphs(root),
      page: { overflowX: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1, overflowY: document.documentElement.scrollHeight > innerHeight + 1 },
      focus: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : null,
      // Build's Home (its session layout) is a layer of its own: where it starts is where the strip ends, or the strip covers its top bar.
      layer: (() => { const node = document.getElementById("workspace-layer"); return node && shown(node) ? rect(node) : null; })(),
    };
  };
  const pop = () => {
    const node = document.querySelector(".ts-pop");
    if (!node) return null;
    return { id: node.id, role: node.getAttribute("role"), label: node.getAttribute("aria-label"), box: rect(node), gutter: gutter(node), overflowX: overflowX(node), small: small(node), missing: missingGlyphs(node), maxHeight: node.style.maxHeight, scrollbarWidth: getComputedStyle(node).scrollbarWidth,
      rows: [...node.querySelectorAll(".ts-row, .ts-menuitem")].map((row) => ({ text: (row.querySelector(".ts-rowlabel, .ts-menulabel") || row).textContent.trim().replace(/\\s+/g, " "), box: rect(row), shown: shown(row), disabled: row.disabled === true })),
      groups: [...node.querySelectorAll(".ts-group")].map((row) => row.textContent), scroller: node.querySelector(".ts-rows") ? { gutter: gutter(node.querySelector(".ts-rows")) } : null };
  };
  return { round, shown, rect, tick, small, gutter, overflowX, missingGlyphs, strip, pop };
})();`;

// What the page's answers are: a project with a handful of sessions in every state, one of them with a question for the owner.
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
  const now = Date.now(), projectId = "tabs-project";
  const mk = (id, title, status, extra = {}) => ({ id, projectId, title, prompt: `${title}.`, status, createdAt: now - 600000, updatedAt: now - 1000, ...extra });
  const tasks = [
    mk("t-dark", "Add dark mode to the settings page", "active", { runId: "run-1", updatedAt: now }),
    mk("t-login", "Fix the login redirect", "open"),
    mk("t-notes", "Write the release notes", "awaiting_verification"),
    mk("t-db", "Choose the database", "active", { runId: "run-2" }),
    mk("t-rename", "Rename the Vibe strip", "done"),
    mk("t-map", "Sketch the project map", "open"),
  ];
  const routing = { provider: "zen", roleProviders: {}, models: { routine: "gpt-6-luna", heavy: "gpt-6-sol" }, providerModels: {}, hasZen: true, hasOpenCode: false, hasZai: false, hasOpenRouter: false, hasCustom: false, autoProviders: ["zen", "codex"], autoFallback: true, modelSelection: "fixed", executorCli: "codex", executorModels: {}, executorTierModels: {}, executorTier: "auto", subscriptionFirst: true, lmStudioEndpoint: "http://127.0.0.1:1234/v1", customEndpoint: "", executorTierDefaults: {}, autoSetup: null };
  const configuration = { aiProvider: "zen", aiModels: routing.models, executorCli: "codex", agentBrain: { contextScout: true, deskTool: false, headDrafts: false, nestedDelegation: false } };
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Tabs fixture", path: root }] },
    tasksList: { ok: true, projectId, tasks }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: false, useReference: true, useTree: true, useWeb: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: {}, work: [], questions: [{ id: "q-db", status: "open", text: "SQLite or Postgres?", context: { taskId: "t-db" }, createdAt: now }] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, autoBuild: true, mode: "swarm", minutes: 5, parallel: 2, running: [], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, counts: { ready: 1, running: 1, blocked: 0, review: 0 }, taskStates: [], next: [] },
    projectPreviewStatus: { ok: true, projectId, phase: "ready", available: true, kind: "static", url: "http://127.0.0.1:44173/", owned: true, canStop: true, message: "App preview is ready", logs: [], checkedAt: now },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getApiKey: { saved: false }, getAiRouting: routing, cliStatus: [], launchStudio: { ok: true }, jevStatus: { ok: true, enabled: false, route: "zen", routes: { vercel: false, typesafe: false, zen: true, openrouter: false } }, openrouterModels: { ok: true, models: [] }, agentModels: { ok: true, models: [] },
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [], skills: [], mcpTools: [], routing, seats: {}, choices: {}, efforts: ["minimal", "low", "medium", "high", "xhigh", "max"] },
    cliSetupStatus: { ok: true, selected: "auto", clis: [] }, firstRunStatus: { ok: true, firstRun: null },
    machineGet: { ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } }, updateStatus: { ok: true, status: { auto: true } },
    companionState: { ok: true, projectId, projectName: "Tabs fixture", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: false, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
    brainState: { ok: true, tasks: [], recent: [], pipelines: {} }, brainPlaybook: { ok: true, shelf: [], recipes: [] }, brainMap: { ok: true, map: { systems: [], edges: [], files: [] } },
    worktreesList: { ok: true, repo: false, projectId, enabled: { on: false, forced: false } },
  };
  const names = await bridgeNames();
  const preload = path.join(root, "tabs-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const names=${JSON.stringify(names)};const calls=[];const subscribers={};
    if(localStorage.getItem('fx.tabsOff')==='1')responses.prefsGet.prefs.tabsManage=false;
    const bridge={};
    for(const name of names){
      if(/^on[A-Z]/.test(name))bridge[name]=callback=>{(subscribers[name]??=[]).push(callback);return()=>{};};
      else bridge[name]=async(...args)=>{calls.push(name);return name in responses?JSON.parse(JSON.stringify(responses[name])):{ok:true};};
    }
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('tabsFixture',{calls:()=>calls.slice(),push:(name,value)=>{for(const callback of subscribers[name]||[])callback(value);},answer:(name,value)=>{responses[name]=value;}});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.keyTips','off');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));localStorage.setItem('mefiStudio.whatsNew.seen','vibe-build-1');
  `);
  // The fixture-only shell goes in ahead of the booklet's scripts, in the copy this run owns, unless the renderer has a shell of its own
  // (FRAME's renderer/shell.js, which replaces window.MefiShell when it loads): then the strip runs in the real regions, and only what the
  // stand-in itself recorded (how often it was asked to mount) is not checked.
  const bookletFile = path.join(root, "renderer", "booklet.html");
  const realShell = fs.existsSync(path.join(root, "renderer", "shell.js"));
  report.shell = realShell ? "the renderer's own MefiShell" : "the fixture's stand-in";
  const page = fs.readFileSync(bookletFile, "utf8");
  assert.ok(page.includes('<script id="booklet-data"'), "the booklet has its data block to put the stand-in shell in front of");
  if (!realShell) fs.writeFileSync(bookletFile, page.replace('<script id="booklet-data"', () => `<script>${SHELL_STUB}</script>\n<script id="booklet-data"`));

  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(60); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, label, ms = 15000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "tabs-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${label}`);
  };
  const capture = async (name) => {
    await run("await window.__fx.tick();");
    await sleep(150);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
    report.shots.push(name);
  };
  let zoom = 1;
  const resize = async ([width, height, factor]) => {
    zoom = factor;
    window.setContentSize(width, height); contents.setZoomFactor(factor);
    const wanted = Math.round(width / factor);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { const inner = await run("return innerWidth;"); if (Math.abs(inner - wanted) <= 1) break; await sleep(60); }
    await sleep(250);
    const inner = await run("return [innerWidth, innerHeight];");
    assert.ok(Math.abs(inner[0] - wanted) <= 1, `the window is ${inner[0]} CSS px wide, expected ${wanted}`);
  };
  const setup = async (mode) => {
    await run(`window.MefiNav.closeAll(); window.MefiVibe.closeNotes(); window.MefiVibe.setMode(${JSON.stringify(mode)}, { go: false }); window.MefiNav.applyShell(true); window.MefiNav.setRailPinned(false, { save: false });`);
    await sleep(200);
  };
  const home = async () => { await run("await window.MefiNav.go('workspace');"); await until("document.body.classList.contains('vibe-active') || document.body.classList.contains('workspace-active')", "Home is up"); await sleep(120); };
  // Real input: CSS px in, device px out.
  const at = (x, y) => ({ x: Math.round(x * zoom), y: Math.round(y * zoom) });
  const mouse = (type, x, y, extra = {}) => contents.sendInputEvent({ type, ...at(x, y), ...extra });
  const click = async (x, y, button = "left") => { mouse("mouseMove", x, y); await sleep(30); mouse("mouseDown", x, y, { button, clickCount: 1 }); mouse("mouseUp", x, y, { button, clickCount: 1 }); await sleep(120); };
  const key = async (keyCode, modifiers = []) => { contents.sendInputEvent({ type: "keyDown", keyCode, modifiers }); contents.sendInputEvent({ type: "keyUp", keyCode, modifiers }); await sleep(90); };
  const typeText = async (text) => { for (const character of text) { contents.sendInputEvent({ type: "keyDown", keyCode: character }); contents.sendInputEvent({ type: "char", keyCode: character }); contents.sendInputEvent({ type: "keyUp", keyCode: character }); await sleep(25); } await sleep(120); };
  const center = async (selector) => run(`const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; const box = node.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 };`);
  const idOf = (route, task = null) => run(`const tab = window.MefiTabs.list().find((item) => item.route.id === ${JSON.stringify(route)} && (${JSON.stringify(task)} === null || item.route.params.taskId === ${JSON.stringify(task)})); return tab ? tab.id : null;`);
  const itemBox = async (route, task = null) => { const id = await idOf(route, task); assert.ok(id, `${route}${task ? ":" + task : ""} has a tab`); return run(`return window.__fx.rect(document.querySelector('.ts-item[data-id="${id}"]'));`); };
  const tabPoint = async (route, task = null, part = ".ts-tab") => { const id = await idOf(route, task); assert.ok(id, `${route}${task ? ":" + task : ""} has a tab`); return center(`.ts-item[data-id="${id}"] ${part}`); };
  const routes = () => run("return window.MefiTabs.list().map((tab) => tab.route.id + (tab.route.params.taskId ? ':' + tab.route.params.taskId : ''));");
  const current = () => run("return window.MefiNav.current();");
  const stored = () => run("return Object.keys(localStorage).filter((key) => key.startsWith('mefiStudio.tabs.')).sort();");
  const strip = () => run("return window.__fx.strip();");
  const wipe = async () => {
    await run(`const T = window.MefiTabs; T.setPrefs({ manage: true, preview: true, agent: 'bg', idle: 30, cap: 12, suggest: true });
      for (const tab of T.list()) if (tab.pin && !tab.home) T.pin(tab.id, false);
      for (const tab of [...T.list()].reverse()) if (!tab.home) T.close(tab.id);
      await window.MefiNav.go('workspace', { view: 'home' }); await window.__fx.tick();`);
    await sleep(250);
    // Build's Home is the new-task page: nothing but Home is open
    assert.deepEqual(await run("return window.MefiTabs.list().map((tab) => tab.route.id + (tab.route.params.taskId ? ':' + tab.route.params.taskId : ''));"), ["workspace"], "a clean slate");
  };
  const OPEN_DOZEN = `const T = window.MefiTabs, pid = window.MefiWorkspace.snapshot().projectId;
    for (const id of ['fleet', 'plans', 'worktrees', 'tasks', 'agents']) { T.open(id, {}, { preview: false }); await window.__fx.tick(); await window.__fx.tick(); }
    for (const id of ['t-dark', 't-login', 't-notes', 't-db']) { T.open('workspace', { view: 'task', taskId: id, projectId: pid }, { preview: false }); await window.__fx.tick(); await window.__fx.tick(); }
    T.pin(T.list().find((tab) => tab.route.id === 'fleet').id, true);
    await window.__fx.tick();`;

  // ===================================================================================================================================
  // 0. launch in layout v2
  // ===================================================================================================================================
  // Build's session layout (?home=sessions) is the one v2 is for: a session tab opens that session in it.
  await window.loadFile(bookletFile, { query: { capture: "1", layout: "v2", home: "sessions" } });
  await until("window.MefiNav && window.MefiVibe && window.MefiWorkspace && window.MefiTasks && window.MefiBuilder && window.MefiTabs && !window.MefiBoot?.isActive?.()", "studio ready");
  await run(PAGE);
  // A window nobody can see has no system focus, so :focus and :focus-visible never match: the page is told it has it.
  contents.debugger.attach("1.3");
  await contents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  await until("window.MefiTabs.running()", "the strip started");
  assert.equal(await run("return document.documentElement.dataset.layout;"), "v2");
  // A diagnostic launch (?capture=1) lands on the Catalog page (booklet.js showTab), not on Home: the strip shows where the app is.
  await sleep(400);
  assert.deepEqual(await run("return window.MefiTabs.list().map((tab) => [tab.route.id, tab.active, tab.prev]);"), [["workspace", false, false], ["booklet", true, true]], "at launch: Home, and the page the app landed on as the preview tab");
  await setup("build");
  await home();
  await until("window.MefiWorkspace.snapshot().tasks.length >= 6", "the board is loaded");
  await wipe();
  report.notes.push(await run("const a = window.MefiWorkspace.snapshot().assistant; return { questions: (a && a.questions || []).length, needs: Array.from(new Set((a && a.questions || []).map((q) => q.context && q.context.taskId))) };"));
  if (!realShell) {
    assert.equal(await run("return window.MefiShell.mounts().length;"), 1, "the strip asked the shell for its place once");
    assert.deepEqual(await run("return window.MefiShell.mounts()[0];"), { region: "tabs", key: "tabs", title: "Tabs", order: 0 });
  }
  const booted = await strip();
  assert.equal(booted.used, 38, "the strip asked for its height and the contract gave it");
  assert.equal(booted.variable, "38px", "as html's own variable");
  assert.equal(booted.height, 38);
  // SIZE's density token may be a calc() or a rem: the strip asks for the height it really has
  await run("document.documentElement.style.setProperty('--d-tab', 'calc(20px + 14px)'); window.dispatchEvent(new Event('mefi:appearance'));");
  await until("window.MefiNav.layout.used('tabs') === 34 && document.querySelector('.ts-strip').getBoundingClientRect().height === 34", "a density token of calc(20px + 14px) makes a strip 34px high and a region to match");
  await run("document.documentElement.style.removeProperty('--d-tab'); window.dispatchEvent(new Event('mefi:appearance'));");
  await until("window.MefiNav.layout.used('tabs') === 38", "and taking the token away gives the 38px back");
  assert.equal(booted.strip.y + booted.strip.h <= booted.usable.top + 0.5, true, "the page starts under the strip");
  // Home's tab is titled Today where the Today module is part of the window (Vibe's home in the 0.5 layout).
  const homeTitle = await run("return window.MefiToday ? 'Today' : 'Home';");
  assert.deepEqual(booted.items.map((item) => [item.title, item.pinned, item.home, item.active]), [[homeTitle, true, true, true]]);
  assert.deepEqual(booted.missing, [], "every glyph the strip draws is in the sprite");
  const panel = await run("const main = window.MefiShell.region('main'); const tab = document.querySelector('.ts-tab[aria-selected=\"true\"]'); return { tag: main.tagName, role: main.getAttribute('role'), labelledby: main.getAttribute('aria-labelledby') === tab.id, controls: tab.getAttribute('aria-controls') === main.id };");
  // A main area that has a meaning of its own (a <main>, or another role) is left alone: then the tabs name no panel, and that is said.
  if (panel.tag === "MAIN" || (panel.role && panel.role !== "tabpanel")) report.notes.push(`the shell's main region is <${panel.tag.toLowerCase()}> with role ${panel.role || "none"}: the strip leaves it as it is, so the tabs name no panel`);
  else assert.deepEqual({ role: panel.role, labelledby: panel.labelledby, controls: panel.controls }, { role: "tabpanel", labelledby: true, controls: true }, "the main area is the tab panel of the tab that is selected");
  await capture("tabs-launch.png");

  // ===================================================================================================================================
  // 1. five window sizes with a dozen tabs
  // ===================================================================================================================================
  for (const size of SIZES) {
    const label = sizeLabel(size);
    await resize(size); await setup("build"); await home(); await wipe();
    await run(OPEN_DOZEN);
    await sleep(300);
    const s = await strip();
    const folded = s.inner[0] < 900;
    report.sizes[label] = { inner: s.inner, tabs: s.items.length, shown: s.items.filter((item) => item.shown).length, more: s.more.text, menu: s.menu.text };
    assert.equal(s.items.length, 10, `${label}: Home, Fleet, Plans, Worktrees, Tasks, Agents and four sessions`);
    // where it is: the contract's place, in the window, above the page
    assert.ok(s.strip.x >= -0.5 && s.strip.r <= s.inner[0] + 0.5 && s.strip.y >= -0.5 && s.strip.b <= s.inner[1] + 0.5, `${label}: the strip is in the window ${JSON.stringify(s.strip)}`);
    assert.ok(s.strip.b <= s.usable.top + 0.5, `${label}: and above the free area (${s.strip.b} vs ${s.usable.top})`);
    assert.ok(s.layer, `${label}: the last tab opened is a session, so Build's session page is showing`);
    assert.ok(s.layer.y >= s.strip.b - 0.5, `${label}: Build's session page starts under the strip, not behind it (${s.layer.y} vs ${s.strip.b})`);
    assert.ok(Math.abs(s.strip.h - 38) <= 1 || Math.abs(s.strip.h - s.used) <= 1, `${label}: the height it asked for`);
    assert.equal(s.page.overflowX, false, `${label}: the page does not overflow sideways`);
    assert.equal(s.list.overflowX, false, `${label}: nothing is cut off inside the list (what does not fit is folded)`);
    assert.ok(Math.abs(s.list.gutter) < 1, `${label}: the list reserves no width for a scrollbar (${s.list.gutter})`);
    assert.deepEqual(s.small, [], `${label}: no text under 12 px`);
    assert.deepEqual(s.missing, [], `${label}: every glyph exists`);
    for (const part of [s.add, s.cfg]) assert.ok(part.shown && part.box.x >= s.strip.x - 0.5 && part.box.r <= s.strip.r + 0.5 && part.box.w >= 24 && part.box.h >= 24, `${label}: the + and the settings button are on the strip and big enough to hit: ${JSON.stringify(part)}`);
    if (folded) {
      assert.equal(s.list.shown, false, `${label}: below the fold the tabs are in a menu`);
      assert.equal(s.more.shown, false);
      assert.equal(s.menu.shown, true);
      assert.match(s.menu.label, /^Tabs, 10 open\. Current: /);
      assert.ok(s.menu.box.x >= s.strip.x - 0.5 && s.menu.box.r <= s.strip.r - 28 + 0.5, `${label}: the menu button leaves room for + and the settings button: ${JSON.stringify(s.menu.box)}`);
    } else {
      assert.equal(s.list.shown, true);
      assert.equal(s.menu.shown, false);
      const shownItems = s.items.filter((item) => item.shown);
      const hiddenItems = s.items.filter((item) => !item.shown);
      assert.equal(s.more.shown, hiddenItems.length > 0, `${label}: "N more" exactly when something folded`);
      if (hiddenItems.length) assert.equal(s.more.text, `${hiddenItems.length} more`);
      for (const item of s.items.filter((entry) => entry.home || entry.pinned || entry.active)) assert.equal(item.shown, true, `${label}: Home, a pin and the tab you are on never fold (${item.title})`);
      for (const item of shownItems) assert.ok(item.box.x >= s.list.box.x - 1 && item.box.r <= s.list.box.r + 1, `${label}: ${item.title} is inside the list: ${JSON.stringify(item.box)} in ${JSON.stringify(s.list.box)}`);
      for (const [index, a] of shownItems.entries()) for (const b of shownItems.slice(index + 1)) assert.ok(a.box.r <= b.box.x + 1, `${label}: ${a.title} overlaps ${b.title}`);
      for (const item of shownItems) assert.ok(item.box.w >= 40 && item.box.h >= 24, `${label}: ${item.title} is big enough to hit: ${JSON.stringify(item.box)}`);
      assert.ok(shownItems.find((item) => item.active)?.shown, `${label}: the tab you are on is in view`);
      if (size[0] >= 1440) assert.ok(shownItems.length >= 6, `${label}: a wide strip holds most of them`);
    }
    // The Add menu, by real click: inside the window, no gutter, nothing small, focus in the search box.
    const add = await center(".ts-add");
    await click(add.x, add.y);
    await until("document.querySelector('.ts-pop-add')", `${label}: the Add menu opens`);
    const menu = await run("return window.__fx.pop();");
    assert.ok(menu.box.x >= -0.5 && menu.box.r <= s.inner[0] + 0.5 && menu.box.y >= -0.5 && menu.box.b <= s.inner[1] + 0.5, `${label}: the Add menu is inside the window: ${JSON.stringify(menu.box)} in ${JSON.stringify(s.inner)}`);
    assert.ok(Math.abs(menu.gutter) < 1, `${label}: no gutter on the menu (${menu.gutter})`);
    assert.ok(Math.abs(menu.scroller.gutter) < 1, `${label}: and none on its list (${menu.scroller.gutter})`);
    assert.equal(menu.overflowX, false);
    assert.deepEqual(menu.small, [], `${label}: no small text in the menu`);
    assert.deepEqual(menu.missing, []);
    assert.equal(menu.scrollbarWidth, "none", `${label}: native scrollbars stay hidden`);
    assert.equal(menu.role, "dialog");
    // The 0.5 layout's places name the groups (renderer/nav.js placeOf): Today is Work's, Agents is Team, the Command view the Map.
    assert.ok(["Work", "Sessions", "Map", "Team"].every((group) => menu.groups.includes(group)) && !menu.groups.includes("Home") && !menu.groups.includes("Agents"), `${label}: ${menu.groups}`);
    assert.equal(await run("return document.activeElement && document.activeElement.id;"), "mefi-tabs-search", `${label}: the search box has the keyboard`);
    assert.deepEqual(await run("const node = document.getElementById('mefi-tabs-search'); const style = getComputedStyle(node); return { outline: style.outlineStyle, shadow: style.boxShadow, ring: getComputedStyle(node.parentElement).borderColor !== getComputedStyle(node.parentElement).getPropertyValue('--nothing') };"), { outline: "none", shadow: "none", ring: true }, `${label}: the search row shows the focus ring, not the input inside it`);
    if (["1440x900@1", "600x560@1.5"].includes(label)) await capture(`tabs-add-${label.replace(/[@.]/g, "_")}.png`);
    await key("Escape");
    await until("!document.querySelector('.ts-pop')", `${label}: Escape closes the menu`);
    assert.equal(await run("return document.activeElement && document.activeElement.id;"), "mefi-tabs-add", `${label}: and gives the keyboard back to the + button`);
    // The Tab behaviour card from the strip's own button: inside the window, nothing sideways, nothing small
    const cfgPoint = await center(".ts-cfg");
    await click(cfgPoint.x, cfgPoint.y);
    await until("document.querySelector('.ts-pop-behaviour .ts-card')", `${label}: the settings button opens the Tab behaviour card`);
    const behaviour = await run("const node = document.querySelector('.ts-pop-behaviour'); const card = window.__fx.pop(); card.overflowStyle = getComputedStyle(node).overflowX; card.cardOverflow = window.__fx.overflowX(node.querySelector('.ts-card')); return card;");
    assert.ok(behaviour.box.x >= -0.5 && behaviour.box.r <= s.inner[0] + 0.5 && behaviour.box.y >= -0.5 && behaviour.box.b <= s.inner[1] + 0.5, `${label}: the card is inside the window: ${JSON.stringify(behaviour.box)}`);
    assert.equal(behaviour.overflowX, false, `${label}: the card does not scroll sideways`);
    assert.equal(behaviour.overflowStyle, "hidden", `${label}: and cannot (only up and down)`);
    assert.equal(behaviour.cardOverflow, false);
    assert.ok(Math.abs(behaviour.gutter) < 1, `${label}: no gutter (${behaviour.gutter})`);
    assert.deepEqual(behaviour.small, [], `${label}: no small text on the card`);
    assert.deepEqual(behaviour.missing, []);
    if (["1440x900@1", "600x560@1.5"].includes(label)) await capture(`tabs-behaviour-${label.replace(/[@.]/g, "_")}.png`);
    await key("Escape");
    await until("!document.querySelector('.ts-pop')", `${label}: Escape closes the card`);
    assert.equal(await run("return document.activeElement && document.activeElement.id;"), "mefi-tabs-cfg", `${label}: and gives the keyboard back to its button`);
    // The menu that is the strip below the fold, or the "more" list above it.
    const opener = folded ? ".ts-menu" : s.more.shown ? ".ts-more" : null;
    if (opener) {
      const point = await center(opener);
      await click(point.x, point.y);
      await until("document.querySelector('.ts-pop')", `${label}: ${opener} opens its menu`);
      const list = await run("return window.__fx.pop();");
      assert.ok(list.box.x >= -0.5 && list.box.r <= s.inner[0] + 0.5 && list.box.y >= -0.5 && list.box.b <= s.inner[1] + 0.5, `${label}: ${list.label} is inside the window: ${JSON.stringify(list.box)}`);
      assert.ok(Math.abs(list.gutter) < 1, `${label}: no gutter on ${list.label} (${list.gutter})`);
      assert.deepEqual(list.small, []);
      assert.deepEqual(list.missing, []);
      assert.ok(list.rows.filter((row) => row.shown).length >= (folded ? 10 : 1), `${label}: the menu lists the tabs`);
      if (["1100x720@1", "600x560@1.5"].includes(label)) await capture(`tabs-${folded ? "menu" : "more"}-${label.replace(/[@.]/g, "_")}.png`);
      await key("Escape");
      await until("!document.querySelector('.ts-pop')", `${label}: Escape closes it`);
    }
    // the tab's own menu, at the pointer
    if (!folded) {
      const point = await tabPoint("plans");
      await click(point.x, point.y, "right");
      await until("document.querySelector('.ts-pop-tab')", `${label}: right-click opens the tab's menu`);
      const tabMenu = await run("return window.__fx.pop();");
      assert.ok(tabMenu.box.x >= -0.5 && tabMenu.box.r <= s.inner[0] + 0.5 && tabMenu.box.b <= s.inner[1] + 0.5, `${label}: the tab menu is inside the window: ${JSON.stringify(tabMenu.box)}`);
      assert.deepEqual(tabMenu.rows.map((row) => row.text).slice(0, 3), ["Pin", "Move left", "Move right"]);
      assert.deepEqual(tabMenu.small, []);
      if (label === "1440x900@1") await capture("tabs-menu-1440x900_1.png");
      await key("Escape");
      await until("!document.querySelector('.ts-pop')", `${label}: Escape closes it`);
    }
    await capture(`tabs-strip-${label.replace(/[@.]/g, "_")}.png`);
    assert.deepEqual(report.errors, [], `${label}: no console errors`);
  }

  // A window that changes size re-fits the strip with nothing else happening: the tabs are opened once, at the widest size, and the window is narrowed and widened
  await resize([1920, 1080, 1]); await setup("build"); await home(); await wipe();
  await run(OPEN_DOZEN);
  await sleep(300);
  const hiddenNow = () => run("return [...document.querySelectorAll('.ts-list .ts-item')].filter((node) => node.hidden).length + ':' + (document.querySelector('.ts-more').hidden ? 'no-more' : document.querySelector('.ts-more').textContent);");
  assert.equal(await hiddenNow(), "0:no-more", "wide: everything fits");
  await resize([1100, 720, 1]);
  await until("!document.querySelector('.ts-more').hidden", "narrowing the window folds what no longer fits, by itself");
  const narrowed = await hiddenNow();
  assert.match(narrowed, /^[1-9]\d*:\d+ more$/, narrowed);
  await resize([600, 560, 1]);
  await until("document.querySelector('.ts-more').hidden && getComputedStyle(document.querySelector('.ts-menu')).display !== 'none'", "below the fold the strip is one menu, by itself");
  await resize([1920, 1080, 1]);
  await until("document.querySelector('.ts-more').hidden && getComputedStyle(document.querySelector('.ts-list')).display !== 'none' && [...document.querySelectorAll('.ts-list .ts-item')].every((node) => !node.hidden)", "and widening it brings every tab back, by itself");

  // ===================================================================================================================================
  // 2. real input at 1440x900
  // ===================================================================================================================================
  await resize([1440, 900, 1]); await setup("build"); await home(); await wipe();
  await run(`const T = window.MefiTabs; for (const id of ['fleet', 'plans', 'worktrees']) { T.open(id, {}, { preview: false }); await window.__fx.tick(); await window.__fx.tick(); }`);
  await sleep(250);
  assert.deepEqual(await routes(), ["workspace", "fleet", "plans", "worktrees"]);
  assert.equal(await current(), "worktrees");

  // a click opens what the tab stands for, and the page that was showing goes
  let point = await tabPoint("plans");
  await click(point.x, point.y);
  await until("window.MefiNav.current() === 'plans' && window.MefiTabs.list().find((tab) => tab.active).route.id === 'plans'", "a click on Plans shows Plans");
  assert.equal(await run("return window.MefiNav.state.sheet;"), "plans");
  assert.equal(await run("const node = document.getElementById(window.MefiNav.get('plans').element); return Boolean(node) && !node.hidden;"), true, "the Plans sheet is up");
  point = await tabPoint("workspace");
  await click(point.x, point.y);
  await until("window.MefiNav.current() === 'workspace' && window.MefiTabs.active() === 'home'", "a click on Home shows Home");
  assert.equal(await run("return window.MefiNav.state.sheet;"), null, "and the sheet went");

  // the close button and a middle click
  point = await tabPoint("plans");
  await click(point.x, point.y);
  await until("window.MefiNav.current() === 'plans'", "Plans again");
  point = await tabPoint("plans", null, ".ts-close");
  await click(point.x, point.y);
  await until("!window.MefiTabs.list().some((tab) => tab.route.id === 'plans')", "the close button closes Plans");
  await until("window.MefiNav.current() === 'worktrees'", "and the tab beside it is showing");
  point = await tabPoint("fleet");
  mouse("mouseMove", point.x, point.y); await sleep(30);
  mouse("mouseDown", point.x, point.y, { button: "middle", clickCount: 1 }); mouse("mouseUp", point.x, point.y, { button: "middle", clickCount: 1 });
  await until("!window.MefiTabs.list().some((tab) => tab.route.id === 'fleet')", "a middle-click closes Fleet");
  assert.equal(await current(), "worktrees", "the page that was showing stays");
  assert.deepEqual(await routes(), ["workspace", "worktrees"]);
  await key("T", ["control", "shift"]);
  await until("window.MefiTabs.list().some((tab) => tab.route.id === 'fleet')", "Ctrl+Shift+T brings the newest closed tab back");
  assert.equal(await current(), "fleet", "and opens it");
  await key("T", ["control", "shift"]);
  await until("window.MefiTabs.list().some((tab) => tab.route.id === 'plans')", "and again: Plans");

  // a drag with a real mouse reorders; the click that ends it activates nothing
  await sleep(200);
  const before = await routes();
  const from = await tabPoint(before.at(-1)); // the last tab
  const first = await itemBox(before[1]);
  mouse("mouseMove", from.x, from.y); await sleep(30);
  mouse("mouseDown", from.x, from.y, { button: "left", clickCount: 1 });
  for (let step = 1; step <= 6; step += 1) { mouse("mouseMove", from.x + (first.x + 8 - from.x) * step / 6, from.y, { buttons: 1 }); await sleep(40); }
  assert.equal(await run("return Boolean(document.querySelector('.ts-drop'));"), true, "a line shows where it will land");
  assert.equal(await run("return document.querySelector('.ts-item[data-dragging]') !== null;"), true, "and the tab follows the pointer");
  await capture("tabs-drag.png");
  mouse("mouseUp", first.x + 8, from.y, { button: "left", clickCount: 1 });
  await sleep(200);
  const after = await routes();
  assert.notDeepEqual(after, before, "the order changed");
  assert.equal(after[1], before.at(-1), "the dragged tab is first among the rest");
  assert.deepEqual([...after].sort(), [...before].sort(), "and nothing was lost");
  assert.equal(await run("return document.querySelector('.ts-drop') === null && document.querySelector('.ts-item[data-dragging]') === null;"), true);
  const pageAfterDrag = await current();
  assert.equal(pageAfterDrag, before.at(-1).split(":")[0] === "workspace" ? "workspace" : before.at(-1), "the drag did not change the page");

  // the keys, through the real keyboard
  await key("T", ["control"]);
  await until("document.querySelector('.ts-pop-add')", "Ctrl+T opens the Add menu");
  assert.equal(await run("return window.MefiNav.state.transient;"), null, "and nothing else (Search stays closed)");
  assert.equal(await run("return document.activeElement && document.activeElement.id;"), "mefi-tabs-search");
  await typeText("agents");
  await until("document.getElementById('mefi-tabs-search').value === 'agents' && [...document.querySelectorAll('.ts-pop-add .ts-rowlabel')].some((node) => node.textContent === 'Agents')", "typing narrows the list to what matches");
  assert.equal(await run("return document.getElementById('mefi-tabs-search').value;"), "agents", "the letters went to the search box, not to a shortcut");
  const found = await run("return [...document.querySelectorAll('.ts-pop-add .ts-rowlabel')].map((node) => node.textContent);");
  assert.ok(found.includes("Agents"), `Agents is among the rows: ${found}`);
  for (let step = 0; step < found.indexOf("Agents"); step += 1) await key("Down");
  assert.equal(await run("return document.querySelector('.ts-pop-add .ts-row[aria-selected=\"true\"] .ts-rowlabel').textContent;"), "Agents", "the arrow keys move the selection");
  await key("Enter");
  await until("window.MefiTabs.list().some((tab) => tab.route.id === 'agents') && window.MefiNav.current() === 'agents'", "Enter opens Agents in a tab");
  assert.equal(await run("return !document.querySelector('.ts-pop');"), true);
  // Ctrl+Tab and Ctrl+Shift+Tab walk the tabs in the order they are drawn, round the ends
  const around = async (chord, step) => {
    const before = await run("const list = window.MefiTabs.list(); return { ids: list.map((tab) => tab.id), at: list.findIndex((tab) => tab.active) };");
    await key("Tab", chord);
    const wanted = before.ids[(before.at + step + before.ids.length) % before.ids.length];
    await until(`window.MefiTabs.active() === ${JSON.stringify(wanted)}`, `Ctrl+${chord.includes("shift") ? "Shift+" : ""}Tab goes from tab ${before.at + 1} to ${((before.at + step + before.ids.length) % before.ids.length) + 1} of ${before.ids.length}`);
    await until("window.MefiNav.current() === (window.MefiTabs.list().find((tab) => tab.active).route.id === 'workspace' ? 'workspace' : window.MefiTabs.list().find((tab) => tab.active).route.id)", "and the page follows");
  };
  await around(["control"], 1);
  await around(["control", "shift"], -1);
  for (let hop = 0; hop < 6; hop += 1) await around(["control"], 1); // all the way round, and a little more
  await key("2", ["control"]);
  await until("window.MefiTabs.active() === window.MefiTabs.list()[1].id", "Ctrl+2 jumps to the second tab");
  await key("9", ["control"]);
  await until("window.MefiTabs.active() === window.MefiTabs.list().at(-1).id", "Ctrl+9 jumps to the last");
  const countBefore = (await routes()).length;
  await key("W", ["control"]);
  await until(`window.MefiTabs.list().length === ${countBefore - 1}`, "Ctrl+W closes the tab you are on");
  report.keys.ctrlWClosesTheTab = true; // (this window is hidden, and a hidden window's menu does not act on keys: what happens to a window is the last step's)
  await key("1", ["control"]);
  await until("window.MefiTabs.active() === 'home'", "Ctrl+1 is Home");
  await key("W", ["control"]);
  await sleep(150);
  assert.equal(await run("return window.MefiTabs.active() === 'home' && window.MefiTabs.list().length > 0;"), true, "Ctrl+W on Home closes nothing");
  assert.equal(await run("return document.querySelector('.ts-live').textContent;"), `${homeTitle} stays open`);

  // Ctrl+K and Ctrl+, are not the strip's; and Escape in a menu leaves the page under it alone
  await key("K", ["control"]);
  await until("window.MefiNav.state.transient === 'palette'", "Ctrl+K still opens Search");
  await key("T", ["control"]);
  await sleep(150);
  assert.equal(await run("return !document.querySelector('.ts-pop');"), true, "with Search up, the strip takes no key");
  await key("Escape");
  await until("window.MefiNav.state.transient === null", "Escape closes Search");
  await run("await window.MefiTabs.activate(window.MefiTabs.list().find((tab) => tab.route.id === 'plans').id);");
  await until("window.MefiNav.current() === 'plans'", "on Plans");
  point = await center(".ts-add"); await click(point.x, point.y);
  await until("document.querySelector('.ts-pop-add')", "the Add menu over a sheet");
  await key("Escape");
  await until("!document.querySelector('.ts-pop')", "Escape closes the menu");
  assert.equal(await run("return window.MefiNav.state.sheet;"), "plans", "and not the sheet under it");

  // focus is visible: shift-Tab from the + button lands on the selected tab (the list is one tab stop), a real arrow key moves along, and the focused tab has a ring
  await run("document.querySelector('.ts-add').focus();");
  await key("Tab", ["shift"]);
  assert.equal(await run("return document.activeElement.classList.contains('ts-tab') && document.activeElement.getAttribute('aria-selected');"), "true", "Shift+Tab from the + button lands on the tab you are on: the strip is one tab stop");
  await key("Right");
  const ring = await run(`const node = document.activeElement; const style = getComputedStyle(node); return { cls: node.className, selected: node.getAttribute('aria-selected'), focusVisible: node.matches(':focus-visible'), outline: style.outlineStyle, width: style.outlineWidth, colour: style.outlineColor };`);
  assert.equal(ring.cls, "ts-tab");
  assert.equal(ring.selected, "false", "the arrow moved focus to another tab without opening it");
  assert.equal(ring.focusVisible, true, "a keyboard user is shown where they are");
  assert.notEqual(ring.outline, "none");
  assert.ok(parseFloat(ring.width) >= 2, `the ring is ${ring.width}`);
  await capture("tabs-focus.png");
  const focusedTab = await run("return { id: document.activeElement.dataset.id, route: window.MefiTabs.list().find((tab) => tab.id === document.activeElement.dataset.id).route.id };");
  await key("Enter");
  await until(`window.MefiTabs.active() === ${JSON.stringify(focusedTab.id)}`, "Enter opens the tab that has focus");
  await until(`window.MefiNav.current() === ${JSON.stringify(focusedTab.route)}`, "and its page shows");

  // the cap: a fourth unpinned tab closes the oldest, says so, and Undo puts it back
  await wipe();
  await run("window.MefiTabs.setPrefs({ cap: 3 });");
  await run(`const T = window.MefiTabs; for (const id of ['fleet', 'plans', 'worktrees', 'tasks']) { T.open(id, {}, { preview: false }); await window.__fx.tick(); await window.__fx.tick(); }`);
  await until("document.querySelector('#toast-host .toast-action')", "a tab closed to keep three, with an Undo");
  assert.match(await run("return document.getElementById('toast-host').textContent;"), /Closed “Fleet” to keep 3 tabs open\./);
  assert.deepEqual(await routes(), ["workspace", "plans", "worktrees", "tasks"]);
  point = await center("#toast-host .toast-action");
  await click(point.x, point.y);
  await until("window.MefiTabs.list().some((tab) => tab.route.id === 'fleet')", "Undo brings Fleet back");
  assert.equal((await routes()).indexOf("workspace:undefined") === -1, true);
  assert.equal(await run("return window.MefiTabs.recentlyClosed().some((tab) => tab.route.id === 'fleet');"), false, "and it is no longer in Recently closed");
  await run("window.MefiTabs.setPrefs({ cap: 12 });");

  // ===================================================================================================================================
  // 3. real pages
  // ===================================================================================================================================
  await wipe();
  const pid = await run("return window.MefiWorkspace.snapshot().projectId;");
  await run(`window.MefiTabs.open('workspace', { view: 'task', taskId: 't-dark', projectId: ${JSON.stringify(pid)} }, { preview: false });`);
  await until("window.MefiBuilder.active() && window.MefiBuilder.view().view === 'task' && window.MefiBuilder.view().taskId === 't-dark'", "a session tab opens that session in Build");
  assert.equal(await run("return window.MefiTabs.list().find((tab) => tab.active).title;"), "Add dark mode to the settings page");
  assert.equal(await run("return window.MefiTabs.list().find((tab) => tab.active).route.params.taskId;"), "t-dark");
  await run(`window.MefiTabs.open('agents', {}, { preview: false });`);
  await until("window.MefiNav.current() === 'agents'", "Agents from a tab");
  await run(`window.MefiTabs.open('agents', { section: 'setup', pane: 'routing' }, { preview: false });`);
  await sleep(400);
  assert.equal(await run("return window.MefiTabs.list().filter((tab) => tab.route.id === 'agents').map((tab) => tab.title);").then((titles) => titles.length), 2, "Agents and Agents · Routing are two tabs");
  assert.ok((await run("return window.MefiTabs.list().filter((tab) => tab.route.id === 'agents').map((tab) => tab.title);")).includes("Agents · Routing"));
  // back through the nav's own history moves the strip
  await run(`window.MefiTabs.open('fleet', {}, { preview: false });`);
  await until("window.MefiNav.current() === 'fleet'", "Fleet");
  await run("window.MefiNav.back();");
  await until("window.MefiTabs.list().find((tab) => tab.active).route.id !== 'fleet'", "going Back with the nav's own history moves the strip off Fleet");
  await until("window.MefiNav.current() === window.MefiTabs.list().find((tab) => tab.active).route.id || window.MefiTabs.list().find((tab) => tab.active).route.id === 'workspace'", "to the tab of the page that shows");
  // a page that opens itself (showTab) is followed too
  await run("window.MefiNav.closeAll(); window.MefiWorkspace.exit(); window.MefiBooklet.showTab('graph');");
  await until("window.MefiTabs.list().some((tab) => tab.route.id === 'graph' && tab.active)", "a page that opens without go() becomes a tab");
  assert.equal(await run("return window.MefiTabs.list().find((tab) => tab.route.id === 'graph').prev;"), true, "the preview one");
  await capture("tabs-pages.png");

  // an agent that needs you: a tab with a badge opens in the background and the page you are on stays
  await wipe();
  await run(`window.MefiTabs.setPrefs({ agent: 'bg' }); window.MefiTabs.needs('workspace', { view: 'task', taskId: 't-db', projectId: ${JSON.stringify(pid)} }); await window.__fx.tick();`);
  await sleep(300);
  const needs = await run(`const item = [...document.querySelectorAll('.ts-item')].find((node) => node.dataset.attn === 'true'); if (!item) return null; const flag = item.querySelector('.ts-flag'); return { title: item.querySelector('.ts-title').textContent, flag: window.__fx.rect(flag), item: window.__fx.rect(item), shown: window.__fx.shown(flag), color: getComputedStyle(flag).backgroundColor, warn: (() => { const probe = document.createElement('i'); probe.style.color = 'var(--warn)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; })(), active: item.dataset.active === 'true', label: item.querySelector('.ts-tab').getAttribute('aria-label'), ring: getComputedStyle(item).boxShadow };`);
  assert.ok(needs, "an agent that needs you gets a tab of its own, in the background, with a badge");
  assert.equal(needs.title, "Choose the database");
  assert.equal(needs.active, false, "and you stay where you are");
  assert.equal(await current(), "workspace");
  assert.equal(needs.shown, true, "the badge is drawn");
  assert.equal(needs.color, needs.warn, "in the theme's warning colour, not a colour of its own");
  assert.ok(needs.flag.x >= needs.item.x && needs.flag.r <= needs.item.r + 0.5 && needs.flag.y >= needs.item.y - 0.5, "and sits on the tab");
  assert.match(needs.label, /, needs you$/);
  assert.notEqual(needs.ring, "none", "the tab has a warm ring");
  await capture("tabs-needs-you.png");

  // ===================================================================================================================================
  // 4. Configuration and Search
  // ===================================================================================================================================
  await wipe(); await home();
  await run("await window.MefiConfig.open({ category: 'ui' });");
  await until("document.querySelector('#config-pane .ts-card')", "Configuration › UI & Surfaces shows the Tab behaviour card");
  const card = await run(`const node = document.querySelector('#config-pane .ts-card'); const switches = [...node.querySelectorAll('input')].map((input) => [input.dataset.key, input.checked, getComputedStyle(input.closest('label')).display]); return { box: window.__fx.rect(node), pane: window.__fx.rect(document.getElementById('config-pane')), switches, small: window.__fx.small(node), missing: window.__fx.missingGlyphs(node), gutter: window.__fx.gutter(document.getElementById('config-pane')), overflowX: window.__fx.overflowX(node), controls: node.querySelectorAll('.ts-choice').length };`);
  assert.deepEqual(card.switches.map((item) => item[0]), ["manage", "preview", "suggest"]);
  assert.ok(card.box.x >= card.pane.x - 1 && card.box.r <= card.pane.r + 1, `the card fits the pane: ${JSON.stringify(card.box)} in ${JSON.stringify(card.pane)}`);
  assert.deepEqual(card.small, []);
  assert.deepEqual(card.missing, []);
  assert.equal(card.overflowX, false);
  assert.equal(card.controls, 7, "three agent choices and four idle choices");
  await run("document.querySelector('#config-pane .ts-card').scrollIntoView({ block: 'center' });");
  await capture("tabs-card.png");
  // a real click on the preview switch is a setting: it is saved and it does what it says
  point = await run("const input = document.querySelector('#config-pane .ts-card input[data-key=\"preview\"]'); const box = input.closest('label').getBoundingClientRect(); return { x: box.left + 18, y: box.top + 10 };");
  await click(point.x, point.y);
  await until("window.MefiTabs.prefs().preview === false", "the preview switch turns the preview tab off");
  assert.equal(await run("return JSON.parse(localStorage.getItem('mefiStudio.tabs.prefs.v1')).preview;"), false, "and it is saved");
  await run("window.MefiTabs.setPrefs({ preview: true });");
  await run("window.MefiConfig.close?.(); window.MefiNav.closeAll();");
  await sleep(200);
  // Search finds the card by its words and opens it where the tabs are
  await home();
  await key("K", ["control"]);
  await until("window.MefiNav.state.transient === 'palette'", "Search is up");
  await typeText("tab behav");
  await until("[...document.querySelectorAll('#palette-list [role=\"option\"], #palette-results [role=\"option\"], .palette-row')].some((row) => /Tab behaviour/.test(row.textContent))", "Search lists Tab behaviour", 6000).catch(async () => {
    report.notes.push(await run("return document.getElementById('palette-overlay') ? document.getElementById('palette-overlay').textContent.slice(0, 400) : 'no palette';"));
    throw new Error("Search does not list Tab behaviour");
  });
  await key("Enter");
  await until("document.querySelector('.ts-pop-behaviour')", "Enter on it opens the card beside the tabs");
  assert.equal(await run("return window.MefiNav.state.transient;"), null, "Search closed itself");
  await capture("tabs-behaviour.png");
  await key("Escape");
  await until("!document.querySelector('.ts-pop')", "Escape closes the card");

  // ===================================================================================================================================
  // 5. the Vibe home, a light theme
  // ===================================================================================================================================
  await resize([1440, 900, 1]); await run("await window.MefiNav.go('workspace');");
  await setup("vibe"); await home(); await sleep(300);
  await run(`const T = window.MefiTabs; for (const id of ['fleet', 'plans']) { T.open(id, {}, { preview: false }); await window.__fx.tick(); }`);
  await sleep(300);
  const vibe = await strip();
  assert.ok(vibe.strip.y >= -0.5 && vibe.strip.b <= vibe.usable.top + 0.5, "Vibe: the strip is at the top of the window, over the page");
  assert.equal(await run("return window.MefiNav.get('workspace').short;"), "Vibe", "in Vibe the nav calls Home by its own name");
  assert.deepEqual(vibe.items.filter((item) => item.home).map((item) => item.title), [await run("return window.MefiToday ? 'Today' : 'Vibe';")], "and the first tab says the same, until the Today board (where it is in the window) gives it its name");
  await capture("tabs-vibe.png");
  await run("await window.MefiNav.go('workspace');");
  await setup("build"); await home();
  // A light custom palette (the themes themselves are dark): every colour on the strip and its menus comes from the tokens, so it follows.
  await run(`const T = window.MefiTabs; for (const id of ['fleet', 'plans', 'worktrees']) { T.open(id, {}, { preview: false }); await window.__fx.tick(); } T.pin(T.list().find((tab) => tab.route.id === 'fleet').id, true); window.MefiMusic.applyCustomColors({ accent: '#8A5A00', background: '#F6F3EC', surface: '#FFFFFF', text: '#1F1B16' }, false);`);
  await sleep(500);
  const light = await run(`const strip = document.querySelector('.ts-strip'); const active = document.querySelector('.ts-item[data-active]'); const tab = active.querySelector('.ts-title'); const idle = [...document.querySelectorAll('.ts-item:not([data-active]):not([data-home])')].find((node) => window.__fx.shown(node));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const paint = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = (css) => { paint.clearRect(0, 0, 1, 1); paint.fillStyle = '#000'; paint.fillStyle = css; paint.fillRect(0, 0, 1, 1); const data = paint.getImageData(0, 0, 1, 1).data; return [data[0], data[1], data[2], data[3] / 255]; };
    const fill = (node) => { let walk = node; while (walk) { const value = rgba(getComputedStyle(walk).backgroundColor); if (value[3] >= 0.97) return value; walk = walk.parentElement; } return rgba(getComputedStyle(document.body).backgroundColor); };
    const lum = ([r, g, b]) => { const [x, y, z] = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const text = (node) => rgba(getComputedStyle(node).color);
    const idleTitle = idle.querySelector('.ts-title');
    const chip = document.querySelector('.ts-count:not([hidden])');
    const mix = (a, b, t) => [0, 1, 2].map((i) => a[i] * t + b[i] * (1 - t));
    const probe = document.createElement('i'); probe.style.color = 'var(--warn)'; document.body.append(probe); const warn = rgba(getComputedStyle(probe).color); probe.remove();
    const chipFill = chip ? mix(warn, fill(chip), 0.26) : null;
    return { page: fill(strip), active: { text: text(tab), fill: fill(tab), ratio: ratio(text(tab), fill(tab)) }, idle: { text: text(idleTitle), fill: fill(idleTitle), ratio: ratio(text(idleTitle), fill(idleTitle)) }, count: chip ? { text: text(chip), fill: chipFill, ratio: ratio(text(chip), chipFill) } : null };`);
  report.notes.push({ light });
  assert.ok(light.active.ratio >= 4.5, `the tab you are on is readable on a light palette (contrast ${light.active.ratio.toFixed(2)})`);
  assert.ok(light.idle.ratio >= 3, `and so are the others (contrast ${light.idle.ratio.toFixed(2)})`);
  assert.ok(light.count && light.count.ratio >= 4.5, `and the number on Home's badge (contrast ${light.count && light.count.ratio.toFixed(2)})`);
  await capture("tabs-light.png");
  await run("const point = document.querySelector('.ts-add').getBoundingClientRect(); return point.left;");
  point = await center(".ts-add"); await click(point.x, point.y);
  await until("document.querySelector('.ts-pop-add')", "the Add menu on a light palette");
  await capture("tabs-light-add.png");
  await key("Escape");
  await run("window.MefiMusic.applyTheme('aurora', false);");
  await sleep(300);

  // ===================================================================================================================================
  // 6. the tabs survive a reload
  // ===================================================================================================================================
  await wipe(); await home();
  await run(`const T = window.MefiTabs, pid = window.MefiWorkspace.snapshot().projectId; for (const id of ['fleet', 'plans', 'worktrees']) { T.open(id, {}, { preview: false }); await window.__fx.tick(); } T.open('workspace', { view: 'task', taskId: 't-login', projectId: pid }, { preview: false }); await window.__fx.tick(); T.pin(T.list().find((tab) => tab.route.id === 'plans').id, true); T.close(T.list().find((tab) => tab.route.id === 'worktrees').id);`);
  await sleep(200);
  const beforeReload = await run("return window.MefiTabs.list().filter((tab) => !tab.prev).map((tab) => [tab.route.id, tab.route.params.taskId || null, tab.pin]);");
  const resumed = await run("return window.MefiNav.saveResume();");
  assert.equal(resumed.tabs.v, 1, "the reload record carries the strip's state");
  assert.ok(resumed.tabs.count >= 4);
  contents.reloadIgnoringCache();
  await until("window.MefiTabs && window.MefiTabs.running() && !window.MefiBoot?.isActive?.()", "the strip is back after a reload", 20000);
  await run(PAGE);
  await sleep(500);
  // (a diagnostic launch lands on the page that was showing last, here the Catalog or Performance tab page, as the preview tab)
  const afterReload = await run("return window.MefiTabs.list().filter((tab) => !tab.prev).map((tab) => [tab.route.id, tab.route.params.taskId || null, tab.pin]);");
  assert.deepEqual(afterReload, beforeReload, "the same tabs, in the same order, with the same pins");
  assert.ok((await run("return window.MefiTabs.list().filter((tab) => tab.prev).length;")) <= 1, "and at most the one preview tab of the page the launch landed on");
  assert.equal(await run("return window.MefiTabs.recentlyClosed().map((tab) => tab.route.id).includes('worktrees');"), true, "and Recently closed");
  assert.deepEqual(report.errors, []);
  await capture("tabs-reloaded.png");

  // ===================================================================================================================================
  // 7. the host's switch
  // ===================================================================================================================================
  await run("localStorage.setItem('fx.tabsOff', '1');"); // what MEFI_STUDIO_NO_TAB_MANAGER=1 makes prefs:get say, for the next launch
  contents.reloadIgnoringCache();
  await until("window.MefiTabs && window.MefiTabs.running() && !window.MefiBoot?.isActive?.()", "the strip is back", 20000);
  await run(PAGE);
  await until("window.MefiTabs.prefs().forcedOff === true", "the host's answer reaches the strip");
  await run("await window.MefiNav.go('tasks'); await window.__fx.tick(); await window.MefiNav.go('plans'); await window.__fx.tick();");
  await sleep(300);
  assert.equal(await run("return window.MefiTabs.list().some((tab) => tab.prev);"), false, "MEFI_STUDIO_NO_TAB_MANAGER: no preview tab for this run");
  await run("await window.MefiConfig.open({ category: 'ui' });");
  await until("document.querySelector('#config-pane .ts-card')", "the card");
  assert.equal(await run("return document.querySelector('#config-pane .ts-card input[data-key=\"manage\"]').disabled;"), true, "and the master switch cannot turn it back on");
  assert.match(await run("return document.querySelector('#config-pane .ts-card').textContent;"), /MEFI_STUDIO_NO_TAB_MANAGER/);
  await capture("tabs-forced-off.png");
  await run("window.MefiNav.closeAll(); localStorage.removeItem('fx.tabsOff');");

  // ===================================================================================================================================
  // 8. v1: nothing is drawn, heard or stored
  // ===================================================================================================================================
  // (the v2 page is stopped first, so nothing of it is left to write as it goes away)
  await run("window.MefiTabs.stop(); for (const key of Object.keys(localStorage)) if (key.startsWith('mefiStudio.tabs.') || key === 'mefiStudio.layout') localStorage.removeItem(key);");
  await window.loadFile(bookletFile, { query: { capture: "1", layout: "v1", home: "sessions" } });
  await until("window.MefiNav && window.MefiVibe && window.MefiWorkspace && window.MefiTasks && window.MefiTabs && !window.MefiBoot?.isActive?.()", "v1 is up");
  await sleep(600);
  const v1 = await run(`return {
    layout: document.documentElement.dataset.layout || null, running: window.MefiTabs.running(), list: window.MefiTabs.list(), strips: document.querySelectorAll('.ts-strip, .ts-pop').length,
    shell: Boolean(document.getElementById('fx-region-tabs')), variable: document.documentElement.style.getPropertyValue('--shell-tabs-h'), card: window.MefiTabs.configCard(), save: window.MefiTabs.saveState(),
  };`);
  assert.deepEqual(v1, { layout: null, running: false, list: [], strips: 0, shell: false, variable: "", card: null, save: null }, "layout v1: no strip, no shell region, no variable, nothing to ask");
  await run("await window.MefiNav.go('fleet'); await window.__fx?.tick?.(); await window.MefiNav.go('plans'); await new Promise((resolve) => setTimeout(resolve, 200));");
  await run("await window.MefiNav.go('workspace');");
  for (const [code, modifiers] of [["T", ["control"]], ["W", ["control"]], ["Tab", ["control"]], ["1", ["control"]], ["T", ["control", "shift"]]]) await key(code, modifiers);
  await sleep(300);
  assert.deepEqual(await stored(), [], "v1 writes no tab key, whatever you do");
  assert.equal(await run("return document.querySelectorAll('.ts-strip, .ts-pop').length === 0 && window.MefiNav.state.transient === null;"), true, "and its keys are nobody's");
  await run("await window.MefiConfig.open({ category: 'ui' });");
  await until("document.querySelector('#config-pane input[type=\"range\"]')", "v1: Configuration › UI & Surfaces opens with its interface scale");
  assert.equal(await run("return document.querySelector('#config-pane .ts-card') === null;"), true, "and without a Tab behaviour card: there is no strip to set");
  await run("window.MefiNav.closeAll();");
  assert.equal(await run("return window.MefiNav.saveResume().tabs;"), null, "a v1 reload record has no tabs in it");
  assert.equal(await run("return JSON.parse(localStorage.getItem('mefiStudio.resume')).tabs;"), null, "and neither has what it stored");
  assert.deepEqual(report.errors, []);
  report.v1Untouched = true;

  // ===================================================================================================================================
  // 9. Ctrl+W and the window's own menu. Only a visible, focused window acts on a menu accelerator (a hidden, inactive or offscreen one does
  //    not, which a probe on this platform showed), so two small windows are shown for a moment: the real application menu template from
  //    main.cjs is set, and Ctrl+W is sent to a page that ignores it (its window must close: the control, which proves the check can
  //    see a close at all) and to a page that takes it with preventDefault, as the strip does (its window must stay).
  //    MEFI_TABS_SKIP_WINDOW_PROBE=1 leaves this step out (it puts two windows on screen for about two seconds).
  // ===================================================================================================================================
  if (process.env.MEFI_TABS_SKIP_WINDOW_PROBE === "1") { report.keys.windowProbe = "skipped"; assert.deepEqual(report.errors, []); report.complete = true; finish(); return; }
  const menuSource = fs.readFileSync(path.join(studio, "main.cjs"), "utf8").replace(/\r\n/g, "\n");
  const from0 = menuSource.indexOf("function applicationMenu() {"), to0 = menuSource.indexOf("async function applyReload");
  assert.ok(from0 > 0 && to0 > from0, "the application menu is in main.cjs");
  // The template is main.cjs's own, run here with stubs for what its clicks call. Should it ever need more than that to be built outside
  // the app, the probe is left out and says why, rather than failing a check that is about the platform and not about the strip.
  try {
    const applicationMenu = new Function("Menu", "requestQuit", "reloadKeepingPlace", "stepUiZoom", `${menuSource.slice(from0, to0)}\nreturn applicationMenu;`)(Menu, () => {}, async () => {}, async () => {});
    Menu.setApplicationMenu(applicationMenu());
  } catch (error) {
    report.keys.windowProbe = `The application menu in main.cjs could not be built outside the app (${String((error && error.message) || error).slice(0, 160)}), so what Ctrl+W does to a window was not checked.`;
    report.notes.push(report.keys.windowProbe);
    assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
    report.complete = true; finish(); return;
  }
  const probe = async (html, label) => {
    const win = new BrowserWindow({ show: true, width: 420, height: 260, frame: true, webPreferences: { contextIsolation: true, sandbox: true } });
    let closed = false;
    win.once("closed", () => { closed = true; });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    win.focus(); await sleep(400);
    win.webContents.focus(); await sleep(150);
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "W", modifiers: ["control"] });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "W", modifiers: ["control"] });
    await sleep(900);
    const gone = closed || win.isDestroyed();
    if (!gone) win.destroy();
    report.keys[label] = gone ? "the window closed" : "the window stayed";
    return gone;
  };
  const control = await probe("<title>control</title><body>a page that does not take Ctrl+W</body>", "pageIgnoresCtrlW");
  const taken = await probe("<title>taken</title><body><script>addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') { event.preventDefault(); event.stopPropagation(); document.title = 'handled'; } }, true);</script></body>", "pageTakesCtrlW");
  report.keys.windowMenuCloseObservable = control === true;
  if (control) assert.equal(taken, false, "a page that takes Ctrl+W keeps its window: that is the whole of how the strip keeps Ctrl+W from closing Studio");
  else report.notes.push("the window menu's Close did not act on a synthetic Ctrl+W here, so the page-takes-the-key check could not be made on this platform");

  assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
  report.complete = true;
  finish();
}).catch(finish);
