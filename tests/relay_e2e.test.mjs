import assert from "node:assert/strict";
import test from "node:test";
import { ALICE, BOB, CARA, MOD, connectAll, makeRelay, member, rawSocket, until, wait } from "./fixtures/relay-harness.mjs";

// End to end: Studio's real scripts/hub-client.cjs, one per member, against
// the relay's real Worker and Hub Durable Object (relay/src) running under
// Node (relay/node/adapter.mjs) with a scripted Discord. These are the flows
// Friends › Rooms, Listen together, the Playground and cowork claims use.

async function roomWithBob(relay, alice, bob, kind = "hangout") {
  const made = await alice.client.createRoom({ kind, name: "Night shift", policy: "request", listed: true });
  assert.equal(made.ok, true, JSON.stringify(made));
  const asked = await bob.client.requestJoin(made.room.id, "hi!");
  assert.equal(asked.ok, true);
  const decided = await alice.client.decide(asked.request.id, "approve");
  assert.equal(decided.request.status, "approved");
  alice.client.subscribe(made.room.id);
  bob.client.subscribe(made.room.id);
  await until(() => bob.of("presence").some((event) => event.inStudio.length === 2), "both present");
  return made.room.id;
}

test("signing in, the room flow and chat that is passed along, never stored", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  await connectAll(alice, bob);
  assert.equal(alice.client.status().user.name, "Alice");
  assert.equal(alice.client.status().companions, true);

  const roomId = await roomWithBob(relay, alice, bob);
  const rooms = await bob.client.rooms();
  assert.equal(rooms.rooms.find((room) => room.id === roomId).you, "member");

  const sent = await alice.client.sendMessage(roomId, "the secret plan");
  assert.equal(sent.ok, true);
  assert.match(sent.messageId, /^\d{17,20}$/);
  const got = await until(() => bob.of("message").find((event) => event.message.id === sent.messageId), "bob's copy");
  assert.equal(got.message.text, "the secret plan");
  assert.equal(got.message.author.id, ALICE.id);

  // Only the author edits; the owner or a moderator may delete.
  assert.equal((await bob.client.editMessage(roomId, sent.messageId, "forged")).reason, "not-yours");
  assert.equal((await alice.client.editMessage(roomId, sent.messageId, "the new plan")).ok, true);
  await until(() => bob.of("messageUpdate").some((event) => event.message.text === "the new plan"), "the edit");
  const bobs = await bob.client.sendMessage(roomId, "mine");
  assert.equal((await alice.client.deleteMessage(roomId, bobs.messageId)).ok, true, "the owner deletes a member's message");
  await until(() => bob.of("messageDelete").some((event) => event.messageId === bobs.messageId), "the delete");

  // The relay keeps no history: the page is empty and no table holds the words.
  assert.deepEqual(await bob.client.messages(roomId), { ok: true, messages: [], hasMore: false });
  for (const { name } of relay.sql("SELECT name FROM sqlite_master WHERE type = 'table'")) {
    const dump = JSON.stringify(relay.sql(`SELECT * FROM "${name}"`));
    assert.ok(!dump.includes("secret plan") && !dump.includes("new plan"), `${name} holds chat text`);
    assert.ok(!dump.includes("tok-alice") && !dump.includes("tok-bob"), `${name} holds an access token`);
  }
  await alice.client.disconnect();
  await bob.client.disconnect();
});

test("invites, leaving, removal, lock and close", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  const cara = member(relay, "tok-cara");
  await connectAll(alice, bob, cara);
  const made = await alice.client.createRoom({ kind: "hangout", name: "Invite only", policy: "invite", listed: false });
  const roomId = made.room.id;
  assert.equal((await bob.client.rooms()).rooms.some((room) => room.id === roomId), false, "an unlisted room stays hidden");
  assert.equal((await bob.client.requestJoin(roomId)).error, "not-found");

  const found = await alice.client.searchMembers("car");
  assert.deepEqual(found.members.map((one) => one.id), [CARA.id]);
  const invited = await alice.client.invite(roomId, CARA.id);
  assert.equal(invited.ok, true);
  await until(() => cara.of("invite").length, "cara's invite frame");
  assert.equal((await cara.client.invites()).invites[0].roomName, "Invite only");
  const joined = await cara.client.acceptInvite(invited.invite.id);
  assert.equal(joined.room.you, "member");

  assert.equal((await alice.client.leave(roomId)).reason, "owner-must-close");
  const locked = await alice.client.lock(roomId);
  assert.equal(locked.room.status, "locked");
  cara.client.subscribe(roomId);
  await wait(20);
  assert.equal((await cara.client.sendMessage(roomId, "hello?")).reason, "locked");
  await alice.client.unlock(roomId);

  assert.equal((await alice.client.removeMember(roomId, CARA.id)).ok, true);
  await until(() => cara.of("membership").some((event) => event.state === "removed"), "cara removed");
  assert.equal((await cara.client.sendMessage(roomId, "still?")).reason, "not-member");

  assert.equal((await alice.client.close(roomId)).ok, true);
  assert.equal((await alice.client.rooms()).rooms.some((room) => room.id === roomId), false);
  for (const one of [alice, bob, cara]) await one.client.disconnect();
});

