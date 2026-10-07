// Menu exit effects (renderer/effects.js): Dissolve, Burn away, Stardust,
// Blown away, Shatter, Spirits and Glitch are Shop items. Their fields decide
// which part of a menu goes first, the choice needs the item to be owned (a
// Try borrows it without saving), motion Off and "It fades out" always close
// menus at once, a leaving menu is out of the keyboard's and screen readers'
// way at once, a menu that opens again mid-effect is back at once and whole,
// Search's sheet leaves while its scrim fades, every frame's particle work is
// capped whatever the menu's size, and the Shop's previews loop only while
// they are on screen with motion on.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom, Element } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/effects.js", import.meta.url), "utf8");
const NEW = ["wind", "shatter", "spirits", "glitch"];

function load({ storage = new Map(), owned = [], motion = "on" } = {}) {
  const { document } = createDom();
  document.readyState = "complete";
  document.documentElement.dataset.motion = motion;
  const events = {}, timers = [];
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  const window = {
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    addEventListener(name, callback) { (events[name] ||= []).push(callback); },
    dispatchEvent(event) { for (const callback of events[event.type] || []) callback(event); return true; },
    MefiShop: { owns: (item) => owned.includes(item) },
  };
  const context = vm.createContext({
    window, document, console, CustomEvent, Math, JSON, Number, Array, Object, Float32Array,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, performance: { now: () => 0 },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  });
  vm.runInContext(source, context);
  for (const fn of timers.splice(0)) fn();
  return { window, document, storage, effects: window.MefiEffects };
}
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

// An inline style that remembers values and priorities, as a browser's does.
function inlineStyle() {
  const values = new Map();
  return {
    setProperty(name, value, priority = "") { values.set(name, [String(value), priority]); },
    getPropertyValue(name) { return values.get(name)?.[0] ?? ""; },
    getPropertyPriority(name) { return values.get(name)?.[1] ?? ""; },
    removeProperty(name) { values.delete(name); },
    has: (name) => values.has(name),
    names: () => [...values.keys()],
  };
}
// A page with one owned effect in use, a stand-in observer, frames and timers run by hand, and canvases that count
// what they are asked to draw (per frame, through draws()).
function page({ effect = "dissolve", motion = "on", owned = true } = {}) {
  const storage = new Map();
  let observed = null, watcher = null;
  class FakeObserver { constructor(callback) { observed = callback; } observe() {} }
  class FakeIntersection { constructor(callback) { watcher = { callback, watching: [], off: false }; } observe(node) { watcher.watching.push(node); } disconnect() { watcher.off = true; } }
  const { document } = createDom();
  document.readyState = "complete";
  document.documentElement.dataset.motion = motion;
  let pictures = 0, drawn = 0;
  const DRAWS = new Set(["fillRect", "fill", "stroke", "drawImage", "arc", "putImageData"]);
  const make = document.createElement;
  document.createElement = (tag) => {
    const element = make(tag);
    if (tag === "canvas") {
      element.style = inlineStyle();
      const ctx = new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }, {
        get: (target, key) => (key in target ? target[key] : (...args) => { if (DRAWS.has(key)) drawn += 1; return undefined; }),
        set: (target, key, value) => { target[key] = value; return true; },
      });
      element.getContext = () => ctx;
      element.toDataURL = () => `data:image/png;base64,step${(pictures += 1)}`;
      element.remove = () => {};
    }
    return element;
  };
  const timers = new Map(), frames = [];
  let clock = 0, serial = 0;
  const window = { innerWidth: 1600, innerHeight: 1200, devicePixelRatio: 1, addEventListener() {}, dispatchEvent() { return true; }, MefiShop: { owns: () => owned } };
  const context = vm.createContext({
    window, document, console, Math, JSON, Number, Array, Object, Float32Array, Int32Array, Uint8ClampedArray, Proxy, CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    MutationObserver: FakeObserver, IntersectionObserver: FakeIntersection,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    setTimeout: (fn) => { timers.set(++serial, fn); return serial; }, clearTimeout: (id) => { timers.delete(id); },
    requestAnimationFrame: (fn) => { frames.push({ id: ++serial, fn }); return serial; },
    cancelAnimationFrame: (id) => { const at = frames.findIndex((frame) => frame.id === id); if (at >= 0) frames.splice(at, 1); },
    performance: { now: () => clock },
    getComputedStyle: () => ({ display: "flex", getPropertyValue: () => "", backgroundColor: "rgb(30, 35, 48)", color: "rgb(230, 230, 230)" }),
  });
  vm.runInContext(source, context);
  const runTimers = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  runTimers();
  if (effect) window.MefiEffects.use(effect);
  // A menu-like element: an inline style, connected, a box on screen.
  const node = (id = "", classes = "", { width = 240, height = 200, parent = document.body } = {}) => {
    const element = new Element("div");
    if (id) element.id = id;
    if (classes) element.className = classes;
    element.style = inlineStyle();
    element.isConnected = true;
    element.getBoundingClientRect = () => ({ left: 10, top: 300, right: 10 + width, bottom: 300 + height, width, height });
    parent.append(element);
    return element;
  };
  const close = (element) => { element.hidden = true; observed([{ attributeName: "hidden", oldValue: null, target: element }]); };
  const open = (element) => { element.hidden = false; observed([{ attributeName: "hidden", oldValue: "", target: element }]); };
  // Runs frames 16 ms apart; returns how many draw calls each frame made.
  const play = (count = 1000) => {
    const perFrame = [];
    for (let n = 0; n < count && frames.length; n += 1) { clock += 16; const before = drawn; frames.shift().fn(); perFrame.push(drawn - before); }
    return perFrame;
  };
  return { window, document, effects: window.MefiEffects, node, close, open, play, frames, runTimers, timers, watcher: () => watcher, tick: (ms) => { clock += ms; } };
}

