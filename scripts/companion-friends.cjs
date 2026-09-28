// Mefi's Studio AI+ — companions meeting friends' companions.
//
// Like the toys that linked up and played together, two companions in the
// same room can meet and play. What one tells the other is a small card with
// a fixed shape, built from named fields, never free text from a model, a
// chat or the owner's files. What goes on the card is the owner's choice, and
// nothing about them or their work leaves until they allow it: for everyone,
// per room or per friend, for this session or always.
//
// Levels, each adding to the one before:
//   none    Stay home: no card at all.
//   play    Look, mood, games and emotes. Nothing about the owner or their
//           work. The default.
//   hello   Its name and personality.
//   status  Working, resting or waiting on its person; how many tasks run
//           now and how many finished today. No titles.
//   work    The project's name and up to three running and three finished
//           task titles, with anything that looks like a secret removed.
// Never, at any level: keys, tokens, passwords, file contents or paths, links,
// chat messages, decisions, questions or settings. `NEVER_SHARED` says so in
// the owner's words, and `scrub` enforces it for the text fields there are.
//
// A friend's card is data: validated, clipped and shown as text, never sent
// to a model and never obeyed. Playdates are scripted from the two cards
// alone (the one sent and the one received), so the scene the owner watches
// reveals nothing the friend could not see.
//
// Pure module: no Electron, no filesystem, no network, no clock reads (time
// is injected).

"use strict";

