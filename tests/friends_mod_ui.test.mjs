import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// renderer/friends-mod.js (Friends › Moderation) in a vm with a tiny DOM and
// a fake bridge: it shows only to a moderator (the relay says who is one in
// me()), lists credits that look farmed and open reports, looks members up,
// and its Review takes credits back and suspends through the relay's admin
// routes, asking first. Then main.cjs's gate and the Friends page's place.

const source = await readFile(new URL("../renderer/friends-mod.js", import.meta.url), "utf8");
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const hubSource = await readFile(new URL("../renderer/companion-hub.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 60; i += 1) await Promise.resolve(); };
const DAY = 86_400_000;

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.className = ""; this.text = ""; this.value = ""; this.id = ""; this.type = ""; this.placeholder = ""; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { for (const child of children) { if (child && typeof child === "object") child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  click() { for (const listener of this.listeners.click ?? []) listener({ type: "click" }); }
  all() { return [this, ...this.children.flatMap((child) => child.all?.() ?? [])]; }
  find(id) { return this.all().find((item) => item.id === id) ?? null; }
  buttons(label) { return this.all().filter((item) => item.tagName === "BUTTON" && item.textContent === label); }
  byClass(name) { return this.all().filter((item) => String(item.className).split(" ").includes(name)); }
}

const ALICE = { id: "200000000000000001", name: "Alice" };
const BOB = { id: "200000000000000002", name: "Bob" };
const review = {
  ok: true,
  member: { ...ALICE, accountCreatedAt: Date.now() - 800 * DAY, joinedAt: Date.now() - 90 * DAY, standing: { ok: true, reason: null, until: null } },
  credits: { balance: 40, lifetime: 120, rank: "ember" }, days: 30, total: 40,
  givers: [{ ...BOB, amount: 30, events: 9, share: 75, accountCreatedAt: Date.now() - 40 * DAY, joinedAt: Date.now() - 8 * DAY }, { id: null, name: "a member who used Forget me", amount: 10, events: 2, share: 25, accountCreatedAt: null, joinedAt: null }],
};

function environment({ moderator = true, confirm = true, extraReports = [], packNames = {}, switches = null, jam = null, flags = null, reviewed = review, holds = null } = {}) {
  const calls = [];
  // The switches a moderator turned off, as the relay keeps them (null: a relay from before the switches).
  let off = switches;
  const api = {
    hubStatus: async () => ({ ok: true, status: { state: "ready", credits: true, linked: true } }),
    hubProjects: async (method, ...args) => { calls.push([`projects:${method}`, ...args]); return method === "me" ? { ok: true, moderator } : { ok: true }; },
    hubRoom: async (method, ...args) => {
      calls.push([method, ...args]);
      if (method === "modFlags") return { ok: true, days: 30, flags: flags ?? [{ ...ALICE, total: 40, why: "one-giver", top: { ...BOB, amount: 30, share: 75, accountCreatedAt: Date.now() - 40 * DAY }, mutual: [] }] };
      if (method === "modSwitches") return off ? { ok: true, off: [...off] } : { ok: false, error: "not-found" };
      if (method === "modSwitch") {
        off = args[1] ? off.filter((key) => key !== args[0]) : [...new Set([...off, args[0]])];
        return { ok: true, off: [...off] };
      }
      if (method === "modJam") return jam ? { ok: true, jam } : { ok: false, error: "not-found" };
      if (method === "modHeld") return holds ? { ok: true, holds, keepDays: 30 } : { ok: false, error: "not-found" };
      if (method === "modHeldDecide") return { ok: true, total: args[2] ? 5 : 10, holds: [] };
      if (method === "modReports") return { ok: true, reports: [
        { id: "rep_a", kind: "project", projectId: "proj_a", roomId: null, messageId: null, author: ALICE, reporter: BOB, reason: "Spam or a broken link", text: "One · https://alice.itch.io/one", verified: true, createdAt: 1 },
        { id: "rep_b", kind: "message", projectId: null, roomId: "room_a", messageId: "300000000000000001", author: BOB, reporter: ALICE, reason: "rude", text: "go away", verified: true, createdAt: 2 },
        ...extraReports,
      ] };
      if (method === "modReview") return reviewed;
      if (method === "modRevoke") return { ok: true, revoked: args[1]?.from ? 30 : 40, credits: { balance: 10, lifetime: 90, rank: "ember" } };
      if (method === "searchMembers") return { ok: true, members: [BOB] };
      return { ok: true };
    },
    hubShop: async (method, ...args) => { calls.push([`shop:${method}`, ...JSON.parse(JSON.stringify(args))]); return { ok: true }; },
    hubEvents: async (method, ...args) => { calls.push([`events:${method}`, ...args]); return { ok: true }; },
  };
  // The Shop's names for packs it has read (renderer/friends-shop.js packName).
  const window = { mefiStudio: api, confirm: () => confirm, MefiShop: { packName: (id) => packNames[id] ?? null } };
  const context = vm.createContext({ window, document: { createElement: (tag) => new Element(tag) }, Date, Number, Array, Set, Map, Promise, JSON, Object, String, Math });
  vm.runInContext(source, context);
  return { window, mod: window.MefiFriendsMod, calls };
}

test("only a moderator sees the tools; everyone else is told what the place is", async () => {
  const member = environment({ moderator: false });
  const card = member.mod.card();
  await flush();
  assert.equal(card.dataset.state, "not-moderator");
  assert.equal(member.mod.isMod(), false);
  assert.equal(member.calls.some((call) => call[0] === "modFlags"), false, "no admin call for a member");
  const env = environment();
  let told = null;
  env.mod.subscribe((value) => { told = value; });
  const modCard = env.mod.card();
  await flush();
  assert.equal(modCard.dataset.state, "ready");
  assert.equal(told, true, "the Friends page hears that this member moderates");
});

test("farming, reports and a review: take back from one giver or all, suspend, resolve, remove", async () => {
  const env = environment();
  const card = env.mod.card();
  await flush();
  const flags = card.find("friends-mod-flags");
  assert.match(flags.textContent, /Alice40 credits in 30 days, 75% from Bob \(Discord account 40 days old\)/);
  flags.buttons("Review")[0].click();
  await flush();
  const panel = card.find("friends-mod-review");
  assert.match(panel.textContent, /Discord account 2 years old · in the server 3 months · 40 credits, 120 lifetime \(Ember\) · Can give and earn credits\./);
  assert.match(panel.textContent, /Bob: 30 credits \(75%\)9 plays or stars · Discord account 40 days old/);
  assert.equal(panel.buttons("Take back 10").length, 0, "a giver who used Forget me cannot be singled out when the relay gives no id for them");
  assert.match(panel.textContent, /a member who used Forget me: 10 credits \(25%\)2 plays or starsTake back all/, "and has no account age to show");
  panel.buttons("Take back 30")[0].click();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.find((call) => call[0] === "modRevoke"))), ["modRevoke", ALICE.id, { from: BOB.id, days: 30 }]);
  assert.equal(card.find("friends-mod-status").textContent, "Took back 30 credits from Bob.");
  card.find("friends-mod-review").buttons("Take back all 40")[0].click();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.filter((call) => call[0] === "modRevoke").at(-1))), ["modRevoke", ALICE.id, { days: 30 }]);
  card.find("friends-mod-review").buttons("Suspend 7 days")[0].click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "modSuspend").at(-1), ["modSuspend", ALICE.id, 10080]);
  card.find("friends-mod-review").buttons("Lift a suspension")[0].click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "modSuspend").at(-1), ["modSuspend", ALICE.id, 0]);

  const reports = card.find("friends-mod-reports");
  assert.match(reports.textContent, /Project: Spam or a broken link“One · https:\/\/alice\.itch\.io\/one” · reported by Bob · by Alice/);
  assert.match(reports.textContent, /Message \(signed copy\): rude“go away” · reported by Alice · by Bob/);
  reports.buttons("Remove project")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "projects:removeProject"), ["projects:removeProject", "proj_a"]);
  assert.deepEqual(env.calls.find((call) => call[0] === "modResolve"), ["modResolve", "rep_a"], "removing it resolves the report");
  card.find("friends-mod-reports").buttons("Suspend Bob for a week")[0].click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "modSuspend").at(-1), ["modSuspend", BOB.id, 10080]);
});

