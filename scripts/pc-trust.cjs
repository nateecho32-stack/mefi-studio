"use strict";

// My PCs' trust (docs/my-pcs.md): each PC's two key pairs, the six numbers two
// PCs show while they pair, and the envelopes they send each other through the
// relay. Pure module: no Electron, no filesystem, no network, no clock reads
// (time is passed in). main.cjs "My PCs" keeps the private halves through
// safeStorage and owns the relay.
// - Ed25519 signs every envelope, so the relay cannot forge or alter one.
// - X25519 + HKDF-SHA256 give each pair of PCs one AES-256-GCM key, so the
//   relay carries task briefs it cannot read.
// - The six numbers come from both PCs' public keys. A relay that swapped keys
//   makes the two screens disagree, which the owner sees before choosing Pair.
// - A receiver refuses an unpaired sender, a bad signature, a clock more than
//   ten minutes off and a nonce it has already seen.
// Guarded by tests/pc_trust.test.mjs.
const crypto = require("node:crypto");

const VERSION = 1;
const SKEW_MS = 10 * 60_000;
const NONCES_KEPT = 4000;
const BODY_MAX = 8 * 1024; // a sealed body's JSON: base64 and the envelope keep it under the relay's 12 KB
const PC_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const KEY = /^[A-Za-z0-9+/]{43}=$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const STEPS = Object.freeze(["ask", "ok", "no", "forget"]);
const RELATIONS = Object.freeze(["mine", "borrow"]);
// The DER prefixes of a raw 32-byte public key as SubjectPublicKeyInfo.
const SPKI = Object.freeze({
  sign: Buffer.from("302a300506032b6570032100", "hex"), // Ed25519
  box: Buffer.from("302a300506032b656e032100", "hex"), // X25519
});

const isKey = (value) => typeof value === "string" && KEY.test(value);
const isPcId = (value) => typeof value === "string" && PC_ID.test(value);
const keysOf = (value) => (value && isKey(value.sign) && isKey(value.box) ? { sign: value.sign, box: value.box } : null);

function rawPublic(keyObject) {
  const der = keyObject.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32).toString("base64");
}

function publicKey(raw, kind) {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI[kind], Buffer.from(raw, "base64")]), format: "der", type: "spki" });
}

// A fresh identity: `public` goes to the relay, `secret` is what main seals.
function makeIdentity() {
  const sign = crypto.generateKeyPairSync("ed25519");
  const box = crypto.generateKeyPairSync("x25519");
  return {
    v: VERSION,
    public: { sign: rawPublic(sign.publicKey), box: rawPublic(box.publicKey) },
    secret: {
      sign: sign.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
      box: box.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    },
  };
}

// The usable identity from what main kept, or null when it is damaged or its
// halves do not belong together.
function loadIdentity(saved) {
  try {
    const pub = keysOf(saved?.public);
    if (!pub || typeof saved.secret?.sign !== "string" || typeof saved.secret?.box !== "string") return null;
    const sign = crypto.createPrivateKey({ key: Buffer.from(saved.secret.sign, "base64"), format: "der", type: "pkcs8" });
    const box = crypto.createPrivateKey({ key: Buffer.from(saved.secret.box, "base64"), format: "der", type: "pkcs8" });
    if (sign.asymmetricKeyType !== "ed25519" || box.asymmetricKeyType !== "x25519") return null;
    if (rawPublic(crypto.createPublicKey(sign)) !== pub.sign || rawPublic(crypto.createPublicKey(box)) !== pub.box) return null;
    return { public: pub, sign, box };
  } catch {
    return null;
  }
}

// The six numbers both screens show, "123 456". Order does not matter.
function pairNumbers(one, two) {
  const a = keysOf(one), b = keysOf(two);
  if (!a || !b) return null;
  const [x, y] = [`${a.sign}${a.box}`, `${b.sign}${b.box}`].sort();
  const digest = crypto.createHash("sha256").update(`pcs1|sas|${x}|${y}`).digest();
  const value = ((digest[0] << 12) | (digest[1] << 4) | (digest[2] >> 4)) % 1_000_000;
  const text = String(value).padStart(6, "0");
  return `${text.slice(0, 3)} ${text.slice(3)}`;
}

// Nonces this PC has already accepted, oldest dropped first.
function nonceMemory(limit = NONCES_KEPT) {
  const seen = new Map();
  return {
    has: (nonce) => seen.has(nonce),
    add(nonce, at) {
      seen.set(nonce, at);
      while (seen.size > limit) seen.delete(seen.keys().next().value);
    },
    prune(now) { for (const [nonce, at] of seen) if (Math.abs(now - at) > SKEW_MS) seen.delete(nonce); },
    get size() { return seen.size; },
  };
}

const randomNonce = () => crypto.randomBytes(16).toString("base64");
const fresh = (at, now) => Number.isFinite(at) && Math.abs(now - at) <= SKEW_MS;

function signText(identity, text) {
  return crypto.sign(null, Buffer.from(text), identity.sign).toString("base64");
}

