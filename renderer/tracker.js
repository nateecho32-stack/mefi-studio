// Usage tracker: recorded totals from both ledgers (the calls Studio made and
// the coding-session turns OpenCode's store holds) beside every connected
// provider's own account reading, kept visibly separate. Account reads use
// the saved keys, or the coding CLIs' own logins, through the host and never
// touch prompts or results.
(function () {
  "use strict";
  const REFRESH_MS = 5 * 60 * 1000;
  const STALE_MS = 5000;
  // A CLI plan probe runs in the background for a few seconds; while one is
  // in flight and someone is looking, the panel asks again this often.
  const FOLLOW_MS = 3000;
  const FOLLOW_QUICK = 20;
  const FOLLOW_LIMIT = 40;
  // A live reading older than this no longer speaks for the pill.
  const LEAD_FRESH_MS = 30 * 60 * 1000;
  const WINDOW_LABELS = [["rolling", "5-hour window", "5h"], ["weekly", "Weekly window", "Wk"], ["monthly", "Monthly window", "Mo"]];
  // Plans draw in this order whatever order the host read them in, so the
  // cards stay where the eye left them between readings.
  const PLAN_ORDER = ["opencode-go", "zai", "claude", "codex", "grok", "antigravity"];
  const PLAN_READS = new Set(["windows", "quota", "limits"]);
  const BALANCE_READS = new Set(["key", "credits", "local"]);
  // Not failures: a key that was never saved, a CLI plan nobody has looked
  // at yet, and one being read right now.
  const NEUTRAL_CODES = new Set(["no-key", "idle", "pending"]);
  const state = { initialized: false, open: false, closingLegend: false, read: 0, at: 0, looked: 0, report: null, pending: null, pendingLook: false, follow: null, follows: 0 };
  const $ = (id) => document.getElementById(id);
  const api = () => window.mefiStudio;
  const rows = (value) => Array.isArray(value) ? value : [];
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const number = (value, digits = 0) => finite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "Unknown";
  const money = (value, digits = 2) => {
    if (!finite(value)) return "Unknown";
    const text = `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: value !== 0 && Math.abs(value) < 0.01 ? 4 : digits })}`;
    return value < 0 ? `−${text}` : text;
  };
  const percent = (value) => finite(value) ? `${number(value, 1)}%` : "Unknown";
  const compact = (value) => !finite(value) ? "?" : value >= 1e6 ? `${(value / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })}M` : value >= 1e4 ? `${Math.round(value / 1e3)}k` : number(value);
  const calls = (value) => `${number(value)} ${value === 1 ? "call" : "calls"}`;
  const titled = (value) => {
    const text = String(value ?? "").trim();
    return text && text === text.toLowerCase() ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  };
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
  // A reset moment for the compact panel: the time when it is within a day,
  // the date otherwise.
  const soon = (value) => {
    if (value == null || value === "") return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return Math.abs(date.getTime() - Date.now()) < 86400000 ? clock(date) : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  // A window's reset worth printing: not one already past, and not an empty
  // window's (an idle rolling window reports a reset that moves on every
  // read, because it only starts counting at the next call).
  const resetOf = (window) => {
    if (!window || window.reset) return "";
    const at = Date.parse(window.resetsAt ?? "");
    if (!Number.isFinite(at) || at <= Date.now() || !(window.percent > 0)) return "";
    return soon(window.resetsAt);
  };
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
    // A plan or subscription reports no per-call cost: calls without a price
    // are "unpriced", and no calls at all are $0, never "Unknown".
    if (record?.knownRecords > 0) return money(record.known);
    return record?.unknownRecords > 0 ? "unpriced" : money(0);
  }
  function localCost(record) {
    if (record && record.knownRecords > 0) return money(record.spentUsd);
    return record?.unknownRecords > 0 ? "unpriced" : money(0);
  }
  const origins = (record) => `Studio ${number(record?.origins?.studio)} · coding ${number(record?.origins?.["opencode-cli"])}`;

  // One gauge row: label, bar, value and, with `reset`, the reset moment.
  function windowBar(label, record, { resets = false, reset = false } = {}) {
    const wrap = element("div", "tracker-window");
    wrap.append(element("span", "tracker-window-label", label));
    const bar = element("span", "tracker-bar");
    const fill = element("i");
    if (record && finite(record.percent)) {
      fill.style.width = `${Math.max(0, Math.min(100, record.percent))}%`;
      if (hotWindow(record)) fill.className = "warn";
    }
    bar.append(fill);
    wrap.append(bar);
    wrap.append(element("b", "tracker-window-value", record && finite(record.percent) ? percent(record.percent) : "—"));
    if (reset) wrap.append(element("small", "tracker-window-reset", record?.reset ? "reset" : resetOf(record)));
    const detail = [record?.label && record.label !== label ? record.label : "", record?.detail ?? "", record?.reset ? "reset since the reading" : resets && record?.resetsAt ? `resets ${when(record.resetsAt)}` : ""].filter(Boolean);
    if (detail.length) wrap.title = detail.join(" · ");
    return wrap;
  }

  // ---- one view of every account -------------------------------------------
  // Each connected account becomes a plan (windows with bars: OpenCode Go,
  // z.ai, the coding CLIs), a balance (money, or a local server) or a plain
  // "connected" note. Both views draw from these, so they never disagree.
  // The OpenCode Go windows also arrive on the older opencodeCredits bridge,
  // which stands in when the accounts read is absent.
  function accountsOf(report) {
    const list = rows(report.accounts?.accounts);
    if (list.some((account) => account.provider === "opencode-go") || !report.credits) return list;
    const credits = report.credits;
    return [{ provider: "opencode-go", label: "OpenCode Go", kind: "plan", read: "windows", connected: true, ok: credits.ok === true, fetchedAt: credits.fetchedAt ?? null, usage: credits.usage, error: credits.error, code: credits.code }, ...list];
  }
  const failedRead = (account) => account.read !== "none" && !account.ok && !NEUTRAL_CODES.has(account.code);
  const hotWindow = (window) => Boolean(window) && (window.status === "rate-limited" || window.severity === "warning" || window.severity === "critical" || (finite(window.percent) && window.percent >= 90));
  const spanShort = (minutes) => !finite(minutes) ? "Now" : minutes >= 10080 && minutes % 10080 === 0 ? (minutes === 10080 ? "Wk" : `${minutes / 10080}w`) : minutes >= 1440 ? `${Math.round(minutes / 1440)}d` : `${Math.round(minutes / 60)}h`;
  const spanLabel = (minutes) => !finite(minutes) ? "Plan window" : minutes >= 1440 ? `${Math.round(minutes / 1440)}-day window` : `${Math.round(minutes / 60)}-hour window`;
  // A reading is as old as its fetch, and a CLI plan's can be minutes old: a
  // window whose reset has passed since has emptied, whatever the stored
  // percent and severity say.
  function freshWindow(window) {
    const at = Date.parse(window?.resetsAt ?? "");
    if (!window || window.reset || !Number.isFinite(at) || at > Date.now()) return window;
    return { ...window, percent: 0, reset: true, severity: null, status: window.status === "rate-limited" ? "ok" : window.status };
  }
  function planWindows(account) {
    return rawWindows(account).map(freshWindow);
  }
  function rawWindows(account) {
    if (!account.ok) return [];
    if (account.read === "windows") {
      return WINDOW_LABELS.map(([key, label, short]) => {
        const record = account.usage?.[key];
        return record ? { short, label, percent: record.percent, resetsAt: record.resetsAt, status: record.status } : null;
      }).filter(Boolean);
    }
    if (account.read === "quota") {
      const quota = account.quota ?? {};
      const credits = (window) => window?.measure === "credits" && finite(window.used) && finite(window.limit) ? `${number(window.used)} / ${number(window.limit)} credits` : "";
      const list = [];
      if (quota.rolling) list.push({ ...quota.rolling, short: "5h", label: "5-hour window", detail: credits(quota.rolling) });
      if (quota.weekly) list.push({ ...quota.weekly, short: "Wk", label: "Weekly window", detail: credits(quota.weekly) });
      for (const other of rows(quota.other)) list.push({ ...other, short: spanShort(other.minutes), label: spanLabel(other.minutes), detail: credits(other) });
      if (quota.tools) list.push({ ...quota.tools, short: "Tools", label: "Monthly tool calls", detail: finite(quota.tools.used) && finite(quota.tools.limit) ? `${number(quota.tools.used)} / ${number(quota.tools.limit)} calls` : "" });
      return list;
    }
    if (account.read === "limits") return rows(account.limits?.windows).map((window) => ({ ...window }));
    return [];
  }
  // Where a reading came from and how old it is, when that matters.
  function planMeta(account) {
    const parts = [];
    if (account.read === "windows") parts.push("plan windows");
    if (account.read === "quota") {
      const quota = account.quota ?? {};
      parts.push(quota.level ? `${titled(quota.level)}${quota.plan === "credits" ? " · credits" : " plan"}` : quota.plan === "credits" ? "credits" : "plan quota");
    }
    if (account.read === "limits") {
      const limits = account.limits ?? {};
      if (limits.plan) parts.push(titled(limits.plan));
      if (account.ok && limits.source === "rollout") parts.push(`as of ${soon(limits.asOf) || "an earlier session"}`);
      else if (account.ok && finite(limits.asOf) && Date.now() - limits.asOf > 10 * 60 * 1000) parts.push(`as of ${clock(limits.asOf)}`);
    }
    if (account.refreshing && account.ok) parts.push("updating");
    return parts.join(" · ");
  }
  // A block the reading reported lifts once a window it was waiting on has
  // reset and nothing is spent any more.
  const blockedNow = (account, windows) => account.read === "limits" && account.limits?.blocked === true
    && !(windows.some((window) => window.reset) && windows.every((window) => !(window.percent >= 100)));
  function planLine(account, windows) {
    if (account.read === "windows") {
      const limited = windows.filter((window) => window.status === "rate-limited").map((window) => window.short);
      return limited.length ? { text: `Limit reached: ${limited.join(", ")}`, tone: "warn" } : null;
    }
    if (account.read === "quota") {
      const quota = account.quota ?? {};
      if (quota.empty) return { text: "No plan windows for this key (a team plan, or no coding plan).", tone: "idle" };
      const limited = windows.filter((window) => window.percent >= 100).map((window) => window.short);
      if (limited.length) return { text: `Limit reached: ${limited.join(", ")}`, tone: "warn" };
      const lead = windows.find((window) => window.detail);
      return lead ? { text: `${lead.detail} used this ${lead.short === "5h" ? "5-hour window" : lead.label.toLowerCase()}`, tone: "" } : null;
    }
    if (account.read === "limits") {
      const limits = account.limits ?? {};
      if (limits.available === false) return { text: limits.note || "Plan windows are not available for this login.", tone: "idle" };
      const lines = [];
      let tone = "";
      if (blockedNow(account, windows)) {
        const spent = windows.filter((window) => window.percent >= 100).map((window) => Date.parse(window.resetsAt ?? "")).filter(Number.isFinite).sort((a, b) => a - b);
        lines.push(spent.length ? `Limit reached until ${soon(new Date(spent[spent.length - 1]).toISOString())}` : "Limit reached");
        tone = "warn";
      }
      if (limits.source === "rollout") lines.push(account.liveError ? "From the last Codex session · live read unavailable" : "From the last Codex session");
      else if (limits.note) lines.push(limits.note);
      if (limits.credits && finite(limits.credits.prepaidUsd) && limits.credits.prepaidUsd > 0) lines.push(`${money(limits.credits.prepaidUsd)} prepaid`);
      return lines.length ? { text: lines.join(" · "), tone } : null;
    }
    return null;
  }
  function planOf(account) {
    const failed = failedRead(account);
    const reading = !account.ok && (account.code === "idle" || account.code === "pending");
    const windows = planWindows(account);
    let line;
    if (failed) line = { text: account.error || "Account read unavailable.", tone: "warn" };
    else if (reading) line = { text: account.code === "pending" || account.refreshing ? "Reading plan windows…" : "Plan windows are read while this panel is open.", tone: "idle" };
    else line = planLine(account, windows);
    const blocked = blockedNow(account, windows);
    return {
      account, provider: account.provider, label: account.label, meta: planMeta(account), windows, line, failed, reading,
      tone: failed || blocked || windows.some(hotWindow) ? "warn" : reading ? "idle" : "",
    };
  }
  // The money (or the server) behind a metered account, in one line.
  function balanceOf(account) {
    if (failedRead(account)) return { label: account.label, value: account.error || "account read unavailable", tone: "error", title: account.error || "" };
    if (!account.ok) return { label: account.label, value: account.error || "not read yet", tone: "idle", title: "" };
    if (account.read === "key") {
      const key = account.key ?? {};
      const credits = account.credits;
      const parts = [];
      let tone = "";
      let bar = null;
      if (finite(key.limit) && key.limit > 0) {
        parts.push(`${money(key.limitRemaining)} left of ${money(key.limit)}`);
        bar = key;
        if (finite(key.limitRemaining) && key.limitRemaining <= 0) tone = "warn";
      } else if (credits) {
        const balance = finite(credits.balance) ? credits.balance : credits.remaining;
        if (credits.totalCredits === 0) parts.push(key.freeDaily ? `free models · ${number(key.freeDaily.used)}/${number(key.freeDaily.limit)} today` : "free models only");
        else if (finite(balance) && balance < -0.005) { parts.push(`${money(balance)} balance`); tone = "warn"; }
        else if (finite(balance) && balance < 0.005) { parts.push("out of credits"); tone = "warn"; }
        else parts.push(`${money(balance)} credit left`);
      } else if (key.freeDaily) {
        parts.push(`free models · ${number(key.freeDaily.used)}/${number(key.freeDaily.limit)} today`);
      } else {
        parts.push(key.isFreeTier ? "free tier" : "no key limit");
      }
      // Today's spend only when there is some; a free key reads cleaner without "$0.00 today".
      if (finite(key.usageDaily) && key.usageDaily > 0) parts.push(`${money(key.usageDaily)} today`);
      const detail = [`${money(key.usage)} spent on this key to date`, `week ${money(key.usageWeekly)}`, `month ${money(key.usageMonthly)}`];
      if (credits) detail.push(`${money(credits.totalUsage)} of ${money(credits.totalCredits)} account credit used`);
      if (key.limitReset) detail.push(`key limit resets ${key.limitReset}`);
      return { label: account.label, value: parts.join(" · "), tone, bar, title: detail.join(" · ") };
    }
    if (account.read === "credits") {
      const credits = account.credits ?? {};
      return { label: account.label, value: `${money(credits.balance)} left · ${money(credits.totalUsed)} used`, tone: finite(credits.balance) && credits.balance <= 0 ? "warn" : "", title: "The gateway team's balance" };
    }
    if (account.read === "local") {
      const local = account.local ?? {};
      return { label: account.label, value: local.reachable ? `running · ${local.model}` : "no model answering", tone: local.reachable ? "" : "idle", title: local.host ? `Local server at ${local.host}` : "" };
    }
    return null;
  }
  function plansOf(accounts) {
    const rank = (provider) => { const index = PLAN_ORDER.indexOf(provider); return index < 0 ? PLAN_ORDER.length : index; };
    return accounts.filter((account) => PLAN_READS.has(account.read)).slice().sort((a, b) => rank(a.provider) - rank(b.provider)).map(planOf);
  }
  // The account the pill speaks for: the first plan in PLAN_ORDER with a
  // fresh live reading. A Codex rollout or a reading from half an hour ago
  // is shown in its card, but it does not lead.
  function leadPlan(plans) {
    return plans.find((plan) => {
      const { account } = plan;
      if (!account.ok || !plan.windows.length) return false;
      if (account.read !== "limits") return true;
      const limits = account.limits ?? {};
      return limits.source !== "rollout" && finite(limits.asOf) && Date.now() - limits.asOf < LEAD_FRESH_MS;
    }) ?? null;
  }
  // The pill shows the lead plan's first window and the fullest of the rest,
  // so a spent weekly or monthly window is never hidden behind an empty 5h.
  function leadWindows(plan) {
    if (!plan) return [];
    const [first, ...rest] = plan.windows;
    const fullest = rest.reduce((best, window) => (finite(window.percent) && (!best || window.percent > best.percent) ? window : best), null) ?? rest[0];
    return [first, fullest].filter(Boolean).map((window) => `${window.short.toLowerCase()} ${finite(window.percent) ? percent(window.percent) : "—"}`);
  }
  function providerToday(local, provider) {
    const row = rows(local?.providers).find((entry) => entry.provider === provider);
    if (!row) return null;
    const today = row.today ?? { calls: 0, usage: {} };
    const tokens = today.usage?.totalTokens?.known;
    return `Recorded today · ${calls(today.calls)}${finite(tokens) ? ` · ${compact(tokens)} tokens` : ""} · ${costText(today.usage?.costUsd)}`;
  }

  // ---- the Model Lab tracker ----------------------------------------------------
  function accountCard(account, local) {
    const card = element("div", "lab-usage-card tracker-live-card tracker-account");
    card.append(element("span", "", `${account.label}${account.read === "none" ? "" : " · live"}`));
    if (account.read === "none") {
      card.append(element("strong", "", "No account API"));
      card.append(element("small", "muted", account.note || "This provider offers no account reading."));
    } else if (failedRead(account)) {
      card.append(element("strong", "", "Unavailable"));
      card.append(element("small", "muted", account.error || "No account reading yet."));
    } else if (!account.ok && account.code === "no-key") {
      card.append(element("strong", "", "Not connected"));
      card.append(element("small", "muted", account.error || "No key is saved for this account."));
    } else if (PLAN_READS.has(account.read)) {
      const plan = planOf(account);
      const first = plan.windows[0];
      card.append(element("strong", "", plan.reading ? "Not read yet" : first ? `${percent(first.percent)} of the ${first.label.toLowerCase()}` : "No plan windows"));
      if (plan.windows.length) {
        const bars = element("div", "tracker-windows tracker-account-windows");
        for (const window of plan.windows) bars.append(windowBar(window.label, window, { resets: true }));
        card.append(bars);
      }
      const limited = plan.windows.filter((window) => window.status === "rate-limited" || window.percent >= 100).map((window) => window.label);
      const detail = [
        limited.length ? `Limit reached: ${limited.join(", ")}` : "",
        plan.meta,
        account.read === "windows" ? (account.usage?.rolling?.resetsAt && account.usage.rolling.percent > 0 ? `5-hour window resets ${when(account.usage.rolling.resetsAt)}` : "") : "",
        account.read === "limits" && account.limits?.source === "cli" ? `read through the ${account.label}` : "",
        account.read === "limits" && account.limits?.source === "rollout" ? `from the last Codex session at ${when(account.limits.asOf)}${account.liveError ? `; live read unavailable: ${account.liveError}` : ""}` : "",
        plan.line && !/^Limit reached/.test(plan.line.text) ? plan.line.text : "",
        account.read === "quota" ? "Plan quota, not a bill" : "",
      ].filter(Boolean);
      card.append(element("small", "muted", detail.join(" · ")));
    } else if (BALANCE_READS.has(account.read)) {
      const balance = balanceOf(account);
      if (account.read === "key") {
        const key = account.key ?? {};
        card.append(element("strong", "", `${money(key.usage)} spent`));
        const detail = [];
        if (account.credits) detail.push(`${money(finite(account.credits.balance) ? account.credits.balance : account.credits.remaining)} of ${money(account.credits.totalCredits)} credits left`);
        if (finite(key.limit)) detail.push(`${money(key.limitRemaining)} left of the ${money(key.limit)} key limit${key.limitReset ? ` (${key.limitReset})` : ""}`);
        if (key.freeDaily) detail.push(`free models ${number(key.freeDaily.used)} of ${number(key.freeDaily.limit)} requests today`);
        detail.push(`today ${money(key.usageDaily)} · week ${money(key.usageWeekly)} · month ${money(key.usageMonthly)}`);
        if (key.isFreeTier) detail.push("free tier");
        if (finite(key.percent)) card.append(windowBar("Key limit", key));
        card.append(element("small", "muted", detail.join(" · ")));
      } else if (account.read === "credits") {
        const credits = account.credits ?? {};
        card.append(element("strong", "", `${money(credits.balance)} left`));
        card.append(element("small", "muted", finite(credits.totalUsed) ? `${money(credits.totalUsed)} used to date` : "Balance read from the gateway"));
      } else {
        card.append(element("strong", "", balance.value));
        card.append(element("small", "muted", `${balance.title || "A local server"}; nothing is billed.`));
      }
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
    const note = "Counts the OpenCode Go calls in both ledgers (the assistant's Go route and every coding turn OpenCode ran on Go) with the costs the provider reported. Go weighs each model's calls differently and counts its month from the subscription date, so the live Go windows above are the real figure; calls without a reported cost stay unknown, so this estimate can only be lower.";
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
    if (store.note && !store.rows) return ` Coding sessions: none read. ${store.note}`;
    return ` Coding sessions: ${number(store.rows)} turns read from the OpenCode store${store.since ? ` since ${when(store.since)}` : ""}.`;
  }

  function renderFull(target, report) {
    const local = report.local ?? {};
    if (local.ok === false) { empty(target, "Usage could not be read", local.error || "The local ledger could not be read."); return; }
    target.replaceChildren();
    target.append(renderSummary(local, report));
    target.append(section("Connected accounts (live)", "Each provider's own reading: over its saved key, through its coding CLI's own login (no prompt is sent), or from the local server. These are the providers' numbers, not the local estimate.", accountsSection(report)));
    target.append(localSection(local.credits));
    target.append(section("By provider", "Both ledgers: the calls Studio made and the coding turns OpenCode ran for this project. A plan or subscription reports no per-call cost, so its calls are unpriced rather than free.", providersTable(local)));
    target.append(section("Recorded usage by day", "Days use this machine's calendar. Cost is shown only when the provider reported it.", daysTable(local)));
    target.append(section("By model", "Sums across both ledgers for the active project.", modelsTable(local)));
    const retired = local.retention?.dropped ? ` ${number(local.retention.dropped)} older Studio details retired; lifetime totals retained.` : "";
    target.append(element("p", "muted tracker-footnote", `${local.coverage || "Only recorded calls are included."}${storeLine(local)}${retired}`));
  }

  // ---- the compact Command panel ----------------------------------------------------
  // Three short sections: every plan with its windows as bars, the balances
  // of the metered accounts, and today's recorded calls per provider. A plan
  // nobody has read yet, or one being read, says so in its own card; a failed
  // read says why, briefly, with the whole reason on hover.
  function row(label, value, tone = "", title = "") {
    const item = element("li", "tracker-row");
    if (tone) item.setAttribute("data-tone", tone);
    if (title) item.title = title;
    item.append(element("span", "tracker-row-label", label), element("span", "tracker-row-value", value));
    return item;
  }
  function kicker(text) {
    return element("p", "tracker-kicker", text);
  }
  function planCard(plan) {
    const card = element("div", "tracker-plan");
    if (plan.tone) card.setAttribute("data-tone", plan.tone);
    const head = element("div", "tracker-plan-head");
    head.append(element("span", "tracker-plan-name", plan.label));
    if (plan.meta) head.append(element("small", "tracker-plan-meta", plan.meta));
    card.append(head);
    if (plan.windows.length) {
      const bars = element("div", "tracker-windows");
      for (const window of plan.windows) bars.append(windowBar(window.short, window, { resets: true, reset: true }));
      card.append(bars);
    }
    if (plan.line) {
      const line = element("p", plan.line.tone === "warn" ? "tracker-line tracker-line-warn" : plan.line.tone === "idle" ? "tracker-line tracker-line-idle" : "tracker-line", plan.line.text);
      if (plan.failed) line.title = plan.line.text;
      card.append(line);
    }
    return card;
  }
  function balanceRow(balance) {
    const item = row(balance.label, balance.value, balance.tone, balance.title);
    if (balance.bar && finite(balance.bar.percent)) {
      const bar = element("span", "tracker-bar tracker-row-bar");
      const fill = element("i");
      fill.style.width = `${Math.max(0, Math.min(100, balance.bar.percent))}%`;
      if (balance.bar.percent >= 90) fill.className = "warn";
      bar.append(fill);
      item.append(bar);
    }
    return item;
  }
  function todayValue(bucket) {
    const tokens = bucket?.usage?.totalTokens?.known;
    const cost = bucket?.usage?.costUsd;
    const parts = [calls(bucket?.calls ?? 0)];
    if (bucket?.errors) parts.push(`${number(bucket.errors)} failed`);
    // Tokens a provider never reported are left out, not printed as "?".
    if (finite(tokens) && tokens > 0) parts.push(`${compact(tokens)} tok`);
    if (cost?.knownRecords > 0) parts.push(money(cost.known));
    return parts.join(" · ");
  }
  function todaySection(target, local, accounts, plans) {
    const list = element("ul", "tracker-rows");
    const active = rows(local.providers).filter((entry) => entry.today?.calls > 0).slice().sort((a, b) => b.today.calls - a.today.calls || String(a.label).localeCompare(String(b.label)));
    for (const entry of active) list.append(row(entry.label || entry.provider, todayValue(entry.today), entry.today.errors > 0 && entry.today.errors === entry.today.calls ? "warn" : ""));
    list.append(row(active.length ? "All providers" : "Recorded today", todayValue(local.today)));
    // The Go estimate is a floor built from recorded costs; once the live Go
    // windows are in, it only repeats them less accurately.
    const liveGo = plans.some((plan) => plan.provider === "opencode-go" && plan.account.ok);
    const estimate = local.credits;
    if (estimate && !liveGo && rows(accounts).some((account) => account.provider === "opencode-go")) {
      list.append(row("Go estimate (local)", `5h ${localCost(estimate.rolling)}/${money(estimate.rolling.limitUsd, 0)} · wk ${localCost(estimate.weekly)}/${money(estimate.weekly.limitUsd, 0)} · mo ${localCost(estimate.monthly)}/${money(estimate.monthly.limitUsd, 0)}`, "", "Recorded Go spend against the plan's dollar caps: a floor, since Go weighs models differently and unpriced calls are left out."));
    }
    target.append(kicker("Today"), list);
    const quiet = accounts.filter((account) => account.read === "none" && !active.some((entry) => entry.provider === account.provider)).map((account) => account.label);
    if (quiet.length) target.append(element("p", "tracker-line tracker-line-idle", `Also connected: ${quiet.join(", ")} · no calls today`));
    if (local.store?.ok === false) target.append(element("p", "tracker-line tracker-line-warn", `Coding sessions unavailable: ${local.store.error || "the OpenCode store could not be read."}`));
    else if (local.store?.note && !local.store.rows) target.append(element("p", "tracker-line tracker-line-warn", `Coding sessions: none read. ${local.store.note}`));
  }
  function renderCompact(target, report) {
    target.replaceChildren();
    const local = report.local?.ok === false ? null : report.local;
    // The older credits bridge stands in for a Go account even when no Go key
    // is saved; that placeholder is a hint for the Model Lab view, not a
    // connected provider, so the compact panel leaves it out.
    const accounts = accountsOf(report).filter((account) => !(account.provider === "opencode-go" && !account.ok && account.code === "no-key"));
    const plans = plansOf(accounts);
    const balances = accounts.filter((account) => BALANCE_READS.has(account.read)).map(balanceOf).filter(Boolean);
    if (plans.length) {
      const wrap = element("div", "tracker-plans");
      for (const plan of plans) wrap.append(planCard(plan));
      target.append(kicker("Plan limits"), wrap);
    }
    if (balances.length) {
      const list = element("ul", "tracker-rows");
      for (const balance of balances) list.append(balanceRow(balance));
      target.append(kicker("Balances"), list);
    }
    if (!plans.length && !balances.length) {
      const credits = report.credits ?? {};
      const failed = accounts.find(failedRead);
      target.append(element("p", "tracker-line tracker-line-warn", failed ? `${failed.label} · ${failed.error || "account read unavailable"}` : report.accounts?.ok === false ? report.accounts.error || "Account readings are unavailable." : credits.ok === false && credits.error && credits.code !== "no-key" ? credits.error : "No live account reading yet · save a plan key or sign in to a coding CLI in Settings."));
    }
    if (report.local?.ok === false) target.append(element("p", "tracker-line tracker-line-warn", report.local.error || "Local usage could not be read."));
    if (local) todaySection(target, local, accounts, plans);
  }

  // ---- status, pill and dot ------------------------------------------------------------
  // A missing OpenCode Go key is not a failed read once the accounts read is
  // authoritative: the older credits bridge simply has nothing to say. A read
  // that did fail is named, so the note says which account to look at.
  function failedAccounts(report) {
    const noKey = report.credits?.ok === false && report.credits?.code === "no-key" && report.accounts?.ok === true;
    return accountsOf(report).filter((account) => failedRead(account) && !(noKey && account.provider === "opencode-go"));
  }
  function readNote(report) {
    const noKey = report.credits?.ok === false && report.credits?.code === "no-key" && report.accounts?.ok === true;
    if (report.credits?.ok === false && !noKey && report.accounts?.ok !== true) return " · live account read unavailable";
    const failed = failedAccounts(report);
    if (!failed.length) return "";
    return ` · ${failed.length} account read${failed.length === 1 ? "" : "s"} failed (${failed.map((account) => account.label).join(", ")})`;
  }
  function pendingNote(report) {
    const reading = accountsOf(report).filter((account) => account.refreshing || account.code === "pending").map((account) => account.label);
    return reading.length ? ` · reading ${reading.join(", ")}…` : "";
  }
  // The pill itself carries one short reading: the lead plan's first two
  // windows, or today's recorded calls when no plan has a fresh reading.
  function briefOf(report) {
    if (!report) return "";
    const lead = leadPlan(plansOf(accountsOf(report)));
    if (lead) return leadWindows(lead).join(" · ");
    const local = report.local?.ok === false ? null : report.local;
    return local ? `today ${calls(local.today.calls)}` : "no reading";
  }
  // The dot lights when a read failed, a plan is spent or nearly so, or a
  // balance has run out.
  function toneOf(report) {
    if (!report) return "";
    if (readNote(report)) return "warn";
    const accounts = accountsOf(report);
    if (plansOf(accounts).some((plan) => plan.tone === "warn")) return "warn";
    return accounts.filter((account) => BALANCE_READS.has(account.read)).map(balanceOf).some((balance) => balance?.tone === "warn" || balance?.tone === "error") ? "warn" : "";
  }
  function statusOf(report) {
    if (!report) return "Waiting for a reading…";
    const stamp = report.accounts?.at ?? report.credits?.fetchedAt ?? report.at;
    return `Updated ${clock(stamp)}${pendingNote(report)}${readNote(report)}`;
  }
  // The pill's tooltip still says the one thing worth knowing: the lead
  // plan's windows, or today's recorded calls when nothing live leads.
  function compactStatus(report) {
    if (!report) return "Waiting for a reading…";
    const lead = leadPlan(plansOf(accountsOf(report)));
    const local = report.local?.ok === false ? null : report.local;
    const summary = lead ? ` · ${lead.label} ${leadWindows(lead).join(" · ")}` : local ? ` · today ${calls(local.today.calls)}` : "";
    return `${statusOf(report)}${summary}`;
  }
  // Whether someone can see a view right now. Its own hidden flag says too
  // little: a Model Lab tab stays unhidden after the page is left, and the
  // popover would keep its state if Command were left by keyboard.
  const visible = (node) => Boolean(node) && node.hidden !== true && (typeof node.checkVisibility === "function" ? node.checkVisibility() : true);
  const trackerShown = () => visible($("model-lab-tracker"));
  const popShown = () => state.open && visible($("cmd-usage-pop"));
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
    const brief = $("cmd-usage-brief");
    if (brief) brief.textContent = briefOf(report);
    const dot = $("cmd-usage-dot");
    if (dot) { const tone = toneOf(report); dot.hidden = !tone; dot.setAttribute("data-tone", tone || "ok"); }
    const toggle = $("cmd-usage-toggle");
    if (toggle) toggle.title = `${compactStatus(report)} · click for the breakdown`;
    follow(report);
  }
  function setStatus(text) {
    const fullStatus = $("model-lab-tracker-status");
    if (fullStatus) fullStatus.textContent = text;
    const compactState = $("cmd-usage-state");
    if (compactState) compactState.textContent = text;
    const brief = $("cmd-usage-brief");
    if (brief && !state.report) brief.textContent = text === "Reading usage…" ? "reading…" : "";
  }
  // A CLI plan being read answers a few seconds later; while someone is
  // looking, ask again until it has (the host never starts a second probe
  // for these follow-ups).
  function stopFollow() {
    if (state.follow !== null && typeof clearTimeout === "function") clearTimeout(state.follow);
    state.follow = null;
  }
  function follow(report) {
    stopFollow();
    const waiting = rows(report?.accounts?.pending).length > 0;
    if (!waiting) { state.follows = 0; return; }
    if (!(popShown() || trackerShown()) || state.follows >= FOLLOW_LIMIT || typeof setTimeout !== "function") return;
    state.follows += 1;
    // Quick at first, then slower: four probes two at a time, each allowed a
    // cold start, can take a couple of minutes to all answer.
    state.follow = setTimeout(() => {
      state.follow = null;
      refresh({ force: true, probe: false });
    }, state.follows > FOLLOW_QUICK ? FOLLOW_MS * 3 : FOLLOW_MS);
  }

  // `probe` says someone is looking: only then may the host start a coding
  // CLI to read its plan. Left out, it follows whether the panel or the Model
  // Lab tracker is showing.
  function refresh({ force = false, probe } = {}) {
    if (!force && state.report && Date.now() - state.at < STALE_MS) return Promise.resolve(state.report);
    const look = probe ?? (popShown() || trackerShown());
    // A read already under way that could not ask the CLIs is followed by
    // one that can, rather than standing in for it.
    if (state.pending) return look && !state.pendingLook ? state.pending.then(() => refresh({ force: true, probe: true })) : state.pending;
    const token = ++state.read;
    state.pendingLook = look;
    if (look) state.looked = Date.now();
    if (!state.report) setStatus("Reading usage…");
    state.pending = (async () => {
      const bridge = api();
      if (!bridge?.usageTracker) throw new Error("Usage tracking is available in the Studio desktop app.");
      const [local, credits, accounts] = await Promise.all([
        bridge.usageTracker(),
        bridge.opencodeCredits ? bridge.opencodeCredits() : Promise.resolve({ ok: false, error: "Live account usage is unavailable in this build." }),
        bridge.usageAccounts ? bridge.usageAccounts({ probe: look }).catch((error) => ({ ok: false, error: error?.message || "Account readings are unavailable.", accounts: [] })) : Promise.resolve({ ok: false, error: "Account readings are unavailable in this build.", accounts: [] }),
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
    if (Date.now() - state.at >= REFRESH_MS) refresh({ probe: false });
  }
  // The Usage pill at the bottom-left opens the breakdown above it; opening
  // also asks for a reading when the last one is older than a few seconds,
  // and lets the host read the coding CLIs' plans. The Legend shares the
  // corner, so the two never stand open together.
  function setOpen(open) {
    state.open = Boolean(open);
    const pop = $("cmd-usage-pop");
    if (pop) pop.hidden = !state.open;
    const body = $("cmd-usage-body");
    if (body) body.hidden = !state.open;
    const toggle = $("cmd-usage-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", String(state.open));
    if (state.open) {
      const legend = $("cmd-legend-list");
      if (legend && legend.hidden === false) {
        // Closed through its own toggle so idle.js keeps its state; the
        // guard stops that click from closing this breakdown in turn.
        state.closingLegend = true;
        try { $("idle-legend-toggle")?.click?.(); } finally { state.closingLegend = false; }
      }
      state.follows = 0;
      // A reading taken while nobody was looking never asked the CLIs.
      refresh({ probe: true, force: Date.now() - state.looked >= STALE_MS });
    } else if (!trackerShown()) {
      stopFollow();
    }
  }
  function openTab() {
    setOpen(false);
    // Through the registry so the "Back to Command" return state is recorded.
    if (window.MefiNav?.go) window.MefiNav.go("graph");
    else { window.MefiIdle?.exit?.(); window.MefiBooklet?.showTab?.("graph"); }
    window.MefiModelLab?.show?.("tracker");
  }
  function open() {
    if (state.report && Date.now() - state.at < REFRESH_MS) return;
    refresh({ probe: false });
  }
  function init() {
    if (state.initialized) return;
    state.initialized = true;
    $("model-lab-tracker-refresh")?.addEventListener("click", () => refresh({ force: true, probe: true }));
    $("cmd-usage-refresh")?.addEventListener("click", () => refresh({ force: true, probe: true }));
    $("cmd-usage-open")?.addEventListener("click", openTab);
    $("cmd-usage-toggle")?.addEventListener("click", () => setOpen(!state.open));
    // Opening the Legend closes the breakdown (idle.js owns the Legend).
    $("idle-legend-toggle")?.addEventListener("click", () => { if (state.open && !state.closingLegend) setOpen(false); });
    // A click anywhere outside the corner closes the breakdown.
    document.addEventListener?.("pointerdown", (event) => {
      if (state.open && !event.target?.closest?.("#cmd-legend")) setOpen(false);
    });
    // Escape closes the breakdown first, before the app's own Escape (which
    // would leave Command) sees the key - unless the key belongs to a field
    // or a dialog standing over it, which close themselves.
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !popShown()) return;
      const owner = event.target?.closest?.("input, textarea, select, [contenteditable], dialog, [role=dialog]");
      if (owner && !owner.closest?.("#cmd-usage-pop")) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      setOpen(false);
      $("cmd-usage-toggle")?.focus?.();
    }, true);
    // Leaving Command by any route closes the breakdown, so it neither holds a
    // later Escape nor keeps the CLIs probing out of sight.
    if (typeof MutationObserver === "function" && document.body) {
      new MutationObserver(() => {
        if (state.open && !document.body.classList.contains("command-active")) setOpen(false);
      }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }
    setOpen(false);
    window.addEventListener("mefi:project-changed", () => {
      state.read += 1;
      state.at = 0;
      state.report = null;
      refresh({ force: true, probe: false });
    });
  }

  window.MefiUsageTracker = { refresh, tick, open, openTab, init, setOpen, report: () => state.report };
  init();
})();
