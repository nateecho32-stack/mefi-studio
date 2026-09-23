"use strict";

const { app, BrowserWindow, ipcMain, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_PROFILE_WORKLOAD;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated workload directory is required");
const config = JSON.parse(fs.readFileSync(path.join(root, "workload.json"), "utf8"));
const width = config.width ?? 1280;
const height = config.height ?? 900;
// One run per scenario, or per scenario and node style ("command-30-3d-sigil").
const runs = config.scenarios.flatMap((name) => (config.styles?.length ? config.styles : [null]).map((style) => ({ name, style, id: style ? `${name}-${style}` : name })));
const report = { schemaVersion: 1, configuration: { ...config, rendering: `Electron offscreen, software rendering, ${width}x${height}${config.capture ? " at device scale factor 1" : ""}, 60Hz callback target; Command draws about 30Hz`, note: "Synthetic task graph rendered by production code; no injected stalls. Timings are diagnostic, not performance assertions." }, scenarios: [], errors: [], networkAttempts: [], processAttempts: [] };
const started = Date.now();
app.setName("Studio Isolated Performance Workload");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath(name, directory);
}
app.disableHardwareAcceleration();
// Captures are compared image to image, so they ignore the display's scale.
if (config.capture) app.commandLine.appendSwitch("force-device-scale-factor", "1");
const childProcess = require("node:child_process");
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[method] = () => {
  report.processAttempts.push(method);
  throw new Error("Child processes are disabled in the isolated performance workload");
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  if (error) report.failure = error.stack || String(error);
  report.elapsedMs = Date.now() - started;
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  if (error) console.error(report.failure);
  app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);

// A linked member's status. MefiCommunity only answers has("premium") when the
// bridge has communityStatus, so the Void collection's styles are allowed.
const COMMUNITY_STATUS = { ok: true, status: { entitlement: { premium: true, perks: ["premium"], validUntil: null } } };

// The numeric workloads: a chain of open tasks, sessions with one todo in
// progress each, two roster agents and one builder.
function loadWorkload(name, now) {
  const [, countText, view] = name.split("-");
  const count = Number(countText);
  const tasks = Array.from({ length: count }, (_, index) => ({ id: `profile_task_${index}`, title: `Workload task ${index + 1}: verify a representative change`, status: "open", createdAt: now - index * 1000, updatedAt: now, dependsOn: index > 4 ? [`profile_task_${Math.floor((index - 1) / 3)}`] : [] }));
  const sessions = Array.from({ length: count === 150 ? 8 : 2 }, (_, index) => ({ id: `profile_session_${index}`, title: `Project session ${index + 1}`, timeCreated: now - 10000, timeUpdated: now - index * 1000 }));
  const todos = sessions.flatMap((session) => Array.from({ length: count === 150 ? 16 : 6 }, (_, index) => ({ id: `${session.id}_todo_${index}`, sessionId: session.id, position: index, content: `Representative work item ${index + 1}`, status: index === 0 ? "in_progress" : "pending" })));
  const agents = [{ role: "reference", status: "running", target: { kind: "task", id: "profile_task_0" } }, { role: "auditor", status: "running", target: { kind: "task", id: "profile_task_1" } }];
  return {
    view, tasks, sessions, todos, agents,
    organization: { policy: { maxSessions: 8, maxTodosPerSession: 16 } },
    running: [{ taskId: "profile_task_2", title: "Fixture builder", startedAt: now }],
    backlog: { ok: true, counts: { ready: count, running: 0, verifying: 0, blocked: 0 }, next: [] },
    collisions: { ok: true, collisions: [], presence: [] },
    minimumPainted: count === 150 ? 140 : 25,
  };
}

