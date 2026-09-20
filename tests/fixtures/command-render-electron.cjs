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
      { id: "group_fixture", title: "Renderer task group", status: "open", members: [{ id: "group_saved", title: "Saved requirement", prompt: "Retain this full requirement", logs: [{ text: "Earlier work is preserved" }] }, { id: "group_verify", title: "Verify grouped work" }] },
      { id: "group_saved", title: "Saved requirement", status: "absorbed", absorbedInto: "group_fixture" },
      { id: "group_verify", title: "Verify grouped work", status: "awaiting_verification", absorbedInto: "group_fixture" },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `panel_fixture_${index}`, title: `Panel clearance task ${index + 1}`, status: "open", createdAt: now, updatedAt: now })),
    ] },
    ideasList: { ok: true, ideas: [] },
    prefsGet: { ok: true, prefs: { commandHome: false } },
    assistantState: { ok: true, state: { status: "paused", agents: [], messages: [], prefs: {}, work: [] } },
    assistantStatus: { ok: true, status: { enabled: false, execute: false, parallel: 1, running: [], history: [] } },
    eyesCheckpointsRead: { ok: true, checkpoints: {} },
    eyesRequestsRead: { ok: true, requests: [] },
    eyesBriefingRead: { ok: true, briefing: null },
    eyesCollisions: { ok: true, collisions: [], presence: [] },
    backlogStatus: { ok: true, counts: { ready: 1, running: 0, verifying: 0, blocked: 0 }, next: [] },
    speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
  };
  const preload = path.join(root, "read-only-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require("electron");
    const responses=${JSON.stringify(responses)};
    const listeners={onAssistant:[],onAssistantStatus:[]};
    contextBridge.exposeInMainWorld("mefiStudio",{
      ...Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>{if(key==='eyesCollisions')await new Promise(resolve=>setTimeout(resolve,5000));return responses[key];}])),
      ...Object.fromEntries(Object.keys(listeners).map(key=>[key,callback=>{listeners[key].push(callback);return()=>{};}]))
    });
    contextBridge.exposeInMainWorld("commandFixture",{
      publishAssistant:(state,event)=>{responses.assistantState={ok:true,state};for(const callback of listeners.onAssistant)callback({state,event});},
      publishStatus:status=>{responses.assistantStatus={ok:true,status};for(const callback of listeners.onAssistantStatus)callback(status);}
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
      assert.deepEqual(report.errors, [], `Renderer errors before ${label}`);
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
  // Import a real, local PCM track through the player and Chromium's media
  // analyser. The fixture window stays muted; no capture device is requested.
  await run(`
    window.MefiIdle.setView('2d');
    window.MefiIdle.setOrbit(false);
    const rate=48000,samples=rate,buffer=new ArrayBuffer(44+samples*2),wav=new DataView(buffer);
    const ascii=(offset,text)=>{for(let i=0;i<text.length;i++)wav.setUint8(offset+i,text.charCodeAt(i));};
    ascii(0,'RIFF');wav.setUint32(4,36+samples*2,true);ascii(8,'WAVE');ascii(12,'fmt ');
    wav.setUint32(16,16,true);wav.setUint16(20,1,true);wav.setUint16(22,1,true);
    wav.setUint32(24,rate,true);wav.setUint32(28,rate*2,true);wav.setUint16(32,2,true);wav.setUint16(34,16,true);
    ascii(36,'data');wav.setUint32(40,samples*2,true);
    for(let i=0;i<samples;i++){
      const t=i/rate,value=0.2*(Math.sin(2*Math.PI*96*t)+Math.sin(2*Math.PI*960*t)+Math.sin(2*Math.PI*6000*t));
      wav.setInt16(44+i*2,Math.round(value*32767),true);
    }
    if(window.MefiMusic.addFiles([new File([buffer],'Command audio fixture.wav',{type:'audio/wav'})])!==1)
      throw new Error('Player rejected the local WAV fixture');
    window.__fixtureAudio=window.MefiMusic.getAudioElement();
    window.__fixtureAudio.loop=true;
    window.MefiIdle.setAudioSource('local');
    window.MefiIdle.setMusicReactive(true);
    window.__audioNodeSample=()=>{
      const canvas=document.getElementById('idle-layer'),ctx=canvas.getContext('2d');
      const scaleX=canvas.width/canvas.clientWidth,scaleY=canvas.height/canvas.clientHeight;
      const nodes=window.MefiIdle.debugNodes().filter(node=>node.kind!=='agent'&&node.kind!=='music'&&Number.isFinite(node.x));
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
      return {luminance:luminance/count,audio:window.MefiIdle.audioStatus(),playing:!window.__fixtureAudio.paused,
        nodes:nodes.map(node=>({id:node.id,x:node.x,y:node.y,radius:node.radius,anchor:node.layoutAnchor,label:node.labelRect,audioResponse:node.audioResponse}))};
    };
  `);
  await settledFrame();
  await sleep(650);
  const audioQuiet = await run("return window.__audioNodeSample();");
  assert.equal(audioQuiet.audio.source, "local");
  assert.equal(audioQuiet.audio.listening, true);
  assert.ok(audioQuiet.audio.energy < 0.02, "a paused imported track does not invent audio energy");
  await run("await window.__fixtureAudio.play();");
  await until("window.MefiIdle.audioStatus().energy>0.15 && window.MefiIdle.debugNodes().find(node=>node.id==='task:command_render_task')?.audioResponse?.level>0.08", "local audio drives a painted task node");
  await sleep(180);
  const audioPlaying = await run("return window.__audioNodeSample();");
  if (process.env.MEFI_AUDIO_CAPTURE && path.isAbsolute(process.env.MEFI_AUDIO_CAPTURE)) {
    fs.mkdirSync(path.dirname(process.env.MEFI_AUDIO_CAPTURE), { recursive: true });
    fs.writeFileSync(process.env.MEFI_AUDIO_CAPTURE, (await contents.capturePage()).toPNG());
  }
  await run("window.__fixtureAudio.pause();");
  await until("window.MefiIdle.audioStatus().energy<0.02 && window.MefiIdle.debugNodes().find(node=>node.id==='task:command_render_task')?.audioResponse?.level<0.02", "paused audio releases its node response");
  const audioPaused = await run("return window.__audioNodeSample();");
  for (const band of ["bass", "mid", "treble"]) assert.ok(audioPlaying.audio.bands[band] > 0.08, `${band} reaches the real analyser`);
  assert.ok(audioPlaying.luminance > audioQuiet.luminance + 2 && audioPlaying.luminance > audioPaused.luminance + 2,
    `local playback brightens the painted task body and pausing releases it: ${JSON.stringify({quiet:audioQuiet.luminance,playing:audioPlaying.luminance,paused:audioPaused.luminance})}`);
  for (const before of audioQuiet.nodes) {
    for (const frame of [audioPlaying, audioPaused]) {
      const after=frame.nodes.find(node=>node.id===before.id);
      assert.ok(after, `${before.id} remains present during audio playback`);
      assert.ok(Math.hypot(after.x-before.x,after.y-before.y)<0.1, `${before.id} stays still while its surface responds`);
      assert.equal(after.radius, before.radius, `${before.id} retains its layout clearance`);
      assert.deepEqual(after.anchor, before.anchor, `${before.id} retains its layout anchor`);
      assert.deepEqual(after.label, before.label, `${before.id} retains its label position`);
    }
  }
  assert.ok(audioPlaying.nodes.every(node=>node.audioResponse?.level>0.02), "all ordinary graph nodes respond to the connected track");
  report.audio = {quiet:audioQuiet,playing:audioPlaying,paused:audioPaused,stableGeometry:true};
  if (process.env.MEFI_AUDIO_CONTROLS_CAPTURE && path.isAbsolute(process.env.MEFI_AUDIO_CONTROLS_CAPTURE)) {
    await run("window.MefiMusic.open();");
    await sleep(300);
    fs.mkdirSync(path.dirname(process.env.MEFI_AUDIO_CONTROLS_CAPTURE), { recursive: true });
    fs.writeFileSync(process.env.MEFI_AUDIO_CONTROLS_CAPTURE, (await contents.capturePage()).toPNG());
    await run("window.MefiMusic.close();");
  }
  await run("window.MefiIdle.setMusicReactive(false); delete window.__audioNodeSample; delete window.__fixtureAudio;");
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
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.networkAttempts, []);
  assert.deepEqual(report.processAttempts, []);
  finish();
}).catch(finish);
