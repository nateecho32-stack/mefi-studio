// Command-palette keyboard contract, driven for real: renderer/palette.js runs
// against a minimal DOM stub, synthetic window keydown events walk the list,
// and the assertions watch the active option wrap at both ends and focus land
// back on the opener after Escape and after Enter. No Electron, no jsdom.
import test from "node:test";
import assert from "node:assert/strict";

function element(id) {
  const listeners = {};
  const attrs = {};
  const classes = new Set();
  const el = {
    id,
    listeners,
    attrs,
    hidden: false,
    value: "",
    title: "",
    children: [],
    isConnected: true,
    clientWidth: 420,
    clientHeight: 600,
    classList: {
      add: (...names) => {
        for (const name of names) classes.add(name);
      },
      remove: (...names) => {
        for (const name of names) classes.delete(name);
      },
      contains: (name) => classes.has(name),
      toggle() {},
    },
    append(...kids) {
      el.children.push(...kids);
    },
    appendChild(kid) {
      el.children.push(kid);
      return kid;
    },
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener() {},
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return name in attrs ? attrs[name] : null;
    },
    removeAttribute(name) {
      delete attrs[name];
    },
    contains(node) {
      for (const child of el.children) {
        if (child === node || child.contains?.(node)) return true;
      }
      return false;
    },
    querySelector(selector) {
      if (selector === "li.active") {
        return el.children.find((child) => child.classList?.contains?.("active")) ?? null;
      }
      return null;
    },
    closest: () => null,
    focus() {
      if (globalThis.document) globalThis.document.activeElement = el;
    },
    blur() {},
    scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 420, height: 600 }),
  };
  let text = "";
  Object.defineProperty(el, "textContent", {
    get: () => text,
    set(next) {
      text = String(next);
      if (!text) el.children.length = 0; // clearing text drops the children, like the DOM
    },
  });
  return el;
}

test("command palette: arrows wrap at both ends, Escape and Enter restore the opener", async () => {
  const overlay = element("palette-overlay");
  const input = element("palette-input");
  const list = element("palette-list");
  overlay.append(input, list); // restoreOpener() treats input-in-overlay as stranded focus
  const registry = { "palette-overlay": overlay, "palette-input": input, "palette-list": list };

  const listeners = {};
  const goCalls = [];
  const nav = {
    state: {},
    list: () => [
      { id: "booklet", label: "Model booklet", group: "surfaces" },
      { id: "graph", label: "Value graph", group: "surfaces" },
      { id: "tasks", label: "Task board", group: "surfaces" },
    ],
    go: (id) => goCalls.push(id),
    claim: () => {},
    release: () => {},
  };

  globalThis.window = {
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    MefiNav: nav,
  };
  globalThis.document = {
    readyState: "complete",
    body: element("body"),
    activeElement: null,
    getElementById: (id) => registry[id] ?? null,
    createElement: () => element(null),
    addEventListener() {},
  };

  await import(new URL("../renderer/palette.js?keyboard-test", import.meta.url).href);
  const palette = globalThis.window.MefiPalette;
  assert.ok(palette, "palette.js must expose window.MefiPalette");

  const key = (name) => {
    const event = { key: name, preventDefault() { event.defaultPrevented = true; } };
    for (const handler of listeners.keydown ?? []) handler(event);
    return event;
  };
  const activeId = () => list.querySelector("li.active")?.id ?? null;

  // open from a real trigger: the palette focuses its field and names option 0
  const opener = element("tools-booklet");
  opener.focus();
  assert.equal(globalThis.document.activeElement, opener);
  palette.open();
  assert.equal(overlay.hidden, false);
  assert.equal(globalThis.document.activeElement, input);
  assert.equal(activeId(), "palette-option-0");
  assert.equal(input.attrs["aria-activedescendant"], "palette-option-0");

  // ArrowDown walks 0 -> 1 -> 2, then wraps at the last option back to 0
  key("ArrowDown");
  key("ArrowDown");
  assert.equal(activeId(), "palette-option-2");
  const downWrap = key("ArrowDown");
  assert.equal(downWrap.defaultPrevented, true);
  assert.equal(activeId(), "palette-option-0", "ArrowDown wraps from the last option to the first");
  assert.equal(input.attrs["aria-activedescendant"], "palette-option-0");

  // ArrowUp wraps the other way: from the first option straight to the last
  const upWrap = key("ArrowUp");
  assert.equal(upWrap.defaultPrevented, true);
  assert.equal(activeId(), "palette-option-2", "ArrowUp wraps from the first option to the last");
  key("ArrowUp");
  assert.equal(activeId(), "palette-option-1");

  // Escape closes the palette and hands focus back to the element that opened it
  const escape = key("Escape");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(overlay.hidden, true);
  assert.equal(globalThis.document.activeElement, opener, "Escape restores the opener's focus");
  assert.equal(input.attrs["aria-expanded"], "false");

  // reopening re-anchors at the first option with a fresh opener capture;
  // Enter runs the active item and every close path restores focus too
  const secondOpener = element("tools-graph");
  secondOpener.focus();
  palette.open();
  assert.equal(activeId(), "palette-option-0");
  key("ArrowDown");
  assert.equal(activeId(), "palette-option-1");
  key("Enter");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(goCalls, ["graph"]);
  assert.equal(overlay.hidden, true);
  assert.equal(globalThis.document.activeElement, secondOpener, "Enter restores the opener's focus");
});
