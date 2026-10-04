// The frame's state machine (renderer/shell.js): which regions there are and
// how they come and go, what each mode starts with and remembers, what is asked
// of the layout contract and when, the limits, the drawers of a small window and
// the keys. The contract itself is a stand-in here (tests/fixtures/shell-vm.mjs),
// so what is pinned is what the frame ASKS; one test at the end runs it against
// the real renderer/nav.js. Real geometry is tests/shell_render.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";

import { loadShell, plain } from "./fixtures/shell-vm.mjs";

const KEY = "mefiStudio.shell.layout.v1";
const asked = (page) => { const last = {}; for (const [name, value] of page.calls.layoutSet) last[name] = value; return last; };
const saved = (page) => JSON.parse(page.store.get(KEY));

test("v2 on: the frame is built once, right behind the rail, and every region is reported to the contract", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  assert.equal(shell.active(), true);
  assert.equal(page.root.dataset.frame, "on");
  assert.deepEqual(page.document.body.children.map((node) => node.id), ["app-rail", "shell-frame", "app-local-nav"], "the chrome comes before the page in the tab order");
  const frame = page.$("shell-frame");
  assert.deepEqual(frame.children.map((node) => node.id), ["shell-scrim", "shell-list", "shell-top", "shell-tabs", "shell-main", "shell-inspector", "shell-status", "shell-split-rail", "shell-split-list", "shell-split-inspector"]);
  for (const name of ["top", "tabs", "list", "inspector", "status", "main"]) assert.equal(shell.region(name)?.id, `shell-${name}`, `region("${name}")`);
  assert.equal(shell.region("nothing"), null);
  assert.deepEqual(plain(shell.REGIONS), ["top", "tabs", "list", "inspector", "status", "main"]);
  // Build's preset: the list and the inspector open; nothing asks for a strip until the tabs module says how tall it is.
  assert.deepEqual(asked(page), { list: 280, inspector: 388, tabs: 0, status: 28 });
  assert.deepEqual(plain(page.nav.layout.get()), { list: 280, inspector: 388, tabs: 0, status: 28 });
  assert.equal(page.document.querySelectorAll("#shell-frame").length, 1);
});

test("enable is idempotent, disable takes everything away and asks the contract for nothing, and enable builds it again", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  const frame = page.$("shell-frame");
  const before = page.calls.layoutSet.length;
  assert.equal(shell.enable(), true);
  assert.equal(page.$("shell-frame"), frame, "the same frame");
  assert.equal(page.document.querySelectorAll("#shell-frame").length, 1);
  assert.equal(page.calls.layoutSet.length, before, "nothing is asked twice");
  assert.equal(shell.disable(), true);
  assert.equal(shell.active(), false);
  assert.equal(page.$("shell-frame"), null, "the frame is gone");
  assert.equal(shell.region("list"), null);
  assert.equal(page.root.dataset.frame, undefined);
  assert.equal(page.root.dataset.layout, undefined, "the layout attribute is the contract's, not the frame's");
  assert.equal(page.props["--frame-top-l"], undefined, "no inline variable is left behind");
  assert.deepEqual(asked(page), { list: 0, inspector: 0, tabs: 0, status: 0 }, "every region given back");
  assert.equal(shell.disable(), false, "a second disable is a no-op");
  assert.equal(shell.enable(), true);
  assert.equal(page.document.querySelectorAll("#shell-frame").length, 1);
  assert.deepEqual(asked(page), { list: 280, inspector: 388, tabs: 0, status: 28 }, "asked for again");
});

test("a frame left by an older copy of the module is replaced, not doubled", () => {
  const page = loadShell({ run: false });
  const stale = page.document.createElement("div");
  stale.id = "shell-frame";
  page.document.body.append(stale);
  page.load();
  assert.equal(page.document.querySelectorAll("#shell-frame").length, 1);
  assert.notEqual(page.$("shell-frame"), stale);
});

test("with v2 off the frame is never built, and asks, listens to and stores nothing", () => {
  for (const options of [{ layout: false }, { layout: true, shell: "" }]) {
    const page = loadShell({ ...options, observers: true });
    const shell = page.window.MefiShell;
    assert.equal(shell.active(), false, JSON.stringify(options));
    assert.equal(shell.enable(), false, "enable() refuses while there is no v2 or no rail");
    assert.equal(page.$("shell-frame"), null);
    assert.equal(page.root.dataset.frame, undefined);
    assert.deepEqual(page.calls.layoutSet, [], "the contract is not asked");
    assert.deepEqual(page.added, [], "no window listener");
    assert.deepEqual(page.observers, [], "no observer");
    assert.deepEqual(page.reads.filter((key) => key === KEY), [], "the layout preference is not read");
    assert.deepEqual(page.writes, [], "nothing is stored");
    assert.deepEqual(page.timers, [], "no timer");
    assert.deepEqual(page.props, {}, "no inline variable");
    assert.equal(shell.region("top"), null);
    assert.equal(shell.status(), null);
    assert.equal(shell.size("list"), 0);
  }
});

