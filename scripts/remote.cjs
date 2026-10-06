// Mefi's Studio AI+ — the Discord remote's rules (docs/remote.md).
//
// The owner DMs the Void Engine bot; the rooms hub hands the command to this
// PC over the socket Studio already holds (scripts/hub-client.cjs), and
// main.cjs "Discord remote" answers it with what this module decides: which
// commands exist, what a message from Discord may do (look and talk, never
// approve without the PIN, never change permissions, keys or settings), how
// each reply reads, which changes become alerts, and the approval PIN with its
// lockout.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.
// Callers pass `now` and everything they read; node:crypto only hashes the PIN.
"use strict";

const crypto = require("node:crypto");

const COMMANDS = Object.freeze(["status", "needs", "made", "digest", "say", "pause", "resume", "button"]);
// What a chat message from Discord may still do once the chat gate passed it
// (task-oversight.cjs): file work (held for the owner's OK), leave a note,
// brake, stop, and start or retry a card that already stands on the board.
// Approving, answering an ask, undoing a decision, closing a card and running
// a role stay in Studio.
const RUN_KINDS = Object.freeze(["create_task", "note", "pause", "resume", "stop", "work_on", "retry"]);
// The keyless reply's own actions (main.cjs assistantRespond) a message from
// Discord may still run: the brake, and filing its words as held work. The
// roster runs (tidy, fix, organize, compact, overseer, restarting jobs) wait.
const LOCAL_ACTIONS = Object.freeze(["pause", "resume", "queue-request"]);
const NOTICE_KINDS = Object.freeze(["needs-you", "done", "failed", "stuck", "digest", "info"]);
const TEXT_MAX = 1900;
const SAY_MAX = 2000;
const NAME_MAX = 40;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BUTTON_ID = /^[A-Za-z0-9_.:-]{1,48}$/;
const SNOWFLAKE = /^\d{17,20}$/;
const PIN = /^\d{4,12}$/;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
// Five wrong PINs lock Discord approvals until the owner unlocks them in Studio.
const PIN_TRIES = 5;
// Studio's own cap on alerts, under the hub's 20 an hour.
const NOTICES_PER_HOUR = 12;
// Agents that sit on work without starting it for this long get one alert.
const STUCK_AFTER_MS = 15 * MINUTE;
const STUCK_STATES = Object.freeze(["held", "parked", "stuck", "waiting", "starting", "setup"]);
const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32 });

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const oneLine = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
function clip(value, max = TEXT_MAX) {
  const text = String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// Minutes since `at`, as "12 min" or "2 h 5 min".
function ago(at, now) {
  const minutes = Math.max(0, Math.round((now - at) / MINUTE));
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}
// Discord reads *, _, ~, `, | and > as formatting; titles are shown as typed.
const plain = (value) => String(value ?? "").replace(/([\\*_~`|>])/g, "\\$1");

// ---- settings ----------------------------------------------------------------

const QUIET = /^([01]\d|2[0-3]):[0-5]\d$/;
/**
 * settings.remote as the host keeps it. `hostname` names the PC until the
 * owner picks a name. The PIN is kept only as a salted scrypt hash.
 */
function normalizeSettings(raw, { hostname = "" } = {}) {
  const saved = object(raw) ? raw : {};
  const notify = object(saved.notify) ? saved.notify : {};
  const quiet = object(saved.quiet) ? saved.quiet : {};
  const pin = object(saved.pin) && /^[0-9a-f]{32}$/.test(String(saved.pin.salt)) && /^[0-9a-f]{64}$/.test(String(saved.pin.hash)) ? { salt: saved.pin.salt, hash: saved.pin.hash, setAt: Number(saved.pin.setAt) || 0 } : null;
  const lock = object(saved.lock) ? saved.lock : {};
  const hour = Number(notify.digestHour);
  return {
    on: saved.on === true,
    name: oneLine(saved.name, NAME_MAX) || oneLine(hostname, NAME_MAX) || "This PC",
    notify: {
      needsYou: notify.needsYou !== false,
      failed: notify.failed !== false,
      stuck: notify.stuck !== false,
      done: notify.done === true,
      digestHour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null,
    },
    quiet: QUIET.test(String(quiet.from)) && QUIET.test(String(quiet.to)) && quiet.from !== quiet.to ? { from: quiet.from, to: quiet.to } : null,
    pin,
    lock: { failures: Number.isInteger(lock.failures) && lock.failures > 0 ? Math.min(lock.failures, PIN_TRIES) : 0, lockedAt: Number(lock.lockedAt) || 0 },
  };
}

/** What the renderer may see: never the PIN's salt or hash. */
function publicSettings(settings) {
  const s = normalizeSettings(settings);
  return { on: s.on, name: s.name, notify: s.notify, quiet: s.quiet, pinSet: Boolean(s.pin), locked: s.lock.failures >= PIN_TRIES };
}

/** A patch from Settings, applied to what is saved. The PIN has its own calls. */
function applyPatch(settings, patch = {}) {
  const current = normalizeSettings(settings);
  const next = { ...current };
  if (typeof patch.on === "boolean") next.on = patch.on;
  if (typeof patch.name === "string" && oneLine(patch.name, NAME_MAX)) next.name = oneLine(patch.name, NAME_MAX);
  if (object(patch.notify)) next.notify = normalizeSettings({ notify: { ...current.notify, ...patch.notify } }).notify;
  if (patch.quiet === null) next.quiet = null;
  else if (object(patch.quiet)) next.quiet = normalizeSettings({ quiet: patch.quiet }).quiet;
  return next;
}

// ---- the approval PIN ----------------------------------------------------------

/** A new PIN's salted hash, or null when the PIN is not 4-12 digits. */
function hashPin(pin, salt = crypto.randomBytes(16).toString("hex")) {
  if (!PIN.test(String(pin ?? ""))) return null;
  const hash = crypto.scryptSync(String(pin), Buffer.from(salt, "hex"), SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString("hex");
  return { salt, hash };
}

/** Whether `pin` matches the saved hash; constant time. */
function checkPin(pin, saved) {
  if (!saved?.salt || !saved?.hash || !PIN.test(String(pin ?? ""))) return false;
  const tried = hashPin(pin, saved.salt);
  return Boolean(tried) && crypto.timingSafeEqual(Buffer.from(tried.hash, "hex"), Buffer.from(saved.hash, "hex"));
}

/**
 * One try at the PIN. Answers { ok, lock, locked, left } where `lock` is the
 * state to save: a right PIN clears the count, a wrong one adds to it, and the
 * fifth wrong one locks Discord approvals until the owner unlocks them.
 */
function tryPin(settings, pin, now) {
  const s = normalizeSettings(settings);
  if (!s.pin) return { ok: false, reason: "no-pin", lock: s.lock, locked: false, left: 0 };
  if (s.lock.failures >= PIN_TRIES) return { ok: false, reason: "locked", lock: s.lock, locked: true, left: 0 };
  if (checkPin(pin, s.pin)) return { ok: true, lock: { failures: 0, lockedAt: 0 }, locked: false, left: PIN_TRIES };
  const failures = s.lock.failures + 1;
  const locked = failures >= PIN_TRIES;
  return { ok: false, reason: locked ? "locked" : "wrong", lock: { failures, lockedAt: locked ? now : 0 }, locked, left: PIN_TRIES - failures };
}

// ---- commands ----------------------------------------------------------------

/**
 * A `remote` frame from the hub as this PC acts on it, or null. Only the
 * member this Studio signed in as may command it, whatever the hub says.
 */
function request(frame, selfUserId) {
  if (!object(frame) || !REQUEST_ID.test(String(frame.requestId ?? "")) || !COMMANDS.includes(frame.command)) return null;
  if (!SNOWFLAKE.test(String(frame.from ?? "")) || !SNOWFLAKE.test(String(selfUserId ?? "")) || String(frame.from) !== String(selfUserId)) return null;
  const out = { requestId: frame.requestId, command: frame.command };
  if (frame.command === "say") {
    const text = typeof frame.text === "string" ? frame.text.trim() : "";
    if (!text || text.length > SAY_MAX) return null;
    out.text = text;
  }
  if (frame.command === "button") {
    if (!BUTTON_ID.test(String(frame.buttonId ?? ""))) return null;
    out.buttonId = frame.buttonId;
    if (frame.pin != null) {
      if (!PIN.test(String(frame.pin))) return null;
      out.pin = String(frame.pin);
    }
  }
  return out;
}

/**
 * The chat gate's answer for a message that came from Discord, or with
 * `from: "app"` from another app on this PC (scripts/studio-api.cjs), which
 * gets the same narrower chat.
 */
function gateActions(checked = {}, { from = "discord" } = {}) {
  const run = [], refused = [];
  const app = from === "app";
  for (const action of Array.isArray(checked.run) ? checked.run : []) {
    if (RUN_KINDS.includes(action?.kind)) run.push(action);
    else if (app) refused.push({ action, reason: action?.kind === "approve" ? "from another app, the owner approves in Studio" : "from another app this waits for the owner in Studio" });
    else refused.push({ action, reason: action?.kind === "approve" ? "from Discord, approve with the Approve button and your PIN, or in Studio" : "from Discord this waits for you in Studio" });
  }
  return { ...checked, run, rejected: [...(Array.isArray(checked.rejected) ? checked.rejected : []), ...refused] };
}

// ---- replies ---------------------------------------------------------------------

function workingLines(snapshot, now, { steps = true } = {}) {
  return (snapshot?.working ?? []).map((row) => `• ${plain(row.title)}${row.since ? ` (${ago(row.since, now)})` : ""}${steps && row.step ? ` — ${plain(oneLine(row.step, 120))}` : ""}`);
}
function tally(snapshot) {
  const parts = [];
  if (snapshot?.needsYou) parts.push(`${plural(snapshot.needsYou, "thing needs", "things need")} you`);
  const done = snapshot?.done?.length ?? 0, failed = snapshot?.failed?.length ?? 0;
  if (done || failed) parts.push(`today: ${[done ? `${done} done` : "", failed ? `${failed} stopped` : ""].filter(Boolean).join(", ")}`);
  return parts.join(" · ");
}

/** `status`: what the loop says, what is being built, and the tally. */
function statusReply(snapshot, { now }) {
  if (!snapshot) return { text: "Studio could not read this PC's board just now. Try again in a minute." };
  const head = `${snapshot.project ? `**${plain(snapshot.project)}** · ` : ""}${plain(snapshot.headline || "Agents")}`;
  const lines = [head, ...workingLines(snapshot, now, { steps: false })];
  const count = tally(snapshot);
  if (count) lines.push(count);
  const buttons = [];
  if (snapshot.needsYou) buttons.push({ id: "needs", label: "What needs me", style: "primary" });
  if (["held", "paused"].includes(snapshot.state)) buttons.push({ id: "resume", label: "Resume agents", style: "success" });
  else if (snapshot.state === "running") buttons.push({ id: "pause", label: "Pause new work", style: "secondary" });
  return { text: clip(lines.join("\n")), buttons };
}

/**
 * `needs`: everything waiting on the owner, numbered. An approval gets an
 * Approve button (with the PIN) when a PIN is set and not locked; anything
 * else is answered in Studio. `approvals` are the host's approval handles:
 * [{ id: buttonId, index }] for the numbered rows it can approve.
 */
function needsReply(needs, { pinReady = false, approvals = [] } = {}) {
  const items = Array.isArray(needs?.items) ? needs.items : [];
  if (!items.length) return { text: "Nothing needs you on this PC right now." };
  const kindWord = { approval: "Approve", question: "Question", held: "Held", parked: "Stopped", review: "Review" };
  const lines = [`${plural(needs.total ?? items.length, "thing needs", "things need")} you:`];
  items.slice(0, 10).forEach((item, index) => lines.push(`${index + 1}. ${kindWord[item.kind] ?? "Needs you"}: ${plain(item.title)}${item.kind === "approval" ? "" : " (in Studio)"}`));
  if (items.length > 10) lines.push(`…and ${items.length - 10} more in Studio.`);
  const buttons = pinReady ? approvals.slice(0, 5).map((row) => ({ id: row.id, label: `Approve ${row.index}`, style: "success", pin: true })) : [];
  if (!pinReady && items.some((item) => item.kind === "approval")) lines.push("Set an approval PIN in Studio (Friends › Your PCs › Reach this PC from Discord) to approve from here.");
  return { text: clip(lines.join("\n")), buttons };
}

/** `made`: what is being built now, and what finished or stopped today. */
function madeReply(snapshot, { now }) {
  if (!snapshot) return { text: "Studio could not read this PC's board just now. Try again in a minute." };
  const lines = [];
  const working = workingLines(snapshot, now);
  lines.push(working.length ? "**Building now**" : "Nothing is being built right now.", ...working);
  if (snapshot.done?.length) lines.push("**Finished today**", ...snapshot.done.slice(0, 8).map((title) => `• ${plain(title)}`));
  if (snapshot.failed?.length) lines.push("**Stopped today**", ...snapshot.failed.slice(0, 5).map((title) => `• ${plain(title)}`));
  return { text: clip(lines.join("\n")) };
}

/** `digest`: the companion's digest (scripts/companion.cjs digest). */
function digestReply(digest) {
  if (!digest) return { text: "Nothing to report from this PC yet." };
  const lines = [plain(digest.headline || "Nothing changed."), ...(digest.lines ?? []).slice(0, 12).map((line) => `• ${plain(line)}`)];
  return { text: clip(lines.join("\n")) };
}

/** Mefi's answer to a `say`, with what its actions did. */
function sayReply(reply) {
  const text = clip([reply?.text, ...(Array.isArray(reply?.results) ? reply.results : [])].filter(Boolean).join("\n\n"));
  return { text: text || "Mefi kept your message in the thread." };
}

// ---- alerts ----------------------------------------------------------------------

const minutesOf = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
/** Whether `now` (the PC's local time, given as minutes after midnight) is in quiet hours. */
function quietNow(quiet, minuteOfDay) {
  if (!quiet) return false;
  const from = minutesOf(quiet.from), to = minutesOf(quiet.to);
  return from < to ? minuteOfDay >= from && minuteOfDay < to : minuteOfDay >= from || minuteOfDay < to;
}

/**
 * Which changes since the last look become alerts. `memory` is what the last
 * look kept (null on the first look, which only remembers); `snapshot` is
 * main's agentsSnapshot; `needs` its needs-you digest with item ids. Answers
 * { notices, memory }. Needs-you alerts wait out quiet hours (they are still
 * waiting then); finished and stopped work seen during quiet hours is left to
 * the digest. `sent` is when each of the last hour's alerts went.
 */
function alerts({ memory = null, snapshot, needs, settings, now, minuteOfDay, day, approvalButton = () => null }) {
  const s = normalizeSettings(settings);
  const items = Array.isArray(needs?.items) ? needs.items : [];
  const failed = snapshot?.failed ?? [], done = snapshot?.done ?? [];
  const state = snapshot?.state ?? null;
  const stuckNow = STUCK_STATES.includes(state) && ((snapshot?.working?.length ?? 0) === 0);
  const next = {
    needs: memory?.needs ?? [], failed: memory?.failed ?? [], done: memory?.done ?? [],
    stuckSince: stuckNow ? (memory?.stuckSince ?? now) : null, stuckSent: stuckNow ? Boolean(memory?.stuckSent) : false,
    digestDay: memory?.digestDay ?? day, sent: (memory?.sent ?? []).filter((at) => now - at < HOUR), day,
  };
  if (!memory || !snapshot) {
    // The first look after a start only remembers: no burst of old news.
    return { notices: [], memory: { ...next, needs: items.map((item) => item.id), failed: [...failed], done: [...done] } };
  }
  const quiet = quietNow(s.quiet, minuteOfDay);
  const notices = [];
  const room = () => next.sent.length + notices.length < NOTICES_PER_HOUR;
  // A new day starts the finished and stopped lists over.
  if (memory.day !== day) { next.failed = []; next.done = []; }
  const known = new Set(next.needs);
  const fresh = items.filter((item) => item?.id && !known.has(item.id));
  if (s.notify.needsYou && !quiet) {
    for (const item of fresh) {
      if (!room()) break;
      const button = item.kind === "approval" ? approvalButton(item) : null;
      notices.push({ key: `needs:${item.id}`.slice(0, 64), kind: "needs-you", text: clip(`🙋 Needs you: ${plain(item.title)}${item.kind === "approval" ? "" : " (answer in Studio)"}`), ...(button ? { buttons: [button] } : {}) });
    }
  }
  // Remember a needs-you item once it was sent, or when alerts are off for
  // it; during quiet hours it waits. Items that left the list are forgotten.
  const still = new Set(items.map((item) => item.id));
  const sentNeeds = new Set(notices.map((notice) => notice.key));
  next.needs = [...next.needs.filter((id) => still.has(id)), ...fresh.filter((item) => !s.notify.needsYou || sentNeeds.has(`needs:${item.id}`.slice(0, 64))).map((item) => item.id)];
  for (const [list, key, kind, on, icon, word] of [[failed, "failed", "failed", s.notify.failed, "⚠️", "Stopped"], [done, "done", "done", s.notify.done, "✅", "Done"]]) {
    const seen = new Set(next[key]);
    for (const title of list) {
      if (seen.has(title)) continue;
      next[key].push(title);
      if (on && !quiet && room()) notices.push({ key: `${kind}:${day}:${title}`.slice(0, 64).replace(/[^A-Za-z0-9_.:-]/g, "-"), kind, text: clip(`${icon} ${word}: ${plain(title)}`) });
    }
  }
  if (stuckNow && !next.stuckSent && now - next.stuckSince >= STUCK_AFTER_MS && s.notify.stuck && !quiet && room()) {
    notices.push({ key: `stuck:${next.stuckSince}`, kind: "stuck", text: clip(`⏸ ${plain(snapshot.headline || "Agents are waiting")}. Nothing has started for ${ago(next.stuckSince, now)}.`), buttons: state === "held" ? [{ id: "resume", label: "Start agents", style: "success" }] : [] });
    next.stuckSent = true;
  }
  if (s.notify.digestHour != null && next.digestDay !== day && Math.floor(minuteOfDay / 60) >= s.notify.digestHour && !quiet && room()) {
    notices.push({ key: `digest:${day}`, kind: "digest", text: "", digest: true });
    next.digestDay = day;
  }
  next.sent = [...next.sent, ...notices.map(() => now)];
  return { notices, memory: next };
}

/** Where a task filed from Discord says it came from; autonomy.needsApproval holds it. */
const ORIGIN = Object.freeze({ kind: "chat", by: "owner", via: "remote" });

module.exports = {
  COMMANDS, RUN_KINDS, LOCAL_ACTIONS, NOTICE_KINDS, TEXT_MAX, PIN_TRIES, NOTICES_PER_HOUR, STUCK_AFTER_MS, ORIGIN,
  normalizeSettings, publicSettings, applyPatch, hashPin, checkPin, tryPin,
  request, gateActions, statusReply, needsReply, madeReply, digestReply, sayReply, quietNow, alerts, clip, plain,
};
