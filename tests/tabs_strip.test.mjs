// The strip itself (renderer/tabs.js + tabs.css): what is drawn into the shell's tab region, its ARIA, how it fits, the menus,
// the keys, dragging and the keyboard equivalent, and the "Tab behaviour" card. The shell and the nav are the stubs in
// tests/fixtures/tabs-env.mjs and the DOM is the shared fake, so this pins structure and behaviour; how it looks, real
// geometry and real input are tests/tabs_render.test.mjs's (Electron).
import test from "node:test";
import assert from "node:assert/strict";
import { REGISTRY, tabsEnv, task } from "./fixtures/tabs-env.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const session = (t, id, options = {}) => t.tabs.open("workspace", { view: "task", taskId: id, projectId: "p1" }, { preview: false, ...options });
const page = (t, id, options = {}) => t.tabs.open(id, {}, { preview: false, ...options });
const idOf = (t, routeId, taskId = null) => t.tabs.list().find((tab) => tab.route.id === routeId && (taskId === null || tab.route.params.taskId === taskId)).id;
const listOf = (t) => t.document.querySelector(".ts-list");
const tabNode = (t, routeId, taskId = null) => t.document.querySelector(`#mefi-tab-${idOf(t, routeId, taskId)}`);
/** A key event on a node, with the bookkeeping a test wants back: what the page did with it. */
async function press(node, key, extra = {}) {
  const seen = { prevented: false, stopped: false };
  await node.trigger("keydown", { key, preventDefault() { seen.prevented = true; }, stopPropagation() { seen.stopped = true; }, ...extra });
  return seen;
}
const field = (type = "text", tagName = "INPUT") => ({ tagName, type, getAttribute: (name) => (name === "type" ? type : null), closest: () => null });
const labelsOf = (nodes) => nodes.map((node) => node.querySelector(".ts-menulabel")?.textContent ?? node.textContent);
const menuItems = (t) => t.popover()?.querySelectorAll(".ts-menuitem") ?? [];
const menuAct = (t, act) => menuItems(t).find((node) => node.dataset.act === act);
const rowsOf = (t) => t.popover().querySelectorAll(".ts-row").map((row) => row.querySelector(".ts-rowlabel").textContent);

test("the strip is drawn into the shell's tab region, and the region is given the strip's height", async () => {
  const t = await tabsEnv();
  assert.equal(t.mounts.length, 1, "through the shell's own mount()");
  assert.deepEqual([t.mounts[0].region, t.mounts[0].key, t.mounts[0].options.title, t.mounts[0].options.order], ["tabs", "tabs", "Tabs", 0]);
  assert.equal(t.strip().parentNode, t.regions.tabs, "inside the tabs region");
  assert.equal(t.strip().id, "mefi-tabs");
  assert.deepEqual(t.resizes.at(-1), ["tabs", 38], "the fallback height when no density token is set");
  t.css["--d-tab"] = "44px";
  t.window.dispatchEvent({ type: "mefi:appearance" });
  assert.deepEqual(t.resizes.at(-1), ["tabs", 44], "the density token (SIZE's --d-tab) when there is one");
  t.css["--d-tab"] = "90px";
  t.window.dispatchEvent({ type: "mefi:appearance" });
  assert.deepEqual(t.resizes.at(-1), ["tabs", 48], "never taller than the contract's 48");
  t.css["--d-tab"] = "8px";
  t.window.dispatchEvent({ type: "mefi:appearance" });
  assert.deepEqual(t.resizes.at(-1), ["tabs", 28], "never so short that a focus ring is cut off");
  t.css["--d-tab"] = "tall";
  t.window.dispatchEvent({ type: "mefi:appearance" });
  assert.deepEqual(t.resizes.at(-1), ["tabs", 38], "and a value that is not a length is ignored");
  t.css["--d-tab"] = "calc(2rem + 2px)"; t.css.__height = "34px";
  t.window.dispatchEvent({ type: "mefi:appearance" });
  assert.deepEqual(t.resizes.at(-1), ["tabs", 34], "a token that is a calc() or a rem is read as the height the strip really has");
  t.css.__height = "0px";
  t.window.dispatchEvent({ type: "mefi:appearance" });
  assert.deepEqual(t.resizes.at(-1), ["tabs", 38], "and a strip with no height to read falls back to the token's own number, else 38");
});

test("hiding the strip gives its height back and show() takes it again; the tabs stay in the model and the keys keep working", async () => {
  const t = await tabsEnv();
  await t.go("fleet"); t.tabs.keep();
  assert.equal(t.tabs.visible(), true);
  t.tabs.hide();
  assert.equal(t.tabs.visible(), false);
  assert.deepEqual(t.resizes.at(-1), ["tabs", 0], "the region closes");
  assert.equal(t.strip().hidden, true);
  assert.equal(t.mounts[0].shown, false, "and the shell is told");
  assert.deepEqual(plain(t.tabs.list().map((tab) => tab.route.id)), ["workspace", "fleet"], "nothing was closed");
  assert.equal(t.key({ key: "1", code: "Digit1", ctrlKey: true }).defaultPrevented, true, "Ctrl 1 still goes to Home");
  assert.equal(t.tabs.active(), "home");
  t.tabs.show();
  assert.equal(t.tabs.visible(), true);
  assert.deepEqual(t.resizes.at(-1), ["tabs", 38]);
  assert.equal(t.strip().hidden, false);
  assert.equal(t.mounts[0].shown, true);
  // FRAME's Layout menu can close the region itself: the shell's own event says so
  t.sizes.tabs = 0; t.window.dispatchEvent({ type: "mefi:shell-layout", detail: { region: "tabs", px: 0 } });
  assert.equal(t.tabs.visible(), false, "a region that was closed by the shell is not a strip anyone can see");
  t.sizes.tabs = 38; t.window.dispatchEvent({ type: "mefi:shell-layout", detail: { region: "tabs", px: 38 } });
  assert.equal(t.tabs.visible(), true);
});

test("the tablist, its tabs and the panel they control: roles, names, one tab stop", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Add dark mode" })] });
  await t.go("fleet"); t.tabs.keep();
  session(t, "a");
  await t.settle();
  const list = listOf(t);
  assert.equal(list.getAttribute("role"), "tablist");
  assert.equal(list.getAttribute("aria-label"), "Open tabs");
  assert.equal(list.getAttribute("aria-orientation"), "horizontal");
  const tabs = list.querySelectorAll(".ts-tab");
  assert.equal(tabs.length, 3);
  assert.deepEqual(tabs.map((tab) => tab.getAttribute("role")), ["tab", "tab", "tab"]);
  assert.deepEqual(tabs.map((tab) => tab.getAttribute("aria-selected")), ["false", "false", "true"], "exactly one is selected: the one showing");
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [-1, -1, 0], "the list is one tab stop, on the selected tab");
  assert.deepEqual(list.querySelectorAll(".ts-item").map((item) => item.getAttribute("role")), ["presentation", "presentation", "presentation"], "the wrappers say nothing");
  assert.equal(new Set(tabs.map((tab) => tab.id)).size, 3, "every tab has its own id");
  for (const tab of tabs) assert.equal(tab.type, "button");
  for (const close of list.querySelectorAll(".ts-close")) assert.equal(close.tabIndex, -1, "a close button is reached with Delete, not with Tab");
  assert.equal(list.querySelectorAll(".ts-close").every((close) => /^Close /.test(close.getAttribute("aria-label"))), true);
  // the panel: the main area is the tab panel of the selected tab
  const main = t.regions.main;
  assert.equal(main.getAttribute("role"), "tabpanel");
  assert.equal(main.getAttribute("aria-labelledby"), tabNode(t, "workspace", "a").id);
  assert.equal(tabs.every((tab) => tab.getAttribute("aria-controls") === main.id), true, "every tab names the panel");
  await t.go("workspace");
  assert.equal(main.getAttribute("aria-labelledby"), tabs[0].id, "and the panel follows the selection");
});

test("the main area keeps a role it already has; a <main> is left alone; stopping the strip takes its own roles back", async () => {
  const t = await tabsEnv();
  assert.equal(t.regions.main.getAttribute("role"), "tabpanel");
  t.tabs.stop();
  assert.equal(t.regions.main.getAttribute("role"), null, "gone with the strip");
  assert.equal(t.regions.main.getAttribute("aria-labelledby"), null);
  t.regions.main.setAttribute("role", "main");
  t.tabs.start(); await t.settle();
  assert.equal(t.regions.main.getAttribute("role"), "main", "FRAME's own role wins");
  assert.equal(t.document.querySelector(".ts-tab").getAttribute("aria-controls"), null, "and a tab does not point at a panel that is not one");
  t.tabs.stop();
  t.regions.main.removeAttribute("role"); t.regions.main.tagName = "MAIN";
  t.tabs.start(); await t.settle();
  assert.equal(t.regions.main.getAttribute("role"), null, "a <main> element is not turned into a tab panel");
});

test("Home is the first tab: pinned, without a close button, counted by the Today board when there is one", async () => {
  const t = await tabsEnv();
  const home = t.items()[0];
  assert.equal(home.dataset.home, "true");
  assert.equal(home.dataset.pinned, "true");
  assert.equal(home.querySelector(".ts-title").textContent, "Home", "Home while there is no Today board");
  assert.equal(home.querySelector(".ts-close").hidden, true, "Home does not close");
  assert.equal(home.querySelector(".ts-count").hidden, true, "and has no badge while nothing needs you");
  t.window.MefiToday = { count: () => 3, onChange: () => () => {} };
  t.tabs.flush();
  assert.equal(t.items()[0].querySelector(".ts-title").textContent, "Today", "the Today board renames it");
  assert.equal(t.items()[0].querySelector(".ts-count").textContent, "3");
  assert.equal(t.items()[0].querySelector(".ts-count").title, "3 need you");
  assert.equal(t.items()[0].querySelector(".ts-count").hidden, false);
  t.window.MefiToday.count = () => 0;
  t.tabs.flush();
  assert.equal(t.items()[0].querySelector(".ts-count").hidden, true, "it goes away with the need");
});

test("the Inbox's tab carries the Inbox's count, the same number as Home's: one list, one number", async () => {
  const inbox = { id: "inbox", label: "Inbox", short: "Inbox", kind: "overlay", layer: "sheet", section: "work", glyph: "g-bell", showIn: { palette: true } };
  const t = await tabsEnv({ registry: [...REGISTRY, inbox] });
  t.window.MefiToday = { count: () => 2, onChange: () => () => {} };
  page(t, "inbox"); page(t, "fleet");
  t.tabs.flush();
  const chip = t.itemOf("Inbox").querySelector(".ts-count");
  assert.deepEqual([chip.hidden, chip.textContent, chip.title], [false, "2", "2 need you"]);
  assert.equal(t.items()[0].querySelector(".ts-count").textContent, "2", "Home says the same");
  assert.equal(t.itemOf("Fleet").querySelector(".ts-count").hidden, true, "no other page counts");
  t.window.MefiToday.count = () => 0;
  t.tabs.flush();
  assert.equal(t.itemOf("Inbox").querySelector(".ts-count").hidden, true, "it goes with the need");
});

