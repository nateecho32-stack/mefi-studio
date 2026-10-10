"use strict";

// Public cash orders: exact server-selected prices and actor-bound recovery.
// No provider IDs, credit conversion, ownership claims or arbitrary URLs.
const REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/;
const LISTING_ID = /^[A-Za-z0-9:_-]{1,100}$/;
const VERSION = /^[a-f0-9]{64}$/;
const ORDER_ID = /^cash_[a-f0-9]{32}$/;
const CURSOR = /^[a-f0-9]{48}$/;
const CODE = /^[a-z][a-z0-9_]{0,79}$/;
const listings = require("./commerce-listings-contract.cjs");
const RESPONSE_BYTES = 262144;
const capability = (action) => (["readSellerSetup", "prepareSellerSetup"].includes(action) ? "commerce.seller-setup.1" : action === "retireOrderRequest" ? "commerce.orders.retire.1" : action === "onboarding" ? "commerce.onboarding.1" : listings.capability(action)) || (["createOrder", "checkout", "getOrder", "listOrders"].includes(action) ? CAPABILITY : null);
const statusKey = (action) => ({ "commerce.catalog.1": "commerceCatalog", "commerce.seller.1": "commerceSeller", "commerce.orders.2": "commerceOrders", "commerce.onboarding.1": "commerceOnboarding", "commerce.orders.retire.1": "commerceRetireOrders", "commerce.seller-setup.1": "commerceSellerSetup" }[capability(action)]);
const CAPABILITY = "commerce.orders.2";
const ORDER_KEYS = ["dtoVersion", "orderId", "state", "listing", "quote", "commission", "settlement", "expiresAt", "receipt", "needsReview", "error"];
const QUOTE_KEYS = ["mode", "currency", "minorUnit", "amountIncrementMinor", "saleMinor", "quantity", "taxBehavior", "taxStatus", "taxMinor", "buyerFeeMinor", "totalMinor"];
const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const word = (v, re) => typeof v === "string" && re.test(v);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v, required, optional = []) => plain(v) && required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => [...required, ...optional].includes(k));
const bytes = (v) => { try { return Buffer.byteLength(JSON.stringify(v), "utf8"); } catch { return Infinity; } };

function request(action, payload = {}) {
  if (action === "readSellerSetup") return keys(payload, []) ? { method: "GET", path: "/v1/commerce/seller/setup" } : null;
  if (action === "prepareSellerSetup") return keys(payload, ["country", "requestId"]) && word(payload.country, /^[A-Z]{2}$/) && word(payload.requestId, REQUEST_ID)
    ? { method: "POST", path: "/v1/commerce/seller/setup", body: { country: payload.country, requestId: payload.requestId } } : null;
  if (action === "onboarding") return keys(payload, ["requestId"]) && word(payload.requestId, REQUEST_ID) ? { method: "POST", path: "/v1/commerce/onboarding", body: { requestId: payload.requestId } } : null;
  if (listings.ACTIONS.includes(action)) return listings.request(action, payload);
  if (action === "createOrder" || action === "retireOrderRequest") {
    if (!keys(payload, ["listingId", "listingVersion", "requestId"]) || !word(payload.listingId, LISTING_ID) || !word(payload.listingVersion, VERSION) || !word(payload.requestId, REQUEST_ID)) return null;
    return { method: "POST", path: action === "retireOrderRequest" ? "/v1/commerce/orders/retire" : "/v1/commerce/orders", body: { ...payload } };
  }
  if (["getOrder", "checkout"].includes(action)) {
    if (!keys(payload, ["orderId"]) || !word(payload.orderId, ORDER_ID)) return null;
    return action === "getOrder" ? { method: "GET", path: `/v1/commerce/orders/${payload.orderId}` }
      : { method: "POST", path: "/v1/commerce/checkout", body: { orderId: payload.orderId } };
  }
  if (action === "listOrders") {
    if (!keys(payload, ["scope", "limit", "cursor"]) || !["pending", "history"].includes(payload.scope) || !integer(payload.limit, 1, 25) || !(payload.cursor === null || word(payload.cursor, CURSOR))) return null;
    return { method: "GET", path: `/v1/commerce/orders?scope=${payload.scope}&limit=${payload.limit}${payload.cursor === null ? "" : `&cursor=${payload.cursor}`}` };
  }
  return null;
}

function providerUrl(value, origin) {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("https://") || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const u = new URL(value);
    return u.origin === origin && !u.username && !u.password && !u.hash && u.href.length <= 4096 ? u.href : null;
  } catch { return null; }
}

