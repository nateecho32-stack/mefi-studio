// Pets in rooms (feature "pets"): a member's pet, the dragon that flies around
// their Studio (or a pet from the Shop), visits the rooms they have open, so
// the members there see their pets play together. The relay stores nothing
// for it. The pet ({ kind, skin, name }) rides on its socket's attachment
// (a.pt, with when it was set and since when it has been out), survives the
// relay sleeping as attachments do, and is gone when the socket closes.
//
// Who sees whom. A room's pets are those of its members with Studio open on it
// (a ready socket subscribed to the room, as presence counts them), each
// member once (the pet they set last), never from a member who hides from
// Who's online, at most 12, the longest out first. One roomPets frame carries
// them to the room's Studios that said they understand pets (hello.features
// "pets"), whenever the list changes and to a Studio as it opens the room, so
// an older Studio never meets the frame. A Shop pet or skin shows only when
// its member owns it (Ember, in the theme's colours, otherwise): a changed
// Studio cannot show anyone else a pet it never got. And a Studio whose hello
// names an older pets generation (protocol.mjs PET_GENERATION) sees a newer
// kind as Ember, so it never meets a kind it cannot draw.
//
//   const pets = createPets({ readySockets, sockets, sendFrame, now, members, hidden, owns });
//   pets.set(ws, a, frame)        a pet frame: kept on the socket; the rooms it has open hear the change
//   pets.publish(roomId)          the room's list to its Studios when it changed -> whether it went out
//   pets.welcome(ws, a, roomId)   a socket opened the room and publish() sent nothing: its own copy
//   pets.sweep()                  the alarm's pass over the rate bucket

import { FEATURES, LIMITS, hubFrame, petForGeneration, petsGenerationOf } from './protocol.mjs';
import { cleanLine, keyedBuckets } from './util.mjs';

export const PETS_LIMITS = Object.freeze({
  perMinute: 6, // pet frames per socket; past this one is refused (Studio sends at most one every 10 s)
  roomsRemembered: 1000, // rooms whose last list is kept in memory, so only a change goes out
});

/**
 * createPets({ readySockets() -> [{ ws, a }], sockets: { write(ws, a), send(ws, text) }, sendFrame(ws, type, fields), now,
 *              members(roomId) -> Set of uids, hidden(uid) -> bool, owns(uid, itemId) -> bool })
 *   hidden: the member chose not to show in Who's online; owns: a Shop item is theirs (shop.mjs).
 */
export function createPets({ readySockets, sockets, sendFrame, now, members, hidden, owns }) {
  const taps = keyedBuckets({ capacity: PETS_LIMITS.perMinute, refillPerSec: PETS_LIMITS.perMinute / 60, now });
  const sent = new Map(); // roomId -> the list last sent, as JSON (memory only: after a wake the next one goes anyway)
  const hears = (a) => Array.isArray(a.cf) && a.cf.includes(FEATURES.pets);
  const inRoom = (a, roomId, ids) => Boolean(a.rooms?.includes(roomId)) && ids.has(a.uid);
  // A room's list as a Studio of this pets generation may see it.
  const forGeneration = (pets, generation) => pets.map((item) => ({ ...item, pet: petForGeneration(item.pet, generation) }));

  /** The room's pets, as roomPets carries them. */
  function list(roomId, ready = readySockets()) {
    const ids = members(roomId);
    const latest = new Map(); // uid -> the attachment holding their latest pet in this room
    for (const { a } of ready) {
      if (!a.pt || !inRoom(a, roomId, ids)) continue;
      const was = latest.get(a.uid);
      if (!was || a.pt.at > was.pt.at) latest.set(a.uid, a);
    }
    return [...latest.values()]
      .filter((a) => !hidden(a.uid))
      .sort((x, y) => x.pt.since - y.pt.since || (x.uid < y.uid ? -1 : 1))
      .slice(0, LIMITS.roomPets)
      .map((a) => ({ userId: a.uid, name: a.name || 'member', pet: { kind: a.pt.kind, skin: a.pt.skin, name: a.pt.name } }));
  }

  /** The room's list to its Studios that understand pets, when it changed since the last one sent. -> whether it went. */
  function publish(roomId) {
    const ready = readySockets();
    const pets = list(roomId, ready);
    const json = JSON.stringify(pets);
    if (sent.get(roomId) === json) return false;
    if (sent.size >= PETS_LIMITS.roomsRemembered) sent.clear();
    sent.set(roomId, json);
    const ids = members(roomId);
    // One text per pets generation among the room's Studios, made when the first of them needs it.
    const texts = new Map();
    const textFor = (generation) => {
      if (!texts.has(generation)) texts.set(generation, JSON.stringify(hubFrame('roomPets', { roomId, pets: forGeneration(pets, generation) })));
      return texts.get(generation);
    };
    for (const { ws, a } of ready) if (inRoom(a, roomId, ids) && hears(a)) sockets.send(ws, textFor(petsGenerationOf(a.cf)));
    return true;
  }

  /** A socket opened the room while its list stayed the same: it still needs a copy. */
  function welcome(ws, a, roomId) {
    if (hears(a)) sendFrame(ws, 'roomPets', { roomId, pets: forGeneration(list(roomId), petsGenerationOf(a.cf)) });
  }

  /** pet: this socket's pet, or none. Kept on its attachment only; the rooms it has open hear the change. */
  function set(ws, a, { pet }) {
    if (!taps.take(a.cid).ok) return sendFrame(ws, 'error', { code: 'rateLimited', message: 'pet' });
    const at = now();
    if (pet) {
      // A Shop pet or skin shows only when it is the member's: Ember, and the theme's colours, otherwise.
      const kind = pet.kind === 'dragon' || owns(a.uid, `studio:pet-${pet.kind}`) ? pet.kind : 'dragon';
      const skin = pet.skin === 'theme' || owns(a.uid, `studio:skin-${pet.skin}`) ? pet.skin : 'theme';
      a.pt = { kind, skin, name: cleanLine(pet.name, LIMITS.petNameChars), since: a.pt?.since ?? at, at };
    } else {
      a.pt = null;
    }
    sockets.write(ws, a);
    for (const roomId of a.rooms ?? []) publish(roomId);
    return undefined;
  }

  function sweep() {
    taps.sweep();
  }

  return Object.freeze({ set, publish, welcome, list, sweep });
}
