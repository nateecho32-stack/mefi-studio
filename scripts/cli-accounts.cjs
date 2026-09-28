"use strict";
// Several subscription logins for one coding CLI. Claude Code keeps its login
// in the folder CLAUDE_CONFIG_DIR names (~/.claude by default) and Codex in
// CODEX_HOME (~/.codex), so a second subscription is a second folder and that
// one variable on every child that should spend it. Studio never reads the
// credentials: each CLI signs in and keeps its own login in its own folder.
//
// The CLI's default folder is the main login and always comes first; the
// logins the owner adds follow in the order they were added
// (settings.cliAccounts). Work fills the first login that is not topped out
// and moves to the next when one reports its usage limit, so every
// subscription login is spent before any other route answers. A topped-out
// login is kept aside until the reset its own message (or its usage reading)
// names, and is tried again when that passes.
//
// Pure module: no Electron, no filesystem, no network, no clock reads (time is
// injected). main.cjs's "Several logins per coding CLI" block keeps the limit
// marks in a file, makes the folders and starts the CLIs.
const path = require("node:path");

const PROVIDERS = Object.freeze({
  claude: Object.freeze({ name: "Claude Code", env: "CLAUDE_CONFIG_DIR", folder: ".claude" }),
  codex: Object.freeze({ name: "Codex", env: "CODEX_HOME", folder: ".codex" }),
});
const MAIN_LABEL = "Main login";
// Extra logins per provider, beside the main one.
const MAX_EXTRA = 5;
// A limit message that names no reset is tried again after this long; a usage
// reading, when one is taken, corrects it.
const RECHECK_MS = 30 * 60000;
// A reset further out than a weekly window plus a day is a misreading.
const MAX_LIMIT_MS = 8 * 24 * 3600000;
const MIN_LIMIT_MS = 60000;

const ID = /^[a-z]+-[a-z0-9]{4,16}$/;
const clip = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function isProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
}

// The main login: the CLI's own default folder, whatever the environment
// already points it at.
function mainAccount(provider) {
  return { id: `${provider}-main`, provider, label: MAIN_LABEL, home: null, main: true };
}

// The saved extra logins, cleaned: a known provider, a well-formed unique id,
// an absolute folder, a label (numbered when blank), at most MAX_EXTRA each.
function normalizeAccounts(saved) {
  const out = [];
  const ids = new Set();
  const homes = new Set();
  const counts = {};
  for (const raw of Array.isArray(saved) ? saved : []) {
    if (!raw || typeof raw !== "object") continue;
    const provider = String(raw.provider ?? "");
    const id = String(raw.id ?? "");
    const home = String(raw.home ?? "");
    if (!isProvider(provider) || !ID.test(id) || !id.startsWith(`${provider}-`) || id === `${provider}-main` || ids.has(id)) continue;
    if (!home || home.length > 400 || /[\r\n\0]/.test(home) || !path.isAbsolute(home) || homes.has(home.toLowerCase())) continue;
    counts[provider] = (counts[provider] ?? 0) + 1;
    if (counts[provider] > MAX_EXTRA) continue;
    ids.add(id);
    homes.add(home.toLowerCase());
    out.push({ id, provider, label: clip(raw.label, 40) || `Login ${counts[provider] + 1}`, home, main: false });
  }
  return out;
}

// Every login for one provider, the main one first.
function accountsFor(settings, provider) {
  if (!isProvider(provider)) return [];
  return [mainAccount(provider), ...normalizeAccounts(settings?.cliAccounts).filter((account) => account.provider === provider)];
}

function hasExtra(settings, provider) {
  return accountsFor(settings, provider).length > 1;
}

// What a child needs to run on this login: nothing for the main one (it
// inherits the environment as before), the folder variable for the rest.
function accountEnv(account) {
  if (!account || account.main || !account.home || !isProvider(account.provider)) return {};
  return { [PROVIDERS[account.provider].env]: account.home };
}

// The one line routes and logs name a login by.
function accountTag(account, { extra = true } = {}) {
  if (!account) return "";
  return extra ? `${PROVIDERS[account.provider]?.name ?? account.provider} · ${account.label}` : PROVIDERS[account.provider]?.name ?? account.provider;
}

// A new saved list with one more login, or the refusal.
function addAccount(saved, { provider, id, home, label = "" }) {
  const list = normalizeAccounts(saved);
  if (!isProvider(provider)) return { ok: false, error: "Only Claude Code and Codex can hold more than one login." };
  if (list.filter((account) => account.provider === provider).length >= MAX_EXTRA) return { ok: false, error: `${PROVIDERS[provider].name} already has ${MAX_EXTRA} extra logins.` };
  const next = normalizeAccounts([...list, { id, provider, home, label: clip(label, 40) || `Login ${list.filter((account) => account.provider === provider).length + 2}` }]);
  const added = next.find((account) => account.id === id);
  if (!added) return { ok: false, error: "That login could not be added." };
  return { ok: true, accounts: next.map(({ main, ...account }) => account), account: added };
}

