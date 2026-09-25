"use strict";
// The real booklet with a synthetic planning bridge; no live app or providers.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const { applyPlanningAction } = require("../../scripts/planning.cjs");
const root = process.env.MEFI_PLANNING_RENDER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated planning fixture directory is required");
const report = { errors: [], networkAttempts: [], layouts: [] };
app.setName("Studio Planning Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) { const folder = path.join(root, name); fs.mkdirSync(folder, { recursive: true }); app.setPath(name, folder); }
app.disableHardwareAcceleration();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
function finish(error) {
  if (finished) return; finished = true;
  if (error) { report.failure = error.stack || String(error); console.error(report.failure); }
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2)); app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url);
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.networkAttempts.push(details.url); callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const responses = {
    projectsList: { ok: true, activeId: "planning-demo", projects: [{ id: "planning-demo", name: "Fieldnotes", path: root }] },
    planningList: { ok: true, projectId: "planning-demo", plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false } },
    tasksList: { ok: true, projectId: "planning-demo", tasks: [
      { id: "welcome", projectId: "planning-demo", title: "Shape the welcome flow", status: "open" },
      { id: "notes", projectId: "planning-demo", title: "Create a first note", status: "open", dependsOn: ["welcome"] },
      { id: "return", projectId: "planning-demo", title: "Remember the workspace", status: "open", dependsOn: ["welcome"] },
    ] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] },
    assistantState: { ok: true, state: { status: "paused", agents: [], messages: [], prefs: {}, work: [] } },
    assistantStatus: { ok: true, status: { enabled: false, execute: false, parallel: 1, running: [], history: [] } },
    eyesCheckpointsRead: { ok: true, checkpoints: {} },
    eyesRequestsRead: { ok: true, requests: [] },
    eyesBriefingRead: { ok: true, briefing: null },
    eyesCollisions: { ok: true, collisions: [], presence: [] },
    backlogStatus: { ok: true, counts: { ready: 3, running: 0, verifying: 0, blocked: 0 }, next: [] },
    speedMeasurements: { ok: true, measurements: {} },
    assistantDoneLog: { ok: true, entries: [] },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
  };
  const result = { ok: true, projectId: "planning-demo", summary: "The setup screen already saves a workspace. We can build on that flow and make the first successful step clearer.", references: { scanned: 46, code: [{ file: "src/onboarding.js", line: 24, snippet: "function openWorkspace(folder) {\n  saveProject(folder);\n  showWelcome();\n}" }, { file: "src/workspace.js", line: 82, snippet: "const welcome = project.firstVisit;\nrenderWorkspace({ welcome });" }], limitations: [] }, suggestions: [{ id: "suggestion-0", target: "destination", label: "Define the first small success", text: "A new user can choose a folder, see what the workspace does, and create their first note without leaving setup.", reason: "Gives the welcome flow an observable outcome.", files: ["src/onboarding.js"] }, { id: "suggestion-1", target: "question", label: "Make returning users feel at home", text: "Should returning users skip setup and reopen their last workspace?", reason: "The existing firstVisit check can separate the two experiences.", files: ["src/workspace.js"] }] };
  const savedPlans = [], project = { id: "planning-demo" };
  let saved = applyPlanningAction(savedPlans, { action: "create", title: "A warmer first welcome", destination: "Help a new user create their first note." }, { project }).plan;
  for (const question of ["What does a first successful visit look like?", "Should returning users skip setup?", "What can someone try without an account?"]) {
    saved = applyPlanningAction(savedPlans, { action: "add-question", planId: saved.id, version: saved.version, question, type: "discussion", dependsOn: [] }, { project }).plan;
  }
  const preload = path.join(root, "planning-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)},result=${JSON.stringify(result)},calls=[];
    const bridge=Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]]));
    bridge.planningExplore=async payload=>{calls.push(payload);await new Promise(resolve=>setTimeout(resolve,100));return result;};
    bridge.planningAction=async()=>{throw new Error('Unexpected plan save');};
    contextBridge.exposeInMainWorld('mefiStudio',bridge);contextBridge.exposeInMainWorld('planningFixture',{calls:()=>calls,useSavedPlan:()=>{const plan=${JSON.stringify(saved)};responses.planningList.plans=[plan];return plan.id;}});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,status:'complete'}));
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 1000, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail) => { if (detail?.level === "error") report.errors.push(detail.message); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition) => { const deadline = Date.now() + 15000; while (Date.now() < deadline) { if (await run(`return Boolean(${condition});`)) return; await sleep(50); } throw new Error(`Timed out: ${condition}`); };
  const capture = async (name) => {
    for (let attempt = 0; ; attempt++) {
      await run("await Promise.all([...document.querySelectorAll('.planning-flow-stage,.planning-section')].flatMap(element=>element.getAnimations()).map(animation=>animation.finished.catch(()=>{})));");
      await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
      contents.invalidate(); await sleep(150 * (attempt + 1));
      try { fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG()); (report.captures ||= []).push(name); return; }
      catch (error) { if (!/UnknownVizError/.test(error.message) || attempt >= 3) { report.captureFailed = name; throw error; } }
    }
  };
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  // Offscreen windows have no OS focus; emulate an active page so Chromium's
  // actual :focus styling is exercised without stealing the user's window.
  contents.debugger.attach("1.3");
  await contents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  await contents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await until("window.MefiPlanning && window.MefiNav");
  await run("await window.MefiPlanning.open({create:true});");
  await until("document.getElementById('plans-title')");
  report.initialLayout = await run("const workflow=document.getElementById('plans-workflow').getBoundingClientRect(),save=document.getElementById('plans-save-details'),rect=save.getBoundingClientRect();return {workflowHeight:workflow.height,saveVisible:rect.bottom<innerHeight&&document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===save};");
  assert.ok(report.initialLayout.workflowHeight < 180, "the stage header leaves room to write");
  assert.ok(report.initialLayout.saveVisible, "the initial destination form fits the desktop window");
  report.stepCards = await run("const cards=[...document.querySelectorAll('.planning-flow-stage')];return {icons:cards.map(card=>card.querySelector('use').getAttribute('href')),validIcons:cards.every(card=>document.querySelector(card.querySelector('use').getAttribute('href'))),entrance:cards.some(card=>card.getAnimations().some(animation=>animation.effect.getTiming().duration===260)),compact:cards.every(card=>card.getBoundingClientRect().height<=60)};");
  assert.equal(new Set(report.stepCards.icons).size, 8, "each step has its own symbol");
  assert.ok(report.stepCards.validIcons && report.stepCards.entrance && report.stepCards.compact, "compact cards slide in with real shared icons");
  await capture("planning-empty.png");
  await run("const title=document.getElementById('plans-title');title.value='A warmer first welcome';title.dispatchEvent(new Event('input',{bubbles:true}));title.focus();");
  contents.sendInputEvent({ type: "keyDown", keyCode: "Enter" }); contents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
  await until("document.activeElement.id==='plans-destination'");
  report.focus = await run("const field=document.getElementById('plans-destination');return {focused:field.matches(':focus'),docFocus:document.hasFocus(),active:document.activeElement.id,tint:getComputedStyle(field).getPropertyValue('--tint-gold-1'),shadow:getComputedStyle(field).boxShadow};");
  await until("getComputedStyle(document.getElementById('plans-destination')).boxShadow!=='none'&&!getComputedStyle(document.getElementById('plans-destination')).boxShadow.startsWith('rgba(0, 0, 0, 0)')");
  report.keyboardGlow = await run("const field=document.activeElement;return {shadow:getComputedStyle(field).boxShadow,departing:document.getElementById('plans-title').parentElement.dataset.departing};");
  assert.notEqual(report.keyboardGlow.shadow, "none"); assert.equal(report.keyboardGlow.departing, "true");
  await run("const field=document.getElementById('plans-destination');field.value='Help someone feel at home in their workspace in the first five minutes.';field.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('plans-out-of-scope').value='Account sync and collaboration can wait.';document.getElementById('plans-out-of-scope').dispatchEvent(new Event('input',{bubbles:true}));");
  await until("document.getElementById('plans-use-suggestion-0')");
  assert.equal(await run("return window.planningFixture.calls().length;"), 1);
  await capture("planning-live-1440.png");
  await run("document.querySelector('.planning-file-node').open=true;");
  await capture("planning-evidence.png");
  await run("document.getElementById('plans-copilot-tab-suggestions').click();document.getElementById('plans-copilot-body').scrollTop=0;");
  await capture("planning-suggestions-1440.png");
  await run("document.getElementById('plans-copilot-tab-explore').click();");
  assert.ok(await run("return document.querySelector('.planning-file-node').open;"), "the expanded file survives tab navigation");
  await run("document.getElementById('plans-copilot-tab-suggestions').click();");
  window.setContentSize(1920, 1200);
  contents.enableDeviceEmulation({ screenPosition: "desktop", screenSize: { width: 1920, height: 1200 }, viewPosition: { x: 0, y: 0 }, viewSize: { width: 1920, height: 1200 }, deviceScaleFactor: 1, scale: 1 });
  await run("document.getElementById('plans-detail').scrollTop=0;");
  await capture("planning-overview-1920.png");
  for (const [width, height] of [[1440, 1000], [1100, 800], [600, 780]]) {
    window.setContentSize(width, height);
    contents.enableDeviceEmulation({ screenPosition: "desktop", screenSize: { width, height }, viewPosition: { x: 0, y: 0 }, viewSize: { width, height }, deviceScaleFactor: 1, scale: 1 });
    await sleep(120);
    const layout = await run("const editor=document.getElementById('plans-editor').getBoundingClientRect(),side=document.getElementById('plans-copilot').getBoundingClientRect(),detail=document.getElementById('plans-detail');return {width:innerWidth,editorWidth:editor.width,sideWidth:side.width,sideBySide:side.left>=editor.right,panelsFit:Math.max(editor.bottom,side.bottom)<=innerHeight+1,noOverflow:document.documentElement.scrollWidth<=innerWidth+1&&detail.scrollWidth<=detail.clientWidth+1};");
    report.layouts.push(layout); assert.ok(layout.noOverflow && layout.editorWidth>=240 && layout.sideWidth>=240, JSON.stringify(layout));
    assert.equal(layout.sideBySide, width>1000);
    if (width > 1000) assert.ok(layout.panelsFit, "both panes fit within the desktop viewport");
    await run("document.getElementById('plans-detail').scrollTop=0;"); await capture(`planning-layout-${width}.png`);
    await run("document.getElementById('plans-help-write').scrollIntoView({block:'center'});");
    assert.ok(await run("const button=document.getElementById('plans-help-write'),rect=button.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return hit===button||button.contains(hit);"), "AI controls can be reached at every width");
    if (width > 1000) {
      await run("document.getElementById('plans-copilot-body').scrollTop=9999;");
      assert.ok(await run("const button=document.getElementById('plans-help-write'),rect=button.getBoundingClientRect();return document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===button;"), "AI controls stay visible while suggestions scroll");
      await run("document.getElementById('plans-copilot-body').scrollTop=0;");
    }
  }
  assert.ok(await run("return document.getElementById('plans-suggestion-editor-suggestion-0').hidden;"));
  await run("document.getElementById('plans-edit-suggestion-0').click();const editor=document.getElementById('plans-suggestion-editor-suggestion-0');editor.value='A new user can create their first note in five minutes.';editor.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('plans-edit-suggestion-0').click();");
  await run("document.getElementById('plans-use-suggestion-0').click();");
  assert.match(await run("return document.getElementById('plans-destination').value;"), /create their first note/);
  assert.ok(await run("return !document.getElementById('plans-draft-feedback').hidden;"));
  await run("document.getElementById('plans-undo-wording').click();");
  assert.equal(await run("return document.getElementById('plans-destination').value;"), "Help someone feel at home in their workspace in the first five minutes.");
  assert.equal(await run("return document.activeElement.id;"), "plans-destination", "Undo returns focus to the affected field");
  await run("document.getElementById('plans-mode-manual').click();document.documentElement.dataset.motion='off';document.getElementById('plans-destination').focus();");
  contents.sendInputEvent({ type: "keyDown", keyCode: "Enter" }); contents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
  await until("document.activeElement.id==='plans-out-of-scope'");
  report.reducedMotion = await run("return getComputedStyle(document.getElementById('plans-destination')).animationName==='none';");
  assert.ok(report.reducedMotion);
  window.setContentSize(1440, 1000);
  contents.enableDeviceEmulation({ screenPosition: "desktop", screenSize: { width: 1440, height: 1000 }, viewPosition: { x: 0, y: 0 }, viewSize: { width: 1440, height: 1000 }, deviceScaleFactor: 1, scale: 1 });
  await run("const planId=window.planningFixture.useSavedPlan();await window.MefiPlanning.open({planId});document.getElementById('plans-question-map').open=true;const history=document.getElementById('plans-history');history.open=true;history.querySelector('details').open=true;");
  await capture("planning-saved-map.png");
  report.savedLayout = await run("const editor=document.getElementById('plans-editor'),side=document.getElementById('plans-copilot').getBoundingClientRect();return {editorHeight:editor.getBoundingClientRect().height,historyInEditor:document.getElementById('plans-history').parentElement===editor,sideFits:side.bottom<=innerHeight+1};");
  assert.ok(report.savedLayout.editorHeight > 280 && report.savedLayout.sideFits && report.savedLayout.historyInEditor, "expanded saved history and decisions leave both panes usable");
  await run("document.querySelector('.planning-map-question').click();");
  assert.match(await run("return document.activeElement.id;"), /^plans-resolution-/, "the decision map focuses its editable answer");
  await run("document.documentElement.dataset.motion='on';document.getElementById('plans-stage-idea').click();");
  report.stepBack = await run("const section=document.getElementById('plans-destination-section'),animation=section.getAnimations().find(item=>item.effect.getTiming().duration===260);return {transform:animation?.effect.getKeyframes()[0].transform,focus:document.activeElement.id,selected:document.getElementById('plans-stage-idea').getAttribute('aria-pressed'),progress:document.getElementById('plans-workflow').dataset.stage};");
  assert.equal(report.stepBack.transform, 'translateX(-12px)');
  assert.equal(report.stepBack.focus, 'plans-title'); assert.equal(report.stepBack.selected, 'true');
  assert.equal(report.stepBack.progress, 'explore', "browsing keeps saved progress intact");
  await capture("planning-step-idea.png");
  await run("document.getElementById('plans-stage-review').click();");
  report.stepForward = await run("const animation=document.getElementById('plans-review-section').getAnimations().find(item=>item.effect.getTiming().duration===260);return {transform:animation?.effect.getKeyframes()[0].transform,focus:document.activeElement.id};");
  assert.equal(report.stepForward.transform, 'translateX(12px)');
  await capture("planning-step-review.png");
  await contents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await run("document.getElementById('plans-stage-idea').click();");
  assert.equal(await run("return document.getElementById('plans-destination-section').getAnimations().length;"), 0, "OS reduced motion suppresses the slide while navigating");
  await contents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
  // Exercise the actual workspace background, then use two controlled backdrop
  // colours to prove the glass is visible through every ancestor's paint.
  await run("window.MefiPlanning.close();await window.MefiNav.go('command');await window.MefiIdle.ready();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await window.MefiPlanning.open({create:true});document.getElementById('plans-mode-assisted').click();document.getElementById('plans-help-write').click();");
  report.backdrop = await run("return {status:window.MefiTree.status(),message:window.MefiTree.statusText(),nodes:window.MefiIdle.debugNodes().length,hudHidden:getComputedStyle(document.getElementById('idle-hud')).visibility==='hidden',canvasVisible:getComputedStyle(document.getElementById('idle-layer-far')).visibility==='visible'};");
  assert.ok(report.backdrop.hudHidden && report.backdrop.canvasVisible, "glass reveals the background without another page's controls");
  await until("document.getElementById('plans-use-suggestion-0')&&!document.getElementById('plans-use-suggestion-0').disabled");
  await run("document.getElementById('plans-destination').focus();");
  await capture("planning-glass-aurora.png");
  await run("window.MefiMusic.applyTheme('violet',false);window.MefiAppearance.apply({preset:'atmosphere'},false);");
  await capture("planning-glass-violet.png");
  await run("window.MefiMusic.applyTheme('aurora',false);window.MefiAppearance.apply({preset:'studio'},false);document.documentElement.setAttribute('data-no-blur','');");
  report.noBlur = await run("return ['plans-overlay','plans-sheet','plans-destination-section','plans-copilot'].every(id=>getComputedStyle(document.getElementById(id)).backdropFilter==='none');");
  assert.ok(report.noBlur, "the existing blur preference applies to all planner layers");
  await capture("planning-glass-clear.png");
  report.glassSurfaces = await run("return ['plans-overlay','plans-sheet','plans-detail','plans-editor','plans-destination-section'].map(id=>{const style=getComputedStyle(document.getElementById(id));return {id,background:style.backgroundColor,image:style.backgroundImage,opacity:style.opacity,zIndex:style.zIndex,panel:style.getPropertyValue('--planning-panel')};});");
  const samplePoint = await run("const backdrop=document.createElement('div');backdrop.id='planning-fixture-backdrop';backdrop.style.cssText='position:fixed;inset:0;z-index:79;pointer-events:none;background:#000000';document.body.append(backdrop);const box=document.getElementById('plans-destination-section').getBoundingClientRect();return {x:Math.round(box.left+14),y:Math.round(box.top+80)};");
  const sample = async (color) => {
    await run(`document.getElementById('planning-fixture-backdrop').style.background=${JSON.stringify(color)};await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
    contents.invalidate(); await sleep(120);
    return [...(await contents.capturePage({ ...samplePoint, width: 1, height: 1 })).toBitmap()].slice(0, 3);
  };
  const dark = await sample("#000000"), bright = await sample("#ffffff");
  report.glassSamples = {dark, bright};
  report.glassTransmission = Math.max(...bright.map((channel, index) => Math.abs(channel - dark[index])));
  if (report.glassTransmission <= 35) await capture("planning-glass-probe-failure.png");
  assert.ok(report.glassTransmission > 35, `the backdrop must remain visible through the writing panel (${report.glassTransmission})`);
  await contents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  assert.ok(await run("return matchMedia('(prefers-reduced-transparency: reduce)').matches;"));
  const solidDark = await sample("#000000"), solidBright = await sample("#ffffff");
  report.reducedTransparencyDifference = Math.max(...solidBright.map((channel, index) => Math.abs(channel - solidDark[index])));
  assert.ok(report.reducedTransparencyDifference <= 2, "reduced transparency blocks the backdrop behind writing");
  await run("document.getElementById('planning-fixture-backdrop').remove();document.documentElement.removeAttribute('data-no-blur');");
  await contents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
  await run("window.MefiPlanning.close();");
  assert.ok(await run("return getComputedStyle(document.getElementById('idle-hud')).visibility==='visible';"), "closing Plans restores the underlying controls");
  await until("Number(getComputedStyle(document.getElementById('idle-layer')).opacity)===1");
  assert.deepEqual(report.errors, []); assert.deepEqual(report.networkAttempts, []);
  finish();
}).catch(finish);
