"use strict";

// The 0.5 shell's frame in a real Chromium (docs/unified-studio.md, "The frame"):
// a copied booklet, a synthetic bridge, no live state. The window is put through
// five sizes (1920x1080, 1440x900, 1100x720, 600x560, and 600x560 at zoom 1.5,
// which is about 400 CSS px), Build and Vibe, the menu closed and pinned, and
// what is drawn is measured, not assumed:
//
//   1. v1 (the default) has no frame at all: no element, no attribute, no inline
//      variable, and the way in (the Search action, the Settings switch) is there.
//   2. v2: every region is in the page, its real box is the room MefiNav.layout
//      says it was given, nothing leaves the window or overlaps, the top bar holds
//      all its controls inside itself, no text is under 12 px, no scroller reserves
//      width, the page has no overflow, and every destination the registry lists
//      can be opened and lands inside MefiNav.usable().
//   3. The splitters work with a real pointer and real keys: drag, arrow keys,
//      Shift, Home, End, Enter, double-click; the widths are saved per mode and come
//      back after a reload; Vibe and Build swap presets; Ctrl M switches the mode.
//   4. In the smallest window a column is a drawer that stays inside the window,
//      closes on Escape and on a press outside, and returns focus.
//   5. Turning v2 off removes the frame and turning it on again builds it once.
//
// Network, permissions and child processes are blocked. The page's bridge is
// synthetic (tests/fixtures/shell-render-electron.cjs builds it from preload.cjs's
// own names). Set the capture folder variable of the test file to keep the
// screenshots. For debugging only, never for the gate: MEFI_SHELL_ONLY=<text>
// walks only the configurations whose label contains it.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_SHELL_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated shell fixture directory is required");
const studio = path.resolve(__dirname, "..", "..");
const only = process.env.MEFI_SHELL_ONLY || "";
const report = { errors: [], networkAttempts: [], processAttempts: [], v1: {}, configs: {}, walks: {}, interactions: {}, shots: [], complete: false };
app.setName("Shell Render Fixture");
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

// The five windows, in device pixels plus the zoom a person would have.
const SIZES = [[1920, 1080, 1], [1440, 900, 1], [1100, 720, 1], [600, 560, 1], [600, 560, 1.5]];
const MODES = ["build", "vibe"];
const RAILS = ["closed", "pinned"];
const label = ([width, height, zoom]) => `${width}x${height}@${zoom}`;
const REGION_IDS = ["shell-frame", "shell-top", "shell-list", "shell-inspector", "shell-tabs", "shell-status", "shell-main", "shell-scrim", "shell-split-rail", "shell-split-list", "shell-split-inspector"];
const LAYOUT_KEY = "mefiStudio.shell.layout.v1";

