// Panes (renderer/panes.js): the windows that pop in and out of Build's Home.
// A pane sits docked beside the page in its owner's order, floats as a window
// you can move and resize, or is closed to a hidden shelf that keeps its parts
// in the document. Where each pane lives is remembered under
// mefiStudio.panes.v1, and a pane nobody has placed by hand follows its
// owner's wish (auto). The real script runs here in the shared fake DOM
// (tests/fixtures/builder-env.mjs); pixels and real pointer capture belong to
// the Electron fixtures.
import test from "node:test";
import assert from "node:assert/strict";

import { createEnv } from "./fixtures/builder-env.mjs";

const KEY = "mefiStudio.panes.v1";
const clean = (value) => JSON.parse(JSON.stringify(value));
const stored = (storage) => JSON.parse(storage.get(KEY) ?? "null");

// The page's own rects: a 1920x1080 host, with the dock on its right edge.
const RECTS = {
  page: { left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080 },
  dock: { left: 1520, top: 0, right: 1920, bottom: 1080, width: 400, height: 1080 },
  docked: { left: 1540, top: 100, right: 1920, bottom: 400, width: 380, height: 300 },
};

async function bench({ storage = new Map(), throwing = false, layers = true, host: withHost = true } = {}) {
  const env = createEnv({ storage, throwing });
  await env.load("panes.js");
  const { document } = env;
  const host = env.node("div", { id: "host", parent: document.body });
  const dock = env.node("aside", { id: "dock", parent: host });
  const floats = env.node("div", { id: "floats", parent: host });
  host.getBoundingClientRect = () => RECTS.page;
  floats.getBoundingClientRect = () => RECTS.page;
  dock.getBoundingClientRect = () => RECTS.dock;
  const P = env.window.MefiPanes;
  const calls = [];
  const make = (id, order, extra = {}) => {
    const content = env.node("div", { id: `${id}-content` });
    const record = P.register({ id, title: id[0].toUpperCase() + id.slice(1), glyph: "g-frame", order, content, onShow: () => calls.push(["show", id]), onHide: () => calls.push(["hide", id]), ...extra });
    record.element.getBoundingClientRect = () => RECTS.docked;
    return { id, content, record, element: record.element };
  };
  const panes = { activity: make("activity", 0), output: make("output", 1), checks: make("checks", 2) };
  const attach = () => P.attach({ ...(layers ? { dock, floats } : {}), ...(withHost ? { host } : {}) });
  attach();
  const find = (id) => document.querySelector(`[data-pane="${id}"]`);
  const order = () => dock.children.map((node) => node.dataset.pane);
  const shelf = () => host.querySelector(".pane-shelf");
  const part = (id, selector) => find(id).querySelector(selector);
  return { env, document, host, dock, floats, P, panes, calls, attach, find, order, shelf, part, storage };
}

test("nothing is written or built until an owner registers a pane", async () => {
  const env = createEnv();
  await env.load("panes.js");
  const P = env.window.MefiPanes;
  assert.deepEqual(clean(P.list()), []);
  assert.equal(P.open("nothing"), false);
  assert.equal(P.close("nothing"), false);
  assert.equal(P.toggle("nothing"), false);
  assert.equal(P.popOut("nothing"), false);
  assert.equal(P.dockIn("nothing"), false);
  assert.equal(P.where("nothing"), "closed");
  assert.equal(P.isOpen("nothing"), false);
  assert.equal(env.storage.size, 0, "loading the script stores nothing");
  assert.equal(env.listeners("resize"), 1, "the one window listener keeps floating windows reachable");
  assert.equal(P.register({ title: "No id" }), null, "a pane needs an id");
  const first = P.register({ id: "once", title: "Once" });
  assert.equal(P.register({ id: "once", title: "Twice" }), first, "an id registers once");
  assert.equal(P.list().length, 1);
});