test("a panel mounted before the frame exists is drawn when it does, and its factory runs then, once", () => {
  const page = loadShell({ layout: false });
  const shell = page.window.MefiShell;
  let made = 0;
  const handle = shell.mount("list", "sessions", () => { made += 1; const node = page.document.createElement("div"); node.id = "mounted-sessions"; return node; }, { title: "Sessions" });
  assert.equal(made, 0, "nothing is built for a layout that is off");
  assert.equal(page.$("mounted-sessions"), null);
  page.nav.layout.on = () => true;
  page.root.dataset.layout = "v2";
  assert.equal(shell.enable(), true);
  assert.equal(made, 1);
  assert.equal(page.$("mounted-sessions")?.parentNode?.parentNode?.parentNode?.id, "shell-list", "inside the list column");
  assert.equal(handle.element.id, "mounted-sessions");
  shell.disable();
  shell.enable();
  assert.equal(made, 1, "the content is kept, not made again");
  assert.equal(page.$("mounted-sessions")?.parentNode?.parentNode?.parentNode?.id, "shell-list");
});

test("DOMContentLoaded starts the module when the page is still loading, once", () => {
  const page = loadShell({ readyState: "loading" });
  assert.equal(page.window.MefiShell.active(), false, "nothing before the page is there");
  page.dispatchReady();
  assert.equal(page.window.MefiShell.active(), true);
  page.dispatchReady();
  assert.equal(page.document.querySelectorAll("#shell-frame").length, 1, "starting twice builds once");
});

test("the regions follow v2 off, the shell's loss and its return", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  page.root.dataset.shell = "";
  delete page.root.dataset.shell;
  page.window.dispatchEvent({ type: "mefi:shell" });
  assert.equal(shell.active(), false, "classic has no room for regions");
  assert.equal(page.$("shell-frame"), null);
  page.root.dataset.shell = "rail";
  page.window.dispatchEvent({ type: "mefi:shell" });
  assert.equal(shell.active(), true, "the rail's return builds them again");
  page.window.dispatchEvent({ type: "mefi:layout", detail: { on: false } });
  assert.equal(shell.active(), false, "v2 going off removes them");
  page.nav.layout.on = () => true;
  page.window.dispatchEvent({ type: "mefi:shell" });
  assert.equal(shell.active(), false, "and they stay gone: a live layout switch reloads");
  assert.equal(shell.enable(), true, "unless something asks for them");
});

test("the presets: Build opens the list and the inspector, Vibe closes both, and both keep the tab strip", () => {
  const build = loadShell({});
  assert.deepEqual(plain(build.window.MefiShell.PRESETS), { build: { list: { open: true, w: 280 }, inspector: { open: true, w: 388 }, tabs: { open: true } }, vibe: { list: { open: false, w: 280 }, inspector: { open: false, w: 388 }, tabs: { open: true } } });
  assert.equal(build.window.MefiShell.isOpen("list"), true);
  assert.equal(build.window.MefiShell.isOpen("inspector"), true);
  assert.equal(build.region("list").hidden, false);
  assert.equal(build.region("inspector").hidden, false);
  const vibe = loadShell({ mode: "vibe" });
  assert.deepEqual(asked(vibe), { list: 0, inspector: 0, tabs: 0, status: 28 });
  assert.equal(vibe.window.MefiShell.isOpen("list"), false);
  assert.equal(vibe.region("list").hidden, true);
  assert.equal(vibe.region("inspector").hidden, true);
  assert.equal(vibe.window.MefiShell.isOpen("tabs"), true, "the strip is on in both modes");
  assert.deepEqual(plain(build.window.MefiShell.DEFAULTS), { list: 280, inspector: 388, status: 28 });
  assert.deepEqual(plain(build.window.MefiShell.LIMITS), { list: [220, 420], inspector: [320, 640] });
});

test("switching mode restores each mode's own layout in the same turn, with no timer to wait for", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  shell.resize("list", 320);
  shell.resize("inspector", 500);
  page.calls.layoutSet.length = 0;
  page.timers.length = 0;
  assert.equal(shell.setMode("vibe"), "vibe");
  assert.deepEqual(page.timers, [], "nothing is left for a later turn: no flash");
  assert.deepEqual(page.calls.layoutSet, [["list", 0], ["inspector", 0]], "Vibe's closed columns are given back at once, and nothing else moves");
  assert.equal(page.region("list").hidden, true);
  assert.equal(page.region("inspector").hidden, true);
  page.calls.layoutSet.length = 0;
  shell.setMode("build");
  assert.deepEqual(page.calls.layoutSet, [["list", 320], ["inspector", 500]], "Build comes back as it was left");
  assert.equal(page.region("list").hidden, false);
  assert.deepEqual(page.timers, []);
});