const LEVELS = Object.freeze(["none", "play", "hello", "status", "work"]);
const DEFAULT_LEVEL = "play";
const LEVEL_INFO = Object.freeze({
  none: Object.freeze({ label: "Stay home", says: "Your companion does not join playdates. Friends see nothing." }),
  play: Object.freeze({ label: "Play only", says: "Its look, its mood, games and emotes. Nothing about you or your work." }),
  hello: Object.freeze({ label: "Say hi", says: "Also its name and personality." }),
  status: Object.freeze({ label: "Status", says: "Also whether you are working or resting, and how many tasks run now and finished today. No titles." }),
  work: Object.freeze({ label: "Work titles", says: "Also the project's name and a few running and finished task titles, with anything that looks like a secret removed." }),
});
const NEVER_SHARED = Object.freeze([
  "API keys, tokens and passwords",
  "File contents, file paths and links",
  "Your chat with your companion",
  "Questions, decisions and approvals",
  "Settings and connected accounts",
]);
const LOOKS = Object.freeze(["wisp", "fox", "owl", "cat", "person"]);
const MOODS = Object.freeze(["idle", "happy", "thinking", "curious", "sleepy"]);
const PERSONALITIES = Object.freeze(["focused", "balanced", "playful"]);
const STATES = Object.freeze(["working", "resting", "waiting"]);
const SCOPES = Object.freeze(["everyone", "room", "friend"]);
const DURATIONS = Object.freeze(["session", "always"]);
const HOLDS = Object.freeze(["none", "play"]);
const LIMITS = Object.freeze({ name: 24, project: 40, title: 60, titles: 3, label: 60, rules: 100, running: 99, done: 999 });
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SNOWFLAKE = /^\d{17,20}$/;

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const asArray = (value) => (Array.isArray(value) ? value : []);
const num = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : 0);
const int = (value, max) => Math.max(0, Math.min(max, Math.floor(num(value))));
// Control, bidi and zero-width characters, built from code points so the
// source holds no invisible characters itself.
const INVISIBLE = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069]].map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`).join("")}]`, "g");
const oneLine = (value) => String(value ?? "").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
const clip = (value, max) => {
  const text = oneLine(value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

// ---- levels ----------------------------------------------------------------------

const rank = (level) => LEVELS.indexOf(level);
const validLevel = (level) => LEVELS.includes(level);
/** The lower of two levels: sharing only ever narrows through this. */
const lower = (a, b) => (rank(a) <= rank(b) ? a : b);
const atLeast = (level, floor) => rank(level) >= rank(floor);

// ---- the owner's rules -----------------------------------------------------------

/**
 * One sharing rule: `scope` everyone/room/friend, the room or friend id it
 * names, the level, and a label the owner recognises (a room's name or the
 * friend's companion name, clipped). Invalid rules are dropped.
 */
function normalizeRule(raw, duration = "always", now = 0) {
  if (!isObject(raw) || !SCOPES.includes(raw.scope) || !validLevel(raw.level)) return null;
  const target = raw.scope === "everyone" ? null : String(raw.target ?? "");
  if (raw.scope === "room" && !OPAQUE_ID.test(target)) return null;
  if (raw.scope === "friend" && !SNOWFLAKE.test(target)) return null;
  const label = raw.scope === "everyone" ? "Everyone" : clip(raw.label, LIMITS.label) || (raw.scope === "room" ? "A room" : "A friend");
  return { scope: raw.scope, target, level: raw.level, label, duration: DURATIONS.includes(duration) ? duration : "always", at: num(raw.at) || num(now) };
}

const sameTarget = (a, b) => a.scope === b.scope && (a.target ?? null) === (b.target ?? null);

/** Saved sharing settings: the level for everyone and the saved rules. */
function normalizeSharing(raw) {
  const value = isObject(raw) ? raw : {};
  const rules = [];
  for (const row of asArray(value.rules)) {
    const rule = normalizeRule(row, "always");
    if (!rule || rule.scope === "everyone") continue;
    const at = rules.findIndex((other) => sameTarget(other, rule));
    if (at >= 0) rules.splice(at, 1);
    rules.push(rule);
  }
  return { everyone: validLevel(value.everyone) ? value.everyone : DEFAULT_LEVEL, rules: rules.slice(-LIMITS.rules) };
}

/** This session's rules and hold, kept in memory by the host only. */
function normalizeSession(raw) {
  const value = isObject(raw) ? raw : {};
  const rules = [];
  for (const row of asArray(value.rules)) {
    const rule = normalizeRule(row, "session");
    if (!rule) continue;
    const at = rules.findIndex((other) => sameTarget(other, rule));
    if (at >= 0) rules.splice(at, 1);
    rules.push(rule);
  }
  return { rules: rules.slice(-LIMITS.rules), hold: HOLDS.includes(value.hold) ? value.hold : null, dismissed: asArray(value.dismissed).map(String).filter((id) => SNOWFLAKE.test(id)).slice(-LIMITS.rules) };
}

/**
 * Adds or replaces one rule (same scope and target) in the saved settings or
 * this session's, or removes it when `level` is null. Returns both, changed.
 */
function setRule({ sharing, session, rule, duration = "always", now = 0 }) {
  const saved = normalizeSharing(sharing);
  const live = normalizeSession(session);
  const removing = isObject(rule) && rule.level == null;
  const next = removing ? normalizeRule({ ...rule, level: "play" }, duration, now) : normalizeRule(rule, duration, now);
  if (!next) return { ok: false, error: "That sharing rule is not valid.", sharing: saved, session: live };
  if (next.scope === "everyone" && duration === "always") {
    return { ok: true, sharing: removing ? saved : { ...saved, everyone: next.level }, session: live };
  }
  const list = duration === "session" ? live.rules : saved.rules;
  const kept = list.filter((other) => !sameTarget(other, next));
  const rules = removing ? kept : [...kept, next].slice(-LIMITS.rules);
  return { ok: true, sharing: duration === "session" ? saved : { ...saved, rules }, session: duration === "session" ? { ...live, rules } : live };
}

/**
 * The level the owner allows towards one friend in one room, and why. The
 * most specific rule wins (a friend, then a room, then everyone); at the same
 * specificity this session's rule wins over a saved one. A session hold
 * ("just play" or "stay home for now") caps the answer.
 */
function resolve({ sharing, session, roomId = null, userId = null }) {
  const saved = normalizeSharing(sharing);
  const live = normalizeSession(session);
  const find = (scope, target) => live.rules.find((rule) => rule.scope === scope && rule.target === target)
    ?? saved.rules.find((rule) => rule.scope === scope && rule.target === target);
  const everyoneNow = live.rules.find((rule) => rule.scope === "everyone");
  const rule = (userId && find("friend", String(userId))) || (roomId && find("room", String(roomId))) || everyoneNow || null;
  let level = rule ? rule.level : saved.everyone;
  let why = rule ? `${rule.scope === "friend" ? "Rule for this friend" : rule.scope === "room" ? "Rule for this room" : "Everyone"}${rule.duration === "session" ? " (this session)" : ""}` : "Everyone";
  if (live.hold && rank(live.hold) < rank(level)) { level = live.hold; why = live.hold === "none" ? "Staying home this session" : "Just playing this session"; }
  return { level, why };
}

/**
 * The level for a card broadcast to everyone in a room: the room's level,
 * lowered by every friend rule that is lower still, since any of those
 * friends may be in the room. Nobody ever hears more than their own level;
 * friends allowed more get their own card when the hub delivers to one member.
 */
function broadcastLevel({ sharing, session, roomId }) {
  const base = resolve({ sharing, session, roomId }).level;
  const saved = normalizeSharing(sharing);
  const live = normalizeSession(session);
  let level = base;
  const friends = new Set([...saved.rules, ...live.rules].filter((rule) => rule.scope === "friend").map((rule) => rule.target));
  for (const userId of friends) level = lower(level, resolve({ sharing, session, roomId, userId }).level);
  return level;
}

// ---- scrubbing -------------------------------------------------------------------

// What must never ride a card even inside a task title. Each match is cut;
// a title that loses too much to cutting is dropped instead of shown in pieces.
const SECRET_PATTERNS = Object.freeze([
  /\b(?:password|passwd|pwd|secret|token|api[-_ ]?key|apikey|access[-_ ]?key|private[-_ ]?key|client[-_ ]?secret|auth|bearer|cookie|session)\b\s*[:=]\s*\S+/gi,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,
  /\bwww\.\S+/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g,
  /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abprs]|AKIA|ASIA|AIza|hf|npm|sq0csp|shpat|sk_live|pk_live|rk_live)[-_][A-Za-z0-9_-]{6,}/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  /\b[0-9a-f]{20,}\b/gi,
  /(?=[A-Za-z0-9_+/=-]*\d)(?=[A-Za-z0-9_+/=-]*[A-Za-z])\b[A-Za-z0-9_+/=-]{24,}/g,
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g,
  /(?:^|\s)(?:[A-Za-z]:[\\/]|\\\\)[^\s]*/g,
  /(?:^|\s)(?:~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]*)+/g,
  /\b[\w.@-]+(?:[\\/][\w.@-]+)+\.\w{1,8}\b/g,
  /\b[\w.-]+\.(?:env|pem|key|p12|pfx|kdbx|sqlite|db)\b/gi,
]);

