// The three splitters (renderer/shell.js): rail | list, list | main, main | inspector.
// Each is a separator with aria-valuenow, -min and -max; a drag with pointer capture,
// the arrow keys (8 px, Shift 32, Home, End) and a double-click change a width, and
// only through MefiNav.layout.set; the widths are saved per mode. The 1px line and
// the wide hit area are the stylesheet's (tests/shell_frame_css.test.mjs); the real
// pointer is tests/shell_render.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";

import { loadShell, plain } from "./fixtures/shell-vm.mjs";

const KEY = "mefiStudio.shell.layout.v1";
const asked = (page) => { const last = {}; for (const [name, value] of page.calls.layoutSet) last[name] = value; return last; };
const saved = (page) => JSON.parse(page.store.get(KEY));
const split = (page, name) => page.$(`shell-split-${name}`);
const keyOn = (page, name, key, extra = {}) => { const event = { key, shiftKey: false, preventDefault() { this.prevented = true; }, ...extra }; split(page, name).listeners.keydown[0](event); return event; };
const values = (node) => ["aria-valuenow", "aria-valuemin", "aria-valuemax"].map((name) => Number(node.getAttribute(name)));

test("three separators: the rail's, the list's and the inspector's, each a keyboard stop with its values", () => {
  const page = loadShell({});
  const rail = split(page, "rail"), list = split(page, "list"), inspector = split(page, "inspector");
  for (const node of [rail, list, inspector]) {
    assert.equal(node.getAttribute("role"), "separator");
    assert.equal(node.getAttribute("aria-orientation"), "vertical");
    assert.equal(node.getAttribute("tabindex"), "0", "reachable from the keyboard");
    assert.ok(node.getAttribute("aria-label"));
    assert.ok(node.getAttribute("title"));
  }
  assert.deepEqual(values(list), [280, 220, 420]);
  assert.equal(list.getAttribute("aria-valuetext"), "280 pixels");
  assert.deepEqual(values(inspector), [388, 320, 640]);
  assert.deepEqual(values(rail), [64, 64, 256]);
  assert.equal(rail.getAttribute("aria-valuetext"), "Closed");
  assert.equal(list.dataset.split, "list");
  // What a window allows is the maximum: 1100 - 64 - 280 - 320 = 436 for the inspector.
  const narrow = loadShell({ width: 1100 });
  assert.deepEqual(values(split(narrow, "inspector")), [388, 320, 436]);
  split(narrow, "inspector").listeners.keydown[0]({ key: "End", preventDefault() {} });
  assert.deepEqual(values(split(narrow, "inspector")), [436, 320, 436]);
  // The pinned rail.
  const pinned = loadShell({ pinned: true });
  assert.deepEqual(values(split(pinned, "rail")), [256, 64, 256]);
  assert.equal(split(pinned, "rail").getAttribute("aria-valuetext"), "Kept open");
});

test("a separator is there only while its column is docked", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  assert.deepEqual(["rail", "list", "inspector"].map((name) => split(page, name).hidden), [false, false, false]);
  shell.close("list");
  assert.equal(split(page, "list").hidden, true);
  shell.close("inspector");
  assert.equal(split(page, "inspector").hidden, true);
  shell.setMode("vibe");
  assert.deepEqual(["rail", "list", "inspector"].map((name) => split(page, name).hidden), [true, true, true], "Vibe: no columns, and no rail to widen");
  shell.setMode("build");
  shell.open("list");
  assert.equal(split(page, "list").hidden, false);
  const small = loadShell({ width: 500, height: 400 });
  assert.deepEqual(["list", "inspector"].map((name) => split(small, name).hidden), [true, true], "a drawer has its own width and no splitter");
  small.window.MefiShell.open("list");
  assert.equal(split(small, "list").hidden, true);
  const noRail = loadShell({ railShown: false });
  assert.equal(split(noRail, "rail").hidden, true, "no rail on screen: nothing to drag");
});

