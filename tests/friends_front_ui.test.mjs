import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// renderer/friends-front.js (Friends' sign-in card and The Lobby, its front
// page) in a vm with a tiny DOM and a fake bridge: signed out it is one
// "Sign in with Discord" card that links, connects and hands back; signed in
// it reads the relay's front page in one call and paints the masthead, the
// people online, the lead story, the three columns and the foot; its links
// go to Friends' own places; it reads again on a timer and on credits, and
// stops when it is let go. Rooms and the Project hub show the same card.
// Then main.cjs's HUB_ROOM_METHODS gate.

const source = await readFile(new URL("../renderer/friends-front.js", import.meta.url), "utf8");
const roomsSource = await readFile(new URL("../renderer/rooms.js", import.meta.url), "utf8");
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const flush = async () => { for (let i = 0; i < 60; i += 1) await Promise.resolve(); };
const ME = { id: "123456789012345678", name: "Mefi" };

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.className = ""; this.text = ""; this.value = ""; this.checked = false; this.disabled = false; this.id = ""; this.props = {}; this.style = { setProperty: (key, value) => { this.props[key] = value; } }; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { for (const child of children) { if (child && typeof child === "object") child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  click() { for (const listener of this.listeners.click ?? []) listener({ type: "click" }); }
  change(checked) { this.checked = checked; for (const listener of this.listeners.change ?? []) listener({ type: "change" }); }
  focus() {}
  all() { return [this, ...this.children.flatMap((child) => child.all?.() ?? [])]; }
  find(id) { return this.all().find((item) => item.id === id) ?? null; }
  buttons(label) { return this.all().filter((item) => item.tagName === "BUTTON" && item.textContent === label); }
  byClass(name) { return this.all().filter((item) => String(item.className).split(" ").includes(name)); }
}
const textNode = (value) => ({ textContent: String(value) });

const front = (overrides = {}) => ({
  ok: true,
  online: { count: 2, people: [
    { id: "200000000000000001", name: "Alice", rank: "flame", specialRanks: [], where: { id: "room_jam", name: "Jam night", kind: "hangout" } },
    { id: "200000000000000002", name: "Bob", rank: "spark", specialRanks: [], where: null },
  ] },
  lobby: { here: 3 },
  rooms: [{ id: "room_jam", name: "Jam night", kind: "hangout", status: "active", you: "none", memberCount: 4, listed: true, here: 2 }],
  ownRoom: { id: "room_mine", name: "Mefi's room", kind: "hangout" },
  visible: true,
  top: { id: "proj_a", url: "https://alice.itch.io/void", host: "alice.itch.io", title: "Void Runner", blurb: "Jump the void", kind: "game", owner: { id: "200000000000000001", name: "Alice", rank: "flame" }, plays: 40, stars: 12, createdAt: Date.now(), week: true, weekPlays: 9, weekStars: 3 },
  fresh: [{ id: "proj_b", url: "https://bob.itch.io/tides", host: "bob.itch.io", title: "Tiny Tides", blurb: "", kind: "game", owner: { id: "200000000000000002", name: "Bob", rank: "spark" }, plays: 2, stars: 0, createdAt: Date.now() }],
  rankUps: [{ id: "200000000000000001", name: "Alice", rank: { key: "flame", name: "Flame" } }],
  you: { balance: 45, lifetime: 45, rank: { key: "spark", name: "Spark", next: { key: "ember", name: "Ember", at: 50 }, progress: 0.9 }, week: { earned: 15, plays: 3, stars: 1 } },
  ...overrides,
});

function environment({ status = { configured: true, linked: true, state: "ready", user: ME, front: true }, page = front(), replies = {}, bridge = true, link = { ok: true }, check = { ok: true }, extra = "" } = {}) {
  const calls = [], goes = [], timers = [], copied = [];
  let hubEvent = null;
  const api = bridge ? {
    hubStatus: async () => ({ ok: true, status }),
    hubConnect: async () => { calls.push(["connect"]); status = { ...status, state: "ready" }; return { ok: true, status }; },
    hubRooms: async () => ({ ok: true, rooms: [] }),
    onHubEvent: (fn) => { hubEvent = fn; },
    hubRoom: async (method, ...args) => {
      calls.push([method, ...args]);
      if (method === "front") return typeof page === "function" ? page() : page;
      if (method === "roomCode") return { ok: true, code: "KQ7M-2PXD", link: "https://mefi-relay.mefi-studio.workers.dev/join/KQ7M2PXD" };
      const reply = replies[method];
      return typeof reply === "function" ? reply(...args) : reply ?? { ok: true };
    },
    hubProjects: async (method, ...args) => { calls.push([`projects:${method}`, ...args]); return { ok: true, minMs: 120000 }; },
  } : undefined;
  const window = {
    mefiStudio: api,
    MefiNav: { go: (id, params) => goes.push([id, params]) },
    MefiCommunity: {
      link: async () => { calls.push(["link"]); if (link.ok) status = { ...status, linked: true, state: "off", front: true }; return link; },
      check: async () => { calls.push(["check"]); return check; },
      join: async () => { calls.push(["join"]); return { ok: true }; },
    },
  };
  const context = vm.createContext({
    window, document: { createElement: (tag) => new Element(tag), createTextNode: textNode, visibilityState: "visible" },
    navigator: { clipboard: { writeText: async (value) => { copied.push(value); } } },
    localStorage: (() => { const store = new Map(); return { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) }; })(),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    Date, Number, Array, Set, Map, Promise, JSON, Object, String, Math,
  });
  vm.runInContext(source, context);
  if (extra) vm.runInContext(extra, context);
  return { window, front: window.MefiFriendsFront, calls, goes, timers, copied, push: (event) => hubEvent?.(event), setStatus: (next) => { status = next; } };
}

