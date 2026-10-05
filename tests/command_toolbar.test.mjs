// The Command view toolbar after the menu regroup (2026-09-22): four labelled
// clusters and Leave in place of thirteen loose controls; the camera mode
// that was also called "Orbit" is now Overview with its own glyph, so Spin is
// the only control that turns the tree; 2D/3D, labels and zoom fold into a
// keyboard-operable View menu; and Ambience reads Look → Sound → Calm, hangs
// from its own button and hands the theme to Style & sound. The template and
// stylesheet are read as text and the idle.js handlers run in a vm against
// small fake elements, so no Electron or real DOM is needed. The painted
// layout (fit and overlap at 600×800) is tests/command_render.test.mjs.
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

const toolbar = block('<div class="cmd-tools"');
const viewMenu = block('<div id="idle-view-pop"');
const ambience = block('<div id="idle-ambience-pop"');

test("the toolbar groups Agents settings, Camera, View and Sound beside Leave", () => {
  assert.match(toolbar, /^<div class="cmd-tools" role="toolbar" aria-label="Command view controls">/);
  const groups = [...toolbar.matchAll(/<div class="cmd-tools-group" role="group" aria-label="([^"]+)">/g)].map((match) => match[1]);
  assert.deepEqual(groups, ["Agents", "Camera", "View", "Sound"]);
  assert.deepEqual(controlIds(toolbar), [
    "idle-agent-settings", "idle-feed-agent-mode",
    "idle-fit", "idle-cam-orbit", "idle-cam-follow", "idle-orbit",
    "idle-view-menu",
    "idle-music-toggle", "idle-ambience",
    "idle-exit",
  ], "Agents | Fit · Overview/Follow · Spin | View ▾ | Music · Ambience | Leave");
  assert.equal((toolbar.match(/<span class="tools-sep" aria-hidden="true"><\/span>/g) ?? []).length, 4, "one separator between each pair of clusters");
  assert.match(button(toolbar, "idle-exit"), /aria-label="Close Command view"/, "every sheet and overlay exit is labelled Close");
  // The quick agent-mode switch is pinned by command-render-electron.cjs: it
  // stays inside .cmd-tools (it is not a duplicate to tidy away).
  assert.ok(toolbar.includes('<select id="idle-feed-agent-mode"'));
  // What left the strip is one menu away, not gone.
  for (const id of ["idle-view", "idle-labels", "idle-zoom-out", "idle-zoom-in"]) {
    assert.ok(!toolbar.includes(`id="${id}"`), `#${id} left the strip`);
    assert.match(viewMenu, new RegExp(`<button id="${id}" [^>]*role="menuitem" tabindex="-1"`), `#${id} is an item of View ▾`);
  }
  assert.match(viewMenu, /^<div id="idle-view-pop" class="pop cmd-view-pop" role="menu" aria-labelledby="idle-view-menu" hidden>/);
  assert.match(button(toolbar, "idle-view-menu"), /aria-haspopup="menu" aria-expanded="false" aria-controls="idle-view-pop"/);
  // Overview and Follow stay two toggles, drawn as one segmented switch.
  const camera = block('<div class="cmd-seg"');
  assert.deepEqual(controlIds(camera), ["idle-cam-orbit", "idle-cam-follow"]);
  assert.match(camera, /^<div class="cmd-seg" role="group" aria-label="Camera mode">/);
});

test("Overview has its own frame glyph, and Spin is the one control that turns the tree", () => {
  assert.equal((template.match(/<symbol id="g-frame"/g) ?? []).length, 1, "g-frame is in the sprite once");
  const overview = button(toolbar, "idle-cam-orbit");
  assert.match(overview, /<use href="#g-frame"\/>/);
  assert.ok(!overview.includes("#g-fit"), "Overview no longer borrows Fit's glyph");
  assert.match(overview, /aria-label="Camera: overview"/);
  assert.match(overview, /<span class="label">Overview<\/span>/);
  assert.match(button(toolbar, "idle-fit"), /<use href="#g-fit"\/>/);
  const spin = button(toolbar, "idle-orbit");
  assert.match(spin, /aria-label="Spin"/);
  assert.match(spin, /title="Spin on · Space pauses"/);
  assert.ok(!/>Orbit<|"Orbit"|Camera: orbit/.test(toolbar), "no second Orbit on the strip");
  assert.ok(idle.includes('["cmd-orbit", "Space", "Pause / resume the spin"]'));
  assert.ok(idle.includes('["cmd-cam", "C", "Camera: overview / follow / free"]'));
});

