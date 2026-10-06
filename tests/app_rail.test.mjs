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
  id: "community", label: "Void Engine Discord", short: "Community", kind: "action", layer: null,
  group: "system", key: null, glyph: "g-agents", badge: null,
  showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
  run() {},
};

const settle = async () => { for (let turn = 0; turn < 8; turn += 1) await Promise.resolve(); };

// `init` runs nav.init() the way the page does, so wireRail, the updater and
// the release watcher are live; without it the module loads and waits, like a
// page before DOMContentLoaded. `ids` seeds more template ids, `width` is
// window.innerWidth and `host` the preload bridge.
function load({ search = "", stored = {}, view = "workspace", sidebar = null, init = false, ids = [], width, host, layout = null } = {}) {
  const { document, get } = createDom({ ids: [...RAIL_IDS, ...ids] });
  const lookupId = document.getElementById;
  document.getElementById = (id) => lookupId(id) ?? document.querySelector(`#${id}`);
  document.readyState = "loading"; // init() runs only when a test asks for it
  document.documentElement.dataset = layout ? { layout } : {};
  // renderHelp builds each key row in a fragment; the stand-in keeps the
  // fragment as a wrapper, which is enough to see where every row lands.
  document.createDocumentFragment = () => document.createElement("#fragment");
  // createDom mints each id detached; nest them the way the template does, so
  // queries scoped to the rail see its sections.
  get("app-rail").append(get("app-rail-brand"), get("app-rail-sections"), get("app-rail-foot"), get("app-rail-pin"));
  get("app-rail").hidden = true;
  // html[data-layout] stays unset unless a case asks for it (init() sets it); the rail draws the places either way.
  const store = new Map(Object.entries(stored));
  const events = [];
  const frames = [];
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
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
  });
  vm.runInContext(source, context);
  const nav = window.MefiNav;
  if (init) nav.init();
  return {
    nav, document, get, store, events, tabs, toasts, window,
    flushFrames: () => { for (const frame of frames.splice(0)) frame(); },
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
  assert.equal(document.documentElement.dataset.railPinned, "", "wide windows show the destination names by default");
});

test("every destination in the registry lands in exactly one place, and actions without a RAIL_SLOTS place stay in the palette", async () => {
  const { nav, rail } = load({ search: "?shell=rail" });
  nav.applyShell();
  nav.register(COMMUNITY);
  await settle();
  const placed = rail().querySelectorAll("[data-nav]").map((button) => button.dataset.nav);
  assert.equal(new Set(placed).size, placed.length, "primary buttons and child rows never repeat a destination");
  const destinations = nav.list().filter((dest) => nav.railSection(dest));
  const local = Object.values(nav.LOCAL_ROUTES).flat();
  for (const dest of destinations) assert.ok(placed.includes(dest.id) || local.includes(dest.id), `${dest.id} is reachable from the shell`);
  const members = rail().querySelectorAll(".app-rail-item[data-nav]").map((button) => button.dataset.nav);
  assert.equal(new Set(members).size, members.length, "no destination is listed twice");
  for (const dest of nav.list().filter((item) => item.kind === "action" && !Object.hasOwn(nav.RAIL_SLOTS, item.id))) {
    assert.equal(nav.railSection(dest), null, `${dest.id} is an action and stays in the palette`);
    assert.ok(!placed.includes(dest.id));
  }
});

test("the classic bar of a section's pages is gone: the rail's paint only marks the section, and LOCAL_ROUTES keeps the pages for the frame", () => {
  const { nav, document } = load({ search: "?shell=rail", view: "command" });
  nav.applyShell();
  assert.equal(document.body.dataset.navSection, "agents", "the Command view is filed under Agents");
  nav.paintLocalNav("work", "plans");
  assert.equal(document.body.dataset.navSection, "work");
  assert.equal(document.getElementById("app-local-nav"), null, "no row of page buttons, Back and Forward or Git sync chip is built");
  assert.equal(document.querySelector(".studio-history"), null);
  // Work › Inbox is registered by renderer/today.js only: the frame's page list (renderer/shell.js) skips a route nobody registered.
  assert.deepEqual([...nav.LOCAL_ROUTES.work], ["tasks", "plans", "ideas", "inbox", "analyzer", "worktrees"]);
  assert.equal(nav.get("inbox") ?? null, null);
});

