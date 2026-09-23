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

// What community.js registers at DOMContentLoaded, after init() has drawn the
// rail. community.js is not loaded here, so the late arrival is replayed.
const COMMUNITY = {
  id: "community", label: "Void Engine Discord & perks", short: "Community", kind: "action", layer: null,
  group: "system", key: null, glyph: "g-agents", badge: null,
  showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
  run() {},
};

const settle = async () => { for (let turn = 0; turn < 8; turn += 1) await Promise.resolve(); };

// `init` runs nav.init() the way the page does, so wireRail, the updater and
// the release watcher are live; without it the module loads and waits, like a
// page before DOMContentLoaded. `ids` seeds more template ids, `width` is
// window.innerWidth and `host` the preload bridge.
function load({ search = "", stored = {}, view = "workspace", sidebar = null, init = false, ids = [], width, host } = {}) {
  const { document, get } = createDom({ ids: [...RAIL_IDS, ...ids] });
  document.readyState = "loading"; // init() runs only when a test asks for it
  document.documentElement.dataset = {};
  // renderHelp builds each key row in a fragment; the stand-in keeps the
  // fragment as a wrapper, which is enough to see where every row lands.
  document.createDocumentFragment = () => document.createElement("#fragment");
  // createDom mints each id detached; nest them the way the template does, so
  // queries scoped to the rail see its sections.
  get("app-rail").append(get("app-rail-brand"), get("app-rail-sections"), get("app-rail-foot"), get("app-rail-pin"));
  get("app-rail").hidden = true;
  const store = new Map(Object.entries(stored));
  const events = [];
  const listeners = {};
  const tabs = [];
  const toasts = [];
  const window = {
    innerWidth: width,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    dispatchEvent: (event) => {
      events.push(event.type);
      for (const fn of listeners[event.type] ?? []) fn(event);
      return true;
    },
    MefiWorkspace: { isActive: () => view === "workspace" },
    MefiIdle: { isActive: () => view === "command" },
    MefiSidebar: sidebar,
    MefiBooklet: { showTab: (name, params) => { tabs.push([name, params]); } },
    MefiToast: (text, tone, options) => { toasts.push({ text, tone, options }); },
    mefiStudio: host,
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
  if (init) nav.init();
  return {
    nav, document, get, store, events, tabs, toasts, window,
    rail: () => get("app-rail"),
    setView: (next) => { view = next; },
    fire: (type, event = {}) => { for (const fn of listeners[type] ?? []) fn({ type, ...event }); },
  };
}

const heads = (rail) => rail.querySelectorAll(".app-rail-head").map((button) => button.dataset.section);
const itemsIn = (rail, section) => rail.querySelectorAll(`.app-rail-section[data-section="${section}"] .app-rail-item`).map((button) => button.dataset.nav);
const footOf = (rail) => rail.querySelectorAll("#app-rail-foot [data-nav]").map((button) => button.dataset.nav);
const tabStops = (rail) => rail.querySelectorAll("button").filter((button) => button.tabIndex === 0);

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

test("every destination in the registry lands in exactly one place, and actions without a RAIL_SLOTS place stay in the palette", async () => {
  const { nav, rail } = load({ search: "?shell=rail" });
  nav.applyShell();
  nav.register(COMMUNITY);
  await settle();
  const placed = rail().querySelectorAll("[data-nav]").map((button) => button.dataset.nav);
  const destinations = nav.list().filter((dest) => nav.railSection(dest));
  for (const dest of destinations) assert.ok(placed.includes(dest.id), `${dest.id} is reachable from the rail`);
  const members = rail().querySelectorAll(".app-rail-item").map((button) => button.dataset.nav);
  assert.equal(new Set(members).size, members.length, "no destination is listed twice");
  for (const dest of nav.list().filter((item) => item.kind === "action" && !Object.hasOwn(nav.RAIL_SLOTS, item.id))) {
    assert.equal(nav.railSection(dest), null, `${dest.id} is an action and stays in the palette`);
    assert.ok(!placed.includes(dest.id));
  }
});

test("the sections follow the approved menu: Analyzer with the Work tools, the Profiler with Settings", () => {
  const { nav, rail } = load({ search: "?shell=rail" });
  nav.applyShell();
  assert.deepEqual(itemsIn(rail(), "home"), [], "Home lists nothing twice: its head is the workspace");
  assert.deepEqual(itemsIn(rail(), "work"), ["tasks", "plans", "ideas", "brains", "analyzer"]);
  assert.deepEqual(itemsIn(rail(), "live"), ["command", "eyes", "explorer", "overhead"]);
  assert.deepEqual(itemsIn(rail(), "models"), ["booklet", "graph"]);
  assert.deepEqual(itemsIn(rail(), "settings"), ["studio", "music", "profiler"]);
  assert.deepEqual(footOf(rail()), ["palette", "onboarding", "help"], "Search, Start here and Shortcuts sit at the foot");
});

test("each head draws its target's own glyph, and no two foot icons are the same", () => {
  const { nav, rail } = load({ search: "?shell=rail" });
  nav.applyShell();
  for (const head of rail().querySelectorAll(".app-rail-head")) {
    const glyph = head.querySelector("use")?.getAttribute("href");
    assert.equal(glyph, `#${nav.get(head.dataset.nav).glyph}`, `the ${head.dataset.section} head and ${head.dataset.nav} share one icon`);
  }
  const icons = rail().querySelectorAll("#app-rail-foot .app-rail-foot-item use").map((use) => use.getAttribute("href"));
  assert.equal(icons.length, 3);
  assert.equal(new Set(icons).size, icons.length, "Start here and Shortcuts no longer share the ? icon");
  assert.equal(nav.get("onboarding").glyph, "g-flag");
  assert.equal(nav.get("help").glyph, "g-help");
  assert.equal(nav.get("palette").label, "Search Studio");
  assert.equal(nav.get("palette").short, "Search");
});

test("Community joins the foot when community.js registers late: one redraw on a microtask, and keyboard focus stays put", async () => {
  const loaded = load({ search: "?shell=rail" });
  loaded.nav.applyShell();
  const rail = loaded.rail();
  const help = rail.querySelector('#app-rail-foot [data-nav="help"]');
  loaded.document.activeElement = help;
  let draws = 0;
  const byId = loaded.document.getElementById;
  loaded.document.getElementById = (id) => {
    if (id === "app-rail-sections") draws += 1;
    return byId(id);
  };
  assert.equal(loaded.nav.railSection({ id: "community", kind: "action" }), "foot", "RAIL_SLOTS places the palette action");
  loaded.nav.register(COMMUNITY);
  loaded.nav.register({ ...COMMUNITY });
  assert.deepEqual(footOf(rail), ["palette", "onboarding", "help"], "the redraw waits for the microtask");
  await settle();
  assert.equal(draws, 1, "registrations in one task redraw the rail once");
  assert.deepEqual(footOf(rail), ["palette", "onboarding", "help", "community"]);
  const again = rail.querySelector('#app-rail-foot [data-nav="help"]');
  assert.notEqual(again, help, "the foot was redrawn");
  assert.equal(again.focused, true, "focus comes back to the same destination");
});

test("a registration with no rail place leaves the rail alone, and the classic shell draws nothing late", async () => {
  const loaded = load({ search: "?shell=rail" });
  loaded.nav.applyShell();
  const before = loaded.rail().querySelectorAll("button");
  loaded.nav.register({ id: "assistantTidy", kind: "action", group: "assistant", label: "Tidy up now", showIn: { palette: true } });
  loaded.nav.register({ id: "idle-fit", kind: "action", group: "command", key: "F", label: "Fit the view", showIn: { help: true } });
  await settle();
  const after = loaded.rail().querySelectorAll("button");
  assert.equal(after.length, before.length);
  assert.ok(after.every((button, at) => button === before[at]), "the same buttons, not a redraw");
  const classic = load({ stored: { "mefiStudio.shell": "classic" } });
  classic.nav.applyShell();
  classic.nav.register(COMMUNITY);
  await settle();
  assert.deepEqual(footOf(classic.rail()), [], "the hidden rail is not drawn for a late arrival");
});

test("sectionLabel names every record's section, the palette's result kinds", () => {
  const { nav } = load();
  const label = (id) => nav.sectionLabel(nav.get(id));
  assert.equal(label("workspace"), "Home");
  for (const id of ["tasks", "plans", "ideas", "brains", "analyzer", "scanIdeas"]) assert.equal(label(id), "Work", id);
  for (const id of ["command", "eyes", "explorer", "overhead", "pinRail", "audit", "machine"]) assert.equal(label(id), "Live", id);
  for (const id of ["booklet", "graph", "search", "refresh", "print"]) assert.equal(label(id), "Models", id);
  for (const id of ["studio", "music", "profiler", "motion", "shellRail"]) assert.equal(label(id), "Settings", id);
  for (const id of ["palette", "onboarding", "help"]) assert.equal(label(id), "Help", id);
  assert.equal(nav.sectionLabel(COMMUNITY), "Community");
  assert.equal(nav.sectionLabel({ id: "assistantTidy", kind: "action", group: "assistant" }), "Assistant");
  assert.equal(nav.sectionLabel({ id: "settings:settings-updates", kind: "action", group: "settings" }), "Settings", "the Settings cards booklet.js files");
  assert.equal(nav.sectionLabel(null), null);
  assert.deepEqual({ ...nav.RAIL_SLOTS }, { community: "foot" });
  assert.ok(Object.isFrozen(nav.RAIL_SLOTS), "only nav places destinations in the rail");
  const ranks = ["workspace", "tasks", "command", "booklet", "studio", "help"].map((id) => nav.sectionRank(nav.get(id)));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "ranks follow the rail from top to bottom");
  assert.ok(nav.sectionRank(COMMUNITY) > nav.sectionRank(nav.get("help")));
});

