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
  const frames = [], paints = [], listeners = {}, made = [], disposed = [], goes = [];
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
  const asked = [];
  const released = [];
  const card = (kind, id) => {
    made.push(kind);
    const root = document.createElement("section"), heading = document.createElement("h4");
    heading.id = id; heading.textContent = kind; root.append(heading);
    root.dispose = () => disposed.push(kind);
    return root;
  };
  const window = {
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    MefiNav: {
      noMotion: () => true, typeScope() {}, claim() {}, release: (id) => released.push(id), paintCurrent() {},
      go: (id, params) => { goes.push([id, params]); if (id === "friends-page") window.MefiCompanionHub.openPlace(params); },
      closeAll: () => window.MefiCompanionHub.closePlace(),
    },
    dispatchEvent: () => true,
    MefiCompanionUI: { freeze() {} },
    MefiMotion: { swap: (_owner, paint) => delayed ? paints.push(paint) : paint() },
    MefiRooms: { panel: (options) => { asked.push(options?.room ?? null); return card("rooms", "rooms-title"); }, subscribe() {}, pending: () => 0 },
    MefiPcSync: { card: () => card("pcs", "pc-sync-title"), subscribe() {}, badge: () => 0 },
    MefiCompanionFriends: { card: () => card("playground", "friends-title") },
    MefiProjectHub: { card: () => card("hub", "project-hub-title") },
    MefiFriendsEvents: { card: () => card("events", "friends-events-title") },
    MefiShop: { card: () => card("shop", "friends-shop-title") },
    MefiFriendsFront: { card: () => card("lobby", "friends-front-title") },
  };
  const context = vm.createContext({
    window, document, console,
    localStorage: { getItem: () => null },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    MutationObserver: class { observe() {} },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
    setTimeout: () => 0, clearTimeout() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  });
  vm.runInContext(source, context);
  window.MefiCompanionHub.attach({ orb, panel, toggle() {}, refresh() {} });
  return {
    hub: window.MefiCompanionHub, document, window, origin, made, disposed, goes, asked, released,
    page: () => document.querySelector("#friends-overlay"),
    layer: () => document.querySelector("#agent-hub"),
    flush: () => { for (const paint of paints.splice(0)) paint(); for (const frame of frames.splice(0)) frame(); },
    fire: (type, event = {}) => { for (const fn of listeners[type] ?? []) fn({ type, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...event }); },
  };
}

// Friends is a page of its own (renderer/companion-hub.js openPlace): the
// companion's Friends bubble and its targets open that page at a place, one
// card at a time; the frame's list column lists the places.
for (const [target, title, kind] of [["lobby", "The Lobby", "lobby"], ["rooms", "Rooms", "rooms"], ["pcs", "Your PCs", "pcs"], ["playground", "Playground", "playground"], ["hub", "Project hub", "hub"], ["events", "Events", "events"], ["shop", "Shop", "shop"]]) {
  test(`Friends ${target} opens the Friends page at that place, not the bubbles`, () => {
    const loaded = load();
    assert.equal(loaded.hub.open({ section: "friends", target }), true);
    assert.equal(loaded.hub.isOpen(), false, "the bubbles stay closed");
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.goes)), [["friends-page", { place: target }]]);
    const page = loaded.page();
    assert.equal(page.hidden, false);
    assert.equal(page.dataset.place, target);
    assert.equal(loaded.document.querySelector("#friends-place-title").textContent, title);
    assert.deepEqual(loaded.made, [kind], "only the place's own card is built");
    assert.equal(loaded.document.querySelector("#friends-place-tabs"), null, "the list column lists the places: no tabs of the page's own");
    const places = [...loaded.hub.friendsPlaces()];
    assert.deepEqual(places.map((place) => place.label), ["The Lobby", "Rooms", "Your PCs", "Playground", "Project hub", "Events", "Shop"], "Moderation shows only to moderators");
    assert.deepEqual(places.filter((place) => place.current).map((place) => place.id), [target]);
  });
}

