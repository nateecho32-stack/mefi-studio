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
// keeps the rows that stay (renderer/motion.js). New app also asks what
// happens on GitHub (a private repository, one you already have, or nothing
// yet) and does it as its own step once the folder exists, so a refusal from
// GitHub never costs the folder. Guarded by tests/vibe_panels.test.mjs.
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
  // What New app knows about GitHub: read when the panel opens (githubAccount
  // is a light, local look) and again while a sign-in or install window is open.
  state.gh = { checked: false, account: null, ghInstalled: true, gitInstalled: true, polling: false, waiting: false };
  state.paintGh = null;
  // A New app being made. Closing the panel and opening it again clears
  // "busy" while it waits, and a second Start must not run it twice: two
  // publishes, two first builds.
  state.making = false;

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
    if (kind === "newapp") void checkAccount();
    vibe()?.paintDock?.();
    requestAnimationFrame(() => (typeHere() || aside.querySelector(".vibe-panel-body button, .vibe-panel-body input") || $("close"))?.focus?.({ preventScroll: true }));
    return true;
  }
  // The panel's own box (a task's note, a new app's name): it takes the caret
  // when the panel opens, and what you type anywhere in the panel.
  function typeHere() { return Array.from(aside.querySelectorAll(".vibe-panel-body [data-type-here]")).find((box) => !box.disabled) ?? null; }
  window.MefiNav?.typeScope?.(aside, typeHere);
  function close({ quiet = false } = {}) {
    if (aside.hidden) return;
    const was = state.kind;
    aside.hidden = true;
    state.kind = null;
    state.stack = [];
    state.place = null;
    state.paintGh = null;
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
  // The same row the cards use, so a panel reads like the front door;
  // `detail` is its live line: what a worker is doing right now.
  function row({ key, tone, title, meta, detail, action, onOpen }) {
    const item = el("li", `vibe-row${tone ? ` is-${tone}` : ""}`);
    item.dataset.key = key || title;
    const main = el("button", "vibe-row-main");
    main.type = "button";
    main.append(el("span", "vibe-row-dot"), el("span", "vibe-row-title", title));
    if (meta) main.append(el("span", "vibe-row-meta", meta));
    if (detail) { const now = el("span", "vibe-row-now", detail); now.title = detail; main.append(now); }
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
    input.setAttribute("aria-label", "A note for this task"); input.dataset.typeHere = "";
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
  // A step's line on the timeline: who is on it and what they are doing now,
  // what it still waits for, or when it finished.
  function stepMeta(step, family) {
    if (step.state === "running") return [STEP_WORDS.running, step.job?.tool, step.job?.startedAt ? `started ${ago(step.job.startedAt)}` : ""].filter(Boolean).join(" · ");
    if (step.state === "done" && step.at) return `done · ${ago(step.at)}`;
    const open = (step.after || []).filter((index) => family.steps[index] && !["done", "dropped"].includes(family.steps[index].state));
    if (step.state === "waiting" && open.length) return `waits for step ${open.map((index) => index + 1).join(" and ")}`;
    return STEP_WORDS[step.state];
  }
  // The plan as a timeline: each step a node on one line, the worker on the
  // step being built, and the final check where the line ends.
  function familyDetail(body, id) {
    const family = (state.data.families || []).find((item) => item.id === id);
    if (!family) { body.append(el("p", "vibe-panel-empty", "This request is finished or no longer on the board.")); return; }
    const building = family.steps.filter((step) => step.state === "running").length;
    heading(body, family.title, [chip(`${family.finished} of ${family.steps.length} done`, family.steps.some((step) => step.state === "approval") ? "decision" : ""), building ? chip(`${building} building now`, "live") : null]);
    if (family.summary) body.append(el("p", "vibe-ask-detail vibe-panel-reason", family.summary));
    const list = el("ol", "vibe-rows vibe-timeline");
    for (const [index, step] of family.steps.entries()) list.append(row({ key: `step:${step.id || index}`, tone: STEP_TONES[step.state], title: `${index + 1}. ${step.title}`, meta: stepMeta(step, family), detail: step.state === "running" ? step.job?.step : "", onOpen: () => push({ view: "task", id: step.id }) }));
    list.append(row({ key: "then", tone: family.final === "running" ? "live" : family.final === "checking" ? "check" : "next", title: "Then: put it together and check the whole thing", meta: family.final === "running" ? ["running now", family.job?.tool].filter(Boolean).join(" · ") : family.final === "checking" ? "checking its work" : family.final === "next" ? "up next" : "after the last step", detail: family.final === "running" ? family.job?.step : "", onOpen: () => push({ view: "task", id: family.id }) }));
    body.append(list);
    const need = (state.data.needs || []).find((item) => item.kind === "family" && item.id === id);
    const unstarted = family.steps.filter((step) => ["approval", "waiting", "blocked"].includes(step.state));
    const buttons = [];
    if (need) buttons.push({ label: "Start all steps", primary: true, run: () => vibe()?.openNeed?.({ kind: "family", id }) });
    // One host transaction, as the drawer's: dropping steps one at a time is
    // refused for a step another one waits on.
    if (unstarted.length) buttons.push({ label: "Make it one task", title: "Drop the steps that have not started; the request is built as one task", run: () => act(() => api().tasksAction({ taskId: id, projectId: state.data.projectId, action: "merge-steps" }), "Kept as one task. It builds as a whole.") });
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
    // Mefi's own thinking beside the builders: the planner looking for next
    // steps and the lead sizing a request, at the stage each has reached
    // (renderer/vibe-flow.js). Opening one shows its live strip in Vibe.
    const thinking = window.MefiVibeFlow?.active?.(data.projectId) ?? [];
    if (thinking.length) fold(body, "thinking", "Thinking now", thinking.map((run) => row({ key: `run:${run.id}`, tone: "live", title: run.kind === "size" ? `Sizing “${run.title || "your request"}”` : "Looking for next steps", meta: window.MefiVibeFlow.line(run), onOpen: () => close() })));
    fold(body, "working", "Working now", running.map((job, index) => row({ key: `job:${job.taskId || index}`, tone: "live", title: job.title || "A task", meta: [job.model || window.MefiVibeFlow?.toolName?.(job.route) || job.route || "", job.phase ? String(job.phase).replace(/_/g, " ") : "working", job.startedAt ? `started ${ago(job.startedAt)}` : ""].filter(Boolean).join(" · "), detail: job.currentStep || job.activity || "", onOpen: () => { close({ quiet: true }); go("command", job.taskId ? { selected: `task:${job.taskId}` } : {}); } })), { empty: "Nobody is building right now." });
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

  // ---- GitHub for a new app -------------------------------------------------------------
  // A choice is offered only where the host can carry it out: githubAccount
  // says who is signed in, gitPublish makes the private repository and the
  // link picker lives in renderer/git-sync.js. With none of them New app is
  // what it always was. The host does the work, never this file: it names
  // the account and the repository, and never a command, an address or a path.
  const CHOICES = [
    { id: "create", label: "Create a private GitHub repository", hint: "Only you can see it" },
    { id: "link", label: "Link a repository I already have", hint: "One you made on GitHub" },
    { id: "local", label: "Only on this PC for now", hint: "Publish any time later" },
  ];
  const LINES = {
    create: "Studio saves a first commit with a README on a branch named main, then uploads it to GitHub as a private project.",
    link: "Once the folder is made, Studio asks which of your repositories to link it to. It has to be an empty one.",
    local: "The project stays on this PC. You can publish it to GitHub any time later.",
  };
  const STAYED = "It is only on this PC for now.";
  const SWITCHED = "You switched projects, so nothing was published. Open the new app and publish it from the GitHub chip.";
  const ONEDRIVE = "This folder syncs with OneDrive. Git works, but OneDrive can lock or duplicate .git files.";
  const gitSync = () => window.MefiGitSync;
  const hasPublish = () => typeof api()?.gitPublish === "function";
  const hasPicker = () => typeof gitSync()?.showLink === "function";
  const githubOn = () => typeof api()?.githubAccount === "function" && (hasPublish() || hasPicker());
  // Signed in and able to run git: what a repository needs before it can be made or linked.
  const ready = () => Boolean(state.gh.account) && state.gh.gitInstalled;
  const offered = (id) => id === "local" || (ready() && (id === "create" ? hasPublish() : id === "link" && hasPicker()));
  // What is picked, or a private repository once GitHub knows who you are.
  function choiceNow() {
    const picked = state.draftApp.github;
    return picked && offered(picked) ? picked : offered("create") ? "create" : "local";
  }
  // The GitHub name a folder suggests: GitHub's own limits (letters, digits,
  // ".", "-" and "_", 100 at most, never a trailing dot, hyphen or ".git").
  // This is repoName in scripts/git-link.cjs, copied because a renderer
  // cannot require it; tests/vibe_panels.test.mjs holds the two together. It
  // only paints the final name before the folder exists; once it does, the
  // host is asked (gitPublishPreview) and its answer wins.
  function repoName(folderName) {
    let name = String(folderName ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/['\u2018\u2019\u02bc`]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-{2,}/g, "-");
    // Dots, hyphens and ".git" come off the ends until nothing more does; cutting to 100 can uncover another.
    const settle = () => {
      let before;
      do {
        before = name;
        name = name.replace(/\.git$/i, "").replace(/^[-.]+/, "").replace(/[-.]+$/, "");
      } while (name !== before);
    };
    settle();
    name = name.slice(0, 100);
    settle();
    return name;
  }
  const repoOf = (appName) => repoName(slugOf(appName));
  // A toast that cannot come is never a reason to fail the folder.
  const toast = (text, tone = "warn") => { try { window.MefiToast?.(text, tone); } catch { /* the sentence is in the panel too */ } };
  const reasonOf = (answer, fallback) => (typeof answer?.error === "string" && answer.error.trim() ? answer.error.trim().slice(0, 240) : fallback);

  // The project the host has open, or null when it cannot say. The host
  // publishes whichever project is open when it is asked, so a switch while
  // GitHub answers must stop the publish (see publishNew).
  const openProject = async () => { try { return (await api()?.projectsList?.())?.activeId ?? null; } catch { return null; } };

  // Who is signed in to GitHub, from the host's light look (no network).
  async function checkAccount() {
    if (typeof api()?.githubAccount !== "function") return null;
    let answer = null;
    try { answer = await api().githubAccount(); } catch { answer = null; }
    if (!answer || answer.ok === false) state.gh = { ...state.gh, checked: true };
    else {
      const account = typeof answer.account === "string" && answer.account ? answer.account : null;
      const ghInstalled = answer.ghInstalled !== false;
      const gitInstalled = answer.gitInstalled !== false;
      const moved = ghInstalled !== state.gh.ghInstalled || gitInstalled !== state.gh.gitInstalled;
      state.gh = { ...state.gh, checked: true, account, ghInstalled, gitInstalled, waiting: account || moved ? false : state.gh.waiting };
    }
    if (state.kind === "newapp") state.paintGh?.();
    return state.gh.account;
  }
  // A sign-in or install window finishes outside Studio: look again every two
  // seconds, for five minutes at most, until the panel shows a signed-in account.
  function watchAccount() {
    state.gh.waiting = true;
    if (state.gh.polling) return;
    state.gh.polling = true;
    let turns = 0;
    const tick = async () => {
      if (!state.gh.polling || aside.hidden || state.kind !== "newapp") { state.gh.polling = false; state.gh.waiting = false; return; }
      const account = await checkAccount();
      if (account || (turns += 1) >= 150) { state.gh.polling = false; state.gh.waiting = false; state.paintGh?.(); return; }
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 2000);
  }
  // Sign in through the dialog Studio's chip uses when it is there, else the
  // setup window Friends › Your PCs opens; the same for installing Git or the
  // GitHub CLI. Studio never sees a password or a token either way.
  async function setUp(action) {
    watchAccount();
    state.paintGh?.();
    try {
      if (action === "github-login" && typeof gitSync()?.showSignIn === "function") await gitSync().showSignIn();
      else if (typeof api()?.pcSetupAction === "function") {
        const opened = await api().pcSetupAction(action);
        if (opened?.ok === false) toast(reasonOf(opened, "The setup window could not open."));
      } else toast("Set up GitHub from Friends › Your PCs.");
    } catch (error) { toast(reasonOf({ error: error?.message }, "The setup window could not open.")); }
    void checkAccount();
  }

  // The GitHub choice, drawn once per form and repainted in place: an answer
  // from the host must never rebuild the fields under someone typing.
  function githubSection(nameBox, repaintMake) {
    const locked = () => state.busy || Boolean(state.draftApp.git);
    const node = el("div", "vibe-gh");
    node.setAttribute("role", "group"); node.setAttribute("aria-label", "GitHub");
    const head = el("div", "vibe-gh-head");
    const who = el("span", "vibe-gh-account");
    head.append(el("span", "vibe-set-label", "GitHub"), who);
    const group = el("div", "vibe-gh-choices");
    group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", "What happens on GitHub");
    const segments = CHOICES.filter(({ id }) => id === "local" || (id === "create" ? hasPublish() : hasPicker())).map((choice) => {
      const button = el("button", "vibe-gh-choice");
      button.type = "button"; button.setAttribute("role", "radio"); button.dataset.choice = choice.id;
      const dot = el("span", "vibe-gh-dot"); dot.setAttribute("aria-hidden", "true");
      const hint = el("small", "", choice.hint);
      const text = el("span", "vibe-gh-text"); text.append(el("b", "", choice.label), hint);
      button.append(dot, text);
      button.addEventListener("click", () => pick(choice.id));
      group.append(button);
      return { id: choice.id, button, hint, resting: choice.hint };
    });
    const status = el("div", "vibe-gh-status");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    node.append(head, group, status);

    function pick(id) {
      if (locked() || !offered(id)) return;
      state.draftApp = { ...state.draftApp, github: id };
      paint(); repaintMake();
    }
    // Radios move with the arrow keys, skipping the ones that cannot be chosen.
    group.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      const open = segments.filter((segment) => !segment.button.disabled);
      if (!step || !open.length) return;
      event.preventDefault?.();
      const next = open[(Math.max(0, open.findIndex((segment) => segment.id === choiceNow())) + step + open.length) % open.length];
      pick(next.id); next.button.focus?.();
    });

    const row = (text, sub, label, run) => {
      const box = el("div", "vibe-gh-signin");
      const words = el("div", "vibe-gh-signin-text");
      words.append(el("p", "", text), el("p", "vibe-gh-sub", sub));
      if (state.gh.waiting) words.append(el("p", "vibe-gh-sub", "Finish in the window that opened. This updates by itself."));
      const go = el("button", "vibe-btn vibe-gh-signin-go", label);
      go.type = "button";
      go.addEventListener("click", run);
      box.append(words);
      if (!state.busy) box.append(go);
      return box;
    };
    let shown = "", named = null;
    const finalName = (repo) => `${state.gh.account}/${repo || "your-app"}`;
    function paintStatus(now) {
      const draft = state.draftApp.git;
      const repo = repoOf(nameBox.value);
      // What is typed changes only the name, and in place: a live region
      // rewritten on every key reads itself out again on every key.
      const seen = JSON.stringify([now, state.gh, state.busy, draft ? [draft.ok, draft.text, draft.reason] : null]);
      if (seen === shown) { if (named) named.textContent = finalName(repo); return; }
      shown = seen; named = null;
      const refocus = status.contains?.(document.activeElement) && document.activeElement?.tagName === "BUTTON";
      const parts = [];
      if (draft && (draft.reason || draft.text)) parts.push(el("p", "", [draft.reason, draft.text].filter(Boolean).join(" ")));
      else if (!state.gh.checked) parts.push(el("p", "", "Checking your GitHub sign-in…"));
      else if (!ready()) {
        if (!state.gh.gitInstalled) parts.push(row("Git is not installed.", "Studio needs it to publish or link a project.", "Install Git", () => void setUp("install-git")));
        else if (!state.gh.ghInstalled) parts.push(row("GitHub CLI is not installed on this PC.", "Studio uses it to publish and link projects.", "Install GitHub CLI", () => void setUp("install-gh")));
        else parts.push(row("Sign in to GitHub first to publish this project or link it to a repo.", "Studio never sees your password or token.", "Sign in to GitHub", () => void setUp("github-login")));
      } else if (now === "create") {
        const final = el("div", "vibe-gh-final");
        const pill = el("span", "vibe-gh-pill", "Private");
        named = el("code", "vibe-gh-repo", finalName(repo));
        named.setAttribute("aria-live", "off");
        final.append(el("span", "vibe-gh-label", "Will be created as"), named, pill);
        parts.push(final, el("p", "", LINES.create));
      } else parts.push(el("p", "", LINES[now]));
      status.replaceChildren(...parts);
      if (refocus) status.querySelector("button")?.focus?.();
    }
    function paint() {
      const now = choiceNow();
      for (const segment of segments) {
        segment.button.disabled = locked() || !offered(segment.id);
        segment.button.setAttribute("aria-checked", String(segment.id === now));
        segment.button.setAttribute("tabindex", segment.id === now ? "0" : "-1");
        segment.hint.textContent = segment.id !== "local" && state.gh.checked && !ready() ? (state.gh.account ? "Install Git first" : "Sign in first") : segment.resting;
      }
      who.textContent = !state.gh.checked ? "Checking…" : state.gh.account ? `Signed in as ${state.gh.account}` : "Not signed in";
      paintStatus(now);
    }
    paint();
    return { node, paint };
  }

  // The private repository, once the folder is open. Each refusal becomes a
  // toast and a sentence; none of them throws, and none can undo the folder.
  async function publishNew(name, made, opened) {
    const owner = state.gh.account;
    const refused = (reason) => { toast(reason); void checkAccount(); return { choice: "create", ok: false, reason, text: STAYED }; };
    if (made?.git === false) return refused("Git could not start in the new folder, so there is nothing to publish.");
    note("Publishing to GitHub…");
    try {
      let repo = repoOf(name);
      let oneDrive = false;
      if (typeof api().gitPublishPreview === "function") {
        const plan = await api().gitPublishPreview({ owner, name: repo, ...(opened ? { projectId: opened } : {}) });
        if (!plan || plan.ok === false) return refused(reasonOf(plan, "Studio could not check GitHub. Nothing was created."));
        if (plan.needsSignIn) return refused("Sign in to GitHub first.");
        if (plan.weakDrive) return refused("Publishing needs a folder on an NTFS drive. The project is open and stays on this PC.");
        if (typeof plan.sanitized === "string" && plan.sanitized) repo = plan.sanitized;
        else if (plan.valid === false) return refused("That name cannot be a GitHub repository name.");
        if (plan.taken) return refused(`${owner}/${repo} already exists. Link to it, or pick another name.`);
        oneDrive = plan.oneDrive === true;
      }
      // The host acts on the open project: never on one somebody switched to meanwhile.
      const now = await openProject();
      if (opened && now && now !== opened) return refused(SWITCHED);
      // Private, with the .gitignore and no license: the panel never publishes public.
      const result = await api().gitPublish({ owner, name: repo, visibility: "private", gitignore: true, license: "none", ...(opened ? { projectId: opened } : {}) });
      if (!result || result.ok === false) return refused(reasonOf(result, "GitHub did not accept the project."));
      const where = typeof result.repo === "string" && result.repo ? result.repo : `${owner}/${repo}`;
      return { choice: "create", ok: true, repo: where, text: `Published ${where} (private).${oneDrive ? ` ${ONEDRIVE}` : ""}` };
    } catch (error) { return refused(reasonOf({ error: error?.message }, "GitHub did not accept the project.")); }
  }
  // Linking is the owner's to take their time over: the picker opens and the
  // first build does not wait for it. What it does then is its own to say.
  function linkNew(made) {
    const failed = (reason) => { toast(reason); return { choice: "link", ok: false, reason, text: STAYED }; };
    if (made?.git === false) return failed("Git could not start in the new folder, so there is nothing to link.");
    try {
      note("Choose the repository to link…");
      Promise.resolve(gitSync().showLink()).then((result) => { if (result && result.ok === false) toast(reasonOf(result, "The project could not be linked.")); }, (error) => toast(reasonOf({ error: error?.message }, "The project could not be linked.")));
      return { choice: "link", ok: true, text: "Choose the repository to link it to in the window that opened." };
    } catch (error) { return failed(reasonOf({ error: error?.message }, "The project could not be linked.")); }
  }
  // Its own step, after the folder is open and before the first build is
  // queued: agents start writing files with the build, and the first commit
  // should be the starter folder. It runs once, however often the build is retried.
  async function githubStep(name, made) {
    if (state.draftApp.git || !githubOn()) return state.draftApp.git ?? null;
    const choice = choiceNow();
    let outcome;
    try {
      // The project just made is the one to publish; a switch since then stops it (publishNew).
      const opened = choice === "create" ? made?.selectedId || made?.addedId || await openProject() : null;
      outcome = choice === "create" ? await publishNew(name, made, opened) : choice === "link" ? linkNew(made) : { choice, ok: true, text: "" };
    } catch (error) {
      // Nothing in this step may cost the folder or the first build.
      const reason = reasonOf({ error: error?.message }, "GitHub could not be reached.");
      toast(reason);
      outcome = { choice, ok: false, reason, text: STAYED };
    }
    state.draftApp.git = outcome;
    return outcome;
  }

  function newAppForm(body) {
    body.append(el("p", "vibe-panel-hint", "Studio makes an empty folder under Mefi Apps in your home folder, starts git in it and opens it as your project. What you describe becomes its first build."));
    const form = el("form", "vibe-set vibe-newapp");
    const name = el("input");
    name.type = "text"; name.maxLength = 60; name.placeholder = "Pixel Garden"; name.autocomplete = "off"; name.value = state.draftApp.name;
    name.setAttribute("aria-label", "The app's name"); name.dataset.typeHere = "";
    name.disabled = state.busy || Boolean(state.draftApp.made);
    const about = el("textarea");
    about.rows = 4; about.maxLength = 600; about.value = state.draftApp.about;
    about.disabled = state.busy;
    about.placeholder = "A cosy 2D game where you grow pixel plants and trade them at a market.";
    about.setAttribute("aria-label", "What the app should be"); about.dataset.typeHere = "";
    const where = el("span", "vibe-set-hint", "");
    const paintWhere = () => { const slug = slugOf(name.value); where.textContent = slug ? `Folder: Mefi Apps/${slug}` : "The folder is named after the app."; };
    paintWhere();
    // With a GitHub choice the button says what is about to happen; without
    // one it says what it always did.
    const makeLabel = () => (state.busy ? "Making it…" : state.draftApp.made?.ok === false ? "Open app and start building" : state.draftApp.made ? "Retry first build"
      : !github ? "Make it and start building" : { create: "Start and publish", link: "Start and link", local: "Start project" }[choiceNow()]);
    const github = githubOn() ? githubSection(name, () => { make.textContent = makeLabel(); }) : null;
    name.addEventListener("input", () => { state.draftApp = { ...state.draftApp, name: name.value }; paintWhere(); github?.paint(); });
    about.addEventListener("input", () => { state.draftApp = { ...state.draftApp, about: about.value }; });
    const nameField = el("label", "vibe-set-field");
    nameField.append(el("span", "", "Name"), name);
    const aboutField = el("label", "vibe-set-field");
    aboutField.append(el("span", "", "What should it be?"), about);
    const make = el("button", "vibe-btn primary", makeLabel());
    make.type = "submit"; make.disabled = state.busy;
    form.append(nameField, aboutField, where, ...(github ? [github.node] : []), make);
    // An answer from the host (who is signed in) repaints the choice in place.
    state.paintGh = github ? () => { github.paint(); make.textContent = makeLabel(); } : null;
    form.addEventListener("submit", (event) => { event.preventDefault(); void createApp(); });
    body.append(form);
    // The first build being sized, live (renderer/vibe-flow.js).
    const run = state.busy && state.appRun ? window.MefiVibeFlow?.get?.(state.appRun) : null;
    if (run) body.append(window.MefiVibeFlow.view(run));
  }
  async function createApp() {
    const name = state.draftApp.name.trim();
    const about = state.draftApp.about.trim();
    if (!name) { note("Give the new app a name.", "warn"); return; }
    if (!api()?.projectsCreate) { note("New apps can be made in the desktop app.", "warn"); return; }
    if (state.busy) return;
    // Closing the panel and opening it again clears "busy" while the first Start still waits on GitHub.
    if (state.making) { note("Still making it…"); return; }
    // Enter in a field submits the form but leaves the field focused, and a
    // panel never repaints under a field being typed in: let go of it, so
    // "Making it…" and the first build's sizing can show.
    if (aside.contains(document.activeElement)) document.activeElement.blur?.();
    state.busy = true; state.signature = ""; render();
    note("Making the folder…");
    state.making = true;
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
      // The GitHub choice is a separate step: nothing it does can fail the folder.
      const github = await githubStep(name, made);
      let said = `${name} is ready and open.`;
      if (about && api()?.vibeBuild) {
        note("Folder ready. Sizing up the first build…");
        const flow = window.MefiVibeFlow;
        const run = flow?.begin?.("size", { projectId: made.selectedId || made.activeId || null, title: `Set up ${name}` }) ?? null;
        state.appRun = run?.id ?? null; state.signature = ""; render();
        let built;
        try {
          built = await api().vibeBuild({ title: `Set up ${name}`.slice(0, 90), projectId: made.selectedId || made.activeId, ...(run ? { requestId: run.id } : {}),
            prompt: `Start this new app in its empty project folder: ${about}\n\nSet up the project so it runs, then build a first working version of what is described.` });
        } finally {
          if (run) flow.end(run.id, built?.ok === false || !built ? { ok: false, error: built?.error || "No answer" } : { ok: true, steps: Number(built.steps) || 0 });
          state.appRun = null;
        }
        if (!built || built.ok === false) throw new Error(`The folder is ready, but the first build could not be added: ${built?.error || "no answer"}`);
        said = built.steps ? `${name} is ready, and its first build is split into ${built.steps} steps.` : `${name} is ready, and its first build is queued.`;
      }
      if (github?.text) said = `${said} ${github.text}`;
      state.draftApp = { name: "", about: "" };
      state.busy = false;
      // A panel opened while this waited on GitHub or the build is not this one's to close.
      if (state.kind === "newapp") close({ quiet: true });
      vibe()?.feedback?.(said, "good");
      await vibe()?.refresh?.();
    } catch (error) {
      state.busy = false;
      note(error?.message || "The app could not be made.", "bad");
      state.signature = ""; render();
    } finally { state.making = false; }
  }

  // ---- paint ------------------------------------------------------------------------
  // Only what the open panel shows decides whether it repaints, so a push
  // storm on a big board stays cheap.
  function digest() {
    const data = state.data;
    const need = (data.needs || []).map((item) => `${item.kind}:${item.id}:${item.title}:${item.verb}`);
    const running = (data.running || []).map((job) => `${job.taskId}:${job.phase}:${job.title}:${job.currentStep || job.activity || ""}`);
    if (state.kind === "tasks" || top()?.view === "task") {
      const stages = (data.backlog?.taskStates || []).map((row) => `${row.id}:${row.stage}:${row.blockedBy || ""}:${row.reason || ""}`);
      return [data.projectId, data.projectName, need, running, stages, state.taskView, data.gate, data.status?.parallel, data.status?.adaptiveParallel, data.status?.capacity, data.backlog?.waiting, (data.tasks || []).map((task) => [task.id, task.title, task.status, task.updatedAt, task.contextVersion, task.priority, task.estimateMinutes, task.acceptance, task.deferUntil, Boolean(task.dropped), task.verification?.state, String(task.lastRunError || "").length, String(task.notes || "").length, String(task.prompt || "").length])];
    }
    if (state.kind === "ideas") return [data.projectName, (data.ideas || []).map((idea) => [idea.id, idea.title, idea.read, idea.status, idea.taskId])];
    if (state.kind === "plans") return [data.projectName, need, running, (data.plans || []).map((plan) => [plan.id, plan.title, plan.status, plan.version]), (data.families || []).map((family) => [family.id, family.title, family.final, family.job?.step, family.steps.map((step) => `${step.id}:${step.state}:${step.job?.step || ""}`)]), (data.tasks || []).length];
    if (state.kind === "team") return [data.projectName, running, data.gate, state.teamAt, (window.MefiVibeFlow?.active?.(data.projectId) ?? []).map((run) => `${run.id}:${run.stage}`)];
    if (state.kind === "settings") return [data.projectName, data.person, data.companion, document.documentElement.dataset.studioTheme];
    if (state.kind === "newapp") return [data.projectName];
    if (state.kind === "decisions") return [data.projectId, data.assistant.decisions, data.assistant.todos];
    return [];
  }
  window.addEventListener("mefi:autonomy-changed", () => { state.signature = ""; if (["settings", "decisions", "team"].includes(state.kind)) render(); });
  // A thinking run starting, moving on or ending repaints Team's list of them.
  window.MefiVibeFlow?.on?.(() => { if (state.kind === "team") render(); });
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
  window.MefiVibePanels = { open, close, back, escape, update, repoName, isOpen: () => !aside.hidden, current: () => (aside.hidden ? null : state.kind), view: () => top() };
})();