test("each mode remembers its own widths and open state, and they are saved per mode", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  shell.resize("list", 300);
  shell.setMode("vibe");
  assert.equal(shell.open("list"), true, "Vibe opens its list");
  assert.equal(shell.info("list").width, 280, "at Vibe's own width, not Build's");
  shell.resize("list", 360);
  shell.setMode("build");
  assert.equal(shell.info("list").width, 300, "Build kept its own");
  shell.close("inspector");
  shell.setMode("vibe");
  assert.equal(shell.isOpen("inspector"), false);
  shell.setMode("build");
  assert.equal(shell.isOpen("inspector"), false, "Build's closed inspector stays closed");
  assert.deepEqual(saved(page), { v: 1, build: { list: { open: true, w: 300 }, inspector: { open: false, w: 388 }, tabs: { open: true } }, vibe: { list: { open: true, w: 360 }, inspector: { open: false, w: 388 }, tabs: { open: true } } });
  assert.deepEqual({ v: 1, ...plain(shell.layout()) }, saved(page), "layout() says what is saved");
  // A new launch reapplies it, in each mode.
  const again = loadShell({ stored: { [KEY]: page.store.get(KEY) } });
  assert.deepEqual(asked(again), { list: 300, inspector: 0, tabs: 0, status: 28 });
  again.window.MefiShell.setMode("vibe");
  assert.deepEqual(asked(again), { list: 360, inspector: 0, tabs: 0, status: 28 });
});

test("the saved layout survives a blocked store, garbage, and out-of-range numbers", () => {
  const blocked = loadShell({ storage: "throws" });
  const shell = blocked.window.MefiShell;
  assert.equal(shell.active(), true, "a store that throws does not stop the frame");
  assert.deepEqual(asked(blocked), { list: 280, inspector: 388, tabs: 0, status: 28 }, "the presets");
  assert.doesNotThrow(() => { shell.resize("list", 300); shell.close("inspector"); shell.setMode("vibe"); shell.resetLayout({ quiet: true }); });
  for (const raw of ["not json", "null", "[]", "42", '{"v":1}', '{"build":"wide"}', '{"build":{"list":7}}']) {
    const page = loadShell({ stored: { [KEY]: raw } });
    assert.deepEqual(asked(page), { list: 280, inspector: 388, tabs: 0, status: 28 }, `${raw}: the presets`);
  }
  const odd = loadShell({ stored: { [KEY]: JSON.stringify({ v: 1, build: { list: { open: true, w: 9999 }, inspector: { open: "yes", w: 12 }, tabs: { open: "no" } }, vibe: { list: { open: true, w: -5 } } }) } });
  assert.deepEqual(asked(odd), { list: 420, inspector: 320, tabs: 0, status: 28 }, "9999 is the widest list, 12 the narrowest inspector, and a non-boolean open is the preset's");
  assert.equal(odd.window.MefiShell.isOpen("tabs"), true, "a non-boolean tab strip flag is the preset's");
  odd.window.MefiShell.setMode("vibe");
  assert.equal(odd.window.MefiShell.info("list").width, 220, "a negative width is the narrowest list");
});

test("widths are clamped to the splitter limits before the contract is asked, and the main area keeps its 320", () => {
  const page = loadShell({ width: 1920, height: 1080 });
  const shell = page.window.MefiShell;
  const cases = [["list", 100, 220], ["list", 9999, 420], ["list", 333.4, 333], ["inspector", 100, 320], ["inspector", 9999, 640], ["inspector", 500.6, 501]];
  for (const [name, wanted, got] of cases) {
    shell.resize(name, wanted);
    assert.equal(asked(page)[name], got, `${name} ${wanted}`);
    assert.equal(shell.info(name).width, got);
  }
  shell.resize("list", Number.NaN);
  shell.resize("list", "wide");
  assert.equal(asked(page).list, 333, "what is not a number changes nothing");
  // 1100 wide, rail 64, list 280: 1100 - 64 - 280 - 320 = 436 is all the inspector can have.
  const narrow = loadShell({ width: 1100 });
  narrow.window.MefiShell.resize("inspector", 640);
  assert.equal(asked(narrow).inspector, 436);
  assert.equal(narrow.window.MefiShell.info("inspector").max, 436);
  narrow.window.MefiShell.resize("list", 420);
  assert.equal(asked(narrow).list, 420, "the list takes what it is given");
  assert.equal(narrow.window.MefiShell.info("inspector").drawer, true, "and the inspector, left with 296, is a drawer: the main area keeps 320");
  assert.equal(asked(narrow).inspector, 0);
  // The window says how much main area there is to protect.
  const wide = loadShell({ width: 1100 });
  wide.nav.layout.MAIN_MIN = 500;
  wide.window.MefiShell.sync();
  assert.equal(wide.window.MefiShell.info("inspector").drawer, true, "the contract's MAIN_MIN is the one used");
});

