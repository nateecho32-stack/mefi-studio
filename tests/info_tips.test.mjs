// The info circles (renderer/studio-ui.js, MefiUi.info and MefiUi.tuck): the how-to words that sat under a
// title move into a small box behind an "i" at the end of that title, so a page shows its controls first.
// info() makes the circle and its popover box; tuck() finds the help under field and card titles and moves
// it, leaving short help, status lines and anything marked data-keep-visible where they are, and never
// wrapping twice. The section is sliced out of studio-ui.js the way the other studio-ui suites slice theirs,
// and run in a vm over the shared fake DOM (tests/fixtures/renderer-dom.mjs), with the few DOM moves and the
// Popover API it needs added here. The stylesheet's promises (no letter in the DOM, the shared float
// surface, readable text, motion off when asked) are pinned against studio-ui.css.
//
// Run: node --test tests/info_tips.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { Element, createDom } from "./fixtures/renderer-dom.mjs";

const source = readFileSync(new URL("../renderer/studio-ui.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../renderer/studio-ui.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const from = source.indexOf("  // ---- info circles");
const to = source.indexOf("  function init() {", from);
assert.ok(from >= 0 && to > from, "info circle markers");
const nodeLine = source.slice(source.indexOf("  const node = "), source.indexOf("\n", source.indexOf("  const node = ")));
assert.ok(nodeLine.includes("document.createElement"), "the node helper");

// ---- what the shared fake DOM needs for moving nodes and for popovers --------------------------
const detach = (child) => {
  const siblings = child?.parentNode?.children;
  if (siblings && siblings.includes(child)) siblings.splice(siblings.indexOf(child), 1);
};
const baseAppend = Element.prototype.append, basePrepend = Element.prototype.prepend, baseInsert = Element.prototype.insertBefore, baseMatches = Element.prototype.matches;
Element.prototype.append = function append(...children) { for (const child of children) if (child && typeof child === "object") detach(child); return baseAppend.apply(this, children); };
Element.prototype.prepend = function prepend(...children) { for (const child of children) if (child && typeof child === "object") detach(child); return basePrepend.apply(this, children); };
Element.prototype.insertBefore = function insertBefore(child, before) { detach(child); return baseInsert.call(this, child, before); };
Element.prototype.after = function after(node) {
  const parent = this.parentNode;
  if (!parent) return;
  detach(node);
  parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
  node.parentNode = parent;
};
Element.prototype.replaceWith = function replaceWith(node) {
  const parent = this.parentNode;
  if (!parent) return;
  detach(node);
  parent.children.splice(parent.children.indexOf(this), 1, node);
  node.parentNode = parent; this.parentNode = null;
};
Element.prototype.matches = function matches(selector) { return selector === ":popover-open" ? Boolean(this.popoverOpen) : baseMatches.call(this, selector); };
Element.prototype.getBoundingClientRect = function rect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, ...this.rect }; };
const sibling = (node, step) => {
  const list = node.parentNode?.children ?? [];
  for (let at = list.indexOf(node) + step; at >= 0 && at < list.length; at += step) if (list[at].nodeType === 1) return list[at];
  return null;
};
Object.defineProperties(Element.prototype, {
  nodeType: { configurable: true, get() { return this.tagName === "#text" ? 3 : 1; } },
  parentElement: { configurable: true, get() { return this.parentNode instanceof Element ? this.parentNode : null; } },
  previousElementSibling: { configurable: true, get() { return sibling(this, -1); } },
  nextElementSibling: { configurable: true, get() { return sibling(this, 1); } },
  firstElementChild: { configurable: true, get() { return this.children.find((child) => child.nodeType === 1) ?? null; } },
  isConnected: { configurable: true, get() { let at = this; while (at.parentNode) at = at.parentNode; return at.tagName === "body"; } },
  htmlFor: { configurable: true, get() { return this.getAttribute("for") ?? ""; }, set(value) { this.setAttribute("for", value); } },
});
// The Popover API as Chromium has it for popover="auto": one open at a time, a toggle event each way.
const fire = (target, type, more = {}) => {
  const event = { type, target, currentTarget: target, defaultPrevented: false, propagationStopped: false, immediateStopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, stopImmediatePropagation() { this.immediateStopped = true; }, ...more };
  for (const listener of [...(target.listeners[type] ?? [])]) listener(event);
  return event;
};
const openPopovers = new Set();
Element.prototype.showPopover = function showPopover() {
  if (!this.isConnected) throw new Error("InvalidStateError: not connected");
  if (this.popoverOpen) return;
  for (const other of [...openPopovers]) other.hidePopover();
  this.popoverOpen = true; openPopovers.add(this);
  fire(this, "toggle", { oldState: "closed", newState: "open" });
};
Element.prototype.hidePopover = function hidePopover() {
  if (!this.popoverOpen) return;
  this.popoverOpen = false; openPopovers.delete(this);
  fire(this, "toggle", { oldState: "open", newState: "closed" });
};

