import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/eyes.js", import.meta.url), "utf8");
const feedCode = source.slice(source.indexOf("  function renderFeed()"), source.indexOf("  function renderDiff()"));

function fixture(narrow = false) {
  let document;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attrs = {}; this.events = {}; this.classList = { add() {} }; }
    set textContent(value) { this.text = value; this.children = []; }
    append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; } }
    contains(element) { return element === this || this.children.some(child => child.contains?.(element)); }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(type, handler) { this.events[type] = handler; }
    focus() { document.activeElement = this; }
    click() { this.events.click?.(); }
  }
  const feed = new Element("ul"), back = new Element("button"), page = new Element("section");
  document = { activeElement: null, createElement: tag => new Element(tag), createTextNode: text => ({ text }), getElementById: id => id === "eyes-back" ? back : page };
  const state = { changeId: null, changes: [{ id: "change-1", file: "app.js", tool: "edit", additions: 1, deletions: 0, time: 1 }] };
  let mode;
  const context = vm.createContext({ document, window: { matchMedia: () => ({ matches: narrow }) }, state,
    els: { feed }, visibleChanges: () => state.changes, updateSummary() {}, base: value => value,
    ftypeColor: () => "", GLYPHS: {}, ago: () => "now", renderInspector() {}, renderDiff() {}, setMode: value => { mode = value; },
  });
  vm.runInContext(`${feedCode}\nglobalThis.render = renderFeed;`, context);
  context.render();
  return { context, document, state, feed, back, button: () => feed.children[0].children[0], mode: () => mode };
}

test("Activity changes expose real buttons and preserve keyboard focus after feed updates", () => {
  const env = fixture();
  assert.equal(env.button().tagName, "button");
  env.button().focus();
  env.button().click();
  assert.equal(env.state.changeId, "change-1");
  assert.equal(env.mode(), "diff");
  assert.equal(env.button().attrs["aria-pressed"], "true");
  assert.equal(env.document.activeElement, env.button());
  env.context.render();
  assert.equal(env.document.activeElement, env.button());
});

test("Opening Activity evidence at narrow widths moves focus to the visible Back control", () => {
  const env = fixture(true);
  env.button().focus();
  env.button().click();
  assert.equal(env.document.activeElement, env.back);
  assert.equal(env.state.changeId, "change-1");
});