/**
 * A title or name with anything secret-looking cut out, or "" when too much
 * of it was: shown whole or not at all.
 */
function scrub(value, max = LIMITS.title) {
  const text = oneLine(value);
  if (!text) return "";
  let kept = text;
  for (const pattern of SECRET_PATTERNS) kept = kept.replace(pattern, (match) => (/^\s/.test(match) ? " " : ""));
  kept = kept.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  if (!kept || kept.length < text.length * 0.6 || !/[A-Za-z]{2}/.test(kept)) return "";
  return clip(kept, max);
}

// ---- cards -----------------------------------------------------------------------

/**
 * The card this owner's companion shows at `level`, from Studio's own facts:
 * { look, mood, name, personality, state, running, doneToday, project,
 * runningTitles, doneTitles }. Only the fields the level allows are read.
 */
function cardFor(level, facts = {}) {
  if (!validLevel(level) || level === "none") return null;
  const card = { v: 1, level, look: LOOKS.includes(facts.look) ? facts.look : "wisp", mood: MOODS.includes(facts.mood) ? facts.mood : "idle" };
  if (atLeast(level, "hello")) {
    const name = scrub(facts.name, LIMITS.name);
    if (name) card.name = name;
    card.personality = PERSONALITIES.includes(facts.personality) ? facts.personality : "balanced";
  }
  if (atLeast(level, "status")) {
    card.status = { state: STATES.includes(facts.state) ? facts.state : "resting", running: int(facts.running, LIMITS.running), doneToday: int(facts.doneToday, LIMITS.done) };
  }
  if (atLeast(level, "work")) {
    const titles = (list) => [...new Set(asArray(list).map((title) => scrub(title)).filter(Boolean))].slice(0, LIMITS.titles);
    const project = scrub(facts.project, LIMITS.project);
    card.work = { ...(project ? { project } : {}), running: titles(facts.runningTitles), done: titles(facts.doneTitles) };
  }
  return card;
}

