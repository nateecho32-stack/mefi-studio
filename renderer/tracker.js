// Usage tracker: recorded local totals and OpenCode Go account windows, kept
// visibly separate. Local numbers come from the model ledger; the account read
// uses the saved key through the host and never touches prompts or results.
(function () {
  "use strict";
  const REFRESH_MS = 5 * 60 * 1000;
  const STALE_MS = 5000;
  const state = { initialized: false, collapsed: false, read: 0, at: 0, report: null, pending: null };
  const $ = (id) => document.getElementById(id);
  const api = () => window.mefiStudio;
  const rows = (value) => Array.isArray(value) ? value : [];
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const number = (value, digits = 0) => finite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "Unknown";
  const money = (value, digits = 2) => finite(value) ? `$${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: value > 0 && value < 0.01 ? 4 : digits })}` : "Unknown";
  const percent = (value) => finite(value) ? `${number(value, 1)}%` : "Unknown";
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
  function modelName(provider, model) {
    const cell = element("div", "lab-model-name");
    cell.append(element("strong", "", model || "Unknown model"), element("span", "muted", provider || "Unknown provider"));
    return cell;
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

  function windowBar(label, record) {
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
    return wrap;
  }

  function liveSection(credits) {
    const target = element("div", "lab-usage-grid");
    for (const [key, label] of [["rolling", "5-hour window"], ["weekly", "Weekly window"], ["monthly", "Monthly window"]]) {
      const record = credits?.ok ? credits.usage?.[key] : null;
      const card = element("div", "lab-usage-card tracker-live-card");
      card.append(element("span", "", `OpenCode Go · ${label}`));
      card.append(element("strong", "", record ? percent(record.percent) : "Unavailable"));
      const detail = record
        ? `${record.status === "rate-limited" ? "Limit reached · " : ""}${record.resetsAt ? `Resets ${when(record.resetsAt)}` : "Reset time unavailable"}`
        : credits?.error || "No account reading yet.";
      card.append(element("small", "muted", detail));
      target.append(card);
    }
    return target;
  }

  function localSection(credits) {
    const note = "Counts only calls Studio recorded for this project, with the costs the provider reported. Calls without reported cost stay unknown, so this estimate can only be lower than the account's real usage.";
    const stack = element("div", "tracker-stack");
    const windows = element("div", "tracker-windows");
    for (const [key, label] of [["rolling", "5h"], ["weekly", "Week"], ["monthly", "Month"]]) windows.append(windowBar(label, credits?.[key]));
    stack.append(windows);
    const detail = element("div", "tracker-detail");
    for (const [key, label] of [["rolling", "5h"], ["weekly", "Week"], ["monthly", "Month"]]) {
      const record = credits?.[key];
      if (!record) continue;
      detail.append(element("p", "muted", `${label}: ${localCost(record)} of ${money(record.limitUsd, 2)} · ${number(record.calls)} calls · ${number(record.unknownRecords)} without reported cost`));
    }
    stack.append(detail);
    return section("Recorded OpenCode Go spend (local estimate)", note, stack);
  }

  function renderSummary(local) {
    const grid = element("div", "lab-usage-grid");
    const stats = [
      ["Calls recorded", number(local.totals.calls)],
      ["Calls today", number(local.today.calls)],
      ["Recorded cost", costText(local.totals.usage.costUsd)],
      ["Lifetime calls", number(local.lifetime?.calls)],
    ];
    for (const [label, value] of stats) { const card = element("div", "lab-usage-card"); card.append(element("span", "", label), element("strong", "", value)); grid.append(card); }
    return grid;
  }
  function daysTable(local) {
    if (!rows(local.days).length) return emptyBox("No recorded calls yet", "Days appear here as Studio records measured calls. Unknown values stay unknown.");
    return table(["Day", "Calls", "Errors", "Input tokens", "Output tokens", "Recorded cost"], local.days, (day) => [
      day.day, number(day.calls), number(day.errors), number(day.usage.inputTokens.known), number(day.usage.outputTokens.known), costText(day.usage.costUsd),
    ]);
  }
  function modelsTable(local) {
    if (!rows(local.models).length) return emptyBox("No models observed", "Provider and model totals appear after the first recorded call.");
    return table(["Model", "Calls", "Errors", "Total tokens", "Recorded cost", "Without cost"], local.models, (model) => [
      modelName(model.provider, model.model), number(model.calls), number(model.errors), number(model.usage.totalTokens.known), costText(model.usage.costUsd), number(model.usage.costUsd.unknownRecords),
    ]);
  }

  function renderFull(target, report) {
    const local = report.local ?? {};
    if (local.ok === false) { empty(target, "Usage could not be read", local.error || "The local ledger could not be read."); return; }
    target.replaceChildren();
    target.append(renderSummary(local));
    target.append(section("OpenCode Go account (live)", "Read from opencode.ai with the saved key. This is the provider's own window; it is not the local estimate.", liveSection(report.credits)));
    target.append(localSection(local.credits));
    target.append(section("Recorded usage by day", "Days use this machine's calendar. Cost is shown only when the provider reported it.", daysTable(local)));
    target.append(section("By provider and model", "Sums from the local ledger for the active project.", modelsTable(local)));
    const retired = local.retention?.dropped ? ` ${number(local.retention.dropped)} older details retired; lifetime totals retained.` : "";
    target.append(element("p", "muted tracker-footnote", `${local.coverage || "Only calls recorded by Studio are included."}${retired}`));
  }

  function renderCompact(target, report) {
    target.replaceChildren();
    const credits = report.credits ?? {};
    const local = report.local?.ok === false ? null : report.local;
    const windows = element("div", "tracker-windows");
    for (const [key, label] of [["rolling", "5h"], ["weekly", "Wk"], ["monthly", "Mo"]]) windows.append(windowBar(label, credits.ok ? credits.usage?.[key] : null));
    target.append(windows);
    if (!credits.ok) target.append(element("p", "tracker-line tracker-line-warn", credits.error || "Live account usage is unavailable."));
    if (report.local?.ok === false) target.append(element("p", "tracker-line tracker-line-warn", report.local.error || "Local usage could not be read."));
    if (local) {
      const today = local.today.usage;
      target.append(element("p", "tracker-line", `Recorded today · ${number(local.today.calls)} calls · ${number(today.totalTokens.known)} tokens · ${costText(today.costUsd)}`));
      const estimate = local.credits;
      if (estimate) {
        target.append(element("p", "tracker-line", `Local estimate · 5h ${localCost(estimate.rolling)}/${money(estimate.rolling.limitUsd, 0)} · wk ${localCost(estimate.weekly)}/${money(estimate.weekly.limitUsd, 0)} · mo ${localCost(estimate.monthly)}/${money(estimate.monthly.limitUsd, 0)}`));
      }
    }
  }

  function statusOf(report) {
    if (!report) return "Waiting for a reading…";
    const stamp = report.credits?.fetchedAt ?? report.at;
    return `Updated ${clock(stamp)}${report.credits?.ok === false ? " · live account read unavailable" : ""}`;
  }
  function render() {
    const report = state.report;
    if (!report) return;
    // The workspace's usage tile listens; it never reads on its own.
    if (typeof CustomEvent === "function") window.dispatchEvent?.(new CustomEvent("mefi:usage-report", { detail: report }));
    const full = $("model-lab-tracker-body");
    if (full) renderFull(full, report);
    const compact = $("cmd-usage-body");
    if (compact) renderCompact(compact, report);
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
      const [local, credits] = await Promise.all([
        bridge.usageTracker(),
        bridge.opencodeCredits ? bridge.opencodeCredits() : Promise.resolve({ ok: false, error: "Live account usage is unavailable in this build." }),
      ]);
      if (token !== state.read) return state.report;
      state.at = Date.now();
      state.report = { local: local ?? { ok: false, error: "No usage report." }, credits: credits ?? { ok: false, error: "No account reading." }, at: state.at };
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
