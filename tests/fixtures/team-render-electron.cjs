"use strict";

// Team in the 0.5 layout, in a real Chromium: a copied booklet launched with ?layout=v2 and a synthetic bridge.
// renderer/agents.js files the Agents page into the prototype's twelve Team places (docs/prototype/mefi-studio-0.5-v5.html,
// TEAM_SUBS, TEAM_HEADS, WHERE_WENT) and renderer/shell.js lists them in the list column. This opens each place from its
// row with a real pointer at 1920x1080 and measures: the list in the prototype's order under its headings, the current
// row, the breadcrumb (Team / <place>), the page's title and the line under it, which panes show, the draft's Apply bar
// only where the team is edited, nothing wider than the page, and no text under 12 px. A place that is pages of its own
// (Skills, Workflows, Health and usage, Models, Inspect) opens its first page with the place open in the list. Old ways
// in (Settings' Connections, Models and Automation, Agents' setup panes, the permission control) land on the place that
// holds them now, and Search names a control by its Team place. Seats and models opens on its plain page
// (renderer/team-models.js) with the detailed cards folded under More settings, which Change and an old way in to a
// folded card open, and which is measured open as well as closed.
// Screenshots are kept when the test is given a capture folder (MEFI_TEAM_CAPTURE_DIR). No application main
// process or live state is loaded; network, permissions and child processes are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_TEAM_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Team fixture directory is required");
const studio = path.resolve(__dirname, "..", "..");
const report = { errors: [], networkAttempts: [], processAttempts: [], places: [], views: [], shots: [], steps: [], complete: false };
app.setName("Team Fixture");
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

