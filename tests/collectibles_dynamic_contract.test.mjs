import assert from "node:assert/strict";
import test from "node:test";
import contract from "../scripts/collectibles-contract.cjs";
import hub from "../scripts/hub-client.cjs";

const USER = { id: "123456789012345678", name: "Mefi" };
const MAKER = "234567890123456789";
const HASH = "a".repeat(64);
const QUOTE_ID = `quote_${"b".repeat(32)}`;
const PACK_ID = "pack_AbCdEfGhIjKlMnOp";
const DESIGN_ID = "design_AbCdEfGhIjKlMnOp";
const RECIPE = "dynamic:companions:small";
const FEATURES = ["collectibles.1", "collectibles.crates.1"];
const QUOTE_REQUEST = { recipeId: RECIPE, requestId: "quote_request_1", communityOptIn: true };
const OPEN_REQUEST = { quoteId: QUOTE_ID, requestId: "open_request_1", price: 40, poolVersion: HASH, communityOptIn: true };
const WEIGHTS = { common: 9999, legendary: 1 };
const look = { body: "cloud", primary: "#ffffff", secondary: "#77aaff", motif: "stars" };
const copy = (value) => structuredClone(value);

function recipes() {
  return { ok: true, version: 1, topics: [{ id: "companions", name: "Companions" }], tiers: [{ id: "small", name: "Small", budget: 50, rewardCount: 2 }],
    recipes: [{ id: RECIPE, topicId: "companions", tierId: "small", budget: 50, count: 2, available: true }], now: 1000 };
}
function quote() {
  return { ok: true, replayed: false, quote: {
    id: QUOTE_ID, recipeId: RECIPE, expiresAt: 301000, budget: 50, price: 40, unspentBudget: 10, count: 2, requiresOptIn: true,
    poolVersion: HASH, selection: "uniform-without-replacement", creatorShare: 0.75,
    slots: [{ index: 0, price: 20, poolId: "price-20" }, { index: 1, price: 20, poolId: "price-20" }],
    pools: [{ id: "price-20", price: 20, candidates: [
      { type: "collectible", id: DESIGN_ID, kind: "pet", name: "Cloudling", makerId: MAKER, rarityWeights: copy(WEIGHTS) },
      { type: "catalog-license", id: "studio:skin-frost", kind: "skin", name: "Frost", makerId: null },
      { type: "community-pack-license", id: PACK_ID, kind: "pack", name: "Night", makerId: MAKER },
    ], selectionChance: { numerator: 1, denominator: 3 }, rarityWeightsTotal: copy(WEIGHTS), rarityDenominator: 30000, collectibleRarityDenominator: 10000, collectibleCount: 1 }],
  } };
}
function instance() {
  return { id: "item_AbCdEfGhIjKlMnOp", definitionId: DESIGN_ID, kind: "pet", name: "Cloudling", blurb: "A cloud companion", visual: copy(look), bound: false,
    rarity: "legendary", quality: 92, traits: [], bornAt: 1000, careDays: 0, stage: "baby",
    growth: { stage: "baby", ageDays: 0, careDays: 0, nextStageDays: 3, sizes: ["tiny"] }, sizes: ["tiny"], unlockedSizes: ["tiny"], size: "tiny",
    ownerId: USER.id, tradeHoldUntil: 3601000, listingId: null, caredToday: false };
}
function shopItem() {
  return { id: "studio:skin-frost", kind: "skin", name: "Frost", blurb: "Cool colours", price: 20, requires: null, maker: null, data: null,
    sales: 1, owned: true, status: "listed", createdAt: 1000, updatedAt: 1000, drop: null, available: true, leaves: null };
}
function receipt() {
  return { ok: true, receiptId: `crate_${"c".repeat(32)}`, quoteId: QUOTE_ID, paid: 40, balance: 60, rewards: [
    { type: "collectible", item: instance(), paid: 20 }, { type: "catalog-license", item: shopItem(), paid: 20 },
  ], replayed: false };
}
function contributions() {
  return { ok: true, topics: recipes().topics, items: [{ type: "collectible", id: DESIGN_ID, kind: "pet", name: "Cloudling", makerId: MAKER,
    price: 20, rarityWeights: copy(WEIGHTS), termsVersion: HASH, consent: { enabled: true, topics: ["companions"] } }], next: null };
}
const normalizeQuote = (value) => contract.dynamicResponse("crateQuote", value, { payload: QUOTE_REQUEST });
const normalizeReceipt = (value) => contract.dynamicResponse("crateOpen", value, { payload: OPEN_REQUEST, shopItem: hub.itemCard });

