// The relay's wire protocol, version 1: HTTP request bodies and WebSocket frames.
//
// Carried over from the Void Engine hub's src/protocol.mjs so Studio's
// scripts/hub-client.cjs talks to the relay unchanged. Self-contained on
// purpose (no imports, no Node-only APIs): it runs in a Cloudflare Worker and
// under Node for the tests. Any change to a frame is a protocol change: bump
// PROTOCOL_VERSION when an older client could misread the new shape, and keep
// relay/README.md in step. New frames ride on ready.features instead, so an
// older Studio never meets them.
//
// Relay additions to the hub's v1: the companion frame (feature "companion",
// "companion.direct"), relayed and never stored, and the peer history frames
// (feature "history.peer") that let a member's own Studio fill a gap in
// another member's room history, since the relay keeps none.
//
// Validators return normalised copies holding only known fields, so nothing
// extra a client sends rides along into the hub. Strings are checked, never
// trimmed or rewritten; lengths count UTF-16 code units, as Discord does.
//
//   hub side:    parseClientFrame(raw)          -> { ok, frame } | { ok:false, code, error }
//                hubFrame('ack', { nonce, messageId })   -> validated frame (throws on a bug)
//                validateBody('claim', body)    -> { ok, body } | { ok:false, error }
//   Studio side: parseHubFrame(raw), clientFrame('send', {...})

export const PROTOCOL_VERSION = 1;

export const LIMITS = Object.freeze({
  frameBytes: 16 * 1024, // client -> hub WebSocket frame
  hubFrameBytes: 512 * 1024, // hub -> client (claims and presence lists can be long)
  bodyBytes: 16 * 1024, // HTTP JSON body
  textChars: 2000,
  nonceChars: 64,
  sessionChars: 1024,
  accessTokenChars: 512,
  roomNameChars: 80,
  noteChars: 300,
  reasonChars: 500,
  searchQueryChars: 32,
  searchResults: 10,
  backfillPage: 50,
  framesPerSecond: 20,
  socketsPerUser: 3,
  helloTimeoutMs: 5_000,
  pingIntervalMs: 30_000,
  presenceHeartbeatMs: 30_000,
  presenceExpiryMs: 90_000,
  sessionTtlMs: 15 * 60_000,
  ackTimeoutMs: 10_000,
  mentionsPerMessage: 50,
  attachmentsPerMessage: 10,
  claimPaths: 50,
  claimPathChars: 200,
  claimTtlMinMs: 60_000,
  claimTtlDefaultMs: 15 * 60_000,
  claimTtlMaxMs: 60 * 60_000,
  leasesPerFrame: 200,
  listenUrlMax: 2048, // listen-together and now-playing links (https only)
  listenLabelMax: 120,
  listenTitleMax: 200, // an oEmbed title, cleaned by the hub
  listenPositionMaxMs: 86_400_000, // 24 h
  remotePcs: 8, // the Discord remote: PCs per member with the remote on
  remotePcNameChars: 40,
  remoteTextChars: 1900, // remoteReply and remoteNotice text; Discord's 2000 leaves room for the PC's name
  remoteButtons: 5, // per reply or notice
  remoteButtonIdChars: 48,
  remoteButtonLabelChars: 40,
  remoteRequestTtlMs: 5 * 60_000, // a remote frame can be answered this long
  hubFeatures: 32, // ready.features
  companionCardBytes: 8 * 1024, // a companion card as JSON
  historyMessages: 100, // messages in one historyReply
  historyReplyBytes: 15 * 1024, // a historyReply frame; under frameBytes
});

