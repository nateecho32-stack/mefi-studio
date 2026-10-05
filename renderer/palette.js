// Mefi's Studio AI+ — Search Studio, the command palette (Ctrl/Cmd+K).
// Fuzzy jumps to pages, sheets, settings, actions, tasks, nodes and models,
// grouped by the same sections as the navigation rail. With the box empty it
// starts with Recent (what you last opened or ran from here, kept per project),
// and "task ..." or "idea ..." adds one on Enter. In the 0.5 layout
// (html[data-layout="v2"]) the same palette reads as the prototype's: see
// "the 0.5 layout" below.
(function () {
  "use strict";

  const state = { items: [], filtered: [], index: 0, opener: null, projectId: null, taskRecords: [], taskStatus: "", taskRead: 0 };
  const el = {};
  let initialized = false;
  // Two things Search does unasked, each with a switch: the Recent group over the
  // empty box (settings.ui.searchRecents, MEFI_STUDIO_NO_SEARCH_RECENTS=1) and the
  // "task ..." / "idea ..." row (settings.ui.searchQuickCreate, MEFI_STUDIO_NO_QUICK_CREATE=1).
  // Both are on until the host's preferences say otherwise.
  const flags = { recents: true, quickCreate: true };
  let plainPlaceholder = "";

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
        key: `model:${model.name} · ${model.vendor}`,
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
        key: `dest:${dest.id}`,
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
      key: `task:${task.id}`,
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
      key: `node:${node.id}`,
      kind: "node",
      label: node.label ?? node.id,
      hint: node.kind,
      keyHint: false,
      count: 0,
      run: () => window.MefiIdle?.select?.(node.id),
    }));
  }

  function build() {
    state.items = v2() ? [...sessionsV2(), ...backlogV2(), ...placesV2(), ...registryV2(), ...nodes().map((item) => ({ ...item, kind: "Nodes", glyph: "g-orbit" })), ...models().map((item) => ({ ...item, kind: "Models", glyph: "g-booklet" }))]
      : [...destinations(), ...tasks(), ...nodes(), ...models()];
  }

  // ---- the 0.5 layout: the prototype's Search (docs/prototype/mefi-studio-0.5-v5.html) ----------
  // With html[data-layout="v2"] it is the same palette, the same keys, Recent and "task ...",
  // read as the prototype has it: one line per result (its icon, its name and, on the right, its
  // state, its key or "page"), under the groups Recent, Sessions, Backlog, Places, Actions, Layout,
  // Tabs, Permission mode and each section's own pages, at most twelve rows. Over the empty box:
  // Recent, then the sessions that matter now, the places on the rail and the actions marked for it,
  // twelve rows in all. Sessions are this project's tasks as the session list reads them
  // (MefiBuilder.reading), from the board Home already holds, so Search makes no read of its own
  // for them; the backlog is the session list's own (ideas nobody has made a task of). Everything
  // else is the registry, as in v1: a record says its group (paletteGroup), its words on the right
  // (paletteHint) and whether the empty box lists it (paletteBrowse, the lower the earlier).
  const v2 = () => document.documentElement?.dataset?.layout === "v2";
  const shownMax = () => (v2() ? 12 : 40);
  const STAGE_WORDS = Object.freeze({ ask: "Needs you", run: "Running", check: "Review", wait: "Queued", ready: "Queued", done: "Done", dropped: "Done" });
  const STAGE_RANK = Object.freeze({ ask: 0, run: 1, check: 2, wait: 3, ready: 3, done: 4, dropped: 4 });
  const BROWSE_SESSIONS = 6;
  // The rail's places (renderer/nav.js, RAIL_PLACES), each by the page it opens and with the rail's glyph: Work is Home
  // (Work › Today), the Map is the Command view, Team is the Agents page.
  const PLACES = Object.freeze([["Work", "workspace", "g-tasks"], ["Map", "command", "g-command"], ["Team", "agents", "g-community"], ["Friends", "friends", "g-chat"], ["Settings", "studio", null]]);
  const board = () => { const data = window.MefiWorkspace?.snapshot?.(); return data && data.projectId ? data : null; };
  const stampOf = (value) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : Date.parse(value || "") || 0; };
  const movedAt = (task) => Math.max(stampOf(task.updatedAt), stampOf(task.doneAt), stampOf(task.createdAt), stampOf(task.lastAttempt?.at));
  function toneOf(task, data) {
    let tone = null;
    try { tone = window.MefiBuilder?.reading?.(task, data || undefined)?.tone ?? null; } catch { tone = null; }
    if (typeof tone === "string" && tone in STAGE_WORDS) return tone;
    if (["done", "archived", "completed"].includes(task.status)) return task.dropped ? "dropped" : "done";
    return task.status === "active" ? "run" : task.status === "awaiting_verification" ? "check" : "ready";
  }
  function sessionsV2() {
    const data = board();
    const projectId = data?.projectId || currentProject();
    const rows = (data ? data.tasks : state.taskRecords).filter((task) => task?.id);
    return rows.map((task) => {
      const archived = task.archived === true || task.status === "archived";
      return { task, archived, tone: toneOf(task, data), at: movedAt(task) };
    }).sort((a, b) => Number(a.archived) - Number(b.archived) || STAGE_RANK[a.tone] - STAGE_RANK[b.tone] || b.at - a.at).map(({ task, archived, tone }) => ({
      key: `task:${task.id}`, kind: "Sessions", label: String(task.title || window.MefiTasks?.shortTitle?.(task) || "Untitled task"),
      description: task.prompt || task.description || "", hint: archived ? "Archived" : STAGE_WORDS[tone], keyHint: false, count: 0, glyph: "g-tasks",
      browse: !archived && tone !== "dropped",
      run: () => { if (!projectId || currentProject() === projectId || board()?.projectId === projectId) window.MefiNav?.go?.("tasks", { taskId: task.id }); },
    }));
  }
  function backlogV2() {
    const data = board();
    if (!data) return [];
    let rows = null;
    try { rows = window.MefiSessions?.model?.backlog?.(data) ?? null; } catch { rows = null; }
    if (!Array.isArray(rows)) rows = (Array.isArray(data.ideas) ? data.ideas : []).filter((idea) => idea?.id && idea.status !== "done" && !idea.taskId).map((idea) => ({ id: idea.id, title: idea.title || idea.detail || "Untitled idea" }));
    const ideas = new Map((Array.isArray(data.ideas) ? data.ideas : []).map((idea) => [idea?.id, idea]));
    return rows.filter((row) => row && row.kind !== "plan").map((row) => ({
      key: `idea:${row.id}`, kind: "Backlog", label: String(row.title), description: String(ideas.get(row.id)?.detail || ""), hint: "Idea", keyHint: false, count: 0, glyph: "g-ideas",
      run: () => window.MefiNav?.go?.("ideas", { ideaId: row.id }),
    }));
  }
  // The rail's places, by the page each opens, with the key that page already has.
  function placesV2() {
    const nav = window.MefiNav;
    return PLACES.map(([label, id, glyph]) => [label, nav?.get?.(id), glyph]).filter(([, dest]) => dest && !dest.hidden?.()).map(([label, dest, glyph]) => ({
      key: `place:${dest.id}`, kind: "Places", label: `Go to ${label}`, description: dest.desc || "", searchTerms: `${label} ${dest.label || ""} ${dest.searchTerms || ""}`,
      hint: dest.chord || dest.key || "", keyHint: Boolean(dest.chord || dest.key), count: 0, glyph: glyph || dest.glyph || "g-frame", browse: true,
      run: () => nav.go(dest.id),
    }));
  }
  function registryV2() {
    const nav = window.MefiNav;
    if (!nav?.list) return [];
    const commandActive = Boolean(window.MefiIdle?.isActive?.());
    const openSheet = nav.state?.sheet ?? null;
    const rank = (dest) => nav.sectionRank?.(dest) ?? 0;
    const words = (value) => { try { return String((typeof value === "function" ? value() : value) || ""); } catch { return ""; } };
    return nav.list({ showIn: "palette" })
      .filter((dest) => dest.id !== "palette" && !(dest.id === "command" && commandActive) && dest.id !== openSheet)
      .sort((a, b) => rank(a) - rank(b))
      .map((dest) => {
        const action = dest.kind === "action";
        const key = dest.key || dest.chord || "";
        const hint = words(dest.paletteHint) || key || (action ? "" : "page");
        return {
          key: `dest:${dest.id}`, kind: dest.paletteGroup || (action ? "Actions" : nav.sectionLabel?.(dest) ?? dest.group), label: dest.label, description: dest.desc || "", searchTerms: dest.searchTerms || "",
          hint, keyHint: Boolean(key) && hint === key, count: dest.badge ? Number(nav.badges?.[dest.badge]) || 0 : 0, glyph: dest.glyph || (action ? "g-spark" : "g-frame"),
          browse: Number.isFinite(dest.paletteBrowse) ? dest.paletteBrowse : null,
          run: () => nav.go(dest.id),
        };
      });
  }
  // The empty box: Recent, then the sessions that matter now, the places, and the actions marked for it; twelve rows in all.
  function browseV2(recent) {
    const shown = new Set(recent.map((item) => item.key));
    const fresh = (item) => !shown.has(item.key);
    const sessions = state.items.filter((item) => item.kind === "Sessions" && item.browse && fresh(item)).slice(0, BROWSE_SESSIONS);
    const places = state.items.filter((item) => item.kind === "Places" && fresh(item));
    const actions = state.items.filter((item) => item.kind !== "Places" && item.kind !== "Sessions" && Number.isFinite(item.browse) && fresh(item)).sort((a, b) => a.browse - b.browse);
    return [...recent, ...sessions, ...places, ...actions].slice(0, shownMax());
  }

  // ---- Recent: what you last opened or ran from here, per project ----------------------
  // A short list of item keys in this browser's storage, one list per project (no host
  // round trip), newest first. A key whose item is gone (a deleted task, a page that no
  // longer exists) is skipped when the list is shown and never reported; it leaves the
  // list when newer ones push it out. Storage that is blocked or full just means no
  // Recent group.
  const RECENT_PREFIX = "mefi.searchRecent.v1.";
  const RECENT_KEPT = 8;
  const RECENT_SHOWN = 6;
  const recentKey = () => `${RECENT_PREFIX}${currentProject() || "none"}`;
  function readRecents() {
    try {
      const saved = JSON.parse(localStorage.getItem(recentKey()) || "[]");
      return Array.isArray(saved) ? saved.filter((key) => typeof key === "string" && key).slice(0, RECENT_KEPT) : [];
    } catch {
      return [];
    }
  }
  function remember(key) {
    if (!flags.recents || typeof key !== "string" || !key) return;
    try {
      localStorage.setItem(recentKey(), JSON.stringify([key, ...readRecents().filter((other) => other !== key)].slice(0, RECENT_KEPT)));
    } catch {
      /* storage blocked or full: no Recent, nothing else changes */
    }
  }
  // The remembered items that still exist, newest first, filed under Recent.
  function recentItems() {
    if (!flags.recents) return [];
    const known = new Map(state.items.filter((item) => item.key).map((item) => [item.key, item]));
    const found = [];
    for (const key of readRecents()) {
      const item = known.get(key);
      if (item) found.push({ ...item, kind: "Recent" });
      if (found.length >= RECENT_SHOWN) break;
    }
    return found;
  }

  // ---- "task ..." and "idea ...": add one from here, on Enter --------------------------
  // The word, a space and some text. "task" alone, "tasks list" and "ideal" are plain
  // searches. Nothing is added until Enter, and the row sits above the normal results
  // (below a result the whole query names exactly).
  const QUICK_CREATE = /^(task|idea)\s+(\S[\s\S]*)$/i;
  const clip = (value, max) => { const flat = String(value ?? "").replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat; };
  // Adding needs the desktop app's bridge; in a plain browser tab there is nothing to add to,
  // so no row is offered (and the box says nothing about it).
  const canCreate = (kind) => typeof window.mefiStudio?.[kind === "task" ? "tasksCreate" : "ideasAction"] === "function";
  function quickCreateRow(query) {
    if (!flags.quickCreate) return null;
    const match = QUICK_CREATE.exec(query);
    const text = match ? match[2].trim() : "";
    if (!text) return null;
    const kind = match[1].toLowerCase();
    if (!canCreate(kind)) return null;
    return {
      kind: "Create",
      glyph: kind === "task" ? "g-add" : "g-ideas",
      label: `Add ${kind}: “${clip(text, 60)}”`,
      description: kind === "task" ? "Adds it to the task board; the assistant picks it up." : "Saves it in your ideas. Nothing is built from it until you say so.",
      hint: "Enter",
      keyHint: true,
      count: 0,
      create: true,
      run: () => createQuick(kind, text),
    };
  }
  // A task goes through tasks:create, the board's one admission path; an idea through
  // ideas:action with source "owner", so it reads "From you". Either way a toast says
  // what happened, with Open to go to it; a refusal says why and adds nothing.
  async function createQuick(kind, text) {
    const api = window.mefiStudio;
    const say = (message, tone, options) => window.MefiToast?.(message, tone, options);
    const noun = kind === "task" ? "Task" : "Idea";
    try {
      if (kind === "task") {
        const projectId = currentProject();
        const result = await api.tasksCreate({ title: text.slice(0, 180).trimEnd(), prompt: text, ...(projectId ? { projectId } : {}) });
        if (!result?.ok || !result.task) { say(`Task not added · ${result?.error || "the task could not be created"}`, "bad"); return; }
        const id = result.task.id;
        say(`Task added: “${clip(result.task.title || text, 32)}”`, "good", { duration: 8000, action: { label: "Open", run: () => window.MefiNav?.go?.("tasks", { taskId: id }) } });
        return;
      }
      const projectId = currentProject() || (await api.ideasList?.())?.projectId || null;
      if (!projectId) { say("Idea not saved · open a project first", "bad"); return; }
      const result = await api.ideasAction({ action: "add", source: "owner", title: text.slice(0, 200).trimEnd(), detail: text, projectId });
      if (!result?.ok || !result.idea) { say(`Idea not saved · ${result?.error || "the idea could not be saved"}`, "bad"); return; }
      const id = result.idea.id;
      say(`${result.added === false ? "Already in your ideas" : "Idea saved"}: “${clip(result.idea.title || text, 32)}”`, "good", { duration: 8000, action: { label: "Open", run: () => window.MefiNav?.go?.("ideas", { ideaId: id }) } });
    } catch (error) {
      say(`${noun} not ${kind === "task" ? "added" : "saved"} · ${error?.message || error}`, "bad");
    }
  }

  // The host's word on the two switches (main's prefs:get), read at start and each time
  // Search opens. Until it answers both stay on; a bridge without prefs leaves them on.
  async function readFlags() {
    try {
      const result = await window.mefiStudio?.prefsGet?.();
      if (result?.ok && result.prefs) {
        flags.recents = result.prefs.searchRecents !== false;
        flags.quickCreate = result.prefs.searchQuickCreate !== false;
      }
    } catch {
      /* the preferences could not be read: keep what was known */
    }
    if (el.input) {
      dress();
      if (!el.overlay.hidden) filter(true);
    }
  }

  // What the box, its footer and the Close button say, for the layout that is on: v1 as it always was; the 0.5 layout's
  // as the prototype words it (the keys as keys, and that adding only happens on Enter), with the result count kept for a
  // screen reader (it is the status line, read out, not shown). Close goes: the scrim and Escape close it there.
  let plainHint = null;
  function dress() {
    const adds = flags.quickCreate && (canCreate("task") || canCreate("idea"));
    const fresh = v2();
    el.input.placeholder = adds ? (fresh ? "Search, or type “task …” or “idea …” to add one" : "Search · “task …” or “idea …” to add") : plainPlaceholder;
    if (el.close && (fresh || el.close.hidden)) el.close.hidden = fresh;
    if (el.overlay.dataset) el.overlay.dataset.look = fresh ? "v2" : "v1";
    // The prototype's magnifier before the box; v1 has none.
    const row = el.input.parentNode;
    const lens = row?.querySelector?.(".palette-search-glyph") ?? null;
    if (fresh && row && !lens) { const icon = glyphNode("g-search"); if (icon) { icon.setAttribute("class", "glyph palette-search-glyph"); row.insertBefore?.(icon, el.input); } }
    else if (!fresh && lens) lens.remove?.();
    const hint = el.hint;
    if (!hint || !hint.dataset) return;
    if (plainHint === null) plainHint = hint.textContent;
    if (!fresh) { if (hint.dataset.look === "v2") { hint.textContent = plainHint; delete hint.dataset.look; } return; }
    const key = (text) => { const node = document.createElement("kbd"); node.textContent = text; return node; };
    const part = (keys, words) => { const node = document.createElement("span"); node.className = "palette-key"; node.append(...keys.map(key), document.createTextNode(` ${words}`)); return node; };
    const parts = [part(["↑", "↓"], "move"), part(["Enter"], "open"), part(["Esc"], "close")];
    if (adds) { const note = document.createElement("span"); note.className = "palette-note"; note.textContent = "Adding a task or idea only happens on Enter"; parts.push(note); }
    hint.replaceChildren(...parts);
    hint.dataset.look = "v2";
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
    const most = shownMax();
    const items = state.filtered.slice(0, most);
    if (el.status) {
      const count = state.filtered.length;
      const results = count > most ? `Showing ${most} of ${count} results. Keep typing to narrow them.` : `${count} result${count === 1 ? "" : "s"}.`;
      const taskStatus = state.taskStatus === "loading" ? " Loading project tasks…" : state.taskStatus === "error" ? " Tasks couldn't be loaded. Close and reopen Search to retry." : "";
      el.status.textContent = results + (state.filtered[0]?.create ? " Enter adds it; nothing is added until then." : "") + taskStatus;
    }
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = state.taskStatus === "loading" ? "No tool matches yet. Loading project tasks…" : "No matches. Try a page or tool, a setting such as Providers or Updates, a task title or a model name.";
      el.list.append(li);
      setActiveOption();
      return;
    }
    if (v2()) { renderV2(items); return; }
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

  // The prototype's rows: a heading where a group starts (not an option), then per result its icon, its name, a count when it has
  // one, and its state, key or "page" on the right in plain words. The option is the same as v1's to the keys and a screen reader.
  function glyphNode(id) {
    const svg = document.createElementNS?.("http://www.w3.org/2000/svg", "svg");
    if (!svg || typeof svg.setAttribute !== "function") return null;
    svg.setAttribute("class", "glyph palette-glyph"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${id}`); svg.append(use);
    return svg;
  }
  function renderV2(items) {
    items.forEach((item, index) => {
      if (index === 0 || items[index - 1].kind !== item.kind) {
        const head = document.createElement("li");
        head.className = "palette-heading";
        head.setAttribute("role", "presentation");
        head.textContent = item.kind;
        el.list.append(head);
      }
      const li = document.createElement("li");
      li.id = `palette-option-${index}`;
      li.className = "palette-row";
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(index === state.index));
      li.setAttribute("aria-posinset", String(index + 1));
      li.setAttribute("aria-setsize", String(state.filtered.length));
      li.dataset.group = item.kind;
      if (index === state.index) li.classList.add("active");
      const icon = glyphNode(item.glyph || (item.create ? "g-add" : "g-frame"));
      if (icon) li.append(icon);
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = item.label;
      li.append(label);
      if (item.count > 0) {
        const count = document.createElement("span");
        count.className = "count";
        count.textContent = String(item.count);
        li.append(count);
      }
      if (item.hint) {
        const hint = document.createElement("small");
        hint.className = "hint";
        hint.textContent = item.hint;
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
    const query = el.input.value.trim();
    // A refresh in the background (the task list arriving, the switches being read) keeps
    // the highlight on what it was on. Over the empty box, while it is still on the top
    // row, it stays on the top row instead: that row is the last thing you opened, and a
    // Recent task that joins above it must not push the highlight down to the second.
    const selected = preserveSelection && !(query === "" && state.index === 0) ? state.filtered[state.index] : null;
    if (!query) {
      // Recent leads, and what it holds is not listed again below.
      const recent = recentItems();
      const shown = new Set(recent.map((item) => item.key));
      state.filtered = v2() ? browseV2(recent) : [...recent, ...grouped(state.items.filter((item) => !item.key || !shown.has(item.key)))];
    } else {
      state.filtered = grouped(state.items
        .map((item) => ({ item, score: matchScore(query, item) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item));
      // The Add row leads, except when the whole query is exactly the name of something
      // ("task board"): then that result stays on top, so a search that worked before
      // still opens what it named, and Add is the next row down.
      const create = quickCreateRow(query);
      if (create) state.filtered.splice(String(state.filtered[0]?.label ?? "").toLowerCase() === query.toLowerCase() ? 1 : 0, 0, create);
    }
    const retained = selected ? state.filtered.findIndex((item) => item.kind === selected.kind && item.label === selected.label) : -1;
    state.index = retained >= 0 && retained < shownMax() ? retained : 0;
    render();
  }

  function run(index) {
    const item = state.filtered[index];
    if (!item) return;
    if (!item.create) remember(item.key);
    close();
    setTimeout(() => item.run(), 30);
  }

  function open() {
    // Opening Search twice keeps the query and its original focus return.
    if (!el.overlay.hidden && el.input.getAttribute("aria-expanded") === "true") {
      el.input.focus();
      return;
    }
    // Remember what the user came from (tool button, dock item, a text field
    // mid-type) so Escape can hand focus back even without MefiNav's layer
    // bookkeeping to do it for us.
    state.opener = document.activeElement;
    window.MefiNav?.claim?.("palette");
    dress();
    build();
    el.overlay.hidden = false;
    el.input.setAttribute("aria-expanded", "true");
    el.input.value = "";
    filter();
    el.input.focus();
    // The 0.5 layout's sessions come from the board Home already holds: no read of its own while there is one.
    if (!v2() || !board()) loadTasks();
    void readFlags();
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
    el.hint = document.getElementById("palette-hint");
    if (!el.overlay) return;
    plainPlaceholder = el.input.placeholder || "";
    void readFlags();
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
        const span = Math.min(shownMax(), state.filtered.length);
        if (!span) return;
        state.index = event.key === "ArrowDown" ? (state.index + 1) % span : (state.index - 1 + span) % span;
        render();
      } else if (event.key === "Home" || event.key === "End") {
        if (document.activeElement !== el.input) return;
        // Home/End jump straight to the first/last option of the cycle. With a
        // query typed they keep their native caret role in the field, so the
        // jump only applies while browsing the default list.
        if (el.input.value.trim()) return;
        const span = Math.min(shownMax(), state.filtered.length);
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
