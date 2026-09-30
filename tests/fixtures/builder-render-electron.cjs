"use strict";

// Build's Home as a coding-agent desktop (renderer/builder.js), in a real
// Chromium: a copied booklet, the sessions layout switched on the way a person
// switches it (the saved mefiStudio.homeLayout), and a synthetic bridge that
// answers with a board of tasks in every stage and a worktree list that names
// two of them. It checks what the DOM tests cannot: the menu's task rows are on
// screen and fit, a task whose run has its own worktree wears the branch mark
// where a person can see it, the greeting card and the composer fit five window
// sizes without a page scrollbar, the composer's bottom row stays on one line
// at desktop widths, no scroller reserves width for a bar, nothing is under
// 12 px, and opening a task shows its session. Screenshots are kept when the
// test is given a capture folder. No application main process or live state is
// loaded; network, permissions and child processes are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_BUILDER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Builder fixture directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], calls: [] };
app.setName("Builder Fixture");
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

const projectId = "project_fixture";
const now = Date.now();
const hours = (count) => now - count * 3600 * 1000;
const task = (id, title, extra = {}) => ({ id, projectId, title, prompt: `${title}.`, status: "open", createdAt: hours(30), updatedAt: hours(30), ...extra });
const tasks = [
  task("task_1", "Add a sitemap to the build", { status: "active", runId: "run_5_1", updatedAt: hours(0.02) }),
  task("task_2", "Fix the login redirect loop", { updatedAt: hours(2) }),
  task("task_3", "Dark mode for the settings page", { status: "awaiting_verification", updatedAt: hours(5) }),
  task("task_4", "Rename the export button", { status: "done", updatedAt: hours(26), doneAt: hours(26) }),
  task("task_5", "Speed up the first paint on the map", { updatedAt: hours(50) }),
  task("task_6", "A task with a rather long title that has to be shortened in the menu without pushing the mark out", { updatedAt: hours(3) }),
];
// The worktree list names two of the tasks: one run is working, one is merged.
const base = { kind: "dev", detached: false, locked: false, lockedReason: "", missing: false, dirty: 0, ahead: 0, behind: 0, pushed: true, upstreamName: "origin/main", last: null, task: null, busy: false };
const worktreeRows = [
  { ...base, kind: "primary", path: "/work/mefi-studio", name: "mefi-studio", branch: "main", head: "9f8e7d6", sha: "9f8e7d6".padEnd(40, "0"), state: "primary", action: "" },
  { ...base, kind: "run", path: "/work/mefi-studio/.mefi/worktrees/run_5_1", name: "run_5_1", branch: "mefi/run_5_1", head: "cc22dd3", sha: "cc22dd3".padEnd(40, "0"), ahead: 2, pushed: false, busy: true, state: "unpushed", action: "2 commits only on this PC.", task: { taskId: "task_1", title: "Add a sitemap to the build", at: 1 } },
  { ...base, kind: "run", path: "/work/mefi-studio/.mefi/worktrees/run_4_1", name: "run_4_1", branch: "mefi/run_4_1", head: "ff44aa5", sha: "ff44aa5".padEnd(40, "0"), state: "merged", action: "Merged and clean.", task: { taskId: "task_6", title: "A task with a rather long title", at: 1 } },
];
const worktrees = { ok: true, repo: true, root: "/work/mefi-studio", main: "main", upstream: "origin/main", hasUpstream: true, rows: worktreeRows, summary: { total: 3, atRisk: 1, toLand: 0, safeToRemove: 1, missing: 0 }, headline: "3 worktrees.", projectId, enabled: { on: false, forced: false }, builders: true };
const days = Array.from({ length: 140 }, (_, index) => { const date = new Date(now - (139 - index) * 86400000); return { day: date.toISOString().slice(0, 10), count: (index * 7) % 5 }; });

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url);
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const configuration = { aiProvider: "auto", executorCli: "opencode", executorTier: "auto", aiAutoProviders: ["zai", "opencode"], agentBrain: { contextScout: true, deskTool: false } };
  const routing = { provider: "auto", roleProviders: {}, models: {}, providerModels: {}, hasZen: true, hasOpenCode: false, hasZai: false, hasOpenRouter: false, hasCustom: false, autoProviders: ["zai", "opencode"], autoFallback: false, subscriptionFirst: true, modelSelection: "jev", executorCli: "opencode", executorTier: "auto", executorTierDefaults: {}, lmStudioEndpoint: "http://127.0.0.1:1234/v1", customEndpoint: "", autoSetup: null };
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Builder fixture", path: root }] },
    tasksList: { ok: true, projectId, tasks }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: true, useReference: true, useTree: true, useWeb: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [{ id: "m1", role: "user", text: "What is left on the sitemap?", at: hours(1) }, { id: "m2", role: "assistant", text: "The build step is running; I will tell you when it finishes.", at: hours(0.9) }], prefs: { proactive: true, parallel: 8, aiParallel: 4, memoryAlign: true, loopGuard: true, loopGuardApply: true, compactHistory: true, keepAwake: true, background: true }, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, autoBuild: true, minutes: 5, parallel: 2, adaptiveParallel: true, mode: "swarm", running: [{ id: "run_5_1", taskId: "task_1", title: "Add a sitemap to the build", startedAt: now - 60000, phase: "building" }], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, draining: false, counts: {}, taskStates: [], next: [] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getAiRouting: routing, cliStatus: [], jevStatus: { enabled: true, route: "zen", routes: { vercel: false, typesafe: false, zen: true, openrouter: false } },
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [], skills: [], mcpTools: [], routing, seats: {}, choices: {} },
    cliSetupStatus: { ok: true, selected: "auto", clis: [] }, firstRunStatus: { ok: true, firstRun: null },
    machineGet: { ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } }, updateStatus: { ok: true, status: { auto: true } },
    companionState: { ok: true, projectId, projectName: "Builder fixture", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: true, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
    openrouterModels: { ok: true, models: [] }, agentModels: { ok: true, models: [] },
    workStats: { ok: true, projectId, totals: { tasks: 12, runs: 31, tokens: 1234567, activeDays: 9, verified: 7 }, peakHour: 14, days, models: [{ name: "GPT-6.1 Sol", tokens: 800000 }], store: { ok: true, error: null } },
    workWhere: { ok: true, projectId, repo: true, branch: "main", head: "996db71", dirty: 2, worktrees: { on: false, forced: false } },
    tasksAttempts: { ok: true, attempts: [] },
    worktreesList: worktrees,
  };
  const preload = path.join(root, "builder-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const calls=[];
    const bridge=Object.fromEntries(Object.keys(responses).map(key=>[key,async(...args)=>{calls.push({name:key,args:JSON.parse(JSON.stringify(args))});return responses[key];}]));
    for(const name of ['onTasks','onProjects','onAssistant','onAssistantStatus','onProjectPreview','onSettingsChanged','onStudioLog','onAutoSetup'])bridge[name]=()=>()=>{};
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('builderFixture',{calls:()=>calls,clear:()=>{calls.length=0;}});
    localStorage.setItem('mefiStudio.homeLayout','sessions');
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, label) => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "builder-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${label}`);
  };
  const capture = async (name) => {
    await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(150);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
  };

  // What the page looks like right now, in real pixels.
  const measure = `
    const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const list = document.getElementById('app-rail-sessions');
    const rows = list ? [...list.querySelectorAll('.builder-session')] : [];
    const composer = document.getElementById('workspace-form');
    const bottom = composer && composer.querySelector('.ws-compose-bottom');
    const bottomKids = bottom ? [...bottom.children].filter((node) => !node.hidden && getComputedStyle(node).display !== 'none' && getComputedStyle(node).position !== 'absolute' && node.getBoundingClientRect().height > 0) : [];
    const bottomTops = bottomKids.map((node) => Math.round(node.getBoundingClientRect().top));
    const bottomItems = bottom ? [...bottom.children].map((node) => ({ id: node.id, cls: String(node.className).slice(0, 40), hidden: node.hidden, display: getComputedStyle(node).display, position: getComputedStyle(node).position, top: Math.round(node.getBoundingClientRect().top), h: Math.round(node.getBoundingClientRect().height) })) : [];
    // The builder's own text (the classic cards it adopts, such as the walkthrough's checklist, keep the sizes they always had).
    const small = [...document.querySelectorAll('#app-rail-sessions *, #builder-home [class*="builder-"], #builder-chips [class*="builder-"], #builder-task [class*="builder-"], #builder-task .pane-badge, .pane-badge')].filter((node) => node.children.length === 0 && node.textContent.trim() && getComputedStyle(node).display !== 'none' && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.className + ':' + getComputedStyle(node).fontSize);
    return {
      inner: { w: innerWidth, h: innerHeight },
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      scrollbarWidth: getComputedStyle(document.documentElement).scrollbarWidth,
      layout: document.documentElement.dataset.homeLayout || null, pinned: 'railPinned' in document.documentElement.dataset,
      rail: box(document.getElementById('app-rail')),
      list: box(list), rows: rows.map((node) => ({ key: node.dataset.key, ...box(node), mark: box(node.querySelector('.builder-worktree')), markCss: node.querySelector('.builder-worktree') ? { display: getComputedStyle(node.querySelector('.builder-worktree')).display, opacity: getComputedStyle(node.querySelector('.builder-worktree')).opacity } : null, label: box(node.querySelector('.label')) })),
      home: box(document.getElementById('builder-home')), chips: box(document.getElementById('builder-chips')), composer: box(composer),
      bottomTops, bottomItems, oneLine: bottomTops.length > 0 && new Set(bottomTops).size === 1,
      small,
    };`;
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await until("window.MefiBuilder && window.MefiNav && !window.MefiBoot?.isActive?.()", "studio ready");
  // The layout adopts Home's sections the first time Home is shown.
  await run("window.MefiNav.go('workspace', { view: 'home' });");
  await until("document.documentElement.dataset.homeLayout === 'sessions'", "the sessions layout adopts Home");
  await until("document.querySelectorAll('#app-rail-sessions .builder-session').length >= 7", "the menu lists Chat with Mefi and the six tasks");
  report.layoutName = await run("return window.MefiBuilder.layout();");
  assert.equal(report.layoutName, "sessions");

  // The menu (pinned open by default in a wide window, so the rows are readable) and the branch marks.
  await until("'railPinned' in document.documentElement.dataset", "the menu is pinned open at 1440 px");
  await sleep(400);
  await until("document.querySelector('#app-rail-sessions .builder-worktree')", "the marks arrive after the first quiet look");
  report.marks = await run("return [...document.querySelectorAll('#app-rail-sessions .builder-session')].filter((node) => node.querySelector('.builder-worktree')).map((node) => node.dataset.key);");
  assert.deepEqual(report.marks.sort(), ["task_1", "task_6"], "the two tasks the worktree list names carry the mark, and no other row does");
  report.calls.push(await run("return window.builderFixture.calls().filter((call) => call.name === 'worktreesList').length;"));
  assert.ok(report.calls[0] >= 1 && report.calls[0] <= 3, `the menu looked at the worktree list only a few times (${report.calls[0]})`);
  const wide = await run(measure);
  report.wide = wide;
  const marked = wide.rows.find((row) => row.key === "task_6");
  assert.ok(marked.mark && marked.mark.w >= 10 && marked.mark.h >= 10, `the mark has a size on a task with a long title: ${JSON.stringify(marked.mark)}`);
  assert.ok(marked.mark.x >= marked.x - 1 && marked.mark.r <= marked.r + 1 && marked.mark.y >= marked.y - 1 && marked.mark.b <= marked.b + 1, "the mark sits inside its row");
  assert.ok(marked.label.r <= marked.mark.x + 1, "the long title is cut before the mark, not under it");
  assert.notEqual(marked.markCss.display, "none"); assert.ok(Number(marked.markCss.opacity) > 0.3, "the mark is not faded out");
  await capture("builder-menu-open.png");

  for (const [width, height, zoom] of [[1920, 1080, 1], [1440, 900, 1], [1100, 720, 1], [600, 560, 1], [600, 560, 1.5]]) {
    window.setContentSize(width, height); contents.setZoomFactor(zoom); await sleep(350);
    await run("window.MefiBuilder.setView('home');");
    await until("!document.getElementById('builder-home').hidden", `Home is showing at ${width}x${height}@${zoom}`);
    await sleep(200);
    const label = `${width}x${height}@${zoom}`;
    const m = await run(measure);
    if (zoom !== 1) await capture(`builder-home-${width}-zoom.png`);
    report.layouts.push({ label, layout: m.layout, pageOverflow: m.pageOverflow, oneLine: m.oneLine, rows: m.rows.length, rail: m.rail, composer: m.composer });
    assert.equal(m.layout, "sessions", `${label}: the layout stays on`);
    assert.equal(m.pageOverflow, false, `the page overflows at ${label}`);
    assert.equal(m.scrollbarWidth, "none", `native bars stay hidden at ${label}`);
    assert.deepEqual(m.small, [], `no text under 12 px at ${label}: ${JSON.stringify(m.small)}`);
    assert.ok(m.home && m.home.w > 200 && m.home.h > 100, `the greeting card has a size at ${label}: ${JSON.stringify(m.home)}`);
    assert.ok(m.composer && m.composer.w > 200 && m.composer.b <= m.inner.h + 1 && m.composer.r <= m.inner.w + 1, `the composer is on screen at ${label}: ${JSON.stringify(m.composer)}`);
    if (width >= 1440 && zoom === 1) assert.ok(m.oneLine, `the composer's bottom row stays on one line at ${label}: ${JSON.stringify(m.bottomItems)}`);
    // A pinned menu shows every row; a folded one (a narrow window) shows none of the labels, and takes only its own slim width.
    if (m.pinned) for (const item of m.rows) assert.ok(item.w > 30 && item.h > 20 && item.r <= m.inner.w + 1, `${item.key} has a size and stays in the window at ${label}: ${JSON.stringify(item)}`);
    else assert.ok(m.rail.w <= 90, `a folded menu stays slim at ${label}: ${JSON.stringify(m.rail)}`);
    if (zoom === 1 && [1920, 1100, 600].includes(width)) await capture(`builder-home-${width}.png`);
  }

  // A task opens as a session: its brief, its runs, a composer that talks about it.
  window.setContentSize(1440, 900); contents.setZoomFactor(1); await sleep(350);
  await run("window.MefiBuilder.openTask('task_2');");
  await until("document.getElementById('builder-task') && !document.getElementById('builder-task').hidden && document.getElementById('builder-task').textContent.includes('Fix the login redirect loop')", "the task opens as a session");
  report.session = await run("return { view: window.MefiBuilder.view(), current: document.querySelector('#app-rail-sessions .builder-session[aria-current=page]')?.dataset.key || null, text: document.getElementById('builder-task').textContent.slice(0, 160) };");
  assert.deepEqual(report.session.view, { view: "task", taskId: "task_2" });
  assert.equal(report.session.current, "task_2", "the menu marks the session on screen");
  await capture("builder-session-1440.png");
  const opened = await run(measure);
  assert.equal(opened.pageOverflow, false, "a session does not overflow the page");
  assert.deepEqual(opened.small, [], `no text under 12 px in a session: ${JSON.stringify(opened.small)}`);

  assert.deepEqual(report.errors, [], "no console errors");
  report.complete = true;
  finish();
}).catch(finish);
