// A bench for the Build sessions layout: renderer/panes.js and
// renderer/builder.js are classic scripts, so they run here the way the booklet
// runs them, inside a vm context whose `window`, `document` and storage are
// stand-ins. The fake DOM is the shared one (renderer-dom.mjs); this adds only
// what these two scripts lean on and that one leaves out:
//
//   *  a node that is appended again MOVES (panes carry their content between
//      the dock, a window and the shelf, and the builder moves Home's own
//      sections into panes; the shared Element would leave it in both places),
//   *  before() / after() / nextElementSibling,
//   *  timers, animation frames and storage that a test steps by hand, so no
//      test waits on a wall clock.
//
// Nothing here reads the network or the host. It is not a browser: geometry,
// the cascade and real pointer capture belong to the Electron fixtures.
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createDom, Element } from "./renderer-dom.mjs";

const RENDERER = new URL("../../renderer/", import.meta.url);

/** An element that behaves like a DOM node when it is added a second time. */
export class MovableElement extends Element {
  constructor(tag, id) {
    super(tag, id);
    // A style object that takes custom properties, as CSSStyleDeclaration does.
    this.style = { setProperty(name, value) { this[name] = value; } };
  }
  #detach(child) {
    const from = child && typeof child === "object" ? child.parentNode : null;
    if (!from) return;
    const list = from.children;
    const at = list.indexOf(child);
    if (at >= 0) list.splice(at, 1);
  }
  adopt(children) {
    for (const child of children) this.#detach(child);
    return super.adopt(children);
  }
  insertBefore(child, before) {
    this.#detach(child);
    const at = before ? this.children.indexOf(before) : -1;
    this.children.splice(at < 0 ? this.children.length : at, 0, ...super.adopt([child]));
    return child;
  }
  before(...nodes) { const parent = this.parentNode; for (const node of nodes) parent?.insertBefore(node, this); }
  after(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    let next = this.nextElementSibling;
    for (const node of nodes) parent.insertBefore(node, next);
  }
  /**
   * An event fires on the target and bubbles up through its ancestors (the page
   * body last), unless a listener stops it, as it does in a browser. The shared
   * Element fires the target's listeners only.
   */
  async trigger(name, event = {}) {
    let stopped = false;
    const ownStop = event.stopPropagation;
    const shared = { ...event, target: event.target ?? this, preventDefault: event.preventDefault ?? (() => {}), stopPropagation() { stopped = true; ownStop?.(); } };
    for (let node = this; node && !stopped; node = node.parentNode) {
      for (const listener of [...(node.listeners?.[name] ?? [])]) await listener({ ...shared, currentTarget: node });
    }
  }
  get childElementCount() { return this.children.length; }
  get previousElementSibling() {
    const siblings = this.parentNode?.children;
    return siblings ? siblings[siblings.indexOf(this) - 1] ?? null : null;
  }
  get nextElementSibling() {
    const siblings = this.parentNode?.children;
    return siblings ? siblings[siblings.indexOf(this) + 1] ?? null : null;
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A page and a context to run renderer scripts in.
 *   search    the query string the page was opened with ("?capture=1")
 *   storage   a Map standing in for localStorage (pass one to keep it across "launches")
 *   throwing  make every storage call throw, as a blocked profile does
 *   now       pin the page's clock to this instant (ms), so no test reads the wall clock
 */
export function createEnv({ search = "", storage = new Map(), throwing = false, ids = [], now = null, window: extras = {} } = {}) {
  const dom = createDom({ ids });
  const { document } = dom;
  document.createElement = (tag) => new MovableElement(tag);
  document.createElementNS = (_namespace, tag) => new MovableElement(tag);
  document.readyState = "complete";
  // A node looked up by id anywhere under the page, as the real document does.
  const found = document.getElementById;
  document.getElementById = (id) => found(id) ?? document.querySelector(`#${id}`);
  const node = (tag = "div", { id = "", className = "", parent = null } = {}) => {
    const element = new MovableElement(tag);
    if (id) element.id = id;
    if (className) element.className = className;
    if (parent) parent.append(element);
    return element;
  };

  const listeners = new Map();
  const dispatched = [];
  const frames = [], timeouts = [], intervals = [];
  const stored = {
    getItem: (key) => { if (throwing) throw new Error("storage is blocked"); return storage.has(key) ? storage.get(key) : null; },
    setItem: (key, value) => { if (throwing) throw new Error("storage is blocked"); storage.set(key, String(value)); },
    removeItem: (key) => { if (throwing) throw new Error("storage is blocked"); storage.delete(key); },
  };
  const window = {
    innerWidth: 1920, innerHeight: 1080,
    location: { search, reload() { window.reloaded = (window.reloaded ?? 0) + 1; } },
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
    removeEventListener(name, callback) { listeners.set(name, (listeners.get(name) ?? []).filter((item) => item !== callback)); },
    dispatchEvent(event) { dispatched.push(event); for (const callback of listeners.get(event.type) ?? []) callback(event); return true; },
    ...extras,
  };
  // `now` pins the page's clock: `new Date()` and `Date.now()` answer it.
  const PageDate = now === null ? Date : class extends Date {
    constructor(...args) { if (args.length) super(...args); else super(now); }
    static now() { return now; }
  };
  const context = vm.createContext({
    window, document, console, Date: PageDate,
    localStorage: stored,
    CSS: { escape: (value) => String(value) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    URLSearchParams,
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    setTimeout: (callback, delay) => { timeouts.push({ callback, delay }); return timeouts.length; },
    clearTimeout: () => {},
    setInterval: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
    clearInterval: () => {},
  });

  const sources = new Map();
  async function source(name) {
    if (!sources.has(name)) sources.set(name, await readFile(new URL(name, RENDERER), "utf8"));
    return sources.get(name);
  }
  return {
    window, document, context, dom, node, storage, dispatched, frames, timeouts, intervals,
    /** Run renderer/<name> as a classic script in this page. */
    async load(name) { vm.runInContext(await source(name), context, { filename: name }); return window; },
    /** Fire a window event to whoever listens (a page event a script waits for). */
    emit(type, detail) { const event = { type, detail }; for (const callback of listeners.get(type) ?? []) callback(event); },
    listeners: (type) => (listeners.get(type) ?? []).length,
    /** Run what the page queued for the next frame, and the zero-delay timers, once each. */
    flush() {
      for (let round = 0; round < 4; round += 1) {
        const now = frames.splice(0), later = timeouts.splice(0);
        if (!now.length && !later.length) return;
        for (const callback of now) callback(0);
        for (const { callback } of later) callback();
      }
    },
    settle,
  };
}

/**
 * The parts of the page these two scripts touch, laid out as
 * renderer/booklet.template.html lays them out: the menu rail (sections and
 * foot) and Home (top bar, conversation, the composer with its bottom row, the
 * queue, the dashboard and the drawer that holds Current task and App preview).
 * tests/builder_sessions.test.mjs checks every id and class here against the
 * template, so this cannot drift from it quietly.
 */
export const PAGE_IDS = [
  "app-rail", "app-rail-sections", "app-rail-foot",
  "workspace-layer", "workspace-attention-shortcut", "workspace-conversation-content", "workspace-thread", "workspace-queue-details",
  "workspace-dashboard", "workspace-form", "workspace-mode-chat", "workspace-mode-work", "workspace-composer-context", "workspace-input",
  "workspace-compose-hint", "workspace-task-outline", "workspace-plan-idea", "workspace-send", "workspace-activity-drawer",
  "workspace-focus-panel", "workspace-preview-panel", "walkthrough-invitation", "community-invitation",
];
export const PAGE_CLASSES = [
  "app-rail-sections", "app-rail-foot", "ws-main", "ws-topbar", "ws-top-actions", "ws-home-layout", "ws-columns", "ws-conversation",
  "ws-conversation-content", "ws-activity", "ws-secondary", "ws-work", "ws-composer", "ws-compose-top", "ws-compose-bottom", "ws-modes",
];

export function createPage(env) {
  const { document } = env;
  const at = (tag, id, className, parent) => env.node(tag, { id, className, parent });
  document.documentElement.dataset.shell = "rail";

  const rail = at("nav", "app-rail", "app-rail", document.body);
  const sections = at("div", "app-rail-sections", "app-rail-sections", rail);
  const foot = at("div", "app-rail-foot", "app-rail-foot", rail);

  const layer = at("section", "workspace-layer", "workspace", document.body);
  const main = at("div", "", "ws-main", layer);
  const top = at("div", "", "ws-topbar", main);
  const actions = at("div", "", "ws-top-actions", top);
  const attention = at("button", "workspace-attention-shortcut", "", actions);
  const homeLayout = at("div", "", "ws-home-layout", main);
  const columns = at("div", "", "ws-columns", homeLayout);
  const conversation = at("section", "", "ws-conversation", columns);
  const content = at("div", "workspace-conversation-content", "ws-conversation-content", conversation);
  const thread = at("div", "workspace-thread", "ws-thread", content);
  const recent = at("details", "", "ws-activity", content);
  const secondary = at("div", "", "ws-secondary", content);
  const queueDetails = at("details", "workspace-queue-details", "ws-home-disclosure", secondary);
  const queue = at("aside", "", "ws-work", queueDetails);
  const dashboard = at("section", "workspace-dashboard", "ws-dashboard", secondary);
  const walkthrough = at("section", "walkthrough-invitation", "walkthrough-invitation", secondary);
  const community = at("section", "community-invitation", "walkthrough-invitation community-invitation", secondary);

  const form = at("form", "workspace-form", "ws-composer", conversation);
  const composeTop = at("div", "", "ws-compose-top", form);
  const modes = at("div", "", "ws-modes", composeTop);
  const modeChat = at("button", "workspace-mode-chat", "", modes);
  const modeWork = at("button", "workspace-mode-work", "", modes);
  const context = at("span", "workspace-composer-context", "", composeTop);
  const input = at("textarea", "workspace-input", "", form);
  const bottom = at("div", "", "ws-compose-bottom", form);
  const hint = at("span", "workspace-compose-hint", "", bottom);
  const outline = at("button", "workspace-task-outline", "ghost mini", bottom);
  outline.hidden = true;
  const plan = at("button", "workspace-plan-idea", "ghost", bottom);
  const send = at("button", "workspace-send", "primary", bottom);
  send.type = "submit";

  const drawer = at("section", "workspace-activity-drawer", "ws-workflow", homeLayout);
  const focus = at("section", "workspace-focus-panel", "ws-focus-panel", drawer);
  const preview = at("section", "workspace-preview-panel", "ws-preview-panel", drawer);

  return {
    rail, sections, foot, layer, main, top, actions, attention, homeLayout, columns, conversation, content, thread, recent, secondary,
    queueDetails, queue, dashboard, walkthrough, community, form, composeTop, modes, modeChat, modeWork, context, input, bottom, hint, outline, plan,
    send, drawer, focus, preview,
    /** The ids of the row's children, in document order: what a layout change must not disturb. */
    bottomIds: () => bottom.children.map((child) => child.id || child.tagName),
  };
}
