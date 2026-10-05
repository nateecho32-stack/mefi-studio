// The layout contract's script half (renderer/nav.js, "the layout contract"):
// the one writer of html[data-layout], the setter that clamps the four regions,
// the fold rule and usable(). The whole of nav.js runs here against the shared
// fake DOM, with a computed style that answers the way styles.css does (the
// fold rule included), so these break when the script and the stylesheet drift.
// Real geometry is tests/shell_render.test.mjs (the frame in a real window).
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, readdir } from "node:fs/promises";

import { createDom } from "./fixtures/renderer-dom.mjs";

// The sources are read with LF line ends whatever the checkout made of them (Windows may give CRLF), since some checks look at lines.
const lf = (text) => text.replace(/\r\n/g, "\n");
const source = lf(await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8"));
const RAIL_IDS = ["app-rail", "app-rail-brand", "app-rail-sections", "app-rail-foot", "app-rail-pin", "app-local-nav", "vibe-rail", "workspace-sidebar", "workspace-layer"];
const REGION_VARIABLES = { list: "--shell-list-w", inspector: "--shell-inspector-w", tabs: "--shell-tabs-h", status: "--shell-status-h" };

// A window of `width` x `height` CSS px with the rail shell on: the rail's real
// box, the local navigation's, and a computed style for the root and the body.
function load({ search = "", stored = {}, width = 1440, height = 900, matchMedia = true, rail = 64, localH = 56, railBox, navBox, vibeBox, layoutSearch } = {}) {
  const { document, get } = createDom({ ids: RAIL_IDS });
  const lookupId = document.getElementById;
  document.getElementById = (id) => lookupId(id) ?? document.querySelector(`#${id}`);
  document.readyState = "loading";
  const root = document.documentElement;
  const props = {};
  root.style = { props, setProperty: (name, value) => { props[name] = String(value); }, removeProperty: (name) => { delete props[name]; }, getPropertyValue: (name) => props[name] ?? "" };
  get("app-rail").append(get("app-rail-brand"), get("app-rail-sections"), get("app-rail-foot"), get("app-rail-pin"));
  const store = new Map(Object.entries(stored));
  const listeners = {}, events = [], added = [];
  const box = (left, top, right, bottom) => (right - left > 0 && bottom - top > 0 ? { left, top, right, bottom, width: right - left, height: bottom - top } : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  const boxes = {
    "app-rail": () => railBox ?? box(0, 0, rail, window.innerHeight),
    "app-local-nav": () => navBox ?? box(rail, 0, window.innerWidth, localH),
    "vibe-rail": () => vibeBox ?? box(0, 0, 0, 0),
  };
  for (const [id, measure] of Object.entries(boxes)) get(id).getBoundingClientRect = measure;
  const window = {
    innerWidth: width, innerHeight: height,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); added.push(type); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] ?? []).filter((item) => item !== fn); },
    dispatchEvent: (event) => { events.push(event.type); for (const fn of [...(listeners[event.type] ?? [])]) fn(event); return true; },
    MefiWorkspace: { isActive: () => false }, MefiIdle: { isActive: () => false },
    MefiBooklet: { showTab() {} }, MefiToast() {},
  };
  // The media query the stylesheet uses: max-width in CSS px.
  if (matchMedia) window.matchMedia = (query) => ({ matches: window.innerWidth <= Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1]) });
  // styles.css by hand: the four regions are 0px unless something wrote them, and
  // below 900px, in v2, the list and the inspector are forced to 0px (!important).
  const sheet = { "--shell-rail-w": `${rail}px`, "--shell-local-h": `${localH}px` };
  const getComputedStyle = (node) => ({
    getPropertyValue(name) {
      if (root.dataset.layout === "v2" && window.innerWidth < 900 && (name === "--shell-list-w" || name === "--shell-inspector-w")) return "0px";
      if (name in props) return props[name];
      if (name in sheet) return sheet[name];
      return Object.values(REGION_VARIABLES).includes(name) ? "0px" : "";
    },
  });
  const context = vm.createContext({
    window, document, console, getComputedStyle,
    location: { search: layoutSearch ?? search },
    localStorage: { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) },
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    URLSearchParams,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0,
  });
  vm.runInContext(source, context);
  const nav = window.MefiNav;
  return {
    nav, window, document, root, props, store, events, added, listeners, sheet,
    resize(next) { Object.assign(window, next); for (const fn of [...(listeners.resize ?? [])]) fn({ type: "resize" }); },
    regions: () => Object.fromEntries(Object.entries(REGION_VARIABLES).map(([name, variable]) => [name, props[variable]])),
  };
}
const v2 = (options = {}) => { const page = load(options); page.nav.applyLayout(true); return page; };
// What the vm's objects say, in this realm, so deepStrictEqual compares values and not prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));