// What the page reports about the frame, run in the renderer. Boxes are [left, top, width, height] in CSS px, 0.01 rounded, or null when not on screen.
function probe() {
  const round = (value) => Math.round(value * 100) / 100;
  const shown = (node) => Boolean(node && !node.hidden && !node.closest("[hidden]") && node.getClientRects().length && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
  const rect = (id) => { const node = document.getElementById(id); if (!shown(node)) return null; const box = node.getBoundingClientRect(); return [round(box.left), round(box.top), round(box.width), round(box.height)]; };
  const nav = window.MefiNav, shell = window.MefiShell;
  // The variables as the regions see them: from <body>, which redefines some of them (a pinned rail, a page's own row).
  const de = document.documentElement, style = getComputedStyle(document.body);
  const length = (name) => parseFloat(style.getPropertyValue(name)) || 0;
  const frame = document.getElementById("shell-frame");
  const inside = frame ? [...frame.querySelectorAll("*")] : [];
  // Text under 12 px: any element of the frame that has text of its own on screen.
  const small = inside.filter((node) => shown(node) && [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim()) && parseFloat(getComputedStyle(node).fontSize) < 11.99).map((node) => `${node.id || node.className}:${getComputedStyle(node).fontSize}`);
  // A scroller that keeps a native bar or a gutter for one.
  const gutters = inside.filter((node) => shown(node) && /(auto|scroll)/.test(getComputedStyle(node).overflowY + getComputedStyle(node).overflowX) && getComputedStyle(node).scrollbarWidth !== "none" && node.offsetWidth - node.clientWidth - parseFloat(getComputedStyle(node).borderLeftWidth) - parseFloat(getComputedStyle(node).borderRightWidth) > 1).map((node) => node.id || node.className);
  // Everything on screen in the frame stays in the window.
  const outside = inside.filter((node) => { if (!shown(node)) return false; const box = node.getBoundingClientRect(); return box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1; }).map((node) => `${node.id || node.className}:${Math.round(node.getBoundingClientRect().left)},${Math.round(node.getBoundingClientRect().top)},${Math.round(node.getBoundingClientRect().right)},${Math.round(node.getBoundingClientRect().bottom)}`);
  const infoOf = (name) => { const one = shell?.info?.(name); return one ? { open: one.open, docked: one.docked, drawer: one.drawer, drawerOpen: one.drawerOpen, size: one.size, width: one.width, max: one.max } : null; };
  const bar = document.getElementById("shell-top");
  const barBox = shown(bar) ? bar.getBoundingClientRect() : null;
  const controls = ["shell-list-toggle", "shell-search", "shell-need", "shell-svc", "shell-inspector-toggle"].map((id) => { const node = document.getElementById(id); const hidden = !node || !shown(node); const box = hidden ? null : node.getBoundingClientRect(); return [id, hidden ? null : [round(box.left), round(box.right)], hidden ? null : Boolean(barBox && box.left >= barBox.left - 1 && box.right <= barBox.right + 1 && box.top >= barBox.top - 1 && box.bottom <= barBox.bottom + 1)]; });
  const mode = [...document.querySelectorAll("#shell-top .mode-switch [data-ui-mode]")].map((node) => [node.dataset.uiMode, node.getAttribute("aria-checked"), shown(node)]);
  const splitters = Object.fromEntries(["rail", "list", "inspector"].map((name) => { const node = document.getElementById(`shell-split-${name}`); return [name, shown(node) ? { box: rect(`shell-split-${name}`), now: Number(node.getAttribute("aria-valuenow")), min: Number(node.getAttribute("aria-valuemin")), max: Number(node.getAttribute("aria-valuemax")), role: node.getAttribute("role"), cursor: getComputedStyle(node).cursor, line: getComputedStyle(node, "::after").width, tabindex: node.getAttribute("tabindex") } : null]; }));
  const railBox = (id) => { const node = document.getElementById(id); return shown(node) ? round(node.getBoundingClientRect().right) : 0; };
  const area = nav.usable();
  return {
    inner: [innerWidth, innerHeight], zoom: round(window.devicePixelRatio), layout: de.dataset.layout ?? null, frameOn: de.dataset.frame ?? null, shellAttr: de.dataset.shell ?? null, uiMode: de.dataset.uiMode ?? null, fold: de.dataset.layoutFold ?? null, narrow: de.hasAttribute("data-frame-narrow"),
    route: nav.current(), mode: shell?.mode?.() ?? null, active: shell?.active?.() ?? null,
    boxes: { top: rect("shell-top"), list: rect("shell-list"), inspector: rect("shell-inspector"), tabs: rect("shell-tabs"), status: rect("shell-status"), main: rect("shell-main"), scrim: rect("shell-scrim"), localNav: rect("app-local-nav"), rail: rect("app-rail"), vibeRail: rect("vibe-rail"), vibeLayer: rect("vibe-layer") },
    clusters: (() => { const one = (selector) => { const node = document.querySelector(selector); if (!shown(node)) return null; const box = node.getBoundingClientRect(); return [round(box.left), round(box.right)]; }; return { left: one("#shell-top .shell-top-left"), right: one("#shell-top .shell-top-right") }; })(),
    rest: Math.max(railBox("app-rail"), railBox("vibe-rail")),
    contract: { get: nav.layout.get(), used: nav.layout.used() },
    // The derived edges are calc() of these, which a computed style leaves unresolved: the parts are read and added here.
    vars: { list: length("--shell-list-w"), inspector: length("--shell-inspector-w"), tabs: length("--shell-tabs-h"), status: length("--shell-status-h"), local: length("--shell-local-h"), y0: length("--shell-local-h") + length("--shell-tabs-h") },
    info: { list: infoOf("list"), inspector: infoOf("inspector"), tabs: infoOf("tabs") },
    usable: [round(area.left), round(area.top), round(area.right), round(area.bottom)],
    // A person scrolls the page only when the viewport's overflow allows it and there is more to see: Home, Command and Vibe hide theirs.
    overflow: (() => { const rootStyle = getComputedStyle(de); const from = (axis) => (rootStyle[axis] === "visible" ? getComputedStyle(document.body)[axis] : rootStyle[axis]); return [!["hidden", "clip"].includes(from("overflowX")) && de.scrollWidth > innerWidth + 1, !["hidden", "clip"].includes(from("overflowY")) && de.scrollHeight > innerHeight + 1]; })(),
    scroll: [de.scrollWidth, de.scrollHeight], small, gutters, outside, controls, mode_switch: mode, splitters,
    saved: (() => { try { return JSON.parse(localStorage.getItem("mefiStudio.shell.layout.v1")); } catch { return null; } })(),
    drawerAttr: frame?.dataset.drawer ?? null, columns: { list: document.getElementById("shell-list")?.dataset.state ?? null, inspector: document.getElementById("shell-inspector")?.dataset.state ?? null },
    focus: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null,
    inList: document.getElementById("shell-list")?.contains(document.activeElement) ?? false, inInspector: document.getElementById("shell-inspector")?.contains(document.activeElement) ?? false,
  };
}

async function bridgeNames() {
  const source = fs.readFileSync(path.join(studio, "preload.cjs"), "utf8");
  return [...new Set([...source.matchAll(/^  ([A-Za-z][A-Za-z0-9_]*):/gm)].map((match) => match[1]))];
}

const near = (a, b, slack = 0.51) => Math.abs(a - b) <= slack;

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url) || details.url.startsWith("https://www.youtube-nocookie.com/embed/");
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const now = Date.now(), projectId = "shell-project";
  const tasks = [
    { id: "t1", projectId, title: "Give the tab strip room", prompt: "Keep every page inside the free area", status: "active", runId: "r1", createdAt: now - 60000, updatedAt: now },
    { id: "t2", projectId, title: "Add the session list", prompt: "One column, right of the rail", status: "open", createdAt: now, updatedAt: now },
    { id: "t3", projectId, title: "Check the status bar", prompt: "Nothing faked", status: "awaiting_verification", createdAt: now - 7200000, updatedAt: now - 3600000 },
  ];
  const question = { id: "q1", projectId, status: "open", title: "Which colour for the tabs?", kind: "question", context: {}, createdAt: now };
  const routing = { provider: "zen", roleProviders: {}, models: { routine: "gpt-6-luna", heavy: "gpt-6-sol" }, providerModels: {}, hasZen: true, hasOpenCode: false, hasZai: false, hasOpenRouter: false, hasCustom: false, autoProviders: ["zen", "codex"], autoFallback: true, modelSelection: "fixed", executorCli: "codex", executorModels: {}, executorTierModels: {}, executorTier: "auto", subscriptionFirst: true, lmStudioEndpoint: "http://127.0.0.1:1234/v1", customEndpoint: "", executorTierDefaults: {}, autoSetup: null };
  const configuration = { aiProvider: "zen", aiModels: routing.models, executorCli: "codex", agentBrain: { contextScout: true, deskTool: false, headDrafts: false, nestedDelegation: false } };
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Shell fixture", path: root }] },
    tasksList: { ok: true, projectId, tasks }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: false, useReference: true, useTree: true, useWeb: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: {}, work: [], questions: [question], needsYou: { items: [{ kind: "question", title: question.title, id: question.id }, { kind: "review", title: tasks[2].title, taskId: "t3" }], counts: { question: 1, review: 1, total: 2 } } } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, autoBuild: true, mode: "swarm", minutes: 5, parallel: 2, running: [{ id: "r1", taskId: "t1", title: "Give the tab strip room", startedAt: now - 60000, phase: "building" }], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, counts: { ready: 1, running: 1, blocked: 0, review: 0 }, taskStates: [], next: [] },
    projectPreviewStatus: { ok: true, projectId, phase: "ready", available: true, kind: "static", url: "http://127.0.0.1:44173/", owned: true, canStop: true, message: "App preview is ready", logs: [], checkedAt: now },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getApiKey: { saved: false }, getAiRouting: routing, cliStatus: [], launchStudio: { ok: true }, jevStatus: { ok: true, enabled: false, route: "zen", routes: { vercel: false, typesafe: false, zen: true, openrouter: false } }, openrouterModels: { ok: true, models: [] }, agentModels: { ok: true, models: [] },
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [], skills: [], mcpTools: [], routing, seats: {}, choices: {}, efforts: ["minimal", "low", "medium", "high", "xhigh", "max"] },
    cliSetupStatus: { ok: true, selected: "auto", clis: [] }, firstRunStatus: { ok: true, firstRun: null },
    machineGet: { ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } }, updateStatus: { ok: true, status: { auto: true } },
    companionState: { ok: true, projectId, projectName: "Shell fixture", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: false, bubbles: false, growth: false, queue: { items: [], counts: { total: 1 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
    brainState: { ok: true, tasks: [], recent: [], pipelines: {} }, brainPlaybook: { ok: true, shelf: [], recipes: [] }, brainMap: { ok: true, map: { systems: [], edges: [], files: [] } },
    worktreesList: { ok: true, repo: false, projectId, enabled: { on: false, forced: false } },
    skillsList: { ok: true, skills: [] },
  };
  const names = await bridgeNames();
  const preload = path.join(root, "shell-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const names=${JSON.stringify(names)};const calls=[];const subscribers={};
    const bridge={};
    for(const name of names){
      if(/^on[A-Z]/.test(name))bridge[name]=callback=>{(subscribers[name]??=[]).push(callback);return()=>{};};
      else bridge[name]=async(...args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return name in responses?JSON.parse(JSON.stringify(responses[name])):{ok:true};};
    }
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('shellFixture',{calls:()=>calls.slice(),push:(name,value)=>{for(const callback of subscribers[name]||[])callback(value);},answer:(name,value)=>{responses[name]=value;}});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));localStorage.setItem('mefiStudio.whatsNew.seen','vibe-build-1');
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(60); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, what, ms = 15000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "shell-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${what}`);
  };
  const frames = (count = 2) => run(`for (let turn = 0; turn < ${count}; turn += 1) await new Promise((resolve) => requestAnimationFrame(resolve));`);
  const settle = async () => { await frames(3); await sleep(60); };
  const capture = async (name) => {
    await frames(2);
    await sleep(120);
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
  // Real input through the debugger protocol: trusted events with the right key and code, and a pointer that captures.
  contents.debugger.attach("1.3");
  const pointer = (type, x, y, extra = {}) => contents.debugger.sendCommand("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
  const key = async (name, { ctrl = false, shift = false } = {}) => {
    const codes = { Tab: [9, "Tab"], ArrowRight: [39, "ArrowRight"], ArrowLeft: [37, "ArrowLeft"], Home: [36, "Home"], End: [35, "End"], Enter: [13, "Enter"], Escape: [27, "Escape"], KeyM: [77, "KeyM"], KeyB: [66, "KeyB"], BracketLeft: [219, "BracketLeft"] };
    const [virtual, code] = codes[name] ?? [name.toUpperCase().charCodeAt(0), name];
    const text = name === "Enter" ? "\r" : name === "BracketLeft" ? "[" : "";
    const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const keyName = name.startsWith("Key") ? name.slice(3).toLowerCase() : name === "BracketLeft" ? "[" : name;
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: keyName, code, windowsVirtualKeyCode: virtual, modifiers, text: ctrl ? "" : text });
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code, windowsVirtualKeyCode: virtual, modifiers });
    await settle();
  };
  // The middle of an element, after checking that it is the element that is there: a pointer acts on what is under it.
  const centre = async (id) => {
    const at = await run(`const box = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2, top = document.elementFromPoint(x, y); return [x, y, Boolean(top && top.closest("#" + ${JSON.stringify(id)})), top ? (top.id || top.className || top.tagName) : null];`);
    assert.ok(at[2], `${id} can be reached by a pointer: ${at[3]} is over its middle (${Math.round(at[0])}, ${Math.round(at[1])})`);
    return at.slice(0, 2);
  };
  const click = async (id) => { const [x, y] = await centre(id); await pointer("mouseMoved", x, y, { button: "none", buttons: 0 }); await pointer("mousePressed", x, y); await pointer("mouseReleased", x, y); await settle(); };
  // A drag with pointer capture: down on the splitter, move in steps, up somewhere else.
  const drag = async (id, dx) => {
    const [x, y] = await centre(id);
    await pointer("mouseMoved", x, y, { button: "none", buttons: 0 });
    await pointer("mousePressed", x, y);
    for (let step = 1; step <= 6; step += 1) { await pointer("mouseMoved", x + (dx * step) / 6, y + step); await sleep(30); }
    await frames(2);
    await pointer("mouseReleased", x + dx, y + 6);
    await settle();
  };
  contents.on("render-process-gone", (_event, details) => finish(new Error(`renderer gone ${JSON.stringify(details)}`)));

  const load = async (query) => {
    await window.loadFile(path.join(root, "renderer", "booklet.html"), { query });
    await until("window.MefiNav && window.MefiVibe && window.MefiWorkspace && window.MefiShell && !window.MefiBoot?.isActive?.()", "studio ready");
    await sleep(500);
  };
  // closeAll() hides the layers after their exit, and some dialogs (Configuration) are not tracked by the nav's layers and stay up through it: close what is still shown by its own close.
  const clear = () => run(`
    const nav = window.MefiNav, tick = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const shown = (node) => Boolean(node && !node.hidden && !node.closest("[hidden]") && node.getClientRects().length);
    nav.closeAll();
    for (const record of nav.list().filter((item) => item.layer && item.element)) if (shown(document.getElementById(record.element))) record.close?.();
    for (let turn = 0; turn < 90 && document.querySelector(".workspace-page:not([hidden]), .overlay:not([hidden])"); turn += 1) await tick();
    await tick();
  `);
  const setup = async ({ mode, rail }) => {
    await clear();
    await run(`window.MefiVibe.closeNotes?.(); window.MefiVibe.setMode('build', { go: false }); window.MefiNav.applyShell(true); window.MefiNav.setRailPinned(${rail === "pinned"}, { save: false });`);
    await sleep(200);
    await run("await window.MefiNav.go('workspace');");
    await until("document.body.classList.contains('workspace-active') || document.body.classList.contains('vibe-active')", "Home is up");
    if (mode !== "build") { await run(`window.MefiShell.setMode(${JSON.stringify(mode)});`); await until("document.body.classList.contains('vibe-active')", "Vibe's Home is up"); }
    await sleep(250);
  };
  const p = async () => run("return window.__shellProbe();");

  // ============ 1. v1: no frame ============
  await load({ capture: "1" });
  await run(`window.__shellProbe = ${probe.toString()};`);
  {
    const v1 = await run(`return {
      active: window.MefiShell.active(), layout: document.documentElement.dataset.layout ?? null, frame: document.documentElement.dataset.frame ?? null,
      elements: ${JSON.stringify(REGION_IDS)}.filter((id) => document.getElementById(id)),
      inline: ['--shell-list-w', '--shell-inspector-w', '--shell-tabs-h', '--shell-status-h', '--frame-top-l', '--frame-top-r'].filter((name) => document.documentElement.style.getPropertyValue(name)),
      action: (() => { const record = window.MefiNav.get('layout-switch'); return record ? { kind: record.kind, label: record.label, palette: record.showIn?.palette } : null; })(),
      keyRows: window.MefiNav.list().filter((record) => record.id.startsWith('shell-key-')).length,
      box: Boolean(document.getElementById('settings-layout-v2')), checked: document.getElementById('settings-layout-v2')?.checked ?? null,
      narrow: document.documentElement.hasAttribute('data-frame-narrow'), stored: localStorage.getItem(${JSON.stringify(LAYOUT_KEY)}),
    };`);
    assert.deepEqual(v1, { active: false, layout: null, frame: null, elements: [], inline: [], action: { kind: "action", label: "Switch layout: 0.5 or classic", palette: true }, keyRows: 0, box: true, checked: false, narrow: false, stored: null }, `v1 has no frame and keeps the way in: ${JSON.stringify(v1)}`);
    await run("await window.MefiNav.go('tasks');"); await settle();
    await run("window.dispatchEvent(new Event('resize'));"); await settle();
    assert.equal(await run(`return ${JSON.stringify(REGION_IDS)}.filter((id) => document.getElementById(id)).length;`), 0, "a page and a resize do not build it");
    report.v1 = v1;
  }

  // ============ 2. v2: the frame ============
  await load({ capture: "1", layout: "v2" });
  await run(`window.__shellProbe = ${probe.toString()};`);
  await until("window.MefiShell.active()", "the frame is built at launch");
  assert.equal(await run("return document.getElementById('settings-layout-v2').checked;"), true, "the Settings switch says v2 is on");

  const checkFrame = (state, tag, { mode, rail }) => {
    const [W, H] = state.inner;
    const b = state.boxes;
    assert.equal(state.layout, "v2", `${tag}: layout`);
    assert.equal(state.frameOn, "on", `${tag}: the frame is on`);
    assert.equal(state.shellAttr, "rail", `${tag}: one shell`);
    assert.equal(state.mode, mode, `${tag}: the mode`);
    assert.equal(state.uiMode === "vibe", mode === "vibe", `${tag}: uiMode is MefiVibe's`);
    // The regions are in the page, and the ones that have room are on screen.
    assert.ok(b.top && b.status, `${tag}: the top bar and the status bar are on screen ${JSON.stringify(b)}`);
    assert.ok(near(b.top[2] + b.top[0], W), `${tag}: the top bar runs to the window's right edge`);
    assert.ok(near(b.top[1], 0), `${tag}: and starts at its top`);
    assert.ok(near(b.top[3], state.vars.local), `${tag}: the bar is the local navigation's row (${b.top[3]} vs ${state.vars.local})`);
    assert.deepEqual([b.status[0], b.status[2]].map(Math.round), [0, W], `${tag}: the status bar spans the window`);
    assert.ok(near(b.status[1] + b.status[3], H), `${tag}: and sits on its bottom edge`);
    assert.ok(near(b.status[3], state.contract.used.status) && near(state.contract.used.status, state.vars.status), `${tag}: the status bar's height is the contract's (${b.status[3]}, ${state.contract.used.status})`);
    assert.ok(near(state.contract.get.status, state.contract.used.status), `${tag}: asked and given are one`);
    const folded = Boolean(state.fold);
    for (const name of ["list", "inspector"]) {
      const one = state.info[name], box = b[name], used = state.contract.used[name];
      if (one.docked) {
        assert.ok(box, `${tag}: the docked ${name} is on screen`);
        assert.ok(near(box[2], used) && near(used, state.vars[name]), `${tag}: the ${name}'s real width ${box[2]} is what the contract gave (${used}, ${state.vars[name]})`);
        assert.ok(near(state.contract.get[name], used), `${tag}: and what was asked (${state.contract.get[name]} vs ${used})`);
        assert.ok(used >= (name === "list" ? 220 : 320) - 0.5 && used <= (name === "list" ? 420 : 640) + 0.5, `${tag}: within the limits`);
        assert.equal(state.columns[name], "docked", `${tag}: ${name} state`);
      } else {
        assert.ok(!box || one.drawerOpen, `${tag}: a ${name} that is not docked takes no room unless its drawer is open`);
        assert.equal(used, 0, `${tag}: and the contract has none for it`);
      }
    }
    if (b.list) { assert.ok(near(b.list[0], state.rest), `${tag}: the list starts where the rail ends (${b.list[0]} vs ${state.rest})`); assert.ok(near(b.list[1] + b.list[3], H - state.contract.used.status), `${tag}: and stops above the status bar`); }
    if (b.list && state.info.list.docked) assert.ok(near(b.top[0], b.list[0] + b.list[2]) || near(b.top[0], state.rest), `${tag}: the top bar starts where the list ends`);
    if (b.inspector && state.info.inspector.docked) { assert.ok(near(b.inspector[0] + b.inspector[2], W), `${tag}: the inspector is at the right edge`); assert.ok(near(b.inspector[1], state.vars.y0), `${tag}: under the bar (and the strip): ${b.inspector[1]} vs ${state.vars.y0}, bar ${JSON.stringify(b.top)}, vars ${JSON.stringify(state.vars)}`); }
    assert.ok(state.usable[0] >= (state.info.list.docked ? b.list[0] + b.list[2] : 0) - 1 && state.usable[2] <= W - (state.info.inspector.docked ? b.inspector[2] : 0) + 1 && near(state.usable[3], H - state.contract.used.status), `${tag}: usable() is clear of the columns and the status bar ${JSON.stringify(state.usable)}`);
    assert.ok(state.usable[1] >= b.top[3] - 1, `${tag}: and of the bar (${state.usable[1]} vs ${b.top[3]})`);
    // Nothing overlaps: columns beside the main area, bars above and below.
    const boxes = Object.entries({ list: b.list, inspector: b.inspector, status: b.status }).filter(([, box]) => box);
    for (const [one, first] of boxes) for (const [two, second] of boxes) if (one < two) assert.ok(first[0] + first[2] <= second[0] + 0.5 || second[0] + second[2] <= first[0] + 0.5 || first[1] + first[3] <= second[1] + 0.5 || second[1] + second[3] <= first[1] + 0.5, `${tag}: ${one} and ${two} overlap`);
    // The local navigation, where it is on screen, sits between the bar's two ends and never over a control of the bar.
    if (b.localNav) {
      const [left, right] = [b.localNav[0], b.localNav[0] + b.localNav[2]];
      assert.ok(left >= state.clusters.left[1] - 1 && right <= state.clusters.right[0] + 1, `${tag}: the local navigation ${left}-${right} stays between the bar's ends ${JSON.stringify(state.clusters)}`);
      assert.ok(b.localNav[2] >= 100, `${tag}: and is wide enough to use (${b.localNav[2]}): below that the bar keeps the row to itself`);
    } else if (state.narrow) assert.ok(b.top[2] < 640, `${tag}: only a band under 640 px gives the row up (${b.top[2]})`);
    // Vibe's own layer starts under the bar, not behind it.
    if (b.vibeLayer && mode === "vibe" && ["workspace", "vibe"].includes(state.route)) assert.ok(near(b.vibeLayer[1], b.top[1] + b.top[3], 1), `${tag}: Vibe's layer starts under the bar (${b.vibeLayer[1]} vs ${b.top[1] + b.top[3]})`);
    assert.deepEqual(state.overflow, [false, false], `${tag}: no page overflow (${JSON.stringify(state.scroll)} in ${JSON.stringify(state.inner)})`);
    assert.deepEqual(state.small, [], `${tag}: nothing under 12px`);
    assert.deepEqual(state.gutters, [], `${tag}: no scroller reserves width`);
    assert.deepEqual(state.outside, [], `${tag}: nothing of the frame leaves the window`);
    for (const [id, span, contained] of state.controls) if (id !== "shell-need" && id !== "shell-svc") { assert.ok(span, `${tag}: ${id} is on screen`); assert.ok(contained, `${tag}: ${id} is inside the top bar`); } else if (span) assert.ok(contained, `${tag}: ${id} is inside the top bar`);
    assert.deepEqual(state.mode_switch.map(([name, checked, shown]) => [name, checked, shown]), [["vibe", String(mode === "vibe"), true], ["build", String(mode === "build"), true]], `${tag}: the Vibe | Build switch`);
    // Splitters: a separator for each docked column, with the column's own numbers.
    for (const name of ["list", "inspector"]) {
      const split = state.splitters[name];
      if (state.info[name].docked) {
        assert.ok(split, `${tag}: the ${name} has a separator`);
        assert.equal(split.role, "separator");
        assert.equal(split.tabindex, "0");
        assert.ok(near(split.now, state.contract.used[name], 1) && split.min === (name === "list" ? 220 : 320) && split.max >= split.now - 0.5 && split.max <= (name === "list" ? 420 : 640), `${tag}: ${name} separator values ${JSON.stringify(split)}`);
        assert.equal(split.cursor, "col-resize");
        assert.equal(split.line, "1px", `${tag}: a 1px line`);
        assert.ok(near(split.box[2], 11, 0.5), `${tag}: and an 11px hit area`);
        // It sits on its column's edge, centred on it, and is a control of its own: nothing else of the frame is under it.
        const edge = name === "list" ? b.list[0] + b.list[2] : b.inspector[0];
        assert.ok(near(split.box[0] + split.box[2] / 2, edge, 1), `${tag}: the ${name} separator is on its column's edge (${split.box[0] + split.box[2] / 2} vs ${edge})`);
        assert.ok(split.box[1] <= 1 && near(split.box[1] + split.box[3], H - state.contract.used.status, 1) || name === "inspector", `${tag}: and runs the column's height`);
      } else assert.equal(split, null, `${tag}: no ${name} separator while it is not docked`);
    }
    // The rail's edge: on the rail's right edge, and clear of the bar's controls.
    if (state.splitters.rail) {
      const rail = state.splitters.rail;
      assert.ok(near(rail.box[0] + rail.box[2] / 2, state.rest, 1), `${tag}: the rail separator is on the rail's edge (${rail.box[0] + rail.box[2] / 2} vs ${state.rest})`);
    }
    if (folded) { assert.equal(state.fold, "list inspector", `${tag}: the contract's fold`); assert.ok(!state.info.list.docked && !state.info.inspector.docked, `${tag}: folded columns are drawers`); }
  };

  const reportFor = {};
  for (const size of SIZES) {
    if (only && !label(size).includes(only)) continue;
    await resize(size);
    for (const mode of MODES) for (const rail of RAILS) {
      const tag = `${label(size)}/${mode}/${rail}`;
      if (only && !tag.includes(only)) continue;
      await setup({ mode, rail });
      const state = await p();
      checkFrame(state, tag, { mode, rail });
      reportFor[tag] = { boxes: state.boxes, contract: state.contract, fold: state.fold };
      if (rail === "closed") await capture(`${label(size)}-${mode}.png`);
    }
  }
  report.configs = reportFor;

  // ============ 3. every destination can be opened and lands inside what the frame leaves ============
  const walk = async (size, rail) => {
    await resize(size);
    await setup({ mode: "build", rail });
    const at = `${label(size)}/${rail}`;
    const rows = await run(`
      const nav = window.MefiNav, tick = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const shown = (node) => Boolean(node && !node.hidden && !node.closest("[hidden]") && node.getClientRects().length);
      const round = (value) => Math.round(value * 10) / 10;
      const out = [];
      for (const record of nav.list().filter((item) => item.layer && item.element)) {
        nav.closeAll();
        await nav.go(record.id);
        let turn = 0;
        for (; turn < 90 && !shown(document.getElementById(record.element)); turn += 1) await tick();
        await tick(); await tick();
        const node = document.getElementById(record.element), up = shown(node), box = up ? node.getBoundingClientRect() : null, area = nav.usable();
        // A sheet or a transient layer may cover the rail and the bars, but never a docked column or the status bar.
        const column = (id) => { const one = document.getElementById(id); return shown(one) ? one.getBoundingClientRect() : null; };
        const list = column("shell-list"), inspector = column("shell-inspector");
        out.push({ id: record.id, layer: record.layer, page: Boolean(node && node.classList.contains("workspace-page")), up, box: box ? [round(box.left), round(box.top), round(box.right), round(box.bottom)] : null, area: [round(area.left), round(area.top), round(area.right), round(area.bottom)], between: [round(list ? list.right : 0), round(inspector ? inspector.left : innerWidth)], bar: Boolean(document.getElementById("shell-top")) && shown(document.getElementById("shell-top")), status: shown(document.getElementById("shell-status")) });
      }
      nav.closeAll();
      return out;
    `);
    assert.ok(rows.length >= 15, `${at}: the registry lists its destinations (${rows.length})`);
    const missed = rows.filter((row) => !row.up).map((row) => row.id);
    assert.deepEqual(missed, [], `${at}: every destination can be opened`);
    for (const row of rows) {
      const [left, top, right, bottom] = row.box, [ul, ut, ur, ub] = row.area, [cl, cr] = row.between;
      assert.ok(left >= cl - 1 && right <= cr + 1 && bottom <= ub + 1, `${at}: ${row.id} (${row.layer}) ${JSON.stringify(row.box)} stays between the columns ${JSON.stringify(row.between)} and above the status bar (${ub})`);
      if (row.page) assert.ok(left >= ul - 1 && right <= ur + 1 && top >= ut - 1, `${at}: the page ${row.id} sits inside what the frame leaves ${JSON.stringify(row.area)}, not ${JSON.stringify(row.box)}`);
      assert.ok(row.status, `${at}: the status bar stays with ${row.id} open`);
    }
    report.walks[at] = rows.map((row) => row.id);
  };
  if (!only || "walk".includes(only)) for (const [size, rail] of [[[1440, 900, 1], "closed"], [[1100, 720, 1], "pinned"], [[600, 560, 1.5], "closed"]]) await walk(size, rail);

  // ============ 4. the feed, the pills and the bars' data ============
  await resize([1440, 900, 1]);
  await setup({ mode: "build", rail: "closed" });
  {
    await until("document.getElementById('shell-need') && !document.getElementById('shell-need').hidden", "the need pill is painted");
    const text = await run("const at = (id) => document.getElementById(id)?.textContent.trim().replace(/\\s+/g, ' ') ?? null; return { need: at('shell-need'), svc: at('shell-svc'), working: document.querySelector('#shell-status [data-item=\"working\"]')?.textContent.trim(), waiting: document.querySelector('#shell-status [data-item=\"waiting\"]')?.textContent.trim(), permission: document.querySelector('#shell-status [data-item=\"permission\"]')?.textContent.trim(), trail: at('shell-top').includes('Shell fixture') };");
    assert.equal(text.need, "2 need you", "the digest's total");
    assert.equal(text.svc, "1 working");
    assert.equal(text.working, "1 working");
    assert.equal(text.waiting, "2 waiting on you");
    assert.equal(text.permission, "Auto", "the permission mode the page already reads");
    // The pause button is Home's own control.
    await run("window.shellFixture.calls(); window.__before = window.shellFixture.calls().length;");
    await click("shell-pause");
    const calls = await run("return window.shellFixture.calls().slice(window.__before).map((call) => call.name + ':' + JSON.stringify(call.args));");
    assert.ok(calls.some((call) => call.startsWith("backlogControl:") && call.includes('"pause"')), `the pill's pause is Home's: the same host call (${JSON.stringify(calls)})`);
    report.interactions.feed = text;
  }

  // ============ 4b. the keyboard reaches the bars, in order, and shows where it is ============
  {
    await run("document.getElementById('shell-list-toggle').focus();");
    const order = [];
    for (let step = 0; step < 16; step += 1) {
      // A separator draws its ring on a pseudo-element (a knob on its line); every other control uses an outline.
      const here = await run(`const node = document.activeElement; if (!node) return null; const style = getComputedStyle(node), knob = getComputedStyle(node, "::before"); return { id: node.id || node.getAttribute("data-ui-mode") || node.tagName, bar: Boolean(node.closest("#shell-top, #shell-status, .shell-split")), ring: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 1, shadow: knob.content !== "none" && knob.boxShadow !== "none" };`);
      if (here) order.push(here);
      await key("Tab");
    }
    const inBars = order.filter((one) => one.bar);
    assert.ok(inBars.length >= 8, `the bars' controls are reachable with Tab (${JSON.stringify(order.map((one) => one.id))})`);
    // The first stop was given focus by the script, which a keyboard ring is not shown for; every stop reached with Tab is.
    const plain = order.slice(1).filter((one) => one.bar && !one.ring && !one.shadow).map((one) => one.id);
    assert.deepEqual(plain, [], `every control of the bars shows a focus ring (${JSON.stringify(order)})`);
    const ids = order.map((one) => one.id);
    assert.ok(ids.indexOf("shell-list-toggle") < ids.indexOf("shell-search") && ids.indexOf("shell-search") < ids.indexOf("shell-inspector-toggle"), `the bar is walked left to right (${JSON.stringify(ids)})`);
    report.interactions.tab = ids;
  }

  // ============ 5. keys on the splitters, a real drag, the double-click, the saved widths ============
  {
    const widths = async () => { const state = await p(); return { list: state.boxes.list?.[2] ?? 0, inspector: state.boxes.inspector?.[2] ?? 0, saved: state.saved, used: state.contract.used, valueList: state.splitters.list?.now, valueInspector: state.splitters.inspector?.now }; };
    await run("document.getElementById('shell-split-list').focus();");
    let now = await widths();
    assert.deepEqual([now.list, now.inspector], [280, 388], "Build's preset");
    await key("ArrowRight"); now = await widths(); assert.equal(now.list, 288, "an arrow moves the edge 8 px");
    assert.equal(now.valueList, 288, "and the separator says so");
    await key("ArrowRight", { shift: true }); now = await widths(); assert.equal(now.list, 320, "Shift makes it 32");
    await key("ArrowLeft"); now = await widths(); assert.equal(now.list, 312);
    await key("Home"); now = await widths(); assert.equal(now.list, 220, "Home is the narrowest");
    await key("End"); now = await widths(); assert.equal(now.list, 420, "End is the widest");
    await key("Enter"); now = await widths(); assert.equal(now.list, 280, "Enter is the default");
    assert.equal(now.saved.build.list.w, 280, "saved, per mode");
    await run("document.getElementById('shell-split-inspector').focus();");
    await key("ArrowLeft"); now = await widths(); assert.equal(now.inspector, 396, "the inspector's edge is on its left: the left arrow widens it");
    await key("ArrowRight", { shift: true }); now = await widths(); assert.equal(now.inspector, 364);
    await key("End"); now = await widths(); assert.equal(now.inspector, 640);
    await key("Home"); now = await widths(); assert.equal(now.inspector, 320);
    await key("Enter"); now = await widths(); assert.equal(now.inspector, 388);
    assert.ok(Object.values(now.used).every((value) => Number.isFinite(value)), "the contract is asked for every change");
    await capture("keys-end.png");

    // A drag with the real pointer, pointer capture and all.
    await drag("shell-split-list", 60);
    now = await widths(); assert.ok(Math.abs(now.list - 340) <= 1, `a drag of 60 px: ${now.list}`);
    assert.ok(Math.abs(now.saved.build.list.w - 340) <= 1, "and the width is saved when it ends");
    assert.equal(await run("return document.getElementById('shell-frame').classList.contains('is-dragging');"), false, "the drag has let go of the cursor");
    await drag("shell-split-inspector", -50);
    now = await widths(); assert.ok(Math.abs(now.inspector - 438) <= 1, `dragging the inspector's edge left widens it: ${now.inspector}`);
    await drag("shell-split-list", 2000);
    now = await widths(); assert.equal(now.list, 420, "a drag past the limit stops at it");
    await drag("shell-split-list", -2000);
    now = await widths(); assert.equal(now.list, 220, "both ways");
    // A double-click puts each back.
    for (const name of ["list", "inspector"]) {
      const [x, y] = await centre(`shell-split-${name}`);
      for (const clicks of [1, 2]) { await pointer("mousePressed", x, y, { clickCount: clicks }); await pointer("mouseReleased", x, y, { clickCount: clicks }); await sleep(30); }
      await settle();
    }
    now = await widths(); assert.deepEqual([now.list, now.inspector], [280, 388], "a double-click resets both");
    // The preset of each mode is its own: make Build's unlike Vibe's, reload and see them come back.
    await run("document.getElementById('shell-split-list').focus();");
    await key("ArrowRight", { shift: true }); await key("ArrowRight", { shift: true });
    now = await widths(); assert.equal(now.list, 344);
    report.interactions.keys = now;
  }

  // ============ 6. Vibe and Build swap their layouts, in the same turn ============
  {
    const before = await p();
    const sameTurn = await run(`
      const radio = document.querySelector('#shell-top .mode-switch [data-ui-mode="vibe"]');
      radio.click();
      const used = window.MefiNav.layout.used();
      return { used, mode: window.MefiShell.mode(), ui: document.documentElement.dataset.uiMode ?? null, vibe: window.MefiVibe.mode() };
    `);
    assert.deepEqual([sameTurn.used.list, sameTurn.used.inspector, sameTurn.mode, sameTurn.ui, sameTurn.vibe], [0, 0, "vibe", "vibe", "vibe"], "the click has already given the room back: nothing is left for a later frame");
    await until("document.body.classList.contains('vibe-active')", "Vibe's Home");
    await settle();
    let state = await p();
    assert.equal(state.boxes.list, null); assert.equal(state.boxes.inspector, null);
    assert.equal(state.saved.build.list.w, 344, "Build's width is kept while Vibe has the window");
    assert.equal(state.saved.vibe.list.open, false);
    await capture("mode-vibe.png");
    // Ctrl B opens Vibe's own list at Vibe's own width; Build's is not touched.
    await key("KeyB", { ctrl: true });
    state = await p();
    assert.equal(state.boxes.list?.[2], 280, `Vibe's list opens at its own width (${JSON.stringify(state.boxes.list)})`);
    assert.equal(state.saved.vibe.list.open, true);
    assert.equal(state.saved.build.list.w, 344);
    // Ctrl M goes back to Build, where the list is as it was left.
    await key("KeyM", { ctrl: true });
    await until("document.body.classList.contains('workspace-active')", "Build's Home");
    await settle();
    state = await p();
    assert.equal(state.mode, "build");
    assert.deepEqual([state.boxes.list?.[2], state.boxes.inspector?.[2]], [344, 388], "Build is back as it was");
    await key("KeyM", { ctrl: true });
    await until("document.body.classList.contains('vibe-active')", "Vibe again");
    assert.equal((await p()).mode, "vibe");
    // The radiogroup's own click, from Vibe to Build.
    await run("document.querySelector('#shell-top .mode-switch [data-ui-mode=\"build\"]').click();");
    await until("document.body.classList.contains('workspace-active')", "Build's Home, by the switch");
    await settle();
    state = await p();
    assert.deepEqual([state.mode, state.boxes.list?.[2]], ["build", 344]);
    // A page other than Home keeps the page when the mode changes.
    await run("await window.MefiNav.go('tasks');"); await settle();
    await run("window.MefiShell.setMode('vibe');"); await settle();
    assert.equal(await run("return window.MefiNav.current();"), "tasks", "the page stays");
    state = await p();
    assert.equal(state.mode, "vibe");
    await run("window.MefiShell.setMode('build');"); await settle();
    report.interactions.mode = { before: before.saved, after: state.saved };
  }

  // ============ 7. what was saved comes back after a reload, and the window's size is reapplied ============
  {
    await load({ capture: "1", layout: "v2" });
    await run(`window.__shellProbe = ${probe.toString()};`);
    await until("window.MefiShell.active()", "the frame is built again");
    await setup({ mode: "build", rail: "closed" });
    let state = await p();
    assert.deepEqual([state.boxes.list?.[2], state.boxes.inspector?.[2]], [344, 388], "the saved widths are the launch's");
    // A window too narrow for the inspector beside the list gives it up and gets it back.
    await resize([1100, 720, 1]);
    state = await p();
    assert.equal(state.info.inspector.docked, true);
    assert.equal(state.boxes.inspector[2], 1100 - 64 - 344 - 320, "it shrinks to leave the main area its 320");
    await resize([1000, 720, 1]);
    state = await p();
    assert.equal(state.info.inspector.drawer, true, "and below its own minimum it is a drawer");
    assert.equal(state.contract.used.inspector, 0);
    assert.equal(state.saved.build.inspector.w, 388, "what was saved is not touched");
    await resize([1440, 900, 1]);
    state = await p();
    assert.deepEqual([state.boxes.list?.[2], state.boxes.inspector?.[2]], [344, 388], "the window grows and the widths are back");
  }

  // ============ 8. the Layout menu ============
  for (const size of SIZES) {
    if (only && !label(size).includes(only) && !"menu".includes(only)) continue;
    await resize(size);
    await setup({ mode: "build", rail: "closed" });
    await click("shell-layout-button");
    const menu = await run(`const node = document.getElementById("shell-menu"); if (!node) return null; const box = node.getBoundingClientRect(); const sizes = { menu: getComputedStyle(node).fontSize, hint: getComputedStyle(node.querySelector("small")).fontSize, bar: getComputedStyle(document.getElementById("shell-search")).fontSize, item: getComputedStyle(document.querySelector("#shell-status [data-item]")).fontSize }; const small = [...node.querySelectorAll("*")].filter((child) => child.getClientRects().length && [...child.childNodes].some((text) => text.nodeType === 3 && text.textContent.trim()) && parseFloat(getComputedStyle(child).fontSize) < 11.99).map((child) => child.className); return { box: [box.left, box.top, box.right, box.bottom], inner: [innerWidth, innerHeight], small, expanded: document.getElementById("shell-layout-button").getAttribute("aria-expanded"), focused: node.contains(document.activeElement), sizes };`);
    assert.ok(menu, `${label(size)}: the menu opens`);
    // The sizes the stylesheet intends (13 px for text, 12 px for the small print, at a text scale of 1): a variable that was never defined for an element would quietly fall back to the page's own.
    assert.deepEqual(menu.sizes, { menu: "13px", hint: "12px", bar: "13px", item: "12px" }, `${label(size)}: the bars and the menu are set in the frame's own sizes`);
    assert.ok(menu.box[0] >= -1 && menu.box[1] >= -1 && menu.box[2] <= menu.inner[0] + 1 && menu.box[3] <= menu.inner[1] + 1, `${label(size)}: the menu is inside the window ${JSON.stringify(menu)}`);
    assert.deepEqual(menu.small, [], `${label(size)}: no menu text under 12px`);
    assert.equal(menu.expanded, "true"); assert.equal(menu.focused, true, "focus moves into the menu");
    if (label(size) === "1440x900@1" || label(size) === "600x560@1.5") await capture(`menu-${label(size)}.png`);
    await key("Escape");
    const closed = await run("return [Boolean(document.getElementById('shell-menu')), document.activeElement?.id];");
    assert.deepEqual(closed, [false, "shell-layout-button"], `${label(size)}: Escape closes the menu and focus goes back to its button`);
  }
  {
    await resize([1440, 900, 1]);
    await setup({ mode: "build", rail: "closed" });
    await click("shell-layout-button");
    await run("document.querySelector('#shell-menu [role=\"switch\"][data-key=\"list\"]').click();"); await settle();
    let state = await p();
    assert.equal(state.boxes.list, null, "the menu's list switch closed the list");
    await run("document.querySelector('#shell-menu [role=\"switch\"][data-key=\"list\"]').click();"); await settle();
    assert.equal((await p()).boxes.list[2], 344, "and opens it at the width it had");
    await run("[...document.querySelectorAll('#shell-menu .shell-action')].find((node) => node.textContent.includes('Reset layout')).click();"); await settle();
    state = await p();
    assert.deepEqual([state.boxes.list[2], state.boxes.inspector[2]], [280, 388], "Reset layout puts Build's preset back");
    assert.equal(await run("return Boolean(document.getElementById('shell-menu'));"), false, "and closes the menu");
    // A press outside closes it.
    await click("shell-layout-button");
    await pointer("mouseMoved", 720, 400, { button: "none", buttons: 0 }); await pointer("mousePressed", 720, 400); await pointer("mouseReleased", 720, 400); await settle();
    assert.equal(await run("return Boolean(document.getElementById('shell-menu'));"), false, "a press outside closes the menu");
  }

  // ============ 9. drawers: in a small window a column is a drawer that stays inside it ============
  for (const [size, mode] of [[[600, 560, 1.5], "build"], [[600, 560, 1], "build"], [[600, 560, 1.5], "vibe"]]) {
    if (only && !label(size).includes(only) && !"drawer".includes(only)) continue;
    await resize(size);
    await setup({ mode, rail: "closed" });
    const tag = `${label(size)}/${mode}`;
    let state = await p();
    assert.equal(state.fold, "list inspector", `${tag}: the contract folds both`);
    assert.ok(!state.boxes.list && !state.boxes.inspector, `${tag}: no column takes room`);
    const usableBefore = state.usable;
    for (const name of ["list", "inspector"]) {
      const toggle = `shell-${name}-toggle`;
      await run(`document.getElementById(${JSON.stringify(toggle)}).focus();`);
      await run(`document.getElementById(${JSON.stringify(toggle)}).click();`); await settle();
      state = await p();
      const box = state.boxes[name];
      assert.ok(box, `${tag}: the ${name} drawer opens`);
      assert.equal(state.drawerAttr, name, `${tag}: one drawer`);
      assert.deepEqual(state.outside, [], `${tag}: the ${name} drawer and the bars stay in the window`);
      assert.ok(box[1] >= state.boxes.top[1] + state.boxes.top[3] - 1, `${tag}: the ${name} drawer is under the bar`);
      assert.ok(box[1] + box[3] <= state.boxes.status[1] + 1, `${tag}: and above the status bar`);
      assert.ok(box[2] <= state.inner[0] - (name === "list" ? state.rest : 0) + 0.5, `${tag}: and no wider than the room`);
      assert.ok(state.boxes.scrim, `${tag}: the page is dimmed under it`);
      assert.equal(name === "list" ? state.inList : state.inInspector, true, `${tag}: focus moves into the drawer`);
      assert.deepEqual(state.usable, usableBefore, `${tag}: a drawer takes no room from the page`);
      assert.ok(state.boxes.status && state.boxes.top, `${tag}: the bar and the status bar stay rows`);
      // The bar stays in reach while a drawer is open: the scrim dims the page, not the controls that close the drawer.
      await centre(toggle); await centre("shell-search");
      // Opaque: a colour with an alpha of 1, written as rgb(), rgba() or color(... / alpha), and no backdrop showing through.
      const fill = await run(`const style = getComputedStyle(document.getElementById("shell-${name}")); const color = style.backgroundColor; const alpha = /\\/\\s*([\\d.]+%?)\\s*\\)$/.exec(color) || /^rgba\\(.*,\\s*([\\d.]+)\\)$/.exec(color); return { color, alpha: alpha ? (alpha[1].endsWith("%") ? parseFloat(alpha[1]) / 100 : parseFloat(alpha[1])) : color === "transparent" ? 0 : 1, image: style.backgroundImage };`);
      assert.ok(fill.alpha >= 0.99 && fill.image === "none", `${tag}: the ${name} drawer is opaque, the page must not show through it (${JSON.stringify(fill)})`);
      if (size[2] === 1.5 && mode === "build") await capture(`drawer-${name}.png`);
      await key("Escape");
      state = await p();
      assert.equal(state.drawerAttr, "", `${tag}: Escape closes the ${name} drawer`);
      assert.equal(state.focus, toggle, `${tag}: and focus goes back to its button`);
      await run(`document.getElementById(${JSON.stringify(toggle)}).click();`); await settle();
      assert.equal((await p()).drawerAttr, name);
      // A press on the page outside the drawer closes it (the scrim).
      const [x, y] = name === "list" ? [state.inner[0] - 10, state.inner[1] / 2] : [10, state.inner[1] / 2];
      await run(`window.__press = (x, y) => { const target = document.elementFromPoint(x, y); target?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); return target ? (target.id || target.className) : null; }; return window.__press(${x}, ${y});`);
      await settle();
      assert.equal((await p()).drawerAttr, "", `${tag}: a press outside closes the ${name} drawer`);
    }
  }
  // The tab strip and the status bar are rows in every window, however small.
  {
    const state = await p();
    assert.ok(state.boxes.status && state.boxes.status[2] >= state.inner[0] - 1, "the status bar spans the smallest window");
  }

  // ============ 10. the way in, and turning v2 off and on again ============
  {
    await resize([1440, 900, 1]);
    await setup({ mode: "build", rail: "closed" });
    assert.equal(await run("return document.getElementById('settings-layout-v2').checked;"), true, "the switch says v2 is on");
    await run("window.MefiNav.get('layout-switch').run();");
    await sleep(120);
    const live = await run(`return { frame: Boolean(document.getElementById('shell-frame')), attr: document.documentElement.dataset.frame ?? null, layout: document.documentElement.dataset.layout ?? null, saved: localStorage.getItem('mefiStudio.layout'), inline: ['--shell-list-w', '--shell-inspector-w', '--shell-tabs-h', '--shell-status-h', '--frame-top-l', '--frame-top-r'].filter((name) => document.documentElement.style.getPropertyValue(name)), active: window.MefiShell.active(), usable: window.MefiNav.usable() };`);
    assert.deepEqual([live.frame, live.attr, live.layout, live.saved, live.inline, live.active], [false, null, null, "v1", [], false], `the action saves classic and takes the frame away at once: ${JSON.stringify(live)}`);
    // The window reloads by itself a moment later; the launch's own ?layout=v2 wins, so the frame is back, built once.
    await until("window.MefiNav && window.MefiShell && window.MefiShell.active() && !window.MefiBoot?.isActive?.()", "the window reloaded into v2", 20000);
    await run(`window.__shellProbe = ${probe.toString()};`);
    assert.equal(await run("return document.querySelectorAll('#shell-frame').length;"), 1);
    assert.equal(await run("return localStorage.getItem('mefiStudio.layout');"), "v1", "the choice made in the window outlived the reload");
    // Off and on again through the module: one frame, the same pages.
    await setup({ mode: "build", rail: "closed" });
    await run("window.MefiShell.disable();"); await settle();
    assert.equal(await run("return document.querySelectorAll('#shell-frame').length + (document.documentElement.dataset.frame ? 1 : 0);"), 0, "disable takes everything away");
    await run("window.MefiShell.enable(); window.MefiShell.enable();"); await settle();
    assert.equal(await run("return document.querySelectorAll('#shell-frame').length;"), 1, "enable, twice, builds one");
    const state = await p();
    checkFrame(state, "after enable", { mode: "build", rail: "closed" });
  }

  assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
  report.complete = true;
  finish();
}).catch(finish);