test("what a tab says: its words, its glyph, pinned ones short, the preview in a way a screen reader can tell", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Add dark mode to the settings page", status: "active" })] });
  await t.go("fleet");
  const fleet = t.itemOf("Fleet");
  assert.equal(fleet.dataset.preview, "true");
  assert.match(fleet.querySelector(".ts-tab").getAttribute("aria-label"), /^Fleet, preview$/);
  assert.match(fleet.querySelector(".ts-tab").title, /preview: double-click to keep it/);
  assert.equal(fleet.querySelector(".ts-ico").querySelector("use").getAttribute("href"), "#g-fleet", "the page's own glyph from the registry");
  session(t, "a");
  t.tabs.pin(idOf(t, "workspace", "a"), true);
  await t.settle();
  const pinned = t.itemOf("Add dark…");
  assert.ok(pinned, "a pinned tab is compact");
  assert.equal(pinned.querySelector(".ts-tab").getAttribute("aria-label"), "Add dark mode to the settings page, pinned", "the whole name for a screen reader");
  assert.match(pinned.querySelector(".ts-tab").title, /^Add dark mode to the settings page, pinned/);
  assert.equal(pinned.querySelector(".ts-close").hidden, true, "a pinned tab has no close button: unpin it first");
  assert.equal(pinned.querySelector(".ts-dot").dataset.tone, "live", "a session shows a dot in its state's colour, not a glyph");
  assert.match(t.itemOf("Fleet").querySelector(".ts-tab").title, /Ctrl 3|Ctrl 2/, "and every tab says which Ctrl-number jumps to it");
});

test("a tab that needs you is flagged and named so, unless you are on it", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Needs an answer" }), task("b", { title: "Quiet" })] });
  session(t, "a"); session(t, "b");
  t.board.assistant = { questions: [{ id: "q1", status: "open", context: { taskId: "a" } }] };
  t.window.dispatchEvent({ type: "mefi:workspace-state" });
  await t.settle();
  const a = t.itemOf("Needs an answer");
  assert.equal(a.dataset.attn, "true");
  assert.equal(a.querySelector(".ts-flag").hidden, false);
  assert.match(a.querySelector(".ts-tab").getAttribute("aria-label"), /needs you$/);
  assert.equal(t.itemOf("Quiet").dataset.attn, undefined);
  await t.click(a.querySelector(".ts-tab"));
  assert.equal(t.itemOf("Needs an answer").dataset.attn, undefined, "the tab you are on is not shouting");
  assert.equal(t.itemOf("Needs an answer").querySelector(".ts-flag").hidden, true);
});

// ---- fitting: tabs that do not fit fold into "N more" -------------------------------------------------------------------
async function crowded(width = 560) {
  const t = await tabsEnv({ tasks: Array.from({ length: 6 }, (_, i) => task(`s${i}`, { title: `Session ${i}` })) });
  t.tabs.setPrefs({ cap: 12 });
  page(t, "fleet"); page(t, "plans"); page(t, "worktrees");
  for (let i = 0; i < 5; i += 1) session(t, `s${i}`);
  await t.settle();
  t.measure({ width });
  return t;
}
const hiddenTitles = (t) => t.items().filter((item) => item.hidden).map((item) => item.querySelector(".ts-title").textContent);
const more = (t) => t.document.querySelector(".ts-more");

test("tabs that do not fit fold into an 'N more' button from the right; Home, pins and the tab you are on stay", async () => {
  const t = await crowded(560);
  // Home 88 and eight tabs of 140 is far more than 560
  assert.equal(more(t).hidden, false);
  const hidden = hiddenTitles(t);
  assert.equal(more(t).textContent, `${hidden.length} more`);
  assert.deepEqual(hidden, ["Worktrees", "Session 0", "Session 1", "Session 2", "Session 3"], "folded from the right, in the order they are in");
  assert.deepEqual(t.titles(), ["Home", "Fleet", "Plans", "Session 4"], "Home and the tab you are on (the last one) stay, and so does what fits");
  assert.equal(t.items()[0].hidden, false, "Home never folds");
  const shown = t.items().filter((item) => !item.hidden).reduce((sum, item) => sum + (item.dataset.home ? 88 : item.dataset.pinned ? 64 : 140), 0);
  assert.ok(shown <= 560, "what stays fits");
});

test("pinned tabs are never folded away, however narrow the strip gets", async () => {
  const t = await crowded(560);
  t.tabs.pin(idOf(t, "fleet"), true); t.tabs.pin(idOf(t, "plans"), true);
  await t.settle(); t.measure({ width: 380 });
  assert.equal(t.itemOf("Fleet").hidden, false);
  assert.equal(t.itemOf("Plans").hidden, false);
  assert.equal(hiddenTitles(t).some((title) => ["Fleet", "Plans", "Home"].includes(title)), false);
  assert.equal(more(t).hidden, false);
  t.measure({ width: 170 }); // Home and the two pins alone are wider than this: they are still not what folds
  assert.deepEqual(t.titles().slice(0, 3), ["Home", "Fleet", "Plans"], "they stay, and the strip is left to be clipped rather than lose them");
  assert.equal(hiddenTitles(t).some((title) => ["Fleet", "Plans", "Home"].includes(title)), false);
});

test("the 'more' menu lists what is folded, and choosing one brings it into view", async () => {
  const t = await crowded(560);
  const folded = hiddenTitles(t);
  await t.click(more(t));
  const pop = t.popover();
  assert.ok(pop, "a menu opens");
  assert.equal(pop.getAttribute("role"), "menu");
  assert.equal(pop.getAttribute("aria-label"), "More tabs");
  assert.equal(more(t).getAttribute("aria-expanded"), "true");
  assert.deepEqual(labelsOf(menuItems(t)), folded, "the same tabs, in the same order");
  assert.equal(menuItems(t).filter((node) => node.querySelector(".ts-dot")).length, folded.filter((title) => title.startsWith("Session")).length, "a session has its state's dot here too, as on its tab");
  assert.equal(menuItems(t).filter((node) => node.querySelector("svg")).length, folded.filter((title) => !title.startsWith("Session")).length, "and a page its glyph");
  const first = menuItems(t)[0];
  await t.click(first);
  assert.equal(t.popover(), null, "the menu closes");
  assert.equal(t.active(), folded[0], "and the tab is the one showing");
  assert.equal(t.itemOf(folded[0]).hidden, false, "and is now in view, because the tab you are on never folds");
  assert.equal(more(t).getAttribute("aria-expanded"), "false");
});

test("when everything fits there is no 'more' button, and widening the strip brings the tabs back", async () => {
  const t = await crowded(560);
  assert.equal(more(t).hidden, false);
  t.measure({ width: 1800 });
  assert.equal(more(t).hidden, true);
  assert.deepEqual(hiddenTitles(t), []);
  t.measure({ width: 400 });
  assert.equal(more(t).hidden, false);
});

test("below the contract's fold (900 CSS px) the strip is one menu button: no 'more', every tab in the menu", async () => {
  const t = await crowded(200);
  assert.equal(more(t).hidden, false, "wide: the tabs fold");
  t.window.innerWidth = 760; t.window.dispatchEvent({ type: "resize" }); await t.settle();
  assert.equal(more(t).hidden, true, "narrow: one menu button instead, the stylesheet hides the tabs");
  assert.equal(hiddenTitles(t).length, 0, "none is folded: they are all in the menu");
  const menu = t.document.querySelector(".ts-menu");
  assert.equal(menu.getAttribute("aria-haspopup"), "menu");
  assert.match(menu.getAttribute("aria-label"), /^Tabs, 9 open\. Current: Session 4$/);
  assert.equal(menu.querySelector(".ts-title").textContent, "Session 4", "it says where you are");
  assert.equal(menu.querySelector(".ts-count").textContent, "9", "and how many tabs there are");
  await t.click(menu);
  const pop = t.popover();
  assert.equal(pop.getAttribute("aria-label"), "Tabs");
  const rows = pop.querySelectorAll(".ts-menurow");
  assert.equal(rows.length, 9, "every tab has a row");
  assert.equal(rows.filter((row) => row.querySelector(".ts-close")).length, 8, "with a close button, except Home which does not close");
  assert.equal(pop.querySelector('[aria-current="true"]').querySelector(".ts-menulabel").textContent, "Session 4");
  assert.match(pop.querySelector(".ts-group").textContent, /^9 tabs/);
  assert.deepEqual(labelsOf(pop.querySelectorAll(".ts-menuitem").slice(-3)), ["Open a tab", "Reopen a closed tab", "Tab behaviour"]);
  // close one from the menu, and pick another
  await t.click(rows[1].querySelector(".ts-close"));
  assert.equal(t.popover(), null);
  assert.equal(t.tabs.list().length, 8);
  await t.click(menu);
  await t.click(t.popover().querySelectorAll(".ts-menurow")[0].querySelector(".ts-menuitem"));
  assert.equal(t.tabs.active(), "home", "a row activates its tab");
  t.window.innerWidth = 1400; t.window.dispatchEvent({ type: "resize" }); await t.settle();
  assert.equal(more(t).hidden, false, "and widening the window gives the strip back");
});

// ---- the mouse ------------------------------------------------------------------------------------------------------------
test("a click opens a tab, its × closes it, a middle-click closes it, a double-click keeps a preview", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Mine" })] });
  page(t, "fleet"); page(t, "plans");
  await t.settle();
  await t.click(tabNode(t, "workspace"));
  assert.equal(t.tabs.active(), "home");
  assert.equal(t.nav.current(), "workspace", "the click went to the page");
  await t.click(tabNode(t, "fleet"));
  assert.equal(t.nav.current(), "fleet");
  // the close button closes that tab and does not activate it
  await t.click(t.itemOf("Plans").querySelector(".ts-close"));
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "plans"), false);
  assert.equal(t.tabs.active() !== null && t.itemOf("Fleet").dataset.active, "true", "the tab you were on is still the one showing");
  // a middle click closes it: the same as the ×
  page(t, "worktrees"); await t.settle();
  const middle = { button: 1, preventDefault() { middle.prevented = true; } };
  await t.itemOf("Worktrees").querySelector(".ts-tab").trigger("auxclick", middle);
  await t.settle();
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "worktrees"), false, "a middle-click closes");
  assert.equal(middle.prevented, true);
  // any other button does nothing
  await t.itemOf("Fleet").querySelector(".ts-tab").trigger("auxclick", { button: 2 });
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "fleet"), true, "a right-button auxclick is not a close");
  // the press of a middle button is cancelled so the page does not start auto-scrolling
  const press1 = { button: 1, preventDefault() { press1.prevented = true; } };
  await t.itemOf("Fleet").querySelector(".ts-tab").trigger("mousedown", press1);
  assert.equal(press1.prevented, true);
  // a preview is kept by a double-click
  await t.go("tasks");
  assert.equal(t.itemOf("Tasks").dataset.preview, "true");
  await t.itemOf("Tasks").querySelector(".ts-tab").trigger("dblclick");
  await t.settle();
  assert.equal(t.itemOf("Tasks").dataset.preview, undefined, "it stays");
});