/** ready.features this relay can list (the remote needs the Discord bot, so it is listed only when one is linked). */
export const FEATURES = Object.freeze({
  companion: 'companion',
  companionDirect: 'companion.direct',
  historyPeer: 'history.peer', // historyRequest / historyReply / history
  keepalive: 'keepalive', // {"type":"ping"} every 30 s, answered by Cloudflare without waking the relay
  messagesSigned: 'messages.signed', // message.sig on every message and messageUpdate
  lobby: 'lobby', // the Lobby every signed-in member is in
  joinCodes: 'join.codes', // a short code per room; anyone with it may join
  online: 'online', // GET /v1/online: who is in Studio right now
  credits: 'credits', // GET /v1/me, member cards, the credits frame
  projects: 'projects', // the project hub: share, play, star, feature
  front: 'front', // GET /v1/front: the Lobby front page in one read
  events: 'events', // GET /v1/events: the weekly Build Jam, co-work hours and building together (relay/src/events.mjs)
  friendOnline: 'friend.online', // friendOnline: someone you share a room with just opened Studio (to clients that list it)
  building: 'building', // building: what a member is making right now, with their say-so (The Lobby's Building now)
});

/** listen{action}: a room's shared player. */
export const LISTEN_ACTIONS = Object.freeze(['start', 'play', 'pause', 'seek', 'stop']);
/** Where a listen-together link plays; the hub checks each link's host against its provider. */
export const LISTEN_PROVIDERS = Object.freeze(['youtube', 'spotify', 'soundcloud', 'vimeo', 'discord', 'file']);
/** nowPlaying{track.provider}: the listen providers plus Studio's radio and the member's own files (no link). */
export const NOW_PLAYING_PROVIDERS = Object.freeze([...LISTEN_PROVIDERS, 'radio', 'local']);

/** ready.features: what this hub carries beyond the core frames. Studio sends a feature's frames only to a hub that lists it. */
export const REMOTE_FEATURE = 'remote';
/** remote{command}: what a member asked their PC from Discord ("pcs" and "use" never reach a PC). */
export const REMOTE_COMMANDS = Object.freeze(['status', 'needs', 'made', 'digest', 'say', 'pause', 'resume', 'button']);
/** remoteNotice{kind}: why a PC alerts its member. */
export const REMOTE_NOTICE_KINDS = Object.freeze(['needs-you', 'done', 'failed', 'stuck', 'digest', 'info']);
/** A remote button's style (Discord's button styles; the default is secondary). */
export const REMOTE_BUTTON_STYLES = Object.freeze(['primary', 'secondary', 'success', 'danger']);

/** Project cards (feature "projects") and why a credits frame was sent (feature "credits"). */
export const PROJECT_KINDS = Object.freeze(['game', 'app', 'tool', 'art', 'music', 'other']);
export const CREDIT_REASONS = Object.freeze(['played', 'play', 'starred', 'feature', 'revoked', 'together', 'cowork', 'jam']);

export const ROOM_KINDS = Object.freeze(['hangout', 'cowork']);
export const ROOM_POLICIES = Object.freeze(['request', 'invite']);
export const ROOM_STATUSES = Object.freeze(['active', 'locked', 'closed']);
export const ROOM_RELATIONS = Object.freeze(['owner', 'member', 'requested', 'invited', 'none']);
export const DECISIONS = Object.freeze(['approve', 'deny']);
export const REQUEST_STATUSES = Object.freeze(['pending', 'approved', 'denied', 'cancelled']);
export const INVITE_STATUSES = Object.freeze(['pending', 'accepted', 'declined', 'revoked', 'expired']);
export const MEMBERSHIP_STATES = Object.freeze(['joined', 'left', 'removed', 'closed']);

/** WebSocket error{code}. Known codes; any lowerCamel code of this shape validates. */
export const ERROR_CODES = Object.freeze([
  'badFrame',
  'tooLarge',
  'unauthorized',
  'sessionExpired',
  'versionMismatch',
  'helloTimeout',
  'tooManySockets',
  'rateLimited',
  'notMember',
  'paused',
  'internal',
  'tooManyPcs', // the remote: a member's 9th PC
  'remoteNotOn', // the remote: a reply or notice from a socket that has not turned it on
  'unknownRequest', // the remote: not sent to this socket, older than 5 minutes, or already answered
  'tooManyReplies', // the remote: a second reply with done: false
]);

/** nack{reason}. Known reasons; any kebab-case reason of this shape validates. */
export const NACK_REASONS = Object.freeze([
  'room-busy',
  'rate-limited',
  'paused',
  'not-member',
  'read-only',
  'locked',
  'links-not-allowed',
  'not-found',
  'not-yours',
  'failed',
  'bad-link',
  'no-session',
  'bad-request',
]);

