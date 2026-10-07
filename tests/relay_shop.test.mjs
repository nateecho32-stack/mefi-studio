import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { GUARD, createCredits } from "../relay/src/credits.mjs";
import { CREDIT_REASONS, FEATURES } from "../relay/src/protocol.mjs";
import { CATALOG, ITEM_KINDS, PACK_ID, SHOP, createShop } from "../relay/src/shop.mjs";
import { saleOf } from "../relay/src/shop-drops.mjs";
import { MIGRATIONS, SCHEMA_VERSION, createStore } from "../relay/src/store.mjs";
import { hmacKey, randomBytes } from "../relay/src/util.mjs";
import { ALICE, BOB, CARA, MOD, makeRelay, member, connectAll, rawSocket, until } from "./fixtures/relay-harness.mjs";

// The Shop on the relay (relay/src/shop.mjs): Studio's own items and members'
// style packs, got with credits. A purchase is one transaction that never
// writes a negative credit row; a pack's maker earns 75% of its price only
// through credits.sale(), with both in good standing, at most 100 from one
// buyer in 7 days and 300 a day. Then publishing's checks and limits,
// reports and moderators, Forget me, the v6 migration, and Studio's own
// client against all of it.

const DAY = 86_400_000;
// An hour into a UTC day, so a test's few minutes never cross midnight by accident.
const morning = () => Math.floor(Date.now() / DAY) * DAY + 3_600_000;
// A Discord id made `daysAgo` days ago (a snowflake carries its own time).
const idFrom = (daysAgo, n = 1) => (((BigInt(Date.now() - daysAgo * DAY) - 1_420_070_400_000n) << 22n) + BigInt(n)).toString();
const FRESH = { id: idFrom(5), username: "fresh", global_name: "Fresh" };
const DAN = { id: "200000000000000021", username: "dan", global_name: "Dan" };
const EVE = { id: "200000000000000022", username: "eve", global_name: "Eve" };
const MORE = { "tok-fresh": { user: FRESH }, "tok-dan": { user: DAN }, "tok-eve": { user: EVE } };
const PACK = { v: 1, palette: { accent: "#4f8cff", background: "#0b0f17", surface: "#151b26", text: "#e8eef7" } };

