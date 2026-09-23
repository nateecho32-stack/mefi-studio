// Mefi's Studio AI+ — community rules: when the weekly "join the Void Engine
// Discord" card is due, when a linked account is re-checked, and what a link
// entitles the user to (the Void collection of themes and node styles).
//
// The unlock is an honest soft lock. Studio is MIT-licensed, so anyone can flip
// SELF_UNLOCKED below in their own fork and every perk unlocks without Discord;
// the locked cards say so in FORK_COPY and offer AGENT_PROMPT for an agent to
// do it. There is no obfuscation to defeat and none should be added.
//
// Membership is read with the user's own Discord login (scripts/discord-oauth.cjs
// does the network half), so a check never depends on a bot being online. A
// failed check is not a revoke: the perks stay on for GRACE_MS after the last
// good answer, and only a definite "not a member" takes them away at once.
// Invites are never rewarded here or anywhere else (Discord's platform policy
// forbids inducing server joins); the unlock condition is plain membership.
//
// Pure module: no Electron, no filesystem, no network. Time is injectable: a
// function that reads the time takes `now`, falling back to the clock only when
// the caller passes none. node:crypto is the one require, for PKCE. Every
// function accepts garbage and never throws, because its input is whatever
// settings.json held when the app started.

"use strict";

const crypto = require("node:crypto");

// ---- the Void Engine server and the "Mefi Studio Link" app -------------------

const GUILD_ID = "1345380333302059129";
const INVITE_URL = "https://discord.gg/xgfKc5pVxG";
// The public-client application Studio logs in with (no client secret; PKCE).
// Empty until the app is registered; main also honours the environment
// variable MEFI_STUDIO_DISCORD_CLIENT_ID, and an empty id means "not configured".
const CLIENT_ID = "";
// Registered redirects http://127.0.0.1:<port>/callback, tried in order.
const REDIRECT_PORTS = Object.freeze([53134, 53135, 53136]);
const SCOPES = Object.freeze(["identify", "guilds.members.read"]);

// THE FORK SWITCH. Set this to true in your own fork and every perk below is
// unlocked for you, with no Discord account and no network request. This is
// deliberate and documented (README "Community & perks", docs/community.md):
// the Void collection is a thank-you to community members, not DRM.
const SELF_UNLOCKED = false;

// Discord role id -> extra perk names. Phase 2 (the Void Engine bot) fills this
// for participation roles; plain membership already grants "premium".
const ROLE_PERKS = Object.freeze({});

const PERKS = Object.freeze({
  premium: Object.freeze({ label: "Void collection", detail: "4 themes and 3 node styles" }),
});

const FORK_COPY = "Members of the Void Engine Discord unlock these. Studio is MIT-licensed: fork the project and unlock it yourself, or ask an agent to do it for you.";
const AGENT_PROMPT = "In my fork of Mefi's Studio AI+, set SELF_UNLOCKED to true in scripts/community.cjs so the Void collection themes and node styles unlock without Discord, then run npm run check and npm test.";

// ---- cadence -----------------------------------------------------------------

const DAY = 86_400_000;
const HOUR = DAY / 24;
const GRACE_MS = 14 * DAY; // perks survive this long after the last good check
const CHECK_EVERY_MS = 7 * DAY; // the access token lives 7 days; so does a check
const FIRST_PROMPT_MS = 3 * DAY; // no card in the first three days after install
const PROMPT_EVERY_MS = 7 * DAY;
const BACKOFF_EVERY_MS = 30 * DAY; // after BACKOFF_AFTER ignored showings
const BACKOFF_AFTER = 4;
const CHECK_THROTTLE_MS = 60_000; // "Check now" at most once a minute
const RETRY_STEPS_MS = Object.freeze([HOUR, 6 * HOUR, 24 * HOUR]);

const LINK_STATES = Object.freeze(["ok", "not-member", "relink", "offline", "session"]);
// The card actions applyPrompt knows. main.cjs builds its community:prompt
// gate from this list, so the two cannot drift apart.
const PROMPT_ACTIONS = Object.freeze(["shown", "snooze", "never", "reset", "joined"]);

