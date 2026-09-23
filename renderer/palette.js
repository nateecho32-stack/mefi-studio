// Mefi's Studio AI+ — Search Studio, the command palette (Ctrl/Cmd+K).
// Fuzzy jumps to pages, sheets, settings, actions, tasks, nodes and models,
// grouped by the same sections as the navigation rail.
(function () {
  "use strict";

  const state = { items: [], filtered: [], index: 0, opener: null, projectId: null, taskRecords: [], taskStatus: "", taskRead: 0 };
  const el = {};
  let initialized = false;

  const subsequenceScore = (needle, haystack) => {
    if (!needle) return 1;
    const text = haystack.toLowerCase();
    let score = 0;
    let position = 0;
    for (const character of needle.toLowerCase()) {
      const found = text.indexOf(character, position);
      if (found < 0) return 0;
      score += found === position ? 3 : 1;
      position = found + 1;
    }
    return score;
  };

  function matchScore(query, item) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const label = String(item.label || "").toLowerCase();
    const terms = `${item.kind} ${label} ${item.description || ""} ${item.searchTerms || ""}`.toLowerCase();
    // Natural phrases and words are useful before the user knows a tool's
    // official name. Keep literal title matches ahead of descriptive matches.
    if (label === query.toLowerCase()) return 1000;
    if (label.includes(query.toLowerCase())) return 800;
    if (words.every((word) => terms.includes(word))) return 500 + words.filter((word) => label.includes(word)).length;
    return subsequenceScore(query, `${item.kind} ${label}`);
  }

  function models() {
    try {
      const baked = JSON.parse(document.getElementById("booklet-data").textContent);
      return baked.models.map((model) => ({
        kind: "model",
        label: `${model.name} · ${model.vendor}`,
        hint: model.quality?.index != null ? `AA ${model.quality.index}` : "unmeasured",
        keyHint: false,
        count: 0,
        run: () => {
          if (window.MefiNav) window.MefiNav.go("booklet");
          else document.querySelector('.tab[data-tab="booklet"]')?.click();
          const search = document.getElementById("search");
          search.value = model.name;
          search.dispatchEvent(new Event("input"));
          search.focus();
        },
      }));
    } catch {
      return [];
    }
  }

  // Every destination, key hint and label comes from the registry, so the palette
  // cannot drift from the dock, the tools cluster, the help sheet or the footer.
  // Each result is filed under its rail section (Home, Work, Live, Models,
  // Settings, Help, Community, Assistant), and the browse list keeps the rail's
  // top-to-bottom order.
  function destinations() {
    const nav = window.MefiNav;
    if (!nav?.list) return [];
    const commandActive = Boolean(window.MefiIdle?.isActive?.());
    const openSheet = nav.state?.sheet ?? null;
    // The assistant's commands say what the service is doing instead of a key.
    const serviceLine = () => window.MefiTree?.assistantSummary?.()?.sublabel ?? "";
    const rank = (dest) => nav.sectionRank?.(dest) ?? 0;
    return nav
      .list({ showIn: "palette" })
      .filter((dest) => !(dest.id === "command" && commandActive) && dest.id !== openSheet)
      .sort((a, b) => rank(a) - rank(b))
      .map((dest) => ({
        kind: nav.sectionLabel?.(dest) ?? dest.group,
        label: dest.label,
        description: dest.desc || "",
        searchTerms: dest.searchTerms || "",
        hint: dest.key ?? (dest.group === "assistant" ? serviceLine() : ""),
        keyHint: Boolean(dest.key),
        count: dest.badge ? Number(nav.badges?.[dest.badge]) || 0 : 0,
        run: () => nav.go(dest.id),
      }));
  }

  // The assistant's four commands live in the registry like every other action
  // (palette only: the dock, the help sheet and the footer skip them), so the
  // palette cannot drift from the Explorer's own buttons.
  function registerAssistantCommands() {
    const nav = window.MefiNav;
    if (!nav?.register) return;
    const paused = () => window.MefiTree?.assistantState?.()?.status === "paused";
    const control = async (action, label) => {
      if (!window.mefiStudio?.assistantControl) {
        window.MefiToast?.("the assistant runs in the desktop app only", "info");
        return;
      }
      try {
        const result = await window.mefiStudio.assistantControl(action);
        if (!result?.ok) {
          window.MefiToast?.(`${label} failed · ${result?.error ?? "unknown error"}`, "bad");
          return;
        }
        if (result.state) window.MefiTree?.applyAssistant?.({ state: result.state });
        const full = window.MefiTree?.assistantState?.() ?? null;
        const text =
          action === "tidy"
            ? full?.housekeeping?.lastText || "tidy pass done"
            : action === "fix"
              ? (full?.fixes ?? []).slice(-1)[0]?.text ?? "fix pass done · nothing to repair"
              : `assistant ${full?.status ?? action}`;
        window.MefiToast?.(String(text).slice(0, 110), "good");
      } catch (error) {
        window.MefiToast?.(`${label} failed · ${String(error?.message ?? error)}`, "bad");
      }
    };
    const showIn = { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false };
    const base = { kind: "action", layer: null, section: "assistant", group: "assistant", key: null, glyph: null, badge: null, showIn };
    nav.register({
      ...base,
      id: "assistantMessage",
      label: "Message the assistant",
      short: "Message",
      desc: "Open the Explorer on the assistant's thread",
      run: () => nav.go("explorer", { assistant: true }),
    });
    nav.register({ ...base, id: "assistantTidy", label: "Tidy up now", short: "Tidy", desc: "Archive done tasks, prune ideas, clear resolved requests", run: () => control("tidy", "tidy") });
    nav.register({ ...base, id: "assistantFix", label: "Fix problems now", short: "Fix", desc: "Repair the catalog and data files, check the updater", run: () => control("fix", "fix") });
    nav.register({
      ...base,
      id: "assistantPause",
      // Read at build time, so the label follows the service.
      get label() {
        return paused() ? "Resume assistant" : "Pause assistant";
      },
      get short() {
        return paused() ? "Resume" : "Pause";
      },
      desc: "Pause or resume the assistant service",
      run: () => control(paused() ? "start-work" : "pause", "control"),
    });
  }

  function tasks() {
    const projectId = currentProject();
    return state.taskRecords.map((task) => ({
      kind: "task",
      label: task.title,
      description: task.prompt || task.description || "",
      hint: task.status,
      keyHint: false,
      count: 0,
      run: () => {
        if (currentProject() === projectId) window.MefiNav?.go?.("tasks", { taskId: task.id });
      },
    }));
  }

  function currentProject() {
    return state.projectId || window.MefiTasks?.state?.projectId || null;
  }

  function updateTaskResults() {
    if (el.overlay.hidden) return;
    build();
    filter(true);
  }

  async function loadTasks() {
    const read = ++state.taskRead;
    const projectId = currentProject();
    const api = window.mefiStudio;
    state.taskRecords = [];
    if (!api?.tasksList) {
      state.taskRecords = (window.MefiTasks?.state?.tasks || []).filter((task) => !task.projectId || !projectId || task.projectId === projectId);
      state.taskStatus = "";
      updateTaskResults();
      return;
    }
    state.taskStatus = "loading";
    updateTaskResults();
    let timeout;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => api.tasksList()),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Task search timed out")), 8000); }),
      ]);
      if (read !== state.taskRead || el.overlay.hidden || currentProject() !== projectId) return;
      if (result?.ok === false || !Array.isArray(result?.tasks)) throw new Error("Tasks unavailable");
      if (projectId && result.projectId && result.projectId !== projectId) throw new Error("Project changed");
      if (!result.projectId && !projectId) throw new Error("Project unavailable");
      state.projectId = result.projectId || projectId;
      state.taskRecords = result.tasks.filter((task) => !task.projectId || !state.projectId || task.projectId === state.projectId);
      state.taskStatus = "ready";
    } catch {
      if (read !== state.taskRead || el.overlay.hidden || currentProject() !== projectId) return;
      state.taskStatus = "error";
    } finally {
      clearTimeout(timeout);
    }
    updateTaskResults();
  }

  function changeProject(projectId) {
    if (!projectId || projectId === state.projectId) return;
    state.projectId = projectId;
    state.taskRead += 1;
    state.taskRecords = [];
    state.taskStatus = "";
    if (!el.overlay.hidden) loadTasks();
  }

  // The field promises nodes, so the constellation is searchable from here
  // whenever it is on screen.
  function nodes() {
    if (!window.MefiIdle?.isActive?.() || typeof window.MefiIdle.select !== "function") return [];
    return (window.MefiIdle.debugNodes?.() ?? []).slice(0, 120).map((node) => ({
      kind: "node",
      label: node.label ?? node.id,
      hint: node.kind,
      keyHint: false,
      count: 0,
      run: () => window.MefiIdle?.select?.(node.id),
    }));
  }

  function build() {
    state.items = [...destinations(), ...tasks(), ...nodes(), ...models()];
  }

  // Roving aria-activedescendant: focus never leaves the input, so the
  // attribute lives on it (the focused element a screen reader watches) as
  // well as on the listbox; both name the active option so arrow-key movement
  // is announced, and the option scrolls into view when the list overflows.
  function setActiveOption() {
    const active = el.list.querySelector("li.active");
    if (active) {
      el.list.setAttribute("aria-activedescendant", active.id);
      el.input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else {
      el.list.removeAttribute("aria-activedescendant");
      el.input.removeAttribute("aria-activedescendant");
    }
  }

  function render() {
    el.list.textContent = "";
    const items = state.filtered.slice(0, 40);
    if (el.status) {
      const count = state.filtered.length;
      const results = count > 40 ? `Showing 40 of ${count} results. Keep typing to narrow them.` : `${count} result${count === 1 ? "" : "s"}.`;
      const taskStatus = state.taskStatus === "loading" ? " Loading project tasks…" : state.taskStatus === "error" ? " Tasks couldn't be loaded. Close and reopen Search to retry." : "";
      el.status.textContent = results + taskStatus;
    }
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = state.taskStatus === "loading" ? "No tool matches yet. Loading project tasks…" : "No matches. Try a page or tool, a setting such as Providers or Updates, a task title or a model name.";
      el.list.append(li);
      setActiveOption();
      return;
    }
    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.id = `palette-option-${index}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(index === state.index));
      // Position in the full result set (not just the 40 shown), so screen
      // readers announce "3 of 128" correctly while a query narrows the list.
      li.setAttribute("aria-posinset", String(index + 1));
      li.setAttribute("aria-setsize", String(state.filtered.length));
      if (index === state.index) li.classList.add("active");
      // Rows arrive grouped by section; the first row of each group carries
      // the marker the stylesheet draws the section divider from.
      if (index === 0 || items[index - 1].kind !== item.kind) li.classList.add("palette-group-start");
      const kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = item.kind;
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = item.label;
      const copy = document.createElement("span");
      copy.className = "palette-result-copy";
      copy.append(label);
      if (item.description) {
        const description = document.createElement("span");
        description.className = "description";
        description.textContent = String(item.description).replace(/\s+/g, " ").slice(0, 200);
        copy.append(description);
      }
      li.append(kind, copy);
      if (item.count > 0) {
        const count = document.createElement("span");
        count.className = "count";
        count.textContent = String(item.count);
        li.append(count);
      }
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "hint";
        if (item.keyHint) {
          const key = document.createElement("kbd");
          key.className = "key";
          key.textContent = item.hint;
          hint.append(key);
        } else {
          hint.textContent = item.hint;
        }
        li.append(hint);
      }
      li.addEventListener("mouseenter", () => highlight(index, li));
      li.addEventListener("click", () => run(index));
      el.list.append(li);
    });
    setActiveOption();
  }

  // The pointer moves the highlight in place. Rebuilding every row on each
  // mouseenter was the palette's hover cost; only the two rows that change are
  // touched, and the activedescendant follows.
  function highlight(index, row) {
    if (index === state.index) return;
    const previous = el.list.querySelector("li.active");
    previous?.classList.remove("active");
    previous?.setAttribute("aria-selected", "false");
    state.index = index;
    row.classList.add("active");
    row.setAttribute("aria-selected", "true");
    setActiveOption();
  }

  // Results stay in their sections: groups come in the order of their best
  // match (on the browse list, the rail's own order) and rows keep their rank
  // inside a group, so the first row is always the best match.
  function grouped(items) {
    const groups = new Map();
    for (const item of items) {
      if (!groups.has(item.kind)) groups.set(item.kind, []);
      groups.get(item.kind).push(item);
    }
    return [...groups.values()].flat();
  }

  function filter(preserveSelection = false) {
    const selected = preserveSelection ? state.filtered[state.index] : null;
    const query = el.input.value.trim();
    if (!query) {
      state.filtered = grouped(state.items);
    } else {
      state.filtered = grouped(state.items
        .map((item) => ({ item, score: matchScore(query, item) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item));
    }
    const retained = selected ? state.filtered.findIndex((item) => item.kind === selected.kind && item.label === selected.label) : -1;
    state.index = retained >= 0 && retained < 40 ? retained : 0;
    render();
  }

  function run(index) {
    const item = state.filtered[index];
    if (!item) return;
    close();
    setTimeout(() => item.run(), 30);
  }

  function open() {
    // Remember what the user came from (tool button, dock item, a text field
    // mid-type) so Escape can hand focus back even without MefiNav's layer
    // bookkeeping to do it for us.
    state.opener = document.activeElement;
    window.MefiNav?.claim?.("palette");
    build();
    el.overlay.hidden = false;
    el.input.setAttribute("aria-expanded", "true");
    el.input.value = "";
    filter();
    el.input.focus();
    loadTasks();
  }

  function close() {
    if (el.overlay.hidden) return;
    state.taskRead += 1;
    el.overlay.hidden = true;
    el.input.setAttribute("aria-expanded", "false");
    el.input.removeAttribute("aria-activedescendant");
    el.list.removeAttribute("aria-activedescendant");
    window.MefiNav?.release?.("palette");
    restoreOpener();
  }

  // Escape (and every other close path) returns focus to the control that
  // opened the palette, so keyboard users are not stranded on <body>. Runs
  // after MefiNav.release() and only steps in when nothing usable took focus.
  function restoreOpener() {
    const current = document.activeElement;
    const stranded = !current || current === document.body || el.overlay.contains(current);
    const opener = state.opener;
    state.opener = null;
    if (stranded && opener && opener !== document.body && opener.isConnected && !opener.closest?.("[hidden]")) {
      opener.focus();
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    el.overlay = document.getElementById("palette-overlay");
    el.input = document.getElementById("palette-input");
    el.list = document.getElementById("palette-list");
    el.close = document.getElementById("palette-close");
    el.status = document.getElementById("palette-status");
    if (!el.overlay) return;
    // The focused input is the combobox; the listbox it controls stays below.
    // aria-activedescendant on it (set per option in setActiveOption) is what
    // makes arrow keys announce the active option.
    el.input.setAttribute("role", "combobox");
    el.input.setAttribute("aria-expanded", "false");
    el.input.setAttribute("aria-autocomplete", "list");
    registerAssistantCommands();
    el.close?.addEventListener("click", close);
    window.addEventListener("mefi:project-changed", (event) => changeProject(event.detail?.projectId));
    window.mefiStudio?.onProjects?.((result) => changeProject(result?.activeId));
    window.mefiStudio?.onTasks?.((rows) => {
      if (el.overlay.hidden || !Array.isArray(rows)) return;
      const projectId = currentProject();
      if (!projectId || rows.some((task) => task.projectId && task.projectId !== projectId)) return;
      state.taskRead += 1;
      state.taskRecords = rows;
      state.taskStatus = "ready";
      updateTaskResults();
    });
    window.addEventListener("keydown", (event) => {
      if (el.overlay.hidden) return; // nav owns Ctrl/Cmd+K (spec 2.8); palette drives arrows/Enter/Escape
      if (event.key === "Tab") {
        const controls = [el.input, el.close].filter((control) => control && !control.hidden && !control.disabled);
        const at = controls.indexOf(document.activeElement);
        const next = event.shiftKey ? (at <= 0 ? controls.length - 1 : at - 1) : (at + 1) % controls.length;
        event.preventDefault();
        controls[next]?.focus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (document.activeElement !== el.input) return;
        event.preventDefault();
        // The list is a cycle: Down past the last option lands on the first,
        // Up from the first lands on the last. Wrap within the 40 shown.
        const span = Math.min(40, state.filtered.length);
        if (!span) return;
        state.index = event.key === "ArrowDown" ? (state.index + 1) % span : (state.index - 1 + span) % span;
        render();
      } else if (event.key === "Home" || event.key === "End") {
        if (document.activeElement !== el.input) return;
        // Home/End jump straight to the first/last option of the cycle. With a
        // query typed they keep their native caret role in the field, so the
        // jump only applies while browsing the default list.
        if (el.input.value.trim()) return;
        const span = Math.min(40, state.filtered.length);
        if (!span) return;
        event.preventDefault();
        state.index = event.key === "Home" ? 0 : span - 1;
        render();
      } else if (event.key === "Enter") {
        if (document.activeElement !== el.input) return;
        event.preventDefault();
        run(state.index);
      } else if (event.key === "Escape") {
        // Mirrors nav's own Escape path (README: Esc closes the top-most layer);
        // close() is guarded, so the two handlers converge harmlessly.
        event.preventDefault();
        close();
      }
    });
    el.input.addEventListener("input", () => filter());
    el.overlay.addEventListener("click", (event) => {
      if (event.target === el.overlay) close();
    });
  }

  window.MefiPalette = { init, open, close };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