test("another place swaps the card and lets the last one go; closing releases the page", () => {
  const loaded = load();
  loaded.hub.open({ section: "friends", target: "rooms" });
  loaded.window.MefiNav.go("friends-page", { place: "pcs" });
  assert.equal(loaded.page().dataset.place, "pcs");
  assert.deepEqual(loaded.made, ["rooms", "pcs"]);
  assert.deepEqual(loaded.disposed, ["rooms"], "Rooms let go of its open room");
  assert.deepEqual(loaded.released, [], "moving between places keeps the page's layer");
  loaded.window.MefiNav.closeAll();
  assert.equal(loaded.page().hidden, true);
  assert.deepEqual(loaded.disposed, ["rooms", "pcs"]);
  assert.deepEqual(loaded.released, ["friends-page"], "closing gives the sheet layer back, so the next page owns the breadcrumb, tab and list");
});

test("a target nobody knows lands on The Lobby, Friends' front page", () => {
  const loaded = load();
  loaded.hub.open({ section: "friends", target: "somewhere" });
  assert.equal(loaded.page().dataset.place, "lobby");
});

test("the companion's menu still opens its bubbles; an open menu gives way to the Friends page", () => {
  const loaded = load();
  loaded.hub.open();
  assert.equal(loaded.layer().dataset.section, "home");
  assert.equal(loaded.document.activeElement.id, "agent-hub-return");
  loaded.hub.open("friends");
  assert.equal(loaded.hub.isOpen(), false, "the menu closes for the page");
  assert.equal(loaded.page().hidden, false);
  assert.equal(loaded.page().dataset.place, "lobby", "Friends without a target opens The Lobby, its front page");
});

test("a room asked for by name opens in Rooms, even when Rooms is already up; the other places never get one", () => {
  const loaded = load();
  loaded.window.MefiNav.go("friends-page", { place: "rooms", room: "abc123" });
  loaded.window.MefiNav.go("friends-page", { place: "rooms", room: "lobby" });
  loaded.window.MefiNav.go("friends-page", { place: "pcs", room: "abc123" });
  loaded.window.MefiNav.go("friends-page", { place: "rooms" });
  assert.deepEqual(loaded.asked, ["abc123", "lobby", null], "Rooms painted again for each named room, and without one on coming back");
  assert.deepEqual(loaded.made, ["rooms", "rooms", "pcs", "rooms"]);
});

test("any navigation closes the open bubbles", () => {
  const loaded = load();
  loaded.hub.open();
  loaded.fire("mefi:nav", { detail: { id: "tasks", action: "open" } });
  assert.equal(loaded.hub.isOpen(), false);
});

// The Shop is a page of its own (renderer/friends-shop.js, route "shop"): Friends' place "shop" and the bubble's target
// open that page, not a card in Friends; its row stays in Friends' list and is the current one while the page shows.
// Without MefiShop.pageOn (an older build) or with "mefiStudio.shop.page" off, it is Friends' place as before (above).
test("the Shop's place opens the Shop's own page, and its row is current while that page shows", () => {
  const loaded = load();
  let route = null;
  loaded.window.MefiShop.pageOn = () => true;
  const go = loaded.window.MefiNav.go;
  loaded.window.MefiNav.go = (id, params) => { if (id === "shop") route = "shop"; return go(id, params); };
  loaded.window.MefiNav.current = () => route;
  assert.equal(loaded.hub.open({ section: "friends", target: "shop" }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.goes)), [["friends-page", { place: "shop" }], ["shop", null]], "Friends' place goes on to the route");
  assert.equal(loaded.page()?.hidden ?? true, true, "Friends' page does not open for it");
  assert.deepEqual(loaded.made, [], "no Shop card is built inside Friends");
  const places = [...loaded.hub.friendsPlaces()];
  assert.deepEqual(places.map((place) => place.label), ["The Lobby", "Rooms", "Your PCs", "Playground", "Project hub", "Events", "Shop"], "the Shop keeps its row among Friends' places");
  assert.deepEqual(places.filter((place) => place.current).map((place) => place.id), ["shop"]);
  places.find((place) => place.id === "shop").run();
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.goes.at(-2))), ["friends-page", { place: "shop" }], "its row goes the same way");
});
