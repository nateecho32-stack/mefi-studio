import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/booklet.js", import.meta.url), "utf8");
const graphSource = await readFile(new URL("../renderer/graph.js", import.meta.url), "utf8");
const catalog = JSON.parse(await readFile(new URL("../data/models.json", import.meta.url), "utf8"));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function environment(overrides = {}, options = {}) {
  const elements = new Map(), frames = new Map(), calls = [];
  let frameId = 0, formatCalls = 0, paints = 0;
  const ctx = new Proxy({}, { get: (_, name) => name === "measureText" ? (text) => ({ width: String(text).length * 7 }) : () => { if (name === "clearRect") paints++; }, set: () => true });
  class Element {
    constructor() { this.value = ""; this.textContent = ""; this.html = ""; this.writes = 0; this.hidden = false; this.children = []; this.listeners = {}; this.style = {}; this.dataset = {}; this.parentElement = { clientWidth: 1000 }; this.classList = { toggle() {}, add() {}, remove() {} }; }
    get innerHTML() { return this.html; }
    set innerHTML(value) { this.html = value; this.writes++; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    dispatch(name, event = {}) { for (const fn of this.listeners[name] || []) fn({ target: this, preventDefault() {}, ...event }); }
    querySelectorAll() { return []; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; if (children[0]?.value) this.value = children[0].value; }
    getBoundingClientRect() { return { width: 1000, height: 500, left: 0, top: 0 }; }
    getContext() { return ctx; }
    focus() { this.focused = true; }
  }
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  get("booklet-data").textContent = JSON.stringify(catalog);
  const document = { getElementById: get, querySelectorAll: () => [], createElement: () => new Element(), body: new Element(), ...options.document };
  const base = {
    launchStudio: async () => ({}), onStudioLog() {},
    readCatalog: async () => catalog, speedMeasurements: async () => ({ ok: true, measurements: {} }),
    getApiKey: async () => ({ saved: false }), jevStatus: async () => ({ configured: false }),
    getAiRouting: async () => ({ provider: "auto", models: {} }), cliStatus: async () => [],
  };
  const bridge = Object.fromEntries(Object.entries({ ...base, ...overrides }).map(([name, fn]) => [name, (...args) => { calls.push(name); return fn(...args); }]));
  const query = options.capture === false ? "" : "?capture=1";
  const window = { mefiStudio: bridge, location: { href: `file:///fixture/renderer/booklet.html${query}`, search: query, reload() {} }, addEventListener() {}, devicePixelRatio: 1, ...options.window };
  const store = new Map(Object.entries(options.storage ?? {}));
  const context = vm.createContext({ window, document, URL, URLSearchParams, console, localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) }, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: (fn) => { const id = ++frameId; frames.set(id, fn); return id; }, cancelAnimationFrame: (id) => frames.delete(id) });
  vm.runInContext(graphSource, context);
  const money = window.MefiGraph.fmt.money;
  window.MefiGraph.fmt.money = (...args) => { formatCalls++; return money(...args); };
  vm.runInContext(source, context);
  return { get, calls, window, context, frames, formats: () => formatCalls, paints: () => paints,
    frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn()); },
  };
}

test("startup defers connection and CLI checks until Settings opens, then initializes once", async () => {
  const env = environment(); await flush();
  const settingsCalls = () => env.calls.filter((name) => ["getApiKey", "jevStatus", "getAiRouting", "cliStatus"].includes(name));
  assert.deepEqual(settingsCalls(), []);
  env.window.MefiBooklet.showTab("studio"); await flush();
  assert.equal(settingsCalls().length, 6);
  assert.equal(env.get("ai-provider").value, "auto");
  assert.equal(env.get("cli-status").textContent, "");
  env.window.MefiBooklet.showTab("booklet"); env.window.MefiBooklet.showTab("studio"); await flush();
  assert.equal(settingsCalls().length, 6, "reopening must not rescan or attach duplicate save handlers");
  assert.equal(env.get("save-key").listeners.click.length, 1);
});