test("arrow keys move a column's edge by 8 px, Shift by 32, Home to the narrowest, End to the widest, Enter to the default", () => {
  const page = loadShell({ width: 1920, height: 1080 });
  const shell = page.window.MefiShell;
  let event = keyOn(page, "list", "ArrowRight");
  assert.equal(shell.info("list").width, 288);
  assert.equal(event.prevented, true);
  keyOn(page, "list", "ArrowRight", { shiftKey: true });
  assert.equal(shell.info("list").width, 320);
  keyOn(page, "list", "ArrowLeft");
  assert.equal(shell.info("list").width, 312);
  keyOn(page, "list", "ArrowLeft", { shiftKey: true });
  assert.equal(shell.info("list").width, 280);
  keyOn(page, "list", "Home");
  assert.equal(shell.info("list").width, 220);
  keyOn(page, "list", "ArrowLeft", { shiftKey: true });
  assert.equal(shell.info("list").width, 220, "not below the narrowest");
  keyOn(page, "list", "End");
  assert.equal(shell.info("list").width, 420);
  keyOn(page, "list", "ArrowRight", { shiftKey: true });
  assert.equal(shell.info("list").width, 420, "not above the widest");
  keyOn(page, "list", "Enter");
  assert.equal(shell.info("list").width, 280, "Enter is the default width");
  assert.deepEqual(values(split(page, "list")), [280, 220, 420], "the separator says so");
  // The inspector's edge is on its left: the right arrow makes it narrower.
  keyOn(page, "inspector", "ArrowRight");
  assert.equal(shell.info("inspector").width, 380);
  keyOn(page, "inspector", "ArrowLeft", { shiftKey: true });
  assert.equal(shell.info("inspector").width, 412);
  keyOn(page, "inspector", "Home");
  assert.equal(shell.info("inspector").width, 320);
  keyOn(page, "inspector", "End");
  assert.equal(shell.info("inspector").width, 640);
  keyOn(page, "inspector", "Enter");
  assert.equal(shell.info("inspector").width, 388);
  // Every change went through the contract, and only the column's own region moved.
  assert.ok(page.calls.layoutSet.every(([name]) => ["list", "inspector", "tabs", "status"].includes(name)));
  assert.equal(asked(page).list, 280);
  assert.equal(asked(page).inspector, 388);
  event = keyOn(page, "list", "a");
  assert.equal(event.prevented, undefined, "other keys are left alone");
  assert.equal(page.document.activeElement, split(page, "inspector"), "the splitter keeps focus after a key");
});

test("keys on a separator whose column is not docked do nothing", () => {
  const page = loadShell({});
  page.window.MefiShell.close("list");
  const before = page.calls.layoutSet.length;
  const event = keyOn(page, "list", "ArrowRight");
  assert.equal(page.calls.layoutSet.length, before);
  assert.equal(event.prevented, undefined);
});

test("a drag with pointer capture resizes the column, frame by frame, and saves the width when it ends", async () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  const node = split(page, "list");
  const captured = [], released = [];
  node.setPointerCapture = (id) => captured.push(id);
  node.releasePointerCapture = (id) => released.push(id);
  let prevented = 0;
  await node.trigger("pointerdown", { button: 0, clientX: 344, pointerId: 7, preventDefault: () => { prevented += 1; } });
  assert.deepEqual(captured, [7], "the pointer is captured, so a drag over the page or a webview keeps going");
  assert.equal(prevented, 1, "no text selection");
  assert.equal(node.classList.contains("is-drag"), true);
  assert.equal(page.$("shell-frame").classList.contains("is-dragging"), true, "the cursor and the selection are held for the whole drag");
  await node.trigger("pointermove", { clientX: 364 });
  await node.trigger("pointermove", { clientX: 384 });
  await node.trigger("pointermove", { clientX: 404 });
  assert.equal(page.frames.length, 1, "three moves, one frame of work");
  assert.equal(shell.info("list").width, 280, "nothing until the frame");
  page.frame();
  assert.equal(shell.info("list").width, 340, "the column follows the pointer: 280 + 60");
  assert.equal(asked(page).list, 340);
  assert.equal(page.store.has(KEY), true);
  await node.trigger("pointermove", { clientX: 2000 });
  page.frame();
  assert.equal(shell.info("list").width, 420, "never past the widest");
  await node.trigger("pointerup", { clientX: 2000 });
  assert.deepEqual(released, [7]);
  assert.equal(node.classList.contains("is-drag"), false);
  assert.equal(page.$("shell-frame").classList.contains("is-dragging"), false);
  assert.equal(saved(page).build.list.w, 420, "saved");
  assert.equal(page.document.activeElement, node, "focus stays on the splitter, so the arrow keys continue");
  // Nothing follows the pointer after the drag.
  await node.trigger("pointermove", { clientX: 100 });
  page.frame();
  assert.equal(shell.info("list").width, 420);
});

