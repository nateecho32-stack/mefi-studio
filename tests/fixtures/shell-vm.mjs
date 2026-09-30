// One vm page for the frame suites (renderer/shell.js, "layout v2"): the shared
// fake DOM, a window with the modules the frame asks (a stand-in for MefiNav's
// layout contract, MefiVibe, MefiWorkspace and the rest, or the real nav.js with
// `realNav`), timers and frames that only run when a test says so, and storage
// that can refuse. `setInterval` throws: the frame owns no timer, and a run that
// reaches one fails.
//
// The fake DOM is not a browser (tests/fixtures/renderer-dom.mjs): no layout, no
// cascade. Geometry that a test needs comes from `box(id, rect)`. Real geometry
// is tests/shell_render.test.mjs.
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom } from "./renderer-dom.mjs";

const lf = (text) => text.replace(/\r\n/g, "\n");
export const SHELL_SOURCE = lf(await readFile(new URL("../../renderer/shell.js", import.meta.url), "utf8"));
export const NAV_SOURCE = lf(await readFile(new URL("../../renderer/nav.js", import.meta.url), "utf8"));
// What the vm's objects say, in this realm, so deepStrictEqual compares values and not prototypes.
export const plain = (value) => JSON.parse(JSON.stringify(value));

const RANGES = { list: [0, 420], inspector: [0, 640], tabs: [0, 48], status: [0, 40] };
const REGION_VARIABLES = { list: "--shell-list-w", inspector: "--shell-inspector-w", tabs: "--shell-tabs-h", status: "--shell-status-h" };
const RAIL_IDS = ["app-rail", "app-rail-brand", "app-rail-sections", "app-rail-foot", "app-rail-pin", "app-local-nav", "vibe-rail", "workspace-sidebar", "workspace-layer"];

/**
 * options
 *   width, height     the window, in CSS px
 *   layout            whether v2 is on when the module loads (the contract's html[data-layout])
 *   shell             html[data-shell]: "rail" (default) or "" for classic
 *   mode              what MefiVibe.mode() says
 *   current           MefiNav.current()
 *   pinned, railW     the rail's pin and the width the stylesheet gives it (256 pinned, 64 not)
 *   railShown         whether the rail has a box (Vibe's own Home has none)
 *   localNav          whether the local navigation has a box on screen
 *   stored, storage   localStorage entries; storage: "throws" makes every access throw
 *   realNav           load the real renderer/nav.js instead of a stand-in
 *   search            location.search
 *   snapshot          what MefiWorkspace.snapshot() returns (null: no project read yet)
 *   extra             more window globals (MefiToday, MefiMusic, MefiAutonomy, MefiSize, ...)
 *   registry          destinations MefiNav.get() knows, by id
 *   ids               more ids the DOM has (workspace-pause, settings-layout-v2, ...)
 *   observers         define a MutationObserver stand-in
 *   readyState        document.readyState when shell.js loads ("loading" waits for DOMContentLoaded)
 *   run               false: do not load shell.js (the caller does, with `page.load()`)
 */
