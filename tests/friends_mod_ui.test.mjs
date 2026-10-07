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

function environment({ moderator = true, confirm = true, extraReports = [], packNames = {} } = {}) {
  const calls = [];
  const api = {
    hubStatus: async () => ({ ok: true, status: { state: "ready", credits: true, linked: true } }),
    hubProjects: async (method, ...args) => { calls.push([`projects:${method}`, ...args]); return method === "me" ? { ok: true, moderator } : { ok: true }; },
    hubRoom: async (method, ...args) => {
      calls.push([method, ...args]);
      if (method === "modFlags") return { ok: true, days: 30, flags: [{ ...ALICE, total: 40, why: "one-giver", top: { ...BOB, amount: 30, share: 75, accountCreatedAt: Date.now() - 40 * DAY }, mutual: [] }] };
      if (method === "modReports") return { ok: true, reports: [
        { id: "rep_a", kind: "project", projectId: "proj_a", roomId: null, messageId: null, author: ALICE, reporter: BOB, reason: "Spam or a broken link", text: "One · https://alice.itch.io/one", verified: true, createdAt: 1 },
        { id: "rep_b", kind: "message", projectId: null, roomId: "room_a", messageId: "300000000000000001", author: BOB, reporter: ALICE, reason: "rude", text: "go away", verified: true, createdAt: 2 },
        ...extraReports,
      ] };
      if (method === "modReview") return review;
      if (method === "modRevoke") return { ok: true, revoked: args[1]?.from ? 30 : 40, credits: { balance: 10, lifetime: 90, rank: "ember" } };
      if (method === "searchMembers") return { ok: true, members: [BOB] };
      return { ok: true };
    },
    hubShop: async (method, ...args) => { calls.push([`shop:${method}`, ...JSON.parse(JSON.stringify(args))]); return { ok: true }; },
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
  assert.equal(panel.buttons("Take back 10").length, 0, "a giver who used Forget me cannot be singled out");
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