test("dynamic action requests require exact fields, explicit consent and bounded immutable identifiers", () => {
  assert.deepEqual(contract.request("crateRecipes"), { method: "GET", path: "/v1/collectibles/crate-recipes" });
  assert.deepEqual(contract.request("crateContributions"), { method: "GET", path: "/v1/collectibles/crate-contributions" });
  assert.deepEqual(contract.request("crateQuote", QUOTE_REQUEST), { method: "POST", path: "/v1/collectibles/crate-quote", body: QUOTE_REQUEST });
  assert.deepEqual(contract.request("crateOpen", OPEN_REQUEST), { method: "POST", path: "/v1/collectibles/crate-open", body: OPEN_REQUEST });
  for (const payload of [
    { ...QUOTE_REQUEST, recipeId: [RECIPE] }, { ...QUOTE_REQUEST, requestId: "short" }, { ...QUOTE_REQUEST, recipeId: "../admin" },
    { ...QUOTE_REQUEST, communityOptIn: "true" }, { ...QUOTE_REQUEST, rarity: "legendary" }, { recipeId: RECIPE, requestId: "request_1" },
  ]) assert.equal(contract.request("crateQuote", payload), null);
  for (const payload of [
    { ...OPEN_REQUEST, poolVersion: HASH.toUpperCase() }, { ...OPEN_REQUEST, poolVersion: HASH.slice(1) },
    { ...OPEN_REQUEST, price: 1001 }, { ...OPEN_REQUEST, price: 0.5 }, { ...OPEN_REQUEST, quoteId: "quote_bad" },
    { ...OPEN_REQUEST, ownerId: USER.id }, { ...OPEN_REQUEST, communityOptIn: undefined },
  ]) assert.equal(contract.request("crateOpen", payload), null);
  assert.equal(contract.request("crateRecipes", { budget: 1 }), null);
  assert.equal(contract.isDynamicAction("__proto__"), false);
  assert.equal(contract.isDynamicAction("open"), false);
});

test("contribution changes have separate maker consent and cannot rewrite legacy inCrates", () => {
  const payload = { type: "collectible", id: DESIGN_ID, enabled: true, topics: ["companions"], termsVersion: HASH };
  assert.deepEqual(contract.request("updateCrateContribution", payload), { method: "PUT", path: `/v1/collectibles/crate-contributions/collectible/${DESIGN_ID}`,
    body: { enabled: true, topics: ["companions"], termsVersion: HASH } });
  assert.ok(contract.request("updateCrateContribution", { ...payload, type: "community-pack-license", id: PACK_ID }));
  assert.ok(contract.request("updateCrateContribution", { ...payload, enabled: false, topics: [] }));
  for (const update of [
    { type: "catalog-license" }, { id: "../admin" }, { id: PACK_ID }, { itemId: DESIGN_ID }, { inCrates: false },
    { topics: [] }, { topics: ["companions", "companions"] }, { topics: ["../topic"] }, { topics: Array.from({ length: 17 }, (_, i) => `topic-${i}`) }, { termsVersion: "old" },
  ]) assert.equal(contract.request("updateCrateContribution", { ...payload, ...update }), null);
});

test("recipe DTO preserves server budgets, and rejects inconsistent or duplicate recipe references", () => {
  assert.deepEqual(contract.dynamicResponse("crateRecipes", recipes()), recipes());
  assert.deepEqual(contract.dynamicResponse("crateRecipes", { ok: true, version: 1, topics: [], tiers: [], recipes: [], now: 0 }),
    { ok: true, version: 1, topics: [], tiers: [], recipes: [], now: 0 });
  for (const mutate of [
    (v) => { v.recipes[0].budget = 1; }, (v) => { v.recipes[0].count = 1; }, (v) => { v.recipes[0].topicId = "other"; },
    (v) => v.recipes.push(copy(v.recipes[0])), (v) => v.topics.push(copy(v.topics[0])), (v) => { v.tiers[0].rewardCount = 5; },
    (v) => { v.topics[0].name = "Two\nlines"; }, (v) => { v.version = 2; },
  ]) { const data = recipes(); mutate(data); assert.equal(contract.dynamicResponse("crateRecipes", data), null); }
});

