import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/tracker.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const flush = async () => { for (let index = 0; index < 18; index += 1) await Promise.resolve(); };

const usage = (known, unknown = 0) => ({ known, knownRecords: known === null ? 0 : 1, unknownRecords: unknown });
const bucket = (calls, cost, tokens, { studio = calls, cli = 0, unknownCost = 0 } = {}) => ({
  calls, errors: 0, cancelled: 0, origins: { studio, "opencode-cli": cli },
  usage: { costUsd: usage(cost, unknownCost), totalTokens: usage(tokens), inputTokens: usage(Math.round(tokens * 2 / 3)), outputTokens: usage(Math.round(tokens / 3)), cacheReadTokens: usage(0), cacheWriteTokens: usage(0), reasoningTokens: usage(0) },
});
const localReport = () => ({
  ok: true,
  generatedAt: 1,
  totals: bucket(3, 0.3, 450, { studio: 2, cli: 1, unknownCost: 1 }),
  today: bucket(2, 0.2, 300, { studio: 1, cli: 1, unknownCost: 1 }),
  week: bucket(3, 0.3, 450, { studio: 2, cli: 1, unknownCost: 1 }),
  month: bucket(3, 0.3, 450, { studio: 2, cli: 1, unknownCost: 1 }),
  days: [{ day: "2026-09-20", ...bucket(2, 0.2, 300, { studio: 1, cli: 1, unknownCost: 1 }), providers: [{ provider: "opencode-go", label: "OpenCode Go", ...bucket(1, 0.2, 100) }, { provider: "zai", label: "z.ai GLM", ...bucket(1, null, 200, { studio: 0, cli: 1, unknownCost: 1 }) }] }],
  models: [{ provider: "opencode-go", label: "OpenCode Go", model: "deepseek-v4.1-flash", ...bucket(2, 0.3, 250) }, { provider: "zai", label: "z.ai GLM", model: "glm-5.3-flash", ...bucket(1, null, 200, { studio: 0, cli: 1, unknownCost: 1 }) }],
  providers: [
    { provider: "opencode-go", label: "OpenCode Go", kind: "plan", account: "windows", providerIds: ["opencode", "opencode-go"], models: 1, ...bucket(2, 0.3, 250), today: bucket(1, 0.2, 100), week: bucket(2, 0.3, 250), month: bucket(2, 0.3, 250) },
    { provider: "zai", label: "z.ai GLM", kind: "plan", account: "quota", providerIds: ["mefi-zai"], models: 1, ...bucket(1, null, 200, { studio: 0, cli: 1, unknownCost: 1 }), today: bucket(1, null, 200, { studio: 0, cli: 1, unknownCost: 1 }), week: bucket(1, null, 200, { studio: 0, cli: 1, unknownCost: 1 }), month: bucket(1, null, 200, { studio: 0, cli: 1, unknownCost: 1 }) },
    { provider: "claude", label: "Claude Code CLI", kind: "subscription", account: null, providerIds: ["claude"], models: 1, ...bucket(1, null, 4500, { unknownCost: 1 }), today: bucket(1, null, 4500, { unknownCost: 1 }), week: bucket(1, null, 4500, { unknownCost: 1 }), month: bucket(1, null, 4500, { unknownCost: 1 }) },
  ],
  origins: { studio: bucket(2, 0.3, 250), "opencode-cli": bucket(1, null, 200, { studio: 0, cli: 1, unknownCost: 1 }) },
  lifetime: { calls: 9, range: { from: 0, to: 1 }, usage: { costUsd: usage(1) } },
  retention: { limit: 10000, dropped: 0 },
  store: { ok: true, error: null, rows: 3, scanned: 3, since: Date.parse("2026-08-17T00:00:00Z"), warm: false },
  credits: {
    provider: "opencode-go",
    limits: { rolling: 12, weekly: 30, monthly: 60 },
    rolling: { key: "rolling", limitUsd: 12, from: 0, to: 1, resetsAt: null, calls: 2, spentUsd: 3, knownRecords: 1, unknownRecords: 1, percent: 25 },
    weekly: { key: "weekly", limitUsd: 30, from: 0, to: 1, resetsAt: null, calls: 2, spentUsd: 5, knownRecords: 1, unknownRecords: 1, percent: 16.7 },
    monthly: { key: "monthly", limitUsd: 60, from: 0, to: 1, resetsAt: null, calls: 3, spentUsd: 5, knownRecords: 1, unknownRecords: 2, percent: 8.3 },
  },
  coverage: "fixture coverage: recorded calls only",
});
const goUsage = () => ({
  rolling: { status: "ok", percent: 42, resetsAt: "2026-09-20T17:00:00Z" },
  weekly: { status: "ok", percent: 34, resetsAt: "2026-09-21T00:00:00Z" },
  monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-10-01T00:00:00Z" },
});
const creditsReport = () => ({ ok: true, fetchedAt: Date.parse("2026-09-20T12:00:00Z"), usage: goUsage() });
const accountsReport = () => ({
  ok: true,
  at: Date.parse("2026-09-20T12:00:00Z"),
  accounts: [
    { provider: "opencode-go", label: "OpenCode Go", kind: "plan", account: "windows", connected: true, read: "windows", ok: true, fetchedAt: 1, usage: goUsage() },
    { provider: "zai", label: "z.ai GLM", kind: "plan", account: "quota", connected: true, read: "quota", ok: true, fetchedAt: 1, quota: { level: "pro", rolling: { percent: 40.5, resetsAt: "2026-09-20T15:00:00Z" }, weekly: { percent: 12, resetsAt: null }, tools: null } },
    { provider: "openrouter", label: "OpenRouter", kind: "metered", account: "key", connected: true, read: "key", ok: true, fetchedAt: 1, key: { label: "k", usage: 25.5, usageDaily: 1, usageWeekly: 2, usageMonthly: 3, limit: 100, limitRemaining: 74.5, limitReset: "monthly", percent: 25.5, isFreeTier: false }, credits: null },
    { provider: "gateway", label: "Vercel AI Gateway", kind: "metered", account: "credits", connected: true, read: "credits", ok: true, fetchedAt: 1, credits: { balance: 95.5, totalUsed: 4.5 } },
    { provider: "claude", label: "Claude Code CLI", kind: "subscription", account: null, connected: true, read: "none", ok: true, fetchedAt: null, note: "Claude Code CLI bills its own login and has no account API; its replies report tokens, which are counted below." },
    { provider: "typesafe", label: "TypeSafe Jev API", kind: "metered", account: null, connected: true, read: "none", ok: true, fetchedAt: null, note: "TypeSafe publishes no usage API; Jev calls are counted from the local ledger." },
  ],
});

