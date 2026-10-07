"use strict";

// Friends in the 0.5 layout, in a real Chromium: a copied booklet launched with ?layout=v2 and a synthetic bridge.
// renderer/companion-hub.js files Friends into the prototype's three places (docs/prototype/mefi-studio-0.5-v5.html,
// friendsView, FRIEND_SUBS), and renderer/shell.js lists them in the list column. This opens each place from its row
// with a real pointer at 1920x1080 and measures: the list in the prototype's order, the current row, the breadcrumb
// (Friends / <place>), the page's title and the line under it, the one card that shows, nothing wider than the page,
// and no text under 12 px. The rail's Friends, Search's Rooms, Your PCs and Playground, and the companion's Friends
// bubble land on the page; a tab per place. Screenshots are kept when the test is given a capture folder (MEFI_FRIENDS_CAPTURE_DIR). No application main
// process or live state is loaded; network, permissions and child processes are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_FRIENDS_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Friends fixture directory is required");
const studio = path.resolve(__dirname, "..", "..");
const report = { errors: [], networkAttempts: [], processAttempts: [], places: [], shots: [], steps: [], complete: false };
app.setName("Friends Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
}
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-prefers-reduced-motion", "reduce");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
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

// The prototype's places, in its order, and the card each shows.
const PLACES = [["lobby", "The Lobby", "friends-front"], ["rooms", "Rooms", "rooms"], ["pcs", "Your PCs", "pc-sync"], ["playground", "Playground", "friends-card"], ["hub", "Project hub", "project-hub"], ["events", "Events", "friends-events"], ["shop", "Shop", "friends-shop"]];

