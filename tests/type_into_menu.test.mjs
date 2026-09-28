// Typing goes to the open menu's box (renderer/nav.js, typeInto). A printable
// key pressed outside any field while a menu is open lands in that menu's
// text box instead of firing the single-letter keys that open other menus;
// clicking out of a popover gives the keys back. The whole of nav.js runs
// against the shared fake DOM, and handleKey is driven the way the window
// listener drives it.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8");

function load() {
  const { document, get } = createDom({ ids: ["workspace-layer"] });
  const lookupId = document.getElementById;
  document.getElementById = (id) => lookupId(id) ?? document.querySelector(`#${id}`);
  document.readyState = "loading";
  document.documentElement.dataset = {};
  document.createDocumentFragment = () => document.createElement("#fragment");
  const opened = [];
  const window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    MefiWorkspace: { isActive: () => true },
    MefiIdle: { isActive: () => false },
    MefiTasks: { open: () => opened.push("tasks") },
    MefiBooklet: { showTab() {} },
    MefiToast() {},
  };
  const context = vm.createContext({
    window, document, console,
    location: { search: "" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    URLSearchParams,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0,
  });
  vm.runInContext(source, context);
  // The fake DOM has no pointer: nothing is hovered unless a test says so.
  const hovered = new Set();
  const element = (tag, attrs = {}) => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    const matches = node.matches.bind(node);
    node.matches = (selector) => (selector === ":hover" ? hovered.has(node) : matches(selector));
    node.focus = () => { node.focused = true; document.activeElement = node; };
    node.setSelectionRange = (start, end) => { node.selection = [start, end]; };
    return node;
  };
  // What the window listener does with one key: the event as the page sees it.
  const press = (key, init = {}) => {
    const event = { key, target: document.activeElement ?? document.body, defaultPrevented: false, preventDefault() { event.defaultPrevented = true; }, stopPropagation() {}, ...init };
    window.MefiNav.handleKey(event);
    return event;
  };
  return { nav: window.MefiNav, document, get, element, hovered, press, opened };
}

test("a letter pressed inside a menu goes into its box, with the caret at the end", () => {
  const { nav, document, element, press, opened } = load();
  const menu = element("div", { "data-type-scope": "" });
  const heading = element("h3");
  const box = element("textarea");
  box.value = "draft";
  menu.append(heading, box);
  document.body.append(menu);
  heading.focus();
  const event = press("t");
  assert.equal(document.activeElement, box, "the caret moved into the menu's box");
  assert.deepEqual(box.selection, [5, 5], "after what was already typed");
  assert.equal(event.defaultPrevented, false, "the key is left for the browser to type into the box");
  assert.deepEqual(opened, [], "T did not open the Task board");
  assert.equal(typeof nav.typeInto, "function");
});

test("Shift letters and digits type too; Space, ?, chords and keys already taken stay shortcuts", () => {
  const { document, element, press } = load();
  const menu = element("div", { "data-type-scope": "" });
  const button = element("button");
  const box = element("input", { type: "search" });
  menu.append(button, box);
  document.body.append(menu);
  for (const [key, init, moves] of [
    ["T", { shiftKey: true }, true],
    ["4", {}, true],
    [" ", {}, false],
    ["?", {}, false],
    ["k", { ctrlKey: true }, false],
    ["a", { altKey: true }, false],
    ["Escape", {}, false],
    ["ArrowDown", {}, false],
    ["x", { defaultPrevented: true }, false],
    ["x", { isComposing: true }, false],
  ]) {
    button.focus();
    press(key, init);
    assert.equal(document.activeElement === box, moves, `${JSON.stringify(key)} ${JSON.stringify(init)}`);
  }
});

test("the pointer resting on a menu is enough; clicking out of it gives the keys back", () => {
  const { document, element, hovered, press, opened } = load();
  const menu = element("div", { "data-type-scope": "" });
  const box = element("input");
  menu.append(box);
  const elsewhere = element("button");
  document.body.append(menu, elsewhere);
  elsewhere.focus();
  press("t");
  assert.equal(document.activeElement, elsewhere, "focus and pointer both elsewhere: nothing is pulled in");
  assert.deepEqual(opened, ["tasks"], "so T is still the Task board's key");
  hovered.add(menu);
  press("h");
  assert.equal(document.activeElement, box, "resting the pointer on the menu is going to it");
});

test("the menu you are in beats one you are hovering, and the innermost menu wins", () => {
  const { document, element, hovered, press } = load();
  const outer = element("div", { "data-type-scope": "" });
  const outerBox = element("input");
  const inner = element("div", { "data-type-scope": "" });
  const innerBox = element("textarea");
  const innerButton = element("button");
  inner.append(innerButton, innerBox);
  outer.append(outerBox, inner);
  const other = element("div", { "data-type-scope": "" });
  const otherBox = element("input");
  other.append(otherBox);
  document.body.append(outer, other);
  hovered.add(other);
  innerButton.focus();
  press("a");
  assert.equal(document.activeElement, innerBox);
});

