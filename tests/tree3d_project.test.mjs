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

// A reload still waiting on the old folder's store must not land over the
// switch: the switch asks for a fresh read (never joining the shared one in
// flight) and a superseded load's answer is dropped.
test("a project switch reads fresh and a superseded load's late answer is dropped", async () => {
  const canvas = element("tree-canvas");
  const gradient = { addColorStop() {} };
  canvas.getContext = () => new Proxy({}, {
    get: (target, prop) => (prop in target ? target[prop] : () => gradient),
    set: (target, prop, value) => { target[prop] = value; return true; },
  });
  const rail = element("tree-rail");
  const registry = { "tree-canvas": canvas, "tree-rail": rail, "tree-stats": element("tree-stats") };
  const listeners = {};
  const updatedAt = Date.now();
  const answers = [];
  const reads = [];
  const eyesState = () => new Promise((resolve) => answers.push(resolve));
  globalThis.window = {
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    dispatchEvent(event) { for (const fn of listeners[event.type] ?? []) fn(event); return true; },
    matchMedia: () => ({ matches: false }),
    // The shared-read seam boot.js provides: the options reach it untouched.
    MefiBoot: { read: (method, options) => { reads.push({ method, fresh: options?.fresh === true }); return window.mefiStudio[method](); } },
    mefiStudio: {
      eyesState,
      assistantState: async () => ({ ok: false }),
      onCheckpoints: () => {}, onEyesActivity: () => {}, onAssistant: () => {},
      eyesCheckpointsRead: async () => ({ checkpoints: {} }),
    },
  };
  globalThis.document = {
    hidden: false,
    body: { classList: { contains: () => false } },
    getElementById: (id) => registry[id] ?? null,
    createElement: () => element(null),
  };
  globalThis.CustomEvent = class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.requestAnimationFrame = () => 0;

  await import(new URL("../renderer/tree3d.js?stale-load-test", import.meta.url).href);
  const tree = globalThis.window.MefiTree;
  const initializing = tree.init();
  await new Promise((resolve) => setTimeout(resolve, 0));
  answers.shift()({ ok: true, sessions: [{ id: "a1", title: "Alpha", timeUpdated: updatedAt }], todos: [] });
  await initializing;
  window.dispatchEvent(new CustomEvent("mefi:project-changed", { detail: { projectId: "project-a" } }));
  assert.ok(tree.snapshot().nodes.some((node) => node.id === "a1"));

  // An organize tick reloads the old folder; its read is slow.
  const stale = tree.reload();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reads.at(-1).fresh, false, "an ordinary reload may join a shared read");
  window.dispatchEvent(new CustomEvent("mefi:project-changed", { detail: { projectId: "project-b" } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual({ ...reads.at(-1) }, { method: "eyesState", fresh: true }, "the switch never joins the old folder's read");
  const switched = tree.ready();
  answers.pop()({ ok: true, sessions: [{ id: "b1", title: "Beta", timeUpdated: updatedAt }], todos: [] });
  await switched;
  // The old folder's answer arrives last.
  answers.pop()({ ok: true, sessions: [{ id: "a-late", title: "Alpha late", timeUpdated: updatedAt }], todos: [] });
  await stale;
  const ids = tree.snapshot().nodes.map((node) => node.id);
  assert.ok(ids.includes("b1"), "the new folder stays on the rail");
  assert.ok(!ids.includes("a-late"), "the superseded load's answer is dropped");
});

// Sub-agent sessions (a session the store records with a parentId) hang under
// the shown session that spawned them: the newest three busy in the last
// hours, marked as children, with the rest counted on the parent. They stay
// out of the session count and the hub's todo meter.
test("sub-agent sessions hang under their shown parent, newest three, outside the counts", async () => {
  const canvas = element("tree-canvas");
  const gradient = { addColorStop() {} };
  canvas.getContext = () => new Proxy({}, {
    get: (target, prop) => (prop in target ? target[prop] : () => gradient),
    set: (target, prop, value) => { target[prop] = value; return true; },
  });
  const stats = element("tree-stats");
  const registry = { "tree-canvas": canvas, "tree-rail": element("tree-rail"), "tree-stats": stats };
  const listeners = {};
  const now = Date.now();
  const minute = 60 * 1000;
  const sessions = [
    { id: "root", title: "Root session", timeUpdated: now, parentId: null },
    ...[1, 2, 3, 4, 5].map((n) => ({ id: `child-${n}`, title: `Explore part ${n}`, timeUpdated: now - n * minute, parentId: "root" })),
    { id: "child-old", title: "Yesterday's helper", timeUpdated: now - 30 * 60 * minute, parentId: "root" },
    { id: "child-stray", title: "Helper of a session not shown", timeUpdated: now, parentId: "elsewhere" },
  ];
  const todos = [
    { sessionId: "root", position: 0, content: "Plan", status: "completed" },
    { sessionId: "child-1", position: 0, content: "Read the files", status: "in_progress" },
    { sessionId: "child-2", position: 0, content: "Write the summary", status: "completed" },
  ];
  globalThis.window = {
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    dispatchEvent(event) { for (const fn of listeners[event.type] ?? []) fn(event); return true; },
    matchMedia: () => ({ matches: false }),
    mefiStudio: {
      eyesState: async () => ({ ok: true, sessions, todos }),
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
  globalThis.CustomEvent = class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.requestAnimationFrame = () => 0;

  await import(new URL("../renderer/tree3d.js?child-sessions-test", import.meta.url).href);
  const tree = globalThis.window.MefiTree;
  await tree.init();
  await tree.ready();
  const { nodes, edges } = tree.snapshot();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = nodes.filter((node) => node.child);
  assert.deepEqual(children.map((node) => node.id), ["child-1", "child-2", "child-3"], "the newest three, newest first");
  for (const child of children) {
    assert.equal(child.kind, "session");
    assert.equal(child.parentSessionId, "root");
    assert.ok(child.r < byId.get("root").r, "a sub-agent is a smaller orb than its parent");
    const index = nodes.indexOf(child);
    assert.ok(edges.some((edge) => nodes[edge.a]?.id === "root" && edge.b === index), `${child.id} hangs from its parent`);
  }
  assert.equal(byId.get("child-1").state, "active", "a sub-agent with a todo in progress is working");
  assert.equal(byId.get("child-2").state, "done", "one whose todos all closed is done");
  assert.equal(byId.get("root").childMore, 2, "the parent counts the two it does not draw");
  assert.ok(!byId.has("child-old") && !byId.has("child-stray"), "old helpers and helpers of sessions off the rail stay off");
  assert.ok(!nodes.some((node) => node.kind === "todo" && node.sessionId?.startsWith("child-")), "sub-agents draw no todo nodes");
  assert.match(stats.textContent, /^1 session · 1 task · 100% done/, "the counts are the shown sessions' own");
  assert.equal(byId.get("__assistant__").progress, 1, "the hub meter stays a number");
});
