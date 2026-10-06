// Configuration: every setting Studio has, in one searchable tree (Build's
// Ctrl Shift ,). Settings lives in several places — Settings' own cards, the
// Agents setup panes, Appearance — and each of them registers its controls
// with the navigation registry as `settings:*` records for Search. This
// dialog reads those same records, files them under seven categories (by the
// page a setting lives on, then by its words), and opens the real control
// when you pick one, so there is never a second copy of a setting to drift.
// It also holds the one setting that has no page of its own: the interface
// scale. Moving between categories slides the pane the way the tree goes and
// a mark follows the current category (renderer/motion.js).
(function () {
  "use strict";
  const $ = (id) => document.getElementById(`config-${id}`);
  const api = () => window.mefiStudio;
  const motion = () => window.MefiMotion;
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  // Category, title, what it covers, and the words that file a setting there.
  const CATEGORIES = [
    { id: "agents", title: "Inference & Agents", about: "Who thinks and who builds: providers, models, roles, seats and routing.", words: /\b(model|models|provider|providers|seat|seats|role|roles|routing|fallback|effort|reasoning|openai|anthropic|claude|codex|opencode|grok|jev|api key|keys?|connection|subscription)\b/i },
    { id: "knowledge", title: "Knowledge", about: "What agents read before they work: references, context, memory and the project map.", words: /\b(reference|references|context|scout|memory|playbook|project map|history|brief|learn|learned|preferences)\b/i },
    { id: "exec", title: "Files & Exec", about: "How work runs: builders, parallel workers, worktrees, tools, skills and approvals.", words: /\b(worker|workers|builder|builders|parallel|worktree|worktrees|executor|tool|tools|mcp|skill|skills|desk|delegat\w*|pipeline|pipelines|verify|approval|approve|build|queue|autopilot|backlog|permission|elevated|swarm|cluster)\b/i },
    { id: "web", title: "Web & Community", about: "Everything that reaches out: the web, updates, Discord and listening rooms.", words: /\b(web|link|links|discord|community|update|updates|release|github|browser|radio|stream|together|youtube|spotify)\b/i },
    { id: "storage", title: "Storage", about: "What Studio keeps: projects, data, backups, pruning and cleanup.", words: /\b(project|projects|data|storage|backup|prune|pruning|compact\w*|cache|folder|clean\w*|archive)\b/i },
    { id: "ui", title: "UI & Surfaces", about: "How Studio looks and sounds: themes, nodes, motion, glass, Social and what opens on launch.", words: /\b(appearance|theme|themes|colou?rs?|node|nodes|motion|blur|glass|layout|sound|audio|music|vibe|social|studio|mode|launch|home|font|scale|companion|name|camera|ambient)\b/i },
    { id: "dev", title: "Dev & Meta", about: "Diagnostics, logs, performance and everything else.", words: /./ },
  ];
  // The page a setting lives on files it first; only a page that mixes
  // concerns (System, Agents) lets the words decide. Appearance's "Zen mode"
  // is a look, not an OpenCode Zen key.
  const PLACES = [
    { path: /^Settings › (Appearance|Audio)\b/, category: "ui" },
    { path: /^Settings › General › Community\b/, category: "web" },
    { path: /^Settings › General\b/, category: "ui" },
    { path: /^Settings › (Connections|Models)\b/, category: "agents" },
    { path: /^Settings › Automation › Memory\b/, category: "knowledge" },
    { path: /^Settings › Automation\b/, category: "exec" },
    { path: /^Settings › System\b/, words: /\b(update|updates|github|discord|styler|dashboard|bot)\b/i, category: "web", otherwise: "dev" },
    { path: /^Agents\b/, words: /\b(builders? run on|parallel builds|build approval|agent coordination|allow new work|run the queue|each build may cost|pinned model for this cli)\b/i, category: "exec", otherwise: "agents" },
  ];
  // The setup helper (renderer/setup-helper.js) registers one Search record per
  // section, `setup-helper:<section>`. Configuration files them beside the
  // settings they configure and each row opens the helper at that section, so
  // this stays the one index. Welcome and Finish are the walkthrough itself.
  const HELPER_SECTIONS = { providers: "agents", team: "agents", routing: "agents", run: "exec", permissions: "exec", tools: "exec", system: "dev", look: "ui" };
  // Buttons that only act on the field beside them (Save, Add, Refresh list)
  // and links out of a card are reached through that field or card: listed
  // alone they read as five identical "Save" rows.
  const NOISE = /^(save|add|stop|save token|refresh list|refresh selection|use for (routine|heavy)|close appearance|copy agent prompt|join the discord|manage in settings › community)$/i;
  const state = { query: "", category: "agents", zoom: null, previous: null, painted: null, buttons: null, mark: null };
  let initialized = false;
  const isOpen = () => Boolean($("overlay")) && !$("overlay").hidden;

  // ---- the settings, from the registry ---------------------------------------------------
  function categoryOf(label, words) {
    for (const place of PLACES) {
      if (!place.path.test(label)) continue;
      if (!place.words) return place.category;
      return place.words.test(words) ? place.category : place.otherwise;
    }
    return CATEGORIES.find((item) => item.words.test(words))?.id ?? "dev";
  }
  function records() {
    const list = window.MefiNav?.list?.({}) ?? [];
    const seen = new Set();
    const named = new Set();
    const rows = [];
    for (const record of list) {
      if (!record || typeof record.id !== "string" || seen.has(record.id)) continue;
      const helper = /^setup-helper:([a-z-]+)$/.exec(record.id)?.[1] ?? null;
      if (!record.id.startsWith("settings:") && !(helper && HELPER_SECTIONS[helper])) continue;
      if (typeof record.hidden === "function" && record.hidden()) continue;
      seen.add(record.id);
      const label = String(record.label || record.short || record.id);
      const path = label.split(" › ").map((part) => part.trim()).filter(Boolean);
      const title = path.at(-1) || record.id;
      if (NOISE.test(title)) continue;
      // One row per setting: a picker registered twice (its field and its
      // choices) is one setting.
      if (named.has(label)) continue;
      named.add(label);
      const words = `${label} ${record.desc || ""} ${record.searchTerms || ""}`;
      rows.push({ id: record.id, title, path, where: path.slice(0, -1).join(" › "), desc: String(record.desc || ""), terms: words.toLowerCase(), category: helper ? HELPER_SECTIONS[helper] : categoryOf(label, words), run: record.run });
    }
    // The guided walkthrough itself heads Inference & Agents, whatever the
    // helper's section records say.
    if (typeof window.MefiSetupHelper?.open === "function") {
      rows.unshift({ id: "setup-helper:walkthrough", title: "Walk me through setup", path: ["Setup helper", "Walk me through setup"], where: "Setup helper", desc: "Connect an AI, choose your team and set permissions, step by step.", terms: "walk me through setup guided walkthrough wizard first run setup helper connect an ai team permissions", category: "agents", run: () => window.MefiSetupHelper.open("welcome") });
    }
    return rows;
  }
  function matches(rows) {
    const words = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return rows;
    return rows.filter((row) => words.every((word) => row.terms.includes(word)));
  }
  // An empty category stays out of the tree, except UI & Surfaces, which
  // always holds the interface scale.
  const listed = (category, count) => count > 0 || category?.id === "ui";

  // ---- painting ---------------------------------------------------------------------------
  // The category buttons are built once and kept, so the mark behind the
  // current one can spring from one to the next.
  function treeButtons() {
    if (state.buttons) return state.buttons;
    const tree = $("tree");
    state.buttons = new Map();
    for (const category of CATEGORIES) {
      const button = el("button", "config-category");
      button.type = "button";
      button.dataset.category = category.id;
      button.append(el("span", "config-category-title", category.title), el("span", "config-category-count", "0"));
      button.addEventListener("click", () => { state.category = category.id; if (state.query) { state.query = ""; $("search").value = ""; } render(); });
      tree.append(button);
      state.buttons.set(category.id, button);
    }
    const mark = el("span", "config-tree-mark");
    mark.setAttribute("aria-hidden", "true");
    tree.append(mark);
    state.mark = mark;
    return state.buttons;
  }
  function render() {
    const rows = records();
    const shown = matches(rows);
    const counts = new Map(CATEGORIES.map((category) => [category.id, 0]));
    for (const row of (state.query ? shown : rows)) counts.set(row.category, counts.get(row.category) + 1);
    if (!state.query && !listed(CATEGORIES.find((item) => item.id === state.category), counts.get(state.category))) {
      state.category = CATEGORIES.find((category) => listed(category, counts.get(category.id)))?.id ?? "ui";
    }
    const buttons = treeButtons();
    for (const category of CATEGORIES) {
      const button = buttons.get(category.id);
      const count = counts.get(category.id);
      button.hidden = state.query ? count === 0 : !listed(category, count);
      button.children[1].textContent = String(count);
      button.setAttribute("aria-current", String(!state.query && category.id === state.category));
    }
    motion()?.glide?.(state.mark, state.query ? null : buttons.get(state.category));
    paintPane(rows, shown);
  }
  // A new category slides in the way the tree goes (down the list from
  // below, back up from above). Typing keeps the rows that still match and
  // glides them into place; clearing the search fades back to the category.
  function paintPane(rows, shown) {
    const pane = $("pane");
    const place = state.query ? "search" : state.category;
    const before = state.painted;
    state.painted = place;
    const paint = () => {
      pane.replaceChildren();
      if (state.query) paintResults(pane, shown);
      else paintCategory(pane, CATEGORIES.find((item) => item.id === state.category) ?? CATEGORIES[0], rows.filter((row) => row.category === state.category));
    };
    const order = (id) => CATEGORIES.findIndex((item) => item.id === id);
    if (!motion() || before === null) { paint(); return; }
    if (before === place || place === "search") motion().keep(pane, paint);
    else motion().swap(pane, paint, { dir: before === "search" ? 0 : Math.sign(order(place) - order(before)), axis: "y" });
  }
  function paintCategory(pane, category, rows) {
    const head = el("header", "config-pane-head");
    head.append(el("h3", "config-pane-title", category.title), el("p", "config-pane-about", category.about));
    pane.append(head);
    if (category.id === "ui") {
      pane.append(scaleControl());
      // Layout v2's Tab behaviour card (renderer/tabs.js): null, and so nothing here, unless the tab strip is running.
      const tabs = window.MefiTabs?.configCard?.();
      if (tabs) pane.append(tabs);
    }
    if (!rows.length) { if (category.id !== "ui") pane.append(el("p", "config-empty", "Nothing is filed here yet.")); return; }
    // Grouped by where each setting lives (Settings › General, Agents …).
    const groups = new Map();
    for (const row of rows) { const key = row.where || "Studio"; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
    for (const [where, items] of groups) {
      const section = el("section", "config-group");
      const title = el("h4", "config-group-title");
      title.append(el("span", "config-group-name", where), el("span", "config-group-count", String(items.length)));
      section.append(title);
      const list = el("ul", "config-items");
      for (const row of items) list.append(item(row));
      section.append(list);
      pane.append(section);
    }
  }
  function paintResults(pane, rows) {
    const head = el("header", "config-pane-head");
    head.append(el("h3", "config-pane-title", rows.length ? `${rows.length} setting${rows.length === 1 ? "" : "s"} match` : "No setting matches"));
    if (!rows.length) head.append(el("p", "config-pane-about", "Try a shorter word, or a word from what the setting does."));
    pane.append(head);
    if (!rows.length) return;
    const list = el("ul", "config-items");
    for (const row of rows.slice(0, 80)) list.append(item(row, true));
    pane.append(list);
  }
  function item(row, withCategory = false) {
    const li = el("li", "config-row");
    li.dataset.key = row.id;
    const button = el("button", "config-item");
    button.type = "button";
    button.dataset.setting = row.id;
    const words = el("span", "config-item-words");
    words.append(el("span", "config-item-title", row.title));
    // In a category the group heading already says where; a match says both.
    const meta = withCategory ? [CATEGORIES.find((category) => category.id === row.category)?.title, row.where].filter(Boolean).join(" · ") : row.desc && !row.where.endsWith(row.desc) ? row.desc : "";
    if (meta) words.append(el("span", "config-item-meta", meta));
    const go = el("span", "config-item-go", "Open");
    go.setAttribute("aria-hidden", "true");
    button.append(words, go);
    button.addEventListener("click", () => pick(row));
    li.append(button);
    return li;
  }
  // Picking a setting opens its real control: the dialog steps aside first.
  function pick(row) {
    close();
    try { row.run?.(); } catch { window.MefiToast?.("That setting could not be opened.", "bad"); }
  }

  // ---- the interface scale -----------------------------------------------------------------
  function scaleControl() {
    const box = el("div", "config-scale");
    box.dataset.key = "scale";
    const label = el("label", "config-scale-row");
    const slider = el("input");
    slider.type = "range"; slider.min = "70"; slider.max = "150"; slider.step = "5";
    slider.value = String(Math.round((state.zoom ?? 1) * 100));
    slider.setAttribute("aria-label", "Interface scale");
    const value = el("span", "config-scale-value", `${slider.value}%`);
    label.append(el("span", "config-scale-name", "Interface scale"), slider, value);
    const reset = el("button", "ghost mini", "Reset to 100%");
    reset.type = "button";
    const hint = el("p", "config-pane-about", api()?.uiZoom ? "Scales every page, text included. Saved for the next launch." : "The interface scale is set in the desktop app.");
    slider.disabled = !api()?.uiZoom;
    reset.disabled = !api()?.uiZoom;
    // The track fills up to the thumb (config-dialog.css reads --fill).
    const fill = () => slider.style?.setProperty?.("--fill", `${((Number(slider.value) - 70) / 80) * 100}%`);
    fill();
    slider.addEventListener("input", () => { value.textContent = `${slider.value}%`; fill(); });
    slider.addEventListener("change", () => void setZoom(Number(slider.value) / 100));
    reset.addEventListener("click", () => { slider.value = "100"; value.textContent = "100%"; fill(); void setZoom(1); });
    const foot = el("div", "config-scale-foot");
    foot.append(hint, reset);
    box.append(label, foot);
    return box;
  }
  async function setZoom(factor) {
    try {
      const result = await api().uiZoom({ factor });
      if (result?.ok === false) throw new Error(result.error || "The scale was not saved.");
      state.zoom = result?.factor ?? factor;
    } catch (error) { window.MefiToast?.(error?.message || "The scale was not saved.", "bad"); }
  }

  // ---- the dialog ----------------------------------------------------------------------------
  async function open(params = {}) {
    init();
    state.previous = document.activeElement;
    if (typeof params?.category === "string" && CATEGORIES.some((item) => item.id === params.category)) state.category = params.category;
    state.query = typeof params?.query === "string" ? params.query : "";
    $("search").value = state.query;
    // A fresh open paints in place and the mark appears where it belongs;
    // the sheet's own entrance carries both.
    state.painted = null;
    if (state.mark?.dataset) state.mark.dataset.on = "false";
    // The transient layer is Configuration's while it shows: Escape from anywhere and closeAll() find it, and a
    // second pop-up (Search, Shortcuts) takes its place instead of stacking over a dialog nobody can close by key.
    window.MefiNav?.claim?.("config");
    $("overlay").hidden = false;
    render();
    requestAnimationFrame(() => $("search")?.focus?.({ preventScroll: true }));
    if (api()?.uiZoomGet) {
      try { const result = await api().uiZoomGet(); if (result?.ok !== false && Number.isFinite(result?.factor)) { state.zoom = result.factor; if (isOpen() && state.category === "ui" && !state.query) render(); } } catch { /* the slider shows 100% */ }
    }
  }
  function close() {
    if (!isOpen()) return;
    $("overlay").hidden = true;
    window.MefiNav?.release?.("config");
    // MefiNav hands focus back first; this only steps in when nothing usable took it.
    const back = state.previous;
    state.previous = null;
    const current = document.activeElement;
    const stranded = !current || current === document.body || $("overlay").contains?.(current);
    if (stranded && back && document.contains?.(back)) back.focus?.({ preventScroll: true });
  }
  // Up and Down walk the categories from the tree.
  function step(delta) {
    const shown = CATEGORIES.filter((category) => !state.buttons?.get(category.id)?.hidden);
    const at = shown.findIndex((category) => category.id === state.category);
    const next = shown[Math.max(0, Math.min(shown.length - 1, at + delta))];
    if (!next || next.id === state.category) return;
    state.category = next.id;
    render();
    state.buttons.get(next.id)?.focus?.({ preventScroll: true });
  }
  function init() {
    if (initialized || !$("overlay")) return;
    initialized = true;
    $("close").addEventListener("click", () => close());
    // Ctrl +, Ctrl - and Ctrl 0 move the scale without this dialog (main.cjs stepUiZoom): keep
    // the slider in step, and say the result once the presses settle rather than once per press.
    let zoomTold = 0;
    api()?.onUiZoom?.((payload) => {
      if (!Number.isFinite(payload?.factor)) return;
      state.zoom = payload.factor;
      if (isOpen() && state.category === "ui" && !state.query) render();
      clearTimeout(zoomTold);
      zoomTold = setTimeout(() => window.MefiToast?.(`Interface scale ${Math.round(payload.factor * 100)}%`), 350);
    });
    $("search").addEventListener("input", () => { state.query = $("search").value; render(); });
    $("search").addEventListener("keydown", (event) => {
      if (event.key === "Enter") { const first = $("pane").querySelector(".config-item"); if (first) { event.preventDefault(); first.click(); } }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if ($("search").value) { $("search").value = ""; state.query = ""; render(); } else close(); }
    });
    $("tree").addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); step(event.key === "ArrowDown" ? 1 : -1); }
    });
    $("overlay").addEventListener("click", (event) => { if (event.target === $("overlay")) close(); });
    $("overlay").addEventListener("keydown", (event) => {
      if (event.key === "Escape" && event.target !== $("search")) { event.preventDefault(); event.stopPropagation(); close(); return; }
      // A modal keeps Tab inside it: past the last control it wraps to the first.
      if (event.key !== "Tab") return;
      const stops = [...$("overlay").querySelectorAll("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((item) => !item.disabled && item.getClientRects().length);
      if (!stops.length) return;
      const first = stops[0], last = stops.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  window.MefiConfig = { open, close, isOpen, categories: () => CATEGORIES.map(({ id, title }) => ({ id, title })), records: () => records().map(({ id, title, where, category }) => ({ id, title, where, category })) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
