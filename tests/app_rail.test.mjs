// The one navigation rail (docs/ux-audit.md, Phase 3). The whole of
// renderer/nav.js runs here against the shared fake DOM — the real registry,
// the real navButton and the real renderRail — so these checks break when the
// rail and the registry drift apart, not when a copied stub does.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom, templateHasId } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8");
const RAIL_IDS = ["app-rail", "app-rail-brand", "app-rail-sections", "app-rail-foot", "app-rail-pin", "workspace-sidebar", "workspace-layer"];

function load({ search = "", stored = {}, view = "workspace", sidebar = null } = {}) {
  const { document, get } = createDom({ ids: RAIL_IDS });
  document.readyState = "loading"; // keep init() and its host subscriptions out of it
  document.documentElement.dataset = {};
  // createDom mints each id detached; nest them the way the template does, so
  // queries scoped to the rail see its sections.
  get("app-rail").append(get("app-rail-brand"), get("app-rail-sections"), get("app-rail-foot"), get("app-rail-pin"));
  get("app-rail").hidden = true;
  const store = new Map(Object.entries(stored));
  const events = [];
  const window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: (event) => { events.push(event.type); return true; },
    MefiWorkspace: { isActive: () => view === "workspace" },
    MefiIdle: { isActive: () => view === "command" },
    MefiSidebar: sidebar,
  };
  const context = vm.createContext({
    window, document, console,
    location: { search },
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
  return { nav, document, get, store, events, rail: () => get("app-rail"), setView: (next) => { view = next; } };
}

const heads = (rail) => rail.querySelectorAll(".app-rail-head").map((button) => button.dataset.section);
const itemsIn = (rail, section) => rail.querySelectorAll(`.app-rail-section[data-section="${section}"] .app-rail-item`).map((button) => button.dataset.nav);

test("the template ships the rail every renderer lookup needs", () => {
  for (const id of RAIL_IDS.slice(0, 5)) assert.ok(templateHasId(id), `${id} is in booklet.template.html`);
});

test("the rail is the default navigation", () => {
  const { nav, rail, document } = load();
  assert.equal(nav.applyShell(), true);
  assert.equal(rail().hidden, false);
  assert.equal(document.documentElement.dataset.shell, "rail");
});

test("classic stays one switch away, and turning it on leaves the old chromes untouched", () => {
  const classic = load({ stored: { "mefiStudio.shell": "classic" } });
  assert.equal(classic.nav.applyShell(), false, "a remembered classic choice is honoured");
  assert.equal(classic.rail().hidden, true);
  assert.equal(classic.document.documentElement.dataset.shell, undefined, "no data-shell, so no stylesheet rule moves a pixel");
  assert.equal(load({ search: "?shell=classic" }).nav.applyShell(), false, "?shell=classic works for a single launch");
  assert.equal(load({ search: "?shell=rail", stored: { "mefiStudio.shell": "classic" } }).nav.applyShell(), true, "the URL wins over the stored choice");
});

test("five sections in order, each head going straight to its main destination", () => {
  const { nav, rail } = load({ search: "?shell=rail" });
  nav.applyShell();
  assert.deepEqual(heads(rail()), ["home", "work", "live", "models", "settings"]);
  const targets = Object.fromEntries(rail().querySelectorAll(".app-rail-head").map((head) => [head.dataset.section, head.dataset.nav]));
  assert.deepEqual(targets, { home: "workspace", work: "tasks", live: "command", models: "booklet", settings: "studio" });
});

test("every destination in the registry lands in exactly one place, and actions stay in the palette", () => {
  const { nav, rail } = load({ search: "?shell=rail" });
  nav.applyShell();
  const placed = rail().querySelectorAll("[data-nav]").map((button) => button.dataset.nav);
  const destinations = nav.list().filter((dest) => nav.railSection(dest));
  for (const dest of destinations) assert.ok(placed.includes(dest.id), `${dest.id} is reachable from the rail`);
  const members = rail().querySelectorAll(".app-rail-item").map((button) => button.dataset.nav);
  assert.equal(new Set(members).size, members.length, "no destination is listed twice");
  for (const dest of nav.list().filter((item) => item.kind === "action")) {
    assert.equal(nav.railSection(dest), null, `${dest.id} is an action and stays in the palette`);
    assert.ok(!placed.includes(dest.id));
  }
});

test("the sections follow the grouping the More tools menus already use", () => {
  const { nav, rail } = load({ search: "?shell=rail" });
  nav.applyShell();
  assert.deepEqual(itemsIn(rail(), "home"), [], "Home lists nothing twice: its head is the workspace");
  assert.ok(itemsIn(rail(), "work").includes("tasks") && itemsIn(rail(), "work").includes("plans"));
  assert.ok(itemsIn(rail(), "live").includes("command") && itemsIn(rail(), "live").includes("explorer"));
  assert.deepEqual(itemsIn(rail(), "models"), ["booklet", "graph"]);
  assert.ok(itemsIn(rail(), "settings").includes("studio"));
  const foot = rail().querySelectorAll("#app-rail-foot [data-nav]").map((button) => button.dataset.nav).sort();
  assert.deepEqual(foot, ["help", "onboarding", "palette"], "the transient helpers sit at the foot");
});

test("exactly one aria-current, on where you are, and its section lights up", () => {
  const loaded = load({ search: "?shell=rail", view: "command" });
  loaded.nav.applyShell();
  const current = () => loaded.rail().querySelectorAll('[aria-current="page"]');
  assert.equal(current().length, 1);
  assert.equal(current()[0].dataset.nav, "command");
  assert.equal(current()[0].classList.contains("app-rail-item"), true, "a listed destination carries it, not its section head");
  assert.deepEqual(loaded.rail().querySelectorAll(".app-rail-section.current").map((group) => group.dataset.section), ["live"]);
  loaded.setView("workspace");
  loaded.nav.paintRail();
  assert.equal(current().length, 1);
  assert.equal(current()[0].dataset.nav, "workspace");
  assert.equal(current()[0].classList.contains("app-rail-head"), true, "Home has no list, so its head is the mark");
});

test("pinning is remembered and never outlives the rail itself", () => {
  const loaded = load({ search: "?shell=rail" });
  loaded.nav.applyShell();
  loaded.nav.setRailPinned(true);
  assert.equal(loaded.document.documentElement.dataset.railPinned, "");
  assert.equal(loaded.get("app-rail-pin").getAttribute("aria-pressed"), "true");
  assert.equal(loaded.store.get("mefiStudio.railPinned"), "1");
  assert.ok(loaded.events.includes("resize"), "the layers offset by the rail get to measure again");
  const off = load({ stored: { "mefiStudio.railPinned": "1", "mefiStudio.shell": "classic" } });
  off.nav.applyShell();
  assert.equal(off.document.documentElement.dataset.railPinned, undefined, "a saved pin does nothing while the rail is off");
});

test("setShell remembers the choice both ways", () => {
  const loaded = load();
  assert.equal(loaded.nav.setShell(false), false);
  assert.equal(loaded.store.get("mefiStudio.shell"), "classic");
  assert.equal(loaded.rail().hidden, true);
  assert.equal(loaded.nav.setShell(true), true);
  assert.equal(loaded.store.get("mefiStudio.shell"), "rail");
  assert.equal(loaded.rail().hidden, false);
});

test("the palette switch flips whichever shell is showing", () => {
  const loaded = load();
  loaded.nav.applyShell();
  loaded.nav.get("shellRail").run();
  assert.equal(loaded.rail().hidden, true, "from the rail to classic");
  loaded.nav.get("shellRail").run();
  assert.equal(loaded.rail().hidden, false, "and back");
});

test("the palette can switch shells, so the preview is findable without a URL", () => {
  const { nav } = load();
  const entry = nav.get("shellRail");
  assert.ok(entry, "a palette action exists");
  assert.equal(entry.kind, "action");
  assert.equal(entry.showIn.palette, true);
  assert.equal(nav.railSection(entry), null, "the switch itself is not a destination");
});