test("the writer: the 0.5 layout at every launch (0.5.0); no query, saved choice or shell choice brings the classic one back", () => {
  const cases = [
    // [search, stored, why]
    ["", {}, "a plain launch"],
    ["", { "mefiStudio.layout": "v1" }, "a classic choice saved before 0.5.0 is not read"],
    ["?layout=v1", {}, "?layout= is not read"],
    ["?capture=1", {}, "a capture launch"],
    ["?smoke=1", {}, "a smoke launch"],
    ["?shell=classic", { "mefiStudio.shell": "classic" }, "the classic shell choice is not read either"],
  ];
  for (const [search, stored, why] of cases) {
    const { nav, root } = load({ search, stored });
    assert.equal(nav.applyLayout(), true, `${search || "(no query)"} ${JSON.stringify(stored)}: ${why}`);
    assert.equal(root.dataset.layout, "v2", `${why}: the attribute`);
  }
  // A store that throws, and no location at all, are the same.
  const { document } = createDom({ ids: RAIL_IDS });
  const bare = vm.createContext({ window: { innerWidth: 500, innerHeight: 400, addEventListener() {} }, document: { ...document, readyState: "loading", addEventListener() {} }, console, localStorage: { getItem() { throw new Error("blocked"); } } });
  vm.runInContext(source, bare);
  assert.equal(bare.window.MefiNav.applyLayout(), true, "a blocked store and no location: v2");
});

test("data-shell keeps its one writer and its one value: the layout is a second attribute", () => {
  const { nav, root } = load({ search: "?shell=classic", stored: { "mefiStudio.shell": "classic" } });
  assert.equal(nav.applyShell(), true, "the rail is the only shell, whatever was asked or saved");
  assert.equal(root.dataset.shell, "rail");
  nav.applyLayout(true);
  assert.equal(root.dataset.shell, "rail", "v2 is not a third data-shell value");
  assert.equal(root.dataset.layout, "v2");
  nav.applyLayout(false);
  assert.equal(root.dataset.shell, "rail", "a suite that turns the layout off leaves the shell alone");
});

