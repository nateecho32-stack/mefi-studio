import assert from "node:assert/strict";
import test from "node:test";
import hub from "../scripts/hub-client.cjs";

// scripts/hub-client.cjs against a fake hub: a scripted fetch for the HTTP
// half, a fake WebSocket class for the socket, and hand-turned timers and
// clock. Nothing here opens a socket. The frames are the Void Engine hub's
// (docs/protocol.md in the Void Engine Bot repository).

const T0 = 1_800_000_000_000;
const USER = { id: "123456789012345678", name: "Mefi" };
const ROOM = "room_abc";
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((done) => setImmediate(done)); };

function session(overrides = {}) {
  return { id: "lis_1", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", label: "YouTube video", provider: "youtube", host: USER,
    playing: true, positionMs: 1000, startedAt: T0, updatedAt: T0, ...overrides };
}

function harness({ url = "https://hub.example.test", token = { ok: true, token: "discord-access" }, answer } = {}) {
  let now = T0;
  let seq = 0;
  const timers = new Map();
  const events = [];
  const calls = [];
  const sockets = [];
  class FakeSocket {
    constructor(address) { this.url = address; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close(code = 1000) { this.readyState = 3; this.closedWith = code; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
    drop(code) { this.readyState = 3; this.onclose?.({ code }); }
  }
  let sessions = 0;
  const respond = answer ?? ((method, path) => {
    if (method === "POST" && path === "/v1/session") { sessions += 1; return { status: 200, body: { ok: true, session: `hub-session-${sessions}`, expiresAt: now + 15 * 60_000, user: USER } }; }
    if (method === "GET" && path === "/v1/rooms") return { status: 200, body: { ok: true, rooms: [{ id: ROOM, name: "Lo-fi corner", kind: "hangout", status: "active", you: "member", ownerId: USER.id, memberCount: 3 }, { id: "bad id!", name: "x" }] } };
    if (method === "DELETE" && path === "/v1/session") return { status: 200, body: { ok: true } };
    return { status: 404, body: { ok: false, error: "not-found" } };
  });
  const fetch = async (href, init) => {
    const parsed = new URL(href);
    const call = { method: init.method, path: parsed.pathname, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined, origin: parsed.origin };
    calls.push(call);
    const reply = await respond(call.method, call.path, call);
    if (reply instanceof Error) throw reply;
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  };
  const client = hub.createHubClient({
    url, fetch, WebSocket: FakeSocket, now: () => now,
    getAccessToken: async () => (typeof token === "function" ? token() : token),
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    onEvent: (event) => events.push(event),
  });
  const advance = async (ms) => {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const entry of timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      const [id, timer] = next;
      now = timer.at;
      if (timer.every) timer.at += timer.every; else timers.delete(id);
      timer.fn();
      await settle();
    }
    now = end;
    await settle();
  };
  const socket = () => sockets.at(-1);
  async function readyUp() {
    await client.connect();
    socket().open();
    socket().receive({ type: "ready", user: USER, protocol: 1 });
    await settle();
  }
  return { client, events, calls, sockets, socket, advance, readyUp, timers, get now() { return now; } };
}

test("the hub address takes https anywhere and http only on loopback", () => {
  assert.deepEqual({ ...hub.hubAddress("https://hub.example.test") }, { http: "https://hub.example.test", ws: "wss://hub.example.test/v1/ws" });
  assert.deepEqual({ ...hub.hubAddress("http://127.0.0.1:8787") }, { http: "http://127.0.0.1:8787", ws: "ws://127.0.0.1:8787/v1/ws" });
  for (const bad of ["http://hub.example.test", "https://user:pw@hub.example.test", "https://hub.example.test/v1", "https://hub.example.test?x=1", "ftp://hub", "", null]) {
    assert.equal(hub.hubAddress(bad), null, String(bad));
  }
  assert.equal(hub.configuredUrl({ MEFI_STUDIO_HUB_URL: " https://hub.example.test " }), "https://hub.example.test");
  assert.equal(hub.configuredUrl({}), hub.HUB_URL, "without the variable the built-in address");
  assert.deepEqual({ ...hub.hubAddress(hub.HUB_URL) }, { http: "https://mefi-relay.mefi-studio.workers.dev", ws: "wss://mefi-relay.mefi-studio.workers.dev/v1/ws" }, "the Mefi Studio relay, at the root of its host");
});

test("without an address nothing connects and the status says so", async () => {
  const h = harness({ url: "" });
  assert.equal(h.client.status().configured, false);
  const status = await h.client.connect();
  assert.equal(status.state, "error"); assert.equal(status.error, "not-configured");
  assert.equal(h.calls.length, 0); assert.equal(h.sockets.length, 0);
});

test("connecting trades the Discord token for a hub session once, says hello and re-subscribes after ready", async () => {
  const h = harness();
  assert.equal(h.client.subscribe(ROOM), true, "a room chosen before the socket is up is remembered");
  assert.equal(h.client.subscribe("not a room!"), false);
  await h.client.connect();
  assert.deepEqual(h.calls.map((call) => `${call.method} ${call.path}`), ["POST /v1/session"]);
  assert.deepEqual(h.calls[0].body, { accessToken: "discord-access" });
  assert.equal(h.calls[0].headers.Authorization, undefined, "the session request carries the Discord token in its body only");
  assert.equal(h.socket().url, "wss://hub.example.test/v1/ws");
  assert.equal(h.client.status().state, "connecting");
  h.socket().open();
  assert.deepEqual(h.socket().sent, [{ type: "hello", session: "hub-session-1", protocol: 1, features: ["history.peer", "keepalive", "friend.online"] }], "hello names what this Studio can do; an older hub drops the field");
  h.socket().receive({ type: "ready", user: USER, protocol: 1 });
  await settle();
  const status = h.client.status();
  assert.equal(status.state, "ready"); assert.deepEqual({ ...status.user }, USER); assert.deepEqual([...status.rooms], [ROOM]);
  assert.deepEqual(h.socket().sent.slice(1), [{ type: "subscribe", roomId: ROOM }, { type: "presence", roomId: ROOM }]);
  await h.advance(hub.PRESENCE_EVERY_MS);
  assert.deepEqual(h.socket().sent.at(-1), { type: "presence", roomId: ROOM }, "presence repeats every 30 s");
  const leak = JSON.stringify(h.events);
  assert.ok(!leak.includes("discord-access") && !leak.includes("hub-session"), "no token or hub session reaches an event");
});

test("each part of Studio holds a room on its own; the hub hears unsubscribe only when the last lets go", async () => {
  const h = harness();
  await h.readyUp();
  const frames = () => h.socket().sent.filter((frame) => ["subscribe", "unsubscribe"].includes(frame.type) && frame.roomId === ROOM).map((frame) => frame.type);
  assert.equal(h.client.subscribe(ROOM, "rooms"), true);
  assert.equal(h.client.subscribe(ROOM, "together"), true);
  assert.equal(h.client.subscribe(ROOM, "rooms"), true, "holding twice is one hold");
  assert.deepEqual(frames(), ["subscribe"], "one subscribe for the first holder only");
  assert.equal(h.client.unsubscribe(ROOM, "rooms"), true);
  assert.deepEqual(frames(), ["subscribe"], "Rooms closing the chat leaves Listen together subscribed");
  assert.deepEqual([...h.client.status().rooms], [ROOM]);
  assert.equal(h.client.unsubscribe(ROOM, "rooms"), false, "a holder lets go once");
  assert.equal(h.client.unsubscribe(ROOM, "made-up"), false, "an unknown holder is the default one, which holds nothing here");
  assert.equal(h.client.unsubscribe(ROOM, "together"), true);
  assert.deepEqual(frames(), ["subscribe", "unsubscribe"]);
  assert.deepEqual([...h.client.status().rooms], []);
  assert.equal(h.client.subscribe(ROOM), true, "a caller naming no holder is the default one");
  assert.equal(h.client.unsubscribe(ROOM, "cowork"), false);
  assert.equal(h.client.unsubscribe(ROOM), true);
  assert.deepEqual(hub.HOLDERS, ["default", "rooms", "together", "cowork"]);
});

test("listen frames are validated before they reach Studio, and acks settle each request by nonce", async () => {
  const h = harness();
  await h.readyUp();
  h.socket().receive({ type: "listen", roomId: ROOM, session: session({ title: "Me at the zoo" }), sentAt: T0 + 500 });
  h.socket().receive({ type: "listen", roomId: ROOM, session: session({ url: "javascript:alert(1)" }), sentAt: T0 });
  h.socket().receive({ type: "listen", roomId: ROOM, session: session({ provider: "napster" }), sentAt: T0 });
  h.socket().receive({ type: "listen", roomId: ROOM, session: null, sentAt: T0 + 900 });
  const listens = h.events.filter((event) => event.type === "listen");
  assert.equal(listens.length, 2, "the two malformed sessions are dropped");
  assert.equal(listens[0].session.title, "Me at the zoo");
  assert.equal(listens[0].sentAt, T0 + 500); assert.equal(listens[0].receivedAt, h.now);
  assert.equal(listens[1].session, null);

  const started = h.client.listen(ROOM, { action: "start", url: "https://youtu.be/jNQXAC9IVRw", label: "YouTube video", provider: "youtube", positionMs: 1234.4 });
  const frame = h.socket().sent.at(-1);
  assert.deepEqual({ ...frame, nonce: "n" }, { type: "listen", roomId: ROOM, action: "start", url: "https://youtu.be/jNQXAC9IVRw", label: "YouTube video", provider: "youtube", positionMs: 1234, nonce: "n" });
  assert.match(frame.nonce, /^[A-Za-z0-9_-]{1,64}$/);
  h.socket().receive({ type: "ack", nonce: frame.nonce });
  assert.deepEqual({ ...(await started) }, { ok: true });
  const paused = h.client.listen(ROOM, { action: "pause" });
  h.socket().receive({ type: "nack", nonce: h.socket().sent.at(-1).nonce, reason: "not-yours" });
  assert.deepEqual({ ...(await paused) }, { ok: false, reason: "not-yours", retryAfter: undefined });
  const silent = h.client.listen(ROOM, { action: "play" });
  await h.advance(10_000);
  assert.deepEqual({ ...(await silent) }, { ok: false, reason: "timeout" }, "nothing is queued silently: a missing ack is a timeout");
  assert.deepEqual({ ...(await h.client.listen(ROOM, { action: "start", url: "http://x.test/a.mp3", label: "x", provider: "file" })) }, { ok: false, reason: "bad-link" });
  assert.deepEqual({ ...(await h.client.listen(ROOM, { action: "seek" })) }, { ok: false, reason: "bad-request" }, "a seek needs a position");
  assert.deepEqual({ ...(await h.client.listen(ROOM, { action: "dance" })) }, { ok: false, reason: "bad-request" });
});

test("the now-playing share goes out on change only, survives a reconnect, and clears with null", async () => {
  const h = harness();
  const track = { label: "Me at the zoo", provider: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" };
  assert.equal(h.client.setNowPlaying(track), true, "kept before the socket is up");
  await h.readyUp();
  assert.deepEqual(h.socket().sent.filter((frame) => frame.type === "nowPlaying"), [{ type: "nowPlaying", track }]);
  h.client.setNowPlaying({ ...track });
  assert.equal(h.socket().sent.filter((frame) => frame.type === "nowPlaying").length, 1, "the same track is not sent twice");
  assert.equal(h.client.setNowPlaying({ label: "Local music", provider: "local", url: "file:///C:/x.mp3" }), false, "a non-https url is refused");
  assert.equal(h.client.setNowPlaying({ label: "", provider: "radio" }), false);
  h.socket().drop(1006);
  await h.advance(1_000);
  h.socket().open(); h.socket().receive({ type: "ready", user: USER, protocol: 1 }); await settle();
  assert.deepEqual(h.socket().sent.filter((frame) => frame.type === "nowPlaying"), [{ type: "nowPlaying", track }], "re-sent on the new socket");
  h.client.setNowPlaying(null);
  assert.deepEqual(h.socket().sent.at(-1), { type: "nowPlaying", track: null });
});

test("a lost socket retries with backoff, an expired session gets a new one, and a version mismatch stops", async () => {
  const h = harness();
  await h.readyUp();
  h.socket().drop(1006);
  assert.equal(h.client.status().state, "offline");
  assert.equal(h.sockets.length, 1);
  await h.advance(999); assert.equal(h.sockets.length, 1);
  await h.advance(1); assert.equal(h.sockets.length, 2, "the first retry comes after a second");
  assert.equal(h.calls.filter((call) => call.path === "/v1/session").length, 1, "a live session is reused");
  h.socket().open(); h.socket().receive({ type: "ready", user: USER, protocol: 1 }); await settle();
  h.socket().drop(4005);
  await h.advance(0);
  assert.equal(h.calls.filter((call) => call.path === "/v1/session").length, 2, "an expired session is replaced before reconnecting");
  h.socket().drop(4002);
  assert.equal(h.client.status().state, "error"); assert.equal(h.client.status().error, "version");
  await h.advance(120_000);
  assert.equal(h.sockets.length, 3, "a version mismatch never retries");
});

test("the session is renewed before it expires, over HTTP and then on the socket", async () => {
  const h = harness();
  await h.readyUp();
  await h.advance(15 * 60_000 - hub.SESSION_MARGIN_MS);
  assert.equal(h.calls.filter((call) => call.path === "/v1/session").length, 2);
  assert.deepEqual(h.socket().sent.at(-1), { type: "renew", session: "hub-session-2" });
});

test("refusals: a Discord link that is gone, a non-member, and a hub that is down", async () => {
  const unlinked = harness({ token: { ok: false, error: "not-linked" } });
  assert.equal((await unlinked.client.connect()).error, "not-linked");
  assert.equal(unlinked.sockets.length, 0);
  const outsider = harness({ answer: () => ({ status: 403, body: { ok: false, error: "not-member" } }) });
  assert.equal((await outsider.client.connect()).error, "not-member");
  await outsider.advance(120_000);
  assert.equal(outsider.calls.length, 1, "a refusal is not retried on a timer");
  const down = harness({ answer: () => new Error("ECONNREFUSED") });
  const status = await down.client.connect();
  assert.equal(status.state, "offline"); assert.equal(status.error, "network");
  await down.advance(1_000);
  assert.equal(down.calls.length, 2, "an unreachable hub is retried");
});

test("rooms come back cleaned, a stale session is replaced once, and disconnect signs out", async () => {
  const h = harness();
  await h.readyUp();
  const answer = await h.client.rooms();
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.rooms.map((item) => item.id), [ROOM], "a malformed room is dropped");
  const get = h.calls.find((call) => call.path === "/v1/rooms");
  assert.equal(get.headers.Authorization, "Bearer hub-session-1");
  await h.client.disconnect();
  const out = h.calls.at(-1);
  assert.equal(`${out.method} ${out.path}`, "DELETE /v1/session"); assert.equal(out.headers.Authorization, "Bearer hub-session-1");
  assert.equal(h.client.status().state, "off"); assert.deepEqual([...h.client.status().rooms], []);
  assert.equal(h.sockets[0].closedWith, 1000);
});

test("listenSession and nowPlayingTrack accept only what Studio can use", () => {
  assert.equal(hub.listenSession(session()).title, null);
  assert.equal(hub.listenSession(session({ positionMs: -1 })), null);
  assert.equal(hub.listenSession(session({ host: { id: "12", name: "x" } })), null);
  assert.equal(hub.listenSession(session({ label: "two\nlines" })), null);
  assert.deepEqual({ ...hub.nowPlayingTrack({ label: "Groove Salad", provider: "radio" }) }, { label: "Groove Salad", provider: "radio" });
  assert.equal(hub.nowPlayingTrack({ label: "x", provider: "napster" }), null);
  assert.equal(hub.nowPlayingTrack(null), null);
});

test("companion cards go only to a hub that carries them, and to one member only when it delivers to one", async () => {
  const h = harness();
  await h.readyUp();
  h.client.subscribe(ROOM);
  const card = { v: 1, level: "play", look: "wisp", mood: "idle" };
  assert.equal(h.client.status().companions, false);
  assert.equal(h.client.sendCompanion(ROOM, card), false, "a hub that never said it carries companions is never sent one");
  h.socket().receive({ type: "ready", user: USER, protocol: 1, features: ["companion", 7, "x".repeat(80)] });
  await h.advance(0);
  assert.equal(h.client.status().companions, true);
  assert.equal(h.client.status().companionDirect, false);
  assert.equal(h.client.sendCompanion(ROOM, card), true);
  assert.equal(h.client.sendCompanion(ROOM, card, "987654321098765432"), false, "no one-member delivery, so no card meant for one friend");
  assert.equal(h.client.sendCompanion("room_other", card), false, "only subscribed rooms");
  assert.equal(h.client.sendCompanion(ROOM, "text"), false);
  assert.deepEqual(h.socket().sent.filter((frame) => frame.type === "companion"), [{ type: "companion", roomId: ROOM, card }]);
  h.socket().receive({ type: "ready", user: USER, protocol: 1, features: ["companion", "companion.direct"] });
  await h.advance(0);
  assert.equal(h.client.sendCompanion(ROOM, card, "987654321098765432"), true);
  assert.equal(h.client.sendCompanion(ROOM, null), true, "null says it went home");
  assert.deepEqual(h.socket().sent.filter((frame) => frame.type === "companion").slice(1), [{ type: "companion", roomId: ROOM, card, to: "987654321098765432" }, { type: "companion", roomId: ROOM, card: null }]);
  await h.client.disconnect();
  assert.equal(h.client.status().companions, false, "a later connect learns the features again");
});

test("a friend's companion frame is passed on with its room and sender, and a malformed one is dropped", async () => {
  const h = harness();
  await h.readyUp();
  h.socket().receive({ type: "companion", roomId: ROOM, from: "987654321098765432", card: { v: 1, level: "hello", name: "Nova" } });
  h.socket().receive({ type: "companion", roomId: ROOM, from: "987654321098765432", card: null, to: USER.id });
  h.socket().receive({ type: "companion", roomId: "bad room!", from: "987654321098765432", card: {} });
  h.socket().receive({ type: "companion", roomId: ROOM, from: "nobody", card: {} });
  h.socket().receive({ type: "companion", roomId: ROOM, from: "987654321098765432", card: ["not", "a", "card"] });
  const seen = h.events.filter((event) => event.type === "companion");
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0], { type: "companion", roomId: ROOM, from: "987654321098765432", card: { v: 1, level: "hello", name: "Nova" }, direct: false, receivedAt: T0 });
  assert.equal(seen[1].card, null); assert.equal(seen[1].direct, true, "a card addressed to this member alone");
  assert.equal(seen[2].card, null, "a card that is not an object reads as gone");
});