test("room rules: Room Host for listed rooms, a week in the server for your own, new members post no links", async () => {
  const relay = makeRelay();
  const bob = member(relay, "tok-bob");
  const week = member(relay, "tok-week");
  const newbie = member(relay, "tok-newbie");
  const alice = member(relay, "tok-alice");
  await connectAll(bob, week, newbie, alice);
  assert.equal((await bob.client.createRoom({ kind: "hangout", name: "Mine", policy: "request", listed: true })).reason, "room-host-role");
  assert.equal((await bob.client.createRoom({ kind: "hangout", name: "Mine", policy: "invite", listed: false })).ok, true);
  assert.equal((await week.client.createRoom({ kind: "hangout", name: "Too soon", policy: "invite", listed: false })).reason, "week-member");
  assert.equal((await newbie.client.createRoom({ kind: "hangout", name: "New", policy: "invite", listed: false })).reason, "new-member");

  const made = await alice.client.createRoom({ kind: "hangout", name: "Open", policy: "request", listed: true });
  const asked = await newbie.client.requestJoin(made.room.id);
  await alice.client.decide(asked.request.id, "approve");
  newbie.client.subscribe(made.room.id);
  await wait(20);
  assert.equal((await newbie.client.sendMessage(made.room.id, "see https://example.com")).reason, "links-not-allowed");
  assert.equal((await newbie.client.sendMessage(made.room.id, "hello all")).ok, true);
  for (const one of [bob, week, newbie, alice]) await one.client.disconnect();
});

test("listen together keeps its place when the relay sleeps between frames", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  await connectAll(alice, bob);
  const roomId = await roomWithBob(relay, alice, bob);
  const started = await alice.client.listen(roomId, { action: "start", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", label: "Me at the zoo", provider: "youtube" });
  assert.equal(started.ok, true);
  await until(() => bob.of("listen").some((event) => event.session?.label === "Me at the zoo"), "bob sees the session");
  assert.equal((await bob.client.listen(roomId, { action: "pause" })).reason, "not-yours");
  assert.equal((await alice.client.listen(roomId, { action: "start", url: "http://192.168.1.5/a.mp3", label: "lan", provider: "file" })).reason, "bad-link");

  await relay.hibernate();
  assert.equal((await alice.client.listen(roomId, { action: "seek", positionMs: 42_000 })).ok, true);
  const seek = await until(() => bob.of("listen").find((event) => event.session?.positionMs === 42_000), "the seek after a wake");
  assert.equal(seek.session.label, "Me at the zoo");
  await alice.client.listen(roomId, { action: "stop" });
  await until(() => bob.of("listen").at(-1)?.session === null, "the stop");
  await alice.client.disconnect();
  await bob.client.disconnect();
});

test("cowork claims: conflicts, renewals and release, pushed to the room", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  await connectAll(alice, bob);
  const roomId = await roomWithBob(relay, alice, bob, "cowork");
  const mine = await alice.client.claim(roomId, { machineId: "pc-alice", paths: ["src/**"], runId: "run1", title: "refactor" });
  assert.equal(mine.ok, true);
  const clash = await bob.client.claim(roomId, { machineId: "pc-bob", paths: ["src/app.js"], runId: "run2" });
  assert.equal(clash.error, "conflict");
  assert.deepEqual(clash.conflicts[0].overlapping, ["src/**"]);
  assert.equal((await bob.client.claim(roomId, { machineId: "pc-bob", paths: ["docs/**"], runId: "run2" })).ok, true);
  await until(() => bob.of("claims").some((event) => event.leases.length === 2), "two leases pushed");
  assert.equal((await alice.client.renewClaim(mine.leaseId)).ok, true);
  assert.equal((await alice.client.releaseClaim(mine.leaseId, "done")).ok, true);
  assert.equal((await alice.client.renewClaim(mine.leaseId)).error, "gone");
  await alice.client.disconnect();
  await bob.client.disconnect();
});