function api(relay) {
  const tokens = new Map();
  async function as(token, method, path, body, retried = false) {
    if (!tokens.has(token)) {
      const answer = await relay.fetch("http://127.0.0.1:8787/v1/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: token }) });
      tokens.set(token, (await answer.json()).session);
    }
    const headers = { authorization: `Bearer ${tokens.get(token)}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const answer = await relay.fetch(`http://127.0.0.1:8787${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    // A session lasts 15 minutes; after the test's clock jumps, sign in again as Studio does.
    if (answer.status === 401 && !retried) {
      tokens.delete(token);
      return as(token, method, path, body, true);
    }
    return { status: answer.status, ...(await answer.json()) };
  }
  return as;
}

/** Credits for a member, as if earned. */
const give = (relay, uid, amount) => relay.sql("INSERT INTO accounts (user_id, balance, lifetime) VALUES (?1, ?2, ?2) ON CONFLICT (user_id) DO UPDATE SET balance = ?2, lifetime = ?2", uid, amount);
const balanceOf = (relay, uid) => relay.sql("SELECT balance FROM accounts WHERE user_id = ?", uid)[0]?.balance ?? 0;
const publish = (as, token, fields) => as(token, "POST", "/v1/shop/packs", { name: "Neon night", price: 0, data: PACK, ...fields });

/** The store's SQL port over a node:sqlite database, as relay/node/adapter.mjs gives it. */
const sqlPort = (db) => ({
  exec: (query, ...bindings) => db.prepare(query).all(...bindings),
  transaction: (fn) => {
    db.exec("BEGIN");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },
});
const studioItem = (id) => CATALOG.find((item) => item.id === id);

/** A member with Studio connected, hearing their credits frames. */
async function connected(relay, token) {
  const raw = await rawSocket(relay, token);
  raw.send({ type: "hello", session: raw.session, protocol: 1 });
  await until(() => raw.of("ready").length, `${token} ready`);
  return raw;
}

test("the Studio catalog: every item in code with its drop (Ember is free, so not sold), the list is what is on sale that day, the packs with their data, nothing owned yet", async () => {
  const clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const shop = await as("tok-alice", "GET", "/v1/shop?view=studio");
  assert.equal(shop.status, 200);
  // The catalog in code, in order: classic items (always on sale) and October's drop, "2026-10" (shop-drops.mjs).
  assert.deepEqual(CATALOG.map((item) => [item.id, item.kind, item.name, item.price, item.requires, item.drop]), [
    ["studio:skin-frost", "skin", "Frost scales", 40, null, null],
    ["studio:skin-jade", "skin", "Jade scales", 40, null, null],
    ["studio:skin-void", "skin", "Void scales", 60, null, null],
    ["studio:skin-gold", "skin", "Gold scales", 60, null, null],
    ["studio:pet-cloud", "pet", "Cloud dragon", 120, null, null],
    ["studio:pet-phoenix", "pet", "Phoenix", 150, null, null],
    ["studio:pet-wisp", "pet", "Will-o'-wisp", 90, null, "2026-10"],
    ["studio:fx-dissolve", "effect", "Dissolve", 60, null, null],
    ["studio:fx-embers", "effect", "Burn away", 90, null, null],
    ["studio:fx-stardust", "effect", "Stardust", 90, null, null],
    ["studio:fx-wind", "effect", "Blown away", 60, null, null],
    ["studio:fx-shatter", "effect", "Shatter", 90, null, null],
    ["studio:fx-glitch", "effect", "Glitch", 60, null, null],
    ["studio:fx-spirits", "effect", "Spirits", 90, null, "2026-10"],
    ["studio:style-dragonscale", "nodestyle", "Dragon scales", 80, null, null],
    ["studio:style-constellation", "nodestyle", "Star chart", 80, null, null],
    ["studio:style-lantern", "nodestyle", "Lanterns", 80, null, "2026-10"],
    ["studio:style-neon", "nodestyle", "Neon", 80, null, null],
    ["studio:pack-synthwave", "pack", "Synthwave", 50, null, null],
    ["studio:pack-deep-sea", "pack", "Deep sea", 50, null, null],
    ["studio:pack-sakura", "pack", "Sakura (light)", 50, null, null],
    ["studio:pack-pumpkin-spice", "pack", "Pumpkin Spice", 45, null, "2026-10"],
    ["studio:pack-haunted", "pack", "Haunted", 50, null, "2026-10"],
    ["studio:pack-candlelight", "pack", "Candlelight (light)", 45, null, "2026-10"],
    ["studio:pack-midnight-neon", "pack", "Midnight Neon", 50, null, null],
    ["studio:pack-forest-glade", "pack", "Forest Glade", 40, null, null],
    ["studio:pack-ocean-breeze", "pack", "Ocean Breeze (light)", 40, null, null],
    ["studio:pack-rose-gold", "pack", "Rose Gold (light)", 45, null, null],
    ["studio:pack-frost", "pack", "Frost", 40, null, null],
  ]);
  // The day's list: every classic item and the items of the drop on sale that day, in catalog order.
  const onSale = CATALOG.filter((item) => saleOf(item, clock).available).map((item) => item.id);
  assert.ok(CATALOG.filter((item) => !item.drop).every((item) => onSale.includes(item.id)), "classic items are always on sale");
  assert.deepEqual(shop.items.map((item) => item.id), onSale);
  for (const item of shop.items) {
    assert.deepEqual([item.owned, item.maker, item.status, item.sales], [false, null, "listed", 0], item.id);
    assert.equal(item.data === null, item.kind !== "pack", `${item.id}: only packs carry data`);
    assert.ok(item.blurb.endsWith("."), item.id);
  }
  assert.deepEqual(shop.items.map((item) => item.blurb).slice(0, 4), ["Ember in icy blue.", "Ember in green and gold.", "Ember in black with a violet glow.", "Ember in shining gold."]);
  assert.deepEqual(CATALOG.filter((item) => item.kind === "nodestyle").map((item) => item.blurb), ["Nodes covered in shimmering dragon scales, with ember sparks along the wires.", "Nodes as bright stars joined by star-chart lines, with shooting stars.", "Glowing paper lanterns that sway, their warm light flickering at work.", "Bright neon tubes with a soft glow that buzz on when work starts."], "the node styles, sold like the other Studio items (no data, no tip)");
  assert.deepEqual([...ITEM_KINDS], ["pet", "skin", "effect", "nodestyle", "pack"]);
  assert.ok(!shop.items.some((item) => item.id === "studio:pet-dragon"), "Ember the dragon is free in every Studio");
  assert.deepEqual(shop.items.find((item) => item.id === "studio:pack-sakura").data, { v: 1, palette: { accent: "#b8325f", background: "#fbf6f4", surface: "#ffffff", text: "#2b1f24", accent2: "#8a6bd1" }, nodeStyle: "minimal", material: "focus", font: "studio" });
  assert.deepEqual([shop.view, shop.next, shop.balance, shop.canEarn, shop.hold], ["studio", null, 0, true, null]);
  assert.equal((await as("tok-alice", "GET", "/v1/shop")).items.length, onSale.length, "the catalog on sale is the default list");
  assert.equal((await as("tok-alice", "GET", "/v1/shop?view=everything")).status, 400);
  assert.equal((await as("tok-newbie", "GET", "/v1/shop")).hold.reason, "new-member", "the list says why a member cannot earn yet");
  assert.ok(Object.isFrozen(CATALOG) && CATALOG.every((item) => Object.isFrozen(item)), "the catalog is fixed in code");
  assert.equal(FEATURES.shop, "shop");
  assert.ok(CREDIT_REASONS.includes("shop") && CREDIT_REASONS.includes("sale"));
});

test("buying a Studio item takes the credits in one go, owns it on every PC, and says why the balance moved", async () => {
  const clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const studio = await connected(relay, "tok-alice");
  give(relay, ALICE.id, 200);
  const bought = await as("tok-alice", "POST", "/v1/shop/studio:fx-embers/buy", { price: 90 });
  assert.equal(bought.status, 200, JSON.stringify(bought));
  assert.deepEqual([bought.balance, bought.item.id, bought.item.owned, bought.item.sales], [110, "studio:fx-embers", true, 1]);
  const frame = await until(() => studio.of("credits").find((item) => item.reason === "shop"), "the credits frame");
  assert.deepEqual([frame.delta, frame.balance, frame.lifetime], [-90, 110, 200], "spent off the balance, never the lifetime total (a rank never drops)");
  const owned = await as("tok-alice", "GET", "/v1/shop/owned");
  assert.deepEqual(owned.items, [{ id: "studio:fx-embers", kind: "effect", name: "Burn away", data: null, updatedAt: studioItem("studio:fx-embers").at }]);
  assert.equal((await as("tok-alice", "GET", "/v1/shop?view=studio")).items.find((item) => item.id === "studio:fx-embers").owned, true);
  const again = await as("tok-alice", "POST", "/v1/shop/studio:fx-embers/buy", { price: 90 });
  assert.deepEqual([again.status, again.error], [409, "owned"]);
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM credit_events")[0].n, 0, "a purchase is kept as what it bought, never as a credit row");
  assert.deepEqual(relay.sql("SELECT user_id, item_id, price, at FROM shop_owned").map((row) => ({ ...row })), [{ user_id: ALICE.id, item_id: "studio:fx-embers", price: 90, at: clock }]);
  assert.equal(balanceOf(relay, ALICE.id), 110);
  studio.socket.close();
});

test("a node style is bought like any Studio item: its price, no tip, owned on every PC with no data", async () => {
  const clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  give(relay, ALICE.id, 100);
  const tipped = await as("tok-alice", "POST", "/v1/shop/studio:style-constellation/buy", { price: 80, tip: 5 });
  assert.deepEqual([tipped.status, tipped.error], [400, "no-tip"], "Studio's own items have nobody to thank");
  const bought = await as("tok-alice", "POST", "/v1/shop/studio:style-constellation/buy", { price: 80 });
  assert.equal(bought.status, 200, JSON.stringify(bought));
  assert.deepEqual([bought.balance, bought.item.kind, bought.item.owned, bought.item.data], [20, "nodestyle", true, null]);
  assert.deepEqual((await as("tok-alice", "GET", "/v1/shop/owned")).items, [{ id: "studio:style-constellation", kind: "nodestyle", name: "Star chart", data: null, updatedAt: studioItem("studio:style-constellation").at }]);
  const short = await as("tok-alice", "POST", "/v1/shop/studio:style-dragonscale/buy", { price: 80 });
  assert.deepEqual([short.status, short.error, short.balance, short.price], [409, "short", 20, 80]);
});

test("a purchase is refused, and nothing moves, when the price changed or the balance is short", async () => {
  const clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  give(relay, BOB.id, 30);
  const changed = await as("tok-bob", "POST", "/v1/shop/studio:fx-dissolve/buy", { price: 50 });
  assert.deepEqual([changed.status, changed.error, changed.price], [409, "price-changed", 60]);
  const short = await as("tok-bob", "POST", "/v1/shop/studio:fx-dissolve/buy", { price: 60 });
  assert.deepEqual([short.status, short.error, short.balance, short.price], [409, "short", 30, 60]);
  assert.deepEqual([(await as("tok-bob", "POST", "/v1/shop/studio:not-a-thing/buy", { price: 1 })).error, (await as("tok-bob", "POST", "/v1/shop/pack_AAAAAAAAAAAAAAAA/buy", { price: 1 })).error], ["gone", "gone"]);
  assert.equal((await as("tok-bob", "POST", "/v1/shop/studio:pet-dragon/buy", { price: 150 })).error, "gone", "Ember is free in every Studio, so not for sale");
  assert.equal((await as("tok-bob", "POST", "/v1/shop/studio:skin-frost/buy", {})).status, 400, "the price the member was shown is required");
  assert.equal((await as("tok-bob", "POST", "/v1/shop/studio:skin-frost/buy", { price: "40" })).status, 400);
  assert.equal((await as("tok-bob", "POST", "/v1/shop/Studio:Pet/buy", { price: 1 })).status, 404, "an id of neither shape matches no route");
  assert.equal(balanceOf(relay, BOB.id), 30);
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM shop_owned")[0].n, 0);
  // Scales need nothing first: Ember is already in every Studio.
  give(relay, BOB.id, 100);
  assert.equal((await as("tok-bob", "POST", "/v1/shop/studio:skin-frost/buy", { price: 40 })).balance, 60);
});

test("an item may need another first: the refusal names it, and once that one is owned the purchase goes through", async () => {
  // Nothing sold today needs anything first (Ember is free), so this Shop gets a catalog of its own.
  assert.equal(CATALOG.filter((item) => item.requires).length, 0);
  const clock = morning();
  const db = new DatabaseSync(":memory:");
  const store = createStore(sqlPort(db));
  store.migrate();
  const member = (uid) => ({ id: uid, name: "Alice", roleKeys: [], isMod: false, readOnly: false, joinedAt: clock - 30 * DAY });
  const credits = createCredits({ store, now: () => clock, key: await hmacKey(randomBytes(32)), sendToUser: () => {}, member });
  const hat = Object.freeze({ id: "studio:hat-party", kind: "skin", name: "Party hat", price: 20, requires: "studio:fx-embers", blurb: "A hat for Ember.", data: null, at: 1 });
  const shop = createShop({ store, now: () => clock, credits, catalog: [...CATALOG, hat] });
  const routes = [];
  shop.routes((method, pattern, handler, options) => routes.push({ method, pattern, handler, options }));
  const buy = routes.find((entry) => entry.method === "POST" && entry.pattern === "/v1/shop/:id/buy").handler;
  store.run("INSERT INTO accounts (user_id, balance, lifetime) VALUES (?, 200, 200)", ALICE.id);
  const actor = { uid: ALICE.id };
  const first = await buy({ actor, params: { id: hat.id }, body: { price: 20 } });
  assert.deepEqual([first.status, first.body.error, first.body.needs], [409, "needs", "studio:fx-embers"]);
  assert.equal(credits.account(ALICE.id).balance, 200, "nothing moved");
  assert.equal((await buy({ actor, params: { id: "studio:fx-embers" }, body: { price: 90 } })).status, 200);
  const second = await buy({ actor, params: { id: hat.id }, body: { price: 20 } });
  assert.deepEqual([second.status, second.body.item.owned, second.body.item.requires, second.body.balance], [200, true, "studio:fx-embers", 90]);
  db.close();
});

test("a community pack: its maker owns it and cannot buy it; a buyer pays and the maker earns 75% when both are in good standing", async () => {
  const clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const studio = await connected(relay, "tok-alice");
  const made = await publish(as, "tok-alice", { name: "Neon night", blurb: "Blue on black", price: 100 });
  assert.equal(made.status, 201, JSON.stringify(made));
  const pack = made.pack;
  assert.match(pack.id, PACK_ID);
  assert.deepEqual([pack.kind, pack.name, pack.blurb, pack.price, pack.owned, pack.sales, pack.status, pack.requires], ["pack", "Neon night", "Blue on black", 100, true, 0, "listed", null]);
  assert.deepEqual(pack.maker, { id: ALICE.id, name: "Alice" });
  assert.deepEqual(pack.data, PACK);
  const own = await as("tok-alice", "POST", `/v1/shop/${pack.id}/buy`, { price: 100 });
  assert.deepEqual([own.status, own.error], [409, "own"]);

  give(relay, BOB.id, 120);
  const bought = await as("tok-bob", "POST", `/v1/shop/${pack.id}/buy`, { price: 100 });
  assert.deepEqual([bought.balance, bought.item.owned, bought.item.sales], [20, true, 1]);
  const sale = await until(() => studio.of("credits").find((frame) => frame.reason === "sale"), "the maker hears the sale");
  assert.deepEqual([sale.delta, sale.balance], [Math.floor(100 * SHOP.makerShare), 75]);
  assert.deepEqual(relay.sql("SELECT actor_id, target_id, kind, uniq, ref, amount FROM credit_events").map((row) => ({ ...row })), [{ actor_id: BOB.id, target_id: ALICE.id, kind: "sale", uniq: pack.id, ref: pack.id, amount: 75 }]);
  const me = await as("tok-alice", "GET", "/v1/me");
  assert.deepEqual([me.credits.balance, me.credits.lifetime, me.credits.today], [75, 75, 0], "a sale stays outside the day's earning cap");
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM credit_events WHERE amount < 0")[0].n, 0);
  assert.deepEqual((await as("tok-bob", "GET", "/v1/shop?view=owned")).items.map((item) => [item.id, item.owned]), [[pack.id, true]]);
  assert.deepEqual((await as("tok-alice", "GET", "/v1/shop?view=owned")).items.map((item) => item.id), [pack.id], "a maker owns their packs without buying them");
  assert.deepEqual((await as("tok-cara", "GET", "/v1/shop?view=new")).items.map((item) => [item.id, item.owned, item.sales]), [[pack.id, false, 1]]);
  studio.socket.close();
});

test("one buyer is worth at most 100 credits to one maker in 7 days, however many packs they buy", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const ids = [];
  for (const name of ["Dawn", "Dusk", "Noon"]) ids.push((await publish(as, "tok-alice", { name, price: 100 })).pack.id);
  give(relay, BOB.id, 1000);
  for (const id of ids) assert.equal((await as("tok-bob", "POST", `/v1/shop/${id}/buy`, { price: 100 })).status, 200);
  assert.deepEqual(relay.sql(`SELECT amount FROM credit_events WHERE kind = 'sale' ORDER BY id`).map((row) => row.amount), [75, 25], "75, then what is left of the 100, then nothing");
  assert.equal(balanceOf(relay, ALICE.id), GUARD.salePairWeek);
  assert.equal(balanceOf(relay, BOB.id), 700, "the buyer still pays every price in full: the rest is nobody's");
  clock += 7 * DAY + 1;
  const later = (await publish(as, "tok-alice", { name: "Midnight", price: 100 })).pack.id;
  await as("tok-bob", "POST", `/v1/shop/${later}/buy`, { price: 100 });
  assert.equal(balanceOf(relay, ALICE.id), 175, "a week on, the same buyer counts again");
});

test("no payout when the maker or the buyer may not earn; the purchase itself still goes through", async () => {
  const clock = morning();
  const relay = makeRelay({ now: () => clock, discord: MORE });
  const as = api(relay);
  const held = (await publish(as, "tok-alice", { name: "Held", price: 50 })).pack.id;
  relay.sql("UPDATE members SET suspended_until = ? WHERE user_id = ?", clock + DAY, ALICE.id);
  give(relay, BOB.id, 50);
  const bought = await as("tok-bob", "POST", `/v1/shop/${held}/buy`, { price: 50 });
  assert.deepEqual([bought.status, bought.balance, bought.item.sales], [200, 0, 1]);
  assert.equal(balanceOf(relay, ALICE.id), 0, "a suspended maker earns nothing from a sale");
  // A buyer whose Discord account is five days old: they may buy, and the maker earns nothing from them.
  const cara = (await publish(as, "tok-cara", { name: "Glow", price: 40 })).pack.id;
  give(relay, FRESH.id, 100);
  assert.equal((await as("tok-fresh", "POST", `/v1/shop/${cara}/buy`, { price: 40 })).balance, 60);
  assert.equal(balanceOf(relay, CARA.id), 0);
  assert.equal(relay.sql(`SELECT COUNT(*) AS n FROM credit_events WHERE kind = 'sale'`)[0].n, 0, "nothing paid, so nothing kept");
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM shop_owned")[0].n, 2);
});

test("a maker earns at most 300 credits a day from sales", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock, discord: MORE });
  const as = api(relay);
  const pack = (await publish(as, "tok-alice", { name: "Gold leaf", price: 250 })).pack.id;
  const paid = [];
  for (const [token, uid] of [["tok-bob", BOB.id], ["tok-cara", CARA.id], ["tok-mod", MOD.id], ["tok-dan", DAN.id], ["tok-eve", EVE.id]]) {
    give(relay, uid, 250);
    const before = balanceOf(relay, ALICE.id);
    assert.equal((await as(token, "POST", `/v1/shop/${pack}/buy`, { price: 250 })).status, 200);
    paid.push(balanceOf(relay, ALICE.id) - before);
  }
  assert.deepEqual(paid, [100, 100, 100, 0, 0], "each buyer pays her 100 at most (75% of 250 is 187), and the day stops at 300");
  clock += DAY;
  const next = (await publish(as, "tok-alice", { name: "Gold dust", price: 250 })).pack.id;
  give(relay, DAN.id, 250);
  await as("tok-dan", "POST", `/v1/shop/${next}/buy`, { price: 250 });
  assert.equal(balanceOf(relay, ALICE.id), 400, "a new day pays again, from a buyer who paid her nothing yesterday");
});