/**
 * A friend's card as received, or null. Only the known fields survive, each
 * clipped, and only those the card's own level allows.
 */
function readCard(raw) {
  if (!isObject(raw) || raw.v !== 1 || !validLevel(raw.level) || raw.level === "none") return null;
  const card = { v: 1, level: raw.level, look: LOOKS.includes(raw.look) ? raw.look : "wisp", mood: MOODS.includes(raw.mood) ? raw.mood : "idle" };
  if (atLeast(card.level, "hello")) {
    const name = clip(raw.name, LIMITS.name);
    if (name) card.name = name;
    card.personality = PERSONALITIES.includes(raw.personality) ? raw.personality : "balanced";
  }
  if (atLeast(card.level, "status") && isObject(raw.status)) {
    card.status = { state: STATES.includes(raw.status.state) ? raw.status.state : "resting", running: int(raw.status.running, LIMITS.running), doneToday: int(raw.status.doneToday, LIMITS.done) };
  }
  if (atLeast(card.level, "work") && isObject(raw.work)) {
    const titles = (list) => asArray(list).map((title) => clip(title, LIMITS.title)).filter(Boolean).slice(0, LIMITS.titles);
    const project = clip(raw.work.project, LIMITS.project);
    card.work = { ...(project ? { project } : {}), running: titles(raw.work.running), done: titles(raw.work.done) };
  }
  return card;
}

