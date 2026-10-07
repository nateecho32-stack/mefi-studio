"use strict";

// No application main process or live state is loaded. External navigation,
// permissions and child execution are blocked in this isolated renderer.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_AUTONOMY_RENDER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated workflow fixture directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], conversationLayouts: [] };
app.setName("Autonomy UI Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
}
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor','1');
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

  const categories = require(process.env.MEFI_AUTONOMY_SOURCE + '/scripts/autonomy.cjs').ELEVATED;
  const decisions = [{id:'decision-1',label:'Retried the preview check',choice:'retry',reason:'The preview server is ready and the previous failure was a connection timeout.',at:now-20000,taskId:'snake'}];
  const todos = [{id:'todo-1',taskId:'ready',text:'Connect your test phone to check the touch controls.',at:now,doneAt:null}];
  const questions = [
    {id:'scope',projectId,status:'open',source:'issue',title:'Keep the change focused?',detail:'The color theme can ship without changing the game rules.',at:now,context:{taskId:'ready',issueKind:'scope',suggestion:{optionId:'narrow',reason:'Your brief only asks for a new palette.'}},options:[{id:'narrow',label:'Keep the agreed scope',recommended:true},{id:'instruct',label:'Answer it in one line',text:true}]},
    {id:'confirm',projectId,status:'open',source:'chat',title:'Start the color theme task?',at:now,context:{chatConfirm:true},options:[{id:'yes',label:'Start it'},{id:'no',label:'No',dismiss:true}]},
  ];
  const items=questions.map(q=>({id:q.id,kind:'question',title:q.title,questionId:q.id,actions:q.options.map(o=>({id:o.id,label:o.label,text:o.text}))}));
  responses.autonomyState={ok:true,projectId,level:'auto',elevated:Object.fromEntries(categories.map(c=>[c.id,true])),categories,decisions,todos};
  responses.learningState={ok:true,projectId,decisions:{enabled:true,scope:'blend'},models:'blend',profiles:{project:[{kind:'scope',n:9,verbs:[{verb:'narrow',share:7/9}]}],global:[]},skills:{project:[{taskType:'fix',model:'Fixture builder',wins:8,losses:2,n:10,p:.75}],global:[]}};
  Object.assign(responses.assistantState.state,{questions,decisions,todos,needsYou:{items,counts:{total:2}},ai:{keyPresent:true},messages:[{id:'offer-message',role:'assistant',at:now-6000,text:'The preview check is ready. I can also start the color theme next.',offers:[{title:'Add a color theme',target:{kind:'task',id:'ready',label:'Add a color theme'}}]},{id:'decided-message',role:'assistant',kind:'notice',taskId:'__decided_for_you__',text:'Decided for you (1). Retried the preview check.',at:now-3000}]});
  responses.companionState.queue={items,counts:{total:2}};

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

    bridge.autonomySet=async patch=>{calls.push({name:'autonomySet',value:patch});Object.assign(responses.autonomyState,patch);return responses.autonomyState;};
    bridge.autonomyUndo=async patch=>{calls.push({name:'autonomyUndo',value:patch});responses.autonomyState.decisions.find(d=>d.id===patch.id).undone=Date.now();return {ok:true};};
    bridge.autonomyTodo=async patch=>{calls.push({name:'autonomyTodo',value:patch});responses.autonomyState.todos.find(d=>d.id===patch.id).doneAt=Date.now();return {ok:true};};
    bridge.assistantAnswer=async patch=>{calls.push({name:'assistantAnswer',value:patch});if(patch.id==='scope'&&!patch.text)return {ok:false,error:'Fixture: this answer needs review'};responses.assistantState.state.questions.find(q=>q.id===patch.id).status='answered';return {ok:true,state:responses.assistantState.state};};
    bridge.learningSet=async patch=>{calls.push({name:'learningSet',value:patch});Object.assign(responses.learningState,patch);return {ok:true};};
    bridge.learningForget=async patch=>{calls.push({name:'learningForget',value:patch});responses.learningState.profiles[patch.scope]=[];return {ok:true};};

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
  const window = new BrowserWindow({ show: false, width: 1920, height: 1080, enableLargerThanScreen: true, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
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

  window.setContentSize(1920,1080);
  report.viewport=await run("return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio};");
  await run("Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));");
  await until("window.MefiVibe",'Vibe startup');
  await run("await window.MefiVibe.setMode('vibe');await window.MefiVibe.refresh();");
  await sleep(500);
  await capture('vibe-home.png');
  if(process.env.MEFI_AUTONOMY_BEFORE==='1'){report.complete=true;finish();return;}
  await until("document.getElementById('vibe-autonomy')?.textContent==='Auto'",'saved mode');
  assert.equal(await run("return document.getElementById('vibe-pulse-text').textContent;"),'2 need you');
  await run("document.getElementById('vibe-autonomy').click();");
  assert.equal(await run("return document.querySelectorAll('#vibe-autonomy-control [role=radio]').length;"),4);
  await capture('vibe-mode-popover.png');
  await run("document.querySelectorAll('#vibe-autonomy-control [role=radio]')[1].click();");
  await until("document.getElementById('vibe-autonomy').textContent==='Accept per task'",'mode save');
  await run("window.MefiVibe.openPanel('decisions');");
  await until("document.querySelector('.autonomy-todo')",'decision history');
  await run("document.querySelector('.autonomy-decision details').open=true;");
  await capture('vibe-decisions-and-todos.png');
  await run("document.querySelector('.autonomy-decision button').click();");
  await until("document.querySelector('.autonomy-decision').textContent.includes('Undone')",'undo');
  await run("document.querySelector('.autonomy-todo button').click();");
  await until("!document.querySelector('.autonomy-todo')",'todo done');
  await run("window.MefiVibe.closeDrawers();document.getElementById('companion-orb').click();");
  await until("window.MefiCompanionHub.isOpen()", 'companion hub');
  await run("document.querySelector('[data-hub-section=requests]').click();");
  await until("document.querySelector('#companion-pane-status .companion-item button')", 'companion request');
  await run("document.querySelector('#companion-pane-status .companion-item button').click();");
  assert.ok(await run("return !window.MefiCompanionHub.isOpen()&&!document.getElementById('vibe-layer').inert;"), 'orb action releases the hub focus lock');
  assert.equal(await run("return window.unifiedFixture.calls().filter(c=>c.name==='assistantAnswer').length;"), 0, 'the drawer waits for the answer');
  // In the 0.5 layout a request opens the Inbox (renderer/today.js) on its card: what Mefi suggests and why, the options, a
  // refused answer said on the card, and an option that asks for one line putting the caret in the card's own answer box.
  const scopeCard = "document.querySelector('#today-inbox [data-option=narrow]')?.closest('.today-need')";
  await until(`!document.getElementById('today-inbox').hidden && ${scopeCard}?.querySelector('.today-need-hint')?.textContent.startsWith('Mefi suggests: Keep the agreed scope, because')`,'suggestion');
  await capture('vibe-suggestion.png');
  await run("document.querySelector('#today-inbox [data-option=narrow]').click();");
  await until(`${scopeCard}?.querySelector('.today-need-note')?.textContent.includes('needs review')`,'item error');
  await run("document.querySelector('#today-inbox [data-option=instruct]').click();");
  assert.ok(await run(`const card=${scopeCard};return document.activeElement?.classList.contains('today-need-input')&&card.contains(document.activeElement);`),'the one-line option puts the caret in the card\'s answer box');
  await capture('vibe-one-line.png');
  // A wide Home has the conversation docked already (renderer/vibe.js syncDock); a narrower one opens it as the drawer.
  await run("window.MefiToday.closeInbox();window.MefiVibe.closeDrawers();if(document.getElementById('vibe-chat').hidden)document.getElementById('vibe-chat-toggle').click();");
  await until("document.querySelector('.vibe-inline-confirm')",'inline confirmation');
  assert.equal(await run("return document.querySelectorAll('#vibe-thread .vibe-spark').length;"),1);
  await capture('vibe-chat-confirm.png');
  await run("document.querySelector('.vibe-inline-confirm button').click();");
  await until("!document.querySelector('.vibe-inline-confirm')",'inline yes');
  await run("window.MefiVibe.openPanel('settings');");
  await until("document.querySelector('#vibe-panel .autonomy-elevated')",'permission settings');
  await run("document.querySelector('#vibe-panel .autonomy-elevated').open=true;");
  await capture('vibe-settings.png');
  await run("document.querySelector('#vibe-panel .autonomy-elevated input').click();");
  assert.ok(await run("return document.querySelector('.autonomy-warning')?.textContent.includes('Let Mefi handle this');"));
  await capture('vibe-elevated-warning.png');
  await run("window.MefiVibe.openPanel('team');");
  await capture('vibe-team.png');
  report.calls=await run("return window.unifiedFixture.calls();");
  assert.ok(report.calls.some(c=>c.name==='autonomyUndo'&&c.value.projectId==='workflow-project'));
  assert.ok(report.calls.some(c=>c.name==='assistantAnswer'&&c.value.id==='confirm'&&c.value.optionId==='yes'));
  report.complete=true;finish();
}).catch(finish);
