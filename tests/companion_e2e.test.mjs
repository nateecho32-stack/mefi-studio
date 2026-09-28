import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import hubClient from "../scripts/hub-client.cjs";
import friendsModule from "../scripts/companion-friends.cjs";

// Companion playdates end to end, the way three PCs with three Discord
// accounts meet: each "Studio" here is main.cjs's real "Companion friends"
// block (in a vm, with its own settings and board) driving the real
// scripts/hub-client.cjs, and all three talk over real WebSockets to the Void
// Engine Bot's real hub on 127.0.0.1 (fake Discord, manual clock). It checks
// what actually crosses the wire for each sharing rule. The bot is a separate
// repository, so this runs only when MEFI_STUDIO_BOT_ROOT names a checkout of
// it (with its node_modules):
//   MEFI_STUDIO_BOT_ROOT="C:/path/to/void-engine-bot" node --test tests/companion_e2e.test.mjs

const ROOT = process.env.MEFI_STUDIO_BOT_ROOT;
const present = Boolean(ROOT) && existsSync(path.join(ROOT, "src", "http", "ws.mjs"));
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const block = main.slice(main.indexOf("// ---- Companion friends: playdates in rooms"), main.indexOf("// ---- end of companion friends"));
const realWait = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(check, what, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await realWait(25);
  }
}
const plain = (value) => JSON.parse(JSON.stringify(value));

// One Studio: the host block with its own settings file, board and companion,
// wired to a real hub client exactly as main.cjs's hubInstance() does.
function studio({ url, t, allowToken, userId, name, look, personality, tasks = [], running = [] }) {
  const store = { settings: {} };
  const events = [];
  const context = vm.createContext({
    optionalHelper: () => friendsModule,
    readSettings: async () => structuredClone(store.settings),
    updateSettings: async (change) => { const next = structuredClone(store.settings); if (change(next) !== false) store.settings = next; return store.settings; },
    getEyes: async () => ({ readJson: async () => tasks }),
    TASKS_PATH: "tasks.json",
    autopilot: { jobs: running.map((taskId) => ({ taskId, finished: false })) },
    agentBrain: { companionState: async () => ({ ok: true, state: running.length ? "working" : "resting", look, personality, queue: { counts: { total: 0 } } }), companionBond: async () => ({ ok: true }) },
    assistantState: { questions: [] },
    projects: { current: () => ({ id: "p", name: `${name}'s project` }) },
    hubClient: null,
    hubStatus: async () => ({ ...context.hubClient.status(), linked: true }),
    send: (channel, payload) => events.push([channel, payload]),
    logLine: () => {},
    // The block's debounces, shortened so the test does not wait seconds.
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 40)),
    clearTimeout: (timer) => clearTimeout(timer),
  });
  vm.runInContext(`${block}\nthis.api = { friendsHear, friendsPublish, friendsView, friendsSharingSet, friendsPlaydate, friendsState };`, context);
  context.hubClient = hubClient.createHubClient({ url, now: () => t.clock.now(), getAccessToken: async () => ({ ok: true, token: allowToken(t, userId) }), onEvent: (event) => context.api.friendsHear(event) });
  const api = context.api;
  return {
    userId, client: context.hubClient, api, store, events,
    view: async () => plain(await api.friendsView({ name })),
    friend: async (id) => (await api.friendsView({ name })).friends.find((row) => row.userId === id) ?? null,
    wire: () => events.filter(([channel, payload]) => channel === "hub:event" && payload.type === "companion").map(([, payload]) => plain(payload)),
  };
}