test("a free pack is a Get: owned and counted, and no credits move", async () => {
  const clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const pack = (await publish(as, "tok-alice", { name: "Paper", price: 0 })).pack.id;
  const studio = await connected(relay, "tok-bob");
  const got = await as("tok-bob", "POST", `/v1/shop/${pack}/buy`, { price: 0 });
  assert.deepEqual([got.status, got.balance, got.item.owned, got.item.sales, got.item.price], [200, 0, true, 1, 0]);
  assert.deepEqual([(await as("tok-bob", "POST", `/v1/shop/${pack}/buy`, { price: 0 })).error, (await as("tok-cara", "POST", `/v1/shop/${pack}/buy`, { price: 10 })).error], ["owned", "price-changed"]);
  assert.deepEqual(relay.sql("SELECT price FROM shop_owned WHERE user_id = ?", BOB.id).map((row) => row.price), [0]);
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM credit_events")[0].n, 0);
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM accounts")[0].n, 0, "no balance was even touched");
  assert.equal(studio.of("credits").length, 0, "nothing moved, so nothing to tell");
  studio.socket.close();
});

test("tips: up to 100 credits for a pack's maker, a free pack too; the maker's 75% counts them under the same caps, and the balance must cover them", async () => {
  const clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const maker = await connected(relay, "tok-alice");
  const buyer = await connected(relay, "tok-bob");
  const free = (await publish(as, "tok-alice", { name: "Thanks" })).pack.id;
  give(relay, BOB.id, 300);
  // Studio's own items have nobody to thank, and a tip is a whole number up to 100.
  const studioTip = await as("tok-bob", "POST", "/v1/shop/studio:fx-embers/buy", { price: 90, tip: 5 });
  assert.deepEqual([studioTip.status, studioTip.error], [400, "no-tip"]);
  for (const tip of [101, -1, 2.5, "5"]) assert.equal((await as("tok-bob", "POST", `/v1/shop/${free}/buy`, { price: 0, tip })).status, 400, `tip ${tip}`);
  assert.deepEqual([balanceOf(relay, BOB.id), relay.sql("SELECT COUNT(*) AS n FROM shop_owned")[0].n], [300, 0], "nothing moved");

  // A free pack with a tip: the buyer pays the tip, and its maker earns 75% of it.
  const tipped = await as("tok-bob", "POST", `/v1/shop/${free}/buy`, { price: 0, tip: 20 });
  assert.deepEqual([tipped.status, tipped.paid, tipped.balance, tipped.item.owned, tipped.item.sales], [200, 20, 280, true, 1]);
  assert.equal(balanceOf(relay, ALICE.id), 15);
  assert.equal((await until(() => buyer.of("credits").find((frame) => frame.reason === "shop"), "the buyer's frame")).delta, -20);
  assert.equal((await until(() => maker.of("credits").find((frame) => frame.reason === "sale"), "the maker's frame")).delta, 15);
  assert.equal(relay.sql("SELECT price FROM shop_owned WHERE user_id = ? AND item_id = ?", BOB.id, free)[0].price, 20, "what the member paid, the tip included");

  // The balance must cover the price and the tip together.
  const priced = (await publish(as, "tok-alice", { name: "Neon", price: 100 })).pack.id;
  give(relay, BOB.id, 150);
  const short = await as("tok-bob", "POST", `/v1/shop/${priced}/buy`, { price: 100, tip: 60 });
  assert.deepEqual([short.status, short.error, short.balance, short.price, short.tip], [409, "short", 150, 100, 60]);
  assert.equal(balanceOf(relay, BOB.id), 150);
  // The pair cap counts tips: 15 already this week, and 75% of 150 asks for more than the 85 left.
  const paid = await as("tok-bob", "POST", `/v1/shop/${priced}/buy`, { price: 100, tip: 50 });
  assert.deepEqual([paid.status, paid.paid, paid.balance], [200, 150, 0]);
  assert.equal(balanceOf(relay, ALICE.id), GUARD.salePairWeek, "15 + 85: one buyer is worth 100 to one maker in 7 days, tips and all");
  const third = (await publish(as, "tok-alice", { name: "Dusk" })).pack.id;
  give(relay, BOB.id, 40);
  assert.equal((await as("tok-bob", "POST", `/v1/shop/${third}/buy`, { price: 0, tip: 40 })).paid, 40);
  assert.equal(balanceOf(relay, ALICE.id), GUARD.salePairWeek, "a tip past the cap is nobody's");
  assert.deepEqual(relay.sql(`SELECT amount FROM credit_events WHERE kind = 'sale' ORDER BY id`).map((row) => row.amount), [15, 85]);
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM credit_events WHERE amount < 0")[0].n, 0);
  maker.socket.close();
  buyer.socket.close();
});

