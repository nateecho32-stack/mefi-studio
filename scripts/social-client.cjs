// Public client contract for the owner's private trade service. No ownership,
// entitlement, price, or wallet authority lives here; the relay decides them.
"use strict";
const ID = /^trade_[a-f0-9]{32}$/;
const UID = /^\d{17,20}$/;
const ITEM = /^studio:[a-z0-9-]{1,40}$/;
const RECEIPT = /^[A-Za-z0-9_-]{16,64}$/;
const STATES = new Set(["pending", "accepted", "declined", "cancelled", "expired", "superseded"]);
const KINDS = new Set(["pet", "skin", "effect", "nodestyle", "pack"]);
const ROOM = /^[A-Za-z0-9_-]{1,64}$/;
const IMAGE = /^image_[a-f0-9]{32}$/;
const REPORT = /^rep_[A-Za-z0-9_-]{1,60}$/;
const JPEG = /^[A-Za-z0-9+/]+={0,2}$/;
const imageRef = value => value && IMAGE.test(value.id) && Number.isInteger(value.width) && value.width > 0 && value.width <= 1280 && Number.isInteger(value.height) && value.height > 0 && value.height <= 1280 ? {id:value.id,width:value.width,height:value.height} : null;
const text = value => String(value ?? "").replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ").slice(0, 100);
const person = value => UID.test(value?.id ?? "") ? { id: value.id, name: text(value.name) } : null;
const item = value => ITEM.test(value?.id ?? "") && KINDS.has(value.kind) ? { id: value.id, kind: value.kind, name: text(value.name) } : null;
function trade(value) {
  if (!ID.test(value?.id ?? "") || !STATES.has(value.status) || !Number.isFinite(value.createdAt) || !Number.isFinite(value.expiresAt)) return null;
  const sender = person(value.sender), recipient = person(value.recipient), offered = item(value.offered), requested = item(value.requested);
  return sender && recipient && offered && requested ? { id: value.id, sender, recipient, offered, requested, status: value.status, createdAt: value.createdAt, expiresAt: value.expiresAt, decidedAt: Number.isFinite(value.decidedAt) ? value.decidedAt : null } : null;
}
function createSocialClient({ request, supported }) {
  const bad = () => Promise.resolve({ ok: false, error: "bad-request" });
  async function call(method, path, body, convert, feature = "shop.trades") {
    if (!supported(feature)) return { ok: false, error: "unsupported" };
    const answer = await request(method, path, body);
    if (!answer.ok) return { ok: false, error: text(answer.error || "network"), ...(Number.isFinite(answer.retryAfter) ? { retryAfter: answer.retryAfter } : {}) };
    const converted = convert(answer.data);
    return converted ? { ok: true, ...converted } : { ok: false, error: "failed" };
  }
  const one = data => { const value = trade(data?.trade); return value ? { trade: value, replayed: data.replayed === true } : null; };
  const picture = data => typeof data?.jpeg === "string" && data.jpeg.length <= 131072 && JPEG.test(data.jpeg) && Number.isInteger(data.width) && data.width > 0 && data.width <= 1280 && Number.isInteger(data.height) && data.height > 0 && data.height <= 1280 ? {jpeg:data.jpeg,width:data.width,height:data.height} : null;
  return Object.freeze({
    trades: () => call("GET", "/v1/trades", undefined, data => Array.isArray(data?.trades) ? { trades: data.trades.slice(0, 50).map(trade).filter(Boolean), enabled: data.enabled === true } : null),
    tradeInventory: uid => UID.test(uid ?? "") ? call("GET", `/v1/trades/with/${uid}`, undefined, data => {
      const member = person(data?.member);
      return member && member.id === uid && Array.isArray(data.mine) && Array.isArray(data.theirs) ? { member, mine: data.mine.slice(0, 200).map(item).filter(Boolean), theirs: data.theirs.slice(0, 200).map(item).filter(Boolean) } : null;
    }) : bad(),
    tradeOffer: body => body && UID.test(body.recipient ?? "") && ITEM.test(body.offered ?? "") && ITEM.test(body.requested ?? "") && body.offered !== body.requested && RECEIPT.test(body.receipt ?? "") ? call("POST", "/v1/trades", { recipient: body.recipient, offered: body.offered, requested: body.requested, receipt: body.receipt }, one) : bad(),
    tradeDecide: (id, action) => ID.test(id ?? "") && ["accept", "decline", "cancel"].includes(action) ? call("POST", `/v1/trades/${id}/${action}`, {}, one) : bad(),
    sendImage: (roomId, body) => ROOM.test(roomId ?? "") && body && typeof body.jpeg === "string" && body.jpeg.length <= 131072 && JPEG.test(body.jpeg) && typeof body.caption === "string" && body.caption.length <= 2000 && RECEIPT.test(body.receipt ?? "") ? call("POST", `/v1/rooms/${roomId}/images`, {jpeg:body.jpeg,caption:body.caption,receipt:body.receipt}, data => imageRef(data?.message?.image) && UID.test(data.message.id) ? {messageId:data.message.id,replayed:data.replayed===true} : null, "messages.images") : bad(),
    roomImage: (roomId, imageId) => ROOM.test(roomId ?? "") && IMAGE.test(imageId ?? "") ? call("GET", `/v1/rooms/${roomId}/images/${imageId}`, undefined, data => typeof data?.jpeg === "string" && data.jpeg.length <= 131072 && JPEG.test(data.jpeg) && imageRef({id:imageId,width:data.width,height:data.height}) ? {jpeg:data.jpeg,width:data.width,height:data.height} : null, "messages.images") : bad(),
    modReportImage: reportId => REPORT.test(reportId ?? "") ? call("GET", `/v1/admin/reports/${reportId}/image`, undefined, picture, "messages.images") : bad(),
    modRemoveMessage: reportId => REPORT.test(reportId ?? "") ? call("POST", `/v1/admin/reports/${reportId}/remove-message`, {}, data => data?.ok === true ? {} : null, "messages.images") : bad(),
  });
}
module.exports = { createSocialClient, trade, imageRef };
