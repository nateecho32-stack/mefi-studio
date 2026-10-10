import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { CATALOG } from "../relay/src/shop.mjs";
import { DROPS, dropsAt, featuredAt, isoWeek, saleOf, windowsOf } from "../relay/src/shop-drops.mjs";

// main.cjs's Shop gate (the "Rooms hub" block) in a vm: only the listed
// methods, at most their arguments, one object of fields copied as plain data
// (a pack's data and palette too), MEFI_STUDIO_SHOP_ALL answering every
// Studio item without a relay, and its list of Studio items kept equal to the
// relay's catalog (prices, lines and drops too), its drops equal to the
// relay's DROPS and its rotation rules giving the relay's answers, so the
// signed-out showroom (shopCatalog, answered here with no relay) shows what
// the relay sells. Then the preload bridge's own copy of the same rule.

const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const preload = (await readFile(new URL("../preload.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("// ---- Rooms hub: listen together and now playing");
const to = main.indexOf("// ---- end of the rooms hub", from);
assert.ok(from > 0 && to > from, "main.cjs has a Rooms hub block");
const block = main.slice(from, to);
const METHODS = ["shop", "shopOwned", "shopBuy", "shopPublish", "shopUpdate", "shopUnlist", "shopReport", "modShopRemove", "shopCatalog", "trades", "tradeInventory", "tradeOffer", "tradeDecide"];

function host(env = {}) {
  const calls = [];
  const client = { status: () => ({ configured: true, state: "ready", error: null, user: null, readOnly: false, paused: false, rooms: [] }) };
  for (const name of METHODS) client[name] = async (...args) => { calls.push([name, ...args]); return { ok: true }; };
  const context = vm.createContext({
    process: { env }, Date, Boolean, Number, Object,
    community: {}, discordOAuth: {}, COMMUNITY_ACCESS_MARGIN_MS: 60_000, communityTokens: null,
    communityClientId: () => "1234567890",
    communityRead: async () => ({ state: { link: { userId: "42" } } }),
    checkCommunity: async () => ({ ok: true }), publishCommunity: async () => ({}),
    send: () => {}, logLine: () => {}, require: () => null,
    optionalHelper: () => ({ configuredUrl: () => "https://hub.example.test", createHubClient: () => client }),
  });
  vm.runInContext(`${block}\nthis.api = { hubShop, HUB_SHOP_METHODS, SHOP_STUDIO_ITEMS, SHOP_DROPS, shopWindows, shopSaleOf, shopDropsAt, shopIsoWeek, shopFeaturedAt, hubShopCatalog };`, context);
  return { api: context.api, calls };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test("main lets the renderer call only the Shop's methods, with the hub client's own arity", async () => {
  assert.match(main, /const HUB_SHOP_METHODS = Object\.freeze\(\{ shop: 2, shopOwned: 0, shopBuy: 3, shopPublish: 1, shopUpdate: 2, shopUnlist: 1, shopReport: 2, modShopRemove: 2, shopCatalog: 0, trades: 0, tradeInventory: 1, tradeOffer: 1, tradeDecide: 2 \}\);/);
  assert.match(main, /ipcMain\.handle\("hub:shop", async \(_event, payload\) => hubShop\(String\(payload\?\.method \?\? ""\), Array\.isArray\(payload\?\.args\) \? payload\.args : \[\]\)\);/);
  assert.match(preload, /hubShop: \(method, \.\.\.args\) => ipcRenderer\.invoke\("hub:shop", \{/);
  assert.equal((main.match(/process\.env\.MEFI_STUDIO_SHOP_ALL/g) ?? []).length, 1, "the switch is read once");
  assert.match(main, /const SHOP_ALL = typeof process !== "undefined" && process\.env\.MEFI_STUDIO_SHOP_ALL === "1";/, "read guarded: some suites run this part of main.cjs in a vm with no process");
  const h = host();
  assert.deepEqual(Object.keys(h.api.HUB_SHOP_METHODS), METHODS);
  for (const [method, args] of [["nope", []], ["__proto__", []], ["toString", []], ["shopOwned", ["x"]], ["shopBuy", ["studio:fx-embers", 90, 0, "extra"]], ["shopPublish", [{}, {}]], ["shop", "studio"], ["shopCatalog", ["studio"]]]) {
    assert.deepEqual(plain(await h.api.hubShop(method, args)), { ok: false, error: "bad-request" }, `${method} with ${JSON.stringify(args)}`);
  }
  assert.equal(h.calls.length, 0);
  await h.api.hubShop("shop", ["top", "30"]);
  await h.api.hubShop("shopBuy", ["studio:fx-embers", 90]);
  await h.api.hubShop("shopBuy", ["pack_AbCdEfGhIjKlMnOp", 0, 15]);
  await h.api.hubShop("shopUnlist", ["pack_AbCdEfGhIjKlMnOp"]);
  assert.deepEqual(plain(h.calls), [["shop", "top", "30"], ["shopBuy", "studio:fx-embers", 90], ["shopBuy", "pack_AbCdEfGhIjKlMnOp", 0, 15], ["shopUnlist", "pack_AbCdEfGhIjKlMnOp"]], "a tip is the third argument");
});

test("one object of fields crosses as plain data: a pack's data and its palette copied, anything deeper null with its key kept", async () => {
  const h = host();
  const data = { v: 1, palette: { accent: "#4f8cff", text: "#e8eef7", glow: { css: "x" } }, nodeStyle: { evil: true }, font: "mono" };
  const fields = { name: "Neon", price: 0, data, extra: { y: 1 }, list: [1, 2], at: () => 1 };
  await h.api.hubShop("shopPublish", [fields]);
  const [[, sent]] = h.calls;
  assert.deepEqual(plain(sent), { name: "Neon", price: 0, data: { v: 1, palette: { accent: "#4f8cff", text: "#e8eef7", glow: null }, nodeStyle: null, font: "mono" }, extra: null, list: null, at: null },
    "the relay's pack check still sees every key, so it refuses them rather than never knowing");
  assert.notEqual(sent, fields);
  assert.notEqual(sent.data, data, "a copy, never the renderer's own objects");
  assert.notEqual(sent.data.palette, data.palette);
  // A second object in the same call is not taken.
  await h.api.hubShop("shopReport", [{ reason: "spam" }, { reason: "again" }]);
  assert.deepEqual(plain(h.calls.at(-1)), ["shopReport", { reason: "spam" }, null]);
  // A "__proto__" key, as JSON reads it, stays a plain key and touches no prototype.
  await h.api.hubShop("shopUpdate", ["pack_AbCdEfGhIjKlMnOp", JSON.parse('{"__proto__": {"polluted": true}, "name": "Neon"}')]);
  const [, , copied] = h.calls.at(-1);
  assert.equal(Object.getPrototypeOf(copied), Object.prototype);
  assert.equal(copied.polluted, undefined);
  assert.equal(({}).polluted, undefined);
  assert.equal(copied.name, "Neon");
});

// An item as both lists name it: what the showroom shows and the rotation reads.
const mirrored = (item) => ({ id: item.id, kind: item.kind, name: item.name, price: item.price, blurb: item.blurb, drop: item.drop ?? null, data: item.data ? plain(item.data) : null });

test("MEFI_STUDIO_SHOP_ALL=1 answers every Studio item as owned with no relay, and the list matches the relay's catalog", async () => {
  const studio = CATALOG.map(mirrored);
  assert.deepEqual(plain(host().api.SHOP_STUDIO_ITEMS.map(mirrored)), studio, "main's Studio items are the relay's CATALOG: ids, kinds, names, prices, lines, drops and the packs' data");
  assert.ok(host().api.SHOP_STUDIO_ITEMS.every((item) => Number.isInteger(item.price) && typeof item.blurb === "string" && item.blurb.endsWith(".")), "every item has its price and its line");
  const all = host({ MEFI_STUDIO_SHOP_ALL: "1" });
  const answer = await all.api.hubShop("shopOwned", []);
  assert.equal(answer.ok, true);
  assert.equal(answer.all, true);
  assert.deepEqual(plain(answer.items), studio.map(({ id, kind, name, data }) => ({ id, kind, name, data, updatedAt: null })));
  assert.equal(all.calls.length, 0, "no relay asked");
  const synthwave = (items) => items.find((item) => item.id === "studio:pack-synthwave");
  synthwave(answer.items).data.palette.accent = "#000000";
  assert.equal(synthwave(all.api.SHOP_STUDIO_ITEMS).data.palette.accent, "#ff4fa3", "each answer is a copy");
  assert.ok(!answer.items.some((item) => item.id === "studio:pet-dragon"), "Ember is free in every Studio, so not a Shop item");
  await all.api.hubShop("shop", ["studio"]);
  assert.deepEqual(plain(all.calls), [["shop", "studio"]], "only shopOwned is answered here; the rest still asks the relay");
  const off = host({ MEFI_STUDIO_SHOP_ALL: "true" });
  await off.api.hubShop("shopOwned", []);
  assert.deepEqual(plain(off.calls), [["shopOwned"]], "only 1 turns it on");
});

// The relay's rotation (relay/src/shop-drops.mjs) and main's mirror of it, on the same items, drops and times.
const t = (iso) => Date.parse(iso);
const testItem = (id, kind, extra = {}) => ({ id, kind, name: id.slice(7), price: 40, blurb: `${id}.`, data: null, drop: null, ...extra });
const testDrop = (id, from, until, returning = []) => ({ id, name: `Drop ${id}`, blurb: "A test drop.", from, until, colors: { accent: "#ff8a3d", accent2: "#9b6bff", background: "#140d1c" }, returning });
const TEST_DROPS = [testDrop("2026-10", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"), testDrop("2026-11", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"), testDrop("2027-01", "2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z", ["studio:pet-wisp"])];
const TEST_CATALOG = [testItem("studio:skin-frost", "skin"), testItem("studio:fx-dissolve", "effect"), testItem("studio:style-dragonscale", "nodestyle"), testItem("studio:pack-synthwave", "pack"), testItem("studio:skin-gold", "skin"), testItem("studio:pet-wisp", "pet", { drop: "2026-10" }), testItem("studio:style-lanterns", "nodestyle", { drop: "2026-11" })];
const TIMES = ["2026-09-30T23:59:59.999Z", "2026-10-01T00:00:00Z", "2026-10-07T12:00:00Z", "2026-10-31T23:59:59.999Z", "2026-11-01T00:00:00Z", "2026-12-15T00:00:00Z", "2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z", "2021-01-03T23:00:00Z", "2024-12-30T00:00:00Z"].map(t);

test("main's drops are the relay's DROPS, and its rotation rules answer as the relay's do on the same items and times", () => {
  const { api } = host();
  assert.deepEqual(plain(api.SHOP_DROPS), plain(DROPS), "ids, names, lines, times, colours and returning items");
  for (const at of [...TIMES, ...Array.from({ length: 120 }, (_, week) => t("2026-01-05T09:00:00Z") + week * 7 * 86_400_000 + (week % 7) * 86_400_000)]) {
    for (const item of TEST_CATALOG) {
      assert.deepEqual(plain(api.shopSaleOf(item, at, TEST_DROPS)), saleOf(item, at, TEST_DROPS), `${item.id} at ${new Date(at).toISOString()}`);
      assert.deepEqual(plain(api.shopWindows(item, TEST_DROPS)), windowsOf(item, TEST_DROPS));
    }
    assert.deepEqual(plain(api.shopDropsAt(at, TEST_DROPS, TEST_CATALOG)), dropsAt(at, TEST_DROPS, TEST_CATALOG), `the drops at ${new Date(at).toISOString()}`);
    assert.deepEqual(plain(api.shopIsoWeek(at)), isoWeek(at));
    assert.deepEqual(plain(api.shopFeaturedAt(TEST_CATALOG, at)), featuredAt(TEST_CATALOG, at), `the Featured shelf at ${new Date(at).toISOString()}`);
    assert.deepEqual(plain(api.shopFeaturedAt(api.SHOP_STUDIO_ITEMS, at)), featuredAt(CATALOG, at), "and on the real catalog");
    assert.deepEqual(plain(api.shopDropsAt(at)), dropsAt(at, DROPS, CATALOG), "and on the real drops");
  }
});

test("shopCatalog is the signed-out showroom's list, answered here with no relay: what is on sale now, with prices, lines, drops and the Featured shelf", async () => {
  const h = host();
  const answer = plain(await h.api.hubShop("shopCatalog", []));
  assert.equal(h.calls.length, 0, "no relay asked, signed in or not");
  assert.deepEqual([answer.ok, answer.local, answer.view, answer.next], [true, true, "studio", null]);
  const at = Date.now();
  assert.deepEqual(answer.items.map((item) => item.id), CATALOG.filter((item) => saleOf(item, at).available).map((item) => item.id));
  const frost = answer.items.find((item) => item.id === "studio:skin-frost");
  assert.deepEqual(frost, { id: "studio:skin-frost", kind: "skin", name: "Frost scales", blurb: "Ember in icy blue.", price: 40, requires: null, maker: null, data: null, sales: null, owned: false, status: "listed", drop: null, available: true, leaves: null });
  assert.deepEqual(answer.items.find((item) => item.id === "studio:pack-deep-sea").data, plain(CATALOG.find((item) => item.id === "studio:pack-deep-sea").data));
  assert.equal(answer.featured.length, 4);
  assert.ok(answer.featured.every((id) => answer.items.some((item) => item.id === id)));
  assert.ok("current" in answer.drops && "next" in answer.drops && "last" in answer.drops);
  // At a time of its own, on test items and drops: an item of a drop shows with when it leaves; one not started is hidden.
  const october = plain(h.api.hubShopCatalog(t("2026-10-07T12:00:00Z"), TEST_CATALOG, TEST_DROPS));
  assert.deepEqual(october.items.map((item) => item.id), ["studio:skin-frost", "studio:fx-dissolve", "studio:style-dragonscale", "studio:pack-synthwave", "studio:skin-gold", "studio:pet-wisp"]);
  assert.deepEqual(october.items.at(-1).leaves, "2026-11-01T00:00:00Z");
  assert.deepEqual([october.drops.current.id, october.drops.current.items, october.drops.next.id], ["2026-10", ["studio:pet-wisp"], "2026-11"]);
  answer.items[0].name = "changed";
  assert.equal(h.api.SHOP_STUDIO_ITEMS[0].name, "Frost scales", "each answer is a copy");
});

test("the preload bridge copies a Shop call's arguments by the same rule", () => {
  const start = preload.indexOf("// The Shop's calls (main.cjs HUB_SHOP_METHODS)");
  const end = preload.indexOf("const api = {", start);
  assert.ok(start > 0 && end > start, "preload.cjs has the Shop's argument copy");
  const context = vm.createContext({});
  vm.runInContext(`${preload.slice(start, end)}\nthis.shopArg = shopArg;`, context);
  const { shopArg } = context;
  assert.deepEqual(plain(shopArg({ name: "Neon", data: { v: 1, palette: { accent: "#4f8cff", deeper: { x: 1 } }, font: ["mono"] }, other: { x: 1 } })), { name: "Neon", data: { v: 1, palette: { accent: "#4f8cff", deeper: null }, font: null }, other: null });
  assert.deepEqual([shopArg("studio:skin-frost"), shopArg(150), shopArg(null), shopArg(() => 1), shopArg([1])], ["studio:skin-frost", 150, null, null, null]);
  assert.match(preload, /args: args\.slice\(0, 3\)\.map\(shopArg\),/, "as many as the longest call, shopBuy's item, price and tip");
});