// ---- normalising what settings.json holds -------------------------------------

const CONTROL = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;
const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const time = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
const text = (value, limit) => (typeof value === "string" ? value.replace(CONTROL, "").trim().slice(0, limit) : "");
const count = (value) => (Number.isSafeInteger(value) && value > 0 ? Math.min(value, 1_000_000) : 0);
const clock = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
// The options bag every function destructures. A `= {}` default covers only
// undefined, so null (or any non-object) is swapped for {} before destructuring.
const bag = (value) => (object(value) ? value : {});

function roleList(value) {
  if (!Array.isArray(value)) return [];
  const roles = [];
  for (const entry of value.slice(0, 500)) {
    const role = text(entry, 64);
    if (role && !roles.includes(role)) roles.push(role);
  }
  return roles.slice(0, 250);
}

// Discord sends `joined_at` as an ISO string; the link keeps milliseconds.
function joinedTime(value) {
  if (typeof value === "number") return time(value);
  if (typeof value !== "string" || value.length > 64) return null;
  return time(Date.parse(value));
}

// Only the listed fields survive, so a token that strayed into the object on
// its way to settings.json is dropped here rather than written to disk.
function normalizeLink(raw) {
  if (!object(raw)) return null;
  const userId = text(raw.userId, 64);
  if (!userId) return null;
  return {
    userId,
    username: text(raw.username, 64),
    globalName: text(raw.globalName, 64) || null,
    roles: roleList(raw.roles),
    joinedAt: time(raw.joinedAt),
    linkedAt: time(raw.linkedAt),
    checkedAt: time(raw.checkedAt),
    lastOkAt: time(raw.lastOkAt),
    nextCheckAt: time(raw.nextCheckAt),
    // An unreadable state is treated as a failed check: grace still applies
    // and the next check settles it.
    state: LINK_STATES.includes(raw.state) ? raw.state : "offline",
    failures: count(raw.failures),
  };
}

function normalize(raw) {
  const source = object(raw) ? raw : {};
  const prompt = object(source.prompt) ? source.prompt : {};
  return {
    firstSeenAt: time(source.firstSeenAt),
    prompt: {
      lastShownAt: time(prompt.lastShownAt),
      snoozeUntil: time(prompt.snoozeUntil),
      never: prompt.never === true,
      shown: count(prompt.shown),
    },
    link: normalizeLink(source.link),
  };
}

// ---- the weekly card ----------------------------------------------------------

// Whether the card may be shown now. "At most once per session" is the
// renderer's job; this answers only the persisted cadence. `entitled` is a
// boolean or an entitlement object; nobody who already has the perks is asked.
function promptDue(options) {
  const { state, now = Date.now(), entitled = false } = bag(options);
  const at = clock(now);
  if (at == null) return false;
  if (entitled === true || (object(entitled) && entitled.premium === true)) return false;
  const { firstSeenAt, prompt } = normalize(state);
  if (prompt.never || firstSeenAt == null) return false;
  if (at < firstSeenAt + FIRST_PROMPT_MS) return false;
  if (prompt.lastShownAt != null) {
    const every = prompt.shown >= BACKOFF_AFTER ? BACKOFF_EVERY_MS : PROMPT_EVERY_MS;
    if (at < prompt.lastShownAt + every) return false;
  }
  if (prompt.snoozeUntil != null && at < prompt.snoozeUntil) return false;
  return true;
}

