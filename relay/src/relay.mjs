// The relay's core: every HTTP route and WebSocket frame Studio's
// scripts/hub-client.cjs uses, on one SQLite store and one set of sockets.
// It is platform-free: the Cloudflare Durable Object (hub-object.mjs) and the
// Node test adapter (relay/node/adapter.mjs) hand it the same ports.
//
//   const relay = createRelay({ sql, sockets, alarms, env, fetch, now });
//   await relay.init();
//   relay.http({ method, path, query, headers, bodyText, ip }) -> Promise<{ status, body }>
//   relay.open(ws, { ip }) ; relay.message(ws, data) ; relay.closed(ws) ; relay.alarm()
//
// The rules are the Void Engine hub's (rooms, listen together, claims), minus
// Discord: rooms are the relay's own, chat is passed along and never stored,
// and a member's Discord roles and join date come from their own token at
// sign-in. Two habits keep the single Durable Object consistent: every await
// (Discord, Web Crypto) happens before a handler decides, and each decision is
// one synchronous store transaction.
//
// Socket ports: sockets.list() -> ws[], read(ws) -> attachment, write(ws, a),
// send(ws, text), close(ws, code, reason). An attachment survives the relay
// sleeping; everything in this file's memory does not, and nothing here needs
// it to: rate buckets refill, pending peer-history asks just lapse.

import { createChat, idTime } from './chat.mjs';
import { FRONT, RANKS, createCredits, rankFor } from './credits.mjs';
import { createEconomy } from './economy.mjs';
import { createEvents } from './events.mjs';
import { createLeases } from './leases.mjs';
import { createListen } from './listen.mjs';
import { createOembed, publicLink } from './media.mjs';
import { CLOSE_CODES, FEATURES, LIMITS, NOW_PLAYING_PROVIDERS, PROTOCOL_VERSION, hubFrame, parseClientFrame, validateBody, validateQuery } from './protocol.mjs';
import { createSessions, readConfig, describeMember } from './sessions.mjs';
import { createStore } from './store.mjs';
import { DAY_MS, MINUTE_MS, SECOND_MS, b64url, cleanLine, cleanText, fromB64url, hmac, hmacKey, isOpaqueId, isSnowflake, keyedBuckets, newId, randomBytes } from './util.mjs';

export const WS_LIMITS = Object.freeze({
  socketsPerUser: 5,
  pendingSockets: 200,
  totalSockets: 3000,
  framesPerSecond: LIMITS.framesPerSecond,
  frameBurst: 40,
  roomsPerSocket: 50,
  connectsPerMinute: 10,
  helloTimeoutMs: LIMITS.helloTimeoutMs,
  companionPerSecond: 1,
  companionBurst: 5,
  historyAskEveryMs: 20 * SECOND_MS,
  historyAnswerMs: 20 * SECOND_MS,
});

export const ROOM_LIMITS = Object.freeze({
  maxMembers: Object.freeze({ hangout: 25, cowork: 10 }),
  ownedRooms: 3,
  createsPerDay: 5,
  activeRooms: 200,
  pendingPerRequester: 3,
  requestsPerDay: 10,
  pendingPerRoom: 25,
  invitesPerDay: 20,
  requestTtlMs: 7 * DAY_MS,
  inviteTtlMs: 7 * DAY_MS,
  unlistedMinAgeMs: 7 * DAY_MS, // your own unlisted room: a week in the server
  // A room in the public list: Studio's own rank, earned from credits (credits.mjs), so no Discord role is needed.
  // A moderator, or a Room Host role when ROLE_IDS_JSON names one, may list a room at any rank.
  listedRank: 'flame',
  removedCooldownMs: 30 * DAY_MS,
  postsPer10s: 5,
  postsPerMinute: 30,
  listMax: 100,
});

// The Lobby: one room every signed-in member is in, so there is always
// somewhere to meet without making a room first. Nobody owns it; moderators
// keep it. It cannot be left, locked or closed, and has no join code.
export const LOBBY = Object.freeze({ id: 'lobby', name: 'Lobby', maxMembers: 1000 });

// Join codes: 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L),
// shown as two groups of four.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
export const joinLinkFor = (base, code) => `${base}/join/${code}`;
export const showCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;
export const readCode = (text) => String(text ?? '').toUpperCase().replace(/[\s-]/g, '');

export const HTTP_LIMITS = Object.freeze({
  perUser: { capacity: 60, refillPerSec: 1 },
  sessionMint: { capacity: 10, refillPerSec: 10 / 60 },
  search: { capacity: 10, refillPerSec: 10 / 60 },
  joins: { capacity: 10, refillPerSec: 10 / 60 }, // join-code tries a minute, so codes cannot be guessed
  reports: { capacity: 5, refillPerSec: 5 / 3600 },
  claims: { capacity: 20, refillPerSec: 0.5 },
});

export const RETENTION = Object.freeze({
  decidedMs: 30 * DAY_MS,
  closedRoomMs: 30 * DAY_MS,
  releasedLeaseMs: 7 * DAY_MS,
  tombstoneMs: 7 * DAY_MS,
  reportMs: 30 * DAY_MS,
  auditMs: 90 * DAY_MS,
  idleMemberMs: 730 * DAY_MS,
  maintenanceEveryMs: DAY_MS,
  sweepEveryMs: 15 * MINUTE_MS,
});

/** Links a member who joined under 24 h ago may not post (the hub's rule). */
export const LINK_PATTERN = /(?:\b[a-z][a-z0-9+.-]{1,20}:\/\/\S|\bwww\.[^\s.]+\.\S|\b(?:discord(?:app)?\.(?:gg|com\/invite)|dsc\.gg|t\.me|bit\.ly|tinyurl\.com)\/\S|\[[^\]\n]*\]\([^)\s]+\))/i;

const STATUS_FOR_ERROR = Object.freeze({
  'bad-request': 400,
  unauthorized: 401,
  forbidden: 403,
  'not-member': 403,
  'read-only': 403,
  'not-found': 404,
  'method-not-allowed': 405,
  conflict: 409,
  limit: 409,
  gone: 410,
  'too-large': 413,
  'unsupported-media-type': 415,
  'rate-limited': 429,
  internal: 500,
  paused: 503,
  unavailable: 503,
});

const fail = (error, reason, extra) => ({ ok: false, error, ...(reason ? { reason } : {}), ...(extra ?? {}) });
const nack = (reason, retryAfter) => (Number(retryAfter) > 0 ? { ok: false, reason, retryAfter: Math.min(86_400_000, Math.ceil(retryAfter)) } : { ok: false, reason });
const reply = (status, body) => ({ status, body });

function fromResult(result, okStatus = 200) {
  if (result && result.ok === false) {
    const { ok: _ok, error, ...rest } = result;
    const code = typeof error === 'string' && error ? error : 'internal';
    return reply(STATUS_FOR_ERROR[code] ?? 400, { ok: false, error: code, ...rest });
  }
  return reply(okStatus, { ...(result ?? {}), ok: true });
}