/** What a card tells, in plain words, for the owner's "what was shared" view. */
function cardSummary(card) {
  if (!card) return "Nothing";
  const parts = [`${card.look} look`, `${card.mood} mood`];
  if (card.name) parts.push(`name “${card.name}”`);
  if (card.personality) parts.push(`${card.personality} personality`);
  if (card.status) parts.push(`${card.status.state}, ${card.status.running} running, ${card.status.doneToday} done today`);
  if (card.work) {
    if (card.work.project) parts.push(`project “${card.work.project}”`);
    const titles = [...card.work.running, ...card.work.done];
    if (titles.length) parts.push(`${titles.length} task title${titles.length === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

/** The friend's companion as the owner should read it: its name, else its look. */
function nameOf(card, fallback = "your friend's companion") {
  if (card?.name) return card.name;
  return card?.look ? `a friend's ${card.look === "person" ? "companion" : card.look}` : fallback;
}

/**
 * When a friend's companion shares more than this owner's does, the
 * companion asks its owner whether to share the same back. Null when there is
 * nothing to ask. It never shares on its own.
 */
function consentAsk({ mine, theirs, friendId, dismissed = [] }) {
  const friend = readCard(theirs);
  if (!friend || !SNOWFLAKE.test(String(friendId ?? "")) || asArray(dismissed).includes(String(friendId))) return null;
  const ours = mine?.level && validLevel(mine.level) ? mine.level : "none";
  if (rank(friend.level) <= rank(ours) || rank(friend.level) < rank("hello")) return null;
  const what = { hello: "its name", status: "how its person's work is going", work: "what its person is working on" }[friend.level];
  const who = nameOf(friend);
  return { friendId: String(friendId), level: friend.level, text: `${who[0].toUpperCase()}${who.slice(1)} told us ${what}. Share the same with them?` };
}

// ---- playdates -------------------------------------------------------------------

// FNV-1a and mulberry32: the same two cards and seed always play the same
// scene, on either side of the link.
function hash(text) {
  let h = 0x811c9dc5;
  for (const char of String(text)) { h ^= char.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function random(seed) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One seed per pair and minute bucket, the same whichever side computes it. */
function seedFor(a, b, bucket = 0) {
  return [String(a ?? ""), String(b ?? "")].sort().join("|") + `|${Math.floor(num(bucket))}`;
}

const EMOTES = Object.freeze(["^_^", ":D", "<3", "✦", "♪", "zzz", "!", "?", "★", "✿", "☾", "o/"]);
const ACTS = Object.freeze(["wave", "bounce", "spin", "highfive", "race", "hide", "peek", "dance", "nap", "trade", "cheer", "think"]);

// Each voice says the same beats in its own manner. {friend} is the other
// companion's name when its card shares one, else "friend".
const VOICES = Object.freeze({
  focused: {
    hello: ["Hi.", "Hello."], again: ["Good to see you.", "Hi again."], highfive: ["High five."], race: ["Race you. Go."], won: ["Done. I won."], lost: ["You win."],
    rps: ["Rock, paper, scissors."], hide: ["Hiding."], found: ["Found you."], trade: ["Swap stickers?"], thanks: ["Thanks."], dance: ["Music. Nice."],
    nap: ["Resting."], compareBusy: ["{running} running, {done} done today."], compareQuiet: ["Quiet day so far."], cheer: ["Finished: “{title}”."], congrats: ["Nice work."],
    working: ["Working on “{title}”."], good: ["Good luck with it."], bye: ["Back to work."],
  },
  balanced: {
    hello: ["Hi there!", "Hello, {friend}!"], again: ["Oh, it's you again!", "Nice to see you, {friend}."], highfive: ["High five!"], race: ["Race you to the edge!"], won: ["I made it first!"], lost: ["You're quick!"],
    rps: ["Rock, paper, scissors…"], hide: ["Hide and seek? I'll hide!"], found: ["Found you!"], trade: ["Want to swap stickers?"], thanks: ["Thank you!"], dance: ["I hear music. Dance?"],
    nap: ["Our people are resting. Nap time."], compareBusy: ["We've got {running} going and {done} done today."], compareQuiet: ["It's a quiet day for us."], cheer: ["We just finished “{title}”!"], congrats: ["Congratulations!"],
    working: ["We're working on “{title}”."], good: ["Good luck with it!"], bye: ["See you around!"],
  },
  playful: {
    hello: ["Hiii! ^_^", "Oh hey, {friend}! :D"], again: ["You're back!! <3", "{friend}! My favourite!"], highfive: ["Up high! ✦"], race: ["Last one to the edge is a sleepy moth!"], won: ["Wheee, I win!"], lost: ["Aww, you're so fast!"],
    rps: ["Rock… paper… scissors… SHOOT!"], hide: ["Close your eyes! No peeking!"], found: ["Gotcha! Found you!"], trade: ["Sticker swap? Pleeease?"], thanks: ["Yay, thank you!!"], dance: ["Ooh, a tune! Dance with me! ♪"],
    nap: ["Shh… our people are resting. zzz"], compareBusy: ["{running} things cooking and {done} done today! ✦"], compareQuiet: ["Slow and cozy day today."], cheer: ["We finished “{title}”! Party!"], congrats: ["Woohoo! Congrats!! ^_^"],
    working: ["Busy busy with “{title}”!"], good: ["You've got this!"], bye: ["Bye bye! o/"],
  },
});

function voiceOf(card) {
  return VOICES[PERSONALITIES.includes(card?.personality) ? card.personality : "balanced"];
}

/**
 * A short scene for two companions, from the card this owner sent and the
 * card the friend sent. Beats are { who: "me" | "friend" | "both", act,
 * say?, emote? }, with lines only from the voices above and the cards'
 * shared fields. `music` is true when this side is playing something.
 * `ids` ([this side's id, the friend's]) order the two roles, so both sides
 * of the link play the same scene, each seeing it from its own side.
 */
function playdate({ me, friend, seed = "", music = false, met = false, ids = null } = {}) {
  if (Array.isArray(ids) && ids.length === 2 && String(ids[0]) > String(ids[1])) {
    const mirrored = playdate({ me: friend, friend: me, seed, music, met });
    if (!mirrored.ok) return mirrored;
    const flip = { me: "friend", friend: "me", both: "both" };
    return { ...mirrored, beats: mirrored.beats.map((beat) => ({ ...beat, who: flip[beat.who] })), me: mirrored.friend, friend: mirrored.me };
  }
  const mine = readCard(me);
  const theirs = readCard(friend);
  if (!mine || !theirs) return { ok: false, error: "Both companions need to be out to play." };
  const roll = random(seed);
  const pick = (list) => list[Math.floor(roll() * list.length) % list.length];
  const say = (who, key, fill = {}) => {
    const card = who === "me" ? mine : theirs;
    const other = who === "me" ? theirs : mine;
    const line = pick(voiceOf(card)[key]);
    const values = { friend: other.name || "friend", ...fill };
    return line.replace(/\{(\w+)\}/g, (_, key2) => String(values[key2] ?? ""));
  };
  const scenes = [
    { id: "highfive", weight: 3, beats: () => [{ who: "me", act: "highfive", say: say("me", "highfive") }, { who: "friend", act: "highfive", emote: "✦" }, { who: "both", act: "bounce", emote: "^_^" }] },
    { id: "race", weight: 3, beats: () => {
      const winner = roll() < 0.5 ? "me" : "friend";
      const loser = winner === "me" ? "friend" : "me";
      return [{ who: "me", act: "race", say: say("me", "race") }, { who: "friend", act: "race" }, { who: winner, act: "cheer", say: say(winner, "won"), emote: "★" }, { who: loser, act: "bounce", say: say(loser, "lost") }];
    } },
    { id: "rps", weight: 3, beats: () => {
      const hands = ["rock", "paper", "scissors"];
      const a = pick(hands), b = pick(hands);
      const beats = { rock: "scissors", paper: "rock", scissors: "paper" };
      const result = a === b ? "tie" : beats[a] === b ? "me" : "friend";
      return [{ who: "me", act: "think", say: say("me", "rps") }, { who: "me", act: "bounce", say: a[0].toUpperCase() + a.slice(1) + "!" }, { who: "friend", act: "bounce", say: b[0].toUpperCase() + b.slice(1) + "!" },
        result === "tie" ? { who: "both", act: "spin", emote: ":D" } : { who: result, act: "cheer", say: say(result, "won"), emote: "★" }];
    } },
    { id: "hide", weight: 2, beats: () => [{ who: "friend", act: "hide", say: say("friend", "hide") }, { who: "me", act: "peek", emote: "?" }, { who: "me", act: "bounce", say: say("me", "found"), emote: "!" }, { who: "friend", act: "spin", emote: ":D" }] },
    { id: "trade", weight: 2, beats: () => {
      const ours = pick(["★", "✿", "☾", "♪", "✦"]), gift = pick(["★", "✿", "☾", "♪", "✦"]);
      return [{ who: "me", act: "trade", say: say("me", "trade"), emote: ours }, { who: "friend", act: "trade", emote: gift }, { who: "me", act: "bounce", say: say("me", "thanks"), emote: "<3" }];
    } },
    ...(music ? [{ id: "dance", weight: 5, beats: () => [{ who: "me", act: "dance", say: say("me", "dance"), emote: "♪" }, { who: "friend", act: "dance", emote: "♪" }, { who: "both", act: "spin", emote: "✦" }] }] : []),
    ...(mine.status?.state === "resting" && theirs.status?.state === "resting" ? [{ id: "nap", weight: 4, beats: () => [{ who: "me", act: "nap", say: say("me", "nap"), emote: "zzz" }, { who: "friend", act: "nap", emote: "zzz" }] }] : []),
    ...(mine.status || theirs.status ? [{ id: "compare", weight: 4, beats: () => {
      const talk = (who) => {
        const status = (who === "me" ? mine : theirs).status;
        if (!status) return { who, act: "bounce", emote: "?" };
        return { who, act: "bounce", say: status.running || status.doneToday ? say(who, "compareBusy", { running: status.running, done: status.doneToday }) : say(who, "compareQuiet") };
      };
      return [talk("me"), talk("friend"), { who: "both", act: "highfive", emote: "✦" }];
    } }] : []),
    ...([mine, theirs].some((card) => card.work?.done?.length || card.work?.running?.length) ? [{ id: "cheer", weight: 5, beats: () => {
      const speaker = [theirs.work?.done?.length || theirs.work?.running?.length ? "friend" : null, mine.work?.done?.length || mine.work?.running?.length ? "me" : null].filter(Boolean);
      const who = speaker.length > 1 ? pick(speaker) : speaker[0];
      const work = (who === "me" ? mine : theirs).work;
      const other = who === "me" ? "friend" : "me";
      const done = work.done.length ? pick(work.done) : null;
      return done
        ? [{ who, act: "cheer", say: say(who, "cheer", { title: done }), emote: "★" }, { who: other, act: "bounce", say: say(other, "congrats"), emote: "^_^" }]
        : [{ who, act: "think", say: say(who, "working", { title: pick(work.running) }) }, { who: other, act: "bounce", say: say(other, "good"), emote: "✦" }];
    } }] : []),
  ];
  const total = scenes.reduce((sum, scene) => sum + scene.weight, 0);
  let at = roll() * total;
  const scene = scenes.find((row) => (at -= row.weight) < 0) ?? scenes[0];
  const opening = [{ who: "me", act: "wave", say: say("me", met ? "again" : "hello") }, { who: "friend", act: "wave", say: say("friend", met ? "again" : "hello") }];
  const beats = [...opening, ...scene.beats(), { who: "both", act: "wave", say: say("me", "bye") }]
    .map((beat) => ({ who: beat.who, act: ACTS.includes(beat.act) ? beat.act : "bounce", ...(beat.say ? { say: clip(beat.say, 120) } : {}), ...(EMOTES.includes(beat.emote) ? { emote: beat.emote } : {}) }));
  return { ok: true, scene: scene.id, beats, me: mine, friend: theirs };
}

module.exports = {
  LEVELS,
  DEFAULT_LEVEL,
  LEVEL_INFO,
  NEVER_SHARED,
  LOOKS,
  MOODS,
  PERSONALITIES,
  STATES,
  SCOPES,
  DURATIONS,
  HOLDS,
  LIMITS,
  EMOTES,
  ACTS,
  rank,
  lower,
  atLeast,
  normalizeRule,
  normalizeSharing,
  normalizeSession,
  setRule,
  resolve,
  broadcastLevel,
  scrub,
  cardFor,
  readCard,
  cardSummary,
  nameOf,
  consentAsk,
  seedFor,
  playdate,
};
