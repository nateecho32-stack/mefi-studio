// Vibe mode keeps you in Vibe. renderer/nav.js runs here against the shared
// fake DOM with a stand-in for renderer/vibe.js, so these checks break when a
// route out of Vibe (Home, leaving Command, Back on a Work page) starts
// landing on a Build surface again, or when the Vibe rail in the template
// points at a destination the registry does not have.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom, TEMPLATE } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8");
const template = await readFile(TEMPLATE, "utf8");
const vibeSource = await readFile(new URL("../renderer/vibe.js", import.meta.url), "utf8");
const vibeCss = await readFile(new URL("../renderer/vibe.css", import.meta.url), "utf8");
const IDS = ["app-rail", "app-rail-brand", "app-rail-sections", "app-rail-foot", "app-rail-pin", "workspace-sidebar", "workspace-layer", "app-local-nav"];

// `mode` is what MefiVibe.mode() answers; `view` is the surface showing:
// "vibe", "workspace", "command" or "page" (a tab page such as Settings).
function load({ mode = "vibe", view = "vibe", stored = {} } = {}) {
  const { document, get } = createDom({ ids: IDS });
  const lookupId = document.getElementById;
  document.getElementById = (id) => lookupId(id) ?? document.querySelector(`#${id}`);
  document.readyState = "loading";
  document.documentElement.dataset = {};
  document.createDocumentFragment = () => document.createElement("#fragment");
  get("app-rail").append(get("app-rail-brand"), get("app-rail-sections"), get("app-rail-foot"), get("app-rail-pin"));
  // The tab row's active button is how nav.js reads which page is showing.
  const tab = document.createElement("button");
  tab.className = "tab";
  document.body.append(tab);
  const store = new Map(Object.entries(stored));
  const listeners = {};
  const tabs = [];
  const log = [];
  const window = {
    innerWidth: 1440,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    dispatchEvent: (event) => { for (const fn of listeners[event.type] ?? []) fn(event); return true; },
    MefiWorkspace: {
      isActive: () => view === "workspace",
      enter: () => { log.push("workspace"); view = "workspace"; },
      exit: () => { if (view === "workspace") view = "page"; },
    },
    MefiIdle: {
      isActive: () => view === "command",
      enter: () => { log.push("command"); view = "command"; },
      exit: () => { if (view === "command") view = "page"; },
    },
    MefiVibe: {
      mode: () => mode,
      isActive: () => view === "vibe",
      enter: () => { log.push("vibe"); view = "vibe"; },
      exit: () => { if (view === "vibe") view = "page"; },
    },
    MefiTasks: { open: () => log.push("tasks"), close() {} },
    MefiBooklet: { showTab: (name) => { tabs.push(name); log.push(`tab:${name}`); tab.className = "tab active"; tab.dataset.tab = name; view = "page"; } },
    MefiToast() {},
  };
  const context = vm.createContext({
    window, document, console,
    location: { search: "" },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    URLSearchParams,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0,
  });
  vm.runInContext(source, context);
  const nav = window.MefiNav;
  // What vibe.js registers: Vibe is a view whose open() is MefiVibe.enter().
  nav.register({
    id: "vibe", label: "Vibe", short: "Vibe", kind: "view", layer: null, section: "home", group: "surfaces",
    glyph: "g-spark", badge: null, showIn: { palette: true, help: true },
    open: () => window.MefiVibe.enter(), close: () => window.MefiVibe.exit(), isOpen: () => view === "vibe",
  });
  return { nav, log, tabs, window, get, document, store, view: () => view };
}

test("Vibe keeps the rail shell's frame even when Build is set to the classic tabs", () => {
  const classic = { "mefiStudio.shell": "classic" };
  assert.equal(load({ mode: "vibe", stored: classic }).nav.applyShell(), true, "Vibe's rail needs the rail geometry");
  assert.equal(load({ mode: "build", stored: classic }).nav.applyShell(), false, "Build still honours the classic choice");
});

test("switching shells from Vibe records Build's choice without taking Vibe's rail away", () => {
  const loaded = load();
  loaded.nav.applyShell();
  loaded.nav.get("shellRail").run();
  assert.equal(loaded.store.get("mefiStudio.shell"), "classic", "Build will open with the classic tabs");
  assert.equal(loaded.document.documentElement.dataset.shell, "rail", "Vibe keeps its frame");
  loaded.nav.get("shellRail").run();
  assert.equal(loaded.store.get("mefiStudio.shell"), "rail", "a second run flips the choice back");
});

test("Home is Vibe: every route to Build's Home lands on Vibe instead", () => {
  const loaded = load({ view: "page" });
  loaded.nav.go("workspace");
  assert.deepEqual(loaded.log, ["vibe"]);
  assert.equal(loaded.view(), "vibe");
});

test("leaving Command opened from Vibe goes back to Vibe, not Build's Agents page", () => {
  const loaded = load();
  loaded.nav.go("command");
  assert.equal(loaded.nav.state.commandFrom, "vibe");
  loaded.nav.leaveCommand();
  assert.equal(loaded.view(), "vibe");
  assert.deepEqual(loaded.log, ["command", "vibe"]);
});

