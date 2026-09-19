// Mefi's Studio AI+ — Tasks: board, per-task logs/ideas, and the reference menu.
(function () {
  "use strict";

  const COLORS = ["#e6c98d", "#9db7ff", "#57ff9a", "#f2a2e8", "#ffb38a", "#86d1d6", "#c9a8ff", "#ffd479"];
  const FILTERS = ["all", "open", "review", "done"];
  // A row that just finished pulses green for a few seconds — the board's
  // echo of the constellation's done pulse — before it settles under the mark.
  const DONE_PULSE_MS = 15000;
  // Board refresh cadence while the sheet is open. The interval itself stops
  // while the window hides (boot.js's shared poll guard) and restarts when it
  // shows, and the tick bails while hidden or while the sheet is closed, so a
  // hidden app issues no store reads.
  const TASKS_POLL_MS = 15000;
  const state = { tasks: [], selected: null, filter: "all", query: "", doneCollapsed: false, renaming: false, prefs: { blurMenu: true, useWeb: false, useTree: true, autoReference: true, useReference: true }, references: null };
  // Two-step delete: the id of the task whose Delete button is armed right now.
  let deleteArmed = null;
  const els = {};
  let initialized = false;
  // tasks:save overwrites the whole store, so this module must never write a
  // list it has not read: nothing saves until a load (or a broadcast) landed.
  let hydrated = false;
  let hydrating = null;
  let taskRevision = 0;

  const base = (file) => (file ? file.split(/[\\/]/).pop() : "(unknown)");
  const status = (text, isError) => {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.style.color = isError ? "var(--bad)" : "";
  };
  // Resolves false when nothing reached the store.
  const save = async () => {
    if (!hydrated) return false;
    taskRevision += 1;
    try {
      const result = await window.mefiStudio?.tasksSave?.(state.tasks);
      return result?.ok === true;
    } catch {
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
  const needsReview = (task) => !isDone(task) && task?.status !== "active" && (
    task?.status === "awaiting_verification" || task?.status === "verifying" ||
    ["unverified", "failed"].includes(task?.verification?.state) || (task?.runFailures ?? 0) >= 5
  );
  const taskStage = (task) => isDone(task) ? "done" : needsReview(task) ? "review" : "open";
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
    if (completed.length) parts.push(completed.map((item) => clipText(item, 140)).filter(Boolean).join("; "));
    if (task.verification?.reason) parts.push(clipText(task.verification.reason, 180));
    const took = span(doneStamp(task) - (task.createdAt ?? 0));
    if (took) parts.push(`took ${took}`);
    // Status churn (created / marked done / archived / reopened) is bookkeeping,
    // not "what was done" — the kind tag hides it, the regex catches old rows.
    const logs = (task.logs ?? [])
      .filter((log) => log?.kind !== "status")
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
    if (stage === "done") return { stage, label: task.status === "archived" ? "Archived" : "Done", summary: doneSummary(task) };
    if (task?.status === "awaiting_verification" || task?.status === "verifying") {
      return { stage, label: "Checking completion", summary: "The worker finished. Completion checks are pending; this work is not marked done yet." };
    }
    if (stage === "review") return { stage, label: "Needs review", summary: task?.verification?.reason || task?.lastRunError || "The last attempt could not be confirmed. Review its result before retrying or marking it done." };
    return { stage, label: task?.status === "active" ? "Working" : "Open", summary: task?.lastRunError || task?.prompt || "Ready for the assistant." };
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
  }

  function mutedLi(text) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = text;
    return li;
  }

  function emptyListMessage(finishedCount) {
    if (state.query.trim()) return `No tasks match “${state.query.trim()}”.`;
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
    dot.textContent = needsReview(task) ? "REVIEW" : String(task.status ?? "open").toUpperCase();
    const text = document.createElement("span");
    text.className = "task-name";
    text.textContent = ` ${task.title}`;
    text.append(Object.assign(document.createElement("span"), { className: "who", textContent: ` ${task.refs?.length ? `· ${task.refs.length} refs` : ""}${task.logs?.length ? ` · ${task.logs.length} logs` : ""}${isDone(task) && state.filter !== "done" ? ` · done ${relTime(doneStamp(task))}` : ""}` }));
    // One-click finish (or reopen) without leaving the board.
    const actions = document.createElement("span");
    actions.className = "row-actions";
    if (isDone(task)) actions.append(rowButton("↺", "Reopen — back to the open board", () => setTaskStatus(task, "open")));
    else actions.append(rowButton("✓", "Mark done — moves it under the Done mark", () => setTaskStatus(task, "done")));
    li.append(dot, text, actions);
    // The brief rides under the title in the Done view — the same digest the
    // detail pane shows, so the list answers "what got done" at a glance.
    if (isDone(task) || needsReview(task)) {
      const brief = document.createElement("div");
      brief.className = "who done-brief";
      brief.textContent = describe(task).summary;
      brief.title = task.prompt ?? task.title;
      li.append(brief);
    }
    // Focusable because nav's claim() may focus a row in this list.
    li.tabIndex = 0;
    li.addEventListener("click", () => {
      state.selected = task.id;
      renderList();
      renderDetail();
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
    els.list.textContent = "";
    renderFilters();
    // A selected done task must be visible, so unfold the mark it lives under.
    const selected = selectedTask();
    if (selected && isDone(selected)) state.doneCollapsed = false;
    const visible = state.tasks.filter(matchesQuery);
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

  async function load(options = {}) {
    const revision = taskRevision;
    const [tasks, prefs] = await Promise.all([window.mefiStudio?.tasksList?.(), window.mefiStudio?.prefsGet?.()]);
    if (tasks?.ok === false || !Array.isArray(tasks?.tasks)) throw new Error(tasks?.error || "Task store unavailable");
    // A completion broadcast may arrive while preferences are still loading.
    // Never replace that newer board with the earlier read's snapshot.
    if (revision === taskRevision) state.tasks = tasks.tasks;
    hydrated = true;
    if (prefs?.ok) state.prefs = { ...state.prefs, ...prefs.prefs };
    state.filter = FILTERS.includes(options.filter) ? options.filter : revision === taskRevision && FILTERS.includes(prefs?.prefs?.taskFilter) ? prefs.prefs.taskFilter : state.filter;
    if (options.taskId) {
      const task = selectedTask();
      if (task && state.filter !== "all" && taskStage(task) !== state.filter) state.filter = taskStage(task);
      state.query = "";
      if (els.search) els.search.value = "";
    }
    if (FILTERS.includes(options.filter) || options.taskId) setPref("taskFilter", state.filter);
    syncBadge();
    renderFilters();
    renderList();
    renderDetail();
    applyPrefs();
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
  }

  function setPref(key, value) {
    state.prefs[key] = value;
    Promise.resolve(window.mefiStudio?.prefsSet?.({ [key]: value })).then(applyPrefs).catch(() => {});
  }

  function selectFilter(filter) {
    if (!FILTERS.includes(filter)) return;
    state.filter = filter;
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
    save().then((ok) => {
      if (!ok) {
        // Put it back rather than pretend the delete landed.
        state.tasks.splice(Math.min(Math.max(index, 0), state.tasks.length), 0, task);
        syncBadge();
        renderList();
        renderDetail();
        window.MefiToast?.("Task not deleted · the task store could not be written", "bad");
        return;
      }
      window.MefiToast?.(`Task deleted · ${task.title}`, "good");
    });
  }

  const SOURCE_LABELS = { "a-eyes": "A-Eyes", chat: "chat", overseer: "overseer", manual: "added by hand" };

  function metaLine(task) {
    const parts = [];
    if (task.status === "awaiting_verification") {
      parts.push("run finished — awaiting verification");
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
    if (SOURCE_LABELS[task.source]) parts.push(`from ${SOURCE_LABELS[task.source]}`);
    return parts.join(" · ");
  }

  // Verb-first actions: the common move (finish / reopen) is the one big
  // button, and the rarer moves sit beside it as ghosts.
  function statusActions(task) {
    const actions = [];
    if (isDone(task)) {
      actions.push({ label: "Reopen", className: "primary", title: "Put this task back on the open board", run: () => setTaskStatus(task, "open") });
    } else {
      actions.push({ label: needsReview(task) ? "Confirm done" : "Mark done", className: "primary", title: "Mark this task complete after reviewing its result", run: () => setTaskStatus(task, "done") });
    }
    if (needsReview(task)) actions.push({ label: "Retry", className: "ghost", title: "Return this task to the queue for another attempt", run: () => {
      delete task.verification;
      delete task.verifyAttempts;
      setTaskStatus(task, "open");
    } });
    if (task.status === "open") actions.push({ label: "Activate", className: "ghost", title: "Set active — the executor treats it as current work", run: () => setTaskStatus(task, "active") });
    if (task.status === "active") actions.push({ label: "Back to open", className: "ghost", title: "Release the active claim", run: () => setTaskStatus(task, "open") });
    if (task.status === "absorbed") actions.push({ label: "Restore", className: "ghost", title: "Pull this task out of the grouped plan and back onto the open board", run: () => setTaskStatus(task, "open") });
    if (task.status === "done") actions.push({ label: "Archive", className: "ghost", title: "Shelve the finished task", run: () => setTaskStatus(task, "archived") });
    if (task.status === "archived") actions.push({ label: "Mark done", className: "ghost", title: "Back to done, still under the Done mark", run: () => setTaskStatus(task, "done") });
    actions.push({
      label: "Rename",
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
      className: armed ? "ghost mini danger-armed" : "ghost mini",
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
      els.title.textContent = task.title;
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
        task.title = value.slice(0, 90);
        task.updatedAt = Date.now();
        save();
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

  function renderDetail() {
    const task = selectedTask();
    els.detail.textContent = "";
    els.statusRow.textContent = "";
    renderTitle(task);
    if (!task) {
      const hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent = "Pick a task on the left, or add one — reference gathering can attach exact context automatically.";
      els.detail.append(hint);
      return;
    }
    const meta = document.createElement("p");
    meta.className = "muted who task-meta";
    meta.textContent = metaLine(task);
    els.detail.append(meta);
    if (needsReview(task)) {
      const review = document.createElement("p");
      review.className = "finding";
      review.textContent = `${describe(task).label}: ${describe(task).summary}`;
      els.detail.append(review);
    }
    for (const action of statusActions(task)) {
      const button = document.createElement("button");
      button.className = action.className;
      button.textContent = action.label;
      button.title = action.title ?? "";
      button.addEventListener("click", action.run);
      els.statusRow.append(button);
    }
    // A task that failed under the autopilot explains why it is sitting out —
    // the backoff (or the give-up) instead of looking like a stalled open one.
    if (!isDone(task) && (task.lastRunError || task.nextRunAt || (task.runFailures ?? 0) >= 5)) {
      const note = document.createElement("div");
      note.className = "muted";
      const retryIn = task.nextRunAt && task.nextRunAt > Date.now() ? ` · retries in ${Math.ceil((task.nextRunAt - Date.now()) / 60000)}m` : "";
      const gaveUp = (task.runFailures ?? 0) >= 5 ? " · gave up — reopen it to retry" : "";
      note.textContent = `autopilot: last run failed (${task.lastRunError ?? "?"})${retryIn}${gaveUp}`;
      els.detail.append(note);
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
      els.detail.append(block);
    }
    const prompt = document.createElement("p");
    prompt.className = "muted";
    prompt.textContent = task.prompt ?? "";
    els.detail.append(prompt);

    const section = (heading) => {
      const h = document.createElement("h4");
      h.textContent = heading;
      els.detail.append(h);
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
      els.detail.append(ul);
    };
    if (task.lastAttempt || task.verification) {
      section("Result & completion checks");
      const attempt = task.lastAttempt ?? {};
      const evidence = task.verification;
      const outcome = document.createElement("p");
      outcome.className = "muted";
      outcome.textContent = evidence?.state === "manual" ? "You marked this task done." : evidence?.state === "verified" ? `Completion accepted: ${evidence.reason || "checks passed"}` : describe(task).summary;
      els.detail.append(outcome);
      const parts = attempt.result?.parts ?? attempt.result;
      const resultLines = parts && typeof parts === "object" ? Object.entries(parts).filter(([key]) => key !== "raw").map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join("; ") : String(value)}`) : [];
      if (resultLines.length) entryList(resultLines, (line) => Object.assign(document.createElement("li"), { textContent: `Worker reported — ${line}` }));
      if (Number.isFinite(evidence?.changedFiles)) {
        const files = document.createElement("p");
        files.className = "who";
        files.textContent = `${evidence.changedFiles} changed file${evidence.changedFiles === 1 ? "" : "s"} observed${attempt.sessionId ? " in the worker's session" : ""}.`;
        els.detail.append(files);
      }
      if (Array.isArray(task.remaining) && task.remaining.length) {
        section("Follow-up work");
        entryList(task.remaining, (line) => Object.assign(document.createElement("li"), { textContent: String(line) }));
      }
    }
    section(`Log (${(task.logs ?? []).length})`);
    entryList(task.logs ?? [], (log) => Object.assign(document.createElement("li"), { textContent: `[${new Date(log.at).toLocaleTimeString()}] ${log.text}` }));
    const logRow = document.createElement("div");
    logRow.className = "row tight";
    const logInput = document.createElement("input");
    logInput.placeholder = "Log a note…";
    logInput.className = "grow";
    const logAdd = document.createElement("button");
    logAdd.className = "ghost";
    logAdd.textContent = "Log";
    logAdd.addEventListener("click", () => {
      if (!logInput.value.trim()) return;
      task.logs = [...(task.logs ?? []), { at: Date.now(), kind: "note", text: logInput.value.trim() }];
      task.updatedAt = Date.now();
      logInput.value = "";
      save();
      renderDetail();
    });
    logRow.append(logInput, logAdd);
    els.detail.append(logRow);

    section(`Thoughts / ideas (${(task.ideas ?? []).length})`);
    entryList(task.ideas ?? [], (idea) => Object.assign(document.createElement("li"), { textContent: `[${new Date(idea.at).toLocaleTimeString()}] ${idea.text}` }));
    const ideaRow = document.createElement("div");
    ideaRow.className = "row tight";
    const ideaInput = document.createElement("input");
    ideaInput.placeholder = "Capture an idea for this task…";
    ideaInput.className = "grow";
    const ideaAdd = document.createElement("button");
    ideaAdd.className = "ghost";
    ideaAdd.textContent = "Add idea";
    ideaAdd.addEventListener("click", () => {
      if (!ideaInput.value.trim()) return;
      task.ideas = [...(task.ideas ?? []), { at: Date.now(), text: ideaInput.value.trim() }];
      task.updatedAt = Date.now();
      ideaInput.value = "";
      save();
      renderDetail();
    });
    ideaRow.append(ideaInput, ideaAdd);
    els.detail.append(ideaRow);

    section(`References (${(task.refs ?? []).length})`);
    entryList(task.refs ?? [], (ref) => {
      const li = document.createElement("li");
      li.textContent = `${ref.kind}: ${ref.title}`;
      li.title = ref.detail ?? "";
      return li;
    });
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
      task.refs = [
        ...(task.refs ?? []),
        ...(result.references.files ?? []).slice(0, 6).map((file) => ({ kind: "file", title: file, detail: "work tree" })),
        ...(result.references.sessions ?? []).slice(0, 4).map((session) => ({ kind: "session", title: session.title, detail: session.id })),
        ...(result.references.web ?? []).slice(0, 4).map((hit) => ({ kind: "web", title: hit.title, detail: hit.url })),
      ].slice(-40);
      task.logs = [...(task.logs ?? []), { at: Date.now(), kind: "reference", text: `gathered ${result.references.code.length} code hits, ${result.references.sessions.length} sessions, ${result.references.chats.length} chats` }];
      task.updatedAt = Date.now();
      await save();
      renderList();
      renderDetail();
    }
    status(`references gathered · ${result.references.code.length} code · ${result.references.sessions.length} sessions · ${result.references.web.length} web`);
    window.MefiToast?.(`References gathered · ${result.references.code.length} code hits, ${result.references.sessions.length} sessions`, "good");
  }

  async function addTask(text) {
    if (!text?.trim()) return null;
    await hydrate();
    // An unread store cannot take the write, so the task would only live in
    // memory until the next load: say so instead of reporting it created.
    if (!hydrated) {
      window.MefiToast?.("Task not saved · the task store could not be read", "bad");
      return null;
    }
    const task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: text.trim().slice(0, 90),
      prompt: text.trim(),
      status: "open",
      color: COLORS[state.tasks.length % COLORS.length],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      logs: [{ at: Date.now(), kind: "status", text: "task created" }],
      ideas: [],
      refs: [],
    };
    state.tasks.unshift(task);
    state.selected = task.id;
    syncBadge();
    // Await the write so a caller that re-reads the list sees this task.
    if (!(await save())) {
      // Drop it again: a retry must not leave a second, unsaved copy behind.
      state.tasks = state.tasks.filter((entry) => entry.id !== task.id);
      if (state.selected === task.id) state.selected = null;
      syncBadge();
      renderList();
      renderDetail();
      window.MefiToast?.("Task not saved · the task store could not be written", "bad");
      return null;
    }
    renderList();
    renderDetail();
    window.MefiToast?.(`Task created · ${task.title}`, "good");
    if (state.prefs.autoReference !== false && state.prefs.useReference !== false) gather();
    return task;
  }

  function open(options) {
    window.MefiNav?.claim?.("tasks");
    const params = optionsOf(options);
    els.overlay.hidden = false;
    // Set the selection before load() so the first render already shows it.
    if (typeof params.taskId === "string" && params.taskId) state.selected = params.taskId;
    return load(params)
      .then(() => {
        revealSelected();
        if (params.gather) gather();
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
    els.openButton?.addEventListener("click", open);
    els.close?.addEventListener("click", close);
    els.overlay?.addEventListener("click", (event) => {
      if (event.target === els.overlay) close();
    });
    els.add?.addEventListener("click", async () => {
      const text = els.newInput.value;
      if (!text.trim()) return;
      // Adding a task is a message to the assistant in the desktop app: it
      // threads the ask, creates the board task at chat worth and kicks the
      // executor at once; the board catches up on the eyes:tasks broadcast.
      // The local write below is the browser-mode fallback.
      if (window.mefiStudio?.assistantMessage) {
        els.newInput.value = "";
        try {
          const result = await window.mefiStudio.assistantMessage(text.trim());
          if (result?.ok) {
            window.MefiToast?.("sent to the assistant · it lands on the board and work is scheduled", "good");
            return;
          }
        } catch {}
        if (!els.newInput.value) els.newInput.value = text; // hand the text back
        return;
      }
      // Clear before the await so a second Enter cannot add the same text twice;
      // hand it back if nothing was saved and the field is still empty.
      els.newInput.value = "";
      const task = await addTask(text);
      if (!task && !els.newInput.value) els.newInput.value = text;
    });
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
        renderList();
        renderDetail();
      }
    });
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
    gather,
    state,
    describe,
    summary,
    // What a live-update reload hands back to open(): the task on screen.
    saveState: () => ({ taskId: state.selected ?? null, filter: state.filter }),
    selectTask: (id) => {
      state.selected = id;
      const task = selectedTask();
      if (task && state.filter !== "all" && taskStage(task) !== state.filter) state.filter = taskStage(task);
      state.query = "";
      if (els.search) els.search.value = "";
      renderList();
      renderDetail();
      revealSelected();
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