export function loadShell(options = {}) {
  const {
    width = 1440, height = 900, layout = true, shell = "rail", mode = "build", current = "workspace",
    pinned = false, railW = null, railShown = true, localNav = false,
    stored = {}, storage = "ok", realNav = false, search = "",
    extra = {}, registry = {}, ids = [], observers = false, readyState = "complete", run = true,
  } = options;
  const snapshot = "snapshot" in options ? options.snapshot : { projectId: "p1", project: { name: "Fixture" }, status: { running: [] }, assistant: {} };
  const { document, get } = createDom({ ids: [...RAIL_IDS, ...ids] });
  const lookupId = document.getElementById;
  document.getElementById = (id) => lookupId(id) ?? document.querySelector(`#${id}`);
  const root = document.documentElement;
  const props = {};
  root.removeAttribute = ((original) => (key) => { original.call(root, key); if (String(key).startsWith("data-")) delete root.dataset[String(key).slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; })(root.removeAttribute);
  root.style = { props, setProperty: (name, value) => { props[name] = String(value); }, removeProperty: (name) => { delete props[name]; }, getPropertyValue: (name) => props[name] ?? "" };
  // Focus moves document.activeElement, as a browser's does.
  // A node is connected while the body is among its ancestors, and taking the focused node out of the page puts focus back on nothing.
  const focusable = (node) => {
    node.focus = function focus() { this.focused = true; document.activeElement = this; };
    node.blur = function blur() { this.focused = false; if (document.activeElement === this) document.activeElement = null; };
    Object.defineProperty(node, "isConnected", { get() { for (let walk = this; walk; walk = walk.parentNode) if (walk === document.body) return true; return false; }, configurable: true });
    const remove = node.remove.bind(node);
    node.remove = function removeNode() { if (document.activeElement && this.contains(document.activeElement)) document.activeElement = null; remove(); };
    unsetData(node);
    moving(node);
    return node;
  };
  // Adding a node that already has a parent moves it, as a browser's append does (the stand-in would list it twice).
  const detach = (child) => {
    if (!child || typeof child !== "object" || !child.parentNode) return;
    const siblings = child.parentNode.children;
    const at = siblings.indexOf(child);
    if (at >= 0) siblings.splice(at, 1);
    child.parentNode = null;
  };
  const moving = (node) => {
    for (const name of ["append", "prepend"]) { const original = node[name].bind(node); node[name] = (...children) => { children.forEach(detach); original(...children); }; }
    const insertBefore = node.insertBefore.bind(node);
    node.insertBefore = (child, before) => { detach(child); return insertBefore(child, before); };
  };
  // removeAttribute("data-x") takes the dataset key away too, as a browser's does.
  const unsetData = (node) => {
    const removeAttribute = node.removeAttribute.bind(node);
    node.removeAttribute = (key) => { removeAttribute(key); if (String(key).startsWith("data-")) delete node.dataset[String(key).slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; };
  };
  const makeElement = document.createElement;
  document.createElement = (tag) => focusable(makeElement(tag));
  const makeNamespaced = document.createElementNS;
  document.createElementNS = (namespace, tag) => focusable(makeNamespaced(namespace, tag));
  for (const id of [...RAIL_IDS, ...ids]) focusable(get(id));
  get("app-rail").append(get("app-rail-brand"), get("app-rail-sections"), get("app-rail-foot"), get("app-rail-pin"));
  document.body.append(get("app-rail"), get("app-local-nav"));
  get("app-local-nav").hidden = !localNav;
  const rail = pinned ? 256 : 64;
  // What follows the rail in the body, as a browser says it: the frame is put right behind the rail.
  Object.defineProperty(get("app-rail"), "nextSibling", { get: () => document.body.children[document.body.children.indexOf(get("app-rail")) + 1] ?? null, configurable: true });
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) });
  get("app-rail").getBoundingClientRect = () => (railShown ? rect(0, 0, railW ?? rail, window.innerHeight) : rect(0, 0, 0, 0));
  get("app-local-nav").getBoundingClientRect = () => (localNav ? rect(railW ?? rail, 0, window.innerWidth, 56) : rect(0, 0, 0, 0));
  get("vibe-rail").getBoundingClientRect = () => rect(0, 0, 0, 0);
  const store = new Map(Object.entries(stored));
  const reads = [], writes = [];
  const localStorage = {
    getItem: (key) => { reads.push(key); if (storage === "throws") throw new Error("blocked"); return store.has(key) ? store.get(key) : null; },
    setItem: (key, value) => { writes.push(key); if (storage === "throws") throw new Error("quota"); store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
  const listeners = {}, added = [], events = [], toasts = [], reloads = [];
  const timers = [], frames = [];
  let timerId = 0, frameId = 0;
  const window = {
    innerWidth: width, innerHeight: height,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); added.push(type); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] ?? []).filter((item) => item !== fn); },
    dispatchEvent(event) { events.push({ type: event.type, detail: event.detail }); for (const fn of [...(listeners[event.type] ?? [])]) fn(event); return true; },
    location: { search, reload: () => reloads.push("reload") },
    MefiToast: (...args) => { toasts.push(args); },
    MefiWorkspace: { isActive: () => false, snapshot: () => page.snapshot },
    MefiIdle: { isActive: () => false },
    MefiBooklet: { showTab() {} },
    ...extra,
  };
  const page = { snapshot, mode, current, fold: null, layoutOn: layout, paletteOpen: false, taskContext: null };
  const calls = { layoutSet: [], go: [], vibe: [], registered: [], setLayout: [], saveResume: 0, toggle: [], pin: [] };
  const vibeStand = { mode: () => page.mode, setMode: (next, opts) => { calls.vibe.push([next, opts ? { ...opts } : undefined]); page.mode = next; root.dataset.uiMode = next; } };
  if (options.vibe !== false) window.MefiVibe = { ...vibeStand, ...(extra.MefiVibe ?? {}) };
  // The computed style the stylesheet would give: the rail and the local navigation, the regions as written.
  const sheet = { "--shell-rail-w": `${railW ?? rail}px`, "--shell-local-h": "56px" };
  const getComputedStyle = () => ({
    getPropertyValue(name) {
      if (root.dataset.layout === "v2" && window.innerWidth < 900 && (name === "--shell-list-w" || name === "--shell-inspector-w")) return "0px";
      if (name in props) return props[name];
      if (name in sheet) return sheet[name];
      return Object.values(REGION_VARIABLES).includes(name) ? "0px" : "";
    },
  });
  class Observer {
    constructor(callback) { this.callback = callback; this.options = null; page.observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.gone = true; }
  }
  page.observers = [];
  const context = vm.createContext({
    window, document, console, getComputedStyle,
    location: window.location,
    localStorage,
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    URLSearchParams,
    setTimeout: (fn, delay = 0) => { const id = ++timerId; timers.push({ id, fn, delay }); return id; },
    clearTimeout: (id) => { const at = timers.findIndex((timer) => timer.id === id); if (at >= 0) timers.splice(at, 1); },
    setInterval: () => { throw new Error("the frame owns no interval"); },
    clearInterval() {},
    requestAnimationFrame: (fn) => { const id = ++frameId; frames.push({ id, fn }); return id; },
    cancelAnimationFrame: (id) => { const at = frames.findIndex((frame) => frame.id === id); if (at >= 0) frames.splice(at, 1); },
    ...(observers ? { MutationObserver: Observer } : {}),
  });
  window.matchMedia = (query) => ({ matches: window.innerWidth <= Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1]) });
  if (shell) root.dataset.shell = shell;
  if (mode === "vibe") root.dataset.uiMode = "vibe";
  if (pinned) root.dataset.railPinned = "";

  if (realNav) {
    document.readyState = "loading";
    vm.runInContext(NAV_SOURCE, context);
    if (shell) window.MefiNav.applyShell(true);
    if (layout) window.MefiNav.applyLayout(true);
    else window.MefiNav.applyLayout(false);
  } else {
    const applied = { list: 0, inspector: 0, tabs: 0, status: 0 };
    const folded = () => (page.fold ?? (window.innerWidth < 900 ? ["list", "inspector"] : []));
    const destinations = new Map(Object.entries(registry));
    window.MefiNav = {
      layout: {
        on: () => page.layoutOn,
        fold: () => folded(),
        MAIN_MIN: 320, RANGES, FOLD_BELOW: 900,
        set(name, value) {
          calls.layoutSet.push([name, value]);
          const range = RANGES[name];
          if (!range) return 0;
          const next = Math.max(range[0], Math.min(range[1], Math.round(Number(value) || 0)));
          applied[name] = next;
          return next;
        },
        used(name) {
          const one = (region) => ((region === "list" || region === "inspector") && folded().includes(region) ? 0 : applied[region]);
          return name ? one(name) : { list: one("list"), inspector: one("inspector"), tabs: one("tabs"), status: one("status") };
        },
        get: () => ({ ...applied }),
      },
      state: { transient: false },
      current: () => page.current,
      get: (id) => destinations.get(id) ?? null,
      go: (...args) => { calls.go.push(plain(args)); return Promise.resolve(true); },
      toggle: (id) => { calls.toggle.push(String(id)); return true; },
      register: (destination) => { calls.registered.push(destination); destinations.set(destination.id, destination); },
      setLayout: (value) => { calls.setLayout.push(value); },
      saveResume: () => { calls.saveResume += 1; },
      setRailPinned: (value) => { calls.pin.push(value); },
      taskContext: () => page.taskContext,
      usable: () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight }),
    };
    window.MefiNav.get("palette") ?? destinations.set("palette", { id: "palette", isOpen: () => page.paletteOpen });
  }
  document.readyState = readyState;

  Object.assign(page, {
    window, document, root, context, props, store, reads, writes, listeners, added, events, toasts, reloads, timers, frames, calls, get,
    nav: window.MefiNav,
    $: (id) => document.getElementById(id),
    load() { vm.runInContext(SHELL_SOURCE, context); return window.MefiShell; },
    resize(next) { Object.assign(window, next); for (const fn of [...(listeners.resize ?? [])]) fn({ type: "resize" }); },
    // The box a stand-in has: the frame reads the top bar's, the rail's and the local navigation's.
    box(id, size) { document.getElementById(id).getBoundingClientRect = () => rect(size.left ?? 0, size.top ?? 0, (size.left ?? 0) + size.width, (size.top ?? 0) + size.height); },
    // Everything a timer or a frame was waiting for, in order, until there is nothing left.
    flush() { for (let guard = 0; guard < 50 && (timers.length || frames.length); guard += 1) { for (const { fn } of timers.splice(0)) fn(); for (const { fn } of frames.splice(0)) fn(); } },
    frame() { for (const { fn } of frames.splice(0)) fn(); },
    key(init) {
      const event = { type: "keydown", key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, target: document.body, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...init };
      window.dispatchEvent(event);
      return event;
    },
    // A press anywhere (the menu closes on one outside it).
    press(target) { return document.body.trigger("pointerdown", { target }); },
    region: (name) => window.MefiShell?.region?.(name) ?? null,
    regions: () => Object.fromEntries(Object.entries(REGION_VARIABLES).map(([name, variable]) => [name, props[variable]])),
    shown: (node) => { for (let walk = node; walk; walk = walk.parentNode) if (walk.hidden) return false; return Boolean(node); },
    texts: (node) => node.descendants().filter((child) => child.ownText).map((child) => child.ownText),
  });
  if (run) page.load();
  if (readyState === "loading") page.dispatchReady = () => { document.readyState = "complete"; for (const fn of [...(document.body.listeners.DOMContentLoaded ?? [])]) fn({ type: "DOMContentLoaded" }); };
  return page;
}
