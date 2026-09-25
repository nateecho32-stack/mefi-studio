import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/model-lab.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const flush = async () => { for (let index = 0; index < 18; index += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const clean = (value) => JSON.parse(JSON.stringify(value));
const emptySnapshot = () => ({ ok: true, calls: 0, generatedAt: 1000, models: [], recent: [], ranking: { notes: [] }, usage: {} });

function environment(bridge = {}) {
  const ids = new Map();
  const listeners = new Map();
  let document;
  class Element {
    constructor(tag) { this.tagName = tag.toLowerCase(); this.children = []; this.listeners = {}; this.attrs = {}; this.dataset = {}; this.value = ""; this.disabled = false; this.hidden = false; this.className = ""; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(" "); }
    append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; } }
    replaceChildren(...children) { this.text = ""; this.children = []; this.append(...children); }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    addEventListener(key, fn) { (this.listeners[key] ||= []).push(fn); }
    dispatch(key, payload = {}) { for (const fn of this.listeners[key] || []) fn({ target: this, preventDefault() {}, ...payload }); }
    click() { if (!this.disabled) this.dispatch("click"); }
    focus() { document.activeElement = this; }
  }
  for (const match of template.matchAll(/<([a-z]+)\b[^>]*\bid="(model-lab(?:-[^"]+)?|tab-graph)"[^>]*>/g)) ids.set(match[2], new Element(match[1]));
  const get = (id) => ids.get(id.startsWith("model-lab") || id === "tab-graph" ? id : `model-lab-${id}`);
  get("context-budget").value = "4000";
  document = { getElementById: (id) => ids.get(id) || null, createElement: (tag) => new Element(tag), activeElement: null };
  const window = { mefiStudio: { modelPerformanceSnapshot: async () => emptySnapshot(), tasksList: async () => ({ ok: true, tasks: [] }), ...bridge }, addEventListener: (type, fn) => listeners.set(type, fn), dispatchEvent: (event) => listeners.get(event.type)?.(event) };
  vm.runInContext(source, vm.createContext({ window, document, Date, Number, String, Set, Math, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } }));
  window.MefiModelLab.open();
  return { get, ids, window, document, emit: (name) => listeners.get(name)?.({}), lab: window.MefiModelLab };
}

function populated() {
  const sample = { count: 2, p50: 1200, mean: 1500, p95: 1800 };
  const unmeasured = { count: 0, p50: null, mean: null, p95: null };
  return { ...emptySnapshot(), calls: 2,
    coverage: "Recorded fixture requests only",
    ranking: { metrics: ["speed", "reliability"], qualitySource: "human", notes: ["Unknown dimensions excluded."] },
    usage: { inputTokens: { known: 60, unknownRecords: 1 }, outputTokens: { known: 20, unknownRecords: 1 }, totalTokens: { known: 80, unknownRecords: 1 }, costUsd: { known: null, unknownRecords: 2 } },
    models: [{ provider: "fixture", model: "Measured model", samples: 2, successes: 1, errors: 1, cancelled: 0, errorRate: 0.5, latencyMs: sample, throughput: { ...sample, p50: 15 }, costUsd: unmeasured, quality: { human: { count: 1, mean: 4 }, model: { count: 1, mean: 2 } }, score: 60, rank: 1, evidence: "limited", taskStrengths: [{ taskType: "reply", samples: 2, latencyMs: sample, quality: { human: { count: 1, mean: 4 }, model: { count: 0, mean: null } } }], efforts: [{ requestedEffort: "low", appliedEffort: null, samples: 2 }] }],
    recent: [{ id: "observation-a", provider: "fixture", model: "Measured model", taskType: "reply", role: "responder", status: "ok", at: 1000, elapsedMs: 1200, requestedEffort: "low", appliedEffort: null, tokenUsage: { inputTokens: 60, outputTokens: 20 }, ratings: { human: [{ score: 4, note: "Good readable answer" }], model: [] } }],
  };
}