test("a reported Shop style pack is named, and Remove pack takes it out of the Shop (the relay resolves its reports)", async () => {
  const env = environment({
    extraReports: [
      // As hub-client hands a pack report over: kind "shop" with its packId.
      { id: "rep_c", kind: "shop", roomId: "shop", messageId: null, packId: "pack_nightmarket0001", projectId: null, author: BOB, reporter: ALICE, reason: "Copies someone else's work", text: "It is Synthwave renamed.", verified: true, createdAt: 3 },
      { id: "rep_d", kind: "message", roomId: "shop", messageId: null, projectId: null, author: BOB, reporter: ALICE, reason: "Hard to read", text: null, verified: true, createdAt: 4 },
    ],
    packNames: { pack_nightmarket0001: "Night market" },
  });
  const card = env.mod.card();
  await flush();
  const reports = card.find("friends-mod-reports");
  assert.match(reports.textContent, /Style pack “Night market”: Copies someone else's work“It is Synthwave renamed\.” · reported by Alice · by Bob/);
  assert.match(reports.textContent, /Style pack: Hard to readreported by Alice · by Bob/, "a pack report that came without its id still reads as one");
  assert.equal(reports.buttons("Remove pack").length, 1, "Remove pack only where the pack's id came with the report");
  reports.buttons("Remove pack")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "shop:modShopRemove"), ["shop:modShopRemove", "pack_nightmarket0001", { reason: "Copies someone else's work" }]);
  assert.equal(env.calls.some((call) => call[0] === "modResolve"), false, "removing a pack resolves its reports on the relay: no second ask");
  assert.equal(env.calls.filter((call) => call[0] === "modReports").length, 2, "and the reports are read again");
});

