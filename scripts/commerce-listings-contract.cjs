const { actorId: canonicalActorId, isDiscordSubject } = require("./actor-contract.cjs");
const member = (value, canonical = false) => canonical === true ? canonicalActorId(value) : isDiscordSubject(value) ? value : null;
"use strict";

// Public cash catalog and seller DTOs; assets are allowlisted local data only.
const ID = /^cashlist_[a-f0-9]{32}$/, VERSION = /^[a-f0-9]{64}$/;
const PACK = /^pack_[A-Za-z0-9_-]{16}$/, ITEM = /^item_[A-Za-z0-9_-]{16}$/, CATALOG = /^studio:[a-z0-9-]{1,40}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,256}$/, REQUEST = /^[A-Za-z0-9_-]{8,80}$/, CODE = /^[a-z][a-z0-9_]{0,79}$/;
const TYPES = ["community-pack-license", "collectible-instance"], SIZES = ["tiny", "small", "medium", "large"];
const ACTIONS = ["catalog", "listing", "seller", "sellerAssets", "sellerListings", "publishListing", "updateListing", "unlistListing"];
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v, required, optional = []) => plain(v) && required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => [...required, ...optional].includes(k));
const word = (v, re) => typeof v === "string" && re.test(v);
const int = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const text = (v, max, empty = false) => typeof v === "string" && (empty || Boolean(v.trim())) && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const reason = (v) => v === null || word(v, CODE);
const cursor = (v) => v === null || word(v, CURSOR);
const color = (v) => word(v, /^#[0-9a-fA-F]{6}$/);
const clone = (v) => JSON.parse(JSON.stringify(v));
const capability = (action) => ["catalog", "listing"].includes(action) ? "commerce.catalog.1" : ACTIONS.includes(action) ? "commerce.seller.1" : null;

function request(action, p = {}) {
  const query = (value) => value === null ? "" : `?cursor=${encodeURIComponent(value)}`;
  if (["catalog", "sellerListings"].includes(action)) return keys(p, ["cursor"]) && cursor(p.cursor) ? { method: "GET", path: `/v1/commerce/${action === "catalog" ? "catalog" : "seller/listings"}${query(p.cursor)}` } : null;
  if (action === "listing") return keys(p, ["listingId"]) && word(p.listingId, ID) ? { method: "GET", path: `/v1/commerce/listings/${p.listingId}` } : null;
  if (action === "seller") return keys(p, []) ? { method: "GET", path: "/v1/commerce/seller" } : null;
  if (action === "sellerAssets") return keys(p, ["kind", "cursor"]) && TYPES.includes(p.kind) && cursor(p.cursor) ? { method: "GET", path: `/v1/commerce/seller/assets?kind=${p.kind}${p.cursor === null ? "" : `&cursor=${encodeURIComponent(p.cursor)}`}` } : null;
  if (action === "publishListing") {
    if (!keys(p, ["assetType", "assetId", "currency", "saleMinor", "requestId"]) || !TYPES.includes(p.assetType) || !word(p.assetId, p.assetType === "collectible-instance" ? ITEM : PACK)) return null;
  } else if (action === "updateListing" || action === "unlistListing") {
    const fields = ["listingId", "listingVersion", "requestId", ...(action === "updateListing" ? ["currency", "saleMinor"] : [])];
    if (!keys(p, fields) || !word(p.listingId, ID) || !word(p.listingVersion, VERSION)) return null;
  } else return null;
  if (!word(p.requestId, REQUEST) || action !== "unlistListing" && (!word(p.currency, /^[a-z]{3}$/) || !int(p.saleMinor, 1))) return null;
  const body = { ...p }; delete body.listingId;
  return { method: { publishListing: "POST", updateListing: "PUT", unlistListing: "DELETE" }[action], path: `/v1/commerce/listings${p.listingId ? `/${p.listingId}` : ""}`, body };
}

function collectible(v, canonical = false) {
  if (!keys(v, ["kind", "name", "blurb", "visual", "bound", "id", "definitionId", "rarity", "quality", "traits", "bornAt", "careDays", "stage", "growth", "sizes", "unlockedSizes", "size", "ownerId", "tradeHoldUntil", "listingId", "caredToday"])) return null;
  if (!["pet", "sticker"].includes(v.kind) || !text(v.name, 40) || !text(v.blurb, 160, true) || typeof v.bound !== "boolean" || typeof v.caredToday !== "boolean"
    || !word(v.id, ITEM) || !word(v.definitionId, /^[A-Za-z0-9_-]{1,64}$/) || !["none", "common", "uncommon", "rare", "epic", "legendary"].includes(v.rarity)
    || !int(v.quality, 0, 100) || !int(v.bornAt) || !int(v.careDays) || !int(v.tradeHoldUntil) || !member(v.ownerId, canonical)
    || !(v.listingId === null || word(v.listingId, /^listing_[A-Za-z0-9_-]{16}$/))) return null;
  const a = v.visual;
  if (!keys(a, ["body", "primary", "secondary", "motif", ...(v.kind === "sticker" ? ["glyph"] : [])], v.kind === "sticker" ? ["asset"] : [])
    || !["dragon", "cloud", "phoenix", "wisp"].includes(a.body) || !color(a.primary) || !color(a.secondary) || !["plain", "stars", "sparkles", "stripes"].includes(a.motif)
    || v.kind === "sticker" && !["heart", "star", "moon", "spark", "leaf", "wave"].includes(a.glyph)) return null;
  if (Object.hasOwn(a, "asset") && (!["idea", "rest", "celebrate", "code", "happy", "plan", "curious", "love", "sleep"].includes(a.asset) || !v.bound || v.rarity !== "none" || v.definitionId !== `studio-sticker-${a.asset}`)) return null;
  if (!Array.isArray(v.traits) || v.traits.length > 3 || new Set(v.traits.map((t) => t?.id)).size !== v.traits.length
    || v.traits.some((t) => !keys(t, ["id", "name", "acquiredAt"]) || !Object.hasOwn({ playful: 1, curious: 1, gentle: 1 }, t.id) || t.name !== { playful: "Playful", curious: "Curious", gentle: "Gentle" }[t.id] || !int(t.acquiredAt))) return null;
  const g = v.growth;
  if (!["baby", "young", "adult"].includes(v.stage) || !keys(g, ["stage", "ageDays", "careDays", "nextStageDays", "sizes"]) || g.stage !== v.stage || g.careDays !== v.careDays || !int(g.ageDays)
    || g.nextStageDays !== { baby: 3, young: 14, adult: null }[v.stage] || !Array.isArray(v.sizes) || !int(v.sizes.length, 1, 4)
    || v.sizes.some((s, i) => s !== SIZES[i]) || !v.sizes.includes(v.size) || JSON.stringify(v.unlockedSizes) !== JSON.stringify(v.sizes) || JSON.stringify(g.sizes) !== JSON.stringify(v.sizes)) return null;
  return clone(v);
}
function asset(v, canonical = false) {
  if (v?.type === "collectible-instance") { const item = keys(v, ["type", "item"]) && collectible(v.item, canonical); return item ? { type: v.type, item } : null; }
  if (!keys(v, ["type", "id", "name", "description", "preview"]) || !text(v.name, 64) || !text(v.description, 160, true)) return null;
  const p = v.preview;
  if (v.type === "community-pack-license") {
    if (!word(v.id, PACK) || !keys(p, ["kind", "palette"]) || p.kind !== "palette" || !keys(p.palette, ["accent", "background", "surface", "text"]) || !Object.values(p.palette).every(color)) return null;
  } else if (v.type === "catalog-license") {
    if (!word(v.id, CATALOG) || !keys(p, ["kind", "catalogKind"]) || p.kind !== "catalog" || !["skin", "pet", "effect", "nodestyle", "pack"].includes(p.catalogKind)) return null;
  } else return null;
  return clone(v);
}
function listing(v, own = false, canonical = false) {
  if (!keys(v, ["id", "version", "seller", "name", "kind", "currency", "minorUnit", "amountIncrementMinor", "saleMinor", "asset", ...(own ? ["status", "reason"] : [])]) || !word(v.id, ID) || !word(v.version, VERSION) || !text(v.name, 64)
    || !keys(v.seller, ["id", "name"]) || !member(v.seller.id, canonical) || !text(v.seller.name, 64) || !word(v.currency, /^[a-z]{3}$/) || !int(v.minorUnit, 0, 3) || !int(v.amountIncrementMinor, 1) || !int(v.saleMinor, 1) || BigInt(v.saleMinor) % BigInt(v.amountIncrementMinor) !== 0n
    || own && (!["listed", "unlisted", "unavailable"].includes(v.status) || !reason(v.reason))) return null;
  const a = asset(v.asset, canonical); if (!a || a.type !== v.kind) return null;
  if (a.type === "collectible-instance" && (a.item.ownerId !== v.seller.id || !own && a.item.bound)) return null;
  return { ...v, seller: { ...v.seller }, asset: a };
}
function sellable(v, canonical = false) {
  if (!keys(v, ["asset", "eligibility", "listingId"]) || !keys(v.eligibility, ["canList", "reason"]) || typeof v.eligibility.canList !== "boolean" || !reason(v.eligibility.reason) || !(v.listingId === null || word(v.listingId, ID))) return null;
  const a = asset(v.asset, canonical); if (!a || !TYPES.includes(a.type) || a.type === "collectible-instance" && a.item.bound && v.eligibility.canList) return null;
  return { asset: a, eligibility: { ...v.eligibility }, listingId: v.listingId };
}
function seller(v) {
  if (!keys(v, ["enabled", "canList", "canSell", "fee", "onboarding", "pricing", "reason"]) || [v.enabled, v.canList, v.canSell].some((b) => typeof b !== "boolean") || !reason(v.reason)
    || !keys(v.fee, ["state", "basisPoints"]) || !["known", "pending"].includes(v.fee.state) || (v.fee.state === "pending" ? v.fee.basisPoints !== null : ![500, 1000, 1500].includes(v.fee.basisPoints))
    || !keys(v.onboarding, ["state", "canStart"]) || !["unavailable", "needed", "pending", "ready"].includes(v.onboarding.state) || typeof v.onboarding.canStart !== "boolean"
    || !keys(v.pricing, ["currencies"]) || !Array.isArray(v.pricing.currencies) || v.pricing.currencies.length > 16) return null;
  const currencies = v.pricing.currencies;
  if (new Set(currencies.map((c) => c.code)).size !== currencies.length || currencies.some((c) => !keys(c, ["code", "minorUnit", "amountIncrementMinor", "minSaleMinor", "maxSaleMinor"]) || !word(c.code, /^[a-z]{3}$/) || !int(c.minorUnit, 0, 3) || !int(c.amountIncrementMinor, 1) || !int(c.minSaleMinor, 1) || !int(c.maxSaleMinor, c.minSaleMinor) || BigInt(c.minSaleMinor) % BigInt(c.amountIncrementMinor) !== 0n || BigInt(c.maxSaleMinor) % BigInt(c.amountIncrementMinor) !== 0n) || !currencies.length && v.canList) return null;
  return clone(v);
}
function response(action, value, input, actorId = null, canonical = false) {
  if (!request(action, input)) return null;
  if (action === "seller") { const data = seller(value); return data ? { ok: true, ...data } : null; }
  if (["listing", "publishListing", "updateListing", "unlistListing"].includes(action)) {
    const own = action !== "listing", fields = ["listing", ...(own ? ["replayed"] : [])];
    if (!keys(value, fields) || own && typeof value.replayed !== "boolean") return null;
    const data = listing(value.listing, own, canonical); if (!data || input.listingId && data.id !== input.listingId || own && actorId !== null && data.seller.id !== actorId) return null;
    if (action === "publishListing" && (data.asset.type !== input.assetType || (data.asset.item?.id ?? data.asset.id) !== input.assetId)
      || ["publishListing", "updateListing"].includes(action) && (data.currency !== input.currency || data.saleMinor !== input.saleMinor)) return null;
    return { ok: true, listing: data, ...(own ? { replayed: value.replayed } : {}) };
  }
  if (!keys(value, ["items", "nextCursor"]) || !Array.isArray(value.items) || value.items.length > 50 || !cursor(value.nextCursor) || value.nextCursor !== null && value.nextCursor === input.cursor) return null;
  const items = value.items.map((v) => action === "sellerAssets" ? sellable(v, canonical) : listing(v, action === "sellerListings", canonical));
  if (items.some((v) => !v) || action === "sellerAssets" && items.some((v) => v.asset.type !== input.kind)) return null;
  if (actorId !== null && (action === "sellerListings" && items.some((v) => v.seller.id !== actorId) || action === "sellerAssets" && items.some((v) => v.asset.item && v.asset.item.ownerId !== actorId))) return null;
  const ids = items.map((v) => v.id ?? v.asset.item?.id ?? v.asset.id);
  if (new Set(ids).size !== ids.length) return null;
  return { ok: true, items, nextCursor: value.nextCursor };
}
module.exports = { ACTIONS, capability, request, response, collectible, asset, listing, seller, TYPES };
