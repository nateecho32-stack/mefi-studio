// Mefi's Studio AI+ — the rules for Windows notifications, the taskbar flash and
// the count on the taskbar icon.
//
// Studio tells Windows when something waits on the owner, so a PC left working
// does not need a window kept open to be watched. Everything it may and may not
// say is decided here, from plain inputs, in one place:
//
//   - kinds: need (a question, an approval), perm (a builder asks for reach it
//     was not given), fail (a task failed after Mefi stopped retrying), done
//     (ready for review or verified), test (the button in Settings);
//   - only while Studio is not the window being looked at (another window is in
//     front, Studio is minimized, hidden or parked in the tray);
//   - never inside quiet hours, which are the Discord remote's own
//     (settings.remote.quiet), except the test;
//   - the same task and kind is not told twice for a while, and no more than
//     twelve notifications go out in an hour (the inbox still has the rest);
//   - the words are generic by default ("Something needs you"): Windows keeps
//     notification text in its history and can show it on the lock screen, so a
//     task's title travels only when the owner chose task titles;
//   - the taskbar flashes when a notification goes out, and the icon carries a
//     count of what waits on the owner;
//   - MEFI_STUDIO_NO_ALERTS=1 or the master switch turns all of it off.
//
// decide() answers for one batch of things of one kind: { notify, flash, badge,
// why }. `why` is a plain sentence for when nothing goes out, the same words
// the Settings card and the test button show. The host (scripts/alerts-host.cjs,
// main.cjs "Notifications") owns the window, the notification object, the clock
// and the settings file.
//
// Pure module: no Electron, no filesystem, no network, no clock reads (time is
// injected).

"use strict";

const HOUR_MS = 60 * 60 * 1000;
/** The most notifications Studio sends in an hour. */
const PER_HOUR = 12;
/** How long the same task and kind is not told twice. */
const DEDUPE_MS = 15 * 60 * 1000;
/** How long a thing must keep waiting before Windows hears of it: one the assistant answers by itself in a moment never pings. */
const SETTLE_MS = 20 * 1000;
/** Once one thing is ready, what has waited within this much of it goes out with it: a burst of questions is one notification. */
const GRACE_MS = 5 * 1000;
/** The largest count drawn on the icon. */
const BADGE_MAX = 99;

const KINDS = Object.freeze(["need", "fail", "done", "perm", "test"]);
const FLAGS = Object.freeze(["on", "need", "fail", "done", "flash", "badge", "sound"]);
/** What a fresh install does: need and fail on, done off (the inbox shows it), flash and count on, quiet, generic words. */
const DEFAULTS = Object.freeze({ on: true, need: true, fail: true, done: false, flash: true, badge: true, sound: false, titles: "generic" });
const QUIET_DEFAULT = Object.freeze({ from: "22:00", to: "07:00" });
const QUIET = /^([01]\d|2[0-3]):[0-5]\d$/;

// What a notification says when it names nothing: the words of the prototype.
const GENERIC = Object.freeze({
  need: Object.freeze(["Something needs you", "A task is waiting for your answer."]),
  fail: Object.freeze(["A task needs you", "Checks failed. Open Studio to decide what happens next."]),
  done: Object.freeze(["A task is ready", "Open Studio to review it."]),
  perm: Object.freeze(["A permission is needed", "A builder is asking before it goes on."]),
  test: Object.freeze(["Test notification", "Alerts are working. Nothing needs you."]),
});
const MANY = Object.freeze({
  need: (count) => ["Something needs you", `${count} things are waiting for you.`],
  fail: (count) => ["Tasks need you", `${count} tasks need a decision. Open Studio to see them.`],
  done: (count) => ["Tasks are ready", `${count} tasks are ready to review.`],
  perm: (count) => ["Permissions are needed", `${count} builders are asking before they go on.`],
});
const KIND_WORD = Object.freeze({ need: "questions", fail: "failures", done: "finished tasks", perm: "permissions" });

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const oneLine = (value, max = 200) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
};
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);

// ---- settings.alerts ------------------------------------------------------------------

