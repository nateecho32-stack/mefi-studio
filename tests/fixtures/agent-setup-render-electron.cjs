"use strict";

// No application main process or live state is loaded. External navigation,
// permissions and child execution are blocked in this isolated renderer.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_AGENT_SETUP_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated workflow fixture directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], conversationLayouts: [] };
app.setName("Agent Setup Fixture");
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
  const now = Date.now(), projectId = "workflow-project";
  const fullTitle = "Validate Snake and launch a local preview. Preserve keyboard controls, mobile controls, collision rules and every existing test.";
  const task = { id: "snake", projectId, title: fullTitle, prompt: `${fullTitle}\nFULL_BRIEF_ACCEPTANCE: preserve every acceptance requirement even when the title is shortened.`, status: "active", runId: "snake-run", createdAt: now - 60000, updatedAt: now };
  const ready = { id: "ready", projectId, title: "Add a color theme", prompt: "Keep all game rules intact", status: "open", createdAt: now, updatedAt: now };
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Workflow trial", path: root }] },
    tasksList: { ok: true, projectId, tasks: [task, ready] }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: {}, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, execute: true, autoBuild: true, mode: "swarm", running: [{ taskId: "snake", runId: "snake-run", title: fullTitle, route: "Fixture builder", phase: "running", currentStep: "Bash running · checking the preview response", startedAt: now - 60000, lastOutputAt: now - 42000 }], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, counts: { ready: 1, running: 1, blocked: 0, review: 0 }, taskStates: [{ id: "snake", stage: "running", reason: "Worker running" }, { id: "ready", stage: "ready", reason: "Ready to start" }], next: [] },
    projectPreviewStatus: { ok: true, projectId, phase: "ready", available: true, kind: "static", url: "http://127.0.0.1:44173/", owned: true, canStop: true, message: "App preview is ready", logs: [], checkedAt: now },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
  };
  const routing = { provider: "zen", roleProviders: {}, models: { routine: "gpt-6-luna", heavy: "gpt-6-sol" }, providerModels: {}, hasZen: true, hasOpenCode: false, hasZai: false, hasOpenRouter: false, autoProviders: ["zen", "codex"], autoFallback: true, modelSelection: "fixed", executorCli: "codex", executorModels: {}, executorTierModels: {}, executorTier: "auto" };
  const configuration = { aiProvider: "zen", aiModels: routing.models, executorCli: "codex", agentBrain: { deskTool: false, headDrafts: false, nestedDelegation: false } };
  Object.assign(responses, {
    getApiKey: {saved:false}, getAiRouting: routing, cliStatus: [], launchStudio: {ok:true}, jevStatus: {ok:true,enabled:false}, openrouterModels: {ok:true,models:[{id:"openai/gpt-6-fixture",name:"GPT Fixture"},{id:"anthropic/claude-fixture",name:"Claude Fixture"}]},
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [], skills: [{id:"1234567890abcdef12345678",name:"Test driven development",scope:"project"}], routing, seats: { lead: { provider: "zen", model: "gpt-6-sol", effort: "medium", fast: false }, desk: { provider: "zen", model: "gpt-6-sol", effort: "medium", fast: false } }, efforts: ["minimal", "low", "medium", "high", "xhigh", "max"] },
    companionState: { ok: true, projectId, projectName: "Workflow trial", state: "working", look: "wisp", scope: "project", roaming: true, pinned: false, bubbles: true, growth: true, queue: { items: [], counts: { total: 0 } }, learning: { systems: 8, verifiedRecipes: 3 }, preferences: ["You usually choose to handle owner-only decisions yourself."], activity: Array.from({length:30},(_,i)=>({id:'event-'+i,kind:'work',at:Date.now()-i*10000,text:'Verified task '+i})) },
    companionWelcome: {ok:true}, companionSeen: {ok:true},
    brainState: {ok:true,tasks:[],recent:[]}, brainPlaybook: {ok:true,recipes:[]}, brainMap: {ok:true,map:{systems:[],edges:[],files:[]}},
  });
  // Exercise catalog search; short menus now use the shared compact tile picker.
  responses.openrouterModels.models.push(...Array.from({ length: 30 }, (_, index) => ({ id: "fixture/model-" + index, name: "Other model " + index })));
  responses.assistantStatus.status.enabled = true;
  const preload = path.join(root, "unified-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const listeners={},calls=[];
    const bridge=Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]]));
    for(const name of ['onTasks','onProjects','onAssistantStatus','onAssistant','onProjectPreview'])bridge[name]=fn=>{(listeners[name]??=[]).push(fn);return()=>{};};
    for(const name of ['tasksCreate','assistantChat'])bridge[name]=async value=>{calls.push({name,value});return {ok:true};};
    bridge.prefsSet=async patch=>({ok:true,prefs:Object.assign(responses.prefsGet.prefs,patch)});
    bridge.assistantWorkOn=async value=>{calls.push({name:'assistantWorkOn',value});return {ok:true,dispatch:{state:'queued',message:'This task is queued for its worker'}};};
    for(const name of ['projectPreviewStart','projectPreviewOpen','projectPreviewStop'])bridge[name]=async value=>{calls.push({name,value});return responses.projectPreviewStatus;};
    bridge.onStudioLog=()=>{};bridge.onAutoSetup=()=>{};
    bridge.agentsState=async payload=>({...responses.agentsState,projectId:responses.projectsList.activeId});
    bridge.agentsSave=async payload=>{calls.push({name:'agentsSave',value:payload});if(payload.revision!==responses.agentsState.revision)return {ok:false,stale:true,error:'Agent settings changed. Your draft has been kept.'};Object.assign(responses.agentsState,{revision:payload.revision+1,configuration:payload.configuration,name:payload.name,inherited:false});return responses.agentsState;};
    bridge.companionPrefs=async patch=>{calls.push({name:'companionPrefs',value:patch});Object.assign(responses.companionState,patch);return {ok:true};};
    bridge.assistantAutopilot=async patch=>{calls.push({name:'assistantAutopilot',value:patch});Object.assign(responses.assistantStatus.status,patch);return {ok:true,...responses.assistantStatus.status};};
    bridge.assistantControl=async action=>{calls.push({name:'assistantControl',value:action});responses.assistantState.state.status=action==='pause'?'paused':'running';return {ok:true,state:responses.assistantState.state};};
    bridge.assistantPrefs=async patch=>{calls.push({name:'assistantPrefs',value:patch});Object.assign(responses.assistantState.state.prefs,patch);return {ok:true,state:responses.assistantState.state};};
    contextBridge.exposeInMainWorld('unifiedFixture',{calls:()=>calls,update:()=>{responses.companionState.state='needs-you';for(const fn of listeners.onAssistant||[])fn({state:responses.assistantState.state});},stale:()=>responses.agentsState.revision++,project:id=>{responses.projectsList.activeId=id;for(const fn of listeners.onProjects||[])fn(responses.projectsList);},fail:()=>{responses.agentsState.ok=false;responses.agentsState.error='Fixture connection unavailable';}});
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('workflowFixture',{calls:()=>calls,conversation:count=>{
      responses.assistantState.state.messages=Array.from({length:count},(_,index)=>({id:'message-'+index,projectId:'workflow-project',role:index%2?'assistant':'user',at:Date.now()-(count-index)*60000,text:index%2?'I checked the keyboard controls and collision rules. The preview is available while the worker finishes its remaining checks. Keep the existing game behavior and report the recorded test results.':'Please check the Snake game behavior, including keyboard movement, wall collisions and restarting. Keep the preview available while you work and explain the current step.'}));
      for(const fn of listeners.onAssistant||[])fn({state:responses.assistantState.state});
    },needsAttention:()=>{
      responses.assistantState.state.questions=[{id:'theme-decision',status:'open',title:'Choose a theme',question:'Which palette should the next change use?',at:Date.now(),context:{taskId:'ready'},choices:[{id:'sage',label:'Sage',recommended:true}]}];
      for(const fn of listeners.onAssistant||[])fn({state:responses.assistantState.state});
    },complete:()=>{
      const task=responses.tasksList.tasks[0];task.status='done';delete task.runId;task.verification={state:'verified',reason:'21 rule tests passed'};task.verificationRun={state:'passed',results:[{ok:true,command:'npm run check',cwd:${JSON.stringify(root)}}]};
      responses.assistantStatus.status.running=[];responses.assistantStatus.status.execute=false;responses.assistantStatus.status.held=true;
      responses.backlogStatus.paused=true;responses.backlogStatus.counts.running=0;responses.backlogStatus.taskStates[0]={id:'snake',stage:'done',reason:'Verified'};
      for(const fn of listeners.onTasks||[])fn(responses.tasksList.tasks);for(const fn of listeners.onAssistantStatus||[])fn(responses.assistantStatus.status);
    }});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, label) => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); } report.lastState = await run("return {route:window.MefiNav?.current?.(),focus:document.getElementById('workspace-focus-panel')?.textContent,preview:document.getElementById('workspace-preview-panel')?.textContent,task:document.getElementById('task-title')?.textContent};"); fs.writeFileSync(path.join(root, "workflow-failure.png"), (await contents.capturePage()).toPNG()); throw new Error(`Timed out: ${label}`); };
  const capture = async (name) => {
    await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(120);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
  };
  const reachable = async (selector) => run(`const element=document.querySelector(${JSON.stringify(selector)});if(!element||element.hidden||element.disabled)return false;element.scrollIntoView({block:'center',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(resolve));const rect=element.getBoundingClientRect();const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return rect.width>0&&rect.height>0&&rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=0&&rect.bottom<=innerHeight+1&&(hit===element||element.contains(hit));`);
  const composerBounds = async () => run("const form=document.getElementById('workspace-form'),rect=form.getBoundingClientRect();const controls=['workspace-input','workspace-send'].every(id=>{const node=document.getElementById(id),box=node.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return box.width>0&&box.height>0&&box.top>=0&&box.bottom<=innerHeight+1&&(hit===node||node.contains(hit));});return {top:rect.top,bottom:rect.bottom,gap:innerHeight-rect.bottom,visible:rect.top>=0&&rect.bottom<=innerHeight+1&&rect.left>=0&&rect.right<=innerWidth+1,controls};");

  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await until("window.MefiAgents", "Agents startup");
  await run("await window.MefiNav.go('agents',{section:'setup',pane:'team'});");
  await until("document.getElementById('agent-companion-provider')", "Agent rows");
  const click = async (selector) => {
    assert.ok(await reachable(selector), selector + ' reachable');
    const point = await run(`const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
    contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point}); await sleep(70);
  };
  await click('#agent-companion-provider');
  assert.equal(await run("return document.querySelectorAll('#agent-companion-providers .agents-provider-option').length;"),11);
  await capture('agent-providers.png');
  await click('#agent-companion-providers [data-provider=zen]');
  assert.equal(await run("return window.MefiAgents.draft().agentSeats?.companion;"),undefined);
  await click('#agent-companion-provider');
  await click('#agent-companion-providers [data-provider=openrouter]');
  await until("[...document.getElementById('agent-companion-model').options].some(o=>o.value==='openai/gpt-6-fixture')",'live model list');
  await click('#agent-companion-model-choice');
  await until("document.querySelector('.studio-choice-search')", 'model search menu');
  await run("const s=document.querySelector('.studio-choice-search');s.value='GPT Fixture';s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));");
  assert.equal(await run("return document.getElementById('agent-companion-model').value;"),'openai/gpt-6-fixture');
  await run("const e=document.querySelector('[aria-label=\"companion reasoning effort\"]');e.value='high';e.dispatchEvent(new Event('change',{bubbles:true}));");
  assert.equal(await run("return document.querySelector('[aria-label=\"companion fast mode\"]').disabled;"),true);
  await click('#agent-companion-add');
  await click('#agent-companion-addons input[type=checkbox]');
  assert.ok(await run("return window.MefiAgents.draft().agentSkills.companion.includes('1234567890abcdef12345678');"));
  assert.equal(await run("return window.MefiAgents.draft().agentSkills.desk;"),undefined);
  await capture('agent-addons.png');
  await run("document.querySelector('#agents-save-bar .primary').click();");
  await until("document.getElementById('agents-save-status').textContent.startsWith('Saved')",'apply draft');
  await run("window.MefiAgents.reload();");
  await until("document.getElementById('agent-companion-model')?.value==='openai/gpt-6-fixture'",'persisted model');
  assert.equal(await run("return window.MefiAgents.draft().agentSeats.companion.effort;"),'high');
  // Switching a provider cannot carry the previous provider's model; switching
  // back restores it even after saving and reloading the project team.
  await click('#agent-companion-provider'); await click('#agent-companion-providers [data-provider=zen]');
  assert.equal(await run("return document.getElementById('agent-companion-model').value;"),'gpt-6-luna');
  await click('#agent-companion-provider'); await click('#agent-companion-providers [data-provider=openrouter]');
  assert.equal(await run("return document.getElementById('agent-companion-model').value;"),'openai/gpt-6-fixture');
  await run("const m=document.getElementById('agent-companion-model');m.value='__custom';m.dispatchEvent(new Event('change',{bubbles:true}));const c=document.querySelector('[aria-label=\"companion custom model ID\"]');c.value='vendor/new-model';c.dispatchEvent(new Event('change',{bubbles:true}));");
  assert.equal(await run("return window.MefiAgents.draft().agentSeats.companion.model;"),'vendor/new-model');
  await click('#agent-builder-provider'); await click('#agent-builder-providers [data-provider=claude]');
  await click('#agent-builder-add'); await click('#agent-builder-addons > .studio-field input');
  assert.equal(await run("return window.MefiAgents.draft().agentBrain.deskTool;"),true);
  // Adding MCP on the worker must not start any work during setup.
  assert.ok(await run("return !window.unifiedFixture.calls().some(c=>['assistantControl','assistantAutopilot'].includes(c.name));"));
  // Editing Auto on one role must not change the other role's inherited route.
  await click('#agent-routine-provider'); await click('#agent-routine-providers [data-provider=auto]');
  assert.equal(await run("return window.MefiAgents.draft().aiProvider;"),'zen');
  await run("await window.MefiNav.go('agents',{section:'setup',pane:'connections'});await window.MefiNav.back();");
  assert.equal(await run("return window.MefiAgents.draft().agentSeats.companion.model;"),'vendor/new-model');
  report.draftRetained=true; report.noStartOnSetup=true; report.stableMenu=true;
  await run("window.unifiedFixture.stale();document.querySelector('#agents-save-bar .primary').click();");
  await until("document.getElementById('agents-save-status').textContent.includes('changed')",'stale save refused');
  for (const [width,height] of [[1920,1080],[1440,900],[1100,720],[600,600]]) for (const zoom of [1,1.25,1.5]) {
    window.setContentSize(width,height); contents.setZoomFactor(zoom); await sleep(70);
    // Resizing and zooming reach the renderer asynchronously on Windows.
    // Measure the requested viewport, not the previous loop's layout.
    await until(`Math.abs(innerWidth-${width / zoom})<=2 && Math.abs(innerHeight-${height / zoom})<=2`, `viewport ${width}×${height} at ${zoom}`);
    await run("await window.MefiNav.go('agents',{section:'setup',pane:'team'});document.getElementById('agents-body').scrollTop=0;");
    const layout=await run("const body=document.getElementById('agents-body');return {width:innerWidth,overflow:body.scrollWidth>body.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1,wide:[...body.querySelectorAll('*')].filter(e=>e.getClientRects().length && e.getBoundingClientRect().right>body.getBoundingClientRect().right+1).slice(0,12).map(e=>({id:e.id,cls:e.className,width:e.getBoundingClientRect().width}))};");
    report.layouts.push({width,height,zoom,...layout}); if(layout.overflow) await capture('agent-overflow.png'); assert.equal(layout.overflow,false,JSON.stringify(report.layouts.at(-1)));
    assert.ok(await reachable('#agent-companion-provider')); assert.ok(await reachable('#agent-companion-add'));
    if(zoom===1) { await run("document.getElementById('agents-body').scrollTop=0;"); await capture('agent-team-'+width+'.png'); }
  }
  assert.deepEqual(report.errors,[]); report.complete=true; finish();
}).catch(finish);