function load({ width = 1200, height = 800 } = {}) {
  openPopovers.clear();
  const dom = createDom();
  const { document, body } = dom;
  const style = () => ({ setProperty(name, value) { this[name] = String(value); }, getPropertyValue(name) { return this[name] ?? ""; } });
  document.createElement = (tag) => { const made = new Element(tag); made.style = style(); return made; };
  // Ids made by the page are found wherever they sit under the body.
  document.getElementById = (id) => body.descendants().find((node) => node.id === id) ?? null;
  document.activeElement = null;
  const timers = [];
  let now = 0;
  const clock = {
    setTimeout: (fn, ms) => { timers.push({ fn, at: now + Number(ms || 0), id: timers.length + 1 }); return timers.length; },
    clearTimeout: (id) => { const timer = timers.find((item) => item.id === id); if (timer) timer.cancelled = true; },
    tick(ms) { now += ms; for (const timer of timers.filter((item) => !item.cancelled && !item.done && item.at <= now)) { timer.done = true; timer.fn(); } },
  };
  const observers = [];
  class MutationObserver { constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); } observe(target, options) { this.targets.push({ target, options }); } disconnect() { this.targets = []; } }
  const cssHidden = new Set();
  class HTMLElement {}
  HTMLElement.prototype.popover = null;
  const windowListeners = {};
  const context = vm.createContext({
    document, HTMLElement, MutationObserver, queueMicrotask, innerWidth: width, innerHeight: height,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    requestAnimationFrame: (fn) => { fn(); return 1; }, cancelAnimationFrame: () => {},
    getComputedStyle: (node) => ({ display: cssHidden.has(node) ? "none" : "block" }),
    window: { addEventListener: (name, fn) => { (windowListeners[name] ??= []).push(fn); }, removeEventListener: (name, fn) => { windowListeners[name] = (windowListeners[name] ?? []).filter((item) => item !== fn); } },
  });
  vm.runInContext(`${nodeLine}\n${source.slice(from, to)}\nthis.info = info; this.tuck = tuck;`, context);
  // A small builder for the fixtures below: el("label", { class: "x" }, "words", child, …).
  const el = (tag, attrs = {}, ...children) => {
    const made = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") made.className = value;
      else if (key === "hidden") made.hidden = Boolean(value);
      else if (key === "type") { made.type = value; made.setAttribute("type", value); }
      else made.setAttribute(key, value);
    }
    for (const child of children) made.append(typeof child === "string" ? document.createTextNode(child) : child);
    return made;
  };
  const page = (...children) => { const root = el("section", {}, ...children); body.append(root); return root; };
  const dots = (root) => root.querySelectorAll(".info-dot");
  const pops = (root) => root.querySelectorAll(".info-pop");
  // Esc is heard on the window's capture phase, before any sheet or sidebar.
  const keydown = (key) => fire({ listeners: windowListeners }, "keydown", { key });
  return { context, document, body, clock, observers, cssHidden, windowListeners, el, page, dots, pops, keydown, info: context.info, tuck: context.tuck };
}

const LONG = "Ready for review, or verified. Off by default, because the inbox already shows it.";