test("publishing checks the pack, the name and the price, and a priced pack needs a maker who may earn", async () => {
  const clock = morning();
  const relay = makeRelay({ now: () => clock, discord: MORE });
  const as = api(relay);
  const refusal = async (fields, token = "tok-alice") => {
    const answer = await publish(as, token, fields);
    return [answer.status, answer.error, answer.reason ?? null];
  };
  assert.deepEqual(await refusal({ data: { v: 1, palette: { ...PACK.palette, text: "white" } } }), [400, "bad-pack", null]);
  assert.deepEqual(await refusal({ data: { ...PACK, css: "body{background:url(https://example.com/x.png)}" } }), [400, "bad-pack", null], "a key the schema does not name is refused, not dropped");
  assert.deepEqual(await refusal({ data: { ...PACK, note: "x".repeat(2100) } }), [400, "too-big", null]);
  assert.deepEqual(await refusal({ data: { v: 1, palette: { ...PACK.palette, text: "#2a2f3a" } } }), [400, "low-contrast", null]);
  assert.deepEqual(await refusal({ data: [] }), [400, "bad-request", null]);
  assert.deepEqual(await refusal({ name: "A" }), [400, "bad-request", "name"]);
  assert.deepEqual(await refusal({ name: String.fromCharCode(0x200b, 0x200b, 0x200b) }), [400, "bad-request", "name"], "invisible characters are cleaned out first");
  assert.deepEqual(await refusal({ name: "Two\nlines" }), [400, "bad-request", null]);
  assert.deepEqual(await refusal({ name: "x".repeat(41) }), [400, "bad-request", null]);
  assert.deepEqual(await refusal({ price: 5 }), [400, "bad-request", "price"]);
  assert.deepEqual(await refusal({ price: 251 }), [400, "bad-request", null]);
  assert.deepEqual(await refusal({ price: 10.5 }), [400, "bad-request", null]);
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM shop_packs")[0].n, 0, "nothing refused was kept");

  assert.deepEqual(await refusal({ blurb: "Blue\ton black" }), [400, "bad-request", null], "a blurb is one line, like a name");
  const made = await publish(as, "tok-alice", { name: "  Neon   night ", blurb: " Blue   on black ", price: 10 });
  assert.deepEqual([made.status, made.pack.name, made.pack.blurb, made.pack.price], [201, "Neon night", "Blue on black", 10], "names and blurbs are cleaned like other relay text");
  assert.deepEqual(await refusal({ name: "NEON NIGHT" }), [409, "conflict", "name-taken"], "a name once among a maker's listed packs, upper or lower case alike");
  assert.equal((await publish(as, "tok-bob", { name: "Neon night" })).status, 201, "another maker may use it");
  // A priced pack needs a maker in good standing; a free one only a member who may write.
  const newbie = await publish(as, "tok-newbie", { name: "First go", price: 20 });
  assert.deepEqual([newbie.status, newbie.error, newbie.hold], [403, "hold", "new-member"]);
  assert.ok(newbie.until > clock, "with when the hold lifts");
  assert.equal((await publish(as, "tok-fresh", { name: "Fresh", price: 20 })).hold, "new-account");
  assert.equal((await publish(as, "tok-newbie", { name: "First go", price: 0 })).status, 201);
});