test("signed out, Friends is one card: Sign in with Discord links, connects and hands back", async () => {
  assert.equal(environment({ bridge: false }).front.card().find("friends-front-status").textContent, "The Lobby works in the desktop app.");
  const env = environment({ status: { configured: true, linked: false, state: "off" } });
  const card = env.front.card();
  await flush();
  assert.equal(card.dataset.state, "signed-out");
  const gate = card.find("friends-gate");
  assert.ok(gate, "the sign-in card");
  assert.equal(gate.find("friends-gate-title").textContent, "Friends");
  assert.match(gate.textContent, /Nothing you type in a room is stored on the server\./);
  assert.match(gate.textContent, /You show as online while Studio is open\. Turn it off any time\./);
  gate.find("friends-gate-signin").click();
  await flush();
  assert.deepEqual(env.calls.slice(0, 3).map((call) => call[0]), ["link", "connect", "front"], "link, connect, then the front page");
  assert.equal(card.dataset.state, "ready");
});

test("a Discord account outside the server is asked to join, then checked again", async () => {
  const env = environment({ status: { configured: true, linked: false, state: "off" }, link: { ok: false, error: "not-member" } });
  const card = env.front.card();
  await flush();
  card.find("friends-gate-signin").click();
  await flush();
  const gate = card.find("friends-gate");
  assert.equal(gate.dataset.state, "not-member");
  assert.equal(gate.find("friends-gate-status").textContent, "Your Discord account isn't in the Void Engine server yet. Join it, then check again.");
  gate.find("friends-gate-join").click();
  env.setStatus({ configured: true, linked: true, state: "off", front: true });
  gate.find("friends-gate-recheck").click();
  await flush();
  assert.deepEqual(env.calls.map((call) => call[0]).slice(0, 5), ["link", "join", "check", "connect", "front"]);
  // Cancelled: it says so and stays.
  const cancelled = environment({ status: { configured: true, linked: false, state: "off" }, link: { ok: false, error: "canceled" } });
  const again = cancelled.front.card();
  await flush();
  again.find("friends-gate-signin").click();
  await flush();
  assert.equal(again.find("friends-gate-status").textContent, "Signing in was cancelled. Press Sign in with Discord to try again.");
});

