// The Command view's controls in the 0.5 layout: the Map. Its bar (Map | Fleet | Pipelines, Running only, View ▾), a View
// menu of Layout, Labels, Camera and View, the colours of the four states, and Fit and zoom. The classic top bar (brand
// and live pills, the Add a task composer, the find box, the Agents, Camera, View, Sound and Leave clusters), its View ▾,
// Ambience and Agent settings popovers, the hint line and the dock are gone; their homes are the status bar, New task (N),
// Search (S), the Map's own controls, Settings › Map look and Sound, and Team › Overview. The template and stylesheet are
// read as text and the idle.js handlers run in a vm against small fake elements, so no Electron or real DOM is needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = (name) => readFile(new URL(`../renderer/${name}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const [idle, template, styles] = await Promise.all([source("idle.js"), source("booklet.template.html"), source("styles.css")]);

function section(start, end) {
  const a = idle.indexOf(start), b = idle.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing section ${start}`);
  return idle.slice(a, b);
}

// The markup of the div whose start tag begins at `marker`, through its
// matching </div>; only divs nest inside the regions read here.
function block(marker) {
  const start = template.indexOf(marker);
  assert.ok(start >= 0, `the template has ${marker}`);
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match; (match = tags.exec(template));) {
    depth += match[0] === "</div>" ? -1 : 1;
    if (depth === 0) return template.slice(start, match.index + 6);
  }
  return assert.fail(`${marker} never closes`);
}
const button = (html, id) => html.match(new RegExp(`<button[^>]*\\bid="${id}"[\\s\\S]*?</button>`))?.[0] ?? "";
const controlIds = (html) => [...html.matchAll(/<(?:button|select)\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]);

const hud = template.slice(template.indexOf('<div id="idle-hud" hidden>'), template.indexOf('<div class="overlay" id="palette-overlay"'));
const mapBar = block('<div id="map-bar"');
const mapMenu = block('<div id="map-view-pop"');
const mapZoom = block('<div id="map-zoom"');
const mapStyles = styles.slice(styles.indexOf("*/", styles.indexOf("   The Map (layout v2; docs/unified-studio.md \"The Map\")")) + 2);

test("the classic top bar, its popovers, the hint line and the dock are gone from the HUD, the code and the stylesheet", () => {
  assert.ok(hud.length > 0, "the HUD is in the template");
  for (const marker of ['class="cmd-top"', 'id="idle-view-pop"', 'id="idle-ambience-pop"', 'id="cmd-settings"', 'id="cmd-hint"', 'id="cmd-dock"', 'id="cmd-usage-toggle"', 'id="cmd-usage-pop"',
    'id="idle-telemetry"', 'id="idle-task-input"', 'id="idle-search"', 'id="idle-agent-settings"', 'id="idle-feed-agent-mode"', 'id="idle-fit"', 'id="idle-orbit"', 'id="idle-music-toggle"', 'id="idle-exit"']) {
    assert.ok(!template.includes(marker), `${marker} is gone`);
  }
  for (const gone of ["placePop", "openAgentSettings", "toggleAmbience", "openViewMenu", "closeUsagePop", "renderHint", "updateTelemetry", "addTaskFromComposer", "stopAllAgents"]) {
    assert.ok(!idle.includes(gone), `idle.js has no ${gone}`);
  }
  for (const gone of [".cmd-top", ".cmd-tools", ".cmd-hint", ".cmd-dock", ".cmd-view-pop", ".cmd-agents-pop", "#idle-ambience-pop", ".usage-pop"]) {
    assert.ok(!styles.includes(gone), `styles.css has no ${gone}`);
  }
  // What the keys say in the help sheet: Space is the spin, C the camera, and N and S open the frame's New task and Search.
  for (const row of ['["cmd-orbit", "Space", "Pause / resume the spin"]', '["cmd-cam", "C", "Camera: overview / follow / free"]', '["cmd-search", "S", "Search Studio"]', '["cmd-compose", "N", "New task"]']) {
    assert.ok(idle.includes(row), row);
  }
});

test("Ambience's rows live in Settings: Backdrop, Speech bubbles, Card style and Zen mode in Map look, the bells in Sound", () => {
  const rows = (host) => {
    const start = template.indexOf(`<div id="${host}">`);
    assert.ok(start >= 0, `#${host} is in the template`);
    const end = template.indexOf("</div>", start);
    return [...template.slice(start, end).matchAll(/<label\b[^>]*>[\s\S]*?\bid="([^"]+)"/g)].map((match) => match[1]);
  };
  assert.deepEqual(rows("settings-tree-controls"), ["idle-backdrop", "idle-bubbles", "idle-card-style", "idle-ambient-zen"]);
  assert.deepEqual(rows("settings-audio-controls"), ["idle-profile", "idle-zen"]);
  // idle.js still fills and wires each of them; booklet.js no longer has to carry them over from a popover.
  for (const field of ["backdrop", "bubbles", "cardStyle", "ambientZen", "profile", "zen"]) {
    assert.match(idle, new RegExp(`el\\.${field} = document\\.getElementById\\("idle-`), `el.${field} is looked up`);
    assert.match(idle, new RegExp(`el\\.${field}\\.addEventListener\\("change"`), `el.${field} saves on change`);
  }
});