/** HTTP {ok:false, error}. */
export const HTTP_ERRORS = Object.freeze([
  'bad-request',
  'unauthorized',
  'forbidden',
  'not-member',
  'read-only',
  'not-found',
  'method-not-allowed',
  'conflict',
  'limit',
  'gone',
  'too-large',
  'unsupported-media-type',
  'rate-limited',
  'paused',
  'internal',
]);

/** WebSocket close codes the hub uses. */
export const CLOSE_CODES = Object.freeze({
  shutdown: 1001,
  tooLarge: 1009,
  badFrame: 4000,
  unauthorized: 4001,
  versionMismatch: 4002,
  helloTimeout: 4003,
  tooManySockets: 4004,
  sessionExpired: 4005,
  rateLimited: 4008,
});

// ---- A tiny schema language ---------------------------------------------------

const SNOWFLAKE = /^\d{17,20}$/;
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN = /^[\x21-\x7e]+$/; // printable ASCII, no spaces
const SINGLE_LINE = /^[^\x00-\x1f\x7f]*$/; // no control characters at all
const TEXT = /^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/; // tabs and line breaks allowed
const CODE = /^[a-z][A-Za-z0-9-]{1,39}$/;
const HEX_SHA = /^[0-9a-fA-F]{7,64}$/;
const MACHINE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const HTTPS_URL = /^https:\/\/[^\s\x00-\x1f\x7f]+$/; // the shape only; the hub checks hosts and credentials
const BUTTON_ID = /^[A-Za-z0-9_.:-]{1,48}$/;
const PIN = /^\d{4,12}$/;
const FEATURE = /^[a-z][a-z0-9.-]{0,39}$/;

const string = (min, max, extra = {}) => ({ kind: 'string', min, max, ...extra });
const integer = (min, max) => ({ kind: 'integer', min, max });
const boolean = () => ({ kind: 'boolean' });
const oneOf = (values) => ({ kind: 'enum', values });
const list = (item, max) => ({ kind: 'array', item, max });
const object = (fields) => ({ kind: 'object', fields });
const optional = (schema) => ({ ...schema, optional: true });
const nullable = (schema) => ({ ...schema, nullable: true });
// A plain JSON object passed through as it is (a companion card), at most maxBytes as JSON.
const opaqueObject = (maxBytes) => ({ kind: 'opaque', maxBytes });

const snowflake = () => string(17, 20, { pattern: SNOWFLAKE });
const opaqueId = () => string(1, 64, { pattern: OPAQUE_ID });
const timestamp = () => integer(0, Number.MAX_SAFE_INTEGER);
const nonce = () => string(1, LIMITS.nonceChars, { pattern: OPAQUE_ID });
const session = () => string(1, LIMITS.sessionChars, { pattern: TOKEN });
const sendText = () => string(1, LIMITS.textChars, { pattern: TEXT, nonBlank: true });
const roomName = () => string(1, LIMITS.roomNameChars, { pattern: SINGLE_LINE, nonBlank: true });
const line = (min, max) => string(min, max, { pattern: SINGLE_LINE });
const httpsUrl = () => string(1, LIMITS.listenUrlMax, { pattern: HTTPS_URL });
const machineId = () => string(1, 64, { pattern: MACHINE_ID });
const remoteText = () => string(1, LIMITS.remoteTextChars, { pattern: TEXT, nonBlank: true });
const buttonId = () => string(1, LIMITS.remoteButtonIdChars, { pattern: BUTTON_ID });