// shown: the card appeared. snooze: "Not now". never: "Don't show again".
// reset: Settings asks for the card back. joined: "Join the Discord" was
// clicked, so the ignored-showings count starts over and the card waits a day
// (long enough to join and come back to link).
function applyPrompt(options) {
  const { state, action, now = Date.now() } = bag(options);
  const next = normalize(state);
  const at = clock(now);
  if (at == null || !PROMPT_ACTIONS.includes(action)) return next;
  const prompt = { ...next.prompt };
  if (action === "shown") {
    prompt.lastShownAt = at;
    prompt.shown = Math.min(prompt.shown + 1, 1_000_000);
  } else if (action === "snooze") {
    prompt.snoozeUntil = at + PROMPT_EVERY_MS;
  } else if (action === "never") {
    prompt.never = true;
  } else if (action === "reset") {
    prompt.never = false;
    prompt.snoozeUntil = null;
    prompt.shown = 0;
  } else if (action === "joined") {
    prompt.shown = 0;
    prompt.snoozeUntil = at + DAY;
  }
  return { ...next, prompt };
}

// ---- the weekly re-check --------------------------------------------------------

function checkDue(options) {
  const { link, now = Date.now() } = bag(options);
  const at = clock(now);
  const current = normalizeLink(link);
  if (at == null || !current) return false;
  const due = current.nextCheckAt ?? (current.checkedAt == null ? null : current.checkedAt + CHECK_EVERY_MS);
  return due == null || at >= due;
}

// A failed check retries after 1 h, then 6 h, then daily. `failures` counts the
// one that just happened. A server that asks for longer (Retry-After) wins,
// up to the weekly cadence.
function nextCheckAfterFailure(options) {
  const { failures, now = Date.now(), retryAfterMs } = bag(options);
  const at = clock(now) ?? 0;
  const index = Math.min(Math.max(count(failures), 1), RETRY_STEPS_MS.length) - 1;
  let delay = RETRY_STEPS_MS[index];
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > delay) {
    delay = Math.min(retryAfterMs, CHECK_EVERY_MS);
  }
  return at + delay;
}

function userFields(user) {
  if (!object(user)) return null;
  const userId = text(typeof user.id === "number" ? String(user.id) : user.id, 64);
  if (!userId) return null;
  return {
    userId,
    username: text(user.username, 64),
    globalName: text(user.globalName ?? user.global_name, 64) || null,
  };
}

// Folds one answer from scripts/discord-oauth.cjs into the saved link. With no
// link yet, an answer that names a user starts one (the first authorize).
// A result that is not an object changes nothing.
function recordCheck(options) {
  const { link, result, now = Date.now() } = bag(options);
  const current = normalizeLink(link);
  const at = clock(now);
  if (!object(result) || at == null) return current;
  const who = userFields(result.user);
  let next = current;
  if (who && (!current || current.userId !== who.userId)) {
    next = normalizeLink({ ...who, linkedAt: at, roles: [], state: "offline" });
  } else if (who) {
    next = { ...current, username: who.username || current.username, globalName: who.globalName ?? current.globalName };
  }
  if (!next) return null;

  if (result.ok === true) {
    const member = object(result.member) ? result.member : null;
    return {
      ...next,
      roles: member ? roleList(member.roles) : next.roles,
      joinedAt: member ? joinedTime(member.joined_at ?? member.joinedAt) ?? next.joinedAt : next.joinedAt,
      checkedAt: at,
      lastOkAt: at,
      nextCheckAt: at + CHECK_EVERY_MS,
      state: "ok",
      failures: 0,
    };
  }
  if (result.error === "not-member") {
    return { ...next, roles: [], checkedAt: at, nextCheckAt: at + CHECK_EVERY_MS, state: "not-member", failures: 0 };
  }
  if (result.error === "auth") {
    // The grant is gone (revoked, or the refresh token was refused). Perks run
    // out with the grace period; the card offers "Link again".
    return { ...next, checkedAt: at, nextCheckAt: at + CHECK_EVERY_MS, state: "relink", failures: 0 };
  }
  // network, rate-limit and anything unrecognised: transient, back off.
  const failures = Math.min(next.failures + 1, 1_000_000);
  return {
    ...next,
    checkedAt: at,
    nextCheckAt: nextCheckAfterFailure({ failures, now: at, retryAfterMs: result.retryAfterMs }),
    state: "offline",
    failures,
  };
}

// ---- entitlement ----------------------------------------------------------------

