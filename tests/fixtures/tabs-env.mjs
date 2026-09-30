// A bench for renderer/tabs.js: the strip runs here the way the booklet runs it, in a vm whose `window`, `document`
// and storage are stand-ins (the shared fake DOM, through builder-env.mjs), against a STUB MefiNav (a registry, go(),
// current(), the mefi:nav events a real go() sends) and a STUB MefiShell (a region for the strip, resize(), mount()).
// Nothing here is the real nav.js or shell.js: this pins the strip's own logic, and what it needs from those two is the
// interface in docs/unified-studio.md and the brief. Geometry, the cascade and real pointer input belong to
// tests/tabs_render.test.mjs.
//
// Time and timers are the page's own stand-ins, stepped by hand: advance(ms) moves the clock and runs what is due,
// frames() runs the repaints the strip asked for, settle() lets the microtasks the strip queued (its look at where
// the app is) finish and then paints.
import { createEnv, MovableElement } from "./builder-env.mjs";

// The registry a real Studio has, in the parts the strip reads: a kind, a layer, a section, a glyph, the showIn flags.
const show = (parts) => ({ tabs: false, tools: false, dock: false, palette: false, help: false, footer: false, ...parts });
export const REGISTRY = [
  { id: "workspace", label: "Home", short: "Home", kind: "view", layer: null, section: "home", glyph: "g-home", showIn: show({ dock: true, palette: true }) },
  { id: "vibe", label: "Vibe", short: "Vibe", kind: "view", layer: null, section: "home", glyph: "g-spark", showIn: show({ palette: true }) },
  { id: "command", label: "Command view", short: "Command", kind: "view", layer: null, section: "agents", glyph: "g-orbit", showIn: show({ palette: true }) },
  { id: "tasks", label: "Task board", short: "Tasks", kind: "overlay", layer: "sheet", section: "work", glyph: "g-tasks", showIn: show({ tools: true, palette: true }) },
  { id: "plans", label: "Plans", short: "Plans", kind: "overlay", layer: "sheet", section: "work", glyph: "g-plans", showIn: show({ tools: true, palette: true }) },
  { id: "worktrees", label: "Worktrees", short: "Worktrees", kind: "overlay", layer: "sheet", section: "work", glyph: "g-worktree", showIn: show({ tools: true, palette: true }), searchTerms: "branches checkout merge" },
  { id: "fleet", label: "Fleet", short: "Fleet", kind: "overlay", layer: "sheet", section: "agents", glyph: "g-fleet", showIn: show({ tools: true, palette: true }) },
  { id: "explorer", label: "Session explorer", short: "Sessions", kind: "overlay", layer: "sheet", section: "agents", glyph: "g-explorer", showIn: show({ tools: true, palette: true }) },
  { id: "agents", label: "Agents", short: "Agents", kind: "overlay", layer: "sheet", section: "agents", glyph: "g-agents", showIn: show({ tools: true, palette: true }) },
  { id: "studio", label: "Settings", short: "Settings", kind: "tab", layer: null, section: "settings", glyph: "g-sliders", showIn: show({ dock: true, palette: true }) },
  { id: "booklet", label: "Model catalog", short: "Catalog", kind: "tab", layer: null, section: "agents", glyph: "g-booklet", showIn: show({ dock: true, palette: true }) },
  { id: "graph", label: "Performance", short: "Performance", kind: "tab", layer: null, section: "agents", glyph: "g-graph", showIn: show({ dock: true, palette: true }) },
  { id: "palette", label: "Search Studio", short: "Search", kind: "overlay", layer: "transient", section: "help", glyph: "g-search", showIn: show({ tools: true, palette: true }) },
  { id: "config", label: "Configuration", short: "Configuration", kind: "overlay", layer: "transient", section: "settings", glyph: "g-sliders", showIn: show({ palette: true }) },
  { id: "friends", label: "Friends", short: "Friends", kind: "action", layer: null, section: "friends", glyph: "g-orbit", showIn: show({ palette: true }) },
  { id: "music", label: "Appearance", short: "Appearance", kind: "action", layer: null, section: "settings", glyph: "g-style", showIn: show({ palette: true }) },
  { id: "secret", label: "Hidden page", short: "Hidden", kind: "tab", layer: null, section: "settings", glyph: "g-help", showIn: show({ palette: true }), hidden: () => true },
];
const SECTIONS = { home: "Home", work: "Work", agents: "Agents", friends: "Friends", settings: "Settings", help: "Help" };