function environment({ tracker = async () => localReport(), credits = async () => creditsReport(), accounts = async () => accountsReport() } = {}) {
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
  const bridge = { usageTracker: tracker, opencodeCredits: credits };
  if (accounts) bridge.usageAccounts = accounts;
  const window = { mefiStudio: bridge, addEventListener: (type, fn) => listeners.set(type, fn) };
  vm.runInContext(source, vm.createContext({ window, document, Date, Number, String, Set, Math, Array, Object }));
  return { get: (id) => ids.get(id), window, emit: (name) => listeners.get(name)?.({}) };
}

test("the compact Command panel leads with the live plan account, then one aligned row per provider and the recorded lines", async () => {
  const env = environment();
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const body = env.get("cmd-usage-body");
  const compact = body.textContent;
  const lead = body.children[0];
  assert.equal(lead.className, "tracker-lead", "the first connected live account owns the bars");
  assert.match(lead.textContent, /OpenCode Go plan windows/);
  assert.match(lead.textContent, /42%/);
  assert.match(lead.textContent, /100%/);
  assert.match(lead.textContent, /Limit reached: Mo/);
  assert.match(compact, /z\.ai GLM\s+5h 40\.5% · wk 12% · today 1 call · 200 tokens/);
  assert.match(compact, /OpenRouter\s+\$25\.50 spent · \$74\.50 left of \$100\.00/);
  assert.match(compact, /Vercel AI Gateway\s+\$95\.50 left · \$4\.50 used/);
  assert.match(compact, /Claude Code CLI\s+today 1 call · 4,500 tokens/);
  assert.match(compact, /TypeSafe Jev API\s+no calls today/);
  assert.match(compact, /Recorded today\s+2 calls · 300 tokens/);
  assert.match(compact, /Local estimate\s+5h \$3\.00\/\$12/);
  assert.doesNotMatch(compact, /OpenCode Go ·/, "the Go account is the lead box, not a second row");
  const rows = body.children.filter((child) => child.className === "tracker-rows");
  assert.equal(rows.length, 2, "connected providers and recorded totals are two aligned lists");
  assert.equal(rows[0].children.length, 5, "every provider but the lead gets one row");
  assert.equal(rows[0].children[0].className, "tracker-row");
  assert.match(env.get("cmd-usage-state").textContent, /Updated .* · OpenCode Go 5h 42% · wk 34%/, "the popover's status line says the one thing worth knowing");
  assert.equal(env.get("cmd-usage-brief").textContent, "5h 42% · wk 34%", "the pill carries the lead account's two windows");
  assert.equal(env.get("cmd-usage-dot").hidden, false, "a rate-limited monthly window lights the pill's dot");
  assert.match(env.get("cmd-usage-toggle").title, /OpenCode Go 5h 42%/, "the pill's tooltip is the full status");
});

