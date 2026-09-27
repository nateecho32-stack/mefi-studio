import assert from "node:assert/strict";
import test from "node:test";
import hub from "../scripts/hub-client.cjs";

// scripts/hub-client.cjs's rooms half (Friends › Rooms) against a fake hub:
// every call checks its arguments before anything leaves, sends the protocol's
// exact path and body with the hub session, renews a lapsed session once,
// passes the hub's refusals through, and shapes what comes back; room chat
// goes over the socket with ack/nack; and message, request and invite frames
// reach the host already checked. The contract is docs/protocol.md in the Void
// Engine Bot repository.

const T0 = 1_800_000_000_000;
const ME = { id: "123456789012345678", name: "Mefi" };
const FRIEND = { id: "223456789012345678", name: "Aksana" };
const ROOM = "room_abc";
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((done) => setImmediate(done)); };
const room = (overrides = {}) => ({ id: ROOM, name: "Lo-fi corner", kind: "hangout", policy: "request", listed: true, status: "active", ownerId: ME.id, memberCount: 3, maxMembers: 25, threadId: "323456789012345678", createdAt: T0, you: "owner", ...overrides });
const request = (overrides = {}) => ({ id: "req_1", roomId: ROOM, requester: FRIEND, note: "hi!", status: "pending", createdAt: T0, ...overrides });
const invite = (overrides = {}) => ({ id: "inv_1", roomId: ROOM, roomName: "Lo-fi corner", invitedBy: ME, status: "pending", expiresAt: T0 + 7 * 86_400_000, ...overrides });
const message = (overrides = {}) => ({ id: "423456789012345678", author: { id: FRIEND.id, name: "Aksana", viaStudio: true }, text: "hello <@123456789012345678>", createdAt: T0, editedAt: null, mentions: { users: [{ id: ME.id, name: "Mefi" }], roles: [], everyone: false }, attachments: [], ...overrides });

