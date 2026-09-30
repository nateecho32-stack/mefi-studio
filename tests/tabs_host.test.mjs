// How the tab strip (renderer/tabs.js) joins the rest of the app, and what it must never do: the one switch the host
// owns (main.cjs "Tab switches" and the prefs:get channel that carries it), nav.js's saveResume, Configuration's
// UI & Surfaces pane, where the build puts the script, the keys it claims against what the app already binds, and the
// static promises of the two new files (no innerHTML, no host calls but one, nothing under 12px, no scroller gutters,
// theme tokens only).
//
// Run: node --test tests/tabs_host.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, readdirSync } from "node:fs";

import { createDom, templateIds } from "./fixtures/renderer-dom.mjs";
import { tabsEnv } from "./fixtures/tabs-env.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const main = read("main.cjs");
const nav = read("renderer/nav.js");
const tabsJs = read("renderer/tabs.js");
const tabsCss = read("renderer/tabs.css");
const plain = (value) => JSON.parse(JSON.stringify(value));
const section = (start, end, text = main) => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `section exists: ${start}`);
  return text.slice(from, to);
};

// ---- the host's switch ---------------------------------------------------------------------------------------------------------
const SWITCHES = section("// ---- Tab switches", "// ---- end of Tab switches ----");
const SEARCH_SWITCHES = section("// ---- Search switches", "// ---- end of Search switches ----");
const PREFS_GET = section('  ipcMain.handle("prefs:get"', '  ipcMain.handle("prefs:set"');

// prefs:get as main registers it, over a settings file that holds `ui` and an environment that holds `env`.
function prefsGet({ env = {}, ui = {}, withSwitches = true } = {}) {
  const handlers = new Map();
  const context = vm.createContext({
    process: { env: { ...env } },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    readSettings: async () => ({ ui: { ...ui } }),
    loginItemState: () => ({ supported: true, on: true, blocked: false }),
  });
  if (withSwitches) {
    vm.runInContext(SEARCH_SWITCHES, context, { filename: "main.cjs:search-switches" });
    vm.runInContext(SWITCHES, context, { filename: "main.cjs:tab-switches" });
  }
  vm.runInContext(PREFS_GET, context, { filename: "main.cjs:prefs-get" });
  return async () => plain(await handlers.get("prefs:get")({}));
}

test("tab management is on unless something says otherwise: prefs:get never says tabsManage is false", async () => {
  const { ok, prefs } = await prefsGet()();
  assert.equal(ok, true);
  assert.notEqual(prefs.tabsManage, false);
});

test("MEFI_STUDIO_NO_TAB_MANAGER=1 turns tab management off for the run, and only the value 1 does", async () => {
  assert.equal((await prefsGet({ env: { MEFI_STUDIO_NO_TAB_MANAGER: "1" } })()).prefs.tabsManage, false);
  for (const value of ["0", "", "true", "yes", " 1"]) {
    assert.notEqual((await prefsGet({ env: { MEFI_STUDIO_NO_TAB_MANAGER: value } })()).prefs.tabsManage, false, JSON.stringify(value));
  }
});

test("the settings cannot turn back on what the run switched off; Search's own switches and every other preference are left as they were", async () => {
  const off = await prefsGet({ ui: { tabsManage: true, blurMenu: false, launchAgents: "start" }, env: { MEFI_STUDIO_NO_TAB_MANAGER: "1", MEFI_STUDIO_NO_QUICK_CREATE: "1" } })();
  assert.equal(off.prefs.tabsManage, false, "the environment has the last word");
  assert.equal(off.prefs.searchQuickCreate, false, "Search's switch still works beside it");
  assert.notEqual(off.prefs.searchRecents, false);
  assert.equal(off.prefs.blurMenu, false);
  assert.equal(off.prefs.launchAgents, "start");
  assert.equal(off.prefs.useTree, true, "a default still shows");
  assert.equal(off.prefs.openAtLogin, true);
  assert.deepEqual(off.loginItem, { supported: true, on: true, blocked: false });
});

test("prefs:get still answers where the block is absent (the tests that run the handler on its own)", async () => {
  const without = await prefsGet({ env: { MEFI_STUDIO_NO_TAB_MANAGER: "1" }, withSwitches: false })();
  assert.equal(without.ok, true);
  assert.equal(Object.hasOwn(without.prefs, "tabsManage"), false, "no block, no switch: the strip's own default (on) applies");
});