test("the layout has one writer in the renderer, and data-shell is only ever given the value rail", async () => {
  const names = (await readdir(new URL("../renderer/", import.meta.url))).filter((name) => name.endsWith(".js") && name !== "booklet.js");
  const writes = [];
  const shellValues = [];
  for (const name of names) {
    const text = lf(await readFile(new URL(`../renderer/${name}`, import.meta.url), "utf8"));
    text.split("\n").forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, "");
      // Other elements carry a data-layout of their own (a choice popup's "tiles"), and
      // their variable is often called root too; the page's is the document element.
      const page = name === "nav.js" ? "(?:root|document\\.documentElement)" : "document\\.documentElement";
      if (new RegExp(`${page}\\.dataset\\.layout(?!Fold)\\b\\s*=(?!=)|${page}\\.dataset\\[["']layout["']\\]\\s*=(?!=)|delete\\s+${page}\\.dataset\\.layout(?!Fold)\\b|${page}\\.(?:set|remove)Attribute\\(["']data-layout["']`).test(code)) writes.push(`${name}:${index + 1}`);
      if (new RegExp(`${page}\\.dataset\\.layoutFold\\s*=(?!=)|delete\\s+${page}\\.dataset\\.layoutFold|${page}\\.(?:set|remove)Attribute\\(["']data-layout-fold["']`).test(code)) writes.push(`${name}:${index + 1} (fold)`);
      const shell = /dataset\.shell\s*=(?!=)\s*(.+?);/.exec(code);
      if (shell) shellValues.push(`${name}: ${shell[1]}`);
    });
  }
  assert.ok(writes.length >= 2 && writes.every((place) => place.startsWith("nav.js:")), `only nav.js writes data-layout and data-layout-fold: ${writes.join(", ")}`);
  const layoutLines = writes.map((place) => Number(/:(\d+)/.exec(place)[1]));
  const lines = source.split("\n");
  const enclosing = layoutLines.map((line) => { for (let at = line - 1; at >= 0; at -= 1) { const found = /^  function (\w+)\(/.exec(lines[at]); if (found) return found[1]; } return null; });
  assert.deepEqual([...new Set(enclosing)].sort(), ["applyLayout", "clearLayout", "paintLayout"], "the attribute is written by applyLayout, the fold attribute by paintLayout and clearLayout");
  assert.deepEqual(shellValues, ['nav.js: "rail"'], `data-shell is given one value, rail, in one place: ${shellValues.join("; ")}`);
});

test("a page a suite looks at without the frame wires nothing: no attribute, no inline style, no listener, and the setter does nothing", () => {
  for (const [search, stored] of [["", {}], ["?capture=1", {}]]) {
    const page = load({ search, stored });
    page.nav.applyShell();
    const before = page.added.length;
    page.nav.applyLayout(false);
    assert.equal(page.added.length, before, "no listener");
    assert.equal(page.root.dataset.layout, undefined);
    assert.equal(page.root.dataset.layoutFold, undefined);
    assert.deepEqual(page.props, {}, "no inline variable");
    assert.equal(page.nav.layout.on(), false);
    assert.equal(page.nav.layout.set("list", 280), 0, "set() answers 0 in v1");
    assert.equal(page.nav.layout.set("status", 28), 0);
    assert.deepEqual(page.props, {});
    assert.deepEqual(plain(page.nav.layout.get()), { list: 0, inspector: 0, tabs: 0, status: 0 });
    assert.ok(!page.events.includes("mefi:layout"), "the layout announces nothing in v1");
    assert.equal(page.store.has("mefiStudio.layout"), "mefiStudio.layout" in stored, "applyLayout stores nothing of its own");
  }
});

test("v2 with no region built leaves no trace either: zeros in the stylesheet, nothing inline", () => {
  const page = v2({});
  assert.equal(page.root.dataset.layout, "v2");
  assert.deepEqual(page.props, {});
  assert.equal(page.root.dataset.layoutFold, undefined, "a wide window folds nothing");
  assert.deepEqual(plain(page.nav.layout.used()), { list: 0, inspector: 0, tabs: 0, status: 0 });
  assert.deepEqual(plain(page.nav.usable()), plain(load({}).nav.usable()), "with the regions at 0 the free area is v1's");
  assert.equal(page.events.filter((type) => type === "resize").length, 0, "nothing resized");
});