test("Remove pack sends a report's long, many-line reason as one line of at most 200 characters", async () => {
  const long = `Copies\nsomeone\telse's work.\r\n${"Really. ".repeat(60)}`;
  const env = environment({
    extraReports: [{ id: "rep_e", kind: "shop", roomId: "shop", messageId: null, packId: "pack_nightmarket0001", projectId: null, author: BOB, reporter: ALICE, reason: long, text: null, verified: true, createdAt: 5 }],
    packNames: { pack_nightmarket0001: "Night market" },
  });
  const card = env.mod.card();
  await flush();
  card.find("friends-mod-reports").buttons("Remove pack")[0].click();
  await flush();
  const [, packId, fields] = env.calls.find((call) => call[0] === "shop:modShopRemove");
  assert.equal(packId, "pack_nightmarket0001");
  assert.ok(fields.reason.length <= 200 && /^[^\x00-\x1f\x7f]+$/.test(fields.reason), `one line the relay takes: ${JSON.stringify(fields.reason)}`);
  assert.ok(fields.reason.startsWith("Copies someone else's work. Really."), fields.reason);
});

test("look someone up by name, then review them; nothing happens without a yes", async () => {
  const env = environment({ confirm: false });
  const card = env.mod.card();
  await flush();
  card.find("friends-mod-search").value = "bo";
  card.find("friends-mod-lookup").click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "searchMembers"), ["searchMembers", "bo"]);
  card.find("friends-mod-people").buttons("Review")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "modReview"), ["modReview", BOB.id]);
  card.find("friends-mod-review").buttons("Take back 30")[0].click();
  await flush();
  assert.equal(env.calls.some((call) => call[0] === "modRevoke"), false, "a no at the question changes nothing");
});