test("the strip reads exactly what the host sends: the real handler's answer switches the real strip's management off", async () => {
  const run = async (env) => {
    const ask = prefsGet({ env });
    const t = await tabsEnv({ host: { prefsGet: ask } });
    await t.settle();
    return t;
  };
  const off = await run({ MEFI_STUDIO_NO_TAB_MANAGER: "1" });
  assert.equal(off.tabs.prefs().forcedOff, true);
  await off.go("fleet"); await off.go("plans");
  assert.equal(off.tabs.list().some((tab) => tab.prev), false, "and it does: no preview tab for this run");
  const on = await run({});
  assert.equal(on.tabs.prefs().forcedOff, false);
  await on.go("fleet"); await on.go("plans");
  assert.equal(on.tabs.list().filter((tab) => tab.prev).length, 1);
});

test("the Tab switches block is a plain, marked, guarded block and main.cjs reads nothing else about tabs", () => {
  assert.match(SWITCHES, /function tabSwitchesOff\(\)/);
  assert.match(PREFS_GET, /typeof tabSwitchesOff === "function"/, "guarded, as Search's is");
  assert.equal([...main.matchAll(/MEFI_STUDIO_NO_TAB_MANAGER/g)].length, 2, "named in the block and in its comment, and nowhere else");
  assert.equal(/mefiStudio\.tabs/.test(main.replace(SWITCHES, "")), false, "the host never reads or writes the strip's storage (its comment names the key)");
});

// ---- saveResume -------------------------------------------------------------------------------------------------------------------
const SAVE_RESUME = section("  function saveResume() {", "  // Fields, scroll positions and the focus", nav);

function resume({ tabs, extras = {} } = {}) {
  const store = new Map();
  const window = { ...(tabs === undefined ? {} : { MefiTabs: tabs }), ...extras };
  const document = { querySelectorAll: () => [], activeElement: null, body: {} };
  const context = vm.createContext({
    window, document, Date, FIELD_SELECTOR: "input, textarea", RESUME_KEY: "mefiStudio.resume",
    state: { sheet: null }, readStore: () => null,
    localStorage: { setItem: (key, value) => store.set(key, value), getItem: (key) => store.get(key) ?? null },
  });
  vm.runInContext(`${SAVE_RESUME}\nthis.saveResume = saveResume;`, context, { filename: "nav.js:saveResume" });
  return { save: () => plain(context.saveResume()), store };
}

test("saveResume carries the strip's state: it is asked to write what is pending, and says where it was", () => {
  let asked = 0;
  const where = { v: 1, project: "p1", active: "t3", count: 4 };
  const { save, store } = resume({ tabs: { saveState: () => { asked += 1; return where; } } });
  const payload = save();
  assert.equal(asked, 1, "once per save");
  assert.deepEqual(payload.tabs, where);
  assert.deepEqual(JSON.parse(store.get("mefiStudio.resume")).tabs, where, "and it is in the stored payload, so a reload has it");
});

test("saveResume without a strip (v1, or the strip not running) carries nothing for it and still saves everything else", () => {
  for (const tabs of [undefined, {}, { saveState: () => null }]) {
    const { save, store } = resume({ tabs });
    const payload = save();
    assert.equal(payload.tabs, null, JSON.stringify(Object.keys(tabs ?? {})));
    assert.equal(payload.sheet, null);
    assert.ok(payload.at > 0);
    assert.ok(store.has("mefiStudio.resume"));
  }
});

// ---- Configuration ----------------------------------------------------------------------------------------------------------------
const configSource = read("renderer/config-dialog.js");
const RECORDS = [{ id: "settings:diagnostics", label: "Settings › System › Diagnostics", desc: "Save a report", kind: "action", run() {} }]; // so a second category exists
async function configPane({ tabs, category = "ui" } = {}) {
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("config-")) });
  get("config-overlay").hidden = true;
  const window = { mefiStudio: { uiZoom: async ({ factor }) => ({ ok: true, factor }), uiZoomGet: async () => ({ ok: true, factor: 1 }), onUiZoom: () => {} }, MefiNav: { list: () => RECORDS }, MefiToast: () => {}, ...(tabs === undefined ? {} : { MefiTabs: tabs }) };
  vm.runInContext(configSource, vm.createContext({ window, document, console, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {} }));
  await window.MefiConfig.open({ category });
  for (let turn = 0; turn < 6; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  return get("config-pane");
}
const fakeCard = () => { const card = createDom().document.createElement("section"); card.className = "ts-card"; return card; };