test("The Lobby reads the front page once and paints it like the Daily", async () => {
  const env = environment();
  const card = env.front.card();
  await flush();
  assert.equal(card.dataset.state, "ready");
  assert.equal(env.calls.filter((call) => call[0] === "front").length, 1);
  assert.equal(card.find("friends-front-title").textContent, "The Lobby");
  assert.match(card.byClass("front-mast")[0].textContent, /What your friends are making/);
  assert.match(card.byClass("front-online-count")[0].textContent, /2 online now/);
  assert.match(card.byClass("front-mast")[0].textContent, /You: Spark · 45 credits/);
  const people = card.byClass("front-who");
  assert.deepEqual(people.map((item) => item.byClass("front-who-text")[0].textContent), ["AliceFlame · In Jam night", "BobSpark · In Studio"]);
  assert.equal(people[0].byClass("front-avatar")[0].textContent, "A");
  assert.ok(Number.isFinite(Number(people[0].byClass("front-avatar")[0].props["--who-hue"])), "a steady colour per member");
  const lead = card.byClass("front-lead")[0];
  assert.match(lead.textContent, /Top project this week/);
  assert.equal(lead.byClass("front-lead-title")[0].textContent, "Void Runner");
  assert.match(lead.byClass("front-byline")[0].textContent, /Alice · Flame · Shared today · game · 9 plays this week · 12 stars/);
  const cols = card.byClass("front-col");
  assert.deepEqual(cols.map((col) => col.byClass("front-col-title")[0].textContent), ["Rooms open now", "New this week", "Your week"]);
  assert.match(cols[0].textContent, /Jam night.*Hangout · 4 people · 2 here now/);
  assert.match(cols[1].textContent, /Tiny Tides.*Bob · game · 2 plays/);
  assert.match(cols[1].textContent, /Rank ups.*Alice reached Flame/);
  assert.match(cols[2].textContent, /45credits · rank Spark5 more to Ember/);
  assert.match(cols[2].textContent, /Your projects got 3 plays\+15 credits this week/);
  assert.match(cols[2].textContent, /1 new star/);
  assert.equal(card.find("friends-front-lobby").textContent, "Say hi in the Lobby · 3 there");
  // The invite code of the member's own room arrives after the page.
  assert.deepEqual(env.calls.find((call) => call[0] === "roomCode"), ["roomCode", "room_mine"]);
  assert.equal(card.byClass("front-code")[0].textContent, "KQ7M-2PXD");
});

test("its links go to Friends' own places; Play, Show me as online and Copy invite do what they say", async () => {
  const env = environment();
  const card = env.front.card();
  await flush();
  card.find("friends-front-lobby").click();
  card.byClass("front-who-go")[0].click();
  card.byClass("front-col")[0].byClass("front-item")[0].click();
  card.byClass("front-col")[1].byClass("front-item")[0].click();
  assert.deepEqual(JSON.parse(JSON.stringify(env.goes)), [
    ["friends-page", { place: "rooms", room: "lobby" }],
    ["friends-page", { place: "rooms", room: "room_jam" }],
    ["friends-page", { place: "rooms", room: "room_jam" }],
    ["friends-page", { place: "hub" }],
  ]);
  assert.equal(card.byClass("front-who")[1].byClass("front-who-go").length, 0, "someone in no named room is not a link");
  card.find("friends-front-play").click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "projects:playProject"), ["projects:playProject", "proj_a"]);
  assert.equal(card.find("friends-front-status").textContent, "Opened in your browser. After two minutes you both earn credits.");
  card.find("friends-front-visible").change(false);
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "setOnlineVisible"), ["setOnlineVisible", false]);
  card.find("friends-front-copy").click();
  await flush();
  assert.match(env.copied[0], /enter KQ7M-2PXD\. https:\/\/mefi-relay\.mefi-studio\.workers\.dev\/join\/KQ7M2PXD$/);
});