test("companions go to the room, or to one member only, and are never stored", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  const mod = member(relay, "tok-mod");
  await connectAll(alice, bob, mod);
  const roomId = await roomWithBob(relay, alice, bob);
  const invited = await alice.client.invite(roomId, MOD.id);
  await mod.client.acceptInvite(invited.invite.id);
  mod.client.subscribe(roomId);
  await until(() => alice.of("presence").some((event) => event.inStudio.length === 3), "three present");

  assert.equal(alice.client.sendCompanion(roomId, { v: 1, name: "Pip", mood: "waving" }), true);
  await until(() => bob.of("companion").length && mod.of("companion").length, "the room gets the card");
  assert.equal(alice.of("companion").length, 0, "no echo to the sender");
  assert.equal(alice.client.sendCompanion(roomId, { v: 1, name: "Pip", whisper: true }, BOB.id), true);
  await until(() => bob.of("companion").some((event) => event.direct === true), "bob's direct card");
  await wait(20);
  assert.equal(mod.of("companion").some((event) => event.direct), false, "a direct card reaches nobody else");
  const dump = JSON.stringify(relay.sql("SELECT * FROM meta")) + JSON.stringify(relay.sql("SELECT * FROM audit"));
  assert.ok(!dump.includes("Pip"));
  for (const one of [alice, bob, mod]) await one.client.disconnect();
});

test("peer history: a member's own copy fills the gap, and forged copies are dropped", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  await connectAll(alice, bob);
  const roomId = await roomWithBob(relay, alice, bob);
  // Bob's second Studio keeps the room's messages as they arrive (raw frames, with their sig).
  const keeper = await rawSocket(relay, "tok-bob");
  keeper.send({ type: "hello", session: keeper.session, protocol: 1, features: ["history.peer"] });
  keeper.send({ type: "subscribe", roomId });
  await until(() => keeper.of("presence").length, "the keeper subscribed");
  const first = await alice.client.sendMessage(roomId, "first");
  await alice.client.sendMessage(roomId, "second");
  const copies = await until(() => (keeper.of("message").length === 2 ? keeper.of("message").map((frame) => frame.message) : null), "the keeper's copies");
  assert.match(copies[0].sig, /^[A-Za-z0-9_-]{22}$/);

  // Another of Alice's Studios asks the room; the relay forwards the ask to the keeper.
  const asker = await rawSocket(relay, "tok-alice");
  asker.send({ type: "hello", session: asker.session, protocol: 1, features: ["history.peer"] });
  asker.send({ type: "subscribe", roomId });
  await until(() => asker.of("presence").length, "the asker subscribed");
  asker.send({ type: "historyRequest", roomId, nonce: "h1" });
  await until(() => asker.of("ack").some((frame) => frame.nonce === "h1"), "the ask routed");
  const ask = await until(() => keeper.of("historyRequest")[0], "the forwarded ask");
  const forged = { ...copies[0], text: "alice said something else" };
  const stranger = { ...copies[1], author: { ...copies[1].author, id: BOB.id, name: "Bob" } };
  keeper.send({ type: "historyReply", requestId: ask.requestId, messages: [forged, ...copies, stranger], hasMore: false });
  const history = await until(() => asker.of("history")[0], "the checked history");
  assert.deepEqual(history.messages.map((item) => item.text), ["first", "second"]);
  assert.equal(history.messages[0].id, first.messageId);
  keeper.send({ type: "historyReply", requestId: ask.requestId, messages: copies, hasMore: false });
  await until(() => keeper.of("error").some((frame) => frame.code === "unknownRequest"), "a second answer is refused");

  // With nobody to ask, the relay says so at once.
  keeper.socket.close();
  await wait(20);
  asker.send({ type: "historyRequest", roomId, nonce: "h2" });
  await until(() => asker.of("nack").length || asker.of("ack").length > 1, "the second ask's answer");
  assert.ok(asker.of("nack").some((frame) => frame.nonce === "h2" && ["no-peer", "rate-limited"].includes(frame.reason)));
  asker.socket.close();
  await alice.client.disconnect();
  await bob.client.disconnect();
});

test("reconnects after the relay sleeps, renews, and the keepalive ping never wakes it", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  await connectAll(alice, bob);
  const roomId = await roomWithBob(relay, alice, bob);
  await relay.hibernate();
  assert.equal((await bob.client.sendMessage(roomId, "after the nap")).ok, true);
  await until(() => alice.of("message").some((event) => event.message.text === "after the nap"), "delivery after a wake");

  assert.equal(relay.autoResponse().request, '{"type":"ping"}');
  assert.equal(relay.autoResponse().response, '{"type":"pong"}');
  assert.equal(JSON.stringify({ type: "ping" }), relay.autoResponse().request, "Studio's ping must match the auto-response byte for byte");
  const raw = await rawSocket(relay, "tok-cara");
  raw.socket.send('{"type":"ping"}');
  await until(() => raw.of("pong").length, "pong before hello");
  raw.socket.close();
  await alice.client.disconnect();
  await bob.client.disconnect();
});