test("closing the tab you are on goes to its neighbour, and the page follows", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans"); page(t, "worktrees");
  await t.settle();
  await t.click(tabNode(t, "plans"));
  assert.equal(t.nav.current(), "plans");
  await t.click(t.itemOf("Plans").querySelector(".ts-close"));
  assert.equal(t.active(), "Worktrees", "the tab to its right");
  assert.equal(t.nav.current(), "worktrees");
  await t.click(t.itemOf("Worktrees").querySelector(".ts-close"));
  assert.equal(t.active(), "Fleet", "or to its left when it was the last");
  assert.equal(t.nav.current(), "fleet");
});

// ---- the keyboard on the tablist --------------------------------------------------------------------------------------------
test("arrow keys move between tabs, Home and End jump to the ends, Enter and Space open, Delete closes", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans"); page(t, "worktrees");
  await t.settle();
  const tabs = () => listOf(t).querySelectorAll(".ts-tab");
  const home = tabs()[0];
  home.focus();
  let seen = await press(home, "ArrowRight");
  assert.equal(seen.prevented, true);
  assert.equal(t.document.activeElement, tabs()[1], "right: the next tab");
  await press(tabs()[1], "ArrowLeft"); assert.equal(t.document.activeElement, tabs()[0]);
  await press(tabs()[0], "ArrowLeft"); assert.equal(t.document.activeElement, tabs()[3], "and it wraps");
  await press(tabs()[3], "ArrowRight"); assert.equal(t.document.activeElement, tabs()[0]);
  await press(tabs()[0], "End"); assert.equal(t.document.activeElement, tabs()[3]);
  await press(tabs()[3], "Home"); assert.equal(t.document.activeElement, tabs()[0]);
  // moving focus does not open anything (arrows are "manual activation")
  assert.equal(t.nav.current(), "worktrees");
  await press(tabs()[1], "Enter");
  assert.equal(t.nav.current(), "fleet", "Enter opens the focused tab");
  await press(tabs()[2], " ");
  assert.equal(t.nav.current(), "plans", "and so does Space");
  // Delete closes the focused tab and puts focus on its neighbour
  tabs()[2].focus();
  seen = await press(tabs()[2], "Delete");
  assert.equal(seen.prevented, true);
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "plans"), false);
  await t.settle();
  assert.equal(t.document.activeElement?.dataset?.id, t.tabs.list().find((tab) => tab.route.id === "worktrees").id, "focus lands on the next tab, not on nothing");
  // Delete on Home does nothing
  await press(tabs()[0], "Delete");
  assert.equal(t.tabs.list()[0].home, true);
});

test("the list is one tab stop: it rests on the selected tab and follows focus while focus is inside", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans");
  await t.settle();
  const tabs = listOf(t).querySelectorAll(".ts-tab");
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [-1, -1, 0]);
  await listOf(t).trigger("focusin", { target: tabs[0] });
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [0, -1, -1], "the tab that has focus is the stop");
  await listOf(t).trigger("focusout", { target: tabs[0], relatedTarget: null });
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [-1, -1, 0], "and focus leaving puts it back on the selected one");
});

test("Ctrl+Shift+Arrow is the keyboard way to move a tab, said aloud; it stays inside its group", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans"); page(t, "worktrees");
  t.tabs.pin(idOf(t, "fleet"), true);
  await t.settle();
  const order = () => plain(t.tabs.list().map((tab) => tab.route.id));
  assert.deepEqual(order(), ["workspace", "fleet", "plans", "worktrees"]);
  const live = t.document.querySelector(".ts-live");
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(live.getAttribute("aria-live"), "polite");
  let seen = await press(tabNode(t, "worktrees"), "ArrowLeft", { ctrlKey: true, shiftKey: true });
  assert.equal(seen.prevented, true);
  assert.deepEqual(order(), ["workspace", "fleet", "worktrees", "plans"]);
  assert.equal(live.textContent, "Moved Worktrees to position 3 of 4");
  seen = await press(tabNode(t, "worktrees"), "ArrowLeft", { ctrlKey: true, shiftKey: true });
  assert.deepEqual(order(), ["workspace", "fleet", "worktrees", "plans"], "it does not cross into the pinned ones: that is what Pin is for");
  await press(tabNode(t, "worktrees"), "ArrowRight", { ctrlKey: true, shiftKey: true });
  assert.deepEqual(order(), ["workspace", "fleet", "plans", "worktrees"]);
  await press(tabNode(t, "workspace"), "ArrowRight", { ctrlKey: true, shiftKey: true });
  assert.deepEqual(order(), ["workspace", "fleet", "plans", "worktrees"], "Home does not move");
  await t.settle();
  assert.equal(t.document.activeElement?.dataset?.id, idOf(t, "worktrees"), "and focus stays on the tab that moved");
  // the plain arrows are not the move keys
  await press(tabNode(t, "plans"), "ArrowLeft");
  assert.deepEqual(order(), ["workspace", "fleet", "plans", "worktrees"]);
});

test("the menu key and Shift+F10 open the tab's menu from the keyboard", async () => {
  const t = await tabsEnv();
  page(t, "fleet");
  await t.settle();
  let seen = await press(tabNode(t, "fleet"), "ContextMenu");
  assert.equal(seen.prevented, true);
  assert.ok(t.popover(), "the menu key");
  assert.equal(t.popover().getAttribute("aria-label"), "Tab: Fleet");
  await press(t.popover(), "Escape");
  assert.equal(t.popover(), null);
  seen = await press(tabNode(t, "fleet"), "F10", { shiftKey: true });
  assert.ok(t.popover(), "Shift+F10");
});

// ---- the keys that work from anywhere ---------------------------------------------------------------------------------------
const chord = (key, extra = {}) => ({ key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^[1-9]$/.test(key) ? `Digit${key}` : key, ctrlKey: true, ...extra });

test("Ctrl+T opens the Add menu and Ctrl+T again closes it; Cmd does the same on a Mac", async () => {
  const t = await tabsEnv();
  let event = t.key(chord("t"));
  assert.equal(event.defaultPrevented, true, "the window's own Ctrl+T (there is none, but a browser has one) is not offered it");
  assert.equal(event.stopped, true, "and no other handler sees it");
  assert.equal(t.popover()?.id, "mefi-tabs-pop-add");
  assert.equal(t.document.querySelector("#mefi-tabs-add").getAttribute("aria-expanded"), "true");
  t.key(chord("t"));
  assert.equal(t.popover(), null, "Ctrl+T toggles");
  assert.equal(t.document.querySelector("#mefi-tabs-add").getAttribute("aria-expanded"), "false");
  t.key({ key: "t", code: "KeyT", metaKey: true });
  assert.ok(t.popover(), "Cmd+T");
  t.key(chord("t", { repeat: true }));
  assert.ok(t.popover(), "a held key does not flicker it: the repeat is swallowed, not acted on");
  assert.equal(t.key(chord("t", { repeat: true })).defaultPrevented, true);
});

test("Search lists what the strip does, under Tabs with each key, and each row runs what its key runs", async () => {
  const t = await tabsEnv();
  const rows = Object.fromEntries(t.nav.registered.filter((row) => row.paletteGroup === "Tabs").map((row) => [row.id, row]));
  assert.deepEqual(Object.values(rows).map((row) => [row.id, row.label, row.chord ?? null]), [["tabs-do-add", "Open a tab", "Ctrl T"], ["tabs-do-reopen", "Reopen a closed tab", "Ctrl Shift T"], ["tabs-do-pin", "Pin or unpin this tab", "Ctrl Alt P"], ["tabs-do-close", "Close this tab", "Ctrl W"], ["tabBehaviour", "Tab behaviour", null]]);
  assert.equal(t.nav.registered.at(-1).id, "tabBehaviour", "Tab behaviour stays the last record the strip registers");
  for (const id of ["tabs-do-add", "tabs-do-reopen", "tabs-do-pin", "tabs-do-close"]) {
    assert.equal(rows[id].keyMatch(), false, `${id}: shown, not bound twice`);
    assert.equal(rows[id].hidden(), false);
    assert.deepEqual({ ...rows[id].showIn }, { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false });
  }
  rows["tabs-do-add"].run();
  assert.equal(t.popover()?.id, "mefi-tabs-pop-add", "Open a tab is the Add menu");
  rows["tabs-do-add"].run();
  page(t, "fleet"); page(t, "plans");
  await t.settle();
  rows["tabs-do-pin"].run();
  assert.equal(t.tabs.list().find((tab) => tab.route.id === "plans").pin, true, "Pin is the tab you are on");
  rows["tabs-do-pin"].run();
  rows["tabs-do-close"].run();
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "plans"), false, "Close is the tab you are on");
  rows["tabs-do-reopen"].run();
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "plans"), true, "Reopen brings the newest back");
  t.tabs.stop();
  assert.ok(["tabs-do-add", "tabs-do-reopen", "tabs-do-pin", "tabs-do-close"].every((id) => rows[id].hidden()), "gone with the strip");
});

test("Ctrl+W closes the tab you are on, Home says it stays, and the window's own Ctrl+W is not offered the key", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans");
  await t.settle();
  let event = t.key(chord("w"));
  assert.equal(event.defaultPrevented, true, "the page has handled it, so the menu's Close (which would close the window) does not run");
  assert.equal(event.stopped, true);
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "plans"), false, "the tab closed");
  assert.equal(t.tabs.active(), idOf(t, "fleet"), "and the one beside it is showing");
  t.key(chord("w")); t.key(chord("w"));
  assert.deepEqual(plain(t.tabs.list().map((tab) => tab.route.id)), ["workspace"], "down to Home");
  const live = t.document.querySelector(".ts-live");
  t.key(chord("w"));
  assert.equal(live.textContent, "Home stays open", "Home is the front door: it does not close");
  assert.equal(t.tabs.list().length, 1);
  assert.equal(t.key(chord("w")).defaultPrevented, true, "and the window still does not close on it");
});

test("Ctrl+Tab and Ctrl+Shift+Tab walk the tabs and wrap; so do Ctrl+PageDown and Ctrl+PageUp", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans");
  await t.settle();
  const active = () => t.tabs.list().find((tab) => tab.active).route.id;
  assert.equal(active(), "plans");
  assert.equal(t.key(chord("Tab")).defaultPrevented, true);
  assert.equal(active(), "workspace", "Ctrl+Tab wraps to Home");
  t.key(chord("Tab")); assert.equal(active(), "fleet");
  t.key(chord("Tab", { shiftKey: true })); assert.equal(active(), "workspace");
  t.key(chord("Tab", { shiftKey: true })); assert.equal(active(), "plans", "Ctrl+Shift+Tab wraps the other way");
  t.key(chord("PageUp")); assert.equal(active(), "fleet");
  t.key(chord("PageDown")); assert.equal(active(), "plans");
  t.key(chord("Tab", { repeat: true })); assert.equal(active(), "workspace", "holding Ctrl+Tab keeps walking");
  await t.settle();
  assert.equal(t.nav.current(), "workspace", "and the page follows");
});

