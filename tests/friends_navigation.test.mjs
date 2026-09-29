import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createDom } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/companion-hub.js", import.meta.url), "utf8");

function load({ delayed = false } = {}) {
  const { document } = createDom();
  document.hidden = true; // No audio animation loop in this behavior fixture.
  const frames = [], paints = [], listeners = {}, made = [], disposed = [];
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
    MefiNav: { noMotion: () => true, typeScope() {} },
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
    hub: window.MefiCompanionHub, document, window, origin, made, disposed,
    layer: () => document.querySelector("#agent-hub"),
    flush: () => { for (const paint of paints.splice(0)) paint(); for (const frame of frames.splice(0)) frame(); },
    fire: (type, event = {}) => { for (const fn of listeners[type] ?? []) fn({ type, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...event }); },
  };
}

for (const [target, id] of [["rooms", "rooms-title"], ["pcs", "pc-sync-title"], ["playground", "friends-title"]]) {
  test(`Friends ${target} opens and focuses the existing card after its transition paints`, () => {
    const loaded = load({ delayed: true });
    assert.equal(loaded.hub.open({ section: "friends", target }), true);
    assert.equal(loaded.layer().dataset.section, "friends");
    assert.equal(loaded.document.querySelector(`#${id}`), null, "transition has not painted yet");
    loaded.fire("mefi:nav", { detail: { id: target === "pcs" ? "your-pcs" : target, action: "open" } });
    assert.equal(loaded.hub.isOpen(), true, "its own navigation event keeps the hub open");
    loaded.flush();
    const heading = loaded.document.querySelector(`#${id}`);
    assert.equal(loaded.document.activeElement, heading);
    assert.equal(heading.tabIndex, -1, "card heading accepts programmatic focus");
    assert.equal(heading.scrolledIntoView, true, "a card below the fold comes into view");
    assert.deepEqual(loaded.made, ["playground", "rooms", "pcs"], "same Friends cards are built once");
  });
}

test("another Friends target preserves mounted room chat; Escape returns through the bubbles to its menu origin", () => {
  const loaded = load();
  loaded.hub.open({ section: "friends", target: "rooms" }); loaded.flush();
  const room = loaded.document.querySelector("#rooms-title");
  loaded.hub.open({ section: "friends", target: "pcs" });
  assert.equal(loaded.document.querySelector("#rooms-title"), room, "switching targets retains existing room controls");
  assert.equal(loaded.document.activeElement.id, "pc-sync-title");
  assert.deepEqual(loaded.disposed, []);
  loaded.fire("keydown", { key: "Escape" });
  assert.equal(loaded.hub.isOpen(), true);
  assert.equal(loaded.layer().dataset.section, "home");
  assert.deepEqual(loaded.disposed, ["playground", "rooms", "pcs"], "leaving Friends releases its cards once");
  loaded.fire("keydown", { key: "Escape" });
  assert.equal(loaded.hub.isOpen(), false);
  assert.equal(loaded.document.activeElement, loaded.origin);
});

test("a second target requested before the Friends transition paints wins focus", () => {
  const loaded = load({ delayed: true });
  loaded.hub.open({ section: "friends", target: "rooms" });
  loaded.hub.open({ section: "friends", target: "pcs" });
  loaded.flush();
  assert.equal(loaded.document.activeElement.id, "pc-sync-title");
  assert.deepEqual(loaded.made, ["playground", "rooms", "pcs"]);
});

test("legacy companion entry still opens all bubbles, and unrelated navigation closes targeted Friends", () => {
  const loaded = load();
  loaded.hub.open();
  assert.equal(loaded.layer().dataset.section, "home");
  assert.equal(loaded.document.activeElement.id, "agent-hub-return");
  loaded.hub.open("friends"); loaded.flush();
  assert.equal(loaded.layer().dataset.section, "friends");
  loaded.fire("mefi:nav", { detail: { id: "tasks", action: "open" } });
  assert.equal(loaded.hub.isOpen(), false);
  assert.deepEqual(loaded.disposed, ["playground", "rooms", "pcs"]);
  assert.equal(loaded.origin.inert, undefined, "the modal releases its origin");
});

test("closing before target focus runs leaves focus at the invoking menu", () => {
  const loaded = load();
  loaded.hub.open({ section: "friends", target: "playground" });
  loaded.hub.close({ immediate: true }); loaded.flush();
  assert.equal(loaded.hub.isOpen(), false);
  assert.equal(loaded.document.activeElement, loaded.origin);
});
