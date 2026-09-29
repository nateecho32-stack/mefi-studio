import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/card-layout.js", import.meta.url), "utf8");

function environment() {
  let hidden = false, reduced = false, motionOff = false, serial = 0;
  const frames = new Map(), observers = [], animations = [];
  const list = { children: [], rows: "4px", width: 600, getBoundingClientRect: () => ({ width: list.width }) };
  const card = (height) => ({
    height, style: { gridRowEnd: "" },
    getBoundingClientRect() {
      const index = list.children.indexOf(this);
      const span = (item) => (Number(item.style.gridRowEnd.replace("span ", "")) || 1) * 4;
      return { left: index % 2 * 300, top: index < 2 ? 0 : Math.min(...list.children.slice(0, 2).map(span)), height: this.height };
    },
    animate(keys, options) {
      const animation = { keys, options, cancelled: false, cancel() { this.cancelled = true; this.oncancel?.(); } };
      animations.push(animation); return animation;
    },
  });
  list.children = [card(60), card(120), card(80)];
  const window = { MefiMotion: { off: () => motionOff }, matchMedia: () => ({ matches: reduced }) };
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.items = new Set(); observers.push(this); }
    observe(item) { this.items.add(item); }
    disconnect() { this.items.clear(); }
  }
  vm.runInContext(source, vm.createContext({
    window, ResizeObserver, getComputedStyle: (item) => ({ gridAutoRows: item.rows }),
    requestAnimationFrame: (callback) => { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
  }));
  const layout = window.MefiCardLayout.create({ lists: () => [list], visible: () => !hidden });
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); };
  return { layout, list, frames, observers, animations, flush, card,
    hide: () => { hidden = true; }, show: () => { hidden = false; },
    reduce: () => { reduced = true; }, motionOff: () => { motionOff = true; } };
}

test("card grids reserve measured height, coalesce resize signals and glide displaced cards", () => {
  const env = environment();
  env.layout.refresh(); env.flush();
  assert.deepEqual(env.list.children.map((item) => item.style.gridRowEnd), ["span 18", "span 33", "span 23"]);
  assert.equal(env.observers[0].items.size, 4);
  assert.equal(env.animations.length, 0, "new cards just appear");
  env.list.children[0].height = 96;
  env.observers[0].callback(); env.observers[0].callback();
  assert.equal(env.frames.size, 1, "one layout for a burst of content/width changes");
  env.flush();
  assert.equal(env.list.children[0].style.gridRowEnd, "span 27");
  assert.equal(env.animations.length, 1);
  assert.equal(env.animations[0].keys[0].transform, "translate(0px, -36px)");
});

test("reduced motion and Studio motion off still fit cards without gliding", () => {
  for (const quiet of ["reduce", "motionOff"]) {
    const env = environment(); env.layout.refresh(); env.flush(); env[quiet]();
    env.list.children[0].height = 96;
    env.observers[0].callback(); env.flush();
    assert.equal(env.list.children[0].style.gridRowEnd, "span 27");
    assert.equal(env.animations.length, 0);
  }
});

test("list mode clears masonry spans and replaced cards release their observers", () => {
  const env = environment(); env.layout.refresh(); env.flush();
  env.list.rows = "auto";
  env.observers[0].callback(); env.flush();
  assert.ok(env.list.children.every((item) => item.style.gridRowEnd === ""));
  const old = env.list.children[0], fresh = env.card(44);
  env.list.children = [fresh]; env.list.rows = "4px";
  env.layout.refresh(); env.flush();
  assert.equal(env.observers.length, 1);
  assert.equal(env.observers[0].items.has(old), false);
  assert.equal(fresh.style.gridRowEnd, "span 14");
});

test("closing cancels pending layout and glides; reopening observes the current grid once", () => {
  const env = environment(); env.layout.refresh(); env.flush();
  env.list.children[0].height = 96;
  env.observers[0].callback(); env.flush();
  env.observers[0].callback();
  env.hide(); env.layout.stop();
  assert.equal(env.frames.size, 0);
  assert.equal(env.observers[0].items.size, 0);
  assert.equal(env.animations[0].cancelled, true);
  env.observers[0].callback();
  assert.equal(env.frames.size, 0, "a stale resize callback after closing cannot restart layout");
  env.show(); env.layout.refresh(); env.flush();
  assert.equal(env.observers.length, 1);
  assert.equal(env.observers[0].items.size, 4);
});

test("a hidden list never overwrites its cards with zero-height spans", () => {
  const env = environment(); env.layout.refresh(); env.flush();
  env.list.width = 0;
  env.list.children[0].height = 0;
  env.observers[0].callback(); env.flush();
  assert.equal(env.list.children[0].style.gridRowEnd, "span 18");
});

test("a sheet entrance transform cannot shrink reserved card space", () => {
  const env = environment();
  for (const item of env.list.children) {
    Object.defineProperty(item, "offsetHeight", { get: () => item.height });
    const bounds = item.getBoundingClientRect.bind(item);
    item.getBoundingClientRect = () => ({ ...bounds(), height: item.height * .8 });
  }
  env.layout.refresh(); env.flush();
  assert.deepEqual(env.list.children.map((item) => item.style.gridRowEnd), ["span 18", "span 33", "span 23"], "the CSS grid reserves full layout height during entrance motion");
});

test("revealing a card list can measure before keyboard focus or scrolling", () => {
  const env = environment();
  env.layout.refresh();
  assert.equal(env.frames.size, 1);
  env.layout.refresh({ immediate: true });
  assert.equal(env.frames.size, 0, "the pending frame is consumed by the immediate measurement");
  assert.deepEqual(env.list.children.map((item) => item.style.gridRowEnd), ["span 18", "span 33", "span 23"]);
});