test("Ctrl+1 to Ctrl+9 jump to that tab, Ctrl+9 to the last; a number with no tab is taken and does nothing", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans"); page(t, "worktrees");
  await t.settle();
  const active = () => t.tabs.list().find((tab) => tab.active).route.id;
  assert.equal(t.key(chord("2")).defaultPrevented, true);
  assert.equal(active(), "fleet");
  t.key(chord("1")); assert.equal(active(), "workspace");
  t.key(chord("4")); assert.equal(active(), "worktrees");
  t.key(chord("1")); t.key(chord("9")); assert.equal(active(), "worktrees", "9 is the last tab, however many there are");
  t.key(chord("1"));
  assert.equal(t.key(chord("7")).defaultPrevented, true, "taken: the window has no use for it either");
  assert.equal(active(), "workspace", "and nothing moved");
  t.key({ key: "3", code: "Digit3", ctrlKey: true, repeat: true });
  assert.equal(active(), "workspace", "a held digit is not a repeated jump");
  t.key(chord("4"));
  t.key({ key: "&", code: "Digit1", ctrlKey: true });
  assert.equal(active(), "workspace", "the digit is read from the key's place on a keyboard where the digit row gives a symbol");
  t.key({ key: "", code: "Digit3", ctrlKey: true });
  assert.equal(active(), "plans");
});

test("Ctrl+Shift+T reopens the last closed tab, Ctrl+Alt+P pins or unpins the one you are on", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans");
  await t.settle();
  t.key(chord("w"));
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "plans"), false);
  assert.equal(t.key(chord("t", { shiftKey: true })).defaultPrevented, true);
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "plans"), true, "it is back");
  assert.equal(t.tabs.active(), idOf(t, "plans"), "and showing");
  t.key(chord("p", { altKey: true }));
  assert.equal(t.tabs.list().find((tab) => tab.route.id === "plans").pin, true, "pinned");
  t.key(chord("p", { altKey: true }));
  assert.equal(t.tabs.list().find((tab) => tab.route.id === "plans").pin, false, "and unpinned");
  t.key(chord("t", { shiftKey: true }));
  assert.match(t.toasts.at(-1).message, /No closed tabs/, "with nothing to reopen it says so");
});

test("Alt+W and Alt+Shift+T are the same as Ctrl+W and Ctrl+Shift+T, but only where nothing is being typed", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans");
  await t.settle();
  const alt = (key, extra = {}) => ({ key, code: `Key${key.toUpperCase()}`, altKey: true, ...extra });
  let event = t.key(alt("w", { target: field() }));
  assert.equal(event.defaultPrevented, false, "a text box may use Alt+W for itself");
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "plans"), true);
  event = t.key(alt("w", { target: field("text", "TEXTAREA") })); assert.equal(event.defaultPrevented, false);
  event = t.key(alt("w", { target: { tagName: "DIV", isContentEditable: true, closest: () => null } })); assert.equal(event.defaultPrevented, false, "nor an editable region");
  event = t.key(alt("w"));
  assert.equal(event.defaultPrevented, true);
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "plans"), false, "Alt+W closes");
  event = t.key(alt("t", { shiftKey: true, target: field() })); assert.equal(event.defaultPrevented, false);
  t.key(alt("t", { shiftKey: true }));
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "plans"), true, "Alt+Shift+T reopens");
  event = t.key(alt("w", { ctrlKey: true })); assert.equal(event.defaultPrevented, false, "Ctrl+Alt+W is AltGr+W on some keyboards: not ours");
  // a switch or a slider is not a place where text is being written
  t.key(alt("w", { target: field("checkbox") }));
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "plans"), false, "a checkbox does not need Alt+W");
});

test("a key a text field needs stays the field's: AltGr chords, Shift variants, composition, repeats of Ctrl+Alt+P", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans");
  await t.settle();
  const before = plain(t.tabs.list());
  const untouched = (init, why) => { const event = t.key(init); assert.equal(event.defaultPrevented, false, why); assert.deepEqual(plain(t.tabs.list()), before, why); };
  untouched(chord("w", { altKey: true }), "AltGr+W (Ctrl+Alt+W) types a character on some layouts");
  untouched(chord("t", { altKey: true }), "AltGr+T");
  untouched(chord("2", { altKey: true }), "AltGr+2 types a character on many layouts");
  untouched(chord("w", { shiftKey: true }), "Ctrl+Shift+W is not Close");
  untouched(chord("1", { shiftKey: true, key: "!" }), "Ctrl+Shift+1 is not a jump");
  untouched(chord("p", { altKey: true, target: field() }), "Ctrl+Alt+P in a text box (AltGr+P on some layouts)");
  untouched(chord("w", { isComposing: true }), "an IME composition");
  untouched({ key: "w", code: "KeyW" }, "a plain W");
  untouched({ key: "Tab", code: "Tab" }, "a plain Tab");
  untouched({ key: "a", code: "KeyA", ctrlKey: true }, "Ctrl+A, and every chord the strip does not own");
  untouched({ key: "ArrowLeft", code: "ArrowLeft", altKey: true }, "Alt+Left and Alt+Right stay Back and Forward (nav.js)");
  untouched({ key: "k", code: "KeyK", ctrlKey: true }, "Ctrl+K is Search's");
  untouched({ key: ",", code: "Comma", ctrlKey: true }, "Ctrl+, is Settings'");
  // Ctrl+W from inside a text box is the page's to use as a shortcut: there is no editing meaning for it on Windows or Linux
  assert.equal(t.key(chord("w", { target: field() })).defaultPrevented, true);
});

test("no key is taken while Search or Configuration is up, while the companion hub is open, or once the strip is stopped", async () => {
  const t = await tabsEnv();
  page(t, "fleet");
  await t.settle();
  t.nav.state.transient = "palette";
  assert.equal(t.key(chord("w")).defaultPrevented, false, "Search is up: its own Ctrl+W is not ours");
  assert.equal(t.key(chord("t")).defaultPrevented, false);
  assert.equal(t.key(chord("2")).defaultPrevented, false);
  assert.equal(t.tabs.list().length, 2);
  t.nav.state.transient = null;
  t.window.MefiCompanionHub = { isOpen: () => true };
  assert.equal(t.key(chord("w")).defaultPrevented, false, "the companion window has the keyboard");
  t.window.MefiCompanionHub = { isOpen: () => false };
  assert.equal(t.key(chord("w")).defaultPrevented, true);
  t.tabs.stop();
  assert.equal(t.key(chord("t")).defaultPrevented, false, "a stopped strip has no keys");
  assert.equal(t.tabs.list().length, 0);
});

test("a key closes an open menu first, so a chord is never aimed at a menu that is in the way", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans");
  await t.settle();
  await t.click(t.document.querySelector("#mefi-tabs-add"));
  assert.ok(t.popover());
  t.key(chord("1"));
  assert.equal(t.popover(), null);
  assert.equal(t.tabs.active(), "home");
  await t.click(t.document.querySelector("#mefi-tabs-add"));
  t.key(chord("w")); // Home: stays
  assert.equal(t.popover(), null);
});

// ---- dragging a tab ---------------------------------------------------------------------------------------------------------
async function roomy() {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans"); page(t, "worktrees"); page(t, "explorer");
  await t.settle();
  t.measure({ width: 1400 }); // Home 0-88, Fleet 88-228, Plans 228-368, Worktrees 368-508, Sessions 508-648
  return t;
}
const order = (t) => plain(t.tabs.list().map((tab) => tab.route.id));
const pointer = (t, type, x, extra = {}) => t.window.dispatchEvent({ type, clientX: x, button: 0, preventDefault() {}, stopPropagation() {}, ...extra });

test("dragging a tab moves it: a line shows where it will land, and the click that ends the drag activates nothing", async () => {
  const t = await roomy();
  const fleet = tabNode(t, "fleet");
  await fleet.trigger("pointerdown", { button: 0, clientX: 150 });
  pointer(t, "pointermove", 152);
  assert.equal(t.itemOf("Fleet").dataset.dragging, undefined, "a twitch of the hand is not a drag");
  pointer(t, "pointermove", 450);
  const item = t.itemOf("Fleet");
  assert.equal(item.dataset.dragging, "true");
  assert.equal(item.style.translate, "300px 0", "the tab follows the pointer");
  const line = listOf(t).querySelector(".ts-drop");
  assert.ok(line, "a line shows the place");
  assert.equal(line.style.left, "508px", "before Sessions: after Plans and Worktrees, which the pointer has passed the middle of");
  assert.equal(line.getAttribute("aria-hidden"), "true");
  pointer(t, "pointerup", 450);
  assert.deepEqual(order(t), ["workspace", "plans", "worktrees", "fleet", "explorer"]);
  assert.equal(listOf(t).querySelector(".ts-drop"), null, "the line goes");
  assert.equal(t.itemOf("Fleet").dataset.dragging, undefined);
  assert.equal(t.itemOf("Fleet").style.translate, "");
  assert.equal(t.document.querySelector(".ts-live").textContent, "Moved Fleet to position 4 of 5");
  // the click the browser sends after the button comes up does nothing
  const before = t.tabs.active();
  await t.click(tabNode(t, "fleet"));
  assert.equal(t.tabs.active(), before, "that click was the end of the drag");
  await t.click(tabNode(t, "fleet"));
  assert.equal(t.tabs.active(), idOf(t, "fleet"), "the next one is a click");
  assert.deepEqual(t.itemOf("Fleet").parentNode === listOf(t), true);
});

test("a drag to the left works the same way, and a drag that ends where it began moves nothing", async () => {
  const t = await roomy();
  await tabNode(t, "explorer").trigger("pointerdown", { button: 0, clientX: 600 });
  pointer(t, "pointermove", 120);
  assert.equal(listOf(t).querySelector(".ts-drop").style.left, "88px", "at the left edge of the first tab after Home");
  pointer(t, "pointerup", 120);
  assert.deepEqual(order(t), ["workspace", "explorer", "fleet", "plans", "worktrees"]);
  await t.settle(); // the strip repaints on the next frame: Sessions 88-228, Fleet 228-368, Plans 368-508
  await tabNode(t, "plans").trigger("pointerdown", { button: 0, clientX: 440 });
  pointer(t, "pointermove", 460);
  pointer(t, "pointerup", 460);
  assert.deepEqual(order(t), ["workspace", "explorer", "fleet", "plans", "worktrees"], "not past its neighbours' middles");
});

