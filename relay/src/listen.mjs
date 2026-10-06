// Listen together: one shared player per room. The rules are the Void Engine
// hub's src/rooms/listen.mjs; the difference is that a session is written to
// the listen_sessions table, because the relay sleeps between frames and its
// memory goes with it. A session is the link, its label and title, who
// started it, and where the player was at updatedAt.
//
// - start needs url, label and provider, an active room you are a member of,
//   the relay not paused, a session that is not read-only, and 24 h in the
//   server (links-not-allowed). The link must fit its provider (bad-link).
//   Replacing a running session is for its host, the room owner or a
//   moderator (not-yours). 6 starts per 10 minutes per member.
// - play / pause / seek / stop need a session and its host, the owner or a
//   moderator. A locked room allows pause and stop only. About 2 a second.
// - A session ends (published as null) when its host leaves, when the room
//   closes, after 30 minutes paused or 6 hours without an update.

import { LIMITS, LISTEN_PROVIDERS } from './protocol.mjs';
import { cleanMediaText, listenLink } from './media.mjs';
import { HOUR_MS, MINUTE_MS, keyedBuckets, newId } from './util.mjs';

export const LISTEN_LIMITS = Object.freeze({
  startsPerWindow: 6,
  startWindowMs: 10 * MINUTE_MS,
  controlsPerSecond: 2,
  controlBurst: 5,
  pausedIdleMs: 30 * MINUTE_MS,
  maxIdleMs: 6 * HOUR_MS,
});

/** Where the player is at `now`. */
export function estimatePosition(session, now) {
  const at = session.playing ? session.positionMs + Math.max(0, now - session.updatedAt) : session.positionMs;
  return Math.min(LIMITS.listenPositionMaxMs, at);
}

const validPosition = (value) => Number.isSafeInteger(value) && value >= 0 && value <= LIMITS.listenPositionMaxMs;
const nack = (reason, retryAfter) => (Number(retryAfter) > 0 ? { ok: false, reason, retryAfter: Math.min(86_400_000, Math.ceil(retryAfter)) } : { ok: false, reason });

/**
 * createListen({ store, now, oembed, publish(roomId, session|null), roomFor(uid, roomId, {lockedOk}), canManage(room, actor) })
 *   roomFor -> { room } | { refusal } (the room checks shared with chat)
 */
