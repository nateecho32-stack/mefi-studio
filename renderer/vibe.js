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
  const state = { projects: [], activeId: null, tasks: [], assistant: {}, status: {}, backlog: null, pending: false, chatOpen: false, seenMessages: 0, askId: null, askSending: false };
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
  function lanes() {
    const running = scoped(state.status.running);
    const runningIds = new Set(running.map((job) => job.taskId).filter(Boolean));
    const tasks = scoped(state.tasks);
    const questions = (Array.isArray(state.assistant.questions) ? state.assistant.questions : []).filter((question) => question?.status === "open" && belongs(question));
    const review = tasks.filter((task) => !runningIds.has(task.id) && describe(task).stage === "review");
    const counts = state.backlog?.counts || {};
    const next = (Array.isArray(state.backlog?.next) ? state.backlog.next : []).filter((item) => !runningIds.has(item.id)).slice(0, 2);
    const finished = tasks.filter((task) => done(task) && describe(task).stage !== "review").sort((a, b) => stamp(b) - stamp(a)).slice(0, 3);
    return { running, questions, review, counts, next, finished };
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
    if (!changed("lanes", [data, projectId()])) return;
    const building = $("lane-building");
    building.replaceChildren();
    for (const job of data.running.slice(0, 3)) {
      const phase = job.phase ? String(job.phase).replace(/_/g, " ") : "working";
      building.append(row({ tone: "live", title: job.title || "A task", meta: `${phase} · started ${ago(job.startedAt)}`, progress: job.progress, onOpen: () => go("command", job.taskId ? { selected: `task:${job.taskId}` } : {}) }));
    }
    for (const item of data.next) building.append(row({ tone: "next", title: item.title || "Next task", meta: "up next", onOpen: () => go("tasks", item.id ? { taskId: item.id } : {}) }));
    if (!building.children.length) building.append(empty("Nothing is building. Describe something above and it starts here."));
    $("count-building").textContent = data.running.length ? String(data.running.length) : "";

    const needs = $("lane-needs");
    needs.replaceChildren();
    for (const question of data.questions.slice(0, 3)) needs.append(row({ tone: "ask", title: question.title || "A decision", meta: question.context?.severity === "blocker" ? "blocking a task" : "decision", action: { label: "Answer", run: () => openAsk(question.id) }, onOpen: () => openAsk(question.id) }));
    for (const task of data.review.slice(0, Math.max(0, 3 - needs.children.length))) needs.append(row({ tone: "review", title: task.title || "A finished task", meta: "ready for your review", action: { label: "Review", run: () => go("tasks", { taskId: task.id }) }, onOpen: () => go("tasks", { taskId: task.id }) }));
    if (data.counts.approval) needs.append(row({ tone: "ask", title: `${data.counts.approval} task${data.counts.approval === 1 ? "" : "s"} waiting for your go-ahead`, meta: "approval", onOpen: () => go("tasks") }));
    if (data.counts.blocked) needs.append(row({ tone: "bad", title: `${data.counts.blocked} task${data.counts.blocked === 1 ? "" : "s"} stuck`, meta: "needs attention", onOpen: () => go("tasks") }));
    const needCount = data.questions.length + data.review.length + (data.counts.approval || 0) + (data.counts.blocked || 0);
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

    const pulse = $("pulse");
    const tone = data.questions.length ? "ask" : data.running.length ? "live" : "quiet";
    pulse.dataset.tone = tone;
    $("pulse-text").textContent = data.questions.length ? `${data.questions.length} need${data.questions.length === 1 ? "s" : ""} you` : data.running.length ? `${data.running.length} building` : state.assistant.status === "paused" ? "Paused" : "All quiet";
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
      chip.addEventListener("click", () => { const input = $("input"); input.value = prompt; input.focus(); input.setSelectionRange(prompt.length, prompt.length); grow(); });
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
    const value = input.value.trim();
    const id = projectId();
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
      if (input.value.trim() === value) { input.value = ""; grow(); }
      if (result.state) state.assistant = result.state;
      if (intent === "build") {
        feedback(state.status.autoBuild === false ? "Added. It waits for your go-ahead under Needs you." : "Added. It shows under Building now as soon as an agent picks it up.", "good");
        window.dispatchEvent(new CustomEvent("mefi:task-created", { detail: { taskId: result.task?.id, projectId: id } }));
      } else feedback("");
      await refresh();
    } catch (error) {
      feedback(`${error?.message || "That didn't go through."} Your text is still in the box.`, "bad");
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

  // ---- decisions ------------------------------------------------------------
  // A decision from Needs you opens here, beside the front door, instead of
  // sending you to Command's Ask tab: what is being asked, the task it
  // blocks and the last lines the agent saw, its options with the
  // recommended one first, and a box for your own answer. Answering moves on
  // to the next open decision, and closes when none is left.
  const openQuestions = () => (Array.isArray(state.assistant.questions) ? state.assistant.questions : []).filter((question) => question?.status === "open" && belongs(question));
  function openAsk(id) {
    if (state.chatOpen) closeChat();
    state.askId = id;
    $("ask").hidden = false; layer.dataset.ask = "open";
    signatures.delete("ask"); $("ask-note").textContent = "";
    renderAsk();
    requestAnimationFrame(() => $("ask").querySelector(".vibe-ask-option, textarea, button")?.focus({ preventScroll: true }));
  }
  function closeAsk({ quiet = false } = {}) {
    if ($("ask").hidden) return;
    state.askId = null;
    $("ask").hidden = true; layer.dataset.ask = "closed";
    if (!quiet) layer.focus({ preventScroll: true });
  }
  function renderAsk() {
    if (state.askId === null || $("ask").hidden) return;
    const open = openQuestions();
    const index = open.findIndex((question) => question.id === state.askId);
    const question = open[index];
    if (!changed("ask", [question ?? null, open.length, state.askSending])) return;
    const body = $("ask-body");
    body.replaceChildren();
    if (!question) {
      // Answered here, elsewhere, or withdrawn: move on, or say so and close.
      if (open.length) { state.askId = open[0].id; signatures.delete("ask"); renderAsk(); return; }
      $("ask-kicker").textContent = "Needs you";
      $("ask-title").textContent = "You're all caught up";
      body.append(el("p", "vibe-ask-detail", "Nothing else is waiting on you. New decisions show up under Needs you."));
      return;
    }
    const context = question.context || {};
    $("ask-kicker").textContent = open.length > 1 ? `Needs you · ${index + 1} of ${open.length}` : "Needs you";
    $("ask-title").textContent = question.title || "A decision";
    const chips = el("div", "vibe-ask-chips");
    if (context.severity) chips.append(el("span", `vibe-ask-chip is-${context.severity}`, context.severity === "blocker" ? "Blocking" : context.severity === "decision" ? "Decision" : "Note"));
    if (context.taskTitle) {
      const task = el(context.taskId ? "button" : "span", "vibe-ask-chip is-task", context.taskTitle);
      if (context.taskId) { task.type = "button"; task.title = "Open this task"; task.addEventListener("click", () => go("tasks", { taskId: context.taskId, filter: "all" })); }
      chips.append(task);
    }
    if (context.file || context.check) chips.append(el("span", "vibe-ask-chip", context.check ? `check: ${context.check}` : context.file));
    if (question.at) chips.append(el("span", "vibe-ask-when", ago(question.at)));
    body.append(chips);
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
  async function answer(question, { optionId = null, text = null, label = "" }) {
    if (state.askSending) return;
    const note = $("ask-note");
    if (!api()?.assistantAnswer) { note.textContent = "Answers are available in the desktop app."; note.dataset.tone = "warn"; return; }
    state.askSending = true; signatures.delete("ask"); renderAsk();
    note.textContent = "Sending your answer…"; note.dataset.tone = "";
    try {
      const result = await api().assistantAnswer({ id: question.id, optionId, text });
      if (result?.ok === false) throw Object.assign(new Error(result.error || "That didn't go through."), { gone: result.gone });
      if (result?.state && belongs(result.state)) state.assistant = result.state;
      else state.assistant = { ...state.assistant, questions: (state.assistant.questions || []).map((item) => item.id === question.id ? { ...item, status: "answered" } : item) };
      note.textContent = `Answered: ${label.length > 60 ? `${label.slice(0, 57)}…` : label}. ${companion()} carries on.`; note.dataset.tone = "good";
      state.askSending = false;
      const next = openQuestions()[0];
      if (next) { state.askId = next.id; signatures.delete("ask"); renderAsk(); }
      else { closeAsk(); feedback(note.textContent, "good"); }
      renderLanes();
      void refresh();
    } catch (error) {
      state.askSending = false;
      note.textContent = error.gone ? error.message : `${error?.message || "That didn't go through."} Try again, or open it in Watch.`;
      note.dataset.tone = error.gone ? "" : "bad";
      signatures.delete("ask"); renderAsk();
    }
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
    $("talk").addEventListener("click", () => void send("talk"));
    $("input").addEventListener("input", () => { grow(); if ($("feedback").textContent && !state.pending) feedback(""); });
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
    $("ask-watch").addEventListener("click", () => { closeAsk({ quiet: true }); go("command", { rail: "ask" }); });
    layer.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!$("ask").hidden) { event.preventDefault(); event.stopPropagation(); closeAsk(); return; }
      if (state.chatOpen) { event.preventDefault(); event.stopPropagation(); closeChat(); $("chat-toggle").focus(); }
    });
    api()?.onProjects?.((payload) => { if (payload?.projects) { state.projects = payload.projects; state.activeId = payload.activeId ?? state.activeId; } signatures.clear(); if (active()) void refresh(); });
    api()?.onTasks?.((tasks) => { if (!Array.isArray(tasks) || tasks.some((task) => task.projectId && task.projectId !== projectId())) return; state.tasks = tasks; if (active()) { renderLanes(); renderHead(); } });
    api()?.onAssistant?.((payload) => { if (!payload?.state || !belongs(payload.state)) return; state.assistant = payload.state; if (active()) { renderLanes(); renderChat(); renderAsk(); } });
    api()?.onAssistantStatus?.((status) => { if (!status || !belongs(status)) return; state.status = status; if (active()) renderLanes(); });
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
  window.MefiVibe = { enter, exit, isActive: active, refresh, mode, setMode, landing, startup, showNotes, closeNotes, ready: () => refreshFlight ?? Promise.resolve() };
})();
