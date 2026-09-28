import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// The companion's Needs you list (renderer/companion-ui.js keyed) keeps its
// rows by id. It used to keep any row that held keyboard focus, and the option
// button the owner had just clicked keeps focus, so an answered ask stayed on
// screen, dead, until another click (Clear list) moved focus away. Only a
// half-typed answer may hold a row back, and a row that left the list goes.

const source = await readFile(new URL("../renderer/companion-ui.js", import.meta.url), "utf8");
const from = source.indexOf("  function keyed(parent, items, make) {");
const to = source.indexOf("\n  function render(data) {", from);
assert.ok(from >= 0 && to > from, "keyed() is where this test reads it");

// Just enough DOM for keyed(): a tree of elements with focus.
class Element {
  constructor(tag, { type = null } = {}) { this.tag = tag; this.type = type; this.children = []; this.parent = null; this.dataset = {}; this.attributes = {}; this.disabled = false; this.root = false; }
  get isConnected() { let node = this; while (node.parent) node = node.parent; return node.root; }
  get nextElementSibling() { const list = this.parent?.children ?? []; return list[list.indexOf(this) + 1] ?? null; }
  get previousElementSibling() { const list = this.parent?.children ?? []; return list[list.indexOf(this) - 1] ?? null; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove() { if (!this.parent) return; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  replaceWith(next) { const list = this.parent.children; next.parent = this.parent; list[list.indexOf(this)] = next; this.parent = null; }
  contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
  closest() { return null; }
  matches() { return this.tag === "textarea" || this.tag === "input" && this.type === "text"; }
  querySelector() { for (const child of this.children) { if (["button", "input", "select", "textarea"].includes(child.tag) && !child.disabled) return child; const deep = child.querySelector(); if (deep) return deep; } return null; }
  hasAttribute(name) { return name in this.attributes; }
  set tabIndex(value) { this.attributes.tabindex = value; }
  focus() { env.document.activeElement = this; }
}

const env = vm.createContext({ document: { activeElement: null }, JSON, Array, Map, Set, String, Boolean });
vm.runInContext(`${source.slice(from, to)}\nthis.keyed = keyed;`, env);

// A row the way queueItem draws one: its title and its option buttons (or a text field).
function row(item) {
  const el = new Element("article");
  el.title = item.title;
  if (item.text) el.append(new Element("input", { type: "text" }));
  else for (const label of item.options ?? ["Try again", "Leave it"]) { const button = new Element("button"); button.label = label; el.append(button); }
  return el;
}
function list() { const body = new Element("body"); body.root = true; const pane = new Element("div"); body.append(pane); return pane; }
const titles = (pane) => pane.children.map((el) => el.title ?? el.dataset.itemId);

test("an answered ask leaves the list even though its clicked button still has focus", () => {
  const pane = list();
  env.keyed(pane, [{ id: "q1", title: "First" }, { id: "q2", title: "Second" }], row);
  const clicked = pane.children[0].children[0];
  clicked.focus();
  env.keyed(pane, [{ id: "q2", title: "Second" }], row);
  assert.deepEqual(titles(pane), ["Second"], "the answered row is gone");
  assert.equal(env.document.activeElement, pane.children[0].children[0], "focus moves to the row that took its place");
});

test("clearing every row leaves focus on the list, not on a removed button", () => {
  const pane = list();
  env.keyed(pane, [{ id: "q1", title: "First" }], row);
  pane.children[0].children[1].focus();
  env.keyed(pane, [], row);
  assert.deepEqual(titles(pane), []);
  assert.equal(env.document.activeElement, pane);
  assert.equal(pane.attributes.tabindex, -1);
});

test("a half-typed answer holds its changed row back, but not a row that left", () => {
  const pane = list();
  env.keyed(pane, [{ id: "q1", title: "Answer in one line", text: true }], row);
  const field = pane.children[0].children[0];
  field.focus();
  env.keyed(pane, [{ id: "q1", title: "Answer in one line (updated)", text: true }], row);
  assert.equal(pane.children[0].children[0], field, "typing survives a repaint of the same ask");
  env.keyed(pane, [], row);
  assert.deepEqual(titles(pane), [], "an ask that closed takes its draft with it");
});

test("a focused button on a row whose data changed gets the rebuilt row, focus following it", () => {
  const pane = list();
  env.keyed(pane, [{ id: "q1", title: "Old words" }], row);
  pane.children[0].children[1].focus();
  env.keyed(pane, [{ id: "q1", title: "New words" }], row);
  assert.deepEqual(titles(pane), ["New words"], "a button's focus no longer freezes a stale row");
  assert.equal(env.document.activeElement, pane.children[0].children[0]);
});