function rolePerkList(roles, rolePerks) {
  const perks = [];
  if (!object(rolePerks)) return perks;
  for (const role of roles) {
    if (!Object.hasOwn(rolePerks, role) || !Array.isArray(rolePerks[role])) continue;
    for (const perk of rolePerks[role]) {
      const name = text(perk, 64);
      if (name && !perks.includes(name)) perks.push(name);
    }
  }
  return perks;
}

function allPerks(rolePerks = ROLE_PERKS) {
  const perks = Object.keys(PERKS);
  if (!object(rolePerks)) return perks;
  for (const list of Object.values(rolePerks)) {
    for (const perk of Array.isArray(list) ? list : []) {
      const name = text(perk, 64);
      if (name && !perks.includes(name)) perks.push(name);
    }
  }
  return perks;
}

// reason: self (the fork switch), member (a good check within grace), grace
// (the last check failed or needs a relink, but the last good one is recent),
// not-member (revoked at once), unlinked, expired (grace ran out). A "session"
// link (no safeStorage, so nothing was persisted) is a live member link.
function entitlement(options) {
  const { link, now = Date.now(), selfUnlocked = SELF_UNLOCKED, rolePerks = ROLE_PERKS } = bag(options);
  if (selfUnlocked === true) return { premium: true, perks: allPerks(rolePerks), validUntil: null, reason: "self" };
  const current = normalizeLink(link);
  if (!current) return { premium: false, perks: [], validUntil: null, reason: "unlinked" };
  if (current.state === "not-member") return { premium: false, perks: [], validUntil: null, reason: "not-member" };
  if (current.lastOkAt == null) return { premium: false, perks: [], validUntil: null, reason: "expired" };
  const validUntil = current.lastOkAt + GRACE_MS;
  const at = clock(now);
  if (at == null || at >= validUntil) return { premium: false, perks: [], validUntil, reason: "expired" };
  const perks = ["premium", ...rolePerkList(current.roles, rolePerks).filter((perk) => perk !== "premium")];
  const reason = current.state === "ok" || current.state === "session" ? "member" : "grace";
  return { premium: true, perks, validUntil, reason };
}

// ---- links --------------------------------------------------------------------

const ALLOWED_HOSTS = Object.freeze(["discord.gg", "discord.com", "www.discord.com"]);

// Names only: the renderer asks for "invite" or "server" and main opens the
// hard-coded URL, so no renderer-supplied URL ever reaches openExternal.
function linkTarget(name) {
  if (name === "invite") return INVITE_URL;
  if (name === "server") return `https://discord.com/channels/${GUILD_ID}`;
  return null;
}

// https, one of three exact hosts, no userinfo, no port (not even :443), and no
// whitespace or control characters the URL parser would quietly drop. The raw
// string must begin with the canonical origin, which also refuses
// percent-encoded or otherwise disguised hosts.
function isAllowedDiscordUrl(url) {
  if (typeof url !== "string" || !url || url.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(url)) return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return false;
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) return false;
  const origin = `https://${parsed.hostname}`;
  const head = url.slice(0, origin.length).toLowerCase();
  const after = url.charAt(origin.length);
  return head === origin && (after === "" || after === "/" || after === "?" || after === "#");
}

// ---- OAuth2 PKCE (S256) -----------------------------------------------------------

const base64url = (buffer) => Buffer.from(buffer).toString("base64url");

function pkce(randomBytes = crypto.randomBytes) {
  const bytes = (size) => {
    try {
      const out = typeof randomBytes === "function" ? randomBytes(size) : null;
      if ((Buffer.isBuffer(out) || out instanceof Uint8Array) && out.length === size) return Buffer.from(out);
    } catch { /* fall through to the system source */ }
    return crypto.randomBytes(size);
  };
  const verifier = base64url(bytes(48)); // 48 bytes -> 64 base64url characters
  const challenge = crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
  const state = base64url(bytes(24));
  return { verifier, challenge, state };
}