const pass = (value) => ({ ok: true, value });
const fail = (path, message) => ({ ok: false, error: `${path} ${message}` });
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function check(schema, value, path) {
  if (value === undefined) return schema.optional ? pass(undefined) : fail(path, 'is required');
  if (value === null) return schema.nullable ? pass(null) : fail(path, 'must not be null');
  switch (schema.kind) {
    case 'string':
      if (typeof value !== 'string') return fail(path, 'must be a string');
      if (value.length < schema.min) return fail(path, schema.min === 1 ? 'must not be empty' : `must be at least ${schema.min} characters`);
      if (value.length > schema.max) return fail(path, `must be at most ${schema.max} characters`);
      if (schema.pattern && !schema.pattern.test(value)) return fail(path, 'has an invalid format');
      if (schema.nonBlank && !/\S/.test(value)) return fail(path, 'must not be blank');
      return pass(value);
    case 'integer':
      if (!Number.isSafeInteger(value)) return fail(path, 'must be a whole number');
      if (value < schema.min || value > schema.max) return fail(path, `must be from ${schema.min} to ${schema.max}`);
      return pass(value);
    case 'boolean':
      return typeof value === 'boolean' ? pass(value) : fail(path, 'must be true or false');
    case 'enum':
      return schema.values.includes(value) ? pass(value) : fail(path, `must be one of ${schema.values.join(', ')}`);
    case 'array': {
      if (!Array.isArray(value)) return fail(path, 'must be an array');
      if (value.length > schema.max) return fail(path, `must hold at most ${schema.max} items`);
      const out = [];
      for (let index = 0; index < value.length; index += 1) {
        const result = check(schema.item, value[index], `${path}[${index}]`);
        if (!result.ok) return result;
        out.push(result.value);
      }
      return pass(out);
    }
    case 'object': {
      if (!isPlainObject(value)) return fail(path, 'must be an object');
      const out = {};
      for (const [name, fieldSchema] of Object.entries(schema.fields)) {
        const result = check(fieldSchema, value[name], `${path}.${name}`);
        if (!result.ok) return result;
        if (result.value !== undefined) out[name] = result.value;
      }
      return pass(out);
    }
    case 'opaque': {
      if (!isPlainObject(value)) return fail(path, 'must be an object');
      let json;
      try {
        json = JSON.stringify(value);
      } catch {
        return fail(path, 'must be plain JSON');
      }
      if (new TextEncoder().encode(json).length > schema.maxBytes) return fail(path, `must be at most ${schema.maxBytes} bytes`);
      return pass(JSON.parse(json));
    }
    default:
      throw new TypeError(`unknown schema kind ${schema.kind}`);
  }
}

// ---- Shared shapes --------------------------------------------------------------

const user = () => object({ id: snowflake(), name: line(1, 100) });

const roomMessage = () =>
  object({
    id: snowflake(),
    author: object({ id: snowflake(), name: line(0, 100), viaStudio: boolean() }),
    text: string(0, LIMITS.textChars), // longer Discord messages are cut and flagged
    truncated: optional(boolean()),
    createdAt: timestamp(),
    editedAt: nullable(timestamp()),
    mentions: object({
      // Display names so Studio can render <@id> as @name; '' when unknown.
      users: list(object({ id: snowflake(), name: line(0, 100) }), LIMITS.mentionsPerMessage),
      roles: list(snowflake(), LIMITS.mentionsPerMessage),
      everyone: boolean(),
    }),
    attachments: list(object({ name: line(1, 256), size: integer(0, Number.MAX_SAFE_INTEGER) }), LIMITS.attachmentsPerMessage),
    replyTo: optional(nullable(snowflake())),
    // The relay's HMAC over the room, id, author, text and editedAt
    // (relay/src/chat.mjs). The relay stores no messages; a member's Studio
    // keeps its copy with the sig, and the relay checks it when that copy
    // fills a gap for someone else or backs a report.
    sig: optional(string(1, 64, { pattern: OPAQUE_ID })),
  });

const roomSummary = () =>
  object({
    id: opaqueId(),
    kind: oneOf(ROOM_KINDS),
    name: roomName(),
    policy: oneOf(ROOM_POLICIES),
    listed: boolean(),
    status: oneOf(ROOM_STATUSES),
    ownerId: nullable(snowflake()),
    memberCount: integer(0, 1000),
    maxMembers: integer(1, 1000),
    threadId: nullable(snowflake()),
    createdAt: timestamp(),
    you: optional(oneOf(ROOM_RELATIONS)),
  });

const joinRequest = () =>
  object({
    id: opaqueId(),
    roomId: opaqueId(),
    requester: user(),
    note: string(0, LIMITS.noteChars, { pattern: TEXT }),
    status: oneOf(REQUEST_STATUSES),
    createdAt: timestamp(),
    decidedAt: optional(nullable(timestamp())),
  });