test("docked panes stack beside the page in their owner's order, whatever order they open in", async () => {
  const b = await bench();
  assert.deepEqual(clean(b.P.list()), [
    { id: "activity", title: "Activity", glyph: "g-frame", where: "closed" },
    { id: "output", title: "Output", glyph: "g-frame", where: "closed" },
    { id: "checks", title: "Checks", glyph: "g-frame", where: "closed" },
  ], "nothing is open until someone opens it or the owner wishes it");
  assert.equal(b.dock.hidden, true, "an empty dock takes no room");
  assert.equal(b.host.getAttribute("data-dock"), "closed");

  assert.equal(b.P.open("checks"), true);
  assert.equal(b.P.open("activity"), true);
  assert.equal(b.P.open("output"), true);
  assert.deepEqual(b.order(), ["activity", "output", "checks"]);
  assert.equal(b.dock.hidden, false);
  assert.equal(b.dock.dataset.count, "3");
  assert.equal(b.dock.dataset.open, "true");
  assert.equal(b.host.getAttribute("data-dock"), "open", "the page makes room for the dock");
  for (const id of ["activity", "output", "checks"]) {
    const element = b.find(id);
    assert.equal(element.hidden, false);
    assert.equal(element.dataset.where, "dock");
    assert.ok(element.classList.contains("pane-docked") && !element.classList.contains("pane-floating"));
    assert.equal(element.getAttribute("role"), "region");
    assert.equal(element.getAttribute("aria-label"), element.querySelector(".pane-title").textContent);
  }
  assert.deepEqual(clean(b.P.list().map((pane) => pane.where)), ["dock", "dock", "dock"]);
  assert.ok(b.P.isOpen("output"));
  assert.deepEqual(b.calls, [["show", "checks"], ["show", "activity"], ["show", "output"]], "an owner hears when its pane appears");
});

test("a pane's element and what it holds travel between the dock, a window and the shelf", async () => {
  const b = await bench();
  const { activity } = b.panes;
  const body = activity.element.querySelector(".pane-body");
  assert.equal(activity.content.parentNode, body, "the owner's content lives in the pane body");
  b.P.open("activity");
  assert.equal(activity.element.parentNode, b.dock);
  b.P.popOut("activity");
  assert.equal(activity.element.parentNode, b.floats, "the window is the same element, moved");
  assert.equal(b.dock.children.includes(activity.element), false, "and it left the dock");
  assert.equal(activity.content.parentNode, body, "so a draft, a scroll position or an open disclosure survives");
  b.P.dockIn("activity");
  assert.equal(activity.element.parentNode, b.dock);
  assert.equal(b.floats.children.includes(activity.element), false);
  b.P.close("activity");
  assert.equal(activity.element.parentNode, b.shelf());
  assert.equal(activity.content.parentNode, body);
  assert.equal(body.parentNode, activity.element);
});

test("a window floats where the pane was, stays reachable, and docks again", async () => {
  const b = await bench();
  b.P.open("activity");
  assert.equal(b.P.popOut("activity"), true);
  const element = b.find("activity");
  assert.equal(b.P.where("activity"), "float");
  assert.equal(element.parentNode, b.floats);
  assert.equal(element.dataset.where, "float");
  assert.ok(element.classList.contains("pane-floating") && !element.classList.contains("pane-docked"));
  // It opens over where the docked pane was, a little in from its left and below its top.
  assert.deepEqual([element.style.left, element.style.top, element.style.width, element.style.height], ["1500px", "124px", "380px", "300px"]);
  assert.ok(Number(element.style.zIndex) > 10, "a window sits above the page");
  assert.ok(element.classList.contains("pane-front"));
  assert.equal(b.part("activity", ".pane-fold").hidden, true, "a window has no fold: only a docked pane folds");
  assert.equal(b.part("activity", ".pane-pop").title, "Dock Activity beside the page");
  assert.equal(b.dock.hidden, true, "the dock closes when its last pane leaves");
  assert.equal(b.host.getAttribute("data-dock"), "closed");

  // Off the edge of a smaller page, a window is drawn back so its title bar stays reachable.
  b.env.window.innerWidth = 700;
  const mem = stored(b.storage).activity;
  assert.deepEqual([mem.where, mem.chosen, mem.x, mem.y, mem.w, mem.h], ["float", true, 1500, 124, 380, 300]);
  RECTS.page = { ...RECTS.page, right: 700, width: 700 };
  try {
    b.env.emit("resize");
    assert.equal(element.style.left, `${700 - 56}px`, "at most 56px of a window may hang past the edge");
  } finally {
    RECTS.page = { left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080 };
  }

  assert.equal(b.P.dockIn("activity"), true);
  assert.equal(b.P.where("activity"), "dock");
  assert.equal(element.parentNode, b.dock);
  assert.deepEqual([element.style.left, element.style.top, element.style.width, element.style.zIndex], ["", "", "", ""], "a docked pane carries no window geometry");
  assert.equal(b.part("activity", ".pane-fold").hidden, false);
  assert.equal(b.dock.hidden, false);
});