test("normal startup gates five local readiness stages and defers first-launch onboarding until release", async () => {
  let gate, workspaceActive = false;
  const loads = [], onboarding = [];
  const env = environment({}, { capture: false, document: { fonts: { ready: Promise.resolve() } }, window: {
    MefiBoot: { run: (steps, onReady) => { gate = { steps, onReady }; } },
    MefiWorkspace: {
      ready: async ({ retry }) => { loads.push(["workspace", retry]); return true; },
      enter: () => { workspaceActive = true; }, isActive: () => workspaceActive,
    },
    MefiTree: { init() {}, ready: async () => { loads.push(["tree"]); }, status: () => "ready" },
    MefiNav: { resumeReady: async () => ({ restored: false }) },
    MefiOnboarding: { startup: (options) => onboarding.push(options) },
  } });
  assert.deepEqual(Array.from(gate.steps, (step) => step.id), ["workspace", "catalog", "tree", "view", "fonts"]);
  assert.deepEqual(onboarding, [], "first-launch guide cannot open before the loading gate releases");
  assert.equal(env.calls.filter((name) => name === "readCatalog").length, 0, "catalog rendering belongs to its real loading stage");
  await Promise.all(gate.steps.map((step) => step.load({ retry: false, isCurrent: () => true })));
  assert.deepEqual(loads, [["workspace", false], ["tree"]]);
  assert.equal(workspaceActive, true, "the selected surface is prepared beneath the gate");
  assert.match(env.get("cards").innerHTML, new RegExp(catalog.models[0].id));
  assert.deepEqual(onboarding, [], "readiness completion itself does not bypass the gate handoff");
  gate.onReady();
  assert.equal(onboarding.length, 1);
  assert.equal(onboarding[0].automatic, true);
  assert.equal(env.get("workspace-layer").focused, true);
  assert.deepEqual(env.calls.filter((name) => ["getApiKey", "jevStatus", "getAiRouting", "cliStatus"].includes(name)), [], "preloading never triggers Settings connection or CLI checks");
});

test("catalog retry replaces hung local reads and fences stale catalog and speed responses", async () => {
  const oldDoc = deferred(), oldSpeeds = deferred(), newDoc = deferred(), newSpeeds = deferred();
  let gate, docCalls = 0, speedCalls = 0, reloads = 0;
  const env = environment({
    readCatalog: () => (++docCalls === 1 ? oldDoc.promise : newDoc.promise),
    speedMeasurements: () => (++speedCalls === 1 ? oldSpeeds.promise : newSpeeds.promise),
  }, { capture: false, window: {
    MefiBoot: { run: (steps, onReady) => { gate = { steps, onReady }; } },
    location: { href: "file:///fixture/renderer/booklet.html", search: "", reload: () => { reloads += 1; } },
  } });
  const load = gate.steps.find((step) => step.id === "catalog").load;
  const initial = load({ retry: false }); await flush();
  const joined = env.window.MefiBooklet.refresh("manual");
  assert.equal(docCalls, 1, "ordinary refresh joins its current read");
  assert.equal(speedCalls, 1);
  const retry = load({ retry: true }); await flush();
  assert.equal(docCalls, 2, "retry starts a fresh catalog read despite the old hung promise");
  assert.equal(speedCalls, 2, "retry also replaces the hung local speed snapshot");
  const current = structuredClone(catalog);
  current.hash = "fresh-startup-catalog";
  current.models[0].name = "Fresh startup model";
  newDoc.resolve(current); await flush();
  assert.equal(speedCalls, 2, "applying the new catalog shares the retry's pending speed read");
  newSpeeds.resolve({ ok: true, measurements: { [catalog.models[0].id]: { tokensPerSecond: 42, measuredAt: 2000 } } });
  await retry;
  assert.match(env.get("cards").innerHTML, /Fresh startup model/);
  assert.match(env.get("cards").innerHTML, /42 t\/s/);
  const stale = structuredClone(catalog);
  stale.hash = "stale-startup-catalog";
  stale.schemaVersion = "outdated-schema";
  stale.models[0].name = "Stale startup model";
  oldDoc.resolve(stale);
  oldSpeeds.resolve({ ok: true, measurements: { [catalog.models[0].id]: { tokensPerSecond: 9, measuredAt: 1000 } } });
  await Promise.all([initial, joined]); await flush();
  assert.equal(reloads, 0, "an obsolete catalog response cannot reload the application");
  assert.match(env.get("cards").innerHTML, /Fresh startup model/);
  assert.match(env.get("cards").innerHTML, /42 t\/s/);
  assert.doesNotMatch(env.get("cards").innerHTML, /Stale startup model|9 t\/s/);
  assert.deepEqual(env.calls.filter((name) => ["getApiKey", "jevStatus", "getAiRouting", "cliStatus"].includes(name)), []);
});