const invite = () =>
  object({
    id: opaqueId(),
    roomId: opaqueId(),
    roomName: roomName(),
    invitedBy: user(),
    status: oneOf(INVITE_STATUSES),
    expiresAt: timestamp(),
  });

const lease = () =>
  object({
    leaseId: opaqueId(),
    memberId: snowflake(),
    machineId: string(1, 64, { pattern: MACHINE_ID }),
    runId: nullable(line(1, 64)),
    taskKey: nullable(line(1, 128)),
    scopeHash: nullable(line(1, 128)),
    paths: list(line(1, LIMITS.claimPathChars), LIMITS.claimPaths),
    exclusive: boolean(),
    branch: nullable(line(1, 200)),
    baseSha: nullable(string(7, 64, { pattern: HEX_SHA })),
    title: nullable(line(0, 200)),
    fence: integer(1, Number.MAX_SAFE_INTEGER),
    at: timestamp(),
    expiresAt: timestamp(),
  });

// A room's shared player. positionMs was the position at updatedAt (hub clock);
// while playing, the position now is positionMs + (now - updatedAt).
const listenSession = () =>
  object({
    id: opaqueId(),
    url: httpsUrl(),
    label: line(1, LIMITS.listenLabelMax),
    title: optional(nullable(line(1, LIMITS.listenTitleMax))),
    provider: oneOf(LISTEN_PROVIDERS),
    host: user(),
    playing: boolean(),
    positionMs: integer(0, LIMITS.listenPositionMaxMs),
    startedAt: timestamp(),
    updatedAt: timestamp(),
  });

// The Discord remote: a PC as its member's Studio names it (id = Studio's
// machine id, "pc-<uuid>"), and the buttons Studio puts under a reply or an
// alert. The hub gives Discord its own opaque ids, never these.
const remotePc = () => object({ id: machineId(), name: string(1, LIMITS.remotePcNameChars, { pattern: SINGLE_LINE, nonBlank: true }) });

const remoteButton = () =>
  object({
    id: buttonId(),
    label: string(1, LIMITS.remoteButtonLabelChars, { pattern: SINGLE_LINE, nonBlank: true }),
    style: optional(oneOf(REMOTE_BUTTON_STYLES)),
    pin: optional(boolean()), // true: Discord asks for the member's Studio PIN first
  });

// ---- WebSocket frames ------------------------------------------------------------

/** Client -> hub. Every frame is {type, ...fields}. */
export const CLIENT_FRAMES = Object.freeze({
  // features: what this Studio can do beyond the core frames (for example "history.peer", "keepalive").
  hello: { session: session(), protocol: integer(1, 1000), features: optional(list(string(1, 40, { pattern: FEATURE }), LIMITS.hubFeatures)) },
  renew: { session: session() },
  subscribe: { roomId: opaqueId() },
  unsubscribe: { roomId: opaqueId() },
  send: { roomId: opaqueId(), text: sendText(), nonce: nonce() },
  edit: { roomId: opaqueId(), messageId: snowflake(), text: sendText(), nonce: optional(nonce()) },
  delete: { roomId: opaqueId(), messageId: snowflake(), nonce: optional(nonce()) },
  presence: { roomId: opaqueId() },
  ping: {},
  listen: {
    roomId: opaqueId(),
    action: oneOf(LISTEN_ACTIONS),
    url: optional(httpsUrl()),
    label: optional(line(1, LIMITS.listenLabelMax)),
    provider: optional(oneOf(LISTEN_PROVIDERS)),
    positionMs: optional(integer(0, LIMITS.listenPositionMaxMs)),
    nonce: optional(nonce()),
  },
  nowPlaying: {
    track: nullable(object({ label: line(1, LIMITS.listenLabelMax), provider: oneOf(NOW_PLAYING_PROVIDERS), url: optional(httpsUrl()) })),
  },
  // What this member is building (feature "building"): the open project's name and counts only, or null to stop.
  building: {
    now: nullable(object({ project: line(1, 80), running: integer(0, 1000), doneToday: integer(0, 1000) })),
  },
  // The Discord remote (feature "remote"): turn this socket's PC on or off, answer a remote frame, alert the member.
  remoteHello: { pc: remotePc(), on: boolean() },
  remoteReply: { requestId: opaqueId(), text: remoteText(), buttons: optional(list(remoteButton(), LIMITS.remoteButtons)), done: optional(boolean()) },
  remoteNotice: { key: machineId(), kind: oneOf(REMOTE_NOTICE_KINDS), text: remoteText(), buttons: optional(list(remoteButton(), LIMITS.remoteButtons)) },
  // Companions (features "companion", "companion.direct"): a card for the room, or for one member with `to`.
  companion: { roomId: opaqueId(), card: nullable(opaqueObject(LIMITS.companionCardBytes)), to: optional(snowflake()) },
  // Peer history (feature "history.peer"): ask the room for older messages, and answer a historyRequest the relay forwarded.
  historyRequest: { roomId: opaqueId(), before: optional(snowflake()), nonce: optional(nonce()) },
  historyReply: { requestId: opaqueId(), messages: list(roomMessage(), LIMITS.historyMessages), hasMore: boolean() },
});