test("a maker lists 12 packs at most and publishes 4 a day, even when the relay sleeps; the Shop holds 2000", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const make = (n) => publish(as, "tok-alice", { name: `Pack ${n}` });
  for (let n = 1; n <= 4; n += 1) assert.equal((await make(n)).status, 201, `pack ${n}`);
  const fifth = await make(5);
  assert.deepEqual([fifth.status, fifth.error], [429, "rate-limited"]);
  assert.ok(fifth.retryAfter > 0);
  await relay.hibernate();
  assert.deepEqual([(await make(5)).status, (await make(5)).reason], [409, "daily-publishes"], "the day's packs in the store still count once the bucket is forgotten");
  for (let day = 1; day <= 2; day += 1) {
    clock += DAY;
    for (let n = 1; n <= 4; n += 1) assert.equal((await make(day * 10 + n)).status, 201);
  }
  clock += DAY;
  assert.deepEqual([(await make(99)).status, (await make(99)).reason], [409, "listed-packs"]);
  assert.equal(relay.sql(`SELECT COUNT(*) AS n FROM shop_packs WHERE maker_id = ? AND status = 'listed'`, ALICE.id)[0].n, SHOP.listedPerMaker);
  // A name already taken costs none of the day's four.
  const first = relay.sql(`SELECT id FROM shop_packs WHERE maker_id = ? ORDER BY created_at LIMIT 1`, ALICE.id)[0].id;
  assert.equal((await as("tok-alice", "DELETE", `/v1/shop/packs/${first}`)).pack.status, "unlisted");
  for (let n = 0; n < 5; n += 1) assert.equal((await make(11)).reason, "name-taken");
  assert.equal((await make(99)).status, 201, "unlisting makes room");
  assert.equal((await as("tok-alice", "PUT", `/v1/shop/packs/${first}`, { listed: true })).reason, "listed-packs", "listing again keeps to the same limits");
  // The whole Shop: 2000 listed packs.
  const listed = relay.sql(`SELECT COUNT(*) AS n FROM shop_packs WHERE status = 'listed'`)[0].n;
  relay.sql(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO shop_packs (id, maker_id, name, blurb, price, data, status, sales, created_at, updated_at)
     SELECT printf('pack_f%015d', i), '200000000000000099', 'Filler ' || i, '', 0, '{}', 'listed', 0, ?, ? FROM n`,
    SHOP.listedTotal - listed, clock, clock,
  );
  assert.deepEqual([(await publish(as, "tok-cara", { name: "Late" })).status, (await publish(as, "tok-cara", { name: "Late" })).reason], [409, "shop-full"]);
  const page = await as("tok-cara", "GET", "/v1/shop?view=new");
  assert.equal(page.items.length, SHOP.pageSize);
  assert.equal(page.next, String(SHOP.pageSize));
  const second = await as("tok-cara", "GET", `/v1/shop?view=new&cursor=${page.next}`);
  assert.equal(second.items.length, SHOP.pageSize);
  assert.ok(!second.items.some((item) => page.items.some((seen) => seen.id === item.id)), "the next page goes on from the last");
});

test("a maker changes, unlists and lists a pack again; its owners keep it and always get its newest data", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const pack = (await publish(as, "tok-alice", { name: "Calm", blurb: "Quiet blues" })).pack;
  await as("tok-bob", "POST", `/v1/shop/${pack.id}/buy`, { price: 0 });
  clock += 60_000;
  const bluer = { ...PACK, palette: { ...PACK.palette, accent: "#3A7BFF" }, font: "serif" };
  const changed = await as("tok-alice", "PUT", `/v1/shop/packs/${pack.id}`, { name: "Calm blue", blurb: "", data: bluer });
  assert.equal(changed.status, 200, JSON.stringify(changed));
  assert.deepEqual([changed.pack.name, changed.pack.blurb, changed.pack.data.palette.accent, changed.pack.data.font, changed.pack.updatedAt], ["Calm blue", "", "#3a7bff", "serif", clock]);
  const owned = (await as("tok-bob", "GET", "/v1/shop/owned")).items;
  assert.deepEqual(owned, [{ id: pack.id, kind: "pack", name: "Calm blue", data: changed.pack.data, updatedAt: clock }], "an owner gets the newest data");
  assert.deepEqual([(await as("tok-bob", "PUT", `/v1/shop/packs/${pack.id}`, { name: "Mine now" })).status, (await as("tok-alice", "PUT", "/v1/shop/packs/pack_AAAAAAAAAAAAAAAA", { name: "x y" })).status], [403, 404]);
  assert.deepEqual([(await as("tok-alice", "PUT", `/v1/shop/packs/${pack.id}`, { data: { ...PACK, extra: 1 } })).error, (await as("tok-alice", "PUT", `/v1/shop/packs/${pack.id}`, { price: 5 })).reason], ["bad-pack", "price"]);

  const unlisted = await as("tok-alice", "DELETE", `/v1/shop/packs/${pack.id}`);
  assert.deepEqual([unlisted.status, unlisted.pack.status], [200, "unlisted"]);
  assert.equal((await as("tok-cara", "GET", "/v1/shop?view=new")).items.length, 0, "off the Shop's lists");
  assert.deepEqual((await as("tok-bob", "GET", "/v1/shop/owned")).items.map((item) => item.id), [pack.id], "kept by everyone who owns it");
  assert.equal((await as("tok-cara", "POST", `/v1/shop/${pack.id}/buy`, { price: 0 })).error, "gone");
  assert.deepEqual((await as("tok-alice", "GET", "/v1/shop?view=mine")).items.map((item) => [item.id, item.status]), [[pack.id, "unlisted"]], "the maker still sees it");
  assert.equal((await as("tok-bob", "DELETE", `/v1/shop/packs/${pack.id}`)).status, 403);
  const back = await as("tok-alice", "PUT", `/v1/shop/packs/${pack.id}`, { listed: true });
  assert.equal(back.pack.status, "listed");
  assert.deepEqual((await as("tok-cara", "GET", "/v1/shop?view=new")).items.map((item) => item.id), [pack.id]);
  assert.equal((await as("tok-alice", "PUT", `/v1/shop/packs/${pack.id}`, { listed: false })).pack.status, "unlisted");
  // Setting a price is selling: a maker who may not earn yet is held, as when publishing.
  const first = (await publish(as, "tok-newbie", { name: "Starter" })).pack.id;
  const priced = await as("tok-newbie", "PUT", `/v1/shop/packs/${first}`, { price: 20 });
  assert.deepEqual([priced.status, priced.error, priced.hold], [403, "hold", "new-member"]);
  assert.equal((await as("tok-newbie", "PUT", `/v1/shop/packs/${first}`, { name: "Starter kit" })).status, 200, "a free pack's other fields are theirs to change");
});

test("a reported pack reaches the moderators, and removing it takes it off the Shop and from everyone who owns it", async () => {
  const clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const pack = (await publish(as, "tok-alice", { name: "Copycat" })).pack.id;
  await as("tok-bob", "POST", `/v1/shop/${pack}/buy`, { price: 0 });
  assert.deepEqual([(await as("tok-alice", "POST", `/v1/shop/packs/${pack}/report`, { reason: "mine" })).status, (await as("tok-alice", "POST", `/v1/shop/packs/${pack}/report`, { reason: "mine" })).reason], [403, "self"]);
  assert.equal((await as("tok-cara", "POST", `/v1/shop/packs/${pack}/report`, { reason: "Someone else's theme", text: "Copied from a game" })).status, 202);
  await as("tok-cara", "POST", `/v1/shop/packs/${pack}/report`, { reason: "again" });
  assert.equal((await as("tok-cara", "POST", "/v1/shop/packs/pack_AAAAAAAAAAAAAAAA/report", { reason: "x" })).status, 404);
  assert.equal((await as("tok-bob", "GET", "/v1/admin/reports")).status, 403, "moderators only");
  const reports = (await as("tok-mod", "GET", "/v1/admin/reports")).reports.filter((item) => item.kind === "shop");
  assert.equal(reports.length, 1, "once per member");
  const [report] = reports;
  assert.deepEqual([report.packId, report.author.id, report.reporter.id, report.reason, report.text, report.verified, report.roomId, report.messageId, report.projectId], [pack, ALICE.id, CARA.id, "Someone else's theme", "Copycat · Copied from a game", true, null, null, null]);
  // "remove" is for Shop packs; a project report is resolved as before.
  const project = (await as("tok-bob", "POST", "/v1/projects", { url: "https://bob.itch.io/thing", title: "Thing" })).project.id;
  await as("tok-cara", "POST", `/v1/projects/${project}/report`, { reason: "spam" });
  const projectReport = (await as("tok-mod", "GET", "/v1/admin/reports")).reports.find((item) => item.kind === "project");
  assert.equal(projectReport.packId, null);
  assert.deepEqual([(await as("tok-mod", "POST", `/v1/admin/reports/${projectReport.id}/resolve`, { action: "remove" })).reason, (await as("tok-mod", "POST", `/v1/admin/reports/${projectReport.id}/resolve`)).ok], ["action", true]);

  assert.equal((await as("tok-mod", "POST", `/v1/admin/reports/${report.id}/resolve`, { action: "remove" })).ok, true);
  assert.equal(relay.sql("SELECT status FROM shop_packs WHERE id = ?", pack)[0].status, "removed");
  assert.equal(relay.sql("SELECT status FROM reports WHERE id = ?", report.id)[0].status, "resolved");
  assert.deepEqual(relay.sql(`SELECT kind, actor_id, target_id FROM audit WHERE kind IN ('shop-remove', 'report-resolve') ORDER BY id`).map((row) => ({ ...row })).slice(-2), [{ kind: "shop-remove", actor_id: MOD.id, target_id: ALICE.id }, { kind: "report-resolve", actor_id: MOD.id, target_id: null }]);
  assert.deepEqual((await as("tok-bob", "GET", "/v1/shop/owned")).items, [], "its owners lose it");
  assert.deepEqual((await as("tok-bob", "GET", "/v1/shop?view=owned")).items, []);
  assert.deepEqual([(await as("tok-cara", "GET", "/v1/shop?view=new")).items.length, (await as("tok-alice", "GET", "/v1/shop?view=mine")).items.length], [0, 0]);
  assert.equal((await as("tok-cara", "POST", `/v1/shop/${pack}/buy`, { price: 0 })).error, "gone");
  assert.equal((await as("tok-alice", "PUT", `/v1/shop/packs/${pack}`, { listed: true })).status, 404, "never served again, even to its maker");

  // Straight from the moderators' page: a reason, an audit row, and the pack's open reports resolved with it.
  const second = (await publish(as, "tok-alice", { name: "Second" })).pack.id;
  await as("tok-cara", "POST", `/v1/shop/packs/${second}/report`, { reason: "hurtful name" });
  assert.equal((await as("tok-bob", "POST", `/v1/admin/shop/${second}/remove`, { reason: "spam" })).status, 403);
  assert.equal((await as("tok-mod", "POST", "/v1/admin/shop/pack_AAAAAAAAAAAAAAAA/remove", {})).status, 404);
  assert.equal((await as("tok-mod", "POST", `/v1/admin/shop/${second}/remove`, { reason: "hurtful name" })).ok, true);
  assert.equal((await as("tok-mod", "POST", `/v1/admin/shop/${second}/remove`, {})).ok, true, "removing twice is fine");
  assert.deepEqual(relay.sql(`SELECT detail FROM audit WHERE kind = 'shop-remove' ORDER BY id`).map((row) => JSON.parse(row.detail)), [{ packId: pack }, { packId: second, reason: "hurtful name" }]);
  assert.equal((await as("tok-mod", "GET", "/v1/admin/reports")).reports.filter((item) => item.kind === "shop").length, 0);
});

test("Forget me takes what the member owned and their packs, with no id or name of theirs left in any Shop row", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const glow = (await publish(as, "tok-bob", { name: "Bob's glow", blurb: "Made by Bob" })).pack.id;
  const dusk = (await publish(as, "tok-bob", { name: "Bob's dusk", price: 20 })).pack.id;
  give(relay, BOB.id, 60);
  await as("tok-bob", "POST", "/v1/shop/studio:fx-dissolve/buy", { price: 60 });
  give(relay, ALICE.id, 20);
  await as("tok-alice", "POST", `/v1/shop/${glow}/buy`, { price: 0 });
  await as("tok-alice", "POST", `/v1/shop/${dusk}/buy`, { price: 20 });
  await as("tok-cara", "POST", `/v1/shop/packs/${glow}/report`, { reason: "spam" });
  const forgotten = await as("tok-bob", "POST", "/v1/me/forget");
  assert.equal(forgotten.forgotten.packs, 2);
  for (const table of ["shop_packs", "shop_owned"]) {
    // Pack ids are random, so they are left out before looking for the name.
    const dump = JSON.stringify(relay.sql(`SELECT * FROM ${table}`)).replace(/pack_[A-Za-z0-9_-]{16}/g, "pack");
    assert.ok(!dump.includes(BOB.id) && !dump.includes("Bob"), `${table} still names them: ${dump}`);
  }
  assert.deepEqual(relay.sql("SELECT maker_id, status, name, blurb, data FROM shop_packs").map((row) => ({ ...row })), [{ maker_id: "", status: "removed", name: "", blurb: "", data: "{}" }, { maker_id: "", status: "removed", name: "", blurb: "", data: "{}" }]);
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM shop_owned WHERE user_id = ?", BOB.id)[0].n, 0);
  assert.equal(relay.sql(`SELECT COUNT(*) AS n FROM reports WHERE room_id = 'shop'`)[0].n, 0, "the reports about their packs go with them");
  assert.deepEqual((await as("tok-alice", "GET", "/v1/shop/owned")).items, [], "nobody is served a forgotten member's packs");
  assert.equal(balanceOf(relay, ALICE.id), 0, "what was spent stays spent");
  // A removed pack, and the rows that owned it, leave the store 30 days later.
  clock += SHOP.removedKeepMs + DAY;
  relay.sql("UPDATE meta SET value = '0' WHERE key = 'upkeep_at'");
  await relay.runAlarm();
  assert.deepEqual([relay.sql("SELECT COUNT(*) AS n FROM shop_packs")[0].n, relay.sql("SELECT COUNT(*) AS n FROM shop_owned")[0].n], [0, 0]);
});

test("schema v6: a v5 database gains the Shop's tables and keeps every row it had", () => {
  const db = new DatabaseSync(":memory:");
  const sql = sqlPort(db);
  // A v5 relay's database, as a v5 relay made it.
  for (const step of MIGRATIONS.filter((item) => item.version <= 5)) for (const statement of step.statements) sql.exec(statement);
  sql.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', '5')`);
  sql.exec("INSERT INTO accounts (user_id, balance, lifetime) VALUES (?, 120, 300)", ALICE.id);
  sql.exec("INSERT INTO credit_events (actor_id, target_id, kind, ref, uniq, day, amount, at) VALUES (?, ?, 'played', NULL, 'd1', 1, 5, 1)", BOB.id, ALICE.id);
  const tables = () => sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((row) => row.name);
  assert.ok(!tables().includes("shop_packs"));
  const store = createStore(sql);
  assert.equal(store.migrate(), 6);
  assert.equal(SCHEMA_VERSION, 6);
  assert.ok(tables().includes("shop_packs") && tables().includes("shop_owned"));
  assert.deepEqual(sql.exec("PRAGMA table_info(shop_packs)").map((row) => row.name), ["id", "maker_id", "name", "blurb", "price", "data", "status", "sales", "created_at", "updated_at"]);
  assert.deepEqual(sql.exec("PRAGMA table_info(shop_owned)").map((row) => row.name), ["user_id", "item_id", "price", "at"]);
  assert.deepEqual(sql.exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'shop_%' ORDER BY name`).map((row) => row.name), ["shop_owned_item", "shop_packs_listed", "shop_packs_maker"]);
  assert.deepEqual({ ...sql.exec("SELECT balance, lifetime FROM accounts WHERE user_id = ?", ALICE.id)[0] }, { balance: 120, lifetime: 300 });
  assert.equal(sql.exec("SELECT COUNT(*) AS n FROM credit_events")[0].n, 1);
  assert.equal(store.migrate(), 6, "running it again changes nothing");
  assert.equal(MIGRATIONS.at(-1).version, 6);
  assert.ok(MIGRATIONS.at(-1).statements.every((statement) => !/;\s*\S/.test(statement)), "one statement per entry");
  db.close();
});

test("Studio's client: the Shop's lists, a price that changed, a pack published, bought with a tip and removed, refusals with their details", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock });
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  const mod = member(relay, "tok-mod");
  const newbie = member(relay, "tok-newbie");
  await connectAll(alice, bob, mod, newbie);
  assert.equal(alice.client.status().shop, true, "the relay lists the Shop in ready.features");
  give(relay, BOB.id, 300);
  const studio = await bob.client.shop("studio");
  // What is on sale that day: every classic item and the drop running then (shop-drops.mjs).
  const onSale = CATALOG.filter((item) => saleOf(item, clock).available);
  assert.deepEqual([studio.ok, studio.view, studio.items.length, studio.balance, studio.canEarn, studio.hold, studio.next], [true, "studio", onSale.length, 300, true, null, null]);
  assert.deepEqual(studio.items.filter((item) => item.kind === "nodestyle").map((item) => [item.id, item.price, item.data]), onSale.filter((item) => item.kind === "nodestyle").map((item) => [item.id, 80, null]), "the node styles reach Studio through its own client");
  assert.deepEqual(studio.items.find((item) => item.id === "studio:pack-synthwave").data.palette, studioItem("studio:pack-synthwave").data.palette);
  assert.deepEqual(await bob.client.shopBuy("studio:fx-embers", 80), { ok: false, error: "price-changed", price: 90 });
  const gold = await bob.client.shopBuy("studio:skin-gold", 60);
  assert.deepEqual([gold.ok, gold.item.owned, gold.balance], [true, true, 240]);
  await until(() => bob.of("credits").some((event) => event.reason === "shop" && event.delta === -60), "bob's credits event");

  const made = await alice.client.shopPublish({ name: "Neon night", blurb: "Blue on black", price: 100, data: PACK });
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.deepEqual([made.pack.name, made.pack.maker.id, made.pack.data], ["Neon night", ALICE.id, PACK]);
  assert.deepEqual(await alice.client.shopPublish({ name: "Bad", price: 0, data: { ...PACK, css: "x" } }), { ok: false, error: "bad-pack" }, "the relay's check answers, so a key is refused rather than dropped on the way");
  assert.deepEqual(await alice.client.shopPublish({ name: "Dim", price: 0, data: { v: 1, palette: { ...PACK.palette, text: "#2a2f3a" } } }), { ok: false, error: "low-contrast" });
  assert.deepEqual(await alice.client.shopPublish({ name: "Big", price: 0, data: { ...PACK, note: "x".repeat(3000) } }), { ok: false, error: "too-big" });
  const held = await newbie.client.shopPublish({ name: "Starter", price: 20, data: PACK });
  assert.deepEqual([held.ok, held.error, held.hold, typeof held.until], [false, "hold", "new-member", "number"]);
  const tipped = await bob.client.shopBuy(made.pack.id, 100, 10);
  assert.deepEqual([tipped.ok, tipped.paid, tipped.balance], [true, 110, 130]);
  await until(() => alice.of("credits").some((event) => event.reason === "sale" && event.delta === 82), "alice hears the sale: 75% of the price and the tip");
  assert.deepEqual(await bob.client.shopBuy("studio:fx-embers", 90, 5), { ok: false, error: "no-tip" });
  assert.equal((await bob.client.shopBuy("studio:fx-embers", 90)).balance, 40);
  assert.deepEqual(await bob.client.shopBuy("studio:fx-stardust", 90), { ok: false, error: "short", price: 90, balance: 40 });
  const owned = await bob.client.shopOwned();
  assert.deepEqual(owned.items.map((item) => [item.id, item.kind, item.data === null]), [[made.pack.id, "pack", false], ["studio:fx-embers", "effect", true], ["studio:skin-gold", "skin", true]]);
  assert.deepEqual((await bob.client.shop("new")).items.map((item) => [item.id, item.owned, item.sales]), [[made.pack.id, true, 1]]);

  assert.equal((await alice.client.shopUpdate(made.pack.id, { name: "Neon dawn" })).pack.name, "Neon dawn");
  assert.equal((await alice.client.shopUnlist(made.pack.id)).pack.status, "unlisted");
  assert.equal((await alice.client.shopUpdate(made.pack.id, { listed: true })).pack.status, "listed");
  assert.deepEqual(await bob.client.shopReport(made.pack.id, { reason: "Looks like someone else's", text: "From a game" }), { ok: true });
  const reports = await mod.client.modReports();
  assert.deepEqual(reports.reports.filter((item) => item.kind === "shop").map((item) => [item.packId, item.author.id, item.text]), [[made.pack.id, ALICE.id, "Neon dawn · From a game"]]);
  assert.deepEqual(await alice.client.modShopRemove(made.pack.id, { reason: "mine" }), { ok: false, error: "forbidden" });
  assert.deepEqual(await mod.client.modShopRemove(made.pack.id, { reason: "a copy" }), { ok: true });
  assert.deepEqual((await bob.client.shopOwned()).items.map((item) => item.id), ["studio:fx-embers", "studio:skin-gold"], "a removed pack leaves its owners too");
  assert.equal((await mod.client.modReports()).reports.filter((item) => item.kind === "shop").length, 0);
  for (const one of [alice, bob, mod, newbie]) await one.client.disconnect();
});
