import assert from "node:assert/strict";
import test from "node:test";
import { FEATURES, LIMITS, PETS_GENERATION, PET_GENERATION, PET_KINDS, petForGeneration, petsGenerationOf } from "../relay/src/protocol.mjs";
import { PETS_LIMITS } from "../relay/src/pets.mjs";
import { ALICE, BOB, connectAll, hubClient, makeRelay, member, until, wait } from "./fixtures/relay-harness.mjs";

// Pets in rooms on the relay (relay/src/pets.mjs): a member's pet rides on
// their socket's attachment only, never in the store, and survives the relay
// sleeping. The members of a room with Studio open on it see each other's pets
// in one roomPets frame (Studios that said "pets" in hello only), never a
// hidden member's, never anyone outside the room, at most 12. Six pet frames
// a minute per socket, and a Shop skin or pet only when its member owns it
// (Ember otherwise). A Studio whose hello names an older pets generation sees
// a newer kind as Ember. Then Studio's own client, which says its pet again
// after a reconnect.

const EMBER = { kind: "dragon", skin: "theme", name: "Ember" };
let nextIp = 1;

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

/** A Studio on a raw socket (each from its own address: the relay allows ten connects a minute per address). */
async function studio(relay, token, { pets = true, features = ["pets"] } = {}) {
  const answer = await relay.fetch("http://127.0.0.1:8787/v1/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: token }) });
  const { session } = await answer.json();
  const socket = new relay.WebSocket("ws://127.0.0.1:8787/v1/ws", { ip: `10.0.0.${nextIp++}` });
  const frames = [];
  socket.onmessage = (event) => frames.push(JSON.parse(event.data));
  await until(() => socket.readyState === 1, "socket open");
  const send = (frame) => socket.send(JSON.stringify(frame));
  send({ type: "hello", session, protocol: 1, ...(pets ? { features } : {}) });
  await until(() => frames.some((frame) => frame.type === "ready"), `${token} ready`);
  const of = (type) => frames.filter((frame) => frame.type === type);
  return {
    socket, frames, send, of,
    /** The latest roomPets for a room, as [userId, skin, pet name]. */
    pets: (roomId) => (of("roomPets").filter((frame) => frame.roomId === roomId).at(-1)?.pets ?? null)?.map((item) => [item.userId, item.pet.skin, item.pet.name]) ?? null,
    async open(roomId) {
      send({ type: "subscribe", roomId });
      await until(() => frames.some((frame) => (frame.type === "presence" && frame.roomId === roomId) || (frame.type === "error" && frame.message === roomId)), `${token} in ${roomId}`);
    },
  };
}

/** Alice's room, which Bob (and anyone else named) joins with its code. -> roomId */
async function den(relay, as, ...joiners) {
  const made = await as("tok-alice", "POST", "/v1/rooms", { kind: "hangout", name: "The den", policy: "invite", listed: false });
  assert.equal(made.status, 201, JSON.stringify(made));
  const { code } = await as("tok-alice", "GET", `/v1/rooms/${made.room.id}/code`);
  for (const token of joiners) assert.equal((await as(token, "POST", "/v1/join", { code })).status, 200, token);
  return made.room.id;
}

const settle = () => wait(20);
const dump = (relay) => JSON.stringify(relay.sql(`SELECT name FROM sqlite_master WHERE type = 'table'`).map(({ name }) => relay.sql(`SELECT * FROM "${name}"`)));

test("the pet frame takes Studio's pets only: a kind and skin from its lists, a name on one line of 24 at most, cleaned", async () => {
  const relay = makeRelay();
  const alice = await studio(relay, "tok-alice");
  const refused = [{ ...EMBER, kind: "cat" }, { ...EMBER, skin: "rainbow" }, { ...EMBER, name: "x".repeat(LIMITS.petNameChars + 1) }, { ...EMBER, name: "two\nlines" }, { kind: "dragon", skin: "theme" }];
  for (const pet of refused) alice.send({ type: "pet", pet });
  alice.send({ type: "pet" });
  await until(() => alice.of("error").length >= refused.length + 1, "every bad frame refused");
  assert.ok(alice.of("error").every((frame) => frame.code === "badFrame"));
  alice.send({ type: "pet", pet: { kind: "dragon", skin: "theme", name: "  Ember   the brave ", hat: "a tall one" } });
  await settle();
  const kept = relay.sockets().map((ws) => ws.deserializeAttachment()).find((a) => a?.uid === ALICE.id).pt;
  assert.deepEqual({ kind: kept.kind, skin: kept.skin, name: kept.name }, { kind: "dragon", skin: "theme", name: "Ember the brave" }, "cleaned like other relay text, and nothing else rides along");
  assert.ok(!("hat" in kept));
  assert.equal(alice.of("error").length, refused.length + 1, "a good pet is no error");
  alice.send({ type: "pet", pet: null });
  await settle();
  assert.equal(relay.sockets().map((ws) => ws.deserializeAttachment()).find((a) => a?.uid === ALICE.id).pt, null, "null puts the pet away");
});

test("co-members see each other's pets, their own included; a Studio that never said pets hears none; a non-member never", async () => {
  const relay = makeRelay();
  const as = api(relay);
  const roomId = await den(relay, as, "tok-bob", "tok-mod");
  const alice = await studio(relay, "tok-alice");
  const bob = await studio(relay, "tok-bob");
  const older = await studio(relay, "tok-mod", { pets: false });
  const cara = await studio(relay, "tok-cara");
  for (const one of [alice, bob, older]) await one.open(roomId);
  await cara.open(roomId);
  assert.equal(cara.of("error").at(-1)?.code, "notMember");
  assert.deepEqual(bob.pets(roomId), [], "opening a room with no pets says so");

  alice.send({ type: "pet", pet: EMBER });
  await until(() => bob.pets(roomId)?.length === 1, "bob sees alice's pet");
  assert.deepEqual(bob.of("roomPets").at(-1), { type: "roomPets", roomId, pets: [{ userId: ALICE.id, name: "Alice", pet: EMBER }] }, "the member's display name, and their pet");
  bob.send({ type: "pet", pet: { kind: "dragon", skin: "theme", name: "Pip" } });
  await until(() => alice.pets(roomId)?.length === 2, "alice sees both");
  assert.deepEqual(alice.pets(roomId), [[ALICE.id, "theme", "Ember"], [BOB.id, "theme", "Pip"]], "the longest out first, the member's own included");
  await settle();
  assert.equal(older.of("roomPets").length, 0, "an older Studio never meets the frame");
  assert.equal(cara.of("roomPets").length, 0, "nor does anyone outside the room");
  assert.equal(older.of("error").length, 0);
});

test("a Studio that opens a room hears its pets at once, not only at the next change, and nobody else hears them twice", async () => {
  const relay = makeRelay();
  const as = api(relay);
  const roomId = await den(relay, as, "tok-bob", "tok-cara");
  const alice = await studio(relay, "tok-alice");
  const bob = await studio(relay, "tok-bob");
  for (const one of [alice, bob]) await one.open(roomId);
  alice.send({ type: "pet", pet: EMBER });
  bob.send({ type: "pet", pet: { ...EMBER, name: "Pip" } });
  await until(() => alice.pets(roomId)?.length === 2, "two pets");
  await settle();
  // Cara has no pet, so the room's list stays the same as she opens it: she hears it straight away all the same.
  const before = alice.of("roomPets").length;
  const cara = await studio(relay, "tok-cara");
  await cara.open(roomId);
  await until(() => cara.pets(roomId)?.length === 2, "cara hears the room's pets as she opens it");
  assert.deepEqual(cara.pets(roomId), [[ALICE.id, "theme", "Ember"], [BOB.id, "theme", "Pip"]]);
  await settle();
  assert.equal(alice.of("roomPets").length, before, "the others already have this list");
  // Opening it again (Rooms reloads) brings a fresh copy too.
  const heard = cara.of("roomPets").length;
  cara.send({ type: "subscribe", roomId });
  await until(() => cara.of("roomPets").length === heard + 1, "a copy for the reload");
});

test("a member who hides from Who's online shares no pet, in any room, until they show again", async () => {
  const relay = makeRelay();
  const as = api(relay);
  const roomId = await den(relay, as, "tok-bob");
  const alice = await studio(relay, "tok-alice");
  const bob = await studio(relay, "tok-bob");
  for (const one of [alice, bob]) { await one.open(roomId); await one.open("lobby"); }
  alice.send({ type: "pet", pet: EMBER });
  bob.send({ type: "pet", pet: { ...EMBER, name: "Pip" } });
  await until(() => alice.pets(roomId)?.length === 2 && alice.pets("lobby")?.length === 2, "both pets in both rooms");
  assert.equal((await as("tok-bob", "POST", "/v1/me/online", { visible: false })).visible, false);
  await until(() => alice.pets(roomId)?.length === 1 && alice.pets("lobby")?.length === 1, "bob's pet gone everywhere");
  assert.deepEqual([alice.pets(roomId), alice.pets("lobby")], [[[ALICE.id, "theme", "Ember"]], [[ALICE.id, "theme", "Ember"]]]);
  bob.send({ type: "pet", pet: { ...EMBER, name: "Pip again" } });
  await settle();
  assert.equal(alice.pets(roomId).length, 1, "a hidden member's new pet stays hidden too");
  await as("tok-bob", "POST", "/v1/me/online", { visible: true });
  await until(() => alice.pets(roomId)?.length === 2, "back when bob shows again");
  assert.deepEqual(alice.pets(roomId)[1], [BOB.id, "theme", "Pip again"]);
});

test("a pet leaves with its member: closing the room, leaving it, or closing Studio", async () => {
  const relay = makeRelay();
  const as = api(relay);
  const roomId = await den(relay, as, "tok-bob", "tok-cara");
  const alice = await studio(relay, "tok-alice");
  const bob = await studio(relay, "tok-bob");
  const cara = await studio(relay, "tok-cara");
  for (const one of [alice, bob, cara]) await one.open(roomId);
  for (const [one, name] of [[alice, "Ember"], [bob, "Pip"], [cara, "Coal"]]) one.send({ type: "pet", pet: { ...EMBER, name } });
  await until(() => alice.pets(roomId)?.length === 3, "three pets");
  bob.send({ type: "unsubscribe", roomId });
  await until(() => alice.pets(roomId)?.length === 2, "bob closed the room");
  await bob.open(roomId);
  await until(() => alice.pets(roomId)?.length === 3 && bob.pets(roomId)?.length === 3, "bob is back, and hears the room's pets");
  assert.equal((await as("tok-cara", "POST", `/v1/rooms/${roomId}/leave`)).status, 200);
  await until(() => alice.pets(roomId)?.length === 2, "cara left the room");
  bob.socket.close();
  await until(() => alice.pets(roomId)?.length === 1, "bob closed Studio");
  assert.deepEqual(alice.pets(roomId), [[ALICE.id, "theme", "Ember"]]);
});

test("a pet lives on the socket only: it survives the relay sleeping, and the store never holds it", async () => {
  const relay = makeRelay();
  const as = api(relay);
  const roomId = await den(relay, as, "tok-bob");
  const alice = await studio(relay, "tok-alice");
  await alice.open(roomId);
  alice.send({ type: "pet", pet: { kind: "dragon", skin: "theme", name: "Sleepy" } });
  await settle();
  assert.ok(!dump(relay).includes("Sleepy"), "no table holds the pet");
  await relay.hibernate();
  const bob = await studio(relay, "tok-bob");
  await bob.open(roomId);
  await until(() => bob.pets(roomId)?.length === 1, "bob hears alice's pet after the relay woke");
  assert.deepEqual(bob.pets(roomId), [[ALICE.id, "theme", "Sleepy"]], "read back from the socket's attachment");
  assert.ok(!dump(relay).includes("Sleepy"));
});

test("six pet frames a minute per socket; past that the frame is refused and the pet stays", async () => {
  const relay = makeRelay();
  const alice = await studio(relay, "tok-alice");
  for (let n = 1; n <= PETS_LIMITS.perMinute + 1; n += 1) alice.send({ type: "pet", pet: { ...EMBER, name: `Ember ${n}` } });
  await until(() => alice.of("error").length === 1, "the seventh refused");
  assert.deepEqual(alice.of("error")[0], { type: "error", code: "rateLimited", message: "pet" });
  await settle();
  assert.equal(relay.sockets().map((ws) => ws.deserializeAttachment()).find((a) => a?.uid === ALICE.id).pt.name, `Ember ${PETS_LIMITS.perMinute}`);
});

test("a Shop skin shows only when its member owns it; the theme's colours otherwise", async () => {
  const relay = makeRelay();
  const as = api(relay);
  const roomId = await den(relay, as, "tok-bob");
  const alice = await studio(relay, "tok-alice");
  const bob = await studio(relay, "tok-bob");
  for (const one of [alice, bob]) await one.open(roomId);
  alice.send({ type: "pet", pet: { ...EMBER, skin: "gold" } });
  await until(() => bob.pets(roomId)?.length === 1, "bob sees alice's pet");
  assert.deepEqual(bob.pets(roomId), [[ALICE.id, "theme", "Ember"]], "a changed Studio cannot show a skin it never got");
  relay.sql("INSERT INTO shop_owned (user_id, item_id, price, at) VALUES (?, 'studio:skin-gold', 60, 1)", ALICE.id);
  alice.send({ type: "pet", pet: { ...EMBER, skin: "gold", name: "Goldie" } });
  await until(() => bob.pets(roomId)?.[0]?.[1] === "gold", "bought, it shows");
  assert.deepEqual(bob.pets(roomId), [[ALICE.id, "gold", "Goldie"]]);
});

test("pets generations: a features list names the newest it knows, a newer kind meets an older side as Ember, and Studio's mirror agrees", () => {
  assert.deepEqual([...PET_KINDS], ["dragon", "cloud", "phoenix", "wisp"]);
  assert.deepEqual(Object.keys(PET_GENERATION), [...PET_KINDS], "every kind has its generation");
  assert.equal(FEATURES.petsGeneration, `pets.${PETS_GENERATION}`);
  assert.deepEqual([[], ["pets"], ["pets", "pets.2"], ["pets.3", "pets"], "pets.2", null].map(petsGenerationOf), [0, 1, 2, 3, 0, 0]);
  const blaze = { kind: "phoenix", skin: "gold", name: "Blaze" };
  assert.deepEqual(petForGeneration(blaze, 1), { kind: "dragon", skin: "gold", name: "Blaze" }, "the skin and the name stay");
  assert.deepEqual(petForGeneration(blaze, 0), { kind: "dragon", skin: "gold", name: "Blaze" }, "a Studio that only said pets is the first generation");
  assert.equal(petForGeneration(blaze, 2), blaze);
  assert.equal(petForGeneration(EMBER, 1), EMBER);
  assert.equal(petForGeneration(null, 1), null);
  assert.deepEqual([...hubClient.PET_KINDS], [...PET_KINDS], "hub-client mirrors the kinds");
  assert.deepEqual({ ...hubClient.PET_GENERATION }, { ...PET_GENERATION }, "and their generations");
  for (const features of [[], ["pets"], ["pets", "pets.2"], ["pets.9"]]) assert.equal(hubClient.petsGenerationOf(features), petsGenerationOf(features));
  assert.ok(hubClient.CLIENT_FEATURES.includes(FEATURES.petsGeneration), "Studio says which pets it draws");
});

test("a Shop pet flies as itself only for a member who owns it; anyone else's shows as Ember", async () => {
  const relay = makeRelay();
  const as = api(relay);
  const roomId = await den(relay, as, "tok-bob");
  const alice = await studio(relay, "tok-alice", { features: ["pets", "pets.2"] });
  const bob = await studio(relay, "tok-bob", { features: ["pets", "pets.2"] });
  for (const one of [alice, bob]) await one.open(roomId);
  const kinds = () => bob.of("roomPets").filter((frame) => frame.roomId === roomId).at(-1)?.pets.map((item) => [item.pet.kind, item.pet.name]) ?? null;
  alice.send({ type: "pet", pet: { kind: "cloud", skin: "theme", name: "Nimbus" } });
  await until(() => kinds()?.length === 1, "bob sees alice's pet");
  assert.deepEqual(kinds(), [["dragon", "Nimbus"]], "a cloud dragon she never got is Ember to everyone else");
  relay.sql("INSERT INTO shop_owned (user_id, item_id, price, at) VALUES (?, 'studio:pet-cloud', 120, 1)", ALICE.id);
  alice.send({ type: "pet", pet: { kind: "cloud", skin: "theme", name: "Nimbus " } });
  await until(() => kinds()?.[0]?.[0] === "cloud", "owned, it shows");
  assert.deepEqual(kinds(), [["cloud", "Nimbus"]]);
  // Owning one Shop pet is not owning another.
  alice.send({ type: "pet", pet: { kind: "wisp", skin: "theme", name: "Flicker" } });
  await until(() => kinds()?.[0]?.[1] === "Flicker", "the next pet");
  assert.deepEqual(kinds(), [["dragon", "Flicker"]]);
  assert.equal(alice.of("error").length, 0);
});

test("the relay names its pets generation in ready; a Studio of an older one sees a Shop pet as Ember, a newer one as itself", async () => {
  const relay = makeRelay();
  const as = api(relay);
  const roomId = await den(relay, as, "tok-bob", "tok-cara");
  relay.sql("INSERT INTO shop_owned (user_id, item_id, price, at) VALUES (?, 'studio:pet-phoenix', 150, 1)", ALICE.id);
  const alice = await studio(relay, "tok-alice", { features: ["pets", "pets.2"] });
  const newer = await studio(relay, "tok-bob", { features: ["pets", "pets.2"] });
  const older = await studio(relay, "tok-cara", { features: ["pets"] });
  assert.ok(alice.of("ready")[0].features.includes("pets.2"), "the relay names the newest pets it knows");
  for (const one of [alice, newer, older]) await one.open(roomId);
  alice.send({ type: "pet", pet: { kind: "phoenix", skin: "theme", name: "Blaze" } });
  const kind = (one) => one.of("roomPets").filter((frame) => frame.roomId === roomId).at(-1)?.pets[0]?.pet.kind;
  await until(() => kind(newer) && kind(older), "both hear it");
  assert.equal(kind(newer), "phoenix");
  assert.equal(kind(older), "dragon", "an older Studio never meets a kind it cannot draw");
  assert.equal(older.of("roomPets").at(-1).pets[0].pet.name, "Blaze");
  // Opening the room again brings its own copy, in its own generation too.
  const heard = older.of("roomPets").length;
  older.send({ type: "subscribe", roomId });
  await until(() => older.of("roomPets").length === heard + 1, "a copy for the reload");
  assert.equal(kind(older), "dragon");
  assert.equal(older.of("error").length + newer.of("error").length, 0);
});

test("Studio's client: a Shop pet its member owns reaches the room as itself", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  await connectAll(alice, bob);
  const made = await alice.client.createRoom({ kind: "hangout", name: "The den", policy: "invite", listed: false });
  const code = await alice.client.roomCode(made.room.id);
  assert.equal((await bob.client.joinCode(code.code)).ok, true);
  const roomId = made.room.id;
  relay.sql("INSERT INTO shop_owned (user_id, item_id, price, at) VALUES (?, 'studio:pet-wisp', 90, 1)", ALICE.id);
  alice.client.subscribe(roomId);
  bob.client.subscribe(roomId);
  assert.equal(alice.client.setPet({ kind: "wisp", skin: "gold", name: "Flicker" }), true);
  const heard = () => bob.of("roomPets").filter((event) => event.roomId === roomId).at(-1)?.pets ?? [];
  await until(() => heard().length === 1, "bob hears alice's pet");
  assert.deepEqual(heard()[0].pet, { kind: "wisp", skin: "theme", name: "Flicker" }, "the wisp she owns (and the theme's colours for the gold she does not)");
  for (const one of [alice, bob]) await one.client.disconnect();
});

