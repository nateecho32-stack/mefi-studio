import assert from "node:assert/strict";
import test from "node:test";
import hub from "../scripts/hub-client.cjs";

// My PCs in scripts/hub-client.cjs (docs/my-pcs.md) against a fake hub: this
// PC is named (pcHello) only to a hub that carries "pcs", after every ready
// and on a change; status lines and envelopes keep to the protocol's sizes;
// pcSend waits for its ack; and what the relay sends is checked before it is
// handed on. Nothing here opens a socket.

const T0 = 1_800_000_000_000;
const USER = { id: "123456789012345678", name: "Mefi" };
const FRIEND = { id: "223456789012345678", name: "Bob" };
const key = (fill) => Buffer.alloc(32, fill).toString("base64");
const PC = { pc: { id: "pc-1b2c3d4e-0000-4000-8000-000000000001", name: "DESKTOP-HOME", kind: "desktop" }, keys: { sign: key(1), box: key(2) }, lendTo: [] };
const OTHER = { id: "pc-1b2c3d4e-0000-4000-8000-000000000002", name: "Laptop", kind: "laptop", owner: USER, mine: true, lends: false, keys: { sign: key(3), box: key(4) }, since: T0 };
const ENV = { v: 1, k: "sealed", from: PC.pc.id, to: OTHER.id, at: T0, n: "n1", iv: "aa", ct: "bb", sig: "cc" };
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((done) => setImmediate(done)); };

