import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/tracker.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const flush = async () => { for (let index = 0; index < 18; index += 1) await Promise.resolve(); };
const inHours = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

const usage = (known, unknown = 0) => ({ known, knownRecords: known === null ? 0 : 1, unknownRecords: unknown });
const bucket = (calls, cost, tokens, { studio = calls, cli = 0, unknownCost = 0, errors = 0 } = {}) => ({
  calls, errors, cancelled: 0, origins: { studio, "opencode-cli": cli },
  usage: { costUsd: usage(cost, unknownCost), totalTokens: usage(tokens), inputTokens: usage(tokens === null ? null : Math.round(tokens * 2 / 3)), outputTokens: usage(tokens === null ? null : Math.round(tokens / 3)), cacheReadTokens: usage(0), cacheWriteTokens: usage(0), reasoningTokens: usage(0) },
});
const providerRow = (provider, label, kind, today, extra = {}) => ({ provider, label, kind, account: null, providerIds: [provider], models: 1, ...today, today, week: today, month: today, ...extra });
const localReport = () => ({
  ok: true,
  generatedAt: 1,
  totals: bucket(9, 0.42, 6200, { studio: 8, cli: 1, unknownCost: 3 }),
  today: bucket(7, 0.32, 5800, { studio: 6, cli: 1, unknownCost: 3, errors: 1 }),
  week: bucket(9, 0.42, 6200, { studio: 8, cli: 1, unknownCost: 3 }),
  month: bucket(9, 0.42, 6200, { studio: 8, cli: 1, unknownCost: 3 }),
  days: [{ day: "2026-09-20", ...bucket(2, 0.2, 300, { studio: 1, cli: 1, unknownCost: 1 }), providers: [{ provider: "opencode-go", label: "OpenCode Go", ...bucket(1, 0.2, 100) }, { provider: "zai", label: "z.ai GLM", ...bucket(1, null, 200, { studio: 0, cli: 1, unknownCost: 1 }) }] }],
  models: [{ provider: "opencode-go", label: "OpenCode Go", model: "deepseek-v4.1-flash", ...bucket(2, 0.3, 250) }, { provider: "zai", label: "z.ai GLM", model: "glm-5.3-flash", ...bucket(1, null, 200, { studio: 0, cli: 1, unknownCost: 1 }) }],
  providers: [
    { ...providerRow("opencode-go", "OpenCode Go", "plan", bucket(2, 0.2, 400)), account: "windows", providerIds: ["opencode", "opencode-go"] },
    providerRow("opencode-zen", "OpenCode Zen", "metered", bucket(3, 0.12, 900)),
    providerRow("claude", "Claude Code CLI", "subscription", bucket(1, null, 4500, { unknownCost: 1 })),
    providerRow("codex", "Codex CLI", "subscription", bucket(1, null, null, { unknownCost: 1, errors: 1 })),
    providerRow("grok", "Grok CLI", "subscription", bucket(0, null, 0)),
  ],
  origins: { studio: bucket(8, 0.3, 250), "opencode-cli": bucket(1, null, 200, { studio: 0, cli: 1, unknownCost: 1 }) },
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
  rolling: { status: "ok", percent: 42, resetsAt: inHours(2) },
  weekly: { status: "ok", percent: 34, resetsAt: inHours(40) },
  monthly: { status: "rate-limited", percent: 100, resetsAt: inHours(200) },
});
const creditsReport = () => ({ ok: true, fetchedAt: Date.now(), usage: goUsage() });
const window = (id, short, label, percent, resetsAt, extra = {}) => ({ id, short, label, percent, resetsAt, severity: null, scope: null, minutes: null, ...extra });
const account = (provider, label, kind, read, fields) => ({ provider, key: provider, label, kind, account: read, connected: true, read, ok: true, fetchedAt: Date.now(), refreshing: false, ...fields });
const accounts = {
  go: () => account("opencode-go", "OpenCode Go", "plan", "windows", { usage: goUsage() }),
  zai: () => account("zai", "z.ai GLM", "plan", "quota", { quota: { level: "lite", plan: "credits", empty: false,
    rolling: { percent: 20.1, resetsAt: inHours(3), used: 402, limit: 2000, remaining: 1597, measure: "credits", minutes: 300 },
    weekly: { percent: 52.1, resetsAt: inHours(90), used: 5207, limit: 10000, remaining: 4792, measure: "credits", minutes: 10080 },
    tools: null, other: [] } }),
  claude: () => account("claude", "Claude Code CLI", "subscription", "limits", { limits: { plan: "max", source: "cli", asOf: Date.now(), available: true, note: null, blocked: false, windows: [
    window("5h", "5h", "5-hour session", 88, inHours(1.5), { severity: "warning", minutes: 300 }),
    window("week", "Wk", "Weekly · all models", 24, inHours(130), { severity: "normal", minutes: 10080 }),
    window("week:fable", "Fable", "Weekly · Fable", 0, inHours(130), { severity: "normal", scope: "Fable", minutes: 10080 }),
  ] } }),
  codex: () => account("codex", "Codex CLI", "subscription", "limits", { fetchedAt: Date.now() - 2 * 86400000, limits: { plan: "pro", source: "rollout", asOf: Date.now() - 2 * 86400000, available: true, note: null, blocked: true, credits: null, windows: [
    window("week", "Wk", "Weekly window", 100, inHours(88), { minutes: 10080 }),
  ] } }),
  grok: () => account("grok", "Grok CLI", "subscription", "limits", { limits: { plan: null, source: "cli", asOf: Date.now(), available: true, note: null, blocked: true, credits: { prepaidUsd: 0, onDemandCapUsd: 0, onDemandUsedUsd: 0 }, windows: [
    window("week", "Wk", "Weekly credits", 100, inHours(50), { minutes: 10080 }),
  ] } }),
  openrouter: () => account("openrouter", "OpenRouter", "metered", "key", { key: { label: "k", usage: 0.11, usageDaily: 0, usageWeekly: 0.02, usageMonthly: 0.11, limit: null, limitRemaining: null, limitReset: null, percent: null, isFreeTier: true, isManagementKey: false, freeDaily: { used: 12, limit: 50, remaining: 38 }, expiresAt: null, byokUsage: 0 }, credits: { totalCredits: 0, totalUsage: 0.11, remaining: 0, balance: -0.11 } }),
  gateway: () => account("gateway", "Vercel AI Gateway", "metered", "credits", { credits: { balance: 95.5, totalUsed: 4.5 } }),
  lmstudio: () => account("lmstudio", "LM Studio (local)", "local", "local", { local: { reachable: true, model: "qwen3-8b", host: "127.0.0.1:1234" } }),
  zen: () => ({ provider: "opencode-zen", key: "opencode-zen", label: "OpenCode Zen", kind: "metered", account: null, connected: true, read: "none", ok: true, fetchedAt: null, note: "OpenCode Zen has no balance or usage API." }),
  typesafe: () => ({ provider: "typesafe", key: "typesafe", label: "TypeSafe Jev API", kind: "metered", account: null, connected: true, read: "none", ok: true, fetchedAt: null, note: "TypeSafe publishes no usage API; Jev calls are counted from the local ledger." }),
};
const allAccounts = () => ["openrouter", "gateway", "zai", "go", "grok", "codex", "claude", "lmstudio", "zen", "typesafe"].map((name) => accounts[name]());
const accountsReport = (list = allAccounts(), pending = []) => ({ ok: true, at: Date.now(), accounts: list, pending });

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
const byClass = (node, className, found = []) => {
  if (node.className === className) found.push(node);
  for (const child of node.children ?? []) byClass(child, className, found);
  return found;
};
const cardOf = (body, label) => byClass(body, "tracker-plan").find((card) => card.children[0].children[0].textContent === label);
const rowOf = (body, label) => byClass(body, "tracker-row").find((row) => row.children[0].textContent === label);

