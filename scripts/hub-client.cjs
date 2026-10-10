// Mefi's Studio AI+ — the client for the Void Engine rooms hub.
//
// The hub is the "void-hub" half of the Void Engine Bot repository, and its
// docs/protocol.md is the contract this file follows: Studio trades the
// member's Discord access token (from the community link, which main.cjs
// holds) for a 15-minute hub session, opens one WebSocket, and speaks JSON
// frames on it. Studio uses two things from it today:
//
//   - Listen together: a room's shared player. `subscribe` a room and the hub
//     answers with its `listen` session (or null); `listen` frames start,
//     pause, resume, seek and stop it, and every change comes back to every
//     subscriber as a `listen` frame.
//   - Now playing: with the member's say-so, `nowPlaying` tells the hub what
//     Studio is playing, so the bot's /nowplaying can show it on Discord.
//   - Companions: when the hub's `ready` frame lists the "companion" feature,
//     `companion` frames carry a companion's card to a room (and, with
//     "companion.direct", to one member of it), so friends' companions can
//     meet and play. The hub only relays them. A hub without the feature is
//     never sent one. What a card may hold is main's "Companion friends" block
//     and scripts/companion-friends.cjs; this file passes cards on unread.
//   - The Discord remote (docs/remote.md): when `ready` lists "remote" and
//     the owner turned it on (setRemote), `remoteHello` names this PC, the hub
//     hands it `remote` commands from the member's own DMs, and
//     `remoteReply` / `remoteNotice` answer them and send alerts. What a
//     command may do is scripts/remote.cjs and main's "Discord remote" block.
//   - The Mefi Studio relay (relay/ in this repository) speaks the same
//     protocol and stores no chat. When its `ready` lists them: "keepalive"
//     (a {"type":"ping"} every 30 s, which Cloudflare answers without waking
//     the relay), "messages.signed" (each message carries the relay's `sig`,
//     kept here so the copy stays checkable) and "history.peer" (historyAsk
//     asks the room for older messages; a `historyRequest` from the relay asks
//     this Studio to answer from its own copy with historyReply). `hello`
//     names what this Studio can do (CLIENT_FEATURES); a hub that does not
//     know the field drops it.
//   - Connecting made simple (relay features "lobby", "join.codes",
//     "online"): every member is in the Lobby; roomCode / newRoomCode hand
//     out a room's short join code and link, joinCode joins with one, and
//     online() lists who is in Studio now (setOnlineVisible hides you).
//   - Moderators (relay /v1/admin/*, which checks the member is one):
//     modFlags() lists credit patterns that look like farming, modReview()
//     shows where a member's credits came from, modRevoke() takes them back,
//     modReports() / modResolve() work through reports (messages and
//     projects), and modSuspend() pauses a member. reportProject() is for
//     everyone.
//   - The Lobby front page (relay feature "front"): front() reads who is
//     online and where, the rooms open now, the week's top and new projects,
//     rank-ups and this member's week in one call.
//   - Credits and the project hub (features "credits" and "projects", relay
//     only): me() and memberCard() for ranks and balances, projects() for the
//     hub, shareProject / playProject / finishPlay / star / feature, and a
//     `credits` event when this member earns or spends.
//   - My PCs (relay feature "pcs", docs/my-pcs.md): setPc names this socket
//     as one of the member's PCs (its keys, and whom it lends itself to) with
//     `pcHello` after every `ready`; pcState sends its status line and pcSend
//     an envelope for one PC (acked, or nacked "not-online" / "not-allowed").
//     The relay answers with `pcs` (the PCs this one sees), `pcState` and
//     `pcMsg` events. Envelopes are pc-trust.cjs's and pass here unread.
//   - Pets (relay feature "pets", relay/src/pets.mjs): setPet names this
//     member's pet ({ kind, skin, name } or null), said again after every
//     `ready`, and the rooms this Studio has open answer with `roomPets`
//     events: the pets of the members there, this member's own included. A
//     kind newer than the relay's pets generation (its "pets.<n>" feature)
//     goes as Ember, so an older relay never refuses the frame.
//   - The Shop (relay feature "shop", relay/src/shop.mjs): shop() lists
//     Studio's own items and members' style packs, shopOwned() what this
//     member owns (for a new PC), shopBuy / shopPublish / shopUpdate /
//     shopUnlist / shopReport, and modShopRemove for moderators. A pack's
//     data comes back with the schema's keys only (packData).
//
// Like scripts/discord-oauth.cjs this is a network module, and everything it
// reaches for is injected: fetch, the WebSocket class, the clock and the
// timers, and getAccessToken (the host's, which refreshes the Discord grant
// when it has to). No function here throws. Tokens and hub sessions never
// leave this module except in the requests that need them, and are never
// logged. The renderer only ever sees status(), rooms and the frames' public
// fields.

"use strict";

// The claim path rules and lease shape, shared with main's "Cowork claims".
const cowork = require("./cowork.cjs");
// The protocol window this Studio speaks with the relay (scripts/link-compat.cjs).
const { LINKS } = require("./link-compat.cjs");

const PROTOCOL_VERSION = LINKS.friends.protocol;
const OLDEST_PROTOCOL = LINKS.friends.oldest;
// A relay older than this Studio's window is being updated: try again this often.
const RELAY_BEHIND_RETRY_MS = 5 * 60_000;
// The Mefi Studio relay's public address (relay/, on Cloudflare). Settings ›
// Community › Connection details and MEFI_STUDIO_HUB_URL win, so a maintainer
// can point a build at a test relay or hub (http is accepted only on loopback).
const HUB_URL = "https://mefi-relay.mefi-studio.workers.dev";
const SESSION_MARGIN_MS = 60_000;
const PRESENCE_EVERY_MS = 30_000;
// The relay's keepalive: this exact frame, byte for byte, is answered by
// Cloudflare without waking the relay (relay/src/hub-object.mjs).
const KEEPALIVE_EVERY_MS = 30_000;
const KEEPALIVE_FRAME = Object.freeze({ type: "ping" });
// What this Studio tells the hub it can do (hello.features); "pets.2": it draws the Shop's pets too.
const CLIENT_FEATURES = Object.freeze(["history.peer", "keepalive", "friend.online", "pcs", "pets", "pets.2", "collectibles.1"]);
// A historyReply must fit the hub's 16 KB frame limit.
const HISTORY_REPLY_BYTES = 15 * 1024;
const HISTORY_REPLY_MESSAGES = 100;
const PROJECT_KINDS = Object.freeze(["game", "app", "tool", "art", "music", "other"]);
const PROJECT_VIEWS = Object.freeze(["new", "top", "played", "mine"]);
const CREDIT_HOLDS = Object.freeze(["unknown", "read-only", "new-account", "new-member", "forgot-me"]);
// What a moderator can switch off while they look into a new trick (relay/src/credits.mjs SWITCHES).
const CREDIT_SWITCHES = Object.freeze(["plays", "stars", "together", "cowork", "jam", "sales", "featuring", "review", "batches"]);
// A member who used Forget me, in a moderator's credit review: a random id that names nobody (relay credits.mjs GONE_ID).
const GONE_ID = /^gone:[A-Za-z0-9_-]{16,22}$/;
// Why a jam vote counts for nothing, or nothing more, in a moderator's view of the jam (relay events.mjs VOTE_WHYS).
const VOTE_WHYS = Object.freeze(["no-entry", "standing", "self", "not-played", "own-batch", "same-batch"]);
const RANK_KEY = /^[a-z_]{1,20}$/;
// The Shop's shapes (relay/src/shop.mjs and shop-pack.mjs).
const SHOP_VIEWS = Object.freeze(["studio", "new", "top", "owned", "mine"]);
const SHOP_ITEM_KINDS = Object.freeze(["pet", "skin", "effect", "nodestyle", "pack"]);
const SHOP_STATUSES = Object.freeze(["listed", "unlisted", "removed"]);
const STUDIO_ITEM = /^studio:[a-z0-9-]{1,40}$/;
const PACK_ID = /^pack_[A-Za-z0-9_-]{16}$/;
const SHOP_CURSOR = /^[A-Za-z0-9_-]{1,32}$/;
// The Shop's rotation (relay/src/shop-drops.mjs, feature "shop.drops"): a drop's id, its UTC times and its colours.
const SHOP_DROP_ID = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const SHOP_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHOP_DROP_COLOURS = Object.freeze(["accent", "accent2", "background"]);
const PACK_COLOUR = /^#[0-9a-fA-F]{6}$/;
const PACK_PALETTE = Object.freeze(["accent", "background", "surface", "text"]);
const PACK_NODE_STYLES = Object.freeze(["orbs", "glass", "minimal", "halo", "crystal", "singularity", "prism", "sigil"]);
const PACK_MATERIALS = Object.freeze(["focus", "studio", "atmosphere"]);
const PACK_FONTS = Object.freeze(["studio", "display", "serif", "mono"]);
const PACK_PRICE_MAX = 250;
const PACK_TIP_MAX = 100; // a tip for a community pack's maker, in credits
// Pets' shapes (relay/src/protocol.mjs PET_KINDS, PET_GENERATION, PET_SKINS; renderer/pets.js). Each kind
// came with a pets generation, and a relay's ready names the newest it knows ("pets.2").
const PET_KINDS = Object.freeze(["dragon", "cloud", "phoenix", "wisp"]);
const PET_GENERATION = Object.freeze({ dragon: 1, cloud: 2, phoenix: 2, wisp: 2 });
const PET_SKINS = Object.freeze(["theme", "frost", "jade", "void", "gold"]);
const PET_NAME_MAX = 24;
const ROOM_PETS_MAX = 12;
// The relay takes six pet frames a minute from one socket: a change waits its turn, and the latest one wins.
const PET_EVERY_MS = 10_000;
const ACK_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const BACKOFF_MS = Object.freeze([1_000, 2_000, 5_000, 10_000, 30_000, 60_000]);
// What a listen session may carry: the Links player's embeds and plain files.
const LISTEN_PROVIDERS = Object.freeze(["youtube", "spotify", "soundcloud", "vimeo", "discord", "file"]);
// What /nowplaying may show: the same, plus a radio station or local music.
const NOW_PLAYING_PROVIDERS = Object.freeze([...LISTEN_PROVIDERS, "radio", "local"]);
const LISTEN_ACTIONS = Object.freeze(["start", "play", "pause", "seek", "stop"]);
const MAX_POSITION_MS = 86_400_000;
const STATES = Object.freeze(["off", "connecting", "ready", "offline", "error"]);
// The parts of Studio that hold a room subscribed: Friends › Rooms' chat,
// Listen together, main's cowork claims, and callers that name none.
const HOLDERS = Object.freeze(["default", "rooms", "together", "cowork"]);
const holderOf = (value) => (HOLDERS.includes(value) ? value : "default");

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SNOWFLAKE = /^\d{17,20}$/;
// An id from the relay: a string first, so a missing one ("undefined") never passes.
const opaqueId = (value) => typeof value === "string" && OPAQUE_ID.test(value);
const ONE_LINE = /^[^\x00-\x1f\x7f]*$/;
// The Discord remote's shapes (docs/remote.md).
const REMOTE_COMMANDS = Object.freeze(["status", "needs", "made", "digest", "say", "pause", "resume", "button"]);
const REMOTE_NOTICES = Object.freeze(["needs-you", "done", "failed", "stuck", "digest", "info"]);
const REMOTE_STYLES = Object.freeze(["primary", "secondary", "success", "danger"]);
const PC_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const BUTTON_ID = /^[A-Za-z0-9_.:-]{1,48}$/;
const REMOTE_TEXT_MAX = 1900;
// My PCs' shapes (docs/my-pcs.md, relay/src/protocol.mjs).
const PC_KINDS = Object.freeze(["desktop", "laptop"]);
const PC_KEY = /^[A-Za-z0-9+/]{43}=$/; // a raw 32-byte public key in base64
const PC_LEND_TO = 8;
const PCS_MAX = 16;
const PC_STATE_BYTES = 3 * 1024;
const PC_ENV_BYTES = 12 * 1024;

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const line = (value, max) => (typeof value === "string" && value.trim() && value.length <= max && ONE_LINE.test(value) ? value : null);
const count = (value, max) => (Number.isInteger(value) && value >= 0 && value <= max ? value : null);

// The hub's address as its two schemes, or null. https anywhere; http only on
// 127.0.0.1 or localhost (a hub run on this machine). No path, query,
// credentials or fragment.
function hubAddress(raw) {
  let url;
  try { url = new URL(String(raw ?? "").trim()); } catch { return null; }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
  const http = `${url.protocol}//${url.host}`;
  return { http, ws: `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}/v1/ws` };
}

function configuredUrl(env = process.env) {
  return String(env?.MEFI_STUDIO_HUB_URL || HUB_URL || "").trim();
}

// A link a session may carry: https, at most 2048 characters, no credentials.
function listenUrl(value) {
  if (typeof value !== "string" || !value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : null;
  } catch { return null; }
}

function user(value) {
  if (!object(value) || !SNOWFLAKE.test(String(value.id))) return null;
  return { id: String(value.id), name: typeof value.name === "string" ? value.name.slice(0, 100) : "" };
}

// A hub `listen` session as Studio uses it, or null when it is not one.
function listenSession(value) {
  if (!object(value)) return null;
  const url = listenUrl(value.url);
  const label = line(value.label, 120);
  const host = user(value.host);
  const positionMs = count(value.positionMs, MAX_POSITION_MS);
  if (!opaqueId(value.id) || !url || !label || !host || positionMs == null) return null;
  if (!LISTEN_PROVIDERS.includes(value.provider) || typeof value.playing !== "boolean") return null;
  if (!Number.isFinite(value.updatedAt) || !Number.isFinite(value.startedAt)) return null;
  // `title` is the hub's own lookup (oEmbed) and may arrive a moment later.
  const title = value.title == null ? null : line(value.title, 200);
  return { id: value.id, url, label, title, provider: value.provider, host, playing: value.playing, positionMs, startedAt: value.startedAt, updatedAt: value.updatedAt };
}

function roomSummary(value) {
  if (!object(value) || !opaqueId(value.id) || !line(value.name, 80)) return null;
  return {
    id: value.id, name: value.name, kind: value.kind === "cowork" ? "cowork" : "hangout",
    status: ["active", "locked", "closed"].includes(value.status) ? value.status : "active",
    you: typeof value.you === "string" ? value.you : "none",
    ownerId: SNOWFLAKE.test(String(value.ownerId)) ? String(value.ownerId) : null,
    memberCount: count(value.memberCount, 1000) ?? 0,
    policy: value.policy === "invite" ? "invite" : "request",
    listed: value.listed === true,
    maxMembers: count(value.maxMembers, 1000) ?? 0,
  };
}