/** Hub -> client. */
export const HUB_FRAMES = Object.freeze({
  ready: {
    user: user(),
    protocol: integer(1, 1000),
    paused: optional(boolean()),
    readOnly: optional(boolean()),
    features: optional(list(string(1, 40, { pattern: FEATURE }), LIMITS.hubFeatures)),
  },
  message: { roomId: opaqueId(), message: roomMessage() },
  messageUpdate: { roomId: opaqueId(), message: roomMessage() },
  messageDelete: { roomId: opaqueId(), messageId: snowflake() },
  presence: { roomId: opaqueId(), inStudio: list(snowflake(), 1000) },
  joinRequest: { request: joinRequest() },
  invite: { invite: invite() },
  membership: { roomId: opaqueId(), userId: snowflake(), state: oneOf(MEMBERSHIP_STATES) },
  room: { room: roomSummary() },
  claims: { roomId: opaqueId(), leases: list(lease(), LIMITS.leasesPerFrame) },
  listen: { roomId: opaqueId(), session: nullable(listenSession()), sentAt: timestamp() },
  ack:{ nonce: nonce(), messageId: optional(snowflake()) },
  nack: { nonce: nonce(), reason: string(1, 40, { pattern: CODE }), retryAfter: optional(integer(0, 86_400_000)) },
  hubState: { paused: boolean() },
  error: { code: string(1, 40, { pattern: CODE }), message: optional(line(0, 200)) },
  pong: {},
  // The Discord remote: a member's command for this PC (text with say; buttonId, and pin when the button asked
  // for it, with button), and the member's PCs that have the remote on.
  remote: {
    requestId: opaqueId(),
    from: snowflake(),
    command: oneOf(REMOTE_COMMANDS),
    text: optional(sendText()),
    buttonId: optional(buttonId()),
    pin: optional(string(4, 12, { pattern: PIN })),
    sentAt: timestamp(),
  },
  remoteState: { pcs: list(object({ id: machineId(), name: string(1, LIMITS.remotePcNameChars, { pattern: SINGLE_LINE }), since: timestamp() }), LIMITS.remotePcs) },
  companion: { roomId: opaqueId(), from: snowflake(), card: nullable(opaqueObject(LIMITS.companionCardBytes)), to: optional(snowflake()) },
  // To one member's Studio: send what you hold of this room before `before` as a historyReply.
  historyRequest: { roomId: opaqueId(), requestId: opaqueId(), before: optional(snowflake()) },
  // To the asker: the messages a peer held, each with a checked sig, newest last.
  history: { roomId: opaqueId(), messages: list(roomMessage(), LIMITS.historyMessages), hasMore: boolean() },
  // To the people a member shares a room with, when that member opens Studio (feature "friend.online").
  friendOnline: { user: user() },
  // To the member who earned or spent credits (feature "credits"): the new totals and why.
  credits: {
    balance: integer(0, Number.MAX_SAFE_INTEGER),
    lifetime: integer(0, Number.MAX_SAFE_INTEGER),
    today: integer(0, 1000),
    delta: integer(-1_000_000, 1_000_000),
    reason: oneOf(CREDIT_REASONS),
    rank: string(1, 20, { pattern: /^[a-z]+$/ }),
  },
});