test("the compact panel draws every plan as a card, the metered accounts as balances, and today per provider", async () => {
  const env = environment();
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const body = env.get("cmd-usage-body");
  const text = body.textContent;
  assert.deepEqual(body.children.filter((child) => child.className === "tracker-kicker").map((child) => child.textContent), ["Plan limits", "Balances", "Today"]);
  const cards = byClass(body, "tracker-plan");
  assert.deepEqual(cards.map((card) => card.children[0].children[0].textContent), ["OpenCode Go", "z.ai GLM", "Claude Code CLI", "Codex CLI", "Grok CLI"], "plans draw in a fixed order, whatever order the host read them in");
  const go = cardOf(body, "OpenCode Go");
  assert.match(go.textContent, /plan windows/);
  assert.match(go.textContent, /5h\s+42%/);
  assert.match(go.textContent, /Mo\s+100%/);
  assert.match(go.textContent, /Limit reached: Mo/);
  assert.equal(go.attrs["data-tone"], "warn");
  const zai = cardOf(body, "z.ai GLM");
  assert.match(zai.textContent, /Lite · credits/);
  assert.match(zai.textContent, /5h\s+20\.1%/);
  assert.match(zai.textContent, /402 \/ 2,000 credits used this 5-hour window/);
  assert.equal(zai.attrs["data-tone"], undefined, "a plan with room left is not a warning");
  const claude = cardOf(body, "Claude Code CLI");
  assert.match(claude.textContent, /Max/);
  assert.match(claude.textContent, /5h\s+88%/);
  assert.match(claude.textContent, /Fable\s+0%/);
  assert.equal(claude.attrs["data-tone"], "warn", "the plan's own warning severity counts");
  const codex = cardOf(body, "Codex CLI");
  assert.match(codex.textContent, /Pro · as of/);
  assert.match(codex.textContent, /Wk\s+100%/);
  assert.match(codex.textContent, /Limit reached until/);
  assert.match(codex.textContent, /From the last Codex session/);
  assert.match(cardOf(body, "Grok CLI").textContent, /Wk\s+100%/);
  const resets = byClass(go, "tracker-window-reset").map((node) => node.textContent);
  assert.equal(resets.length, 3);
  assert.ok(resets[0].length > 0, "a window with use shows its reset");
  assert.equal(rowOf(body, "OpenRouter").children[1].textContent, "free models · 12/50 today", "a free key with no spend today says only that");
  assert.match(rowOf(body, "OpenRouter").title, /\$0\.11 spent on this key to date/, "the lifetime figure moves to the tooltip");
  assert.match(rowOf(body, "Vercel AI Gateway").textContent, /\$95\.50 left · \$4\.50 used/);
  assert.match(rowOf(body, "LM Studio (local)").textContent, /running · qwen3-8b/);
  assert.match(rowOf(body, "Claude Code CLI").textContent, /1 call · 4,500 tok/);
  assert.equal(rowOf(body, "Codex CLI").children[1].textContent, "1 call · 1 failed", "tokens a provider never reported are left out, never printed as ?");
  assert.equal(rowOf(body, "Codex CLI").attrs["data-tone"], "warn");
  assert.match(rowOf(body, "OpenCode Zen").textContent, /3 calls · 900 tok · \$0\.12/);
  assert.equal(rowOf(body, "Grok CLI"), undefined, "a provider with no calls today has no Today row");
  assert.match(rowOf(body, "All providers").textContent, /7 calls · 1 failed · 5,800 tok · \$0\.32/);
  assert.doesNotMatch(text, /Go estimate/, "with the live Go windows in, the local Go estimate would only repeat them less accurately");
  assert.match(text, /Also connected: TypeSafe Jev API · no calls today/);
  assert.doesNotMatch(text, /\?/);
  assert.match(env.get("cmd-usage-state").textContent, /^Updated [^·]+$/, "nothing failed and nothing is being read");
  assert.equal(env.get("cmd-usage-brief").textContent, "5h 42% · mo 100%", "the pill carries the lead plan's first window and the fullest of the rest, so a spent month is never hidden");
  assert.equal(env.get("cmd-usage-dot").hidden, false, "a spent window lights the pill's dot");
  assert.match(env.get("cmd-usage-toggle").title, /OpenCode Go 5h 42% · mo 100%/, "the pill's tooltip names the lead plan");
});