export function createRelay({ sql, sockets, alarms = null, env = {}, fetch: fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const config = readConfig(env);
  const store = createStore(sql);
  let sessions = null;
  let chat = null;
  let leases = null;
  let listen = null;
  let credits = null;
  let economy = null;
  let events = null;
  let alarmAt = undefined; // unknown after a wake
  const oembed = createOembed({ fetch: fetchImpl, now });

  // Memory only (lost when the relay sleeps, which is fine): rate buckets and pending peer-history asks.
  const userCalls = keyedBuckets({ ...HTTP_LIMITS.perUser, now });
  const mints = keyedBuckets({ ...HTTP_LIMITS.sessionMint, now });
  const searches = keyedBuckets({ ...HTTP_LIMITS.search, now });
  const reportsBucket = keyedBuckets({ ...HTTP_LIMITS.reports, now });
  const claimWrites = keyedBuckets({ ...HTTP_LIMITS.claims, now });
  const joinTries = keyedBuckets({ ...HTTP_LIMITS.joins, now });
  const connects = keyedBuckets({ capacity: WS_LIMITS.connectsPerMinute, refillPerSec: WS_LIMITS.connectsPerMinute / 60, now });
  const frames = keyedBuckets({ capacity: WS_LIMITS.frameBurst, refillPerSec: WS_LIMITS.framesPerSecond, now });
  const postsShort = keyedBuckets({ capacity: ROOM_LIMITS.postsPer10s, refillPerSec: ROOM_LIMITS.postsPer10s / 10, now });
  const postsLong = keyedBuckets({ capacity: ROOM_LIMITS.postsPerMinute, refillPerSec: ROOM_LIMITS.postsPerMinute / 60, now });
  const companions = keyedBuckets({ capacity: WS_LIMITS.companionBurst, refillPerSec: WS_LIMITS.companionPerSecond, now });
  const historyAsks = keyedBuckets({ capacity: 1, refillPerSec: 1000 / WS_LIMITS.historyAskEveryMs, now });
  const pendingHistory = new Map(); // requestId -> { askerCid, responderCid, roomId, before, expiresAt }

  // ---- setup -------------------------------------------------------------------

  async function init() {
    store.migrate();
    let secret = store.meta('secret');
    if (!secret) {
      // The relay makes its own key the first time it runs: nobody types or holds a secret.
      secret = b64url(randomBytes(32));
      store.setMeta('secret', secret);
    }
    const master = await hmacKey(fromB64url(secret));
    const derive = async (label) => hmacKey(await hmac(master, label));
    const keys = { session: await derive('session v1'), token: await derive('token-cache v1'), message: await derive('message v1'), play: await derive('play v1') };
    sessions = createSessions({ store, keys, config, fetch: fetchImpl, now });
    chat = createChat({ key: keys.message, now });
    leases = createLeases({ store, clock: { now }, isRoomMember: (roomId, uid) => isMember(roomId, uid) });
    listen = createListen({ store, now, oembed, publish: (roomId, session) => publishRoom(roomId, 'listen', { roomId, session, sentAt: now() }), roomFor });
    economy = createEconomy({ store, now });
    credits = createCredits({ store, now, key: keys.play, sendToUser, member: (uid) => sessions.member(uid), economy });
    credits.routes(route);
    // Community events the relay runs by itself (events.mjs): the weekly Build Jam, co-work hours, building together.
    events = createEvents({ store, now, credits, economy, paused, rooms: { present: presentIn, online: onlineIn, open: openEventRoom, join: joinDirect, close: (roomId) => setStatus({ uid: null, isMod: true }, roomId, 'closed'), member: isMember } });
    events.routes(route);
    const at = now();
    store.run(
      `INSERT INTO rooms (id, kind, name, owner_id, policy, listed, max_members, status, member_count, created_at, updated_at)
         VALUES (?, 'hangout', ?, NULL, 'request', 1, ?, 'active', 0, ?, ?) ON CONFLICT (id) DO NOTHING`,
      LOBBY.id,
      LOBBY.name,
      LOBBY.maxMembers,
      at,
      at,
    );
  }

  /** Every signed-in member is in the Lobby, unless a moderator removed them lately. */
  function joinLobby(uid) {
    if (!isSnowflake(uid) || store.get('SELECT 1 AS yes FROM room_members WHERE room_id = ? AND user_id = ?', LOBBY.id, uid)) return false;
    const at = now();
    return store.transaction(() => {
      const lobby = roomRow(LOBBY.id);
      if (!lobby || lobby.member_count >= lobby.max_members) return false;
      if (store.get('SELECT 1 AS yes FROM removals WHERE room_id = ? AND user_id = ? AND at > ?', LOBBY.id, uid, at - ROOM_LIMITS.removedCooldownMs)) return false;
      store.run('INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', LOBBY.id, uid, 'member', at);
      store.run('UPDATE rooms SET member_count = member_count + 1, updated_at = ? WHERE id = ?', at, LOBBY.id);
      return true;
    });
  }
  const onlineHidden = (uid) => store.get('SELECT online_hidden FROM members WHERE user_id = ?', uid)?.online_hidden === 1;

  const paused = () => config.paused || store.meta('paused') === 'true';
  const features = () => [FEATURES.companion, FEATURES.companionDirect, FEATURES.historyPeer, FEATURES.keepalive, FEATURES.messagesSigned, FEATURES.lobby, FEATURES.joinCodes, FEATURES.online, FEATURES.credits, FEATURES.projects, FEATURES.front, FEATURES.friendOnline, FEATURES.building, FEATURES.events];

  // ---- rooms in the store --------------------------------------------------------

  const roomRow = (roomId) => (isOpaqueId(roomId) ? store.get('SELECT * FROM rooms WHERE id = ?', roomId) : undefined);
  // Whether a member's Studio rank (from lifetime credits, worked out here) is at least `key`.
  function rankAtLeast(uid, key) {
    const order = RANKS.map((rank) => rank.key);
    return order.indexOf(rankFor(credits.account(uid).lifetime).key) >= order.indexOf(key);
  }

  function isMember(roomId, uid) {
    if (!isOpaqueId(roomId) || !isSnowflake(uid)) return false;
    return Boolean(store.get(`SELECT 1 AS yes FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE m.room_id = ? AND m.user_id = ? AND r.status <> 'closed'`, roomId, uid));
  }
  const memberIds = (roomId) => new Set(store.all('SELECT user_id FROM room_members WHERE room_id = ?', roomId).map((row) => row.user_id));
  const nameOf = (uid) => store.get('SELECT name FROM members WHERE user_id = ?', uid)?.name ?? 'member';
  const userView = (uid) => ({ id: uid, name: nameOf(uid) });

  function summary(row, uid = null) {
    if (!row) return null;
    const out = {
      id: row.id,
      kind: row.kind,
      name: row.name,
      policy: row.policy,
      listed: row.listed === 1,
      status: row.status,
      ownerId: row.owner_id ?? null,
      memberCount: row.member_count,
      maxMembers: row.max_members,
      threadId: null,
      createdAt: row.created_at,
    };
    if (uid) {
      const role = store.get('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?', row.id, uid)?.role;
      if (role) out.you = role === 'owner' ? 'owner' : 'member';
      else if (store.get(`SELECT 1 AS yes FROM invites WHERE room_id = ? AND invitee_id = ? AND status = 'pending' AND expires_at > ?`, row.id, uid, now())) out.you = 'invited';
      else if (store.get(`SELECT 1 AS yes FROM join_requests WHERE room_id = ? AND requester_id = ? AND status = 'pending' AND created_at > ?`, row.id, uid, now() - ROOM_LIMITS.requestTtlMs)) out.you = 'requested';
      else out.you = 'none';
    }
    return out;
  }

  const lapsed = (row) => row.status === 'pending' && now() - row.created_at >= ROOM_LIMITS.requestTtlMs;
  function requestView(row) {
    return { id: row.id, roomId: row.room_id, requester: userView(row.requester_id), note: row.note ?? '', status: lapsed(row) ? 'cancelled' : row.status, createdAt: row.created_at, decidedAt: row.decided_at ?? null };
  }
  function inviteView(row, roomName) {
    const expired = row.status === 'pending' && row.expires_at <= now();
    return { id: row.id, roomId: row.room_id, roomName: roomName ?? roomRow(row.room_id)?.name ?? 'room', invitedBy: userView(row.invited_by), status: expired ? 'expired' : row.status, expiresAt: row.expires_at };
  }

  /** The room checks chat, listen and companions share: { room } or { refusal } (a nack). */
  function roomFor(actor, roomId, { lockedOk = false, write = false } = {}) {
    if (write && paused()) return { refusal: nack('paused') };
    if (write && actor.readOnly) return { refusal: nack('read-only') };
    const room = roomRow(roomId);
    if (!room || room.status === 'closed') return { refusal: nack('not-found') };
    if (!isMember(room.id, actor.uid)) return { refusal: nack('not-member') };
    if (!lockedOk && room.status === 'locked') return { refusal: nack('locked') };
    return { room };
  }

  // ---- sockets -------------------------------------------------------------------

  function allSockets() {
    const out = [];
    for (const ws of sockets.list()) {
      const a = sockets.read(ws);
      if (a && a.s !== 'closed') out.push({ ws, a });
    }
    return out;
  }
  const readySockets = () => allSockets().filter((entry) => entry.a.s === 'ready');
  const byCid = (cid) => allSockets().find((entry) => entry.a.cid === cid) ?? null;

  function sendFrame(ws, type, fields) {
    sockets.send(ws, JSON.stringify(hubFrame(type, fields)));
  }

  /** A frame to every subscribed socket of the room's members (except one socket, by cid). */
  function publishRoom(roomId, type, fields, { exceptCid = null, onlyUid = null } = {}) {
    const members = memberIds(roomId);
    const text = JSON.stringify(hubFrame(type, fields));
    let sent = 0;
    for (const { ws, a } of readySockets()) {
      if (a.cid === exceptCid || !a.rooms?.includes(roomId) || !members.has(a.uid)) continue;
      if (onlyUid && a.uid !== onlyUid) continue;
      sockets.send(ws, text);
      sent += 1;
    }
    return sent;
  }

  function sendToUser(uid, type, fields) {
    const text = JSON.stringify(hubFrame(type, fields));
    for (const { ws, a } of readySockets()) if (a.uid === uid) sockets.send(ws, text);
  }

  /** Members with the room open in Studio right now (a ready socket subscribed to it). */
  function presentIn(roomId) {
    const members = memberIds(roomId);
    return [...new Set(readySockets().filter(({ a }) => a.rooms?.includes(roomId) && members.has(a.uid)).map(({ a }) => a.uid))];
  }

  /** Members of the room with Studio connected right now, on any page. */
  function onlineIn(roomId) {
    const members = memberIds(roomId);
    return [...new Set(readySockets().filter(({ a }) => members.has(a.uid)).map(({ a }) => a.uid))];
  }

  /**
   * A co-work room the relay itself opens for an event (events.mjs). Nobody owns it and it is not in the
   * room list (a request to join would go to nobody): Friends › Events joins it straight away.
   */
  function openEventRoom({ name, maxMembers }) {
    const id = newId('room');
    const at = now();
    store.run(
      `INSERT INTO rooms (id, kind, name, owner_id, policy, listed, max_members, status, member_count, created_at, updated_at) VALUES (?, 'cowork', ?, NULL, 'request', 0, ?, 'active', 0, ?, ?)`,
      id, cleanLine(name, LIMITS.roomNameChars), maxMembers, at, at,
    );
    return id;
  }

  /** Joining an event's room straight away, by the join code's rules. -> { ok } | { ok: false, status, error, reason } */
  function joinDirect(roomId, uid) {
    const at = now();
    const result = store.transaction(() => {
      const room = roomRow(roomId);
      if (!room || room.status === 'closed') return { ok: false, status: 404, error: 'not-found' };
      if (isMember(room.id, uid)) return { ok: true, unchanged: true };
      if (room.status === 'locked') return { ok: false, status: 409, error: 'conflict', reason: 'locked' };
      if (store.get('SELECT 1 AS yes FROM removals WHERE room_id = ? AND user_id = ? AND at > ?', room.id, uid, at - ROOM_LIMITS.removedCooldownMs)) return { ok: false, status: 403, error: 'forbidden', reason: 'removed' };
      if (room.member_count >= room.max_members) return { ok: false, status: 409, error: 'limit', reason: 'room-full' };
      store.run('INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', room.id, uid, 'member', at);
      store.run('UPDATE rooms SET member_count = member_count + 1, updated_at = ? WHERE id = ?', at, room.id);
      return { ok: true };
    });
    if (result.ok && !result.unchanged) {
      publishRoom(roomId, 'membership', { roomId, userId: uid, state: 'joined' });
      sendToUser(uid, 'membership', { roomId, userId: uid, state: 'joined' });
    }
    return result;
  }

  function publishPresence(roomId) {
    const members = memberIds(roomId);
    let inStudio = [...new Set(readySockets().filter(({ a }) => a.rooms?.includes(roomId) && members.has(a.uid)).map(({ a }) => a.uid))];
    if (roomId === LOBBY.id) inStudio = inStudio.filter((uid) => !onlineHidden(uid));
    publishRoom(roomId, 'presence', { roomId, inStudio });
  }

  /** Take a room off a member's sockets (they left, were removed, or it closed). */
  function dropRoom(roomId, uid = null) {
    for (const { ws, a } of readySockets()) {
      if (!a.rooms?.includes(roomId) || (uid && a.uid !== uid)) continue;
      a.rooms = a.rooms.filter((id) => id !== roomId);
      sockets.write(ws, a);
    }
  }

  function closeUser(uid, code, reason) {
    for (const { ws, a } of allSockets()) {
      if (a.uid !== uid) continue;
      a.s = 'closed';
      sockets.write(ws, a);
      sockets.close(ws, code, reason);
    }
  }

  function publishClaims(roomId) {
    if (!roomId) return;
    publishRoom(roomId, 'claims', { roomId, leases: leases.list(roomId) });
  }

  // ---- alarms --------------------------------------------------------------------

  /** The earliest time the alarm must run: a lease or listen expiry, the sweep, the daily upkeep. */
  function nextDue() {
    const at = now();
    const candidates = [];
    const lease = store.get('SELECT MIN(expires_at) AS t FROM leases WHERE released_at IS NULL AND expires_at > ?', at)?.t;
    if (Number.isFinite(lease)) candidates.push(lease + SECOND_MS);
    for (const row of store.all('SELECT session FROM listen_sessions')) {
      try {
        const session = JSON.parse(row.session);
        candidates.push(session.updatedAt + (session.playing ? 6 * 3_600_000 : 30 * MINUTE_MS) + SECOND_MS);
      } catch {
        candidates.push(at + MINUTE_MS);
      }
    }
    if (sockets.list().length > 0) candidates.push(at + RETENTION.sweepEveryMs);
    const lastUpkeep = Number(store.meta('upkeep_at') ?? 0);
    candidates.push(Math.max(at + MINUTE_MS, lastUpkeep + RETENTION.maintenanceEveryMs));
    const eventsDue = events?.nextDue();
    if (Number.isFinite(eventsDue)) candidates.push(eventsDue);
    return Math.max(at + SECOND_MS, Math.min(...candidates));
  }

  async function schedule() {
    if (!alarms) return;
    const due = nextDue();
    if (alarmAt === undefined) alarmAt = (await alarms.get()) ?? null;
    if (alarmAt === null || alarmAt > due || alarmAt < now()) {
      alarmAt = due;
      await alarms.set(due);
    }
  }

  function upkeep() {
    const at = now();
    store.transaction(() => {
      store.run('DELETE FROM revoked WHERE until < ?', at);
      store.run('DELETE FROM token_cache WHERE expires_at < ?', at);
      store.run(`DELETE FROM join_requests WHERE (status <> 'pending' AND COALESCE(decided_at, created_at) < ?) OR created_at < ?`, at - RETENTION.decidedMs, at - ROOM_LIMITS.requestTtlMs - RETENTION.decidedMs);
      store.run(`DELETE FROM invites WHERE (status <> 'pending' AND COALESCE(decided_at, created_at) < ?) OR expires_at < ?`, at - RETENTION.decidedMs, at - RETENTION.decidedMs);
      store.run('DELETE FROM removals WHERE at < ?', at - ROOM_LIMITS.removedCooldownMs);
      for (const row of store.all(`SELECT id FROM rooms WHERE status = 'closed' AND closed_at < ?`, at - RETENTION.closedRoomMs)) deleteRoomRows(row.id);
      store.run('DELETE FROM leases WHERE released_at IS NOT NULL AND released_at < ?', at - RETENTION.releasedLeaseMs);
      store.run('DELETE FROM tombstones WHERE at < ?', at - RETENTION.tombstoneMs);
      store.run('DELETE FROM reports WHERE created_at < ?', at - RETENTION.reportMs);
      store.run('DELETE FROM audit WHERE at < ?', at - RETENTION.auditMs);
      store.run(`DELETE FROM room_members WHERE room_id = 'lobby' AND user_id IN (SELECT user_id FROM members WHERE last_seen < ?) AND user_id NOT IN (SELECT user_id FROM room_members WHERE room_id <> 'lobby')`, at - RETENTION.idleMemberMs);
      store.run(`UPDATE rooms SET member_count = (SELECT COUNT(*) FROM room_members WHERE room_id = 'lobby') WHERE id = 'lobby'`);
      store.run(`DELETE FROM members WHERE last_seen < ? AND user_id NOT IN (SELECT user_id FROM room_members)`, at - RETENTION.idleMemberMs);
      store.run(`DELETE FROM room_codes WHERE room_id NOT IN (SELECT id FROM rooms WHERE status <> 'closed')`);
      credits.upkeep();
      events.upkeep();
      economy.upkeep();
      store.setMeta('upkeep_at', at);
    });
  }

  function deleteRoomRows(roomId) {
    for (const table of ['room_members', 'join_requests', 'invites', 'removals', 'listen_sessions', 'leases', 'fences', 'tombstones', 'room_codes']) store.run(`DELETE FROM ${table} WHERE room_id = ?`, roomId);
    store.run('DELETE FROM rooms WHERE id = ?', roomId);
  }

  async function alarm() {
    alarmAt = null;
    const at = now();
    // Sockets that never said hello, and sessions long past their expiry (a Studio that stopped renewing).
    for (const { ws, a } of allSockets()) {
      if (a.s === 'pending' && at - a.at >= WS_LIMITS.helloTimeoutMs) closeSocket(ws, a, CLOSE_CODES.helloTimeout, 'hello timeout');
      else if (a.s === 'ready' && a.exp + 2 * MINUTE_MS < at) closeSocket(ws, a, CLOSE_CODES.sessionExpired, 'session expired');
    }
    const swept = leases.expireSweep(at);
    for (const roomId of swept.roomIds) publishClaims(roomId);
    listen.sweep();
    for (const [id, ask] of pendingHistory) if (ask.expiresAt <= at) pendingHistory.delete(id);
    if (at - Number(store.meta('upkeep_at') ?? 0) >= RETENTION.maintenanceEveryMs) upkeep();
    // The community events never stop the rest of the alarm: a fault there waits for the next one.
    if (!paused()) {
      try {
        await events.tick();
      } catch {
        // logged nowhere on purpose (the relay keeps no logs); the next alarm tries again
      }
    }
    for (const bucket of [userCalls, mints, searches, reportsBucket, claimWrites, connects, frames, postsShort, postsLong, companions, historyAsks]) bucket.sweep();
    await schedule();
  }

  // ---- WebSocket -----------------------------------------------------------------

  function closeSocket(ws, a, code, reason) {
    const rooms = a?.rooms ?? [];
    if (a) {
      a.s = 'closed';
      sockets.write(ws, a);
    }
    sockets.close(ws, code, reason);
    for (const roomId of rooms) publishPresence(roomId);
  }

  /** A socket was accepted. -> false when it was turned away (the caller closes it). */
  function open(ws, { ip = '' } = {}) {
    const all = allSockets();
    if (all.length >= WS_LIMITS.totalSockets || all.filter(({ a }) => a.s === 'pending').length >= WS_LIMITS.pendingSockets) {
      sockets.close(ws, CLOSE_CODES.tooManySockets, 'busy');
      return false;
    }
    if (ip && !connects.take(`ip:${ip}`).ok) {
      sockets.close(ws, CLOSE_CODES.rateLimited, 'too many connects');
      return false;
    }
    sockets.write(ws, { v: 1, s: 'pending', cid: newId('c'), at: now(), rooms: [] });
    return true;
  }

  // One socket's frames are handled in the order they came: a handler that
  // awaits (Web Crypto, an oEmbed lookup) must not let the next frame overtake it.
  const chains = new Map(); // cid -> the promise of its latest frame
  function message(ws, data) {
    const a = sockets.read(ws);
    if (!a || a.s === 'closed') return Promise.resolve();
    const run = (chains.get(a.cid) ?? Promise.resolve()).then(() => handleFrame(ws, data)).catch(() => {});
    chains.set(a.cid, run);
    run.finally(() => {
      if (chains.get(a.cid) === run) chains.delete(a.cid);
    });
    return run;
  }

  async function handleFrame(ws, data) {
    const a = sockets.read(ws);
    if (!a || a.s === 'closed') return;
    if (!frames.take(a.cid).ok) return closeSocket(ws, a, CLOSE_CODES.rateLimited, 'too many frames');
    const parsed = parseClientFrame(typeof data === 'string' ? data : new Uint8Array(data));
    if (!parsed.ok) {
      if (parsed.code === 'tooLarge') return closeSocket(ws, a, CLOSE_CODES.tooLarge, 'frame too large');
      if (a.s === 'pending') return closeSocket(ws, a, CLOSE_CODES.unauthorized, 'hello first');
      return sendFrame(ws, 'error', { code: 'badFrame' });
    }
    const frame = parsed.frame;
    if (frame.type === 'ping') return sendFrame(ws, 'pong', {});
    if (a.s === 'pending') {
      if (frame.type !== 'hello') return closeSocket(ws, a, CLOSE_CODES.unauthorized, 'hello first');
      return hello(ws, a, frame);
    }
    if (frame.type === 'hello') return sendFrame(ws, 'error', { code: 'badFrame', message: 'already said hello' });
    if (frame.type === 'renew') return renew(ws, a, frame);
    if (a.exp <= now()) return closeSocket(ws, a, CLOSE_CODES.sessionExpired, 'session expired');
    const actor = actorOf(a);
    switch (frame.type) {
      case 'subscribe':
        return subscribe(ws, a, frame.roomId);
      case 'unsubscribe':
        return unsubscribe(ws, a, frame.roomId);
      case 'presence':
        return undefined; // presence follows subscriptions; the beat only keeps an old Studio's socket busy
      case 'send':
        return answer(ws, frame.nonce, await send(actor, frame));
      case 'edit':
        return answer(ws, frame.nonce, await edit(actor, frame));
      case 'delete':
        return answer(ws, frame.nonce, await remove(actor, frame));
      case 'listen': {
        const result = await listen.handle(actor, frame);
        answer(ws, frame.nonce, result);
        if (result.ok && typeof result.follow === 'function') await result.follow();
        return await schedule();
      }
      case 'nowPlaying':
        return nowPlaying(ws, a, frame.track);
      case 'building':
        return building(ws, a, frame.now);
      case 'companion':
        return companion(ws, a, frame);
      case 'historyRequest':
        return answer(ws, frame.nonce, historyAsk(ws, a, frame));
      case 'historyReply':
        return historyReply(ws, a, frame);
      default:
        return sendFrame(ws, 'error', { code: 'badFrame', message: `${frame.type} is not carried by this relay` });
    }
  }

  function answer(ws, nonce, result) {
    if (!nonce) return;
    if (result?.ok) sendFrame(ws, 'ack', result.messageId ? { nonce, messageId: result.messageId } : { nonce });
    else sendFrame(ws, 'nack', result?.retryAfter ? { nonce, reason: result.reason ?? 'failed', retryAfter: result.retryAfter } : { nonce, reason: result?.reason ?? 'failed' });
  }

  function actorOf(a) {
    return { uid: a.uid, name: a.name, readOnly: a.ro === 1, isMod: a.mod === 1, isNew: !Number.isFinite(a.j) || now() - a.j < DAY_MS, cid: a.cid };
  }

  async function hello(ws, a, frame) {
    if (frame.protocol !== PROTOCOL_VERSION) return closeSocket(ws, a, CLOSE_CODES.versionMismatch, 'protocol version');
    const verdict = await sessions.verify(frame.session);
    if (!verdict.ok) return closeSocket(ws, a, verdict.error === 'expired' ? CLOSE_CODES.sessionExpired : CLOSE_CODES.unauthorized, 'session');
    const { claims } = verdict;
    const member = sessions.member(claims.uid);
    if (!member) return closeSocket(ws, a, CLOSE_CODES.unauthorized, 'unknown member');
    const mine = readySockets().filter((entry) => entry.a.uid === claims.uid).length;
    if (mine >= WS_LIMITS.socketsPerUser) return closeSocket(ws, a, CLOSE_CODES.tooManySockets, 'too many sockets');
    joinLobby(claims.uid);
    Object.assign(a, { s: 'ready', uid: claims.uid, sid: claims.sid, exp: claims.exp, ro: claims.readOnly || member.readOnly ? 1 : 0, name: member.name, mod: member.isMod ? 1 : 0, j: member.joinedAt, rooms: [], cf: frame.features ?? [], np: null });
    sockets.write(ws, a);
    sendReady(ws, a);
    if (!mine) announceOnline(claims.uid, member.name);
    await schedule();
  }

  // Someone just opened Studio (their first socket): told to the people they
  // share a room with, never the Lobby's whole crowd, never when they hide
  // from Who's online, at most once every 30 minutes per pair, and only to
  // Studios that said they understand friendOnline.
  const announced = new Map(); // "uid>friend" -> when
  function announceOnline(uid, name) {
    if (onlineHidden(uid)) return;
    const friends = new Set(store.all(
      `SELECT DISTINCT b.user_id AS id FROM room_members a JOIN room_members b ON b.room_id = a.room_id JOIN rooms r ON r.id = a.room_id
        WHERE a.user_id = ? AND b.user_id <> ? AND a.room_id <> ? AND r.status <> 'closed'`,
      uid,
      uid,
      LOBBY.id,
    ).map((row) => row.id));
    if (!friends.size) return;
    const at = now();
    if (announced.size > 5000) announced.clear();
    const told = new Set();
    for (const { ws, a } of readySockets()) {
      if (!friends.has(a.uid) || !(a.cf ?? []).includes(FEATURES.friendOnline)) continue;
      const key = `${uid}>${a.uid}`;
      if (!told.has(a.uid) && at - (announced.get(key) ?? 0) < 30 * MINUTE_MS) continue;
      told.add(a.uid);
      announced.set(key, at);
      sendFrame(ws, 'friendOnline', { user: { id: uid, name } });
    }
  }

  function sendReady(ws, a) {
    sendFrame(ws, 'ready', { user: { id: a.uid, name: a.name }, protocol: PROTOCOL_VERSION, paused: paused(), readOnly: a.ro === 1, features: features() });
  }

  async function renew(ws, a, frame) {
    const verdict = await sessions.verify(frame.session);
    if (!verdict.ok) return closeSocket(ws, a, verdict.error === 'expired' ? CLOSE_CODES.sessionExpired : CLOSE_CODES.unauthorized, 'session');
    if (verdict.claims.uid !== a.uid) return closeSocket(ws, a, CLOSE_CODES.unauthorized, 'another member');
    const member = sessions.member(a.uid);
    Object.assign(a, { sid: verdict.claims.sid, exp: verdict.claims.exp, ro: verdict.claims.readOnly || member?.readOnly ? 1 : 0, name: member?.name ?? a.name, mod: member?.isMod ? 1 : 0, j: member?.joinedAt ?? a.j });
    sockets.write(ws, a);
    sendReady(ws, a);
  }

  function subscribe(ws, a, roomId) {
    const room = roomRow(roomId);
    if (!room || room.status === 'closed' || !isMember(roomId, a.uid)) return sendFrame(ws, 'error', { code: 'notMember', message: roomId });
    if (!a.rooms.includes(roomId)) {
      if (a.rooms.length >= WS_LIMITS.roomsPerSocket) return sendFrame(ws, 'error', { code: 'rateLimited', message: 'too many rooms on one socket' });
      a.rooms = [...a.rooms, roomId];
      sockets.write(ws, a);
    }
    publishPresence(roomId);
    sendFrame(ws, 'listen', listen.snapshot(roomId));
    if (room.kind === 'cowork') sendFrame(ws, 'claims', { roomId, leases: leases.list(roomId) });
    return undefined;
  }

  function unsubscribe(ws, a, roomId) {
    if (!a.rooms.includes(roomId)) return;
    a.rooms = a.rooms.filter((id) => id !== roomId);
    sockets.write(ws, a);
    publishPresence(roomId);
  }

  function closed(ws) {
    const a = sockets.read(ws);
    if (!a || a.s === 'closed') return;
    const rooms = a.rooms ?? [];
    a.s = 'closed';
    sockets.write(ws, a);
    for (const roomId of rooms) publishPresence(roomId);
  }

  // ---- chat ----------------------------------------------------------------------

  async function send(actor, { roomId, text }) {
    const { refusal } = roomFor(actor, roomId, { write: true });
    if (refusal) return refusal;
    const body = cleanText(text, LIMITS.textChars);
    if (!body) return nack('bad-request');
    if (actor.isNew && LINK_PATTERN.test(body)) return nack('links-not-allowed');
    const short = postsShort.take(actor.uid);
    if (!short.ok) return nack('rate-limited', short.retryAfterMs);
    const long = postsLong.take(actor.uid);
    if (!long.ok) return nack('rate-limited', long.retryAfterMs);
    const id = await chat.makeId(roomId, actor.uid);
    const messageOut = await chat.build(roomId, { id, author: { id: actor.uid, name: actor.name }, text: body });
    publishRoom(roomId, 'message', { roomId, message: messageOut });
    return { ok: true, messageId: id };
  }

  async function edit(actor, { roomId, messageId, text }) {
    const { refusal } = roomFor(actor, roomId, { write: true });
    if (refusal) return refusal;
    const body = cleanText(text, LIMITS.textChars);
    if (!body) return nack('bad-request');
    if (actor.isNew && LINK_PATTERN.test(body)) return nack('links-not-allowed');
    if (!(await chat.isAuthor(messageId, roomId, actor.uid))) return nack('not-yours');
    if (store.get('SELECT 1 AS yes FROM tombstones WHERE message_id = ?', messageId)) return nack('not-found');
    const messageOut = await chat.build(roomId, { id: messageId, author: { id: actor.uid, name: actor.name }, text: body, editedAt: now() });
    publishRoom(roomId, 'messageUpdate', { roomId, message: messageOut });
    return { ok: true, messageId };
  }

  async function remove(actor, { roomId, messageId }) {
    const { room, refusal } = roomFor(actor, roomId, { write: true, lockedOk: true });
    if (refusal) return refusal;
    const own = await chat.isAuthor(messageId, roomId, actor.uid);
    if (!own && room.owner_id !== actor.uid && !actor.isMod) return nack('not-yours');
    store.transaction(() => {
      store.run('INSERT INTO tombstones (message_id, room_id, at) VALUES (?, ?, ?) ON CONFLICT (message_id) DO NOTHING', messageId, roomId, now());
      if (!own) store.run('INSERT INTO audit (kind, actor_id, room_id, detail, at) VALUES (?, ?, ?, ?, ?)', 'message-delete', actor.uid, roomId, JSON.stringify({ messageId }), now());
    });
    publishRoom(roomId, 'messageDelete', { roomId, messageId });
    return { ok: true, messageId };
  }

  // ---- now playing, companions, peer history --------------------------------------

  function nowPlaying(ws, a, track) {
    if (track === null) a.np = null;
    else {
      if (!NOW_PLAYING_PROVIDERS.includes(track.provider)) return;
      const label = cleanLine(track.label, LIMITS.listenLabelMax);
      if (!label) return;
      const url = track.url ? publicLink(track.url) : null;
      a.np = { label, provider: track.provider, ...(url ? { url } : {}), since: now() };
    }
    sockets.write(ws, a);
  }

  // What a member is building, with their say-so: kept on the socket only, gone when it closes.
  function building(ws, a, value) {
    const project = value ? cleanLine(value.project, 80) : '';
    a.bd = project ? { project, running: value.running, doneToday: value.doneToday, since: now() } : null;
    sockets.write(ws, a);
  }

  function companion(ws, a, { roomId, card, to }) {
    if (!a.rooms.includes(roomId) || !isMember(roomId, a.uid)) return;
    if (!companions.take(a.cid).ok) return;
    if (to) {
      if (!isMember(roomId, to)) return;
      publishRoom(roomId, 'companion', { roomId, from: a.uid, card, to }, { exceptCid: a.cid, onlyUid: to });
      return;
    }
    publishRoom(roomId, 'companion', { roomId, from: a.uid, card }, { exceptCid: a.cid });
  }

  function historyAsk(ws, a, { roomId, before }) {
    if (!a.rooms.includes(roomId) || !isMember(roomId, a.uid)) return nack('not-member');
    if (!a.cf?.includes(FEATURES.historyPeer)) {
      a.cf = [...(a.cf ?? []), FEATURES.historyPeer];
      sockets.write(ws, a);
    }
    const rate = historyAsks.take(`${a.cid} ${roomId}`);
    if (!rate.ok) return nack('rate-limited', rate.retryAfterMs);
    const members = memberIds(roomId);
    const peers = readySockets().filter(({ a: peer }) => peer.cid !== a.cid && peer.rooms?.includes(roomId) && members.has(peer.uid) && peer.cf?.includes(FEATURES.historyPeer));
    if (peers.length === 0) return nack('no-peer');
    const peer = peers[Math.floor(Math.random() * Math.min(3, peers.length))];
    const requestId = newId('hist');
    pendingHistory.set(requestId, { askerCid: a.cid, responderCid: peer.a.cid, roomId, before: before ?? null, expiresAt: now() + WS_LIMITS.historyAnswerMs });
    sendFrame(peer.ws, 'historyRequest', before ? { roomId, requestId, before } : { roomId, requestId });
    return { ok: true };
  }

  async function historyReply(ws, a, { requestId, messages, hasMore }) {
    const ask = pendingHistory.get(requestId);
    if (!ask || ask.responderCid !== a.cid || ask.expiresAt <= now()) return sendFrame(ws, 'error', { code: 'unknownRequest' });
    pendingHistory.delete(requestId);
    const deleted = new Set(store.all('SELECT message_id FROM tombstones WHERE room_id = ?', ask.roomId).map((row) => row.message_id));
    const before = ask.before ? BigInt(ask.before) : null;
    const kept = [];
    for (const item of messages) {
      if (deleted.has(item.id) || (before !== null && BigInt(item.id) >= before)) continue;
      if (item.createdAt !== idTime(item.id)) continue;
      if (!(await chat.isAuthor(item.id, ask.roomId, item.author.id))) continue;
      if (!(await chat.checkSig(ask.roomId, item))) continue;
      kept.push(item);
    }
    kept.sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
    const asker = byCid(ask.askerCid);
    if (asker && asker.a.s === 'ready' && asker.a.rooms?.includes(ask.roomId)) sendFrame(asker.ws, 'history', { roomId: ask.roomId, messages: kept, hasMore });
  }

  // ---- HTTP ----------------------------------------------------------------------

  const ROUTES = [];
  const route = (method, pattern, handler, options = {}) => {
    const names = [];
    const regex = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, name) => (names.push(name), '([A-Za-z0-9_-]{1,64})'))}$`);
    ROUTES.push({ method, regex, names, handler, options });
  };

  async function http(request) {
    try {
      return await dispatch(request);
    } catch {
      return reply(500, { ok: false, error: 'internal' });
    }
  }

  async function dispatch({ method, path, query, headers, bodyText = '', ip = '' }) {
    const candidates = ROUTES.filter((entry) => entry.regex.test(path));
    if (candidates.length === 0) return reply(404, { ok: false, error: 'not-found' });
    const entry = candidates.find((item) => item.method === method);
    if (!entry) return reply(405, { ok: false, error: 'method-not-allowed' });
    const match = entry.regex.exec(path);
    const params = Object.fromEntries(entry.names.map((name, index) => [name, match[index + 1]]));
    if (bodyText.length > LIMITS.bodyBytes) return reply(413, { ok: false, error: 'too-large' });
    let body;
    if (bodyText.trim()) {
      const type = String(headers?.get?.('content-type') ?? '');
      if (!/^application\/json\b/i.test(type)) return reply(415, { ok: false, error: 'unsupported-media-type' });
      try {
        body = JSON.parse(bodyText);
      } catch {
        return reply(400, { ok: false, error: 'bad-request', message: 'body is not JSON' });
      }
    }
    if (entry.options.public) return entry.handler({ params, query, body, ip });
    const auth = String(headers?.get?.('authorization') ?? '');
    const token = /^Bearer (\S{1,1024})$/.exec(auth)?.[1];
    if (!token) return reply(401, { ok: false, error: 'unauthorized' });
    const verdict = await sessions.verify(token);
    if (!verdict.ok) return reply(401, { ok: false, error: 'unauthorized' });
    const member = sessions.member(verdict.claims.uid);
    if (!member) return reply(401, { ok: false, error: 'unauthorized' });
    const actor = { uid: member.id, name: member.name, readOnly: verdict.claims.readOnly || member.readOnly, isMod: member.isMod, isRoomHost: member.isRoomHost, isNew: member.isNew, joinedAt: member.joinedAt, sid: verdict.claims.sid };
    const rate = userCalls.take(actor.uid);
    if (!rate.ok) return reply(429, { ok: false, error: 'rate-limited', retryAfter: rate.retryAfterMs });
    if (entry.options.mod && !actor.isMod) return reply(403, { ok: false, error: 'forbidden' });
    if (entry.options.write && paused()) return reply(503, { ok: false, error: 'paused', retryAfter: 60_000 });
    if (entry.options.write && actor.readOnly && !entry.options.readOnlyOk) return reply(403, { ok: false, error: 'read-only' });
    if (entry.options.body) {
      const checked = validateBody(entry.options.body, body);
      if (!checked.ok) return reply(400, { ok: false, error: 'bad-request', message: checked.error });
      body = checked.body;
    }
    const result = await entry.handler({ actor, params, query, body, ip });
    await schedule();
    return result;
  }

  // Sessions
  route('POST', '/v1/session', async ({ body, ip }) => {
    if (ip && !mints.take(ip).ok) return reply(429, { ok: false, error: 'rate-limited', retryAfter: 60_000 });
    const checked = validateBody('session', body);
    if (!checked.ok) return reply(400, { ok: false, error: 'bad-request' });
    const result = await sessions.signIn(checked.body.accessToken);
    if (!result.ok) {
      if (result.error === 'not-member') return reply(403, { ok: false, error: 'not-member' });
      return fromResult(result);
    }
    return reply(200, { ok: true, session: result.session, expiresAt: result.expiresAt, user: result.user, ...(result.readOnly ? { readOnly: true } : {}) });
  }, { public: true });

  route('DELETE', '/v1/session', ({ actor }) => {
    sessions.revokeSid(actor.sid);
    for (const { ws, a } of allSockets()) if (a.sid === actor.sid) closeSocket(ws, a, CLOSE_CODES.unauthorized, 'signed out');
    return reply(200, { ok: true });
  });

  // Rooms
  route('GET', '/v1/rooms', ({ actor }) => {
    joinLobby(actor.uid);
    const at = now();
    const rows = store.all(
      `SELECT r.* FROM rooms r LEFT JOIN room_members m ON m.room_id = r.id AND m.user_id = ?1
        WHERE r.status <> 'closed' AND (r.listed = 1 OR m.user_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM invites i WHERE i.room_id = r.id AND i.invitee_id = ?1 AND i.status = 'pending' AND i.expires_at > ?2))
        ORDER BY (r.id = 'lobby') DESC, (m.user_id IS NOT NULL) DESC, r.created_at DESC LIMIT ?3`,
      actor.uid,
      at,
      ROOM_LIMITS.listMax,
    );
    return reply(200, { ok: true, rooms: rows.map((row) => summary(row, actor.uid)) });
  });

  route('POST', '/v1/rooms', ({ actor, body }) => {
    const name = cleanLine(body.name, LIMITS.roomNameChars);
    if (!name) return fromResult(fail('bad-request', 'name'));
    if (actor.isNew) return fromResult(fail('forbidden', 'new-member'));
    if (body.listed && !actor.isRoomHost && !actor.isMod && !rankAtLeast(actor.uid, ROOM_LIMITS.listedRank)) return fromResult(fail('forbidden', 'listed-rank'));
    if (!body.listed && !actor.isRoomHost && !actor.isMod && (!Number.isFinite(actor.joinedAt) || now() - actor.joinedAt < ROOM_LIMITS.unlistedMinAgeMs)) return fromResult(fail('forbidden', 'week-member'));
    const at = now();
    const result = store.transaction(() => {
      const count = (query, ...params) => Number(store.get(query, ...params)?.n ?? 0);
      if (count(`SELECT COUNT(*) AS n FROM rooms WHERE owner_id = ? AND status <> 'closed'`, actor.uid) >= ROOM_LIMITS.ownedRooms) return fail('limit', 'owned-rooms');
      if (count('SELECT COUNT(*) AS n FROM rooms WHERE owner_id = ? AND created_at > ?', actor.uid, at - DAY_MS) >= ROOM_LIMITS.createsPerDay) return fail('limit', 'daily-creates');
      if (count(`SELECT COUNT(*) AS n FROM rooms WHERE status <> 'closed'`) >= ROOM_LIMITS.activeRooms) return fail('limit', 'hub-full');
      const id = newId('room');
      store.run(
        'INSERT INTO rooms (id, kind, name, owner_id, policy, listed, max_members, status, member_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
        id,
        body.kind,
        name,
        actor.uid,
        body.policy,
        body.listed,
        ROOM_LIMITS.maxMembers[body.kind],
        'active',
        at,
        at,
      );
      store.run('INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', id, actor.uid, 'owner', at);
      return { ok: true, room: summary(roomRow(id), actor.uid) };
    });
    return fromResult(result, 201);
  }, { write: true, body: 'createRoom' });

  route('GET', '/v1/rooms/:id', ({ actor, params }) => {
    const room = roomRow(params.id);
    const view = summary(room, actor.uid);
    if (!view || (view.you === 'none' && (!room.listed || room.status === 'closed'))) return reply(404, { ok: false, error: 'not-found' });
    return reply(200, { ok: true, room: view });
  });

  route('POST', '/v1/rooms/:id/requests', ({ actor, params, body }) => {
    const at = now();
    const result = store.transaction(() => {
      const room = roomRow(params.id);
      if (!room || room.status === 'closed') return fail('not-found');
      if (isMember(room.id, actor.uid)) return fail('conflict', 'already-member');
      if (room.listed !== 1) return fail('not-found');
      if (room.policy !== 'request') return fail('forbidden', 'invite-only');
      if (room.status === 'locked') return fail('conflict', 'locked');
      const note = typeof body.note === 'string' ? body.note.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, LIMITS.noteChars) : '';
      if (actor.isNew && LINK_PATTERN.test(note)) return fail('forbidden', 'links-not-allowed');
      const invite = store.get(`SELECT id FROM invites WHERE room_id = ? AND invitee_id = ? AND status = 'pending' AND expires_at > ?`, room.id, actor.uid, at);
      if (invite) return fail('conflict', 'invited', { inviteId: invite.id });
      if (store.get('SELECT 1 AS yes FROM removals WHERE room_id = ? AND user_id = ? AND at > ?', room.id, actor.uid, at - ROOM_LIMITS.removedCooldownMs)) return fail('forbidden', 'removed');
      const open = store.get(`SELECT * FROM join_requests WHERE room_id = ? AND requester_id = ? AND status = 'pending' AND created_at > ?`, room.id, actor.uid, at - ROOM_LIMITS.requestTtlMs);
      if (open) return { ok: true, request: requestView(open), unchanged: true };
      const count = (query, ...params2) => Number(store.get(query, ...params2)?.n ?? 0);
      if (room.member_count >= room.max_members) return fail('limit', 'room-full');
      if (count(`SELECT COUNT(*) AS n FROM join_requests WHERE requester_id = ? AND status = 'pending' AND created_at > ?`, actor.uid, at - ROOM_LIMITS.requestTtlMs) >= ROOM_LIMITS.pendingPerRequester) return fail('limit', 'pending-requests');
      if (count('SELECT COUNT(*) AS n FROM join_requests WHERE requester_id = ? AND created_at > ?', actor.uid, at - DAY_MS) >= ROOM_LIMITS.requestsPerDay) return fail('limit', 'daily-requests');
      if (count(`SELECT COUNT(*) AS n FROM join_requests WHERE room_id = ? AND status = 'pending' AND created_at > ?`, room.id, at - ROOM_LIMITS.requestTtlMs) >= ROOM_LIMITS.pendingPerRoom) return fail('limit', 'room-requests');
      const id = newId('req');
      store.run('INSERT INTO join_requests (id, room_id, requester_id, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, room.id, actor.uid, note, 'pending', at);
      return { ok: true, request: requestView(store.get('SELECT * FROM join_requests WHERE id = ?', id)), ownerId: room.owner_id };
    });
    if (result.ok && result.ownerId) sendToUser(result.ownerId, 'joinRequest', { request: result.request });
    const { ownerId: _ownerId, ...out } = result;
    return fromResult(out, result.unchanged ? 200 : 201);
  }, { write: true, body: 'joinRequest' });

  route('GET', '/v1/requests', ({ actor }) => {
    const at = now();
    const rows = store.all(
      `SELECT j.* FROM join_requests j JOIN rooms r ON r.id = j.room_id
        WHERE r.status <> 'closed' AND ((j.status = 'pending' AND j.created_at > ?2 AND (r.owner_id = ?1 OR ?3 = 1)) OR (j.requester_id = ?1 AND j.created_at > ?2))
        ORDER BY j.created_at DESC LIMIT 100`,
      actor.uid,
      at - ROOM_LIMITS.requestTtlMs,
      actor.isMod ? 1 : 0,
    );
    return reply(200, { ok: true, requests: rows.map(requestView) });
  });

  route('POST', '/v1/requests/:id/decide', ({ actor, params, body }) => {
    const at = now();
    const result = store.transaction(() => {
      const row = store.get('SELECT * FROM join_requests WHERE id = ?', params.id);
      if (!row) return fail('not-found');
      const room = roomRow(row.room_id);
      if (!room) return fail('not-found');
      if (room.owner_id !== actor.uid && !actor.isMod) return fail('forbidden');
      if (row.status !== 'pending') return fail('conflict', 'already-decided');
      if (lapsed(row)) return fail('gone', 'expired');
      if (room.status === 'closed') return fail('gone', 'closed');
      if (body.decision === 'deny') {
        store.run(`UPDATE join_requests SET status = 'denied', decided_by = ?, decided_at = ? WHERE id = ?`, actor.uid, at, row.id);
        return { ok: true, request: requestView({ ...row, status: 'denied', decided_at: at }), requesterId: row.requester_id };
      }
      if (room.member_count >= room.max_members) return fail('limit', 'room-full');
      store.run(`UPDATE join_requests SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ?`, actor.uid, at, row.id);
      if (!isMember(room.id, row.requester_id)) {
        store.run('INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', room.id, row.requester_id, 'member', at);
        store.run('UPDATE rooms SET member_count = member_count + 1, updated_at = ? WHERE id = ?', at, room.id);
      }
      return { ok: true, request: requestView({ ...row, status: 'approved', decided_at: at }), requesterId: row.requester_id, joined: room.id };
    });
    if (result.ok) {
      sendToUser(result.requesterId, 'joinRequest', { request: result.request });
      if (result.joined) {
        publishRoom(result.joined, 'membership', { roomId: result.joined, userId: result.requesterId, state: 'joined' });
        sendToUser(result.requesterId, 'membership', { roomId: result.joined, userId: result.requesterId, state: 'joined' });
      }
    }
    const { requesterId: _r, joined: _j, ...out } = result;
    return fromResult(out);
  }, { write: true, body: 'decide' });

  route('POST', '/v1/requests/:id/cancel', ({ actor, params }) => {
    const result = store.transaction(() => {
      const row = store.get('SELECT * FROM join_requests WHERE id = ?', params.id);
      if (!row || row.requester_id !== actor.uid) return fail('not-found');
      if (row.status !== 'pending') return fail('conflict', 'already-decided');
      store.run(`UPDATE join_requests SET status = 'cancelled', decided_at = ? WHERE id = ?`, now(), row.id);
      return { ok: true };
    });
    return fromResult(result);
  }, { write: true });

  route('POST', '/v1/rooms/:id/invites', ({ actor, params, body }) => {
    const at = now();
    const inviteeId = body.userId;
    if (inviteeId === actor.uid) return fromResult(fail('bad-request', 'self'));
    const result = store.transaction(() => {
      const room = roomRow(params.id);
      if (!room || room.status === 'closed') return fail('not-found');
      if (room.owner_id !== actor.uid && !actor.isMod) return fail('forbidden');
      if (room.status === 'locked') return fail('conflict', 'locked');
      if (isMember(room.id, inviteeId)) return fail('conflict', 'already-member');
      if (!store.get('SELECT 1 AS yes FROM members WHERE user_id = ?', inviteeId)) return fail('not-found', 'invitee');
      const open = store.get(`SELECT * FROM invites WHERE room_id = ? AND invitee_id = ? AND status = 'pending' AND expires_at > ?`, room.id, inviteeId, at);
      if (open) return { ok: true, invite: inviteView(open, room.name), unchanged: true };
      if (Number(store.get('SELECT COUNT(*) AS n FROM invites WHERE invited_by = ? AND created_at > ?', actor.uid, at - DAY_MS)?.n ?? 0) >= ROOM_LIMITS.invitesPerDay) return fail('limit', 'daily-invites');
      if (room.member_count >= room.max_members) return fail('limit', 'room-full');
      const id = newId('inv');
      store.run('INSERT INTO invites (id, room_id, invitee_id, invited_by, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, room.id, inviteeId, actor.uid, 'pending', at + ROOM_LIMITS.inviteTtlMs, at);
      store.run('DELETE FROM removals WHERE room_id = ? AND user_id = ?', room.id, inviteeId);
      return { ok: true, invite: inviteView(store.get('SELECT * FROM invites WHERE id = ?', id), room.name) };
    });
    if (result.ok && !result.unchanged) sendToUser(inviteeId, 'invite', { invite: result.invite });
    return fromResult(result, result.unchanged ? 200 : 201);
  }, { write: true, body: 'invite' });

  route('GET', '/v1/invites', ({ actor }) => {
    const rows = store.all(`SELECT i.*, r.name AS room_name FROM invites i JOIN rooms r ON r.id = i.room_id WHERE i.invitee_id = ? AND i.status = 'pending' AND i.expires_at > ? AND r.status <> 'closed' ORDER BY i.created_at DESC LIMIT 100`, actor.uid, now());
    return reply(200, { ok: true, invites: rows.map((row) => inviteView(row, row.room_name)) });
  });

  route('POST', '/v1/invites/:id/accept', ({ actor, params }) => {
    const at = now();
    const result = store.transaction(() => {
      const row = store.get('SELECT * FROM invites WHERE id = ?', params.id);
      if (!row || row.invitee_id !== actor.uid) return fail('not-found');
      const room = roomRow(row.room_id);
      if (row.status === 'accepted') return room && room.status !== 'closed' ? { ok: true, room: summary(room, actor.uid), unchanged: true } : fail('gone', 'closed');
      if (row.status !== 'pending') return fail('gone', row.status);
      if (row.expires_at <= at) {
        store.run(`UPDATE invites SET status = 'expired', decided_at = ? WHERE id = ?`, at, row.id);
        return fail('gone', 'expired');
      }
      if (!room || room.status === 'closed') return fail('gone', 'closed');
      if (room.member_count >= room.max_members) return fail('limit', 'room-full');
      store.run(`UPDATE invites SET status = 'accepted', decided_at = ? WHERE id = ?`, at, row.id);
      if (!isMember(room.id, actor.uid)) {
        store.run('INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', room.id, actor.uid, 'member', at);
        store.run('UPDATE rooms SET member_count = member_count + 1, updated_at = ? WHERE id = ?', at, room.id);
      }
      store.run(`UPDATE join_requests SET status = 'approved', decided_by = ?, decided_at = ? WHERE room_id = ? AND requester_id = ? AND status = 'pending'`, row.invited_by, at, room.id, actor.uid);
      return { ok: true, room: summary(roomRow(room.id), actor.uid), inviterId: row.invited_by, invite: inviteView({ ...row, status: 'accepted' }, room.name) };
    });
    if (result.ok && !result.unchanged) {
      publishRoom(result.room.id, 'membership', { roomId: result.room.id, userId: actor.uid, state: 'joined' });
      sendToUser(result.inviterId, 'invite', { invite: result.invite });
    }
    const { inviterId: _i, invite: _v, ...out } = result;
    return fromResult(out);
  }, { write: true });

  route('POST', '/v1/invites/:id/decline', ({ actor, params }) => {
    const result = store.transaction(() => {
      const row = store.get('SELECT * FROM invites WHERE id = ?', params.id);
      if (!row || row.invitee_id !== actor.uid) return fail('not-found');
      if (row.status !== 'pending') return fail('gone', row.status);
      store.run(`UPDATE invites SET status = 'declined', decided_at = ? WHERE id = ?`, now(), row.id);
      return { ok: true, inviterId: row.invited_by, invite: inviteView({ ...row, status: 'declined' }) };
    });
    if (result.ok) sendToUser(result.inviterId, 'invite', { invite: result.invite });
    return fromResult(result.ok ? { ok: true } : result);
  }, { write: true });

  /** A member is out of a room: membership frame, their sockets unsubscribed, their claims and player ended. */
  function afterLeaving(roomId, uid, state) {
    publishRoom(roomId, 'membership', { roomId, userId: uid, state });
    sendToUser(uid, 'membership', { roomId, userId: uid, state });
    dropRoom(roomId, uid);
    const released = leases.releaseMember(roomId, uid, state === 'removed' ? 'removed' : 'left');
    if (released.changed) publishClaims(roomId);
    listen.memberLeft(roomId, uid);
    publishPresence(roomId);
  }

  route('POST', '/v1/rooms/:id/leave', ({ actor, params }) => {
    const result = store.transaction(() => {
      const room = roomRow(params.id);
      if (!room || !isMember(room.id, actor.uid)) return fail('not-found');
      if (room.owner_id === actor.uid) return fail('conflict', 'owner-must-close');
      if (room.id === LOBBY.id) return fail('conflict', 'lobby');
      store.run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', room.id, actor.uid);
      store.run('UPDATE rooms SET member_count = MAX(0, member_count - 1), updated_at = ? WHERE id = ?', now(), room.id);
      return { ok: true, roomId: room.id };
    });
    if (result.ok) afterLeaving(result.roomId, actor.uid, 'left');
    return fromResult(result.ok ? { ok: true } : result);
  }, { write: true, readOnlyOk: true });

  route('POST', '/v1/rooms/:id/members/:uid/remove', ({ actor, params }) => {
    const targetId = params.uid;
    if (!isSnowflake(targetId)) return fromResult(fail('bad-request', 'member'));
    if (targetId === actor.uid) return fromResult(fail('bad-request', 'use-leave'));
    const at = now();
    const result = store.transaction(() => {
      const room = roomRow(params.id);
      if (!room || room.status === 'closed') return fail('not-found');
      if (room.owner_id !== actor.uid && !actor.isMod) return fail('forbidden');
      if (targetId === room.owner_id) return fail('forbidden', 'owner');
      if (!isMember(room.id, targetId)) return fail('not-found');
      store.run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', room.id, targetId);
      store.run('UPDATE rooms SET member_count = MAX(0, member_count - 1), updated_at = ? WHERE id = ?', at, room.id);
      store.run('INSERT INTO removals (room_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT (room_id, user_id) DO UPDATE SET at = excluded.at', room.id, targetId, at);
      store.run('INSERT INTO audit (kind, actor_id, target_id, room_id, at) VALUES (?, ?, ?, ?, ?)', 'room-remove', actor.uid, targetId, room.id, at);
      return { ok: true, roomId: room.id };
    });
    if (result.ok) afterLeaving(result.roomId, targetId, 'removed');
    return fromResult(result.ok ? { ok: true } : result);
  }, { write: true });

  function setStatus(actor, roomId, target) {
    const at = now();
    const result = store.transaction(() => {
      const room = roomRow(roomId);
      if (!room) return fail('not-found');
      if (room.status === 'closed') return fail('gone', 'closed');
      if (room.owner_id !== actor.uid && !actor.isMod) return fail('forbidden');
      if (room.id === LOBBY.id) return fail('conflict', 'lobby');
      if (target === 'closed') {
        store.run(`UPDATE rooms SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?`, at, at, room.id);
        store.run(`UPDATE join_requests SET status = 'cancelled', decided_at = ? WHERE room_id = ? AND status = 'pending'`, at, room.id);
        store.run(`UPDATE invites SET status = 'revoked', decided_at = ? WHERE room_id = ? AND status = 'pending'`, at, room.id);
        store.run('INSERT INTO audit (kind, actor_id, room_id, at) VALUES (?, ?, ?, ?)', 'room-close', actor.uid, room.id, at);
      } else {
        store.run('UPDATE rooms SET status = ?, updated_at = ? WHERE id = ?', target, at, room.id);
      }
      return { ok: true, room: summary(roomRow(room.id)), members: [...memberIds(room.id)] };
    });
    if (!result.ok) return fromResult(result);
    if (target === 'closed') {
      for (const uid of result.members) sendToUser(uid, 'membership', { roomId, userId: uid, state: 'closed' });
      for (const uid of result.members) sendToUser(uid, 'room', { room: result.room });
      listen.end(roomId);
      const released = leases.releaseRoom(roomId);
      if (released.changed) publishClaims(roomId);
      dropRoom(roomId);
      return reply(200, { ok: true });
    }
    publishRoom(roomId, 'room', { room: result.room });
    return reply(200, { ok: true, room: summary(roomRow(roomId), actor.uid) });
  }

  route('POST', '/v1/rooms/:id/lock', ({ actor, params }) => setStatus(actor, params.id, 'locked'), { write: true });
  route('POST', '/v1/rooms/:id/unlock', ({ actor, params }) => setStatus(actor, params.id, 'active'), { write: true });
  route('POST', '/v1/rooms/:id/close', ({ actor, params }) => setStatus(actor, params.id, 'closed'), { write: true });

  // ---- connecting made simple: join codes and Who's online ----

  function codeFor(roomId, uid, { fresh = false } = {}) {
    return store.transaction(() => {
      const held = store.get('SELECT code FROM room_codes WHERE room_id = ?', roomId)?.code;
      if (held && !fresh) return held;
      store.run('DELETE FROM room_codes WHERE room_id = ?', roomId);
      for (;;) {
        const bytes = randomBytes(CODE_LENGTH);
        const code = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
        if (store.get('SELECT 1 AS yes FROM room_codes WHERE code = ?', code)) continue;
        store.run('INSERT INTO room_codes (code, room_id, created_by, created_at) VALUES (?, ?, ?, ?)', code, roomId, uid, now());
        return code;
      }
    });
  }
  const codeAnswer = (code) => ({ ok: true, code: showCode(code), link: joinLinkFor(config.publicBase || 'https://mefi-relay.mefi-studio.workers.dev', code) });

  // Any member of a room may hand out its code; the owner or a moderator may replace it (the old one stops working).
  route('GET', '/v1/rooms/:id/code', ({ actor, params }) => {
    const room = roomRow(params.id);
    if (!room || room.status === 'closed') return fromResult(fail('not-found'));
    if (room.id === LOBBY.id) return fromResult(fail('conflict', 'lobby'));
    if (!isMember(room.id, actor.uid)) return fromResult(fail('not-member'));
    return reply(200, codeAnswer(codeFor(room.id, actor.uid)));
  });

  route('POST', '/v1/rooms/:id/code', ({ actor, params }) => {
    const room = roomRow(params.id);
    if (!room || room.status === 'closed') return fromResult(fail('not-found'));
    if (room.id === LOBBY.id) return fromResult(fail('conflict', 'lobby'));
    if (room.owner_id !== actor.uid && !actor.isMod) return fromResult(fail('forbidden'));
    return reply(200, codeAnswer(codeFor(room.id, actor.uid, { fresh: true })));
  }, { write: true });

  // Joining by code: no request to approve. A removed member stays out for 30 days.
  route('POST', '/v1/join', ({ actor, body }) => {
    const rate = joinTries.take(actor.uid);
    if (!rate.ok) return reply(429, { ok: false, error: 'rate-limited', retryAfter: rate.retryAfterMs });
    const code = readCode(body.code);
    const at = now();
    const result = store.transaction(() => {
      const row = code.length === CODE_LENGTH ? store.get('SELECT room_id FROM room_codes WHERE code = ?', code) : null;
      const room = row ? roomRow(row.room_id) : null;
      if (!room || room.status === 'closed') return fail('not-found', 'code');
      if (isMember(room.id, actor.uid)) return { ok: true, room: summary(room, actor.uid), unchanged: true };
      if (room.status === 'locked') return fail('conflict', 'locked');
      if (store.get('SELECT 1 AS yes FROM removals WHERE room_id = ? AND user_id = ? AND at > ?', room.id, actor.uid, at - ROOM_LIMITS.removedCooldownMs)) return fail('forbidden', 'removed');
      if (room.member_count >= room.max_members) return fail('limit', 'room-full');
      store.run('INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', room.id, actor.uid, 'member', at);
      store.run('UPDATE rooms SET member_count = member_count + 1, updated_at = ? WHERE id = ?', at, room.id);
      store.run(`UPDATE join_requests SET status = 'approved', decided_at = ? WHERE room_id = ? AND requester_id = ? AND status = 'pending'`, at, room.id, actor.uid);
      store.run(`UPDATE invites SET status = 'accepted', decided_at = ? WHERE room_id = ? AND invitee_id = ? AND status = 'pending'`, at, room.id, actor.uid);
      return { ok: true, room: summary(roomRow(room.id), actor.uid) };
    });
    if (result.ok && !result.unchanged) publishRoom(result.room.id, 'membership', { roomId: result.room.id, userId: actor.uid, state: 'joined' });
    const { unchanged: _u, ...out } = result;
    return fromResult(out);
  }, { write: true, body: 'joinCode' });

  // Who is in Studio right now: members with a live socket, apart from you and anyone who chose not to show.
  route('GET', '/v1/online', ({ actor }) => {
    const ids = [...new Set(readySockets().map(({ a }) => a.uid))].filter((uid) => uid !== actor.uid && !onlineHidden(uid)).slice(0, 200);
    const people = ids.map((uid) => {
      const card = credits.card(uid);
      return card ? { id: uid, name: card.name, rank: card.rank.key, specialRanks: card.specialRanks } : null;
    }).filter(Boolean);
    people.sort((x, y) => x.name.localeCompare(y.name));
    return reply(200, { ok: true, people, visible: !onlineHidden(actor.uid) });
  });

  route('POST', '/v1/me/online', ({ actor, body }) => {
    store.run('UPDATE members SET online_hidden = ? WHERE user_id = ?', body.visible ? 0 : 1, actor.uid);
    publishPresence(LOBBY.id);
    return reply(200, { ok: true, visible: body.visible });
  }, { body: 'onlineVisible', readOnlyOk: true });

  // The Lobby front page in one read: who is online and where (a listed room's
  // name, the Lobby, or just "in Studio"; an unlisted room is never named),
  // the rooms open now with how many are in each, the Lobby's crowd, the
  // member's own room for an invite code, and the hub's week (credits.front).
  route('GET', '/v1/front', async ({ actor }) => {
    const held = await credits.heldUntil(actor.uid);
    joinLobby(actor.uid);
    const ready = readySockets();
    const listed = new Map(store.all(`SELECT id, name, kind FROM rooms WHERE status = 'active' AND listed = 1`).map((row) => [row.id, row]));
    const here = new Map(); // room id -> uids with a socket in it
    const rooms = new Map(); // uid -> room ids their sockets hold
    const builds = new Map(); // uid -> what they share they are building
    for (const { a } of ready) {
      if (a.bd && !builds.has(a.uid)) builds.set(a.uid, a.bd);
      if (!rooms.has(a.uid)) rooms.set(a.uid, new Set());
      for (const roomId of a.rooms ?? []) {
        rooms.get(a.uid).add(roomId);
        if (!here.has(roomId)) here.set(roomId, new Set());
        here.get(roomId).add(a.uid);
      }
    }
    const visible = [...rooms.keys()].filter((uid) => uid !== actor.uid && !onlineHidden(uid));
    const people = visible.slice(0, FRONT.people).map((uid) => {
      const card = credits.card(uid);
      if (!card) return null;
      const held = [...rooms.get(uid)];
      const named = held.map((roomId) => listed.get(roomId)).find((room) => room && room.id !== LOBBY.id);
      const where = named ? { id: named.id, name: named.name, kind: named.kind } : held.includes(LOBBY.id) ? { id: LOBBY.id, name: LOBBY.name, kind: 'hangout' } : null;
      const made = builds.get(uid);
      return { id: uid, name: card.name, rank: card.rank.key, specialRanks: card.specialRanks, where, building: made ? { project: made.project, running: made.running, doneToday: made.doneToday } : null };
    }).filter(Boolean);
    people.sort((x, y) => Number(Boolean(y.where)) - Number(Boolean(x.where)) || x.name.localeCompare(y.name));
    const crowd = (roomId) => [...(here.get(roomId) ?? [])].filter((uid) => isMember(roomId, uid) && (roomId !== LOBBY.id || !onlineHidden(uid))).length;
    const open = store.all(
      `SELECT r.* FROM rooms r LEFT JOIN room_members m ON m.room_id = r.id AND m.user_id = ?
        WHERE r.status = 'active' AND r.id <> ? AND (r.listed = 1 OR m.user_id IS NOT NULL) LIMIT 100`,
      actor.uid,
      LOBBY.id,
    ).map((row) => ({ ...summary(row, actor.uid), here: crowd(row.id) }));
    open.sort((x, y) => y.here - x.here || y.memberCount - x.memberCount || y.createdAt - x.createdAt);
    const own = store.get(`SELECT id, name FROM rooms WHERE owner_id = ? AND status = 'active' AND id <> ? ORDER BY created_at DESC LIMIT 1`, actor.uid, LOBBY.id);
    return reply(200, {
      ok: true,
      online: { count: visible.length, people },
      lobby: { here: crowd(LOBBY.id) },
      rooms: open.slice(0, FRONT.rooms),
      ownRoom: own ? { id: own.id, name: own.name } : null,
      visible: !onlineHidden(actor.uid),
      ...credits.front(actor.uid, held),
      events: events.front(actor.uid),
    });
  });

  route('GET', '/v1/members/search', ({ actor, query }) => {
    const checked = validateQuery('membersSearch', query);
    if (!checked.ok) return reply(400, { ok: false, error: 'bad-request' });
    const rate = searches.take(actor.uid);
    if (!rate.ok) return reply(429, { ok: false, error: 'rate-limited', retryAfter: rate.retryAfterMs });
    const needle = checked.query.q.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`);
    const rows = store.all(`SELECT user_id, name FROM members WHERE name_key LIKE ? ESCAPE '\\' ORDER BY (name_key LIKE ? ESCAPE '\\') DESC, last_seen DESC LIMIT ?`, `%${needle}%`, `${needle}%`, LIMITS.searchResults);
    return reply(200, { ok: true, members: rows.map((row) => ({ id: row.user_id, name: row.name })) });
  });

  // The relay keeps no messages: a room's history lives on its members' PCs (peer history).
  route('GET', '/v1/rooms/:id/messages', ({ actor, params, query }) => {
    const checked = validateQuery('messages', query);
    if (!checked.ok) return reply(400, { ok: false, error: 'bad-request' });
    if (!isMember(params.id, actor.uid)) return reply(403, { ok: false, error: 'not-member' });
    return reply(200, { ok: true, messages: [], hasMore: false });
  });

  route('POST', '/v1/reports', async ({ actor, body }) => {
    const rate = reportsBucket.take(actor.uid);
    if (!rate.ok) return reply(429, { ok: false, error: 'rate-limited', retryAfter: rate.retryAfterMs });
    const room = roomRow(body.roomId);
    if (!room) return reply(404, { ok: false, error: 'not-found' });
    const evidence = body.message && body.message.id === body.messageId && (await chat.checkSig(room.id, body.message)) && (await chat.isAuthor(body.messageId, room.id, body.message.author.id)) ? body.message : null;
    store.run(
      'INSERT INTO reports (id, room_id, message_id, author_id, reporter_id, reason, text, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (reporter_id, message_id) DO NOTHING',
      newId('rep'),
      room.id,
      body.messageId,
      evidence?.author.id ?? null,
      actor.uid,
      body.reason,
      evidence?.text ?? null,
      evidence ? 1 : 0,
      now(),
    );
    return reply(202, { ok: true });
  }, { body: 'report', readOnlyOk: true });

  // Claims (cowork rooms), the hub's four routes.
  route('GET', '/v1/rooms/:id/claims', ({ actor, params }) => {
    if (!leases.roomInfo(params.id)) return reply(404, { ok: false, error: 'not-found' });
    if (!isMember(params.id, actor.uid)) return reply(403, { ok: false, error: 'not-member' });
    return reply(200, { ok: true, leases: leases.list(params.id) });
  });

  route('POST', '/v1/rooms/:id/claims', ({ actor, params, body }) => {
    const rate = claimWrites.take(actor.uid);
    if (!rate.ok) return reply(429, { ok: false, error: 'rate-limited', retryAfter: rate.retryAfterMs });
    if (!leases.roomInfo(params.id)) return reply(404, { ok: false, error: 'not-found' });
    if (!isMember(params.id, actor.uid)) return reply(403, { ok: false, error: 'not-member' });
    const result = leases.acquire(params.id, actor.uid, body);
    if (!result.ok) {
      if (result.error === 'conflict') return reply(409, { ok: false, error: 'conflict', conflicts: result.conflicts });
      return fromResult({ ok: false, error: result.error, ...(result.message ? { message: result.message } : {}) });
    }
    if (result.changed) publishClaims(params.id);
    return reply(201, { ok: true, leaseId: result.leaseId, fence: result.fence, expiresAt: result.expiresAt, ...(result.reused ? { reused: true } : {}) });
  }, { write: true, body: 'claim' });

  route('PUT', '/v1/claims/:leaseId', ({ actor, params }) => {
    const result = leases.heartbeat(params.leaseId, actor.uid);
    if (result.changed) publishClaims(result.roomId);
    if (!result.ok) return reply(410, { ok: false, error: 'gone' });
    return reply(200, { ok: true, expiresAt: result.expiresAt });
  }, { write: true, readOnlyOk: true });

  route('DELETE', '/v1/claims/:leaseId', ({ actor, params, body }) => {
    const own = leases.release(params.leaseId, actor.uid, body.reason);
    if (own.changed) publishClaims(own.roomId);
    if (own.ok) return reply(200, { ok: true });
    const found = leases.lookup(params.leaseId);
    const room = found ? roomRow(found.roomId) : null;
    if (found?.live && found.memberId !== actor.uid && room && (room.owner_id === actor.uid || actor.isMod)) {
      const forced = leases.forceRelease(params.leaseId, actor.uid, body.reason);
      if (forced.changed) publishClaims(forced.roomId);
      if (forced.ok) return reply(200, { ok: true, forced: true });
    }
    return reply(410, { ok: false, error: 'gone' });
  }, { write: true, readOnlyOk: true, body: 'release' });

  // Forget me: every row about this member goes, rooms they own close. Only a
  // keyed fingerprint of the account stays for 30 days, so forgetting cannot
  // reset the credit limits (credits.forget).
  route('POST', '/v1/me/forget', async ({ actor }) => {
    const fingerprint = await credits.fingerprint(actor.uid);
    const owned = store.all(`SELECT id FROM rooms WHERE owner_id = ? AND status <> 'closed'`, actor.uid).map((row) => row.id);
    for (const roomId of owned) setStatus({ ...actor, isMod: true }, roomId, 'closed');
    const rooms = store.all('SELECT room_id FROM room_members WHERE user_id = ?', actor.uid).map((row) => row.room_id);
    const counts = store.transaction(() => {
      const count = (query, ...params) => Number(store.get(query, ...params)?.n ?? 0);
      const out = {
        rooms: rooms.length,
        requests: count('SELECT COUNT(*) AS n FROM join_requests WHERE requester_id = ?', actor.uid),
        invites: count('SELECT COUNT(*) AS n FROM invites WHERE invitee_id = ? OR invited_by = ?', actor.uid, actor.uid),
        reports: count('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? OR author_id = ?', actor.uid, actor.uid),
      };
      for (const roomId of rooms) store.run('UPDATE rooms SET member_count = MAX(0, member_count - 1) WHERE id = ?', roomId);
      store.run('DELETE FROM room_members WHERE user_id = ?', actor.uid);
      store.run('DELETE FROM join_requests WHERE requester_id = ?', actor.uid);
      store.run('DELETE FROM invites WHERE invitee_id = ? OR invited_by = ?', actor.uid, actor.uid);
      store.run('DELETE FROM removals WHERE user_id = ?', actor.uid);
      store.run('DELETE FROM reports WHERE reporter_id = ? OR author_id = ?', actor.uid, actor.uid);
      store.run('DELETE FROM leases WHERE member_id = ?', actor.uid);
      store.run('DELETE FROM token_cache WHERE user_id = ?', actor.uid);
      out.projects = count('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?', actor.uid);
      credits.forget(actor.uid, fingerprint);
      events.forget(actor.uid);
      store.run('DELETE FROM members WHERE user_id = ?', actor.uid);
      return out;
    });
    sessions.revokeUser(actor.uid);
    for (const roomId of rooms) {
      publishRoom(roomId, 'membership', { roomId, userId: actor.uid, state: 'left' });
      publishClaims(roomId);
      listen.memberLeft(roomId, actor.uid);
    }
    closeUser(actor.uid, CLOSE_CODES.unauthorized, 'forgotten');
    return reply(200, { ok: true, forgotten: counts });
  });

  // Moderators.
  route('POST', '/v1/admin/pause', ({ body }) => {
    if (typeof body?.paused !== 'boolean') return reply(400, { ok: false, error: 'bad-request' });
    store.setMeta('paused', body.paused ? 'true' : 'false');
    const text = JSON.stringify(hubFrame('hubState', { paused: paused() }));
    for (const { ws } of readySockets()) sockets.send(ws, text);
    return reply(200, { ok: true, paused: paused() });
  }, { mod: true });

  route('GET', '/v1/admin/reports', () => {
    const rows = store.all(`SELECT * FROM reports WHERE status = 'open' ORDER BY created_at DESC LIMIT 100`);
    return reply(200, {
      ok: true,
      // A project report (credits.mjs) is kept as room "project" with the project's id as its message.
      reports: rows.map((row) => ({ id: row.id, kind: row.room_id === 'project' ? 'project' : 'message', roomId: row.room_id === 'project' ? null : row.room_id, messageId: row.room_id === 'project' ? null : row.message_id, projectId: row.room_id === 'project' ? row.message_id : null, author: row.author_id ? userView(row.author_id) : null, reporter: userView(row.reporter_id), reason: row.reason, text: row.text, verified: row.verified === 1, createdAt: row.created_at })),
    });
  }, { mod: true });

  route('POST', '/v1/admin/reports/:id/resolve', ({ actor, params }) => {
    const row = store.get('SELECT id FROM reports WHERE id = ?', params.id);
    if (!row) return reply(404, { ok: false, error: 'not-found' });
    store.transaction(() => {
      store.run(`UPDATE reports SET status = 'resolved' WHERE id = ?`, row.id);
      store.run('INSERT INTO audit (kind, actor_id, detail, at) VALUES (?, ?, ?, ?)', 'report-resolve', actor.uid, JSON.stringify({ reportId: row.id }), now());
    });
    return reply(200, { ok: true });
  }, { mod: true });

  route('POST', '/v1/admin/members/:uid/suspend', ({ actor, params, body }) => {
    const minutes = Number(body?.minutes);
    if (!isSnowflake(params.uid) || !Number.isSafeInteger(minutes) || minutes < 0 || minutes > 60 * 24 * 365) return reply(400, { ok: false, error: 'bad-request' });
    if (!store.get('SELECT 1 AS yes FROM members WHERE user_id = ?', params.uid)) return reply(404, { ok: false, error: 'not-found' });
    store.transaction(() => {
      store.run('UPDATE members SET suspended_until = ? WHERE user_id = ?', minutes ? now() + minutes * MINUTE_MS : null, params.uid);
      store.run('INSERT INTO audit (kind, actor_id, target_id, detail, at) VALUES (?, ?, ?, ?, ?)', 'member-suspend', actor.uid, params.uid, JSON.stringify({ minutes }), now());
    });
    if (minutes) {
      sessions.revokeUser(params.uid);
      closeUser(params.uid, CLOSE_CODES.unauthorized, 'suspended');
    }
    return reply(200, { ok: true });
  }, { mod: true });

  return Object.freeze({
    init,
    http,
    open,
    message,
    closed,
    alarm,
    schedule,
    config,
    // For tests: the store and the member a uid resolves to.
    store,
    member: (uid) => describeMember(store.get('SELECT * FROM members WHERE user_id = ?', uid), now()),
  });
}
