import assert from "node:assert/strict";
import test from "node:test";
import history from "../scripts/room-history.cjs";

// scripts/room-history.cjs: this PC's own copy of its rooms' chat, since the
// relay keeps none (relay/README.md). The limits, edits, deletes, pages and
// the file round trip.

const T0 = 1_800_000_000_000;
const DAY = 86_400_000;
const msg = (n, extra = {}) => ({ id: String(1556701055531801000n + BigInt(n)), author: { id: "200000000000000001", name: "Alice", viaStudio: true }, text: `m${n}`, createdAt: T0 + n, editedAt: null, mentions: [], attachments: [], replyTo: null, truncated: false, sig: "abcdefghijklmnopqrstuv", ...extra });

test("keeps a room's messages oldest first, pages back, and caps each room at 500", () => {
  let now = T0 + 1000;
  const store = history.createRoomHistory({ now: () => now });
  for (let n = 0; n < 520; n += 1) store.add("room_a", msg(n));
  const latest = store.page("room_a");
  assert.equal(latest.messages.length, 50);
  assert.equal(latest.messages.at(-1).text, "m519");
  assert.equal(latest.hasMore, true);
  const older = store.page("room_a", latest.messages[0].id);
  assert.equal(older.messages.at(-1).text, "m469");
  const all = store.page("room_a", null, 1000);
  assert.equal(all.messages.length, 500, "the oldest 20 went");
  assert.equal(all.messages[0].text, "m20");
});

test("edits replace, older copies never overwrite newer ones, deletes remove", () => {
  const store = history.createRoomHistory({ now: () => T0 + 1000 });
  store.add("room_a", msg(1));
  assert.equal(store.add("room_a", msg(1, { text: "edited", editedAt: T0 + 500 })), true);
  assert.equal(store.add("room_a", msg(1)), false, "a stale peer copy does not undo the edit");
  assert.equal(store.page("room_a").messages[0].text, "edited");
  assert.equal(store.merge("room_a", [msg(1), msg(2), msg(3)]), 2);
  assert.equal(store.remove("room_a", msg(2).id), true);
  assert.deepEqual(store.page("room_a").messages.map((m) => m.text), ["edited", "m3"]);
});

test("a week's age limit, a 50-room limit, and forgetting a room or everything", () => {
  let now = T0;
  const store = history.createRoomHistory({ now: () => now, limits: { maxRooms: 3 } });
  for (const room of ["room_a", "room_b", "room_c", "room_d"]) {
    now += 1;
    store.add(room, msg(0, { createdAt: now }));
  }
  assert.deepEqual(store.rooms().sort(), ["room_b", "room_c", "room_d"], "the least recently used room goes");
  now += 8 * DAY;
  store.add("room_b", msg(5, { createdAt: now }));
  assert.deepEqual(store.page("room_b").messages.map((m) => m.text), ["m5"], "a week-old message is dropped");
  assert.equal(store.add("room_b", msg(6, { createdAt: now - 8 * DAY })), false, "and never added");
  store.forgetRoom("room_b");
  assert.equal(store.page("room_b").messages.length, 0);
  store.forgetAll();
  assert.deepEqual(store.rooms(), []);
});

test("the file round trip keeps sigs, refuses junk, and dirty marks when to save", () => {
  const store = history.createRoomHistory({ now: () => T0 + 1000 });
  assert.equal(store.takeDirty(), false);
  store.add("room_a", msg(1));
  store.add("bad id!", msg(2));
  store.add("room_a", { id: "nope", text: "x" });
  assert.equal(store.takeDirty(), true);
  assert.equal(store.takeDirty(), false);
  const copy = history.createRoomHistory({ now: () => T0 + 1000 });
  assert.equal(copy.load(JSON.parse(JSON.stringify(store.dump()))), 1);
  assert.equal(copy.page("room_a").messages[0].sig, "abcdefghijklmnopqrstuv");
  assert.equal(copy.load({ version: 99, rooms: {} }), 0);
  assert.equal(history.compareIds("99", "100"), -1, "shorter ids are older");
});
