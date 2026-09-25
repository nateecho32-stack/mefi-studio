"use strict";

// No application main process or live state is loaded. External navigation,
// permissions and child execution are blocked in this isolated renderer.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_UNIFIED_RENDER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated workflow fixture directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], conversationLayouts: [] };
app.setName("Unified Studio Fixture");
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
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Workflow trial", path: root }, { id: "second-project", name: "Second project", path: root + "/second" }] },
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
    getApiKey: {saved:false}, getAiRouting: routing, cliStatus: [], launchStudio: {ok:true}, jevStatus: {ok:true,enabled:false}, openrouterModels: {ok:true,models:[]},
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [], routing, seats: { lead: { provider: "zen", model: "gpt-6-sol", effort: "medium", fast: false }, desk: { provider: "zen", model: "gpt-6-sol", effort: "medium", fast: false } }, efforts: ["minimal", "low", "medium", "high", "xhigh", "max"] },
    companionState: { ok: true, projectId, projectName: "Workflow trial", state: "working", look: "wisp", scope: "project", roaming: true, pinned: false, bubbles: true, growth: true, queue: { items: [], counts: { total: 0 } }, learning: { systems: 8, verifiedRecipes: 3 }, preferences: ["You usually choose to handle owner-only decisions yourself."], activity: Array.from({length:30},(_,i)=>({id:'event-'+i,kind:'work',at:Date.now()-i*10000,text:'Verified task '+i})) },
    companionWelcome: {ok:true}, companionSeen: {ok:true},
    brainState: {ok:true,tasks:[],recent:[],pipelines:{snake:{taskId:"snake",summary:{done:0,total:1},steps:[{id:"build",title:"Implement the task",status:"queued",parents:[]}]}}},
    brainPlaybook: {ok:true,shelf:[{id:"verified",name:"Verified workflow",runs:2,thickness:1}],recipes:[{id:"verified",name:"Verified workflow",runs:2,steps:[{title:"Build",kind:"build"},{title:"Verify",kind:"verify"}]}]},
    brainMap: {ok:true,map:{systems:Array.from({length:18},(_,i)=>({id:"region-"+i,name:"Region "+i,path:"region-"+i+"/",fileCount:12,tasks:{done:2,active:0,open:0},files:Array.from({length:12},(_,j)=>({path:"region-"+i+"/core/file-"+j+".js",present:true,edits:1}))})),edges:[],files:[]}},
  });
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
    bridge.agentsState=async payload=>({...responses.agentsState,projectId:responses.projectsList.activeId,...(responses.projectsList.activeId==='second-project'?{name:'Second project team',inherited:false}:{})});
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
  // Offscreen windows have no OS visibility. Exercise foreground interaction
  // explicitly, then dispatch the hidden state separately below.
  await run("Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));");
  await until("window.MefiAgents && window.MefiCompanionUI?.managed()", "unified startup");
  await run("await window.MefiNav.go('agents');");
  await until("!document.getElementById('agents-overlay').hidden", "Agents overview");
  await capture("unified-overview.png");
  // Native pointer travel must reveal children without navigating or shifting content.
  await run("await window.MefiNav.go('command');");
  const navState = () => run("return {route:window.MefiNav.current(),open:[...document.querySelectorAll('.agents-nav-subsections')].filter(el=>!el.hidden).map(el=>el.id),height:document.getElementById('app-local-nav').getBoundingClientRect().height};");
  const pointAt = (selector) => run(`const box=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};`);
  assert.deepEqual((await navState()).open,[]);
  const navHeight = (await navState()).height;
  assert.ok(navHeight<=64,'children do not reserve a second row');
  await capture('glass-command.png');
  contents.sendInputEvent({type:'mouseMove',...await pointAt('[data-agent-section=setup]')});
  await until("document.querySelector('[data-agent-section=setup]').getAttribute('aria-expanded')==='true'",'setup hover');
  assert.equal((await navState()).route,'command','hover does not navigate');
  const menuBox = await run("const b=document.getElementById('agents-menu-setup').getBoundingClientRect();return {x:Math.round(b.x+20),y:Math.round(b.y-3)};");
  contents.sendInputEvent({type:'mouseMove',...menuBox}); await sleep(260);
  assert.deepEqual((await navState()).open,['agents-menu-setup'],'connecting gap remains interactive');
  contents.sendInputEvent({type:'mouseMove',...await pointAt('#agents-menu-setup button:nth-child(2)')}); await sleep(260);
  assert.equal((await navState()).height,navHeight);
  await capture('glass-navigation-hover.png');
  const providerPoint = await pointAt('#agents-menu-setup button:nth-child(2)');
  contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...providerPoint}); contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...providerPoint});
  await until("window.MefiAgents.params().pane==='connections' && !document.getElementById('agents-overlay').hidden",'child selection');
  assert.deepEqual((await navState()).open,[]);
  contents.sendInputEvent({type:'mouseMove',...await pointAt('[data-agent-section=live]')});
  await until("!document.getElementById('agents-menu-live').hidden",'live hover');
  contents.sendInputEvent({type:'mouseMove',x:1100,y:400});
  await until("document.getElementById('agents-menu-live').hidden",'leaving dismisses children');
  assert.deepEqual((await navState()).open,[],'leaving dismisses children');
  await run("const parent=document.querySelector('[data-agent-section=live]');parent.focus();parent.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));");
  assert.equal(await run("return document.activeElement.textContent;"),'Command');
  await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));");
  assert.equal(await run("return document.activeElement.textContent;"),'Overhead');
  await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");
  assert.deepEqual((await navState()).open,[]);
  assert.equal(await run("return document.activeElement.dataset.agentSection;"),'live');
  assert.equal((await navState()).route,'agents','Escape only closes the menu');
  await run("document.querySelector('[data-agent-section=models]').click();");
  assert.deepEqual((await navState()).open,['agents-menu-models'],'click also opens children');
  contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:1100,y:400}); contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:1100,y:400});
  await until("document.getElementById('agents-menu-models').hidden",'outside click dismisses');
  assert.deepEqual((await navState()).open,[],'outside click dismisses');
  await run("await window.MefiNav.go('tasks');await window.MefiNav.go('agents',{section:'setup',pane:'connections'});");
  assert.ok(await run("return !!document.querySelector('[data-agent-section=live]');"),'navigation survives leaving and returning to Agents');
  report.hoverNavigation=true;
  await run("await window.MefiNav.go('agents',{section:'setup',pane:'team'});");
  await until("document.querySelector('#agents-role-grid input')", "team configuration");
  await capture("unified-team.png");
  await run("const name=document.getElementById('agents-team-name');name.value='My independent team';name.dispatchEvent(new Event('input',{bubbles:true}));await window.MefiNav.go('agents',{section:'setup',pane:'behavior'});await window.MefiNav.back();");
  report.draftRetained = await run("return window.MefiAgents.params().pane==='team' && document.getElementById('agents-team-name').value==='My independent team';"); assert.ok(report.draftRetained);
  await run("await window.MefiNav.forward();");
  assert.equal(await run("return window.MefiAgents.params().pane;"), "behavior");
  await run("await window.MefiNav.go('agents',{section:'setup',pane:'routing'});");
  assert.equal(await run("return window.MefiNav.historyState().canForward;"),false);
  report.noStartOnSetup = await run("return !window.unifiedFixture.calls().some(call=>['assistantControl','assistantAutopilot'].includes(call.name));"); assert.ok(report.noStartOnSetup);
  await run("window.MefiCompanion.open();");
  assert.ok(await run("return window.MefiCompanionUI.tab()==='ask' && !document.getElementById('companion-pane-ask').hidden && !!document.querySelector('#companion-pane-ask textarea');"));
  await run("document.querySelector('[data-companion-tab=team]').click();");
  await until("!document.getElementById('companion-pane-team').hidden", "companion team hub");
  await run("document.querySelector('[data-companion-tab=settings]').click();");
  await until("!document.getElementById('companion-panel').hidden", "assistant settings");
  report.stableMenu = await run("const field=document.querySelector('[data-companion-setting=roaming]');field.focus();window.unifiedFixture.update();await window.MefiCompanion.refresh();return field===document.activeElement&&field.isConnected;"); assert.ok(report.stableMenu);
  await sleep(420);
  assert.ok(await run("const box=document.getElementById('companion-panel').getBoundingClientRect();return !document.getElementById('companion-panel').hidden&&box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight;"));
  await capture("unified-companion.png");
  await run("window.MefiCompanion.close();");
  // Real pointer movement covers the dwell, connecting margin and delayed dismissal.
  const orb = await run("const box=document.getElementById('companion-orb').getBoundingClientRect();return {x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};");
  contents.sendInputEvent({type:'mouseMove',...orb}); await until("!document.getElementById('companion-panel').hidden", "hover dwell opens the menu");
  assert.equal(await run("return document.getElementById('companion-panel').hidden;"),false,'hover opens');
  const panel = await run("const box=document.getElementById('companion-panel').getBoundingClientRect();return {x:Math.round(box.x+box.width/2),y:Math.round(box.y+20)};");
  contents.sendInputEvent({type:'mouseMove',...panel}); await sleep(320);
  assert.equal(await run("return document.getElementById('companion-panel').hidden;"),false,'hover corridor keeps menu');
  contents.sendInputEvent({type:'mouseMove',x:1300,y:40}); await sleep(380);
  assert.equal(await run("return document.getElementById('companion-panel').hidden;"),true,'leaving the region dismisses');
  report.hover=true;
  await run("window.MefiCompanion.open();const input=document.querySelector('#companion-pane-ask textarea');input.value='Keep this unfinished message';input.focus();");
  contents.sendInputEvent({type:'mouseMove',x:1300,y:40}); await sleep(420);
  assert.equal(await run("return !document.getElementById('companion-panel').hidden&&document.querySelector('#companion-pane-ask textarea').value==='Keep this unfinished message';"),true,'editing keeps the menu open');
  await run("document.querySelector('[data-companion-tab=settings]').click();const select=document.querySelector('[data-companion-setting=look]');select.nextElementSibling.click();"); await sleep(80);
  const nested=await run("const r=document.querySelector('.studio-choice-popup').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+15)};");
  contents.sendInputEvent({type:'mouseMove',...nested}); await sleep(400);
  assert.equal(await run("return !document.getElementById('companion-panel').hidden;"),true,'nested dropdown belongs to the hover area');
  await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");
  assert.equal(await run("return !document.querySelector('.studio-choice-popup')&&!document.getElementById('companion-panel').hidden;"),true,'Escape closes dropdown before companion');
  await run("window.MefiCompanion.close();document.activeElement.blur();");
  const beforeDrag=await run("const r=document.getElementById('companion-orb').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};");
  contents.sendInputEvent({type:'mouseMove',...beforeDrag});
  contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...beforeDrag});
  contents.sendInputEvent({type:'mouseMove',x:beforeDrag.x+130,y:beforeDrag.y-120});
  contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:beforeDrag.x+130,y:beforeDrag.y-120}); await sleep(120);
  assert.ok(await run("return window.unifiedFixture.calls().some(call=>call.name==='companionPrefs'&&call.value.pinned===true&&call.value.anchor.x>0);"),'drag pins the saved position');
  await run("Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));");
  assert.equal(await run("return document.getElementById('companion-orb').hasAttribute('data-suspended');"),true,'hidden window suspends the companion');
  await run("Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));await window.mefiStudio.companionPrefs({pinned:false,roaming:false});await window.MefiCompanion.refresh();");
  assert.equal(await run("return document.getElementById('companion-orb').hasAttribute('data-roaming');"),false,'roaming off returns the companion to its dock');
  report.companionInteractions=true;
  // A clear edge permits roaming; reduced motion and a position pin suspend it.
  contents.debugger.attach('1.3');
  await contents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await run("window.MefiCompanion.close();document.activeElement.blur();document.documentElement.dataset.motion='on';document.body.classList.remove('ws-still','no-motion');const clear=document.createElement('style');clear.id='fixture-clear-edges';clear.textContent='body > *:not(#companion-orb):not(#studio-floats) { visibility:hidden!important }';document.head.append(clear);await window.mefiStudio.companionPrefs({pinned:false,roaming:true});await window.MefiCompanion.refresh();");
  contents.sendInputEvent({type:'mouseMove',x:500,y:60});
  await until("document.getElementById('companion-orb').hasAttribute('data-roaming')",'roaming reaches a clear edge');
  await run("window.MefiCompanionUI.freeze();await window.mefiStudio.companionPrefs({pinned:true});await window.MefiCompanion.refresh();");
  assert.equal(await run("return document.getElementById('companion-orb').getAnimations().filter(animation=>animation.playState==='running'&&animation.effect.getKeyframes().some(frame=>frame.transform)).length;"),0,'pinning stops position animation');
  await run("document.getElementById('fixture-clear-edges').remove();await window.mefiStudio.companionPrefs({pinned:false,roaming:false});await window.MefiCompanion.refresh();");
  await contents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]}); contents.debugger.detach();
  report.roaming=true;
  await run("await window.MefiNav.go('agents',{section:'setup',pane:'team'});const select=document.createElement('select');select.id='fixture-long-select';select.setAttribute('aria-label','Long options');for(let i=0;i<120;i++)select.add(new Option('Option '+i,String(i)));document.getElementById('agents-team').prepend(select);window.MefiSelect.enhance(select);document.getElementById('agents-body').scrollTop=0;document.getElementById('fixture-long-select-choice').click();");
  await sleep(100);
  assert.equal(await run("return document.querySelector('.studio-choice-list').scrollHeight>document.querySelector('.studio-choice-list').clientHeight;"),true);
  await run("const search=document.querySelector('.studio-choice-search');search.value='Option 119';search.dispatchEvent(new Event('input',{bubbles:true}));search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));");
  assert.equal(await run("return document.getElementById('fixture-long-select').value;"),'119');
  await run("document.getElementById('fixture-long-select-choice').click();document.querySelector('.studio-choice-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");
  assert.equal(await run("return Boolean(document.querySelector('.studio-choice-popup'));"),false);
  report.dropdown=true;
  // Compact choices retain native values and keyboard behavior across groups.
  await run("const select=document.createElement('select');select.id='fixture-tile-select';select.setAttribute('aria-label','Effort');for(let i=0;i<3;i++)select.add(new Option('Level '+i,String(i)));select.options[1].disabled=true;const group=document.createElement('optgroup');group.label='Advanced';for(let i=3;i<6;i++)group.append(new Option('Level '+i,String(i)));select.append(group);document.getElementById('agents-team').prepend(select);window.MefiSelect.enhance(select);document.getElementById('fixture-tile-select-choice').click();");
  await sleep(100);
  const tileLayout = await run("const popup=document.querySelector('.studio-choice-popup'),list=popup.querySelector('.studio-choice-list'),rows=[...popup.querySelectorAll('.studio-choice-option')];return {layout:popup.dataset.layout,scroll:list.scrollHeight-list.clientHeight,firstRow:rows.slice(0,3).map(row=>row.getBoundingClientRect().top),group:popup.querySelector('[role=group]').getAttribute('aria-label')};");
  assert.equal(tileLayout.layout,'tiles'); assert.ok(tileLayout.scroll<=2); assert.equal(new Set(tileLayout.firstRow).size,1); assert.equal(tileLayout.group,'Advanced');
  const choiceKey = async (key) => run(`const button=document.getElementById('fixture-tile-select-choice');button.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}));return document.querySelector('.studio-choice-option.highlighted')?.textContent;`);
  assert.equal(await choiceKey('ArrowRight'),'Level 2','disabled tiles are skipped');
  assert.equal(await choiceKey('ArrowDown'),'Level 5','Down follows the visual column across a group heading');
  assert.equal(await choiceKey('ArrowUp'),'Level 2');
  assert.equal(await choiceKey('ArrowLeft'),'Level 0');
  assert.equal(await choiceKey('End'),'Level 5');
  await choiceKey('Enter');
  assert.equal(await run("return document.getElementById('fixture-tile-select').value;"),'5');
  assert.equal(await run("return document.activeElement.id;"),'fixture-tile-select-choice');
  await run("const select=document.getElementById('fixture-tile-select');select.querySelector('optgroup').disabled=true;document.getElementById('fixture-tile-select-choice').click();");
  assert.equal(await choiceKey('End'),'Level 2','disabled groups are skipped');
  await choiceKey('Escape');
  await run("document.getElementById('fixture-long-select-choice').click();const search=document.querySelector('.studio-choice-search');search.value='No such option';search.dispatchEvent(new Event('input',{bubbles:true}));");
  assert.equal(await run("return document.querySelector('.studio-choice-search').hasAttribute('aria-activedescendant');"),false,'empty search has no stale active option');
  await run("window.MefiSelect.close();document.getElementById('fixture-tile-select').remove();");
  report.compactChoices=true;
  await run("document.getElementById('agents-body').scrollTop=0;window.MefiScroll.refresh();"); await sleep(80);
  assert.ok(await run("const hint=[...document.querySelectorAll('.studio-scroll-hint')].find(el=>el.dataset.scrollOwner==='agents-body');return hint&&!hint.hidden&&!hint.querySelector('[data-direction=down]').hidden&&hint.querySelector('[data-direction=up]').hidden;"));
  await run("[...document.querySelectorAll('.studio-scroll-hint')].find(el=>el.dataset.scrollOwner==='agents-body').querySelector('[data-direction=down]').click();"); await sleep(120);
  assert.ok(await run("return document.getElementById('agents-body').scrollTop>100;"));
  report.overflow=true;
  // Keyboard and pointer holds use the same real overflow region as wheel/touch.
  await run("const body=document.getElementById('agents-body');body.scrollTop=0;body.focus();");
  contents.sendInputEvent({type:'keyDown',keyCode:'PageDown'}); contents.sendInputEvent({type:'keyUp',keyCode:'PageDown'}); await sleep(250);
  assert.ok(await run("return document.getElementById('agents-body').scrollTop>0;"),'keyboard scrolling remains native');
  const down = await run("document.getElementById('agents-body').scrollTop=0;window.MefiScroll.refresh();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const hint=[...document.querySelectorAll('.studio-scroll-hint')].find(el=>el.dataset.scrollOwner==='agents-body'),r=hint.querySelector('[data-direction=down]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};");
  contents.sendInputEvent({type:'mouseMove',...down}); await sleep(100);
  contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...down}); await sleep(680);
  contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...down}); await sleep(80);
  const heldTop=await run("return document.getElementById('agents-body').scrollTop;"); assert.ok(heldTop>80,'holding an arrow continues scrolling');
  await sleep(220); assert.equal(await run("return document.getElementById('agents-body').scrollTop;"),heldTop,'releasing the arrow stops it');
  await run("const body=document.getElementById('agents-body');body.scrollTop=body.scrollHeight;window.MefiScroll.refresh();");
  await until("[...document.querySelectorAll('.studio-scroll-hint')].find(el=>el.dataset.scrollOwner==='agents-body').querySelector('[data-direction=down]').hidden",'boundary removes the down arrow');
  report.keyboardAndHold=true;
  await run("window.unifiedFixture.stale();document.querySelector('#agents-save-bar .primary').click();");await sleep(100);
  assert.ok(await run("return document.getElementById('agents-save-status').textContent.includes('changed')&&document.getElementById('agents-team-name').value==='My independent team';"));
  report.staleDraft=true;
  // Small workflow views expose one pane and an explicit return. The map
  // fits a fixed viewport and retains pan/zoom instead of nesting scroll areas.
  window.setContentSize(600,560); contents.setZoomFactor(1.5); await sleep(100);
  await run("await window.MefiNav.go('agent-brain',{tab:'map'});");
  await until("document.querySelectorAll('#agent-brain-map .ab-index-item').length===18",'populated project map');
  await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));"); await sleep(160);
  await capture('unified-map-600.png');
  assert.ok(await run("const pane=document.getElementById('agent-brain-map'),stage=pane.querySelector('.agent-brain-map-stage');return getComputedStyle(pane).overflowY==='hidden'&&stage.clientHeight>35&&stage.scrollHeight<=stage.clientHeight+2;"),'map has one bounded viewport');
  const keyboardCamera = await run("return window.MefiAgentBrain.mapState().camera.y;");
  await run("document.getElementById('agent-brain-map-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true}));");
  await until("!window.MefiAgentBrain.mapState().moving", 'keyboard camera settles');
  assert.notEqual(await run("return window.MefiAgentBrain.mapState().camera.y;"), keyboardCamera, 'keyboard pans the map');
  const fitted = await run("const canvas=document.getElementById('agent-brain-map-canvas');canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));return document.querySelector('.ab-map-zoom').value;");
  await run("const zoom=document.querySelector('.ab-map-zoom');zoom.value='150';zoom.dispatchEvent(new Event('input',{bubbles:true}));");
  assert.equal(await run("return document.querySelector('.ab-map-zoom').value;"),'150');
  await run("document.getElementById('agent-brain-map-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));");
  assert.equal(await run("return document.querySelector('.ab-map-zoom').value;"),fitted,'Fit restores the overview');
  await run("document.querySelector('#agent-brain-map .ab-index-item[data-id=\"region-0\"]').click();");
  assert.ok(await reachable('#agent-brain-map .ab-narrow-open'));
  await run("document.querySelector('#agent-brain-map .ab-narrow-open').click();");
  assert.ok(await reachable('#agent-brain-map .ab-narrow-back'));
  assert.ok(await run("return !document.querySelector('.agent-brain-map-stage').getClientRects().length&&document.getElementById('agent-brain-map-detail').getClientRects().length>0;"));
  await run("document.querySelector('#agent-brain-map .ab-narrow-back').click();");
  await sleep(60);
  for (const [tab,selector] of [['live','#agent-brain-list .ab-pipe'],['playbook','#agent-brain-shelf .ab-book']]) {
    await run(`await window.MefiNav.go('agent-brain',{tab:${JSON.stringify(tab)}});`);
    await until(`document.querySelector(${JSON.stringify(selector)})`,tab+' list');
    await run(`document.querySelector(${JSON.stringify(selector)}).click();`);
    assert.ok(await reachable('#agent-brain-'+tab+' .ab-narrow-back'));
    await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");
    assert.equal(await run(`return document.getElementById('agent-brain-${tab}').dataset.detail;`),'false');
    assert.equal(await run("return window.MefiNav.current();"),'agent-brain');
  }
  report.workflowPanes=true;
  window.setContentSize(1440,900); contents.setZoomFactor(1); await sleep(80);
  await run("document.getElementById('fixture-long-select').remove();");
  const routes = [['agents',{section:'setup',pane:'connections'}],['agents',{section:'setup',pane:'team'}],['agents',{section:'setup',pane:'routing'}],['agents',{section:'setup',pane:'behavior'}],['command',{}],['agent-brain',{tab:'live'}],['explorer',{}],['eyes',{}],['overhead',{}],['brains',{}],['agent-brain',{tab:'playbook'}],['agent-brain',{tab:'map'}],['context',{}],['booklet',{}],['graph',{}],['usage',{}],['studio',{category:'appearance'}],['tasks',{}],['plans',{}],['ideas',{}],['analyzer',{}]];
  for (const [id,params] of routes) {
    await run(`await window.MefiNav.go(${JSON.stringify(id)},${JSON.stringify(params)});await new Promise(resolve=>setTimeout(resolve,80));`);
    const bars=await run("return [...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&!el.closest('[hidden]')&&/(auto|scroll)/.test(getComputedStyle(el).overflowY+' '+getComputedStyle(el).overflowX)).filter(el=>getComputedStyle(el).scrollbarWidth!=='none').map(el=>el.id||el.className);");
    assert.deepEqual(bars,[],id); assert.deepEqual(report.errors,[],id+': '+JSON.stringify(report.errors));
  }
  report.themes=[];
  for (const theme of ['gold','midnight','forest','violet','ember','aurora','rose']) {
    await run(`window.MefiMusic.applyTheme(${JSON.stringify(theme)});await window.MefiNav.go('agents');`);
    assert.deepEqual(report.errors,[]);report.themes.push(theme);
  }
  for (const [width,height] of [[1920,1200],[1440,900],[1100,720],[600,560]]) for (const zoom of [1,1.25,1.5]) for (const preset of ['focus','studio','atmosphere']) {
    window.setContentSize(width,height); contents.setZoomFactor(zoom);
    await sleep(40);
    await run(`window.MefiAppearance.apply({preset:${JSON.stringify(preset)}});await window.MefiNav.go('agents',{section:'setup',pane:'team'});`);
    await sleep(70);
    const layout = await run("const sheet=document.querySelector('.agents-sheet').getBoundingClientRect(),body=document.getElementById('agents-body'),foot=document.getElementById('agents-save-bar').getBoundingClientRect();return {w:innerWidth,h:innerHeight,sheet:{left:sheet.left,right:sheet.right,top:sheet.top,bottom:sheet.bottom},foot:foot.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1,canScroll:body.scrollHeight>body.clientHeight,scrollbar:getComputedStyle(body).scrollbarWidth};");
    report.layouts.push({width,height,zoom,preset,...layout});
    assert.ok(!layout.overflow&&layout.sheet.left>=0&&layout.sheet.right<=layout.w+1&&layout.sheet.top>=0&&layout.sheet.bottom<=layout.h+1&&layout.foot<=layout.h+1,JSON.stringify(report.layouts.at(-1)));
    assert.ok(await run("return [...document.querySelectorAll('.agents-navigation button')].filter(el=>el.getClientRects().length).every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.height>=28;});"),'navigation fits at '+width+' / '+zoom);
    if (layout.h<=520) assert.ok(await run("const list=document.getElementById('app-rail-sections'),box=list.getBoundingClientRect();list.scrollTop=0;return [...list.querySelectorAll('.app-rail-head')].every(el=>{const r=el.getBoundingClientRect();return r.top>=box.top-1&&r.bottom<=box.bottom+1;});"),'primary destinations stay visible at '+width+' / '+zoom);
    if (zoom===1&&preset==='studio') await capture(`unified-team-${width}.png`);
  }
  await run("window.unifiedFixture.project('second-project');");
  await until("window.MefiWorkspace.activeProjectId()==='second-project'", "project switch");
  await run("await window.MefiNav.go('agents',{section:'setup',pane:'team'});");
  assert.notEqual(await run("return document.getElementById('agents-team-name').value;"),'My independent team','project drafts are isolated');
  assert.match(await run("return document.getElementById('agents-team-summary').textContent;"),/Second project team/);
  await run("window.unifiedFixture.project('workflow-project');");
  await until("window.MefiWorkspace.activeProjectId()==='workflow-project'", "return to first project");
  await run("await window.MefiNav.go('agents',{section:'setup',pane:'team'});");
  assert.equal(await run("return document.getElementById('agents-team-name').value;"),'My independent team','returning restores this project draft');
  assert.match(await run("return document.getElementById('agents-team-summary').textContent;"),/Studio defaults/,'returning also restores the applied team summary');
  await run("window.unifiedFixture.fail();window.MefiAgents.reload();");
  await until("document.getElementById('agents-save-status').textContent.includes('Fixture connection unavailable')", "visible setup failure");
  assert.equal(await run("return document.getElementById('agents-team').inert;"),true,'unavailable configuration cannot be edited as if loaded');
  report.projectIsolation=true;
  assert.deepEqual(report.errors,[]); report.complete=true; finish();
}).catch(finish);
