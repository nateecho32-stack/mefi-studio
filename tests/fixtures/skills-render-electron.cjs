"use strict";

// Agents > Skills in a real Chromium: a copied booklet and a synthetic bridge that keeps
// skills in memory the way the host keeps them on disk (the page is the thing under test;
// the host has its own suites). It opens the page at six window sizes (the smallest also zoomed to 150%), with the editor
// closed and open, and checks the real geometry: nothing overflows the page, every row,
// field and button is on screen and inside its card, no scroller reserves width for a bar,
// no text is under 12 px. Then it drives the page the way a person does: a new skill with
// the editor saying what is wrong as you type, a name that is taken, an edit, a delete
// that asks twice, a starter, an import and an export, the read-only state, and Back.
// No application main process or live state is loaded; network, permissions and child
// processes are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_SKILLS_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Skills fixture directory is required");
const format = require(path.resolve(__dirname, "..", "..", "scripts", "skill-format.cjs"));
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], calls: [] };
app.setName("Skills Fixture");
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
  const projectId = "project_fixture";
  const configuration = { aiProvider: "auto", executorCli: "opencode", executorTier: "auto", aiAutoProviders: ["zai", "opencode"], agentBrain: { contextScout: true, deskTool: false } };
  const routing = { provider: "auto", roleProviders: {}, models: {}, providerModels: {}, hasZen: true, hasOpenCode: false, hasZai: false, hasOpenRouter: false, hasCustom: false, autoProviders: ["zai", "opencode"], autoFallback: false, subscriptionFirst: true, modelSelection: "jev", executorCli: "opencode", executorTier: "auto", executorTierDefaults: {}, lmStudioEndpoint: "http://127.0.0.1:1234/v1", customEndpoint: "", autoSetup: null };
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Skills fixture", path: root }] },
    tasksList: { ok: true, projectId, tasks: [] }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: true, useReference: true, useTree: true, useWeb: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: { proactive: true, parallel: 8, aiParallel: 4, memoryAlign: true, loopGuard: true, loopGuardApply: true, compactHistory: true, keepAwake: true, background: true }, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, autoBuild: true, minutes: 5, parallel: 2, adaptiveParallel: true, mode: "swarm", running: [], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, draining: false, counts: {}, taskStates: [], next: [] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getAiRouting: routing, cliStatus: [], jevStatus: { enabled: true, route: "zen", routes: { vercel: false, typesafe: false, zen: true, openrouter: false } },
    agentsState: { ok: true, projectId, revision: 0, inherited: true, name: "Studio defaults", configuration, defaults: configuration, presets: [], skills: [], mcpTools: [], routing, seats: {}, choices: {} },
    cliSetupStatus: { ok: true, selected: "auto", clis: [] }, firstRunStatus: { ok: true, firstRun: null },
    machineGet: { ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } }, updateStatus: { ok: true, status: { auto: true } },
    companionState: { ok: true, projectId, projectName: "Skills fixture", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: true, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    learningState: { ok: true, projectId, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} },
    openrouterModels: { ok: true, models: [] }, agentModels: { ok: true, models: [] },
  };
  const starters = format.STARTERS.map((starter) => ({ ...starter }));
  // One of everything a project can hold: good, no front matter, over 16 KB, over 32 KB, a name the page will not edit.
  const seed = [
    { name: "bug-triage", description: "Reproduce a bug, find the cause and propose the smallest fix.", bytes: 1100, body: "1. Read the report.\n2. Reproduce it.\n3. Find the cause.\n" },
    { name: "commit", description: "Write a clear commit message and commit only the task's files.", bytes: 2100, body: "Keep the subject under 72 characters.\n" },
    { name: "design-review", description: "Check a UI change against the design tokens and the contrast rules, and say what to change before it ships to the people who use it every day.", bytes: 21400, body: "Check every color against the tokens.\n" },
    { name: "no-front-matter", description: "Just some words written without front matter.", bytes: 300, body: "Just some words.\n", problem: "It has no front matter. Saving adds a name and a description." },
    { name: "too-long-for-agents", description: "Over what the inventory accepts.", bytes: 35000, body: "x".repeat(200), problem: "This file is 34.2 KB. Agents skip anything over 32 KB; shorten it to use it." },
    { name: "Bad_Name", description: "A name the page does not allow.", bytes: 400, body: "b", problem: "Use lowercase letters, numbers and dashes, up to 64 characters.", editable: false },
    { name: "a-rather-long-skill-name-that-goes-on-and-on-to-test-wrapping-in-a-narrow-window", description: "A skill with a very long name, to see that a card keeps it inside itself at every width.", bytes: 900, body: "Steps.\n" },
  ];
  const others = [{ name: "from-claude", scope: "project", source: ".claude/skills" }, { name: "from-home", scope: "user", source: ".claude/skills" }];
  const preload = path.join(root, "skills-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const calls=[];const statusSubscribers=[];
    const store={skills:${JSON.stringify(seed)},others:${JSON.stringify(others)},starters:${JSON.stringify(starters)},writable:true,blocked:''};const scripts={};
    const next=(name,fallback)=>{const queue=scripts[name];if(!queue||!queue.length)return fallback;return queue.length>1?queue.shift():queue[0];};
    const bridge=Object.fromEntries(Object.keys(responses).map(key=>[key,async()=>responses[key]]));
    const record=(name,result)=>async(...args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return typeof result==='function'?result(...args):result;};
    const pattern=/^[a-z0-9][a-z0-9-]{0,63}$/;
    const rowOf=(skill)=>({name:skill.name,description:skill.description,bytes:skill.bytes,updatedAt:1,path:'.agents/skills/'+skill.name+'/SKILL.md',editable:skill.editable!==false,loadsByItself:skill.bytes<=16000,...(skill.problem?{problem:skill.problem}:{})});
    const sizeOf=(d)=>new TextEncoder().encode('---\\nname: '+d.name+'\\ndescription: '+d.description+'\\n---\\n\\n'+d.body+'\\n').length;
    bridge.skillsList=record('skillsList',()=>({ok:true,dir:'.agents/skills',skills:store.skills.slice().sort((a,b)=>a.name.toLowerCase()<b.name.toLowerCase()?-1:1).map(rowOf),others:store.others,starters:store.starters.filter(s=>!store.skills.some(k=>k.name===s.name)),writable:store.writable,limits:{},...(store.blocked?{blocked:store.blocked}:{})}));
    bridge.skillsRead=record('skillsRead',(name)=>{const s=store.skills.find(k=>k.name===name);return s?{ok:true,name,description:s.description,body:s.body,hasExtra:name==='commit',frontMatter:!s.problem,bytes:s.bytes}:{ok:false,error:'There is no skill named '+name+'.',missing:true};});
    bridge.skillsCreate=record('skillsCreate',(d)=>{if(!pattern.test(d.name))return {ok:false,error:'Use lowercase letters, numbers and dashes, up to 64 characters.'};if(store.skills.some(k=>k.name===d.name))return {ok:false,exists:true,error:'A skill named '+d.name+' already exists. Studio never overwrites one.'};store.skills.push({name:d.name,description:d.description,body:d.body,bytes:sizeOf(d)});return {ok:true,skill:rowOf(store.skills.at(-1))};});
    bridge.skillsSave=record('skillsSave',(d)=>{const s=store.skills.find(k=>k.name===d.name);if(!s)return {ok:false,missing:true,error:'There is no skill named '+d.name+' to save. Create it first.'};Object.assign(s,{description:d.description,body:d.body,bytes:sizeOf(d),problem:undefined});return {ok:true,skill:rowOf(s)};});
    bridge.skillsDelete=record('skillsDelete',(name)=>{const i=store.skills.findIndex(k=>k.name===name);if(i<0)return {ok:false,missing:true,error:'There is no skill named '+name+'.'};store.skills.splice(i,1);return {ok:true,name,keptFiles:0};});
    bridge.skillsImport=record('skillsImport',()=>next('import',{ok:false,canceled:true}));
    bridge.skillsExport=record('skillsExport',()=>next('export',{ok:false,canceled:true}));
    bridge.onAssistantStatus=callback=>{statusSubscribers.push(callback);};
    for(const name of ['onTasks','onProjects','onAssistant','onProjectPreview','onSettingsChanged','onStudioLog','onAutoSetup'])bridge[name]=()=>()=>{};
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('skillsFixture',{calls:()=>calls,clear:()=>{calls.length=0;},script:(name,results)=>{scripts[name]=results;},store:patch=>{Object.assign(store,patch);},names:()=>store.skills.map(k=>k.name)});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "skills-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${label}`);
  };
  const capture = async (name) => {
    await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(150);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
  };
  const calls = (name) => run(`return window.skillsFixture.calls().filter((call) => call.name === ${JSON.stringify(name)}).map((call) => call.args[0]);`);
  const toasts = () => run("return document.getElementById('toast-host')?.textContent || '';");
  const rowOf = (name) => `document.querySelector('#skills-list .skills-list .skills-row[data-name="${name}"]')`;
  const press = (name, label) => run(`const button = [...${rowOf(name)}.querySelectorAll('button')].find((node) => node.textContent === ${JSON.stringify(label)}); if (!button) return false; button.focus(); button.click(); return true;`);
  const type = (selector, value) => run(`const node = document.querySelector(${JSON.stringify(selector)}); node.focus(); node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('blur')); return true;`);
  const text = (selector) => run(`return document.querySelector(${JSON.stringify(selector)})?.textContent ?? null;`);

  // What the page looks like right now, in real pixels.
  const measure = `
    const box = (node) => { const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const body = document.querySelector('#skills-overlay .skills-body');
    const cards = [...document.querySelectorAll('#skills-list .skills-row')];
    const small = [...document.querySelectorAll('#skills-overlay .skills-body *')].filter((node) => node.children.length === 0 && node.textContent.trim() && getComputedStyle(node).display !== 'none' && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.className + ':' + getComputedStyle(node).fontSize);
    const editor = document.querySelector('#skills-list .skills-editor');
    return {
      inner: { w: innerWidth, h: innerHeight }, sheet: box(document.querySelector('#skills-overlay .skills-sheet')), body: box(body),
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      bodyGutter: body.offsetWidth - body.clientWidth, bodyOverflowX: body.scrollWidth > body.clientWidth + 1,
      scrollbarWidth: getComputedStyle(body).scrollbarWidth,
      cards: cards.map((node) => ({ name: node.dataset.name, starter: node.classList.contains('skills-starter'), ...box(node), buttons: [...node.querySelectorAll('button')].map((button) => box(button)), overflowX: node.scrollWidth > node.clientWidth + 1 })),
      editor: editor ? { ...box(editor), fields: [...editor.querySelectorAll('input, textarea, button')].map((node) => ({ id: node.id, ...box(node) })), overflowX: editor.scrollWidth > editor.clientWidth + 1 } : null,
      small,
    };`;
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await until("window.MefiSkills && window.MefiNav && !window.MefiBoot?.isActive?.()", "studio ready");
  report.registered = await run("const record = window.MefiNav.get('skills'); return record ? { id: record.id, kind: record.kind, layer: record.layer, section: record.section, group: record.group, key: record.key, tools: record.showIn.tools, palette: record.showIn.palette, element: record.element, glyph: record.glyph } : null;");
  assert.deepEqual(report.registered, { id: "skills", kind: "overlay", layer: "sheet", section: "agents", group: "tools", key: null, tools: true, palette: true, element: "skills-overlay", glyph: "g-skills" });
  assert.equal(await run("return Boolean(document.getElementById('g-skills'));"), true, "the glyph exists in the sprite");
  assert.ok(await run("return window.MefiNav.LOCAL_ROUTES.agents.includes('skills');"), "it sits in Agents' local row");
  // The 0.5 layout names a record by its place: what was Agents is Team.
  assert.equal(await run("return window.MefiNav.sectionLabel(window.MefiNav.get('skills'));"), "Team");

  const layouts = [[1720, 900, 1], [1440, 900, 1], [1100, 720, 1], [600, 560, 1], [1100, 720, 1.25], [600, 560, 1.5]];
  for (const editing of [false, true]) {
    for (const [width, height, zoom] of layouts) {
      window.setContentSize(width, height); contents.setZoomFactor(zoom); await sleep(300);
      await run("if (window.MefiSkills.isOpen()) window.MefiSkills.close(); window.MefiNav.go('skills');");
      await until("document.querySelectorAll('#skills-list .skills-row').length === 10", `the skills and the starters are painted at ${width}x${height}@${zoom}`);
      if (editing) {
        await run("document.getElementById('skills-new').click();");
        await until("document.querySelector('#skills-list .skills-editor')", `the editor opens at ${width}x${height}@${zoom}`);
      }
      await sleep(250);
      const label = `${editing ? "editor " : ""}${width}x${height}@${zoom}`;
      const m = await run(measure);
      report.layouts.push({ label, ...m, cards: m.cards.length });
      assert.equal(m.pageOverflow, false, `the page overflows at ${label}`);
      assert.equal(m.bodyOverflowX, false, `the page scrolls sideways at ${label}`);
      assert.equal(m.bodyGutter, 0, `the scroller reserves ${m.bodyGutter}px for a bar at ${label}`);
      assert.equal(m.scrollbarWidth, "none", `native bars stay hidden at ${label}`);
      assert.ok(m.sheet.x >= -1 && m.sheet.y >= -1 && m.sheet.r <= m.inner.w + 1 && m.sheet.b <= m.inner.h + 1, `the sheet fits at ${label}: ${JSON.stringify(m.sheet)}`);
      assert.deepEqual(m.small, [], `no text under 12 px at ${label}`);
      assert.equal(m.cards.length, 10, "seven skills and three starters");
      for (const card of m.cards) {
        assert.ok(card.w > 200 && card.h > 30, `${card.name} has a size at ${label}`);
        assert.ok(card.x >= m.body.x - 1 && card.r <= m.body.r + 1, `${card.name} fits the width of the page at ${label}: ${JSON.stringify(card)} in ${JSON.stringify(m.body)}`);
        assert.equal(card.overflowX, false, `${card.name} holds its own content at ${label}`);
        for (const button of card.buttons) assert.ok(button.w > 20 && button.x >= card.x - 1 && button.r <= card.r + 1, `a button of ${card.name} stays inside its card at ${label}: ${JSON.stringify(button)}`);
      }
      for (const [index, a] of m.cards.entries()) for (const b of m.cards.slice(index + 1)) assert.ok(a.b <= b.y + 1 || b.b <= a.y + 1, `${a.name} overlaps ${b.name} at ${label}`);
      if (editing) {
        assert.ok(m.editor && m.editor.w > 200, `the editor has a size at ${label}`);
        assert.equal(m.editor.overflowX, false, `the editor holds its own content at ${label}`);
        assert.ok(m.editor.x >= m.body.x - 1 && m.editor.r <= m.body.r + 1, `the editor fits the page at ${label}`);
        for (const field of m.editor.fields) assert.ok(field.w > 40 && field.x >= m.editor.x - 1 && field.r <= m.editor.r + 1, `${field.id} stays inside the editor at ${label}: ${JSON.stringify(field)}`);
        for (const card of m.cards) assert.ok(card.b <= m.editor.y + 1 || card.y >= m.editor.b - 1, `${card.name} does not overlap the editor at ${label}`);
      }
      if ((zoom === 1 && [1720, 1440, 600].includes(width)) || zoom === 1.5) await capture(`skills-${editing ? "editor-" : ""}${width}${zoom === 1 ? "" : `-zoom${zoom}`}.png`);
    }
  }

  // What the list says about each skill.
  window.setContentSize(1440, 900); contents.setZoomFactor(1); await sleep(300);
  await run("window.MefiSkills.close(); window.MefiNav.go('tasks'); window.MefiNav.go('skills');");
  await until("document.querySelectorAll('#skills-list .skills-row').length === 10", "the page is back");
  assert.equal(await text("#skills-headline"), "7 skills in this project. Type / in Home's message box to call one.");
  // Team's list column holds the page as a place of its own, and marks it while it is open.
  await until(`document.querySelector('#shell-pages [data-page="team:skills"]')?.getAttribute('aria-current') === 'page'`, "Skills is the Team place that shows");
  assert.deepEqual(await run("return [...document.querySelectorAll('#skills-list .skills-list .skills-row:not(.skills-starter)')].map((node) => node.dataset.name);"), ["a-rather-long-skill-name-that-goes-on-and-on-to-test-wrapping-in-a-narrow-window", "Bad_Name", "bug-triage", "commit", "design-review", "no-front-matter", "too-long-for-agents"]);
  assert.equal(await run(`return ${rowOf("design-review")}.querySelector('.skills-flag').textContent;`), "Over 16 KB: agents use it only when you call /design-review");
  assert.match(await run(`return ${rowOf("no-front-matter")}.querySelector('.skills-flag').textContent;`), /^It has no front matter/);
  assert.equal(await run(`return [...${rowOf("Bad_Name")}.querySelectorAll('button')].find((node) => node.textContent === 'Edit').disabled;`), true, "a name the page does not allow is not edited");
  assert.deepEqual(await run("return [...document.querySelectorAll('#skills-list .skills-starter')].map((node) => node.dataset.name);"), format.STARTERS.map((starter) => starter.name).filter((name) => name !== "bug-triage"), "a starter that is already a skill is not offered again");
  assert.match(await text("#skills-list .skills-others summary"), /^Also available to agents: 2 skills from other places$/);
  await capture("skills-list.png");

  // New skill: the editor says what is wrong as you type, and a name that is taken never reaches the host.
  await run("window.skillsFixture.clear(); document.getElementById('skills-new').click();");
  await until("document.querySelector('#skills-list .skills-editor')", "the editor opens");
  await until("document.activeElement?.id === 'skills-name'", "the keyboard lands on the name");
  assert.equal(await run("return document.getElementById('skills-save').disabled;"), true);
  await type("#skills-name", "Bad Name");
  assert.equal(await text("#skills-error"), "Use lowercase letters, numbers and dashes, up to 64 characters.");
  assert.equal(await run("return document.getElementById('skills-name').getAttribute('aria-invalid');"), "true");
  await type("#skills-name", "bug-triage");
  assert.equal(await text("#skills-error"), "A skill named bug-triage already exists. Studio never overwrites one.");
  await type("#skills-name", "release-check");
  await type("#skills-description", "Check a release before it goes out");
  await type("#skills-body", "1. Run the checks.\n2. Read the notes.");
  assert.equal(await run("return document.getElementById('skills-error').hidden;"), true);
  assert.equal(await run("return document.getElementById('skills-save').disabled;"), false);
  assert.match(await text("#skills-size"), /^0\.\d KB of 32 KB$/);
  assert.equal(await text("#skills-meaning"), "Loads by itself when a task matches");
  await type("#skills-body", "x".repeat(17000));
  assert.equal(await text("#skills-meaning"), "Over 16 KB: agents skip it unless you call /release-check");
  await capture("skills-editor-filled.png");
  await type("#skills-body", "x".repeat(33000));
  assert.match(await text("#skills-error"), /^This skill is \d\d\.\d KB; the most is 32 KB\.$/);
  assert.equal(await run("return document.getElementById('skills-save').disabled;"), true);
  await type("#skills-body", "1. Run the checks.\n2. Read the notes.");
  await run("document.getElementById('skills-save').click();");
  await until("!document.querySelector('#skills-list .skills-editor') && document.querySelector('#skills-list .skills-row[data-name=\"release-check\"]')", "the new skill is saved and listed");
  assert.deepEqual(await calls("skillsCreate"), [{ name: "release-check", description: "Check a release before it goes out", body: "1. Run the checks.\n2. Read the notes." }], "the host got a name, a description and the words: no path");
  assert.match(await toasts(), /Saved \.agents\/skills\/release-check\/SKILL\.md\. Type \/release-check in Home's message box to use it\./);
  assert.equal(await text("#skills-headline"), "8 skills in this project. Type / in Home's message box to call one.");

  // Edit: the name is fixed, another tool's front matter is said to be kept, a change is saved.
  await run("window.skillsFixture.clear();");
  assert.equal(await press("commit", "Edit"), true);
  await until("document.querySelector('#skills-list .skills-editor')", "Edit opens the editor");
  assert.equal(await run("return document.getElementById('skills-name').disabled;"), true);
  assert.equal(await run("return document.getElementById('skills-name').value;"), "commit");
  assert.match(await text("#skills-list .skills-editor"), /The name is the folder, and saved team settings point at it, so it can not change\./);
  assert.match(await text("#skills-list .skills-editor"), /Saving keeps it exactly as it is\./);
  await until("document.activeElement?.id === 'skills-description'", "the keyboard lands on the first thing that can change");
  await type("#skills-description", "Write a clear commit message.");
  await run("document.getElementById('skills-save').click();");
  await until("!document.querySelector('#skills-list .skills-editor')", "the change is saved");
  assert.deepEqual((await calls("skillsSave")).map((call) => call.name), ["commit"]);
  assert.match(await toasts(), /Saved \/commit\. A copy of the old text is kept on this PC\./);
  assert.equal(await run(`return ${rowOf("commit")}.querySelector('.skills-blurb').textContent;`), "Write a clear commit message.");
  // A second editor is not started over words that were typed.
  await run("document.getElementById('skills-new').click();");
  await until("document.querySelector('#skills-list .skills-editor')", "a new editor opens");
  await type("#skills-name", "half-written");
  await run("document.getElementById('skills-list').dispatchEvent(new Event('input', { bubbles: true })); const first = document.querySelector('#skills-list .skills-editor textarea'); first.dispatchEvent(new Event('input', { bubbles: true }));");
  assert.equal(await press("bug-triage", "Edit"), true);
  await sleep(200);
  assert.equal(await run("return document.getElementById('skills-name').value;"), "half-written", "the draft was not replaced");
  assert.match(await toasts(), /Save or cancel the skill you are editing first\./);
  await run("document.getElementById('skills-cancel').click();");
  await until("!document.querySelector('#skills-list .skills-editor')", "Cancel closes the editor");

  // Delete asks twice.
  await run("window.skillsFixture.clear();");
  assert.equal(await press("release-check", "Delete"), true);
  assert.equal(await run(`return [...${rowOf("release-check")}.querySelectorAll('button')].some((node) => node.textContent === 'Delete: click again');`), true, "the first press only arms it");
  assert.deepEqual(await calls("skillsDelete"), [], "and nothing reached the host");
  assert.equal(await press("release-check", "Delete: click again"), true);
  await until(`${rowOf("release-check")} === null`, "the skill is deleted");
  assert.deepEqual(await calls("skillsDelete"), ["release-check"]);
  assert.match(await toasts(), /Deleted \/release-check\. A copy of its text is kept on this PC\./);

  // A starter is added as it is, and is then no longer offered.
  await run("window.skillsFixture.clear();");
  const first = format.STARTERS.find((starter) => starter.name === "release-notes");
  await run(`document.querySelector('#skills-list .skills-starter[data-name="${first.name}"] button').click();`);
  await until(`${rowOf(first.name)} !== null && document.querySelector('#skills-list .skills-starter[data-name="${first.name}"]') === null`, "the starter became a skill");
  assert.deepEqual(await calls("skillsCreate"), [{ name: first.name, description: first.description, body: first.body }]);

  // Import and export: the page asks; the host (here, a script) answers.
  await run("window.skillsFixture.clear();");
  await run("window.skillsFixture.script('import', [{ ok: true, skill: { name: 'imported-one' }, skipped: 2 }]);");
  await run("document.getElementById('skills-import').click();");
  await until("document.querySelector('#skills-list .skills-note')", "an import says what happened");
  assert.equal(await text("#skills-list .skills-note span"), "Imported /imported-one. 2 other files in that folder were not imported; a skill is its SKILL.md.");
  assert.deepEqual((await run("return window.skillsFixture.calls().filter((call) => call.name === 'skillsImport').map((call) => call.args);")), [[]], "the page names no folder");
  await run("document.querySelector('#skills-list .skills-note button').click();");
  assert.equal(await run("return document.querySelector('#skills-list .skills-note');"), null, "a note can be dismissed");
  await run("window.skillsFixture.script('import', [{ ok: false, error: 'SKILL.md has no front matter. It needs a name and a description between two --- lines.' }]); document.getElementById('skills-import').click();");
  await until("document.querySelector('#skills-list .skills-note[data-tone=\"bad\"]')", "a refused import says why");
  assert.equal(await run("return document.querySelector('#skills-list .skills-note').getAttribute('role');"), "alert");
  await run("window.skillsFixture.script('export', [{ ok: true, where: '/somewhere/bug-triage', kind: 'zip' }]);");
  assert.equal(await press("bug-triage", "Export zip"), true);
  await until("document.getElementById('toast-host')?.textContent.includes('Exported /bug-triage as a zip file.')", "an export says it is done");
  assert.deepEqual((await calls("skillsExport")), [{ name: "bug-triage", kind: "zip" }]);
  await capture("skills-notes.png");

  // Read-only: the kill switch. Nothing can be made, changed, deleted or imported; a copy can still be exported.
  await run("window.skillsFixture.store({ writable: false }); document.getElementById('skills-refresh').click();");
  await until("document.getElementById('skills-new').disabled", "the page goes read-only");
  assert.match(await text("#skills-headline"), /Editing skills is switched off on this PC\.$/);
  assert.equal(await run("return document.getElementById('skills-import').disabled;"), true);
  assert.equal(await run("return document.querySelectorAll('#skills-list .skills-starter').length;"), 0, "no starters to add");
  assert.equal(await run(`return [...${rowOf("bug-triage")}.querySelectorAll('button')].filter((node) => node.disabled).map((node) => node.textContent).join();`), "Edit,Delete");
  assert.equal(await run(`return [...${rowOf("bug-triage")}.querySelectorAll('button')].find((node) => node.textContent === 'Export folder').disabled;`), false);
  await capture("skills-read-only.png");
  // A project whose .agents is a link says so instead of looking empty.
  await run("window.skillsFixture.store({ writable: true, blocked: '.agents is a link, and Studio does not write through links.' }); document.getElementById('skills-refresh').click();");
  await until("document.getElementById('skills-headline').textContent.startsWith('.agents is a link')", "a blocked folder says so");
  assert.equal(await run("return document.getElementById('skills-new').disabled;"), true);

  // Back leaves the page (through the nav's history, like every Agents page).
  await run("document.getElementById('skills-close').click();");
  await until("!window.MefiSkills.isOpen()", "Close leaves the page");
  assert.deepEqual(report.errors, [], "no console errors");
  report.calls = await run("return window.skillsFixture.calls().map((call) => call.name);");
  report.complete = true;
  finish();
}).catch(finish);