// ---- the Map (layout v2) ------------------------------------------------------------------------------------------------
test("the Map's bar links its three pages and holds Running only and View ▾, as the prototype's Map draws them", () => {
  assert.match(mapBar, /^<div id="map-bar" class="map-bar" role="toolbar" aria-label="Map">/);
  const pages = [...mapBar.matchAll(/<button type="button" class="map-page" data-nav="([^"]+)"(?: data-nav-params='([^']+)')?([^>]*)>([^<]+)<\/button>/g)].map((match) => [match[4], match[1], match[2] ? JSON.parse(match[2]) : null, /aria-current="page"/.test(match[3])]);
  assert.deepEqual(pages, [["Map", "command", null, true], ["Fleet", "fleet", null, false], ["Pipelines", "agent-brain", { tab: "live" }, false]], "Map is Command, Fleet is Fleet, Pipelines is the Agent brain's live pipelines");
  assert.match(mapBar, /<div class="map-pages" role="group" aria-label="Map pages">/);
  assert.match(button(mapBar, "map-running-only"), /aria-pressed="false"/);
  assert.match(button(mapBar, "map-running-only"), /<use href="#g-bolt"\/><\/svg><span>Running only<\/span>/);
  assert.match(button(mapBar, "map-view-menu"), /aria-haspopup="menu" aria-expanded="false" aria-controls="map-view-pop"/);
  assert.equal((template.match(/<symbol id="g-bolt"/g) ?? []).length, 1, "the bolt is in the sprite once");
});