test("a drag that ends before its last frame has been drawn still lands where the pointer let go", async () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  const node = split(page, "list");
  await node.trigger("pointerdown", { button: 0, clientX: 344, pointerId: 3 });
  await node.trigger("pointermove", { clientX: 384 });
  assert.equal(page.frames.length, 1, "the move is waiting for its frame");
  await node.trigger("pointerup", { clientX: 384 });
  assert.equal(shell.info("list").width, 320, "the release applies it: 280 + 40");
  assert.equal(saved(page).build.list.w, 320, "and saves it");
  assert.equal(page.frames.length, 0, "the frame that was waiting is cancelled, not run against a drag that is over");
});

test("the inspector's edge moves the other way, a press of another button does nothing, and a cancelled drag ends once", async () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  const node = split(page, "inspector");
  await node.trigger("pointerdown", { button: 2, clientX: 1000, pointerId: 1 });
  assert.equal(node.classList.contains("is-drag"), false, "a right button is not a drag");
  await node.trigger("pointerdown", { button: 0, clientX: 1000, pointerId: 2 });
  await node.trigger("pointermove", { clientX: 960 });
  page.frame();
  assert.equal(shell.info("inspector").width, 428, "dragging left widens the inspector");
  await node.trigger("pointermove", { clientX: 1100 });
  page.frame();
  assert.equal(shell.info("inspector").width, 320, "and right narrows it, to its minimum");
  await node.trigger("pointercancel", {});
  await node.trigger("lostpointercapture", {});
  assert.equal(node.classList.contains("is-drag"), false);
  assert.equal(page.$("shell-frame").classList.contains("is-dragging"), false);
  assert.equal(saved(page).build.inspector.w, 320);
  // A move that never started a drag is nobody's.
  await node.trigger("pointermove", { clientX: 10 });
  page.frame();
  assert.equal(shell.info("inspector").width, 320);
});

test("a click that does not move leaves the width alone and saves nothing", async () => {
  const page = loadShell({});
  const node = split(page, "list");
  page.writes.length = 0;
  await node.trigger("pointerdown", { button: 0, clientX: 344, pointerId: 1 });
  await node.trigger("pointerup", { clientX: 344 });
  assert.deepEqual(page.writes, [], "a press and a release is not a resize");
  assert.equal(page.window.MefiShell.info("list").width, 280);
});

test("a click that wobbles a pixel or two is still a click: nothing follows the pointer until it has really moved", async () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  const node = split(page, "list");
  page.writes.length = 0;
  await node.trigger("pointerdown", { button: 0, clientX: 344, pointerId: 1 });
  await node.trigger("pointermove", { clientX: 346 });
  assert.equal(page.frames.length, 0, "2 px is a wobble: no frame of work");
  await node.trigger("pointerup", { clientX: 346 });
  assert.equal(shell.info("list").width, 280);
  assert.deepEqual(page.writes, [], "and nothing is saved");
  await node.trigger("pointerdown", { button: 0, clientX: 344, pointerId: 2 });
  await node.trigger("pointermove", { clientX: 348 });
  assert.equal(page.frames.length, 1, "4 px is a drag");
  await node.trigger("pointermove", { clientX: 345 });
  await node.trigger("pointerup", { clientX: 345 });
  assert.equal(shell.info("list").width, 281, "and once it is one, it follows the pointer back to where it is let go");
});

test("a double-click puts a column back to its default width, in its own mode", async () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  shell.resize("list", 400);
  shell.resize("inspector", 600);
  await split(page, "list").trigger("dblclick", {});
  assert.equal(shell.info("list").width, 280);
  await split(page, "inspector").trigger("dblclick", {});
  assert.equal(shell.info("inspector").width, 388);
  shell.setMode("vibe");
  shell.open("list");
  shell.resize("list", 350);
  await split(page, "list").trigger("dblclick", {});
  assert.equal(shell.info("list").width, 280);
  assert.equal(saved(page).vibe.list.w, 280);
  assert.equal(saved(page).build.list.w, 280);
});

