// Mefi's Studio AI+ — command palette (Ctrl/Cmd+K).
// Fuzzy jumps to tabs, overlays, actions, tasks, ideas and models.
(function () {
  "use strict";

  const state = { items: [], filtered: [], index: 0, opener: null };
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
  function destinations() {
    const nav = window.MefiNav;
    if (!nav?.list) return [];
    const commandActive = Boolean(window.MefiIdle?.isActive?.());
    const openSheet = nav.state?.sheet ?? null;
    // The assistant's commands say what the service is doing instead of a key.
    const serviceLine = () => window.MefiTree?.assistantSummary?.()?.sublabel ?? "";
    return nav
      .list({ showIn: "palette" })
      .filter((dest) => !(dest.id === "command" && commandActive) && dest.id !== openSheet)
      .map((dest) => ({
        kind: dest.group, // surfaces | tools | system | command | assistant
        label: dest.label,
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
    const base = { kind: "action", layer: null, group: "assistant", key: null, glyph: null, badge: null, showIn };
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
      run: () => control(paused() ? "resume" : "pause", "control"),
    });
  }

  function tasks() {
    return (window.MefiTasks?.state?.tasks ?? []).map((task) => ({
      kind: "task",
      label: task.title,
      hint: task.status,
      keyHint: false,
      count: 0,
      run: () => window.MefiNav?.go?.("tasks", { taskId: task.id }),
    }));
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
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No matches.";
      el.list.append(li);
      setActiveOption();
      return;
    }
    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.id = `palette-option-${index}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(index === state.index));
      if (index === state.index) li.classList.add("active");
      const kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = item.kind;
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = item.label;
      li.append(kind, label);
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
      li.addEventListener("mouseenter", () => {
        state.index = index;
        render();
      });
      li.addEventListener("click", () => run(index));
      el.list.append(li);
    });
    setActiveOption();
  }

  function filter() {
    const query = el.input.value.trim();
    if (!query) {
      state.filtered = state.items.slice(0, 40);
    } else {
      state.filtered = state.items
        .map((item) => ({ item, score: subsequenceScore(query, `${item.kind} ${item.label}`) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item);
    }
    state.index = 0;
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
  }

  function close() {
    if (el.overlay.hidden) return;
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
    if (!el.overlay) return;
    // The focused input is the combobox; the listbox it controls stays below.
    // aria-activedescendant on it (set per option in setActiveOption) is what
    // makes arrow keys announce the active option.
    el.input.setAttribute("role", "combobox");
    el.input.setAttribute("aria-expanded", "false");
    el.input.setAttribute("aria-autocomplete", "list");
    registerAssistantCommands();
    window.addEventListener("keydown", (event) => {
      if (el.overlay.hidden) return; // nav owns Ctrl/Cmd+K (spec 2.8); palette drives arrows/Enter/Escape
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        // The list is a cycle: Down past the last option lands on the first,
        // Up from the first lands on the last. Wrap within the 40 shown.
        const span = Math.min(40, state.filtered.length);
        if (!span) return;
        state.index = event.key === "ArrowDown" ? (state.index + 1) % span : (state.index - 1 + span) % span;
        render();
      } else if (event.key === "Enter") {
        event.preventDefault();
        run(state.index);
      } else if (event.key === "Escape") {
        // Mirrors nav's own Escape path (README: Esc closes the top-most layer);
        // close() is guarded, so the two handlers converge harmlessly.
        event.preventDefault();
        close();
      }
    });
    el.input.addEventListener("input", filter);
    el.overlay.addEventListener("click", (event) => {
      if (event.target === el.overlay) close();
    });
  }

  window.MefiPalette = { init, open, close };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
