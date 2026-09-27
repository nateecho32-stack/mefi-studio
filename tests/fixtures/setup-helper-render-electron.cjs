"use strict";

// The setup helper in a real Chromium: every section opens, fits the window
// at a desktop and a phone-narrow width, keeps Tab inside the dialog, saves
// through the bridge and closes on Escape. No application main process or
// live state is loaded; network, permissions and child processes are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_SETUP_HELPER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated setup helper fixture directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], calls: [] };
app.setName("Setup Helper Fixture");
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

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url);
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const projectId = "setup-project";
  const configuration = { aiProvider: "auto", executorCli: "opencode", executorTier: "auto", aiAutoProviders: ["zai", "opencode"], agentBrain: { contextScout: true, deskTool: false } };
  const routing = { provider: "auto", roleProviders: {}, models: {}, providerModels: {}, hasZen: true, hasOpenCode: false, hasZai: false, hasOpenRouter: false, hasCustom: false, autoProviders: ["zai", "opencode"], autoFallback: false, subscriptionFirst: true, modelSelection: "jev", executorCli: "opencode", executorTier: "auto", executorTierDefaults: {}, lmStudioEndpoint: "http://127.0.0.1:1234/v1", customEndpoint: "", autoSetup: null };
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Setup trial", path: root }] },
    tasksList: { ok: true, projectId, tasks: [] }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: true, useReference: true, useTree: true, useWeb: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: { proactive: true, parallel: 8, aiParallel: 4, memoryAlign: true, loopGuard: true, loopGuardApply: true, compactHistory: true, keepAwake: true, background: true }, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, autoBuild: true, minutes: 5, parallel: 2, adaptiveParallel: true, mode: "swarm", running: [], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, draining: false, counts: {}, taskStates: [], next: [] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getAiRouting: routing, cliStatus: [], jevStatus: { enabled: true, route: "zen", routes: { vercel: false, typesafe: false, zen: true, openrouter: false } },
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [{ id: "preset-1", name: "Night shift", configuration }],
      skills: [{ id: "skill-1", name: "Test driven development", scope: "project" }], mcpTools: [{ id: "docs/search", server: "docs", name: "search", description: "Search fixture documentation" }],
      routing, seats: {}, choices: { lead: { provider: "zen", model: "gpt-6-sol", reason: "Selected seat route" } } },
    cliSetupStatus: { ok: true, selected: "auto", clis: [{ id: "codex", name: "Codex", installed: true, subscription: true }, { id: "claude", name: "Claude Code", installed: false, subscription: true }, { id: "grok", name: "Grok", installed: false }, { id: "antigravity", name: "Antigravity", installed: false }, { id: "opencode", name: "OpenCode", installed: true }] },
    firstRunStatus: { ok: true, firstRun: null },
    machineGet: { ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } },
    updateStatus: { ok: true, status: { auto: true } },
    companionState: { ok: true, projectId, projectName: "Setup trial", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: true, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: { grant: true, risk: true, "drop-owned": true, "agent-filed": true, "pricier-model": true, "real-world": true },
      categories: [{ id: "grant", label: "Granting reach", blurb: "Letting an agent touch more than its task allows." }, { id: "risk", label: "Irreversible changes", blurb: "Changes that may be difficult or impossible to undo." }], decisions: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
    openrouterModels: { ok: true, models: [] }, agentModels: { ok: true, models: [{ id: "gpt-6-sol" }] },
  };
  const preload = path.join(root, "setup-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const calls=[];
    const bridge=Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]]));
    const record=(name,result)=>async(...args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return typeof result==='function'?result(...args):result;};
    bridge.getApiKey=async which=>({saved:which==='zen',encrypted:true,via:which==='zen'?'settings':null});
    bridge.setApiKey=record('setApiKey',{ok:true});bridge.setAiRouting=record('setAiRouting',{ok:true});
    bridge.cliSetupCheck=record('cliSetupCheck',{ok:true,message:'Codex answered.'});bridge.cliSetupUse=record('cliSetupUse',{ok:true});bridge.cliSetupAction=record('cliSetupAction',{ok:true});
    bridge.agentsSave=record('agentsSave',payload=>{if(payload.revision!==responses.agentsState.revision)return {ok:false,stale:true,error:'stale'};Object.assign(responses.agentsState,{revision:payload.revision+1,configuration:payload.configuration});return responses.agentsState;});
    bridge.agentsPreset=record('agentsPreset',()=>responses.agentsState);
    bridge.assistantAutopilot=record('assistantAutopilot',patch=>{Object.assign(responses.assistantStatus.status,patch);return {ok:true,...responses.assistantStatus.status};});
    bridge.assistantControl=record('assistantControl',action=>{responses.assistantState.state.status=action==='pause'?'paused':'running';return {ok:true,state:responses.assistantState.state};});
    bridge.assistantPrefs=record('assistantPrefs',patch=>{Object.assign(responses.assistantState.state.prefs,patch);return {ok:true,state:responses.assistantState.state};});
    bridge.backlogControl=record('backlogControl',{ok:true});bridge.machineSet=record('machineSet',{ok:true});bridge.updateSet=record('updateSet',{ok:true});
    bridge.companionPrefs=record('companionPrefs',{ok:true});bridge.prefsSet=record('prefsSet',{ok:true});bridge.jevSetEnabled=record('jevSetEnabled',{ok:true});bridge.jevSetRoute=record('jevSetRoute',{ok:true});
    bridge.autonomySet=record('autonomySet',patch=>({...responses.autonomyState,...patch,ok:true}));bridge.learningSet=record('learningSet',{ok:true});
    for(const name of ['onTasks','onProjects','onAssistantStatus','onAssistant','onProjectPreview','onSettingsChanged','onStudioLog','onAutoSetup'])bridge[name]=()=>()=>{};
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('setupFixture',{calls:()=>calls});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "setup-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${label}`);
  };
  const capture = async (name) => {
    await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(120);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
  };
  const key = async (keyCode, modifiers = []) => { contents.sendInputEvent({ type: "keyDown", keyCode, modifiers }); contents.sendInputEvent({ type: "keyUp", keyCode, modifiers }); await sleep(40); };

  // A capture launch never opens the helper by itself (renderer/setup-helper.js).
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await until("window.MefiSetupHelper && !window.MefiBoot?.isActive?.()", "studio ready");
  report.autoOpened = await run("return window.MefiSetupHelper.isOpen();");
  const sections = await run("return window.MefiSetupHelper.sections().map(row=>row.id);");
  for (const [width, height] of [[1440, 900], [480, 820]]) {
    window.setContentSize(width, height); await sleep(200);
    for (const id of sections) {
      await run(`window.MefiSetupHelper.open(${JSON.stringify(id)});`);
      await until(`document.getElementById('setup-helper-content')?.dataset.section===${JSON.stringify(id)}&&!document.getElementById('setup-helper-content').hasAttribute('aria-busy')`, `section ${id} at ${width}`);
      const layout = await run(`const sheet=document.getElementById('setup-helper-sheet').getBoundingClientRect(),main=document.getElementById('setup-helper-main');
        return {id:${JSON.stringify(id)},width:innerWidth,fits:sheet.left>=0&&sheet.top>=0&&sheet.right<=innerWidth+1&&sheet.bottom<=innerHeight+1,
          pageOverflow:document.documentElement.scrollWidth>innerWidth+1,mainOverflow:main.scrollWidth>main.clientWidth+1,
          cards:document.querySelectorAll('#setup-helper-content > *').length,wide:[...main.querySelectorAll('*')].filter(node=>node.getBoundingClientRect().right>main.getBoundingClientRect().right+1).slice(0,4).map(node=>node.tagName+'.'+node.className+' '+Math.round(node.getBoundingClientRect().width)),title:document.getElementById('setup-helper-title').textContent,
          next:document.getElementById('setup-helper-next').textContent};`);
      report.layouts.push(layout);
      assert.ok(layout.fits, `${id} fits at ${width}px`);
      assert.equal(layout.pageOverflow, false, `${id} page overflow at ${width}px`);
      assert.equal(layout.mainOverflow, false, `${id} scrolls sideways at ${width}px: ${JSON.stringify(layout.wide)}`);
      assert.ok(layout.cards > 0, `${id} shows content`);
      if (width === 1440 || ["providers", "team", "run"].includes(id)) await capture(`setup-${width}-${id}.png`);
    }
  }
  window.setContentSize(1440, 900); await sleep(200);

  // Tab stays in the dialog; a switch saves through its host call; Esc closes.
  await run("window.MefiSetupHelper.open('run');");
  await until("document.getElementById('setup-helper-content')?.dataset.section==='run'&&!document.getElementById('setup-helper-content').hasAttribute('aria-busy')", "run section");
  await run("document.getElementById('setup-helper-close').focus();");
  report.tabTrail = [];
  for (let index = 0; index < 60; index += 1) { await key("Tab"); report.tabTrail.push(await run("const node=document.activeElement;return node?(node.tagName+(node.id?'#'+node.id:'')+'.'+String(node.className).slice(0,40)+(document.getElementById('setup-helper-sheet').contains(node)?'':' OUTSIDE')):'none';")); }
  report.focusTrapped = await run("return document.getElementById('setup-helper-sheet').contains(document.activeElement);");
  await run("const input=[...document.querySelectorAll('.setup-helper-toggle')].find(row=>row.textContent.includes('Compact finished history')).querySelector('input');input.click();");
  await until("window.setupFixture.calls().some(call=>call.name==='assistantPrefs')", "housekeeping save");
  await run("const input=[...document.querySelectorAll('.setup-helper-toggle')].find(row=>row.textContent.includes('Let workers ask the desk')).querySelector('input');input.click();");
  await until("window.setupFixture.calls().some(call=>call.name==='agentsSave')", "team save");
  report.calls = await run("return window.setupFixture.calls();");
  await key("Escape");
  await until("!window.MefiSetupHelper.isOpen()", "Escape closes the helper");
  report.closedByEscape = true;
  report.complete = true;
  finish();
}).catch(finish);