export const task = (id, extra = {}) => ({ id, projectId: "p1", title: `Task ${id}`, prompt: `Do ${id}`, status: "open", createdAt: 1000, updatedAt: 1000, ...extra });

/**
 * options
 *   layout    "v2" (default) or null for v1
 *   shell     false leaves MefiShell out
 *   storage   a Map kept across "launches"
 *   project   the active project id ("p1"); null for none yet
 *   tasks     the board
 *   assistant the assistant's state at launch (its open questions, its needs-you digest); {} is "not arrived yet"
 *   start     the clock's first instant (ms)
 *   autoStart false: load the script and leave start() to the test
 *   vibe      Home is Vibe in this window (go("workspace") lands on "vibe")
 *   host      { prefsGet } the host's answer (window.mefiStudio)
 *   readyState  the document's (default "complete"; "loading" makes the script wait for DOMContentLoaded)
 *   throwing  every localStorage call throws, as a blocked profile's does
 *   shellActive what MefiShell.active() says (default true)
 *   lateRegion  MefiShell has no mount() and draws its tab region only when the test says so (bench.revealRegion())
 */
export async function tabsEnv({ layout = "v2", shell = true, storage = new Map(), project = "p1", tasks = [], assistant = { questions: [] }, start = 1_700_000_000_000, autoStart = true, vibe = false, host = null, registry = REGISTRY, extras = {}, readyState = "complete", lateRegion = false, shellActive = true, throwing = false } = {}) {
  const env = createEnv({ storage, now: start, throwing });
  const { window, document, context } = env;
  const clock = { t: start };
  context.Date = class extends Date { constructor(...args) { if (args.length) super(...args); else super(clock.t); } static now() { return clock.t; } };
  const timers = new Map(); let timerId = 0;
  context.setTimeout = (callback, delay = 0) => { const id = ++timerId; timers.set(id, { callback, at: clock.t + delay, delay }); return id; };
  context.clearTimeout = (id) => { timers.delete(id); };
  const frameQueue = new Map(); let frameId = 0;
  context.requestAnimationFrame = (callback) => { const id = ++frameId; frameQueue.set(id, callback); return id; };
  context.cancelAnimationFrame = (id) => { frameQueue.delete(id); };
  // addEventListener on the document honours { once: true }, as a browser's does (the shared fake does not)
  const addToDocument = document.addEventListener;
  document.addEventListener = (name, callback, options) => {
    if (!options?.once) { addToDocument(name, callback); return; }
    const once = (event) => { document.removeEventListener(name, once); return callback(event); };
    addToDocument(name, once);
  };
  // The two observers the strip uses where a browser has them, and a computed style that answers the custom properties a test sets.
  const mutationObservers = [], resizeObservers = [];
  context.MutationObserver = class { constructor(callback) { this.callback = callback; mutationObservers.push(this); } observe(target, options) { this.target = target; this.options = options; } disconnect() { this.disconnected = true; } };
  context.ResizeObserver = class { constructor(callback) { this.callback = callback; resizeObservers.push(this); } observe(target) { this.target = target; } disconnect() { this.disconnected = true; } };
  const css = {};
  context.getComputedStyle = () => ({ getPropertyValue: (name) => css[name] ?? "" });
  // focus() moves document.activeElement, as a browser's does
  MovableElement.prototype.focus = function focus() { this.focused = true; document.activeElement = this; };
  MovableElement.prototype.blur = function blur() { this.focused = false; if (document.activeElement === this) document.activeElement = null; };

  const events = [];
  const toasts = [];
  window.MefiToast = (message, kind, options = {}) => {
    const toast = { message, kind, options, dismissed: false };
    toasts.push(toast);
    return { dismiss() { toast.dismissed = true; } };
  };
  const board = { tasks: [...tasks], projectId: project, assistant, backlog: null };
  window.MefiWorkspace = { activeProjectId: () => board.projectId, state: { get activeId() { return board.projectId; } }, snapshot: () => ({ projectId: board.projectId, project: null, projects: [], tasks: board.tasks, ideas: [], assistant: board.assistant, status: {}, backlog: board.backlog, preview: null }), isActive: () => true };

  // ---- the stub MefiNav ----
  const calls = [];
  const nav = {
    state: { sheet: null, transient: null },
    page: "workspace",
    vibe,
    registered: [],
    calls,
    get: (id) => registry.find((record) => record.id === id) || null,
    list: () => registry.slice(),
    sectionLabel: (dest) => SECTIONS[dest.section] ?? null,
    sectionRank: (dest) => Object.keys(SECTIONS).indexOf(dest.section),
    usable: () => ({ left: 64, top: 94, right: window.innerWidth, bottom: window.innerHeight - 28, width: window.innerWidth - 64, height: window.innerHeight - 122 }),
    register(record) { nav.registered.push(record); return record; },
    current() { return nav.state.sheet ?? nav.page; },
    deferGo: false, // the page takes a while: go() is asked, nothing shows yet (bench.arrive() lets it)
    go(id, params = {}) {
      calls.push([id, JSON.parse(JSON.stringify(params))]);
      if (id === "workspace" && nav.vibe) id = "vibe";
      const dest = nav.get(id);
      if (!dest) return undefined;
      if (nav.deferGo) { nav.pending = { id, params }; return undefined; }
      if (dest.kind === "action") { window.dispatchEvent({ type: "mefi:nav", detail: { id, action: "open", params } }); return undefined; }
      if (dest.layer === "transient") { nav.state.transient = id; window.dispatchEvent({ type: "mefi:nav", detail: { id, action: "open", params: {} } }); return undefined; }
      if (dest.kind === "overlay") {
        const before = nav.state.sheet;
        nav.state.sheet = id;
        if (before && before !== id) window.dispatchEvent({ type: "mefi:nav", detail: { id: before, action: "close", params: {} } });
        window.dispatchEvent({ type: "mefi:nav", detail: { id, action: "open", params: {} } });
        return undefined;
      }
      const before = nav.state.sheet;
      nav.state.sheet = null; nav.page = id;
      if (before) window.dispatchEvent({ type: "mefi:nav", detail: { id: before, action: "close", params: {} } });
      window.dispatchEvent({ type: "mefi:nav", detail: { id, action: "open", params } });
      return undefined;
    },
    // Esc on a sheet: the page underneath is what shows, and nobody announces a route
    closeSheet() { const id = nav.state.sheet; nav.state.sheet = null; window.dispatchEvent({ type: "mefi:nav", detail: { id, action: "close", params: {} } }); },
    // a page that opens itself (showTab, Workspace.enter): no mefi:nav at all, only what is showing changes
    quietly(page, sheet = null) { nav.page = page; nav.state.sheet = sheet; },
  };
  window.MefiNav = nav;

  // ---- the stub MefiShell ----
  const regions = Object.fromEntries(["tabs", "main", "list"].map((name) => [name, env.node("div", { id: `shell-${name}`, parent: document.body })]));
  const sizes = { tabs: 0 };
  const resizes = [];
  const mounts = [];
  let revealed = !lateRegion;
  const stubShell = {
    active: () => shellActive,
    region: (name) => (name === "tabs" && !revealed ? null : regions[name] ?? null),
    mount: lateRegion ? undefined : function mount(region, key, element, options) {
      const handle = { region, key, element, options, shown: true, unmounted: false, show() { handle.shown = true; }, hide() { handle.shown = false; }, unmount() { handle.unmounted = true; element.remove(); } };
      regions[region]?.append(element);
      mounts.push(handle);
      return handle;
    },
    resize(region, px) { sizes[region] = px; resizes.push([region, px]); window.dispatchEvent({ type: "mefi:shell-layout", detail: { region, px } }); return px; },
    size: (region) => sizes[region] ?? 0,
    onChange: () => () => {},
  };
  if (shell) window.MefiShell = stubShell;
  if (layout) document.documentElement.dataset.layout = layout;
  document.readyState = readyState;
  if (host) window.mefiStudio = host;
  Object.assign(window, extras);

  // Geometry, in numbers, for the tests that need the strip to have a width: measure() gives the tab list a width and every
  // tab a width (Home, a pinned tab and the rest differ, as in the stylesheet), and getBoundingClientRect() answers from that.
  const geometry = { on: false, width: 600, tab: 140, pinned: 64, home: 88 };
  const isItem = (node) => String(node.className).split(" ").includes("ts-item");
  const itemWidth = (item) => (item.dataset.home ? geometry.home : item.dataset.pinned ? geometry.pinned : geometry.tab);
  const shownItems = (list) => list.children.filter((child) => isItem(child) && !child.hidden);
  const fakeRect = (left, width) => ({ x: left, y: 0, left, top: 0, right: left + width, bottom: 38, width, height: 38 });
  const plainRect = MovableElement.prototype.getBoundingClientRect;
  MovableElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (geometry.on && isItem(this) && this.parentNode) {
      let left = 0;
      for (const item of shownItems(this.parentNode)) { if (item === this) return fakeRect(left, itemWidth(item)); left += itemWidth(item); }
      return fakeRect(0, 0);
    }
    if (geometry.on && String(this.className).split(" ").includes("ts-list")) return fakeRect(0, geometry.width);
    return plainRect.call(this);
  };

  const bench = {
    env, window, document, context, storage, clock, nav, toasts, board, regions, sizes, resizes, mounts, shell: stubShell, events, timers, calls, css, mutationObservers, resizeObservers,
    /** Give the strip a width: { width: the list's, tab, pinned, home: each kind of tab's }. Repaints, so the fit is redone. */
    measure(options = {}) {
      Object.assign(geometry, { on: true }, options);
      const list = document.querySelector(".ts-list");
      Object.defineProperty(list, "clientWidth", { configurable: true, get: () => geometry.width });
      Object.defineProperty(list, "scrollWidth", { configurable: true, get: () => shownItems(list).reduce((sum, item) => sum + itemWidth(item), 0) });
      window.MefiTabs.flush();
      return geometry;
    },
    /** The page that go() was asked for arrives, the way a view that opens after a beat does. */
    arrive() { const { id, params } = nav.pending; nav.pending = null; nav.deferGo = false; nav.go(id, params); },
    revealRegion() { revealed = true; },
    /** The body's class or data-sheet changed without a word from go(): the watcher nav.js and the strip share fires. */
    mutate() { for (const observer of mutationObservers) if (!observer.disconnected) observer.callback([]); },
    get tabs() { return window.MefiTabs; },
    /** Let the strip's queued look at the app finish, then paint what it asked for. */
    async settle() { await new Promise((resolve) => setImmediate(resolve)); bench.frames(); await new Promise((resolve) => setImmediate(resolve)); },
    frames() { for (const [id, callback] of [...frameQueue]) { frameQueue.delete(id); callback(clock.t); } },
    /** Move the clock and run the timers that come due. */
    async advance(ms) {
      const target = clock.t + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        clock.t = Math.max(clock.t, due[1].at); timers.delete(due[0]); due[1].callback();
      }
      clock.t = target;
      await bench.settle();
    },
    strip: () => document.querySelector(".ts-strip"),
    items: () => [...(document.querySelector(".ts-list")?.children ?? [])].filter((node) => node.className.includes("ts-item")),
    /** What the strip says: each tab's words, in order. */
    titles: () => bench.items().filter((item) => !item.hidden).map((item) => item.querySelector(".ts-title").textContent),
    active: () => bench.items().find((item) => item.dataset.active)?.querySelector(".ts-title").textContent ?? null,
    itemOf: (title) => bench.items().find((item) => item.querySelector(".ts-title").textContent === title) ?? null,
    tabOf: (title) => bench.itemOf(title)?.querySelector(".ts-tab") ?? null,
    async click(node) { await node.trigger("click", { target: node }); await bench.settle(); },
    /** A window key event, the way nav.js hears them. Returns the event so a test can see what was prevented. */
    key(init) {
      const event = { type: "keydown", key: "", code: "", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false, target: document.body, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...init };
      window.dispatchEvent(event);
      return event;
    },
    /** Open a place the way a click in the app does. */
    async go(id, params) { nav.go(id, params); await bench.settle(); },
    popover: () => document.querySelector(".ts-pop"),
    stored: (key) => { const raw = storage.get(key); return raw === undefined ? undefined : JSON.parse(raw); },
  };
  await env.load("tabs.js");
  if (autoStart) await bench.settle();
  return bench;
}