test("each foot tile draws its record's own glyph, no two foot icons are the same, and Start here and Shortcuts no longer share the ? icon", () => {
  const { nav, rail, document } = load({ search: "?shell=rail" });
  nav.applyShell();
  const icons = rail().querySelectorAll("#app-rail-foot .app-rail-foot-item use").map((use) => use.getAttribute("href"));
  assert.deepEqual(icons, [`#${nav.get("palette").glyph}`, `#${nav.get("studio").glyph}`, "#g-help"], "Search, Settings and Help");
  assert.equal(new Set(icons).size, 3);
  const rows = document.getElementById("app-help-menu").querySelectorAll("[data-nav]").map((button) => [button.dataset.nav, button.querySelector("use")?.getAttribute("href")]);
  assert.deepEqual(rows, [["onboarding", "#g-flag"], ["help", "#g-help"]], "the Help menu's Start here and Shortcuts");
  assert.equal(nav.get("onboarding").glyph, "g-flag");
  assert.equal(nav.get("help").glyph, "g-help");
  assert.equal(nav.get("palette").label, "Search Studio");
  assert.equal(nav.get("palette").short, "Search");
});

test("Community joins the Help menu when community.js registers late: one redraw on a microtask, and keyboard focus stays put", async () => {
  const loaded = load({ search: "?shell=rail" });
  loaded.nav.applyShell();
  const rail = loaded.rail();
  const settings = rail.querySelector('#app-rail-foot [data-nav="studio"]');
  loaded.document.activeElement = settings;
  let draws = 0;
  const byId = loaded.document.getElementById;
  loaded.document.getElementById = (id) => {
    if (id === "app-rail-sections") draws += 1;
    return byId(id);
  };
  assert.equal(loaded.nav.railSection({ id: "community", kind: "action" }), "foot", "RAIL_SLOTS places the palette action");
  loaded.nav.register(COMMUNITY);
  loaded.nav.register({ ...COMMUNITY });
  assert.deepEqual(footOf(rail), ["palette", "studio", "onboarding", "help"], "the redraw waits for the microtask");
  await settle();
  assert.equal(draws, 1, "registrations in one task redraw the rail once");
  assert.deepEqual(footOf(rail), ["palette", "studio", "onboarding", "help", "community"]);
  assert.equal(loaded.document.getElementById("app-help-menu").querySelectorAll("[data-nav]").at(-1).dataset.nav, "community", "the menu's last row");
  const again = rail.querySelector('#app-rail-foot [data-nav="studio"]');
  assert.notEqual(again, settings, "the foot was redrawn");
  assert.equal(again.focused, true, "focus comes back to the same destination");
});

test("a registration with no rail place leaves the rail alone", async () => {
  const loaded = load({ search: "?shell=rail" });
  loaded.nav.applyShell();
  const before = loaded.rail().querySelectorAll("button");
  loaded.nav.register({ id: "assistantTidy", kind: "action", group: "assistant", label: "Tidy up now", showIn: { palette: true } });
  loaded.nav.register({ id: "idle-fit", kind: "action", group: "command", key: "F", label: "Fit the view", showIn: { help: true } });
  await settle();
  const after = loaded.rail().querySelectorAll("button");
  assert.equal(after.length, before.length);
  assert.ok(after.every((button, at) => button === before[at]), "the same buttons, not a redraw");
});

