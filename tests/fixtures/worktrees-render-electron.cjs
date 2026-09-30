"use strict";

// Work > Worktrees in a real Chromium: a copied booklet and a synthetic bridge
// that answers worktrees:list with a project holding every state (the main
// checkout, uncommitted work, a task run in progress, commits only on this PC,
// a branch on GitHub, a merged run, a folder that is gone). It opens the page at
// five window sizes and checks the real geometry: nothing overflows the page,
// every row and every button is on screen, no scroller reserves width for a
// bar, no text is under 12 px. Then it drives the actions the way a person
// does: Open, a merge that needs a merge commit, a two-step Remove that asks
// for force, Forget, the run switch, the task link, a live push and Back.
// No application main process or live state is loaded; network, permissions
// and child processes are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_WORKTREES_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Worktrees fixture directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], calls: [] };
app.setName("Worktrees Fixture");
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

// What scripts/worktrees.mjs would say about a project with one of everything.
const base = { kind: "dev", detached: false, locked: false, lockedReason: "", missing: false, dirty: 0, ahead: 0, behind: 0, pushed: true, upstreamName: "origin/main", last: null, task: null, busy: false };
const row = (name, more) => ({ ...base, path: `/work/${name}`, name, branch: `wip/${name}`, head: "1a2b3c4", sha: "1a2b3c4".padEnd(40, "0"), ...more });
const rows = () => [
  row("mefi-studio", { kind: "primary", branch: "main", state: "primary", action: "", last: { sha: "9f8e7d6", date: "2026-09-30", subject: "Show a slim indicator on panes that can scroll, taking no width" } }),
  row("wt-dirty", { dirty: 3, ahead: 1, pushed: false, state: "dirty", action: "3 uncommitted files: commit, stash or discard them before anything else.", last: { sha: "aa11bb2", date: "2026-09-29", subject: "Sketch the tab strip" } }),
  row("run_5_1", { kind: "run", branch: "mefi/run_5_1", path: "/work/mefi-studio/.mefi/worktrees/run_5_1", ahead: 2, pushed: false, busy: true, state: "unpushed", action: "2 commits only on this PC: push them (git push origin HEAD:refs/heads/wip/mefi/run_5_1) or land them.", task: { taskId: "task_9", title: "Fix the sidebar so it keeps its scroll position when a task finishes", at: 1 }, last: { sha: "cc22dd3", date: "2026-09-30", subject: "Keep the sidebar scroll" } }),
  row("loose", { kind: "detached", branch: null, detached: true, head: "de4dbe3", ahead: 1, pushed: false, state: "unpushed", action: "Detached HEAD with 1 commit on no branch: put them on a branch and push it.", last: { sha: "de4dbe3", date: "2026-09-28", subject: "Try the new parser" } }),
  row("wt-pushed", { ahead: 4, behind: 2, pushed: true, state: "on-github", action: "4 commits on GitHub, not merged into origin/main: land it or leave it parked.", last: { sha: "ee33ff4", date: "2026-09-27", subject: "Add the media probe" } }),
  row("wt-gone", { missing: true, state: "missing", action: "The folder is gone. Run `git worktree prune` to forget it." }),
  row("run_4_1", { kind: "run", branch: "mefi/run_4_1", path: "/work/mefi-studio/.mefi/worktrees/run_4_1", state: "merged", action: "Merged into origin/main and clean: safe to remove (git worktree remove /work/mefi-studio/.mefi/worktrees/run_4_1).", task: { taskId: "task_7", title: "Rename the Vibe strip", at: 1 }, last: { sha: "ff44aa5", date: "2026-09-26", subject: "Rename the strip" } }),
];
const summaryOf = (list) => ({ total: list.length, atRisk: list.filter((r) => ["dirty", "unpushed"].includes(r.state)).length, toLand: list.filter((r) => r.state === "on-github").length, safeToRemove: list.filter((r) => r.state === "merged").length, missing: list.filter((r) => r.state === "missing").length });
const listOf = (list) => {
  const summary = summaryOf(list);
  if (summary.total === 1) return { ok: true, repo: true, root: "/work/mefi-studio", main: "main", upstream: "origin/main", hasUpstream: true, rows: list, summary, headline: "One checkout, no other worktrees.", projectId: "project_fixture", enabled: { on: false, forced: false }, builders: false };
  const parts = [];
  if (summary.atRisk) parts.push(`${summary.atRisk} hold work that exists only on this PC`);
  if (summary.toLand) parts.push(`${summary.toLand} is on GitHub but not merged`);
  if (summary.safeToRemove) parts.push(`${summary.safeToRemove} is merged and safe to remove`);
  if (summary.missing) parts.push(`${summary.missing} folder is gone`);
  return { ok: true, repo: true, root: "/work/mefi-studio", main: "main", upstream: "origin/main", hasUpstream: true, rows: list, summary, headline: `${summary.total} worktrees: ${parts.join(", ")}.`, projectId: "project_fixture", enabled: { on: false, forced: false }, builders: true };
};

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
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Worktrees fixture", path: root }] },
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
    companionState: { ok: true, projectId, projectName: "Worktrees fixture", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: true, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
    openrouterModels: { ok: true, models: [] }, agentModels: { ok: true, models: [] },
  };
  const preload = path.join(root, "worktrees-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const calls=[];const statusSubscribers=[];
    const state={list:${JSON.stringify(listOf(rows()))},enabled:{on:false,forced:false}};const scripts={};
    const next=(name,fallback)=>{const queue=scripts[name];if(!queue||!queue.length)return fallback;return queue.length>1?queue.shift():queue[0];};
    const bridge=Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]]));
    const record=(name,result)=>async(...args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return typeof result==='function'?result(...args):result;};
    bridge.worktreesList=record('worktreesList',()=>next('list',{...state.list,enabled:state.enabled}));
    bridge.worktreesOpen=record('worktreesOpen',()=>next('open',{ok:true}));
    bridge.worktreesMerge=record('worktreesMerge',()=>next('merge',{ok:true}));
    bridge.worktreesRemove=record('worktreesRemove',()=>next('remove',{ok:true}));
    bridge.worktreesForget=record('worktreesForget',()=>next('forget',{ok:true,pruned:1}));
    bridge.workWorktrees=record('workWorktrees',(on)=>{state.enabled={on:on===true,forced:false};return {ok:true,worktrees:state.enabled};});
    bridge.onAssistantStatus=callback=>{statusSubscribers.push(callback);};
    for(const name of ['onTasks','onProjects','onAssistant','onProjectPreview','onSettingsChanged','onStudioLog','onAutoSetup'])bridge[name]=()=>()=>{};
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('worktreesFixture',{calls:()=>calls,clear:()=>{calls.length=0;},setList:list=>{state.list=list;},script:(name,results)=>{scripts[name]=results;},status:payload=>{for(const callback of statusSubscribers)callback(payload);}});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "worktrees-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${label}`);
  };
  const capture = async (name) => {
    await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(150);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
  };
  const calls = (name) => run(`return window.worktreesFixture.calls().filter((call) => call.name === ${JSON.stringify(name)}).map((call) => call.args[0]);`);
  const rowOf = (name) => `document.querySelector('.worktrees-row[data-path$="/${name}"]')`;
  const press = (name, label) => run(`const button = [...${rowOf(name)}.querySelectorAll('button')].find((node) => node.textContent === ${JSON.stringify(label)}); if (!button) return false; button.focus(); button.click(); return true;`);
  const buttonsOf = (name) => run(`return [...${rowOf(name)}.querySelectorAll('.worktrees-buttons button')].map((node) => ({ text: node.textContent, disabled: node.disabled }));`);

  // What the page looks like right now, in real pixels.
  const measure = `
    const box = (node) => { const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const body = document.querySelector('#worktrees-overlay .worktrees-body');
    const rows = [...document.querySelectorAll('#worktrees-list .worktrees-row')];
    const small = [...document.querySelectorAll('#worktrees-overlay .worktrees-body *')].filter((node) => node.children.length === 0 && node.textContent.trim() && getComputedStyle(node).display !== 'none' && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.className + ':' + getComputedStyle(node).fontSize);
    return {
      inner: { w: innerWidth, h: innerHeight }, sheet: box(document.querySelector('#worktrees-overlay .worktrees-sheet')), body: box(body),
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      bodyGutter: body.offsetWidth - body.clientWidth, bodyOverflowX: body.scrollWidth > body.clientWidth + 1,
      scrollbarWidth: getComputedStyle(body).scrollbarWidth,
      rows: rows.map((node) => ({ name: node.querySelector('.worktrees-name').textContent, ...box(node), buttons: [...node.querySelectorAll('button')].map((button) => box(button)), overflowX: node.scrollWidth > node.clientWidth + 1 })),
      small,
    };`;
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await until("window.MefiWorktrees && window.MefiNav && !window.MefiBoot?.isActive?.()", "studio ready");
  report.registered = await run("const record = window.MefiNav.get('worktrees'); return record ? { id: record.id, kind: record.kind, layer: record.layer, section: record.section, key: record.key, tools: record.showIn.tools, palette: record.showIn.palette, element: record.element, glyph: record.glyph } : null;");
  assert.deepEqual(report.registered, { id: "worktrees", kind: "overlay", layer: "sheet", section: "work", key: null, tools: true, palette: true, element: "worktrees-overlay", glyph: "g-worktree" });
  assert.equal(await run("return Boolean(document.getElementById('g-worktree'));"), true, "the glyph exists in the sprite");
  assert.ok(await run("return window.MefiNav.LOCAL_ROUTES.work.includes('worktrees');"), "it sits in Work's local row");

  for (const [width, height, zoom] of [[1720, 900, 1], [1440, 900, 1], [1100, 720, 1], [600, 560, 1], [1100, 720, 1.25]]) {
    window.setContentSize(width, height); contents.setZoomFactor(zoom); await sleep(300);
    await run("if (window.MefiWorktrees.isOpen()) window.MefiWorktrees.close(); window.MefiNav.go('worktrees');");
    await until("document.querySelectorAll('#worktrees-list .worktrees-row').length === 7", `the seven rows are painted at ${width}x${height}@${zoom}`);
    await sleep(200);
    const label = `${width}x${height}@${zoom}`;
    const m = await run(measure);
    report.layouts.push({ label, ...m, rows: m.rows.length });
    assert.equal(m.pageOverflow, false, `the page overflows at ${label}`);
    assert.equal(m.bodyOverflowX, false, `the list scrolls sideways at ${label}`);
    assert.equal(m.bodyGutter, 0, `the scroller reserves ${m.bodyGutter}px for a bar at ${label}`);
    assert.equal(m.scrollbarWidth, "none", `native bars stay hidden at ${label}`);
    assert.ok(m.sheet.x >= -1 && m.sheet.y >= -1 && m.sheet.r <= m.inner.w + 1 && m.sheet.b <= m.inner.h + 1, `the sheet fits at ${label}: ${JSON.stringify(m.sheet)}`);
    assert.deepEqual(m.small, [], `no text under 12 px at ${label}`);
    assert.equal(m.rows.length, 7);
    for (const item of m.rows) {
      assert.ok(item.w > 200 && item.h > 40, `${item.name} has a size at ${label}`);
      assert.ok(item.x >= m.body.x - 1 && item.r <= m.body.r + 1, `${item.name} fits the width of the list at ${label}: ${JSON.stringify(item)} in ${JSON.stringify(m.body)}`);
      assert.equal(item.overflowX, false, `${item.name} holds its own content at ${label}`);
      for (const button of item.buttons) assert.ok(button.w > 20 && button.x >= item.x - 1 && button.r <= item.r + 1, `a button of ${item.name} stays inside its row at ${label}: ${JSON.stringify(button)}`);
    }
    for (const [index, a] of m.rows.entries()) for (const b of m.rows.slice(index + 1)) assert.ok(a.b <= b.y + 1 || b.b <= a.y + 1, `${a.name} overlaps ${b.name} at ${label}`);
    if (zoom === 1 && [1720, 1440, 600].includes(width)) await capture(`worktrees-${width}.png`);
  }

  // The first row on the page is the main checkout, then the worst first.
  window.setContentSize(1440, 900); contents.setZoomFactor(1); await sleep(300);
  await run("window.MefiWorktrees.close(); window.MefiNav.go('tasks'); window.MefiNav.go('worktrees');");
  await until("document.querySelectorAll('#worktrees-list .worktrees-row').length === 7", "the rows are back");
  report.order = await run("return [...document.querySelectorAll('#worktrees-list .worktrees-row')].map((node) => node.dataset.state + ':' + node.querySelector('.worktrees-name').textContent);");
  assert.deepEqual(report.order, ["primary:mefi-studio", "dirty:wt-dirty", "unpushed:run_5_1", "unpushed:loose", "on-github:wt-pushed", "missing:wt-gone", "merged:run_4_1"]);
  assert.match(await run("return document.getElementById('worktrees-headline').textContent;"), /^7 worktrees: 3 hold work that exists only on this PC, 1 is on GitHub but not merged, 1 is merged and safe to remove, 1 folder is gone\.$/);
  assert.equal(await run("return document.getElementById('worktrees-headline').dataset.tone;"), "warn", "work at risk colours the headline");
  assert.deepEqual(await run("return [...document.querySelectorAll('#worktrees-counts .worktrees-count')].map((node) => node.textContent);"), ["3 at risk", "1 on github", "1 merged", "1 gone"]);
  assert.equal(await run("return document.getElementById('worktrees-forget').hidden;"), false, "a gone folder offers the sweep");
  // Which buttons each kind of row offers.
  assert.deepEqual(await buttonsOf("mefi-studio"), [{ text: "Open folder", disabled: false }], "the main checkout can only be opened");
  assert.deepEqual(await buttonsOf("wt-dirty"), [{ text: "Open folder", disabled: false }, { text: "Merge into main", disabled: true }, { text: "Remove", disabled: false }], "uncommitted work cannot be merged");
  assert.deepEqual(await buttonsOf("run_5_1"), [{ text: "Open folder", disabled: false }, { text: "Merge into main", disabled: true }, { text: "Remove", disabled: true }], "a run at work is left alone");
  assert.deepEqual(await buttonsOf("loose"), [{ text: "Open folder", disabled: false }, { text: "Merge into main", disabled: true }, { text: "Remove", disabled: false }], "commits on no branch are put on one first");
  assert.deepEqual(await buttonsOf("wt-pushed"), [{ text: "Open folder", disabled: false }, { text: "Merge into main", disabled: false }, { text: "Remove", disabled: false }]);
  assert.deepEqual(await buttonsOf("wt-gone"), [{ text: "Forget", disabled: false }]);
  assert.deepEqual(await buttonsOf("run_4_1"), [{ text: "Open folder", disabled: false }, { text: "Merge into main", disabled: true }, { text: "Remove", disabled: false }], "nothing left to merge in a merged run");
  assert.equal(await run(`return ${rowOf("run_5_1")}.querySelector('.worktrees-flag').textContent;`), "a run is working here");
  assert.equal(await run(`return ${rowOf("loose")}.querySelector('.worktrees-branch').textContent;`), "detached at de4dbe3");
  await capture("worktrees-list.png");

  const withRow = (name, patch) => listOf(rows().map((item) => (item.name === name ? { ...item, ...patch } : item)));
  const without = (...names) => listOf(rows().filter((item) => !names.includes(item.name)));
  const notes = (name) => run(`return [...${rowOf(name)}.querySelectorAll('.worktrees-note')].map((node) => ({ tone: node.dataset.tone, text: node.firstChild.textContent, choices: [...node.querySelectorAll('button')].map((button) => button.textContent) }));`);
  const script = (name, results) => run(`window.worktreesFixture.script(${JSON.stringify(name)}, ${JSON.stringify(results)});`);
  const setList = (list) => run(`window.worktreesFixture.setList(${JSON.stringify(list)});`);

  // Open: the folder goes to the host as it was listed.
  await run("window.worktreesFixture.clear();");
  await press("wt-pushed", "Open folder");
  await until("window.worktreesFixture.calls().some((call) => call.name === 'worktreesOpen')", "Open reaches the host");
  assert.deepEqual((await calls("worktreesOpen")).map((call) => ({ path: call.path, projectId: call.projectId })), [{ path: "/work/wt-pushed", projectId: "project_fixture" }]);
  await script("open", [{ ok: false, error: "The file manager could not start" }]);
  await press("wt-pushed", "Open folder");
  await until(`${rowOf("wt-pushed")}.querySelector('.worktrees-note')`, "a failed Open says so");
  assert.deepEqual(await notes("wt-pushed"), [{ tone: "bad", text: "The file manager could not start", choices: [] }]);
  await script("open", [{ ok: true }]);

  // A merge that needs a merge commit: the host says why, the row offers it, and one press does it.
  await run("window.worktreesFixture.clear();");
  await script("merge", [
    { ok: false, needsMergeCommit: true, error: "main has moved on since wip/wt-pushed started, so it cannot be fast-forwarded. Bring main into the worktree first, or merge with a merge commit." },
    { ok: true, merged: true, branch: "wip/wt-pushed", into: "main", head: "abc1234", how: "merge commit", note: "Merged on this PC only. Save and push, or run npm run sync, to put main on GitHub." },
  ]);
  assert.equal(await press("wt-pushed", "Merge into main"), true);
  await until(`${rowOf("wt-pushed")}.querySelector('.worktrees-note')`, "the refusal reads under the row");
  const refusal = await notes("wt-pushed");
  assert.equal(refusal.length, 1);
  assert.equal(refusal[0].tone, "warn");
  assert.match(refusal[0].text, /^Main has moved on since wip\/wt-pushed started/);
  assert.deepEqual(refusal[0].choices, ["Merge with a merge commit"], "and offers the next step");
  assert.deepEqual((await calls("worktreesMerge")).map((call) => ({ path: call.path, mode: call.mode, projectId: call.projectId, remove: call.remove })), [{ path: "/work/wt-pushed", mode: undefined, projectId: "project_fixture", remove: undefined }], "the first ask names only the folder");
  await setList(withRow("wt-pushed", { ahead: 0, behind: 0, state: "merged", action: "Merged into origin/main and clean: safe to remove (git worktree remove /work/wt-pushed)." }));
  assert.equal(await press("wt-pushed", "Merge with a merge commit"), true);
  await until(`${rowOf("wt-pushed")}.dataset.state === 'merged' && ${rowOf("wt-pushed")}.querySelector('.worktrees-note[data-tone="good"]')`, "the merged row says where the merge went");
  assert.equal((await calls("worktreesMerge")).at(-1).mode, "merge", "the second ask is for a merge commit");
  assert.match((await notes("wt-pushed"))[0].text, /^Merged on this PC only\./);
  assert.match(await run("return document.getElementById('toast-host')?.textContent || '';"), /Merged wip\/wt-pushed into main \(merge commit\)\. Not pushed yet\./);
  // The button that was pressed is held while it works and, having nothing left to do, hands the keyboard to the row's first one.
  assert.equal(await run(`return document.activeElement?.closest('.worktrees-row')?.dataset.path === '/work/wt-pushed' && document.activeElement.textContent;`), "Open folder", "the keyboard stays in the row that was worked on");
  assert.equal((await buttonsOf("wt-pushed")).find((item) => item.text === "Merge into main").disabled, true, "nothing is left to merge");

  // Remove is two presses; a folder that holds uncommitted files asks once more, and keeps a copy.
  await run("window.worktreesFixture.clear();");
  await script("remove", [
    { ok: false, needsForce: true, dirty: 3, error: "Removing it would lose 3 uncommitted files. A copy is kept as a ref if you remove it anyway." },
    { ok: true, removed: true, name: "wt-dirty", rescued: "refs/mefi/rescue/wt-dirty-20260930T120000" },
  ]);
  assert.equal(await press("wt-dirty", "Remove"), true);
  assert.equal(await run(`return [...${rowOf("wt-dirty")}.querySelectorAll('button')].some((node) => node.textContent === 'Remove: click again');`), true, "the first press only arms it");
  assert.deepEqual(await calls("worktreesRemove"), [], "and nothing reached the host");
  assert.equal(await press("wt-dirty", "Remove: click again"), true);
  await until(`${rowOf("wt-dirty")}.querySelector('.worktrees-note')`, "the host's refusal reads under the row");
  assert.deepEqual((await calls("worktreesRemove")).map((call) => ({ path: call.path, force: call.force, deleteBranch: call.deleteBranch })), [{ path: "/work/wt-dirty", force: undefined, deleteBranch: false }]);
  const lose = await notes("wt-dirty");
  assert.equal(lose[0].tone, "warn");
  assert.match(lose[0].text, /would lose 3 uncommitted files/);
  assert.deepEqual(lose[0].choices, ["Remove and keep a copy"]);
  await setList(without("wt-dirty"));
  assert.equal(await press("wt-dirty", "Remove and keep a copy"), true);
  assert.equal(await run(`return ${rowOf("wt-dirty")} !== null;`), true, "the first press on the follow-up only arms it too");
  assert.equal(await press("wt-dirty", "Remove: click again"), true);
  await until(`${rowOf("wt-dirty")} === null`, "the removed row goes");
  assert.equal((await calls("worktreesRemove")).at(-1).force, true, "the second ask is forced");
  assert.match(await run("return document.getElementById('toast-host')?.textContent || '';"), /Removed wt-dirty\. A copy of what it held is kept as refs\/mefi\/rescue\/wt-dirty-20260930T120000\./);
  assert.equal(await run("return document.activeElement === document.getElementById('worktrees-refresh');"), true, "a row that went takes its focus to Refresh rather than to the page");

  // A merged run's folder goes with its branch (the host is asked for it); a plain branch keeps its branch.
  await run("window.worktreesFixture.clear();");
  await script("remove", [{ ok: true, removed: true, name: "run_4_1" }]);
  await setList(without("wt-dirty", "run_4_1"));
  assert.equal(await press("run_4_1", "Remove"), true);
  assert.equal(await press("run_4_1", "Remove: click again"), true);
  await until(`${rowOf("run_4_1")} === null`, "the merged run's row goes");
  assert.deepEqual((await calls("worktreesRemove")).map((call) => call.deleteBranch), [true], "a merged run's branch goes with it");

  // Forget: the sweep in the header and the row's own button reach the same host call.
  await run("window.worktreesFixture.clear();");
  await setList(without("wt-dirty", "run_4_1", "wt-gone"));
  await script("forget", [{ ok: true, pruned: 1 }]);
  await run("document.getElementById('worktrees-forget').click();");
  await until(`${rowOf("wt-gone")} === null && document.getElementById('worktrees-forget').hidden`, "the gone folder is forgotten and the sweep hides");
  assert.equal((await calls("worktreesForget")).length, 1);
  assert.match(await run("return document.getElementById('toast-host')?.textContent || '';"), /Forgot 1 missing folder\./);

  // The run switch reaches the host and stays where it was put.
  await run("window.worktreesFixture.clear();");
  await run("document.getElementById('worktrees-runs').click();");
  await until("window.worktreesFixture.calls().some((call) => call.name === 'workWorktrees')", "the switch reaches the host");
  assert.deepEqual((await run("return window.worktreesFixture.calls().filter((call) => call.name === 'workWorktrees').map((call) => call.args[0]);")), [true]);
  await run("document.getElementById('worktrees-refresh').click();");
  await until("window.worktreesFixture.calls().some((call) => call.name === 'worktreesList')", "a refresh reads again");
  await sleep(150);
  assert.equal(await run("return document.getElementById('worktrees-runs').checked;"), true, "the switch is on after the refresh");

  // The task a run belongs to opens from its row.
  await run("window.__went = []; window.__go = window.MefiNav.go; window.MefiNav.go = (...args) => { window.__went.push(args); };");
  await run(`${rowOf("run_5_1")}.querySelector('.worktrees-task-link').click();`);
  report.taskLink = await run("window.MefiNav.go = window.__go; return window.__went.map((args) => [args[0], args[1].taskId]);");
  assert.deepEqual(report.taskLink, [["tasks", "task_9"]]);

  // A repaint that would change nothing keeps the very same nodes, and the focus stays on its button.
  await run("window.worktreesFixture.clear();");
  await run(`window.__kept = ${rowOf("wt-pushed")}; ${rowOf("wt-pushed")}.querySelector('button').focus();`);
  await run("document.getElementById('worktrees-refresh').click();");
  await until("window.worktreesFixture.calls().some((call) => call.name === 'worktreesList')", "a second refresh reads");
  await sleep(150);
  assert.equal(await run(`return ${rowOf("wt-pushed")} === window.__kept;`), true, "an unchanged list keeps the same nodes");
  // A changed count repaints, and the focus comes back to the same button of the same row.
  await setList(withRow("wt-pushed", { behind: 5 }));
  await run("document.getElementById('worktrees-refresh').focus(); document.getElementById('worktrees-refresh').click();");
  await sleep(300);
  await run(`${rowOf("wt-pushed")}.querySelector('button').focus();`);
  await setList(withRow("wt-pushed", { behind: 6 }));
  await run("window.worktreesFixture.status({ projectId: 'project_fixture', enabled: true, execute: true, autoBuild: true, minutes: 5, parallel: 2, running: [{ id: 'run_9_1', title: 'A new run', startedAt: Date.now(), phase: 'building' }], history: [] });");
  await until(`${rowOf("wt-pushed")}.querySelector('.worktrees-meta').textContent.includes('6 behind')`, "a run starting reads the list again");
  assert.equal(await run(`return document.activeElement === ${rowOf("wt-pushed")}.querySelector('button');`), true, "the focus came back to the same button after the repaint");

  // Not a repository: one sentence, no rows, the switch cannot do anything.
  await setList({ ok: true, repo: false, projectId: "project_fixture", enabled: { on: false, forced: false } });
  await run("document.getElementById('worktrees-refresh').click();");
  await until("document.getElementById('worktrees-headline').textContent.startsWith('This project is not a Git repository')", "a project that is not a repository says so");
  assert.equal(await run("return document.querySelectorAll('#worktrees-list .worktrees-row').length;"), 0);
  assert.equal(await run("return document.getElementById('worktrees-runs').disabled;"), true);
  await capture("worktrees-no-repo.png");
  // One checkout only: the empty state explains what fills the page.
  await setList(listOf(rows().slice(0, 1)));
  await run("document.getElementById('worktrees-refresh').click();");
  await until("document.querySelector('#worktrees-list .worktrees-empty')", "a lone checkout explains itself");
  assert.match(await run("return document.querySelector('#worktrees-list .worktrees-empty').textContent;"), /^Only the main checkout so far\./);
  await capture("worktrees-alone.png");

  // Back leaves the page (through the nav's history, like every Work page).
  await run("document.getElementById('worktrees-close').click();");
  await until("!window.MefiWorktrees.isOpen()", "Back closes the page");
  assert.deepEqual(report.errors, [], "no console errors");
  report.calls = await run("return window.worktreesFixture.calls().map((call) => call.name);");
  report.complete = true;
  finish();
}).catch(finish);