// ---- info(): the circle and its box --------------------------------------------------------------
test("info() returns a round i button tied to its popover box by aria-controls, closed, named after its label", async () => {
  const env = load();
  const dot = env.info("First line.\nSecond line.", { label: "Quiet hours" });
  assert.equal(dot.tagName, "button");
  assert.equal(dot.type, "button");
  assert.ok(dot.classList.contains("info-dot"));
  assert.equal(dot.getAttribute("aria-label"), "More about Quiet hours");
  assert.equal(dot.getAttribute("aria-expanded"), "false");
  assert.equal(dot.textContent, "", "the letter is drawn by the stylesheet: no words join the title it sits in");
  const host = env.page(env.el("h3", {}, "Quiet hours"));
  host.firstElementChild.append(dot);
  assert.equal(dot.nextElementSibling, null, "the box waits for the caller to place the circle");
  await Promise.resolve();
  const pop = dot.nextElementSibling;
  assert.ok(pop?.classList.contains("info-pop"), "then follows it into the page");
  assert.equal(pop.id, dot.getAttribute("aria-controls"));
  assert.equal(pop.getAttribute("popover"), "auto", "the top layer, light dismiss and Esc come with popover=auto");
  const body = pop.querySelector(".info-pop-body");
  assert.equal(body.textContent, "First line.\nSecond line.");
  assert.ok(body.classList.contains("is-text"), "a string keeps its line breaks (white-space: pre-line)");
  assert.equal(dot.getAttribute("aria-describedby"), body.id, "a screen reader hears the words from the circle itself");
  assert.equal(dot.popoverTargetElement, pop, "the circle is its box's invoker, so the light dismiss leaves the box to it");
  const words = env.el("p", {}, "A node, kept as it is.");
  const other = env.info(words, { label: "" });
  assert.equal(other.getAttribute("aria-label"), "More about this");
  env.body.append(other); await Promise.resolve();
  assert.equal(words.parentNode.className, "info-pop-body", "a Node goes into the box whole");
});

test("click, Enter and Space toggle it; aria-expanded follows every way it opens and closes", async () => {
  const env = load();
  const dot = env.info("Help.", { label: "Thing" });
  env.page(dot); await Promise.resolve();
  const pop = dot.nextElementSibling;
  dot.rect = { left: 100, top: 100, right: 118, bottom: 118, width: 18, height: 18 }; pop.rect = { width: 200, height: 60 };
  // Enter and Space reach a button as a click.
  const first = fire(dot, "click", { detail: 0 });
  assert.equal(first.defaultPrevented, true, "the circle decides, not the popover target's own toggle");
  assert.equal(first.propagationStopped, true, "a click on the circle is not a click on the row around it");
  assert.equal(pop.popoverOpen, true);
  assert.equal(dot.getAttribute("aria-expanded"), "true");
  fire(dot, "click", { detail: 1 });
  assert.equal(pop.popoverOpen, false, "a second click closes it");
  assert.equal(dot.getAttribute("aria-expanded"), "false");
  fire(dot, "click", { detail: 1 });
  pop.hidePopover(); // a click outside: the Popover API's light dismiss, heard through the toggle event
  assert.equal(dot.getAttribute("aria-expanded"), "false");
  fire(dot, "click", { detail: 1 });
  assert.equal(pop.popoverOpen, true, "and it opens again from its circle");
});

