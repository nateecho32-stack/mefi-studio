// Vibe's menus: Tasks, Plans, Ideas, Team and Settings as compact panels
// beside the front door, in place of Build's full sheets. renderer/vibe.js
// opens them (from the dock, the cards, the pill and the settings button) and
// hands over what the front door already holds, so a panel costs no extra
// round trip; only Team reads the models it names. Each panel lists a few
// things, acts on one through the host call its Build page uses, and keeps
// Full view for the deep version, which opens inside Vibe's rail. One side
// panel at a time (a menu, the conversation or a decision); inside a panel a
// row opens its detail, and Back or Esc steps out again. Moving between
// panels and details slides the way you went; a push that only changes data
// keeps the rows that stay (renderer/motion.js).
(function () {
  "use strict";
  const aside = document.getElementById("vibe-panel");
  if (!aside) return;
  const $ = (id) => document.getElementById(`vibe-panel-${id}`);
  const api = () => window.mefiStudio;
  const vibe = () => window.MefiVibe;
  const go = (id, params) => window.MefiNav?.go?.(id, params);
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };

  const TITLES = { tasks: "Tasks", plans: "Plans", ideas: "Ideas", team: "Team", settings: "Settings", decisions: "Decided for you", newapp: "New app" };
  const EMPTY = { projectId: null, projectName: "", tasks: [], needs: [], running: [], checking: [], next: [], backlog: null, status: {}, assistant: {}, ideas: [], plans: [], gate: null, companion: "Mefi", person: "" };
  const motion = () => window.MefiMotion;
  const state = { place: null, depth: 0, kind: null, stack: [], data: EMPTY, busy: false, folds: { needs: true, active: true, done: false }, team: null, teamAt: 0, teamFlight: null, signature: "", noteTone: "", draftApp: { name: "", about: "" } };
  state.taskView = read("mefiStudio.vibe.taskView") === "lanes" ? "lanes" : "list";
  state.inspectorDraft = null;
  // Half-written task notes, by project and task: the panel repaints on
  // every action and push, and a failed save used to lose the text.
  state.noteDrafts = {};

  // ---- open, close, back ---------------------------------------------------------
  function open(kind, { data = null, taskId = null, ideaId = null, familyId = null, fold = null } = {}) {
    if (!TITLES[kind]) return false;
    state.kind = kind;
    state.stack = [];
    state.busy = false;
    if (data) state.data = { ...EMPTY, ...data };
    if (fold) state.folds = { ...state.folds, [fold]: true };
    if (taskId) state.stack.push({ view: "task", id: taskId });
    if (ideaId) state.stack.push({ view: "idea", id: ideaId });
    if (familyId) state.stack.push({ view: "family", id: familyId });
    if (aside.hidden) state.place = null;
    aside.hidden = false;
    aside.dataset.kind = kind;
    note("");
    state.signature = "";
    render();
    if (kind === "team") { void loadTeam(); void window.MefiAutonomy?.refresh?.({ learning: true }); }
    vibe()?.paintDock?.();
    requestAnimationFrame(() => (aside.querySelector(".vibe-panel-body button, .vibe-panel-body input") || $("close"))?.focus?.({ preventScroll: true }));
    return true;
  }
  function close({ quiet = false } = {}) {
    if (aside.hidden) return;
    const was = state.kind;
    aside.hidden = true;
    state.kind = null;
    state.stack = [];
    state.place = null;
    delete aside.dataset.kind;
    vibe()?.paintDock?.();
    // Focus goes back to the stop that opened it, so the keyboard stays put.
    if (!quiet) (document.getElementById(`vibe-stop-${was}`) || document.getElementById("vibe-layer"))?.focus?.({ preventScroll: true });
  }
  function back() {
    if (!state.stack.length) return false;
    state.stack.pop();
    note("");
    state.signature = "";
    render();
    requestAnimationFrame(() => ($("body")?.querySelector?.(".vibe-row-main, button") || $("close"))?.focus?.({ preventScroll: true }));
    return true;
  }
  // Esc: out of a detail first, then out of the panel.
  function escape() { if (!back()) close(); return true; }
  function update(data) {
    if (!data || aside.hidden) return;
    if (data.projectId !== state.data.projectId) { document.activeElement?.blur?.(); state.stack = []; state.inspectorDraft = null; state.signature = ""; }
    state.data = { ...EMPTY, ...data };
    render();
  }
  function note(text, tone = "") { state.noteTone = tone; $("note").textContent = text; $("note").dataset.tone = tone; }
  const top = () => state.stack.at(-1) ?? null;

  // ---- shared bits ------------------------------------------------------------------
  function ago(at) {
    const ms = Date.now() - (Number(at) || Date.parse(at) || Date.now());
    if (ms < 60000) return "just now";
    if (ms < 3600000) return `${Math.round(ms / 60000)} min ago`;
    if (ms < 86400000) return `${Math.round(ms / 3600000)} h ago`;
    return `${Math.round(ms / 86400000)} d ago`;
  }
  // The same row the cards use, so a panel reads like the front door.
  function row({ key, tone, title, meta, action, onOpen }) {
    const item = el("li", `vibe-row${tone ? ` is-${tone}` : ""}`);
    item.dataset.key = key || title;
    const main = el("button", "vibe-row-main");
    main.type = "button";
    main.append(el("span", "vibe-row-dot"), el("span", "vibe-row-title", title));
    if (meta) main.append(el("span", "vibe-row-meta", meta));
    if (onOpen) main.addEventListener("click", onOpen);
    item.append(main);
    if (action) {
      const button = el("button", "vibe-row-action", action.label);
      button.type = "button";
      button.disabled = state.busy;
      button.addEventListener("click", action.run);
      item.append(button);
    }
    return item;
  }
  function fold(body, key, label, rows, { empty = "" } = {}) {
    const section = el("section", "vibe-fold");
    const head = el("button", "vibe-fold-head");
    head.type = "button";
    const opened = state.folds[key] !== false;
    head.setAttribute("aria-expanded", String(opened));
    head.dataset.key = `fold:${key}`;
    head.append(el("span", "vibe-fold-label", label), el("span", "vibe-fold-count", rows.length ? String(rows.length) : ""), el("span", "vibe-fold-caret"));
    head.addEventListener("click", () => { state.folds = { ...state.folds, [key]: !opened }; state.signature = ""; render(); });
    section.append(head);
    if (opened) {
      const list = el("ol", "vibe-rows");
      for (const item of rows) list.append(item);
      if (!rows.length && empty) list.append(el("li", "vibe-empty", empty));
      section.append(list);
    }
    body.append(section);
  }
  function actions(buttons) {
    const holder = el("div", "vibe-ask-actions");
    for (const { label, primary, run, disabled, title, confirm } of buttons) {
      const button = el("button", `vibe-btn ${primary ? "primary" : "quiet"}`, label);
      button.type = "button";
      button.disabled = state.busy || Boolean(disabled);
      if (title) button.title = title;
      // A button that throws work away asks twice.
      if (confirm && window.MefiUi?.arm) window.MefiUi.arm(button, { run: () => void run(), armed: confirm });
      else button.addEventListener("click", () => void run());
      holder.append(button);
    }
    return holder;
  }
  function chip(text, tone = "") { return el("span", `vibe-ask-chip${tone ? ` is-${tone}` : ""}`, text); }
  function heading(body, title, chips = []) {
    body.append(el("h3", "vibe-panel-h", title));
    const holder = el("div", "vibe-ask-chips");
    for (const item of chips.filter(Boolean)) holder.append(item);
    if (holder.children.length) body.append(holder);
  }
  function text(body, label, value, limit = 900) {
    const full = String(value ?? "").trim();
    if (!full) return;
    const box = el("div", "vibe-ask-brief");
    const words = el("p", "vibe-ask-detail", full.length > limit ? `${full.slice(0, limit)}…` : full);
    box.append(el("span", "vibe-ask-label", label), words);
    if (full.length > limit) {
      const more = el("button", "vibe-ask-link", "Show all");
      more.type = "button";
      more.addEventListener("click", () => { words.textContent = full; more.remove(); });
      box.append(more);
    }
    body.append(box);
  }
  // One path for every panel action: call the host, say what happened, then
  // let the front door re-read so the cards, the dock and this panel agree.
  async function act(call, success, { after = null } = {}) {
    if (state.busy) return false;
    if (!api()) { note("This works in the desktop app.", "warn"); return false; }
    state.busy = true; state.signature = ""; render();
    note("Working on it…");
    try {
      const result = await call();
      if (!result || result.ok === false) throw new Error(result?.error || "That didn't go through.");
      state.busy = false;
      note(window.MefiAutonomy?.outcome?.(result, success) || result.dispatch?.message || success, result.dispatch?.held || result.dispatch?.paused ? "warn" : "good");
      after?.(result);
      await vibe()?.refresh?.();
      state.signature = ""; render();
      return true;
    } catch (error) {
      state.busy = false;
      note(error?.message || "That didn't go through.", "bad");
      state.signature = ""; render();
      return false;
    }
  }

  // ---- tasks ------------------------------------------------------------------------
  const isDone = (task) => ["done", "archived", "completed"].includes(task?.status) || Boolean(task?.dropped);
  const stamp = (task) => Number(task.updatedAt || task.createdAt) || Date.parse(task.updatedAt || task.createdAt || "") || 0;
  // What a task is doing, in Vibe's words, from the backlog's stage for it.
  function stage(task) {
    const data = state.data;
    if ((data.running || []).some((job) => job.taskId === task.id)) return { tone: "live", text: "building", key: "running" };
    if (task.dropped) return { tone: "", text: "dropped", key: "done" };
    if (isDone(task)) return { tone: "done", text: task.verification?.state === "verified" ? "verified" : "done", key: "done" };
    if (["awaiting_verification", "verifying"].includes(task.status)) return { tone: "check", text: "checking its work", key: "review" };
    const row = (data.backlog?.taskStates || []).find((item) => item.id === task.id);
    switch (row?.stage) {
      case "running": return { tone: "live", text: "building", key: "running" };
      case "review": return { tone: "check", text: "checking its work", key: "review" };
      case "approval": return { tone: "ask", text: "waiting for your go-ahead", key: "approval" };
      case "blocked": return { tone: "bad", text: row.blockedBy === "owner" ? "stopped by you" : row.blockedBy === "relevance" ? "maybe done outside Studio" : "stuck", key: "blocked", reason: row.reason };
      case "waiting": return { tone: "next", text: "waiting for other tasks", key: "waiting", reason: row.reason };
      case "cooling": return { tone: "next", text: "trying again soon", key: "cooling", reason: row.reason };
      case "deferred": return { tone: "next", text: row.blockedBy === "relevance-check" ? "checking against outside work" : "deferred", key: "deferred", reason: row.reason };
      case "grouped": return { tone: "next", text: "part of a group", key: "grouped", reason: row.reason };
      case "ready": return { tone: "next", text: "up next", key: "ready" };
      default: return { tone: "next", text: "queued", key: "ready" };
    }
  }
  const STAGE_ORDER = { running: 0, review: 1, ready: 2, cooling: 3, waiting: 4, grouped: 5 };
  function tasksList(body) {
    governor(body);
    const views = el("div", "vibe-task-views");
    views.setAttribute("role", "group"); views.setAttribute("aria-label", "Task view");
    for (const [key, label] of [["list", "List"], ["lanes", "Lanes"]]) {
      const button = el("button", "vibe-btn quiet", label);
      button.type = "button"; button.setAttribute("aria-pressed", String(state.taskView === key));
      button.addEventListener("click", () => { state.taskView = key; try { localStorage.setItem("mefiStudio.vibe.taskView", key); } catch { /* optional preference */ } state.signature = ""; render(); });
      views.append(button);
    }
    body.append(views);
    if (state.taskView === "lanes") { taskLanes(body); return; }
    const data = state.data;
    const needs = data.needs || [];
    const needing = new Set(needs.filter((need) => need.kind !== "question").map((need) => need.id));
    const active = (data.tasks || []).filter((task) => !isDone(task) && !needing.has(task.id))
      .map((task) => ({ task, stage: stage(task) }))
      .sort((a, b) => (STAGE_ORDER[a.stage.key] ?? 9) - (STAGE_ORDER[b.stage.key] ?? 9) || stamp(b.task) - stamp(a.task));
    const finished = (data.tasks || []).filter(isDone).sort((a, b) => stamp(b) - stamp(a)).slice(0, 30);
    if (!needs.length && !active.length && !finished.length) {
      body.append(el("p", "vibe-panel-empty", "No tasks yet. Describe something in the box and press Build it; it shows up here."));
      return;
    }
    fold(body, "needs", "Needs you", needs.map((need) => row({ key: `need:${need.kind}:${need.id}`, tone: need.tone, title: need.title, meta: need.meta, action: { label: need.verb, run: () => vibe()?.openNeed?.({ kind: need.kind, id: need.id }) }, onOpen: () => vibe()?.openNeed?.({ kind: need.kind, id: need.id }) })), { empty: "Nothing is waiting on you." });
    fold(body, "active", "In progress", active.map(({ task, stage: now }) => row({ key: `task:${task.id}`, tone: now.tone, title: task.title || "A task", meta: now.text, onOpen: () => push({ view: "task", id: task.id }) })), { empty: "Nothing is queued or building." });
    fold(body, "done", "Done", finished.map((task) => { const now = stage(task); return row({ key: `task:${task.id}`, tone: now.tone, title: task.title || "A task", meta: `${now.text} · ${ago(stamp(task))}`, onOpen: () => push({ view: "task", id: task.id }) }); }), { empty: "Finished work lands here." });
  }
  function governor(body) {
    const data = state.data;
    const gate = data.gate;
    const box = el("section", "vibe-governor");
    box.setAttribute("aria-label", "Queue controls");
    const counts = (data.tasks || []).reduce((out, task) => { const key = stage(task).key; out[key] = (out[key] || 0) + 1; return out; }, {});
    box.append(el("strong", "vibe-governor-counts", `${counts.running || 0} building · ${counts.ready || 0} ready · ${(data.needs || []).length} need you`));
    const reason = gate?.title || data.backlog?.waiting || data.status?.capacity?.reason;
    if (reason) box.append(el("p", "vibe-panel-hint", reason));
    const held = gate && ["held", "paused"].includes(gate.key);
    const controls = el("div", "vibe-governor-controls");
    const control = el("button", "vibe-btn quiet", gate?.key === "key" ? "Connect an AI" : held ? gate.key === "held" ? "Start agents" : "Resume" : "Pause new work");
    control.type = "button"; control.disabled = state.busy || !api();
    control.addEventListener("click", () => {
      if (gate?.key === "key") { close({ quiet: true }); go("agents", { section: "setup", pane: "connections" }); return; }
      void act(() => held ? api().assistantControl("start-work") : api().backlogControl({ action: "pause", projectId: data.projectId }), held ? "Agents resumed." : "New work paused. Running jobs finish normally.");
    });
    const label = el("label", "vibe-worker-limit", "Worker limit");
    const limit = el("select"); limit.setAttribute("aria-label", "Worker limit");
    const selected = data.status?.adaptiveParallel ? "auto" : String(data.status?.parallel || 2);
    // Only limits the host honours: it caps build workers at 3
    // (EXECUTOR_PARALLEL_CAP in main.cjs), so 4, 6 and 8 were clamped silently.
    for (const value of ["auto", ...new Set(["1", "2", "3", ...(selected === "auto" ? [] : [selected])])]) {
      const option = el("option", "", value === "auto" ? "Automatic" : value); option.value = value; limit.append(option);
    }
    limit.value = selected; limit.disabled = state.busy || !api()?.assistantAutopilot;
    limit.addEventListener("change", () => { const value = limit.value; void act(() => api().assistantAutopilot(value === "auto" ? { adaptiveParallel: true } : { adaptiveParallel: false, parallel: Number(value) }), "Worker limit saved. Running jobs finish normally."); });
    label.append(limit); controls.append(control, label); box.append(controls); body.append(box);
  }
  function taskLanes(body) {
    const questions = (state.data.needs || []).filter((need) => need.kind === "question");
    if (questions.length) fold(body, "questions", "Questions", questions.map((need) => row({ key: `need:question:${need.id}`, tone: "ask", title: need.title, meta: need.meta, onOpen: () => vibe()?.openNeed?.({ kind: "question", id: need.id }) })));
    const lanes = [["needs", "Needs you"], ["ready", "Ready"], ["running", "Building"], ["review", "Checking"], ["later", "Later"], ["done", "Done"]];
    const groups = Object.fromEntries(lanes.map(([key]) => [key, []]));
    for (const task of state.data.tasks || []) {
      const now = stage(task);
      const key = ["approval", "blocked"].includes(now.key) ? "needs" : ["waiting", "cooling", "deferred", "grouped"].includes(now.key) ? "later" : now.key;
      groups[key].push({ task, now });
    }
    const board = el("div", "vibe-task-lanes");
    for (const [key, title] of lanes) {
      const lane = el("section", `vibe-task-lane is-${key}`);
      lane.append(el("h3", "vibe-lane-title", `${title} · ${groups[key].length}`));
      const list = el("ol", "vibe-rows");
      for (const { task, now } of groups[key]) list.append(row({ key: `task:${task.id}`, tone: now.tone, title: task.title || "A task", meta: [now.text, task.priority && task.priority !== "normal" ? task.priority : "", task.estimateMinutes ? `${task.estimateMinutes} min estimate` : ""].filter(Boolean).join(" · "), onOpen: () => push({ view: "task", id: task.id }) }));
      if (!groups[key].length) list.append(el("li", "vibe-empty", "Nothing here."));
      lane.append(list); board.append(lane);
    }
    body.append(board);
  }
  function push(view) { state.stack.push(view); note(""); state.signature = ""; render(); requestAnimationFrame(() => $("back")?.focus?.({ preventScroll: true })); }
  function taskDetail(body, id) {
    const data = state.data;
    const task = (data.tasks || []).find((item) => item.id === id);
    if (!task) { body.append(el("p", "vibe-panel-empty", "This task is no longer on the board.")); return; }
    const now = stage(task);
    const need = (data.needs || []).find((item) => item.kind !== "question" && (item.id === id || item.kind === "family" && item.rows?.some((row) => row.id === id)));
    heading(body, task.title || "A task", [chip(now.text, now.key === "blocked" ? "blocker" : now.key === "approval" ? "decision" : ""), el("span", "vibe-ask-when", ago(stamp(task)))]);
    if (now.reason) body.append(el("p", "vibe-ask-detail vibe-panel-reason", now.reason));
    text(body, "The brief", task.prompt && task.prompt !== task.title ? task.prompt : "");
    const error = String(task.lastRunError || "").trim();
    if (error && !isDone(task)) body.append(el("pre", "vibe-ask-evidence", error.split("\n").slice(-4).join("\n")));
    const projectId = data.projectId;
    const buttons = [];
    if (now.key === "running") {
      buttons.push({ label: "Watch it", primary: true, run: () => { close({ quiet: true }); go("command", { selected: `task:${id}` }); } });
      buttons.push({ label: "Stop", confirm: "Stop this worker?", title: "Stop this worker; its progress is kept and the task waits for you", run: () => act(() => api().tasksAction({ taskId: id, projectId, action: "stop" }), "Stopped. It waits for you under Needs you.") });
    } else if (need) {
      buttons.push({ label: need.verb, primary: true, run: () => vibe()?.openNeed?.({ kind: need.kind, id: need.id }) });
    } else if (now.key === "deferred") {
      buttons.push({ label: "Return to queue", primary: true, run: () => act(() => api().tasksSave([{ ...task, deferUntil: 0 }]), "Back in the queue. Normal checks and approvals still apply.") });
    } else if (now.key === "review") {
      body.append(el("p", "vibe-panel-hint", "It finished and is being checked. Nothing to do yet."));
    } else if (now.key === "done") {
      buttons.push({ label: "Ask for a change", primary: true, title: "Start a new request about this result in the box", run: () => askChange(task) });
    } else {
      buttons.push({ label: "Start now", primary: true, title: "Build this next, even ahead of the queue", disabled: !api()?.assistantWorkOn, run: () => act(() => api().assistantWorkOn({ kind: "task", id, start: true, projectId }), "Starting it now.") });
      buttons.push({ label: "Drop it", confirm: "Drop this task?", title: "Close it without building it", run: () => act(() => api().tasksAction({ taskId: id, projectId, action: "drop" }), "Dropped.", { after: () => back() }) });
    }
    if (buttons.length) body.append(actions(buttons));
    if (!isDone(task) && now.key !== "review") noteForm(body, task, now);
    inspector(body, task, now);
  }
  function inspector(body, task, now) {
    const key = `${state.data.projectId}:${task.id}`;
    const revision = JSON.stringify([task.contextVersion, task.updatedAt, task.priority, task.estimateMinutes, task.acceptance, task.deferUntil]);
    if (state.inspectorDraft?.key !== key || !state.inspectorDraft.dirty && state.inspectorDraft.revision !== revision) {
      const date = Number(task.deferUntil) > 0 ? new Date(Number(task.deferUntil)) : null;
      const localDate = date && Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
      const initial = { priority: ["low", "normal", "high", "urgent"].includes(task.priority) ? task.priority : "normal", estimate: String(task.estimateMinutes || ""), acceptance: Array.isArray(task.acceptance) ? task.acceptance.join("\n") : String(task.acceptance || ""), defer: localDate };
      state.inspectorDraft = { key, revision, dirty: false, base: { ...task, projectId: state.data.projectId }, initial, ...initial };
    }
    const draft = state.inspectorDraft;
    const locked = state.busy || ["running", "review", "done"].includes(now.key);
    const details = el("details", "vibe-inspector"); details.open = state.folds.inspector === true;
    details.addEventListener("toggle", () => { state.folds.inspector = details.open; });
    details.append(el("summary", "", "Inspector"));
    const form = el("form", "vibe-inspector-form");
    const field = (label, input, name) => {
      const holder = el("label", "vibe-set-field"); input.disabled = locked; input.setAttribute("aria-label", label); input.value = draft[name];
      input.addEventListener("input", () => { draft[name] = input.value; draft.dirty = true; }); input.addEventListener("change", () => { draft[name] = input.value; draft.dirty = true; });
      holder.append(el("span", "", label), input); form.append(holder); return input;
    };
    const priority = el("select");
    for (const value of ["low", "normal", "high", "urgent"]) { const option = el("option", "", value[0].toUpperCase() + value.slice(1)); option.value = value; priority.append(option); }
    field("Priority", priority, "priority");
    const estimate = field("Estimated minutes", el("input"), "estimate"); estimate.type = "number"; estimate.min = "0"; estimate.max = "10080"; estimate.step = "1"; estimate.placeholder = "No estimate";
    const acceptance = field("Done when", el("textarea"), "acceptance"); acceptance.rows = 4; acceptance.placeholder = "One observable check per line";
    const defer = field("Defer until", el("input"), "defer"); defer.type = "datetime-local";
    form.append(el("p", "vibe-panel-hint", "Priority orders similar work; a task you chose to run next still goes first. Deferral waits until this local date. Clearing it returns the task to normal checks and approvals."));
    const save = el("button", "vibe-btn quiet", "Save details"); save.type = "submit"; save.disabled = locked || !api()?.tasksSave; form.append(save);
    form.addEventListener("submit", (event) => {
      event.preventDefault(); if (locked) return;
      const estimateMinutes = draft.estimate.trim() ? Number(draft.estimate) : 0;
      const deferUntil = draft.defer ? new Date(draft.defer).getTime() : 0;
      const checks = draft.acceptance.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const changed = (field) => draft[field] !== draft.initial[field];
      if (changed("estimate") && (!Number.isInteger(estimateMinutes) || estimateMinutes < 0 || estimateMinutes > 10080) || changed("defer") && !Number.isFinite(deferUntil) || changed("acceptance") && (checks.length > 12 || checks.some((line) => line.length > 300))) { note("Check the date, estimate (0–10080 minutes), and up to 12 checks of 300 characters each.", "warn"); return; }
      const edited = { ...draft.base, ...(changed("priority") ? { priority: draft.priority } : {}), ...(changed("estimate") ? { estimateMinutes } : {}), ...(changed("acceptance") ? { acceptance: checks } : {}), ...(changed("defer") ? { deferUntil } : {}) };
      void act(() => api().tasksSave([edited]), "Task details saved.", { after: () => { if (state.inspectorDraft === draft) state.inspectorDraft = null; } });
    });
    details.append(form); body.append(details);
  }
  // A note the next attempt reads (the task's saved notes reach the worker's
  // brief). A running worker cannot be reached mid-run: its prompt is sent
  // once, so the note waits for its next attempt.
  function noteForm(body, task, now) {
    const running = now.key === "running";
    const form = el("form", "vibe-ask-own vibe-panel-note");
    const input = el("textarea");
    input.rows = 2;
    input.placeholder = running ? "Notes can be added once this run finishes." : "Tell it something for its next attempt…";
    input.disabled = running || state.busy;
    input.setAttribute("aria-label", "A note for this task");
    const draftKey = `${state.data.projectId}:${task.id}`;
    input.value = state.noteDrafts[draftKey] || "";
    input.addEventListener("input", () => { state.noteDrafts[draftKey] = input.value; });
    const send = el("button", "vibe-btn quiet", "Save note");
    send.type = "submit";
    send.disabled = running || state.busy;
    form.append(input, send);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const words = input.value.trim();
      if (!words) { input.focus(); return; }
      const earlier = typeof task.notes === "string" && task.notes.trim() ? `${task.notes.trim()}\n` : "";
      void act(() => api().tasksSave([{ ...task, notes: `${earlier}- ${words}`.slice(-4000) }]), "Saved. Its next attempt reads it.", { after: () => { delete state.noteDrafts[draftKey]; } });
    });
    body.append(form);
  }
  function askChange(task) {
    const input = document.getElementById("vibe-input");
    if (!input) return;
    input.value = `Change "${task.title || "the last result"}": `;
    close({ quiet: true });
    input.focus?.();
    try { input.setSelectionRange?.(input.value.length, input.value.length); } catch { /* not a text field */ }
    input.dispatchEvent?.(new Event("input", { bubbles: true }));
  }

  // ---- plans ------------------------------------------------------------------------
  function planMeta(plan) {
    const questions = Array.isArray(plan.questions) ? plan.questions : [];
    const settled = questions.filter((item) => item.status === "resolved").length;
    if (plan.status === "ready") return { tone: "ask", text: "approved · ready to become tasks" };
    if (plan.status === "converting") return { tone: "live", text: "creating its tasks" };
    if (plan.spec && !plan.spec.stale) return { tone: "ask", text: "a specification waits for your review" };
    if (questions.length) return { tone: settled < questions.length ? "ask" : "next", text: `${settled} of ${questions.length} decided` };
    return { tone: "next", text: "being planned" };
  }
  function plansList(body) {
    const plans = state.data.plans || [];
    const families = state.data.families || [];
    if (!plans.length && !families.length) body.append(el("p", "vibe-panel-empty", "No plans in progress. A big request you build is split into steps here, and a plan helps when an idea needs a few decisions first."));
    // Requests Build it split into steps (vibe.js families()).
    if (families.length) fold(body, "families", "Split into steps", families.map((family) => row({ key: `family:${family.id}`, tone: familyTone(family), title: family.title, meta: familyMeta(family), onOpen: () => push({ view: "family", id: family.id }) })));
    if (plans.length) fold(body, "plans", "Plans", plans.map((plan) => {
      const meta = planMeta(plan);
      return row({ key: `plan:${plan.id}`, tone: meta.tone, title: plan.title || "A plan", meta: meta.text, onOpen: () => { close({ quiet: true }); go("plans", { planId: plan.id }); } });
    }));
    body.append(actions([{ label: "Plan something new", run: () => { close({ quiet: true }); go("plans", { create: true }); } }]));
  }

  // ---- a request split into steps ------------------------------------------------------
  const STEP_WORDS = { done: "done", dropped: "dropped", running: "building", checking: "checking its work", approval: "waiting for your go-ahead", blocked: "stuck", waiting: "waiting its turn" };
  const STEP_TONES = { done: "done", dropped: "", running: "live", checking: "check", approval: "ask", blocked: "bad", waiting: "next" };
  const familyTone = (family) => family.steps.some((step) => step.state === "approval") ? "ask" : family.steps.some((step) => step.state === "running") || family.final === "running" ? "live" : "next";
  const familyMeta = (family) => `${family.finished} of ${family.steps.length} steps done${family.final === "running" ? " · final check running" : family.final === "next" ? " · final check next" : ""}`;
  function familyDetail(body, id) {
    const family = (state.data.families || []).find((item) => item.id === id);
    if (!family) { body.append(el("p", "vibe-panel-empty", "This request is finished or no longer on the board.")); return; }
    heading(body, family.title, [chip(`${family.finished} of ${family.steps.length} done`, family.steps.some((step) => step.state === "approval") ? "decision" : "")]);
    if (family.summary) body.append(el("p", "vibe-ask-detail vibe-panel-reason", family.summary));
    const list = el("ol", "vibe-rows");
    for (const [index, step] of family.steps.entries()) list.append(row({ key: `step:${step.id || index}`, tone: STEP_TONES[step.state], title: `${index + 1}. ${step.title}`, meta: STEP_WORDS[step.state], onOpen: () => push({ view: "task", id: step.id }) }));
    list.append(row({ key: "then", tone: family.final === "running" ? "live" : family.final === "checking" ? "check" : "next", title: "Then: put it together and check the whole thing", meta: family.final === "running" ? "running now" : family.final === "checking" ? "checking its work" : family.final === "next" ? "up next" : "after the last step", onOpen: () => push({ view: "task", id: family.id }) }));
    body.append(list);
    const need = (state.data.needs || []).find((item) => item.kind === "family" && item.id === id);
    const unstarted = family.steps.filter((step) => ["approval", "waiting", "blocked"].includes(step.state));
    const buttons = [];
    if (need) buttons.push({ label: "Start all steps", primary: true, run: () => vibe()?.openNeed?.({ kind: "family", id }) });
    if (unstarted.length) buttons.push({ label: "Make it one task", title: "Drop the steps that have not started; the request is built as one task", run: () => act(async () => {
      let result = { ok: true };
      for (const step of unstarted) { result = await api().tasksAction({ taskId: step.id, projectId: state.data.projectId, action: "drop" }); if (!result || result.ok === false) break; }
      return result;
    }, "Kept as one task. It builds as a whole.") });
    if (buttons.length) body.append(actions(buttons));
  }

  // ---- ideas ------------------------------------------------------------------------
  const ideaTitle = (idea) => idea.title || idea.detail || "An idea";
  function ideasOrdered() {
    return (state.data.ideas || []).filter((idea) => idea && idea.status !== "done")
      .sort((a, b) => Number(Boolean(a.read)) - Number(Boolean(b.read)) || (Number(b.at) || 0) - (Number(a.at) || 0)).slice(0, 40);
  }
  function ideasList(body) {
    const ideas = ideasOrdered();
    if (!ideas.length) { body.append(el("p", "vibe-panel-empty", "No ideas right now. The agents add ideas here as they notice them.")); return; }
    const fresh = ideas.filter((idea) => !idea.read && !idea.taskId);
    const seen = ideas.filter((idea) => idea.read || idea.taskId);
    const rowOf = (idea) => row({ key: `idea:${idea.id}`, tone: idea.taskId ? "done" : idea.read ? "next" : "idea", title: ideaTitle(idea), meta: idea.taskId ? "already a task" : [idea.source, idea.at ? ago(idea.at) : ""].filter(Boolean).join(" · ") || "idea", action: idea.taskId ? null : { label: "Build it", run: () => buildIdea(idea) }, onOpen: () => push({ view: "idea", id: idea.id }) });
    fold(body, "fresh", "New", fresh.map(rowOf), { empty: "You've seen every idea." });
    fold(body, "seen", "Seen", seen.map(rowOf));
  }
  function buildIdea(idea) {
    return act(() => api().backlogControl({ action: "promote", ideaId: idea.id, projectId: state.data.projectId }), `"${ideaTitle(idea)}" is now a task.`);
  }
  function ideaAction(idea, action, success) {
    return act(() => api().ideasAction({ action, ideaId: idea.id, projectId: state.data.projectId }), success, { after: () => { if (action === "done") back(); } });
  }
  function ideaDetail(body, id) {
    const idea = (state.data.ideas || []).find((item) => item.id === id);
    if (!idea) { body.append(el("p", "vibe-panel-empty", "This idea is no longer here.")); return; }
    heading(body, ideaTitle(idea), [idea.source ? chip(idea.source) : null, ...(Array.isArray(idea.tags) ? idea.tags.slice(0, 3).map((tag) => chip(tag)) : []), idea.at ? el("span", "vibe-ask-when", ago(idea.at)) : null]);
    text(body, "The idea", idea.detail && idea.detail !== idea.title ? idea.detail : "");
    const buttons = idea.taskId
      ? [{ label: "Open its task", primary: true, disabled: typeof idea.taskId !== "string", run: () => open("tasks", { taskId: idea.taskId }) }]
      : [{ label: "Build it", primary: true, run: () => buildIdea(idea) }, { label: idea.read ? "Keep for later" : "Not now", run: () => ideaAction(idea, idea.read ? "keep" : "read", idea.read ? "Kept for later." : "Marked as seen.") }, { label: "Dismiss", run: () => ideaAction(idea, "done", "Dismissed.") }];
    body.append(actions(buttons));
  }

  // ---- team -------------------------------------------------------------------------
  const PROVIDERS = { zen: "OpenCode Zen", opencode: "OpenCode", claude: "Claude Code", codex: "Codex", grok: "Grok", antigravity: "Antigravity", anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter", zai: "Z.ai", lmstudio: "LM Studio", ollama: "Ollama", gemini: "Gemini", deepseek: "DeepSeek", auto: "Automatic" };
  const providerName = (id) => PROVIDERS[id] || (id ? String(id).replace(/(^|[-_])(\w)/g, (_, gap, letter) => `${gap ? " " : ""}${letter.toUpperCase()}`) : "Not set");
  const SEATS = [["companion", "Talks with you"], ["lead", "Plans the work"], ["desk", "Helps stuck agents"], ["heavy", "Reviews and plans"], ["routine", "Everyday jobs"]];
  async function loadTeam({ force = false } = {}) {
    if (!api()?.agentsState) return;
    // The roster is per project: a cached one from the project just left is
    // neither fresh nor shown.
    if (!force && state.team && state.teamProject === state.data.projectId && Date.now() - state.teamAt < 60000) return;
    if (state.teamFlight) return state.teamFlight;
    state.teamFlight = (async () => {
      try {
        const projectId = state.data.projectId;
        const result = await api().agentsState({ projectId });
        if (result && result.ok !== false && projectId === state.data.projectId) { state.team = result; state.teamProject = projectId; state.teamAt = Date.now(); }
      } catch { /* the rows say the models are unknown */ }
      finally { state.teamFlight = null; state.signature = ""; if (state.kind === "team") render(); }
    })();
    return state.teamFlight;
  }
  function team(body) {
    const data = state.data;
    const gate = data.gate;
    const running = data.running || [];
    const status = el("div", `vibe-panel-status${gate ? " is-held" : running.length ? " is-live" : ""}`);
    status.append(el("i", "vibe-gate-dot"), el("span", "", gate ? gate.title : running.length ? `${running.length} agent${running.length === 1 ? " is" : "s are"} building.` : "The agents are ready. Nothing is building right now."));
    body.append(status);
    body.append(el("p", "vibe-panel-hint", window.MefiAutonomy?.best?.() || "Model strengths appear as your team finishes work."));
    const controls = [];
    if (gate?.key === "key") controls.push({ label: "Connect an AI", primary: true, run: () => { close({ quiet: true }); go("agents", { section: "setup", pane: "connections" }); } });
    else if (gate && ["held", "paused"].includes(gate.key)) controls.push({ label: gate.key === "held" ? "Start agents" : "Resume", primary: true, run: () => act(() => api().assistantControl("start-work"), "Agents started. They pick up what's queued.") });
    else controls.push({ label: "Pause new work", title: "Running jobs finish; nothing new starts until you resume", disabled: !api()?.backlogControl, run: () => act(() => api().backlogControl({ action: "pause", projectId: data.projectId }), "New work paused. Running jobs finish normally.") });
    body.append(actions(controls));
    fold(body, "working", "Working now", running.map((job, index) => row({ key: `job:${job.taskId || index}`, tone: "live", title: job.title || "A task", meta: [job.phase ? String(job.phase).replace(/_/g, " ") : "working", job.model || job.route || "", job.startedAt ? `started ${ago(job.startedAt)}` : ""].filter(Boolean).join(" · "), onOpen: () => { close({ quiet: true }); go("command", job.taskId ? { selected: `task:${job.taskId}` } : {}); } })), { empty: "Nobody is building right now." });
    const roster = [];
    const info = state.teamProject === state.data.projectId ? state.team : null;
    if (info) {
      const config = info.configuration || {};
      const cli = config.executorCli || "opencode";
      roster.push(seat("Builds your code", providerName(cli), config.executorModels?.[cli] || "its default model"));
      for (const [key, label] of SEATS) {
        const choice = info.choices?.[key];
        if (choice) roster.push(seat(label, providerName(choice.provider), choice.model || "its default model", choice.ok === false ? choice.reason : ""));
      }
    }
    fold(body, "roster", "Your agents", roster, { empty: api()?.agentsState ? "Reading your agents…" : "Your agents show here in the desktop app." });
  }
  function seat(role, provider, model, problem = "") {
    const item = el("li", "vibe-seat");
    item.dataset.key = role;
    item.append(el("span", "vibe-seat-role", role), el("span", "vibe-seat-model", `${provider} · ${model}`));
    if (problem) item.append(el("span", "vibe-seat-problem", problem));
    return item;
  }

  // ---- settings ---------------------------------------------------------------------
  function settings(body) {
    const permissions = el("div"); body.append(permissions); window.MefiAutonomy?.mount(permissions, { full: true });
    const data = state.data;
    const mode = el("div", "vibe-set");
    mode.append(el("span", "vibe-set-label", "Studio mode"));
    const modes = el("div", "mode-switch vibe-set-mode");
    modes.setAttribute("role", "radiogroup"); modes.setAttribute("aria-label", "Studio mode"); modes.dataset.mode = "vibe";
    modes.append(el("i", "mode-thumb"));
    for (const [key, label] of [["vibe", "Vibe"], ["build", "Build"]]) {
      const button = el("button", "", label);
      button.type = "button"; button.setAttribute("role", "radio"); button.dataset.uiMode = key; button.setAttribute("aria-checked", String(key === "vibe"));
      modes.append(button);
    }
    mode.append(modes, el("span", "vibe-set-hint", "Build is the full studio: every board, model and setting."));
    body.append(mode);

    const themes = window.MefiMusic?.themes?.() ?? [];
    if (themes.length) {
      const current = window.MefiMusic?.theme?.() ?? document.documentElement.dataset.studioTheme;
      const look = el("div", "vibe-set");
      look.append(el("span", "vibe-set-label", "Colours"));
      const swatches = el("div", "vibe-swatches");
      swatches.setAttribute("role", "group"); swatches.setAttribute("aria-label", "Colour theme");
      for (const theme of themes) {
        const swatch = el("button", "vibe-swatch");
        swatch.type = "button"; swatch.title = theme.name; swatch.setAttribute("aria-label", theme.name);
        swatch.setAttribute("aria-pressed", String(theme.key === current));
        swatch.style.setProperty("--swatch", theme.accent); swatch.style.setProperty("--swatch-hi", theme.bright); swatch.style.setProperty("--swatch-bg", theme.bg);
        swatch.addEventListener("click", () => { window.MefiMusic?.applyTheme?.(theme.key); state.signature = ""; render(); });
        swatches.append(swatch);
      }
      look.append(swatches);
      body.append(look);
    }

    const names = el("div", "vibe-set vibe-set-names");
    names.append(el("span", "vibe-set-label", "Names"));
    names.append(nameField("Your name", "workspace-person-name", data.person, "What should I call you?", 40));
    names.append(nameField("Companion", "workspace-agent-name", data.companion, "Mefi", 30));
    body.append(names);

    const launch = el("label", "vibe-set vibe-set-toggle");
    const box = el("input");
    box.type = "checkbox"; box.setAttribute("role", "switch");
    box.checked = read("mefiStudio.commandHome") !== "0";
    box.addEventListener("change", () => setLaunch(box.checked));
    launch.append(el("span", "vibe-set-label", "Open Vibe on launch"), box, el("span", "vibe-set-hint", "Off opens Watch, the live node tree, instead."));
    body.append(launch);

    const links = el("div", "vibe-set-links");
    for (const [label, id, params] of [["Appearance and effects", "studio", { category: "appearance" }], ["AI connections", "agents", { section: "setup", pane: "connections" }]]) {
      const link = el("button", "vibe-ask-link", `${label} ↗`);
      link.type = "button";
      link.addEventListener("click", () => { close({ quiet: true }); go(id, params); });
      links.append(link);
    }
    body.append(links);
  }
  // Names are Home's own fields: writing through them keeps one store, and
  // Home, the companion and Vibe's greeting all follow.
  function nameField(label, id, value, placeholder, max) {
    const field = el("label", "vibe-set-field");
    const input = el("input");
    input.type = "text"; input.maxLength = max; input.placeholder = placeholder; input.value = value || "";
    input.autocomplete = "off";
    input.addEventListener("change", () => {
      const home = document.getElementById(id);
      if (home) { home.value = input.value; home.dispatchEvent?.(new Event("input", { bubbles: true })); }
      else { try { localStorage.setItem(id === "workspace-agent-name" ? "mefiStudio.workspace.companion" : "mefiStudio.workspace.person", input.value.trim()); } catch { /* private store */ } }
      void vibe()?.refresh?.();
      note("Saved.", "good");
    });
    field.append(el("span", "", label), input);
    return field;
  }
  // The launch switch lives in Command's settings (#idle-home); flipping it
  // there saves the preference and the local copy together.
  function setLaunch(on) {
    const home = document.getElementById("idle-home");
    if (home && home.type === "checkbox") { home.checked = on; home.dispatchEvent?.(new Event("change", { bubbles: true })); }
    else {
      void api()?.prefsSet?.({ commandHome: on });
      try { localStorage.setItem("mefiStudio.commandHome", on ? "1" : "0"); } catch { /* private store */ }
    }
    note(on ? "Studio opens on Vibe." : "Studio opens on Watch.", "good");
  }

  // ---- a new app ----------------------------------------------------------------------
  // Vibe is for making an app from a prompt: an empty folder, git, opened as
  // the project (main.cjs projects:create), and the description goes through
  // Build it as the first request, sized like any other.
  const slugOf = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
  function newAppForm(body) {
    body.append(el("p", "vibe-panel-hint", "Studio makes an empty folder under Mefi Apps in your home folder, starts git in it and opens it as your project. What you describe becomes its first build."));
    const form = el("form", "vibe-set vibe-newapp");
    const name = el("input");
    name.type = "text"; name.maxLength = 60; name.placeholder = "Pixel Garden"; name.autocomplete = "off"; name.value = state.draftApp.name;
    name.setAttribute("aria-label", "The app's name");
    name.disabled = state.busy || Boolean(state.draftApp.made);
    const about = el("textarea");
    about.rows = 4; about.maxLength = 600; about.value = state.draftApp.about;
    about.disabled = state.busy;
    about.placeholder = "A cosy 2D game where you grow pixel plants and trade them at a market.";
    about.setAttribute("aria-label", "What the app should be");
    const where = el("span", "vibe-set-hint", "");
    const paintWhere = () => { const slug = slugOf(name.value); where.textContent = slug ? `Folder: Mefi Apps/${slug}` : "The folder is named after the app."; };
    paintWhere();
    name.addEventListener("input", () => { state.draftApp = { ...state.draftApp, name: name.value }; paintWhere(); });
    about.addEventListener("input", () => { state.draftApp = { ...state.draftApp, about: about.value }; });
    const nameField = el("label", "vibe-set-field");
    nameField.append(el("span", "", "Name"), name);
    const aboutField = el("label", "vibe-set-field");
    aboutField.append(el("span", "", "What should it be?"), about);
    const make = el("button", "vibe-btn primary", state.busy ? "Making it…" : state.draftApp.made?.ok === false ? "Open app and start building" : state.draftApp.made ? "Retry first build" : "Make it and start building");
    make.type = "submit"; make.disabled = state.busy;
    form.append(nameField, aboutField, where, make);
    form.addEventListener("submit", (event) => { event.preventDefault(); void createApp(); });
    body.append(form);
  }
  async function createApp() {
    const name = state.draftApp.name.trim();
    const about = state.draftApp.about.trim();
    if (!name) { note("Give the new app a name.", "warn"); return; }
    if (!api()?.projectsCreate) { note("New apps can be made in the desktop app.", "warn"); return; }
    if (state.busy) return;
    state.busy = true; state.signature = ""; render();
    note("Making the folder…");
    try {
      let made = state.draftApp.made;
      if (made?.ok === false && made.addedId) {
        const opened = await api().projectsSelect({ id: made.addedId });
        if (opened?.ok === false) throw new Error(opened.error || "The project could not be opened.");
        if (!opened) throw new Error("The project could not be opened.");
        made = { ...made, ...opened, ok: true, selectedId: made.addedId };
      }
      if (!made) made = await api().projectsCreate({ name, about });
      if (made?.created && made.addedId) state.draftApp.made = made;
      if (!made || made.ok === false) throw new Error(made?.error || "The app could not be made.");
      state.draftApp.made = made;
      let said = `${name} is ready and open.`;
      if (about && api()?.vibeBuild) {
        note("Folder ready. Sizing up the first build…");
        const built = await api().vibeBuild({ title: `Set up ${name}`.slice(0, 90), projectId: made.selectedId || made.activeId,
          prompt: `Start this new app in its empty project folder: ${about}\n\nSet up the project so it runs, then build a first working version of what is described.` });
        if (!built || built.ok === false) throw new Error(`The folder is ready, but the first build could not be added: ${built?.error || "no answer"}`);
        said = built.steps ? `${name} is ready, and its first build is split into ${built.steps} steps.` : `${name} is ready, and its first build is queued.`;
      }
      state.draftApp = { name: "", about: "" };
      state.busy = false;
      close({ quiet: true });
      vibe()?.feedback?.(said, "good");
      await vibe()?.refresh?.();
    } catch (error) {
      state.busy = false;
      note(error?.message || "The app could not be made.", "bad");
      state.signature = ""; render();
    }
  }

  // ---- paint ------------------------------------------------------------------------
  // Only what the open panel shows decides whether it repaints, so a push
  // storm on a big board stays cheap.
  function digest() {
    const data = state.data;
    const need = (data.needs || []).map((item) => `${item.kind}:${item.id}:${item.title}:${item.verb}`);
    const running = (data.running || []).map((job) => `${job.taskId}:${job.phase}:${job.title}`);
    if (state.kind === "tasks" || top()?.view === "task") {
      const stages = (data.backlog?.taskStates || []).map((row) => `${row.id}:${row.stage}:${row.blockedBy || ""}:${row.reason || ""}`);
      return [data.projectId, data.projectName, need, running, stages, state.taskView, data.gate, data.status?.parallel, data.status?.adaptiveParallel, data.status?.capacity, data.backlog?.waiting, (data.tasks || []).map((task) => [task.id, task.title, task.status, task.updatedAt, task.contextVersion, task.priority, task.estimateMinutes, task.acceptance, task.deferUntil, Boolean(task.dropped), task.verification?.state, String(task.lastRunError || "").length, String(task.notes || "").length, String(task.prompt || "").length])];
    }
    if (state.kind === "ideas") return [data.projectName, (data.ideas || []).map((idea) => [idea.id, idea.title, idea.read, idea.status, idea.taskId])];
    if (state.kind === "plans") return [data.projectName, need, running, (data.plans || []).map((plan) => [plan.id, plan.title, plan.status, plan.version]), (data.families || []).map((family) => [family.id, family.title, family.final, family.steps.map((step) => `${step.id}:${step.state}`)]), (data.tasks || []).length];
    if (state.kind === "team") return [data.projectName, running, data.gate, state.teamAt];
    if (state.kind === "settings") return [data.projectName, data.person, data.companion, document.documentElement.dataset.studioTheme];
    if (state.kind === "newapp") return [data.projectName];
    if (state.kind === "decisions") return [data.projectId, data.assistant.decisions, data.assistant.todos];
    return [];
  }
  window.addEventListener("mefi:autonomy-changed", () => { state.signature = ""; if (["settings", "decisions", "team"].includes(state.kind)) render(); });
  function render() {
    if (aside.hidden || !state.kind) return;
    const view = top();
    aside.classList.toggle("is-lanes", state.kind === "tasks" && !view && state.taskView === "lanes");
    // Typing in a panel is never interrupted by a push; the next one paints.
    const typing = aside.contains(document.activeElement) && /^(TEXTAREA|INPUT)$/.test(document.activeElement?.tagName || "") && document.activeElement?.type !== "checkbox";
    const signature = JSON.stringify([state.kind, state.stack, state.folds, state.busy, digest()]);
    if (signature === state.signature || typing) return;
    state.signature = signature;
    $("kicker").textContent = state.data.projectName || "Vibe";
    $("title").textContent = view?.view === "task" ? "Task" : view?.view === "idea" ? "Idea" : view?.view === "family" ? "Plan" : TITLES[state.kind];
    $("back").hidden = !view;
    const body = $("body");
    const paint = () => {
      body.replaceChildren();
      if (view?.view === "task") taskDetail(body, view.id);
      else if (view?.view === "idea") ideaDetail(body, view.id);
      else if (view?.view === "family") familyDetail(body, view.id);
      else if (state.kind === "tasks") tasksList(body);
      else if (state.kind === "plans") plansList(body);
      else if (state.kind === "ideas") ideasList(body);
      else if (state.kind === "team") team(body);
      else if (state.kind === "settings") settings(body);
      else if (state.kind === "newapp") newAppForm(body);
      else if (state.kind === "decisions") window.MefiAutonomy?.history(body, { ...state.data.assistant, ...window.MefiAutonomy?.state?.(), projectId: state.data.projectId });
    };
    // Where the panel is: a new place slides (deeper from the right, back
    // from the left, another panel across); the same place only moves rows.
    const place = JSON.stringify([state.kind, state.stack]);
    const moved = state.place !== null && state.place !== place;
    const dir = state.stack.length > state.depth ? 1 : state.stack.length < state.depth ? -1 : 0;
    state.place = place;
    state.depth = state.stack.length;
    if (!motion()) paint();
    else if (moved) { motion().swap(body, paint, { dir }); motion().enter($("title"), { dir }); }
    else motion().keep(body, paint);
    $("full").hidden = ["newapp", "decisions"].includes(state.kind);
    $("full").onclick = () => full();
  }
  // Full view: the Build page for the same thing, inside Vibe's rail.
  function full() {
    const view = top();
    const kind = state.kind;
    close({ quiet: true });
    if (kind === "tasks" || ["task", "family"].includes(view?.view)) go("tasks", ["task", "family"].includes(view?.view) ? { taskId: view.id, filter: "all" } : {});
    else if (kind === "plans") go("plans");
    else if (kind === "ideas") go("ideas");
    else if (kind === "team") go("agents");
    else if (kind === "settings") go("studio");
  }

  $("back").addEventListener("click", () => back());
  $("close").addEventListener("click", () => close());
  window.MefiVibePanels = { open, close, back, escape, update, isOpen: () => !aside.hidden, current: () => (aside.hidden ? null : state.kind), view: () => top() };
})();