function validateFrame(table, frame) {
  if (!isPlainObject(frame)) return { ok: false, error: 'frame must be a JSON object' };
  const { type } = frame;
  if (typeof type !== 'string' || !Object.hasOwn(table, type)) {
    return { ok: false, error: `unknown frame type "${String(type).slice(0, 32)}"` };
  }
  const result = check(object(table[type]), frame, type);
  return result.ok ? { ok: true, frame: { type, ...result.value } } : { ok: false, error: result.error };
}

export function validateClientFrame(frame) {
  const result = validateFrame(CLIENT_FRAMES, frame);
  return result.ok ? result : { ...result, code: 'badFrame' };
}

export function validateHubFrame(frame) {
  const result = validateFrame(HUB_FRAMES, frame);
  return result.ok ? result : { ...result, code: 'badFrame' };
}

function byteLength(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data).length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + byteLength(part), 0);
  return Infinity;
}

function toText(data) {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.map(toText).join('');
  return new TextDecoder().decode(data);
}

function parseFrame(data, maxBytes, validate) {
  // A string has at most as many characters as UTF-8 bytes, so an over-long
  // string is refused before it is encoded.
  const tooLong = typeof data === 'string' ? data.length > maxBytes || byteLength(data) > maxBytes : byteLength(data) > maxBytes;
  if (tooLong) return { ok: false, code: 'tooLarge', error: `frame is larger than ${maxBytes} bytes` };
  let frame;
  try {
    frame = JSON.parse(toText(data));
  } catch {
    return { ok: false, code: 'badFrame', error: 'frame is not valid JSON' };
  }
  return validate(frame);
}

/** Raw WebSocket data (string, Buffer, ArrayBuffer or fragments) -> validated client frame. */
export function parseClientFrame(data) {
  return parseFrame(data, LIMITS.frameBytes, validateClientFrame);
}

/** For Studio: raw data -> validated hub frame. */
export function parseHubFrame(data) {
  return parseFrame(data, LIMITS.hubFrameBytes, validateHubFrame);
}

function build(table, side, type, fields) {
  const result = validateFrame(table, { ...fields, type });
  if (!result.ok) throw new TypeError(`invalid ${side} frame: ${result.error}`);
  return result.frame;
}

/** Build a hub -> client frame; throws TypeError when the fields are wrong (a hub bug). */
export function hubFrame(type, fields = {}) {
  return build(HUB_FRAMES, 'hub', type, fields);
}

/** Build a client -> hub frame (Studio side and tests). */
export function clientFrame(type, fields = {}) {
  return build(CLIENT_FRAMES, 'client', type, fields);
}

export function encodeHubFrame(type, fields = {}) {
  return JSON.stringify(hubFrame(type, fields));
}

export function checkVersion(protocol) {
  return protocol === PROTOCOL_VERSION;
}

// ---- HTTP -------------------------------------------------------------------------

