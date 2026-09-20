// A project switch is a store switch: the tree must drop the previous folder's
// sessions and rebuild from the new project's read, and ready() must track that
// reload so the Command view never takes a snapshot of the old folder.
import test from "node:test";
import assert from "node:assert/strict";

function element(id) {
  const listeners = {};
  const attrs = {};
  const el = {
    id,
    listeners,
    attrs,
    hidden: false,
    textContent: "",
    title: "",
    style: {},
    children: [],
    clientWidth: 420,
    clientHeight: 600,
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
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
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 420, height: 600 }),
  };
  return el;
}

test("a project switch reloads the rail from the new folder and ready() awaits it", async () => {
  const canvas = element("tree-canvas");
  const gradient = { addColorStop() {} };
  canvas.getContext = () =>
    new Proxy(
      {},
      {
        get(target, prop) {
          if (prop in target) return target[prop];
          return () => gradient;
        },
        set(target, prop, value) {
          target[prop] = value;
          return true;
        },
      }
    );
  const rail = element("tree-rail");
  const stats = element("tree-stats");
  const registry = { "tree-canvas": canvas, "tree-rail": rail, "tree-stats": stats };
  const listeners = {};
  const dispatched = [];
  const updatedAt = Date.now();
  let sessions = [{ id: "a1", title: "Alpha session", timeUpdated: updatedAt, parentId: null }];
  const todos = [];
  let sessionReads = 0;

  globalThis.window = {
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener() {},
    dispatchEvent(event) {
      dispatched.push(event);
      for (const fn of listeners[event.type] ?? []) fn(event);
      return true;
    },
    matchMedia: () => ({ matches: false }),
    mefiStudio: {
      eyesState: async () => { sessionReads += 1; return { ok: true, sessions, todos }; },
      assistantState: async () => ({ ok: false }),
      assistantFocus: () => null,
      onCheckpoints: () => {},
      onEyesActivity: () => {},
      onAssistant: () => {},
      eyesCheckpointsRead: async () => ({ checkpoints: {} }),
    },
  };
  globalThis.document = {
    hidden: false,
    body: { classList: { contains: () => false } },
    getElementById: (id) => registry[id] ?? null,
    createElement: () => element(null),
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.requestAnimationFrame = () => 0;

  await import(new URL("../renderer/tree3d.js?project-switch-test", import.meta.url).href);
  const tree = globalThis.window.MefiTree;
  assert.ok(tree, "tree3d.js must expose window.MefiTree");

  await tree.init();
  await tree.ready();
  assert.ok(tree.snapshot().nodes.some((node) => node.id === "a1"), "the first project's session is on the rail");
  assert.equal(sessionReads, 1);

  // The startup adoption names the folder already loaded: no reload, no clear.
  window.dispatchEvent(new CustomEvent("mefi:project-changed", { detail: { projectId: "project-a" } }));
  await Promise.resolve();
  assert.equal(sessionReads, 1, "adopting the loaded folder does not re-read the store");
  assert.ok(tree.snapshot().nodes.some((node) => node.id === "a1"));

  // A session selected in the old folder must not survive the switch.
  window.dispatchEvent(new CustomEvent("mefi:tree-select", { detail: { sessionId: "a1" } }));
  assert.equal(tree.activeSession(), "a1");

  sessions = [{ id: "b1", title: "Beta session", timeUpdated: updatedAt + 1, parentId: null }];
  window.dispatchEvent(new CustomEvent("mefi:project-changed", { detail: { projectId: "project-b" } }));
  await tree.ready();
  assert.equal(sessionReads, 2, "the switch reads the new folder's store exactly once");
  const ids = tree.snapshot().nodes.map((node) => node.id);
  assert.ok(ids.includes("b1"), "the new folder's session is on the rail");
  assert.ok(!ids.includes("a1"), "the previous folder's session left the rail");
  assert.equal(tree.activeSession(), null, "a selection from the old folder is dropped");
});
