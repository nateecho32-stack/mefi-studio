import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import friendsModule from "../scripts/companion-friends.cjs";

// main.cjs's "Companion friends" block in a vm with a fake hub client: what
// actually leaves this PC for each sharing rule, what the renderer is shown of
// a friend's card, and the practice playdate. The rules themselves are pinned
// by companion_friends.test.mjs; this holds the host to them.

const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("// ---- Companion friends: playdates in rooms");
const to = main.indexOf("// ---- end of companion friends", from);
assert.ok(from > 0 && to > from, "main.cjs has a Companion friends block");
const block = main.slice(from, to);
const ME = "100000000000000001";
const ALICE = "111111111111111111";
const BOB = "222222222222222222";
const ROOM = "room_jam";

function host({ features = ["companion", "companion.direct"], settings = {}, rooms = [ROOM], state = "ready" } = {}) {
  const sent = [], frames = [], timers = [], bonds = [];
  const store = { settings: structuredClone(settings) };
  const client = {
    status: () => ({ configured: true, state, error: null, user: { id: ME, name: "Me" }, rooms, companions: features.includes("companion"), companionDirect: features.includes("companion") && features.includes("companion.direct") }),
    sendCompanion: (roomId, card, target = null) => {
      if (state !== "ready" || !features.includes("companion") || !rooms.includes(roomId)) return false;
      if (target != null && !features.includes("companion.direct")) return false;
      frames.push({ roomId, card, to: target }); return true;
    },
  };
  const tasks = [
    { id: "t1", title: "Polish the landing page", status: "open" },
    { id: "t2", title: "Ship the changelog", status: "done", doneAt: Date.now() },
    { id: "t3", title: "Rotate token=abcdef1234567890 for the API", status: "done", doneAt: Date.now() - 1000 },
  ];
  const context = vm.createContext({
    optionalHelper: () => friendsModule,
    readSettings: async () => structuredClone(store.settings),
    updateSettings: async (change) => { const next = structuredClone(store.settings); if (change(next) !== false) store.settings = next; return store.settings; },
    getEyes: async () => ({ readJson: async () => tasks }),
    TASKS_PATH: "tasks.json",
    autopilot: { jobs: [{ taskId: "t1", finished: false }] },
    agentBrain: {
      companionState: async () => ({ ok: true, state: "working", look: "owl", personality: "playful", queue: { counts: { total: 0 } } }),
      companionBond: async (row) => { bonds.push(row.event); return { ok: true }; },
    },
    assistantState: { questions: [] },
    projects: { current: () => ({ id: "p1", name: "Little planet" }) },
    hubClient: client,
    hubStatus: async () => ({ ...client.status(), linked: true }),
    send: (channel, payload) => sent.push([channel, payload]),
    logLine: () => {},
    setTimeout: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { const at = timers.indexOf(timer); if (at >= 0) timers.splice(at, 1); },
  });
  vm.runInContext(`${block}\nthis.api = { friendsHear, friendsPublish, friendsView, friendsSharingSet, friendsPlaydate, friendsState };`, context);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const flush = async () => { while (timers.length) { timers.shift().fn(); for (let i = 0; i < 20; i += 1) await new Promise((done) => setImmediate(done)); } };
  return { api: context.api, plain, sent, frames, store, flush, bonds, hear: (event) => context.api.friendsHear({ type: "companion", roomId: ROOM, receivedAt: 5, direct: false, ...event }) };
}

test("with no rules the room hears play only: look and mood, nothing about the owner or the work", async () => {
  const h = host();
  await h.api.friendsPublish();
  assert.equal(h.frames.length, 1);
  assert.deepEqual({ ...h.frames[0].card }, { v: 1, level: "play", look: "owl", mood: "thinking" });
  assert.equal(h.frames[0].to, null);
  const view = await h.api.friendsView({ name: "Mefi" });
  assert.equal(view.sent.length, 1); assert.match(view.sent[0].summary, /owl look · thinking mood/);
  assert.equal(view.preview.level, "play");
  await h.api.friendsPublish();
  assert.equal(h.frames.length, 1, "an unchanged card is not sent again");
});

test("a hub that does not carry companions is never sent a card", async () => {
  const h = host({ features: [] });
  await h.api.friendsPublish();
  assert.deepEqual(h.frames, []);
  const view = await h.api.friendsView();
  assert.equal(view.hub.companions, false);
});

test("a friend allowed more gets a card of their own, and taking it back returns them to the room's", async () => {
  const h = host();
  await h.api.friendsView({ name: "Mefi" });
  h.hear({ from: ALICE, card: { v: 1, level: "hello", look: "cat", mood: "happy", name: "Nova", personality: "balanced" } });
  let result = await h.api.friendsSharingSet({ rule: { scope: "friend", target: ALICE, level: "work", label: "Nova" }, duration: "always" });
  assert.ok(result.ok);
  assert.equal(h.store.settings.companionSharing.rules[0].level, "work", "an always rule is saved");
  await h.flush();
  const direct = h.frames.find((frame) => frame.to === ALICE);
  assert.equal(direct.card.level, "work");
  assert.equal(direct.card.name, "Mefi"); assert.equal(direct.card.personality, "playful");
  assert.deepEqual(direct.card.work.done, ["Ship the changelog"], "the title holding a token is left out");
  assert.deepEqual(direct.card.work.running, ["Polish the landing page"]);
  assert.equal(h.frames.filter((frame) => frame.to === null).at(-1).card.level, "play", "the room still hears play");
  result = await h.api.friendsSharingSet({ rule: { scope: "friend", target: ALICE, level: null }, duration: "always" });
  await h.flush();
  assert.deepEqual(h.plain(h.frames.at(-1)), { roomId: ROOM, card: null, to: ALICE });
});