test("sectionLabel names every record by its place, the palette's result kinds", () => {
  const { nav } = load();
  const label = (id) => nav.sectionLabel(nav.get(id));
  assert.equal(label("workspace"), "Work", "Home is Work › Today");
  for (const id of ["tasks", "plans", "ideas", "analyzer", "worktrees", "scanIdeas"]) assert.equal(label(id), "Work", id);
  assert.equal(label("command"), "Map");
  for (const id of ["brains", "eyes", "explorer", "overhead", "skills", "pinRail", "audit", "machine"]) assert.equal(label(id), "Team", id);
  for (const id of ["booklet", "graph", "search", "refresh", "print"]) assert.equal(label(id), "Team", id);
  for (const id of ["friends", "rooms", "friends-page"]) assert.equal(label(id), "Friends", id);
  for (const id of ["studio", "music", "profiler", "motion"]) assert.equal(label(id), "Settings", id);
  for (const id of ["palette", "onboarding", "help"]) assert.equal(label(id), "Help", id);
  assert.equal(nav.sectionLabel(COMMUNITY), "Community");
  assert.equal(nav.sectionLabel({ id: "assistantTidy", kind: "action", group: "assistant" }), "Assistant");
  assert.equal(nav.sectionLabel({ id: "settings:settings-updates", kind: "action", group: "settings" }), "Settings", "the Settings cards booklet.js files");
  assert.equal(nav.sectionLabel(null), null);
  assert.deepEqual({ ...nav.RAIL_SLOTS }, { community: "foot", friends: "friends", "the-lobby": "friends", rooms: "friends", "your-pcs": "friends", playground: "friends", "project-hub": "friends" });
  assert.ok(Object.isFrozen(nav.RAIL_SLOTS), "only nav places destinations in the rail");
  const ranks = ["workspace", "tasks", "command", "booklet", "friends-page", "studio", "help"].map((id) => nav.sectionRank(nav.get(id)));
  assert.deepEqual(ranks, [0, 0, 1, 2, 3, 4, 5], "ranks follow the rail from top to bottom: Work, Map, Team, Friends, then Settings and Help at the foot");
  assert.ok(nav.sectionRank(COMMUNITY) > nav.sectionRank(nav.get("help")));
  assert.ok(nav.sectionRank({ id: "assistantTidy", kind: "action", group: "assistant" }) > nav.sectionRank(COMMUNITY));
});

test("the rail is one tab stop, resting on a button the collapsed rail still shows", () => {
  const workspace = load({ search: "?shell=rail" });
  workspace.nav.applyShell();
  const [work, ...others] = tabStops(workspace.rail());
  assert.equal(others.length, 0, "exactly one tab stop");
  assert.ok(work.classList.contains("app-rail-head") && work.dataset.section === "work", "the workspace (Home) is Work's head");
  const command = load({ search: "?shell=rail", view: "command" });
  command.nav.applyShell();
  const stops = tabStops(command.rail());
  assert.equal(stops.length, 1);
  assert.ok(stops[0].classList.contains("app-rail-head") && stops[0].dataset.section === "map", "the Command view is the Map's head, and it holds the stop");
  assert.equal(command.rail().querySelector('[aria-current="page"]').dataset.nav, "command");
});

test("the rail arrows reach every Friends child as one roving tab stop", async () => {
  const loaded = load({ init: true });
  const rail = loaded.rail();
  let current = rail.querySelector('.app-rail-head[data-section="friends"]');
  for (const id of ["the-lobby", "rooms", "your-pcs", "playground", "project-hub"]) {
    await rail.trigger("keydown", { key: "ArrowDown", target: current });
    current = rail.querySelector(`.app-rail-friends [data-nav="${id}"]`);
    assert.equal(current.focused, true);
    assert.deepEqual(tabStops(rail), [current]);
  }
});