function harness() {
  let now = T0, seq = 0;
  const timers = new Map(), events = [], sockets = [];
  class FakeSocket {
    constructor(address) { this.url = address; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close(code = 1000) { this.readyState = 3; this.closedWith = code; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
    drop(code) { this.readyState = 3; this.onclose?.({ code }); }
  }
  let sessions = 0;
  const fetch = async (href, init) => {
    const path = new URL(href).pathname;
    if (init.method === "POST" && path === "/v1/session") { sessions += 1; return { ok: true, status: 200, json: async () => ({ ok: true, session: `s${sessions}`, expiresAt: now + 15 * 60_000, user: USER }) }; }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const client = hub.createHubClient({
    url: "https://hub.example.test", fetch, WebSocket: FakeSocket, now: () => now,
    getAccessToken: async () => ({ ok: true, token: "discord-access" }),
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    onEvent: (event) => events.push(event),
  });
  const socket = () => sockets.at(-1);
  const sent = (type) => socket().sent.filter((frame) => frame.type === type);
  const of = (type) => events.filter((event) => event.type === type);
  async function readyUp(features = ["pcs"]) {
    await client.connect();
    socket().open();
    socket().receive({ type: "ready", user: USER, protocol: 1, features });
    await settle();
  }
  // The fake clock: one-shot timers that fall due run once.
  function tick(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.every || timer.at > now) continue;
      timers.delete(id);
      timer.fn();
    }
  }
  return { client, events, socket, sent, of, readyUp, sockets, tick };
}

test("hello says this Studio speaks pcs; pcHello goes only to a hub that carries it, after ready and on a change", async () => {
  assert.ok(hub.CLIENT_FEATURES.includes("pcs"));
  const off = harness();
  assert.equal(off.client.setPc(PC), true, "kept before the connection");
  await off.readyUp(["companion"]);
  assert.equal(off.socket().sent[0].features.includes("pcs"), true, "hello names pcs");
  assert.deepEqual(off.sent("pcHello"), [], "a hub without pcs is never sent one");
  assert.equal(off.client.status().pcs, false);
  assert.equal(off.client.status().pcOn, false);

  const h = harness();
  assert.equal(h.client.setPc(PC), true);
  assert.equal(h.sockets.length, 0, "nothing goes before a socket");
  await h.readyUp();
  assert.deepEqual(h.sent("pcHello"), [{ type: "pcHello", pc: PC.pc, keys: PC.keys, lendTo: [] }], "named right after ready");
  assert.deepEqual(h.client.status().pcs, true);
  assert.deepEqual(h.client.status().pcOn, true);
  h.client.setPc({ ...PC, pc: { ...PC.pc } });
  assert.equal(h.sent("pcHello").length, 1, "the same PC twice is one hello");
  h.client.setPc({ ...PC, lendTo: [FRIEND.id, FRIEND.id] });
  assert.deepEqual(h.sent("pcHello").at(-1).lendTo, [FRIEND.id], "a change goes out, each friend once");
  h.client.setPc({ pc: PC.pc, keys: PC.keys });
  assert.deepEqual(h.sent("pcHello").at(-1).lendTo, [], "no lend list is an empty one");

  assert.equal(h.client.setPc(null), true);
  assert.equal(h.sent("pcHello").length, 3, "forgetting sends nothing: the relay forgets a PC when its socket closes");
  assert.equal(h.client.status().pcOn, false);
});

test("setPc refuses a wrong shape and keeps the last good one", async () => {
  const h = harness();
  await h.readyUp();
  h.client.setPc(PC);
  const bad = [
    "pc",
    { ...PC, pc: { ...PC.pc, id: "has space" } },
    { ...PC, pc: { ...PC.pc, id: 42 } },
    { ...PC, pc: { ...PC.pc, name: "   " } },
    { ...PC, pc: { ...PC.pc, name: "x".repeat(41) } },
    { ...PC, pc: { ...PC.pc, name: "two\nlines" } },
    { ...PC, pc: { ...PC.pc, kind: "server" } },
    { ...PC, keys: { sign: key(1) } },
    { ...PC, keys: { sign: key(1).slice(1), box: key(2) } },
    { ...PC, keys: { sign: key(1).replace(/=$/, "A"), box: key(2) } },
    { ...PC, keys: { sign: key(1).replace(/^./, "_"), box: key(2) } },
    { ...PC, lendTo: Array.from({ length: 9 }, (_, index) => `22345678901234567${index}`) },
    { ...PC, lendTo: ["bob"] },
    { ...PC, lendTo: [Number(FRIEND.id)] },
    { ...PC, lendTo: FRIEND.id },
  ];
  for (const value of bad) assert.equal(h.client.setPc(value), false, JSON.stringify(value).slice(0, 80));
  assert.equal(h.sent("pcHello").length, 1);
  assert.equal(h.client.setPc({ ...PC, lendTo: Array.from({ length: 8 }, (_, index) => `22345678901234567${index}`) }), true, "eight lends are fine");
});

test("a reconnect names this PC again; a disconnect forgets it", async () => {
  const h = harness();
  await h.readyUp();
  h.client.setPc(PC);
  h.socket().drop(1006);
  await settle();
  const before = h.sockets.length;
  await h.client.connect();
  if (h.sockets.length === before) await new Promise((done) => setTimeout(done, 0));
  h.socket().open();
  h.socket().receive({ type: "ready", user: USER, protocol: 1, features: ["pcs"] });
  await settle();
  assert.deepEqual(h.sent("pcHello"), [{ type: "pcHello", pc: PC.pc, keys: PC.keys, lendTo: [] }], "the new socket is named again");
  await h.client.disconnect();
  assert.equal(h.client.status().pcOn, false);
  assert.equal(h.client.status().pcs, false);
});

test("status lines: only once named, to a hub that carries pcs, at most 3 KB", async () => {
  const h = harness();
  assert.equal(h.client.pcState({ v: 1 }), false, "not connected");
  await h.readyUp();
  assert.equal(h.client.pcState({ v: 1 }), false, "no setPc yet");
  h.client.setPc(PC);
  assert.equal(h.client.pcState("ok"), false);
  assert.equal(h.client.pcState([1]), false);
  assert.equal(h.client.pcState({ v: 1, blob: "x".repeat(3 * 1024) }), false, "over 3 KB");
  const line = { v: 1, at: T0, name: "DESKTOP-HOME", kind: "desktop", stage: "ok", slots: { running: 1, max: 3 }, projects: [] };
  assert.equal(h.client.pcState(line), true);
  assert.deepEqual(h.sent("pcState"), [{ type: "pcState", state: line }]);

  const old = harness();
  old.client.setPc(PC);
  await old.readyUp(["remote"]);
  assert.equal(old.client.pcState(line), false, "a hub without pcs");
});

test("pcSend waits for the relay's ack or nack, or times out", async () => {
  const h = harness();
  assert.deepEqual(await h.client.pcSend(OTHER.id, ENV), { ok: false, reason: "offline" });
  await h.readyUp();
  assert.deepEqual(await h.client.pcSend(OTHER.id, ENV), { ok: false, reason: "no-pc" });
  h.client.setPc(PC);
  assert.deepEqual(await h.client.pcSend("has space", ENV), { ok: false, reason: "bad-request" });
  assert.deepEqual(await h.client.pcSend(OTHER.id, "sealed"), { ok: false, reason: "bad-request" });
  assert.deepEqual(await h.client.pcSend(OTHER.id, { v: 1, blob: "x".repeat(12 * 1024) }), { ok: false, reason: "too-large" });
  assert.equal(h.sent("pcSend").length, 0);

  const acked = h.client.pcSend(OTHER.id, ENV);
  const frame = h.sent("pcSend")[0];
  assert.deepEqual({ ...frame, nonce: "?" }, { type: "pcSend", to: OTHER.id, env: ENV, nonce: "?" });
  h.socket().receive({ type: "ack", nonce: frame.nonce });
  assert.deepEqual(await acked, { ok: true });

  const refused = h.client.pcSend(OTHER.id, ENV);
  h.socket().receive({ type: "nack", nonce: h.sent("pcSend")[1].nonce, reason: "not-online" });
  assert.equal((await refused).reason, "not-online");
  const busy = h.client.pcSend(OTHER.id, ENV);
  h.socket().receive({ type: "nack", nonce: h.sent("pcSend")[2].nonce, reason: "rate-limited", retryAfter: 900 });
  assert.deepEqual(await busy, { ok: false, reason: "rate-limited", retryAfter: 900 });

  const lost = h.client.pcSend(OTHER.id, ENV);
  h.tick(10_000);
  assert.deepEqual(await lost, { ok: false, reason: "timeout" });

  const cut = h.client.pcSend(OTHER.id, ENV);
  h.socket().drop(1006);
  assert.deepEqual(await cut, { ok: false, reason: "offline" }, "a dropped socket answers what was waiting");

  const old = harness();
  old.client.setPc(PC);
  await old.readyUp(["companion"]);
  assert.deepEqual(await old.client.pcSend(OTHER.id, ENV), { ok: false, reason: "unsupported" });
});

test("rosters, status lines and envelopes from the relay are checked before they are handed on", async () => {
  const h = harness();
  await h.readyUp();
  h.socket().receive({ type: "pcs", pcs: [OTHER] });
  h.socket().receive({ type: "pcState", from: OTHER.id, state: { v: 1 } });
  h.socket().receive({ type: "pcMsg", from: OTHER.id, fromUser: USER.id, fromName: "Mefi", keys: OTHER.keys, env: ENV });
  assert.equal(h.of("pcs").length + h.of("pcState").length + h.of("pcMsg").length, 0, "nothing before setPc names this PC");

  h.client.setPc(PC);
  const lent = { ...OTHER, id: "pc-friend", name: "BOB-PC", owner: FRIEND, mine: false, lends: true };
  h.socket().receive({
    type: "pcs",
    pcs: [
      OTHER, lent, { ...OTHER, name: "duplicate" },
      { ...OTHER, id: "bad id" }, { ...OTHER, id: "pc-x", kind: "server" }, { ...OTHER, id: "pc-y", keys: { sign: "nope", box: key(1) } },
      { ...OTHER, id: "pc-z", owner: { id: "nope", name: "x" } }, { ...OTHER, id: "pc-w", name: "" }, "junk", null,
      { ...OTHER, id: "pc-both", mine: true, lends: true, since: "yesterday", extra: "dropped" },
    ],
  });
  const pcs = h.of("pcs").at(-1).pcs;
  assert.deepEqual(pcs.map((item) => item.id), [OTHER.id, "pc-friend", "pc-both"], "malformed and repeated entries are dropped");
  assert.deepEqual(pcs[0], OTHER);
  assert.deepEqual(pcs[1], lent);
  assert.deepEqual(pcs[2], { ...OTHER, id: "pc-both", mine: true, lends: false, since: null }, "a PC is mine or lent, never both; no extra fields");
  h.socket().receive({ type: "pcs", pcs: Array.from({ length: 20 }, (_, index) => ({ ...OTHER, id: `pc-${index}` })) });
  assert.equal(h.of("pcs").at(-1).pcs.length, 16, "at most 16");
  h.socket().receive({ type: "pcs", pcs: "nope" });
  assert.equal(h.of("pcs").length, 2);

  h.socket().receive({ type: "pcState", from: OTHER.id, state: { v: 1, cpu: 12 } });
  h.socket().receive({ type: "pcState", from: "bad id", state: { v: 1 } });
  h.socket().receive({ type: "pcState", from: OTHER.id, state: [1] });
  h.socket().receive({ type: "pcState", from: OTHER.id, state: { blob: "x".repeat(3 * 1024) } });
  assert.deepEqual(h.of("pcState"), [{ type: "pcState", from: OTHER.id, state: { v: 1, cpu: 12 }, receivedAt: T0 }]);

  h.socket().receive({ type: "pcMsg", from: OTHER.id, fromUser: USER.id, fromName: "Mefi", keys: OTHER.keys, env: ENV });
  h.socket().receive({ type: "pcMsg", from: OTHER.id, fromUser: "nope", fromName: "Mefi", keys: OTHER.keys, env: ENV });
  h.socket().receive({ type: "pcMsg", from: OTHER.id, fromUser: USER.id, fromName: "Mefi", env: ENV });
  h.socket().receive({ type: "pcMsg", from: OTHER.id, fromUser: USER.id, fromName: "Mefi", keys: OTHER.keys, env: "sealed" });
  h.socket().receive({ type: "pcMsg", from: OTHER.id, fromUser: USER.id, fromName: "Mefi", keys: OTHER.keys, env: { blob: "x".repeat(12 * 1024) } });
  h.socket().receive({ type: "pcMsg", from: "pc-friend", fromUser: FRIEND.id, keys: lent.keys, env: ENV });
  assert.deepEqual(h.of("pcMsg"), [
    { type: "pcMsg", from: OTHER.id, fromUser: USER.id, fromName: "Mefi", keys: OTHER.keys, env: ENV, receivedAt: T0 },
    { type: "pcMsg", from: "pc-friend", fromUser: FRIEND.id, fromName: "member", keys: lent.keys, env: ENV, receivedAt: T0 },
  ]);
});

test("the shapes on their own", () => {
  assert.deepEqual(hub.PC_KINDS, ["desktop", "laptop"]);
  assert.equal(hub.pcKeys({ sign: key(1) }), null);
  assert.deepEqual(hub.pcKeys({ sign: key(1), box: key(2), extra: 1 }), { sign: key(1), box: key(2) });
  assert.deepEqual(hub.pcHello({ ...PC, lendTo: undefined }), { pc: PC.pc, keys: PC.keys, lendTo: [] });
  assert.equal(hub.pcHello(null), null);
  assert.equal(hub.pcView({ ...OTHER, owner: null }), null);
  assert.deepEqual(hub.pcView(OTHER), OTHER);
  assert.equal(hub.pcViews("x"), null);
  assert.deepEqual(hub.pcViews([]), []);
});
