// The working home: project context, a conversation, and durable work results.
// No model calls on navigation. Events keep it fresh; reads are only a backstop.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(`workspace-${id}`);
  const api = () => window.mefiStudio;
  const state = { projects: [], activeId: null, tasks: [], ideas: [], backlog: null, assistant: {}, status: {}, filter: "open", query: "", limit: 20, mode: "chat", pending: false, busyAction: null, switching: false, epoch: 0 };
  let initialized = false;
  let refreshFlight = null;
  let threadSignature = "";
  let workSignature = "";
  const signatures = new Map();
  const revisions = { tasks: 0, ideas: 0, backlog: 0, assistant: 0, status: 0 };
  let backlogTimer = null;
  let readSequence = 0;
  let readFailure = false;
  const storage = {
    get(key, fallback = "") { try { return localStorage.getItem(`mefiStudio.workspace.${key}`) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(`mefiStudio.workspace.${key}`, value); } catch { /* private store */ } },
  };
  const person = () => storage.get("person").trim();
  const companion = () => storage.get("companion", "Mefi").trim() || "Mefi";
  const project = () => state.projects.find((item) => item.id === state.activeId);
  const text = (tag, className, value) => { const node = document.createElement(tag); node.className = className; node.textContent = String(value ?? ""); return node; };
  const done = (task) => ["done", "archived", "completed"].includes(task.status);
  const describe = (task) => window.MefiTasks?.describe?.(task) ?? { stage: done(task) ? "done" : task.status === "awaiting_verification" ? "review" : "open", label: task.status === "active" ? "Working" : done(task) ? "Completed" : task.status === "awaiting_verification" ? "Needs review" : "Queued", summary: task.result?.summary || task.logs?.at(-1)?.text || "" };
  const when = (at) => { const value = new Date(at); return Number.isFinite(value.getTime()) ? value.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""; };
  function feedback(message, error = false, source = "action") { readFailure = source === "read"; $("feedback").textContent = message; $("feedback").classList.toggle("error", error); }
  function guard(result) { if (!result?.ok) throw new Error(result?.error || "The app couldn't complete that action. Try again."); return result; }
  function active() { return Boolean($("layer") && !$("layer").hidden); }
  function controls() {
    const unavailable = !api()?.projectsList || !state.activeId;
    $("send").disabled = state.pending || state.switching || unavailable;
    $("send").firstChild.textContent = state.pending ? "Sending… " : state.mode === "work" ? "Create task " : "Send message ";
    $("add-project").disabled = state.pending || Boolean(state.busyAction) || state.switching || !api()?.projectsAdd;
    for (const button of $("projects").querySelectorAll("button")) button.disabled = state.pending || Boolean(state.busyAction) || state.switching;
    $("mode-chat").disabled = $("mode-work").disabled = state.pending;
    $("pause").disabled = !api()?.assistantControl || state.switching;
    $("reveal").disabled = !project()?.path || !api()?.shellReveal;
    $("run-backlog").disabled = !state.activeId || !state.backlog || state.backlogUnavailable || !api()?.backlogControl || state.switching || Boolean(state.busyAction);
    for (const button of $("work-list").querySelectorAll("button")) {
      if (button.dataset.backlogAction) button.disabled = !api()?.backlogControl || state.switching || Boolean(state.busyAction);
    }
  }
  function personalize() {
    const hour = new Date().getHours();
    $("greeting").textContent = `GOOD ${hour < 12 ? "MORNING" : hour < 18 ? "AFTERNOON" : "EVENING"}${person() ? `, ${person()}` : ""}`;
    $("layer").dataset.accent = storage.get("accent", "gold");
    $("layer").classList.toggle("ws-still", storage.get("motion", "1") === "0");
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
      if (!rows.length) $("projects").append(text("p", "ws-empty-project", api() ? "Your projects will appear here." : "Open the desktop app to connect your project folders."));
    }
    const current = project();
    $("project-name").textContent = current?.name || "Your workspace";
    $("project-path").textContent = current?.path || "Pick a folder. Start a conversation. Make progress.";
    $("project-path").title = current?.path || "";
    $("composer-context").textContent = current ? `In ${current.name}` : "Desktop app required";
    controls();
  }
  function adoptProjects(result) {
    if (!result?.projects) return;
    const oldId = state.activeId;
    state.projects = result.projects;
    state.activeId = result.activeId;
    if (oldId !== state.activeId) {
      if (oldId) storage.set(`draft.${oldId}`, $("input").value);
      state.epoch += 1;
      state.tasks = []; state.ideas = []; state.backlog = null; state.backlogUnavailable = false; state.assistant = {}; state.status = {};
      state.filter = "open"; state.query = ""; state.limit = 20;
      $("work-search").value = "";
      $("input").value = storage.get(`draft.${state.activeId}`);
      threadSignature = ""; workSignature = "";
      renderThread(); renderWork(); renderCompanion(); renderBacklog();
      window.dispatchEvent(new CustomEvent("mefi:project-changed", { detail: { projectId: state.activeId } }));
    }
    renderProjects();
  }
  async function selectProject(id) {
    if (state.pending || state.busyAction || state.switching || id === state.activeId) return;
    state.switching = true; controls(); feedback("Opening project…");
    try {
      if (refreshFlight) await refreshFlight;
      adoptProjects(guard(await api().projectsSelect(id)));
      if (await refresh(true)) feedback(`You're in ${project()?.name || "your project"}.`);
    } catch (error) { feedback(error.message, true); }
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
    list.scrollTop = pinned ? list.scrollHeight : oldTop;
  }
  const scoped = (rows) => rows.filter((row) => !row.projectId || row.projectId === state.activeId);
  function taskView(task) {
    const description = describe(task);
    const scheduled = state.backlog?.taskStates?.find((item) => item.id === task.id);
    const stage = done(task) ? "done" : task.status === "active" ? "running" : scheduled?.stage || (description.stage === "review" ? "review" : "ready");
    const filter = stage === "done" ? "done" : ["review", "blocked"].includes(stage) ? "review" : "open";
    const labels = { ready: "Ready", running: "Working", review: "Awaiting verification", blocked: "Needs attention", cooling: "Retry scheduled", waiting: "Waiting on prerequisites", grouped: "Included in a plan", done: "Done" };
    return { stage, filter, label: labels[stage] || description.label, summary: stage === "ready" ? task.prompt || description.summary || scheduled?.reason : scheduled?.reason || description.summary, retryAt: scheduled?.retryAt, groupId: scheduled?.groupId, dependencies: scheduled?.dependencies, canRetry: scheduled?.canRetry };
  }
  function cardAction(label, action, payload) {
    const button = text("button", "ghost mini", label);
    button.dataset.backlogAction = action;
    button.addEventListener("click", () => controlBacklog(action, payload));
    return button;
  }
  function renderWork() {
    const tasks = scoped(state.tasks), ideas = scoped(state.ideas);
    const counts = { open: 0, review: 0, done: 0, ideas: ideas.length };
    for (const task of tasks) counts[taskView(task).filter] += 1;
    for (const button of $("layer").querySelectorAll("[data-work-filter]")) {
      button.setAttribute("aria-pressed", String(button.dataset.workFilter === state.filter));
      button.querySelector("span").textContent = counts[button.dataset.workFilter] || 0;
    }
    const ranks = new Map((state.backlog?.next || []).map((item, index) => [item.id, index]));
    const matches = (row) => !state.query || `${row.title || ""} ${row.prompt || ""} ${row.detail || ""} ${(row.tags || []).join(" ")}`.toLowerCase().includes(state.query);
    const visible = (state.filter === "ideas"
      ? ideas.filter(matches).sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || Number(Boolean(a.taskId)) - Number(Boolean(b.taskId)) || (a.at || 0) - (b.at || 0))
      : tasks.filter((task) => taskView(task).filter === state.filter && matches(task)).sort((a, b) => state.filter === "open" ? Number(b.status === "active") - Number(a.status === "active") || (ranks.get(a.id) ?? 99999) - (ranks.get(b.id) ?? 99999) || (a.createdAt || 0) - (b.createdAt || 0) : (b.doneAt || b.updatedAt || b.createdAt || 0) - (a.doneAt || a.updatedAt || a.createdAt || 0)));
    const page = visible.slice(0, state.limit);
    const signature = JSON.stringify([page, state.filter, state.query, state.limit, state.backlog?.taskStates, state.backlog?.next, state.status.running, companion()]);
    $("show-more").hidden = visible.length <= state.limit;
    $("show-more").textContent = `Show ${Math.min(20, Math.max(0, visible.length - state.limit))} more · ${Math.max(0, visible.length - state.limit)} remaining`;
    if (signature === workSignature) return;
    workSignature = signature;
    const top = $("work-list").scrollTop;
    $("work-list").replaceChildren();
    for (const item of page) {
      const isIdea = state.filter === "ideas";
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
      else if (view.stage === "blocked" && view.canRetry !== false && !view.dependencies?.some((dependency) => !dependency.done)) actions.append(cardAction("Try again", "retry", { taskId: item.id }));
      else if (view.stage === "grouped" && tasks.some((task) => task.id === view.groupId)) {
        const plan = text("button", "ghost mini", "View plan ↗"); plan.addEventListener("click", () => window.MefiNav?.go("tasks", { taskId: view.groupId, filter: "all" })); actions.append(plan);
      }
      if (actions.children.length) row.append(actions);
      $("work-list").append(row);
    }
    if (!visible.length) {
      const empty = text("div", "ws-work-empty", "");
      const headings = { done: "A home for finished work", review: "Nothing waiting for review", ideas: "Space for your next idea", open: "A clear runway" };
      const hints = { done: "Verified and archived tasks stay here. Finished runs awaiting checks appear in Review.", review: "Finished runs and tasks needing your attention will appear here.", ideas: "Collected ideas stay here until you turn them into tasks. Older ideas are kept, too.", open: "Your queue is clear. Start with an idea, or use Give a task to add something new." };
      empty.append(text("span", "ws-empty-symbol", state.filter === "done" ? "✓" : "◇"), text("h3", "", state.query ? "No matches in this view" : headings[state.filter]), text("p", "", state.query ? "Try another search or switch to a different view." : hints[state.filter]));
      if (state.query) { const clear = text("button", "ghost", "Clear search"); clear.addEventListener("click", () => { state.query = ""; $("work-search").value = ""; renderWork(); }); empty.append(clear); }
      else if (state.filter === "open") { const button = text("button", "ghost", "Give a task ↗"); button.addEventListener("click", () => { setMode("work"); $("input").focus(); }); empty.append(button); }
      $("work-list").append(empty);
    }
    $("work-list").scrollTop = top;
    controls();
  }
  function renderBacklog() {
    const backlog = state.backlog;
    const counts = backlog?.counts || {};
    const paused = backlog?.paused || state.assistant.status === "paused";
    const draining = Boolean(backlog?.draining && !paused);
    $("run-backlog").textContent = state.busyAction === "run" ? "Preparing the backlog…" : state.busyAction === "pause" ? "Pausing…" : draining ? "Pause backlog" : "Work through backlog ↗";
    $("backlog-title").textContent = state.backlogUnavailable ? "Backlog status unavailable" : paused ? "Ready when you are" : draining ? "One step closer" : "A little progress, every pass";
    $("backlog-summary").textContent = state.backlogUnavailable ? "Couldn't refresh the queue. Use Retry loading below the conversation." : backlog?.summary || (backlog ? paused ? "New work is paused. Running jobs finish normally." : "Work through existing tasks and ideas in small batches." : api()?.backlogStatus ? "Checking your project's backlog…" : "Open the updated desktop app to manage the backlog.");
    $("backlog-metrics").replaceChildren();
    for (const [key, label] of [["ready", "ready"], ["running", "working"], ["waiting", "waiting"], ["blocked", "need attention"]]) {
      if (key === "waiting" && !counts.waiting) continue;
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
  function scheduleBacklogRead() {
    revisions.backlog += 1;
    if (backlogTimer || !active() || document.hidden) return;
    backlogTimer = setTimeout(() => { backlogTimer = null; if (active() && !document.hidden) refresh(); }, 300);
  }
  function renderCompanion() {
    const assistant = state.assistant;
    const paused = assistant.status === "paused" || assistant.prefs?.paused;
    const running = state.status.running || [];
    const working = running.length > 0;
    const reviewing = state.tasks.some((task) => taskView(task).filter === "review");
    const nickname = companion();
    $("companion-name").textContent = paused ? `${nickname} is taking a breath` : working ? `${nickname} is making progress` : `${nickname} is here`;
    const action = assistant.action;
    const waiting = state.backlog?.waiting || state.status.waiting;
    const narration = working ? `Working on ${running[0].title || "your task"}${running.length > 1 ? ` · ${running.length} jobs running` : ""}.` : paused ? "New work is paused. Any running jobs will finish normally." : state.pending ? "I'm listening. Your message is on its way." : waiting ? (typeof waiting === "string" ? waiting : waiting.text || waiting.reason || "Work is queued and waiting for an available worker.") : state.backlog?.draining && state.backlog?.next?.length ? `Next I'll pick up ${state.backlog.next[0].title}.` : reviewing ? "There's work that needs a closer look. Open Review to see results and blockers." : action?.text && !["idle", "listening"].includes(action.text) ? action.text : "Tell me what you have in mind. We can take it one step at a time.";
    $("narration").textContent = narration;
    $("companion-track").dataset.station = working ? "make" : reviewing ? "review" : "listen";
    $("companion-track").classList.toggle("busy", working || state.pending);
    $("pause").textContent = paused ? "Resume" : "Pause";
    $("connection").textContent = !api() ? "Browser preview" : paused ? "New work paused" : assistant.ai?.keyPresent === false ? "Connect an AI in Settings" : working ? "Working with you" : "Ready when you are";
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
  function renderJev(value) {
    const status = value?.status || value;
    let label = "status unavailable";
    if (status) {
      label = status.enabled === false ? "paused in Settings" : !status.configured ? "connect in Settings" : status.accountingPending ? "waiting for usage accounting" : status.lastError ? "needs attention in Settings" : status.phase === "running" ? "reviewing task intake" : status.lastSuccessAt ? "task intake ready" : "configured · awaiting first intake";
    }
    $("jev").textContent = `Jev · ${label}`;
    $("jev").title = status?.lastError || "Jev advises on related tasks. Your work stays on the board.";
  }
  function setMode(mode) {
    if (state.pending) return;
    state.mode = mode;
    $("mode-chat").setAttribute("aria-pressed", String(mode === "chat")); $("mode-work").setAttribute("aria-pressed", String(mode === "work"));
    $("input").placeholder = mode === "work" ? "What should we build or improve? Include what a good result looks like…" : "Ask a question, think through an idea, or tell me where you're stuck…";
    $("compose-hint").textContent = mode === "work" ? "Creates a task in this project · Enter to add" : "Enter to send · Shift + Enter for a new line";
    controls();
  }
  function saveDraft() { if (state.activeId) storage.set(`draft.${state.activeId}`, $("input").value); }
  async function submit(event) {
    event?.preventDefault();
    const value = $("input").value.trim();
    if (!value || state.pending || state.switching || !state.activeId || !api()) return;
    const id = state.activeId; const mode = state.mode;
    state.pending = true; controls(); renderCompanion(); feedback(mode === "work" ? "Adding your task…" : "Waiting for a reply…");
    try {
      const result = guard(await (mode === "work" ? api().tasksCreate({ title: value.split("\n")[0].slice(0, 180), prompt: value, projectId: id }) : api().assistantMessage(value, id)));
      if (id !== state.activeId) return;
      if ($("input").value.trim() === value) $("input").value = "";
      saveDraft();
      if (result.state) { state.assistant = result.state; renderThread(); }
      if (mode === "work") state.filter = "open";
      if (await refresh(true)) feedback(mode === "work" ? "Task added. Follow it in Your work; open it for details." : "Reply received.");
    } catch (error) { feedback(`${error.message} Your draft is still here.`, true); }
    finally { state.pending = false; controls(); renderCompanion(); }
  }
  async function refresh(force = false) {
    if (!api() || (!active() && !force)) return;
    if (refreshFlight && !force) return refreshFlight;
    const epoch = state.epoch;
    const sequence = ++readSequence;
    const before = { ...revisions };
    const belongs = (value) => !value?.projectId || value.projectId === state.activeId;
    const run = Promise.allSettled([api().tasksList?.(), api().assistantState?.(), api().assistantStatus?.(), api().jevStatus?.(), api().ideasList?.(), api().backlogStatus?.()]).then((results) => {
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
      if (failures.length) feedback(`Couldn't refresh ${failures.join(" and ")}. Your last loaded information is still here.`, true, "read");
      else if (readFailure) feedback("");
      return failures.length === 0;
    });
    refreshFlight = run;
    try { return await run; } finally { if (refreshFlight === run) refreshFlight = null; }
  }
  function enter() {
    init(); window.MefiIdle?.exit?.(); $("layer").hidden = false;
    document.body.classList.add("workspace-active");
    $("layer").focus({ preventScroll: true });
    refresh(true);
  }
  function exit() { if (!$("layer")) return; $("layer").hidden = true; document.body.classList.remove("workspace-active"); saveDraft(); }
  function init() {
    if (initialized || !$("layer")) return; initialized = true;
    $("form").addEventListener("submit", submit);
    $("retry").addEventListener("click", () => refresh(true));
    $("input").addEventListener("input", saveDraft);
    $("input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); } });
    $("mode-chat").addEventListener("click", () => setMode("chat")); $("mode-work").addEventListener("click", () => setMode("work"));
    for (const button of $("layer").querySelectorAll("[data-work-filter]")) button.addEventListener("click", () => { state.filter = button.dataset.workFilter; state.limit = 20; $("work-list").scrollTop = 0; renderWork(); });
    $("work-search").addEventListener("input", () => { state.query = $("work-search").value.trim().toLowerCase(); state.limit = 20; $("work-list").scrollTop = 0; renderWork(); });
    $("show-more").addEventListener("click", () => { state.limit += 20; renderWork(); });
    $("run-backlog").addEventListener("click", () => controlBacklog(state.backlog?.draining && !state.backlog?.paused ? "pause" : "run"));
    $("add-project").addEventListener("click", async () => {
      if (state.pending || state.busyAction || state.switching) return;
      state.switching = true; controls();
      try { const result = await api().projectsAdd(); if (result?.canceled || result?.cancelled) return; adoptProjects(guard(result)); await refresh(true); feedback("Project added. Select it in the sidebar to start working."); }
      catch (error) { feedback(error.message, true); } finally { state.switching = false; controls(); }
    });
    $("reveal").addEventListener("click", () => api()?.shellReveal(project()?.path));
    $("pause").addEventListener("click", async () => {
      $("pause").disabled = true;
      try { const paused = state.assistant.status === "paused" || state.assistant.prefs?.paused; const result = guard(await api().assistantControl(paused ? "resume" : "pause")); state.assistant = result.state; renderCompanion(); scheduleBacklogRead(); feedback(paused ? "New work can start again." : "New work paused. Running jobs finish normally."); }
      catch (error) { feedback(error.message, true); } finally { controls(); }
    });
    for (const [id, key, fallback] of [["person-name", "person", ""], ["agent-name", "companion", "Mefi"], ["accent", "accent", "gold"]]) {
      $(id).value = storage.get(key, fallback);
      $(id).addEventListener("input", () => {
        storage.set(key, $(id).value);
        if (id === "accent") window.MefiMusic?.applyTheme?.($(id).value === "sage" ? "forest" : $(id).value);
        personalize();
      });
    }
    const syncThemeChoice = () => {
      const theme = window.MefiMusic?.status?.().theme;
      if (theme) $("accent").value = theme === "forest" ? "sage" : theme;
    };
    window.addEventListener("mefi-theme-change", syncThemeChoice);
    syncThemeChoice();
    $("motion").checked = storage.get("motion", "1") !== "0";
    $("motion").addEventListener("change", () => { storage.set("motion", $("motion").checked ? "1" : "0"); personalize(); });
    for (const dest of window.MefiNav?.list?.() || []) {
      if (dest.id === "workspace" || dest.id === "studio" || dest.kind === "action" || dest.layer === "transient") continue;
      const button = text("button", "ghost", ""); button.dataset.nav = dest.id; button.append(text("span", "", dest.short), text("kbd", "", dest.key || "")); $("tool-links").append(button);
    }
    api()?.onProjects?.((result) => { adoptProjects(result); refresh(true); });
    api()?.onTasks?.((tasks) => { if (tasks?.some((task) => task.projectId && task.projectId !== state.activeId)) return; revisions.tasks += 1; state.tasks = tasks || []; if (active()) { renderWork(); renderCompanion(); } scheduleBacklogRead(); });
    api()?.onIdeas?.((ideas) => { if (ideas?.some((idea) => idea.projectId && idea.projectId !== state.activeId)) return; revisions.ideas += 1; state.ideas = ideas || []; if (active()) renderWork(); scheduleBacklogRead(); });
    api()?.onAssistant?.((payload) => { if (payload?.state?.projectId && payload.state.projectId !== state.activeId) return; revisions.assistant += 1; if (payload?.state) state.assistant = payload.state; if (active()) { renderThread(); renderCompanion(); } });
    api()?.onAssistantStatus?.((status) => { if (status?.projectId && status.projectId !== state.activeId) return; revisions.status += 1; state.status = status || {}; if (active()) { renderCompanion(); renderWork(); } scheduleBacklogRead(); });
    personalize(); renderProjects(); renderWork(); renderBacklog();
    api()?.projectsList?.().then((result) => { adoptProjects(guard(result)); return refresh(true); }).catch((error) => feedback(error.message, true));
    if (!api()) $("jev").textContent = "Desktop app connects your tools";
    window.MefiBoot?.pollStart?.("workspace.refresh", () => { if (!document.hidden && active()) refresh(); }, 15000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && active()) refresh(); });
  }
  window.MefiWorkspace = { enter, exit, init, refresh, isActive: active, describe };
  init();
})();