// command-showcase: a modest board with every state a node style draws, for
// captures. Visual only: its timings are not comparable with the numeric runs.
function showcaseWorkload(now) {
  const titles = ["Node style module", "Rail parity pass", "Picker thumbnails", "Old capture notes"];
  const sessions = titles.map((title, index) => ({ id: `showcase_session_${index}`, title, timeCreated: now - 7200000, timeUpdated: now - index * 60000 }));
  // Done, working and pending todos; the third session has finished all of
  // its work and the fourth is stale (it draws no todos).
  const plans = [["completed", "completed", "in_progress", "pending", "pending"], ["completed", "in_progress", "pending", "pending"], ["completed", "completed", "completed"], ["pending", "pending"]];
  const todos = sessions.flatMap((session, index) => plans[index].map((status, position) => ({ id: `${session.id}_todo_${position}`, sessionId: session.id, position, content: `Showcase step ${position + 1}`, status })));
  const task = (index, title, status, extra) => ({ id: `showcase_task_${index}`, title, status, createdAt: now - (8 - index) * 60000, updatedAt: now, dependsOn: [], ...extra });
  const tasks = [
    task(0, "Build the node style module", "active"), // a builder works on it
    task(1, "Wire the style switch", "active"), // working, no builder
    task(2, "Check the rail parity", "awaiting_verification"), // verifying
    task(3, "Review the capture brief", "open"), // blocked: its build awaits approval
    task(4, "Tune the arrival flare", "open", { pin: true }), // up next
    task(5, "Polish the picker thumbnails", "open", { dependsOn: ["showcase_task_1"] }),
    task(6, "Retire the drifted rail copy", "open"), // finishes after load: the done hold
  ];
  const agents = [
    { role: "reference", status: "running", target: { kind: "task", id: "showcase_task_1" } },
    { role: "auditor", status: "running", target: { kind: "task", id: "showcase_task_2" } },
    { role: "watcher", status: "running" },
    { role: "keeper", status: "running" },
    { role: "improver", status: "running" },
  ];
  return {
    view: "3d", tasks, sessions, todos, agents,
    organization: { policy: { maxSessions: 8, maxTodosPerSession: 16 }, order: sessions.map((session) => session.id), stale: ["showcase_session_3"] },
    running: [{ taskId: "showcase_task_0", title: `Work on "Build the node style module"`, startedAt: now - 95000, progress: 0.4 }],
    backlog: { ok: true, counts: { ready: 3, running: 1, verifying: 1, blocked: 0, approval: 1 }, next: [], approval: [{ kind: "task", id: "showcase_task_3", title: "Review the capture brief", stage: "approval", reason: "Its brief waits for your approval before a build starts." }], blocked: [] },
    // Two sessions editing the same files: the amber collision rim.
    collisions: { ok: true, collisions: [{ sessions: [{ sessionId: "showcase_session_0", active: true }, { sessionId: "showcase_session_1", active: true }] }], presence: [] },
    minimumPainted: 20,
    // A roster satellite stays on the tree only while it runs; a queued,
    // failed or finished one shows while it retires home, within a second.
    // The Command copy of the tree pins these three running satellites as
    // retiring ones, so their status rings hold for the capture.
    pins: {
      "__agent__:watcher": { status: "queued", state: "queued", retiring: true, text: "queued, waiting for a slot" },
      "__agent__:keeper": { status: "error", state: "error", retiring: true, error: "Preparation failed" },
      "__agent__:improver": { status: "done", state: "done", retiring: true, text: "improver done" },
    },
    // Pushed after the warm-up, long after the first read seeded the board, so
    // the finish earns the done hold (green pulse and "!"), not old-news absorb.
    finishing: "task:showcase_task_6",
    finished: () => tasks.map((entry) => entry.id === "showcase_task_6" ? { ...entry, status: "done", doneAt: Date.now(), updatedAt: Date.now() } : entry),
    // Its branch stays sharp; the rest of the board moves to the far layer.
    focus: "showcase_session_0",
  };
}