/** The saved choices, as they are used: every switch a boolean, the words "generic" or "titles". */
function normalizePrefs(raw) {
  const saved = object(raw) ? raw : {};
  const prefs = {};
  for (const key of FLAGS) prefs[key] = typeof saved[key] === "boolean" ? saved[key] : DEFAULTS[key];
  prefs.titles = saved.titles === "titles" ? "titles" : "generic";
  return prefs;
}

/** A patch from Settings laid over the saved choices: only known keys, only the right types; anything else is ignored. */
function applyPatch(raw, patch) {
  const next = normalizePrefs(raw);
  if (!object(patch)) return next;
  for (const key of FLAGS) if (typeof patch[key] === "boolean") next[key] = patch[key];
  if (patch.titles === "titles" || patch.titles === "generic") next.titles = patch.titles;
  return next;
}

// ---- quiet hours (the Discord remote's: settings.remote.quiet) ---------------------------

/** { from, to } in 24-hour "HH:MM" when both are valid and differ, else null: the remote's own rule (scripts/remote.cjs). */
function normalizeQuiet(raw) {
  if (!object(raw)) return null;
  return QUIET.test(String(raw.from)) && QUIET.test(String(raw.to)) && raw.from !== raw.to ? { from: raw.from, to: raw.to } : null;
}

/** What Settings shows: the switch, and the hours it would use (the remote's defaults when there are none saved). */
function quietView(saved) {
  const quiet = normalizeQuiet(saved);
  return quiet ? { on: true, ...quiet } : { on: false, ...QUIET_DEFAULT };
}

/** A patch for the quiet hours: { on, from, to } to what settings.remote.quiet holds, or undefined when it says nothing usable. */
function quietPatch(saved, patch) {
  if (!object(patch)) return undefined;
  const current = quietView(saved);
  if (patch.on === false) return null;
  const from = QUIET.test(String(patch.from)) ? patch.from : current.from;
  const to = QUIET.test(String(patch.to)) ? patch.to : current.to;
  if (patch.on === true || (current.on && (patch.from !== undefined || patch.to !== undefined))) return normalizeQuiet({ from, to }) ?? normalizeQuiet({ from: current.from, to: current.to }) ?? { ...QUIET_DEFAULT };
  return undefined;
}

const minutesOf = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
/** Whether `minuteOfDay` (the PC's local time, minutes after midnight) is inside quiet hours, a window that may cross midnight. */
function quietNow(quiet, minuteOfDay) {
  const hours = normalizeQuiet(quiet);
  if (!hours || !Number.isFinite(Number(minuteOfDay))) return false;
  const from = minutesOf(hours.from), to = minutesOf(hours.to);
  return from < to ? minuteOfDay >= from && minuteOfDay < to : minuteOfDay >= from || minuteOfDay < to;
}