test("each effect's field says which part of a menu goes first", () => {
  const { effects } = load();
  const columns = 40, rows = 60;
  const at = (values, i, j) => values[j * columns + i];
  for (const kind of ["dissolve", "embers", "stardust", ...NEW]) {
    const values = effects.field(kind, columns, rows, 7);
    assert.equal(values.length, columns * rows);
    assert.ok(values.every((value) => value >= 0 && value < 1), `${kind}: every cell between 0 and 1`);
    assert.deepEqual(effects.field(kind, columns, rows, 7), values, `${kind}: the same seed gives the same field`);
  }
  const row = (values, j) => mean(Array.from({ length: columns }, (_, i) => at(values, i, j)));
  const column = (values, i) => mean(Array.from({ length: rows }, (_, j) => at(values, i, j)));
  const dissolve = effects.field("dissolve", columns, rows, 7);
  assert.ok(row(dissolve, 2) < row(dissolve, rows - 3), "Dissolve crumbles from the top down");
  const stardust = effects.field("stardust", columns, rows, 7);
  assert.ok(column(stardust, 2) < column(stardust, columns - 3), "Stardust sweeps away from the left");
  const embers = effects.field("embers", columns, rows, 7);
  const edge = mean([...Array.from({ length: columns }, (_, i) => at(embers, i, 0)), ...Array.from({ length: rows }, (_, j) => at(embers, 0, j))]);
  const middle = mean(Array.from({ length: 9 }, (_, n) => at(embers, 18 + (n % 3), 28 + Math.floor(n / 3))));
  assert.ok(edge < middle - 0.15, `Burn away starts at the edges (edge ${edge.toFixed(2)}, middle ${middle.toFixed(2)})`);
  assert.deepEqual(Array.from(effects.field("dissolve", 8, 8, 3)), Array.from(effects.field("dissolve", 8, 8, 3)), "the same seed gives the same field");
});

// How often a cell has the same value as its right-hand (across) or lower (down) neighbour, and how far apart they are.
function neighbours(values, columns, rows) {
  let sameAcross = 0, sameDown = 0, across = 0, down = 0, stepAcross = 0, stepDown = 0;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const here = values[j * columns + i];
      if (i + 1 < columns) { across += 1; const there = values[j * columns + i + 1]; if (there === here) sameAcross += 1; stepAcross += Math.abs(there - here); }
      if (j + 1 < rows) { down += 1; const there = values[(j + 1) * columns + i]; if (there === here) sameDown += 1; stepDown += Math.abs(there - here); }
    }
  }
  return { sameAcross: sameAcross / across, sameDown: sameDown / down, stepAcross: stepAcross / across, stepDown: stepDown / down };
}

