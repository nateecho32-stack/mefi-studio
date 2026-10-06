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
  // Friends › Playground from the real rules: Nova's companion is out and
  // shares its status; ours shares play only until the owner says otherwise.
  const friendsLib = require(path.join(__dirname, "..", "..", "scripts", "companion-friends.cjs"));
  const NOVA = "111111111111111111";
  const nova = { v: 1, level: "status", look: "cat", mood: "happy", name: "Nova", personality: "playful", status: { state: "working", running: 1, doneToday: 3 } };
  const mine = friendsLib.cardFor("play", { look: "wisp", mood: "idle" });
  const friendsView = (asking) => ({ ok: true, hub: { configured: true, linked: true, state: "ready", error: null, companions: true, companionDirect: true, rooms: ["room_jam"] },
    sharing: { everyone: "play", rules: asking ? [] : [{ scope: "friend", target: NOVA, level: "status", label: "Nova", duration: "session", at: 1 }], hold: null },
    levels: friendsLib.LEVELS.map((id) => ({ id, ...friendsLib.LEVEL_INFO[id] })), never: [...friendsLib.NEVER_SHARED],
    preview: { level: "play", why: "Everyone", card: mine, summary: friendsLib.cardSummary(mine) },
    friends: [{ roomId: "room_jam", userId: NOVA, card: nova, at: 1, level: asking ? "play" : "status", why: asking ? "Everyone" : "Rule for this friend (this session)", sent: asking ? "play" : "status", ask: asking ? friendsLib.consentAsk({ mine, theirs: nova, friendId: NOVA }) : null }],
    sent: [{ at: 1790000000000, roomId: "room_jam", to: null, level: "play", summary: friendsLib.cardSummary(mine) }] });
  const practice = { ...friendsLib.playdate({ me: mine, friend: friendsLib.cardFor("status", { look: "fox", mood: "happy", name: "Pip", personality: "playful", state: "working", running: 1, doneToday: 2 }), seed: "fixture", ids: ["me", "practice"] }), practice: true };
  const practiceLines = practice.beats.filter((beat) => beat.say || beat.emote).length;
  const projects = { ok: true, activeId: project.id, projects: [project] };
  const replies = {
    projectsList: projects, tasksList: { ok: true, tasks: [] }, ideasList: { ok: true, ideas: [] },
    prefsGet: { ok: true, prefs: { commandHome: false } },
    assistantState: { ok: true, state: { status: "paused", agents: [], messages: [], prefs: {}, work: [] } },
    assistantStatus: { ok: true, status: { enabled: false, execute: false, running: [], history: [] } },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] },
    eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null },
    eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    backlogStatus: { ok: true, counts: {}, next: [{ id: "task_1", kind: "task", title: "Polish the landing page", stage: "ready", reason: "Ready for an available worker" }], summary: "1 ready to work on" }, readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data/models.json"))),
    startupState: { ok: true, interactive: true, chosen: false, activeId: project.id, projects: [project] }, startupChoose: projects, startupBegin: { ok: true },
    companionState: { ok: true, state: "resting", look: "wisp", projectName: project.name, roaming: false, queue: { counts: { total: 1 }, items: [{ id: "ask", kind: "question", title: "May I use the local connection?", actions: [{ id: "yes", label: "Allow connection" }, { id: "no", label: "Not now" }] }] }, activity: [{ id: "notice", text: "Your project is ready to explore." }] },
    companionWelcome: { ok: true }, companionSeen: { ok: true },
    firstScan: { ok: true, plan: { ok: true, opencode: { installed: true, version: "1.0" }, providers: { linked: ["Local"], free: { count: 0 } }, explorer: { model: "local/explorer" } } },
    firstScanApply: { ok: true, summary: "Use the local connection." }, firstMap: { ok: true, summary: "A small project.", ideas: { added: 0 } }, firstAssist: { ok: true, advice: { summary: "Ready for our next step." } },
    assistantAnswer: { ok: true }, getAiRouting: { provider: "custom", models: {}, providerModels: {} }, cliStatus: [],
    syncStatus: { ok: true, checkedAt: 1790000000000, headline: "GitHub has 2 commits this PC has not pulled yet.", lines: ["GitHub has 2 commits this PC has not pulled yet.", "Branch wip/a-very-long-branch-name-from-another-pc on GitHub: 3 commits not on main."], pending: [{ kind: "github-branch" }], state: { repo: true, remote: true, device: "DESKTOP-FIXTURE", behind: 2 } },
    hubFriends: friendsView(true), hubSharingSet: friendsView(false), hubPlaydate: practice, hubRooms: { ok: true, rooms: [{ id: "room_jam", name: "Friday jam", kind: "hangout", policy: "request", listed: true, status: "active", you: "owner", ownerId: "123456789012345678", memberCount: 2, maxMembers: 25 }] },
    hubStatus: { ok: true, status: { configured: true, linked: true, state: "ready", user: { id: "123456789012345678", name: "Mefi" }, paused: false, rooms: [] } },
    companionBond: { ok: true, changed: true, bond: "We just met · 1 pet" }, eyesRequestsAction: { ok: true, requests: [] }, assistantWorkOn: { ok: true },
    pcSetupStatus: { ok: true, ready: false, account: "fixture-owner", tools: [{ id: "git", name: "Git", installed: true, version: "2.47.1" }, { id: "gh", name: "GitHub CLI", installed: true, version: "2.63.0" }, { id: "node", name: "Node.js", installed: true, version: "24.21.0" }], project: { root: "C:/Sample/Little planet", github: "fixture-owner/little-planet", hook: true }, steps: [{ id: "install-deps", label: "Install the project's packages", why: "Not installed on this PC yet." }], notes: ["This project is on an exFAT drive. Git cannot keep separate worktrees there, so sessions end up sharing one folder. Move the project to an NTFS drive when you can."] },
    vaultStatus: { ok: true, linked: true, repo: "fixture-owner/mefi-studio-vault", keyMatches: true, encryption: true, confirmation: "I understand this shares my keys", pcs: [{ name: "DESKTOP-FIXTURE", self: true, at: 1790000000000, projects: [{ repo: "fixture-owner/little-planet", risk: 1, behind: 0 }] }, { name: "LAPTOP-FIXTURE", self: false, at: 1789990000000, projects: [] }], shelves: [{ id: "brains", label: "Agent brains" }, { id: "insights", label: "How models did, by kind of task" }] },
    vaultLibrary: { ok: true, items: [{ shelf: "insights", id: "models", from: "LAPTOP-FIXTURE", source: "vault", title: "How 3 models did", at: 1, keptAt: 1, learns: true }] },
    vaultKeys: { ok: true, confirmation: "I understand this shares my keys", keys: ["openrouter", "zai"], setup: [] },
    syncRun: { ok: true, checkedAt: 1790000060000, headline: "This PC matches GitHub main.", lines: ["This PC matches GitHub main.", "Pulled 2 commits from GitHub."], pending: [], state: { repo: true, remote: true, device: "DESKTOP-FIXTURE", behind: 0 } },
  };
  const preload = path.join(root, "preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const replies=${JSON.stringify(replies)},calls=[];let chatReply;const api=Object.fromEntries(Object.keys(replies).map(key=>[key,async(...args)=>{calls.push({key,args});return replies[key];}]));api.assistantMessage=(...args)=>{calls.push({key:'assistantMessage',args});return new Promise(resolve=>{chatReply=resolve;});};let syncListener=null;api.onSyncEvent=fn=>{syncListener=fn;};const roomReplies={requests:{ok:true,requests:[{id:"req_1",roomId:"room_jam",requester:{id:"223456789012345678",name:"Aksana"},note:"Can I bring snacks?",status:"pending",createdAt:1790000000000}]},invites:{ok:true,invites:[]},messages:{ok:true,hasMore:false,messages:[{id:"423456789012345678",author:{id:"223456789012345678",name:"Aksana",viaStudio:true},text:"hi <@123456789012345678>, ready for Friday?",createdAt:1790000000000,editedAt:null,mentions:[{id:"123456789012345678",name:"Mefi"}],attachments:[]}]},sendMessage:{ok:true,messageId:"523456789012345678"}};api.hubRoom=async(method,...args)=>{calls.push({key:'hubRoom',args:[method,...args]});return roomReplies[method]??{ok:true};};contextBridge.exposeInMainWorld('mefiStudio',api);contextBridge.exposeInMainWorld('hubFixture',{calls:()=>calls,pushSync:result=>syncListener?.(result),completeChat:ok=>{chatReply?.({ok,error:ok?undefined:'Try again when connected.'});chatReply=null;},setState:state=>{replies.companionState.state=state;},patch:fields=>{Object.assign(replies.companionState,fields);}});localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.motion','on');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.setupHelper.seen','setup-helper-1');`);
  win = new BrowserWindow({ show: false, width: 1280, height: 900, frame: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  const wc = win.webContents; wc.setAudioMuted(true); wc.setFrameRate(30); wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("console-message", (_event, detail, legacy) => { if (detail?.level === "error" || detail === 3) report.errors.push(detail?.message || legacy); });
  const run = (source) => wc.executeJavaScript(`(async()=>{${source}})()`, true);
  const until = async (condition, label) => { const deadline = Date.now() + 12000; while (Date.now() < deadline) { assert.deepEqual(report.errors, []); if (await run(`return Boolean(${condition});`)) return; await sleep(40); } throw new Error(`Timed out: ${label}`); };
  const capture = async (name) => { await sleep(650); fs.writeFileSync(path.join(root, name + ".png"), (await wc.capturePage()).toPNG()); };
  const click = async (selector) => {
    // A bubble still flying out (hub-spawn) is not where it will land; a click
    // at its moving centre could hit the backdrop and close the hub.
    const pt = await run(`const el=document.querySelector(${JSON.stringify(selector)});await Promise.all(el.getAnimations().filter(a=>a.effect?.getTiming?.().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
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
  await run("window.MefiOnboarding.close();await window.MefiVibe.setMode('build');await window.MefiNav.go('command');document.getElementById('companion-orb').click();");
  await until("window.MefiCompanionHub.isOpen()", "hub open"); await capture("03-hub");
  assert.equal(await run("return document.activeElement.id;"), "agent-hub-return");
  assert.equal(await run("return document.getElementById('idle-hud').inert;"), true);
  await click('[data-hub-section="ask"]');
  assert.deepEqual(await run("return [...document.querySelectorAll('#companion-pane-ask .companion-starters button')].filter(el=>el.getClientRects().length).map(el=>el.textContent);"), ["What are you doing?", "What's next?", "Recap today"], "three starters, one tap each");
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
  await escape();
  // A background look (sync:event) badges the Friends bubble before it is opened.
  await run("hubFixture.pushSync({ ok: true, risk: 2, pending: [{ kind: 'unpushed' }, { kind: 'uncommitted' }], state: { repo: true, remote: true, behind: 0 } });");
  await until("document.querySelector('[data-hub-section=\"friends\"] .agent-hub-count')?.textContent==='2'", "background look badges Friends");
  assert.match(await run("return document.querySelector('[data-hub-section=\"friends\"]').getAttribute('aria-label');"), /2 to sync between your PCs/);
  await capture("07b-friends-badge");
  // Friends is a place of its own: the bubble lets the hub go and opens the Friends page at The Lobby.
  await click('[data-hub-section="friends"]');
  await until("document.getElementById('friends-overlay')?.hidden===false && document.getElementById('friends-overlay').dataset.place==='lobby' && !window.MefiCompanionHub.isOpen()", "Friends opens its page at The Lobby");
  await run("window.MefiNav.go('friends-page',{place:'pcs'});");
  await until("document.querySelector('#friends-overlay .pc-sync')?.dataset.state==='pending'", "Friends › Your PCs looks");
  // Looks only: the card's own and the project-switch look at startup, never a sync.
  const looks = await run("return hubFixture.calls().filter(call=>call.key.startsWith('sync')).map(call=>call.key);");
  assert.ok(looks.length >= 1 && looks.every((key) => key === "syncStatus"), `opening Friends only looks: ${looks}`);
  await capture("08-friends-pcs");
  await click("#pc-sync-run");
  await until("document.querySelector('#friends-overlay .pc-sync')?.dataset.state==='clean'", "Sync this PC");
  assert.equal(await run("return document.getElementById('friends-overlay').hidden===false && document.getElementById('pc-sync-status').textContent;"), "This PC matches GitHub main.", "the answer lands on the Friends page");
  // A clean sync leaves only the room request on the badge.
  await until("document.querySelector('[data-hub-section=\"friends\"] .agent-hub-count')?.textContent==='1'", "a clean sync clears Your PCs from the badge");
  assert.equal(await run("return document.querySelector('[data-hub-section=\"friends\"]').getAttribute('aria-label');"), "Friends · 1 waiting in Rooms");
  await capture("09-friends-synced"); report.pcs = true;
  // Set up this PC opens in place and only then checks the PC.
  assert.equal(await run("return hubFixture.calls().some(call=>call.key==='pcSetupStatus');"), false, "nothing is checked until the section opens");
  // Out of the way of the panel's "more below" arrow, which sits at the edge.
  await run("document.querySelector('#pc-setup > summary').scrollIntoView({block:'center'});"); await sleep(150);
  await click("#pc-setup > summary");
  await until("document.getElementById('pc-setup-status')?.textContent==='A few things to finish on this PC:'", "Set up this PC checks");
  assert.equal(await run("return document.querySelectorAll('#pc-setup .pc-setup-list li').length;"), 7);
  assert.ok(await run("const el=document.querySelector('#pc-setup [data-step=\"install-deps\"]');el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>0&&(hit===el||el.contains(hit));"), "the setup step is clickable");
  await capture("09b-friends-setup"); report.setup = true;
  // Share between my PCs: every PC's line and the library; keys stay locked
  // until the exact phrase is typed, under the warning.
  await run("document.querySelector('#pc-vault > summary').scrollIntoView({block:'center'});"); await sleep(150);
  await click("#pc-vault > summary");
  await until("document.getElementById('pc-vault')?.dataset.state==='linked' && document.querySelectorAll('#pc-vault-pcs li').length===2 && document.querySelector('#pc-vault-library li')?.textContent.includes('counts in learning')", "the vault lists both PCs and the library");
  await run("document.querySelector('#pc-vault-keys > summary').scrollIntoView({block:'center'});"); await sleep(150);
  await click("#pc-vault-keys > summary");
  await until("document.querySelectorAll('#pc-vault-keys-list input[type=checkbox]').length===2", "saved keys are listed by name");
  assert.equal(await run("return document.getElementById('pc-vault-keys-share').disabled;"), true, "keys stay locked until the phrase is typed");
  assert.match(await run("return document.getElementById('pc-vault-keys').textContent;"), /You are sharing keys and setup information/);
  assert.ok(await run("const box=document.getElementById('pc-vault');return box.scrollWidth<=box.clientWidth+1;"), "the vault fits the panel");
  await capture("09d-friends-vault"); report.vault = true;
  // Friends › Rooms: the request tab counts, the room opens with its chat as
  // text, and a message goes out through hub:room.
  await run("window.MefiNav.go('friends-page',{place:'rooms'});");
  await until("document.getElementById('rooms')?.dataset.state==='ready' && document.getElementById('rooms-tab-requests')?.textContent==='Requests (1)'", "Rooms lists the room and its request");
  await click("#rooms [data-room=\"room_jam\"] .rooms-button");
  await until("document.querySelector('#rooms .rooms-message-text')?.textContent==='hi @Mefi, ready for Friday?'", "the room opens with its chat");
  await run("const box=document.getElementById('rooms-compose');box.value='Yes! Snacks welcome.';");
  await click("#rooms-send");
  await until("hubFixture.calls().some(call=>call.key==='hubRoom'&&call.args[0]==='sendMessage')", "the message goes out");
  assert.deepEqual(await run("return hubFixture.calls().find(call=>call.key==='hubRoom'&&call.args[0]==='sendMessage').args;"), ["sendMessage", "room_jam", "Yes! Snacks welcome."]);
  assert.ok(await run("const el=document.getElementById('rooms-send');el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>0&&(hit===el||el.contains(hit));"), "Send is clickable on the Friends page");
  await capture("09c-friends-rooms"); await click("#rooms-back"); report.rooms = true;
  // Friends › Playground: a friend who shares more makes the companion ask;
  // nothing is shared back until the owner answers.
  await run("window.MefiNav.go('friends-page',{place:'playground'});");
  await until("document.getElementById('friends-status')?.textContent.includes(\"1 friend's companion is out\") && document.querySelector('.friends-ask')", "playground lists a friend");
  assert.match(await run("return document.querySelector('.friends-ask p').textContent;"), /^Nova told us how its person's work is going/);
  assert.equal(await run("return hubFixture.calls().filter(call=>call.key==='hubSharingSet').length;"), 0, "nothing is shared back on its own");
  assert.match(await run("return document.getElementById('friends-preview').textContent;"), /^Friends see a wisp that looks idle\. That's Play only, your choice for everyone\.$/);
  await run("document.querySelector('.friends-ask').scrollIntoView({block:'center'});"); await capture("11-friends-playground");
  await click(".friends-ask .primary");
  await until("hubFixture.calls().some(call=>call.key==='hubSharingSet') && !document.querySelector('.friends-ask')", "share back for this session");
  assert.deepEqual(await run("return hubFixture.calls().find(call=>call.key==='hubSharingSet').args[0];"), { rule: { scope: "friend", target: "111111111111111111", level: "status", label: "Nova" }, duration: "session", name: "Mefi" });
  await click("#friends-practice");
  await until("document.querySelector('#friends-stage[data-playing] .friends-say:not(:empty)')", "the playdate speaks");
  await run("document.getElementById('friends-stage').scrollIntoView({block:'center'});"); await capture("12-friends-playdate");
  await run("document.documentElement.dataset.motion='off';");
  await until("!document.querySelector('#friends-stage[data-playing]')", "the playdate ends");
  assert.equal(await run("return document.querySelectorAll('.friends-lines li').length;"), practiceLines, "every line is kept as text");
  assert.ok(await run("return hubFixture.calls().some(call=>call.key==='hubPlaydate'&&call.args[0].practice===true);"));
  await run("document.documentElement.dataset.motion='on';"); report.playground = true;
  // Petting: stroking the wisp back and forth reaches the bond once (the hub again, over the closed Friends page).
  await run("window.MefiNav.closeAll(); window.MefiCompanionHub.open();"); await sleep(400);
  const heart = await run("const r=document.getElementById('agent-hub-return').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};");
  for (let i = 0; i < 10; i += 1) { wc.sendInputEvent({ type: "mouseMove", x: heart.x + (i % 2 ? 20 : -20), y: heart.y }); await sleep(50); }
  await until("hubFixture.calls().some(call=>call.key==='companionBond'&&call.args[0]==='pet')", "petting the wisp");
  await until("document.getElementById('agent-hub-bond').textContent==='We just met · 1 pet'", "the bond remembers");
  // Straight work: no faces, a finished reply is a plain check.
  await run("hubFixture.patch({expressions:false,personality:'focused'});await window.MefiCompanion.refresh();window.MefiCompanionHub.play(document.querySelector('.agent-hub-avatar svg'),'^_^');");
  assert.equal(await run("return document.querySelector('.agent-hub-avatar .agent-reaction')?.textContent;"), "✓");
  assert.equal(await run("return document.querySelectorAll('.agent-hub-avatar .agent-spark').length;"), 0);
  await run("hubFixture.patch({expressions:true,personality:'balanced'});await window.MefiCompanion.refresh();"); report.pet = true;
  // Suggest work: the idea goes to the inbox as the owner's; a pick is one Work on it away.
  await click('[data-hub-section="ideas"]');
  await until("document.querySelector('.agent-hub-pick-list button')", "my picks for next");
  await run("document.getElementById('agent-hub-suggest-text').value='Add a dark theme to the settings page';");
  await click(".agent-hub-suggest button[type=submit]");
  await until("hubFixture.calls().some(call=>call.key==='eyesRequestsAction')", "the suggestion reaches the inbox");
  const suggested = await run("return hubFixture.calls().find(call=>call.key==='eyesRequestsAction').args[0];");
  assert.equal(suggested.action, "add"); assert.deepEqual(suggested.requests, [{ prompt: "Add a dark theme to the settings page", source: "manual" }]);
  await click(".agent-hub-pick-list button");
  await until("hubFixture.calls().some(call=>call.key==='assistantWorkOn')", "work on a pick");
  const picked = await run("return hubFixture.calls().find(call=>call.key==='assistantWorkOn').args[0];");
  assert.equal(picked.kind, "task"); assert.equal(picked.id, "task_1");
  await capture("13-suggest-work"); report.ideas = true;
  // What I'm doing: the work, the team and what just happened, in one place.
  await escape(); await click('[data-hub-section="now"]');
  await until("!document.getElementById('companion-pane-now').hidden && document.querySelector('#companion-pane-now .companion-now-activity')?.textContent.includes('Your project is ready to explore.') && document.querySelector('#companion-pane-now .companion-now-live h3')", "what I'm doing");
  assert.equal(await run("return getComputedStyle(document.querySelector('.companion-in-hub .companion-tabs')).display;"), "none", "the bubbles are the menu in the hub");
  await capture("14-now");
  await escape(); await click('[data-hub-section="settings"]');
  await until("document.getElementById('companion-personality-says')?.textContent==='Warm and to the point. Reacts when things happen.'", "personality in settings");
  assert.equal(await run("return document.querySelector('[data-companion-setting=personality]').value;"), "balanced");
  await capture("15-personality");
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
    await escape(); await run("if(!window.MefiCompanionHub.isOpen())window.MefiCompanionHub.open();window.MefiCompanionHub.back();"); await sleep(300);
    await click('[data-hub-section="friends"]'); await until("document.getElementById('friends-overlay')?.hidden===false", `Friends at ${width}/${zoom}`);
    await run("window.MefiNav.go('friends-page',{place:'pcs'});"); await until("document.getElementById('pc-sync-run')", `Your PCs at ${width}/${zoom}`); await sleep(450);
    assert.ok(await run("const el=document.getElementById('pc-sync-run');el.scrollIntoView({block:'nearest'});await new Promise(r=>requestAnimationFrame(r));const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);const card=document.querySelector('#friends-overlay .pc-sync').getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&(hit===el||el.contains(hit))&&card.left>=0&&card.right<=innerWidth+1;"), `Sync this PC reachable at ${width}/${zoom}`);
    await capture(`10-friends-${width}-${zoom}`);
    await run("window.MefiNav.closeAll(); window.MefiCompanionHub.open();"); await sleep(300);
  }
  report.layouts = true;
  await finish();
}).catch(finish);