test("Escape and a cancelled pointer put a dragged tab back; a press on the × or with another button starts nothing; Home does not drag", async () => {
  const t = await roomy();
  const start = order(t);
  await tabNode(t, "fleet").trigger("pointerdown", { button: 0, clientX: 150 });
  pointer(t, "pointermove", 500);
  assert.ok(listOf(t).querySelector(".ts-drop"));
  const escape = { type: "keydown", key: "Escape", preventDefault() { escape.prevented = true; }, stopPropagation() {} };
  t.window.dispatchEvent(escape);
  assert.equal(escape.prevented, true, "Escape is the drag's, not the page's");
  assert.equal(listOf(t).querySelector(".ts-drop"), null);
  assert.equal(t.itemOf("Fleet").style.translate, "");
  pointer(t, "pointerup", 500);
  assert.deepEqual(order(t), start, "letting go afterwards does nothing");
  await tabNode(t, "fleet").trigger("pointerdown", { button: 0, clientX: 150 });
  pointer(t, "pointermove", 500);
  pointer(t, "pointercancel", 500);
  pointer(t, "pointerup", 500);
  assert.deepEqual(order(t), start, "a cancelled pointer (a touch taken by the system) is the same");
  await t.itemOf("Fleet").querySelector(".ts-close").trigger("pointerdown", { button: 0, clientX: 210 });
  pointer(t, "pointermove", 500); pointer(t, "pointerup", 500);
  assert.deepEqual(order(t), start, "the × is not a handle");
  await tabNode(t, "fleet").trigger("pointerdown", { button: 2, clientX: 150 });
  pointer(t, "pointermove", 500, { button: 2 }); pointer(t, "pointerup", 500, { button: 2 });
  assert.deepEqual(order(t), start, "only the primary button drags");
  await tabNode(t, "workspace").trigger("pointerdown", { button: 0, clientX: 40 });
  pointer(t, "pointermove", 500); pointer(t, "pointerup", 500);
  assert.deepEqual(order(t), start, "Home stays where it is");
  assert.equal(t.itemOf("Home").dataset.dragging, undefined);
});

test("a tab is dragged only among its own kind: pins among pins, the rest among the rest", async () => {
  const t = await roomy();
  t.tabs.pin(idOf(t, "fleet"), true); await t.settle(); t.measure({ width: 1400 });
  assert.deepEqual(order(t), ["workspace", "fleet", "plans", "worktrees", "explorer"]);
  // Plans (first of the rest) dragged to the far left: it cannot go in front of a pin
  await tabNode(t, "plans").trigger("pointerdown", { button: 0, clientX: 300 });
  pointer(t, "pointermove", 10);
  pointer(t, "pointerup", 10);
  assert.deepEqual(order(t), ["workspace", "fleet", "plans", "worktrees", "explorer"]);
  // a pin dragged to the far right stays before the rest
  await tabNode(t, "fleet").trigger("pointerdown", { button: 0, clientX: 120 });
  pointer(t, "pointermove", 900);
  pointer(t, "pointerup", 900);
  assert.deepEqual(order(t), ["workspace", "fleet", "plans", "worktrees", "explorer"]);
  // arranging a preview tab keeps it
  await t.go("tasks");
  assert.equal(t.itemOf("Tasks").dataset.preview, "true");
  t.measure({ width: 1400 });
  await tabNode(t, "tasks").trigger("pointerdown", { button: 0, clientX: 660 });
  pointer(t, "pointermove", 300); pointer(t, "pointerup", 300);
  await t.settle();
  assert.deepEqual(order(t), ["workspace", "fleet", "plans", "tasks", "worktrees", "explorer"]);
  assert.equal(t.itemOf("Tasks").dataset.preview, undefined, "a tab you arrange is a tab you want");
});

test("stopping the strip in the middle of a drag leaves nothing listening", async () => {
  const t = await roomy();
  await tabNode(t, "fleet").trigger("pointerdown", { button: 0, clientX: 150 });
  pointer(t, "pointermove", 500);
  t.tabs.stop();
  assert.equal(t.env.listeners("pointermove"), 0);
  assert.equal(t.env.listeners("pointerup"), 0);
  assert.equal(t.env.listeners("pointercancel"), 0);
  assert.equal(t.env.listeners("keydown"), 0, "and no key handler either");
});

// ---- the tab's menu ---------------------------------------------------------------------------------------------------------
const openTabMenu = async (t, title, at = { clientX: 300, clientY: 50 }) => {
  const event = { ...at, preventDefault() { event.prevented = true; } };
  await t.itemOf(title).trigger("contextmenu", event);
  return event;
};

test("a right-click opens the tab's menu at the pointer: what can be done to that tab, and the key for each", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans"); page(t, "worktrees");
  await t.settle();
  const event = await openTabMenu(t, "Plans");
  assert.equal(event.prevented, true, "the browser's own menu does not cover it");
  const pop = t.popover();
  assert.equal(pop.getAttribute("role"), "menu");
  assert.equal(pop.getAttribute("aria-label"), "Tab: Plans");
  assert.deepEqual([pop.style.left, pop.style.top], ["300px", "50px"], "at the pointer");
  assert.deepEqual(labelsOf(menuItems(t)), ["Pin", "Move left", "Move right", "Close", "Close other tabs", "Close tabs to the right", "Close all but pinned", "Reopen a closed tab", "Tab behaviour"]);
  assert.equal(menuAct(t, "pin").querySelector(".ts-key").textContent, "Ctrl Alt P");
  assert.equal(menuAct(t, "close").querySelector(".ts-key").textContent, "Ctrl W");
  assert.equal(menuAct(t, "reopen").querySelector(".ts-key").textContent, "Ctrl Shift T");
  assert.equal(menuItems(t).every((node) => node.getAttribute("role") === "menuitem" && node.type === "button"), true);
  assert.equal(pop.querySelectorAll("hr").every((line) => line.getAttribute("aria-hidden") === "true"), true, "separators say nothing");
  assert.equal(t.document.activeElement, menuItems(t)[0], "focus is on the first item, so the keyboard can carry on");
});

test("Pin, Unpin, Keep open, Move left and Move right do what they say; the ends of a group cannot move past it", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans");
  await t.go("worktrees");
  await t.settle();
  await openTabMenu(t, "Worktrees");
  assert.deepEqual(menuItems(t).map((node) => node.dataset.act), ["pin", "keep", "left", "right", "close", "others", "to-the-right", "all", "reopen", "behaviour"], "a preview offers Keep open too");
  assert.equal(menuAct(t, "keep").querySelector(".ts-key").textContent, "Double-click");
  assert.equal(menuAct(t, "right").disabled, true, "last: nothing to the right");
  assert.equal(menuAct(t, "left").disabled, false);
  assert.equal(menuAct(t, "to-the-right").disabled, true);
  await menuAct(t, "keep").click();
  assert.equal(t.tabs.list().find((tab) => tab.route.id === "worktrees").prev, false);
  await openTabMenu(t, "Worktrees");
  assert.equal(menuAct(t, "keep"), undefined, "nothing to keep once it is kept");
  await menuAct(t, "left").click();
  assert.deepEqual(order(t), ["workspace", "fleet", "worktrees", "plans"]);
  await openTabMenu(t, "Worktrees");
  await menuAct(t, "left").click();
  assert.deepEqual(order(t), ["workspace", "worktrees", "fleet", "plans"]);
  await openTabMenu(t, "Worktrees");
  assert.equal(menuAct(t, "left").disabled, true, "first: nothing to the left");
  await menuAct(t, "pin").click();
  assert.equal(t.tabs.list().find((tab) => tab.route.id === "worktrees").pin, true);
  assert.match(t.toasts.at(-1).message, /^Pinned “Worktrees”\. It stays at the left and never closes by itself\.$/);
  await t.settle();
  await openTabMenu(t, "Worktrees");
  assert.equal(menuAct(t, "pin").querySelector(".ts-menulabel").textContent, "Unpin", "the same item undoes it");
  await menuAct(t, "pin").click();
  assert.equal(t.tabs.list().find((tab) => tab.route.id === "worktrees").pin, false);
  assert.match(t.toasts.at(-1).message, /^Unpinned “Worktrees”\.$/);
});

test("Close, Close other tabs, Close tabs to the right and Close all but pinned leave the pinned ones, and what closed can come back", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans"); page(t, "worktrees"); page(t, "explorer"); page(t, "agents");
  t.tabs.pin(idOf(t, "fleet"), true);
  await t.settle();
  await openTabMenu(t, "Plans");
  await menuAct(t, "to-the-right").click();
  assert.deepEqual(order(t), ["workspace", "fleet", "plans"], "everything after it, and not the pin before it");
  assert.equal(t.tabs.active(), idOf(t, "plans"), "the tab you used it on is the one showing");
  await t.settle();
  t.tabs.restore(0); t.tabs.restore(0); await t.settle(); // agents and explorer come back
  assert.deepEqual(order(t), ["workspace", "fleet", "plans", "agents", "explorer"], "the newest closed first, each beside the tab you were on");
  await openTabMenu(t, "Plans");
  await menuAct(t, "others").click();
  assert.deepEqual(order(t), ["workspace", "fleet", "plans"], "only Home, the pin and the one you chose");
  assert.match(t.toasts.at(-1).message, /^Closed 2 other tabs\. Pinned tabs stay\. Ctrl Shift T brings one back\.$/);
  await t.settle();
  await openTabMenu(t, "Plans");
  await menuAct(t, "all").click();
  assert.deepEqual(order(t), ["workspace", "fleet"], "all but pinned");
  assert.match(t.toasts.at(-1).message, /^Closed 1 tab\. Pinned tabs stay\./);
  assert.equal(t.tabs.active(), "home", "with nothing left to stay on, Home");
  await t.settle();
  await openTabMenu(t, "Fleet");
  assert.equal(menuAct(t, "all").disabled, true, "nothing unpinned: nothing to close");
  assert.equal(menuAct(t, "others").disabled, true);
  assert.equal(menuAct(t, "to-the-right").disabled, true);
  await menuAct(t, "reopen").click();
  assert.equal(order(t).includes("plans"), true, "Reopen a closed tab puts the newest back");
  await t.settle();
  await openTabMenu(t, "Plans");
  await menuAct(t, "close").click();
  assert.equal(order(t).includes("plans"), false);
});

test("Home's menu has no Pin, Move or Close, and Tab behaviour opens the card", async () => {
  const t = await tabsEnv();
  page(t, "fleet");
  await t.settle();
  await openTabMenu(t, "Home");
  assert.deepEqual(menuItems(t).map((node) => node.dataset.act), ["others", "to-the-right", "all", "reopen", "behaviour"]);
  await menuAct(t, "behaviour").click();
  const pop = t.popover();
  assert.equal(pop.id, "mefi-tabs-pop-behaviour");
  assert.equal(pop.getAttribute("role"), "dialog");
  assert.ok(pop.querySelector(".ts-card"), "the same card Configuration shows");
});