test("a resting mouse opens it after a moment and leaving closes it, unless a click pinned it; touch never hovers", async () => {
  const env = load();
  const dot = env.info("Help.", { label: "Thing" });
  env.page(dot); await Promise.resolve();
  const pop = dot.nextElementSibling;
  dot.rect = { left: 100, top: 100, right: 118, bottom: 118, width: 18, height: 18 }; pop.rect = { width: 200, height: 60 };
  fire(dot, "pointerenter", { pointerType: "mouse" });
  env.clock.tick(200);
  assert.equal(pop.popoverOpen, undefined, "not at once: a pointer passing by opens nothing");
  env.clock.tick(200);
  assert.equal(pop.popoverOpen, true, "after about 350 ms");
  assert.equal(dot.getAttribute("aria-expanded"), "true");
  fire(dot, "pointerleave", { pointerType: "mouse" });
  fire(pop, "pointerenter", { pointerType: "mouse" });
  env.clock.tick(500);
  assert.equal(pop.popoverOpen, true, "moving into the box keeps it");
  fire(pop, "pointerleave", { pointerType: "mouse" });
  env.clock.tick(500);
  assert.equal(pop.popoverOpen, false, "leaving both closes it");
  fire(dot, "pointerenter", { pointerType: "mouse" }); env.clock.tick(400);
  fire(dot, "click", { detail: 1 });
  assert.equal(pop.popoverOpen, true, "a click on a box the pointer opened pins it");
  fire(dot, "pointerleave", { pointerType: "mouse" }); env.clock.tick(500);
  assert.equal(pop.popoverOpen, true, "a pinned box stays when the pointer leaves");
  fire(dot, "click", { detail: 1 });
  assert.equal(pop.popoverOpen, false);
  fire(dot, "pointerenter", { pointerType: "touch" }); env.clock.tick(1000);
  assert.equal(pop.popoverOpen, false, "a finger does not hover");
});

test("one box is open at a time, and Esc closes it before anything under it hears the key", async () => {
  const env = load();
  const a = env.info("A.", { label: "A" }), b = env.info("B.", { label: "B" });
  env.page(a, b); await Promise.resolve();
  for (const dot of [a, b]) { dot.rect = { left: 100, top: 100, right: 118, bottom: 118, width: 18, height: 18 }; dot.nextElementSibling.rect = { width: 200, height: 60 }; }
  fire(a, "click", { detail: 1 });
  fire(b, "click", { detail: 1 });
  assert.equal(a.nextElementSibling.popoverOpen, false, "opening B closed A");
  assert.equal(a.getAttribute("aria-expanded"), "false");
  assert.equal(b.getAttribute("aria-expanded"), "true");
  env.document.activeElement = b;
  const esc = env.keydown("Escape");
  assert.equal(b.nextElementSibling.popoverOpen, false);
  assert.equal(b.getAttribute("aria-expanded"), "false");
  assert.equal(esc.defaultPrevented, true);
  assert.equal(esc.immediateStopped, true, "the sheet under it keeps its own Esc for the next press");
  assert.equal(b.focused, true, "the keyboard goes back to the circle");
  const again = env.keydown("Escape");
  assert.equal(again.defaultPrevented, false, "with nothing open, Esc is the page's again");
});

test("the box sits under its circle, over it when there is no room below, and inside the window", async () => {
  const env = load({ width: 1000, height: 600 });
  const dot = env.info("Help.", { label: "Thing" });
  env.page(dot); await Promise.resolve();
  const pop = dot.nextElementSibling;
  pop.rect = { width: 300, height: 120 };
  dot.rect = { left: 200, top: 100, right: 218, bottom: 118, width: 18, height: 18 };
  fire(dot, "click", { detail: 1 });
  assert.deepEqual([pop.dataset.side, pop.style.top, pop.style.left], ["below", "126px", "59px"], "under it, centred on it");
  fire(dot, "click", { detail: 1 });
  dot.rect = { left: 970, top: 540, right: 988, bottom: 558, width: 18, height: 18 };
  fire(dot, "click", { detail: 1 });
  assert.deepEqual([pop.dataset.side, pop.style.top, pop.style.left], ["above", "412px", "692px"], "over it near the bottom, 8 px in from the right edge");
  assert.equal(pop.style["--info-arrow"], "287px", "the arrow still points at the circle");
  // The page scrolls the circle out of the window: its box goes with it.
  dot.rect = { left: 970, top: -60, right: 988, bottom: -42, width: 18, height: 18 };
  for (const listener of env.body.listeners.scroll ?? []) listener({ type: "scroll" });
  assert.equal(pop.popoverOpen, false);
  assert.equal(dot.getAttribute("aria-expanded"), "false");
});

