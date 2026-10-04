// The host side of Search's two switches (main.cjs "Search switches" and the
// prefs:get channel that carries them). Search (renderer/palette.js) has two
// extras nobody asked for: Recent, when the box is empty, and "task …" /
// "idea …" adding a card on Enter. Each is on unless settings.ui says
// searchRecents / searchQuickCreate false, or the run's environment says
// MEFI_STUDIO_NO_SEARCH_RECENTS=1 / MEFI_STUDIO_NO_QUICK_CREATE=1. The page
// treats anything but an explicit false as on, so what is pinned here is
// exactly when prefs:get says false.
//
// Run: node --test tests/search_switches_host.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = main.indexOf(start);
  const to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return main.slice(from, to);
};
const plain = (value) => JSON.parse(JSON.stringify(value));

const SWITCHES = section("// ---- Search switches", "// ---- end of Search switches ----");
const PREFS_GET = section('  ipcMain.handle("prefs:get"', '  ipcMain.handle("prefs:set"');

// prefs:get as main registers it, over a settings file that holds `ui` and an
// environment that holds `env`. `withSwitches: false` leaves the block out, the
// way the other tests that slice this handler on its own do.
function prefsGet({ env = {}, ui = {}, withSwitches = true } = {}) {
  const handlers = new Map();
  const context = vm.createContext({
    process: { env: { ...env } },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    readSettings: async () => ({ ui: { ...ui } }),
    loginItemState: () => ({ supported: true, on: true, blocked: false }),
  });
  if (withSwitches) vm.runInContext(SWITCHES, context, { filename: "main.cjs:search-switches" });
  vm.runInContext(PREFS_GET, context, { filename: "main.cjs:prefs-get" });
  return async () => plain(await handlers.get("prefs:get")({}));
}

test("Recent and quick add are on unless something says otherwise: prefs:get never says false", async () => {
  const { ok, prefs } = await prefsGet()();
  assert.equal(ok, true);
  assert.notEqual(prefs.searchRecents, false);
  assert.notEqual(prefs.searchQuickCreate, false);
});

test("MEFI_STUDIO_NO_SEARCH_RECENTS=1 turns Recent off for the run and touches nothing else", async () => {
  const { prefs } = await prefsGet({ env: { MEFI_STUDIO_NO_SEARCH_RECENTS: "1" } })();
  assert.equal(prefs.searchRecents, false);
  assert.notEqual(prefs.searchQuickCreate, false, "quick add stays on");
});

test("MEFI_STUDIO_NO_QUICK_CREATE=1 turns quick add off for the run and touches nothing else", async () => {
  const { prefs } = await prefsGet({ env: { MEFI_STUDIO_NO_QUICK_CREATE: "1" } })();
  assert.equal(prefs.searchQuickCreate, false);
  assert.notEqual(prefs.searchRecents, false, "Recent stays on");
});

test("both variables together turn both off", async () => {
  const { prefs } = await prefsGet({ env: { MEFI_STUDIO_NO_SEARCH_RECENTS: "1", MEFI_STUDIO_NO_QUICK_CREATE: "1" } })();
  assert.equal(prefs.searchRecents, false);
  assert.equal(prefs.searchQuickCreate, false);
});

test("only the value 1 switches anything off: 0 and an empty variable leave both on", async () => {
  for (const value of ["0", ""]) {
    const { prefs } = await prefsGet({ env: { MEFI_STUDIO_NO_SEARCH_RECENTS: value, MEFI_STUDIO_NO_QUICK_CREATE: value } })();
    assert.notEqual(prefs.searchRecents, false, JSON.stringify(value));
    assert.notEqual(prefs.searchQuickCreate, false, JSON.stringify(value));
  }
});

test("the settings say it too: settings.ui.searchRecents and searchQuickCreate false come through, each on its own", async () => {
  const recents = (await prefsGet({ ui: { searchRecents: false } })()).prefs;
  assert.equal(recents.searchRecents, false);
  assert.notEqual(recents.searchQuickCreate, false);
  const create = (await prefsGet({ ui: { searchQuickCreate: false } })()).prefs;
  assert.equal(create.searchQuickCreate, false);
  assert.notEqual(create.searchRecents, false);
  const on = (await prefsGet({ ui: { searchRecents: true, searchQuickCreate: true } })()).prefs;
  assert.equal(on.searchRecents, true);
  assert.equal(on.searchQuickCreate, true);
});

test("the environment has the last word: a setting of true cannot turn back on what the run switched off", async () => {
  const { prefs } = await prefsGet({ ui: { searchRecents: true, searchQuickCreate: true }, env: { MEFI_STUDIO_NO_SEARCH_RECENTS: "1", MEFI_STUDIO_NO_QUICK_CREATE: "1" } })();
  assert.equal(prefs.searchRecents, false);
  assert.equal(prefs.searchQuickCreate, false);
});

test("every other preference comes through as before, and the handler still answers where the block is absent", async () => {
  const withBlock = (await prefsGet({ ui: { blurMenu: false, launchAgents: "start" }, env: { MEFI_STUDIO_NO_QUICK_CREATE: "1" } })());
  assert.equal(withBlock.prefs.blurMenu, false, "a saved choice still beats the default");
  assert.equal(withBlock.prefs.useTree, true, "a default still shows");
  assert.equal(withBlock.prefs.launchAgents, "start");
  assert.equal(withBlock.prefs.openAtLogin, true);
  assert.deepEqual(withBlock.loginItem, { supported: true, on: true, blocked: false });
  const without = await prefsGet({ ui: { launchAgents: "start" }, env: { MEFI_STUDIO_NO_QUICK_CREATE: "1" }, withSwitches: false })();
  assert.equal(without.ok, true);
  assert.equal(without.prefs.launchAgents, "start");
  assert.equal(Object.hasOwn(without.prefs, "searchQuickCreate"), false, "no block, no switches: the page's own default (on) applies");
});