// Counts every canvas gradient the page builds (by kind, by canvas and by the
// innermost open profiler span, so node painting reads apart from the sky) and
// the most built between two animation frames; steady node frames build none.
const GRADIENT_PROBE = `const probe=window.__profileGradients??=(()=>{
  const probe={sampling:false};
  const reset=()=>Object.assign(probe,{total:0,byKind:{radial:0,linear:0,conic:0},byCanvas:{},bySpan:{},ticks:0,maxPerTick:0,ticksWithGradients:0});
  const open=[];
  const profiler=window.MefiProfiler;
  if(profiler){
    const begin=profiler.begin,end=profiler.end;
    profiler.begin=(name)=>{const token=begin(name);if(token)open.push(token);return token;};
    profiler.end=(token,error)=>{const index=open.lastIndexOf(token);if(index>=0)open.splice(index);return end(token,error);};
  }
  for(const proto of [window.CanvasRenderingContext2D?.prototype,window.OffscreenCanvasRenderingContext2D?.prototype]){
    if(!proto)continue;
    for(const [method,kind] of [['createRadialGradient','radial'],['createLinearGradient','linear'],['createConicGradient','conic']]){
      const original=proto[method];
      if(typeof original!=='function')continue;
      proto[method]=function(...args){
        if(probe.sampling){
          probe.total+=1;probe.byKind[kind]+=1;
          const where=this.canvas?.id||(this.canvas instanceof HTMLCanvasElement?'canvas':'offscreen');
          probe.byCanvas[where]=(probe.byCanvas[where]||0)+1;
          const span=open[open.length-1]?.name||'(no span)';
          probe.bySpan[span]=(probe.bySpan[span]||0)+1;
        }
        return original.apply(this,args);
      };
    }
  }
  probe.start=()=>{
    reset();probe.sampling=true;let seen=0;
    const tick=()=>{if(!probe.sampling)return;const built=probe.total-seen;seen=probe.total;probe.ticks+=1;probe.maxPerTick=Math.max(probe.maxPerTick,built);if(built)probe.ticksWithGradients+=1;requestAnimationFrame(tick);};
    requestAnimationFrame(tick);
  };
  probe.stop=()=>{probe.sampling=false;return {total:probe.total,byKind:{...probe.byKind},byCanvas:{...probe.byCanvas},bySpan:{...probe.bySpan},ticks:probe.ticks,maxPerTick:probe.maxPerTick,ticksWithGradients:probe.ticksWithGradients};};
  reset();
  return probe;
})();`;

// The share of pixels that differ between two captures of the same size.
function changedShare(a, b) {
  const x = a.toBitmap(), y = b.toBitmap();
  if (x.length !== y.length || !x.length) return null;
  let changed = 0;
  for (let index = 0; index < x.length; index += 4) if (x[index] !== y[index] || x[index + 1] !== y[index + 1] || x[index + 2] !== y[index + 2]) changed += 1;
  return Number((changed / (x.length / 4)).toFixed(5));
}

