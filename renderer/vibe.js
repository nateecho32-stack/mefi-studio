// Vibe: the calm front door, and the Vibe / Build mode that picks it.
// Vibe is the default mode. It shows one box to talk or build, what is
// building, what needs you and what just finished, over the live tree, with a
// five-stop dock; every Build surface stays one click away. The mode lives in
// localStorage (mefiStudio.uiMode) so it survives restarts. Diagnostic
// launches (?capture=1, ?smoke=1) keep Build unless a mode was saved, so the
// render fixtures and screenshots see the view they were written for.
// Existing users get a one-time "what's new" card; a first run never does.
// In Vibe mode every other page opens inside Vibe's own rail (#vibe-rail)
// instead of Build's, and Home is always Vibe, so no click leaves the mode;
// only the Build switch does.
(function () {
  "use strict";
  const MODE_KEY = "mefiStudio.uiMode";
  const NOTES_KEY = "mefiStudio.whatsNew.seen";
  const NOTES_ID = "vibe-build-1";
  const CHANGELOG_URL = "https://github.com/nateecho32-stack/mefi-studio/blob/main/CHANGELOG.md";
  const layer = document.getElementById("vibe-layer");
  if (!layer) return;
  const $ = (id) => document.getElementById(`vibe-${id}`);
  const api = () => window.mefiStudio;
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private store */ } };
  const headless = /[?&](?:smoke|capture)=1(?:&|$)/.test(String(window.location?.search || ""));

  // Read before anything this launch writes: a profile that already holds
  // Home's drafts, a selected task or the start-on-Home preference has used
  // an earlier Studio, so it gets the card; an empty one is a first run.
  const returning = (() => {
    try {
      if (read("mefiStudio.commandHome") !== null || read("mefiStudio.resume") !== null) return true;
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) || "";
        if (key.startsWith("mefiStudio.workspace.") || key.startsWith("mefiStudio.taskContext.")) return true;
      }
    } catch { /* no store: treat as a first run */ }
    return false;
  })();

  const mode = () => {
    const saved = read(MODE_KEY);
    if (saved === "vibe" || saved === "build") return saved;
    return headless ? "build" : "vibe";
  };
  function paintMode() {
    const current = mode();
    document.documentElement.dataset.uiMode = current;
    for (const group of document.querySelectorAll(".mode-switch")) {
      group.dataset.mode = current;
      for (const button of group.querySelectorAll("[data-ui-mode]")) button.setAttribute("aria-checked", String(button.dataset.uiMode === current));
    }
    const rail = $("rail");
    if (rail) rail.hidden = current !== "vibe";
    paintRail();
    paintSettings(current);
  }
  // Settings speaks the mode's language: the launch switch opens Vibe (or
  // Build's workspace), and its Off lands in Watch or Command.
  function paintSettings(current) {
    const vibe = current === "vibe";
    const label = document.getElementById("idle-home-label");
    if (label) label.textContent = vibe ? "Open Vibe on launch" : "Open Workspace on launch";
    const hint = document.getElementById("idle-home-hint");
    if (hint) hint.textContent = vibe ? "When disabled, Studio opens Watch, the live node tree, after the project chooser." : "When disabled, Studio opens Command view after the project chooser.";
    const toggle = document.getElementById("idle-home-switch");
    if (toggle) toggle.title = vibe ? "On: every launch lands on Vibe. Off: Studio opens straight into Watch. The project chooser comes first either way." : "On: every launch lands on Your workspace. Off: Studio opens straight into Command view. The project chooser comes first either way.";
    const modeHint = document.getElementById("settings-mode-hint");
    if (modeHint) modeHint.textContent = vibe ? "Vibe: the calm front door, where every page opens in Vibe's rail." : "Build: the full studio, with Home, the menu and every tool.";
  }
  // Switching remembers the choice and lands on that mode's home. Vibe keeps
  // the rail shell on (nav.js asks mode()); Build gets the saved shell back.
  function setMode(next, { go = true } = {}) {
    next = next === "build" ? "build" : "vibe";
    const was = mode();
    write(MODE_KEY, next);
    paintMode();
    if (was !== next) { window.MefiNav?.applyShell?.(); window.MefiNav?.paintCurrent?.(); }
    if (go) window.MefiNav?.go?.(next === "vibe" ? "vibe" : "workspace");
    return next;
  }

  // ---- the Vibe rail --------------------------------------------------------
  // Marks where you are: the page itself, or the stop that owns its section
  // (Analyzer lights Tasks, the model pages and Evidence light Agents).
  function paintRail() {
    const rail = $("rail");
    if (!rail || rail.hidden) return;
    const nav = window.MefiNav;
    const id = nav?.current?.() ?? null;
    const buttons = [...rail.querySelectorAll("button[data-nav]")];
    const section = nav?.railSection?.(nav?.get?.(id));
    const match = buttons.find((button) => button.dataset.nav === id)
      ?? buttons.find((button) => (section === "work" && button.dataset.nav === "tasks") || (section === "agents" && button.dataset.nav === "agents"));
    for (const button of buttons) {
      if (button === match) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  }

  // ---- data -----------------------------------------------------------------
  const state = { projects: [], activeId: null, tasks: [], assistant: {}, status: {}, backlog: null, pending: false, chatOpen: false, seenMessages: 0, need: null, askSending: false, gateBusy: false };
  let initialized = false;
  let refreshFlight = null;
  const projectId = () => window.MefiWorkspace?.activeProjectId?.() || state.activeId;
  const belongs = (value) => !value?.projectId || value.projectId === projectId();
  const scoped = (rows) => (Array.isArray(rows) ? rows : []).filter(belongs);
  const done = (task) => ["done", "archived", "completed"].includes(task.status);
  const describe = (task) => window.MefiTasks?.describe?.(task) ?? { stage: done(task) ? "done" : task.status === "awaiting_verification" ? "review" : "open" };
  const stamp = (task) => Number(task.updatedAt || task.createdAt) || Date.parse(task.updatedAt || task.createdAt || "") || 0;
  const companion = () => { try { return (localStorage.getItem("mefiStudio.workspace.companion") || "Mefi").trim() || "Mefi"; } catch { return "Mefi"; } };
  const person = () => { try { return (localStorage.getItem("mefiStudio.workspace.person") || "").trim(); } catch { return ""; } };

  async function refresh() {
    if (!api()) { render(); return; }
    if (refreshFlight) return refreshFlight;
    const calls = ["projectsList", "tasksList", "assistantState", "assistantStatus", "backlogStatus"];
    refreshFlight = Promise.allSettled(calls.map((method) => Promise.resolve().then(() => api()[method]?.()))).then((results) => {
      const value = (index) => results[index].status === "fulfilled" ? results[index].value : null;
      const projects = value(0);
      if (projects?.projects) { state.projects = projects.projects; state.activeId = projects.activeId ?? state.activeId; }
      if (value(1)?.tasks && belongs(value(1))) state.tasks = value(1).tasks;
      if (value(2)?.state && belongs(value(2).state)) state.assistant = value(2).state;
      if (value(3)?.status && belongs(value(3).status)) state.status = value(3).status;
      if (value(4)?.ok && belongs(value(4))) state.backlog = value(4);
      render();
    }).finally(() => { refreshFlight = null; });
    return refreshFlight;
  }

  // The backlog (approvals, stuck work, what is next) has no push of its own:
  // a task or status push re-reads it, at most once every 3.5 s.
  let backlogTimer = 0, backlogReadAt = 0;
  function scheduleBacklog() {
    if (backlogTimer || !api()?.backlogStatus) return;
    backlogTimer = setTimeout(async () => {
      backlogReadAt = Date.now();
      try {
        const result = await api().backlogStatus();
        if (result?.ok && belongs(result)) { state.backlog = result; if (active()) { renderLanes(); renderAsk(); } }
      } catch { /* the next push tries again */ }
      finally { backlogTimer = 0; }
    }, Math.max(0, 3500 - (Date.now() - backlogReadAt)));
  }

  // ---- render ---------------------------------------------------------------
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  const signatures = new Map();
  // Skip a paint when its inputs are unchanged, so a push storm stays cheap.
  function changed(key, value) {
    const signature = JSON.stringify(value);
    if (signatures.get(key) === signature) return false;
    signatures.set(key, signature);
    return true;
  }
  function ago(at) {
    const ms = Date.now() - (Number(at) || Date.parse(at) || Date.now());
    if (ms < 60000) return "just now";
    if (ms < 3600000) return `${Math.round(ms / 60000)} min ago`;
    if (ms < 86400000) return `${Math.round(ms / 3600000)} h ago`;
    return `${Math.round(ms / 86400000)} d ago`;
  }
  function greeting() {
    const hour = new Date().getHours();
    const part = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const name = person();
    return name ? `${part}, ${name}` : part;
  }
  // Building now is what runs on its own: workers, then finished attempts the
  // checker is verifying (nothing for you to do yet), then what is up next.
  // Needs you is only what cannot move without you (see needs()).
  function lanes() {
    const running = scoped(state.status.running);
    const runningIds = new Set(running.map((job) => job.taskId).filter(Boolean));
    const tasks = scoped(state.tasks);
    const checking = tasks.filter((task) => !runningIds.has(task.id) && ["awaiting_verification", "verifying"].includes(task.status));
    const next = (Array.isArray(state.backlog?.next) ? state.backlog.next : []).filter((item) => !runningIds.has(item.id) && ["ready", "waiting", "cooling"].includes(item.stage ?? "ready")).slice(0, 2);
    const finished = tasks.filter((task) => done(task) && describe(task).stage !== "review").sort((a, b) => stamp(b) - stamp(a)).slice(0, 3);
    return { running, checking, next, finished, needs: needs(), gate: runState() };
  }

  // What is holding every agent back, read from the same two switches (and
  // the launch hold) Build's Home reads, with the one control that clears it.
  // Null when nothing is: then Vibe runs on its own.
  function runState() {
    if (!api()) return null;
    const status = state.status || {}, assistant = state.assistant || {};
    const running = scoped(status.running).length;
    const start = { label: "Start agents", run: startWork };
    if (status.held === true && !running) return { key: "held", tone: "warn", pill: "Waiting for you", title: "Agents are off until you start them.", text: "Anything you build waits in the queue until then.", action: start };
    if (assistant.status === "paused" || assistant.prefs?.paused === true || status.execute === false) return { key: "paused", tone: "held", pill: "Paused", title: "New work is paused.", text: running ? "Running jobs finish; queued work waits." : "Queued work waits until you resume.", action: { label: "Resume", run: startWork } };
    if (assistant.ai?.keyPresent === false) return { key: "key", tone: "warn", pill: "No AI connected", title: "No AI is connected yet.", text: `${companion()} needs one before anything can be built.`, action: { label: "Connect an AI", run: () => go("agents", { section: "setup", pane: "connections" }) } };
    const waiting = status.waiting;
    if (waiting && !running && Number(state.backlog?.counts?.ready) > 0) return { key: "waiting", tone: "quiet", pill: "Waiting", title: "Queued work is waiting.", text: typeof waiting === "string" ? waiting : waiting.text || waiting.reason || "", action: null };
    return null;
  }
  async function startWork() {
    if (state.gateBusy || !api()?.assistantControl) return;
    state.gateBusy = true; renderGate();
    try {
      const result = await api().assistantControl("start-work");
      if (result?.ok === false) throw new Error(result.error || "The agents could not start.");
      if (result?.state && belongs(result.state)) state.assistant = result.state;
      state.status = { ...state.status, ...(result?.autopilot || {}), held: false, execute: true };
      feedback("Agents started. They pick up what's queued; approvals and capacity still apply.", "good");
    } catch (error) {
      feedback(error?.message || "The agents could not start.", "bad");
    } finally {
      state.gateBusy = false;
      signatures.delete("lanes"); renderLanes();
      void refresh();
    }
  }
  function renderGate() {
    const gate = runState();
    const box = $("gate");
    box.hidden = !gate;
    if (!gate) return;
    box.dataset.tone = gate.tone;
    $("gate-title").textContent = gate.title;
    $("gate-text").textContent = gate.text;
    const button = $("gate-action");
    button.hidden = !gate.action;
    if (gate.action) {
      button.textContent = state.gateBusy ? "Starting…" : gate.action.label;
      button.disabled = state.gateBusy;
      button.onclick = () => void gate.action.run();
    }
  }
  function row({ tone, title, meta, progress, action, onOpen }) {
    const item = el("li", `vibe-row${tone ? ` is-${tone}` : ""}`);
    const open = el("button", "vibe-row-main");
    open.type = "button";
    open.append(el("span", "vibe-row-dot"), el("span", "vibe-row-title", title));
    if (meta) open.append(el("span", "vibe-row-meta", meta));
    if (progress !== undefined) {
      const bar = el("span", "vibe-bar");
      const fill = el("i");
      if (typeof progress === "number" && Number.isFinite(progress)) fill.style.width = `${Math.max(6, Math.min(100, progress * 100))}%`;
      else bar.classList.add("is-flowing");
      bar.append(fill); open.append(bar);
    }
    open.addEventListener("click", onOpen);
    item.append(open);
    if (action) {
      const button = el("button", "vibe-row-action", action.label);
      button.type = "button";
      button.addEventListener("click", action.run);
      item.append(button);
    }
    return item;
  }
  function empty(text) { return el("li", "vibe-empty", text); }
  const go = (id, params) => window.MefiNav?.go?.(id, params);

  function renderLanes() {
    const data = lanes();
    if (!changed("lanes", [data, projectId(), state.gateBusy])) return;
    const building = $("lane-building");
    building.replaceChildren();
    for (const job of data.running.slice(0, 3)) {
      const phase = job.phase ? String(job.phase).replace(/_/g, " ") : "working";
      building.append(row({ tone: "live", title: job.title || "A task", meta: `${phase} · started ${ago(job.startedAt)}`, progress: job.progress, onOpen: () => go("command", job.taskId ? { selected: `task:${job.taskId}` } : {}) }));
    }
    for (const task of data.checking.slice(0, Math.max(0, 4 - building.children.length))) building.append(row({ tone: "check", title: task.title || "A finished task", meta: "checking its work", onOpen: () => go("tasks", { taskId: task.id }) }));
    const heldBack = data.gate && ["held", "paused", "key"].includes(data.gate.key);
    for (const item of data.next.slice(0, Math.max(0, 4 - building.children.length))) building.append(row({ tone: "next", title: item.title || "Next task", meta: heldBack ? "queued · waiting for the agents" : item.stage === "waiting" ? "waiting for what it depends on" : item.stage === "cooling" ? "trying again soon" : "up next", onOpen: () => go("tasks", item.id ? { taskId: item.id } : {}) }));
    if (!building.children.length) building.append(empty(heldBack ? "Nothing can build until the agents are running." : "Nothing is building. Describe something above and it starts here."));
    $("count-building").textContent = data.running.length ? String(data.running.length) : "";

    const needs = $("lane-needs");
    needs.replaceChildren();
    for (const need of data.needs.slice(0, 4)) needs.append(row({ tone: need.tone, title: need.title, meta: need.meta, action: { label: need.verb, run: () => openNeed(need) }, onOpen: () => openNeed(need) }));
    if (data.needs.length > 4) needs.append(row({ tone: "next", title: `${data.needs.length - 4} more waiting on you`, meta: "on the task board", onOpen: () => go("tasks", { filter: "review" }) }));
    const needCount = data.needs.length;
    if (!needs.children.length) needs.append(empty("You're all caught up."));
    $("count-needs").textContent = needCount ? String(needCount) : "";
    layer.dataset.needs = needCount ? "yes" : "no";

    const finished = $("lane-done");
    finished.replaceChildren();
    for (const task of data.finished) {
      const verified = task.verification?.state === "verified";
      finished.append(row({ tone: "done", title: task.title || "A task", meta: `${verified ? "verified" : "done"} · ${ago(task.updatedAt || task.createdAt)}`, onOpen: () => go("tasks", { taskId: task.id }) }));
    }
    if (!finished.children.length) finished.append(empty("Finished work lands here."));
    $("count-done").textContent = "";

    renderGate();
    // The pill says the one thing that matters most: agents held back, then
    // what waits on you, then what is building.
    const pulse = $("pulse");
    const blocked = data.gate && ["held", "key"].includes(data.gate.key);
    pulse.dataset.tone = blocked || needCount ? "ask" : data.running.length ? "live" : "quiet";
    $("pulse-text").textContent = blocked ? data.gate.pill : needCount ? `${needCount} need${needCount === 1 ? "s" : ""} you` : data.running.length ? `${data.running.length} building` : data.gate ? data.gate.pill : "All quiet";
  }
  function messages() {
    return (Array.isArray(state.assistant.messages) ? state.assistant.messages : []).filter((message) => ["user", "assistant"].includes(message?.role) && belongs(message)).slice(-60);
  }
  function renderChat() {
    const list = messages();
    const thinking = state.pending ? "pending" : "";
    if (!changed("chat", [list, thinking, companion(), person()])) return;
    $("chat-title").textContent = companion();
    const thread = $("thread");
    const pinned = thread.scrollTop + thread.clientHeight >= thread.scrollHeight - 40;
    thread.replaceChildren();
    if (!list.length) thread.append(el("li", "vibe-empty", `Ask ${companion()} anything about this project. Replies show up here.`));
    for (const message of list) {
      const item = el("li", `vibe-msg is-${message.role}${message.kind === "notice" ? " is-notice" : ""}`);
      item.append(el("span", "vibe-msg-who", message.role === "user" ? person() || "You" : companion()), el("p", "vibe-msg-text", message.text));
      thread.append(item);
    }
    if (state.pending) { const typing = el("li", "vibe-msg is-assistant is-typing"); typing.append(el("span", "vibe-msg-who", companion()), el("span", "vibe-typing")); typing.lastChild.append(el("i"), el("i"), el("i")); thread.append(typing); }
    if (pinned || state.pending) thread.scrollTop = thread.scrollHeight;
    const last = [...list].reverse().find((message) => message.role === "assistant");
    $("last").hidden = !last || state.chatOpen;
    if (last) { $("last-who").textContent = companion(); $("last-text").textContent = last.text; }
    const unread = list.length > state.seenMessages && !state.chatOpen && list.at(-1)?.role === "assistant";
    $("chat-dot").hidden = !unread;
  }
  function renderHead() {
    syncDraft();
    const project = state.projects.find((item) => item.id === projectId());
    $("project-name").textContent = project?.name || "Choose a project";
    $("kicker").textContent = greeting();
    const hasWork = scoped(state.tasks).some((task) => !done(task));
    $("title").textContent = !project ? "Pick a project to begin" : hasWork ? `What's next for ${project.name}?` : `What should we make in ${project.name}?`;
  }
  function render() {
    if (!active()) return;
    renderHead(); renderLanes(); renderChat(); renderAsk();
  }

  // ---- composer -------------------------------------------------------------
  let draftProject = null, draftEpoch = 0;
  const draftKey = (id) => `mefiStudio.vibe.draft.${id}`;
  function saveDraft() { if (draftProject) write(draftKey(draftProject), $("input").value); }
  function syncDraft(id = projectId()) {
    if (id === draftProject) return;
    saveDraft(); draftProject = id; draftEpoch++;
    $("input").value = id ? read(draftKey(id)) || "" : ""; grow();
  }
  const SPARKS = [
    ["Fix something broken", "Something is broken: "],
    ["Add a feature", "Add a feature: "],
    ["Polish the look", "Polish the look of "],
    ["What should we do next?", "What should we work on next in this project?"],
  ];
  function renderSparks() {
    const holder = $("sparks");
    holder.replaceChildren();
    for (const [label, prompt] of SPARKS) {
      const chip = el("button", "vibe-spark", label);
      chip.type = "button";
      chip.addEventListener("click", () => { const input = $("input"); input.value = prompt; input.focus(); input.setSelectionRange(prompt.length, prompt.length); grow(); saveDraft(); });
      holder.append(chip);
    }
  }
  function grow() { const input = $("input"); input.style.height = "auto"; input.style.height = `${Math.min(220, input.scrollHeight)}px`; }
  function feedback(text, tone = "") { const node = $("feedback"); node.textContent = text; node.dataset.tone = tone; }
  function busy(on) {
    state.pending = on;
    layer.dataset.pending = on ? "yes" : "no";
    for (const id of ["talk", "build"]) $(id).disabled = on;
  }
  async function send(intent) {
    const input = $("input");
    if (window.MefiFileInputs?.isReading(input)) { feedback("Wait for the files to finish reading."); return; }
    const value = input.value.trim();
    const id = projectId();
    const epoch = draftEpoch;
    if (state.pending) return;
    if (!value) { input.focus(); feedback("Describe what you have in mind first."); return; }
    if (!id || !api()) { feedback("Choose a project first: select the project name at the top left.", "warn"); return; }
    if (intent === "build" && value.replace(/[^\p{L}\p{N}]/gu, "").length < 3) { feedback("Say a little more about what to build.", "warn"); return; }
    busy(true);
    if (intent === "talk") openChat();
    feedback(intent === "build" ? "Adding it to the build queue…" : `${companion()} is thinking…`);
    renderChat();
    try {
      const result = intent === "build"
        ? await api().tasksCreate({ title: value.split("\n")[0].slice(0, 180), prompt: value, projectId: id })
        : await api().assistantMessage(value, id, { view: "Vibe", companion: companion() });
      if (!result || result.ok === false) throw new Error(result?.error || "That didn't go through.");
      if (projectId() !== id || draftEpoch !== epoch) return;
      if (input.value.trim() === value) { input.value = ""; grow(); saveDraft(); }
      if (result.state) state.assistant = result.state;
      if (intent === "build") {
        // Say where it really goes: a held or paused queue, or no AI, keeps
        // it waiting, and the banner below the box has the control that frees it.
        const gate = runState()?.key;
        feedback(gate === "held" ? "Added to the queue. Select Start agents below and it begins." : gate === "paused" ? "Added to the queue. New work is paused; Resume below to start it." : gate === "key" ? "Added to the queue. Connect an AI below so it can be built." : state.status.autoBuild === false ? "Added. It waits for your go-ahead under Needs you." : "Added. It shows under Building now as soon as an agent picks it up.", gate && gate !== "waiting" ? "warn" : "good");
        scheduleBacklog();
        window.dispatchEvent(new CustomEvent("mefi:task-created", { detail: { taskId: result.task?.id, projectId: id } }));
      } else feedback("");
      await refresh();
    } catch (error) {
      if (projectId() === id && draftEpoch === epoch) feedback(`${error?.message || "That didn't go through."} Your text is still in the box.`, "bad");
    } finally { busy(false); renderChat(); }
  }

  // ---- conversation drawer --------------------------------------------------
  function openChat() {
    closeAsk({ quiet: true });
    state.chatOpen = true; $("chat").hidden = false; layer.dataset.chat = "open";
    $("chat-toggle").setAttribute("aria-expanded", "true");
    state.seenMessages = messages().length;
    signatures.delete("chat"); renderChat();
    const thread = $("thread"); thread.scrollTop = thread.scrollHeight;
  }
  function closeChat() {
    state.chatOpen = false; $("chat").hidden = true; layer.dataset.chat = "closed";
    $("chat-toggle").setAttribute("aria-expanded", "false");
    state.seenMessages = messages().length;
    signatures.delete("chat"); renderChat();
  }

  // ---- needs you ------------------------------------------------------------
  // Everything the agents cannot get past on their own opens here, beside the
  // front door, instead of on Command's Ask tab or the Task board: a decision
  // (answer it), a build waiting for your go-ahead under Verify first (read
  // the brief, approve it), and a stuck task (see why, then retry, resume,
  // finish or drop it). Each goes through the host call the Build surface
  // uses. Acting moves on to the next thing waiting, and closes when none is.
  const openQuestions = () => (Array.isArray(state.assistant.questions) ? state.assistant.questions : []).filter((question) => question?.status === "open" && belongs(question));
  const taskById = (id) => scoped(state.tasks).find((task) => task.id === id) || null;
  const HOLD_VERBS = { loop: "Try again", owner: "Resume", duplicate: "Run anyway" };
  function needs() {
    const list = [];
    for (const question of openQuestions()) list.push({ kind: "question", id: question.id, tone: "ask", verb: "Answer", title: question.title || "A decision", meta: question.context?.severity === "blocker" ? "blocking a task" : "decision", question });
    const backlog = state.backlog && belongs(state.backlog) ? state.backlog : null;
    const rows = (key) => (Array.isArray(backlog?.[key]) ? backlog[key] : []).filter((item) => item?.id && (item.kind ?? "task") === "task");
    for (const item of rows("approval")) list.push({ kind: "approval", id: item.id, tone: "ask", verb: "Review", title: item.title || taskById(item.id)?.title || "A task", meta: "waiting for your go-ahead", row: item });
    for (const item of rows("blocked")) list.push({ kind: "blocked", id: item.id, tone: "bad", verb: HOLD_VERBS[item.blockedBy] || "See why", title: item.title || taskById(item.id)?.title || "A task", meta: item.blockedBy === "owner" ? "stopped by you" : "stuck", row: item });
    return list;
  }
  const needKey = (need) => need ? `${need.kind}:${need.id}` : "";
  function openNeed(need) {
    if (state.chatOpen) closeChat();
    state.need = { kind: need.kind, id: need.id };
    $("ask").hidden = false; layer.dataset.ask = "open";
    signatures.delete("ask"); $("ask-note").textContent = "";
    renderAsk();
    requestAnimationFrame(() => $("ask").querySelector(".vibe-ask-option, .vibe-ask-actions button, textarea, button")?.focus({ preventScroll: true }));
  }
  // Answering from Command, the Task board or another window closes the item
  // here too: the drawer follows what is still waiting.
  function closeAsk({ quiet = false } = {}) {
    if ($("ask").hidden) return;
    state.need = null;
    $("ask").hidden = true; layer.dataset.ask = "closed";
    if (!quiet) layer.focus({ preventScroll: true });
  }
  function renderAsk() {
    if (!state.need || $("ask").hidden) return;
    const all = needs();
    const index = all.findIndex((item) => needKey(item) === needKey(state.need));
    const need = all[index];
    const task = need && need.kind !== "question" ? taskById(need.id) : null;
    if (!changed("ask", [need ?? null, task, all.length, state.askSending, state.status.autoBuild])) return;
    const body = $("ask-body");
    body.replaceChildren();
    const watch = $("ask-watch");
    if (!need) {
      if (all.length) { state.need = { kind: all[0].kind, id: all[0].id }; signatures.delete("ask"); renderAsk(); return; }
      $("ask-kicker").textContent = "Needs you";
      $("ask-title").textContent = "You're all caught up";
      body.append(el("p", "vibe-ask-detail", "Nothing else is waiting on you. New decisions, approvals and stuck tasks show up under Needs you."));
      watch.hidden = true;
      return;
    }
    const position = all.length > 1 ? ` · ${index + 1} of ${all.length}` : "";
    watch.hidden = false;
    if (need.kind === "question") {
      $("ask-kicker").textContent = `Decision${position}`;
      watch.textContent = "Open in Watch";
      watch.onclick = () => { closeAsk({ quiet: true }); go("command", { rail: "ask" }); };
      renderQuestion(body, need.question);
      return;
    }
    watch.textContent = "Open on the task board";
    watch.onclick = () => { closeAsk({ quiet: true }); go("tasks", { taskId: need.id, filter: "all" }); };
    $("ask-kicker").textContent = `${need.kind === "approval" ? "Waiting for your go-ahead" : need.row?.blockedBy === "owner" ? "Stopped by you" : "Stuck"}${position}`;
    $("ask-title").textContent = need.title;
    if (need.kind === "approval") renderApproval(body, need, task);
    else renderBlocked(body, need, task);
  }
  function chips(items) {
    const holder = el("div", "vibe-ask-chips");
    for (const item of items.filter(Boolean)) holder.append(item);
    return holder;
  }
  function chip(text, tone = "") { return el("span", `vibe-ask-chip${tone ? ` is-${tone}` : ""}`, text); }
  function brief(task) {
    const text = String(task?.prompt || "").trim();
    if (!text || text === task?.title) return null;
    const box = el("div", "vibe-ask-brief");
    box.append(el("span", "vibe-ask-label", "The brief"), el("p", "vibe-ask-detail", text.length > 1400 ? `${text.slice(0, 1400)}…` : text));
    return box;
  }
  function actions(buttons) {
    const holder = el("div", "vibe-ask-actions");
    for (const { label, primary, run, disabled, title } of buttons) {
      const button = el("button", `vibe-btn ${primary ? "primary" : "quiet"}`, label);
      button.type = "button";
      button.disabled = state.askSending || Boolean(disabled);
      if (title) button.title = title;
      button.addEventListener("click", () => void run());
      holder.append(button);
    }
    return holder;
  }
  function renderQuestion(body, question) {
    const context = question.context || {};
    $("ask-title").textContent = question.title || "A decision";
    let taskChip = null;
    if (context.taskTitle) {
      taskChip = el(context.taskId ? "button" : "span", "vibe-ask-chip is-task", context.taskTitle);
      if (context.taskId) { taskChip.type = "button"; taskChip.title = "Open this task"; taskChip.addEventListener("click", () => go("tasks", { taskId: context.taskId, filter: "all" })); }
    }
    body.append(chips([
      context.severity ? chip(context.severity === "blocker" ? "Blocking" : context.severity === "decision" ? "Decision" : "Note", context.severity) : null,
      taskChip,
      context.file || context.check ? chip(context.check ? `check: ${context.check}` : context.file) : null,
      question.at ? el("span", "vibe-ask-when", ago(question.at)) : null,
    ]));
    if (question.detail) body.append(el("p", "vibe-ask-detail", question.detail));
    if (Array.isArray(context.evidence) && context.evidence.length) {
      const evidence = el("pre", "vibe-ask-evidence", context.evidence.slice(-3).join("\n"));
      evidence.title = "The last lines the agent printed before it asked";
      body.append(evidence);
    }
    const options = el("div", "vibe-ask-options");
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", "Your answer");
    const choices = (Array.isArray(question.options) ? question.options : []).slice().sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)));
    for (const option of choices) {
      const button = el("button", `vibe-ask-option${option.recommended ? " is-recommended" : ""}`);
      button.type = "button";
      const label = el("span", "vibe-ask-option-label", option.label);
      if (option.recommended) label.append(el("span", "vibe-ask-rec", "Recommended"));
      button.append(label);
      if (option.description) button.append(el("span", "vibe-ask-option-desc", option.description));
      button.disabled = state.askSending;
      button.addEventListener("click", () => void answer(question, { optionId: option.id, label: option.label }));
      options.append(button);
    }
    body.append(options);
    const own = el("form", "vibe-ask-own");
    const input = el("textarea");
    input.rows = 2; input.placeholder = choices.length ? "Or say it in your own words…" : "Your answer…";
    input.setAttribute("aria-label", "Write your own answer");
    const send = el("button", "vibe-btn quiet", "Send");
    send.type = "submit"; send.disabled = state.askSending;
    own.append(input, send);
    own.addEventListener("submit", (event) => { event.preventDefault(); const text = input.value.trim(); if (text) void answer(question, { text, label: text }); else input.focus(); });
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); own.requestSubmit(); } });
    body.append(own);
  }
  function renderApproval(body, need, task) {
    const row = need.row || {};
    const waitingOn = Array.isArray(row.dependencies) ? row.dependencies.filter((item) => item && item.done !== true).length : 0;
    body.append(chips([chip("Verify first", "decision"), waitingOn ? chip(`waits for ${waitingOn} other task${waitingOn === 1 ? "" : "s"}`) : null, task?.createdAt ? el("span", "vibe-ask-when", `added ${ago(task.createdAt)}`) : null]));
    body.append(el("p", "vibe-ask-detail", "Verify first is on, so this build waits until you approve the brief below. Approving lets it start when a worker is free."));
    const text = brief(task);
    if (text) body.append(text);
    const canApprove = row.canApprove === true && typeof row.buildScope === "string" && row.buildScope;
    body.append(actions([
      { label: "Approve build", primary: true, disabled: !canApprove, title: canApprove ? "Approve this brief so the task can build" : "Open it on the task board to review its current brief", run: () => act(need, () => api().backlogControl({ action: "approve", taskId: need.id, projectId: projectId(), expectedScope: row.buildScope }), "Approved. It builds when a worker is free.") },
      { label: "Drop it", run: () => act(need, () => api().tasksAction({ taskId: need.id, projectId: projectId(), action: "drop" }), "Dropped. It's closed without being built.") },
    ]));
    if (state.status.autoBuild === false && api()?.assistantAutopilot) {
      const auto = el("button", "vibe-ask-link vibe-ask-auto", "Let builds start without asking from now on");
      auto.type = "button";
      auto.title = "Switch Verify first off. You can turn it back on in Command's Agents menu.";
      auto.disabled = state.askSending;
      auto.addEventListener("click", () => void act(need, async () => {
        const result = await api().assistantAutopilot({ autoBuild: true });
        if (result?.ok !== false) {
          state.status = { ...state.status, autoBuild: true };
          // Every build that waited only on Verify first may start now.
          if (state.backlog) state.backlog = { ...state.backlog, approval: [] };
        }
        return result;
      }, "Builds now start without asking. This one is on its way too."));
      body.append(auto);
    }
  }
  function renderBlocked(body, need, task) {
    const row = need.row || {};
    const hold = row.blockedBy;
    const reason = row.reason || task?.verification?.reason || task?.lastRunError || "The last attempt could not be confirmed.";
    body.append(chips([chip(hold === "owner" ? "Stopped by you" : hold === "loop" ? "Same failure repeating" : hold === "duplicate" ? "Looks like a duplicate" : "Stuck", hold === "owner" ? "" : "blocker"), task?.updatedAt ? el("span", "vibe-ask-when", ago(task.updatedAt)) : null]));
    body.append(el("p", "vibe-ask-detail", reason));
    const lastError = String(task?.lastRunError || "").trim();
    if (lastError && lastError !== reason) body.append(el("pre", "vibe-ask-evidence", lastError.split("\n").slice(-4).join("\n")));
    const text = brief(task);
    if (text) body.append(text);
    const retryable = row.canRetry !== false && !["verifying", "awaiting_verification"].includes(task?.status);
    body.append(actions([
      { label: HOLD_VERBS[hold] || "Try again", primary: true, disabled: !retryable, title: "Put it back in the queue; it continues from its saved progress", run: () => act(need, () => api().tasksAction({ taskId: need.id, projectId: projectId(), action: "retry" }), "Back in the queue. It shows under Building now when a worker picks it up.") },
      { label: "It's done", title: "You checked the result yourself: mark it complete", run: () => act(need, () => api().tasksAction({ taskId: need.id, projectId: projectId(), action: "status", status: "done" }), "Marked done.") },
      { label: "Drop it", title: "Close it without finishing; it is not marked done", run: () => act(need, () => api().tasksAction({ taskId: need.id, projectId: projectId(), action: "drop" }), "Dropped. It's closed without being finished.") },
    ]));
  }
  // One path for every drawer action: call the host, adopt what it hands
  // back, then move on to whatever else is waiting.
  async function act(need, call, success) {
    if (state.askSending) return;
    const note = $("ask-note");
    if (!api()) { note.textContent = "This works in the desktop app."; note.dataset.tone = "warn"; return; }
    // Where it sat in the list, so the drawer moves forward, not back to the top.
    const place = Math.max(0, needs().findIndex((item) => needKey(item) === needKey(need)));
    state.askSending = true; signatures.delete("ask"); renderAsk();
    note.textContent = "Working on it…"; note.dataset.tone = "";
    try {
      const result = await call();
      if (!result || result.ok === false) throw Object.assign(new Error(result?.error || "That didn't go through."), { gone: result?.gone });
      if (result.backlog && belongs(result.backlog)) state.backlog = { ...result.backlog, ok: true };
      if (result.task) state.tasks = state.tasks.map((item) => item.id === result.task.id ? result.task : item);
      if (result.state && belongs(result.state)) state.assistant = result.state;
      // Until the next read, what was just handled stays out of Needs you.
      if (state.backlog && Array.isArray(state.backlog[need.kind])) state.backlog = { ...state.backlog, [need.kind]: state.backlog[need.kind].filter((item) => item.id !== need.id) };
      moveOn(need, success, place);
      void refresh();
    } catch (error) {
      state.askSending = false;
      note.textContent = error.gone ? error.message : `${error?.message || "That didn't go through."} You can also open it on the task board.`;
      note.dataset.tone = error.gone ? "" : "bad";
      signatures.delete("ask"); renderAsk();
    }
  }
  function moveOn(need, message, place = 0) {
    state.askSending = false;
    const note = $("ask-note");
    note.textContent = message; note.dataset.tone = "good";
    const rest = needs().filter((item) => needKey(item) !== needKey(need));
    const next = rest[place] ?? rest[0];
    if (next) { state.need = { kind: next.kind, id: next.id }; signatures.delete("ask"); renderAsk(); }
    else { closeAsk(); feedback(message, "good"); }
    signatures.delete("lanes"); renderLanes();
  }
  async function answer(question, { optionId = null, text = null, label = "" }) {
    const need = { kind: "question", id: question.id };
    if (!api()?.assistantAnswer) { const note = $("ask-note"); note.textContent = "Answers are available in the desktop app."; note.dataset.tone = "warn"; return; }
    await act(need, async () => {
      const result = await api().assistantAnswer({ id: question.id, optionId, text });
      if (result?.ok !== false && !(result?.state && belongs(result.state))) state.assistant = { ...state.assistant, questions: (state.assistant.questions || []).map((item) => item.id === question.id ? { ...item, status: "answered" } : item) };
      return result ?? { ok: true };
    }, `Answered: ${label.length > 60 ? `${label.slice(0, 57)}…` : label}. ${companion()} carries on.`);
  }

  // ---- surface --------------------------------------------------------------
  function active() { return !layer.hidden; }
  function enter() {
    init();
    if (mode() !== "vibe") setMode("vibe", { go: false });
    window.MefiWorkspace?.exit?.();
    window.MefiIdle?.exit?.();
    layer.hidden = false;
    document.body.classList.add("vibe-active");
    // The live tree is Vibe's sky, as it is Home's; it waits for the startup gate.
    const sky = () => { if (active()) window.MefiIdle?.setHomeBackdrop?.(true); };
    if (window.MefiBoot?.isActive?.()) Promise.resolve(window.MefiBoot.ready?.()).then(sky, sky); else sky();
    signatures.clear();
    render();
    paintRail();
    if (!window.MefiBoot?.isActive?.()) layer.focus({ preventScroll: true });
    return refresh();
  }
  function exit() {
    if (layer.hidden) return;
    layer.hidden = true;
    document.body.classList.remove("vibe-active");
    closeAsk({ quiet: true });
    paintRail();
    if (!window.MefiWorkspace?.isActive?.()) window.MefiIdle?.setHomeBackdrop?.(false);
  }
  // Where Studio lands when it opens on its home.
  function landing() { return mode() === "vibe" ? "vibe" : "workspace"; }

  function init() {
    if (initialized) return;
    initialized = true;
    renderSparks();
    $("compose").addEventListener("submit", (event) => { event.preventDefault(); void send("build"); });
    window.MefiFileInputs?.bind($("input"), { scope: () => `${draftEpoch}:${projectId()}`, blocked: () => state.pending || !projectId() });
    $("talk").addEventListener("click", () => void send("talk"));
    $("input").addEventListener("input", () => { grow(); saveDraft(); if ($("feedback").textContent && !state.pending) feedback(""); });
    window.addEventListener("mefi:project-changed", (event) => syncDraft(event.detail?.projectId));
    window.addEventListener("beforeunload", saveDraft);
    $("input").addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      void send(event.ctrlKey || event.metaKey ? "build" : "talk");
    });
    $("project").addEventListener("click", () => window.MefiSidebar?.open?.({ focus: true }));
    $("chat-toggle").addEventListener("click", () => (state.chatOpen ? closeChat() : openChat()));
    $("chat-close").addEventListener("click", () => { closeChat(); $("chat-toggle").focus(); });
    $("last").addEventListener("click", openChat);
    $("ask-close").addEventListener("click", () => closeAsk());
    layer.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!$("ask").hidden) { event.preventDefault(); event.stopPropagation(); closeAsk(); return; }
      if (state.chatOpen) { event.preventDefault(); event.stopPropagation(); closeChat(); $("chat-toggle").focus(); }
    });
    api()?.onProjects?.((payload) => { if (payload?.projects) { state.projects = payload.projects; state.activeId = payload.activeId ?? state.activeId; } signatures.clear(); if (active()) void refresh(); });
    api()?.onTasks?.((tasks) => { if (!Array.isArray(tasks) || tasks.some((task) => task.projectId && task.projectId !== projectId())) return; state.tasks = tasks; if (active()) { renderLanes(); renderHead(); renderAsk(); scheduleBacklog(); } });
    api()?.onAssistant?.((payload) => { if (!payload?.state || !belongs(payload.state)) return; state.assistant = payload.state; if (active()) { renderLanes(); renderChat(); renderAsk(); } });
    api()?.onAssistantStatus?.((status) => { if (!status || !belongs(status)) return; state.status = status; if (active()) { renderLanes(); scheduleBacklog(); } });
    // The greeting follows the clock without a timer of its own.
    document.addEventListener("visibilitychange", () => { if (!document.hidden && active()) { renderHead(); void refresh(); } });
  }

  // ---- mode switches everywhere ---------------------------------------------
  document.addEventListener("click", (event) => {
    // The switches and the Vibe rail's Build stop; never <html>, which carries the mode too.
    const button = event.target?.closest?.("button[data-ui-mode]");
    if (!button) return;
    event.preventDefault();
    // A switch marked data-mode-stay (Settings) changes the frame in place.
    const stay = Boolean(button.closest("[data-mode-stay]"));
    if (stay) { if (button.dataset.uiMode !== mode()) setMode(button.dataset.uiMode, { go: false }); return; }
    if (button.dataset.uiMode !== mode() || !active()) setMode(button.dataset.uiMode);
  });
  document.addEventListener("keydown", (event) => {
    const button = event.target?.closest?.(".mode-switch [data-ui-mode]");
    if (!button || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const target = button.parentElement.querySelector(`[data-ui-mode="${button.dataset.uiMode === "vibe" ? "build" : "vibe"}"]`);
    target?.focus();
    target?.click();
  });

  // ---- what's new -----------------------------------------------------------
  const notes = document.getElementById("vibe-notes");
  let notesReturn = null;
  function closeNotes() {
    if (!notes || notes.hidden) return;
    write(NOTES_KEY, NOTES_ID);
    notes.hidden = true;
    document.removeEventListener("keydown", notesKeys, true);
    (notesReturn && document.contains(notesReturn) ? notesReturn : active() ? layer : null)?.focus?.({ preventScroll: true });
  }
  function notesKeys(event) {
    if (notes.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeNotes(); return; }
    if (event.key !== "Tab") return;
    const stops = [...notes.querySelectorAll("button")].filter((button) => !button.disabled);
    const first = stops[0], last = stops.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function showNotes({ force = false } = {}) {
    if (!notes || (!force && read(NOTES_KEY) === NOTES_ID)) return false;
    notesReturn = document.activeElement;
    notes.hidden = false;
    document.addEventListener("keydown", notesKeys, true);
    requestAnimationFrame(() => document.getElementById("vibe-notes-ok")?.focus({ preventScroll: true }));
    return true;
  }
  if (notes) {
    document.getElementById("vibe-notes-close")?.addEventListener("click", closeNotes);
    document.getElementById("vibe-notes-ok")?.addEventListener("click", () => { closeNotes(); if (!active()) setMode("vibe"); });
    document.getElementById("vibe-notes-build")?.addEventListener("click", () => { closeNotes(); setMode("build"); });
    document.getElementById("vibe-notes-changelog")?.addEventListener("click", () => {
      const opened = api()?.openExternal?.(CHANGELOG_URL);
      if (!opened) window.open?.(CHANGELOG_URL, "_blank", "noopener");
    });
    notes.addEventListener("click", (event) => { if (event.target === notes) closeNotes(); });
  }
  // Called once the studio is up (booklet.js). A first run marks the card
  // seen, since everything is new to it; a returning profile sees it once,
  // after any sheet the launch opened has closed.
  function startup() {
    if (headless || !notes) return;
    if (!returning) { if (read(NOTES_KEY) === null) write(NOTES_KEY, NOTES_ID); return; }
    if (read(NOTES_KEY) === NOTES_ID) return;
    let tries = 0;
    const attempt = () => {
      const nav = window.MefiNav?.state;
      if ((nav?.sheet || nav?.transient) && tries++ < 90) { setTimeout(attempt, 2000); return; }
      showNotes();
    };
    setTimeout(attempt, 700);
  }

  // The palette and help list both modes; the rail's switch reads the same record.
  window.MefiNav?.register?.({
    id: "vibe", label: "Vibe", short: "Vibe", kind: "view", layer: null, section: "home", group: "surfaces",
    glyph: "g-spark", badge: null, desc: "The calm front door: talk or build from one box, see what's building and what needs you",
    searchTerms: "vibe mode simple calm easy home start switch",
    showIn: { tabs: false, tools: false, dock: false, palette: true, help: true, footer: false },
    // In Vibe mode Home is Vibe, and Search lists it once, as Home's record.
    hidden: () => mode() === "vibe",
    open: () => enter(), close: () => exit(), isOpen: () => active(),
  });
  window.MefiNav?.register?.({
    id: "build-mode", label: "Switch to Build", short: "Build", kind: "action", layer: null, section: "home", group: "surfaces",
    glyph: "g-wrench", badge: null, desc: "The full studio: Home, Command, boards, models and every setting",
    searchTerms: "build mode full classic advanced studio switch",
    showIn: { tabs: false, tools: false, dock: false, palette: true, help: true, footer: false },
    hidden: () => mode() === "build",
    run: () => setMode("build"),
  });
  window.MefiNav?.register?.({
    id: "whats-new", label: "What's new", short: "What's new", kind: "action", layer: null, section: "help", group: "system",
    glyph: "g-spark", badge: null, desc: "The Vibe and Build modes, and a link to the full changelog",
    searchTerms: "whats new changelog release notes patch notes update",
    showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
    run: () => showNotes({ force: true }),
  });

  window.addEventListener("mefi:nav", paintRail);
  paintMode();
  // A plain read of where the vibe stands, for tests and anything driving
  // Studio: what holds the agents back, what waits on you, what is building.
  function snapshot() {
    const data = lanes();
    return { mode: mode(), active: active(), gate: data.gate?.key ?? null, needs: data.needs.map(({ kind, id, title }) => ({ kind, id, title })), building: data.running.length, checking: data.checking.map((task) => task.id), open: state.need ? { ...state.need } : null };
  }
  window.MefiVibe = { enter, exit, isActive: active, refresh, mode, setMode, landing, startup, showNotes, closeNotes, snapshot, ready: () => refreshFlight ?? Promise.resolve() };
})();
