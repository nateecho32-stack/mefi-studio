// The working home: project context, a bottom composer, compact task progress,
// an Activity panel, scoped starts, independent previews and durable results.
// No model calls on navigation. Events keep it fresh; reads are only a backstop.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(`workspace-${id}`);
  const api = () => window.mefiStudio;
  // Tell the Start here walkthrough that a real board action happened. The
  // guide's own listener ticks the matching stop; failures never announce.
  const announce = (name, detail) => {
    try { if (typeof CustomEvent === "function" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent(name, { detail })); } catch {}
  };
  // Questions that interrupt or destroy (switching away from working agents,
  // removing a project) go through the styled toast confirm and fall back to
  // the OS dialog; when neither exists the answer is no, never a silent yes.
  const confirmAction = async (question, label) => {
    if (typeof window.MefiConfirm === "function") return window.MefiConfirm(question, { label });
    return typeof window.confirm === "function" ? window.confirm(question) : false;
  };
  const state = { projects: [], activeId: null, tasks: [], ideas: [], backlog: null, assistant: {}, status: {}, preview: null, previewBusy: null, machine: null, usage: null, filter: "open", query: "", limit: 20, mode: "chat", pending: false, busyAction: null, switching: false, epoch: 0 };
  let initialized = false;
  let refreshFlight = null;
  let startupPromise = null;
  let startupPending = false;
  let startupSequence = 0;
  let threadSignature = "";
  // The thread opens on its newest message and stays there while you are at the bottom.
  let threadPinPending = false;
  let threadAtBottom = true;
  let workSignature = "";
  let workerClocks = [];
  const signatures = new Map();
  const revisions = { tasks: 0, ideas: 0, backlog: 0, assistant: 0, status: 0, preview: 0 };
  let backlogTimer = null;
  let readSequence = 0;
  let readFailure = false;
  let createdTask = null;
  let buildModeSaving = false;
  const buildMode = () => ({ autoBuild: state.status.autoBuild !== false, loaded: typeof state.status.autoBuild === "boolean", saving: buildModeSaving });
  let agentModeSaving = false;
  const taskStartResults = new Map();
  let startingTask = null;
  let activityOpen = null;
  const agentMode = () => ({ mode: state.status.mode === "cluster" ? "cluster" : "swarm", loaded: ["swarm", "cluster"].includes(state.status.mode), saving: agentModeSaving });
  const storage = {
    get(key, fallback = "") { try { return localStorage.getItem(`mefiStudio.workspace.${key}`) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(`mefiStudio.workspace.${key}`, value); } catch { /* private store */ } },
  };
  const person = () => storage.get("person").trim();
  const companion = () => storage.get("companion", "Mefi").trim() || "Mefi";
  const project = () => state.projects.find((item) => item.id === state.activeId);
  const text = (tag, className, value) => { const node = document.createElement(tag); node.className = className; node.textContent = String(value ?? ""); return node; };
  // Writes that skip themselves when nothing changes (see renderWork).
  const setAttr = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };
  const setHidden = (node, hidden) => { if (node.hidden !== hidden) node.hidden = hidden; };
  const done = (task) => ["done", "archived", "completed"].includes(task.status);
  const shortTitle = (task) => window.MefiTasks?.shortTitle?.(task) || String(task.title || task.prompt || "Untitled task").split(/[\r\n]/)[0].slice(0, 80);
  const describe = (task) => window.MefiTasks?.describe?.(task) ?? { stage: done(task) ? "done" : task.status === "awaiting_verification" ? "review" : "open", label: task.status === "active" ? "Working" : done(task) ? "Completed" : task.status === "awaiting_verification" ? "Needs review" : "Queued", summary: task.result?.summary || task.logs?.at(-1)?.text || "" };
  const when = (at) => { const value = new Date(at); return Number.isFinite(value.getTime()) ? value.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""; };
  const workerPhase = (job) => job.stopping ? "Stopping safely" : job.phase === "preparing" ? "Preparing" : job.phase === "finishing" ? "Finishing" : "Building";
  function workerUpdate(job) {
    const at = Math.max(Number(job.lastOutputAt) || 0, Number(job.stepUpdatedAt) || 0);
    const since = at || Number(job.startedAt);
    if (!Number.isFinite(since) || since <= 0) return "No update yet";
    const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
    const age = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
    return at ? `Updated ${age} ago` : `No update yet · ${age} elapsed`;
  }
  function workerStep(job) {
    if (job.stopping) return job.stopping.reason || "Waiting for the worker to exit";
    if (job.phase === "preparing") return (state.status.clusterAgents || []).find((agent) => agent.status === "running" && agent.taskId === job.taskId)?.step || "Preparing task context before the builder starts";
    if (job.phase === "finishing") return "Worker reported completion · waiting for its process to finish";
    return job.currentStep || (job.activity ? `Worker output: ${job.activity}` : "Waiting for the first worker update");
  }
  function feedback(message, error = false, source = "action") {
    readFailure = source === "read"; $("feedback").textContent = message; $("feedback").classList.toggle("error", error);
    const sidebarFeedback = $("sidebar-feedback");
    if (sidebarFeedback && (source === "sidebar" || window.MefiSidebar?.isOpen?.())) {
      sidebarFeedback.textContent = message; sidebarFeedback.classList.toggle("error", error);
    }
  }
  function guard(result) { if (!result?.ok) throw new Error(result?.error || "The app couldn't complete that action. Try again."); return result; }
  function readWithDeadline(read) {
    // Status reads can fail independently. One unanswered IPC must not freeze
    // all six panels or keep a successfully created task's composer disabled.
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Status read timed out")), 12000); });
    return Promise.race([Promise.resolve().then(read), timeout]).finally(() => clearTimeout(timer));
  }
  function active() { return Boolean($("layer") && !$("layer").hidden); }
  function controls() {
    const unavailable = !api()?.projectsList || !state.activeId;
    $("send").disabled = state.pending || state.switching || unavailable;
    $("send").firstChild.textContent = state.pending ? "Sending… " : state.mode === "work" ? "Create task " : "Send message ";
    $("add-project").disabled = state.pending || Boolean(state.busyAction) || state.switching || !api()?.projectsAdd;
    for (const button of $("projects").querySelectorAll("button")) button.disabled = state.pending || Boolean(state.busyAction) || state.switching;
    $("mode-chat").disabled = $("mode-work").disabled = state.pending;
    if ($("task-outline")) $("task-outline").disabled = state.pending || state.switching || unavailable;
    if ($("plan-idea")) $("plan-idea").disabled = state.pending || state.switching || unavailable;
    if ($("pause")) $("pause").disabled = !api()?.assistantControl || state.switching;
    if ($("stop-all")) $("stop-all").disabled = !api()?.assistantControl || state.switching || Boolean(state.busyAction);
    if ($("restart")) $("restart").disabled = !api()?.appRestart || state.switching || Boolean(state.busyAction);
    if ($("auto-build")) $("auto-build").disabled = !api()?.assistantAutopilot || !buildMode().loaded || buildModeSaving || state.switching;
    if ($("agent-mode")) $("agent-mode").disabled = !api()?.assistantAutopilot || !agentMode().loaded || agentModeSaving || state.switching;
    $("reveal").disabled = !project()?.path || !api()?.shellReveal;
    if ($("remove-project")) $("remove-project").disabled = !project()?.id || !api()?.projectsRemove || state.pending || state.switching || Boolean(state.busyAction);
    $("run-backlog").disabled = !state.activeId || !state.backlog || state.backlogUnavailable || !api()?.backlogControl || state.switching || Boolean(state.busyAction);
    for (const button of $("work-list").querySelectorAll("button")) {
      if (button.dataset.backlogAction) button.disabled = !api()?.backlogControl || state.switching || Boolean(state.busyAction);
    }
  }
  const accentForTheme = (theme) => theme === "forest" ? "sage" : theme;
  function personalize(accentChoice = accentForTheme(window.MefiMusic?.status?.()?.theme) || storage.get("accent", "aurora")) {
    const hour = new Date().getHours();
    $("greeting").textContent = `GOOD ${hour < 12 ? "MORNING" : hour < 18 ? "AFTERNOON" : "EVENING"}${person() ? `, ${person()}` : ""}`;
    $("layer").dataset.accent = accentChoice;
    $("layer").classList.toggle("ws-still", storage.get("motion", "1") === "0");
    if ($("sidebar")) {
      $("sidebar").dataset.accent = accentChoice;
      $("sidebar").classList.toggle("ws-still", storage.get("motion", "1") === "0");
    }
    threadSignature = "";
    renderThread(); renderCompanion();
  }
  function renderProjects() {
    const rows = state.projects;
    const signature = JSON.stringify([rows, state.activeId]);
    if (signatures.get("projects") !== signature) {
      signatures.set("projects", signature);
      $("projects").replaceChildren();
      for (const item of rows) {
        const button = text("button", `ws-project${item.id === state.activeId ? " selected" : ""}`, "");
        button.dataset.projectId = item.id;
        button.setAttribute("aria-pressed", String(item.id === state.activeId));
        button.title = item.path || "";
        button.append(text("span", "ws-project-icon", (item.name || "P").slice(0, 1).toUpperCase()), text("span", "ws-project-label", item.name), text("span", "ws-project-arrow", "↗"));
        button.addEventListener("click", () => selectProject(item.id));
        $("projects").append(button);
      }
      if (!rows.length) {
        const empty = text("div", "ws-empty-project", "");
        if (api()?.projectsAdd) {
          empty.append(text("p", "", "Choose a project folder to open its conversation and tasks."));
          const open = text("button", "primary", "Open a folder");
          open.addEventListener("click", () => $("add-project").click());
          empty.append(open);
        } else empty.append(text("p", "", "Open the desktop app to connect your project folders."));
        $("projects").append(empty);
      }
    }
    const current = project();
    $("project-name").textContent = current?.name || "Workspace";
    const projectMenu = document.getElementById("app-rail-brand");
    const projectMenuLabel = projectMenu?.querySelector?.(".app-rail-text");
    if (projectMenuLabel) projectMenuLabel.textContent = current?.name || "Projects";
    if (projectMenu) {
      projectMenu.title = current ? `Projects · ${current.name}` : "Projects";
      projectMenu.setAttribute("aria-label", projectMenu.title);
    }
    $("project-path").textContent = current?.path || "Open a project folder to get started.";
    $("project-path").title = current?.path || "";
    $("composer-context").textContent = current ? `In ${current.name}` : "Open a folder to begin";
    controls();
  }
  function adoptProjects(result) {
    if (!result?.projects) return;
    const oldId = state.activeId;
    state.projects = result.projects;
    state.activeId = result.activeId;
    if (oldId !== state.activeId) {
      activityOpen = null;
      if (oldId) saveDraft(oldId);
      state.epoch += 1;
      state.tasks = []; state.ideas = []; state.backlog = null; state.backlogUnavailable = false; state.assistant = {}; state.status = {}; state.preview = null; state.previewBusy = null;
      state.filter = "open"; state.query = ""; state.limit = 20;
      $("work-search").value = "";
      state.mode = state.activeId ? (storage.get(`mode.${state.activeId}`, "chat") === "work" ? "work" : "chat") : "chat";
      $("input").value = state.activeId ? readDraft(state.activeId, state.mode) : "";
      renderMode();
      createdTask = null;
      if ($("created-task")) $("created-task").hidden = true;
      threadSignature = ""; workSignature = "";
      renderThread(); renderWork(); renderCompanion(); renderBacklog();
      window.dispatchEvent(new CustomEvent("mefi:project-changed", { detail: { projectId: state.activeId } }));
    }
    renderProjects();
  }
  async function selectProject(id) {
    if (state.pending || state.busyAction || state.switching || id === state.activeId) return;
    state.switching = true; controls(); feedback("Opening project…", false, "sidebar");
    try {
      if (refreshFlight) await refreshFlight;
      let result = await api().projectsSelect(id);
      if (result?.ok === false) {
        // Agents are still working. Offer the operator the progress-saving
        // path: stop them, checkpoint every run, then switch. Declining keeps
        // the current project and lets its work finish. Any other failure
        // (an unavailable folder, a switch already in flight) stays as-is.
        const target = state.projects.find((item) => item.id === id);
        const saveable = result.busy === true && !/already in progress/i.test(String(result.error ?? ""));
        if (!saveable) throw new Error(result.error || "The project could not be opened.");
        const question = `Agents are still working in ${project()?.name || "this project"}. Save their progress, stop them, and switch to ${target?.name || "the other project"}?`;
        const approved = await confirmAction(question, "Save & switch");
        if (!approved) throw new Error(result.error || "Project switch canceled.");
        feedback("Saving agent progress, then switching…", false, "sidebar");
        result = await api().projectsSelect(id, { saveProgress: true });
      }
      adoptProjects(guard(result));
      const saved = Number(result?.saved) || 0;
      if (await refresh(true)) feedback(saved ? `Saved ${saved} agent(s), then switched to ${project()?.name || "your project"}.` : `You're in ${project()?.name || "your project"}.`, false, "sidebar");
    } catch (error) { feedback(error.message, true, "sidebar"); }
    finally { state.switching = false; controls(); }
  }
  function renderThread() {
    const messages = (state.assistant.messages || []).filter((message) => ["user", "assistant"].includes(message.role) && (!message.projectId || message.projectId === state.activeId)).slice(-80);
    $("layer").dataset.conversation = messages.length ? "active" : "empty";
    const hasBacklog = state.tasks.some((task) => !done(task)) || state.ideas.some((idea) => idea.status !== "done");
    const signature = JSON.stringify([messages, state.activeId, companion(), person(), !messages.length && hasBacklog]);
    if (signature === threadSignature) return;
    threadSignature = signature;
    const list = $("thread");
    const pinned = list.scrollTop + list.clientHeight >= list.scrollHeight - 60;
    const oldTop = list.scrollTop;
    list.replaceChildren();
    if (!messages.length) {
      const welcome = text("div", "ws-welcome", "");
      welcome.append(text("span", "ws-welcome-star", "✳"), text("h2", "", "Project conversation"), text("p", "", hasBacklog ? `Ask ${companion()} about this project, review your tasks, or decide what to work on next.` : `Ask ${companion()} a question, discuss an idea, or select Create task to add work to the queue.`));
      const suggestions = text("div", "ws-suggestions", "");
      for (const [label, prompt] of [["Project status", "Give me a brief status of this project."], ["Suggest next task", "What should we work on next in this project?"]]) {
        const button = text("button", "ghost", `${label} ↗`);
        button.addEventListener("click", () => { setMode("chat"); $("input").value = prompt; $("input").focus(); saveDraft(); });
        suggestions.append(button);
      }
      welcome.append(suggestions); list.append(welcome);
    }
    for (const message of messages) {
      // A task notice (the assistant reporting on a task) reads as a status
      // line, not a reply.
      const row = text("article", `ws-message ${message.role}${message.kind === "notice" ? " notice" : ""}`, "");
      row.dataset.messageId = message.id || "";
      const head = text("div", "ws-message-head", "");
      head.append(text("strong", "", message.role === "user" ? person() || "You" : companion()), text("time", "", when(message.at)));
      row.append(head, text("div", "ws-message-body", message.text));
      list.append(row);
    }
    // The welcome reads top-down; only a real conversation pins to its newest line.
    list.scrollTop = !messages.length ? 0 : pinned ? list.scrollHeight : oldTop;
    // Rendered while Home is hidden, the thread has no height and ignores
    // scrollTop, so Home opened on the oldest of the last 80 messages. The
    // observer in init() pins it once it has a size.
    threadPinPending = Boolean(messages.length) && pinned && !(list.clientHeight > 0);
  }
  const scoped = (rows) => rows.filter((row) => !row.projectId || row.projectId === state.activeId);
  function focusedTask() {
    const tasks = scoped(state.tasks);
    const context = window.MefiNav?.taskContext?.(state.activeId);
    const remembered = context?.projectId === state.activeId ? context.taskId : storage.get(`task.${state.activeId}`);
    return tasks.find((task) => task.id === remembered)
      || tasks.find((task) => (state.status.running || []).some((job) => job.taskId === task.id))
      || tasks.find((task) => taskView(task).filter === "review")
      || tasks.find((task) => task.id === state.backlog?.next?.[0]?.id)
      || tasks.filter((task) => !done(task))[0]
      || [...tasks].sort((a, b) => (b.doneAt || b.updatedAt || b.createdAt || 0) - (a.doneAt || a.updatedAt || a.createdAt || 0))[0];
  }
  function rememberTask(task) {
    if (!task || (task.projectId && task.projectId !== state.activeId)) return;
    storage.set(`task.${state.activeId}`, task.id);
    window.MefiNav?.selectTask?.({ taskId: task.id, projectId: state.activeId, title: shortTitle(task) });
  }
  function openTask(task, tab = "details") {
    if (!task) return;
    rememberTask(task);
    window.MefiNav?.go?.("tasks", { taskId: task.id, projectId: state.activeId, filter: "all", panel: tab });
  }
  function setActivityOpen(value, focus = false) {
    activityOpen = value;
    renderFocus();
    if (focus) (value ? $("activity-close") : $("activity-toggle"))?.focus();
  }
  function composeTask() {
    window.MefiNav?.go?.("workspace");
    setMode("work");
    $("input").focus();
  }
  function renderFocus() {
    if (!$("focus-panel")) return;
    const task = focusedTask();
    if (task && window.MefiNav?.taskContext?.(state.activeId)?.taskId !== task.id) rememberTask(task);
    const rows = scoped(state.tasks);
    window.MefiNav?.setRecentTasks?.({ projectId: state.activeId, tasks: rows });
    const options = JSON.stringify(rows.map((item) => [item.id, shortTitle(item)]));
    if (signatures.get("focus-options") !== options) {
      signatures.set("focus-options", options);
      $("focus-task").replaceChildren();
      for (const item of rows) { const option = text("option", "", shortTitle(item)); option.value = item.id; $("focus-task").append(option); }
    }
    $("focus-task").value = task?.id || "";
    $("focus-task").hidden = !task;
    $("focus-title").hidden = Boolean(task);
    $("focus-task").disabled = !task || state.switching;
    $("focus-title").textContent = task ? shortTitle(task) : "Create your first task";
    $("focus-title").title = task?.title || task?.prompt || "";
    const view = task ? taskView(task) : null;
    const run = task && (state.status.running || []).find((job) => job.taskId === task.id);
    const starting = task && !run && startingTask?.projectId === state.activeId && startingTask?.taskId === task.id;
    const held = runState().held || runState().launchHold || state.backlog?.paused;
    const summary = task && window.MefiTasks?.workflowSummary?.(task, { status: state.status, backlog: state.backlog, assistant: state.assistant, now: Date.now() });
    $("focus-state").textContent = starting ? "Requesting a worker…" : summary?.label || (task ? view.stage === "ready" && held ? "Task ready · agents paused" : view.label : "No work is running");
    $("focus-worker").textContent = summary?.worker || run?.route || "No worker running";
    $("focus-action").textContent = starting ? "Checking whether this task can start" : summary?.action || (run ? workerStep(run) : done(task || {}) ? "Agent finished" : "Waiting to start");
    $("focus-age").textContent = summary?.activityAge || (run ? workerUpdate(run) : "No active worker");
    $("focus-checks").textContent = summary?.checks || "No recorded checks";
    const dispatch = task && !run && !done(task) ? taskStartResults.get(`${state.activeId}/${task.id}`) : null;
    $("focus-reason").textContent = summary?.blocker || dispatch?.message || summary?.nextAction || (task ? view.stage === "ready" ? "Start this task when you're ready." : view.summary || "Open the task for its next step." : "Describe what you want to build in Create task below.");
    // A worker already on the task makes the primary action a view, never a second start.
    $("focus-primary").textContent = !task ? "Create task" : run ? "View task" : view.stage === "ready" || view.blockedBy === "owner" ? task.continuation || view.blockedBy === "owner" ? "Resume this task" : "Start this task" : view.stage === "running" ? "View task" : view.stage === "approval" ? "Review build" : view.stage === "done" ? "Open app" : "View task";
    $("focus-primary").hidden = view?.stage === "done";
    $("focus-live").hidden = view?.stage === "done";
    $("focus-primary").disabled = state.switching || Boolean(state.busyAction) || (view?.stage === "done" && state.preview?.phase !== "ready");
    $("focus-check").disabled = !task || state.switching;
    $("focus-live").disabled = !task || state.switching;
    $("focus-change").hidden = !task || !done(task);
    $("focus-change").disabled = state.pending || state.switching;
    $("focus-panel").dataset.stage = view?.stage || "empty";
    if ($("progress")) {
      $("progress").hidden = !task;
      $("progress-title").textContent = task ? shortTitle(task) : "";
      $("progress-state").textContent = $("focus-state").textContent;
      $("progress-facts").textContent = [run ? $("focus-worker").textContent : "", $("focus-action").textContent, run ? $("focus-age").textContent : "", $("focus-checks").textContent].filter(Boolean).join(" · ");
      $("progress-reason").textContent = $("focus-reason").textContent;
      $("result-open").hidden = state.preview?.phase !== "ready";
      $("result-open").textContent = task && done(task) ? "Open app" : "Open preview";
      $("result-open").disabled = state.switching || Boolean(state.previewBusy);
    }
    const open = activityOpen ?? Boolean(run);
    if ($("activity-drawer")) $("activity-drawer").hidden = !open;
    if ($("activity-toggle")) $("activity-toggle").setAttribute("aria-expanded", String(open));
    $("layer").dataset.activity = open ? "open" : "closed";
  }
  async function startTask(task = focusedTask()) {
    if (!task || !api()?.assistantWorkOn || state.switching || state.busyAction) return;
    rememberTask(task);
    const id = state.activeId;
    state.busyAction = "start-task"; startingTask = { projectId: id, taskId: task.id }; controls(); renderFocus();
    setActivityOpen(true);
    feedback(`Requesting a worker for ${shortTitle(task)}…`);
    try {
      const result = guard(await api().assistantWorkOn({ kind: "task", id: task.id, projectId: id, start: true }));
      if (id !== state.activeId) return;
      if (result.dispatch) taskStartResults.set(`${id}/${task.id}`, result.dispatch);
      if (result.state) state.assistant = result.state;
      await refresh(true);
      feedback(result.dispatch?.message || "Start requested. Follow the task's current state above.");
    } catch (error) { if (id === state.activeId) feedback(error.message, true); }
    finally { state.busyAction = null; startingTask = null; controls(); renderFocus(); }
  }
  function requestChange(task) {
    if (!task || state.pending || state.switching || (task.projectId && task.projectId !== state.activeId)) return false;
    rememberTask(task);
    window.MefiNav?.go?.("workspace");
    setMode("work");
    const draft = $("input").value.trim();
    const prompt = `Follow-up to task "${task.title || shortTitle(task)}" (${task.id}).\n\nRequested change:\n\nDone when:\n- `;
    $("input").value = draft ? `${draft}\n\n${prompt}` : prompt;
    saveDraft(); $("input").focus();
    feedback("Describe your change, then select Create task. The completed task and its evidence stay available.");
    return true;
  }
  function adoptPreview(value) {
    if (!value || value.projectId !== state.activeId) return;
    state.preview = value;
    renderPreview(); renderFocus(); renderWork();
    announce("mefi:project-preview", value);
  }
  function renderPreview() {
    if (!$("preview-panel")) return;
    const preview = state.preview;
    const phase = preview?.phase || "unavailable";
    const labels = { unavailable: "No preview available", stopped: "Stopped", starting: "Starting preview", ready: "Preview ready", stopping: "Stopping preview", failed: "Preview failed" };
    $("preview-state").textContent = preview ? labels[phase] || phase : api()?.projectPreviewStatus ? "Checking…" : "Desktop app only";
    $("preview-message").textContent = preview?.error || preview?.message || "Studio can preview projects with an index.html or a preview, dev or start script.";
    $("preview-url").textContent = preview?.url || "";
    $("preview-url").hidden = !preview?.url;
    const running = (state.status.running || []).length;
    $("preview-worker").textContent = running ? `${running} agent${running === 1 ? " is" : "s are"} still working. Preview readiness does not verify the task.` : phase === "ready" ? "No agent is running. The app preview stays available independently." : "Preview servers run separately from coding agents.";
    const busy = Boolean(state.previewBusy) || state.switching;
    $("preview-start").hidden = phase === "ready" || phase === "stopping";
    $("preview-start").textContent = phase === "starting" ? "Starting…" : phase === "failed" ? "Retry preview" : "Start preview";
    $("preview-start").disabled = busy || !preview?.available || phase === "starting" || !api()?.projectPreviewStart;
    $("preview-open").disabled = busy || phase !== "ready" || !api()?.projectPreviewOpen;
    $("preview-open").hidden = phase !== "ready";
    $("preview-stop").disabled = busy || !preview?.canStop || !api()?.projectPreviewStop;
    $("preview-stop").title = preview?.owned === false && phase === "ready" ? "This preview was started outside Studio. Stop it from the process that launched it." : "Stop the preview server Studio started. Your files are kept.";
    $("preview-check").disabled = busy || !api()?.projectPreviewStatus || !state.activeId;
    const logs = Array.isArray(preview?.logs) ? preview.logs.slice(-8).map((entry) => entry.text || "").join("\n") : "";
    $("preview-details").hidden = !logs;
    $("preview-log").textContent = logs;
    $("preview-panel").dataset.phase = phase;
  }
  async function previewAction(action, options = {}) {
    const method = { start: "projectPreviewStart", open: "projectPreviewOpen", stop: "projectPreviewStop", status: "projectPreviewStatus" }[action];
    if (!method || !api()?.[method] || state.previewBusy || state.switching || !state.activeId || (options.projectId && options.projectId !== state.activeId)) return false;
    const id = state.activeId, epoch = state.epoch, revision = revisions.preview;
    state.previewBusy = action; renderPreview();
    try {
      const result = await api()[method]({ projectId: id });
      if (epoch !== state.epoch) return false;
      if (revision === revisions.preview && result?.projectId === id) {
        revisions.preview += 1; adoptPreview(result);
      }
      guard(result);
      return true;
    } catch (error) { if (epoch === state.epoch) feedback(error.message, true); return false; }
    finally { if (epoch === state.epoch) { state.previewBusy = null; renderPreview(); } }
  }
  const workLabels = { all: "All work", open: "Queue", ideas: "Ideas", review: "Review", done: "Done" };
  function selectWorkFilter(filter) {
    if ($("queue-details")) $("queue-details").open = true;
    state.filter = filter; state.limit = 20; $("work-list").scrollTop = 0; renderWork();
  }
  function clearWorkSearch() {
    state.query = ""; $("work-search").value = ""; state.limit = 20;
    $("work-list").scrollTop = 0; renderWork(); $("work-search").focus();
  }
  function taskView(task) {
    const description = describe(task);
    const scheduled = state.backlog?.taskStates?.find((item) => item.id === task.id);
    const stage = done(task) ? "done" : task.status === "active" ? "running" : scheduled?.stage || (description.stage === "review" ? "review" : "ready");
    const filter = stage === "done" ? "done" : ["review", "blocked", "approval"].includes(stage) ? "review" : "open";
    return { stage, filter, label: window.MefiStage?.label?.(stage, task) || description.label, summary: stage === "ready" ? task.prompt || description.summary || scheduled?.reason : scheduled?.reason || description.summary, retryAt: scheduled?.retryAt, groupId: scheduled?.groupId, dependencies: scheduled?.dependencies, canRetry: scheduled?.canRetry, blockedBy: scheduled?.blockedBy };
  }
  function cardAction(label, action, payload) {
    const button = text("button", "ghost mini", label);
    button.dataset.backlogAction = action;
    button.addEventListener("click", () => controlBacklog(action, payload));
    return button;
  }
  function renderWork() {
    const tasks = scoped(state.tasks), ideas = scoped(state.ideas);
    const matches = (row) => !state.query || `${row.title || ""} ${row.prompt || ""} ${row.detail || ""} ${(row.tags || []).join(" ")}`.toLowerCase().includes(state.query);
    const matchingTasks = tasks.filter(matches), matchingIdeas = ideas.filter(matches);
    const counts = { all: matchingTasks.length + matchingIdeas.length, open: 0, review: 0, done: 0, ideas: matchingIdeas.length };
    for (const task of matchingTasks) counts[taskView(task).filter] += 1;
    // Every eyes:tasks and assistant:status push lands here, so each write
    // below only happens when its value moved: an identical write still
    // replaces the text node or re-runs attribute invalidation.
    for (const button of $("layer").querySelectorAll("[data-work-filter]")) {
      const count = String(counts[button.dataset.workFilter] || 0);
      setAttr(button, "aria-pressed", String(button.dataset.workFilter === state.filter));
      const badge = button.querySelector("span");
      if (badge.textContent !== count) badge.textContent = count;
      setAttr(button, "aria-label", `${workLabels[button.dataset.workFilter]}: ${count}${state.query ? " matches" : " items"}`);
    }
    const ranks = new Map((state.backlog?.next || []).map((item, index) => [item.id, index]));
    const taskRows = matchingTasks.filter((task) => state.filter === "all" || taskView(task).filter === state.filter)
      .sort((a, b) => ["open", "all"].includes(state.filter) ? Number(b.status === "active") - Number(a.status === "active") || (ranks.get(a.id) ?? 99999) - (ranks.get(b.id) ?? 99999) || (a.createdAt || 0) - (b.createdAt || 0) : (b.doneAt || b.updatedAt || b.createdAt || 0) - (a.doneAt || a.updatedAt || a.createdAt || 0))
      .map((item) => ({ item, isIdea: false }));
    const ideaRows = matchingIdeas.sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || Number(Boolean(a.taskId)) - Number(Boolean(b.taskId)) || (a.at || 0) - (b.at || 0))
      .map((item) => ({ item, isIdea: true }));
    const visible = state.filter === "all" ? [...taskRows, ...ideaRows] : state.filter === "ideas" ? ideaRows : taskRows;
    const page = visible.slice(0, state.limit);
    // A card never shows runProgress (its bar reads state.status.running), and
    // the executor rewrites it on every checkpoint push, so it stays out.
    const signature = JSON.stringify([page.map(({ item, isIdea }) => [isIdea, item.runProgress === undefined ? item : { ...item, runProgress: undefined }]), counts, state.filter, state.query, state.limit, state.backlog?.taskStates, state.backlog?.next, state.status.running, state.preview?.phase, state.busyAction, companion()]);
    const searchLabel = workLabels[state.filter].toLowerCase();
    const placeholder = state.filter === "all" ? "Search all tasks and ideas…" : `Search ${searchLabel}…`;
    if ($("work-search").placeholder !== placeholder) $("work-search").placeholder = placeholder;
    setAttr($("work-search"), "aria-label", `Search ${searchLabel}`);
    setHidden($("clear-search"), !state.query);
    const summary = `${workLabels[state.filter]} · ${visible.length > page.length ? `${page.length} of ` : ""}${visible.length} ${state.query ? visible.length === 1 ? "match" : "matches" : visible.length === 1 ? "item" : "items"}`;
    if ($("work-summary").textContent !== summary) $("work-summary").textContent = summary;
    // The tabs already carry the counts; the line earns its row only while it
    // says more (a search is narrowing the list, or it is paged).
    setHidden($("work-summary"), !state.query && visible.length <= page.length);
    setHidden($("show-more"), visible.length <= state.limit);
    const more = `Show ${Math.min(20, Math.max(0, visible.length - state.limit))} more · ${Math.max(0, visible.length - state.limit)} remaining`;
    if ($("show-more").textContent !== more) $("show-more").textContent = more;
    if (signature === workSignature) {
      // Output can go quiet while this view remains open. Age the existing
      // labels on refresh without replacing a focused task button.
      for (const clock of workerClocks) clock.element.textContent = [clock.job.route, workerUpdate(clock.job)].filter(Boolean).join(" · ");
      return;
    }
    workSignature = signature;
    workerClocks = [];
    const top = $("work-list").scrollTop;
    $("work-list").replaceChildren();
    for (const { item, isIdea } of page) {
      const view = isIdea ? { stage: item.status === "done" ? "done" : "idea", filter: "ideas", label: item.status === "done" ? "Idea completed" : item.taskId ? "Linked to a task" : "Saved idea", summary: item.detail || "" } : taskView(item);
      const row = text("article", `ws-work-card ${view.filter}${isIdea ? " ws-idea-card" : ""}`, "");
      row.dataset.stage = view.stage; row.dataset.status = view.stage;
      const opener = text("button", "ws-work-open", "");
      if (isIdea) opener.dataset.ideaId = item.id; else opener.dataset.taskId = item.id;
      const label = text("span", "ws-work-status", `${view.stage === "done" ? "✓ " : view.stage === "running" ? "◌ " : ""}${view.label}`);
      if (!isIdea && ranks.has(item.id) && view.stage === "ready") label.append(text("span", "ws-rank", ranks.get(item.id) === 0 ? "Up next" : `#${ranks.get(item.id) + 1}`));
      opener.append(label, text("strong", "ws-work-title", isIdea ? item.title || "Untitled idea" : shortTitle(item)));
      opener.title = item.title || item.prompt || "";
      if (view.summary) opener.append(text("span", "ws-work-summary", view.summary));
      const run = !isIdea && (state.status.running || []).find((job) => job.taskId === item.id);
      if (run) {
        opener.append(text("span", "ws-work-summary", `${workerPhase(run)} · ${workerStep(run)}`));
        const clock = text("span", "ws-work-time", [run.route, workerUpdate(run)].filter(Boolean).join(" · "));
        opener.append(clock); workerClocks.push({ element: clock, job: run });
      }
      if (run && Number.isFinite(run.progress)) {
        const progress = document.createElement("progress"); progress.max = 1; progress.value = Math.max(0, Math.min(1, run.progress)); progress.className = "ws-task-progress"; progress.setAttribute("aria-label", `Reported task progress: ${Math.round(progress.value * 100)} percent`); opener.append(progress);
      }
      const stamp = when(view.retryAt || item.doneAt || item.updatedAt || item.createdAt || item.at);
      opener.append(text("span", "ws-work-time", `${view.retryAt ? "Next retry: " : ""}${stamp}${stamp ? " · " : ""}Open ${isIdea ? "idea" : "details"} ↗`));
      opener.addEventListener("click", () => isIdea ? window.MefiNav?.go("ideas", { ideaId: item.id }) : openTask(item));
      row.append(opener);
      const actions = text("div", "ws-card-actions", "");
      if (isIdea && item.status !== "done") {
        if (item.taskId && tasks.some((task) => task.id === item.taskId)) {
          const linked = text("button", "ghost mini", "View task ↗"); linked.addEventListener("click", () => window.MefiNav?.go("tasks", { taskId: item.taskId })); actions.append(linked);
        } else actions.append(cardAction("Turn into task ↗", "promote", { ideaId: item.id }));
      } else if (view.stage === "ready" || view.blockedBy === "owner") {
        const start = text("button", "ghost mini", item.continuation || view.blockedBy === "owner" ? "Resume this task" : "Start this task");
        start.disabled = !api()?.assistantWorkOn || state.switching || Boolean(state.busyAction);
        start.addEventListener("click", () => startTask(item)); actions.append(start);
        if (view.stage === "ready") actions.append(cardAction(item.pin ? "Prioritized" : "Do next", "prioritize", { taskId: item.id }));
      }
      else if (view.stage === "approval") {
        const review = text("button", "ghost mini", "Review build ↗");
        review.addEventListener("click", () => window.MefiNav?.go("tasks", { taskId: item.id, filter: "all" }));
        actions.append(review);
      }
      else if (view.stage === "blocked" && view.canRetry !== false && !view.dependencies?.some((dependency) => !dependency.done)) actions.append(cardAction("Try again", "retry", { taskId: item.id }));
      else if (view.stage === "grouped" && tasks.some((task) => task.id === view.groupId)) {
        const plan = text("button", "ghost mini", "View plan ↗"); plan.addEventListener("click", () => window.MefiNav?.go("tasks", { taskId: view.groupId, filter: "all" })); actions.append(plan);
      }
      else if (view.stage === "done") {
        const open = text("button", "ghost mini", "Open app"); open.disabled = state.preview?.phase !== "ready"; open.addEventListener("click", () => previewAction("open"));
        const checks = text("button", "ghost mini", "View checks"); checks.addEventListener("click", () => openTask(item, "evidence"));
        const change = text("button", "ghost mini", "Request a change"); change.addEventListener("click", () => requestChange(item));
        actions.append(open, checks, change);
      }
      if (actions.children.length) row.append(actions);
      $("work-list").append(row);
    }
    if (!visible.length) {
      const empty = text("div", "ws-work-empty", "");
      const headings = { all: "No tasks or ideas yet", done: "No completed tasks", review: "Nothing waiting for review", ideas: "No ideas yet", open: "Queue is empty" };
      const hints = { all: "Create a task or save an idea to add it to this project.", done: "Verified and archived tasks appear here. Tasks awaiting checks stay in Review.", review: "Finished runs and tasks needing your attention will appear here.", ideas: "Saved ideas appear here. Turn an idea into a task when it is ready to build.", open: "Select Create task to add work, or turn a saved idea into a task." };
      const elsewhere = state.query && state.filter !== "all" && counts.all > 0;
      empty.append(text("span", "ws-empty-symbol", state.filter === "done" ? "✓" : "◇"), text("h3", "", state.query ? `No matches in ${workLabels[state.filter].toLowerCase()}` : headings[state.filter]), text("p", "", state.query ? elsewhere ? `${counts.all} ${counts.all === 1 ? "match is" : "matches are"} available in other views.` : "Try a different word or clear your search." : hints[state.filter]));
      if (elsewhere) { const all = text("button", "ghost", "Search all work"); all.addEventListener("click", () => { selectWorkFilter("all"); $("all").focus(); }); empty.append(all); }
      else if (state.query) { const clear = text("button", "ghost", "Clear search"); clear.addEventListener("click", clearWorkSearch); empty.append(clear); }
      else if (["open", "all"].includes(state.filter)) { const button = text("button", "ghost", "Create task"); button.addEventListener("click", () => { setMode("work"); $("input").focus(); }); empty.append(button); }
      $("work-list").append(empty);
    }
    $("work-list").scrollTop = top;
    controls();
  }
  function renderBacklog() {
    renderDashboard();
    renderBuildMode();
    const backlog = state.backlog;
    const counts = backlog?.counts || {};
    const paused = backlog?.paused || state.assistant.status === "paused";
    const draining = Boolean(backlog?.draining && !paused);
    $("run-backlog").textContent = state.busyAction === "run" ? "Preparing the backlog…" : state.busyAction === "pause" ? "Pausing…" : draining ? "Pause backlog" : "Work through backlog ↗";
    const held = state.status.held === true; // launch hold: nothing moves until Start agents
    $("backlog-title").textContent = state.backlogUnavailable ? "Queue status unavailable" : held ? "Agents stopped" : paused ? "Queue paused" : draining ? "Working through queue" : "Project queue";
    $("backlog-summary").textContent = state.backlogUnavailable ? "Couldn't refresh the queue. Use Retry loading below the conversation." : held ? "Select Start agents above to begin working on queued tasks." : backlog?.summary || (backlog ? paused ? "New work is paused. Running jobs finish normally." : "Run queued tasks and promote saved ideas in batches." : api()?.backlogStatus ? "Checking the project queue…" : "Open the desktop app to manage the queue.");
    $("backlog-metrics").replaceChildren();
    for (const [key, label] of [["ready", "ready"], ["running", "working"], ["approval", "to approve"], ["waiting", "waiting"], ["blocked", "need attention"]]) {
      if (["waiting", "approval"].includes(key) && !counts[key]) continue;
      const item = text("span", `ws-backlog-metric ${key}`, "");
      if (key === "ready" && counts.requests) item.title = "Includes tasks and requests in this project's inbox";
      item.append(text("strong", "", counts[key] ?? "—"), text("span", "", label)); $("backlog-metrics").append(item);
    }
    const next = backlog?.next?.[0];
    const hold = typeof backlog?.waiting === "string" ? backlog.waiting : backlog?.waiting?.text || backlog?.waiting?.reason;
    $("backlog-next").textContent = hold && hold !== backlog?.summary ? hold : next ? `Up next: ${next.title}` : counts.cooling ? `Retry scheduled${backlog.nextRetryAt ? ` · ${when(backlog.nextRetryAt)}` : ""}` : counts.eligibleIdeas ? `${counts.eligibleIdeas} idea${counts.eligibleIdeas === 1 ? "" : "s"} waiting to become work.` : counts.waiting ? "Prerequisites must finish before these tasks can start." : "";
    $("backlog-title").parentElement?.parentElement?.setAttribute("data-state", paused ? "paused" : counts.running ? "running" : counts.blocked ? "blocked" : "ready");
    controls();
  }
  function renderBuildMode() {
    renderAgentMode();
    const mode = buildMode();
    if ($("auto-build")) $("auto-build").checked = mode.autoBuild;
    if ($("build-mode-label")) $("build-mode-label").textContent = mode.saving ? "Saving…" : !mode.loaded ? "Loading preference…" : mode.autoBuild ? "Automatic" : "Verify first";
    if ($("build-mode-note")) $("build-mode-note").textContent = mode.autoBuild
      ? "Turn off to review builds first. Applies to all projects."
      : "Open Review to approve builds. All projects; current workers finish.";
    window.dispatchEvent(new CustomEvent("mefi:build-mode", { detail: mode }));
  }
  function renderAgentMode() {
    const choice = agentMode();
    const control = $("agent-mode"), note = $("agent-mode-note");
    if (control) {
      if (!choice.saving) control.value = choice.mode;
      control.setAttribute("aria-busy", String(choice.saving));
      control.title = "Swarm uses one builder per ready task. Cluster adds planning, review and scoped delegation for a shared task. Applies to all projects; current work finishes when switching.";
    }
    if (note) note.textContent = choice.saving ? "Saving agent mode…" : !choice.loaded ? "Loading agent mode…" : choice.mode === "swarm"
      ? "One builder per ready task, with independent tasks running across the queue. Pause, approvals and capacity still apply."
      : state.status.clusterFocus?.title ? `Agents focus on: ${state.status.clusterFocus.title}`
      : state.status.running?.length ? "Current workers finish before agents focus on one task."
      : "The Assistant and builders share one task, delegate independent subtasks, then combine the results.";
  }
  async function setAgentMode(mode) {
    if (!["swarm", "cluster"].includes(mode)) throw new Error("Choose Swarm or Cluster.");
    if (!api()?.assistantAutopilot || !agentMode().loaded) throw new Error("Agent settings aren't ready. Retry loading first.");
    if (agentModeSaving || state.switching) throw new Error("Wait for the current setting or project change to finish.");
    agentModeSaving = true; renderAgentMode(); controls();
    const epoch = state.epoch;
    try {
      const result = guard(await api().assistantAutopilot({ mode }));
      if (epoch !== state.epoch) return agentMode();
      revisions.status += 1;
      const status = result.status || result;
      state.status = { ...state.status, ...status, mode: status.mode || mode };
      feedback(`${mode === "cluster" ? "Cluster" : "Swarm"} mode saved. Current work finishes; Pause and build approval settings still apply.`);
      await refresh(true);
      return agentMode();
    } catch (error) {
      // Recover an acknowledgement lost after the preference was saved. A newer
      // pushed status or project selection must win over this read.
      const revision = revisions.status;
      try {
        const result = await readWithDeadline(() => api().assistantStatus());
        const status = result?.status || result;
        if (result?.ok !== false && ["swarm", "cluster"].includes(status?.mode) && epoch === state.epoch && revision === revisions.status) {
          revisions.status += 1; state.status = { ...state.status, ...status };
        }
      } catch {}
      throw error;
    } finally { agentModeSaving = false; renderAgentMode(); controls(); }
  }
  async function setAutoBuild(autoBuild) {
    if (!api()?.assistantAutopilot || !buildMode().loaded) throw new Error("Build settings aren't ready. Retry loading first.");
    if (buildModeSaving || state.switching) throw new Error("Wait for the current setting or project change to finish.");
    buildModeSaving = true; renderBuildMode(); controls();
    try {
      const result = guard(await api().assistantAutopilot({ autoBuild }));
      revisions.status += 1;
      state.status = { ...state.status, autoBuild: result.status?.autoBuild ?? result.autoBuild ?? autoBuild };
      renderBuildMode();
      const message = autoBuild ? "Auto build is on. Queued work follows your Pause and worker settings." : "Verify first is on. Review each task before approving its build; current workers finish.";
      feedback(message);
      await refresh(true);
      return { ...buildMode(), message };
    } catch (error) {
      // A failed disk save can still hold dispatch immediately. Read the
      // host's current mode before restoring the control after the failure.
      try {
        const result = await readWithDeadline(() => api().assistantStatus());
        if (typeof result?.status?.autoBuild === "boolean") {
          revisions.status += 1;
          state.status = { ...state.status, autoBuild: result.status.autoBuild };
        }
      } catch {}
      throw error;
    } finally { buildModeSaving = false; renderBuildMode(); controls(); }
  }
  async function controlBacklog(action, payload = {}) {
    if (!api()?.backlogControl || !state.activeId || state.switching || state.busyAction) return;
    const id = state.activeId;
    state.busyAction = action; controls(); renderBacklog();
    feedback(action === "run" ? "Preparing existing tasks and ideas…" : "Updating your backlog…");
    try {
      const result = guard(await api().backlogControl({ action, ...payload, projectId: id }));
      if (id !== state.activeId) return;
      if (result.backlog) state.backlog = result.backlog;
      if (action === "promote") { state.filter = "open"; state.query = ""; $("work-search").value = ""; state.limit = 20; }
      if (await refresh(true)) feedback(result.message || ({ run: "Backlog mode is on. The queue shows the next step and anything holding it up.", pause: "Backlog paused. Running jobs finish normally.", retry: "Task returned to the queue for another attempt.", promote: "Idea linked to a task. Follow it in the queue.", prioritize: "Moved ahead of other waiting work." }[action]));
    } catch (error) { feedback(error.message, true); }
    finally { state.busyAction = null; renderBacklog(); controls(); }
  }
  // Every assistant:status, eyes:tasks and eyes:ideas push asks for a fresh
  // snapshot, and the host takes the board lock and re-reads the board for
  // each one, so pushes read it at most once per 3.5 s (one trailing read
  // catches the last push). A user action passes force and reads after the
  // usual 300 ms settle.
  const BACKLOG_MIN_MS = 3500;
  let backlogReadAt = 0;
  function scheduleBacklogRead(force = false) {
    revisions.backlog += 1;
    if (force && backlogTimer) { clearTimeout(backlogTimer); backlogTimer = null; }
    if (backlogTimer || !active() || document.hidden) return;
    const wait = force ? 300 : Math.max(300, backlogReadAt + BACKLOG_MIN_MS - Date.now());
    backlogTimer = setTimeout(() => { backlogTimer = null; if (active() && !document.hidden) void readBacklog(); }, wait);
  }
  // A push already carried its own slice; only the backlog snapshot is derived.
  // The 15 s backstop / visibility refresh still re-reads every panel.
  let backlogFlight = null;
  function readBacklog() {
    if (!api()?.backlogStatus || !state.activeId || backlogFlight) return backlogFlight;
    backlogReadAt = Date.now();
    const epoch = state.epoch, revision = revisions.backlog;
    backlogFlight = readWithDeadline(() => api().backlogStatus()).then((result) => {
      if (epoch !== state.epoch || revision !== revisions.backlog || !result?.ok || (result.projectId && result.projectId !== state.activeId)) return;
      state.backlog = result; state.backlogUnavailable = false;
      renderWork(); renderCompanion(); renderBacklog();
    }, () => {}).finally(() => { backlogFlight = null; if (revision !== revisions.backlog) scheduleBacklogRead(); });
    return backlogFlight;
  }
  // The brake: stop every running agent now, save each run's progress, and
  // park new dispatch until the operator resumes.
  async function stopAllAgents() {
    if (!api()?.assistantControl || state.switching || state.busyAction) return;
    state.busyAction = "stop-all"; controls();
    feedback("Stopping every agent and saving progress…");
    try {
      const result = guard(await api().assistantControl("stop-all"));
      const stopped = Number(result.stopped) || 0;
      feedback(stopped ? `Stopped ${stopped} agent(s). Progress saved; their work stays queued.` : "No agents were running. New work is off.");
      await refresh(true);
    } catch (error) { feedback(error.message, true); }
    finally { state.busyAction = null; controls(); }
  }
  // Restart with the agents stopped first, so a running build cannot defer the
  // relaunch. Studio comes back paused; Resume starts work again.
  async function restartStudio() {
    if (!api()?.appRestart || state.switching || state.busyAction) return;
    state.busyAction = "restart"; controls();
    feedback("Stopping agents, then restarting Studio…");
    try {
      const result = await api().appRestart({ stopAgents: true });
      if (result?.deferred) feedback(`Restart deferred · ${result.reason ?? "work is still running"}`);
      else if (result?.ok === false) feedback(result.error || "Restart failed.", true);
    } catch (error) { feedback(String(error?.message ?? error), true); }
    finally { state.busyAction = null; controls(); }
  }
  function renderCompanion() {
    const assistant = state.assistant;
    const paused = assistant.status === "paused" || assistant.prefs?.paused;
    const held = state.status.held === true; // launch hold: agents wait for Start agents
    const workersOff = state.status.execute === false;
    const running = state.status.running || [];
    const working = running.length > 0;
    const reviewing = state.tasks.some((task) => taskView(task).filter === "review");
    const nickname = companion();
    $("companion-name").textContent = held && !working ? `${nickname} · Agents stopped` : paused ? `${nickname} · Paused` : working ? `${nickname} · Working` : `${nickname} · Ready`;
    const action = assistant.action;
    const waiting = state.backlog?.waiting || state.status.waiting;
    const narration = working ? `${workerPhase(running[0])}: ${running[0].title || "your task"} · ${workerStep(running[0])}${running.length > 1 ? ` · ${running.length} jobs running` : ""}.` : paused ? "New work is paused. Any running jobs will finish normally." : state.pending ? state.mode === "work" ? "Creating task…" : "Waiting for a reply…" : waiting ? (typeof waiting === "string" ? waiting : waiting.text || waiting.reason || "Work is queued and waiting for an available worker.") : state.backlog?.draining && state.backlog?.next?.length ? `Up next: ${state.backlog.next[0].title}.` : reviewing ? "Open Review to check finished work and resolve blockers." : action?.text && !["idle", "listening"].includes(action.text) ? action.text : "Ask a question or create a task for this project.";
    $("narration").textContent = held && !working ? "Select Start agents to begin. Your tasks and ideas are saved." : !working && !paused && workersOff ? "Coding workers are off. Select Work through backlog to start queued work." : narration;
    $("companion-track").dataset.station = working ? "make" : reviewing ? "review" : "listen";
    $("companion-track").classList.toggle("busy", working || state.pending);
    renderDashboard();
    // The pill reads the same run state as the Service tile and its button.
    $("connection").textContent = runState().label;
    $("connection").classList.toggle("working", working);
    const logs = (assistant.log || []).filter((entry) => entry.kind !== "tick").slice(-8).reverse();
    const signature = JSON.stringify(logs);
    if (signatures.get("activity") !== signature) {
      signatures.set("activity", signature); $("activity-list").replaceChildren();
      for (const entry of logs) { const row = text("li", "", ""); row.append(text("time", "", when(entry.at)), text("span", "", entry.text)); $("activity-list").append(row); }
      if (!logs.length) $("activity-list").append(text("li", "", "Real activity will appear here as the assistant works."));
      $("activity-count").textContent = logs.length || "";
    }
  }
  // The real run state, read from the two switches the backend actually has:
  // the assistant service (paused / running) and work admission (execute).
  // Every surface that says "paused" now says it from here.
  function runState() {
    const assistant = state.assistant;
    const assistantPaused = assistant.status === "paused" || assistant.prefs?.paused === true;
    const admissionOff = state.status.execute === false;
    const running = state.status.running || [];
    // The launch hold is not a pause: nothing has run since Studio opened, and
    // only the operator's Start agents lets anything begin.
    const launchHold = state.status.held === true && !running.length;
    const held = assistantPaused || admissionOff;
    const keyMissing = assistant.ai?.keyPresent === false;
    const label = !api() ? "Browser preview" : launchHold ? "Waiting for you" : assistantPaused && admissionOff ? "Paused" : assistantPaused ? "Assistant paused" : admissionOff ? "New work held" : keyMissing ? "No AI connected" : running.length ? "Working" : "Ready";
    const note = !api() ? "Live status needs the desktop app." : launchHold ? "Automatic work is waiting for you." : assistantPaused && admissionOff ? "All new work is held. Running jobs finish normally." : assistantPaused ? "Queued tasks remain held while existing workers finish." : admissionOff ? "Queued tasks wait; the assistant still replies and takes answers." : keyMissing ? "Connect an AI in Settings to start." : state.status.waiting ? String(state.status.waiting) : running.length ? `${running.length} job${running.length === 1 ? "" : "s"} running` : "Waiting for work.";
    return { held, launchHold, label, note, running, tone: !api() ? "idle" : launchHold ? "warn" : held ? "held" : keyMissing ? "warn" : running.length ? "busy" : "ok" };
  }
  const showFilter = (filter) => {
    state.filter = filter; state.limit = 20; $("work-list").scrollTop = 0; renderWork();
    if ($("queue-details")) { $("queue-details").open = true; $("queue-details").scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }
  };
  // Studio at a glance: the landing strip answers "is anything waiting on me,
  // is anything running, is the machine holding work" before the conversation.
  // Service, workers, attention and next come from state this module already
  // holds; the machine and usage tiles are painted by their own feeds.
  function renderDashboard() {
    renderFocus(); renderPreview();
    if (!$("dash-service")) return;
    const run = runState();
    $("dash-service").dataset.tone = run.tone;
    $("dash-service-value").textContent = run.label;
    $("dash-service-note").textContent = run.note;
    $("dash-service").title = run.note;
    $("pause").textContent = run.launchHold ? "Start agents" : run.held ? "Resume" : "Pause";
    $("pause").title = run.launchHold ? "Start automatic work for this project." : run.held ? "Let new work start again." : "Hold all new work: queued tasks, builds and the assistant's own suggestions. Running jobs finish normally.";
    // The one control the launch hold needs reads as the primary action.
    $("pause").classList.toggle("primary", run.launchHold);
    $("pause").classList.toggle("ghost", !run.launchHold);
    const running = run.running;
    const limit = state.status.adaptiveParallel ? null : Number(state.status.parallel) || null;
    $("dash-workers").dataset.tone = running.length ? "busy" : "idle";
    const phases = new Map();
    for (const job of running) { const phase = workerPhase(job).toLowerCase(); phases.set(phase, (phases.get(phase) || 0) + 1); }
    $("dash-workers-value").textContent = running.length ? [...phases].map(([phase, count]) => `${count} ${phase}`).join(" · ") : "0 running";
    $("dash-workers-note").textContent = running.length ? running.map((job) => job.title || "task").slice(0, 2).join(" · ") : limit ? `Up to ${limit} at once` : state.status.adaptiveParallel ? "Machine managed" : "";
    const questions = (Array.isArray(state.assistant.questions) ? state.assistant.questions : []).filter((question) => question?.status === "open");
    const review = scoped(state.tasks).filter((task) => taskView(task).filter === "review");
    const waiting = questions.length + review.length;
    if ($("attention-shortcut")) {
      $("attention-shortcut").hidden = !waiting;
      $("attention-shortcut").textContent = `${waiting} need${waiting === 1 ? "s" : ""} you`;
    }
    $("dash-attention").dataset.tone = questions.length ? "warn" : review.length ? "busy" : "idle";
    $("dash-attention").dataset.target = questions.length ? "ask" : "review";
    $("dash-attention-value").textContent = waiting ? `${waiting} waiting` : "Nothing waiting";
    // Review holds three different decisions: a build awaiting approval, a
    // blocker only you can clear, and finished work to check. Name each.
    const reviewStages = review.map((task) => taskView(task).stage);
    const approvals = reviewStages.filter((stage) => stage === "approval").length;
    const blocked = reviewStages.filter((stage) => stage === "blocked").length;
    const checks = review.length - approvals - blocked;
    $("dash-attention-note").textContent = [questions.length ? `${questions.length} question${questions.length === 1 ? "" : "s"} to answer` : "", approvals ? `${approvals} awaiting approval` : "", blocked ? `${blocked} blocked` : "", checks ? `${checks} to review` : ""].filter(Boolean).join(" · ");
    const next = (state.backlog?.next || [])[0];
    const nextTask = next ? scoped(state.tasks).find((task) => task.id === next.id) : null;
    const ready = state.backlog?.counts?.ready || 0;
    if ($("queue-count")) $("queue-count").textContent = [ready ? `${ready} ready` : "", running.length ? `${running.length} working` : "", waiting ? `${waiting} need attention` : ""].filter(Boolean).join(" · ") || "Nothing waiting";
    $("dash-next").dataset.tone = next ? "ok" : "idle";
    $("dash-next-value").textContent = nextTask?.title || next?.title || (ready ? `${ready} ready` : "Queue is empty");
    const summary = state.backlog?.summary || "";
    // The backlog summary usually already reads "N ready to work on".
    $("dash-next-note").textContent = next ? (/\bready\b/i.test(summary) ? summary : [`${ready} ready`, summary].filter(Boolean).join(" · ")) : summary;
  }
  function renderMachineTile() {
    if (!$("dash-machine")) return;
    const status = state.machine;
    if (!status) { $("dash-machine").dataset.tone = "idle"; $("dash-machine-value").textContent = api() ? "Checking…" : "Desktop app only"; $("dash-machine-note").textContent = ""; return; }
    const resources = status.capacity?.resources || {};
    const exclusive = status.leases?.exclusive === true;
    const held = status.wait === true;
    const busy = status.leases?.busy === true;
    $("dash-machine").dataset.tone = exclusive ? "warn" : held ? "held" : busy ? "busy" : "ok";
    $("dash-machine-value").textContent = exclusive ? "Reserved by a test" : held ? "Holding new workers" : busy ? "Busy" : "Free";
    const parts = [];
    if (Number.isFinite(resources.availableMemoryMB)) parts.push(`${(resources.availableMemoryMB / 1024).toFixed(1)} GB free`);
    if (Number.isFinite(resources.lagMs)) parts.push(`${Math.round(resources.lagMs)} ms lag`);
    if (held && status.capacity?.reason) parts.push(String(status.capacity.reason));
    $("dash-machine-note").textContent = parts.join(" · ");
  }
  function renderUsageTile() {
    if (!$("dash-usage")) return;
    const report = state.usage;
    if (!report) { $("dash-usage").dataset.tone = "idle"; $("dash-usage-value").textContent = api() ? "No reading yet" : "Desktop app only"; $("dash-usage-note").textContent = ""; return; }
    // The lead account is the first connected provider with a live window or
    // quota reading (the same choice the Command usage panel makes); the older
    // OpenCode Go read stands in when the accounts read is absent.
    const accounts = Array.isArray(report.accounts?.accounts) ? report.accounts.accounts : [];
    const lead = accounts.find((account) => account?.ok && (account.read === "windows" || account.read === "quota")) ?? null;
    const credits = lead ? (lead.read === "windows" ? lead.usage : lead.quota) : report.credits?.ok ? report.credits.usage : null;
    const today = report.local?.ok === false ? null : report.local?.today;
    const percent = (window) => (window && Number.isFinite(window.percent) ? `${Math.round(window.percent)}%` : null);
    const rolling = percent(credits?.rolling), weekly = percent(credits?.weekly);
    if (rolling || weekly) {
      $("dash-usage-value").textContent = `5h ${rolling ?? "—"} · week ${weekly ?? "—"}`;
      $("dash-usage").dataset.tone = (credits?.rolling?.percent >= 90 || credits?.weekly?.percent >= 90 || credits?.rolling?.status === "rate-limited") ? "warn" : "ok";
    } else if (today) {
      $("dash-usage-value").textContent = `${today.calls ?? 0} calls today`;
      $("dash-usage").dataset.tone = "ok";
    } else {
      $("dash-usage-value").textContent = "Usage unavailable";
      $("dash-usage").dataset.tone = "idle";
    }
    const cost = Number(today?.usage?.costUsd);
    const who = lead ? `${lead.label} · ` : "";
    // Sub-cent days read as themselves ($0.004), not as $0.00.
    const spent = Number.isFinite(cost) ? `$${cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: cost > 0 && cost < 0.01 ? 4 : 2 })}` : "";
    $("dash-usage-note").textContent = today ? `${who}Today · ${today.calls ?? 0} calls${spent ? ` · ${spent}` : ""}` : lead ? who.slice(0, -3) : report.credits?.error || "";
  }
  function renderJev(value) {
    const status = value?.status || value;
    let label = "status unavailable";
    if (status) {
      label = status.enabled === false ? "paused in Settings" : !status.configured ? "connect in Settings" : status.accountingPending ? "waiting for usage accounting" : status.lastError ? "needs attention in Settings" : status.phase === "running" ? "reviewing task intake" : status.lastSuccessAt ? "task intake ready" : "configured · awaiting first intake";
    }
    $("jev").textContent = `Jev · ${label}`;
    $("jev").title = status?.lastError || "Jev is Studio's optional model-selection service: with a key it picks a model per task and advises on related tasks; without one, fixed defaults apply. Your work stays on the board. Set it up under Settings › Jev.";
  }
  function setMode(mode) {
    if (state.pending || state.switching) return;
    mode = mode === "work" ? "work" : "chat";
    if (mode !== state.mode) {
      saveDraft();
      state.mode = mode;
      $("input").value = readDraft(state.activeId, mode);
    }
    if (state.activeId) storage.set(`mode.${state.activeId}`, mode);
    renderMode();
  }
  function renderMode() {
    const mode = state.mode;
    $("mode-chat").setAttribute("aria-pressed", String(mode === "chat")); $("mode-work").setAttribute("aria-pressed", String(mode === "work"));
    $("input").placeholder = mode === "work" ? "Describe the task and how to check the result…" : "Ask about this project or discuss an idea…";
    $("compose-hint").textContent = mode === "work" ? "Enter to create · Shift + Enter for a new line" : "Enter to send · Shift + Enter for a new line";
    if ($("task-outline")) $("task-outline").hidden = mode !== "work";
    controls();
  }
  function readDraft(id, mode) {
    // Old versions had one draft; retain it in chat until it has been saved
    // in the new per-purpose slot. An explicitly empty slot stays empty.
    return storage.get(`draft.${id}.${mode}`, mode === "chat" ? storage.get(`draft.${id}`) : "");
  }
  function saveDraft(id = state.activeId) {
    if (!id) return;
    storage.set(`draft.${id}.${state.mode}`, $("input").value);
    if (state.mode === "chat") storage.set(`draft.${id}`, $("input").value);
  }
  // The region prefill and the change/outline scaffolds are structure, not a
  // requirement. A task with only scaffolding must not be created.
  const REGION_BRIEF = /^In\s+.+?:\s*$/;
  const CHURN_HINT = /^Files agents changed most here:.*$/;
  const TEMPLATE_LINE = /^(?:Requested change|Done when|How to check|Steps|Acceptance)\s*:?\s*-?\s*$/;
  const FOLLOWUP_LINE = /^Follow-up to task\b.*$/;
  const placeholder = /^<.*>$/;
  function hasRequirement(text) {
    const kept = String(text ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !REGION_BRIEF.test(line) && !CHURN_HINT.test(line) && !TEMPLATE_LINE.test(line) && !FOLLOWUP_LINE.test(line) && !placeholder.test(line));
    return kept.join(" ").replace(/[^\p{L}\p{N}]/gu, "").length >= 3;
  }
  async function submit(event) {
    event?.preventDefault();
    const value = $("input").value.trim();
    if (!value || state.pending || state.switching || !state.activeId || !api()) return;
    const id = state.activeId; const mode = state.mode;
    if (mode === "work" && !hasRequirement(value)) {
      state.pending = false; controls();
      feedback("Describe what to change and how to check it, then create the task.", true);
      return;
    }
    state.pending = true; controls(); renderCompanion(); feedback(mode === "work" ? "Adding your task…" : "Waiting for a reply…");
    createdTask = null;
    if ($("created-task")) $("created-task").hidden = true;
    let saved = false;
    try {
      const result = guard(await (mode === "work" ? api().tasksCreate({ title: value.split("\n")[0].slice(0, 180), prompt: value, projectId: id }) : api().assistantMessage(value, id, { view: "Home", companion: companion() })));
      saved = true;
      if (id !== state.activeId) return;
      if ($("input").value.trim() === value) $("input").value = "";
      saveDraft();
      if (result.state) { state.assistant = result.state; renderThread(); }
      if (mode === "work") {
        state.filter = "open"; state.query = ""; state.limit = 20; $("work-search").value = "";
        createdTask = result.task?.id ? { id: result.task.id, projectId: id } : null;
        if ($("created-task")) $("created-task").hidden = !createdTask;
        if (createdTask) announce("mefi:task-created", { taskId: createdTask.id, projectId: id });
      }
      const refreshed = await refresh(true);
      if (mode === "work") {
        const savedMessage = state.status.autoBuild === false ? "Task added for approval. Open View task to review its scope and approve the build when you're ready." : state.assistant.status === "paused" ? "Task added. New work is paused; Resume when you're ready. Open View task for details." : state.backlog?.paused ? "Task added. Coding workers are off; use Work through backlog when you're ready. Open View task for details." : "Task added. Follow it in Your work; open it for details.";
        if (state.status.autoBuild === false) { state.filter = "review"; renderWork(); }
        feedback(refreshed ? savedMessage : "Task added, but the board couldn't refresh. Use View task or Retry loading; you don't need to add it again.", !refreshed, refreshed ? "action" : "read");
      }
      else if (refreshed) feedback("Reply received.");
    } catch (error) { feedback(saved ? `${mode === "work" ? "Task added" : "Message sent"}, but the view couldn't refresh. Retry loading to see it.` : `${error.message} Your draft is still here.`, true); }
    finally { state.pending = false; controls(); renderCompanion(); }
  }
  async function refresh(force = false) {
    if (!api() || (!active() && !force)) return;
    // No project is open: every panel stays in its first-run state until a
    // folder is chosen, and the hidden seed store is never read.
    if (!state.activeId) return true;
    if (refreshFlight && !force) return refreshFlight;
    const epoch = state.epoch;
    const sequence = ++readSequence;
    const before = { ...revisions };
    const belongs = (value) => !value?.projectId || value.projectId === state.activeId;
    // This reads the backlog too, so the push reads count their interval from here.
    backlogReadAt = Date.now();
    const run = Promise.allSettled(["tasksList", "assistantState", "assistantStatus", "jevStatus", "ideasList", "backlogStatus", "projectPreviewStatus"].map((method) => readWithDeadline(() => method === "projectPreviewStatus" ? api()[method]?.({ projectId: state.activeId }) : api()[method]?.()))).then((results) => {
      if (epoch !== state.epoch || sequence !== readSequence) return;
      if (before.tasks === revisions.tasks && results[0].status === "fulfilled" && results[0].value?.tasks && belongs(results[0].value)) state.tasks = results[0].value.tasks;
      if (before.assistant === revisions.assistant && results[1].status === "fulfilled" && results[1].value?.state && belongs(results[1].value.state)) state.assistant = results[1].value.state;
      if (before.status === revisions.status && results[2].status === "fulfilled" && results[2].value?.status && belongs(results[2].value.status)) state.status = results[2].value.status;
      if (before.ideas === revisions.ideas && results[4].status === "fulfilled" && results[4].value?.ideas && belongs(results[4].value)) state.ideas = results[4].value.ideas;
      if (before.backlog === revisions.backlog && results[5].status === "fulfilled" && results[5].value?.ok && belongs(results[5].value)) state.backlog = results[5].value;
      if (before.preview === revisions.preview && api().projectPreviewStatus) {
        if (results[6].status === "fulfilled" && results[6].value?.projectId === state.activeId) adoptPreview(results[6].value);
        else if (results[6].status === "rejected") adoptPreview({ ...state.preview, projectId: state.activeId, phase: "failed", error: "Preview status unavailable. Select Check again to retry." });
      }
      state.backlogUnavailable = Boolean(api().backlogStatus && (results[5].status === "rejected" || !results[5].value?.ok));
      renderJev(results[3].status === "fulfilled" ? results[3].value : null);
      renderWork(); renderThread(); renderCompanion(); renderBacklog();
      const failures = results.slice(0, 3).flatMap((result, index) => result.status === "rejected" || result.value?.ok === false || !result.value ? [["work", "conversation", "activity"][index]] : []);
      if (api().ideasList && (results[4].status === "rejected" || !results[4].value?.ok)) failures.push("ideas");
      if (state.backlogUnavailable) failures.push("backlog");
      $("retry").hidden = !failures.length;
      if (failures.length) {
        console.warn("Workspace refresh failed", failures, results.map((result) => result.status === "rejected" ? String(result.reason?.message || result.reason) : result.value?.ok === false ? result.value?.error ?? "ok:false" : result.value ? "ok" : "empty"));
        feedback(`Couldn't refresh ${failures.join(" and ")}. Your last loaded information is still here.`, true, "read");
      }
      else if (readFailure) feedback("");
      return failures.length === 0;
    });
    refreshFlight = run;
    try { return await run; } finally { if (refreshFlight === run) refreshFlight = null; }
  }
  function loadInitialWorkspace() {
    const sequence = ++startupSequence;
    const epoch = state.epoch;
    // A deliberate retry supersedes unfinished reads from the previous attempt,
    // including the gap while the new project selection is still loading.
    readSequence += 1;
    startupPending = true;
    startupPromise = (async () => {
      if (!api()) return true;
      try {
        const result = await readWithDeadline(() => api().projectsList?.());
        if (sequence !== startupSequence) return false;
        // A live project-selection event takes precedence over this snapshot.
        if (epoch !== state.epoch) return (await (refreshFlight ?? refresh(true))) === true;
        adoptProjects(guard(result));
        return (await refresh(true)) === true;
      } catch (error) {
        if (sequence !== startupSequence) return false;
        $("retry").hidden = false;
        feedback(error.message, true, "read");
        return false;
      }
    })().finally(() => { if (sequence === startupSequence) startupPending = false; });
    return startupPromise;
  }
  function ready({ retry = false } = {}) {
    init();
    return retry ? loadInitialWorkspace() : startupPromise ?? Promise.resolve(!api());
  }
  // The live node tree drawn behind Home's frosted panels (idle.js owns it).
  // It waits for the startup layer to lift, so Home's first paint never shares
  // the thread with it, and starts only if Home is still showing by then.
  function showBackdrop() {
    const start = () => { if (active()) window.MefiIdle?.setHomeBackdrop?.(true); };
    if (window.MefiBoot?.isActive?.()) Promise.resolve(window.MefiBoot.ready?.()).then(start, start);
    else start();
  }
  function enter() {
    init(); window.MefiIdle?.exit?.(); $("layer").hidden = false;
    document.body.classList.add("workspace-active");
    showBackdrop();
    renderMachineTile(); renderUsageTile();
    // Usage has no push; one read on entry (cached 5 min by the tracker).
    if (api()) window.MefiUsageTracker?.refresh?.()?.catch?.(() => {});
    $("layer").focus({ preventScroll: true });
    // Startup already reads and paints the workspace. Opening it underneath
    // the loading layer joins that work instead of issuing a second batch.
    return startupPending || window.MefiBoot?.isActive?.() ? ready() : refresh(true);
  }
  function exit() { if (!$("layer")) return; $("layer").hidden = true; document.body.classList.remove("workspace-active"); window.MefiIdle?.setHomeBackdrop?.(false); saveDraft(); }
  function init() {
    if (initialized || !$("layer")) return; initialized = true;
    const projectActions = $("layer").querySelector?.(".ws-project-actions");
    projectActions?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !projectActions.open) return;
      event.preventDefault(); event.stopPropagation();
      projectActions.open = false;
      projectActions.querySelector("summary")?.focus();
    });
    document.addEventListener?.("click", (event) => {
      if (projectActions?.open && (!projectActions.contains(event.target) || event.target.closest?.("button"))) projectActions.open = false;
    });
    $("form").addEventListener("submit", submit);
    $("activity-toggle")?.addEventListener("click", () => setActivityOpen($("activity-drawer").hidden, true));
    $("activity-close")?.addEventListener("click", () => setActivityOpen(false, true));
    $("progress-open")?.addEventListener("click", () => setActivityOpen(true, true));
    const thread = $("thread");
    thread?.addEventListener?.("scroll", () => { threadAtBottom = thread.scrollTop + thread.clientHeight >= thread.scrollHeight - 60; }, { passive: true });
    if (thread && typeof ResizeObserver === "function") new ResizeObserver(() => {
      if (!(thread.clientHeight > 0) || !(threadPinPending || threadAtBottom) || !thread.childElementCount || thread.querySelector(".ws-welcome")) return;
      threadPinPending = false;
      thread.scrollTop = thread.scrollHeight;
    }).observe(thread);
    $("result-open")?.addEventListener("click", () => previewAction("open"));
    $("retry").addEventListener("click", () => state.activeId ? refresh(true) : ready({ retry: true }));
    $("input").addEventListener("input", () => saveDraft());
    $("task-outline")?.addEventListener("click", () => {
      if (state.pending || state.switching || state.mode !== "work") return;
      const outline = "Goal:\n\nDone when:\n- \n\nKeep unchanged:\n";
      $("input").value = $("input").value.trim() ? `${$("input").value.trimEnd()}\n\nDone when:\n- \n\nKeep unchanged:\n` : outline;
      saveDraft(); $("input").focus();
    });
    $("created-task")?.addEventListener("click", () => {
      if (createdTask?.projectId === state.activeId) window.MefiNav?.go?.("tasks", { taskId: createdTask.id, filter: "all" });
    });
    $("focus-task")?.addEventListener("change", () => {
      const task = scoped(state.tasks).find((item) => item.id === $("focus-task").value);
      rememberTask(task); renderFocus();
    });
    $("focus-primary")?.addEventListener("click", () => {
      const task = focusedTask();
      if (!task) { setMode("work"); $("input").focus(); }
      else if (!(state.status.running || []).some((job) => job.taskId === task.id) && (taskView(task).stage === "ready" || taskView(task).blockedBy === "owner")) void startTask(task);
      else if (done(task)) void previewAction("open");
      else openTask(task);
    });
    $("focus-check")?.addEventListener("click", () => openTask(focusedTask(), "evidence"));
    $("focus-live")?.addEventListener("click", () => {
      const task = focusedTask(); if (!task) return;
      rememberTask(task); window.MefiNav?.go?.("command", { taskId: task.id, projectId: state.activeId, selected: `task:${task.id}`, rail: "work" });
    });
    $("focus-change")?.addEventListener("click", () => requestChange(focusedTask()));
    for (const action of ["start", "open", "stop"]) $("preview-" + action)?.addEventListener("click", () => previewAction(action));
    $("preview-check")?.addEventListener("click", () => previewAction("status"));
    window.addEventListener("mefi:task-context", (event) => {
      if (event.detail?.projectId !== state.activeId) return;
      if (event.detail.taskId) storage.set(`task.${state.activeId}`, event.detail.taskId);
      if (active()) renderFocus();
    });
    $("input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); } });
    $("mode-chat").addEventListener("click", () => setMode("chat")); $("mode-work").addEventListener("click", () => setMode("work"));
    $("plan-idea")?.addEventListener("click", () => window.MefiNav?.go?.("plans", { create: true, destination: $("input").value.trim() }));
    for (const button of $("layer").querySelectorAll("[data-work-filter]")) button.addEventListener("click", () => selectWorkFilter(button.dataset.workFilter));
    $("work-search").addEventListener("input", () => { state.query = $("work-search").value.trim().toLowerCase(); state.limit = 20; $("work-list").scrollTop = 0; renderWork(); });
    $("clear-search").addEventListener("click", clearWorkSearch);
    $("show-more").addEventListener("click", () => { state.limit += 20; renderWork(); });
    $("run-backlog").addEventListener("click", () => controlBacklog(state.backlog?.draining && !state.backlog?.paused ? "pause" : "run"));
    $("auto-build")?.addEventListener("change", async () => {
      try { await setAutoBuild($("auto-build").checked); }
      catch (error) { feedback(error.message, true); renderBuildMode(); controls(); }
    });
    $("agent-mode")?.addEventListener("change", async () => {
      try { await setAgentMode($("agent-mode").value); }
      catch (error) { feedback(error.message, true); renderAgentMode(); controls(); }
    });
    $("add-project").addEventListener("click", async () => {
      if (state.pending || state.busyAction || state.switching) return;
      state.switching = true; controls();
      try {
        const result = await api().projectsAdd();
        if (result?.canceled || result?.cancelled) return;
        adoptProjects(guard(result));
        await refresh(true);
        if (result.selectedId) {
          feedback(`Opened ${project()?.name || "your project"}. Analysing the folder now.`, false, "sidebar");
          window.MefiAnalyzer?.open?.();
        } else feedback("Project added. Select it in the sidebar to start working.", false, "sidebar");
      } catch (error) { feedback(error.message, true, "sidebar"); } finally { state.switching = false; controls(); }
    });
    $("remove-project")?.addEventListener("click", async () => {
      const current = project();
      if (!current || state.pending || state.busyAction || state.switching) return;
      const question = `Remove "${current.name}" from Studio's project list? The folder and its local work stay on disk; open the same folder again to restore them.`;
      const approved = await confirmAction(question, "Remove");
      if (!approved) return;
      state.switching = true; controls();
      try {
        adoptProjects(guard(await api().projectsRemove(current.id)));
        if (state.activeId) await refresh(true);
        feedback(`Removed ${current.name}. Its files and local work are still on disk.`, false, "sidebar");
      } catch (error) { feedback(error.message, true, "sidebar"); }
      finally { state.switching = false; controls(); }
    });
    $("reveal").addEventListener("click", () => api()?.shellReveal(project()?.path));
    $("stop-all")?.addEventListener("click", () => void stopAllAgents());
    $("restart")?.addEventListener("click", () => void restartStudio());
    // The one pause control. Pause holds every kind of new work (queued tasks,
    // builds, the assistant's own suggestions) exactly as Command's New work
    // switch does; Resume reopens admission and wakes the assistant. Running
    // jobs are never interrupted by either.
    $("pause").addEventListener("click", async () => {
      $("pause").disabled = true;
      try {
        if (state.status.held === true) {
          // The launch screen left the agents off; this is the user's Start.
          const result = guard(await api().assistantControl("start-work"));
          if (result.state) state.assistant = result.state;
          state.status = { ...state.status, ...(result.autopilot || {}), held: false };
          renderCompanion(); renderBacklog(); scheduleBacklogRead(true);
          feedback("Agents started. New work can begin; task approvals and capacity still apply.");
          return;
        }
        if (runState().held) {
          // Resume reopens admission and wakes the assistant in one step, so a
          // hold left by Stop all or a tripped breaker clears with the pause.
          const result = guard(await api().assistantControl("start-work"));
          if (result.state) state.assistant = result.state;
          if (result.autopilot) state.status = { ...state.status, ...result.autopilot };
          feedback("New work can start again.");
        } else {
          if (!api()?.backlogControl) throw new Error("Open the updated desktop app to pause new work.");
          const result = guard(await api().backlogControl({ action: "pause", projectId: state.activeId }));
          if (result.backlog) state.backlog = result.backlog;
          state.status = { ...state.status, execute: false };
          feedback("New work paused. Running jobs finish normally.");
        }
        renderCompanion(); renderBacklog(); scheduleBacklogRead(true);
      }
      catch (error) { feedback(error.message, true); } finally { controls(); }
    });
    for (const [id, key, fallback] of [["person-name", "person", ""], ["agent-name", "companion", "Mefi"], ["accent", "accent", "aurora"]]) {
      $(id).value = storage.get(key, fallback);
      $(id).addEventListener("input", () => {
        // Music announces the actual theme (and whether this is a temporary
        // preview) before Workspace writes its own accent preference.
        if (id === "accent" && window.MefiMusic?.applyTheme) {
          window.MefiMusic.applyTheme($(id).value === "sage" ? "forest" : $(id).value, true, { navigate: false });
          return;
        }
        storage.set(key, $(id).value);
        personalize();
      });
    }
    const syncThemeChoice = (event) => {
      const theme = event?.detail?.theme || window.MefiMusic?.status?.().theme;
      if (!theme) return;
      const choice = accentForTheme(theme);
      // A preview changes the visible accent without entering Workspace's
      // saved preference. Closing the preview re-announces the saved choice.
      const options = $("accent").options ? [...$("accent").options] : null;
      if (options && !options.some((option) => option.value === choice)) return;
      $("accent").value = choice;
      if (event?.detail?.preview !== true && storage.get("accent", "aurora") !== choice) storage.set("accent", choice);
      personalize(choice);
    };
    window.addEventListener("mefi-theme-change", syncThemeChoice);
    syncThemeChoice();
    $("motion").checked = storage.get("motion", "1") !== "0";
    $("motion").addEventListener("change", () => { storage.set("motion", $("motion").checked ? "1" : "0"); personalize(); });
    window.MefiNav?.renderWorkspaceTools?.($("tool-links"));
    api()?.onProjects?.((result) => { adoptProjects(result); refresh(true); });
    api()?.onTasks?.((tasks) => { if (tasks?.some((task) => task.projectId && task.projectId !== state.activeId)) return; revisions.tasks += 1; state.tasks = tasks || []; if (active()) { renderWork(); renderCompanion(); } scheduleBacklogRead(); });
    api()?.onIdeas?.((ideas) => { if (ideas?.some((idea) => idea.projectId && idea.projectId !== state.activeId)) return; revisions.ideas += 1; state.ideas = ideas || []; if (active()) renderWork(); scheduleBacklogRead(); });
    api()?.onAssistant?.((payload) => { if (payload?.state?.projectId && payload.state.projectId !== state.activeId) return; revisions.assistant += 1; if (payload?.state) state.assistant = payload.state; if (active()) { renderThread(); renderCompanion(); } });
    api()?.onAssistantStatus?.((status) => { if (status?.projectId && status.projectId !== state.activeId) return; revisions.status += 1; state.status = status || {}; renderBuildMode(); controls(); if (active()) { renderCompanion(); renderWork(); } scheduleBacklogRead(); });
    api()?.onProjectPreview?.((value) => { if (value?.projectId !== state.activeId) return; revisions.preview += 1; adoptPreview(value); });
    api()?.onMachineStatus?.((status) => { state.machine = status || null; if (active()) renderMachineTile(); });
    window.addEventListener("mefi:usage-report", (event) => { state.usage = event.detail || null; if (active()) renderUsageTile(); });
    $("dash-attention")?.addEventListener("click", () => { if ($("dash-attention").dataset.target === "ask") window.MefiNav?.go?.("command", { rail: "ask" }); else showFilter("review"); });
    $("attention-shortcut")?.addEventListener("click", () => { if ($("dash-attention").dataset.target === "ask") window.MefiNav?.go?.("command", { rail: "ask" }); else showFilter("review"); });
    $("dash-next")?.addEventListener("click", () => showFilter("open"));
    $("dash-usage")?.addEventListener("click", () => window.MefiUsageTracker?.openTab?.());
    personalize(); renderProjects(); renderWork(); renderBacklog();
    loadInitialWorkspace();
    if (!api()) $("jev").textContent = "Desktop app connects your tools";
    // Pushes keep Home current between reads. Under an open page Home is not
    // on screen, and with the window unfocused a read a minute is plenty.
    let polledAt = 0;
    window.MefiBoot?.pollStart?.("workspace.refresh", () => {
      if (document.hidden || !active() || document.body?.dataset?.sheet) return;
      if (document.hasFocus?.() === false && Date.now() - polledAt < 60000) return;
      polledAt = Date.now();
      refresh();
    }, 15000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && active()) refresh(); });
  }
  window.MefiWorkspace = { enter, exit, refresh, ready, isActive: active, activeProjectId: () => state.activeId, buildMode, setAutoBuild, agentMode, setAgentMode, composeTask, requestChange, startTask, previewAction, previewStatus: () => state.preview };
  init();
})();
