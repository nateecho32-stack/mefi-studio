// A window for the Size and density suites: the real renderer/size.js, and the real
// appearance store sliced out of renderer/studio-ui.js (MefiAppearance), run in a vm
// over the shared fake DOM (tests/fixtures/renderer-dom.mjs). The host, the toasts,
// the navigation registry and the shell are stubs that record what they are asked.
//
//   const env = await loadSize({ layout: "v2", stored: { density: "compact" }, zoom: 1.1 });
//   env.window.MefiSize ...   env.calls ...   env.toasts ...   env.root (the html element)
//
// Options: layout ("v2" | "v1"), stored (what localStorage holds under
// mefiStudio.appearance: an object, a raw string, or null), brokenStorage (true makes
// every storage call throw), zoom (the host's factor, or null for a window with no
// host zoom), shell (a stub MefiShell or null), studioUi (false leaves MefiAppearance out).
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { Element, createDom, templateIds } from "./renderer-dom.mjs";

const sourceOf = async (name) => (await readFile(new URL(`../../renderer/${name}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
export const sizeSource = await sourceOf("size.js");
export const studioUiSource = await sourceOf("studio-ui.js");

// The appearance store exactly as studio-ui.js has it: from its key to the card that edits it.
export function appearanceSlice() {
  const from = studioUiSource.indexOf('  const appearanceKey = "mefiStudio.appearance";');
  const to = studioUiSource.indexOf("  function mountAppearance() {");
  if (from < 0 || to <= from) throw new Error("the appearance store markers moved in studio-ui.js");
  return studioUiSource.slice(from, to);
}

// MefiUi.plainError as studio-ui.js has it: the sentence to show for a failure.
export function plainErrorSlice() {
  const from = studioUiSource.indexOf("  function plainError(error, fallback");
  const to = studioUiSource.indexOf("  window.MefiUi = Object.assign", from);
  if (from < 0 || to <= from) throw new Error("the plainError markers moved in studio-ui.js");
  return studioUiSource.slice(from, to);
}

// A CSS declaration block that keeps custom properties, like the real one.
export function makeStyle() {
  const props = new Map();
  const style = {
    props,
    setProperty(name, value) { props.set(name, String(value)); },
    removeProperty(name) { const old = props.get(name) ?? ""; props.delete(name); return old; },
    getPropertyValue(name) { return props.get(name) ?? ""; },
  };
  return new Proxy(style, {
    get: (target, key) => (key in target ? target[key] : target.props.get(`prop:${String(key)}`)),
    set: (target, key, value) => { if (key in target) target[key] = value; else target.props.set(`prop:${String(key)}`, value); return true; },
  });
}

// The fake element has no after(); the page puts one row beside another with it.
Element.prototype.after = function after(node) {
  const siblings = this.parentNode?.children;
  if (!siblings) return;
  siblings.splice(siblings.indexOf(this) + 1, 0, node);
  node.parentNode = this.parentNode;
};

export async function loadSize({ layout = "v2", stored = null, brokenStorage = false, zoom = 1, shell = null, studioUi = true, nav = true, host = true, ready = "complete", template = true, densityRow = false } = {}) {
  const dom = createDom({ ids: template ? templateIds((id) => id.startsWith("size-")) : [] });
  const { document, elements, body, documentElement } = dom;
  const made = [];
  const withStyle = (node) => { node.style = makeStyle(); return node; };
  withStyle(documentElement); withStyle(body);
  document.createElement = (tag) => { const node = withStyle(new Element(tag)); made.push(node); return node; };
  document.createElementNS = document.createElement;
  // A page that is drawn by script is found by id wherever it sits under a known element.
  document.getElementById = (id) => {
    if (elements.has(id)) return elements.get(id);
    for (const root of elements.values()) { const hit = root.descendants().find((node) => node.id === id); if (hit) return hit; }
    for (const root of [body]) { const hit = root.descendants().find((node) => node.id === id); if (hit) return hit; }
    return null;
  };
  for (const node of elements.values()) withStyle(node);
  if (elements.has("size-overlay")) elements.get("size-overlay").hidden = true;
  // Settings > Appearance's own Density row, as studio-ui.js builds it: a label holding the select.
  let densityField = null;
  if (densityRow) {
    densityField = new Element("label"); densityField.className = "studio-field";
    const select = new Element("select", "studio-density"); select.id = "studio-density";
    densityField.append(new Element("span"), select);
    const holder = new Element("div"); holder.id = "settings-appearance-controls"; holder.append(densityField);
    body.append(holder);
  }
  if (layout) documentElement.dataset.layout = layout;
  documentElement.dataset.shell = "rail";

  const calls = [];
  const toasts = [];
  const events = [];
  const listeners = new Map();
  const added = [];
  const removed = [];
  const timers = [];
  const frames = [];
  const storage = new Map();
  if (stored !== null) storage.set("mefiStudio.appearance", typeof stored === "string" ? stored : JSON.stringify(stored));
  const writes = [];
  const localStorage = {
    getItem: (key) => { if (brokenStorage) throw new Error("storage is blocked"); return storage.has(key) ? storage.get(key) : null; },
    setItem: (key, value) => { if (brokenStorage) throw new Error("storage is blocked"); writes.push([key, String(value)]); storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
  };

  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  const window = {
    document, localStorage,
    innerWidth: 1440, innerHeight: 900,
    addEventListener(type, fn) { added.push(type); if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { removed.push(type); listeners.get(type)?.delete(fn); },
    dispatchEvent(event) { events.push(event); for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event); return true; },
  };
  window.window = window;

  // The host: the interface scale is the window's zoom.
  const host_ = { factor: zoom, pushed: null, failNext: null };
  if (host && zoom !== null) {
    window.mefiStudio = {
      uiZoom: async (payload) => { calls.push(["uiZoom", payload]); if (host_.failNext) { const error = host_.failNext; host_.failNext = null; if (error === "refuse") return { ok: false, error: "The window would not zoom." }; throw new Error(error); } host_.factor = Math.min(1.5, Math.max(0.7, Math.round(payload.factor * 20) / 20)); return { ok: true, factor: host_.factor }; },
      uiZoomGet: async () => { calls.push(["uiZoomGet"]); return { ok: true, factor: host_.factor }; },
      onUiZoom: (callback) => { calls.push(["onUiZoom"]); host_.pushed = callback; },
    };
  } else if (host) window.mefiStudio = {};
  window.MefiToast = (message, kind, options) => {
    const toast = { message, kind, options, dismissed: false, dismiss() { toast.dismissed = true; } };
    toasts.push(toast);
    return toast;
  };

  const registry = [];
  const claims = [];
  if (nav) {
    window.MefiNav = {
      register: (record) => { registry.push(record); return record; },
      get: (id) => registry.find((record) => record.id === id) ?? null,
      list: () => registry.slice(),
      go: (id, params) => { calls.push(["go", id, params]); return registry.find((record) => record.id === id)?.open?.(params); },
      close: (id) => { calls.push(["close", id]); },
      claim: (id) => { claims.push(["claim", id]); },
      release: (id) => { claims.push(["release", id]); },
      layout: { used: (name) => ({ list: 280, inspector: 388, tabs: 38, status: 28 })[name] ?? 0, fold: () => [] },
    };
  }
  if (shell) window.MefiShell = shell;

  const computed = new Map();
  const context = vm.createContext({
    window, document, localStorage, CustomEvent, console, Promise, Math, Number, String, Object, Array, JSON, Set, Map, Proxy, Error, parseFloat,
    getComputedStyle: (node) => ({ getPropertyValue: (name) => computed.get(name) ?? node?.style?.getPropertyValue?.(name) ?? "", paddingLeft: "0px", paddingRight: "0px", order: "0" }),
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
  });
  Object.assign(document, { readyState: ready, addEventListener: (type, fn) => { listeners.set(`document:${type}`, fn); } });

  if (studioUi) {
    vm.runInContext(`${"(function () {\n"}const schedule = () => {};\n${appearanceSlice()}\nwindow.MefiAppearance = { get: () => ({ ...appearance }), apply: applyAppearance };\n})();`, context);
  }
  vm.runInContext(`(function () {\n${plainErrorSlice()}\nwindow.MefiUi = { plainError };\n})();`, context);
  const flushFrames = () => { for (const fn of frames.splice(0)) fn(); };
  const load = () => vm.runInContext(sizeSource, context, { filename: "renderer/size.js" });
  const env = {
    window, document, documentElement, body, elements, calls, toasts, events, storage, writes, listeners, added, removed, timers, frames, registry, claims, host: host_, context, computed, dom,
    root: documentElement, flushFrames, densityField,
    get: (id) => document.getElementById(id),
    load,
    // What the window has pushed since: Ctrl + and Ctrl - arrive from the host like this.
    pushZoom: (factor) => host_.pushed?.({ factor }),
    tick: async () => { for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setImmediate(resolve)); },
    click: (id) => document.getElementById(id).click(),
    eventsOf: (type) => events.filter((event) => event.type === type),
    // The host calls of one name, as plain arguments.
    callsOf: (name) => calls.filter((call) => call[0] === name).map((call) => JSON.parse(JSON.stringify(call.slice(1)))),
    toastUndo: () => toasts.at(-1)?.options?.action,
    rootVars: () => Object.fromEntries([...documentElement.style.props.entries()].filter(([key]) => key.startsWith("--"))),
  };
  load();
  return env;
}

// Objects made inside the vm have another realm's prototype: compare plain copies.
export const plain = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