test("the lead falls to the next fresh plan; a Codex rollout or an old reading never leads", async () => {
  const noGo = environment({
    credits: async () => ({ ok: false, code: "no-key", error: "No OpenCode Go key is saved. Add one in Settings to read account usage." }),
    accounts: async () => accountsReport(allAccounts().filter((entry) => entry.provider !== "opencode-go")),
  });
  await noGo.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.equal(noGo.get("cmd-usage-brief").textContent, "5h 20.1% · wk 52.1%");
  assert.doesNotMatch(noGo.get("cmd-usage-body").textContent, /No OpenCode Go key is saved/, "an account that was never connected is not a warning");
  assert.doesNotMatch(noGo.get("cmd-usage-state").textContent, /failed/);
  const old = accounts.claude();
  old.limits.asOf = Date.now() - 2 * 3600000;
  const cliOnly = environment({
    credits: async () => ({ ok: false, code: "no-key", error: "No key" }),
    accounts: async () => accountsReport([accounts.codex(), old, accounts.grok()]),
  });
  await cliOnly.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.equal(cliOnly.get("cmd-usage-brief").textContent, "wk 100%", "the fresh Grok reading leads; the rollout and the two-hour-old Claude reading do not");
  assert.match(cardOf(cliOnly.get("cmd-usage-body"), "Claude Code CLI").textContent, /Max · as of/, "an older reading says how old it is");
});

