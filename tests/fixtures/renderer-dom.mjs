// One fake DOM for the renderer UI suites.
//
// Nineteen test files each grew their own `class Element` plus a
// `querySelectorAll` that understood only the handful of selectors that file
// happened to need. That made every template restructure a nineteen-file
// rewrite, which is why the layout work in docs/ux-audit.md kept stalling.
// This is that stand-in, once, with a selector matcher general enough that a
// suite does not have to teach it new tricks:
//
//   *  ·  tag  ·  .class  ·  #id  ·  [attr]  ·  [attr="value"]
//   tag.class  ·  .a.b  ·  comma lists  ·  a descendant chain ("a b")
//
// It is deliberately NOT a browser. There is no layout, no cascade and no
// event bubbling beyond `click()` walking to a listener. Anything that needs
// real geometry belongs in the Electron fixtures next to this file.
//
// `templateIds` reads the real renderer/booklet.template.html, so a suite that
// builds its element map from it follows the markup instead of a copied list.
//
// Adopting it: delete the local `class Element`, import this one, and run the
// suite — then run the WHOLE suite, not just that file. Three went over
// untouched (command_activity, workspace_ui, jev_routing_ui). startup_resume
// passed alone and then hung two of its tests under the concurrent runner, so
// it was put back; a swap that only passes in isolation is not a migration.
// The rest do not go over at all, and the reason is worth knowing before you
// try: their private stand-ins bake in convenient
// falsehoods their assertions now depend on. tasks_ui's `closest()` returns
// `this` for every selector; several `querySelectorAll`s answer only the two
// or three selectors that file passes and `false` for everything else. Against
// a stand-in that walks real ancestors those tests take different branches, so
// migrating one means building its tree properly — a per-file judgement call,
// not a sweep. That gap is also exactly why a template restructure used to
// break them in ways nobody could predict from the diff.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TEMPLATE = path.join(ROOT, "renderer", "booklet.template.html");

let templateText = null;
function template() {
  if (templateText === null) templateText = readFileSync(TEMPLATE, "utf8");
  return templateText;
}