function fakeButton(name) {
  return {
    name, attrs: {}, dataset: {}, title: "", disabled: false,
    labelNode: { textContent: "" },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return this.attrs[key] ?? null; },
    querySelector(selector) { return selector === ".label" ? this.labelNode : null; },
  };
}

test("syncViewControls names Spin and Overview and carries the folded state on View ▾", () => {
  const el = Object.fromEntries(["orbitBtn", "camOrbitBtn", "camFollowBtn", "viewBtn", "labelsBtn", "viewMenuBtn"].map((key) => [key, fakeButton(key)]));
  const state = { view: "3d", orbit: "auto", camMode: "orbit", labels: "auto", follow: null };
  const env = vm.createContext({ el, state });
  vm.runInContext(section("  function syncViewControls() {", "  function setOrbit("), env);
  env.syncViewControls();
  assert.equal(el.orbitBtn.title, "Spin on · Space pauses");
  assert.equal(el.orbitBtn.attrs["aria-pressed"], "true");
  assert.match(el.camOrbitBtn.title, /^Camera: overview — /);
  assert.ok(el.camOrbitBtn.title.includes("C cycles overview / follow / free"));
  assert.equal(el.viewBtn.attrs["aria-label"], "Map: 3D orbit");
  assert.equal(el.labelsBtn.attrs["aria-label"], "Node labels: auto");
  assert.equal(el.viewMenuBtn.title, "View: 3D orbit · labels auto · zoom");
  Object.assign(state, { view: "2d", orbit: "paused", labels: "none", camMode: "free" });
  env.syncViewControls();
  assert.equal(el.orbitBtn.disabled, true);
  assert.equal(el.orbitBtn.title, "Spin (3D view only)");
  assert.equal(el.camOrbitBtn.attrs["aria-pressed"], "false");
  assert.equal(el.viewBtn.labelNode.textContent, "2D");
  assert.equal(el.viewBtn.attrs["aria-label"], "Map: flat 2D");
  assert.equal(el.viewMenuBtn.title, "View: flat 2D map · labels none · zoom");
});

// A few elements with boxes, focus and containment: enough for the popover
// handlers, which only measure, show, hide and move focus.
function hudFixture({
  hud = { left: 64, top: 0, right: 1440, bottom: 900 },
  view = { left: 1100, right: 1180, top: 25, bottom: 59 },
  sound = { left: 1330, right: 1362, top: 25, bottom: 59 },
  strip = { bottom: 65 },
} = {}) {
  const box = (rect) => ({ width: rect.right - rect.left, height: rect.bottom - rect.top, ...rect });
  const document = {
    activeElement: null, listeners: [],
    addEventListener(type, fn) { this.listeners.push([type, fn]); },
    removeEventListener(type, fn) { this.listeners = this.listeners.filter((entry) => entry[0] !== type || entry[1] !== fn); },
  };
  const node = (name, extra = {}) => ({
    name, attrs: {}, style: {}, parent: null,
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return this.attrs[key] ?? null; },
    focus() { document.activeElement = this; },
    contains(other) { for (let at = other; at; at = at.parent) if (at === this) return true; return false; },
    ...extra,
  });
  const stripNode = node("strip", { getBoundingClientRect: () => box({ left: 700, right: 1416, top: 20, ...strip }) });
  const inStrip = (name, rect) => node(name, { parent: stripNode, getBoundingClientRect: () => box(rect), closest: (selector) => (selector === ".cmd-tools" ? stripNode : null) });
  const items = ["map", "labels", "zoom-out", "zoom-in"].map((name) => node(name, { disabled: false }));
  const viewPop = node("view-pop", { hidden: true, offsetWidth: 220, querySelectorAll: (selector) => (selector === "[role='menuitem']" ? items : []) });
  for (const item of items) item.parent = viewPop;
  const el = {
    hud: node("hud", { getBoundingClientRect: () => box(hud) }),
    viewMenuBtn: inStrip("view-menu", view), viewPop,
    ambienceBtn: inStrip("ambience", sound), pop: node("ambience-pop", { hidden: true, offsetWidth: 280 }),
    agentSettingsBtn: inStrip("agent-settings", view), settings: node("agent-settings-pop", { hidden: true, offsetWidth: 400 }),
    usagePop: null, legendList: null,
  };
  const window = { MefiUsageTracker: null };
  const calls = [];
  const env = vm.createContext({ el, document, window, state: { active: true }, Math, bumpHud() {}, renderSettingsPanel() {} });
  vm.runInContext(section("  // The toolbar's popovers hang from the button that opened them", "  // ---------- keyboard ----------"), env);
  const key = (name) => {
    const event = { key: name, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    env.viewMenuKey(event);
    return event;
  };
  return { env, el, document, window, items, key, calls };
}