test("quote preserves exact 1-in-30000 odds and strips all private terms", () => {
  const data = quote();
  data.billingCustomer = "private";
  data.quote.pools[0].candidates[0].terms = { price: 20, private: "not UI" };
  const result = normalizeQuote(data);
  assert.deepEqual(result, quote());
  assert.equal(result.quote.pools[0].rarityWeightsTotal.legendary, 1);
  assert.equal(result.quote.pools[0].rarityDenominator, 30000);
  assert.equal(result.quote.pools[0].collectibleRarityDenominator, 10000);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("a malformed quote is refused whole rather than silently filtering candidates or changing odds", () => {
  for (const mutate of [
    (v) => { v.quote.pools[0].candidates[0].rarityWeights = { legendary: 1 }; },
    (v) => { v.quote.pools[0].candidates[1].rarityWeights = { none: 10000 }; },
    (v) => { v.quote.pools[0].rarityWeightsTotal = { common: 9998, legendary: 2 }; },
    (v) => { v.quote.pools[0].rarityDenominator = 10000; }, (v) => { v.quote.pools[0].collectibleRarityDenominator = 30000; },
    (v) => { v.quote.pools[0].selectionChance.denominator = 2; }, (v) => { v.quote.pools[0].collectibleCount = 2; },
    (v) => { v.quote.pools[0].candidates[2] = copy(v.quote.pools[0].candidates[1]); },
    (v) => { v.quote.slots[1].index = 0; }, (v) => { v.quote.slots[1].poolId = "missing"; },
    (v) => { v.quote.slots[1].price = 19; }, (v) => { v.quote.count = 1; }, (v) => { v.quote.unspentBudget = 9; },
    (v) => { v.quote.requiresOptIn = false; }, (v) => { v.quote.selection = "weighted"; },
    (v) => { v.quote.recipeId = "dynamic:companions:other"; }, (v) => { v.quote.poolVersion = "old"; },
    (v) => { v.quote.pools[0].candidates[0].terms = "é".repeat(32768); },
  ]) { const data = quote(); mutate(data); assert.equal(normalizeQuote(data), null); }
  assert.equal(contract.dynamicResponse("crateQuote", quote(), { payload: { ...QUOTE_REQUEST, communityOptIn: false } }), null);
});

test("license-only pools publish zero conditional denominator and free slots retain exact count", () => {
  const data = quote();
  const pool = data.quote.pools[0];
  pool.candidates.shift(); pool.rarityWeightsTotal = {}; pool.collectibleCount = 0;
  pool.rarityDenominator = 20000; pool.collectibleRarityDenominator = 0; pool.selectionChance.denominator = 2;
  assert.ok(normalizeQuote(data));
  pool.price = 0; data.quote.price = 0; data.quote.budget = 0; data.quote.unspentBudget = 0;
  data.quote.slots.forEach((slot) => { slot.price = 0; });
  assert.ok(normalizeQuote(data));
  data.quote.budget = 50; data.quote.unspentBudget = 50;
  assert.equal(normalizeQuote(data), null);
  const mixed = quote();
  const freePool = { ...copy(pool), id: "free", candidates: [pool.candidates[1]], selectionChance: { numerator: 1, denominator: 1 }, rarityDenominator: 10000 };
  mixed.quote.pools[0].candidates.pop(); mixed.quote.pools[0].selectionChance.denominator = 2; mixed.quote.pools[0].rarityDenominator = 20000;
  mixed.quote.pools.push(freePool); mixed.quote.slots.push({ index: 2, price: 0, poolId: "free" }); mixed.quote.count = 3;
  assert.ok(normalizeQuote(mixed));
});

test("quote candidate caps and without-replacement capacity reject instead of truncating", () => {
  const data = quote(), pool = data.quote.pools[0];
  pool.candidates = Array.from({ length: 128 }, (_, i) => ({ type: "catalog-license", id: `studio:item-${i}`, kind: "skin", name: `Skin ${i}`, makerId: null }));
  pool.selectionChance.denominator = 128; pool.rarityWeightsTotal = {}; pool.rarityDenominator = 1280000; pool.collectibleRarityDenominator = 0; pool.collectibleCount = 0;
  data.quote.requiresOptIn = false;
  assert.ok(normalizeQuote(data));
  pool.candidates.push({ type: "catalog-license", id: "studio:extra", kind: "skin", name: "Extra", makerId: null });
  pool.selectionChance.denominator = 129; pool.rarityDenominator = 1290000;
  assert.equal(normalizeQuote(data), null);
  pool.candidates.splice(1); pool.selectionChance.denominator = 1; pool.rarityDenominator = 10000;
  assert.equal(normalizeQuote(data), null);
});

test("mixed receipts keep original inventory and Shop shapes, never private payment data", () => {
  const data = receipt();
  data.detail = { payouts: [20], customer: "private" };
  data.rewards[0].item.private = true;
  data.rewards[1].item.private = true;
  assert.deepEqual(normalizeReceipt(data), receipt());
  const pack = data.rewards[1];
  pack.type = "community-pack-license"; pack.item.id = PACK_ID; pack.item.kind = "pack"; pack.item.maker = { id: MAKER, name: "Maker" };
  pack.item.data = { v: 1, palette: { accent: "#4f8cff", background: "#0b0f17", surface: "#151b26", text: "#e8eef7" }, javascript: "not allowed" };
  assert.ok(normalizeReceipt(data));
  assert.equal(normalizeReceipt(data).rewards[1].item.data.javascript, undefined);
});

test("receipt rejects mismatched quotes, invalid visuals, repeated definitions and unowned licenses", () => {
  for (const mutate of [
    (v) => { v.quoteId = `quote_${"d".repeat(32)}`; }, (v) => { v.paid = 39; }, (v) => { v.rewards[0].paid = 19; },
    (v) => { v.rewards[0].type = "cash"; }, (v) => { v.rewards[0].item.visual.body = "https://example.test"; },
    (v) => { v.rewards[0].item.size = "large"; }, (v) => { v.rewards[1].item.owned = false; },
    (v) => { v.rewards[1] = copy(v.rewards[0]); v.rewards[1].item.id = "item_other"; },
    (v) => { v.rewards[1] = copy(v.rewards[0]); v.rewards[1].item.definitionId = "other_definition"; },
    (v) => { v.rewards[1].type = "community-pack-license"; }, (v) => { v.rewards = []; },
    (v) => { v.balance = Infinity; }, (v) => { v.replayed = "true"; },
  ]) { const data = receipt(); mutate(data); assert.equal(normalizeReceipt(data), null); }
});

test("funded income has no artificial receipt ceiling within exact integer representation", () => {
  for (const balance of [0, 1000000000001, Number.MAX_SAFE_INTEGER]) {
    const data = receipt(); data.balance = balance;
    assert.equal(normalizeReceipt(data).balance, balance);
    assert.equal(contract.dynamicError({ error: "short", data: { balance } }).balance, balance);
  }
  for (const balance of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "1000000000001"]) {
    const data = receipt(); data.balance = balance;
    assert.equal(normalizeReceipt(data), null);
    assert.equal(contract.dynamicError({ error: "short", data: { balance } }).balance, undefined);
  }
});

test("contributions retain only named immutable terms and consent in bounded ordered pages", () => {
  const data = contributions();
  data.items[0].terms = { private: true };
  assert.deepEqual(contract.dynamicResponse("crateContributions", data), contributions());
  for (const mutate of [
    (v) => { v.items[0].termsVersion = "old"; }, (v) => { v.items[0].makerId = null; },
    (v) => { v.items[0].consent.topics = ["companions", "companions"]; }, (v) => { v.items[0].type = "catalog-license"; },
    (v) => v.items.push(copy(v.items[0])), (v) => { v.items[0].price = 251; },
  ]) { const changed = contributions(); mutate(changed); assert.equal(contract.dynamicResponse("crateContributions", changed), null); }
  data.items = Array.from({ length: 49 }, (_, i) => ({ ...copy(data.items[0]), id: `design_${String(i).padStart(16, "0")}` }));
  assert.equal(contract.dynamicResponse("crateContributions", data), null);
  const changed = { ok: true, enabled: false, topics: [], termsVersion: HASH };
  assert.deepEqual(contract.dynamicResponse("updateCrateContribution", changed, { payload: changed }), changed);
  assert.equal(contract.dynamicResponse("updateCrateContribution", changed, { payload: { ...changed, enabled: true } }), null);
});

test("contribution pagination binds exact cursor, page size and stable forward progress", () => {
  const first = contributions(), cursor = `collectible:${DESIGN_ID}`;
  first.next = cursor;
  assert.equal(contract.dynamicResponse("crateContributions", first, { payload: { limit: 1 } }).next, cursor);
  const second = { ok: true, topics: recipes().topics, next: null, items: [{ type: "community-pack-license", id: PACK_ID, kind: "pack", name: "Night", makerId: MAKER,
    price: 20, termsVersion: HASH, consent: { enabled: false, topics: [] } }] };
  assert.deepEqual(contract.dynamicResponse("crateContributions", second, { payload: { cursor, limit: 1 } }), second);
  assert.deepEqual(contract.request("crateContributions", { cursor, limit: 1 }), { method: "GET", path: `/v1/collectibles/crate-contributions?cursor=${encodeURIComponent(cursor)}&limit=1` });
  assert.deepEqual(contract.request("crateContributions", { cursor: null }), { method: "GET", path: "/v1/collectibles/crate-contributions" });
  for (const payload of [{ cursor: [] }, { cursor: "" }, { cursor: "../admin" }, { cursor: `${cursor}&limit=500` }, { limit: 0 }, { limit: 101 }, { limit: 0.5 }, { limit: "1" }, { ownerId: MAKER }])
    assert.equal(contract.request("crateContributions", payload), null);
  for (const mutate of [
    (v) => { v.next = "../admin"; }, (v) => { delete v.next; }, (v) => { v.next = `community-pack-license:${PACK_ID}`; },
    (v) => { v.items = []; }, (v) => { v.items.push(copy(v.items[0])); },
  ]) { const changed = copy(first); mutate(changed); assert.equal(contract.dynamicResponse("crateContributions", changed, { payload: { limit: 1 } }), null); }
  assert.equal(contract.dynamicResponse("crateContributions", first, { payload: { cursor, limit: 1 } }), null);
  assert.equal(contract.dynamicResponse("crateContributions", first), null); // A full default page is required when more rows are declared.
});

test("dynamic replies enforce UTF-8 byte limits before crossing IPC", () => {
  const data = recipes(); data.private = "é".repeat(524288);
  assert.equal(contract.dynamicResponse("crateRecipes", data), null);
  const cycle = recipes(); cycle.loop = cycle;
  assert.equal(contract.dynamicResponse("crateRecipes", cycle), null);
});

const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((done) => setImmediate(done)); };
function harness({ features = FEATURES, answer = () => ({ status: 200, body: recipes() }) } = {}) {
  const calls = [], sockets = [], sent = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); }
    send(frame) { sent.push(JSON.parse(frame)); }
    close() { this.readyState = 3; }
  }
  const fetch = async (href, init) => {
    const url = new URL(href);
    const respond = (reply) => ({ ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body });
    if (init.method === "POST" && url.pathname === "/v1/session") return respond({ status: 200, body: { ok: true, session: "hub-session", expiresAt: Date.now() + 900000, user: USER } });
    const call = { method: init.method, path: `${url.pathname}${url.search}`, body: init.body === undefined ? undefined : JSON.parse(init.body) };
    calls.push(call); return respond(await answer(call));
  };
  const client = hub.createHubClient({ url: "https://hub.example.test", fetch, WebSocket: FakeSocket, getAccessToken: async () => ({ ok: true, token: "discord-access" }),
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} });
  async function ready() {
    await client.connect(); const socket = sockets.at(-1); socket.readyState = 1; socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: "ready", user: USER, protocol: 1, features }) }); await settle();
  }
  return { client, calls, sent, ready };
}