test("the relay's keepalive: an exact ping every 30 s, only when the relay lists it, stopped on close", async () => {
  const plain = harness();
  await plain.readyUp();
  await plain.advance(hub.KEEPALIVE_EVERY_MS * 2);
  assert.equal(plain.socket().sent.some((frame) => frame.type === "ping"), false, "an older hub never gets a ping");

  const h = harness();
  await h.client.connect();
  h.socket().open();
  h.socket().receive({ type: "ready", user: USER, protocol: 1, features: ["keepalive"] });
  await settle();
  await h.advance(hub.KEEPALIVE_EVERY_MS);
  assert.deepEqual(h.socket().sent.at(-1), { type: "ping" });
  assert.equal(JSON.stringify(hub.KEEPALIVE_FRAME), '{"type":"ping"}', "byte for byte the relay's auto-response request");
  const sent = h.socket().sent.length;
  h.socket().drop(1006);
  await h.advance(hub.KEEPALIVE_EVERY_MS * 2);
  assert.equal(h.sockets[0].sent.length, sent, "no ping on a closed socket");
});

test("signed messages keep their sig, and wireMessage gives the hub's shape back", () => {
  const message = { id: "1556701055531801106", author: { id: USER.id, name: "Mefi", viaStudio: true }, text: "hi", createdAt: T0, editedAt: null, mentions: { users: [], roles: [], everyone: false }, attachments: [], replyTo: null, sig: "abcdefghijklmnopqrstuv" };
  const kept = hub.roomMessage(message);
  assert.equal(kept.sig, "abcdefghijklmnopqrstuv");
  assert.equal(hub.roomMessage({ ...message, sig: "bad sig!" }).sig, undefined);
  assert.deepEqual(hub.wireMessage(kept), message);
});