// Free text a member typed (a message, a join note): control characters
// other than tab and line breaks are dropped, and the length is capped.
const text = (value, max) => (typeof value === "string" ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").slice(0, max) : "");

// A room message as Studio shows it. Studio renders `text` as text only.
function roomMessage(value) {
  if (!object(value) || !SNOWFLAKE.test(String(value.id)) || !object(value.author) || !SNOWFLAKE.test(String(value.author.id))) return null;
  if (typeof value.text !== "string" || !Number.isFinite(value.createdAt)) return null;
  const image = value.v === 2 ? require("./social-client.cjs").imageRef(value.image) : null;
  if (value.v === 2 && !image) return null;
  return {
    id: String(value.id),
    author: { id: String(value.author.id), name: text(value.author.name, 100), viaStudio: value.author.viaStudio === true },
    text: text(value.text, 2000), truncated: value.truncated === true,
    createdAt: value.createdAt, editedAt: Number.isFinite(value.editedAt) ? value.editedAt : null,
    mentions: Array.isArray(value.mentions?.users) ? value.mentions.users.map((item) => (object(item) && SNOWFLAKE.test(String(item.id)) ? { id: String(item.id), name: text(item.name, 100) } : null)).filter(Boolean).slice(0, 50) : [],
    attachments: Array.isArray(value.attachments) ? value.attachments.filter(object).slice(0, 10).map((item) => ({ name: text(item.name, 200) || "file", size: count(item.size, 1e12) ?? 0 })) : [],
    replyTo: SNOWFLAKE.test(String(value.replyTo)) ? String(value.replyTo) : null,
    ...(image ? { v: 2, image } : {}),
    ...(value.sticker && require("./collectibles-contract.cjs").sticker(value.sticker) ? { sticker: require("./collectibles-contract.cjs").sticker(value.sticker) } : {}),
    // The relay's signature (feature "messages.signed"), kept so this copy can
    // later fill another member's gap or back a report.
    ...(opaqueId(value.sig) ? { sig: value.sig } : {}),
  };
}

// A kept message back in the hub's wire shape, for historyReply and reports.
function wireMessage(value) {
  const message = roomMessage(value);
  if (!message) return null;
  return {
    id: message.id,
    author: { id: message.author.id, name: message.author.name.replace(/[\x00-\x1f\x7f]/g, " "), viaStudio: message.author.viaStudio },
    text: message.text,
    ...(message.truncated ? { truncated: true } : {}),
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    mentions: { users: message.mentions.map((item) => ({ id: item.id, name: item.name.replace(/[\x00-\x1f\x7f]/g, " ") })), roles: [], everyone: false },
    attachments: message.attachments.map((item) => ({ name: item.name.replace(/[\x00-\x1f\x7f]/g, " ") || "file", size: item.size })),
    replyTo: message.replyTo,
    ...(message.v === 2 ? { v: 2, image: message.image } : {}),
    ...(message.sticker ? { sticker: message.sticker } : {}),
    ...(message.sig ? { sig: message.sig } : {}),
  };
}

function joinRequest(value) {
  const requester = object(value) ? user(value.requester) : null;
  if (!requester || !opaqueId(value.id) || !opaqueId(value.roomId)) return null;
  if (!["pending", "approved", "denied", "cancelled"].includes(value.status) || !Number.isFinite(value.createdAt)) return null;
  return { id: value.id, roomId: value.roomId, requester, note: text(value.note, 300), status: value.status, createdAt: value.createdAt, decidedAt: Number.isFinite(value.decidedAt) ? value.decidedAt : null };
}

function roomInvite(value) {
  const invitedBy = object(value) ? user(value.invitedBy) : null;
  if (!invitedBy || !opaqueId(value.id) || !opaqueId(value.roomId) || !line(value.roomName, 80)) return null;
  if (!["pending", "accepted", "declined", "revoked", "expired"].includes(value.status) || !Number.isFinite(value.expiresAt)) return null;
  return { id: value.id, roomId: value.roomId, roomName: value.roomName, invitedBy, status: value.status, expiresAt: value.expiresAt };
}

// What a member may post: 1-2000 characters, not blank, and no control
// characters other than tab and line breaks (the hub's own rule).
function postText(value) {
  return typeof value === "string" && value.trim() && value.length <= 2000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ? value : null;
}

// What Studio tells /nowplaying: a label, and a link when there is one.
function nowPlayingTrack(value) {
  if (value == null) return null;
  if (!object(value)) return null;
  const label = line(value.label, 120);
  if (!label || !NOW_PLAYING_PROVIDERS.includes(value.provider)) return null;
  const url = value.url == null ? null : listenUrl(value.url);
  if (value.url != null && !url) return null;
  return { label, provider: value.provider, ...(url ? { url } : {}) };
}

// ---- the Discord remote's shapes (docs/remote.md) --------------------------
// A reply's or alert's words: 1-1900 characters once control characters other
// than tab and line breaks are dropped; longer ones are cut with an ellipsis.
function remoteText(value) {
  const body = typeof value === "string" ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim() : "";
  if (!body) return null;
  return body.length > REMOTE_TEXT_MAX ? `${body.slice(0, REMOTE_TEXT_MAX - 1)}…` : body;
}
// At most five buttons, each { id, label, style?, pin? }; null when one is bad.
function remoteButtons(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 5) return null;
  const out = [];
  for (const item of value) {
    const label = object(item) ? line(item.label, 40) : null;
    if (!label || !BUTTON_ID.test(String(item.id ?? ""))) return null;
    out.push({ id: item.id, label, ...(REMOTE_STYLES.includes(item.style) ? { style: item.style } : {}), ...(item.pin === true ? { pin: true } : {}) });
  }
  return out;
}
// A command from the hub, or null. main checks `from` against its own session.
function remoteCommand(value) {
  if (!object(value) || !opaqueId(value.requestId) || !SNOWFLAKE.test(String(value.from ?? "")) || !REMOTE_COMMANDS.includes(value.command)) return null;
  const out = { requestId: value.requestId, from: String(value.from), command: value.command, sentAt: Number.isFinite(value.sentAt) ? value.sentAt : null };
  if (typeof value.text === "string") out.text = text(value.text, 2000);
  if (BUTTON_ID.test(String(value.buttonId ?? ""))) out.buttonId = value.buttonId;
  if (/^\d{4,12}$/.test(String(value.pin ?? ""))) out.pin = String(value.pin);
  return out;
}
// The member's PCs that have the remote on, as the hub lists them.
function remotePcs(value) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, 8).map((item) => (object(item) && PC_ID.test(String(item.id ?? "")) && line(item.name, 40) ? { id: item.id, name: item.name, since: Number.isFinite(item.since) ? item.since : null } : null)).filter(Boolean);
}

// ---- My PCs' shapes (docs/my-pcs.md) ----------------------------------------
const pcId = (value) => (typeof value === "string" && PC_ID.test(value) ? value : null);
// A PC's two public keys, or null.
function pcKeys(value) {
  if (!object(value) || typeof value.sign !== "string" || typeof value.box !== "string" || !PC_KEY.test(value.sign) || !PC_KEY.test(value.box)) return null;
  return { sign: value.sign, box: value.box };
}
// The JSON size of a status line or an envelope, or Infinity when it is not plain JSON.
function jsonBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value)); } catch { return Infinity; }
}
// What setPc takes, as pcHello sends it: { pc: { id, name, kind }, keys, lendTo }, or null.
function pcHello(value) {
  if (!object(value) || !object(value.pc)) return null;
  const id = pcId(value.pc.id);
  const name = line(value.pc.name, 40);
  const keys = pcKeys(value.keys);
  const lendTo = value.lendTo == null ? [] : value.lendTo;
  if (!id || !name || !PC_KINDS.includes(value.pc.kind) || !keys || !Array.isArray(lendTo) || lendTo.length > PC_LEND_TO) return null;
  if (lendTo.some((uid) => !snowflake(uid))) return null;
  return { pc: { id, name, kind: value.pc.kind }, keys, lendTo: [...new Set(lendTo)] };
}
// One PC of a `pcs` roster, or null: the member's own (mine) or lent to them (lends).
function pcView(value) {
  if (!object(value)) return null;
  const id = pcId(value.id);
  const name = line(value.name, 40);
  const owner = user(value.owner);
  const keys = pcKeys(value.keys);
  if (!id || !name || !PC_KINDS.includes(value.kind) || !owner || !keys) return null;
  return { id, name, kind: value.kind, owner, mine: value.mine === true, lends: value.mine !== true && value.lends === true, keys, since: Number.isFinite(value.since) ? value.since : null };
}
// A `pcs` roster: each PC id once, at most 16; null when it is not a list.
function pcViews(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  return value.slice(0, PCS_MAX).map(pcView).filter((item) => item && !seen.has(item.id) && seen.add(item.id));
}