test("a menu opens with the first item in focus and ↑ ↓ Home End move through the enabled ones, wrapping; Escape closes it and gives focus back", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans"); page(t, "worktrees");
  await t.settle();
  await t.itemOf("Fleet").querySelector(".ts-tab").trigger("keydown", { key: "ContextMenu", preventDefault() {} });
  const pop = t.popover();
  const items = () => menuItems(t).filter((node) => !node.disabled);
  assert.equal(t.document.activeElement, items()[0]);
  await press(items()[0], "ArrowDown"); assert.equal(t.document.activeElement, items()[1]);
  await press(items()[1], "End"); assert.equal(t.document.activeElement, items().at(-1));
  await press(items().at(-1), "ArrowDown"); assert.equal(t.document.activeElement, items()[0], "wraps");
  await press(items()[0], "ArrowUp"); assert.equal(t.document.activeElement, items().at(-1), "both ways");
  await press(items().at(-1), "Home"); assert.equal(t.document.activeElement, items()[0]);
  const seen = await press(items()[0], "Escape");
  assert.equal(seen.prevented, true);
  assert.equal(t.popover(), null);
  assert.equal(t.document.activeElement, tabNode(t, "fleet"), "focus goes back to the tab it came from");
  assert.equal(pop.parentNode, null, "and the menu is gone from the page");
});

test("a menu closes when you click or move focus elsewhere, when a page opens, and only one is open at a time", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans");
  await t.settle();
  await openTabMenu(t, "Fleet");
  t.window.dispatchEvent({ type: "pointerdown", target: t.popover().querySelector(".ts-menuitem") });
  assert.ok(t.popover(), "a press inside it does not close it");
  t.window.dispatchEvent({ type: "pointerdown", target: t.document.body });
  assert.equal(t.popover(), null, "a press outside does");
  await openTabMenu(t, "Fleet");
  t.window.dispatchEvent({ type: "focusin", target: t.document.body });
  assert.equal(t.popover(), null, "and so does focus going elsewhere");
  await openTabMenu(t, "Fleet");
  await t.go("worktrees");
  assert.equal(t.popover(), null, "opening a page closes it");
  await openTabMenu(t, "Fleet");
  const first = t.popover();
  await t.click(t.document.querySelector("#mefi-tabs-add"));
  assert.equal(t.document.querySelectorAll(".ts-pop").length, 1, "one at a time");
  assert.equal(first.parentNode, null);
  await t.click(t.document.querySelector("#mefi-tabs-add"));
  assert.equal(t.popover(), null, "the button that opened a menu closes it again");
  assert.equal(t.document.querySelector("#mefi-tabs-add").getAttribute("aria-expanded"), "false");
});

// ---- the Add menu -----------------------------------------------------------------------------------------------------------
const addBox = (t) => t.popover().querySelector("#mefi-tabs-search");
async function typeIn(t, text) { const box = addBox(t); box.value = text; await box.trigger("input"); }
const groupsOf = (t) => t.popover().querySelectorAll(".ts-group").map((node) => node.textContent);
const hintOf = (t, label) => t.popover().querySelectorAll(".ts-row").find((row) => row.querySelector(".ts-rowlabel").textContent === label)?.querySelector(".ts-rowhint").textContent;
async function openAdd(t) { await t.click(t.document.querySelector("#mefi-tabs-add")); return t.popover(); }

test("the Add menu lists the places the registry offers, this project's sessions and what was closed, each under a heading", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Add dark mode", updatedAt: 3000 }), task("b", { title: "Fix login", updatedAt: 2000 }), task("c", { title: "Shelved", archived: true }), task("d", { title: "Done long ago", status: "archived" })] });
  page(t, "plans"); page(t, "fleet");
  t.tabs.close(idOf(t, "plans"));
  await t.settle();
  const pop = await openAdd(t);
  assert.equal(pop.id, "mefi-tabs-pop-add");
  assert.equal(pop.getAttribute("role"), "dialog");
  assert.equal(pop.getAttribute("aria-label"), "Open a tab");
  // In the 0.5 layout Home is Work › Today (renderer/nav.js placeOf), so it leads Work's rows rather than a group of its own.
  assert.deepEqual(groupsOf(t), ["Recently closed", "Work", "Sessions", "Agents", "Settings"], "in the order the app's own places go");
  assert.deepEqual(rowsOf(t), [
    "Plans", // recently closed
    "Home", "Tasks", "Plans", "Worktrees",
    "Add dark mode", "Fix login", // newest first; archived ones are not offered
    "Command", "Fleet", "Sessions", "Agents", "Catalog", "Performance",
    "Settings",
  ]);
  for (const hidden of ["Vibe", "Search", "Configuration", "Friends", "Appearance", "Hidden", "Shelved", "Done long ago"]) assert.equal(rowsOf(t).includes(hidden), false, `${hidden} is not a place a tab can be`);
  assert.ok(pop.querySelectorAll(".ts-row")[0].querySelector("svg"), "a closed page has its glyph in the list, like every other row");
  assert.equal(hintOf(t, "Fleet"), "Open", "what already has a tab says so");
  assert.equal(hintOf(t, "Home"), "Pinned", "Home is always pinned");
  assert.equal(hintOf(t, "Worktrees"), "");
  assert.equal(pop.querySelectorAll(".ts-row")[0].querySelector(".ts-rowhint").textContent, "Reopen");
  const box = addBox(t);
  assert.equal(t.document.activeElement, box, "the search box has focus");
  assert.equal(box.getAttribute("role"), "combobox");
  assert.equal(box.getAttribute("aria-controls"), "mefi-tabs-rows");
  assert.equal(box.getAttribute("aria-autocomplete"), "list");
  assert.equal(box.getAttribute("aria-activedescendant"), "mefi-tabs-row-0");
  assert.equal(t.popover().querySelector("#mefi-tabs-rows").getAttribute("role"), "listbox");
  const options = pop.querySelectorAll(".ts-row");
  assert.equal(options.every((row) => row.getAttribute("role") === "option"), true);
  assert.deepEqual(options.map((row) => row.getAttribute("aria-selected")).filter((value) => value === "true").length, 1, "one row is selected");
  assert.ok(pop.querySelector(".ts-foot").textContent.includes("Shift+Enter"), "the footer says what the keys do");
});

test("typing narrows the list (titles, headings and the registry's own search words); Recently closed is left out while searching", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Add dark mode", prompt: "Switch the theme" }), task("b", { title: "Fix login" })] });
  page(t, "plans"); t.tabs.close(idOf(t, "plans"));
  await t.settle();
  await openAdd(t);
  await typeIn(t, "dark");
  assert.deepEqual(rowsOf(t), ["Add dark mode"]);
  await typeIn(t, "theme");
  assert.deepEqual(rowsOf(t), ["Add dark mode"], "the task's own words count");
  await typeIn(t, "checkout");
  assert.deepEqual(rowsOf(t), ["Worktrees"], "the registry's search words count");
  await typeIn(t, "work");
  assert.deepEqual(rowsOf(t), ["Home", "Tasks", "Plans", "Worktrees"], "and the heading: everything under Work, Today (here Home) first");
  await typeIn(t, "work tree");
  assert.deepEqual(rowsOf(t), ["Worktrees"], "every word has to match");
  await typeIn(t, "plans");
  assert.deepEqual(rowsOf(t), ["Plans"], "the closed Plans is not listed twice");
  await typeIn(t, "zzzz");
  assert.deepEqual(rowsOf(t), []);
  assert.equal(t.popover().querySelector(".ts-empty").querySelector("b").textContent, "Nothing matches");
  assert.equal(addBox(t).getAttribute("aria-activedescendant"), "", "and nothing is active");
  await typeIn(t, "");
  assert.equal(rowsOf(t)[0], "Plans", "clearing the box brings Recently closed back");
});

test("arrows move through the rows and wrap; Enter opens the row as a tab of its own, Shift+Enter opens and pins it", async () => {
  const t = await tabsEnv();
  await openAdd(t);
  const selected = () => t.popover().querySelectorAll(".ts-row").findIndex((row) => row.getAttribute("aria-selected") === "true");
  assert.equal(selected(), 0);
  await press(addBox(t), "ArrowDown"); assert.equal(selected(), 1);
  assert.equal(addBox(t).getAttribute("aria-activedescendant"), "mefi-tabs-row-1");
  await press(addBox(t), "ArrowUp"); await press(addBox(t), "ArrowUp");
  assert.equal(selected(), t.popover().querySelectorAll(".ts-row").length - 1, "wraps to the last");
  await typeIn(t, "fleet");
  const seen = await press(addBox(t), "Enter");
  assert.equal(seen.prevented, true);
  assert.equal(t.popover(), null, "the menu closes");
  const fleet = t.tabs.list().find((tab) => tab.route.id === "fleet");
  assert.ok(fleet);
  assert.equal(fleet.prev, false, "a tab you chose from a list is a tab, not a preview");
  assert.equal(fleet.pin, false);
  assert.equal(fleet.active, true);
  assert.equal(t.nav.current(), "fleet");
  await t.settle();
  await openAdd(t);
  await typeIn(t, "worktrees");
  await press(addBox(t), "Enter", { shiftKey: true });
  const worktrees = t.tabs.list().find((tab) => tab.route.id === "worktrees");
  assert.equal(worktrees.pin, true, "Shift+Enter pins it");
  assert.equal(worktrees.scope, "global", "a page pin follows you into every project");
  assert.equal(t.nav.current(), "worktrees");
});

test("a click on a row does the same, Shift-click pins; a row that is already a tab just goes to it", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Add dark mode" })] });
  page(t, "fleet");
  await t.settle();
  await openAdd(t);
  const row = (label) => t.popover().querySelectorAll(".ts-row").find((node) => node.querySelector(".ts-rowlabel").textContent === label);
  await row("Add dark mode").trigger("click", { shiftKey: true });
  const made = t.tabs.list().find((tab) => tab.route.params.taskId === "a");
  assert.equal(made.pin, true, "Shift-click pins a session too");
  assert.equal(made.scope, "project", "but a session's pin stays with its project");
  await t.settle();
  await openAdd(t);
  await row("Home").trigger("click", {});
  assert.equal(t.tabs.active(), "home", "Home is a row too");
  await t.settle();
  const count = t.tabs.list().length;
  await openAdd(t);
  await row("Fleet").trigger("click", {});
  assert.equal(t.tabs.list().length, count, "no second tab for a place that has one");
  assert.equal(t.tabs.active(), idOf(t, "fleet"));
});

test("a closed tab is reopened from the Add menu, and leaves the list", async () => {
  const t = await tabsEnv();
  page(t, "plans"); page(t, "fleet");
  t.tabs.close(idOf(t, "plans"));
  await t.settle();
  await openAdd(t);
  assert.equal(t.popover().querySelectorAll(".ts-row")[0].querySelector(".ts-rowlabel").textContent, "Plans");
  await t.popover().querySelectorAll(".ts-row")[0].trigger("click", {});
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "plans"), true);
  assert.equal(t.tabs.recentlyClosed().length, 0, "it is not closed any more");
});

