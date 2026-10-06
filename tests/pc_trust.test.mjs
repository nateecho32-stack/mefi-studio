import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const trust = require("../scripts/pc-trust.cjs");

const NOW = 1_780_000_000_000;
const A = "pc-aaaaaaaa-1111-2222-3333-444444444444";
const B = "pc-bbbbbbbb-1111-2222-3333-444444444444";

function pair() {
  const a = trust.makeIdentity(), b = trust.makeIdentity();
  return { a, b, ia: trust.loadIdentity(a), ib: trust.loadIdentity(b) };
}

test("an identity round-trips through what main keeps, and a mixed one is refused", () => {
  const { a, b, ia } = pair();
  assert.ok(ia);
  assert.ok(trust.isKey(a.public.sign) && trust.isKey(a.public.box));
  assert.deepEqual(ia.public, a.public);
  // Another PC's private half under this PC's public keys does not load.
  assert.equal(trust.loadIdentity({ public: a.public, secret: b.secret }), null);
  assert.equal(trust.loadIdentity({ public: a.public, secret: { sign: "AAAA", box: a.secret.box } }), null);
  assert.equal(trust.loadIdentity(null), null);
});

test("both PCs show the same six numbers, and a swapped key changes them", () => {
  const { a, b } = pair();
  const one = trust.pairNumbers(a.public, b.public);
  assert.match(one, /^\d{3} \d{3}$/);
  assert.equal(trust.pairNumbers(b.public, a.public), one);
  const relay = trust.makeIdentity();
  assert.notEqual(trust.pairNumbers(a.public, relay.public), one);
  assert.equal(trust.pairNumbers(a.public, { sign: "x", box: "y" }), null);
});

test("a pairing message opens only with its sender's key, once, and in time", () => {
  const { a, b, ia } = pair();
  const seen = trust.nonceMemory();
  const env = trust.pairEnvelope(ia, { from: A, to: B, step: "ask", relation: "mine", name: "Laptop\nX", now: NOW });
  assert.equal(env.name, "Laptop X");
  assert.deepEqual(trust.openPair(env, { me: B, signKey: a.public.sign, now: NOW + 1000, seen }), { ok: true, from: A, step: "ask", relation: "mine", name: "Laptop X" });
  assert.equal(trust.openPair(env, { me: B, signKey: a.public.sign, now: NOW + 1000, seen }).reason, "replayed");
  const other = trust.pairEnvelope(ia, { from: A, to: B, step: "ok", now: NOW });
  assert.equal(trust.openPair(other, { me: B, signKey: b.public.sign, now: NOW }).reason, "bad-signature");
  assert.equal(trust.openPair(other, { me: A, signKey: a.public.sign, now: NOW }).reason, "bad-shape");
  assert.equal(trust.openPair(other, { me: B, signKey: a.public.sign, now: NOW + trust.SKEW_MS + 1 }).reason, "stale");
  // The step is signed: the relay cannot turn an "ask" into an "ok".
  assert.equal(trust.openPair({ ...other, step: "forget" }, { me: B, signKey: a.public.sign, now: NOW }).reason, "bad-signature");
  assert.throws(() => trust.pairEnvelope(ia, { from: A, to: B, step: "steal", now: NOW }));
});

test("a sealed body opens on the paired PC only", () => {
  const { a, b, ia, ib } = pair();
  const body = { type: "offer", offerId: "o1", tasks: [{ id: "task_1", title: "Fix the header" }] };
  const env = trust.seal(ia, b.public, { from: A, to: B, body, now: NOW });
  assert.equal(env.k, "sealed");
  assert.ok(!JSON.stringify(env).includes("Fix the header"), "the relay never sees the body");
  const peers = new Map([[A, a.public]]);
  const seen = trust.nonceMemory();
  assert.deepEqual(trust.open(ib, env, { me: B, peers, now: NOW + 5000, seen }), { ok: true, from: A, body });
  assert.equal(trust.open(ib, env, { me: B, peers, now: NOW + 5000, seen }).reason, "replayed");
  // Unpaired, wrong recipient, tampered and stale messages are refused.
  assert.equal(trust.open(ib, { ...env, n: "other" }, { me: B, peers: new Map(), now: NOW }).reason, "not-paired");
  assert.equal(trust.open(ib, env, { me: A, peers, now: NOW }).reason, "bad-shape");
  const tampered = { ...env, ct: Buffer.from(Buffer.from(env.ct, "base64").map((byte, i) => (i === 0 ? byte ^ 1 : byte))).toString("base64"), n: "n2" };
  assert.equal(trust.open(ib, tampered, { me: B, peers, now: NOW }).reason, "bad-signature");
  assert.equal(trust.open(ib, { ...env, n: "n3" }, { me: B, peers, now: NOW }).reason, "bad-signature");
  const late = trust.seal(ia, b.public, { from: A, to: B, body, now: NOW - trust.SKEW_MS - 1 });
  assert.equal(trust.open(ib, late, { me: B, peers, now: NOW }).reason, "stale");
});

test("a third PC cannot read or forge a sealed message", () => {
  const { a, b, ia } = pair();
  const c = trust.makeIdentity(), ic = trust.loadIdentity(c);
  const env = trust.seal(ia, b.public, { from: A, to: B, body: { type: "start", title: "x" }, now: NOW });
  // C holds A's public keys but not B's private one: it cannot decrypt.
  assert.equal(trust.open(ic, env, { me: B, peers: { [A]: a.public }, now: NOW }).reason, "unreadable");
  // C signing as A fails against A's real key.
  const forged = trust.seal(ic, b.public, { from: A, to: B, body: { type: "start", title: "x" }, now: NOW });
  assert.equal(trust.open(trust.loadIdentity(b), forged, { me: B, peers: { [A]: a.public }, now: NOW }).reason, "bad-signature");
});

test("bodies over the limit are refused before they reach the relay", () => {
  const { b, ia } = pair();
  assert.throws(() => trust.seal(ia, b.public, { from: A, to: B, body: { type: "start", prompt: "x".repeat(trust.BODY_MAX) }, now: NOW }), /too big/);
  const env = trust.seal(ia, b.public, { from: A, to: B, body: { type: "start", prompt: "x".repeat(trust.BODY_MAX - 100) }, now: NOW });
  assert.ok(Buffer.byteLength(JSON.stringify(env)) < 12 * 1024, "an envelope at the body limit fits the relay's 12 KB");
});

test("the nonce memory forgets the oldest past its limit and prunes stale ones", () => {
  const memory = trust.nonceMemory(3);
  for (const n of ["a", "b", "c", "d"]) memory.add(n, NOW);
  assert.equal(memory.size, 3);
  assert.equal(memory.has("a"), false);
  memory.add("e", NOW - trust.SKEW_MS - 10);
  memory.prune(NOW);
  assert.equal(memory.has("e"), false);
  assert.equal(memory.has("d"), true);
});