/** Every id in the template, optionally filtered by a pattern or predicate. */
export function templateIds(filter = null) {
  const ids = [...template().matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const unique = [...new Set(ids)];
  if (!filter) return unique;
  if (typeof filter === "function") return unique.filter(filter);
  return unique.filter((id) => filter.test(id));
}

/** True when the template carries this id — the check `npm run audit` makes. */
export function templateHasId(id) {
  return template().includes(`id="${id}"`);
}

// ---- selectors -----------------------------------------------------------
// One compound step: tag, #id, .class and [attr] parts, all of which must hold.
function compile(step) {
  const tag = /^[a-z][\w-]*/i.exec(step)?.[0] ?? null;
  const id = /#([\w-]+)/.exec(step)?.[1] ?? null;
  const classes = [...step.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  // Values arrive single-quoted as often as double-quoted, and sometimes bare.
  const attrs = [...step.matchAll(/\[([\w-]+)(?:([~^$*|]?=)\s*["']?([^\]"']*)["']?)?\]/g)]
    .map(([, name, op, value]) => ({ name, op, value }));
  return (node) => {
    if (step === "*") return true;
    if (tag && String(node.tagName).toLowerCase() !== tag.toLowerCase()) return false;
    if (id && node.id !== id) return false;
    if (classes.some((name) => !node.classList.contains(name))) return false;
    return attrs.every(({ name, op, value }) => {
      const actual = node.getAttribute(name);
      if (actual === null || actual === undefined || actual === false) return false;
      if (!op) return true;
      const text = String(actual);
      if (op === "=") return text === value;
      if (op === "^=") return text.startsWith(value);
      if (op === "$=") return text.endsWith(value);
      if (op === "*=") return text.includes(value);
      if (op === "~=") return text.split(/\s+/).includes(value);
      return text === value;
    });
  };
}

// A selector is a comma list of descendant chains. A chain matches when its
// last step matches the node and every earlier step matches some ancestor, in
// order — enough for "#idle-feed .feed-row", which is as deep as these go.
function matcher(selector) {
  const branches = String(selector).split(",").map((branch) => branch.trim()).filter(Boolean)
    .map((branch) => branch.split(/\s+/).map(compile));
  return (node) => branches.some((steps) => {
    if (!steps[steps.length - 1](node)) return false;
    let index = steps.length - 2;
    let parent = node.parentNode;
    while (index >= 0 && parent) {
      if (steps[index](parent)) index -= 1;
      parent = parent.parentNode;
    }
    return index < 0;
  });
}

// ---- the element ---------------------------------------------------------
export class Element {
  constructor(tag = "div", id = "") {
    this.tagName = tag;
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.style = {};
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.open = false;
    this.scrollTop = 0;
    this.clientHeight = 400;
    this.scrollHeight = 400;
    this.scrollWidth = 400;
    this.clientWidth = 400;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => name && classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, on) => (on ?? !classes.has(name)) ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
      get size() { return classes.size; },
    };
    Object.defineProperty(this, "className", {
      get: () => [...classes].join(" "),
      set: (value) => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name)); },
      configurable: true,
    });
  }

  set textContent(value) { this.ownText = String(value); this.children.forEach((child) => { child.parentNode = null; }); this.children = []; }
  get textContent() { return (this.ownText ?? "") + this.children.map((child) => child.textContent).join(""); }
  get firstChild() { return this.children[0] || this; }
  get lastChild() { return this.children[this.children.length - 1] ?? null; }
  get childNodes() { return this.children; }

  adopt(children) {
    for (const child of children) { if (child && typeof child === "object") child.parentNode = this; }
    return children;
  }
  append(...children) { this.children.push(...this.adopt(children)); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.ownText = ""; this.children = this.adopt(children); }
  insertBefore(child, before) {
    const at = this.children.indexOf(before);
    this.children.splice(at < 0 ? this.children.length : at, 0, ...this.adopt([child]));
    return child;
  }
  remove() {
    const siblings = this.parentNode?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }

  setAttribute(key, value) {
    this.attrs[key] = String(value);
    if (key === "id") this.id = String(value);
    if (key === "hidden") this.hidden = true;
    if (key === "class") this.className = String(value);
    if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(key) {
    if (key === "id") return this.id || null;
    if (key === "class") return this.className || null;
    if (key === "hidden") return this.hidden ? "" : null;
    if (key.startsWith("data-")) {
      const name = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (name in this.dataset) return this.dataset[name];
    }
    return key in this.attrs ? this.attrs[key] : null;
  }
  hasAttribute(key) { return this.getAttribute(key) !== null; }
  removeAttribute(key) {
    delete this.attrs[key];
    if (key === "hidden") this.hidden = false;
  }

  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  removeEventListener(name, fn) {
    const list = this.listeners[name];
    if (list) this.listeners[name] = list.filter((entry) => entry !== fn);
  }
  async trigger(name, event = {}) {
    await Promise.all((this.listeners[name] ?? []).map((fn) => fn({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...event })));
  }
  click(event = {}) { return this.trigger("click", event); }

  focus() { this.focused = true; }
  blur() { this.focused = false; }
  scrollIntoView() { this.scrolledIntoView = true; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight, toJSON() { return { ...this }; } }; }

  closest(selector) {
    const matches = matcher(selector);
    let node = this;
    while (node) { if (matches(node)) return node; node = node.parentNode; }
    return null;
  }
  matches(selector) { return matcher(selector)(this); }
  contains(node) {
    let walk = node;
    while (walk) { if (walk === this) return true; walk = walk.parentNode; }
    return false;
  }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector) {
    const matches = matcher(selector);
    return this.descendants().filter(matches);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

// ---- the document --------------------------------------------------------
/**
 * A document stub whose getElementById mints elements on demand, so a suite
 * never has to pre-declare the ids its module reaches for. Pass `ids` (or
 * `fromTemplate`) to seed the ones that must exist up front.
 */
export function createDom({ ids = [], fromTemplate = null } = {}) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) {
      const node = new Element("div", id);
      elements.set(id, node);
    }
    return elements.get(id);
  };
  for (const id of ids) get(id);
  if (fromTemplate) for (const id of templateIds(fromTemplate)) get(id);

  const body = new Element("body");
  const documentElement = new Element("html");
  const document = {
    body,
    documentElement,
    hidden: false,
    activeElement: null,
    getElementById: (id) => (elements.has(id) ? elements.get(id) : null),
    createElement: (tag) => new Element(tag),
    // Glyphs are built as <svg><use> in the SVG namespace; the namespace is
    // irrelevant to a stand-in, the tag is not.
    createElementNS: (_namespace, tag) => new Element(tag),
    createTextNode: (text) => { const node = new Element("#text"); node.textContent = text; return node; },
    querySelector: (selector) => document.querySelectorAll(selector)[0] ?? null,
    querySelectorAll: (selector) => {
      const matches = matcher(selector);
      const seen = new Set();
      const out = [];
      for (const node of [...elements.values(), ...body.descendants()]) {
        for (const candidate of [node, ...node.descendants()]) {
          if (seen.has(candidate)) continue;
          seen.add(candidate);
          if (matches(candidate)) out.push(candidate);
        }
      }
      return out;
    },
    addEventListener: (name, fn) => body.addEventListener(name, fn),
    removeEventListener: (name, fn) => body.removeEventListener(name, fn),
  };
  return { document, elements, get, body, documentElement };
}