test("Usage keeps recorded calls and provider accounts distinct and tells the shell which view is active", async () => {
  const env = environment();
  const views = [];
  env.window.addEventListener("mefi:model-view", (event) => views.push(event.detail.view));
  env.lab.show("usage");
  assert.equal(env.get("usage-switch").hidden, false);
  assert.equal(env.get("usage").hidden, false);
  assert.equal(env.get("tracker").hidden, true);
  env.get("accounts").click();
  assert.equal(env.get("usage").hidden, true);
  assert.equal(env.get("tracker").hidden, false);
  env.get("accounts").dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(env.document.activeElement, env.get("recorded"));
  env.lab.show("context");
  assert.equal(env.get("usage-switch").hidden, true);
  assert.deepEqual(views, ["usage", "tracker", "usage", "context"]);
});

test("empty Model Lab stays honest and does not start measurements, context reads or paid comparisons", async () => {
  let snapshots = 0;
  let contextReads = 0;
  const env = environment({ modelPerformanceSnapshot: async () => { snapshots += 1; return emptySnapshot(); }, modelLabContext: async () => { contextReads += 1; throw new Error("No task selected"); } });
  await flush();
  assert.equal(snapshots, 1);
  assert.match(env.get("ranking-list").textContent, /no measured calls/i);
  // No call recorded yet: one empty state says so, and no totals invent zeros.
  assert.match(env.get("usage-list").textContent, /No calls recorded yet/);
  assert.equal(env.get("usage-totals").hidden, true);
  assert.doesNotMatch(env.get("usage-totals").textContent, /\$0|\b0\b|Unknown/);
  env.lab.show("context"); await flush();
  assert.equal(contextReads, 0);
  assert.match(env.get("context-status").textContent, /Choose a saved task/);
  env.lab.show("compare"); await flush();
  assert.equal(snapshots, 1);
  assert.equal(contextReads, 0);
});

test("rankings keep human/model ratings separate and unknown cost does not render as free", async () => {
  const env = environment({ modelPerformanceSnapshot: async () => populated() });
  await flush();
  const ranks = env.get("ranking-list").textContent;
  assert.match(ranks, /4 \/ 5 · 1 rated/);
  assert.match(ranks, /2 \/ 5 · 1 rated/);
  assert.match(ranks, /Unknown/);
  assert.doesNotMatch(ranks, /\$0/);
  assert.match(ranks, /Limited evidence/);
  assert.match(ranks, /reply · 2 calls/);
  assert.match(ranks, /low requested · provider confirmation unavailable/);
  assert.match(env.get("usage-list").textContent, /60 \/ 20/);
  assert.match(env.get("usage-coverage").textContent, /fixture requests only/);
  assert.match(env.get("usage-totals").textContent, /2 calls did not report this/);
  // Once calls exist, a value they did not report still reads Unknown.
  assert.match(env.get("usage-totals").textContent, /Recorded cost\s*Unknown/);
});

test("a later snapshot response wins over an older request", async () => {
  const first = deferred(), second = deferred(); let reads = 0;
  const env = environment({ modelPerformanceSnapshot: () => (++reads === 1 ? first : second).promise });
  env.lab.refresh();
  const latest = populated(); latest.models[0].model = "Current model";
  second.resolve(latest); await flush();
  first.resolve({ ...emptySnapshot(), calls: 99 }); await flush();
  assert.match(env.get("ranking-list").textContent, /Current model/);
  assert.equal(env.get("refresh").disabled, false);
});

