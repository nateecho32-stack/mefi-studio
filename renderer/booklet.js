// Mefi's Studio AI+ — booklet renderer, filters, refresh-on-open, studio launcher UI.
(function () {
  "use strict";
  const { fmt, privacyLabel } = window.MefiGraph;
  // Tell the Start here walkthrough that a provider connection was saved. Only
  // a successful save announces; a failed or cancelled save must not advance it.
  // A save is not always a connection: clearing a key, or a key that only
  // feeds Jev, announces too, so the detail says what the host found after
  // the save - `routeOk` true when an assistant route can answer now (false
  // when none can, null when the host did not say) - and `cleared` when the
  // save removed a key.
  const noteConnectionSaved = (which, result = null, cleared = false) => {
    const routeOk = typeof result?.routeOk === "boolean" ? result.routeOk : null;
    try { if (typeof CustomEvent === "function" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent("mefi:connection-saved", { detail: { provider: which || null, routeOk, cleared: cleared === true } })); } catch {}
  };

  // Global toasts: quiet confirmations that do not need a panel status line.
  window.MefiToast = (message, kind = "info", options = {}) => {
    let host = document.getElementById("toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      document.body.append(host);
    }
    const toast = document.createElement("div");
    toast.className = `toast ${kind}`;
    toast.textContent = message;
    let timer = null;
    let gone = false;
    const dismiss = () => {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
      options?.onDismiss?.();
    };
    // An action keeps the toast clickable and on screen long enough to use it;
    // an error stays long enough to read; hovering any interactive toast holds it.
    const action = options?.action;
    if (action && typeof action.run === "function") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toast-action";
      button.textContent = action.label || "Open";
      button.addEventListener("click", () => { action.run(); dismiss(); });
      toast.classList.add("has-action");
      toast.append(button);
      const secondary = options?.secondary;
      if (secondary?.label) {
        const second = document.createElement("button");
        second.type = "button";
        second.className = "toast-action secondary";
        second.textContent = secondary.label;
        second.addEventListener("click", () => { secondary.run?.(); dismiss(); });
        toast.append(second);
      }
    }
    const lasting = kind === "bad" || kind === "warn";
    if (lasting) toast.style.pointerEvents = "auto";
    // An interactive or lasting toast can be closed on purpose: a × for the
    // pointer, Esc for the keyboard, and focus inside it holds it like a hover.
    if (toast.classList.contains?.("has-action") || lasting) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "toast-dismiss";
      close.textContent = "×";
      close.title = "Dismiss (Esc)";
      close.setAttribute?.("aria-label", "Dismiss");
      close.addEventListener("click", dismiss);
      toast.append(close);
    }
    const life = Number(options?.duration) || (action ? 9000 : lasting ? 7000 : 2600);
    const arm = (ms) => { clearTimeout(timer); timer = setTimeout(dismiss, ms); };
    toast.addEventListener("mouseenter", () => clearTimeout(timer));
    toast.addEventListener("mouseleave", () => arm(Math.max(1500, life / 3)));
    toast.addEventListener("focusin", () => clearTimeout(timer));
    toast.addEventListener("focusout", () => arm(Math.max(1500, life / 3)));
    toast.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault?.();
      event.stopPropagation?.();
      dismiss();
    });
    host.append(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    arm(life);
    return { dismiss, element: toast };
  };

  // A question with one committing button, in the same toast host. Resolves
  // true when the button is pressed and false when the toast times out or is
  // dismissed. This replaces window.confirm (an unstyled OS modal) for the few
  // destructive actions: clearing the done log, removing or switching a project.
  window.MefiConfirm = (message, options = {}) => new Promise((resolve) => {
    let settled = false;
    const settle = (value) => { if (!settled) { settled = true; resolve(value); } };
    if (typeof window.MefiToast !== "function") { settle(false); return; }
    // Keyboard reach: the committing button takes focus once the toast shows,
    // Cancel (or Esc) answers no, and focus goes back where it came from.
    const opener = document.activeElement ?? null;
    const restore = () => {
      if (opener && opener !== document.body && opener.isConnected !== false) opener.focus?.({ preventScroll: true });
    };
    let handle = null;
    handle = window.MefiToast(message, options.kind || "info", {
      duration: Number(options.duration) || 12000,
      action: { label: options.label || "Confirm", run: () => { settle(true); restore(); } },
      secondary: { label: options.cancelLabel || "Cancel", run: () => { settle(false); restore(); } },
      onDismiss: () => {
        settle(false);
        if (handle?.element?.contains?.(document.activeElement)) restore();
      },
    });
    requestAnimationFrame(() => handle?.element?.querySelector?.(".toast-action")?.focus?.({ preventScroll: true }));
  });

  // Every store access is guarded, exactly as nav.js and idle.js guard theirs: a
  // blocked or private store throws on read, and an unguarded throw here would
  // abort this module before window.MefiBooklet is defined.
  const readStore = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const writeStore = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage blocked — the preference simply does not persist */
    }
  };

  const baked = JSON.parse(document.getElementById("booklet-data").textContent);
  const state = {
    doc: baked,
    search: "",
    filters: new Set(),
    sort: "quality",
    graph: null,
    source: "baked",
    speeds: {},
    studioInitialized: false,
  };
  let cardCache = new WeakMap();
  let searchCache = new WeakMap();
  let cardFrame = null;
  let renderedCardMarkup = null;

  const els = {
    status: document.getElementById("status"),
    banner: document.getElementById("banner"),
    plan: document.getElementById("plan-strip"),
    picks: document.getElementById("catalog-picks"),
    head: document.getElementById("catalog-head"),
    search: document.getElementById("search"),
    chips: document.getElementById("chips"),
    sort: document.getElementById("sort"),
    cards: document.getElementById("cards"),
    count: document.getElementById("count"),
    footer: document.getElementById("footer-meta"),
    alsoTracked: document.getElementById("also-tracked"),
    alsoTrackedBody: document.getElementById("also-tracked-body"),
    banner2: null,
  };

  const FILTERS = [
    { id: "listed", label: "Documented", test: (m) => m.listed },
    { id: "roster", label: "Roster-only", test: (m) => m.onRoster && !m.listed },
    { id: "legacy", label: "Legacy", test: (m) => m.legacy },
    { id: "free", label: "Free / ∞", test: (m) => m.usage?.unlimited || m.pricing?.default?.input === 0 },
    { id: "premium", label: "Small pool ($15)", test: (m) => m.usage?.monthlyCapUSD === 15 },
    { id: "vision", label: "Vision", test: (m) => (m.capabilities?.modalities?.input ?? []).includes("image") },
    { id: "bench", label: "Benchmarked", test: (m) => m.quality?.index != null },
    { id: "trains", label: "Trains on data", test: (m) => m.privacy?.training === true },
  ];

  function showBanner(message, isError) {
    els.banner.textContent = message;
    els.banner.classList.toggle("error", Boolean(isError));
    els.banner.hidden = false;
  }

  // Catalog text is fetched (models.dev names, roster ids), so every data
  // field is escaped before it reaches innerHTML.
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
  // A stored moment as local text, or "" when it is missing or unreadable.
  const dateText = (value) => { const date = new Date(value ?? NaN); return Number.isFinite(date.getTime()) ? date.toLocaleString() : ""; };

  function badgeHtml(model) {
    const badges = [];
    if (model.usage?.unlimited) badges.push('<span class="badge free">free ∞</span>');
    else if (model.pricing?.default?.input === 0) badges.push('<span class="badge free">free</span>');
    if (model.usage?.monthlyCapUSD === 15) badges.push('<span class="badge premium">$15 pool</span>');
    if (model.usage?.promo) badges.push(`<span class="badge new">${esc(model.usage.promo)}</span>`);
    if (model.legacy) badges.push('<span class="badge legacy">legacy</span>');
    if (model.experimental) badges.push('<span class="badge new">experimental</span>');
    if (model.privacy?.training) badges.push('<span class="badge trains">trains</span>');
    const released = model.releaseDate ? Date.parse(model.releaseDate) : NaN;
    if (!model.legacy && !Number.isNaN(released) && Date.now() - released < 1000 * 60 * 60 * 24 * 90) badges.push('<span class="badge new">new</span>');
    return badges.join("");
  }

  function statHtml(key, value, sub) {
    return `<div class="stat"><div class="k">${esc(key)}</div><div class="v">${esc(value)}</div><div class="s">${esc(sub)}</div></div>`;
  }

  // The quality bar runs from zero to the catalog's best index rounded up to
  // the next ten, so every bar starts at zero and bars compare within this
  // catalog. Worked out once per catalog document.
  const qualityScales = new WeakMap();
  const qualityOf = (model) => (typeof model.quality?.index === "number" && Number.isFinite(model.quality.index) ? model.quality.index : null);
  function qualityScale(doc = state.doc) {
    if (!qualityScales.has(doc)) {
      const top = Math.max(0, ...doc.models.map((model) => qualityOf(model) ?? 0));
      qualityScales.set(doc, top > 0 ? Math.ceil(top / 10) * 10 : 100);
    }
    return qualityScales.get(doc);
  }
  function qualityCell(model) {
    const index = qualityOf(model);
    if (index === null) return `<span class="catalog-cell catalog-quality" title="No published quality index"><small>Quality</small><b>${esc(model.quality?.index ?? "—")}</b></span>`;
    const scale = qualityScale();
    const share = Math.max(0, Math.min(100, (index / scale) * 100));
    const version = model.quality?.declared === "AA" && model.quality.indexVersion ? ` (${model.quality.indexVersion})` : "";
    const title = `${index} on the Artificial Analysis Intelligence Index${version}. The bar runs from 0 to ${scale}.`;
    return `<span class="catalog-cell catalog-quality" title="${esc(title)}"><small>Quality</small><b>${esc(index)}</b><span class="catalog-bar" style="--v:${share.toFixed(1)}%" aria-hidden="true"><i></i></span></span>`;
  }

  // One row of the comparison table: the summary holds the columns the header
  // names (each cell keeps its own label for screen readers, narrow windows and
  // print), and the fold below it holds the full card.
  function cardHtml(model) {
    const price = model.pricing?.default;
    const requests = model.usage?.requests;
    const req5 = requests?.h5 === "unlimited" ? "∞" : requests?.h5 != null ? fmt.int(requests.h5) : "—";
    const pool = model.usage?.monthlyCapUSD === "unlimited" ? "∞" : model.usage?.monthlyCapUSD != null ? "$" + model.usage.monthlyCapUSD + "/mo" : "—";
    const variantRows = (model.variants ?? [])
      .map(
        (v) => `<tr><td>${esc(v.condition)}</td><td class="num">${fmt.money(v.input)}</td><td class="num">${fmt.money(v.output)}</td><td class="num">${v.cacheRead != null ? fmt.money(v.cacheRead) : "—"}</td></tr>`
      )
      .join("");
    const benchmarks = (model.quality?.benchmarks ?? []).map((b) => `<li>${esc(b)}</li>`).join("");
    const modalities = esc(model.capabilities?.modalities?.input?.join(" + ") ?? "—");
    return `<article class="card catalog-row" data-id="${esc(model.id)}">
      <details class="catalog-model"><summary class="catalog-summary">
      <div class="catalog-name">
        <div class="catalog-title"><h3>${esc(model.name)}</h3><span class="badges">${badgeHtml(model)}</span></div>
        <div class="vendor">${esc(model.vendor)} · opencode-go/${esc(model.id)}</div>
      </div>
      ${qualityCell(model)}
      <span class="catalog-cell"><small>Cost / request</small><b>${fmt.money(model.typicalCostUSD)}</b></span>
      <span class="catalog-cell"><small>Requests / 5h</small><b>${esc(req5)}</b></span>
      <span class="catalog-cell"><small>Context</small><b>${esc(fmt.ctx(model.limits?.context))}</b></span>
      <span class="catalog-expand" aria-hidden="true">⌄</span></summary>
      <div class="catalog-body">
      <p class="verdict">${esc(model.verdict ?? "No curated verdict yet.")}</p>
      <div class="stat-grid">
        ${statHtml("$ / request", fmt.money(model.typicalCostUSD), "typical mix")}
        ${statHtml("Quality", model.quality?.index ?? "—", model.quality?.declared === "AA" ? `AA II ${model.quality.indexVersion ?? ""}`.trim() : "unmeasured")}
        ${statHtml("Requests / 5h", req5, pool)}
        ${statHtml("Context", fmt.ctx(model.limits?.context), model.limits?.output ? fmt.ctx(model.limits.output) + " out" : "")}
        ${statHtml("Privacy", model.privacy?.training ? "trains" : model.privacy?.retentionDays === 0 ? "0-day" : model.privacy?.retentionDays != null ? model.privacy.retentionDays + "d" : "—", "retention")}
        ${statHtml("$/1M", price ? fmt.money(price.input) + " in" : "—", price ? fmt.money(price.output) + " out" : "")}
      </div>
      <div class="use-avoid">
        ${(model.useFor ?? []).map((u) => `<span>${esc(u)}</span>`).join("")}
        ${(model.avoidFor ?? []).map((a) => `<span class="avoid">${esc(a)}</span>`).join("")}
      </div>
      <details>
        <summary>All specifications</summary>
        <table class="detail">
          <tr><th>Standard price</th><td class="num">${price ? fmt.money(price.input) + " in / " + fmt.money(price.output) + " out / " + fmt.money(price.cacheRead) + " cached" : "—"}</td></tr>
          ${variantRows ? `<tr><th>Variants</th><td class="num"><table class="detail"><tr><th>Condition</th><th class="num">In</th><th class="num">Out</th><th class="num">Cached</th></tr>${variantRows}</table></td></tr>` : ""}
          <tr><th>Requests</th><td>${requests ? `5h ${fmt.int(requests.h5)} · week ${fmt.int(requests.week)} · month ${fmt.int(requests.month)}` : "—"}</td></tr>
          <tr><th>Privacy</th><td>${esc(privacyLabel(model))}${model.privacy?.note ? " — " + esc(model.privacy.note) : ""}</td></tr>
          <tr><th>Input</th><td>${modalities}</td></tr>
          <tr><th>Endpoint</th><td>${model.endpoint ? esc(model.endpoint.label) + " · " + esc(model.endpoint.sdk) : "—"}</td></tr>
          <tr><th>Tools / reasoning</th><td>${model.capabilities?.toolCall === false ? "no" : "yes"} / ${model.capabilities?.reasoning === false ? "no" : "yes"}</td></tr>
          ${benchmarks ? `<tr><th>Benchmarks</th><td><ul>${benchmarks}</ul></td></tr>` : ""}
          <tr><th>Released</th><td>${esc(model.releaseDate ?? "—")}${model.knowledge ? " · knowledge " + esc(model.knowledge) : ""}</td></tr>
          ${state.speeds[model.id] ? `<tr><th>Measured</th><td>${[`${state.speeds[model.id].tokensPerSecond ?? "—"} t/s`, dateText(state.speeds[model.id].measuredAt)].filter(Boolean).join(" · ")} · measured on your machine</td></tr>` : ""}
        </table>
      </details>
      </div></details>
    </article>`;
  }

  function visibleModels() {
    const query = state.search.trim().toLowerCase();
    let models = state.doc.models.filter((model) => {
      for (const id of state.filters) {
        const filter = FILTERS.find((f) => f.id === id);
        if (filter && !filter.test(model)) return false;
      }
      if (!query) return true;
      if (!searchCache.has(model)) searchCache.set(model, [model.name, model.vendor, model.id, model.verdict, ...(model.tags ?? [])].join(" ").toLowerCase());
      return searchCache.get(model).includes(query);
    });
    const num = (v) => (v == null ? -Infinity : typeof v === "number" ? v : v === "unlimited" ? Infinity : -Infinity);
    const requestCost = (model) => model.typicalCostUSD ?? (model.pricing?.default?.input === 0 ? 0 : Infinity);
    const sorters = {
      quality: (a, b) => num(b.quality?.index) - num(a.quality?.index) || a.name.localeCompare(b.name),
      // A free model with no typical request cost leads; an unknown cost trails
      // instead of passing for free.
      cost: (a, b) => num(requestCost(a)) - num(requestCost(b)) || a.name.localeCompare(b.name),
      speed: (a, b) => num(b.usage?.requests?.h5) - num(a.usage?.requests?.h5) || a.name.localeCompare(b.name),
      context: (a, b) => num(b.limits?.context) - num(a.limits?.context) || a.name.localeCompare(b.name),
      pool: (a, b) => num(b.usage?.monthlyCapUSD) - num(a.usage?.monthlyCapUSD) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    models = models.sort(sorters[state.sort] ?? sorters.name);
    return models;
  }

  // Native toggle buttons, so Tab, Enter and Space reach every filter.
  function renderChips() {
    els.chips.innerHTML = FILTERS.map((f) => `<button type="button" class="chip ${state.filters.has(f.id) ? "on" : ""}" data-id="${f.id}" aria-pressed="${state.filters.has(f.id)}">${f.label}</button>`).join("");
  }

  // The plan is context for the prices, not a headline: one quiet line.
  function renderPlan() {
    const plan = state.doc.plan;
    els.plan.hidden = !plan;
    if (!plan) return;
    const share = plan.windowFractionOfMonthly ?? {};
    const pct = (value, fallback) => `${Math.round((typeof value === "number" && Number.isFinite(value) ? value : fallback) * 100)}%`;
    els.plan.innerHTML = `<span><b>${esc(plan.name)}</b> ${fmt.money(plan.priceUSDMonth)} / month</span>`
      + `<span>Plan limits ${fmt.money(plan.window5hUSD)} per 5 hours · ${fmt.money(plan.weekUSD)} per week · ${fmt.money(plan.monthUSD)} per month</span>`
      + `<span>Each model's own pool: 5h ${pct(share["5h"], 0.2)} · week ${pct(share.week, 0.5)} · month ${pct(share.month, 1)}</span>`;
  }

  // Also tracked: the models Studio routes to outside Go (providerModels,
  // rebuilt from models.dev). Read-only, and built with textContent so no
  // catalog string ever reaches innerHTML.
  const ROUTE_LABELS = { claude: "Claude Code", zen: "OpenCode Zen", zai: "z.ai Coding Plan" };
  let alsoTrackedDoc = null;
  function renderAlsoTracked() {
    const box = els.alsoTracked, body = els.alsoTrackedBody;
    if (!box || !body || alsoTrackedDoc === state.doc) return;
    alsoTrackedDoc = state.doc;
    const routes = Object.entries(state.doc.providerModels ?? {}).filter(([, rows]) => Array.isArray(rows) && rows.length);
    box.hidden = !routes.length;
    const node = (tag, text, className) => {
      const el = document.createElement(tag);
      if (text != null) el.textContent = String(text);
      if (className) el.className = className;
      return el;
    };
    const price = (cost) => (cost && cost.input != null && cost.output != null ? `${fmt.money(cost.input)} in / ${fmt.money(cost.output)} out` : "—");
    const parts = [];
    for (const [route, rows] of routes) {
      parts.push(node("h3", `${ROUTE_LABELS[route] ?? route} · ${rows.length}`));
      const table = node("table", null, "lab-table");
      const head = node("tr");
      for (const label of ["Model", "Released", "Context", "List price / 1M"]) head.append(node("th", label));
      table.append(head);
      for (const row of rows) {
        const name = node("td", row.name ?? row.id);
        name.title = String(row.id ?? "");
        const tr = node("tr");
        tr.append(name, node("td", row.releaseDate ?? "—"), node("td", fmt.ctx(row.limits?.context)), node("td", price(row.cost)));
        table.append(tr);
      }
      const wrap = node("div", null, "lab-table-wrap");
      wrap.append(table);
      parts.push(wrap);
    }
    body.replaceChildren(...parts);
  }

  // One line under the page title: how many, how fresh, from where. The hash
  // stays on hover and in the footer.
  function renderStatus() {
    const doc = state.doc;
    const roster = doc.models.filter((m) => m.onRoster).length;
    const built = new Date(doc.generatedAt ?? NaN);
    const when = Number.isFinite(built.getTime()) ? built.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
    const source = state.source === "baked" ? "built-in data" : `the ${state.source}`;
    els.status.textContent = `${doc.models.length} models · ${roster} live${when ? ` · updated ${when}` : ""} · from ${source}`;
    els.status.title = `Catalog hash ${doc.hash.slice(0, 8)}`;
    els.footer.textContent = `catalog hash ${doc.hash.slice(0, 12)} · roster ${doc.rosterHash.slice(0, 12)}`;
  }

  // Picks: four highlights worked out from the catalog itself, legacy models
  // left out, so their numbers always agree with the rows. They follow the
  // whole catalog rather than the filters and repaint only with a new document.
  let picksDoc = null;
  const releasedAt = (model) => { const at = Date.parse(model.releaseDate ?? ""); return Number.isNaN(at) ? null : at; };
  function pickBest(models, score) {
    let best = null, top = -Infinity;
    for (const model of models) {
      const value = score(model);
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (value > top || (value === top && String(model.name).localeCompare(String(best.name)) < 0)) { best = model; top = value; }
    }
    return best;
  }
  function renderPicks() {
    if (!els.picks || picksDoc === state.doc) return;
    picksDoc = state.doc;
    const models = state.doc.models.filter((model) => !model.legacy);
    const cost = (model) => (typeof model.typicalCostUSD === "number" && model.typicalCostUSD > 0 ? model.typicalCostUSD : null);
    const context = (model) => { const value = model.limits?.context; return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null; };
    const released = (at) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    const ago = (at) => { const days = Math.max(0, Math.round((Date.now() - at) / 86400000)); return days === 0 ? "released today" : days === 1 ? "released yesterday" : `released ${days} days ago`; };
    const picks = [
      { key: "quality", label: "Top quality", model: pickBest(models, qualityOf), value: (m) => [qualityOf(m), "AA index"], note: (m) => `${m.vendor} · ${fmt.money(m.typicalCostUSD)} / request` },
      { key: "value", label: "Best value", model: pickBest(models, (m) => (qualityOf(m) !== null && cost(m) !== null ? qualityOf(m) / cost(m) : null)), value: (m) => [fmt.money(m.typicalCostUSD), "/ request"], note: (m) => `Quality ${qualityOf(m)} · ${m.privacy?.training ? "trains on your prompts" : "lowest cost per point"}` },
      { key: "context", label: "Biggest context", model: pickBest(models, context), value: (m) => [fmt.ctx(context(m)), "tokens"], note: (m) => `${m.vendor} · ${fmt.int(context(m))} tokens` },
      { key: "newest", label: "Newest", model: pickBest(models, releasedAt), value: (m) => [released(releasedAt(m)), ""], note: (m) => `${m.vendor} · ${ago(releasedAt(m))}` },
    ].filter((pick) => pick.model);
    els.picks.hidden = picks.length < 2;
    els.picks.innerHTML = picks.map((pick) => {
      const [value, unit] = pick.value(pick.model);
      return `<button type="button" class="catalog-pick" data-pick="${pick.key}" data-id="${esc(pick.model.id)}" title="Show ${esc(pick.model.name)} in the table">`
        + `<span class="catalog-pick-label">${esc(pick.label)}</span><strong class="catalog-pick-name">${esc(pick.model.name)}</strong>`
        + `<span class="catalog-pick-value">${esc(value)}${unit ? ` <small>${esc(unit)}</small>` : ""}</span><span class="catalog-pick-note">${esc(pick.note(pick.model))}</span></button>`;
    }).join("");
  }

  // Opens a model's row in place, bringing it back first when a search or a
  // filter hides it, and moves focus to it.
  function revealModel(id) {
    const find = () => Array.from(els.cards.querySelectorAll?.(".catalog-row") ?? []).find((row) => row.dataset.id === id);
    let row = find();
    if (!row && (state.search || state.filters.size)) {
      state.search = ""; els.search.value = ""; state.filters.clear();
      renderChips(); renderCards(); row = find();
    }
    const fold = row?.querySelector(".catalog-model");
    if (!fold) return;
    fold.open = true;
    const still = document.body.classList.contains("no-motion") || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    row.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    fold.querySelector("summary")?.focus({ preventScroll: true });
    row.classList.remove("is-revealed");
    void row.offsetWidth;
    row.classList.add("is-revealed");
    setTimeout(() => row.classList.remove("is-revealed"), 1600);
  }

  // The column header doubles as the sort control; the Sort select stays the
  // one source of truth, so both always agree.
  function renderSortHead() {
    for (const button of els.head?.querySelectorAll?.("button[data-sort]") ?? []) {
      const on = button.dataset.sort === state.sort;
      button.setAttribute("aria-pressed", String(on));
      button.title = on ? "Sorted by this column" : `Sort by ${button.textContent.trim().toLowerCase()}`;
    }
  }

  function renderCards() {
    if (cardFrame !== null) { cancelAnimationFrame(cardFrame); cardFrame = null; }
    const models = visibleModels();
    // No match says what to change instead of leaving an empty grid.
    const markup = models.length ? models.map((model) => {
      if (!cardCache.has(model)) cardCache.set(model, cardHtml(model));
      return cardCache.get(model);
    }).join("") : `<p class="muted catalog-empty">${state.doc.models.length ? "No models match. Clear a filter or search for something shorter." : "The catalog has no models yet."}</p>`;
    // Keep expanded details and focus when a refresh returns identical data.
    if (renderedCardMarkup !== markup) {
      const expanded = new Set(Array.from(els.cards.querySelectorAll?.(".catalog-model[open]") ?? []).map((fold) => fold.closest("[data-id]").dataset.id));
      els.cards.innerHTML = markup;
      for (const fold of els.cards.querySelectorAll?.(".catalog-model") ?? []) fold.open = expanded.has(fold.closest("[data-id]").dataset.id);
      renderedCardMarkup = markup;
    }
    els.count.textContent = models.length === state.doc.models.length ? `All ${models.length} models shown` : `${models.length} of ${state.doc.models.length} models shown`;
  }

  function renderAll() {
    renderPlan();
    renderAlsoTracked();
    renderStatus();
    renderPicks();
    renderChips();
    renderSortHead();
    renderCards();
    if (state.graph) state.graph.redraw();
  }

  function applyDoc(doc, source) {
    state.doc = doc;
    state.source = source;
    cardCache = new WeakMap();
    searchCache = new WeakMap();
    state.graph?.setDoc?.(doc);
    if (state.studioInitialized) updateSpeedModels();
    renderAll();
    loadSpeeds().then((changed) => { if (changed) renderCards(); });
  }

  let speedsPending = null;
  let speedEpoch = 0;
  function loadSpeeds({ fresh = false } = {}) {
    if (fresh) { speedEpoch++; speedsPending = null; }
    if (speedsPending) return speedsPending;
    const pending = readSpeeds(speedEpoch).finally(() => { if (speedsPending === pending) speedsPending = null; });
    speedsPending = pending;
    return speedsPending;
  }
  async function readSpeeds(epoch) {
    let next;
    try {
      if (window.mefiStudio?.speedMeasurements) {
        const result = await window.mefiStudio.speedMeasurements();
        if (!result?.ok) return false;
        next = result.measurements ?? {};
      } else {
        const url = new URL("../data/speed-measurements.json", window.location.href).href;
        const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return false;
        next = await response.json();
      }
    } catch {
      return false;
    }
    if (epoch !== speedEpoch || JSON.stringify(state.speeds) === JSON.stringify(next)) return false;
    state.speeds = next;
    cardCache = new WeakMap();
    state.graph?.setSpeeds?.(state.speeds);
    return true;
  }

  // ---- refresh-on-open ----
  const DATA_URL = new URL("../data/models.json", window.location.href).href;

  async function liveDoc() {
    if (window.mefiStudio?.readCatalog) return { doc: await window.mefiStudio.readCatalog(), source: "live file" };
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return { doc: await response.json(), source: "live fetch" };
  }

  let refreshInFlight = null;
  let refreshEpoch = 0;
  function refresh(reason, { fresh = false } = {}) {
    if (refreshInFlight && !fresh) return refreshInFlight;
    const epoch = ++refreshEpoch;
    const pending = refreshDoc(reason, epoch).finally(() => { if (refreshInFlight === pending) refreshInFlight = null; });
    refreshInFlight = pending;
    return pending;
  }
  async function refreshDoc(reason, epoch) {
    try {
      const { doc, source } = await liveDoc();
      if (epoch !== refreshEpoch) return;
      if (doc.schemaVersion !== state.doc.schemaVersion) {
        window.location.reload();
        return;
      }
      if (doc.hash !== state.doc.hash) {
        applyDoc(doc, source);
        showBanner(`Catalog updated (${reason}): ${doc.models.length} models, hash ${doc.hash.slice(0, 8)}.`, false);
        window.MefiToast(`Catalog updated · ${doc.models.length} models`, "good");
      } else {
        state.source = source;
        els.banner.hidden = true;
        renderStatus();
      }
      writeStore("mefiStudio.lastRefresh", String(Date.now()));
    } catch (error) {
      if (epoch === refreshEpoch) showBanner(`Showing built-in data — live refresh failed (${error.message}).`, true);
    }
  }

  function staleHours() {
    const stamp = Number(readStore("mefiStudio.lastRefresh") || 0);
    return (Date.now() - stamp) / 3600000;
  }

  // ---- tabs ----
  // The page header names the tab on show; nav.js repaints it on mefi:nav, and
  // this covers the launch, which restores a tab without announcing it.
  const PAGE_TITLES = { booklet: "Model catalog", graph: "Performance", eyes: "Activity & evidence", studio: "Settings" };
  function showTab(name, params = {}) {
    if (name !== "studio") window.MefiMusic?.activateSettings?.(null);
    const insights = document.getElementById("model-lab-catalog");
    const catalog = document.getElementById("tab-booklet");
    if (insights && catalog && insights.parentElement !== catalog) {
      catalog.append(insights);
      insights.addEventListener("toggle", () => {
        if (!insights.open) return;
        if (!state.graph) state.graph = window.MefiGraph.mount(state.doc, { speeds: state.speeds });
        requestAnimationFrame(() => state.graph?.redraw());
      });
    }
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
    document.getElementById("tab-booklet").hidden = name !== "booklet";
    document.getElementById("tab-graph").hidden = name !== "graph";
    document.getElementById("tab-eyes").hidden = name !== "eyes";
    document.getElementById("tab-studio").hidden = name !== "studio";
    const title = document.getElementById("page-title");
    if (title) title.textContent = window.MefiNav?.get?.(name)?.label ?? PAGE_TITLES[name] ?? title.textContent;
    // The catalog's status line (models, data source, hash) is the catalog's.
    if (els.status) els.status.hidden = name !== "booklet";
    if (name === "graph") {
      if (!state.graph) state.graph = window.MefiGraph.mount(state.doc, { speeds: state.speeds });
      window.MefiModelLab?.open?.();
      requestAnimationFrame(() => state.graph.redraw());
    }
    if (name === "eyes") window.MefiEyes?.init();
    if (name === "studio") {
      // The first show checks Server Styler inside initStudio; later shows
      // check once here, since the poll skipped while another tab was up.
      const firstShow = !state.studioInitialized;
      initStudio();
      if (!firstShow) void refreshStyler?.();
      paintSettingsRows();
      syncSettingsNav();
      syncBlurBox();
      if (studioLogStale) paintStudioLog();
      // go("studio", { section: "settings-updates" }) lands on that card.
      if (params?.section || params?.category) jumpToSettings(params.section ?? params.category);
    }
    writeStore("mefiStudio.tab", name);
  }

  // ---- Settings: one category at a time, with direct control search ----
  const SETTINGS_CATEGORIES = {
    general: "General", appearance: "Appearance", connections: "Connections",
    models: "Models", automation: "Automation", audio: "Audio", system: "System",
  };
  const SETTINGS_ALIASES = {
    providers: "settings-assistant", preferences: "settings-studio", you: "settings-studio",
    "your-studio": "settings-studio", studio: "settings-studio", "decision-model": "settings-jev",
    "auto-setup": "settings-setup", "model-routing": "settings-routing", "coding-workers": "settings-workers",
    "connection-log": "settings-log", "server-styler": "settings-styler", music: "settings-category-audio",
    "agents-queue": "settings-automation",
  };
  let settingsCategory = SETTINGS_CATEGORIES[readStore("mefiStudio.settingsCategory")] ? readStore("mefiStudio.settingsCategory") : "general";

  // ---- Settings in the 0.5 layout: the prototype's places ----
  // With html[data-layout="v2"] Settings is filed the way the 0.5 prototype
  // files it (docs/prototype/mefi-studio-0.5-v5.html, SET_SUBS): General,
  // Notifications, Appearance with Size and density under it, Map look and
  // Sound and music; then Updates and help (Updates, Report a problem) and
  // Advanced (System). Nothing is copied. A place is a category pane, and the
  // cards that become places of their own move into theirs with their ids,
  // controls and host calls, so a deep link, a Search entry or the walkthrough
  // still lands on the same control. Map look is the Appearance pane at its
  // Nodes and Layout sections; Size and density is its own page
  // (renderer/size.js), so its row goes there. A category these places do not
  // name (Connections, Models and Automation, until renderer/agents.js takes
  // them to Agents › Setup) keeps its row at the end. The layout is chosen at
  // launch, so the filing runs once a page, and never with the layout off.
  // The prototype's Design system sheet has no counterpart in the app yet.
  const SETTINGS_PLACES = Object.freeze([
    { id: "general", label: "General", glyph: "g-studio", about: "Names, startup and community" },
    { id: "notifications", label: "Notifications", glyph: "g-bell", about: "Windows notifications while Studio is in the background, and quiet hours", cards: ["settings-notifications"] },
    { id: "appearance", label: "Appearance", glyph: "g-style", looks: ["themes", "interface"] },
    { id: "size", label: "Size and density", glyph: "g-textsize", route: "size", sub: true },
    { id: "looks", label: "Map look", glyph: "g-target", pane: "appearance", looks: ["nodes", "layout"] },
    { id: "audio", label: "Sound and music", glyph: "g-audio", about: "Sound effects, and the music and video the Map reacts to" },
    { id: "updates", label: "Updates", glyph: "g-update", group: "Updates and help", about: "Update, and go back to the build before if the new one misbehaves", cards: ["settings-updates"] },
    { id: "problem", label: "Report a problem", glyph: "g-flag", group: "Updates and help", cards: ["settings-report"] },
    { id: "system", label: "System", glyph: "g-gauge", group: "Advanced", about: "Diagnostics, and the optional projects Studio can start for you" },
  ]);
  let settingsFiled = false;
  const settingsLayoutV2 = () => document.documentElement?.dataset?.layout === "v2";
  const settingsPlace = (key) => (settingsFiled ? SETTINGS_PLACES.find((place) => place.id === key && !place.route) ?? null : null);
  // The pane a category shows: Map look is the Appearance pane.
  const settingsPane = (category) => settingsPlace(category)?.pane ?? category;
  function settingsGlyph(id) {
    const svg = document.createElementNS?.("http://www.w3.org/2000/svg", "svg") ?? document.createElement("svg");
    svg.setAttribute("class", "glyph"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    const use = document.createElementNS?.("http://www.w3.org/2000/svg", "use") ?? document.createElement("use");
    use.setAttribute("href", `#${id}`); svg.append(use);
    return svg;
  }
  function settingsPlaceRow(place) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `settings-nav-item${place.sub ? " is-sub" : ""}`;
    if (place.route) { row.dataset.nav = place.route; row.title = `${place.label}: a live preview beside the controls`; }
    else { row.dataset.settingsCategory = place.id; row.setAttribute("aria-current", "false"); }
    const label = document.createElement("span"); label.className = "label"; label.textContent = place.label;
    row.append(settingsGlyph(place.glyph), label);
    return row;
  }
  function fileSettingsV2() {
    const sections = document.getElementById("settings-sections");
    const list = document.getElementById("settings-nav-list");
    if (settingsFiled || !settingsLayoutV2() || !sections || !list || typeof document.querySelector !== "function") return false;
    settingsFiled = true;
    for (const place of SETTINGS_PLACES) if (!place.route) SETTINGS_CATEGORIES[place.id] = place.label;
    // The panes: a place with cards of its own gets a pane, after the pane before it.
    let previous = document.getElementById("settings-category-general");
    for (const place of SETTINGS_PLACES) {
      if (place.route || place.pane) continue;
      let pane = document.getElementById(`settings-category-${place.id}`);
      if (!pane && place.cards) {
        pane = document.createElement("section");
        pane.className = "settings-category"; pane.id = `settings-category-${place.id}`; pane.hidden = true;
        pane.dataset.settingsCategoryPane = place.id;
        pane.setAttribute("aria-labelledby", `${pane.id}-heading`);
        const head = document.createElement("header"); head.className = "settings-category-head";
        const title = document.createElement("h2"); title.id = `${pane.id}-heading`; title.tabIndex = -1; title.textContent = place.label;
        head.append(title);
        pane.append(head);
        if (previous?.nextSibling) sections.insertBefore(pane, previous.nextSibling); else sections.append(pane);
      }
      if (!pane) continue;
      for (const id of place.cards ?? []) {
        const card = document.getElementById(id);
        if (!card || card.closest?.("[data-settings-category-pane]") === pane) continue;
        card.remove?.(); pane.append(card);
        // The card is the page: its own title is the page's (styles.css hides its summary).
        card.dataset.settingsPlaceCard = place.id;
      }
      const about = pane.querySelector(".settings-category-head p") ?? pane.querySelector(".settings-category-head")?.appendChild(document.createElement("p"));
      if (about && place.about) about.textContent = place.about;
      const heading = pane.querySelector(".settings-category-head h2");
      if (heading && heading.textContent !== place.label && !heading.firstElementChild) heading.textContent = place.label;
      previous = pane;
    }
    // Diagnostics no longer holds Report a problem.
    const diagnostics = document.querySelector("#settings-diagnostics .settings-summary-text > span");
    if (diagnostics) diagnostics.textContent = "Performance, checks and machine status";
    // The list: the places in order, under their group headings, then any category they do not name.
    const kept = [...list.querySelectorAll("[data-settings-category]")].filter((row) => !SETTINGS_PLACES.some((place) => place.id === row.dataset.settingsCategory));
    const groups = [];
    for (const place of SETTINGS_PLACES) {
      let group = groups.at(-1);
      if (!group || group.name !== (place.group ?? null)) {
        const node = document.createElement("div"); node.className = "settings-nav-group";
        if (place.group) {
          const heading = document.createElement("p"); heading.className = "settings-nav-heading";
          heading.id = `settings-nav-group-${groups.length}`; heading.textContent = place.group;
          node.setAttribute("role", "group"); node.setAttribute("aria-labelledby", heading.id);
          node.append(heading);
        }
        group = { name: place.group ?? null, node };
        groups.push(group);
      }
      group.node.append(settingsPlaceRow(place));
    }
    if (kept.length) { const node = document.createElement("div"); node.className = "settings-nav-group"; node.append(...kept); groups.push({ node }); }
    list.replaceChildren(...groups.map((group) => group.node));
    list.dataset.places = "v2";
    // Find a setting sits at the top of the page, beside its title.
    const find = document.querySelector("#settings-nav .settings-find");
    if (find) { find.remove?.(); sections.prepend(find); }
    document.getElementById("tab-studio")?.setAttribute("data-places", "v2");
    // The place you were on last time, now that the places exist.
    const stored = readStore("mefiStudio.settingsCategory");
    if (SETTINGS_CATEGORIES[stored] && document.querySelector(`[data-settings-category-pane="${settingsPane(stored)}"]`)) settingsCategory = stored;
    // Search names each control by its new place.
    settingsSearchRegistered.clear();
    registerSettingsSearch();
    return true;
  }
  // The place a jump lands on: a control under Nodes or Layout is Map look's.
  function settingsPlaceFor(pane, target, section) {
    const key = pane.dataset.settingsCategoryPane;
    if (!settingsFiled || key !== "appearance") return key;
    const asked = String(section ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/^settings-/, "");
    if (asked === "looks" || asked === "map-look") return "looks";
    if (asked === "appearance" || asked === "category-appearance") return "appearance";
    const panel = target?.closest?.("[data-appearance-panel]")?.dataset?.appearancePanel;
    return panel === "nodes" || panel === "layout" ? "looks" : "appearance";
  }
  // Appearance and Map look share a pane: each opens at its own first section.
  function showSettingsLook(category) {
    const looks = settingsPlace(category)?.looks;
    if (!looks) return;
    const sections = document.getElementById("appearance-sections");
    const current = sections?.querySelector?.('[aria-pressed="true"]')?.dataset?.appearanceSection;
    if (looks.includes(current)) return;
    sections?.querySelector?.(`[data-appearance-section="${looks[0]}"]`)?.click?.();
  }
  // A place's own cards are the page: open while it shows. The prototype's pages
  // show their panels open, so a place's folded cards open the first time it
  // shows in a launch and stay as you leave them after that. A card read when it
  // opens (Notifications, Report a problem, Community) reads then, not at launch.
  const settingsPlacesShown = new Set();
  function openSettingsPlace(category) {
    const place = settingsPlace(category);
    if (!place) return;
    const pane = document.querySelector(`[data-settings-category-pane="${settingsPane(category)}"]`);
    if (pane && !settingsPlacesShown.has(category)) {
      settingsPlacesShown.add(category);
      for (const card of pane.querySelectorAll?.("details.settings-card") ?? []) if ((card.parentElement ?? card.parentNode) === pane && !card.open) card.open = true;
    }
    for (const id of place.cards ?? []) {
      const card = document.getElementById(id);
      if (card && card.tagName === "DETAILS" && !card.open) card.open = true;
    }
    if (category === "problem" && window.MefiReport && !window.MefiReport.state?.view && !window.MefiReport.state?.loading) void window.MefiReport.load?.();
  }
  let settingsMatches = [];
  let settingsSearchRegistered = new Set();
  let settingsControlSerial = 0;
  const settingsQuery = () => String(document.getElementById("settings-find")?.value ?? "").trim().toLowerCase();
  // A card the host hid (Server Styler with no checkout on this machine) has
  // nothing to find or jump to, in Settings or in Search.
  const settingsAvailable = (node) => Boolean(node) && !node.closest?.(".settings-card[hidden]") && (Boolean(window.mefiStudio?.launchStudio) || !node.closest?.("#studio-desktop, [data-desktop-only]"));
  const coachShowing = () => { const coach = document.getElementById("walkthrough-coach"); return Boolean(coach && !coach.hidden); };
  function settingsTarget(section) {
    const raw = String(section ?? "").trim();
    if (document.getElementById(raw)?.closest?.("#settings-sections")) return raw;
    const key = raw.toLowerCase().replace(/[\s_]+/g, "-").replace(/^settings-/, "");
    const id = SETTINGS_CATEGORIES[key] ? `settings-category-${settingsPane(key)}` : SETTINGS_ALIASES[key] ?? `settings-${key}`;
    return document.getElementById(id) ? id : null;
  }
  // A choice button's textContent runs its parts together ("Fullevery
  // animation", "Classic orbsLuminous circles"): name it by its title
  // element, or by its own words without the <small> detail and any
  // aria-hidden art, and prefix the group it belongs to ("Motion › Full").
  function settingsButtonLabel(control) {
    const named = control.querySelector?.("strong, b");
    const nodes = Array.from(control.childNodes ?? []);
    const own = named?.textContent || (nodes.length
      ? nodes.filter((node) => node.nodeType === 3 || !(node.tagName === "SMALL" || node.getAttribute?.("aria-hidden") === "true")).map((node) => node.textContent ?? "").join(" ")
      : control.textContent);
    const group = control.closest?.("[role=group][aria-labelledby]");
    const heading = group ? document.getElementById?.(group.getAttribute("aria-labelledby")) : null;
    const title = heading ? Array.from(heading.childNodes ?? []).filter((node) => node.nodeType === 3).map((node) => node.textContent).join(" ").trim() || heading.textContent : "";
    const text = String(own ?? "").replace(/\s+/g, " ").trim();
    return title && text ? `${title.replace(/\s+/g, " ").trim()} › ${text}` : text;
  }
  function settingsControlLabel(control) {
    const label = control.closest?.("label") ?? document.querySelector?.(`label[for="${control.id}"]`);
    const named = label?.querySelector?.(".field-label, b, strong, .grow");
    const parts = label ? Array.from(label.children ?? []).filter((node) => !["INPUT", "SELECT", "TEXTAREA", "SMALL"].includes(node.tagName) && !node.classList?.contains?.("info-pop")).map((node) => node.textContent ?? "").join(" ") : "";
    return String(control.getAttribute?.("aria-label") || named?.textContent || parts || (control.tagName === "BUTTON" ? settingsButtonLabel(control) : "") || control.getAttribute?.("title") || "").replace(/\s+/g, " ").trim();
  }
  function settingsEntries() {
    const entries = [];
    for (const pane of document.querySelectorAll("[data-settings-category-pane]")) {
      const category = pane.dataset.settingsCategoryPane;
      for (const card of pane.querySelectorAll(".settings-card")) {
        if (!card.id || !settingsAvailable(card)) continue;
        const heading = card.querySelector(card.tagName === "DETAILS" ? "summary" : "h3");
        // A card summary holds a title and a one-line subtitle: name the card
        // by its title (Search read "Profile & startupNames and…"), search both.
        const words = String(heading?.textContent ?? "").replace(/\s+/g, " ").trim();
        const label = String((heading?.querySelector?.(".settings-summary-text b") ?? heading)?.textContent ?? "").replace(/\s+/g, " ").trim();
        if (label) entries.push({ id: card.id, label, category, terms: `${words} ${card.id.replace(/-/g, " ")}` });
      }
      for (const control of pane.querySelectorAll("input, select, textarea, button")) {
        // An info circle (MefiUi.tuck) is the help of the setting beside it, not a setting of its own.
        if (!settingsAvailable(control) || control.type === "hidden" || control.getAttribute?.("aria-hidden") === "true" || control.hidden || control.closest?.(".settings-you-theme[hidden], .music-queue, .music-recent, .music-suggestion, .info-dot")) continue;
        const label = settingsControlLabel(control);
        if (!label) continue;
        if (!control.id) control.id = `settings-control-${category}-${++settingsControlSerial}`;
        const card = control.closest?.(".settings-card");
        const heading = card?.querySelector?.(card.tagName === "DETAILS" ? "summary" : "h3");
        entries.push({ id: control.id, label, category, terms: `${label} ${heading?.textContent ?? ""} ${control.id.replace(/-/g, " ")}` });
      }
    }
    // In the 0.5 layout the cards and controls Team holds (the Connections, Models and Automation cards Settings gave to
    // Agents, and Agents' own panes) are found here too, under the Team place that holds each now; a match opens it there
    // (jumpToSettings asks MefiAgents.redirect). Search (Ctrl K) has them already, from renderer/agents.js.
    const team = window.MefiAgents?.teamPlaceOfElement;
    if (settingsFiled && typeof team === "function") {
      for (const pane of document.querySelectorAll("#agents-body [data-agents-pane]")) {
        for (const control of pane.querySelectorAll(".settings-card, input, select, textarea")) {
          if (!control.id || control.type === "hidden" || control.hidden || control.getAttribute?.("aria-hidden") === "true" || !settingsAvailable(control)) continue;
          const place = team(control);
          if (!place) continue;
          const card = control.classList?.contains?.("settings-card") ? control : control.closest?.(".settings-card");
          const heading = card?.querySelector?.(card.tagName === "DETAILS" ? "summary" : "h3");
          const label = control === card ? String((heading?.querySelector?.(".settings-summary-text b") ?? heading)?.textContent ?? "").replace(/\s+/g, " ").trim() : settingsControlLabel(control);
          if (label) entries.push({ id: control.id, label, category: "team", team: true, path: `Team / ${place.label}`, terms: `${label} ${heading?.textContent ?? ""} ${control.id.replace(/-/g, " ")}` });
        }
      }
    }
    return entries;
  }
  function syncSettingsNav() {
    for (const row of document.querySelectorAll("#settings-nav [data-settings-category]")) row.setAttribute("aria-current", String(row.dataset.settingsCategory === settingsCategory));
    // Appearance and Map look show their own sections of the shared pane (styles.css), under their own title.
    if (!settingsFiled) return;
    document.getElementById("tab-studio")?.setAttribute("data-settings-place", settingsQuery() ? "search" : settingsCategory);
    announceSettingsPlace();
    const looks = settingsCategory === "looks";
    const heading = document.getElementById("settings-category-appearance-heading");
    if (heading && heading.textContent !== (looks ? "Map look" : "Appearance")) heading.textContent = looks ? "Map look" : "Appearance";
    const about = heading?.parentElement?.querySelector?.("p");
    const words = looks ? "How the Map draws your work. Changes show on the Map straight away." : "Themes, colours and how the interface moves.";
    if (about && about.textContent !== words) about.textContent = words;
  }
  // mefi:settings-place: Settings changed place (or Find a setting started or stopped showing results), so a list or a
  // breadcrumb drawn elsewhere follows (renderer/shell.js). Said once per change, never for a repaint that moved nothing.
  let settingsPlaceSaid = "";
  function announceSettingsPlace() {
    const search = Boolean(settingsQuery());
    const signature = `${settingsCategory}|${search}`;
    if (signature === settingsPlaceSaid) return;
    settingsPlaceSaid = signature;
    try { window.dispatchEvent?.(new CustomEvent("mefi:settings-place", { detail: { place: settingsCategory, search } })); } catch { /* nobody listens without events */ }
  }
  function syncSettingsAutomation() {
    const current = window.MefiIdle?.queueSettings?.();
    if (!current) return;
    for (const control of document.querySelectorAll("[data-queue-setting]")) {
      const key = control.dataset.queueSetting;
      control.disabled = key === "newWork" ? !current.newWorkKnown : !current.known;
      if (control.type === "checkbox") control.checked = Boolean(current[key]);
      else control.value = key === "autoBuild" ? current.autoBuild ? "auto" : "verify" : key === "parallel" ? current.adaptiveParallel ? "machine" : String(current.parallel) : current[key];
    }
  }
  let settingsAutomationLoad = null;
  function loadSettingsAutomation() {
    if (settingsAutomationLoad) return settingsAutomationLoad;
    const current = window.MefiIdle?.queueSettings?.();
    if (!window.mefiStudio?.launchStudio || !window.MefiIdle?.refreshQueueSettings || (current?.known && current?.newWorkKnown)) return Promise.resolve();
    const status = document.getElementById("settings-automation-status");
    if (status) status.textContent = "Loading queue settings…";
    settingsAutomationLoad = Promise.resolve().then(() => window.MefiIdle.refreshQueueSettings()).catch(() => null).then(() => {
      syncSettingsAutomation();
      const confirmed = window.MefiIdle?.queueSettings?.();
      if (status?.textContent === "Loading queue settings…") status.textContent = confirmed?.known && confirmed?.newWorkKnown ? "" : "Queue settings are unavailable. Reopen Automation to try again.";
    }).finally(() => { settingsAutomationLoad = null; });
    return settingsAutomationLoad;
  }
  function mountSettingsControls() {
    // Catalog-only embeds expose the facade without mounting Settings markup.
    if (typeof document.querySelector !== "function") return;
    fileSettingsV2();
    const move = (node, host) => { if (node && host && (node.parentElement ?? node.parentNode) !== host) { node.remove?.(); host.appendChild(node); } };
    const appearance = document.getElementById("settings-appearance-controls");
    for (const selector of [".settings-you-theme", ".settings-you-motion", "#settings-companion-motion"]) move(document.querySelector(selector), appearance);
    move(document.getElementById("pref-blur")?.closest?.("label"), appearance);
    // The full palette below is canonical. Keep the old select as its bound alias.
    const theme = document.querySelector(".settings-you-theme");
    if (theme) theme.hidden = true;
    move(document.getElementById("jev-enabled")?.closest?.("label"), document.getElementById("settings-behavior-controls"));
    for (const id of ["proactive-mode", "memory-align", "loop-guard", "loop-guard-apply"]) move(document.getElementById(id)?.closest?.("label"), document.getElementById("settings-behavior-controls"));
    for (const id of ["idle-backdrop", "idle-bubbles", "idle-card-style", "idle-ambient-zen"]) move(document.getElementById(id)?.closest?.("label"), document.getElementById("settings-tree-controls"));
    for (const id of ["idle-profile", "idle-zen"]) move(document.getElementById(id)?.closest?.("label"), document.getElementById("settings-audio-controls"));
    const ambience = document.getElementById("idle-ambience-pop");
    if (ambience && !ambience.dataset.settingsTrimmed) {
      ambience.dataset.settingsTrimmed = "true";
      for (const group of ambience.querySelectorAll(".pop-group")) if (!group.querySelector("select, input, button")) group.remove();
      for (const divider of ambience.querySelectorAll("hr")) divider.remove();
      const appearanceLink = ambience.querySelector(".pop-link");
      if (appearanceLink) {
        appearanceLink.textContent = "Appearance settings";
        appearanceLink.dataset.nav = "studio";
        appearanceLink.dataset.navParams = JSON.stringify({ section: "appearance" });
        appearanceLink.title = "Open Settings › Appearance";
      }
      const audioLink = ambience.querySelectorAll(".pop-link")[1] ?? document.createElement("button");
      audioLink.type = "button"; audioLink.className = "ghost mini pop-link"; audioLink.textContent = "Audio settings";
      audioLink.dataset.nav = "studio"; audioLink.dataset.navParams = JSON.stringify({ section: "audio" });
      if (!(audioLink.parentElement ?? audioLink.parentNode)) ambience.appendChild(audioLink);
    }
    window.MefiMusic?.mountSettings?.({ look: document.getElementById("settings-appearance-media") });
    const browser = document.getElementById("studio-browser");
    if (browser) browser.hidden = Boolean(window.mefiStudio?.launchStudio);
    for (const note of document.querySelectorAll("[data-desktop-message]")) note.hidden = Boolean(window.mefiStudio?.launchStudio);
  }
  // A setting's long how-to words move behind an "i" at the end of its title (MefiUi.tuck, studio-ui.js), so a place
  // shows its controls first. Connections, Models and Automation are the Team pages' (renderer/agents.js takes their
  // cards there and tucks them) and Community is renderer/community.js's, so they are marked to stay as they are. One
  // call for all of Settings: tuck reads every title's style before it moves anything, and a call per card read it
  // again after each card's moves (about 20 ms of style each, 120 ms on the first paint). Every paint while Settings
  // shows runs it: rows drawn since (Appearance's media) are tucked, rows already tucked stay as they are.
  const SETTINGS_UNTUCKED = ["settings-category-connections", "settings-category-models", "settings-category-automation", "settings-community"];
  function tuckSettings() {
    const tuck = window.MefiUi?.tuck, sections = document.getElementById("settings-sections");
    // Not before the page has loaded: renderer/nav.js chooses the layout then, and Settings is filed for it (a
    // reopened Settings paints earlier, while a title the 0.5 layout hides, like Report's, still shows).
    if (typeof tuck !== "function" || !sections || document.readyState === "loading") return;
    for (const id of SETTINGS_UNTUCKED) document.getElementById(id)?.setAttribute?.("data-keep-visible", "");
    tuck(sections);
  }
  function paintSettingsRows() {
    mountSettingsControls();
    if (document.querySelector && !document.querySelector(`[data-settings-category-pane="${settingsPane(settingsCategory)}"]`)) settingsCategory = "general";
    const query = settingsQuery();
    const words = query.split(/\s+/).filter(Boolean);
    settingsMatches = words.length ? settingsEntries().filter((item) => words.every((word) => `${item.path ?? SETTINGS_CATEGORIES[item.category]} ${item.terms}`.toLowerCase().includes(word))) : [];
    const results = document.getElementById("settings-search-results");
    if (results) {
      results.replaceChildren();
      results.hidden = !query;
      for (const item of settingsMatches) {
        const row = document.createElement("button"); row.type = "button"; row.className = "settings-search-result";
        row.dataset.settingsResult = item.id;
        const path = document.createElement("span"); path.className = "settings-result-path"; path.textContent = item.path ?? `Settings / ${SETTINGS_CATEGORIES[item.category]}`;
        const name = document.createElement("strong"); name.textContent = item.label;
        row.append(path, name); results.appendChild(row);
      }
    }
    for (const pane of document.querySelectorAll("[data-settings-category-pane]")) pane.hidden = Boolean(query) || pane.dataset.settingsCategoryPane !== settingsPane(settingsCategory);
    if (document.getElementById("tab-studio")?.hidden === false) {
      // Only once Settings shows: by then the layout is chosen and filed, and tuck reads which titles it shows.
      tuckSettings();
      window.MefiMusic?.activateSettings?.(query ? null : settingsPane(settingsCategory));
      if (settingsCategory === "automation") void loadSettingsAutomation();
      if (!query) openSettingsPlace(settingsCategory);
    }
    const empty = document.getElementById("settings-find-empty"); if (empty) empty.hidden = !query || settingsMatches.length > 0;
    const status = document.getElementById("settings-find-status"); if (status) status.textContent = !query ? "" : settingsMatches.length ? `${settingsMatches.length} setting${settingsMatches.length === 1 ? "" : "s"}` : "No settings match";
    syncSettingsNav(); syncSettingsAutomation();
    return settingsMatches.length;
  }
  function clearSettingsFind() {
    const find = document.getElementById("settings-find"); if (find) find.value = "";
    paintSettingsRows();
  }
  function jumpToSettings(section, { focus = true } = {}) {
    const redirected = window.MefiAgents?.redirect?.("studio", { section });
    if (redirected) { window.MefiNav?.go(redirected.id, redirected.params); return true; }
    mountSettingsControls();
    const id = settingsTarget(section);
    const target = id ? document.getElementById(id) : null;
    if (!target) return false;
    const pane = target.closest?.("[data-settings-category-pane]");
    if (!pane) return false;
    settingsCategory = settingsPlaceFor(pane, target, section);
    writeStore("mefiStudio.settingsCategory", settingsCategory);
    clearSettingsFind();
    if (!settingsAvailable(target)) return false;
    if (target === pane) showSettingsLook(settingsCategory);
    window.MefiMusic?.revealSettingsTarget?.(target);
    let parent = target;
    while (parent && parent !== pane) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement ?? parent.parentNode; }
    let landing = ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName) ? target : target.querySelector?.(target.tagName === "DETAILS" ? "summary" : "h2, h3") ?? target;
    if (landing.disabled) landing = target.closest?.("label") ?? pane.querySelector?.("h2") ?? pane;
    // A category opens at the top of Settings (see .settings-category's
    // scroll-margin); a card or a field scrolls only as far as it must.
    target.scrollIntoView?.({ behavior: "auto", block: target === pane ? "start" : "nearest" });
    if (focus && !coachShowing()) {
      if (!landing.hasAttribute?.("tabindex") && !["INPUT", "SELECT", "TEXTAREA", "BUTTON", "SUMMARY"].includes(landing.tagName)) landing.setAttribute?.("tabindex", "-1");
      landing.focus?.({ preventScroll: true });
      if (target.disabled && settingsCategory === "automation") void loadSettingsAutomation().then(() => {
        if (!target.disabled && !pane.hidden && !coachShowing() && document.activeElement === landing) target.focus?.({ preventScroll: true });
      });
    }
    return true;
  }
  function wireSettingsNav() {
    mountSettingsControls();
    document.getElementById("settings-nav")?.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-settings-category]");
      if (button) jumpToSettings(button.dataset.settingsCategory, { focus: event.detail === 0 });
    });
    const find = document.getElementById("settings-find");
    find?.addEventListener("input", paintSettingsRows);
    find?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && settingsMatches[0]) { event.preventDefault?.(); jumpToSettings(settingsMatches[0].id); }
      else if (event.key === "Escape" && find.value) { event.preventDefault?.(); event.stopPropagation?.(); clearSettingsFind(); }
      else if (event.key === "ArrowDown" && settingsMatches.length) { event.preventDefault?.(); document.querySelector(".settings-search-result")?.focus?.(); }
    });
    document.getElementById("settings-sections")?.addEventListener("click", (event) => {
      const result = event.target?.closest?.("[data-settings-result]");
      if (result) { jumpToSettings(result.dataset.settingsResult); return; }
      const button = event.target?.closest?.("[data-settings-nav]");
      if (button && !button.disabled) { event.preventDefault?.(); window.MefiNav?.go?.(button.dataset.settingsNav); }
    });
    for (const control of document.querySelectorAll("[data-queue-setting]")) control.addEventListener("change", async () => {
      const key = control.dataset.queueSetting;
      const value = control.type === "checkbox" ? control.checked : key === "autoBuild" ? control.value === "auto" : control.value;
      control.disabled = true;
      const status = document.getElementById("settings-automation-status");
      try {
        if (!window.MefiIdle?.setQueueSetting) throw new Error("Queue settings are unavailable.");
        const result = await window.MefiIdle.setQueueSetting(key, value);
        if (result === false || result?.ok === false) throw new Error("The setting was not saved. Check the connection and try again.");
        if (status) status.textContent = "Saved.";
      }
      catch (error) { if (status) status.textContent = error?.message ?? "This setting could not be saved."; }
      finally { syncSettingsAutomation(); }
    });
    window.addEventListener?.("mefi:queue-settings", syncSettingsAutomation);
    paintSettingsRows();
  }
  function registerSettingsSearch() {
    for (const item of settingsEntries()) {
      // Team's controls are registered by renderer/agents.js, under their Team place.
      if (item.team || settingsSearchRegistered.has(item.id)) continue;
      settingsSearchRegistered.add(item.id);
      try { window.MefiNav?.register?.({
        id: `settings:${item.id}`, label: `Settings › ${SETTINGS_CATEGORIES[item.category]} › ${item.label}`,
        short: item.label, kind: "action", layer: null, section: "settings", group: "system", key: null,
        glyph: "g-sliders", badge: null, desc: SETTINGS_CATEGORIES[item.category], searchTerms: item.terms,
        showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
        hidden: () => !settingsAvailable(document.getElementById(item.id)),
        run: () => window.MefiNav?.go?.("studio", { section: item.id }),
      }); } catch { /* Search remains usable if a host declines a registration. */ }
    }
  }

  // #pref-blur sits in Settings › Preferences. tasks.js owns the preference:
  // it binds the box by id and paints html[data-no-blur] from boot, but ticks
  // the box only when the Task board opens, so the box mirrors the attribute.
  function syncBlurBox() {
    const box = document.getElementById("pref-blur");
    const root = document.documentElement;
    if (!box || typeof root?.hasAttribute !== "function") return;
    box.checked = !root.hasAttribute("data-no-blur");
  }

  // ---- studio ----
  // Every builder worker's stdout streams here a line at a time, a dozen a
  // second while several run. Appending each one to the element's text
  // rebuilt an ever-growing string, and pinning the scroll to the tail forced
  // a layout of the whole document per line even with the card folded shut
  // (9 ms a line on the live Command view). Keep the newest STUDIO_LOG_LINES,
  // paint at most once a frame, and only while the card is open on a shown
  // tab; opening the card or the tab paints what arrived meanwhile.
  const STUDIO_LOG_LINES = 400;
  const studioLogLines = [];
  let studioLogFrame = 0;
  let studioLogStale = false;
  // initStudio's Server Styler status check, once the desktop bridge has one.
  let refreshStyler = null;
  function paintStudioLog() {
    studioLogFrame = 0;
    const log = document.getElementById("studio-log");
    if (!log) return;
    const card = log.closest?.("details");
    if ((card && !card.open) || log.closest?.("[hidden]")) { studioLogStale = true; return; }
    studioLogStale = false;
    log.textContent = studioLogLines.join("\n");
    log.scrollTop = log.scrollHeight;
  }
  function studioLog(line) {
    studioLogLines.push(String(line));
    if (studioLogLines.length > STUDIO_LOG_LINES) studioLogLines.splice(0, studioLogLines.length - STUDIO_LOG_LINES);
    if (!studioLogFrame) studioLogFrame = requestAnimationFrame(paintStudioLog);
  }

  function updateSpeedModels() {
    const select = document.getElementById("speed-model");
    const selected = select.value;
    const models = new Map([
      ["glm-5.3-flash", "GLM-5.3 Flash (z.ai)"],
      ["glm-5.3", "GLM-5.3 (z.ai)"],
    ]);
    for (const model of state.doc.models) if (model.onRoster && !model.legacy && !models.has(model.id)) models.set(model.id, model.name);
    select.replaceChildren(...[...models].map(([id, name]) => {
      const option = document.createElement("option"); option.value = id; option.textContent = name; return option;
    }));
    select.value = models.has(selected) ? selected : models.has("deepseek-v4.1-flash") ? "deepseek-v4.1-flash" : models.keys().next().value;
  }

  function initStudio() {
    if (state.studioInitialized) return;
    state.studioInitialized = true;
    const actions = document.getElementById("studio-actions");
    const hint = document.getElementById("studio-hint");
    if (!window.mefiStudio?.launchStudio) {
      hint.textContent = "Open the desktop app to connect providers or use the optional game launcher.";
      actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
      document.querySelectorAll("#server-styler-actions button").forEach((b) => (b.disabled = true));
      document.getElementById("server-styler-status").textContent = "Server Styler controls are available in the Mefi desktop app.";
      document.getElementById("studio-desktop").hidden = true;
      // Updates, the speed probe, the auditor and Agents & queue need the host too.
      document.querySelectorAll("[data-desktop-only]").forEach((node) => { node.hidden = true; });
      return;
    }
    hint.textContent = "Uses the separate game project's cached LÖVE runtime and documented smoke-test script when available.";
    window.mefiStudio.onStudioLog((line) => studioLog(line));
    document.getElementById("settings-log")?.addEventListener("toggle", () => { if (studioLogStale) paintStudioLog(); });

    const stylerActions = document.getElementById("server-styler-actions");
    const stylerStatus = document.getElementById("server-styler-status");
    // Server Styler is a separate project most people never check out. Without
    // one the card could only say where it is missing, beside a Start button
    // that cannot work, so it stays out of Settings until the host finds it
    // (a sibling discord-server-styler checkout, or MEFI_STYLER_ROOT).
    const stylerCard = document.getElementById("settings-styler");
    function paintStylerStatus(status) {
      if (stylerCard) stylerCard.hidden = status?.state === "missing";
      stylerStatus.textContent = status?.message ?? "Server Styler status is unavailable.";
      stylerStatus.dataset.state = status?.state ?? "error";
      if (typeof stylerActions.querySelector !== "function") return;
      stylerActions.querySelector('[data-styler-action="start"]').disabled = ["starting", "online", "setup"].includes(status?.state);
      stylerActions.querySelector('[data-styler-action="open"]').disabled = !["online", "setup"].includes(status?.state);
      stylerActions.querySelector('[data-styler-action="folder"]').disabled = status?.state === "missing";
    }
    async function refreshStylerStatus() {
      if (typeof window.mefiStudio.serverStylerStatus !== "function") return;
      try {
        paintStylerStatus(await window.mefiStudio.serverStylerStatus());
      } catch (error) {
        paintStylerStatus({ state: "error", message: `Could not check Server Styler: ${error.message}` });
      }
    }
    void refreshStylerStatus();
    // Each check costs the host a file read and a localhost fetch, so it runs
    // only while Settings is what you are looking at: never while the window
    // hides (boot.js's shared guard clears the timer), nor while Command, the
    // workspace or a sheet covers the tab. showTab("studio") checks at once.
    refreshStyler = refreshStylerStatus;
    const stylerTick = () => {
      const body = document.body;
      if (document.getElementById("tab-studio").hidden || body?.classList?.contains?.("command-active") || body?.classList?.contains?.("workspace-active") || body?.dataset?.sheet) return;
      void refreshStylerStatus();
    };
    if (window.MefiBoot?.pollStart) window.MefiBoot.pollStart("booklet.styler", stylerTick, 5000);
    else if (typeof setInterval === "function") setInterval(stylerTick, 5000);
    stylerActions.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-styler-action]");
      if (!button || button.disabled) return;
      const action = button.dataset.stylerAction;
      button.disabled = true;
      try {
        const method = {
          start: "serverStylerStart",
          open: "serverStylerOpen",
          folder: "serverStylerFolder",
          stop: "serverStylerStop",
        }[action];
        const result = await window.mefiStudio[method]();
        if (result?.message) studioLog(`[Server Styler] ${result.message}`);
        if (result?.error) studioLog(`[Server Styler] ${result.error}`);
        if (result?.state) paintStylerStatus(result);
      } catch (error) {
        studioLog(`[Server Styler] ${error.message}`);
      } finally {
        await refreshStylerStatus();
      }
    });

    const speedModel = document.getElementById("speed-model");
    updateSpeedModels();

    // The setup overview mirrors what the host already reported — saved-key
    // flags, routing, installed CLIs — so the auto setup card never issues its
    // own probes. Every row keeps "unknown" honest until a real read lands.
    const setup = { keys: { opencode: null, zai: null, openrouter: null, custom: null }, routing: null, clis: null, routingError: false, cliError: false };
    const setupAssistant = document.getElementById("setup-assistant");
    const setupSelection = document.getElementById("setup-selection");
    const setupBuilders = document.getElementById("setup-builders");
    // One registry for every route Studio can answer with. The routing and
    // builder pickers are rebuilt from it plus the live flags below, so what
    // is ready on this machine reads first and anything else stays selectable
    // with its missing piece named beside it.
    const providerNames = { auto: "Auto (your order)", zai: "z.ai GLM", opencode: "OpenCode Go", zen: "OpenCode Zen", openrouter: "OpenRouter", grok: "Grok CLI", claude: "Claude Code CLI", codex: "Codex CLI", antigravity: "Antigravity CLI", lmstudio: "LM Studio (local)", custom: "Custom endpoint" };
    const providerKinds = { auto: "auto", zai: "key", opencode: "key", zen: "key", openrouter: "key", grok: "cli", claude: "cli", codex: "cli", antigravity: "cli", lmstudio: "local", custom: "custom" };
    const providerRegistry = Object.keys(providerNames).map((id) => ({ id, name: providerNames[id], kind: providerKinds[id] }));
    const builderIds = ["opencode", "grok", "claude", "codex", "antigravity"];
    const builderNames = { opencode: "OpenCode", grok: "Grok", claude: "Claude Code", codex: "Codex", antigravity: "Antigravity" };
    const providerSelect = document.getElementById("ai-provider");
    const roleRoutine = document.getElementById("ai-role-routine");
    const roleHeavy = document.getElementById("ai-role-heavy");
    // The provider a role answers through: its own pick when one is set,
    // otherwise whatever Assistant answers via picks.
    function roleProviderOf(role) {
      const own = (role === "heavy" ? roleHeavy : roleRoutine).value;
      if (own && providerNames[own]) return own;
      return providerNames[providerSelect.value] ? providerSelect.value : "auto";
    }
    // The roles saved on a provider of their own, heavy first.
    const splitRoles = (routing) => ["heavy", "routine"].filter((role) => providerNames[routing?.roleProviders?.[role]]);
    const executorCli = document.getElementById("executor-cli");
    function cliInstalled(id) {
      return Array.isArray(setup.clis) && setup.clis.some((cli) => cli.id === id && cli.installed);
    }
    function keyState(which) {
      const known = setup.keys[which] ?? null;
      if (known !== null) return known ? "key saved" : "no key saved";
      const flag = which === "zai" ? setup.routing?.hasZai : which === "zen" ? setup.routing?.hasZen : which === "openrouter" ? setup.routing?.hasOpenRouter : setup.routing?.hasOpenCode;
      return flag === true ? "key saved" : flag === false ? "no key saved" : "key unknown";
    }
    // The auto order is tried top to bottom; usability here comes from the same
    // flags the readiness line already reads (saved keys, installed CLIs, the
    // local server's last probe), never a fresh probe.
    const autoOrderOf = (routing) => Array.isArray(routing?.autoProviders) && routing.autoProviders.length ? routing.autoProviders : ["zai", "opencode"];
    // The walk the host resolves: its own `autoOrder` (signed-in CLIs first
    // unless subscriptions-first is off, then the saved order). A draft the
    // Agents overlay has not applied yet carries no host walk, so it is
    // rebuilt from the same two settings only then.
    const subscriptionClis = ["claude", "codex", "grok", "antigravity"];
    const autoWalkOf = (routing) => Array.isArray(routing?.autoOrder) && routing.autoOrder.length ? routing.autoOrder
      : routing?.subscriptionFirst === true ? [...new Set([...subscriptionClis, ...autoOrderOf(routing)])] : autoOrderOf(routing);
    // Saved keys outside the walk still answer when nothing in it can.
    const autoRescueOf = (routing) => (Array.isArray(routing?.autoRescue) ? routing.autoRescue : []).filter((id) => providerNames[id] && !autoWalkOf(routing).includes(id));
    const lmStudioUp = () => setup.routing?.lmStudio?.up === true;
    function autoProviderUsable(id) {
      if (id === "zai") return setup.keys.zai === true || setup.routing?.hasZai === true;
      if (id === "opencode") return setup.keys.opencode === true || setup.routing?.hasOpenCode === true;
      if (id === "zen") return setup.routing?.hasZen === true;
      if (id === "openrouter") return setup.keys.openrouter === true || setup.routing?.hasOpenRouter === true;
      // The custom endpoint's key is optional (a keyless local server).
      if (id === "custom") return Boolean(setup.routing?.customEndpoint);
      if (id === "lmstudio") return lmStudioUp();
      return cliInstalled(id);
    }
    // Which route Auto answers through right now, from the walk and then the
    // saved keys outside it; null when nothing can.
    function autoAnswerOf(routing) {
      const first = autoWalkOf(routing).find((entry) => autoProviderUsable(entry));
      if (first) return { id: first, rescue: false };
      const rescue = autoRescueOf(routing).find((entry) => autoProviderUsable(entry));
      return rescue ? { id: rescue, rescue: true } : null;
    }
    const autoAnswerNote = (answer) => `will use ${providerNames[answer.id]}${answer.rescue ? " (a saved key outside the order)" : ""}`;
    // Availability of one route from the flags already in hand: ready, not
    // ready, or unknown while a read is still in flight. Every picker label,
    // status pill and overview tile reads from here so they never disagree.
    function cliAvailability(id) {
      if (setup.cliError) return { ready: null, note: "CLI status unavailable" };
      if (!setup.clis) return { ready: null, note: "checking CLI…" };
      return cliInstalled(id) ? { ready: true, note: "CLI installed" } : { ready: false, note: "CLI not found" };
    }
    function providerAvailability(id) {
      const kind = providerKinds[id];
      if (kind === "auto") {
        if (!setup.routing) return { ready: null, note: "checking…" };
        const answer = autoAnswerOf(setup.routing);
        return answer ? { ready: true, note: autoAnswerNote(answer) } : { ready: false, note: "nothing in the order is ready yet" };
      }
      if (kind === "key") {
        const state = keyState(id);
        return { ready: state === "key saved" ? true : state === "no key saved" ? false : null, note: state };
      }
      if (kind === "custom") {
        if (!setup.routing && setup.keys.custom === null) return { ready: null, note: "checking…" };
        const endpoint = Boolean(setup.routing?.customEndpoint);
        const key = setup.keys.custom ?? setup.routing?.hasCustom === true;
        // A keyless server (Ollama, llama.cpp) answers with the URL alone.
        if (endpoint) return { ready: true, note: key ? "endpoint and key saved" : "endpoint saved · no key (optional)" };
        return { ready: false, note: "no endpoint saved" };
      }
      // No key is not the same as running: the local server is ready only when
      // its last probe found a loaded model.
      if (kind === "local") {
        const probe = setup.routing?.lmStudio;
        if (!setup.routing) return { ready: null, note: "checking…" };
        if (probe?.up === true) return { ready: true, note: `running${probe.model ? ` · ${probe.model}` : ""}` };
        if (probe?.up === false) return { ready: false, note: "not running or no model loaded" };
        return { ready: null, note: "not checked yet · no key needed" };
      }
      return cliAvailability(id);
    }
    const stateOf = (availability) => availability.ready === true ? "ready" : availability.ready === false ? "missing" : "unknown";
    function setPill(element, state, text) {
      if (!element) return;
      if (text !== undefined) element.textContent = text;
      element.setAttribute("data-state", state);
    }
    // Rebuild a picker from labelled entries and keep the current choice. It
    // only runs when a label changed, so an open picker is never torn down
    // under the pointer by a refresh that changed nothing.
    const pickerSignatures = new Map();
    function renderPicker(select, entries) {
      const signature = entries.map((entry) => `${entry.id}\t${entry.state}\t${entry.label}`).join("\n");
      if (pickerSignatures.get(select) === signature) return;
      pickerSignatures.set(select, signature);
      const current = select.value;
      select.replaceChildren(...entries.map((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.label;
        option.dataset.state = entry.state;
        return option;
      }));
      select.value = current;
    }
    // Ready routes list first; the rest stay selectable with what they still
    // need spelled out, so nothing is locked to a fixed menu.
    function renderProviderPickers() {
      const rank = { ready: 0, unknown: 1, missing: 2 };
      const byReadiness = (a, b) => rank[a.state] - rank[b.state];
      const entryFor = (id, name, availability) => ({ id, state: stateOf(availability), label: `${name} — ${availability.note}` });
      const [auto, ...providers] = providerRegistry.map((entry) => entryFor(entry.id, entry.name, providerAvailability(entry.id)));
      renderPicker(providerSelect, [auto, ...providers.sort(byReadiness)]);
      // Each role may answer elsewhere; "Same as above" follows the main pick
      // and says which one that is.
      const mainId = providerNames[setup.routing?.provider] ? setup.routing.provider : "";
      const same = { id: "", state: mainId ? stateOf(providerAvailability(mainId)) : "unknown", label: mainId ? `Same as above — ${providerNames[mainId]}` : "Same as above" };
      for (const select of [roleRoutine, roleHeavy]) renderPicker(select, [same, auto, ...providers]);
      renderPicker(executorCli, builderIds.map((id) => entryFor(id, builderNames[id], cliAvailability(id))).sort(byReadiness));
      renderAutoOrder();
      renderAutoOrderAdd();
    }
    // Segmented controls mirror a <select> that stays the saved value: a
    // click sets the select and fires its change, and every routing read
    // re-syncs the pressed state. Without the markup (tests) they are no-ops.
    const segmentedGroups = Array.from(document.querySelectorAll("#tab-studio [data-segmented-for]"));
    function syncSegmented() {
      for (const group of segmentedGroups) {
        const select = document.getElementById(group.dataset.segmentedFor);
        if (!select) continue;
        for (const button of group.querySelectorAll("button[data-value]")) button.setAttribute("aria-pressed", String(button.dataset.value === select.value));
        group.setAttribute("aria-disabled", String(Boolean(select.disabled)));
      }
    }
    for (const group of segmentedGroups) {
      group.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-value]");
        const select = document.getElementById(group.dataset.segmentedFor);
        if (!button || !select || select.disabled || select.value === button.dataset.value) return;
        select.value = button.dataset.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        syncSegmented();
      });
    }
    function renderSetupState() {
      const routing = setup.routing;
      if (setup.routingError) setPill(setupAssistant, "unknown", "status unavailable");
      else if (!routing) setPill(setupAssistant, "unknown", "checking…");
      else {
        const provider = providerNames[routing.provider] ? routing.provider : "auto";
        const autoAnswer = autoAnswerOf(routing);
        const detail = provider === "grok" || provider === "claude" || provider === "codex" || provider === "antigravity" ? "CLI login"
          : provider === "lmstudio" ? providerAvailability("lmstudio").note
          : provider === "custom" ? providerAvailability("custom").note
          : provider === "auto" ? (autoAnswer ? autoAnswerNote(autoAnswer) : "no usable provider in this order yet")
          : keyState(provider);
        // A role on its own provider is named, and the pill is only as ready
        // as the least ready provider actually answering.
        const split = splitRoles(routing);
        if (!split.length) setPill(setupAssistant, stateOf(providerAvailability(provider)), `${providerNames[provider]} · ${detail}`);
        else {
          const answering = split.map((role) => routing.roleProviders[role]).concat(split.length === 2 ? [] : [provider]);
          const worst = { ready: 0, unknown: 1, missing: 2 };
          const state = answering.map((id) => stateOf(providerAvailability(id))).reduce((a, b) => (worst[b] > worst[a] ? b : a), "ready");
          const roles = split.map((role) => `${role === "heavy" ? "plans" : "reads"} on ${providerNames[routing.roleProviders[role]]}`).join(" · ");
          setPill(setupAssistant, state, split.length === 2 ? roles : `${providerNames[provider]} · ${detail} · ${roles}`);
        }
        // The Zen key lives in its own tile; opencode's OPENCODE_API_KEY counts.
        setPill(document.getElementById("zen-key-status"), routing.hasZen ? "ready" : "missing", routing.hasZen ? (routing.zenKeySource === "env" ? "key from environment" : "key saved (encrypted)") : "no key saved");
        setPill(document.getElementById("openrouter-key-status"), routing.hasOpenRouter ? "ready" : "missing", routing.hasOpenRouter ? (routing.openrouterKeySource === "env" ? "key from environment" : "key saved (encrypted)") : "no key saved");
        const lmStudio = providerAvailability("lmstudio");
        setPill(document.getElementById("lmstudio-status"), stateOf(lmStudio), lmStudio.note);
      }
      if (setup.routingError) setPill(setupSelection, "unknown", "status unavailable");
      else if (!routing) setPill(setupSelection, "unknown", "checking…");
      else if ((routing.modelSelection ?? "jev") === "fixed") setPill(setupSelection, "ready", "Fixed defaults · overrides win");
      // Jev is optional: never chosen and no Jev key reads as the defaults
      // that actually run, not as a missing piece.
      else if (routing.modelSelectionSaved === false && !routing.jevConfigured) setPill(setupSelection, "ready", "Fixed defaults · Jev optional");
      else setPill(setupSelection, routing.jevConfigured ? "ready" : "missing", routing.jevConfigured ? "Jev · task fit, speed & cost" : "Jev · waiting for a Jev key");
      if (setup.cliError) setPill(setupBuilders, "unknown", "CLI status unavailable");
      else if (!setup.clis) setPill(setupBuilders, "unknown", "checking…");
      else {
        const installed = setup.clis.filter((cli) => cli.installed && builderIds.includes(cli.id));
        setPill(setupBuilders, installed.length ? "ready" : "missing", installed.length ? `${installed.map((cli) => cli.name).join(", ")} installed` : "No builder CLI detected — install OpenCode, Grok, Claude Code, Codex or Antigravity");
      }
      const readiness = document.getElementById("provider-readiness");
      const selected = routing && providerNames[routing.provider] ? routing.provider : null;
      if (!selected) readiness.textContent = "checking…";
      else if (selected === "auto") {
        // Signed-in CLIs the host puts first are named only when they are on
        // this machine (a missing one is skipped, not waited on); the saved
        // order is shown whole, and saved keys outside it close the line.
        const saved = autoOrderOf(routing);
        const walk = autoWalkOf(routing).filter((id) => saved.includes(id) || !subscriptionClis.includes(id) || autoProviderUsable(id) || !setup.clis);
        const order = walk.map((id) => `${providerNames[id] ?? id}${autoProviderUsable(id) ? "" : " (unavailable)"}`);
        const rescue = autoRescueOf(routing).map((id) => providerNames[id]);
        readiness.textContent = `auto order: ${order.join(" → ")}${rescue.length ? `; if none answers, saved keys: ${rescue.join(", ")}` : ""}`;
      }
      else if (selected === "zai" || selected === "opencode" || selected === "zen" || selected === "openrouter") readiness.textContent = `${keyState(selected)} — this provider's saved model applies`;
      else if (selected === "custom") readiness.textContent = `${routing.customEndpoint ? "endpoint saved" : "no endpoint saved"}, ${setup.keys.custom ? "key saved" : "no key saved (optional for a local server)"}`;
      else if (selected === "lmstudio") readiness.textContent = `local server — no key needed; ${providerAvailability("lmstudio").note}; its loaded model is detected automatically`;
      else if (setup.cliError) readiness.textContent = "CLI status unavailable";
      else if (!setup.clis) readiness.textContent = "checking CLI…";
      else readiness.textContent = cliInstalled(selected) ? "CLI installed on this machine" : "CLI not found — you can still save its model and install it later";
      // The nav counts routes that are ready now; the local server is assumed, not probed, so it stays out.
      const navCount = document.getElementById("settings-nav-providers-count");
      if (navCount) {
        const ready = providerRegistry.filter((entry) => entry.kind !== "auto" && entry.kind !== "local" && providerAvailability(entry.id).ready === true).length;
        navCount.textContent = `${ready} ready`;
        navCount.hidden = ready === 0;
      }
      renderProviderPickers();
    }

    const keyStatus = document.getElementById("key-status");
    const zaiKeyStatus = document.getElementById("zai-key-status");
    const customKeyStatus = document.getElementById("custom-key-status");
    const openrouterKeyStatus = document.getElementById("openrouter-key-status");
    const keyPills = { opencode: keyStatus, zai: zaiKeyStatus, openrouter: openrouterKeyStatus, custom: customKeyStatus };
    // The custom endpoint's key is optional (a keyless local server), so its
    // absence reads neutral there rather than as a missing piece.
    const showKeyState = (which, saved) => setPill(keyPills[which], saved ? "ready" : which === "custom" ? "unknown" : "missing", saved ? "key saved (encrypted)" : which === "custom" ? "no key (optional)" : "no key saved");
    window.mefiStudio
      .getApiKey("opencode")
      .then((key) => { setup.keys.opencode = Boolean(key?.saved); showKeyState("opencode", setup.keys.opencode); renderSetupState(); })
      .catch(() => setPill(keyStatus, "unknown", "key status unavailable"));
    window.mefiStudio
      .getApiKey("zai")
      .then((key) => { setup.keys.zai = Boolean(key?.saved); showKeyState("zai", setup.keys.zai); renderSetupState(); })
      .catch(() => setPill(zaiKeyStatus, "unknown", "key status unavailable"));
    window.mefiStudio
      .getApiKey("custom")
      .then((key) => { setup.keys.custom = Boolean(key?.saved); showKeyState("custom", setup.keys.custom); renderSetupState(); })
      .catch(() => setPill(customKeyStatus, "unknown", "key status unavailable"));
    window.mefiStudio
      .getApiKey("openrouter")
      .then((key) => { setup.keys.openrouter = Boolean(key?.saved); showKeyState("openrouter", setup.keys.openrouter); renderSetupState(); })
      .catch(() => setPill(openrouterKeyStatus, "unknown", "key status unavailable"));

    // A Save on an empty field used to clear the saved key without a word. Save
    // now waits for a value (Enter in the field saves too), and removing a key
    // is its own two-step Remove beside Save, shown only while a key is saved;
    // it runs the same save handler with the field deliberately empty.
    const keySaveSyncs = [];
    const resyncKeySaves = () => keySaveSyncs.forEach((sync) => sync());
    const clearingKey = (input) => input?.dataset?.clearing === "1";
    function guardKeySave(inputId, saveId, pill, removeTitle) {
      const input = document.getElementById(inputId);
      const save = document.getElementById(saveId);
      if (!input || !save) return;
      const sync = () => { save.disabled = !String(input.value ?? "").trim(); };
      keySaveSyncs.push(sync);
      input.addEventListener("input", sync);
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || save.disabled) return;
        event.preventDefault?.();
        save.click?.();
      });
      sync();
      const parent = save.parentElement;
      if (!pill || typeof parent?.insertBefore !== "function" || typeof MutationObserver !== "function") return;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ghost mini key-remove";
      remove.textContent = "Remove";
      remove.title = removeTitle;
      parent.insertBefore(remove, save.nextSibling ?? null);
      let armed = null;
      const disarm = () => {
        clearTimeout(armed);
        armed = null;
        remove.textContent = "Remove";
        remove.classList.remove("danger-armed");
      };
      remove.addEventListener("click", () => {
        if (!armed) {
          remove.textContent = "Remove key?";
          remove.classList.add("danger-armed");
          armed = setTimeout(disarm, 3000);
          return;
        }
        disarm();
        input.value = "";
        input.dataset.clearing = "1";
        save.disabled = false;
        save.click();
      });
      const showRemove = () => { remove.hidden = pill.getAttribute("data-state") !== "ready"; };
      new MutationObserver(showRemove).observe(pill, { attributes: true, attributeFilter: ["data-state"] });
      showRemove();
    }
    guardKeySave("api-key", "save-key", keyStatus, "Remove the saved OpenCode Go key");
    guardKeySave("zai-key", "save-zai-key", zaiKeyStatus, "Remove the saved z.ai key");
    guardKeySave("zen-key", "save-zen-key", document.getElementById("zen-key-status"), "Remove the saved Zen key (Jev's Zen route uses it too; OPENCODE_API_KEY still applies when set)");
    guardKeySave("openrouter-key", "save-openrouter-key", openrouterKeyStatus, "Remove the saved OpenRouter key (assistant, Jev and account usage share it; OPENROUTER_API_KEY still applies when set)");
    guardKeySave("custom-key", "save-custom-key", customKeyStatus, "Remove the saved custom-endpoint key");
    guardKeySave("jev-key", "save-jev-key", null, "");

    document.getElementById("save-key").addEventListener("click", async () => {
      const input = document.getElementById("api-key");
      const value = input.value.trim();
      if (!value && !clearingKey(input)) return;
      delete input.dataset.clearing;
      const result = await window.mefiStudio.setApiKey(value, "opencode");
      if (result?.ok) { setup.keys.opencode = Boolean(value); setPill(keyStatus, value ? "ready" : "missing", value ? "key saved (encrypted)" : "key cleared"); noteConnectionSaved("opencode", result, !value); }
      else setPill(keyStatus, "unknown", `save failed: ${result?.error ?? "unknown"}`);
      document.getElementById("api-key").value = "";
      resyncKeySaves();
      await loadAiRouting();
    });

    // One Zen key serves the assistant's Zen route and Jev's, so a save
    // refreshes both; clearing it falls back to OPENCODE_API_KEY when set.
    document.getElementById("save-zen-key").addEventListener("click", async () => {
      const input = document.getElementById("zen-key");
      const value = input.value.trim();
      if (!value && !clearingKey(input)) return;
      delete input.dataset.clearing;
      const result = await window.mefiStudio.setApiKey(value, "zen");
      input.value = "";
      resyncKeySaves();
      if (!result?.ok) setPill(document.getElementById("zen-key-status"), "unknown", `save failed: ${result?.error ?? "unknown"}`);
      else noteConnectionSaved("zen", result, !value);
      await refreshJev();
      await loadAiRouting();
    });

    document.getElementById("save-openrouter-key").addEventListener("click", async () => {
      const input = document.getElementById("openrouter-key");
      const value = input.value.trim();
      if (!value && !clearingKey(input)) return;
      delete input.dataset.clearing;
      const result = await window.mefiStudio.setApiKey(value, "openrouter");
      input.value = "";
      resyncKeySaves();
      if (!result?.ok) setPill(openrouterKeyStatus, "unknown", `save failed: ${result?.error ?? "unknown"}`);
      else { setup.keys.openrouter = Boolean(value); noteConnectionSaved("openrouter", result, !value); }
      await refreshJev();
      await loadAiRouting();
    });

    document.getElementById("save-zai-key").addEventListener("click", async () => {
      const input = document.getElementById("zai-key");
      const value = input.value.trim();
      if (!value && !clearingKey(input)) return;
      delete input.dataset.clearing;
      const result = await window.mefiStudio.setApiKey(value, "zai");
      if (result?.ok) { setup.keys.zai = Boolean(value); setPill(zaiKeyStatus, value ? "ready" : "missing", value ? "key saved (encrypted)" : "key cleared"); noteConnectionSaved("zai", result, !value); }
      else setPill(zaiKeyStatus, "unknown", `save failed: ${result?.error ?? "unknown"}`);
      document.getElementById("zai-key").value = "";
      resyncKeySaves();
      await loadAiRouting();
    });

    // The custom endpoint's URL is saved like any routing preference; its key
    // (optional: a keyless local server needs none) rides the same encrypted
    // setApiKey path as every other credential.
    document.getElementById("save-custom-key").addEventListener("click", async () => {
      const input = document.getElementById("custom-key");
      const value = input.value.trim();
      if (!value && !clearingKey(input)) return;
      delete input.dataset.clearing;
      const result = await window.mefiStudio.setApiKey(value, "custom");
      if (result?.ok) { setup.keys.custom = Boolean(value); setPill(customKeyStatus, value ? "ready" : "unknown", value ? "key saved (encrypted)" : "key cleared"); noteConnectionSaved("custom", result, !value); }
      else setPill(customKeyStatus, "unknown", `save failed: ${result?.error ?? "unknown"}`);
      document.getElementById("custom-key").value = "";
      resyncKeySaves();
      await loadAiRouting();
    });

    const jevStatus = document.getElementById("jev-status");
    const jevEnabled = document.getElementById("jev-enabled");
    const jevTest = document.getElementById("test-jev");
    const jevRoute = document.getElementById("jev-route");
    const jevKey = document.getElementById("jev-key");
    // Each route stores its credential in its own encrypted settings field.
    const jevRouteFields = {
      vercel: { key: "gateway", placeholder: "Vercel gateway API key (stored encrypted)" },
      typesafe: { key: "jev", placeholder: "TypeSafe Jev API key (stored encrypted)" },
      zen: { key: "zen", placeholder: "OpenCode Zen API key (stored encrypted)" },
      openrouter: { key: "openrouter", placeholder: "OpenRouter API key (stored encrypted)" },
    };
    const jevRouteOf = () => (jevRouteFields[jevRoute.value] ? jevRoute.value : "vercel");
    async function refreshJev() {
      try {
        const status = await window.mefiStudio.jevStatus();
        const route = jevRouteFields[status.route] ? status.route : "vercel";
        jevRoute.value = route;
        jevKey.placeholder = jevRouteFields[route].placeholder;
        jevEnabled.checked = status.enabled;
        jevTest.disabled = !status.configured;
        const where = status.routeLabel ? ` · ${status.routeLabel}` : "";
        const saved = status.routes && status.routes[route] !== undefined ? (status.routes[route] ? " · key saved" : " · no key saved") : "";
        const state = !status.configured ? `Save a Jev key for ${status.routeLabel ?? "this route"} to connect` : !status.enabled ? "Jev classification paused" : status.accountingPending ? "Jev waiting for the usage ledger" : `Jev configured · ${status.model}`;
        const queue = status.pending ? ` · ${status.pending} waiting` : "";
        jevStatus.textContent = `${state}${where}${saved}${queue}${status.lastError ? ` · ${status.lastError}` : ""}`;
      } catch { jevStatus.textContent = "Jev status unavailable"; }
    }
    document.getElementById("save-jev-key").addEventListener("click", async () => {
      const input = jevKey;
      if (!input.value.trim()) return;
      try {
        const result = await window.mefiStudio.setApiKey(input.value.trim(), jevRouteFields[jevRouteOf()].key);
        input.value = "";
        resyncKeySaves();
        if (!result?.ok) { jevStatus.textContent = `Save failed: ${result?.error ?? "unknown"}`; return; }
        noteConnectionSaved(jevRouteFields[jevRouteOf()].key, result);
        await refreshJev();
        await loadAiRouting();
      } catch { input.value = ""; jevStatus.textContent = "Could not save Jev key"; }
    });
    jevRoute.addEventListener("change", async () => {
      try { await window.mefiStudio.jevSetRoute(jevRoute.value); await refreshJev(); await loadAiRouting(); }
      catch { jevStatus.textContent = "Could not change Jev route"; }
    });
    jevEnabled.addEventListener("change", async () => {
      try { await window.mefiStudio.jevSetEnabled(jevEnabled.checked); await refreshJev(); }
      catch { jevStatus.textContent = "Could not change Jev setting"; }
    });
    jevTest.addEventListener("click", async () => {
      jevTest.disabled = true;
      jevStatus.textContent = "Connecting to Jev…";
      try {
        const result = await window.mefiStudio.jevProbe();
        jevStatus.textContent = result?.ok ? `Connected · ${result.model} · ${result.elapsedMs} ms` : `Connection failed: ${result?.error ?? "unknown"}`;
      } catch { jevStatus.textContent = "Jev connection check failed"; }
      finally { jevTest.disabled = false; }
    });
    refreshJev();

    // AI routing: who pays for assistant calls. Auto walks the owner's saved
    // provider order (first usable wins); the fallback switch exists so nothing
    // bills another provider by surprise. Provider choice and model selection
    // are independent; explicit role models take priority over Jev. Status
    // refreshes never erase unsaved model inputs.
    const modelSelection = document.getElementById("ai-model-selection");
    const routingStatus = document.getElementById("ai-routing-status");
    const routingDecision = document.getElementById("ai-routing-decision");
    const routingEvidence = document.getElementById("ai-routing-evidence");
    const routingRefresh = document.getElementById("ai-routing-refresh");
    const fallbackToggle = document.getElementById("ai-fallback");
    const autoOrderList = document.getElementById("auto-order-list");
    const autoOrderAdd = document.getElementById("auto-order-add");
    const autoOrderAddButton = document.getElementById("auto-order-add-button");
    const modelRoutine = document.getElementById("ai-model-routine");
    const modelHeavy = document.getElementById("ai-model-heavy");
    const openrouterBrowser = document.getElementById("openrouter-model-browser");
    const openrouterSearch = document.getElementById("openrouter-model-search");
    const openrouterFreeOnly = document.getElementById("openrouter-free-only");
    const openrouterList = document.getElementById("openrouter-model-list");
    const openrouterModelStatus = document.getElementById("openrouter-model-status");
    let openrouterModels = [];
    function renderOpenrouterModels() {
      if (!openrouterList) return;
      const query = String(openrouterSearch?.value ?? "").trim().toLowerCase();
      const chosen = openrouterList.value;
      const matches = openrouterModels.filter((model) => (!openrouterFreeOnly?.checked || model.free)
        && (!query || `${model.name} ${model.id}`.toLowerCase().includes(query)));
      openrouterList.replaceChildren(...matches.slice(0, 150).map((model) => {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = `${model.name} · ${model.id}${model.free ? " · free" : ""}`;
        return option;
      }));
      if (matches.some((model) => model.id === chosen)) openrouterList.value = chosen;
      openrouterModelStatus.textContent = `${matches.length} chat models${matches.length > 150 ? " · showing first 150; search to narrow" : ""}`;
    }
    async function loadOpenrouterModels(refresh = false) {
      if (!openrouterBrowser || typeof window.mefiStudio.openrouterModels !== "function") return;
      openrouterModelStatus.textContent = "Loading OpenRouter models…";
      const result = await window.mefiStudio.openrouterModels({ refresh }).catch((error) => ({ ok: false, error: error.message }));
      if (Array.isArray(result?.models)) openrouterModels = result.models;
      renderOpenrouterModels();
      if (!result?.ok) openrouterModelStatus.textContent = result?.error ?? "OpenRouter model list unavailable";
    }
    function showOpenrouterBrowser() {
      if (!openrouterBrowser) return;
      const visible = ["routine", "heavy"].some((role) => roleProviderOf(role) === "openrouter");
      openrouterBrowser.hidden = !visible;
      if (visible && !openrouterModels.length) void loadOpenrouterModels();
    }
    openrouterSearch?.addEventListener("input", renderOpenrouterModels);
    openrouterFreeOnly?.addEventListener("change", renderOpenrouterModels);
    document.getElementById("openrouter-model-refresh")?.addEventListener("click", () => void loadOpenrouterModels(true));
    for (const [id, role] of [["openrouter-use-routine", "routine"], ["openrouter-use-heavy", "heavy"]]) {
      document.getElementById(id)?.addEventListener("click", () => {
        const model = openrouterList?.value;
        if (!model) return;
        const patch = { providerModels: { openrouter: { [role]: model } } };
        if (roleProviderOf(role) !== "openrouter") patch.roleProviders = { [role]: "openrouter" };
        void saveRouting(patch, `${role} model on OpenRouter: ${model}`, { syncControls: true });
      });
    }
    const executorModel = document.getElementById("executor-model");
    const executorTier = document.getElementById("executor-tier");
    const executorModelLabel = document.getElementById("executor-model-label");
    const executorTierStatus = document.getElementById("executor-tier-status");
    const lmStudioEndpoint = document.getElementById("lmstudio-endpoint");
    // Coding tiers. One text field serves the active tier: Auto shows the
    // pinned per-CLI override, a tier shows that tier's own saved model, and
    // the placeholder is the model that would actually run when the field is
    // empty — the host resolves it, so what reads here is what the next run does.
    const tierNames = { auto: "Auto", free: "Free", fast: "Fast", heavy: "Heavy" };
    const tierSources = { saved: "saved", "first-scan": "from the first scan", zai: "on your z.ai plan", alias: "Claude Code alias", "cli-default": "CLI default", none: "no free model saved" };
    const tierEntry = (routing, cli, tier) => routing?.executorTierDefaults?.[cli]?.[tier] ?? { model: "", source: tier === "free" ? "none" : "cli-default" };
    // The route an unpinned OpenCode builder rides on Auto, read the way the
    // host's executorRunEnv picks it: the routing pick, else the Auto order
    // with z.ai ahead only while its key is saved. Both routes pick each
    // task's model by its verified record; anything else runs the CLI default.
    // Go needs the OpenCode pick or Auto, and a Go login OpenCode itself holds
    // (the host checks that; Settings cannot), so its placeholder says both.
    const autoBuilderDefaults = { zai: "glm-5.3-flash on your z.ai plan", go: "deepseek-v4.1-flash on OpenCode Go" };
    const autoBuilderNotes = { go: " · CLI default without an OpenCode Go login" };
    function autoBuilderRoute(routing) {
      const provider = routing?.provider ?? "auto";
      if (provider === "opencode") return "go";
      if (provider === "zai") return "zai";
      const order = autoOrderOf(routing);
      const zaiAt = order.indexOf("zai"), openAt = order.indexOf("opencode");
      if (zaiAt >= 0 && (openAt < 0 || zaiAt < openAt) && routing?.hasZai !== false) return "zai";
      return openAt >= 0 && provider === "auto" ? "go" : "";
    }
    function syncExecutorModel(routing) {
      const cli = executorCli.value || "opencode";
      const tier = tierNames[executorTier.value] ? executorTier.value : "auto";
      if (tier === "auto") {
        executorModelLabel.textContent = "Pinned model";
        executorModel.value = routing?.executorModel ?? "";
        const route = cli === "opencode" ? autoBuilderRoute(routing) : "";
        executorModel.placeholder = route ? `routed per task · ${autoBuilderDefaults[route]} by default${autoBuilderNotes[route] ?? ""}` : "CLI default";
        return;
      }
      const entry = tierEntry(routing, cli, tier);
      executorModelLabel.textContent = `${tierNames[tier]} model`;
      executorModel.value = routing?.executorTierModels?.[cli]?.[tier] ?? "";
      executorModel.placeholder = entry.model && entry.source !== "saved" ? `${entry.model} · ${tierSources[entry.source] ?? entry.source}` : tier === "free" ? "no free model saved" : "CLI default";
    }
    // The tier table shows what each tier would run for the chosen builder,
    // with the active tier marked; the sentence below it stays the status line.
    function renderTierTable(routing, cli, tier) {
      const table = document.getElementById("executor-tier-table");
      if (!table) return;
      if (!routing?.executorTierDefaults) { table.hidden = true; return; }
      table.hidden = false;
      table.replaceChildren(...["free", "fast", "heavy"].map((name) => {
        const entry = tierEntry(routing, cli, name);
        const row = document.createElement("div");
        row.className = "tier-row";
        row.dataset.tier = name;
        row.setAttribute("aria-current", String(name === tier));
        const label = document.createElement("span");
        label.className = "tier-name";
        label.textContent = tierNames[name];
        const model = document.createElement("span");
        model.className = "tier-model";
        model.textContent = entry.model || (name === "free" ? "no free model saved" : "CLI default");
        model.dataset.state = entry.model ? "ready" : name === "free" ? "missing" : "unknown";
        const source = document.createElement("span");
        source.className = "tier-source";
        source.textContent = entry.model ? (entry.source === "saved" ? "saved" : tierSources[entry.source] ?? entry.source) : "";
        row.append(label, model, source);
        return row;
      }));
    }
    function renderExecutorTiers(routing) {
      const cli = executorCli.value || "opencode";
      const tier = tierNames[executorTier.value] ? executorTier.value : "auto";
      const cliName = builderNames[cli] ?? cli;
      renderTierTable(routing, cli, tier);
      if (!routing?.executorTierDefaults) { executorTierStatus.textContent = "Coding tiers need the desktop app."; return; }
      const describe = (name) => {
        const entry = tierEntry(routing, cli, name);
        if (!entry.model) return `${tierNames[name]} → ${name === "free" ? "no free model saved" : "CLI default"}`;
        return `${tierNames[name]} → ${entry.model}${entry.source === "saved" ? "" : ` (${tierSources[entry.source] ?? entry.source})`}`;
      };
      const active = tierEntry(routing, cli, tier);
      const lead = tier === "auto"
        ? `Auto: ${cli === "opencode" ? "picks each task's model by its verified record, on the z.ai plan and on OpenCode Go; a pinned model wins" : `${cliName} runs the pinned model or its CLI default`}.`
        : tier === "free" && !active.model
          ? `Free tier: no free model is saved for ${cliName}, so builds wait until one is${cli === "opencode" ? " (run the first scan, or save a free provider/model id)" : ""}.`
          : `${tierNames[tier]} tier: ${cliName} runs ${active.model || "its CLI default"}${tier === "free" ? ", one worker at a time" : ""}.`;
      const review = cli === "opencode" ? "" : ` ${cliName} leaves no session Studio can read, so Studio verifies its finished tasks with the project's own checks (npm test or npm run check).`;
      executorTierStatus.textContent = `${lead} ${["free", "fast", "heavy"].map(describe).join(" · ")}.${review}`;
    }
    // Each model field names the provider it saves to, and its placeholder is
    // what that role runs while the field is empty — the host resolves it,
    // the same way the tier table reads for builders.
    function renderRoleModels(routing) {
      for (const [role, input, scopeId] of [["routine", modelRoutine, "model-scope-note"], ["heavy", modelHeavy, "model-heavy-scope"]]) {
        const entry = routing?.roleModels?.[role];
        if (!entry) continue;
        const scope = document.getElementById(scopeId);
        if (scope) scope.textContent = entry.provider === "auto" ? "for the auto order" : `on ${providerNames[entry.provider] ?? entry.provider}`;
        input.placeholder = entry.model
          ? `${entry.model}${entry.source === "default" ? " · default" : ""}`
          : entry.provider === "auto" ? "automatic selection" : providerKinds[entry.provider] === "cli" ? "CLI default" : "the server's loaded model";
      }
    }
    const customEndpoint = document.getElementById("custom-endpoint");
    function evidenceText(evidence, taskType) {
      const workerNote = taskType === "coding" ? " Available measurements describe Studio HTTP requests; CLI worker timing and billing are not measured." : "";
      if (!evidence) return `No measured evidence recorded for this selection.${workerNote}`;
      const known = (value) => typeof value === "number" && Number.isFinite(value);
      const task = evidence.measured?.task;
      const measured = task?.samples > 0 ? task : evidence.measured?.overall;
      const scope = task?.samples > 0 ? "this task type" : "all task types";
      const latency = measured?.latencyMs?.median;
      const speed = measured?.throughputTokensPerSecond?.median;
      const cost = measured?.costUsd?.mean;
      const quality = measured?.quality;
      const human = quality?.human?.meanOutOf5;
      const model = quality?.model?.meanOutOf5;
      const money = (value) => `$${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
      const coverage = known(cost) ? ` (${measured.costUsd.samples ?? 0} reported, ${measured.costUsd.unknownRecords ?? 0} unknown)` : "";
      const observed = `Measured (${scope}, ${measured?.samples ?? 0} calls): response ${known(latency) ? `${(latency / 1000).toFixed(2)} s` : "unknown"}; speed ${known(speed) ? `${speed.toFixed(1)} tokens/s` : "unknown"}; errors ${known(measured?.errors) ? measured.errors : "unknown"}; mean reported cost ${known(cost) ? money(cost) : "unknown"}${coverage}; human rating ${known(human) ? `${human.toFixed(1)}/5 (${quality.human.samples ?? 0} rated)` : "unknown"}; model rating ${known(model) ? `${model.toFixed(1)}/5 (${quality.model.samples ?? 0} rated)` : "unknown"}.`;
      const catalog = evidence.catalog;
      const price = catalog?.pricingEstimate?.default;
      const estimate = price && known(price.input) && known(price.output) ? `${money(price.input)} input / ${money(price.output)} output per million tokens${price.condition ? ` (${price.condition})` : ""}` : "unknown";
      const benchmark = known(catalog?.quality?.index) ? `${catalog.quality.index} (${catalog.quality.source ?? "source unknown"} ${catalog.quality.version ?? ""})` : "unknown";
      return `${observed} Catalog quality: ${benchmark}; catalog price estimate: ${estimate}. Estimates are separate from your billed cost.${workerNote}`;
    }
    let routingRead = 0;
    // The first launch of a fresh install runs auto setup by itself (main's
    // firstLaunchAutoSetup); its saved record shows under the button until
    // the button is pressed in this session.
    let autoSetupPressed = false;
    function renderAutoSetupRecord(record) {
      const status = document.getElementById("auto-setup-status");
      if (!status || !record?.summary) return;
      const when = record.at ? ` on ${new Date(record.at).toLocaleDateString()}` : "";
      const notes = Array.isArray(record.notes) && record.notes.length ? ` ${record.notes.join(" ")}` : "";
      status.textContent = `Ran by itself on first launch${when}: ${record.summary}${notes}`;
    }
    async function loadAiRouting({ syncControls = false } = {}) {
      const read = ++routingRead;
      routingRefresh.disabled = true;
      try {
        const savedRouting = await window.mefiStudio.getAiRouting();
        const routing = window.MefiAgents?.routingView?.(savedRouting) ?? savedRouting;
        if (read !== routingRead) return;
        setup.routing = routing;
        setup.routingError = false;
        renderSetupState();
        if (!autoSetupPressed && routing.autoSetup?.automatic) renderAutoSetupRecord(routing.autoSetup);
        if (syncControls) {
          providerSelect.value = routing.provider;
          modelSelection.value = routing.modelSelection ?? "jev";
          fallbackToggle.checked = routing.autoFallback === true;
          autoOrder = autoOrderOf(routing);
          renderAutoOrder();
          renderAutoOrderAdd();
          roleRoutine.value = routing.roleProviders?.routine ?? "";
          roleHeavy.value = routing.roleProviders?.heavy ?? "";
          // Models follow the provider each role answers through: the keyed
          // HTTP routes (and "auto") may show the role-wide fallback, CLI and
          // local routes show only what was saved for them.
          const modelFor = (role) => {
            const selectedProvider = roleProviderOf(role);
            const scoped = selectedProvider === "auto" ? null : routing.providerModels?.[selectedProvider];
            const fallbackAllowed = selectedProvider === "auto" || selectedProvider === "zai" || selectedProvider === "opencode" || selectedProvider === "zen";
            return scoped?.[role] ?? (fallbackAllowed ? routing.models?.[role] ?? "" : "");
          };
          modelRoutine.value = modelFor("routine");
          modelHeavy.value = modelFor("heavy");
          executorCli.value = routing.executorCli ?? "opencode";
          executorTier.value = tierNames[routing.executorTier] ? routing.executorTier : "auto";
          syncExecutorModel(routing);
          lmStudioEndpoint.value = routing.lmStudioEndpoint ?? "";
          customEndpoint.value = routing.customEndpoint ?? "";
        }
        showOpenrouterBrowser();
        renderExecutorTiers(routing);
        renderRoleModels(routing);
        syncSegmented();
        const selection = routing.modelSelection ?? "jev";
        const cliProvider = routing.provider === "grok" ? "Grok CLI" : routing.provider === "claude" ? "Claude Code CLI" : routing.provider === "codex" ? "Codex CLI" : routing.provider === "antigravity" ? "Antigravity CLI" : null;
        routingStatus.textContent = selection === "fixed"
          ? "Fixed defaults enabled. Explicit model overrides take priority."
          : cliProvider
            ? `${cliProvider} uses your explicit model or its CLI default. Jev selection is available for HTTP calls and z.ai coding workers.`
            : routing.provider === "lmstudio"
              ? "LM Studio answers from the local server with no key. Load one model there or save a model override."
              : routing.provider === "custom"
                ? "The custom endpoint answers with its saved key, or with none for a keyless local server. Save a model override when it serves more than one model."
                : routing.jevConfigured
                  ? "Jev model selection ready · task fit, speed and cost. Explicit model overrides take priority."
                  : "Jev model selection is waiting for a Jev key. Save one below for the selected route; usual defaults apply until connected.";
        const split = splitRoles(routing);
        if (split.length) routingStatus.textContent += ` ${split.map((role) => `${role === "heavy" ? "Heavy" : "Routine"} passes answer via ${providerNames[routing.roleProviders[role]]}`).join("; ")}.`;
        const decision = routing.routingDecision;
        routingEvidence.hidden = !decision;
        routingEvidence.textContent = decision ? evidenceText(decision.evidence, decision.taskType) : "";
        if (!decision) routingDecision.textContent = "No selection recorded yet. Start a task, then refresh to see its model and reason.";
        else {
          const method = { jev: "Jev selected", default: "Default selected", override: "Model override" }[decision.method] ?? "Selected";
          const when = new Date(decision.at);
          const stamp = decision.at && Number.isFinite(when.getTime()) ? ` · ${when.toLocaleString()}` : "";
          routingDecision.textContent = `Last selection: ${method} · ${decision.provider} / ${decision.model} · ${decision.taskType}${stamp}. ${decision.reason || "No reason recorded."}`;
        }
      } catch {
        if (read === routingRead) {
          routingStatus.textContent = "Model selection status unavailable. Refresh to try again.";
          setup.routingError = true;
          renderSetupState();
        }
      } finally {
        if (read === routingRead) routingRefresh.disabled = false;
      }
    }
    // Auto order editor: the host stores the same ordered array. The editor
    // only reorders, adds and removes, then saves the whole list; every save
    // re-reads routing so the controls stay authoritative.
    const autoProviderIds = ["zai", "opencode", "zen", "openrouter", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"];
    let autoOrder = ["zai", "opencode"];
    function renderAutoOrder() {
      autoOrderList.replaceChildren(...autoOrder.map((id, index) => {
        const item = document.createElement("li");
        item.className = "auto-order-item";
        item.dataset.provider = id;
        item.setAttribute("data-state", stateOf(providerAvailability(id)));
        const position = document.createElement("span");
        position.className = "auto-order-index";
        position.textContent = String(index + 1);
        const name = document.createElement("span");
        name.className = "auto-order-name";
        name.textContent = providerNames[id] ?? id;
        const control = (label, action, disabled) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ghost";
          button.textContent = label;
          button.disabled = disabled;
          button.dataset.action = action;
          button.setAttribute("aria-label", `${action === "remove" ? "Remove" : action === "up" ? "Move up" : "Move down"} ${providerNames[id] ?? id}`);
          button.addEventListener("click", () => {
            if (action === "remove") {
              if (autoOrder.length === 1) return;
              return saveAutoOrder(autoOrder.filter((entry) => entry !== id), `${providerNames[id] ?? id} removed from the auto order`);
            }
            const target = index + (action === "up" ? -1 : 1);
            if (target < 0 || target >= autoOrder.length) return;
            const next = [...autoOrder];
            [next[index], next[target]] = [next[target], next[index]];
            return saveAutoOrder(next, `auto order: ${next.map((entry) => providerNames[entry] ?? entry).join(" → ")}`);
          });
          return button;
        };
        item.append(position, name, control("↑", "up", index === 0), control("↓", "down", index === autoOrder.length - 1), control("✕", "remove", autoOrder.length === 1));
        return item;
      }));
    }
    function renderAutoOrderAdd() {
      const remaining = autoProviderIds.filter((id) => !autoOrder.includes(id));
      autoOrderAdd.replaceChildren(...remaining.map((id) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${providerNames[id] ?? id} — ${providerAvailability(id).note}`;
        return option;
      }));
      autoOrderAdd.disabled = remaining.length === 0;
      autoOrderAddButton.disabled = remaining.length === 0;
    }
    function saveAutoOrder(next, confirmation) {
      autoOrder = next;
      renderAutoOrder();
      renderAutoOrderAdd();
      return saveRouting({ autoProviders: next }, confirmation, { syncControls: true });
    }
    autoOrderAddButton.addEventListener("click", () => {
      const id = autoOrderAdd.value;
      if (!autoProviderIds.includes(id) || autoOrder.includes(id)) return;
      return saveAutoOrder([...autoOrder, id], `${providerNames[id] ?? id} added to the auto order`);
    });
    const routingControls = [providerSelect, roleRoutine, roleHeavy, modelSelection, fallbackToggle, autoOrderAdd, autoOrderAddButton, modelRoutine, modelHeavy, executorCli, executorTier, executorModel, lmStudioEndpoint, customEndpoint];
    for (const control of routingControls) control.disabled = true;
    renderSetupState();
    syncSegmented();
    loadAiRouting({ syncControls: true }).finally(() => {
      for (const control of routingControls) control.disabled = false;
      renderAutoOrderAdd();
      syncSegmented();
    });
    routingRefresh.addEventListener("click", () => loadAiRouting());
    window.addEventListener("mefi:agent-draft", () => loadAiRouting({ syncControls: true }));
    async function saveRouting(payload, confirmation, { syncControls = false } = {}) {
      try {
        const staged = window.MefiAgents?.stageRouting?.(payload);
        const result = staged ? { ok: true } : await window.mefiStudio.setAiRouting(payload);
        if (!result?.ok) throw new Error(result?.error ?? "save failed");
        studioLog(`> ${confirmation}`);
        await loadAiRouting({ syncControls });
      } catch (error) {
        routingStatus.textContent = `Could not save routing: ${error.message}. Your saved selection is unchanged.`;
        studioLog(`! routing: ${error.message}`);
      }
    }
    // Switching provider reloads that provider's own saved models, so one
    // route's model id is never left in a field that now belongs to another.
    providerSelect.addEventListener("change", () => saveRouting({ provider: providerSelect.value }, `assistant answers via ${providerSelect.value}`, { syncControls: true }));
    modelSelection.addEventListener("change", () => saveRouting({ modelSelection: modelSelection.value }, `model selection: ${modelSelection.value}`));
    fallbackToggle.addEventListener("change", () => saveRouting({ autoFallback: fallbackToggle.checked }, "provider fallback saved"));
    // A role's provider reloads that role's model field from the provider it
    // now answers through.
    for (const [select, role] of [[roleRoutine, "routine"], [roleHeavy, "heavy"]]) {
      select.addEventListener("change", () => saveRouting({ roleProviders: { [role]: select.value } }, `${role} passes answer via ${select.value ? providerNames[select.value] ?? select.value : "the main pick"}`, { syncControls: true }));
    }
    const saveModel = (which, value) => {
      const provider = roleProviderOf(which);
      const trimmed = value.trim();
      const confirmation = `${provider} ${which} model ${trimmed ? `"${trimmed}"` : "uses the provider default"}`;
      return provider === "auto"
        ? saveRouting({ models: { [which]: value } }, confirmation)
        : saveRouting({ providerModels: { [provider]: { [which]: value } } }, confirmation);
    };
    for (const [input, role] of [[modelRoutine, "routine"], [modelHeavy, "heavy"]]) {
      input.addEventListener("change", () => saveModel(role, input.value));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
    }
    // Builder models are saved per CLI (and per tier) too, so switching
    // builders or tiers cannot leave one CLI's model id on another CLI's
    // command line. Every save re-reads routing, so the field and the tier
    // line always show the host's answer.
    executorCli.addEventListener("change", () => saveRouting({ executorCli: executorCli.value }, `builders run on ${executorCli.value}`, { syncControls: true }));
    executorTier.addEventListener("change", () => saveRouting({ executorTier: executorTier.value }, `coding tier: ${executorTier.value}`, { syncControls: true }));
    executorModel.addEventListener("change", () => {
      const cli = executorCli.value;
      const tier = tierNames[executorTier.value] ? executorTier.value : "auto";
      const value = executorModel.value;
      if (tier === "auto") return saveRouting({ executorModels: { [cli]: value } }, `builder model for ${cli} ${value.trim() ? `"${value.trim()}"` : "reset to CLI default"}`);
      return saveRouting({ executorTierModels: { [cli]: { [tier]: value } } }, `${tier} tier model for ${cli} ${value.trim() ? `"${value.trim()}"` : "reset to its default"}`, { syncControls: true });
    });
    executorModel.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        executorModel.blur();
      }
    });
    for (const [input, field, label] of [[lmStudioEndpoint, "lmStudioEndpoint", "LM Studio endpoint"], [customEndpoint, "customEndpoint", "custom endpoint"]]) {
      input.addEventListener("change", () => saveRouting({ [field]: input.value }, `${label} ${input.value.trim() ? `set to "${input.value.trim()}"` : "reset to default"}`));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
    }

    // Auto setup: one host call that reads saved keys and installed CLIs and
    // applies the matching configuration. The renderer only reports the host's
    // summary and re-reads state, so the controls above stay authoritative.
    const autoSetupButton = document.getElementById("auto-setup");
    const autoSetupStatus = document.getElementById("auto-setup-status");
    if (typeof window.mefiStudio.autoSetup !== "function") {
      autoSetupButton.disabled = true;
      autoSetupStatus.textContent = "Auto setup needs the desktop app.";
    } else {
      autoSetupButton.addEventListener("click", async () => {
        if (autoSetupButton.disabled) return;
        autoSetupPressed = true;
        autoSetupButton.disabled = true;
        autoSetupStatus.textContent = "Checking saved keys and installed CLIs…";
        try {
          const result = await window.mefiStudio.autoSetup();
          if (!result?.ok) {
            autoSetupStatus.textContent = `Auto setup could not finish: ${result?.error ?? "unknown error"}`;
            studioLog("! auto setup: nothing detected to configure");
            return;
          }
          const notes = Array.isArray(result.notes) && result.notes.length ? ` ${result.notes.join(" ")}` : "";
          autoSetupStatus.textContent = `${result.summary ?? "Auto setup applied."}${notes}`;
          studioLog(`> auto setup: ${result.summary ?? "applied"}`);
          await loadAiRouting({ syncControls: true });
          await refreshCliStatus();
        } catch (error) {
          autoSetupStatus.textContent = `Auto setup failed: ${error.message}`;
          studioLog(`! auto setup: ${error.message}`);
        } finally {
          autoSetupButton.disabled = false;
        }
      });
      // The host's own first-launch pass: show its record and re-read the
      // controls it changed, unless the button was already pressed here.
      window.mefiStudio.onAutoSetup?.((record) => {
        if (!autoSetupPressed) renderAutoSetupRecord(record);
        studioLog(`> auto setup (first launch): ${record?.summary ?? "applied"}`);
        void loadAiRouting({ syncControls: true }).then(() => refreshCliStatus()).catch(() => {});
      });
    }
    // Making a brain map live, or the walkthrough's Use this setup, rewrites
    // routing behind an open Settings page: re-read what it shows.
    const rereadSettings = () => {
      void loadAiRouting({ syncControls: true }).then(() => refreshCliStatus()).catch(() => {});
      void refreshJev();
    };
    window.mefiStudio?.onBrainsActive?.(rereadSettings);
    window.mefiStudio?.onSettingsChanged?.(rereadSettings);

    // Coding CLIs: launch the owner's installed tools in their own terminal.
    // Grok, Codex, Claude Code and Antigravity use their own accounts;
    // OpenCode carries the Studio-managed mefi-zai provider when a z.ai key
    // is saved.
    const cliStatus = document.getElementById("cli-status");
    async function refreshCliStatus() {
      try {
        const clis = await window.mefiStudio.cliStatus();
        setup.clis = Array.isArray(clis) ? clis : [];
        setup.cliError = false;
        cliStatus.textContent = clis.map((cli) => `${cli.name} ${cli.installed ? "✓" : "not found"}`).join(" · ");
        document.querySelectorAll("#studio-desktop button[data-cli]").forEach((button) => {
          const match = clis.find((cli) => cli.id === button.dataset.cli);
          button.disabled = Boolean(match && !match.installed);
        });
        document.querySelectorAll("#studio-desktop [data-cli-status]").forEach((pill) => {
          const match = clis.find((cli) => cli.id === pill.dataset.cliStatus);
          setPill(pill, !match ? "unknown" : match.installed ? "ready" : "missing", !match ? "not checked" : match.installed ? "installed" : "not found");
        });
      } catch {
        cliStatus.textContent = "CLI status unavailable";
        setup.cliError = true;
        document.querySelectorAll("#studio-desktop [data-cli-status]").forEach((pill) => setPill(pill, "unknown", "status unavailable"));
      }
      renderSetupState();
    }
    refreshCliStatus();
    document.querySelectorAll("#studio-desktop button[data-cli]").forEach((button) => {
      button.addEventListener("click", async () => {
        studioLog(`> launch ${button.dataset.cli}`);
        const result = await window.mefiStudio.launchCli(button.dataset.cli);
        if (!result?.ok) studioLog(`! ${result?.error ?? "launch failed"}`);
      });
    });
    document.getElementById("cli-test-zai").addEventListener("click", async () => {
      studioLog("> test z.ai link (opencode models mefi-zai)");
      const result = await window.mefiStudio.testZai();
      if (!result?.ok) studioLog(`! ${result?.error ?? "test failed"}`);
    });

    document.getElementById("speed-go").addEventListener("click", async () => {
      const button = document.getElementById("speed-go");
      if (button.disabled) return;
      button.disabled = true;
      studioLog(`> speed probe ${speedModel.value}`);
      try {
        const result = await window.mefiStudio.speedProbe(speedModel.value);
        if (!result?.ok) studioLog(`! speed probe failed${result?.error ? ": " + result.error : ""}`);
        else if (await loadSpeeds()) renderCards();
      } catch (error) { studioLog(`! speed probe failed: ${error.message}`); }
      finally { button.disabled = false; }
    });

    actions.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      studioLog(`> ${action}`);
      try {
        if (action === "launch") await window.mefiStudio.launchStudio();
        if (action === "smoke") await window.mefiStudio.runSmoke();
        if (action === "game") await window.mefiStudio.launchGame();
        if (action === "stop") await window.mefiStudio.stopStudio();
      } catch (error) {
        studioLog(`! ${error.message}`);
      }
    });
  }

  // ---- wire up ----
  els.search.addEventListener("input", (event) => {
    state.search = event.target.value;
    if (cardFrame === null) cardFrame = requestAnimationFrame(renderCards);
  });
  els.chips.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    if (state.filters.has(chip.dataset.id)) state.filters.delete(chip.dataset.id);
    else state.filters.add(chip.dataset.id);
    renderChips();
    // The chips are rebuilt: keep keyboard focus on the one just toggled.
    els.chips.querySelector?.(`.chip[data-id="${chip.dataset.id}"]`)?.focus?.();
    renderCards();
  });
  els.sort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderSortHead();
    renderCards();
  });
  // A column name sorts by that column through the Sort select, so the
  // select's own picker and the header show the same choice.
  els.head?.addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-sort]");
    if (!button || button.dataset.sort === state.sort) return;
    els.sort.value = button.dataset.sort;
    els.sort.dispatchEvent(new Event("change", { bubbles: true }));
  });
  els.picks?.addEventListener("click", (event) => {
    const pick = event.target.closest?.(".catalog-pick[data-id]");
    if (pick) revealModel(pick.dataset.id);
  });
  document.getElementById("tabs").addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (!tab) return;
    // Route through nav so a tab click also closes an open sheet and leaves the
    // Command view with a "return" marker on #nav-command.
    if (window.MefiNav) window.MefiNav.go(tab.dataset.tab, {}, { source: "tabs" });
    else showTab(tab.dataset.tab);
  });
  wireSettingsNav();
  registerSettingsSearch();
  // renderer/nav.js sets the 0.5 layout once the page has loaded: Settings is
  // filed into its places then (or at the first Settings paint after it).
  const fileSettingsOnce = () => { if (fileSettingsV2()) paintSettingsRows(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fileSettingsOnce, { once: true });
  else fileSettingsOnce();
  document.getElementById("refresh-btn").addEventListener("click", () => refresh("manual"));
  document.getElementById("print-btn").addEventListener("click", () => window.print());

  // Motion: Full, Calm or Off, in Settings › Your Studio. #motion-toggle is the
  // select the segmented buttons mirror. Off is body.no-motion, which MefiNav,
  // the canvases and every stylesheet read. Calm puts .ws-still on the body
  // alone: looping CSS animations stop (the companion too); transitions still
  // ease, and the live node tree keeps moving. Stored as before, "1" Full and "0"
  // Off, with "calm" beside them.
  const MOTION_LEVELS = ["full", "calm", "off"];
  const motionToggle = document.getElementById("motion-toggle");
  const savedMotion = readStore("mefiStudio.motion");
  let motionLevel = savedMotion === "0" ? "off" : savedMotion === "calm" ? "calm" : "full";
  let motionOnLevel = motionLevel === "off" ? "full" : motionLevel;
  const paintMotion = () => {
    for (const button of document.querySelectorAll('[data-segmented-for="motion-toggle"] button[data-value]')) button.setAttribute("aria-pressed", String(button.dataset.value === motionLevel));
    // Calm and Off already keep the companion still; its own switch waits for Full.
    const companion = document.getElementById("workspace-motion");
    if (companion) companion.disabled = motionLevel !== "full";
  };
  const applyMotion = (level) => {
    motionLevel = MOTION_LEVELS.includes(level) ? level : "full";
    if (motionLevel !== "off") motionOnLevel = motionLevel;
    document.body.classList.toggle("no-motion", motionLevel === "off");
    document.body.classList.toggle("ws-still", motionLevel === "calm");
    window.MefiNav?.syncMotion?.();
    writeStore("mefiStudio.motion", motionLevel === "off" ? "0" : motionLevel === "calm" ? "calm" : "1");
    if (motionToggle) motionToggle.value = motionLevel;
    paintMotion();
  };
  applyMotion(motionLevel);
  motionToggle?.addEventListener("change", () => applyMotion(motionToggle.value));
  // The select is hidden from the pointer and the keyboard, so a click on it
  // is the palette's "Toggle animations": Off, and back to the level before.
  motionToggle?.addEventListener("click", () => applyMotion(motionLevel === "off" ? motionOnLevel : "off"));
  for (const group of document.querySelectorAll('[data-segmented-for="motion-toggle"]')) {
    group.addEventListener("click", (event) => {
      const button = event.target?.closest?.("button[data-value]");
      if (button) applyMotion(button.dataset.value);
    });
  }

  // tasks.js repaints html[data-no-blur] when the preference changes anywhere.
  if (typeof MutationObserver === "function" && document.documentElement) {
    new MutationObserver(syncBlurBox).observe(document.documentElement, { attributes: true, attributeFilter: ["data-no-blur"] });
  }

  // The help sheet is nav's transient layer: claim/release only on a real state
  // change, so a second toggleHelp(true) cannot re-save the focus opener.
  const helpOverlay = document.getElementById("help-overlay");
  const toggleHelp = (show) => {
    const next = show === undefined ? helpOverlay.hidden : Boolean(show);
    if (next === !helpOverlay.hidden) return;
    if (next) {
      window.MefiNav?.claim?.("help");
      window.MefiNav?.renderHelp?.();
      helpOverlay.hidden = false;
    } else {
      helpOverlay.hidden = true;
      window.MefiNav?.release?.("help");
    }
  };
  document.getElementById("help-btn").addEventListener("click", () => {
    if (window.MefiNav) window.MefiNav.toggle("help");
    else toggleHelp();
  });
  helpOverlay.addEventListener("click", (event) => {
    if (event.target === helpOverlay) toggleHelp(false);
  });

  window.addEventListener("focus", () => {
    if (staleHours() > 6) refresh("focus");
  });
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!state.graph) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.graph.redraw(), 180);
  });

  // The one facade nav.js drives: tabs (with a Settings card to land on),
  // catalog refresh, the shortcut sheet, and the Settings jump itself.
  // settingsPlaces: the 0.5 layout's Settings places in order (null in the classic layout), for a list drawn elsewhere
  // (renderer/shell.js draws them in the list column). Asking files Settings into its places if nothing has yet.
  const settingsPlaces = () => {
    if (!settingsFiled) fileSettingsV2();
    return settingsFiled ? SETTINGS_PLACES.map((place) => ({ id: place.id, label: place.label, glyph: place.glyph, group: place.group ?? null, sub: Boolean(place.sub), route: place.route ?? null, current: !place.route && place.id === settingsCategory })) : null;
  };
  // settingsLocation: the place Settings shows, and whether Find a setting is showing results instead (null in the classic layout).
  const settingsLocation = () => (settingsFiled ? { id: settingsCategory, label: SETTINGS_CATEGORIES[settingsCategory] ?? settingsCategory, search: Boolean(settingsQuery()) } : null);
  window.MefiBooklet = { showTab, refresh, toggleHelp, jumpToSettings, initStudio, settingsPlaces, settingsLocation };

  const headless = new URLSearchParams(window.location.search);
  const capture = headless.get("capture") === "1";
  const smoke = headless.get("smoke") === "1";
  const wantCommand = !capture && !smoke && readStore("mefiStudio.commandHome") !== "0";

  window.MefiMusic?.init();
  window.MefiTree?.init();
  showTab(readStore("mefiStudio.tab") ?? "booklet");

  const paintCatalog = async ({ retry = false } = {}) => {
    renderAll();
    await Promise.all([
      loadSpeeds({ fresh: retry }).then((changed) => { if (changed) renderCards(); }),
      refresh("open", { fresh: retry }),
    ]);
  };

  if (capture || smoke) {
    // Diagnostic launches keep their existing direct navigation contract.
    const gate = document.getElementById("boot-layer");
    if (gate) gate.hidden = true;
    void paintCatalog();
    window.MefiOnboarding?.startup?.({ automatic: false });
  } else {
    let home = wantCommand;
    let restored = null;
    // Home is the mode's own: Vibe by default, Build's workspace when chosen.
    const enterHome = () => (window.MefiVibe?.landing?.() === "vibe" ? window.MefiVibe.enter() : window.MefiWorkspace?.enter?.());
    let viewPrepared = false;
    const prepareView = async ({ isCurrent }) => {
      if (window.mefiStudio?.prefsGet) {
        const result = await window.MefiBoot.read("prefsGet");
        if (!result?.ok) return false;
        if (!isCurrent()) return false;
        home = result.prefs?.commandHome !== false;
        writeStore("mefiStudio.commandHome", home ? "1" : "0");
      }
      if (!isCurrent()) return false;
      if (!restored) {
        const result = await window.MefiNav?.resumeReady?.({ isCurrent }) ?? { restored: window.MefiNav?.resume?.() ?? false };
        if (!isCurrent()) return false;
        restored = result;
      }
      if (!isCurrent()) return false;
      if (!restored.restored && home) enterHome();
      if (window.MefiIdle?.isActive?.()) await window.MefiIdle.ready();
      viewPrepared = true;
      return true;
    };
    // The launch screen (renderer/startup.js) runs first, under the gate. A
    // project chosen there is not the one the module-load reads used, so the
    // workspace and tree steps then reload instead of joining those reads.
    let launch = null;
    const choose = window.MefiStartup?.choose ? async (context) => { launch = await window.MefiStartup.choose(context); return launch; } : null;
    const relaunch = () => Boolean(launch?.changed);
    // The shell's scripts ran to the point of starting: tell the host, which
    // an installing update helper is waiting to hear from (main.cjs "Release
    // updates: the safety net"). Idempotent, and a failure is nothing to act on.
    Promise.resolve(window.mefiStudio?.bootHealthy?.()).catch(() => {});
    window.MefiBoot.run([
      { id: "workspace", label: "Your projects and work", load: (context) => { const retry = context.retry || relaunch(); return window.MefiWorkspace?.ready?.({ retry }); } },
      { id: "catalog", label: "Model catalog", load: paintCatalog },
      { id: "tree", label: "Session tree", load: async ({ retry }) => {
        await (retry || relaunch() ? window.MefiTree?.reload?.() : window.MefiTree?.ready?.());
        return window.MefiTree?.status?.() !== "unavailable";
      } },
      { id: "view", label: "Saved view and preferences", load: prepareView },
      // A window that paints nothing (covered, or in the tray) never lays text
      // out, so its fonts never finish; the studio opens on fallbacks instead.
      { id: "fonts", label: "Fonts and interface", load: () => Promise.race([document.fonts?.ready, new Promise((resolve) => setTimeout(resolve, 4000))]) },
    ], (complete, choice) => {
      if (!viewPrepared && !restored?.restored && home) enterHome();
      if (restored?.restored) restored.finish?.();
      else if (window.MefiWorkspace?.isActive?.()) document.getElementById("workspace-layer")?.focus({ preventScroll: true });
      else if (window.MefiVibe?.isActive?.()) document.getElementById("vibe-layer")?.focus({ preventScroll: true });
      else document.getElementById("search")?.focus({ preventScroll: true });
      // The setup helper comes first on a new profile, and once after an
      // update that brings it something new (renderer/setup-helper.js). The
      // walkthrough's own first open waits until the helper closes.
      const walkthrough = () => window.MefiOnboarding?.startup?.({ automatic: true });
      // The helper hands on: its "Continue to the guided tour" opens the tour;
      // any other close leaves it waiting in Start here, with one toast to start it.
      const afterHelper = ({ tour = false } = {}) => {
        if (tour) { walkthrough(); return; }
        if (window.MefiOnboarding?.invite?.()) window.MefiToast?.("The guided tour waits in Start here whenever you want it.", "info", { action: { label: "Start the tour", run: () => window.MefiOnboarding?.open?.() } });
      };
      if (!window.MefiSetupHelper?.startup?.({ then: afterHelper })) walkthrough();
      // The one-time "what's new" card for a returning profile (renderer/vibe.js).
      window.MefiVibe?.startup?.();
      // Community status and the weekly Discord card's quiet schedule
      // (renderer/community.js). Diagnostic launches skip it.
      window.MefiCommunity?.startup?.();
      // "Open and start agents": the studio is up, so the agents may start now.
      // Every other choice leaves them held for the workspace's Start agents.
      if ((choice ?? launch)?.startAgents) void window.MefiStartup?.begin?.();
    }, choose ? { choose } : {});
  }
})();
