"use strict";

// No application main process or live state is loaded. External navigation,
// permissions and child execution are blocked in this isolated renderer.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_WORKFLOW_RENDER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated workflow fixture directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], conversationLayouts: [] };
app.setName("Studio Workflow Fixture");
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
  const preload = path.join(root, "workflow-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const listeners={},calls=[];
    const bridge=Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]]));
    for(const name of ['onTasks','onProjects','onAssistantStatus','onAssistant','onProjectPreview'])bridge[name]=fn=>{(listeners[name]??=[]).push(fn);return()=>{};};
    for(const name of ['tasksCreate','assistantChat'])bridge[name]=async value=>{calls.push({name,value});return {ok:true};};
    bridge.prefsSet=async patch=>({ok:true,prefs:Object.assign(responses.prefsGet.prefs,patch)});
    bridge.assistantWorkOn=async value=>{calls.push({name:'assistantWorkOn',value});return {ok:true,dispatch:{state:'queued',message:'This task is queued for its worker'}};};
    for(const name of ['projectPreviewStart','projectPreviewOpen','projectPreviewStop'])bridge[name]=async value=>{calls.push({name,value});return responses.projectPreviewStatus;};
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
  await until("window.MefiWorkspace && window.MefiTasks && window.MefiNav", "renderer startup");
  await run("window.MefiNav.go('workspace');");
  await until("document.getElementById('workspace-focus-worker').textContent.includes('Fixture builder') && document.getElementById('workspace-preview-state').textContent==='Preview ready'", "Home worker and ready preview");
  report.defaultCollapsed = await run("return ['workspace-studio-details','workspace-queue-details','workspace-help-details','workspace-preview-controls'].every(id=>{const element=document.getElementById(id);return element?.tagName==='DETAILS'&&!element.open;});");
  assert.ok(report.defaultCollapsed, "Home starts with queue, telemetry, help and preview controls collapsed");
  report.previewWhileBuilding = await run("return document.getElementById('workspace-preview-worker').textContent.includes('still working')&&document.getElementById('workspace-focus-checks').textContent.includes('No completion checks recorded');");
  assert.ok(report.previewWhileBuilding);
  await capture("workflow-building-1440.png");
  await run("window.MefiNav.go('command');");
  await until("window.MefiIdle?.selection?.()?.taskId==='snake'", "Live retains the initial Home task without first opening Work");
  await run("window.MefiNav.go('workspace');");
  await until("!document.getElementById('workspace-layer').hidden", "return to initial Home");
  await run("document.querySelector('#app-rail-recent-list [data-task-id=snake]').click();");
  await until("document.getElementById('task-title').textContent==='Validate Snake and launch a local preview.'", "short task title");
  report.fullBrief = await run("return document.getElementById('task-detail').textContent.includes('FULL_BRIEF_ACCEPTANCE');"); assert.ok(report.fullBrief);
  await run("document.querySelector('[data-task-action=live]').click();");
  await until("window.MefiIdle?.selection?.()?.taskId==='snake'", "Live selects the same task");
  await until("document.getElementById('app-task-context')?.textContent.includes('Open current task')", "Live return path");
  await capture("workflow-live-1440.png");
  await run("[...document.querySelectorAll('#app-task-context button')].find(button=>button.textContent.startsWith('Open current task')).click();");
  await until("window.MefiTasks.state.selected==='snake' && !document.getElementById('tasks-overlay').hidden", "return to selected task");
  await run("document.querySelector('[data-task-action=home]').click();");
  await until("!document.getElementById('workspace-layer').hidden && document.getElementById('workspace-focus-task').value==='snake'", "return Home with task context"); report.contextRoundTrip = true;
  await run("window.workflowFixture.conversation(24);document.getElementById('workspace-mode-chat').click();const input=document.getElementById('workspace-input');input.value='Keep this draft while I review the conversation and task progress.';input.dispatchEvent(new Event('input',{bubbles:true}));");
  await until("document.querySelectorAll('#workspace-thread .ws-message').length===24", "populated conversation");
  for (const [width, height] of [[1440, 900], [1100, 720], [600, 560]]) {
    window.setContentSize(width, height);
    contents.enableDeviceEmulation({ screenPosition: "desktop", screenSize: { width, height }, viewPosition: { x: 0, y: 0 }, viewSize: { width, height }, deviceScaleFactor: 1, scale: 1 });
    await sleep(120);
    await run("if(!document.getElementById('workspace-activity-drawer').hidden)document.getElementById('workspace-activity-close').click();document.getElementById('workspace-conversation-content').scrollTop=0;");
    const before = await composerBounds();
    if (!before.visible) report.composerAncestors = await run("const rows=[];for(let el=document.getElementById('workspace-form');el;el=el.parentElement){const r=el.getBoundingClientRect(),s=getComputedStyle(el);rows.push({id:el.id,cls:el.className,top:r.top,bottom:r.bottom,height:s.height,min:s.minHeight,scroll:el.scrollTop,flex:s.flex,overflow:s.overflow});}return rows;");
    const messageColumn = await run("const thread=document.getElementById('workspace-thread').getBoundingClientRect(),form=document.getElementById('workspace-form').getBoundingClientRect();return thread.width>=form.width*.8&&Math.abs(thread.left-form.left)<25;");
    const oldestReachable = await reachable('#workspace-thread [data-message-id="message-0"]');
    const scroll = await run("const thread=document.getElementById('workspace-thread'),body=document.getElementById('workspace-conversation-content');thread.scrollTop=0;const outerTop=body.scrollTop;thread.scrollTop=thread.scrollHeight;await new Promise(resolve=>requestAnimationFrame(resolve));return {moved:thread.scrollTop>100,overflow:thread.scrollHeight>thread.clientHeight+100,outerStable:Math.abs(body.scrollTop-outerTop)<1};");
    const latestReachable = await reachable('#workspace-thread [data-message-id="message-23"]');
    const after = await composerBounds();
    await capture(`workflow-conversation-${width}.png`);
    const progressReachable = await reachable('#workspace-focus-check');
    const afterProgress = await composerBounds();
    await run("document.getElementById('workspace-activity-toggle').click();");
    const drawerReachable = await reachable('#workspace-activity-close') && await reachable('#workspace-preview-open');
    const drawerComposer = await composerBounds();
    await capture(`workflow-conversation-activity-${width}.png`);
    await run("document.getElementById('workspace-activity-close').click();");
    const draftIntact = await run("return document.getElementById('workspace-input').value==='Keep this draft while I review the conversation and task progress.'&&!window.workflowFixture.calls().some(call=>['tasksCreate','assistantChat'].includes(call.name));");
    const noOverflow = await run("return document.documentElement.scrollWidth<=innerWidth+1;");
    const stationary = [after, afterProgress, drawerComposer].every((box) => Math.abs(box.top-before.top)<1 && Math.abs(box.bottom-before.bottom)<1);
    report.conversationLayouts.push({ width, before, after, afterProgress, drawerComposer, messageColumn, oldestReachable, latestReachable, scroll, progressReachable, drawerReachable, draftIntact, noOverflow, stationary });
    assert.ok(before.visible && before.controls && before.gap>=0 && before.gap<=40 && after.controls && afterProgress.controls && stationary && messageColumn && oldestReachable && latestReachable && scroll.moved && scroll.overflow && scroll.outerStable && progressReachable && drawerReachable && draftIntact && noOverflow, JSON.stringify(report.conversationLayouts.at(-1)));
  }
  await run("window.workflowFixture.conversation(0);const input=document.getElementById('workspace-input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));");
  await run("window.workflowFixture.complete();");
  await until("document.getElementById('workspace-focus-checks').textContent.includes('1/1 recorded checks passed')", "completion checks");
  await run("document.getElementById('workspace-focus-change').click();");
  report.requestChangeDraft = await run("return document.getElementById('workspace-input').value.includes('Requested change:')&&document.getElementById('workspace-input').value.includes('Preserve keyboard controls')&&!window.workflowFixture.calls().some(call=>['tasksCreate','assistantChat'].includes(call.name));"); assert.ok(report.requestChangeDraft);
  await run("window.workflowDraft=document.getElementById('workspace-input').value;document.getElementById('app-rail-compose').click();");
  report.newTaskPreservesDraft = await run("return document.getElementById('workspace-input').value===window.workflowDraft&&document.activeElement.id==='workspace-input'&&document.getElementById('workspace-mode-work').getAttribute('aria-pressed')==='true'&&!window.workflowFixture.calls().some(call=>['tasksCreate','assistantChat'].includes(call.name));"); assert.ok(report.newTaskPreservesDraft);
  await run("const input=document.getElementById('workspace-input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));");
  await run("document.getElementById('workspace-focus-check').click();");
  await until("document.getElementById('task-tab-evidence').getAttribute('aria-selected')==='true'", "Home opens checks directly");
  await run("document.querySelector('[data-task-action=open-app]').click();");
  await until("window.workflowFixture.calls().some(call=>call.name==='projectPreviewOpen')", "Open app invokes preview bridge");
  for (const [width, height] of [[1440, 900], [1100, 720], [600, 560]]) {
    window.setContentSize(width, height);
    contents.enableDeviceEmulation({ screenPosition: "desktop", screenSize: { width, height }, viewPosition: { x: 0, y: 0 }, viewSize: { width, height }, deviceScaleFactor: 1, scale: 1 });
    await sleep(120);
    await run("window.MefiNav.go('workspace');if(!document.getElementById('workspace-activity-drawer').hidden)document.getElementById('workspace-activity-close').click();for(const id of ['workspace-studio-details','workspace-queue-details','workspace-help-details','workspace-preview-controls'])document.getElementById(id).open=false;document.getElementById('workspace-conversation-content').scrollTop=0;document.querySelector('.ws-main').scrollTop=0;document.getElementById('workspace-layer').scrollTop=0;");
    await until("!document.getElementById('workspace-layer').hidden", "Home layout");
    const homeOverflow = await run("return document.documentElement.scrollWidth>innerWidth+1;");
    const initialComposerVisible = await run("return ['workspace-input','workspace-send'].every(id=>{const rect=document.getElementById(id).getBoundingClientRect();return rect.width>0&&rect.height>0&&rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=0&&rect.bottom<=innerHeight+1;});");
    const authoringLayout = await run("const layout=document.querySelector('.ws-home-layout').getBoundingClientRect(),composer=document.getElementById('workspace-form').getBoundingClientRect(),body=document.getElementById('workspace-conversation-content'),progress=document.getElementById('workspace-progress');return {correct:Math.abs((composer.left+composer.right)/2-(layout.left+layout.right)/2)<2&&composer.width<=802&&body.contains(progress)&&body.getBoundingClientRect().bottom<=composer.top&&composer.bottom<=innerHeight+1&&innerHeight-composer.bottom<=40};");
    const navigation = await run("const rail=document.getElementById('app-rail'),button=rail.querySelector('.app-rail-head'),label=button.querySelector('.app-rail-text'),icon=button.querySelector('.glyph');return {width:rail.getBoundingClientRect().width,labelSize:parseFloat(getComputedStyle(label).fontSize),iconWidth:icon.getBoundingClientRect().width,rowHeight:button.getBoundingClientRect().height,pinned:document.documentElement.hasAttribute('data-rail-pinned')};");
    const composerReadability = await run("const hint=document.getElementById('workspace-compose-hint'),feedback=document.getElementById('workspace-feedback');return {hintHeight:hint.getBoundingClientRect().height,feedbackFits:feedback.scrollWidth<=feedback.clientWidth+1};");
    const compactDefault = await run("return ['workspace-studio-details','workspace-queue-details','workspace-help-details','workspace-preview-controls'].every(id=>!document.getElementById(id).open)&&document.getElementById('workspace-activity-drawer').hidden&&document.getElementById('workspace-progress-state').getBoundingClientRect().height>0&&document.getElementById('workspace-progress-reason').getBoundingClientRect().height>0&&document.getElementById('workspace-result-open').getBoundingClientRect().height>0;");
    await capture(`workflow-home-default-${width}.png`);
    if (width === 1440) {
      await run("window.MefiNav.go('palette');const input=document.getElementById('palette-input');input.value='task';input.dispatchEvent(new Event('input',{bubbles:true}));");
      await until("!document.getElementById('palette-overlay').hidden&&document.querySelectorAll('#palette-list li').length>0", "search palette results");
      contents.sendInputEvent({ type: "keyDown", keyCode: "Down" }); contents.sendInputEvent({ type: "keyUp", keyCode: "Down" });
      await capture("workflow-search-1440.png");
      await run("window.MefiNav.close('palette');");
    }
    const checksReachable = await reachable("#workspace-focus-check");
    await capture(`workflow-home-${width}.png`);
    const inputReachable = await reachable("#workspace-input");
    const sendReachable = await reachable("#workspace-send");
    await run("await window.MefiNav.go('tasks',{filter:'all'});document.getElementById('task-overview-back').click();");
    await until("document.querySelector('#task-list .task-overview-card button')", "project work opens in Work");
    const workReachable = await reachable("#task-list .task-overview-card button");
    await capture(`workflow-home-bottom-${width}.png`);
    await run("await window.MefiNav.go('workspace');document.getElementById('workspace-activity-toggle').click();document.querySelector('#workspace-preview-controls > summary').click();");
    await until("document.getElementById('workspace-preview-controls').open", "explicitly opened preview controls");
    const previewControlsReachable = await reachable("#workspace-preview-stop") && await reachable("#workspace-preview-check");
    await capture(`workflow-preview-expanded-${width}.png`);
    await run("document.getElementById('workspace-preview-controls').open=false;document.getElementById('workspace-activity-close').click();");
    await run("document.getElementById('workspace-focus-check').click();");
    await until("!document.getElementById('tasks-overlay').hidden && document.getElementById('task-tab-evidence').getAttribute('aria-selected')==='true'", "Work checks layout");
    const workOverflow = await run("return document.documentElement.scrollWidth>innerWidth+1;");
    const homeReachable = await reachable("[data-task-action=home]");
    await capture(`workflow-work-${width}.png`);
    report.layouts.push({ width: await run("return innerWidth;"), homeOverflow, workOverflow, checksReachable, homeReachable, inputReachable, sendReachable, workReachable, initialComposerVisible, compactDefault, previewControlsReachable, authoringLayout, navigation, composerReadability });
    assert.ok(!homeOverflow && !workOverflow && checksReachable && homeReachable && inputReachable && sendReachable && workReachable && compactDefault && previewControlsReachable && authoringLayout.correct && initialComposerVisible, JSON.stringify(report.layouts.at(-1)));
    assert.ok(navigation.iconWidth>=18&&navigation.rowHeight>=36&&(navigation.pinned?navigation.width===256&&navigation.labelSize>=14:navigation.width===64), JSON.stringify(navigation));
    assert.ok(composerReadability.hintHeight<=42&&composerReadability.feedbackFits, JSON.stringify(composerReadability));
  }
  await run("window.MefiNav.go('workspace');document.getElementById('workspace-activity-toggle').click();const select=document.getElementById('workspace-focus-task');select.value='ready';select.dispatchEvent(new Event('change',{bubbles:true}));");
  await until("document.getElementById('workspace-focus-state').textContent.includes('agents paused')", "ready task with paused agents");
  await run("document.getElementById('workspace-focus-primary').click();");
  await until("window.workflowFixture.calls().some(call=>call.name==='assistantWorkOn')", "explicit start request");
  report.startScoped = await run("return window.workflowFixture.calls().filter(call=>call.name==='assistantWorkOn').length===1&&window.workflowFixture.calls().some(call=>call.name==='assistantWorkOn'&&call.value.kind==='task'&&call.value.id==='ready'&&call.value.projectId==='workflow-project'&&call.value.start===true);"); assert.ok(report.startScoped);
  await run("window.workflowFixture.needsAttention();");
  await until("!document.getElementById('workspace-attention-shortcut').hidden && document.getElementById('workspace-attention-shortcut').textContent==='1 needs you'", "an owner decision stays visible outside collapsed Studio details");
  report.attentionReachable = await reachable("#workspace-attention-shortcut");
  assert.ok(report.attentionReachable);
  await capture("workflow-attention-600.png");
  await run("document.getElementById('workspace-attention-shortcut').click();");
  await until("document.getElementById('cmd-rail-tab-ask').getAttribute('aria-selected')==='true' && !document.getElementById('cmd-asks').hidden && document.getElementById('cmd-asks').textContent.includes('Choose a theme')", "attention shortcut opens the actual Ask decision");
  report.attentionNavigated = true;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.networkAttempts, []); assert.deepEqual(report.processAttempts, []);
  finish();
}).catch(finish);