test("popping out at the pointer puts the window under it", async () => {
  const b = await bench();
  b.P.open("output");
  b.P.popOut("output", { at: { x: 900, y: 300 } });
  const element = b.find("output");
  assert.deepEqual([element.style.left, element.style.top], ["780px", "284px"], "120px in from the pointer, 16px below it");
  // The window keeps its size the next time it pops out, wherever it goes.
  b.P.dockIn("output");
  b.P.popOut("output", { at: { x: 400, y: 200 } });
  assert.deepEqual([element.style.width, element.style.height], ["380px", "300px"]);
  assert.equal(element.style.left, "280px");
  assert.equal(b.P.popOut("output", { at: { x: 5, y: 5 } }), true);
  const noLayer = await bench({ layers: false });
  noLayer.P.open("output");
  assert.equal(noLayer.P.popOut("output"), false, "no window layer: nothing to pop out into");
  assert.equal(noLayer.P.where("output"), "closed", "and with no dock either, a pane cannot be shown at all");
});

test("closing sends a pane to the shelf, hidden but still in the document", async () => {
  const b = await bench();
  b.P.open("activity");
  b.calls.length = 0;
  const shelf = b.shelf();
  assert.ok(shelf, "attach makes the shelf inside the host");
  assert.equal(shelf.hidden, true);
  assert.equal(shelf.getAttribute("aria-hidden"), "true");
  assert.equal(shelf.parentNode, b.host);
  assert.equal(b.P.close("activity"), true);
  const element = b.find("activity");
  assert.equal(b.P.where("activity"), "closed");
  assert.equal(element.hidden, true);
  assert.equal(element.parentNode, shelf);
  assert.equal(element.dataset.where, "closed");
  assert.equal(b.dock.hidden, true);
  assert.equal(b.document.getElementById("activity-content"), b.panes.activity.content, "its parts are still found by id, as Home's own code needs");
  assert.deepEqual(b.calls, [["hide", "activity"]]);
  assert.equal(b.P.close("activity"), false, "closing a closed pane is nothing");
  assert.deepEqual(b.calls, [["hide", "activity"]]);
  // Every pane that has never been opened waits on the shelf too.
  assert.deepEqual(shelf.children.map((node) => node.dataset.pane).sort(), ["activity", "checks", "output"]);
});

test("toggle brings a closed pane back where it last was", async () => {
  const b = await bench();
  b.P.open("checks");
  b.P.popOut("checks");
  b.P.close("checks");
  assert.equal(stored(b.storage).checks.lastWhere, "float");
  assert.equal(b.P.toggle("checks"), true);
  assert.equal(b.P.where("checks"), "float", "closed from a window, it reopens as one");
  b.P.dockIn("checks");
  b.P.toggle("checks");
  assert.equal(b.P.where("checks"), "closed");
  b.P.toggle("checks");
  assert.equal(b.P.where("checks"), "dock", "closed from the dock, it reopens there");
  assert.equal(b.P.toggle("checks"), true);
  assert.equal(b.P.where("checks"), "closed");
});