test("leaving Command opened from a page returns to that page, still in Vibe", () => {
  const loaded = load();
  loaded.nav.go("studio");
  loaded.nav.go("command");
  assert.equal(loaded.nav.state.commandFrom, "studio");
  loaded.tabs.length = 0;
  loaded.nav.leaveCommand();
  assert.deepEqual(loaded.tabs, ["studio"], "Settings opens again");
  assert.equal(loaded.log.includes("workspace"), false, "Build's Home never opens");
});

test("Back on a Work page with nothing behind it returns to Vibe; Build keeps its section home", () => {
  const vibe = load();
  vibe.nav.state.sheet = "tasks";
  vibe.nav.close("tasks");
  assert.equal(vibe.view(), "vibe");
  assert.deepEqual(vibe.log, ["vibe"]);

  const build = load({ mode: "build", view: "workspace" });
  build.nav.state.sheet = "tasks";
  build.nav.close("tasks");
  assert.deepEqual(build.log, [], "Build's Task board is its section home, so Back stays put");
});

test("the Vibe rail in the template points only at registered destinations, and Build is its only exit", () => {
  const rail = template.match(/<nav id="vibe-rail"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(rail, "renderer/booklet.template.html ships #vibe-rail");
  const loaded = load();
  // agents.js registers Agents itself; the rest come from nav.js and vibe.js.
  const known = new Set([...loaded.nav.list({}).map((dest) => dest.id), "agents"]);
  const targets = [...rail.matchAll(/data-nav="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(targets, ["vibe", "command", "tasks", "plans", "ideas", "agents", "palette", "studio"]);
  for (const id of targets) assert.ok(known.has(id), `${id} is a registered destination`);
  assert.deepEqual([...rail.matchAll(/data-ui-mode="([^"]+)"/g)].map((match) => match[1]), ["build"]);
});

test("vibe.js and vibe.css wire the rail to the mode", () => {
  assert.match(vibeSource, /rail\.hidden = current !== "vibe"/, "the rail shows only in Vibe mode");
  assert.match(vibeSource, /closest\?\.\("button\[data-ui-mode\]"\)/, "any mode button switches, never the <html> that carries the mode");
  assert.match(vibeCss, /html\[data-ui-mode="vibe"\] :is\(#app-rail, #tabs, #workspace-sidebar-toggle, body > footer\) \{ display: none !important; \}/, "Build's frame never shows in Vibe mode");
  assert.match(vibeCss, /body:has\(\.workspace-page:not\(\[hidden\]\)\) #vibe-layer \{ visibility: hidden;/, "pages cover Vibe instead of showing it through");
});

test("Search and Shortcuts name Home as Vibe in Vibe mode and list it once", () => {
  const loaded = load();
  // vibe.js hides its own record in Vibe mode and Switch to Build in Build.
  loaded.nav.get("vibe").hidden = () => true;
  const palette = loaded.nav.list({ showIn: "palette" }).map((dest) => dest.id);
  assert.equal(palette.includes("vibe"), false, "no second entry for the same place");
  const home = loaded.nav.get("workspace");
  assert.equal(home.label, "Vibe");
  assert.equal(home.key, "H");
  assert.match(home.desc, /calm front door/);
  const build = load({ mode: "build", view: "workspace" });
  assert.equal(build.nav.get("workspace").label, "Home", "Build keeps its Home");
  assert.equal(build.nav.list({ showIn: "palette" }).some((dest) => dest.id === "workspace"), true);
});

test("Settings carries a Studio mode switch that changes the frame in place, and the decision drawer ships in Vibe", () => {
  const settings = template.match(/<div class="settings-mode-row" id="settings-mode">[\s\S]*?<\/div>\s*<\/div>/)?.[0];
  assert.ok(settings, "Settings > General has the Studio mode row");
  assert.match(settings, /class="mode-switch"[^>]*data-mode-stay/, "the switch stays on Settings");
  assert.deepEqual([...settings.matchAll(/data-ui-mode="([^"]+)"/g)].map((match) => match[1]), ["vibe", "build"]);
  assert.match(vibeSource, /closest\("\[data-mode-stay\]"\)/, "vibe.js honours data-mode-stay");
  for (const id of ["vibe-ask", "vibe-ask-body", "vibe-ask-close", "vibe-ask-watch", "vibe-ask-note", "idle-home-label", "idle-home-hint"]) {
    assert.ok(template.includes(`id="${id}"`), `${id} is in the template`);
  }
  assert.match(vibeSource, /api\(\)\.assistantAnswer\(\{ id: question\.id, optionId, text \}\)/, "answers go through the same host call Command's Ask tab uses");
  assert.doesNotMatch(vibeSource, /run: \(\) => go\("command", \{ rail: "ask" \}\)/, "Answer no longer leaves Vibe");
});