test("Escape closes the Add menu and gives focus back to the button", async () => {
  const t = await tabsEnv();
  const button = t.document.querySelector("#mefi-tabs-add");
  button.focus();
  await openAdd(t);
  assert.notEqual(t.document.activeElement, button);
  const seen = await press(addBox(t), "Escape");
  assert.equal(seen.prevented, true);
  assert.equal(t.popover(), null);
  assert.equal(t.document.activeElement, button);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(button.getAttribute("aria-haspopup"), "dialog");
  assert.equal(button.getAttribute("aria-label"), "Open a tab");
  assert.match(button.title, /Ctrl\+T/, "and the button says the key");
});

test("the Add menu sees the session list as it is now, and another project's sessions are not in it", async () => {
  const t = await tabsEnv({ tasks: [task("a", { title: "Mine" })] });
  t.board.tasks = [task("a", { title: "Mine" }), task("n", { title: "Brand new" })];
  await openAdd(t);
  assert.equal(rowsOf(t).includes("Mine"), true);
  assert.equal(rowsOf(t).includes("Brand new"), true, "a session made a moment ago is there");
  await press(addBox(t), "Escape");
  t.board.projectId = "p2"; t.board.tasks = [task("z", { title: "Theirs" })];
  t.window.dispatchEvent({ type: "mefi:project-changed", detail: { projectId: "p2" } });
  await t.settle();
  await openAdd(t);
  assert.equal(rowsOf(t).includes("Mine"), false);
  assert.equal(rowsOf(t).includes("Theirs"), true);
});

// ---- the pin suggestion's chip ----------------------------------------------------------------------------------------------
test("a suggestion nobody could see is not used up: no chip in the one-menu strip or with the strip hidden, and it is offered once it can be seen", async () => {
  const t = await tabsEnv();
  t.window.innerWidth = 700; t.window.dispatchEvent({ type: "resize" });
  for (let i = 0; i < 3; i += 1) { await t.go("fleet"); await t.go("plans"); }
  const chip = () => t.strip().querySelector(".ts-suggest");
  assert.equal(chip().hidden, true, "narrow: the strip is a menu, there is no room for a chip");
  t.tabs.flush();
  assert.deepEqual(t.stored("mefiStudio.tabs.global.v1").offered, {}, "and nothing has been offered");
  t.window.innerWidth = 1400; t.window.dispatchEvent({ type: "resize" }); await t.settle();
  assert.equal(chip().hidden, false, "wide again: Plans, the page that is showing and has been visited three times, is offered");
  assert.equal(chip().getAttribute("role"), "group");
  assert.equal(chip().getAttribute("aria-label"), "Suggestion");
  assert.equal(chip().querySelector(".ts-suggest-text").textContent, "Pin Plans?");
  assert.equal(t.document.querySelector(".ts-live").textContent, "Pin Plans?", "said once to a screen reader");
  assert.equal(chip().querySelector(".ts-suggest-no").getAttribute("aria-label"), "Not now");
  t.tabs.flush();
  assert.deepEqual(t.stored("mefiStudio.tabs.global.v1").offered, { plans: 1 }, "it was seen, so it is used up");
  await t.go("fleet");
  assert.equal(chip().querySelector(".ts-suggest-text").textContent, "Pin Fleet?", "Fleet was never seen with a chip, so it gets its turn");
  t.tabs.hide(); await t.settle();
  assert.equal(chip().hidden, true, "a strip that is hidden asks nothing");
});

// ---- Tab behaviour ------------------------------------------------------------------------------------------------------------
const switchOf = (card, key) => card.querySelectorAll("input").find((input) => input.dataset.key === key);
const choiceOf = (card, key) => card.querySelectorAll(".ts-choice").find((button) => button.dataset.key === key);
async function flip(card, key, on) { const input = switchOf(card, key); input.checked = on; await input.trigger("change"); }
const PREFS = "mefiStudio.tabs.prefs.v1";

test("the card: one master switch, then each thing Studio does on its own with its switch, in the words the owner will read", async () => {
  const t = await tabsEnv();
  const card = t.tabs.configCard();
  assert.equal(card.tagName.toLowerCase(), "section");
  assert.equal(card.getAttribute("aria-label"), "Tab behaviour");
  assert.equal(card.querySelector("h4").textContent, "Tab behaviour");
  assert.deepEqual(card.querySelectorAll("input").map((input) => input.dataset.key), ["manage", "preview", "suggest"]);
  for (const input of card.querySelectorAll("input")) {
    assert.equal(input.type, "checkbox");
    assert.equal(input.getAttribute("role"), "switch");
    assert.equal(input.checked, true, "on by default, as the owner asked");
    assert.ok(input.parentNode.classList.contains("switch"), "the app's own switch");
    assert.ok(input.parentNode.querySelector(".track"), "with its track");
    assert.ok(input.parentNode.querySelector("b").textContent.length > 3, "and a name");
  }
  assert.deepEqual(card.querySelectorAll(".ts-choices").map((group) => group.getAttribute("aria-label")), ["When an agent needs me", "Close finished sessions after"]);
  assert.deepEqual(card.querySelectorAll(".ts-choices").map((group) => group.getAttribute("role")), ["radiogroup", "radiogroup"]);
  const checked = (group) => group.querySelectorAll(".ts-choice").filter((button) => button.getAttribute("aria-checked") === "true").map((button) => button.textContent);
  assert.deepEqual(checked(card.querySelectorAll(".ts-choices")[0]), ["Background tab"], "badge and a background tab: the default");
  assert.deepEqual(checked(card.querySelectorAll(".ts-choices")[1]), ["30 min"]);
  assert.equal(card.querySelector(".ts-stepvalue").textContent, "8");
  assert.match(card.textContent, /Keep at most 8 tabs open/);
  assert.match(card.textContent, /Nothing closed yet/);
  assert.equal(card.querySelectorAll(".ts-keyline").length, 6, "and the keys, so they can be found");
  assert.equal(t.document.querySelector("#mefi-tabs-cfg") !== null, true, "the strip has its own way in, too");
});

test("every switch on the card is a setting: it changes what Studio does, is saved, and is what comes back next launch", async () => {
  const storage = new Map();
  const t = await tabsEnv({ storage });
  const card = t.tabs.configCard();
  await flip(card, "preview", false);
  assert.equal(t.tabs.prefs().preview, false);
  await t.go("fleet"); await t.go("plans");
  assert.equal(t.tabs.list().filter((tab) => tab.prev).length, 0, "with the preview switch off, a page is a tab of its own");
  await flip(card, "suggest", false);
  assert.equal(t.tabs.prefs().suggest, false);
  await choiceOf(card, "agent:badge").click();
  assert.equal(t.tabs.prefs().agent, "badge");
  assert.match(card.textContent, /Its tab, if one is open, gets a badge\. Nothing opens\./, "and the note under it follows");
  assert.equal(choiceOf(card, "agent:badge").getAttribute("aria-checked"), "true");
  assert.equal(choiceOf(card, "agent:bg").getAttribute("aria-checked"), "false");
  await choiceOf(card, "idle:10").click();
  assert.equal(t.tabs.prefs().idle, 10);
  await choiceOf(card, "idle:0").click();
  assert.equal(t.tabs.prefs().idle, 0, "Never");
  await card.querySelectorAll("button").find((button) => button.dataset.key === "cap:-").click();
  assert.equal(t.tabs.prefs().cap, 7);
  assert.equal(card.querySelector(".ts-stepvalue").textContent, "7");
  assert.match(card.textContent, /Keep at most 7 tabs open/);
  await card.querySelectorAll("button").find((button) => button.dataset.key === "cap:+").click();
  await card.querySelectorAll("button").find((button) => button.dataset.key === "cap:+").click();
  assert.equal(t.tabs.prefs().cap, 9);
  assert.deepEqual(t.stored(PREFS), { v: 1, manage: true, preview: false, suggest: false, agent: "badge", idle: 0, cap: 9 }, "written as they change");
  const next = await tabsEnv({ storage });
  assert.deepEqual({ ...next.tabs.prefs() }, { manage: true, preview: false, suggest: false, agent: "badge", idle: 0, cap: 9, forcedOff: false }, "and back on the next launch");
  assert.equal(next.tabs.configCard().querySelector(".ts-stepvalue").textContent, "9");
});

test("the stepper runs from 3 to 12, one more step is no limit, and the minus comes back down", async () => {
  const t = await tabsEnv();
  const card = t.tabs.configCard();
  const minus = () => card.querySelectorAll("button").find((button) => button.dataset.key === "cap:-");
  const plus = () => card.querySelectorAll("button").find((button) => button.dataset.key === "cap:+");
  const value = () => card.querySelector(".ts-stepvalue").textContent;
  for (let i = 0; i < 12; i += 1) if (!minus().disabled) await minus().click();
  assert.equal(t.tabs.prefs().cap, 3);
  assert.equal(minus().disabled, true, "nothing fewer than three");
  assert.equal(plus().disabled, false);
  for (let i = 0; i < 9; i += 1) await plus().click();
  assert.equal(t.tabs.prefs().cap, 12);
  assert.equal(value(), "12");
  assert.equal(plus().getAttribute("aria-label"), "No limit", "the last step says where it goes");
  assert.equal(minus().getAttribute("aria-label"), "Fewer tabs");
  await plus().click();
  assert.equal(t.tabs.prefs().cap, 0, "past 12 is no limit");
  assert.equal(value(), "No limit");
  assert.match(card.textContent, /Keep as many tabs open as you like/);
  assert.match(card.textContent, /No tab is closed to make room/);
  assert.equal(plus().disabled, true);
  assert.equal(minus().disabled, false, "and the minus comes back");
  await minus().click();
  assert.equal(t.tabs.prefs().cap, 12);
  assert.equal(value(), "12");
  assert.match(card.textContent, /Keep at most 12 tabs open/);
  assert.equal(plus().getAttribute("aria-label"), "No limit");
  await minus().click();
  assert.equal(plus().getAttribute("aria-label"), "More tabs");
});

test("the master switch turns every behaviour off at once and leaves a plain strip; turning it back on gives them back", async () => {
  const t = await tabsEnv();
  const card = t.tabs.configCard();
  await flip(card, "manage", false);
  assert.equal(t.tabs.prefs().manage, false);
  assert.equal(card.querySelector(".ts-card-body").dataset.off, "true");
  const dependents = [...card.querySelector(".ts-card-body").querySelectorAll("input"), ...card.querySelector(".ts-card-body").querySelectorAll("button")];
  assert.ok(dependents.length >= 8);
  assert.equal(dependents.every((node) => node.disabled), true, "what it governs cannot be set while it is off");
  assert.equal(switchOf(card, "manage").disabled, false, "but the master can be turned on");
  await t.go("fleet"); await t.go("plans");
  assert.equal(t.tabs.list().some((tab) => tab.prev), false, "no preview tab");
  await flip(card, "manage", true);
  assert.equal(card.querySelector(".ts-card-body").dataset.off, "false");
  assert.equal(card.querySelector(".ts-card-body").querySelectorAll("button").some((node) => node.disabled && !/cap:/.test(node.dataset.key || "")), false);
});

