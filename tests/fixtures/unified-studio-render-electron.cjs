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
    // The background check answers this embed locally with a canvas video.
    let allowed = /^(data:|blob:|devtools:)/.test(details.url) || details.url.startsWith("https://www.youtube-nocookie.com/embed/");
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
    report.phase = name;
    fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
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
  // Home controls must clear the fixed navigation, and each Live/Workflows
  // destination must remain reachable and identify the view actually shown.
  // In the 0.5 layout Home's own controls are on its chat view (Today stands in for the rest), and the classic Agents
  // navigation (its Live and Workflows menus and the section pickers) is gone: Trace and the Agent Brain's views are pages
  // of the frame, reached by their routes, Search and the Map's bar.
  await run("window.MefiVibe.setMode('build');window.MefiVibe.closeNotes();");
  for (const [width, height] of [[1440, 900], [600, 560]]) {
    window.setContentSize(width, height);
    await run("await window.MefiNav.go('workspace',{view:'chat'});");
    await until("window.MefiWorkspace.isActive() && !document.getElementById('workspace-layer').hidden", "Build Home");
    for (const selector of ['#workspace-pause', '#workspace-activity-toggle', '#workspace-layer .ws-project-actions > summary']) {
      assert.ok(await reachable(selector), `${width}: Home control is reachable: ${selector}`);
    }
    await capture(`navigation-home-${width}.png`);
    // Trace is a Team place in the 0.5 layout (Team › Inspect), and each place keeps its own history.
    await run("await window.MefiNav.go('agents',{section:'setup',pane:'connections'});await window.MefiNav.go('trace');");
    await until("!document.getElementById('trace-overlay').hidden", "Trace opens");
    await capture(`navigation-trace-${width}.png`);
    assert.ok(await reachable('#trace-search'), `${width}: Trace search is reachable`);
    assert.ok(await reachable('#trace-close'), `${width}: Trace Back is reachable`);
    assert.ok(await run("return document.getElementById('trace-heading').getBoundingClientRect().top>=window.MefiNav.usable().top-1;"), `${width}: Trace heading clears the frame's bars`);
    await run("document.getElementById('trace-close').click();");
    assert.deepEqual(await run("return [window.MefiNav.current(),window.MefiAgents.params().pane];"), ['agents', 'connections'], 'Trace Back returns to the Team view it came from');
    for (const tab of ['live', 'playbook', 'map', 'live']) {
      await run(`await window.MefiNav.go('agent-brain',{tab:${JSON.stringify(tab)}});`);
      assert.ok(await run(`const pane=document.getElementById('agent-brain-${tab}');return document.querySelector('[data-brain-tab=${tab}]')?.getAttribute('aria-selected')==='true'&&!pane.hidden&&pane.getClientRects().length>0;`), `${width}: the ${tab} view is the one shown, and its tab says so`);
    }
  }
  report.navigationReachable = true;
  window.setContentSize(1440, 900);
  await run("await window.MefiNav.go('agents');");
  await until("!document.getElementById('agents-overlay').hidden", "Agents overview");
  await capture("unified-overview.png");
  // (The classic Agents navigation's hover menus, their keyboard and the section pickers were checked here; the 0.5 layout has
  // none of them: Team is twelve places in the frame's list column, tests/team_render.test.mjs.)
  await run("await window.MefiNav.go('tasks');await window.MefiNav.go('agents',{section:'setup',pane:'connections'});");
  await until("window.MefiAgents.params().pane==='connections' && !document.getElementById('agents-overlay').hidden",'Agents opens on a pane after leaving it');
  await run("await window.MefiNav.go('agents',{section:'setup',pane:'team'});");
  await until("document.querySelector('#agents-role-grid input')", "team configuration");
  await capture("unified-team.png");
  await run("const name=document.getElementById('agents-team-name');name.value='My independent team';name.dispatchEvent(new Event('input',{bubbles:true}));await window.MefiNav.go('agents',{section:'setup',pane:'behavior'});await window.MefiNav.back();");
  report.draftRetained = await run("return window.MefiAgents.params().pane==='team' && document.getElementById('agents-team-name').value==='My independent team';"); assert.ok(report.draftRetained);
  await run("await window.MefiNav.forward();");
  // The 0.5 Team holds Behavior in its Overview place (agents.js TEAM_PLACES), and Forward returns there.
  assert.equal(await run("return window.MefiAgents.teamPlace()?.id;"), "overview", "Forward returns to the place that holds Behavior");
  await run("await window.MefiNav.go('agents',{section:'setup',pane:'routing'});");
  assert.equal(await run("return window.MefiNav.historyState().canForward;"),false);
  report.noStartOnSetup = await run("return !window.unifiedFixture.calls().some(call=>['assistantControl','assistantAutopilot'].includes(call.name));"); assert.ok(report.noStartOnSetup);
  await run("window.MefiCompanion.open();");
  assert.ok(await run("return window.MefiCompanionUI.tab()==='ask' && !document.getElementById('companion-pane-ask').hidden && !!document.querySelector('#companion-pane-ask textarea');"));
  await run("document.querySelector('[data-companion-tab=now]').click();");
  await until("!document.getElementById('companion-pane-now').hidden && document.querySelector('#companion-pane-now .companion-now-activity .companion-item')", "companion what-I'm-doing view");
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
  // In the 0.5 frame the orb rests in the rail's foot, so a drag takes it out onto the page; the release still ends the drag
  // (the orb stops following the pointer) and saves where it was let go.
  const orbBox = "const r=document.getElementById('companion-orb').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y)};";
  const beforeDrag=await run("const r=document.getElementById('companion-orb').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};");
  contents.sendInputEvent({type:'mouseMove',...beforeDrag});
  contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...beforeDrag});
  contents.sendInputEvent({type:'mouseMove',x:beforeDrag.x+130,y:beforeDrag.y-120});
  contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:beforeDrag.x+130,y:beforeDrag.y-120}); await sleep(120);
  assert.ok(await run("return window.unifiedFixture.calls().some(call=>call.name==='companionPrefs'&&call.value.pinned===true&&call.value.anchor.x>0);"),'drag pins the saved position');
  const dropped = await run(orbBox);
  contents.sendInputEvent({type:'mouseMove',x:beforeDrag.x+260,y:beforeDrag.y-200}); await sleep(80);
  assert.deepEqual(await run(orbBox), dropped, 'the release ends the drag: the orb stays where it was let go');
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
  // The overflow thumb is an indicator in the hint layer: present while the pane can scroll, a share of it, inside the hint, no pointer, and the pane reserves no width for a scrollbar.
  const thumb = await run("const body=document.getElementById('agents-body'),hint=[...document.querySelectorAll('.studio-scroll-hint')].find(el=>el.dataset.scrollOwner==='agents-body'),bar=hint.querySelector('.thumb-y'),h=hint.getBoundingClientRect(),b=bar.getBoundingClientRect(),s=getComputedStyle(body);return {hidden:bar.hidden,height:Math.round(b.height),hint:Math.round(h.height),top:Math.round(b.top-h.top),inside:bar.parentElement===hint,pointer:getComputedStyle(bar).pointerEvents,gutter:Math.round(body.offsetWidth-body.clientWidth-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth)),flat:hint.querySelector('.thumb-x').hidden};");
  assert.equal(thumb.hidden,false,'a pane that can scroll has a thumb');
  assert.ok(thumb.inside&&thumb.pointer==='none','the thumb is an indicator in the hint layer and never catches the pointer');
  assert.ok(thumb.height>=28&&thumb.height<thumb.hint&&thumb.top>=0&&thumb.top<=8,'the thumb is a share of the pane, at its top before any scroll');
  assert.equal(thumb.gutter,0,'the pane reserves no width for a scrollbar');
  assert.equal(thumb.flat,true,'no horizontal overflow, no horizontal thumb');
  report.scrollThumb=true;
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
  const atEnd = await run("const hint=[...document.querySelectorAll('.studio-scroll-hint')].find(el=>el.dataset.scrollOwner==='agents-body'),h=hint.getBoundingClientRect(),b=hint.querySelector('.thumb-y').getBoundingClientRect();return Math.round(h.bottom-b.bottom);");
  assert.ok(atEnd>=0&&atEnd<=8,'at the end of the pane the thumb rests on its bottom edge');
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
  const mapViewport = await run("const pane=document.getElementById('agent-brain-map'),stage=pane.querySelector('.agent-brain-map-stage'),free=window.MefiNav.usable(),box=(node)=>{const r=node.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom),h:Math.round(r.height)};};const rows=[];for(let el=stage;el&&el!==document.body;el=el.parentElement){const s=getComputedStyle(el);rows.push({id:el.id||String(el.className).slice(0,40),...box(el),oy:s.overflowY,display:s.display});}return {ok:getComputedStyle(pane).overflowY==='hidden'&&stage.clientHeight>35&&stage.scrollHeight<=stage.clientHeight+2,overflowY:getComputedStyle(pane).overflowY,client:stage.clientHeight,scroll:stage.scrollHeight,free:{top:free.top,bottom:free.bottom},rows,kids:[...pane.children].map(el=>({id:el.id||String(el.className).slice(0,40),...box(el)})),sheet:[...(pane.closest('.agent-brain-sheet')?.children||[])].map(el=>({id:el.id||String(el.className).slice(0,40),...box(el)})),tools:[...document.getElementById('agent-brain-map-tools').querySelectorAll('*')].filter(el=>el.getClientRects().length&&el.children.length===0).map(el=>({id:el.id||String(el.className).slice(0,30),t:el.textContent.trim().slice(0,20),...box(el)}))};");
  report.mapViewport = mapViewport;
  assert.ok(mapViewport.ok,`map has one bounded viewport: ${JSON.stringify(mapViewport)}`);
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
  for (const theme of ['chrome','gold','midnight','forest','violet','ember','aurora','rose','daylight','paper']) {
    await run(`window.MefiMusic.applyTheme(${JSON.stringify(theme)});await window.MefiNav.go('agents');`);
    assert.deepEqual(report.errors,[]);report.themes.push(theme);
  }
  for (const [width,height] of [[1920,1200],[1440,900],[1100,720],[600,560]]) for (const zoom of [1,1.25,1.5]) for (const preset of ['focus','studio','atmosphere']) {
    const previousZoom=contents.getZoomFactor();
    window.setContentSize(width,height);
    await until(`Math.abs(innerWidth-${width/previousZoom})<=2&&Math.abs(innerHeight-${height/previousZoom})<=2`,'resize before scale');
    contents.setZoomFactor(zoom);
    await until(`Math.abs(innerWidth-${width/zoom})<=2&&Math.abs(innerHeight-${height/zoom})<=2`,'requested viewport at '+width+' / '+zoom);
    await run(`window.MefiAppearance.apply({preset:${JSON.stringify(preset)}});await window.MefiNav.go('agents',{section:'setup',pane:'team'});`);
    await sleep(70);
    const layout = await run("const sheet=document.querySelector('.agents-sheet').getBoundingClientRect(),body=document.getElementById('agents-body'),foot=document.getElementById('agents-save-bar').getBoundingClientRect();return {w:innerWidth,h:innerHeight,sheet:{left:sheet.left,right:sheet.right,top:sheet.top,bottom:sheet.bottom},foot:foot.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1,canScroll:body.scrollHeight>body.clientHeight,scrollbar:getComputedStyle(body).scrollbarWidth};");
    report.layouts.push({width,height,zoom,preset,...layout});
    assert.ok(!layout.overflow&&layout.sheet.left>=0&&layout.sheet.right<=layout.w+1&&layout.sheet.top>=0&&layout.sheet.bottom<=layout.h+1&&layout.foot<=layout.h+1,JSON.stringify(report.layouts.at(-1)));
    if (layout.h<=520) {
      // The rail's four places in the 0.5 layout: Work, Map, Team and Friends.
      const primary = await run("const list=document.getElementById('app-rail-sections');list.scrollTop=0;const box=list.getBoundingClientRect();const measure=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {id:el.id||el.className,top:r.top,bottom:r.bottom,height:r.height,min:s.minHeight,display:s.display};};return {top:box.top,bottom:box.bottom,parts:[...list.parentElement.children].map(measure),foot:[...document.getElementById('app-rail-foot').children].map(measure),heads:[...list.querySelectorAll('.app-rail-head')].map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.nav,top:r.top,bottom:r.bottom,height:r.height};})};");
      assert.deepEqual(primary.heads.map(head=>head.id), ['workspace','command','agents','friends']);
      assert.ok(primary.heads.every(head=>head.top>=primary.top-1&&head.bottom<=primary.bottom+1&&head.height>=28),'primary destinations stay visible at '+width+' / '+zoom+': '+JSON.stringify(primary));
    }
    if (zoom===1&&preset==='studio') await capture(`unified-team-${width}.png`);
  }
  // At the minimum window and 150% zoom, keyboard navigation can reach every
  // Friends child even when the expanded section list has to scroll.
  const friendsMotionWasOff=await run("const off=document.body.classList.contains('no-motion');document.body.classList.add('no-motion');return off;");
  report.friendsNavigation=[];
  // Friends is a page of its own (renderer/companion-hub.js openPlace), not the companion's bubble: each way in opens it at its place.
  for (const [id, heading, place] of [['the-lobby','#friends-front','lobby'],['rooms','#rooms-title','rooms'],['your-pcs','#pc-sync-title','pcs'],['playground','#friends-title','playground'],['project-hub','#project-hub-title','hub']]) {
    const keyboard = await run(`
      const rail=document.getElementById('app-rail'),head=rail.querySelector('.app-rail-head[data-section=friends]');
      document.documentElement.dataset.railDrawer='';head.focus();
      for(const child of ['the-lobby','rooms','your-pcs','playground','project-hub']) {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
        if(child===${JSON.stringify(id)}) break;
      }
      const active=document.activeElement,box=active.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
      return {id:active.dataset.nav,height:box.height,hit:hit===active||active.contains(hit),top:box.top,bottom:box.bottom,viewport:innerHeight};
    `);
    assert.equal(keyboard.id,id);assert.ok(keyboard.height>=28&&keyboard.top>=0&&keyboard.bottom<=keyboard.viewport+1&&keyboard.hit,'Friends keyboard target is reachable: '+JSON.stringify(keyboard));
    await run("document.activeElement.click();");
    // The page's own title names the place and takes the focus (the card's heading steps aside under it; on The Lobby the
    // page's title steps aside for the front page's masthead, still focused); the card is the place's own.
    await until(`!document.getElementById('friends-overlay')?.hidden&&document.getElementById('friends-overlay').dataset.place===${JSON.stringify(place)}&&document.querySelector(${JSON.stringify(heading)})&&document.activeElement?.id==='friends-place-title'`,`Friends opens ${id}`);
    assert.ok(await reachable(place==='lobby'?'#friends-place-body':'#friends-place-title'),'Friends place is named on screen: '+id);
    assert.ok(await run(`const card=document.querySelector(${JSON.stringify(heading)})?.closest('#friends-place-body > *');const r=card?.getBoundingClientRect();return Boolean(r&&r.width>100&&r.height>${place==='lobby'?1:28}&&r.top<innerHeight);`),'Friends card is visible: '+id);
    report.friendsNavigation.push(id);
    await run("window.MefiNav.closeAll();await window.MefiNav.go('agents',{section:'setup',pane:'team'});");
  }
  if(!friendsMotionWasOff) await run("document.body.classList.remove('no-motion');");
  await require('./studio-background-checks.cjs')({ session, window, contents, run, until, capture, reachable, report });
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