test("a marked box is preferred, and password, hidden, disabled and read-only boxes never take stray keys", () => {
  const { document, element, press } = load();
  const menu = element("div", { "data-type-scope": "" });
  const button = element("button");
  const key = element("input", { type: "password" });
  const hidden = element("input");
  hidden.hidden = true;
  const disabled = element("input");
  disabled.disabled = true;
  const readOnly = element("input");
  readOnly.readOnly = true;
  const plain = element("input", { type: "text" });
  menu.append(button, key, hidden, disabled, readOnly, plain);
  document.body.append(menu);
  button.focus();
  press("a");
  assert.equal(document.activeElement, plain, "the first box that can take text");
  const marked = element("textarea", { "data-type-here": "" });
  menu.append(marked);
  button.focus();
  press("b");
  assert.equal(document.activeElement, marked, "data-type-here names the menu's box");
});

test("a registered menu picks its own box, and can reveal it first", () => {
  const { nav, document, element, press } = load();
  const panel = element("section");
  const tab = element("button");
  const pane = element("div");
  pane.hidden = true;
  const box = element("textarea");
  pane.append(box);
  panel.append(tab, pane);
  document.body.append(panel);
  let revealed = 0;
  const drop = nav.typeScope(panel, () => { pane.hidden = false; revealed += 1; return box; });
  tab.focus();
  press("w");
  assert.equal(document.activeElement, box);
  assert.equal(revealed, 1, "the owner switched to the tab that holds the box");
  drop();
  tab.focus();
  press("w");
  assert.equal(document.activeElement, tab, "unregistered, the panel no longer takes typing");
});

test("an open sheet's box takes typing from anywhere in the sheet", () => {
  const { nav, document, get, element, press, opened } = load();
  const overlay = get("tasks-overlay");
  const sheet = element("div", { class: "explorer-sheet" });
  const row = element("li");
  const box = element("input", { id: "task-new", type: "text" });
  sheet.append(row, box);
  overlay.append(sheet);
  document.body.append(overlay);
  nav.claim("tasks");
  row.focus();
  press("p");
  assert.equal(document.activeElement, box, "the sheet's registry focus is its box");
  assert.deepEqual(opened, [], "P did not swap the sheet for Plans");
  nav.release("tasks");
  overlay.hidden = true;
  row.focus();
  press("t");
  assert.equal(document.activeElement, row, "closed, the sheet takes nothing");
});

test("a field that already has the caret keeps every key", () => {
  const { document, element, press } = load();
  const menu = element("div", { "data-type-scope": "" });
  const first = element("input");
  const second = element("textarea", { "data-type-here": "" });
  menu.append(first, second);
  document.body.append(menu);
  first.focus();
  press("a");
  assert.equal(document.activeElement, first);
});

// studio-ui.js's shared select: a choice whose change handler moves the caret
// into a box of its own (Agents' "Enter a model ID…") keeps it there. Closing
// the popup used to send focus back to the select's button, so the next
// letters fired shortcuts instead of typing the model ID.
const studioUi = (await readFile(new URL("../renderer/studio-ui.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const chooseFrom = studioUi.indexOf("  function closeSelect(");
const chooseTo = studioUi.indexOf("  function drawOptions(", chooseFrom);
assert.ok(chooseFrom >= 0 && chooseTo > chooseFrom, "closeSelect and choose markers");

function selectHarness(onChange, { focusedBefore = { id: "option" } } = {}) {
  const document = { body: { id: "body" }, activeElement: null };
  const focusable = (id) => ({ id, focus() { document.activeElement = this; } });
  const button = { ...focusable("button"), setAttribute() {}, removeAttribute() {} };
  const root = { remove() {}, contains: (node) => node?.id === "option" };
  const select = { value: "", multiple: false, dispatchEvent(event) { if (event.type === "change") onChange({ document, focusable, select }); } };
  const context = vm.createContext({ document, Event: class { constructor(type) { this.type = type; } }, visible: () => true, schedule() {} });
  vm.runInContext(`let popup = null;\n${studioUi.slice(chooseFrom, chooseTo)}\nthis.open = (value) => { popup = value; }; this.choose = choose;`, context);
  document.activeElement = focusedBefore;
  context.open({ select, button, root });
  return { context, document, button };
}

test("a choice that opens its own box keeps the caret there; any other choice returns to the select", () => {
  const custom = selectHarness(({ focusable, select }) => { if (select.value === "__custom") focusable("custom").focus(); });
  custom.context.choose({ value: "__custom" });
  assert.equal(custom.document.activeElement.id, "custom", "Enter a model ID… keeps the caret in its box");
  const plain = selectHarness(() => {});
  plain.context.choose({ value: "gpt" });
  assert.equal(plain.document.activeElement, plain.button, "a plain choice goes back to the select's button");
  // Chosen by keys sent to the button while focus sat on another select:
  // nothing moved during the choice, so the button still gets focus back.
  const keyed = selectHarness(() => {}, { focusedBefore: { id: "other-select" } });
  keyed.context.choose({ value: "5" });
  assert.equal(keyed.document.activeElement, keyed.button);
});
