// What's new, the rules (scripts/whats-new.cjs): which version is newer, what a
// table may hold, and the one rule for when Studio speaks after an update. The
// owner's three conditions are pinned here as a story a first install, an
// update and a roll back each walk through: never on a first install, one
// toast per version, and "Got it" is remembered.
//
// Run: node --test tests/whats_new.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const notes = require("../scripts/whats-new.cjs");

const TABLE = {
  "0.4.4": ["Setup is one sign-in.", "Every theme is free."],
  "0.5.0": ["One calm shell.", "Windows notifications when something needs you."],
  "0.5.1": ["Search remembers your last picks."],
};

test("versions compare by number, not by text, and a release is newer than its pre-release", () => {
  assert.deepEqual(notes.parseVersion("v0.5.0"), [0, 5, 0, null]);
  assert.equal(notes.cleanVersion("v0.10.2"), "0.10.2");
  assert.equal(notes.cleanVersion("0.5"), null);
  assert.equal(notes.cleanVersion("latest"), null);
  assert.ok(notes.compareVersions("0.10.0", "0.9.9") > 0, "0.10.0 is newer than 0.9.9 although it sorts first as text");
  assert.ok(notes.compareVersions("0.5.0-rc.1", "0.5.0") < 0);
  assert.equal(notes.compareVersions("0.5.0", "v0.5.0"), 0);
  assert.ok(notes.compareVersions(null, "0.1.0") < 0, "anything unreadable is oldest");
});

test("a table keeps the newest versions, a few plain sentences each, and drops what is not one", () => {
  const messy = {
    "0.3.0": ["a"], "0.4.0": ["b"], "0.5.0": ["c"], "0.6.0": ["d"], "0.7.0": ["e"], "0.8.0": ["f"],
    "v0.9.0": ["  one   line\nof text  ", "one line of text", "", 7, null, "x".repeat(400), "3", "4", "5", "6", "7"],
    "not a version": ["nope"], "1.0.0": "not a list", "1.1.0": [],
  };
  const table = notes.normalizeTable(messy);
  assert.deepEqual(Object.keys(table), ["0.9.0", "0.8.0", "0.7.0", "0.6.0", "0.5.0"], `${notes.VERSION_CAP} versions, newest first`);
  assert.equal(table["0.9.0"].length, notes.NOTE_CAP, "at most a few sentences a version");
  assert.equal(table["0.9.0"][0], "one line of text", "one line, and no repeats");
  assert.ok(table["0.9.0"].every((line) => line.length <= notes.SENTENCE_MAX), "each sentence is bounded");
  assert.deepEqual(notes.normalizeTable(null), {});
  assert.deepEqual(notes.normalizeTable([1, 2]), {});
  assert.deepEqual(notes.normalizeTable("nonsense"), {});
});

test("the setting keeps a switch, the version read and the version announced, and nothing else", () => {
  assert.deepEqual(notes.settingsFrom(undefined), { on: true, seen: null, announced: null });
  assert.deepEqual(notes.settingsFrom({ on: false, seen: "v0.5.0", announced: "junk", extra: 1 }), { on: false, seen: "0.5.0", announced: null });
  assert.deepEqual(notes.settingsFrom([1]), { on: true, seen: null, announced: null });
});