// A project card from the relay's hub, or null.
function projectCard(value) {
  if (!object(value) || !opaqueId(value.id) || !object(value.owner) || !SNOWFLAKE.test(String(value.owner.id))) return null;
  const url = listenUrl(value.url);
  const title = line(value.title, 100);
  if (!url || !title) return null;
  return {
    id: value.id, url, host: line(value.host, 253) ?? new URL(url).hostname, title, blurb: line(value.blurb, 300) ?? "",
    kind: PROJECT_KINDS.includes(value.kind) ? value.kind : "other",
    owner: { id: String(value.owner.id), name: text(value.owner.name, 100) || "member", rank: RANK_KEY.test(String(value.owner.rank ?? "")) ? value.owner.rank : "spark" },
    plays: count(value.plays, 1e9) ?? 0, stars: count(value.stars, 1e9) ?? 0,
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : null, lastPlayedAt: Number.isFinite(value.lastPlayedAt) ? value.lastPlayedAt : null,
    featuredUntil: Number.isFinite(value.featuredUntil) ? value.featuredUntil : null, starred: value.starred === true,
  };
}
function rankOf(value) {
  if (!object(value) || !RANK_KEY.test(String(value.key))) return null;
  const next = object(value.next) && RANK_KEY.test(String(value.next.key)) ? { key: value.next.key, name: line(value.next.name, 20) ?? value.next.key, at: count(value.next.at, 1e9) ?? 0 } : null;
  return { key: value.key, name: line(value.name, 20) ?? value.key, next, progress: Number.isFinite(value.progress) ? Math.max(0, Math.min(1, value.progress)) : 0 };
}
const specialOf = (value) => (Array.isArray(value) ? value.filter((key) => RANK_KEY.test(String(key))).slice(0, 12) : []);
// The Lobby front page from the relay (GET /v1/front), every part checked.
function frontPage(data) {
  const place = (value) => (object(value) && opaqueId(value.id) && line(value.name, 80) ? { id: value.id, name: value.name, kind: value.kind === "cowork" ? "cowork" : "hangout" } : null);
  const list = (value, shape, max) => (Array.isArray(value) ? value.map(shape).filter(Boolean).slice(0, max) : []);
  const person = (item) => {
    const who = user(item);
    const made = object(item.building) ? { project: line(item.building.project, 80), running: count(item.building.running, 1000) ?? 0, doneToday: count(item.building.doneToday, 1000) ?? 0 } : null;
    return who ? { ...who, rank: RANK_KEY.test(String(item.rank ?? "")) ? item.rank : "spark", specialRanks: specialOf(item.specialRanks), where: place(item.where), building: made?.project ? made : null } : null;
  };
  const room = (item) => { const summary = roomSummary(item); return summary ? { ...summary, here: count(item.here, 1000) ?? 0 } : null; };
  const rankUp = (item) => {
    const who = user(item);
    const rank = object(item?.rank) && RANK_KEY.test(String(item.rank.key)) ? { key: item.rank.key, name: line(item.rank.name, 20) ?? item.rank.key } : null;
    return who && rank ? { ...who, rank } : null;
  };
  const top = projectCard(data?.top);
  const you = object(data?.you) ? data.you : {};
  return {
    ok: true,
    online: { count: count(data?.online?.count, 1e6) ?? 0, people: list(data?.online?.people, person, 50) },
    lobby: { here: count(data?.lobby?.here, 1e6) ?? 0 },
    rooms: list(data?.rooms, room, 12),
    ownRoom: place(data?.ownRoom),
    visible: data?.visible !== false,
    top: top ? { ...top, week: data.top.week === true, weekPlays: count(data.top.weekPlays, 1e9) ?? 0, weekStars: count(data.top.weekStars, 1e9) ?? 0 } : null,
    fresh: list(data?.fresh, projectCard, 10),
    rankUps: list(data?.rankUps, rankUp, 10),
    you: {
      balance: count(you.balance, 1e12) ?? 0, lifetime: count(you.lifetime, 1e12) ?? 0, rank: rankOf(you.rank),
      week: { earned: count(you.week?.earned, 1e9) ?? 0, plays: count(you.week?.plays, 1e9) ?? 0, stars: count(you.week?.stars, 1e9) ?? 0 },
      projects: count(you.projects, 1000) ?? 0,
      hold: object(you.hold) && CREDIT_HOLDS.includes(you.hold.reason) ? { reason: you.hold.reason, until: Number.isFinite(you.hold.until) ? you.hold.until : null } : null,
    },
    events: eventsFront(data?.events),
  };
}
// Community events (relay feature "events", relay/src/events.mjs): the
// weekly Build Jam, the co-work hour and building together, every part
// checked like the rest of what the relay sends.
const JAM_PHASES = Object.freeze(["entries", "voting", "results"]);
const timeOf = (value) => (Number.isFinite(value) ? value : null);
// An id must be a string of the pattern: String(undefined) is "undefined", which the pattern alone lets through.
const opaque = (value) => (typeof value === "string" && OPAQUE_ID.test(value) ? value : null);
const snowflake = (value) => (typeof value === "string" && SNOWFLAKE.test(value) ? value : null);
function eventProject(value) {
  if (!object(value) || !opaque(value.id)) return null;
  return { id: value.id, title: line(value.title, 100) ?? "project", url: listenUrl(value.url), host: line(value.host, 253) ?? "", kind: PROJECT_KINDS.includes(value.kind) ? value.kind : "other" };
}
function jamPayout(value) {
  if (!object(value) || !snowflake(value.userId)) return null;
  return {
    userId: String(value.userId), name: text(value.name, 100) || "member", place: count(value.place, 3), why: value.why === "place" ? "place" : "showcase",
    amount: count(value.amount, 1e6) ?? 0, paid: count(value.paid, 1e6), projectId: opaque(value.projectId),
  };
}
function jamOf(value) {
  if (!object(value) || !opaque(value.id)) return null;
  const entry = (item) => {
    const who = user(item?.user);
    return who ? { user: who, project: eventProject(item.project), players: count(item.players, 1e6) ?? 0, votes: item.votes == null ? null : count(item.votes, 1e6), mine: item.mine === true, voted: item.voted === true, played: item.played === true } : null;
  };
  return {
    id: value.id, theme: line(value.theme, 60) ?? "", nextTheme: line(value.nextTheme, 60) ?? "",
    phase: JAM_PHASES.includes(value.phase) ? value.phase : "entries",
    startsAt: timeOf(value.startsAt), entriesUntil: timeOf(value.entriesUntil), endsAt: timeOf(value.endsAt), pool: count(value.pool, 1e6) ?? 0,
    // When the results come: a day after voting closes, once a moderator had a look (a relay from before says nothing).
    resultsAt: timeOf(value.resultsAt),
    entries: Array.isArray(value.entries) ? value.entries.map(entry).filter(Boolean).slice(0, 100) : [],
    you: { entered: opaque(value.you?.entered), votesLeft: count(value.you?.votesLeft, 10) ?? 0 },
    results: Array.isArray(value.results) ? value.results.map(jamPayout).filter(Boolean).slice(0, 100) : null,
  };
}
function coworkOf(value) {
  if (!object(value) || !opaque(value.id)) return null;
  return {
    id: value.id, roomId: opaque(value.roomId), startsAt: timeOf(value.startsAt), endsAt: timeOf(value.endsAt),
    started: value.started === true, joined: value.joined === true, here: count(value.here, 1e4) ?? 0,
    checks: count(value.checks, 10) ?? 0, checksDone: count(value.checksDone, 10) ?? 0, checksNeeded: count(value.checksNeeded, 10) ?? 2,
    attendees: count(value.attendees, 1e4) ?? 0, amount: count(value.amount, 1e4) ?? 0,
  };
}
// Credits on hold for a newcomer wave (relay credits.mjs heldList): by the member they are for, with each newcomer who
// would have paid them, how much, how old their Discord account is and when they joined the server.
function heldOf(value) {
  if (!object(value) || !object(value.member) || !SNOWFLAKE.test(String(value.member.id ?? ""))) return null;
  const when = (time) => (Number.isFinite(time) ? time : null);
  return {
    member: { id: String(value.member.id), name: text(value.member.name, 100) || "member" },
    total: count(value.total, 1e12) ?? 0, since: when(value.since), dropsAt: when(value.dropsAt),
    givers: Array.isArray(value.givers) ? value.givers.map((item) => (object(item) && SNOWFLAKE.test(String(item.id ?? "")) ? {
      id: String(item.id), name: text(item.name, 100) || "member", amount: count(item.amount, 1e12) ?? 0, events: count(item.events, 1e9) ?? 0,
      accountCreatedAt: when(item.accountCreatedAt), joinedAt: when(item.joinedAt),
    } : null)).filter(Boolean).slice(0, 100) : [],
  };
}
const holdsOf = (value) => (Array.isArray(value) ? value.map(heldOf).filter(Boolean).slice(0, 100) : []);
// The switches a moderator turned off (relay credits.mjs SWITCHES), known keys only.
const switchesOff = (value) => (Array.isArray(value) ? value.filter((key) => CREDIT_SWITCHES.includes(key)) : []);
// A moderator's view of a Build Jam (GET /v1/admin/jam): each entry in its place now with its voters, whether each vote
// counts and why not, each voter's account age, server join date and batch letter, and what the pool would pay now.
function modJamOf(value) {
  if (!object(value) || !opaque(value.id)) return null;
  const person = (item) => {
    const who = user(item);
    return who ? { ...who, accountCreatedAt: timeOf(item.accountCreatedAt), joinedAt: timeOf(item.joinedAt), batch: /^[A-Z]$/.test(String(item.batch ?? "")) ? item.batch : null } : null;
  };
  const entry = (item) => {
    const who = person(item?.user);
    if (!who) return null;
    const voters = Array.isArray(item.voters) ? item.voters.map((one) => {
      const voter = person(one);
      return voter ? { ...voter, counted: one.counted === true, why: VOTE_WHYS.includes(one.why) ? one.why : null } : null;
    }).filter(Boolean).slice(0, 500) : [];
    return { user: who, project: eventProject(item.project), votes: count(item.votes, 1e6) ?? 0, players: count(item.players, 1e6) ?? 0, resting: item.resting === true, voters };
  };
  return {
    id: value.id, theme: line(value.theme, 60) ?? "",
    status: ["entries", "voting", "review", "release"].includes(value.status) ? value.status : "review",
    endsAt: timeOf(value.endsAt), resultsAt: timeOf(value.resultsAt), held: value.held === true, pool: count(value.pool, 1e6) ?? 0,
    payouts: Array.isArray(value.payouts) ? value.payouts.map(jamPayout).filter(Boolean).slice(0, 100) : [],
    entries: Array.isArray(value.entries) ? value.entries.map(entry).filter(Boolean).slice(0, 100) : [],
  };
}
// GET /v1/events.
function eventsPage(data) {
  const last = object(data?.lastJam) && opaque(data.lastJam.id) ? {
    id: data.lastJam.id, theme: line(data.lastJam.theme, 60) ?? "", endsAt: timeOf(data.lastJam.endsAt), pool: count(data.lastJam.pool, 1e6) ?? 0,
    results: Array.isArray(data.lastJam.results) ? data.lastJam.results.map(jamPayout).filter(Boolean).slice(0, 100) : [],
  } : null;
  const budget = object(data?.budget) ? data.budget : {};
  const together = object(data?.together) ? data.together : {};
  return {
    ok: true, now: timeOf(data?.now), jam: jamOf(data?.jam), lastJam: last, cowork: coworkOf(data?.cowork), nextCowork: timeOf(data?.nextCowork),
    // A jam whose voting closed and whose results wait for a moderator's look: when they come (null while held).
    reviewing: object(data?.reviewing) && opaque(data.reviewing.id) ? { id: data.reviewing.id, theme: line(data.reviewing.theme, 60) ?? "", resultsAt: timeOf(data.reviewing.resultsAt) } : null,
    together: { ticks: count(together.ticks, 100) ?? 0, needed: count(together.needed, 100) ?? 3, amount: count(together.amount, 1e4) ?? 0, everyMs: count(together.everyMs, 864e5) ?? 600000 },
    budget: { budget: count(budget.budget, 1e7) ?? 0, paid: count(budget.paid, 1e7) ?? 0, left: count(budget.left, 1e7) ?? 0, active: count(budget.active, 1e7) ?? 0 },
  };
}
// The events line on the Lobby front page (GET /v1/front's `events`).
function eventsFront(value) {
  if (!object(value)) return null;
  const jam = object(value.jam) && opaque(value.jam.id) ? {
    id: value.jam.id, theme: line(value.jam.theme, 60) ?? "", phase: JAM_PHASES.includes(value.jam.phase) ? value.jam.phase : "entries",
    entriesUntil: timeOf(value.jam.entriesUntil), endsAt: timeOf(value.jam.endsAt), entries: count(value.jam.entries, 1e6) ?? 0, entered: value.jam.entered === true,
  } : null;
  const cowork = object(value.cowork) ? { id: opaque(value.cowork.id), startsAt: timeOf(value.cowork.startsAt), endsAt: timeOf(value.cowork.endsAt), here: count(value.cowork.here, 1e4) ?? 0 } : null;
  return { jam, cowork };
}

// ---- The Shop's shapes (relay/src/shop.mjs) ----------------------------------
const shopItemId = (value) => typeof value === "string" && (STUDIO_ITEM.test(value) || PACK_ID.test(value));
const isPackId = (value) => typeof value === "string" && PACK_ID.test(value);
// A style pack's data with the schema's keys only (relay/src/shop-pack.mjs),
// colours lower-cased, or null when it is not one. Anything else in it is
// left behind, so nothing but colours and Studio's own keys reaches a page.
function packData(value) {
  if (!object(value) || value.v !== 1 || !object(value.palette)) return null;
  const palette = {};
  for (const key of [...PACK_PALETTE, "accent2"]) {
    const colour = value.palette[key];
    if (key === "accent2" && colour == null) continue;
    if (typeof colour !== "string" || !PACK_COLOUR.test(colour)) return null;
    palette[key] = colour.toLowerCase();
  }
  return {
    v: 1, palette,
    ...(PACK_NODE_STYLES.includes(value.nodeStyle) ? { nodeStyle: value.nodeStyle } : {}),
    ...(PACK_MATERIALS.includes(value.material) ? { material: value.material } : {}),
    ...(PACK_FONTS.includes(value.font) ? { font: value.font } : {}),
  };
}
// A UTC ISO time as the relay writes a drop's (shop-drops.mjs DROP_TIME), or null.
const shopTime = (value) => (typeof value === "string" && SHOP_TIME.test(value) && Number.isFinite(Date.parse(value)) ? value : null);
// A Shop item from the relay, or null: only the known fields, strings and
// numbers capped. A pack whose data is not a pack is left out. Its place in
// the rotation: its drop, whether it is on sale (a relay from before drops
// says nothing, and everything it lists is) and when it leaves.
function itemCard(value) {
  if (!object(value) || !shopItemId(value.id) || !SHOP_ITEM_KINDS.includes(value.kind)) return null;
  const name = line(value.name, 40);
  const data = value.kind === "pack" ? packData(value.data) : null;
  if (!name || (value.kind === "pack" && !data)) return null;
  return {
    id: value.id, kind: value.kind, name, blurb: line(value.blurb, 160) ?? "",
    price: count(value.price, 1e6) ?? 0, requires: shopItemId(value.requires) ? value.requires : null,
    maker: object(value.maker) && snowflake(value.maker.id) ? { id: value.maker.id, name: text(value.maker.name, 100) || "member" } : null,
    data, sales: count(value.sales, 1e9) ?? 0, owned: value.owned === true,
    status: SHOP_STATUSES.includes(value.status) ? value.status : "listed",
    createdAt: timeOf(value.createdAt), updatedAt: timeOf(value.updatedAt),
    drop: SHOP_DROP_ID.test(String(value.drop ?? "")) ? value.drop : null, available: value.available !== false, leaves: shopTime(value.leaves),
  };
}
// A drop as the relay lists it (shop-drops.mjs dropsAt): its id, name, line, times and banner colours (a colour that is
// not #rrggbb is left out, and the banner uses the theme's), and for the current drop the ids of its items on sale.
function dropCard(value, { items = false } = {}) {
  if (!object(value) || !SHOP_DROP_ID.test(String(value.id ?? ""))) return null;
  const name = line(value.name, 40), from = shopTime(value.from), until = shopTime(value.until);
  if (!name || !from || !until || !(Date.parse(from) < Date.parse(until))) return null;
  const colors = {};
  for (const key of SHOP_DROP_COLOURS) if (typeof value.colors?.[key] === "string" && PACK_COLOUR.test(value.colors[key])) colors[key] = value.colors[key].toLowerCase();
  return { id: value.id, name, blurb: line(value.blurb, 160) ?? "", from, until, colors, ...(items ? { items: Array.isArray(value.items) ? value.items.filter(shopItemId).slice(0, 48) : [] } : {}) };
}
// The drops a list carries: the current one, the next (a teaser) and the last that ended; null from a relay without them.
function shopDrops(value) {
  if (!object(value)) return null;
  return { current: dropCard(value.current, { items: true }), next: dropCard(value.next), last: dropCard(value.last) };
}
// What a member typed for a pack: { name, blurb, price, data, listed } as the
// relay takes them, the ones given only; null when one is wrong. The pack's
// data goes as plain JSON, every key kept, so the relay's check can refuse a
// key it does not name instead of it being dropped here, and say "too-big"
// for anything over 2 KB that still fits a request (16 KB).
function packFields(fields, { required = false } = {}) {
  if (!object(fields)) return null;
  const out = {};
  if (fields.name !== undefined || required) {
    const name = line(fields.name, 40);
    if (!name || name.trim().length < 2) return null;
    out.name = name;
  }
  if (typeof fields.blurb === "string" && !fields.blurb.trim()) out.blurb = "";
  else if (fields.blurb != null) {
    const blurb = line(fields.blurb, 160);
    if (!blurb) return null;
    out.blurb = blurb;
  }
  if (fields.price !== undefined || required) {
    if (!Number.isInteger(fields.price) || (fields.price !== 0 && (fields.price < 10 || fields.price > PACK_PRICE_MAX))) return null;
    out.price = fields.price;
  }
  if (fields.data !== undefined || required) {
    if (!object(fields.data)) return null;
    let json;
    try { json = JSON.stringify(fields.data); } catch { return null; }
    if (typeof json !== "string" || Buffer.byteLength(json) > 15 * 1024) return null;
    out.data = JSON.parse(json);
  }
  if (fields.listed !== undefined) {
    if (typeof fields.listed !== "boolean") return null;
    out.listed = fields.listed;
  }
  return out;
}

