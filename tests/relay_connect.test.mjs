import assert from "node:assert/strict";
import test from "node:test";
import { ALICE, BOB, CARA, connectAll, makeRelay, member, until } from "./fixtures/relay-harness.mjs";

// Connecting made simple on the relay: everyone signed in is in the Lobby,
// a room's short join code lets a friend in without an approval step, and
// Who's online lists the people in Studio right now (anyone may hide).
// Studio's real hub-client against the real Worker and Hub under Node.

test("everyone is in the Lobby, which nobody can leave, lock or close, and it comes first", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  await connectAll(alice, bob);
  assert.equal(alice.client.status().lobby, true);
  const rooms = await bob.client.rooms();
  assert.equal(rooms.rooms[0].id, "lobby");
  assert.equal(rooms.rooms[0].you, "member");
  assert.equal(rooms.rooms[0].memberCount, 2);

  alice.client.subscribe("lobby");
  bob.client.subscribe("lobby");
  await until(() => bob.of("presence").some((event) => event.roomId === "lobby" && event.inStudio.length === 2), "both in the Lobby");
  assert.equal((await alice.client.sendMessage("lobby", "hi everyone")).ok, true);
  await until(() => bob.of("message").some((event) => event.message.text === "hi everyone"), "the Lobby's chat");

  assert.equal((await bob.client.leave("lobby")).reason, "lobby");
  const mod = member(relay, "tok-mod");
  await connectAll(mod);
  assert.equal((await mod.client.close("lobby")).reason, "lobby");
  assert.equal((await mod.client.lock("lobby")).reason, "lobby");
  assert.equal((await alice.client.roomCode("lobby")).reason, "lobby", "the Lobby needs no code");
  for (const one of [alice, bob, mod]) await one.client.disconnect();
});

test("a join code lets a friend straight in; the owner can replace it; guesses are limited", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  const cara = member(relay, "tok-cara");
  await connectAll(alice, bob, cara);
  const made = await alice.client.createRoom({ kind: "hangout", name: "Friday jam", policy: "invite", listed: false });
  const code = await alice.client.roomCode(made.room.id);
  assert.match(code.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(code.link, `https://mefi-relay.mefi-studio.workers.dev/join/${code.code.replace("-", "")}`);
  assert.equal((await alice.client.roomCode(made.room.id)).code, code.code, "the same code until it is replaced");

  alice.client.subscribe(made.room.id);
  await until(() => alice.of("presence").some((event) => event.roomId === made.room.id), "alice in her room");
  const joined = await bob.client.joinCode(code.code.toLowerCase().replace("-", " "));
  assert.equal(joined.ok, true, JSON.stringify(joined));
  assert.equal(joined.room.you, "member");
  await until(() => alice.of("membership").some((event) => event.userId === BOB.id && event.state === "joined"), "alice hears bob join");
  assert.equal((await bob.client.joinCode(code.code)).ok, true, "joining again is harmless");

  assert.equal((await bob.client.newRoomCode(made.room.id)).error, "forbidden", "only the owner replaces the code");
  const fresh = await alice.client.newRoomCode(made.room.id);
  assert.notEqual(fresh.code, code.code);
  assert.equal((await cara.client.joinCode(code.code)).reason, "code", "the old code stops working");
  assert.equal((await cara.client.joinCode(fresh.code)).ok, true);

  let refused = null;
  for (let tries = 0; tries < 12 && !refused; tries += 1) {
    const answer = await cara.client.joinCode("AAAA-AAAA");
    if (answer.error === "rate-limited") refused = answer;
  }
  assert.ok(refused, "ten guesses a minute, then a pause");

  const page = await relay.fetch(code.link.replace("https://mefi-relay.mefi-studio.workers.dev", "http://127.0.0.1:8787"));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, new RegExp(code.code));
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  for (const one of [alice, bob, cara]) await one.client.disconnect();
});

test("Who's online lists the people in Studio now, and anyone can hide", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  const cara = member(relay, "tok-cara");
  await connectAll(alice, bob, cara);
  const seen = await alice.client.online();
  assert.deepEqual(seen.people.map((person) => person.name), ["Bob", "Cara"], "everyone but you, by name");
  assert.equal(seen.people[0].rank, "spark");
  assert.equal(seen.visible, true);

  assert.equal((await cara.client.setOnlineVisible(false)).visible, false);
  assert.deepEqual((await alice.client.online()).people.map((person) => person.id), [BOB.id]);
  assert.equal((await cara.client.online()).visible, false);
  await cara.client.disconnect();
  await bob.client.disconnect();
  await until(async () => (await alice.client.online()).people.length === 0, "nobody else is online");
  await alice.client.disconnect();
  assert.ok(ALICE && CARA);
});
