// Mefi's Studio AI+ — booklet renderer, filters, refresh-on-open, studio launcher UI.
(function () {
  "use strict";
  const { fmt, privacyLabel } = window.MefiGraph;

  // Global toasts: quiet confirmations that do not need a panel status line.
  window.MefiToast = (message, kind = "info") => {
    let host = document.getElementById("toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      document.body.append(host);
    }
    const toast = document.createElement("div");
    toast.className = `toast ${kind}`;
    toast.textContent = message;
    host.append(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 2600);
  };

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
  };

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
      return [model.name, model.vendor, model.id, model.verdict, ...(model.tags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(query);
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
    const models = visibleModels();
    els.cards.innerHTML = models.map(cardHtml).join("");
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
    renderAll();
    loadSpeeds().then(renderCards);
  }

  async function loadSpeeds() {
    try {
      if (window.mefiStudio?.speedMeasurements) {
        const result = await window.mefiStudio.speedMeasurements();
        state.speeds = result?.ok ? result.measurements ?? {} : {};
      } else {
        const url = new URL("../data/speed-measurements.json", window.location.href).href;
        const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
        state.speeds = response.ok ? await response.json() : {};
      }
    } catch {
      state.speeds = {};
    }
    state.graph?.setSpeeds?.(state.speeds);
  }

  // ---- refresh-on-open ----
  const DATA_URL = new URL("../data/models.json", window.location.href).href;

  async function liveDoc() {
    if (window.mefiStudio?.readCatalog) return { doc: await window.mefiStudio.readCatalog(), source: "live file" };
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return { doc: await response.json(), source: "live fetch" };
  }

  let refreshInFlight = false;
  async function refresh(reason) {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const { doc, source } = await liveDoc();
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
      showBanner(`Showing built-in data — live refresh failed (${error.message}).`, true);
    } finally {
      refreshInFlight = false;
    }
  }

  function staleHours() {
    const stamp = Number(readStore("mefiStudio.lastRefresh") || 0);
    return (Date.now() - stamp) / 3600000;
  }

  // ---- tabs ----
  function showTab(name) {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
    document.getElementById("tab-booklet").hidden = name !== "booklet";
    document.getElementById("tab-graph").hidden = name !== "graph";
    document.getElementById("tab-eyes").hidden = name !== "eyes";
    document.getElementById("tab-studio").hidden = name !== "studio";
    if (name === "graph") {
      if (!state.graph) state.graph = window.MefiGraph.mount(state.doc, { speeds: state.speeds });
      requestAnimationFrame(() => state.graph.redraw());
    }
    if (name === "eyes") window.MefiEyes?.init();
    writeStore("mefiStudio.tab", name);
  }

  // ---- studio ----
  function studioLog(line) {
    const log = document.getElementById("studio-log");
    log.textContent += `\n${line}`;
    log.scrollTop = log.scrollHeight;
  }

  function initStudio() {
    const actions = document.getElementById("studio-actions");
    const hint = document.getElementById("studio-hint");
    if (!window.mefiStudio?.launchStudio) {
      hint.textContent = "Desktop launcher not available in a plain browser. Run `npm start` inside mefi-studio to launch LÖVE directly from here.";
      actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
      document.getElementById("studio-desktop").hidden = true;
      return;
    }
    hint.textContent = "Uses the repo's cached LÖVE runtime; smoke goes through Run Dev Tool (LOVE2D).cmd --smoke.";
    window.mefiStudio.onStudioLog((line) => studioLog(line));

    const speedModel = document.getElementById("speed-model");
    speedModel.innerHTML =
      `<option value="glm-5.3-flash">GLM-5.3 Flash (z.ai)</option>` +
      `<option value="glm-5.3">GLM-5.3 (z.ai)</option>` +
      state.doc.models
        .filter((m) => m.onRoster && !m.legacy)
        .map((m) => `<option value="${m.id}" ${m.id === "deepseek-v4.1-flash" ? "selected" : ""}>${m.name}</option>`)
        .join("");

    const keyStatus = document.getElementById("key-status");
    const zaiKeyStatus = document.getElementById("zai-key-status");
    window.mefiStudio
      .getApiKey("opencode")
      .then((key) => (keyStatus.textContent = key?.saved ? "key saved (encrypted)" : "no key saved"))
      .catch(() => (keyStatus.textContent = "key status unavailable"));
    window.mefiStudio
      .getApiKey("zai")
      .then((key) => (zaiKeyStatus.textContent = key?.saved ? "key saved (encrypted)" : "no key saved"))
      .catch(() => (zaiKeyStatus.textContent = "key status unavailable"));

    document.getElementById("save-key").addEventListener("click", async () => {
      const value = document.getElementById("api-key").value.trim();
      const result = await window.mefiStudio.setApiKey(value, "opencode");
      keyStatus.textContent = result?.ok ? (value ? "key saved (encrypted)" : "key cleared") : `save failed: ${result?.error ?? "unknown"}`;
      document.getElementById("api-key").value = "";
    });

    document.getElementById("save-zai-key").addEventListener("click", async () => {
      const value = document.getElementById("zai-key").value.trim();
      const result = await window.mefiStudio.setApiKey(value, "zai");
      zaiKeyStatus.textContent = result?.ok ? (value ? "key saved (encrypted)" : "key cleared") : `save failed: ${result?.error ?? "unknown"}`;
      document.getElementById("zai-key").value = "";
      loadAiRouting();
    });

    // AI routing: who pays for assistant calls. Auto prefers the z.ai plan;
    // the OpenCode fallback switch exists so nothing bills OpenCode by surprise.
    // The model fields make the assistant's own model a choice: free-text ids
    // per role (routine / heavy), empty = the route's default; Grok routes the
    // passes through the grok CLI instead of an HTTP endpoint. "Builders run
    // on" moves the executor's build jobs between opencode run and the grok CLI.
    const providerSelect = document.getElementById("ai-provider");
    const fallbackToggle = document.getElementById("ai-fallback");
    const modelRoutine = document.getElementById("ai-model-routine");
    const modelHeavy = document.getElementById("ai-model-heavy");
    const executorCli = document.getElementById("executor-cli");
    const executorModel = document.getElementById("executor-model");
    async function loadAiRouting() {
      try {
        const routing = await window.mefiStudio.getAiRouting();
        providerSelect.value = routing.provider;
        fallbackToggle.checked = routing.fallbackOpenCode;
        modelRoutine.value = routing.models?.routine ?? "";
        modelHeavy.value = routing.models?.heavy ?? "";
        executorCli.value = routing.executorCli ?? "opencode";
        executorModel.value = routing.executorModel ?? "";
      } catch {}
    }
    loadAiRouting();
    providerSelect.addEventListener("change", async () => {
      const result = await window.mefiStudio.setAiRouting({ provider: providerSelect.value });
      if (!result?.ok) studioLog(`! routing: ${result?.error ?? "save failed"}`);
      else studioLog(`> assistant answers via ${providerSelect.value}`);
    });
    fallbackToggle.addEventListener("change", async () => {
      const result = await window.mefiStudio.setAiRouting({ fallbackOpenCode: fallbackToggle.checked });
      if (!result?.ok) studioLog(`! routing: ${result?.error ?? "save failed"}`);
    });
    const saveModel = (which, value) =>
      window.mefiStudio.setAiRouting({ models: { [which]: value } }).then((result) => {
        if (!result?.ok) studioLog(`! routing: ${result?.error ?? "save failed"}`);
        else studioLog(`> ${which} model ${value.trim() ? `"${value.trim()}"` : "reset to default"}`);
      });
    for (const [input, role] of [[modelRoutine, "routine"], [modelHeavy, "heavy"]]) {
      input.addEventListener("change", () => saveModel(role, input.value));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
    }
    executorCli.addEventListener("change", async () => {
      const result = await window.mefiStudio.setAiRouting({ executorCli: executorCli.value });
      if (!result?.ok) studioLog(`! builders: ${result?.error ?? "save failed"}`);
      else studioLog(`> builders run on ${executorCli.value}`);
    });
    executorModel.addEventListener("change", async () => {
      const result = await window.mefiStudio.setAiRouting({ executorModel: executorModel.value });
      if (!result?.ok) studioLog(`! builders: ${result?.error ?? "save failed"}`);
      else studioLog(`> builder model ${executorModel.value.trim() ? `"${executorModel.value.trim()}"` : "reset to default"}`);
    });

    // Coding CLIs: launch the owner's installed tools in their own terminal.
    // Codex and Claude Code use their own accounts; OpenCode carries the
    // Studio-managed mefi-zai provider when a z.ai key is saved.
    const cliStatus = document.getElementById("cli-status");
    async function refreshCliStatus() {
      try {
        const clis = await window.mefiStudio.cliStatus();
        cliStatus.textContent = clis.map((cli) => `${cli.name} ${cli.installed ? "✓" : "not found"}`).join(" · ");
        document.querySelectorAll("#studio-desktop button[data-cli]").forEach((button) => {
          const match = clis.find((cli) => cli.id === button.dataset.cli);
          button.disabled = Boolean(match && !match.installed);
        });
      } catch {
        cliStatus.textContent = "CLI status unavailable";
      }
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
      studioLog(`> speed probe ${speedModel.value}`);
      const result = await window.mefiStudio.speedProbe(speedModel.value);
      if (!result?.ok) studioLog(`! speed probe failed${result?.error ? ": " + result.error : ""}`);
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
    renderCards();
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
  document.getElementById("refresh-btn").addEventListener("click", () => refresh("manual"));
  document.getElementById("print-btn").addEventListener("click", () => window.print());
  const motionToggle = document.getElementById("motion-toggle");
  const applyMotion = (enabled) => {
    document.body.classList.toggle("no-motion", !enabled);
    writeStore("mefiStudio.motion", enabled ? "1" : "0");
  };
  motionToggle.checked = readStore("mefiStudio.motion") !== "0";
  applyMotion(motionToggle.checked);
  motionToggle.addEventListener("change", () => applyMotion(motionToggle.checked));

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

  // The one facade nav.js drives: tabs, catalog refresh and the shortcut sheet.
  window.MefiBooklet = { showTab, refresh, toggleHelp };

  const headless = new URLSearchParams(window.location.search);
  const capture = headless.get("capture") === "1";
  const smoke = headless.get("smoke") === "1";
  const wantCommand = !capture && !smoke && readStore("mefiStudio.commandHome") !== "0";

  initStudio();
  window.MefiTree?.init();
  showTab(readStore("mefiStudio.tab") ?? "booklet");

  const paintCatalog = () => {
    renderAll();
    loadSpeeds().then(renderCards);
    refresh("open");
  };

  // Command is the first paint on a cold launch: the booklet catalog can wait
  // until idle so the constellation is not competing with a card grid.
  if (wantCommand) {
    if (typeof requestIdleCallback === "function") requestIdleCallback(paintCatalog, { timeout: 1600 });
    else setTimeout(paintCatalog, 400);
  } else {
    paintCatalog();
  }

  // A live-update reload/restart restores what was open; otherwise the Command
  // view (interactive constellation) is the home surface. `commandHome` is the
  // opt-out pref, cached to localStorage by idle.js so an opted-out launch
  // never flashes Command; with no cache it opens optimistically and the async
  // prefs read backs it out only when the user really turned it off — a failed
  // or slow read must not strand the launch on the booklet.
  if (!capture && !smoke) {
    if (!window.MefiNav?.resume?.() && wantCommand) {
      const openHome = () => window.MefiIdle?.enter?.(true);
      // A cold launch runs the boot menu: the assistant reads every chat and
      // source with its agents (green adds, red cleanups), the tree builds
      // underneath, and the layer fades away into the ready constellation.
      if (window.MefiBoot?.run) window.MefiBoot.run(openHome);
      else {
        // Pre-boot bundle (stale build): the old blind timers still open home.
        setTimeout(openHome, 800);
        setTimeout(openHome, 2400);
      }
      window.mefiStudio
        ?.prefsGet?.()
        .then((result) => {
          if (result?.ok && result.prefs?.commandHome === false) {
            window.MefiBoot?.cancel?.();
            if (window.MefiIdle?.isActive?.()) window.MefiIdle.exit();
          }
        })
        .catch(() => {});
    }
  }
})();