test("a click on the box's words never reaches the label or row it sits in; a link inside it still works", async () => {
  const env = load();
  const link = env.el("a", { href: "https://example.invalid" }, "the guide");
  const words = env.el("span", {}, "See ", link);
  const dot = env.info(words, { label: "Thing" });
  env.page(dot); await Promise.resolve();
  const pop = dot.nextElementSibling;
  const plain = fire(pop, "click", { target: words });
  assert.equal(plain.defaultPrevented, true, "a label around the box would flip its switch otherwise");
  assert.equal(plain.propagationStopped, true);
  const followed = fire(pop, "click", { target: link });
  assert.equal(followed.defaultPrevented, false);
});

// ---- tuck(): the help moves behind its title ------------------------------------------------------
test("a settings row's long help moves into a box at the end of its title, its control described and named by the title", () => {
  const env = load();
  const input = env.el("input", { id: "alerts-done", type: "checkbox", role: "switch" });
  const small = env.el("small", { id: "alerts-done-help" }, LONG);
  const title = env.el("b", {}, "A task finishes");
  const label = env.el("label", { class: "settings-control" }, env.el("span", {}, title, small), input);
  const root = env.page(label);
  assert.equal(env.tuck(root), 1);
  const dot = title.lastChild;
  assert.ok(dot.classList.contains("info-dot"), "the circle sits at the end of its title");
  assert.equal(dot.getAttribute("aria-label"), "More about A task finishes");
  assert.equal(title.textContent, "A task finishes", "the title's words are unchanged");
  const pop = small.parentNode.parentNode;
  assert.ok(pop.classList.contains("info-pop"), "the help is in the box, element, id and all");
  assert.equal(pop.parentNode, title.parentNode, "the box took the help's place beside the title");
  assert.ok(label.textContent.includes(LONG), "textContent still finds the words");
  assert.equal(label.htmlFor, "alerts-done", "the label points at its switch, not at the circle that now comes first");
  assert.equal(input.getAttribute("aria-label"), "A task finishes", "the switch is named by its title alone");
  assert.equal(input.getAttribute("aria-describedby"), `${pop.id}-body`, "and described by its help");
});

test("short help, status lines, kept words and help with a control stay where they are", () => {
  const env = load();
  const keep = [
    env.el("small", {}, "Until you switch back to Studio."),
    env.el("small", { role: "status" }, LONG),
    env.el("small", { "data-tone": "good" }, LONG),
    env.el("small", { class: "settings-status" }, LONG),
    env.el("small", { id: "release-channel-warning" }, LONG),
    env.el("small", {}, `Last run: ${LONG}`),
    env.el("small", { "data-keep-visible": "" }, LONG),
    env.el("small", {}, LONG.slice(0, 40), env.el("a", { href: "#x" }, "a link"), LONG.slice(40)),
    env.el("small", { hidden: true }, LONG),
  ];
  const root = env.page(...keep.map((help, index) => env.el("label", { class: "settings-control" }, env.el("span", {}, env.el("b", {}, `Row ${index}`), help), env.el("input", { type: "checkbox" }))));
  const live = env.el("div", { "aria-live": "polite" }, env.el("h3", {}, "Live"), env.el("p", {}, LONG));
  root.append(live);
  assert.equal(env.tuck(root), 0);
  assert.equal(env.dots(root).length, 0);
  for (const help of keep) assert.ok(!help.closest(".info-pop"), help.textContent.slice(0, 20));
});

test("a card's intro paragraph right under its heading moves; a paragraph after anything else stays", () => {
  const env = load();
  const intro = env.el("p", { class: "muted" }, LONG);
  const later = env.el("p", { class: "muted" }, LONG);
  const heading = env.el("h3", {}, "Live update");
  const root = env.page(env.el("div", { class: "settings-place-group" }, heading, intro, env.el("div", { class: "row" }, env.el("button", { type: "button" }, "Apply update")), later));
  assert.equal(env.tuck(root), 1);
  assert.ok(intro.closest(".info-pop"));
  assert.ok(heading.lastChild.classList.contains("info-dot"));
  assert.ok(!later.closest(".info-pop"), "a paragraph that is not right under a heading is not an intro");
});