export function createListen({ store, now, oembed, publish, roomFor }) {
  const starts = keyedBuckets({ capacity: LISTEN_LIMITS.startsPerWindow, refillPerSec: LISTEN_LIMITS.startsPerWindow / (LISTEN_LIMITS.startWindowMs / 1000), now });
  const controls = keyedBuckets({ capacity: LISTEN_LIMITS.controlBurst, refillPerSec: LISTEN_LIMITS.controlsPerSecond, now });

  function read(roomId) {
    const row = store.get('SELECT session FROM listen_sessions WHERE room_id = ?', roomId);
    if (!row) return null;
    try {
      return JSON.parse(row.session);
    } catch {
      return null;
    }
  }
  const write = (roomId, session) =>
    store.run('INSERT INTO listen_sessions (room_id, session, updated_at) VALUES (?, ?, ?) ON CONFLICT (room_id) DO UPDATE SET session = excluded.session, updated_at = excluded.updated_at', roomId, JSON.stringify(session), session.updatedAt);
  const expired = (session, at) => {
    const idle = at - session.updatedAt;
    return idle >= LISTEN_LIMITS.maxIdleMs || (!session.playing && idle >= LISTEN_LIMITS.pausedIdleMs);
  };

  function end(roomId) {
    if (!store.get('SELECT 1 AS yes FROM listen_sessions WHERE room_id = ?', roomId)) return false;
    store.run('DELETE FROM listen_sessions WHERE room_id = ?', roomId);
    publish(roomId, null);
    return true;
  }

  /** The room's live session; an idle one ends here. */
  function current(roomId) {
    const session = read(roomId);
    if (!session) return null;
    if (expired(session, now())) {
      end(roomId);
      return null;
    }
    return session;
  }

  const canControl = (session, room, actor) => session.host.id === actor.uid || room.owner_id === actor.uid || actor.isMod;

  async function start(actor, { roomId, url, label, provider, positionMs }) {
    if (typeof url !== 'string' || typeof label !== 'string' || !LISTEN_PROVIDERS.includes(provider)) return nack('bad-request');
    if (positionMs !== undefined && !validPosition(positionMs)) return nack('bad-request');
    const cleanLabel = cleanMediaText(label, LIMITS.listenLabelMax);
    if (!cleanLabel) return nack('bad-request');
    const { room, refusal } = roomFor(actor, roomId, { lockedOk: false, write: true });
    if (refusal) return refusal;
    if (actor.isNew) return nack('links-not-allowed');
    const href = listenLink(url, provider);
    if (!href) return nack('bad-link');
    const existing = current(room.id);
    if (existing && !canControl(existing, room, actor)) return nack('not-yours');
    const rate = starts.take(actor.uid);
    if (!rate.ok) return nack('rate-limited', rate.retryAfterMs);
    const at = now();
    const session = { id: newId('lis'), url: href, label: cleanLabel, title: null, provider, host: { id: actor.uid, name: actor.name }, playing: true, positionMs: positionMs ?? 0, startedAt: at, updatedAt: at };
    write(room.id, session);
    publish(room.id, session);
    return { ok: true, session, follow: () => addTitle(room.id, session) };
  }

  // After a start, never delaying its ack: the provider's title, republished
  // without touching updatedAt or positionMs if the session is still the same.
  async function addTitle(roomId, session) {
    const title = oembed ? await oembed.title(session.provider, session.url) : null;
    if (!title) return;
    const live = read(roomId);
    if (!live || live.id !== session.id) return;
    live.title = title;
    write(roomId, live);
    publish(roomId, live);
  }

  function control(actor, { roomId, action, positionMs }) {
    if (positionMs !== undefined && !validPosition(positionMs)) return nack('bad-request');
    const lockedOk = action === 'pause' || action === 'stop';
    const { room, refusal } = roomFor(actor, roomId, { lockedOk, write: true });
    if (refusal) return refusal;
    const session = current(room.id);
    if (!session) return nack('no-session');
    if (action === 'seek' && positionMs === undefined) return nack('bad-request');
    if (!canControl(session, room, actor)) return nack('not-yours');
    const rate = controls.take(actor.uid);
    if (!rate.ok) return nack('rate-limited', rate.retryAfterMs);
    if (action === 'stop') {
      end(room.id);
      return { ok: true };
    }
    const at = now();
    const position = positionMs ?? estimatePosition(session, at);
    if (action === 'play') session.playing = true;
    else if (action === 'pause') session.playing = false;
    session.positionMs = position;
    session.updatedAt = at;
    write(room.id, session);
    publish(room.id, session);
    return { ok: true, session };
  }

  function handle(actor, frame) {
    if (frame.action === 'start') return start(actor, frame);
    if (['play', 'pause', 'seek', 'stop'].includes(frame.action)) return Promise.resolve(control(actor, frame));
    return Promise.resolve(nack('bad-request'));
  }

  /** The alarm's pass: idle sessions, closed rooms and departed hosts end. -> the next time a session could expire, or null. */
  function sweep() {
    const at = now();
    let next = null;
    for (const row of store.all('SELECT room_id, session FROM listen_sessions')) {
      let session = null;
      try {
        session = JSON.parse(row.session);
      } catch {
        session = null;
      }
      const room = store.get('SELECT status FROM rooms WHERE id = ?', row.room_id);
      const hostIn = session && store.get('SELECT 1 AS yes FROM room_members WHERE room_id = ? AND user_id = ?', row.room_id, session.host.id);
      if (!session || !room || room.status === 'closed' || !hostIn || expired(session, at)) {
        end(row.room_id);
        continue;
      }
      const due = session.updatedAt + (session.playing ? LISTEN_LIMITS.maxIdleMs : LISTEN_LIMITS.pausedIdleMs);
      next = next === null ? due : Math.min(next, due);
    }
    starts.sweep();
    controls.sweep();
    return next;
  }

  return Object.freeze({
    handle,
    current,
    end,
    sweep,
    snapshot: (roomId) => ({ roomId, session: current(roomId), sentAt: now() }),
    /** A member left or was removed: their session ends. */
    memberLeft(roomId, uid) {
      if (read(roomId)?.host.id === uid) end(roomId);
    },
  });
}