test("the pane's own buttons close, fold and pop it, and Escape closes a window", async () => {
  const b = await bench();
  b.P.open("activity");
  await b.part("activity", ".pane-fold").click();
  assert.equal(b.find("activity").dataset.folded, "true", "fold shrinks a docked pane to its bar");
  assert.equal(b.part("activity", ".pane-fold").getAttribute("aria-expanded"), "false");
  assert.equal(b.dock.dataset.open, "false", "a dock of folded panes needs little room");
  assert.equal(stored(b.storage).activity.folded, true);
  await b.part("activity", ".pane-fold").click();
  assert.equal(b.find("activity").dataset.folded, "false");
  assert.equal(b.dock.dataset.open, "true");

  await b.part("activity", ".pane-pop").click();
  assert.equal(b.P.where("activity"), "float");
  assert.equal(b.find("activity").dataset.folded, "false", "a window is never shown folded");
  await b.part("activity", ".pane-pop").click();
  assert.equal(b.P.where("activity"), "dock", "the same button docks it again");

  // Escape closes a window, not a docked pane, and leaves an open menu inside it alone.
  await b.find("activity").trigger("keydown", { key: "Escape" });
  assert.equal(b.P.where("activity"), "dock");
  b.P.popOut("activity");
  const open = b.env.node("button", { parent: b.part("activity", ".pane-body") });
  open.setAttribute("aria-expanded", "true");
  await b.find("activity").trigger("keydown", { key: "Escape", target: open });
  assert.equal(b.P.where("activity"), "float", "Escape first closes the menu that is open");
  open.setAttribute("aria-expanded", "false");
  await b.find("activity").trigger("keydown", { key: "Enter" });
  assert.equal(b.P.where("activity"), "float");
  let stopped = false;
  await b.find("activity").trigger("keydown", { key: "Escape", stopPropagation: () => { stopped = true; } });
  assert.equal(b.P.where("activity"), "closed");
  assert.equal(stopped, true, "the page's own Escape is not also fired");

  await b.part("checks", ".pane-close").click();
  assert.equal(b.P.where("checks"), "closed", "a closed pane's close button does nothing worse");
  b.P.open("checks");
  await b.part("checks", ".pane-close").click();
  assert.equal(b.P.where("checks"), "closed");
});

test("a title bar drags: a docked pane pops out past the dock, a window docks when dropped over it", async () => {
  const b = await bench();
  b.P.open("activity");
  const bar = b.part("activity", ".pane-bar");
  const element = b.find("activity");

  await bar.trigger("pointerdown", { button: 0, clientX: 1600, clientY: 40, pointerId: 1 });
  assert.ok(element.classList.contains("pane-grabbed"));
  await bar.trigger("pointermove", { clientX: 1590, clientY: 45 });
  assert.equal(b.P.where("activity"), "dock", "a nudge inside the dock is not a drag");
  await bar.trigger("pointermove", { clientX: 900, clientY: 300 });
  assert.equal(b.P.where("activity"), "float", "past the dock's edge the pane pops out under the pointer");
  assert.deepEqual([element.style.left, element.style.top], ["780px", "284px"]);
  await bar.trigger("pointermove", { clientX: 700, clientY: 500 });
  assert.deepEqual([element.style.left, element.style.top], ["580px", "484px"], "the window follows the pointer");
  assert.equal(b.host.getAttribute("data-dock-target"), "off");
  await bar.trigger("pointerup", { type: "pointerup", clientX: 700, clientY: 500 });
  assert.equal(b.P.where("activity"), "float", "let go in the open and it stays a window");
  assert.ok(!element.classList.contains("pane-grabbed"));
  assert.deepEqual([stored(b.storage).activity.x, stored(b.storage).activity.y], [580, 484], "where it was left is remembered");

  // With nothing docked the dock is shut, so the place it would open is the host's
  // right edge (its last 72px): the zone lights there, not further in.
  await bar.trigger("pointerdown", { button: 0, clientX: 700, clientY: 500, pointerId: 2 });
  await bar.trigger("pointermove", { clientX: 1700, clientY: 400 });
  assert.equal(b.host.getAttribute("data-dock-target"), "off", "the old dock's area is not a target while the dock is shut");
  await bar.trigger("pointermove", { clientX: 1900, clientY: 400 });
  assert.equal(b.host.getAttribute("data-dock-target"), "on");
  await bar.trigger("pointerup", { type: "pointerup", clientX: 1900, clientY: 400 });
  assert.equal(b.P.where("activity"), "dock", "letting go over the edge docks the window");
  assert.equal(element.parentNode, b.dock);
  assert.equal(b.host.getAttribute("data-dock-target"), "off");

  // With another pane docked, the dock itself is the target, its whole width.
  b.P.open("output");
  b.P.popOut("activity", { at: { x: 900, y: 300 } });
  await bar.trigger("pointerdown", { button: 0, clientX: 900, clientY: 300, pointerId: 3 });
  await bar.trigger("pointermove", { clientX: 1600, clientY: 500 });
  assert.equal(b.host.getAttribute("data-dock-target"), "on", "anywhere over an open dock");
  await bar.trigger("pointermove", { clientX: 1500, clientY: 500 });
  assert.equal(b.host.getAttribute("data-dock-target"), "off", "just past its edge is not");
  await bar.trigger("pointercancel", {});
  assert.equal(b.P.where("activity"), "float", "a cancelled drag leaves the window where it was put");
  assert.equal(b.host.getAttribute("data-dock-target"), "off");
  await b.part("output", ".pane-close").click();
  b.P.dockIn("activity");

  // A double click on the bar pops out and docks; a press on a button is not a drag.
  await bar.trigger("dblclick", {});
  assert.equal(b.P.where("activity"), "float");
  await bar.trigger("dblclick", {});
  assert.equal(b.P.where("activity"), "dock");
  await bar.trigger("dblclick", { target: b.part("activity", ".pane-close") });
  assert.equal(b.P.where("activity"), "dock", "a double click on a tool is the tool's own");
  await bar.trigger("pointerdown", { button: 0, clientX: 1600, clientY: 40, target: b.part("activity", ".pane-pop") });
  assert.ok(!element.classList.contains("pane-grabbed"));
  await bar.trigger("pointerdown", { button: 2, clientX: 1600, clientY: 40 });
  assert.ok(!element.classList.contains("pane-grabbed"), "only the primary button drags");
});

