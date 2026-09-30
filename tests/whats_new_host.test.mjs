// The host side of What's new: main.cjs's "What's new" block and its three
// app-wide channels, sliced out of main.cjs and run against stubs
// (tests/fixtures/whats-new-host.mjs), with the real rules
// (scripts/whats-new.cjs) and a real notes file. It pins the owner's
// conditions where the setting lives: a fresh install is sealed as read and
// stays silent, an update speaks until it was announced, a read is remembered
// and never moves backwards, and both the kill switch and the setting silence
// it without hiding the notes.
//
// Run: node --test tests/whats_new_host.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { NOTES, block, handlers, launch, main } from "./fixtures/whats-new-host.mjs";

const preload = readFileSync(new URL("../preload.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the block registers three channels, all app-wide, and the bridge names exactly those", () => {
  const found = [...handlers.matchAll(/ipcMain\.handle\("(release:whats-new[a-z-]*)"/g)].map((match) => match[1]);
  assert.deepEqual(found, ["release:whats-new", "release:whats-new-seen", "release:whats-new-set"]);
  const appWide = main.match(/const APP_WIDE_CHANNELS = new Set\(\[([^\]]*)\]\)/)[1];
  for (const channel of found) assert.match(appWide, new RegExp(`"${channel}"`), `${channel} answers through a project switch`);
  for (const channel of found) assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\("${channel}"`), `${channel} has a bridge entry`);
  assert.match(preload, /releaseWhatsNewSeen: \(payload\) => ipcRenderer\.invoke\("release:whats-new-seen", \{ version: gitText\(payload\?\.version, 40\), how: payload\?\.how === "announce" \? "announce" : "read" \}\)/, "the bridge sends a version and one of two words");
  assert.doesNotMatch(block, /\b(?:fetch|https?:|spawn|exec)\b\(/, "reading the notes never reaches the network or a process");
});

test("a fresh install (no settings.json at launch) is sealed as read and says nothing, now or at the second launch", async (t) => {
  const first = launch(t, { existed: false });
  const view = await first.call("release:whats-new");
  assert.equal(view.ok, true);
  assert.equal(view.show, false, "a first install says nothing");
  assert.equal(view.lastSeen, "0.5.0", "its version counts as read");
  assert.deepEqual(first.state.settings.whatsNew, { on: true, seen: "0.5.0", announced: null });
  const second = launch(t, { existed: true, settings: first.state.settings });
  assert.equal((await second.call("release:whats-new")).show, false, "the second launch is not mistaken for an update");
  assert.equal(second.state.writes, 0);
});

test("an update speaks until it was announced; announcing and reading are remembered", async (t) => {
  // Updated by hand from a build that never recorded anything: settings exist, whatsNew does not.
  const a = launch(t, { settings: { projects: [] } });
  const view = await a.call("release:whats-new");
  assert.equal(view.show, true);
  assert.deepEqual(view.notes, NOTES["0.5.0"]);
  assert.equal(view.lastSeen, null);
  assert.equal(a.state.writes, 0, "asking writes nothing");

  const said = await a.call("release:whats-new-seen", { version: "0.5.0", how: "announce" });
  assert.equal(said.show, false, "the toast is said once");
  assert.equal(said.newer, true, "the notes are still unread");
  assert.equal(a.state.settings.whatsNew.announced, "0.5.0");

  const later = launch(t, { settings: a.state.settings });
  assert.equal((await later.call("release:whats-new")).show, false, "and not again at the next launch");

  const read = await later.call("release:whats-new-seen", { version: "0.5.0", how: "read" });
  assert.equal(read.lastSeen, "0.5.0");
  assert.equal(read.newer, false);
  assert.equal(later.state.settings.whatsNew.seen, "0.5.0");
  assert.deepEqual(read.history.map((row) => [row.version, row.current, row.unread]), [["0.5.0", true, false], ["0.4.4", false, false]]);
});

test("a version this build has not reached, or that is not a version, is refused; a roll back stays silent", async (t) => {
  const h = launch(t, { version: "0.5.0" });
  for (const version of ["0.5.1", "9.9.9", "banana", "", null]) {
    const answer = await h.call("release:whats-new-seen", { version, how: "read" });
    assert.equal(answer.ok, false, String(version));
  }
  assert.equal(h.state.writes, 0, "nothing was written for any of them");
  const rolledBack = launch(t, { version: "0.4.4", settings: { whatsNew: { on: true, seen: "0.5.0", announced: "0.5.0" } } });
  const view = await rolledBack.call("release:whats-new");
  assert.equal(view.show, false, "going back to 0.4.4 does not announce it");
  assert.equal(view.lastSeen, "0.5.0");
});

test("the kill switch and the setting both silence it and say why, and the notes stay readable", async (t) => {
  const killed = launch(t, { env: { MEFI_STUDIO_NO_WHATS_NEW: "1" } });
  const view = await killed.call("release:whats-new");
  assert.equal(view.show, false);
  assert.equal(view.disabled, "env");
  assert.deepEqual(view.notes, NOTES["0.5.0"], "Settings › Updates can still list them");
  const freshKilled = launch(t, { existed: false, env: { MEFI_STUDIO_NO_WHATS_NEW: "1" } });
  await freshKilled.call("release:whats-new");
  assert.equal(freshKilled.state.writes, 0, "with the kill switch on, the host writes nothing at all");

  const h = launch(t);
  const off = await h.call("release:whats-new-set", { on: false });
  assert.equal(off.enabled, false);
  assert.equal(off.disabled, "setting");
  assert.equal(off.show, false);
  assert.equal(h.state.settings.whatsNew.on, false);
  assert.equal((await h.call("release:whats-new-set", { on: true })).show, true, "switched back on, an unread update speaks again");
  assert.equal((await h.call("release:whats-new-set", { on: "yes" })).ok, false, "the switch is on or off");
  assert.equal((await launch(t, { mode: { smoke: true } }).call("release:whats-new")).show, false, "harness windows never announce");
});

test("a missing or torn notes file is an empty table, never an error", async (t) => {
  const none = launch(t, { file: false });
  const view = await none.call("release:whats-new");
  assert.equal(view.ok, true);
  assert.equal(view.show, false);
  assert.deepEqual(view.history, []);
  const torn = launch(t);
  writeFileSync(path.join(torn.dir, "assets", "whats-new.json"), "{ broken");
  assert.deepEqual((await torn.call("release:whats-new")).history, []);
  const unavailable = launch(t);
  vm.runInContext("whatsNew = null", unavailable.context);
  assert.deepEqual(await unavailable.call("release:whats-new"), { ok: false, error: "unavailable" });
});