function authorizeUrl(options) {
  const { clientId, redirectUri, challenge, state, scopes = SCOPES } = bag(options);
  const scope = (Array.isArray(scopes) ? scopes : [])
    .map((entry) => text(entry, 64)).filter(Boolean).join(" ");
  const params = [
    ["response_type", "code"],
    ["client_id", text(clientId, 64)],
    ["scope", scope],
    ["redirect_uri", text(redirectUri, 256)],
    ["state", text(state, 256)],
    ["code_challenge", text(challenge, 256)],
    ["code_challenge_method", "S256"],
  ];
  return `https://discord.com/oauth2/authorize?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
}

// ---- what the renderer sees ----------------------------------------------------

// The STATUS object every community:* call returns and community:event pushes.
// It is built field by field from the normalised state, so tokens cannot ride
// along even if a caller left one in the state it passed.
function publicStatus(options) {
  const { state, now = Date.now(), clientId, available = true, linking = false, selfUnlocked = SELF_UNLOCKED, rolePerks = ROLE_PERKS } = bag(options);
  const saved = normalize(state);
  const link = saved.link;
  const isAvailable = available !== false;
  const ent = entitlement({ link, now, selfUnlocked, rolePerks });
  return {
    available: isAvailable,
    configured: typeof clientId === "string" && clientId.trim() !== "",
    linked: Boolean(link),
    linking: linking === true,
    selfUnlocked: selfUnlocked === true,
    user: link ? { id: link.userId, username: link.username, globalName: link.globalName } : null,
    roles: link ? [...link.roles] : [],
    state: link ? link.state : null,
    entitlement: ent,
    checkedAt: link ? link.checkedAt : null,
    lastOkAt: link ? link.lastOkAt : null,
    nextCheckAt: link ? link.nextCheckAt : null,
    prompt: {
      due: isAvailable && promptDue({ state: saved, now, entitled: ent.premium }),
      never: saved.prompt.never,
      snoozeUntil: saved.prompt.snoozeUntil,
    },
    inviteUrl: INVITE_URL,
    serverUrl: linkTarget("server"),
    forkCopy: FORK_COPY,
    agentPrompt: AGENT_PROMPT,
  };
}

// Same idea as main.cjs releaseSignature: only a change a user could see
// triggers a community:event push. The failure counter is left out, and the
// constant copy strings need no place in it.
function signature(status) {
  const source = object(status) ? status : {};
  const ent = object(source.entitlement) ? source.entitlement : {};
  const user = object(source.user) ? source.user : null;
  const prompt = object(source.prompt) ? source.prompt : {};
  const value = (entry) => (entry === undefined ? null : entry);
  try {
    return JSON.stringify([
      source.available !== false, source.configured === true, source.linked === true,
      source.linking === true, source.selfUnlocked === true,
      user ? [value(user.id), value(user.username), value(user.globalName)] : null,
      Array.isArray(source.roles) ? source.roles : [],
      value(source.state),
      ent.premium === true, Array.isArray(ent.perks) ? ent.perks : [], value(ent.validUntil), value(ent.reason),
      value(source.checkedAt), value(source.lastOkAt), value(source.nextCheckAt),
      prompt.due === true, prompt.never === true, value(prompt.snoozeUntil),
    ]);
  } catch {
    return "[]";
  }
}

module.exports = {
  GUILD_ID, INVITE_URL, CLIENT_ID, REDIRECT_PORTS, SCOPES, SELF_UNLOCKED, ROLE_PERKS, PERKS,
  DAY, GRACE_MS, CHECK_EVERY_MS, FIRST_PROMPT_MS, PROMPT_EVERY_MS, BACKOFF_EVERY_MS, BACKOFF_AFTER, CHECK_THROTTLE_MS,
  FORK_COPY, AGENT_PROMPT, LINK_STATES, PROMPT_ACTIONS,
  normalize, normalizeLink, promptDue, applyPrompt, checkDue, nextCheckAfterFailure, recordCheck,
  entitlement, allPerks, linkTarget, isAllowedDiscordUrl, pkce, authorizeUrl, publicStatus, signature,
};