test("a CLI plan being read says so, the panel asks again while it is open, and only a look may start a probe", async () => {
  const reading = { ...accounts.claude(), ok: false, code: "pending", error: "Reading plan windows…", refreshing: true, limits: undefined };
  const idle = { ...accounts.grok(), ok: false, code: "idle", error: "Open the Usage panel to read plan windows.", limits: undefined };
  let pending = ["claude"];
  const env = environment({ timers: true, accounts: async () => accountsReport([accounts.go(), reading, idle], pending) });
  await env.window.MefiUsageTracker.refresh({ force: true, probe: false });
  await flush();
  assert.deepEqual(env.probes.at(-1), { probe: false }, "a reading nobody asked for never starts a CLI");
  assert.equal(env.scheduled.length, 0, "nobody is looking, so nothing is asked again");
  env.get("cmd-usage-toggle").click();
  await flush();
  assert.deepEqual(env.probes.at(-1), { probe: true }, "opening the panel lets the host read the CLI plans, even right after a reading that could not");
  const body = env.get("cmd-usage-body");
  const card = cardOf(body, "Claude Code CLI");
  assert.match(card.textContent, /Reading plan windows…/);
  assert.equal(card.attrs["data-tone"], "idle");
  assert.equal(cardOf(body, "Grok CLI").attrs["data-tone"], "idle");
  assert.match(env.get("cmd-usage-state").textContent, /reading Claude Code CLI…/);
  assert.doesNotMatch(env.get("cmd-usage-state").textContent, /failed/, "a plan being read is not a failed read");
  const follow = env.scheduled.at(-1);
  assert.equal(follow.ms, 3000, "a probe in flight is asked about again shortly");
  pending = [];
  follow.fn();
  await flush();
  assert.deepEqual(env.probes.at(-1), { probe: false }, "a follow-up never starts a second probe");
  const count = env.scheduled.length;
  env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.equal(env.scheduled.length, count, "nothing pending, nothing scheduled");
  const reads = env.probes.length;
  env.window.MefiUsageTracker.tick();
  await flush();
  assert.equal(env.probes.length, reads, "the background tick leaves a fresh reading alone");
  assert.match(source, /if \(Date\.now\(\) - state\.at >= REFRESH_MS\) refresh\(\{ probe: false \}\);/, "and when it does read, it never starts a CLI");
});

