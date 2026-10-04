// Mefi's Studio AI+ — "What's new", the rules the host and the packager share.
//
// Each release carries assets/whats-new.json: { "<version>": ["plain sentence",
// ...] }, written at package time by scripts/release-notes.mjs from the
// CHANGELOG's version sections. This module reads that table the same way for
// everyone: the version comparison, what a table may hold, what the person
// still has to read, and the one rule for when Studio says so. main.cjs's
// "What's new" block owns the file read and the setting; the renderer only
// draws what `view` answers.
//
// The rule, in the owner's words: after an update installs, one quiet toast;
// never a modal at launch; never on a first install; the notes stay in
// Settings › Updates either way. A build older than the one already read (a
// roll back) says nothing, and a first install is sealed as read so its
// second launch is not mistaken for an update.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

// How much one version may say, and how many versions the table keeps. The
// packager and the reader both enforce them, so a hand-edited file cannot
// turn a toast into a wall of text.
const NOTE_CAP = 6;
const VERSION_CAP = 5;
const SENTENCE_MAX = 200;
// Settings › Updates lists this many of the versions up to the running one.
const HISTORY_SHOWN = 3;

const VERSION = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,5})(?:-([0-9A-Za-z.-]{1,30}))?$/;

/** [major, minor, patch, pre] for "0.5.0" or "v0.5.0-rc.1", else null. */
function parseVersion(value) {
  const match = VERSION.exec(String(value ?? "").trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null] : null;
}

/** The version as written in the table: no leading v. Null when it is not one. */
function cleanVersion(value) {
  const parsed = parseVersion(value);
  return parsed ? `${parsed[0]}.${parsed[1]}.${parsed[2]}${parsed[3] ? `-${parsed[3]}` : ""}` : null;
}

/** Negative when a is older than b. A pre-release is older than its release; anything unreadable is oldest. */
function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) return left ? 1 : right ? -1 : 0;
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  if (left[3] === right[3]) return 0;
  if (!left[3]) return 1;
  if (!right[3]) return -1;
  return left[3] < right[3] ? -1 : 1;
}

const oneLine = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const clip = (value, max = SENTENCE_MAX) => {
  const text = oneLine(value);
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text;
};

/**
 * What a table may hold: version -> up to NOTE_CAP sentences, at most
 * VERSION_CAP versions (the newest), each sentence one plain line. Anything
 * else in a hand-edited or torn file is left out, never thrown.
 */
function normalizeTable(raw) {
  const rows = [];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, list] of Object.entries(raw)) {
      const version = cleanVersion(key);
      if (!version || !Array.isArray(list)) continue;
      const notes = [...new Set(list.filter((line) => typeof line === "string").map((line) => clip(line)).filter(Boolean))].slice(0, NOTE_CAP);
      if (notes.length) rows.push([version, notes]);
    }
  }
  rows.sort((a, b) => compareVersions(b[0], a[0]));
  return Object.fromEntries(rows.slice(0, VERSION_CAP));
}

/** The table's versions, newest first. */
const versionsOf = (table) => Object.keys(table ?? {}).sort((a, b) => compareVersions(b, a));

/**
 * settings.whatsNew as the host keeps it: `on` (the switch, on unless the
 * owner turned it off), `seen` (the newest version the owner has read) and
 * `announced` (the version Studio has already said something about, so a
 * missed toast is not repeated at every launch).
 */
function settingsFrom(raw) {
  const saved = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return { on: saved.on !== false, seen: cleanVersion(saved.seen), announced: cleanVersion(saved.announced) };
}

/**
 * What the renderer is told: the running version's notes, what has been read,
 * and `show`, the one rule for the toast: switched on, notes for this very
 * version, this version newer than the one read (nothing read counts as
 * older) and not announced before. `history` is the versions up to this one,
 * newest first, for Settings › Updates. `disabled` names why the whole thing
 * is off (the kill switch or the setting), so the card can say so.
 */
function view({ table, current, settings, killed = false } = {}) {
  const notes = normalizeTable(table);
  const running = cleanVersion(current);
  const saved = settingsFrom(settings);
  const disabled = killed ? "env" : saved.on ? null : "setting";
  const own = running ? notes[running] ?? [] : [];
  const newer = Boolean(running) && (!saved.seen || compareVersions(running, saved.seen) > 0);
  return {
    enabled: !disabled,
    disabled,
    current: running,
    notes: own,
    lastSeen: saved.seen,
    announced: saved.announced,
    newer,
    show: !disabled && own.length > 0 && newer && saved.announced !== running,
    history: running ? versionsOf(notes).filter((version) => compareVersions(version, running) <= 0).slice(0, HISTORY_SHOWN).map((version) => ({ version, notes: notes[version], current: version === running, unread: !saved.seen || compareVersions(version, saved.seen) > 0 })) : [],
  };
}

/**
 * The settings after a first launch of a fresh install (no settings file
 * existed): the running version counts as read, so the second launch is not
 * taken for an update. Null when there is nothing to write.
 */
function sealFirstInstall({ settings, current }) {
  const saved = settingsFrom(settings);
  const running = cleanVersion(current);
  return running && !saved.seen ? { ...saved, seen: running } : null;
}

/**
 * The settings after the owner read a version, or after Studio announced it.
 * `read` never moves `seen` backwards (a roll back and a second update do not
 * show the same notes twice); `announce` only records the toast.
 */
function markVersion({ settings, version, how = "read" }) {
  const saved = settingsFrom(settings);
  const wanted = cleanVersion(version);
  if (!wanted) return null;
  if (how === "announce") return saved.announced === wanted ? null : { ...saved, announced: wanted };
  const seen = saved.seen && compareVersions(saved.seen, wanted) >= 0 ? saved.seen : wanted;
  return seen === saved.seen && saved.announced === wanted ? null : { ...saved, seen, announced: wanted };
}

module.exports = {
  NOTE_CAP, VERSION_CAP, SENTENCE_MAX, HISTORY_SHOWN,
  parseVersion, cleanVersion, compareVersions, clip, normalizeTable, versionsOf, settingsFrom, view, sealFirstInstall, markVersion,
};
