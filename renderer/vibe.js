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
    if (label) label.textContent = vibe ? "Open Vibe on launch" : "Open Home on launch";
    const hint = document.getElementById("idle-home-hint");
    if (hint) hint.textContent = vibe ? "When disabled, Studio opens Watch, the live node tree, after the project chooser." : "When disabled, Studio opens Command view after the project chooser.";
    const toggle = document.getElementById("idle-home-switch");
    if (toggle) toggle.title = vibe ? "On: every launch lands on Vibe. Off: Studio opens straight into Watch. The project chooser comes first either way." : "On: every launch lands on Home. Off: Studio opens straight into Command view. The project chooser comes first either way.";
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
  const state = { projects: [], activeId: null, tasks: [], assistant: {}, status: {}, backlog: null, ideas: [], plans: [], pending: false, chatOpen: false, seenMessageId: null, askErrors: {}, need: null, askSending: false, gateBusy: false };
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
    const calls = ["projectsList", "tasksList", "assistantState", "assistantStatus", "backlogStatus", "ideasList"];
    refreshFlight = Promise.allSettled(calls.map((method) => Promise.resolve().then(() => api()[method]?.()))).then(async (results) => {
      const value = (index) => results[index].status === "fulfilled" ? results[index].value : null;
      const projects = value(0);
      if (projects?.projects) { state.projects = projects.projects; state.activeId = projects.activeId ?? state.activeId; }
      if (value(1)?.tasks && belongs(value(1))) state.tasks = value(1).tasks;
      if (value(2)?.state && belongs(value(2).state)) state.assistant = value(2).state;
      if (value(3)?.status && belongs(value(3).status)) state.status = value(3).status;
      if (value(4)?.ok && belongs(value(4))) state.backlog = value(4);
      if (Array.isArray(value(5)?.ideas) && belongs(value(5))) state.ideas = value(5).ideas;
      // Plans name their project, so they are read once the project is known.
      await readPlans();
      render();
    }).finally(() => { refreshFlight = null; });
    return refreshFlight;
  }
  async function readPlans() {
    const id = projectId();
    if (!id || !api()?.planningList) return;
    try {
      const result = await api().planningList({ projectId: id });
      if (Array.isArray(result?.plans) && (!result.projectId || result.projectId === projectId())) state.plans = result.plans;
    } catch { /* plans are optional here; the next refresh tries again */ }
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
  // Rows are rebuilt on every paint; MefiMotion (renderer/motion.js) keeps the
  // ones that stay still, glides them to their new place, cascades what is
  // new and fades what left. Without it (tests, motion off) a paint just runs.
  const keep = (host, paint, options) => { if (host && window.MefiMotion?.keep) window.MefiMotion.keep(host, paint, options); else paint(); };
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
    // Freshly done is the last half day; older results live in the Tasks panel.
    const finished = tasks.filter((task) => done(task) && describe(task).stage !== "review" && Date.now() - stamp(task) < FRESH_MS).sort((a, b) => stamp(b) - stamp(a)).slice(0, 3);
    return { running, checking, next, finished, ideas: freshIdeas(), plans: activePlans(), families: families(), needs: needs(), gate: runState() };
  }
  // A request Build it split into steps (main.cjs vibeBuild): the owner's card,
  // the steps under it and where each one stands; the card itself runs last,
  // as the final integration and check. Finished families leave the plan card
  // for Freshly done.
  const STEP_STATES = { done: "done", dropped: "dropped", running: "building", checking: "checking its work", approval: "waiting for your go-ahead", blocked: "stuck", waiting: "waiting its turn" };
  // Each step also carries the worker on it (its tool and what it is doing
  // now) and which earlier steps it waits on, for the plan card's track and
  // the plan panel's timeline.
  function families() {
    const tasks = scoped(state.tasks);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const jobs = new Map(scoped(state.status.running).filter((job) => job.taskId).map((job) => [job.taskId, job]));
    const stages = new Map((Array.isArray(state.backlog?.taskStates) ? state.backlog.taskStates : []).map((row) => [row.id, row]));
    const stepState = (step) => step.dropped ? "dropped" : done(step) ? "done" : jobs.has(step.id) ? "running"
      : ["awaiting_verification", "verifying"].includes(step.status) ? "checking" : stages.get(step.id)?.stage === "approval" ? "approval" : stages.get(step.id)?.stage === "blocked" ? "blocked" : "waiting";
    const worker = (job) => job ? { ...(window.MefiVibeFlow?.doing?.(job) ?? { tool: "", step: "" }), phase: job.phase || "", startedAt: Number(job.startedAt) || null, progress: Number.isFinite(job.progress) ? job.progress : null } : null;
    return tasks.filter((task) => task.delegation?.intake && Array.isArray(task.delegation.childTaskIds) && !done(task))
      .map((parent) => {
        const ids = parent.delegation.childTaskIds;
        const steps = ids.map((id) => byId.get(id)).filter(Boolean).map((step) => ({ id: step.id, title: step.title || "A step", state: stepState(step), buildScope: step.buildScope ?? null,
          after: (Array.isArray(step.dependsOn) ? step.dependsOn : []).map((id) => ids.indexOf(id)).filter((index) => index >= 0), job: worker(jobs.get(step.id)), at: stamp(step) }));
        const finished = steps.filter((step) => ["done", "dropped"].includes(step.state)).length;
        const final = jobs.has(parent.id) ? "running" : ["awaiting_verification", "verifying"].includes(parent.status) ? "checking" : finished === steps.length ? "next" : "waiting";
        return { id: parent.id, title: parent.title || "Your request", summary: parent.delegation.summary || "", steps, finished, final, job: worker(jobs.get(parent.id)), updatedAt: stamp(parent) };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  const FRESH_MS = 12 * 3600000;
  // Ideas nobody has looked at yet, newest first; Skip marks one read.
  const freshIdeas = () => scoped(state.ideas).filter((idea) => idea && !idea.read && idea.status !== "done" && !idea.taskId).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
  // Plans still in play: not archived, not already turned into tasks.
  const activePlans = () => scoped(state.plans).filter((plan) => plan && plan.archivedAt == null && plan.status !== "converted");

  // What is holding every agent back, read from the same two switches (and
  // the launch hold) Build's Home reads, with the one control that clears it.
  // Null when nothing is: then Vibe runs on its own.
  // The host's one answer (status.loop, scripts/loop-status.cjs) is read
  // first. Only states that hold the agents back get the banner; tasks that
  // need an OK or a review already show under Needs you.
  const LOOP_PILLS = { held: "Agents off", paused: "Paused", parked: "Cooling down", draining: "Updating", stuck: "Stuck", waiting: "Waiting", setup: "No AI connected", "no-project": "No project" };
  const LOOP_KEYS = { held: "held", paused: "paused", setup: "key" };
  function loopAction(action) {
    if (!action) return null;
    const run = {
      start: startWork,
      "connect-ai": () => go("agents", { section: "setup", pane: "connections" }),
      "open-project": () => window.MefiSidebar?.open?.({ focus: true }),
      restart: () => api()?.appRestart?.({ stopAgents: true }),
      review: () => openPanel("tasks", { fold: "needs" }),
    }[action.id];
    return run ? { label: action.label, run } : null;
  }
  function runState() {
    if (!api()) return null;
    const status = state.status || {}, assistant = state.assistant || {};
    const loop = status.loop;
    if (loop && typeof loop === "object" && typeof loop.state === "string") {
      if (!Object.hasOwn(LOOP_PILLS, loop.state)) return null;
      return { key: LOOP_KEYS[loop.state] || loop.state, tone: loop.tone === "held" ? "held" : loop.tone === "quiet" ? "quiet" : "warn", pill: LOOP_PILLS[loop.state], title: loop.headline, text: loop.reason, action: loopAction(loop.action) };
    }
    const running = scoped(status.running).length;
    const start = { label: "Start agents", run: startWork };
    const connect = { key: "key", tone: "warn", pill: "No AI connected", title: "No AI is connected yet.", text: `${companion()} needs one before anything can be built.`, action: { label: "Connect an AI", run: () => go("agents", { section: "setup", pane: "connections" }) } };
    if (status.held === true && !running) return assistant.ai?.keyPresent === false ? connect : { key: "held", tone: "warn", pill: "Agents off", title: "Agents are off until you start them.", text: "Anything you build waits in the queue until then.", action: start };
    if (assistant.status === "paused" || assistant.prefs?.paused === true || status.execute === false) return { key: "paused", tone: "held", pill: "Paused", title: "New work is paused.", text: running ? "Running jobs finish; queued work waits." : "Queued work waits until you resume.", action: { label: "Resume", run: startWork } };
    if (assistant.ai?.keyPresent === false) return connect;
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
  // `detail` is one live line under the meta: what a worker is doing now.
  function row({ key, tone, title, meta, detail, progress, action, onOpen }) {
    const item = el("li", `vibe-row${tone ? ` is-${tone}` : ""}`);
    item.dataset.key = key || title;
    const open = el("button", "vibe-row-main");
    open.type = "button";
    open.append(el("span", "vibe-row-dot"), el("span", "vibe-row-title", title));
    if (meta) open.append(el("span", "vibe-row-meta", meta));
    if (detail) { const now = el("span", "vibe-row-now", detail); now.title = detail; open.append(now); }
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
  const go = (id, params) => window.MefiNav?.go?.(id, params);

  // A row opens its task in the Tasks panel beside Vibe, not the Build board.
  const openTask = (taskId) => openPanel("tasks", taskId ? { taskId } : {});
  function renderLanes() {
    const data = lanes();
    if (!changed("lanes", [data, projectId(), state.gateBusy])) { sharePanels(); return; }
    const needCount = data.needs.length;
    keep($("card-needs")?.parentElement, () => paintLanes(data));
    renderDock(data);

    renderGate();
    // The pill says the one thing that matters most: agents held back, then
    // what waits on you, then what is building.
    const pulse = $("pulse");
    const blocked = data.gate && ["held", "key"].includes(data.gate.key);
    pulse.dataset.tone = blocked || needCount ? "ask" : data.running.length ? "live" : "quiet";
    $("pulse-text").textContent = blocked ? data.gate.pill : needCount ? `${needCount} need${needCount === 1 ? "s" : ""} you` : data.running.length ? `${data.running.length} building` : data.gate ? data.gate.pill : "All quiet";
    sharePanels(data);
  }
  // Each row's key names its card, so a task that moves from Building to
  // Freshly done leaves one card and arrives in the other.
  function paintLanes(data) {
    const building = $("lane-building");
    building.replaceChildren();
    for (const job of data.running.slice(0, 3)) {
      const phase = job.phase ? String(job.phase).replace(/_/g, " ") : "working";
      // The worker's tool, and under it what the worker is doing right now.
      const now = window.MefiVibeFlow?.doing?.(job) ?? { tool: "", step: "" };
      building.append(row({ key: `building:${job.taskId || job.title}`, tone: "live", title: job.title || "A task", meta: `${now.tool ? `${now.tool} · ` : ""}${phase} · started ${ago(job.startedAt)}`, detail: now.step, progress: job.progress, onOpen: () => go("command", job.taskId ? { selected: `task:${job.taskId}` } : {}) }));
    }
    for (const task of data.checking.slice(0, Math.max(0, 4 - building.children.length))) building.append(row({ key: `building:${task.id}`, tone: "check", title: task.title || "A finished task", meta: "checking its work", onOpen: () => openTask(task.id) }));
    const heldBack = data.gate && ["held", "paused", "key"].includes(data.gate.key);
    for (const item of data.next.slice(0, Math.max(0, 4 - building.children.length))) building.append(row({ key: `building:${item.id}`, tone: "next", title: item.title || "Next task", meta: heldBack ? "queued · waiting for the agents" : item.stage === "waiting" ? "waiting for what it depends on" : item.stage === "cooling" ? "trying again soon" : "up next", onOpen: () => openTask(item.id) }));
    $("count-building").textContent = data.running.length ? String(data.running.length) : "";

    const needs = $("lane-needs");
    needs.replaceChildren();
    for (const need of data.needs.slice(0, 4)) needs.append(row({ key: `needs:${need.kind}:${need.id}`, tone: need.tone, title: need.title, meta: need.meta, action: { label: need.verb, run: () => openNeed(need) }, onOpen: () => openNeed(need) }));
    if (data.needs.length > 4) needs.append(row({ key: "needs:more", tone: "next", title: `${data.needs.length - 4} more waiting on you`, meta: "in your tasks", onOpen: () => openPanel("tasks", { fold: "needs" }) }));
    const needCount = data.needs.length;
    $("count-needs").textContent = needCount ? String(needCount) : "";
    layer.dataset.needs = needCount ? "yes" : "no";

    const finished = $("lane-done");
    finished.replaceChildren();
    for (const task of data.finished) {
      const verified = task.verification?.state === "verified";
      finished.append(row({ key: `done:${task.id}`, tone: "done", title: task.title || "A task", meta: `${verified ? "verified" : "done"} · ${ago(task.updatedAt || task.createdAt)}`, onOpen: () => openTask(task.id) }));
    }
    $("count-done").textContent = "";

    const ideas = $("lane-ideas");
    ideas.replaceChildren();
    for (const idea of data.ideas.slice(0, 3)) ideas.append(row({ key: `ideas:${idea.id}`, tone: "idea", title: idea.title || idea.detail || "An idea", meta: [idea.source, idea.at ? ago(idea.at) : ""].filter(Boolean).join(" · ") || "new idea", action: { label: "Build it", run: () => void promoteIdea(idea) }, onOpen: () => openPanel("ideas", { ideaId: idea.id }) }));
    $("count-ideas").textContent = data.ideas.length > 3 ? String(data.ideas.length) : "";

    // A request split into steps: where it stands, its steps as a track that
    // ends in the final check, who is on which step and what they are doing,
    // and Start all while the steps wait for a go-ahead under Verify first.
    const plan = $("lane-plan");
    plan.replaceChildren();
    for (const family of data.families.slice(0, 2)) {
      const waiting = data.needs.find((need) => need.kind === "family" && need.id === family.id);
      const current = family.steps.find((step) => step.state === "running") || family.steps.find((step) => step.state === "checking");
      const meta = `${family.finished} of ${family.steps.length} steps done${waiting ? " · waiting for your go-ahead" : family.final === "running" || family.final === "checking" ? " · final check running" : family.final === "next" ? " · final check next" : ""}`;
      plan.append(row({ key: `plan:${family.id}`, tone: waiting ? "ask" : current || family.final === "running" ? "live" : "next", title: family.title, meta, progress: family.steps.length ? family.finished / family.steps.length : undefined,
        action: waiting ? { label: "Start all", run: () => openNeed(waiting) } : null, onOpen: () => openPanel("plans", { familyId: family.id }) }));
      const marks = el("li", "vibe-steps");
      marks.dataset.key = `plan:${family.id}:steps`;
      marks.dataset.final = family.final;
      marks.setAttribute("aria-label", `Steps of ${family.title}: ${family.finished} of ${family.steps.length} done, then a final check`);
      // A rebuilt track keeps its spinner turning where the last one was.
      try { marks.style.setProperty("--flow-phase", `-${Date.now() % 2400}ms`); } catch { /* no CSSOM in tests */ }
      for (const [index, step] of family.steps.entries()) { const mark = el("span", `vibe-step is-${step.state}`, String(index + 1)); mark.title = `${index + 1}. ${step.title}: ${STEP_STATES[step.state]}`; marks.append(mark); }
      plan.append(marks);
      const line = planLine(family, waiting);
      if (line) plan.append(line);
    }
    $("count-plan").textContent = data.families.length > 2 ? String(data.families.length) : "";

    // Cards come and go with what they have to say; with none up, one calm
    // line under the box says so, unless the gate banner already speaks.
    const shown = { needs: needCount > 0, plan: data.families.length > 0, building: building.children.length > 0, done: finished.children.length > 0, ideas: ideas.children.length > 0 };
    for (const [key, on] of Object.entries(shown)) $(`card-${key}`).hidden = !on;
    const visible = Object.values(shown).filter(Boolean).length;
    layer.dataset.cards = visible ? "some" : "none";
    $("quiet").hidden = visible > 0 || Boolean(data.gate);
  }
  // The line under a plan's track: the final check, the steps being built and
  // what their workers are doing, a check, a stuck step, or what comes next.
  // A plan waiting for your go-ahead already says so on its row.
  function planLine(family, waiting) {
    const indexes = (state) => family.steps.flatMap((step, index) => (step.state === state ? [index] : []));
    const doing = (job, fallback) => [job?.tool, job?.step].filter(Boolean).join(" · ") || fallback;
    const building = indexes("running"), checking = indexes("checking"), stuck = indexes("blocked");
    let lead, text, tone;
    if (["running", "checking"].includes(family.final)) [lead, text, tone] = ["Final check", doing(family.job, "putting the steps together and checking the whole thing"), "live"];
    else if (building.length === 1) [lead, text, tone] = [`Step ${building[0] + 1} · ${family.steps[building[0]].title}`, doing(family.steps[building[0]].job, "building"), "live"];
    else if (building.length > 1) [lead, text, tone] = [`Steps ${building.map((index) => index + 1).join(" and ")} building side by side`, building.map((index) => family.steps[index].title).join(" · "), "live"];
    else if (checking.length) [lead, text, tone] = [`Step ${checking[0] + 1} · ${family.steps[checking[0]].title}`, "checking its work", "check"];
    else if (stuck.length) [lead, text, tone] = [`Step ${stuck[0] + 1} is stuck`, family.steps[stuck[0]].title, "bad"];
    else if (waiting) return null;
    else {
      const next = family.steps.findIndex((step) => step.state === "waiting");
      if (next < 0) return null;
      [lead, text, tone] = [`Next · step ${next + 1}`, family.steps[next].title, "next"];
    }
    const item = el("li", `vibe-plan-now is-${tone}`);
    item.dataset.key = `plan:${family.id}:now`;
    item.append(el("b", "", lead), el("span", "", text));
    item.title = `${lead}: ${text}`;
    return item;
  }

  // ---- the dock ---------------------------------------------------------------
  // Tasks, Team and More always stand; Watch steps in while agents work, Plans
  // while a plan is in play, Ideas while fresh ones wait. The stop whose panel
  // is open is marked, so the dock doubles as the panel's tab strip.
  const STOPS = ["watch", "tasks", "plans", "ideas", "team", "more"];
  const PANEL_STOPS = new Set(["tasks", "plans", "ideas", "team"]);
  function dockStops(data = lanes()) {
    return { watch: data.running.length > 0 || data.checking.length > 0, tasks: true, plans: data.plans.length > 0 || data.families.length > 0, ideas: data.ideas.length > 0, team: true, more: true };
  }
  function renderDock(data) {
    const stops = dockStops(data);
    const open = window.MefiVibePanels?.current?.() ?? null;
    const standing = [];
    for (const key of STOPS) {
      const button = $(`stop-${key}`);
      if (!button) continue;
      // An open panel keeps its own stop, even after its last item leaves.
      button.hidden = !stops[key] && open !== key;
      if (!button.hidden) standing.push(key);
      if (PANEL_STOPS.has(key)) button.setAttribute("aria-pressed", String(open === key));
    }
    // One mark sits behind the open panel's stop and springs to the next one
    // (vibe.css .vibe-dock-mark); every stop is the same width, so its place
    // is a slot number, right even while a stop is still stepping in or out.
    const dock = $("dock");
    const slot = PANEL_STOPS.has(open) ? standing.indexOf(open) : -1;
    // A mark that was off appears at its stop instead of sliding from the last.
    const mark = dock?.querySelector?.(".vibe-dock-mark");
    const arriving = slot >= 0 && mark?.style && dock.dataset?.marked !== "yes";
    if (arriving) mark.style.transition = "none";
    if (slot >= 0) dock?.style?.setProperty?.("--slot", String(slot));
    if (arriving) { void mark.offsetWidth; mark.style.transition = ""; }
    if (dock?.dataset) dock.dataset.marked = slot >= 0 ? "yes" : "no";
  }

  // ---- panels -------------------------------------------------------------------
  // Vibe's menus (renderer/vibe-panels.js) read what the front door already
  // holds, so opening one costs no extra round trip. One side panel at a
  // time: a menu, the conversation, or a decision.
  function shared(data = lanes()) {
    return {
      projectId: projectId(), projectName: state.projects.find((item) => item.id === projectId())?.name || "",
      tasks: scoped(state.tasks), needs: data.needs, running: data.running, checking: data.checking, next: data.next,
      backlog: state.backlog && belongs(state.backlog) ? state.backlog : null, status: state.status || {}, assistant: state.assistant || {},
      ideas: scoped(state.ideas), plans: data.plans, families: data.families, gate: data.gate ? { key: data.gate.key, title: data.gate.title, text: data.gate.text, label: data.gate.action?.label ?? null } : null,
      companion: companion(), person: person(),
    };
  }
  function sharePanels(data) { if (window.MefiVibePanels?.isOpen?.()) window.MefiVibePanels.update(shared(data)); }
  function openPanel(kind, options = {}) {
    if (!window.MefiVibePanels) return false;
    if (!active()) go("vibe");
    closeAsk({ quiet: true });
    if (state.chatOpen) closeChat();
    window.MefiVibePanels.open(kind, { ...options, data: shared() });
    signatures.delete("lanes"); renderDock(lanes());
    return true;
  }
  function closeDrawers() {
    closeAsk({ quiet: true });
    if (state.chatOpen) closeChat();
  }
  // Build it on an idea: the same promotion as the Ideas page's Make task.
  async function promoteIdea(idea) {
    if (!api()?.backlogControl) { feedback("Ideas can be built from the desktop app.", "warn"); return false; }
    try {
      const result = await api().backlogControl({ action: "promote", ideaId: idea.id, projectId: projectId() });
      if (!result || result.ok === false) throw new Error(result?.error || "That idea could not become a task.");
      state.ideas = state.ideas.map((item) => item.id === idea.id ? { ...item, read: true, status: "accepted", taskId: result.taskIds?.[0] ?? item.taskId ?? true } : item);
      feedback(`"${idea.title || "The idea"}" is now a task.`, "good");
      signatures.delete("lanes"); renderLanes();
      scheduleBacklog();
      return true;
    } catch (error) {
      feedback(error?.message || "That idea could not become a task.", "bad");
      return false;
    }
  }
  function messages() {
    return (Array.isArray(state.assistant.messages) ? state.assistant.messages : []).filter((message) => ["user", "assistant"].includes(message?.role) && belongs(message)).slice(-60);
  }
  function renderChat() {
    const list = messages();
    const thinking = state.pending ? "pending" : "";
    const confirms = openQuestions().filter((question) => question.source === "chat");
    if (!changed("chat", [list, thinking, companion(), person(), confirms, state.chatOpen])) return;
    $("chat-title").textContent = companion();
    const thread = $("thread");
    const pinned = thread.scrollTop + thread.clientHeight >= thread.scrollHeight - 40;
    keep(thread, () => paintThread(thread, list, confirms), { ghosts: false, cascade: false });
    if (pinned || state.pending) thread.scrollTop = thread.scrollHeight;
    const last = [...list].reverse().find((message) => message.role === "assistant");
    $("last").hidden = !last || state.chatOpen;
    if (last) { $("last-who").textContent = companion(); $("last-text").textContent = last.text; }
    if (state.chatOpen) state.seenMessageId = list.at(-1)?.id ?? state.seenMessageId;
    const unread = Boolean(list.at(-1)?.id && list.at(-1).id !== state.seenMessageId && !state.chatOpen && list.at(-1)?.role === "assistant");
    $("chat-dot").hidden = !unread;
  }
  function paintThread(thread, list, confirms) {
    thread.replaceChildren();
    if (!list.length) thread.append(el("li", "vibe-empty", `Ask ${companion()} anything about this project. Replies show up here.`));
    for (const message of list) {
      const item = el("li", `vibe-msg is-${message.role}${message.kind === "notice" ? " is-notice" : ""}`);
      item.dataset.key = message.id || `${message.role}:${message.at ?? ""}:${String(message.text ?? "").slice(0, 40)}`;
      item.append(el("span", "vibe-msg-who", message.role === "user" ? person() || "You" : companion()), el("p", "vibe-msg-text", message.text));
      if (message.role === "assistant" && Array.isArray(message.offers)) {
        const chips = el("div", "vibe-chat-choices");
        for (const offer of message.offers) {
          const pick = el("button", "vibe-spark", offer.title); pick.type = "button";
          pick.addEventListener("click", async () => {
            pick.disabled = true;
            try {
              const result = offer.target?.id ? await api().assistantWorkOn({ ...offer.target, projectId: projectId(), start: true }) : await api().assistantMessage(`Work on "${offer.title}"`, projectId(), { view: "Vibe", companion: companion() });
              if (result?.ok === false) throw new Error(result.error);
              feedback(window.MefiAutonomy?.outcome?.(result, "Requested. Watch the task for its next step.") || result?.dispatch?.message || "Requested."); await refresh();
            } catch (error) { item.append(el("p", "vibe-inline-error", error.message)); }
            finally { pick.disabled = false; }
          }); chips.append(pick);
        } item.append(chips);
      }
      if (message.taskId === "__decided_for_you__") { const history = el("button", "vibe-ask-link", "Why / Undo · For you"); history.type = "button"; history.addEventListener("click", () => openPanel("decisions")); item.append(history); }
      thread.append(item);
    }
    for (const question of confirms) {
      const item = el("li", "vibe-msg is-assistant vibe-inline-confirm"); item.dataset.key = `confirm:${question.id}`; item.append(el("p", "vibe-msg-text", question.title));
      const controls = el("div", "vibe-chat-choices");
      for (const option of question.options || []) {
        const pick = el("button", "vibe-btn quiet", option.id === "yes" ? "Yes" : option.id === "no" ? "No" : option.label); pick.type = "button";
        pick.addEventListener("click", async () => {
          for (const control of controls.children) control.disabled = true;
          try {
            const result = await api().assistantAnswer({ id: question.id, optionId: option.id, projectId: projectId() });
            if (result?.ok === false) throw new Error(result.error);
            if (result?.state && belongs(result.state)) state.assistant = result.state;
            else state.assistant.questions = (state.assistant.questions || []).map((row) => row.id === question.id ? { ...row, status: "answered" } : row);
            await refresh(); signatures.delete("chat"); renderChat();
          } catch (error) { item.append(el("p", "vibe-inline-error", error.message)); for (const control of controls.children) control.disabled = false; }
        }); controls.append(pick);
      } item.append(controls); thread.append(item);
    }
    if (state.pending) { const typing = el("li", "vibe-msg is-assistant is-typing"); typing.dataset.key = "typing"; typing.append(el("span", "vibe-msg-who", companion()), el("span", "vibe-typing")); typing.lastChild.append(el("i"), el("i"), el("i")); thread.append(typing); }
  }
  function renderHead() {
    syncDraft();
    const project = state.projects.find((item) => item.id === projectId());
    $("project-name").textContent = project?.name || "Choose a project";
    $("kicker").textContent = greeting();
    const permission = window.MefiAutonomy?.state?.();
    const decisionState = permission?.projectId === projectId() ? permission : state.assistant;
    const decisions = (decisionState.decisions || []).filter((row) => !row.undone && !row.failed && !row.pending);
    const todos = (decisionState.todos || []).filter((row) => !row.doneAt);
    if ($("decisions")) { $("decisions").hidden = !decisions.length && !todos.length; $("decisions").textContent = `Decided for you (${decisions.length}) · For you (${todos.length})`; }
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
  // `run` is the planner's live run (renderer/vibe-flow.js) while it looks.
  const evolution = { intent: null, context: null, result: null, signature: null, loading: false, request: 0, error: "", run: null };
  const flow = () => window.MefiVibeFlow;
  const evolutionView = {};
  const INTENTS = {
    modify: { label: "Modify", hint: "Shape an existing feature", starter: "Change this project so that ", guide: "Adapt the existing behavior to the requested outcome. Reuse the systems already in this project." },
    experiment: { label: "Experiment", hint: "Try a small possibility", starter: "Try a small experiment: ", guide: "Build a bounded, reversible experiment. Say what to compare and how to decide whether to keep it." },
    fix: { label: "Fix", hint: "Make something work again", starter: "Something is broken: ", guide: "Investigate the cause, make a focused correction, and verify the behavior that was broken." },
    improve: { label: "Improve", hint: "Polish what is already here", starter: "Improve this project by ", guide: "Improve the existing experience with a small, useful change and a clear way to check the result." },
  };
  const evolutionKey = (id) => `mefiStudio.vibe.evolution.${id}`;
  function saveDraft() {
    if (!draftProject) return;
    write(draftKey(draftProject), $("input").value);
    write(evolutionKey(draftProject), JSON.stringify({ intent: evolution.intent, context: evolution.context }));
  }
  function syncDraft(id = projectId()) {
    if (id === draftProject) return;
    saveDraft(); draftProject = id; draftEpoch++;
    state.seenMessageId = id ? read(`mefiStudio.vibe.seen.${id}`) : null; state.askErrors = {};
    let saved = null;
    try { saved = id ? JSON.parse(read(evolutionKey(id)) || "null") : null; } catch { /* older or damaged local draft */ }
    evolution.intent = Object.hasOwn(INTENTS, saved?.intent) ? saved.intent : null;
    evolution.context = normalizeEvolution(saved?.context);
    evolution.request++; evolution.loading = false; evolution.result = null; evolution.error = ""; evolution.signature = null; evolution.run = null;
    hideSizing(); // the strip speaks for a request in the project just left
    $("input").value = id ? read(draftKey(id)) || "" : ""; grow();
    renderEvolution();
  }
  const shortText = (value, max = 600) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const evolutionIdeas = (context) => [...new Set([...(Array.isArray(context?.ideaIds) ? context.ideaIds : []), context?.ideaId, context?.idea?.sourceId || context?.idea?.id].map((id) => shortText(id, 180)).filter(Boolean))];
  function normalizeEvolution(context) {
    if (!context || typeof context !== "object") return null;
    const system = context.system;
    const files = [...new Set([context.file, ...(Array.isArray(context.files) ? context.files : [])].map((file) => shortText(typeof file === "string" ? file : file?.path || file?.file, 600)).filter(Boolean))].slice(0, 8);
    const ideaIds = evolutionIdeas(context);
    if (ideaIds.length > 16) return null;
    return { system: shortText(typeof system === "string" ? system : system?.name || context.systemName, 180), systemId: shortText(system?.id || context.systemId, 180), files, ideaIds, ideaId: ideaIds.length === 1 ? ideaIds[0] : null };
  }
  const evolutionSignature = () => JSON.stringify([draftProject, $("input").value, evolution.intent, evolution.context]);
  // Suggestions answer the draft they were asked for: a newer direction typed
  // over it makes them read-only. An empty box (just built, or cleared) has no
  // direction to overwrite, so they stay usable to start the next draft.
  const evolutionStale = () => evolution.signature !== evolutionSignature() && Boolean($("input").value.trim());
  function chooseIntent(intent) {
    if (!Object.hasOwn(INTENTS, intent)) return;
    syncDraft();
    const input = $("input"), previous = INTENTS[evolution.intent];
    if (!input.value.trim()) input.value = INTENTS[intent].starter;
    else if (previous && input.value.startsWith(previous.starter)) input.value = INTENTS[intent].starter + input.value.slice(previous.starter.length);
    evolution.intent = intent;
    grow(); saveDraft(); renderEvolution(); input.focus();
  }
  // The map hands over an editable, project-scoped brief. Existing owner text
  // is appended to, never replaced, and staging cannot send or create work.
  function composeEvolution(options = {}) {
    const id = projectId();
    if (!id || options.projectId && options.projectId !== id) return false;
    init(); syncDraft();
    const intent = Object.hasOwn(INTENTS, options.intent) ? options.intent : "improve";
    const current = $("input").value.trim();
    const ideaIds = [...new Set([...(current ? evolutionIdeas(evolution.context) : []), ...evolutionIdeas(options)])];
    const refuse = (text) => { go("vibe"); $("input").focus(); feedback(text, "warn"); return false; };
    if (ideaIds.length > 16) return refuse("This draft already has 16 saved ideas. Build these together or clear the draft before adding another.");
    const context = normalizeEvolution({ ...options, ideaIds });
    const idea = typeof options.idea === "string" ? options.idea : options.idea?.text || options.idea?.detail;
    const title = shortText(options.title || options.idea?.title || options.idea?.label, 180);
    const rawText = options.prompt || idea;
    const text = typeof rawText === "string" ? rawText.trim() : "";
    const subject = context?.system || context?.files[0] || "this project";
    const lines = [`${INTENTS[intent].label}: ${title || (text ? text.split("\n")[0].slice(0, 180) : subject)}`];
    if (text) lines.push(text);
    if (context?.system) lines.push(`System: ${context.system}`);
    if (context?.files.length) lines.push(`Relevant files:\n${context.files.map((file) => `- ${file}`).join("\n")}`);
    const block = lines.join("\n\n");
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > 16000) return refuse("This brief will not fit beside your current draft. Shorten the draft before adding it.");
    evolution.intent = intent; evolution.context = context;
    $("input").value = next; grow(); saveDraft(); renderEvolution();
    if (!active()) go("vibe");
    $("input").focus();
    feedback(current ? "Added to your draft. Review it, then talk it over or build it." : "Ready to shape. Review the brief, then talk it over or build it.");
    return true;
  }
  function renderSparks() {
    const holder = $("sparks");
    holder.replaceChildren();
    holder.className = "vibe-sparks vibe-evolution";
    holder.setAttribute("role", "region"); holder.setAttribute("aria-label", "Mefi: Modify, Experiment, Fix, Improve");
    const head = el("div", "vibe-evolution-head"), caption = el("div");
    caption.append(el("b", "vibe-evolution-brand", "MEFI"), el("span", "vibe-evolution-subtitle", "Build on what is here"));
    const links = el("div", "vibe-evolution-links");
    const map = el("button", "vibe-ask-link", "System map ↗"); map.type = "button";
    map.addEventListener("click", () => go("agent-brain", { tab: "map", mapMode: "systems" }));
    const ideas = el("button", "vibe-ask-link", "Ideas tree ↗"); ideas.type = "button";
    ideas.addEventListener("click", () => go("agent-brain", { tab: "map", mapMode: "ideas" }));
    links.append(map, ideas); head.append(caption, links);
    const choices = el("div", "vibe-evolution-intents"); choices.setAttribute("role", "group"); choices.setAttribute("aria-label", "How to build on this project");
    evolutionView.choices = [];
    for (const [intent, entry] of Object.entries(INTENTS)) {
      const chip = el("button", "vibe-evolution-intent"); chip.type = "button"; chip.dataset.intent = intent;
      const words = el("span"); words.append(el("b", "", entry.label), el("small", "", entry.hint));
      chip.append(el("span", "vibe-evolution-letter", entry.label[0]), words);
      chip.addEventListener("click", () => chooseIntent(intent)); choices.append(chip); evolutionView.choices.push(chip);
    }
    const foot = el("div", "vibe-evolution-foot");
    evolutionView.scope = el("span", "vibe-evolution-scope");
    const suggest = el("button", "vibe-btn quiet vibe-evolution-suggest"); suggest.type = "button"; suggest.dataset.evolutionAction = "suggest";
    evolutionView.suggestLabel = el("span", "", "Suggest a next step");
    suggest.append(glyph("g-spark"), evolutionView.suggestLabel);
    suggest.addEventListener("click", () => void suggestEvolution()); evolutionView.suggest = suggest;
    foot.append(evolutionView.scope, suggest);
    evolutionView.results = el("div", "vibe-evolution-results");
    // One quiet status for screen readers: looking, found, or why it stopped.
    evolutionView.status = el("p", "sr-only"); evolutionView.status.setAttribute("role", "status");
    holder.append(head, choices, foot, evolutionView.results, evolutionView.status); renderEvolution();
  }
  function glyph(id) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "glyph"); svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${id}`); svg.append(use);
    return svg;
  }
  // Brings a new result into view inside the stage, without jumping when it already shows.
  function reveal(node) {
    if (!node || node.hidden || !active()) return;
    try { node.scrollIntoView?.({ block: "nearest", behavior: window.MefiNav?.noMotion?.() ? "auto" : "smooth" }); } catch { /* no layout */ }
  }
  function renderEvolution() {
    if (!evolutionView.results) return;
    for (const button of evolutionView.choices) button.setAttribute("aria-pressed", String(button.dataset.intent === evolution.intent));
    const where = evolution.context?.system || evolution.context?.files[0];
    evolutionView.scope.textContent = where ? `Scope: ${where}` : "Scope: the whole project. Pick an approach, or let Mefi suggest one.";
    evolutionView.suggestLabel.textContent = evolution.loading ? "Looking…" : evolution.result ? "Suggest again" : "Suggest a next step";
    evolutionView.suggest.disabled = evolution.loading || state.pending || !projectId();
    evolutionView.suggest.dataset.busy = evolution.loading ? "yes" : "no";
    const said = evolution.loading ? "Mefi is looking for next steps." : evolution.error || (evolution.result ? `${evolution.result.suggestions?.length || "No"} suggestion${evolution.result.suggestions?.length === 1 ? "" : "s"} ready.` : "");
    if (evolutionView.status.textContent !== said) evolutionView.status.textContent = said;
    const body = evolutionView.results;
    body.hidden = !evolution.loading && !evolution.result && !evolution.error;
    // While Mefi looks: its live run (renderer/vibe-flow.js) over placeholders
    // where the ideas will land. The run's view updates itself as the host
    // reports each step, so a repaint here leaves it where it is.
    if (evolution.loading) {
      const run = evolution.run ? flow()?.get?.(evolution.run) : null;
      const view = run ? flow().view(run) : null;
      if (!view) body.replaceChildren(el("p", "vibe-evolution-note", "Mefi is reading relevant files and looking for a useful next step."));
      else if (view.parentNode !== body) body.replaceChildren(view, flow().skeleton(3));
      return;
    }
    body.replaceChildren();
    if (evolution.error) body.append(el("p", "vibe-inline-error", evolution.error));
    if (!evolution.result) return;
    const suggestions = Array.isArray(evolution.result.suggestions) ? evolution.result.suggestions : [];
    // What Mefi read the project as, and how the look went.
    const run = evolution.run ? flow()?.get?.(evolution.run) : null;
    const head = el("div", "vibe-evolution-summary");
    const facts = [suggestions.length ? `${suggestions.length} idea${suggestions.length === 1 ? "" : "s"}` : "", run?.endedAt ? `found in ${flow().took(run.endedAt - run.startedAt)}` : "", run?.seen?.read?.scanned ? `${run.seen.read.scanned} files scanned` : ""].filter(Boolean).join(" · ");
    const words = el("div");
    if (facts) words.append(el("span", "vibe-evolution-facts", facts));
    if (evolution.result.summary) words.append(el("p", "vibe-evolution-note", evolution.result.summary));
    const clear = el("button", "vibe-ask-link vibe-evolution-clear", "Clear"); clear.type = "button"; clear.title = "Put these suggestions away";
    clear.addEventListener("click", () => { evolution.result = null; evolution.error = ""; renderEvolution(); evolutionView.suggest.focus?.(); });
    head.append(words, clear);
    body.append(head);
    const stale = evolutionStale();
    if (stale) {
      const note = el("div", "vibe-evolution-stale");
      const again = el("button", "vibe-ask-link", "Suggest again"); again.type = "button";
      again.addEventListener("click", () => void suggestEvolution());
      note.append(el("span", "", "Your draft changed. Refresh to get suggestions for the current direction."), again);
      body.append(note);
    }
    const cards = el("div", "vibe-evolution-suggestions");
    for (const [index, suggestion] of suggestions.entries()) {
      const card = el("article", `vibe-evolution-suggestion${suggestion.used ? " is-used" : ""}`);
      try { card.style.setProperty("--i", String(index)); } catch { /* no CSSOM in tests */ }
      const top = el("div", "vibe-evolution-card-head");
      top.append(el("span", "vibe-evolution-num", String(index + 1)), el("h3", "", suggestion.label));
      card.append(top, el("p", "", suggestion.text));
      if (suggestion.reason) card.append(el("p", "vibe-evolution-why", suggestion.reason));
      if (suggestion.files?.length) {
        const list = el("div", "vibe-evolution-files");
        for (const file of suggestion.files) { const chip = el("code", "vibe-evolution-file", file); chip.title = file; list.append(chip); }
        card.append(list);
      }
      const actions = el("div", "vibe-evolution-actions");
      const use = el("button", "vibe-btn quiet", suggestion.used ? "Added to draft" : "Add to draft"); use.type = "button"; use.disabled = stale || state.pending || Boolean(suggestion.used);
      use.addEventListener("click", () => useSuggestion(suggestion));
      const keep = el("button", "vibe-ask-link", suggestion.saved ? "Idea saved" : suggestion.saving ? "Saving…" : "Save idea"); keep.type = "button"; keep.disabled = stale || Boolean(suggestion.saved || suggestion.saving);
      keep.addEventListener("click", () => void keepEvolutionIdea(suggestion));
      actions.append(use, keep); card.append(actions); cards.append(card);
    }
    body.append(cards);
    if (!cards.children.length) body.append(el("p", "vibe-evolution-note", "No extra changes suggested yet. Shape an idea above and try again."));
  }
  // A planning reply has a transient suggestion-0 id. Only a saved board idea
  // may follow this draft into a task and advance the ideas tree. Adding one
  // suggestion keeps the rest of its set usable: the draft moved because of
  // this set, not away from it.
  function useSuggestion(suggestion) {
    const usable = !evolutionStale();
    const added = composeEvolution({ projectId: draftProject, intent: evolution.intent || "improve", ...evolution.context, ideaId: suggestion.savedId || null, idea: { title: suggestion.label, text: suggestion.text }, files: suggestion.files });
    if (!added) return;
    suggestion.used = true;
    if (usable) evolution.signature = evolutionSignature();
    renderEvolution();
  }
  async function suggestEvolution() {
    init(); syncDraft();
    if (evolution.loading || state.pending) return;
    if (!projectId() || !api()?.planningExplore) { evolution.error = "Choose a project in the desktop app to ask Mefi for suggestions."; renderEvolution(); return; }
    const id = projectId(), epoch = draftEpoch, request = ++evolution.request, signature = evolutionSignature();
    const intent = INTENTS[evolution.intent || "improve"];
    const scope = evolution.context;
    const value = $("input").value.trim();
    const destination = [value || "Suggest a few small, useful next steps for the existing application in this project.", `Approach: ${intent.label}. ${intent.guide}`, scope?.system ? `System: ${scope.system}` : "", scope?.files.length ? `Relevant files: ${scope.files.join(", ")}` : ""].filter(Boolean).join("\n\n");
    if (destination.length > 16000) { evolution.error = "Shorten the draft a little before asking for suggestions."; renderEvolution(); return; }
    // The host reports each step of this look under the run's id.
    const run = flow()?.begin?.("explore", { projectId: id, title: `${intent.label} this project` }) ?? null;
    evolution.run = run?.id ?? null;
    evolution.loading = true; evolution.error = ""; renderEvolution();
    reveal(evolutionView.results);
    const current = () => id === projectId() && epoch === draftEpoch && request === evolution.request;
    try {
      const result = await api().planningExplore({ projectId: id, draft: { title: `${intent.label} this project`, destination, outOfScope: "Suggestions for review only. Do not implement, create tasks, or approve work." }, focus: "destination", intent: "suggest", ...(run ? { requestId: run.id } : {}) });
      if (!current()) { if (run) flow().end(run.id, { ok: false, error: "Set aside: the project or the draft changed." }); return; }
      if (result?.projectId !== id || !result?.ok) throw new Error(result?.error || "Mefi could not explore this project. Try again.");
      evolution.result = result; evolution.signature = signature;
      if (run) flow().end(run.id, { ok: true, count: Array.isArray(result.suggestions) ? result.suggestions.length : 0 });
    } catch (error) {
      if (run) flow().end(run.id, { ok: false, error: error?.message || "Suggestions are unavailable." });
      if (current()) evolution.error = error?.message || "Suggestions are unavailable. Try again.";
    }
    finally { if (current()) { evolution.loading = false; renderEvolution(); reveal(evolutionView.results); } }
  }
  async function keepEvolutionIdea(suggestion) {
    if (suggestion.saved || suggestion.saving || evolutionStale()) return;
    const id = projectId(), epoch = draftEpoch, context = evolution.context;
    suggestion.saving = true; renderEvolution();
    try {
      if (!api()?.ideasAction) throw new Error("Keeping ideas requires the desktop app.");
      const result = await api().ideasAction({ action: "add", projectId: id, title: suggestion.label, detail: suggestion.text, files: suggestion.files || [], tags: ["mefi", evolution.intent || "improve"], systemId: context?.systemId || undefined, systemName: context?.system || undefined, intent: evolution.intent || "improve" });
      if (id !== projectId() || epoch !== draftEpoch) return;
      if (!result?.ok || result.projectId !== id) throw new Error(result?.error || "The idea could not be kept. Try again.");
      suggestion.saved = true;
      suggestion.savedId = shortText(result.idea?.id, 180) || null;
      if (Array.isArray(result.ideas)) state.ideas = result.ideas;
      feedback("Idea saved for later. Find it in the idea tree or add it to your draft when you are ready.", "good"); renderLanes();
    } catch (error) { if (id === projectId() && epoch === draftEpoch) feedback(error?.message || "The idea could not be kept.", "bad"); }
    finally { suggestion.saving = false; if (id === projectId() && epoch === draftEpoch) renderEvolution(); }
  }
  function grow() { const input = $("input"); input.style.height = "auto"; input.style.height = `${Math.min(220, input.scrollHeight)}px`; }
  function feedback(text, tone = "") { const node = $("feedback"); node.textContent = text; node.dataset.tone = tone; }
  // ---- the sizing strip -------------------------------------------------------
  // Build it's wait, live under the box (renderer/vibe-flow.js): the quick
  // look, the lead planning the steps, then the board. It shows only when the
  // wait outlasts a blink, stays a moment on how it ended, then steps away.
  const sizingView = { run: null, timer: 0 };
  function showSizing(run) {
    const slot = $("flow");
    if (!slot || !run || !flow()) return;
    clearTimeout(sizingView.timer);
    sizingView.run = run.id;
    sizingView.timer = setTimeout(() => {
      if (sizingView.run !== run.id || run.endedAt) return;
      slot.replaceChildren(flow().view(run));
      slot.hidden = false;
      reveal(slot);
    }, 350);
  }
  function settleSizing(run, { familyId = null } = {}) {
    const slot = $("flow");
    if (!slot || !run || sizingView.run !== run.id) return;
    clearTimeout(sizingView.timer);
    if (slot.hidden || !slot.querySelector?.(`.vibe-flow-run[data-run="${run.id}"]`)) { sizingView.run = null; return; }
    if (run.outcome?.ok && familyId) flow().action(run, { label: "Show the plan →", run: () => { hideSizing(); openPanel("plans", { familyId }); } });
    sizingView.timer = setTimeout(() => hideSizing(run.id), run.outcome?.ok ? 7000 : 1600);
  }
  function hideSizing(id = null) {
    const slot = $("flow");
    if (!slot || (id && sizingView.run !== id)) return;
    clearTimeout(sizingView.timer);
    sizingView.timer = 0; sizingView.run = null;
    slot.hidden = true;
  }
  function busy(on) {
    state.pending = on;
    layer.dataset.pending = on ? "yes" : "no";
    for (const id of ["talk", "build"]) $(id).disabled = on;
    renderEvolution();
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
    // Build it asks the host to size the request (vibeBuild): one card, or the
    // card split into steps; an older host only knows the one card. The
    // sizing strip speaks while it waits; without it, one line does.
    const sizing = intent === "build" && Boolean(api().vibeBuild);
    const run = sizing ? flow()?.begin?.("size", { projectId: id, title: value.split("\n")[0] }) ?? null : null;
    if (run) showSizing(run);
    feedback(intent === "build" ? (run ? "" : sizing ? "Sizing it up…" : "Adding it to the build queue…") : `${companion()} is thinking…`);
    renderChat();
    try {
      const title = value.split("\n")[0].slice(0, 180);
      const approach = INTENTS[evolution.intent];
      const prompt = approach ? `MEFI · ${approach.label}\n${approach.guide}\n\n${value}` : value;
      const ideaIds = evolutionIdeas(evolution.context);
      const linkedIdeas = ideaIds.length > 1 ? { ideaIds } : ideaIds.length ? { ideaId: ideaIds[0] } : {};
      const result = intent === "build"
        ? await (sizing ? api().vibeBuild({ title, prompt, projectId: id, ...linkedIdeas, ...(run ? { requestId: run.id } : {}) }) : api().tasksCreate({ title, prompt, projectId: id }))
        : await api().assistantMessage(value, id, { view: "Vibe", companion: companion(), mode: "talk" });
      if (!result || result.ok === false) throw new Error(result?.error || "That didn't go through.");
      if (run) { flow().end(run.id, { ok: true, steps: Number(result.steps) || 0 }); settleSizing(run, { familyId: Number(result.steps) > 0 ? result.task?.id ?? null : null }); }
      if (projectId() !== id || draftEpoch !== epoch) return;
      if (input.value.trim() === value) { input.value = ""; evolution.context = null; grow(); saveDraft(); renderEvolution(); }
      if (result.state) state.assistant = result.state;
      if (intent === "build") {
        // Say where it really goes: a held or paused queue, or no AI, keeps
        // it waiting, and the banner below the box has the control that frees it.
        const gate = runState()?.key;
        const steps = Number(result.steps) || 0;
        const what = steps ? `Split into ${steps} steps, then a final check.` : "Added to the queue.";
        feedback(gate === "held" ? `${what} Select Start agents below and it begins.` : gate === "paused" ? `${what} New work is paused; Resume below to start it.` : gate === "key" ? `${what} Connect an AI below so it can be built.`
          : state.status.autoBuild === false ? `${steps ? what : "Added."} ${steps ? "They wait" : "It waits"} for your go-ahead under Needs you.`
          : steps ? `${what} Follow it on the plan card.` : "Added. It shows under Building now as soon as an agent picks it up.", gate && gate !== "waiting" ? "warn" : "good");
        scheduleBacklog();
        window.dispatchEvent(new CustomEvent("mefi:task-created", { detail: { taskId: result.task?.id, projectId: id } }));
      } else feedback("");
      await refresh();
    } catch (error) {
      if (run && !run.endedAt) { flow().end(run.id, { ok: false, error: error?.message || "That didn't go through." }); settleSizing(run); }
      if (projectId() === id && draftEpoch === epoch) feedback(`${error?.message || "That didn't go through."} Your text is still in the box.`, "bad");
    } finally { busy(false); renderChat(); }
  }

  // ---- conversation drawer --------------------------------------------------
  function openChat() {
    closeAsk({ quiet: true });
    window.MefiVibePanels?.close?.({ quiet: true });
    state.chatOpen = true; $("chat").hidden = false; layer.dataset.chat = "open";
    $("chat-toggle").setAttribute("aria-expanded", "true");
    state.seenMessageId = messages().at(-1)?.id ?? null;
    if (projectId() && state.seenMessageId) write(`mefiStudio.vibe.seen.${projectId()}`, state.seenMessageId);
    signatures.delete("chat"); renderChat();
    const thread = $("thread"); thread.scrollTop = thread.scrollHeight;
  }
  function closeChat() {
    state.chatOpen = false; $("chat").hidden = true; layer.dataset.chat = "closed";
    $("chat-toggle").setAttribute("aria-expanded", "false");
    state.seenMessageId = messages().at(-1)?.id ?? null;
    if (projectId() && state.seenMessageId) write(`mefiStudio.vibe.seen.${projectId()}`, state.seenMessageId);
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
    // Steps of one split request wait as one row: the family, started together.
    const grouped = new Map();
    for (const item of rows("approval")) {
      const step = taskById(item.id);
      const parentId = step?.delegatedFrom?.intake ? step.parentTaskId || step.delegatedFrom.parentTaskId : null;
      if (parentId) { if (!grouped.has(parentId)) grouped.set(parentId, []); grouped.get(parentId).push(item); continue; }
      list.push({ kind: "approval", id: item.id, tone: "ask", verb: "Review", title: item.title || taskById(item.id)?.title || "A task", meta: "waiting for your go-ahead", row: item });
    }
    for (const [parentId, items] of grouped) list.push({ kind: "family", id: parentId, tone: "ask", verb: "Review", title: taskById(parentId)?.title || "Your request", meta: `${items.length} step${items.length === 1 ? "" : "s"} waiting for your go-ahead`, rows: items });
    for (const item of rows("blocked")) list.push({ kind: "blocked", id: item.id, tone: "bad", verb: HOLD_VERBS[item.blockedBy] || "See why", title: item.title || taskById(item.id)?.title || "A task", meta: item.blockedBy === "owner" ? "stopped by you" : "stuck", row: item });
    const shared = state.assistant.needsYou;
    if (shared?.items && belongs(state.assistant)) return shared.items.map((item) => {
      if (item.kind === "question") return list.find((row) => row.kind === "question" && row.id === item.id);
      const grouped = item.memberIds?.length ? list.find((row) => row.kind === "family" && row.id === item.taskId) : null;
      return grouped || list.find((row) => row.id === item.taskId && row.kind !== "question") || { kind: item.kind === "approval" ? "approval" : "blocked", id: item.taskId, tone: "ask", verb: "Review", title: item.title, meta: item.kind === "review" ? "check the result" : "waiting for your review", row: { canRetry: false, reason: item.title } };
    }).filter(Boolean);
    return list;
  }
  const needKey = (need) => need ? `${need.kind}:${need.id}` : "";
  function openNeed(need) {
    if (state.chatOpen) closeChat();
    window.MefiVibePanels?.close?.({ quiet: true });
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
  // A typed answer per question: pushes rebuild the drawer (another need
  // arriving changes the signature), which emptied the box and took focus.
  const askDrafts = new Map();
  let askRefocus = false;
  function renderAsk() {
    if (!state.need || $("ask").hidden) return;
    const all = needs();
    const index = all.findIndex((item) => needKey(item) === needKey(state.need));
    const need = all[index];
    if (need && !state.askSending) { $("ask-note").textContent = state.askErrors[needKey(need)] || ""; $("ask-note").dataset.tone = state.askErrors[needKey(need)] ? "bad" : ""; }
    const task = need && need.kind !== "question" ? taskById(need.id) : null;
    if (!changed("ask", [need ?? null, task, all.length, state.askSending, state.status.autoBuild])) return;
    const body = $("ask-body");
    askRefocus = Boolean(document.activeElement && body.contains(document.activeElement) && document.activeElement.matches?.(".vibe-ask-own textarea"));
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
    $("ask-kicker").textContent = `${["approval", "family"].includes(need.kind) ? "Waiting for your go-ahead" : need.row?.blockedBy === "owner" ? "Stopped by you" : "Stuck"}${position}`;
    $("ask-title").textContent = need.title;
    if (need.kind === "family") renderFamily(body, need);
    else if (need.kind === "approval") renderApproval(body, need, task);
    else renderBlocked(body, need, task);
  }
  // A request split into steps under Verify first: its steps start together.
  function renderFamily(body, need) {
    const family = families().find((item) => item.id === need.id);
    body.append(chips([chip(window.MefiAutonomy?.label?.() || "Your approval", "decision"), chip(`${need.rows.length} step${need.rows.length === 1 ? "" : "s"}`)]));
    body.append(el("p", "vibe-ask-detail", "These steps need your approval before they start. Your request runs last, to put the steps together and check the whole thing."));
    if (family) {
      const list = el("ol", "vibe-ask-steps");
      for (const step of family.steps) { const item = el("li", `is-${step.state}`, step.title); item.title = STEP_STATES[step.state] || ""; list.append(item); }
      body.append(list);
    }
    const ready = need.rows.filter((row) => typeof row.buildScope === "string" && row.buildScope && row.canApprove !== false);
    body.append(actions([
      { label: `Start ${ready.length === 1 ? "the step" : `all ${ready.length} steps`}`, primary: true, disabled: !ready.length, title: "Approve every waiting step as it is saved now", run: () => act(need, () => startSteps(ready), "Started. The steps build as workers free up.") },
      { label: "Make it one task", title: "Drop the steps that have not started; the request is built as one task", run: () => act(need, () => mergeSteps(need.id), "Kept as one task. It builds as a whole.") },
    ]));
  }
  // Approving each step is the same call Review makes for a single build.
  async function startSteps(rows) {
    let result = { ok: true };
    for (const row of rows) {
      result = await api().backlogControl({ action: "approve", taskId: row.id, projectId: projectId(), expectedScope: row.buildScope });
      if (!result || result.ok === false) return result;
    }
    if (state.backlog) state.backlog = { ...state.backlog, approval: (state.backlog.approval || []).filter((item) => !rows.some((row) => row.id === item.id)) };
    return result;
  }
  // Undo the split: the steps nobody has started are dropped, and a parent
  // stops waiting for dropped work, so the request runs whole.
  async function mergeSteps(parentId) {
    return api().tasksAction({ taskId: parentId, projectId: projectId(), action: "merge-steps" });
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
    const suggestion = context.suggestion;
    const suggested = question.options?.find((option) => option.id === suggestion?.optionId);
    if (suggestion) body.append(el("p", "vibe-suggestion", `Mefi suggests: ${suggested?.label || "Your review"} — ${suggestion.reason || ""}`));
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
      const button = el("button", `vibe-ask-option${option.id === suggested?.id || option.recommended ? " is-recommended" : ""}`);
      button.type = "button";
      const label = el("span", "vibe-ask-option-label", option.label);
      if (option.recommended) label.append(el("span", "vibe-ask-rec", "Recommended"));
      button.append(label);
      if (option.description) button.append(el("span", "vibe-ask-option-desc", option.description));
      button.disabled = state.askSending;
      button.addEventListener("click", () => {
        if (option.text || option.action?.action === "instruct") { selectedTextOption = option; input.placeholder = "Your one-line answer…"; remember(); input.focus(); }
        else void answer(question, { optionId: option.id, label: option.label });
      });
      options.append(button);
    }
    body.append(options);
    let selectedTextOption = null;
    const own = el("form", "vibe-ask-own");
    const input = el("textarea");
    input.rows = 2; input.placeholder = choices.length ? "Or say it in your own words…" : "Your answer…";
    input.setAttribute("aria-label", "Write your own answer");
    const kept = askDrafts.get(question.id);
    if (kept) {
      input.value = kept.text;
      selectedTextOption = choices.find((option) => option.id === kept.optionId) ?? null;
      if (selectedTextOption) input.placeholder = "Your one-line answer…";
    }
    const remember = () => askDrafts.set(question.id, { text: input.value, optionId: selectedTextOption?.id ?? null });
    input.addEventListener("input", remember);
    const send = el("button", "vibe-btn quiet", "Send");
    send.type = "submit"; send.disabled = state.askSending;
    own.append(input, send);
    own.addEventListener("submit", (event) => { event.preventDefault(); const text = input.value.trim(); if (text) void answer(question, { optionId: selectedTextOption?.id ?? null, text, label: text }); else input.focus(); });
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); own.requestSubmit(); } });
    body.append(own);
    if (askRefocus) { askRefocus = false; input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }
  function renderApproval(body, need, task) {
    const row = need.row || {};
    const waitingOn = Array.isArray(row.dependencies) ? row.dependencies.filter((item) => item && item.done !== true).length : 0;
    body.append(chips([chip(window.MefiAutonomy?.label?.() || "Your approval", "decision"), waitingOn ? chip(`waits for ${waitingOn} other task${waitingOn === 1 ? "" : "s"}`) : null, task?.createdAt ? el("span", "vibe-ask-when", `added ${ago(task.createdAt)}`) : null]));
    body.append(el("p", "vibe-ask-detail", "Your permission settings require approval of this brief. Approving lets it start when a worker is free."));
    const text = brief(task);
    if (text) body.append(text);
    const canApprove = row.canApprove === true && typeof row.buildScope === "string" && row.buildScope;
    body.append(actions([
      { label: window.MefiAutonomy?.state?.()?.level === "accept" ? "Accept this task" : "Approve build", primary: true, disabled: !canApprove, title: canApprove ? "Approve this brief so the task can build" : "Open it on the task board to review its current brief", run: () => act(need, () => api().backlogControl({ action: "approve", taskId: need.id, projectId: projectId(), expectedScope: row.buildScope }), "Approved. It builds when a worker is free.") },
      { label: "Drop it", run: () => act(need, () => api().tasksAction({ taskId: need.id, projectId: projectId(), action: "drop" }), "Dropped. It's closed without being built.") },
    ]));
    if (window.MefiAutonomy) {
      const auto = el("button", "vibe-ask-link vibe-ask-auto", "Review permission settings");
      auto.type = "button";
      auto.title = "Choose which work Mefi may start and which decisions stay with you.";
      auto.disabled = state.askSending;
      auto.addEventListener("click", () => window.MefiAutonomy.openSettings());
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
    const requestProject = projectId(), requestKey = needKey(need);
    delete state.askErrors[requestKey];
    if (!api()) { note.textContent = "This works in the desktop app."; note.dataset.tone = "warn"; return; }
    // Where it sat in the list, so the drawer moves forward, not back to the top.
    const place = Math.max(0, needs().findIndex((item) => needKey(item) === needKey(need)));
    state.askSending = true; signatures.delete("ask"); renderAsk();
    note.textContent = "Working on it…"; note.dataset.tone = "";
    try {
      const result = await call();
      // Switched project while this ran: release the drawer, or its buttons stay
      // disabled and act() returns at once until a reload.
      if (requestProject !== projectId()) { state.askSending = false; signatures.delete("ask"); return; }
      if (!result || result.ok === false) throw Object.assign(new Error(result?.error || "That didn't go through."), { gone: result?.gone });
      if (result.backlog && belongs(result.backlog)) state.backlog = { ...result.backlog, ok: true };
      if (result.task) state.tasks = state.tasks.map((item) => item.id === result.task.id ? result.task : item);
      if (result.state && belongs(result.state)) state.assistant = result.state;
      // Until the next read, what was just handled stays out of Needs you.
      if (state.backlog && Array.isArray(state.backlog[need.kind])) state.backlog = { ...state.backlog, [need.kind]: state.backlog[need.kind].filter((item) => item.id !== need.id) };
      if (requestProject !== projectId()) { state.askSending = false; signatures.delete("ask"); return; }
      const message = window.MefiAutonomy?.outcome?.(result, success) || result.dispatch?.message || success;
      if (needKey(state.need) === requestKey) moveOn(need, message, place);
      else { state.askSending = false; feedback(message, result.dispatch?.held || result.dispatch?.paused ? "warn" : "good"); }
      void refresh();
    } catch (error) {
      state.askSending = false;
      if (requestProject !== projectId()) return;
      state.askErrors[requestKey] = error.gone ? error.message : `${error?.message || "That didn't go through."} You can also open it on the task board.`;
      if (needKey(state.need) === requestKey) { note.textContent = state.askErrors[requestKey]; note.dataset.tone = error.gone ? "" : "bad"; }
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
    const answeringProject = projectId();
    if (!api()?.assistantAnswer) { const note = $("ask-note"); note.textContent = "Answers are available in the desktop app."; note.dataset.tone = "warn"; return; }
    await act(need, async () => {
      const result = await api().assistantAnswer({ id: question.id, optionId, text });
      if (result?.ok !== false) askDrafts.delete(question.id);
      if (answeringProject === projectId() && result?.ok !== false && !(result?.state && belongs(result.state))) state.assistant = { ...state.assistant, questions: (state.assistant.questions || []).map((item) => item.id === question.id ? { ...item, status: "answered" } : item) };
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
    window.MefiVibePanels?.close?.({ quiet: true });
    paintRail();
    if (!window.MefiWorkspace?.isActive?.()) window.MefiIdle?.setHomeBackdrop?.(false);
  }
  // Where Studio lands when it opens on its home.
  function landing() { return mode() === "vibe" ? "vibe" : "workspace"; }

  function init() {
    if (initialized) return;
    initialized = true;
    renderSparks();
    window.MefiAutonomy?.mount($("autonomy-control"), { id: "vibe-autonomy" });
    // The Git sync chip sits right after New app in the project cluster (renderer/git-sync.js).
    window.MefiGitSync?.mount?.($("new-app")?.parentNode, { after: $("new-app"), variant: "vibe" });
    window.addEventListener("mefi:autonomy-changed", () => { signatures.delete("ask"); renderAsk(); renderHead(); renderLanes(); });
    $("compose").addEventListener("submit", (event) => { event.preventDefault(); void send("build"); });
    window.MefiFileInputs?.bind($("input"), { scope: () => `${draftEpoch}:${projectId()}`, blocked: () => state.pending || !projectId() });
    $("talk").addEventListener("click", () => void send("talk"));
    $("decisions")?.addEventListener("click", () => openPanel("decisions"));
    $("input").addEventListener("input", () => { if (!$("input").value.trim()) evolution.context = null; grow(); saveDraft(); renderEvolution(); if ($("feedback").textContent && !state.pending) feedback(""); });
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
    // The pill opens what it names: what needs you, what holds the agents, or the work.
    $("pulse").addEventListener("click", () => {
      const waiting = needs();
      const gate = runState();
      if (waiting.length) openNeed(waiting[0]);
      else if (gate && ["held", "key", "paused"].includes(gate.key)) openPanel("team");
      else openPanel("tasks");
    });
    // Every [data-vibe-panel] control (dock stops, the settings button, card
    // links) opens its panel; a dock stop whose panel is open closes it.
    layer.addEventListener("click", (event) => {
      const trigger = event.target?.closest?.("[data-vibe-panel]");
      if (!trigger || !layer.contains(trigger)) return;
      event.preventDefault();
      const kind = trigger.dataset.vibePanel;
      if (trigger.dataset.vibeStop && window.MefiVibePanels?.current?.() === kind) { window.MefiVibePanels.close(); return; }
      openPanel(kind, trigger.dataset.vibeFold ? { fold: trigger.dataset.vibeFold } : {});
    });
    // Unread ideas change with the ideas page and the scanners; the card and
    // the dock follow them.
    api()?.onIdeas?.((ideas) => { if (!Array.isArray(ideas)) return; state.ideas = ideas; if (active()) renderLanes(); });
    layer.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (window.MefiVibePanels?.isOpen?.()) { event.preventDefault(); event.stopPropagation(); window.MefiVibePanels.escape(); return; }
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
    const stops = dockStops(data);
    const cards = { needs: data.needs.length > 0, plan: data.families.length > 0, building: data.running.length + data.checking.length + data.next.length > 0, done: data.finished.length > 0, ideas: data.ideas.length > 0 };
    return { mode: mode(), active: active(), gate: data.gate?.key ?? null, needs: data.needs.map(({ kind, id, title }) => ({ kind, id, title })), building: data.running.length, checking: data.checking.map((task) => task.id),
      open: state.need ? { ...state.need } : null, cards: Object.keys(cards).filter((key) => cards[key]), dock: STOPS.filter((key) => stops[key]), panel: window.MefiVibePanels?.current?.() ?? null };
  }
  // A decision raised anywhere (a toast, the companion) opens in Vibe's own
  // drawer: the question by id, or any need by kind and id.
  function openNeedById(ref = {}) {
    const wanted = typeof ref === "string" ? { kind: "question", id: ref } : ref;
    if (wanted.projectId && wanted.projectId !== projectId()) { feedback("Open this project before answering its request.", "warn"); return false; }
    if (!active()) go("vibe");
    const need = needs().find((item) => item.kind === (wanted.kind || "question") && item.id === wanted.id);
    if (need) { openNeed(need); return true; }
    // Not known here yet (the push is still on its way): read, then look again.
    void refresh().then(() => { const late = needs().find((item) => item.kind === (wanted.kind || "question") && item.id === wanted.id); if (late) openNeed(late); });
    return false;
  }
  window.MefiVibe = { enter, exit, isActive: active, refresh, mode, setMode, landing, startup, showNotes, closeNotes, snapshot, openPanel, closeDrawers, composeEvolution, suggestEvolution, openNeed: openNeedById, paintDock: () => renderDock(lanes()), promoteIdea: (idea) => promoteIdea(idea), feedback: (text, tone) => feedback(text, tone), ready: () => refreshFlight ?? Promise.resolve() };
})();
