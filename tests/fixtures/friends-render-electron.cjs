"use strict";

// Friends in the 0.5 layout, in a real Chromium: a copied booklet launched with ?layout=v2 and a synthetic bridge.
// renderer/companion-hub.js files Friends into the prototype's three places (docs/prototype/mefi-studio-0.5-v5.html,
// friendsView, FRIEND_SUBS), and renderer/shell.js lists them in the list column. This opens each place from its row
// with a real pointer at 1920x1080 and measures: the list in the prototype's order, the current row, the breadcrumb
// (Friends / <place>), the page's title and the line under it, the one card that shows, nothing wider than the page,
// and no text under 12 px. The rail's Friends, Search's Rooms, Your PCs and Playground, and the companion's Friends
// bubble land on the page; a tab per place. Your PCs' Connect another PC walks through its states (signed out, waiting,
// a PC found, paired and folded to its button, which a real press opens again) above My PCs and the folded groups.
// The Shop is a page of its own (route "shop", renderer/friends-shop.js): its row opens it beside the list column
// with its row current, at 1440x900 and 1920x1080 in Studio and in Social, signed out as a showroom, in a light palette and
// at the small sizes, its cards evenly sized and filling the page (no narrow column with the rest of the page empty), its
// drop's banner made from the drop's own data, and a card's detail with its tip picks. Screenshots are kept when the test
// is given a capture folder (MEFI_FRIENDS_CAPTURE_DIR). No application main process or live state is loaded; network,
// permissions and child processes are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_FRIENDS_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Friends fixture directory is required");
const studio = path.resolve(__dirname, "..", "..");
const report = { errors: [], networkAttempts: [], processAttempts: [], permissionAttempts: [], places: [], shots: [], steps: [], complete: false };
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
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => { report.permissionAttempts.push(permission); callback(false); });
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
    tasksList: { ok: true, projectId, tasks: [{ id: "layout", projectId, title: "Lay out the list", status: "in_progress" }, { id: "save", projectId, title: "Save who brings what", status: "done" }, { id: "check", projectId, title: "Check it works", status: "todo" }] }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: {}, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, running: [{ taskId: "layout", projectId }], history: [] } },
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
    hubRooms: { ok: true, rooms: [{ id: "lobby", name: "The Lobby", kind: "hangout", policy: "request", listed: true, status: "active", you: "member", ownerId: null, memberCount: 3, maxMembers: 1000 }, { id: "room_jam", name: "Friday jam", kind: "hangout", policy: "request", listed: true, status: "active", you: "owner", ownerId: "123456789012345678", memberCount: 4, maxMembers: 25 }] },
    hubStatus: { ok: true, status: { configured: true, linked: true, state: "ready", user: { id: "123456789012345678", name: "Mefi" }, paused: false, rooms: [], lobby: false, joinCodes: true, front: true, events: true, shop: true } },
    pcSetupStatus: { ok: true, ready: true, account: "fixture-owner", tools: [{ id: "git", name: "Git", installed: true, version: "2.47.1" }, { id: "gh", name: "GitHub CLI", installed: true, version: "2.63.0" }], project: { root: "C:/Notes app", github: "fixture-owner/notes-app", hook: true }, steps: [], notes: [] },
    vaultStatus: { ok: true, linked: false, pcs: [], shelves: [] },
  };
  // Your PCs' My PCs as main's pcs:status hands it over (main.cjs pcsStatus): this PC, and the owner's laptop.
  const pcState = { v: 1, cpu: 18, freeMB: 9216, totalMB: 32768, battery: null, stage: "ok", stayOn: "working", slots: { running: 1, max: 3, canStart: true, hold: null }, accepting: true, projects: [] };
  const selfRow = { id: "pc-fixture", name: "DESKTOP-FIXTURE", kind: "desktop", self: true, mine: true, online: true, paired: true, relation: "mine", heard: { state: pcState, at: now }, why: null };
  const laptopRow = (paired) => ({ id: "pc-laptop", name: "LAPTOP-FIXTURE", kind: "laptop", mine: true, online: true, paired, relation: "mine", heard: paired ? { state: { ...pcState, battery: { level: 64, plugged: false } }, at: now } : null, why: paired ? null : "Not answering yet" });
  const pcsView = (rows, linked = true) => ({ ok: true, me: { id: "pc-fixture", name: "DESKTOP-FIXTURE" }, relay: linked ? { state: "ready", error: null, carries: true, linked: true } : { state: "off", error: null, carries: false, linked: false }, encryption: true,
    power: { reading: null, stage: "ok", continuedAt: null, lines: { low: 20, stop: 10 }, words: "No battery" }, stayOn: "working", awake: true, rows, asks: [],
    project: { id: projectId, name: "Notes app", github: true, share: true }, offers: [], movable: [], moved: [], waiting: [], held: 0, sent: [],
    handoffs: { at: now, error: null, list: [] }, lend: [], notes: [], limits: { movedPerProject: 2, parkedPerProject: 3 } });
  const PCS_STATES = [["signin", pcsView([selfRow], false), "signin", true], ["waiting", pcsView([selfRow]), "waiting", true], ["found", pcsView([selfRow, laptopRow(false)]), "found", true], ["paired", pcsView([selfRow, laptopRow(true)]), "waiting", false]];
  responses.pcsStatus = PCS_STATES[2][1];
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
  // The Shop as main's hub:shop hands it over (the relay's Studio catalog, members' packs, the rotation): scales for Ember
  // (Ember itself is free with every Studio and has a card of its own), effects, node styles and packs; a test drop of
  // existing items (the new drop's own items come at merge) with its banner colours, the next drop and the Featured shelf.
  const shopItem = (id, kind, name, price, blurb, extra = {}) => ({ id, kind, name, blurb, price, requires: null, maker: null, data: null, sales: 0, owned: false, status: "listed", createdAt: now, updatedAt: now, drop: null, available: true, leaves: null, ...extra });
  const dropLeaves = new Date(now + 24 * 86_400_000 + 3_600_000).toISOString();
  const inDrop = { drop: "2026-10", leaves: dropLeaves };
  const studioItems = [
    shopItem("studio:skin-frost", "skin", "Frost scales", 40, "Ember in icy blue."),
    shopItem("studio:skin-void", "skin", "Void scales", 60, "Ember in black with a violet glow.", inDrop),
    shopItem("studio:fx-dissolve", "effect", "Dissolve", 60, "Menus crumble into pixels when they close."),
    shopItem("studio:fx-embers", "effect", "Burn away", 90, "Menus burn away from the edges with glowing embers.", inDrop),
    shopItem("studio:style-dragonscale", "nodestyle", "Dragon scales", 80, "Nodes covered in shimmering dragon scales, with ember sparks along the wires."),
    shopItem("studio:style-constellation", "nodestyle", "Star chart", 80, "Nodes as bright stars joined by star-chart lines, with shooting stars.", inDrop),
    shopItem("studio:pack-synthwave", "pack", "Synthwave", 50, "Hot pink and violet on midnight blue.", { ...inDrop, data: { v: 1, palette: { accent: "#ff4fa3", accent2: "#8b5cff", background: "#0d0b1f", surface: "#17132e", text: "#f3ecff" }, nodeStyle: "halo", material: "atmosphere", font: "display" } }),
    shopItem("studio:pack-sakura", "pack", "Sakura (light)", 50, "Soft pink on warm white, a light look.", { data: { v: 1, palette: { accent: "#b8325f", accent2: "#8a6bd1", background: "#fbf6f4", surface: "#ffffff", text: "#2b1f24" }, nodeStyle: "minimal", material: "focus", font: "studio" } }),
  ];
  const rotation = {
    drops: {
      current: { id: "2026-10", name: "Haunted Hollow", blurb: "Pumpkins, lanterns and friendly spirits for October.", from: "2026-10-01T00:00:00Z", until: dropLeaves, colors: { accent: "#ff8a3d", accent2: "#9b6bff", background: "#140d1c" }, items: ["studio:skin-void", "studio:fx-embers", "studio:style-constellation", "studio:pack-synthwave"] },
      next: { id: "2026-11", name: "Frost Fair", blurb: "Ice lanterns.", from: dropLeaves, until: new Date(Date.parse(dropLeaves) + 30 * 86_400_000).toISOString(), colors: { accent: "#7fd3ff", accent2: "#c3a6ff", background: "#0b1622" } },
      last: null,
    },
    featured: ["studio:skin-frost", "studio:fx-dissolve", "studio:style-dragonscale", "studio:pack-sakura"], featuredUntil: new Date(now + 3 * 86_400_000 + 3_600_000).toISOString(),
  };
  const shopReplies = {
    studio: { ok: true, next: null, balance: 240, canEarn: true, hold: null, items: studioItems, ...rotation },
    // main's own copy of the catalog for the signed-out showroom (main.cjs hubShopCatalog).
    shopCatalog: { ok: true, local: true, view: "studio", next: null, items: studioItems, ...rotation },
    new: { ok: true, next: null, balance: 240, canEarn: true, hold: null, ...rotation, items: [
      shopItem("pack_nightmarket0001", "pack", "Night market with a rather long name", 30, "Neon on wet streets.", { maker: { id: "200000000000000001", name: "Maxwell" }, sales: 12, data: { v: 1, palette: { accent: "#ffb347", accent2: "#7f5af0", background: "#101014", surface: "#1b1b22", text: "#f4f1ea" }, nodeStyle: "glass", material: "studio", font: "serif" } }),
      shopItem("pack_paper000000001", "pack", "Paper", 0, "", { maker: { id: "200000000000000004", name: "Tess" }, sales: 3, data: { v: 1, palette: { accent: "#9b3d12", background: "#fbf6ee", surface: "#ffffff", text: "#2b2118" }, nodeStyle: "minimal", material: "focus", font: "serif" } }),
    ] },
    owned: { ok: true, next: null, balance: 240, canEarn: true, hold: null, items: [], ...rotation },
    mine: { ok: true, next: null, balance: 240, canEarn: true, hold: null, items: [], ...rotation },
    shopOwned: { ok: true, items: [] },
  };
  const names = await bridgeNames();
  const preload = path.join(root, "friends-preload.cjs");
  fs.writeFileSync(preload, `const {contextBridge}=require('electron');const responses=${JSON.stringify(responses)};const roomReplies=${JSON.stringify(roomReplies)};const eventReplies=${JSON.stringify(eventReplies)};const shopReplies=${JSON.stringify(shopReplies)};const names=${JSON.stringify(names)};const calls=[];
    const bridge={},listeners={};const push=(name,value)=>{for(const fn of listeners[name]||[])fn(JSON.parse(JSON.stringify(value)));};
    for(const name of names){
      if(/^on[A-Z]/.test(name))bridge[name]=(fn)=>{(listeners[name]??=[]).push(fn);return()=>{listeners[name]=listeners[name].filter(item=>item!==fn);};};
      else bridge[name]=async(...args)=>{calls.push(name);return name in responses?JSON.parse(JSON.stringify(responses[name])):{ok:true};};
    }
    bridge.hubRoom=async(method)=>{calls.push('hubRoom:'+method);return roomReplies[method]??{ok:true};};
    bridge.hubEvents=async(method)=>{calls.push('hubEvents:'+method);return eventReplies[method]??{ok:true};};
    bridge.hubShop=async(method,view)=>{calls.push('hubShop:'+method);return (method==='shop'?shopReplies[view]:shopReplies[method])??{ok:true,items:[]};};
    bridge.hubSubscribe=(id,on)=>{if(on)setTimeout(()=>{push('onHubEvent',{type:'presence',roomId:id,inStudio:['123456789012345678','200000000000000001','200000000000000002']});push('onHubEvent',{type:'listen',roomId:id,session:{title:'Night Bus (fixture)',label:'Night Bus (fixture)',provider:'youtube',url:'https://www.youtube.com/watch?v=fixture',playing:true,host:{id:'200000000000000001',name:'Maxwell'}}});},10);};
    contextBridge.exposeInMainWorld('mefiStudio',bridge);
    contextBridge.exposeInMainWorld('friendsFixture',{calls:()=>calls.slice(),push,rooms:(rooms)=>{responses.hubRooms.rooms=rooms;},desktop:(on)=>{responses.hubStatus.status.lobby=on===true;},signedIn:(on)=>{responses.hubStatus.status.linked=on===true;},pcsView:(view)=>{responses.pcsStatus=view;}});
    localStorage.setItem('mefiStudio.friendsRoomLayout','classic');
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
  // The Shop's own page: open, read (or the showroom) and painted.
  const shopIs = (state = "ready") => `document.getElementById('friends-shop-page')?.hidden === false && window.MefiNav.current() === 'shop' && document.getElementById('friends-shop')?.dataset.state === ${JSON.stringify(state)} && document.querySelector('#friends-shop-body .friends-shop-item')`;
  // The Shop's page measured as a page: beside the list column (or Social's rail), the sheet filling it up to its own
  // width, its cards in at least `columns` even columns, nothing past its right edge, no text under 12 px.
  const shopMeasure = `
    const page = document.getElementById('friends-shop-page'), sheet = page?.querySelector('.friends-shop-sheet');
    const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
    const shown = (node) => { if (!node || !node.getClientRects().length) return false; for (let n = node; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
    const all = [...(page?.querySelectorAll('*') ?? [])].filter(shown);
    const own = (node) => [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
    const small = all.filter((node) => own(node) && !node.closest('[aria-hidden="true"]') && parseFloat(getComputedStyle(node).fontSize) > 0 && parseFloat(getComputedStyle(node).fontSize) < 11.95).map((node) => (node.id || String(node.className).slice(0, 40)) + ':' + getComputedStyle(node).fontSize);
    const edge = page ? page.getBoundingClientRect().left + page.clientLeft + page.clientWidth : innerWidth;
    const wide = all.filter((node) => !node.closest('dialog') && node.getBoundingClientRect().right > edge + 1.5).slice(0, 6).map((node) => (node.id || String(node.className).slice(0, 40)) + ' ' + Math.round(node.getBoundingClientRect().right) + '>' + Math.round(edge));
    const grids = [...(page?.querySelectorAll('.friends-shop-grid') ?? [])].filter(shown).map((grid) => ({ columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, widths: [...grid.children].map((child) => Math.round(child.getBoundingClientRect().width)) }));
    const pages = document.getElementById('shell-pages');
    return {
      route: window.MefiNav?.current?.() ?? null, mode: window.MefiVibe?.mode?.() ?? null, state: document.getElementById('friends-shop')?.dataset.state ?? null,
      page: box(page), sheet: box(sheet), list: pages && pages.hidden === false ? box(pages) : null, grids,
      current: [...document.querySelectorAll('#shell-pages-list [aria-current]')].map((node) => node.textContent.trim()),
      crumbs: [...document.querySelectorAll('.shell-trail .shell-crumb')].map((node) => node.textContent.trim()),
      hero: Boolean(document.getElementById('friends-shop-hero')), detail: document.getElementById('friends-shop-detail')?.open === true,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, sideways: page ? page.scrollWidth > page.clientWidth + 1 : false, small, wide,
    };`;
  const shopProblems = (m, tag, columns = 1) => [
    ...(m.route !== "shop" ? [`${tag}: the route is ${m.route}, not shop`] : []),
    ...(m.pageOverflow ? [`${tag}: the page overflows the window`] : []),
    ...(m.sideways ? [`${tag}: the Shop's page scrolls sideways ${JSON.stringify(m.wide)}`] : []),
    ...m.small.map((line) => `${tag}: text under 12 px: ${line}`),
    ...m.wide.map((line) => `${tag}: past the page's right edge: ${line}`),
    ...(m.page && m.sheet && m.sheet.w < Math.min(m.page.w, 1320) - 4 ? [`${tag}: the Shop's column is ${m.sheet.w} px of a ${m.page.w} px page`] : []),
    ...m.grids.filter((grid) => grid.columns < columns).map((grid) => `${tag}: a grid of ${grid.columns} columns (wanted ${columns})`),
    ...m.grids.filter((grid) => grid.widths.length && Math.max(...grid.widths) - Math.min(...grid.widths) > 2).map((grid) => `${tag}: cards of uneven widths ${JSON.stringify(grid.widths)}`),
  ];
  // The Shop at one size and mode: its page, measured, and a screenshot.
  const shopShot = async (tag, name, columns = 1) => {
    await go("shop");
    await until(shopIs(), `the Shop (${tag})`);
    await sleep(600);
    const m = await run(shopMeasure);
    m.tag = tag;
    report.shopPages.push(m);
    found.push(...shopProblems(m, tag, columns));
    await capture(name);
    return m;
  };
  report.shopPages = [];

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
    // The Shop's row opens the Shop's own page (route "shop"), beside the same list with its row current.
    if (id === "shop") {
      await until(shopIs(), "the Shop's row opens the Shop's own page");
      await sleep(600);
      const m = await run(shopMeasure);
      m.id = id; report.places.push(m);
      assert.deepEqual(m.current, ["Shop"], "shop: its row is the current one");
      assert.deepEqual(m.crumbs.slice(-2), ["Friends", "Shop"], "shop: the breadcrumb says Friends / Shop");
      assert.ok(m.list && m.page.x >= m.list.r - 1, `shop: the page is beside the list ${JSON.stringify({ page: m.page, list: m.list })}`);
      assert.ok(m.hero, "shop: the month's drop as a banner");
      found.push(...shopProblems(m, "Shop at 1920x1080", 5));
      await capture("friends-shop-1920x1080.png");
      continue;
    }
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
  // The default room desktop and its narrow reveals, using only this fixture's
  // actual bridge records. The old layout above also pins the kill switch.
  await run("localStorage.removeItem('mefiStudio.friendsRoomLayout'); window.friendsFixture.desktop(true); window.MefiNav.closeAll();");
  await go("friends-page", { place: "lobby" });
  await until("document.querySelector('#rooms.rooms-desktop')?.dataset.view === 'room' && document.querySelector('.rooms-room-name')?.textContent === 'The Lobby'", "Friends opens the Lobby chat by default");
  assert.equal(await run("return Boolean(window.MefiRoomLayout.navigation()?.rows.some(row=>row.key==='friends:lobby' && row.label==='Lobby roundup'));"), true, "the roundup stays reachable from the room navigation");
  // An open room: one header, the chat filling the page above one composer, at three sizes.
  report.room = [];
  for (const [width, height, zoom] of [[1440, 900, 1], [1920, 1080, 1], [1100, 720, 1], [600, 560, 1.5]]) {
    await resize(width, height, zoom);
    await go("friends-page", { place: "rooms", room: "room_jam" });
    await until(placeIs("rooms") + " && document.getElementById('rooms')?.dataset.view === 'room' && document.querySelectorAll('#rooms .rooms-message').length === 5", `Friday jam opens at ${width}x${height}@${zoom}`);
    await sleep(500);
    await until("document.querySelector('.room-desktop-build')?.textContent.includes('1 of 3 tasks done') && document.querySelector('.room-desktop-listening')?.textContent.includes('Night Bus (fixture)') && document.querySelector('.room-desktop-jam')?.textContent.includes('Glow')", "the cards show the fixture's project, room player and jam");
    const room = await run(`const box = (node) => node.getBoundingClientRect();
      const log = document.querySelector('#rooms .rooms-messages'), composer = document.querySelector('#rooms .rooms-composer'), overlay = document.getElementById('friends-overlay');
      return { log: Math.round(box(log).height), overlay: overlay.clientHeight, composerTop: Math.round(box(composer).top), composerBottom: Math.round(box(composer).bottom), inner: innerHeight,
        texts: [...document.querySelectorAll('#rooms .rooms-message-text')].map((node) => node.textContent), names: document.querySelectorAll('#rooms .rooms-room-name').length,
        status: document.getElementById('rooms-status').textContent, earlier: document.getElementById('rooms-earlier')?.hidden === false, send: Boolean(document.querySelector('#rooms .rooms-composer #rooms-send')),
        avatarCount: document.querySelectorAll('.rooms-message > .room-desktop-avatar').length,
        right: getComputedStyle(document.querySelector('.room-desktop-context-body')).display,
        people: [...document.querySelectorAll('#shell-pages .room-desktop-person-copy strong')].map(node=>node.textContent),
        cards: [...document.querySelectorAll('.room-desktop-card-title')].map(node=>node.textContent) };`);
    room.size = `${width}x${height}@${zoom}`;
    report.room.push(room);
    await capture(`friends-room-${width}x${height}@${zoom}.png`);
    assert.equal(room.names, 1, `${room.size}: the room's name once, in its header`);
    assert.equal(room.avatarCount, 5, `${room.size}: each actual message has its author's initials`);
    assert.deepEqual(room.cards, ["Notes app", "Night Bus (fixture)", "Glow"]);
    assert.equal(room.status, "", `${room.size}: no second copy of the name in the status line`);
    assert.ok(room.composerTop >= 0 && room.composerBottom <= room.inner + 1, `${room.size}: the composer is on screen ${JSON.stringify(room)}`);
    assert.ok(room.log >= room.overlay * (zoom > 1 ? 0.25 : 0.45), `${room.size}: the chat takes most of the height ${JSON.stringify(room)}`);
    assert.ok(room.send && room.earlier, `${room.size}: Send sits in the composer and Load earlier is at the top of the log`);
    assert.ok(room.texts.includes("Me! @Mefi you in?") && room.texts.includes("Ask @someone too, they made the tileset."), `${room.size}: mentions read as names, an unknown one as @someone`);
    found.push(...problems(await run(measure), `the open room at ${room.size}`));
    if (room.right === "none") {
      await click('.room-desktop-context [data-room-control="context:toggle"]');
      await until("getComputedStyle(document.querySelector('.room-desktop-context-body')).display === 'grid'", "the narrow context panel reveals");
      await capture(`friends-room-context-${width}x${height}@${zoom}.png`);
      await run("document.querySelector('.room-desktop-context [data-room-control=\"context:toggle\"]').focus();");
      contents.sendInputEvent({ type: "keyDown", keyCode: "Escape" }); contents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until("document.querySelector('.room-desktop-context').dataset.open === 'false'", "Escape closes the context panel");
    }
  }
  // Social uses this same room controller, with its own visible room column.
  await run("window.MefiVibe.setMode('vibe', { go: false }); window.MefiNav.closeAll();");
  report.socialRooms = [];
  for (const [width, height, zoom] of [[1440, 900, 1], [600, 560, 1.5]]) {
    await resize(width, height, zoom);
    await go("friends-page", { place: "rooms", room: "room_jam" });
    await until("document.querySelector('#rooms.rooms-desktop')?.dataset.view === 'room' && document.querySelectorAll('#rooms .rooms-message').length === 5", "Social opens the actual room");
    await sleep(400);
    const facts = await run(`const visible = node => node?.getClientRects().length > 0 && getComputedStyle(node).display !== 'none';
      const composer = document.querySelector('#rooms .rooms-composer').getBoundingClientRect();
      return { mode: window.MefiVibe.mode(), inline: visible(document.querySelector('.room-desktop-nav')), docked: visible(document.getElementById('shell-pages')),
        collapsed: getComputedStyle(document.querySelector('.room-desktop-nav-body')).display === 'none', composerBottom: composer.bottom, height: innerHeight };`);
    report.socialRooms.push({ size: `${width}x${height}@${zoom}`, ...facts });
    assert.equal(facts.mode, "vibe", "room entry keeps Social mode");
    assert.ok(facts.inline && !facts.docked, "Social shows one room navigation column");
    assert.ok(facts.composerBottom <= facts.height + 1, "Social's composer is reachable");
    found.push(...problems(await run(measure), `Social room ${width}x${height}@${zoom}`));
    await capture(`friends-social-room-${width}x${height}@${zoom}.png`);
    if (facts.collapsed) {
      await click('[data-room-control="nav:toggle"]');
      await until("document.querySelector('.room-desktop-nav').dataset.open === 'true'", "Social's room navigation opens");
      await capture(`friends-social-navigation-${width}x${height}@${zoom}.png`);
      await run("document.querySelector('[data-room-control=\"nav:toggle\"]').focus();");
      contents.sendInputEvent({ type: "keyDown", keyCode: "Escape" }); contents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until("document.querySelector('.room-desktop-nav').dataset.open === 'false' && document.activeElement?.dataset.roomControl === 'nav:toggle'", "Escape closes navigation and retains focus");
    }
  }
  await resize(1440, 900);
  await run(`window.roomDraft = document.querySelector('#rooms textarea'); window.roomDraft.value = 'Keep this draft through reconnect'; window.roomDraft.dispatchEvent(new Event('input',{bubbles:true}));
    window.roomBuild = document.querySelector('.room-desktop-build');
    for(let i=0;i<30;i++) window.friendsFixture.push('onAssistantStatus',{projectId:'friends-project',running:[{taskId:'layout',projectId:'friends-project'}]});`);
  await sleep(150);
  assert.equal(await run("return window.roomBuild === document.querySelector('.room-desktop-build');"), true, "unchanged worker frames keep the existing card");
  await run("window.friendsFixture.push('onHubEvent',{type:'status',status:{state:'off'}});");
  await until("document.querySelector('#rooms textarea')?.disabled && document.getElementById('rooms-status').textContent.includes('draft')", "offline room keeps its draft and disables sending");
  assert.equal(await run("return document.querySelector('#rooms textarea') === window.roomDraft && window.roomDraft.value === 'Keep this draft through reconnect';"), true);
  await capture("friends-social-offline-draft.png");
  await run("window.friendsFixture.push('onHubEvent',{type:'status',status:{state:'ready',front:true,events:true}}); window.friendsFixture.push('onHubEvent',{type:'listen',roomId:'room_jam',session:null});");
  await until("!document.querySelector('#rooms textarea')?.disabled && document.querySelector('.room-desktop-listening').textContent.includes('Nothing playing in this room')", "reconnect preserves an explicitly empty player state");
  assert.equal(await run("return document.querySelector('#rooms textarea') === window.roomDraft && window.roomDraft.value === 'Keep this draft through reconnect';"), true);
  await run(`for(let i=0;i<150;i++) window.friendsFixture.push('onHubEvent',{type:'message',roomId:'room_jam',message:{id:String(600000000000000000n+BigInt(i)),author:{id:'200000000000000001',name:'Maxwell'},text:'Long chat fixture '+i,createdAt:Date.now(),mentions:[],attachments:[]}});`);
  assert.equal(await run("return document.querySelectorAll('#rooms .rooms-message').length;"), 155);
  assert.equal(await run("const log=document.querySelector('.rooms-messages'); return log.scrollHeight>log.clientHeight;"), true, "long chat scrolls within its log");
  await capture("friends-social-long-chat.png");
  await run(`window.originalRooms = (await window.mefiStudio.hubRooms()).rooms;
    window.friendsFixture.rooms([...window.originalRooms,...Array.from({length:40},(_,i)=>({id:'room_stress_'+i,name:'Long room fixture '+i,kind:'hangout',you:'member',status:'active',memberCount:2,maxMembers:25}))]); window.MefiNav.closeAll();`);
  await resize(600, 560, 1.5);
  await go("friends-page", { place: "rooms", room: "room_jam" });
  await until("document.querySelector('[data-room-control=\"room:room_stress_39\"]')", "long room list is retained");
  await click('[data-room-control="nav:toggle"]');
  await run("document.querySelector('[data-room-control=\"room:room_stress_38\"]').focus();");
  contents.sendInputEvent({ type: "keyDown", keyCode: "Tab" }); contents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
  await until("document.activeElement?.dataset.roomControl === 'room:room_stress_39'", "Tab reaches the last room");
  assert.equal(await run(`const nav=document.querySelector('.room-desktop-nav-body'), row=document.activeElement, box=row.getBoundingClientRect(), clip=nav.getBoundingClientRect();
    return nav.scrollHeight>nav.clientHeight && box.top>=clip.top-1 && box.bottom<=clip.bottom+1;`), true, "keyboard focus reveals a long list item inside the scrolling navigation");
  await capture("friends-social-long-room-list.png");
  await run("window.friendsFixture.rooms(window.originalRooms);");
  assert.deepEqual(report.permissionAttempts, [], "room entry, panel controls and empty player request no device permission");
  report.steps.push("Social room, narrow navigation, offline draft, empty player and long chat");
  await run("window.MefiVibe.setMode('build', { go: false }); window.MefiNav.setRailPinned(false, { save: false }); localStorage.setItem('mefiStudio.friendsRoomLayout','classic'); window.friendsFixture.desktop(false); window.MefiNav.closeAll();");
  await resize(1920, 1080);
  await go("friends-page", { place: "lobby" });
  report.steps.push("an open room fills the page");
  // The layout contract's other sizes.
  for (const [width, height, zoom] of [[1440, 900, 1], [1100, 720, 1], [600, 560, 1.5]]) {
    await resize(width, height, zoom);
    for (const [id] of PLACES) {
      // The Shop's own page: at 1440 its column fills the page beside the list in four even columns.
      if (id === "shop") { await shopShot(`the Shop at ${width}x${height}@${zoom}`, `friends-shop-${width}x${height}@${zoom}.png`, width === 1440 ? 4 : 1); continue; }
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
  // detail with the Buy question and its tip picks.
  report.shop = [];
  for (const [width, height, zoom] of [[1100, 720, 1], [600, 560, 1.5]]) {
    await resize(width, height, zoom);
    await go("shop");
    await until(shopIs(), `the Shop at ${width}x${height}@${zoom}`);
    for (const [view, ready] of [["make", "document.getElementById('friends-shop-form')"], ["packs", "document.getElementById('friends-shop-open-packs-pack_nightmarket0001')"]]) {
      await run(`document.getElementById('friends-shop-view-${view}').click();`);
      await until(ready, `the Shop's ${view} view at ${width}x${height}@${zoom}`);
      if (view === "packs") {
        await run("document.getElementById('friends-shop-open-packs-pack_nightmarket0001').click();");
        await until("document.getElementById('friends-shop-detail')?.open && document.getElementById('friends-shop-buy-pack_nightmarket0001')", "the pack's detail");
        await run("document.getElementById('friends-shop-buy-pack_nightmarket0001').click();");
        await until("document.querySelector('#friends-shop-detail .friends-shop-tips')", "the tip picks");
      }
      await sleep(400);
      const m = await run(shopMeasure);
      const inDialog = await run(`const d = document.getElementById('friends-shop-detail'); if (!d?.open) return null; const r = d.getBoundingClientRect(); return { x: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: innerWidth, h: innerHeight, scroll: d.scrollHeight > d.clientHeight + 1 };`);
      report.shop.push({ view, size: `${width}x${height}@${zoom}`, small: m.small, wide: m.wide, sideways: m.sideways, dialog: inDialog });
      found.push(...shopProblems(m, `the Shop's ${view} view at ${width}x${height}@${zoom}`));
      if (inDialog && (inDialog.x < 0 || inDialog.r > inDialog.w + 1 || inDialog.t < 0 || inDialog.b > inDialog.h + 1)) found.push(`the Shop's detail at ${width}x${height}@${zoom} is off screen ${JSON.stringify(inDialog)}`);
      await capture(`friends-shop-${view}-${width}x${height}@${zoom}.png`);
      if (inDialog) await run("document.getElementById('friends-shop-detail-close').click();");
    }
    await run("document.getElementById('friends-shop-view-studio').click();");
  }
  report.steps.push("the Shop's editor and tips fit");
  // The Shop in Social at the owner's two sizes: still Social, the page beside Social's rail, Friends' places as a row.
  await run("window.MefiVibe?.setMode?.('vibe', { go: false });");
  for (const [width, height] of [[1440, 900], [1920, 1080]]) {
    await resize(width, height);
    const m = await shopShot(`the Shop in Social at ${width}x${height}`, `friends-shop-social-${width}x${height}.png`, width === 1920 ? 5 : 4);
    assert.equal(m.mode, "vibe", `${width}x${height}: opening the Shop keeps Social`);
    assert.equal(await run("return document.querySelectorAll('#friends-shop-page .shell-place-bar:not([hidden]) .shell-place-chip').length;"), 7, `${width}x${height}: Friends' places as a row on the page`);
    assert.equal(await run("return [...document.querySelectorAll('#friends-shop-page .shell-place-bar .studio-select')].filter((node) => node.getClientRects().length).length;"), 0, `${width}x${height}: the row's picker stays folded while the chips fit`);
  }
  await run("window.MefiVibe?.setMode?.('build', { go: false }); window.MefiNav.setRailPinned?.(false, { save: false });");
  // Studio at 1440: the column fills the page beside the list (an earlier capture had about 500 px with the right half empty).
  await resize(1440, 900);
  const studio1440 = await shopShot("the Shop in Studio at 1440x900", "friends-shop-studio-1440x900.png", 4);
  assert.ok(studio1440.list && studio1440.sheet.w >= studio1440.page.w - 4, `1440: the Shop's column fills its page ${JSON.stringify({ page: studio1440.page, sheet: studio1440.sheet })}`);
  // Signed out, the same page is a showroom: Studio's items from this PC's copy, Try, and Sign in to get it.
  await run("window.friendsFixture.signedIn(false);");
  await go("friends-page", { place: "lobby" });
  await go("shop");
  await until(shopIs("not-linked") + " && document.getElementById('friends-shop-notice')", "the signed-out showroom");
  await sleep(600);
  const showroom = await run(shopMeasure);
  report.shopPages.push({ ...showroom, tag: "showroom" });
  found.push(...shopProblems(showroom, "the signed-out showroom at 1440x900", 4));
  assert.ok(showroom.hero && (await run("return Boolean(document.querySelector('#friends-shop-body > #friends-gate'));")), "the showroom has the drop's banner, and Friends' sign-in card at its foot");
  await capture("friends-shop-showroom-1440x900.png");
  await run("document.getElementById('friends-shop-open-home-studio-skin-frost').click();");
  await until("document.getElementById('friends-shop-detail')?.open && document.getElementById('friends-shop-way-studio-skin-frost')", "a showroom detail with Sign in to get it");
  await sleep(500);
  await capture("friends-shop-showroom-detail-1440x900.png");
  await run("document.getElementById('friends-shop-detail-close').click(); window.friendsFixture.signedIn(true);");
  await go("friends-page", { place: "lobby" });
  report.steps.push("the Shop's own page in Studio and Social, and the showroom");
  // The Shop's node styles: their own section, each card a little board its own style paints (renderer/node-styles.js)
  // in the theme's sky. A board is painted when much of it differs from its sky's corner.
  const boards = async (what) => {
    await go("shop");
    await until(shopIs() + " && document.getElementById('friends-shop-group-home-nodestyles')", `the Shop's node styles (${what})`);
    await run("document.getElementById('friends-shop-group-home-nodestyles').scrollIntoView({ block: 'center' });");
    await sleep(700);
    const painted = await run(`return [...document.querySelectorAll('#friends-shop-group-home-nodestyles canvas[data-node-style]')].map((canvas) => {
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
  // Your PCs: Connect another PC through its states at the smallest window and a large one, My PCs under it, the folded
  // groups in order, and Share projects last. The card is built again for each state (the place is left and opened again).
  const pcsFacts = `
    const shown = (node) => Boolean(node) && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const reach = (node) => { if (!shown(node)) return false; node.scrollIntoView({ block: 'nearest', behavior: 'instant' }); const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return Boolean(hit) && (hit === node || node.contains(hit)); };
    const walk = document.getElementById('pc-walk'), card = document.querySelector('#friends-place-body .pc-sync');
    const groups = [...card.querySelectorAll(':scope > .pc-group, :scope > .pc-share-group > .pc-group')].map((node) => {
      const head = node.matches('details') ? node.querySelector(':scope > summary') : node.querySelector('.pc-group-toggle');
      return { name: head.firstChild.textContent.trim(), open: node.matches('details') ? node.open : head.getAttribute('aria-expanded') === 'true' };
    });
    const facts = {
      stage: walk?.dataset.stage, open: walk?.open, head: walk?.querySelector(':scope > summary')?.textContent,
      steps: [...(walk?.querySelectorAll('.pc-walk-what') ?? [])].map((node) => node.textContent), marks: [...(walk?.querySelectorAll('.pc-walk-step') ?? [])].map((node) => node.dataset.state),
      signed: document.getElementById('pc-walk-signed')?.textContent, live: document.getElementById('pc-walk-status')?.textContent, signIn: shown(document.getElementById('pc-walk-signin')),
      parts: [...card.children].filter(shown).map((node) => node.id || String(node.className).split(' ')[0]), groups, share: document.getElementById('pc-share-group-title')?.textContent,
      rows: document.querySelectorAll('#pc-fleet-rows > li').length, syncLine: shown(document.getElementById('pc-sync-head')),
      pair: reach(walk?.querySelector('#pc-walk-status button')), headReach: reach(walk?.querySelector(':scope > summary')), syncRun: reach(document.getElementById('pc-sync-run')),
    };
    document.getElementById('friends-overlay').scrollTop = 0;
    return facts;`;
  const GROUPS = ["Keep this PC in step with GitHub", "Power and battery", "Lend this PC to a friend", "Set up this PC", "Paired workers", "Reach this PC from Discord", "Share between my PCs", "Share with friends"];
  report.walk = [];
  for (const [width, height, zoom] of [[600, 560, 1.5], [1920, 1080, 1]]) {
    await resize(width, height, zoom);
    for (const [name, view, stage, open] of PCS_STATES) {
      await run(`window.friendsFixture.pcsView(${JSON.stringify(view)});`);
      await go("friends-page", { place: "rooms" });
      await until(placeIs("rooms"), `Rooms before Your PCs (${name})`);
      await go("friends-page", { place: "pcs" });
      const ready = name === "waiting" ? " && document.getElementById('pc-walk-signed')?.textContent.includes('as Mefi')" : "";
      await until(placeIs("pcs") + ` && document.getElementById('pc-walk')?.dataset.stage === ${JSON.stringify(stage)} && document.querySelector('#friends-overlay .pc-sync')?.dataset.state === 'pending'${ready}`, `Your PCs, ${name}, at ${width}x${height}@${zoom}`);
      await sleep(400);
      const size = `${width}x${height}@${zoom}`;
      found.push(...problems(await run(measure), `Your PCs (${name}) at ${size}`));
      const facts = await run(pcsFacts);
      facts.state = name; facts.size = size;
      if (!facts.syncRun) { facts.hit = await run(`const n=document.getElementById('pc-sync-run'), r=n.getBoundingClientRect(); return {box:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.outerHTML?.slice(0,600)};`); await capture(`friends-pcs-hit-${name}-${size}.png`); }
      report.walk.push(facts);
      assert.equal(facts.open, open, `${name} at ${size}: the steps are ${open ? "out" : "folded"} ${JSON.stringify(facts)}`);
      assert.deepEqual(facts.steps, ["Open Studio on your other PC.", "Sign in to Friends with the same Discord account on both PCs.", "When your other PC shows up, press Pair and check that both screens show the same six numbers."]);
      assert.deepEqual(facts.parts, ["pc-fleet", "pc-sync-group", "pc-fleet-power", "pc-fleet-lending", "pc-setup", "pc-paired-workers", "pc-remote", "pc-share-group"], `${name} at ${size}: the card's order`);
      assert.deepEqual(facts.groups, GROUPS.map((group) => ({ name: group, open: false })), `${name} at ${size}: every group folded, in order`);
      assert.equal(facts.share, "Share projects");
      assert.ok(facts.syncLine && facts.syncRun, `${name} at ${size}: GitHub is behind, so its line and Sync this PC are out and reachable`);
      if (name === "signin") assert.ok(facts.signIn && facts.signed === "This PC is not signed in yet." && facts.live === "Your other PC shows up here once both PCs are signed in.", JSON.stringify(facts));
      if (name === "waiting") assert.ok(facts.signed === "✓ This PC is signed in as Mefi." && facts.live === "Waiting for your other PC to sign in…" && !facts.signIn, JSON.stringify(facts));
      if (name === "found") assert.ok(facts.live === "Found LAPTOP-FIXTURE:Pair" && facts.pair && facts.rows === 2, `found at ${size}: a pointer reaches Pair ${JSON.stringify(facts)}`);
      if (name === "paired") assert.ok(facts.head === "Connect another PC" && facts.headReach, `paired at ${size}: one Connect another PC button ${JSON.stringify(facts)}`);
      await capture(`friends-pcs-${name}-${size}.png`);
    }
  }
  report.steps.push("Connect another PC");
  // A light palette (the app's own custom colours): every place, and an open room, still fit with no text under 12 px.
  await resize(1440, 900);
  assert.equal(await run("return window.MefiMusic.applyCustomColors({ accent: '#8A5A00', background: '#F4F0E6', surface: '#FFFFFF', text: '#1D1B17' });"), true);
  await sleep(1800); // the colours glide in
  assert.equal(await run("return document.documentElement.dataset.studioThemeTone;"), "light");
  for (const [id] of PLACES) {
    if (id === "shop") { await shopShot("the Shop in a light palette", "friends-light-shop-1440x900.png", 4); continue; }
    await go("friends-page", { place: id });
    await until(placeIs(id), `${id} in a light palette`);
    await sleep(400);
    found.push(...problems(await run(measure), `${id} in a light palette`));
    await capture(`friends-light-${id}-1440x900.png`);
  }
  await run("localStorage.removeItem('mefiStudio.friendsRoomLayout'); window.friendsFixture.desktop(true); window.MefiNav.closeAll();");
  await go("friends-page", { place: "rooms", room: "room_jam" });
  await until(placeIs("rooms") + " && document.querySelectorAll('#rooms .rooms-message').length === 5", "an open room in a light palette");
  await sleep(400);
  found.push(...problems(await run(measure), "an open room in a light palette"));
  await capture("friends-light-room-1440x900.png");
  report.lightBoards = await boards("a light palette");
  await capture("friends-light-shop-nodestyles-1440x900.png");
  report.steps.push("a light palette");
  // Folded once a PC is paired, Connect another PC opens again with a real press, and says who is paired.
  await run(`window.friendsFixture.pcsView(${JSON.stringify(PCS_STATES[3][1])});`);
  await go("friends-page", { place: "rooms" });
  await until(placeIs("rooms"), "Rooms before Your PCs, paired");
  await go("friends-page", { place: "pcs" });
  await until(placeIs("pcs") + " && document.getElementById('pc-walk')?.open === false", "Your PCs, paired: the steps folded");
  await click("#pc-walk > summary");
  await until("document.getElementById('pc-walk')?.open === true && document.getElementById('pc-walk-status')?.textContent === 'Paired with LAPTOP-FIXTURE. Waiting for another PC to sign in…'", "a press opens Connect another PC again");
  await sleep(300);
  found.push(...problems(await run(measure), "Connect another PC opened again in a light palette"));
  await capture("friends-light-pcs-reopened-1440x900.png");
  report.steps.push("Connect another PC opens again");
  assert.deepEqual(found, [], "every Friends place fits at every size, with no text under 12 px");
  await resize(1920, 1080);
  report.complete = true;
  finish();
}).catch(finish);
