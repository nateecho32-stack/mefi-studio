// Today and the Inbox: the calm mode's page and the one place what waits on you
// is decided (layout v2, the 0.5 shell; docs/unified-studio.md "Layout contract").
// With html[data-layout="v2"] absent nothing here renders, listens, polls,
// stores or calls the host: start() looks once and leaves.
//
// Today is Vibe's Home in v2. It draws the front door's own pieces (the
// greeting, the box that builds or talks, the four starting points, the line
// that says what holds the agents back) where it wants them, under Vibe's own
// top bar (which keeps the project, New app, the conversation and Settings), so Build it,
// Suggest a next step and the drafts keep working through renderer/vibe.js, and
// under them a board of one line per session in four groups: Needs you, Running,
// Review and Done today. The detail each card shows follows html[data-detail]
// (titles, + status, everything). In Build the same board is a page, Today, that
// a pinned tab opens. The live node tree stays behind it: Vibe's own backdrop.
//
// The Inbox is everything that waits on the owner, from the list the app already
// keeps (assistantState.needsYou, the one the taskbar count is read from; see
// scripts/companion.cjs and scripts/alerts-host.cjs): open questions (a
// permission is one), approvals, reviews and tasks parked after failures. Each
// says what it is, which task it comes from and how long it has waited, offers
// the options the app offers and a free answer, and acts through the calls the
// rest of the app uses (assistant:answer, backlog:control, tasks:action). An
// action is refused while it is in flight and after it landed, leaves a
// "Decided" line, and has an Undo where the app has one (a drop or a done can
// be reopened; Mefi's own decisions undo through autonomy:undo). "N need you" is
// that list's length, not a second count: count() and onChange() are what the
// top bar's pill, the status bar, Home's own chip and the Inbox tab read,
// needTasks() is which sessions the session list files under Needs you, and
// openInbox(anchor) what the pill opens (a popover under the pill, and a page,
// Work > Inbox, the registry route "inbox", for keeping it open). Each card
// reads as the 0.5 prototype's: what it is and who asked, how long it has
// waited, the question, the task it comes from, and the app's own options.
//
// Everything it shows comes from MefiVibe.data() and watch() (renderer/vibe.js),
// so the front door and this page never disagree. Nothing is stored: the pieces
// it puts off ("Decide later") are for this session only.
(function () {
  "use strict";
  const api = () => window.mefiStudio;
  const vibe = () => window.MefiVibe;
  const page = () => document.documentElement;
  const v2 = () => page()?.dataset?.layout === "v2";
  const byId = (id) => document.getElementById(id);

  // ---- words and small helpers -----------------------------------------------------------------
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  const clip = (value, max = 160) => { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text; };
  const time = (value) => Number(value) || Date.parse(value || "") || 0;
  const say = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : (typeof error === "string" ? error : error?.message) || fallback);
  // How long something has waited, in the shortest true words: "just now", "4 min", "2 h", "3 d".
  function waited(at, now = Date.now()) {
    const ms = now - (time(at) || now);
    if (ms < 60000) return "just now";
    if (ms < 3600000) return `${Math.round(ms / 60000)} min`;
    if (ms < 86400000) return `${Math.round(ms / 3600000)} h`;
    return `${Math.round(ms / 86400000)} d`;
  }
  const ago = (at, now) => { const text = waited(at, now); return text === "just now" ? text : `${text} ago`; };
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  function glyph(id) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "glyph"); svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${id}`); svg.append(use);
    return svg;
  }
  // html[data-detail] is the Size and density page's (titles, + status, everything); "status" is its default.
  const detailLevel = () => { const value = page()?.dataset?.detail; return value === "titles" || value === "all" ? value : "status"; };
  const taskOf = (data, id) => (id ? (Array.isArray(data?.tasks) ? data.tasks : []).find((task) => task?.id === id) ?? null : null);
  const finishedAt = (task) => time(task.doneAt) || time(task.verification?.at) || time(task.updatedAt) || time(task.createdAt);

  // ---- the kinds an item can be ------------------------------------------------------------------
  // An open question is told by what it is about (scripts/agent-issues.cjs); the rest by where the app keeps them.
  const ISSUE_KIND = { permission: "permission", risk: "permission", "check-failed": "failure", "run-failed": "failure", verify: "failure" };
  const ISSUE_LABEL = { permission: "Permission", risk: "A risky change", "check-failed": "Checks failed", "run-failed": "Stopped", verify: "Not proven done", owner: "Only you can do this", blocked: "Blocked", missing: "Something is missing", scope: "Bigger than its brief", conflict: "Two ways to do it", capability: "Past this model" };
  const HOLD_LABEL = { owner: "Stopped by you", loop: "Same failure repeating", duplicate: "Looks like a duplicate", relevance: "Maybe done outside Studio" };
  const HOLD_VERB = { loop: "Try again", owner: "Resume", duplicate: "Run anyway", relevance: "Build it anyway" };
  const TONES = { question: "warn", permission: "warn", failure: "bad", approval: "warn", review: "info" };

  // What the digest says about each need, by the id scripts/companion.cjs queue() gives it.
  function digestOf(data) {
    const rows = Array.isArray(data?.assistant?.needsYou?.items) ? data.assistant.needsYou.items : [];
    return new Map(rows.map((row) => [String(row.id), row]));
  }
  function digestRow(digest, need) {
    if (need.kind === "question") return digest.get(String(need.id)) ?? null;
    if (need.kind === "blocked") return digest.get(`held:${need.id}`) ?? digest.get(`parked:${need.id}`) ?? null;
    if (need.kind === "review") return digest.get(`review:${need.id}`) ?? null;
    return digest.get(`approval:${need.id}`) ?? null;
  }

  // One line of words for what the host call did, for the "Decided" line.
  const acceptLabel = () => (window.MefiAutonomy?.state?.()?.level === "accept" ? "Accept this task" : "Approve build");
  const reopen = (data, id) => () => api().tasksAction({ taskId: id, projectId: data.projectId, action: "status", status: "open" });

  // What can be done with a need, each through the call the rest of the app makes for it. `decided` is what the
  // "Decided" line says afterwards; `undo` is there only where the app has a way back.
  function actionsOf(item, data) {
    const need = item.need, projectId = data.projectId, id = need.id;
    const task = taskOf(data, need.kind === "question" ? need.question?.context?.taskId : id);
    const tasks = (payload) => () => api().tasksAction({ taskId: id, projectId, ...payload });
    const drop = { id: "drop", label: "Drop it", confirm: "Drop this task?", title: "Close it without finishing; Undo reopens it", call: tasks({ action: "drop" }), decided: "Dropped", undo: reopen(data, id) };
    const done = { id: "done", label: "It's done", confirm: "Mark it done?", title: "You checked the result yourself: mark it complete", call: tasks({ action: "status", status: "done" }), decided: "Marked done", undo: reopen(data, id) };
    if (need.kind === "approval") {
      const row = need.row || {};
      const can = row.canApprove === true && typeof row.buildScope === "string" && row.buildScope;
      return [
        { id: "approve", label: acceptLabel(), primary: true, disabled: !can, title: can ? "Approve this brief so the task can build" : "Open the task to review its current brief first", call: () => api().backlogControl({ action: "approve", taskId: id, projectId, expectedScope: row.buildScope }), decided: "Approved. It builds when a worker is free" },
        drop,
      ];
    }
    if (need.kind === "family") {
      const ready = (need.rows || []).filter((row) => typeof row.buildScope === "string" && row.buildScope && row.canApprove !== false);
      return [
        { id: "start", label: `Start ${ready.length === 1 ? "the step" : `all ${ready.length} steps`}`, primary: true, disabled: !ready.length, title: "Approve every waiting step as it is saved now", decided: "Started the steps", call: async () => {
          let result = { ok: true };
          for (const row of ready) {
            result = await api().backlogControl({ action: "approve", taskId: row.id, projectId, expectedScope: row.buildScope });
            if (!result || result.ok === false) return result;
          }
          return result;
        } },
        { id: "merge", label: "Make it one task", confirm: "Drop the unstarted steps?", title: "Drop the steps that have not started; the request is built as one task", call: tasks({ action: "merge-steps" }), decided: "Kept as one task" },
      ];
    }
    if (need.kind === "blocked") {
      const row = need.row || {};
      const hold = row.blockedBy;
      const retryable = row.canRetry !== false && !["verifying", "awaiting_verification"].includes(task?.status);
      return [
        { id: "retry", label: HOLD_VERB[hold] || "Try again", primary: true, disabled: !retryable, title: "Put it back in the queue; it continues from its saved progress", call: tasks({ action: "retry" }), decided: "Back in the queue" },
        done, drop,
      ];
    }
    if (need.kind === "review") {
      if (need.checking) return [done];
      const verifying = task?.status === "verifying";
      // The prototype's two, then the one more this app has: Approve and finish (the thread's own words), Review changes (the
      // session on its Changes tab, nothing sent), and Send it back.
      return [
        { id: "confirm", label: "Approve and finish", primary: true, title: "You checked the result yourself: mark it complete", call: tasks({ action: "status", status: "done" }), decided: "Approved and finished", undo: reopen(data, id) },
        { id: "changes", label: "Review changes", title: "Open the session on what it changed", go: () => openChanges(id) },
        { id: "back", label: "Send it back", disabled: verifying, title: verifying ? "Its check is running right now; try again when it settles" : "Return it to the queue for another attempt", call: tasks({ action: "retry" }), decided: "Sent back" },
      ];
    }
    return [];
  }

  // ---- items: what waits on the owner -------------------------------------------------------------
  // One item per entry of the digest, from the rows vibe.js already builds (needs()), minus plans: a plan
  // waiting on its owner is not in the digest, so it is not in the count (Today lists it under Review).
  function itemOf(need, data, digest) {
    const question = need.kind === "question" ? need.question || {} : null;
    const context = question?.context || {};
    const task = taskOf(data, question ? context.taskId : need.id);
    let kind = "question", label = "Question";
    if (need.kind === "question") {
      kind = ISSUE_KIND[context.issueKind] || "question";
      label = ISSUE_LABEL[context.issueKind] || "Question";
    } else if (need.kind === "approval" || need.kind === "family") {
      kind = "approval"; label = need.kind === "family" ? "Steps to approve" : "Waiting for your go-ahead";
    } else if (need.kind === "blocked") {
      kind = "failure"; label = HOLD_LABEL[need.row?.blockedBy] || (task?.verification?.state === "failed" ? "Checks failed" : "Stuck");
    } else if (need.kind === "review") {
      kind = "review"; label = need.checking ? "Still checking" : "Ready for review";
    }
    const row = digestRow(digest, need);
    const at = time(row?.at) || time(question?.at) || time(need.since) || time(task?.awaitingAt) || time(task?.updatedAt) || 0;
    const suggestion = context.suggestion;
    const options = question ? (Array.isArray(question.options) ? question.options : []).slice().sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended))).map((option) => ({
      id: String(option.id), label: clip(option.label, 120), description: clip(option.description, 160),
      recommended: Boolean(option.recommended) || (suggestion?.optionId != null && option.id === suggestion.optionId),
      text: Boolean(option.text || option.action?.action === "instruct"), dismiss: Boolean(option.dismiss || option.action?.action === "hold"),
    })) : [];
    let detail = "";
    if (question) detail = clip(question.detail, 280);
    else if (need.kind === "blocked") detail = clip(need.row?.reason || task?.verification?.reason || task?.lastRunError || "", 280);
    else if (need.kind === "review") detail = clip(task?.verification?.reason || task?.result?.summary || task?.summary || "", 280);
    else if (need.kind === "approval") detail = "Your permission settings require approval of this brief before it can start.";
    else if (need.kind === "family") detail = `${plural((need.rows || []).length, "step")} wait for your go-ahead. Your request runs last, to put them together and check the whole thing.`;
    const suggested = suggestion && options.find((option) => option.id === suggestion.optionId);
    // Who asked: the worker on the task now (the run's route), else the one that ran it last. A result says how its checks went.
    const taskId = question ? context.taskId || null : need.id;
    const job = taskId ? (Array.isArray(data.running) ? data.running : []).find((row) => row?.taskId === taskId) ?? null : null;
    const who = clip(job?.route || job?.cli || task?.lastAttempt?.route || "", 40);
    const results = need.kind === "review" && Array.isArray(task?.verificationRun?.results) ? task.verificationRun.results : [];
    const facts = results.length ? `${results.filter((result) => result?.ok === true).length} of ${plural(results.length, "check")} passed` : "";
    const hint = suggestion ? `Mefi suggests: ${suggested?.label || "your review"}${suggestion.reason ? `, because ${clip(suggestion.reason, 160).replace(/^because\s+/i, "")}` : ""}` : "";
    return {
      key: `${need.kind}:${need.id}`, need, kind, label, tone: TONES[kind], title: clip(need.title, 200) || "Something needs you",
      from: question ? clip(context.taskTitle || task?.title || "", 90) : "", taskId, who, facts,
      at, detail, hint, options, evidence: Array.isArray(context.evidence) ? context.evidence.slice(-3).map((line) => clip(line, 200)) : [],
      steps: need.kind === "family" ? (data.families || []).find((family) => family.id === need.id)?.steps?.map((step) => clip(step.title, 90)) ?? [] : [],
    };
  }

  // The whole picture for one moment. `items` is what a list draws: the needs, each marked when it was handled
  // a moment ago (it then reads as a "Decided" line), and a decided line whose need the host already dropped,
  // kept in its place until it has been seen. `count` is what still needs you, which is what the pill says.
  // A pure function of what it is given.
  function build(data, { now = Date.now(), handled = new Map(), detail = "status" } = {}) {
    const d = data && typeof data === "object" ? data : {};
    const digest = digestOf(d);
    const current = (Array.isArray(d.needs) ? d.needs : []).filter((need) => need && need.kind !== "plan").map((need) => itemOf(need, d, digest));
    const seen = new Set(current.map((item) => item.key));
    let drawn = [];
    for (const item of current) {
      const entry = handled.get(item.key);
      if (entry && now < entry.holdUntil) { if (now < entry.showUntil) { item.handled = entry; drawn.push(item); } continue; }
      drawn.push(item);
    }
    for (const [key, entry] of handled) {
      if (seen.has(key) || now >= entry.showUntil) continue;
      const ghost = { key, handled: entry, need: null, kind: entry.kind, label: entry.kindLabel, tone: entry.tone, title: entry.title, from: "", taskId: entry.taskId, who: "", facts: "", at: 0, detail: "", hint: "", options: [], evidence: [], steps: [] };
      drawn.splice(Math.min(entry.index ?? drawn.length, drawn.length), 0, ghost);
    }
    const count = drawn.filter((item) => !item.handled).length;
    const board = boardOf(d, now, drawn, detail);
    return { projectId: d.projectId ?? null, projectName: d.projectName || "", items: drawn, count, board, quiet: board.total === 0 && count === 0 };
  }

  // What a card that waits on you says first, as the prototype's board does ("Asking a question · 4 min"): a question and a permission by
  // what they are, the rest by their own label.
  const ASKING = { question: "Asking a question", permission: "Asking permission" };
  // A need on the board is its session: the task as the title, how long it has waited, then the question (or what holds it) in its own box and
  // the first two answers or actions. A result to review is a card under Review (it is still in the Inbox, and in the count).
  function cardOfItem(item, detail, data = {}) {
    const group = item.kind === "review" ? "review" : "needs";
    if (item.handled) return { key: `need:${item.key}`, group, tone: "done", item, decided: true, title: item.title, meta: "", more: [] };
    const from = item.from && item.from !== item.title ? item.from : "";
    if (group === "review") {
      const checking = Boolean(item.need?.checking);
      return { key: `need:${item.key}`, group, tone: "check", item, review: true, checking, title: item.title, taskId: item.taskId, meta: [checking ? "Checking its work" : item.facts || "Ready to review", item.at ? waited(item.at) : ""].filter(Boolean).join(" · "), more: detail === "all" && item.detail ? [item.detail] : [] };
    }
    const card = { key: `need:${item.key}`, group, tone: item.tone, item, title: from || item.title, taskId: item.taskId, open: item.taskId ? { taskId: item.taskId } : null, meta: [ASKING[item.kind] || item.label, item.at ? waited(item.at) : ""].filter(Boolean).join(" · "), q: from ? item.title : item.detail, more: [] };
    if (detail !== "titles" && item.options.length) card.quick = item.options.filter((option) => !option.text && !option.dismiss).slice(0, 2);
    // A thing with no options of its own offers the app's first two actions for it (its go-ahead, Try again, It's done), as the Inbox does.
    if (detail !== "titles" && !item.options.length) card.acts = actionsOf(item, data).slice(0, 2).map((action) => ({ id: action.id, label: action.label, primary: Boolean(action.primary), disabled: Boolean(action.disabled) }));
    if (detail === "all") { if (item.hint) card.more.push(item.hint); for (const line of item.evidence.slice(-1)) card.more.push(line); }
    return card;
  }

  // The tasks the Inbox holds for you (anything but a review): a run among them waits on you, so it is not also "running".
  const waitingTasks = (items) => new Set(items.filter((item) => !item.handled && item.kind !== "review" && item.taskId).map((item) => String(item.taskId)));
  function boardOf(d, now, items, detail) {
    const cards = items.map((item) => cardOfItem(item, detail, d));
    const needs = cards.filter((card) => card.group === "needs");
    const worktrees = new Set(window.MefiWorktrees?.summary?.()?.tasks ?? []);
    const asked = new Set(items.filter((item) => item.kind === "review").map((item) => item.taskId));
    // A run that waits on you is under Needs you, not under Running too (the session list files it the same way).
    const waiting = waitingTasks(items);
    const running = [];
    for (const job of Array.isArray(d.running) ? d.running : []) {
      if (job.taskId && waiting.has(String(job.taskId))) continue;
      const step = window.MefiVibeFlow?.doing?.(job) ?? { tool: "", step: "" };
      const phase = job.stopping ? "stopping" : job.phase ? String(job.phase).replace(/_/g, " ") : "working";
      const progress = Number.isFinite(job.progress) ? Math.max(0.04, Math.min(1, job.progress)) : null;
      // Who is on it, for how long, and what it is doing now: the prototype's "builder-2 · 40 min · step 4/5", in the words the run has.
      const who = clip(job.route || job.cli || step.tool || "", 40);
      running.push({ key: `run:${job.taskId || job.title}`, group: "running", tone: "live", title: clip(job.title || "A task", 120), taskId: job.taskId || null, progress, worktree: worktrees.has(job.taskId),
        meta: [who, job.startedAt ? waited(job.startedAt, now) : "", job.stopping ? "stopping" : clip(step.step, 80) || phase].filter(Boolean).join(" · "), more: [] });
    }
    // A queued task that waits on you (a permission it asked for, a question) is under Needs you only, like a run.
    for (const next of (Array.isArray(d.next) ? d.next : []).filter((next) => !(next?.id && waiting.has(String(next.id)))).slice(0, 2)) {
      running.push({ key: `next:${next.id}`, group: "running", tone: "next", title: clip(next.title || "Next task", 120), taskId: next.id || null,
        meta: next.stage === "waiting" ? "waiting for what it depends on" : next.stage === "cooling" ? "trying again soon" : "up next · waits for a free worker", more: [] });
    }
    // Review: results ready for you first, then what is being checked, then plans waiting on you.
    const review = cards.filter((card) => card.group === "review");
    for (const task of Array.isArray(d.checking) ? d.checking : []) {
      if (asked.has(task.id)) continue;
      review.push({ key: `check:${task.id}`, group: "review", tone: "check", title: clip(task.title || "A finished task", 120), taskId: task.id, worktree: worktrees.has(task.id), meta: "Checking its work", more: [] });
    }
    for (const need of Array.isArray(d.needs) ? d.needs : []) {
      if (need?.kind !== "plan") continue;
      review.push({ key: `plan:${need.id}`, group: "review", tone: "idea", title: clip(need.title || "A plan", 120), planId: need.id, meta: `Plan · ${need.meta || "waits for you"}`, more: [] });
    }
    // Done today: since midnight, or the last twelve hours when that reaches further back (Vibe's own window).
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const cutoff = Math.min(start.getTime(), now - 12 * 3600000);
    const finished = (Array.isArray(d.tasks) ? d.tasks : []).filter((task) => ["done", "archived", "completed"].includes(task?.status) && !task.dropped && finishedAt(task) >= cutoff).sort((a, b) => finishedAt(b) - finishedAt(a));
    const done = finished.slice(0, 6).map((task) => ({ key: `done:${task.id}`, group: "done", tone: "done", title: clip(task.title || "A task", 120), taskId: task.id, worktree: worktrees.has(task.id),
      meta: `${task.verification?.state === "verified" ? "Verified" : "Done"} · ${ago(finishedAt(task), now)}`, more: [clip(task.verification?.reason, 140)].filter(Boolean) }));
    const notices = (Array.isArray(d.assistant?.messages) ? d.assistant.messages : []).filter((message) => message?.kind === "notice" && message.text && !String(message.taskId || "").startsWith("__")).slice(-4).reverse()
      .map((message) => ({ key: `note:${message.id || message.at}`, text: clip(message.text, 160), at: time(message.at) }));
    return { needs, running, review, done, doneMore: Math.max(0, finished.length - done.length), latest: notices, total: needs.filter((card) => !card.decided).length + running.length + review.filter((card) => !card.decided).length + done.length };
  }

  // ---- state ---------------------------------------------------------------------------------------
  const state = {
    on: false, data: null, off: null, host: null, handled: new Map(), busy: new Set(), errors: new Map(), later: new Set(), drafts: new Map(), ownWords: new Set(),
    inbox: { open: false, anchor: null, index: 0, node: null, opener: null, focusKey: null }, pageOpen: null, anchor: null, clock: 0, sweep: 0,
    listeners: new Set(), signature: "", parts: null, painted: new WeakMap(),
    // Build's Home (layout v2): the page, what it borrowed from Home, and the suggestions it asked for. `homeView` is the route's view: "chat" is the classic Home.
    home: { on: false, node: null, parts: null, tools: null, toolParts: null, lent: [], placeholder: null, keys: null, typing: null, keysOn: null, suggest: { loading: false, error: "", result: null, request: 0 } },
    homeView: "today",
  };
  const NOT_DONE = "That did not go through. You can also open the task.";
  const DECIDED_SHOW_MS = 8000;
  const DECIDED_HOLD_MS = 90000;

  function model() { return build(state.data || vibe()?.data?.() || {}, { handled: state.handled, detail: detailLevel() }); }
  function count() { return state.on ? model().count : 0; }
  // The sessions the Inbox holds for a decision other than a question (a go-ahead, steps to approve, a task that stopped), and not
  // for a review (that one stays under Review): the session list files these under Needs you (renderer/builder.js reading), with
  // the tasks that have an open question, which it reads from the same questions itself (so an answer leaves at once, whichever
  // copy of the board is fresher). Kept until the data or a decision moves, since the list asks once per row.
  let needCache = { data: undefined, key: "", set: new Set() };
  function needTasks() {
    if (!state.on) return null;
    const data = state.data || vibe()?.data?.() || {};
    const key = [...state.handled.keys()].join("\u0001");
    if (needCache.data === data && needCache.key === key) return needCache.set;
    const set = new Set(model().items.filter((item) => !item.handled && item.need && item.need.kind !== "question" && item.kind !== "review" && item.taskId).map((item) => String(item.taskId)));
    needCache = { data, key, set };
    return set;
  }
  function items() { return state.on ? model().items.filter((item) => !item.handled).map((item) => ({ key: item.key, kind: item.kind, title: item.title, taskId: item.taskId, at: item.at })) : []; }

  // The pill's number and the Inbox's rows move together: tell whoever listens when either does. What start() found is
  // the baseline (count() says it), so a listener hears about changes, not about the state it could already read.
  const signatureOf = () => JSON.stringify([model().items.filter((item) => !item.handled).map((item) => item.key), [...state.handled.keys()]]);
  function announce() {
    const signature = signatureOf();
    if (signature === state.signature) return;
    state.signature = signature;
    const total = model().count;
    for (const callback of [...state.listeners]) { try { callback(total); } catch { /* one listener never stops another */ } }
    try { window.dispatchEvent(new CustomEvent("mefi:inbox", { detail: { count: total } })); } catch { /* no events here */ }
  }
  function onChange(callback) {
    if (typeof callback !== "function") return () => {};
    state.listeners.add(callback);
    return () => { state.listeners.delete(callback); };
  }

  // A handled need stays out of the count at once; the host catches up by itself within a push or two. What the
  // digest no longer lists is forgotten, and so is anything that outlived its hold (it was not settled after all).
  function sweepHandled(now = Date.now()) {
    const listed = new Set((Array.isArray((state.data || {}).needs) ? state.data.needs : []).map((need) => `${need.kind}:${need.id}`));
    let changed = false;
    for (const [key, entry] of state.handled) {
      if (now >= entry.holdUntil || (!listed.has(key) && now >= entry.showUntil)) { state.handled.delete(key); state.later.delete(key); state.errors.delete(key); state.drafts.delete(key); changed = true; }
    }
    return changed;
  }

  // ---- doing something about a need --------------------------------------------------------------
  // What is handled stays out of the count at once and reads as a "Decided" line, in the place it had, until the host
  // has dropped it from its list and the line has been seen.
  function decided(item, label, { undo: back = null, note = "", index: was = -1 } = {}) {
    const now = Date.now();
    // Its place is the one it had when the action began: the host's push can reach the page before its reply does, and the need is gone from the list by then.
    const index = was >= 0 ? was : model().items.findIndex((entry) => entry.key === item.key);
    state.handled.set(item.key, { at: now, showUntil: now + DECIDED_SHOW_MS, holdUntil: now + DECIDED_HOLD_MS, label, undo: back, title: item.title, note, kind: item.kind, tone: item.tone, kindLabel: item.label, taskId: item.taskId, index: index < 0 ? undefined : index });
    state.errors.delete(item.key);
    scheduleSweep();
    announce(); paint();
    void vibe()?.refresh?.();
  }
  // A need is held while its decision is still on its way to the host's list; past the hold it is a card again.
  const holding = (key) => { const entry = state.handled.get(key); return Boolean(entry && Date.now() < entry.holdUntil); };
  // One call per item at a time, and none once it landed: a second click finds it busy or decided and does nothing.
  async function perform(item, action, extra = {}) {
    const key = item.key;
    if (!action || action.disabled || state.busy.has(key) || holding(key)) return { ok: false, skipped: true };
    const project = (state.data || {}).projectId ?? null;
    const place = model().items.findIndex((entry) => entry.key === key);
    state.busy.add(key); state.errors.delete(key);
    paint();
    let result = null;
    try { result = await action.call(extra); } catch (error) { result = { ok: false, error: say(error, NOT_DONE) }; }
    state.busy.delete(key);
    // The project changed while it ran: its answer belongs to the old project's list, which is gone.
    if (project !== ((state.data || {}).projectId ?? null)) { paint(); return result; }
    if (result && result.ok !== false) {
      const label = typeof action.decided === "function" ? action.decided(extra) : action.decided;
      decided(item, label || "Done", { undo: action.undo || null, note: clip(window.MefiAutonomy?.outcome?.(result, "") || "", 140), index: place });
      return result;
    }
    // A question that closed meanwhile, or whose card left the board, is cleared by the host: a notice, not a failure.
    if (result?.gone) { decided(item, clip(result.error, 120) || "That was settled already", { index: place }); return result; }
    state.errors.set(key, say(result, NOT_DONE));
    paint();
    return result;
  }
  // The answer to a question: an option, words of your own, or an option that asks for one line.
  function answer(item, { optionId = null, text = "" } = {}) {
    const question = item.need.question || {};
    const words = String(text || "").trim().slice(0, 400);
    if (!optionId && !words) return Promise.resolve({ ok: false, skipped: true });
    const option = item.options.find((entry) => entry.id === optionId) ?? null;
    return perform(item, {
      id: "answer", decided: () => `Answered: ${clip(option?.label || words, 60)}`,
      call: () => {
        if (!api()?.assistantAnswer) return { ok: false, error: "Answers are available in the desktop app." };
        return api().assistantAnswer({ id: question.id, optionId, ...(words ? { text: words } : {}), projectId: (state.data || {}).projectId });
      },
    });
  }
  async function undo(key) {
    const entry = state.handled.get(key);
    if (!entry?.undo || state.busy.has(key)) return { ok: false, skipped: true };
    state.busy.add(key); paint();
    let result = null;
    try { result = await entry.undo(); } catch (error) { result = { ok: false, error: say(error, "That could not be undone.") }; }
    state.busy.delete(key);
    if (result && result.ok !== false) { state.handled.delete(key); state.errors.delete(key); announce(); paint(); void vibe()?.refresh?.(); return result; }
    state.errors.set(key, say(result, "That could not be undone."));
    paint();
    return result;
  }
  // Decide later puts it last for now. It still needs you, so it is still counted.
  function later(key, on = true) { if (on) state.later.add(key); else state.later.delete(key); paint(); }

  // ---- drawing one item ---------------------------------------------------------------------------
  function button(label, className, onClick, { title = "", disabled = false, confirm = "" } = {}) {
    const node = el("button", className, label);
    node.type = "button";
    if (title) node.title = title;
    if (disabled) node.disabled = true;
    if (confirm && window.MefiUi?.arm) window.MefiUi.arm(node, { run: onClick, armed: confirm });
    else node.addEventListener("click", onClick);
    return node;
  }
  function openTask(taskId, { projectId = null, from = null } = {}) {
    if (!taskId) return false;
    closeInbox({ restore: false });
    if (from && typeof from.focus === "function") state.anchor = state.anchor || from;
    // The one place that knows which route a session is: the session panels (layout v2) show a task as a thread, in a tab of
    // its own (the preview tab until you use it). Without them the task's own page is asked of the router, with the task: a
    // tab cannot say which task a board page shows (only a session is a place of its own), so the strip follows the route.
    const sessions = window.MefiSessions;
    if (sessions?.active?.() && sessions.open?.(String(taskId), { preview: true })) return true;
    const pid = projectId || (state.data || {}).projectId;
    window.MefiNav?.go?.("tasks", { taskId: String(taskId), ...(pid ? { projectId: pid } : {}), filter: "all" });
    return true;
  }
  function openPlan(planId) { window.MefiNav?.go?.("plans", { planId }); }
  // A result to review opens as its session on the Changes tab (the session panels' own), else as the task.
  function openChanges(taskId) {
    if (!taskId) return false;
    closeInbox({ restore: false });
    const sessions = window.MefiSessions;
    if (sessions?.active?.() && sessions.open?.(String(taskId), { preview: true, tab: "changes" })) return true;
    return openTask(taskId);
  }
  // The kind of a card as the prototype draws it: a question or a failure with its mark, a permission with a lock, a
  // go-ahead or a result with a tick, a plan with the spark.
  const KIND_PATHS = Object.freeze({
    question: ["M8 2.25a5.75 5.75 0 1 0 0 11.5a5.75 5.75 0 0 0 0-11.5z", "M8 5.1v3.4", "M8 10.75v.1"],
    permission: ["M4.25 7.25h7.5v6h-7.5z", "M5.75 7.25V5.5a2.25 2.25 0 0 1 4.5 0v1.75"],
    approval: ["M3.25 8.4 6.4 11.5l6.35-7"],
  });
  function kindGlyph(kind) {
    if (kind === "plan") { const sprite = glyph("g-spark"); sprite.classList?.add?.("today-need-glyph"); return sprite; }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "glyph today-need-glyph"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); svg.setAttribute("viewBox", "0 0 16 16");
    for (const d of KIND_PATHS[kind === "failure" ? "question" : kind === "review" ? "approval" : kind] || KIND_PATHS.question) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d); svg.append(path);
    }
    return svg;
  }

  function renderDecided(item, entry, key = item.key) {
    const node = el("article", "today-need is-decided");
    node.dataset.key = key; node.dataset.kind = item.kind;
    const line = el("div", "today-decided");
    line.setAttribute("role", "status");
    line.append(el("i", "today-tick"));
    const words = el("span", "today-decided-words");
    words.append(el("b", "", "Decided"), document.createTextNode(` · ${entry.label}`), ...(entry.title ? [el("small", "", clip(entry.title, 70))] : []));
    line.append(words);
    if (entry.undo) line.append(button("Undo", "today-link", () => void undo(item.key), { title: "Put it back as it was", disabled: state.busy.has(item.key) }));
    node.append(line);
    if (state.errors.has(item.key)) node.append(el("p", "today-need-note", state.errors.get(item.key)));
    return node;
  }

  // A need as a card. `ctx.compact` leaves out the long text (the popover); the page shows it all.
  function renderNeed(item, ctx = {}) {
    if (item.handled) return renderDecided(item, item.handled);
    const busy = state.busy.has(item.key);
    const postponed = state.later.has(item.key);
    const node = el("article", `today-need${postponed ? " is-later" : ""}${busy ? " is-busy" : ""}`);
    node.dataset.key = item.key; node.dataset.kind = item.kind; node.dataset.tone = item.tone;
    node.tabIndex = -1;
    node.setAttribute("aria-busy", String(busy));
    // As the prototype has it: what it is and who asked, how long it has waited; the question; then the task it comes from
    // (or how a result's checks went).
    const head = el("div", "today-need-kind");
    head.append(kindGlyph(item.kind), el("span", "today-need-label", item.who ? `${item.label} · ${item.who}` : item.label));
    if (item.at) { const when = el("time", "today-need-time", waited(item.at)); when.title = `Waiting ${waited(item.at)}`; head.append(when); }
    const title = el("h5", "today-need-title", item.title);
    title.id = `today-need-${String(item.key).replace(/[^A-Za-z0-9_-]/g, "-")}`;
    node.setAttribute("aria-labelledby", title.id);
    node.append(head, title);
    const under = item.from && item.from !== item.title ? item.from : item.facts;
    if (under) node.append(el("p", "today-need-from", under));
    if (item.detail && !(ctx.compact && item.kind !== "question" && item.detail.length > 140)) node.append(el("p", "today-need-detail", ctx.compact ? clip(item.detail, 160) : item.detail));
    if (item.hint) node.append(el("p", "today-need-hint", item.hint));
    if (!ctx.compact && item.evidence.length) node.append(el("pre", "today-need-evidence", item.evidence.join("\n")));
    if (!ctx.compact && item.steps.length) { const list = el("ol", "today-need-steps"); for (const step of item.steps) list.append(el("li", "", step)); node.append(list); }
    // What can be done.
    const choices = el("div", "today-need-options");
    choices.setAttribute("role", "group"); choices.setAttribute("aria-label", item.options.length ? "Your answer" : "What to do");
    const lock = busy;
    // A question is always answerable here, with options or without: one that has none is answered in words.
    if (item.options.length || item.need.kind === "question") {
      let typed = null;
      const form = el("form", "today-need-free");
      const input = el("input", "today-need-input"); input.type = "text"; input.autocomplete = "off";
      input.placeholder = item.options.some((option) => option.text) ? "Your one-line answer, or an option above…" : item.options.length ? "Or say it in your own words…" : "Your answer…";
      input.setAttribute("aria-label", "Write your own answer");
      const kept = state.drafts.get(item.key);
      if (kept) { input.value = kept.text; typed = item.options.find((option) => option.id === kept.optionId) ?? null; }
      input.addEventListener("input", () => state.drafts.set(item.key, { text: input.value, optionId: typed?.id ?? null }));
      input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); form.requestSubmit?.() ?? form.trigger?.("submit"); } });
      item.options.forEach((option, index) => {
        const choose = el("button", `today-option${index === 0 ? " is-first" : ""}${option.recommended ? " is-recommended" : ""}`);
        choose.type = "button"; choose.dataset.option = option.id; choose.disabled = lock;
        if (index < 9) choose.append(el("kbd", "today-key", String(index + 1)));
        choose.append(el("span", "today-option-label", option.label));
        if (option.recommended) choose.append(el("span", "today-rec", "Recommended"));
        if (option.description) choose.title = option.description;
        choose.addEventListener("click", () => {
          // An option that asks for words takes them from the box; one that does not answers at once.
          if (option.text) { typed = option; state.drafts.set(item.key, { text: input.value, optionId: option.id }); openOwnWords(); input.placeholder = "Your one-line answer…"; input.focus?.(); return; }
          void answer(item, { optionId: option.id });
        });
        choices.append(choose);
      });
      form.append(input, button("Send", "today-btn", () => {}, { disabled: lock }));
      form.lastChild.type = "submit";
      form.addEventListener("submit", (event) => {
        event.preventDefault?.();
        const words = input.value.trim();
        if (!words) { input.focus?.(); return; }
        void answer(item, { optionId: typed?.id ?? null, text: words });
      });
      // The owner's choice (2026-10-04): the box for your own words waits behind a small link, so a card reads as its
      // options first. It opens on the link, on an option that asks for words, and stays open while it holds a draft.
      // A question with no options has nothing to read first: its box is open from the start, and there is no link.
      const own = button("Answer in my own words", "today-link today-own-words", () => { openOwnWords(); input.focus?.(); }, { title: "Write your own answer instead of picking one", disabled: lock });
      function openOwnWords() { state.ownWords.add(item.key); form.hidden = false; own.hidden = true; }
      if (kept?.text || state.ownWords.has(item.key)) openOwnWords();
      else if (!item.options.length) { form.hidden = false; own.hidden = true; }
      else form.hidden = true;
      if (item.options.length) node.append(choices);
      node.append(own, form);
    } else {
      for (const action of actionsOf(item, state.data || {})) {
        // A way to look (Review changes) only goes somewhere; everything else is a decision, through perform().
        const run = typeof action.go === "function" ? () => action.go() : () => void perform(item, action);
        choices.append(button(action.label, `today-btn${action.primary ? " primary" : ""}`, run, { title: action.title, disabled: lock || action.disabled, confirm: action.confirm }));
      }
      if (choices.children.length) node.append(choices);
    }
    const foot = el("div", "today-need-foot");
    if (item.taskId) foot.append(button("Open task", "today-link", () => openTask(item.taskId, { from: ctx.anchor }), { title: "Open this task in a tab" }));
    foot.append(button(postponed ? "Decide now" : "Decide later", "today-link", () => later(item.key, !postponed), { title: postponed ? "Put it back where it was" : "Put it last for now; it still needs you" }));
    node.append(foot);
    if (state.errors.has(item.key)) { const note = el("p", "today-need-note", state.errors.get(item.key)); note.setAttribute("role", "alert"); node.append(note); }
    return node;
  }

  // Put the nodes of a list in order, keeping the ones whose signature is unchanged (focus, a typed answer and
  // scroll stay where they were) and rebuilding only what moved on. A rebuilt card that held the focus hands it
  // to its successor (the answer box keeps its caret, anything else lands on the card), and a card that left
  // hands it to the list, so the keyboard never falls out to the page.
  function reconcile(host, entries) {
    const cache = state.painted.get(host) || new Map();
    state.painted.set(host, cache);
    const held = document.activeElement && host.contains?.(document.activeElement) ? document.activeElement : null;
    let successor = null;
    const wanted = [];
    for (const entry of entries) {
      const hit = cache.get(entry.key);
      if (hit && hit.sig === entry.sig) { wanted.push(hit.node); continue; }
      const node = entry.build();
      if (hit?.node?.parentNode === host) {
        if (held && hit.node.contains?.(held)) successor = { node, field: /^input$/i.test(held.tagName || "") };
        host.insertBefore(node, hit.node); hit.node.remove();
      }
      cache.set(entry.key, { node, sig: entry.sig });
      wanted.push(node);
    }
    const keys = new Set(entries.map((entry) => entry.key));
    for (const [key, hit] of cache) if (!keys.has(key)) { hit.node.remove(); cache.delete(key); }
    const now = host.children;
    if (now.length !== wanted.length || wanted.some((node, index) => now[index] !== node)) host.replaceChildren(...wanted);
    if (held && successor && !host.contains?.(held)) {
      const field = successor.field ? successor.node.querySelector?.("input") : null;
      const target = field || successor.node;
      try { target.focus?.({ preventScroll: true }); if (field) field.setSelectionRange?.(field.value.length, field.value.length); } catch { /* not focusable */ }
    }
  }
  const itemSignature = (item, ctx, now) => JSON.stringify([item.key, item.title, item.label, item.who, item.facts, item.from, item.detail, item.hint, item.options.map((option) => [option.id, option.label, option.recommended]), item.at ? Math.floor(now / 60000) : 0, item.handled ? [item.handled.label, Boolean(item.handled.undo)] : 0,
    state.busy.has(item.key), state.errors.get(item.key) ?? null, state.later.has(item.key), ctx.compact ? 1 : 0, (state.data || {}).projectId ?? null, window.MefiAutonomy?.state?.()?.level ?? null]);
  function orderItems(list) { return [...list.filter((item) => !state.later.has(item.key)), ...list.filter((item) => state.later.has(item.key))]; }

  // ---- the Inbox popover --------------------------------------------------------------------------
  function decisions() {
    const view = window.MefiAutonomy?.state?.() || null;
    if (!view || (view.projectId && (state.data || {}).projectId && view.projectId !== state.data.projectId)) return [];
    return (Array.isArray(view.decisions) ? view.decisions : []).filter((row) => row && !row.undone && !row.failed && !row.pending);
  }
  function placePopover(node, anchor) {
    const area = window.MefiNav?.usable?.() || { left: 0, top: 0, right: window.innerWidth || 1000, bottom: window.innerHeight || 700 };
    const width = Math.min(452, Math.max(240, area.right - area.left - 24));
    node.style.width = `${width}px`;
    const box = anchor?.getBoundingClientRect?.();
    const anchored = Boolean(box && box.width > 0 && box.height > 0);
    let left = anchored ? box.right - width : area.right - width - 12;
    left = Math.max(area.left + 12, Math.min(left, area.right - width - 12));
    node.style.left = `${Math.round(left)}px`;
    // Under its pill, which lives in the top bar (above the free area) as often as inside it; with no pill, at the free
    // area's top right. A pill low in the window (the status bar's "waiting on you") opens it upward, so it is never pushed off the bottom.
    const floor = area.bottom - 12;
    const below = anchored ? box.bottom + 8 : area.top + 8;
    const ceiling = Math.max(area.top, 8);
    if (anchored && floor - below < 260 && box.top - 8 - ceiling > floor - below) {
      node.style.top = ""; node.style.bottom = `${Math.round(Math.max(0, (window.innerHeight || area.bottom) - box.top + 8))}px`;
      node.style.maxHeight = `${Math.max(160, Math.round(box.top - 8 - ceiling))}px`;
      node.dataset.side = "above";
      return;
    }
    const top = Math.max(anchored ? 8 : area.top + 8, Math.min(below, floor - 140));
    node.style.top = `${Math.round(top)}px`; node.style.bottom = "";
    node.style.maxHeight = `${Math.max(160, Math.round(floor - top))}px`;
    node.dataset.side = "below";
  }
  function inboxParts() {
    let node = state.inbox.node;
    if (node) return node;
    node = el("div", "today-inbox"); node.id = "today-inbox"; node.hidden = true; node.tabIndex = -1;
    node.setAttribute("role", "dialog"); node.setAttribute("aria-label", "Inbox"); node.setAttribute("aria-modal", "false");
    const head = el("header", "today-inbox-head");
    const title = el("span", "today-inbox-title"); title.append(glyph("g-bell"), el("b", "", "Inbox"), el("span", "today-inbox-count", ""));
    const pageLink = button("Open as a tab", "today-link", () => { closeInbox({ restore: false }); openInboxPage(); }, { title: "Keep the Inbox open as a page" });
    pageLink.dataset.act = "page";
    const keys = el("span", "today-inbox-keys");
    keys.append(el("kbd", "today-key", "J"), el("kbd", "today-key", "K"), document.createTextNode(" move "), el("kbd", "today-key", "Enter"), document.createTextNode(" open "), el("kbd", "today-key", "Esc"));
    head.append(title, pageLink, keys);
    const body = el("div", "today-inbox-body"); body.setAttribute("role", "list");
    const empty = el("div", "today-empty"); empty.append(el("b", "", "All clear"), el("span", "", "Questions, permissions, approvals and failures land here, in one place."));
    const foot = el("footer", "today-inbox-foot");
    node.append(head, body, empty, foot);
    node.addEventListener("keydown", inboxKeys);
    document.body.append(node);
    state.inbox.node = node;
    return node;
  }
  // "Mefi decided": the newest decision Mefi made for you, with the Undo the app offers for it.
  function paintDecided(foot) {
    const rows = decisions();
    foot.replaceChildren();
    foot.hidden = !rows.length;
    if (!rows.length) return;
    const last = rows[rows.length - 1];
    const words = el("span", "today-inbox-decided"); words.append(el("b", "", "Mefi decided"), document.createTextNode(` · ${clip(last.label || last.choice, 40)}`));
    foot.append(words);
    if (last.undoPending) foot.append(el("small", "", "Undo waits for the worker"));
    else foot.append(button("Undo", "today-link", async () => {
      const result = await api()?.autonomyUndo?.({ id: last.id, projectId: (state.data || {}).projectId });
      if (result?.ok === false) window.MefiToast?.(say(result, "That could not be undone."), "warn");
      void window.MefiAutonomy?.refresh?.();
      paint();
    }, { title: "Put it back as it was" }));
    foot.append(button(`All ${rows.length}`, "today-link", () => { closeInbox({ restore: false }); openInboxPage(); }, { title: "Everything Mefi decided for you" }));
  }
  function paintInbox() {
    const node = state.inbox.node;
    if (!node || node.hidden) return;
    const now = Date.now();
    const list = orderItems(model().items);
    const open = list.filter((item) => !item.handled).length;
    const [head, body, empty, foot] = [node.querySelector(".today-inbox-head"), node.querySelector(".today-inbox-body"), node.querySelector(".today-empty"), node.querySelector(".today-inbox-foot")];
    head.querySelector(".today-inbox-count").textContent = open ? String(open) : "";
    reconcile(body, list.map((item) => ({ key: item.key, sig: itemSignature(item, { compact: true }, now), build: () => renderNeed(item, { compact: true, anchor: state.inbox.anchor }) })));
    empty.hidden = list.length > 0;
    body.hidden = list.length === 0;
    paintDecided(foot);
    state.inbox.index = Math.max(0, Math.min(state.inbox.index, Math.max(0, list.length - 1)));
    markCurrent(body, list);
    placePopover(node, state.inbox.anchor);
  }
  function markCurrent(body, list) {
    const cards = [...body.children];
    cards.forEach((card, index) => { card.classList.toggle("is-current", index === state.inbox.index); });
    if (list.length === 0) return;
  }
  function openInbox(anchor = null, { focus = null } = {}) {
    if (!state.on) return false;
    const skip = state.inbox.skip;
    // The click that follows a press which just closed it (the pill is a toggle): handled, and nothing to do. It answers
    // true, not false, so a caller that falls back to something else on false (the pill's own chain) does not.
    if (skip) { state.inbox.skip = null; if (anchor && anchor === skip.anchor && Date.now() < skip.until) return true; }
    const node = inboxParts();
    closeInboxPage();
    state.inbox.anchor = anchor || state.anchor || null;
    if (anchor) state.anchor = anchor;
    if (!state.inbox.open) state.inbox.opener = document.activeElement || null;
    state.inbox.open = true;
    node.hidden = false;
    anchor?.setAttribute?.("aria-expanded", "true");
    anchor?.setAttribute?.("aria-controls", "today-inbox");
    const list = orderItems(model().items);
    state.inbox.index = focus ? Math.max(0, list.findIndex((item) => item.key === focus)) : 0;
    paintInbox();
    window.addEventListener("resize", onResize);
    document.addEventListener("pointerdown", outside, true);
    startClock();
    // Focus goes to the item asked for, else the first thing to do, else the box itself.
    const target = node.querySelector(".today-need.is-current");
    const first = target?.querySelector?.("button:not(:disabled), input") || node.querySelector("button");
    (first || node).focus?.({ preventScroll: true });
    return true;
  }
  function closeInbox({ restore = true } = {}) {
    const node = state.inbox.node;
    if (!node || !state.inbox.open) return false;
    state.inbox.open = false;
    node.hidden = true;
    state.inbox.anchor?.setAttribute?.("aria-expanded", "false");
    window.removeEventListener("resize", onResize);
    document.removeEventListener("pointerdown", outside, true);
    const back = state.inbox.opener;
    state.inbox.opener = null;
    if (restore && back && back.isConnected !== false) { try { back.focus?.({ preventScroll: true }); } catch { /* the opener went away */ } }
    stopClockIfIdle();
    return true;
  }
  const inboxIsOpen = () => Boolean(state.inbox.open);
  // True while the keyboard is inside the popover: Vibe's own one-key shortcuts (renderer/vibe.js vibeKeysOpen) wait then, as they do in its drawers.
  const ownsKeys = () => Boolean(state.on && state.inbox.open && state.inbox.node && document.activeElement && state.inbox.node.contains?.(document.activeElement));
  function toggleInbox(anchor = null) {
    if (inboxIsOpen()) { closeInbox(); return false; }
    return openInbox(anchor);
  }
  function onResize() { if (state.inbox.open) placePopover(state.inbox.node, state.inbox.anchor); }
  // The layout changed (a region opened or closed, a window fold) or was switched off live: back to v1 gives the front door back at once.
  function onLayout() { if (!v2()) { stop(); return; } onResize(); }
  // A press anywhere else closes it, as every popover does. A press on the thing that opened it closes it too, and
  // the click that follows does not open it again: the pill is a toggle whoever wires it.
  function outside(event) {
    const node = state.inbox.node;
    if (!node || !state.inbox.open || node.contains?.(event.target)) return;
    const anchor = state.inbox.anchor;
    if (anchor?.contains?.(event.target)) { state.inbox.skip = { anchor, until: Date.now() + 600 }; closeInbox({ restore: false }); return; }
    closeInbox({ restore: false });
  }
  const typing = (target) => Boolean(target?.closest?.("input, textarea, select, [contenteditable]"));
  function inboxKeys(event) {
    const node = state.inbox.node;
    if (event.key === "Escape") { event.preventDefault?.(); event.stopPropagation?.(); closeInbox(); return; }
    if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    // A letter or a digit typed in here is for here: Studio's one-key shortcuts (2 is a place, T a panel) stay out of it.
    if (String(event.key || "").length === 1 && event.key !== " ") { event.preventDefault?.(); event.stopPropagation?.(); }
    const body = node.querySelector(".today-inbox-body");
    const cards = [...body.children];
    const step = (by) => {
      if (!cards.length) return;
      state.inbox.index = Math.max(0, Math.min(cards.length - 1, state.inbox.index + by));
      markCurrent(body, cards);
      const card = cards[state.inbox.index];
      card.scrollIntoView?.({ block: "nearest" });
      card.focus?.({ preventScroll: true });
    };
    const key = String(event.key || "").toLowerCase();
    if (key === "j" || key === "arrowdown") { event.preventDefault?.(); step(1); return; }
    if (key === "k" || key === "arrowup") { event.preventDefault?.(); step(-1); return; }
    const list = orderItems(model().items);
    const item = list[state.inbox.index];
    if (!item || item.handled) return;
    if (key === "enter" && event.target === cards[state.inbox.index] && item.taskId) { event.preventDefault?.(); openTask(item.taskId, { from: state.inbox.anchor }); return; }
    if (/^[1-9]$/.test(key) && item.options[Number(key) - 1] && !item.options[Number(key) - 1].text) { event.preventDefault?.(); void answer(item, { optionId: item.options[Number(key) - 1].id }); }
  }

  // ---- the Inbox page (a registry route) ----------------------------------------------------------
  function paintInboxPage() {
    const overlay = byId("inbox-overlay");
    if (!overlay || overlay.hidden) return;
    const now = Date.now();
    const list = orderItems(model().items);
    const open = list.filter((item) => !item.handled).length;
    // The prototype's words for the page, and how many wait, said for a screen reader (the tab and the pill show the number).
    const lead = byId("inbox-lead");
    if (lead) {
      const said = open ? `${plural(open, "thing")} ${open === 1 ? "waits" : "wait"} on you.` : "Nothing is waiting on you.";
      if (lead.dataset.said !== said) {
        lead.dataset.said = said;
        lead.replaceChildren(document.createTextNode("Everything waiting on you in one place: questions, permissions, approvals, reviews and tasks that stopped. Ctrl J opens the same list from anywhere. "), el("span", "inbox-count", said));
      }
    }
    const holder = byId("inbox-list");
    if (holder) {
      reconcile(holder, list.map((item) => ({ key: item.key, sig: itemSignature(item, { compact: false }, now), build: () => renderNeed(item, { compact: false }) })));
      holder.hidden = list.length === 0;
    }
    const empty = byId("inbox-empty");
    if (empty) empty.hidden = list.length > 0;
    const decided = byId("inbox-decided");
    if (decided && window.MefiAutonomy?.history) {
      const signature = JSON.stringify(decisions().map((row) => [row.id, row.undone, row.undoPending]));
      if (decided.dataset.signature !== signature) { decided.dataset.signature = signature; window.MefiAutonomy.history(decided, { ...window.MefiAutonomy.state?.(), projectId: (state.data || {}).projectId }); }
    }
  }
  let pageWired = false;
  function wirePages() {
    if (pageWired) return;
    pageWired = true;
    byId("inbox-close")?.addEventListener("click", () => window.MefiNav?.close?.("inbox") ?? closeInboxPage());
    byId("today-close")?.addEventListener("click", () => window.MefiNav?.close?.("today") ?? closeTodayPage());
  }
  function openInboxPage(params = {}) {
    if (!state.on || !byId("inbox-overlay")) return false;
    wirePages();
    closeInbox({ restore: false });
    window.MefiNav?.claim?.("inbox");
    byId("inbox-overlay").hidden = false;
    state.pageOpen = "inbox";
    startClock();
    paintInboxPage();
    if (params?.focus !== false) requestAnimationFrame?.(() => (byId("inbox-overlay").querySelector(".today-need button:not(:disabled), .today-need input") || byId("inbox-close"))?.focus?.({ preventScroll: true }));
    return true;
  }
  function closeInboxPage() {
    const overlay = byId("inbox-overlay");
    if (!overlay || overlay.hidden) return false;
    overlay.hidden = true;
    if (state.pageOpen === "inbox") state.pageOpen = null;
    window.MefiNav?.release?.("inbox");
    stopClockIfIdle();
    return true;
  }

  // ---- Today: the board ------------------------------------------------------------------------------
  function renderCard(card, detail) {
    if (card.decided) return renderDecided(card.item, card.item.handled, card.key);
    if (card.item && !card.review) return renderBoardNeed(card, detail);
    const node = el("article", `today-card is-${card.tone}`);
    node.dataset.key = card.key;
    const head = el("div", "today-card-head");
    head.append(el("i", "today-dot"));
    const open = el("button", "today-card-open");
    open.type = "button";
    open.append(el("span", "today-card-title", card.title));
    open.title = card.title;
    open.setAttribute("aria-label", `${card.title}, ${card.meta || card.group}`);
    // A result to review opens on what it changed (its session's Changes tab); anything else opens its session, a plan its page.
    open.addEventListener("click", () => { if (card.planId) openPlan(card.planId); else if (card.review && !card.checking && card.taskId) openChanges(card.taskId); else if (card.taskId) openTask(card.taskId); });
    if (!card.planId && !card.taskId) open.disabled = true;
    head.append(open);
    if (card.worktree) { const mark = el("span", "today-wt"); mark.title = "Runs in its own worktree"; mark.append(glyph("g-worktree")); head.append(mark); }
    node.append(head);
    if (detail !== "titles") {
      if (card.meta) node.append(el("div", "today-card-meta", card.meta));
      if (card.progress != null) { const bar = el("div", "today-bar"); bar.setAttribute("aria-hidden", "true"); const fill = el("i"); fill.style.width = `${Math.round(card.progress * 100)}%`; bar.append(fill); node.append(bar); }
      else if (card.group === "running" && card.tone === "live") { const bar = el("div", "today-bar is-flowing"); bar.setAttribute("aria-hidden", "true"); bar.append(el("i")); node.append(bar); }
    }
    if (detail === "all") for (const line of card.more) node.append(el("div", "today-card-more", line));
    return node;
  }
  // A need on the board answers in place: its first two options, or the app's first two actions for it, and More, which opens the Inbox on it.
  function renderBoardNeed(card, detail) {
    const item = card.item;
    const node = el("article", `today-card is-need${state.busy.has(item.key) ? " is-busy" : ""}`);
    node.dataset.key = card.key; node.dataset.kind = item.kind; node.dataset.tone = item.tone;
    const head = el("div", "today-card-head");
    head.append(el("i", "today-dot"));
    const open = el("button", "today-card-open");
    open.type = "button";
    open.append(el("span", "today-card-title", card.title));
    open.title = card.title;
    open.setAttribute("aria-label", `${card.title}, ${item.label}`);
    open.addEventListener("click", () => { if (item.taskId) openTask(item.taskId); else openInbox(state.anchor, { focus: item.key }); });
    head.append(open);
    node.append(head);
    if (detail !== "titles") {
      node.append(el("div", "today-card-meta", card.meta));
      if (card.q) node.append(el("p", "today-card-q", card.q));
      const row = el("div", "today-card-quick");
      const busy = state.busy.has(item.key);
      if (card.quick && card.quick.length) {
        card.quick.forEach((option, index) => {
          const choose = el("button", `today-btn${index === 0 ? " primary" : ""}`, option.label);
          choose.type = "button"; choose.dataset.option = option.id; choose.disabled = busy; choose.title = option.label;
          choose.addEventListener("click", () => void answer(item, { optionId: option.id }));
          row.append(choose);
        });
      } else if (card.acts && card.acts.length) {
        const live = actionsOf(item, state.data || {});
        for (const shown of card.acts) {
          const action = live.find((entry) => entry.id === shown.id);
          if (!action) continue;
          const run = typeof action.go === "function" ? () => action.go() : () => void perform(item, action);
          const act = button(action.label, `today-btn${action.primary ? " primary" : ""}`, run, { title: action.title, disabled: busy || action.disabled, confirm: action.confirm });
          act.dataset.action = action.id;
          row.append(act);
        }
      } else {
        row.append(button("Answer", "today-btn primary", () => openInbox(state.anchor, { focus: item.key }), { title: "Answer it in the Inbox", disabled: busy }));
      }
      row.append(button("More", "today-link", () => openInbox(state.anchor, { focus: item.key }), { title: "See everything about it in the Inbox, and answer in your own words" }));
      node.append(row);
      if (state.errors.has(item.key)) { const note = el("p", "today-need-note", state.errors.get(item.key)); note.setAttribute("role", "alert"); node.append(note); }
    }
    if (detail === "all") for (const line of card.more) node.append(el("div", "today-card-more", line));
    return node;
  }
  // The prototype's four columns (Done holds what finished today), each with its own words when it is empty.
  const GROUPS = [["needs", "Needs you"], ["running", "Running"], ["review", "Review"], ["done", "Done"]];
  const GROUP_EMPTY = { needs: "Nothing is waiting on you.", running: "Nothing is running.", review: "Nothing to review.", done: "Nothing finished yet today." };
  // What a card says, time included (its meta carries "4 min"), so it is rebuilt exactly when something it shows has changed.
  const cardSignature = (card, detail) => JSON.stringify([card.key, card.title, card.meta, card.q ?? null, card.acts ?? null, card.progress ?? null, card.worktree ?? false, card.quick?.map((option) => option.id) ?? null, card.item ? state.busy.has(card.item.key) : 0,
    card.item ? state.errors.get(card.item.key) ?? null : null, card.decided ? [card.item.handled.label, Boolean(card.item.handled.undo)] : 0, detail, card.more]);
  // The four groups stay put as nodes (all four while a project is open, each saying so when it is empty, as the prototype's board);
  // their cards are kept or rebuilt one by one, so a push that changes one card leaves the others, and any answer being typed, alone.
  function paintBoard(holder, current, detail) {
    const now = Date.now();
    const groups = holder.querySelector?.(".today-groups") || holder;
    const shown = current.projectId ? GROUPS : [];
    holder.dataset.groups = String(shown.length);
    reconcile(groups, shown.map(([key, label]) => ({
      key, sig: `${key}|${label}`,
      build: () => {
        const group = el("section", "today-group");
        group.dataset.group = key; group.setAttribute("aria-label", label);
        const heading = el("h3", "", label); heading.append(el("span", "today-count", ""));
        const empty = el("p", "today-col-empty", GROUP_EMPTY[key]); empty.hidden = true;
        group.append(heading, el("div", "today-cards"), empty);
        return group;
      },
    })));
    for (const group of [...groups.children]) {
      const key = group.dataset?.group;
      if (!key || !current.board[key]) continue;
      const cards = current.board[key];
      const count = group.querySelector(".today-count");
      const open = cards.filter((card) => !card.decided).length;
      if (count && count.textContent !== String(open)) count.textContent = String(open);
      const list = group.querySelector(".today-cards");
      reconcile(list, cards.map((card) => ({ key: card.key, sig: cardSignature(card, detail), build: () => renderCard(card, detail) })));
      const empty = group.querySelector(".today-col-empty");
      if (empty && empty.hidden !== (cards.length > 0)) empty.hidden = cards.length > 0;
      if (key === "done") {
        let more = group.querySelector(".today-more");
        if (current.board.doneMore && !more) { more = button("", "today-link today-more", () => window.MefiNav?.go?.("tasks", { filter: "done" }), { title: "All finished work" }); group.append(more); }
        if (more) { more.hidden = !current.board.doneMore; more.textContent = `${current.board.doneMore} more`; }
      }
    }
    const feed = holder.querySelector?.(".today-latest");
    if (feed) {
      const notes = detail === "titles" ? [] : current.board.latest;
      feed.hidden = notes.length === 0;
      reconcile(feed.querySelector(".today-latest-rows") || feed, notes.map((note) => ({ key: note.key, sig: `${note.text}|${Math.floor(now / 60000)}`, build: () => { const row = el("li", "today-latest-row"); row.append(el("i", "today-dot"), el("span", "", note.text), el("time", "", ago(note.at, now))); return row; } })));
    }
  }

  // The chips beside the greeting. They are made once and updated in place, so the one that opens the Inbox is
  // the same node from one push to the next (the popover is anchored to it).
  function chip(holder, key, tag) {
    let node = [...holder.children].find((child) => child.dataset?.chip === key);
    if (node) return node;
    node = tag === "button" ? button("", `today-chip is-${key}`, () => openInbox(node), { title: "Open the Inbox" }) : el("span", `today-chip is-${key}`);
    node.dataset.chip = key;
    if (tag === "button") { node.setAttribute("aria-haspopup", "dialog"); node.dataset.act = "inbox"; }
    node.append(el("i"), el("span", "today-chip-text", ""));
    holder.append(node);
    return node;
  }
  function paintSummary(holder, current) {
    const needs = current.count, running = current.board.running.filter((card) => card.tone === "live").length, review = current.board.review.filter((card) => !card.decided).length;
    const set = (key, tag, words, on) => {
      const node = chip(holder, key, tag);
      node.hidden = !on;
      const text = node.querySelector(".today-chip-text");
      if (on && text.textContent !== words) text.textContent = words;
    };
    set("need", "button", `${needs} ${needs === 1 ? "needs" : "need"} you`, needs > 0);
    set("clear", "span", "All clear", needs === 0);
    set("run", "span", `${running} running`, running > 0);
    set("rev", "span", `${review} to review`, review > 0);
  }

  // Everything Today shows, on whichever host is up: the front door's own page, and the Today page Build opens.
  const HOSTS = [
    { id: "vibe", summary: "today-summary", quiet: "today-quiet", board: "today-board", up: () => state.host === "vibe", none: "Pick a project to begin: choose one from the project name above." },
    { id: "page", summary: "today-overlay-summary", quiet: "today-overlay-quiet", board: "today-overlay-board", up: () => byId("today-overlay")?.hidden === false, none: "Pick a project to begin: choose one from the project menu." },
  ];
  function paintToday() {
    const current = model();
    const detail = detailLevel();
    for (const host of HOSTS) {
      if (!host.up()) continue;
      const board = byId(host.board);
      if (!board) continue;
      const summary = byId(host.summary), quiet = byId(host.quiet);
      if (summary) paintSummary(summary, current);
      // With a project open the four columns say what is empty; without one, this line says what to do.
      if (quiet) {
        const hasProject = Boolean(current.projectId);
        quiet.hidden = hasProject;
        quiet.textContent = hasProject ? "" : host.none;
      }
      paintBoard(board, current, detail);
    }
    if (homeShowing()) paintHome(current);
  }

  // ---- hosts ------------------------------------------------------------------------------------------------
  // Vibe's own layer is the host of the Home page: its backdrop, its drawers (the conversation, panels) and its keys stay.
  // The line that says the keys (#vibe-hint, from the box's own row) goes right under the box, as the prototype's.
  const MOVED = ["vibe-compose", "vibe-hint", "vibe-flow", "vibe-feedback", "vibe-sparks", "vibe-decisions", "vibe-gate", "vibe-last"];
  function ensurePage(layer) {
    let today = byId("today-page");
    if (today) return today;
    today = el("section", "today"); today.id = "today-page"; today.setAttribute("aria-label", "Today");
    // A scroller takes the keyboard in Chromium; its controls should be what Tab walks. It still scrolls by PageUp and PageDown once clicked.
    const scroll = el("div", "today-scroll"); scroll.id = "today-scroll"; scroll.tabIndex = -1;
    const column = el("div", "today-col");
    const row = el("div", "today-top");
    const summary = el("div", "today-summary"); summary.id = "today-summary"; summary.setAttribute("role", "group"); summary.setAttribute("aria-label", "What is happening");
    const slot = el("div", "today-box");
    const quiet = el("p", "today-quiet"); quiet.id = "today-quiet"; quiet.hidden = true; quiet.setAttribute("role", "status");
    const board = el("div", "today-board"); board.id = "today-board";
    const groups = el("div", "today-groups");
    const latest = el("section", "today-latest"); latest.hidden = true; latest.setAttribute("aria-label", "Latest");
    const latestRows = el("ul", "today-latest-rows");
    latest.append(el("h3", "", "Latest"), latestRows);
    board.append(groups, latest);
    column.append(row, slot, quiet, board);
    scroll.append(column); today.append(scroll);
    // Under the front door's own top bar, which stays (the project, New app, the conversation, Settings, an update waiting), so Tab reads the page
    // top to bottom; its stage and dock step aside (today.css). The sky is out of flow behind everything.
    const stage = layer.querySelector?.(".vibe-stage");
    if (stage && layer.insertBefore) layer.insertBefore(today, stage); else layer.append(today);
    // Borrow the front door's pieces. Each goes back where it was (restore) when Today stops.
    const place = (node, into) => {
      if (!node) return;
      (state.parts ||= []).push({ node, parent: node.parentNode, next: node.nextSibling ?? null });
      node.remove?.();
      into.append(node);
    };
    const hero = layer.querySelector(".vibe-hero");
    place(hero, row);
    row.append(summary);
    for (const id of MOVED) place(byId(id), slot);
    for (const chip of slot.querySelectorAll?.(".vibe-evolution-intent") ?? []) { const hint = chip.querySelector?.("small")?.textContent; if (hint && !chip.title) chip.title = hint; }
    // Build it says its key inside the button (the prototype's "Build it  Ctrl Enter"); restore() takes it out again.
    const build = byId("vibe-build");
    if (build && !build.querySelector?.(".today-key")) {
      const key = el("kbd", "today-key", "Ctrl Enter"); key.setAttribute("aria-hidden", "true");
      build.append(key); build.setAttribute("aria-keyshortcuts", "Control+Enter");
      (state.added ||= []).push(() => { key.remove?.(); build.removeAttribute?.("aria-keyshortcuts"); });
    }
    return today;
  }
  function show() {
    if (!state.on) return false;
    const layer = byId("vibe-layer");
    if (!layer) return false;
    ensurePage(layer);
    state.host = "vibe";
    if (layer.dataset) layer.dataset.today = "on";
    paint(); startClock();
    return true;
  }
  function hide() {
    if (state.host !== "vibe") return;
    state.host = null;
    closeInbox({ restore: false });
    stopClockIfIdle();
  }
  // Puts the borrowed pieces back and takes the page away: v1's front door as it was.
  function restore() {
    const layer = byId("vibe-layer");
    for (const { node, parent, next } of [...(state.parts || [])].reverse()) { if (parent) parent.insertBefore(node, next && next.parentNode === parent ? next : null); }
    state.parts = null;
    for (const undo of (state.added || []).splice(0)) { try { undo(); } catch { /* already gone */ } }
    byId("today-page")?.remove();
    if (layer?.dataset) delete layer.dataset.today;
    state.host = null;
  }

  // The Build host: the same board as a page, opened from its pinned tab or Search.
  function openTodayPage(params = {}) {
    if (!state.on || !byId("today-overlay")) return false;
    wirePages();
    window.MefiNav?.claim?.("today");
    byId("today-overlay").hidden = false;
    state.pageOpen = "today";
    startClock();
    paint();
    if (params?.focus !== false) requestAnimationFrame?.(() => byId("today-close")?.focus?.({ preventScroll: true }));
    return true;
  }
  function closeTodayPage() {
    const overlay = byId("today-overlay");
    if (!overlay || overlay.hidden) return false;
    overlay.hidden = true;
    if (state.pageOpen === "today") state.pageOpen = null;
    window.MefiNav?.release?.("today");
    stopClockIfIdle();
    return true;
  }

  // ---- Build's Home: Today, as the 0.5 prototype draws it ----------------------------------------------------------------
  // In Build (layout v2), Home with no session open is Today: the greeting and the question, Build's own message box with
  // Add files or an image, the permission mode, Talk it over and Build it (Ctrl Enter), the four ways to start and Suggest a
  // next step, then the first thing that needs you, what is running now and what finished. The box is workspace.js's form,
  // borrowed while Today shows and given back when it goes, so its drafts, its pictures, its @ # / picker and every host
  // call stay Home's: Talk it over sends the words as a chat (assistant:message) and Build it as a new task (tasks:create).
  // The classic Home (its conversation, the queue, Activity and the preview, More) is the same route with view "chat",
  // the page Talk it over and "Open the conversation" open; the tab strip names it Chat. With a session open the thread
  // covers Home as before (renderer/sessions.js), and Vibe keeps its own Today (show() above).
  const HOME_PLACEHOLDER = "Describe an idea, a fix or a question…";
  const HOME_STARTS = ["modify", "experiment", "fix", "improve"];
  const STARTERS = { modify: { label: "Modify", starter: "Change this project so that " }, experiment: { label: "Experiment", starter: "Try a small experiment: " }, fix: { label: "Fix", starter: "Something is broken: " }, improve: { label: "Improve", starter: "Improve this project by " } };
  const building = () => vibe()?.mode?.() !== "vibe" && page()?.dataset?.uiMode !== "vibe";
  const homeInput = () => byId("workspace-input");
  // The starters are Vibe's own (MefiVibe.intents()), so the two boxes start the same way; these words are only for a page without it.
  const starters = () => { const given = vibe()?.intents?.(); return given && typeof given === "object" && Object.keys(given).length ? given : STARTERS; };
  function homeWanted() {
    const layer = byId("workspace-layer");
    return Boolean(state.on && v2() && layer && !layer.hidden && building() && state.homeView !== "chat");
  }
  // workspace.js calls this when Home comes and goes, and the navigation when the route's view changes.
  function syncHome() {
    if (homeWanted()) mountHome(); else unmountHome();
    return state.home.on;
  }
  function homeParts(layer) {
    if (state.home.node) return state.home.node;
    const node = el("section", "today today-b"); node.id = "today-build"; node.setAttribute("aria-label", "Today"); node.hidden = true;
    const scroll = el("div", "today-scroll today-b-scroll"); scroll.id = "today-build-scroll"; scroll.tabIndex = -1;
    const column = el("div", "today-b-col");
    // A div, not a header: the app's own header rule (a flex row with a rule under it) is for page heads.
    const hero = el("div", "today-b-hero");
    const orb = el("i", "today-b-orb"); orb.setAttribute("aria-hidden", "true");
    const kicker = el("p", "today-b-kicker"); kicker.id = "today-build-kicker";
    const title = el("h1", "today-b-title"); title.id = "today-build-title";
    hero.append(orb, kicker, title);
    const box = el("div", "today-b-box"); box.id = "today-build-box";
    const note = el("p", "today-b-note"); note.id = "today-build-note"; note.setAttribute("role", "status"); note.hidden = true;
    const hint = el("p", "today-b-hint"); hint.id = "today-build-hint";
    hint.textContent = "Enter to talk it over · Shift Enter for a new line · Ctrl Enter to build";
    const starts = el("div", "today-b-starts"); starts.id = "today-build-starts"; starts.setAttribute("role", "group"); starts.setAttribute("aria-label", "Ways to start");
    for (const id of HOME_STARTS) {
      const chip = button(starters()[id]?.label || STARTERS[id].label, "today-b-chip", () => homeStart(id), { title: starters()[id]?.hint || "" });
      chip.dataset.start = id; chip.setAttribute("aria-pressed", "false");
      starts.append(chip);
    }
    const suggest = button("", "today-b-chip is-suggest", () => void homeSuggest(), { title: "Mefi reads the project and suggests a few small next steps" });
    suggest.id = "today-build-suggest"; suggest.dataset.start = "suggest";
    suggest.append(glyph("g-spark"), el("span", "", "Suggest a next step"));
    starts.append(suggest);
    const ideas = el("section", "today-b-sugs"); ideas.id = "today-build-suggestions"; ideas.setAttribute("aria-label", "Suggested next steps"); ideas.hidden = true;
    const needs = el("section", "today-b-sect"); needs.setAttribute("aria-labelledby", "today-build-needs-title");
    const needsTitle = el("h3", "today-b-h is-need", "Needs you"); needsTitle.id = "today-build-needs-title";
    const needHolder = el("div", "today-b-need"); needHolder.id = "today-build-need";
    needs.append(needsTitle, needHolder);
    const two = el("div", "today-b-two");
    const half = (id, words) => {
      const part = el("section", "today-b-half"); part.setAttribute("aria-labelledby", `${id}-title`);
      const head = el("h3", "today-b-h", words); head.id = `${id}-title`;
      const card = el("div", "today-b-card"); card.id = id; card.setAttribute("role", "list");
      part.append(head, card);
      return { part, card };
    };
    const running = half("today-build-running", "Running now"), finished = half("today-build-finished", "Finished while you were away");
    two.append(running.part, finished.part);
    column.append(hero, box, note, hint, starts, ideas, needs, two);
    scroll.append(column); node.append(scroll);
    // First in the layer, before the classic page it stands in for (which steps aside while it shows, today.css).
    const first = layer.children?.[0] ?? layer.firstChild ?? null;
    if (first && layer.insertBefore) layer.insertBefore(node, first); else layer.append(node);
    state.home.node = node;
    state.home.parts = { scroll, kicker, title, box, note, hint, starts, suggest, ideas, needHolder, running: running.card, finished: finished.card };
    return node;
  }
  // The row of controls the prototype puts under the words. Made once and moved in with the box, so the permission mode's own
  // control (renderer/autonomy-ui.js) is mounted once.
  function homeTools() {
    if (state.home.tools) return state.home.tools;
    const tools = el("div", "today-b-tools"); tools.id = "today-build-tools";
    const picker = el("input"); picker.type = "file"; picker.multiple = true; picker.hidden = true; picker.id = "today-build-files";
    picker.addEventListener("change", () => { const files = Array.from(picker.files || []); picker.value = ""; void homeFiles(files); });
    const attach = button("", "today-b-cc", () => { if (!attach.disabled) picker.click?.(); }, { title: "Add text or code files to the words, or a picture (PNG, JPEG, WebP or GIF) to send with them. You can also paste or drop them into the box." });
    attach.id = "today-build-attach";
    const attachWords = el("span", "", "Add files or an image");
    attach.append(glyph("g-clip"), attachWords);
    const autonomy = el("span", "today-b-autonomy"); autonomy.id = "today-build-autonomy";
    const talk = button("", "today-b-talk", () => void homeSend("chat"), { title: "Talk it over with Mefi first: the words go to the conversation, and its page opens" });
    talk.id = "today-build-talk"; talk.append(glyph("g-chat"), el("span", "", "Talk it over"));
    const build = button("", "today-b-send", () => void homeSend("work"), { title: "Build it: the words become a task, and a worker picks it up" });
    build.id = "today-build-build"; build.append(el("span", "", "Build it"), el("kbd", "today-key", "Ctrl Enter"));
    tools.append(attach, picker, autonomy, talk, build);
    window.MefiAutonomy?.mount?.(autonomy, { id: "today-build-autonomy-control" });
    state.home.tools = tools;
    state.home.toolParts = { attach, attachWords, picker, autonomy, talk, build };
    return tools;
  }
  // Borrow Home's box (and the line that says how a send went) into Today; unmountHome() gives each back where it was.
  function mountHome() {
    const layer = byId("workspace-layer");
    if (!layer) return false;
    const node = homeParts(layer);
    if (state.home.on) { paint(); return true; }
    const form = byId("workspace-form");
    const parts = state.home.parts;
    const lend = (piece, into, before = null) => {
      if (!piece || piece.parentNode === into) return;
      state.home.lent.push({ node: piece, parent: piece.parentNode, next: piece.nextSibling ?? null });
      piece.remove?.();
      if (before) into.insertBefore(piece, before); else into.append(piece);
    };
    if (form) {
      lend(form, parts.box);
      form.append(homeTools());
      const input = homeInput();
      if (input) {
        state.home.placeholder = input.placeholder ?? "";
        input.placeholder = HOME_PLACEHOLDER;
        if (!state.home.keysOn) {
          state.home.keys = homeKeys; state.home.typing = () => paintStarts(); state.home.keysOn = input;
          input.addEventListener("keydown", homeKeys, true);
          input.addEventListener("input", state.home.typing);
        }
      }
    }
    const feedback = byId("workspace-feedback")?.parentNode;
    if (feedback && feedback !== layer && feedback.parentNode) lend(feedback, parts.box.parentNode, parts.note);
    node.hidden = false;
    if (layer.dataset) layer.dataset.today = "on";
    state.home.on = true;
    paint(); startClock();
    return true;
  }
  function unmountHome() {
    if (!state.home.on) return false;
    state.home.on = false;
    const layer = byId("workspace-layer");
    state.home.tools?.remove?.();
    for (const { node, parent, next } of state.home.lent.splice(0).reverse()) {
      if (!parent) continue;
      node.remove?.();
      parent.insertBefore(node, next && next.parentNode === parent ? next : null);
    }
    const input = homeInput();
    if (input && state.home.placeholder !== null) input.placeholder = state.home.placeholder;
    state.home.placeholder = null;
    if (state.home.keysOn) { state.home.keysOn.removeEventListener("keydown", state.home.keys, true); state.home.keysOn.removeEventListener("input", state.home.typing); }
    state.home.keys = null; state.home.typing = null; state.home.keysOn = null;
    if (state.home.node) state.home.node.hidden = true;
    if (layer?.dataset) delete layer.dataset.today;
    stopClockIfIdle();
    return true;
  }
  // Enter talks it over, Ctrl Enter builds it, Shift Enter is a new line; an open suggestion list (the @ # / picker) keeps its own Enter.
  function homeKeys(event) {
    if (!state.home.on || event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing) return;
    if (window.MefiComposerPicker?.get?.(event.target)?.isOpen?.()) return;
    event.preventDefault?.(); event.stopImmediatePropagation?.(); event.stopPropagation?.();
    void homeSend(event.ctrlKey || event.metaKey ? "work" : "chat");
  }
  function homeNote(words) {
    const note = state.home.parts?.note;
    if (!note) return;
    note.textContent = words || "";
    note.hidden = !words;
  }
  // Talk it over and Build it send what is in the box through Home's own send (workspace.js), as a chat or as a task. A chat's
  // reply lands in the conversation, so its page opens; a task stays here, with Home's own "Task added" line and View task.
  async function homeSend(purpose) {
    const input = homeInput();
    const workspace = window.MefiWorkspace;
    if (!input || typeof workspace?.send !== "function") return false;
    const snap = workspace.snapshot?.() || {};
    if (snap.pending) return false;
    if (!snap.projectId) { homeNote("Choose a project first: open one from the project menu."); return false; }
    if (!String(input.value || "").trim()) { homeNote("Describe what you have in mind first."); input.focus?.(); return false; }
    homeNote("");
    const sending = Promise.resolve().then(() => workspace.send(purpose));
    if (purpose === "chat") openChat();
    try { await sending; } catch { /* Home's own line says what went wrong */ }
    paint();
    return true;
  }
  // The classic Home, under Today's own route: the conversation, the queue, Activity and the preview.
  function openChat() {
    const tabs = window.MefiTabs;
    if (typeof tabs?.open === "function") { try { tabs.open("workspace", { view: "chat" }, { preview: true }); return true; } catch { /* the router below */ } }
    window.MefiNav?.go?.("workspace", { view: "chat" });
    return true;
  }
  // A file picked here goes where a dropped one would: a picture to the box's pictures (composer-pictures.js), the rest into the words (file-inputs.js).
  async function homeFiles(files) {
    const input = homeInput();
    if (!input || !files.length) return;
    const pictures = window.MefiComposerPictures?.get?.(input);
    const images = pictures && !homePicturesOff() ? files.filter((file) => String(file?.type || "").startsWith("image/")) : [];
    const rest = files.filter((file) => !images.includes(file));
    if (images.length) await pictures.addFiles(images);
    if (rest.length) await window.MefiFileInputs?.addFiles?.(input, rest);
    paint();
  }
  const homePicturesOff = () => { const row = homeInput()?.parentNode?.querySelector?.(".composer-attach"); return !row || row.hidden === true; };
  // Modify, Experiment, Fix and Improve start the words the way Vibe's box does: an empty box takes the starter, a starter
  // already there is swapped, and words of your own are left as they are.
  function homeStart(id) {
    const input = homeInput();
    const entry = starters()[id];
    if (!input || !entry?.starter) return false;
    const value = String(input.value || "");
    const prior = Object.values(starters()).map((item) => item?.starter).find((starter) => starter && value.startsWith(starter));
    if (!value.trim()) input.value = entry.starter;
    else if (prior) input.value = entry.starter + value.slice(prior.length);
    try { if (typeof Event === "function") input.dispatchEvent?.(new Event("input", { bubbles: true })); } catch { /* the draft is saved on the next keystroke */ }
    input.focus?.();
    try { input.setSelectionRange?.(input.value.length, input.value.length); } catch { /* not a text field */ }
    paintStarts();
    return true;
  }
  function paintStarts() {
    const parts = state.home.parts;
    if (!parts) return;
    const value = String(homeInput()?.value || "");
    for (const chip of parts.starts.children) {
      const id = chip.dataset?.start;
      if (!id || id === "suggest") continue;
      const on = Boolean(starters()[id]?.starter && value.startsWith(starters()[id].starter));
      if (chip.getAttribute("aria-pressed") !== String(on)) chip.setAttribute("aria-pressed", String(on));
    }
  }
  // Suggest a next step: the same look Vibe's box asks for (planning:explore, suggestions only), for the words in this box.
  async function homeSuggest() {
    const ask = state.home.suggest;
    if (ask.loading) return null;
    const data = state.data || vibe()?.data?.() || {};
    const id = data.projectId;
    if (!id || !api()?.planningExplore) { Object.assign(ask, { error: "Choose a project in the desktop app to ask Mefi for suggestions.", result: null }); paintSuggest(); return null; }
    const value = String(homeInput()?.value || "").trim();
    const chosen = HOME_STARTS.find((key) => starters()[key]?.starter && value.startsWith(starters()[key].starter)) || "improve";
    const intent = starters()[chosen] || STARTERS.improve;
    const destination = [value || "Suggest a few small, useful next steps for the existing application in this project.", intent.guide ? `Approach: ${intent.label}. ${intent.guide}` : `Approach: ${intent.label}.`].join("\n\n");
    if (destination.length > 16000) { Object.assign(ask, { error: "Shorten the draft a little before asking for suggestions.", result: null }); paintSuggest(); return null; }
    const request = ++ask.request;
    Object.assign(ask, { loading: true, error: "", result: null });
    paintSuggest();
    let result = null;
    try {
      result = await api().planningExplore({ projectId: id, draft: { title: `${intent.label} this project`, destination, outOfScope: "Suggestions for review only. Do not implement, create tasks, or approve work." }, focus: "destination", intent: "suggest" });
      if (request !== ask.request || ((state.data || {}).projectId ?? id) !== id) return null;
      if (!result?.ok || (result.projectId && result.projectId !== id)) throw new Error(result?.error || "Mefi could not explore this project. Try again.");
      ask.result = (Array.isArray(result.suggestions) ? result.suggestions : []).slice(0, 3).map((row, index) => ({ key: `s${index}`, label: clip(row?.label || "A next step", 90), text: clip(row?.text, 420), reason: clip(row?.reason, 200), used: false }));
    } catch (error) { if (request === ask.request) ask.error = say(error, "Suggestions are unavailable. Try again."); }
    finally { if (request === ask.request) { ask.loading = false; paintSuggest(); } }
    return result;
  }
  function useSuggestion(row) {
    const input = homeInput();
    if (!input || row.used) return false;
    const block = [row.label, row.text].filter(Boolean).join("\n\n");
    const current = String(input.value || "").trimEnd();
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > 16000) { homeNote("This will not fit beside your current draft. Shorten the draft first."); return false; }
    input.value = next;
    row.used = true;
    try { if (typeof Event === "function") input.dispatchEvent?.(new Event("input", { bubbles: true })); } catch { /* saved on the next keystroke */ }
    input.focus?.();
    paintSuggest(); paintStarts();
    return true;
  }
  function paintSuggest() {
    const parts = state.home.parts;
    if (!parts) return;
    const ask = state.home.suggest;
    const label = parts.suggest.querySelector?.("span");
    const words = ask.loading ? "Looking…" : ask.result ? "Suggest again" : "Suggest a next step";
    if (label && label.textContent !== words) label.textContent = words;
    parts.suggest.disabled = ask.loading;
    parts.suggest.setAttribute("aria-busy", String(ask.loading));
    const signature = JSON.stringify([ask.loading, ask.error, ask.result?.map((row) => [row.label, row.text, row.used]) ?? null]);
    if (parts.ideas.dataset.signature === signature) return;
    parts.ideas.dataset.signature = signature;
    const rows = [];
    if (ask.loading) rows.push(el("p", "today-b-sugs-note", "Mefi is reading the project for a useful next step."));
    if (ask.error) { const bad = el("p", "today-b-sugs-note is-bad", ask.error); bad.setAttribute("role", "alert"); rows.push(bad); }
    if (ask.result) {
      const head = el("div", "today-b-sugs-head");
      head.append(el("b", "", ask.result.length ? "Mefi suggests" : "No next step suggested yet. Say a little more in the box and ask again."), button("Clear", "today-link", () => { Object.assign(state.home.suggest, { result: null, error: "" }); paintSuggest(); state.home.parts?.suggest?.focus?.({ preventScroll: true }); }, { title: "Put these suggestions away" }));
      rows.push(head);
      for (const row of ask.result) {
        const card = el("article", `today-b-sug${row.used ? " is-used" : ""}`);
        card.append(el("h4", "", row.label));
        if (row.text) card.append(el("p", "", row.text));
        if (row.reason) card.append(el("p", "today-b-sug-why", row.reason));
        card.append(button(row.used ? "Added to the draft" : "Add to the draft", "today-btn", () => useSuggestion(row), { disabled: row.used, title: "Add it under your words; nothing is sent" }));
        rows.push(card);
      }
    }
    parts.ideas.replaceChildren(...rows);
    parts.ideas.hidden = rows.length === 0;
  }
  // Talk it over and Build it wait while Home's box is sending, as its own Send does; the attach button says what it can take.
  function paintHomeTools() {
    const tools = state.home.toolParts;
    if (!tools) return;
    const snap = window.MefiWorkspace?.snapshot?.() || {};
    const off = !snap.projectId || Boolean(snap.pending);
    for (const node of [tools.talk, tools.build, tools.attach]) if (node.disabled !== off) node.disabled = off;
    tools.build.setAttribute("aria-busy", String(Boolean(snap.pending)));
    const words = homePicturesOff() ? "Add files" : "Add files or an image";
    if (tools.attachWords.textContent !== words) tools.attachWords.textContent = words;
  }
  // The rows of Running now and Finished while you were away: one line each, the session's state as a dot, opening the session.
  function homeRunning(d, current) {
    const waiting = waitingTasks(current.items);
    return (Array.isArray(d.running) ? d.running : []).filter((job) => !(job.taskId && waiting.has(String(job.taskId)))).map((job) => {
      const step = window.MefiVibeFlow?.doing?.(job) ?? { tool: "", step: "" };
      const who = clip(job.route || job.cli || step.tool || "", 40);
      const doing = job.stopping ? "stopping" : clip(step.step || job.currentStep || (job.phase ? String(job.phase).replace(/_/g, " ") : "working"), 80);
      const progress = Number.isFinite(job.progress) ? Math.max(0.04, Math.min(1, job.progress)) : null;
      return { key: `run:${job.taskId || job.title}`, tone: "run", title: clip(job.title || "A task", 120), taskId: job.taskId || null, meta: [who, doing].filter(Boolean).join(" · "), progress };
    });
  }
  function homeFinished(current, d, now) {
    const rows = [];
    for (const item of current.items) {
      if (item.handled || item.kind !== "review" || !item.taskId) continue;
      const checking = Boolean(item.need?.checking);
      rows.push({ key: `review:${item.taskId}`, tone: "rev", title: item.title, taskId: item.taskId, meta: checking ? "Checking its work" : item.facts ? `${item.facts} · ready to review` : "Ready to review", end: checking ? "" : "Review", changes: !checking });
    }
    for (const card of current.board.review) if (card.tone === "check" && !card.review) rows.push({ key: card.key, tone: "rev", title: card.title, taskId: card.taskId, meta: "Checking its work", end: "" });
    for (const card of current.board.done) {
      const task = taskOf(d, card.taskId);
      const verified = task?.verification?.state === "verified";
      rows.push({ key: card.key, tone: "done", title: card.title, taskId: card.taskId, meta: task ? `${verified ? "Verified" : "Done"} ${ago(finishedAt(task), now)}` : "Done", end: "Done" });
    }
    return rows.slice(0, 3);
  }
  function homeRow(row) {
    const node = button("", `today-b-row is-${row.tone}`, () => { if (row.changes) openChanges(row.taskId); else openTask(row.taskId); }, { title: row.title, disabled: !row.taskId });
    node.dataset.key = row.key; node.setAttribute("role", "listitem");
    const words = el("span", "today-b-row-words");
    words.append(el("span", "today-b-row-title", row.title), el("span", "today-b-row-meta", row.meta));
    node.append(el("i", "today-b-dot"), words);
    if (row.tone === "run") {
      const bar = el("span", `today-b-bar${row.progress == null ? " is-flowing" : ""}`); bar.setAttribute("aria-hidden", "true");
      const fill = el("i"); if (row.progress != null) fill.style.width = `${Math.round(row.progress * 100)}%`;
      bar.append(fill); node.append(bar);
    } else if (row.end) node.append(el("span", row.end === "Review" ? "today-b-end is-review" : "today-b-end", row.end));
    return node;
  }
  // The first thing that waits on you (a question, a permission, a go-ahead or a task that stopped; a result to review is under
  // Finished), answered in place with its first two options, or opened.
  function renderHomeNeed(item) {
    if (item.handled) return renderDecided(item, item.handled);
    const busy = state.busy.has(item.key);
    const node = el("article", `today-b-ask${busy ? " is-busy" : ""}`);
    node.dataset.key = item.key; node.dataset.kind = item.kind; node.dataset.tone = item.kind === "failure" ? "bad" : "warn";
    node.setAttribute("aria-busy", String(busy));
    const from = item.from && item.from !== item.title ? item.from : "";
    const head = el("div", "today-b-ask-k");
    head.append(kindGlyph(item.kind), el("b", "", from || item.title));
    head.title = item.who ? `${item.label} · ${item.who}` : item.label;
    const words = el("p", "today-b-ask-q", from ? item.title : item.detail || item.label);
    words.id = `today-build-ask-${String(item.key).replace(/[^A-Za-z0-9_-]/g, "-")}`;
    node.setAttribute("aria-labelledby", words.id);
    node.append(head, words);
    const row = el("div", "today-b-opts"); row.setAttribute("role", "group"); row.setAttribute("aria-label", item.options.length ? "Your answer" : "What to do");
    const quick = item.options.filter((option) => !option.text && !option.dismiss).slice(0, 2);
    if (item.options.length) {
      quick.forEach((option, index) => { const choose = button(option.label, `today-btn${index === 0 ? " primary" : ""}`, () => void answer(item, { optionId: option.id }), { title: option.description || option.label, disabled: busy }); choose.dataset.option = option.id; row.append(choose); });
      if (!quick.length) row.append(button("Answer", "today-btn primary", () => openInbox(state.anchor, { focus: item.key }), { title: "Answer it in the Inbox", disabled: busy }));
    } else {
      for (const action of actionsOf(item, state.data || {}).slice(0, 2)) {
        const run = typeof action.go === "function" ? () => action.go() : () => void perform(item, action);
        row.append(button(action.label, `today-btn${action.primary ? " primary" : ""}`, run, { title: action.title, disabled: busy || action.disabled, confirm: action.confirm }));
      }
    }
    if (item.taskId) row.append(button("Open task", "today-btn", () => openTask(item.taskId), { title: "Open its session" }));
    node.append(row);
    if (state.errors.has(item.key)) { const bad = el("p", "today-need-note", state.errors.get(item.key)); bad.setAttribute("role", "alert"); node.append(bad); }
    return node;
  }
  function caughtUp() {
    const node = el("div", "today-b-clear");
    const tick = el("i", "today-tick"); tick.setAttribute("aria-hidden", "true");
    const words = el("span", "");
    words.append(el("b", "", "You're all caught up."), document.createTextNode(" Nothing is waiting on you right now."));
    node.append(tick, words);
    return node;
  }
  function paintHome(current) {
    const parts = state.home.parts;
    if (!state.home.on || !parts) return;
    const d = state.data || vibe()?.data?.() || {};
    const now = Date.now();
    const hour = new Date(now).getHours();
    const kicker = d.greeting || (hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
    const title = d.headline || (d.projectId && d.projectName ? `What's next for ${d.projectName}?` : "Pick a project to begin");
    if (parts.kicker.textContent !== kicker) parts.kicker.textContent = kicker;
    if (parts.title.textContent !== title) parts.title.textContent = title;
    const input = homeInput();
    if (input && input.placeholder !== HOME_PLACEHOLDER) input.placeholder = HOME_PLACEHOLDER;
    paintHomeTools(); paintStarts(); paintSuggest();
    const first = orderItems(current.items).find((item) => item.kind !== "review") ?? null;
    reconcile(parts.needHolder, first ? [{ key: first.key, sig: `${itemSignature(first, { compact: false }, now)}|home`, build: () => renderHomeNeed(first) }] : [{ key: "__clear", sig: "clear", build: caughtUp }]);
    const empty = (words) => [{ key: "__none", sig: words, build: () => el("p", "today-b-empty", words) }];
    const running = homeRunning(d, current), finished = homeFinished(current, d, now);
    reconcile(parts.running, running.length ? running.map((row) => ({ key: row.key, sig: JSON.stringify(row), build: () => homeRow(row) })) : empty("Nothing is running."));
    reconcile(parts.finished, finished.length ? finished.map((row) => ({ key: row.key, sig: JSON.stringify(row), build: () => homeRow(row) })) : empty("Nothing new."));
  }
  const homeShowing = () => { const layer = byId("workspace-layer"); return Boolean(state.home.on && layer && !layer.hidden && !layer.hasAttribute?.("inert")); };

  // ---- painting and the clock -----------------------------------------------------------------------------
  let paintQueued = false;
  function paint() {
    if (!state.on || paintQueued) return;
    paintQueued = true;
    Promise.resolve().then(() => { paintQueued = false; paintNow(); });
  }
  function paintNow() {
    if (!state.on) return;
    sweepHandled();
    announce();
    if (state.host === "vibe" || byId("today-overlay")?.hidden === false || homeShowing()) paintToday();
    if (state.inbox.open) paintInbox();
    if (byId("inbox-overlay")?.hidden === false) paintInboxPage();
  }
  const visible = () => state.host === "vibe" || state.inbox.open || homeShowing() || byId("today-overlay")?.hidden === false || byId("inbox-overlay")?.hidden === false;
  // One slow clock while something is showing, so "4 min" and the decided lines stay true without a timer per card.
  function startClock() {
    if (state.clock || !visible()) return;
    state.clock = setInterval(() => { if (!visible()) { stopClock(); return; } if (!document.hidden) paintNow(); }, 30000);
  }
  function stopClock() { if (state.clock) { clearInterval(state.clock); state.clock = 0; } }
  function stopClockIfIdle() { if (!visible()) stopClock(); }
  // A decided line leaves by itself after a few seconds.
  function scheduleSweep() {
    clearTimeout(state.sweep);
    const next = Math.min(...[...state.handled.values()].map((entry) => (Date.now() < entry.showUntil ? entry.showUntil : entry.holdUntil)));
    if (!Number.isFinite(next)) return;
    state.sweep = setTimeout(() => { state.sweep = 0; paintNow(); if (state.handled.size) scheduleSweep(); }, Math.max(200, next - Date.now() + 50));
  }

  // ---- what reaches it ---------------------------------------------------------------------------------------
  function onData() {
    state.data = vibe()?.data?.() ?? state.data;
    paint();
  }
  // A decision raised anywhere (the companion, a toast, a panel row) lands on its item in the Inbox.
  function openNeed(ref = {}) {
    if (!state.on) return false;
    const wanted = typeof ref === "string" ? { kind: "question", id: ref } : ref || {};
    if (wanted.kind === "plan") { openPlan(wanted.id); return true; }
    const find = () => model().items.find((item) => item.need.kind === (wanted.kind || "question") && String(item.need.id) === String(wanted.id));
    const found = find();
    if (found) { openInbox(state.anchor, { focus: found.key }); return true; }
    // Not known here yet (the push is still on its way): read, then look again; meanwhile the Inbox is open.
    openInbox(state.anchor);
    void Promise.resolve(vibe()?.refresh?.()).then(() => { state.data = vibe()?.data?.() ?? state.data; const late = find(); if (late && state.inbox.open) { state.inbox.index = Math.max(0, orderItems(model().items).findIndex((item) => item.key === late.key)); paintInbox(); } });
    return true;
  }
  // The click on a Windows notification (alerts:open): a burst opens the Inbox, one thing opens its task, a question with no task opens that question.
  function openFromAlert(payload) {
    if (!state.on) return false;
    const kind = String(payload?.kind ?? "");
    if (kind === "test") return false;
    if (Number(payload?.count) > 1) { openInbox(state.anchor); return true; }
    if (payload?.taskId) return openTask(payload.taskId, { projectId: payload.projectId || null });
    if (payload?.id) return openNeed({ kind: "question", id: payload.id });
    openInbox(state.anchor);
    return true;
  }
  function onProjectChanged() {
    state.handled.clear(); state.later.clear(); state.errors.clear(); state.drafts.clear(); state.busy.clear();
    Object.assign(state.home.suggest, { loading: false, error: "", result: null, request: state.home.suggest.request + 1 });
    state.data = vibe()?.data?.() ?? null;
    paint();
  }
  // The route's view decides Build's Home: Today, or the classic Home under "chat". A session (view "task") covers whichever was there.
  function onNav(event) {
    const detail = event?.detail || {};
    if ((detail.id === "workspace" || detail.id === "vibe") && detail.action === "open") {
      const view = detail.params?.view;
      if (view !== "task") state.homeView = view === "chat" ? "chat" : "today";
    }
    syncHome();
    if (state.home.on) { paint(); startClock(); }
  }
  // The mode can change without a trip through the router (Settings' switch changes the frame in place).
  function onPageAttributes() { syncHome(); paint(); }
  function onShortcut(event) {
    if (!state.on || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.defaultPrevented) return;
    if (String(event.key || "").toLowerCase() !== "j") return;
    event.preventDefault?.();
    toggleInbox(state.anchor);
  }

  // ---- the registry --------------------------------------------------------------------------------------------
  const overlayOpen = (id) => { const node = byId(id); return Boolean(node && !node.hidden); };
  function register() {
    const nav = window.MefiNav;
    if (!nav?.register) return;
    const showIn = (parts) => ({ tabs: false, tools: false, dock: false, palette: false, help: false, footer: false, ...parts });
    nav.register({
      id: "today", label: "Today", short: "Today", kind: "overlay", layer: "sheet", section: "home", group: "surfaces", key: null, glyph: "g-home", badge: null,
      desc: "What needs you, what is running, what is ready to review and what finished today",
      searchTerms: "today board needs you running review done glance home calm",
      showIn: showIn({ palette: true, help: true }), hidden: () => vibe()?.mode?.() === "vibe",
      element: "today-overlay", focus: "#today-close",
      open: (params) => openTodayPage(params), close: () => closeTodayPage(), isOpen: () => overlayOpen("today-overlay"),
    });
    nav.register({
      id: "inbox", label: "Inbox", short: "Inbox", kind: "overlay", layer: "sheet", section: "work", group: "surfaces", key: null, glyph: "g-bell", badge: null,
      desc: "Everything waiting on you: questions, permissions, approvals, reviews and tasks that stopped",
      searchTerms: "inbox needs you questions permission approval review failed stuck decide answer waiting",
      showIn: showIn({ palette: true, help: true }),
      element: "inbox-overlay", focus: "#inbox-close",
      open: (params) => openInboxPage(params), close: () => closeInboxPage(), isOpen: () => overlayOpen("inbox-overlay"),
    });
    nav.register({
      id: "home-chat", label: "Open the conversation", short: "Conversation", kind: "action", layer: null, section: "home", group: "surfaces", key: null, glyph: "g-chat", badge: null,
      paletteGroup: "Actions", desc: "Build's Home as it was: the conversation with Mefi, the queue, Activity and the app preview",
      searchTerms: "conversation chat talk message assistant mefi classic home queue activity preview",
      showIn: showIn({ palette: true, help: true }), hidden: () => !building(), keyMatch: () => false,
      run: () => { openChat(); },
    });
    nav.register({
      id: "inbox-open", label: "Open the Inbox", short: "Inbox", kind: "action", layer: null, section: "home", group: "surfaces", key: null, chord: "Ctrl J", glyph: "g-bell", badge: null,
      paletteGroup: "Actions", paletteBrowse: 3, desc: "What needs you, answered where you are",
      searchTerms: "inbox needs you popover answer decide",
      showIn: showIn({ palette: true, help: true }), keyMatch: () => false,
      run: () => { openInbox(state.anchor); },
    });
  }

  // ---- start and stop -----------------------------------------------------------------------------------------
  function start() {
    if (state.on || !v2()) return false;
    state.on = true;
    register();
    state.off = vibe()?.watch?.(onData) ?? null;
    state.data = vibe()?.data?.() ?? null;
    state.signature = signatureOf();
    window.addEventListener("mefi:project-changed", onProjectChanged);
    window.addEventListener("mefi:appearance", paint);
    window.addEventListener("mefi:layout", onLayout);
    window.addEventListener("keydown", onShortcut);
    window.addEventListener("mefi:nav", onNav);
    window.MefiSize?.onChange?.(paint);
    // The Size and density page previews a level while it is being chosen, without an event: the attribute itself is what is watched (and the mode, for Build's Home).
    if (typeof MutationObserver === "function" && page()) { state.detailWatch = new MutationObserver(onPageAttributes); state.detailWatch.observe(page(), { attributes: true, attributeFilter: ["data-detail", "data-ui-mode"] }); }
    // Vibe may already be up (a reload that resumed on it): its front door is the host. Build's Home may be too.
    if (vibe()?.isActive?.()) show();
    syncHome();
    return true;
  }
  function stop() {
    if (!state.on) return false;
    closeInbox({ restore: false }); closeInboxPage(); closeTodayPage();
    restore();
    unmountHome();
    state.home.node?.remove?.(); state.home.tools?.remove?.();
    Object.assign(state.home, { node: null, parts: null, tools: null, toolParts: null });
    state.on = false;
    state.off?.(); state.off = null;
    stopClock(); clearTimeout(state.sweep);
    state.detailWatch?.disconnect?.(); state.detailWatch = null;
    window.removeEventListener("mefi:project-changed", onProjectChanged);
    window.removeEventListener("mefi:appearance", paint);
    window.removeEventListener("mefi:layout", onLayout);
    window.removeEventListener("keydown", onShortcut);
    window.removeEventListener("mefi:nav", onNav);
    state.inbox.node?.remove(); state.inbox.node = null;
    return true;
  }

  window.MefiToday = {
    start, stop, show, hide, isOn: () => state.on, takesNeeds: () => state.on,
    count, items, needTasks, onChange, openInbox, closeInbox, toggleInbox, isInboxOpen: inboxIsOpen, ownsKeys, openInboxPage, closeInboxPage, openPage: openTodayPage, closePage: closeTodayPage,
    openNeed, openFromAlert, refresh: () => Promise.resolve(vibe()?.refresh?.()).then(() => { onData(); }),
    // Build's Home (layout v2): workspace.js asks when Home comes and goes and when its box sends; the router's view "chat" is the classic Home.
    syncHome, hostsComposer: () => state.home.on, composerChanged: () => { if (state.home.on) paintHomeTools(); }, homeView: () => state.homeView, openChat, suggest: () => homeSuggest(),
    // For tests and anything driving Studio: the pure model, and what is in flight.
    build, snapshot: () => { const current = model(); return { count: current.count, items: current.items.map((item) => ({ key: item.key, kind: item.kind, handled: Boolean(item.handled) })), groups: Object.fromEntries(GROUPS.map(([key]) => [key, current.board[key].map((card) => card.key)])), host: state.host, home: state.home.on, homeView: state.homeView, inbox: state.inbox.open, later: [...state.later], busy: [...state.busy] }; },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
