import assert from "node:assert/strict";
import test from "node:test";
import { createPcs, PCS_LIMITS } from "../relay/src/pcs.mjs";
import { LIMITS, hubFrame, parseClientFrame } from "../relay/src/protocol.mjs";
import { ALICE, BOB, CARA, connectAll, makeRelay, member, rawSocket, until, wait } from "./fixtures/relay-harness.mjs";

// My PCs on the relay (relay/src/pcs.mjs, docs/my-pcs.md "Protocol"): who sees
// whom, status lines (projects only to the member's own PCs), envelopes with
// their acks and nacks, lends only to people the member shares a room with,
// fresh rosters on every change and close, the rate limits, and nothing kept
// anywhere but on the sockets themselves.

const key = (fill) => Buffer.alloc(32, fill).toString("base64");
const pcOf = (id, name, kind, fill) => ({ pc: { id, name, kind }, keys: { sign: key(fill), box: key(fill + 100) } });
const DESK = pcOf("pc-0a000000-0000-4000-8000-000000000001", "DESKTOP-HOME", "desktop", 1);
const LAPTOP = pcOf("pc-0a000000-0000-4000-8000-000000000002", "Alice's laptop", "laptop", 2);
const BOBS = pcOf("pc-0b000000-0000-4000-8000-000000000001", "BOB-PC", "desktop", 3);
const CARAS = pcOf("pc-0c000000-0000-4000-8000-000000000001", "CARA-PC", "laptop", 4);
const ENV = { v: 1, k: "sealed", from: "x", to: "y", at: 1, n: "n1", iv: "aaaa", ct: "bbbb", sig: "cccc" };

