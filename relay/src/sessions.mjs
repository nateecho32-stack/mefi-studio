// Signing in to the relay, and the relay's own session tokens.
//
// Studio sends its Discord access token (from the public-client app "Mefi
// Studio Link") to POST /v1/session. The relay asks Discord who it belongs to
// (GET /oauth2/@me: minted for STUDIO_APP_ID, the identify and
// guilds.members.read scopes, not expired), then reads the member with that
// same token (GET /users/@me/guilds/<guild>/member: roles, join date,
// timeout). No bot token is involved. The access token itself is never
// stored or logged: only a keyed hash of it, so a renewal 14 minutes later
// does not have to ask Discord who it is again.
//
// The relay answers with a stateless session token, the Void Engine hub's format:
//
//   v1.<base64url JSON {uid, sid, iat, exp, ro?, n}>.<base64url HMAC-SHA256>
//
// Sessions last 15 minutes. A timed-out, pending or suspended member gets a
// read-only session. Signing out or a moderator's suspension revokes sessions
// (the revoked table) until they would have expired anyway.

import { LIMITS } from './protocol.mjs';
import { DAY_MS, MINUTE_MS, SECOND_MS, b64url, cleanLine, fromB64url, hmac, isSnowflake, randomBytes, sameBytes } from './util.mjs';

export const SESSION_TTL_MS = LIMITS.sessionTtlMs; // 15 minutes
export const NEW_MEMBER_MS = DAY_MS; // joined under 24 h: no rooms of your own, no links
export const MEMBER_FRESH_MS = 30 * MINUTE_MS; // a renewal re-reads the member after this
export const MEMBER_STALE_OK_MS = DAY_MS; // when Discord is down, a snapshot this young still signs you in
export const TOKEN_CACHE_MAX_MS = 7 * DAY_MS;
export const DISCORD_TIMEOUT_MS = 8 * SECOND_MS;
export const REQUIRED_SCOPES = Object.freeze(['identify', 'guilds.members.read']);

const MAX_SKEW_MS = MINUTE_MS;
const SID = /^[A-Za-z0-9_-]{16,64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

/** The relay's config from Worker vars (strings), with defaults. */
export function readConfig(env = {}) {
  const ids = (text) => String(text ?? '').split(/[\s,]+/).filter((id) => isSnowflake(id));
  let roleIds = {};
  try {
    const parsed = JSON.parse(env.ROLE_IDS_JSON || '{}');
    for (const [key, id] of Object.entries(parsed ?? {})) if (/^[a-z_]{1,32}$/.test(key) && isSnowflake(String(id))) roleIds[key] = String(id);
  } catch {
    roleIds = {};
  }
  // A local fake Discord for `wrangler dev` smoke runs: honoured only on a loopback http address.
  const apiBase = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(String(env.DISCORD_API_BASE ?? '')) ? env.DISCORD_API_BASE : 'https://discord.com/api/v10';
  return Object.freeze({
    studioAppId: isSnowflake(String(env.STUDIO_APP_ID ?? '')) ? String(env.STUDIO_APP_ID) : '',
    guildId: isSnowflake(String(env.GUILD_ID ?? '')) ? String(env.GUILD_ID) : '1345380333302059129',
    modRoleIds: ids(env.MOD_ROLE_IDS),
    ownerIds: ids(env.OWNER_IDS),
    roleIds: Object.freeze(roleIds),
    paused: String(env.PAUSED ?? '') === 'true',
    apiBase,
  });
}

/** What the rules need to know about a member row: { isMod, isRoomHost, isNew, timedOut, readOnly, roleKeys }. */
export function describeMember(row, now) {
  if (!row) return null;
  let roleKeys = [];
  try {
    roleKeys = JSON.parse(row.role_keys ?? '[]');
  } catch {
    roleKeys = [];
  }
  const timedOut = Number(row.timed_out_until ?? 0) > now;
  const suspended = Number(row.suspended_until ?? 0) > now;
  const joinedAt = Number.isFinite(row.joined_at) ? row.joined_at : null;
  return {
    id: row.user_id,
    name: row.name,
    roleKeys,
    isMod: row.is_mod === 1,
    isRoomHost: roleKeys.includes('room_host'),
    // An unknown join time counts as new: the friction errs on the safe side.
    isNew: joinedAt === null || now - joinedAt < NEW_MEMBER_MS,
    joinedAt,
    timedOut,
    suspended,
    readOnly: timedOut || suspended || row.pending === 1,
  };
}

async function discordGet(fetchImpl, url, accessToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCORD_TIMEOUT_MS);
  try {
    // Workers' fetch has no redirect: 'error'; 'manual' plus refusing any 3xx does the same.
    const response = await fetchImpl(url, { method: 'GET', headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, signal: controller.signal, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) return { status: 0, body: null, retryAfter: 5000 };
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body, retryAfter: retryAfterMs(response, body) };
  } catch {
    return { status: 0, body: null, retryAfter: 5000 };
  } finally {
    clearTimeout(timer);
  }
}