test("the rail's edge is the rail's own pin: it toggles the menu between 64 and 256 and nothing else", async () => {
  const page = loadShell({});
  const pin = page.get("app-rail-pin");
  let pins = 0;
  pin.click = () => { pins += 1; page.root.dataset.railPinned = page.root.dataset.railPinned === undefined ? "" : undefined; if (page.root.dataset.railPinned === undefined) delete page.root.dataset.railPinned; };
  const rail = split(page, "rail");
  assert.equal(rail.getAttribute("title"), "Drag or double-click to keep open the menu");
  keyOn(page, "rail", "ArrowLeft");
  assert.equal(pins, 0, "it is already closed");
  keyOn(page, "rail", "ArrowRight");
  assert.equal(pins, 1, "the right arrow opens it, through the rail's own button");
  assert.equal(rail.getAttribute("aria-valuenow"), "256");
  keyOn(page, "rail", "End");
  assert.equal(pins, 1, "already open");
  keyOn(page, "rail", "Home");
  assert.equal(pins, 2);
  assert.equal(rail.getAttribute("aria-valuenow"), "64");
  keyOn(page, "rail", "Enter");
  assert.equal(pins, 3);
  keyOn(page, "rail", " ");
  assert.equal(pins, 4);
  await rail.trigger("dblclick", {});
  assert.equal(pins, 5);
  // A drag: a few pixels is a slip, a clear pull toward the open state opens it.
  await rail.trigger("pointerdown", { button: 0, clientX: 64, pointerId: 1 });
  await rail.trigger("pointermove", { clientX: 68 });
  await rail.trigger("pointerup", {});
  assert.equal(pins, 5, "4 px is not a pull");
  const closed = page.root.dataset.railPinned === undefined;
  await rail.trigger("pointerdown", { button: 0, clientX: 64, pointerId: 1 });
  await rail.trigger("pointermove", { clientX: 150 });
  await rail.trigger("pointerup", {});
  assert.equal(pins, closed ? 6 : 5, "a pull toward open opens a closed rail and leaves an open one");
  assert.deepEqual(page.calls.layoutSet.filter(([name]) => name === "rail"), [], "the rail is not a region: the frame never asks the contract for it");
  assert.ok(!("--shell-rail-w" in page.props), "and never writes its width");
  // Without the rail's button, the contract's own pin is used.
  const bare = loadShell({});
  bare.get("app-rail-pin").remove();
  bare.get("app-rail-pin").click = undefined;
  keyOn(bare, "rail", "ArrowRight");
  assert.deepEqual(bare.calls.pin, [true]);
});

test("widths are saved per mode as they change, and a launch reapplies them before anything is painted", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  keyOn(page, "list", "ArrowRight", { shiftKey: true });
  keyOn(page, "inspector", "ArrowLeft", { shiftKey: true });
  assert.deepEqual([saved(page).build.list.w, saved(page).build.inspector.w], [312, 420]);
  shell.setMode("vibe");
  shell.open("list");
  keyOn(page, "list", "End");
  assert.equal(saved(page).vibe.list.w, 420);
  const next = loadShell({ stored: { [KEY]: page.store.get(KEY) } });
  assert.deepEqual(plain(next.calls.layoutSet.slice(0, 2)), [["list", 312], ["inspector", 420]], "the first things asked of the contract are the saved widths");
  assert.deepEqual([next.window.MefiShell.info("list").width, next.window.MefiShell.info("inspector").width], [312, 420]);
  // Reapplied when the window changes: the saved 420 of the inspector shrinks with the window (64 + 312 + 320 of main
  // leaves 354 at 1050 px) and comes back; what was saved is not touched.
  next.resize({ innerWidth: 1050 });
  assert.equal(next.window.MefiShell.info("inspector").size, 354);
  assert.equal(next.window.MefiShell.info("inspector").width, 420);
  next.resize({ innerWidth: 1440 });
  assert.equal(next.window.MefiShell.info("inspector").size, 420);
  assert.equal(saved(next).build?.inspector?.w ?? 420, 420);
});
