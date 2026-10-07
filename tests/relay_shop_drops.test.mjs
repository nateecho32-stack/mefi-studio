import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createCredits } from "../relay/src/credits.mjs";
import { FEATURES, HTTP_ERRORS } from "../relay/src/protocol.mjs";
import { CATALOG, createShop } from "../relay/src/shop.mjs";
import { DROPS, DROP_ID, FEATURED_COUNT, checkDrops, dropsAt, featuredAt, isoWeek, saleOf, windowsOf } from "../relay/src/shop-drops.mjs";
import { createStore } from "../relay/src/store.mjs";
import { hmacKey, randomBytes } from "../relay/src/util.mjs";
import { ALICE, BOB, CARA, makeRelay } from "./fixtures/relay-harness.mjs";

// The Shop's rotation (relay/src/shop-drops.mjs, served by relay/src/shop.mjs
// as feature "shop.drops"): DROPS in shape, an item of a drop hidden before
// it, on sale through it and rotated out after it (to the millisecond), a
// later drop bringing one back, the current, next and last drops, the week's
// Featured shelf, and the routes: the Studio list, the owned list, and a
// purchase refused as "not-available" once an item has rotated out, while
// everyone who got it keeps it.

const t = (iso) => Date.parse(iso);
const item = (id, kind, extra = {}) => Object.freeze({ id, kind, name: id.slice(7), price: 40, requires: null, blurb: `${id}.`, data: null, drop: null, at: 1, ...extra });
const drop = (id, from, until, extra = {}) => Object.freeze({ id, name: `Drop ${id}`, blurb: "A test drop.", from, until, colors: Object.freeze({ accent: "#ff8a3d", accent2: "#9b6bff", background: "#140d1c" }), returning: Object.freeze([]), ...extra });
// Three months: October (the wisp's), November (the lanterns'), then January, which brings the wisp back.
const TEST_DROPS = Object.freeze([
  drop("2026-10", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"),
  drop("2026-11", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
  drop("2027-01", "2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z", { returning: Object.freeze(["studio:pet-wisp"]) }),
]);
const TEST_CATALOG = Object.freeze([
  item("studio:skin-frost", "skin"), item("studio:fx-dissolve", "effect"), item("studio:style-dragonscale", "nodestyle"),
  item("studio:pack-synthwave", "pack"), item("studio:skin-gold", "skin"),
  item("studio:pet-wisp", "pet", { drop: "2026-10" }), item("studio:style-lanterns", "nodestyle", { drop: "2026-11", price: 80 }),
]);

test("DROPS is in shape: YYYY-MM ids, names, UTC times, banner colours, oldest first with no overlaps, and every item's drop known", () => {
  assert.deepEqual(checkDrops(DROPS, CATALOG), [], "the drops the relay serves");
  assert.ok(Object.isFrozen(DROPS) && DROPS.every((entry) => Object.isFrozen(entry) && Object.isFrozen(entry.colors) && Object.isFrozen(entry.returning)), "fixed in code");
  assert.ok(DROPS.length >= 1 && DROPS.every((entry) => DROP_ID.test(entry.id)));
  assert.deepEqual(Object.keys(DROPS[0]), ["id", "name", "blurb", "from", "until", "colors", "returning"], "the contract's field names");
  assert.deepEqual(Object.keys(DROPS[0].colors), ["accent", "accent2", "background"]);
  for (const entry of CATALOG) assert.ok(entry.drop === null || DROPS.some((candidate) => candidate.id === entry.drop), `${entry.id}'s drop is listed`);
  assert.deepEqual(checkDrops(TEST_DROPS, TEST_CATALOG), [], "the test drops are in shape too");
  assert.equal(FEATURES.shopDrops, "shop.drops");
  assert.ok(HTTP_ERRORS.includes("not-available"), "a refusal the protocol names");
});

test("checkDrops names what is wrong: order, overlaps, times, colours, names, and returning items that cannot return", () => {
  const problems = (drops, catalog = TEST_CATALOG) => checkDrops(drops, catalog).join("\n");
  const [october, november, january] = TEST_DROPS;
  assert.match(problems([november, october, january]), /drop 2026-10: drops are listed oldest first/);
  assert.match(problems([october, { ...november, from: "2026-10-20T00:00:00Z" }, january]), /drop 2026-11: it starts before 2026-10 ends/);
  assert.match(problems([october, october]), /drop 2026-10: the id is used twice/);
  assert.match(problems([{ ...october, id: "2026-13" }]), /the id is YYYY-MM/);
  assert.match(problems([{ ...october, until: october.from }]), /from and until are UTC ISO times, from first/);
  assert.match(problems([{ ...october, from: "2026-10-01 00:00" }]), /from and until are UTC ISO times/);
  assert.match(problems([{ ...october, colors: { ...october.colors, accent: "#FF8A3D" } }]), /colors\.accent is #rrggbb in lower case/);
  assert.match(problems([{ ...october, colors: { ...october.colors, glow: "#ffffff" } }]), /colors holds accent, accent2, background only/);
  assert.match(problems([{ ...october, name: "X" }]), /a name of 2 to 40 characters/);
  assert.match(problems([{ ...october, blurb: "x".repeat(161) }]), /a line of at most 160 characters/);
  assert.match(problems([october, november, { ...january, returning: ["studio:nope"] }]), /drop 2027-01: studio:nope is not in the catalog/);
  assert.match(problems([october, november, { ...january, returning: ["studio:skin-frost"] }]), /studio:skin-frost is a classic item, on sale already/);
  assert.match(problems([october, { ...november, returning: ["studio:style-lanterns"] }, january]), /studio:style-lanterns returns before its own drop 2026-11 has ended/);
  assert.match(problems([october, november, { ...january, returning: ["studio:pet-wisp", "studio:pet-wisp"] }]), /returning is a list of up to 24 different item ids/);
  assert.match(problems([october], TEST_CATALOG), /studio:style-lanterns: its drop 2026-11 is not listed/);
});

test("an item of a drop: hidden before it, on sale through it to the millisecond, rotated out after it, and back when a later drop lists it", () => {
  const wisp = TEST_CATALOG.find((entry) => entry.id === "studio:pet-wisp");
  const frost = TEST_CATALOG.find((entry) => entry.id === "studio:skin-frost");
  const at = (iso) => saleOf(wisp, t(iso), TEST_DROPS);
  assert.deepEqual(windowsOf(wisp, TEST_DROPS).map((entry) => entry.drop), ["2026-10", "2027-01"], "its own drop, then the one that brings it back");
  assert.deepEqual(windowsOf(frost, TEST_DROPS), [], "a classic item has no window");
  assert.deepEqual(saleOf(frost, t("2030-01-01T00:00:00Z"), TEST_DROPS), { classic: true, released: true, available: true, leaves: null, current: null }, "classic: always on sale");
  assert.deepEqual(at("2026-09-30T23:59:59.999Z"), { classic: false, released: false, available: false, leaves: null, current: null }, "the last moment before its drop: hidden");
  assert.deepEqual(at("2026-10-01T00:00:00Z"), { classic: false, released: true, available: true, leaves: "2026-11-01T00:00:00Z", current: "2026-10" }, "the drop's first moment");
  assert.deepEqual(at("2026-10-31T23:59:59.999Z").available, true, "its last moment");
  assert.deepEqual(at("2026-11-01T00:00:00Z"), { classic: false, released: true, available: false, leaves: null, current: null }, "until is exclusive: rotated out");
  assert.equal(at("2026-12-15T00:00:00Z").available, false, "between its drops");
  assert.deepEqual(at("2027-01-10T00:00:00Z"), { classic: false, released: true, available: true, leaves: "2027-02-01T00:00:00Z", current: "2027-01" }, "back with the January drop, leaving when it ends");
  assert.equal(at("2027-02-01T00:00:00Z").available, false, "and rotated out again");
  assert.equal(saleOf(item("studio:x", "skin", { drop: "2099-01" }), t("2026-10-05T00:00:00Z"), TEST_DROPS).released, false, "a drop nobody listed never opens");
});

test("the drops at a time: the current one with its items (returning ones too), the next as a teaser without items, and the last that ended", () => {
  const view = (iso) => dropsAt(t(iso), TEST_DROPS, TEST_CATALOG);
  const before = view("2026-09-15T00:00:00Z");
  assert.equal(before.current, null);
  assert.deepEqual(before.next, { id: "2026-10", name: "Drop 2026-10", blurb: "A test drop.", from: "2026-10-01T00:00:00Z", until: "2026-11-01T00:00:00Z", colors: { accent: "#ff8a3d", accent2: "#9b6bff", background: "#140d1c" } }, "a teaser: no items until it starts");
  assert.equal(before.last, null);
  const october = view("2026-10-07T12:00:00Z");
  assert.deepEqual([october.current.id, october.current.items, october.next.id, october.last], ["2026-10", ["studio:pet-wisp"], "2026-11", null]);
  assert.equal("items" in october.next, false);
  const gap = view("2026-12-10T00:00:00Z");
  assert.deepEqual([gap.current, gap.next.id, gap.last.id], [null, "2027-01", "2026-11"], "a month without a drop: the next and the last");
  const january = view("2027-01-02T00:00:00Z");
  assert.deepEqual([january.current.id, january.current.items, january.next, january.last.id], ["2027-01", ["studio:pet-wisp"], null, "2026-11"], "the wisp is back in January's items");
  assert.equal(view("2027-03-01T00:00:00Z").current, null);
  const copy = view("2026-10-07T12:00:00Z").current;
  copy.colors.accent = "#000000";
  assert.equal(TEST_DROPS[0].colors.accent, "#ff8a3d", "each answer is a copy");
});

test("the Featured shelf: four classic items, the same for everyone all ISO week, new each Monday 00:00 UTC", () => {
  assert.deepEqual(isoWeek(t("2026-10-07T12:00:00Z")), { year: 2026, week: 41 });
  assert.deepEqual(isoWeek(t("2021-01-03T23:00:00Z")), { year: 2020, week: 53 }, "a Sunday in the last week of the year before");
  assert.deepEqual(isoWeek(t("2024-12-30T00:00:00Z")), { year: 2025, week: 1 }, "a Monday already in next year's first week");
  assert.deepEqual(isoWeek(t("2026-01-01T00:00:00Z")), { year: 2026, week: 1 }, "a Thursday: week 1");
  const monday = featuredAt(TEST_CATALOG, t("2026-10-05T00:00:00Z"));
  assert.equal(monday.items.length, FEATURED_COUNT);
  assert.ok(monday.items.every((id) => !TEST_CATALOG.find((entry) => entry.id === id).drop), "classic items only");
  assert.equal(new Set(monday.items).size, FEATURED_COUNT, "four different items");
  assert.equal(monday.until, "2026-10-12T00:00:00.000Z", "until next Monday");
  assert.deepEqual(featuredAt(TEST_CATALOG, t("2026-10-11T23:59:59.999Z")), monday, "the same all week");
  assert.deepEqual(featuredAt([...TEST_CATALOG].reverse(), t("2026-10-08T00:00:00Z")), monday, "whatever order the catalog is in");
  const weeks = new Set(Array.from({ length: 12 }, (_, at) => featuredAt(TEST_CATALOG, t("2026-10-05T00:00:00Z") + at * 7 * 86_400_000).items.join()));
  assert.ok(weeks.size > 1, "it changes from week to week");
  assert.deepEqual(featuredAt([item("studio:a", "skin"), item("studio:b", "skin", { drop: "2026-10" })], t("2026-10-05T00:00:00Z")).items, ["studio:a"], "fewer classic items than four: all of them");
  const real = featuredAt(CATALOG, t("2026-10-07T12:00:00Z"));
  assert.ok(real.items.length === FEATURED_COUNT && real.items.every((id) => CATALOG.some((entry) => entry.id === id)), "the real catalog has a shelf");
});

async function shopAt(clockRef) {
  const db = new DatabaseSync(":memory:");
  const store = createStore({
    exec: (query, ...bindings) => db.prepare(query).all(...bindings),
    transaction: (fn) => { db.exec("BEGIN"); try { const out = fn(); db.exec("COMMIT"); return out; } catch (error) { db.exec("ROLLBACK"); throw error; } },
  });
  store.migrate();
  const now = () => clockRef.at;
  const member = (uid) => ({ id: uid, name: uid === ALICE.id ? "Alice" : uid === BOB.id ? "Bob" : "Cara", roleKeys: [], isMod: false, readOnly: false, joinedAt: now() - 60 * 86_400_000 });
  const told = [];
  const credits = createCredits({ store, now, key: await hmacKey(randomBytes(32)), sendToUser: (uid, type, body) => told.push([uid, type, body]), member });
  const shop = createShop({ store, now, credits, catalog: TEST_CATALOG, drops: TEST_DROPS });
  const routes = [];
  shop.routes((method, pattern, handler, options) => routes.push({ method, pattern, handler, options }));
  const handler = (method, pattern) => routes.find((entry) => entry.method === method && entry.pattern === pattern).handler;
  const list = (uid, view = "studio") => handler("GET", "/v1/shop")({ actor: { uid }, query: new URLSearchParams(`view=${view}`) });
  const buy = (uid, id, price) => handler("POST", "/v1/shop/:id/buy")({ actor: { uid }, params: { id }, body: { price } });
  const owned = (uid) => handler("GET", "/v1/shop/owned")({ actor: { uid } });
  for (const uid of [ALICE.id, BOB.id, CARA.id]) store.run("INSERT INTO accounts (user_id, balance, lifetime) VALUES (?, 500, 500)", uid);
  return { shop, store, list, buy, owned, told, db, balance: (uid) => credits.account(uid).balance };
}

test("the Studio list carries the rotation: only what is on sale, each item's drop, whether it is on sale and when it leaves, the drops and the Featured shelf", async () => {
  const clock = { at: t("2026-10-07T12:00:00Z") };
  const h = await shopAt(clock);
  const answer = (await h.list(ALICE.id)).body;
  assert.deepEqual(answer.items.map((entry) => entry.id), ["studio:skin-frost", "studio:fx-dissolve", "studio:style-dragonscale", "studio:pack-synthwave", "studio:skin-gold", "studio:pet-wisp"], "November's lanterns are hidden until November");
  const wisp = answer.items.find((entry) => entry.id === "studio:pet-wisp");
  assert.deepEqual([wisp.drop, wisp.available, wisp.leaves], ["2026-10", true, "2026-11-01T00:00:00Z"]);
  const frost = answer.items.find((entry) => entry.id === "studio:skin-frost");
  assert.deepEqual([frost.drop, frost.available, frost.leaves], [null, true, null], "a classic item");
  assert.deepEqual([answer.drops.current.id, answer.drops.current.items, answer.drops.next.id, answer.drops.last], ["2026-10", ["studio:pet-wisp"], "2026-11", null]);
  assert.deepEqual([answer.featured, answer.featuredUntil], [featuredAt(TEST_CATALOG, clock.at).items, "2026-10-12T00:00:00.000Z"]);
  assert.ok(answer.featured.every((id) => answer.items.some((entry) => entry.id === id)), "everything Featured is in the list");
  clock.at = t("2026-11-02T00:00:00Z");
  const november = (await h.list(ALICE.id)).body;
  assert.ok(!november.items.some((entry) => entry.id === "studio:pet-wisp"), "the wisp rotated out");
  assert.deepEqual(november.items.find((entry) => entry.id === "studio:style-lanterns").leaves, "2026-12-01T00:00:00Z", "the lanterns came in");
  assert.deepEqual([november.drops.current.id, november.drops.last.id], ["2026-11", "2026-10"]);
  const packs = (await h.list(ALICE.id, "new")).body;
  assert.ok(packs.drops && Array.isArray(packs.featured), "every list carries the rotation");
  h.db.close();
});

test("buying follows the rotation: on sale it is bought; rotated out it is refused as not-available with nothing spent, its owners keep it, and it sells again when it returns", async () => {
  const clock = { at: t("2026-10-30T12:00:00Z") };
  const h = await shopAt(clock);
  const bought = await h.buy(ALICE.id, "studio:pet-wisp", 40);
  assert.equal(bought.status, 200, JSON.stringify(bought.body));
  assert.deepEqual([bought.body.item.drop, bought.body.item.available, bought.body.item.leaves, bought.body.balance], ["2026-10", true, "2026-11-01T00:00:00Z", 460]);
  // The last millisecond still sells; the first one after does not.
  clock.at = t("2026-10-31T23:59:59.999Z");
  assert.equal((await h.buy(CARA.id, "studio:pet-wisp", 40)).status, 200, "the drop's last moment");
  clock.at = t("2026-11-01T00:00:00Z");
  const late = await h.buy(BOB.id, "studio:pet-wisp", 40);
  assert.deepEqual([late.status, late.body.error, late.body.drop], [409, "not-available", "2026-10"]);
  assert.equal(h.balance(BOB.id), 500, "nothing moved");
  assert.deepEqual(h.store.all("SELECT item_id FROM shop_owned WHERE user_id = ?", BOB.id), [], "and nothing was got");
  clock.at = t("2026-11-02T00:00:00Z");
  const early = await h.buy(BOB.id, "studio:style-lanterns", 80);
  assert.equal(early.status, 200, "November's lanterns sell in November");
  clock.at = t("2026-10-15T00:00:00Z");
  assert.deepEqual([(await h.buy(ALICE.id, "studio:style-lanterns", 80)).body.error], ["not-available"], "and not before their drop starts");
  // Alice keeps the wisp after it rotates out: on her list, and the relay says she owns it.
  clock.at = t("2026-12-10T00:00:00Z");
  assert.deepEqual((await h.owned(ALICE.id)).body.items.map((entry) => entry.id), ["studio:pet-wisp"]);
  const ownedView = (await h.list(ALICE.id, "owned")).body.items.find((entry) => entry.id === "studio:pet-wisp");
  assert.deepEqual([ownedView.owned, ownedView.available, ownedView.leaves], [true, false, null], "owned, and no longer on sale");
  assert.equal(h.shop.owns(ALICE.id, "studio:pet-wisp"), true);
  assert.equal((await h.buy(ALICE.id, "studio:pet-wisp", 40)).body.error, "owned", "an owner is told they own it, not that it left");
  // January brings it back: Bob gets it now.
  clock.at = t("2027-01-05T00:00:00Z");
  const back = await h.buy(BOB.id, "studio:pet-wisp", 40);
  assert.deepEqual([back.status, back.body.item.leaves], [200, "2027-02-01T00:00:00Z"]);
  assert.ok(h.told.some(([uid, type, body]) => uid === BOB.id && type === "credits" && body.reason === "shop" && body.delta === -40), "the credits frame says why the balance moved");
  h.db.close();
});

test("the relay lists shop.drops, and its Studio list carries the drops and the Featured shelf", async () => {
  const relay = makeRelay();
  const session = await (await relay.fetch("http://127.0.0.1:8787/v1/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: "tok-alice" }) })).json();
  const answer = await (await relay.fetch("http://127.0.0.1:8787/v1/shop?view=studio", { headers: { authorization: `Bearer ${session.session}` } })).json();
  assert.equal(answer.ok, true);
  assert.ok("drops" in answer && "current" in answer.drops && "next" in answer.drops && "last" in answer.drops);
  assert.equal(answer.featured.length, FEATURED_COUNT);
  assert.ok(answer.items.every((entry) => entry.available === true && "drop" in entry && "leaves" in entry));
  const at = Date.now();
  assert.deepEqual(answer.items.map((entry) => entry.id), CATALOG.filter((entry) => saleOf(entry, at).available).map((entry) => entry.id));
});