test("the rail is one tab stop, resting on a button the collapsed rail still shows", () => {
  const workspace = load({ search: "?shell=rail" });
  workspace.nav.applyShell();
  const [home, ...others] = tabStops(workspace.rail());
  assert.equal(others.length, 0, "exactly one tab stop");
  assert.equal(home.dataset.section, "home", "the workspace is Home's head");
  const command = load({ search: "?shell=rail", view: "command" });
  command.nav.applyShell();
  const stops = tabStops(command.rail());
  assert.equal(stops.length, 1);
  assert.ok(stops[0].classList.contains("app-rail-head") && stops[0].dataset.section === "live", "Command is folded under Live at rest, so Live's head holds the stop");
  assert.equal(command.rail().querySelector('[aria-current="page"]').dataset.nav, "command");
});

test("the arrows walk the rail and stop there, so Command's canvas never sees them", async () => {
  const loaded = load({ search: "?shell=rail", view: "command", init: true });
  const rail = loaded.rail();
  const all = rail.querySelectorAll("button");
  const live = all.find((button) => button.classList.contains("app-rail-head") && button.dataset.section === "live");
  const press = async (key, target, extra = {}) => {
    const seen = { prevented: false, stopped: false };
    await rail.trigger("keydown", { key, target, preventDefault() { seen.prevented = true; }, stopPropagation() { seen.stopped = true; }, ...extra });
    return seen;
  };
  const down = await press("ArrowDown", live);
  const commandItem = all[all.indexOf(live) + 1];
  assert.equal(commandItem.dataset.nav, "command");
  assert.equal(commandItem.focused, true);
  assert.deepEqual(down, { prevented: true, stopped: true }, "the rail keeps the arrow");
  assert.deepEqual(tabStops(rail), [commandItem], "the stop follows the arrows");
  await press("ArrowUp", all[0]);
  assert.equal(all.at(-1).focused, true, "Up from the top wraps to the foot");
  await press("Home", commandItem);
  assert.deepEqual(tabStops(rail), [all[0]]);
  await press("End", all[0]);
  assert.deepEqual(tabStops(rail), [all.at(-1)]);
  assert.deepEqual(await press("ArrowDown", live, { altKey: true }), { prevented: false, stopped: false }, "a modified arrow is not the rail's");
  assert.deepEqual(await press("ArrowLeft", live), { prevented: false, stopped: false });
  await rail.trigger("focusout", { relatedTarget: null });
  assert.deepEqual(tabStops(rail), [live], "leaving hands the stop back to where you are");
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

test("a pinned rail yields below 1100px wide and comes back when the window widens", async () => {
  const loaded = load({ search: "?shell=rail", init: true, width: 1000, stored: { "mefiStudio.railPinned": "1" } });
  const root = loaded.document.documentElement;
  assert.equal(root.dataset.railPinned, undefined, "too narrow: the saved pin yields");
  assert.equal(loaded.get("app-rail-pin").getAttribute("aria-pressed"), "true", "the choice itself stands");
  const resizes = () => loaded.events.filter((type) => type === "resize").length;
  const before = resizes();
  loaded.window.innerWidth = 1280;
  loaded.fire("resize");
  assert.equal(root.dataset.railPinned, "", "wide again: pinned");
  assert.ok(resizes() > before, "the layers offset by the rail measure again");
  loaded.window.innerWidth = 1099;
  loaded.fire("resize");
  assert.equal(root.dataset.railPinned, undefined);
  assert.equal(loaded.store.get("mefiStudio.railPinned"), "1", "yielding never rewrites the saved choice");
  await loaded.get("app-rail-pin").click();
  assert.equal(loaded.store.get("mefiStudio.railPinned"), "0");
  await loaded.get("app-rail-pin").click();
  assert.equal(root.dataset.railPinned, undefined, "a narrow window still yields");
  assert.match(loaded.toasts.at(-1)?.text ?? "", /1100px/, "pinning in a narrow window says why nothing moved");
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

test("Ctrl+, opens Settings from anywhere, a text field included, and 4 still does", async () => {
  const loaded = load({ search: "?shell=rail" });
  const key = (init) => {
    const event = { target: null, preventDefault() { event.prevented = true; }, ...init };
    loaded.nav.handleKey(event);
    return event;
  };
  const field = { closest: () => ({ blur() {} }) };
  assert.equal(key({ key: ",", ctrlKey: true, target: field }).prevented, true);
  key({ key: ",", metaKey: true });
  key({ key: "4" });
  await settle();
  assert.deepEqual(loaded.tabs.map(([name]) => name), ["studio", "studio", "studio"]);
  key({ key: ",", ctrlKey: true, altKey: true });
  key({ key: "," });
  await settle();
  assert.equal(loaded.tabs.length, 3, "AltGr+, and a bare comma are not the chord");
});

test("the shortcut sheet groups every key by the rail's sections, with Esc under Help", () => {
  const { nav, document } = load();
  const grid = document.createElement("div");
  nav.renderHelp(grid);
  const title = (group) => group.querySelector("h4").textContent;
  assert.deepEqual(grid.children.map(title), ["Home & Work", "Live", "Models", "Settings", "Help"]);
  const keysIn = (name) => grid.children.find((group) => title(group) === name).querySelectorAll("kbd").map((cap) => cap.textContent);
  assert.deepEqual(keysIn("Home & Work"), ["H", "T", "P", "I", "B", "A"]);
  assert.deepEqual(keysIn("Live"), ["D", "3", "E", "O", "G"]);
  assert.deepEqual(keysIn("Models"), ["1", "2", "/", "R"]);
  assert.deepEqual(keysIn("Settings"), ["4", "Ctrl ,", "U"]);
  assert.deepEqual(keysIn("Help"), ["Ctrl K", "?", "Esc"]);
  for (const group of grid.children) assert.equal(group.getAttribute("aria-labelledby"), group.querySelector("h4").id);
  // Command view's own rows arrive from idle.js and get the last group.
  nav.register({ id: "idle-fit", kind: "action", group: "command", key: "F", label: "Fit the view", showIn: { help: true } });
  nav.renderHelp(grid);
  assert.equal(title(grid.children.at(-1)), "Command view");
});

test("the tab pages' header names the page and offers the way back to Command", async () => {
  const loaded = load({ view: "command", ids: ["page-title", "page-return"] });
  loaded.get("page-return").hidden = true;
  loaded.nav.go("studio");
  await settle();
  assert.equal(loaded.get("page-title").textContent, "Settings");
  assert.equal(loaded.get("page-return").hidden, false, "Command sent you here, so the way back shows");
  loaded.setView("page");
  loaded.nav.go("booklet");
  await settle();
  assert.equal(loaded.get("page-title").textContent, "Model catalog");
  assert.equal(loaded.get("page-return").hidden, false, "moving between pages keeps the way back");
  loaded.nav.go("workspace");
  loaded.setView("workspace");
  loaded.nav.go("graph");
  await settle();
  assert.equal(loaded.get("page-title").textContent, "Model Lab");
  assert.equal(loaded.get("page-return").hidden, true, "a page opened from the workspace has no Command to return to");
});

test("the update pill and toasts point at Settings › Updates and open that card", async () => {
  const handlers = {};
  const host = {
    updateStatus: async () => ({ status: { phase: "watching", auto: true } }),
    onUpdateEvent: (fn) => { handlers.update = fn; },
    updateSet: async () => ({}),
    updateApply: async () => ({}),
    releaseStatus: async () => ({ status: { state: "current" } }),
    onReleaseEvent: (fn) => { handlers.release = fn; },
  };
  const loaded = load({ search: "?shell=rail", init: true, host, ids: ["update-pill"] });
  const pill = loaded.get("update-pill");
  assert.equal(pill.dataset.nav, "studio", "the pill is found by id wherever its markup sits");
  assert.deepEqual(JSON.parse(pill.dataset.navParams), { section: "settings-updates" });
  handlers.release({ state: "available", latest: { version: "9.9.9" } });
  assert.match(pill.title, /Settings › Updates/);
  const offer = loaded.toasts.find((toast) => /Update available/.test(toast.text));
  assert.match(offer.text, /v9\.9\.9 · Settings › Updates/);
  assert.equal(offer.options.action.label, "Open");
  offer.options.action.run();
  await settle();
  assert.deepEqual(loaded.tabs.map(([name, params]) => [name, { ...params }]), [["studio", { section: "settings-updates" }]]);
  handlers.update({ phase: "pending", files: ["renderer/a.js"], reason: "renderer change", auto: true });
  const pending = loaded.toasts.find((toast) => /Update pending/.test(toast.text));
  assert.match(pending.text, /apply it from Settings › Updates/);
  assert.equal(pending.options.action.label, "Open");
  await settle();
  assert.match(pill.title, /Settings › Updates/);
  assert.equal(loaded.nav.sectionLabel(loaded.nav.get("updateAuto")), "Settings");
  assert.equal(loaded.nav.sectionLabel(loaded.nav.get("updateApply")), "Settings");
});