const stripeUrl = (value) => providerUrl(value, "https://checkout.stripe.com");
const onboardingUrl = (value) => providerUrl(value, "https://connect.stripe.com");
function order(value, action = "getOrder") {
  const additions = action === "createOrder" ? ["replayed"] : [];
  if (!keys(value, [...ORDER_KEYS, ...additions], action === "checkout" ? ["url"] : []) || bytes(value) > 8192 || value.dtoVersion !== 2) return null;
  const l = value.listing, q = value.quote, c = value.commission, r = value.receipt, s = value.settlement;
  if (!word(value.orderId, ORDER_ID) || !["quoted", "creating", "awaiting_payment", "fulfilled", "closed", "review"].includes(value.state)
    || !keys(l, ["id", "version", "name", "kind"]) || !word(l.id, LISTING_ID) || !word(l.version, VERSION)
    || typeof l.name !== "string" || !l.name.trim() || l.name.length > 120 || /[\u0000-\u001f\u007f]/.test(l.name) || !word(l.kind, /^[a-z][a-z0-9-]{0,39}$/)
    || !integer(value.expiresAt) || typeof value.needsReview !== "boolean" || !(value.error === null || word(value.error, CODE))) return null;
  if (!keys(q, QUOTE_KEYS) || !word(q.currency, /^[a-z]{3}$/) || !integer(q.minorUnit, 0, 3) || !integer(q.amountIncrementMinor, 1) || !integer(q.saleMinor, 1) || q.quantity !== 1 || q.taxBehavior !== "exclusive" || !integer(q.buyerFeeMinor) || q.saleMinor % q.amountIncrementMinor !== 0 || q.buyerFeeMinor % q.amountIncrementMinor !== 0) return null;
  if (q.mode === "fixed-gross-v1") {
    if (q.taxStatus !== "fixed" || !integer(q.taxMinor) || !integer(q.totalMinor, 1) || q.taxMinor % q.amountIncrementMinor !== 0 || q.totalMinor % q.amountIncrementMinor !== 0 || BigInt(q.saleMinor) + BigInt(q.taxMinor) + BigInt(q.buyerFeeMinor) !== BigInt(q.totalMinor)) return null;
  } else if (q.mode === "hosted-exclusive-v1") {
    if (q.taxStatus !== "pending" || q.taxMinor !== null || q.totalMinor !== null) return null;
  } else return null;
  if (!keys(c, ["basisPoints", "amountMinor", "basis", "rounding", "schedule"]) || !integer(c.basisPoints, 0, 10000) || !integer(c.amountMinor, 0, q.saleMinor)
    || !["subscriber", "qualified-inviter", "standard"].includes(c.basis) || !["legacy-3-8-10", "studio-subsidized-7-10-15", "commission-7-10-15-v2", "commission-5-10-15-v3"].includes(c.schedule) || c.rounding !== "nearest-minor-half-up"
    || BigInt(c.amountMinor) !== (BigInt(q.saleMinor) * BigInt(c.basisPoints) + 5000n) / 10000n) return null;
  const rates = c.schedule === "legacy-3-8-10" ? { subscriber: 300, "qualified-inviter": 800, standard: 1000 } : { subscriber: c.schedule === "commission-5-10-15-v3" ? 500 : 700, "qualified-inviter": 1000, standard: 1500 };
  if (c.basisPoints !== rates[c.basis] || c.schedule === "commission-5-10-15-v3" && q.buyerFeeMinor !== 0) return null;
  if (s !== null && (!keys(s, ["status", "currency", "minorUnit", "amountIncrementMinor", "saleMinor", "taxMinor", "buyerFeeMinor", "totalMinor", "verifiedAt"])
    || s.status !== "verified" || s.currency !== q.currency || s.minorUnit !== q.minorUnit || s.amountIncrementMinor !== q.amountIncrementMinor || s.saleMinor !== q.saleMinor || s.buyerFeeMinor !== q.buyerFeeMinor
    || !integer(s.taxMinor) || !integer(s.totalMinor, 1) || !integer(s.verifiedAt) || s.taxMinor % q.amountIncrementMinor !== 0 || s.totalMinor % q.amountIncrementMinor !== 0 || BigInt(s.saleMinor) + BigInt(s.taxMinor) + BigInt(s.buyerFeeMinor) !== BigInt(s.totalMinor)
    || q.mode === "fixed-gross-v1" && (s.taxMinor !== q.taxMinor || s.totalMinor !== q.totalMinor))) return null;
  if (r !== null && (!keys(r, ["orderId", "kind", "reference", "version", "deliveredAt"]) || r.orderId !== value.orderId || r.kind !== l.kind
    || !word(r.reference, /^[A-Za-z0-9:_./-]{1,160}$/) || /^(?:acct|cus|cs|pi|ch|evt|po|tr|fee|re|dp)_/.test(r.reference) || !word(r.version, VERSION) || !integer(r.deliveredAt))) return null;
  if ((value.state === "fulfilled") !== (r !== null) || r !== null && q.mode === "hosted-exclusive-v1" && s === null) return null;
  if (action === "createOrder" && typeof value.replayed !== "boolean") return null;
  if (Object.hasOwn(value, "url") && !(value.url === null || value.state === "awaiting_payment" && stripeUrl(value.url))) return null;
  return { ...value, listing: { ...l }, quote: { ...q }, commission: { ...c }, settlement: s === null ? null : { ...s }, receipt: r === null ? null : { ...r }, ...(value.url ? { url: stripeUrl(value.url) } : {}) };
}
function response(action, value, payload, actorId = null, canonical = false) {
  if (action === "readSellerSetup") {
    if (!request(action, payload) || !keys(value, ["countries", "declaredCountry", "locked", "canPrepare", "reason"]) || !Array.isArray(value.countries) || value.countries.length > 249
      || value.countries.some((code) => !word(code, /^[A-Z]{2}$/)) || new Set(value.countries).size !== value.countries.length
      || !(value.declaredCountry === null || word(value.declaredCountry, /^[A-Z]{2}$/)) || typeof value.locked !== "boolean" || typeof value.canPrepare !== "boolean"
      || value.canPrepare && (value.locked || !value.countries.length)
      || ![null, "cash_seller_setup_unavailable", "cash_seller_country_locked", "cash_seller_country_unsupported"].includes(value.reason)) return null;
    return { ok: true, ...value, countries: [...value.countries] };
  }
  if (action === "prepareSellerSetup") return request(action, payload) && keys(value, ["country", "replayed"]) && value.country === payload.country && typeof value.replayed === "boolean" ? { ok: true, ...value } : null;
  if (action === "onboarding") return request(action, payload) && keys(value, ["url", "expiresAt", "replayed"]) && onboardingUrl(value.url) && integer(value.expiresAt) && typeof value.replayed === "boolean" ? { ok: true, url: onboardingUrl(value.url), expiresAt: value.expiresAt, replayed: value.replayed } : null;
  if (listings.ACTIONS.includes(action)) return listings.response(action, value, payload, actorId, canonical);
  if (!request(action, payload)) return null;
  if (action === "retireOrderRequest") {
    if (keys(value, ["outcome", "requestId"]) && value.outcome === "not-applied" && value.requestId === payload.requestId) return { ok: true, ...value };
    if (!keys(value, ["outcome", "order"]) || value.outcome !== "applied") return null;
    const result = order(value.order);
    return result && result.listing.id === payload.listingId && result.listing.version === payload.listingVersion ? { ok: true, outcome: "applied", order: result } : null;
  }
  if (action === "listOrders") {
    if (!keys(value, ["orders", "nextCursor"]) || bytes(value) > 65536 || !Array.isArray(value.orders) || value.orders.length > payload.limit
      || !(value.nextCursor === null || word(value.nextCursor, CURSOR)) || value.nextCursor !== null && (!value.orders.length || value.nextCursor === payload.cursor)) return null;
    const orders = value.orders.map((v) => order(v));
    if (orders.some((v) => !v) || new Set(orders.map((v) => v.orderId)).size !== orders.length
      || payload.scope === "pending" && orders.some((v) => v.state === "closed" || v.state === "fulfilled" && !v.needsReview)) return null;
    return { ok: true, orders, nextCursor: value.nextCursor };
  }
  const clean = order(value, action);
  if (!clean || action === "createOrder" && (clean.listing.id !== payload.listingId || clean.listing.version !== payload.listingVersion)
    || action !== "createOrder" && clean.orderId !== payload.orderId) return null;
  return { ok: true, ...clean };
}

function error(value, retryAfter) {
  const code = keys(value, ["error"]) && keys(value.error, ["code"]) && word(value.error.code, CODE) ? value.error.code : "cash_unavailable";
  const seconds = typeof retryAfter === "string" && /^\d{1,4}$/.test(retryAfter) ? Number(retryAfter) : null;
  return { ok: false, error: code, ...(seconds !== null && seconds <= 3600 ? { retryAfter: seconds * 1000 } : {}) };
}
async function readJson(reply) {
  const length = reply.headers?.get?.("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > RESPONSE_BYTES)) return null;
  if (!reply.body?.getReader) return null;
  const reader = reply.body.getReader(), chunks = []; let total = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > RESPONSE_BYTES) { await reader.cancel(); return null; } chunks.push(Buffer.from(value)); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return null; }
  finally { reader.releaseLock?.(); }
}
module.exports = { CAPABILITY, capability, statusKey, request, response, order, stripeUrl, onboardingUrl, error, readJson, REQUEST_ID, ORDER_ID, VERSION, LISTING_ID, CURSOR, RESPONSE_BYTES };