// ---- Pets' shapes (relay/src/pets.mjs) ---------------------------------------
// A pet as the relay takes it, { kind, skin, name } with the name on one line
// and at most 24 characters, or null when it is not one.
function petLook(value) {
  if (!object(value) || !PET_KINDS.includes(value.kind) || !PET_SKINS.includes(value.skin)) return null;
  const name = typeof value.name === "string" ? value.name.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, PET_NAME_MAX).trim() : "";
  const instanceId = typeof value.instanceId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value.instanceId) ? value.instanceId : null;
  const raw = value.collectible, look = raw && require("./collectibles-contract.cjs").visual(raw.visual);
  const collectible = look && raw.id === instanceId && require("./collectibles-contract.cjs").RARITIES.includes(raw.rarity)
    && ["baby", "young", "adult"].includes(raw.stage) && ["tiny", "small", "medium", "large"].includes(raw.size)
    ? { id: raw.id, kind: "pet", name: text(raw.name, 40), visual: look, rarity: raw.rarity, quality: count(raw.quality, 100) ?? 0,
      stage: raw.stage, size: raw.size, sizes: Array.isArray(raw.sizes) ? raw.sizes.filter((size) => ["tiny", "small", "medium", "large"].includes(size)).slice(0, 4) : ["tiny"],
      traits: Array.isArray(raw.traits) ? raw.traits.slice(0, 12).filter(object).map((trait) => ({ id: text(trait.id, 64), name: text(trait.name, 40), acquiredAt: timeOf(trait.acquiredAt) })) : [] } : null;
  return { kind: value.kind, skin: value.skin, name, ...(instanceId ? { instanceId } : {}), ...(collectible ? { collectible } : {}) };
}
// The newest pets generation a features list names ("pets" alone is the first), or 0.
function petsGenerationOf(features) {
  let newest = 0;
  for (const name of Array.isArray(features) ? features : []) {
    if (name === "pets") newest = Math.max(newest, 1);
    const match = /^pets\.(\d{1,3})$/.exec(String(name));
    if (match) newest = Math.max(newest, Number(match[1]));
  }
  return newest;
}
// A pet as a relay of that generation may take it: a kind newer than the
// relay knows goes as Ember, so an older relay never refuses the frame.
function petForRelay(pet, generation) {
  if (!pet || (PET_GENERATION[pet.kind] ?? Infinity) <= Math.max(1, generation)) return pet;
  return { ...pet, kind: "dragon" };
}
// A room's pets from the relay, each member once and at most 12, or null
// when it is not a list: { id, userId, name, pet }, where id and userId are
// the member's user id (id is what renderer/pets.js MefiPets.guests() reads)
// and name is the member's display name.
function roomPetsOf(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const out = [];
  for (const item of value.slice(0, ROOM_PETS_MAX)) {
    const id = object(item) ? snowflake(item.userId) : null;
    const pet = id ? petLook(item.pet) : null;
    if (!pet || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, userId: id, name: text(item.name, 100) || "member", pet });
  }
  return out;
}

// A room's join code ("7K3Q-M2XR") and its link, or a failure.
function codeOf(data) {
  const code = typeof data?.code === "string" && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(data.code) ? data.code : null;
  const link = typeof data?.link === "string" && /^https:\/\/[^\s]+\/join\/[A-Z0-9]{8}$/.test(data.link) ? data.link : null;
  return code ? { ok: true, code, link } : { ok: false, error: "failed" };
}

