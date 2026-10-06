"use strict";

// Home's message box in a real Chromium: a copied booklet and a synthetic bridge.
// It opens Home in the classic layout and in the sessions layout (in the 0.5
// frame Home is Today, whose own Add files button is checked first; the rest
// runs on Home's chat view, where the whole box lives) and checks the
// real geometry and the real event order that a fake DOM can not: the Attach
// picture button is on screen and (in the sessions layout) on the control row,
// a dropped picture becomes a thumbnail with a remove button, the @ # / popup
// opens above the box and inside the window, Enter inside the popup inserts the
// pick and does NOT send the message (Home's own Enter handler is on the same
// box), an @ in an email address opens nothing, Esc closes, chips show what the
// message points at, nothing on the box is under 12 px, and switching the
// suggestions off in Settings stops the popup. No application main process or
// live state is loaded; network, permissions and child processes are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_COMPOSER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated composer fixture directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], calls: [] };
app.setName("Composer Fixture");
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
  const now = Date.now(), projectId = "composer-project";
  const tasks = [
    { id: "t1", projectId, title: "Fix the sidebar scroll position", prompt: "Keep the scroll when a task finishes", status: "open", createdAt: now, updatedAt: now },
    { id: "t2", projectId, title: "Add a colour theme", prompt: "Theme picker", status: "active", createdAt: now, updatedAt: now },
  ];
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Composer trial", path: root }] },
    tasksList: { ok: true, projectId, tasks }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: {}, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, autoBuild: true, mode: "swarm", running: [], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, draining: false, counts: { ready: 1 }, taskStates: [], next: [] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getApiKey: { saved: false }, cliStatus: [], launchStudio: { ok: true }, jevStatus: { ok: true, enabled: false }, openrouterModels: { ok: true, models: [] },
    companionState: { ok: true, projectId, projectName: "Composer trial", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: true, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
  };
  const files = [
    { path: "src/app.js", name: "app.js", dir: "src" }, { path: "src/ui/composer.js", name: "composer.js", dir: "src/ui" },
    { path: "docs/readme.md", name: "readme.md", dir: "docs" }, { path: "notes/meeting notes.md", name: "meeting notes.md", dir: "notes" },
    { path: "a/very/deeply/nested/folder/with/a/long/name/of/its/own/and-a-file-with-a-rather-long-name-indeed.test.mjs", name: "and-a-file-with-a-rather-long-name-indeed.test.mjs", dir: "a/very/deeply/nested/folder/with/a/long/name/of/its/own" },
  ];
  const skills = [
    { name: "bug-triage", description: "Sort a bug report into severity, owner and next step" },
    { name: "release-notes", description: "Write the notes for a release in plain words" },
  ];
  const preload = path.join(root, "composer-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const files=${JSON.stringify(files)};const skills=${JSON.stringify(skills)};const calls=[];let serial=0;
    const bridge=Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]]));
    const record=(name,result)=>async(...args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args,(k,v)=>typeof v==='string'&&v.length>200?v.slice(0,40)+'...('+v.length+')':v))});return typeof result==='function'?result(...args):result;};
    bridge.assistantImage=record('assistantImage',(payload)=>{if(payload.probe)return {ok:true,probe:true};serial+=1;return {ok:true,id:'img_'+String(serial).padStart(24,'0'),name:payload.name,mime:payload.mime,bytes:Math.round(payload.data.length*3/4),thumb:'data:'+payload.mime+';base64,'+payload.data,vision:{sees:false,model:'glm-5.3'}};});
    bridge.assistantImageRemove=record('assistantImageRemove',()=>({ok:true}));
    bridge.projectFiles=record('projectFiles',(payload)=>{const q=String(payload.query||'').toLowerCase();return {ok:true,files:files.filter(f=>!q||f.path.toLowerCase().includes(q)).slice(0,payload.limit||8)};});
    bridge.agentsSkills=record('agentsSkills',()=>({ok:true,skills}));
    bridge.assistantMessage=record('assistantMessage',()=>({ok:true,state:{projectId:${JSON.stringify(projectId)},messages:[]}}));
    bridge.tasksCreate=record('tasksCreate',()=>({ok:true,task:{id:'made',projectId:${JSON.stringify(projectId)}}}));
    bridge.prefsSet=record('prefsSet',(patch)=>{Object.assign(responses.prefsGet.prefs,patch);return {ok:true,prefs:responses.prefsGet.prefs};});
    for(const name of ['onTasks','onProjects','onAssistantStatus','onAssistant','onProjectPreview','onSettingsChanged','onStudioLog','onAutoSetup'])bridge[name]=()=>()=>{};
    try{Object.assign(responses.prefsGet.prefs,JSON.parse(localStorage.getItem('composerFixture.prefs')||'{}'));}catch{}
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('composerFixture',{calls:()=>calls,clear:()=>{calls.length=0;},prefs:patch=>{Object.assign(responses.prefsGet.prefs,patch);localStorage.setItem('composerFixture.prefs',JSON.stringify(patch));}});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "composer-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${label}`);
  };
  const capture = async (name) => {
    await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(150);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
  };
  const calls = (name) => run(`return window.composerFixture.calls().filter((call) => call.name === ${JSON.stringify(name)}).map((call) => call.args);`);

  // The box, as the page sees it: geometry of each part, in real pixels.
  const measure = `
    const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const input = document.getElementById('workspace-input');
    const form = document.getElementById('workspace-form');
    const visible = (node) => node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const small = [...document.querySelectorAll('.composer-attach *, .composer-mentions *, .composer-picker *, .ws-message-images')].filter((node) => visible(node) && node.children.length === 0 && node.textContent.trim() && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.className + ':' + getComputedStyle(node).fontSize);
    const popup = document.querySelector('.composer-picker');
    return {
      inner: { w: innerWidth, h: innerHeight },
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      form: box(form), input: box(input), send: box(document.getElementById('workspace-send')),
      attachButton: visible(document.querySelector('.composer-attach-button')) ? box(document.querySelector('.composer-attach-button')) : null,
      attachHidden: document.querySelector('.composer-attach').hidden,
      thumbs: [...document.querySelectorAll('.composer-thumb')].map((node) => ({ ...box(node), img: node.querySelector('img') ? { w: node.querySelector('img').naturalWidth, h: node.querySelector('img').naturalHeight } : null, name: node.querySelector('.composer-thumb-name')?.textContent || node.textContent })),
      note: document.querySelector('.composer-attach-note').hidden ? '' : document.querySelector('.composer-attach-note').textContent,
      noteBox: visible(document.querySelector('.composer-attach-note')) ? box(document.querySelector('.composer-attach-note')) : null,
      chips: [...document.querySelectorAll('.composer-mention')].map((node) => node.textContent),
      chipsRow: box(document.querySelector('.composer-mentions')), chipsHidden: document.querySelector('.composer-mentions').hidden,
      popup: popup && !popup.hidden ? { ...box(popup), title: popup.getAttribute('aria-label'), items: [...popup.querySelectorAll('.composer-picker-item')].map((node) => ({ label: node.querySelector('b').textContent, meta: node.querySelector('small')?.textContent || '', current: node.classList.contains('current'), ...box(node) })) } : null,
      z: { popup: popup ? Number(getComputedStyle(popup).zIndex) : 0, floats: Number(getComputedStyle(document.getElementById('studio-floats')).zIndex) || 0 },
      small, value: input.value,
    };`;
  // A picture made in the page: a real PNG, dropped the way a person drops a file.
  const drop = (name, w = 120, h = 80) => run(`
    const canvas = document.createElement('canvas'); canvas.width = ${w}; canvas.height = ${h};
    const g = canvas.getContext('2d'); g.fillStyle = '#2a9d8f'; g.fillRect(0, 0, ${w}, ${h}); g.fillStyle = '#e9c46a'; g.fillRect(10, 10, ${w} / 2, ${h} / 2);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], ${JSON.stringify(name)}, { type: 'image/png' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    document.getElementById('workspace-input').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    return true;`);
  // Typing, as the box hears it: the value changes, the caret sits at its end, an input event follows.
  const type = (text) => run(`const input = document.getElementById('workspace-input'); input.focus(); input.value = ${JSON.stringify(text)}; input.setSelectionRange(input.value.length, input.value.length); input.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
  const press = (key, extra = "{}") => run(`const input = document.getElementById('workspace-input'); input.focus(); const event = new KeyboardEvent('keydown', Object.assign({ key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }, ${extra})); input.dispatchEvent(event); return event.defaultPrevented;`);
  const popupOpen = () => run("const p = document.querySelector('.composer-picker'); return Boolean(p && !p.hidden);");
  // The builder's promise at 1920x1080 in the sessions layout: Attach, the purpose switch and Send share one row.
  const controlRow = () => run("const a = document.querySelector('.composer-attach-button').getBoundingClientRect(), s = document.getElementById('workspace-send').getBoundingClientRect(), t = document.getElementById('workspace-mode-chat').getBoundingClientRect(); return { attach: a.top + a.height / 2, send: s.top + s.height / 2, modes: t.top + t.height / 2 };");
  const oneRow = (row) => Math.abs(row.attach - row.send) < 6 && Math.abs(row.modes - row.send) < 6;
  const inViewport = (b, m, label) => assert.ok(b.x >= -1 && b.y >= -1 && b.r <= m.inner.w + 1 && b.b <= m.inner.h + 1, `${label} is inside the window: ${JSON.stringify(b)} in ${JSON.stringify(m.inner)}`);

  // In the 0.5 layout Build's Home is Today, which borrows Home's box and draws its own row under the words (one "Add files or an
  // image" for Home's Attach picture and Add files buttons); the whole box, with its purpose switch and Send, is Home's chat view
  // (the page Talk it over opens). Today is checked first, then everything below runs on the chat view.
  const todayBox = () => run("const today = document.getElementById('today-build'), form = document.getElementById('workspace-form'), add = document.getElementById('today-build-attach'); const box = (node) => { const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }; const shown = (node) => Boolean(node) && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden'; return { today: shown(today), inside: Boolean(today && form && today.contains(form) && form.contains(add)), add: shown(add) ? box(add) : null, form: shown(form) ? box(form) : null, homeAttach: shown(document.querySelector('.composer-attach-button')), inner: { w: innerWidth, h: innerHeight } };");
  const open = async (query, layout) => {
    await window.loadFile(path.join(root, "renderer", "booklet.html"), { query });
    await run("Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));");
    await until("window.MefiNav && window.MefiVibe && window.MefiWorkspace && !window.MefiBoot?.isActive?.()", `studio ready (${layout})`);
    await run("window.MefiVibe.setMode('build'); window.MefiVibe.closeNotes?.();");
    await run("await window.MefiNav.go('workspace');");
    await until("window.MefiWorkspace.isActive()", `Home (${layout})`);
    if (layout === "sessions") await until("document.documentElement.dataset.homeLayout === 'sessions'", "the sessions layout is adopted");
    else assert.equal(await run("return document.documentElement.dataset.homeLayout || '';"), "", "the classic layout has no layout mark");
    await until("document.getElementById('today-build') && !document.getElementById('today-build').hidden && document.getElementById('today-build-attach')", `Home is Today (${layout})`);
    const today = await todayBox();
    assert.ok(today.inside, `Today's row is inside Home's own box (${layout})`);
    assert.ok(today.add && today.add.w >= 28 && today.add.h >= 24 && today.add.x >= today.form.x - 1 && today.add.r <= today.form.r + 1 && today.add.b <= today.inner.h + 1, `Today's Add files or an image has a size, inside the box and the window (${layout}): ${JSON.stringify(today)}`);
    assert.equal(today.homeAttach, false, `Home's own Attach picture is not shown a second time in Today (${layout})`);
    await run("await window.MefiNav.go('workspace', { view: 'chat' });");
    await until("document.getElementById('today-build').hidden && !document.getElementById('workspace-layer').hidden && document.querySelector('.ws-main')?.contains(document.getElementById('workspace-form'))", `Home's chat view has the box back (${layout})`);
    await until("document.querySelector('.composer-attach') && document.querySelector('.composer-mentions') && document.querySelector('.composer-picker')", `the box is bound (${layout})`);
    await sleep(250);
  };

  for (const [layout, query, sizes] of [
    ["classic", { capture: "1" }, [[1440, 900], [1100, 720], [600, 560]]],
    ["sessions", { capture: "1", home: "sessions" }, [[1920, 1080], [1100, 720]]],
  ]) {
    await open(query, layout);
    for (const [width, height] of sizes) {
      window.setContentSize(width, height); await sleep(350);
      const label = `${layout} ${width}x${height}`;
      await run("window.composerFixture.clear(); document.getElementById('workspace-input').value = ''; document.getElementById('workspace-input').dispatchEvent(new Event('input', { bubbles: true }));");
      // The row is there and usable before anything is attached.
      let m = await run(measure);
      report.layouts.push({ label, pageOverflow: m.pageOverflow });
      assert.equal(m.pageOverflow, false, `the page overflows at ${label}`);
      assert.equal(m.attachHidden, false, `the Attach picture row is shown at ${label}`);
      assert.ok(m.attachButton && m.attachButton.w > 40 && m.attachButton.h > 16, `the Attach picture button has a size at ${label}: ${JSON.stringify(m.attachButton)}`);
      inViewport(m.attachButton, m, `the Attach button at ${label}`);
      assert.ok(m.attachButton.x >= m.form.x - 1 && m.attachButton.r <= m.form.r + 1, `the Attach button is inside the composer at ${label}`);
      assert.equal(m.chipsHidden, true, "no chips until something is mentioned");
      if (layout === "sessions" && width === 1920) {
        // The builder's promise: one row of controls at 1920x1080. The new button joins it; it does not start a second one.
        const sameRow = await controlRow();
        assert.ok(oneRow(sameRow), `Attach, the purpose switch and Send share one row at ${label}: ${JSON.stringify(sameRow)}`);
      }
      // A dropped picture becomes a thumbnail with its name, a note about the model and a remove button.
      await drop("crash screen.png");
      await until("document.querySelectorAll('.composer-thumb img').length === 1 && document.querySelector('.composer-thumb img').naturalWidth > 0", `the thumbnail has painted at ${label}`);
      m = await run(measure);
      assert.equal(m.thumbs.length, 1);
      assert.match(m.thumbs[0].name, /^crash screen\.png · \d+ KB$/);
      assert.deepEqual(m.thumbs[0].img, { w: 120, h: 80 }, "the host's preview is what shows");
      assert.match(m.note, /^glm-5\.3 can't see images\. The picture is saved with your message, and the reply will say so\./);
      inViewport(m.thumbs[0], m, `the thumbnail at ${label}`);
      assert.ok(m.thumbs[0].x >= m.form.x - 1 && m.thumbs[0].r <= m.form.r + 1, `the thumbnail is inside the composer at ${label}`);
      assert.ok(m.noteBox && m.noteBox.w >= m.form.w * 0.6, `the note about the model has a line of its own at ${label}, not a narrow column beside the button: ${JSON.stringify(m.noteBox)} in ${JSON.stringify(m.form)}`);
      if (layout === "sessions" && width === 1920) {
        const withPicture = await controlRow();
        assert.ok(oneRow(withPicture), `a picture on the message does not push the controls to a second row at ${label}: ${JSON.stringify(withPicture)}`);
      }
      assert.deepEqual(m.small, [], `no text under 12 px on the picture row at ${label}`);
      assert.equal((await calls("assistantImage")).filter(([payload]) => !payload.probe).length, 1, "the host was given the picture once");
      await capture(`composer-${layout}-picture-${width}.png`);
      // Remove it: the host is told, the thumbnail goes.
      await run("document.querySelector('.composer-thumb-remove').click();");
      await until("document.querySelectorAll('.composer-thumb').length === 0", `the thumbnail is removed at ${label}`);
      assert.equal((await calls("assistantImageRemove")).length, 1);
      assert.equal((await run(measure)).note, "", "nothing attached, nothing said");
      // @ opens the files; the popup sits above the box, inside the window.
      await type("please look at @comp");
      await until("document.querySelector('.composer-picker') && !document.querySelector('.composer-picker').hidden", `the file popup opens at ${label}`);
      m = await run(measure);
      assert.equal(m.popup.title, "Project files");
      assert.deepEqual(m.popup.items.map((item) => item.label), ["composer.js"], "the host's match, by name, with its folder beside it");
      assert.equal(m.popup.items[0].meta, "src/ui");
      inViewport(m.popup, m, `the popup at ${label}`);
      assert.ok(m.z.popup > m.z.floats, `the popup is above the scroll-fade layer (#studio-floats), or a pane's fade dims a row of it: ${m.z.popup} vs ${m.z.floats}`);
      assert.ok(m.popup.b <= m.input.y + 2, `the popup sits above the message box at ${label}: popup bottom ${m.popup.b}, box top ${m.input.y}`);
      assert.deepEqual(m.small, [], `no text under 12 px in the popup at ${label}`);
      assert.deepEqual((await calls("projectFiles")).at(-1), [{ query: "comp", limit: 8 }]);
      await type("look at @");
      await until("document.querySelectorAll('.composer-picker-item').length === 5", `every file is offered for a bare @ at ${label}`);
      m = await run(measure);
      inViewport(m.popup, m, `the five-row popup at ${label}`);
      for (const item of m.popup.items) assert.ok(item.x >= m.popup.x - 1 && item.r <= m.popup.r + 1 && item.h >= 24, `a row of the popup keeps inside it, at a size a finger can hit, at ${label}: ${JSON.stringify(item)}`);
      await capture(`composer-${layout}-files-${width}.png`);
      // Arrow keys move the choice; Enter inserts it and is not the message box's "send".
      assert.equal(await press("ArrowDown"), true, "the arrow key is taken by the popup");
      assert.equal((await run(measure)).popup.items.findIndex((item) => item.current), 1);
      assert.equal(await press("ArrowUp"), true);
      assert.equal((await run(measure)).popup.items.findIndex((item) => item.current), 0);
      await run("window.composerFixture.clear();");
      assert.equal(await press("Enter"), true, "Enter is taken by the popup");
      await sleep(120);
      m = await run(measure);
      assert.equal(m.value, "look at @src/app.js ", "the pick replaced what was typed, and a space follows it");
      assert.equal(m.popup, null, "the popup closes after a pick");
      assert.deepEqual((await calls("assistantMessage")), [], "Enter inside the popup picked a file; it did not send the message");
      assert.deepEqual(m.chips, ["@src/app.js"], "the chip names what the message points at");
      assert.equal(m.chipsHidden, false);
      assert.deepEqual(m.small, [], `no text under 12 px on the chips at ${label}`);
      inViewport(m.chipsRow, m, `the chips at ${label}`);
      await capture(`composer-${layout}-chip-${width}.png`);
      // With the popup closed, Enter is Home's own: the message goes.
      await press("Enter");
      await until("window.composerFixture.calls().some((call) => call.name === 'assistantMessage')", `Enter sends once the popup is closed at ${label}`);
      assert.deepEqual((await calls("assistantMessage"))[0].slice(0, 2), ["look at @src/app.js", "composer-project"]);
      await sleep(200);
      // Esc closes; an email address and a mid-word @ or # or / open nothing.
      await type("#fix");
      await until("document.querySelector('.composer-picker') && !document.querySelector('.composer-picker').hidden", `the task popup opens at ${label}`);
      m = await run(measure);
      assert.equal(m.popup.title, "Tasks");
      assert.deepEqual(m.popup.items.map((item) => item.label), ["Fix the sidebar scroll position"]);
      assert.equal(await press("Escape"), true);
      assert.equal(await popupOpen(), false, "Esc closes the popup");
      assert.equal((await run(measure)).value, "#fix", "and leaves the text alone");
      await type("/bug");
      await until("document.querySelector('.composer-picker') && !document.querySelector('.composer-picker').hidden", `the skill popup opens at ${label}`);
      m = await run(measure);
      assert.equal(m.popup.title, "Skills");
      assert.deepEqual(m.popup.items.map((item) => [item.label, item.meta]), [["/bug-triage", "Sort a bug report into severity, owner and next step"]]);
      inViewport(m.popup, m, `the skills popup at ${label}`);
      await capture(`composer-${layout}-skills-${width}.png`);
      for (const plain of ["write to me@example.com", "see/usr/bin and https://example.com/a/b", "a #hashtag-less word# and word@", "half/way", "C:/Users/me/notes"]) {
        await type(plain); await sleep(220);
        assert.equal(await popupOpen(), false, `nothing opens for ${JSON.stringify(plain)} at ${label}`);
        // With nothing open, Enter is Home's own and the words go exactly as typed.
        await run("window.composerFixture.clear();");
        await press("Enter");
        await until("window.composerFixture.calls().some((call) => call.name === 'assistantMessage')", `${JSON.stringify(plain)} is sent at ${label}`);
        assert.equal((await calls("assistantMessage"))[0][0], plain, "sent as typed");
        await sleep(200);
      }
      await run("document.getElementById('workspace-input').value = ''; document.getElementById('workspace-input').dispatchEvent(new Event('input', { bubbles: true }));");
      await sleep(100);
    }
  }

  // The switch in Settings: off, and the popup and chips stop; the host's pictures are a separate switch.
  await run("window.composerFixture.prefs({ composerPicker: false });");
  await open({ capture: "1" }, "classic");
  assert.equal(await run("return document.getElementById('settings-composer-picker').checked;"), false, "Settings shows what is saved");
  await type("look at @app");
  await sleep(400);
  assert.equal(await popupOpen(), false, "the popup stays shut while the suggestions are off");
  assert.equal((await run(measure)).chipsHidden, true, "and so do the chips");
  assert.deepEqual(await calls("projectFiles"), [], "the host was never asked for file names");
  await run("document.getElementById('settings-composer-picker').checked = true; document.getElementById('settings-composer-picker').dispatchEvent(new Event('change', { bubbles: true }));");
  await until("window.composerFixture.calls().some((call) => call.name === 'prefsSet')", "the choice is saved");
  assert.deepEqual((await calls("prefsSet")).at(-1), [{ composerPicker: true }]);
  await type("look at @app");
  await until("document.querySelector('.composer-picker') && !document.querySelector('.composer-picker').hidden", "the popup works again once it is switched on");
  await capture("composer-final.png");
  report.complete = true;
  finish();
}).catch(finish);