test("the setter clamps each region to its range and answers with what it got", () => {
  const page = v2({ width: 1920, height: 1080 });
  const { layout } = page.nav;
  assert.deepEqual(plain(layout.RANGES), { list: [0, 420], inspector: [0, 640], tabs: [0, 48], status: [0, 40] });
  assert.equal(layout.FOLD_BELOW, 900);
  assert.equal(layout.MAIN_MIN, 320);
  assert.equal(layout.set("list", 280), 280);
  assert.equal(layout.set("inspector", 400), 400);
  assert.equal(layout.set("tabs", 36), 36);
  assert.equal(layout.set("status", 28), 28);
  assert.deepEqual(page.regions(), { list: "280px", inspector: "400px", tabs: "36px", status: "28px" });
  assert.equal(layout.set("list", 9999), 420);
  assert.equal(layout.set("inspector", 9999), 640);
  assert.equal(layout.set("tabs", 9999), 48);
  assert.equal(layout.set("status", 9999), 40);
  assert.equal(layout.set("list", -40), 0, "below the range is 0");
  assert.equal(page.props["--shell-list-w"], undefined, "0 leaves no inline value");
  assert.equal(layout.set("list", 219.6), 220, "whole pixels");
  assert.equal(layout.set("list", "300"), 300, "a numeric string");
  assert.equal(layout.set("list", "wide"), 300, "a value that is no number changes nothing");
  assert.equal(layout.set("list", NaN), 300);
  assert.equal(layout.set("list", undefined), 300);
  assert.equal(layout.set("banner", 40), 0, "a region that does not exist");
  assert.ok(!("--shell-banner-w" in page.props));
  assert.deepEqual(plain(layout.get()), { list: 300, inspector: 640, tabs: 48, status: 40 });
  assert.equal(layout.get("inspector"), 640);
  layout.reset();
  assert.deepEqual(page.props, {});
});

test("the rail, the list and the inspector never leave the main area under 320px, and the inspector gives way first", () => {
  const page = v2({ width: 1000, height: 800 });
  const { layout } = page.nav;
  assert.equal(layout.set("inspector", 640), 616, "1000 - 64 (rail) - 320");
  assert.equal(layout.set("list", 420), 420, "the list keeps what it asked for");
  assert.equal(layout.used("inspector"), 196, "and the inspector gives way");
  assert.equal(layout.get("inspector"), 640, "what it asked for is kept for a wider window");
  const free = page.nav.usable();
  assert.equal(free.right - free.left, 320, "exactly the floor is left");
  // Wider again: the inspector comes back without anyone asking.
  page.resize({ innerWidth: 1600 });
  assert.equal(layout.used("inspector"), 640);
  assert.equal(page.props["--shell-inspector-w"], "640px");
  // A pinned rail takes 256px, and the room shrinks with it.
  page.sheet["--shell-rail-w"] = "256px";
  page.resize({ innerWidth: 1100 });
  assert.equal(layout.used("list"), 420);
  assert.equal(layout.used("inspector"), 104, "1100 - 256 - 420 - 320");
  assert.ok(page.nav.usable().right - page.nav.usable().left >= 320);
  // Nothing is ever negative, however small the window.
  page.resize({ innerWidth: 901 });
  assert.equal(layout.used("list") + layout.used("inspector") + 256 + 320 <= 901 || layout.used("list") + layout.used("inspector") === 0, true);
  for (const width of [1100, 1000, 950, 900, 901, 1300, 2000]) {
    page.resize({ innerWidth: width });
    const { list, inspector } = layout.used();
    assert.ok(list >= 0 && inspector >= 0);
    assert.ok(width - 256 - list - inspector >= 320 || list + inspector === 0, `${width}px keeps a main area`);
  }
});