test("the Map's View ▾ holds Layout, Labels (L), Camera (C), View (V) with the spin, and the way to Settings › Map look", () => {
  assert.match(mapMenu, /^<div id="map-view-pop" class="pop map-view-pop" role="menu" aria-labelledby="map-view-menu" hidden>/);
  const heads = [...mapMenu.matchAll(/<div class="map-menu-head" id="[^"]+">([^<]+)(?:<kbd>([^<]+)<\/kbd>)?<\/div>/g)].map((match) => [match[1].trim(), match[2] ?? null]);
  assert.deepEqual(heads, [["Layout", null], ["Labels", "L"], ["Camera", "C"], ["View", "V"]]);
  assert.match(mapMenu, /<div id="map-layouts" class="map-layouts"><\/div>/, "the layouts are music.js's, filled when the menu opens");
  const radios = (key) => [...mapMenu.matchAll(new RegExp(`role="menuitemradio" tabindex="-1" aria-checked="(?:true|false)" data-map-${key}="([^"]+)"[^>]*>([^<]+)<`, "g"))].map((match) => [match[1], match[2]]);
  assert.deepEqual(radios("labels"), [["auto", "Auto"], ["updates", "Updates"], ["all", "All"], ["none", "None"]], "the four label modes L cycles");
  assert.deepEqual(radios("cam"), [["orbit", "Overview"], ["follow", "Follow"], ["free", "Free"]], "the three camera modes C cycles; orbit reads Overview");
  assert.deepEqual(radios("view"), [["2d", "Flat map"], ["3d", "3D orbit"]]);
  assert.match(button(mapMenu, "map-spin"), /role="menuitemcheckbox" tabindex="-1" aria-checked="true"><span>Spin<\/span><small>Turns the 3D orbit <kbd>Space<\/kbd><\/small>/);
  assert.match(button(mapMenu, "map-look"), /role="menuitem" tabindex="-1" data-nav="studio" data-nav-params='\{"section":"looks"\}'>Map look</);
  assert.match(mapMenu, /<b>Look of the nodes<\/b><small>Style, colours and movement are in Settings\.<\/small>/);
  // Fit and zoom under the tree; the four state colours beside the Legend.
  assert.deepEqual(controlIds(mapZoom), ["map-fit", "map-zoom-out", "map-zoom-in"]);
  const corner = template.slice(template.indexOf('<div id="cmd-legend"'), template.indexOf('<div id="cmd-empty"'));
  assert.ok(corner.indexOf('id="map-legend"') > 0 && corner.indexOf('id="map-legend"') < corner.indexOf('id="idle-legend-toggle"'), "the state colours come first in the corner, then the Legend");
  assert.deepEqual(controlIds(corner), ["idle-legend-toggle"], "the Legend is the corner's one control: usage is the status bar's");
});

test("the Map's styles apply only with the frame and keep every text at 12 px or more", () => {
  assert.ok(mapStyles.length > 0, "the Map block is in styles.css");
  assert.match(mapStyles, /\n#map-bar, #map-zoom, #map-legend \{ display: none; \}\n/, "without the frame none of it is drawn");
  const rules = mapStyles.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((rule) => rule.trim()).filter((rule) => rule.includes("{"));
  for (const rule of rules) {
    const selector = rule.slice(0, rule.lastIndexOf("{")).replace(/^@media[^{]*\{/, "").trim();
    if (selector === "#map-bar, #map-zoom, #map-legend") continue;
    for (const part of selector.split(/,(?![^(]*\))/)) assert.match(part.trim(), /^html\[data-frame\] /, `"${part.trim()}" waits for the frame`);
  }
  assert.match(mapStyles, /--fs-2xs: var\(--f12, 12px\); --fs-xs: var\(--f12, 12px\);/, "the HUD's size tokens read at least 12 px");
  for (const size of mapStyles.matchAll(/font(?:-size)?:[^;]*?\b(\d+(?:\.\d+)?)px/g)) assert.ok(Number(size[1]) >= 12, `no text under 12 px: ${size[0]}`);
  assert.ok(!/transition:[^;]*\d+m?s\b/.test(mapStyles), "motion only on the tokens");
});

// The Map's handlers: syncMapMenu, the menu, Running only and the keys, against small fakes.
function mapFixture({ music = true } = {}) {
  const document = {
    activeElement: null, listeners: [],
    addEventListener(type, fn) { this.listeners.push([type, fn]); },
    removeEventListener(type, fn) { this.listeners = this.listeners.filter((entry) => entry[0] !== type || entry[1] !== fn); },
    createElement(tag) { return node(tag); },
    documentElement: { dataset: { frame: "on" } },
  };
  function node(name, extra = {}) {
    return {
      name, attrs: {}, dataset: {}, style: {}, parent: null, hidden: false, disabled: false, children: [], textContent: "", tabIndex: 0,
      get childElementCount() { return this.children.length; },
      setAttribute(key, value) { this.attrs[key] = String(value); },
      getAttribute(key) { return this.attrs[key] ?? null; },
      append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } },
      focus() { document.activeElement = this; },
      contains(other) { for (let at = other; at; at = at.parent) if (at === this) return true; return false; },
      closest(selector) { for (let at = this; at; at = at.parent) { if (selector === "[hidden]" && at.hidden) return at; if (selector === ".map-menu-group" && at.name === "group") return at; } return null; },
      ...extra,
    };
  }
  const all = (root) => root.children.flatMap((child) => [child, ...all(child)]);
  const pop = node("pop", { hidden: true });
  pop.querySelectorAll = (selector) => {
    const items = all(pop);
    const attribute = selector.match(/^\[data-map-(\w+)\]$/)?.[1];
    if (attribute) return items.filter((item) => item.dataset[`map${attribute[0].toUpperCase()}${attribute.slice(1)}`] !== undefined);
    return items.filter((item) => /^menuitem/.test(item.attrs.role ?? ""));
  };
  const group = node("group");
  const layouts = node("layouts");
  group.append(layouts);
  const radio = (key, value) => { const item = node(`${key}:${value}`); item.attrs.role = "menuitemradio"; item.dataset[key] = value; return item; };
  pop.append(group);
  const seg = (key, values) => { const box = node("seg"); box.append(...values.map((value) => radio(key, value))); pop.append(box); return box; };
  seg("mapLabels", ["auto", "updates", "all", "none"]);
  seg("mapCam", ["orbit", "follow", "free"]);
  seg("mapView", ["2d", "3d"]);
  const spin = node("spin"); spin.attrs.role = "menuitemcheckbox";
  const look = node("look"); look.attrs.role = "menuitem"; look.dataset.nav = "studio";
  pop.append(spin, look);
  const el = { mapPop: pop, mapLayouts: layouts, mapSpin: spin, mapViewBtn: node("view-btn"), mapRunningOnly: node("running-only") };
  const calls = [];
  const stored = {};
  const window = {
    MefiMusic: music ? { nodeLayouts: () => [["constellation", "Constellation", "An open arrangement"], ["tree", "Branches", "A clear hierarchy"], ["radial", "Rings", "Concentric groups"], ["helix", "Helix", "A rising spiral"], ["layers", "Terraces", "Stacked levels"]].map(([key, name, detail]) => ({ key, name, detail })), applyNodeLayout: (key) => { calls.push(`layout:${key}`); state.nodeLayout = key; } } : null,
    MefiSessions: { newTask: () => calls.push("new task") },
    MefiNav: { go: (id) => calls.push(`go:${id}`) },
  };
  const state = { active: true, mapOn: false, runningOnly: false, nodeLayout: "constellation", labels: "auto", camMode: "orbit", view: "3d", orbit: "auto", zoom: 1 };
  const env = vm.createContext({
    el, state, document, window,
    writeStore: (key, value) => { stored[key] = value; },
    bumpHud() {},
    setLabels: (mode) => { calls.push(`labels:${mode}`); state.labels = mode; },
    setCamMode: (mode) => { calls.push(`cam:${mode}`); state.camMode = mode; },
    setView: (mode) => { calls.push(`view:${mode}`); state.view = mode; },
    setOrbit: () => { calls.push("spin"); state.orbit = state.orbit === "paused" ? "auto" : "paused"; },
  });
  vm.runInContext(section("  // ---------- the Map (layout v2) ----------", "  // ---------- lifecycle ----------"), env);
  const key = (name) => {
    const event = { key: name, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    env.mapMenuKey(event);
    return event;
  };
  return { env, el, state, document, window, calls, stored, pop, layouts, spin, look, key, items: () => [...env.mapMenuItems()] };
}

test("the Map's View ▾ opens on its first item with the layouts music.js names, checks what is in force, and closes on Esc, Tab or an outside click", () => {
  const { env, el, state, document, calls, layouts, spin, key, items } = mapFixture();
  env.syncMapOn();
  assert.equal(state.mapOn, true, "the frame is up");
  env.openMapMenu();
  assert.equal(el.mapPop.hidden, false);
  assert.equal(el.mapViewBtn.attrs["aria-expanded"], "true");
  assert.deepEqual(calls.splice(0), [], "opening it calls nothing else: it is the HUD's one popover");
  assert.deepEqual(layouts.children.map((item) => [item.dataset.mapLayout, item.children[0].textContent, item.children[1].textContent, item.attrs.role]), [
    ["constellation", "Constellation", "An open arrangement", "menuitemradio"], ["tree", "Branches", "A clear hierarchy", "menuitemradio"], ["radial", "Rings", "Concentric groups", "menuitemradio"], ["helix", "Helix", "A rising spiral", "menuitemradio"], ["layers", "Terraces", "Stacked levels", "menuitemradio"]]);
  assert.equal(document.activeElement, layouts.children[0], "focus lands on the first item");
  const checked = () => items().filter((item) => item.attrs["aria-checked"] === "true").map((item) => item.name === "spin" ? "spin" : Object.values(item.dataset)[0]);
  assert.deepEqual(checked(), ["constellation", "auto", "orbit", "3d", "spin"]);
  // Choices go to the same functions as the keys; a layout goes to music.js, which saves it.
  env.mapMenuChoose({ target: { closest: () => layouts.children[3] } });
  env.mapMenuChoose({ target: { closest: () => items().find((item) => item.dataset.mapLabels === "none") } });
  env.mapMenuChoose({ target: { closest: () => items().find((item) => item.dataset.mapCam === "follow") } });
  env.mapMenuChoose({ target: { closest: () => items().find((item) => item.dataset.mapView === "2d") } });
  assert.deepEqual(calls.splice(0), ["layout:helix", "labels:none", "cam:follow", "view:2d"]);
  env.syncMapMenu();
  assert.deepEqual(checked(), ["helix", "none", "follow", "2d"], "a flat map has no spin to show");
  assert.equal(spin.disabled, true);
  assert.equal(spin.title, "Spin turns the 3D orbit only");
  assert.equal(el.mapViewBtn.title, "View: flat map · labels none · camera follow", "View ▾ names what is in force");
  env.mapMenuChoose({ target: { closest: () => spin } });
  assert.deepEqual(calls.splice(0), [], "a disabled Spin does nothing");
  state.view = "3d"; env.syncMapMenu();
  env.mapMenuChoose({ target: { closest: () => spin } });
  assert.deepEqual(calls.splice(0), ["spin"]);
  // Keys: arrows walk every item and stop there; Esc closes onto the button; Tab closes and carries on.
  env.openMapMenu();
  const first = document.activeElement;
  const down = key("ArrowDown");
  assert.ok(down.prevented && down.stopped, "an arrow never also walks the tree");
  assert.notEqual(document.activeElement, first);
  key("End"); assert.equal(document.activeElement, items().at(-1));
  key("ArrowDown"); assert.equal(document.activeElement, items()[0], "the walk wraps");
  const letter = key("l");
  assert.ok(!letter.prevented && !letter.stopped, "L, C and V still reach the tree's keys");
  const escape = key("Escape");
  assert.ok(escape.prevented && escape.stopped);
  assert.equal(el.mapPop.hidden, true);
  assert.equal(document.activeElement, el.mapViewBtn, "focus returns to View ▾");
  assert.equal(document.listeners.length, 0, "the outside-click listener goes with it");
  env.toggleMapMenu();
  const tab = key("Tab");
  assert.ok(!tab.prevented, "Tab is not swallowed: it carries on from the button");
  assert.equal(el.mapPop.hidden, true);
  env.toggleMapMenu();
  const outside = document.listeners.find(([type]) => type === "mousedown")[1];
  outside({ target: layouts.children[0] });
  assert.equal(el.mapPop.hidden, false, "a click inside keeps it up");
  outside({ target: { name: "canvas" } });
  assert.equal(el.mapPop.hidden, true);
  // The frame going away closes it.
  env.openMapMenu();
  document.documentElement.dataset.frame = undefined;
  env.syncMapOn();
  assert.equal(state.mapOn, false);
  assert.equal(el.mapPop.hidden, true);
});

test("syncViewControls hands the camera, labels, view and spin to the Map's View ▾", () => {
  const { env, el, state, pop } = mapFixture();
  vm.runInContext(section("  // The Map's View ▾ (layout v2) says what is in force, one choice per row.", "  function setOrbit("), env);
  Object.assign(state, { labels: "all", camMode: "free", view: "3d", orbit: "paused" });
  env.syncViewControls();
  // The menu is closed, and still says it: it reads true the moment it opens.
  const checked = [...pop.querySelectorAll("[role]")].filter((item) => item.attrs["aria-checked"] === "true").map((item) => Object.values(item.dataset)[0]);
  assert.deepEqual(checked, ["all", "free", "3d"]);
  assert.equal(el.mapSpin.attrs["aria-checked"], "false");
  assert.equal(el.mapSpin.title, "Spin paused · Space resumes");
  // Without the Map there is nothing to write to, and nothing throws.
  const bare = vm.createContext({ el: {}, syncMapMenu: () => assert.fail("no menu, no sync") });
  vm.runInContext(section("  // The Map's View ▾ (layout v2) says what is in force, one choice per row.", "  function setOrbit("), bare);
  bare.syncViewControls();
});

test("without music.js the menu has no Layout row, never made-up names", () => {
  const { env, layouts } = mapFixture({ music: false });
  env.openMapMenu();
  assert.equal(layouts.children.length, 0);
  assert.equal(layouts.parent.hidden, true);
});

test("Running only is remembered, says so on its button, and dims only what is not running, only with the frame", () => {
  const { env, el, stored } = mapFixture();
  env.setRunningOnly(true);
  assert.equal(stored["mefiStudio.cmdRunningOnly"], "1");
  assert.equal(el.mapRunningOnly.attrs["aria-pressed"], "true");
  assert.match(el.mapRunningOnly.title, /^Running only is on/);
  env.setRunningOnly(false);
  assert.equal(stored["mefiStudio.cmdRunningOnly"], "0");
  assert.equal(el.mapRunningOnly.attrs["aria-pressed"], "false");
  assert.match(idle, /runningOnly: readStore\("mefiStudio\.cmdRunningOnly"\) === "1",/, "read back on the next launch");
  // emphasis(): the frame's Running only dims to .25 whatever is not running; the search still wins; without the frame nothing dims.
  const lit = vm.createContext({ state: { query: "", matchSet: new Set(), camMode: "orbit", follow: null, branch: null, runningOnly: true, mapOn: true } });
  vm.runInContext(section("  // What Running only (the Map, layout v2) keeps lit", "  // A native <select> picker paints"), lit);
  const nodes = {
    running: { id: "t1", kind: "task", _workLabel: "Running" }, active: { id: "t2", kind: "task", state: "active" },
    verifying: { id: "t3", kind: "task", _workLabel: "Verifying", state: "active" }, queued: { id: "t4", kind: "task", _workLabel: "Next" },
    agent: { id: "a1", kind: "agent", status: "running" }, idleAgent: { id: "a2", kind: "agent", status: "done" },
    todo: { id: "d1", kind: "todo", status: "in_progress" }, doneTodo: { id: "d2", kind: "todo", status: "completed" },
    root: { id: "root", kind: "root" }, assistant: { id: "assistant", kind: "assistant" }, session: { id: "s1", kind: "session" },
  };
  const emphasis = Object.fromEntries(Object.entries(nodes).map(([name, node]) => [name, lit.emphasis(node)]));
  assert.deepEqual(emphasis, { running: 1, active: 1, verifying: 0.25, queued: 0.25, agent: 1, idleAgent: 0.25, todo: 1, doneTodo: 0.25, root: 1, assistant: 1, session: 0.25 });
  lit.state.query = "queued"; lit.state.matchSet = new Set(["t4"]);
  assert.equal(lit.emphasis(nodes.queued), 1, "a search match stays bright");
  lit.state.query = ""; lit.state.mapOn = false;
  assert.equal(lit.emphasis(nodes.queued), 1, "without the frame there is no Running only switch, so nothing dims");
  // The wires dim with their ends, behind the same two flags.
  assert.match(idle, /const lifetime = Math\.min\(a\.node\._fade \?\? 1, b\.node\._fade \?\? 1\) \* \(state\.runningOnly && state\.mapOn && !\(runningLit\(a\.node\) && runningLit\(b\.node\)\) \? 0\.3 : 1\);/);
});

test("N starts a New task and S opens Search, as the prototype's Map keys do, with or without the frame", () => {
  const calls = [];
  const state = { active: true, mapOn: true, selected: null };
  const env = vm.createContext({ state, el: {}, window: { MefiSessions: { newTask: () => calls.push("new task") }, MefiNav: { go: (id) => calls.push(`go:${id}`) } }, document: { body: { dataset: {} } } });
  vm.runInContext(section("  // The keys N and S open what the frame has", "  // ---------- lifecycle ----------"), env);
  vm.runInContext(section("  function handleKey(event) {", "  // One Esc step"), env);
  const press = (key) => env.handleKey({ key, target: { closest: () => null }, shiftKey: false });
  assert.equal(press("n"), true); assert.equal(press("s"), true);
  assert.deepEqual(calls.splice(0), ["new task", "go:palette"]);
  state.mapOn = false;
  press("n"); press("s");
  assert.deepEqual(calls.splice(0), ["new task", "go:palette"], "there is no classic composer or find box to fall back to");
  const handleKey = section("  function handleKey(event) {", "  // One Esc step");
  assert.ok(!/mapMenu|mapPop/.test(handleKey), "the canvas shortcuts are untouched by the menu");
});

test("Esc closes what opened last: the Map's View ▾, then the Legend and a state it holds lit, before the search, the node or Command", async () => {
  const calls = [];
  const shown = (visible) => ({ hidden: false, checkVisibility: () => visible });
  const el = { mapPop: { hidden: false }, legendList: shown(true) };
  const state = { active: true, legendOpen: true, legendPin: "held", query: "task", focusMode: false, focus: null, selected: { id: "n" } };
  const env = vm.createContext({
    el, state,
    closeMapMenu: (options) => { calls.push(["map", options]); el.mapPop.hidden = true; },
    setLegend: (open) => { calls.push(["legend", open]); state.legendOpen = open; },
    pinLegend: (key) => { calls.push(["pin", key]); state.legendPin = key; },
    clearSearch: () => { calls.push(["search"]); state.query = ""; },
    setFocusMode() {},
    releaseNode: () => { calls.push(["node"]); state.selected = null; },
    leave: () => calls.push(["leave"]),
  });
  vm.runInContext(section("  // Whether a HUD list can be seen", "  // ---------- keyboard ----------"), env);
  vm.runInContext(section("  // One Esc step per press", "  // Leave Command for the view it was entered from"), env);
  assert.equal(env.escape(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.splice(0))), [["map", { focus: true }]], "one Esc, one popover");
  env.escape(); assert.deepEqual(calls.splice(0), [["legend", false]], "then the Legend");
  env.escape(); assert.deepEqual(calls.splice(0), [["pin", null]], "then the state the legend holds lit");
  // nav.js's Escape asks the Map to let go of a held state before it opens the companion, which takes Esc otherwise.
  const nav = await source("nav.js");
  const branch = nav.slice(nav.indexOf('    if (event.key === "Escape") {\n      // A state the Map'), nav.indexOf("      closeTop();\n", nav.indexOf('    if (event.key === "Escape") {\n      // A state the Map')));
  assert.ok(branch.indexOf("window.MefiIdle?.releaseLegendPin?.()") > 0 && branch.indexOf("window.MefiIdle?.releaseLegendPin?.()") < branch.indexOf("window.MefiCompanionHub?.open()"), "the held state lets go first");
  assert.match(idle, /releaseLegendPin: \(\) => \(state\.active && state\.legendPin \? pinLegend\(null\) : false\),/);
  env.escape(); assert.deepEqual(calls.splice(0), [["search"]]);
  env.escape(); assert.deepEqual(calls.splice(0), [["node"]]);
  env.escape(); assert.deepEqual(calls.splice(0), [["leave"]], "Command goes last");
  // A Legend the ≤1100px layout hides still reports open; Esc does not spend a press closing what nobody can see.
  state.legendOpen = true; state.query = "again";
  el.legendList = shown(false);
  env.escape();
  assert.deepEqual(calls.splice(0), [["search"]]);
  assert.equal(state.legendOpen, true);
});

// The legend's pills (renderMapLegend, paintLegendCounts, pointLegend, pinLegend) against small fakes.
function legendFixture({ pointing = true } = {}) {
  const writes = [];
  const node = (tag) => ({
    tag, className: "", type: "", title: "", dataset: {}, attrs: {}, children: [], textContent: "",
    style: { props: {}, setProperty(key, value) { this.props[key] = value; } },
    setAttribute(key, value) { writes.push([key, String(value)]); this.attrs[key] = String(value); },
    append(...items) { this.children.push(...items); },
  });
  const host = { children: [], attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, get childElementCount() { return this.children.length; }, append(...items) { this.children.push(...items); } };
  const LEGEND = [{ key: "active", sw: "rgb(1, 1, 1)" }, { key: "verify", sw: "rgb(2, 2, 2)" }, { key: "done", sw: "rgb(3, 3, 3)" }, { key: "held", sw: "rgb(4, 4, 4)" }];
  const state = { mapLegendPoint: pointing, legendHover: null, legendPin: null, styleBurstUntil: 0, glanceCounts: { active: 3, held: 1, verify: 0, done: 0 }, glanceShown: { active: 0, held: 0, verify: 0, done: 0 } };
  const el = { mapLegend: host, announce: { textContent: "" } };
  let wakes = 0;
  const env = vm.createContext({ el, state, LEGEND, LEGEND_KEYS: ["active", "held", "verify", "done"], document: { createElement: node }, wakeFrames: () => { wakes += 1; } });
  vm.runInContext(section("  // The Map's legend (layout v2)", "  function renderLegend() {"), env);
  return { env, el, state, host, writes, wakes: () => wakes };
}

test("the Map's legend names the four states in the colours of their legend rows", () => {
  const { env, host } = legendFixture();
  env.renderMapLegend();
  env.renderMapLegend();
  assert.deepEqual(host.children.map((row) => [row.children[1].textContent, row.children[0].dataset.sw, row.children[0].style.props["--sw"]]), [
    ["Running", "active", "rgb(1, 1, 1)"], ["Needs you", "held", "rgb(4, 4, 4)"], ["Review", "verify", "rgb(2, 2, 2)"], ["Done", "done", "rgb(3, 3, 3)"]], "drawn once, in the prototype's order");
  assert.match(idle, /el\.mapLegend\?\.querySelector\(`\[data-sw="\$\{key\}"\]`\)\?\.style\.setProperty\("--sw", rgb\(tint\)\);/, "a theme change recolours them with the Legend");
});

test("the legend's states are pills: each counts its nodes, says so to screen readers, and a click holds it lit until clicked again", () => {
  const { env, el, state, host, writes, wakes } = legendFixture();
  env.renderMapLegend();
  assert.deepEqual(host.children.map((row) => [row.tag, row.type, row.dataset.state, row.attrs["aria-pressed"], row.children.length]), [
    ["button", "button", "active", "false", 3], ["button", "button", "held", "false", 3], ["button", "button", "verify", "false", 3], ["button", "button", "done", "false", 3]]);
  assert.equal(host.attrs["aria-label"], "Work on the Map by state");
  // The counts: the frame's, written once, again only when one moves.
  env.paintLegendCounts();
  assert.deepEqual(host.children.map((row) => [row.children[2].textContent, row.attrs["aria-label"], row.dataset.count]), [
    ["3", "Running: 3 on the Map", "3"], ["1", "Needs you: 1 on the Map", "1"], ["0", "Review: 0 on the Map", "0"], ["0", "Done: 0 on the Map", "0"]]);
  assert.equal(host.children[0].children[2].attrs["aria-hidden"], "true", "the number is read once, in the pill's name");
  assert.match(host.children[1].title, /^Needs you: 1 on the Map\. Point to light them up, click to keep them lit\.$/);
  writes.length = 0;
  env.paintLegendCounts();
  assert.deepEqual(writes, [], "an unchanged frame writes nothing");
  state.glanceCounts.verify = 2;
  env.paintLegendCounts();
  assert.deepEqual(writes, [["aria-label", "Review: 2 on the Map"]], "one count moved, one pill is written");
  // Pointing: the hovered pill, a burst at the display's rate.
  assert.equal(env.pointLegend("held"), true);
  assert.equal(state.legendHover, "held");
  assert.ok(state.styleBurstUntil > 0 && wakes() === 1, "the highlight eases in at the hot cadence");
  assert.equal(env.pointLegend("held"), false, "the same pill is no change");
  assert.equal(env.pointLegend("nonsense"), true); assert.equal(state.legendHover, null);
  // Holding: aria-pressed on the one held, and a line for screen readers.
  assert.equal(env.pinLegend("held"), true);
  assert.equal(state.legendPin, "held");
  assert.deepEqual(host.children.map((row) => row.attrs["aria-pressed"]), ["false", "true", "false", "false"]);
  assert.equal(el.announce.textContent, "Showing Needs you: 1 on the Map. Press Esc or choose Needs you again to show everything.");
  assert.equal(env.pinLegend("held"), false, "holding it again changes nothing");
  assert.equal(env.pinLegend(null), true);
  assert.deepEqual(host.children.map((row) => row.attrs["aria-pressed"]), ["false", "false", "false", "false"]);
  assert.equal(el.announce.textContent, "Showing everything on the Map again.");
  el.announce.textContent = "";
  env.pinLegend("done", { announce: false });
  assert.equal(el.announce.textContent, "", "letting go quietly (the Map closing) says nothing");
  // The click handler toggles: the same pill again lets go.
  const click = section("  function init() {", "  // The broadcast carries the list");
  assert.ok(click.includes('el.mapLegend?.addEventListener("click", (event) => { const pill = legendPillOf(event.target); if (pill) pinLegend(state.legendPin === pill.dataset.state ? null : pill.dataset.state); });'));
  assert.ok(click.includes('el.mapLegend?.addEventListener("pointerleave", () => pointLegend(null));'), "leaving the row lets go of the hover");
  assert.match(click, /addEventListener\("focusin", \(event\) => \{ const pill = legendPillOf\(event\.target\); if \(pill\?\.matches\?\.\(":focus-visible"\)\) pointLegend\(pill\.dataset\.state\); \}\);/, "a keyboard focus points as the pointer does");
});

test("with mefiStudio.mapLegendPoint off the legend is the plain colour keys it was", () => {
  const { env, el, state, host } = legendFixture({ pointing: false });
  env.renderMapLegend();
  assert.deepEqual(host.children.map((row) => [row.tag, row.children.length, row.dataset.state]), [["span", 2, undefined], ["span", 2, undefined], ["span", 2, undefined], ["span", 2, undefined]]);
  assert.equal(host.attrs["aria-label"], undefined, "the template's group label stays");
  assert.equal(el.legendPills, null);
  env.paintLegendCounts();
  assert.equal(env.pinLegend("held"), false, "nothing can be held");
  assert.equal(state.legendPin, null);
});
