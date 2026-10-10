import test from "node:test";
import assert from "node:assert/strict";
import hub from "../scripts/hub-client.cjs";
import actors from "../scripts/actor-contract.cjs";
import social from "../scripts/social-client.cjs";
import collectibles from "../scripts/collectibles-contract.cjs";
const A = "studio:12345678-1234-4abc-8abc-123456789abc", B = "studio:87654321-4321-4abc-9abc-cba987654321";
const D = "123456789012345678", T = 1800000000000, AP = "accounts.canonical.1";
const user = (id = A) => ({ id, name: "Member" });
async function fixture({ account = true, marker = AP, id = A, readyId = id, features = [AP], reply, grant } = {}) {
  const calls = [], events = [], sockets = [], timers = [];
  let discordCalls = 0, nextId = id;
  class Socket {
    constructor() { this.readyState = 0; sockets.push(this); this.sent = []; }
    send(text) { this.sent.push(JSON.parse(text)); } close() { this.readyState = 3; }
    receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  }
  const client = hub.createHubClient({
    url: "https://hub.example.test", now: () => T, WebSocket: Socket,
    getAccessToken: async () => { discordCalls++; return { ok: true, token: "discord_fixture" }; },
    ...(account ? { getAccountSession: async () => grant ?? ({ ok: true, accountSession: "a".repeat(64) }) } : {}),
    fetch: async (url, init) => {
      const path = new URL(url).pathname; calls.push({ path, ...init });
      if (path === "/v1/session") return new Response(JSON.stringify({ session: "hub_fixture", expiresAt: T + 900000, user: user(nextId), readOnly: false, ...(marker === null ? {} : { actorProtocol: marker }) }));
      return reply?.(path, init) ?? new Response(JSON.stringify({ ok: true }));
    },
    setTimeout: (fn, ms) => { const entry = { fn, ms }; timers.push(entry); return entry; },
    clearTimeout: (entry) => { if (entry) entry.canceled = true; }, setInterval: () => 0, clearInterval() {},
    onEvent: (e) => events.push(e),
  });
  await client.connect();
  if (sockets.length) {
    sockets[0].readyState = 1; sockets[0].onopen?.();
    sockets[0].receive({ type: "ready", user: user(readyId), protocol: 1, features });
  }
  return { client, calls, events, sockets, timers, switchActor: (value) => { nextId = value; }, discordCalls: () => discordCalls };
}
test("actor grammar is exact and never coerces a provider subject into an account", () => {
  for (const good of [A, B, D]) assert.equal(actors.actorId(good), good);
  for (const bad of [123456789012345678, { toString: () => A }, "studio:foo", A.toUpperCase(), A.replace("-4abc-", "-5abc-"), A.replace("-8abc-", "-7abc-"), A + " "]) assert.equal(actors.actorId(bad), null);
  assert.equal(actors.isDiscordSubject(A), false);
});
test("real hub client uses exactly accountSession and negotiates the same canonical actor", async () => {
  const h = await fixture(); assert.equal(h.client.status().state, "ready");
  assert.deepEqual(JSON.parse(h.calls[0].body), { accountSession: "a".repeat(64) });
  assert.equal(h.discordCalls(), 0); assert.equal(h.client.status().actorProtocol, AP);
  assert.ok(h.sockets[0].sent[0].features.includes(AP));
  assert.doesNotMatch(JSON.stringify(h.events), /aaaaaaaaaaaaaaaa|hub_fixture|discord_fixture/);
});
test("canonical credentials never fall back when bootstrap is unmarked or unknown", async () => {
  for (const marker of [null, "accounts.canonical.2"]) {
    const h = await fixture({ marker, id: D }); assert.equal(h.client.status().error, "unsupported");
    assert.equal(h.discordCalls(), 0); assert.equal(h.sockets.length, 0);
  }
});
test("ready without canonical capability or with a different actor ends the session", async () => {
  const absent = await fixture({ features: [] }); assert.equal(absent.client.status().error, "unsupported"); assert.equal(absent.client.status().user, null);
  const switched = await fixture({ readyId: B }); assert.equal(switched.client.status().error, "stale_account");
});
test("legacy numeric clients remain compatible and reject opaque shared surfaces explicitly", async () => {
  const h = await fixture({ account: false, marker: null, id: D, features: [], reply: () => new Response(JSON.stringify({ ok: true, members: [user(A)] })) });
  assert.equal(h.client.status().state, "ready"); assert.equal(h.discordCalls(), 1);
  const response = await h.client.searchMembers("Member"); assert.equal(response.error, "upgrade-required");
});
test("canonical presence, rooms, pets, projects and owners retain exact account identities", async () => {
  const h = await fixture(); h.sockets[0].receive({ type: "presence", roomId: "lobby", inStudio: [A, B, D] });
  assert.deepEqual(h.events.at(-1).inStudio, [A, B, D]);
  const s = hub.createActorShapes(() => true);
  assert.equal(s.roomSummary({ id: "room_a", name: "Room", ownerId: A }).ownerId, A);
  assert.equal(s.roomSummary({ id: "room_a", name: "Room", ownerId: "studio:foo" }), null);
  assert.equal(s.roomPetsOf([{ userId: A, name: "Friend", pet: { kind: "wisp", skin: "gold", name: "Pet" } }])[0].userId, A);
  assert.equal(s.projectCard({ id: "project_a", owner: user(A), url: "https://example.test", title: "Project" }).owner.id, A);
});
test("signed Studio authors allow actors; raw Discord author and message targets remain Snowflakes", async () => {
  const s = hub.createActorShapes(() => true), message = { id: D, author: { ...user(A), viaStudio: true }, text: "Hello", createdAt: T, sig: "relay_signature", mentions: { users: [user(B)] } };
  assert.equal(s.roomMessage(message).author.id, A);
  assert.equal(s.roomMessage({ ...message, id: A }), null);
  assert.equal(s.roomMessage({ ...message, sig: undefined }), null);
  assert.equal(s.roomMessage({ ...message, author: { ...user(A), viaStudio: false } }), null);
  assert.equal(s.remoteCommand({ requestId: "request", from: A, command: "status" }), null);
  const h = await fixture({ features: [AP, "messages.signed"] });
  assert.equal((await h.client.deleteMessage("lobby", A)).reason, "bad-request");
});
test("renewal actor switch closes instead of moving the current wallet", async () => {
  const h = await fixture(); h.switchActor(B);
  await h.timers.find((t) => t.ms === 840000 && !t.canceled).fn();
  for (let i = 0; i < 10; i++) await new Promise(setImmediate);
  assert.equal(h.client.status().error, "stale_account"); assert.equal(h.client.status().user, null);
});
test("canonical swap requests use exact actors while send-image message IDs remain provider IDs", async () => {
  const calls = []; const client = social.createSocialClient({ canonical: () => true, supported: () => true, request: async (method, path, body) => {
    calls.push({ method, path, body }); return { ok: true, data: { member: user(A), mine: [], theirs: [] } };
  } });
  assert.equal((await client.tradeInventory(A)).member.id, A);
  assert.match(calls[0].path, /studio%3A/);
  assert.equal((await client.tradeInventory("studio:foo")).error, "bad-request");
});
test("sticker owners are negotiated actors with no coercion or arbitrary Studio aliases", () => {
  const raw = { id: "item_example", ownerId: A, rarity: "rare", name: "Hello", visual: { body: "wisp", primary: "#123456", secondary: "#abcdef", motif: "plain" } };
  assert.equal(collectibles.sticker(raw), null); assert.equal(collectibles.sticker(raw, true).ownerId, A);
  assert.equal(collectibles.sticker({ ...raw, ownerId: "studio:foo" }, true), null);
});
test("a waitlisted native account starts no hub request, socket, retry or Discord fallback", async () => {
  const h = await fixture({ grant: { ok: false, error: "waitlisted" } });
  assert.equal(h.client.status().error, "waitlisted");
  assert.equal(h.client.status().user, null);
  assert.equal(h.calls.length, 0); assert.equal(h.sockets.length, 0);
  assert.equal(h.timers.length, 0); assert.equal(h.discordCalls(), 0);
});