function api(relay) {
  const tokens = new Map();
  return async function as(token, method, path, body) {
    if (!tokens.has(token)) {
      const answer = await relay.fetch("http://127.0.0.1:8787/v1/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: token }) });
      tokens.set(token, (await answer.json()).session);
    }
    const headers = { authorization: `Bearer ${tokens.get(token)}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const answer = await relay.fetch(`http://127.0.0.1:8787${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: answer.status, ...(await answer.json()) };
  };
}

/** Alice's room with `guest` in it, so Alice's PCs may lend themselves to them. */
async function shareRoom(relay, guest) {
  const as = api(relay);
  const made = await as("tok-alice", "POST", "/v1/rooms", { kind: "hangout", name: "Pals", policy: "request", listed: true });
  assert.equal(made.ok, true, JSON.stringify(made));
  const asked = await as(guest, "POST", `/v1/rooms/${made.room.id}/requests`, { note: "hi" });
  const decided = await as("tok-alice", "POST", `/v1/requests/${asked.request.id}/decide`, { decision: "approve" });
  assert.equal(decided.request.status, "approved");
  return made.room.id;
}

/** A raw socket that said hello, and pcHello as `which` when given. */
async function pcSocket(relay, token, which = null, lendTo = []) {
  const raw = await rawSocket(relay, token);
  raw.send({ type: "hello", session: raw.session, protocol: 1, features: ["pcs"] });
  await until(() => raw.of("ready").length, `${token} ready`);
  raw.roster = () => raw.of("pcs").at(-1)?.pcs ?? null;
  raw.ids = () => (raw.roster() ?? []).map((item) => item.id);
  raw.hello = async (pc, lend = []) => {
    const before = raw.of("pcs").length;
    raw.send({ type: "pcHello", ...pc, lendTo: lend });
    await until(() => raw.of("pcs").length > before, `${token}'s roster`);
  };
  if (which) await raw.hello(which, lendTo);
  return raw;
}

let nonces = 0;
async function pcSend(raw, to, env = ENV) {
  const nonce = `n${(nonces += 1)}`;
  raw.send({ type: "pcSend", to, env, nonce });
  return until(() => raw.frames.find((frame) => (frame.type === "ack" || frame.type === "nack") && frame.nonce === nonce), `the answer to ${nonce}`);
}

test("the relay lists pcs and holds the pc frames to their shapes", async () => {
  const hello = (fields) => parseClientFrame(JSON.stringify({ type: "pcHello", ...DESK, lendTo: [], ...fields }));
  assert.equal(hello({}).ok, true);
  assert.deepEqual(hello({ extra: 1 }).frame, { type: "pcHello", ...DESK, lendTo: [] }, "unknown fields are dropped");
  assert.equal(hello({ keys: { sign: key(1).slice(1), box: key(2) } }).ok, false, "a key is 44 characters");
  assert.equal(hello({ keys: { sign: `${key(1).slice(0, 43)}A`, box: key(2) } }).ok, false, "a 32-byte key ends with one =");
  assert.equal(hello({ keys: { sign: key(1).replace(/^./, "-"), box: key(2) } }).ok, false, "plain base64, not base64url");
  assert.equal(hello({ keys: { sign: key(1) } }).ok, false, "both keys");
  assert.equal(hello({ pc: { ...DESK.pc, kind: "server" } }).ok, false);
  assert.equal(hello({ pc: { ...DESK.pc, name: "   " } }).ok, false, "a blank name");
  assert.equal(hello({ pc: { ...DESK.pc, name: "two\nlines" } }).ok, false);
  assert.equal(hello({ pc: { ...DESK.pc, name: "x".repeat(41) } }).ok, false);
  assert.equal(hello({ pc: { ...DESK.pc, id: "has space" } }).ok, false);
  assert.equal(hello({ lendTo: Array.from({ length: 8 }, (_, index) => `20000000000000010${index}`) }).ok, true, "eight lends");
  assert.equal(hello({ lendTo: Array.from({ length: 9 }, (_, index) => `20000000000000010${index}`) }).ok, false, "nine are too many");
  assert.equal(hello({ lendTo: ["bob"] }).ok, false);

  const send = (env) => parseClientFrame(JSON.stringify({ type: "pcSend", to: DESK.pc.id, env }));
  assert.equal(send({ blob: "x".repeat(LIMITS.pcEnvBytes - 20) }).ok, true);
  assert.equal(send({ blob: "x".repeat(LIMITS.pcEnvBytes) }).ok, false, "an envelope over 12 KB");
  assert.equal(send("sealed").ok, false, "an envelope is an object");
  assert.equal(parseClientFrame(JSON.stringify({ type: "pcState", state: { blob: "x".repeat(LIMITS.pcStateBytes) } })).ok, false, "a status line over 3 KB");
  assert.equal(parseClientFrame(JSON.stringify({ type: "pcState", state: [] })).ok, false);

  const view = { ...DESK.pc, owner: { id: ALICE.id, name: "Alice" }, mine: true, lends: false, keys: DESK.keys, since: 1 };
  assert.deepEqual(hubFrame("pcs", { pcs: [view] }).pcs, [view]);
  assert.throws(() => hubFrame("pcs", { pcs: Array.from({ length: 17 }, () => view) }), /at most 16/);
  assert.throws(() => hubFrame("pcMsg", { from: DESK.pc.id, fromUser: ALICE.id, fromName: "Alice", env: ENV }), /keys/);

  const relay = makeRelay();
  const raw = await pcSocket(relay, "tok-alice");
  assert.ok(raw.of("ready")[0].features.includes("pcs"));
  raw.send({ type: "pcHello", ...DESK, lendTo: Array.from({ length: 9 }, (_, index) => `20000000000000010${index}`) });
  await until(() => raw.of("error").length, "a refusal");
  assert.equal(raw.of("error")[0].code, "badFrame");
  assert.equal(raw.of("pcs").length, 0, "a refused hello names no PC");
  raw.socket.close();
});

test("a member's own PCs see each other; a stranger and a socket that never said pcHello see nothing", async () => {
  const relay = makeRelay();
  const desk = await pcSocket(relay, "tok-alice", DESK);
  assert.deepEqual(desk.roster(), [], "the first PC sees nobody, and never itself");
  const plain = await pcSocket(relay, "tok-alice");
  const bob = await pcSocket(relay, "tok-bob", BOBS);
  const laptop = await pcSocket(relay, "tok-alice", LAPTOP);

  const { since } = await until(() => desk.roster()?.find((item) => item.id === LAPTOP.pc.id), "the desk sees the laptop");
  assert.deepEqual(desk.roster(),[{ ...LAPTOP.pc, owner: { id: ALICE.id, name: "Alice" }, mine: true, lends: false, keys: LAPTOP.keys, since }]);
  assert.deepEqual(laptop.ids(), [DESK.pc.id]);
  assert.ok(Number.isSafeInteger(since));
  await wait(20);
  assert.deepEqual(bob.ids(), [], "Bob's PC sees none of Alice's");
  assert.equal(plain.of("pcs").length, 0, "a socket that is not a PC is never sent a roster");

  // Status lines go only where the roster says.
  laptop.send({ type: "pcState", state: { v: 1, name: "Alice's laptop", projects: [{ key: "p-0123456789abcdef", name: "Game" }] } });
  const got = await until(() => desk.of("pcState")[0], "the desk's copy");
  assert.deepEqual(got, { type: "pcState", from: LAPTOP.pc.id, state: { v: 1, name: "Alice's laptop", projects: [{ key: "p-0123456789abcdef", name: "Game" }] } }, "the member's own PC gets the projects");
  await wait(20);
  assert.equal(bob.of("pcState").length + plain.of("pcState").length + laptop.of("pcState").length, 0);

  // A PC that never said pcHello sends no status line.
  plain.send({ type: "pcState", state: { v: 1 } });
  await wait(20);
  assert.equal(desk.of("pcState").length, 1);
  for (const one of [desk, plain, bob, laptop]) one.socket.close();
});

test("a lend shows the PC to that member, without its projects, and only to someone the member shares a room with", async () => {
  const relay = makeRelay();
  await shareRoom(relay, "tok-bob");
  const bob = await pcSocket(relay, "tok-bob", BOBS);
  const cara = await pcSocket(relay, "tok-cara", CARAS);
  const laptop = await pcSocket(relay, "tok-alice", LAPTOP);
  const desk = await pcSocket(relay, "tok-alice", DESK, [BOB.id, CARA.id, BOB.id]);

  const lent = await until(() => bob.roster()?.find((item) => item.id === DESK.pc.id), "Bob sees the lent desk");
  assert.deepEqual({ owner: lent.owner, mine: lent.mine, lends: lent.lends, keys: lent.keys }, { owner: { id: ALICE.id, name: "Alice" }, mine: false, lends: true, keys: DESK.keys });
  assert.deepEqual(bob.ids(), [DESK.pc.id], "the laptop does not lend itself");
  await wait(20);
  assert.deepEqual(cara.ids(), [], "Cara shares no room with Alice: the lend does not count");
  assert.deepEqual(desk.ids(), [LAPTOP.pc.id], "a lend shows nothing of Bob's to Alice");

  desk.send({ type: "pcState", state: { v: 1, cpu: 12, projects: [{ key: "p-0123456789abcdef", name: "Secret game" }] } });
  const own = await until(() => laptop.of("pcState")[0], "the laptop's copy");
  const friend = await until(() => bob.of("pcState")[0], "Bob's copy");
  assert.deepEqual(own.state, { v: 1, cpu: 12, projects: [{ key: "p-0123456789abcdef", name: "Secret game" }] });
  assert.deepEqual(friend.state, { v: 1, cpu: 12 }, "a friend never sees the projects");
  await wait(20);
  assert.equal(cara.of("pcState").length, 0);

  // Stopping the lend takes the desk off Bob's list at once.
  await desk.hello(DESK, []);
  await until(() => bob.roster() && !bob.ids().includes(DESK.pc.id), "Bob's fresh roster");
  assert.equal((await pcSend(bob, DESK.pc.id)).reason, "not-allowed");
  for (const one of [bob, cara, laptop, desk]) one.socket.close();
});

test("pcSend: delivered with the sender's keys and acked; not-online and not-allowed; the lent PC answers the borrower", async () => {
  const relay = makeRelay();
  await shareRoom(relay, "tok-bob");
  const desk = await pcSocket(relay, "tok-alice", DESK, [BOB.id]);
  const laptop = await pcSocket(relay, "tok-alice", LAPTOP);
  const bob = await pcSocket(relay, "tok-bob", BOBS);
  const cara = await pcSocket(relay, "tok-cara", CARAS);
  const quiet = await pcSocket(relay, "tok-alice");

  assert.deepEqual(await pcSend(laptop, DESK.pc.id), { type: "ack", nonce: `n${nonces}` });
  const msg = await until(() => desk.of("pcMsg")[0], "the desk's envelope");
  assert.deepEqual(msg, { type: "pcMsg", from: LAPTOP.pc.id, fromUser: ALICE.id, fromName: "Alice", keys: LAPTOP.keys, env: ENV });

  // Bob borrows the desk: his PC reaches it, and the desk answers his PC (it does not see it, the keys come along).
  assert.equal((await pcSend(bob, DESK.pc.id, { v: 1, k: "pair", step: "ask" })).type, "ack");
  const ask = await until(() => desk.of("pcMsg").find((item) => item.from === BOBS.pc.id), "Bob's ask");
  assert.deepEqual({ fromUser: ask.fromUser, fromName: ask.fromName, keys: ask.keys }, { fromUser: BOB.id, fromName: "Bob", keys: BOBS.keys });
  assert.equal(desk.ids().includes(BOBS.pc.id), false, "the lent PC does not list the borrower's");
  assert.equal((await pcSend(desk, BOBS.pc.id, { v: 1, k: "pair", step: "ok" })).type, "ack");
  await until(() => bob.of("pcMsg").find((item) => item.from === DESK.pc.id && item.env.step === "ok"), "the answer reaches Bob");

  const nack = async (raw, to) => (await pcSend(raw, to)).reason;
  assert.equal(await nack(laptop, BOBS.pc.id), "not-allowed", "the laptop lends itself to nobody");
  assert.equal(await nack(bob, LAPTOP.pc.id), "not-allowed");
  assert.equal(await nack(cara, DESK.pc.id), "not-allowed", "a stranger reaches nothing");
  assert.equal(await nack(laptop, "pc-nowhere"), "not-online");
  assert.equal(await nack(desk, DESK.pc.id), "not-online", "not to itself");
  assert.equal(await nack(quiet, DESK.pc.id), "not-allowed", "a socket that never said pcHello sends nothing");
  await wait(20);
  assert.equal(laptop.of("pcMsg").length + cara.of("pcMsg").length + quiet.of("pcMsg").length, 0);

  // Without a nonce it still goes, unanswered.
  laptop.send({ type: "pcSend", to: DESK.pc.id, env: { v: 1, k: "sealed", n: "quiet" } });
  await until(() => desk.of("pcMsg").some((item) => item.env.n === "quiet"), "the unanswered envelope");
  for (const one of [desk, laptop, bob, cara, quiet]) one.socket.close();
});

test("rosters refresh when a PC closes, changes or says hello twice", async () => {
  let clock = Date.now();
  const relay = makeRelay({ now: () => clock });
  await shareRoom(relay, "tok-bob");
  const desk = await pcSocket(relay, "tok-alice", DESK, [BOB.id]);
  const bob = await pcSocket(relay, "tok-bob", BOBS);
  const laptop = await pcSocket(relay, "tok-alice", LAPTOP);
  await until(() => desk.ids().includes(LAPTOP.pc.id), "the desk sees the laptop");

  laptop.socket.close();
  await until(() => desk.roster() && !desk.ids().includes(LAPTOP.pc.id), "the desk's fresh roster");

  // A rename is a change every viewer hears about; the PC keeps its place in time.
  const first = (await until(() => bob.roster()?.find((item) => item.id === DESK.pc.id), "Bob sees the desk")).since;
  clock += 5_000;
  await desk.hello({ ...DESK, pc: { ...DESK.pc, name: "Study" } }, [BOB.id]);
  const renamed = await until(() => bob.roster()?.find((item) => item.name === "Study"), "Bob hears the new name");
  assert.equal(renamed.since, first);

  // The same PC on a second socket (a restart before the first closed): listed once, the newest hello.
  const again = await pcSocket(relay, "tok-alice");
  clock += 5_000;
  const viewer = await pcSocket(relay, "tok-alice", LAPTOP);
  await again.hello(DESK, [BOB.id]);
  assert.deepEqual(again.ids(), [LAPTOP.pc.id], "a socket never lists its own PC id");
  await until(() => viewer.roster()?.some((item) => item.id === DESK.pc.id && item.since === clock), "the newest hello wins");
  assert.deepEqual(viewer.ids(), [DESK.pc.id], "listed once");
  assert.equal(viewer.roster()[0].name, "DESKTOP-HOME");
  await until(() => bob.roster()?.some((item) => item.id === DESK.pc.id && item.since === clock), "Bob hears the newest hello");
  assert.deepEqual(bob.ids(), [DESK.pc.id], "Bob lists it once too");

  // The older desk goes; its newer self stays listed.
  const rosters = viewer.of("pcs").length;
  desk.socket.close();
  await until(() => viewer.of("pcs").length > rosters, "the laptop's roster after the close");
  assert.deepEqual(viewer.ids(), [DESK.pc.id]);
  again.socket.close();
  await until(() => viewer.roster().length === 0, "the laptop sees nobody");
  await until(() => bob.roster().length === 0, "Bob sees nobody");
  for (const one of [bob, viewer]) one.socket.close();
});

test("the relay keeps nothing for My PCs but a small attachment on each socket", async () => {
  const relay = makeRelay();
  const roomId = await shareRoom(relay, "tok-bob");
  // The largest attachment: eight lends (seven more room-mates seated straight in the store), the longest id and name.
  const lend = [BOB.id, ...Array.from({ length: 7 }, (_, index) => `20000000000000099${index}`)];
  for (const uid of lend.slice(1)) relay.sql("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", roomId, uid, Date.now());
  const desk = await pcSocket(relay, "tok-alice", { ...DESK, pc: { ...DESK.pc, id: `pc-${"f".repeat(61)}`, name: "N".repeat(40) } }, lend);
  assert.equal(relay.sockets().find((ws) => ws.attachment?.pc)?.attachment.pl.length, 8);
  const bob = await pcSocket(relay, "tok-bob", BOBS);
  desk.send({ type: "pcState", state: { v: 1, note: "status-line-text" } });
  await until(() => bob.of("pcState").length, "Bob's copy");
  assert.equal((await pcSend(bob, `pc-${"f".repeat(61)}`, { v: 1, k: "sealed", ct: "envelope-text" })).type, "ack");
  for (const { name } of relay.sql("SELECT name FROM sqlite_master WHERE type = 'table'")) {
    const dump = JSON.stringify(relay.sql(`SELECT * FROM "${name}"`));
    for (const needle of [DESK.keys.sign, BOBS.keys.sign, BOBS.pc.id, "status-line-text", "envelope-text", "N".repeat(40)]) assert.ok(!dump.includes(needle), `${name} holds ${needle.slice(0, 12)}`);
  }
  for (const ws of relay.sockets()) {
    const text = JSON.stringify(ws.attachment);
    assert.ok(new TextEncoder().encode(text).length < 1024, `an attachment of ${text.length} bytes`);
    assert.ok(!text.includes("status-line-text") && !text.includes("envelope-text"));
  }
  for (const one of [desk, bob]) one.socket.close();
});

// The rate limits, on the module itself with a clock in hand (through a socket the relay's frame limit
// would close it first).
function fakeRelay() {
  const clock = { at: 1_800_000_000_000 };
  const list = [];
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const pcs = createPcs({
    readySockets: () => list.filter((entry) => entry.a.s === "ready").map((entry) => ({ ws: entry.ws, a: copy(entry.a) })),
    sendFrame: (ws, type, fields) => ws.frames.push(hubFrame(type, fields)),
    sockets: { write: (ws, a) => { list.find((entry) => entry.ws === ws).a = copy(a); } },
    now: () => clock.at,
    friendsOf: () => new Set([BOB.id]),
  });
  const socket = (uid, name) => {
    const ws = { frames: [] };
    list.push({ ws, a: { s: "ready", cid: `c_${list.length}`, uid, name } });
    const read = () => copy(list.find((entry) => entry.ws === ws).a);
    // As the relay does: the attachment says closed first, then gone().
    const close = () => {
      list.find((entry) => entry.ws === ws).a.s = "closed";
      pcs.gone(read());
    };
    return { ws, read, close, of: (type) => ws.frames.filter((frame) => frame.type === type) };
  };
  return { pcs, clock, socket };
}

test("rate limits: 20 hellos, 6 status lines and 60 envelopes a minute per socket", () => {
  const { pcs, clock, socket } = fakeRelay();
  const desk = socket(ALICE.id, "Alice");
  const laptop = socket(ALICE.id, "Alice");
  pcs.hello(laptop.ws, laptop.read(), { ...LAPTOP, lendTo: [] });
  for (let index = 0; index < PCS_LIMITS.hellosPerMinute; index += 1) pcs.hello(desk.ws, desk.read(), { ...DESK, lendTo: [] });
  assert.equal(desk.of("error").length, 0);
  pcs.hello(desk.ws, desk.read(), { ...DESK, lendTo: [BOB.id] });
  assert.deepEqual(desk.of("error"), [{ type: "error", code: "rateLimited", message: "pcHello" }]);
  assert.deepEqual(desk.read().pl, [], "a refused hello changes nothing");

  for (let index = 0; index < 7; index += 1) pcs.state(desk.ws, desk.read(), { state: { v: 1, seq: index } });
  assert.equal(laptop.of("pcState").length, PCS_LIMITS.statesPerMinute, "the seventh line in a minute is dropped");
  clock.at += 10_000;
  pcs.state(desk.ws, desk.read(), { state: { v: 1, seq: 7 } });
  assert.equal(laptop.of("pcState").at(-1).state.seq, 7, "one more after ten seconds");

  const answers = Array.from({ length: PCS_LIMITS.sendsPerMinute + 1 }, () => pcs.send(desk.ws, desk.read(), { to: LAPTOP.pc.id, env: ENV }));
  assert.equal(answers.filter((answer) => answer.ok).length, PCS_LIMITS.sendsPerMinute);
  assert.equal(answers.at(-1).reason, "rate-limited");
  assert.ok(answers.at(-1).retryAfter > 0 && answers.at(-1).retryAfter <= 1000);
  assert.equal(laptop.of("pcMsg").length, PCS_LIMITS.sendsPerMinute);
  clock.at += 1000;
  assert.equal(pcs.send(desk.ws, desk.read(), { to: LAPTOP.pc.id, env: ENV }).ok, true);
  pcs.sweep();
});

test("the module on its own: a lend to oneself or a non-friend is dropped, and a closed PC leaves every list", () => {
  const { pcs, socket } = fakeRelay();
  const desk = socket(ALICE.id, "Alice");
  const laptop = socket(ALICE.id, "Alice");
  const bob = socket(BOB.id, "Bob");
  const cara = socket(CARA.id, "Cara");
  pcs.hello(bob.ws, bob.read(), { ...BOBS, lendTo: [] });
  pcs.hello(cara.ws, cara.read(), { ...CARAS, lendTo: [] });
  pcs.hello(laptop.ws, laptop.read(), { ...LAPTOP, lendTo: [] });
  pcs.hello(desk.ws, desk.read(), { ...DESK, lendTo: [ALICE.id, CARA.id, BOB.id, BOB.id] });
  assert.deepEqual(desk.read().pl, [BOB.id], "only Bob shares a room with Alice here, and nobody lends to themselves");
  assert.deepEqual(bob.of("pcs").at(-1).pcs.map((item) => [item.id, item.lends]), [[DESK.pc.id, true]]);
  assert.equal(cara.of("pcs").length, 1, "Cara's only roster is her own hello's");
  assert.deepEqual(pcs.roster(laptop.read()).map((item) => item.id), [DESK.pc.id]);

  desk.close();
  assert.deepEqual(bob.of("pcs").at(-1).pcs, [], "the borrower's list drops the closed PC");
  assert.deepEqual(laptop.of("pcs").at(-1).pcs, [], "and so does the member's own");
  assert.equal(cara.of("pcs").length, 1, "nobody else hears of it");
  const rosters = laptop.of("pcs").length;
  pcs.gone({ s: "closed", cid: "c_x", uid: ALICE.id });
  pcs.gone(null);
  assert.equal(laptop.of("pcs").length, rosters, "a socket that was never a PC changes nothing");
});

test("Studio's hub client end to end: setPc, rosters, status lines and envelopes", async () => {
  const relay = makeRelay();
  const desk = member(relay, "tok-alice");
  const laptop = member(relay, "tok-alice");
  assert.equal(desk.client.setPc({ ...DESK, lendTo: [] }), true);
  assert.equal(laptop.client.setPc({ ...LAPTOP, lendTo: [] }), true);
  await connectAll(desk, laptop);
  assert.equal(desk.client.status().pcs, true);
  assert.equal(desk.client.status().pcOn, true);
  const seen = await until(() => desk.of("pcs").at(-1)?.pcs.find((item) => item.id === LAPTOP.pc.id), "the desk sees the laptop");
  assert.deepEqual({ ...seen, since: 0 }, { ...LAPTOP.pc, owner: { id: ALICE.id, name: "Alice" }, mine: true, lends: false, keys: LAPTOP.keys, since: 0 });

  assert.equal(laptop.client.pcState({ v: 1, stage: "ok", projects: [] }), true);
  const line = await until(() => desk.of("pcState")[0], "the desk's status line");
  assert.deepEqual({ from: line.from, state: line.state }, { from: LAPTOP.pc.id, state: { v: 1, stage: "ok", projects: [] } });

  assert.deepEqual(await desk.client.pcSend(LAPTOP.pc.id, ENV), { ok: true });
  const msg = await until(() => laptop.of("pcMsg")[0], "the laptop's envelope");
  assert.deepEqual({ from: msg.from, fromUser: msg.fromUser, fromName: msg.fromName, keys: msg.keys, env: msg.env }, { from: DESK.pc.id, fromUser: ALICE.id, fromName: "Alice", keys: DESK.keys, env: ENV });
  assert.equal((await desk.client.pcSend("pc-nowhere", ENV)).reason, "not-online");

  await laptop.client.disconnect();
  await until(() => desk.of("pcs").at(-1).pcs.length === 0, "the laptop left the desk's list");
  await desk.client.disconnect();
});