test("both capabilities are required for every dynamic action before HTTP", async () => {
  for (const features of [[], ["collectibles.1"], ["collectibles.crates.1"]]) {
    const h = harness({ features }); await h.ready();
    assert.equal(h.client.status().dynamicCrates, false);
    for (const action of ["crateRecipes", "crateQuote", "crateOpen", "crateContributions", "updateCrateContribution"])
      assert.deepEqual(await h.client.collectibles(action, {}), { ok: false, error: "unsupported" });
    assert.equal(h.calls.length, 0);
  }
  const h = harness(); await h.ready();
  assert.equal(h.client.status().dynamicCrates, true);
  assert.ok(h.sent.find((frame) => frame.type === "hello").features.includes("collectibles.crates.1"));
  assert.deepEqual(await h.client.collectibles("crateRecipes"), recipes());
  assert.deepEqual(h.calls, [{ method: "GET", path: "/v1/collectibles/crate-recipes", body: undefined }]);
  await h.client.disconnect(); assert.equal(h.client.status().dynamicCrates, false);
});

test("dynamic transport sends exact quote/open requests and preserves caller retry IDs", async () => {
  const h = harness({ answer: (call) => ({ status: 200, body: call.path.endsWith("crate-quote") ? quote() : { ...receipt(), replayed: true } }) }); await h.ready();
  assert.deepEqual(await h.client.collectibles("crateQuote", QUOTE_REQUEST), quote());
  for (let attempt = 0; attempt < 2; attempt++) assert.deepEqual(await h.client.collectibles("crateOpen", OPEN_REQUEST), { ...receipt(), replayed: true });
  assert.deepEqual(h.calls[1], h.calls[2]);
  assert.deepEqual(h.calls[1], { method: "POST", path: "/v1/collectibles/crate-open", body: OPEN_REQUEST });
  assert.deepEqual(await h.client.collectibles("crateOpen", { ...OPEN_REQUEST, price: NaN }), { ok: false, error: "bad-request" });
  assert.equal(h.calls.length, 3);
});

