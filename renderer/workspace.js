// The working home: project context, a conversation, and durable work results.
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
  const state = { projects: [], activeId: null, tasks: [], ideas: [], backlog: null, assistant: {}, status: {}, machine: null, usage: null, filter: "open", query: "", limit: 20, mode: "chat", pending: false, busyAction: null, switching: false, epoch: 0 };
  let initialized = false;
  let refreshFlight = null;
  let startupPromise = null;
  let startupPending = false;
  let startupSequence = 0;
  let threadSignature = "";
  let workSignature = "";
  const signatures = new Map();
  const revisions = { tasks: 0, ideas: 0, backlog: 0, assistant: 0, status: 0 };
  let backlogTimer = null;
  let readSequence = 0;
  let readFailure = false;
  let createdTask = null;
  let buildModeSaving = false;
  const buildMode = () => ({ autoBuild: state.status.autoBuild !== false, loaded: typeof state.status.autoBuild === "boolean", saving: buildModeSaving });
  let agentModeSaving = false;
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
  const describe = (task) => window.MefiTasks?.describe?.(task) ?? { stage: done(task) ? "done" : task.status === "awaiting_verification" ? "review" : "open", label: task.status === "active" ? "Working" : done(task) ? "Completed" : task.status === "awaiting_verification" ? "Needs review" : "Queued", summary: task.result?.summary || task.logs?.at(-1)?.text || "" };
  const when = (at) => { const value = new Date(at); return Number.isFinite(value.getTime()) ? value.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""; };
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
  function personalize() {
    const hour = new Date().getHours();
    $("greeting").textContent = `GOOD ${hour < 12 ? "MORNING" : hour < 18 ? "AFTERNOON" : "EVENING"}${person() ? `, ${person()}` : ""}`;
    $("layer").dataset.accent = storage.get("accent", "aurora");
    $("layer").classList.toggle("ws-still", storage.get("motion", "1") === "0");
    if ($("sidebar")) {
      $("sidebar").dataset.accent = storage.get("accent", "aurora");
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
          empty.append(text("p", "", "No project is open yet. Choose a folder and Studio will analyse it and start there."));
          const open = text("button", "primary", "Open a folder");
          open.addEventListener("click", () => $("add-project").click());
          empty.append(open);
        } else empty.append(text("p", "", "Open the desktop app to connect your project folders."));
        $("projects").append(empty);
      }
    }
    const current = project();
    $("project-name").textContent = current?.name || "Your workspace";
    $("project-path").textContent = current?.path || "Pick a folder. Start a conversation. Make progress.";
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
      if (oldId) saveDraft(oldId);
      state.epoch += 1;
      state.tasks = []; state.ideas = []; state.backlog = null; state.backlogUnavailable = false; state.assistant = {}; state.status = {};
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
      welcome.append(text("span", "ws-welcome-star", "✳"), text("h2", "", hasBacklog ? "Let's make a little headway." : "A little room for big ideas."), text("p", "", hasBacklog ? `I'm ${companion()}. Your tasks and ideas are here. We can work through the backlog together, or choose one small thing to do next.` : `I'm ${companion()}. We can think something through together, or give a task its own place on the board.`));
      const suggestions = text("div", "ws-suggestions", "");
      for (const [label, prompt] of [["Where are we?", "Give me a brief status of this project."], ["Find a next step", "What should we work on next in this project?"]]) {
        const button = text("button", "ghost", `${label} ↗`);
        button.addEventListener("click", () => { setMode("chat"); $("input").value = prompt; $("input").focus(); saveDraft(); });
        suggestions.append(button);
      }
      welcome.append(suggestions); list.append(welcome);
    }
    for (const message of messages) {
      const row = text("article", `ws-message ${message.role}`, "");
      row.dataset.messageId = message.id || "";
      const head = text("div", "ws-message-head", "");
      head.append(text("strong", "", message.role === "user" ? person() || "You" : companion()), text("time", "", when(message.at)));
      row.append(head, text("div", "ws-message-body", message.text));
      list.append(row);
    }
    // The welcome reads top-down; only a real conversation pins to its newest line.
    list.scrollTop = !messages.length ? 0 : pinned ? list.scrollHeight : oldTop;
  }
  const scoped = (rows) => rows.filter((row) => !row.projectId || row.projectId === state.activeId);
  const workLabels = { all: "All work", open: "Queue", ideas: "Ideas", review: "Review", done: "Done" };
  function selectWorkFilter(filter) {
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
    return { stage, filter, label: window.MefiStage?.label?.(stage, task) || description.label, summary: stage === "ready" ? task.prompt || description.summary || scheduled?.reason : scheduled?.reason || description.summary, retryAt: scheduled?.retryAt, groupId: scheduled?.groupId, dependencies: scheduled?.dependencies, canRetry: scheduled?.canRetry };
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
    const signature = JSON.stringify([page.map(({ item, isIdea }) => [isIdea, item.runProgress === undefined ? item : { ...item, runProgress: undefined }]), counts, state.filter, state.query, state.limit, state.backlog?.taskStates, state.backlog?.next, state.status.running, companion()]);
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
    if (signature === workSignature) return;
    workSignature = signature;
    const top = $("work-list").scrollTop;
    $("work-list").replaceChildren();
    for (const { item, isIdea } of page) {
      const view = isIdea ? { stage: item.status === "done" ? "done" : "idea", filter: "ideas", label: item.status === "done" ? "Idea completed" : item.taskId ? "Linked to a task" : "Ready to shape", summary: item.detail || "" } : taskView(item);
      const row = text("article", `ws-work-card ${view.filter}${isIdea ? " ws-idea-card" : ""}`, "");
      row.dataset.stage = view.stage; row.dataset.status = view.stage;
      const opener = text("button", "ws-work-open", "");
      if (isIdea) opener.dataset.ideaId = item.id; else opener.dataset.taskId = item.id;
      const label = text("span", "ws-work-status", `${view.stage === "done" ? "✓ " : view.stage === "running" ? "◌ " : ""}${view.label}`);
      if (!isIdea && ranks.has(item.id) && view.stage === "ready") label.append(text("span", "ws-rank", ranks.get(item.id) === 0 ? "Up next" : `#${ranks.get(item.id) + 1}`));
      opener.append(label, text("strong", "ws-work-title", item.title || item.prompt || "Untitled idea"));
      if (view.summary) opener.append(text("span", "ws-work-summary", view.summary));
      const run = !isIdea && (state.status.running || []).find((job) => job.taskId === item.id);
      if (run && Number.isFinite(run.progress)) {
        const progress = document.createElement("progress"); progress.max = 1; progress.value = Math.max(0, Math.min(1, run.progress)); progress.className = "ws-task-progress"; progress.setAttribute("aria-label", `Reported task progress: ${Math.round(progress.value * 100)} percent`); opener.append(progress);
      }
      const stamp = when(view.retryAt || item.doneAt || item.updatedAt || item.createdAt || item.at);
      opener.append(text("span", "ws-work-time", `${view.retryAt ? "Next retry: " : ""}${stamp}${stamp ? " · " : ""}Open ${isIdea ? "idea" : "details"} ↗`));
      opener.addEventListener("click", () => window.MefiNav?.go(isIdea ? "ideas" : "tasks", isIdea ? { ideaId: item.id } : { taskId: item.id, filter: view.filter === "review" ? "all" : view.filter }));
      row.append(opener);
      const actions = text("div", "ws-card-actions", "");
      if (isIdea && item.status !== "done") {
        if (item.taskId && tasks.some((task) => task.id === item.taskId)) {
          const linked = text("button", "ghost mini", "View task ↗"); linked.addEventListener("click", () => window.MefiNav?.go("tasks", { taskId: item.taskId })); actions.append(linked);
        } else actions.append(cardAction("Turn into task ↗", "promote", { ideaId: item.id }));
      } else if (view.stage === "ready") actions.append(cardAction(item.pin ? "Prioritized" : "Do next", "prioritize", { taskId: item.id }));
      else if (view.stage === "approval") {
        const review = text("button", "ghost mini", "Review build ↗");
        review.addEventListener("click", () => window.MefiNav?.go("tasks", { taskId: item.id, filter: "all" }));
        actions.append(review);
      }
      else if (view.stage === "blocked" && view.canRetry !== false && !view.dependencies?.some((dependency) => !dependency.done)) actions.append(cardAction("Try again", "retry", { taskId: item.id }));
      else if (view.stage === "grouped" && tasks.some((task) => task.id === view.groupId)) {
        const plan = text("button", "ghost mini", "View plan ↗"); plan.addEventListener("click", () => window.MefiNav?.go("tasks", { taskId: view.groupId, filter: "all" })); actions.append(plan);
      }
      if (actions.children.length) row.append(actions);
      $("work-list").append(row);
    }
    if (!visible.length) {
      const empty = text("div", "ws-work-empty", "");
      const headings = { all: "Your work starts here", done: "A home for finished work", review: "Nothing waiting for review", ideas: "Space for your next idea", open: "A clear runway" };
      const hints = { all: "Create a task or plan an idea. Everything you save in this project will appear here.", done: "Verified and archived tasks stay here. Finished runs awaiting checks appear in Review.", review: "Finished runs and tasks needing your attention will appear here.", ideas: "Collected ideas stay here until you turn them into tasks. Older ideas are kept, too.", open: "Your queue is clear. Start with an idea, or use Give a task to add something new." };
      const elsewhere = state.query && state.filter !== "all" && counts.all > 0;
      empty.append(text("span", "ws-empty-symbol", state.filter === "done" ? "✓" : "◇"), text("h3", "", state.query ? `No matches in ${workLabels[state.filter].toLowerCase()}` : headings[state.filter]), text("p", "", state.query ? elsewhere ? `${counts.all} ${counts.all === 1 ? "match is" : "matches are"} available in other views.` : "Try a different word or clear your search." : hints[state.filter]));
      if (elsewhere) { const all = text("button", "ghost", "Search all work"); all.addEventListener("click", () => { selectWorkFilter("all"); $("all").focus(); }); empty.append(all); }
      else if (state.query) { const clear = text("button", "ghost", "Clear search"); clear.addEventListener("click", clearWorkSearch); empty.append(clear); }
      else if (["open", "all"].includes(state.filter)) { const button = text("button", "ghost", "Give a task ↗"); button.addEventListener("click", () => { setMode("work"); $("input").focus(); }); empty.append(button); }
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
    $("backlog-title").textContent = state.backlogUnavailable ? "Backlog status unavailable" : paused || held ? "Ready when you are" : draining ? "One step closer" : "A little progress, every pass";
    $("backlog-summary").textContent = state.backlogUnavailable ? "Couldn't refresh the queue. Use Retry loading below the conversation." : held ? "Agents are waiting for you. Press Start agents above to let this queue move." : backlog?.summary || (backlog ? paused ? "New work is paused. Running jobs finish normally." : "Work through existing tasks and ideas in small batches." : api()?.backlogStatus ? "Checking your project's backlog…" : "Open the updated desktop app to manage the backlog.");
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
      control.title = "Both modes use the Assistant to plan, delegate subtasks and review results. Swarm also works across ready tasks; Cluster keeps agents on one shared task. Applies to all projects; current work finishes when switching.";
    }
    if (note) note.textContent = choice.saving ? "Saving agent mode…" : !choice.loaded ? "Loading agent mode…" : choice.mode === "swarm"
      ? "Agents collaborate on tasks and their subtasks across the queue. Pause, approvals and capacity still apply."
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
    $("companion-name").textContent = held && !working ? `${nickname} is waiting for you` : paused ? `${nickname} is taking a breath` : working ? `${nickname} is making progress` : `${nickname} is here`;
    const action = assistant.action;
    const waiting = state.backlog?.waiting || state.status.waiting;
    const narration = working ? `Working on ${running[0].title || "your task"}${running.length > 1 ? ` · ${running.length} jobs running` : ""}.` : paused ? "New work is paused. Any running jobs will finish normally." : state.pending ? "I'm listening. Your message is on its way." : waiting ? (typeof waiting === "string" ? waiting : waiting.text || waiting.reason || "Work is queued and waiting for an available worker.") : state.backlog?.draining && state.backlog?.next?.length ? `Next I'll pick up ${state.backlog.next[0].title}.` : reviewing ? "There's work that needs a closer look. Open Review to see results and blockers." : action?.text && !["idle", "listening"].includes(action.text) ? action.text : "Tell me what you have in mind. We can take it one step at a time.";
    $("narration").textContent = held && !working ? "Agents are waiting for you. Press Start agents when you're ready; your tasks and ideas are saved." : !working && !paused && workersOff ? "Coding workers are off. Your tasks are saved; use Work through backlog when you're ready to start them." : narration;
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
    const note = !api() ? "Live status needs the desktop app." : launchHold ? "Nothing has run since launch." : assistantPaused && admissionOff ? "All new work is held. Running jobs finish normally." : assistantPaused ? "The assistant is paused; queued tasks still start when a worker is free." : admissionOff ? "Queued tasks wait; the assistant still replies and takes answers." : keyMissing ? "Connect an AI in Settings to start." : state.status.waiting ? String(state.status.waiting) : running.length ? `${running.length} job${running.length === 1 ? "" : "s"} running` : "Waiting for work.";
    return { held, launchHold, label, note, running, tone: !api() ? "idle" : launchHold ? "warn" : held ? "held" : keyMissing ? "warn" : running.length ? "busy" : "ok" };
  }
  const showFilter = (filter) => { state.filter = filter; state.limit = 20; $("work-list").scrollTop = 0; renderWork(); };
  // Studio at a glance: the landing strip answers "is anything waiting on me,
  // is anything running, is the machine holding work" before the conversation.
  // Service, workers, attention and next come from state this module already
  // holds; the machine and usage tiles are painted by their own feeds.
  function renderDashboard() {
    if (!$("dash-service")) return;
    const run = runState();
    $("dash-service").dataset.tone = run.tone;
    $("dash-service-value").textContent = run.label;
    $("dash-service-note").textContent = run.note;
    $("pause").textContent = run.launchHold ? "Start agents" : run.held ? "Resume" : "Pause";
    $("pause").title = run.launchHold ? "Start the assistant and the coding workers. Nothing has run since Studio opened." : run.held ? "Let new work start again." : "Hold all new work: queued tasks, builds and the assistant's own suggestions. Running jobs finish normally.";
    // The one control the launch hold needs reads as the primary action.
    $("pause").classList.toggle("primary", run.launchHold);
    $("pause").classList.toggle("ghost", !run.launchHold);
    const running = run.running;
    const limit = state.status.adaptiveParallel ? null : Number(state.status.parallel) || null;
    $("dash-workers").dataset.tone = running.length ? "busy" : "idle";
    $("dash-workers-value").textContent = running.length ? `${running.length} building` : "0 running";
    $("dash-workers-note").textContent = running.length ? running.map((job) => job.title || "task").slice(0, 2).join(" · ") : limit ? `Up to ${limit} at once` : state.status.adaptiveParallel ? "Machine managed" : "";
    const questions = (Array.isArray(state.assistant.questions) ? state.assistant.questions : []).filter((question) => question?.status === "open");
    const review = scoped(state.tasks).filter((task) => taskView(task).filter === "review");
    const waiting = questions.length + review.length;
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
    $("input").placeholder = mode === "work" ? "What should we build or improve? Include what a good result looks like…" : "Ask a question, think through an idea, or tell me where you're stuck…";
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
  async function submit(event) {
    event?.preventDefault();
    const value = $("input").value.trim();
    if (!value || state.pending || state.switching || !state.activeId || !api()) return;
    const id = state.activeId; const mode = state.mode;
    state.pending = true; controls(); renderCompanion(); feedback(mode === "work" ? "Adding your task…" : "Waiting for a reply…");
    createdTask = null;
    if ($("created-task")) $("created-task").hidden = true;
    let saved = false;
    try {
      const result = guard(await (mode === "work" ? api().tasksCreate({ title: value.split("\n")[0].slice(0, 180), prompt: value, projectId: id }) : api().assistantMessage(value, id)));
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
    const run = Promise.allSettled(["tasksList", "assistantState", "assistantStatus", "jevStatus", "ideasList", "backlogStatus"].map((method) => readWithDeadline(() => api()[method]?.()))).then((results) => {
      if (epoch !== state.epoch || sequence !== readSequence) return;
      if (before.tasks === revisions.tasks && results[0].status === "fulfilled" && results[0].value?.tasks && belongs(results[0].value)) state.tasks = results[0].value.tasks;
      if (before.assistant === revisions.assistant && results[1].status === "fulfilled" && results[1].value?.state && belongs(results[1].value.state)) state.assistant = results[1].value.state;
      if (before.status === revisions.status && results[2].status === "fulfilled" && results[2].value?.status && belongs(results[2].value.status)) state.status = results[2].value.status;
      if (before.ideas === revisions.ideas && results[4].status === "fulfilled" && results[4].value?.ideas && belongs(results[4].value)) state.ideas = results[4].value.ideas;
      if (before.backlog === revisions.backlog && results[5].status === "fulfilled" && results[5].value?.ok && belongs(results[5].value)) state.backlog = results[5].value;
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
  function enter() {
    init(); window.MefiIdle?.exit?.(); $("layer").hidden = false;
    document.body.classList.add("workspace-active");
    renderMachineTile(); renderUsageTile();
    // Usage has no push; one read on entry (cached 5 min by the tracker).
    if (api()) window.MefiUsageTracker?.refresh?.()?.catch?.(() => {});
    $("layer").focus({ preventScroll: true });
    // Startup already reads and paints the workspace. Opening it underneath
    // the loading layer joins that work instead of issuing a second batch.
    return startupPending || window.MefiBoot?.isActive?.() ? ready() : refresh(true);
  }
  function exit() { if (!$("layer")) return; $("layer").hidden = true; document.body.classList.remove("workspace-active"); saveDraft(); }
  function init() {
    if (initialized || !$("layer")) return; initialized = true;
    $("form").addEventListener("submit", submit);
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
          const result = guard(await api().assistantControl("start"));
          if (result.state) state.assistant = result.state;
          state.status = { ...state.status, ...(result.autopilot || {}), held: false };
          renderCompanion(); renderBacklog(); scheduleBacklogRead(true);
          feedback(result.running ? "Agents started. New work can begin." : "Agents are on. The assistant was paused last time; press Resume to let new work start.");
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
        storage.set(key, $(id).value);
        // A locked Void collection theme is explained in place: the select
        // fires on every arrow key, so it must never change the view.
        if (id === "accent") window.MefiMusic?.applyTheme?.($(id).value === "sage" ? "forest" : $(id).value, true, { navigate: false });
        personalize();
      });
    }
    const syncThemeChoice = () => {
      const theme = window.MefiMusic?.status?.().theme;
      if (!theme) return;
      const choice = theme === "forest" ? "sage" : theme;
      // The select must carry the option or it goes blank, and the saved accent
      // follows the real theme so data-accent never drifts from it.
      const options = $("accent").options ? [...$("accent").options] : null;
      if (options && !options.some((option) => option.value === choice)) return;
      $("accent").value = choice;
      if (storage.get("accent", "aurora") !== choice) { storage.set("accent", choice); personalize(); }
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
    api()?.onMachineStatus?.((status) => { state.machine = status || null; if (active()) renderMachineTile(); });
    window.addEventListener("mefi:usage-report", (event) => { state.usage = event.detail || null; if (active()) renderUsageTile(); });
    $("dash-attention")?.addEventListener("click", () => { if ($("dash-attention").dataset.target === "ask") window.MefiNav?.go?.("command", { rail: "ask" }); else showFilter("review"); });
    $("dash-next")?.addEventListener("click", () => showFilter("open"));
    $("dash-usage")?.addEventListener("click", () => window.MefiUsageTracker?.openTab?.());
    personalize(); renderProjects(); renderWork(); renderBacklog();
    loadInitialWorkspace();
    if (!api()) $("jev").textContent = "Desktop app connects your tools";
    window.MefiBoot?.pollStart?.("workspace.refresh", () => { if (!document.hidden && active()) refresh(); }, 15000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && active()) refresh(); });
  }
  window.MefiWorkspace = { enter, exit, refresh, ready, isActive: active, buildMode, setAutoBuild, agentMode, setAgentMode };
  init();
})();
