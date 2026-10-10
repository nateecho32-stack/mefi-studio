"use strict";

// Two Studios meet through the relay, end to end, in real Chromium windows.
//
// One Electron process plays two PCs. Each window is a copied booklet in the
// 0.5 layout with its own user data (a separate session partition), and its
// bridge reaches its own copy of main.cjs's real "Rooms hub" block (loaded in
// a vm exactly as tests/hub_host.test.mjs does), whose hub client talks to the
// real relay (relay/node/adapter.mjs: the Worker and the Hub object, SQLite,
// scripted Discord). The two members then do what the owner will do between
// two PCs: meet in The Lobby, make a room, invite by code, join with it, chat
// both ways, close Studio on one side while the other keeps talking and catch
// up when it comes back (the relay keeps no chat; the missed messages come
// from the other Studio's copy), listen together, share a project and play it
// for the credits. Screenshots go to the capture folder when the test is given
// one (MEFI_FRIENDS_CAPTURE_DIR). Network, permissions and child processes
// are blocked; nothing leaves the process.
const { app, BrowserWindow, session, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { fileURLToPath, pathToFileURL } = require("node:url");
const root = process.env.MEFI_FRIENDS_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Friends fixture directory is required");
const studio = path.resolve(__dirname, "..", "..");
const report = { errors: [], networkAttempts: [], processAttempts: [], shots: [], steps: [], complete: false };
app.setName("Friends Two Fixture");
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

const DAY = 86_400_000;
const ONE = { id: "200000000000000101", username: "mefi", global_name: "Mefi" };
const TWO = { id: "200000000000000102", username: "nova", global_name: "Nova" };

app.whenReady().then(async () => {
  let skew = 0; // the relay's clock, moved on when a play needs its two minutes
  const clock = () => Date.now() + skew;
  const { createNodeRelay } = await import(pathToFileURL(path.join(studio, "relay", "node", "adapter.mjs")).href);
  const relay = createNodeRelay({ now: clock, discord: { "tok-one": { user: ONE }, "tok-two": { user: TWO } } });
  const hubClientModule = require(path.join(studio, "scripts", "hub-client.cjs"));
  const roomHistoryModule = require(path.join(studio, "scripts", "room-history.cjs"));
  const main = fs.readFileSync(path.join(studio, "main.cjs"), "utf8").replace(/\r\n/g, "\n");
  const from = main.indexOf("// ---- Rooms hub: listen together and now playing");
  const to = main.indexOf("// ---- end of the rooms hub", from);
  assert.ok(from > 0 && to > from, "main.cjs has a Rooms hub block");
  const block = main.slice(from, to);

  // One PC: main's Rooms hub block with its own user data, signed in as `token`.
  function studioHost(name, token, send) {
    const userData = path.join(root, `${name}-data`);
    fs.mkdirSync(userData, { recursive: true });
    const opened = [], timers = [];
    let settings = {};
    const context = vm.createContext({
      Date, Number, Object, Array, Promise, JSON, Map, Set, String, Boolean, Math, URL, Buffer, Error, TypeError, console,
      process: { env: { MEFI_STUDIO_HUB_URL: "http://127.0.0.1:8787" } },
      community: {}, discordOAuth: {}, COMMUNITY_ACCESS_MARGIN_MS: 60_000,
      communityTokens: { accessToken: token, expiresAt: Date.now() + 365 * DAY },
      communityClientId: () => "100000000000000001",
      communityRead: async () => ({ state: { link: { userId: name } } }),
      checkCommunity: async () => ({ ok: true }), publishCommunity: async () => ({}),
      readFileSync: () => { throw new Error("no settings file in this fixture"); }, SETTINGS_PATH: path.join(userData, "settings.json"),
      readSettings: async () => settings, updateSettings: async (mutate) => { mutate(settings); },
      send, logLine: () => {}, require,
      optionalHelper: (file) => (file.includes("hub-client") ? { ...hubClientModule, createHubClient: (options) => hubClientModule.createHubClient({ ...options, fetch: relay.fetch, WebSocket: relay.WebSocket }) } : file.includes("room-history") ? roomHistoryModule : null),
      app: { getPath: () => userData },
      safeStorage: { isEncryptionAvailable: () => false },
      authStore: { atomicWriteJson: async () => {} },
      shell: { openExternal: async (url) => { opened.push(url); } },
      agentsSnapshot: async () => ({ project: "Two PC test", working: [{ title: "x" }], done: [] }),
      // main's own timers: the play's two-minute finish is fired by hand once the relay's clock has moved on.
      setTimeout: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; }, clearTimeout: () => {},
      setInterval: () => ({ unref() {} }), clearInterval: () => {},
    });
    vm.runInContext(`${block}\nthis.api = { hubStatus, hubConnect, hubDisconnect, hubRooms, hubSubscribe, hubListen, hubNowPlaying, hubRoom, hubProjects };`, context);
    return { api: context.api, opened, timers };
  }

  // The synthetic part of each bridge: what the rest of Studio asks at startup.
  const now = Date.now(), projectId = "two-project";
  const responses = {
    projectsList: { ok: true, activeId: projectId, projects: [{ id: projectId, name: "Two PC test", path: root }] },
    tasksList: { ok: true, projectId, tasks: [] }, ideasList: { ok: true, ideas: [] }, planningList: { ok: true, projectId, plans: [] },
    prefsGet: { ok: true, prefs: { commandHome: false, autoReference: false } },
    assistantState: { ok: true, state: { projectId, status: "running", agents: [], messages: [], prefs: {}, work: [], questions: [] } },
    assistantStatus: { ok: true, status: { projectId, enabled: true, execute: true, running: [], history: [] } },
    backlogStatus: { ok: true, projectId, paused: false, counts: {}, taskStates: [], next: [] },
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] }, speedMeasurements: { ok: true, measurements: {} },
    readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
    getApiKey: { saved: false }, getAiRouting: { provider: "zen", models: {}, providerModels: {} }, cliStatus: [], launchStudio: { ok: true }, firstRunStatus: { ok: true, firstRun: null },
    companionState: { ok: true, projectId, projectName: "Two PC test", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: false, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] },
    companionWelcome: { ok: true }, companionSeen: { ok: true }, companionBond: { ok: true, changed: false, bond: "" },
    autonomyState: { ok: true, projectId, level: "auto", elevated: {}, categories: [], decisions: [] },
    worktreesList: { ok: true, repo: false, projectId, enabled: { on: false, forced: false } }, skillsList: { ok: true, skills: [], roots: [] },
    syncStatus: { ok: true, checkedAt: now, headline: "This PC matches GitHub main.", lines: [], pending: [], state: { repo: true, remote: true, device: "PC", behind: 0 } },
    pcSetupStatus: { ok: true, ready: true, account: "fixture-owner", tools: [], project: { root: "C:/Two", github: "fixture-owner/two", hook: true }, steps: [], notes: [] },
    vaultStatus: { ok: true, linked: false, pcs: [], shelves: [] },
  };
  const names = [...new Set([...fs.readFileSync(path.join(studio, "preload.cjs"), "utf8").matchAll(/^  ([A-Za-z][A-Za-z0-9_]*):/gm)].map((match) => match[1]))];
  const HUB = ["hubStatus", "hubConnect", "hubDisconnect", "hubRooms", "hubSubscribe", "hubListen", "hubNowPlaying", "hubRoom", "hubProjects"];

  async function openPc(name, token) {
    const part = session.fromPartition(`persist:friends-two-${name}`);
    part.webRequest.onBeforeRequest((details, callback) => {
      let allowed = /^(data:|blob:|devtools:)/.test(details.url);
      if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
      if (!allowed) report.networkAttempts.push(details.url);
      callback({ cancel: !allowed });
    });
    part.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    part.setPermissionCheckHandler(() => false);
    const preload = path.join(root, `${name}-preload.cjs`);
    fs.writeFileSync(preload, `const {contextBridge, ipcRenderer}=require('electron');const responses=${JSON.stringify(responses)};const names=${JSON.stringify(names)};const hub=${JSON.stringify(HUB)};
      const bridge={};
      for(const name of names){
        if(/^on[A-Z]/.test(name))bridge[name]=()=>()=>{};
        else bridge[name]=async()=>name in responses?JSON.parse(JSON.stringify(responses[name])):{ok:true};
      }
      const call=(method,args)=>ipcRenderer.invoke('fx:${name}',{method,args});
      for(const name of hub)bridge[name]=(...args)=>call(name,name==='hubRoom'||name==='hubProjects'?[args[0],args.slice(1)]:args);
      bridge.hubFriends=async()=>({ok:true,hub:{configured:true,linked:true,state:'ready',companions:false,rooms:[]},sharing:{everyone:'play',rules:[],hold:null},levels:[],never:[],preview:{level:'play',why:'Everyone',card:null,summary:''},friends:[],sent:[]});
      bridge.onHubEvent=(fn)=>{ipcRenderer.on('hub:event',(_e,event)=>fn(event));return()=>{};};
      contextBridge.exposeInMainWorld('mefiStudio',bridge);
      localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));localStorage.setItem('mefiStudio.whatsNew.seen','vibe-build-1');localStorage.setItem('mefiStudio.setupHelper.seen','setup-helper-1');
    `);
    const window = new BrowserWindow({ show: false, width: 1440, height: 900, useContentSize: true, frame: false, webPreferences: { preload, partition: `persist:friends-two-${name}`, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
    const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(`${name}: ${String(typeof detail === "object" ? detail.message : oldMessage)}`); });
    const host = studioHost(name, token, (channel, payload) => { if (!window.isDestroyed()) contents.send(channel, payload); });
    // As main's ipcMain handlers answer: hub:status wraps the status, the rest answer as the block does.
    ipcMain.handle(`fx:${name}`, async (_event, { method, args }) => (method === "hubStatus" ? { ok: true, status: await host.api.hubStatus() } : host.api[method](...(Array.isArray(args) ? args : []))));
    const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
    const until = async (condition, what, ms = 15000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(50); }
      fs.writeFileSync(path.join(root, `${name}-failure.png`), (await contents.capturePage()).toPNG());
      throw new Error(`Timed out (${name}): ${what}`);
    };
    const capture = async (file) => {
      await run("for (const notice of document.querySelectorAll('#toast-host .toast')) notice.remove(); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
      await sleep(200);
      fs.writeFileSync(path.join(root, file), (await contents.capturePage()).toPNG());
      report.shots.push(file);
    };
    await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1", layout: "v2" } });
    await until("window.MefiNav && window.MefiCompanionHub && window.MefiShell && window.MefiShell.active() && !window.MefiBoot?.isActive?.()", "studio ready");
    await run("window.MefiVibe?.setMode?.('build', { go: false }); window.MefiNav.setRailPinned?.(false, { save: false }); window.__events = []; window.mefiStudio.onHubEvent((event) => window.__events.push(event));");
    return { name, window, contents, host, run, until, capture };
  }

  const one = await openPc("one", "tok-one");
  const two = await openPc("two", "tok-two");
  const go = (pc, place, extra = {}) => pc.run(`window.MefiNav.go("friends-page", ${JSON.stringify({ place, ...extra })});`);
  const toRoomsList = async (pc) => {
    await go(pc, "rooms");
    await pc.until("document.getElementById('rooms')?.dataset.view", "Rooms is up");
    // The first visit opens the Lobby room; step back to the list.
    if (await pc.run("return document.getElementById('rooms').dataset.view === 'room';")) await pc.run("(document.querySelector('#shell-pages [data-page=\"rooms:all\"]') || document.querySelector('[data-room-control=\"rooms:all\"]')).click();");
    await pc.until("document.getElementById('rooms').dataset.view === 'rooms'", "the room list");
  };
  const say = (pc, text) => pc.run(`const box = document.getElementById('rooms-compose'); box.value = ${JSON.stringify(text)}; box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));`);
  const texts = (pc) => pc.run("return [...document.querySelectorAll('#rooms .rooms-message-text')].map((node) => node.textContent);");

  // 1. Both open The Lobby: each signs in, connects and sees the other online.
  for (const pc of [one, two]) await go(pc, "lobby");
  for (const pc of [one, two]) await pc.until("document.getElementById('rooms')?.dataset.view === 'room' && window.MefiRoomLayout.navigation()?.rows.some(row=>row.key==='room:lobby' && row.current)", "The Lobby chat is ready");
  await say(one, "Hello from PC one in the Lobby");
  await two.until("[...document.querySelectorAll('.rooms-message-text')].some(node=>node.textContent==='Hello from PC one in the Lobby')", "the default Lobby delivers real chat across the two windows");
  await one.capture("two-0-room-desktop-lobby.png");
  await sleep(300);
  for (const pc of [one, two]) {
    await pc.run("window.MefiFriendsFront && document.getElementById('friends-front') && null");
    await go(pc, "lobby", { view: "roundup" });
    await pc.until(`document.querySelector('#friends-front .front-online-count')?.textContent.includes('1 online now') && [...document.querySelectorAll('#friends-front .front-who-text b')].some((node) => node.textContent === ${JSON.stringify(pc === one ? "Nova" : "Mefi")})`, "the other PC is online in The Lobby", 20000);
  }
  await one.capture("two-1-lobby-one.png");
  report.steps.push("both PCs meet in The Lobby");

  // 2. PC one makes a room and reads its invite code.
  await toRoomsList(one);
  await one.run("document.getElementById('rooms-new').click();");
  await one.until("document.getElementById('rooms-create-name')", "the New room form");
  await one.run("document.getElementById('rooms-create-name').value = 'Two PC test'; document.getElementById('rooms-create-policy').value = 'invite'; document.getElementById('rooms-create-listed').checked = false; document.getElementById('rooms-create').click();");
  await one.until("document.getElementById('rooms-status').textContent.startsWith('Two PC test is ready')", "the room is made");
  await one.until("[...document.querySelectorAll('#rooms .rooms-card')].some((card) => card.textContent.includes('Two PC test'))", "its card");
  await one.run("[...document.querySelectorAll('#rooms .rooms-card')].find((card) => card.textContent.includes('Two PC test')).querySelector('button').click();");
  await one.until("document.getElementById('rooms').dataset.view === 'room' && document.querySelector('#rooms .rooms-room-name')?.textContent === 'Two PC test'", "the room opens");
  await one.run("document.getElementById('rooms-room-menu').click();");
  await one.until("document.querySelector('#rooms .rooms-code')", "its invite code");
  const code = await one.run("return document.querySelector('#rooms .rooms-code').textContent;");
  assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await one.run("document.getElementById('rooms-room-menu').click();");
  report.steps.push(`a room and its invite code (${code})`);

  // 3. PC two joins with the code and lands in the room.
  await toRoomsList(two);
  await two.run(`document.getElementById('rooms-join-code').value = ${JSON.stringify(code.toLowerCase().replace("-", " "))}; document.getElementById('rooms-join').click();`);
  await two.until("document.getElementById('rooms').dataset.view === 'room' && document.querySelector('#rooms .rooms-room-name')?.textContent === 'Two PC test'", "a code joins the room");
  report.steps.push("joined with the code");

  // 4. Chat both ways; who is here shows both.
  await say(one, "Hello from PC one");
  await two.until("[...document.querySelectorAll('#rooms .rooms-message-text')].some((node) => node.textContent === 'Hello from PC one')", "PC two hears PC one");
  await say(two, "Hi! PC two here");
  await one.until("[...document.querySelectorAll('#rooms .rooms-message-text')].some((node) => node.textContent === 'Hi! PC two here')", "PC one hears PC two");
  await one.until(`window.MefiRoomLayout.navigation()?.rows.some(row=>row.key==='person:${TWO.id}' && row.label==='Nova')`, "PC one sees PC two in the room", 40000);
  await one.capture("two-2-chat-one.png");
  await two.capture("two-2-chat-two.png");
  report.steps.push("chat both ways, who is here");

  // 5. PC two closes Studio; PC one keeps talking; PC two comes back and catches up from PC one's copy.
  await toRoomsList(two);
  await two.run("await window.mefiStudio.hubDisconnect();");
  await one.until(`!window.MefiRoomLayout.navigation()?.rows.some(row=>row.key==='person:${TWO.id}')`, "PC two left", 40000);
  await say(one, "While you were away: one");
  await sleep(150);
  await say(one, "While you were away: two");
  await sleep(300);
  await two.run("await window.mefiStudio.hubConnect();");
  await toRoomsList(two);
  await two.until("[...document.querySelectorAll('#rooms .rooms-card')].some((card) => card.textContent.includes('Two PC test'))", "the room list after coming back");
  await two.run("[...document.querySelectorAll('#rooms .rooms-card')].find((card) => card.textContent.includes('Two PC test')).querySelector('button').click();");
  await two.until("['Hello from PC one', 'Hi! PC two here', 'While you were away: one', 'While you were away: two'].every((text) => [...document.querySelectorAll('#rooms .rooms-message-text')].some((node) => node.textContent === text))", "the missed messages are filled in from PC one's copy", 20000);
  report.caughtUp = await texts(two);
  await two.capture("two-3-caught-up-two.png");
  report.steps.push("left, missed two messages, came back and caught up");

  // 6. Listen together: PC one starts a link for the room; PC two's Studio hears the shared player.
  const roomId = await one.run("return document.querySelector('#rooms').closest('#friends-overlay') && [...(await window.mefiStudio.hubRooms()).rooms].find((room) => room.name === 'Two PC test').id;");
  const started = await one.run(`return await window.mefiStudio.hubListen({ roomId: ${JSON.stringify(roomId)}, action: 'start', url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk', label: 'Lo-fi for coding', provider: 'youtube', positionMs: 0 });`);
  assert.equal(started?.ok, true, JSON.stringify(started));
  await two.until("window.__events.some((event) => event.type === 'listen' && event.session?.label === 'Lo-fi for coding')", "PC two hears the shared player");
  await two.until("document.querySelector('.room-desktop-listening .room-desktop-card-title')?.textContent==='Lo-fi for coding'", "the second room desktop shows the received player label");
  await two.capture("two-4-room-player-two.png");
  report.steps.push("listen together");

  // 7. PC one shares a project; PC two plays it; after two minutes both earn, and PC one hears it.
  await go(one, "hub");
  await one.until("document.getElementById('project-hub')?.dataset.state === 'ready' && document.getElementById('project-hub-tab-share')", "the Project hub");
  await one.run("document.getElementById('project-hub-tab-share').click();");
  await one.until("document.getElementById('project-hub-url')", "the share form");
  await one.run("document.getElementById('project-hub-url').value = 'https://mefi.itch.io/two-pc-test'; document.getElementById('project-hub-name').value = 'Two PC Test'; document.querySelector('form.project-hub-share').requestSubmit();");
  await one.until("document.getElementById('project-hub-status').textContent.startsWith('Shared.')", "the card is shared");
  await go(two, "hub");
  await two.until("document.getElementById('project-hub')?.dataset.state === 'ready' && document.getElementById('project-hub-tab-new')", "PC two's Project hub");
  await two.run("document.getElementById('project-hub-tab-new').click();");
  await two.until("[...document.querySelectorAll('#project-hub [data-project]')].some((row) => row.textContent.includes('Two PC Test'))", "PC two sees the card");
  // A shared website now requires explicit origin consent. Answer the same
  // prompt a person sees, and prove that declining neither opens nor earns.
  await two.run("window.__linkPrompts = []; window.confirm = (text) => { window.__linkPrompts.push(String(text)); return false; }; const row = [...document.querySelectorAll('#project-hub [data-project]')].find((item) => item.textContent.includes('Two PC Test')); [...row.querySelectorAll('button')].find((button) => button.textContent === 'Play').click();");
  await sleep(100);
  const declinedOpened = two.host.opened.length > 0;
  const declinedEarned = two.host.timers.some((timer) => timer.ms >= 120_000);
  assert.equal(declinedOpened, false, "declining website consent opens no destination");
  assert.equal(declinedEarned, false, "declining does not begin an earning play");
  const refusedPrompt = await two.run("return window.__linkPrompts;");
  assert.equal(refusedPrompt.length, 1);
  assert.match(refusedPrompt[0], /Open mefi\.itch\.io\?/);
  assert.match(refusedPrompt[0], /website will receive your IP address/);
  assert.ok(refusedPrompt[0].includes("https://mefi.itch.io/two-pc-test"));
  await two.run("window.confirm = (text) => { window.__linkPrompts.push(String(text)); return true; }; const row = [...document.querySelectorAll('#project-hub [data-project]')].find((item) => item.textContent.includes('Two PC Test')); [...row.querySelectorAll('button')].find((button) => button.textContent === 'Play').click();");
  await sleep(500);
  report.linkConsent = { prompts: await two.run("return window.__linkPrompts;"), declinedOpened, declinedEarned };
  assert.equal(report.linkConsent.prompts.length, 2);
  assert.equal(report.linkConsent.prompts[1], refusedPrompt[0], "approval reviews the same exact website");
  assert.deepEqual(two.host.opened, ["https://mefi.itch.io/two-pc-test"], "Play opens the link in the browser");
  const finishPlay = two.host.timers.find((timer) => timer.ms >= 120_000);
  assert.ok(finishPlay, "the play is counted two minutes later");
  skew += finishPlay.ms + 1000;
  finishPlay.fn();
  await one.until("[...document.querySelectorAll('#toast-host .toast')].some((toast) => toast.textContent.includes('Someone played your project: +5 credits'))", "PC one's pop-up for the play");
  await one.capture("two-4-played-one.png");
  await go(one, "lobby", { view: "roundup" });
  await one.until("document.querySelector('#friends-front .front-mast')?.textContent.includes('5 credits')", "PC one's Lobby shows the credits");
  await go(two, "lobby", { view: "roundup" });
  await two.until("document.querySelector('#friends-front .front-mast')?.textContent.includes('2 credits')", "PC two earned for playing");
  await two.capture("two-5-lobby-two.png");
  report.steps.push("shared a card, played it, both earned");

  assert.deepEqual(report.networkAttempts, []);
  report.complete = true;
  finish();
}).catch(finish);