test("a field's hint after its control goes to the field's title, past the control", () => {
  const env = load();
  const input = env.el("input", { type: "text" });
  const title = env.el("span", { class: "setup-helper-label" }, "Connection");
  const hint = env.el("small", { class: "setup-helper-hint" }, "The app server falls back to codex exec when it cannot start.");
  const label = env.el("label", { class: "setup-helper-field" }, title, env.el("div", { class: "setup-helper-model" }, input, env.el("datalist")), hint);
  const root = env.page(label);
  assert.equal(env.tuck(root), 1);
  assert.ok(title.lastChild.classList.contains("info-dot"));
  assert.ok(input.id && label.htmlFor === input.id, "the field's input got an id and its label points at it");
  // A Size-style row: the title is the first thing of the row before the hint.
  const zoom = env.el("input", { id: "size-zoom", type: "range" });
  const row = env.el("div", { class: "size-row" }, env.el("div", { class: "size-label" }, env.el("label", { for: "size-zoom" }, "Interface scale"), env.el("output", {}, "100%")), env.el("p", { class: "size-hint" }, "Everything grows or shrinks together, like zoom. Ctrl + and Ctrl − do it too."), zoom);
  const second = env.page(row);
  assert.equal(env.tuck(second), 1);
  assert.ok(row.querySelector("label").lastChild.classList.contains("info-dot"));
  assert.equal(zoom.getAttribute("aria-label"), "Interface scale");
});

test("the kill switch leaves every help where it is", () => {
  const env = load();
  env.context.localStorage = { getItem: (key) => (key === "mefiStudio.infoTips" ? "off" : null) };
  const small = env.el("small", {}, LONG);
  const root = env.page(env.el("label", { class: "settings-control" }, env.el("span", {}, env.el("b", {}, "A task finishes"), small), env.el("input", { type: "checkbox" })));
  assert.equal(env.tuck(root), 0);
  assert.equal(small.closest(".info-pop"), null);
  env.context.localStorage = { getItem: () => null };
  assert.equal(env.tuck(root), 1, "and on again, it tucks");
});

test("tuck is idempotent: a second run moves nothing and wraps nothing twice", () => {
  const env = load();
  const root = env.page(
    env.el("label", { class: "settings-control" }, env.el("span", {}, env.el("b", {}, "A task finishes"), env.el("small", {}, LONG)), env.el("input", { type: "checkbox" })),
    env.el("div", {}, env.el("h3", {}, "Try it"), env.el("p", {}, LONG)),
  );
  assert.equal(env.tuck(root), 2);
  const shape = () => [env.dots(root).length, env.pops(root).length, root.textContent];
  const before = shape();
  assert.equal(env.tuck(root), 0);
  assert.equal(env.tuck(root, { min: 1 }), 0);
  assert.deepEqual(shape(), before);
});

test("data-info-anchor names a title anywhere, whatever the length; a second help joins the same box", () => {
  const env = load();
  const title = env.el("b", { id: "size-preview-title" }, "Preview");
  const first = env.el("p", { "data-info-anchor": "size-preview-title" }, "Short.");
  const second = env.el("p", { "data-info-anchor": "size-preview-title" }, "Also short.");
  const orphan = env.el("p", { "data-info-anchor": "missing" }, "Stays: its title is not on the page.");
  const root = env.page(env.el("div", {}, title), env.el("div", {}, first), env.el("div", {}, second), orphan);
  assert.equal(env.tuck(root), 2);
  assert.equal(env.dots(root).length, 1, "one circle for the title");
  assert.equal(first.parentNode, second.parentNode, "both words share its box");
  assert.equal(orphan.closest(".info-pop"), null);
});