test("without one-member delivery a friend allowed more still hears only the room's card", async () => {
  const h = host({ features: ["companion"], settings: { companionSharing: { everyone: "play", rules: [{ scope: "friend", target: ALICE, level: "work", label: "Nova" }] } } });
  h.hear({ from: ALICE, card: { v: 1, level: "play", look: "cat" } });
  await h.flush(); await h.api.friendsPublish();
  assert.ok(h.frames.every((frame) => frame.to === null && frame.card.level === "play"));
  const view = await h.api.friendsView();
  assert.equal(view.friends[0].level, "work"); assert.equal(view.friends[0].sent, "play");
});

test("a friend allowed less lowers the whole room, and a stay-home hold takes the card back", async () => {
  const h = host({ settings: { companionSharing: { everyone: "status", rules: [{ scope: "friend", target: BOB, level: "play", label: "Pip" }] } } });
  await h.api.friendsPublish();
  assert.equal(h.frames[0].card.level, "play");
  await h.api.friendsSharingSet({ hold: "none" });
  await h.flush();
  assert.deepEqual(h.plain(h.frames.at(-1)), { roomId: ROOM, card: null, to: null });
  assert.equal(h.store.settings.companionSharing.everyone, "status", "a hold is for this session only");
});

test("a friend's card is read before the renderer sees it; our own echo and bad fields are dropped", async () => {
  const h = host();
  h.hear({ from: ME, card: { v: 1, level: "play", look: "owl" } });
  assert.equal(h.sent.length, 0, "our own card coming back is ignored");
  h.hear({ from: ALICE, card: { v: 1, level: "play", look: "cat", mood: "happy", name: "Sneaky", html: "<img onerror=x>", work: { done: ["secret"] } } });
  assert.deepEqual(h.plain(h.sent.at(-1)), ["hub:event", { type: "companion", roomId: ROOM, from: ALICE, card: { v: 1, level: "play", look: "cat", mood: "happy" }, at: 5 }]);
  h.hear({ from: ALICE, direct: true, card: { v: 1, level: "status", look: "cat", mood: "happy", name: "Nova", personality: "focused", status: { state: "working", running: 1, doneToday: 2 } } });
  assert.equal(h.sent.at(-1)[1].card.level, "status", "a card for this member alone wins over the room's");
  h.hear({ from: ALICE, card: { v: 1, level: "play", look: "cat" } });
  assert.equal(h.sent.at(-1)[1].card.level, "status");
  h.hear({ from: ALICE, card: null });
  assert.equal(h.sent.at(-1)[1].card, null, "going home clears both");
  h.api.friendsHear({ type: "status", status: { state: "ready" } });
  assert.deepEqual(h.plain(h.sent.at(-1)), ["hub:event", { type: "status", status: { state: "ready" } }], "other hub events pass straight on");
});

test("a friend sharing more is listed with an ask, and Not now is kept for the session", async () => {
  const h = host();
  h.hear({ from: ALICE, card: { v: 1, level: "status", look: "cat", mood: "happy", name: "Nova", personality: "balanced", status: { state: "resting", running: 0, doneToday: 4 } } });
  let view = await h.api.friendsView();
  assert.equal(view.friends.length, 1);
  assert.equal(view.friends[0].ask.level, "status");
  assert.match(view.friends[0].ask.text, /^Nova told us/);
  view = await h.api.friendsSharingSet({ dismiss: ALICE });
  assert.equal(view.friends[0].ask, null);
  view = await h.api.friendsSharingSet({ rule: { scope: "friend", target: ALICE, level: "status", label: "Nova" }, duration: "session" });
  assert.equal(h.store.settings.companionSharing, undefined, "a session rule is never saved");
  assert.equal(view.friends[0].level, "status"); assert.equal(view.friends[0].why, "Rule for this friend (this session)");
  assert.equal((await h.api.friendsSharingSet({ everyone: "everything" })).ok, false);
  assert.equal((await h.api.friendsSharingSet({ rule: { scope: "friend", target: "nobody", level: "work" } })).ok, false);
});

test("playdates: practice on this PC, a friend who is out, and none while staying home", async () => {
  const h = host();
  const practice = await h.api.friendsPlaydate({ practice: true });
  assert.ok(practice.ok); assert.equal(practice.practice, true);
  assert.equal(practice.friend.name, "Pip");
  assert.equal(practice.me.level, "play", "the practice shows what friends see by default");
  assert.deepEqual(h.frames, [], "a practice playdate sends nothing");
  assert.deepEqual(h.bonds, ["playdate"]);
  assert.equal((await h.api.friendsPlaydate({ roomId: ROOM, userId: ALICE })).ok, false, "nobody is out yet");
  h.hear({ from: ALICE, card: { v: 1, level: "hello", look: "cat", mood: "happy", name: "Nova", personality: "playful" } });
  const scene = await h.api.friendsPlaydate({ roomId: ROOM, userId: ALICE, music: true });
  assert.ok(scene.ok); assert.equal(scene.friend.name, "Nova"); assert.equal(scene.me.level, "play");
  assert.ok(!JSON.stringify(scene).includes("Little planet"));
  await h.api.friendsSharingSet({ hold: "none" });
  assert.equal((await h.api.friendsPlaydate({ practice: true })).ok, false);
});