test("the story: a first install is silent, an update speaks once, and Got it is remembered", () => {
  // Day one: a fresh install of 0.4.4 is sealed as read, whatever the table holds.
  let settings = notes.sealFirstInstall({ settings: undefined, current: "0.4.4" });
  assert.deepEqual(settings, { on: true, seen: "0.4.4", announced: null });
  assert.equal(notes.view({ table: TABLE, current: "0.4.4", settings }).show, false, "a first install says nothing");
  assert.equal(notes.sealFirstInstall({ settings, current: "0.4.4" }), null, "and sealing it again writes nothing");

  // The update to 0.5.0 installs: notes exist, it is newer than what was read, nothing was announced.
  let view = notes.view({ table: TABLE, current: "0.5.0", settings });
  assert.equal(view.show, true, "an update with notes speaks");
  assert.deepEqual(view.notes, TABLE["0.5.0"]);
  assert.equal(view.lastSeen, "0.4.4");
  assert.equal(view.newer, true);

  // The toast was shown: it is not repeated at the next launch, but the notes are still unread.
  settings = notes.markVersion({ settings, version: "0.5.0", how: "announce" });
  view = notes.view({ table: TABLE, current: "0.5.0", settings });
  assert.equal(view.show, false, "one toast per version");
  assert.equal(view.newer, true, "yet the notes are still unread");
  assert.equal(view.history[0].unread, true, "so Settings › Updates marks them New");

  // Got it: read, remembered.
  settings = notes.markVersion({ settings, version: "0.5.0", how: "read" });
  view = notes.view({ table: TABLE, current: "0.5.0", settings });
  assert.equal(view.lastSeen, "0.5.0");
  assert.equal(view.newer, false);
  assert.equal(view.history[0].unread, false);
  assert.equal(notes.markVersion({ settings, version: "0.5.0", how: "read" }), null, "reading it again changes nothing");
});

test("an update from a build that never recorded anything still speaks; a roll back and a version with no notes do not", () => {
  const upgrade = notes.view({ table: TABLE, current: "0.5.0", settings: undefined });
  assert.equal(upgrade.lastSeen, null);
  assert.equal(upgrade.show, true, "nothing read counts as older (the 0.4.4 install that updates by hand)");

  const read = { on: true, seen: "0.5.1", announced: "0.5.1" };
  assert.equal(notes.view({ table: TABLE, current: "0.5.0", settings: read }).show, false, "a roll back to 0.5.0 says nothing about it");
  assert.equal(notes.view({ table: TABLE, current: "0.5.0", settings: read }).newer, false);
  assert.equal(notes.view({ table: TABLE, current: "0.4.5", settings: undefined }).show, false, "a version with no notes has nothing to say");
  assert.equal(notes.view({ table: TABLE, current: "0.4.5", settings: undefined }).notes.length, 0);
  assert.equal(notes.view({ table: TABLE, current: "unknown", settings: undefined }).show, false);
  assert.deepEqual(notes.view({ table: TABLE, current: "unknown", settings: undefined }).history, []);
  assert.equal(notes.view({ table: {}, current: "0.5.0", settings: undefined }).show, false, "an empty table is silent");
});

test("reading never moves backwards: a roll back and a second update do not show the same notes twice", () => {
  let settings = { on: true, seen: "0.5.1", announced: "0.5.1" };
  settings = notes.markVersion({ settings, version: "0.5.0", how: "read" });
  assert.equal(notes.settingsFrom(settings).seen, "0.5.1", "0.5.0 read late does not undo having read 0.5.1");
  assert.equal(notes.view({ table: TABLE, current: "0.5.1", settings }).show, false);
  assert.equal(notes.markVersion({ settings, version: "banana", how: "read" }), null, "a version that is not one is refused");
});

test("the switch and the kill switch both silence it, and say why", () => {
  const off = notes.view({ table: TABLE, current: "0.5.0", settings: { on: false } });
  assert.equal(off.show, false);
  assert.equal(off.enabled, false);
  assert.equal(off.disabled, "setting");
  const killed = notes.view({ table: TABLE, current: "0.5.0", settings: undefined, killed: true });
  assert.equal(killed.show, false);
  assert.equal(killed.disabled, "env");
  assert.deepEqual(killed.notes, TABLE["0.5.0"], "the notes stay readable in Settings › Updates");
  const on = notes.view({ table: TABLE, current: "0.5.0", settings: undefined });
  assert.equal(on.enabled, true);
  assert.equal(on.disabled, null);
});

test("Settings › Updates lists the versions up to this one, newest first, a few of them", () => {
  const view = notes.view({ table: { ...TABLE, "0.3.0": ["Older."], "0.2.0": ["Oldest."] }, current: "0.5.0", settings: { seen: "0.4.4" } });
  assert.deepEqual(view.history.map((row) => row.version), ["0.5.0", "0.4.4", "0.3.0"], "a version newer than this build is not shown, and only a few are");
  assert.deepEqual(view.history.map((row) => row.current), [true, false, false]);
  assert.deepEqual(view.history.map((row) => row.unread), [true, false, false]);
});