test("main lets the renderer call the moderator methods; the Friends page shows Moderation only to moderators", () => {
  assert.match(main, /modFlags: 0, modReview: 1, modRevoke: 2, modReports: 0, modResolve: 1, modSuspend: 2,/);
  assert.match(hubSource, /\{ id: "mod", label: "Moderation", glyph: "g-flag", about: "[^"]+", modOnly: true \}/);
  assert.match(hubSource, /const shownPlaces = \(\) => FRIENDS_PLACES\.filter\(\(place\) => !place\.modOnly \|\| window\.MefiFriendsMod\?\.isMod\?\.\(\) === true\);/);
});

test("a giver who used Forget me since can still be taken back by the id the relay gives them, and is flagged under no name", async () => {
  const gone = "gone:AbCdEfGhIjKlMnOp";
  const env = environment({
    flags: [{ ...ALICE, total: 35, why: "one-giver", top: { id: null, name: "a member who used Forget me", forgotten: true, amount: 30, share: 86, accountCreatedAt: null }, mutual: [] }],
    reviewed: { ...review, givers: [{ id: gone, forgotten: true, name: "a member who used Forget me", amount: 30, events: 6, share: 86, accountCreatedAt: null, joinedAt: null }] },
  });
  const card = env.mod.card();
  await flush();
  const flags = card.find("friends-mod-flags");
  assert.match(flags.textContent, /Alice35 credits in 30 days, 86% from a member who used Forget me(?!.*Discord account)/, "no account age to show");
  flags.buttons("Review")[0].click();
  await flush();
  const panel = card.find("friends-mod-review");
  assert.match(panel.textContent, /a member who used Forget me: 30 credits \(86%\)6 plays or stars · they used Forget me since/);
  panel.buttons("Take back 30")[0].click();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.find((call) => call[0] === "modRevoke"))), ["modRevoke", ALICE.id, { from: gone, days: 30 }]);
});

test("rewards switch off and back on, and the Build Jam's review: every vote, batches, take a voter or an entry out, pay now or hold", async () => {
  const X0 = { id: "1200000000000000001", name: "X0" }, X1 = { id: "1200000000000000002", name: "X1" };
  const CARA = { id: "200000000000000003", name: "Cara" };
  const facts = (days, batch = null) => ({ accountCreatedAt: Date.now() - days * DAY, joinedAt: Date.now() - 20 * DAY, batch });
  const jam = {
    id: "jam_w3000", theme: "Echoes", status: "review", endsAt: Date.now() - 3_600_000, resultsAt: Date.now() + 20 * 3_600_000, held: false, pool: 450,
    payouts: [{ userId: ALICE.id, name: "Alice", place: 1, amount: 125, why: "place", paid: null, projectId: "proj_a" }],
    entries: [
      { user: { ...ALICE, ...facts(800) }, project: { id: "proj_a", title: "Void Runner", url: "https://alice.itch.io/void-runner", host: "alice.itch.io", kind: "game" }, votes: 3, players: 4, resting: false,
        voters: [{ ...CARA, ...facts(900), counted: true, why: null }] },
      { user: { ...BOB, ...facts(700) }, project: { id: "proj_b", title: "Tiny Farm", url: "https://bob.itch.io/tiny-farm", host: "bob.itch.io", kind: "game" }, votes: 1, players: 3, resting: false,
        voters: [{ ...X0, ...facts(400, "A"), counted: true, why: null }, { ...X1, ...facts(399, "A"), counted: false, why: "same-batch" }] },
    ],
  };
  const env = environment({ switches: ["sales"], jam });
  const card = env.mod.card();
  await flush();
  const panel = card.find("friends-mod-jam");
  assert.match(panel.textContent, /Voting has closed\. The prizes pay by themselves .+ unless you hold them\. A pot of 450 credits\./);
  assert.match(panel.textContent, /A batch letter marks Discord accounts made within 3 days of each other that joined the server within 12 hours of each other/);
  assert.match(panel.textContent, /Void Runner by Alice3 votes count · 4 players · 1st place, 125 credits now/);
  assert.match(panel.textContent, /Tiny Farm by Bob1 vote count \(1 more don't\) · 3 players/);
  assert.match(panel.textContent, /Vote from X1Discord account 13 months old · in the server 20 days · batch A · doesn't count: counted once with accounts made and joined together with it/);
  assert.ok(card.byClass("friends-mod-voter").length === 3, "each vote sits under its entry");
  card.find(`friends-mod-jam-void-${BOB.id}-${X1.id}`).click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "modJamVoid"), ["modJamVoid", "jam_w3000", X1.id]);
  assert.equal(card.find("friends-mod-status").textContent, "X1's votes no longer count in this jam.");
  card.find(`friends-mod-jam-remove-${BOB.id}`).click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "events:removeEntry"), ["events:removeEntry", "jam_w3000", BOB.id]);
  card.find("friends-mod-jam-release").click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "modJamRelease"), ["modJamRelease", "jam_w3000"]);
  card.find("friends-mod-jam-hold").click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "modSwitch"), ["modSwitch", "jam", false], "Hold the prizes switches the jam's prizes off");

  const rewards = card.find("friends-mod-switches");
  assert.match(rewards.textContent, /Plays: onPlaying someone's project pays its maker and the player\./);
  assert.match(rewards.textContent, /Shop sales: off/);
  assert.match(rewards.textContent, /Build Jam prizes: off/, "held a moment ago");
  card.find("friends-mod-switch-sales").click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "modSwitch").at(-1), ["modSwitch", "sales", true]);
  assert.match(card.find("friends-mod-switches").textContent, /Shop sales: on/);
  card.find("friends-mod-switch-plays").click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "modSwitch").at(-1), ["modSwitch", "plays", false]);
  assert.equal(card.find("friends-mod-status").textContent, "Plays is off.");
});