test("opening The Lobby recounts what waits in Rooms for the badge, and the masthead says so", async () => {
  const env = environment();
  let recounts = 0;
  env.window.MefiRooms = { recount: async () => { recounts += 1; }, pending: () => 2 };
  const card = env.front.card();
  await flush();
  assert.equal(recounts, 1);
  const waiting = card.find("friends-front-waiting");
  assert.equal(waiting.textContent, "2 waiting for you in Rooms");
  waiting.click();
  assert.deepEqual(JSON.parse(JSON.stringify(env.goes.at(-1))), ["friends-page", { place: "rooms" }]);
  env.window.MefiRooms.pending = () => 0;
  env.push({ type: "credits", delta: 2 });
  await flush();
  assert.equal(card.find("friends-front-waiting"), null, "nothing waiting, no line");
});

test("a quiet week has words for every empty part", async () => {
  const env = environment({ page: front({ online: { count: 0, people: [] }, lobby: { here: 0 }, rooms: [], ownRoom: null, top: null, fresh: [], rankUps: [], you: { balance: 0, lifetime: 0, rank: { key: "spark", name: "Spark", next: { key: "ember", name: "Ember", at: 50 } }, week: { earned: 0, plays: 0, stars: 0 } } }) });
  const card = env.front.card();
  await flush();
  assert.match(card.textContent, /Nobody else is in Studio right now\./);
  assert.match(card.textContent, /Nothing shared yet/);
  assert.match(card.textContent, /No rooms open right now\. Make one in Rooms\./);
  assert.match(card.textContent, /Nothing new this week yet\./);
  assert.match(card.textContent, /Share a project to start earning/);
  assert.equal(card.find("friends-front-lobby").textContent, "Say hi in the Lobby");
  card.find("friends-front-make").click();
  card.find("friends-front-share").click();
  assert.deepEqual(JSON.parse(JSON.stringify(env.goes)), [["friends-page", { place: "rooms" }], ["friends-page", { place: "hub" }]]);
  assert.equal(env.calls.some((call) => call[0] === "roomCode"), false, "no room of your own, no code to ask for");
});

test("it reads again every minute and on credits, connects once when it is not, and stops when let go", async () => {
  let reads = 0;
  const env = environment({ status: { configured: true, linked: true, state: "off", front: true }, page: () => { reads += 1; return front(); } });
  const card = env.front.card();
  await flush();
  assert.deepEqual(env.calls[0], ["connect"], "signed in and not connected: opening The Lobby connects, once");
  assert.equal(reads, 1);
  const minute = env.timers.filter((timer) => timer.ms === 60_000 && !timer.cleared).at(-1);
  assert.ok(minute, "a read a minute from now");
  minute.fired = true;
  minute.fn();
  await flush();
  assert.equal(reads, 2);
  env.push({ type: "credits", delta: 5 });
  await flush();
  assert.equal(reads, 3, "credits earned: the page reads again");
  card.dispose();
  env.push({ type: "credits", delta: 5 });
  await flush();
  assert.equal(reads, 3, "let go: no more reads");
  assert.equal(env.timers.filter((timer) => timer.ms === 60_000 && !timer.cleared && !timer.fired).length, 0, "and no read waiting");
  // A relay without the front page says so.
  const old = environment({ status: { configured: true, linked: true, state: "ready", front: false } });
  const plain = old.front.card();
  await flush();
  assert.equal(plain.dataset.state, "unsupported");
});

test("Rooms shows the same sign-in card when nobody is signed in", async () => {
  const env = environment({ status: { configured: true, linked: false, state: "off" }, extra: roomsSource });
  const rooms = env.window.MefiRooms.panel();
  await flush();
  assert.equal(rooms.dataset.state, "not-linked");
  assert.ok(rooms.find("friends-gate"), "Friends' one sign-in card");
  assert.equal(rooms.find("rooms-link"), null, "instead of its own Link Discord button");
});

