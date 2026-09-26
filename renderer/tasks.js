// Mefi's Studio AI+ — Tasks: board, per-task logs/ideas, and the reference menu.
(function () {
  "use strict";

  const COLORS = ["#e6c98d", "#9db7ff", "#57ff9a", "#f2a2e8", "#ffb38a", "#86d1d6", "#c9a8ff", "#ffd479"];
  // Tell the Start here walkthrough that a real board action happened. The
  // guide's own listener ticks the matching stop; failures never announce.
  const announce = (name, detail) => {
    try { if (typeof CustomEvent === "function" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent(name, { detail })); } catch {}
  };
  const FILTERS = ["all", "open", "review", "done"];
  const stageLabel = (stage, task, options) => window.MefiStage?.label?.(stage, task, options) ?? String(stage ?? task?.status ?? "open");
  const READINESS_FILTERS = { all: "All scheduling states", ready: "Ready", running: "Working", review: "Verifying", waiting: "Waiting or retrying", blocked: "Needs attention" };
  // A row that just finished pulses green for a few seconds — the board's
  // echo of the constellation's done pulse — before it settles under the mark.
  const DONE_PULSE_MS = 15000;
  // Board refresh cadence while the sheet is open. The interval itself stops
  // while the window hides (boot.js's shared poll guard) and restarts when it
  // shows, and the tick bails while hidden or while the sheet is closed, so a
  // hidden app issues no store reads.
  const TASKS_POLL_MS = 15000;
  // eyes:tasks arrives up to once a second per running job (every executor
  // checkpoint). While the sheet is open a push after a quiet 250 ms paints
  // at once and pushes inside that window share one trailing paint; a paint
  // leaves the list or the detail alone when nothing it shows has changed;
  // and the scheduler snapshot (backlogStatus: the host takes the board lock
  // and re-reads the board) is read at most once per 3.5 s, with one
  // trailing read so the last push is never left unread.
  const PUSH_QUIET_MS = 250;
  const BACKLOG_MIN_MS = 3500;
  let pushPaintTimer = 0;
  let pushPaintedAt = 0;
  let backlogReadAt = 0;
  let backlogTimer = 0;
  // What a push paint last drew. renderList()/renderDetail() clear them, so
  // anything drawn outside the push path is never mistaken for it.
  const UNPAINTED = Object.freeze({ view: "", rows: null });
  let paintedList = UNPAINTED;
  let paintedDetail = UNPAINTED;
  const state = { tasks: [], plans: [], plansError: null, selected: null, filter: "all", readiness: "all", projectId: null, query: "", doneCollapsed: false, renaming: false, prefs: { blurMenu: true, useWeb: false, useTree: true, autoReference: true, useReference: true }, references: null };
  // Two-step delete: the id of the task whose Delete button is armed right now.
  let deleteArmed = null;
  const els = {};
  let initialized = false;
  // tasks:save overwrites the whole store, so this module must never write a
  // list it has not read: nothing saves until a load (or a broadcast) landed.
  let hydrated = false;
  let hydrating = null;
  let taskRevision = 0;
  let liveRevision = 0;
  let assistantRevision = 0;
  const dependencyDrafts = new Map();
  const contextReads = new Map();
  const attemptReads = new Map();
  const detailExpanded = new Map();
  const detailViews = new Map();
  const projectSelections = new Map();
  const detailViewNames = ["details", "evidence", "history", "references"];
  let detailPanels = {};
  function showDetailView(name, focus = false) {
    const task = selectedTask();
    const active = detailViewNames.includes(name) ? name : "details";
    if (task) detailViews.set(taskKey(task), active);
    const tabs = document.getElementById("task-detail-tabs");
    if (tabs) tabs.hidden = !task;
    const controls = document.getElementById("task-reference-controls");
    if (controls) controls.hidden = !task || active !== "references";
    for (const key of detailViewNames) {
      const tab = document.getElementById(`task-tab-${key}`);
      const panel = detailPanels[key];
      if (tab) { tab.setAttribute("aria-selected", String(key === active)); tab.tabIndex = key === active ? 0 : -1; }
      if (panel) panel.hidden = !task || key !== active;
      if (focus && key === active) tab?.focus?.();
    }
  }
  function focusNarrowDetail() {
    if (window.matchMedia?.("(max-width: 760px)")?.matches) els.overviewBack?.focus?.({ preventScroll: true });
  }
  const detailMessages = new Map();
  const entryDrafts = new Map();
  const entryPending = new Set();
  const startPending = new Set();
  let detailBusy = null;
  let backlogRead = 0;
  let projectEpoch = 0;
  let createPending = false;
  const createDrafts = new Map();
  const overviewExpanded = new Set();
  let plansRead = 0;
  const taskKey = (task) => `${task?.projectId || state.backlog?.projectId || ""}/${task?.id || ""}`;
  const node = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text ?? "" });

  const status = (text, isError) => {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.style.color = isError ? "var(--bad)" : "";
  };
  // Resolves false when nothing reached the store.
  const save = async (onError) => {
    if (!hydrated) { onError?.("The task store has not loaded yet."); return false; }
    taskRevision += 1;
    try {
      const result = await window.mefiStudio?.tasksSave?.(state.tasks);
      if (result?.ok !== true) onError?.(result?.error || "The task store could not be written.");
      return result?.ok === true;
    } catch (error) {
      onError?.(error.message || "The task store could not be written.");
      return false;
    }
  };
  const selectedTask = () => state.tasks.find((task) => task.id === state.selected) ?? null;
  // #tasks-open binds straight to open(), so arg 0 can be a click Event.
  const optionsOf = (value) =>
    value && typeof value === "object" && typeof value.preventDefault !== "function" ? value : {};
  // Same expression as MefiNav.refreshBadges(), so the two can never disagree.
  const openTaskCount = () => state.tasks.filter((task) => task.status === "open" || task.status === "active").length;
  const syncBadge = () => window.MefiNav?.setBadge?.("tasks", openTaskCount());
  const revealSelected = () => els.list?.querySelector("li.selected")?.scrollIntoView({ block: "nearest" });
  const isDone = (task) => ["done", "archived", "completed", "resolved"].includes(task?.status);
  // A parent whose finished run handed work on only waits for those
  // follow-ups: the verifier skips it until they settle (main.cjs
  // waitingTaskIds), and a stuck follow-up is flagged on its own card. Counting
  // every ancestor as review put one parked follow-up on the list up to four
  // times over.
  const waitingOnFollowUps = (task) => task?.status === "awaiting_verification" && Number(task?.handoffState?.pending) > 0;
  // A loop-guard hold waits for the owner's Try again, so it counts as review.
  const needsReview = (task) => !isDone(task) && task?.status !== "active" && !waitingOnFollowUps(task) && (
    task?.status === "awaiting_verification" || task?.status === "verifying" ||
    ["unverified", "failed"].includes(task?.verification?.state) || (task?.runFailures ?? 0) >= 5 ||
    scheduledTask(task)?.blockedBy === "loop"
  );
  const taskStage = (task) => isDone(task) ? "done" : needsReview(task) ? "review" : "open";
  const scheduledTask = (task) => state.backlog?.taskStates?.find((item) => item.id === task.id);
  // The owner holds: the keeper's loop guard ("loop") and a card you linked as
  // a duplicate of unfinished work ("duplicate"). Both release through the
  // retry path (backlog.retryTask drops loopGuard and duplicateOf and restarts
  // the loop count); neither is offered while a worker or checker holds it.
  const ownerHold = (task) => {
    const scheduled = scheduledTask(task);
    if (!["loop", "duplicate", "owner"].includes(scheduled?.blockedBy)) return null;
    return task?.runId || ["active", "running", "verifying", "awaiting_verification"].includes(task?.status) ? null : scheduled;
  };
  const matchesReadiness = (task) => state.readiness === "all" || (state.readiness === "waiting" ? ["waiting", "cooling"].includes(scheduledTask(task)?.stage) : state.readiness === "blocked" ? ["blocked", "approval"].includes(scheduledTask(task)?.stage) : scheduledTask(task)?.stage === state.readiness);
  const keepSelectedVisible = () => { const task = selectedTask(); if (task && state.backlog?.taskStates && !matchesReadiness(task)) state.readiness = "all"; };
  const summary = (tasks = state.tasks) => (Array.isArray(tasks) ? tasks : []).reduce((counts, task) => {
    counts.all += 1;
    counts[taskStage(task)] += 1;
    return counts;
  }, { all: 0, open: 0, review: 0, done: 0 });
  // doneAt is stamped when a task is finished; older done tasks fall back to
  // their last update so they still get a sensible finish date.
  const doneStamp = (task) => task?.doneAt ?? task?.verification?.at ?? task?.updatedAt ?? task?.createdAt ?? 0;
  const pushLog = (task, at, text) => [...(task.logs ?? []), { at, kind: "status", text }].slice(-40);
  // Search narrows every filter (title + prompt); an empty box means no filter.
  const matchesQuery = (task) => {
    const query = state.query.trim().toLowerCase();
    if (!query) return true;
    return `${task.title ?? ""} ${task.prompt ?? ""}`.toLowerCase().includes(query);
  };
  const clipText = (text, max) => {
    const flat = String(text ?? "").replace(/\s+/g, " ").trim();
    return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
  };
  function shortTitle(task) {
    const full = String(task?.title || task?.prompt || "Untitled task").replace(/\s+/g, " ").trim();
    const first = full.match(/^(.{8,70}?[.!?])(?:\s|$)/)?.[1] || full;
    if (first.length <= 72) return first;
    const cut = first.slice(0, 71).replace(/\s+\S*$/, "");
    return `${cut || first.slice(0, 71)}…`;
  }
  // This is shared by Home and Work. It describes recorded state; an agent's
  // success prose and a live preview never stand in for completion checks.
  function workflowSummary(task, { status: live = {}, backlog = null, assistant = {}, now = Date.now() } = {}) {
    const projectId = task?.projectId || backlog?.projectId || live?.projectId;
    const belongs = (value) => !value?.projectId || !projectId || value.projectId === projectId;
    if (!belongs(live)) live = {};
    if (!belongs(backlog)) backlog = null;
    if (!belongs(assistant)) assistant = {};
    const scheduled = backlog?.taskStates?.find((item) => item.id === task?.id);
    const job = (live.running || []).find((item) => item.taskId === task?.id && belongs(item) && (!task.runId || !item.runId || item.runId === task.runId));
    const question = (assistant.questions || []).find((item) => item.status === "open" && (item.context?.taskId || item.taskId) === task?.id && belongs(item));
    const finished = isDone(task);
    const handedOn = !finished && waitingOnFollowUps(task);
    const checking = !handedOn && ["awaiting_verification", "verifying"].includes(task?.status);
    const missingWorker = !finished && !checking && !handedOn && !job && (Boolean(task?.runId) || ["active", "running"].includes(task?.status));
    const failedCheck = !finished && !checking && task?.verification?.state === "failed";
    const stage = finished ? "done" : job ? "running" : missingWorker ? "waiting" : checking ? "review" : handedOn ? "waiting" : failedCheck ? "blocked" : scheduled?.stage || "ready";
    const paused = backlog?.paused === true || live.held === true || live.execute === false || assistant.status === "paused" || assistant.prefs?.paused === true;
    const label = missingWorker ? "Waiting for worker status" : handedOn && !job ? "Waiting on follow-ups" : job?.stopping ? "Stopping safely" : job?.phase === "preparing" ? "Preparing" : job?.phase === "finishing" ? "Finishing" : stage === "ready" && paused ? "Task ready · agents paused" : stageLabel(stage, task);
    const phase = job?.phase;
    // The overseer's check run. Its stamp is never cleared, so a run keyed to
    // another attempt is that attempt's evidence and says so; and a run whose
    // checks all passed can sit beside a rejected verdict (the verifier wants
    // more than green checks), which the action then names instead of
    // contradicting it.
    const run = task?.verificationRun;
    const results = Array.isArray(run?.results) ? run.results : [];
    const passing = results.filter((result) => result.ok === true).length;
    const earlier = Boolean(run?.key && task?.lastAttempt?.runId) && !String(run.key).split(":").includes(String(task.lastAttempt.runId));
    const allPassed = run?.state === "passed" && results.length > 0 && passing === results.length;
    const action = job ? job.stopping?.reason || (phase === "preparing" ? (live.clusterAgents || []).find((agent) => agent.taskId === task.id && agent.status === "running")?.step || "Preparing task context" : phase === "finishing" ? "Worker reported completion; waiting for its process to finish" : job.currentStep || job.activity || "Waiting for the first worker update") : missingWorker ? "Task has a saved worker assignment; waiting for current worker status" : checking ? "Worker finished; checking the result" : handedOn ? "Worker finished and handed work on; waiting for those follow-ups" : finished ? task.verification?.state === "verified" ? "Completion verified" : task.verification?.state === "manual" ? "Completion confirmed by you" : "Finished task; inspect the recorded evidence" : failedCheck ? allPassed && !earlier ? "Its checks passed, but the result was not accepted; review why" : "The last completion check failed; review its evidence" : ["blocked", "approval", "waiting", "cooling"].includes(scheduled?.stage) ? "Waiting before work can start" : "Ready for a worker";
    const stamp = job && Math.max(Number(job.lastOutputAt) || 0, Number(job.stepUpdatedAt) || 0);
    const since = stamp || Number(job?.startedAt);
    const seconds = Number.isFinite(since) && since > 0 ? Math.max(0, Math.floor((now - since) / 1000)) : null;
    const age = seconds === null ? "" : seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;
    const activityAge = job ? seconds === null ? "No activity time recorded" : stamp ? `Updated ${age} ago` : `No output yet · ${age} elapsed` : "";
    const checks = run?.state ? `${results.length ? `${passing}/${results.length} recorded checks passed${allPassed ? "" : ` · ${run.state}`}` : `Checks: ${run.state}`}${earlier ? " · from an earlier attempt" : ""}` : task?.verification?.state === "verified" ? `Verified: ${task.verification.reason || "completion accepted"}` : task?.verification?.state === "manual" ? "Confirmed by you; no automatic check recorded" : "No completion checks recorded";
    const blocker = question?.question || question?.title || (!finished && ["blocked", "approval", "waiting", "cooling"].includes(scheduled?.stage) ? scheduled.reason : "") || (handedOn && task.handoffState?.state === "blocked" ? task.handoffState.reason : "") || (!finished && task?.verification?.state === "failed" ? task.verification.reason : "") || "";
    const nextAction = finished ? "Open the app, view checks, or request a change." : missingWorker ? "Inspect Live or refresh task status before starting another attempt." : checking ? "Wait for completion checks, or view their evidence." : handedOn ? "Review its follow-up cards; this one settles by itself when they do." : job ? "Watch this worker in Live; stop it to save progress." : failedCheck ? "View checks, then resolve the failure before retrying." : scheduled?.stage === "cooling" ? "Wait for the scheduled retry, or choose Retry now." : scheduled?.blockedBy === "owner" ? "Resume this task from its saved progress." : blocker ? scheduled?.stage === "approval" ? "Review the brief and approve this build." : "Resolve the blocker before starting this task." : paused ? "Task ready; agents paused. Start this task to continue." : "Start this task when you are ready.";
    return { stage, label, worker: job?.route || job?.cli || (job ? "Coding worker" : missingWorker ? "Current worker status unavailable" : "No worker running"), action, activityAge, checks, blocker, nextAction };
  }
  const relTime = (ts) => {
    const ms = Date.now() - ts;
    if (ms < 60000) return "just now";
    if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
    if (ms < 48 * 3600000) return `${Math.round(ms / 3600000)}h ago`;
    return `${Math.round(ms / 86400000)}d ago`;
  };
  const span = (ms) => {
    if (!Number.isFinite(ms) || ms < 60000) return "";
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    if (ms < 48 * 3600000) return `${Math.round(ms / 3600000)}h`;
    return `${Math.round(ms / 86400000)}d`;
  };

  // The "what was done" digest: built from what the task recorded, never
  // invented — finish time, duration, last log lines, idea and ref counts.
  function doneSummary(task) {
    const parts = [];
    const result = task?.lastAttempt?.result?.parts ?? task?.lastAttempt?.result;
    const completed = Array.isArray(result?.done) ? result.done : typeof result?.done === "string" ? [result.done] : [];
    const claimed = completed.map((item) => clipText(item, 140)).filter(Boolean).join("; ");
    if (claimed) parts.push(claimed);
    if (task.verification?.reason) parts.push(clipText(task.verification.reason, 180));
    const took = span(doneStamp(task) - (task.createdAt ?? 0));
    if (took) parts.push(`took ${took}`);
    // Status churn (created / marked done / archived / reopened) is bookkeeping,
    // not "what was done" — the kind tag hides it, the regex catches old rows.
    // The worker's result line repeats the claim above once that printed.
    const logs = (task.logs ?? [])
      .filter((log) => log?.kind !== "status" && !(claimed && log?.kind === "result"))
      .map((log) => clipText(log?.text, 60))
      .filter((text) => text && !/^(task created|marked done|archived by the assistant)$/.test(text));
    if (logs.length) parts.push(`log: ${logs.slice(-3).map((text) => `"${text}"`).join("; ")}`);
    const ideas = (task.ideas ?? []).length;
    if (ideas) parts.push(`${ideas} idea${ideas === 1 ? "" : "s"} captured`);
    const refs = task.refs ?? [];
    const counts = [
      ["file", "file", "files"],
      ["session", "session", "sessions"],
      ["web", "web link", "web links"],
    ]
      .map(([kind, one, many]) => {
        const n = refs.filter((ref) => ref.kind === kind).length;
        return n ? `${n} ${n === 1 ? one : many}` : null;
      })
      .filter(Boolean);
    if (counts.length) parts.push(`refs: ${counts.join(", ")}`);
    return `finished ${relTime(doneStamp(task))}${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
  }

  function describe(task) {
    const stage = taskStage(task);
    if (stage === "done" && task?.dropped) return { stage, label: "Dropped", summary: `Dropped by you ${relTime(Number(task.dropped.at) || doneStamp(task))} — closed without finishing. Reopen puts it back on the board.` };
    if (stage === "done") return { stage, label: stageLabel("done", task), summary: doneSummary(task) };
    if (waitingOnFollowUps(task)) return { stage, label: "Waiting on follow-ups", summary: `${task.handoffState.reason || "Waiting for its handed-off work"}. The worker finished and handed the rest on; this card settles by itself once its follow-ups finish or you drop them.` };
    if (task?.status === "awaiting_verification" || task?.status === "verifying") {
      return { stage, label: stageLabel("review"), summary: "The worker finished. Completion checks are pending; this work is not marked done yet." };
    }
    if (stage === "review") return { stage, label: stageLabel("blocked"), summary: ownerHold(task)?.reason || task?.verification?.reason || task?.lastRunError || "The last attempt could not be confirmed. Review its result before retrying or marking it done." };
    return { stage, label: stageLabel(task?.status === "active" ? "running" : "open"), summary: task?.lastRunError || task?.prompt || "Ready for the assistant." };
  }

  function retryDescription(at) {
    const time = Number(at);
    if (!Number.isFinite(time) || time <= 0) return "The scheduler will retry when the hold ends.";
    const seconds = Math.max(0, Math.ceil((time - Date.now()) / 1000));
    return seconds ? `Automatic retry in ${seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)}m`} (${new Date(time).toLocaleTimeString()}).` : "Retry is due; waiting for the next scheduling pass.";
  }

  // ---- push paint signatures ----
  // One string per task row, without runProgress: the executor rewrites it on
  // every checkpoint and only the selected task's live attempt (the detail
  // pane) shows it. Every other field stays in, so a row reads as changed
  // whenever anything the list, the overview or the detail could show has
  // changed; the clock-driven labels ride along exactly as the rows print
  // them. Rows are compared one by one, never nested into one string: a
  // multi-MB board would be re-escaped on every paint.
  function rowSignature(task, now) {
    // A shallow copy with runProgress undefined, which JSON.stringify skips; a
    // replacer function would run once per nested value of every row.
    const row = JSON.stringify(task?.runProgress === undefined ? task : { ...task, runProgress: undefined });
    const done = isDone(task);
    const scheduled = scheduledTask(task);
    const labels = [done ? relTime(doneStamp(task)) : "", done && now - doneStamp(task) < DONE_PULSE_MS, done && now - doneStamp(task) < 7 * 86400000, scheduled?.stage === "cooling" ? retryDescription(scheduled.retryAt) : ""];
    // JSON never holds a raw newline, so one separates the two parts safely.
    return `${row}\n${JSON.stringify(labels)}`;
  }
  const sameRows = (rows, painted) => Array.isArray(painted) && rows.length === painted.length && rows.every((row, index) => row === painted[index]);
  // What else the list reads: the view, the plans and the scheduler's stages.
  const listView = () => JSON.stringify([state.filter, state.readiness, state.query, state.selected, state.doneCollapsed, [...overviewExpanded], Boolean(window.MefiTaskGroups?.overviewGroups), state.plans, state.plansError, state.backlog?.taskStates ?? null]);
  // What else the detail reads: the scheduler's stages and project, what the
  // selected task's live attempt shows of runProgress, and minute-grained ages.
  const detailView = () => {
    const progress = selectedTask()?.runProgress;
    const live = progress ? [progress.runId, Number.isFinite(progress.progress) ? Math.round(progress.progress * 100) : null, progress.outputTail, progress.sessionId] : null;
    return JSON.stringify([state.selected, live, state.backlog?.projectId ?? null, state.backlog?.taskStates ?? null, Math.floor(Date.now() / 60000)]);
  };
  function paintIfChanged() {
    const now = Date.now();
    const rows = state.tasks.map((task) => rowSignature(task, now));
    if (listView() !== paintedList.view || !sameRows(rows, paintedList.rows)) {
      renderList();
      // Read after the render: renderList may unfold the done mark for the selection.
      paintedList = { view: listView(), rows };
    }
    const detail = detailView();
    const inputs = detailInputs();
    if (detail !== paintedDetail.view || inputs !== paintedDetail.inputs || !sameRows(rows, paintedDetail.rows)) {
      renderDetail();
      paintedDetail = { view: detail, rows, inputs };
    }
  }
  // What the detail shows besides the board rows: the owner's pending
  // start, a busy action or message on this card, its place in the
  // scheduler, and the project preview the completed-work actions offer.
  // A change in any of them repaints it too.
  function detailInputs() {
    const task = selectedTask();
    if (!task) return "";
    const key = taskKey(task);
    const scheduled = scheduledTask(task);
    const preview = window.MefiWorkspace?.previewStatus?.();
    return JSON.stringify([startPending.has(key), detailBusy, detailMessages.get(key)?.text ?? null, scheduled?.stage ?? null, scheduled?.blockedBy ?? null,
      preview ? [preview.projectId ?? null, preview.phase ?? null, Boolean(preview.available)] : null]);
  }
  function schedulePushPaint() {
    if (pushPaintTimer) return;
    const wait = pushPaintedAt + PUSH_QUIET_MS - Date.now();
    const paint = () => {
      pushPaintTimer = 0;
      pushPaintedAt = Date.now();
      if (!els.overlay.hidden) paintIfChanged();
    };
    if (wait <= 0) paint();
    else pushPaintTimer = setTimeout(paint, wait);
  }
  // A re-render that only shows data the detail fetched for itself (its
  // context and attempt reads) changes nothing the signature covers, so it
  // keeps the push paint's signature instead of forcing the next push to
  // redraw (and refetch) an unchanged task. With a push paint still pending
  // the signature is dropped, since the rows may already be newer.
  function refreshDetail() {
    const kept = paintedDetail;
    renderDetail();
    if (!pushPaintTimer) paintedDetail = kept;
  }
  function readBacklogSoon() {
    const wait = backlogReadAt + BACKLOG_MIN_MS - Date.now();
    if (wait > 0) {
      if (!backlogTimer) backlogTimer = setTimeout(() => { backlogTimer = 0; if (!els.overlay.hidden) readBacklogSoon(); }, wait);
      return;
    }
    backlogReadAt = Date.now();
    const read = ++backlogRead;
    Promise.resolve(window.mefiStudio?.backlogStatus?.()).then((result) => {
      if (read !== backlogRead || !result?.ok) return;
      state.backlog = result;
      keepSelectedVisible();
      if (!els.overlay.hidden) paintIfChanged();
    }).catch(() => {});
  }

  function renderFilters() {
    if (!els.filters) return;
    const counts = summary();
    for (const chip of els.filters.querySelectorAll("[data-filter]")) {
      const which = chip.dataset.filter;
      chip.classList.toggle("on", which === state.filter);
      chip.textContent = `${which === "review" ? "Review" : which[0].toUpperCase() + which.slice(1)} · ${counts[which] ?? 0}`;
      chip.setAttribute("aria-pressed", String(which === state.filter));
    }
    if (els.readinessFilter) {
      els.readinessFilter.value = state.readiness;
      els.readinessFilter.disabled = !state.backlog?.taskStates;
    }
  }

  function mutedLi(text) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = text;
    return li;
  }

  function emptyListMessage(finishedCount) {
    if (state.query.trim()) return `No tasks match “${state.query.trim()}”.`;
    if (state.readiness !== "all") return state.backlog?.taskStates ? `No tasks in “${READINESS_FILTERS[state.readiness]}”.` : "Scheduling status is unavailable. Reopen the board to refresh it.";
    if (state.filter === "open") return "No open tasks.";
    if (state.filter === "review") return "No work needs review. Finished tasks stay in Done.";
    if (state.filter === "all")
      return finishedCount
        ? "No open tasks — finished work sits under the Done mark above."
        : "No tasks yet. Add one above — auto reference will attach context.";
    return "No confirmed completions in this project's board yet. Finished tasks stay here, including archived work.";
  }

  function rowButton(label, title, run) {
    const button = document.createElement("button");
    button.className = "ghost mini row-act";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      run();
    });
    return button;
  }

  function taskRow(task) {
    const li = document.createElement("li");
    li.classList.add("task-row");
    li.style.setProperty("--task-color", task.color ?? COLORS[0]);
    if (task.id === state.selected) li.classList.add("selected");
    if (isDone(task)) li.classList.add("done-row");
    if (isDone(task) && Date.now() - doneStamp(task) < DONE_PULSE_MS) li.classList.add("fresh-done");
    const dot = document.createElement("span");
    const STATUS_TAG = {
      done: "improver",
      archived: "stale",
      active: "",
      absorbed: "tidy",
      awaiting_verification: "improver",
    };
    dot.className = `src-tag ${STATUS_TAG[task.status] ?? "collision"}`;
    const scheduled = scheduledTask(task);
    dot.textContent = (scheduled?.stage ? stageLabel(scheduled.stage, task, { short: true }) : needsReview(task) ? stageLabel("blocked") : stageLabel(task.status, task, { short: true })).toUpperCase();
    if (scheduled) { dot.dataset.readiness = scheduled.stage; dot.title = scheduled.reason || ""; li.dataset.readiness = scheduled.stage; }
    const text = document.createElement("span");
    text.className = "task-name";
    text.textContent = ` ${shortTitle(task)}`;
    text.title = task.title || task.prompt || "";
    text.append(Object.assign(document.createElement("span"), { className: "who", textContent: ` ${task.refs?.length ? `· ${task.refs.length} refs` : ""}${task.logs?.length ? ` · ${task.logs.length} logs` : ""}${isDone(task) && state.filter !== "done" ? ` · done ${relTime(doneStamp(task))}` : ""}` }));
    // One-click finish (or reopen) without leaving the board.
    const actions = document.createElement("span");
    actions.className = "row-actions";
    if (isDone(task)) actions.append(rowButton("↺", "Reopen — back to the open board", () => setTaskStatus(task, "open")));
    else actions.append(rowButton("✓", "Mark done — moves it under the Done mark", () => setTaskStatus(task, "done")));
    li.append(dot, text, actions);
    // The brief rides under the title in the Done view — the same digest the
    // detail pane shows, so the list answers "what got done" at a glance.
    if (isDone(task) || needsReview(task) || ["blocked", "approval", "waiting", "cooling"].includes(scheduled?.stage)) {
      const brief = document.createElement("div");
      brief.className = "who done-brief";
      brief.textContent = scheduled?.stage === "cooling" ? `${scheduled.reason}. ${retryDescription(scheduled.retryAt)}` : ["blocked", "approval", "waiting"].includes(scheduled?.stage) ? scheduled.reason : describe(task).summary;
      brief.title = task.prompt ?? task.title;
      li.append(brief);
    }
    // Focusable because nav's claim() may focus a row in this list.
    li.tabIndex = 0;
    li.addEventListener("click", () => {
      window.MefiNav?.note?.("tasks", { taskId: task.id, projectId: state.projectId });
      state.selected = task.id;
      renderList();
      renderDetail();
      focusNarrowDetail();
    });
    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        li.click();
      }
    });
    return li;
  }

  // The done mark: one row that finished work tucks under, so the open board
  // stays clean without hiding what got done. Click folds or unfolds the pile.
  function appendDoneMark(done) {
    const archived = done.filter((task) => task.status === "archived").length;
    const li = document.createElement("li");
    li.className = "done-mark";
    li.textContent = `${state.doneCollapsed ? "▸" : "▾"} Done · ${done.length}${archived ? ` (${archived} archived)` : ""}`;
    li.title = state.doneCollapsed ? "Finished tasks hide under this mark — click to list them" : "Click to tuck finished tasks back under the mark";
    li.tabIndex = 0;
    const toggle = () => {
      state.doneCollapsed = !state.doneCollapsed;
      renderList();
    };
    li.addEventListener("click", toggle);
    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
    els.list.append(li);
  }

  async function archiveFinished() {
    const now = Date.now();
    const finished = state.tasks.filter((task) => task.status === "done");
    if (!finished.length) return;
    if (window.mefiStudio?.tasksAction) {
      let archived = 0;
      for (const task of finished) if (await runTaskAction(task, "status", { status: "archived" })) archived += 1;
      if (archived) window.MefiToast?.(`Archived ${archived} finished task${archived === 1 ? "" : "s"}`, "good");
      return;
    }
    for (const task of finished) {
      task.status = "archived";
      task.logs = pushLog(task, now, "archived");
    }
    await save();
    renderList();
    renderDetail();
    window.MefiToast?.(`Archived ${finished.length} finished task${finished.length === 1 ? "" : "s"}`, "good");
  }

  function renderList() {
    paintedList = UNPAINTED;
    els.list.textContent = "";
    renderFilters();
    els.overlay?.classList.toggle("task-overview-mode", state.filter !== "done");
    els.overlay?.classList.toggle("task-detail-open", Boolean(selectedTask()));
    if (state.filter !== "done" && window.MefiTaskGroups?.overviewGroups) { renderOverview(); return; }
    // A selected done task must be visible, so unfold the mark it lives under.
    const selected = selectedTask();
    if (selected && isDone(selected)) state.doneCollapsed = false;
    const visible = state.tasks.filter((task) => matchesQuery(task) && matchesReadiness(task));
    const open = visible.filter((task) => !isDone(task) && (state.filter === "all" || taskStage(task) === state.filter)).sort((a, b) => b.updatedAt - a.updatedAt);
    const done = visible.filter(isDone).sort((a, b) => doneStamp(b) - doneStamp(a));

    if (state.filter === "done") {
      const week = done.filter((task) => Date.now() - doneStamp(task) < 7 * 86400000).length;
      const archived = done.filter((task) => task.status === "archived").length;
      const summary = document.createElement("li");
      summary.className = "muted summary-row";
      summary.append(Object.assign(document.createElement("span"), { textContent: `${done.length} finished · ${archived} archived · ${week} this week` }));
      if (done.some((task) => task.status === "done")) {
        const archive = document.createElement("button");
        archive.className = "ghost mini";
        archive.textContent = "Archive finished";
        archive.title = "Shelve every finished task — nothing is deleted, and the rollup keeps them";
        archive.addEventListener("click", archiveFinished);
        summary.append(archive);
      }
      els.list.append(summary);
      const reviewCount = state.tasks.filter(needsReview).length;
      if (reviewCount) {
        const review = document.createElement("li");
        review.className = "summary-row";
        review.append(rowButton(`Review ${reviewCount} attempt${reviewCount === 1 ? "" : "s"}`, "See completion checks and attempts needing attention", () => selectFilter("review")));
        els.list.append(review);
      }
      if (!done.length) {
        els.list.append(mutedLi(emptyListMessage(0)));
        return;
      }
      for (const task of done) els.list.append(taskRow(task));
      return;
    }

    for (const task of open) els.list.append(taskRow(task));
    if (state.filter === "all" && done.length) {
      appendDoneMark(done);
      if (!state.doneCollapsed) for (const task of done) els.list.append(taskRow(task));
    }
    if (!open.length) els.list.append(mutedLi(emptyListMessage(done.length)));
  }

  // Saved relationships shape the overview; rendering never rewrites work.
  // Only verified evidence or the user's confirmation fills the done segment.
  function overviewProgress(task) {
    if (!task || task.unavailable) return "waiting";
    // A card you dropped is settled by your word, like one you confirmed.
    if (isDone(task)) return task.dropped || ["verified", "manual"].includes(task.verification?.state) ? "done" : "review";
    if (waitingOnFollowUps(task)) return "waiting";
    const scheduled = scheduledTask(task);
    if (["active", "running"].includes(task.status) || scheduled?.stage === "running") return "running";
    if (task.verification?.state === "failed" || (task.runFailures || 0) >= 5 || (task.verifyAttempts || 0) >= 3 || scheduled?.stage === "blocked") return "blocked";
    if (["awaiting_verification", "verifying"].includes(task.status) || needsReview(task) || scheduled?.stage === "review") return "review";
    return "waiting";
  }

  function overviewModel(group) {
    const members = Array.isArray(group.members) ? group.members : [];
    const memberTasks = members.map((member) => member.task).filter(Boolean);
    // An explicit group is one executor job representing its saved member
    // requirements. Its parent status applies to absorbed requirements only;
    // individually running/checking members retain their own actual state.
    const rows = group.kind === "task-plan" ? memberTasks : [group.task, ...memberTasks].filter(Boolean);
    const work = [...new Map(rows.map((task) => [task.id, task])).values()];
    const groupStage = group.kind === "task-plan" && group.task ? overviewProgress(group.task) : null;
    const stageOf = (task) => task.status === "absorbed" && group.task ? groupStage === "done" ? "done" : "waiting" : overviewProgress(task);
    const counts = { done: 0, running: 0, review: 0, blocked: 0, waiting: 0 };
    for (const task of work) counts[stageOf(task)] += 1;
    const plan = group.plan;
    const planning = Boolean(plan && !["converted", "converting"].includes(plan.status) && !work.length);
    const questions = Array.isArray(plan?.questions) ? plan.questions : [];
    const resolved = questions.filter((question) => question.status === "resolved");
    const nextQuestion = questions.find((question) => question.status !== "resolved" && (question.dependsOn || []).every((id) => resolved.some((item) => item.id === id))) || questions.find((question) => question.status !== "resolved");
    const stage = planning ? "planning" : work.length && counts.done === work.length ? "done" : counts.running || groupStage === "running" ? "running" : counts.blocked || groupStage === "blocked" ? "blocked" : counts.review || groupStage === "review" ? "review" : "waiting";
    const current = ["running", "blocked", "review"].includes(groupStage) ? group.task : work.find((task) => stageOf(task) === "running") || work.find((task) => stageOf(task) === "blocked") || work.find((task) => stageOf(task) === "review") || work.find((task) => stageOf(task) === "waiting");
    const currentStage = current === group.task && groupStage ? groupStage : current ? stageOf(current) : null;
    let next = current ? `${currentStage === "running" ? "Working on" : currentStage === "review" ? "Check completion" : currentStage === "blocked" ? "Needs attention" : "Next"}: ${current.title}` : work.length ? "Every task has verified evidence or your confirmation." : "Waiting for task status.";
    // The worker reports progress for the combined job, not each absorbed
    // requirement independently. Do not claim it has started a specific member.
    if (current?.status === "absorbed" && group.task) next = `${stage === "running" ? "Working on" : stage === "review" ? "Check completion" : "Next"}: ${group.task.title}`;
    if (current?.unavailable) next = `Waiting for board status: ${current.title}`;
    if (planning) next = nextQuestion ? `Discuss: ${nextQuestion.question}` : plan.unknowns?.length ? `Explore: ${plan.unknowns[0].text}` : plan.spec?.approvedAt ? "Create the approved tasks when you are ready." : plan.spec && !plan.spec.stale ? "Review and approve the specification." : resolved.length ? "Turn the recorded decisions into a specification." : "Set the destination and the questions to discuss.";
    return { group, work, counts, planning, questions, resolved, stage, current, currentStage, next, total: planning ? questions.length : work.length, done: planning ? resolved.length : counts.done };
  }

  function overviewCard(model) {
    const { group, counts, stage, planning } = model;
    const card = node("li", "task-overview-card");
    card.dataset.overviewId = group.id;
    card.dataset.stage = stage;
    const head = node("div", "task-overview-card-head");
    const kind = planning ? "PLAN & DISCUSSION" : group.kind === "approved-plan" ? "APPROVED PLAN" : group.kind === "task" ? "TASK" : group.kind === "task-delegation" ? "SHARED TASK & SUBTASKS" : "PLAN & FOLLOW-UPS";
    head.append(node("span", "eyebrow", kind));
    const badge = node("span", "task-overview-status", stageLabel(stage));
    badge.dataset.stage = stage;
    head.append(badge);
    const heading = node("h3", "task-overview-title", shortTitle({ title: group.title || group.task?.title || "Untitled plan" }));
    heading.title = group.title || group.task?.title || "Untitled plan";
    card.append(head, heading);
    const destination = group.plan?.destination || group.task?.prompt;
    if (destination) card.append(node("p", "task-overview-destination", clipText(destination, 180)));
    const progress = node("div", "task-overview-progress");
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", planning ? "Planning decisions recorded" : "Confirmed task completion");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", String(Math.max(1, model.total)));
    progress.setAttribute("aria-valuenow", String(model.done));
    const progressText = planning ? `${model.done} of ${model.total} decisions recorded` : `${model.done} of ${model.total} tasks confirmed; ${counts.running} working; ${counts.review} awaiting checks; ${counts.blocked} need attention`;
    progress.setAttribute("aria-valuetext", progressText);
    const segments = planning ? { done: model.done, waiting: Math.max(0, model.total - model.done) } : counts;
    for (const key of ["done", "running", "review", "blocked", "waiting"]) {
      if (!segments[key]) continue;
      const part = node("span", "task-overview-segment");
      part.dataset.stage = key;
      part.style.setProperty("flex-grow", String(segments[key]));
      part.setAttribute("aria-hidden", "true");
      progress.append(part);
    }
    card.append(progress);
    const percent = model.total ? Math.round(model.done / model.total * 100) : 0;
    const countText = planning ? `${model.done}/${model.total} decisions recorded · discussion does not start a build` : group.kind === "task-plan" ? `${model.done}/${model.total} requirements confirmed (${percent}%) · ${stage === "running" ? "plan in progress" : stage === "review" ? "plan awaiting checks" : stage === "blocked" ? "plan needs attention" : stage === "done" ? "plan confirmed" : "plan waiting"}` : `${model.done}/${model.total} confirmed (${percent}%)${counts.running ? ` · ${counts.running} working` : ""}${counts.review ? ` · ${counts.review} awaiting checks` : ""}${counts.blocked ? ` · ${counts.blocked} need attention` : ""}${counts.waiting ? ` · ${counts.waiting} waiting` : ""}`;
    card.append(node("p", "task-overview-counts", countText));
    const next = node("div", "task-overview-next");
    next.append(node("span", "task-overview-step-label", "Current step"), node("strong", "", model.next));
    card.append(next);
    if (model.current && model.currentStage === "review") card.append(node("p", "task-overview-note", isDone(model.current) ? "This historical completion still needs verified evidence or your confirmation." : describe(model.current.status === "absorbed" ? group.task : model.current).summary));
    if (model.current && ["blocked", "waiting"].includes(model.currentStage)) {
      const scheduled = scheduledTask(model.current);
      const reason = model.currentStage === "blocked" ? ownerHold(model.current)?.reason || model.current.verification?.reason || model.current.lastRunError || (scheduled?.stage === "blocked" ? scheduled.reason : "Review the previous attempt before continuing.") : ["waiting", "cooling", "approval"].includes(scheduled?.stage) ? scheduled.reason : null;
      if (reason) card.append(node("p", "task-overview-note", reason));
    }
    if (stage === "done" && group.task) card.append(node("p", "task-overview-note", doneSummary(group.task)));
    const actions = node("div", "task-overview-actions");
    if (group.planId && (group.plan || group.kind === "approved-plan")) actions.append(rowButton(planning ? "Continue planning" : "View plan", "Open the saved destination, discussion and decisions", () => { close(); window.MefiPlanning?.open?.({ planId: group.planId }); }));
    const release = model.current && !model.current.unavailable ? holdAction(model.current) : null;
    if (release && !release.disabled) {
      const button = rowButton(release.label, release.title, release.run);
      button.dataset.taskAction = release.action;
      actions.append(button);
    }
    const target = model.current?.status === "absorbed" ? group.task : model.current?.unavailable ? null : model.current || group.task;
    if (target && state.tasks.some((task) => task.id === target.id)) actions.append(rowButton("Open current task", "Open the full brief, result and task history", () => window.MefiTasks.selectTask(target.id)));
    if (actions.children.length) card.append(actions);
    const members = [group.task && { id: group.task.id, task: group.task, canonical: true }, ...(group.members || [])].filter(Boolean);
    const seen = new Set();
    const detailsRows = members.filter((member) => member.task && !seen.has(member.id) && seen.add(member.id));
    if (detailsRows.length) {
      const details = node("details", "task-overview-details");
      details.open = overviewExpanded.has(group.id) || detailsRows.some((member) => member.id === state.selected);
      details.append(node("summary", "", `Tasks & progress · ${detailsRows.length}`));
      details.addEventListener("toggle", () => { details.open ? overviewExpanded.add(group.id) : overviewExpanded.delete(group.id); });
      const list = node("ul", "pin-list task-overview-members");
      for (const member of detailsRows) {
        if (member.canonical !== false) list.append(taskRow(member.task));
        else {
          const saved = node("li", "task-overview-saved");
          saved.append(node("strong", "", member.task.title || "Saved requirement"), node("p", "", member.task.prompt || "Waiting for the saved task's board status."));
          list.append(saved);
        }
      }
      details.append(list);
      card.append(details);
    }
    return card;
  }

  function renderOverview() {
    const groups = window.MefiTaskGroups.overviewGroups(state.tasks, { plans: state.plans });
    const query = state.query.trim().toLowerCase();
    const models = groups.map(overviewModel).filter((model) => {
      const group = model.group;
      const rows = [group.task, ...(group.members || []).map((member) => member.task)].filter(Boolean);
      const matches = !query || `${group.title || ""} ${group.plan?.destination || ""} ${(group.plan?.questions || []).map((question) => question.question).join(" ")}`.toLowerCase().includes(query) || rows.some(matchesQuery);
      if (!matches || state.readiness !== "all" && !rows.some(matchesReadiness)) return false;
      if (state.filter === "review") return model.stage === "review" || model.stage === "blocked" || model.counts.review > 0 || model.counts.blocked > 0;
      if (state.filter === "open") return model.planning || model.stage === "running" || model.counts.running > 0 || model.counts.waiting > 0;
      return true;
    });
    const rank = { running: 0, blocked: 1, review: 2, planning: 3, waiting: 4, done: 5 };
    models.sort((a, b) => rank[a.stage] - rank[b.stage] || (b.group.plan?.updatedAt || b.group.task?.updatedAt || 0) - (a.group.plan?.updatedAt || a.group.task?.updatedAt || 0));
    const heading = node("li", "task-overview-summary");
    heading.append(node("strong", "", `${models.length} ${models.length === 1 ? "card" : "cards"} in this view`), node("span", "", "Filters count saved tasks; related tasks share a card, and completed cards may be folded below."));
    els.list.append(heading);
    if (state.plansError) els.list.append(node("li", "task-overview-note", "Saved plans could not be refreshed. Task progress is still available."));
    const finished = models.filter((model) => model.stage === "done");
    for (const model of models.filter((model) => model.stage !== "done")) els.list.append(overviewCard(model));
    if (finished.length) {
      const row = node("li", "task-overview-finished");
      const details = node("details", "task-overview-finished-fold");
      details.open = overviewExpanded.has("finished") || finished.some((model) => model.work.some((task) => task.id === state.selected));
      details.append(node("summary", "", `Confirmed plans & tasks · ${finished.length}`));
      details.addEventListener("toggle", () => { details.open ? overviewExpanded.add("finished") : overviewExpanded.delete("finished"); });
      const list = node("ul", "pin-list task-overview-finished-list");
      for (const model of finished) list.append(overviewCard(model));
      details.append(list); row.append(details); els.list.append(row);
    }
    if (!models.length) els.list.append(mutedLi(emptyListMessage(0)));
  }

  async function loadPlans() {
    const api = window.mefiStudio;
    if (!api?.planningList) return;
    const epoch = projectEpoch, projectId = state.projectId, read = ++plansRead;
    try {
      const result = await api.planningList(projectId ? { projectId } : {});
      if (epoch !== projectEpoch || read !== plansRead || projectId !== state.projectId || result?.projectId && projectId && result.projectId !== projectId) return;
      if (!result?.ok || !Array.isArray(result.plans)) throw new Error("Plans unavailable");
      state.plans = result.plans.filter((plan) => !plan.projectId || !projectId || plan.projectId === projectId);
      state.plansError = null;
    } catch {
      if (epoch !== projectEpoch || read !== plansRead) return;
      state.plansError = true;
    }
    if (!els.overlay.hidden) paintIfChanged();
  }

  async function load(options = {}) {
    const revision = taskRevision;
    const liveRead = liveRevision, assistantRead = assistantRevision;
    const epoch = projectEpoch;
    // The poll and open() read the scheduler snapshot too; a push right
    // after one waits out the same 3.5 s instead of reading it again.
    backlogReadAt = Date.now();
    const [tasks, prefs, backlog, live, assistant] = await Promise.all([window.mefiStudio?.tasksList?.(), window.mefiStudio?.prefsGet?.(), Promise.resolve(window.mefiStudio?.backlogStatus?.()).catch(() => null), Promise.resolve(window.mefiStudio?.assistantStatus?.()).catch(() => null), Promise.resolve(window.mefiStudio?.assistantState?.()).catch(() => null)]);
    if (epoch !== projectEpoch) return;
    if (tasks?.ok === false || !Array.isArray(tasks?.tasks)) throw new Error(tasks?.error || "Task store unavailable");
    if (state.projectId && tasks.projectId && state.projectId !== tasks.projectId) return;
    state.projectId = tasks.projectId || backlog?.projectId || state.projectId;
    if (liveRead === liveRevision && live?.status && (!live.status.projectId || live.status.projectId === state.projectId)) state.live = live.status;
    if (assistantRead === assistantRevision && assistant?.state && (!assistant.state.projectId || assistant.state.projectId === state.projectId)) state.assistant = assistant.state;
    if (!state.selected && options.restoreSelection && !options.taskId) state.selected = window.MefiNav?.taskContext?.(state.projectId)?.taskId || projectSelections.get(state.projectId) || null;
    // A completion broadcast may arrive while preferences are still loading.
    // Never replace that newer board with the earlier read's snapshot.
    if (revision === taskRevision) state.tasks = tasks.tasks;
    if (state.selected && !state.tasks.some((task) => task.id === state.selected)) state.selected = null;
    if (revision === taskRevision) state.backlog = backlog?.ok && (!backlog.projectId || !state.projectId || backlog.projectId === state.projectId) ? backlog : null;
    hydrated = true;
    if (prefs?.ok) state.prefs = { ...state.prefs, ...prefs.prefs };
    state.filter = FILTERS.includes(options.filter) ? options.filter : revision === taskRevision && FILTERS.includes(prefs?.prefs?.taskFilter) ? prefs.prefs.taskFilter : state.filter;
    if (state.selected && !options.taskId && state.filter !== "all" && taskStage(selectedTask()) !== state.filter) {
      if (FILTERS.includes(options.filter)) state.selected = null;
      else state.filter = taskStage(selectedTask());
    }
    if (Object.hasOwn(READINESS_FILTERS, options.readiness)) { state.readiness = options.readiness; state.filter = "all"; if (!options.taskId) state.selected = null; }
    if (options.taskId) {
      state.readiness = "all";
      const task = selectedTask();
      if (task && state.filter !== "all" && taskStage(task) !== state.filter) state.filter = taskStage(task);
      state.query = "";
      if (els.search) els.search.value = "";
    }
    if (FILTERS.includes(options.filter) || options.taskId) setPref("taskFilter", state.filter);
    keepSelectedVisible();
    syncBadge();
    renderFilters();
    // The 15 s poll lands here too: an unchanged board keeps its rows, the
    // detail's focus and drafts, and skips the detail's context rereads.
    paintIfChanged();
    applyPrefs();
    await loadPlans();
  }

  // One shared read serves every waiting writer, so two quick adds cannot each
  // load the store and overwrite the other.
  function hydrate() {
    if (hydrated) return Promise.resolve();
    if (!hydrating) {
      hydrating = load()
        .catch(() => {})
        .finally(() => {
          hydrating = null;
        });
    }
    return hydrating;
  }

  function applyPrefs() {
    els.prefReference.checked = state.prefs.useReference !== false;
    els.prefWeb.checked = Boolean(state.prefs.useWeb);
    els.prefTree.checked = state.prefs.useTree !== false;
    els.prefBlur.checked = state.prefs.blurMenu !== false;
    els.prefAuto.checked = state.prefs.autoReference !== false;
    for (const overlay of document.querySelectorAll("#tasks-overlay, #ideas-overlay, #overhead-overlay, #analyzer-overlay, #explorer-overlay")) {
      overlay.classList.toggle("no-blur", !state.prefs.blurMenu);
    }
    applyBlur(state.prefs.blurMenu !== false);
  }

  // The Blur menu preference is Studio-wide: html[data-no-blur] gives every
  // sheet its opaque, unblurred backdrop (styles.css), from boot, wherever the
  // #pref-blur checkbox lives.
  function applyBlur(on) {
    document.documentElement?.toggleAttribute?.("data-no-blur", !on);
    const box = document.getElementById("pref-blur");
    if (box && box.checked !== on) box.checked = on;
  }

  function setPref(key, value) {
    state.prefs[key] = value;
    Promise.resolve(window.mefiStudio?.prefsSet?.({ [key]: value })).then(applyPrefs).catch(() => {});
  }

  function selectFilter(filter) {
    if (!FILTERS.includes(filter)) return;
    state.filter = filter;
    state.readiness = "all";
    // A selected task outside this view must not leave unrelated details on
    // screen while the list says there are no results.
    const task = selectedTask();
    if (filter !== "all" && task && taskStage(task) !== filter) state.selected = null;
    setPref("taskFilter", state.filter);
    renderList();
    renderDetail();
  }

  // One writer for every status move (board rows and the detail buttons), so a
  // finish always stamps doneAt and a reopen always re-arms the autopilot.
  function setTaskStatus(task, value) {
    if (window.mefiStudio?.tasksAction) return runTaskAction(task, "status", { status: value });
    const now = Date.now();
    const wasDone = isDone(task);
    if (value === "done" && task.status !== "done") {
      task.doneAt = now;
      task.verification = { state: "manual", at: now, reason: "Marked done by you" };
      task.logs = pushLog(task, now, "marked done");
    } else if (value === "open" || value === "active") {
      // A manual reopen re-arms a task the autopilot cooled down or gave up
      // on — the failure backoff and its error clear with it.
      delete task.doneAt;
      delete task.runFailures;
      delete task.nextRunAt;
      delete task.lastRunError;
      if (wasDone) task.logs = pushLog(task, now, "reopened");
    } else if (value === "archived" && task.status !== "archived") {
      task.logs = pushLog(task, now, "archived");
    }
    task.status = value;
    task.updatedAt = now;
    save().then((ok) => {
      if (!ok) window.MefiToast?.("Change not saved · the task store could not be written", "bad");
    });
    renderList();
    renderDetail();
  }

  function deleteTask(task) {
    if (deleteArmed !== task.id) {
      // First click arms: the button asks for a confirmation instead of
      // dropping a task on a stray click.
      deleteArmed = task.id;
      renderDetail();
      setTimeout(() => {
        if (deleteArmed === task.id) {
          deleteArmed = null;
          if (!els.overlay.hidden) renderDetail();
        }
      }, 4000);
      return;
    }
    deleteArmed = null;
    const index = state.tasks.findIndex((entry) => entry.id === task.id);
    state.tasks = state.tasks.filter((entry) => entry.id !== task.id);
    if (state.selected === task.id) state.selected = null;
    syncBadge();
    renderList();
    renderDetail();
    const removal = window.mefiStudio?.tasksDelete
      ? Promise.resolve(window.mefiStudio.tasksDelete({ taskId: task.id, projectId: task.projectId || state.backlog?.projectId })).catch((error) => ({ ok: false, error: error.message }))
      : save().then((ok) => ({ ok }));
    removal.then((result) => {
      if (!result?.ok) {
        // Put it back rather than pretend the delete landed. A push during the
        // delete may already have: rows are shared with every onTasks
        // listener, so this builds a new list instead of splicing that one.
        if (!state.tasks.some((entry) => entry.id === task.id)) {
          const at = Math.min(Math.max(index, 0), state.tasks.length);
          state.tasks = [...state.tasks.slice(0, at), task, ...state.tasks.slice(at)];
        }
        syncBadge();
        renderList();
        renderDetail();
        window.MefiToast?.(`Task not deleted · ${result?.error || "the task store could not be written"}`, "bad");
        return;
      }
      window.MefiToast?.(`Task deleted · ${task.title}`, "good");
    });
  }

  // Who filed a card. Promotion keeps a request's own source (it used to
  // rewrite every one to "a-eyes"), so the roster's filers need their names.
  const SOURCE_LABELS = {
    "a-eyes": "A-Eyes", chat: "chat", overseer: "overseer", manual: "added by hand",
    fix: "an A-Eyes alert", audit: "the auditor", agent: "a builder's hand-off", grow: "the grower", grower: "the grower",
    improver: "the improver", machine: "the machine monitor",
  };
  // A card's origin (workAdmission.taskRow's { kind, by } stamp) says how the
  // owner's own work arrived, whatever its source says.
  const OWNER_ORIGIN_LABELS = { chat: "chat", composer: "the composer", "work-on": "Work on it", split: "a split", planning: "an approved plan" };
  function sourceLabel(task) {
    const origin = task.origin && typeof task.origin === "object" ? task.origin : null;
    if (origin?.by === "owner") return OWNER_ORIGIN_LABELS[origin.kind] || "you";
    return SOURCE_LABELS[task.source] || (origin ? SOURCE_LABELS[origin.by] : "") || "";
  }

  function metaLine(task) {
    const parts = [];
    if (waitingOnFollowUps(task)) {
      parts.push("run finished — waiting on its follow-ups");
    } else if (task.status === "awaiting_verification") {
      parts.push("run finished — awaiting verification");
    } else if (task.dropped && isDone(task)) {
      parts.push(`dropped by you ${relTime(Number(task.dropped.at) || doneStamp(task))} — not finished`);
    } else if (task.status === "absorbed") {
      parts.push(`absorbed into a grouped plan${task.absorbedInto ? ` (${task.absorbedInto})` : ""} — restored if the grouping dissolves`);
    } else if (isDone(task)) {
      parts.push(`finished ${relTime(doneStamp(task))}`);
      if (task.status === "archived") parts.push("archived");
    } else if (task.status === "active") {
      parts.push("active — the executor is on it");
    } else {
      parts.push(`added ${relTime(task.createdAt ?? task.updatedAt ?? Date.now())}`);
    }
    const from = sourceLabel(task);
    if (from) parts.push(`from ${from}`);
    return parts.join(" · ");
  }

  // The one button an owner hold offers, on the detail pane and the overview
  // card alike: the targeted retry through the host, never a local edit.
  function holdAction(task) {
    const hold = ownerHold(task);
    if (!hold) return null;
    const loop = hold.blockedBy === "loop";
    const stopped = hold.blockedBy === "owner";
    return {
      label: loop ? "Try again" : stopped ? "Resume" : "Run anyway",
      action: loop ? "try-again" : stopped ? "resume" : "run-anyway",
      className: "primary",
      title: loop
        ? "Release the loop guard's hold and restart its count from now. Read the last attempts first, and edit or split the brief if the same failure would repeat."
        : stopped
          ? "You stopped this task's worker. Put it back in the queue; it continues from its saved progress."
          : "Clear the duplicate link and run this card on its own instead of waiting for the card it repeats",
      disabled: !window.mefiStudio?.tasksAction,
      run: () => runTaskAction(task, "retry"),
    };
  }

  // Verb-first actions: the common move (finish / reopen) is the one big
  // button, and the rarer moves sit beside it as ghosts.
  function statusActions(task) {
    const actions = [];
    const scheduled = scheduledTask(task);
    const awaitingApproval = scheduled?.stage === "approval";
    const release = holdAction(task);
    if (awaitingApproval) actions.push({ label: "Approve build", action: "approve", className: "primary", title: "Approve the brief shown here so this task can build when scheduling and prerequisites allow", disabled: !window.mefiStudio?.backlogControl || scheduled.canApprove !== true || !task.buildScope, run: () => runTaskAction(task, "approve", { expectedScope: task.buildScope }) });
    if (release && !(release.action === "resume" && window.MefiWorkspace?.startTask)) actions.push(release);
    if (isDone(task)) {
      actions.push({ label: "Reopen", className: "primary", title: "Put this task back on the open board", run: () => setTaskStatus(task, "open") });
    } else {
      actions.push({ label: needsReview(task) && !release ? "Confirm done" : "Mark done", className: awaitingApproval || release ? "ghost" : "primary", title: "Mark this task complete after reviewing its result", run: () => setTaskStatus(task, "done") });
    }
    if (!release && (needsReview(task) || scheduled?.stage === "cooling")) actions.push({ label: scheduled?.stage === "cooling" ? "Retry now" : "Retry", className: "ghost", title: scheduled?.blockedBy ? scheduled.reason : "Return this task to the queue for another attempt", disabled: ["verifying", "awaiting_verification"].includes(task.status) || scheduled?.canRetry === false, run: () => {
      if (window.mefiStudio?.tasksAction) return runTaskAction(task, "retry");
      delete task.verification;
      delete task.verifyAttempts;
      setTaskStatus(task, "open");
    } });
    // Won't do: closes unfinished work without claiming it finished (the host
    // stamps it dropped, never done), and a task that handed it on stops
    // waiting for it. Confirm done used to be the only way off the Review list.
    if (!isDone(task) && window.mefiStudio?.tasksAction && !task.runId && !["active", "running", "awaiting_verification", "verifying", "absorbed"].includes(task.status)) actions.push({ label: "Drop", action: "drop", className: "ghost", title: "Close this task without finishing it. It is not marked done, and a task that handed it on stops waiting for it. Reopen brings it back.", run: () => runTaskAction(task, "drop") });
    if (task.status === "open" && window.mefiStudio?.backlogControl && (!scheduled || scheduled.stage === "ready")) actions.push({ label: "Do next", className: "ghost", title: "Prioritize this task when its prerequisites and a worker are ready", run: () => runTaskAction(task, "prioritize") });
    // A running worker is stopped, not released: its progress is saved and the
    // card waits for you instead of being picked up again at once.
    if (task.status === "active" && task.runId && window.mefiStudio?.tasksAction) actions.push({ label: "Stop", action: "stop", allowDuringRun: true, className: "ghost", title: "Stop this task's worker. Its progress is saved and the card waits for you; other workers keep running.", run: () => runTaskAction(task, "stop") });
    else if (task.status === "active") actions.push({ label: "Back to open", className: "ghost", title: "Release the active claim", run: () => setTaskStatus(task, "open") });
    if (task.status === "absorbed") actions.push({ label: "Restore", className: "ghost", title: "Pull this task out of the grouped plan and back onto the open board", run: () => setTaskStatus(task, "open") });
    if (task.status === "done") actions.push({ label: "Archive", className: "ghost", title: "Shelve the finished task", run: () => setTaskStatus(task, "archived") });
    if (task.status === "archived") actions.push({ label: "Mark done", className: "ghost", title: "Back to done, still under the Done mark", run: () => setTaskStatus(task, "done") });
    actions.push({
      label: "Rename",
      allowDuringRun: true,
      className: "ghost mini",
      title: "Edit the title",
      run: () => {
        state.renaming = true;
        renderTitle(task);
      },
    });
    const armed = deleteArmed === task.id;
    actions.push({
      label: armed ? "Really delete?" : "Delete",
      className: armed ? "ghost mini danger danger-armed" : "ghost mini danger",
      title: "Remove this task for good",
      run: () => deleteTask(task),
    });
    return actions;
  }

  function renderTitle(task) {
    if (!task) {
      els.title.textContent = "Select a task";
      return;
    }
    // Leave a half-typed rename alone if a broadcast re-renders mid-edit.
    if (state.renaming && els.title.querySelector("input")) return;
    if (!state.renaming) {
      els.title.textContent = shortTitle(task);
      els.title.title = task.title || task.prompt || "";
      return;
    }
    els.title.textContent = "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "fill";
    input.maxLength = 90;
    input.value = task.title;
    let closed = false;
    const commit = (apply) => {
      if (closed) return;
      closed = true;
      state.renaming = false;
      const value = input.value.trim();
      if (apply && value && value !== task.title) {
        if (window.mefiStudio?.tasksAction) runTaskAction(task, "rename", { title: value.slice(0, 90) });
        else {
          task.title = value.slice(0, 90);
          task.updatedAt = Date.now();
          save();
        }
      }
      renderTitle(task);
      renderList();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") commit(true);
      else if (event.key === "Escape") commit(false);
    });
    input.addEventListener("blur", () => commit(true));
    els.title.append(input);
    input.focus();
    input.select();
  }

  async function runTaskAction(task, action, patch = {}) {
    if (detailBusy) return false;
    const epoch = projectEpoch;
    const key = taskKey(task), projectId = task.projectId || state.backlog?.projectId;
    detailBusy = key; renderDetail();
    try {
      const result = await window.mefiStudio[["prioritize", "approve"].includes(action) ? "backlogControl" : "tasksAction"]({ taskId: task.id, projectId, action, ...patch });
      if (!result?.ok) throw new Error(result?.error || "The task change could not be saved.");
      if (epoch !== projectEpoch || (projectId && state.projectId && state.projectId !== projectId)) return true;
      if (result.task) state.tasks = state.tasks.map((item) => item.id === task.id ? result.task : item);
      if (result.backlog) state.backlog = result.backlog;
      keepSelectedVisible();
      contextReads.delete(key);
      detailMessages.delete(key);
      if (action === "approve") detailMessages.set(key, { text: "Build approved for this brief. It can start when scheduling and prerequisites allow." });
      // A drop is triage: stay on the list being worked through instead of
      // following the closed card to Done.
      if (action === "drop") {
        if (state.selected === task.id) state.selected = null;
        window.MefiToast?.(`Dropped · ${shortTitle(task)}`, "good");
      }
      const selected = selectedTask();
      if (selected && state.filter !== "all" && taskStage(selected) !== state.filter) state.filter = taskStage(selected);
      syncBadge(); renderList();
      return true;
    } catch (error) {
      if (epoch !== projectEpoch) return false;
      detailMessages.set(key, { text: error.message, error: true });
      window.MefiToast?.(error.message, "bad");
      return false;
    } finally {
      detailBusy = null; renderDetail();
    }
  }

  function detailFold(task, id, title) {
    const fold = node("details", `task-context-section task-${id}`, "");
    fold.dataset.taskPanel = id;
    fold.open = detailExpanded.get(`${taskKey(task)}/${id}`) === true;
    const heading = node("summary", "", title);
    heading.addEventListener("click", (event) => {
      event.preventDefault(); fold.open = !fold.open;
      detailExpanded.set(`${taskKey(task)}/${id}`, fold.open);
    });
    fold.append(heading);
    return fold;
  }

  function requestTaskContext(task) {
    const api = window.mefiStudio;
    if (!api?.tasksHistory && !api?.tasksHandoff) return null;
    const key = taskKey(task);
    const signature = JSON.stringify([task.updatedAt, task.contextVersion, task.contextHistory, task.lastAttempt, task.verification, taskRevision]);
    const prior = contextReads.get(key);
    if (prior?.signature === signature) return prior;
    const record = { signature, loading: true, entries: [], text: "" };
    contextReads.set(key, record);
    const payload = { taskId: task.id, projectId: task.projectId || state.backlog?.projectId };
    Promise.allSettled([api.tasksHistory?.(payload), api.tasksHandoff?.(payload)]).then((results) => {
      if (contextReads.get(key) !== record) return;
      record.loading = false;
      const history = results[0].status === "fulfilled" ? results[0].value : null;
      const handoff = results[1].status === "fulfilled" ? results[1].value : null;
      record.entries = history?.ok ? history.entries || [] : [];
      record.nextBefore = history?.nextBefore;
      record.hasMore = history?.hasMore === true;
      record.text = handoff?.ok ? handoff.text || "" : "";
      record.error = history?.error || handoff?.error || (results.some((result) => result.status === "rejected") ? "The saved context could not be loaded." : "");
      if (!els.overlay.hidden && taskKey(selectedTask()) === key) refreshDetail();
    });
    return record;
  }

  async function taskDetailAction(task, action, payload = {}) {
    const api = window.mefiStudio;
    const method = action === "dependencies" ? "tasksDependencies" : "tasksRestore";
    if (!api?.[method] || detailBusy) return;
    const key = taskKey(task), projectId = task.projectId || state.backlog?.projectId;
    detailBusy = key;
    detailMessages.set(key, { text: action === "dependencies" ? "Saving prerequisites…" : "Restoring this brief…" });
    renderDetail();
    try {
      const result = await api[method]({ taskId: task.id, projectId, ...payload });
      if (!result?.ok) throw new Error(result?.error || "The change could not be saved. Try again.");
      if (taskKey(selectedTask()) !== key) return;
      if (result.task) state.tasks = state.tasks.map((item) => item.id === task.id ? result.task : item);
      if (result.backlog) state.backlog = result.backlog;
      dependencyDrafts.delete(key);
      contextReads.delete(key);
      detailMessages.set(key, { text: action === "dependencies" ? "Prerequisites saved. The queue will wait for them to finish." : "Earlier brief restored. Files, task status, and completion evidence are unchanged." });
      renderList();
    } catch (error) {
      detailMessages.set(key, { text: error.message, error: true });
    } finally {
      detailBusy = null;
      if (taskKey(selectedTask()) === key) renderDetail();
    }
  }

  function renderTaskDelegation(task) {
    const sameProject = (item) => (!task.projectId || !item.projectId || item.projectId === task.projectId) &&
      (!task.projectPath || !item.projectPath || String(item.projectPath).replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase() === String(task.projectPath).replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase());
    const parentId = task.delegatedFrom?.parentTaskId;
    if (parentId) {
      const parent = state.tasks.find((item) => item.id === parentId && sameProject(item));
      const link = node("button", "ghost mini", parent ? `Shared task: ${parent.title || parent.id}` : "Shared task unavailable");
      link.type = "button"; link.dataset.taskAction = "view-parent"; link.disabled = !parent;
      link.addEventListener("click", () => window.MefiTasks.selectTask(parentId));
      (detailPanels.details || els.detail).append(link);
    }
    const childIds = new Set(Array.isArray(task.delegation?.childTaskIds) ? task.delegation.childTaskIds : []);
    for (const item of state.tasks) if (item.delegatedFrom?.parentTaskId === task.id && sameProject(item)) childIds.add(item.id);
    childIds.delete(task.id);
    if (!childIds.size) return;
    const children = [...childIds].map((id) => ({ id, task: state.tasks.find((item) => item.id === id && sameProject(item)) }));
    const confirmed = children.filter((child) => overviewProgress(child.task) === "done").length;
    const section = node("section", "task-context-section task-delegation");
    section.dataset.taskPanel = "delegation";
    section.append(node("h4", "", `Delegated subtasks · ${confirmed}/${children.length} confirmed`));
    if (task.delegation?.summary) section.append(node("p", "task-context-hint", task.delegation.summary));
    section.append(node("p", "task-context-hint", "The parent resumes to combine and verify results after every subtask is confirmed. With Verify first, each new subtask needs its own build approval."));
    const list = node("ul", "pin-list");
    for (const child of children) {
      const row = node("li", "task-delegation-child");
      const link = node("button", "ghost mini", child.task?.title || `Unavailable subtask · ${child.id}`);
      link.type = "button"; link.dataset.taskAction = "view-subtask"; link.dataset.taskId = child.id; link.disabled = !child.task;
      link.addEventListener("click", () => window.MefiTasks.selectTask(child.id));
      const stage = overviewProgress(child.task), scheduled = child.task && scheduledTask(child.task);
      const label = !child.task ? "Board status unavailable" : scheduled?.stage === "approval" ? stageLabel("approval") : stageLabel(stage, child.task);
      row.append(link, node("span", "task-context-hint", label));
      if (scheduled?.reason) row.append(node("p", "task-context-hint", scheduled.reason));
      list.append(row);
    }
    section.append(list); (detailPanels.details || els.detail).append(section);
  }

  function renderTaskContext(task) {
    const key = taskKey(task), api = window.mefiStudio;
    const scheduled = state.backlog?.taskStates?.find((item) => item.id === task.id);
    const readiness = node("p", "task-readiness", scheduled?.stage === "cooling" ? `${scheduled.reason}. ${retryDescription(scheduled.retryAt)}` : scheduled?.reason || (isDone(task) ? "This task is complete." : "Readiness will refresh with the project queue."));
    readiness.dataset.taskReadiness = scheduled?.stage || "unknown";
    if (scheduled?.reason !== workflowSummary(task, { status: state.live, backlog: state.backlog, assistant: state.assistant }).blocker) (detailPanels.details || els.detail).append(readiness);
    const message = detailMessages.get(key);
    if (message) {
      const feedback = node("p", `task-context-feedback${message.error ? " error" : ""}`, message.text);
      feedback.setAttribute("role", "status"); els.detail.insertBefore(feedback, detailPanels.details || null);
    }

    const dependencies = detailFold(task, "dependencies", `Prerequisites · ${(task.dependsOn || []).length}`);
    const dependencyLocked = Boolean(task.runId) || ["active", "running", "awaiting_verification", "verifying", "done", "archived", "completed", "absorbed"].includes(task.status);
    dependencies.append(node("p", "task-context-hint", dependencyLocked ? "Prerequisites can be changed when this task is open and has no worker. Finish the current run or reopen completed work first." : "Choose the tasks that must finish before this one can start."));
    const choices = node("div", "task-dependency-options", "");
    const chosen = dependencyDrafts.get(key) || new Set(task.dependsOn || []);
    const candidates = state.tasks.filter((item) => item.id !== task.id && (!item.projectId || !task.projectId || item.projectId === task.projectId));
    for (const id of chosen) if (!candidates.some((item) => item.id === id)) candidates.push({ id, title: `Unavailable task · ${id}`, status: "Missing" });
    for (const candidate of candidates) {
      const label = node("label", "task-dependency-option", "");
      const check = node("input", "", ""); check.type = "checkbox"; check.value = candidate.id; check.checked = chosen.has(candidate.id); check.dataset.dependencyId = candidate.id;
      check.disabled = Boolean(detailBusy) || dependencyLocked || !api?.tasksDependencies;
      check.addEventListener("change", () => {
        const draft = new Set(dependencyDrafts.get(key) || task.dependsOn || []);
        check.checked ? draft.add(candidate.id) : draft.delete(candidate.id);
        dependencyDrafts.set(key, draft);
      });
      label.append(check, node("span", "", candidate.title || candidate.id), node("small", "", isDone(candidate) ? "Done" : candidate.status || "Open"));
      choices.append(label);
    }
    if (!candidates.length) choices.append(node("p", "task-context-hint", "Add another task to this project to set a prerequisite."));
    const saveDependencies = node("button", "ghost mini", "Save prerequisites");
    saveDependencies.type = "button"; saveDependencies.dataset.taskAction = "dependencies";
    saveDependencies.disabled = Boolean(detailBusy) || dependencyLocked || !api?.tasksDependencies;
    saveDependencies.addEventListener("click", () => taskDetailAction(task, "dependencies", { dependsOn: [...(dependencyDrafts.get(key) || new Set(task.dependsOn || []))] }));
    dependencies.append(choices, saveDependencies);
    (detailPanels.details || els.detail).append(dependencies);

    const context = requestTaskContext(task);
    const handoff = detailFold(task, "handoff", "Handoff for the next worker");
    handoff.append(node("p", "task-context-hint", "The saved brief, earlier attempts, remaining work, and prerequisite results travel with this task."));
    if (context?.text) {
      handoff.append(node("pre", "task-handoff-text", context.text));
      const copy = node("button", "ghost mini", "Copy handoff");
      copy.disabled = !api?.shellCopy;
      copy.addEventListener("click", async () => { try { await api.shellCopy(context.text); copy.textContent = "Copied"; } catch { copy.textContent = "Could not copy"; } });
      handoff.append(copy);
    } else handoff.append(node("p", "task-context-hint", context?.loading ? "Loading saved context…" : context?.error || "No handoff is available yet."));
    (detailPanels.history || els.detail).append(handoff);

    const history = detailFold(task, "history", `Brief history${context?.entries.length ? ` · ${context.entries.length}${context.hasMore ? "+" : ""}` : ""}`);
    history.append(node("p", "task-context-hint", "Restore an earlier brief, references, and prerequisites. This does not change files, task status, or completion evidence."));
    for (const entry of context?.entries || []) {
      const row = node("article", "task-history-entry", ""); row.dataset.revisionId = entry.id;
      const stamp = Number.isFinite(new Date(entry.at).getTime()) ? new Date(entry.at).toLocaleString() : "Saved earlier";
      row.append(node("strong", "", `${entry.kind || "Saved brief"} · ${stamp}`));
      if (entry.note) row.append(node("p", "task-context-hint", entry.note));
      row.append(node("p", "task-history-preview", entry.snapshot?.prompt || entry.snapshot?.title || "No brief text in this revision."));
      const restore = node("button", "ghost mini", "Restore this brief");
      const restoreLocked = Boolean(task.runId || task.absorbedInto) || ["active", "running", "verifying", "awaiting_verification"].includes(task.status);
      restore.dataset.taskAction = "restore"; restore.disabled = Boolean(detailBusy) || restoreLocked || !api?.tasksRestore;
      if (restoreLocked) restore.title = "Wait for the current worker or grouped task to finish before restoring its brief.";
      restore.addEventListener("click", () => taskDetailAction(task, "restore", { revisionId: entry.id }));
      row.append(restore); history.append(row);
    }
    if (!context?.entries.length) history.append(node("p", "task-context-hint", context?.loading ? "Loading earlier briefs…" : context?.error || "Saved changes to this task will appear here."));
    if (context?.hasMore) {
      const more = node("button", "ghost mini", "Load earlier briefs");
      more.addEventListener("click", async () => {
        more.disabled = true;
        try {
          const result = await api.tasksHistory({ taskId: task.id, projectId: task.projectId || state.backlog?.projectId, before: context.nextBefore });
          if (!result?.ok) throw new Error(result?.error || "Earlier briefs could not be loaded.");
          context.entries.push(...(result.entries || [])); context.hasMore = result.hasMore === true; context.nextBefore = result.nextBefore;
          if (taskKey(selectedTask()) === key) refreshDetail();
        } catch (error) { more.textContent = error.message; more.disabled = false; }
      });
      history.append(more);
    }
    (detailPanels.history || els.detail).append(history);
  }

  // Attempt history: every run of this task from the executor ledger, so a
  // retry, a fallback or a wedged start is visible here instead of only in
  // the done log. Read-only; completion is still decided by the checks.
  const ATTEMPT_OUTCOMES = { "finished-ok": "Reported done", failed: "Failed", stopped: "Stopped", released: "Released", unrecorded: "No end recorded" };
  function requestTaskAttempts(task) {
    const api = window.mefiStudio;
    if (!api?.tasksAttempts) return null;
    const key = taskKey(task);
    const signature = JSON.stringify([task.runId, task.status, task.lastAttempt?.at, task.lastAttempt?.runId, task.updatedAt, taskRevision]);
    const prior = attemptReads.get(key);
    if (prior?.signature === signature) return prior;
    const record = { signature, loading: !prior, attempts: prior?.attempts || [], error: "" };
    attemptReads.set(key, record);
    const epoch = projectEpoch;
    Promise.resolve(api.tasksAttempts({ taskId: task.id, projectId: task.projectId || state.backlog?.projectId }))
      .then((result) => {
        if (!result?.ok) throw new Error(result?.error || "The run history could not be loaded.");
        return result;
      })
      .then((result) => { record.attempts = Array.isArray(result.attempts) ? result.attempts : []; record.error = ""; })
      .catch((error) => { record.error = error.message || "The run history could not be loaded."; })
      .finally(() => {
        if (attemptReads.get(key) !== record || epoch !== projectEpoch) return;
        record.loading = false;
        if (!els.overlay.hidden && taskKey(selectedTask()) === key) refreshDetail();
      });
    return record;
  }

  function renderTaskAttempts(task) {
    const read = requestTaskAttempts(task);
    if (!read) return;
    const key = taskKey(task);
    const fold = detailFold(task, "attempts", `Attempts${read.attempts.length ? ` · ${read.attempts.length}` : ""}`);
    fold.append(node("p", "task-context-hint", "Each run of this task: the route that ran it, how it ended, and what it said last. Completion is still decided by the checks above."));
    for (const attempt of read.attempts) {
      const live = Boolean(task.runId) && task.runId === attempt.runId && attempt.outcome === "unrecorded";
      const progress = live && task.runProgress?.runId === attempt.runId ? task.runProgress : null;
      const row = node("article", "task-history-entry", "");
      row.dataset.runId = attempt.runId;
      row.dataset.attemptOutcome = live ? "running" : attempt.outcome;
      const took = Number.isFinite(attempt.seconds) && attempt.seconds > 0 ? `${attempt.seconds < 60 ? `${attempt.seconds}s` : `${Math.round(attempt.seconds / 60)}m`}` : "";
      const route = attempt.via ? `${attempt.via}${attempt.fallbacks?.length ? " → retried on opencode" : ""}` : "";
      const percent = Number.isFinite(progress?.progress) ? ` ${Math.round(progress.progress * 100)}%` : "";
      row.append(node("strong", "", [live ? `Working now${percent}` : ATTEMPT_OUTCOMES[attempt.outcome] || "No end recorded", Number.isFinite(attempt.startedAt) ? relTime(attempt.startedAt) : "", route, took].filter(Boolean).join(" · ")));
      // The task's stage speaks for its last run only while no newer run is live.
      if (task.lastAttempt?.runId === attempt.runId && (!task.runId || task.runId === attempt.runId) && (task.verification?.state || needsReview(task) || isDone(task))) row.append(node("p", "task-context-hint", `Completion check for this run: ${describe(task).label}`));
      const why = attempt.error || (attempt.release ? `Released: ${attempt.release.reason || "the claim was dropped"}` : "") || (attempt.outcome === "unrecorded" && !live ? "The ledger has no finish for this run; it may have been cleared from the done log." : "");
      if (why) row.append(node("p", "task-context-hint", why));
      if (attempt.result) row.append(node("p", "task-history-preview", clipText(attempt.result, 400)));
      const tail = live ? (Array.isArray(progress?.outputTail) ? progress.outputTail : []) : attempt.tail || [];
      if (tail.length) {
        const said = node("details", "", "");
        const saidKey = `${key}/attempt/${attempt.runId}`;
        said.open = detailExpanded.get(saidKey) === true;
        said.addEventListener("toggle", () => detailExpanded.set(saidKey, said.open));
        said.append(node("summary", "", live ? "Latest output" : "What it said"), node("pre", "task-handoff-text", tail.join("\n")));
        row.append(said);
      }
      const sessionId = attempt.sessionId || progress?.sessionId;
      if (sessionId) {
        const open = node("button", "ghost mini", "Open session");
        open.type = "button";
        open.dataset.taskAction = "attempt-session";
        open.addEventListener("click", () => window.MefiNav?.go?.("explorer", { sessionId }));
        row.append(open);
        if (live) {
          const watch = node("button", "ghost mini", "Watch");
          watch.type = "button";
          watch.dataset.taskAction = "attempt-watch";
          watch.addEventListener("click", () => window.MefiNav?.go?.("eyes", { sessionId }));
          row.append(watch);
        }
      }
      fold.append(row);
    }
    if (!read.attempts.length) fold.append(node("p", "task-context-hint", read.loading ? "Loading run history…" : read.error || "No runs of this task are recorded yet."));
    else if (read.error) fold.append(node("p", "task-context-hint", read.error));
    (detailPanels.evidence || els.detail).append(fold);
  }

  async function appendTaskEntry(task, field, input) {
    const text = input.value.trim(), key = taskKey(task), draftKey = `${key}/${field}`;
    if (!text || entryPending.has(key)) return;
    entryDrafts.set(draftKey, input.value);
    const draft = input.value;
    const added = [...(task[field] || []), { at: Date.now(), ...(field === "logs" ? { kind: "note" } : {}), text }];
    // Pushed rows are shared with every onTasks listener: edit a copy.
    const edited = { ...task, [field]: added, updatedAt: Date.now() };
    state.tasks = state.tasks.map((item) => (item === task ? edited : item));
    entryPending.add(key);
    let error = "The task store could not be written.";
    const ok = await save((message) => { error = message; });
    entryPending.delete(key);
    if (ok) {
      if (entryDrafts.get(draftKey) === draft) entryDrafts.delete(draftKey);
      detailMessages.delete(key);
    } else {
      // A newer broadcast owns its own state. Undo only this still-local edit.
      if (state.tasks.includes(edited)) state.tasks = state.tasks.map((item) => (item === edited ? task : item));
      const message = `${field === "logs" ? "Note" : "Idea"} not saved · ${error} Your draft is still here.`;
      detailMessages.set(key, { text: message, error: true });
      window.MefiToast?.(message, "bad");
    }
    renderList();
    if (taskKey(selectedTask()) === key) renderDetail();
  }

  function renderWorkflowSummary(task) {
    const model = workflowSummary(task, { status: state.live, backlog: state.backlog, assistant: state.assistant });
    const box = node("section", "task-workflow-summary");
    box.setAttribute("aria-label", "Current task status");
    box.dataset.stage = model.stage;
    box.append(node("strong", "", model.label), node("p", "", model.action));
    const facts = node("div", "task-workflow-facts");
    for (const value of [model.worker, model.activityAge, model.checks]) if (value) facts.append(node("span", "", value));
    box.append(facts);
    if (model.blocker) {
      const scheduled = scheduledTask(task);
      const blocker = node("p", "finding", scheduled?.stage === "cooling" ? `${model.blocker}. ${retryDescription(scheduled.retryAt)}` : model.blocker);
      blocker.dataset.taskReadiness = scheduledTask(task)?.stage || "blocked";
      box.append(blocker);
    }
    box.append(node("p", "muted", model.nextAction));
    const actions = node("div", "task-workflow-actions");
    const button = (label, action, run, primary = false) => {
      const control = node("button", primary ? "primary" : "ghost mini", label);
      control.type = "button"; control.dataset.taskAction = action;
      control.addEventListener("click", run); actions.append(control); return control;
    };
    button("Home", "home", () => window.MefiNav?.go?.("workspace"));
    button("View in Live", "live", () => window.MefiNav?.go?.("command", { taskId: task.id, projectId: task.projectId || state.projectId, selected: `task:${task.id}` }));
    button("View checks", "view-checks", () => showDetailView("evidence", true), isDone(task));
    const scheduled = scheduledTask(task);
    const mayStart = !task.runId && task.status === "open" && (scheduled?.stage === "ready" || scheduled?.blockedBy === "owner");
    if (mayStart && window.MefiWorkspace?.startTask) {
      const key = taskKey(task), resume = scheduled?.blockedBy === "owner";
      const start = button(startPending.has(key) ? "Starting…" : resume ? "Resume this task" : "Start this task", "start-task", async () => {
        if (startPending.has(key)) return;
        startPending.add(key); renderDetail();
        try { await window.MefiWorkspace.startTask(task); }
        catch (error) { detailMessages.set(key, { text: error.message || "The task could not start. Try again.", error: true }); }
        finally { startPending.delete(key); if (taskKey(selectedTask()) === key) await load({ taskId: task.id }).catch(() => status("Task status could not be refreshed.", true)); }
      }, true);
      start.disabled = startPending.has(key);
    }
    if (isDone(task)) {
      const change = button("Request a change", "request-change", () => window.MefiWorkspace?.requestChange?.(task));
      change.disabled = !window.MefiWorkspace?.requestChange;
      const preview = window.MefiWorkspace?.previewStatus?.();
      if (preview && preview.projectId === (task.projectId || state.projectId)) {
        if (preview.phase === "ready") button("Open app", "open-app", () => window.MefiWorkspace?.previewAction?.("open", { projectId: preview.projectId, taskId: task.id }), true);
        else if (preview.available) {
          const start = button(preview.phase === "starting" ? "Starting preview…" : "Start preview", "start-preview", () => window.MefiWorkspace?.previewAction?.("start", { projectId: preview.projectId, taskId: task.id }));
          start.disabled = ["starting", "stopping"].includes(preview.phase);
        }
        box.append(node("p", "task-context-hint", `Project preview: ${preview.message || preview.phase}. Task checks remain separate.`));
      }
    }
    box.append(actions); els.detail.append(box);
  }

  function renderDetail() {
    paintedDetail = UNPAINTED;
    const task = selectedTask();
    // Broadcasts and async context reads rebuild this pane even while paused.
    // Draft values alone cannot preserve a click that happened before typing.
    const focused = document.activeElement;
    const focusedEntry = ["logs", "ideas"].find((field) => focused?.dataset?.taskEntryKey === `${taskKey(task)}/${field}`);
    const selection = focusedEntry ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection } : null;
    if (els.overviewBack) els.overviewBack.hidden = !task;
    els.detail.textContent = "";
    detailPanels = {};
    els.statusRow.textContent = "";
    renderTitle(task);
    if (!task) {
      const hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent = "Pick a task on the left, or add one — reference gathering can attach exact context automatically.";
      els.detail.append(hint);
      showDetailView("details");
      return;
    }
    projectSelections.set(state.projectId, task.id);
    window.MefiNav?.selectTask?.({ taskId: task.id, projectId: task.projectId || state.projectId, title: shortTitle(task) });
    renderWorkflowSummary(task);
    for (const name of detailViewNames) {
      const panel = node("section", "surface-tab-panel task-detail-panel");
      panel.id = `task-panel-${name}`;
      panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", `task-tab-${name}`);
      detailPanels[name] = panel; els.detail.append(panel);
    }
    let body = detailPanels.details;
    const meta = document.createElement("p");
    meta.className = "muted who task-meta";
    meta.textContent = metaLine(task);
    body.append(meta);
    if (task.planningId) {
      const origin = node("button", "ghost mini", "View approved plan");
      origin.type = "button";
      origin.dataset.taskAction = "view-plan";
      origin.addEventListener("click", () => window.MefiNav?.go?.("plans", { planId: task.planningId }));
      body.append(origin);
    }
    // An owner hold's reason (and its remedy) is the readiness line below, so
    // it is not repeated up here.
    if (needsReview(task) && !ownerHold(task)) {
      const review = document.createElement("p");
      review.className = "finding";
      review.textContent = `${describe(task).label}: ${describe(task).summary}`;
      body.append(review);
    }
    for (const action of statusActions(task)) {
      const button = document.createElement("button");
      button.className = action.className;
      button.textContent = action.label;
      button.title = action.title ?? "";
      if (action.action) button.dataset.taskAction = action.action;
      button.disabled = Boolean(detailBusy) || Boolean(action.disabled) || Boolean(task.runId && !action.allowDuringRun);
      button.addEventListener("click", action.run);
      els.statusRow.append(button);
    }
    // A task that failed under the autopilot explains why it is sitting out —
    // the backoff (or the give-up) instead of looking like a stalled open one.
    if (!isDone(task) && (task.lastRunError || task.nextRunAt || (task.runFailures ?? 0) >= 5)) {
      const note = document.createElement("div");
      note.className = "muted";
      const retryIn = task.nextRunAt && task.nextRunAt > Date.now() ? ` · retries in ${Math.ceil((task.nextRunAt - Date.now()) / 60000)}m` : "";
      const gaveUp = (task.runFailures ?? 0) >= 5 ? " · automatic attempts paused; review the error and choose Retry" : "";
      note.textContent = `autopilot: last run failed (${task.lastRunError ?? "?"})${retryIn}${gaveUp}`;
      body.append(note);
    }
    if (isDone(task)) {
      const block = document.createElement("div");
      block.className = "finding";
      block.append(Object.assign(document.createElement("span"), { className: `src-tag ${task.status === "archived" ? "stale" : "tidy"}`, textContent: task.status.toUpperCase() }));
      block.append(Object.assign(document.createElement("span"), { className: "grow", textContent: ` ${doneSummary(task)}` }));
      const copy = document.createElement("button");
      copy.className = "ghost mini";
      copy.textContent = "Copy";
      copy.title = "Copy the done summary";
      copy.addEventListener("click", () => {
        window.mefiStudio?.shellCopy?.(`${task.title} — ${doneSummary(task)}`);
        copy.textContent = "Copied";
        setTimeout(() => {
          copy.textContent = "Copy";
        }, 1200);
      });
      block.append(copy);
      body.append(block);
    }
    if (scheduledTask(task)?.stage === "approval") {
      body.append(node("p", "finding", "Verify first is on. Review this brief and its prerequisites, then choose Approve build. Leave this task here to decide later, or Delete to discard it. Approval keeps any scheduling pause in place."));
      body.append(node("h4", "", "Build brief to review"));
      const files = [...new Set([task.file, ...(Array.isArray(task.files) ? task.files : [])].filter(Boolean))];
      if (files.length) body.append(node("p", "task-context-hint", `Files in scope: ${files.join(", ")}`));
      if (task.dependsOn?.length) body.append(node("p", "task-context-hint", `Prerequisites: ${task.dependsOn.map((id) => state.tasks.find((item) => item.id === id)?.title || id).join(", ")}`));
    }
    // The brief, unless it only repeats the heading above it.
    const brief = String(task.prompt || task.title || "");
    if (brief.trim() && brief.trim() !== shortTitle(task).trim()) {
      const prompt = document.createElement("p");
      prompt.className = "muted";
      prompt.style.whiteSpace = "pre-wrap";
      prompt.textContent = brief;
      body.append(prompt);
    }
    renderTaskDelegation(task);
    renderTaskContext(task);

    const section = (heading) => {
      const h = document.createElement("h4");
      h.textContent = heading;
      body.append(h);
    };
    const entryList = (items, render) => {
      const ul = document.createElement("ul");
      if (!items.length) {
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = "empty";
        ul.append(li);
      }
      for (const item of items) ul.append(render(item));
      body.append(ul);
    };
    body = detailPanels.evidence;
    if (task.lastAttempt || task.verification || task.verificationRun) {
      section("Result & completion checks");
      const attempt = task.lastAttempt ?? {};
      const evidence = task.verification;
      const outcome = document.createElement("p");
      outcome.className = "muted";
      outcome.textContent = evidence?.state === "manual" ? "You marked this task done." : evidence?.state === "verified" ? `Completion accepted: ${evidence.reason || "checks passed"}` : describe(task).summary;
      body.append(outcome);
      const parts = attempt.result?.parts ?? attempt.result;
      const resultLines = parts && typeof parts === "object" ? Object.entries(parts).filter(([key]) => key !== "raw").map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join("; ") : String(value)}`) : [];
      if (resultLines.length) entryList(resultLines, (line) => Object.assign(document.createElement("li"), { textContent: `Worker reported — ${line}` }));
      if (Number.isFinite(evidence?.changedFiles)) {
        const files = document.createElement("p");
        files.className = "who";
        files.textContent = `${evidence.changedFiles} changed file${evidence.changedFiles === 1 ? "" : "s"} observed${attempt.sessionId ? " in the worker's session" : ""}.`;
        body.append(files);
      }
      // The overseer's own check run: the card's only record of it (the log
      // no longer carries "verification scheduled/passed/failed" lines).
      const run = task.verificationRun;
      if (run?.state) {
        const commands = Array.isArray(run.commands) ? run.commands.filter(Boolean).map(String) : [];
        const failed = Array.isArray(run.results) ? run.results.find((row) => row && !row.ok) : null;
        const check = document.createElement("p");
        check.className = "who";
        check.textContent = `Overseer check${commands.length ? ` (${commands.join(" && ")})` : ""}: ${run.state}${Number.isFinite(run.at) ? ` ${relTime(run.at)}` : ""}${failed?.tail ? ` — ${clipText(failed.tail, 200)}` : ""}`;
        body.append(check);
        const locations = Array.isArray(run.results) ? run.results.filter((row) => typeof row?.cwd === "string" && row.cwd.trim()) : [];
        if (locations.length) entryList(locations, (row) => Object.assign(document.createElement("li"), {
          textContent: `${row.command ? `${String(row.command)} — ` : ""}Location: ${row.cwd}`,
        }));
      }
      if (Array.isArray(task.remaining) && task.remaining.length) {
        section("Follow-up work");
        entryList(task.remaining, (line) => Object.assign(document.createElement("li"), { textContent: String(line) }));
      }
    }
    renderTaskAttempts(task);
    if (!body.children.length) body.append(node("p", "muted", "Evidence appears here after a worker runs and completion checks finish."));
    body = detailPanels.history;
    section(`Log (${(task.logs ?? []).length})`);
    entryList(task.logs ?? [], (log) => Object.assign(document.createElement("li"), { textContent: `[${new Date(log.at).toLocaleTimeString()}] ${log.text}` }));
    const logRow = document.createElement("div");
    logRow.className = "row tight";
    const logInput = document.createElement("input");
    logInput.dataset.taskEntryKey = `${taskKey(task)}/logs`;
    logInput.placeholder = "Log a note…";
    logInput.className = "grow";
    logInput.value = entryDrafts.get(`${taskKey(task)}/logs`) || "";
    logInput.addEventListener("input", () => entryDrafts.set(`${taskKey(task)}/logs`, logInput.value));
    const logAdd = document.createElement("button");
    logAdd.className = "ghost";
    logAdd.textContent = "Log";
    logAdd.disabled = entryPending.has(taskKey(task));
    logAdd.addEventListener("click", () => appendTaskEntry(task, "logs", logInput));
    logRow.append(logInput, logAdd);
    body.append(logRow);

    section(`Thoughts / ideas (${(task.ideas ?? []).length})`);
    entryList(task.ideas ?? [], (idea) => Object.assign(document.createElement("li"), { textContent: typeof idea === "string" ? `Linked idea: ${idea}` : `[${new Date(idea.at).toLocaleTimeString()}] ${idea.text}` }));
    const ideaRow = document.createElement("div");
    ideaRow.className = "row tight";
    const ideaInput = document.createElement("input");
    ideaInput.dataset.taskEntryKey = `${taskKey(task)}/ideas`;
    ideaInput.placeholder = "Capture an idea for this task…";
    ideaInput.className = "grow";
    ideaInput.value = entryDrafts.get(`${taskKey(task)}/ideas`) || "";
    ideaInput.addEventListener("input", () => entryDrafts.set(`${taskKey(task)}/ideas`, ideaInput.value));
    const ideaAdd = document.createElement("button");
    ideaAdd.className = "ghost";
    ideaAdd.textContent = "Add idea";
    ideaAdd.disabled = entryPending.has(taskKey(task));
    ideaAdd.addEventListener("click", () => appendTaskEntry(task, "ideas", ideaInput));
    ideaRow.append(ideaInput, ideaAdd);
    body.append(ideaRow);

    body = detailPanels.references;
    section(`References (${(task.refs ?? []).length})`);
    entryList(task.refs ?? [], (ref) => {
      const li = document.createElement("li");
      li.textContent = `${ref.kind}: ${ref.title}`;
      li.title = ref.detail ?? "";
      return li;
    });
    showDetailView(detailViews.get(taskKey(task)) || "details");
    if (focusedEntry) {
      const input = focusedEntry === "logs" ? logInput : ideaInput;
      input.focus({ preventScroll: true });
      if (Number.isInteger(selection.start) && Number.isInteger(selection.end)) input.setSelectionRange(selection.start, selection.end, selection.direction);
    }
  }

  // ---------- reference menu ----------
  function clearNode(node) {
    node.textContent = "";
    return node;
  }

  function group(headingText, node, items, render) {
    const h = document.createElement("h4");
    h.textContent = `${headingText} (${items.length})`;
    node.append(h);
    const ul = document.createElement("ul");
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "none";
      ul.append(li);
    }
    for (const item of items) ul.append(render(item));
    node.append(ul);
  }

  function renderReferences(result) {
    const out = clearNode(els.referenceOut);
    if (!result) return;
    const verdict = document.createElement("div");
    verdict.className = "finding";
    verdict.append(Object.assign(document.createElement("span"), { className: "src-tag improver", textContent: "VERDICT" }));
    verdict.append(Object.assign(document.createElement("span"), { textContent: ` ${result.verdict} · ${result.coverage}% coverage · ${result.files.length} files` }));
    out.append(verdict);
    group("Code", out, result.code ?? [], (hit) => {
      const li = document.createElement("li");
      li.textContent = `${hit.file}:${hit.line || 1} — ${hit.snippet}`;
      li.title = hit.snippet;
      return li;
    });
    group("Node-tree sessions", out, result.sessions ?? [], (session) => {
      const li = document.createElement("li");
      li.append(Object.assign(document.createElement("span"), { className: "src-tag", textContent: session.agent ?? "session" }));
      li.append(document.createTextNode(` ${session.title}`));
      return li;
    });
    group("Chats", out, (result.chats ?? []).slice(0, 6), (chat) => Object.assign(document.createElement("li"), { textContent: chat.text.slice(0, 140) }));
    group("PNG evidence", out, result.pngs ?? [], (png) => {
      const li = document.createElement("li");
      const img = document.createElement("img");
      img.src = encodeURI("file:///" + png.path.replace(/\\/g, "/"));
      img.alt = png.name;
      img.style.maxWidth = "100%";
      img.style.borderRadius = "8px";
      img.style.marginTop = "4px";
      li.append(document.createElement("div"), Object.assign(document.createElement("span"), { textContent: png.name }), img);
      return li;
    });
    group("Web", out, result.web ?? [], (hit) => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = hit.title;
      link.title = hit.snippet ?? "";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        window.mefiStudio?.openExternal?.(hit.url);
      });
      li.append(link);
      return li;
    });
    group("Matching ideas", out, result.ideas ?? [], (idea) => Object.assign(document.createElement("li"), { textContent: `[${idea.status ?? "new"}] ${idea.title ?? idea.detail}` }));
  }

  async function gather() {
    const taskId = selectedTask()?.id ?? null;
    const text = taskId ? `${selectedTask().title}. ${selectedTask().prompt ?? ""}` : els.newInput.value.trim();
    if (!text) {
      status("select or type a task first", true);
      return;
    }
    if (state.prefs.useReference === false) {
      status("reference is off (enable Use reference)", true);
      return;
    }
    status("gathering references…");
    // taskId rides along so a gather the assistant journals and restarts after
    // a close can still attach its refs to the right task.
    const result = await window.mefiStudio?.referenceGather?.({
      text,
      taskId,
      useWeb: Boolean(state.prefs.useWeb),
      useTree: state.prefs.useTree !== false,
    });
    if (!result?.ok) {
      status(result?.error ?? "reference failed", true);
      return;
    }
    state.references = result.references;
    renderReferences(result.references);
    // The save broadcast replaces state.tasks with IPC clones, so re-resolve
    // the task instead of trusting a reference captured before the awaits.
    const task = taskId ? state.tasks.find((item) => item.id === taskId) : null;
    if (task) {
      // Pushed rows are shared with every onTasks listener: edit a copy.
      const edited = {
        ...task,
        refs: [
          ...(task.refs ?? []),
          ...(result.references.files ?? []).slice(0, 6).map((file) => ({ kind: "file", title: file, detail: "work tree" })),
          ...(result.references.sessions ?? []).slice(0, 4).map((session) => ({ kind: "session", title: session.title, detail: session.id })),
          ...(result.references.web ?? []).slice(0, 4).map((hit) => ({ kind: "web", title: hit.title, detail: hit.url })),
        ].slice(-40),
        logs: [...(task.logs ?? []), { at: Date.now(), kind: "reference", text: `gathered ${result.references.code.length} code hits, ${result.references.sessions.length} sessions, ${result.references.chats.length} chats` }],
        updatedAt: Date.now(),
      };
      state.tasks = state.tasks.map((item) => (item === task ? edited : item));
      let error = "The task store could not be written.";
      if (!(await save((message) => { error = message; }))) {
        if (state.tasks.includes(edited)) state.tasks = state.tasks.map((item) => (item === edited ? task : item));
        const message = `References found, but not saved to the task · ${error}`;
        status(message, true);
        detailMessages.set(taskKey(task), { text: message, error: true });
        window.MefiToast?.(message, "bad");
        renderList(); renderDetail();
        return;
      }
      renderList();
      renderDetail();
    }
    status(`references gathered · ${result.references.code.length} code · ${result.references.sessions.length} sessions · ${result.references.web.length} web`);
    window.MefiToast?.(`References gathered · ${result.references.code.length} code hits, ${result.references.sessions.length} sessions`, "good");
  }

  async function addTask(text) {
    if (!text?.trim()) return null;
    const epoch = projectEpoch;
    await hydrate();
    if (epoch !== projectEpoch) return null;
    // An unread store cannot take the write, so the task would only live in
    // memory until the next load: say so instead of reporting it created.
    if (!hydrated) {
      window.MefiToast?.("Task not saved · the task store could not be read", "bad");
      return null;
    }
    if (window.mefiStudio?.tasksCreate) {
      const projectId = state.projectId || state.backlog?.projectId;
      const revision = taskRevision;
      try {
        const result = await window.mefiStudio.tasksCreate({ title: text.trim().split("\n")[0].slice(0, 180), prompt: text.trim(), ...(projectId ? { projectId } : {}) });
        if (!result?.ok || !result.task) throw new Error(result?.error || "The task could not be created.");
        if (epoch !== projectEpoch || (projectId && result.projectId && projectId !== result.projectId)) return result.task;
        if (revision === taskRevision && Array.isArray(result.tasks)) state.tasks = result.tasks;
        else if (!state.tasks.some((task) => task.id === result.task.id)) state.tasks = [result.task, ...state.tasks];
        taskRevision += 1;
        state.selected = result.task.id;
        state.readiness = "all";
        state.filter = "all";
        state.query = "";
        if (els.search) els.search.value = "";
        syncBadge(); renderList(); renderDetail(); revealSelected();
        const message = `Task created · ${state.backlog?.paused ? "queued until you resume" : "added to the project queue"}`;
        status(message, false);
        window.MefiToast?.(message, "good");
        announce("mefi:task-created", { taskId: result.task.id, projectId: result.task.projectId || projectId || null });
        return result.task;
      } catch (error) {
        if (epoch === projectEpoch) {
          status(`Task not saved · ${error.message}`, true);
          window.MefiToast?.(`Task not saved · ${error.message}`, "bad");
        }
        return null;
      }
    }
    // New work enters through tasks:create, the host's one admission path (it
    // dedupes the brief and owns the card's fields); tasks:save no longer
    // creates cards, so a bridge without tasks:create cannot add one.
    status("Task not saved · this view cannot add tasks", true);
    window.MefiToast?.("Task not saved · this view cannot add tasks", "bad");
    return null;
  }

  function open(options) {
    window.MefiNav?.claim?.("tasks");
    const params = optionsOf(options);
    els.overlay.hidden = false;
    // Set the selection before load() so the first render already shows it.
    // A link that names another project never selects a same-id task here.
    const elsewhere = typeof params.projectId === "string" && params.projectId && state.projectId && params.projectId !== state.projectId;
    if (typeof params.taskId === "string" && params.taskId && !elsewhere) state.selected = params.taskId;
    return load({ ...params, restoreSelection: !params.filter && !params.readiness })
      .then(() => {
        if (typeof params.projectId === "string" && params.projectId && state.projectId && params.projectId !== state.projectId) {
          if (!elsewhere && state.selected === params.taskId) { state.selected = null; renderList(); renderDetail(); }
          status("That task belongs to another project. Switch projects to open it.", true);
          return;
        }
        const task = params.taskId ? selectedTask() : null;
        if (task) announce("mefi:task-opened", { taskId: task.id, projectId: task.projectId || state.projectId || null, status: task.status || null });
        revealSelected();
        if (detailViewNames.includes(params.panel)) showDetailView(params.panel);
        if (params.gather) { showDetailView("references"); gather(); }
        if (task) focusNarrowDetail();
      })
      .catch(() => status("tasks unavailable · the store could not be read", true));
  }

  function close() {
    if (els.overlay.hidden) return;
    els.overlay.hidden = true;
    window.MefiNav?.release?.("tasks");
  }

  function init() {
    if (initialized) return;
    initialized = true;
    for (const [index, name] of detailViewNames.entries()) {
      const tab = document.getElementById(`task-tab-${name}`);
      tab?.addEventListener("click", () => showDetailView(name));
      tab?.addEventListener("keydown", (event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % detailViewNames.length : event.key === "ArrowLeft" ? (index + detailViewNames.length - 1) % detailViewNames.length : event.key === "Home" ? 0 : event.key === "End" ? detailViewNames.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); showDetailView(detailViewNames[next], true);
      });
    }

    Promise.resolve(window.mefiStudio?.prefsGet?.()).then((result) => {
      if (result?.ok && typeof result.prefs?.blurMenu === "boolean") applyBlur(result.prefs.blurMenu);
    }).catch(() => {});
    for (const [key, id] of Object.entries({
      overlay: "tasks-overlay",
      list: "task-list",
      newInput: "task-new",
      search: "task-search",
      add: "task-add",
      title: "task-title",
      statusRow: "task-status-row",
      detail: "task-detail",
      referenceOut: "reference-out",
      status: "reference-status",
      gather: "reference-run",
      prefReference: "pref-reference",
      prefWeb: "pref-web",
      prefTree: "pref-tree",
      prefBlur: "pref-blur",
      prefAuto: "pref-auto",
      close: "tasks-close",
      overhead: "tasks-overhead",
      openButton: "tasks-open",
      filters: "task-filters",
      overviewBack: "task-overview-back",
    })) {
      els[key] = document.getElementById(id);
    }
    if (els.filters && !els.filters.querySelector('[data-filter="review"]')) {
      const review = document.createElement("button");
      review.id = "task-filter-review";
      review.className = "chip";
      review.dataset.filter = "review";
      review.textContent = "Review · 0";
      review.title = "Finished runs awaiting checks and attempts needing attention";
      els.filters.insertBefore(review, els.filters.querySelector('[data-filter="done"]'));
    }
    if (els.filters) {
      const select = document.createElement("select");
      select.className = "task-readiness-filter";
      select.setAttribute("aria-label", "Filter tasks by scheduling state");
      for (const [value, label] of Object.entries(READINESS_FILTERS)) {
        const option = node("option", "", label); option.value = value; select.append(option);
      }
      select.addEventListener("change", () => {
        state.readiness = Object.hasOwn(READINESS_FILTERS, select.value) ? select.value : "all";
        state.filter = "all";
        state.selected = null;
        setPref("taskFilter", "all");
        renderList(); renderDetail();
      });
      els.filters.append(select); els.readinessFilter = select;
    }
    els.openButton?.addEventListener("click", open);
    els.overviewBack?.addEventListener("click", () => { state.selected = null; renderList(); renderDetail(); els.newInput?.focus?.({ preventScroll: true }); });
    els.close?.addEventListener("click", () => window.MefiNav?.close ? window.MefiNav.close("tasks") : close());
    els.overlay?.addEventListener("click", (event) => {
      if (event.target === els.overlay) close();
    });
    els.add?.addEventListener("click", async () => {
      const text = els.newInput.value;
      if (!text.trim() || createPending) return;
      const epoch = projectEpoch, projectId = state.projectId || "";
      createDrafts.set(projectId, text);
      createPending = true; els.add.disabled = true; els.add.setAttribute("aria-busy", "true");
      try {
        // Explicit Add always creates a durable task, even for a question-shaped
        // brief. The host captures its project and respects Pause when scheduling.
        const task = await addTask(text);
        if (task && createDrafts.get(projectId) === text) createDrafts.delete(projectId);
        if (epoch === projectEpoch && task && els.newInput.value === text) els.newInput.value = "";
      } finally {
        createPending = false; els.add.disabled = false; els.add.setAttribute("aria-busy", "false");
      }
    });
    els.newInput?.addEventListener("input", () => createDrafts.set(state.projectId || "", els.newInput.value));
    els.newInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") els.add.click();
    });
    els.search?.addEventListener("input", () => {
      state.query = els.search.value;
      renderList();
    });
    els.gather?.addEventListener("click", gather);
    els.filters?.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-filter]");
      if (!chip || !FILTERS.includes(chip.dataset.filter)) return;
      selectFilter(chip.dataset.filter);
    });
    // The single owner of #tasks-overhead; overhead.js no longer binds it too.
    els.overhead?.addEventListener("click", () => {
      if (window.MefiNav) window.MefiNav.go("overhead");
      else window.MefiOverhead?.open();
    });
    for (const [key, element] of [["useReference", els.prefReference], ["useWeb", els.prefWeb], ["useTree", els.prefTree], ["blurMenu", els.prefBlur], ["autoReference", els.prefAuto]]) {
      element?.addEventListener("change", () => setPref(key, element.checked));
    }
    window.mefiStudio?.onTasks?.((tasks) => {
      if (!Array.isArray(tasks)) return;
      if (state.projectId && tasks.some((task) => task.projectId && task.projectId !== state.projectId)) return;
      taskRevision += 1;
      state.tasks = tasks;
      hydrated = true;
      syncBadge();
      if (!els.overlay.hidden) {
        const task = selectedTask();
        if (task && state.filter !== "all" && taskStage(task) !== state.filter) {
          state.filter = taskStage(task);
          setPref("taskFilter", state.filter);
        }
        schedulePushPaint();
        readBacklogSoon();
      }
    });
    window.mefiStudio?.onProjects?.((result) => {
      if (!result?.activeId || result.activeId === state.projectId) return;
      createDrafts.set(state.projectId || "", els.newInput?.value || "");
      projectEpoch += 1; taskRevision += 1; backlogRead += 1; plansRead += 1; liveRevision += 1; assistantRevision += 1;
      if (state.selected) projectSelections.set(state.projectId, state.selected);
      state.projectId = result.activeId; state.tasks = []; state.plans = []; state.plansError = null; state.selected = projectSelections.get(result.activeId) || null; state.backlog = null; state.live = {}; state.assistant = {};
      overviewExpanded.clear();
      state.readiness = "all"; state.query = ""; hydrated = false; hydrating = null;
      status("", false);
      if (els.search) els.search.value = "";
      if (els.newInput) els.newInput.value = createDrafts.get(state.projectId) || "";
      syncBadge(); renderList(); renderDetail();
      if (!els.overlay.hidden) load().catch(() => status("Task status could not be refreshed.", true));
    });
    window.mefiStudio?.onAssistantStatus?.((live) => {
      if (live?.projectId && live.projectId !== state.projectId) return;
      liveRevision += 1;
      state.live = live || {};
      if (!els.overlay.hidden) renderDetail();
    });
    window.mefiStudio?.onAssistant?.((payload) => {
      const assistant = payload?.state;
      if (!assistant || assistant.projectId && assistant.projectId !== state.projectId) return;
      assistantRevision += 1;
      state.assistant = assistant;
      if (!els.overlay.hidden) renderDetail();
    });
    window.addEventListener?.("mefi:project-preview", () => { if (!els.overlay.hidden) renderDetail(); });
    // A quiet backstop poll: the onTasks push above carries live updates in
    // the desktop app, and the browser fallback has none. boot.js's shared
    // guard clears the interval the moment the window hides and restarts it
    // when it shows, so hide/show toggles never stack intervals; the
    // visibilitychange listener still reloads the board the moment the window
    // is shown instead of waiting out the interval.
    const tasksTick = () => {
      if (!window.mefiStudio?.tasksList) return;
      if (!document.hidden && !els.overlay.hidden) load();
    };
    if (window.MefiBoot?.pollStart) window.MefiBoot.pollStart("tasks.board", tasksTick, TASKS_POLL_MS);
    else setInterval(tasksTick, TASKS_POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !els.overlay.hidden) tasksTick();
    });
  }

  window.MefiTasks = {
    init,
    open,
    close,
    addTask,
    state,
    describe,
    shortTitle,
    workflowSummary,
    summary,
    // What a live-update reload hands back to open(): the task on screen.
    saveState: () => ({ taskId: state.selected ?? null, projectId: state.projectId, filter: state.filter, readiness: state.readiness, panel: detailViews.get(taskKey(selectedTask())) || "details" }),
    selectTask: (id) => {
      state.selected = id;
      state.readiness = "all";
      const task = selectedTask();
      if (task) announce("mefi:task-opened", { taskId: task.id, projectId: task.projectId || state.projectId || null, status: task.status || null });
      if (task && state.filter !== "all" && taskStage(task) !== state.filter) state.filter = taskStage(task);
      state.query = "";
      if (els.search) els.search.value = "";
      renderList();
      renderDetail();
      revealSelected();
      focusNarrowDetail();
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
