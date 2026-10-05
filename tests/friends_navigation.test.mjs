// The companion's Friends bubble (renderer/companion-hub.js): Friends is a place of its own, so asking the hub for it
// (the bubble, a menu's Friends entry with a target) closes the hub and goes to the Friends page at that place; the
// hub never builds the Friends cards itself. The page's own walk is tests/friends_render.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createDom } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/companion-hub.js", import.meta.url), "utf8");

function load({ delayed = false } = {}) {
  const { document } = createDom();
  document.hidden = true; // No audio animation loop in this behavior fixture.
  const frames = [], paints = [], listeners = {}, made = [], disposed = [], went = [];
  const create = document.createElement;
  document.createElement = (tag) => {
    const el = create(tag);
    el.style.setProperty = (key, value) => { el.style[key] = value; };
    el.focus = () => { document.activeElement = el; };
    el.getClientRects = () => el.hidden ? [] : [{}];
    Object.defineProperty(el, "parentElement", { get: () => el.parentNode });
    Object.defineProperty(el, "isConnected", { get: () => document.body.contains(el) });
    return el;
  };
  const origin = document.createElement("button"); origin.id = "friends-menu-origin";
  const orb = document.createElement("button"), panel = document.createElement("div");
  document.body.append(origin, orb, panel); document.activeElement = origin;
  const card = (kind, id) => {
    made.push(kind);
    const root = document.createElement("section"), heading = document.createElement("h4");
    heading.id = id; heading.textContent = kind; root.append(heading);
    root.dispose = () => disposed.push(kind);
    return root;
  };
  const window = {
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    MefiNav: { noMotion: () => true, typeScope() {}, go: (id, params) => { went.push([id, { ...params }]); } },
    MefiCompanionUI: { freeze() {} },
    MefiMotion: { swap: (_owner, paint) => delayed ? paints.push(paint) : paint() },
    MefiRooms: { panel: () => card("rooms", "rooms-title"), subscribe() {}, pending: () => 0 },
    MefiPcSync: { card: () => card("pcs", "pc-sync-title"), subscribe() {}, badge: () => 0 },
    MefiCompanionFriends: { card: () => card("playground", "friends-title") },
  };
  const context = vm.createContext({
    window, document, console,
    localStorage: { getItem: () => null },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    MutationObserver: class { observe() {} },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
    setTimeout: () => 0, clearTimeout() {},
  });
  vm.runInContext(source, context);
  window.MefiCompanionHub.attach({ orb, panel, toggle() {}, refresh() {} });
  return {
    hub: window.MefiCompanionHub, document, window, origin, made, disposed, went,
    layer: () => document.querySelector("#agent-hub"),
    flush: () => { for (const paint of paints.splice(0)) paint(); for (const frame of frames.splice(0)) frame(); },
    fire: (type, event = {}) => { for (const fn of listeners[type] ?? []) fn({ type, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...event }); },
  };
}

for (const target of ["rooms", "pcs", "playground"]) {
  test(`Friends ${target} goes to the Friends page at that place, without a bubble or a card of the hub's`, () => {
    const loaded = load();
    assert.equal(loaded.hub.open({ section: "friends", target }), true);
    assert.equal(loaded.hub.isOpen(), false, "no bubble opens for Friends");
    assert.deepEqual(loaded.went, [["friends-page", { place: target }]]);
    assert.deepEqual(loaded.made, [], "the page builds the cards, not the hub");
  });
}

test("Friends without a known target lands on Rooms", () => {
  const loaded = load();
  loaded.hub.open("friends");
  loaded.hub.open({ section: "friends", target: "somewhere" });
  assert.deepEqual(loaded.went, [["friends-page", { place: "rooms" }], ["friends-page", { place: "rooms" }]]);
});

test("the bubbles still open, Friends from them closes the hub on its way to the page, and Escape closes as before", () => {
  const loaded = load();
  loaded.hub.open();
  assert.equal(loaded.layer().dataset.section, "home");
  assert.equal(loaded.document.activeElement.id, "agent-hub-return");
  loaded.hub.open({ section: "friends", target: "pcs" });
  assert.equal(loaded.hub.isOpen(), false, "the hub lets go before the page opens");
  assert.deepEqual(loaded.went, [["friends-page", { place: "pcs" }]]);
  assert.equal(loaded.origin.inert, undefined, "the modal releases its origin");
  loaded.hub.open();
  loaded.fire("keydown", { key: "Escape" });
  assert.equal(loaded.hub.isOpen(), false);
});

test("any navigation closes the open hub", () => {
  const loaded = load();
  loaded.hub.open();
  loaded.fire("mefi:nav", { detail: { id: "tasks", action: "open" } });
  assert.equal(loaded.hub.isOpen(), false);
  assert.deepEqual(loaded.disposed, []);
});