// The next scenario opens a fresh renderer after destroying the previous one.
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url);
    if (details.url.startsWith("file:")) {
      const relative = path.relative(root, fileURLToPath(details.url));
      allowed = !relative.startsWith("..") && !path.isAbsolute(relative);
    }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const { createPerformanceProfiler } = require(path.join(root, "scripts", "performance-profiler.cjs"));
  const hostProfiler = createPerformanceProfiler({ getAppMetrics: () => app.getAppMetrics() });
  hostProfiler.attachIpc(ipcMain);
  ipcMain.handle("performance:control", (event, request) => hostProfiler.control(request?.action, event.sender));
  ipcMain.handle("performance:snapshot", () => ({ ok: true, ...hostProfiler.snapshot() }));
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8"));
  for (const { name, style, id } of runs) {
    const showcase = name === "command-showcase";
    const scene = showcase ? showcaseWorkload(Date.now()) : loadWorkload(name, Date.now());
    const { view, tasks, sessions, todos } = scene;
    const responses = {
      eyesState: { ok: true, sessions, todos, changes: [], pngs: [] },
      tasksList: { ok: true, tasks }, ideasList: { ok: true, ideas: [] }, prefsGet: { ok: true, prefs: { commandHome: false } },
      assistantState: { ok: true, state: { status: "running", agents: scene.agents, organization: scene.organization, messages: [], prefs: {}, work: [] } },
      assistantStatus: { ok: true, status: { enabled: false, execute: false, parallel: 2, running: scene.running, history: [] } },
      eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: scene.collisions,
      backlogStatus: scene.backlog, speedMeasurements: { ok: true, measurements: {} }, readCatalog: catalog,
      communityStatus: COMMUNITY_STATUS,
    };
    const preload = path.join(root, `${id}-preload.cjs`);
    // onTasks carries the pushes the workload sends over profile:emit; like the
    // host's store, later reads return the pushed list. A push marked "tick"
    // waits for Command's refresh tick, which reads collisions right after its
    // graph refresh. The community hint is what MefiCommunity and music.js read
    // before a status. The one-time keys tip counts as seen, or it lands in the
    // first run only.
    fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');const responses=${JSON.stringify(responses)};
      const listeners={tasks:[]};
      let afterTick=null;
      const deliver=(channel,payload)=>{
        if(channel==='tasks')responses.tasksList={ok:true,tasks:payload};
        for(const listener of listeners[channel]||[])listener(payload);
      };
      ipcRenderer.on('profile:emit',(_event,channel,payload,timing)=>{if(timing==='tick')afterTick={channel,payload};else deliver(channel,payload);});
      contextBridge.exposeInMainWorld('mefiStudio',{
        ...Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]])),
        eyesCollisions:async()=>{
          if(afterTick){const next=afterTick;afterTick=null;setTimeout(()=>deliver(next.channel,next.payload),0);}
          return responses.eyesCollisions;
        },
        onTasks:listener=>{listeners.tasks.push(listener);},
        performanceControl:request=>ipcRenderer.invoke('performance:control',request),performanceSnapshot:()=>ipcRenderer.invoke('performance:snapshot')
      });
      for(const key of ['zen','zenReactive','commandHome'])localStorage.setItem('mefiStudio.'+key,'0');
      localStorage.setItem('mefiStudio.community.v1','{"premium":true,"validUntil":null}');
      localStorage.setItem('mefiStudio.keyHint.v1','1');
    `);
    const window = new BrowserWindow({ show: false, width, height, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
    const contents = window.webContents;
    contents.setFrameRate(60);
    contents.setAudioMuted(true);
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("console-message", (_event, detail, oldMessage) => {
      const level = typeof detail === "object" ? detail.level : detail;
      if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage));
    });
    contents.on("render-process-gone", (_event, detail) => finish(new Error(`Renderer exited: ${detail.reason}`)));
    const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
    // A starved compositor can reject a single frame grab with UnknownVizError
    // while the page itself stays healthy; poll for a frame instead of failing.
    const capturePage = async () => {
      const deadline = Date.now() + 30000;
      for (;;) {
        try { return await contents.capturePage(); } catch (error) {
          if (!/UnknownVizError/i.test(String(error?.message ?? error)) || Date.now() > deadline) throw error;
          await sleep(120);
        }
      }
    };
    // Let the compositor publish the latest frame before saving it.
    const saveCapture = async (file) => {
      await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
      const image = await capturePage();
      fs.writeFileSync(path.join(root, file), image.toPNG());
      return image.getSize();
    };
    await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
    // The showcase holds its camera still, so captures compare frame to frame.
    await run(`window.MefiNav.go('command');await window.MefiIdle.ready();window.MefiIdle.setView(${JSON.stringify(view)});window.MefiIdle.setOrbit(${showcase ? "'paused',{quiet:true}" : "'auto'"});window.MefiIdle.setMusicReactive(false);window.MefiProfiler.close();`);
    let applied = null;
    if (style) {
      // music.js is the gate (the unlocked Void collection included); if it
      // still refuses, the tree preference event drives the canvas directly.
      applied = await run(`const style=${JSON.stringify(style)};let via="music";window.MefiMusic.applyNodeStyle(style,false,{navigate:false});if(window.MefiIdle.status().nodeStyle!==style){via="event";window.dispatchEvent(new CustomEvent("mefi-tree-preferences",{detail:{nodeStyle:style}}));}return {via,nodeStyle:window.MefiIdle.status().nodeStyle,premium:window.MefiCommunity?.has?.("premium")===true};`);
      assert.equal(applied.nodeStyle, style, `${id}: the Command view must draw the ${style} node style (it draws ${applied.nodeStyle})`);
    }
    if (scene.pins) await run(`const pins=${JSON.stringify(scene.pins)};const tree=window.MefiTree;const snapshot=tree.snapshot;tree.snapshot=()=>{const value=snapshot();for(const node of value?.nodes??[])if(pins[node.id])Object.assign(node,pins[node.id]);return value;};window.dispatchEvent(new CustomEvent("mefi:tree-select"));`);
    // One refresh tick now (the collision rims included), not at the next 4 s interval.
    if (showcase) await run(`document.dispatchEvent(new Event("visibilitychange"));`);
    await sleep(config.warmupMs);
    const before = await run("return {status:window.MefiIdle.status(),geometry:window.MefiIdle.geometryStatus(),nodes:window.MefiIdle.debugNodes()};");
    assert.ok(before.nodes.filter((node) => Number.isFinite(node.x)).length >= scene.minimumPainted, `${id}: populated fixture graph must actually paint (${before.nodes.length} nodes)`);
    if (style) assert.ok(before.status.nodeStyle === style && before.nodes.every((node) => node.visualStyle === style), `${id}: the ${style} node style must still be drawn after the warm-up (${before.status.nodeStyle})`);
    assert.deepEqual(report.errors, []);
    let focus = null;
    let doneHold = null;
    if (scene.finished) {
      // At this commit Command drops a done-hold node at its next graph refresh
      // (appendDoneHoldNodes never marks its life-cycle entry seen), so the
      // finish lands just after a refresh tick and the overview follows at once.
      contents.send("profile:emit", "tasks", scene.finished(), "tick");
      const landed = await run(`const until=Date.now()+6000;const done=async()=>(await window.mefiStudio.tasksList()).tasks.some((task)=>"task:"+task.id===${JSON.stringify(scene.finishing)}&&task.status==="done");while(!(await done())&&Date.now()<until)await new Promise((resolve)=>setTimeout(resolve,50));return Date.now()<until;`);
      assert.ok(landed, `${id}: the pushed finish of ${scene.finishing} never reached the page`);
      doneHold = await run(`return window.MefiIdle.debugNodes().some((node)=>node.id===${JSON.stringify(scene.finishing)});`);
    }
    if (scene.focus) {
      if (config.capture) await saveCapture(`${id}-overview.png`);
      await run(`window.MefiIdle.enterFocus(${JSON.stringify(scene.focus)});window.MefiIdle.setOrbit('paused',{quiet:true});`);
      // The camera glides in for about a second.
      await sleep(1500);
      focus = await run(`const status=window.MefiIdle.focusStatus();const nodes=window.MefiIdle.debugNodes();const count=(test)=>nodes.filter(test).length;
        return {id:status.id,sharp:status.sharp?.length??0,nodes:nodes.length,farFocused:document.getElementById('idle-layer-far')?.classList.contains('focused')===true,
          working:count((node)=>node.workStatus==='Running'),verifying:count((node)=>node.workStatus==='Verifying'),next:count((node)=>node.workStatus==='Next'),
          doneHoldAtOverview:${JSON.stringify(doneHold)},doneHoldFocused:nodes.some((node)=>node.id===${JSON.stringify(scene.finishing ?? null)}),agents:count((node)=>node.kind==='agent'),
          pinnedAgents:${JSON.stringify(Object.keys(scene.pins ?? {}))}.filter((pin)=>nodes.some((node)=>node.id===pin))};`);
      assert.ok(focus.id === scene.focus && focus.farFocused && focus.sharp > 0 && focus.sharp < focus.nodes, `${id}: the focused branch must stay sharp with the rest on the far layer (${JSON.stringify(focus)})`);
      assert.ok(focus.working > 0 && focus.verifying > 0 && focus.next > 0 && focus.doneHoldAtOverview && focus.pinnedAgents.length === Object.keys(scene.pins ?? {}).length, `${id}: the showcase must hold every node state (${JSON.stringify(focus)})`);
    }
    await run(`${GRADIENT_PROBE}probe.start();await window.MefiProfiler.start();`);
    await sleep(config.durationMs);
    const measured = await run("await window.MefiProfiler.stop();const gradients=window.__profileGradients.stop();return {capture:window.MefiProfiler.snapshot(),geometry:window.MefiIdle.geometryStatus(),panelClosed:document.getElementById('profiler-overlay').hidden,gradients};");
    assert.ok(measured.panelClosed && !measured.capture.renderer.recording && measured.capture.renderer.frameCount > 0, "A real stopped capture with the panel closed is required");
    assert.ok(measured.capture.renderer.spans.some((span) => span.name === "command.frame" && span.count > 0), "Production Command rendering scopes must be measured");
    const commandFrames = measured.capture.renderer.spans.find((span) => span.name === "command.frame")?.count ?? 0;
    const gradientsPerFrame = commandFrames ? Number((measured.gradients.total / commandFrames).toFixed(3)) : null;
    const sample = { name: id, scenario: name, style, nodeStyle: before.status.nodeStyle, styleApplied: applied?.via ?? null, visualOnly: showcase, taskCount: tasks.length, sessionCount: sessions.length, todoCount: todos.length, view, paintedNodes: before.nodes.length, paintedKinds: Object.fromEntries([...new Set(before.nodes.map((node) => node.kind))].map((kind) => [kind, before.nodes.filter((node) => node.kind === kind).length])), rotating: Math.abs(before.geometry.angle - measured.geometry.angle) > 0.001, gradientsPerFrame, gradients: { ...measured.gradients, commandFrames }, ...(focus ? { showcase: focus } : {}), capture: measured.capture };
    report.scenarios.push(sample);
    const renderer = sample.capture.renderer;
    console.log(`${id}: frame p95 ${renderer.frameStats.p95Ms.toFixed(2)} ms, ${renderer.hitchCount} hitches, ${gradientsPerFrame} gradients/frame; ${renderer.spans.slice(0, 5).map((span) => `${span.name} self ${span.selfMeanMs.toFixed(3)} ms (${span.count} calls)`).join('; ')}`);
    if (config.capture) {
      // The numeric capture is already frozen, so saving images cannot affect its timings.
      sample.image = await saveCapture(`${id}.png`);
      // A motion strip: six frames 100 ms apart, written after the burst so
      // the file writes cannot stretch the spacing.
      const frames = [];
      const start = Date.now();
      for (let index = 0; index < 6; index += 1) {
        await sleep(start + index * 100 - Date.now());
        frames.push({ at: Date.now() - start, image: await capturePage() });
      }
      frames.forEach((frame, index) => fs.writeFileSync(path.join(root, `${id}-strip-${index}.png`), frame.image.toPNG()));
      sample.strip = frames.map((frame, index) => ({ atMs: frame.at, changedShare: index ? changedShare(frames[index - 1].image, frame.image) : null }));
    }
    window.destroy();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.networkAttempts, []);
  assert.deepEqual(report.processAttempts, []);
  finish();
}).catch(finish);