function createHubClient(options = {}) {
  const {
    url = configuredUrl(),
    getAccessToken = async () => ({ ok: false, error: "auth" }),
    fetch: fetchImpl = globalThis.fetch,
    WebSocket: SocketImpl = globalThis.WebSocket,
    now = () => Date.now(),
    setTimeout: later = globalThis.setTimeout,
    clearTimeout: cancel = globalThis.clearTimeout,
    setInterval: every = globalThis.setInterval,
    clearInterval: stopEvery = globalThis.clearInterval,
    onEvent = () => {},
    log = () => {},
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
  } = options;
  const address = hubAddress(url);
  let state = "off";
  let error = null;
  let wanted = false;
  let session = null; // { token, expiresAt, user, readOnly }
  let socket = null;
  let generation = 0;
  let backoff = 0;
  let retryTimer = null;
  let renewTimer = null;
  let presenceTimer = null;
  let keepaliveTimer = null;
  let paused = false;
  let nonceSeq = 0;
  let nowPlaying = null;
  let building = null; // what this member shares they are building (feature "building")
  let opening = null;
  // What the hub said it carries in its last `ready` frame.
  let features = [];
  // The Discord remote: this PC as main named it ({ pc: { id, name }, on }),
  // and the member's PCs the hub last listed.
  let remote = null;
  let remoteList = [];
  // My PCs: this PC as main named it ({ pc: { id, name, kind }, keys, lendTo }), or null.
  let pc = null;
  // Pets: this member's pet as setPet named it (kept across reconnects and a
  // Disconnect, since it is this Studio's own), what this socket last told
  // the relay, and when, so changes keep to the relay's pace.
  let myPet = null;
  let petHeard = null;
  let petSentAt = 0;
  let petTimer = null;
  // Subscribed rooms, each with the parts of Studio holding it open (Rooms'
  // chat, Listen together, the cowork claims). The hub hears subscribe from
  // the first holder and unsubscribe only when the last lets go, so one part
  // closing a room never cuts another off.
  const rooms = new Map(); // roomId -> Set of HOLDERS
  const pending = new Map(); // nonce -> { resolve, timer }

  const emit = (event) => { try { onEvent(event); } catch {} };
  function status() {
    return {
      configured: Boolean(address), state, error,
      user: session?.user ?? null, readOnly: Boolean(session?.readOnly), paused,
      rooms: [...rooms.keys()],
      companions: features.includes("companion"), companionDirect: features.includes("companion") && features.includes("companion.direct"),
      remote: features.includes("remote"), remoteOn: Boolean(remote?.on) && features.includes("remote"), remotePcs: remoteList,
      history: features.includes("history.peer"),
      credits: features.includes("credits"), projects: features.includes("projects"),
      events: features.includes("events"),
      lobby: features.includes("lobby"), joinCodes: features.includes("join.codes"), online: features.includes("online"), front: features.includes("front"), building: features.includes("building"),
      pcs: features.includes("pcs"), pcOn: Boolean(pc) && features.includes("pcs"),
      shop: features.includes("shop"), pets: features.includes("pets"), images: features.includes("messages.images"), trades: features.includes("shop.trades"), collectibles: features.includes("collectibles.1"),
    };
  }
  function setState(next, nextError = null) {
    if (!STATES.includes(next)) return;
    if (state === next && error === nextError) return;
    state = next; error = nextError;
    emit({ type: "status", status: status() });
  }
  const clearTimer = (timer) => { if (timer) cancel(timer); return null; };

  async function request(method, path, body, token) {
    if (!address || typeof fetchImpl !== "function") return { ok: false, error: "not-configured" };
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = later(() => controller?.abort(), requestTimeoutMs);
    try {
      const headers = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetchImpl(`${address.http}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller?.signal });
      let data = null;
      try { data = await res.json(); } catch {}
      if (res.ok && object(data) && data.ok !== false) return { ok: true, status: res.status, data };
      const code = object(data) && typeof data.error === "string" ? data.error : res.status === 401 ? "unauthorized" : "failed";
      // The body stays for callers that read it (a claim's 409 names the leases
      // it collided with); refused() still passes on only error, reason and wait.
      return { ok: false, status: res.status, error: code, reason: object(data) && typeof data.reason === "string" ? data.reason : undefined, retryAfter: object(data) && Number.isFinite(data.retryAfter) ? data.retryAfter : undefined, data: object(data) ? data : null };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      cancel(timer);
    }
  }

  // Trades the Discord access token for a hub session. The Discord token is
  // sent once per session and dropped; the hub never keeps it either.
  async function openSession() {
    let grant;
    try { grant = await getAccessToken(); } catch { grant = null; }
    if (!grant?.ok || typeof grant.token !== "string" || !grant.token) return { ok: false, error: grant?.error === "not-configured" ? "not-linked" : grant?.error || "not-linked" };
    const answer = await request("POST", "/v1/session", { accessToken: grant.token });
    if (!answer.ok) return { ok: false, error: answer.status === 401 ? "auth" : answer.error === "not-member" || answer.status === 403 ? "not-member" : answer.error === "rate-limited" ? "rate-limited" : "network", retryAfter: answer.retryAfter };
    const data = answer.data;
    const who = user(data.user);
    if (typeof data.session !== "string" || !data.session || !Number.isFinite(data.expiresAt) || !who) return { ok: false, error: "network" };
    return { ok: true, session: { token: data.session, expiresAt: data.expiresAt, user: who, readOnly: data.readOnly === true } };
  }

  function scheduleRenew() {
    renewTimer = clearTimer(renewTimer);
    if (!session) return;
    const wait = Math.max(5_000, session.expiresAt - now() - SESSION_MARGIN_MS);
    renewTimer = later(() => { renewTimer = null; void renew(); }, wait);
  }
  async function renew() {
    const mine = generation;
    const fresh = await openSession();
    if (mine !== generation || !wanted) return;
    if (!fresh.ok) {
      if (fresh.error === "auth" || fresh.error === "not-member" || fresh.error === "not-linked") { drop(); setState("error", fresh.error); return; }
      renewTimer = later(() => { renewTimer = null; void renew(); }, 30_000);
      return;
    }
    session = fresh.session;
    send({ type: "renew", session: session.token });
    scheduleRenew();
  }

  function send(frame) {
    if (!socket || socket.readyState !== 1) return false;
    try { socket.send(JSON.stringify(frame)); return true; } catch { return false; }
  }

  function settleAll(reason) {
    for (const [nonce, entry] of pending) { cancel(entry.timer); entry.resolve({ ok: false, reason }); pending.delete(nonce); }
  }

  function drop() {
    generation += 1;
    retryTimer = clearTimer(retryTimer);
    renewTimer = clearTimer(renewTimer);
    if (presenceTimer) { stopEvery(presenceTimer); presenceTimer = null; }
    if (keepaliveTimer) { stopEvery(keepaliveTimer); keepaliveTimer = null; }
    settleAll("offline");
    const closing = socket;
    socket = null;
    if (closing) { try { closing.close(1000, "bye"); } catch {} }
  }

  function retry(delay) {
    retryTimer = clearTimer(retryTimer);
    if (!wanted) return;
    const wait = Number.isFinite(delay) ? delay : BACKOFF_MS[Math.min(backoff, BACKOFF_MS.length - 1)];
    backoff += 1;
    retryTimer = later(() => { retryTimer = null; void open(); }, wait);
  }

  async function open() {
    if (!wanted || opening) return opening;
    opening = (async () => {
      drop();
      const mine = generation;
      if (!address) { setState("error", "not-configured"); return; }
      if (typeof SocketImpl !== "function") { setState("error", "unsupported"); return; }
      setState(state === "ready" ? "offline" : "connecting");
      if (!session || session.expiresAt - now() < SESSION_MARGIN_MS) {
        const fresh = await openSession();
        if (mine !== generation || !wanted) return;
        if (!fresh.ok) {
          session = null;
          if (fresh.error === "network" || fresh.error === "rate-limited") { setState("offline", fresh.error); retry(fresh.retryAfter); }
          else setState("error", fresh.error);
          return;
        }
        session = fresh.session;
      }
      let ws;
      try { ws = new SocketImpl(address.ws); } catch { setState("offline", "network"); retry(); return; }
      socket = ws;
      // `oldest` lets a newer relay keep speaking to this Studio; a relay
      // from before the window drops the field and compares `protocol` only.
      ws.onopen = () => { if (socket === ws) send({ type: "hello", session: session.token, protocol: PROTOCOL_VERSION, oldest: OLDEST_PROTOCOL, features: [...CLIENT_FEATURES] }); };
      ws.onmessage = (event) => { if (socket === ws) receive(event?.data); };
      ws.onerror = () => {};
      ws.onclose = (event) => { if (socket === ws) closed(Number(event?.code) || 1006, typeof event?.reason === "string" ? event.reason : ""); };
    })();
    try { await opening; } finally { opening = null; }
  }

  function closed(code, reason = "") {
    socket = null;
    if (presenceTimer) { stopEvery(presenceTimer); presenceTimer = null; }
    if (keepaliveTimer) { stopEvery(keepaliveTimer); keepaliveTimer = null; }
    renewTimer = clearTimer(renewTimer);
    settleAll("offline");
    if (!wanted) { setState("off"); return; }
    log(`[hub] socket closed ${code}`);
    if (code === 4001 || code === 4005) { session = null; setState("offline", "session"); retry(backoff ? undefined : 0); return; }
    // Outside the relay's protocol window (relay/src/protocol.mjs checkVersion).
    // When the relay is the side behind it is being updated, so Studio tries
    // again by itself; when this Studio is, only an update helps, and the
    // update's relaunch connects again by itself.
    if (code === 4002) {
      if (/relay/i.test(reason)) { setState("offline", "relay-behind"); retry(RELAY_BEHIND_RETRY_MS); return; }
      setState("error", "version");
      return;
    }
    if (code === 4004) { setState("offline", "too-many-sockets"); retry(60_000); return; }
    setState("offline", "network");
    retry();
  }

  function receive(data) {
    let frame;
    try { frame = JSON.parse(typeof data === "string" ? data : String(data)); } catch { return; }
    if (!object(frame) || typeof frame.type !== "string") return;
    switch (frame.type) {
      case "ready": {
        backoff = 0;
        const who = user(frame.user);
        if (who && session) session.user = who;
        if (session) session.readOnly = frame.readOnly === true;
        paused = frame.paused === true;
        features = Array.isArray(frame.features) ? frame.features.filter((name) => typeof name === "string" && name.length <= 40).slice(0, 32) : [];
        setState("ready");
        emit({ type: "status", status: status() });
        for (const roomId of rooms.keys()) { send({ type: "subscribe", roomId }); send({ type: "presence", roomId }); }
        // The hub forgets a share when the member's last socket closes.
        if (nowPlaying) sendNowPlaying();
        if (building && features.includes("building")) send({ type: "building", now: building });
        // And which of this member's sockets is a PC the remote may reach.
        if (remote && features.includes("remote")) sendRemoteHello();
        // And which of them is one of My PCs (the relay forgets it when a socket closes).
        if (pc && features.includes("pcs")) sendPcHello();
        // And this member's pet: a new socket starts without one, and is told at once.
        petTimer = clearTimer(petTimer);
        petHeard = null;
        petSentAt = 0;
        if (myPet) sendPetSoon();
        if (presenceTimer) stopEvery(presenceTimer);
        presenceTimer = every(() => { for (const roomId of rooms.keys()) send({ type: "presence", roomId }); }, PRESENCE_EVERY_MS);
        // The relay's keepalive keeps a socket with no rooms open (the remote,
        // presence) from looking idle, at no cost to the relay.
        if (keepaliveTimer) { stopEvery(keepaliveTimer); keepaliveTimer = null; }
        if (features.includes("keepalive")) keepaliveTimer = every(() => send(KEEPALIVE_FRAME), KEEPALIVE_EVERY_MS);
        scheduleRenew();
        return;
      }
      case "listen": {
        if (!opaqueId(frame.roomId)) return;
        const current = frame.session == null ? null : listenSession(frame.session);
        if (frame.session != null && !current) return;
        emit({ type: "listen", roomId: frame.roomId, session: current, sentAt: Number.isFinite(frame.sentAt) ? frame.sentAt : null, receivedAt: now() });
        return;
      }
      case "presence":
        if (opaqueId(frame.roomId) && Array.isArray(frame.inStudio)) emit({ type: "presence", roomId: frame.roomId, inStudio: frame.inStudio.filter((id) => SNOWFLAKE.test(String(id))).slice(0, 100) });
        return;
      case "room": {
        const room = roomSummary(frame.room);
        if (room) emit({ type: "room", room });
        return;
      }
      case "membership":
        if (opaqueId(frame.roomId) && ["joined", "left", "removed", "closed"].includes(frame.state)) emit({ type: "membership", roomId: frame.roomId, userId: String(frame.userId ?? ""), state: frame.state });
        return;
      // A friend's companion card (null when it went home). The card is passed
      // on as received; main reads it through companion-friends.readCard.
      // `direct` marks a card sent to this member alone (the hub keeps `to`).
      case "companion":
        if (opaqueId(frame.roomId) && SNOWFLAKE.test(String(frame.from))) emit({ type: "companion", roomId: frame.roomId, from: String(frame.from), card: object(frame.card) ? frame.card : null, direct: frame.to != null, receivedAt: now() });
        return;
      case "message":
      case "messageUpdate": {
        const message = roomMessage(frame.message);
        if (opaqueId(frame.roomId) && message) emit({ type: frame.type, roomId: frame.roomId, message });
        return;
      }
      case "messageDelete":
        if (opaqueId(frame.roomId) && SNOWFLAKE.test(String(frame.messageId))) emit({ type: "messageDelete", roomId: frame.roomId, messageId: String(frame.messageId) });
        return;
      // Peer history (feature "history.peer"): the relay asks this Studio for
      // what it holds of a room before `before`; main answers with historyReply.
      case "historyRequest":
        if (features.includes("history.peer") && opaqueId(frame.roomId) && opaqueId(frame.requestId) && rooms.has(frame.roomId)) {
          emit({ type: "historyRequest", roomId: frame.roomId, requestId: frame.requestId, before: SNOWFLAKE.test(String(frame.before ?? "")) ? String(frame.before) : null });
        }
        return;
      // Someone this member shares a room with just opened Studio (feature "friend.online").
      case "friendOnline": {
        const who = user(frame.user);
        if (who) emit({ type: "friendOnline", user: who });
        return;
      }
      // This member earned or spent credits (feature "credits").
      case "credits":
        if (Number.isFinite(frame.balance) && Number.isFinite(frame.delta)) {
          emit({ type: "credits", balance: frame.balance, lifetime: Number.isFinite(frame.lifetime) ? frame.lifetime : null, today: Number.isFinite(frame.today) ? frame.today : null, delta: frame.delta, reason: typeof frame.reason === "string" ? frame.reason.slice(0, 20) : "", rank: RANK_KEY.test(String(frame.rank ?? "")) ? frame.rank : null });
        }
        return;
      // Another member's copy of a room's messages, each checked by the relay.
      case "history":
        if (opaqueId(frame.roomId) && Array.isArray(frame.messages)) {
          emit({ type: "history", roomId: frame.roomId, messages: frame.messages.slice(0, HISTORY_REPLY_MESSAGES).map(roomMessage).filter(Boolean), hasMore: frame.hasMore === true });
        }
        return;
      case "joinRequest": {
        const request = joinRequest(frame.request);
        if (request) emit({ type: "joinRequest", request });
        return;
      }
      case "invite": {
        const invite = roomInvite(frame.invite);
        if (invite) emit({ type: "invite", invite });
        return;
      }
      // A cowork room's live file claims, all of them, after every change and
      // once right after subscribing (scripts/cowork.cjs reads each lease).
      case "claims":
        if (opaqueId(frame.roomId) && Array.isArray(frame.leases)) emit({ type: "claims", roomId: frame.roomId, leases: frame.leases.slice(0, 200).map(cowork.lease).filter(Boolean) });
        return;
      case "hubState":
        paused = frame.paused === true;
        emit({ type: "status", status: status() });
        return;
      // The Discord remote: a command from the member's own DMs, only while
      // this PC has the remote on, and the member's PCs that have it on.
      case "remote": {
        const command = remote?.on && features.includes("remote") ? remoteCommand(frame) : null;
        if (command) emit({ type: "remote", command, receivedAt: now() });
        return;
      }
      case "remoteState": {
        const pcs = remotePcs(frame.pcs);
        if (!pcs) return;
        remoteList = pcs;
        emit({ type: "remoteState", pcs });
        emit({ type: "status", status: status() });
        return;
      }
      // My PCs: the PCs this one sees, a status line from one of them, and an
      // envelope for this PC. Nothing is handed on unless setPc named this PC.
      case "pcs": {
        const pcs = pcReady() ? pcViews(frame.pcs) : null;
        if (pcs) emit({ type: "pcs", pcs });
        return;
      }
      case "pcState": {
        const from = pcId(frame.from);
        if (pcReady() && from && object(frame.state) && jsonBytes(frame.state) <= PC_STATE_BYTES) emit({ type: "pcState", from, state: frame.state, receivedAt: now() });
        return;
      }
      case "pcMsg": {
        const from = pcId(frame.from);
        const fromUser = snowflake(frame.fromUser);
        const keys = pcKeys(frame.keys);
        if (pcReady() && from && fromUser && keys && object(frame.env) && jsonBytes(frame.env) <= PC_ENV_BYTES) {
          emit({ type: "pcMsg", from, fromUser, fromName: text(frame.fromName, 100) || "member", keys, env: frame.env, receivedAt: now() });
        }
        return;
      }
      case "ack":
      case "nack": {
        const entry = pending.get(frame.nonce);
        if (!entry) return;
        pending.delete(frame.nonce);
        cancel(entry.timer);
        entry.resolve(frame.type === "ack"
          ? { ok: true, ...(SNOWFLAKE.test(String(frame.messageId)) ? { messageId: String(frame.messageId) } : {}) }
          : { ok: false, reason: typeof frame.reason === "string" ? frame.reason : "failed", retryAfter: Number.isFinite(frame.retryAfter) ? frame.retryAfter : undefined });
        return;
      }
      // A room's pets (feature "pets"): the members there with a pet, this member's own included.
      case "collectibles": {
        if (features.includes("collectibles.1")) emit({ type: "collectibles" });
        return;
      }
      case "roomPets": {
        const pets = features.includes("pets") && opaqueId(frame.roomId) ? roomPetsOf(frame.pets) : null;
        if (pets) emit({ type: "roomPets", roomId: frame.roomId, pets });
        return;
      }
      case "error":
        emit({ type: "hubError", code: typeof frame.code === "string" ? frame.code : "unknown" });
        return;
      default:
    }
  }

  function withAck(frame) {
    if (state !== "ready") return Promise.resolve({ ok: false, reason: "offline" });
    nonceSeq = (nonceSeq + 1) % 1e9;
    const nonce = `st${now().toString(36)}${nonceSeq.toString(36)}`;
    return new Promise((resolve) => {
      const timer = later(() => { if (pending.delete(nonce)) resolve({ ok: false, reason: "timeout" }); }, ACK_TIMEOUT_MS);
      pending.set(nonce, { resolve, timer });
      if (!send({ ...frame, nonce })) { cancel(timer); pending.delete(nonce); resolve({ ok: false, reason: "offline" }); }
    });
  }

  function sendNowPlaying() {
    send(nowPlaying ? { type: "nowPlaying", track: nowPlaying } : { type: "nowPlaying", track: null });
  }
  function sendRemoteHello() {
    send({ type: "remoteHello", pc: { ...remote.pc }, on: remote.on === true });
  }
  const remoteReady = () => state === "ready" && features.includes("remote") && remote?.on === true;
  function sendPcHello() {
    send({ type: "pcHello", pc: { ...pc.pc }, keys: { ...pc.keys }, lendTo: [...pc.lendTo] });
  }
  const pcReady = () => state === "ready" && features.includes("pcs") && Boolean(pc);
  // The pet frame to a relay that carries pets: at most one every PET_EVERY_MS
  // (the latest pet waits its turn), and never one the relay already has. A
  // pet the relay does not know yet goes as Ember.
  function sendPetSoon() {
    if (petTimer || state !== "ready" || !features.includes("pets")) return;
    const pet = petForRelay(myPet, petsGenerationOf(features));
    if (JSON.stringify(pet) === JSON.stringify(petHeard)) return;
    const wait = petSentAt + PET_EVERY_MS - now();
    if (wait > 0) {
      petTimer = later(() => { petTimer = null; sendPetSoon(); }, wait);
      return;
    }
    if (send({ type: "pet", pet })) {
      petHeard = pet;
      petSentAt = now();
    }
  }

  // An HTTP call with the hub session, renewed once when the hub says it
  // lapsed. Refusals keep the hub's own error, reason and retryAfter.
  async function authed(method, path, body) {
    if (!session) return { ok: false, error: state === "error" ? error : "offline" };
    let answer = await request(method, path, body, session.token);
    if (!answer.ok && answer.status === 401) {
      const fresh = await openSession();
      if (!fresh.ok) return { ok: false, error: fresh.error };
      session = fresh.session;
      answer = await request(method, path, body, session.token);
    }
    return answer;
  }
  const refused = (answer) => ({ ok: false, error: answer.error, ...(answer.reason ? { reason: answer.reason } : {}), ...(answer.retryAfter != null ? { retryAfter: answer.retryAfter } : {}) });
  // A Shop refusal also keeps what Studio needs to say why: the item to get first (needs), the price now, the
  // balance (and the tip that made it short), why this member cannot sell yet (hold, until), and the drop of an item
  // that has rotated out (not-available).
  const shopRefused = (answer) => {
    const data = object(answer.data) ? answer.data : {};
    return {
      ...refused(answer),
      ...(shopItemId(data.needs) ? { needs: data.needs } : {}),
      ...(count(data.price, 1e6) != null ? { price: data.price } : {}),
      ...(count(data.balance, 1e12) != null ? { balance: data.balance } : {}),
      ...(count(data.tip, PACK_TIP_MAX) ? { tip: data.tip } : {}),
      ...(CREDIT_HOLDS.includes(data.hold) ? { hold: data.hold } : {}),
      ...(Number.isFinite(data.until) ? { until: data.until } : {}),
      ...(SHOP_DROP_ID.test(String(data.drop ?? "")) ? { drop: data.drop } : {}),
    };
  };
  const bad = () => Promise.resolve({ ok: false, error: "bad-request" });
  // Loaded when the social client starts, never during app boot.
  const trades = require("./social-client.cjs").createSocialClient({ request: authed, supported: (feature) => features.includes(feature) });
  const id = (value) => opaqueId(value);
  async function simple(method, path, body) {
    const answer = await authed(method, path, body);
    return answer.ok ? { ok: true } : refused(answer);
  }
  async function one(method, path, body, key, shape) {
    const answer = await authed(method, path, body);
    if (!answer.ok) return refused(answer);
    const value = shape(answer.data[key]);
    return value ? { ok: true, [key]: value } : { ok: false, error: "failed" };
  }
  async function many(path, key, shape) {
    const answer = await authed("GET", path);
    if (!answer.ok) return refused(answer);
    return { ok: true, [key]: Array.isArray(answer.data[key]) ? answer.data[key].map(shape).filter(Boolean) : [] };
  }
  // A pack the relay sent back after publishing, changing or unlisting it.
  function packAnswer(answer) {
    if (!answer.ok) return shopRefused(answer);
    const pack = itemCard(answer.data.pack);
    return pack ? { ok: true, pack } : { ok: false, error: "failed" };
  }

  return {
    status,
    // Opens (or keeps) the connection. Idempotent; resolves once the first
    // attempt has an answer, which status() then reports.
    async connect() {
      if (!address) { setState("error", "not-configured"); return status(); }
      wanted = true;
      if (state === "ready" || state === "connecting" || opening) return status();
      backoff = 0;
      await open();
      return status();
    },
    // After sleep or a network change: try at once instead of waiting out the
    // backoff. A refusal (an old Studio, a lost sign-in) waits for its own fix.
    reconnectNow() {
      if (!wanted || state === "ready" || state === "error" || opening) return false;
      backoff = 0;
      retryTimer = clearTimer(retryTimer);
      void open();
      return true;
    },
    // Closes the socket and ends the hub session. Rooms and the now-playing
    // share are forgotten, so a later connect starts clean.
    async disconnect() {
      wanted = false;
      const token = session?.token;
      drop();
      session = null;
      rooms.clear();
      nowPlaying = null;
      building = null;
      features = [];
      remote = null;
      remoteList = [];
      pc = null;
      // The pet stays (it is this Studio's own); the next socket is told it again.
      petTimer = clearTimer(petTimer);
      petHeard = null;
      setState("off");
      if (token) await request("DELETE", "/v1/session", undefined, token);
      return status();
    },
    // Listed rooms plus the member's own.
    async rooms() {
      const answer = await many("/v1/rooms", "rooms", roomSummary);
      return answer.ok ? answer : { ok: false, error: answer.error };
    },
    // ---- Rooms, requests and invites (Friends › Rooms) -----------------------
    // Each call checks its arguments against the protocol's shapes before it
    // leaves, and answers { ok, ... } or the hub's { ok: false, error, reason? }.
    createRoom(fields = {}) {
      const name = line(fields?.name, 80);
      if (!name || !["hangout", "cowork"].includes(fields.kind) || !["request", "invite"].includes(fields.policy) || typeof fields.listed !== "boolean") return bad();
      return one("POST", "/v1/rooms", { kind: fields.kind, name, policy: fields.policy, listed: fields.listed }, "room", roomSummary);
    },
    requestJoin(roomId, note = "") {
      if (!id(roomId) || typeof note !== "string" || note.length > 300) return bad();
      return one("POST", `/v1/rooms/${roomId}/requests`, note.trim() ? { note: text(note, 300) } : {}, "request", joinRequest);
    },
    requests() { return many("/v1/requests", "requests", joinRequest); },
    decide(requestId, decision) {
      if (!id(requestId) || !["approve", "deny"].includes(decision)) return bad();
      return one("POST", `/v1/requests/${requestId}/decide`, { decision }, "request", joinRequest);
    },
    cancelRequest(requestId) { return id(requestId) ? simple("POST", `/v1/requests/${requestId}/cancel`) : bad(); },
    invite(roomId, userId) {
      if (!id(roomId) || !SNOWFLAKE.test(String(userId ?? ""))) return bad();
      return one("POST", `/v1/rooms/${roomId}/invites`, { userId: String(userId) }, "invite", roomInvite);
    },
    invites() { return many("/v1/invites", "invites", roomInvite); },
    acceptInvite(inviteId) { return id(inviteId) ? one("POST", `/v1/invites/${inviteId}/accept`, undefined, "room", roomSummary) : bad(); },
    declineInvite(inviteId) { return id(inviteId) ? simple("POST", `/v1/invites/${inviteId}/decline`) : bad(); },
    leave(roomId) { return id(roomId) ? simple("POST", `/v1/rooms/${roomId}/leave`) : bad(); },
    removeMember(roomId, userId) { return id(roomId) && SNOWFLAKE.test(String(userId ?? "")) ? simple("POST", `/v1/rooms/${roomId}/members/${userId}/remove`) : bad(); },
    lock(roomId) { return id(roomId) ? one("POST", `/v1/rooms/${roomId}/lock`, undefined, "room", roomSummary) : bad(); },
    unlock(roomId) { return id(roomId) ? one("POST", `/v1/rooms/${roomId}/unlock`, undefined, "room", roomSummary) : bad(); },
    close(roomId) { return id(roomId) ? simple("POST", `/v1/rooms/${roomId}/close`) : bad(); },
    async searchMembers(query) {
      const q = typeof query === "string" ? query.trim() : "";
      if (!q || q.length > 32 || !ONE_LINE.test(q)) return { ok: false, error: "bad-request" };
      const answer = await authed("GET", `/v1/members/search?q=${encodeURIComponent(q)}`);
      if (!answer.ok) return refused(answer);
      return { ok: true, members: Array.isArray(answer.data.members) ? answer.data.members.map(user).filter(Boolean).slice(0, 10) : [] };
    },
    // Up to 50 messages, oldest first; `before` pages back from a message id.
    async messages(roomId, before = null) {
      if (!id(roomId) || (before != null && !SNOWFLAKE.test(String(before)))) return { ok: false, error: "bad-request" };
      const answer = await authed("GET", `/v1/rooms/${roomId}/messages${before ? `?before=${before}` : ""}`);
      if (!answer.ok) return refused(answer);
      return { ok: true, messages: Array.isArray(answer.data.messages) ? answer.data.messages.map(roomMessage).filter(Boolean) : [], hasMore: answer.data.hasMore === true };
    },
    // `message` (optional) is this Studio's own copy; the relay keeps its text
    // as evidence only when the relay's signature on it checks out.
    report(roomId, messageId, reason, message = null) {
      const why = typeof reason === "string" ? reason.trim() : "";
      if (!id(roomId) || !SNOWFLAKE.test(String(messageId ?? "")) || !why || why.length > 500) return bad();
      const copy = message && String(message.id) === String(messageId) ? wireMessage(message) : null;
      return simple("POST", "/v1/reports", { roomId, messageId: String(messageId), reason: text(why, 500), ...(copy?.sig ? { message: copy } : {}) });
    },
    // Room chat over the socket: an ack (with the Discord message id) or a
    // nack with the hub's reason, or "timeout" after 10 s. Nothing retries
    // on its own.
    sendSticker(roomId, instanceId, name = "Sticker") {
      if (!features.includes("collectibles.1")) return Promise.resolve({ ok: false, reason: "unsupported" });
      if (!id(roomId) || !/^[A-Za-z0-9_:-]{1,80}$/.test(String(instanceId ?? ""))) return bad();
      return withAck({ type: "send", roomId, text: `[Sticker: ${text(name, 40)}]`, stickerId: instanceId });
    },
    sendMessage(roomId, message) {
      const body = postText(message);
      if (!id(roomId) || !body) return Promise.resolve({ ok: false, reason: "bad-request" });
      return withAck({ type: "send", roomId, text: body });
    },
    editMessage(roomId, messageId, message) {
      const body = postText(message);
      if (!id(roomId) || !SNOWFLAKE.test(String(messageId ?? "")) || !body) return Promise.resolve({ ok: false, reason: "bad-request" });
      return withAck({ type: "edit", roomId, messageId: String(messageId), text: body });
    },
    deleteMessage(roomId, messageId) {
      if (!id(roomId) || !SNOWFLAKE.test(String(messageId ?? ""))) return Promise.resolve({ ok: false, reason: "bad-request" });
      return withAck({ type: "delete", roomId, messageId: String(messageId) });
    },
    // ---- Peer history (feature "history.peer") -------------------------------
    // Ask the room for messages older than `before` (or the latest): the relay
    // forwards the ask to another member's Studio and sends back a `history`
    // event with what it held. Answers the ack, or { ok: false, reason }
    // ("no-peer" when nobody else in the room can answer).
    historyAsk(roomId, before = null) {
      if (!features.includes("history.peer")) return Promise.resolve({ ok: false, reason: "unsupported" });
      if (!id(roomId) || !rooms.has(roomId) || (before != null && !SNOWFLAKE.test(String(before)))) return Promise.resolve({ ok: false, reason: "bad-request" });
      return withAck({ type: "historyRequest", roomId, ...(before != null ? { before: String(before) } : {}) });
    },
    // Answer a `historyRequest` from this Studio's own copy: newest last, as
    // many as fit one frame (the oldest are left out first). False when not sent.
    historyReply(requestId, messages, hasMore = false) {
      if (!features.includes("history.peer") || !id(requestId) || !Array.isArray(messages)) return false;
      const wire = messages.map(wireMessage).filter(Boolean).slice(-HISTORY_REPLY_MESSAGES);
      let more = hasMore === true;
      const size = (list) => Buffer.byteLength(JSON.stringify({ type: "historyReply", requestId, messages: list, hasMore: more }));
      while (wire.length && size(wire) > HISTORY_REPLY_BYTES) { wire.shift(); more = true; }
      return send({ type: "historyReply", requestId, messages: wire, hasMore: more });
    },
    // ---- Connecting: join codes and Who's online (relay) ----------------------
    async roomCode(roomId) {
      if (!features.includes("join.codes")) return { ok: false, error: "unsupported" };
      if (!id(roomId)) return { ok: false, error: "bad-request" };
      const answer = await authed("GET", `/v1/rooms/${roomId}/code`);
      if (!answer.ok) return refused(answer);
      return codeOf(answer.data);
    },
    async newRoomCode(roomId) {
      if (!features.includes("join.codes")) return { ok: false, error: "unsupported" };
      if (!id(roomId)) return { ok: false, error: "bad-request" };
      const answer = await authed("POST", `/v1/rooms/${roomId}/code`);
      if (!answer.ok) return refused(answer);
      return codeOf(answer.data);
    },
    joinCode(code) {
      const typed = typeof code === "string" ? code.trim() : "";
      if (!features.includes("join.codes")) return Promise.resolve({ ok: false, error: "unsupported" });
      if (!/^[A-Za-z0-9 -]{4,24}$/.test(typed)) return Promise.resolve({ ok: false, error: "bad-request", reason: "code" });
      return one("POST", "/v1/join", { code: typed }, "room", roomSummary);
    },
    async online() {
      if (!features.includes("online")) return { ok: false, error: "unsupported" };
      const answer = await authed("GET", "/v1/online");
      if (!answer.ok) return refused(answer);
      const people = Array.isArray(answer.data.people) ? answer.data.people.map((item) => {
        const who = user(item);
        return who ? { ...who, rank: RANK_KEY.test(String(item.rank ?? "")) ? item.rank : "spark", specialRanks: specialOf(item.specialRanks) } : null;
      }).filter(Boolean).slice(0, 200) : [];
      return { ok: true, people, visible: answer.data.visible !== false };
    },
    async setOnlineVisible(visible) {
      if (!features.includes("online") || typeof visible !== "boolean") return { ok: false, error: "bad-request" };
      const answer = await authed("POST", "/v1/me/online", { visible });
      return answer.ok ? { ok: true, visible: answer.data.visible === true } : refused(answer);
    },
    // ---- Reports and moderators (relay) -------------------------------------
    reportProject(projectId, reason) {
      const why = typeof reason === "string" ? reason.trim() : "";
      if (!features.includes("projects") || !id(projectId) || !why || why.length > 500) return bad();
      return simple("POST", `/v1/projects/${projectId}/report`, { reason: text(why, 500) });
    },
    async modFlags() {
      const answer = await authed("GET", "/v1/admin/credits/flags");
      if (!answer.ok) return refused(answer);
      const flags = Array.isArray(answer.data.flags) ? answer.data.flags.map((item) => {
        const who = user(item);
        // The most a member gave may come from one who used Forget me since: no id, a name that says so.
        const forgotten = object(item?.top) && item.top.forgotten === true;
        const top = forgotten ? { id: null, name: text(item.top.name, 100) || "a member who used Forget me" } : user(item?.top);
        if (!who || !top) return null;
        return {
          ...who, total: count(item.total, 1e9) ?? 0, why: item.why === "mutual" ? "mutual" : "one-giver",
          top: { ...top, amount: count(item.top.amount, 1e9) ?? 0, share: count(item.top.share, 100) ?? 0, accountCreatedAt: Number.isFinite(item.top.accountCreatedAt) ? item.top.accountCreatedAt : null, ...(forgotten ? { forgotten: true } : {}) },
          mutual: Array.isArray(item.mutual) ? item.mutual.map(user).filter(Boolean).slice(0, 5) : [],
        };
      }).filter(Boolean).slice(0, 50) : [];
      return { ok: true, days: count(answer.data.days, 365) ?? 30, flags };
    },
    async modReview(userId) {
      if (!SNOWFLAKE.test(String(userId ?? ""))) return { ok: false, error: "bad-request" };
      const answer = await authed("GET", `/v1/admin/credits/${userId}`);
      if (!answer.ok) return refused(answer);
      const data = answer.data;
      const who = user(data.member);
      if (!who) return { ok: false, error: "failed" };
      const when = (value) => (Number.isFinite(value) ? value : null);
      const standing = object(data.member.standing) ? { ok: data.member.standing.ok === true, reason: CREDIT_HOLDS.includes(data.member.standing.reason) ? data.member.standing.reason : null, until: when(data.member.standing.until) } : { ok: false, reason: null, until: null };
      return {
        ok: true,
        member: { ...who, accountCreatedAt: when(data.member.accountCreatedAt), joinedAt: when(data.member.joinedAt), standing },
        credits: { balance: count(data.credits?.balance, 1e12) ?? 0, lifetime: count(data.credits?.lifetime, 1e12) ?? 0, rank: RANK_KEY.test(String(data.credits?.rank ?? "")) ? data.credits.rank : "spark", held: count(data.credits?.held, 1e12) ?? 0 },
        days: count(data.days, 365) ?? 30,
        total: count(data.total, 1e12) ?? 0,
        givers: Array.isArray(data.givers) ? data.givers.map((item) => ({
          // A member's id, or the random one a member who used Forget me has here (modRevoke's `from` takes either).
          id: SNOWFLAKE.test(String(item?.id ?? "")) || GONE_ID.test(String(item?.id ?? "")) ? String(item.id) : null,
          forgotten: GONE_ID.test(String(item?.id ?? "")),
          name: text(item?.name, 100) || "member",
          amount: count(item?.amount, 1e12) ?? 0, events: count(item?.events, 1e9) ?? 0, share: count(item?.share, 100) ?? 0,
          accountCreatedAt: when(item?.accountCreatedAt), joinedAt: when(item?.joinedAt),
        })).slice(0, 50) : [],
      };
    },
    async modRevoke(userId, options = {}) {
      const from = options?.from == null ? null : String(options.from);
      const days = options?.days == null ? null : Number(options.days);
      if (!SNOWFLAKE.test(String(userId ?? "")) || (from !== null && !SNOWFLAKE.test(from) && !GONE_ID.test(from)) || (days !== null && (!Number.isSafeInteger(days) || days < 1 || days > 180))) return { ok: false, error: "bad-request" };
      const answer = await authed("POST", `/v1/admin/credits/${userId}/revoke`, { ...(from ? { from } : {}), ...(days ? { days } : {}) });
      if (!answer.ok) return refused(answer);
      return { ok: true, revoked: count(answer.data.revoked, 1e12) ?? 0, credits: { balance: count(answer.data.credits?.balance, 1e12) ?? 0, lifetime: count(answer.data.credits?.lifetime, 1e12) ?? 0, rank: RANK_KEY.test(String(answer.data.credits?.rank ?? "")) ? answer.data.credits.rank : "spark" } };
    },
    async modReports() {
      const answer = await authed("GET", "/v1/admin/reports");
      if (!answer.ok) return refused(answer);
      const reports = Array.isArray(answer.data.reports) ? answer.data.reports.map((item) => {
        if (!object(item) || !opaqueId(item.id)) return null;
        return {
          id: item.id, kind: item.kind === "project" ? "project" : item.kind === "shop" ? "shop" : "message",
          roomId: opaqueId(item.roomId) ? item.roomId : null, messageId: SNOWFLAKE.test(String(item.messageId)) ? String(item.messageId) : null,
          projectId: opaqueId(item.projectId) ? item.projectId : null,
          // A Shop pack's report (relay/src/shop.mjs): modShopRemove takes the pack off.
          packId: isPackId(item.packId) ? item.packId : null,
          author: user(item.author), reporter: user(item.reporter), reason: text(item.reason, 500), text: typeof item.text === "string" ? text(item.text, 2000) : null,
          verified: item.verified === true, createdAt: Number.isFinite(item.createdAt) ? item.createdAt : null,
          ...(item.imageAvailable === true ? {imageAvailable:true} : {}),
        };
      }).filter(Boolean).slice(0, 100) : [];
      return { ok: true, reports };
    },
    modResolve(reportId) { return id(reportId) ? simple("POST", `/v1/admin/reports/${reportId}/resolve`) : bad(); },
    modSuspend(userId, minutes) {
      if (!SNOWFLAKE.test(String(userId ?? "")) || !Number.isSafeInteger(minutes) || minutes < 0 || minutes > 60 * 24 * 365) return bad();
      return simple("POST", `/v1/admin/members/${userId}/suspend`, { minutes });
    },
    // Credits on hold (relay credits.mjs): what newcomer waves would have paid members, waiting for a moderator.
    async modHeld() {
      const answer = await authed("GET", "/v1/admin/credits/held");
      return answer.ok ? { ok: true, holds: holdsOf(answer.data.holds), keepDays: count(answer.data.keepDays, 365) ?? 30 } : refused(answer);
    },
    // Pay ("release") or drop what is held for a member: all of it, or only what one newcomer would have paid.
    async modHeldDecide(userId, action, from = null) {
      if (!SNOWFLAKE.test(String(userId ?? "")) || !["release", "drop"].includes(action) || (from != null && !SNOWFLAKE.test(String(from)))) return bad();
      const answer = await authed("POST", `/v1/admin/credits/held/${userId}`, { action, ...(from != null ? { from: String(from) } : {}) });
      return answer.ok ? { ok: true, total: count(answer.data.total, 1e12) ?? 0, holds: holdsOf(answer.data.holds) } : refused(answer);
    },
    // The switches (relay credits.mjs SWITCHES): which kinds of reward, the jam's prizes or featuring a moderator
    // turned off for now, and turning one off or back on. -> { ok, off: [key...] }
    async modSwitches() {
      const answer = await authed("GET", "/v1/admin/credits/switches");
      return answer.ok ? { ok: true, off: switchesOff(answer.data.off) } : refused(answer);
    },
    async modSwitch(key, on) {
      if (!CREDIT_SWITCHES.includes(key) || typeof on !== "boolean") return bad();
      const answer = await authed("POST", "/v1/admin/credits/switches", { key, on });
      return answer.ok ? { ok: true, off: switchesOff(answer.data.off) } : refused(answer);
    },
    // The Build Jam to look at (relay events.mjs, GET /v1/admin/jam): the one waiting for its day of review, else this
    // week's, every vote with whether it counts and why not, and the voters' account ages, join dates and batches.
    async modJam() {
      const answer = await authed("GET", "/v1/admin/jam");
      return answer.ok ? { ok: true, jam: modJamOf(answer.data.jam) } : refused(answer);
    },
    // A voter's votes in that jam no longer count, and they cannot vote in it again.
    modJamVoid(eventId, userId) {
      if (!id(eventId) || !SNOWFLAKE.test(String(userId ?? ""))) return bad();
      return simple("DELETE", `/v1/admin/jam/${eventId}/votes/${userId}`);
    },
    // Pay a jam in review now instead of waiting its day out.
    modJamRelease(eventId) { return id(eventId) ? simple("POST", `/v1/admin/jam/${eventId}/release`) : bad(); },
    async front() {
      if (!features.includes("front")) return { ok: false, error: "unsupported" };
      const answer = await authed("GET", "/v1/front");
      return answer.ok ? frontPage(answer.data) : refused(answer);
    },
    // ---- Community events (feature "events"): the weekly Build Jam, co-work hours, building together ---
    async events() {
      if (!features.includes("events")) return { ok: false, error: "unsupported" };
      const answer = await authed("GET", "/v1/events");
      return answer.ok ? eventsPage(answer.data) : refused(answer);
    },
    // One of your own shared projects into this week's jam (until Saturday); a different one replaces it.
    async enterEvent(eventId, projectId) {
      if (!features.includes("events") || !id(eventId) || !id(projectId)) return { ok: false, error: "bad-request" };
      const answer = await authed("POST", `/v1/events/${eventId}/entry`, { projectId });
      return answer.ok ? { ok: true, jam: jamOf(answer.data.jam) } : refused(answer);
    },
    async leaveEvent(eventId) {
      if (!features.includes("events") || !id(eventId)) return { ok: false, error: "bad-request" };
      const answer = await authed("DELETE", `/v1/events/${eventId}/entry`);
      return answer.ok ? { ok: true, jam: jamOf(answer.data.jam) } : refused(answer);
    },
    // A vote for an entrant (by member id), or taking it back; only for an entry you played during the jam.
    async voteEvent(eventId, userId, on = true) {
      if (!features.includes("events") || !id(eventId) || !SNOWFLAKE.test(String(userId ?? ""))) return { ok: false, error: "bad-request" };
      const answer = on === false ? await authed("DELETE", `/v1/events/${eventId}/votes/${userId}`) : await authed("POST", `/v1/events/${eventId}/votes`, { userId: String(userId) });
      if (answer.ok) return { ok: true, jam: jamOf(answer.data.jam) };
      // Why this member's votes do not count yet (credits.mjs standing()), so Studio can say when they will.
      return { ...refused(answer), ...(CREDIT_HOLDS.includes(answer.data?.hold) ? { hold: answer.data.hold } : {}) };
    },
    // A moderator takes an entry out of a jam that is still running.
    removeEntry(eventId, userId) {
      if (!features.includes("events") || !id(eventId) || !SNOWFLAKE.test(String(userId ?? ""))) return bad();
      return simple("DELETE", `/v1/events/${eventId}/entries/${userId}`);
    },
    // A co-work hour's room, joined straight away. The caller keeps it open (subscribe) while attending.
    async joinEvent(eventId) {
      if (!features.includes("events") || !id(eventId)) return { ok: false, error: "bad-request" };
      const answer = await authed("POST", `/v1/events/${eventId}/join`);
      if (!answer.ok) return refused(answer);
      return opaque(answer.data.roomId) ? { ok: true, roomId: answer.data.roomId, cowork: coworkOf(answer.data.cowork) } : { ok: false, error: "failed" };
    },
    // ---- Credits, ranks and the project hub (features "credits", "projects") ---
    async me() {
      if (!features.includes("credits")) return { ok: false, error: "unsupported" };
      const answer = await authed("GET", "/v1/me");
      if (!answer.ok) return refused(answer);
      const data = answer.data;
      return {
        ok: true, user: user(data.user),
        // held: what a newcomer wave would have paid this member, waiting for a moderator's quick check.
        credits: { balance: count(data.credits?.balance, 1e12) ?? 0, lifetime: count(data.credits?.lifetime, 1e12) ?? 0, today: count(data.credits?.today, 1e6) ?? 0, todayCap: count(data.credits?.todayCap, 1e6) ?? 0, held: count(data.credits?.held, 1e12) ?? 0 },
        rank: rankOf(data.rank), specialRanks: specialOf(data.specialRanks), streak: { days: count(data.streak?.days, 1e6) ?? 0, best: count(data.streak?.best, 1e6) ?? 0 },
        featureCost: count(data.featureCost, 1e6) ?? 0, canEarn: data.canEarn === true,
        // Why this member cannot give or earn credits yet, and until when (relay/src/credits.mjs GUARD).
        hold: object(data.hold) && CREDIT_HOLDS.includes(data.hold.reason) ? { reason: data.hold.reason, until: Number.isFinite(data.hold.until) ? data.hold.until : null } : null,
        moderator: data.moderator === true,
        projects: Array.isArray(data.projects) ? data.projects.map(projectCard).filter(Boolean) : [],
      };
    },
    async memberCard(userId) {
      if (!features.includes("credits")) return { ok: false, error: "unsupported" };
      if (!SNOWFLAKE.test(String(userId ?? ""))) return { ok: false, error: "bad-request" };
      const answer = await authed("GET", `/v1/members/${userId}/card`);
      if (!answer.ok) return refused(answer);
      const card = answer.data.member;
      const who = user(card);
      if (!who) return { ok: false, error: "failed" };
      return { ok: true, member: { ...who, rank: rankOf(card.rank), specialRanks: specialOf(card.specialRanks), projects: Array.isArray(card.projects) ? card.projects.map(projectCard).filter(Boolean) : [] } };
    },
    async projects(view = "new") {
      if (!features.includes("projects")) return { ok: false, error: "unsupported" };
      const which = PROJECT_VIEWS.includes(view) ? view : "new";
      const answer = await authed("GET", `/v1/projects?view=${which}`);
      if (!answer.ok) return refused(answer);
      const list = (value) => (Array.isArray(value) ? value.map(projectCard).filter(Boolean) : []);
      return { ok: true, projects: list(answer.data.projects), featured: list(answer.data.featured) };
    },
    async shareProject(fields = {}) {
      if (!features.includes("projects")) return { ok: false, error: "unsupported" };
      const url = listenUrl(fields?.url);
      const title = line(fields?.title, 100);
      const blurb = fields?.blurb == null || fields.blurb === "" ? "" : line(fields.blurb, 300);
      if (!url || !title || blurb == null) return { ok: false, error: "bad-request" };
      const answer = await authed("POST", "/v1/projects", { url, title, ...(blurb ? { blurb } : {}), kind: PROJECT_KINDS.includes(fields?.kind) ? fields.kind : "other" });
      if (!answer.ok) return refused(answer);
      return { ok: true, project: projectCard(answer.data.project), credited: count(answer.data.credited, 1e6) ?? 0 };
    },
    removeProject(projectId) { return id(projectId) && features.includes("projects") ? simple("DELETE", `/v1/projects/${projectId}`) : bad(); },
    // Opening a project: the link to open and a token; finishPlay with the
    // token at least two minutes later counts the play (and credits both).
    async playProject(projectId) {
      if (!features.includes("projects") || !id(projectId)) return { ok: false, error: "bad-request" };
      const answer = await authed("POST", `/v1/projects/${projectId}/play`);
      if (!answer.ok) return refused(answer);
      const url = listenUrl(answer.data.url);
      if (!url || typeof answer.data.token !== "string") return { ok: false, error: "failed" };
      return { ok: true, url, token: answer.data.token, minMs: count(answer.data.minMs, 86_400_000) ?? 120_000, expiresAt: Number.isFinite(answer.data.expiresAt) ? answer.data.expiresAt : null };
    },
    async finishPlay(projectId, token) {
      if (!features.includes("projects") || !id(projectId) || typeof token !== "string" || token.length > 64) return { ok: false, error: "bad-request" };
      const answer = await authed("POST", `/v1/projects/${projectId}/played`, { token });
      if (!answer.ok) return refused(answer);
      const why = ["own", "maker-held", "limit", "paused", ...CREDIT_HOLDS].includes(answer.data.why) ? answer.data.why : null;
      return { ok: true, counted: answer.data.counted === true, credited: { owner: count(answer.data.credited?.owner, 1e6) ?? 0, you: count(answer.data.credited?.you, 1e6) ?? 0 }, why };
    },
    async star(projectId, on = true) {
      if (!features.includes("projects") || !id(projectId)) return { ok: false, error: "bad-request" };
      const answer = await authed(on ? "POST" : "DELETE", `/v1/projects/${projectId}/star`);
      if (!answer.ok) return refused(answer);
      return { ok: true, project: projectCard(answer.data.project) };
    },
    async feature(projectId) {
      if (!features.includes("projects") || !id(projectId)) return { ok: false, error: "bad-request" };
      const answer = await authed("POST", `/v1/projects/${projectId}/feature`);
      if (!answer.ok) return refused(answer);
      return { ok: true, featuredUntil: Number.isFinite(answer.data.featuredUntil) ? answer.data.featuredUntil : null, balance: count(answer.data.balance, 1e12) ?? 0 };
    },
    // ---- The Shop (feature "shop", relay/src/shop.mjs) -----------------------
    // Studio's own pets, effects and packs, and members' style packs, got with
    // credits (never money). Each answers { ok, ... } or the relay's refusal
    // with needs, price, balance and hold kept (shopRefused).
    // A list: "studio", "new", "top", "owned" or "mine" (anything else is
    // "studio"); `cursor` is the `next` of the page before.
    async collectibles(action = "list", payload = {}) {
      if (!features.includes("collectibles.1")) return { ok: false, error: "unsupported" };
      const call = require("./collectibles-contract.cjs").request(action, payload);
      if (!call) return { ok: false, error: "bad-request" };
      const answer = await authed(call.method, call.path, call.body);
      if (!answer.ok) return { ...refused(answer), ...Object.fromEntries(["price", "balance", "until", "poolVersion"].filter((key) => ["number", "string"].includes(typeof answer.data?.[key])).map((key) => [key, answer.data[key]])) };
      // JSON from the authenticated relay; surfaces render only text and
      // allowlisted visuals. Cap before crossing IPC into the renderer.
      if (!object(answer.data) || JSON.stringify(answer.data).length > 1024 * 1024) return { ok: false, error: "bad-response" };
      return { ...answer.data, ok: true };
    },
    async shop(view = "studio", cursor = null) {
      if (!features.includes("shop")) return { ok: false, error: "unsupported" };
      const which = SHOP_VIEWS.includes(view) ? view : "studio";
      if (cursor != null && !SHOP_CURSOR.test(String(cursor))) return { ok: false, error: "bad-request" };
      const answer = await authed("GET", `/v1/shop?view=${which}${cursor != null ? `&cursor=${cursor}` : ""}`);
      if (!answer.ok) return shopRefused(answer);
      const data = answer.data;
      return {
        ok: true, view: which,
        items: Array.isArray(data.items) ? data.items.map(itemCard).filter(Boolean).slice(0, 100) : [],
        next: typeof data.next === "string" && SHOP_CURSOR.test(data.next) ? data.next : null,
        balance: count(data.balance, 1e12) ?? 0, canEarn: data.canEarn === true,
        hold: object(data.hold) && CREDIT_HOLDS.includes(data.hold.reason) ? { reason: data.hold.reason, until: timeOf(data.hold.until) } : null,
        // The rotation (feature "shop.drops"): the drops, and the week's Featured shelf and when it changes.
        drops: shopDrops(data.drops),
        featured: Array.isArray(data.featured) ? data.featured.filter(shopItemId).slice(0, 8) : [],
        featuredUntil: shopTime(data.featuredUntil),
      };
    },
    ...trades,
    // Everything this member owns, to put back on a new PC: { items: [{ id, kind, name, data, updatedAt }] }.
    async shopOwned() {
      if (!features.includes("shop")) return { ok: false, error: "unsupported" };
      const answer = await authed("GET", "/v1/shop/owned");
      if (!answer.ok) return shopRefused(answer);
      const owned = (item) => {
        if (!object(item) || !shopItemId(item.id) || !SHOP_ITEM_KINDS.includes(item.kind)) return null;
        const name = line(item.name, 40);
        const data = item.kind === "pack" ? packData(item.data) : null;
        return name && (item.kind !== "pack" || data) ? { id: item.id, kind: item.kind, name, data, updatedAt: timeOf(item.updatedAt) } : null;
      };
      return { ok: true, items: Array.isArray(answer.data.items) ? answer.data.items.map(owned).filter(Boolean).slice(0, 2048) : [] };
    },
    // Buying, or getting a free pack, with a tip of 0 to 100 credits for a
    // pack's maker if the member likes (Studio's own items take none). `price`
    // is the price the member was shown, so a changed one is never paid by
    // surprise. -> { ok, item, paid (the tip included), balance }. Refusals:
    // "gone", "owned", "own" (your own pack), "needs" (+ needs),
    // "price-changed" (+ price), "short" (+ balance, price, tip), "no-tip".
    async shopBuy(itemId, price, tip = 0) {
      if (!features.includes("shop")) return { ok: false, error: "unsupported" };
      const extra = tip == null ? 0 : tip;
      if (!shopItemId(itemId) || count(price, 1e6) == null || count(extra, PACK_TIP_MAX) == null) return { ok: false, error: "bad-request" };
      const answer = await authed("POST", `/v1/shop/${itemId}/buy`, { price, ...(extra ? { tip: extra } : {}) });
      if (!answer.ok) return shopRefused(answer);
      const item = itemCard(answer.data.item);
      return item ? { ok: true, item, paid: count(answer.data.paid, 1e6) ?? price + extra, balance: count(answer.data.balance, 1e12) ?? 0 } : { ok: false, error: "failed" };
    },
    // A style pack: { name, blurb?, price (0, or 10 to 250), data }. Refusals:
    // "bad-pack", "too-big", "low-contrast", "hold" (+ hold, until) for a
    // priced pack before its maker may earn, and the limits' reasons.
    async shopPublish(fields = {}) {
      if (!features.includes("shop")) return { ok: false, error: "unsupported" };
      const given = packFields(fields, { required: true });
      if (!given) return { ok: false, error: "bad-request" };
      return packAnswer(await authed("POST", "/v1/shop/packs", { name: given.name, ...(given.blurb ? { blurb: given.blurb } : {}), price: given.price, data: given.data }));
    },
    // Any of { name, blurb, price, data, listed } for one of your packs; listed
    // false takes it off the Shop, true puts it back (within the limits).
    async shopUpdate(packId, fields = {}) {
      if (!features.includes("shop")) return { ok: false, error: "unsupported" };
      const given = packFields(fields);
      if (!isPackId(packId) || !given) return { ok: false, error: "bad-request" };
      return packAnswer(await authed("PUT", `/v1/shop/packs/${packId}`, given));
    },
    // Off the Shop's lists; everyone who owns it keeps it.
    async shopUnlist(packId) {
      if (!features.includes("shop")) return { ok: false, error: "unsupported" };
      if (!isPackId(packId)) return { ok: false, error: "bad-request" };
      return packAnswer(await authed("DELETE", `/v1/shop/packs/${packId}`));
    },
    // { reason, text? }: into the moderators' reports, once per member, never your own pack.
    shopReport(packId, fields = {}) {
      if (!features.includes("shop")) return Promise.resolve({ ok: false, error: "unsupported" });
      const why = typeof fields?.reason === "string" ? fields.reason.trim() : "";
      const more = typeof fields?.text === "string" ? fields.text.trim() : "";
      if (!isPackId(packId) || !why || why.length > 500 || more.length > 300) return bad();
      return simple("POST", `/v1/shop/packs/${packId}/report`, { reason: text(why, 500), ...(more ? { text: text(more, 300) } : {}) });
    },
    // Moderators: a pack off the Shop for good (its owners lose it too), and its open reports resolved. { reason? }
    modShopRemove(packId, fields = {}) {
      if (!features.includes("shop")) return Promise.resolve({ ok: false, error: "unsupported" });
      const given = fields?.reason == null || fields.reason === "" ? null : line(fields.reason, 200);
      if (!isPackId(packId) || (given === null && fields?.reason != null && fields.reason !== "")) return bad();
      return simple("POST", `/v1/admin/shop/${packId}/remove`, given ? { reason: given } : {});
    },
    // ---- File claims in a cowork room (main.cjs "Cowork claims") -------------
    // Claim before editing, renew every minute, release when done. A conflict
    // answers { ok: false, error: "conflict", conflicts } naming who holds
    // what; a lease the hub no longer has answers { ok: false, error: "gone" }.
    async claims(roomId) {
      if (!id(roomId)) return { ok: false, error: "bad-request" };
      const answer = await authed("GET", `/v1/rooms/${roomId}/claims`);
      if (!answer.ok) return refused(answer);
      return { ok: true, leases: Array.isArray(answer.data.leases) ? answer.data.leases.map(cowork.lease).filter(Boolean) : [] };
    },
    async claim(roomId, fields = {}) {
      const paths = Array.isArray(fields.paths) ? fields.paths.map(cowork.claimPath) : null;
      if (!id(roomId) || !paths || paths.some((value) => !value) || paths.length > cowork.MAX_PATHS || !cowork.MACHINE_ID.test(String(fields.machineId ?? ""))) return { ok: false, error: "bad-request" };
      const body = { machineId: fields.machineId, paths, exclusive: fields.exclusive !== false };
      for (const [key, max] of [["runId", 64], ["title", 200], ["branch", 200]]) { const value = line(fields[key], max); if (value) body[key] = value; }
      if (Number.isInteger(fields.ttlMs)) body.ttlMs = Math.max(60_000, Math.min(3_600_000, fields.ttlMs));
      const answer = await authed("POST", `/v1/rooms/${roomId}/claims`, body);
      if (answer.ok && id(answer.data.leaseId)) return { ok: true, leaseId: answer.data.leaseId, expiresAt: Number.isFinite(answer.data.expiresAt) ? answer.data.expiresAt : null, reused: answer.data.reused === true };
      if (!answer.ok && answer.error === "conflict") {
        const conflicts = (Array.isArray(answer.data?.conflicts) ? answer.data.conflicts : []).slice(0, 20).map((item) => ({
          leaseId: id(item?.leaseId) ? item.leaseId : null, machineId: typeof item?.machineId === "string" ? item.machineId.slice(0, 64) : null,
          title: line(item?.title, 200), overlapping: Array.isArray(item?.overlapping) ? item.overlapping.map(cowork.claimPath).filter(Boolean).slice(0, 50) : [],
        }));
        return { ok: false, error: "conflict", conflicts };
      }
      return answer.ok ? { ok: false, error: "failed" } : refused(answer);
    },
    renewClaim(leaseId) { return id(leaseId) ? simple("PUT", `/v1/claims/${leaseId}`) : bad(); },
    releaseClaim(leaseId, reason = "") {
      if (!id(leaseId)) return bad();
      const why = line(reason, 200);
      return simple("DELETE", `/v1/claims/${leaseId}`, why ? { reason: why } : undefined);
    },
    // `holder` names the part of Studio asking (HOLDERS; anything else is
    // "default"). Holding a room twice is one hold.
    subscribe(roomId, holder = "default") {
      if (!opaqueId(roomId)) return false;
      const holders = rooms.get(roomId) ?? new Set();
      const first = !holders.size;
      holders.add(holderOf(holder));
      rooms.set(roomId, holders);
      if (first && state === "ready") { send({ type: "subscribe", roomId }); send({ type: "presence", roomId }); }
      return true;
    },
    unsubscribe(roomId, holder = "default") {
      const holders = rooms.get(roomId);
      if (!holders?.delete(holderOf(holder))) return false;
      if (holders.size) return true;
      rooms.delete(roomId);
      send({ type: "unsubscribe", roomId });
      return true;
    },
    // Starts or steers a room's shared player; answers { ok } or { ok: false, reason }.
    listen(roomId, fields = {}) {
      if (!opaqueId(roomId) || !LISTEN_ACTIONS.includes(fields.action)) return Promise.resolve({ ok: false, reason: "bad-request" });
      const frame = { type: "listen", roomId, action: fields.action };
      if (fields.action === "start") {
        const url = listenUrl(fields.url);
        const label = line(fields.label, 120);
        if (!url || !label || !LISTEN_PROVIDERS.includes(fields.provider)) return Promise.resolve({ ok: false, reason: "bad-link" });
        Object.assign(frame, { url, label, provider: fields.provider });
      }
      if (fields.positionMs != null) {
        const position = Math.round(Number(fields.positionMs));
        if (!Number.isFinite(position)) return Promise.resolve({ ok: false, reason: "bad-request" });
        frame.positionMs = Math.max(0, Math.min(MAX_POSITION_MS, position));
      } else if (fields.action === "seek") return Promise.resolve({ ok: false, reason: "bad-request" });
      return withAck(frame);
    },
    // A companion card for a subscribed room, or null to say it went home.
    // Only to a hub that carries companions; `to` (one member) only to a hub
    // that delivers to one member, so a card meant for one friend can never
    // reach the whole room. False when it was not sent.
    sendCompanion(roomId, card, to = null) {
      if (state !== "ready" || !features.includes("companion") || !rooms.has(roomId)) return false;
      if (card !== null && !object(card)) return false;
      if (to != null && (!SNOWFLAKE.test(String(to)) || !features.includes("companion.direct"))) return false;
      return send({ type: "companion", roomId, card, ...(to != null ? { to: String(to) } : {}) });
    },
    // ---- The Discord remote (docs/remote.md) ---------------------------------
    // This PC for the remote: { pc: { id, name }, on }, kept and re-sent after
    // each `ready`; null (or on: false) takes this PC off the remote. False
    // when the shape is wrong.
    setRemote(value) {
      if (value == null) {
        const was = remote;
        remote = null;
        if (was?.on && state === "ready" && features.includes("remote")) send({ type: "remoteHello", pc: { ...was.pc }, on: false });
        return true;
      }
      const name = object(value) && object(value.pc) ? line(value.pc.name, 40) : null;
      if (!name || !PC_ID.test(String(value.pc.id ?? "")) || typeof value.on !== "boolean") return false;
      const next = { pc: { id: value.pc.id, name }, on: value.on };
      if (JSON.stringify(next) === JSON.stringify(remote)) return true;
      remote = next;
      if (state === "ready" && features.includes("remote")) sendRemoteHello();
      return true;
    },
    // The answer to one `remote` command: false when it could not go.
    remoteReply(requestId, message, buttons = [], done = true) {
      const body = remoteText(message);
      const list = remoteButtons(buttons);
      if (!remoteReady() || !opaqueId(requestId) || !body || !list) return false;
      return send({ type: "remoteReply", requestId, text: body, ...(list.length ? { buttons: list } : {}), ...(done === false ? { done: false } : {}) });
    },
    // An alert for the member's DMs; the hub drops a repeated key for an hour.
    remoteNotice(key, kind, message, buttons = []) {
      const body = remoteText(message);
      const list = remoteButtons(buttons);
      if (!remoteReady() || !PC_ID.test(String(key ?? "")) || !REMOTE_NOTICES.includes(kind) || !body || !list) return false;
      return send({ type: "remoteNotice", key, kind, text: body, ...(list.length ? { buttons: list } : {}) });
    },
    // ---- My PCs (docs/my-pcs.md) ---------------------------------------------
    // This PC: { pc: { id, name, kind }, keys: { sign, box }, lendTo: [userId] },
    // kept and said again (pcHello) after each `ready` from a relay that
    // carries "pcs"; only a change goes out. null forgets it here and sends
    // nothing (the relay forgets a PC when its socket closes), as does
    // disconnect(). False when the shape is wrong.
    setPc(value) {
      if (value == null) { pc = null; return true; }
      const next = pcHello(value);
      if (!next) return false;
      if (JSON.stringify(next) === JSON.stringify(pc)) return true;
      pc = next;
      if (state === "ready" && features.includes("pcs")) sendPcHello();
      return true;
    },
    // This PC's status line, for the PCs that see it. False when it did not go:
    // not ready, a relay without "pcs", no setPc, or over 3 KB as JSON.
    pcState(value) {
      if (!pcReady() || !object(value) || jsonBytes(value) > PC_STATE_BYTES) return false;
      return send({ type: "pcState", state: value });
    },
    // One envelope (pc-trust.cjs) for PC `to`: { ok: true } once the relay
    // handed it over, or { ok: false, reason }: the relay's "not-online",
    // "not-allowed" or "rate-limited" (with retryAfter), "timeout" after 10 s,
    // or here "offline", "unsupported", "no-pc", "bad-request", "too-large"
    // (over 12 KB as JSON). Nothing retries on its own.
    pcSend(to, env) {
      if (state !== "ready") return Promise.resolve({ ok: false, reason: "offline" });
      if (!features.includes("pcs")) return Promise.resolve({ ok: false, reason: "unsupported" });
      if (!pc) return Promise.resolve({ ok: false, reason: "no-pc" });
      if (!pcId(to) || !object(env)) return Promise.resolve({ ok: false, reason: "bad-request" });
      if (jsonBytes(env) > PC_ENV_BYTES) return Promise.resolve({ ok: false, reason: "too-large" });
      return withAck({ type: "pcSend", to, env });
    },
    // This member's pet ({ kind, skin, name }, as renderer/pets.js has it), or
    // null for none: kept, and said again after each `ready` from a relay that
    // carries "pets", so the rooms this Studio has open show it to the members
    // there. Only a change goes out, at most one every 10 s (the latest wins).
    // False when the shape is wrong.
    setPet(value) {
      const next = value == null ? null : petLook(value);
      if (value != null && !next) return false;
      if (JSON.stringify(next) === JSON.stringify(myPet)) return true;
      myPet = next;
      sendPetSoon();
      return true;
    },
    // What this member is building ({ project, running, doneToday }), or null
    // to stop sharing. Kept and re-sent after a reconnect; only a change goes out.
    setBuilding(value) {
      const project = value == null ? null : line(value.project, 80);
      if (value != null && !project) return false;
      const next = project ? { project, running: count(value.running, 1000) ?? 0, doneToday: count(value.doneToday, 1000) ?? 0 } : null;
      if (JSON.stringify(next) === JSON.stringify(building)) return true;
      building = next;
      if (state === "ready" && features.includes("building")) send({ type: "building", now: building });
      return true;
    },
    // The track /nowplaying may show, or null to stop sharing. Kept and
    // re-sent after a reconnect; only a change goes out.
    setNowPlaying(track) {
      const next = nowPlayingTrack(track);
      if (track != null && !next) return false;
      if (JSON.stringify(next) === JSON.stringify(nowPlaying)) return true;
      nowPlaying = next;
      if (state === "ready") sendNowPlaying();
      return true;
    },
  };
}

module.exports = {
  PROTOCOL_VERSION, OLDEST_PROTOCOL, RELAY_BEHIND_RETRY_MS, HUB_URL, LISTEN_PROVIDERS, NOW_PLAYING_PROVIDERS, LISTEN_ACTIONS, HOLDERS, BACKOFF_MS, PRESENCE_EVERY_MS, SESSION_MARGIN_MS,
  hubAddress, configuredUrl, listenSession, nowPlayingTrack, roomSummary, roomMessage, joinRequest, roomInvite, postText, createHubClient,
  remoteText, remoteButtons, remoteCommand, remotePcs,
  PC_KINDS, pcKeys, pcHello, pcView, pcViews,
  KEEPALIVE_FRAME, KEEPALIVE_EVERY_MS, CLIENT_FEATURES, wireMessage, projectCard, PROJECT_KINDS,
  eventsPage, eventsFront,
  SHOP_VIEWS, SHOP_ITEM_KINDS, itemCard, packData, packFields, dropCard, shopDrops,
  PET_KINDS, PET_GENERATION, PET_SKINS, petLook, roomPetsOf, petsGenerationOf, petForRelay,
};