function checkSig(signKey, text, sig) {
  try {
    return typeof sig === "string" && B64.test(sig) && crypto.verify(null, Buffer.from(text), publicKey(signKey, "sign"), Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}

// ---- pairing ---------------------------------------------------------------------

const pairText = (env) => `pcs1|pair|${env.from}|${env.to}|${env.at}|${env.n}|${env.step}|${env.relation}`;

function pairEnvelope(identity, { from, to, step, relation = "mine", name = "", now, nonce = randomNonce() }) {
  if (!isPcId(from) || !isPcId(to) || !STEPS.includes(step) || !RELATIONS.includes(relation)) throw new Error("Not a pairing message.");
  const env = { v: VERSION, k: "pair", from, to, at: now, n: nonce, step, relation, name: String(name).replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 40) };
  env.sig = signText(identity, pairText(env));
  return env;
}

// A pairing message, checked against the key the relay's roster gives for its
// sender. -> { ok, from, step, relation, name } or { ok: false, reason }.
function openPair(env, { me, signKey, now, seen = null }) {
  if (!env || env.v !== VERSION || env.k !== "pair") return { ok: false, reason: "not-pairing" };
  if (!isPcId(env.from) || env.to !== me || !STEPS.includes(env.step) || !RELATIONS.includes(env.relation)) return { ok: false, reason: "bad-shape" };
  if (!fresh(env.at, now)) return { ok: false, reason: "stale" };
  if (typeof env.n !== "string" || !env.n || env.n.length > 40 || seen?.has(`${env.from}|${env.n}`)) return { ok: false, reason: "replayed" };
  if (!isKey(signKey) || !checkSig(signKey, pairText(env), env.sig)) return { ok: false, reason: "bad-signature" };
  seen?.add(`${env.from}|${env.n}`, now);
  return { ok: true, from: env.from, step: env.step, relation: env.relation, name: typeof env.name === "string" ? env.name.slice(0, 40) : "" };
}

// ---- sealed messages -------------------------------------------------------------

function sharedKey(identity, peerBox, from, to) {
  const secret = crypto.diffieHellman({ privateKey: identity.box, publicKey: publicKey(peerBox, "box") });
  const salt = `pcs1|${[from, to].sort().join("|")}`;
  return Buffer.from(crypto.hkdfSync("sha256", secret, Buffer.from(salt), Buffer.from("mefi-pcs-v1"), 32));
}

const sealedText = (env) => `pcs1|sealed|${env.from}|${env.to}|${env.at}|${env.n}|${env.iv}|${env.ct}`;

// `body` for the paired PC `peer` ({ box }). Throws when the body is too big.
function seal(identity, peer, { from, to, body, now, nonce = randomNonce(), iv = crypto.randomBytes(12) }) {
  if (!isPcId(from) || !isPcId(to) || !keysOf(peer)) throw new Error("Not a paired PC.");
  const json = JSON.stringify(body);
  if (Buffer.byteLength(json) > BODY_MAX) throw new Error("This message is too big to send to another PC.");
  const key = sharedKey(identity, peer.box, from, to);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`pcs1|${from}|${to}|${now}|${nonce}`));
  const ct = Buffer.concat([cipher.update(json, "utf8"), cipher.final(), cipher.getAuthTag()]);
  const env = { v: VERSION, k: "sealed", from, to, at: now, n: nonce, iv: iv.toString("base64"), ct: ct.toString("base64") };
  env.sig = signText(identity, sealedText(env));
  return env;
}

// A sealed message for this PC (`me`) from a paired PC. `peers` maps a pc id
// to its { sign, box }. -> { ok, from, body } or { ok: false, reason }.
function open(identity, env, { me, peers, now, seen = null }) {
  if (!env || env.v !== VERSION || env.k !== "sealed") return { ok: false, reason: "not-sealed" };
  if (!isPcId(env.from) || env.to !== me || typeof env.iv !== "string" || typeof env.ct !== "string" || !B64.test(env.iv) || !B64.test(env.ct)) return { ok: false, reason: "bad-shape" };
  const peer = keysOf(typeof peers?.get === "function" ? peers.get(env.from) : peers?.[env.from]);
  if (!peer) return { ok: false, reason: "not-paired" };
  if (!fresh(env.at, now)) return { ok: false, reason: "stale" };
  if (typeof env.n !== "string" || !env.n || env.n.length > 40 || seen?.has(`${env.from}|${env.n}`)) return { ok: false, reason: "replayed" };
  if (!checkSig(peer.sign, sealedText(env), env.sig)) return { ok: false, reason: "bad-signature" };
  let body;
  try {
    const raw = Buffer.from(env.ct, "base64");
    if (raw.length < 17) return { ok: false, reason: "bad-shape" };
    const decipher = crypto.createDecipheriv("aes-256-gcm", sharedKey(identity, peer.box, env.from, env.to), Buffer.from(env.iv, "base64"));
    decipher.setAAD(Buffer.from(`pcs1|${env.from}|${env.to}|${env.at}|${env.n}`));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    body = JSON.parse(Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString("utf8"));
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.type !== "string") return { ok: false, reason: "bad-body" };
  seen?.add(`${env.from}|${env.n}`, now);
  return { ok: true, from: env.from, body };
}

module.exports = {
  VERSION, SKEW_MS, BODY_MAX, STEPS, RELATIONS,
  isKey, isPcId, keysOf, makeIdentity, loadIdentity, pairNumbers, nonceMemory,
  pairEnvelope, openPair, seal, open,
};