test("failed reads are stated plainly in their own card or row and named in the status", async () => {
  const env = environment({
    credits: async () => ({ ok: false, code: "no-key", error: "No OpenCode Go key is saved. Add one in Settings to read account usage." }),
    accounts: async () => accountsReport([
      { ...accounts.zai(), ok: false, code: "auth", error: "z.ai rejected the saved key (401). Save a current key in Settings.", quota: undefined },
      { ...accounts.openrouter(), ok: false, code: "auth", error: "OpenRouter rejected the saved key (401). Save a current key in Settings.", key: undefined, credits: undefined },
      { ...accounts.codex(), ok: false, code: "timeout", error: "Codex did not report usage within 45 s.", limits: undefined },
    ]),
  });
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const body = env.get("cmd-usage-body");
  const zai = cardOf(body, "z.ai GLM");
  assert.equal(zai.attrs["data-tone"], "warn");
  assert.match(zai.textContent, /z\.ai rejected the saved key \(401\)/);
  assert.equal(byClass(zai, "tracker-window").length, 0, "no reading, no bars");
  const openrouter = rowOf(body, "OpenRouter");
  assert.equal(openrouter.attrs["data-tone"], "error", "a failed balance read stacks its whole reason");
  assert.match(openrouter.textContent, /rejected the saved key \(401\)/);
  assert.match(cardOf(body, "Codex CLI").textContent, /did not report usage within 45 s/);
  assert.match(env.get("cmd-usage-state").textContent, /3 account reads failed \(z\.ai GLM, OpenRouter, Codex CLI\)/, "the missing Go key is not a failed read; these are, and they are named");
  assert.equal(env.get("cmd-usage-dot").hidden, false);
  assert.equal(env.get("cmd-usage-brief").textContent, "today 7 calls", "no live plan: the pill falls back to today's recorded calls");
  const full = env.get("model-lab-tracker-body").textContent;
  assert.match(full, /Unavailable/);
  assert.match(full, /No OpenCode Go key is saved/);
  assert.match(full, /rejected the saved key \(401\)/);
});

test("a key with no plan windows, and the Go estimate when the live Go read is down", async () => {
  const env = environment({
    credits: async () => ({ ok: false, code: "http", error: "OpenCode usage could not be read (HTTP 503)" }),
    accounts: async () => accountsReport([
      { ...accounts.go(), ok: false, code: "http", error: "OpenCode usage could not be read (HTTP 503)", usage: undefined },
      { ...accounts.zai(), quota: { level: "pro", plan: null, empty: true, rolling: null, weekly: null, tools: null, other: [] } },
    ]),
  });
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const body = env.get("cmd-usage-body");
  const zai = cardOf(body, "z.ai GLM");
  assert.match(zai.textContent, /No plan windows for this key/);
  assert.equal(zai.attrs["data-tone"], undefined, "an empty plan list is a state, not a warning");
  assert.match(rowOf(body, "Go estimate (local)").textContent, /5h \$3\.00\/\$12 · wk \$5\.00\/\$30 · mo \$5\.00\/\$60/, "with the live Go read down, the recorded estimate stands in");
});