test("the new effects' fields: sand goes with the wind in streaks, glass in whole pieces nearest the blow, smoke softly from the top, a glitch in slices", () => {
  const { effects } = load();
  const columns = 48, rows = 60;
  const at = (values, i, j) => values[j * columns + i];
  const column = (values, i) => mean(Array.from({ length: rows }, (_, j) => at(values, i, j)));
  const row = (values, j) => mean(Array.from({ length: columns }, (_, i) => at(values, i, j)));

  // Blown away: the side the wind blows toward (the right) goes first, and its grains are drawn out along the wind.
  for (const seed of [7, 11, 2026]) {
    const wind = effects.field("wind", columns, rows, seed);
    assert.ok(column(wind, columns - 3) < column(wind, 2) - 0.3, `Blown away: the right side goes before the left (seed ${seed})`);
    const { stepAcross, stepDown } = neighbours(wind, columns, rows);
    assert.ok(stepAcross < stepDown, `Blown away: neighbours along the wind are closer than across it (${stepAcross.toFixed(3)} < ${stepDown.toFixed(3)})`);
  }

  // Shatter: every piece falls whole (cells share their piece's value), the pieces nearest the blow (upper middle)
  // first, the far corners last; none goes in the first steps, while the cracks run.
  for (const seed of [7, 11, 2026]) {
    const glass = effects.field("shatter", columns, rows, seed);
    const pieces = new Set(glass);
    assert.ok(pieces.size >= 5 && pieces.size <= 14, `Shatter: a handful of falling moments, not one per cell (${pieces.size}, seed ${seed})`);
    assert.ok(neighbours(glass, columns, rows).sameAcross > 0.85, "Shatter: a piece goes whole");
    assert.ok(Math.min(...glass) > (3 / 14) * 1.08, "Shatter: nothing falls while the cracks are still running");
    const corners = mean([at(glass, 0, 0), at(glass, columns - 1, 0), at(glass, 0, rows - 1), at(glass, columns - 1, rows - 1)]);
    const blow = Math.min(...Array.from({ length: columns * rows }, (_, index) => glass[index]));
    const first = Array.from({ length: columns * rows }, (_, index) => index).filter((index) => glass[index] === blow);
    const firstAt = [mean(first.map((index) => index % columns)) / columns, mean(first.map((index) => Math.floor(index / columns))) / rows];
    assert.ok(firstAt[0] > 0.2 && firstAt[0] < 0.8 && firstAt[1] < 0.6, `Shatter: the first piece falls from near the blow, in the upper middle (${firstAt.map((v) => v.toFixed(2))})`);
    assert.ok(corners > mean(glass), "Shatter: the far corners fall late");
  }

  // Spirits: the top lifts away first, and the smoke is soft (neighbours differ far less than Dissolve's crumbs).
  const spirits = effects.field("spirits", columns, rows, 7);
  assert.ok(row(spirits, 2) < row(spirits, rows - 3) - 0.25, "Spirits: from the top down");
  const soft = neighbours(spirits, columns, rows), crumbs = neighbours(effects.field("dissolve", columns, rows, 7), columns, rows);
  assert.ok(soft.stepAcross < crumbs.stepAcross / 3 && soft.stepDown < crumbs.stepDown / 3, "Spirits: a soft field, not crumbs");

  // Glitch: horizontal slices, each blinking on its own beat, none in its first fifth while it only jumps.
  const glitch = effects.field("glitch", columns, rows, 7);
  const slices = neighbours(glitch, columns, rows);
  assert.ok(slices.sameAcross > 0.9, `Glitch: a slice runs across (${slices.sameAcross.toFixed(2)})`);
  assert.ok(slices.sameDown < 0.75 && slices.sameDown < slices.sameAcross - 0.2, `Glitch: slices are thin (${slices.sameDown.toFixed(2)} down)`);
  assert.ok(Math.min(...glitch) >= 0.2, "Glitch: nothing blinks out in the first fifth");
});