test("pinning is remembered", () => {
  const loaded = load({ search: "?shell=rail" });
  loaded.nav.applyShell();
  loaded.nav.setRailPinned(true);
  assert.equal(loaded.document.documentElement.dataset.railPinned, "");
  assert.equal(loaded.get("app-rail-pin").getAttribute("aria-pressed"), "true");
  assert.equal(loaded.store.get("mefiStudio.railPinned"), "1");
  assert.ok(loaded.events.includes("resize"), "the layers offset by the rail get to measure again");
});

test("the default pin yields in narrow windows and honours an explicit collapsed preference", () => {
  const narrow = load({ init: true, width: 900 });
  assert.equal(narrow.document.documentElement.dataset.railPinned, undefined);
  assert.equal(narrow.store.has("mefiStudio.railPinned"), false, "responsive layout does not write a preference");
  narrow.window.innerWidth = 1280;
  narrow.fire("resize");
  assert.equal(narrow.document.documentElement.dataset.railPinned, undefined, "with no saved choice the menu opens by itself only in a wide window");
  narrow.window.innerWidth = 1680;
  narrow.fire("resize");
  assert.equal(narrow.document.documentElement.dataset.railPinned, "");
  assert.equal(narrow.store.has("mefiStudio.railPinned"), false, "still no preference written");
  const laptop = load({ init: true, width: 1460 });
  assert.equal(laptop.document.documentElement.dataset.railPinned, undefined, "the default 1460 px window starts with the compact rail, so the page and the list column keep their room");
  const chosen = load({ init: true, width: 1460, stored: { "mefiStudio.railPinned": "1" } });
  assert.equal(chosen.document.documentElement.dataset.railPinned, "", "a saved pin still holds down to 1100 px");
  const collapsed = load({ init: true, width: 1280, stored: { "mefiStudio.railPinned": "0" } });
  assert.equal(collapsed.document.documentElement.dataset.railPinned, undefined);
  assert.equal(collapsed.get("app-rail-pin").getAttribute("aria-pressed"), "false");
});

test("Help opens its grouped menu and Escape closes it with focus restored", async () => {
  const loaded = load({ init: true });
  const toggle = loaded.document.getElementById("app-help-toggle");
  await toggle.click();
  assert.equal(loaded.document.getElementById("app-help-menu").hidden, false);
  loaded.nav.handleKey({key: "Escape", preventDefault() {}});
  assert.equal(loaded.document.getElementById("app-help-menu").hidden, true);
  assert.equal(toggle.focused, true);
});

test("workspace tools are regions while temporary sheets stay modal", () => {
  const loaded = load({ ids: ["tasks-overlay", "profiler-overlay"] });
  for (const id of ["tasks-overlay", "profiler-overlay"]) {
    const sheet = loaded.document.createElement("section");
    sheet.className = "sheet";
    loaded.get(id).append(sheet);
  }
  loaded.nav.applyShell();
  loaded.nav.claim("tasks");
  assert.equal(loaded.get("tasks-overlay").classList.contains("workspace-page"), true);
  assert.equal(loaded.get("tasks-overlay").querySelector(".sheet").getAttribute("role"), "region");
  assert.equal(loaded.get("tasks-overlay").querySelector(".sheet").getAttribute("aria-modal"), null);
  loaded.nav.claim("profiler");
  assert.equal(loaded.get("profiler-overlay").querySelector(".sheet").getAttribute("role"), "dialog");
  assert.equal(loaded.get("profiler-overlay").querySelector(".sheet").getAttribute("aria-modal"), "true");
});

test("opening a workspace page skips hidden focus targets and keeps background controls inert", () => {
  const loaded = load({ids:["analyzer-overlay","analyzer-idea","tab-studio"]});
  const sheet = loaded.document.createElement("section"); sheet.className="sheet";
  const selected = loaded.document.createElement("button"); selected.setAttribute("aria-selected","true");
  const field = loaded.get("analyzer-idea"); field.hidden=true;
  sheet.append(field,selected); loaded.get("analyzer-overlay").append(sheet);
  loaded.nav.applyShell(); loaded.nav.claim("analyzer"); loaded.flushFrames();
  assert.equal(field.focused, undefined);
  assert.equal(selected.focused,true);
  assert.equal(loaded.get("tab-studio").inert,true);
  loaded.nav.release("analyzer");
  assert.equal(loaded.get("tab-studio").inert,false);
});