test("plan(): what docks and what becomes a drawer, from the window, the rail and what a mode asks for", () => {
  const { plan } = loadShell({}).window.MefiShell;
  const prefs = { list: { open: true, w: 280 }, inspector: { open: true, w: 388 } };
  const docked = (width, rail, extra = {}) => plain(plan({ width, rail, prefs: { ...prefs, ...extra.prefs }, fold: extra.fold ?? [], mainMin: 320 }));
  let got = docked(1440, 64);
  assert.deepEqual([got.list.docked, got.list.width, got.inspector.docked, got.inspector.width], [true, 280, true, 388]);
  // 64 + 280 + 320 + 320 = 984: the last width at which the inspector docks.
  assert.equal(docked(984, 64).inspector.docked, true);
  assert.equal(docked(984, 64).inspector.width, 320, "with exactly its own minimum");
  assert.equal(docked(983, 64).inspector.docked, false);
  assert.equal(docked(983, 64).inspector.drawer, true, "narrower than that it is a drawer, not a sliver");
  assert.equal(docked(1100, 256).inspector.drawer, true, "a pinned rail squeezes it out around 1100");
  assert.equal(docked(1200, 256).inspector.docked, true);
  // The list: what is left after the rail and the main area's 320.
  assert.equal(docked(700, 64).list.max, 316);
  assert.equal(docked(700, 64).list.width, 280);
  assert.equal(docked(500, 64).list.width, 220, "never narrower than its own minimum");
  // Folded: both are drawers, whatever was asked, and take no room.
  got = docked(800, 64, { fold: ["list", "inspector"] });
  assert.deepEqual([got.list.drawer, got.list.docked, got.list.width, got.inspector.drawer, got.inspector.docked, got.inspector.width], [true, false, 0, true, false, 0]);
  got = docked(1440, 64, { fold: ["inspector"] });
  assert.deepEqual([got.list.docked, got.inspector.drawer], [true, true], "the contract may fold one of them");
  // Closed in the mode: not docked, and its width is 0.
  got = docked(1440, 64, { prefs: { list: { open: false, w: 280 } } });
  assert.deepEqual([got.list.docked, got.list.drawer, got.list.width], [false, false, 0]);
  // With no list the inspector has the room the list would have had.
  got = docked(1000, 64, { prefs: { list: { open: false, w: 280 } } });
  assert.deepEqual([got.inspector.docked, got.inspector.max], [true, 616]);
});

test("a sticky request: only a change is asked, and a folded region is left to the contract", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  page.calls.layoutSet.length = 0;
  shell.sync();
  page.resize({ innerWidth: 1439 });
  page.resize({ innerWidth: 1440 });
  assert.deepEqual(page.calls.layoutSet, [], "a resize that changes nothing asks nothing");
  // 1000 wide: 64 + 280 + 320 leaves 336 for an inspector that was 388. It shrinks; what was saved does not.
  page.resize({ innerWidth: 1000, innerHeight: 720 });
  assert.deepEqual(page.calls.layoutSet, [["inspector", 336]], "the inspector gives back what the main area needs");
  assert.equal(shell.layout().build.inspector.w, 388, "and keeps its saved width for a wider window");
  page.resize({ innerWidth: 1001 });
  assert.deepEqual(page.calls.layoutSet, [["inspector", 336], ["inspector", 337]], "it follows the window a pixel at a time");
  page.calls.layoutSet.length = 0;
  page.resize({ innerWidth: 980 });
  assert.deepEqual(page.calls.layoutSet, [["inspector", 0]], "too narrow to dock: the room goes back, once");
  page.resize({ innerWidth: 981 });
  assert.deepEqual(page.calls.layoutSet, [["inspector", 0]], "and is not asked for again");
  page.calls.layoutSet.length = 0;
  page.resize({ innerWidth: 1440 });
  assert.deepEqual(page.calls.layoutSet, [["inspector", 388]], "it comes back with the window");
  page.calls.layoutSet.length = 0;
  page.resize({ innerWidth: 800, innerHeight: 600 });
  assert.deepEqual(page.calls.layoutSet, [], "below 900 the contract folds the columns: the frame asks nothing of them");
  assert.equal(page.window.MefiShell.info("list").drawer, true);
  page.resize({ innerWidth: 1440, innerHeight: 900 });
  assert.deepEqual(page.calls.layoutSet, [], "and what it asked before is still there when the window comes back");
});

test("the tab strip's height is the tabs module's to say, and its switch is the frame's", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  assert.equal(page.region("tabs").hidden, true, "no strip before something draws one");
  assert.equal(shell.resize("tabs", 36), 36);
  assert.equal(asked(page).tabs, 36);
  assert.equal(page.region("tabs").hidden, false);
  assert.equal(shell.resize("tabs", 500), 48, "no taller than the contract allows");
  assert.equal(asked(page).tabs, 48);
  assert.equal(shell.resize("tabs", -3), 0);
  assert.equal(page.region("tabs").hidden, true);
  shell.resize("tabs", 36);
  assert.equal(shell.close("tabs"), false);
  assert.equal(asked(page).tabs, 0, "closed in the menu: the row is given back");
  assert.equal(saved(page).build.tabs.open, false);
  assert.equal(shell.open("tabs"), true);
  assert.equal(asked(page).tabs, 36, "and the tabs module's height is asked for again");
  shell.setMode("vibe");
  assert.equal(shell.isOpen("tabs"), true, "each mode has its own switch");
  assert.equal(asked(page).tabs, 36);
  // The status bar's height, too.
  assert.equal(shell.resize("status", 100), 40);
  assert.equal(shell.resize("status", 28), 28);
});

