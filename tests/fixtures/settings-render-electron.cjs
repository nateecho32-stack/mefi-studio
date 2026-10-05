"use strict";

// Settings in the 0.5 layout, in a real Chromium: a copied booklet launched with ?layout=v2 and a synthetic
// bridge. renderer/booklet.js files Settings into the 0.5 prototype's places (docs/prototype/mefi-studio-0.5-v5.html,
// SET_SUBS); this opens each one from its row with a real pointer, at 1920x1080 and at the layout contract's small
// sizes, and measures what a DOM test cannot: the list of places in the prototype's order with its group headings,
// one page at a time with its title and Find a setting at its right, nothing wider than the page, no scroller that
// reserves width for a bar, no text under 12 px, and every line of text at 4.5:1 or more against what is behind it,
// in every theme. Deep links and Search land on the place that now holds the control; Size and density opens its
// own page. A second launch without ?layout=v2 shows Settings as it was. Screenshots are kept when the test is
// given a capture folder (MEFI_SETTINGS_CAPTURE_DIR). No application main process or live state is loaded;
// network, permissions and child processes are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_SETTINGS_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Settings fixture directory is required");
const studio = path.resolve(__dirname, "..", "..");
const report = { errors: [], networkAttempts: [], processAttempts: [], places: [], small: [], contrast: [], shots: [], steps: [], complete: false };
app.setName("Settings Fixture");
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

