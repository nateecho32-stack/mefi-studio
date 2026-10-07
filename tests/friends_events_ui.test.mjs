import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// renderer/friends-events.js (Friends › Events) in a vm with a tiny DOM and a
// fake bridge: the week's Build Jam (enter one of your projects, Play, then
// Vote, votes only for what you played), the co-work hour (Join keeps the
// room open; Open the room goes to Rooms), building together (credits come
// from building together, never from inviting), last week's results, and
// today's community pot. Then main.cjs's gate, the preload bridge and the
// Friends place.

const source = await readFile(new URL("../renderer/friends-events.js", import.meta.url), "utf8");
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const preload = (await readFile(new URL("../preload.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const hubSource = (await readFile(new URL("../renderer/companion-hub.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const builder = (await readFile(new URL("../scripts/build-booklet.mjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const flush = async () => { for (let i = 0; i < 80; i += 1) await Promise.resolve(); };
const HOUR = 3_600_000, DAY = 24 * HOUR;

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.className = ""; this.text = ""; this.value = ""; this.id = ""; this.type = ""; this.title = ""; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { for (const child of children) { if (child && typeof child === "object") child.parentElement = this; this.children.push(child); } if (this.tagName === "SELECT" && !this.value && this.children[0]) this.value = this.children[0].value; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  click() { if (this.disabled) return; for (const listener of this.listeners.click ?? []) listener({ type: "click" }); }
  contains(node) { return this.all().includes(node); }
  all() { return [this, ...this.children.flatMap((child) => child.all?.() ?? [])]; }
  find(id) { return this.all().find((item) => item.id === id) ?? null; }
  buttons(label) { return this.all().filter((item) => item.tagName === "BUTTON" && item.textContent === label); }
}

const ALICE = { id: "200000000000000001", name: "Alice" };
const BOB = { id: "200000000000000002", name: "Bob" };
const CARA = { id: "200000000000000003", name: "Cara" };
function eventsPage({ joined = false, entered = false, now = Date.now() } = {}) {
  return {
    ok: true,
    now,
    jam: {
      id: "jam_w2909", theme: "Glow", nextTheme: "Signals", phase: "entries", startsAt: now - DAY, entriesUntil: now + 3 * DAY, endsAt: now + 5 * DAY, pool: 140,
      entries: [
        { user: BOB, project: { id: "proj_bob", title: "Tiny Farm", url: "https://bob.itch.io/tiny-farm", host: "bob.itch.io", kind: "game" }, players: 4, votes: null, mine: false, voted: false, played: true },
        { user: CARA, project: { id: "proj_cara", title: "Glow Worm", url: "https://cara.itch.io/glow", host: "cara.itch.io", kind: "game" }, players: 1, votes: null, mine: false, voted: false, played: false },
        ...(entered ? [{ user: ALICE, project: { id: "proj_a2", title: "Lantern", url: "https://alice.itch.io/lantern", host: "alice.itch.io", kind: "game" }, players: 2, votes: null, mine: true, voted: false, played: false }] : []),
      ],
      you: { entered: entered ? "proj_a2" : null, votesLeft: 3 },
      results: null,
    },
    lastJam: { id: "jam_w2908", theme: "Echoes", endsAt: now - DAY, pool: 120, results: [
      { userId: BOB.id, name: "Bob", place: 1, why: "place", amount: 57, paid: 57, projectId: "proj_bob" },
      { userId: CARA.id, name: "Cara", place: null, why: "showcase", amount: 5, paid: 5, projectId: "proj_cara" },
    ] },
    cowork: { id: "cowork_d20000h18", roomId: "room_hour", startsAt: now - 20 * 60_000, endsAt: now + 40 * 60_000, started: true, joined, here: 3, checks: joined ? 1 : 0, checksDone: 1, checksNeeded: 2, attendees: 0, amount: 4 },
    nextCowork: now + 8 * HOUR,
    together: { ticks: 1, needed: 3, amount: 4, everyMs: 600_000 },
    budget: { budget: 275, paid: 8, left: 267, active: 3 },
  };
}

function environment({ hub = { configured: true, linked: true, state: "ready", events: true }, page = eventsPage(), answers = {}, me = {} } = {}) {
  const calls = [];
  let listener = null;
  const went = [];
  const api = {
    hubStatus: async () => ({ ok: true, status: hub }),
    hubConnect: async () => ({ ok: true }),
    hubEvents: async (method, ...args) => { calls.push([method, ...args]); if (method === "events") return page; return answers[method] ?? { ok: true }; },
    hubProjects: async (method, ...args) => { calls.push([`projects:${method}`, ...args]); return method === "me" ? { ok: true, projects: [{ id: "proj_a1", title: "Void Runner" }, { id: "proj_a2", title: "Lantern" }], canEarn: true, ...me } : { ok: true, minMs: 120000 }; },
    onHubEvent: (fn) => { listener = fn; },
  };
  const window = { mefiStudio: api, MefiNav: { go: (...args) => went.push(args) }, MefiCommunity: { join: async () => calls.push(["community:join"]), check: async () => ({ ok: true }) } };
  const timers = [];
  const context = vm.createContext({
    window, document: { createElement: (tag) => new Element(tag), activeElement: null }, Date, Number, Array, Set, Map, Promise, JSON, Object, String, Math,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearInterval: () => {},
  });
  vm.runInContext(source, context);
  return { window, events: window.MefiFriendsEvents, calls, went, timers, hear: (event) => listener?.(event) };
}

test("signed out, not connected, or a relay without events: the page says so and asks nothing more", async () => {
  const out = environment({ hub: { configured: true, linked: false, state: "off" } });
  const card = out.events.card();
  await flush();
  assert.equal(card.dataset.state, "not-linked");
  assert.match(card.find("friends-events-status").textContent, /Sign in with Discord/);
  const older = environment({ hub: { configured: true, linked: true, state: "ready", events: false } });
  const old = older.events.card();
  await flush();
  assert.equal(old.dataset.state, "unsupported");
  assert.equal(older.calls.length, 0, "nothing is asked of a relay without events");
  const offline = environment({ hub: { configured: true, linked: true, state: "off" } });
  const off = offline.events.card();
  await flush();
  assert.equal(off.buttons("Connect").length, 1);
});

test("the jam: the theme and when it closes, your entry from your own projects, Play then Vote", async () => {
  const env = environment({ answers: { enterEvent: { ok: true }, voteEvent: { ok: true } } });
  const card = env.events.card();
  await flush();
  assert.equal(card.dataset.state, "ready");
  const jam = card.find("friends-events-jam");
  assert.match(jam.textContent, /Build Jam: Glow/);
  assert.match(jam.textContent, /Enter until .*3 days left/);
  assert.match(jam.textContent, /Prize pot so far: 140 credits\. It grows on quiet days and shrinks on busy ones\. Next week's theme: Signals\./);
  const pick = card.find("friends-events-pick");
  assert.deepEqual(pick.children.map((option) => option.textContent), ["Void Runner", "Lantern"]);
  pick.value = "proj_a2";
  for (const listener of pick.listeners.change ?? []) listener({});
  card.find("friends-events-enter").click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "enterEvent"), ["enterEvent", "jam_w2909", "proj_a2"]);
  assert.match(card.find("friends-events-status").textContent, /You are in this week's jam/);

  // Bob's entry was played: Vote works. Cara's was not: Vote waits for a play.
  const entries = card.find("friends-events-entries");
  const votes = entries.buttons("Vote");
  assert.equal(votes.length, 2);
  assert.equal(votes[1].disabled, true, "no vote before a two-minute play");
  assert.equal(votes[1].title, "Play it for two minutes first, then vote.");
  votes[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "voteEvent"), ["voteEvent", "jam_w2909", BOB.id, true]);
  card.find("friends-events-entries").buttons("Play")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "projects:playProject"), ["projects:playProject", "proj_cara"]);
  assert.match(card.find("friends-events-status").textContent, /Play it for two minutes/);
  assert.match(card.find("friends-events-jam").textContent, /3 votes left\. Votes stay hidden until the results, .+, and count only for entries you played\./);
  assert.match(card.find("friends-events-jam").textContent, /Tiny Farm|Glow Worm/);
  assert.match(card.find("friends-events-entries").textContent, /1 player · play it to vote/, "why a vote is locked shows as text, not only as a tooltip");
  assert.equal(card.find(`friends-events-vote-${CARA.id}`).getAttribute("aria-label"), "Vote for Glow Worm by Cara", "each button says which entry it is for");
});

test("an entered member can withdraw; a refusal says why in plain words", async () => {
  const env = environment({ page: eventsPage({ entered: true }), answers: { leaveEvent: { ok: false, error: "conflict", reason: "entries-closed" } } });
  const card = env.events.card();
  await flush();
  assert.match(card.find("friends-events-jam").textContent, /Your entry: Lantern/);
  assert.equal(card.find("friends-events-pick"), null, "no picker once entered");
  assert.equal(card.find("friends-events-entries").buttons("Vote").length, 2, "no vote button on your own entry");
  card.find("friends-events-withdraw").click();
  await flush();
  assert.match(card.find("friends-events-status").textContent, /^Entries are closed\. You can still play and vote until .+\.$/);
});

test("the co-work hour: Join keeps you counted, then Open the room goes to Rooms", async () => {
  const env = environment({ answers: { joinEvent: { ok: true, roomId: "room_hour" } } });
  const card = env.events.card();
  await flush();
  const hour = card.find("friends-events-cowork");
  assert.match(hour.textContent, /On now until .* · 3 members here\./);
  card.find("friends-events-join").click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "joinEvent"), ["joinEvent", "cowork_d20000h18"]);
  const joined = environment({ page: eventsPage({ joined: true }) });
  const joinedCard = joined.events.card();
  await flush();
  assert.match(joinedCard.find("friends-events-cowork").textContent, /You are in\. Keep Studio open, on any page: you are counted at 15, 35 and 55 minutes past the start\. Seen 1 of 2 times needed for 4 credits\./);
  joinedCard.find("friends-events-open-room").click();
  assert.deepEqual(JSON.parse(JSON.stringify(joined.went.at(-1))), ["friends-page", { place: "rooms", room: "room_hour" }]);
});

test("build together explains where credits come from; last week's results and today's pot are plain", async () => {
  const env = environment();
  const card = env.events.card();
  await flush();
  const together = card.find("friends-events-together");
  assert.match(together.textContent, /After about half an hour together you each earn 4 credits, once a day\./);
  assert.match(together.textContent, /Today: 1 of 3 looks together\./);
  assert.match(together.textContent, /Credits come from building together, never from inviting\./);
  card.find("friends-events-to-rooms").click();
  assert.deepEqual(JSON.parse(JSON.stringify(env.went.at(-1))), ["friends-page", { place: "rooms" }]);
  const results = card.find("friends-events-results");
  assert.match(results.textContent, /1st Bob/);
  assert.match(results.textContent, /57 credits/);
  assert.match(results.textContent, /Played by three or more, 5 credits each: Cara\./);
  assert.equal(card.find("friends-events-budget").textContent, "Today the community can still earn 267 credits from co-working (a pot of 200 plus 25 for each of the 3 members active this week). Plays and stars always pay the same.");
  // A reward arrives: the page says what it was for and reads again.
  const before = env.calls.filter((call) => call[0] === "events").length;
  env.hear({ type: "credits", reason: "jam", delta: 57, balance: 100 });
  await flush();
  assert.equal(card.find("friends-events-status").textContent, "+57 credits from the Build Jam.");
  assert.equal(env.calls.filter((call) => call[0] === "events").length, before + 1);
  assert.equal(env.timers.length, 1, "one countdown timer for the page");
  assert.equal(env.timers[0].ms, 60_000, "it moves once a minute, not per frame");
});

test("a member whose votes do not count yet hears why and when, and the locked votes say so", async () => {
  const until = Date.UTC(2026, 9, 14, 12);
  const env = environment({ me: { canEarn: false, hold: { reason: "new-member", until } }, answers: { voteEvent: { ok: false, error: "forbidden", reason: "standing", hold: "new-member" } } });
  const card = env.events.card();
  await flush();
  assert.match(card.find("friends-events-hold").textContent, /^Your votes and credits start a week after you joined the Void Engine server on /);
  const bob = card.find(`friends-events-vote-${BOB.id}`);
  assert.equal(bob.disabled, true, "even a played entry cannot be voted for yet");
  assert.match(bob.title, /start a week after you joined/);
  assert.equal(env.events.holdWords("new-account"), "Your votes and credits start when your Discord account is 30 days old.");
});

test("a moderator can take an entry out of the jam, asked once more first", async () => {
  const env = environment({ page: eventsPage({ entered: true }), me: { moderator: true }, answers: { removeEntry: { ok: true } } });
  const card = env.events.card();
  await flush();
  const removes = card.find("friends-events-entries").buttons("Remove from the jam");
  assert.equal(removes.length, 2, "on the others' entries, not on your own");
  removes[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "removeEntry"), ["removeEntry", "jam_w2909", BOB.id]);
  assert.equal(card.find("friends-events-status").textContent, "Tiny Farm is out of the jam.");
  const member = environment();
  const plain = member.events.card();
  await flush();
  assert.equal(plain.find("friends-events-entries").buttons("Remove from the jam").length, 0, "members never see it");
});