test("dynamic transport passes bounded contribution cursors and preserves the next page", async () => {
  const data = contributions(); data.next = `collectible:${DESIGN_ID}`;
  const h = harness({ answer: () => ({ status: 200, body: data }) }); await h.ready();
  assert.deepEqual(await h.client.collectibles("crateContributions", { limit: 1 }), data);
  assert.deepEqual(h.calls[0], { method: "GET", path: "/v1/collectibles/crate-contributions?limit=1", body: undefined });
  const cursor = data.next;
  data.items[0].id = "design_QrStUvWxYzAbCdEf";
  data.next = null;
  assert.deepEqual(await h.client.collectibles("crateContributions", { cursor, limit: 1 }), data);
  assert.deepEqual(h.calls[1], { method: "GET", path: `/v1/collectibles/crate-contributions?cursor=${encodeURIComponent(cursor)}&limit=1`, body: undefined });
  data.items[0].id = DESIGN_ID;
  assert.deepEqual(await h.client.collectibles("crateContributions", { cursor, limit: 1 }), { ok: false, error: "bad-response" }, "a repeated page must be rejected against the original cursor");
  assert.deepEqual(await h.client.collectibles("crateContributions", { limit: 101 }), { ok: false, error: "bad-request" });
  assert.equal(h.calls.length, 3);
});