/** "07:00" as "7:00 AM", the way Settings and the messages say it. */
function clockLabel(hhmm) {
  if (!QUIET.test(String(hhmm))) return "";
  const [h, m] = String(hhmm).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// ---- what a thing is ---------------------------------------------------------------------

/** The alert kind of an assistant question, from the issue it carries (scripts/agent-issues.cjs); null for what is not a demand. */
function kindOfQuestion(question) {
  if (!object(question) || question.status !== "open" || question.kind === "suggestion") return null;
  const context = object(question.context) ? question.context : {};
  if (context.severity === "note") return null;
  if (context.issueKind === "permission") return "perm";
  if (context.issueKind === "check-failed" || context.issueKind === "run-failed") return "fail";
  return "need";
}

/** The alert kind of a task's lifecycle event (scripts/task-oversight.cjs taskEvents); null for the ones that do not call for the owner. */
function kindOfTaskEvent(kind) {
  if (kind === "parked") return "fail";
  if (kind === "needs-approval") return "need";
  if (kind === "verified" || kind === "done") return "done";
  return null;
}

// ---- the words -----------------------------------------------------------------------------

/**
 * [title, body] for a batch. Generic unless the owner chose task titles; a
 * batch of several says how many and, with titles on, names up to three. The
 * test never names anything.
 */
function textsFor(kind, items, prefs) {
  if (kind === "test") return [...GENERIC.test];
  const batch = Array.isArray(items) ? items : [];
  const many = batch.length > 1;
  const base = many ? MANY[kind](batch.length) : [...GENERIC[kind]];
  if (prefs.titles !== "titles") return base;
  const named = batch.filter((item) => oneLine(item?.title, 80)).map((item) => `${oneLine(item.title, 80)}${oneLine(item.detail, 100) ? `: ${oneLine(item.detail, 100)}` : ""}`);
  if (!named.length) return base;
  const body = many ? `${named.slice(0, 3).join(" · ")}${batch.length > 3 ? ` · and ${batch.length - 3} more` : ""}` : named[0];
  return [base[0], oneLine(body, 180)];
}

// ---- the taskbar count -----------------------------------------------------------------------

/** The number drawn on the taskbar icon: what waits on the owner, 0 (nothing drawn) when alerts or the count are off. */
function badgeFor(waiting, rawPrefs, rawCtx) {
  const prefs = normalizePrefs(rawPrefs);
  if ((object(rawCtx) && rawCtx.killed === true) || !prefs.on || !prefs.badge) return 0;
  return Math.min(count(waiting), BADGE_MAX);
}

// ---- deciding ------------------------------------------------------------------------------------

/**
 * Whether a batch of one kind goes to Windows now.
 *   event { kind, items: [{ id, title?, detail?, taskId?, projectId? }] }
 *   prefs the saved choices (normalizePrefs reads them)
 *   ctx   { now, minuteOfDay, focused (Studio is the window being looked at),
 *           killed (MEFI_STUDIO_NO_ALERTS), quiet ({ from, to } or null),
 *           sent [when each notification of the last hour went],
 *           recent { "<kind>:<id>": when }, waiting (how many wait on the owner) }
 * Answers { notify, flash, badge, why }. `notify` is null when nothing goes out,
 * else { key, kind, ids, count, title, body, silent, open: { kind, id } } where
 * `ids` are the things it tells (those not told a moment ago) and `open` is what
 * a click goes to. The test is exempt from quiet hours, the dedupe and the cap.
 */
function decide(event, rawPrefs, rawCtx) {
  const ctx = object(rawCtx) ? rawCtx : {};
  const prefs = normalizePrefs(rawPrefs);
  const kind = object(event) && KINDS.includes(event.kind) ? event.kind : null;
  const now = Number(ctx.now) || 0;
  const killed = ctx.killed === true;
  const badge = badgeFor(ctx.waiting, prefs, ctx);
  const no = (why) => ({ notify: null, flash: false, badge, why });
  if (!kind) return no("That is not something Studio tells Windows about.");
  if (killed) return no("Alerts are turned off for this session (MEFI_STUDIO_NO_ALERTS).");
  if (!prefs.on) return no("Windows notifications are off in Settings › Notifications.");
  const flag = { need: prefs.need, perm: prefs.need, fail: prefs.fail, done: prefs.done, test: true }[kind];
  if (!flag) return no(`No Windows notification: ${KIND_WORD[kind]} are off in Settings › Notifications.`);
  if (ctx.focused === true) return no(kind === "test" ? "Studio is in front, so Windows stays quiet. Switch to another window and it will arrive." : "Studio is in front, so Windows stays quiet. The inbox has it.");
  const test = kind === "test";
  const quiet = normalizeQuiet(ctx.quiet);
  if (!test && quiet && quietNow(quiet, Number(ctx.minuteOfDay))) return no(`Quiet hours until ${clockLabel(quiet.to)}: no notification. The inbox still has it.`);
  const recent = object(ctx.recent) ? ctx.recent : {};
  const named = new Set();
  // One thing once: several items about the same task are one thing to tell.
  const items = (Array.isArray(event.items) ? event.items : []).filter((item) => object(item) && item.id != null && String(item.id) !== "" && !named.has(String(item.id)) && named.add(String(item.id)));
  const fresh = test ? [] : items.filter((item) => !(now - Number(recent[`${kind}:${item.id}`] ?? -Infinity) < DEDUPE_MS));
  if (!test && !fresh.length) return no(items.length ? "Studio already told you about this a moment ago." : "There is nothing to tell you.");
  const inHour = (Array.isArray(ctx.sent) ? ctx.sent : []).filter((at) => now - Number(at) < HOUR_MS && now - Number(at) >= 0).length;
  if (!test && inHour >= PER_HOUR) return no(`Studio sends at most ${PER_HOUR} notifications an hour. The inbox has the rest.`);
  const [title, body] = textsFor(kind, fresh, prefs);
  const first = fresh[0] ?? null;
  return {
    notify: { key: `${kind}:${fresh.map((item) => item.id).join(",")}`.slice(0, 160), kind, ids: fresh.map((item) => String(item.id)), count: fresh.length, title, body, silent: !prefs.sound, open: { kind, id: first ? String(first.id) : null } },
    flash: prefs.flash,
    badge,
    why: "",
  };
}

/** The memory after a notification went out: when it went, and which things it told. Old entries fall away. */
function remember(memory, notify, now) {
  const sent = (Array.isArray(memory?.sent) ? memory.sent : []).filter((at) => now - Number(at) < HOUR_MS && now - Number(at) >= 0);
  const recent = {};
  for (const [key, at] of Object.entries(object(memory?.recent) ? memory.recent : {})) if (now - Number(at) < DEDUPE_MS && now - Number(at) >= 0) recent[key] = Number(at);
  if (object(notify) && notify.kind !== "test") {
    sent.push(now);
    for (const id of Array.isArray(notify.ids) ? notify.ids : []) recent[`${notify.kind}:${id}`] = now;
  }
  // Bounded: a long busy day never grows it past a few hundred entries.
  const keys = Object.keys(recent);
  if (keys.length > 400) for (const key of keys.sort((a, b) => recent[a] - recent[b]).slice(0, keys.length - 400)) delete recent[key];
  return { sent: sent.slice(-PER_HOUR * 4), recent };
}

/**
 * Pending things split into those that have waited long enough (SETTLE_MS) and
 * how long until the next one has. Once one thing is ready, anything that would
 * be ready within GRACE_MS goes with it, so a burst of questions is one
 * notification. `pending` is [{ at, ... }], in any order.
 */
function settle(pending, now, settleMs = SETTLE_MS, graceMs = GRACE_MS) {
  const items = Array.isArray(pending) ? pending : [];
  const ripe = items.some((item) => now - Number(item.at) >= settleMs);
  const cut = ripe ? Math.max(0, settleMs - graceMs) : settleMs;
  const due = [], waiting = [];
  for (const item of items) (now - Number(item.at) >= cut ? due : waiting).push(item);
  const next = waiting.length ? Math.max(0, Math.min(...waiting.map((item) => Number(item.at) + settleMs)) - now) : null;
  return { due, waiting, next };
}

/** Due things grouped by kind, most urgent first: a question before a permission before a failure before a finished task. */
function groups(items) {
  const byKind = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!object(item) || !["need", "perm", "fail", "done"].includes(item.kind)) continue;
    if (!byKind.has(item.kind)) byKind.set(item.kind, []);
    byKind.get(item.kind).push(item);
  }
  return ["need", "perm", "fail", "done"].filter((kind) => byKind.has(kind)).map((kind) => ({ kind, items: byKind.get(kind) }));
}

/** What `alerts:get` answers: the choices, the quiet hours, what is in force and how much of the hour is used. */
function view({ prefs, quiet, killed = false, supported = true, waiting = 0, sent = [], now = 0, platform = "" } = {}) {
  const inHour = (Array.isArray(sent) ? sent : []).filter((at) => now - Number(at) < HOUR_MS && now - Number(at) >= 0).length;
  return {
    ok: true,
    prefs: normalizePrefs(prefs),
    quiet: quietView(quiet),
    killed: killed === true,
    supported: supported !== false,
    platform: String(platform || ""),
    waiting: count(waiting),
    hour: { sent: inHour, max: PER_HOUR },
  };
}

module.exports = {
  HOUR_MS, PER_HOUR, DEDUPE_MS, SETTLE_MS, GRACE_MS, BADGE_MAX, KINDS, FLAGS, DEFAULTS, QUIET_DEFAULT, GENERIC,
  normalizePrefs, applyPatch, normalizeQuiet, quietView, quietPatch, quietNow, clockLabel,
  kindOfQuestion, kindOfTaskEvent, textsFor, badgeFor, decide, remember, settle, groups, view,
};