test("Configuration › UI & Surfaces shows the Tab behaviour card after the interface scale, and only there", async () => {
  const card = fakeCard();
  const pane = await configPane({ tabs: { configCard: () => card } });
  const kids = pane.children.map((child) => child.className);
  assert.ok(kids.includes("ts-card"), "the card is in the pane");
  assert.ok(kids.indexOf("ts-card") > 0, "after the pane's own heading and the scale control");
  assert.equal(pane.children.at(-1), card, "as the last thing in it");
  const other = await configPane({ tabs: { configCard: () => card }, category: "dev" });
  assert.equal(other.querySelector(".config-item-title")?.textContent, "Diagnostics", "that really is another category");
  assert.equal(other.children.some((child) => child.className === "ts-card"), false, "no other category gets it");
});

test("with no strip (v1, no shell, stopped) Configuration is exactly what it was", async () => {
  const baseline = (await configPane({})).children.map((child) => child.className);
  for (const tabs of [{ configCard: () => null }, {}, { configCard: () => undefined }]) {
    const pane = await configPane({ tabs });
    assert.deepEqual(pane.children.map((child) => child.className), baseline);
  }
});

// ---- the build ----------------------------------------------------------------------------------------------------------------------
test("tabs.js is built in after idle and before the last script, with its stylesheet in the styles join", () => {
  const build = read("scripts/build-booklet.mjs");
  const sources = [...section("const CODE_SOURCES = [", "];", build).matchAll(/"([^"]+\.js)"/g)].map((match) => match[1]);
  assert.ok(sources.indexOf("tabs.js") > sources.indexOf("idle.js"), "after idle: tools/test_mefi_studio_updater.py pins the prefix up to it");
  assert.equal(sources.at(-1), "booklet.js");
  assert.equal(sources.indexOf("tabs.js"), sources.length - 2);
  const parts = section("const codeParts = [", "];", build).split(",").map((part) => part.trim().replace(/^.*\[/, ""));
  assert.equal(parts.indexOf("tabsCode"), sources.indexOf("tabs.js"), "the same index in codeParts");
  assert.match(build, /readFile\(path\.join\(RENDERER, "tabs\.css"\)/);
  assert.match(build, /\$\{tabsStyles\}/);
  const inline = read("tests/booklet_build.test.mjs");
  assert.match(inline, /"tabs\.js",\n {2}"booklet\.js"/);
  assert.match(inline, /"tabs\.css"/);
});

// ---- keys: what the app already binds --------------------------------------------------------------------------------------------------
const CHORDS = ["CmdOrCtrl+T", "CmdOrCtrl+Shift+T", "CmdOrCtrl+Tab", "CmdOrCtrl+Shift+Tab", "CmdOrCtrl+Alt+P", "Alt+W", "Alt+Shift+T", ...Array.from({ length: 9 }, (_, i) => `CmdOrCtrl+${i + 1}`)];

test("the application menu binds none of the strip's chords; its one overlap is the window menu's Close (Ctrl+W), which the page takes first", () => {
  const menu = section("function applicationMenu() {", "async function applyReload");
  const accelerators = [...menu.matchAll(/accelerator: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(accelerators, ["CmdOrCtrl+Q", "CmdOrCtrl+R", "CmdOrCtrl+Shift+R", "CmdOrCtrl+0", "CmdOrCtrl+Plus", "CmdOrCtrl+=", "CmdOrCtrl+-"], "a new accelerator is a decision: check it against tabs.js's keys (and this list)");
  for (const chord of CHORDS) assert.equal(accelerators.includes(chord), false, chord);
  assert.match(menu, /\{ role: "windowMenu" \}/, "Close (CmdOrCtrl+W) comes from this role; onKey's preventDefault keeps it from closing the window");
  assert.match(tabsJs, /preventDefault\?\.\(\); event\.stopPropagation\?\.\(\)/, "and the strip does handle the key it takes");
});

test("no other renderer script binds a chord the strip owns (Ctrl/Alt with T, W, P, Tab, PageUp, PageDown or a digit)", () => {
  const names = readdirSync(new URL("../renderer/", import.meta.url)).filter((name) => name.endsWith(".js") && name !== "tabs.js");
  const hits = [];
  for (const name of names) {
    read(`renderer/${name}`).split("\n").forEach((line, index) => {
      if (!/\b(ctrlKey|metaKey|altKey)\b/.test(line)) return;
      if (/["'`](?:[twp1-9]|Tab|PageUp|PageDown)["'`]/i.test(line.replace(/\bevent\.key\.length\b/g, "")) || /code\s*===?\s*["'`](?:Key[TWP]|Digit[1-9]|Tab)/.test(line)) hits.push(`${name}:${index + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  assert.deepEqual(hits, [], "another script reacts to a chord the strip takes: decide who owns it");
});

// ---- what tabs.js must never do --------------------------------------------------------------------------------------------------------
test("tabs.js builds everything with DOM calls: no innerHTML, no script strings, no network, and one call to the host", () => {
  for (const banned of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function/, /\bfetch\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /\bimport\(/, /ipcRenderer/]) assert.equal(banned.test(tabsJs), false, String(banned));
  const host = [...tabsJs.matchAll(/window\.mefiStudio\??\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(host)], ["prefsGet"], "the only thing it asks the host is the run's switch");
  const stores = [...tabsJs.matchAll(/KEYS\.(\w+)/g)].map((match) => match[1]);
  assert.ok(stores.length > 0);
  for (const key of ["localStorage.getItem", "localStorage.setItem"]) assert.equal(tabsJs.split(key).length - 1, 1, `${key} is used in one place (read/write), each guarded`);
  assert.equal(/localStorage\.removeItem|sessionStorage|indexedDB/.test(tabsJs), false, "nothing is ever deleted from the page's storage, and nothing else is used");
});

test("tabs.js has no timer that polls: no interval, and exactly three one-shot timeouts (the write a moment after a change, the sweep for the next tab that could be due, one retry at boot)", () => {
  assert.equal(/setInterval/.test(tabsJs), false);
  assert.equal([...tabsJs.matchAll(/setTimeout\(/g)].length, 3);
  assert.equal(/requestAnimationFrame\(renderNow\)/.test(tabsJs), true, "and a repaint is one frame, asked for when something changed");
});

test("tabs.css: nothing under 12px, no scrollbar gutters or forced scrollers, every colour from a theme token, motion that respects the setting", () => {
  const css = tabsCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const sizes = Object.fromEntries([...css.matchAll(/(--ts-fs[\w-]*):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
  assert.deepEqual(Object.keys(sizes).sort(), ["--ts-fs", "--ts-fs-small"], "two text sizes, defined once");
  for (const [name, value] of Object.entries(sizes)) assert.match(value, /^max\(12px, calc\(\d+px \* var\(--text-scale, 1\)\)\)$/, `${name} is never under 12px and follows the interface scale`);
  const declared = [...css.matchAll(/(?:^|[\s{;])(font-size|font):\s*([^;}]+)[;}]/g)].map((match) => [match[1], match[2].trim()]);
  assert.ok(declared.length > 15, "the stylesheet sets its text sizes");
  for (const [property, value] of declared) {
    assert.ok(value === "inherit" || /var\(--ts-fs(?:-small)?\)/.test(value), `${property}: ${value} must be one of the two sizes`);
    assert.equal(/(?:^|[^\w-])(?:[0-9]|1[01])(?:\.\d+)?px\b/.test(value), false, `${property}: ${value}`);
  }
  assert.equal(/overflow(?:-x|-y)?:\s*scroll/.test(css), false, "overflow: scroll reserves a gutter");
  assert.equal(/scrollbar-gutter|scrollbar-width:\s*(?!none)/.test(css), false);
  const declarations = [...css.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1]).join(";");
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(declarations.replace(/url\([^)]*\)/g, "")), false, "no literal hex colours");
  assert.equal(/\brgba?\(\s*\d|\bhsla?\(\s*\d/.test(declarations), false, "no literal rgb or hsl colours: color-mix over the theme's own tokens");
  assert.match(css, /prefers-reduced-motion/, "animation has a way out");
  assert.match(css, /max-width:\s*899\.98px/, "the contract's fold");
  assert.match(css, /focus-visible/, "a visible focus ring");
});
