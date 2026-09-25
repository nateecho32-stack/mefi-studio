"use strict";
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_COMPANION_RENDER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("Isolated fixture required");
const report = { errors: [], network: [] };
for (const key of ["userData", "sessionData", "crashDumps"]) { const dir = path.join(root, key); fs.mkdirSync(dir); app.setPath(key, dir); }
app.disableHardwareAcceleration();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let win, finished = false;
async function finish(error) {
  if (finished) return; finished = true;
  if (error) { report.failure = error.stack || String(error); console.error(report.failure); if (win && !win.isDestroyed()) fs.writeFileSync(path.join(root, "failure.png"), (await win.webContents.capturePage()).toPNG()); }
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2)); app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url);
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.network.push(details.url); callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const project = { id: "sample", name: "Little planet", path: "C:/Sample/Little planet" };
  const projects = { ok: true, activeId: project.id, projects: [project] };
  const replies = {
    projectsList: projects, tasksList: { ok: true, tasks: [] }, ideasList: { ok: true, ideas: [] },
    prefsGet: { ok: true, prefs: { commandHome: false } },
    assistantState: { ok: true, state: { status: "paused", agents: [], messages: [], prefs: {}, work: [] } },
    assistantStatus: { ok: true, status: { enabled: false, execute: false, running: [], history: [] } },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] },
    eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null },
    eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    backlogStatus: { ok: true, counts: {}, next: [] }, readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data/models.json"))),
    startupState: { ok: true, interactive: true, chosen: false, activeId: project.id, projects: [project] }, startupChoose: projects, startupBegin: { ok: true },
    companionState: { ok: true, state: "resting", look: "wisp", projectName: project.name, roaming: false, queue: { counts: { total: 1 }, items: [{ id: "ask", kind: "question", title: "May I use the local connection?", actions: [{ id: "yes", label: "Allow connection" }, { id: "no", label: "Not now" }] }] }, activity: [{ id: "notice", text: "Your project is ready to explore." }] },
    companionWelcome: { ok: true }, companionSeen: { ok: true },
    firstScan: { ok: true, plan: { ok: true, opencode: { installed: true, version: "1.0" }, providers: { linked: ["Local"], free: { count: 0 } }, explorer: { model: "local/explorer" } } },
    firstScanApply: { ok: true, summary: "Use the local connection." }, firstMap: { ok: true, summary: "A small project.", ideas: { added: 0 } }, firstAssist: { ok: true, advice: { summary: "Ready for our next step." } },
    assistantAnswer: { ok: true }, getAiRouting: { provider: "custom", models: {}, providerModels: {} }, cliStatus: [],
  };
  const preload = path.join(root, "preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const replies=${JSON.stringify(replies)},calls=[];let chatReply;const api=Object.fromEntries(Object.keys(replies).map(key=>[key,async(...args)=>{calls.push({key,args});return replies[key];}]));api.assistantMessage=(...args)=>{calls.push({key:'assistantMessage',args});return new Promise(resolve=>{chatReply=resolve;});};contextBridge.exposeInMainWorld('mefiStudio',api);contextBridge.exposeInMainWorld('hubFixture',{calls:()=>calls,completeChat:ok=>{chatReply?.({ok,error:ok?undefined:'Try again when connected.'});chatReply=null;},setState:state=>{replies.companionState.state=state;}});localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.motion','on');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');`);
  win = new BrowserWindow({ show: false, width: 1280, height: 900, frame: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  const wc = win.webContents; wc.setAudioMuted(true); wc.setFrameRate(30); wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("console-message", (_event, detail, legacy) => { if (detail?.level === "error" || detail === 3) report.errors.push(detail?.message || legacy); });
  const run = (source) => wc.executeJavaScript(`(async()=>{${source}})()`, true);
  const until = async (condition, label) => { const deadline = Date.now() + 12000; while (Date.now() < deadline) { assert.deepEqual(report.errors, []); if (await run(`return Boolean(${condition});`)) return; await sleep(40); } throw new Error(`Timed out: ${label}`); };
  const capture = async (name) => { await sleep(650); fs.writeFileSync(path.join(root, name + ".png"), (await wc.capturePage()).toPNG()); };
  const click = async (selector) => {
    const pt = await run(`const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
    pt.x = Math.round(pt.x * wc.getZoomFactor()); pt.y = Math.round(pt.y * wc.getZoomFactor());
    wc.sendInputEvent({ type: "mouseMove", ...pt }); wc.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...pt }); wc.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...pt }); await sleep(100);
  };
  const escape = () => run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));");
  await win.loadFile(path.join(root, "renderer/booklet.html"));
  await run("Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));");
  await until("window.MefiBoot?.state().phase==='choose' && document.getElementById('boot-agent')", "wake-up chooser");
  assert.equal(await run("return document.getElementById('boot-agent').dataset.mood;"), "happy", "waiting for a choice is not active thinking");
  await click("#boot-agent"); await capture("01-wake-up");
  assert.ok(await run("const svg=document.querySelector('#boot-agent svg');for(let i=0;i<20;i++)window.MefiCompanionHub.play(svg);return svg.querySelectorAll('.agent-reaction').length===1&&svg.querySelectorAll('.agent-spark').length===6;"), "repeated play keeps one small burst");
  await until("!document.querySelector('#boot-agent .agent-reactions').childElementCount", "reaction particles clean up"); report.particles = true;
  assert.equal(await run("return hubFixture.calls().filter(call=>['startupBegin','firstScanApply','firstMap'].includes(call.key)).length;"), 0);
  const bounds = win.getBounds(); await click("#boot-open");
  await until("!window.MefiBoot.isActive() && !document.getElementById('walkthrough-overlay').hidden && !document.getElementById('walkthrough-scan-apply').hidden", "setup consent");
  assert.equal(await run("return hubFixture.calls().filter(call=>['startupBegin','firstScanApply','firstMap'].includes(call.key)).length;"), 0);
  await capture("02-setup"); await click("#walkthrough-scan-apply");
  await until("hubFixture.calls().some(call=>call.key==='firstAssist')", "approved setup chain");
  assert.equal(await run("return hubFixture.calls().filter(call=>call.key==='firstScanApply').length;"), 1);
  assert.deepEqual(win.getBounds(), bounds, "only internal surfaces resize"); report.consent = true;
  await run("window.MefiOnboarding.close();await window.MefiNav.go('command');document.getElementById('companion-orb').click();");
  await until("window.MefiCompanionHub.isOpen()", "hub open"); await capture("03-hub");
  assert.equal(await run("return document.activeElement.id;"), "agent-hub-return");
  assert.equal(await run("return document.getElementById('idle-hud').inert;"), true);
  await click('[data-hub-section="ask"]');
  await run("document.querySelector('#companion-pane-ask textarea').value='Keep my thought here';");
  await escape(); await click('[data-hub-section="requests"]');
  assert.equal(await run("return hubFixture.calls().filter(call=>call.key==='assistantAnswer').length;"), 0);
  await capture("04-requests"); await click("#companion-pane-status button");
  await until("hubFixture.calls().some(call=>call.key==='assistantAnswer')", "explicit request answer reaches the host");
  assert.equal(await run("return hubFixture.calls().filter(call=>call.key==='assistantAnswer').length;"), 1);
  await escape(); await click('[data-hub-section="ask"]');
  assert.equal(await run("return document.querySelector('#companion-pane-ask textarea').value;"), "Keep my thought here");
  await click('#companion-pane-ask [data-send]');
  await until("hubFixture.calls().some(call=>call.key==='assistantMessage') && document.getElementById('companion-orb').dataset.mood==='thinking' && document.querySelector('.agent-hub-avatar').dataset.mood==='thinking'", "pending conversation animates the wisp");
  assert.ok(await run("const svg=document.querySelector('.agent-hub-avatar svg'),orb=document.querySelector('.companion-face svg');await window.MefiCompanion.refresh();return svg===document.querySelector('.agent-hub-avatar svg')&&orb===document.querySelector('.companion-face svg');"), "refresh preserves running character animations");
  await capture("06-thinking");
  assert.equal(await run("return getComputedStyle(document.querySelector('.agent-hub-avatar .agent-thought')).opacity;"), "1");
  assert.ok(await run("return document.querySelector('.agent-hub-avatar .agent-orbit').getAnimations().some(animation=>animation.playState==='running');"));
  await run("hubFixture.completeChat(true);");
  await until("document.querySelector('.agent-hub-avatar').dataset.mood==='idle' && document.querySelector('.agent-hub-avatar .agent-reaction')?.textContent==='^_^'", "answered conversation celebrates"); await capture("07-happy");
  await run("document.querySelector('#companion-pane-ask textarea').value='Try one more thought';");
  await click('#companion-pane-ask [data-send]');
  await until("document.querySelector('.agent-hub-avatar').dataset.mood==='thinking'", "second thought");
  await run("hubFixture.completeChat(false);");
  await until("!document.querySelector('#companion-pane-ask [data-send]').disabled", "failed conversation settles");
  assert.equal(await run("return document.querySelector('.agent-hub-avatar').dataset.mood;"), "idle");
  assert.equal(await run("return document.querySelector('.agent-hub-avatar .agent-reaction');"), null, "failure does not celebrate");
  await run("hubFixture.setState('working');await window.MefiCompanion.refresh();");
  assert.equal(await run("return document.querySelector('.agent-hub-avatar').dataset.mood;"), "thinking", "reported agent work also animates");
  await run("hubFixture.setState('resting');await window.MefiCompanion.refresh();");
  assert.equal(await run("return document.querySelector('.agent-hub-avatar .agent-reaction')?.textContent;"), "^_^"); report.thinking = true;
  await escape(); await click('[data-hub-section="settings"]');
  await click('[data-companion-setting="look"] + button');
  await until("document.querySelector('.studio-choice-popup')", "owned select");
  assert.equal(await run("const r=document.querySelector('.studio-choice-popup').getBoundingClientRect();return Boolean(document.elementFromPoint(r.x+10,r.y+10)?.closest('.studio-choice-popup'));"), true);
  await escape(); assert.equal(await run("return window.MefiCompanionHub.isOpen();"), true);
  await escape(); await escape(); await until("!window.MefiCompanionHub.isOpen()", "close to origin");
  assert.equal(await run("return document.getElementById('idle-hud').inert;"), false);
  await run("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));");
  await until("window.MefiCompanionHub.isOpen()", "Escape opens hub"); report.focus = true;
  await run("window.hubOriginalAudio=window.MefiIdle.audioStatus;window.hubSound={reactive:true,listening:true,phase:'listening',energy:.8,response:1,effects:{nodes:true}};window.MefiIdle.audioStatus=()=>window.hubSound;window.dispatchEvent(new Event('mefi-audio-change'));");
  await until("Number(document.getElementById('agent-hub').style.getPropertyValue('--hub-energy'))>.1", "audio response");
  await run("document.documentElement.dataset.motion='off';"); await sleep(150);
  assert.equal(await run("return Number(document.getElementById('agent-hub').style.getPropertyValue('--hub-energy'));"), 0);
  assert.equal(await run("return document.getElementById('agent-hub').getAnimations({subtree:true}).filter(a=>a.playState==='running').length;"), 0); report.motion = true;
  await run("window.MefiCompanionHub.thinking(true);window.MefiCompanionHub.play(document.querySelector('.agent-hub-avatar svg'));");
  assert.equal(await run("return document.querySelectorAll('.agent-hub-avatar .agent-spark').length;"), 0, "reduced motion omits particle travel");
  assert.equal(await run("return document.querySelector('.agent-hub-avatar .agent-reaction')?.textContent;"), "...", "reduced motion retains the expression");
  assert.equal(await run("return document.querySelector('.agent-hub-avatar').getAnimations({subtree:true}).filter(a=>a.playState==='running').length;"), 0);
  await run("window.MefiCompanionHub.thinking(false,{celebrate:false});");
  await run("document.documentElement.dataset.motion='on';window.hubSound.listening=false;window.hubSound.phase='off';"); await sleep(850);
  assert.ok(await run("return Number(document.getElementById('agent-hub').style.getPropertyValue('--hub-energy'))<.01;")); report.audio = true;
  for (const [width, height, zoom] of [[600, 560, 1], [900, 760, 1.5], [600, 560, 1.5]]) {
    win.setSize(width, height); wc.setZoomFactor(zoom); await sleep(500);
    await capture(`05-hub-${width}-${zoom}`);
    assert.ok(await run("return [...document.querySelectorAll('.agent-hub-node, .agent-hub-center')].every(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;});"), `bubble bounds at ${width}/${zoom}`);
    await click('[data-hub-section="ask"]'); await sleep(450);
    assert.ok(await run("const el=document.querySelector('#companion-pane-ask textarea');el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;"), "chat stays reachable");
    await escape();
  }
  report.layouts = true;
  await finish();
}).catch(finish);