test("an effect is used only when it is owned; a Try borrows one without saving; the root says which is on", () => {
  const storage = new Map();
  let env = load({ storage });
  assert.deepEqual(Array.from(env.effects.list(), (item) => item.item), ["studio:fx-dissolve", "studio:fx-embers", "studio:fx-stardust", "studio:fx-wind", "studio:fx-shatter", "studio:fx-spirits", "studio:fx-glitch"]);
  assert.deepEqual(Array.from(env.effects.list(), (item) => item.name), ["Dissolve", "Burn away", "Stardust", "Blown away", "Shatter", "Spirits", "Glitch"]);
  assert.deepEqual(Array.from(env.effects.list(), (item) => item.drop), [null, null, null, null, null, "2026-10", null], "Spirits came with October's drop; the rest are always in the Shop");
  for (const item of env.effects.list()) {
    assert.ok(item.detail.endsWith(".") && item.ms >= 400 && item.ms <= 1000, item.id);
    assert.doesNotMatch(item.detail, /perk|unlock|premium|entitlement/i, item.id);
  }
  assert.equal(env.effects.current(), "none");
  assert.equal(env.effects.use("embers"), "none", "not owned: chosen, not on");
  assert.equal(env.effects.chosen(), "embers");
  assert.equal(env.document.documentElement.dataset.exitEffect, undefined);

  assert.equal(env.effects.preview("stardust", 120000), true);
  assert.equal(env.effects.current(), "stardust");
  assert.equal(env.document.documentElement.dataset.exitEffect, "stardust");
  assert.ok(!String(storage.get("mefiStudio.effects.v1")).includes("stardust"), "a Try is never saved");
  env.effects.endPreview();
  assert.equal(env.effects.current(), "none");
  assert.equal(env.effects.preview("confetti"), false, "an unknown effect is refused");

  env = load({ storage, owned: ["studio:fx-embers"] });
  assert.equal(env.effects.current(), "embers", "owned and chosen: back after a restart");
  assert.equal(env.document.documentElement.dataset.exitEffect, "embers");
  assert.equal(env.effects.use("none"), "none");
  assert.equal(env.document.documentElement.dataset.exitEffect, undefined);

  env = load({ storage, owned: ["studio:fx-spirits"] });
  assert.equal(env.effects.use("spirits"), "spirits", "a new one is used the same way");
  assert.equal(env.effects.preview("glitch"), true);
  assert.equal(env.effects.current(), "glitch");
});

test("a dropdown handed to leave() goes at once when no effect is on, or when motion is off", () => {
  for (const options of [{}, { owned: ["studio:fx-dissolve"], motion: "off" }]) {
    const env = load(options);
    if (options.owned) env.effects.use("dissolve");
    const popup = new Element("div");
    popup.id = "studio-choice-list";
    env.document.body.append(popup);
    popup.isConnected = true;
    assert.equal(env.effects.leave(popup), false);
    assert.equal(popup.parentNode, null, "removed straight away");
  }
});

test("a dropdown or right-click menu handed to leave() is out of the keyboard's and screen readers' way at once, and a second close lets it finish", () => {
  const env = page({ effect: "shatter" });
  const menu = env.node("mefi-tabs-pop-tab", "ts-pop");
  env.node("first-item", "ts-menuitem", { parent: menu });
  assert.equal(env.effects.leave(menu), true, "it leaves in style");
  assert.equal(menu.getAttribute("inert"), "", "inert at once: it can hold no focus and takes no input");
  assert.equal(menu.getAttribute("aria-hidden"), "true", "gone for screen readers at once");
  assert.equal(menu.style.getPropertyValue("pointer-events"), "none");
  env.play(10);
  assert.equal(env.effects.leave(menu), true, "closed again by a redraw: it goes on leaving");
  assert.ok(env.frames.length > 0, "the effect was not cut short");
  env.play();
  assert.equal(menu.parentNode, null, "removed once it has gone");
});