test("with no Go key the z.ai quota leads the compact panel instead of empty Go bars", async () => {
  const env = environment({
    credits: async () => ({ ok: false, code: "no-key", error: "No OpenCode Go key is saved. Add one in Settings to read account usage." }),
    accounts: async () => ({ ok: true, at: 1, accounts: accountsReport().accounts.filter((account) => account.provider !== "opencode-go") }),
  });
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const body = env.get("cmd-usage-body");
  const lead = body.children[0];
  assert.equal(lead.className, "tracker-lead");
  assert.match(lead.textContent, /z\.ai GLM pro plan/);
  assert.match(lead.textContent, /40\.5%/);
  assert.match(lead.textContent, /12%/);
  assert.doesNotMatch(body.textContent, /No OpenCode Go key is saved/, "an account that was never connected is not a warning");
  assert.doesNotMatch(body.textContent, /z\.ai GLM\s+5h/, "the lead account is not repeated as a row");
  assert.match(env.get("cmd-usage-state").textContent, /z\.ai GLM 5h 40\.5% · wk 12%$/, "and no unavailable note for a key that was never saved");
});

test("the Model Lab tracker tab lists every connected account beside both ledgers", async () => {
  const env = environment();
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const full = env.get("model-lab-tracker-body").textContent;
  assert.match(full, /Connected accounts \(live\)/);
  assert.match(full, /OpenCode Go · live/);
  assert.match(full, /5-hour window/);
  assert.match(full, /Limit reached: Monthly window/);
  assert.match(full, /z\.ai GLM · live/);
  assert.match(full, /40\.5% of the 5-hour window/);
  assert.match(full, /pro plan/);
  assert.match(full, /\$25\.50 spent/);
  assert.match(full, /\$74\.50 left of the \$100\.00 key limit \(monthly\)/);
  assert.match(full, /\$95\.50 left/);
  assert.match(full, /No account API/);
  assert.match(full, /bills its own login/);
  assert.match(full, /Recorded OpenCode Go spend \(local estimate\)/);
  assert.match(full, /5h: \$3\.00 of \$12\.00 · 2 calls · 1 without reported cost/);
  assert.match(full, /By provider/);
  assert.match(full, /Unpriced calls/);
  assert.match(full, /ids opencode, opencode-go/);
  assert.match(full, /Studio 1 · coding 1/);
  assert.match(full, /deepseek-v4\.1-flash/);
  assert.match(full, /glm-5\.3-flash/);
  assert.match(full, /z\.ai GLM · 1/, "the day row names each provider's share");
  assert.match(full, /Providers 3/);
  assert.match(full, /6 connected/);
  assert.match(full, /fixture coverage: recorded calls only/);
  assert.match(full, /Coding sessions: 3 turns read from the OpenCode store/);
  assert.match(env.get("model-lab-tracker-status").textContent, /Updated/);
});