test("below 900 CSS px the list and the inspector fold, and only they: zero width, data-layout-fold names them, the strips stay", () => {
  const page = v2({ width: 1440, height: 900 });
  const { layout } = page.nav;
  for (const [name, value] of Object.entries({ list: 280, inspector: 400, tabs: 36, status: 28 })) layout.set(name, value);
  assert.deepEqual(plain(layout.fold()), []);
  assert.equal(page.root.dataset.layoutFold, undefined);
  page.resize({ innerWidth: 899 });
  assert.equal(page.root.dataset.layoutFold, "list inspector", "named in the order the plan gives");
  assert.deepEqual(plain(layout.fold()), ["list", "inspector"]);
  assert.deepEqual(plain(layout.used()), { list: 0, inspector: 0, tabs: 36, status: 28 }, "the tab strip and the status bar keep their height");
  assert.deepEqual(plain(layout.get()), { list: 280, inspector: 400, tabs: 36, status: 28 }, "what each asked for is kept");
  assert.equal(page.props["--shell-list-w"], undefined);
  assert.equal(page.props["--shell-inspector-w"], undefined);
  assert.equal(page.props["--shell-tabs-h"], "36px");
  assert.deepEqual(plain(page.nav.usable()), { left: 64, top: 92, right: 899, bottom: 872, width: 835, height: 780 });
  // The same at the smallest window: 600px at 150% zoom is 400 CSS px.
  page.resize({ innerWidth: 400, innerHeight: 373 });
  assert.equal(page.root.dataset.layoutFold, "list inspector");
  assert.deepEqual(plain(page.nav.usable()), { left: 64, top: 92, right: 400, bottom: 345, width: 336, height: 253 });
  // 900 exactly is not narrow and 899.98 is, which is what (max-width: 899.98px) says.
  page.resize({ innerWidth: 900, innerHeight: 900 });
  assert.equal(page.root.dataset.layoutFold, undefined);
  assert.equal(layout.used("list"), 280, "they come back at 900");
  assert.equal(page.props["--shell-list-w"], "280px");
  page.resize({ innerWidth: 899.98 });
  assert.equal(page.root.dataset.layoutFold, "list inspector", "a fractional width under 900, as zoom makes");
  // Growing past the fold is enough; nobody has to ask again.
  page.resize({ innerWidth: 1200 });
  assert.equal(page.root.dataset.layoutFold, undefined);
  assert.equal(layout.used("inspector"), 400);
  // Without matchMedia the width decides, the same way.
  const noQuery = v2({ width: 1200, height: 900, matchMedia: false });
  noQuery.nav.layout.set("list", 280);
  noQuery.resize({ innerWidth: 899 });
  assert.equal(noQuery.root.dataset.layoutFold, "list inspector");
  noQuery.resize({ innerWidth: 900 });
  assert.equal(noQuery.root.dataset.layoutFold, undefined);
});

test("the fold rule in styles.css is the one in nav.js, and the variables and edges are defined once", async () => {
  const css = lf(await readFile(new URL("../renderer/styles.css", import.meta.url), "utf8"));
  const below = Number(/const LAYOUT_FOLD_BELOW = (\d+);/.exec(source)[1]);
  const media = /@media \(max-width: ([\d.]+)px\) \{\s*html\[data-layout="v2"\] \{([^}]*)\}\s*\}/.exec(css);
  assert.ok(media, "styles.css carries the fold rule");
  assert.equal(Number(media[1]), below - 0.02, "899.98px is FOLD_BELOW minus a hair");
  assert.match(media[2], /--shell-list-w: 0px !important; --shell-inspector-w: 0px !important;/, "both fold, with !important so the inline value loses");
  assert.doesNotMatch(media[2], /tabs|status/, "the strips do not fold");
  for (const variable of Object.values(REGION_VARIABLES)) {
    assert.equal(css.match(new RegExp(`^\\s*${variable}: 0px;`, "gm"))?.length, 1, `${variable} is defined once, at 0px`);
  }
  const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("\n}\n", css.indexOf(":root {")));
  for (const variable of Object.values(REGION_VARIABLES)) assert.ok(rootBlock.includes(`${variable}: 0px;`), `${variable} is in the :root block`);
  const edges = /:root, body \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(edges, /--shell-x0: calc\(var\(--shell-rail-w\) \+ var\(--shell-list-w\)\);/);
  assert.match(edges, /--shell-x1: var\(--shell-inspector-w\);/);
  assert.match(edges, /--shell-y0: calc\(var\(--shell-local-h\) \+ var\(--shell-tabs-h\)\);/);
  assert.match(edges, /--shell-y1: var\(--shell-status-h\);/);
  for (const edge of ["x0", "x1", "y0", "y1"]) assert.equal(css.match(new RegExp(`^\\s*--shell-${edge}:`, "gm"))?.length, 1, `--shell-${edge} is derived once`);
});

