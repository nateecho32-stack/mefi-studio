// Usage tracker: recorded totals from both ledgers (the calls Studio made and
// the coding-session turns OpenCode's store holds) beside every connected
// provider's own account reading, kept visibly separate. Account reads use
// the saved keys through the host and never touch prompts or results.
(function () {
  "use strict";
  const REFRESH_MS = 5 * 60 * 1000;
  const STALE_MS = 5000;
  const WINDOW_LABELS = [["rolling", "5-hour window", "5h"], ["weekly", "Weekly window", "Wk"], ["monthly", "Monthly window", "Mo"]];
  const state = { initialized: false, collapsed: false, read: 0, at: 0, report: null, pending: null };
  const $ = (id) => document.getElementById(id);
  const api = () => window.mefiStudio;
  const rows = (value) => Array.isArray(value) ? value : [];
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const number = (value, digits = 0) => finite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "Unknown";
  const money = (value, digits = 2) => finite(value) ? `$${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: value > 0 && value < 0.01 ? 4 : digits })}` : "Unknown";
  const percent = (value) => finite(value) ? `${number(value, 1)}%` : "Unknown";
  const compact = (value) => !finite(value) ? "?" : value >= 1e6 ? `${(value / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })}M` : value >= 1e4 ? `${Math.round(value / 1e3)}k` : number(value);
  const calls = (value) => `${number(value)} ${value === 1 ? "call" : "calls"}`;
  const when = (value) => {
    if (value == null || value === "") return "unavailable";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "unavailable";
  };
  const clock = (value) => {
    if (value == null || value === "") return "unknown time";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "unknown time";
  };
  const readStore = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const writeStore = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }
  function emptyBox(title, detail) {
    const box = element("div", "lab-empty");
    box.append(element("h3", "", title), element("p", "", detail));
    return box;
  }
  function empty(target, title, detail) {
    target.replaceChildren(emptyBox(title, detail));
  }
  function table(headers, entries, rowOf) {
    const node = element("table", "lab-table");
    const head = element("thead");
    const headRow = element("tr");
    for (const title of headers) { const th = element("th", "", title); th.scope = "col"; headRow.append(th); }
    head.append(headRow);
    const body = element("tbody");
    entries.forEach((entry) => {
      const tr = element("tr");
      for (const value of rowOf(entry)) { const cell = element("td"); cell.append(typeof value === "object" ? value : element("span", "", String(value))); tr.append(cell); }
      body.append(tr);
    });
    node.append(head, body);
    return node;
  }
  function twoLine(main, detail) {
    const cell = element("div", "lab-model-name tracker-cell");
    cell.append(element("strong", "", main), element("span", "muted", detail));
    return cell;
  }
  function modelName(label, model) {
    return twoLine(model || "Unknown model", label || "Unknown provider");
  }
  function chips(entries) {
    const wrap = element("div", "tracker-chips");
    for (const text of entries) wrap.append(element("span", "tracker-chip", text));
    return wrap;
  }
  function section(title, note, content) {
    const node = element("section", "tracker-section");
    node.append(element("h3", "", title));
    if (note) node.append(element("p", "muted", note));
    node.append(content);
    return node;
  }
  function costText(record) {
    return record?.knownRecords > 0 ? money(record.known) : "Unknown";
  }
  function localCost(record) {
    return record && record.knownRecords > 0 ? money(record.spentUsd) : "Unknown";
  }
  const origins = (record) => `Studio ${number(record?.origins?.studio)} · coding ${number(record?.origins?.["opencode-cli"])}`;

  function windowBar(label, record, { resets = false } = {}) {
    const wrap = element("div", "tracker-window");
    wrap.append(element("span", "tracker-window-label", label));
    const bar = element("span", "tracker-bar");
    const fill = element("i");
    if (record && finite(record.percent)) {
      fill.style.width = `${Math.max(0, Math.min(100, record.percent))}%`;
      if (record.percent >= 100 || record.status === "rate-limited") fill.className = "warn";
    }
    bar.append(fill);
    wrap.append(bar);
    wrap.append(element("b", "tracker-window-value", record && finite(record.percent) ? percent(record.percent) : "—"));
    if (resets && record?.resetsAt) wrap.title = `Resets ${when(record.resetsAt)}`;
    return wrap;
  }

  // ---- connected accounts ------------------------------------------------
  // One entry per provider the host found connected (a saved key or an
  // installed CLI). The OpenCode Go windows also arrive on the older
  // opencodeCredits bridge, which stands in when the accounts read is absent.
  function accountsOf(report) {
    const list = rows(report.accounts?.accounts);
    if (list.some((account) => account.provider === "opencode-go") || !report.credits) return list;
    const credits = report.credits;
    return [{ provider: "opencode-go", label: "OpenCode Go", kind: "plan", read: "windows", connected: true, ok: credits.ok === true, fetchedAt: credits.fetchedAt ?? null, usage: credits.usage, error: credits.error, code: credits.code }, ...list];
  }
  function providerToday(local, provider) {
    const row = rows(local?.providers).find((entry) => entry.provider === provider);
    if (!row) return null;
    const today = row.today ?? { calls: 0, usage: {} };
    return `Recorded today · ${calls(today.calls)} · ${compact(today.usage?.totalTokens?.known)} tokens · ${costText(today.usage?.costUsd)}`;
  }
  function accountCard(account, local) {
    const card = element("div", "lab-usage-card tracker-live-card tracker-account");
    card.append(element("span", "", `${account.label}${account.read === "none" ? "" : " · live"}`));
    if (account.read === "none") {
      card.append(element("strong", "", "No account API"));
      card.append(element("small", "muted", account.note || "This provider offers no account reading."));
    } else if (!account.ok) {
      card.append(element("strong", "", "Unavailable"));
      card.append(element("small", "muted", account.error || "No account reading yet."));
    } else if (account.read === "windows") {
      const usage = account.usage ?? {};
      card.append(element("strong", "", `${percent(usage.rolling?.percent)} of the 5-hour window`));
      const bars = element("div", "tracker-windows tracker-account-windows");
      for (const [key, label] of WINDOW_LABELS) bars.append(windowBar(label, usage[key], { resets: true }));
      card.append(bars);
      const limited = WINDOW_LABELS.filter(([key]) => usage[key]?.status === "rate-limited").map(([, label]) => label);
      card.append(element("small", "muted", `${limited.length ? `Limit reached: ${limited.join(", ")} · ` : ""}${usage.rolling?.resetsAt ? `5-hour window resets ${when(usage.rolling.resetsAt)}` : "Reset time unavailable"}`));
    } else if (account.read === "quota") {
      const quota = account.quota ?? {};
      card.append(element("strong", "", quota.rolling ? `${percent(quota.rolling.percent)} of the 5-hour window` : quota.weekly ? `${percent(quota.weekly.percent)} of the week` : "Quota read"));
      const bars = element("div", "tracker-windows tracker-account-windows");
      if (quota.rolling) bars.append(windowBar("5-hour window", quota.rolling, { resets: true }));
      if (quota.weekly) bars.append(windowBar("Weekly window", quota.weekly, { resets: true }));
      if (quota.tools) bars.append(windowBar("Tool quota", quota.tools));
      card.append(bars);
      card.append(element("small", "muted", `${quota.level ? `${quota.level} plan · ` : ""}${quota.rolling?.resetsAt ? `5-hour window resets ${when(quota.rolling.resetsAt)}` : "Plan quota, not a bill"}`));
    } else if (account.read === "key") {
      const key = account.key ?? {};
      card.append(element("strong", "", `${money(key.usage)} spent`));
      const detail = [];
      if (account.credits) detail.push(`${money(account.credits.remaining)} of ${money(account.credits.totalCredits)} credits left`);
      if (finite(key.limit)) detail.push(`${money(key.limitRemaining)} left of the ${money(key.limit)} key limit${key.limitReset ? ` (${key.limitReset})` : ""}`);
      detail.push(`today ${money(key.usageDaily)} · week ${money(key.usageWeekly)} · month ${money(key.usageMonthly)}`);
      if (key.isFreeTier) detail.push("free tier");
      if (finite(key.percent)) card.append(windowBar("Key limit", key));
      card.append(element("small", "muted", detail.join(" · ")));
    } else if (account.read === "credits") {
      const credits = account.credits ?? {};
      card.append(element("strong", "", `${money(credits.balance)} left`));
      card.append(element("small", "muted", finite(credits.totalUsed) ? `${money(credits.totalUsed)} used to date` : "Balance read from the gateway"));
    } else {
      card.append(element("strong", "", "Read"));
    }
    const today = providerToday(local, account.provider);
    if (today) card.append(element("small", "muted", today));
    return card;
  }
  function accountsSection(report) {
    const local = report.local?.ok === false ? null : report.local;
    const accounts = accountsOf(report);
    if (!accounts.length) {
      return emptyBox("No connected providers", report.accounts?.ok === false ? report.accounts.error || "The account readings could not be made." : "Save a provider key or install a coding CLI in Settings; each connected provider appears here with its own account reading.");
    }
    const grid = element("div", "lab-usage-grid tracker-accounts");
    for (const account of accounts) grid.append(accountCard(account, local));
    return grid;
  }

  function localSection(credits) {
    const note = "Counts the OpenCode Go calls in both ledgers (the assistant's Go route and every coding turn OpenCode ran on Go) with the costs the provider reported. Calls without reported cost stay unknown, so this estimate can only be lower than the account's real usage.";
    const stack = element("div", "tracker-stack");
    const windows = element("div", "tracker-windows");
    for (const [key, , short] of WINDOW_LABELS) windows.append(windowBar(short, credits?.[key]));
    stack.append(windows);
    const detail = element("div", "tracker-detail");
    for (const [key, , short] of WINDOW_LABELS) {
      const record = credits?.[key];
      if (!record) continue;
      detail.append(element("p", "muted", `${short === "Wk" ? "Week" : short === "Mo" ? "Month" : short}: ${localCost(record)} of ${money(record.limitUsd, 2)} · ${number(record.calls)} calls · ${number(record.unknownRecords)} without reported cost`));
    }
    stack.append(detail);
    return section("Recorded OpenCode Go spend (local estimate)", note, stack);
  }

  function renderSummary(local, report) {
    const grid = element("div", "lab-usage-grid");
    const connected = accountsOf(report).length;
    const stats = [
      ["Calls recorded", number(local.totals.calls), origins(local.totals)],
      ["Calls today", number(local.today.calls), `${compact(local.today.usage?.totalTokens?.known)} tokens · ${costText(local.today.usage?.costUsd)}`],
      ["Recorded cost", costText(local.totals.usage.costUsd), `${number(local.totals.usage.costUsd?.unknownRecords)} calls without a reported cost`],
      ["Providers", number(rows(local.providers).length), `${number(connected)} connected · lifetime ${number(local.lifetime?.calls)} Studio calls`],
    ];
    for (const [label, value, detail] of stats) {
      const card = element("div", "lab-usage-card");
      card.append(element("span", "", label), element("strong", "", value), element("small", "muted", detail));
      grid.append(card);
    }
    return grid;
  }
  function providersTable(local) {
    if (!rows(local.providers).length) return emptyBox("No providers observed", "Provider totals appear after the first recorded call or coding turn.");
    return table(["Provider", "Calls", "Errors", "Input tokens", "Output tokens", "Cache read", "Reported cost", "Unpriced calls"], local.providers, (row) => [
      twoLine(row.label || row.provider, `${row.kind || "unknown"}${row.providerIds?.length ? ` · ids ${row.providerIds.join(", ")}` : ""}`),
      twoLine(number(row.calls), origins(row)),
      number(row.errors), number(row.usage.inputTokens.known), number(row.usage.outputTokens.known), number(row.usage.cacheReadTokens?.known),
      costText(row.usage.costUsd), number(row.usage.costUsd.unknownRecords),
    ]);
  }
  function daysTable(local) {
    if (!rows(local.days).length) return emptyBox("No recorded calls yet", "Days appear here as Studio records calls and OpenCode records coding turns. Unknown values stay unknown.");
    return table(["Day", "Calls", "Errors", "Input tokens", "Output tokens", "Reported cost", "Providers"], local.days, (day) => [
      day.day, twoLine(number(day.calls), origins(day)), number(day.errors), number(day.usage.inputTokens.known), number(day.usage.outputTokens.known), costText(day.usage.costUsd),
      chips(rows(day.providers).map((row) => `${row.label || row.provider} · ${number(row.calls)}${row.usage?.costUsd?.knownRecords ? ` · ${money(row.usage.costUsd.known)}` : ""}`)),
    ]);
  }
  function modelsTable(local) {
    if (!rows(local.models).length) return emptyBox("No models observed", "Provider and model totals appear after the first recorded call.");
    return table(["Model", "Calls", "Errors", "Total tokens", "Reported cost", "Unpriced calls"], local.models, (model) => [
      modelName(model.label || model.provider, model.model), number(model.calls), number(model.errors), number(model.usage.totalTokens.known), costText(model.usage.costUsd), number(model.usage.costUsd.unknownRecords),
    ]);
  }
  function storeLine(local) {
    const store = local.store;
    if (!store) return "";
    if (store.ok === false) return ` Coding sessions: ${store.error || "the OpenCode store could not be read."}`;
    return ` Coding sessions: ${number(store.rows)} turns read from the OpenCode store${store.since ? ` since ${when(store.since)}` : ""}.`;
  }

  function renderFull(target, report) {
    const local = report.local ?? {};
    if (local.ok === false) { empty(target, "Usage could not be read", local.error || "The local ledger could not be read."); return; }
    target.replaceChildren();
    target.append(renderSummary(local, report));
    target.append(section("Connected accounts (live)", "Each provider's own reading over its saved key, or a plain statement when it offers none. These are the providers' numbers, not the local estimate.", accountsSection(report)));
    target.append(localSection(local.credits));
    target.append(section("By provider", "Both ledgers: the calls Studio made and the coding turns OpenCode ran for this project. A plan or subscription reports no per-call cost, so its calls are unpriced rather than free.", providersTable(local)));
    target.append(section("Recorded usage by day", "Days use this machine's calendar. Cost is shown only when the provider reported it.", daysTable(local)));
    target.append(section("By model", "Sums across both ledgers for the active project.", modelsTable(local)));
    const retired = local.retention?.dropped ? ` ${number(local.retention.dropped)} older Studio details retired; lifetime totals retained.` : "";
    target.append(element("p", "muted tracker-footnote", `${local.coverage || "Only recorded calls are included."}${storeLine(local)}${retired}`));
  }

  function accountLine(account, local) {
    const row = rows(local?.providers).find((entry) => entry.provider === account.provider);
    const today = row ? `today ${calls(row.today?.calls)} · ${compact(row.today?.usage?.totalTokens?.known)} tokens` : "no calls today";
    if (account.read !== "none" && !account.ok) return element("p", "tracker-line tracker-line-warn", `${account.label} · ${account.error || "account read unavailable"}`);
    if (account.read === "quota") {
      const quota = account.quota ?? {};
      return element("p", "tracker-line tracker-line-account", `${account.label} · 5h ${quota.rolling ? percent(quota.rolling.percent) : "—"} · wk ${quota.weekly ? percent(quota.weekly.percent) : "—"} · ${today}`);
    }
    if (account.read === "key") {
      const key = account.key ?? {};
      const left = account.credits ? `${money(account.credits.remaining)} left` : finite(key.limit) ? `${money(key.limitRemaining)} left of ${money(key.limit)}` : "no key limit";
      return element("p", "tracker-line tracker-line-account", `${account.label} · ${money(key.usage)} spent · ${left}`);
    }
    if (account.read === "credits") return element("p", "tracker-line tracker-line-account", `${account.label} · ${money(account.credits?.balance)} left · ${money(account.credits?.totalUsed)} used`);
    return element("p", "tracker-line tracker-line-account", `${account.label} · ${today}${row?.today?.usage?.costUsd?.knownRecords ? ` · ${money(row.today.usage.costUsd.known)}` : ""}`);
  }

  function renderCompact(target, report) {
    target.replaceChildren();
    const credits = report.credits ?? {};
    const local = report.local?.ok === false ? null : report.local;
    const accounts = accountsOf(report);
    const go = accounts.find((account) => account.provider === "opencode-go");
    const goUsage = go?.ok ? go.usage : credits.ok ? credits.usage : null;
    const windows = element("div", "tracker-windows");
    for (const [key, , short] of WINDOW_LABELS) windows.append(windowBar(short, goUsage?.[key] ?? null));
    target.append(windows);
    if (!goUsage) target.append(element("p", "tracker-line tracker-line-warn", go?.error || credits.error || "Live account usage is unavailable."));
    for (const account of accounts) if (account.provider !== "opencode-go") target.append(accountLine(account, local));
    if (report.accounts?.ok === false && !accounts.length) target.append(element("p", "tracker-line tracker-line-warn", report.accounts.error || "Account readings are unavailable."));
    if (report.local?.ok === false) target.append(element("p", "tracker-line tracker-line-warn", report.local.error || "Local usage could not be read."));
    if (local) {
      const today = local.today.usage;
      target.append(element("p", "tracker-line", `Recorded today · ${calls(local.today.calls)} · ${number(today.totalTokens.known)} tokens · ${costText(today.costUsd)}`));
      const estimate = local.credits;
      if (estimate) {
        target.append(element("p", "tracker-line", `Local estimate · 5h ${localCost(estimate.rolling)}/${money(estimate.rolling.limitUsd, 0)} · wk ${localCost(estimate.weekly)}/${money(estimate.weekly.limitUsd, 0)} · mo ${localCost(estimate.monthly)}/${money(estimate.monthly.limitUsd, 0)}`));
      }
      if (local.store?.ok === false) target.append(element("p", "tracker-line tracker-line-warn", "Coding sessions unavailable: the OpenCode store could not be read."));
    }
  }

  function statusOf(report) {
    if (!report) return "Waiting for a reading…";
    const stamp = report.accounts?.at ?? report.credits?.fetchedAt ?? report.at;
    const failed = accountsOf(report).filter((account) => account.read !== "none" && !account.ok).length;
    const note = report.credits?.ok === false ? " · live account read unavailable" : failed ? ` · ${failed} account read${failed === 1 ? "" : "s"} unavailable` : "";
    return `Updated ${clock(stamp)}${note}`;
  }
  function render() {
    const report = state.report;
    if (!report) return;
    // The workspace's usage tile listens; it never reads on its own.
    if (typeof CustomEvent === "function") window.dispatchEvent?.(new CustomEvent("mefi:usage-report", { detail: report }));
    const full = $("model-lab-tracker-body");
    if (full) renderFull(full, report);
    const compactBody = $("cmd-usage-body");
    if (compactBody) renderCompact(compactBody, report);
    const fullStatus = $("model-lab-tracker-status");
    if (fullStatus) fullStatus.textContent = statusOf(report);
    const compactState = $("cmd-usage-state");
    if (compactState) compactState.textContent = statusOf(report);
  }
  function setStatus(text) {
    const fullStatus = $("model-lab-tracker-status");
    if (fullStatus) fullStatus.textContent = text;
    const compactState = $("cmd-usage-state");
    if (compactState) compactState.textContent = text;
  }

  function refresh({ force = false } = {}) {
    if (!force && state.report && Date.now() - state.at < STALE_MS) return Promise.resolve(state.report);
    if (state.pending) return state.pending;
    const token = ++state.read;
    setStatus("Reading usage…");
    state.pending = (async () => {
      const bridge = api();
      if (!bridge?.usageTracker) throw new Error("Usage tracking is available in the Studio desktop app.");
      const [local, credits, accounts] = await Promise.all([
        bridge.usageTracker(),
        bridge.opencodeCredits ? bridge.opencodeCredits() : Promise.resolve({ ok: false, error: "Live account usage is unavailable in this build." }),
        bridge.usageAccounts ? bridge.usageAccounts().catch((error) => ({ ok: false, error: error?.message || "Account readings are unavailable.", accounts: [] })) : Promise.resolve({ ok: false, error: "Account readings are unavailable in this build.", accounts: [] }),
      ]);
      if (token !== state.read) return state.report;
      state.at = Date.now();
      state.report = {
        local: local ?? { ok: false, error: "No usage report." },
        credits: credits ?? { ok: false, error: "No account reading." },
        accounts: accounts ?? { ok: false, error: "No account readings.", accounts: [] },
        at: state.at,
      };
      render();
      return state.report;
    })().catch((error) => {
      if (token === state.read) setStatus(error.message || "Usage could not be read.");
      return state.report;
    }).finally(() => { state.pending = null; });
    return state.pending;
  }

  function tick() {
    if (!document.body?.classList?.contains?.("command-active")) return;
    if (Date.now() - state.at >= REFRESH_MS) refresh();
  }
  function setCompactCollapsed(collapsed, save = true) {
    state.collapsed = Boolean(collapsed);
    const body = $("cmd-usage-body");
    if (body) body.hidden = state.collapsed;
    const toggle = $("cmd-usage-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(!state.collapsed));
      toggle.title = state.collapsed ? "Expand usage" : "Collapse usage";
    }
    if (save) writeStore("mefiStudio.cmdUsageCollapsed", state.collapsed ? "1" : "0");
  }
  function openTab() {
    // Through the registry so the "Back to Command" return state is recorded.
    if (window.MefiNav?.go) window.MefiNav.go("graph");
    else { window.MefiIdle?.exit?.(); window.MefiBooklet?.showTab?.("graph"); }
    window.MefiModelLab?.show?.("tracker");
  }
  function open() {
    if (state.report && Date.now() - state.at < REFRESH_MS) return;
    refresh();
  }
  function init() {
    if (state.initialized) return;
    state.initialized = true;
    $("model-lab-tracker-refresh")?.addEventListener("click", () => refresh({ force: true }));
    $("cmd-usage-refresh")?.addEventListener("click", () => refresh({ force: true }));
    $("cmd-usage-open")?.addEventListener("click", openTab);
    $("cmd-usage-toggle")?.addEventListener("click", () => setCompactCollapsed(!state.collapsed));
    setCompactCollapsed(readStore("mefiStudio.cmdUsageCollapsed") === "1", false);
    window.addEventListener("mefi:project-changed", () => {
      state.read += 1;
      state.at = 0;
      state.report = null;
      refresh({ force: true });
    });
  }

  window.MefiUsageTracker = { refresh, tick, open, openTab, init, report: () => state.report };
  init();
})();