test("a connection problem names the one thing to do: join the server, update Studio, or sign in again", async () => {
  const notMember = environment({ hub: { configured: true, linked: true, state: "error", error: "not-member" } });
  const outside = notMember.events.card();
  await flush();
  assert.equal(outside.dataset.state, "not-member");
  assert.equal(outside.buttons("Join the Discord").length, 1);
  assert.equal(outside.buttons("Connect").length, 0, "Connect cannot fix this, so it is not offered");
  const old = environment({ hub: { configured: true, linked: true, state: "error", error: "version" } });
  const update = old.events.card();
  await flush();
  assert.equal(update.find("friends-events-status").textContent, "This Studio is older than the room service. Update Studio to join events.");
  const expired = environment({ hub: { configured: true, linked: true, state: "error", error: "auth" } });
  const again = expired.events.card();
  await flush();
  assert.equal(again.dataset.state, "signed-out");
  assert.match(again.find("friends-events-status").textContent, /Your Discord sign-in has run out\. Sign in again to join events\. Sign in with Discord in Friends\./);
});

test("a partial answer still draws, and countdowns read in whole days, hours or minutes", async () => {
  const env = environment({ page: { ok: true } });
  const card = env.events.card();
  await flush();
  assert.match(card.find("friends-events-jam").textContent, /not open yet/);
  assert.match(card.find("friends-events-together").textContent, /each earn 4 credits/);
  const { timeLeft } = env.events;
  assert.equal(timeLeft(1000 + 3 * DAY + 5, 1000), "3 days");
  assert.equal(timeLeft(1000 + 5 * HOUR, 1000), "5 hours");
  assert.equal(timeLeft(1000 + 90 * 60_000, 1000), "90 minutes");
  assert.equal(timeLeft(1000, 5000), "1 minute");
});

