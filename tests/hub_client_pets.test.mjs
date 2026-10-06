import assert from "node:assert/strict";
import test from "node:test";
import hub from "../scripts/hub-client.cjs";

// scripts/hub-client.cjs's pet against a fake relay, with hand-turned timers:
// setPet takes Studio's pets only, sends one only to a relay that lists
// "pets", says it again after every ready (a reconnect, a Disconnect and a
// new Connect), keeps to the relay's pace (one every 10 s, the latest wins),
// and the relay's roomPets come back as an event in the shape MefiPets.guests()
// reads.

const T0 = 1_800_000_000_000;
const USER = { id: "123456789012345678", name: "Mefi" };
const EMBER = { kind: "dragon", skin: "theme", name: "Ember" };
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((done) => setImmediate(done)); };

function harness() {
  let now = T0;
  let seq = 0;
  let sessions = 0;
  const timers = new Map();
  const events = [];
  const sockets = [];
  class FakeSocket {
    constructor(address) { this.url = address; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close(code = 1000) { this.readyState = 3; this.closedWith = code; }
  }
  const fetch = async (href, init) => {
    const path = new URL(href).pathname;
    const body = init.method === "POST" && path === "/v1/session"
      ? (sessions += 1, { ok: true, session: `hub-session-${sessions}`, expiresAt: now + 15 * 60_000, user: USER })
      : { ok: true };
    return { ok: true, status: 200, json: async () => body };
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
  /** The socket that just opened says ready, listing these relay features. */
  async function ready(features = ["pets"]) {
    socket().readyState = 1;
    socket().onopen?.();
    socket().onmessage?.({ data: JSON.stringify({ type: "ready", user: USER, protocol: 1, features }) });
    await settle();
  }
  const pets = (one = socket()) => one.sent.filter((frame) => frame.type === "pet").map((frame) => frame.pet);
  return { client, events, sockets, socket, ready, advance, pets };
}

test("setPet takes Studio's pets only, its name on one line of 24 at most", () => {
  const h = harness();
  assert.equal(h.client.setPet({ kind: "cat", skin: "theme", name: "Tom" }), false);
  assert.equal(h.client.setPet({ kind: "dragon", skin: "rainbow", name: "x" }), false);
  assert.equal(h.client.setPet("Ember"), false);
  assert.equal(h.client.setPet({ ...EMBER, name: `  Ember \n the\tbrave ${"x".repeat(40)}` }), true);
  assert.deepEqual(hub.petLook({ ...EMBER, name: "  Ember \n the\tbrave  ", extra: 1 }), { kind: "dragon", skin: "theme", name: "Ember the brave" });
  assert.equal(hub.petLook({ ...EMBER, name: "x".repeat(40) }).name.length, 24);
  assert.deepEqual(hub.petLook({ kind: "dragon", skin: "gold" }), { kind: "dragon", skin: "gold", name: "" }, "a pet may have no name");
  assert.equal(h.client.setPet(null), true);
  assert.deepEqual([...hub.PET_SKINS], ["theme", "frost", "jade", "void", "gold"]);
  assert.ok(hub.CLIENT_FEATURES.includes("pets"), "hello tells the relay this Studio understands roomPets");
});

test("the pet goes only to a relay that carries pets, and is said again after every ready", async () => {
  const h = harness();
  h.client.setPet(EMBER);
  await h.client.connect();
  await h.ready(["keepalive"]);
  assert.deepEqual(h.pets(), [], "a relay without pets is never sent one");
  assert.equal(h.client.status().pets, false);

  // The connection drops; the next relay (or the same one, updated) carries pets.
  h.socket().onclose?.({ code: 1006 });
  await h.advance(1000);
  assert.equal(h.sockets.length, 2);
  await h.ready();
  assert.equal(h.client.status().pets, true);
  assert.deepEqual(h.pets(), [EMBER], "said at once after ready");
  // Another drop: the new socket starts without a pet, and is told again straight away.
  h.socket().onclose?.({ code: 1006 });
  await h.advance(1000);
  await h.ready();
  assert.deepEqual(h.pets(h.sockets[2]), [EMBER], "said again after the reconnect, with no wait");
  // A Disconnect and a new Connect: the pet is this Studio's own, so it is still there.
  await h.client.disconnect();
  await h.client.connect();
  await h.ready();
  assert.deepEqual(h.pets(), [EMBER]);
  // No pet: nothing to say after a ready.
  h.client.setPet(null);
  await h.advance(10_000);
  h.socket().onclose?.({ code: 1006 });
  await h.advance(1000);
  await h.ready();
  assert.deepEqual(h.pets(), [], "a new socket starts with none, so null needs no frame");
});

test("only a change goes out, at most one every 10 seconds, and the latest wins", async () => {
  const h = harness();
  await h.client.connect();
  await h.ready();
  h.client.setPet(EMBER);
  assert.deepEqual(h.pets(), [EMBER]);
  h.client.setPet(EMBER);
  h.client.setPet({ ...EMBER, name: "Emb" });
  h.client.setPet({ ...EMBER, name: "Ember the brave", skin: "frost" });
  assert.deepEqual(h.pets(), [EMBER], "a name typed letter by letter waits its turn");
  await h.advance(9_999);
  assert.equal(h.pets().length, 1);
  await h.advance(1);
  assert.deepEqual(h.pets(), [EMBER, { ...EMBER, name: "Ember the brave", skin: "frost" }], "then only the latest goes");
  // Changed and changed back inside the wait: the relay already has it, so nothing more goes.
  h.client.setPet(EMBER);
  h.client.setPet({ ...EMBER, name: "Ember the brave", skin: "frost" });
  await h.advance(20_000);
  assert.equal(h.pets().length, 2);
  h.client.setPet(null);
  assert.deepEqual(h.pets().at(-1), null, "putting the pet away goes too");
});

test("roomPets reach Studio as an event: each member once, at most 12, with id and userId both the member's", async () => {
  const h = harness();
  await h.client.connect();
  await h.ready();
  const pet = (n) => ({ userId: String(200000000000000100n + BigInt(n)), name: `P${n}`, pet: { ...EMBER, name: `Pet ${n}` } });
  const junk = [{ userId: "not-an-id", name: "x", pet: EMBER }, { userId: "200000000000000099", name: "y", pet: { ...EMBER, kind: "cat" } }, pet(0), { ...pet(1), pet: { ...EMBER, name: "Pet 1", skin: "gold", css: "x" } }];
  h.socket().onmessage({ data: JSON.stringify({ type: "roomPets", roomId: "room_a", pets: [...junk, ...Array.from({ length: 12 }, (_, n) => pet(n + 2))] }) });
  h.socket().onmessage({ data: JSON.stringify({ type: "roomPets", roomId: "bad room!", pets: [pet(0)] }) });
  const heard = h.events.filter((event) => event.type === "roomPets");
  assert.equal(heard.length, 1, "a frame for no room is dropped");
  assert.equal(heard[0].roomId, "room_a");
  assert.equal(heard[0].pets.length, 10, "twelve looked at, the junk among them left out");
  assert.deepEqual(heard[0].pets[0], { id: "200000000000000100", userId: "200000000000000100", name: "P0", pet: { kind: "dragon", skin: "theme", name: "Pet 0" } });
  assert.deepEqual(heard[0].pets[1].pet, { kind: "dragon", skin: "gold", name: "Pet 1" }, "only the pet's own fields");
  assert.deepEqual(hub.roomPetsOf([pet(3), pet(3)]).length, 1, "each member once");
  assert.equal(hub.roomPetsOf("x"), null);
  // A relay that never listed pets is not heard about them.
  const old = harness();
  await old.client.connect();
  await old.ready(["keepalive"]);
  old.socket().onmessage({ data: JSON.stringify({ type: "roomPets", roomId: "room_a", pets: [pet(0)] }) });
  assert.equal(old.events.filter((event) => event.type === "roomPets").length, 0);
});