test("a title the stylesheet hides, or one inside a summary, keeps its help visible", () => {
  const env = load();
  const eyebrow = env.el("p", { class: "settings-eyebrow settings-place-only" }, "When Studio is in the background");
  const lead = env.el("p", { class: "muted" }, LONG);
  const summaryHelp = env.el("p", {}, LONG);
  const root = env.page(env.el("div", {}, eyebrow, lead), env.el("details", {}, env.el("summary", {}, env.el("h3", {}, "Inside")), summaryHelp));
  env.cssHidden.add(eyebrow);
  assert.equal(env.tuck(root), 0);
  assert.equal(lead.closest(".info-pop"), null, "in the classic layout the eyebrow is display: none, so its lead stays");
  env.cssHidden.delete(eyebrow);
  assert.equal(env.tuck(root), 0, "a hidden title is remembered: a page that paints again reads no style for it, and its words stay in view");
  // The same lead under a title that shows moves.
  const shown = env.page(env.el("div", {}, env.el("p", { class: "settings-eyebrow" }, "When Studio is in the background"), env.el("p", { class: "muted" }, LONG)));
  assert.equal(env.tuck(shown), 1);
});

test("a page's header keeps its title and subtitle line as they are", () => {
  const env = load();
  const subtitle = env.el("p", {}, "Windows notifications while Studio is in the background, and quiet hours");
  const root = env.page(env.el("header", { class: "settings-category-head" }, env.el("h2", {}, "Notifications"), subtitle));
  assert.equal(env.tuck(root), 0);
  assert.equal(subtitle.closest(".info-pop"), null);
  assert.equal(env.dots(root).length, 0);
});

test("a title rewritten after the move gets its circle back, and the names follow the new words", () => {
  const env = load();
  const input = env.el("input", { id: "idle-home", type: "checkbox" });
  const title = env.el("span", { id: "idle-home-label" }, "Open Home on launch");
  const hint = env.el("p", { "data-info-anchor": "idle-home-label" }, "When disabled, Studio reopens the last tab page you used after the project chooser.");
  const root = env.page(env.el("label", { class: "switch" }, input, env.el("span", { class: "track" }), title), hint);
  assert.equal(env.tuck(root), 1);
  const dot = title.lastChild;
  title.textContent = "Open Vibe on launch"; // vibe.js paintSettings
  assert.equal(dot.parentNode, null, "a rewrite drops the circle");
  const observer = env.observers.find((item) => item.targets.some((row) => row.target === title));
  assert.ok(observer, "the title is watched");
  observer.callback([{ target: title, type: "childList" }]);
  assert.equal(title.lastChild, dot, "and it comes back at the end");
  assert.equal(dot.getAttribute("aria-label"), "More about Open Vibe on launch");
  assert.equal(input.getAttribute("aria-label"), "Open Vibe on launch");
});

// ---- the stylesheet ------------------------------------------------------------------------------
test("the stylesheet draws the letter, keeps the words readable and the surface shared, and holds still when asked", () => {
  const rule = (selector) => css.split("\n").find((line) => line.startsWith(`${selector} {`)) ?? "";
  assert.match(css, /button\.info-dot::before \{ content: "i" \/ ""; \}/, "the letter has no text for a screen reader or a text audit");
  assert.match(css, /button\.info-dot \{[^}]*width: 18px; height: 18px;/s);
  assert.match(css, /\.info-pop \{[^}]*var\(--studio-float-fill\)[^}]*color: var\(--ivory\); font: 400 max\(13px, var\(--f125, 13px\)\)/s, "the floating surface, the page's main ink, 13 px at least");
  assert.match(css, /max-width: min\(320px, calc\(100vw - 16px\)\)/);
  assert.match(rule(".info-pop-body > *"), /color: inherit !important; font: inherit !important;/, "moved words read as the box's own");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ button\.info-dot, \.info-pop \{ transition: none; \} \}/);
  assert.match(css, /html:is\(\[data-motion="off"\], \[data-motion="calm"\]\) :is\(button\.info-dot, \.info-pop\)/);
  assert.match(source, /window\.MefiUi = Object\.assign\(window\.MefiUi \|\| \{\}, \{ arm, plainError, info, tuck \}\);/, "the two calls are on MefiUi");
});