function harness(routes = {}) {
  const calls = [], events = [], sockets = [];
  let sessions = 0, expire = false;
  class FakeSocket {
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  }
  const fetch = async (href, init) => {
    const parsed = new URL(href);
    const call = { method: init.method, path: `${parsed.pathname}${parsed.search}`, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    let reply;
    if (call.method === "POST" && call.path === "/v1/session") { sessions += 1; reply = { status: 200, body: { ok: true, session: `hub-session-${sessions}`, expiresAt: T0 + 15 * 60_000, user: ME } }; }
    else if (expire) { expire = false; reply = { status: 401, body: { ok: false, error: "unauthorized" } }; }
    else reply = routes[`${call.method} ${call.path}`] ?? { status: 404, body: { ok: false, error: "not-found" } };
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  };
  const client = hub.createHubClient({
    url: "https://hub.example.test", fetch, WebSocket: FakeSocket, now: () => T0,
    getAccessToken: async () => ({ ok: true, token: "discord-access" }),
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    onEvent: (event) => events.push(event),
  });
  const readyUp = async () => {
    await client.connect();
    sockets.at(-1).open();
    sockets.at(-1).receive({ type: "ready", user: ME, protocol: 1 });
    await settle();
    calls.length = 0;
  };
  return { client, calls, events, socket: () => sockets.at(-1), readyUp, expireNext: () => { expire = true; } };
}

test("nothing leaves before a session, and bad arguments never leave at all", async () => {
  const h = harness();
  assert.deepEqual(await h.client.requests(), { ok: false, error: "offline" });
  await h.readyUp();
  const refusals = await Promise.all([
    h.client.createRoom({ name: "", kind: "hangout", policy: "request", listed: true }),
    h.client.createRoom({ name: "x", kind: "party", policy: "request", listed: true }),
    h.client.createRoom({ name: "line\nbreak", kind: "hangout", policy: "request", listed: true }),
    h.client.requestJoin("../etc", ""),
    h.client.requestJoin(ROOM, "x".repeat(301)),
    h.client.decide("req_1", "maybe"),
    h.client.invite(ROOM, "not-a-snowflake"),
    h.client.removeMember(ROOM, "12"),
    h.client.searchMembers(""),
    h.client.searchMembers("x".repeat(33)),
    h.client.messages(ROOM, "abc"),
    h.client.report(ROOM, "423456789012345678", "   "),
  ]);
  for (const answer of refusals) assert.deepEqual(answer, { ok: false, error: "bad-request" });
  assert.equal(h.calls.length, 0, "no request went out");
});

test("rooms, requests and invites use the protocol's paths and bodies with the hub session", async () => {
  const h = harness({
    "POST /v1/rooms": { status: 201, body: { ok: true, room: room() } },
    [`POST /v1/rooms/${ROOM}/requests`]: { status: 201, body: { ok: true, request: request() } },
    "GET /v1/requests": { status: 200, body: { ok: true, requests: [request(), { id: "bad id!" }] } },
    "POST /v1/requests/req_1/decide": { status: 200, body: { ok: true, request: request({ status: "approved", decidedAt: T0 + 1 }) } },
    "POST /v1/requests/req_1/cancel": { status: 200, body: { ok: true } },
    [`POST /v1/rooms/${ROOM}/invites`]: { status: 201, body: { ok: true, invite: invite() } },
    "GET /v1/invites": { status: 200, body: { ok: true, invites: [invite()] } },
    "POST /v1/invites/inv_1/accept": { status: 200, body: { ok: true, room: room({ you: "member" }) } },
    "POST /v1/invites/inv_1/decline": { status: 200, body: { ok: true } },
    [`POST /v1/rooms/${ROOM}/leave`]: { status: 200, body: { ok: true } },
    [`POST /v1/rooms/${ROOM}/lock`]: { status: 200, body: { ok: true, room: room({ status: "locked" }) } },
    [`POST /v1/rooms/${ROOM}/close`]: { status: 200, body: { ok: true } },
    [`POST /v1/rooms/${ROOM}/members/${FRIEND.id}/remove`]: { status: 200, body: { ok: true } },
    "GET /v1/members/search?q=aks%20a": { status: 200, body: { ok: true, members: [FRIEND, { id: "x" }] } },
    "POST /v1/reports": { status: 202, body: { ok: true } },
  });
  await h.readyUp();
  const created = await h.client.createRoom({ name: "Lo-fi corner", kind: "hangout", policy: "request", listed: true });
  assert.equal(created.room.id, ROOM);
  assert.equal(created.room.policy, "request");
  assert.deepEqual(h.calls[0].body, { kind: "hangout", name: "Lo-fi corner", policy: "request", listed: true });
  assert.equal(h.calls[0].auth, "Bearer hub-session-1");
  assert.equal((await h.client.requestJoin(ROOM, "  hi!  ")).request.note, "hi!");
  assert.deepEqual(h.calls.at(-1).body, { note: "  hi!  " }, "the note goes as typed, control characters aside");
  assert.deepEqual((await h.client.requests()).requests.map((row) => row.id), ["req_1"], "a malformed row is dropped");
  assert.equal((await h.client.decide("req_1", "approve")).request.status, "approved");
  assert.deepEqual(h.calls.at(-1).body, { decision: "approve" });
  assert.deepEqual(await h.client.cancelRequest("req_1"), { ok: true });
  assert.equal((await h.client.invite(ROOM, FRIEND.id)).invite.id, "inv_1");
  assert.deepEqual(h.calls.at(-1).body, { userId: FRIEND.id });
  assert.equal((await h.client.invites()).invites[0].roomName, "Lo-fi corner");
  assert.equal((await h.client.acceptInvite("inv_1")).room.you, "member");
  assert.deepEqual(await h.client.declineInvite("inv_1"), { ok: true });
  assert.deepEqual(await h.client.leave(ROOM), { ok: true });
  assert.equal((await h.client.lock(ROOM)).room.status, "locked");
  assert.deepEqual(await h.client.close(ROOM), { ok: true });
  assert.deepEqual(await h.client.removeMember(ROOM, FRIEND.id), { ok: true });
  assert.deepEqual((await h.client.searchMembers(" aks a ")).members, [FRIEND]);
  assert.deepEqual(await h.client.report(ROOM, "423456789012345678", "spam"), { ok: true });
  assert.deepEqual(h.calls.at(-1).body, { roomId: ROOM, messageId: "423456789012345678", reason: "spam" });
  assert.ok(h.calls.every((call) => call.auth === "Bearer hub-session-1"));
});

test("a refusal keeps the hub's reason, and a lapsed session is renewed once", async () => {
  const h = harness({
    [`POST /v1/rooms/${ROOM}/requests`]: { status: 409, body: { ok: false, error: "limit", reason: "pending-requests", retryAfter: 5000 } },
    "GET /v1/invites": { status: 200, body: { ok: true, invites: [] } },
  });
  await h.readyUp();
  assert.deepEqual(await h.client.requestJoin(ROOM), { ok: false, error: "limit", reason: "pending-requests", retryAfter: 5000 });
  h.expireNext();
  assert.deepEqual(await h.client.invites(), { ok: true, invites: [] });
  assert.deepEqual(h.calls.slice(-3).map((call) => `${call.method} ${call.path} ${call.auth ?? ""}`.trim()), ["GET /v1/invites Bearer hub-session-1", "POST /v1/session", "GET /v1/invites Bearer hub-session-2"]);
});

test("history pages back, and messages arrive checked, as text", async () => {
  const h = harness({
    [`GET /v1/rooms/${ROOM}/messages`]: { status: 200, body: { ok: true, messages: [message(), { id: "1", text: "no author" }], hasMore: true } },
    [`GET /v1/rooms/${ROOM}/messages?before=423456789012345678`]: { status: 200, body: { ok: true, messages: [], hasMore: false } },
  });
  await h.readyUp();
  const page = await h.client.messages(ROOM);
  assert.equal(page.hasMore, true);
  assert.equal(page.messages.length, 1);
  assert.deepEqual(page.messages[0].mentions, [{ id: ME.id, name: "Mefi" }]);
  assert.equal(page.messages[0].author.viaStudio, true);
  assert.deepEqual(await h.client.messages(ROOM, "423456789012345678"), { ok: true, messages: [], hasMore: false });
  const odd = hub.roomMessage(message({ text: "bell\u0007 and\ttab\nline", author: { id: FRIEND.id, name: "A\u0000ksana" } }));
  assert.equal(odd.text, "bell and\ttab\nline");
  assert.equal(odd.author.name, "Aksana");
});

test("room chat goes over the socket and answers with the ack's message id or the nack's reason", async () => {
  const h = harness();
  assert.deepEqual(await h.client.sendMessage(ROOM, "hi"), { ok: false, reason: "offline" });
  await h.readyUp();
  assert.deepEqual(await h.client.sendMessage(ROOM, "   "), { ok: false, reason: "bad-request" });
  assert.deepEqual(await h.client.sendMessage(ROOM, "x".repeat(2001)), { ok: false, reason: "bad-request" });
  assert.deepEqual(await h.client.sendMessage(ROOM, "bell\u0007"), { ok: false, reason: "bad-request" });
  const sent = h.client.sendMessage(ROOM, "hello\nthere");
  const frame = h.socket().sent.at(-1);
  assert.deepEqual({ ...frame, nonce: typeof frame.nonce }, { type: "send", roomId: ROOM, text: "hello\nthere", nonce: "string" });
  h.socket().receive({ type: "ack", nonce: frame.nonce, messageId: "523456789012345678" });
  assert.deepEqual(await sent, { ok: true, messageId: "523456789012345678" });
  const refused = h.client.editMessage(ROOM, "523456789012345678", "edited");
  const edit = h.socket().sent.at(-1);
  assert.equal(edit.type, "edit");
  h.socket().receive({ type: "nack", nonce: edit.nonce, reason: "not-yours" });
  assert.deepEqual(await refused, { ok: false, reason: "not-yours", retryAfter: undefined });
  const gone = h.client.deleteMessage(ROOM, "523456789012345678");
  h.socket().receive({ type: "ack", nonce: h.socket().sent.at(-1).nonce });
  assert.deepEqual(await gone, { ok: true });
});

test("message, request and invite frames reach the host checked, and malformed ones never do", async () => {
  const h = harness();
  await h.readyUp();
  const s = h.socket();
  s.receive({ type: "message", roomId: ROOM, message: message() });
  s.receive({ type: "messageUpdate", roomId: ROOM, message: message({ text: "edited", editedAt: T0 + 5 }) });
  s.receive({ type: "messageDelete", roomId: ROOM, messageId: "423456789012345678" });
  s.receive({ type: "joinRequest", request: request() });
  s.receive({ type: "invite", invite: invite() });
  s.receive({ type: "message", roomId: "bad room!", message: message() });
  s.receive({ type: "message", roomId: ROOM, message: { id: "x" } });
  s.receive({ type: "joinRequest", request: request({ status: "unknown" }) });
  s.receive({ type: "invite", invite: invite({ roomName: "two\nlines" }) });
  s.receive({ type: "messageDelete", roomId: ROOM, messageId: "nope" });
  const seen = h.events.filter((event) => ["message", "messageUpdate", "messageDelete", "joinRequest", "invite"].includes(event.type));
  assert.deepEqual(seen.map((event) => event.type), ["message", "messageUpdate", "messageDelete", "joinRequest", "invite"]);
  assert.equal(seen[1].message.text, "edited");
  assert.equal(seen[3].request.requester.name, "Aksana");
  assert.equal(seen[4].invite.invitedBy.id, ME.id);
});