test("twelve pets at most in one frame, the longest out first", async () => {
  let clock = Date.now();
  const crowd = Array.from({ length: LIMITS.roomPets + 1 }, (_, n) => ({ token: `tok-p${n}`, user: { id: String(200000000000000100n + BigInt(n)), username: `p${n}`, global_name: `P${n}` } }));
  const relay = makeRelay({ now: () => clock, discord: Object.fromEntries(crowd.map(({ token, user }) => [token, { user }])) });
  const watcher = await studio(relay, "tok-alice");
  await watcher.open("lobby");
  for (const { token } of crowd) {
    clock += 1000;
    const one = await studio(relay, token);
    await one.open("lobby");
    one.send({ type: "pet", pet: { ...EMBER, name: token.slice(4) } });
    await settle();
  }
  await until(() => watcher.pets("lobby")?.length === LIMITS.roomPets, "a full frame");
  assert.deepEqual(watcher.pets("lobby").map(([, , name]) => name), crowd.slice(0, LIMITS.roomPets).map(({ token }) => token.slice(4)), "the thirteenth waits for a place");
});

test("Studio's client: setPet reaches the room as roomPets events, and is said again after a reconnect", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  await connectAll(alice, bob);
  assert.equal(alice.client.status().pets, true, "the relay lists pets in ready.features");
  const made = await alice.client.createRoom({ kind: "hangout", name: "The den", policy: "invite", listed: false });
  const code = await alice.client.roomCode(made.room.id);
  assert.equal((await bob.client.joinCode(code.code)).ok, true);
  const roomId = made.room.id;
  alice.client.subscribe(roomId);
  bob.client.subscribe(roomId);
  assert.equal(alice.client.setPet({ kind: "dragon", skin: "theme", name: "Ember", on: true }), true);
  const heard = () => bob.of("roomPets").filter((event) => event.roomId === roomId).at(-1)?.pets ?? [];
  await until(() => heard().length === 1, "bob hears alice's pet");
  assert.deepEqual(heard(), [{ id: ALICE.id, userId: ALICE.id, name: "Alice", pet: { kind: "dragon", skin: "theme", name: "Ember" } }], "the entry MefiPets.guests() reads, with userId as the relay names it");
  // Alice's connection drops: her pet leaves the room, and comes back with her by itself.
  const server = relay.sockets().find((ws) => ws.deserializeAttachment()?.uid === ALICE.id);
  server.client.close(1006);
  await until(() => heard().length === 0, "alice's pet left with her socket");
  await until(() => heard().length === 1, "after the reconnect her Studio said its pet again", 5000);
  assert.equal(heard()[0].pet.name, "Ember");
  for (const one of [alice, bob]) await one.client.disconnect();
});