test("pop-ups: friends coming online are one toast, invites, requests and plays each say so, and they can be turned off", async () => {
  const env = environment();
  const toasts = [];
  env.window.MefiToast = (text, kind, options) => toasts.push({ text, kind, label: options?.action?.label, run: options?.action?.run });
  env.push({ type: "friendOnline", user: { id: "200000000000000001", name: "Alice" } });
  env.push({ type: "friendOnline", user: { id: "200000000000000002", name: "Bob" } });
  env.push({ type: "friendOnline", user: { id: "200000000000000002", name: "Bob" } });
  assert.equal(toasts.length, 0, "a moment to gather who else is coming online");
  env.timers.find((timer) => timer.ms === 3000).fn();
  assert.deepEqual(toasts.map((toast) => [toast.text, toast.label]), [["Alice and Bob are online", "Say hi"]]);
  toasts[0].run();
  assert.deepEqual(JSON.parse(JSON.stringify(env.goes.at(-1))), ["friends-page", { place: "lobby" }]);
  env.push({ type: "invite", invite: { id: "inv_a", roomId: "room_a", roomName: "Friday jam", invitedBy: { id: "200000000000000001", name: "Alice" }, status: "pending", expiresAt: 1 } });
  env.push({ type: "joinRequest", request: { id: "req_a", roomId: "room_a", requester: { id: "200000000000000002", name: "Bob" }, note: "", status: "pending", createdAt: 1 } });
  env.push({ type: "credits", balance: 50, delta: 5, reason: "played", rank: "ember" });
  env.push({ type: "credits", balance: 53, delta: 3, reason: "starred", rank: "ember" });
  env.push({ type: "credits", balance: 52, delta: 2, reason: "play", rank: "ember" });
  assert.deepEqual(toasts.slice(1).map((toast) => [toast.text, toast.label]), [
    ["Alice invited you to Friday jam", "See the invite"],
    ["Bob asks to join one of your rooms", "See requests"],
    ["Someone played your project: +5 credits", "Project hub"],
    ["Someone starred your project: +3 credits", "Project hub"],
  ], "your own play's credits say so on the Project hub, not as a pop-up");
  env.front.popups.set(false);
  env.push({ type: "credits", balance: 58, delta: 5, reason: "played", rank: "ember" });
  assert.equal(toasts.length, 5, "turned off: nothing");
});

test("Building now: a small tree per friend who shares, and this member's own switch", async () => {
  const people = front().online.people.map((person, n) => (n === 0 ? { ...person, building: { project: "Pixel Forge", running: 3, doneToday: 2 } } : person));
  const env = environment({ page: front({ online: { count: 2, people } }), status: { configured: true, linked: true, state: "ready", user: ME, front: true, shareBuilding: false }, replies: { shareBuilding: (on) => ({ ok: true, shareBuilding: on }) } });
  const card = env.front.card();
  await flush();
  const box = card.byClass("front-building")[0];
  assert.match(box.textContent, /Building nowAlice · Pixel Forge3 running · 2 done today/);
  assert.equal(box.byClass("front-tree-leaf").length, 5, "three lit leaves and two dim ones");
  assert.equal(box.byClass("front-building-item").length, 1, "only friends who share are here");
  const tick = card.find("friends-front-building");
  assert.equal(tick.checked, false, "off until this member turns it on");
  tick.change(true);
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "shareBuilding"), ["shareBuilding", true]);
  assert.equal(card.find("friends-front-status").textContent, "Friends see your project's name and how many tasks run, never what they are.");
  const quiet = environment();
  const plain = quiet.front.card();
  await flush();
  assert.equal(plain.byClass("front-building").length, 0, "nobody sharing: no section");
});

test("main lets the renderer read the front page through hub:room", () => {
  assert.match(main, /const HUB_ROOM_METHODS = Object\.freeze\(\{[^}]*\bfront: 0,/s);
});