test("a window's corner resizes it within limits, and only while it floats", async () => {
  const b = await bench();
  b.P.open("output");
  const grip = b.part("output", ".pane-grip");
  const element = b.find("output");
  await grip.trigger("pointerdown", { button: 0, clientX: 900, clientY: 700, pointerId: 3 });
  assert.ok(!element.classList.contains("pane-sizing"), "a docked pane has no corner to drag");

  b.P.popOut("output");
  await grip.trigger("pointerdown", { button: 0, clientX: 900, clientY: 700, pointerId: 3 });
  assert.ok(element.classList.contains("pane-sizing"));
  await grip.trigger("pointermove", { clientX: 1000, clientY: 760 });
  assert.deepEqual([element.style.width, element.style.height], ["480px", "360px"]);
  await grip.trigger("pointerup", {});
  assert.ok(!element.classList.contains("pane-sizing"));
  assert.deepEqual([stored(b.storage).output.w, stored(b.storage).output.h], [480, 360]);

  await grip.trigger("pointerdown", { button: 0, clientX: 900, clientY: 700, pointerId: 4 });
  await grip.trigger("pointermove", { clientX: 0, clientY: 0 });
  assert.deepEqual([element.style.width, element.style.height], ["260px", "150px"], "never smaller than 260 by 150");
  await grip.trigger("pointerup", {});
  assert.deepEqual([stored(b.storage).output.w, stored(b.storage).output.h], [260, 150]);
  await grip.trigger("pointerdown", { button: 0, clientX: 0, clientY: 0, pointerId: 5 });
  await grip.trigger("pointermove", { clientX: 9000, clientY: 9000 });
  assert.deepEqual([element.style.width, element.style.height], ["1904px", "1064px"], "nor larger than the page less a margin");
  await grip.trigger("pointercancel", {});
  assert.ok(!element.classList.contains("pane-sizing"), "a cancelled press lets go too");
});