/** JSON request bodies, by name. Domain rules (claim path grammar, room caps) live in the services. */
export const HTTP_BODIES = Object.freeze({
  // POST /v1/session
  session: { accessToken: string(1, LIMITS.accessTokenChars, { pattern: TOKEN }) },
  // POST /v1/rooms
  createRoom: { kind: oneOf(ROOM_KINDS), name: roomName(), policy: oneOf(ROOM_POLICIES), listed: boolean() },
  // POST /v1/rooms/:id/requests
  joinRequest: { note: optional(string(0, LIMITS.noteChars, { pattern: TEXT })) },
  // POST /v1/requests/:id/decide
  decide: { decision: oneOf(DECISIONS) },
  // POST /v1/rooms/:id/invites
  invite: { userId: snowflake() },
  // POST /v1/reports
  // message: the reporter's own copy with its sig, kept as evidence only when the sig checks out.
  report: { messageId: snowflake(), roomId: opaqueId(), reason: string(1, LIMITS.reasonChars, { pattern: TEXT, nonBlank: true }), message: optional(roomMessage()) },
  // POST /v1/projects/:id/report
  reportProject: { reason: string(1, LIMITS.reasonChars, { pattern: TEXT, nonBlank: true }) },
  // POST /v1/rooms/:id/claims
  claim: {
    machineId: string(1, 64, { pattern: MACHINE_ID }),
    runId: optional(line(1, 64)),
    taskKey: optional(line(1, 128)),
    scopeHash: optional(line(1, 128)),
    paths: list(line(1, LIMITS.claimPathChars), LIMITS.claimPaths),
    exclusive: boolean(),
    branch: optional(line(0, 200)),
    baseSha: optional(string(0, 64, { pattern: /^(?:[0-9a-fA-F]{7,64})?$/ })),
    title: optional(line(0, 200)),
    ttlMs: optional(integer(LIMITS.claimTtlMinMs, LIMITS.claimTtlMaxMs)),
  },
  // DELETE /v1/claims/:leaseId
  release: { reason: optional(line(0, 200)) },
  // POST /v1/projects (feature "projects"): a project card, a link and words only.
  shareProject: { url: string(1, 512, { pattern: HTTPS_URL }), title: string(1, 100, { pattern: SINGLE_LINE, nonBlank: true }), blurb: optional(line(0, 300)), kind: optional(oneOf(PROJECT_KINDS)) },
  // PUT /v1/projects/:id
  editProject: { title: optional(string(1, 100, { pattern: SINGLE_LINE, nonBlank: true })), blurb: optional(line(0, 300)), kind: optional(oneOf(PROJECT_KINDS)) },
  // POST /v1/join: a room's join code as a person typed it ("7K3Q-M2XR", spaces and dashes allowed).
  joinCode: { code: string(4, 24, { pattern: /^[A-Za-z0-9 -]+$/ }) },
  // POST /v1/me/online: whether this member shows in Who's online and the Lobby's list.
  onlineVisible: { visible: boolean() },
  // POST /v1/projects/:id/played: the token from POST /v1/projects/:id/play, at least two minutes old.
  playFinish: { token: string(1, 64, { pattern: /^[a-z0-9]{1,12}\.[A-Za-z0-9_-]{22}$/ }) },
  // POST /v1/events/:id/entry (feature "events"): one of your own shared projects into the week's Build Jam.
  enterEvent: { projectId: opaqueId() },
  // POST /v1/events/:id/votes: a vote for an entrant, by their member id.
  voteEvent: { userId: snowflake() },
});

/** Query strings, by name. */
export const HTTP_QUERIES = Object.freeze({
  // GET /v1/rooms/:id/messages?before=
  messages: { before: optional(snowflake()) },
  // GET /v1/members/search?q=
  membersSearch: { q: string(1, LIMITS.searchQueryChars, { pattern: SINGLE_LINE, nonBlank: true }) },
});

/** validateBody(name, body) -> { ok: true, body } | { ok: false, error }. A missing body counts as {}. */
export function validateBody(name, body) {
  if (!Object.hasOwn(HTTP_BODIES, name)) throw new TypeError(`unknown body "${name}"`);
  const result = check(object(HTTP_BODIES[name]), body ?? {}, name);
  return result.ok ? { ok: true, body: result.value } : { ok: false, error: result.error };
}

/** validateQuery(name, URLSearchParams | object) -> { ok: true, query } | { ok: false, error }. */
export function validateQuery(name, params) {
  if (!Object.hasOwn(HTTP_QUERIES, name)) throw new TypeError(`unknown query "${name}"`);
  const raw = {};
  for (const key of Object.keys(HTTP_QUERIES[name])) {
    const value = typeof params?.get === 'function' ? params.get(key) : params?.[key];
    if (value !== null && value !== undefined) raw[key] = String(value);
  }
  const result = check(object(HTTP_QUERIES[name]), raw, name);
  return result.ok ? { ok: true, query: result.value } : { ok: false, error: result.error };
}

export const isSnowflake = (value) => typeof value === 'string' && SNOWFLAKE.test(value);
export const isOpaqueId = (value) => typeof value === 'string' && OPAQUE_ID.test(value);