test("size() is the room a region takes from the window, in the contract's own words", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  assert.equal(shell.size("list"), 280);
  assert.equal(shell.size("inspector"), 388);
  assert.equal(shell.size("status"), 28);
  assert.equal(shell.size("tabs"), 0);
  assert.equal(shell.size("nope"), 0);
  shell.close("list");
  assert.equal(shell.size("list"), 0);
  page.resize({ innerWidth: 500, innerHeight: 500 });
  assert.equal(shell.size("inspector"), 0, "a column the window folds takes none");
  assert.equal(shell.info("nothing"), null);
});

test("Reset layout puts this mode's preset back, leaves the other mode alone, and offers Undo", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  shell.resize("list", 400);
  shell.close("inspector");
  shell.setMode("vibe");
  shell.open("list");
  shell.resize("list", 240);
  shell.setMode("build");
  page.toasts.length = 0;
  assert.equal(shell.resetLayout(), true);
  assert.deepEqual(plain(shell.layout().build), plain(shell.PRESETS.build));
  assert.equal(shell.layout().vibe.list.w, 240, "Vibe keeps what it had");
  assert.equal(shell.layout().vibe.list.open, true);
  assert.equal(page.toasts.length, 1);
  const [words, kind, options] = page.toasts[0];
  assert.match(words, /Layout reset for Build: list 280 px, inspector 388 px/);
  assert.equal(kind, "info");
  assert.equal(options.action.label, "Undo");
  options.action.run();
  assert.equal(shell.layout().build.list.w, 400, "Undo brings back what there was");
  assert.equal(shell.layout().build.inspector.open, false);
  assert.equal(asked(page).list, 400);
  assert.equal(saved(page).build.list.w, 400, "and saves it");
  // Undo after a mode change does nothing to the wrong mode.
  shell.resetLayout();
  const undo = page.toasts.at(-1)[2].action.run;
  shell.setMode("vibe");
  undo();
  assert.deepEqual(plain(shell.layout().build), plain(shell.PRESETS.build), "the other mode's layout is not touched");
  shell.setMode("build");
  assert.equal(shell.resetLayout({ quiet: true }), true);
  assert.equal(page.toasts.length, 2, "quiet says nothing");
});

test("events: the window hears every change of layout, and onChange hears panels too", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  const heard = [], seen = [];
  const off = shell.onChange((detail) => { heard.push(detail.what); if (detail.what === "panel") throw new Error("a listener that fails stops nobody"); });
  shell.onChange((detail) => seen.push(detail.what));
  page.events.length = 0;
  shell.close("list");
  shell.open("list");
  shell.resize("inspector", 400);
  shell.setMode("vibe");
  shell.mount("list", "x", page.document.createElement("div"));
  const types = page.events.filter((event) => event.type === "mefi:shell-layout").map((event) => event.detail.what);
  assert.deepEqual(types, ["close", "open", "resize", "mode"], "a panel is not a change of layout");
  assert.deepEqual(heard, ["close", "open", "resize", "mode", "panel"]);
  assert.deepEqual(seen, heard, "one failing listener does not stop the next");
  const last = page.events.filter((event) => event.type === "mefi:shell-layout").at(-1).detail;
  assert.equal(last.mode, "vibe");
  off();
  shell.setMode("build");
  assert.equal(heard.length, 5, "an unsubscribed listener hears no more");
  assert.equal(typeof shell.onChange("not a function"), "function", "a bad listener is refused quietly");
  shell.disable();
  assert.equal(page.events.at(-1).detail.what, "disable");
  shell.enable();
  assert.equal(page.events.at(-1).detail.what, "enable");
});