async function bridgeNames() {
  const source = fs.readFileSync(path.join(studio, "preload.cjs"), "utf8");
  return [...new Set([...source.matchAll(/^  ([A-Za-z][A-Za-z0-9_]*):/gm)].map((match) => match[1]))];
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url);
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const now = Date.now(), projectId = "friends-project";
  // Friends › Playground from the real rules (as tests/fixtures/companion-hub-render-electron.cjs builds it).
  const friendsLib = require(path.join(studio, "scripts", "companion-friends.cjs"));
  const NOVA = "111111111111111111";
  const nova = { v: 1, level: "status", look: "cat", mood: "happy", name: "Nova", personality: "playful", status: { state: "working", running: 1, doneToday: 3 } };
  const mine = friendsLib.cardFor("play", { look: "wisp", mood: "idle" });
  const friendsView = { ok: true, hub: { configured: true, linked: true, state: "ready", error: null, companions: true, companionDirect: true, rooms: ["room_jam"] },
    sharing: { everyone: "play", rules: [], hold: null }, levels: friendsLib.LEVELS.map((id) => ({ id, ...friendsLib.LEVEL_INFO[id] })), never: [...friendsLib.NEVER_SHARED],
    preview: { level: "play", why: "Everyone", card: mine, summary: friendsLib.cardSummary(mine) },
    friends: [{ roomId: "room_jam", userId: NOVA, card: nova, at: 1, level: "play", why: "Everyone", sent: "play", ask: friendsLib.consentAsk({ mine, theirs: nova, friendId: NOVA }) }], sent: [] };
  const project = { id: projectId, name: "Notes app", path: root };
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [project] },
    tasksList: { ok: true, projectId, tasks: [] }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: {}, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, running: [], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, counts: {}, taskStates: [], next: [] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getApiKey: { saved: false }, getAiRouting: { provider: "zen", models: {}, providerModels: {} }, cliStatus: [], launchStudio: { ok: true }, firstRunStatus: { ok: true, firstRun: null },
    companionState: { ok: true, projectId, projectName: "Notes app", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: false, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    companionWelcome: { ok: true }, companionSeen: { ok: true }, companionBond: { ok: true, changed: false, bond: "" },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    worktreesList: { ok: true, repo: false, projectId, enabled: { on: false, forced: false } }, skillsList: { ok: true, skills: [], roots: [] },
    syncStatus: { ok: true, checkedAt: now, headline: "GitHub has 2 commits this PC has not pulled yet.", lines: ["GitHub has 2 commits this PC has not pulled yet."], pending: [{ kind: "github-branch" }], state: { repo: true, remote: true, device: "DESKTOP-FIXTURE", behind: 2 } },
    hubFriends: friendsView, hubSharingSet: friendsView,
    hubRooms: { ok: true, rooms: [{ id: "room_jam", name: "Friday jam", kind: "hangout", policy: "request", listed: true, status: "active", you: "owner", ownerId: "123456789012345678", memberCount: 2, maxMembers: 25 }] },
    hubStatus: { ok: true, status: { configured: true, linked: true, state: "ready", user: { id: "123456789012345678", name: "Mefi" }, paused: false, rooms: [], front: true, events: true, shop: true } },
    pcSetupStatus: { ok: true, ready: true, account: "fixture-owner", tools: [{ id: "git", name: "Git", installed: true, version: "2.47.1" }, { id: "gh", name: "GitHub CLI", installed: true, version: "2.63.0" }], project: { root: "C:/Notes app", github: "fixture-owner/notes-app", hook: true }, steps: [], notes: [] },
    vaultStatus: { ok: true, linked: false, pcs: [], shelves: [] },
  };
  // The Lobby's front page as hub-client hands it over (scripts/hub-client.cjs frontPage).
  const front = {
    ok: true,
    online: { count: 3, people: [
      { id: "200000000000000001", name: "Maxwell", rank: "flame", specialRanks: ["builder"], where: { id: "room_jam", name: "Friday jam", kind: "hangout" }, building: { project: "Pixel Forge", running: 3, doneToday: 4 } },
      { id: "200000000000000002", name: "Jabilee", rank: "ember", specialRanks: [], where: { id: "lobby", name: "Lobby", kind: "hangout" } },
      { id: "200000000000000003", name: "Rook", rank: "spark", specialRanks: [], where: null },
    ] },
    lobby: { here: 2 },
    rooms: [{ id: "room_jam", name: "Friday jam", kind: "hangout", status: "active", you: "owner", ownerId: "123456789012345678", memberCount: 4, maxMembers: 25, policy: "request", listed: true, here: 2 },
      { id: "room_cowork", name: "Ruins Runner cowork", kind: "cowork", status: "active", you: "none", ownerId: null, memberCount: 2, maxMembers: 10, policy: "request", listed: true, here: 0 }],
    ownRoom: { id: "room_jam", name: "Friday jam", kind: "hangout" },
    visible: true,
    top: { id: "proj_a", url: "https://maxwell.itch.io/pixel-forge", host: "maxwell.itch.io", title: "Pixel Forge passes 40 plays in its first three days", blurb: "A sprite editor for Studio projects. Play it from the Project hub; you both earn credits after two minutes.", kind: "tool", owner: { id: "200000000000000001", name: "Maxwell", rank: "flame" }, plays: 41, stars: 12, createdAt: now - 3 * 86_400_000, lastPlayedAt: now, featuredUntil: null, starred: false, week: true, weekPlays: 40, weekStars: 12 },
    fresh: [{ id: "proj_b", url: "https://tess.itch.io/tiny-tides", host: "tess.itch.io", title: "Tiny Tides", blurb: "", kind: "game", owner: { id: "200000000000000004", name: "Tess", rank: "ember" }, plays: 9, stars: 2, createdAt: now - 86_400_000, lastPlayedAt: now, featuredUntil: null, starred: false },
      { id: "proj_c", url: "https://rook.itch.io/patch-notes", host: "rook.itch.io", title: "Patch Notes Bot", blurb: "", kind: "tool", owner: { id: "200000000000000003", name: "Rook", rank: "spark" }, plays: 3, stars: 0, createdAt: now - 2 * 86_400_000, lastPlayedAt: null, featuredUntil: null, starred: false }],
    rankUps: [{ id: "200000000000000002", name: "Jabilee", rank: { key: "flame", name: "Flame" } }, { id: "200000000000000005", name: "Sol", rank: { key: "ember", name: "Ember" } }],
    you: { balance: 45, lifetime: 95, rank: { key: "ember", name: "Ember", next: { key: "flame", name: "Flame", at: 200 }, progress: 0.3 }, week: { earned: 15, plays: 3, stars: 1 } },
  };
  // Friends › Events as hub-client hands it over (scripts/hub-client.cjs eventsPage): a jam taking entries, a co-work hour on now.
  const eventReplies = { events: { ok: true, now,
    jam: { id: "jam_w2909", theme: "Glow", nextTheme: "Signals", phase: "entries", startsAt: now - 86_400_000, entriesUntil: now + 3 * 86_400_000, endsAt: now + 5 * 86_400_000, pool: 140,
      entries: [{ user: { id: "200000000000000001", name: "Maxwell" }, project: { id: "proj_a", title: "Pixel Forge", url: "https://maxwell.itch.io/pixel-forge", host: "maxwell.itch.io", kind: "tool" }, players: 4, votes: null, mine: false, voted: false, played: true },
        { user: { id: "200000000000000004", name: "Tess" }, project: { id: "proj_b", title: "Tiny Tides", url: "https://tess.itch.io/tiny-tides", host: "tess.itch.io", kind: "game" }, players: 1, votes: null, mine: false, voted: false, played: false }],
      you: { entered: null, votesLeft: 3 }, results: null },
    lastJam: { id: "jam_w2908", theme: "Echoes", endsAt: now - 86_400_000, pool: 120, results: [{ userId: "200000000000000002", name: "Jabilee", place: 1, why: "place", amount: 57, paid: 57, projectId: "proj_c" }] },
    cowork: { id: "cowork_d1h18", roomId: "room_hour", startsAt: now - 1_200_000, endsAt: now + 2_400_000, started: true, joined: false, here: 3, checks: 0, checksDone: 1, checksNeeded: 2, attendees: 0, amount: 4 },
    nextCowork: now + 8 * 3_600_000, together: { ticks: 1, needed: 3, amount: 4, everyMs: 600_000 }, budget: { budget: 275, paid: 8, left: 267, active: 3 } } };
  // Friday jam's chat: two friends, a mention of this member, one of someone this Studio has no name for, and this member's own.
  const ME_ID = "123456789012345678";
  const chat = [
    { id: "500000000000000001", author: { id: "200000000000000001", name: "Maxwell", viaStudio: true }, text: "Anyone up for a jam tonight?", createdAt: now - 50 * 60_000, editedAt: null, mentions: [], attachments: [] },
    { id: "500000000000000002", author: { id: "200000000000000002", name: "Jabilee", viaStudio: true }, text: "Me! <@123456789012345678> you in?", createdAt: now - 45 * 60_000, editedAt: null, mentions: [{ id: ME_ID, name: "Mefi" }], attachments: [] },
    { id: "500000000000000003", author: { id: ME_ID, name: "Mefi", viaStudio: true }, text: "Yes, bringing the new sprite tool.\nIt's on the Project hub.", createdAt: now - 40 * 60_000, editedAt: null, mentions: [], attachments: [] },
    { id: "500000000000000004", author: { id: "200000000000000001", name: "Maxwell", viaStudio: true }, text: "Ask <@200000000000000099> too, they made the tileset.", createdAt: now - 30 * 60_000, editedAt: null, mentions: [], attachments: [] },
    { id: "500000000000000005", author: { id: "200000000000000002", name: "Jabilee", viaStudio: true }, text: "See you at 8.", createdAt: now - 10 * 60_000, editedAt: null, mentions: [], attachments: [] },
  ];
  const roomReplies = { requests: { ok: true, requests: [] }, invites: { ok: true, invites: [] }, messages: { ok: true, hasMore: true, messages: chat }, front, roomCode: { ok: true, code: "KQ7M-2PXD", link: "https://mefi-relay.mefi-studio.workers.dev/join/KQ7M2PXD" } };
  // Friends › Shop as main's hub:shop hands it over (the relay's Studio catalog, members' packs): scales for Ember (Ember
  // itself is free with every Studio and has a card of its own), effects and packs.
  const shopItem = (id, kind, name, price, blurb, extra = {}) => ({ id, kind, name, blurb, price, requires: null, maker: null, data: null, sales: 0, owned: false, status: "listed", createdAt: now, updatedAt: now, ...extra });
  const shopReplies = {
    studio: { ok: true, next: null, balance: 240, canEarn: true, hold: null, items: [
      shopItem("studio:skin-frost", "skin", "Frost scales", 40, "Ember in icy blue."),
      shopItem("studio:skin-void", "skin", "Void scales", 60, "Ember in black with a violet glow."),
      shopItem("studio:fx-dissolve", "effect", "Dissolve", 60, "Menus crumble into pixels when they close."),
      shopItem("studio:fx-embers", "effect", "Burn away", 90, "Menus burn away from the edges with glowing embers."),
      shopItem("studio:style-dragonscale", "nodestyle", "Dragon scales", 80, "Nodes covered in shimmering dragon scales, with ember sparks along the wires."),
      shopItem("studio:style-constellation", "nodestyle", "Constellation", 80, "Nodes as bright stars joined by star-chart lines, with shooting stars."),
      shopItem("studio:pack-synthwave", "pack", "Synthwave", 50, "Hot pink and violet on midnight blue.", { data: { v: 1, palette: { accent: "#ff4fa3", accent2: "#8b5cff", background: "#0d0b1f", surface: "#17132e", text: "#f3ecff" }, nodeStyle: "halo", material: "atmosphere", font: "display" } }),
      shopItem("studio:pack-sakura", "pack", "Sakura (light)", 50, "Soft pink on warm white, a light look.", { data: { v: 1, palette: { accent: "#b8325f", accent2: "#8a6bd1", background: "#fbf6f4", surface: "#ffffff", text: "#2b1f24" }, nodeStyle: "minimal", material: "focus", font: "studio" } }),
    ] },
    new: { ok: true, next: null, balance: 240, canEarn: true, hold: null, items: [
      shopItem("pack_nightmarket0001", "pack", "Night market with a rather long name", 30, "Neon on wet streets.", { maker: { id: "200000000000000001", name: "Maxwell" }, sales: 12, data: { v: 1, palette: { accent: "#ffb347", accent2: "#7f5af0", background: "#101014", surface: "#1b1b22", text: "#f4f1ea" }, nodeStyle: "glass", material: "studio", font: "serif" } }),
      shopItem("pack_paper000000001", "pack", "Paper", 0, "", { maker: { id: "200000000000000004", name: "Tess" }, sales: 3, data: { v: 1, palette: { accent: "#9b3d12", background: "#fbf6ee", surface: "#ffffff", text: "#2b2118" }, nodeStyle: "minimal", material: "focus", font: "serif" } }),
    ] },
    owned: { ok: true, next: null, balance: 240, canEarn: true, hold: null, items: [] },
    mine: { ok: true, next: null, balance: 240, canEarn: true, hold: null, items: [] },
    shopOwned: { ok: true, items: [] },
  };
  const names = await bridgeNames();
  const preload = path.join(root, "friends-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const roomReplies=${JSON.stringify(roomReplies)};const eventReplies=${JSON.stringify(eventReplies)};const shopReplies=${JSON.stringify(shopReplies)};const names=${JSON.stringify(names)};const calls=[];
    const bridge={};
    for(const name of names){
      if(/^on[A-Z]/.test(name))bridge[name]=()=>()=>{};
      else bridge[name]=async(...args)=>{calls.push(name);return name in responses?JSON.parse(JSON.stringify(responses[name])):{ok:true};};
    }
    bridge.hubRoom=async(method)=>{calls.push('hubRoom:'+method);return roomReplies[method]??{ok:true};};
    bridge.hubEvents=async(method)=>{calls.push('hubEvents:'+method);return eventReplies[method]??{ok:true};};
    bridge.hubShop=async(method,view)=>{calls.push('hubShop:'+method);return (method==='shop'?shopReplies[view]:shopReplies[method])??{ok:true,items:[]};};
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('friendsFixture',{calls:()=>calls.slice(),signedIn:(on)=>{responses.hubStatus.status.linked=on===true;}});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));localStorage.setItem('mefiStudio.whatsNew.seen','vibe-build-1');localStorage.setItem('mefiStudio.setupHelper.seen','setup-helper-1');
  `);
  const window = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, frame: false, enableLargerThanScreen: true, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, what, ms = 15000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "friends-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${what}`);
  };
  const capture = async (name) => {
    await run("for (const notice of document.querySelectorAll('#toast-host .toast')) notice.remove(); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(200);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
    report.shots.push(name);
  };
  const resize = async (width, height, zoom = 1) => {
    window.setContentSize(width, height); contents.setZoomFactor(zoom);
    const wanted = Math.round(width / zoom);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { if (Math.abs(await run("return innerWidth;") - wanted) <= 1) break; await sleep(60); }
    await sleep(300);
  };
  const click = async (selector) => {
    await run(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center", behavior: "instant" }); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));`);
    const box = await run(`const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, reached: Boolean(hit) && (hit === node || node.contains(hit)), on: hit ? (hit.id || hit.className || hit.tagName) : null };`);
    assert.ok(box && box.w > 0, `${selector} is on screen`);
    assert.equal(box.reached, true, `a pointer reaches ${selector} (${box.on} is on top)`);
    const zoom = contents.getZoomFactor(), point = { x: Math.round(box.x * zoom), y: Math.round(box.y * zoom) };
    contents.sendInputEvent({ type: "mouseMove", ...point }); contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point }); contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
    await sleep(250);
  };

  const measure = `
    const overlay = document.getElementById('friends-overlay'), body = document.getElementById('friends-place-body');
    const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
    const shown = (node) => { if (!node || !node.getClientRects().length) return false; for (let n = node; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
    const own = (node) => [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
    const all = [...(overlay?.querySelectorAll('*') ?? []), ...(document.getElementById('shell-pages')?.querySelectorAll('*') ?? [])].filter(shown);
    const text = all.filter((node) => own(node) && !node.closest('[aria-hidden="true"]') && parseFloat(getComputedStyle(node).fontSize) > 0);
    const small = text.filter((node) => parseFloat(getComputedStyle(node).fontSize) < 11.95).map((node) => (node.id || String(node.className).slice(0, 40) || node.tagName) + ':' + getComputedStyle(node).fontSize + ':' + node.textContent.trim().slice(0, 30));
    const edge = overlay ? overlay.getBoundingClientRect().left + overlay.clientLeft + overlay.clientWidth : 0;
    const wide = overlay ? all.filter((node) => overlay.contains(node) && node.getBoundingClientRect().right > edge + 1.5).slice(0, 6).map((node) => (node.id || String(node.className).slice(0, 40) || node.tagName) + ' ' + Math.round(node.getBoundingClientRect().right) + '>' + Math.round(edge)) : [];
    const title = document.getElementById('friends-place-title');
    return {
      route: window.MefiNav?.current?.() ?? null, open: overlay ? overlay.hidden === false : false, place: overlay?.dataset.place ?? null,
      title: title?.textContent ?? null, about: shown(document.querySelector('.friends-place-about')) ? document.querySelector('.friends-place-about').textContent : null,
      cards: [...(body?.children ?? [])].filter(shown).map((node) => String(node.className).split(' ')[0]),
      ownTitle: [...(body?.querySelectorAll('.rooms-title, .pc-sync-title, .friends-title, .project-hub-title') ?? [])].some(shown),
      list: document.getElementById('shell-pages')?.hidden === false ? [...document.querySelectorAll('#shell-pages-list > *')].map((node) => (node.tagName === 'H3' ? '# ' : '') + node.textContent.trim() + (node.getAttribute('aria-current') ? ' *' : '')) : null,
      listTitle: document.querySelector('#shell-pages .shell-pages-title')?.textContent ?? null,
      crumbs: [...document.querySelectorAll('.shell-trail .shell-crumb')].map((node) => node.textContent.trim()),
      sheet: box(overlay), nav: box(document.getElementById('shell-pages')),
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      // The window itself never scrolls under a page: the classic tab pages beneath are not laid out.
      docScroll: [document.scrollingElement.scrollHeight, innerHeight],
      sideways: overlay ? overlay.scrollWidth > overlay.clientWidth + 1 : false, small, wide,
      hub: document.getElementById('agent-hub')?.hidden === false,
    };`;
  const problems = (m, tag) => [
    ...(m.pageOverflow ? [`${tag}: the page overflows the window`] : []),
    ...(m.docScroll[0] > m.docScroll[1] + 1 ? [`${tag}: the whole window scrolls (${m.docScroll[0]} over ${m.docScroll[1]})`] : []),
    ...(m.sideways ? [`${tag}: the page scrolls sideways ${JSON.stringify(m.wide)}`] : []),
    ...m.small.map((line) => `${tag}: text under 12 px: ${line}`),
    ...m.wide.map((line) => `${tag}: past the page's right edge: ${line}`),
  ];
  const found = [];
  const go = (id, params) => run(`window.MefiNav.go(${JSON.stringify(id)}${params ? `, ${JSON.stringify(params)}` : ""});`);
  const placeIs = (place) => `document.getElementById('friends-overlay')?.hidden === false && document.getElementById('friends-overlay').dataset.place === ${JSON.stringify(place)} && window.MefiNav.current() === 'friends-page'`;

  // ---- v2 ------------------------------------------------------------------------------------------
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1", layout: "v2" } });
  await until("window.MefiNav && window.MefiCompanionHub && window.MefiShell && window.MefiShell.active() && !window.MefiBoot?.isActive?.()", "studio ready (v2)");
  await run("window.MefiVibe?.setMode?.('build', { go: false }); window.MefiNav.setRailPinned?.(false, { save: false });");
  // The Shop shows an item's controls only when the module that shows it is in the build (pets.js, effects.js, music.js's
  // packs): stand in for any that is not, so the Shop is measured with the controls it will have.
  await run(`const music = window.MefiMusic; music.applyPack ??= () => true; music.previewPack ??= () => {}; music.endPreview ??= () => {}; music.packInfo ??= () => null;
    window.MefiPets ??= { kinds: () => [{ id: 'dragon', item: 'studio:pet-dragon', name: 'Ember' }], skins: () => [{ id: 'theme', item: null, name: "Your theme's colours" }], state: () => ({ on: false, kind: 'dragon', skin: 'theme', name: 'Ember' }), set() {}, preview() {}, endPreview() {}, paintPreview() {} };
    window.MefiEffects ??= { list: () => [], current: () => 'none', use() {}, preview() {}, endPreview() {}, demo() {} };`);
  await resize(1920, 1080);
  // The rail's Friends opens the page on its first place.
  // (A press, not a pointer: the rail widens under a hovering pointer, so a release can land on the row beneath.)
  await run(`document.querySelector('#app-rail .app-rail-head[data-section="friends"]').click();`);
  await until(placeIs("lobby"), "the rail's Friends opens Friends › The Lobby");
  await sleep(500);
  const first = await run(measure);
  assert.equal(first.hub, false, "the companion's bubbles stay closed");
  assert.equal(first.listTitle, "Friends", "the list column is Friends'");
  assert.deepEqual(first.list, ["The Lobby *", "Rooms", "Your PCs", "Playground", "Project hub", "Events", "Shop"], "the list column holds The Lobby, the prototype's three places, the Project hub, Events and the Shop, The Lobby current");
  for (const [id, title, card] of PLACES) {
    await click(`#shell-pages-list [data-page="friends:${id}"]`);
    await until(placeIs(id), `${title} is the place`);
    await sleep(600);
    const m = await run(measure);
    m.id = id; report.places.push(m);
    assert.equal(m.title, title, `${id}: the page says where you are`);
    assert.ok(m.about && m.about.length > 20, `${id}: a line under the title says what the place is for`);
    assert.equal(m.cards[0], card, `${id}: its card shows (${JSON.stringify(m.cards)})`);
    assert.equal(m.ownTitle, false, `${id}: the card's own small title steps aside`);
    assert.deepEqual(m.list.filter((row) => row.endsWith(" *")), [`${title} *`], `${id}: its row is the current one`);
    assert.deepEqual(m.crumbs.slice(-2), ["Friends", title], `${id}: the breadcrumb says Friends / ${title}`);
    assert.ok(m.sheet.x >= m.nav.r - 1, `${id}: the page is beside the list ${JSON.stringify({ sheet: m.sheet, nav: m.nav })}`);
    await capture(`friends-${id}-1920x1080.png`);
    found.push(...problems(m, `${title} at 1920x1080`));
  }
  assert.ok(report.places.find((row) => row.id === "playground").cards.includes("friends-place-more"), "Playground keeps listening together and Discord");
  // Every way in that was the bubble's lands on the place.
  for (const [what, run2, place] of [
    ["Search's The Lobby", () => go("the-lobby"), "lobby"],
    ["Search's Rooms", () => go("rooms"), "rooms"],
    ["Search's Your PCs", () => go("your-pcs"), "pcs"],
    ["Search's Playground", () => go("playground"), "playground"],
    ["Friends with a target", () => go("friends", { target: "pcs" }), "pcs"],
    ["the companion's Friends bubble", () => run("window.MefiNav.closeAll(); window.MefiCompanionHub.open({ section: 'friends', target: 'playground' });"), "playground"],
  ]) {
    await run2();
    await until(placeIs(place), `${what} lands on ${place}`);
  }
  assert.equal(await run("return document.getElementById('agent-hub')?.hidden !== false;"), true, "the bubble did not stay open over the page");
  // A tab per place.
  report.tabs = await run("return (window.MefiTabs?.list?.() ?? []).filter((tab) => tab.route.id === 'friends-page').map((tab) => tab.title).sort();");
  assert.ok(report.tabs.length >= 1 && report.tabs.every((title) => ["The Lobby", "Rooms", "Your PCs", "Playground", "Project hub", "Events", "Shop"].includes(title)), `Friends tabs are named by their place: ${JSON.stringify(report.tabs)}`);
  report.steps.push("ways in land");
  // The Lobby, read once: the front page's parts, its invite code, and a person or room that opens Rooms there.
  await go("friends-page", { place: "lobby" });
  await until(placeIs("lobby") + " && document.querySelector('#friends-front .front-code')?.textContent === 'KQ7M-2PXD'", "The Lobby shows the front page and its invite code");
  report.lobby = await run(`const front = document.getElementById('friends-front');
    return { state: front.dataset.state, people: [...front.querySelectorAll('.front-who-text b')].map((node) => node.textContent), cols: [...front.querySelectorAll('.front-col-title')].map((node) => node.textContent),
      lead: front.querySelector('.front-lead-title')?.textContent, reads: window.friendsFixture.calls().filter((name) => name === 'hubRoom:front').length };`);
  assert.equal(report.lobby.state, "ready");
  assert.deepEqual(report.lobby.people, ["Maxwell", "Jabilee", "Rook"]);
  assert.deepEqual(report.lobby.cols, ["Building now", "Rooms open now", "New this week", "Your week"], "Maxwell shares what he builds");
  await click("#friends-front .front-who-go");
  await until(placeIs("rooms") + " && document.getElementById('rooms')", "a person in a room opens Rooms there");
  // Signed out, Friends is one card; Your PCs keeps working without it.
  await run("window.friendsFixture.signedIn(false);");
  await go("friends-page", { place: "lobby" });
  await until(placeIs("lobby") + " && document.getElementById('friends-gate-signin')?.getClientRects().length", "signed out, The Lobby is the sign-in card");
  await sleep(400);
  found.push(...problems(await run(measure), "the sign-in card at 1920x1080"));
  await capture("friends-signed-out-1920x1080.png");
  await go("friends-page", { place: "hub" });
  await until(placeIs("hub") + " && document.getElementById('friends-gate-signin')", "the Project hub shows the same card");
  await go("friends-page", { place: "pcs" });
  await until(placeIs("pcs") + " && document.getElementById('pc-sync-title') && !document.getElementById('friends-gate')", "Your PCs needs no sign-in");
  await run("window.friendsFixture.signedIn(true);");
  report.steps.push("the Lobby and the sign-in card");
  // An open room: one header, the chat filling the page above one composer, at three sizes.
  report.room = [];
  for (const [width, height, zoom] of [[1920, 1080, 1], [1100, 720, 1], [600, 560, 1.5]]) {
    await resize(width, height, zoom);
    await go("friends-page", { place: "rooms", room: "room_jam" });
    await until(placeIs("rooms") + " && document.getElementById('rooms')?.dataset.view === 'room' && document.querySelectorAll('#rooms .rooms-message').length === 5", `Friday jam opens at ${width}x${height}@${zoom}`);
    await sleep(500);
    const room = await run(`const box = (node) => node.getBoundingClientRect();
      const log = document.querySelector('#rooms .rooms-messages'), composer = document.querySelector('#rooms .rooms-composer'), overlay = document.getElementById('friends-overlay');
      return { log: Math.round(box(log).height), overlay: overlay.clientHeight, composerTop: Math.round(box(composer).top), composerBottom: Math.round(box(composer).bottom), inner: innerHeight,
        texts: [...document.querySelectorAll('#rooms .rooms-message-text')].map((node) => node.textContent), names: document.querySelectorAll('#rooms .rooms-room-name').length,
        status: document.getElementById('rooms-status').textContent, earlier: document.getElementById('rooms-earlier')?.hidden === false, send: Boolean(document.querySelector('#rooms .rooms-composer #rooms-send')) };`);
    room.size = `${width}x${height}@${zoom}`;
    report.room.push(room);
    await capture(`friends-room-${width}x${height}@${zoom}.png`);
    assert.equal(room.names, 1, `${room.size}: the room's name once, in its header`);
    assert.equal(room.status, "", `${room.size}: no second copy of the name in the status line`);
    assert.ok(room.composerTop >= 0 && room.composerBottom <= room.inner + 1, `${room.size}: the composer is on screen ${JSON.stringify(room)}`);
    assert.ok(room.log >= room.overlay * (zoom > 1 ? 0.25 : 0.45), `${room.size}: the chat takes most of the height ${JSON.stringify(room)}`);
    assert.ok(room.send && room.earlier, `${room.size}: Send sits in the composer and Load earlier is at the top of the log`);
    assert.ok(room.texts.includes("Me! @Mefi you in?") && room.texts.includes("Ask @someone too, they made the tileset."), `${room.size}: mentions read as names, an unknown one as @someone`);
    found.push(...problems(await run(measure), `the open room at ${room.size}`));
  }
  await resize(1920, 1080);
  await go("friends-page", { place: "lobby" });
  report.steps.push("an open room fills the page");
  // The layout contract's other sizes.
  for (const [width, height, zoom] of [[1440, 900, 1], [1100, 720, 1], [600, 560, 1.5]]) {
    await resize(width, height, zoom);
    for (const [id] of PLACES) {
      await go("friends-page", { place: id });
      await until(placeIs(id), `${id} at ${width}x${height}@${zoom}`);
      await sleep(400);
      const m = await run(measure);
      const wrong = problems(m, `${id} at ${width}x${height}@${zoom}`);
      found.push(...wrong);
      if (id === "pcs" || wrong.length) await capture(`friends-${id}-${width}x${height}@${zoom}.png`);
    }
  }
  // The Shop's other views at the two small sizes: Make a style (the editor beside its preview), and a member's pack's
  // Buy question with its tip picks.
  report.shop = [];
  for (const [width, height, zoom] of [[1100, 720, 1], [600, 560, 1.5]]) {
    await resize(width, height, zoom);
    await go("friends-page", { place: "shop" });
    await until(placeIs("shop") + " && document.getElementById('friends-shop')?.dataset.state === 'ready'", `the Shop at ${width}x${height}@${zoom}`);
    for (const [view, ready] of [["make", "document.getElementById('friends-shop-form')"], ["packs", "document.getElementById('friends-shop-buy-pack_nightmarket0001')"]]) {
      await run(`document.getElementById('friends-shop-view-${view}').click();`);
      await until(ready, `the Shop's ${view} view at ${width}x${height}@${zoom}`);
      if (view === "packs") {
        await run("document.getElementById('friends-shop-buy-pack_nightmarket0001').click();");
        await until("document.querySelector('#friends-shop .friends-shop-tips')", "the tip picks");
      }
      await sleep(400);
      const m = await run(measure);
      report.shop.push({ view, size: `${width}x${height}@${zoom}`, small: m.small, wide: m.wide, sideways: m.sideways });
      found.push(...problems(m, `the Shop's ${view} view at ${width}x${height}@${zoom}`));
      await capture(`friends-shop-${view}-${width}x${height}@${zoom}.png`);
    }
    await run("document.getElementById('friends-shop-view-studio').click();");
  }
  report.steps.push("the Shop's editor and tips fit");
  // The Shop's node styles: their own section, each card a little board its own style paints (renderer/node-styles.js)
  // in the theme's sky. A board is painted when much of it differs from its sky's corner.
  const boards = async (what) => {
    await go("friends-page", { place: "shop" });
    await until(placeIs("shop") + " && document.getElementById('friends-shop-group-nodestyle')", `the Shop's node styles (${what})`);
    await run("document.getElementById('friends-shop-group-nodestyle').scrollIntoView({ block: 'center' });");
    await sleep(700);
    const painted = await run(`return [...document.querySelectorAll('#friends-shop canvas[data-node-style]')].map((canvas) => {
      const { width, height } = canvas, data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 16) if (Math.abs(data[i] - data[0]) + Math.abs(data[i + 1] - data[1]) + Math.abs(data[i + 2] - data[2]) > 60) lit += 1;
      return { style: canvas.dataset.nodeStyle, width, height, lit };
    });`);
    assert.deepEqual(painted.map((board) => board.style), ["dragonscale", "constellation"], `${what}: a board per node style`);
    assert.ok(painted.every((board) => board.width >= 200 && board.lit > 40), `${what}: each board is painted: ${JSON.stringify(painted)}`);
    return painted;
  };
  await resize(1440, 900);
  report.boards = await boards("dark");
  await capture("friends-shop-nodestyles-1440x900.png");
  report.steps.push("the Shop's node styles paint their boards");
  // A light palette (the app's own custom colours): every place, and an open room, still fit with no text under 12 px.
  await resize(1440, 900);
  assert.equal(await run("return window.MefiMusic.applyCustomColors({ accent: '#8A5A00', background: '#F4F0E6', surface: '#FFFFFF', text: '#1D1B17' });"), true);
  await sleep(1800); // the colours glide in
  assert.equal(await run("return document.documentElement.dataset.studioThemeTone;"), "light");
  for (const [id] of PLACES) {
    await go("friends-page", { place: id });
    await until(placeIs(id), `${id} in a light palette`);
    await sleep(400);
    found.push(...problems(await run(measure), `${id} in a light palette`));
    await capture(`friends-light-${id}-1440x900.png`);
  }
  await go("friends-page", { place: "rooms", room: "room_jam" });
  await until(placeIs("rooms") + " && document.querySelectorAll('#rooms .rooms-message').length === 5", "an open room in a light palette");
  await sleep(400);
  found.push(...problems(await run(measure), "an open room in a light palette"));
  await capture("friends-light-room-1440x900.png");
  report.lightBoards = await boards("a light palette");
  await capture("friends-light-shop-nodestyles-1440x900.png");
  report.steps.push("a light palette");
  assert.deepEqual(found, [], "every Friends place fits at every size, with no text under 12 px");
  await resize(1920, 1080);
  report.complete = true;
  finish();
}).catch(finish);
