import assert from "node:assert/strict";
import test from "node:test";
import { ALICE, BOB, CARA, connectAll, makeRelay, member, until, wait } from "./fixtures/relay-harness.mjs";

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

test("the Lobby front page: who is online and where, rooms open now, the week's top project, rank-ups and your week", async () => {
  let clock = Date.now();
  const relay = makeRelay({ now: () => clock });
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  const cara = member(relay, "tok-cara");
  await connectAll(alice, bob, cara);
  assert.equal(alice.client.status().front, true);
  const jam = await alice.client.createRoom({ kind: "hangout", name: "Jam night", policy: "request", listed: true });
  assert.equal(jam.ok, true, JSON.stringify(jam));
  const secret = await bob.client.createRoom({ kind: "hangout", name: "Secret plans", policy: "invite", listed: false });
  assert.equal(secret.ok, true, JSON.stringify(secret));
  alice.client.subscribe(jam.room.id);
  bob.client.subscribe("lobby");
  bob.client.subscribe(secret.room.id);
  await until(() => alice.of("presence").some((event) => event.roomId === jam.room.id && event.inStudio.includes(ALICE.id)), "alice in Jam night");
  await until(() => bob.of("presence").some((event) => event.roomId === secret.room.id), "bob in his own room");
  assert.equal((await cara.client.setOnlineVisible(false)).visible, false);

  // Alice was 45 credits in; a play (5) and a star (3) take her past Ember at 50.
  relay.sql("INSERT INTO accounts (user_id, balance, lifetime) VALUES (?, 45, 45) ON CONFLICT (user_id) DO UPDATE SET balance = 45, lifetime = 45", ALICE.id);
  const shared = await alice.client.shareProject({ url: "https://alice.itch.io/void-runner", title: "Void Runner", kind: "game" });
  const play = await bob.client.playProject(shared.project.id);
  clock += 2 * 60_000 + 1;
  assert.deepEqual((await bob.client.finishPlay(shared.project.id, play.token)).credited, { owner: 5, you: 2 });
  assert.equal((await bob.client.star(shared.project.id)).ok, true);

  const seen = await bob.client.front();
  assert.equal(seen.ok, true, JSON.stringify(seen));
  assert.equal(seen.online.count, 1, "Alice; Cara hid, and Bob is not listed to himself");
  assert.deepEqual(seen.online.people.map((person) => [person.name, person.where?.name]), [["Alice", "Jam night"]]);
  assert.deepEqual(seen.rooms.map((room) => [room.name, room.here]).sort(), [["Jam night", 1], ["Secret plans", 1]], "listed rooms, and his own");
  assert.equal(seen.lobby.here, 1, "Bob is in the Lobby");
  assert.equal(seen.top.title, "Void Runner");
  assert.deepEqual([seen.top.week, seen.top.weekPlays, seen.top.weekStars], [true, 1, 1]);
  assert.deepEqual(seen.fresh.map((project) => project.title), ["Void Runner"]);
  assert.deepEqual(seen.rankUps.map((item) => [item.name, item.rank.key]), [["Alice", "ember"]]);
  assert.equal(seen.ownRoom.name, "Secret plans", "Bob's own room, for his invite code");
  assert.equal(seen.you.balance, 2);

  const hers = await alice.client.front();
  assert.deepEqual(hers.online.people.map((person) => [person.name, person.where?.name]), [["Bob", "Lobby"]], "an unlisted room is never named");
  assert.equal(JSON.stringify(hers).includes("Secret plans"), false);
  assert.deepEqual(hers.you.week, { earned: 8, plays: 1, stars: 1 });
  assert.equal(hers.you.rank.key, "ember");
  assert.equal(hers.ownRoom.name, "Jam night");
  assert.equal(hers.visible, true);
  assert.equal((await cara.client.front()).visible, false);
  for (const one of [alice, bob, cara]) await one.client.disconnect();
});

test("opening Studio tells the people you share a room with, once in a while, never the Lobby, never when hidden", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  const cara = member(relay, "tok-cara");
  await connectAll(alice, bob, cara);
  const made = await alice.client.createRoom({ kind: "hangout", name: "Friday jam", policy: "invite", listed: false });
  const code = await alice.client.roomCode(made.room.id);
  assert.equal((await bob.client.joinCode(code.code)).ok, true);
  await alice.client.disconnect();
  const back = member(relay, "tok-alice");
  await connectAll(back);
  await until(() => bob.of("friendOnline").length === 1, "bob hears that alice opened Studio");
  assert.deepEqual(bob.of("friendOnline")[0].user, { id: ALICE.id, name: "Alice" });
  await wait(30);
  assert.equal(cara.of("friendOnline").length, 0, "Cara only shares the Lobby with her");
  // Again within 30 minutes: quiet. Hidden: never.
  await back.client.disconnect();
  const again = member(relay, "tok-alice");
  await connectAll(again);
  await wait(30);
  assert.equal(bob.of("friendOnline").length, 1, "not twice in half an hour");
  await bob.client.setOnlineVisible(false);
  await bob.client.disconnect();
  const hidden = member(relay, "tok-bob");
  await connectAll(hidden);
  await wait(30);
  assert.equal(again.of("friendOnline").length, 0, "someone hidden is never announced");
  for (const one of [again, hidden, cara]) await one.client.disconnect();
});

test("what a member shares they are building shows on friends' front pages, and goes when they stop or leave", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  await connectAll(alice, bob);
  assert.equal(alice.client.status().building, true);
  assert.equal(alice.client.setBuilding({ project: "Pixel Forge", running: 3, doneToday: 2 }), true);
  assert.equal(alice.client.setBuilding({ project: "" }), false, "a share needs a project name");
  await until(async () => (await bob.client.front()).online.people.some((person) => person.building?.project === "Pixel Forge"), "bob sees what alice builds");
  const seen = (await bob.client.front()).online.people.find((person) => person.id === ALICE.id);
  assert.deepEqual(seen.building, { project: "Pixel Forge", running: 3, doneToday: 2 });
  alice.client.setBuilding(null);
  await until(async () => (await bob.client.front()).online.people.every((person) => !person.building), "stopped sharing");
  // A reconnect re-sends what is shared; a disconnect forgets it.
  alice.client.setBuilding({ project: "Tiny Tides", running: 1, doneToday: 0 });
  await alice.client.disconnect();
  await until(async () => (await bob.client.front()).online.count === 0, "alice gone");
  await bob.client.disconnect();
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
