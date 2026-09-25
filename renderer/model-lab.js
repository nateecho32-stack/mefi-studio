// Local evidence about Studio's models, separate from published catalog claims.
(function () {
  "use strict";
  const state = { initialized: false, view: "rankings", snapshot: null, read: 0, contextRead: 0, taskRead: 0, types: new Set(), tasks: [], at: 0 };
  const $ = (id) => document.getElementById(`model-lab-${id}`);
  const api = () => window.mefiStudio;
  const rows = (value) => Array.isArray(value) ? value : [];
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const number = (value, digits = 0) => finite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "Unknown";
  const duration = (value) => finite(value) ? value < 1000 ? `${number(value)} ms` : `${number(value / 1000, 1)} s` : "Unmeasured";
  const money = (value) => finite(value) ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: value < 0.01 ? 6 : 4 })}` : "Unknown";
  const when = (value) => {
    if (value == null || value === "") return "Time unavailable";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Time unavailable";
  };
  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }
  function empty(target, title, detail) {
    const box = element("div", "lab-empty");
    box.append(element("h3", "", title), element("p", "", detail));
    target.replaceChildren(box);
  }
  function quality(value) {
    return value?.count > 0 && finite(value.mean) ? `${number(value.mean, 1)} / 5 · ${number(value.count)} rated` : "Not rated";
  }
  // Wins and losses come only from the verification runner, never from transport.
  function verdicts(value) {
    if (!((value?.wins || 0) + (value?.losses || 0))) return value?.unsettled > 0 ? `${number(value.unsettled)} awaiting verification` : "No verified tasks";
    return `${number(value.wins)} won / ${number(value.losses)} lost${finite(value.winProbability) ? ` · ${number(value.winProbability * 100)}% win chance` : ""}`;
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
  function modelName(model) {
    const cell = element("div", "lab-model-name");
    cell.append(element("strong", "", model.model || "Unknown model"), element("span", "muted", `${model.provider || "Unknown provider"} · ${number(model.samples)} calls`));
    if (model.samples > 0) {
      const evidence = element("details", "lab-model-evidence");
      evidence.append(element("summary", "", model.evidence === "limited" ? "Limited evidence" : "Inspect task evidence"));
      for (const task of rows(model.taskStrengths)) evidence.append(element("p", "", `${task.taskType} · ${number(task.samples)} calls · ${duration(task.latencyMs?.p50)} median · human ${quality(task.quality?.human)} · model ${quality(task.quality?.model)} · ${verdicts(task)}`));
      for (const effort of rows(model.efforts)) evidence.append(element("p", "", `Effort: ${effort.requestedEffort || "default"} requested · ${effort.appliedEffort ? `${effort.appliedEffort} confirmed` : "provider confirmation unavailable"} · ${number(effort.samples)} calls`));
      cell.append(evidence);
    }
    return cell;
  }
  function renderSummary(snapshot) {
    const models = rows(snapshot.models);
    const totals = $("summary"); totals.replaceChildren();
    const stats = [["Recorded calls", number(snapshot.calls)], ["Models observed", number(models.filter((model) => model.samples > 0).length)], ["Errors recorded", number(models.reduce((sum, model) => sum + (model.errors || 0), 0))]];
    for (const [label, value] of stats) { const card = element("div", "lab-stat"); card.append(element("span", "", label), element("strong", "", value)); totals.append(card); }
  }
  function renderRankings(snapshot) {
    const models = rows(snapshot.models);
    const target = $("ranking-list");
    if (!models.some((model) => model.samples > 0)) empty(target, "Your results will build the ranking", "Studio has no measured calls for this selection yet. Unmeasured models are not treated as fast, free, or reliable.");
    else target.replaceChildren(table(["Model", "Rank / score", "Response time", "Output speed", "Cost / call", "Errors", "Task wins", "Your quality", "Model judged"], models, (model) => [
      modelName(model), model.rank != null && finite(model.score) ? `#${model.rank} · ${number(model.score, 1)} / 100` : "Not ranked",
      `${duration(model.latencyMs?.p50)}${model.latencyMs?.count ? " median" : ""}`,
      finite(model.throughput?.p50) ? `${number(model.throughput.p50, 1)} tokens/s` : "Unmeasured",
      model.costUsd?.count > 0 ? money(model.costUsd.mean) : model.samples > 0 ? "Unknown" : "Unmeasured",
      model.samples > 0 ? `${number(model.errors)} / ${number(model.samples)}${finite(model.errorRate) ? ` · ${number(model.errorRate * 100, 1)}%` : ""}` : "Unmeasured",
      verdicts(model), quality(model.quality?.human), quality(model.quality?.model),
    ]));
    const notes = rows(snapshot.ranking?.notes).filter((note) => typeof note === "string");
    const metrics = rows(snapshot.ranking?.metrics).map((key) => key === "speed" ? "response time" : key === "quality" ? `${snapshot.ranking.qualitySource || "human"} ratings` : key);
    $("ranking-notes").textContent = `${metrics.length ? `Rank uses ${metrics.join(", ")}. ` : ""}${notes.join(" ") || "Rank reflects available evidence. Human and model ratings stay separate; missing measurements remain unknown."}`;
    renderRecent(snapshot);
  }
  // Once calls exist, a value they did not report reads "Unknown". Before the
  // first call there is nothing to total, so renderUsage shows one empty state.
  function usageMetric(label, record, format = number) {
    const card = element("div", "lab-usage-card");
    const unknown = Math.max(0, Number(record?.unknownRecords) || 0);
    card.append(element("span", "", label), element("strong", "", record && finite(record.known) ? format(record.known) : "Unknown"), element("small", "muted", unknown ? `${number(unknown)} calls did not report this` : "Recorded total"));
    return card;
  }
  function renderUsage(snapshot) {
    const usage = snapshot.usage || {};
    $("usage-coverage").textContent = snapshot.coverage || "Only calls recorded by Studio are included. External coding tools and provider account balances are not synchronized.";
    $("usage-range").textContent = `${snapshot.range?.from ? `${when(snapshot.range.from)} – ${when(snapshot.range.to)}` : "No recorded period yet"}${snapshot.retention?.dropped ? ` · ${number(snapshot.retention.dropped)} older details retired; lifetime totals retained` : ""}`;
    const recent = rows(snapshot.recent);
    const none = !recent.length && !(Number(snapshot.calls) > 0);
    $("usage-range").hidden = none;
    $("usage-totals").hidden = none;
    $("usage-totals").replaceChildren(...(none ? [] : [usageMetric("Input tokens", usage.inputTokens), usageMetric("Output tokens", usage.outputTokens), usageMetric("Total tokens", usage.totalTokens), usageMetric("Recorded cost", usage.costUsd, money)]));
    const target = $("usage-list");
    if (!recent.length) { empty(target, none ? "No calls recorded yet" : "No recent calls", "Token and cost totals appear after Studio's first model call. Values a provider does not report stay marked Unknown."); return; }
    target.replaceChildren(table(["When", "Model / purpose", "Result", "Effort", "Duration", "Input / output"], recent.slice(0, 30), (call) => {
      const name = element("div", "lab-model-name");
      name.append(element("strong", "", call.model || "Unknown model"), element("span", "muted", [call.provider, call.role || call.taskType].filter(Boolean).join(" · ")));
      return [when(call.at), name, call.status === "ok" ? "Completed" : call.status || "Unknown", `${call.requestedEffort || "Default"} requested · ${call.appliedEffort ? `${call.appliedEffort} confirmed` : "provider confirmation unavailable"}`, duration(call.elapsedMs), `${number(call.tokenUsage?.inputTokens)} / ${number(call.tokenUsage?.outputTokens)}`];
    }));
  }
  function renderRecent(snapshot) {
    const target = $("recent"); target.replaceChildren();
    const recent = rows(snapshot.recent).filter((call) => ["success", "ok"].includes(call.status)).slice(0, 12);
    if (!recent.length) { empty(target, "No completed results to rate", "Rate successful work after reviewing the result in its conversation or task."); return; }
    for (const call of recent) {
      const card = element("form", "lab-rating-row");
      const description = element("div", "lab-model-name");
      description.append(element("strong", "", call.model || "Unknown model"), element("span", "muted", `${call.role || call.taskType || "Model call"} · ${when(call.at)}`));
      const select = element("select"); select.setAttribute("aria-label", `Your rating for ${call.model || "this model"}`);
      const placeholder = element("option", "", "Your score…"); placeholder.value = ""; select.append(placeholder);
      for (let score = 0; score <= 5; score += 1) { const option = element("option", "", `${score} / 5${score === 0 ? " · poor" : score === 5 ? " · excellent" : ""}`); option.value = String(score); select.append(option); }
      const saved = rows(call.ratings?.human).at(-1);
      if (finite(saved?.score)) select.value = String(saved.score);
      const note = element("input"); note.type = "text"; note.maxLength = 240; note.placeholder = "Optional note"; note.setAttribute("aria-label", "Rating note");
      note.value = saved?.note || "";
      const button = element("button", "ghost", "Save rating"); button.type = "submit"; button.disabled = select.value === "";
      const status = element("span", "lab-rating-status"); status.setAttribute("role", "status");
      select.addEventListener("change", () => { button.disabled = select.value === ""; });
      card.addEventListener("submit", async (event) => {
        event.preventDefault();
        const score = Number(select.value);
        if (button.disabled || select.value === "" || !finite(score)) return;
        button.disabled = true; status.textContent = "Saving…";
        try {
          const result = await api()?.modelPerformanceRate?.({ observationId: call.id, authority: "human", score, ...(note.value.trim() ? { note: note.value.trim() } : {}) });
          if (!result || result.ok === false) throw new Error(result?.error || "The rating could not be saved.");
          status.textContent = "Saved";
          await refresh();
        } catch (error) { status.textContent = error.message || "The rating could not be saved."; button.disabled = false; }
      });
      card.append(description, select, note, button, status); target.append(card);
    }
  }
  function updateTypes(snapshot) {
    for (const call of rows(snapshot.recent)) if (call.taskType) state.types.add(call.taskType);
    for (const model of rows(snapshot.models)) for (const entry of rows(model.taskStrengths)) if (entry.taskType) state.types.add(entry.taskType);
    const filter = $("task-type"); const selected = filter.value;
    const first = element("option", "", "All task types"); first.value = ""; filter.replaceChildren(first);
    for (const type of [...state.types].sort()) { const option = element("option", "", type); option.value = type; filter.append(option); }
    filter.value = selected;
  }
  async function refresh() {
    if (!state.initialized) return;
    const token = ++state.read;
    $("refresh").disabled = true;
    $("status").textContent = "Reading local measurements…";
    try {
      if (!api()?.modelPerformanceSnapshot) throw new Error("Model measurements are available in the Studio desktop app.");
      const result = await api().modelPerformanceSnapshot({ ...($("task-type").value ? { taskType: $("task-type").value } : {}) });
      if (token !== state.read) return;
      if (!result || result.ok === false) throw new Error(result?.error || "Model measurements could not be read.");
      const snapshot = result.snapshot || result;
      state.snapshot = snapshot; state.at = Date.now();
      renderSummary(snapshot); updateTypes(snapshot); renderRankings(snapshot); renderUsage(snapshot);
      $("status").textContent = `Local measurements · updated ${when(snapshot.generatedAt || state.at)}`;
    } catch (error) { if (token === state.read) $("status").textContent = error.message || "Model measurements could not be read."; }
    finally { if (token === state.read) $("refresh").disabled = false; }
  }
  async function loadTasks() {
    const token = ++state.taskRead;
    const result = await api()?.tasksList?.();
    if (token !== state.taskRead) return false;
    if (result?.ok === false) throw new Error(result.error || "Tasks could not be read.");
    state.tasks = rows(result?.tasks);
    const target = $("context-task"); const selected = target.value;
    const first = element("option", "", "Choose a task…"); first.value = ""; target.replaceChildren(first);
    for (const task of state.tasks) { const option = element("option", "", task.title || task.id); option.value = task.id; target.append(option); }
    target.value = state.tasks.some((task) => task.id === selected) ? selected : state.tasks[0]?.id || "";
    return true;
  }
  async function previewContext() {
    const token = ++state.contextRead;
    if (!$("context-task").value) {
      $("context-refresh").disabled = false;
      $("context-status").textContent = "Choose a saved task to inspect its context.";
      $("context-sections").replaceChildren();
      return;
    }
    $("context-refresh").disabled = true;
    $("context-status").textContent = "Preparing the saved context…";
    $("context-sections").replaceChildren();
    try {
      if (!api()?.modelLabContext) throw new Error("Context preview is available in the Studio desktop app.");
      const result = await api().modelLabContext({ ...($("context-task").value ? { taskId: $("context-task").value } : {}), budgetTokens: Number($("context-budget").value) || 4000 });
      if (token !== state.contextRead) return;
      if (!result || result.ok === false) throw new Error(result?.error || "The context could not be read.");
      const target = $("context-sections"); target.replaceChildren();
      // What the latest attempt actually cost, beside what its context weighs.
      // Read after the preview so a slow or unavailable ledger never delays it.
      if (api()?.usageForTask) {
        api().usageForTask($("context-task").value)
          .then((cost) => {
            if (token !== state.contextRead || !cost?.ok) return;
            const text = cost.measured ? `This attempt cost: ${cost.line}` : cost.note || "No measured calls for this attempt yet.";
            target.prepend(element("p", "muted", cost.note && cost.measured ? `${text} — ${cost.note}` : text));
          })
          .catch(() => {});
      }
      $("context-status").textContent = `${number(result.estimatedTokens)} estimated tokens / ${number(result.budgetTokens)} budget${result.truncated ? " · some source text is excluded from this preview; saved originals are retained" : ""}`;
      for (const section of rows(result.sections)) {
        const fold = element("details", `lab-context-source${section.included ? "" : " excluded"}`); fold.open = section.included === true;
        const summary = element("summary", "", `${section.label || section.kind || "Context"} · ${number(section.estimatedTokens)} tokens · ${section.included ? "included" : "excluded"}`);
        fold.append(summary);
        if (section.reason) fold.append(element("p", "muted", section.reason));
        if (section.text) fold.append(element("pre", "", section.text));
        target.append(fold);
      }
      if (!rows(result.sections).length) empty(target, "No saved context here yet", "A task brief, references and handoff will appear when they have been saved.");
    } catch (error) { if (token === state.contextRead) { $("context-status").textContent = error.message || "The context could not be read."; $("context-sections").replaceChildren(); } }
    finally { if (token === state.contextRead) $("context-refresh").disabled = false; }
  }
  function show(view) {
    if (!["rankings", "usage", "context", "tracker", "compare"].includes(view)) view = "rankings";
    state.view = view;
    for (const name of ["rankings", "usage", "context", "tracker", "compare"]) {
      $(name).hidden = name !== view;
      $(`tab-${name}`).setAttribute("aria-selected", String(name === view));
      $(`tab-${name}`).tabIndex = name === view ? 0 : -1;
    }
    const usageSwitch = $("usage-switch");
    if (usageSwitch) usageSwitch.hidden = !["usage", "tracker"].includes(view);
    for (const [id, target] of [["recorded", "usage"], ["accounts", "tracker"]]) {
      $(id)?.setAttribute("aria-selected", String(view === target));
      if ($(id)) $(id).tabIndex = view === target ? 0 : -1;
    }
    if ($("summary")) $("summary").hidden = view !== "rankings";
    window.dispatchEvent(new CustomEvent("mefi:model-view", { detail: { view } }));
    if (view === "tracker") window.MefiUsageTracker?.refresh?.();
    if (view === "context") loadTasks().then((fresh) => { if (fresh) return previewContext(); }).catch((error) => { $("context-status").textContent = error.message || "Tasks could not be read."; });
  }
  function init() {
    if (state.initialized || !document.getElementById("model-lab")) return;
    state.initialized = true;
    const views = ["rankings", "usage", "context", "tracker", "compare"];
    for (const [index, name] of views.entries()) {
      const button = $(`tab-${name}`);
      button.addEventListener("click", () => show(name));
      button.addEventListener("keydown", (event) => {
        // Arrow keys cycle only the tabs that are shown; a hidden tab (Compare
        // until it runs) is skipped instead of being reachable by keyboard.
        const order = views.filter((view) => !$(`tab-${view}`)?.hidden);
        const at = order.indexOf(name);
        const target = at < 0 ? -1 : event.key === "ArrowRight" ? (at + 1) % order.length : event.key === "ArrowLeft" ? (at + order.length - 1) % order.length : event.key === "Home" ? 0 : event.key === "End" ? order.length - 1 : -1;
        if (target < 0) return; event.preventDefault(); show(order[target]); $(`tab-${order[target]}`).focus();
      });
    }
    $("refresh").addEventListener("click", refresh);
    for (const [id, view] of [["recorded", "usage"], ["accounts", "tracker"]]) {
      $(id)?.addEventListener("click", () => show(view));
      $(id)?.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const accounts = event.key === "End" || (event.key !== "Home" && view === "usage");
        show(accounts ? "tracker" : "usage");
        $(accounts ? "accounts" : "recorded")?.focus();
      });
    }
    $("task-type").addEventListener("change", refresh);
    $("context-refresh").addEventListener("click", previewContext);
    $("context-task").addEventListener("change", previewContext);
    $("context-budget").addEventListener("change", previewContext);
    window.addEventListener("mefi:project-changed", () => {
      state.contextRead += 1; state.taskRead += 1; state.read += 1; state.at = 0; state.tasks = []; state.snapshot = null; state.types.clear();
      $("task-type").value = "";
      $("context-task").value = ""; $("context-sections").replaceChildren();
      if (!document.getElementById("tab-graph")?.hidden) { refresh(); if (state.view === "context") show("context"); }
    });
  }
  function open() { init(); if (state.initialized && Date.now() - state.at > 5000) refresh(); }
  window.MefiModelLab = { open, refresh, show, view: () => state.view };
})();
