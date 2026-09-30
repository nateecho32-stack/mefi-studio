// Local evidence about Studio's models, separate from published catalog claims.
(function () {
  "use strict";
  const state = { initialized: false, view: "rankings", snapshot: null, read: 0, contextRead: 0, taskRead: 0, types: new Set(), typesKey: "", tasks: [], at: 0 };
  const $ = (id) => document.getElementById(`model-lab-${id}`);
  const api = () => window.mefiStudio;
  const rows = (value) => Array.isArray(value) ? value : [];
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const number = (value, digits = 0) => finite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "Unknown";
  const duration = (value) => finite(value) ? value < 1000 ? `${number(value)} ms` : `${number(value / 1000, 1)} s` : "Unmeasured";
  const callCount = (value) => `${number(value)} ${value === 1 ? "call" : "calls"}`;
  const money = (value) => finite(value) ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: value < 0.01 ? 6 : 4 })}` : "Unknown";
  // Each view names what it measures; one shared line read the same on three pages.
  const LEDES = {
    rankings: "How each model did on your own work: speed, cost, errors and your ratings.",
    usage: "Tokens and cost from the model calls Studio recorded.",
    context: "What a task carries into its model calls, and what the latest attempt cost.",
    tracker: "What each provider account reports: plans, balances and limits.",
    community: "What the community reports about a model, and Studio's own probe runs on it.",
  };
  const plain = (error, fallback) => window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : error?.message || fallback;
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
  // A header is a title, or [title, class] when its column needs one (the
  // leaderboard's columns carry their class onto every cell).
  function table(headers, entries, rowOf) {
    const node = element("table", "lab-table");
    const head = element("thead");
    const headRow = element("tr");
    const columns = headers.map((header) => (Array.isArray(header) ? header : [header, ""]));
    for (const [title, className] of columns) { const th = element("th", className, title); th.scope = "col"; headRow.append(th); }
    head.append(headRow);
    const body = element("tbody");
    entries.forEach((entry) => {
      const tr = element("tr");
      rowOf(entry).forEach((value, index) => { const cell = element("td", columns[index]?.[1] || ""); cell.append(typeof value === "object" ? value : element("span", "", String(value))); tr.append(cell); });
      body.append(tr);
    });
    node.append(head, body);
    return node;
  }
  // A thin inline bar: zero at the left, its share of the column's scale as
  // its length. It repeats the number beside it, so screen readers skip it;
  // the style attribute keeps it one write.
  function bar(fraction, tone = "") {
    const node = element("span", tone ? `lab-bar ${tone}` : "lab-bar");
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("style", `--v:${(Math.max(0, Math.min(1, fraction)) * 100).toFixed(1)}%`);
    node.append(element("i"));
    return node;
  }
  // A leaderboard cell: the value, its bar when it has a scale, a quiet note.
  function metric(text, fraction = null, { tone = "", note = "", quiet = false } = {}) {
    const cell = element("div", quiet ? "lab-metric is-quiet" : "lab-metric");
    cell.append(element("span", "lab-metric-value", text));
    if (finite(fraction)) cell.append(bar(fraction, tone));
    if (note) cell.append(element("small", "", note));
    return cell;
  }
  function rankCell(model) {
    if (model.rank == null || !finite(model.score)) return element("span", "lab-rank is-unranked", "—");
    return element("span", model.rank <= 3 ? "lab-rank is-top" : "lab-rank", `#${model.rank}`);
  }
  // Speed leads with output tokens per second (longer bar, faster model) and
  // keeps the median response time beside it; without token counts the
  // response time stands alone.
  function speedCell(model, fastest) {
    const median = model.latencyMs?.count ? `${duration(model.latencyMs?.p50)} median` : duration(model.latencyMs?.p50);
    if (finite(model.throughput?.p50)) return metric(`${number(model.throughput.p50, 1)} tokens/s`, fastest > 0 ? model.throughput.p50 / fastest : null, { note: `${median} response` });
    return metric(median, null, { quiet: !finite(model.latencyMs?.p50), note: model.samples > 0 ? "Output speed unmeasured" : "" });
  }
  function costCell(model, dearest) {
    if (model.costUsd?.count > 0 && finite(model.costUsd.mean)) {
      const unreported = Number(model.usage?.costUsd?.unknownRecords) || 0;
      return metric(money(model.costUsd.mean), dearest > 0 ? model.costUsd.mean / dearest : null, { note: unreported ? `${callCount(unreported)} unreported` : "per call" });
    }
    return model.samples > 0 ? metric("Unknown", null, { quiet: true, note: "Not reported by the provider" }) : metric("Unmeasured", null, { quiet: true });
  }
  function errorsCell(model) {
    if (!(model.samples > 0)) return metric("Unmeasured", null, { quiet: true });
    if (!finite(model.errorRate)) return metric(`${number(model.errors)} / ${number(model.samples)}`, null, { note: "No finished calls" });
    return metric(`${number(model.errorRate * 100, 1)}%`, model.errorRate, { tone: model.errors ? "is-bad" : "", note: `${number(model.errors)} of ${callCount(model.samples)} failed` });
  }
  function ratingCell(value, tone = "") {
    return value?.count > 0 && finite(value.mean) ? metric(quality(value), value.mean / 5, { tone }) : metric(quality(value), null, { quiet: true });
  }
  // Your ratings and a model judge's, one line each and never averaged.
  function ratingsCell(model) {
    const cell = element("div", "lab-ratings");
    for (const [who, value, tone] of [["You", model.quality?.human, ""], ["Model", model.quality?.model, "is-judge"]]) {
      const line = element("div", "lab-rating-line");
      line.append(element("span", "lab-rating-who", who), ratingCell(value, tone));
      cell.append(line);
    }
    return cell;
  }
  // Verified task wins, with the win chance as the bar; nothing verified yet
  // reads as a quiet line.
  function winsCell(model) {
    if (!((model.wins || 0) + (model.losses || 0))) return metric(verdicts(model), null, { quiet: true });
    return metric(`${number(model.wins)} won / ${number(model.losses)} lost`, finite(model.winProbability) ? model.winProbability : null, { note: finite(model.winProbability) ? `${number(model.winProbability * 100)}% win chance` : "" });
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
  // The KPI row. Before the first call each tile says what will fill it
  // instead of showing a row of zeros.
  function renderSummary(snapshot) {
    const totals = $("summary"); if (!totals) return;
    const models = rows(snapshot.models);
    const calls = finite(snapshot.calls) ? snapshot.calls : models.reduce((sum, model) => sum + (model.samples || 0), 0);
    const observed = models.filter((model) => model.samples > 0);
    const ranked = observed.filter((model) => model.rank != null).length;
    const errors = models.reduce((sum, model) => sum + (model.errors || 0), 0);
    const finished = models.reduce((sum, model) => sum + (model.successes || 0) + (model.errors || 0), 0);
    // The ledger's own median: the lower middle of the recent successful calls.
    const times = rows(snapshot.recent).filter((call) => ["ok", "success"].includes(call.status) && finite(call.elapsedMs)).map((call) => call.elapsedMs).sort((a, b) => a - b);
    const median = times.length ? times[Math.ceil(times.length / 2) - 1] : null;
    const cost = snapshot.usage?.costUsd;
    const unreported = Math.max(0, Number(cost?.unknownRecords) || 0);
    const since = new Date(snapshot.range?.from ?? NaN);
    const tiles = calls > 0 ? [
      ["Recorded calls", number(calls), Number.isFinite(since.getTime()) ? `since ${since.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "on this computer"],
      ["Models observed", number(observed.length), ranked ? `${number(ranked)} ranked` : "none ranked yet"],
      ["Error rate", finished ? `${number((errors / finished) * 100, 1)}%` : "—", finished ? `${number(errors)} of ${number(finished)} finished calls` : "no finished calls yet", finished ? errors / finished : null],
      ["Median response", median !== null ? duration(median) : "—", median !== null ? `last ${callCount(times.length)} that succeeded` : "no successful calls yet"],
      ["Recorded cost", cost && finite(cost.known) ? money(cost.known) : "Unknown", unreported ? `${callCount(unreported)} did not report cost` : `across ${callCount(calls)}`],
    ] : [
      ["Recorded calls", "No calls yet", "Studio counts every model call it makes"],
      ["Models observed", "None yet", "A model appears after its first call"],
      ["Error rate", "—", "Nothing to count yet"],
      ["Median response", "—", "Measured on successful calls"],
      ["Recorded cost", "—", "Counted when a provider reports it"],
    ];
    totals.dataset.empty = String(!(calls > 0));
    totals.replaceChildren(...tiles.map(([label, value, note, share]) => {
      const tile = element("div", calls > 0 && value !== "—" ? "lab-stat" : "lab-stat is-empty");
      tile.append(element("span", "", label), element("strong", "", value), element("small", "", note));
      if (finite(share)) tile.append(bar(share, errors ? "is-bad" : ""));
      return tile;
    }));
  }
  // Before any call is measured, one card says how the leaderboard fills in.
  function emptyRanking(target) {
    const box = element("div", "lab-empty lab-empty-ranking");
    const art = element("span", "lab-empty-art"); art.setAttribute("aria-hidden", "true"); art.append(element("i"), element("i"), element("i"));
    const text = element("div", "lab-empty-text");
    const steps = element("ol", "lab-steps");
    for (const [title, detail] of [
      ["Use a model", "Chats, plans and builds record each call's response time, cost and errors on this computer."],
      ["Rate what you reviewed", "Score finished results under Rate recent work. Your score stays separate from model judging."],
      ["See the ranking", "Measured models are ranked on the same evidence. Anything not measured stays unknown."],
    ]) { const step = element("li"); step.append(element("strong", "", title), element("span", "", detail)); steps.append(step); }
    text.append(element("h3", "", "Your results will build the ranking"), element("p", "", "Studio has no measured calls for this selection yet. Unmeasured models are not treated as fast, free, or reliable."), steps);
    box.append(art, text);
    target.replaceChildren(box);
  }
  function renderRankings(snapshot) {
    const models = rows(snapshot.models);
    const target = $("ranking-list");
    const measured = models.some((model) => model.samples > 0);
    if (!measured) emptyRanking(target);
    else {
      // Bars share one scale per column: the fastest output speed and the
      // highest cost per call are full length; errors and ratings use their
      // own fixed ranges (0-100%, 0-5).
      const fastest = Math.max(0, ...models.map((model) => (finite(model.throughput?.p50) ? model.throughput.p50 : 0)));
      const dearest = Math.max(0, ...models.map((model) => (model.costUsd?.count > 0 && finite(model.costUsd.mean) ? model.costUsd.mean : 0)));
      const col = "lab-col-metric";
      target.replaceChildren(table([["Rank", "lab-col-rank"], ["Model", "lab-col-model"], ["Score", col], ["Speed", col], ["Cost / call", col], ["Errors", col], ["Task wins", col], ["Ratings", "lab-col-ratings"]], models, (model) => [
        rankCell(model), modelName(model),
        model.rank != null && finite(model.score) ? metric(`${number(model.score, 1)} / 100`, model.score / 100) : metric("Not ranked", null, { quiet: true }),
        speedCell(model, fastest), costCell(model, dearest), errorsCell(model), winsCell(model), ratingsCell(model),
      ]));
    }
    const notes = rows(snapshot.ranking?.notes).filter((note) => typeof note === "string");
    const metrics = rows(snapshot.ranking?.metrics).map((key) => key === "speed" ? "response time" : key === "quality" ? `${snapshot.ranking.qualitySource || "human"} ratings` : key);
    $("ranking-notes").textContent = `${metrics.length ? `Rank uses ${metrics.join(", ")}. ` : ""}${notes.join(" ") || "Rank reflects available evidence. Human and model ratings stay separate; missing measurements remain unknown."}`;
    // The empty card already explains the ranking; the footnote waits for rows.
    $("ranking-notes").hidden = !measured;
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
      return [when(call.at), name, call.status === "ok" ? "Completed" : call.status || "Unknown", `${call.requestedEffort || "Default"} requested · ${call.appliedEffort ? `${call.appliedEffort} confirmed` : "provider confirmation unavailable"}`, duration(call.elapsedMs), finite(call.tokenUsage?.inputTokens) || finite(call.tokenUsage?.outputTokens) ? `${number(call.tokenUsage?.inputTokens)} / ${number(call.tokenUsage?.outputTokens)}` : "Not reported"];
    }));
  }
  function renderRecent(snapshot) {
    const target = $("recent"); target.replaceChildren();
    const recent = rows(snapshot.recent).filter((call) => ["success", "ok"].includes(call.status)).slice(0, 12);
    // The fold's heading says how much is waiting, so it can stay folded.
    const count = $("rate-count");
    if (count) {
      const unrated = recent.filter((call) => !rows(call.ratings?.human).length).length;
      count.hidden = !recent.length;
      count.textContent = !recent.length ? "" : unrated ? `${number(unrated)} to rate` : "All rated";
    }
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
        } catch (error) { status.textContent = plain(error, "The rating could not be saved."); button.disabled = false; }
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
    paintTypes();
  }
  // The task types as a row of pressed buttons over the hidden select. The
  // row is rebuilt only when the set of types changes, so a click keeps focus.
  const typeLabel = (type) => { const text = String(type).replace(/[-_]+/g, " "); return text.charAt(0).toUpperCase() + text.slice(1); };
  function paintTypes() {
    const group = $("task-types"), filter = $("task-type");
    if (!group || !filter) return;
    const types = [...state.types].sort();
    const key = JSON.stringify(types);
    if (state.typesKey !== key) {
      state.typesKey = key;
      const choice = (value, label) => {
        const button = element("button", "", label); button.type = "button"; button.dataset.value = value;
        button.addEventListener("click", () => { if (filter.value === value) return; filter.value = value; paintTypes(); refresh(); });
        return button;
      };
      group.replaceChildren(choice("", "All"), ...types.map((type) => choice(type, typeLabel(type))));
    }
    for (const button of Array.from(group.children || [])) button.setAttribute("aria-pressed", String((button.dataset?.value ?? "") === filter.value));
    if ($("task-filter")) $("task-filter").hidden = !types.length;
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
    } catch (error) { if (token === state.read) $("status").textContent = plain(error, "Model measurements could not be read."); }
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
      // Leave out what the preview did not report rather than print "Unknown".
      const budget = finite(result.budgetTokens) ? result.budgetTokens : Number($("context-budget")?.value) || null;
      const weight = finite(result.estimatedTokens) ? `${number(result.estimatedTokens)} estimated tokens` : "";
      $("context-status").textContent = [weight && budget ? `${weight} of a ${number(budget)} token budget` : weight || (budget ? `${number(budget)} token budget` : ""), result.truncated ? "some source text is excluded from this preview; saved originals are retained" : ""].filter(Boolean).join(" · ");
      for (const section of rows(result.sections)) {
        const fold = element("details", `lab-context-source${section.included ? "" : " excluded"}`); fold.open = section.included === true;
        const summary = element("summary", "", `${section.label || section.kind || "Context"} · ${number(section.estimatedTokens)} tokens · ${section.included ? "included" : "excluded"}`);
        fold.append(summary);
        if (section.reason) fold.append(element("p", "muted", section.reason));
        if (section.text) fold.append(element("pre", "", section.text));
        target.append(fold);
      }
      if (!rows(result.sections).length) empty(target, "No saved context here yet", "A task brief, references and handoff will appear when they have been saved.");
    } catch (error) { if (token === state.contextRead) { $("context-status").textContent = plain(error, "The context could not be read."); $("context-sections").replaceChildren(); } }
    finally { if (token === state.contextRead) $("context-refresh").disabled = false; }
  }
  function show(view) {
    if (!["rankings", "usage", "context", "tracker", "community", "compare"].includes(view)) view = "rankings";
    state.view = view;
    for (const name of ["rankings", "usage", "context", "tracker", "community", "compare"]) {
      $(name).hidden = name !== view;
      $(`tab-${name}`).setAttribute("aria-selected", String(name === view));
      $(`tab-${name}`).tabIndex = name === view ? 0 : -1;
    }
    if ($("lede") && LEDES[view]) $("lede").textContent = LEDES[view];
    const usageSwitch = $("usage-switch");
    if (usageSwitch) usageSwitch.hidden = !["usage", "tracker"].includes(view);
    for (const [id, target] of [["recorded", "usage"], ["accounts", "tracker"]]) {
      $(id)?.setAttribute("aria-selected", String(view === target));
      if ($(id)) $(id).tabIndex = view === target ? 0 : -1;
    }
    if ($("summary")) $("summary").hidden = view !== "rankings";
    window.dispatchEvent(new CustomEvent("mefi:model-view", { detail: { view } }));
    if (view === "tracker") window.MefiUsageTracker?.refresh?.();
    if (view === "community") window.MefiModelCommunity?.open?.();
    if (view === "context") loadTasks().then((fresh) => { if (fresh) return previewContext(); }).catch((error) => { $("context-status").textContent = plain(error, "Tasks could not be read."); });
  }
  function init() {
    if (state.initialized || !document.getElementById("model-lab")) return;
    state.initialized = true;
    const views = ["rankings", "usage", "context", "tracker", "community", "compare"];
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
    $("task-type").addEventListener("change", () => { paintTypes(); refresh(); });
    $("context-refresh").addEventListener("click", previewContext);
    $("context-task").addEventListener("change", previewContext);
    $("context-budget").addEventListener("change", previewContext);
    window.addEventListener("mefi:project-changed", () => {
      state.contextRead += 1; state.taskRead += 1; state.read += 1; state.at = 0; state.tasks = []; state.snapshot = null; state.types.clear();
      // A read cut off by this switch no longer owns the button (its finally
      // checks the token just bumped), so it is released here.
      $("refresh").disabled = false;
      $("task-type").value = ""; paintTypes();
      $("context-task").value = ""; $("context-sections").replaceChildren();
      if (!document.getElementById("tab-graph")?.hidden) { refresh(); if (state.view === "context") show("context"); }
    });
  }
  function open() { init(); if (state.initialized && Date.now() - state.at > 5000) refresh(); }
  window.MefiModelLab = { open, refresh, show, view: () => state.view };
})();
