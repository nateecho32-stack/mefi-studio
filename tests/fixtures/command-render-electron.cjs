"use strict";

const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_COMMAND_RENDER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Command renderer fixture directory is required");
const started = Date.now();
const report = { errors: [], networkAttempts: [], processAttempts: [] };
app.setName("Studio Command Renderer Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); app.setPath(name, dir);
}
app.disableHardwareAcceleration();
const childProcess = require("node:child_process");
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  childProcess[method] = () => { report.processAttempts.push(method); throw new Error("Child process execution is disabled in the renderer fixture"); };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
const finish = (error) => {
  if (finished) return;
  finished = true;
  if (error) report.failure = error.stack || String(error);
  report.elapsedMs = Date.now() - started;
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  if (error) console.error(error.stack || error);
  else console.log(`Command renderer fixture passed in ${report.elapsedMs}ms`);
  app.exit(error ? 1 : 0);
};
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    if (/^(data:|blob:|devtools:)/.test(details.url)) allowed = true;
    else if (details.url.startsWith("file:")) {
      const target = fileURLToPath(details.url);
      const relative = path.relative(root, target);
      allowed = !relative.startsWith("..") && !path.isAbsolute(relative);
    }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const now = Date.now();
  const responses = {
    eyesState: { ok: true, sessions: [{ id: "command_render_session", title: "Renderer fixture session", directory: root, timeCreated: now - 5000, timeUpdated: now }], todos: [{ id: "command_render_todo", sessionId: "command_render_session", content: "Verify canvas startup", status: "in_progress" }], changes: [], pngs: [] },
    tasksList: { ok: true, tasks: [
      { id: "command_render_task", title: "Verify real node painting", status: "open", createdAt: now, updatedAt: now },
      { id: "filed_fixture", title: "A-Eyes: repair the store", status: "open", source: "a-eyes", createdAt: now, updatedAt: now },
      { id: "group_fixture", title: "Renderer task group", status: "open", members: [{ id: "group_saved", title: "Saved requirement", prompt: "Retain this full requirement", logs: [{ text: "Earlier work is preserved" }] }, { id: "group_verify", title: "Verify grouped work" }] },
      { id: "group_saved", title: "Saved requirement", status: "absorbed", absorbedInto: "group_fixture" },
      { id: "group_verify", title: "Verify grouped work", status: "awaiting_verification", absorbedInto: "group_fixture" },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `panel_fixture_${index}`, title: `Panel clearance task ${index + 1}`, status: "open", createdAt: now, updatedAt: now })),
    ] },
    ideasList: { ok: true, ideas: [] },
    projectsList: { ok: true, activeId: "command-fixture", projects: [{ id: "command-fixture", name: "Command fixture", path: root }] },
    prefsGet: { ok: true, prefs: { commandHome: false } },
    assistantState: { ok: true, state: { status: "paused", agents: [], messages: [], prefs: {}, work: [] } },
    assistantStatus: { ok: true, status: { enabled: false, execute: false, parallel: 1, running: [], history: [] } },
    eyesCheckpointsRead: { ok: true, checkpoints: {} },
    eyesRequestsRead: { ok: true, requests: [] },
    eyesBriefingRead: { ok: true, briefing: null },
    eyesCollisions: { ok: true, collisions: [], presence: [] },
    backlogStatus: { ok: true, counts: { ready: 1, running: 0, verifying: 0, blocked: 0 }, next: [] },
    speedMeasurements: { ok: true, measurements: {} },
    assistantDoneLog: { ok: true, entries: [
      { at: now - 60000, kind: "build", title: "Verify real node painting", ok: true, taskId: "command_render_task", sessionId: null, seconds: 12, detail: "reported done in 12s" },
      { at: now - 120000, kind: "pass", title: "repaired the catalog", ok: true, taskId: null, sessionId: null, seconds: 0, detail: "fix pass" },
    ] },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
  };
  const preload = path.join(root, "read-only-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require("electron");
    const responses=${JSON.stringify(responses)};
    const listeners={onAssistant:[],onAssistantStatus:[]};
    const modePatches=[],assistantActions=[],questionAnswers=[],doneAbsorbs=[];
    contextBridge.exposeInMainWorld("mefiStudio",{
      ...Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>{if(key==='eyesCollisions')await new Promise(resolve=>setTimeout(resolve,5000));return responses[key];}])),
      ...Object.fromEntries(Object.keys(listeners).map(key=>[key,callback=>{listeners[key].push(callback);return()=>{};}])),
      assistantAutopilot:async patch=>{
        modePatches.push(patch);
        await new Promise(resolve=>setTimeout(resolve,80));
        responses.assistantStatus.status={...responses.assistantStatus.status,...patch};
        for(const callback of listeners.onAssistantStatus)callback(responses.assistantStatus.status);
        return {ok:true,...responses.assistantStatus.status};
      },
      assistantControl:async action=>{
        assistantActions.push(action);
        await new Promise(resolve=>setTimeout(resolve,80));
        if(!['start-work','pause'].includes(action))return {ok:false,error:'Unsupported fixture action'};
        if(action==='start-work')responses.assistantStatus.status={...responses.assistantStatus.status,execute:true};
        responses.assistantState.state={...responses.assistantState.state,status:action==='pause'?'paused':'running'};
        for(const callback of listeners.onAssistantStatus)callback(responses.assistantStatus.status);
        for(const callback of listeners.onAssistant)callback({state:responses.assistantState.state,event:{kind:'control'}});
        return {ok:true,state:responses.assistantState.state,autopilot:responses.assistantStatus.status};
      },
      assistantAnswer:async payload=>{questionAnswers.push(payload);return {ok:true,state:responses.assistantState.state};},
      assistantAbsorbDoneLog:async()=>{doneAbsorbs.push(true);responses.assistantDoneLog={ok:true,entries:[]};return {ok:true,records:2,passes:1,entries:[]};}
    });
    contextBridge.exposeInMainWorld("commandFixture",{
      publishAssistant:(state,event)=>{responses.assistantState={ok:true,state};for(const callback of listeners.onAssistant)callback({state,event});},
      publishStatus:status=>{responses.assistantStatus={ok:true,status};for(const callback of listeners.onAssistantStatus)callback(status);},
      modePatches:()=>modePatches,
      assistantActions:()=>assistantActions,
      questionAnswers:()=>questionAnswers,
      doneAbsorbs:()=>doneAbsorbs.length,
      assistantState:()=>responses.assistantState.state,
      status:()=>responses.assistantStatus.status
    });
    localStorage.setItem("mefiStudio.zen","0");
    localStorage.setItem("mefiStudio.zenReactive","0");
    localStorage.setItem("mefiStudio.commandHome","0");
  `);
  const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents;
  contents.setAudioMuted(true);
  contents.setFrameRate(30);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => {
    const level = typeof detail === "object" ? detail.level : detail;
    if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage));
  });
  contents.on("render-process-gone", (_event, detail) => finish(new Error(`Renderer exited: ${detail.reason}`)));
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (expression, label) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      // Name the captured console errors in the assertion itself: a cold-boot
      // one-shot must survive into the test output with its full text (and the
      // "Renderer errors before" prefix stays intact for the retry signature).
      assert.deepEqual(report.errors, [], `Renderer errors before ${label}: ${JSON.stringify(report.errors)}`);
      if (await run(`return Boolean(${expression});`)) return;
      await sleep(30);
    }
    throw new Error(`Timed out: ${label}`);
  };
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await run(`
    window.__commandPaintFrames=0;
    window.__railPaintFrames=0;
    const clear=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){
      if(this.canvas.id==='idle-layer')window.__commandPaintFrames++;
      if(this.canvas.id==='tree-canvas')window.__railPaintFrames++;
      return clear.apply(this,args);
    };
    window.MefiNav.go('workspace');
  `);
  await sleep(120);
  const homeRailFrames = await run("return window.__railPaintFrames;");
  await sleep(200);
  report.homeRailPaints = await run(`return window.__railPaintFrames-${homeRailFrames};`);
  assert.equal(report.homeRailPaints, 0, "Home's hidden rail must not keep painting");
  await run(`
    window.MefiNav.go('command');
    await window.MefiIdle.ready();
  `);
  const snapshot = () => run(`
    const canvas=document.getElementById('idle-layer'), nodes=window.MefiIdle.debugNodes();
    const task=nodes.find(node=>node.id==='task:command_render_task');
    if(!task || !Number.isFinite(task.x) || !Number.isFinite(task.y)) throw new Error('Fixture task has no projected position');
    const scaleX=canvas.width/canvas.clientWidth, scaleY=canvas.height/canvas.clientHeight;
    const rect=task.cardRect || {x:task.x-35,y:task.y-35,w:70,h:70};
    const x=Math.max(0,Math.floor(rect.x*scaleX)),y=Math.max(0,Math.floor(rect.y*scaleY));
    const w=Math.min(canvas.width-x,Math.ceil(rect.w*scaleX)),h=Math.min(canvas.height-y,Math.ceil(rect.h*scaleY));
    if(w<=0||h<=0)throw new Error('Fixture task is outside the canvas');
    const pixels=canvas.getContext('2d').getImageData(x,y,w,h).data;
    let taskPixels=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>0&&Math.max(pixels[i],pixels[i+1],pixels[i+2])>70)taskPixels++;
    return {frames:window.__commandPaintFrames,finiteNodes:nodes.filter(node=>Number.isFinite(node.x)&&Number.isFinite(node.y)).length,taskPixels,taskId:task.id};
  `);
  await until("window.__commandPaintFrames>=4 && window.MefiIdle.debugNodes().some(node=>node.id==='task:command_render_task'&&Number.isFinite(node.x))", "initial painted task frames");
  report.first = await snapshot();
  const commandRailFrames = await run("return window.__railPaintFrames;");
  await sleep(200);
  report.commandRailPaints = await run(`return window.__railPaintFrames-${commandRailFrames};`);
  assert.equal(report.commandRailPaints, 0, "Command must not paint its covered rail");
  assert.ok(report.first.taskPixels > 8, "Command task pixels must be painted, not just a background or DOM shell");
  report.grouping = await run(`
    const initial=window.MefiIdle.debugNodes();
    if(initial.some(node=>node.id==='task:group_saved'))throw new Error('Collapsed saved member must not clutter graph');
    if(!initial.some(node=>node.id==='task:group_verify'&&Number.isFinite(node.x)))throw new Error('Collapsed group hid verification work');
    window.MefiIdle.select('task:group_fixture');
    const toggle=document.querySelector('[data-task-group-toggle="group_fixture"]');
    if(!toggle||toggle.getAttribute('aria-expanded')!=='false')throw new Error('Missing collapsed group control');
    if(document.querySelectorAll('[data-task-group-member]').length!==2)throw new Error('Card must list every saved member');
    document.querySelector('[data-task-group-member="group_saved"]').open=true;
    const text=document.getElementById('idle-info').textContent;
    if(!text.includes('Retain this full requirement')||!text.includes('Earlier work is preserved'))throw new Error('Saved obligation context missing');
    toggle.click();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const expanded=window.MefiIdle.debugNodes();
    if(!expanded.some(node=>node.id==='task:group_saved'&&Number.isFinite(node.x)))throw new Error('Expansion did not paint child');
    return {members:2,expanded:true,verifyingVisible:true};
  `);
  if (process.env.MEFI_GROUP_CAPTURE && path.isAbsolute(process.env.MEFI_GROUP_CAPTURE)) {
    await sleep(260);
    const target = process.env.MEFI_GROUP_CAPTURE;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, (await contents.capturePage()).toPNG());
  }
  await run(`
    const groupCard=document.getElementById('idle-info');
    if(groupCard.hidden||getComputedStyle(groupCard).display==='none')throw new Error('Group card is hidden');
    window.MefiIdle.select('task:group_saved');
    const card=document.getElementById('idle-info');
    if([...card.querySelectorAll('button')].some(button=>['Work on it','Activate','Done'].includes(button.textContent)))throw new Error('Saved child exposes mutation controls');
    window.MefiIdle.select('task:group_fixture');
    document.querySelector('[data-task-group-toggle="group_fixture"]').click();
    if(window.MefiIdle.debugNodes().some(node=>node.id==='task:group_saved'))throw new Error('Collapse did not remove quiet child');
    window.MefiIdle.select(null);
  `);
  // Exercise the real DOM panel measurements and canvas projections together.
  // These checks catch nodes that have valid coordinates but are cut off by the
  // canvas clip or covered by a card after the camera changes orientation.
  report.panelClearance = [];
  const waitForGraphPaint = `
    const firstPaint=window.__commandPaintFrames,paintDeadline=performance.now()+5000;
    let paintedNodes;
    while(performance.now()<paintDeadline){
      paintedNodes=window.MefiIdle.debugNodes().filter(node=>node.kind!=='agent');
      if(window.__commandPaintFrames>firstPaint&&paintedNodes.length>=8&&paintedNodes.every(node=>node.layoutAnchor&&Number.isFinite(node.x)&&Number.isFinite(node.y)&&Number.isFinite(node.radius)))break;
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    if(window.__commandPaintFrames<=firstPaint||paintedNodes.length<8||paintedNodes.some(node=>!node.layoutAnchor||!Number.isFinite(node.x)||!Number.isFinite(node.y)||!Number.isFinite(node.radius)))
      throw new Error('Timed out waiting for the current Command graph to paint: '+JSON.stringify({firstPaint,frames:window.__commandPaintFrames,nodes:paintedNodes.map(node=>({id:node.id,x:node.x,y:node.y,anchor:!!node.layoutAnchor}))}));
  `;
  const graphSnapshot = () => run(`
    ${waitForGraphPaint}
    const zen=window.MefiIdle.ambientZenStatus().active;
    const panels=zen?[]:['idle-feed','cmd-chat','idle-info'].flatMap(id=>{
      const panel=document.getElementById(id),style=panel&&getComputedStyle(panel);
      if(!panel||panel.hidden||style.display==='none'||style.visibility==='hidden')return [];
      const rect=panel.getBoundingClientRect();
      return rect.width&&rect.height?[{id,x:rect.x,y:rect.y,w:rect.width,h:rect.height}]:[];
    });
    return {area:window.MefiIdle.graphViewport(),angle:window.MefiIdle.geometryStatus().angle,
      mode:window.MefiIdle.followStatus().mode,orbit:window.MefiIdle.status().orbit,zen,panels,
      nodes:paintedNodes
        .map(node=>({id:node.id,x:node.x,y:node.y,r:Math.max(node.radius||0,node.orbitTrail?.radius||0)}))};
  `);
  const assertGraphClear = async (label) => {
    const snapshot = await graphSnapshot();
    report.panelClearance.push({ label, ...snapshot });
    assert.equal(snapshot.mode, "orbit", `${label}: overview camera stays active`);
    assert.ok(snapshot.nodes.length >= 8, `${label}: a populated graph is painted`);
    const { area } = snapshot;
    for (const node of snapshot.nodes) {
      assert.ok(node.x - node.r >= area.x - 1 && node.x + node.r <= area.x + area.w + 1 && node.y - node.r >= area.y - 1 && node.y + node.r <= area.y + area.h + 1,
        `${label}: ${node.id} surface (${node.x.toFixed(1)}, ${node.y.toFixed(1)}, r${node.r.toFixed(1)}) is clipped by ${JSON.stringify(area)}`);
      for (const panel of snapshot.panels) {
        const nearestX = Math.max(panel.x, Math.min(node.x, panel.x + panel.w));
        const nearestY = Math.max(panel.y, Math.min(node.y, panel.y + panel.h));
        assert.ok(Math.hypot(node.x - nearestX, node.y - nearestY) >= node.r - 1, `${label}: ${node.id} is behind ${panel.id}`);
      }
    }
    return snapshot;
  };
  const settledFrame = () => run(waitForGraphPaint);
  const setPanels = async (feedOpen, chatOpen, selected = null) => {
    await run(`
      for(const [id,expanded] of [['idle-feed-toggle',${feedOpen}],['cmd-chat-toggle',${chatOpen}]]){
        const toggle=document.getElementById(id);
        if((toggle.getAttribute('aria-expanded')==='true')!==expanded)toggle.click();
      }
      window.MefiIdle.select(${JSON.stringify(selected)});
      if(window.MefiIdle.followStatus().mode!=='orbit')document.getElementById('idle-cam-orbit').click();
      document.activeElement?.blur();
    `);
    await sleep(280);
    await settledFrame();
  };
  await run("window.MefiIdle.setView('3d'); window.MefiIdle.setOrbit('auto');");
  await setPanels(true, true);
  await assertGraphClear("expanded Live work and chat");
  await setPanels(false, false);
  const collapsed = await assertGraphClear("collapsed panel headers");
  // Chores the assistant filed for itself ride the hub instead of the ring:
  // no node, a ledger on the hub card, and the card row opens the task.
  report.filed = await run(`
    const nodes=window.MefiIdle.debugNodes();
    if(nodes.some(node=>node.id==='task:filed_fixture'))throw new Error('A chore filed by the assistant must not become a graph node');
    const hub=nodes.find(node=>node.kind==='assistant');
    if(!hub||!hub.filedWork.includes('filed_fixture'))throw new Error('The hub must carry the filed chore: '+JSON.stringify(hub&&hub.filedWork));
    window.MefiIdle.select(hub.id);
    const card=document.getElementById('idle-info');
    if(card.hidden||!card.textContent.includes('Filed by the assistant'))throw new Error('The hub card must list filed work');
    if(!card.textContent.includes('A-Eyes: repair the store'))throw new Error('Filed chore title missing from the hub card');
    return {ledger:hub.filedWork};
  `);
  assert.deepEqual(report.filed.ledger, ["filed_fixture"], "the hub ledger names the filed chore without a node of its own");
  if (process.env.MEFI_FILED_CAPTURE && path.isAbsolute(process.env.MEFI_FILED_CAPTURE)) {
    await sleep(260);
    fs.mkdirSync(path.dirname(process.env.MEFI_FILED_CAPTURE), { recursive: true });
    fs.writeFileSync(process.env.MEFI_FILED_CAPTURE, (await contents.capturePage()).toPNG());
  }
  await run("window.MefiIdle.select(null);");
  await setPanels(false, false, "task:command_render_task");
  await assertGraphClear("open task details beside collapsed chat");
  await setPanels(true, true);
  for (const layout of ["constellation", "tree", "radial", "helix", "layers"]) {
    await run(`window.dispatchEvent(new CustomEvent('mefi-tree-preferences',{detail:{nodeLayout:${JSON.stringify(layout)}}}));`);
    await settledFrame();
    for (let turn = 0; turn < 4; turn += 1) {
      const before = await graphSnapshot();
      const start = { x: Math.round(before.area.x + before.area.w / 2), y: Math.round(before.area.y + before.area.h / 2) };
      const end = { x: start.x + 140, y: start.y + (turn % 2 ? -30 : 30) };
      contents.sendInputEvent({ type: "mouseDown", button: "right", clickCount: 1, ...start });
      contents.sendInputEvent({ type: "mouseMove", button: "right", ...end });
      contents.sendInputEvent({ type: "mouseUp", button: "right", clickCount: 1, ...end });
      await settledFrame();
      const after = await assertGraphClear(`${layout} automatic orbit turn ${turn + 1}`);
      assert.equal(after.orbit, "auto");
      assert.ok(after.angle - before.angle > 0.5, "native right drag changes the real 3D orientation");
    }
  }
  await run("window.dispatchEvent(new CustomEvent('mefi-tree-preferences',{detail:{nodeLayout:'constellation'}}));");
  await setPanels(true, true);
  const beforeZen = await assertGraphClear("before ambient Zen");
  assert.equal(await run("return window.MefiIdle.ambientZenStatus().enabled;"), false, "Zen defaults off in a fresh profile");
  await run(`
    document.getElementById('idle-ambient-zen').click();
    window.MefiIdle.select(null); document.activeElement?.blur();
    window.__fixtureRealNow=Date.now;
    Date.now=()=>window.__fixtureRealNow()+31000;
  `);
  await until("window.MefiIdle.ambientZenStatus().active", "quiet clock enters ambient Zen");
  await sleep(550);
  const zen = await assertGraphClear("ambient Zen with invisible panels");
  assert.ok(zen.area.w > collapsed.area.w - 1 && zen.area.h > collapsed.area.h + 100, "Zen returns the invisible headers and dock space to the graph");
  assert.ok(zen.area.w > beforeZen.area.w + 300, "Zen returns both hidden side gutters to the graph");
  if (process.env.MEFI_COMMAND_CAPTURE && path.isAbsolute(process.env.MEFI_COMMAND_CAPTURE)) {
    fs.mkdirSync(path.dirname(process.env.MEFI_COMMAND_CAPTURE), { recursive: true });
    fs.writeFileSync(process.env.MEFI_COMMAND_CAPTURE, (await contents.capturePage()).toPNG());
  }
  contents.sendInputEvent({ type: "mouseMove", x: Math.round(beforeZen.area.x + 20), y: Math.round(beforeZen.area.y + 20) });
  await until("!window.MefiIdle.ambientZenStatus().active && !document.getElementById('idle-hud').inert", "native mouse movement restores panels");
  await run("Date.now=window.__fixtureRealNow; delete window.__fixtureRealNow;");
  await sleep(550);
  const awake = await assertGraphClear("restored panels after Zen");
  assert.deepEqual(awake.area, beforeZen.area, "waking restores the unobstructed panel viewport");
  await run("window.MefiIdle.setOrbit(false);");
  // Real status pushes and Chromium frames cover the boundary between the
  // rail's motion simulation and Command's projected, painted agent positions.
  await setPanels(false, false);
  await run(`
    window.__motionRoster=[
      {role:'reference',status:'running',target:{kind:'task',id:'command_render_task'}},
      {role:'auditor',status:'running',target:{kind:'session',id:'command_render_session'}}
    ];
    window.__motionPublish=(role='reference',status='running')=>window.commandFixture.publishAssistant(
      {status:'running',agents:window.__motionRoster,messages:[],prefs:{},work:[]},
      {kind:'agent',role,status,text:role+' '+status,at:Date.now()}
    );
    window.__motionJobs=[{taskId:'command_render_task',title:'Smooth fixture builder',startedAt:Date.now()}];
    window.__motionStatus=()=>window.commandFixture.publishStatus({enabled:true,execute:false,parallel:2,running:window.__motionJobs,history:[]});
    window.__motionPublish();window.__motionStatus();
  `);
  await until("window.MefiIdle.debugNodes().filter(node=>node.kind==='agent'&&Number.isFinite(node.x)).length===3", "service agents and builder paint");
  await sleep(900);
  report.motion = await run(`
    const ids=['__agent__:reference','__agent__:auditor','builder:command_render_task'];
    const positions=()=>Object.fromEntries(window.MefiIdle.debugNodes().filter(node=>ids.includes(node.id)).map(node=>[node.id,{x:node.x,y:node.y}]));
    const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
    const before=positions();
    const motionBefore=window.MefiTree.agentPositions();
    window.__motionRoster.reverse();
    window.__motionRoster.push({role:'watcher',status:'running',target:{kind:'session',id:'command_render_session'}});
    window.__motionPublish('watcher');
    window.__motionJobs.unshift({taskId:'panel_fixture_7',title:'Second fixture builder',startedAt:Date.now()});
    window.__motionStatus();
    const motionRebuilt=window.MefiTree.agentPositions();
    for(const role of ['reference','auditor']){
      if(!motionRebuilt[role]||distance(motionBefore[role],motionRebuilt[role])>0.01)throw new Error('Rebuild teleported service motion '+role);
    }
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const rebuilt=positions();
    for(const id of ids){
      if(!rebuilt[id]||!Number.isFinite(rebuilt[id].x)||Math.hypot(before[id].x-rebuilt[id].x,before[id].y-rebuilt[id].y)>30)throw new Error('Rebuild snapped painted '+id+': '+JSON.stringify({before:before[id],after:rebuilt[id]}));
    }
    const reference=window.__motionRoster.find(agent=>agent.role==='reference');
    reference.target={kind:'task',id:'panel_fixture_7'};
    const targetStart=window.MefiTree.agentPositions().reference;
    window.__motionPublish();
    const retargeted=window.MefiTree.agentPositions();
    if(distance(targetStart,retargeted.reference)>0.01)throw new Error('Retargeting snapped reference before the next frame');
    let previous=null,maxFrameStep=0,travel=0,samples=0;
    const deadline=performance.now()+750;
    while(performance.now()<deadline){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const current=window.MefiIdle.debugNodes().find(node=>node.id==='__agent__:reference');
      if(!current||!Number.isFinite(current.x)||!Number.isFinite(current.y))throw new Error('Working reference disappeared between painted frames');
      if(previous){const step=Math.hypot(current.x-previous.x,current.y-previous.y);maxFrameStep=Math.max(maxFrameStep,step);travel+=step;}
      previous=current;samples++;
    }
    if(samples<6||travel<3||maxFrameStep>travel*0.4)throw new Error('Reference movement did not interpolate across frames: '+JSON.stringify({samples,travel,maxFrameStep}));
    return {rebuildStable:true,samples,travel,maxFrameStep};
  `);
  if (process.env.MEFI_MOTION_CAPTURE && path.isAbsolute(process.env.MEFI_MOTION_CAPTURE)) {
    fs.mkdirSync(path.dirname(process.env.MEFI_MOTION_CAPTURE), { recursive: true });
    fs.writeFileSync(process.env.MEFI_MOTION_CAPTURE, (await contents.capturePage()).toPNG());
  }
  await run(`
    window.__motionRoster=window.__motionRoster.map(agent=>({...agent,status:'done'}));
    window.__motionPublish('reference','done');
    window.__motionJobs=[];window.__motionStatus();
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const returning=window.MefiIdle.debugNodes().filter(node=>node.kind==='agent');
    for(const id of ['__agent__:reference','__agent__:auditor','__agent__:watcher','builder:command_render_task','builder:panel_fixture_7']){
      if(!returning.some(node=>node.id===id&&Number.isFinite(node.x)))throw new Error('Completed agent vanished before its return animation: '+id);
    }
  `);
  try {
    await until("!window.MefiTree.snapshot().nodes.some(node=>node.kind==='agent') && window.MefiIdle.agentMotionStatus().every(node=>node.opacity<=0.02)", "completed agents finish returning and fading");
  } catch (error) {
    const remaining = await run("return {tree:window.MefiTree.agentPositions(),command:window.MefiIdle.agentMotionStatus()};");
    throw new Error(error.message + ': ' + JSON.stringify(remaining));
  }
  report.motion.completed = true;
  // Decode a real float WAV through the player and Chromium's media analyser.
  // Quiet samples retain their precision; the window stays muted and no
  // capture device is requested. Each section isolates a musical response.
  const audioDefaults = await run("return window.MefiIdle.audioStatus();");
  assert.equal(audioDefaults.response, 0.35, "fresh installs start with gentle audio response");
  assert.deepEqual(audioDefaults.effects, { waves: true, nodes: true, percussion: false, background: false, splitBands: true });
  await run(`
    window.MefiIdle.setView('2d');
    window.MefiIdle.setOrbit(false);
    // Retain strong full-mix coverage independently of the calmer defaults.
    window.MefiIdle.setAudioResponse(1);
    window.MefiIdle.setAudioEffects({percussion:true,splitBands:false});
    const rate=48000,sectionSeconds=3,samples=rate*sectionSeconds*6,buffer=new ArrayBuffer(44+samples*4),wav=new DataView(buffer);
    const ascii=(offset,text)=>{for(let i=0;i<text.length;i++)wav.setUint8(offset+i,text.charCodeAt(i));};
    ascii(0,'RIFF');wav.setUint32(4,36+samples*4,true);ascii(8,'WAVE');ascii(12,'fmt ');
    wav.setUint32(16,16,true);wav.setUint16(20,3,true);wav.setUint16(22,1,true);
    wav.setUint32(24,rate,true);wav.setUint32(28,rate*4,true);wav.setUint16(32,4,true);wav.setUint16(34,32,true);
    ascii(36,'data');wav.setUint32(40,samples*4,true);
    for(let i=0;i<samples;i++){
      const section=Math.floor(i/(rate*sectionSeconds)),t=i/rate%sectionSeconds,phase=t%0.32;
      const sine=frequency=>Math.sin(2*Math.PI*frequency*t);
      const bass=0.3*sine(96)*(0.65+0.35*Math.sin(Math.PI*t/0.4)**2);
      const kick=0.2*Math.sin(2*Math.PI*(58*phase+18*(1-Math.exp(-phase*30))/30))*Math.exp(-phase*22);
      // A short smooth attack avoids a discontinuity leaking an artificial
      // full-spectrum click into these deliberately isolated drum bands.
      const attack=1-Math.exp(-phase*400);
      const snare=0.16*(sine(1250)+sine(2180)+sine(3390))*attack*Math.exp(-phase*24);
      const hat=0.16*(sine(6100)+sine(8300))*attack*Math.exp(-phase*42);
      const mix=bass+kick+0.14*sine(960)+0.08*sine(6000)+snare+hat;
      const value=section===0?mix*0.0001:section===1?mix:section===2?bass+kick:section===3?snare:section===4?hat:0;
      wav.setFloat32(44+i*4,value,true);
    }
    if(window.MefiMusic.addFiles([new File([buffer],'Command audio fixture.wav',{type:'audio/wav'})])!==1)
      throw new Error('Player rejected the local WAV fixture');
    window.__fixtureAudio=window.MefiMusic.getAudioElement();
    window.__fixtureAudio.loop=true;
    window.MefiIdle.setAudioSource('local');
    window.MefiIdle.setMusicReactive(true);
    window.__audioAnalyserMethods={};
    window.__audioInput={fftDb:-Infinity,waveformPeak:0};
    for(const method of ['getFloatFrequencyData','getFloatTimeDomainData']){
      const base=AnalyserNode.prototype[method];
      window.__audioAnalyserMethods[method]=base;
      AnalyserNode.prototype[method]=function(buffer){
        const result=base.call(this,buffer);
        let peak=method==='getFloatFrequencyData'?-Infinity:0;
        for(const value of buffer)peak=Math.max(peak,method==='getFloatFrequencyData'?value:Math.abs(value));
        window.__audioInput[method==='getFloatFrequencyData'?'fftDb':'waveformPeak']=peak;
        return result;
      };
    }
    window.__audioPaintPaths=[];
    window.__audioCanvasMethods={};
    for(const method of ['clearRect','beginPath','moveTo','lineTo','stroke']){
      const base=CanvasRenderingContext2D.prototype[method];
      window.__audioCanvasMethods[method]=base;
      CanvasRenderingContext2D.prototype[method]=function(...args){
        if(this.canvas.id==='idle-layer'){
          if(method==='clearRect')window.__audioPaintPaths=[];
          if(method==='beginPath')window.__audioCurrentPath=[];
          if(method==='moveTo'||method==='lineTo')(window.__audioCurrentPath||=[]).push({x:args[0],y:args[1]});
          if(method==='stroke'&&window.__audioCurrentPath?.length>=8)window.__audioPaintPaths.push(window.__audioCurrentPath.slice());
        }
        return base.apply(this,args);
      };
    }
    window.__audioNodeSample=async()=>{
      // Read pixels and projections in the same renderer turn after a paint.
      // A separate host-side wait can race the graph's four-second refresh.
      ${waitForGraphPaint}
      const canvas=document.getElementById('idle-layer'),ctx=canvas.getContext('2d');
      const scaleX=canvas.width/canvas.clientWidth,scaleY=canvas.height/canvas.clientHeight;
      const waveNodes=window.MefiIdle.debugNodes().filter(node=>Number.isFinite(node.x));
      const nodes=waveNodes.filter(node=>node.kind!=='agent'&&node.kind!=='music');
      const task=nodes.find(node=>node.id==='task:command_render_task');
      if(!task)throw new Error('Audio fixture task disappeared');
      // Sample inside the stationary body, excluding labels, connections and
      // decorative outer glows, so a brighter background cannot pass this test.
      const radius=Math.max(2,task.radius*0.65),x=Math.floor((task.x-radius)*scaleX),y=Math.floor((task.y-radius)*scaleY);
      const w=Math.ceil(radius*2*scaleX),h=Math.ceil(radius*2*scaleY),pixels=ctx.getImageData(x,y,w,h).data;
      let luminance=0,count=0;
      for(let py=0;py<h;py++)for(let px=0;px<w;px++){
        if(Math.hypot((px+0.5)/scaleX-radius,(py+0.5)/scaleY-radius)>radius)continue;
        const index=(py*w+px)*4;
        luminance+=(pixels[index]*0.2126+pixels[index+1]*0.7152+pixels[index+2]*0.0722)*pixels[index+3]/255;count++;
      }
      const waves=window.MefiIdle.audioWaveStatus();
      let paintedWavePoints=0,strokedWavePaths=0;
      for(const wave of waves.connections){
        const points=wave.points,first=points[0],last=points.at(-1);
        if(!first||!last)continue;
        if(window.__audioPaintPaths.some(path=>path.length===points.length&&[0,Math.floor(points.length/2),points.length-1].every(index=>Math.hypot(path[index].x-points[index].x,path[index].y-points[index].y)<0.01)))strokedWavePaths++;
        const length=Math.hypot(last.x-first.x,last.y-first.y)||1;
        for(const point of points.slice(2,-2)){
          const offset=Math.abs((last.x-first.x)*(point.y-first.y)-(last.y-first.y)*(point.x-first.x))/length;
          if(offset<2||waveNodes.some(node=>Math.hypot(point.x-node.x,point.y-node.y)<node.radius+6))continue;
          const px=Math.round(point.x*scaleX),py=Math.round(point.y*scaleY);
          if(px<1||py<1||px>=canvas.width-1||py>=canvas.height-1)continue;
          const paint=ctx.getImageData(px-1,py-1,3,3).data;
          for(let index=0;index<paint.length;index+=4){
            if(Math.max(paint[index],paint[index+1],paint[index+2])*paint[index+3]/255>35){paintedWavePoints++;break;}
          }
        }
      }
      return {luminance:luminance/count,audio:window.MefiIdle.audioStatus(),playing:!window.__fixtureAudio.paused,
        input:{...window.__audioInput,time:window.__fixtureAudio.currentTime,volume:window.__fixtureAudio.volume},
        waves,paintedWavePoints,strokedWavePaths,waveNodes:waveNodes.map(node=>({id:node.id,x:node.x,y:node.y})),
        nodes:nodes.map(node=>({id:node.id,x:node.x,y:node.y,radius:node.radius,anchor:node.layoutAnchor,label:node.labelRect,audioResponse:node.audioResponse}))};
    };
    window.__audioSection=async section=>{
      window.__fixtureAudio.currentTime=section*sectionSeconds+0.01;
      await window.__fixtureAudio.play();
      const deadline=performance.now()+950,peaks={energy:0,kick:0,snare:0,hat:0,bassline:0,bass:0,mid:0,treble:0};
      let frames=0;
      while(performance.now()<deadline){
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const audio=window.MefiIdle.audioStatus();
        // Allow the old section's release to finish before comparing voices.
        if(performance.now()<deadline-550)continue;
        for(const key of Object.keys(peaks))peaks[key]=Math.max(peaks[key],audio[key]??audio.bands[key]??0);
        frames++;
      }
      return {peaks,frames,snapshot:await window.__audioNodeSample()};
    };
  `);
  await settledFrame();
  await sleep(650);
  // A refresh replaces projection data until the next canvas frame. Exercise
  // sampling at that exact boundary instead of depending on the polling phase.
  const audioQuiet = await run("window.dispatchEvent(new CustomEvent('mefi:tree-select')); return window.__audioNodeSample();");
  assert.equal(audioQuiet.audio.source, "local");
  assert.equal(audioQuiet.audio.listening, true);
  assert.ok(audioQuiet.audio.energy < 0.02, "a paused imported track does not invent audio energy");
  const lowLevel = await run("return window.__audioSection(0);");
  assert.ok(lowLevel.peaks.energy>0.15 && lowLevel.snapshot.luminance>audioQuiet.luminance+2,
    `very quiet decoded audio visibly animates task bodies: ${JSON.stringify({peaks:lowLevel.peaks,input:lowLevel.snapshot.input,status:lowLevel.snapshot.audio,quiet:audioQuiet.luminance,playing:lowLevel.snapshot.luminance})}`);
  const captureAudio = async (name) => {
    if (!process.env[name] || !path.isAbsolute(process.env[name])) return;
    fs.mkdirSync(path.dirname(process.env[name]), { recursive: true });
    fs.writeFileSync(process.env[name], (await contents.capturePage()).toPNG());
  };
  await captureAudio("MEFI_AUDIO_QUIET_CAPTURE");
  const loud = await run("return window.__audioSection(1);");
  const audioPlaying = loud.snapshot;
  assert.ok(loud.peaks.energy>0.15 && lowLevel.peaks.energy>loud.peaks.energy*0.35,
    "automatic level adaptation preserves meaningful response across an 80 dB input range");
  if (process.env.MEFI_AUDIO_CAPTURE && path.isAbsolute(process.env.MEFI_AUDIO_CAPTURE)) {
    fs.mkdirSync(path.dirname(process.env.MEFI_AUDIO_CAPTURE), { recursive: true });
    fs.writeFileSync(process.env.MEFI_AUDIO_CAPTURE, (await contents.capturePage()).toPNG());
  }
  await sleep(150);
  const audioNextWave = await run("return window.__audioNodeSample();");
  await captureAudio("MEFI_AUDIO_WAVE_CAPTURE");
  const waveChecks = { anchored: true, animated: false, painted: audioPlaying.paintedWavePoints, stroked: audioPlaying.strokedWavePaths };
  for (const frame of [lowLevel.snapshot, audioPlaying, audioNextWave]) {
    assert.ok(frame.waves.connections.length>0 && frame.strokedWavePaths>0,
      "audio wave samples are actually stroked through the real canvas context");
    for (const wave of frame.waves.connections) {
      assert.ok(wave.points.length>=8 && wave.points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)),
        "wave connections have finite interior geometry");
      const first=wave.points[0],last=wave.points.at(-1);
      for (const [id,point] of [[wave.from,first],[wave.to,last]]) {
        const node=frame.waveNodes.find(candidate=>candidate.id===id);
        assert.ok(node && Math.hypot(node.x-point.x,node.y-point.y)<0.1,
          `audio wave endpoint stays attached to ${id}`);
      }
      const next=audioNextWave.waves.connections.find(candidate=>candidate.from===wave.from&&candidate.to===wave.to);
      if(frame===audioPlaying&&next&&wave.points.some((point,index)=>next.points[index]&&Math.hypot(next.points[index].x-point.x,next.points[index].y-point.y)>1))waveChecks.animated=true;
    }
  }
  assert.ok(waveChecks.animated, "wave crests move along connections between two painted frames");
  assert.ok(audioPlaying.paintedWavePoints>3 && lowLevel.snapshot.paintedWavePoints>3,
    `both quiet and loud input paint displaced wave pixels away from nodes: ${JSON.stringify({quiet:lowLevel.snapshot.paintedWavePoints,loud:audioPlaying.paintedWavePoints})}`);
  const bassline = await run("return window.__audioSection(2);");
  const snare = await run("return window.__audioSection(3);");
  const hat = await run("return window.__audioSection(4);");
  for(const [name,section] of Object.entries({bassline,snare,hat}))assert.ok(section.frames>=6 && section.peaks.energy>0.1,
    `${name} input independently animates the graph`);
  assert.ok(bassline.peaks.bass>bassline.peaks.treble*1.4 && bassline.peaks.kick>0.04 && bassline.peaks.bassline>0.1,
    `bass notes and kick attacks reach separate musical responses: ${JSON.stringify(bassline.peaks)}`);
  assert.ok(snare.peaks.mid>snare.peaks.bass*1.4 && snare.peaks.snare>0.04,
    `midrange drum attacks work without a bass track: ${JSON.stringify(snare.peaks)}`);
  assert.ok(hat.peaks.treble>hat.peaks.bass*1.4 && hat.peaks.hat>0.04,
    `high hat attacks work without a bass track: ${JSON.stringify(hat.peaks)}`);
  await run("window.__fixtureAudio.currentTime=15.01;");
  await until("window.MefiIdle.audioStatus().energy<0.02 && window.MefiIdle.debugNodes().find(node=>node.id==='task:command_render_task')?.audioResponse?.level<0.02", "digital silence releases node and connection responses while playback continues");
  const audioSilence = await run("return window.__audioNodeSample();");
  assert.equal(audioSilence.playing, true, "silence is checked while the player is still running");
  assert.ok(audioSilence.waves.connections.every(wave=>wave.amplitude<1.5), "silent playback releases visible connection displacement");
  await run("window.__fixtureAudio.pause();");
  await until("window.MefiIdle.audioStatus().energy<0.02 && window.MefiIdle.debugNodes().find(node=>node.id==='task:command_render_task')?.audioResponse?.level<0.02", "paused audio releases its node response");
  const audioPaused = await run("return window.__audioNodeSample();");
  for (const band of ["bass", "mid", "treble"]) assert.ok(audioPlaying.audio.bands[band] > 0.08, `${band} reaches the real analyser`);
  assert.ok(audioPlaying.luminance > audioQuiet.luminance + 2 && audioPlaying.luminance > audioPaused.luminance + 2,
    `local playback brightens the painted task body and pausing releases it: ${JSON.stringify({quiet:audioQuiet.luminance,playing:audioPlaying.luminance,paused:audioPaused.luminance})}`);
  for (const before of audioQuiet.nodes) {
    for (const frame of [lowLevel.snapshot, audioPlaying, audioNextWave, bassline.snapshot, snare.snapshot, hat.snapshot, audioSilence, audioPaused]) {
      const after=frame.nodes.find(node=>node.id===before.id);
      assert.ok(after, `${before.id} remains present during audio playback`);
      assert.ok(Math.hypot(after.x-before.x,after.y-before.y)<0.1, `${before.id} stays still while its surface responds`);
      assert.equal(after.radius, before.radius, `${before.id} retains its layout clearance`);
      assert.deepEqual(after.anchor, before.anchor, `${before.id} retains its layout anchor`);
      assert.deepEqual(after.label, before.label, `${before.id} retains its label position`);
    }
  }
  assert.ok(audioPlaying.nodes.every(node=>node.audioResponse?.level>0.02), "all ordinary graph nodes respond to the connected track");
  report.audio = {defaults:audioDefaults,quiet:audioQuiet,lowLevel,loud,playing:audioPlaying,nextWave:audioNextWave,bassline,snare,hat,silence:audioSilence,paused:audioPaused,waveChecks,stableGeometry:true};
  await run(`
    window.MefiIdle.setAudioResponse(.35);
    window.MefiIdle.setAudioEffects({waves:true,nodes:true,percussion:false,background:false,splitBands:true});
    window.MefiMusic.open();
    window.__audioCaptureCalls=[];
    window.__audioCaptureMethods={};
    for(const method of ['getUserMedia','getDisplayMedia']){
      if(!navigator.mediaDevices?.[method])continue;
      window.__audioCaptureMethods[method]=navigator.mediaDevices[method];
      navigator.mediaDevices[method]=()=>{window.__audioCaptureCalls.push(method);return Promise.reject(new Error('Audio controls requested capture'));};
    }
    window.__audioControlSource={src:window.__fixtureAudio.src,volume:window.__fixtureAudio.volume};
    window.__audioControlSample=async()=>{
      ${waitForGraphPaint}
      return {
      audio:window.MefiIdle.audioStatus(),playing:!window.__fixtureAudio.paused,
      sourceStable:window.__fixtureAudio.src===window.__audioControlSource.src&&window.__fixtureAudio.volume===window.__audioControlSource.volume,
      checked:Object.fromEntries(['waves','nodes','percussion','background','splitBands'].map(key=>[key,document.getElementById('music-audio-'+key).checked])),
      response:document.getElementById('music-audio-response').value,
      nodeLevels:window.MefiIdle.debugNodes().filter(node=>node.kind!=='agent').map(node=>node.audioResponse?.level??0),
      connections:window.MefiIdle.audioWaveStatus().connections.map(({from,to,band,amplitude})=>({from,to,band,amplitude})),
      captureCalls:window.__audioCaptureCalls.slice()
      };
    };
    await window.__audioSection(1);
  `);
  await settledFrame();
  const audioControls = { initial: await run("return window.__audioControlSample();") };
  assert.ok(audioControls.initial.connections.length > 0 && audioControls.initial.nodeLevels.some(level=>level>0.02));
  await run("document.getElementById('music-audio-waves').click();");
  await settledFrame();
  audioControls.wavesOff = await run("return window.__audioControlSample();");
  assert.equal(audioControls.wavesOff.connections.length, 0, "turning off connection waves removes every reactive path");
  assert.equal(audioControls.wavesOff.checked.nodes, true, "the wave switch leaves node glow enabled");
  assert.ok(audioControls.wavesOff.nodeLevels.some(level=>level>0.02), "nodes keep responding with waves off");
  await run("document.getElementById('music-audio-waves').click();document.getElementById('music-audio-nodes').click();");
  await settledFrame();
  audioControls.nodesOff = await run("return window.__audioControlSample();");
  assert.ok(audioControls.nodesOff.connections.length > 0, "connection waves keep moving with node glow off");
  assert.equal(audioControls.nodesOff.checked.waves, true);
  assert.ok(audioControls.nodesOff.nodeLevels.every(level=>level===0), "turning off node glow clears every node response");
  await run(`
    document.getElementById('music-audio-nodes').click();
    const input=document.getElementById('music-audio-response');input.value='0';input.dispatchEvent(new Event('input',{bubbles:true}));
  `);
  await settledFrame();
  audioControls.zero = await run("return window.__audioControlSample();");
  assert.equal(audioControls.zero.audio.response, 0, "native slider input retains numeric zero");
  assert.equal(audioControls.zero.connections.length, 0);
  assert.ok(audioControls.zero.nodeLevels.every(level=>level===0), "zero stops node effects while sound keeps playing");
  await run(`
    const input=document.getElementById('music-audio-response');input.value='0.35';input.dispatchEvent(new Event('input',{bubbles:true}));
    window.__fixtureAudio.currentTime=3.1;
  `);
  await settledFrame();
  audioControls.restored = await run("return window.__audioControlSample();");
  const bandMapping = new Map(audioControls.restored.connections.map(wave=>[wave.from+':'+wave.to,wave.band]));
  assert.ok(new Set(bandMapping.values()).size>=2, "separate frequency lines distribute this graph across multiple bands");
  await sleep(120);
  const splitLater = await run("return window.__audioControlSample();");
  for(const wave of splitLater.connections)assert.equal(wave.band,bandMapping.get(wave.from+':'+wave.to), "each connection keeps its frequency between frames");
  await run("document.getElementById('music-audio-splitBands').click();");
  await settledFrame();
  audioControls.fullMix = await run("return window.__audioControlSample();");
  assert.ok(audioControls.fullMix.connections.length>0 && audioControls.fullMix.connections.every(wave=>wave.band==='mix'), "frequency toggle can return every connection to the full mix");
  await run("document.getElementById('music-audio-splitBands').click();");
  await settledFrame();
  audioControls.splitAgain = await run("return window.__audioControlSample();");
  for(const wave of audioControls.splitAgain.connections)assert.equal(wave.band,bandMapping.get(wave.from+':'+wave.to), "frequency assignments survive toggling the feature");
  for(const [name,sample] of Object.entries(audioControls)){
    assert.ok(sample.playing && sample.sourceStable, `${name}: visual controls leave local playback and volume unchanged`);
    assert.equal(sample.audio.selection, "local");assert.equal(sample.audio.source, "local");
    assert.deepEqual(sample.captureCalls, [], `${name}: visual controls never request a capture device`);
  }
  report.audio.controls = audioControls;
  await captureAudio("MEFI_AUDIO_CONTROLS_CAPTURE");
  await run("window.MefiMusic.close();");
  await run(`
    window.MefiIdle.setMusicReactive(false);
    window.__fixtureAudio.pause();
    for(const [method,base] of Object.entries(window.__audioCaptureMethods))navigator.mediaDevices[method]=base;
    for(const [method,base] of Object.entries(window.__audioCanvasMethods))CanvasRenderingContext2D.prototype[method]=base;
    for(const [method,base] of Object.entries(window.__audioAnalyserMethods))AnalyserNode.prototype[method]=base;
    for(const key of ['__audioNodeSample','__audioSection','__fixtureAudio','__audioPaintPaths','__audioCurrentPath','__audioCanvasMethods','__audioAnalyserMethods','__audioInput','__audioControlSample','__audioControlSource','__audioCaptureCalls','__audioCaptureMethods'])delete window[key];
  `);
  await run("window.MefiNav.go('booklet');");
  const visibleRailFrames = await run("return window.__railPaintFrames;");
  await until(`window.__railPaintFrames>=${visibleRailFrames + 3}`, "visible rail resumes painting");
  report.railResumed = true;
  report.exited = await run("return !window.MefiIdle.isActive() && document.getElementById('idle-layer').hidden;");
  report.stoppedFrames = await run("return window.__commandPaintFrames;");
  await sleep(120);
  assert.equal(await run("return window.__commandPaintFrames;"), report.stoppedFrames, "exit cancels the Command paint loop");
  await run("window.MefiNav.go('command'); await window.MefiIdle.ready();");
  await until(`window.__commandPaintFrames>=${report.stoppedFrames + 3}`, "paint loop restarts on reentry");
  report.reentered = await snapshot();
  // Exercise both real controls against an in-memory preference bridge. This
  // never opens Studio's host, saved settings, task stores or coding workers.
  await run(`
    window.commandFixture.publishStatus({enabled:false,execute:false,mode:'swarm',autoBuild:true,parallel:2,running:[],history:[]});
    window.MefiNav.go('workspace');
    await window.MefiWorkspace.refresh(true);
  `);
  await until("!document.getElementById('workspace-agent-mode').disabled", "Home agent mode loaded");
  report.agentModes = { layouts: [] };
  report.agentModes.homeSaving = await run(`
    const control=document.getElementById('workspace-agent-mode');
    if(control.value!=='swarm')throw new Error('Home missed saved Swarm mode');
    control.value='cluster';control.dispatchEvent(new Event('change',{bubbles:true}));
    return control.disabled && control.getAttribute('aria-busy')==='true';
  `);
  await until("!document.getElementById('workspace-agent-mode').disabled && document.getElementById('workspace-agent-mode').value==='cluster'", "Home saves Cluster");
  await run(`window.MefiNav.go('command');await window.MefiIdle.ready();`);
  await setPanels(false, false);
  await until("!document.getElementById('idle-feed-agent-mode').disabled && document.getElementById('idle-feed-agent-mode').value==='cluster'", "Command reflects Home selection");
  report.agentModes.commandSaving = await run(`
    const control=document.getElementById('idle-feed-agent-mode');
    if(!control.closest('.cmd-tools')||control.closest('#idle-feed'))throw new Error('Agent mode must be in the node tree toolbar');
    if(document.getElementById('idle-feed-toggle').getAttribute('aria-expanded')!=='false')throw new Error('Live work must be collapsed before changing mode');
    control.focus();
    if(document.activeElement!==control)throw new Error('Collapsed Live work hid the mode selector from keyboard focus');
    control.value='swarm';control.dispatchEvent(new Event('change',{bubbles:true}));
    return control.disabled && control.getAttribute('aria-busy')==='true';
  `);
  await until("!document.getElementById('idle-feed-agent-mode').disabled && document.getElementById('idle-feed-agent-mode').value==='swarm'", "Command saves Swarm");
  await run(`
    window.commandFixture.publishAssistant({status:'running',messages:[],prefs:{},work:[],agents:[{role:'cluster-planner',status:'running',text:'Checking the focused task'}]});
    window.commandFixture.publishStatus({...window.commandFixture.status(),mode:'cluster',clusterFocus:{source:'task',id:'command_render_task',title:'Verify real node painting'},clusterAgents:[{id:'planner',role:'planner',status:'running',taskId:'command_render_task',taskTitle:'Verify real node painting',step:'Checking the focused task'}]});
  `);
  await until("document.getElementById('idle-feed-agents-count').textContent==='1 working' && document.getElementById('idle-feed-now').textContent.includes('Task preparation')", "Cluster helper appears once with its real phase");
  report.agentModes.helperCount = await run("return document.getElementById('idle-feed-agents').children.length;");
  const modeLayout = async (id, label) => {
    const command = id === "idle-feed-agent-mode";
    const layout = await run(`
      const control=document.getElementById(${JSON.stringify(id)});
      if(!${command})control.scrollIntoView({block:'center',inline:'nearest'});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const box=control.getBoundingClientRect();
      const controls=[...document.querySelectorAll(${JSON.stringify(command ? ".cmd-tools button, .cmd-tools select, .cmd-tools input" : ".ws-backlog select, .ws-backlog input")})].filter(item=>item.getBoundingClientRect().width>0).map(item=>({id:item.id,...item.getBoundingClientRect().toJSON()}));
      const onTree=!!control.closest('.cmd-tools')&&!control.closest('#idle-feed');
      const feedCollapsed=document.getElementById('idle-feed-toggle').getAttribute('aria-expanded')==='false';
      const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
      return {label:${JSON.stringify(label)},width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,box:box.toJSON(),controls,onTree,feedCollapsed,reachable:hit===control||control.contains(hit)};
    `);
    report.agentModes.layouts.push(layout);
    assert.ok(layout.box.width > 70 && layout.box.height >= 28, `${label}: usable mode selector`);
    assert.ok(layout.box.x >= 0 && layout.box.right <= layout.width && layout.box.y >= 0 && layout.box.bottom <= layout.height, `${label}: mode selector fits the visible viewport`);
    assert.ok(layout.scroll <= layout.width + 2, `${label}: no horizontal overflow`);
    if (command) {
      assert.ok(layout.onTree && layout.feedCollapsed, `${label}: mode stays on the tree with Live work collapsed`);
      assert.ok(layout.reachable, `${label}: mode selector receives pointer input`);
      for (const control of layout.controls) assert.ok(control.x >= 0 && control.right <= layout.width && control.y >= 0 && control.bottom <= layout.height, `${label}: ${control.id} fits the visible toolbar`);
    }
    for (const [index, control] of layout.controls.entries()) for (const other of layout.controls.slice(index + 1)) {
      assert.ok(Math.min(control.right, other.right)-Math.max(control.x, other.x)<=1 || Math.min(control.bottom, other.bottom)-Math.max(control.y, other.y)<=1, `${label}: ${control.id} and ${other.id} do not overlap`);
    }
  };
  await modeLayout("idle-feed-agent-mode", "Command desktop with Live work collapsed");
  window.setContentSize(600, 800); await sleep(120);
  await modeLayout("idle-feed-agent-mode", "Command narrow with Live work collapsed");
  await run("window.MefiNav.go('workspace');await window.MefiWorkspace.refresh(true);");
  await modeLayout("workspace-agent-mode", "Home narrow");
  window.setContentSize(1280, 800); await sleep(120);
  await modeLayout("workspace-agent-mode", "Home desktop");
  report.agentModes.patches = await run("return window.commandFixture.modePatches();");
  report.agentModes.paused = await run("return window.commandFixture.status().execute===false && window.commandFixture.status().enabled===false;");
  assert.deepEqual(report.agentModes.patches, [{mode:"cluster"},{mode:"swarm"}]);
  assert.equal(report.agentModes.homeSaving && report.agentModes.commandSaving && report.agentModes.paused, true);
  // The New work switch uses actual rendered controls and the isolated bridge.
  // Its synthetic worker remains present while pausing admission of new work.
  await run(`
    window.commandFixture.publishAssistant({status:'paused',messages:[],prefs:{proactive:false,backlogMode:false},work:[],agents:[{role:'watcher',status:'running',text:'watching the rail split'}]});
    window.commandFixture.publishStatus({enabled:false,execute:false,mode:'cluster',autoBuild:false,parallel:2,adaptiveParallel:false,running:[{id:'toggle-live-worker',taskId:'command_render_task',title:'Synthetic worker already running',startedAt:Date.now()-1000,pid:987}],history:[]});
    window.MefiNav.go('command');await window.MefiIdle.ready();
  `);
  await setPanels(true, true);
  await run(`
    const assistant=window.MefiIdle.debugNodes().find(node=>node.kind==='assistant');
    if(!assistant)throw new Error('Missing assistant node for New work control');
    window.MefiIdle.select(assistant.id);
  `);
  await until("!document.getElementById('cmd-chat-new-work').disabled && !document.getElementById('cmd-chat-new-work').checked", "New work loads paused and workers off");
  // The readable roster band belongs to the work view: selecting the assistant
  // swaps the rail to its tab, and returning to Work shows the console in the
  // feed's place. The roster band hides with the activity stream there, even
  // with a running agent in the roster.
  await run(`
    document.getElementById('cmd-rail-tab-work').click();
    window.commandFixture.publishStatus(window.commandFixture.status());
  `);
  await until("!document.getElementById('idle-feed-chat').hidden && document.getElementById('idle-feed-activity').hidden", "returning to Work shows the console in the feed's place");
  report.chatPanel = await run("return {chat:!document.getElementById('idle-feed-chat').hidden,activity:document.getElementById('idle-feed-activity').hidden,roster:document.getElementById('idle-feed-agent-section').hidden,rosterRows:document.getElementById('idle-feed-agents').children.length,tab:document.querySelector('.rail-tab[aria-selected=\"true\"]')?.dataset.railView};");
  assert.deepEqual(report.chatPanel, { chat: true, activity: true, roster: true, rosterRows: 1, tab: "work" }, "chat mode hides the agent roster band with the activity stream");
  await run("document.getElementById('cmd-rail-tab-assistant').click();");
  const toggleState = () => run(`
    const controls=['cmd-chat-new-work','idle-chat-pause'].map(id=>{
      const input=document.getElementById(id),label=input.closest('.new-work-toggle');
      return {id,checked:input.checked,disabled:input.disabled,busy:input.getAttribute('aria-busy'),role:input.getAttribute('role'),text:label.textContent.trim()};
    });
    return {controls,status:window.commandFixture.status(),assistant:window.commandFixture.assistantState()};
  `);
  report.newWork = { layouts: [], before: await toggleState(), saving: [] };
  const newWorkLayout = async (id, label) => {
    const layout = await run(`
      const input=document.getElementById(${JSON.stringify(id)}),label=input.closest('.new-work-toggle'),track=label.querySelector('.track');
      const box=label.getBoundingClientRect(),trackBox=track.getBoundingClientRect(),style=getComputedStyle(label);
      const hit=document.elementFromPoint(trackBox.x+trackBox.width/2,trackBox.y+trackBox.height/2);
      return {id:input.id,label:${JSON.stringify(label)},width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,box:box.toJSON(),track:trackBox.toJSON(),text:label.textContent.trim(),visible:style.display!=='none'&&style.visibility!=='hidden',reachable:hit===label||label.contains(hit)};
    `);
    report.newWork.layouts.push(layout);
    assert.ok(layout.visible && layout.box.width > 70 && layout.box.height >= 14, `${label}: visible labelled New work switch`);
    assert.match(layout.text, /New work/);
    assert.ok(layout.box.x >= 0 && layout.box.right <= layout.width && layout.box.y >= 0 && layout.box.bottom <= layout.height, `${label}: switch fits the visible viewport`);
    assert.ok(layout.reachable, `${label}: pointer reaches the switch track`);
    assert.ok(layout.scroll <= layout.width + 2, `${label}: no horizontal overflow`);
  };
  for (const [width, label] of [[1280, "desktop"], [600, "narrow"]]) {
    window.setContentSize(width, 800); await sleep(150);
    await newWorkLayout("cmd-chat-new-work", `Assistant ${label}`);
    report.newWork.saving.push(await run(`
      document.getElementById('cmd-chat-new-work').closest('.new-work-toggle').click();
      return ['cmd-chat-new-work','idle-chat-pause'].every(id=>{
        const input=document.getElementById(id);
        return input.disabled&&input.getAttribute('aria-busy')==='true'&&input.closest('.new-work-toggle').textContent.includes('Saving…');
      });
    `));
    await until("['cmd-chat-new-work','idle-chat-pause'].every(id=>document.getElementById(id).checked&&!document.getElementById(id).disabled)", `New work enables both ${label} controls`);
    report.newWork[`${label}On`] = await toggleState();
    await run("document.getElementById('cmd-chat-new-work').closest('.new-work-toggle').click();");
    await until("['cmd-chat-new-work','idle-chat-pause'].every(id=>!document.getElementById(id).checked&&!document.getElementById(id).disabled)", `New work pauses both ${label} controls`);
    report.newWork[`${label}Off`] = await toggleState();
    if (process.env.MEFI_NEW_WORK_CAPTURE_DIR && path.isAbsolute(process.env.MEFI_NEW_WORK_CAPTURE_DIR)) {
      fs.mkdirSync(process.env.MEFI_NEW_WORK_CAPTURE_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.MEFI_NEW_WORK_CAPTURE_DIR, `new-work-${label}.png`), (await contents.capturePage()).toPNG());
    }
  }
  report.newWork.actions = await run("return window.commandFixture.assistantActions();");
  assert.deepEqual(report.newWork.actions, ["start-work", "pause", "start-work", "pause"]);
  assert.ok(report.newWork.saving.every(Boolean), "both New work switches show the pending save");
  // The merged right rail: one view at a time across Work / Assistant / Done /
  // Ask, the done log reads the durable ledger, and an Ask card answers through
  // the host bridge instead of typing into the thread.
  await run(`
    window.commandFixture.publishAssistant({status:'running',messages:[],prefs:{},work:[],agents:[],questions:[
      {id:'q_fixture',at:Date.now(),kind:'question',source:'build',title:'Retry the failed build?',detail:'The worker stopped early.',status:'open',options:[
        {id:'retry',label:'Retry once more',recommended:true,action:{kind:'backlog',action:'retry',payload:{taskId:'command_render_task'}}},
        {id:'hold',label:'Leave it for review',dismiss:true}
      ]}
    ]});
  `);
  await until("document.getElementById('cmd-rail-ask-badge') && !document.getElementById('cmd-rail-ask-badge').hidden", "Ask badge counts the open question");
  await run("document.getElementById('cmd-rail-tab-done').click();");
  await until("!document.getElementById('cmd-done').hidden && document.getElementById('idle-feed').hidden", "Done tab shows its view alone");
  await until("document.querySelectorAll('#cmd-done-list .done-row').length>=2", "the done log renders durable records");
  report.rail = { doneRows: await run("return document.querySelectorAll('#cmd-done-list .done-row').length;") };
  // Collapse tucks the list away while the head keeps the count and Absorb;
  // Absorb then flies the records into the button and clears them on the host.
  const shot = async (name) => {
    if (!process.env.MEFI_DONE_CAPTURE_DIR || !path.isAbsolute(process.env.MEFI_DONE_CAPTURE_DIR)) return;
    fs.mkdirSync(process.env.MEFI_DONE_CAPTURE_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.MEFI_DONE_CAPTURE_DIR, `${name}.png`), (await contents.capturePage()).toPNG());
  };
  await run("document.getElementById('cmd-done-toggle').click();");
  await until("document.getElementById('cmd-done').classList.contains('done-collapsed') && getComputedStyle(document.getElementById('cmd-done-list')).display==='none'", "the done log collapses to its head");
  await shot("done-collapsed");
  await run("document.getElementById('cmd-done-toggle').click();");
  await until("!document.getElementById('cmd-done').classList.contains('done-collapsed') && getComputedStyle(document.getElementById('cmd-done-list')).display!=='none'", "the done log expands again");
  await run("document.getElementById('cmd-done-absorb').click();");
  await sleep(340);
  await shot("absorb-mid");
  await until("window.commandFixture.doneAbsorbs()===1 && document.querySelector('#cmd-done-list .done-empty')!==null", "Absorb clears the done log through the host");
  await shot("absorb-done");
  report.rail.absorbed = await run("return window.commandFixture.doneAbsorbs();");
  await run("document.getElementById('cmd-rail-tab-ask').click();");
  await until("!document.getElementById('cmd-asks').hidden && document.querySelector('#cmd-ask-list .ask-option[data-recommended=\"true\"]')!==null", "Ask tab renders the recommended option");
  await run("document.querySelector('#cmd-ask-list .ask-option[data-recommended=\"true\"]').click();");
  await until("window.commandFixture.questionAnswers().length===1", "the recommended option answers through the host");
  report.rail.answers = await run("return window.commandFixture.questionAnswers();");
  await run("document.getElementById('cmd-rail-tab-work').click();");
  await until("!document.getElementById('idle-feed').hidden && document.getElementById('cmd-done').hidden && document.getElementById('cmd-asks').hidden", "Work tab returns the live-work view");
  report.rail.active = await run("return document.querySelector('.rail-tab[aria-selected=\"true\"]')?.dataset.railView;");
  assert.equal(report.rail.doneRows >= 2, true, "the done log lists the ledger records");
  assert.equal(report.rail.absorbed, 1, "Absorb reaches the host and empties the list");
  assert.equal(report.rail.active, "work");
  assert.equal(report.rail.answers.length, 1);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.networkAttempts, []);
  assert.deepEqual(report.processAttempts, []);
  finish();
}).catch(finish);