function retryAfterMs(response, body) {
  const header = Number(response.headers?.get?.('retry-after'));
  if (Number.isFinite(header) && header >= 0) return Math.ceil(header * 1000);
  const field = Number(body?.retry_after);
  return Number.isFinite(field) && field >= 0 ? Math.ceil(field * 1000) : 5000;
}

/**
 * createSessions({ store, keys, config, fetch, now })
 *   keys: { session, token } HMAC keys (crypto.subtle) derived from the relay secret
 * -> { signIn, verify, revokeSid, revokeUser, member, name }
 */
export function createSessions({ store, keys, config, fetch: fetchImpl, now }) {
  const memberRow = (uid) => store.get('SELECT * FROM members WHERE user_id = ?', uid);

  async function mint({ uid, name, readOnly }) {
    const iat = now();
    const claims = { uid, sid: b64url(randomBytes(18)), iat, exp: iat + SESSION_TTL_MS, n: name };
    if (readOnly) claims.ro = 1;
    const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
    const mac = b64url(await hmac(keys.session, `v1.${payload}`));
    return { token: `v1.${payload}.${mac}`, claims };
  }

  /** verify(token) -> { ok: true, claims } | { ok: false, error: 'unauthorized' | 'expired' } */
  async function verify(token, { checkRevoked = true } = {}) {
    if (typeof token !== 'string' || token.length > LIMITS.sessionChars) return fail('unauthorized');
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1' || !B64URL.test(parts[1]) || !B64URL.test(parts[2])) return fail('unauthorized');
    const expected = await hmac(keys.session, `v1.${parts[1]}`);
    let given;
    try {
      given = fromB64url(parts[2]);
    } catch {
      return fail('unauthorized');
    }
    if (!sameBytes(expected, given)) return fail('unauthorized');
    let claims;
    try {
      claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    } catch {
      return fail('unauthorized');
    }
    if (!isSnowflake(claims?.uid) || !SID.test(String(claims?.sid)) || !Number.isFinite(claims?.iat) || !Number.isFinite(claims?.exp)) return fail('unauthorized');
    if (claims.exp - claims.iat > DAY_MS || claims.iat > now() + MAX_SKEW_MS) return fail('unauthorized');
    if (claims.exp <= now()) return fail('expired');
    if (checkRevoked) {
      const hit = store.get(
        `SELECT 1 AS yes FROM revoked WHERE until > ?1 AND ((kind = 'sid' AND key = ?2) OR (kind = 'uid' AND key = ?3 AND not_before >= ?4))`,
        now(),
        claims.sid,
        claims.uid,
        claims.iat,
      );
      if (hit) return fail('unauthorized');
    }
    return { ok: true, claims: { ...claims, readOnly: claims.ro === 1, name: typeof claims.n === 'string' ? claims.n : 'member' } };
  }

  function revokeSid(sid, until = now() + SESSION_TTL_MS) {
    if (!SID.test(String(sid))) return;
    store.run(`INSERT INTO revoked (kind, key, not_before, until) VALUES ('sid', ?, ?, ?) ON CONFLICT (kind, key) DO UPDATE SET until = MAX(until, excluded.until)`, sid, now(), until);
  }

  /** Every session of a member issued up to now stops working. */
  function revokeUser(uid) {
    if (!isSnowflake(uid)) return;
    const at = now();
    store.run(
      `INSERT INTO revoked (kind, key, not_before, until) VALUES ('uid', ?, ?, ?) ON CONFLICT (kind, key) DO UPDATE SET not_before = excluded.not_before, until = excluded.until`,
      uid,
      at,
      at + SESSION_TTL_MS + MAX_SKEW_MS,
    );
  }

  /** The member row as Discord last described it, written only when something changed or it is stale. */
  function saveMember(uid, user, member, at) {
    const roles = Array.isArray(member?.roles) ? member.roles.map(String) : [];
    const held = new Set(roles);
    const roleKeys = Object.entries(config.roleIds).filter(([, id]) => held.has(id)).map(([key]) => key).sort();
    const isMod = config.ownerIds.includes(uid) || config.modRoleIds.some((id) => held.has(id)) ? 1 : 0;
    const name = cleanLine(member?.nick || user?.global_name || user?.username || '', 64) || 'member';
    const joinedAt = Date.parse(member?.joined_at ?? '');
    const timedOut = Date.parse(member?.communication_disabled_until ?? '');
    const row = {
      name,
      name_key: name.toLowerCase(),
      role_keys: JSON.stringify(roleKeys),
      is_mod: isMod,
      joined_at: Number.isFinite(joinedAt) ? joinedAt : null,
      timed_out_until: Number.isFinite(timedOut) ? timedOut : null,
      pending: member?.pending === true ? 1 : 0,
    };
    store.run(
      `INSERT INTO members (user_id, name, name_key, role_keys, is_mod, joined_at, timed_out_until, pending, checked_at, first_seen, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?9)
       ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key, role_keys = excluded.role_keys,
         is_mod = excluded.is_mod, joined_at = excluded.joined_at, timed_out_until = excluded.timed_out_until,
         pending = excluded.pending, checked_at = excluded.checked_at, last_seen = excluded.last_seen`,
      uid,
      row.name,
      row.name_key,
      row.role_keys,
      row.is_mod,
      row.joined_at,
      row.timed_out_until,
      row.pending,
      at,
    );
    return memberRow(uid);
  }

  /** Who a Discord token belongs to: { ok, uid, user, expiresAt } or a failure. */
  async function whoIs(accessToken, at) {
    const answer = await discordGet(fetchImpl, `${config.apiBase}/oauth2/@me`, accessToken);
    if (answer.status === 401 || answer.status === 403) return fail('unauthorized');
    if (answer.status === 429) return fail('rate-limited', { retryAfter: answer.retryAfter });
    if (answer.status !== 200 || !answer.body) return fail('unavailable', { retryAfter: answer.retryAfter });
    const info = answer.body;
    if (!config.studioAppId || String(info.application?.id ?? '') !== config.studioAppId) return fail('unauthorized');
    const scopes = Array.isArray(info.scopes) ? info.scopes : [];
    if (!REQUIRED_SCOPES.every((scope) => scopes.includes(scope))) return fail('unauthorized');
    const expiresAt = Date.parse(info.expires ?? '');
    if (Number.isFinite(expiresAt) && expiresAt <= at) return fail('unauthorized');
    const user = info.user;
    if (!user || !isSnowflake(String(user.id)) || user.bot) return fail('unauthorized');
    return { ok: true, uid: String(user.id), user, expiresAt: Number.isFinite(expiresAt) ? expiresAt : at + DAY_MS };
  }

  async function readMember(accessToken) {
    const answer = await discordGet(fetchImpl, `${config.apiBase}/users/@me/guilds/${config.guildId}/member`, accessToken);
    if (answer.status === 404) return fail('not-member');
    if (answer.status === 401 || answer.status === 403) return fail('unauthorized');
    if (answer.status === 429) return fail('rate-limited', { retryAfter: answer.retryAfter });
    if (answer.status !== 200 || !answer.body) return fail('unavailable', { retryAfter: answer.retryAfter });
    return { ok: true, member: answer.body };
  }

  /**
   * signIn(accessToken) -> { ok: true, session, expiresAt, user: { id, name }, readOnly }
   *                      | { ok: false, error: unauthorized | not-member | rate-limited | unavailable, retryAfter? }
   * Every await happens before the one synchronous write at the end.
   */
  async function signIn(accessToken) {
    if (typeof accessToken !== 'string' || !accessToken || accessToken.length > LIMITS.accessTokenChars) return fail('unauthorized');
    if (!config.studioAppId) return fail('unavailable', { reason: 'not-configured', retryAfter: 60_000 });
    const at = now();
    const hash = b64url(await hmac(keys.token, accessToken));
    const cached = store.get('SELECT user_id FROM token_cache WHERE hash = ? AND expires_at > ?', hash, at);
    let uid = cached?.user_id ?? null;
    let user = null;
    let tokenExpires = null;
    if (!uid) {
      const who = await whoIs(accessToken, at);
      if (!who.ok) return who;
      ({ uid, user } = who);
      tokenExpires = Math.min(who.expiresAt, at + TOKEN_CACHE_MAX_MS);
    }
    let row = memberRow(uid);
    let freshMember = null;
    if (!row || at - row.checked_at >= MEMBER_FRESH_MS) {
      const read = await readMember(accessToken);
      if (read.ok) freshMember = read.member;
      else if (read.error === 'not-member' || read.error === 'unauthorized') {
        if (read.error === 'not-member' && row) store.run('UPDATE members SET checked_at = ? WHERE user_id = ?', 0, uid);
        return read;
      } else if (!row || at - row.checked_at >= MEMBER_STALE_OK_MS) return read; // Discord is down and the snapshot is too old
    }
    // One synchronous write: the token hash, the member snapshot.
    store.transaction(() => {
      if (tokenExpires) store.run('INSERT INTO token_cache (hash, user_id, expires_at) VALUES (?, ?, ?) ON CONFLICT (hash) DO UPDATE SET expires_at = excluded.expires_at', hash, uid, tokenExpires);
      if (freshMember) row = saveMember(uid, freshMember.user ?? user, freshMember, at);
      else if (at - row.last_seen >= MEMBER_FRESH_MS) store.run('UPDATE members SET last_seen = ? WHERE user_id = ?', at, uid);
    });
    const info = describeMember(row, at);
    const { token, claims } = await mint({ uid, name: info.name, readOnly: info.readOnly });
    return { ok: true, session: token, expiresAt: claims.exp, user: { id: uid, name: info.name }, readOnly: info.readOnly };
  }

  return Object.freeze({
    signIn,
    verify,
    revokeSid,
    revokeUser,
    mint,
    // OWNER_IDS count at once, not only after the member's next Discord check.
    member: (uid) => {
      const info = describeMember(memberRow(uid), now());
      if (info && config.ownerIds.includes(uid)) info.isMod = true;
      return info;
    },
  });
}
