// Mefi's Studio AI+ — booklet renderer, filters, refresh-on-open, studio launcher UI.
(function () {
  "use strict";
  const { fmt, privacyLabel } = window.MefiGraph;
  // Tell the Start here walkthrough that a provider connection was saved. Only
  // a successful save announces; a failed or cancelled save must not advance it.
  const noteConnectionSaved = (which) => {
    try { if (typeof CustomEvent === "function" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent("mefi:connection-saved", { detail: { provider: which || null } })); } catch {}
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
    const handle = window.MefiToast(message, options.kind || "info", {
      duration: Number(options.duration) || 12000,
      action: { label: options.label || "Confirm", run: () => { settle(true); restore(); } },
      secondary: { label: options.cancelLabel || "Cancel", run: () => { settle(false); restore(); } },
      onDismiss: () => settle(false),
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
    search: document.getElementById("search"),
    chips: document.getElementById("chips"),
    sort: document.getElementById("sort"),
    cards: document.getElementById("cards"),
    count: document.getElementById("count"),
    footer: document.getElementById("footer-meta"),
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

  function badgeHtml(model) {
    const badges = [];
    if (model.usage?.unlimited) badges.push('<span class="badge free">free ∞</span>');
    else if (model.pricing?.default?.input === 0) badges.push('<span class="badge free">free</span>');
    if (model.usage?.monthlyCapUSD === 15) badges.push('<span class="badge premium">$15 pool</span>');
    if (model.usage?.promo) badges.push(`<span class="badge new">${model.usage.promo}</span>`);
    if (model.legacy) badges.push('<span class="badge legacy">legacy</span>');
    if (model.experimental) badges.push('<span class="badge new">experimental</span>');
    if (model.privacy?.training) badges.push('<span class="badge trains">trains</span>');
    const released = model.releaseDate ? Date.parse(model.releaseDate) : NaN;
    if (!model.legacy && !Number.isNaN(released) && Date.now() - released < 1000 * 60 * 60 * 24 * 90) badges.push('<span class="badge new">new</span>');
    return badges.join("");
  }

  function statHtml(key, value, sub) {
    return `<div class="stat"><div class="k">${key}</div><div class="v">${value}</div><div class="s">${sub ?? ""}</div></div>`;
  }

  function cardHtml(model) {
    const price = model.pricing?.default;
    const requests = model.usage?.requests;
    const req5 = requests?.h5 === "unlimited" ? "∞" : requests?.h5 != null ? fmt.int(requests.h5) : "—";
    const pool = model.usage?.monthlyCapUSD === "unlimited" ? "∞" : model.usage?.monthlyCapUSD != null ? "$" + model.usage.monthlyCapUSD + "/mo" : "—";
    const variantRows = (model.variants ?? [])
      .map(
        (v) => `<tr><td>${v.condition}</td><td class="num">${fmt.money(v.input)}</td><td class="num">${fmt.money(v.output)}</td><td class="num">${v.cacheRead != null ? fmt.money(v.cacheRead) : "—"}</td></tr>`
      )
      .join("");
    const benchmarks = (model.quality?.benchmarks ?? []).map((b) => `<li>${b}</li>`).join("");
    const modalities = model.capabilities?.modalities?.input?.join(" + ") ?? "—";
    return `<article class="card" data-id="${model.id}">
      <div class="card-head">
        <div><h3>${model.name}</h3><div class="vendor">${model.vendor} · opencode-go/${model.id}</div></div>
        <div class="badges">${badgeHtml(model)}</div>
      </div>
      <p class="verdict">${model.verdict ?? "No curated verdict yet."}</p>
      <div class="stat-grid">
        ${statHtml("$ / request", fmt.money(model.typicalCostUSD), "typical mix")}
        ${statHtml("Quality", model.quality?.index ?? "—", model.quality?.declared === "AA" ? `AA II ${model.quality.indexVersion ?? ""}`.trim() : "unmeasured")}
        ${statHtml("req / 5h", req5, pool)}
        ${statHtml("Context", fmt.ctx(model.limits?.context), model.limits?.output ? fmt.ctx(model.limits.output) + " out" : "")}
        ${statHtml("privacy", model.privacy?.training ? "trains" : model.privacy?.retentionDays === 0 ? "0-day" : model.privacy?.retentionDays != null ? model.privacy.retentionDays + "d" : "—", "retention")}
        ${statHtml("$/1M", price ? fmt.money(price.input) + " in" : "—", price ? fmt.money(price.output) + " out" : "")}
      </div>
      <div class="use-avoid">
        ${(model.useFor ?? []).map((u) => `<span>${u}</span>`).join("")}
        ${(model.avoidFor ?? []).map((a) => `<span class="avoid">${a}</span>`).join("")}
      </div>
      <details>
        <summary>details</summary>
        <table class="detail">
          <tr><th>standard price</th><td class="num">${price ? fmt.money(price.input) + " in / " + fmt.money(price.output) + " out / " + fmt.money(price.cacheRead) + " cached" : "—"}</td></tr>
          ${variantRows ? `<tr><th>variants</th><td class="num"><table class="detail"><tr><th>condition</th><th class="num">in</th><th class="num">out</th><th class="num">cached</th></tr>${variantRows}</table></td></tr>` : ""}
          <tr><th>requests</th><td>${requests ? `5h ${fmt.int(requests.h5)} · week ${fmt.int(requests.week)} · month ${fmt.int(requests.month)}` : "—"}</td></tr>
          <tr><th>privacy</th><td>${privacyLabel(model)}${model.privacy?.note ? " — " + model.privacy.note : ""}</td></tr>
          <tr><th>input</th><td>${modalities}</td></tr>
          <tr><th>endpoint</th><td>${model.endpoint ? model.endpoint.label + " · " + model.endpoint.sdk : "—"}</td></tr>
          <tr><th>tools / reasoning</th><td>${model.capabilities?.toolCall === false ? "no" : "yes"} / ${model.capabilities?.reasoning === false ? "no" : "yes"}</td></tr>
          ${benchmarks ? `<tr><th>benchmarks</th><td><ul>${benchmarks}</ul></td></tr>` : ""}
          <tr><th>released</th><td>${model.releaseDate ?? "—"}${model.knowledge ? " · knowledge " + model.knowledge : ""}</td></tr>
          ${state.speeds[model.id] ? `<tr><th>measured</th><td>${state.speeds[model.id].tokensPerSecond ?? "—"} t/s · ${new Date(state.speeds[model.id].measuredAt).toLocaleString()} · measured on your machine</td></tr>` : ""}
        </table>
      </details>
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
    const sorters = {
      quality: (a, b) => num(b.quality?.index) - num(a.quality?.index) || a.name.localeCompare(b.name),
      cost: (a, b) => num(a.typicalCostUSD ?? 0) - num(b.typicalCostUSD ?? 0) || a.name.localeCompare(b.name),
      speed: (a, b) => num(b.usage?.requests?.h5) - num(a.usage?.requests?.h5) || a.name.localeCompare(b.name),
      context: (a, b) => num(b.limits?.context) - num(a.limits?.context) || a.name.localeCompare(b.name),
      pool: (a, b) => num(b.usage?.monthlyCapUSD) - num(a.usage?.monthlyCapUSD) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    models = models.sort(sorters[state.sort] ?? sorters.name);
    return models;
  }

  function renderChips() {
    els.chips.innerHTML = FILTERS.map((f) => `<span class="chip ${state.filters.has(f.id) ? "on" : ""}" data-id="${f.id}">${f.label}</span>`).join("");
  }

  function renderPlan() {
    const plan = state.doc.plan;
    els.plan.innerHTML = `
      <span><b>${plan.name}</b> · ${fmt.money(plan.priceUSDMonth)}/month</span>
      <span>windows: <b>${fmt.money(plan.window5hUSD)}</b>/5h · <b>${fmt.money(plan.weekUSD)}</b>/week · <b>${fmt.money(plan.monthUSD)}</b>/month</span>
      <span>per-model pool: 5h = 20%, week = 50%, month = 100%</span>`;
  }

  function renderStatus() {
    const doc = state.doc;
    const roster = doc.models.filter((m) => m.onRoster).length;
    els.status.textContent = `${doc.models.length} models (${roster} live) · data: ${state.source} · built ${new Date(doc.generatedAt).toLocaleString()} · hash ${doc.hash.slice(0, 8)}`;
    els.footer.textContent = `catalog hash ${doc.hash.slice(0, 12)} · roster ${doc.rosterHash.slice(0, 12)}`;
  }

  function renderCards() {
    if (cardFrame !== null) { cancelAnimationFrame(cardFrame); cardFrame = null; }
    const models = visibleModels();
    const markup = models.map((model) => {
      if (!cardCache.has(model)) cardCache.set(model, cardHtml(model));
      return cardCache.get(model);
    }).join("");
    // Keep expanded details and focus when a refresh returns identical data.
    if (renderedCardMarkup !== markup) {
      els.cards.innerHTML = markup;
      renderedCardMarkup = markup;
    }
    els.count.textContent = `${models.length} of ${state.doc.models.length} models shown`;
  }

  function renderAll() {
    renderPlan();
    renderStatus();
    renderChips();
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
  const PAGE_TITLES = { booklet: "Model catalog", graph: "Model Lab", eyes: "Activity & evidence", studio: "Settings" };
  function showTab(name, params = {}) {
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
      if (params?.section) jumpToSettings(params.section);
    }
    writeStore("mefiStudio.tab", name);
  }

  // ---- settings section nav ----
  // The Settings tab is one page of cards in three blocks (Connections,
  // Personal, System). The sticky list beside it finds a setting, jumps to a
  // card (opening it when it is folded) and follows the scroll position.
  // Desktop-only cards — the #studio-desktop wrapper, and anything marked
  // data-desktop-only — drop out of the list in the browser build.
  function settingsSections() {
    return Array.from(document.querySelectorAll("#settings-nav [data-settings-jump]")).map((button) => ({ button, section: document.getElementById(button.dataset.settingsJump) }));
  }

  // initStudio hides #studio-desktop when there is no desktop bridge.
  const settingsBrowserBuild = () => Boolean(document.getElementById("studio-desktop")?.hidden);
  function settingsAvailable(node) {
    if (!node) return false;
    if (node.closest?.("#studio-desktop[hidden]")) return false;
    return !(settingsBrowserBuild() && node.closest?.("[data-desktop-only]"));
  }

  // Writes only what changed, so a keystroke in Find touches only the rows it moves.
  const setShown = (node, shown) => { if (node && node.hidden === shown) node.hidden = !shown; };

  // A deep link may name a card by its old id or by what it is called now.
  const SETTINGS_ALIASES = { providers: "settings-assistant", appearance: "settings-studio", you: "settings-studio" };
  function settingsTarget(section) {
    const key = String(section ?? "").trim();
    if (!key) return null;
    const bare = key.replace(/^settings-/, "");
    const id = SETTINGS_ALIASES[key] ?? SETTINGS_ALIASES[bare] ?? `settings-${bare}`;
    return document.getElementById(id) ? id : null;
  }

  function syncSettingsNav(currentId) {
    const items = settingsSections();
    if (!items.length) return;
    let current = currentId ?? items.find(({ button }) => button.getAttribute("aria-current") === "true")?.button.dataset.settingsJump ?? null;
    if (current && items.find(({ button }) => button.dataset.settingsJump === current)?.button.hidden !== false) current = null;
    if (!current) current = items.find(({ button }) => !button.hidden)?.button.dataset.settingsJump ?? null;
    const was = items.find(({ button }) => button.getAttribute("aria-current") === "true")?.button.dataset.settingsJump ?? null;
    if (current === was) return;
    // The scroll-spy calls this every frame of a scroll; only a change writes.
    for (const { button } of items) button.setAttribute("aria-current", String(button.dataset.settingsJump === current));
    revealSettingsChip(items.find(({ button }) => button.dataset.settingsJump === current)?.button);
  }

  // A narrow panel lays the list out as one row of chips that scrolls sideways
  // (styles.css): keep the current chip inside that row, moving only the row.
  function revealSettingsChip(button) {
    const list = document.getElementById("settings-nav-list");
    if (!button || !list || !(list.scrollWidth > list.clientWidth + 1)) return;
    const box = button.getBoundingClientRect?.();
    const view = list.getBoundingClientRect?.();
    if (!box || !view) return;
    if (box.left < view.left) list.scrollLeft -= view.left - box.left + 12;
    else if (box.right > view.right) list.scrollLeft += box.right - view.right + 12;
  }

  // ---- Find a setting ----
  // Each row matches on its label, its data-settings-terms and its card's title
  // and summary. Rows and cards that do not match step aside, a group or block
  // left empty goes with them, and the count is announced.
  const settingsQuery = () => String(document.getElementById("settings-find")?.value ?? "").trim().toLowerCase();
  function settingsHaystack(row, card) {
    // A <section> card can hold a <details> of its own (How Jev chooses), so
    // only a folding card reads its summary.
    const head = card?.querySelector?.(card.tagName === "DETAILS" ? "summary" : ".settings-card-head") ?? null;
    return `${row.textContent ?? ""} ${row.dataset?.settingsTerms ?? ""} ${head?.textContent ?? ""}`.toLowerCase();
  }
  function paintSettingsRows() {
    const nav = document.getElementById("settings-nav");
    if (!nav?.querySelectorAll) return 0;
    const query = settingsQuery();
    const words = query.split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const row of nav.querySelectorAll(".settings-nav-item")) {
      const jump = row.dataset?.settingsJump;
      const card = jump ? document.getElementById(jump) : null;
      const available = jump ? settingsAvailable(card) : settingsAvailable(row);
      const match = available && words.every((word) => settingsHaystack(row, card).includes(word));
      setShown(row, match);
      if (card) setShown(card, match);
      if (match) shown += 1;
    }
    for (const group of nav.querySelectorAll(".settings-nav-group")) {
      setShown(group, Array.from(group.querySelectorAll?.(".settings-nav-item") ?? []).some((row) => !row.hidden));
    }
    // An unfiltered block always shows: the browser build's Connections block
    // carries only its desktop note.
    for (const block of document.querySelectorAll("#settings-sections .settings-block")) {
      setShown(block, !words.length || Array.from(block.querySelectorAll?.(".settings-card") ?? []).some((card) => !card.hidden && settingsAvailable(card)));
    }
    const empty = document.getElementById("settings-find-empty");
    if (empty) empty.hidden = !words.length || shown > 0;
    const status = document.getElementById("settings-find-status");
    if (status) status.textContent = !words.length ? "" : shown ? `${shown} setting${shown === 1 ? "" : "s"}` : "No settings match";
    return shown;
  }
  function clearSettingsFind() {
    const find = document.getElementById("settings-find");
    if (find) find.value = "";
    settingsPinned = null;
    paintSettingsRows();
    syncSettingsNav();
  }

  // The walkthrough coach keeps keyboard focus on its own Next while it points
  // into Settings, so a jump under it scrolls without moving focus.
  const coachShowing = () => { const coach = document.getElementById("walkthrough-coach"); return Boolean(coach && !coach.hidden); };
  function focusSettingsCard(card) {
    const target = card.tagName === "DETAILS" ? card.querySelector?.("summary") : card.querySelector?.("h3");
    if (!target) return;
    if (card.tagName !== "DETAILS" && !target.hasAttribute?.("tabindex")) target.setAttribute?.("tabindex", "-1");
    target.focus?.({ preventScroll: true });
  }

  // One jump for the list, Find's Enter and deep links: open the card, bring it
  // in (smoothly unless motion is off), mark it current, and hold the
  // scroll-spy while the scroll runs so the cards it passes do not flicker.
  // The card a jump lands on then stays current until the reader scrolls on.
  let settingsSpyHold = 0;
  let settingsPinned = null;
  function holdSettingsSpy() {
    settingsSpyHold = Date.now() + 700;
    // A long smooth scroll outlasts 700 ms, and its last frames would light
    // whatever card they pass (the last one, at the page's end). Where
    // scrollend exists, hold until the scroll settles and one frame more.
    if (typeof window.onscrollend === "undefined" || typeof window.addEventListener !== "function") return;
    settingsSpyHold = Date.now() + 1200;
    window.addEventListener("scrollend", () => { settingsSpyHold = Math.min(settingsSpyHold, Date.now() + 120); }, { once: true });
  }
  function jumpToSettings(section, { focus = true } = {}) {
    const id = settingsTarget(section);
    let card = id ? document.getElementById(id) : null;
    if (!card) return false;
    if (card.hidden && settingsQuery() && settingsAvailable(card)) clearSettingsFind();
    // A desktop-only card in the browser build: its block says why it is missing.
    const available = settingsAvailable(card);
    if (!available) card = card.closest?.(".settings-block") ?? card;
    // A folded card opens at its full height at once (styles.css stills its
    // open animation for this), so the scroll measures the card it lands on;
    // near the page's end a card still growing would land low.
    const unfold = available && card.tagName === "DETAILS" && !card.open;
    if (unfold) {
      card.setAttribute?.("data-settings-opening", "");
      card.open = true;
    }
    holdSettingsSpy();
    try {
      card.scrollIntoView?.({ behavior: window.MefiNav?.noMotion?.() ? "auto" : "smooth", block: "start" });
    } catch {
      card.scrollIntoView?.();
    }
    if (unfold) card.removeAttribute?.("data-settings-opening");
    if (!available) return false;
    settingsPinned = id;
    syncSettingsNav(id);
    if (focus && !coachShowing()) focusSettingsCard(card);
    return true;
  }

  // ---- scroll-spy ----
  // The current card is the last one whose top has passed a line 30% down the
  // window, and at the very end of the page the last card (the page cannot
  // scroll far enough to bring the final cards to any line). It is read from
  // every card's position, never from the observer's entries, which name only
  // the cards that just crossed an edge: a sliver of the card above a deep
  // link's target could win that way.
  function atSettingsEnd() {
    const root = document.scrollingElement ?? document.documentElement;
    const top = Number(window.scrollY ?? root?.scrollTop ?? 0);
    const height = Number(window.innerHeight ?? 0);
    return Boolean(root?.scrollHeight) && height > 0 && top > 0 && top + height >= root.scrollHeight - 2;
  }
  function spySettings() {
    if (Date.now() < settingsSpyHold || document.getElementById("tab-studio")?.hidden !== false) return;
    const items = settingsSections().filter(({ button, section }) => !button.hidden && section && !section.hidden);
    if (!items.length) return;
    const height = Number(window.innerHeight ?? 0);
    if (settingsPinned) {
      const box = items.find(({ section }) => section.id === settingsPinned)?.section.getBoundingClientRect?.();
      if (box && box.bottom > 0 && box.top < height) {
        syncSettingsNav(settingsPinned);
        return;
      }
      settingsPinned = null;
    }
    if (atSettingsEnd()) {
      syncSettingsNav(items.at(-1).button.dataset.settingsJump);
      return;
    }
    let current = items[0];
    for (const item of items) {
      if ((item.section.getBoundingClientRect?.().top ?? 0) > height * 0.3) break;
      current = item;
    }
    syncSettingsNav(current.button.dataset.settingsJump);
  }
  let settingsScrollFrame = 0;
  function onSettingsScroll() {
    if (document.getElementById("tab-studio")?.hidden !== false) return;
    // A scroll that is not a jump's own is the reader moving on.
    if (Date.now() >= settingsSpyHold) settingsPinned = null;
    if (settingsScrollFrame || typeof requestAnimationFrame !== "function") return;
    settingsScrollFrame = requestAnimationFrame(() => {
      settingsScrollFrame = 0;
      spySettings();
    });
  }

  function openFirstSetting() {
    const first = Array.from(document.querySelectorAll("#settings-nav .settings-nav-item")).find((row) => !row.hidden);
    if (!first) return;
    if (first.dataset.settingsJump) jumpToSettings(first.dataset.settingsJump);
    else first.click?.();
  }

  function wireSettingsNav() {
    const nav = document.getElementById("settings-nav");
    if (!nav) return;
    nav.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-settings-jump]");
      if (button) jumpToSettings(button.dataset.settingsJump, { focus: false });
    });
    const find = document.getElementById("settings-find");
    find?.addEventListener?.("input", () => {
      paintSettingsRows();
      // The first match leads, and is what Enter opens, until the reader scrolls.
      const first = settingsSections().find(({ button }) => !button.hidden)?.button.dataset.settingsJump;
      settingsPinned = settingsQuery() ? first ?? null : null;
      syncSettingsNav(first);
    });
    find?.addEventListener?.("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault?.();
        openFirstSetting();
      } else if (event.key === "Escape" && find.value) {
        // The first Esc clears the search and keeps focus; an empty field lets
        // Esc through to nav, which leaves the field as usual.
        event.preventDefault?.();
        event.stopPropagation?.();
        clearSettingsFind();
      }
    });
    // Buttons in a card that open another view. nav.js's [data-nav] delegate
    // folds the <details> around the button (it is written for menus), and a
    // card has to stay open, so these name their destination here instead.
    document.getElementById("settings-sections")?.addEventListener?.("click", (event) => {
      const button = event.target?.closest?.("[data-settings-nav]");
      if (!button || button.disabled) return;
      event.preventDefault?.();
      window.MefiNav?.go?.(button.dataset.settingsNav);
    });
    window.addEventListener?.("scroll", onSettingsScroll, { passive: true });
    // The observer only says when to look again: a card crossed the band
    // without a scroll (one opened or closed, Find filtered the page).
    if (typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(() => spySettings(), { rootMargin: "-15% 0px -65% 0px" });
    for (const { section } of settingsSections()) if (section) observer.observe(section);
  }

  // Search Studio finds every Settings card: "Settings › Providers" opens it.
  function registerSettingsSearch() {
    if (typeof window.MefiNav?.register !== "function") return;
    const desktop = Boolean(window.mefiStudio?.launchStudio);
    for (const button of document.querySelectorAll("#settings-nav [data-settings-jump]")) {
      const jump = button.dataset.settingsJump;
      const card = document.getElementById(jump);
      if (!card || (!desktop && (card.closest?.("#studio-desktop") || card.closest?.("[data-desktop-only]")))) continue;
      const label = String(button.querySelector?.(".label")?.textContent ?? button.textContent ?? "").trim();
      const summary = card.querySelector?.(".settings-summary-text span, .settings-card-head p");
      try {
        window.MefiNav.register({
          id: `settings:${jump}`,
          label: `Settings › ${label}`,
          short: label,
          kind: "action",
          layer: null,
          section: "settings",
          group: "system",
          key: null,
          glyph: button.querySelector?.("use")?.getAttribute?.("href")?.replace(/^#/, "") ?? null,
          badge: null,
          desc: String(summary?.textContent ?? "").trim(),
          searchTerms: button.dataset.settingsTerms ?? "",
          showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
          run: () => window.MefiNav?.go?.("studio", { section: jump }),
        });
      } catch {
        /* a registry that refuses one entry leaves Search as it was */
      }
    }
  }

  // #pref-blur sits in Settings › Your Studio. tasks.js owns the preference:
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
    function paintStylerStatus(status) {
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
    const setup = { keys: { opencode: null, zai: null, custom: null }, routing: null, clis: null, routingError: false, cliError: false };
    const setupAssistant = document.getElementById("setup-assistant");
    const setupSelection = document.getElementById("setup-selection");
    const setupBuilders = document.getElementById("setup-builders");
    // One registry for every route Studio can answer with. The routing and
    // builder pickers are rebuilt from it plus the live flags below, so what
    // is ready on this machine reads first and anything else stays selectable
    // with its missing piece named beside it.
    const providerNames = { auto: "Auto (your order)", zai: "z.ai GLM", opencode: "OpenCode Go", zen: "OpenCode Zen", grok: "Grok CLI", claude: "Claude Code CLI", codex: "Codex CLI", antigravity: "Antigravity CLI", lmstudio: "LM Studio (local)", custom: "Custom endpoint" };
    const providerKinds = { auto: "auto", zai: "key", opencode: "key", zen: "key", grok: "cli", claude: "cli", codex: "cli", antigravity: "cli", lmstudio: "local", custom: "custom" };
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
      const flag = which === "zai" ? setup.routing?.hasZai : which === "zen" ? setup.routing?.hasZen : setup.routing?.hasOpenCode;
      return flag === true ? "key saved" : flag === false ? "no key saved" : "key unknown";
    }
    // The auto order is tried top to bottom; usability here comes from the same
    // flags the readiness line already reads (saved keys, installed CLIs, the
    // local server), never a fresh probe.
    const autoOrderOf = (routing) => Array.isArray(routing?.autoProviders) && routing.autoProviders.length ? routing.autoProviders : ["zai", "opencode"];
    function autoProviderUsable(id) {
      if (id === "zai") return setup.keys.zai === true || setup.routing?.hasZai === true;
      if (id === "opencode") return setup.keys.opencode === true || setup.routing?.hasOpenCode === true;
      if (id === "zen") return setup.routing?.hasZen === true;
      if (id === "custom") return Boolean(setup.routing?.customEndpoint) && (setup.keys.custom === true || setup.routing?.hasCustom === true);
      if (id === "lmstudio") return true;
      return cliInstalled(id);
    }
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
        const first = autoOrderOf(setup.routing).find((entry) => autoProviderUsable(entry));
        return first ? { ready: true, note: `will use ${providerNames[first]}` } : { ready: false, note: "nothing in the order is ready yet" };
      }
      if (kind === "key") {
        const state = keyState(id);
        return { ready: state === "key saved" ? true : state === "no key saved" ? false : null, note: state };
      }
      if (kind === "custom") {
        if (!setup.routing && setup.keys.custom === null) return { ready: null, note: "checking…" };
        const endpoint = Boolean(setup.routing?.customEndpoint);
        const key = setup.keys.custom ?? setup.routing?.hasCustom === true;
        if (endpoint && key) return { ready: true, note: "endpoint and key saved" };
        return { ready: false, note: !endpoint && !key ? "no endpoint or key saved" : !endpoint ? "no endpoint saved" : "no key saved" };
      }
      if (kind === "local") return { ready: true, note: "local server · no key needed" };
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
      for (const select of [roleRoutine, roleHeavy]) renderPicker(select, [same, ...providers]);
      renderPicker(executorCli, builderIds.map((id) => entryFor(id, builderNames[id], cliAvailability(id))).sort(byReadiness));
      renderAutoOrder();
      renderAutoOrderAdd();
    }
    // Segmented controls mirror a <select> that stays the saved value: a
    // click sets the select and fires its change, and every routing read
    // re-syncs the pressed state. Without the markup (tests) they are no-ops.
    const segmentedGroups = Array.from(document.querySelectorAll("#studio-desktop [data-segmented-for]"));
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
        const order = autoOrderOf(routing);
        const autoFirst = order.find((id) => autoProviderUsable(id));
        const detail = provider === "grok" || provider === "claude" || provider === "codex" || provider === "antigravity" ? "CLI login"
          : provider === "lmstudio" ? "no key needed"
          : provider === "custom" ? (routing.hasCustom ? "key saved" : "no key saved")
          : provider === "auto" ? (autoFirst ? `will use ${providerNames[autoFirst]}` : "no usable provider in this order yet")
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
      }
      if (setup.routingError) setPill(setupSelection, "unknown", "status unavailable");
      else if (!routing) setPill(setupSelection, "unknown", "checking…");
      else if ((routing.modelSelection ?? "jev") === "fixed") setPill(setupSelection, "ready", "Fixed defaults · overrides win");
      else setPill(setupSelection, routing.jevConfigured ? "ready" : "missing", routing.jevConfigured ? "Jev · task fit, speed & cost" : "Jev · waiting for a gateway key");
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
        const order = autoOrderOf(routing).map((id) => `${providerNames[id] ?? id}${autoProviderUsable(id) ? "" : " (unavailable)"}`);
        readiness.textContent = `auto order: ${order.join(" → ")}`;
      }
      else if (selected === "zai" || selected === "opencode" || selected === "zen") readiness.textContent = `${keyState(selected)} — this provider's saved model applies`;
      else if (selected === "custom") readiness.textContent = `${routing.customEndpoint ? "endpoint saved" : "no endpoint saved"}, ${setup.keys.custom ? "key saved" : "no key saved"}`;
      else if (selected === "lmstudio") readiness.textContent = "local server — no key needed; its loaded model is detected automatically";
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
    const keyPills = { opencode: keyStatus, zai: zaiKeyStatus, custom: customKeyStatus };
    const showKeyState = (which, saved) => setPill(keyPills[which], saved ? "ready" : "missing", saved ? "key saved (encrypted)" : "no key saved");
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
    guardKeySave("custom-key", "save-custom-key", customKeyStatus, "Remove the saved custom-endpoint key");
    guardKeySave("jev-key", "save-jev-key", null, "");

    document.getElementById("save-key").addEventListener("click", async () => {
      const input = document.getElementById("api-key");
      const value = input.value.trim();
      if (!value && !clearingKey(input)) return;
      delete input.dataset.clearing;
      const result = await window.mefiStudio.setApiKey(value, "opencode");
      if (result?.ok) { setup.keys.opencode = Boolean(value); setPill(keyStatus, value ? "ready" : "missing", value ? "key saved (encrypted)" : "key cleared"); noteConnectionSaved("opencode"); }
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
      else noteConnectionSaved("zen");
      await refreshJev();
      await loadAiRouting();
    });

    document.getElementById("save-zai-key").addEventListener("click", async () => {
      const input = document.getElementById("zai-key");
      const value = input.value.trim();
      if (!value && !clearingKey(input)) return;
      delete input.dataset.clearing;
      const result = await window.mefiStudio.setApiKey(value, "zai");
      if (result?.ok) { setup.keys.zai = Boolean(value); setPill(zaiKeyStatus, value ? "ready" : "missing", value ? "key saved (encrypted)" : "key cleared"); noteConnectionSaved("zai"); }
      else setPill(zaiKeyStatus, "unknown", `save failed: ${result?.error ?? "unknown"}`);
      document.getElementById("zai-key").value = "";
      resyncKeySaves();
      await loadAiRouting();
    });

    // The custom endpoint's URL is saved like any routing preference; its key
    // rides the same encrypted setApiKey path as every other credential.
    document.getElementById("save-custom-key").addEventListener("click", async () => {
      const input = document.getElementById("custom-key");
      const value = input.value.trim();
      if (!value && !clearingKey(input)) return;
      delete input.dataset.clearing;
      const result = await window.mefiStudio.setApiKey(value, "custom");
      if (result?.ok) { setup.keys.custom = Boolean(value); setPill(customKeyStatus, value ? "ready" : "missing", value ? "key saved (encrypted)" : "key cleared"); noteConnectionSaved("custom"); }
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
        noteConnectionSaved(jevRouteFields[jevRouteOf()].key);
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
    function syncExecutorModel(routing) {
      const cli = executorCli.value || "opencode";
      const tier = tierNames[executorTier.value] ? executorTier.value : "auto";
      if (tier === "auto") {
        executorModelLabel.textContent = "Pinned model";
        executorModel.value = routing?.executorModel ?? "";
        executorModel.placeholder = "CLI default";
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
        ? `Auto: ${cli === "opencode" ? "Jev or the stand-in judge picks per task within your provider; a pinned model wins" : `${cliName} runs the pinned model or its CLI default`}.`
        : tier === "free" && !active.model
          ? `Free tier: no free model is saved for ${cliName}, so builds wait until one is${cli === "opencode" ? " (run the first scan, or save a free provider/model id)" : ""}.`
          : `${tierNames[tier]} tier: ${cliName} runs ${active.model || "its CLI default"}${tier === "free" ? ", one worker at a time" : ""}.`;
      const review = cli === "opencode" ? "" : ` ${cliName} leaves no session Studio can check, so its finished tasks wait for you to confirm them.`;
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
        const routing = await window.mefiStudio.getAiRouting();
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
                ? "The custom endpoint answers with the saved key. Save a model override when it serves more than one model."
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
    const autoProviderIds = ["zai", "opencode", "zen", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"];
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
    async function saveRouting(payload, confirmation, { syncControls = false } = {}) {
      try {
        const result = await window.mefiStudio.setAiRouting(payload);
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
    renderCards();
  });
  els.sort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderCards();
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
  window.MefiBooklet = { showTab, refresh, toggleHelp, jumpToSettings };

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
      if (!restored.restored && home) window.MefiWorkspace?.enter?.();
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
    window.MefiBoot.run([
      { id: "workspace", label: "Your projects and work", load: (context) => { const retry = context.retry || relaunch(); return window.MefiWorkspace?.ready?.({ retry }); } },
      { id: "catalog", label: "Model catalog", load: paintCatalog },
      { id: "tree", label: "Session tree", load: async ({ retry }) => {
        await (retry || relaunch() ? window.MefiTree?.reload?.() : window.MefiTree?.ready?.());
        return window.MefiTree?.status?.() !== "unavailable";
      } },
      { id: "view", label: "Saved view and preferences", load: prepareView },
      { id: "fonts", label: "Fonts and interface", load: () => document.fonts?.ready },
    ], (complete, choice) => {
      if (!viewPrepared && !restored?.restored && home) window.MefiWorkspace?.enter?.();
      if (restored?.restored) restored.finish?.();
      else if (window.MefiWorkspace?.isActive?.()) document.getElementById("workspace-layer")?.focus({ preventScroll: true });
      else document.getElementById("search")?.focus({ preventScroll: true });
      window.MefiOnboarding?.startup?.({ automatic: true });
      // Community status, the member-perk boot hint and the weekly Discord
      // card's quiet schedule (renderer/community.js). Diagnostic launches skip it.
      window.MefiCommunity?.startup?.();
      // "Open and start agents": the studio is up, so the agents may start now.
      // Every other choice leaves them held for the workspace's Start agents.
      if ((choice ?? launch)?.startAgents) void window.MefiStartup?.begin?.();
    }, choose ? { choose } : {});
  }
})();
