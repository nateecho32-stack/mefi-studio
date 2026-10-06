// Cowork claim leases: the hub is the lease authority.
//
// In a cowork room, each member's Studio agents claim the repo paths they are
// about to change, so agents on different machines never edit the same files
// at once. This module decides who holds what. It is synchronous and pure over
// the store: each decision is one SQLite transaction, and time comes only from
// the injected clock. It never sends anything; src/claims/routes.mjs pushes the
// claims frame after every change.
//
//   const leases = createLeases({ store, clock, isRoomMember });
//   leases.acquire(roomId, memberId, claim)
//     -> { ok: true, leaseId, fence, expiresAt, lease, roomId, reused? }
//      | { ok: false, error: 'conflict', conflicts: [{ leaseId, memberId, machineId, runId, paths, overlapping, branch, title, expiresAt }] }
//      | { ok: false, error: 'bad-request' | 'not-found' | 'not-member' | 'forbidden' | 'limit', message? }
//   leases.heartbeat(leaseId, memberId)            -> { ok: true, expiresAt, ... } | { ok: false, error: 'gone', gone: true }
//   leases.release(leaseId, memberId, reason)      -> { ok: true, roomId }         | gone
//   leases.forceRelease(leaseId, actorId, reason)  -> { ok: true, roomId, memberId } | gone   (writes an audit row)
//   leases.expireSweep(now)                        -> { count, roomIds, leaseIds }
//   leases.list(roomId)                            -> Lease[] (live, oldest fence first)
// Results that changed a room carry { changed: true, roomId } (a gone answer
// can too, when it is the call that noticed the expiry), so the caller knows
// to push a frame. The same functions are also exported with the dependencies
// first, for example acquire({ store, clock }, roomId, memberId, claim).
//
// Rules:
// - memberId and actorId always come from the hub session, never a request
//   body; a value that is not a Discord id throws a TypeError (a caller bug).
// - Only members of an active cowork room may claim. isRoomMember(roomId,
//   userId) must be synchronous; the default reads room_members.
// - Only exclusive leases conflict. An exclusive claim is refused while it
//   overlaps (src/claims/paths.mjs) a live exclusive lease in the room, and
//   that includes the member's own other runs. Non-exclusive leases, and
//   paths: [] (presence), are never refused and never refuse anyone.
// - A run (same member, machine and runId) never conflicts with itself. An
//   exact replay of a live claim by the same run (a retried POST whose answer
//   was lost) returns that lease again with its expiry renewed.
// - fence = ++fences.last_fence per room, taken in the same transaction as
//   the insert. It never goes back: not on release, retention or restart.
// - ttlMs is 1-60 minutes (default 15), counted on the hub clock. Clients
//   never send expiresAt. A lease is live while released_at is null and
//   expires_at > now. `at` is when the lease was granted or last renewed, so
//   expires_at - at is its TTL, and each heartbeat renews it by that much.
// - A lease that is unknown, released, expired or someone else's is gone to
//   heartbeat and release (HTTP 410). Only forceRelease ends another member's
//   lease; the caller checks that the actor owns the room or is a moderator.
// - Caps (LEASE_LIMITS): 25 live leases per member per room and 200 per room,
//   and byte budgets so a room's claims frame stays under the protocol's
//   512 KB hub frame cap. A claim past a cap gets 'limit'.

// Carried over from the Void Engine hub's src/claims/leases.mjs; only the
// imports, the id helper and the byte counting changed for the Worker.
import { LIMITS, isOpaqueId, isSnowflake, validateBody } from './protocol.mjs';
import { claimPathKey, keysOverlap, normalizeClaimPaths } from './paths.mjs';
import { newId, utf8Length } from './util.mjs';

const systemClock = Object.freeze({ now: () => Date.now() });