test("where each pane lives is remembered under mefiStudio.panes.v1 and restored next launch", async () => {
  const storage = new Map();
  const first = await bench({ storage });
  first.P.open("activity");
  first.P.popOut("activity", { at: { x: 900, y: 300 } });
  first.P.open("output");
  first.P.close("output");
  first.P.open("checks");
  first.P.setFolded("checks", true);
  assert.deepEqual(clean(stored(storage)), {
    activity: { where: "float", chosen: true, x: 780, y: 284, w: 380, h: 300 },
    output: { where: "closed", chosen: true, lastWhere: "dock" },
    checks: { where: "dock", chosen: true, folded: true },
  });

  // The next launch reads it back: the same window, the same shelf, the same fold.
  const second = await bench({ storage });
  assert.deepEqual(clean(second.P.list().map((pane) => [pane.id, pane.where])), [["activity", "float"], ["output", "closed"], ["checks", "dock"]]);
  const activity = second.find("activity");
  assert.equal(activity.parentNode, second.floats);
  assert.deepEqual([activity.style.left, activity.style.top, activity.style.width, activity.style.height], ["780px", "284px", "380px", "300px"]);
  assert.equal(second.find("checks").dataset.folded, "true");
  assert.equal(second.part("checks", ".pane-fold").getAttribute("aria-expanded"), "false");
  assert.equal(second.find("output").parentNode, second.shelf());
  assert.equal(second.dock.dataset.open, "false", "the only docked pane is folded");
  assert.equal(second.calls.length, 2, "restoring shows the two open panes to their owners once each");

  // "Reset layout" forgets every hand placement.
  second.P.reset();
  assert.deepEqual(clean(stored(storage)), {});
  assert.deepEqual(clean(second.P.list().map((pane) => pane.where)), ["closed", "closed", "closed"]);
  const third = await bench({ storage });
  assert.deepEqual(clean(third.P.list().map((pane) => pane.where)), ["closed", "closed", "closed"]);
});

test("a stored layout that is damaged, or a store that will not open, is harmless", async () => {
  for (const damaged of ["{", "null", "7", "\"text\"", "", "[]", "[1,2]", "{\"activity\":5}", "{\"activity\":null,\"output\":[1]}"]) {
    const storage = new Map([[KEY, damaged]]);
    const b = await bench({ storage });
    assert.deepEqual(clean(b.P.list().map((pane) => pane.where)), ["closed", "closed", "closed"], `${JSON.stringify(damaged)}: every pane starts closed`);
    assert.equal(b.P.open("activity"), true, `${JSON.stringify(damaged)}: and the layout still works`);
    assert.equal(b.P.where("activity"), "dock");
    assert.equal(stored(storage)?.activity?.where, "dock", `${JSON.stringify(damaged)}: and is written back as a plain object`);
  }
  // A saved place that no longer exists reads as closed.
  const odd = await bench({ storage: new Map([[KEY, JSON.stringify({ activity: { where: "sideways", chosen: true } })]]) });
  assert.equal(odd.P.where("activity"), "closed");

  const blocked = await bench({ throwing: true });
  assert.equal(blocked.P.open("output"), true, "a blocked profile still shows panes");
  blocked.P.popOut("output");
  blocked.P.setFolded("checks", true);
  blocked.P.close("output");
  assert.equal(blocked.P.where("output"), "closed");
  blocked.P.reset();
  assert.deepEqual(clean(blocked.P.list().map((pane) => pane.where)), ["closed", "closed", "closed"]);
});

test("the owner's wish opens a pane while it is wanted, until the pane is placed by hand", async () => {
  const storage = new Map();
  const b = await bench({ storage });
  b.calls.length = 0;
  b.P.auto("activity", true);
  assert.equal(b.P.where("activity"), "dock", "wanted: it appears");
  b.P.auto("activity", true);
  assert.deepEqual(b.calls, [["show", "activity"]], "wishing twice shows it once");
  assert.equal(storage.has(KEY), false, "a wish is not a placement and is never stored");
  b.P.auto("activity", false);
  assert.equal(b.P.where("activity"), "closed", "no longer wanted: it goes");
  assert.equal(storage.has(KEY), false);
  b.P.auto("activity", true);

  // Open by hand, it stays through a "not wanted"; closed by hand, through a "wanted".
  b.P.dockIn("activity");
  b.P.auto("activity", false);
  assert.equal(b.P.where("activity"), "dock", "the owner's wish never closes what you placed");
  b.P.close("activity");
  b.P.auto("activity", true);
  assert.equal(b.P.where("activity"), "closed", "nor reopens what you closed");
  // A pane popped out by hand also keeps its window under a wish.
  b.P.auto("checks", true);
  b.P.popOut("checks");
  b.P.auto("checks", false);
  assert.equal(b.P.where("checks"), "float");
  b.P.auto("nothing", true);
  assert.equal(b.P.where("nothing"), "closed");

  // A wish that was on when the layout is attached again keeps the pane docked.
  const fresh = await bench();
  fresh.P.auto("output", true);
  assert.equal(fresh.P.where("output"), "dock");
  fresh.attach();
  assert.equal(fresh.P.where("output"), "dock", "an attach that follows a wish keeps it");
  fresh.P.auto("output", false);
  fresh.attach();
  assert.equal(fresh.P.where("output"), "closed");
});

