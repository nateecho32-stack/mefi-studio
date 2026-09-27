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
  assert.equal(hub.configuredUrl({}), hub.HUB_URL, "without the variable the built-in address (empty until the hub has one)");
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
  assert.deepEqual(h.socket().sent, [{ type: "hello", session: "hub-session-1", protocol: 1 }]);
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
