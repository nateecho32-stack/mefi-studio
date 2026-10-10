"use strict";
// Exact public referrals.1 projection; this module never supplies identity.
const CAPABILITY = "referrals.1", RESPONSE_BYTES = 8192;
const ACTIONS = ["readReferralStatus", "issueReferralInvitation", "redeemReferralInvitation"];
const CODE = /^ref_[a-f0-9]{64}$/, REQUEST = /^[A-Za-z0-9_-]{8,80}$/;
const ISSUE_REASONS = ["referrals_unavailable", "read_only", "referral_capacity_reached"];
const ERRORS = Object.freeze({
  bad_request:400, invalid_referral_input:400, unauthorized:401,
  admission_required:403, verified_identity_required:403, referral_origin_required:403, read_only:403,
  not_found:404, referral_invitation_unavailable:404, method_not_allowed:405,
  referral_request_conflict:409, self_referral:409, referral_already_recorded:409,
  body_too_large:413, unsupported_media_type:415,
  referral_capacity_reached:429, referral_rate_limited:429,
  referrals_unavailable:503, referral_policy_unresolved:503, referral_authority_unavailable:503, referral_code_collision:503,
});
const NEGATIVE = ["self_referral", "referral_already_recorded", "referral_invitation_unavailable"];
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v, names) => object(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const integer = (v, min = 0) => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const matches = (v, pattern) => typeof v === "string" && pattern.test(v);
function request(action, value) {
  if (action === "readReferralStatus" && keys(value, [])) return { method:"GET", path:"/v1/referrals" };
  if (action === "issueReferralInvitation" && keys(value, ["requestId"]) && matches(value.requestId, REQUEST))
    return { method:"POST", path:"/v1/referrals/invitations", body:{ requestId:value.requestId } };
  if (action === "redeemReferralInvitation" && keys(value, ["code","requestId"]) && matches(value.requestId, REQUEST) && matches(value.code, CODE))
    return { method:"POST", path:"/v1/referrals/redeem", body:{ code:value.code, requestId:value.requestId } };
  return null;
}
function status(v) {
  if (!keys(v, ["threshold","qualifyingInvitees","qualified","attributionRecorded","invitation","canIssue","issueReason","canRedeem","redeemReason"])
    || v.threshold !== 5 || !integer(v.qualifyingInvitees) || typeof v.qualified !== "boolean" || typeof v.attributionRecorded !== "boolean"
    || typeof v.canIssue !== "boolean" || typeof v.canRedeem !== "boolean"
    || !(v.issueReason === null || ISSUE_REASONS.includes(v.issueReason))
    || !(v.redeemReason === null || ISSUE_REASONS.includes(v.redeemReason) || v.redeemReason === "referral_already_recorded")
    || v.canIssue !== (v.issueReason === null) || v.canRedeem !== (v.redeemReason === null)
    || (v.attributionRecorded ? v.redeemReason !== "referral_already_recorded" : v.redeemReason === "referral_already_recorded")) return null;
  if (v.invitation !== null && (!keys(v.invitation, ["code","expiresAt"]) || !matches(v.invitation.code, CODE) || !integer(v.invitation.expiresAt, 1))) return null;
  return { ...v, invitation:v.invitation === null ? null : { ...v.invitation } };
}
function response(action, v) {
  if (action === "readReferralStatus") { const projected = status(v); return projected ? { ok:true, ...projected } : null; }
  if (action === "issueReferralInvitation" && keys(v, ["code","expiresAt","replayed"]) && matches(v.code, CODE) && integer(v.expiresAt, 1) && typeof v.replayed === "boolean")
    return { ok:true, code:v.code, expiresAt:v.expiresAt, replayed:v.replayed };
  if (action === "redeemReferralInvitation" && keys(v, ["recorded","replayed"]) && v.recorded === true && typeof v.replayed === "boolean")
    return { ok:true, recorded:true, replayed:v.replayed };
  return null;
}
function error(action, v, input, httpStatus, retryAfter) {
  if (!object(v) || !keys(v.error, ["code"]) || typeof v.error.code !== "string") return { ok:false, error:"bad_response" };
  const code = v.error.code;
  if (!Object.hasOwn(ERRORS, code) || ERRORS[code] !== httpStatus) return { ok:false, error:"referrals_unavailable" };
  if (Object.hasOwn(v, "outcome") || Object.hasOwn(v, "requestId")) {
    if (action !== "redeemReferralInvitation" || !NEGATIVE.includes(code) || !keys(v, ["error","outcome","requestId"])
      || v.outcome !== "not-applied" || !matches(v.requestId, REQUEST) || v.requestId !== input?.requestId) return { ok:false, error:"bad_response" };
    return { ok:false, error:code, outcome:"not-applied", requestId:v.requestId };
  }
  if (!keys(v, ["error"])) return { ok:false, error:"bad_response" };
  const result = { ok:false, error:code };
  if (code === "referral_rate_limited" && typeof retryAfter === "string" && /^[1-9][0-9]{0,3}$/.test(retryAfter) && Number(retryAfter) <= 3600) result.retryAfter = Number(retryAfter) * 1000;
  return result;
}
async function readJson(reply) {
  const length = reply.headers?.get?.("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > RESPONSE_BYTES)) throw new Error("response-size");
  const reader = reply.body?.getReader?.();
  if (!reader) throw new Error("response-stream");
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_BYTES) { await reader.cancel(); throw new Error("response-size"); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock?.(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
module.exports = Object.freeze({ CAPABILITY, ACTIONS, CODE, REQUEST, request, status, response, error, readJson });
