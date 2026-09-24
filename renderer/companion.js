// Mefi's Studio AI+ — the companion, free to roam. It used to sit on a fixed
// Listen · Make · Review track above the workspace conversation; now it is a
// character that lives above every view. It walks to whatever it is talking
// about, comments when something changes, offers the next useful step, takes
// typed requests ("pause", "open the task board", "make a task to …", or
// anything else for the assistant), and handles the agents' routine requests
// by itself.
//
// The workspace owns the project state. This module reads its snapshot (the
// "mefi:companion-state" event and MefiWorkspace.companion.snapshot()) and acts
// through MefiWorkspace.companion, the same calls the workspace's own buttons
// make, so a pause here is the Service tile's pause. The rules at the top are
// pure and exported as MefiCompanion.rules for tests/companion.test.mjs.
//
// Handling requests is bounded on purpose. It answers an agent's question only
// with the card's own recommended choice, and only when that choice re-arms or
// narrows the same task (Try again, Try again with a heavier model, Keep to the
// brief) or accepts the assistant's suggested next task. It never grants
// access, accepts a risky change, picks which duplicate to keep, approves a
// Verify-first build or does anything while new work is on hold, and it
// answers for one task at most once a day so a failing loop comes back to you.
//
// Motion: it roams only with Motion on Full and "Let your companion move" on.
// Calm, Off, that switch and the system's reduce-motion keep it where it is;
// it still talks, and you can still drag it.
(function () {
  "use strict";

  // ---- rules (pure) ---------------------------------------------------------

  // The two kinds scripts/agent-issues.cjs marks `ask: "always"`.
  const ALWAYS_YOURS = new Set(["permission", "risk"]);
  // Answers that only re-arm or narrow the task they are about.
  const SAFE_VERBS = new Set(["retry", "retry-deep", "narrow"]);
  const TASK_ANSWER_MS = 24 * 60 * 60 * 1000;
  const REQUEST_SETTLE_MS = 2 * 60 * 1000; // the host promotes the inbox on its own ticks first
  const BACKLOG_RUN_GAP_MS = 15 * 60 * 1000;

  const clip = (value, limit) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
  };
  const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

  // New work may start: not the launch hold, not a pause, not a project switch.
  function canAct(snap) {
    return Boolean(snap?.desktop && snap.projectId && !snap.switching && !snap.run?.held && !snap.run?.launchHold);
  }

  // What the companion would answer for you, or why it leaves the card to you.
  function autoAnswer(question, { answered = {}, now = Date.now() } = {}) {
    if (!question || question.status !== "open") return { skip: "It is no longer waiting." };
    const kind = question.context?.issueKind || null;
    if (kind && ALWAYS_YOURS.has(kind)) return { skip: "Only you can grant access or accept a risky change." };
    if (question.source === "family") return { skip: "Which duplicate to keep is your call." };
    const options = Array.isArray(question.options) ? question.options : [];
    const option = options.find((entry) => entry?.recommended === true);
    if (!option) return { skip: "It has no recommended answer." };
    if (option.dismiss || option.text) return { skip: "The recommended answer needs your words." };
    if (option.action) {
      const verb = option.action.kind === "issue" ? String(option.action.action || "") : "";
      if (!SAFE_VERBS.has(verb)) return { skip: "That answer changes more than the task's next attempt." };
      const taskId = question.context?.taskId || option.action.payload?.taskId || null;
      if (taskId && now - (Number(answered[taskId]) || 0) < TASK_ANSWER_MS) return { skip: "I already answered for this task today, so this one is yours." };
      return { optionId: option.id, label: option.label, taskId };
    }
    if (question.source === "offer" && option.reply) return { optionId: option.id, label: option.label, taskId: null };
    return { skip: "It isn't a routine question." };
  }

  // Inbox requests nobody has picked up yet (main.cjs promoteRequestsToTasks).
  function waitingRequests(requests) {
    return (Array.isArray(requests) ? requests : []).filter((request) => request?.title && !request.runId && !request.absorbedInto
      && (!request.status || ["open", "pending", "queued"].includes(request.status)));
  }

  // Work through the backlog for waiting requests: once they have sat through
  // a few host ticks, nothing is running, the backlog is not already being
  // worked, and not again for a while. Asking for it skips the waits.
  function shouldWorkRequests(snap, { waiting = 0, waitingSince = 0, lastRun = 0, now = Date.now(), explicit = false } = {}) {
    if (!waiting || !canAct(snap) || !snap.backlog) return false;
    if (snap.backlog.draining && !snap.backlog.paused) return false;
    if (explicit) return true;
    if (snap.running?.length) return false;
    return waitingSince > 0 && now - waitingSince >= REQUEST_SETTLE_MS && now - lastRun >= BACKLOG_RUN_GAP_MS;
  }

  // What changed between two snapshots, as things worth saying. Priority 3
  // needs you, 2 is worth knowing, 1 is company.
  // `handles(question)` says which cards the companion is about to settle;
  // those are announced when they are settled, not as questions for you.
  function notices(prev, next, { handles = () => false } = {}) {
    const out = [];
    if (!next?.projectId) return out;
    const yours = (next.questions || []).filter((question) => !handles(question));
    const questionNotice = (question, count) => ({
      id: `ask:${question.id}`, priority: 3, anchor: "#workspace-dash-attention",
      text: count > 1 ? `The agents have ${plural(count, "question")} only you can answer. The newest: ${clip(question.title, 110)}` : `An agent needs your answer: ${clip(question.title, 130)}`,
      actions: [{ label: "Answer", do: "open-ask" }],
    });
    if (!prev || prev.projectId !== next.projectId) {
      if (next.run?.launchHold) out.push({ id: "launch-hold", priority: 3, anchor: "#workspace-pause", text: `Agents are waiting for you${next.person ? `, ${next.person}` : ""}. Say start when you're ready, or tell me what to do first.`, actions: [{ label: "Start agents", do: "start" }] });
      else if (yours.length) out.push(questionNotice(yours.at(-1), yours.length));
      else if (next.review?.approvals) out.push({ id: "approvals", priority: 2, anchor: "#workspace-dash-attention", text: `${plural(next.review.approvals, "build is", "builds are")} waiting for your approval.`, actions: [{ label: "Review", do: "open-review" }] });
      if (next.keyMissing) out.push({ id: "key", priority: 2, text: "I can't reach an AI yet. Connect one in Settings and I can answer properly.", actions: [{ label: "Open Settings", do: "open-providers" }] });
      return out;
    }
    const known = new Set((prev.questions || []).map((question) => question.id));
    const fresh = yours.filter((question) => !known.has(question.id));
    if (fresh.length) out.push(questionNotice(fresh.at(-1), yours.length));
    const before = prev.review || {}, after = next.review || {};
    if ((after.approvals || 0) > (before.approvals || 0)) out.push({ id: "approval", priority: 3, anchor: "#workspace-dash-attention", text: `A build is waiting for your approval${after.first ? `: “${clip(after.first, 90)}”` : ""}. Verify first means I leave that one to you.`, actions: [{ label: "Review", do: "open-review" }] });
    else if ((after.blocked || 0) > (before.blocked || 0)) out.push({ id: "blocked", priority: 3, anchor: "#workspace-dash-attention", text: "A task is blocked on something only you can clear.", actions: [{ label: "Review", do: "open-review" }] });
    else if ((after.checks || 0) > (before.checks || 0)) out.push({ id: "finished", priority: 2, anchor: "#workspace-dash-attention", text: "Something finished and is ready for a look.", actions: [{ label: "Review", do: "open-review" }] });
    const was = new Set((prev.running || []).map((job) => job.taskId || job.title));
    const started = (next.running || []).filter((job) => !was.has(job.taskId || job.title));
    if (started.length) out.push({ id: `start:${started[0].taskId || started[0].title}`, priority: 1, anchor: "#workspace-dash-workers", text: started.length > 1 ? `${plural(started.length, "worker")} just started, beginning with “${clip(started[0].title, 80)}”.` : `I've started on “${clip(started[0].title, 100)}”.` });
    else if (prev.running?.length && !next.running?.length) out.push({ id: "idle", priority: 1, anchor: "#workspace-dash-workers", text: after.total ? "Everything running has finished. Some of it is waiting in Review." : "Everything running has finished." , ...(after.total ? { actions: [{ label: "Review", do: "open-review" }] } : {}) });
    if (!prev.run?.held && next.run?.held) out.push({ id: "held", priority: 2, anchor: "#workspace-pause", text: "New work is on hold. Running jobs finish normally.", actions: [{ label: "Resume", do: "resume" }] });
    else if ((prev.run?.held || prev.run?.launchHold) && !next.run?.held && !next.run?.launchHold) out.push({ id: "resumed", priority: 1, text: "We're back on. New work can start." });
    if (!prev.keyMissing && next.keyMissing) out.push({ id: "key", priority: 2, text: "I've lost my AI connection. Check it in Settings.", actions: [{ label: "Open Settings", do: "open-providers" }] });
    if (next.reply?.text && next.reply.id !== prev.reply?.id && (next.reply.at || 0) >= (prev.reply?.at || 0)) out.push({ id: `reply:${next.reply.id || next.reply.at}`, priority: 2, kind: "reply", text: `“${clip(next.reply.text, 170)}”`, actions: [{ label: "Open conversation", do: "open-thread" }] });
    return out;
  }

  // One line on arrival at a view, said once a session and only when chatty.
  function viewLine(id, snap) {
    const questions = snap?.questions?.length || 0, review = snap?.review?.total || 0;
    switch (id) {
      case "command": return questions ? { text: `Every agent is a node here. ${plural(questions, "question waits", "questions wait")} under Ask.`, actions: [{ label: "Open Ask", do: "open-ask" }] } : { text: "Every session, task and agent is a node here. Ask me where something is." };
      case "tasks": return { text: review ? `This is the task board. ${plural(review, "task waits", "tasks wait")} for review.` : "This is the task board. Tell me a task and I'll put it here." };
      case "plans": return { text: "Plans turn a fuzzy idea into tasks. Describe the outcome and I'll ask what matters." };
      case "ideas": return { text: "Ideas stay notes until you, or Work through backlog, promote them." };
      case "studio": return snap?.keyMissing ? { text: "Connect an AI under Providers and I can answer properly.", actions: [{ label: "Providers", do: "open-providers" }] } : { text: "Looking for something? Type in Find a setting, or just ask me." };
      case "booklet": return { text: "Every model with its prices and limits. Ask me which one fits a job." };
      case "graph": return { text: "Measured speed, errors and cost for this project's models." };
      case "eyes": return { text: "What the workers changed: diffs, screenshots and the log." };
      case "explorer": return { text: "Pick a session to see its steps and what it touched." };
      case "brains": return { text: "The pipeline as nodes you can rewire. Save, then activate a map." };
      case "analyzer": return { text: "Hand me a file or an idea and I'll analyse it locally." };
      case "overhead": return { text: "Which session built which task, side by side." };
      case "music": return { text: "Pick a theme and I'll wear it too." };
      default: return null;
    }
  }

  // A typed request, read the way a person means it. Anything unrecognised is
  // for the assistant, which answers in the project's conversation.
  const NAV_WORDS = {
    home: "workspace", workspace: "workspace", conversation: "workspace", chat: "workspace",
    command: "command", "command view": "command", tree: "command", "node tree": "command", agents: "command",
    tasks: "tasks", "task board": "tasks", board: "tasks", plans: "plans", ideas: "ideas", settings: "studio",
    models: "booklet", "model catalog": "booklet", catalog: "booklet", "model lab": "graph", activity: "eyes",
    explorer: "explorer", "brain maps": "brains", brains: "brains", analyzer: "analyzer", overhead: "overhead",
    style: "music", music: "music", "style and sound": "music", search: "search", shortcuts: "help", help: "help",
  };
  function intent(value, { destinations = [] } = {}) {
    const raw = String(value ?? "").trim();
    const text = raw.toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ").replace(/^(?:(?:hey|ok|okay) )?(?:(?:mefi|buddy)\b,? ?)?(?:please |can you |could you )?/, "").replace(/ please$/, "").trim();
    if (!text) return { kind: "none" };
    if (/^(pause|hold)( new work| (all )?work| everything| the agents)?$/.test(text)) return { kind: "control", action: "pause" };
    if (/^(resume|unpause|continue|start|start agents|start (the )?work|start again|go|let'?s go|carry on)$/.test(text)) return { kind: "control", action: "resume" };
    if (/^(stop|stop all|halt|stop (all|every|the)( the)? agents|stop everything)$/.test(text)) return { kind: "control", action: "stop-all" };
    if (/^((handle|answer|do|clear|work( through)?|go through|take care of) (the |my |those |these |them|it|all )*(requests?|questions?|queue|backlog|them|it)|work (through )?(the )?backlog|handle it|handle them|auto( ?handle)?)$/.test(text)) return { kind: "handle" };
    if (/^(status|what('?s| is) (waiting|next|up|going on)|what needs me|anything (for me|waiting)|how('?s| is) it going)$/.test(text)) return { kind: "status" };
    if (/^(hide|go away|hide yourself|dismiss|bye)$/.test(text)) return { kind: "companion", action: "hidden" };
    if (/^(stay|stay (here|there|put)|sit|don'?t move)$/.test(text)) return { kind: "companion", action: "stay" };
    if (/^(roam|wander|move around|explore|walk around|follow me|come with me)$/.test(text)) return { kind: "companion", action: "roam" };
    if (/^(quiet|shh+|hush|be quiet|less chatty|quiet mode)$/.test(text)) return { kind: "companion", action: "quiet" };
    if (/^(chatty|talk more|talk to me|you can talk)$/.test(text)) return { kind: "companion", action: "chatty" };
    const task = /^(?:(?:make|add|create|new|file|put)(?: me)? (?:a |an |another )?task(?: to| for| that|:)?|task:|todo:)\s*(.+)$/i.exec(raw.replace(/^(please |can you |could you )/i, ""));
    if (task && task[1].trim().length >= 3) return { kind: "task", text: task[1].trim() };
    const nav = /^(?:open|show me|show|go to|take me to|bring up|jump to)(?: the| my)? (.+?)(?: page| view| tab| panel)?$/.exec(text);
    if (nav) {
      const target = nav[1].trim();
      if (["review", "reviews", "things to review"].includes(target)) return { kind: "action", do: "open-review" };
      if (["questions", "ask", "asks", "requests"].includes(target)) return { kind: "action", do: "open-ask" };
      if (["providers", "ai settings", "connections"].includes(target)) return { kind: "action", do: "open-providers" };
      const id = NAV_WORDS[target] ?? destinations.find((dest) => [dest.label, dest.short].some((name) => String(name ?? "").toLowerCase() === target))?.id;
      if (id) return { kind: "nav", id };
    }
    return { kind: "chat", text: raw };
  }

  // Where a companion of `size` stands to point at `rect`: perched on its top
  // right corner, mostly outside it so it covers padding rather than words;
  // on the bottom corner when there is no room above. Then clamped.
  function clampSpot(spot, viewport, size, inset = {}) {
    const left = inset.left ?? 10, top = inset.top ?? 10, right = inset.right ?? 10, bottom = inset.bottom ?? 10;
    const maxX = Math.max(left, viewport.width - size - right), maxY = Math.max(top, viewport.height - size - bottom);
    return { x: Math.round(Math.min(maxX, Math.max(left, Number(spot?.x) || 0))), y: Math.round(Math.min(maxY, Math.max(top, Number(spot?.y) || 0))) };
  }
  function besideRect(rect, viewport, size, inset = {}) {
    const x = Math.min(rect.right - size * 0.7, viewport.width - size - (inset.right ?? 10));
    const above = rect.top - size * 0.62;
    const y = above >= (inset.top ?? 10) ? above : rect.bottom - size * 0.38;
    return clampSpot({ x, y }, viewport, size, inset);
  }

  const rules = { canAct, autoAnswer, waitingRequests, shouldWorkRequests, notices, viewLine, intent, clampSpot, besideRect, ALWAYS_YOURS, SAFE_VERBS };

  // ---- the character --------------------------------------------------------

  const SIZE = 52;
  const api = () => window.mefiStudio;
  const workspace = () => window.MefiWorkspace?.companion ?? null;
  const store = {
    get(key, fallback = "") { try { return localStorage.getItem(`mefiStudio.companion.${key}`) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(`mefiStudio.companion.${key}`, value); } catch { /* private store */ } },
    json(key, fallback) { try { return JSON.parse(this.get(key, "")) ?? fallback; } catch { return fallback; } },
  };
  const readMode = () => (["roam", "stay", "hidden"].includes(store.get("mode", "roam")) ? store.get("mode", "roam") : "roam");
  const state = {
    ready: false, mode: readMode(), quiet: store.get("chatter", "chatty") === "quiet", auto: store.get("auto", "on") !== "off",
    snap: null, requests: [], requestsSince: 0, view: null, seenViews: new Set(),
    pos: { x: -200, y: -200 }, home: true, panel: false, hover: false, drag: null, suppressClick: false,
    bubble: null, queue: [], lastSpoke: 0, talk: [], tried: new Set(), lastBacklogRun: 0, autoFlight: null,
    timers: { wander: 0, bubble: 0, walk: 0, auto: 0, next: 0 },
  };
  const els = {};

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  const name = () => state.snap?.name || window.MefiWorkspace?.companion?.snapshot?.()?.name || "Mefi";
  const snapshot = () => state.snap ?? workspace()?.snapshot?.() ?? null;
  const viewport = () => ({ width: window.innerWidth || 1280, height: window.innerHeight || 800 });
  // The rail's column on the left is navigation, not somewhere to stand.
  const inset = () => ({ left: document.documentElement?.dataset?.shell === "rail" ? 70 : 12, top: 12, right: 14, bottom: 14 });

  // Motion: Full motion and the companion's own switch let it walk; anything
  // else keeps it where it is (html[data-motion] is nav.js's one switch).
  function motionAllowed() {
    const level = document.documentElement?.dataset?.motion;
    let own = "1";
    try { own = localStorage.getItem("mefiStudio.workspace.motion") ?? "1"; } catch {}
    return level !== "off" && level !== "calm" && own !== "0";
  }
  const canRoam = () => state.mode === "roam" && motionAllowed();

  function build() {
    const root = node("div", "companion");
    root.id = "companion";
    root.hidden = true;
    root.dataset.mood = "idle";
    root.dataset.facing = "right";
    const body = node("button", "companion-body");
    body.type = "button";
    body.setAttribute("aria-haspopup", "dialog");
    body.setAttribute("aria-expanded", "false");
    const orbit = node("span", "companion-orbit"), face = node("span", "companion-face"), spark = node("span", "companion-spark", "✦");
    face.append(node("i"), node("i"));
    const count = node("span", "companion-count");
    count.hidden = true;
    body.append(orbit, face, spark, count);

    const bubble = node("div", "companion-bubble");
    bubble.hidden = true;
    const say = node("p", "companion-say");
    say.setAttribute("role", "status");
    say.setAttribute("aria-live", "polite");
    const bubbleActions = node("div", "companion-bubble-actions");
    const hush = node("button", "companion-hush", "×");
    hush.type = "button";
    hush.setAttribute("aria-label", "Dismiss");
    bubble.append(say, bubbleActions, hush);

    const panel = node("section", "companion-panel");
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    const head = node("header", "companion-panel-head");
    const title = node("strong", "companion-title");
    const status = node("span", "companion-status");
    const close = node("button", "companion-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    head.append(title, status, close);
    const now = node("p", "companion-now");
    const actions = node("div", "companion-actions");
    const talk = node("ol", "companion-talk");
    talk.setAttribute("aria-live", "polite");
    const form = node("form", "companion-form");
    const input = node("textarea", "companion-input");
    input.rows = 2;
    input.maxLength = 2000;
    input.setAttribute("aria-label", "Talk to your companion");
    const send = node("button", "primary mini", "Send");
    send.type = "submit";
    form.append(input, send);
    const prefs = node("footer", "companion-prefs");
    const autoLabel = node("label", "switch companion-auto");
    const autoBox = node("input");
    autoBox.type = "checkbox";
    autoLabel.title = "Answer the agents' routine questions with their recommended choice and work queued requests. Never grants access, accepts a risky change, approves a build or overrides a pause.";
    autoLabel.append(autoBox, node("span", "track"), node("span", "", "Handle requests for me"));
    const roam = node("button", "ghost mini companion-roam");
    const quiet = node("button", "ghost mini companion-quiet");
    const hide = node("button", "ghost mini companion-hide", "Hide");
    for (const button of [roam, quiet, hide]) button.type = "button";
    prefs.append(autoLabel, roam, quiet, hide);
    panel.append(head, now, actions, talk, form, prefs);

    root.append(bubble, panel, body);
    document.body.append(root);
    Object.assign(els, { root, body, count, bubble, say, bubbleActions, hush, panel, title, status, close, now, actions, talk, form, input, send, autoBox, roam, quiet, hide });

    body.addEventListener("click", () => {
      if (state.suppressClick) { state.suppressClick = false; return; }
      togglePanel();
    });
    body.addEventListener("keydown", nudgeWithKeys);
    body.addEventListener("pointerdown", startDrag);
    body.addEventListener("pointermove", moveDrag);
    body.addEventListener("pointerup", endDrag);
    body.addEventListener("pointercancel", endDrag);
    root.addEventListener("pointerenter", () => { state.hover = true; });
    root.addEventListener("pointerleave", () => { state.hover = false; });
    hush.addEventListener("click", () => hideBubble(true));
    close.addEventListener("click", () => closePanel(true));
    panel.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation?.(); event.preventDefault?.(); closePanel(true); } });
    form.addEventListener("submit", (event) => { event?.preventDefault?.(); void handleText(input.value); });
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault?.(); void handleText(input.value); } });
    autoBox.addEventListener("change", () => setAuto(autoBox.checked));
    roam.addEventListener("click", () => setMode(state.mode === "roam" ? "stay" : "roam", { announce: true }));
    quiet.addEventListener("click", () => setQuiet(!state.quiet, { announce: true }));
    hide.addEventListener("click", () => setMode("hidden"));
  }

  // ---- where it stands ------------------------------------------------------

  function place(spot, { instant = false } = {}) {
    const next = clampSpot(spot, viewport(), SIZE, inset());
    const distance = Math.hypot(next.x - state.pos.x, next.y - state.pos.y);
    if (distance < 1) return;
    const walk = !instant && motionAllowed() && state.ready && state.pos.x > -100;
    const duration = walk ? Math.round(Math.min(2600, Math.max(420, distance / 0.34))) : 0;
    if (Math.abs(next.x - state.pos.x) > 4) els.root.dataset.facing = next.x < state.pos.x ? "left" : "right";
    els.root.style.transitionDuration = `${duration}ms`;
    els.root.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
    state.pos = next;
    fitPopovers();
    clearTimeout(state.timers.walk);
    els.root.classList.toggle("walking", duration > 0);
    if (duration) state.timers.walk = setTimeout(() => els.root.classList.remove("walking"), duration);
  }

  // The bubble and the panel open toward the room there is and never past the
  // window's edges: above or below by height, and slid sideways to fit.
  function fitPopovers() {
    const view = viewport(), { x, y } = state.pos;
    const slide = (element, width) => {
      const start = x + SIZE / 2 > view.width / 2 ? x + SIZE - width : x;
      const left = Math.min(Math.max(12, start), Math.max(12, view.width - 12 - width));
      element.style.left = `${Math.round(left - x)}px`;
    };
    els.root.dataset.side = y < 190 ? "below" : "above";
    slide(els.bubble, Math.min(290, view.width - 24));
    if (!state.panel) return;
    const roomAbove = y - 20, roomBelow = view.height - (y + SIZE) - 20;
    const above = roomAbove > roomBelow;
    const room = above ? roomAbove : roomBelow;
    els.panel.dataset.side = above ? "above" : "below";
    els.panel.style.maxHeight = `${Math.round(Math.max(200, Math.min(540, room)))}px`;
    slide(els.panel, Math.min(350, view.width - 24));
  }
  function perch() {
    const spot = document.getElementById("workspace-companion-perch");
    const rect = spot && window.MefiWorkspace?.isActive?.() ? spot.getBoundingClientRect?.() : null;
    return rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < viewport().height ? rect : null;
  }
  function homeSpot() {
    if (state.mode === "stay") {
      const saved = store.json("spot", null);
      if (saved && Number.isFinite(saved.fx) && Number.isFinite(saved.fy)) return { x: saved.fx * (viewport().width - SIZE), y: saved.fy * (viewport().height - SIZE) };
    }
    const rest = perch();
    if (rest) return { x: rest.left + rest.width / 2 - SIZE / 2, y: rest.top + rest.height / 2 - SIZE / 2 };
    // The bottom right corner, stepping left of Command's rail when it is up.
    let x = viewport().width - SIZE - 30;
    const rail = window.MefiIdle?.isActive?.() ? document.getElementById("cmd-rail")?.getBoundingClientRect?.() : null;
    if (rail && rail.width > 0 && rail.left < x + SIZE) x = rail.left - SIZE - 18;
    return { x, y: viewport().height - SIZE - 30 };
  }
  function goHome({ instant = false } = {}) {
    state.home = true;
    place(homeSpot(), { instant });
    paintPerch();
  }
  function paintPerch() {
    const spot = document.getElementById("workspace-companion-perch");
    if (!spot) return;
    const rest = perch();
    const on = Boolean(rest && Math.abs(state.pos.x - (rest.left + rest.width / 2 - SIZE / 2)) < 6 && Math.abs(state.pos.y - (rest.top + rest.height / 2 - SIZE / 2)) < 6);
    spot.dataset.occupied = String(on && !els.root.hidden);
  }
  // Walk over to what it is about to talk about, when that is on screen.
  function goTo(selector) {
    if (!canRoam() || !selector) return false;
    const target = document.querySelector(selector);
    if (!target || target.closest?.("[hidden], [inert]")) return false;
    const rect = target.getBoundingClientRect?.();
    const view = viewport();
    if (!rect || rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > view.height || rect.right < 0 || rect.left > view.width) return false;
    state.home = false;
    place(besideRect(rect, view, SIZE, inset()));
    paintPerch();
    return true;
  }
  // Idle wandering: along the bottom and right edges, never across your work.
  function scheduleWander() {
    clearTimeout(state.timers.wander);
    state.timers.wander = setTimeout(wander, 16000 + Math.random() * 18000);
  }
  function wander() {
    scheduleWander();
    if (!canRoam() || document.hidden || state.panel || state.drag || state.hover || !els.bubble.hidden || els.root.hidden) return;
    const view = viewport();
    if (Math.random() < 0.35) { goHome(); return; }
    const rail = window.MefiIdle?.isActive?.() ? document.getElementById("cmd-rail")?.getBoundingClientRect?.() : null;
    if (rail && rail.width > 0) view.width = rail.left - 8;
    const alongBottom = Math.random() < 0.6;
    const spot = alongBottom
      ? { x: inset().left + Math.random() * (view.width - SIZE - inset().left - 20), y: view.height - SIZE - 18 - Math.random() * 40 }
      : { x: view.width - SIZE - 18 - Math.random() * 40, y: 90 + Math.random() * (view.height - SIZE - 120) };
    state.home = false;
    place(spot);
    paintPerch();
  }

  // Drag it anywhere; letting go there means "stay here".
  function startDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    state.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, from: { ...state.pos }, moved: false };
    try { els.body.setPointerCapture?.(event.pointerId); } catch {}
  }
  function moveDrag(event) {
    const drag = state.drag;
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    els.root.classList.add("dragging");
    place({ x: drag.from.x + dx, y: drag.from.y + dy }, { instant: true });
  }
  function endDrag(event) {
    const drag = state.drag;
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
    state.drag = null;
    els.root.classList.remove("dragging");
    if (!drag.moved) return;
    state.suppressClick = true;
    rememberSpot();
    const wasRoaming = state.mode === "roam";
    setMode("stay");
    if (wasRoaming && store.get("dragged", "") !== "1") {
      store.set("dragged", "1");
      say({ id: "dragged", priority: 2, text: "I'll stay right here. Click me and choose Roam when you want me to wander again." });
    }
  }
  function rememberSpot() {
    const view = viewport();
    store.set("spot", JSON.stringify({ fx: state.pos.x / Math.max(1, view.width - SIZE), fy: state.pos.y / Math.max(1, view.height - SIZE) }));
    paintPerch();
  }
  function nudgeWithKeys(event) {
    const step = event.shiftKey ? 64 : 24;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    place({ x: state.pos.x + move[0], y: state.pos.y + move[1] }, { instant: true });
    rememberSpot();
    if (state.mode !== "stay") setMode("stay");
  }

  // ---- what it says ---------------------------------------------------------

  function say(notice) {
    if (!notice?.text || !state.ready || els.root.hidden) return;
    const priority = notice.priority || 1;
    if (state.quiet && priority < 3 && notice.kind !== "auto") return;
    // Replies are for the view you are not on: the thread already shows them,
    // and a reply to something typed here is already in the panel.
    if (notice.kind === "reply" && (window.MefiWorkspace?.isActive?.() || state.panel || els.form.dataset.busy === "true")) return;
    if (state.panel) { if (priority >= 2) addLine("me", notice.text); return; }
    if (state.bubble?.id === notice.id || state.queue.some((queued) => queued.id === notice.id)) return;
    const busy = !els.bubble.hidden;
    const soon = Date.now() - state.lastSpoke < (priority >= 3 ? 2500 : 7000);
    // Anything already waiting goes first when it matters more.
    const outranked = state.queue.some((queued) => (queued.priority || 1) >= priority);
    if (busy || soon || outranked) {
      if (busy && priority > (state.bubble?.priority || 1) && priority >= 3) { hideBubble(false); show(notice); return; }
      state.queue.push(notice);
      state.queue.sort((a, b) => (b.priority || 1) - (a.priority || 1));
      state.queue.splice(4);
      if (!busy) scheduleNext(soon ? (priority >= 3 ? 2500 : 7000) - (Date.now() - state.lastSpoke) : 800);
      return;
    }
    show(notice);
  }
  function show(notice) {
    // The palette, help and the walkthrough sit above the companion; what it
    // has to say waits for them instead of talking behind them.
    if (window.MefiNav?.state?.transient) {
      state.queue.unshift(notice);
      state.queue.splice(4);
      scheduleNext(4000);
      return;
    }
    state.bubble = notice;
    state.lastSpoke = Date.now();
    goTo(notice.anchor);
    els.say.textContent = notice.text;
    els.bubbleActions.replaceChildren();
    for (const action of (notice.actions || []).slice(0, 2)) {
      const button = node("button", "ghost mini", action.label);
      button.type = "button";
      button.addEventListener("click", () => { hideBubble(true); void perform(action.do); });
      els.bubbleActions.append(button);
    }
    els.bubbleActions.hidden = !els.bubbleActions.children.length;
    els.bubble.hidden = false;
    els.root.dataset.mood = notice.priority >= 3 ? "alert" : "talking";
    armBubbleTimer(notice.priority >= 3 ? 22000 : notice.actions?.length ? 12000 : 8000);
  }
  function armBubbleTimer(ms) {
    clearTimeout(state.timers.bubble);
    state.timers.bubble = setTimeout(() => {
      // Hovering or tabbing into the bubble holds it.
      if (state.hover || els.root.contains?.(document.activeElement) && document.activeElement !== els.body) { armBubbleTimer(3000); return; }
      hideBubble(false);
    }, ms);
  }
  function hideBubble(byYou) {
    clearTimeout(state.timers.bubble);
    if (els.bubble.hidden) return;
    els.bubble.hidden = true;
    state.bubble = null;
    els.root.dataset.mood = state.snap?.busy ? "busy" : "idle";
    if (byYou) state.queue = state.queue.filter((notice) => (notice.priority || 1) >= 3);
    if (!state.home && canRoam() && !state.panel) setTimeout(() => { if (els.bubble.hidden && !state.panel && !state.drag) goHome(); }, 2500);
    if (state.queue.length) scheduleNext(1500);
  }
  function scheduleNext(ms) {
    clearTimeout(state.timers.next);
    state.timers.next = setTimeout(() => {
      if (!els.bubble.hidden || state.panel) return;
      const next = state.queue.shift();
      if (next) show(next);
    }, Math.max(300, ms));
  }

  // ---- what it does ---------------------------------------------------------

  async function perform(action) {
    const nav = window.MefiNav;
    switch (action) {
      case "open-ask": nav?.go?.("command", { rail: "ask" }); return true;
      case "open-review": nav?.go?.("workspace"); workspace()?.showWork?.("review"); return true;
      case "open-thread": nav?.go?.("workspace"); return true;
      case "open-providers": nav?.go?.("studio", { section: "settings-assistant" }); return true;
      case "talk": openPanel(); return true;
      case "handle": {
        const summary = await handleNow({ explicit: true });
        if (state.panel) addLine("me", summary);
        else if (summary) say({ id: `handled:${Date.now()}`, priority: 2, kind: "auto", text: summary });
        return true;
      }
      case "start": case "resume": case "pause": case "stop-all": case "run-backlog": {
        const result = await control(action);
        if (!state.panel) say({ id: `done:${action}:${Date.now()}`, priority: 2, kind: "auto", text: result.ok ? result.message || "Done." : result.error || "That didn't work." });
        else addLine("me", result.ok ? result.message || "Done." : result.error || "That didn't work.");
        return result.ok;
      }
      default: return false;
    }
  }
  async function control(action) {
    const reach = workspace();
    if (!reach?.control) return { ok: false, error: "That needs the desktop app." };
    try { return (await reach.control(action)) ?? { ok: false, error: "That didn't work." }; }
    catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
  }

  function taskAnswers() {
    const saved = store.json("answered", {});
    const now = Date.now();
    return Object.fromEntries(Object.entries(saved && typeof saved === "object" ? saved : {}).filter(([, at]) => now - Number(at) < TASK_ANSWER_MS));
  }
  function rememberTaskAnswer(taskId) {
    const saved = taskAnswers();
    saved[taskId] = Date.now();
    store.set("answered", JSON.stringify(saved));
  }

  // The agents' requests, handled within the rules above. Automatic passes
  // answer one card at a time; asking for it answers every card it may.
  async function handleNow({ explicit = false } = {}) {
    if (state.autoFlight) return state.autoFlight;
    state.autoFlight = (async () => {
      // Nothing is settled behind the startup gate, before you can see it.
      if (!explicit && !state.ready) return "";
      const snap = snapshot();
      if (!snap?.desktop) return explicit ? "Handling requests needs the desktop app." : "";
      if (!canAct(snap)) {
        if (!explicit) return "";
        return snap.run?.launchHold ? "The agents are still waiting for Start. Say start and I'll take it from there." : snap.switching ? "A project is opening. Ask me again in a moment." : "New work is on hold, so I'm leaving requests alone until you resume.";
      }
      const done = [], left = [];
      const answer = api()?.assistantAnswer;
      for (const question of snap.questions || []) {
        if (state.tried.has(question.id)) continue;
        const pick = autoAnswer(question, { answered: taskAnswers(), now: Date.now() });
        if (!pick.optionId || !answer) { if (explicit) left.push(pick.skip || "Answers need the desktop app."); continue; }
        state.tried.add(question.id);
        let result = null;
        try { result = await answer({ id: question.id, optionId: pick.optionId }); } catch (error) { result = { ok: false, error: String(error?.message ?? error) }; }
        if (result?.ok === false) {
          say({ id: `failed:${question.id}`, priority: 3, text: `I couldn't settle ${clip(question.title, 90)}. ${clip(result.error || "The host refused the answer.", 120)} It's waiting for you under Ask.`, actions: [{ label: "Answer", do: "open-ask" }] });
          continue;
        }
        if (pick.taskId) rememberTaskAnswer(pick.taskId);
        // Titles quote their task already ("Fix save slots" stopped …).
        done.push(`chose ${pick.label} for ${clip(question.title, 90)}`);
        if (!explicit) break;
      }
      const waiting = waitingRequests(state.requests);
      if (shouldWorkRequests(snapshot() ?? snap, { waiting: waiting.length, waitingSince: state.requestsSince, lastRun: state.lastBacklogRun, now: Date.now(), explicit })) {
        state.lastBacklogRun = Date.now();
        const result = await control("run-backlog");
        if (result.ok) done.push(`started working through ${plural(waiting.length, "waiting request")}`);
        else if (explicit) left.push(result.error);
      }
      if (done.length) {
        const text = `I ${done.join(", then ")}.`;
        if (!explicit) say({ id: `auto:${Date.now()}`, priority: 2, kind: "auto", text, actions: [{ label: "Show me", do: snap.questions?.length ? "open-ask" : "open-thread" }] });
        return text;
      }
      if (!explicit) return "";
      const approvals = snap.review?.approvals || 0;
      const reasons = [...new Set(left)].slice(0, 2).join(" ");
      if (left.length) return `Nothing I can settle for you right now. ${reasons}${approvals ? ` ${plural(approvals, "build waits", "builds wait")} for your approval too.` : ""}`.trim();
      return approvals ? `No requests need me. ${plural(approvals, "build waits", "builds wait")} for your approval, which is yours to give.` : "Nothing is waiting. You're all caught up.";
    })();
    try { return await state.autoFlight; } finally { state.autoFlight = null; }
  }
  // Would the companion answer this card by itself right now? nav.js skips
  // the "Decision needed" toast for a card it is about to handle.
  function handles(question, snap = snapshot()) {
    return Boolean(state.auto && canAct(snap) && api()?.assistantAnswer && !state.tried.has(question?.id) && autoAnswer(question, { answered: taskAnswers() }).optionId);
  }
  function willHandle(question) { return state.ready && handles(question); }
  function scheduleAuto(ms = 2500) {
    if (!state.auto) return;
    clearTimeout(state.timers.auto);
    state.timers.auto = setTimeout(() => { void handleNow(); }, ms);
  }

  // ---- the panel: talk and manage -------------------------------------------

  function addLine(who, text) {
    if (!text) return null;
    state.talk.push({ who, text: String(text) });
    state.talk.splice(0, Math.max(0, state.talk.length - 8));
    paintTalk();
    return state.talk.at(-1);
  }
  function paintTalk() {
    els.talk.replaceChildren();
    const lines = state.talk.length ? state.talk : state.snap?.reply?.text ? [{ who: "me", text: clip(state.snap.reply.text, 400), last: true }] : [];
    for (const line of lines) {
      const row = node("li", `companion-line ${line.who === "you" ? "you" : "me"}`);
      row.append(node("b", "", line.who === "you" ? state.snap?.person || "You" : name()), node("span", "", line.last ? `Last said: ${line.text}` : line.text));
      els.talk.append(row);
    }
    els.talk.hidden = !lines.length;
    els.talk.scrollTop = els.talk.scrollHeight;
  }
  function paintPanel() {
    const snap = snapshot();
    els.title.textContent = name();
    els.status.textContent = snap?.run?.label || (api() ? "Getting ready" : "Browser preview");
    els.status.dataset.tone = snap?.run?.tone || "idle";
    els.now.textContent = snap?.narration || "Tell me what you have in mind.";
    els.actions.replaceChildren();
    for (const action of panelActions(snap)) {
      const button = node("button", action.primary ? "primary mini" : "ghost mini", action.label);
      button.type = "button";
      button.addEventListener("click", async () => { button.disabled = true; await perform(action.do); button.disabled = false; paintPanel(); });
      els.actions.append(button);
    }
    els.actions.hidden = !els.actions.children.length;
    els.input.placeholder = snap?.projectId ? `Ask me anything, or tell me what to do in ${snap.projectName || "this project"}…` : "Ask me anything, or say “open settings”…";
    els.autoBox.checked = state.auto;
    els.roam.textContent = state.mode === "roam" ? "Stay here" : "Roam";
    els.roam.title = state.mode === "roam" ? "Keep me in this spot" : motionAllowed() ? "Let me walk around Studio" : "I'll roam once Motion is Full and Let your companion move is on";
    els.quiet.textContent = state.quiet ? "Chatty" : "Quiet";
    els.quiet.title = state.quiet ? "Tell me about everything that changes" : "Only speak up when something needs you";
    els.panel.setAttribute("aria-label", `Talk to ${name()}`);
    paintTalk();
  }
  function panelActions(snap) {
    if (!snap?.desktop) return [];
    const out = [];
    if (snap.run?.launchHold) out.push({ label: "Start agents", do: "start", primary: true });
    else if (snap.run?.held) out.push({ label: "Resume", do: "resume", primary: true });
    const questions = snap.questions?.length || 0;
    if (questions) out.push({ label: `Answer ${plural(questions, "question")}`, do: "open-ask", primary: !snap.run?.held && !snap.run?.launchHold });
    const waiting = waitingRequests(state.requests).length;
    if ((questions || waiting) && canAct(snap)) out.push({ label: "Handle requests now", do: "handle" });
    if (snap.review?.total) out.push({ label: `Review ${snap.review.total}`, do: "open-review" });
    if (!questions && !waiting && canAct(snap) && snap.ready && !(snap.backlog?.draining && !snap.backlog?.paused)) out.push({ label: "Work through backlog", do: "run-backlog" });
    if (snap.running?.length) out.push({ label: "Stop all", do: "stop-all" });
    else if (!snap.run?.held && !snap.run?.launchHold) out.push({ label: "Pause new work", do: "pause" });
    return out.slice(0, 5);
  }
  function openPanel() {
    if (els.root.hidden) setMode(state.mode === "hidden" ? "roam" : state.mode);
    hideBubble(false);
    state.panel = true;
    paintPanel();
    els.panel.hidden = false;
    fitPopovers();
    els.body.setAttribute("aria-expanded", "true");
    els.root.classList.add("open");
    // Past the key that opened it, so that key is never typed into the box.
    setTimeout(() => els.input.focus?.(), 0);
  }
  function closePanel(returnFocus = false) {
    if (!state.panel) return;
    state.panel = false;
    els.panel.hidden = true;
    els.body.setAttribute("aria-expanded", "false");
    els.root.classList.remove("open");
    if (returnFocus) els.body.focus?.();
    if (state.queue.length) scheduleNext(1200);
  }
  function togglePanel() { if (state.panel) closePanel(true); else openPanel(); }

  async function handleText(value) {
    const text = String(value ?? "").trim();
    if (!text || els.form.dataset.busy === "true") return;
    els.form.dataset.busy = "true";
    els.send.disabled = true;
    addLine("you", text);
    els.input.value = "";
    const snap = snapshot();
    const plan = intent(text, { destinations: window.MefiNav?.list?.() ?? [] });
    try {
      if (plan.kind === "nav") {
        const dest = window.MefiNav?.get?.(plan.id);
        if (!dest) { addLine("me", "I can't find that page here."); return; }
        closePanel();
        window.MefiNav.go(plan.id);
        addLine("me", `Here's ${dest.label || plan.id}.`);
      } else if (plan.kind === "action") {
        closePanel();
        await perform(plan.do);
      } else if (plan.kind === "control") {
        const result = await control(plan.action === "resume" && snap?.run?.launchHold ? "start" : plan.action);
        addLine("me", result.ok ? result.message || "Done." : result.error || "That didn't work.");
      } else if (plan.kind === "handle") {
        addLine("me", await handleNow({ explicit: true }));
      } else if (plan.kind === "status") {
        addLine("me", statusLine(snap));
      } else if (plan.kind === "companion") {
        if (plan.action === "quiet" || plan.action === "chatty") setQuiet(plan.action === "quiet", { announce: false });
        else setMode(plan.action);
        addLine("me", { hidden: "Okay, I'll step away. Press J or open Search when you want me back.", stay: "I'll stay right here.", roam: motionAllowed() ? "Off I go. I'll keep an eye on things." : "I'll roam once Motion is Full and Let your companion move is on in Your Studio.", quiet: "I'll only speak up when something needs you.", chatty: "I'll tell you what changes as it happens." }[plan.action]);
      } else if (plan.kind === "task") {
        const result = await (workspace()?.createTask?.(plan.text) ?? { ok: false, error: "Adding tasks needs the desktop app." });
        addLine("me", result.ok ? result.message : result.error);
      } else {
        const thinking = addLine("me", "…");
        const result = await (workspace()?.ask?.(text) ?? { ok: false, error: "Talking needs the desktop app. I can still take you anywhere in Studio: try “open settings”." });
        if (thinking) thinking.text = result.ok ? (result.reply || "I've passed that on. The reply will land in the conversation.") : result.error;
        paintTalk();
      }
    } finally {
      els.form.dataset.busy = "false";
      els.send.disabled = false;
      if (state.panel) paintPanel();
    }
  }
  function statusLine(snap) {
    if (!snap?.projectId) return api() ? "No project is open yet. Open a folder from the workspace and I'll get to know it." : "Live status needs the desktop app.";
    const parts = [`${snap.projectName || "This project"}: ${snap.run?.label || "ready"}.`];
    if (snap.running?.length) parts.push(`Working on “${clip(snap.running[0].title, 70)}”${snap.running.length > 1 ? ` and ${snap.running.length - 1} more` : ""}.`);
    if (snap.questions?.length) parts.push(`${plural(snap.questions.length, "question")} for you.`);
    if (snap.review?.total) parts.push(`${snap.review.total} in Review${snap.review.approvals ? `, ${snap.review.approvals} awaiting approval` : ""}.`);
    const waiting = waitingRequests(state.requests).length;
    if (waiting) parts.push(`${plural(waiting, "request")} in the inbox.`);
    if (snap.next?.title) parts.push(`Next up: “${clip(snap.next.title, 70)}”.`);
    if (parts.length === 1) parts.push("Nothing is waiting on you.");
    return parts.join(" ");
  }

  // ---- preferences ----------------------------------------------------------

  function setMode(mode, { announce = false } = {}) {
    mode = ["roam", "stay", "hidden"].includes(mode) ? mode : "roam";
    const was = state.mode;
    state.mode = mode;
    store.set("mode", mode);
    if (mode === "stay" && was !== "stay") rememberSpot();
    const select = document.getElementById("companion-mode");
    if (select) select.value = mode;
    els.root.dataset.mode = mode;
    if (mode === "hidden") {
      closePanel();
      hideBubble(false);
      els.root.hidden = true;
      paintPerch();
      return;
    }
    if (state.ready && els.root.hidden) { els.root.hidden = false; goHome({ instant: true }); }
    if (mode === "roam" && was !== "roam") goHome();
    paintStill();
    if (state.panel) paintPanel();
    if (announce && !state.panel) say({ id: `mode:${mode}`, priority: 2, kind: "auto", text: mode === "roam" ? (motionAllowed() ? "Off I go." : "I'll roam once motion is on.") : "I'll stay right here." });
  }
  function setQuiet(quiet, { announce = false } = {}) {
    state.quiet = quiet;
    store.set("chatter", quiet ? "quiet" : "chatty");
    if (state.panel) paintPanel();
    if (announce && !state.panel) say({ id: `chatter:${quiet}`, priority: 3, text: quiet ? "I'll only speak up when something needs you." : "I'll tell you what changes as it happens." });
  }
  function setAuto(on) {
    state.auto = on;
    store.set("auto", on ? "on" : "off");
    const box = document.getElementById("companion-auto");
    if (box) box.checked = on;
    if (els.autoBox) els.autoBox.checked = on;
    if (on) scheduleAuto(800);
  }
  function paintStill() {
    els.root.classList.toggle("still", !motionAllowed());
    if (!canRoam()) clearTimeout(state.timers.wander);
    else scheduleWander();
  }

  // ---- listening ------------------------------------------------------------

  function adoptSnapshot(next) {
    const prev = state.snap;
    state.snap = next;
    if (!els.root) return;
    paintSnapshot(next);
    if (state.ready) for (const notice of notices(prev, next, { handles: (question) => handles(question, next) })) say(notice);
    if (state.panel) paintPanel();
    scheduleAuto();
  }
  // The badge, the label and the mood: what the character shows of the state.
  function paintSnapshot(next) {
    const waitingOnYou = (next?.questions || []).filter((question) => !handles(question, next)).length + (next?.review?.total || 0);
    els.count.hidden = !waitingOnYou;
    els.count.textContent = waitingOnYou > 9 ? "9+" : String(waitingOnYou);
    els.body.setAttribute("aria-label", `${next?.name || "Mefi"}, your companion${waitingOnYou ? `. ${plural(waitingOnYou, "thing waits", "things wait")} for you` : ""}. Open to talk or manage work; arrow keys move it.`);
    if (els.bubble.hidden) els.root.dataset.mood = next?.busy ? "busy" : "idle";
    // An attribute, not .busy: that class is the shared shimmer (styles.css).
    els.root.dataset.busy = String(Boolean(next?.busy));
  }
  function adoptRequests(requests) {
    state.requests = Array.isArray(requests) ? requests : [];
    const waiting = waitingRequests(state.requests).length;
    if (!waiting) state.requestsSince = 0;
    else if (!state.requestsSince) state.requestsSince = Date.now();
    if (state.panel) paintPanel();
    scheduleAuto();
  }
  function readRequests() {
    const read = api()?.eyesRequestsRead;
    if (typeof read !== "function") return;
    Promise.resolve().then(read).then((result) => { if (Array.isArray(result?.requests)) adoptRequests(result.requests); }, () => {});
  }
  function onNav() {
    // After the view has actually changed underneath.
    setTimeout(() => {
      const view = window.MefiNav?.current?.() ?? null;
      if (view === state.view) return;
      state.view = view;
      if (!state.ready || els.root.hidden) return;
      // Roaming, it follows you to the new view's spot, after any remark.
      if (state.mode === "roam" && els.bubble.hidden && !state.panel) goHome();
      else { if (state.mode === "roam") state.home = false; paintPerch(); }
      if (!view || state.seenViews.has(view) || state.quiet) return;
      state.seenViews.add(view);
      const line = viewLine(view, snapshot());
      if (line) say({ id: `view:${view}`, priority: 1, ...line });
    }, 60);
  }
  function wireSettings() {
    const select = document.getElementById("companion-mode");
    if (select) { select.value = state.mode; select.addEventListener("change", () => setMode(select.value)); }
    const box = document.getElementById("companion-auto");
    if (box) { box.checked = state.auto; box.addEventListener("change", () => setAuto(box.checked)); }
    document.getElementById("workspace-motion")?.addEventListener("change", () => setTimeout(paintStill, 0));
    if (typeof MutationObserver === "function" && document.documentElement) {
      new MutationObserver(() => paintStill()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion", "data-shell"] });
    }
  }
  function register() {
    try {
      window.MefiNav?.register?.({
        id: "companion",
        label: "Talk to your companion",
        short: "Companion",
        kind: "action",
        layer: null,
        section: "home",
        group: "assistant",
        key: "J",
        glyph: "g-spark",
        badge: null,
        desc: "Call your companion from anywhere: talk, ask what needs you, or let it handle requests",
        searchTerms: "companion mefi buddy talk chat ask help handle requests answer questions manage roam show hide",
        showIn: { tabs: false, tools: false, dock: false, palette: true, help: true, footer: false },
        run: () => { if (state.mode === "hidden") setMode("roam"); togglePanel(); },
      });
    } catch {}
  }

  // Revealed once the launch screen and startup gate are gone.
  function reveal() {
    if (window.MefiBoot?.isActive?.()) { setTimeout(reveal, 400); return; }
    state.ready = true;
    state.view = window.MefiNav?.current?.() ?? null;
    if (state.view) state.seenViews.add(state.view);
    els.root.dataset.mode = state.mode;
    paintStill();
    if (state.mode === "hidden") return;
    els.root.hidden = false;
    goHome({ instant: true });
    // The workspace's first snapshot went out before this module listened.
    if (!state.snap) state.snap = snapshot();
    paintSnapshot(state.snap);
    for (const notice of notices(null, state.snap, { handles: (question) => handles(question, state.snap) })) say(notice);
    if (store.get("greeted", "") !== "1") {
      store.set("greeted", "1");
      say({ id: "hello", priority: 2, text: `Hi${state.snap?.person ? `, ${state.snap.person}` : ""}! I'm ${name()}. I'll follow you around Studio, point out what needs you and handle routine requests. Click me to talk, or drag me somewhere else.`, actions: [{ label: "Talk to me", do: "talk" }] });
    }
    scheduleAuto(4000);
  }

  function init() {
    if (els.root || !document.body) return;
    build();
    wireSettings();
    register();
    window.addEventListener("mefi:companion-state", (event) => adoptSnapshot(event.detail || null));
    window.addEventListener("mefi:nav", onNav);
    window.addEventListener("mefi:project-changed", () => { state.requests = []; state.requestsSince = 0; state.tried.clear(); readRequests(); });
    window.addEventListener("resize", () => { if (state.ready && !els.root.hidden) { if (state.home || state.mode === "stay") goHome({ instant: true }); else place(state.pos, { instant: true }); } });
    document.addEventListener("pointerdown", (event) => { if (state.panel && !els.root.contains?.(event.target)) closePanel(); }, true);
    api()?.onRequests?.((requests) => adoptRequests(requests));
    readRequests();
    reveal();
  }

  window.MefiCompanion = { rules, say, perform, handleNow, willHandle, open: openPanel, close: closePanel, setMode, setAuto, state: () => ({ mode: state.mode, auto: state.auto, quiet: state.quiet, panel: state.panel, pos: { ...state.pos }, bubble: state.bubble?.text ?? null, queue: state.queue.map((notice) => notice.id) }) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