test("Agents opens from the toolbar without changing selection and keeps owned dropdowns interactive", () => {
  const { env, el, document, window } = hudFixture();
  env.state.selected = "task:kept";
  env.state.railTab = "node";
  env.openViewMenu();
  env.openAgentSettings({ focus: true });
  assert.equal(el.viewPop.hidden, true);
  assert.equal(el.settings.hidden, false);
  assert.equal(el.agentSettingsBtn.attrs["aria-expanded"], "true");
  assert.equal(document.activeElement, el.settings);
  assert.equal(el.settings.style.top, "71px");
  assert.equal(env.state.selected, "task:kept");
  assert.equal(env.state.railTab, "node");
  const outside = document.listeners.find(([type]) => type === "pointerdown")[1];
  const option = {};
  let selectClosed = false;
  window.MefiSelect = { owns: (owner) => owner === el.settings, contains: (target) => target === option, close: () => { selectClosed = true; } };
  outside({ target: option });
  outside({ target: { parent: el.settings } });
  assert.equal(el.settings.hidden, false, "portal options and panel controls keep settings open");
  env.closeAgentSettings({ focus: true });
  assert.equal(selectClosed, true);
  assert.equal(el.settings.hidden, true);
  assert.equal(document.activeElement, el.agentSettingsBtn);
  assert.equal(document.listeners.length, 0);
  env.openAgentSettings();
  outside({ target: { name: "canvas" } });
  assert.equal(el.settings.hidden, true);
});

test("View ▾ opens onto its first item, arrows walk it, Esc and Tab hand focus back to its button", () => {
  const { env, el, document, items, key } = hudFixture();
  env.openViewMenu();
  assert.equal(el.viewPop.hidden, false);
  assert.equal(el.viewMenuBtn.attrs["aria-expanded"], "true");
  assert.equal(document.activeElement, items[0], "focus lands on Map");
  assert.equal(document.listeners.filter(([type]) => type === "mousedown").length, 1, "an outside click will close it");
  // Hung from its button: under the toolbar strip, right edges lined up.
  assert.equal(el.viewPop.style.top, "71px");
  assert.equal(el.viewPop.style.right, "260px");
  assert.equal(el.viewPop.style.maxHeight, "817px");

  const down = key("ArrowDown");
  assert.equal(document.activeElement, items[1]);
  assert.ok(down.prevented && down.stopped, "an arrow in the menu never reaches the node tree's arrows");
  key("ArrowRight"); assert.equal(document.activeElement, items[2]);
  key("End"); assert.equal(document.activeElement, items[3]);
  key("ArrowDown"); assert.equal(document.activeElement, items[0], "the walk wraps");
  key("ArrowUp"); assert.equal(document.activeElement, items[3]);
  key("Home"); assert.equal(document.activeElement, items[0]);
  const letter = key("v");
  assert.ok(!letter.prevented && !letter.stopped, "V and L still bubble to the canvas shortcuts from inside the menu");

  const escape = key("Escape");
  assert.ok(escape.prevented && escape.stopped, "Esc closes the menu, not Command");
  assert.equal(el.viewPop.hidden, true);
  assert.equal(el.viewMenuBtn.attrs["aria-expanded"], "false");
  assert.equal(document.activeElement, el.viewMenuBtn, "focus returns to View ▾");
  assert.equal(document.listeners.length, 0, "the outside-click listener goes with it");

  env.toggleViewMenu();
  assert.equal(el.viewPop.hidden, false);
  const tab = key("Tab");
  assert.ok(!tab.prevented, "Tab is not swallowed: it carries on from the button");
  assert.equal(el.viewPop.hidden, true);
  assert.equal(document.activeElement, el.viewMenuBtn);
});

