// Mefi's Studio AI+ — this PC's own copy of its rooms' chat.
//
// The Mefi Studio relay passes room messages along and keeps none, so each
// Studio keeps what it saw: the last 500 messages of each room, for 7 days, in
// at most 50 rooms. Friends › Rooms reads its pages from here, and when the
// relay asks this Studio to fill another member's gap (peer history), the
// answer comes from here too. Messages are kept in hub-client.cjs's
// roomMessage shape, including the relay's `sig`, so a copy handed on stays
// checkable. main.cjs ("Rooms hub") owns the file: room-history.json in
// userData, encrypted with the OS keystore, or memory only without one.
//
// Pure module: no Electron, no filesystem, no network. Time is injectable.
//
//   const history = createRoomHistory({ now });
//   history.add(roomId, message)           -> true when it changed something
//   history.remove(roomId, messageId)
//   history.merge(roomId, messages)        -> how many were new or newer
//   history.page(roomId, before, limit)    -> { messages (oldest first), hasMore }
//   history.forgetRoom(roomId) ; history.forgetAll()
//   history.dump() / history.load(json)    -> the file's JSON
//   history.takeDirty()                    -> whether to save, and clears it

"use strict";

const DAY_MS = 86_400_000;
const LIMITS = Object.freeze({ perRoom: 500, maxAgeMs: 7 * DAY_MS, maxRooms: 50, page: 50 });
const SNOWFLAKE = /^\d{17,20}$/;
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_VERSION = 1;

/** Snowflake order: shorter is older, then character by character. */
function compareIds(a, b) {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

const usable = (message) => Boolean(message) && typeof message === "object" && SNOWFLAKE.test(String(message.id)) && Number.isFinite(message.createdAt) && typeof message.text === "string" && SNOWFLAKE.test(String(message.author?.id ?? ""));

function createRoomHistory({ now, limits = {} } = {}) {
  if (typeof now !== "function") throw new TypeError("createRoomHistory needs now()");
  const settings = { ...LIMITS, ...limits };
  const rooms = new Map(); // roomId -> Map(messageId -> message)
  const touched = new Map(); // roomId -> last change, for the room cap
  let dirty = false;

  function roomOf(roomId, create) {
    if (!OPAQUE_ID.test(String(roomId ?? ""))) return null;
    let room = rooms.get(roomId);
    if (!room && create) {
      room = new Map();
      rooms.set(roomId, room);
    }
    return room ?? null;
  }

  function trim(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    const oldest = now() - settings.maxAgeMs;
    for (const [id, message] of room) if (message.createdAt < oldest) room.delete(id);
    if (room.size > settings.perRoom) {
      const ids = [...room.keys()].sort(compareIds);
      for (const id of ids.slice(0, room.size - settings.perRoom)) room.delete(id);
    }
    if (!room.size) {
      rooms.delete(roomId);
      touched.delete(roomId);
    }
    if (rooms.size > settings.maxRooms) {
      const stale = [...touched.entries()].sort((a, b) => a[1] - b[1]).slice(0, rooms.size - settings.maxRooms);
      for (const [id] of stale) {
        rooms.delete(id);
        touched.delete(id);
      }
    }
  }

  /** Keep a message (or a newer edit of one). True when it changed something. */
  function add(roomId, message) {
    if (!usable(message) || message.createdAt < now() - settings.maxAgeMs) return false;
    const room = roomOf(roomId, true);
    if (!room) return false;
    const held = room.get(message.id);
    if (held && (held.editedAt ?? 0) >= (message.editedAt ?? 0)) return false;
    room.set(message.id, message);
    touched.set(roomId, now());
    dirty = true;
    trim(roomId);
    return true;
  }

  function remove(roomId, messageId) {
    const room = roomOf(roomId, false);
    if (!room?.delete(String(messageId))) return false;
    dirty = true;
    if (!room.size) rooms.delete(roomId);
    return true;
  }

  function merge(roomId, messages) {
    let changed = 0;
    for (const message of Array.isArray(messages) ? messages : []) if (add(roomId, message)) changed += 1;
    return changed;
  }

  /** Up to `limit` messages older than `before` (or the latest), oldest first. */
  function page(roomId, before = null, limit = settings.page) {
    const room = roomOf(roomId, false);
    if (!room) return { messages: [], hasMore: false };
    let ids = [...room.keys()].sort(compareIds);
    if (before != null && SNOWFLAKE.test(String(before))) ids = ids.filter((id) => compareIds(id, String(before)) < 0);
    const kept = ids.slice(-Math.max(1, limit));
    return { messages: kept.map((id) => room.get(id)), hasMore: ids.length > kept.length };
  }

  function forgetRoom(roomId) {
    if (rooms.delete(roomId)) dirty = true;
    touched.delete(roomId);
  }

  function forgetAll() {
    if (rooms.size) dirty = true;
    rooms.clear();
    touched.clear();
  }

  function dump() {
    const out = {};
    for (const [roomId, room] of rooms) out[roomId] = [...room.values()].sort((a, b) => compareIds(a.id, b.id));
    return { version: FILE_VERSION, rooms: out };
  }

  function load(json) {
    rooms.clear();
    touched.clear();
    if (!json || json.version !== FILE_VERSION || typeof json.rooms !== "object") return 0;
    let count = 0;
    for (const [roomId, messages] of Object.entries(json.rooms)) count += merge(roomId, messages);
    dirty = false;
    return count;
  }

  return Object.freeze({
    add,
    remove,
    merge,
    page,
    forgetRoom,
    forgetAll,
    dump,
    load,
    rooms: () => [...rooms.keys()],
    takeDirty() {
      const was = dirty;
      dirty = false;
      return was;
    },
  });
}

module.exports = { LIMITS, FILE_VERSION, compareIds, createRoomHistory };