test("changed pools return a bounded refusal without silently requesting a replacement quote", async () => {
  const h = harness({ answer: () => ({ status: 409, body: { ok: false, error: "pool-changed", reason: "terms", balance: 60, poolVersion: HASH,
    needs: "studio:skin-frost", retryAfter: 10, private: "not UI" } }) }); await h.ready();
  assert.deepEqual(await h.client.collectibles("crateOpen", OPEN_REQUEST), { ok: false, error: "pool-changed", reason: "terms", retryAfter: 10, balance: 60, needs: "studio:skin-frost", poolVersion: HASH });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(contract.dynamicError({ error: "x".repeat(200), reason: "x".repeat(200), retryAfter: -1, data: { price: Infinity, balance: -1, needs: "../admin", poolVersion: "old" } }), { ok: false, error: "failed" });
});

test("malformed relay quotes fail closed and legacy collectibles remain compatible", async () => {
  const bad = quote(); bad.quote.pools[0].rarityWeightsTotal.legendary = 0;
  const h = harness({ answer: () => ({ status: 200, body: bad }) }); await h.ready();
  assert.deepEqual(await h.client.collectibles("crateQuote", QUOTE_REQUEST), { ok: false, error: "bad-response" });
  const legacy = harness({ features: ["collectibles.1"], answer: () => ({ status: 200, body: { ok: true, crates: [], inventory: [] } }) }); await legacy.ready();
  assert.deepEqual(await legacy.client.collectibles("list"), { ok: true, crates: [], inventory: [] });
  assert.equal(legacy.calls[0].path, "/v1/collectibles");
});