test("three PCs, three Discord accounts: companions meet in a room and share only what each owner allows", { skip: present ? false : "set MEFI_STUDIO_BOT_ROOT to a Void Engine Bot checkout" }, async () => {
  const bot = (file) => import(pathToFileURL(path.join(ROOT, file)).href);
  const { hubSetup, allowToken, OWNER, ALICE, BOB } = await bot("test/helpers/hub.mjs");
  const { createHubServer } = await bot("src/http/server.mjs");
  const { attachWs } = await bot("src/http/ws.mjs");
  const t = hubSetup();
  const server = createHubServer({ config: t.config, services: { sessions: t.sessions, rooms: t.rooms, fanout: t.fanout, store: t.store }, clock: t.clock, log: t.log, hubState: t.hubState, registerClaimRoutes: null });
  const ws = attachWs(server, { services: { rooms: t.rooms, fanout: t.fanout, listen: t.listen }, sessions: t.sessions, clock: t.clock, log: t.log });
  const address = await server.start(0);
  const url = `http://127.0.0.1:${address.port}`;
  const now = Date.now();
  const pc1 = studio({ url, t, allowToken, userId: OWNER, name: "Mefi", look: "wisp", personality: "balanced" });
  const pc2 = studio({ url, t, allowToken, userId: ALICE, name: "Nova", look: "cat", personality: "playful",
    tasks: [{ id: "a1", title: "Polish the landing page", status: "open" }, { id: "a2", title: "Ship the changelog", status: "done", doneAt: now }, { id: "a3", title: "Rotate token=abcdef1234567890 on the API", status: "done", doneAt: now - 1 }], running: ["a1"] });
  const pc3 = studio({ url, t, allowToken, userId: BOB, name: "Pip", look: "fox", personality: "focused" });
  const all = [pc1, pc2, pc3];
  try {
    for (const pc of all) await pc.client.connect();
    await until(() => all.every((pc) => pc.client.status().state === "ready"), "three Studios ready");
    for (const pc of all) assert.equal(pc.client.status().companions && pc.client.status().companionDirect, true, "the hub carries companions");
    // Friends › Rooms (renderer/rooms.js calls these), as the owner does it: PC 1 (Room Host) makes a room;
    // PC 2 cannot; the others ask to join and PC 1 lets them in.
    const room_ = { kind: "hangout", policy: "request", listed: true };
    const refused = await pc2.client.createRoom({ ...room_, name: "Nope" });
    assert.equal(refused.reason, "room-host-role");
    const made = await pc1.client.createRoom({ ...room_, name: "Friday jam" });
    assert.ok(made.ok, JSON.stringify(made));
    const room = made.room;
    for (const pc of [pc2, pc3]) {
      const listed = await pc.client.rooms();
      assert.equal(listed.rooms.find((row) => row.id === room.id)?.you, "none");
      assert.ok((await pc.client.requestJoin(room.id)).ok);
    }
    const inbox = await pc1.client.requests();
    const pending = inbox.requests.filter((row) => row.status === "pending");
    assert.deepEqual(pending.map((row) => row.requester.id).sort(), [ALICE, BOB].sort());
    for (const request of pending) assert.ok((await pc1.client.decide(request.id, "approve")).ok);
    for (const pc of [pc2, pc3]) assert.equal((await pc.client.rooms()).rooms.find((row) => row.id === room.id)?.you, "member");
    // Each PC opens Friends once (the companion's name reaches the host), then is there.
    for (const pc of all) await pc.view();
    for (const pc of all) pc.client.subscribe(room.id);
    await until(async () => (await Promise.all(all.map((pc) => pc.view()))).every((view) => view.friends.length === 2), "every companion sees the other two", 8000);
    // Nothing has been allowed yet: every card on the wire is play only.
    for (const pc of all) for (const event of pc.wire()) if (event.card) assert.deepEqual(Object.keys(event.card).sort(), ["level", "look", "mood", "v"], JSON.stringify(event));
    const novaSeenByBob = await pc3.friend(ALICE);
    assert.deepEqual(novaSeenByBob.card, { v: 1, level: "play", look: "cat", mood: "thinking" });
    assert.equal(novaSeenByBob.ask, null);

    // PC 2 (Alice) lets her friend on PC 3 see her work; the room still hears play.
    await pc2.api.friendsSharingSet({ rule: { scope: "friend", target: BOB, level: "work", label: "Pip" }, duration: "always" });
    const upgraded = await until(async () => { const row = await pc3.friend(ALICE); return row?.card.level === "work" ? row : null; }, "Bob hears Alice's work card");
    assert.equal(upgraded.card.name, "Nova");
    assert.deepEqual(upgraded.card.work.running, ["Polish the landing page"]);
    assert.deepEqual(upgraded.card.work.done, ["Ship the changelog"], "the title with a token never leaves PC 2");
    assert.ok(!JSON.stringify(pc3.wire()).includes("abcdef1234567890"));
    await realWait(200);
    assert.equal((await pc1.friend(ALICE)).card.level, "play", "PC 1 never got more than play from Alice");
    assert.ok(!JSON.stringify(pc1.wire()).includes("landing page"), "a card for one friend reaches nobody else");

    // PC 3 (Bob) is asked whether to share back, and says yes for this session.
    const ask = (await pc3.friend(ALICE)).ask;
    assert.equal(ask.level, "work");
    assert.match(ask.text, /^Nova told us what its person is working on/);
    await pc3.api.friendsSharingSet({ rule: { scope: "friend", target: ALICE, level: ask.level, label: "Nova" }, duration: "session" });
    assert.equal(pc3.store.settings.companionSharing, undefined, "a session rule is never saved");
    await until(async () => (await pc2.friend(BOB))?.card.level === "work", "Alice hears Bob's card back");
    assert.equal((await pc3.friend(ALICE)).ask, null, "an even trade asks nothing more");

    // A playdate between PC 2 and PC 3 plays the same scene on both, mirrored.
    const onAlice = plain(await pc2.api.friendsPlaydate({ roomId: room.id, userId: BOB }));
    const onBob = plain(await pc3.api.friendsPlaydate({ roomId: room.id, userId: ALICE }));
    assert.ok(onAlice.ok && onBob.ok);
    assert.equal(onAlice.scene, onBob.scene);
    const flip = { me: "friend", friend: "me", both: "both" };
    assert.deepEqual(onAlice.beats.map((beat) => ({ ...beat, who: flip[beat.who] })), onBob.beats);

    // PC 1 stays home for this session: the others see its companion leave.
    await pc1.api.friendsSharingSet({ hold: "none" });
    await until(async () => !(await pc2.friend(OWNER)) && !(await pc3.friend(OWNER)), "PC 1's companion goes home");
    assert.equal(pc1.store.settings.companionSharing, undefined, "a hold is for this session only");
    const log = (await pc1.view()).sent;
    assert.equal(log[0].level, "none", "What was sent says it went home");
    assert.ok(log.every((row) => row.level === "play" || row.level === "none"), "PC 1 never sent more than play");
  } finally {
    for (const pc of all) { try { await pc.client.disconnect(); } catch {} }
    ws.close(); server.closeAllConnections(); await server.stop();
  }
});