test("usable(): in v1 exactly what the rail readers measured, in v2 clear of the regions", () => {
  // v1: the right of the rail's box, below the local navigation's, to the window's other edges.
  const build = load({ width: 1440, height: 900 });
  assert.deepEqual(JSON.parse(JSON.stringify(build.nav.usable())), { left: 64, top: 56, right: 1440, bottom: 900, width: 1376, height: 844 });
  // The open rail covers the page, and its real box is what the readers used.
  const open = load({ width: 1440, height: 900, railBox: { left: 0, top: 0, right: 256, bottom: 900, width: 256, height: 900 } });
  assert.equal(open.nav.usable().left, 256);
  // No rail on screen (Vibe's own page, the classic shell): the window.
  const bare = load({ width: 1440, height: 900, railBox: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }, navBox: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } });
  assert.deepEqual(JSON.parse(JSON.stringify(bare.nav.usable())), { left: 0, top: 0, right: 1440, bottom: 900, width: 1440, height: 900 });
  // Nothing in the document at all (a page before its markup): still an answer.
  const empty = vm.createContext({ window: { innerWidth: 500, innerHeight: 400, addEventListener() {} }, document: { documentElement: { dataset: {} }, readyState: "loading", addEventListener() {}, getElementById: () => null }, console });
  vm.runInContext(source, empty);
  assert.deepEqual(JSON.parse(JSON.stringify(empty.window.MefiNav.usable())), { left: 0, top: 0, right: 500, bottom: 400, width: 500, height: 400 });

  // v2 with the sample regions.
  const page = v2({ width: 1440, height: 900 });
  for (const [name, value] of Object.entries({ list: 280, inspector: 400, tabs: 36, status: 28 })) page.nav.layout.set(name, value);
  assert.deepEqual(JSON.parse(JSON.stringify(page.nav.usable())), { left: 344, top: 92, right: 1040, bottom: 872, width: 696, height: 780 });
  // The open rail covers the list's left part; the free area does not move.
  page.nav.usable();
  const hover = v2({ width: 1440, height: 900, railBox: { left: 0, top: 0, right: 256, bottom: 900, width: 256, height: 900 } });
  hover.nav.layout.set("list", 280);
  assert.equal(hover.nav.usable().left, 344, "max(the open rail, rail + list)");
  const narrowList = v2({ width: 1440, height: 900, railBox: { left: 0, top: 0, right: 256, bottom: 900, width: 256, height: 900 } });
  narrowList.nav.layout.set("list", 120);
  assert.equal(narrowList.nav.usable().left, 256, "a list narrower than the open rail leaves the rail the last word");
  // A pinned rail: the variable and the box agree.
  const pinned = v2({ width: 1440, height: 900, rail: 256 });
  pinned.nav.layout.set("list", 280);
  assert.equal(pinned.nav.usable().left, 536);
  // The local navigation's own height follows the section (agents is 60px).
  const agents = v2({ width: 1440, height: 900, localH: 60 });
  agents.nav.layout.set("tabs", 36);
  assert.equal(agents.nav.usable().top, 96);
  // Vibe: its own rail is 72px; on its own page there is no rail at all.
  const vibe = v2({ width: 1440, height: 900, rail: 72, railBox: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }, vibeBox: { left: 0, top: 0, right: 72, bottom: 900, width: 72, height: 900 } });
  vibe.nav.layout.set("list", 280);
  assert.equal(vibe.nav.usable().left, 352, "the rail that is there (Vibe's, 72px) plus the list");
  const vibeHome = v2({ width: 1440, height: 900, rail: 72, railBox: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } });
  vibeHome.nav.layout.set("list", 280);
  assert.equal(vibeHome.nav.usable().left, 280, "with no rail on screen only the list is chrome");
  // Nor is there a local navigation there: the tab strip starts at the window's top, and the free area under it.
  const none = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  const vibeStrip = v2({ width: 1440, height: 900, rail: 72, railBox: none, navBox: none });
  vibeStrip.nav.layout.set("tabs", 36);
  assert.equal(vibeStrip.nav.usable().top, 36, "with no local navigation on screen the strip is all there is above");
});

