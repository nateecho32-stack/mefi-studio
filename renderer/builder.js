// Build's Home as a coding-agent desktop, after the Claude Code and Codex
// desktop apps the owner works in (2026-09-28). The menu lists this project's
// work the way those apps list sessions: Chat with Mefi on top, then Pinned,
// Needs you and Working, then the rest by the day it last moved. The page
// opens on a greeting over what has been built here (tasks, runs, tokens,
// active days, peak hour, top model and a heatmap of the last twenty weeks),
// with the composer at the bottom and chips for the project, its branch, the
// permission mode and the coding worker. A task opens as a session: its brief,
// every run and what it said, its checks and what is holding it, and a
// composer that talks about that task.
//
// The panels that used to sit in Home's drawer and folds (Activity, Preview,
// Queue, Status) become panes (panes.js) that dock beside the page or pop out
// as windows, joined by Output and Checks for the task on screen.
//
// Layout: html[data-home-layout="sessions"]. The classic Home is the default
// (the 0.5.0 plan keeps homeLayout on classic until the owner turns this on):
// a saved mefiStudio.homeLayout of "sessions", ?home=sessions for one launch,
// or Search's "Switch Home layout" (it saves the choice and reloads, since the
// panes adopt the classic Home's own sections) turn it on, and ?home=classic
// turns it off for a launch. Diagnostic launches (?smoke=1, ?capture=1) also
// fall back to the classic Home, so the render fixtures see the page they were
// written for. Under the classic layout this module wires nothing at all: no
// listener, timer or frame, no stored key, no host call and no change to the
// page. The one thing it registers is Search's "Switch Home layout", the way in.
//
// Workspace (workspace.js) still owns Home's data, its composer and every
// host call it made; this module reads its snapshot, adds the session's own
// calls (runs, notes, answers, the work stats) and arranges the page.
(function () {
  "use strict";
  const LAYOUT_KEY = "mefiStudio.homeLayout";
  const DEFAULT_LAYOUT = "classic";
  const layer = document.getElementById("workspace-layer");
  if (!layer) return;
  const api = () => window.mefiStudio;
  const byId = (id) => document.getElementById(id);
  const ws = (id) => document.getElementById(`workspace-${id}`);
  const read = (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private store */ } };
  const readJson = (key, fallback) => { try { const value = JSON.parse(localStorage.getItem(key) ?? "null"); return value ?? fallback; } catch { return fallback; } };
  const headless = /[?&](?:smoke|capture)=1(?:&|$)/.test(String(window.location?.search || ""));
  const param = (() => { try { return new URLSearchParams(window.location?.search || "").get("home"); } catch { return null; } })();
  function layout() {
    if (param === "classic" || param === "sessions") return param;
    const saved = read(LAYOUT_KEY);
    if (saved === "sessions" || saved === "classic") return saved;
    return headless ? "classic" : DEFAULT_LAYOUT;
  }
  const sessions = () => layout() === "sessions";
  const building = () => window.MefiVibe?.mode?.() !== "vibe";
  const person = () => String(read("mefiStudio.workspace.person", "") || "").trim();
  const companion = () => String(read("mefiStudio.workspace.companion", "Mefi") || "Mefi").trim() || "Mefi";
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined && text !== null) node.textContent = String(text); return node; };
  function glyph(name) {
    const svg = document.createElementNS?.("http://www.w3.org/2000/svg", "svg");
    if (!svg) return el("span", "glyph");
    svg.setAttribute("class", "glyph"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", `#${name}`); svg.append(use);
    return svg;
  }
  function button(label, className, run, { title = "", icon = null } = {}) {
    const node = el("button", className);
    node.type = "button";
    if (icon) node.append(glyph(icon));
    if (label) node.append(el("span", "", label));
    if (title) node.title = title;
    if (run) node.addEventListener("click", run);
    return node;
  }
  const plain = (error, fallback) => window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : String(error?.message || error || fallback);
  const toast = (message, kind = "info") => { try { window.MefiToast?.(message, kind); } catch { /* no toasts */ } };

  // ---- time ---------------------------------------------------------------
  const DAY = 86400000;
  const stampOf = (value) => { const number = Number(value); if (Number.isFinite(number) && number > 0) return number; const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? parsed : 0; };
  const lastMoved = (task) => Math.max(stampOf(task.updatedAt), stampOf(task.doneAt), stampOf(task.createdAt), stampOf(task.lastAttempt?.at));
  const startOfDay = (at) => { const date = new Date(at); date.setHours(0, 0, 0, 0); return date.getTime(); };
  function ago(at, now = Date.now()) {
    const ms = now - at;
    if (!Number.isFinite(ms) || at <= 0) return "";
    if (ms < 45000) return "just now";
    if (ms < 3600000) return `${Math.max(1, Math.round(ms / 60000))}m ago`;
    if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
    if (ms < 7 * 86400000) return `${Math.round(ms / 86400000)}d ago`;
    return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
  }
  const clock = (at) => { const date = new Date(at); return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""; };
  function span(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.round(seconds % 3600 / 60)}m`;
  }
  function compact(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (number >= 1e9) return `${(number / 1e9).toFixed(number >= 1e10 ? 0 : 1).replace(/\.0$/, "")}B`;
    if (number >= 1e6) return `${(number / 1e6).toFixed(number >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
    if (number >= 1e4) return `${(number / 1e3).toFixed(number >= 1e5 ? 0 : 1).replace(/\.0$/, "")}K`;
    return number.toLocaleString("en-US");
  }

  // ---- state --------------------------------------------------------------
  const state = { revision: 0, railRevision: -1, view: "home", taskId: null, query: "", searching: false, olderOpen: false, range: "all", tab: "overview", stats: null, statsKey: "", statsFlight: null, statsAt: 0, attempts: new Map(), asks: new Map(), intent: null, busy: null, drafts: new Map(), notes: new Map(), seenAt: 0, painted: new Map(), adopted: false, wired: false, lastUserAt: 0, worktreeTasks: new Set(), worktreeKey: "", worktreeAt: 0 };
  function snapshot() {
    const data = window.MefiWorkspace?.snapshot?.();
    return data && typeof data === "object" ? data : { projectId: null, project: null, projects: [], tasks: [], ideas: [], assistant: {}, status: {}, backlog: null, preview: null };
  }
  const projectId = () => snapshot().projectId;
  const viewKey = (id = projectId()) => `mefiStudio.builder.view.${id || "none"}`;
  const pinKey = (id = projectId()) => `mefiStudio.builder.pins.${id || "none"}`;
  const seenKey = (id = projectId()) => `mefiStudio.builder.seen.${id || "none"}`;
  const pins = () => new Set((readJson(pinKey(), []) || []).filter((id) => typeof id === "string"));
  function setPinned(taskId, on) {
    const set = pins();
    if (on) set.add(taskId); else set.delete(taskId);
    write(pinKey(), JSON.stringify([...set].slice(-40)));
    schedule();
  }

  // ---- what each task is doing --------------------------------------------
  // One reading for the menu dot, the session's pill and the groups, from the
  // same summary Home and Work already share (MefiTasks.workflowSummary).
  const isDone = (task) => ["done", "archived", "completed"].includes(task?.status);
  function reading(task, data = snapshot()) {
    const summary = window.MefiTasks?.workflowSummary?.(task, { status: data.status, backlog: data.backlog, assistant: data.assistant }) ?? null;
    const question = (data.assistant?.questions || []).find((item) => item?.status === "open" && (item.context?.taskId || item.taskId) === task.id);
    const stage = summary?.stage || (isDone(task) ? "done" : task.status === "active" ? "running" : task.status === "awaiting_verification" ? "review" : "ready");
    const tone = question || ["blocked", "approval"].includes(stage) ? "ask"
      : stage === "running" ? "run"
      : stage === "review" ? "check"
      : stage === "done" ? (task.dropped ? "dropped" : "done")
      : ["waiting", "cooling", "deferred", "grouped"].includes(stage) ? "wait"
      : "ready";
    const label = question ? "Needs your answer" : summary?.label || (tone === "done" ? "Done" : "Queued");
    return { stage, tone, label, summary, question };
  }

  // The menu's groups: Pinned, Needs you and Working first, then the rest by
  // the day each last moved. Finished work older than two weeks folds away.
  // The rows are the workspace's own, shared by every listener, so each row's
  // reading is kept here beside it and never written onto it.
  const readings = new WeakMap();
  function groups(tasks, { now = Date.now(), pinned = pins(), data = snapshot() } = {}) {
    const today = startOfDay(now);
    const buckets = new Map();
    const add = (key, title, task, rank) => { if (!buckets.has(key)) buckets.set(key, { key, title, rank, rows: [] }); buckets.get(key).rows.push(task); };
    for (const task of tasks) {
      if (!task?.id || task.archived || task.status === "archived") continue;
      const now2 = reading(task, data);
      readings.set(task, now2);
      if (pinned.has(task.id)) { add("pinned", "Pinned", task, 0); continue; }
      if (now2.tone === "ask") { add("needs", "Needs you", task, 1); continue; }
      if (now2.tone === "run" || now2.tone === "check") { add("working", "Working", task, 2); continue; }
      const at = lastMoved(task);
      const day = startOfDay(at || now);
      const diff = Math.round((today - day) / DAY);
      if (diff <= 0) add("today", "Today", task, 3);
      else if (diff === 1) add("yesterday", "Yesterday", task, 4);
      else if (diff < 7) add(`day:${day}`, new Date(day).toLocaleDateString([], { weekday: "long" }), task, 5 + diff);
      else if (diff < 14 || !isDone(task)) add(`day:${day}`, new Date(day).toLocaleDateString([], { month: "short", day: "numeric" }), task, 5 + diff);
      else add("older", "Older", task, 100000);
    }
    const out = [...buckets.values()].sort((a, b) => a.rank - b.rank);
    for (const group of out) group.rows.sort((a, b) => lastMoved(b) - lastMoved(a));
    return out;
  }

  // ---- scheduling -----------------------------------------------------------
  let queued = false;
  function schedule() {
    state.revision += 1;
    if (queued) return;
    queued = true;
    const run = () => { queued = false; paint(); };
    if (typeof requestAnimationFrame === "function" && !document.hidden) requestAnimationFrame(run); else setTimeout(run, 16);
  }
  function paint() {
    if (!sessions()) return;
    paintRail();
    if (!window.MefiWorkspace?.isActive?.()) return;
    adopt();
    paintTop();
    paintView();
    paintChips();
    paintPanes();
  }

  // ---- the menu -------------------------------------------------------------
  // nav.js builds the rail; in the sessions layout it hands the switch and the
  // work list here (decorateRail / paintRail), and keeps everything else.
  const ownsRail = () => sessions() && building() && Boolean(byId("app-rail")) && document.documentElement.dataset.shell === "rail";
  function decorateRail({ sections, foot } = {}) {
    if (!ownsRail() || !sections) { delete document.documentElement.dataset.railSessions; return; }
    document.documentElement.dataset.railSessions = "";
    if (!sections.querySelector(".builder-mode-switch")) {
      const group = el("div", "mode-switch builder-mode-switch");
      group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", "Studio mode");
      const current = window.MefiVibe?.mode?.() || "build";
      group.dataset.mode = current;
      for (const [mode, label, icon, title] of [["vibe", "Vibe", "g-home", "Vibe: your home, friends and Mefi"], ["build", "Build", "g-wrench", "Build: tasks, agents and every tool"]]) {
        const choice = button(label, "", null, { icon, title });
        choice.setAttribute("role", "radio"); choice.dataset.uiMode = mode;
        choice.setAttribute("aria-checked", String(mode === current));
        group.append(choice);
      }
      sections.prepend(group);
    }
    if (!sections.querySelector("#app-rail-sessions")) {
      const list = el("div", "builder-sessions app-rail-children");
      list.id = "app-rail-sessions";
      list.setAttribute("role", "group"); list.setAttribute("aria-label", "This project's work");
      sections.append(list);
    }
    if (foot && !foot.querySelector("#app-rail-person")) {
      const chip = button("", "app-rail-item app-rail-person", () => window.MefiNav?.go?.("studio", { category: "general" }), { title: "You · names and startup (Settings › General)" });
      chip.id = "app-rail-person";
      const avatar = el("span", "builder-avatar", "");
      const words = el("span", "label builder-person-words");
      words.append(el("b", "", "You"), el("small", "", ""));
      chip.replaceChildren(avatar, words);
      foot.prepend(chip);
    }
    paintRail();
  }
  function paintRail() {
    if (!ownsRail()) return false;
    const list = byId("app-rail-sessions");
    if (!list) return false;
    if (state.railRevision === state.revision && list.childElementCount) return true;
    state.railRevision = state.revision;
    const data = snapshot();
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const pinned = pins();
    const query = state.query.trim().toLowerCase();
    const visible = query ? tasks.filter((task) => `${task.title || ""} ${task.prompt || ""}`.toLowerCase().includes(query)) : tasks;
    const grouped = groups(visible, { pinned, data });
    const messages = (data.assistant?.messages || []).filter((message) => ["user", "assistant"].includes(message.role) && (!message.projectId || message.projectId === data.projectId));
    const lastSaid = messages.filter((message) => message.role === "assistant").at(-1);
    const seen = Number(read(seenKey(), "0")) || 0;
    const unread = Boolean(lastSaid && stampOf(lastSaid.at) > seen && !(state.view === "chat" && window.MefiWorkspace?.isActive?.()));
    const current = state.view === "task" ? state.taskId : state.view === "chat" ? "__chat" : null;
    lookForWorktrees();
    const signature = JSON.stringify([data.projectId, grouped.map((group) => [group.key, group.title, group.rows.map((task) => [task.id, task.title || task.prompt || "", readings.get(task).tone, readings.get(task).label, state.worktreeTasks.has(task.id)])]), state.query, state.searching, state.olderOpen, unread, current, companion(), window.MefiWorkspace?.isActive?.() ? 1 : 0]);
    paintPerson(data);
    if (state.painted.get("rail") === signature && list.childElementCount) return true;
    state.painted.set("rail", signature);
    const held = list.contains(document.activeElement) ? document.activeElement : null;
    const heldKey = held?.dataset?.key || (held?.classList?.contains("builder-search-input") ? "search" : null);
    const rows = [];
    // Search and Chat with Mefi head the list.
    const head = el("div", "builder-sessions-head");
    head.append(el("span", "app-rail-heading", "Tasks"));
    const find = button("", "builder-icon-btn", () => { state.searching = !state.searching; if (!state.searching) state.query = ""; repaintRail(); if (state.searching) byId("builder-rail-search")?.focus?.(); }, { icon: "g-search", title: state.searching ? "Stop filtering" : "Filter this list" });
    find.setAttribute("aria-label", state.searching ? "Stop filtering the work list" : "Filter the work list");
    find.setAttribute("aria-pressed", String(state.searching));
    find.dataset.key = "find";
    head.append(find);
    rows.push(head);
    if (state.searching) {
      const input = el("input", "builder-search-input");
      input.id = "builder-rail-search"; input.type = "search"; input.placeholder = "Filter tasks…"; input.value = state.query;
      input.setAttribute("aria-label", "Filter this project's tasks");
      input.dataset.typeHere = "";
      input.addEventListener("input", () => { state.query = input.value; repaintRail(); });
      input.addEventListener("keydown", (event) => { if (["Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key)) { event.stopPropagation(); return; } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); state.searching = false; state.query = ""; repaintRail(); find.focus?.(); } });
      rows.push(input);
    }
    const chat = row({ key: "__chat", title: `Chat with ${companion()}`, tone: unread ? "new" : "chat", label: unread ? "New reply" : "Conversation", icon: "g-plane", selected: current === "__chat", run: () => openChat() });
    rows.push(chat);
    let shown = 0;
    for (const group of grouped) {
      if (group.key === "older" && !state.olderOpen) {
        const more = button(`Older · ${group.rows.length}`, "builder-older", () => { state.olderOpen = true; repaintRail(); }, { title: "Show finished work from more than two weeks ago" });
        more.dataset.key = "older";
        rows.push(more);
        continue;
      }
      rows.push(el("span", "app-rail-heading builder-group", group.title));
      for (const task of group.rows) {
        const now = readings.get(task);
        rows.push(row({ key: task.id, title: window.MefiTasks?.shortTitle?.(task) || task.title || task.prompt || "Untitled task", full: task.title || task.prompt || "", tone: now.tone, label: now.label, pinned: pinned.has(task.id), worktree: state.worktreeTasks.has(task.id), selected: current === task.id, run: () => openTask(task.id) }));
        shown += 1;
      }
    }
    if (!tasks.length) rows.push(el("p", "builder-empty-list", "Tasks you start show up here, like sessions."));
    else if (!shown && query) rows.push(el("p", "builder-empty-list", "No task matches that filter."));
    list.replaceChildren(...rows);
    if (heldKey) {
      const again = heldKey === "search" ? byId("builder-rail-search") : list.querySelector(`[data-key="${CSS.escape ? CSS.escape(heldKey) : heldKey}"]`);
      again?.focus?.({ preventScroll: true });
    }
    return true;
  }
  function repaintRail() { state.revision += 1; state.painted.delete("rail"); paintRail(); }
  function row({ key, title, full = "", tone, label, icon = null, pinned = false, worktree = false, selected = false, run }) {
    const node = el("button", "app-rail-item builder-session");
    node.type = "button"; node.tabIndex = -1;
    node.dataset.key = key; node.dataset.tone = tone;
    if (selected) node.setAttribute("aria-current", "page");
    const mark = icon ? glyph(icon) : el("i", "builder-dot");
    mark.classList?.add?.("builder-mark");
    const words = el("span", "label", title);
    node.append(mark, words);
    if (worktree) { const branch = glyph("g-worktree"); branch.classList.add("builder-worktree"); node.append(branch); }
    if (pinned) { const pin = glyph("g-pin"); pin.classList.add("builder-pinned"); node.append(pin); }
    node.title = `${full || title} · ${label}${worktree ? " · in its own worktree" : ""}`;
    node.setAttribute("aria-label", `${title}. ${label}${worktree ? ". In its own worktree" : ""}${pinned ? ". Pinned" : ""}`);
    node.addEventListener("click", run);
    return node;
  }
  function paintPerson(data) {
    const chip = byId("app-rail-person");
    if (!chip) return;
    const name = person() || "You";
    const running = (data.status?.running || []).length;
    const asks = (data.assistant?.questions || []).filter((item) => item?.status === "open").length;
    const line = asks ? `${asks} need${asks === 1 ? "s" : ""} you` : running ? `${running} agent${running === 1 ? "" : "s"} working` : data.project?.name ? data.project.name : "All quiet";
    const avatar = chip.querySelector(".builder-avatar");
    const initial = name.trim().slice(0, 1).toUpperCase() || "Y";
    if (avatar && avatar.textContent !== initial) avatar.textContent = initial;
    const words = chip.querySelector(".builder-person-words");
    if (words && (words.firstChild?.textContent !== name || words.lastChild?.textContent !== line)) {
      words.firstChild.textContent = name; words.lastChild.textContent = line;
    }
    chip.dataset.tone = asks ? "ask" : running ? "run" : "quiet";
  }

  // A task whose run works in its own worktree (Work › Worktrees) wears the branch
  // mark in the menu, so it is easy to see which work lives in another folder.
  // worktrees.js reads the list (quietly, and not more often than every few
  // seconds) and says so when it changes; this only keeps the ids it names.
  function haveWorktrees(info) {
    const ids = Array.isArray(info?.tasks) ? info.tasks.map(String) : [];
    const key = [...new Set(ids)].sort().join("\n");
    if (key === state.worktreeKey) return;
    state.worktreeKey = key;
    state.worktreeTasks = new Set(ids);
    repaintRail();
  }
  function lookForWorktrees() {
    const looker = window.MefiWorktrees;
    if (!looker?.peek || Date.now() - state.worktreeAt < 8000) return;
    state.worktreeAt = Date.now();
    Promise.resolve(looker.peek()).then(haveWorktrees, () => {});
  }

  // ---- adopting the classic Home's sections into panes -------------------
  // Once per launch, in the sessions layout: the page gets its session area,
  // its chips, its dock and its window layer, and the old drawer's and folds'
  // sections move into panes. Their ids and their owner stay the same.
  function adopt() {
    if (state.adopted || !sessions()) return;
    const conversation = ws("conversation-content");
    const form = ws("form");
    if (!conversation || !form || !window.MefiPanes) return;
    state.adopted = true;
    document.documentElement.dataset.homeLayout = "sessions";
    const main = layer.querySelector(".ws-main");
    const home = el("section", "builder-home"); home.id = "builder-home"; home.setAttribute("aria-label", "Start something new");
    const session = el("section", "builder-task"); session.id = "builder-task"; session.setAttribute("aria-label", "Task session");
    conversation.prepend(home, session);
    const chips = el("div", "builder-chips"); chips.id = "builder-chips"; chips.setAttribute("role", "group"); chips.setAttribute("aria-label", "Where this runs");
    form.before(chips);
    const taskForm = el("form", "ws-composer builder-task-compose"); taskForm.id = "builder-task-compose"; taskForm.hidden = true;
    form.after(taskForm);
    buildTaskComposer(taskForm);
    buildComposerTools(form);
    const top = layer.querySelector(".ws-topbar");
    if (top && !byId("builder-title")) {
      const title = el("div", "builder-title"); title.id = "builder-title";
      top.prepend(title);
      const toggles = el("div", "builder-pane-toggles"); toggles.id = "builder-pane-toggles"; toggles.setAttribute("role", "group"); toggles.setAttribute("aria-label", "Panes");
      const actions = top.querySelector(".ws-top-actions");
      actions?.insertBefore(toggles, ws("attention-shortcut") ?? null);
    }
    const dock = el("aside", "pane-dock"); dock.id = "builder-dock"; dock.setAttribute("aria-label", "Docked panes"); dock.hidden = true;
    const floats = el("div", "pane-floats"); floats.id = "builder-floats";
    (layer.querySelector(".ws-home-layout") ?? main ?? layer).append(dock);
    layer.append(floats);
    registerPanes();
    window.MefiPanes.attach({ dock, floats, host: layer });
    paintToggles();
    restoreView();
  }

  // ---- panes ----------------------------------------------------------------
  const PANES = [
    { id: "activity", title: "Activity", glyph: "g-gauge", order: 0 },
    { id: "output", title: "Output", glyph: "g-palette", order: 1 },
    { id: "checks", title: "Checks", glyph: "g-tasks", order: 2 },
    { id: "preview", title: "Preview", glyph: "g-studio", order: 3 },
    { id: "queue", title: "Queue", glyph: "g-legend", order: 4 },
    { id: "status", title: "Status", glyph: "g-sliders", order: 5 },
  ];
  const paneBodies = new Map();
  function registerPanes() {
    const focus = ws("focus-panel");
    const preview = ws("preview-panel");
    const queue = layer.querySelector(".ws-work");
    const dashboard = ws("dashboard");
    const recent = layer.querySelector(".ws-conversation > .ws-conversation-content > .ws-activity, .ws-activity");
    const statusBox = el("div", "builder-status-pane");
    if (dashboard) statusBox.append(dashboard);
    if (recent) statusBox.append(recent);
    const output = el("div", "builder-output"); output.id = "builder-output";
    const checks = el("div", "builder-checks"); checks.id = "builder-checks";
    const contents = { activity: focus, output, checks, preview, queue, status: statusBox };
    for (const def of PANES) {
      const content = contents[def.id];
      if (!content) continue;
      window.MefiPanes.register({ ...def, content, start: def.id === "activity" ? null : undefined, onShow: () => schedule() });
      paneBodies.set(def.id, content);
    }
    window.addEventListener("mefi:panes", () => { paintToggles(); schedule(); });
  }
  function paintToggles() {
    const holder = byId("builder-pane-toggles");
    if (!holder || !window.MefiPanes) return;
    const known = window.MefiPanes.list();
    if (holder.childElementCount !== known.length) {
      holder.replaceChildren(...known.map((pane) => {
        const toggle = button("", "builder-icon-btn builder-pane-toggle", () => window.MefiPanes.toggle(pane.id, { focus: true }), { icon: pane.glyph, title: pane.title });
        toggle.dataset.paneToggle = pane.id;
        toggle.setAttribute("aria-label", pane.title);
        toggle.append(el("i", "builder-toggle-dot"));
        return toggle;
      }));
    }
    for (const pane of known) {
      const toggle = holder.querySelector(`[data-pane-toggle="${pane.id}"]`);
      if (!toggle) continue;
      toggle.setAttribute("aria-pressed", String(pane.where !== "closed"));
      toggle.dataset.where = pane.where;
      toggle.title = `${pane.title}${pane.where === "float" ? " · in a window" : pane.where === "dock" ? " · docked" : ""}`;
    }
  }
  function paintPanes() {
    const data = snapshot();
    const task = subject(data);
    const run = task && (data.status?.running || []).find((job) => job.taskId === task.id);
    window.MefiPanes?.auto?.("activity", Boolean((data.status?.running || []).length));
    paintOutput(task, run, data);
    paintChecks(task, data);
    const asks = (data.assistant?.questions || []).filter((item) => item?.status === "open").length;
    window.MefiPanes?.badge?.("activity", run ? "live" : "", run ? "run" : "");
    window.MefiPanes?.badge?.("status", asks ? String(asks) : "", asks ? "ask" : "");
    const ready = data.backlog?.counts?.ready || 0;
    window.MefiPanes?.badge?.("queue", ready ? String(ready) : "", "");
    const phase = data.preview?.phase;
    window.MefiPanes?.badge?.("preview", phase === "ready" ? "ready" : phase === "starting" ? "…" : "", phase === "ready" ? "run" : "");
    for (const toggle of document.querySelectorAll("#builder-pane-toggles [data-pane-toggle]")) {
      const id = toggle.dataset.paneToggle;
      const tone = id === "activity" && run ? "run" : id === "status" && asks ? "ask" : id === "preview" && phase === "ready" ? "run" : "";
      if (toggle.dataset.tone !== tone) toggle.dataset.tone = tone;
    }
  }
  // The task a pane speaks for: the one on screen, else the one Home follows.
  function subject(data = snapshot()) {
    const tasks = data.tasks || [];
    if (state.view === "task" && state.taskId) return tasks.find((task) => task.id === state.taskId) ?? null;
    // A row with no id (or a job with no task) must never match "no task followed".
    const followed = window.MefiNav?.taskContext?.(data.projectId)?.taskId;
    return (followed ? tasks.find((task) => task.id === followed) : null)
      ?? tasks.find((task) => task.id && (data.status?.running || []).some((job) => job.taskId === task.id))
      ?? null;
  }
  function paintOutput(task, run, data) {
    const box = byId("builder-output");
    if (!box || window.MefiPanes?.where?.("output") === "closed") return;
    const tail = run && task?.runProgress?.runId === run.runId && Array.isArray(task.runProgress.outputTail) ? task.runProgress.outputTail
      : Array.isArray(task?.runProgress?.outputTail) ? task.runProgress.outputTail : [];
    const attempts = task ? state.attempts.get(task.id)?.attempts || [] : [];
    const lines = tail.length ? tail : attempts[0]?.tail || [];
    const signature = JSON.stringify([task?.id, run?.currentStep, run?.activity, lines.slice(-60)]);
    if (state.painted.get("output") === signature) return;
    state.painted.set("output", signature);
    const head = el("p", "builder-pane-lead", task ? `${window.MefiTasks?.shortTitle?.(task) || task.title} · ${run ? run.currentStep || run.activity || "working" : lines.length ? "last run" : "no output yet"}` : "Open a task to follow its output.");
    const pre = el("pre", "builder-output-log");
    pre.textContent = lines.length ? lines.slice(-60).join("\n") : run ? "Waiting for the worker's first line…" : "Nothing recorded yet. A run's output shows here while it works.";
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.replaceChildren(head, pre);
    if (stick) box.scrollTop = box.scrollHeight;
    if (task && !state.attempts.has(task.id)) loadAttempts(task);
  }
  function paintChecks(task, data) {
    const box = byId("builder-checks");
    if (!box || window.MefiPanes?.where?.("checks") === "closed") return;
    const summary = task ? reading(task, data).summary : null;
    const run = task?.verificationRun;
    const results = Array.isArray(run?.results) ? run.results : [];
    const acceptance = Array.isArray(task?.acceptance) ? task.acceptance : typeof task?.acceptance === "string" && task.acceptance.trim() ? task.acceptance.split(/\r?\n/) : [];
    const signature = JSON.stringify([task?.id, summary?.checks, results, acceptance, task?.verification]);
    if (state.painted.get("checks") === signature) return;
    state.painted.set("checks", signature);
    const out = [];
    if (!task) { out.push(el("p", "builder-pane-lead", "Open a task to see what it must pass.")); box.replaceChildren(...out); return; }
    out.push(el("p", "builder-pane-lead", summary?.checks || "No completion checks recorded"));
    if (acceptance.length) {
      out.push(el("h3", "builder-pane-h", "Done when"));
      const list = el("ul", "builder-check-list");
      for (const line of acceptance.map((item) => String(item).trim()).filter(Boolean)) list.append(el("li", "", line));
      out.push(list);
    }
    if (results.length) {
      out.push(el("h3", "builder-pane-h", "Last check run"));
      const list = el("ul", "builder-check-list results");
      for (const result of results) {
        const item = el("li", result.ok === true ? "ok" : result.ok === false ? "bad" : "");
        item.append(el("b", "", result.ok === true ? "Passed" : result.ok === false ? "Failed" : "Ran"), el("span", "", String(result.name || result.command || result.check || "Check")));
        if (result.detail || result.output) item.append(el("small", "", String(result.detail || result.output).slice(0, 240)));
        list.append(item);
      }
      out.push(list);
    }
    if (task.verification?.reason) out.push(el("p", "builder-pane-note", `${task.verification.state === "verified" ? "Verified" : task.verification.state === "failed" ? "Not accepted" : "Checked"}: ${task.verification.reason}`));
    box.replaceChildren(...out);
  }

  // ---- the top bar ----------------------------------------------------------
  function paintTop() {
    const title = byId("builder-title");
    if (!title) return;
    const data = snapshot();
    const task = state.view === "task" ? (data.tasks || []).find((item) => item.id === state.taskId) : null;
    const where = state.view === "task" ? (task ? "Task" : "Task") : state.view === "chat" ? `Chat with ${companion()}` : "New task";
    const history = window.MefiNav?.historyState?.() || {};
    const signature = JSON.stringify([where, data.project?.name, history.canBack, history.canForward]);
    if (state.painted.get("title") === signature) return;
    state.painted.set("title", signature);
    const back = button("", "builder-icon-btn", () => window.MefiNav?.back?.(), { icon: "g-back", title: "Back (Alt ←)" });
    back.setAttribute("aria-label", "Back"); back.disabled = !history.canBack;
    const forward = button("", "builder-icon-btn builder-forward", () => window.MefiNav?.forward?.(), { icon: "g-back", title: "Forward (Alt →)" });
    forward.setAttribute("aria-label", "Forward"); forward.disabled = !history.canForward;
    const trail = el("span", "builder-trail");
    trail.append(el("strong", "", data.project?.name || "Studio"), el("span", "builder-trail-sep", "/"), el("span", "", where));
    title.replaceChildren(back, forward, trail);
    title.title = data.project?.path || "";
  }

  // ---- views ----------------------------------------------------------------
  function restoreView() {
    const saved = readJson(viewKey(), null);
    if (saved?.view === "task" && typeof saved.taskId === "string") { state.view = "task"; state.taskId = saved.taskId; }
    else if (saved?.view === "chat") state.view = "chat";
    else state.view = "home";
    apply();
  }
  function setView(view, { taskId = null, focus = false } = {}) {
    const next = ["home", "chat", "task"].includes(view) ? view : "home";
    const changed = next !== state.view || taskId !== state.taskId;
    state.view = next;
    state.taskId = next === "task" ? taskId : null;
    write(viewKey(), JSON.stringify({ view: state.view, taskId: state.taskId }));
    if (next === "chat") markSeen();
    if (changed) { state.painted.delete("title"); state.painted.delete("task"); state.painted.delete("output"); state.painted.delete("checks"); state.intent = null; }
    apply();
    schedule();
    if (focus) requestAnimationFrame?.(() => (next === "task" ? byId("builder-task-input") : ws("input"))?.focus?.({ preventScroll: true }));
  }
  function apply() {
    if (!state.adopted) return;
    layer.dataset.view = state.view;
    const form = ws("form"), taskForm = byId("builder-task-compose");
    if (form) form.hidden = state.view === "task";
    if (taskForm) taskForm.hidden = state.view !== "task";
    byId("builder-home").hidden = state.view !== "home";
    byId("builder-task").hidden = state.view !== "task";
    if (state.view === "chat") window.MefiWorkspace?.setComposerMode?.("chat");
  }
  function markSeen() {
    const data = snapshot();
    const last = (data.assistant?.messages || []).filter((message) => message.role === "assistant").at(-1);
    const at = Math.max(Date.now(), stampOf(last?.at));
    write(seenKey(), String(at));
    state.painted.delete("rail");
  }
  function openTask(taskId, { focus = false, pane = null, intent = null } = {}) {
    const data = snapshot();
    const task = (data.tasks || []).find((item) => item.id === taskId);
    if (task) window.MefiNav?.selectTask?.({ taskId, projectId: data.projectId, title: window.MefiTasks?.shortTitle?.(task) || task.title });
    window.MefiNav?.go?.("workspace", { view: "task", taskId, projectId: data.projectId });
    setView("task", { taskId, focus });
    if (intent) { state.intent = intent; state.painted.delete("task"); }
    if (pane) window.MefiPanes?.open?.(pane, { focus: false });
  }
  // A finished task's "Request a change", from anywhere: its session opens
  // with the composer set to make a linked follow-up.
  function requestChange(task) {
    if (!task?.id) return false;
    openTask(task.id, { focus: true, intent: "change" });
    return true;
  }
  function openChat() {
    window.MefiNav?.go?.("workspace", { view: "chat" });
    setView("chat", { focus: true });
  }
  function newTask() {
    window.MefiNav?.go?.("workspace", { view: "home" });
    setView("home");
    window.MefiWorkspace?.setComposerMode?.("work");
    requestAnimationFrame?.(() => ws("input")?.focus?.({ preventScroll: true }));
  }
  function paintView() {
    followChat();
    apply();
    if (state.view === "home") paintHome();
    else if (state.view === "task") paintTask();
    else markSeenIfShowing();
  }
  // A message sent in Chat mode from the New task page opens the chat, where
  // its reply lands. Only a message sent since this page last looked counts.
  function followChat() {
    const data = snapshot();
    const last = (data.assistant?.messages || []).filter((message) => message.role === "user" && (!message.projectId || message.projectId === data.projectId)).at(-1);
    const at = stampOf(last?.at);
    if (!state.lastUserSeen || state.lastUserProject !== data.projectId) { state.lastUserSeen = at || 1; state.lastUserProject = data.projectId; return; }
    if (at > state.lastUserSeen) {
      state.lastUserSeen = at;
      if (state.view === "home" && Date.now() - at < 60000 && data.mode === "chat") setView("chat");
    }
  }
  function markSeenIfShowing() {
    const data = snapshot();
    const last = (data.assistant?.messages || []).filter((message) => message.role === "assistant").at(-1);
    if (last && stampOf(last.at) > (Number(read(seenKey(), "0")) || 0)) markSeen();
  }

  // ---- home: greeting and stats --------------------------------------------
  function paintHome() {
    const box = byId("builder-home");
    if (!box) return;
    const data = snapshot();
    loadStats(data);
    const signature = JSON.stringify([data.projectId, person(), state.range, state.tab, state.statsKey, state.stats ? 1 : 0, new Date().getHours() < 12 ? 0 : new Date().getHours() < 18 ? 1 : 2]);
    if (state.painted.get("home") === signature && box.childElementCount) return;
    state.painted.set("home", signature);
    const name = person();
    const hello = el("div", "builder-hello");
    const star = el("span", "builder-star"); star.setAttribute("aria-hidden", "true"); star.append(asterisk());
    hello.append(star, el("h1", "", name ? `What's up next, ${name}?` : "What's up next?"));
    const card = statsCard(data);
    const invitations = [byId("walkthrough-invitation"), byId("community-invitation")].filter(Boolean);
    const extras = el("div", "builder-invites");
    for (const node of invitations) extras.append(node);
    box.replaceChildren(hello, card, extras);
  }

  function asterisk() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS?.(NS, "svg");
    if (!svg) return el("span", "", "✳");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "builder-asterisk"); svg.setAttribute("focusable", "false");
    for (const angle of [0, 45, 90, 135]) {
      const ray = document.createElementNS(NS, "path");
      ray.setAttribute("d", "M12 2.5v19"); ray.setAttribute("transform", `rotate(${angle} 12 12)`);
      svg.append(ray);
    }
    return svg;
  }
  // Work stats: what the host counted (work:stats) or, without it, what the
  // board itself records. Never invented: an unknown tile says so.
  function loadStats(data) {
    const key = `${data.projectId}:${state.range}`;
    const fresh = state.statsKey === key && Date.now() - state.statsAt < 60000;
    if (fresh || state.statsFlight) return;
    const epoch = key;
    state.statsFlight = Promise.resolve(api()?.workStats?.({ projectId: data.projectId, range: state.range }))
      .then((result) => (result?.ok ? normalizeHost(result) : null))
      .catch(() => null)
      .then((host) => {
        if (`${snapshot().projectId}:${state.range}` !== epoch) return;
        state.stats = host || boardStats(snapshot(), state.range);
        state.statsKey = key; state.statsAt = Date.now();
        state.painted.delete("home");
        schedule();
      })
      .finally(() => { state.statsFlight = null; });
  }
  function normalizeHost(result) {
    const days = Array.isArray(result.days) ? result.days.filter((day) => typeof day?.day === "string") : [];
    return {
      source: "host",
      tiles: {
        tasks: Number.isFinite(result.totals?.tasks) ? result.totals.tasks : null,
        runs: Number.isFinite(result.totals?.runs) ? result.totals.runs : null,
        tokens: Number.isFinite(result.totals?.tokens) ? result.totals.tokens : null,
        activeDays: Number.isFinite(result.totals?.activeDays) ? result.totals.activeDays : days.filter((day) => day.count > 0).length,
        peakHour: Number.isFinite(result.peakHour) ? result.peakHour : null,
        topModel: result.models?.[0]?.name || null,
      },
      days,
      models: Array.isArray(result.models) ? result.models : [],
      verified: Number.isFinite(result.totals?.verified) ? result.totals.verified : null,
    };
  }
  // From the board alone: each task's creation, its runs' starts and its
  // finish are the moments it moved.
  function boardStats(data, range, now = Date.now()) {
    const since = range === "7d" ? now - 7 * DAY : range === "30d" ? now - 30 * DAY : 0;
    const moments = [];
    const models = new Map();
    let runs = 0, tasks = 0, verified = 0;
    for (const task of data.tasks || []) {
      const created = stampOf(task.createdAt);
      if (created >= since) { tasks += 1; moments.push(created); }
      const attempt = task.lastAttempt;
      const at = stampOf(attempt?.at);
      if (at >= since && at) { runs += 1; moments.push(at); }
      const route = String(attempt?.route || attempt?.via || "").trim();
      if (route && at >= since) models.set(route, (models.get(route) || 0) + 1);
      const finished = stampOf(task.doneAt);
      if (finished >= since && finished) { moments.push(finished); if (task.verification?.state === "verified") verified += 1; }
    }
    const counts = new Map();
    const hours = new Array(24).fill(0);
    for (const at of moments) {
      const date = new Date(at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      hours[date.getHours()] += 1;
    }
    const peak = hours.some(Boolean) ? hours.indexOf(Math.max(...hours)) : null;
    const ranked = [...models.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, runs: count, tokens: null }));
    return { source: "board", tiles: { tasks, runs: runs || null, tokens: null, activeDays: counts.size, peakHour: peak, topModel: ranked[0]?.name || null }, days: [...counts.entries()].map(([day, count]) => ({ day, count })), models: ranked, verified };
  }
  const hourWords = (hour) => !Number.isFinite(hour) ? "—" : `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
  // Comparisons for the token line: approximate token counts of long books.
  const BOOKS = [["War and Peace", 780000], ["The Lord of the Rings", 640000], ["Moby-Dick", 280000], ["The Hobbit", 125000]];
  function flourish(stats) {
    const tokens = stats?.tiles?.tokens;
    if (Number.isFinite(tokens) && tokens > 0) {
      const [book, size] = BOOKS.find(([, count]) => tokens >= count * 2) ?? BOOKS.at(-1);
      const times = tokens / size;
      if (times >= 1.5) return `Your agents have read and written about ${times >= 100 ? Math.round(times).toLocaleString("en-US") : times.toFixed(times >= 10 ? 0 : 1)}× ${book}.`;
    }
    const best = [...(stats?.days || [])].sort((a, b) => b.count - a.count)[0];
    if (best?.count > 1) return `Your busiest day was ${new Date(`${best.day}T12:00:00`).toLocaleDateString([], { month: "long", day: "numeric" })}, with ${best.count} moments of work.`;
    if (stats?.verified) return `${stats.verified} task${stats.verified === 1 ? "" : "s"} verified so far.`;
    return "Start a task below and this fills in as your agents work.";
  }
  function statsCard(data) {
    const stats = state.stats || boardStats(data, state.range);
    const card = el("section", "builder-stats");
    card.setAttribute("aria-label", "What has been built here");
    const bar = el("div", "builder-stats-bar");
    const tabs = el("div", "builder-seg"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Stats view");
    for (const [id, label] of [["overview", "Overview"], ["models", "Models"]]) {
      const tab = button(label, "", () => { state.tab = id; state.painted.delete("home"); paintHome(); byId(`builder-stats-tab-${id}`)?.focus?.(); });
      tab.id = `builder-stats-tab-${id}`; tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", String(state.tab === id));
      tabs.append(tab);
    }
    const ranges = el("div", "builder-seg quiet"); ranges.setAttribute("role", "group"); ranges.setAttribute("aria-label", "Time range");
    for (const [id, label] of [["all", "All"], ["30d", "30d"], ["7d", "7d"]]) {
      const range = button(label, "", () => { state.range = id; state.statsAt = 0; state.stats = null; state.painted.delete("home"); paintHome(); byId(`builder-stats-range-${id}`)?.focus?.(); });
      range.id = `builder-stats-range-${id}`; range.setAttribute("aria-pressed", String(state.range === id));
      ranges.append(range);
    }
    bar.append(tabs, ranges);
    card.append(bar);
    if (state.tab === "models") card.append(modelsView(stats));
    else card.append(overview(stats));
    const note = el("p", "builder-flourish", flourish(stats));
    if (stats.source === "board") note.title = "Counted from this project's board. The desktop app adds runs and tokens from its ledgers.";
    card.append(note);
    return card;
  }
  function overview(stats) {
    const box = el("div", "builder-overview");
    const tiles = el("div", "builder-tiles");
    const tile = (label, value, hint = "") => { const node = el("div", "builder-tile"); node.append(el("span", "", label), el("strong", "", value)); if (hint) node.title = hint; return node; };
    const t = stats.tiles || {};
    tiles.append(
      tile("Tasks", Number.isFinite(t.tasks) ? compact(t.tasks) : "—", "Tasks made in this project in the range"),
      tile("Runs", Number.isFinite(t.runs) ? compact(t.runs) : "—", "Worker attempts that started in the range"),
      tile("Total tokens", Number.isFinite(t.tokens) ? compact(t.tokens) : "—", Number.isFinite(t.tokens) ? "Tokens your agents and Studio used" : "No token counts recorded for this range"),
      tile("Active days", Number.isFinite(t.activeDays) ? compact(t.activeDays) : "—"),
      tile("Peak hour", hourWords(t.peakHour), "The hour of day work most often moved"),
      tile("Top model", t.topModel || "—", "The route that ran the most attempts"),
    );
    box.append(tiles, heatmap(stats.days || []));
    return box;
  }
  // Twenty weeks of days, a column a week, Sunday on top, like a contribution graph.
  function heatmap(days, now = Date.now()) {
    const counts = new Map(days.map((day) => [day.day, Number(day.count) || 0]));
    const grid = el("div", "builder-heat");
    grid.setAttribute("role", "img");
    const weeks = 22;
    const today = new Date(startOfDay(now));
    const start = new Date(today); start.setDate(today.getDate() - today.getDay() - (weeks - 1) * 7);
    const max = Math.max(1, ...counts.values());
    let active = 0;
    for (let week = 0; week < weeks; week += 1) {
      const column = el("div", "builder-heat-week");
      for (let weekday = 0; weekday < 7; weekday += 1) {
        const date = new Date(start); date.setDate(start.getDate() + week * 7 + weekday);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const count = counts.get(key) || 0;
        const cell = el("i", "builder-heat-day");
        const level = date > today ? -1 : count ? Math.min(4, Math.ceil((count / max) * 4)) : 0;
        cell.dataset.level = String(level);
        if (level > 0) active += 1;
        if (level >= 0) cell.title = `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}: ${count ? `${count} moment${count === 1 ? "" : "s"} of work` : "no work"}`;
        column.append(cell);
      }
      grid.append(column);
    }
    grid.setAttribute("aria-label", `Activity over the last ${weeks} weeks: ${active} active day${active === 1 ? "" : "s"}.`);
    return grid;
  }
  function modelsView(stats) {
    const box = el("div", "builder-models");
    const rows = (stats.models || []).slice(0, 8);
    if (!rows.length) { box.append(el("p", "builder-pane-note", "No runs recorded in this range yet. Each model that runs a task shows here with its share.")); return box; }
    const total = rows.reduce((sum, row) => sum + (Number(row.runs) || 0), 0) || 1;
    for (const model of rows) {
      const line = el("div", "builder-model-row");
      const share = Math.round(((Number(model.runs) || 0) / total) * 100);
      const bar = el("span", "builder-model-bar"); bar.style.setProperty("--share", `${share}%`);
      const facts = [`${compact(model.runs)} run${model.runs === 1 ? "" : "s"}`, Number.isFinite(model.tokens) && model.tokens > 0 ? `${compact(model.tokens)} tokens` : "", Number.isFinite(model.wins) && Number.isFinite(model.losses) && model.wins + model.losses > 0 ? `${Math.round((model.wins / (model.wins + model.losses)) * 100)}% verified` : ""].filter(Boolean).join(" · ");
      line.append(el("b", "", model.name), bar, el("span", "", facts));
      box.append(line);
    }
    return box;
  }

  // ---- a task as a session --------------------------------------------------
  function loadAttempts(task) {
    if (!api()?.tasksAttempts || !task) return;
    const signature = JSON.stringify([task.runId, task.status, task.lastAttempt?.at, task.lastAttempt?.runId]);
    const prior = state.attempts.get(task.id);
    if (prior?.signature === signature) return;
    const record = { signature, loading: true, attempts: prior?.attempts || [], error: "" };
    state.attempts.set(task.id, record);
    Promise.resolve(api().tasksAttempts({ taskId: task.id, projectId: task.projectId || projectId() }))
      .then((result) => { if (!result?.ok) throw new Error(result?.error || "The run history could not be loaded."); record.attempts = Array.isArray(result.attempts) ? result.attempts : []; })
      .catch((error) => { record.error = plain(error, "The run history could not be loaded."); })
      .finally(() => { record.loading = false; state.painted.delete("task"); state.painted.delete("output"); schedule(); });
  }
  const OUTCOMES = { "finished-ok": "Reported done", failed: "Failed", stopped: "Stopped", released: "Released", unrecorded: "No end recorded" };
  function timeline(task, data) {
    const items = [];
    const created = stampOf(task.createdAt);
    items.push({ at: created, kind: "brief", who: task.origin === "agent" || task.source === "agent" ? "An agent" : "You", text: task.prompt || task.title || "" });
    for (const log of Array.isArray(task.logs) ? task.logs : []) {
      const at = stampOf(log?.at);
      const text = String(log?.text || "").trim();
      if (!text || /^(task created)$/i.test(text)) continue;
      items.push({ at, kind: log.kind === "note" ? "note" : log.kind === "result" ? "result" : "log", text });
    }
    const record = state.attempts.get(task.id);
    for (const attempt of record?.attempts || []) {
      const live = Boolean(task.runId) && task.runId === attempt.runId && attempt.outcome === "unrecorded";
      items.push({ at: stampOf(attempt.startedAt), kind: "run", attempt, live });
    }
    for (const message of data.assistant?.messages || []) {
      if (message?.kind === "notice" && message.taskId === task.id) items.push({ at: stampOf(message.at), kind: "notice", text: message.text });
    }
    for (const ask of state.asks.get(task.id) || []) items.push({ at: ask.at, kind: "ask", ask });
    if (task.verification?.at && task.verification?.reason) items.push({ at: stampOf(task.verification.at), kind: "verdict", text: task.verification.reason, state: task.verification.state });
    return items.filter((item) => item.at || item.kind === "brief").sort((a, b) => a.at - b.at);
  }
  function paintTask() {
    const box = byId("builder-task");
    if (!box) return;
    const data = snapshot();
    const task = (data.tasks || []).find((item) => item.id === state.taskId);
    if (!task) {
      if (state.painted.get("task") === "missing") return;
      state.painted.set("task", "missing");
      const empty = el("div", "builder-task-missing");
      empty.append(el("h2", "", "This task is no longer on the board"), el("p", "", "It may have been deleted, or it belongs to another project."), button("New task", "primary mini", () => newTask()));
      box.replaceChildren(empty);
      return;
    }
    loadAttempts(task);
    const now = reading(task, data);
    const run = (data.status?.running || []).find((job) => job.taskId === task.id);
    const record = state.attempts.get(task.id);
    const signature = JSON.stringify([task, now.tone, now.label, now.summary, now.question, run, record?.attempts, record?.loading, record?.error, state.asks.get(task.id), pins().has(task.id), state.busy, (data.assistant?.messages || []).filter((message) => message?.kind === "notice" && message.taskId === task.id).map((message) => [message.at, message.text]), Math.floor(Date.now() / 60000)]);
    if (state.painted.get("task") === signature) return;
    state.painted.set("task", signature);
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 40 || state.painted.get("taskId") !== task.id;
    state.painted.set("taskId", task.id);
    const out = [];
    out.push(taskHeader(task, now, run, data));
    if (now.question) out.push(questionCard(now.question, task));
    out.push(statusCard(task, now, run));
    const feed = el("ol", "builder-feed");
    feed.setAttribute("aria-label", "What happened on this task");
    for (const item of timeline(task, data)) feed.append(feedItem(item, task));
    if (run) feed.append(liveItem(task, run));
    if (record?.loading && !record.attempts.length) feed.append(el("li", "builder-feed-note", "Loading its runs…"));
    else if (record?.error) feed.append(el("li", "builder-feed-note", record.error));
    out.push(feed);
    box.replaceChildren(...out);
    if (stick) box.scrollTop = box.scrollHeight;
    paintTaskComposer(task, now, run);
  }
  function taskHeader(task, now, run, data) {
    const head = el("header", "builder-task-head");
    const words = el("div", "builder-task-words");
    const pill = el("span", "builder-pill", now.label); pill.dataset.tone = now.tone;
    const h = el("h1", "", task.title || window.MefiTasks?.shortTitle?.(task) || "Untitled task");
    const facts = [task.createdAt ? `Started ${ago(stampOf(task.createdAt))}` : "", run?.route || task.lastAttempt?.route || "", state.attempts.get(task.id)?.attempts?.length ? `${state.attempts.get(task.id).attempts.length} run${state.attempts.get(task.id).attempts.length === 1 ? "" : "s"}` : "", task.priority && task.priority !== "normal" ? `${task.priority} priority` : ""].filter(Boolean).join(" · ");
    words.append(pill, h, el("p", "builder-task-facts", facts));
    const actions = el("div", "builder-task-actions");
    for (const action of taskActions(task, now, run, data)) actions.append(action);
    head.append(words, actions);
    return head;
  }
  async function act(label, call, done) {
    if (state.busy) return;
    state.busy = label; state.painted.delete("task"); schedule();
    try {
      const result = await call();
      if (result?.ok === false) throw new Error(result.error || "That did not work. Try again.");
      if (done) toast(typeof done === "function" ? done(result) : done, "good");
      window.MefiWorkspace?.refresh?.(true);
    } catch (error) { toast(plain(error, "That did not work. Try again."), "bad"); }
    finally { state.busy = null; state.painted.delete("task"); schedule(); }
  }
  function taskActions(task, now, run, data) {
    const out = [];
    const projectId = data.projectId;
    const busy = Boolean(state.busy);
    const scheduled = data.backlog?.taskStates?.find((item) => item.id === task.id);
    const add = (label, className, run2, title = "") => { const node = button(label, className, run2, { title }); node.disabled = busy; out.push(node); return node; };
    if (run) {
      const stop = add("Stop", "ghost mini", null, "Stop this worker. Its progress is saved and the task waits for you.");
      window.MefiUi?.arm ? window.MefiUi.arm(stop, { armed: "Stop it?", run: () => act("stop", () => api().tasksAction({ taskId: task.id, projectId, action: "stop" }), "Stopped. Its progress is saved.") }) : stop.addEventListener("click", () => act("stop", () => api().tasksAction({ taskId: task.id, projectId, action: "stop" }), "Stopped."));
      add("Watch live", "ghost mini", () => window.MefiNav?.go?.("command", { taskId: task.id, projectId, selected: `task:${task.id}`, rail: "work" }), "Follow this worker on the live tree");
    } else if (now.stage === "approval") {
      add(window.MefiAutonomy?.state?.()?.level === "accept" ? "Accept this task" : "Approve build", "primary mini", () => act("approve", () => api().backlogControl({ action: "approve", taskId: task.id, projectId, expectedScope: scheduled?.buildScope ?? task.buildScope }), "Approved. It builds when a worker is free."));
    } else if (["blocked"].includes(now.stage) || task.verification?.state === "failed" || scheduled?.blockedBy === "owner") {
      add(scheduled?.blockedBy === "owner" ? "Resume" : "Try again", "primary mini", () => act("retry", () => api().tasksAction({ taskId: task.id, projectId, action: "retry" }), "Back in the queue."), "Put it back in the queue; it continues from its saved progress");
    } else if (now.stage === "ready" && !isDone(task)) {
      add(task.continuation ? "Resume" : "Start", "primary mini", () => act("start", () => window.MefiWorkspace?.startTask ? window.MefiWorkspace.startTask(task).then(() => ({ ok: true })) : api().assistantWorkOn({ kind: "task", id: task.id, projectId, start: true }), null), "Ask for a worker for this task now");
    } else if (isDone(task)) {
      if (data.preview?.phase === "ready") add("Open app", "primary mini", () => window.MefiWorkspace?.previewAction?.("open"));
      add("Request a change", "ghost mini", () => { state.intent = "change"; state.painted.delete("task"); paintTask(); byId("builder-task-input")?.focus?.(); });
    }
    const pinned = pins().has(task.id);
    const pin = button("", "builder-icon-btn", () => setPinned(task.id, !pinned), { icon: "g-pin", title: pinned ? "Unpin from the top of the menu" : "Pin to the top of the menu" });
    pin.setAttribute("aria-pressed", String(pinned)); pin.setAttribute("aria-label", pinned ? "Unpin this task" : "Pin this task");
    out.push(pin);
    const board = button("", "builder-icon-btn", () => window.MefiNav?.go?.("tasks", { taskId: task.id, projectId, filter: "all" }), { icon: "g-tasks", title: "Open on the task board: details, evidence, history" });
    board.setAttribute("aria-label", "Open on the task board");
    out.push(board);
    if (!isDone(task) && !run && !task.runId && !["active", "running", "awaiting_verification", "verifying"].includes(task.status)) {
      const drop = button("", "builder-icon-btn", null, { icon: "g-close", title: "Drop this task: close it without building it" });
      drop.setAttribute("aria-label", "Drop this task");
      window.MefiUi?.arm?.(drop, { armed: "Drop?", run: () => act("drop", () => api().tasksAction({ taskId: task.id, projectId, action: "drop" }), "Dropped. Reopen it from the board if you change your mind.") });
      out.push(drop);
    }
    return out;
  }
  function questionCard(question, task) {
    const card = el("section", "builder-question");
    card.setAttribute("aria-label", "A decision this task is waiting on");
    card.append(el("span", "builder-kicker", "Needs your answer"), el("h2", "", question.question || question.title || "A decision"));
    if (question.detail) card.append(el("p", "", question.detail));
    const options = el("div", "builder-options");
    const answer = (payload, label) => act("answer", () => api().assistantAnswer({ id: question.id, ...payload }), `Answered: ${label.length > 60 ? `${label.slice(0, 57)}…` : label}. ${companion()} carries on.`);
    for (const option of Array.isArray(question.options) ? question.options : []) {
      const choice = button(option.label || option.id, option.recommended ? "primary mini" : "ghost mini", () => answer({ optionId: option.id }, option.label || option.id), { title: option.description || "" });
      choice.disabled = Boolean(state.busy) || !api()?.assistantAnswer;
      options.append(choice);
    }
    card.append(options);
    const own = el("form", "builder-own-answer");
    const input = el("input"); input.type = "text"; input.placeholder = "Or answer in your own words…"; input.setAttribute("aria-label", "Your own answer"); input.dataset.typeHere = "";
    const send = button("Answer", "ghost mini", null); send.type = "submit";
    own.append(input, send);
    own.addEventListener("submit", (event) => { event.preventDefault(); const text = input.value.trim(); if (!text) { input.focus(); return; } void answer({ text }, text); });
    card.append(own);
    void task;
    return card;
  }
  function statusCard(task, now, run) {
    const card = el("section", "builder-status-card");
    card.dataset.tone = now.tone;
    const summary = now.summary || {};
    card.append(el("strong", "", summary.action || now.label));
    const facts = el("div", "builder-status-facts");
    for (const value of [summary.worker && summary.worker !== "No worker running" ? summary.worker : "", summary.activityAge, summary.checks]) if (value) facts.append(el("span", "", value));
    if (facts.childElementCount) card.append(facts);
    if (summary.blocker) card.append(el("p", "builder-blocker", summary.blocker));
    if (summary.nextAction && !run) card.append(el("p", "builder-next", summary.nextAction));
    if (run && Number.isFinite(run.progress)) {
      const bar = document.createElement("progress"); bar.max = 1; bar.value = Math.max(0, Math.min(1, run.progress)); bar.className = "builder-progress";
      bar.setAttribute("aria-label", `Reported progress: ${Math.round(bar.value * 100)} percent`);
      card.append(bar);
    }
    void task;
    return card;
  }
  function feedItem(item, task) {
    const node = el("li", `builder-feed-item is-${item.kind}`);
    const when = el("time", "", item.at ? `${ago(item.at)} · ${clock(item.at)}` : "");
    if (item.at) node.title = new Date(item.at).toLocaleString();
    if (item.kind === "brief") {
      node.append(el("b", "", `${item.who} asked`), when, el("p", "builder-brief", item.text));
      const acceptance = Array.isArray(task.acceptance) ? task.acceptance.filter(Boolean) : [];
      if (acceptance.length && !/\bdone when\b/i.test(item.text)) { const list = el("ul", "builder-check-list"); for (const line of acceptance) list.append(el("li", "", String(line))); node.append(el("small", "", "Done when"), list); }
    } else if (item.kind === "run") {
      const attempt = item.attempt;
      const took = span(attempt.seconds);
      node.dataset.outcome = item.live ? "running" : attempt.outcome;
      node.append(el("b", "", item.live ? "Working now" : OUTCOMES[attempt.outcome] || "Run"), when);
      const facts = [attempt.via, took ? `took ${took}` : "", attempt.fallbacks?.length ? `${attempt.fallbacks.length} fallback${attempt.fallbacks.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
      if (facts) node.append(el("p", "builder-feed-facts", facts));
      const why = attempt.error || (attempt.release ? `Released: ${attempt.release.reason || "the claim was dropped"}` : "");
      if (why) node.append(el("p", "builder-feed-why", why));
      if (attempt.result) node.append(el("p", "builder-feed-text", String(attempt.result).slice(0, 700)));
      if (!item.live && attempt.tail?.length) {
        const said = el("details", "builder-said");
        said.append(el("summary", "", "What it said"), el("pre", "", attempt.tail.slice(-24).join("\n")));
        node.append(said);
      }
    } else if (item.kind === "notice") {
      node.append(el("b", "", companion()), when, el("p", "builder-feed-text", item.text));
    } else if (item.kind === "note") {
      node.append(el("b", "", "Note"), when, el("p", "builder-feed-text", item.text));
    } else if (item.kind === "result") {
      node.append(el("b", "", "Result"), when, el("p", "builder-feed-text", item.text));
    } else if (item.kind === "verdict") {
      node.dataset.outcome = item.state === "verified" ? "finished-ok" : item.state === "failed" ? "failed" : "";
      node.append(el("b", "", item.state === "verified" ? "Verified" : item.state === "failed" ? "Not accepted" : "Checked"), when, el("p", "builder-feed-text", item.text));
    } else if (item.kind === "ask") {
      node.append(el("b", "", "You asked"), when, el("p", "builder-feed-text", item.ask.text));
      if (item.ask.reply) node.append(el("b", "builder-reply-who", companion()), el("p", "builder-feed-text builder-reply", item.ask.reply));
      else if (item.ask.pending) node.append(el("p", "builder-feed-note", `${companion()} is thinking…`));
      else if (item.ask.error) node.append(el("p", "builder-feed-why", item.ask.error));
    } else {
      node.append(el("b", "", "Update"), when, el("p", "builder-feed-text", item.text));
    }
    return node;
  }
  function liveItem(task, run) {
    const node = el("li", "builder-feed-item is-live");
    node.append(el("b", "", run.stopping ? "Stopping safely" : run.phase === "preparing" ? "Preparing" : run.phase === "finishing" ? "Finishing" : "Working now"));
    node.append(el("p", "builder-feed-text", run.currentStep || run.activity || "Waiting for the worker's first line"));
    const tail = Array.isArray(task.runProgress?.outputTail) ? task.runProgress.outputTail.slice(-6) : [];
    if (tail.length) node.append(el("pre", "builder-live-tail", tail.join("\n")));
    const more = button("Output", "ghost mini", () => window.MefiPanes?.open?.("output", { focus: true }), { title: "Follow its full output in the Output pane" });
    node.append(more);
    return node;
  }

  // ---- the session's composer ----------------------------------------------
  const INTENTS = {
    note: { label: "Note", hint: "A note its next run reads", placeholder: "Tell it something for its next run…", send: "Save note" },
    ask: { label: "Ask", hint: `Ask ${"Mefi"} about this task`, placeholder: "Ask about this task…", send: "Ask" },
    change: { label: "Change", hint: "A follow-up task for a change", placeholder: "Describe the change you want…", send: "Create follow-up" },
  };
  function buildTaskComposer(form) {
    const top = el("div", "ws-compose-top");
    const modes = el("div", "ws-modes builder-intents"); modes.setAttribute("role", "group"); modes.setAttribute("aria-label", "What to do with your words");
    for (const [id, intent] of Object.entries(INTENTS)) {
      const choice = button(intent.label, "", () => { state.intent = id; paintTaskComposer(); byId("builder-task-input")?.focus?.(); }, { title: intent.hint });
      choice.dataset.intent = id; choice.id = `builder-intent-${id}`;
      modes.append(choice);
    }
    const context = el("span", "builder-intent-hint"); context.id = "builder-intent-hint";
    top.append(modes, context);
    const input = el("textarea"); input.id = "builder-task-input"; input.rows = 2; input.setAttribute("aria-label", "Your words about this task");
    input.addEventListener("input", () => { state.drafts.set(`${state.taskId}:${state.intent}`, input.value); });
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit?.() ?? submitTask(); } });
    const bottom = el("div", "ws-compose-bottom");
    const hint = el("span", "", "Enter to send · Shift + Enter for a new line");
    const send = button("Save note", "primary", null); send.type = "submit"; send.id = "builder-task-send";
    bottom.append(hint, send);
    form.append(top, input, bottom);
    form.addEventListener("submit", (event) => { event.preventDefault(); void submitTask(); });
  }
  function defaultIntent(task, now, run) {
    if (isDone(task)) return "change";
    if (run) return "ask";
    return "note";
  }
  function paintTaskComposer(task = (snapshot().tasks || []).find((item) => item.id === state.taskId), now = task ? reading(task) : null, run = task ? (snapshot().status?.running || []).find((job) => job.taskId === task.id) : null) {
    const form = byId("builder-task-compose");
    if (!form || !task) return;
    if (!state.intent) state.intent = defaultIntent(task, now, run);
    const intent = INTENTS[state.intent] || INTENTS.note;
    for (const choice of form.querySelectorAll("[data-intent]")) choice.setAttribute("aria-pressed", String(choice.dataset.intent === state.intent));
    const input = byId("builder-task-input");
    const key = `${task.id}:${state.intent}`;
    if (input && input.dataset.key !== key) { input.dataset.key = key; input.value = state.drafts.get(key) || ""; }
    if (input) input.placeholder = state.intent === "ask" ? `Ask ${companion()} about this task…` : intent.placeholder;
    const hint = byId("builder-intent-hint");
    if (hint) hint.textContent = state.intent === "note" ? (run ? "Saved now, read by its next run" : "Its next run reads this") : state.intent === "ask" ? `${companion()} answers here and in the chat` : "Makes a new task linked to this one";
    const send = byId("builder-task-send");
    if (send) { send.firstChild ? (send.firstChild.textContent = state.busy === "compose" ? "Sending…" : intent.send) : (send.textContent = intent.send); send.disabled = Boolean(state.busy); }
  }
  async function submitTask() {
    const input = byId("builder-task-input");
    const data = snapshot();
    const task = (data.tasks || []).find((item) => item.id === state.taskId);
    const words = input?.value.trim();
    if (!task || !words || state.busy || !api()) return;
    const intent = state.intent || "note";
    const key = `${task.id}:${intent}`;
    state.busy = "compose"; paintTaskComposer(task);
    try {
      if (intent === "note") {
        const earlier = typeof task.notes === "string" && task.notes.trim() ? `${task.notes.trim()}\n` : "";
        const result = await api().tasksSave([{ ...task, notes: `${earlier}- ${words}`.slice(-4000), logs: [...(task.logs || []), { at: Date.now(), kind: "note", text: words }].slice(-40), updatedAt: Date.now() }]);
        if (result?.ok === false) throw new Error(result.error || "The note could not be saved.");
        toast("Saved. Its next run reads it.", "good");
      } else if (intent === "ask") {
        const ask = { at: Date.now(), text: words, pending: true };
        state.asks.set(task.id, [...(state.asks.get(task.id) || []), ask].slice(-12));
        schedule();
        const title = task.title || window.MefiTasks?.shortTitle?.(task) || "this task";
        const result = await api().assistantMessage(`About the task "${title}" (${task.id}): ${words}`, data.projectId, { view: "Build · task", companion: companion(), taskId: task.id });
        ask.pending = false;
        if (result?.ok === false) { ask.error = plain(result.error, "No reply came back. Try again."); throw new Error(ask.error); }
        const reply = (result?.state?.messages || []).filter((message) => message.role === "assistant" && stampOf(message.at) >= ask.at - 1000 && message.kind !== "notice").at(-1);
        ask.reply = reply?.text || "Sent. The reply is in the chat.";
      } else {
        const title = task.title || window.MefiTasks?.shortTitle?.(task) || "the last result";
        const prompt = `Follow-up to task "${title}" (${task.id}).\n\nRequested change:\n${words}`;
        const result = await api().tasksCreate({ title: `Change: ${words.split("\n")[0]}`.slice(0, 180), prompt, projectId: data.projectId });
        if (result?.ok === false) throw new Error(result.error || "The follow-up could not be created.");
        toast("Follow-up task created. It shows in the menu.", "good");
      }
      if (input.dataset.key === key) input.value = "";
      state.drafts.delete(key);
      window.MefiWorkspace?.refresh?.(true);
    } catch (error) { toast(plain(error, "That did not work. Your words are still here."), "bad"); }
    finally { state.busy = null; state.painted.delete("task"); schedule(); }
  }

  // ---- chips and the composer's tools --------------------------------------
  // The folder, its branch and uncommitted count (work:where, a read-only git
  // look), the Worktree switch (settings.executor.worktreeRuns), the
  // permission mode (MefiAutonomy's shared chip), and the coding worker with
  // its tier (getAiRouting / setAiRouting, the calls Agents › Setup makes).
  const chipsState = { where: null, whereAt: 0, whereFlight: null, routing: null, clis: null, routingAt: 0, routingFlight: null, saving: false };
  const CLI_NAMES = { opencode: "OpenCode", claude: "Claude Code", codex: "Codex", grok: "Grok", agy: "Antigravity", antigravity: "Antigravity" };
  const TIERS = [["auto", "Auto tier"], ["free", "Free tier"], ["fast", "Fast tier"], ["heavy", "Heavy tier"]];
  const shortModel = (model) => String(model || "").split("/").pop();
  function buildComposerTools(form) {
    const bottom = form.querySelector(".ws-compose-bottom");
    if (!bottom || bottom.querySelector(".builder-compose-tools")) return;
    const tools = el("span", "builder-compose-tools");
    const autonomy = el("span", "builder-autonomy"); autonomy.id = "builder-autonomy";
    const cli = el("select", "builder-select"); cli.id = "builder-worker-cli"; cli.setAttribute("aria-label", "Coding worker"); cli.title = "The coding worker that builds your tasks";
    const tier = el("select", "builder-select"); tier.id = "builder-worker-tier"; tier.setAttribute("aria-label", "Worker tier"); tier.title = "Which of the worker's models runs a task";
    for (const [select, words] of [[cli, "Coding worker"], [tier, "Tier"]]) { const option = el("option", "", words); option.value = ""; select.append(option); select.disabled = true; }
    cli.addEventListener("change", () => saveRouting({ executorCli: cli.value }, `${CLI_NAMES[cli.value] || cli.value} builds your tasks now.`));
    tier.addEventListener("change", () => saveRouting({ executorTier: tier.value }, `${(TIERS.find(([id]) => id === tier.value) || ["", tier.value])[1]} saved.`));
    tools.append(autonomy, buildMoreMenu(), cli, tier);
    bottom.insertBefore(tools, ws("send") ?? null);
    window.MefiAutonomy?.mount?.(autonomy, { id: "builder-autonomy-control" });
  }
  // The "+" after the permission chip holds what crowded the row and pushed the
  // worker, its tier and Send onto a second line at 1920x1080: "Use a task
  // outline" and "Plan an idea". Their own buttons move into the menu, so ids,
  // handlers and the purpose's show and hide stay Home's (workspace.js).
  function buildMoreMenu() {
    const holder = el("span", "builder-more"); holder.id = "builder-more";
    const toggle = button("", "ghost builder-more-btn", null, { icon: "g-add", title: "More: a task outline, or plan an idea" });
    toggle.id = "builder-compose-more"; toggle.setAttribute("aria-label", "More"); toggle.setAttribute("aria-haspopup", "menu"); toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", "builder-more-menu");
    const menu = el("div", "builder-more-menu"); menu.id = "builder-more-menu"; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", "More"); menu.hidden = true;
    for (const id of ["task-outline", "plan-idea"]) {
      const item = ws(id);
      if (!item) continue;
      item.setAttribute("role", "menuitem");
      menu.append(item);
    }
    const items = () => [...menu.querySelectorAll("button")].filter((item) => !item.hidden && !item.disabled);
    const set = (open, { focus = false } = {}) => {
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open && focus) items()[0]?.focus?.({ preventScroll: true });
    };
    toggle.addEventListener("click", () => set(menu.hidden, { focus: true }));
    // A pick closes the menu after the button's own handler has run.
    menu.addEventListener("click", (event) => { if (event.target?.closest?.("button")) set(false); });
    holder.addEventListener("keydown", (event) => {
      if (menu.hidden) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); set(false); toggle.focus?.({ preventScroll: true }); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const list = items();
      if (!list.length) return;
      event.preventDefault();
      const at = list.indexOf(event.target);
      list[(at + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus?.({ preventScroll: true });
    });
    document.addEventListener("click", (event) => { if (!menu.hidden && !holder.contains(event.target)) set(false); });
    holder.append(toggle, menu);
    return holder;
  }
  function paintChips() {
    const holder = byId("builder-chips");
    if (!holder) return;
    const data = snapshot();
    loadWhere(data);
    loadRouting();
    const where = chipsState.where;
    const signature = JSON.stringify([data.project?.name, data.project?.path, where, chipsState.saving]);
    if (state.painted.get("chips") !== signature) {
      state.painted.set("chips", signature);
      const chips = [];
      const place = el("span", "builder-chip quiet builder-place", "Local");
      place.prepend(glyph("g-studio"));
      place.title = "Tasks run on this PC, in the folder beside it";
      chips.push(place);
      const project = button(data.project?.name || "Open a folder", "builder-chip", () => window.MefiSidebar?.open?.({ focus: true, projectFocus: true }), { icon: "g-explorer", title: data.project?.path ? `${data.project.path} · switch project` : "Open a project folder" });
      project.append(glyph("g-chev"));
      chips.push(project);
      if (where?.repo) {
        const name = where.branch || (where.head ? `detached ${where.head}` : "no commits yet");
        const tip = `${where.branch ? `On branch ${where.branch}` : "No branch checked out"}${where.dirty ? ` · ${where.dirty} uncommitted path${where.dirty === 1 ? "" : "s"}` : " · nothing uncommitted"}. Opens the folder.`;
        const branch = button(name, "builder-chip quiet", () => api()?.shellReveal?.(data.project?.path), { icon: "g-route", title: tip });
        if (where.dirty) branch.append(el("small", "builder-chip-count", `+${where.dirty}`));
        chips.push(branch);
        const worktrees = where.worktrees || {};
        const tipOn = "On: each run works in its own git worktree from HEAD and merges back when it settles. Uncommitted work in your folder stays out of a run until it lands.";
        const tipOff = "Off: runs work in your folder. On gives each run its own git worktree from HEAD, merged back when it settles.";
        const box = button("Worktree", "builder-chip quiet builder-switch", () => setWorktrees(!worktrees.on), { title: worktrees.forced ? "Every run gets its own checkout: MEFI_STUDIO_WORKTREE_RUNS=1 is set for this Studio." : worktrees.on ? tipOn : tipOff });
        box.setAttribute("role", "switch"); box.setAttribute("aria-checked", String(Boolean(worktrees.on)));
        box.disabled = Boolean(worktrees.forced) || chipsState.saving || !api()?.workWorktrees;
        box.prepend(el("i", "builder-check"));
        chips.push(box);
      }
      holder.replaceChildren(...chips);
    }
    paintWorker();
  }
  function paintWorker() {
    const cli = byId("builder-worker-cli"), tier = byId("builder-worker-tier");
    const routing = chipsState.routing;
    if (!cli || !tier || !routing) return;
    const current = String(routing.executorCli || "opencode");
    const installed = Array.isArray(chipsState.clis) ? chipsState.clis.filter((row) => row?.installed).map((row) => String(row.id)) : [];
    const ids = [...new Set([current, ...installed, ...(installed.length ? [] : Object.keys(CLI_NAMES).filter((id) => id !== "agy"))])];
    const model = routing.executorModels?.[current] || routing.executorModel || "";
    const signature = JSON.stringify([ids, current, model, routing.executorTier, routing.executorTierModels?.[current], routing.executorTierDefaults?.[current], chipsState.saving]);
    if (state.painted.get("worker") === signature) return;
    state.painted.set("worker", signature);
    cli.replaceChildren(...ids.map((id) => { const option = el("option", "", id === current && model ? `${CLI_NAMES[id] || id} · ${shortModel(model)}` : CLI_NAMES[id] || id); option.value = id; return option; }));
    cli.value = current;
    const tierModel = (id) => routing.executorTierModels?.[current]?.[id] || routing.executorTierDefaults?.[current]?.[id]?.model || "";
    tier.replaceChildren(...TIERS.map(([id, label]) => { const option = el("option", "", id !== "auto" && tierModel(id) ? `${label} · ${shortModel(tierModel(id))}` : label); option.value = id; return option; }));
    tier.value = TIERS.some(([id]) => id === routing.executorTier) ? routing.executorTier : "auto";
    cli.hidden = tier.hidden = false;
    cli.disabled = tier.disabled = chipsState.saving || !api()?.setAiRouting;
    window.MefiSelect?.refresh?.();
  }
  function loadWhere(data) {
    if (!data.projectId || chipsState.whereFlight || Date.now() - chipsState.whereAt < 30000 || !api()?.workWhere) return;
    const asked = data.projectId;
    chipsState.whereFlight = Promise.resolve(api().workWhere())
      .then((result) => { if (result?.ok && asked === snapshot().projectId && (!result.projectId || result.projectId === asked)) chipsState.where = result; })
      .catch(() => {})
      .finally(() => { chipsState.whereAt = Date.now(); chipsState.whereFlight = null; state.painted.delete("chips"); schedule(); });
  }
  function loadRouting(force = false) {
    if (chipsState.routingFlight || (!force && Date.now() - chipsState.routingAt < 60000) || !api()?.getAiRouting) return;
    const clis = chipsState.clis ? Promise.resolve(chipsState.clis) : Promise.resolve(api().cliStatus?.()).catch(() => null);
    chipsState.routingFlight = Promise.all([Promise.resolve(api().getAiRouting()), clis])
      .then(([routing, list]) => {
        if (routing && typeof routing === "object" && routing.ok !== false) chipsState.routing = routing;
        if (Array.isArray(list)) chipsState.clis = list; else if (Array.isArray(list?.clis)) chipsState.clis = list.clis;
      })
      .catch(() => {})
      .finally(() => { chipsState.routingAt = Date.now(); chipsState.routingFlight = null; state.painted.delete("worker"); schedule(); });
  }
  async function saveRouting(patch, message) {
    if (chipsState.saving || !api()?.setAiRouting) return;
    chipsState.saving = true; state.painted.delete("worker");
    try {
      const result = await api().setAiRouting(patch);
      if (result?.ok === false) throw new Error(result.error || "The worker could not be saved.");
      toast(`${message} This project's team keeps it.`, "good");
    } catch (error) { toast(plain(error, "The worker could not be saved."), "bad"); }
    finally { chipsState.saving = false; chipsState.routingAt = 0; loadRouting(true); }
  }
  async function setWorktrees(on) {
    if (chipsState.saving || !api()?.workWorktrees) return;
    chipsState.saving = true; state.painted.delete("chips"); schedule();
    try {
      const result = await api().workWorktrees(on);
      if (result?.ok === false) throw new Error(result.error || "The worktree choice could not be saved.");
      if (chipsState.where) chipsState.where = { ...chipsState.where, worktrees: result.worktrees };
      toast(result.worktrees?.on ? "Each run now gets its own worktree." : "Runs work in your folder again.", "good");
    } catch (error) { toast(plain(error, "The worktree choice could not be saved."), "bad"); }
    finally { chipsState.saving = false; state.painted.delete("chips"); schedule(); }
  }

  // ---- wiring ---------------------------------------------------------------
  function wire() {
    if (state.wired) return;
    state.wired = true;
    window.addEventListener("mefi:workspace-state", schedule);
    window.addEventListener("mefi:worktrees", (event) => haveWorktrees(event.detail));
    window.addEventListener("mefi:project-changed", () => { state.attempts.clear(); state.asks.clear(); state.stats = null; state.statsKey = ""; state.painted.clear(); state.worktreeTasks = new Set(); state.worktreeKey = ""; state.worktreeAt = 0; chipsState.branchAt = 0; chipsState.workerAt = 0; chipsState.branch = null; if (state.adopted) restoreView(); schedule(); });
    window.addEventListener("mefi:nav", (event) => {
      const detail = event.detail || {};
      if (detail.id === "workspace" && detail.action === "open" && sessions()) {
        const params = detail.params || {};
        if (params.view === "task" && params.taskId) setView("task", { taskId: params.taskId });
        else if (params.view === "chat") setView("chat");
        else if (params.view === "home") setView("home");
      }
      schedule();
    });
    // nav.js may have drawn the rail before this module loaded, and redraws it
    // on every shell change: the switch and the work list join it each time.
    const decorate = () => { if (ownsRail()) decorateRail({ sections: byId("app-rail-sections"), foot: byId("app-rail-foot") }); schedule(); };
    window.addEventListener("mefi:shell", decorate);
    decorate();
    api()?.onTasks?.(() => schedule());
    api()?.onAssistant?.(() => schedule());
    api()?.onAssistantStatus?.(() => schedule());
    api()?.onProjects?.(() => schedule());
    document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });
    // Leaving a text box in the menu's filter never drops what was typed.
    layer.addEventListener("keydown", (event) => {
      if (!sessions() || event.defaultPrevented) return;
      if (event.key === "Escape" && state.view === "task" && !event.target?.closest?.("textarea, input, select, .pane-floating")) { event.preventDefault(); setView("home"); }
    });
    setInterval(() => { if (!document.hidden && window.MefiWorkspace?.isActive?.() && state.view === "task") { state.painted.delete("task"); schedule(); } }, 30000);
    schedule();
  }

  // Search's layout switch. The sessions layout moves Home's sections into
  // panes, so the other layout comes back with a reload.
  window.MefiNav?.register?.({
    id: "home-layout", label: "Switch Home layout: sessions or classic", short: "Home layout", kind: "action", layer: null, section: "settings", group: "system",
    glyph: "g-frame", badge: null, desc: "Build's Home as a task list with panes (sessions), or the earlier single page (classic)",
    searchTerms: ["home layout sessions classic claude codex panes windows sidebar"],
    showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
    run: () => setLayout(sessions() ? "classic" : "sessions"),
  });
  function setLayout(next) {
    write(LAYOUT_KEY, next === "classic" ? "classic" : "sessions");
    toast(next === "classic" ? "Home goes back to the single page." : "Home opens as a task list with panes.", "info");
    setTimeout(() => { try { window.MefiNav?.saveResume?.(); } catch { /* resume is optional */ } window.location.reload(); }, 350);
  }

  window.MefiBuilder = {
    layout, active: () => sessions() && state.adopted, decorateRail, paintRail: () => paintRail(), ownsRail,
    openTask, openChat, newTask, requestChange, setView, view: () => ({ view: state.view, taskId: state.taskId }),
    groups, reading, boardStats, heatmap: (days, now) => heatmap(days, now), setLayout, refresh: () => { state.painted.clear(); schedule(); },
  };
  // The classic layout wires nothing (see the header). A layout change reloads
  // the page, so this is decided once per launch.
  if (sessions()) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire(); }
})();