// The prototype's list, in its order, under its headings (TEAM_SUBS with TEAM_HEADS).
const LIST = ["Overview", "Providers", "Seats and models", "Permissions", "# Context for agents", "Rules", "Skills", "Connectors", "Related folders", "Workflows", "# Monitor", "Health and usage", "Models", "Inspect"];
// The places that are panes of this page: the title, the panes that show, and whether the team draft's bars show.
const PANES = [
  ["overview", "Team", ["overview", "behavior"], { save: true, toolbar: true }],
  ["providers", "Providers", ["connections"], { save: false, toolbar: false }],
  ["seats", "Seats and models", ["team", "routing"], { save: true, toolbar: true }],
  ["perms", "Permissions", ["perms"], { save: false, toolbar: false }],
  ["rules", "Rules", ["rules"], { save: false, toolbar: true }],
  ["connectors", "Connectors", ["connectors"], { save: false, toolbar: false }],
  ["folders", "Related folders", ["folders"], { save: false, toolbar: false }],
];
const LABEL = { overview: "Overview", providers: "Providers", seats: "Seats and models", perms: "Permissions", rules: "Rules", connectors: "Connectors", folders: "Related folders" };
// The places that are pages of their own: the route their row opens, and the rows the list shows while you are there.
const VIEWS = [
  ["skills", "Skills", "skills", null],
  ["flows", "Workflows", "brains", ["Brain maps *", "Playbook", "Project map", "Context"]],
  ["health", "Health and usage", "usage", ["Recorded calls *", "Provider accounts"]],
  ["models", "Models", "booklet", ["Catalog *", "Performance"]],
  ["inspect", "Inspect", "explorer", ["Sessions *", "Activity and evidence", "Trace", "Overhead", "Performance profiler", "Machine status", "Connection log"]],
];

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
  const now = Date.now(), projectId = "team-project";
  const task = { id: "team-task", projectId, title: "Pin favourite notes", prompt: "Let me pin notes to the top of the list", status: "open", createdAt: now - 60000, updatedAt: now };
  const routing = { provider: "zen", roleProviders: {}, models: { routine: "gpt-6-luna", heavy: "gpt-6-sol" }, providerModels: {}, hasZen: true, hasOpenCode: false, hasZai: false, hasOpenRouter: false, hasCustom: false, autoProviders: ["zen", "codex"], autoFallback: true, modelSelection: "fixed", executorCli: "codex", executorModels: {}, executorTierModels: {}, executorTier: "auto", subscriptionFirst: true, lmStudioEndpoint: "http://127.0.0.1:1234/v1", customEndpoint: "", executorTierDefaults: {}, autoSetup: null };
  const configuration = { aiProvider: "zen", aiModels: routing.models, executorCli: "codex", agentBrain: { contextScout: true, deskTool: false, headDrafts: false, nestedDelegation: false } };
  const agentRules = require(path.join(studio, "scripts", "agent-rules.cjs"));
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
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [],
      skills: [{ id: "1234567890abcdef12345678", name: "Test driven development", scope: "project" }],
      mcpTools: [{ id: "docs/search", server: "docs", name: "search", description: "Search fixture documentation" }, { id: "docs/read", server: "docs", name: "read", description: "Read a fixture page" }],
      routing, seats: { lead: { provider: "zen", model: "gpt-6-sol", effort: "medium", fast: false }, desk: { provider: "zen", model: "gpt-6-sol", effort: "medium", fast: false } }, choices: {}, efforts: ["minimal", "low", "medium", "high", "xhigh", "max"],
      rulesInfo: { limit: 4000, fileCap: 8000, disabled: false, overhead: agentRules.overhead(), readers: agentRules.readers(), files: {
        agents: { name: "AGENTS.md", note: "the project's own agent notes", found: true, problem: null, bytes: 1840, used: 1800, capped: false, same: null },
        claude: { name: "CLAUDE.md", note: "Claude Code's project notes", found: false, problem: null, bytes: 0, used: 0, capped: false, same: null } } } },
    cliSetupStatus: { ok: true, selected: "codex", clis: ["codex", "claude", "opencode"].map((id) => ({ id, name: id, installed: id === "codex" })) }, firstRunStatus: { ok: true, firstRun: null },
    machineGet: { ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } }, updateStatus: { ok: true, status: { auto: true } },
    companionState: { ok: true, projectId, projectName: "Notes app", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: false, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
    brainState: { ok: true, tasks: [], recent: [], pipelines: {} }, brainPlaybook: { ok: true, shelf: [], recipes: [] }, brainMap: { ok: true, map: { systems: [], edges: [], files: [] } },
    worktreesList: { ok: true, repo: false, projectId, enabled: { on: false, forced: false } }, skillsList: { ok: true, skills: [], roots: [] },
    // Team › Connectors (renderer/connectors.js): one ready server with two tools, one waiting for approval.
    connectorsList: { ok: true, file: "~/.mefi-studio/mcp.json", secretsSafe: true, limits: { toolsPerAgent: 16 }, featured: [{ id: "playwright", title: "Playwright browser", description: "Lets a builder open your app in a real browser.", line: "npx -y @playwright/mcp@latest", needs: "Node.js", added: false }],
      servers: [{ id: "docs", title: "docs", transport: "stdio", line: "node docs-server.js", status: "ready", fingerprint: "a", enabled: true, places: ["builders"], envKeys: [], saved: [], standIns: [], missing: [], handWritten: true, tested: null, approvedAt: 0, source: "", addedAt: 0,
        tools: [{ name: "search", description: "Search fixture documentation", off: false }, { name: "read", description: "Read a fixture page", off: false }] },
        { id: "github", title: "GitHub", transport: "stdio", line: "npx -y @modelcontextprotocol/server-github", status: "needs-approval", fingerprint: "b", enabled: true, places: ["builders"], envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"], saved: [], standIns: ["GITHUB_PERSONAL_ACCESS_TOKEN"], missing: [], handWritten: false, tested: null, approvedAt: 0, source: "Featured in Studio", addedAt: 1, tools: [] }] },
    alertsGet: { ok: true, supported: true, killed: false, prefs: { on: true, need: true, fail: true, done: false, flash: true, badge: true, sound: false, titles: "generic" }, quiet: { on: false, from: "22:00", to: "07:00" } },
  };
  const names = await bridgeNames();
  const preload = path.join(root, "team-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const names=${JSON.stringify(names)};const calls=[];const subscribers={};
    const bridge={};
    for(const name of names){
      if(/^on[A-Z]/.test(name))bridge[name]=callback=>{(subscribers[name]??=[]).push(callback);return()=>{};};
      else bridge[name]=async(...args)=>{calls.push(name);return name in responses?JSON.parse(JSON.stringify(responses[name])):{ok:true};};
    }
    bridge.agentsState=async()=>JSON.parse(JSON.stringify(responses.agentsState));
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('teamFixture',{calls:()=>calls.slice(),clear:()=>{calls.length=0;}});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));localStorage.setItem('mefiStudio.whatsNew.seen','vibe-build-1');localStorage.setItem('mefiStudio.setupHelper.seen','setup-helper-1');
  `);
  const window = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, frame: false, enableLargerThanScreen: true, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, what, ms = 15000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "team-failure.png"), (await contents.capturePage()).toPNG());
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

  // What Team is right now, in real pixels: the list, the page, which panes show, what overflows and small text.
  const measure = `
    const overlay = document.getElementById('agents-overlay'), body = document.getElementById('agents-body');
    const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
    const shown = (node) => { if (!node || !node.getClientRects().length) return false; for (let n = node; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
    const own = (node) => [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
    const all = [...(overlay?.querySelectorAll('*') ?? []), ...(document.getElementById('shell-pages')?.querySelectorAll('*') ?? [])].filter(shown);
    const text = all.filter((node) => own(node) && !node.closest('[aria-hidden="true"]') && parseFloat(getComputedStyle(node).fontSize) > 0);
    const small = text.filter((node) => parseFloat(getComputedStyle(node).fontSize) < 11.95).map((node) => (node.id || String(node.className).slice(0, 40) || node.tagName) + ':' + getComputedStyle(node).fontSize + ':' + node.textContent.trim().slice(0, 30));
    // The page's inner right edge: where its content ends, its own scroll bar left out.
    const edge = body ? body.getBoundingClientRect().left + body.clientLeft + body.clientWidth : 0;
    const wide = body ? all.filter((node) => body.contains(node) && node.getBoundingClientRect().right > edge + 1.5).slice(0, 6).map((node) => (node.id || String(node.className).slice(0, 40) || node.tagName) + ' ' + Math.round(node.getBoundingClientRect().right) + '>' + Math.round(edge)) : [];
    const title = document.getElementById('agents-title');
    return {
      inner: { w: innerWidth, h: innerHeight }, route: window.MefiNav?.current?.() ?? null, open: overlay ? overlay.hidden === false : false,
      places: overlay?.dataset.places ?? null, place: overlay?.dataset.teamPlace ?? null,
      title: title?.textContent ?? null, about: shown(title?.nextElementSibling) ? title.nextElementSibling.textContent : null,
      panes: [...(body?.querySelectorAll(':scope > [data-agents-pane]') ?? [])].filter((node) => !node.hidden).map((node) => node.dataset.agentsPane),
      save: shown(document.getElementById('agents-save-bar')), toolbar: shown(document.getElementById('agents-team-toolbar')),
      list: document.getElementById('shell-pages')?.hidden === false ? [...document.querySelectorAll('#shell-pages-list > *')].map((node) => (node.tagName === 'H3' ? '# ' : '') + node.textContent.trim() + (node.getAttribute('aria-current') ? ' *' : '') + (node.classList.contains('is-open') ? ' +' : '')) : null,
      listTitle: document.querySelector('#shell-pages .shell-pages-title')?.textContent ?? null,
      crumbs: [...document.querySelectorAll('.shell-trail .shell-crumb')].map((node) => node.textContent.trim()),
      sheet: box(overlay), nav: box(document.getElementById('shell-pages')),
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      bodyOverflow: body ? body.scrollWidth > body.clientWidth + 1 : false, small, wide,
      // When the page scrolls sideways: its sizes, and what reaches furthest right, shown or not.
      sideways: body && body.scrollWidth > body.clientWidth + 1 ? { scroll: body.scrollWidth, client: body.clientWidth, box: box(body), edge: Math.round(edge), inner: innerWidth,
        far: [...body.querySelectorAll('*')].map((node) => ({ node, r: node.getBoundingClientRect() })).filter((row) => row.r.right > edge + 1.5).sort((a, b) => b.r.right - a.r.right).slice(0, 8).map((row) => (row.node.id || String(row.node.className).slice(0, 50) || row.node.tagName) + ' r' + Math.round(row.r.right) + ' w' + Math.round(row.r.width) + (shown(row.node) ? '' : ' (hidden)')) } : null,
      headActions: shown(document.querySelector('.agents-head-actions')), eyebrow: shown(document.querySelector('.agents-eyebrow')),
    };`;
  const problems = (m, tag) => [
    ...(m.pageOverflow ? [`${tag}: the page overflows the window`] : []),
    ...(m.bodyOverflow ? [`${tag}: the page body scrolls sideways ${JSON.stringify(m.sideways)}`] : []),
    ...m.small.map((line) => `${tag}: text under 12 px: ${line}`),
    ...m.wide.map((line) => `${tag}: past the page's right edge: ${line}`),
  ];
  const found = [];
  const go = (id, params) => run(`window.MefiNav.go(${JSON.stringify(id)}${params ? `, ${JSON.stringify(params)}` : ""});`);
  const placeIs = (place) => `document.getElementById('agents-overlay')?.hidden === false && document.getElementById('agents-overlay').dataset.teamPlace === ${JSON.stringify(place)}`;

  // ---- v2 ------------------------------------------------------------------------------------------
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1", layout: "v2" } });
  await until("window.MefiNav && window.MefiAgents && window.MefiShell && window.MefiShell.active() && !window.MefiBoot?.isActive?.()", "studio ready (v2)");
  assert.equal(await run("return document.documentElement.dataset.layout;"), "v2");
  await run("window.MefiVibe?.setMode?.('build', { go: false }); window.MefiNav.setRailPinned?.(false, { save: false });");
  await resize(1920, 1080);
  await go("agents");
  await until(placeIs("overview"), "Team opens on its Overview");
  await sleep(500);
  const first = await run(measure);
  assert.equal(first.places, "v2", "Team's places are filed");
  assert.equal(await run("return window.MefiNav.get('agents').label;"), "Team", "the page is called Team");
  assert.equal(first.listTitle, "Team", "the list column is Team's");
  assert.deepEqual(first.list, LIST.map((row, at) => (at === 0 ? `${row} *` : row)), "the list column holds the prototype's places, under its headings, with Overview current");
  assert.equal(first.eyebrow, false, "no eyebrow over the title: the breadcrumb says where you are");
  assert.equal(first.headActions, false, "the classic head's buttons step aside");
  // Every place that is a pane of this page, from its row.
  for (const [id, title, panes, bars] of PANES) {
    await click(`#shell-pages-list [data-page="team:${id}"]`);
    await until(placeIs(id), `${title} is the place`);
    await sleep(500);
    const m = await run(measure);
    m.id = id; report.places.push(m);
    assert.equal(m.title, title, `${id}: the page says where you are`);
    assert.ok(m.about && m.about.length > 20, `${id}: a line under the title says what the place is for (${JSON.stringify(m.about)})`);
    assert.deepEqual(m.panes, panes, `${id}: its panes and no others`);
    assert.equal(m.save, bars.save, `${id}: the draft's Apply bar ${bars.save ? "shows" : "steps aside"}`);
    assert.equal(m.toolbar, bars.toolbar, `${id}: the project-or-defaults bar ${bars.toolbar ? "shows" : "steps aside"}`);
    assert.deepEqual(m.list.filter((row) => row.endsWith(" *")), [`${LABEL[id]} *`], `${id}: its row in the list is the current one`);
    assert.deepEqual(m.crumbs.slice(-2), ["Team", LABEL[id]], `${id}: the breadcrumb says Team / ${LABEL[id]}`);
    assert.ok(m.sheet.x >= m.nav.r - 1, `${id}: the page is beside the list ${JSON.stringify({ sheet: m.sheet, nav: m.nav })}`);
    await capture(`team-${id}-1920x1080.png`);
    found.push(...problems(m, `${title} at 1920x1080`));
  }
  // Seats and models in plain words (renderer/team-models.js): five parts on top, and the detailed cards it grew from
  // (the role grid, routing, coding workers, team coordination) folded under More settings until asked for. Change on a
  // job's line opens that job's card; with it open the page still fits and nothing is under 12 px.
  await click('#shell-pages-list [data-page="team:seats"]');
  await until(placeIs("seats"), "Seats and models again");
  await until("document.querySelectorAll('#team-models .tm-tbody .tm-tr').length === 8", "Who does what lists its eight jobs");
  // checkVisibility: a closed <details> hides its content with content-visibility,
  // which getClientRects still measures.
  report.seats = await run(`const shown = (node) => Boolean(node) && node.checkVisibility();
    return {
      parts: [...document.querySelectorAll('#team-models > .tm-panel .tm-title')].map((node) => node.textContent),
      choices: [...document.querySelectorAll('#team-models .tm-row')].map((node) => node.dataset.choice),
      jobs: [...document.querySelectorAll('#team-models .tm-tbody .tm-tr')].map((node) => node.dataset.job),
      open: document.getElementById('agents-more')?.open ?? null,
      folded: ['agents-role-grid', 'settings-routing', 'settings-workers', 'agents-team-behavior'].filter((id) => document.getElementById(id)?.closest('#agents-more-body')),
      grid: shown(document.getElementById('agents-role-grid')),
    };`);
  assert.deepEqual(report.seats.parts, ["Right now", "How Studio decides", "Who does what", "Report card", "How thinking works"], "the plain page's five parts");
  assert.deepEqual(report.seats.choices, ["pick", "mode", "climb", "askMax", "explore", "subs"], "the six choices");
  assert.deepEqual(report.seats.jobs, ["companion", "routine", "heavy", "builder", "lead", "desk", "scout", "overseer"], "one line per job");
  assert.equal(report.seats.open, false, "More settings starts folded");
  assert.deepEqual(report.seats.folded, ["agents-role-grid", "settings-routing", "settings-workers", "agents-team-behavior"], "the detailed cards wait under More settings");
  assert.equal(report.seats.grid, false, "folded cards are not on the page");
  await click('#team-models .tm-tr[data-job="desk"] .tm-change');
  await until("document.getElementById('agents-more')?.open === true && document.querySelector('.agents-model-row[data-agent=\"desk\"]')?.getClientRects().length > 0", "Change opens the desk's card");
  await sleep(400);
  found.push(...problems(await run(measure), "Seats and models with More settings open at 1920x1080"));
  await capture("team-seats-more-1920x1080.png");
  await run("document.getElementById('agents-more').open = false;");
  report.steps.push("seats in plain words, the detail folded");
  // What each new place holds.
  report.content = await run(`return {
    perms: Boolean(document.querySelector('#agents-permissions h3')) && document.querySelector('#agents-permissions h3').textContent,
    rules: Boolean(document.querySelector('#agents-rules-place #agents-rules')),
    connectors: [...document.querySelectorAll('#connectors-rows .connectors-row-card')].map((row) => row.dataset.id + ':' + row.dataset.status + ':' + [...row.querySelectorAll('.connectors-tool')].map((tool) => tool.textContent).join(',')),
    connectorParts: ['connectors-import-open', 'connectors-add-open', 'connectors-budget', 'connectors-featured', 'connectors-own'].filter((id) => document.getElementById(id)),
    folders: Boolean(document.getElementById('agents-folders-gap')),
  };`);
  assert.equal(report.content.perms, "Mefi's permissions", "Permissions holds the full permission control");
  assert.equal(report.content.rules, true, "Rules holds the rules card");
  assert.deepEqual(report.content.connectors, ["docs:ready:search,read", "github:needs-approval:"], "Connectors lists each server with its state and tools");
  assert.deepEqual(report.content.connectorParts, ["connectors-import-open", "connectors-add-open", "connectors-budget", "connectors-featured", "connectors-own"], "Connectors can add, import and feature servers, and counts each place's tools");
  assert.equal(report.content.folders, true, "Related folders says what Studio cannot do yet");
  // Every place that is pages of its own: its first page, with the place open in the list.
  for (const [id, label, route, rows] of VIEWS) {
    await go("agents");
    await until(placeIs("overview"), "back on the Overview");
    await click(`#shell-pages-list [data-page="team:${id}"]`);
    await until(`window.MefiNav.current() === ${JSON.stringify(route)}`, `${label} opens ${route}`);
    await sleep(600);
    const m = await run(measure);
    m.id = id; report.views.push(m);
    assert.deepEqual(m.crumbs.slice(-2), ["Team", label], `${label}: the breadcrumb says Team / ${label}`);
    assert.equal(m.listTitle, "Team", `${label}: the list is still Team's`);
    if (rows) {
      const at = m.list.indexOf(`${label} +`);
      assert.ok(at >= 0, `${label}: the place is open in the list ${JSON.stringify(m.list)}`);
      assert.deepEqual(m.list.slice(at + 1, at + 1 + rows.length), rows, `${label}: its pages are listed under it, the first one current`);
    } else assert.ok(m.list.includes(`${label} *`), `${label}: its row is current ${JSON.stringify(m.list)}`);
    await capture(`team-${id}-1920x1080.png`);
  }
  assert.deepEqual(found, [], "every Team place fits, with no text under 12 px");
  // Old ways in land on the place that holds them now.
  for (const [what, id, params, place] of [
    ["Settings › Connections", "studio", { section: "connections" }, "providers"],
    ["Settings › Models › routing", "studio", { section: "settings-routing" }, "seats"],
    ["Settings › Automation", "studio", { section: "automation" }, "overview"],
    ["Agents › Setup › Team", "agents", { section: "setup", pane: "team" }, "seats"],
    ["Agents › Setup › Connections", "agents", { section: "setup", pane: "connections" }, "providers"],
    ["Team › Permissions", "agents", { place: "perms" }, "perms"],
  ]) {
    await go(id, params);
    await until(placeIs(place), `${what} lands on ${place}`);
  }
  // Settings' routing card sits under More settings now: the way in to it opened the fold (it was closed above).
  assert.equal(await run("return document.getElementById('agents-more')?.open === true;"), true, "an old way in to a folded card opens More settings");
  await run("document.getElementById('agents-more').open = false;");
  await go("agents", { place: "models" });
  await until("window.MefiNav.current() === 'booklet'", "Team › Models opens the catalog");
  await go("agent-brain", { tab: "playbook" });
  await until("window.MefiNav.current() === 'agent-brain'", "the Playbook opens");
  await sleep(400);
  const playbook = await run(measure);
  assert.deepEqual(playbook.crumbs.slice(-2), ["Team", "Workflows"], "the Playbook is Team / Workflows");
  assert.ok(playbook.list.includes("Playbook *"), `the Playbook is current under Workflows ${JSON.stringify(playbook.list)}`);
  await run("window.MefiNav.closeAll?.();");
  await run("window.MefiAutonomy.openSettings();");
  await until(placeIs("perms"), "the permission control's way in opens Team › Permissions");
  report.steps.push("old ways in land");
  // Search names a control by the Team place that holds it now.
  report.search = await run(`const pane = document.getElementById('agents-connections'); const control = pane && pane.querySelector('input[id], select[id], button[id], details[id]');
    return control ? { id: control.id, label: window.MefiNav.get('settings:' + control.id)?.label ?? null } : null;`);
  assert.ok(report.search && /^Team › Providers › /.test(report.search.label || ""), `Search names a Providers control under Team › Providers: ${JSON.stringify(report.search)}`);
  // The layout contract's other sizes: the page still fits, nothing is small.
  for (const [width, height, zoom] of [[1440, 900, 1], [1100, 720, 1], [600, 560, 1.5]]) {
    await resize(width, height, zoom);
    for (const place of ["overview", "providers", "seats", "perms"]) {
      await go("agents", { place });
      await until(placeIs(place), `${place} at ${width}x${height}@${zoom}`);
      await sleep(400);
      const m = await run(measure);
      const wrong = problems(m, `${place} at ${width}x${height}@${zoom}`);
      found.push(...wrong);
      if (place === "seats" || wrong.length) await capture(`team-${place}-${width}x${height}@${zoom}.png`);
      // The cards under More settings were measured on the page before they folded; they still are, opened.
      if (place === "seats") {
        await run("document.getElementById('agents-more').open = true;");
        await sleep(400);
        const open = problems(await run(measure), `seats with More settings open at ${width}x${height}@${zoom}`);
        found.push(...open);
        if (open.length) await capture(`team-seats-more-${width}x${height}@${zoom}.png`);
        await run("document.getElementById('agents-more').open = false;");
      }
    }
  }
  assert.deepEqual(found, [], "every Team place fits at every size, with no text under 12 px");
  await resize(1920, 1080);
  report.complete = true;
  finish();
}).catch(finish);
