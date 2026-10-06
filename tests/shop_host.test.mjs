import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { CATALOG } from "../relay/src/shop.mjs";

// main.cjs's Shop gate (the "Rooms hub" block) in a vm: only the listed
// methods, at most their arguments, one object of fields copied as plain data
// (a pack's data and palette too), MEFI_STUDIO_SHOP_ALL answering every
// Studio item without a relay, and its list of Studio items kept equal to the
// relay's catalog. Then the preload bridge's own copy of the same rule.

const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const preload = (await readFile(new URL("../preload.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("// ---- Rooms hub: listen together and now playing");
const to = main.indexOf("// ---- end of the rooms hub", from);
assert.ok(from > 0 && to > from, "main.cjs has a Rooms hub block");
const block = main.slice(from, to);
const METHODS = ["shop", "shopOwned", "shopBuy", "shopPublish", "shopUpdate", "shopUnlist", "shopReport", "modShopRemove"];

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
  vm.runInContext(`${block}\nthis.api = { hubShop, HUB_SHOP_METHODS, SHOP_STUDIO_ITEMS };`, context);
  return { api: context.api, calls };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test("main lets the renderer call only the Shop's methods, with the hub client's own arity", async () => {
  assert.match(main, /const HUB_SHOP_METHODS = Object\.freeze\(\{ shop: 2, shopOwned: 0, shopBuy: 3, shopPublish: 1, shopUpdate: 2, shopUnlist: 1, shopReport: 2, modShopRemove: 2 \}\);/);
  assert.match(main, /ipcMain\.handle\("hub:shop", async \(_event, payload\) => hubShop\(String\(payload\?\.method \?\? ""\), Array\.isArray\(payload\?\.args\) \? payload\.args : \[\]\)\);/);
  assert.match(preload, /hubShop: \(method, \.\.\.args\) => ipcRenderer\.invoke\("hub:shop", \{/);
  assert.equal((main.match(/process\.env\.MEFI_STUDIO_SHOP_ALL/g) ?? []).length, 1, "the switch is read once");
  const h = host();
  assert.deepEqual(Object.keys(h.api.HUB_SHOP_METHODS), METHODS);
  for (const [method, args] of [["nope", []], ["__proto__", []], ["toString", []], ["shopOwned", ["x"]], ["shopBuy", ["studio:fx-embers", 90, 0, "extra"]], ["shopPublish", [{}, {}]], ["shop", "studio"]]) {
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

test("MEFI_STUDIO_SHOP_ALL=1 answers every Studio item as owned with no relay, and the list matches the relay's catalog", async () => {
  const studio = CATALOG.map((item) => ({ id: item.id, kind: item.kind, name: item.name, ...(item.data ? { data: plain(item.data) } : {}) }));
  assert.deepEqual(plain(host().api.SHOP_STUDIO_ITEMS), studio, "main's Studio items are the relay's CATALOG: ids, kinds, names and the packs' data");
  const all = host({ MEFI_STUDIO_SHOP_ALL: "1" });
  const answer = await all.api.hubShop("shopOwned", []);
  assert.equal(answer.ok, true);
  assert.equal(answer.all, true);
  assert.deepEqual(plain(answer.items), studio.map((item) => ({ ...item, data: item.data ?? null, updatedAt: null })));
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
