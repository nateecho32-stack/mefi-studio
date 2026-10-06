"use strict";
// Which Studio versions still connect to each other: your paired PCs
// (scripts/paired-transport.cjs) and Friends' relay (scripts/hub-client.cjs,
// relay/src/protocol.mjs). Each link speaks a protocol number, and each side
// accepts every number from its `oldest` up to its own `protocol`. Two sides
// connect when those windows overlap and speak the highest number both know,
// so a PC one or two releases behind keeps working. Only a side whose newest
// number is below the other side's oldest is really behind, and only that
// side is asked to update.
//
// Raise `protocol` when a frame changes in a way an older side would misread;
// raise `oldest` only when the code that still speaks an old number is
// removed, and keep it a few releases behind `protocol`.
//
// A peer from before versions were exchanged sends neither number: it speaks
// 1 and accepts only its own number (the relay's old exact check). Pure.

const LINKS = Object.freeze({
  pcs: Object.freeze({ protocol: 1, oldest: 1 }),
  friends: Object.freeze({ protocol: 1, oldest: 1 }),
});

const APP = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?$/;

function number(value) {
  return Number.isInteger(value) && value >= 1 && value <= 1000 ? value : null;
}

// A side's window, as sent or as stored. An `oldest` above `protocol` is
// clamped, so a malformed peer can never claim a window it cannot speak.
function windowOf(raw) {
  const protocol = number(raw?.protocol) ?? 1;
  const oldest = Math.min(number(raw?.oldest) ?? protocol, protocol);
  return { protocol, oldest };
}

// The plain Studio version a peer reports ("0.5.0"), or null.
function appVersion(value) {
  return typeof value === "string" && APP.test(value) ? value : null;
}

// { ok: true, speak } when the windows overlap; otherwise { ok: false, behind }
// names the side that has to update: "me" or "them".
function negotiate(mine, theirs) {
  const a = windowOf(mine);
  const b = windowOf(theirs);
  const speak = Math.min(a.protocol, b.protocol);
  if (speak >= Math.max(a.oldest, b.oldest)) return { ok: true, speak, behind: null };
  return { ok: false, speak: null, behind: a.protocol < b.protocol ? "me" : "them" };
}

// "0.4.10" > "0.4.9"; a pre-release sorts before its release. Unknown text
// compares equal, so a missing version never reads as behind.
function compareVersions(left, right) {
  const parse = (value) => {
    const text = appVersion(value);
    if (!text) return null;
    const [core, pre = ""] = text.split(/[-+]/, 2);
    return { parts: core.split(".").map(Number), pre };
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] < b.parts[index] ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre < b.pre ? -1 : 1;
}

// One line for a person: how this PC and a peer compare, and whether anyone
// has to update. `peer` is a name ("Laptop", "the relay").
function describe({ verdict, peer = "the other PC", mine = null, theirs = null } = {}) {
  const me = appVersion(mine);
  const them = appVersion(theirs);
  if (verdict && verdict.ok === false) {
    if (verdict.behind === "me") return `This Studio${me ? ` (${me})` : ""} is too far behind ${peer} to connect. Update Studio and it reconnects by itself.`;
    return `${peer}${them ? ` (Studio ${them})` : ""} is too far behind to connect. Update Studio there and it reconnects by itself.`;
  }
  if (!me || !them || compareVersions(me, them) === 0) return "";
  const older = compareVersions(me, them) < 0 ? "This PC" : peer;
  return `${older} runs an older Studio (${me} here, ${them} on ${peer}). They still connect; update when it suits you.`;
}

module.exports = { LINKS, windowOf, appVersion, negotiate, compareVersions, describe };