function removeAccount(saved, id) {
  const list = normalizeAccounts(saved);
  const gone = list.find((account) => account.id === id);
  if (!gone) return { ok: false, error: "That login is not saved." };
  return { ok: true, accounts: list.filter((account) => account.id !== id).map(({ main, ...account }) => account), account: gone };
}

// ---- limits ---------------------------------------------------------------------

// A login that reports its plan's usage limit, not a transient rate limit or
// an outage: those end the call but leave the login usable, so they never move
// work to another login.
const USAGE_LIMIT = new RegExp([
  String.raw`\b(?:claude ai |claude )?usage limit (?:reached|exceeded)\b`,
  String.raw`\b(?:5-hour|five-hour|session|weekly|opus|sonnet|monthly) (?:usage )?limit (?:reached|exceeded)\b`,
  String.raw`\byou(?:'|’)ve (?:hit|reached) your (?:usage |session |weekly |5-hour |monthly )?limit\b`,
  String.raw`\byou(?:'|’)re out of (?:extra )?usage\b`,
  String.raw`\busage_limit_(?:reached|exceeded)\b`,
].join("|"), "i");
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function isUsageLimit(text) {
  return USAGE_LIMIT.test(String(text ?? "").replace(ANSI, ""));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// The wall clock in a time zone (the local one when none is named or the name
// is unknown), to the minute.
function wallClock(ms, timeZone) {
  const read = (zone) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(ms));
    const part = (type) => Number(parts.find((entry) => entry.type === type)?.value);
    return { y: part("year"), mo: part("month"), d: part("day"), h: part("hour") % 24, mi: part("minute") };
  };
  try { return read(timeZone || undefined); }
  catch { return read(undefined); }
}

// Minutes from `now`'s wall clock to a wall-clock target in the same zone.
function wallDelta(now, zone, target) {
  const at = wallClock(now, zone);
  return (Date.UTC(target.y ?? at.y, target.mo - 1, target.d, target.h, target.mi) - Date.UTC(at.y, at.mo - 1, at.d, at.h, at.mi)) / 60000;
}

function hour12(hour, meridiem) {
  const h = Number(hour) % 12;
  return /p/i.test(meridiem ?? "") ? h + 12 : h;
}