test("a failed local read leaves the account readings standing", async () => {
  const env = environment({ tracker: async () => ({ ok: false, error: "The ledger could not be read." }) });
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.match(env.get("model-lab-tracker-body").textContent, /Usage could not be read/);
  const compact = env.get("cmd-usage-body").textContent;
  assert.match(compact, /42%/);
  assert.match(compact, /Vercel AI Gateway\s+\$95\.50 left/);
  assert.match(compact, /The ledger could not be read/);
  assert.doesNotMatch(compact, /Today/);
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

test("the Model Lab tracker tab lists every connected account beside both ledgers", async () => {
  const env = environment();
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const full = env.get("model-lab-tracker-body").textContent;
  assert.match(full, /Connected accounts \(live\)/);
  assert.match(full, /OpenCode Go · live/);
  assert.match(full, /42% of the 5-hour window/);
  assert.match(full, /Limit reached: Monthly window/);
  assert.match(full, /z\.ai GLM · live/);
  assert.match(full, /20\.1% of the 5-hour window/);
  assert.match(full, /Lite · credits/);
  assert.match(full, /Claude Code CLI · live/);
  assert.match(full, /88% of the 5-hour session/);
  assert.match(full, /Weekly · Fable/);
  assert.match(full, /read through the Claude Code CLI/);
  assert.match(full, /100% of the weekly window/);
  assert.match(full, /from the last Codex session at/);
  assert.match(full, /Weekly credits/);
  assert.match(full, /\$0\.11 spent/);
  assert.match(full, /free models 12 of 50 requests today/);
  assert.match(full, /−\$0\.11 of \$0\.00 credits left/, "an overdrawn account keeps its sign");
  assert.match(full, /\$95\.50 left/);
  assert.match(full, /running · qwen3-8b/);
  assert.match(full, /No account API/);
  assert.match(full, /TypeSafe publishes no usage API/);
  assert.match(full, /Recorded OpenCode Go spend \(local estimate\)/);
  assert.match(full, /the live Go windows above are the real figure/);
  assert.match(full, /5h: \$3\.00 of \$12\.00 · 2 calls · 1 without reported cost/);
  assert.match(full, /By provider/);
  assert.match(full, /Unpriced calls/);
  assert.match(full, /ids opencode, opencode-go/);
  assert.match(full, /deepseek-v4\.1-flash/);
  assert.match(full, /glm-5\.3-flash/);
  assert.match(full, /z\.ai GLM · 1/, "the day row names each provider's share");
  assert.match(full, /Providers 5/);
  assert.match(full, /10 connected/);
  assert.match(full, /fixture coverage: recorded calls only/);
  assert.match(full, /Coding sessions: 3 turns read from the OpenCode store/);
  assert.match(env.get("model-lab-tracker-status").textContent, /Updated/);
});

test("opening the panel during a read that could not ask the CLIs follows it with one that can", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const env = environment({ tracker: async () => { calls += 1; if (calls === 1) await gate; return localReport(); } });
  env.window.MefiUsageTracker.open();
  await flush();
  env.get("cmd-usage-toggle").click();
  release();
  for (let round = 0; round < 4; round += 1) await flush();
  assert.deepEqual(env.probes, [{ probe: false }, { probe: true }], "entering Command's plain read is followed by a probing one, not reused");
});

test("only a view someone can see counts as looking; a stale reading's passed reset reads as reset", async () => {
  const env = environment({ timers: true, accounts: async () => accountsReport([accounts.go()], ["claude"]) });
  const panel = env.get("model-lab-tracker");
  panel.hidden = false;
  panel.checkVisibility = () => false;
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.deepEqual(env.probes.at(-1), { probe: false }, "a Model Lab tab left unhidden behind another page is not someone looking");
  assert.equal(env.scheduled.length, 0, "and nothing follows up for it");
  panel.checkVisibility = () => true;
  await env.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  assert.deepEqual(env.probes.at(-1), { probe: true });
  const stale = accounts.claude();
  stale.limits.windows[0] = { ...stale.limits.windows[0], percent: 100, severity: "critical", resetsAt: inHours(-1) };
  stale.limits.blocked = true;
  const later = environment({ accounts: async () => accountsReport([stale]) });
  await later.window.MefiUsageTracker.refresh({ force: true });
  await flush();
  const card = cardOf(later.get("cmd-usage-body"), "Claude Code CLI");
  assert.match(card.textContent, /5h\s+0%\s+reset/, "a window whose reset has passed since the reading has emptied");
  assert.doesNotMatch(card.textContent, /Limit reached/, "and the block it caused has lifted");
  assert.equal(card.attrs["data-tone"], undefined);
});

test("follow-ups keep asking while a probe is out, slower after the first minute, and stop at their limit", async () => {
  const env = environment({ timers: true, accounts: async () => accountsReport([accounts.go()], ["claude"]) });
  env.get("cmd-usage-toggle").click();
  await flush();
  const delays = [];
  for (let round = 0; round < 45 && env.scheduled.length > delays.length; round += 1) {
    const next = env.scheduled[delays.length];
    delays.push(next.ms);
    next.fn();
    await flush();
  }
  assert.equal(delays.length, 40, "forty follow-ups at most");
  assert.deepEqual([...new Set(delays.slice(0, 20))], [3000]);
  assert.deepEqual([...new Set(delays.slice(20))], [9000]);
});

test("Escape from a field or a dialog over the panel is left to them", () => {
  const env = environment();
  env.window.MefiUsageTracker.setOpen(true);
  let stopped = false;
  const field = { closest: (selector) => (selector.includes("input") ? { closest: () => null } : null) };
  env.emit("keydown", { key: "Escape", target: field, preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(env.get("cmd-usage-pop").hidden, false, "the palette's own Escape closes the palette, not the breakdown under it");
  assert.equal(stopped, false);
  assert.match(source, /new MutationObserver\(\(\) => \{\r?\n\s+if \(state\.open && !document\.body\.classList\.contains\("command-active"\)\) setOpen\(false\);/, "leaving Command by any route closes the breakdown");
});

test("the Legend and the Usage breakdown share the corner and never stand open together", async () => {
  const env = environment();
  const legend = env.get("cmd-legend-list");
  const pop = env.get("cmd-usage-pop");
  env.get("idle-legend-toggle").click();
  assert.equal(legend.hidden, false, "the Legend opens");
  env.get("cmd-usage-toggle").click();
  assert.equal(pop.hidden, false, "opening Usage keeps Usage open");
  assert.equal(legend.hidden, true, "and closes the Legend through its own toggle");
  env.get("idle-legend-toggle").click();
  assert.equal(legend.hidden, false);
  assert.equal(pop.hidden, true, "opening the Legend closes Usage");
});

test("the Usage pill opens the breakdown above it, Escape and the pill close it, and a project change forces a fresh reading", async () => {
  let reads = 0;
  const env = environment({ tracker: async () => { reads += 1; return localReport(); } });
  assert.equal(env.get("cmd-usage-pop").hidden, true, "the breakdown starts closed");
  assert.equal(env.get("cmd-usage-toggle").attrs["aria-expanded"], "false");
  await env.window.MefiUsageTracker.refresh({ force: true, probe: true });
  await flush();
  assert.equal(reads, 1);
  env.get("cmd-usage-toggle").click();
  assert.equal(env.get("cmd-usage-pop").hidden, false);
  assert.equal(env.get("cmd-usage-body").hidden, false);
  assert.equal(env.get("cmd-usage-toggle").attrs["aria-expanded"], "true");
  await flush();
  assert.equal(reads, 1, "opening within the freshness window reuses the reading it just made");
  env.get("cmd-usage-toggle").click();
  assert.equal(env.get("cmd-usage-pop").hidden, true);
  assert.equal(env.get("cmd-usage-body").hidden, true);
  assert.equal(env.get("cmd-usage-toggle").attrs["aria-expanded"], "false");
  env.window.MefiUsageTracker.setOpen(true);
  let stopped = false;
  env.emit("keydown", { key: "Escape", preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(env.get("cmd-usage-pop").hidden, true, "Escape closes the breakdown");
  assert.equal(stopped, true, "and the app's own Escape (leaving Command) never sees that key");
  assert.equal(env.get("cmd-usage-toggle").focused, true, "focus returns to the pill");
  let left = false;
  env.emit("keydown", { key: "Escape", preventDefault() {}, stopPropagation() { left = true; } });
  assert.equal(left, false, "with the breakdown closed, Escape belongs to the app again");
  env.window.MefiUsageTracker.setOpen(true);
  env.get("cmd-usage-open").click();
  assert.equal(env.get("cmd-usage-pop").hidden, true, "Details closes the breakdown before leaving Command");
  const before = reads;
  env.emit("mefi:project-changed");
  await flush();
  assert.equal(reads, before + 1);
});