test("usable() reads the variables the layers read, so a value in the root's style is what it reports", () => {
  const page = v2({ width: 1440, height: 900 });
  page.props["--shell-inspector-w"] = "333px";
  page.props["--shell-status-h"] = "31px";
  assert.equal(page.nav.usable().right, 1107, "the inspector's variable, not a number kept in a script");
  assert.equal(page.nav.usable().bottom, 869);
  // Only layout.set() is meant to write them (it clamps); the stylesheet's fold still wins over any inline value.
  page.resize({ innerWidth: 700 });
  assert.equal(page.nav.usable().right, 700, "folded, the same stray width counts for nothing");
});

test("turning v2 on and off tells whoever measures the window, and off puts everything back", () => {
  const page = load({ width: 1440, height: 900 });
  page.nav.applyShell();
  const fold = [];
  page.window.addEventListener("mefi:layout", (event) => fold.push({ ...event.detail }));
  page.nav.applyLayout(true);
  assert.equal(fold.length, 1);
  assert.equal(fold[0].on, true);
  page.nav.layout.set("list", 280);
  assert.equal(fold.length, 2);
  assert.equal(fold[1].list, 280);
  assert.ok(page.events.includes("resize"), "the orb, the media window and Command's graph measure again, as they do when the rail is pinned");
  const resizes = page.events.filter((type) => type === "resize").length;
  page.nav.layout.set("list", 280);
  assert.equal(page.events.filter((type) => type === "resize").length, resizes, "asking for what it already has says nothing");
  page.nav.layout.set("tabs", 36);
  page.nav.applyLayout(false);
  assert.equal(page.root.dataset.layout, undefined);
  assert.equal(page.root.dataset.layoutFold, undefined);
  assert.deepEqual(page.props, {}, "the inline variables go");
  assert.deepEqual(plain(page.nav.layout.get()), { list: 0, inspector: 0, tabs: 0, status: 0 }, "and what was asked for is forgotten");
  assert.equal(fold.at(-1).on, false, "off is announced once");
  const counted = fold.length;
  page.nav.applyLayout(false);
  assert.equal(fold.length, counted, "off again says nothing");
  assert.equal(page.listeners.resize?.length ?? 0, 0, "the resize listener is gone with v2");
  page.nav.applyLayout(true);
  page.nav.applyLayout(true);
  assert.equal(page.listeners.resize.length, 1, "and is not doubled by asking twice");
});

test("there is no setter for a layout choice any more, and applyLayout stores nothing", () => {
  const page = load({});
  assert.equal(typeof page.nav.setLayout, "undefined");
  page.nav.applyLayout();
  assert.equal(page.store.has("mefiStudio.layout"), false);
});

test("init applies the layout right after the shell, at every launch", () => {
  const launch = (options) => { const page = load(options); page.document.readyState = "complete"; page.nav.init(); return page; };
  for (const stored of [{}, { "mefiStudio.layout": "v1" }]) {
    const on = launch({ stored });
    assert.equal(on.root.dataset.layout, "v2", `${JSON.stringify(stored)}: the 0.5 layout`);
    assert.equal(on.root.dataset.shell, "rail", "next to the shell, not instead of it");
    assert.ok(on.events.indexOf("mefi:shell") < on.events.indexOf("mefi:layout"), "after applyShell");
  }
});

test("the shell exports the contract: layout, usable and applyLayout", () => {
  const { nav } = load({});
  for (const name of ["layout", "usable", "applyLayout"]) assert.ok(name in nav, `MefiNav.${name}`);
  for (const name of ["get", "set", "used", "fold", "on", "reset"]) assert.equal(typeof nav.layout[name], "function", `MefiNav.layout.${name}`);
  assert.equal(Object.isFrozen(nav.layout), true, "the setter object is not rewritten by a region");
});