test("human rating saves the selected observation and retains an earlier note", async () => {
  let submitted;
  const doc = populated();
  const env = environment({ modelPerformanceSnapshot: async () => doc, modelPerformanceRate: async (payload) => { submitted = clean(payload); doc.recent[0].ratings.human = [{ score: payload.score, note: payload.note }]; return { ok: true }; } });
  await flush();
  const form = env.get("recent").children[0];
  const select = form.children.find((child) => child.tagName === "select");
  const note = form.children.find((child) => child.tagName === "input");
  assert.equal(note.value, "Good readable answer");
  select.value = "5"; select.dispatch("change"); form.dispatch("submit"); await flush();
  assert.deepEqual(submitted, { observationId: "observation-a", authority: "human", score: 5, note: "Good readable answer" });
  assert.equal(env.get("recent").children[0].children.find((child) => child.tagName === "select").value, "5");
});

test("a rejected rating keeps its draft and exposes the error", async () => {
  const env = environment({ modelPerformanceSnapshot: async () => populated(), modelPerformanceRate: async () => ({ ok: false, error: "Storage is busy" }) });
  await flush();
  const form = env.get("recent").children[0];
  const note = form.children.find((child) => child.tagName === "input"); note.value = "Keep my rating reason";
  form.dispatch("submit"); await flush();
  assert.equal(note.value, "Keep my rating reason");
  assert.match(form.textContent, /Storage is busy/);
  assert.equal(form.children.find((child) => child.tagName === "button").disabled, false);
});

test("context picks a saved task, preserves source text, and discards stale previews", async () => {
  const first = deferred(), second = deferred(); const requests = [];
  const env = environment({ tasksList: async () => ({ ok: true, tasks: [{ id: "task-a", title: "First" }, { id: "task-b", title: "Second" }] }), modelLabContext: (payload) => { requests.push(clean(payload)); return requests.length === 1 ? first.promise : second.promise; } });
  await flush(); env.lab.show("context"); await flush();
  assert.deepEqual(requests[0], { taskId: "task-a", budgetTokens: 4000 });
  env.get("context-task").value = "task-b"; env.get("context-task").dispatch("change");
  second.resolve({ ok: true, taskId: "task-b", budgetTokens: 4000, estimatedTokens: 13, truncated: true, sections: [{ kind: "brief", label: "Saved brief", text: "<script>display as text</script>", estimatedTokens: 13, included: true }] }); await flush();
  first.resolve({ ok: true, estimatedTokens: 99, budgetTokens: 4000, sections: [{ label: "Stale", text: "Old task content", included: true }] }); await flush();
  assert.match(env.get("context-sections").textContent, /<script>display as text<\/script>/);
  assert.doesNotMatch(env.get("context-sections").textContent, /Old task content/);
  assert.match(env.get("context-status").textContent, /saved originals are retained/);
});

test("switching projects invalidates the old task list before it can request context", async () => {
  const oldTasks = deferred(); let reads = 0; const requests = [];
  const env = environment({ tasksList: () => ++reads === 1 ? oldTasks.promise : Promise.resolve({ ok: true, tasks: [{ id: "new-task", title: "New project" }] }), modelLabContext: async (payload) => { requests.push(clean(payload)); return { ok: true, estimatedTokens: 1, budgetTokens: 4000, sections: [] }; } });
  await flush(); env.lab.show("context"); await flush();
  env.emit("mefi:project-changed"); await flush();
  oldTasks.resolve({ ok: true, tasks: [{ id: "old-task", title: "Old project" }] }); await flush();
  assert.deepEqual(requests.map((request) => request.taskId), ["new-task"]);
  assert.equal(env.get("context-task").value, "new-task");
});

test("Model Lab tabs support arrow navigation and keep selected panels accessible", async () => {
  const env = environment(); await flush();
  env.get("tab-rankings").dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(env.get("compare").hidden, false);
  assert.equal(env.get("rankings").hidden, true);
  assert.equal(env.document.activeElement, env.get("tab-compare"));
  assert.equal(env.get("tab-compare").attrs["aria-selected"], "true");
  env.get("tab-compare").dispatch("keydown", { key: "Home" });
  assert.equal(env.get("rankings").hidden, false);
  assert.equal(env.get("tab-rankings").tabIndex, 0);
});