export const LEASE_LIMITS = Object.freeze({
  ttlMinMs: LIMITS.claimTtlMinMs, // 1 minute
  ttlDefaultMs: LIMITS.claimTtlDefaultMs, // 15 minutes
  ttlMaxMs: LIMITS.claimTtlMaxMs, // 60 minutes
  perMember: 25, // live leases per member per room
  perRoom: LIMITS.leasesPerFrame, // 200 live leases per room: one claims frame lists them all
  memberBytes: 48 * 1024, // a member's live leases in one room, as frame JSON
  roomBytes: 384 * 1024, // a room's claims frame, well under protocol LIMITS.hubFrameBytes
  reasonChars: 200,
});

/** release_reason values the hub writes itself (a holder's own reason is free text, at most 200 characters). */
export const RELEASE_REASONS = Object.freeze({
  released: 'released',
  expired: 'expired',
  forced: 'forced',
  notMember: 'not-member',
  roomClosed: 'room-closed',
});

/** audit.kind of a force release. */
export const FORCE_RELEASE_AUDIT_KIND = 'claim-force-release';

const LIVE = 'released_at IS NULL AND expires_at > ?';

const gone = (roomId) =>
  roomId ? { ok: false, error: 'gone', gone: true, changed: true, roomId } : { ok: false, error: 'gone', gone: true };

// ---- Dependencies ---------------------------------------------------------------

function defaultIsRoomMember(store) {
  return (roomId, userId) => store.get('SELECT 1 AS yes FROM room_members WHERE room_id = ? AND user_id = ?', roomId, userId) !== undefined;
}

function resolve(deps) {
  const store = deps?.store;
  if (!store || typeof store.transaction !== 'function' || typeof store.get !== 'function') {
    throw new TypeError('claim leases need { store } from openStore()');
  }
  const clock = deps.clock ?? store.clock ?? systemClock;
  if (typeof clock?.now !== 'function') throw new TypeError('claim leases need a clock with now()');
  const isRoomMember = deps.isRoomMember ?? defaultIsRoomMember(store);
  if (typeof isRoomMember !== 'function') throw new TypeError('isRoomMember must be a function');
  const limits = Object.freeze({ ...LEASE_LIMITS, ...(deps.limits ?? {}) });
  return { store, clock, isRoomMember, limits };
}

function assertUserId(value, name) {
  if (!isSnowflake(value)) throw new TypeError(`${name} must be a Discord user id taken from the hub session`);
}

function memberOfRoom(ctx, roomId, userId) {
  if (!isOpaqueId(roomId) || !isSnowflake(userId)) return false;
  const answer = ctx.isRoomMember(roomId, userId);
  if (answer && typeof answer.then === 'function') {
    throw new TypeError('isRoomMember must be synchronous; do asynchronous checks in the route before calling the lease authority');
  }
  return Boolean(answer);
}

// ---- Rows and shapes --------------------------------------------------------------

function parsePaths(json) {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/** A leases row -> the protocol's Lease shape (docs/protocol.md). */
export function leaseFromRow(row) {
  return {
    leaseId: row.lease_id,
    memberId: row.member_id,
    machineId: row.machine_id,
    runId: row.run_id ?? null,
    taskKey: row.task_key ?? null,
    scopeHash: row.scope_hash ?? null,
    paths: parsePaths(row.paths_json),
    exclusive: row.exclusive === 1,
    branch: row.branch ?? null,
    baseSha: row.base_sha ?? null,
    title: row.title ?? null,
    fence: row.fence,
    at: row.at,
    expiresAt: row.expires_at,
  };
}

const jsonBytes = (value) => utf8Length(JSON.stringify(value));

function cleanReason(reason, fallback, maxChars) {
  if (typeof reason !== 'string') return fallback;
  const text = reason.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, maxChars);
  return text || fallback;
}

/** Validate and normalise a claim body: protocol shapes first, then the path grammar. */
function checkClaim(claim, limits) {
  const checked = validateBody('claim', claim);
  if (!checked.ok) return { ok: false, error: 'bad-request', message: checked.error };
  const body = checked.body;
  const paths = normalizeClaimPaths(body.paths);
  if (!paths.ok) return { ok: false, error: 'bad-request', message: `claim.${paths.error}` };
  return {
    ok: true,
    claim: {
      machineId: body.machineId,
      runId: body.runId ?? null,
      taskKey: body.taskKey ?? null,
      scopeHash: body.scopeHash ?? null,
      paths: paths.paths,
      exclusive: body.exclusive,
      branch: body.branch || null,
      baseSha: body.baseSha || null,
      title: body.title || null,
      ttlMs: body.ttlMs ?? limits.ttlDefaultMs,
    },
  };
}