test("main lets the renderer call only the event methods; the bridge, the place and the bundle know the page", () => {
  assert.match(main, /const HUB_EVENT_METHODS = Object\.freeze\(\{ events: 0, enterEvent: 2, leaveEvent: 1, voteEvent: 3, joinEvent: 1, removeEntry: 2 \}\);/);
  assert.match(main, /ipcMain\.handle\("hub:events", async \(_event, payload\) => hubEvents\(String\(payload\?\.method \?\? ""\), Array\.isArray\(payload\?\.args\) \? payload\.args : \[\]\)\);/);
  assert.doesNotMatch(main, /client\.subscribe\(joined\.roomId/, "joining a co-work hour holds no room: the relay counts members who are connected");
  assert.match(preload, /hubEvents: \(method, \.\.\.args\) => ipcRenderer\.invoke\("hub:events"/);
  assert.match(hubSource, /\{ id: "events", label: "Events", glyph: "g-bolt"/);
  assert.match(hubSource, /else if \(place\.id === "events"\) card = window\.MefiFriendsEvents\?\.card\?\.\(\);/);
  assert.match(builder, /"friends-events\.js",/);
  assert.match(builder, /"friends-events\.css",/);
  assert.ok(!/innerHTML/.test(source), "text only, never markup");
});

test("while a closed jam waits for a moderator's look, the page says when its results come; a vote taken out says why", async () => {
  const now = Date.now();
  const page = { ...eventsPage({ now }), reviewing: { id: "jam_w2908b", theme: "Glow", resultsAt: now + 20 * HOUR } };
  page.jam = { ...page.jam, resultsAt: page.jam.endsAt + DAY };
  const env = environment({ page, answers: { voteEvent: { ok: false, error: "forbidden", reason: "barred" } } });
  const card = env.events.card();
  await flush();
  const results = card.find("friends-events-results");
  assert.match(results.textContent, /Glow: voting has closed\. The results come .+, after a moderator's look\./);
  assert.match(results.textContent, /1st Bob/, "the jam before keeps its results under it");
  assert.match(card.find("friends-events-jam").textContent, /Votes stay hidden until the results, .+, and count only for entries you played\./);
  card.find(`friends-events-vote-${BOB.id}`).click();
  await flush();
  assert.equal(card.find("friends-events-status").textContent, "A moderator took your votes out of this jam.");

  const held = environment({ page: { ...eventsPage({ now }), lastJam: null, reviewing: { id: "jam_w2908b", theme: "Glow", resultsAt: null } } });
  const heldCard = held.events.card();
  await flush();
  assert.match(heldCard.find("friends-events-results").textContent, /Glow: voting has closed\. A moderator is looking at the results before they come\./, "a held jam promises no time");
});