test("keys: Ctrl M switches the mode, Ctrl B the list, [ the inspector, and none of them act where they should not", () => {
  const page = loadShell({});
  const shell = page.window.MefiShell;
  const input = page.document.createElement("input");
  page.document.body.append(input);
  let event = page.key({ key: "m", code: "KeyM", ctrlKey: true });
  assert.deepEqual(page.calls.vibe.at(-1), ["vibe", { go: true }], "Ctrl M goes through MefiVibe's own setter, from Home to Home");
  assert.equal(event.defaultPrevented, true);
  assert.equal(shell.mode(), "vibe");
  page.key({ key: "m", code: "KeyM", metaKey: true });
  assert.deepEqual(page.calls.vibe.at(-1), ["build", { go: true }], "Cmd M too, and again it goes back");
  const count = page.calls.vibe.length;
  page.key({ key: "m", code: "KeyM", ctrlKey: true, shiftKey: true });
  page.key({ key: "m", code: "KeyM", ctrlKey: true, altKey: true });
  page.key({ key: "m", code: "KeyM" });
  page.key({ key: "m", code: "KeyM", ctrlKey: true, defaultPrevented: true });
  page.key({ key: "m", code: "KeyM", ctrlKey: true, isComposing: true });
  assert.equal(page.calls.vibe.length, count, "no other chord, nothing already handled, nothing mid-composition");
  page.key({ key: "b", code: "KeyB", ctrlKey: true });
  assert.equal(shell.isOpen("list"), false, "Ctrl B hides the list");
  page.key({ key: "b", code: "KeyB", ctrlKey: true });
  assert.equal(shell.isOpen("list"), true);
  page.key({ key: "[", code: "BracketLeft" });
  assert.equal(shell.isOpen("inspector"), false, "[ hides the inspector");
  page.key({ key: "[", code: "BracketLeft" });
  assert.equal(shell.isOpen("inspector"), true);
  page.key({ key: "[", code: "BracketLeft", target: input });
  assert.equal(shell.isOpen("inspector"), true, "a bracket typed in a field is text");
  page.key({ key: "[", code: "BracketLeft", ctrlKey: true });
  assert.equal(shell.isOpen("inspector"), true, "and [ with a modifier is someone else's");
  page.nav.state.transient = true;
  page.key({ key: "[", code: "BracketLeft" });
  assert.equal(shell.isOpen("inspector"), true, "over a sheet or the palette a bracket is left alone");
  page.nav.state.transient = false;
  // Off, the keys do nothing at all.
  shell.disable();
  const again = page.calls.vibe.length;
  event = page.key({ key: "m", code: "KeyM", ctrlKey: true });
  assert.equal(page.calls.vibe.length, again);
  assert.equal(event.defaultPrevented, false, "the key is not taken when the frame is not there");
});

test("Ctrl M away from Home keeps the page: the mode changes, the page stays", () => {
  const page = loadShell({ current: "tasks" });
  page.key({ key: "m", code: "KeyM", ctrlKey: true });
  assert.deepEqual(page.calls.vibe.at(-1), ["vibe", { go: false }]);
  page.current = "vibe";
  page.key({ key: "m", code: "KeyM", ctrlKey: true });
  assert.deepEqual(page.calls.vibe.at(-1), ["build", { go: true }], "Vibe's own Home counts as Home");
  page.current = "workspace";
  page.key({ key: "m", code: "KeyM", ctrlKey: true });
  assert.deepEqual(page.calls.vibe.at(-1), ["vibe", { go: true }]);
  assert.equal(page.root.dataset.uiMode, "vibe");
});

test("the keys are listed in the shortcut sheet, for display only, while the frame is on", () => {
  const page = loadShell({});
  const rows = page.calls.registered.filter((row) => row.id.startsWith("shell-key-"));
  assert.deepEqual(rows.map((row) => [row.id, row.key]), [["shell-key-mode", "Ctrl M"], ["shell-key-list", "Ctrl B"], ["shell-key-inspector", "["]]);
  for (const row of rows) {
    assert.equal(row.group, "command", "the shortcut handler skips this group: the frame's own listener acts");
    assert.deepEqual(plain(row.showIn), { tabs: false, tools: false, dock: false, palette: false, help: true, footer: false });
    assert.equal(row.hidden(), false);
  }
  page.window.MefiShell.disable();
  assert.equal(rows[0].hidden(), true, "hidden from the sheet with the frame");
  const v1 = loadShell({ layout: false });
  assert.deepEqual(v1.calls.registered.filter((row) => row.id.startsWith("shell-key-")), [], "nothing is listed in v1");
});

test("a drawer puts focus on the first control that can take it, not on one inside a panel that is hidden", () => {
  const page = loadShell({ width: 400, height: 373 });
  const shell = page.window.MefiShell;
  const inspector = page.region("inspector");
  const withButton = (id) => { const node = page.document.createElement("div"); const button = page.document.createElement("button"); button.id = id; node.append(button); return { node, button }; };
  // A mounted panel that is hidden (the session inspector while no session is open) keeps its controls in the page, and focus() on
  // one of them does nothing: a drawer must not open with focus left on the button that opened it.
  const asleep = withButton("asleep-button"), awake = withButton("awake-button");
  const first = shell.mount("inspector", "asleep", asleep.node, { title: "Asleep", order: 10 });
  shell.mount("inspector", "awake", awake.node, { title: "Awake", order: 20 });
  first.hide();
  // The fake DOM cannot read the selector (":not([disabled])" is an attribute test to it), so the region answers the way a browser does:
  // every control in it, in order, whether or not it is on screen.
  inspector.querySelectorAll = () => [asleep.button, awake.button];
  const toggle = page.$("shell-inspector-toggle");
  toggle.focus();
  shell.open("inspector");
  assert.equal(page.document.activeElement, awake.button, "focus goes to the control that is on screen");
  shell.close("inspector");
  assert.equal(page.document.activeElement, toggle, "and back to the button afterwards");
  // The panel that was put away, shown again, is first in line again.
  first.show();
  shell.open("inspector");
  assert.equal(page.document.activeElement, asleep.button, "once shown, its control is the first");
  shell.close("inspector");
  // Nothing on screen that can take focus: the region itself does.
  first.hide();
  page.document.getElementById("awake-button").hidden = true;
  toggle.focus();
  shell.open("inspector");
  assert.equal(page.document.activeElement, inspector, "the drawer takes focus itself when none of its controls can");
});