test("peer history: ask the room, answer an ask from the kept copy within one frame, hear the checked history", async () => {
  const h = harness();
  await h.client.connect();
  h.socket().open();
  h.socket().receive({ type: "ready", user: USER, protocol: 1, features: ["history.peer"] });
  await settle();
  assert.equal(h.client.status().history, true);
  assert.deepEqual(await h.client.historyAsk(ROOM), { ok: false, reason: "bad-request" }, "only for a subscribed room");
  h.client.subscribe(ROOM);
  const asked = h.client.historyAsk(ROOM, "1556701055531801106");
  const frame = h.socket().sent.at(-1);
  assert.equal(frame.type, "historyRequest");
  assert.equal(frame.before, "1556701055531801106");
  h.socket().receive({ type: "ack", nonce: frame.nonce });
  assert.deepEqual(await asked, { ok: true });

  const events = [];
  h.events.length = 0;
  h.socket().receive({ type: "historyRequest", roomId: ROOM, requestId: "hist_1", before: "1556701055531801106" });
  events.push(...h.events.filter((event) => event.type === "historyRequest"));
  assert.deepEqual(events[0], { type: "historyRequest", roomId: ROOM, requestId: "hist_1", before: "1556701055531801106" });
  const long = (n) => ({ id: String(1556701055531801000n + BigInt(n)), author: { id: USER.id, name: "Mefi", viaStudio: true }, text: "x".repeat(1500), createdAt: T0 + n, editedAt: null, mentions: { users: [], roles: [], everyone: false }, attachments: [], replyTo: null, sig: "abcdefghijklmnopqrstuv" });
  assert.equal(h.client.historyReply("hist_1", Array.from({ length: 20 }, (_, n) => long(n)), false), true);
  const reply = h.socket().sent.at(-1);
  assert.equal(reply.type, "historyReply");
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 15 * 1024, "fits the relay's frame limit");
  assert.equal(reply.hasMore, true, "older ones left out are still there");
  assert.equal(reply.messages.at(-1).id, long(19).id, "the newest are kept");

  h.socket().receive({ type: "history", roomId: ROOM, messages: [long(1)], hasMore: false });
  const history = h.events.find((event) => event.type === "history");
  assert.equal(history.messages[0].sig, "abcdefghijklmnopqrstuv");

  const old = harness();
  await old.readyUp();
  assert.deepEqual(await old.client.historyAsk(ROOM), { ok: false, reason: "unsupported" }, "never asked of a hub without the feature");
});