function roomRow(store, roomId) {
  return isOpaqueId(roomId) ? store.get('SELECT id, kind, status, owner_id FROM rooms WHERE id = ?', roomId) : undefined;
}

function liveRows(store, roomId, now) {
  return store.all(`SELECT * FROM leases WHERE room_id = ? AND ${LIVE} ORDER BY fence`, roomId, now);
}

function endLease(store, leaseId, reason, at) {
  store.run('UPDATE leases SET released_at = ?, release_reason = ? WHERE lease_id = ? AND released_at IS NULL', at, reason, leaseId);
}

const sameRun = (row, memberId, claim) =>
  claim.runId !== null && row.run_id === claim.runId && row.member_id === memberId && row.machine_id === claim.machineId;

function isReplay(row, memberId, claim, pathsJson) {
  return (
    sameRun(row, memberId, claim) &&
    row.exclusive === (claim.exclusive ? 1 : 0) &&
    row.paths_json === pathsJson &&
    (row.task_key ?? null) === claim.taskKey &&
    (row.scope_hash ?? null) === claim.scopeHash &&
    (row.branch ?? null) === claim.branch &&
    (row.base_sha ?? null) === claim.baseSha &&
    (row.title ?? null) === claim.title
  );
}

function keyOrNull(path) {
  try {
    return claimPathKey(path);
  } catch {
    return null; // stored paths are always normalised; a damaged row cannot block anyone
  }
}

function findConflicts(live, memberId, claim) {
  const mine = claim.paths.map(claimPathKey);
  const conflicts = [];
  for (const row of live) {
    if (row.exclusive !== 1 || sameRun(row, memberId, claim)) continue;
    const theirs = parsePaths(row.paths_json);
    const overlapping = theirs.filter((path) => {
      const key = keyOrNull(path);
      return key !== null && mine.some((own) => keysOverlap(own, key));
    });
    if (overlapping.length === 0) continue;
    conflicts.push({
      leaseId: row.lease_id,
      memberId: row.member_id,
      machineId: row.machine_id,
      runId: row.run_id ?? null,
      paths: theirs,
      overlapping,
      branch: row.branch ?? null,
      title: row.title ?? null,
      expiresAt: row.expires_at,
    });
  }
  return conflicts;
}

/** fence = ++last_fence for the room. Never below a fence already handed out, even if the fences row were lost. */
function nextFence(store, roomId) {
  const row = store.get(
    `INSERT INTO fences (room_id, last_fence)
       VALUES (?, COALESCE((SELECT MAX(fence) FROM leases WHERE room_id = ?), 0) + 1)
     ON CONFLICT (room_id) DO UPDATE SET last_fence = MAX(fences.last_fence + 1, excluded.last_fence)
     RETURNING last_fence`,
    roomId,
    roomId,
  );
  return row.last_fence;
}

// ---- Operations -------------------------------------------------------------------

