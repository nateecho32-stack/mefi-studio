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

test("the toolbar is four labelled groups and Leave: nine controls where there were thirteen", () => {
  assert.match(toolbar, /^<div class="cmd-tools" role="toolbar" aria-label="Command view controls">/);
  const groups = [...toolbar.matchAll(/<div class="cmd-tools-group" role="group" aria-label="([^"]+)">/g)].map((match) => match[1]);
  assert.deepEqual(groups, ["Agents", "Camera", "View", "Sound"]);
  assert.deepEqual(controlIds(toolbar), [
    "idle-feed-agent-mode",
    "idle-fit", "idle-cam-orbit", "idle-cam-follow", "idle-orbit",
    "idle-view-menu",
    "idle-music-toggle", "idle-ambience",
    "idle-exit",
  ], "Agents | Fit · Overview/Follow · Spin | View ▾ | Music · Ambience | Leave");
  assert.equal((toolbar.match(/<span class="tools-sep" aria-hidden="true"><\/span>/g) ?? []).length, 4, "one separator between each pair of clusters");
  assert.match(button(toolbar, "idle-exit"), /aria-label="Leave Command"/);
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
    usagePop: null, legendList: null,
  };
  const window = { MefiUsageTracker: null };
  const calls = [];
  const env = vm.createContext({ el, document, window, state: { active: true }, Math, bumpHud() {} });
  vm.runInContext(section("  // The toolbar's popovers hang from the button that opened them", "  // ---------- keyboard ----------"), env);
  const key = (name) => {
    const event = { key: name, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    env.viewMenuKey(event);
    return event;
  };
  return { env, el, document, window, items, key, calls };
}

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

test("Ambience reads Look → Sound → Calm, keeps every id, drops the Audio link row and links on to Style & sound", () => {
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
  assert.match(footer, /<button class="ghost mini pop-link" type="button" data-nav="music" [^>]*>Theme, node style &amp; music: Style&nbsp;&amp;&nbsp;sound&nbsp;↗<\/button>/);
  // Following the link out closes the popover on the way.
  assert.ok(idle.includes('el.pop?.addEventListener("click", (event) => { if (event.target?.closest?.("[data-nav]")) closeAmbience(); });'));
});

test("the stylesheet draws the clusters, drops the separators at 760px and animates only on the motion tokens", () => {
  assert.match(styles, /#idle-hud \.cmd-tools-group \{[^}]*display: flex;[^}]*flex: none;/);
  assert.match(styles, /@media \(max-width: 760px\) \{ #idle-hud \.cmd-tools \.tools-sep \{ display: none; \} \}/);
  assert.match(styles, /#idle-hud \.cmd-seg > button:first-child \{/);
  assert.match(styles, /#idle-hud \.cmd-view-pop \{[^}]*width: auto;/);
  const chevron = styles.match(/#idle-hud #idle-view-menu \.chev \{([^}]*)\}/)?.[1] ?? "";
  assert.match(chevron, /transition: rotate var\(--motion-fast\) var\(--ease-out\)/);
  const start = styles.indexOf("/* --- Command toolbar clusters (menu regroup)");
  const rules = styles.slice(start, styles.indexOf("@media (max-width: 760px) { #idle-hud .cmd-tools .tools-sep", start));
  assert.ok(start >= 0 && rules.length > 0, "the toolbar rules sit in one block");
  assert.ok(!/transition:[^;]*\d+m?s\b/.test(rules), "no raw durations in the toolbar rules");
});
