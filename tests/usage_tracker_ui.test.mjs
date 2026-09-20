import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/tracker.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const flush = async () => { for (let index = 0; index < 18; index += 1) await Promise.resolve(); };

const usage = (known, unknown = 0) => ({ known, knownRecords: known === null ? 0 : 1, unknownRecords: unknown });
const localReport = () => ({
  ok: true,
  generatedAt: 1,
  totals: { calls: 3, errors: 1, cancelled: 0, usage: { costUsd: usage(0.3, 1), totalTokens: usage(450), inputTokens: usage(300), outputTokens: usage(150) } },
  today: { calls: 2, errors: 0, cancelled: 0, usage: { costUsd: usage(0.2, 1), totalTokens: usage(300), inputTokens: usage(200), outputTokens: usage(100) } },
  week: { calls: 3, errors: 1, cancelled: 0, usage: { costUsd: usage(0.3, 1), totalTokens: usage(450), inputTokens: usage(300), outputTokens: usage(150) } },
  month: { calls: 3, errors: 1, cancelled: 0, usage: { costUsd: usage(0.3, 1), totalTokens: usage(450), inputTokens: usage(300), outputTokens: usage(150) } },
  days: [{ day: "2026-09-20", calls: 2, errors: 0, usage: { costUsd: usage(0.2, 1), totalTokens: usage(300), inputTokens: usage(200), outputTokens: usage(100) } }],
  models: [{ provider: "opencode", model: "deepseek-v4.1-flash", calls: 3, errors: 0, usage: { costUsd: usage(0.3, 1), totalTokens: usage(450), inputTokens: usage(300), outputTokens: usage(150) } }],
  providers: [{ provider: "opencode", calls: 3, errors: 0, usage: { costUsd: usage(0.3, 1), totalTokens: usage(450), inputTokens: usage(300), outputTokens: usage(150) } }],
  lifetime: { calls: 9, range: { from: 0, to: 1 }, usage: { costUsd: usage(1) } },
  retention: { limit: 10000, dropped: 0 },
  credits: {
    provider: "opencode",
    limits: { rolling: 12, weekly: 30, monthly: 60 },
    rolling: { key: "rolling", limitUsd: 12, from: 0, to: 1, resetsAt: null, calls: 2, spentUsd: 3, knownRecords: 1, unknownRecords: 1, percent: 25 },
    weekly: { key: "weekly", limitUsd: 30, from: 0, to: 1, resetsAt: null, calls: 2, spentUsd: 5, knownRecords: 1, unknownRecords: 1, percent: 16.7 },
    monthly: { key: "monthly", limitUsd: 60, from: 0, to: 1, resetsAt: null, calls: 3, spentUsd: 5, knownRecords: 1, unknownRecords: 2, percent: 8.3 },
  },
  coverage: "fixture coverage: recorded calls only",
});
const creditsReport = () => ({
  ok: true,
  fetchedAt: Date.parse("2026-09-20T12:00:00Z"),
  usage: {
    rolling: { status: "ok", percent: 42, resetsAt: "2026-09-20T17:00:00Z" },
    weekly: { status: "ok", percent: 34, resetsAt: "2026-09-21T00:00:00Z" },
    monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-10-01T00:00:00Z" },
  },
});

function environment({ tracker = async () => localReport(), credits = async () => creditsReport() } = {}) {
  const ids = new Map();
  const listeners = new Map();
  class Element {
    constructor(tag) { this.tagName = tag.toLowerCase(); this.children = []; this.listeners = {}; this.attrs = {}; this.style = {}; this.value = ""; this.disabled = false; this.hidden = false; this.className = ""; this.title = ""; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(" "); }
    append(...children) { for (const child of children) this.children.push(child); }
    replaceChildren(...children) { this.text = ""; this.children = []; this.append(...children); }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    addEventListener(key, fn) { (this.listeners[key] ||= []).push(fn); }
    dispatch(key, payload = {}) { for (const fn of this.listeners[key] || []) fn({ target: this, preventDefault() {}, ...payload }); }
    click() { if (!this.disabled) this.dispatch("click"); }
  }
  for (const match of template.matchAll(/<([a-z]+)\b[^>]*\bid="((?:model-lab|cmd)-[^"]+)"[^>]*>/g)) ids.set(match[2], new Element(match[1]));
  const body = new Element("body");
  body.classList = { contains: () => true };
  const document = { getElementById: (id) => ids.get(id) || null, createElement: (tag) => new Element(tag), body, activeElement: null };
  const window = { mefiStudio: { usageTracker: tracker, opencodeCredits: credits }, addEventListener: (type, fn) => listeners.set(type, fn) };
  vm.runInContext(source, vm.createContext({ window, document, Date, Number, String, Set, Math, Array, Object }));
  return { get: (id) => ids.get(id), window, emit: (name) => listeners.get(name)?.({}) };
}

test("the compact Command panel shows live windows and the local line side by side", async () => {
  const env = environment();
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const compact = env.get("cmd-usage-body").textContent;
  assert.match(compact, /42%/);
  assert.match(compact, /100%/);
  assert.match(compact, /Recorded today · 2 calls/);
  assert.match(compact, /Local estimate · 5h \$3\.00\/\$12/);
  assert.match(env.get("cmd-usage-state").textContent, /Updated/);
});

test("the Model Lab tracker tab separates the live account read from the local estimate", async () => {
  const env = environment();
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const full = env.get("model-lab-tracker-body").textContent;
  assert.match(full, /OpenCode Go · 5-hour window/);
  assert.match(full, /OpenCode Go · Monthly window/);
  assert.match(full, /Recorded OpenCode Go spend \(local estimate\)/);
  assert.match(full, /5h: \$3\.00 of \$12\.00 · 2 calls · 1 without reported cost/);
  assert.match(full, /deepseek-v4\.1-flash/);
  assert.match(full, /fixture coverage: recorded calls only/);
  assert.match(env.get("model-lab-tracker-status").textContent, /Updated/);
});

test("a failed account read is stated plainly and never invented from local spend", async () => {
  const env = environment({ credits: async () => ({ ok: false, code: "no-key", error: "No OpenCode Go key is saved. Add one in Settings to read account usage." }) });
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const compact = env.get("cmd-usage-body").textContent;
  assert.match(compact, /No OpenCode Go key is saved/);
  assert.match(compact, /—/);
  assert.match(env.get("cmd-usage-state").textContent, /live account read unavailable/);
  const full = env.get("model-lab-tracker-body").textContent;
  assert.match(full, /Unavailable/);
  assert.match(full, /No OpenCode Go key is saved/);
});

test("a failed local read leaves the account windows standing", async () => {
  const env = environment({ tracker: async () => ({ ok: false, error: "The ledger could not be read." }) });
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.match(env.get("model-lab-tracker-body").textContent, /Usage could not be read/);
  assert.match(env.get("cmd-usage-body").textContent, /42%/);
  assert.doesNotMatch(env.get("cmd-usage-body").textContent, /Recorded today/);
});

test("the footer collapses, and a project change forces a fresh reading", async () => {
  let reads = 0;
  const env = environment({ tracker: async () => { reads += 1; return localReport(); } });
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.equal(reads, 1);
  env.get("cmd-usage-toggle").click();
  assert.equal(env.get("cmd-usage-body").hidden, true);
  assert.equal(env.get("cmd-usage-toggle").attrs["aria-expanded"], "false");
  env.get("cmd-usage-toggle").click();
  assert.equal(env.get("cmd-usage-body").hidden, false);
  env.emit("mefi:project-changed");
  await flush();
  assert.equal(reads, 2);
});