function acquireWith(ctx, roomId, memberId, claim) {
  assertUserId(memberId, 'memberId');
  const { store, clock, limits } = ctx;
  const room = roomRow(store, roomId);
  if (!room) return { ok: false, error: 'not-found' };
  const checked = checkClaim(claim, limits);
  if (!checked.ok) return checked;
  if (!memberOfRoom(ctx, roomId, memberId)) return { ok: false, error: 'not-member' };
  if (room.kind !== 'cowork') return { ok: false, error: 'forbidden', message: 'claims are taken in cowork rooms only' };
  if (room.status !== 'active') return { ok: false, error: 'forbidden', message: `the room is ${room.status}` };
  const wanted = checked.claim;
  const pathsJson = JSON.stringify(wanted.paths);

  return store.transaction(() => {
    const now = clock.now();
    const live = liveRows(store, roomId, now);

    const replay = live.find((row) => isReplay(row, memberId, wanted, pathsJson));
    if (replay) {
      const expiresAt = now + wanted.ttlMs;
      store.run('UPDATE leases SET at = ?, expires_at = ? WHERE lease_id = ?', now, expiresAt, replay.lease_id);
      const lease = leaseFromRow({ ...replay, at: now, expires_at: expiresAt });
      return { ok: true, reused: true, roomId, leaseId: replay.lease_id, fence: replay.fence, expiresAt, lease };
    }

    if (wanted.exclusive && wanted.paths.length > 0) {
      const conflicts = findConflicts(live, memberId, wanted);
      if (conflicts.length > 0) return { ok: false, error: 'conflict', conflicts };
    }

    const own = live.filter((row) => row.member_id === memberId);
    if (live.length >= limits.perRoom) return { ok: false, error: 'limit', message: `a room holds at most ${limits.perRoom} live claims` };
    if (own.length >= limits.perMember) {
      return { ok: false, error: 'limit', message: `a member holds at most ${limits.perMember} live claims in a room` };
    }
    const expiresAt = now + wanted.ttlMs;
    const draft = leaseFromRow({
      lease_id: newId('lease'),
      member_id: memberId,
      machine_id: wanted.machineId,
      run_id: wanted.runId,
      task_key: wanted.taskKey,
      scope_hash: wanted.scopeHash,
      paths_json: pathsJson,
      exclusive: wanted.exclusive ? 1 : 0,
      branch: wanted.branch,
      base_sha: wanted.baseSha,
      title: wanted.title,
      fence: Number.MAX_SAFE_INTEGER, // the widest a fence can print; the real one is taken below
      at: now,
      expires_at: expiresAt,
    });
    const liveLeases = live.map(leaseFromRow);
    const memberBytes = own.reduce((sum, row) => sum + jsonBytes(leaseFromRow(row)), jsonBytes(draft));
    if (memberBytes > limits.memberBytes) return { ok: false, error: 'limit', message: 'your live claims in this room are too large; claim directories instead of many files' };
    if (jsonBytes({ type: 'claims', roomId, leases: [...liveLeases, draft] }) > limits.roomBytes) {
      return { ok: false, error: 'limit', message: 'the room holds too many claimed paths' };
    }

    const fence = nextFence(store, roomId);
    store.run(
      `INSERT INTO leases (lease_id, room_id, member_id, machine_id, run_id, task_key, scope_hash, paths_json, exclusive,
                           branch, base_sha, title, fence, at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      draft.leaseId,
      roomId,
      memberId,
      wanted.machineId,
      wanted.runId,
      wanted.taskKey,
      wanted.scopeHash,
      pathsJson,
      wanted.exclusive,
      wanted.branch,
      wanted.baseSha,
      wanted.title,
      fence,
      now,
      expiresAt,
    );
    return { ok: true, changed: true, roomId, leaseId: draft.leaseId, fence, expiresAt, lease: { ...draft, fence } };
  });
}

function heartbeatWith(ctx, leaseId, memberId) {
  assertUserId(memberId, 'memberId');
  if (!isOpaqueId(leaseId)) return gone();
  const { store, clock, limits } = ctx;
  return store.transaction(() => {
    const now = clock.now();
    const row = store.get('SELECT * FROM leases WHERE lease_id = ?', leaseId);
    if (!row || row.member_id !== memberId || row.released_at !== null) return gone();
    if (row.expires_at <= now) {
      endLease(store, leaseId, RELEASE_REASONS.expired, row.expires_at);
      return gone(row.room_id);
    }
    const room = roomRow(store, row.room_id);
    if (!room || room.status === 'closed') {
      endLease(store, leaseId, RELEASE_REASONS.roomClosed, now);
      return gone(row.room_id);
    }
    if (!memberOfRoom(ctx, row.room_id, memberId)) {
      endLease(store, leaseId, RELEASE_REASONS.notMember, now);
      return gone(row.room_id);
    }
    const ttlMs = Math.min(limits.ttlMaxMs, Math.max(limits.ttlMinMs, row.expires_at - row.at));
    const expiresAt = now + ttlMs;
    store.run('UPDATE leases SET at = ?, expires_at = ? WHERE lease_id = ?', now, expiresAt, leaseId);
    return { ok: true, leaseId, roomId: row.room_id, fence: row.fence, expiresAt };
  });
}

function releaseWith(ctx, leaseId, memberId, reason) {
  assertUserId(memberId, 'memberId');
  if (!isOpaqueId(leaseId)) return gone();
  const { store, clock, limits } = ctx;
  return store.transaction(() => {
    const now = clock.now();
    const row = store.get('SELECT * FROM leases WHERE lease_id = ?', leaseId);
    if (!row || row.member_id !== memberId || row.released_at !== null) return gone();
    if (row.expires_at <= now) {
      endLease(store, leaseId, RELEASE_REASONS.expired, row.expires_at);
      return gone(row.room_id);
    }
    endLease(store, leaseId, cleanReason(reason, RELEASE_REASONS.released, limits.reasonChars), now);
    return { ok: true, changed: true, leaseId, roomId: row.room_id };
  });
}

function forceReleaseWith(ctx, leaseId, actorId, reason) {
  assertUserId(actorId, 'actorId');
  if (!isOpaqueId(leaseId)) return gone();
  const { store, clock, limits } = ctx;
  return store.transaction(() => {
    const now = clock.now();
    const row = store.get('SELECT * FROM leases WHERE lease_id = ?', leaseId);
    if (!row || row.released_at !== null) return gone();
    if (row.expires_at <= now) {
      endLease(store, leaseId, RELEASE_REASONS.expired, row.expires_at);
      return gone(row.room_id);
    }
    endLease(store, leaseId, RELEASE_REASONS.forced, now);
    const detail = { leaseId, fence: row.fence, reason: cleanReason(reason, null, limits.reasonChars) };
    store.run(
      'INSERT INTO audit (kind, actor_id, target_id, room_id, detail, at) VALUES (?, ?, ?, ?, ?, ?)',
      FORCE_RELEASE_AUDIT_KIND,
      actorId,
      row.member_id,
      row.room_id,
      JSON.stringify(detail),
      now,
    );
    return { ok: true, changed: true, leaseId, roomId: row.room_id, memberId: row.member_id };
  });
}

function expireSweepWith(ctx, now) {
  const { store, clock } = ctx;
  const at = now ?? clock.now();
  return store.transaction(() => {
    const rows = store.all('SELECT lease_id, room_id FROM leases WHERE released_at IS NULL AND expires_at <= ? ORDER BY room_id, fence', at);
    if (rows.length > 0) {
      store.run('UPDATE leases SET released_at = expires_at, release_reason = ? WHERE released_at IS NULL AND expires_at <= ?', RELEASE_REASONS.expired, at);
    }
    return { count: rows.length, roomIds: [...new Set(rows.map((row) => row.room_id))], leaseIds: rows.map((row) => row.lease_id) };
  });
}

function listWith(ctx, roomId) {
  if (!isOpaqueId(roomId)) return [];
  const { store, clock, limits } = ctx;
  return store
    .all(`SELECT * FROM leases WHERE room_id = ? AND ${LIVE} ORDER BY fence LIMIT ?`, roomId, clock.now(), limits.perRoom)
    .map(leaseFromRow);
}

/** One lease by id, live or not: { leaseId, roomId, memberId, live, releaseReason, lease } | null. */
function lookupWith(ctx, leaseId) {
  if (!isOpaqueId(leaseId)) return null;
  const row = ctx.store.get('SELECT * FROM leases WHERE lease_id = ?', leaseId);
  if (!row) return null;
  return {
    leaseId,
    roomId: row.room_id,
    memberId: row.member_id,
    live: row.released_at === null && row.expires_at > ctx.clock.now(),
    releaseReason: row.release_reason ?? null,
    lease: leaseFromRow(row),
  };
}

/** Release every live lease of one member in a room (they left or were removed). */
function releaseMemberWith(ctx, roomId, memberId, reason = RELEASE_REASONS.notMember) {
  assertUserId(memberId, 'memberId');
  if (!isOpaqueId(roomId)) return { count: 0, roomId, leaseIds: [] };
  const { store, clock, limits } = ctx;
  return store.transaction(() => {
    const now = clock.now();
    const rows = store.all(`SELECT lease_id FROM leases WHERE room_id = ? AND member_id = ? AND ${LIVE}`, roomId, memberId, now);
    if (rows.length > 0) {
      store.run(
        `UPDATE leases SET released_at = ?, release_reason = ? WHERE room_id = ? AND member_id = ? AND ${LIVE}`,
        now,
        cleanReason(reason, RELEASE_REASONS.notMember, limits.reasonChars),
        roomId,
        memberId,
        now,
      );
    }
    return { count: rows.length, changed: rows.length > 0, roomId, leaseIds: rows.map((row) => row.lease_id) };
  });
}

/** Release every live lease in a room (it was locked for good or closed). */
function releaseRoomWith(ctx, roomId, reason = RELEASE_REASONS.roomClosed) {
  if (!isOpaqueId(roomId)) return { count: 0, roomId, leaseIds: [] };
  const { store, clock, limits } = ctx;
  return store.transaction(() => {
    const now = clock.now();
    const rows = store.all(`SELECT lease_id FROM leases WHERE room_id = ? AND ${LIVE}`, roomId, now);
    if (rows.length > 0) {
      store.run(
        `UPDATE leases SET released_at = ?, release_reason = ? WHERE room_id = ? AND ${LIVE}`,
        now,
        cleanReason(reason, RELEASE_REASONS.roomClosed, limits.reasonChars),
        roomId,
        now,
      );
    }
    return { count: rows.length, changed: rows.length > 0, roomId, leaseIds: rows.map((row) => row.lease_id) };
  });
}

/** The room a claim would go to: { id, kind, status, ownerId } | null. */
function roomInfoWith(ctx, roomId) {
  const row = roomRow(ctx.store, roomId);
  return row ? { id: row.id, kind: row.kind, status: row.status, ownerId: row.owner_id ?? null } : null;
}

// ---- Public API ---------------------------------------------------------------------

/**
 * createLeases({ store, clock?, isRoomMember?, limits? }) -> the lease authority.
 * clock defaults to the store's clock; isRoomMember defaults to a room_members
 * lookup; limits overrides LEASE_LIMITS (tests use small caps).
 */
export function createLeases(deps) {
  const ctx = resolve(deps);
  return Object.freeze({
    limits: ctx.limits,
    acquire: (roomId, memberId, claim) => acquireWith(ctx, roomId, memberId, claim),
    heartbeat: (leaseId, memberId) => heartbeatWith(ctx, leaseId, memberId),
    release: (leaseId, memberId, reason) => releaseWith(ctx, leaseId, memberId, reason),
    forceRelease: (leaseId, actorId, reason) => forceReleaseWith(ctx, leaseId, actorId, reason),
    expireSweep: (now) => expireSweepWith(ctx, now),
    list: (roomId) => listWith(ctx, roomId),
    lookup: (leaseId) => lookupWith(ctx, leaseId),
    roomInfo: (roomId) => roomInfoWith(ctx, roomId),
    isMember: (roomId, userId) => memberOfRoom(ctx, roomId, userId),
    releaseMember: (roomId, memberId, reason) => releaseMemberWith(ctx, roomId, memberId, reason),
    releaseRoom: (roomId, reason) => releaseRoomWith(ctx, roomId, reason),
  });
}

export function acquire(deps, roomId, memberId, claim) {
  return acquireWith(resolve(deps), roomId, memberId, claim);
}

export function heartbeat(deps, leaseId, memberId) {
  return heartbeatWith(resolve(deps), leaseId, memberId);
}

export function release(deps, leaseId, memberId, reason) {
  return releaseWith(resolve(deps), leaseId, memberId, reason);
}

export function forceRelease(deps, leaseId, actorId, reason) {
  return forceReleaseWith(resolve(deps), leaseId, actorId, reason);
}

export function expireSweep(deps, now) {
  return expireSweepWith(resolve(deps), now);
}

export function list(deps, roomId) {
  return listWith(resolve(deps), roomId);
}