test("when the host turns tab management off for this run the card says so, and the master switch cannot turn it back on", async () => {
  const t = await tabsEnv({ host: { prefsGet: async () => ({ prefs: { tabsManage: false } }) } });
  await t.settle();
  assert.equal(t.tabs.prefs().forcedOff, true);
  const card = t.tabs.configCard();
  const master = switchOf(card, "manage");
  assert.equal(master.checked, false);
  assert.equal(master.disabled, true);
  assert.match(card.textContent, /MEFI_STUDIO_NO_TAB_MANAGER/);
  assert.equal(card.querySelector(".ts-card-body").dataset.off, "true");
});

test("Recently closed is on the card with a Reopen for each, up to four", async () => {
  const t = await tabsEnv();
  for (const id of ["fleet", "plans", "worktrees", "explorer", "agents"]) { page(t, id); t.tabs.close(idOf(t, id)); }
  const card = t.tabs.configCard();
  const rows = card.querySelectorAll(".ts-closedrow");
  assert.equal(rows.length, 4, "the newest four");
  assert.deepEqual(rows.map((row) => row.querySelector(".ts-closedlabel").textContent), ["Agents", "Sessions", "Worktrees", "Plans"]);
  await rows[1].querySelector(".ts-reopen").click();
  assert.equal(t.tabs.list().some((tab) => tab.route.id === "explorer"), true, "the one asked for comes back, not the newest");
  assert.deepEqual(card.querySelectorAll(".ts-closedrow").map((row) => row.querySelector(".ts-closedlabel").textContent), ["Agents", "Worktrees", "Plans", "Fleet"], "and the card follows");
});

test("the card repaints when the strip's state changes from elsewhere and keeps keyboard focus on the control it was on", async () => {
  const t = await tabsEnv();
  const card = t.tabs.configCard();
  t.document.body.append(card);
  const minus = () => card.querySelectorAll("button").find((button) => button.dataset.key === "cap:-");
  minus().focus();
  t.tabs.setPrefs({ cap: 5 }); // e.g. the same card open in the strip's own menu
  assert.equal(card.querySelector(".ts-stepvalue").textContent, "5", "the card follows");
  assert.equal(t.document.activeElement, minus(), "focus is where it was, on the new button");
  assert.equal(card.querySelectorAll("button").find((button) => button.dataset.key === "cap:-") === minus(), true);
  // a card that has left the page stops being repainted
  const gone = t.tabs.configCard();
  await t.settle();
  gone.isConnected = false;
  const before = gone.querySelector(".ts-stepvalue").textContent;
  t.tabs.setPrefs({ cap: 6 });
  assert.equal(gone.querySelector(".ts-stepvalue").textContent, before, "it is let go");
});

test("Tab behaviour opens from the strip's own button and from Search; Search falls back to Configuration when the strip is one menu", async () => {
  const t = await tabsEnv();
  const cfg = t.document.querySelector("#mefi-tabs-cfg");
  assert.equal(cfg.getAttribute("aria-label"), "Tab behaviour");
  await t.click(cfg);
  assert.equal(t.popover().id, "mefi-tabs-pop-behaviour");
  assert.ok(t.popover().querySelector(".ts-card"));
  await t.click(cfg);
  assert.equal(t.popover(), null, "the button toggles");
  const record = t.nav.registered.find((item) => item.id === "tabBehaviour");
  assert.ok(record, "a record so Search finds the card");
  assert.equal(record.kind, "action");
  assert.deepEqual({ ...record.showIn }, { palette: true });
  assert.match(record.searchTerms, /preview/);
  record.run();
  assert.equal(t.popover().id, "mefi-tabs-pop-behaviour", "from Search it opens where the tabs are");
  t.window.dispatchEvent({ type: "mefi:nav", detail: { id: "tabBehaviour", action: "open", params: {} } });
  assert.ok(t.popover(), "and the nav announcing the action it has just run does not close it again");
  t.window.dispatchEvent({ type: "mefi:nav", detail: { id: "palette", action: "open", params: {} } });
  assert.equal(t.popover(), null, "while any other page or layer opening does");
  t.tabs.stop(); t.tabs.start();
  const opened = [];
  t.window.MefiConfig = { open: (options) => opened.push(options) };
  t.window.innerWidth = 700; t.window.dispatchEvent({ type: "resize" }); await t.settle();
  t.nav.registered.at(-1).run();
  assert.deepEqual(plain(opened), [{ category: "ui" }], "and in a narrow window, in Configuration › UI & Surfaces");
});

test("configCard() is null when there is no strip: nothing is added to Configuration", async () => {
  const off = await tabsEnv({ layout: null });
  assert.equal(off.tabs.configCard(), null);
  const t = await tabsEnv();
  t.tabs.stop();
  assert.equal(t.tabs.configCard(), null);
});

test("the strip repaints in place: a tab's element survives a change, so focus and a drag in progress do too", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans");
  await t.settle();
  const fleet = tabNode(t, "fleet");
  fleet.focus();
  page(t, "worktrees"); t.tabs.pin(idOf(t, "plans"), true); t.tabs.move(idOf(t, "fleet"), 1);
  await t.settle();
  assert.equal(tabNode(t, "fleet"), fleet, "the same element");
  assert.equal(t.document.activeElement, fleet, "and it still has focus");
  assert.deepEqual(t.titles(), ["Home", "Plans", "Worktrees", "Fleet"], "pinned first, then the rest in the order they were moved to");
  t.tabs.close(idOf(t, "fleet"));
  await t.settle();
  assert.equal(fleet.closest(".ts-list"), null, "a closed tab's element is removed, not left hidden");
});

test("a hidden window paints nothing, and catches up when it is shown", async () => {
  const t = await tabsEnv();
  t.document.hidden = true;
  page(t, "fleet");
  await t.settle();
  assert.equal(t.titles().includes("Fleet"), false, "nothing is drawn for a window nobody can see");
  t.document.hidden = false;
  await t.document.body.trigger("visibilitychange");
  await t.settle();
  assert.equal(t.titles().includes("Fleet"), true, "and it is drawn when it is back");
});

// ---- the strip and the rest of the window ---------------------------------------------------------------------------------------
test("a change of the strip's own width is fitted again by the next frame, with no other trigger", async () => {
  const t = await crowded(1800);
  assert.equal(more(t).hidden, true, "everything fits");
  t.resizeTo(420);
  assert.equal(more(t).hidden, false, "the window got narrower: what does not fit folds");
  assert.ok(hiddenTitles(t).length >= 5);
  t.resizeTo(1800);
  assert.equal(more(t).hidden, true, "and wider: it comes back");
  assert.deepEqual(hiddenTitles(t), []);
});

test("with nothing that can fold, there is no 'more' button however little room there is", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); page(t, "plans");
  t.tabs.pin(idOf(t, "fleet"), true); t.tabs.pin(idOf(t, "plans"), true);
  await t.settle();
  t.measure({ width: 120 });
  assert.equal(more(t).hidden, true, "Home, two pins and the tab you are on are all there is");
  assert.deepEqual(hiddenTitles(t), []);
});

test("the Today board's count is followed while the strip runs, and let go of when it stops", async () => {
  let count = 0, heard = null, off = 0;
  const today = { count: () => count, onChange: (callback) => { heard = callback; return () => { off += 1; }; } };
  const t = await tabsEnv({ extras: { MefiToday: today } });
  assert.equal(t.itemOf("Today").querySelector(".ts-count").hidden, true);
  count = 3; heard(); t.frames();
  assert.equal(t.itemOf("Today").querySelector(".ts-count").textContent, "3", "the board said it changed: the badge follows, with no other trigger");
  t.tabs.stop();
  assert.equal(off, 1, "and stopping lets go of it");
});

test("openAddMenu() and openBehaviour() are the strip's own doors for other modules; a stopped strip has none", async () => {
  const t = await tabsEnv();
  t.tabs.openAddMenu();
  assert.equal(t.popover()?.id, "mefi-tabs-pop-add");
  t.tabs.openAddMenu();
  assert.equal(t.popover(), null, "the same door toggles");
  t.tabs.openBehaviour();
  assert.equal(t.popover()?.id, "mefi-tabs-pop-behaviour");
  await press(t.popover(), "Escape");
  t.tabs.stop();
  t.tabs.openAddMenu(); t.tabs.openBehaviour();
  assert.equal(t.popover(), null);
});

test("the small-window menu marks the preview tab, and the main area gets an id of its own when FRAME gave it none", async () => {
  const t = await tabsEnv();
  await t.go("fleet");
  t.window.innerWidth = 700; t.window.dispatchEvent({ type: "resize" }); await t.settle();
  await t.click(t.document.querySelector(".ts-menu"));
  const row = t.popover().querySelectorAll(".ts-menurow").find((node) => node.querySelector(".ts-menulabel").textContent === "Fleet");
  assert.equal(row.querySelector(".ts-menuitem").dataset.preview, "true", "the italic one, as on the strip");
  assert.match(t.popover().querySelector(".ts-group").textContent, /the italic one is a preview/);
  await press(t.popover(), "Escape");
  t.tabs.stop();
  t.regions.main.id = "";
  t.tabs.start(); await t.settle();
  assert.equal(t.regions.main.id, "mefi-tabpanel");
  assert.equal(t.document.querySelector(".ts-tab").getAttribute("aria-controls"), "mefi-tabpanel");
});

test("the Add menu lists sessions newest first, whether the board gives its times as numbers or as dates", async () => {
  const t = await tabsEnv({ tasks: [
    task("o", { title: "Oldest", updatedAt: "2026-09-01T10:00:00Z", createdAt: "2026-09-01T10:00:00Z" }),
    task("n", { title: "Newest", updatedAt: "2026-09-29T10:00:00Z", createdAt: "2026-09-29T10:00:00Z" }),
    task("m", { title: "Middle", updatedAt: Date.parse("2026-09-15T10:00:00Z") }),
  ] });
  await openAdd(t);
  const sessionsAt = rowsOf(t).indexOf("Newest");
  assert.deepEqual(rowsOf(t).slice(sessionsAt, sessionsAt + 3), ["Newest", "Middle", "Oldest"]);
});

test("the small-window button is not rebuilt by a repaint that changes nothing it shows, and follows where you are when something does", async () => {
  const t = await tabsEnv();
  page(t, "fleet"); await t.settle();
  const button = () => t.document.querySelector(".ts-menu");
  const before = button().querySelector(".ts-title");
  assert.equal(before.textContent, "Fleet");
  t.tabs.setPrefs({ cap: 9 }); t.window.dispatchEvent({ type: "mefi:workspace-state" }); await t.settle();
  assert.equal(button().querySelector(".ts-title"), before, "the same element: a change elsewhere did not touch it");
  page(t, "plans"); await t.settle();
  assert.equal(button().querySelector(".ts-title").textContent, "Plans");
  assert.equal(button().querySelector(".ts-count").textContent, "3");
  assert.match(button().getAttribute("aria-label"), /^Tabs, 3 open\. Current: Plans$/);
});