test("model routes and legacy appearance/audio shortcuts use their canonical views", () => {
  const loaded = load(); const views = [];
  loaded.window.MefiModelLab = {show: view => views.push(view)};
  let audioOpened = 0;
  loaded.window.MefiMusic = {openAudio: () => { audioOpened++; }};
  for (const route of ["graph", "usage", "context"]) loaded.nav.go(route);
  assert.deepEqual(views, ["rankings", "usage", "context"]);
  loaded.nav.go("music");
  assert.deepEqual({...loaded.tabs.at(-1)[1]}, {section:"appearance"});
  loaded.nav.go("music", {group:"sound"});
  assert.equal(audioOpened, 1);
  assert.deepEqual({...loaded.tabs.at(-1)[1]}, {section:"appearance"}, "the audio dropdown leaves the underlying page in place");
});

test("model routes survive Command and retain the selected Usage reading", () => {
  const loaded = load({view:"page"}), views=[];
  const page=loaded.document.createElement("section"); page.id="tab-graph"; page.hidden=false; loaded.document.body.append(page);
  loaded.window.MefiModelLab={show:view=>views.push(view)};
  loaded.window.MefiIdle.enter=()=>loaded.setView("command");
  loaded.window.MefiIdle.exit=()=>loaded.setView("page");
  loaded.nav.go("usage");
  loaded.fire("mefi:model-view",{detail:{view:"tracker"}});
  loaded.nav.go("command");
  assert.equal(loaded.nav.state.commandFrom,"usage");
  loaded.nav.leaveCommand();
  assert.equal(views.at(-1),"tracker");
  loaded.nav.go("context");
  loaded.nav.go("command");
  assert.equal(loaded.nav.state.commandFrom,"context");
  loaded.nav.leaveCommand();
  assert.equal(views.at(-1),"context");
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

test("the shortcut sheet groups every key by the rail's places, with Esc under Help", () => {
  const { nav, document } = load();
  const grid = document.createElement("div");
  nav.renderHelp(grid);
  const title = (group) => group.querySelector("h4").textContent;
  assert.deepEqual(grid.children.map(title), ["Work", "Team and Map", "Settings", "Help"], "Home is Work's; Agents is Team, with the Map's page");
  const keysIn = (name) => grid.children.find((group) => title(group) === name).querySelectorAll("kbd").map((cap) => cap.textContent);
  assert.deepEqual(keysIn("Work"), ["H", "T", "P", "I", "A"]);
  assert.deepEqual(new Set(keysIn("Team and Map")), new Set(["B", "D", "3", "E", "J", "O", "G", "1", "2", "/", "R"]));
  assert.deepEqual(keysIn("Settings"), ["4", "Ctrl ,", "Ctrl Shift ,", "U"]);
  assert.deepEqual(keysIn("Help"), ["Ctrl K", "?", "Esc"]);
  for (const group of grid.children) assert.equal(group.getAttribute("aria-labelledby"), group.querySelector("h4").id);
  // The Command view's own rows arrive from idle.js and get the last group: the Map's.
  nav.register({ id: "idle-fit", kind: "action", group: "command", key: "F", label: "Fit the view", showIn: { help: true } });
  nav.renderHelp(grid);
  assert.equal(title(grid.children.at(-1)), "Map");
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
  assert.equal(loaded.get("page-title").textContent, "Performance");
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

// ---- the 0.5 layout (html[data-layout="v2"]): the prototype's rail ----------------------------------------------------
// docs/prototype/mefi-studio-0.5-v5.html, railView: Work, Map, Team and Friends at the top; Search, Settings and Help at
// the foot. The places are a reading of the same records (placeOf). It is the only rail: the cases above draw it too.
const v2Rail = (options = {}) => { const loaded = load({ search: "?shell=rail", layout: "v2", ...options }); loaded.nav.applyShell(); return loaded; };
const SETUP_HELPER = { id: "setup-helper", label: "Setup helper", short: "Setup", kind: "overlay", layer: "sheet", section: "agents", group: "tools", glyph: "g-agents", showIn: { palette: true, help: true, tools: true }, open() {}, close() {}, isOpen: () => false };
const RELEASE_NOTES = { id: "release-notes", label: "What's new in this version", short: "Release notes", kind: "action", layer: null, section: "help", group: "system", glyph: "g-spark", showIn: { palette: true }, run() {} };
const REPORT = { id: "settings:report", label: "Settings › Report a problem", short: "Report a problem", kind: "action", layer: null, section: "settings", group: "system", glyph: "g-gauge", showIn: { palette: true }, run() {} };

test("in the 0.5 layout the rail is the prototype's: Work, Map, Team and Friends, then Search, Settings and Help at its foot", async () => {
  const { nav, rail, document } = v2Rail();
  assert.deepEqual(heads(rail()), ["work", "map", "team", "friends"], "the prototype's places, in its order");
  const targets = Object.fromEntries(rail().querySelectorAll(".app-rail-head").map((head) => [head.dataset.section, head.dataset.nav]));
  assert.deepEqual(targets, { work: "workspace", map: "command", team: "agents", friends: "friends" }, "each place opens a route that already existed: Home is Work › Today, the Command view is the Map, Agents is Team");
  assert.deepEqual(rail().querySelectorAll(".app-rail-head .app-rail-text").map((label) => label.textContent), ["Work", "Map", "Team", "Friends"]);
  assert.deepEqual(rail().querySelectorAll(".app-rail-head").map((head) => head.getAttribute("aria-label")), ["Work", "Map", "Team", "Friends"]);
  assert.deepEqual(rail().querySelectorAll(".app-rail-head use").map((use) => use.getAttribute("href")), ["#g-tasks", "#g-command", "#g-community", "#g-chat"], "the prototype's glyphs: a list, a graph, two people, a speech bubble");
  assert.deepEqual(rail().querySelectorAll(".app-rail-head [data-badge]").map((badge) => badge.dataset.badge), ["tasks", "progress", "questions"], "Work keeps the open-task count, the Map the live dot, Team the decisions waiting");
  const footRow = document.getElementById("app-rail-foot").children;
  assert.deepEqual(footRow.filter((node) => node.dataset?.nav).map((button) => button.dataset.nav), ["palette", "studio"], "Search and Settings at the foot, then Help");
  assert.deepEqual(footRow.filter((node) => node.classList?.contains("app-rail-foot-item")).map((button) => button.getAttribute("aria-label") || button.querySelector(".label").textContent), ["Search", "Settings", "Help"]);
  assert.equal(rail().querySelector("#app-rail-foot .app-rail-search .key"), null, "the foot's tiles carry a word, not a keycap; the title says the key");
  assert.equal(rail().querySelector('#app-rail-foot [data-nav="palette"]').title, "Search (Ctrl K)");
  assert.equal(document.getElementById("app-rail-compose"), null, "New task is the session list's (Ctrl N), not the rail's");
  assert.equal(document.getElementById("app-rail-recent-list"), null, "the session list holds the tasks");
  assert.equal(rail().querySelector(".app-rail-vibe"), null, "the mode switch is the top bar's (Ctrl M)");
  assert.deepEqual(rail().querySelectorAll('.app-rail-section[data-section="friends"] .app-rail-children [data-nav]').map((button) => button.dataset.nav), ["the-lobby", "rooms", "your-pcs", "playground", "project-hub"], "Friends keeps The Lobby, its three pages and the Project hub");
  // The Help menu: the prototype's six, each the record it always was, in its order; a late arrival redraws the foot.
  nav.register(COMMUNITY); nav.register(SETUP_HELPER); nav.register(RELEASE_NOTES); nav.register(REPORT);
  await settle();
  const menu = document.getElementById("app-help-menu");
  assert.equal(menu.hidden, true);
  assert.deepEqual(menu.querySelectorAll("[data-nav]").map((button) => [button.dataset.nav, button.querySelector(".label").textContent]), [["onboarding", "Start here"], ["setup-helper", "Setup guide"], ["help", "Shortcuts"], ["release-notes", "What's new"], ["settings:report", "Report a problem"], ["community", "Void Engine Discord"]]);
  nav.register({ ...RELEASE_NOTES, hidden: () => true });
  await settle();
  assert.ok(!document.getElementById("app-help-menu").querySelectorAll("[data-nav]").some((button) => button.dataset.nav === "release-notes"), "no release notes this version: the row is left out");
  const placed = rail().querySelectorAll("[data-nav]").map((button) => button.dataset.nav);
  assert.equal(new Set(placed).size, placed.length, "no destination is listed twice");
});

test("in the 0.5 layout the rail lights the place you are in: Home is Work's, the Command view and Fleet the Map's, Agents and its pages Team's", () => {
  const where = (view, sheet) => {
    const loaded = v2Rail({ view });
    if (sheet) { loaded.nav.state.sheet = sheet; loaded.nav.paintRail(); }
    const lit = loaded.rail().querySelectorAll('[aria-current="page"]').map((button) => button.dataset.section || button.dataset.nav);
    const current = loaded.rail().querySelectorAll(".app-rail-section.current").map((group) => group.dataset.section);
    return [lit, current];
  };
  assert.deepEqual(where("workspace"), [["work"], ["work"]]);
  assert.deepEqual(where("workspace", "tasks"), [["work"], ["work"]]);
  assert.deepEqual(where("command"), [["map"], ["map"]]);
  assert.deepEqual(where("workspace", "fleet"), [["map"], ["map"]]);
  assert.deepEqual(where("workspace", "agents"), [["team"], ["team"]]);
  for (const page of ["skills", "brains", "explorer", "trace", "overhead"]) assert.deepEqual(where("workspace", page), [["team"], ["team"]], page);
  const settings = v2Rail({ view: null });
  settings.window.MefiMusic = { settingsAppearanceActive: () => true };
  settings.nav.paintRail();
  assert.deepEqual(settings.rail().querySelectorAll('[aria-current="page"]').map((button) => button.dataset.nav), ["studio"], "Settings at the foot is lit on Settings");
});

test("in the 0.5 layout a place's head goes back to where you were in it, and from inside it to its first page", async () => {
  const loaded = v2Rail();
  const opened = [];
  loaded.window.MefiTasks = { open: (params) => opened.push(["tasks", params]) };
  loaded.window.MefiAgents = { open: (params) => opened.push(["agents", params]) };
  loaded.window.MefiWorkspace.enter = () => opened.push(["workspace", {}]);
  const clickHead = async (place) => { await loaded.document.body.trigger("click", { target: loaded.rail().querySelector(`.app-rail-head[data-section="${place}"]`) }); opened.push(JSON.parse(JSON.stringify(opened.pop()))); };
  await clickHead("team");
  assert.deepEqual(opened.at(-1), ["agents", {}], "an unvisited place opens its first page");
  loaded.nav.go("agents", { section: "setup", pane: "routing" });
  loaded.nav.go("tasks", { filter: "open" });
  loaded.nav.state.sheet = "tasks";
  await clickHead("team");
  assert.deepEqual(opened.at(-1), ["agents", { section: "setup", pane: "routing" }], "Team comes back where you were in it");
  loaded.nav.state.sheet = "agents";
  await clickHead("team");
  assert.deepEqual(opened.at(-1), ["agents", {}], "from inside Team, its head is its Overview");
  await clickHead("work");
  assert.equal(opened.at(-1)[0], "tasks", "Work comes back to the Task board you were on");
  loaded.nav.state.sheet = "tasks";
  await clickHead("work");
  assert.deepEqual(opened.at(-1), ["workspace", {}], "from inside Work, its head is Today (Home)");
});

test("in the 0.5 layout records are named and ranked by their place, history is kept per place, and the prototype's names are routes", () => {
  const loaded = v2Rail();
  const { nav } = loaded;
  const label = (id) => nav.sectionLabel(nav.get(id));
  assert.equal(label("workspace"), "Work");
  for (const id of ["tasks", "plans", "ideas", "worktrees"]) assert.equal(label(id), "Work", id);
  for (const id of ["command", "fleet", "agent-brain"]) assert.equal(label(id), "Map", id);
  for (const id of ["agents", "brains", "eyes", "explorer", "overhead", "skills", "booklet", "graph", "usage", "context", "trace"]) assert.equal(label(id), "Team", id);
  for (const id of ["studio", "music", "profiler"]) assert.equal(label(id), "Settings", id);
  assert.equal(nav.placeOf("agent-brain", { tab: "playbook" }), "team", "the Agent brain's Playbook and Project map are Team › Workflows");
  assert.equal(nav.placeOf("agent-brain", { tab: "live" }), "map", "its live pipelines are Map › Pipelines");
  assert.equal(nav.get("command").label, "Map", "the Command view is called the Map");
  assert.equal(nav.get("command").short, "Map");
  const ranks = ["workspace", "command", "agents", "friends", "studio", "help"].map((id) => nav.sectionRank(nav.get(id)));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "ranks follow the rail from top to bottom");
  // go("team") and go("map") are the Agents page and the Command view.
  const opened = [];
  loaded.window.MefiAgents = { open: (params) => opened.push(["agents", params]) };
  loaded.window.MefiIdle.enter = (_flag, params) => opened.push(["command", params]);
  nav.go("team", { place: "providers" });
  nav.go("map");
  assert.deepEqual(opened.map(([id]) => id), ["agents", "command"]);
  assert.deepEqual(opened[0][1], { place: "providers" });
  // Each place keeps its own history: Back within the Map never lands in Team, and the reverse.
  const fresh = v2Rail();
  fresh.window.MefiAgents = { open() {} };
  fresh.window.MefiFleet = { open() {} };
  fresh.nav.go("agents", { place: "providers" });
  fresh.nav.state.sheet = "agents";
  assert.equal(fresh.nav.historyState().canBack, true, "Team's first page has its Overview behind it");
  fresh.nav.go("fleet");
  fresh.nav.state.sheet = "fleet";
  assert.equal(fresh.nav.historyState().canBack, false, "Fleet is the Map's first page here: nothing of Team's is behind it");
});

test("the rail draws the places whatever html[data-layout] says: a suite turning the frame off gets no classic rail back", () => {
  const loaded = load({ search: "?shell=rail" });
  loaded.nav.applyShell();
  assert.equal(loaded.document.documentElement.dataset.layout, undefined);
  assert.deepEqual(heads(loaded.rail()), ["work", "map", "team", "friends"], "before the layout is applied");
  loaded.nav.applyLayout(true);
  assert.deepEqual(heads(loaded.rail()), ["work", "map", "team", "friends"]);
  loaded.nav.applyLayout(false);
  assert.deepEqual(heads(loaded.rail()), ["work", "map", "team", "friends"], "the frame off, the places stay");
  assert.equal(loaded.nav.get("command").label, "Map", "the Command view is the Map with the frame off too");
  assert.equal(loaded.nav.sectionLabel(loaded.nav.get("agents")), "Team");
  assert.equal(loaded.document.getElementById("app-rail-compose"), null, "no New task button comes back");
  assert.equal(loaded.document.getElementById("app-rail-recent-list"), null, "nor the Recent tasks list");
});
