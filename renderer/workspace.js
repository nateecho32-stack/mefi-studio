// The working home: project context, a conversation, and durable work results.
// No model calls on navigation. Events keep it fresh; reads are only a backstop.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(`workspace-${id}`);
  const api = () => window.mefiStudio;
  const state = { projects: [], activeId: null, tasks: [], assistant: {}, status: {}, filter: "open", mode: "chat", pending: false, switching: false, epoch: 0 };
  let initialized = false;
  let refreshFlight = null;
  let threadSignature = "";
  let workSignature = "";
  const signatures = new Map();
  const revisions = { tasks: 0, assistant: 0, status: 0 };
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
    $("add-project").disabled = state.pending || state.switching || !api()?.projectsAdd;
    for (const button of $("projects").querySelectorAll("button")) button.disabled = state.pending || state.switching;
    $("mode-chat").disabled = $("mode-work").disabled = state.pending;
    $("pause").disabled = !api()?.assistantControl || state.switching;
    $("reveal").disabled = !project()?.path || !api()?.shellReveal;
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
      state.tasks = []; state.assistant = {}; state.status = {};
      state.filter = "open";
      $("input").value = storage.get(`draft.${state.activeId}`);
      threadSignature = ""; workSignature = "";
      renderThread(); renderWork(); renderCompanion();
      window.dispatchEvent(new CustomEvent("mefi:project-changed", { detail: { projectId: state.activeId } }));
    }
    renderProjects();
  }
  async function selectProject(id) {
    if (state.pending || state.switching || id === state.activeId) return;
    state.switching = true; controls(); feedback("Opening project…");
    try {
      adoptProjects(guard(await api().projectsSelect(id)));
      if (await refresh(true)) feedback(`You're in ${project()?.name || "your project"}.`);
    } catch (error) { feedback(error.message, true); }
    finally { state.switching = false; controls(); }
  }
  function renderThread() {
    const messages = (state.assistant.messages || []).filter((message) => ["user", "assistant"].includes(message.role) && (!message.projectId || message.projectId === state.activeId)).slice(-80);
    const signature = JSON.stringify([messages, state.activeId, companion(), person()]);
    if (signature === threadSignature) return;
    threadSignature = signature;
    const list = $("thread");
    const pinned = list.scrollTop + list.clientHeight >= list.scrollHeight - 60;
    const oldTop = list.scrollTop;
    list.replaceChildren();
    if (!messages.length) {
      const welcome = text("div", "ws-welcome", "");
      welcome.append(text("span", "ws-welcome-star", "✳"), text("h2", "", `A little room for big ideas.`), text("p", "", `I'm ${companion()}. We can think something through together, or give a task its own place on the board.`));
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
  function renderWork() {
    const tasks = state.tasks.filter((task) => !task.projectId || task.projectId === state.activeId);
    const counts = { open: 0, review: 0, done: 0 };
    for (const task of tasks) counts[describe(task).stage] += 1;
    for (const button of $("layer").querySelectorAll("[data-work-filter]")) {
      button.setAttribute("aria-pressed", String(button.dataset.workFilter === state.filter));
      button.querySelector("span").textContent = counts[button.dataset.workFilter];
    }
    const visible = tasks.filter((task) => describe(task).stage === state.filter).sort((a, b) => state.filter === "open" ? Number(b.status === "active") - Number(a.status === "active") || (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0) : (b.doneAt || b.updatedAt || b.createdAt || 0) - (a.doneAt || a.updatedAt || a.createdAt || 0));
    const signature = JSON.stringify([visible, state.filter]);
    if (signature === workSignature) return;
    workSignature = signature;
    $("work-list").replaceChildren();
    for (const task of visible) {
      const description = describe(task);
      const row = text("button", `ws-work-card ${description.stage}`, "");
      row.dataset.taskId = task.id;
      row.append(text("span", "ws-work-status", `${description.stage === "done" ? "✓ " : task.status === "active" ? "◌ " : ""}${description.label}`), text("strong", "ws-work-title", task.title || task.prompt || "Untitled task"));
      if (description.summary) row.append(text("span", "ws-work-summary", description.summary));
      const stamp = when(task.doneAt || task.updatedAt || task.createdAt);
      row.append(text("span", "ws-work-time", `${stamp}${stamp ? " · " : ""}Open details ↗`));
      row.addEventListener("click", () => window.MefiNav?.go("tasks", { taskId: task.id, filter: state.filter === "open" ? "open" : state.filter }));
      $("work-list").append(row);
    }
    if (!visible.length) {
      const empty = text("div", "ws-work-empty", "");
      empty.append(text("span", "ws-empty-symbol", state.filter === "done" ? "✓" : state.filter === "review" ? "◇" : "＋"), text("h3", "", state.filter === "done" ? "A home for finished work" : state.filter === "review" ? "Nothing waiting for review" : "Give your next idea a place"), text("p", "", state.filter === "done" ? "Verified and archived tasks stay here, with their results. Runs awaiting verification appear in Review." : state.filter === "review" ? "Finished runs awaiting verification appear here before they move to Done." : "Use Give a task to put work on this project's board. You'll see its progress and result here."));
      if (state.filter === "open") { const button = text("button", "ghost", "Create your first task ↗"); button.addEventListener("click", () => { setMode("work"); $("input").focus(); }); empty.append(button); }
      $("work-list").append(empty);
    }
  }
  function renderCompanion() {
    const assistant = state.assistant;
    const paused = assistant.status === "paused" || assistant.prefs?.paused;
    const running = state.status.running || [];
    const working = running.length > 0;
    const reviewing = state.tasks.some((task) => describe(task).stage === "review");
    const nickname = companion();
    $("companion-name").textContent = paused ? `${nickname} is taking a breath` : working ? `${nickname} is making progress` : `${nickname} is here`;
    const action = assistant.action;
    const narration = working ? `Working on ${running[0].title || "your task"}${running.length > 1 ? ` · ${running.length} jobs running` : ""}.` : paused ? "New work is paused. Any running jobs will finish normally." : state.pending ? "I'm listening. Your message is on its way." : state.status.lastError ? String(state.status.lastError.text || state.status.lastError) : state.status.waiting ? String(state.status.waiting.text || state.status.waiting.reason || "Work is queued and waiting for an available worker.") : reviewing ? "There's a finished run ready for review. You can inspect its result on the right." : action?.text && !["idle", "listening"].includes(action.text) ? action.text : "Tell me what you have in mind. We can take it one step at a time.";
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
    const run = Promise.allSettled([api().tasksList?.(), api().assistantState?.(), api().assistantStatus?.(), api().jevStatus?.()]).then((results) => {
      if (epoch !== state.epoch || sequence !== readSequence) return;
      if (before.tasks === revisions.tasks && results[0].status === "fulfilled" && results[0].value?.tasks && belongs(results[0].value)) state.tasks = results[0].value.tasks;
      if (before.assistant === revisions.assistant && results[1].status === "fulfilled" && results[1].value?.state && belongs(results[1].value.state)) state.assistant = results[1].value.state;
      if (before.status === revisions.status && results[2].status === "fulfilled" && results[2].value?.status && belongs(results[2].value.status)) state.status = results[2].value.status;
      renderJev(results[3].status === "fulfilled" ? results[3].value : null);
      renderWork(); renderThread(); renderCompanion();
      const failures = results.slice(0, 3).flatMap((result, index) => result.status === "rejected" || result.value?.ok === false || !result.value ? [["work", "conversation", "activity"][index]] : []);
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
    for (const button of $("layer").querySelectorAll("[data-work-filter]")) button.addEventListener("click", () => { state.filter = button.dataset.workFilter; renderWork(); });
    $("add-project").addEventListener("click", async () => {
      if (state.pending || state.switching) return;
      state.switching = true; controls();
      try { const result = await api().projectsAdd(); if (result?.canceled || result?.cancelled) return; adoptProjects(guard(result)); await refresh(true); feedback("Project added. Select it in the sidebar to start working."); }
      catch (error) { feedback(error.message, true); } finally { state.switching = false; controls(); }
    });
    $("reveal").addEventListener("click", () => api()?.shellReveal(project()?.path));
    $("pause").addEventListener("click", async () => {
      $("pause").disabled = true;
      try { const paused = state.assistant.status === "paused" || state.assistant.prefs?.paused; const result = guard(await api().assistantControl(paused ? "resume" : "pause")); state.assistant = result.state; renderCompanion(); feedback(paused ? "New work can start again." : "New work paused. Running jobs finish normally."); }
      catch (error) { feedback(error.message, true); } finally { controls(); }
    });
    for (const [id, key, fallback] of [["person-name", "person", ""], ["agent-name", "companion", "Mefi"], ["accent", "accent", "gold"]]) { $(id).value = storage.get(key, fallback); $(id).addEventListener("input", () => { storage.set(key, $(id).value); personalize(); }); }
    $("motion").checked = storage.get("motion", "1") !== "0";
    $("motion").addEventListener("change", () => { storage.set("motion", $("motion").checked ? "1" : "0"); personalize(); });
    for (const dest of window.MefiNav?.list?.() || []) {
      if (dest.id === "workspace" || dest.id === "studio" || dest.kind === "action" || dest.layer === "transient") continue;
      const button = text("button", "ghost", ""); button.dataset.nav = dest.id; button.append(text("span", "", dest.short), text("kbd", "", dest.key || "")); $("tool-links").append(button);
    }
    api()?.onProjects?.((result) => { adoptProjects(result); refresh(true); });
    api()?.onTasks?.((tasks) => { if (tasks?.some((task) => task.projectId && task.projectId !== state.activeId)) return; revisions.tasks += 1; state.tasks = tasks || []; if (active()) { renderWork(); renderCompanion(); } });
    api()?.onAssistant?.((payload) => { if (payload?.state?.projectId && payload.state.projectId !== state.activeId) return; revisions.assistant += 1; if (payload?.state) state.assistant = payload.state; if (active()) { renderThread(); renderCompanion(); } });
    api()?.onAssistantStatus?.((status) => { if (status?.projectId && status.projectId !== state.activeId) return; revisions.status += 1; state.status = status || {}; if (active()) renderCompanion(); });
    personalize(); renderProjects(); renderWork();
    api()?.projectsList?.().then((result) => { adoptProjects(guard(result)); return refresh(true); }).catch((error) => feedback(error.message, true));
    if (!api()) $("jev").textContent = "Desktop app connects your tools";
    window.MefiBoot?.pollStart?.("workspace.refresh", () => { if (!document.hidden && active()) refresh(); }, 15000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && active()) refresh(); });
  }
  window.MefiWorkspace = { enter, exit, init, refresh, isActive: active, describe };
  init();
})();
