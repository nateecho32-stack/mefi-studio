"use strict";

// Public membership boundary. Provider credentials, prices selected by the
// browser, and entitlement assertions are never request fields.
const REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/;
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const STATUS_BYTES = 4096;
const RESPONSE_BYTES = 1024 * 1024;
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v, fields) => plain(v) && Object.keys(v).length === fields.length && fields.every((key) => Object.hasOwn(v, key));
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const amount = (v) => Number.isSafeInteger(v) && v >= 0;
const bool = (v) => typeof v === "boolean";
function bytes(value) { try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return Infinity; } }

function request(action, payload = {}) {
  if (action === "status") return exact(payload, []) ? { method: "GET", path: "/v1/billing/status" } : null;
  if (!["checkout", "portal"].includes(action) || !exact(payload, ["requestId"])
    || typeof payload.requestId !== "string" || !REQUEST_ID.test(payload.requestId)) return null;
  return { method: "POST", path: `/v1/billing/${action}`, body: { requestId: payload.requestId } };
}

function stripeUrl(action, value) {
  if (!["checkout", "portal"].includes(action) || typeof value !== "string" || value.length > 2048
    || !value.startsWith("https://") || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    const origin = action === "checkout" ? "https://checkout.stripe.com" : "https://billing.stripe.com";
    return url.protocol === "https:" && url.origin === origin && !url.username && !url.password && url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}

function status(value) {
  if (!exact(value, ["now", "membership", "offer", "actions", "pending"]) || bytes(value) > STATUS_BYTES || !positive(value.now)) return null;
  const { membership: m, offer: o, actions: a, pending: p } = value;
  if (!exact(m, ["active", "kind", "until", "everSupported", "donor", "reason"])
    || !bool(m.active) || ![null, "paid", "lifetime", "intro"].includes(m.kind)
    || (m.active ? m.kind === null : m.kind !== null) || !(m.until === null || positive(m.until))
    || (m.kind === "lifetime" && m.until !== null) || !bool(m.everSupported) || !bool(m.donor)
    || typeof m.reason !== "string" || !CODE.test(m.reason)) return null;
  if (o !== null && (!exact(o, ["version", "currency", "firstPeriodAmount", "renewalAmount", "interval", "referralApplied", "taxMode"])
    || typeof o.version !== "string" || !/^[a-f0-9]{64}$/.test(o.version)
    || typeof o.currency !== "string" || !/^[a-z]{3}$/.test(o.currency)
    || !amount(o.firstPeriodAmount) || !amount(o.renewalAmount) || o.interval !== "month"
    || !bool(o.referralApplied) || !["none", "exclusive"].includes(o.taxMode))) return null;
  if (!exact(a, ["checkout", "portal"]) || !bool(a.checkout) || !bool(a.portal)
    || !exact(p, ["checkout", "requestId"]) || !["none", "open", "expiring", "payment_review"].includes(p.checkout)
    || (p.checkout === "none" ? p.requestId !== null : typeof p.requestId !== "string" || !REQUEST_ID.test(p.requestId))) return null;
  return { now: value.now, membership: { ...m }, offer: o === null ? null : { ...o }, actions: { ...a }, pending: { ...p } };
}

function response(action, value) {
  if (action === "status") { const clean = status(value); return clean ? { ok: true, ...clean } : null; }
  if (!exact(value, ["url"])) return null;
  const url = stripeUrl(action, value.url);
  return url ? { ok: true, url } : null;
}

function error(value, retryAfter) {
  const code = exact(value, ["error"]) && exact(value.error, ["code"]) && typeof value.error.code === "string" && CODE.test(value.error.code)
    ? value.error.code : "unavailable";
  // Retry-After is delta seconds. Never interpret an unbounded value or a
  // provider string as something to display. UI also supplies a minimum wait.
  const seconds = typeof retryAfter === "string" && /^\d{1,5}$/.test(retryAfter) ? Number(retryAfter) : null;
  return { ok: false, error: code, ...(seconds !== null && seconds <= 3600 ? { retryAfter: seconds * 1000 } : {}) };
}

async function readJson(reply) {
  const length = reply.headers?.get?.("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > RESPONSE_BYTES)) return null;
  if (!reply.body?.getReader) return null;
  const reader = reply.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_BYTES) { await reader.cancel(); return null; }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return null; }
  finally { reader.releaseLock?.(); }
}

module.exports = { request, response, status, stripeUrl, error, readJson, REQUEST_ID, STATUS_BYTES, RESPONSE_BYTES };