test("drawers: in a window the contract folds, a column is a drawer the bar's buttons open over the page", () => {
  const page = loadShell({ width: 400, height: 373 });
  const shell = page.window.MefiShell;
  const list = page.region("list"), inspector = page.region("inspector"), frame = page.$("shell-frame");
  assert.equal(list.dataset.state, "closed");
  assert.equal(list.hidden, true);
  assert.equal(shell.info("list").drawer, true);
  assert.equal(shell.isOpen("list"), false, "a drawer is shut until it is opened");
  assert.deepEqual(page.calls.layoutSet.filter(([name]) => name === "list" || name === "inspector"), [], "a drawer takes no room: nothing is asked");
  const toggle = page.$("shell-list-toggle"), other = page.$("shell-inspector-toggle");
  assert.equal(page.$("shell-scrim").hidden, true, "no scrim until a drawer is open");
  toggle.focus();
  assert.equal(shell.toggle("list"), true);
  assert.equal(list.dataset.state, "drawer");
  assert.equal(list.hidden, false);
  assert.equal(frame.dataset.drawer, "list");
  assert.equal(page.$("shell-scrim").hidden, false);
  assert.equal(shell.isOpen("list"), true);
  assert.equal(list.contains(page.document.activeElement), true, "focus moves into the drawer");
  assert.equal(list.style["--frame-drawer-w"], "280px", "the width it was given, inside the window");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  // One drawer at a time; focus still goes back to where it was before the first one opened.
  shell.open("inspector");
  assert.equal(frame.dataset.drawer, "inspector");
  assert.equal(list.dataset.state, "closed");
  assert.equal(inspector.style["--frame-drawer-w"], "376px", "never wider than the window less a margin");
  assert.equal(shell.close("inspector"), false);
  assert.equal(page.document.activeElement, toggle, "closing returns focus to what had it when the drawers began");
  assert.equal(page.$("shell-scrim").hidden, true, "and the scrim goes with the drawer");
  // Escape closes it and focus goes back to the button that opened it.
  other.focus();
  shell.toggle("inspector");
  assert.equal(frame.dataset.drawer, "inspector");
  const event = page.key({ key: "Escape" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(frame.dataset.drawer, "");
  assert.equal(inspector.dataset.state, "closed");
  assert.equal(page.document.activeElement, other, "focus returns to the button");
  assert.equal(page.key({ key: "Escape" }).defaultPrevented, false, "Escape with nothing open is left alone");
  // A press on the scrim closes it.
  shell.open("list");
  page.$("shell-scrim").listeners.pointerdown[0]({ preventDefault() {} });
  assert.equal(frame.dataset.drawer, "");
  assert.equal(shell.info("list").drawerOpen, false);
  // A press on the rail or a bar closes it too; one inside it, on its own toggle or in the menu does not.
  shell.open("list");
  {
    page.press(page.get("app-rail"));
    assert.equal(frame.dataset.drawer, "", "a press on the rail closes the drawer and goes on to do its own work");
    shell.open("list");
    page.press(list);
    page.press(page.$("shell-list-toggle"));
    page.press(page.$("shell-scrim"));
    assert.equal(frame.dataset.drawer, "list", "inside the drawer, on the button that opened it, or on the scrim (which has its own handler) the press leaves it to them");
    page.press(page.$("shell-search"));
    assert.equal(frame.dataset.drawer, "", "a press on the bar closes it");
  }
  // Going somewhere closes it, and so does a change of mode.
  shell.open("list");
  page.window.dispatchEvent({ type: "mefi:nav" });
  assert.equal(frame.dataset.drawer, "");
  shell.open("inspector");
  shell.setMode("vibe");
  assert.equal(frame.dataset.drawer, "", "a drawer does not follow the mode");
  // The strip and the status bar stay rows.
  assert.equal(page.region("status").dataset.state, undefined);
  assert.equal(page.region("tabs").dataset.state, undefined);
  assert.equal(shell.info("status").drawer, false);
  assert.equal(shell.info("tabs").drawer, false);
});

test("Escape leaves a drawer alone while a sheet or the palette is over it; the layout menu and a drawer never stand together", () => {
  const page = loadShell({ width: 500, height: 400 });
  const shell = page.window.MefiShell;
  const frame = page.$("shell-frame");
  shell.open("list");
  page.nav.state.transient = true;
  assert.equal(page.key({ key: "Escape" }).defaultPrevented, false);
  assert.equal(frame.dataset.drawer, "list", "the sheet's own Escape comes first");
  page.nav.state.transient = false;
  const button = page.$("shell-layout-button");
  button.focus();
  button.listeners.click[0]();
  assert.ok(page.$("shell-menu"), "the menu is open");
  assert.equal(frame.dataset.drawer, "", "opening the menu closes a drawer");
  shell.open("list");
  assert.equal(page.$("shell-menu"), null, "and opening a drawer closes the menu");
  assert.equal(frame.dataset.drawer, "list");
  page.key({ key: "Escape" });
  assert.equal(frame.dataset.drawer, "");
  assert.equal(page.document.activeElement, button, "a drawer opened from the menu hands focus back to the button, not to the menu that went");
  button.focus();
  button.listeners.click[0]();
  assert.ok(page.$("shell-menu"));
  assert.equal(page.key({ key: "Escape" }).defaultPrevented, true);
  assert.equal(page.$("shell-menu"), null, "Escape closes the menu");
  assert.equal(page.document.activeElement, button, "and focus goes back to the button");
});

test("a window too narrow to dock the inspector beside the list makes it a drawer, though the contract has not folded", () => {
  const page = loadShell({ width: 1100, pinned: true });
  const shell = page.window.MefiShell;
  assert.equal(page.root.dataset.layoutFold, undefined);
  assert.equal(shell.info("list").docked, true);
  assert.equal(shell.info("inspector").drawer, true, "256 + 280 + 320 leaves 244 for an inspector that needs 320");
  assert.equal(shell.isOpen("inspector"), false);
  assert.equal(asked(page).inspector, 0);
  shell.toggle("inspector");
  assert.equal(page.$("shell-frame").dataset.drawer, "inspector");
  assert.equal(page.$("shell-inspector").style["--frame-drawer-w"], "388px");
  shell.toggle("inspector");
  assert.equal(page.$("shell-frame").dataset.drawer, "");
  // Closing the list frees room and the inspector docks.
  page.resize({ innerWidth: 1100 });
  shell.close("list");
  assert.equal(shell.info("inspector").docked, true, "the room a closed list leaves is the inspector's");
  assert.equal(asked(page).inspector, 388);
});

test("the top bar is a row the page is not drawn under: usable() stays clear of it, with the real contract", () => {
  const page = loadShell({ realNav: true, width: 1440, height: 900 });
  const shell = page.window.MefiShell;
  assert.equal(shell.active(), true, "built against the real renderer/nav.js");
  assert.deepEqual(plain(page.nav.layout.get()), { list: 280, inspector: 388, tabs: 0, status: 28 });
  assert.equal(page.props["--shell-list-w"], "280px");
  assert.equal(page.props["--shell-inspector-w"], "388px");
  assert.equal(page.props["--shell-status-h"], "28px");
  page.box("shell-top", { left: 344, top: 0, width: 704, height: 56 });
  const area = plain(page.nav.usable());
  assert.equal(area.left, 64 + 280, "the list is part of what floats stay out of");
  assert.equal(area.right, 1440 - 388);
  assert.equal(area.bottom, 900 - 28);
  assert.equal(area.top, 56, "with the top bar on screen and no local navigation, the bar's row is kept clear");
  shell.resize("tabs", 36);
  assert.equal(plain(page.nav.usable()).top, 56 + 36, "and the strip sits under it");
  // The contract's own limits, through the frame.
  shell.resize("list", 9999);
  assert.equal(page.props["--shell-list-w"], "420px");
  shell.setMode("vibe");
  assert.deepEqual(plain(page.nav.layout.get()), { list: 0, inspector: 0, tabs: 36, status: 28 }, "Vibe: both closed, and the variables are the contract's to drop");
  shell.setMode("build");
  assert.equal(page.props["--shell-list-w"], "420px", "and Build comes back");
  // A resize that folds the window hands the columns to the drawers, and the variables are the contract's.
  page.resize({ innerWidth: 800, innerHeight: 600 });
  assert.equal(page.root.dataset.layoutFold, "list inspector");
  assert.equal(shell.info("list").drawer, true);
  assert.equal(shell.size("list"), 0);
  page.resize({ innerWidth: 1440, innerHeight: 900 });
  assert.equal(shell.info("list").docked, true);
  assert.equal(page.props["--shell-list-w"], "420px", "the contract remembered what was asked");
  // Turning v2 off through the contract takes the frame away.
  page.nav.applyLayout(false);
  assert.equal(shell.active(), false);
  assert.equal(page.$("shell-frame"), null);
});

test("the frame asking the contract does not make the contract's event ask the frame again", () => {
  const page = loadShell({ realNav: true });
  const shell = page.window.MefiShell;
  const before = page.events.length;
  shell.resize("list", 300);
  shell.resize("inspector", 500);
  shell.setMode("vibe");
  shell.setMode("build");
  const layoutEvents = page.events.slice(before).filter((event) => event.type === "mefi:layout").length;
  assert.ok(layoutEvents >= 1, "the contract announced the change");
  assert.ok(layoutEvents < 12, `and the frame did not turn it into a storm (${layoutEvents})`);
  assert.equal(shell.info("list").width, 300);
  assert.equal(shell.info("inspector").width, 500);
});