test("a failed account read is stated plainly and never invented from local spend", async () => {
  const env = environment({
    credits: async () => ({ ok: false, code: "no-key", error: "No OpenCode Go key is saved. Add one in Settings to read account usage." }),
    accounts: async () => ({ ok: true, at: 1, accounts: [
      { provider: "openrouter", label: "OpenRouter", kind: "metered", account: "key", connected: true, read: "key", ok: false, fetchedAt: 1, code: "auth", error: "OpenRouter rejected the saved key (401). Save a current key in Settings." },
    ] }),
  });
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const body = env.get("cmd-usage-body");
  const compact = body.textContent;
  assert.notEqual(body.children[0].className, "tracker-lead", "no live reading means no bars");
  assert.match(compact, /OpenRouter · OpenRouter rejected the saved key/, "the failed read leads, stated plainly");
  assert.match(compact, /OpenRouter\s+OpenRouter rejected the saved key \(401\)/);
  assert.match(env.get("cmd-usage-state").textContent, /1 account read unavailable \(OpenRouter\)/, "the missing Go key is not a failed read; the rejected OpenRouter key is, and it is named");
  assert.equal(env.get("cmd-usage-dot").hidden, false, "a failed read lights the pill's dot");
  assert.equal(env.get("cmd-usage-brief").textContent, "today 2 calls", "no live account: the pill falls back to today's recorded calls");
  const full = env.get("model-lab-tracker-body").textContent;
  assert.match(full, /Unavailable/);
  assert.match(full, /No OpenCode Go key is saved/);
  assert.match(full, /rejected the saved key \(401\)/);
});

test("a failed local read leaves the account readings standing", async () => {
  const env = environment({ tracker: async () => ({ ok: false, error: "The ledger could not be read." }) });
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.match(env.get("model-lab-tracker-body").textContent, /Usage could not be read/);
  const compact = env.get("cmd-usage-body").textContent;
  assert.match(compact, /42%/);
  assert.match(compact, /Vercel AI Gateway\s+\$95\.50 left/);
  assert.match(compact, /Claude Code CLI\s+no calls today/);
  assert.doesNotMatch(compact, /Recorded today/);
});

test("an unreadable OpenCode store is said once and the Studio ledger still renders", async () => {
  const env = environment({ tracker: async () => ({ ...localReport(), store: { ok: false, error: "Coding sessions could not be read: worker exited", rows: 0, scanned: 0, since: null, warm: false } }) });
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.match(env.get("cmd-usage-body").textContent, /Coding sessions unavailable/);
  assert.match(env.get("model-lab-tracker-body").textContent, /Coding sessions: Coding sessions could not be read: worker exited/);
});

test("a build without the accounts bridge still shows the Go windows from the older read", async () => {
  const env = environment({ accounts: null });
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const full = env.get("model-lab-tracker-body").textContent;
  assert.match(full, /OpenCode Go · live/);
  assert.match(full, /1 connected/);
  assert.match(env.get("cmd-usage-body").textContent, /42%/);
});

test("the Usage pill opens the breakdown above it, closes it again, and a project change forces a fresh reading", async () => {
  let reads = 0;
  const env = environment({ tracker: async () => { reads += 1; return localReport(); } });
  assert.equal(env.get("cmd-usage-pop").hidden, true, "the breakdown starts closed");
  assert.equal(env.get("cmd-usage-toggle").attrs["aria-expanded"], "false");
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.equal(reads, 1);
  env.get("cmd-usage-toggle").click();
  assert.equal(env.get("cmd-usage-pop").hidden, false);
  assert.equal(env.get("cmd-usage-body").hidden, false);
  assert.equal(env.get("cmd-usage-toggle").attrs["aria-expanded"], "true");
  assert.equal(reads, 1, "opening within the freshness window reuses the reading it just made");
  env.get("cmd-usage-toggle").click();
  assert.equal(env.get("cmd-usage-pop").hidden, true);
  assert.equal(env.get("cmd-usage-body").hidden, true);
  assert.equal(env.get("cmd-usage-toggle").attrs["aria-expanded"], "false");
  env.window.MefiUsageTracker.setOpen(true);
  env.get("cmd-usage-open").click();
  assert.equal(env.get("cmd-usage-pop").hidden, true, "Details closes the breakdown before leaving Command");
  env.emit("mefi:project-changed");
  await flush();
  assert.equal(reads, 2);
});