test("a pane can start docked until the owner or you decide otherwise", async () => {
  const storage = new Map();
  const env = createEnv({ storage });
  await env.load("panes.js");
  const P = env.window.MefiPanes;
  const host = env.node("div", { parent: env.document.body });
  const dock = env.node("aside", { parent: host });
  P.register({ id: "notes", title: "Notes", order: 0, start: "dock" });
  P.register({ id: "later", title: "Later", order: 1 });
  P.attach({ dock, host });
  assert.deepEqual(clean(P.list().map((pane) => [pane.id, pane.where])), [["notes", "dock"], ["later", "closed"]]);
  P.close("notes");
  P.attach({ dock, host });
  assert.equal(P.where("notes"), "closed", "closing it by hand outranks the start");
  assert.deepEqual(clean(stored(storage).notes), { where: "closed", chosen: true, lastWhere: "dock" });
});

test("a badge names what a pane holds, and clears when it holds nothing", async () => {
  const b = await bench();
  const badge = b.part("activity", ".pane-badge");
  assert.equal(badge.hidden, true, "no badge until there is something to say");
  b.P.badge("activity", "live", "run");
  assert.equal(badge.textContent, "live");
  assert.equal(badge.hidden, false);
  assert.equal(badge.dataset.tone, "run");
  b.P.badge("activity", 3, "ask");
  assert.equal(badge.textContent, "3");
  assert.equal(badge.dataset.tone, "ask");
  b.P.badge("activity");
  assert.equal(badge.textContent, "");
  assert.equal(badge.hidden, true);
  assert.doesNotThrow(() => b.P.badge("nothing", "x"));
});

test("Home hears every move on the mefi:panes event, with the list as it now stands", async () => {
  const b = await bench();
  const events = () => b.env.dispatched.filter((event) => event.type === "mefi:panes");
  const before = events().length;
  assert.ok(before >= 1, "attaching announces the layout");
  b.P.open("output");
  const last = events().at(-1);
  assert.equal(events().length, before + 1);
  assert.deepEqual(clean(last.detail.panes.map((pane) => [pane.id, pane.where])), [["activity", "closed"], ["output", "dock"], ["checks", "closed"]]);
  b.P.auto("checks", true);
  assert.equal(events().length, before + 2);
  b.P.auto("checks", true);
  assert.equal(events().length, before + 2, "a wish that changes nothing announces nothing");
});

test("open with focus asks for the pane's first control on the next frame, and closing hands focus back to its toggle", async () => {
  const b = await bench();
  const toggle = b.env.node("button", { parent: b.document.body });
  toggle.setAttribute("data-pane-toggle", "activity");
  b.P.open("activity", { focus: true });
  assert.equal(b.env.frames.length, 1, "focus waits for the pane to be painted");
  b.env.flush();
  assert.ok(b.find("activity").descendants().some((node) => node.focused), "something inside the pane took focus");
  b.P.close("activity", { focus: true });
  assert.equal(toggle.focused, true, "closing returns to the button that opens it");
  b.P.open("activity", { where: "float" });
  assert.equal(b.P.where("activity"), "float", "open can name where");
});

test("a page with no dock or no host still holds together", async () => {
  const noDock = await bench({ layers: false });
  noDock.P.open("activity");
  assert.equal(noDock.P.where("activity"), "closed", "nowhere to show it");
  const noHost = await bench({ host: false });
  noHost.P.open("activity");
  assert.equal(noHost.P.where("activity"), "dock");
  noHost.P.close("activity");
  assert.equal(noHost.P.where("activity"), "closed");
  assert.equal(noHost.find("activity"), null, "with no shelf a closed pane leaves the page");
});
