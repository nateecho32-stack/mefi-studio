// The page's half of the startup marks (renderer/startup-marks.js): booklet.js
// runs the launch gate through wrapBoot(), which times each step, the launch
// choice and the release without changing what boot.js sees, then sends the
// marks to main once. The real boot.js and booklet.js run here in vm
// sandboxes with small fake DOMs, as tests/renderer_startup.test.mjs and
// tests/catalog_renderer.test.mjs do.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const marksSource = await readFile(new URL("../renderer/startup-marks.js", import.meta.url), "utf8");
const bootSource = await readFile(new URL("../renderer/boot.js", import.meta.url), "utf8");
const bookletSource = await readFile(new URL("../renderer/booklet.js", import.meta.url), "utf8");
const graphSource = await readFile(new URL("../renderer/graph.js", import.meta.url), "utf8");
const catalog = JSON.parse(await readFile(new URL("../data/models.json", import.meta.url), "utf8"));
const flush = async () => { for (let count = 0; count < 30; count += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const ORIGIN = 1_790_000_000_400;

// boot.js's own gate, with startup-marks.js loaded before it as the build does.
function gateEnvironment({ search = "", bridge, domLoading = true } = {}) {
  let now = 5, nextId = 0;
  const timers = new Map(), frames = new Map(), listeners = new Map();
  const document = { readyState: domLoading ? "loading" : "complete", hidden: false, activeElement: null };
  class Element {
    constructor(id = "", tagName = "DIV") { this.id = id; this.tagName = tagName; this.hidden = false; this.inert = false; this.children = []; this.dataset = {}; this.attributes = new Map(); this.classList = { add() {}, remove() {} }; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    append(node) { this.children.push(node); }
    replaceChildren() { this.children = []; }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    focus() { document.activeElement = this; }
  }
  const elements = Object.fromEntries(["layer", "title", "detail", "progress", "progress-heading", "count", "steps", "actions", "retry", "continue", "choose"].map((name) => ["boot-" + name, new Element("boot-" + name)]));
  Object.assign(document, {
    body: { children: [new Element("main"), elements["boot-layer"]] },
    documentElement: new Element(),
    getElementById: (id) => elements[id],
    createElement: (tag) => new Element("", tag.toUpperCase()),
    addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
  });
  const sent = [];
  const performance = {
    timeOrigin: ORIGIN,
    now: () => now,
    getEntriesByType: (type) => type === "paint" ? [{ name: "first-paint", startTime: 30 }, { name: "first-contentful-paint", startTime: 31 }]
      : type === "navigation" ? [{ responseEnd: 2, domContentLoadedEventStart: 0, loadEventEnd: 0 }] : [],
  };
  const context = vm.createContext({
    window: {
      location: { search },
      mefiStudio: bridge ?? { startupMarks: (payload) => { sent.push(payload); return Promise.resolve({ ok: true }); } },
      MefiNav: { noMotion: () => false },
      addEventListener() {}, removeEventListener() {},
    },
    document, performance, console,
    setTimeout(fn, delay = 0) { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame(fn) { const id = ++nextId; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  vm.runInContext(marksSource, context, { filename: "startup-marks.js" });
  vm.runInContext(bootSource, context, { filename: "boot.js" });
  return {
    context, window: context.window, elements, sent,
    at: (value) => { now = value; },
    fire: (name) => { for (const fn of listeners.get(name) ?? []) fn(); },
    async advance(ms) {
      const target = now + ms;
      await flush();
      while (now < target) {
        now = Math.min(now + 16, target);
        for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
        const callbacks = [...frames.values()]; frames.clear();
        for (const frame of callbacks) frame(now);
        await flush();
      }
    },
  };
}

test("the gate's steps, the launch choice and the release are timed, and the marks reach main once", async () => {
  const env = gateEnvironment();
  const workspace = deferred(), tree = deferred(), choice = deferred();
  const handoffs = [];
  const steps = [
    { id: "workspace", label: "Your projects and work", load: () => workspace.promise },
    { id: "tree", label: "Session tree", load: () => tree.promise },
    { id: "fonts", label: "Fonts and interface", load: () => undefined },
  ];
  const gate = env.window.MefiStartupMarks.wrapBoot(env.window.MefiBoot);
  assert.notEqual(gate, env.window.MefiBoot);
  env.at(12);
  const ready = gate.run(steps, function (complete, chosen) { handoffs.push({ complete, chosen }); }, { choose: () => choice.promise });
  env.at(50);
  env.fire("DOMContentLoaded");
  await env.advance(10);
  choice.resolve({ projectId: "p1", startAgents: false });
  await env.advance(10);
  assert.equal(env.window.MefiBoot.state().phase, "loading");
  env.at(200); workspace.resolve(true);
  await flush();
  env.at(260); tree.resolve(undefined);
  await flush();
  await env.advance(900);
  assert.equal(await ready, true, "the gate released as it always did");
  assert.deepEqual(handoffs, [{ complete: true, chosen: { projectId: "p1", startAgents: false } }], "the handoff still gets the release and the choice");
  await env.advance(20);
  assert.equal(env.sent.length, 1, "sent once, after the release");
  const payload = env.sent[0];
  assert.equal(payload.origin, ORIGIN);
  assert.equal(payload.complete, true);
  const { marks } = payload;
  assert.equal(marks.script, 5, "taken when the file ran");
  assert.equal(marks.gate, 12);
  assert.equal(marks.dcl, 50);
  assert.equal(marks.choose, 50);
  assert.equal(marks.chosen, 60);
  assert.equal(marks.html, 2);
  assert.equal(marks["first-paint"], 30);
  assert.ok(marks.release >= 260 + 250 && marks.release < 1200, `released after the minimum show and the fade (${marks.release})`);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.steps)), [
    { id: "workspace", start: 60, end: 200, ok: true, tries: 1 },
    { id: "tree", start: 60, end: 260, ok: true, tries: 1 },
    { id: "fonts", start: 60, end: 60, ok: true, tries: 1 },
  ]);
  env.window.MefiStartupMarks.send(true);
  assert.equal(env.sent.length, 1, "never twice");
});

test("a failed step still fails the gate, and Retry is timed as the latest try", async () => {
  const env = gateEnvironment({ domLoading: false });
  let attempts = 0;
  const steps = [
    { id: "workspace", label: "Your projects and work", load: () => { attempts += 1; return attempts === 1 ? false : true; } },
    { id: "tree", label: "Session tree", load: () => { if (attempts === 1) throw new Error("store unavailable"); return { ok: true }; } },
  ];
  const warnings = [];
  env.context.console = { ...console, warn: (...args) => warnings.push(args.join(" ")) };
  const ready = env.window.MefiStartupMarks.wrapBoot(env.window.MefiBoot).run(steps, () => {});
  await env.advance(50);
  assert.equal(env.window.MefiBoot.state().phase, "error", "false and a throw are still failures to boot.js");
  assert.equal(warnings.length, 2);
  env.at(400);
  env.elements["boot-retry"].onclick();
  await env.advance(900);
  assert.equal(await ready, true);
  await env.advance(20);
  const [workspace, tree] = env.sent[0].steps;
  assert.deepEqual({ ...workspace }, { id: "workspace", start: 400, end: 400, ok: true, tries: 2 });
  assert.deepEqual({ ...tree }, { id: "tree", start: 400, end: 400, ok: true, tries: 2 });
});

test("?marks=0 (MEFI_STUDIO_STARTUP_MARKS=0 in main) takes no marks, wraps nothing and sends nothing", async () => {
  const env = gateEnvironment({ search: "?capture=0&smoke=0&marks=0", domLoading: false });
  const marks = env.window.MefiStartupMarks;
  assert.equal(marks.enabled(), false);
  assert.equal(marks.wrapBoot(env.window.MefiBoot), env.window.MefiBoot, "the gate is MefiBoot itself");
  const ready = marks.wrapBoot(env.window.MefiBoot).run([{ id: "workspace", label: "Work", load: () => true }], () => {});
  await env.advance(900);
  assert.equal(await ready, true);
  await env.advance(20);
  assert.deepEqual(env.sent, []);
  assert.deepEqual(JSON.parse(JSON.stringify(marks.snapshot().marks)), { html: 2, "first-paint": 30, "first-contentful-paint": 31 }, "only Chromium's own timings");
});

test("a host without startup:marks, or one that refuses, never disturbs the launch", async () => {
  for (const bridge of [{}, { startupMarks: () => Promise.reject(new Error("No handler registered for 'startup:marks'")) }, { startupMarks: () => { throw new Error("bridge gone"); } }]) {
    const unhandled = [];
    const listener = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const env = gateEnvironment({ bridge, domLoading: false });
      const ready = env.window.MefiStartupMarks.wrapBoot(env.window.MefiBoot).run([{ id: "workspace", label: "Work", load: () => true }], () => {});
      await env.advance(900);
      assert.equal(await ready, true);
      await env.advance(20);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", listener);
    }
  }
});

// ---- booklet.js hands its real steps through the wrapper ------------------------------

function bookletEnvironment(windowOverrides = {}) {
  const elements = new Map(), timers = [];
  const ctx = new Proxy({}, { get: (_, name) => name === "measureText" ? (text) => ({ width: String(text).length * 7 }) : () => {}, set: () => true });
  class Element {
    constructor() { this.value = ""; this.textContent = ""; this.html = ""; this.hidden = false; this.children = []; this.listeners = {}; this.style = {}; this.dataset = {}; this.parentElement = { clientWidth: 1000 }; this.classList = { toggle() {}, add() {}, remove() {} }; }
    get innerHTML() { return this.html; }
    set innerHTML(value) { this.html = value; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    setAttribute(name, value) { (this.attributes ||= {})[name] = String(value); }
    querySelectorAll() { return []; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    getBoundingClientRect() { return { width: 1000, height: 500, left: 0, top: 0 }; }
    getContext() { return ctx; }
    focus() { this.focused = true; }
  }
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  get("booklet-data").textContent = JSON.stringify(catalog);
  const sent = [];
  let gate = null;
  const bridge = {
    launchStudio: async () => ({}), onStudioLog() {}, readCatalog: async () => catalog, speedMeasurements: async () => ({ ok: true, measurements: {} }),
    startupMarks: async (payload) => { sent.push(payload); return { ok: true }; },
  };
  const window = {
    mefiStudio: bridge, location: { href: "file:///fixture/renderer/booklet.html", search: "", reload() {} }, addEventListener() {}, devicePixelRatio: 1,
    MefiBoot: { run: (steps, onReady, options) => { gate = { steps, onReady, options }; return Promise.resolve(true); } },
    ...windowOverrides,
  };
  const store = new Map();
  const document = { getElementById: get, querySelectorAll: () => [], createElement: () => new Element(), body: new Element(), fonts: { ready: Promise.resolve() }, addEventListener() {} };
  let now = 7;
  const context = vm.createContext({
    window, document, URL, URLSearchParams, console,
    performance: { timeOrigin: ORIGIN, now: () => now, getEntriesByType: () => [] },
    localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  });
  vm.runInContext(marksSource, context, { filename: "startup-marks.js" });
  vm.runInContext(graphSource, context, { filename: "graph.js" });
  vm.runInContext(bookletSource, context, { filename: "booklet.js" });
  return { window, sent, gate: () => gate, get, at: (value) => { now = value; }, runTimers: () => { for (const fn of timers.splice(0)) fn(); } };
}

test("booklet.js: its five real steps run through the wrapper, and its handoff still runs at the release", async () => {
  let workspaceActive = false;
  const onboarding = [];
  const env = bookletEnvironment({
    MefiWorkspace: { ready: async () => true, enter: () => { workspaceActive = true; }, isActive: () => workspaceActive },
    MefiTree: { init() {}, ready: async () => {}, status: () => "ready" },
    MefiNav: { resumeReady: async () => ({ restored: false }) },
    MefiOnboarding: { startup: (options) => onboarding.push(options) },
  });
  const gate = env.gate();
  assert.deepEqual(Array.from(gate.steps, (step) => step.id), ["workspace", "catalog", "tree", "view", "fonts"]);
  assert.equal(typeof gate.options?.choose, "undefined", "no launch screen module, no choice to time");
  env.at(40);
  const results = await Promise.all(gate.steps.map((step) => step.load({ retry: false, isCurrent: () => true })));
  assert.deepEqual(results.map((value) => value === false || value?.ok === false), [false, false, false, false, false], "every step still settles as it did");
  assert.equal(workspaceActive, true, "the view step still enters the home beneath the gate");
  assert.match(env.get("cards").innerHTML, new RegExp(catalog.models[0].id), "the catalog step still paints the cards");
  env.at(900);
  gate.onReady(true, null);
  assert.equal(onboarding.length, 1, "the release still hands on to the onboarding");
  assert.equal(env.get("workspace-layer").focused, true);
  assert.equal(env.sent.length, 0, "the marks wait for the handoff to finish");
  env.runTimers();
  await flush();
  assert.equal(env.sent.length, 1);
  const payload = env.sent[0];
  assert.equal(payload.marks.script, 7);
  assert.equal(payload.marks.gate, 7, "booklet.js runs the gate as it loads");
  assert.equal(payload.marks.release, 900);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.steps.map((step) => [step.id, step.start, step.ok, step.tries]))), [["workspace", 40, true, 1], ["catalog", 40, true, 1], ["tree", 40, true, 1], ["view", 40, true, 1], ["fonts", 40, true, 1]]);
});

test("booklet.js without the marks module runs MefiBoot itself, as before", () => {
  let gate = null;
  const elements = new Map();
  const get = (id) => { if (!elements.has(id)) elements.set(id, { textContent: id === "booklet-data" ? JSON.stringify(catalog) : "", hidden: false, dataset: {}, style: {}, classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, setAttribute() {}, querySelectorAll: () => [], append() {}, replaceChildren() {}, focus() {}, getBoundingClientRect: () => ({ width: 1000, height: 500 }), getContext: () => new Proxy({}, { get: () => () => ({ width: 1 }) }) }); return elements.get(id); };
  const run = function (steps, onReady) { gate = { steps, onReady, self: this }; };
  const MefiBoot = { run };
  const context = vm.createContext({
    window: { mefiStudio: {}, location: { href: "file:///x/booklet.html", search: "", reload() {} }, addEventListener() {}, MefiBoot },
    document: { getElementById: get, querySelectorAll: () => [], createElement: () => get(`el-${elements.size}`), body: get("body"), fonts: { ready: Promise.resolve() } },
    URL, URLSearchParams, console, localStorage: { getItem: () => null, setItem() {} }, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  });
  vm.runInContext(graphSource, context);
  vm.runInContext(bookletSource, context);
  assert.equal(gate.self, MefiBoot, "called as MefiBoot.run");
  assert.equal(gate.steps.length, 5);
  assert.equal(typeof gate.steps[0].load, "function");
});
