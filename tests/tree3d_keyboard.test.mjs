// Tree-rail keyboard + ARIA pass, driven for real: renderer/tree3d.js runs
// against a minimal DOM stub, synthetic keydown events walk the rail, and the
// assertions watch the selection (mefi:tree-select / activeSession) and the
// roving aria-activedescendant change under them. No Electron, no canvas.
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

test("tree rail: arrows move the focus, Enter/Space activate, ARIA follows", async () => {
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
  const sessions = [
    { id: "s1", title: "Alpha session", timeUpdated: updatedAt, parentId: null },
    { id: "s2", title: "Beta session", timeUpdated: updatedAt - 1, parentId: null },
  ];
  const todos = [
    { sessionId: "s1", position: 0, content: "first thing", status: "in_progress" },
    { sessionId: "s2", position: 0, content: "second thing", status: "pending" },
  ];
  let finishAssistant;
  const assistantRead = new Promise((resolve) => { finishAssistant = resolve; });
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
      assistantState: () => assistantRead,
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

  await import(new URL("../renderer/tree3d.js?keyboard-test", import.meta.url).href);
  const tree = globalThis.window.MefiTree;
  assert.ok(tree, "tree3d.js must expose window.MefiTree");

  const initializing = tree.init();
  let ready = false;
  tree.ready().then(() => { ready = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sessionReads, 1, "session reads start while assistant organisation is still loading");
  assert.equal(ready, false, "Command must wait for the first organised graph");
  finishAssistant({ ok: false });
  await initializing;
  await tree.ready();
  assert.equal(ready, true);
  assert.ok(tree.snapshot().nodes.some((node) => node.id === "s1"), "ready includes the populated graph");
  await tree.reload();

  // the container is a labelled, focusable tree owning the hidden treeitem
  assert.equal(canvas.attrs.role, "tree");
  assert.equal(canvas.attrs.tabindex, "0");
  assert.equal(canvas.attrs["aria-label"], "Session tree");
  assert.equal(canvas.attrs["aria-owns"], "tree-kbd-item");
  const proxy = rail.children.find((child) => child.id === "tree-kbd-item");
  assert.ok(proxy, "the hidden treeitem proxy exists in the rail");
  assert.equal(proxy.attrs.role, "treeitem");
  assert.ok(String(proxy.attrs["aria-label"] ?? "").length > 0, "the owned treeitem carries a label before the first navigation");

  const keydown = (key) => {
    const event = { key, preventDefault() { event.defaultPrevented = true; } };
    for (const handler of canvas.listeners.keydown ?? []) handler(event);
    return event;
  };
  const lastSelect = () => [...dispatched].reverse().find((event) => event.type === "mefi:tree-select")?.detail ?? null;

  // no focus yet: the first ArrowDown lands on the root, with the scroll eaten
  const first = keydown("ArrowDown");
  assert.equal(first.defaultPrevented, true);
  assert.equal(tree.focused(), "__root__");
  assert.equal(canvas.attrs["aria-activedescendant"], "tree-kbd-item");

  // ArrowDown walks to the first session and names it; Enter selects it
  keydown("ArrowDown");
  assert.equal(tree.focused(), "s1");
  assert.match(String(proxy.attrs["aria-label"]), /Alpha session/);
  keydown("Enter");
  assert.equal(tree.activeSession(), "s1");
  assert.equal(lastSelect()?.sessionId, "s1");
  assert.equal(proxy.attrs["aria-selected"], "true");

  // on past the todo to the second session, Enter moves the selection
  keydown("ArrowDown");
  assert.match(String(proxy.attrs["aria-label"]), /first thing/, "the todo's label is what the screen reader says");
  keydown("ArrowDown");
  keydown("Enter");
  assert.equal(tree.activeSession(), "s2");
  assert.equal(lastSelect()?.sessionId, "s2");

  // ArrowUp goes back a sibling; Space toggles through the same path
  keydown("ArrowUp");
  keydown(" ");
  assert.equal(tree.activeSession(), "s1");
  assert.equal(proxy.attrs["aria-selected"], "true");

  // Enter moves the selection to the focused session, and a second Enter on
  // the same node toggles it off
  keydown("ArrowDown");
  keydown("Enter");
  assert.equal(tree.activeSession(), "s2");
  keydown("Enter");
  assert.equal(tree.activeSession(), null);
  assert.equal(proxy.attrs["aria-selected"], "false");

  // Home jumps to the root, Escape drops the focus and the activedescendant
  keydown("Home");
  assert.equal(tree.focused(), "__root__");
  keydown("Escape");
  assert.equal(tree.focused(), null);
  assert.equal(canvas.attrs["aria-activedescendant"], undefined);

  // Tab reachability: the canvas (tabindex 0, labelled, asserted above) is the
  // rail's one tab stop. Tab itself is never eaten — focus must be able to
  // enter and leave the rail — and the freshly tabbed-in tree answers the
  // first arrow from the root.
  const tab = keydown("Tab");
  assert.ok(!tab.defaultPrevented, "Tab keeps its native focus movement");
  keydown("ArrowDown");
  assert.equal(tree.focused(), "__root__");
  assert.equal(canvas.attrs["aria-activedescendant"], "tree-kbd-item");

  // programmatic focus (tests, dev tools) lands on the same path
  tree.focusNode("s2");
  assert.equal(tree.focused(), "s2");
  assert.equal(canvas.attrs["aria-activedescendant"], "tree-kbd-item");
  assert.match(String(proxy.attrs["aria-label"]), /Beta session/);
});