test("View ▾ closes on an outside click or focus leaving it, stays up under its own items, and owns no key while closed", () => {
  const { env, el, document, items } = hudFixture();
  env.openViewMenu();
  const outside = document.listeners.find(([type]) => type === "mousedown")[1];
  outside({ target: items[3] });
  outside({ target: el.viewMenuBtn });
  assert.equal(el.viewPop.hidden, false, "zooming twice, or pressing its own button (which toggles), keeps it up");
  env.viewMenuFocusOut({ relatedTarget: null });
  assert.equal(el.viewPop.hidden, false, "the window losing focus is not leaving the menu");
  env.viewMenuFocusOut({ relatedTarget: el.viewMenuBtn });
  assert.equal(el.viewPop.hidden, false);
  env.viewMenuFocusOut({ relatedTarget: { name: "search" } });
  assert.equal(el.viewPop.hidden, true, "S or N moving focus to a field closes it");
  env.openViewMenu();
  outside({ target: { name: "canvas" } });
  assert.equal(el.viewPop.hidden, true);
  // Closed, it owns no key: its only key handler sits on the menu itself,
  // which is not rendered while hidden, and nothing listens on the button.
  assert.ok(idle.includes('el.viewPop?.addEventListener("keydown", viewMenuKey);'));
  assert.ok(!/viewMenuBtn\??\.addEventListener\("key/.test(idle), "View ▾ never takes a key while closed");
  const handleKey = section("  function handleKey(event) {", "  // One Esc step");
  assert.ok(!/viewMenu|viewPop/.test(handleKey), "the canvas shortcuts are untouched");
});

test("Ambience hangs from its button, inside the HUD, one toolbar popover at a time", () => {
  const { env, el, document } = hudFixture();
  env.openViewMenu();
  env.toggleAmbience({ detail: 1 });
  assert.equal(el.viewPop.hidden, true, "opening Ambience closes View ▾");
  assert.equal(el.pop.hidden, false);
  assert.equal(el.ambienceBtn.attrs["aria-expanded"], "true");
  assert.equal(el.pop.style.top, "71px", "under the strip, whichever row the bar wrapped to");
  assert.equal(el.pop.style.right, "78px", "right edge on the Ambience button's");
  assert.notEqual(document.activeElement, el.pop, "a mouse opening leaves focus alone");
  env.openViewMenu();
  assert.equal(el.pop.hidden, true, "and View ▾ closes Ambience");
  env.closeViewMenu();
  env.toggleAmbience({ detail: 0 });
  assert.equal(document.activeElement, el.pop, "a keyboard opening steps into the dialog, so Tab reaches its rows before Leave");
  env.toggleAmbience({ detail: 1 });
  assert.equal(el.pop.hidden, true);

  // A narrow window centres the wrapped strip, so a right-aligned popover
  // would cross the app menu: it is held inside the HUD instead.
  const narrow = hudFixture({ hud: { left: 56, top: 0, right: 600, bottom: 760 }, sound: { left: 300, right: 332, top: 150, bottom: 184 }, strip: { bottom: 190 } });
  narrow.env.toggleAmbience({ detail: 1 });
  assert.equal(narrow.el.pop.style.top, "196px");
  assert.equal(narrow.el.pop.style.right, `${544 - 280 - 12}px`, "its left edge stops 12px inside the HUD");
  assert.equal(narrow.el.pop.style.maxHeight, `${760 - 196 - 12}px`, "and it scrolls rather than running off the bottom");
  // Nothing rendered to hang from: the stylesheet's offsets stand.
  const unrendered = hudFixture({ sound: { left: 0, right: 0, top: 0, bottom: 0 } });
  unrendered.env.placePop(unrendered.el.pop, unrendered.el.ambienceBtn);
  assert.deepEqual(unrendered.el.pop.style, {});
});

test("Esc closes what opened last: View ▾, Ambience, Usage and the Legend before the search, the node or Command", () => {
  const { env, el, window, calls } = hudFixture();
  const state = { active: true, legendOpen: true, query: "task", focusMode: false, focus: null, selected: { id: "n" } };
  Object.assign(env, {
    state,
    setLegend: (open) => { calls.push(`legend:${open}`); state.legendOpen = open; },
    clearSearch: () => { calls.push("search"); state.query = ""; },
    setFocusMode() {},
    releaseNode: () => { calls.push("node"); state.selected = null; },
    leave: () => calls.push("leave"),
  });
  vm.runInContext(section("  // One Esc step per press", "  // Leave Command for the view it was entered from"), env);
  const shown = (visible) => ({ hidden: false, checkVisibility: () => visible });
  window.MefiUsageTracker = { setOpen: (open) => { calls.push(`usage:${open}`); el.usagePop.hidden = !open; } };
  el.viewPop.hidden = false;
  el.pop.hidden = false;
  el.usagePop = shown(true);
  el.legendList = shown(true);
  assert.equal(env.escape(), true);
  assert.ok(el.viewPop.hidden && !el.pop.hidden, "View ▾ first");
  env.escape(); assert.equal(el.pop.hidden, true, "then Ambience");
  assert.deepEqual(calls, []);
  env.escape(); assert.deepEqual(calls, ["usage:false"], "then the Usage breakdown");
  env.escape(); assert.deepEqual(calls.at(-1), "legend:false", "then the Legend");
  env.escape(); assert.deepEqual(calls.at(-1), "search");
  env.escape(); assert.deepEqual(calls.at(-1), "node");
  env.escape(); assert.deepEqual(calls.at(-1), "leave", "Command goes last");
  // A Legend the ≤1100px layout hides still reports open; Esc does not spend
  // a press closing what nobody can see.
  state.legendOpen = true; state.query = "again";
  el.legendList = shown(false);
  env.escape();
  assert.equal(calls.at(-1), "search");
  assert.equal(state.legendOpen, true);
});

test("Ambience keeps Look, Sound and Calm controls and links to canonical settings categories", () => {
  assert.ok(!template.includes("Ambience and startup"), "startup moved to Settings; the name follows");
  assert.match(button(toolbar, "idle-ambience"), /aria-haspopup="dialog" aria-expanded="false" aria-controls="idle-ambience-pop" title="Ambience: look, sound and calm" aria-label="Ambience"/);
  assert.match(ambience, /^<div id="idle-ambience-pop" class="pop" role="dialog" aria-label="Ambience" tabindex="-1" hidden>/);
  const heads = [...ambience.matchAll(/<div class="eyebrow" id="[^"]+">([^<]+)<\/div>/g)].map((match) => match[1]);
  assert.deepEqual(heads, ["Look", "Sound", "Calm"]);
  const order = ["idle-backdrop", "idle-bubbles", "idle-card-style", "idle-source", "idle-profile", "idle-zen", "idle-ambient-zen"].map((id) => ambience.indexOf(`id="${id}"`));
  assert.ok(order.every((at) => at > 0), "every row id is kept");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "Backdrop · Speech bubbles · Card style | Listen to · Profile · Zen bells | Zen mode");
  for (const group of ["look", "sound", "calm"]) assert.match(ambience, new RegExp(`<div class="pop-group" role="group" aria-labelledby="idle-ambience-${group}">`));
  // The Audio link switch lives in Style & sound and on the Music button;
  // #idle-reactive stays as an unlabelled, hidden mirror that scripts and the
  // verifiers read.
  assert.ok(!ambience.includes("Audio link</span>"), "no Audio link row");
  assert.match(ambience, /\n\s*<input type="checkbox" id="idle-reactive" hidden>\n/);
  const footer = ambience.slice(ambience.lastIndexOf('<hr class="pop-sep">'));
  // "Style & sound ↗" is held together, so a wrap never strands the arrow.
  assert.match(footer, /data-nav="studio" data-nav-params='\{"category":"appearance"\}'/);
  assert.match(footer, /data-nav="studio" data-nav-params='\{"category":"audio"\}'/);
  // Following the link out closes the popover on the way.
  assert.ok(idle.includes('el.pop?.addEventListener("click", (event) => { if (event.target?.closest?.("[data-nav]")) closeAmbience(); });'));
});

test("the stylesheet draws the clusters, drops the separators at 760px and animates only on the motion tokens", () => {
  assert.match(styles, /#idle-hud \.cmd-tools-group \{[^}]*display: flex;[^}]*flex: none;/);
  assert.match(styles, /@media \(max-width: 760px\) \{ #idle-hud \.cmd-tools \.tools-sep \{ display: none; \} \}/);
  assert.match(styles, /#idle-hud \.cmd-seg > button:first-child \{/);
  assert.match(styles, /#idle-hud \.cmd-view-pop \{[^}]*max-width: calc\(100vw - 32px\);/, "the compact View menu stays bounded by the viewport");
  const chevron = styles.match(/#idle-hud #idle-view-menu \.chev \{([^}]*)\}/)?.[1] ?? "";
  assert.match(chevron, /transition: rotate var\(--motion-fast\) var\(--ease-out\)/);
  const start = styles.indexOf("/* --- Command toolbar clusters (menu regroup)");
  const rules = styles.slice(start, styles.indexOf("@media (max-width: 760px) { #idle-hud .cmd-tools .tools-sep", start));
  assert.ok(start >= 0 && rules.length > 0, "the toolbar rules sit in one block");
  assert.ok(!/transition:[^;]*\d+m?s\b/.test(rules), "no raw durations in the toolbar rules");
});

// ---- the Map (layout v2) ------------------------------------------------------------------------------------------------
// Command is the 0.5 prototype's Map place when the frame is up: its bar (Map | Fleet | Pipelines, Running only, View ▾),
// a View menu of Layout, Labels, Camera and View, the colours of the four states and Fit and zoom. The template and the
// stylesheet are read as text; the handlers run in a vm against small fakes.
const mapBar = block('<div id="map-bar"');
const mapMenu = block('<div id="map-view-pop"');
const mapZoom = block('<div id="map-zoom"');
const mapStyles = styles.slice(styles.indexOf("*/", styles.indexOf("   The Map (layout v2; docs/unified-studio.md \"The Map\")")) + 2);

test("the Map's bar links its three pages and holds Running only and View ▾, as the prototype's Map draws them", () => {
  assert.match(mapBar, /^<div id="map-bar" class="map-bar" role="toolbar" aria-label="Map">/);
  const pages = [...mapBar.matchAll(/<button type="button" class="map-page" data-nav="([^"]+)"(?: data-nav-params='([^']+)')?([^>]*)>([^<]+)<\/button>/g)].map((match) => [match[4], match[1], match[2] ? JSON.parse(match[2]) : null, /aria-current="page"/.test(match[3])]);
  assert.deepEqual(pages, [["Map", "command", null, true], ["Fleet", "fleet", null, false], ["Pipelines", "agent-brain", { tab: "live" }, false]], "Map is Command, Fleet is Fleet, Pipelines is the Agent brain's live pipelines");
  assert.match(mapBar, /<div class="map-pages" role="group" aria-label="Map pages">/);
  assert.match(button(mapBar, "map-running-only"), /aria-pressed="false"/);
  assert.match(button(mapBar, "map-running-only"), /<use href="#g-bolt"\/><\/svg><span>Running only<\/span>/);
  assert.match(button(mapBar, "map-view-menu"), /aria-haspopup="menu" aria-expanded="false" aria-controls="map-view-pop"/);
  assert.equal((template.match(/<symbol id="g-bolt"/g) ?? []).length, 1, "the bolt is in the sprite once");
  // The classic toolbar keeps every control: the Map is another way in, not a replacement.
  for (const id of ["idle-agent-settings", "idle-feed-agent-mode", "idle-fit", "idle-cam-orbit", "idle-cam-follow", "idle-orbit", "idle-view-menu", "idle-music-toggle", "idle-ambience", "idle-exit"]) assert.ok(toolbar.includes(`id="${id}"`), `#${id} stays`);
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
});

test("the Map's styles apply only with the frame, fold the classic top bar away there and keep every text at 12 px or more", () => {
  assert.ok(mapStyles.length > 0, "the Map block is in styles.css");
  assert.match(mapStyles, /\n#map-bar, #map-zoom, #map-legend \{ display: none; \}\n/, "without the frame none of it is drawn");
  const rules = mapStyles.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((rule) => rule.trim()).filter((rule) => rule.includes("{"));
  for (const rule of rules) {
    const selector = rule.slice(0, rule.lastIndexOf("{")).replace(/^@media[^{]*\{/, "").trim();
    if (selector === "#map-bar, #map-zoom, #map-legend") continue;
    for (const part of selector.split(/,(?![^(]*\))/)) assert.match(part.trim(), /^html\[data-frame\] /, `"${part.trim()}" waits for the frame`);
  }
  assert.match(mapStyles, /html\[data-frame\] #idle-hud :is\(\.cmd-top, \.cmd-hint, #cmd-usage-toggle, #cmd-usage-pop\) \{ display: none; \}/);
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
    closeAgentSettings: () => calls.push("close agents"), closeAmbience: () => calls.push("close ambience"), closeViewMenu: () => calls.push("close view"), closeUsagePop: () => calls.push("close usage"), bumpHud() {},
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

test("the Map's View ▾ opens on its first item with the layouts music.js names, checks what is in force, and closes like the classic menu", () => {
  const { env, el, state, document, calls, layouts, spin, key, items } = mapFixture();
  env.syncMapOn();
  assert.equal(state.mapOn, true, "the frame is up");
  env.openMapMenu();
  assert.equal(el.mapPop.hidden, false);
  assert.equal(el.mapViewBtn.attrs["aria-expanded"], "true");
  assert.deepEqual(calls.splice(0), ["close agents", "close ambience", "close view", "close usage"], "one toolbar popover at a time");
  assert.deepEqual(layouts.children.map((item) => [item.dataset.mapLayout, item.children[0].textContent, item.children[1].textContent, item.attrs.role]), [
    ["constellation", "Constellation", "An open arrangement", "menuitemradio"], ["tree", "Branches", "A clear hierarchy", "menuitemradio"], ["radial", "Rings", "Concentric groups", "menuitemradio"], ["helix", "Helix", "A rising spiral", "menuitemradio"], ["layers", "Terraces", "Stacked levels", "menuitemradio"]]);
  assert.equal(document.activeElement, layouts.children[0], "focus lands on the first item");
  const checked = () => items().filter((item) => item.attrs["aria-checked"] === "true").map((item) => item.name === "spin" ? "spin" : Object.values(item.dataset)[0]);
  assert.deepEqual(checked(), ["constellation", "auto", "orbit", "3d", "spin"]);
  // Choices go to the same functions as the classic controls; a layout goes to music.js, which saves it.
  env.mapMenuChoose({ target: { closest: () => layouts.children[3] } });
  env.mapMenuChoose({ target: { closest: () => items().find((item) => item.dataset.mapLabels === "none") } });
  env.mapMenuChoose({ target: { closest: () => items().find((item) => item.dataset.mapCam === "follow") } });
  env.mapMenuChoose({ target: { closest: () => items().find((item) => item.dataset.mapView === "2d") } });
  assert.deepEqual(calls.splice(0), ["layout:helix", "labels:none", "cam:follow", "view:2d"]);
  env.syncMapMenu();
  assert.deepEqual(checked(), ["helix", "none", "follow", "2d"], "a flat map has no spin to show");
  assert.equal(spin.disabled, true);
  assert.equal(spin.title, "Spin turns the 3D orbit only");
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

test("without music.js the menu has no Layout row, never made-up names", () => {
  const { env, layouts } = mapFixture({ music: false });
  env.openMapMenu();
  assert.equal(layouts.children.length, 0);
  assert.equal(layouts.parent.hidden, true);
});

test("Running only is remembered, says so on its button, and dims only what is not running, only with the frame", () => {
  const { env, el, state, stored } = mapFixture();
  env.setRunningOnly(true);
  assert.equal(stored["mefiStudio.cmdRunningOnly"], "1");
  assert.equal(el.mapRunningOnly.attrs["aria-pressed"], "true");
  assert.match(el.mapRunningOnly.title, /^Running only is on/);
  env.setRunningOnly(false);
  assert.equal(stored["mefiStudio.cmdRunningOnly"], "0");
  assert.equal(el.mapRunningOnly.attrs["aria-pressed"], "false");
  assert.match(idle, /runningOnly: readStore\("mefiStudio\.cmdRunningOnly"\) === "1",/, "read back on the next launch");
  // emphasis(): the frame's Running only dims to .25 whatever is not running; the search still wins; classic never dims.
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
  assert.equal(lit.emphasis(nodes.queued), 1, "the classic layout has no Running only switch, so nothing dims");
  // The wires dim with their ends, behind the same two flags.
  assert.match(idle, /const lifetime = Math\.min\(a\.node\._fade \?\? 1, b\.node\._fade \?\? 1\) \* \(state\.runningOnly && state\.mapOn && !\(runningLit\(a\.node\) && runningLit\(b\.node\)\) \? 0\.3 : 1\);/);
});

test("over the Map, N starts a New task and S opens Search, as the prototype's Map keys do; the classic composer and find box keep them otherwise", () => {
  const calls = [];
  const state = { active: true, mapOn: true, selected: null };
  const el = { taskInput: { focus: () => calls.push("composer") }, search: { focus: () => calls.push("find box"), select() {} } };
  const env = vm.createContext({ state, el, window: { MefiSessions: { newTask: () => calls.push("new task") }, MefiNav: { go: (id) => calls.push(`go:${id}`) } }, document: { body: { dataset: {} } } });
  vm.runInContext(section("  // The keys N and S open what the frame has", "  // ---------- lifecycle ----------"), env);
  vm.runInContext(section("  function handleKey(event) {", "  // One Esc step"), env);
  const press = (key) => env.handleKey({ key, target: { closest: () => null }, shiftKey: false });
  assert.equal(press("n"), true); assert.equal(press("s"), true);
  assert.deepEqual(calls.splice(0), ["new task", "go:palette"]);
  state.mapOn = false;
  press("n"); press("s");
  assert.deepEqual(calls.splice(0), ["composer", "find box"]);
});

test("Esc closes the Map's View ▾ before anything else of Command's", () => {
  const { env, el } = hudFixture();
  const calls = [];
  const state = { active: true, legendOpen: false, query: "", focusMode: false, focus: null, selected: { id: "n" } };
  el.mapPop = { hidden: false };
  Object.assign(env, { state, closeMapMenu: (options) => { calls.push(["map", options]); el.mapPop.hidden = true; }, releaseNode: () => calls.push(["node"]), leave: () => calls.push(["leave"]), setFocusMode() {} });
  vm.runInContext(section("  // One Esc step per press", "  // Leave Command for the view it was entered from"), env);
  el.viewPop.hidden = false;
  assert.equal(env.escape(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.splice(0))), [["map", { focus: true }]]);
  assert.equal(el.viewPop.hidden, false, "one Esc, one popover");
  env.escape();
  assert.equal(el.viewPop.hidden, true);
});

test("the Map's legend names the four states in the colours of their legend rows", () => {
  const made = [];
  const node = (tag) => { const item = { tag, className: "", dataset: {}, style: { props: {}, setProperty(key, value) { this.props[key] = value; } }, children: [], textContent: "", append(...items) { this.children.push(...items); } }; made.push(item); return item; };
  const host = { children: [], get childElementCount() { return this.children.length; }, append(...items) { this.children.push(...items); } };
  const LEGEND = [{ key: "active", sw: "rgb(1, 1, 1)" }, { key: "verify", sw: "rgb(2, 2, 2)" }, { key: "done", sw: "rgb(3, 3, 3)" }, { key: "held", sw: "rgb(4, 4, 4)" }];
  const env = vm.createContext({ el: { mapLegend: host }, LEGEND, document: { createElement: node } });
  vm.runInContext(section("  // The Map's legend (layout v2)", "  function renderLegend() {"), env);
  env.renderMapLegend();
  env.renderMapLegend();
  assert.deepEqual(host.children.map((row) => [row.children[1].textContent, row.children[0].dataset.sw, row.children[0].style.props["--sw"]]), [
    ["Running", "active", "rgb(1, 1, 1)"], ["Needs you", "held", "rgb(4, 4, 4)"], ["Review", "verify", "rgb(2, 2, 2)"], ["Done", "done", "rgb(3, 3, 3)"]], "drawn once, in the prototype's order");
  assert.match(idle, /el\.mapLegend\?\.querySelector\(`\[data-sw="\$\{key\}"\]`\)\?\.style\.setProperty\("--sw", rgb\(tint\)\);/, "a theme change recolours them with the Legend");
});