test("a closing menu is held where it was: its display pinned (even after its own fade began), shown again when it reopens", () => {
  const env = page();
  const menu = env.node("app-help-menu");
  env.close(menu);
  assert.equal(menu.style.getPropertyValue("display"), "flex", "pinned to what it showed as");
  assert.equal(menu.style.getPropertyPriority("display"), "important", "inline !important outranks [hidden]");
  assert.equal(menu.style.getPropertyValue("opacity"), "1");
  assert.equal(menu.style.getPropertyValue("pointer-events"), "none", "the pointer passes through a leaving menu");
  assert.equal(menu.getAttribute("inert"), "", "a leaving menu is inert at once: it can hold no focus");
  assert.equal(menu.getAttribute("aria-hidden"), "true", "and screen readers no longer find it");
  env.open(menu);
  assert.equal(menu.style.has("display"), false, "opened again: let go at once");
  assert.equal(menu.style.has("opacity"), false);
  assert.equal(menu.getAttribute("inert"), null, "and it is in the keyboard's reach again");
  assert.equal(menu.getAttribute("aria-hidden"), null);
});

test("a menu that opens again mid-effect is back at once and whole, whichever effect was playing", () => {
  for (const effect of ["dissolve", ...NEW]) {
    const env = page({ effect });
    const menu = env.node("app-help-menu", "", { width: 400, height: 500 });
    menu.style.setProperty("translate", "2px 3px");
    env.close(menu);
    env.play(14);
    assert.ok(env.frames.length > 0, `${effect}: still playing`);
    if (effect === "wind") assert.notEqual(menu.style.getPropertyValue("translate"), "none", "Blown away: the menu drifts aside as it goes");
    assert.match(menu.style.getPropertyValue("mask-image"), /^url\(/, `${effect}: a mask step is on`);
    env.open(menu);
    assert.deepEqual(menu.style.names(), ["translate"], `${effect}: nothing of the effect is left on it`);
    assert.equal(menu.style.getPropertyValue("translate"), "2px 3px", `${effect}: its own inline style is back`);
    assert.equal(menu.getAttribute("inert"), null);
    assert.equal(env.frames.length, 0, `${effect}: the effect stopped`);
  }
});

test("a menu that left under an effect shows again once the effect is off, or motion is off", () => {
  for (const turnOff of ["none", "motion"]) {
    const env = page();
    const menu = env.node("app-help-menu");
    env.close(menu);
    // Play it to the end, crumbs and all.
    env.play();
    assert.equal(env.frames.length, 0, `${turnOff}: the exit finished`);
    assert.match(menu.style.getPropertyValue("mask-image"), /^url\("data:image\/png;base64,step\d+"\)$/, `${turnOff}: gone, its last (empty) mask stays on while it is hidden`);
    assert.equal(menu.style.has("display"), false, `${turnOff}: the hold let go`);
    if (turnOff === "none") env.effects.use("none");
    else env.document.documentElement.dataset.motion = "off";
    env.open(menu);
    assert.equal(menu.style.has("mask-image"), false, `${turnOff}: shown again, it is not left invisible`);
    assert.equal(menu.style.has("-webkit-mask-image"), false);
    assert.equal(menu.style.has("image-rendering"), false);
  }
});

test("with motion Off or the effect set to \"It fades out\", menus, popovers and Search close at once", () => {
  for (const [label, options] of [["motion off", { effect: "shatter", motion: "off" }], ["It fades out", { effect: "none" }], ["not owned", { effect: "glitch", owned: false }]]) {
    const env = page(options);
    for (const element of [env.node("app-help-menu"), env.node("", "chat-tools-popover"), env.node("palette-overlay")]) {
      env.close(element);
      assert.deepEqual(element.style.names(), [], `${label}: ${element.id || element.className} is not held`);
      assert.equal(element.getAttribute("inert"), null);
    }
    assert.equal(env.frames.length, 0, `${label}: nothing plays`);
  }
});

test("popovers that close leave in style: the permissions menu, the chat's tools, the Inbox, Build's More and the session panel's menus", () => {
  const env = page({ effect: "glitch" });
  for (const [id, classes] of [["", "autonomy-popover"], ["", "chat-tools-popover"], ["today-inbox", "today-inbox"], ["builder-more-menu", "builder-more-menu"], ["sessions-run-menu", "sx-runmenu"], ["sessions-itab-menu", "sx-menu sx-itab-menu"]]) {
    const element = env.node(id, classes);
    env.close(element);
    assert.equal(element.style.getPropertyValue("display"), "flex", `${id || classes} is held while it leaves`);
    assert.equal(element.getAttribute("inert"), "");
  }
  // Inside the run menu the permission choices stand open in place: `hidden` does not close them there.
  const run = env.node("", "sx-runmenu");
  const inline = env.node("", "autonomy-popover", { parent: run });
  env.close(inline);
  assert.deepEqual(inline.style.names(), [], "never played where it does not close");
});

test("a [popover] that closes leaves in style, and one opened again mid-effect is back at once and whole", () => {
  const env = page({ effect: "wind" });
  const pop = env.node("", "info-pop", { width: 280, height: 160 });
  pop.setAttribute("popover", "auto");
  env.document.body.trigger("beforetoggle", { target: pop, newState: "closed" });
  assert.match(pop.style.getPropertyValue("mask-image"), /^url\(/, "it plays as it closes");
  assert.equal(pop.style.has("display"), false, "a popover keeps its place through the top layer's own transition, never a pinned display");
  assert.equal(pop.getAttribute("inert"), "");
  env.play(6);
  env.document.body.trigger("beforetoggle", { target: pop, newState: "open" });
  assert.deepEqual(pop.style.names(), [], "opened again: nothing of the effect is left");
  assert.equal(pop.getAttribute("inert"), null);
  assert.equal(env.frames.length, 0);
});

test("Search closing: its sheet leaves in style while the scrim fades, nothing is left on screen, and opening it again puts everything back", () => {
  const env = page({ effect: "spirits" });
  const overlay = env.node("palette-overlay", "overlay", { width: 1600, height: 1200 });
  const sheet = env.node("", "palette-sheet", { parent: overlay, width: 640, height: 420 });
  env.close(overlay);
  assert.equal(overlay.style.getPropertyValue("display"), "flex", "the overlay stays rendered for its sheet");
  assert.equal(overlay.style.getPropertyValue("background-color"), "transparent", "the scrim fades");
  assert.equal(overlay.style.getPropertyValue("backdrop-filter"), "none");
  assert.match(overlay.style.getPropertyValue("transition"), /background-color \d+ms/, "fading, not snapping");
  assert.equal(overlay.getAttribute("inert"), "", "nothing in it takes the keyboard while it leaves");
  assert.equal(overlay.getAttribute("aria-hidden"), "true");
  assert.match(sheet.style.getPropertyValue("mask-image"), /^url\(/, "the sheet plays the effect");
  assert.equal(overlay.style.has("mask-image"), false, "the overlay itself is not masked while the sheet leaves");
  env.play();
  assert.equal(env.frames.length, 0);
  assert.equal(overlay.style.getPropertyValue("mask-image"), "linear-gradient(transparent, transparent)", "gone: the overlay shows nothing through its own fade");
  assert.equal(overlay.style.has("background-color"), false, "its scrim style is its own again");
  assert.equal(overlay.getAttribute("inert"), null);
  env.open(overlay);
  assert.equal(overlay.style.has("mask-image"), false, "opened again: the overlay shows");
  assert.equal(sheet.style.has("mask-image"), false, "and so does its sheet");
  assert.deepEqual(overlay.style.names(), []);
  // Opened again mid-effect: back at once.
  env.close(overlay);
  env.play(8);
  env.open(overlay);
  assert.deepEqual([overlay.style.names(), sheet.style.names()], [[], []]);
  assert.equal(env.frames.length, 0);
});

test("every frame's particle work is capped, however large the menu", () => {
  for (const effect of ["dissolve", "stardust", ...NEW]) {
    const most = [];
    for (const [width, height] of [[400, 500], [1200, 900]]) {
      const env = page({ effect });
      const menu = env.node("app-help-menu", "", { width, height });
      env.close(menu);
      const perFrame = env.play();
      assert.equal(env.frames.length, 0, `${effect} ${width}x${height}: it ends`);
      most.push(Math.max(...perFrame));
    }
    assert.ok(most.every((count) => count <= 900), `${effect}: at most 900 draws a frame (${most.join(", ")})`);
  }
});

test("the Shop's demo plays on a big sample in place: its canvas follows the page when it scrolls (not the effect's own drift), and the sample is back after", () => {
  const env = page({ effect: null });
  let top = 300;
  const sample = env.node("", "friends-shop-menu", { width: 520, height: 340 });
  // As in a browser, the box includes the translate the effect gives it.
  const drift = () => (sample.style.getPropertyValue("translate") || "0px 0px").split(" ").map((part) => Number.parseFloat(part) || 0);
  sample.getBoundingClientRect = () => { const [x, y] = drift(); return { left: 10 + x, top: top + y, right: 530 + x, bottom: top + 340 + y, width: 520, height: 340 }; };
  assert.equal(env.effects.demo(sample, "wind"), true, "any effect, owned or not: the Shop shows it");
  const canvas = env.document.body.children.find((child) => child.className === "exit-effect-dust");
  const at = () => canvas.style.transform.match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\)/).slice(1).map(Number);
  const [, first] = at();
  env.play(20);
  assert.notEqual(sample.style.getPropertyValue("translate"), "", "the sample drifts aside as it goes");
  assert.equal(at()[1], first, "the effect's own drift does not move the canvas");
  top -= 120;
  env.play(1);
  assert.equal(at()[1], first - 120, "the page scrolled: the canvas went with the sample");
  assert.equal(sample.getAttribute("inert"), null, "a sample is never made inert");
  env.play();
  assert.deepEqual(sample.style.names(), [], "back as it was");
  assert.equal(env.effects.demo(sample, "confetti"), false);
  env.document.documentElement.dataset.motion = "off";
  assert.equal(env.effects.demo(sample, "wind"), false, "nothing with motion Off");
});

test("the Shop's loop plays an effect on a sample only while it is on screen and motion is on, and stops when told or when the sample goes", () => {
  const env = page({ effect: null });
  const sample = env.node("", "friends-shop-menu", { width: 320, height: 200 });
  const stop = env.effects.loop(sample, "shatter");
  env.runTimers();
  assert.ok(env.frames.length > 0, "on screen with motion on: it plays");
  env.play();
  assert.equal(sample.style.has("mask-image"), false, "after each play the sample is back as it was");
  assert.equal(sample.getAttribute("inert"), null, "a sample is never made inert");
  // Off screen: the next play waits until it is seen again.
  env.watcher().callback([{ isIntersecting: false }]);
  env.runTimers();
  assert.equal(env.frames.length, 0, "off screen: nothing plays");
  env.watcher().callback([{ isIntersecting: true }]);
  env.runTimers();
  assert.ok(env.frames.length > 0, "seen again: it plays again");
  env.play();
  // Calm motion stops decorative loops; Off stops everything.
  for (const motion of ["calm", "off"]) {
    env.document.documentElement.dataset.motion = motion;
    env.runTimers();
    assert.equal(env.frames.length, 0, `motion ${motion}: no loop`);
  }
  env.document.documentElement.dataset.motion = "on";
  env.runTimers();
  assert.ok(env.frames.length > 0, "motion back on: it carries on");
  stop();
  assert.equal(sample.style.has("mask-image"), false, "stopped mid-play: the sample is shown whole at once");
  assert.equal(env.watcher().off, true, "it stops watching");
  env.play();
  env.runTimers();
  assert.equal(env.frames.length, 0, "and plays no more");
  // A sample taken out of the page ends its own loop.
  const gone = env.node("", "friends-shop-menu");
  env.effects.loop(gone, "glitch");
  gone.isConnected = false;
  env.runTimers();
  assert.equal(env.frames.length, 0);
  assert.equal(env.effects.loop(sample, "confetti")(), undefined, "an unknown effect loops nothing");
});
