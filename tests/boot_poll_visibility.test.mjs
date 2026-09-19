// Poll visibility guard: boot.js's shared poll guard must keep a hidden tab
// silent — no interval running means no fetch — and hide/show toggles must
// never stack intervals: a key holds at most one timer, so after any number
// of starts and window toggles exactly one interval is live again. nav.js's
// badge poll rides the same guard, so its wiring is asserted at source shape.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Evaluate boot.js with a stub document/window and counting fake timers, so
// the tests watch interval lifecycle without waiting on real milliseconds.
async function loadBoot() {
  const state = { hidden: false };
  const handlers = {};
  const live = new Set();
  let nextId = 1;
  const context = {
    window: {},
    document: {
      get hidden() {
        return state.hidden;
      },
      addEventListener(type, fn) {
        handlers[type] = fn;
      },
    },
    setInterval(fn, ms) {
      const id = nextId++;
      live.add(id);
      return id;
    },
    clearInterval(id) {
      live.delete(id);
    },
    setTimeout() {
      return nextId++;
    },
    clearTimeout() {},
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    console,
  };
  vm.createContext(context);
  const source = await readFile(path.join(STUDIO, "renderer", "boot.js"), "utf8");
  vm.runInContext(source, context);
  const boot = context.window.MefiBoot;
  assert.ok(boot, "boot.js must expose window.MefiBoot");
  return {
    boot,
    handlers,
    live,
    show() {
      state.hidden = false;
      handlers.visibilitychange();
    },
    hide() {
      state.hidden = true;
      handlers.visibilitychange();
    },
  };
}

test("a poll started while hidden sets no interval until the window shows", async () => {
  const env = await loadBoot();
  env.hide();
  env.boot.pollStart("k", () => {}, 1000);
  assert.equal(env.live.size, 0, "a hidden window must set no interval");
  assert.equal(env.boot.pollActive("k"), false);
  env.show();
  assert.equal(env.live.size, 1, "showing the window must start exactly one interval");
  assert.equal(env.boot.pollActive("k"), true);
});

test("a poll started while visible stops the moment the window hides", async () => {
  const env = await loadBoot();
  env.boot.pollStart("k", () => {}, 1000);
  assert.equal(env.live.size, 1);
  env.hide();
  assert.equal(env.live.size, 0, "a hidden tab must issue no fetches: no live interval");
  env.show();
  assert.equal(env.live.size, 1, "the interval must come back on show");
});

test("two starts and two hide/show toggles leave exactly one active interval", async () => {
  const env = await loadBoot();
  const key = "nav.badges";
  env.boot.pollStart(key, () => {}, 1000);
  env.boot.pollStart(key, () => {}, 1000);
  assert.equal(env.live.size, 1, "a second start must clear the first interval");
  env.hide();
  env.show();
  env.hide();
  env.show();
  assert.equal(env.live.size, 1, "two hide/show toggles must leave one active interval");
  assert.equal(env.boot.pollActive(key), true);
  env.boot.pollStop(key);
  assert.equal(env.live.size, 0, "pollStop must clear the interval");
});

test("each registered key holds its own single interval across toggles", async () => {
  const env = await loadBoot();
  env.boot.pollStart("nav.badges", () => {}, 1000);
  env.boot.pollStart("tasks.board", () => {}, 1000);
  assert.equal(env.live.size, 2);
  env.hide();
  assert.equal(env.live.size, 0);
  env.show();
  assert.equal(env.live.size, 2, "show must restore one interval per key");
});

test("nav.js rides the shared guard: pollStart for the badge poll, hidden-aware tick", async () => {
  const source = await readFile(path.join(STUDIO, "renderer", "nav.js"), "utf8");
  assert.match(source, /pollStart\("nav\.badges"/, "the badge poll must register under the shared guard");
  assert.match(source, /const badgeTick = \(\) => \{\s*\n\s*if \(!document\.hidden\) refreshBadges\(\);/, "the tick must bail while hidden");
  assert.match(source, /document\.addEventListener\("visibilitychange"/, "badges must snap back on show");
});
