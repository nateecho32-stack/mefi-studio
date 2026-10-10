const { actorId, isDiscordSubject } = require("./actor-contract.cjs");
const member = (value, canonical = false) => canonical === true ? actorId(value) : isDiscordSubject(value) ? value : null;
// The desktop collectible boundary. Named actions only, bounded data-only
// requests, and no entitlement, ownership or rolled-rarity assertions from UI.
const ID = /^[A-Za-z0-9_:-]{1,80}$/;
const RARITIES = ["none", "common", "uncommon", "rare", "epic", "legendary"];
const FIELDS = Object.freeze({
  list: [], market: ["cursor"], catalog: ["cursor"], inventory: ["cursor"], open: ["crateId", "requestId", "price", "communityOptIn", "poolVersion"],
  create: ["kind", "name", "blurb", "visual", "rarityWeights", "price", "listed", "inCrates"],
  updateCreation: ["definitionId", "listed"], buyCreation: ["definitionId", "price", "requestId"],
  care: ["instanceId", "action"], updateInstance: ["instanceId", "name", "size"],
  transfer: ["instanceId", "userId"], listItem: ["instanceId", "price"],
  buy: ["listingId", "price"], cancelListing: ["listingId"],
  order: ["kind", "definitionId", "minRarity", "maxRarity", "maxPrice", "mode"],
  cancelOrder: ["orderId"], stickers: ["roomId"], share: ["instanceId", "roomId", "shared"], claim: ["instanceId", "roomId"],
});
const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
function request(action, payload = {}) {
  if (isDynamicAction(action)) return dynamicRequest(action, payload);
  // "list" is the collection read; UI's listing action uses "listItem".
  if (!Object.hasOwn(FIELDS, action) || !plain(payload)) return null;
  if (action === "updateCreation" && Object.keys(payload).some((key) => !FIELDS[action].includes(key))) return null;
  let size;
  try { size = JSON.stringify(payload).length; } catch { return null; }
  if (size > 8192) return null;
  const body = {};
  for (const key of FIELDS[action]) {
    const value = payload[key];
    if (value === undefined) continue;
    if (key === "visual") {
      if (!plain(value)) return null;
      body.visual = Object.fromEntries(["body", "primary", "secondary", "motif", "glyph"].filter((k) => typeof value[k] === "string").map((k) => [k, value[k].slice(0, 32)]));
    } else if (key === "rarityWeights") {
      if (!plain(value) || Object.keys(value).some((k) => !RARITIES.includes(k) || !Number.isInteger(value[k]) || value[k] < 0 || value[k] > 10000)) return null;
      body.rarityWeights = { ...value };
    } else if (/Id$/.test(key)) {
      if (typeof value !== "string" || !ID.test(value)) return null;
      body[key] = value;
    } else if (["price", "maxPrice"].includes(key)) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 1e6) return null;
      body[key] = value;
    } else if (["listed", "shared", "communityOptIn", "inCrates"].includes(key)) {
      if (typeof value !== "boolean") return null;
      body[key] = value;
    } else if (typeof value === "string" && value.length <= (key === "blurb" ? 160 : 128)) body[key] = value;
    else return null;
  }
  const base = "/v1/collectibles";
  const take = (key) => { const value = body[key]; delete body[key]; return value; };
  const sub = (key, path, suffix = "") => { const value = take(key); return value ? `${base}/${path}/${encodeURIComponent(value)}${suffix}` : null; };
  let method = "POST", path;
  switch (action) {
    case "list": method = "GET"; path = base; break;
    case "market": method = "GET"; path = `${base}/market${body.cursor ? `?cursor=${encodeURIComponent(body.cursor)}` : ""}`; break;
    case "catalog": case "inventory": method = "GET"; path = `${base}/${action}${body.cursor ? `?cursor=${encodeURIComponent(body.cursor)}` : ""}`; break;
    case "open": path = `${base}/open`; break;
    case "create": path = `${base}/create`; break;
    case "updateCreation": method = "PUT"; path = sub("definitionId", "creations"); break;
    case "buyCreation": path = sub("definitionId", "creations", "/buy"); break;
    case "care": path = sub("instanceId", "instances", "/care"); break;
    case "updateInstance": method = "PUT"; path = sub("instanceId", "instances"); break;
    case "transfer": path = sub("instanceId", "instances", "/transfer"); break;
    case "listItem": path = `${base}/listings`; break;
    case "buy": path = sub("listingId", "listings", "/buy"); break;
    case "cancelListing": method = "DELETE"; path = sub("listingId", "listings"); break;
    case "order": path = `${base}/orders`; break;
    case "cancelOrder": method = "DELETE"; path = sub("orderId", "orders"); break;
    case "stickers": { method = "GET"; const roomId = take("roomId"); path = roomId ? `/v1/rooms/${encodeURIComponent(roomId)}/stickers` : null; break; }
    case "share": path = sub("instanceId", "instances", "/share"); break;
    case "claim": path = sub("instanceId", "instances", "/claim"); break;
  }
  return path ? { method, path, ...(method === "GET" || method === "DELETE" ? {} : { body }) } : null;
}
function visual(value) {
  if (!plain(value) || !["dragon", "cloud", "phoenix", "wisp"].includes(value.body)
    || !/^#[\da-f]{6}$/i.test(value.primary) || !/^#[\da-f]{6}$/i.test(value.secondary)
    || !["plain", "stars", "sparkles", "stripes"].includes(value.motif)) return null;
  return { body: value.body, primary: value.primary, secondary: value.secondary, motif: value.motif,
    ...(["idea", "rest", "celebrate", "code", "happy", "plan", "curious", "love", "sleep"].includes(value.asset) ? { asset: value.asset } : {}),
    ...(typeof value.glyph === "string" && ["heart", "star", "moon", "spark", "leaf", "wave"].includes(value.glyph) ? { glyph: value.glyph } : {}) };
}
function sticker(value, canonical = false) {
  const look = visual(value?.visual);
  if (!plain(value) || !ID.test(value.id) || !member(value.ownerId, canonical) || !look || !RARITIES.includes(value.rarity) || typeof value.name !== "string") return null;
  return { id: value.id, name: value.name.slice(0, 40), rarity: value.rarity, ownerId: value.ownerId, visual: look };
}
// Dynamic crates use a separately negotiated contract. Reject extra request
// fields rather than silently dropping a price, consent or authority assertion.
const DYNAMIC_FIELDS = Object.freeze({
  crateRecipes: [], crateQuote: ["recipeId", "requestId", "communityOptIn"],
  crateOpen: ["quoteId", "requestId", "price", "poolVersion", "communityOptIn"],
  crateContributions: ["cursor", "limit"], updateCrateContribution: ["type", "id", "enabled", "topics", "termsVersion"],
});
const SLUG = /^[a-z][a-z0-9-]{0,31}$/;
const RECIPE = /^dynamic:[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$/;
const HASH = /^[a-f0-9]{64}$/;
const QUOTE = /^quote_[a-f0-9]{32}$/;
const PACK = /^pack_[A-Za-z0-9_-]{16}$/;
const DESIGN = /^design_[A-Za-z0-9_-]{16}$/;
const CONTRIBUTION_CURSOR = /^(?:collectible:design_|community-pack-license:pack_)[A-Za-z0-9_-]{16}$/;
const STUDIO = /^studio:[a-z0-9-]{1,40}$/;
const SIZES = ["tiny", "small", "medium", "large"];
const matches = (pattern, value) => typeof value === "string" && pattern.test(value);
const integer = (value, max = Number.MAX_SAFE_INTEGER, min = 0) => Number.isSafeInteger(value) && value >= min && value <= max;
const title = (value, max = 60) => typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
const unique = (values) => new Set(values).size === values.length;
const topicIds = (value) => Array.isArray(value) && value.length <= 16 && value.every((id) => matches(SLUG, id)) && unique(value);
const contributionId = (type, id) => type === "collectible" ? matches(DESIGN, id) : type === "community-pack-license" && matches(PACK, id);
function isDynamicAction(action) { return typeof action === "string" && Object.hasOwn(DYNAMIC_FIELDS, action); }
function bytesWithin(value, max) {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8") <= max; } catch { return false; }
}
function dynamicRequest(action, payload) {
  const keys = DYNAMIC_FIELDS[action];
  if (!plain(payload) || !bytesWithin(payload, 8192) || Object.keys(payload).some((key) => !keys.includes(key))) return null;
  const base = "/v1/collectibles";
  if (action === "crateContributions") {
    if (Object.hasOwn(payload, "cursor") && payload.cursor !== null && !matches(CONTRIBUTION_CURSOR, payload.cursor)) return null;
    if (Object.hasOwn(payload, "limit") && !integer(payload.limit, 100, 1)) return null;
    const query = [];
    if (payload.cursor != null) query.push(`cursor=${encodeURIComponent(payload.cursor)}`);
    if (payload.limit != null) query.push(`limit=${payload.limit}`);
    return { method: "GET", path: `${base}/crate-contributions${query.length ? `?${query.join("&")}` : ""}` };
  }
  if (Object.keys(payload).length !== keys.length || keys.some((key) => !Object.hasOwn(payload, key))) return null;
  if (action === "crateRecipes") return { method: "GET", path: `${base}/crate-recipes` };
  if (action === "updateCrateContribution") {
    const { type, id, enabled, topics, termsVersion } = payload;
    if (!contributionId(type, id) || typeof enabled !== "boolean" || !topicIds(topics) || (enabled && !topics.length) || !matches(HASH, termsVersion)) return null;
    return { method: "PUT", path: `${base}/crate-contributions/${type}/${id}`, body: { enabled, topics: [...topics], termsVersion } };
  }
  const { requestId, communityOptIn } = payload;
  if (!matches(/^[A-Za-z0-9_-]{8,80}$/, requestId) || typeof communityOptIn !== "boolean") return null;
  if (action === "crateQuote") {
    if (!matches(RECIPE, payload.recipeId)) return null;
    return { method: "POST", path: `${base}/crate-quote`, body: { recipeId: payload.recipeId, requestId, communityOptIn } };
  }
  if (!matches(QUOTE, payload.quoteId) || !integer(payload.price, 1000) || !matches(HASH, payload.poolVersion)) return null;
  return { method: "POST", path: `${base}/crate-open`, body: { quoteId: payload.quoteId, requestId, price: payload.price, poolVersion: payload.poolVersion, communityOptIn } };
}
function mapAll(values, max, shape, min = 0) {
  if (!Array.isArray(values) || values.length < min || values.length > max) return null;
  const result = values.map(shape);
  return result.some((value) => value === null) ? null : result;
}
function topicsView(values) {
  const result = mapAll(values, 16, (value) => plain(value) && matches(SLUG, value.id) && title(value.name) ? { id: value.id, name: value.name } : null);
  return result && unique(result.map((value) => value.id)) ? result : null;
}
function weightsView(value, total = 10000) {
  if (!plain(value) || Object.keys(value).some((key) => !RARITIES.includes(key) || !integer(value[key], total)) || Object.values(value).reduce((sum, n) => sum + n, 0) !== total) return null;
  return Object.fromEntries(Object.entries(value));
}
function candidateView(value, canonical = false) {
  if (!plain(value) || !matches(ID, value.id) || !title(value.name) || !(value.makerId === null || member(value.makerId, canonical))) return null;
  const { type, id, kind, name, makerId } = value;
  if (type === "collectible") {
    const rarityWeights = weightsView(value.rarityWeights);
    if (!["pet", "sticker"].includes(kind) || !rarityWeights) return null;
    return { type, id, kind, name, makerId, rarityWeights };
  }
  if (type === "community-pack-license" ? !matches(PACK, id) || kind !== "pack" || makerId === null
    : type !== "catalog-license" || !matches(STUDIO, id) || !["pet", "skin", "effect", "nodestyle", "pack"].includes(kind) || makerId !== null) return null;
  if (Object.hasOwn(value, "rarityWeights")) return null;
  return { type, id, kind, name, makerId };
}
function recipesView(value) {
  const topics = topicsView(value.topics);
  const tiers = mapAll(value.tiers, 8, (tier) => plain(tier) && matches(SLUG, tier.id) && title(tier.name) && integer(tier.budget, 1000) && integer(tier.rewardCount, 4, 1)
    ? { id: tier.id, name: tier.name, budget: tier.budget, rewardCount: tier.rewardCount } : null);
  if (value.version !== 1 || !topics || !tiers || !unique(tiers.map((tier) => tier.id)) || !integer(value.now)) return null;
  const recipes = mapAll(value.recipes, 128, (recipe) => {
    if (!plain(recipe) || !matches(RECIPE, recipe.id) || typeof recipe.available !== "boolean") return null;
    const tier = tiers.find((entry) => entry.id === recipe.tierId);
    if (!tier || !topics.some((entry) => entry.id === recipe.topicId) || recipe.id !== `dynamic:${recipe.topicId}:${recipe.tierId}` || recipe.budget !== tier.budget || recipe.count !== tier.rewardCount) return null;
    return { id: recipe.id, topicId: recipe.topicId, tierId: recipe.tierId, budget: recipe.budget, count: recipe.count, available: recipe.available };
  });
  return recipes && unique(recipes.map((recipe) => recipe.id)) ? { version: 1, topics, tiers, recipes, now: value.now } : null;
}
function quoteView(value, canonical = false) {
  if (!plain(value) || !bytesWithin(value, 65536) || !matches(QUOTE, value.id) || !matches(RECIPE, value.recipeId) || !matches(HASH, value.poolVersion)
    || !integer(value.expiresAt) || !integer(value.budget, 1000) || !integer(value.price, value.budget) || value.unspentBudget !== value.budget - value.price
    || !integer(value.count, 4, 1) || typeof value.requiresOptIn !== "boolean" || value.selection !== "uniform-without-replacement" || value.creatorShare !== 0.75
    || (value.budget > 0 && value.price === 0)) return null;
  const pools = mapAll(value.pools, 4, (pool) => {
    if (!plain(pool) || !matches(ID, pool.id) || !integer(pool.price, 250)) return null;
    const candidates = mapAll(pool.candidates, 128, (item) => candidateView(item, canonical), 1);
    if (!candidates || !plain(pool.selectionChance) || pool.selectionChance.numerator !== 1 || pool.selectionChance.denominator !== candidates.length) return null;
    const collectibleCount = candidates.filter((item) => item.type === "collectible").length;
    const totals = weightsView(pool.rarityWeightsTotal, 10000 * collectibleCount);
    if (!totals || pool.collectibleCount !== collectibleCount || pool.rarityDenominator !== 10000 * candidates.length || pool.collectibleRarityDenominator !== 10000 * collectibleCount) return null;
    for (const rarity of RARITIES) if ((totals[rarity] ?? 0) !== candidates.reduce((sum, item) => sum + (item.rarityWeights?.[rarity] ?? 0), 0)) return null;
    return { id: pool.id, price: pool.price, candidates, selectionChance: { numerator: 1, denominator: candidates.length }, rarityWeightsTotal: totals,
      rarityDenominator: pool.rarityDenominator, collectibleRarityDenominator: pool.collectibleRarityDenominator, collectibleCount };
  }, 1);
  if (!pools || !unique(pools.map((pool) => pool.id)) || !unique(pools.map((pool) => pool.price))) return null;
  const candidates = pools.flatMap((pool) => pool.candidates);
  if (candidates.length > 128 || !unique(candidates.map((item) => `${item.type}:${item.id}`)) || value.requiresOptIn !== candidates.some((item) => item.makerId !== null)) return null;
  const slots = mapAll(value.slots, 4, (slot, index) => {
    if (!plain(slot) || slot.index !== index) return null;
    const pool = pools.find((entry) => entry.id === slot.poolId);
    return pool && slot.price === pool.price ? { index, price: slot.price, poolId: slot.poolId } : null;
  }, 1);
  if (!slots || slots.length !== value.count || slots.reduce((sum, slot) => sum + slot.price, 0) !== value.price
    || pools.some((pool) => { const count = slots.filter((slot) => slot.poolId === pool.id).length; return count < 1 || count > pool.candidates.length; })) return null;
  return { id: value.id, recipeId: value.recipeId, expiresAt: value.expiresAt, budget: value.budget, price: value.price, unspentBudget: value.unspentBudget,
    count: value.count, requiresOptIn: value.requiresOptIn, poolVersion: value.poolVersion, selection: value.selection, slots, pools, creatorShare: value.creatorShare };
}
function instanceView(value, canonical = false) {
  const look = visual(value?.visual), growth = value?.growth;
  const validSizes = (sizes) => Array.isArray(sizes) && sizes.length >= 1 && sizes.length <= 4 && sizes.every((size) => SIZES.includes(size)) && unique(sizes);
  if (!plain(value) || !look || !matches(ID, value.id) || !matches(ID, value.definitionId) || !member(value.ownerId, canonical) || !title(value.name, 40)
    || !["pet", "sticker"].includes(value.kind) || !RARITIES.includes(value.rarity) || !integer(value.quality, 100) || typeof value.bound !== "boolean"
    || typeof value.blurb !== "string" || value.blurb.length > 160 || !integer(value.bornAt) || !integer(value.careDays) || !integer(value.tradeHoldUntil)
    || !(value.listingId === null || matches(ID, value.listingId)) || typeof value.caredToday !== "boolean" || !plain(growth)
    || !["baby", "young", "adult"].includes(growth.stage) || value.stage !== growth.stage || !integer(growth.ageDays) || growth.careDays !== value.careDays
    || !(growth.nextStageDays === null || integer(growth.nextStageDays)) || !validSizes(growth.sizes) || !validSizes(value.sizes) || !validSizes(value.unlockedSizes)
    || !value.unlockedSizes.includes(value.size) || JSON.stringify(value.sizes) !== JSON.stringify(growth.sizes) || JSON.stringify(value.unlockedSizes) !== JSON.stringify(growth.sizes)) return null;
  const traits = mapAll(value.traits, 3, (trait) => plain(trait) && ["playful", "curious", "gentle"].includes(trait.id) && title(trait.name, 40) && integer(trait.acquiredAt)
    ? { id: trait.id, name: trait.name, acquiredAt: trait.acquiredAt } : null);
  if (!traits || !unique(traits.map((trait) => trait.id))) return null;
  return { id: value.id, definitionId: value.definitionId, kind: value.kind, name: value.name, blurb: value.blurb, visual: look, bound: value.bound,
    rarity: value.rarity, quality: value.quality, traits, bornAt: value.bornAt, careDays: value.careDays, stage: value.stage,
    growth: { stage: growth.stage, ageDays: growth.ageDays, careDays: growth.careDays, nextStageDays: growth.nextStageDays, sizes: [...growth.sizes] },
    sizes: [...value.sizes], unlockedSizes: [...value.unlockedSizes], size: value.size, ownerId: value.ownerId, tradeHoldUntil: value.tradeHoldUntil,
    listingId: value.listingId, caredToday: value.caredToday };
}
function receiptView(value, shopItem, canonical = false) {
  if (!matches(/^crate_[a-f0-9]{32}$/, value.receiptId) || !matches(QUOTE, value.quoteId) || !integer(value.paid, 1000) || !integer(value.balance) || typeof value.replayed !== "boolean") return null;
  const rewards = mapAll(value.rewards, 4, (reward) => {
    if (!plain(reward) || !integer(reward.paid, 250)) return null;
    let item;
    if (reward.type === "collectible") item = instanceView(reward.item, canonical);
    else if (["catalog-license", "community-pack-license"].includes(reward.type) && typeof shopItem === "function") {
      if (!plain(reward.item) || reward.item.price !== reward.paid || reward.item.owned !== true) return null;
      item = shopItem(reward.item);
      if (!item || item.owned !== true || item.price !== reward.paid || (reward.type === "catalog-license" ? !matches(STUDIO, item.id) || item.maker !== null : !matches(PACK, item.id) || item.kind !== "pack" || !item.maker)) return null;
    }
    return item ? { type: reward.type, item, paid: reward.paid } : null;
  }, 1);
  if (!rewards || rewards.reduce((sum, reward) => sum + reward.paid, 0) !== value.paid || !unique(rewards.map((reward) => `${reward.type}:${reward.item.id}`))
    || !unique(rewards.map((reward) => `${reward.type}:${reward.type === "collectible" ? reward.item.definitionId : reward.item.id}`))) return null;
  return { receiptId: value.receiptId, quoteId: value.quoteId, paid: value.paid, balance: value.balance, rewards, replayed: value.replayed };
}
function consentView(value) {
  return plain(value) && typeof value.enabled === "boolean" && topicIds(value.topics) && (!value.enabled || value.topics.length)
    ? { enabled: value.enabled, topics: [...value.topics] } : null;
}
function contributionsView(value, payload, canonical = false) {
  const topics = topicsView(value.topics);
  const items = mapAll(value.items, payload.limit ?? 100, (entry) => {
    const candidate = candidateView(entry, canonical), consent = consentView(entry.consent);
    if (!candidate || !contributionId(candidate.type, candidate.id) || candidate.makerId === null || !integer(entry.price, 250) || !matches(HASH, entry.termsVersion) || !consent) return null;
    return { ...candidate, price: entry.price, termsVersion: entry.termsVersion, consent };
  });
  if (!topics || !items || items.filter((item) => item.type === "collectible").length > 48
    || !(value.next === null || matches(CONTRIBUTION_CURSOR, value.next))) return null;
  const keys = items.map((item) => `${item.type}:${item.id}`);
  if (keys.some((key, index) => key <= (index ? keys[index - 1] : payload.cursor ?? ""))
    || (value.next !== null && (!keys.length || value.next !== keys.at(-1) || items.length !== (payload.limit ?? 100)))) return null;
  return { topics, items, next: value.next };
}
// Fail the whole response when one typed entry is invalid. Truncating or
// filtering a quoted pool would change the published probabilities.
function dynamicResponse(action, value, { payload = {}, shopItem, canonical = false } = {}) {
  if (!isDynamicAction(action) || !plain(value) || value.ok !== true || !bytesWithin(value, 1024 * 1024)) return null;
  try {
    let result;
    if (action === "crateRecipes") result = recipesView(value);
    else if (action === "crateQuote") {
      const quote = quoteView(value.quote, canonical);
      if (!quote || typeof value.replayed !== "boolean" || quote.recipeId !== payload.recipeId || (quote.requiresOptIn && payload.communityOptIn !== true)) return null;
      result = { quote, replayed: value.replayed };
    } else if (action === "crateOpen") {
      result = receiptView(value, shopItem, canonical);
      if (result && (result.quoteId !== payload.quoteId || result.paid !== payload.price)) return null;
    } else if (action === "crateContributions") result = contributionsView(value, payload, canonical);
    else {
      const consent = consentView(value);
      if (!consent || !matches(HASH, value.termsVersion) || value.termsVersion !== payload.termsVersion || consent.enabled !== payload.enabled
        || JSON.stringify([...consent.topics].sort()) !== JSON.stringify([...payload.topics].sort())) return null;
      result = { ...consent, termsVersion: value.termsVersion };
    }
    return result ? { ok: true, ...result } : null;
  } catch { return null; }
}
const DYNAMIC_ERRORS = new Set(["bad-request", "opt-in-required", "unauthorized", "social-access-unavailable", "read-only", "not-owner", "supporter-required", "credit-hold",
  "recipe-unavailable", "quote-unavailable", "gone", "empty-pool", "pool-too-large", "pool-changed", "terms-changed", "quote-expired", "quote-consumed", "quote-mismatch",
  "request-conflict", "short", "limit", "owned", "own", "needs", "not-available", "rate-limited", "dynamic-crates-unavailable", "paused", "collectibles-disabled",
  "unsupported", "offline", "network", "not-configured", "not-linked", "auth", "not-member", "failed"]);
function dynamicError(answer) {
  const data = plain(answer.data) ? answer.data : {};
  return { ok: false, error: DYNAMIC_ERRORS.has(answer.error) ? answer.error : "failed",
    ...(title(answer.reason, 160) ? { reason: answer.reason } : {}), ...(integer(answer.retryAfter) ? { retryAfter: answer.retryAfter } : {}),
    ...(integer(data.balance) ? { balance: data.balance } : {}), ...(integer(data.price, 1000) ? { price: data.price } : {}),
    ...(matches(STUDIO, data.needs) || matches(PACK, data.needs) ? { needs: data.needs } : {}),
    ...(integer(data.until) ? { until: data.until } : {}), ...(matches(HASH, data.poolVersion) ? { poolVersion: data.poolVersion } : {}) };
}
module.exports = { request, visual, sticker, RARITIES, isDynamicAction, dynamicResponse, dynamicError };
