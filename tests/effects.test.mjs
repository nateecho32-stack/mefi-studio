// Menu exit effects (renderer/effects.js): Dissolve, Burn away and Stardust
// are Shop items. Their fields decide which part of a menu goes first, the
// choice needs the item to be owned (a Try borrows it without saving), motion
// Off always closes menus at once, and a removed dropdown handed to leave()
// goes at once when no effect is on.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom, Element } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/effects.js", import.meta.url), "utf8");

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

test("each effect's field says which part of a menu goes first", () => {
  const { effects } = load();
  const columns = 40, rows = 60;
  const at = (values, i, j) => values[j * columns + i];
  for (const kind of ["dissolve", "embers", "stardust"]) {
    const values = effects.field(kind, columns, rows, 7);
    assert.equal(values.length, columns * rows);
    assert.ok(values.every((value) => value >= 0 && value < 1), `${kind}: every cell between 0 and 1`);
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

test("an effect is used only when it is owned; a Try borrows one without saving; the root says which is on", () => {
  const storage = new Map();
  let env = load({ storage });
  assert.deepEqual(Array.from(env.effects.list(), (item) => item.item), ["studio:fx-dissolve", "studio:fx-embers", "studio:fx-stardust"]);
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

test("a closing menu is held where it was: its display pinned (even after its own fade began), shown again when it reopens", () => {
  const storage = new Map();
  let observed = null;
  class FakeObserver { constructor(callback) { observed = callback; } observe() {} }
  const { document } = createDom();
  document.readyState = "complete";
  document.documentElement.dataset.motion = "on";
  const style = () => {
    const values = new Map();
    return {
      setProperty(name, value, priority = "") { values.set(name, [String(value), priority]); },
      getPropertyValue(name) { return values.get(name)?.[0] ?? ""; },
      getPropertyPriority(name) { return values.get(name)?.[1] ?? ""; },
      removeProperty(name) { values.delete(name); },
      has: (name) => values.has(name),
    };
  };
  const menu = new Element("div");
  menu.id = "app-help-menu";
  menu.style = style();
  menu.isConnected = true;
  menu.getBoundingClientRect = () => ({ left: 10, top: 500, right: 250, bottom: 700, width: 240, height: 200 });
  document.body.append(menu);
  const timers = [];
  const window = { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, addEventListener() {}, dispatchEvent() { return true; }, MefiShop: { owns: () => true } };
  const context = vm.createContext({
    window, document, console, Math, JSON, Number, Array, Object, Float32Array, CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    MutationObserver: FakeObserver,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, performance: { now: () => 0 },
    // Its own fade has begun: the page reads it as still a flex box while the display transition runs.
    getComputedStyle: () => ({ display: "flex", getPropertyValue: () => "", backgroundColor: "rgb(30, 35, 48)", color: "rgb(230, 230, 230)" }),
  });
  vm.runInContext(source, context);
  for (const fn of timers.splice(0)) fn();
  window.MefiEffects.use("dissolve");
  menu.hidden = true;
  observed([{ attributeName: "hidden", oldValue: null, target: menu }]);
  assert.equal(menu.style.getPropertyValue("display"), "flex", "pinned to what it showed as");
  assert.equal(menu.style.getPropertyPriority("display"), "important", "inline !important outranks [hidden]");
  assert.equal(menu.style.getPropertyValue("opacity"), "1");
  assert.equal(menu.style.getPropertyValue("pointer-events"), "none", "the pointer passes through a leaving menu");
  menu.hidden = false;
  observed([{ attributeName: "hidden", oldValue: "", target: menu }]);
  assert.equal(menu.style.has("display"), false, "opened again: let go at once");
  assert.equal(menu.style.has("opacity"), false);
});