test("a relay from before the switches and the jam's review shows neither part", async () => {
  const env = environment();
  const card = env.mod.card();
  await flush();
  assert.equal(card.find("friends-mod-switches"), null);
  assert.equal(card.find("friends-mod-jam"), null);
  assert.equal(card.find("friends-mod-held"), null, "nor credits on hold");
  assert.equal(card.dataset.state, "ready");
});

test("main lets the renderer call the new moderator methods, and nothing else new", () => {
  assert.match(main, /modSwitches: 0, modSwitch: 2, modJam: 0, modJamVoid: 2, modJamRelease: 1, modHeld: 0, modHeldDecide: 3,/);
});

test("credits on hold: by member and by newcomer, with account ages, Pay or Drop all of it or one newcomer's", async () => {
  const N3 = { id: "200000000000000203", name: "N3" }, N4 = { id: "200000000000000204", name: "N4" };
  const since = Date.now() - 3_600_000;
  const holds = [{ member: ALICE, total: 10, since, dropsAt: since + 30 * DAY, givers: [
    { ...N3, amount: 5, events: 1, accountCreatedAt: Date.now() - 900 * DAY, joinedAt: Date.now() - 10 * DAY },
    { ...N4, amount: 5, events: 1, accountCreatedAt: Date.now() - 900 * DAY, joinedAt: Date.now() - 10 * DAY },
  ] }];
  const env = environment({ holds });
  const card = env.mod.card();
  await flush();
  const panel = card.find("friends-mod-held");
  assert.match(panel.textContent, /When more than 3 members in their first 30 days in the server pay the same member in a week, what the rest would pay waits here\./);
  assert.match(panel.textContent, /Alice: 10 credits on holdfrom 2 newcomers · drops on /);
  assert.match(panel.textContent, /From N3: 5Discord account 2 years old · in the server 10 days · 1 play, stars or sales/);
  assert.equal(card.byClass("friends-mod-voter").length, 2, "each newcomer under the member");
  card.find(`friends-mod-held-pay-${ALICE.id}-${N3.id}`).click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "modHeldDecide"), ["modHeldDecide", ALICE.id, "release", N3.id]);
  assert.equal(card.find("friends-mod-status").textContent, "Paid Alice 5 credits.");
  card.find(`friends-mod-held-drop-${ALICE.id}`).click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "modHeldDecide").at(-1), ["modHeldDecide", ALICE.id, "drop", null]);
  assert.equal(card.find("friends-mod-status").textContent, "Dropped 10 credits held for Alice.");
  const empty = environment({ holds: [] });
  const emptyCard = empty.mod.card();
  await flush();
  assert.match(emptyCard.find("friends-mod-held").textContent, /Nothing is on hold\./);
});