// The prototype's places, in its order, under its headings. Design system has no counterpart yet.
const PLACES = [
  [null, "General"], [null, "Notifications"], [null, "Appearance"], [null, "Size and density"], [null, "Map look"], [null, "Sound and music"],
  ["Updates and help", "Updates"], ["Updates and help", "Report a problem"], ["Advanced", "System"],
];
const PAGES = [["general", "General"], ["notifications", "Notifications"], ["appearance", "Appearance"], ["looks", "Map look"], ["audio", "Sound and music"], ["updates", "Updates"], ["problem", "Report a problem"], ["system", "System"]];
const THEMES = ["chrome", "aurora", "gold", "midnight", "forest", "violet", "ember", "rose", "void", "eclipse", "abyss", "dusk", "custom"];

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
  const now = Date.now(), projectId = "settings-project";
  const task = { id: "settings-task", projectId, title: "Pin favourite notes", prompt: "Let me pin notes to the top of the list", status: "open", createdAt: now - 60000, updatedAt: now };
  const routing = { provider: "zen", roleProviders: {}, models: { routine: "gpt-6-luna", heavy: "gpt-6-sol" }, providerModels: {}, hasZen: true, hasOpenCode: false, hasZai: false, hasOpenRouter: false, hasCustom: false, autoProviders: ["zen", "codex"], autoFallback: true, modelSelection: "fixed", executorCli: "codex", executorModels: {}, executorTierModels: {}, executorTier: "auto", subscriptionFirst: true, lmStudioEndpoint: "http://127.0.0.1:1234/v1", customEndpoint: "", executorTierDefaults: {}, autoSetup: null };
  const configuration = { aiProvider: "zen", aiModels: routing.models, executorCli: "codex", agentBrain: { contextScout: true, deskTool: false, headDrafts: false, nestedDelegation: false } };
  const manifest = JSON.stringify({ studio: "0.4.5", install: "source", windows: "11 (26200)", project: "Notes app", tasks: { running: 0, needsYou: 0 } }, null, 2);
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Notes app", path: root }] },
    tasksList: { ok: true, projectId, tasks: [task] }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: false, useReference: true, useTree: true, useWeb: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: {}, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, autoBuild: true, mode: "swarm", minutes: 5, parallel: 2, running: [], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, counts: { ready: 1, running: 0, blocked: 0, review: 0 }, taskStates: [], next: [] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getApiKey: { saved: false }, getAiRouting: routing, cliStatus: [], launchStudio: { ok: true }, jevStatus: { ok: true, enabled: false, route: "zen", routes: { vercel: false, typesafe: false, zen: true, openrouter: false } }, openrouterModels: { ok: true, models: [] }, agentModels: { ok: true, models: [] },
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [], skills: [], mcpTools: [], routing, seats: {}, choices: {}, efforts: ["minimal", "low", "medium", "high", "xhigh", "max"] },
    cliSetupStatus: { ok: true, selected: "auto", clis: [] }, firstRunStatus: { ok: true, firstRun: null },
    machineGet: { ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } }, updateStatus: { ok: true, status: { auto: true } },
    companionState: { ok: true, projectId, projectName: "Notes app", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: false, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
    brainState: { ok: true, tasks: [], recent: [], pipelines: {} }, brainPlaybook: { ok: true, shelf: [], recipes: [] }, brainMap: { ok: true, map: { systems: [], edges: [], files: [] } },
    worktreesList: { ok: true, repo: false, projectId, enabled: { on: false, forced: false } }, skillsList: { ok: true, skills: [], roots: [] },
    // Notifications and Report a problem, as their hosts answer (scripts/alerts-host.cjs, scripts/report-host.cjs).
    alertsGet: { ok: true, supported: true, killed: false, prefs: { on: true, need: true, fail: true, done: false, flash: true, badge: true, sound: false, titles: "generic" }, quiet: { on: false, from: "22:00", to: "07:00" } },
    reportPreview: { ok: true, token: "fixture-token", replaceTitles: false, crash: null, prompt: true, killed: false, total: 150528,
      files: [{ name: "manifest.json", about: "Studio version, install kind, the model and builder in use", bytes: 1229, text: manifest }, { name: "tasks-summary.json", about: "One line per task: state, builder and checks", bytes: 3891, text: "{ \"task\": \"Pin favourite notes\", \"state\": \"open\" }" }, { name: "trace-tail.log", about: "The last 1,000 trace rows, with paths and keys removed", bytes: 47104, text: "17:43:12  tasks  claim  task/pin" }, { name: "builders.log", about: "Recent builder output, redacted the same way", bytes: 94208, text: "[builder-2] read src/notes/store.ts" }],
      never: [{ name: "settings.json", why: "Holds your project paths" }, { name: "auth.json and community-auth.json", why: "Hold a Discord ID and a PIN hash" }, { name: "The vault", why: "Holds keys and sign-ins" }, { name: "Screenshots and evidence", why: "They can show secrets on screen" }] },
  };
  const names = await bridgeNames();
  const preload = path.join(root, "settings-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const names=${JSON.stringify(names)};const calls=[];const subscribers={};
    const bridge={};
    for(const name of names){
      if(/^on[A-Z]/.test(name))bridge[name]=callback=>{(subscribers[name]??=[]).push(callback);return()=>{};};
      else bridge[name]=async(...args)=>{calls.push(name);return name in responses?JSON.parse(JSON.stringify(responses[name])):{ok:true};};
    }
    bridge.alertsSet=async(patch)=>{calls.push('alertsSet');const view=responses.alertsGet;if(patch&&'quiet' in patch)view.quiet={...view.quiet,...patch.quiet};else Object.assign(view.prefs,patch||{});return JSON.parse(JSON.stringify(view));};
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('settingsFixture',{calls:()=>calls.slice(),clear:()=>{calls.length=0;}});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));localStorage.setItem('mefiStudio.whatsNew.seen','vibe-build-1');localStorage.setItem('mefiStudio.setupHelper.seen','setup-helper-1');
  `);
  const window = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, frame: false, enableLargerThanScreen: true, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, what, ms = 15000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "settings-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${what}`);
  };
  const capture = async (name) => {
    await run("for (const notice of document.querySelectorAll('#toast-host .toast')) notice.remove(); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(200);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
    report.shots.push(name);
  };
  const resize = async (width, height, zoom = 1) => {
    window.setContentSize(width, height); contents.setZoomFactor(zoom);
    const wanted = Math.round(width / zoom);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { if (Math.abs(await run("return innerWidth;") - wanted) <= 1) break; await sleep(60); }
    await sleep(300);
  };
  // A real pointer click in the middle of a control, after scrolling it into view.
  const click = async (selector) => {
    await run(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center", behavior: "instant" }); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));`);
    const box = await run(`const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, reached: Boolean(hit) && (hit === node || node.contains(hit)), on: hit ? (hit.id || hit.className || hit.tagName) : null };`);
    assert.ok(box && box.w > 0, `${selector} is on screen`);
    assert.equal(box.reached, true, `a pointer reaches ${selector} (${box.on} is on top)`);
    const zoom = contents.getZoomFactor(), point = { x: Math.round(box.x * zoom), y: Math.round(box.y * zoom) };
    contents.sendInputEvent({ type: "mouseMove", ...point }); contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point }); contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
    await sleep(250);
  };

  // What the page is right now, in real pixels: the list, the page, what overflows, small text, and contrast.
  const measure = `
    const tab = document.getElementById('tab-studio');
    const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
    const shown = (node) => { if (!node.getClientRects().length) return false; for (let n = node; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
    const own = (node) => [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
    // Colours as Chromium reports them: rgb(), rgba() or color(srgb r g b / a).
    const rgba = (value) => { let m = /^rgba?\\(([^)]+)\\)/.exec(value); if (m) { const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; } m = /^color\\(srgb ([^)]+)\\)/.exec(value); if (m) { const p = m[1].split(/[\\s\\/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; } return null; };
    const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const base = rgba(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().replace(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i, (_, r, g, b) => 'rgb(' + parseInt(r, 16) + ',' + parseInt(g, 16) + ',' + parseInt(b, 16) + ')')) || [5, 13, 19, 1];
    // What a layer paints: its background colour, with a gradient counted as the mean of its stops.
    const paint = (node) => { const s = getComputedStyle(node); let c = rgba(s.backgroundColor); const stops = s.backgroundImage === 'none' ? [] : [...s.backgroundImage.matchAll(/rgba?\\([^)]+\\)|color\\(srgb[^)]+\\)/g)].map((m) => rgba(m[0])).filter(Boolean); if (stops.length) { const mean = stops.reduce((a, x) => [a[0] + x[0], a[1] + x[1], a[2] + x[2], a[3] + x[3]], [0, 0, 0, 0]).map((v) => v / stops.length); c = c && c[3] > 0 ? over(mean, c) : mean; } return c && c[3] > 0 ? c : null; };
    // What is behind a line of text: everything painted under it at that point (a sibling drawn behind it, like a switch's
    // thumb, included), composited over the theme's background; off screen, its ancestors.
    const behind = (node) => { const r = node.getClientRects()[0]; let under = null; if (r && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth) { const stack = document.elementsFromPoint(r.left + Math.min(r.width / 2, 10), r.top + r.height / 2); const at = stack.indexOf(node); if (at >= 0) under = stack.slice(at); } if (!under) { under = []; for (let n = node; n; n = n.parentElement) under.push(n); } let color = base; for (const layer of under.reverse()) { const c = paint(layer); if (c) color = over(c, color); } return color; };
    const dimmed = (node) => { for (let n = node; n && n !== document.documentElement; n = n.parentElement) { if (parseFloat(getComputedStyle(n).opacity) < 0.95 || n.disabled || n.getAttribute?.('aria-disabled') === 'true') return true; } return false; };
    const all = [...tab.querySelectorAll('*')].filter(shown);
    // Text a person reads: decorative marks (aria-hidden, or drawn with a zero font size) are not.
    const text = all.filter((node) => own(node) && !node.closest('[aria-hidden="true"]') && parseFloat(getComputedStyle(node).fontSize) > 0);
    const small = text.filter((node) => parseFloat(getComputedStyle(node).fontSize) < 11.95).map((node) => (node.id || String(node.className).slice(0, 40) || node.tagName) + ':' + getComputedStyle(node).fontSize + ':' + node.textContent.trim().slice(0, 30));
    const low = text.filter((node) => !dimmed(node)).map((node) => { const ink = rgba(getComputedStyle(node).color); if (!ink) return null; const under = behind(node); const r = ratio(over(ink, under), under); return r < 4.5 ? { what: (node.id || String(node.className).slice(0, 40) || node.tagName) + ':' + node.textContent.trim().slice(0, 30), ratio: Math.round(r * 100) / 100 } : null; }).filter(Boolean);
    const scrollers = all.filter((node) => /(auto|scroll)/.test(getComputedStyle(node).overflowY + getComputedStyle(node).overflowX)).map((node) => ({ name: node.id || String(node.className).slice(0, 40), gutter: node.offsetWidth - node.clientWidth - parseFloat(getComputedStyle(node).borderLeftWidth) - parseFloat(getComputedStyle(node).borderRightWidth) })).filter((row) => row.gutter > 0.5);
    const sections = document.getElementById('settings-sections'), sectionsBox = sections.getBoundingClientRect();
    const wide = all.filter((node) => node.closest('#settings-sections') && !node.closest('.report-pre, .log, .music-themes, [data-appearance-panel]') && node.getBoundingClientRect().right > sectionsBox.right + 1.5).slice(0, 6).map((node) => (node.id || String(node.className).slice(0, 40) || node.tagName) + ' ' + Math.round(node.getBoundingClientRect().right) + '>' + Math.round(sectionsBox.right));
    const pane = [...document.querySelectorAll('[data-settings-category-pane]')].find((node) => !node.hidden);
    const rows = [...document.querySelectorAll('#settings-nav-list .settings-nav-group')].flatMap((group) => [...group.querySelectorAll('.settings-nav-item')].map((row) => [group.querySelector('.settings-nav-heading')?.textContent ?? null, row.querySelector('.label')?.textContent ?? '']));
    return {
      inner: { w: innerWidth, h: innerHeight }, place: tab.dataset.settingsPlace || null, places: tab.dataset.places || null, rows,
      current: [...document.querySelectorAll('#settings-nav [aria-current="true"]')].map((row) => row.querySelector('.label')?.textContent),
      pane: pane?.dataset.settingsCategoryPane ?? null, title: pane?.querySelector('.settings-category-head h2')?.textContent ?? null,
      head: box(pane?.querySelector('.settings-category-head h2')), find: box(document.querySelector('.settings-find')), sections: box(sections), nav: box(document.getElementById('settings-nav')),
      panes: [...document.querySelectorAll('[data-settings-category-pane]')].filter((node) => !node.hidden).length,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      // A switch row reads as the prototype's: its words on the left, its track on the right.
      switches: [...tab.querySelectorAll(':is(.settings-you-switches, #settings-audio-controls, #settings-tree-controls, #settings-appearance-controls) > label.switch')].filter(shown).filter((label) => !label.closest('[data-appearance-panel]')).map((label) => { const track = label.querySelector('.track')?.getBoundingClientRect(); const words = [...label.children].find((child) => child.tagName === 'SPAN' && !child.classList.contains('track'))?.getBoundingClientRect(); return track && words ? { what: label.textContent.trim().slice(0, 40), ok: track.left >= words.right - 1 } : null; }).filter(Boolean),
      small, low, scrollers, wide, appearance: document.body.classList.contains('appearance-settings-active'),
      looks: [...document.querySelectorAll('#appearance-sections [data-appearance-section]')].filter(shown).map((node) => node.dataset.appearanceSection),
    };`;
  // What is wrong with a page, as a list: every page is measured and shot before the first problem fails the run.
  const problems = (m, tag, { contrast = true } = {}) => [
    ...(m.pageOverflow ? [`${tag}: the page overflows the window`] : []),
    ...m.scrollers.map((row) => `${tag}: ${row.name} reserves ${row.gutter} px for a bar`),
    ...m.small.map((line) => `${tag}: text under 12 px: ${line}`),
    ...m.wide.map((line) => `${tag}: past the page's right edge: ${line}`),
    ...(contrast ? m.low.map((row) => `${tag}: ${row.what} reads at ${row.ratio}:1`) : []),
    ...(m.appearance ? [] : m.switches.filter((row) => !row.ok).map((row) => `${tag}: the switch for ${row.what} is not on the right of its words`)),
  ];
  const assertPage = (m, tag, options) => assert.deepEqual(problems(m, tag, options), [], `${tag}: fits, no text under 12 px, 4.5:1`);
  const found = [];

  // ---- v1: Settings as it was ----------------------------------------------------------------------
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await until("window.MefiNav && window.MefiBooklet && !window.MefiBoot?.isActive?.()", "studio ready (v1)");
  await run("window.MefiNav.go('studio');");
  await until("document.getElementById('tab-studio')?.hidden === false", "Settings is up (v1)");
  report.v1 = await run(`return {
    layout: document.documentElement.dataset.layout || null, places: document.getElementById('tab-studio').dataset.places || null,
    rows: [...document.querySelectorAll('#settings-nav [data-settings-category]')].map((row) => row.dataset.settingsCategory),
    panes: [...document.querySelectorAll('[data-settings-category-pane]')].map((node) => node.dataset.settingsCategoryPane),
    notificationsIn: document.getElementById('settings-notifications')?.closest('[data-settings-category-pane]')?.dataset.settingsCategoryPane ?? null,
    updatesIn: document.getElementById('settings-updates')?.closest('[data-settings-category-pane]')?.dataset.settingsCategoryPane ?? null,
    reportIn: document.getElementById('settings-report')?.closest('[data-settings-category-pane]')?.dataset.settingsCategoryPane ?? null,
    findIn: document.querySelector('.settings-find')?.parentElement?.id ?? null, model: window.MefiBooklet.settingsPlaces(),
    placeOnly: [...document.querySelectorAll('.settings-place-only')].filter((node) => node.getClientRects().length).length,
  };`);
  assert.deepEqual(report.v1, { layout: null, places: null, rows: ["general", "appearance", "audio", "system"], panes: ["general", "appearance", "audio", "system"], notificationsIn: "general", updatesIn: "system", reportIn: "system", findIn: "settings-nav", model: null, placeOnly: 0 }, "with the layout off Settings keeps its four categories and every card where it was");
  report.steps.push("v1 is untouched");

  // ---- v2 ------------------------------------------------------------------------------------------
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1", layout: "v2" } });
  await until("window.MefiNav && window.MefiBooklet && window.MefiShell && window.MefiShell.active() && !window.MefiBoot?.isActive?.()", "studio ready (v2)");
  assert.equal(await run("return document.documentElement.dataset.layout;"), "v2");
  await run("window.MefiVibe?.setMode?.('build', { go: false }); window.MefiNav.setRailPinned?.(false, { save: false });");
  await resize(1920, 1080);
  await run("window.MefiNav.go('studio');");
  await until("document.getElementById('tab-studio')?.hidden === false && document.getElementById('tab-studio').dataset.places === 'v2'", "Settings is up, in its places");
  await sleep(500);
  const first = await run(measure);
  assert.deepEqual(first.rows, PLACES, "the places are the prototype's, in its order, under its headings");
  assert.equal(first.place, "general", "Settings opens on General");
  report.model = await run("return window.MefiBooklet.settingsPlaces();");
  assert.deepEqual(report.model.map((row) => [row.id, row.group, row.sub, row.route]), [["general", null, false, null], ["notifications", null, false, null], ["appearance", null, false, null], ["size", null, true, "size"], ["looks", null, false, null], ["audio", null, false, null], ["updates", "Updates and help", false, null], ["problem", "Updates and help", false, null], ["system", "Advanced", false, null]], "the places, as data, for a list drawn elsewhere");
  for (const [id, title] of PAGES) {
    await click(`#settings-nav [data-settings-category="${id}"]`);
    await until(`document.getElementById('tab-studio').dataset.settingsPlace === ${JSON.stringify(id)}`, `${title} is the place`);
    if (id === "notifications") await until("window.settingsFixture.calls().includes('alertsGet') && document.getElementById('alerts-on').checked", "Notifications read their settings when shown");
    if (id === "problem") await until("document.querySelectorAll('#report-files .report-file').length === 4", "the report is built when its page shows");
    await sleep(700);
    const m = await run(measure);
    m.id = id; report.places.push(m);
    assert.deepEqual(m.current, [title], `${title}: its row is the current one`);
    assert.equal(m.title, title, `${title}: the page says where you are`);
    assert.equal(m.panes, 1, `${title}: one page at a time`);
    if (!m.appearance) {
      assert.ok(m.find && m.head && m.find.r >= m.sections.r - 2 && m.find.y <= m.head.y + 6 && m.find.x > m.head.x + 200, `${title}: Find a setting sits at the right of the title ${JSON.stringify({ find: m.find, head: m.head, sections: m.sections })}`);
      assert.ok(m.sections.x >= m.nav.r, `${title}: the page is beside the list`);
    }
    if (id === "appearance") assert.deepEqual(m.looks, ["themes", "interface"], "Appearance shows Theme and Interface");
    if (id === "looks") assert.deepEqual(m.looks, ["nodes", "layout"], "Map look shows Nodes and Layout");
    await capture(`settings-${id}-1920x1080.png`);
    found.push(...problems(m, `${title} at 1920x1080`));
  }
  assert.deepEqual(found, [], "every page fits, has no text under 12 px and reads at 4.5:1");
  assert.ok(report.places.find((row) => row.id === "general").switches.length >= 6 && report.places.find((row) => row.id === "audio").switches.length >= 1, "the switch rows were measured");
  // Notifications: the card is the page, its four groups are panels in two columns.
  await click('#settings-nav [data-settings-category="notifications"]');
  await sleep(400);
  report.notifications = await run(`const box = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; };
    return { open: document.getElementById('settings-notifications').open, summary: getComputedStyle(document.querySelector('#settings-notifications > summary')).display, rows: box('alerts-group-background'), quiet: box('alerts-group-quiet'), words: box('alerts-group-words'), test: box('alerts-group-try'), heading: getComputedStyle(document.querySelector('#alerts-group-background .settings-place-only')).display };`);
  assert.equal(report.notifications.open, true); assert.equal(report.notifications.summary, "none", "the card's own title steps aside: the page has it");
  assert.equal(report.notifications.heading, "block", "When Studio is in the background heads its panel");
  assert.ok(report.notifications.words.x > report.notifications.rows.x + report.notifications.rows.w - 2 && Math.abs(report.notifications.words.y - report.notifications.rows.y) < 2, "what a notification says sits beside the switches");
  assert.ok(report.notifications.quiet.y > report.notifications.rows.y && report.notifications.test.y > report.notifications.words.y, "quiet hours under the switches, Try it under the sample");
  // Size and density is its own page.
  await click('#settings-nav [data-nav="size"]');
  await until("window.MefiSize?.isOpen?.()", "Size and density opens from its row");
  await capture("settings-size-1920x1080.png");
  await run("window.MefiNav.closeAll(); await new Promise((resolve) => setTimeout(resolve, 200)); window.MefiNav.go('studio');");
  await until("document.getElementById('tab-studio')?.hidden === false && !window.MefiSize.isOpen()", "back to Settings");
  // Find a setting: results under the title row, and Enter lands on the place that holds it.
  await run("const find = document.getElementById('settings-find'); find.focus(); find.value = 'stay quiet'; find.dispatchEvent(new Event('input', { bubbles: true }));");
  await until("document.querySelectorAll('.settings-search-result').length > 0", "Search finds Stay quiet at night");
  report.search = await run(`return [...document.querySelectorAll('.settings-search-result')].map((row) => row.textContent);`);
  assert.ok(report.search.some((line) => line.includes("Settings / Notifications") && line.includes("Stay quiet at night")), `a match says where it lives now: ${JSON.stringify(report.search)}`);
  const searching = await run(measure);
  assertPage(searching, "Search results");
  await capture("settings-search-1920x1080.png");
  await run("document.getElementById('settings-find').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));");
  await until("document.getElementById('tab-studio').dataset.settingsPlace === 'notifications'", "Enter lands on Notifications");
  // Deep links land on the place that holds the control now.
  for (const [section, place] of [["settings-updates", "updates"], ["release-check", "updates"], ["settings-report", "problem"], ["report-replace", "problem"], ["alerts-quiet", "notifications"], ["settings-community", "general"], ["music-node-heading", "looks"], ["settings-diagnostics", "system"], ["audio", "audio"], ["appearance", "appearance"], ["looks", "looks"]]) {
    await run(`window.MefiNav.go('studio', { section: ${JSON.stringify(section)} });`);
    await until(`document.getElementById('tab-studio').dataset.settingsPlace === ${JSON.stringify(place)}`, `${section} lands on ${place}`);
  }
  report.steps.push("deep links land");
  // The layout contract's other sizes: the page still fits, nothing is small.
  for (const [width, height, zoom] of [[1440, 900, 1], [1100, 720, 1], [600, 560, 1.5]]) {
    await resize(width, height, zoom);
    for (const id of ["general", "notifications", "problem"]) {
      await run(`window.MefiNav.go('studio', { section: ${JSON.stringify(id)} });`);
      await until(`document.getElementById('tab-studio').dataset.settingsPlace === ${JSON.stringify(id)}`, `${id} at ${width}x${height}@${zoom}`);
      await sleep(400);
      const m = await run(measure);
      assertPage(m, `${id} at ${width}x${height}@${zoom}`, { contrast: false });
      if (id === "notifications") await capture(`settings-${id}-${width}x${height}@${zoom}.png`);
    }
  }
  await resize(1920, 1080);
  // Every theme: the text on the plain pages reads at 4.5:1 or more.
  for (const theme of THEMES) {
    await run(`window.MefiMusic.applyTheme(${JSON.stringify(theme)}, false);`);
    await sleep(150);
    for (const id of ["general", "notifications", "updates", "problem", "system"]) {
      await run(`window.MefiNav.go('studio', { section: ${JSON.stringify(id)} });`);
      await until(`document.getElementById('tab-studio').dataset.settingsPlace === ${JSON.stringify(id)}`, `${id} in ${theme}`);
      await sleep(120);
      const m = await run(measure);
      if (m.low.length) report.contrast.push({ theme, id, low: m.low });
    }
  }
  assert.deepEqual(report.contrast, [], "every theme keeps every line of Settings at 4.5:1 or more");
  await run("window.MefiMusic.applyTheme('chrome', false);");
  report.complete = true;
  finish();
}).catch(finish);