test("initial routing load holds editable controls until saved settings arrive", async () => {
  const routing = deferred();
  const env = environment({ getAiRouting: () => routing.promise }); await flush();
  env.window.MefiBooklet.showTab("studio");
  assert.equal(env.get("ai-provider").disabled, true);
  assert.equal(env.get("ai-model-routine").disabled, true);
  routing.resolve({ provider: "zai", models: { routine: "saved-model" } }); await flush();
  assert.equal(env.get("ai-provider").disabled, false);
  assert.equal(env.get("ai-provider").value, "zai");
  assert.equal(env.get("ai-model-routine").value, "saved-model");
});

test("speed probes reject duplicate clicks, refresh measurements and recover after failures", async () => {
  const probe = deferred(); let measured = false;
  const env = environment({ speedProbe: () => probe.promise, speedMeasurements: async () => ({ ok: true, measurements: measured ? { [catalog.models[0].id]: { tokensPerSecond: 83, measuredAt: 1000 } } : {} }) });
  await flush(); env.window.MefiBooklet.showTab("studio"); await flush();
  const button = env.get("speed-go"); button.dispatch("click"); button.dispatch("click");
  assert.equal(env.calls.filter((name) => name === "speedProbe").length, 1);
  assert.equal(button.disabled, true);
  measured = true; probe.resolve({ ok: true }); await flush();
  assert.equal(button.disabled, false);
  assert.match(env.get("cards").innerHTML, /83 t\/s/);
  env.window.mefiStudio.speedProbe = async () => { throw new Error("fixture probe failed"); };
  button.dispatch("click"); await flush();
  assert.equal(button.disabled, false);
  assert.match(env.get("studio-log").textContent, /fixture probe failed/);
});

test("catalog typing batches paints and reuses formatted cards without losing unchanged details", async () => {
  const env = environment(); await flush();
  const initialFormats = env.formats(), initialWrites = env.get("cards").writes;
  const search = env.get("search");
  search.value = "impossible-query"; search.dispatch("input");
  search.value = catalog.models[0].id; search.dispatch("input");
  assert.equal(env.frames.size, 1);
  assert.equal(env.get("cards").writes, initialWrites);
  env.frame();
  assert.match(env.get("cards").innerHTML, new RegExp(catalog.models[0].id));
  assert.equal(env.formats(), initialFormats, "cached cards require no repeated price formatting");
  // A real browser inserts tbody and reflects the user's expanded disclosure.
  env.get("cards").html = env.get("cards").html.replace("<details>", '<details open="">').replace('<table class="detail">', '<table class="detail"><tbody>');
  const writes = env.get("cards").writes;
  search.dispatch("input"); env.frame();
  assert.equal(env.get("cards").writes, writes, "identical results retain their DOM and open details");
  assert.match(env.get("cards").innerHTML, /<details open=/);
  search.value = ""; search.dispatch("input"); env.frame();
  assert.equal(env.formats(), initialFormats);
  assert.equal(env.get("cards").writes, initialWrites + 2);
});

test("refresh shares pending speed reads and updates model choices and existing graphs", async () => {
  const pending = deferred();
  let current = catalog;
  const env = environment({ speedMeasurements: () => pending.promise, readCatalog: async () => current });
  await flush();
  env.window.MefiBooklet.showTab("studio"); await flush();
  env.get("speed-model").value = "glm-5.3";
  env.window.MefiBooklet.showTab("graph"); env.frame();
  assert.equal(env.paints(), 0, "closed model map must not paint its hidden canvases");
  current = structuredClone(catalog);
  current.hash = "updated-catalog";
  current.models[0].name = "Updated catalog model";
  current.models.push({ ...current.models[0], id: "fresh-fixture", name: "Fresh fixture", onRoster: true, legacy: false });
  await env.window.MefiBooklet.refresh("test"); await flush();
  assert.equal(env.calls.filter((name) => name === "speedMeasurements").length, 1);
  assert.ok(env.get("speed-model").children.some((option) => option.value === "fresh-fixture"));
  assert.equal(env.get("speed-model").value, "glm-5.3", "refresh retains the selected probe model");
  pending.resolve({ ok: true, measurements: { [catalog.models[0].id]: { tokensPerSecond: 42, measuredAt: 1000 } } }); await flush();
  assert.match(env.get("cards").innerHTML, /42 t\/s/);
  assert.match(env.get("cards").innerHTML, /Updated catalog model/);
  env.get("model-lab-catalog").open = true; env.get("model-lab-catalog").dispatch("toggle");
  assert.ok(env.paints() > 0);
  assert.match(env.get("table-body").innerHTML, /Updated catalog model/);
  const paints = env.paints();
  env.window.MefiBooklet.showTab("booklet");
  env.get("model-lab-catalog").dispatch("toggle");
  assert.equal(env.paints(), paints, "offscreen model maps stay idle");
});
