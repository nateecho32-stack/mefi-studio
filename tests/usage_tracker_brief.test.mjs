// MefiUsageTracker.brief(): the plain reading the 0.5 shell's status bar takes (renderer/shell.js):
// the lead plan's windows and what today's recorded calls cost, from the last report, without
// reading anything itself. The same stand-in window as tests/usage_tracker_ui.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/tracker.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const flush = async () => { for (let index = 0; index < 18; index += 1) await Promise.resolve(); };
const inHours = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const plain = (value) => JSON.parse(JSON.stringify(value));

const usage = (known, unknown = 0) => ({ known, knownRecords: known === null ? 0 : 1, unknownRecords: unknown });
const bucket = (calls, cost, tokens, { unknownCost = 0 } = {}) => ({
  calls, errors: 0, cancelled: 0, origins: { studio: calls },
  usage: { costUsd: usage(cost, unknownCost), totalTokens: usage(tokens), inputTokens: usage(tokens), outputTokens: usage(0), cacheReadTokens: usage(0), cacheWriteTokens: usage(0), reasoningTokens: usage(0) },
});
const localReport = (today = bucket(7, 0.32, 5800)) => ({ ok: true, generatedAt: 1, totals: today, today, week: today, month: today, days: [], models: [], providers: [], origins: {}, lifetime: { calls: 7, range: { from: 0, to: 1 }, usage: { costUsd: usage(1) } }, retention: { limit: 10000, dropped: 0 }, store: { ok: true, error: null, rows: 3, scanned: 3, since: 1, warm: false }, credits: null, coverage: "fixture" });
const goUsage = () => ({ rolling: { status: "ok", percent: 42, resetsAt: inHours(2) }, weekly: { status: "ok", percent: 34, resetsAt: inHours(40) }, monthly: { status: "rate-limited", percent: 100, resetsAt: inHours(200) } });
const goAccount = () => ({ provider: "opencode-go", key: "opencode-go", label: "OpenCode Go", kind: "plan", account: "windows", connected: true, read: "windows", ok: true, fetchedAt: Date.now(), refreshing: false, usage: goUsage() });
const creditsReport = () => ({ ok: true, fetchedAt: Date.now(), usage: goUsage() });
const accountsReport = (list = [goAccount()]) => ({ ok: true, at: Date.now(), accounts: list, pending: [] });

function environment({ tracker = async () => localReport(), credits = async () => creditsReport(), accounts: accountsRead = async () => accountsReport(), timers = false } = {}) {
  const ids = new Map();
  const listeners = new Map();
  const probes = [];
  const scheduled = [];
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
    focus() { this.focused = true; }
  }
  for (const match of template.matchAll(/<([a-z]+)\b[^>]*\bid="((?:model-lab|cmd)-[^"]+)"[^>]*>/g)) {
    const node = new Element(match[1]);
    // An element the template ships hidden (the Model Lab tabs, the popover) starts hidden here too.
    node.hidden = /\shidden(?=[\s>])/.test(match[0]);
    ids.set(match[2], node);
  }
  const body = new Element("body");
  body.classList = { contains: () => true };
  const document = { getElementById: (id) => ids.get(id) || null, createElement: (tag) => new Element(tag), body, activeElement: null };
  const bridge = { usageTracker: tracker, opencodeCredits: credits };
  if (accountsRead) bridge.usageAccounts = async (options) => { probes.push({ ...options }); return accountsRead(options); };
  const window = { mefiStudio: bridge, addEventListener: (type, fn) => listeners.set(type, fn) };
  const context = { window, document, Date, Number, String, Set, Math, Array, Object };
  if (timers) Object.assign(context, { setTimeout: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; }, clearTimeout: () => {} });
  // The Legend pill belongs to idle.js, which loads after tracker.js and
  // toggles its list on click; this stands in for it.
  const legendToggle = new Element("button");
  ids.set("idle-legend-toggle", legendToggle);
  vm.runInContext(source, vm.createContext(context));
  legendToggle.addEventListener("click", () => { const list = ids.get("cmd-legend-list"); list.hidden = !list.hidden; });
  return { get: (id) => ids.get(id), window, probes, scheduled, emit: (name, payload = {}) => listeners.get(name)?.(payload) };
}

test("before any reading there is nothing to say, and after one brief() is plain data: the lead plan's windows and today's cost", async () => {
  const env = environment();
  assert.equal(env.window.MefiUsageTracker.brief(), null, "no report yet");
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const brief = plain(env.window.MefiUsageTracker.brief());
  assert.equal(typeof brief.at, "number");
  assert.equal(brief.plan.label, "OpenCode Go");
  assert.deepEqual(brief.plan.windows.map((window) => [window.short, window.percent]), [["5h", 42], ["Wk", 34], ["Mo", 100]]);
  assert.ok(brief.plan.windows.every((window) => typeof window.label === "string" && window.label), "each window has words");
  assert.deepEqual(brief.today, { calls: 7, costUsd: 0.32 });
  assert.equal(JSON.stringify(brief), JSON.stringify(plain(brief)), "nothing but data: no node, no function");
});

test("today's cost is a number only when a recorded call priced it, and a failed ledger says nothing about today", async () => {
  const unpriced = environment({ tracker: async () => localReport(bucket(3, null, 900, { unknownCost: 3 })) });
  await unpriced.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.deepEqual(plain(unpriced.window.MefiUsageTracker.brief().today), { calls: 3, costUsd: null }, "calls with no price are not a cost of 0");
  const failed = environment({ tracker: async () => ({ ok: false, error: "no ledger" }) });
  await failed.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.equal(failed.window.MefiUsageTracker.brief()?.today ?? null, null, "a ledger that could not be read is not a day with no cost");
  const noAccounts = environment({ accounts: async () => accountsReport([]), credits: async () => ({ ok: false, error: "none" }) });
  await noAccounts.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.equal(noAccounts.window.MefiUsageTracker.brief().plan, null, "no plan with a live reading: no meters");
});

test("brief() reads what the last report holds and asks the host for nothing", async () => {
  let reads = 0;
  const env = environment({ tracker: async () => { reads += 1; return localReport(); }, credits: async () => { reads += 1; return creditsReport(); }, accounts: async () => { reads += 1; return accountsReport(); } });
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const after = reads;
  for (let index = 0; index < 5; index += 1) env.window.MefiUsageTracker.brief();
  assert.equal(reads, after, "no read, however often the status bar asks");
  assert.deepEqual(Object.keys(env.window.MefiUsageTracker).sort(), ["brief", "init", "open", "openTab", "refresh", "report", "setOpen", "tick"], "the rest of the tracker's surface is as it was");
});