// When the login's limit resets, read from the message that reported it, as
// epoch milliseconds, or null when it names none this can read. Claude Code
// prints "…usage limit reached|<epoch seconds>" (older builds), "5-hour limit
// reached ∙ resets 3pm", "You've hit your limit · resets 3pm (Europe/London)"
// or "…resets Oct 9, 10am"; Codex "try again in 4 days 3 hours" or "try again
// at 3:05 PM".
function resetFrom(text, now) {
  const line = String(text ?? "").replace(ANSI, "");
  const floor = now - (now % 60000);
  const within = (until) => (Number.isFinite(until) && until > now && until - now <= MAX_LIMIT_MS ? until : null);
  const epoch = line.match(/limit reached\|(\d{10,13})\b/i);
  if (epoch) return within(epoch[1].length === 13 ? Number(epoch[1]) : Number(epoch[1]) * 1000);
  const relative = line.match(/\b(?:try again|resets?|available again) in ((?:\d+\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m)\b[\s,and]*)+)/i);
  if (relative) {
    let minutes = 0;
    for (const [, amount, unit] of relative[1].matchAll(/(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)\b/gi)) {
      minutes += Number(amount) * (/^d/i.test(unit) ? 1440 : /^h/i.test(unit) ? 60 : 1);
    }
    return minutes > 0 ? within(now + minutes * 60000) : null;
  }
  const zone = line.match(/\(([A-Za-z_]+(?:\/[A-Za-z_+-]+){1,2}|UTC|GMT)\)/)?.[1];
  const iso = line.match(/\breset(?:s)? (?:at |on )?(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/i);
  if (iso) {
    const delta = wallDelta(now, zone, { y: Number(iso[1]), mo: Number(iso[2]), d: Number(iso[3]), h: Number(iso[4]), mi: Number(iso[5]) });
    return within(floor + delta * 60000);
  }
  const dated = line.match(/\b(?:resets?|reset|try again)(?: at| on)? ([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,?(?: (\d{4}),?)?(?: at)? (\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)/i);
  if (dated && MONTHS.includes(dated[1].slice(0, 3).toLowerCase())) {
    const target = { y: dated[3] ? Number(dated[3]) : undefined, mo: MONTHS.indexOf(dated[1].slice(0, 3).toLowerCase()) + 1, d: Number(dated[2]), h: hour12(dated[4], dated[6]), mi: Number(dated[5] ?? 0) };
    let delta = wallDelta(now, zone, target);
    if (delta < -1440 && !dated[3]) delta = wallDelta(now, zone, { ...target, y: wallClock(now, zone).y + 1 });
    return within(floor + delta * 60000);
  }
  const clock = line.match(/\b(?:resets?|reset|try again)(?: at)? (\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)/i);
  if (clock) {
    const at = wallClock(now, zone);
    let delta = wallDelta(now, zone, { mo: at.mo, d: at.d, h: hour12(clock[1], clock[3]), mi: Number(clock[2] ?? 0) });
    if (delta <= 0) delta += 1440;
    return within(floor + delta * 60000);
  }
  return null;
}

// What a usage reading (usage-tracker's parsed limits) says about a login: a
// full window that covers every model tops it out until that window resets.
// A window scoped to one model (Claude's weekly Opus) leaves the login usable
// for the rest, and a run that still hits it reports the limit itself.
function readingLimit(limits, now) {
  if (!limits || typeof limits !== "object" || limits.available === false) return { limited: false, until: null };
  const full = (Array.isArray(limits.windows) ? limits.windows : []).filter((window) => window && !window.scope && !window.reset && Number(window.percent) >= 100);
  if (!full.length && limits.blocked !== true) return { limited: false, until: null };
  const resets = full.map((window) => Date.parse(window.resetsAt)).filter((at) => Number.isFinite(at) && at > now);
  const until = resets.length ? Math.max(...resets) : null;
  return { limited: true, until: until && until - now <= MAX_LIMIT_MS ? until : null };
}

// Limit marks: { [accountId]: { until, since, reason, source } }.
function isLimited(marks, id, now) {
  const mark = marks?.[id];
  return Boolean(mark && Number(mark.until) > now);
}

function markLimited(marks, id, { now, until = null, reason = "", source = "run" }) {
  const at = Number.isFinite(until) ? Math.min(now + MAX_LIMIT_MS, Math.max(now + MIN_LIMIT_MS, until)) : now + RECHECK_MS;
  return { ...(marks ?? {}), [id]: { until: at, since: now, reason: clip(reason, 200), source, known: Number.isFinite(until) } };
}

function clearLimit(marks, id) {
  if (!marks?.[id]) return marks ?? {};
  const next = { ...marks };
  delete next[id];
  return next;
}

// Marks whose time has passed, or whose login is gone, are dropped.
function pruneMarks(marks, now, ids = null) {
  const out = {};
  for (const [id, mark] of Object.entries(marks && typeof marks === "object" ? marks : {})) {
    if (!mark || typeof mark !== "object" || !(Number(mark.until) > now)) continue;
    if (ids && !ids.has(id)) continue;
    out[id] = { until: Number(mark.until), since: Number(mark.since) || 0, reason: clip(mark.reason, 200), source: mark.source === "reading" ? "reading" : "run", known: mark.known === true };
  }
  return out;
}

// Which login answers next: the first one not topped out. With every login
// topped out, `account` is null and `soonest` is the first reset.
function pick(accounts, marks, now) {
  const list = Array.isArray(accounts) ? accounts : [];
  const ready = list.filter((account) => !isLimited(marks, account.id, now));
  const waits = list.filter((account) => isLimited(marks, account.id, now)).map((account) => Number(marks[account.id].until));
  return { account: ready[0] ?? null, ready, soonest: ready.length || !waits.length ? null : Math.min(...waits) };
}

// Each login as Settings shows it.
function describe(accounts, marks, now) {
  return (Array.isArray(accounts) ? accounts : []).map((account) => {
    const mark = isLimited(marks, account.id, now) ? marks[account.id] : null;
    return { id: account.id, provider: account.provider, label: account.label, main: account.main === true, home: account.home, limited: Boolean(mark), until: mark ? mark.until : null, known: mark ? mark.known === true : false, reason: mark ? mark.reason : "" };
  });
}

module.exports = {
  PROVIDERS, MAIN_LABEL, MAX_EXTRA, RECHECK_MS, MAX_LIMIT_MS,
  isProvider, mainAccount, normalizeAccounts, accountsFor, hasExtra, accountEnv, accountTag, addAccount, removeAccount,
  isUsageLimit, resetFrom, readingLimit, isLimited, markLimited, clearLimit, pruneMarks, pick, describe,
};
