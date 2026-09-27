// One eligibility vocabulary for dispatch and the project workbench. Pure:
// reading a backlog never changes work, retries it, or starts a model call.
const { createHash } = require("node:crypto");
// The admission module's title key and ladder (scripts/work-admission.cjs), so
// the counts and promotion agree on which inbox rows a card represents.
const { titleKey: key, represented: representedOnBoard } = require("./work-admission.cjs");
// A card's check against work done outside Studio (scripts/outside-work.cjs).
const { holdState: relevanceHold } = require("./outside-work.cjs");
const rows = (value) => Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];

// Approval names the saved work, not an editable status flag. Include nested
// obligations and references; claim timestamps and run telemetry are not scope.
const BUILD_SCOPE_FIELDS = ["id", "projectId", "projectPath", "title", "prompt", "description", "details", "note", "notes", "context", "handoff", "ideaDetail", "refs", "files", "file", "ideas", "dependsOn", "members", "remaining", "blockers", "acceptance", "acceptanceCriteria", "requirements", "constraints", "scope", "sessions", "problemFiles", "source", "parent", "parentRunId", "fromRun", "handoffId", "depth", "planningId", "planningSpecId", "planningTaskId"];
// A reference gather stamps what it attaches with auto: true (main.cjs
// attachTaskRefs and the Luna context pointer, the task page's Gather). Its
// file, session and context rows only name paths and sessions the local
// analyzer found, so they are not scope: a gather that lands after the owner
// approved used to cancel the approval (and a named Start) without a word.
// Web rows carry outside titles and links, so they stay scope even when
// gathered, and so does every row the owner or a planner wrote. Rows saved
// before the stamp existed have no auto flag and hash exactly as they did.
const UNSCOPED_REF_KINDS = new Set(["file", "session", "context"]);
const gatheredRef = (ref) => Boolean(ref && ref.auto === true && UNSCOPED_REF_KINDS.has(ref.kind));
function buildScope(item) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, canonical(value[name])])) : value;
  const scope = {};
  for (const name of BUILD_SCOPE_FIELDS) {
    if (item?.[name] === undefined) continue;
    if (name === "refs" && Array.isArray(item.refs)) {
      const kept = item.refs.filter((ref) => !gatheredRef(ref));
      // Only gathered rows: the card hashes as if it had none, the way it
      // did before the gather landed.
      if (kept.length < item.refs.length && !kept.length) continue;
      scope.refs = kept;
      continue;
    }
    scope[name] = item[name];
  }
  return createHash("sha256").update(JSON.stringify(canonical(scope))).digest("hex");
}

function hasBuildApproval(item) {
  return item?.buildApproval?.version === 1 && item.buildApproval.scope === buildScope(item);
}

function buildAllowed(item, { autoBuild = true, approve = null, tasks = [] } = {}) {
  const required = typeof approve === "function" ? approve(item, { tasks }) : autoBuild === false;
  return !required || hasBuildApproval(item);
}

function dependencyIds(item) {
  const explicit = Array.isArray(item?.dependsOn) ? item.dependsOn : [];
  const delegated = item?.delegation?.version === 1 && Array.isArray(item.delegation.childTaskIds) ? item.delegation.childTaskIds : [];
  return [...new Set([...explicit, ...delegated].filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))];
}

function completedTask(task) {
  return task?.status === "done" || (task?.status === "archived" && Boolean(task.doneAt || task.verification?.state === "verified" || task.completionFromTaskId));
}

// The owner's "won't do" (main.cjs dropTask): unfinished work closed without a
// completion claim. It is never completedTask, so nothing counts it as
// finished, but a parent that handed it on stops waiting for it.
function droppedTask(task) {
  return task?.status === "archived" && !completedTask(task) && Boolean(task.dropped && typeof task.dropped === "object");
}

// A pass over the whole board (summarizeBacklog) asks the same questions of
// every row. The memo keeps the id maps it builds (one per project scope, and
// the unscoped one duplicateState reads) and each row's dependency state, so a
// pass indexes the board once instead of once or twice per row. It is only
// consulted for the exact tasks array it was made for.
function boardMemo(tasks) {
  return { tasks, scoped: new Map(), byId: null, states: new WeakMap() };
}

const normalizedPath = (value) => String(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

function dependencyState(item, tasks = [], memo = null) {
  // Most rows have no prerequisites; skip building the whole-board map for them.
  const ids = dependencyIds(item);
  if (!ids.length) return { dependencies: [] };
  const shared = memo && memo.tasks === tasks ? memo : null;
  if (shared && item && typeof item === "object" && shared.states.has(item)) return shared.states.get(item);
  const projectId = item?.projectId ?? item?.delegation?.projectId;
  const projectPath = item?.projectPath ?? item?.delegation?.projectPath;
  const inProject = (task) => !(projectId != null && task.projectId != null && task.projectId !== projectId)
    && !(projectPath && task.projectPath && normalizedPath(task.projectPath) !== normalizedPath(projectPath));
  const scope = shared ? JSON.stringify([projectId ?? null, projectPath ? normalizedPath(projectPath) : null]) : null;
  let byId = shared ? shared.scoped.get(scope) : null;
  if (!byId) {
    byId = new Map(rows(tasks).filter(inProject).map((task) => [task.id, task]));
    if (shared) shared.scoped.set(scope, byId);
  }
  const state = dependencyStateFrom(item, ids, byId);
  if (shared && item && typeof item === "object") shared.states.set(item, state);
  return state;
}

function dependencyStateFrom(item, ids, byId) {
  const dependencies = ids.map((id) => {
    const task = byId.get(id);
    return { id, title: task?.title || id, status: task?.status || "missing", done: completedTask(task) };
  });
  const missing = dependencies.filter((task) => task.status === "missing");
  if (missing.length) return { stage: "blocked", reason: `Missing prerequisite: ${missing.map((task) => task.title).join(", ")}`, dependencies, blockedBy: "dependencies", canRetry: false };
  const visiting = new Set();
  const visited = new Set();
  const cyclic = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const task = id === item.id ? item : byId.get(id);
    if (dependencyIds(task).some(cyclic)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (cyclic(item.id)) return { stage: "blocked", reason: "Prerequisites form a cycle. Remove a link before this work can start.", dependencies, blockedBy: "dependencies", canRetry: false };
  const waiting = dependencies.filter((task) => !task.done);
  if (waiting.length) return { stage: "waiting", reason: `Waiting for ${waiting.map((task) => task.title).join(", ")} to finish successfully`, dependencies, blockedBy: "dependencies", canRetry: false };
  return { dependencies };
}

function validateDependencies(tasks, taskId, dependsOn) {
  if (!Array.isArray(dependsOn) || dependsOn.some((id) => typeof id !== "string" || !id.trim() || id.length > 200)) return { ok: false, error: "Prerequisites must be task IDs from this project." };
  const item = rows(tasks).find((task) => task.id === taskId);
  if (!item) return { ok: false, error: "Choose a task from this project." };
  const next = { ...item, dependsOn: dependencyIds({ dependsOn }) };
  if (next.dependsOn.includes(taskId)) return { ok: false, error: "A task cannot depend on itself." };
  const state = dependencyState(next, tasks);
  if (state.stage === "blocked") return { ok: false, error: state.reason };
  return { ok: true, dependsOn: next.dependsOn };
}

// The owner's duplicate link (a family ask answered "keep the oldest", written
// by main.cjs assistantFamilyAction). A card whose duplicateOf names a card
// still on the board waits for it: nothing dispatches it, and once that card
// is completed the keeper closes this one as its completion (assistant.mjs
// auditPass), so it keeps waiting until then. A link to a card that left the
// board or was archived unfinished is ignored, and so is a ring of links that
// leads back to this card: no card waits on itself. canRetry stays unset:
// Run anyway is retryTask, which drops the link. While the card it waits for
// is itself blocked (held, parked, or waiting on a blocked card in turn), the
// wait is blocked too and names that card's hold, so a handoff parent counts
// this child as needing review instead of waiting on it forever.
function duplicateState(item, tasks, now, autoBuild, memo = null, approve = null) {
  const target = typeof item?.duplicateOf === "string" ? item.duplicateOf.trim() : "";
  if (!target || target === item.id) return null;
  const shared = memo && memo.tasks === tasks ? memo : null;
  const byId = shared?.byId ?? new Map(rows(tasks).map((task) => [task.id, task]));
  if (shared) shared.byId = byId;
  const original = byId.get(target);
  if (!original || (original.status === "archived" && !completedTask(original))) return null;
  for (let id = target, hops = 0; typeof id === "string" && hops <= byId.size; hops += 1) {
    if (id === item.id) return null;
    id = byId.get(id)?.duplicateOf;
  }
  const title = String(original.title ?? "").trim().slice(0, 120) || original.id;
  if (completedTask(original)) return { stage: "waiting", blockedBy: "duplicate", reason: `${title} is done; this card closes as the same work`, duplicateOf: original.id };
  const held = workState(original, now, { tasks, autoBuild, approve, memo: shared });
  if (held.stage === "blocked") return { stage: "blocked", blockedBy: "duplicate", reason: `Waiting for ${title} (the same work), which is blocked: ${String(held.reason ?? "").slice(0, 400)}`, duplicateOf: original.id };
  return { stage: "waiting", blockedBy: "duplicate", reason: `Waiting for ${title} (the same work)`, duplicateOf: original.id };
}

function workState(item, now = Date.now(), { tasks = null, autoBuild = true, approve = null, memo = null } = {}) {
  if (item.absorbedInto) return { stage: "grouped", reason: "Included in a task group", groupId: item.absorbedInto };
  if (item.status === "done" || item.status === "archived") return { stage: "done", reason: droppedTask(item) ? "Dropped by you before it finished" : item.status === "archived" ? "Archived completion" : "Completed" };
  if (item.status === "awaiting_verification" || item.status === "verifying") {
    // A parent waiting on its handed-off follow-ups only waits: the verifier
    // skips it until they settle, and a stuck follow-up is flagged on its own
    // card. Its reason still says when that follow-up needs review. (It used
    // to be "blocked" too, so one parked leaf put its whole chain of
    // ancestors under Needs attention.)
    if (item.handoffState?.pending > 0) return { stage: "waiting", reason: item.handoffState.reason || "Waiting for delegated work to finish", blockedBy: "handoffs", canRetry: false, childTaskIds: item.handoffState.childTaskIds ?? [] };
    if (item.delegation && Array.isArray(tasks)) {
      const delegated = dependencyState(item, tasks, memo);
      if (delegated.stage) return delegated;
    }
    return { stage: "review", reason: "Run finished; checking its completion evidence" };
  }
  if (item.status === "active" || item.status === "running") return { stage: "running", reason: "A worker holds this task" };
  if (item.autonomyPending || item.autonomyUndo) return { stage: "blocked", blockedBy: "decision", canRetry: false, reason: item.autonomyUndo ? "Undo is waiting for the current run to finish" : "Saving Mefi's decision before this task can start" };
  if (item.autonomyBudgetHold) return { stage: "blocked", blockedBy: "decision-budget", canRetry: true, reason: "Mefi held this task after two automatic decisions today. Review it, Undo the hold, or choose Try again." };
  const deferUntil = Number(item.deferUntil);
  if ((!item.status || ["open", "pending", "queued"].includes(item.status)) && Number.isFinite(deferUntil) && deferUntil > now && deferUntil <= 8640000000000000) {
    return { stage: "deferred", reason: `Deferred until ${new Date(deferUntil).toISOString()}`, retryAt: deferUntil };
  }
  const dependency = Array.isArray(tasks) ? dependencyState(item, tasks, memo) : { dependencies: [] };
  if (dependency.stage) return dependency;
  if (item.verification?.state === "failed" || Number(item.verifyAttempts) >= 3) {
    const attempts = Math.max(0, Number(item.verifyAttempts) || 0);
    return { stage: "blocked", reason: `Completion could not be verified${attempts ? ` after ${attempts} attempt${attempts === 1 ? "" : "s"}` : ""}. Review the result, then retry.` };
  }
  if (Number(item.runFailures) >= 5) return { stage: "blocked", reason: `${Number(item.runFailures)} attempts failed. Review the error, then retry.` };
  // The owner's stop (the host stamps ownerHold when the owner stops a card):
  // the card stays put until they say to go on. It ranks with the loop hold —
  // the parks above name a more specific cause and win — and the owner's own
  // word comes before the keeper's hold, a cooldown and a free worker. Only a
  // card back in the queue is held; a running, verifying or finished card is
  // what it is. canRetry stays unset: Work on it and Try again (retryTask) are
  // the release.
  const queued = !item.status || item.status === "open" || item.status === "pending" || item.status === "queued";
  if (queued && item.ownerHold && typeof item.ownerHold === "object" && !Array.isArray(item.ownerHold)) {
    const why = String(item.ownerHold.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 80).trim();
    return { stage: "blocked", blockedBy: "owner", reason: `Stopped by you${why ? ` (${why})` : ""} — say "work on it" or "try again" to resume it` };
  }
  // Work done outside Studio: a queued card waits while it is checked against
  // it (bounded, so a check that never runs cannot hold it for good), and
  // after a done or obsolete verdict until the owner decides. The owner's own
  // stop above names who holds it; Try again and Work on it release it.
  if (queued && item.relevance && typeof item.relevance === "object") {
    const relevance = relevanceHold(item.relevance, now);
    if (relevance) return relevance;
  }
  // The keeper's loop hold (assistant.mjs auditPass). The parks above name a
  // more specific cause, so they win. canRetry stays unset: Try again is the
  // release (retryTask).
  if (item.loopGuard && typeof item.loopGuard === "object") {
    const count = Math.max(0, Math.floor(Number(item.loopGuard.count) || 0));
    const why = String(item.loopGuard.reason ?? "").trim().slice(0, 120);
    const remedy = String(item.loopGuard.remedy ?? "").trim().slice(0, 240) || "Read the last attempts, edit or split the brief, then choose Try again.";
    return { stage: "blocked", blockedBy: "loop", reason: `Loop guard: ${count || "repeated"} attempt${count === 1 ? "" : "s"} since your last retry ended without verified progress${why ? ` (${why})` : ""}. ${remedy}` };
  }
  // The owner's duplicate link waits the card on the one it names; the card's
  // own parks and hold above come first, so a link never masks them.
  const duplicate = Array.isArray(tasks) ? duplicateState(item, tasks, now, autoBuild, memo, approve) : null;
  if (duplicate) return duplicate;
  if (Number(item.nextRunAt) > now) return { stage: "cooling", reason: "Waiting before another attempt", retryAt: Number(item.nextRunAt) };
  if (item.status && item.status !== "open" && item.status !== "pending" && item.status !== "queued") return { stage: "blocked", reason: `Held (${String(item.status).slice(0, 40)})` };
  if (!buildAllowed(item, { autoBuild, approve, tasks })) return { stage: "approval", reason: "Review this task and approve its build", canApprove: true, buildScope: buildScope(item), ...dependency };
  return { stage: "ready", reason: item.pin ? "You chose this to go next" : "Ready for an available worker", ...dependency };
}

// The loop states that stop or hold every card (scripts/loop-status.cjs). When
// the host passes its loop answer, the summary leads with it, so a launch hold
// no longer reads "3 ready to work on" while nothing can start.
const LOOP_HOLDS = new Set(["no-project", "held", "paused", "parked", "draining", "stuck"]);

function summarizeBacklog({ tasks = [], requests = [], ideas = [], jobs = [], compare, ideaEligible, now = Date.now(), paused = false, draining = false, waiting = null, lastError = null, parkedUntil = 0, autoBuild = true, approve = null, loop = null } = {}) {
  const board = rows(tasks);
  const memo = boardMemo(board);
  const heldIds = new Set(rows(jobs).map((job) => job.taskId).filter(Boolean));
  // Dispatch never starts a card whose title key a live run already carries
  // (executor-core.cjs selectCandidates). Such a card used to read "Ready"
  // with no reason while it could not start; it now says what it waits for.
  const liveTitles = new Map(rows(jobs).filter((job) => !job.finished && job.title).map((job) => [key(job.title), job]).filter(([titleKey]) => titleKey));
  const sameWork = (task, state) => {
    const titleKey = state.stage === "ready" ? key(task.title) : "";
    const live = titleKey ? liveTitles.get(titleKey) : null;
    if (!live || live.taskId === task.id) return state;
    return { stage: "waiting", blockedBy: "same-work", canRetry: false, reason: `Waiting for the running worker on "${String(live.title).slice(0, 90)}", which has the same title` };
  };
  const taskStates = board.map((task) => ({ id: task.id, kind: "task", title: String(task.title ?? "Untitled task"), dependencies: dependencyState(task, board, memo).dependencies, ...(heldIds.has(task.id) ? { stage: "running", reason: "A worker is building this task" } : sameWork(task, workState(task, now, { tasks: board, autoBuild, approve, memo }))) }));
  const represented = new Set(board.filter((task) => task.status !== "archived").map((task) => key(task.title)).filter(Boolean));
  const uniqueRequests = rows(requests).filter((request) => {
    const titleKey = key(request.title || request.prompt);
    if (titleKey && represented.has(titleKey)) return false;
    if (titleKey) represented.add(titleKey);
    return true;
  });
  // A row promotion would take but will never turn into a task, because the
  // board already represents it by identity, brief or title key: the same
  // ladder call promotion makes (main.cjs promoteRequestsToTasks). It used to
  // count as ready, so the chat and Command view said "N ready" for inbox work
  // nothing would ever start.
  const promotable = (request) => !request.runId && request.runProgress?.pending !== true && !request.absorbedInto
    && (!request.status || ["open", "pending", "queued"].includes(request.status));
  const onBoard = (request) => {
    // A promoted row's own card stands for it, open or closed, until
    // compaction drops the row: promotion never takes it again.
    if (request.promotedTo) return board.find((task) => task?.id === request.promotedTo) ?? { id: request.promotedTo };
    if (!promotable(request)) return null;
    const hit = representedOnBoard({ tasks: board }, { ...request, title: String(request.title ?? "").slice(0, 90) }, { titles: (task) => task?.status !== "archived" });
    return hit ? hit.item ?? hit.items?.[0]?.item ?? {} : null;
  };
  const requestStates = uniqueRequests.map((request, index) => {
    const row = { id: request.id ?? `request_${index}`, kind: "request", title: String(request.title || request.prompt || "Queued request").slice(0, 120) };
    const card = onBoard(request);
    if (card) return { ...row, stage: "represented", reason: `Already on the board as "${String(card.title ?? card.id ?? "another card").slice(0, 120)}"`, ...(card.id ? { taskId: card.id } : {}) };
    return { ...row, ...workState(request, now, { tasks: board, autoBuild, approve, memo }) };
  });
  const all = [...taskStates, ...requestStates];
  const counts = Object.fromEntries(["ready", "running", "review", "blocked", "cooling", "deferred", "done", "grouped", "waiting", "approval", "represented"].map((stage) => [stage, all.filter((row) => row.stage === stage).length]));
  counts.requests = requestStates.filter((item) => item.stage !== "done" && item.stage !== "represented").length;
  const pendingIdeas = rows(ideas).filter((idea) => !idea.taskId && (!idea.status || ["new", "keep"].includes(idea.status)));
  counts.ideas = pendingIdeas.length;
  counts.eligibleIdeas = pendingIdeas.filter((idea) => typeof ideaEligible === "function" ? ideaEligible(idea) : Boolean(idea.id && idea.title && (idea.source !== "chat" || idea.status === "keep"))).length;
  counts.ideaNotes = counts.ideas - counts.eligibleIdeas;
  const ordered = [...board.map((ref, index) => ({ ref, state: taskStates[index] })), ...uniqueRequests.map((ref, index) => ({ ref, state: requestStates[index] }))]
    .filter(({ state }) => state.stage === "ready")
    .sort((a, b) => typeof compare === "function" ? compare(a.ref, b.ref) : (a.ref.createdAt ?? a.ref.at ?? 0) - (b.ref.createdAt ?? b.ref.at ?? 0));
  const retryTimes = all.map((row) => row.retryAt).filter(Number.isFinite);
  if (Number(parkedUntil) > now) retryTimes.push(Number(parkedUntil));
  const nextRetryAt = retryTimes.length ? Math.min(...retryTimes) : null;
  const loopHold = loop && typeof loop === "object" && LOOP_HOLDS.has(loop.state) ? [loop.headline, loop.reason].filter(Boolean).join(". ").slice(0, 400) : null;
  const hold = loopHold || (Number(parkedUntil) > now ? "Worker startup is cooling down after repeated failures" : paused ? "Paused. Current workers can finish; new work will wait." : waiting || (lastError && !counts.running ? String(lastError).slice(0, 240) : null));
  const summary = hold || (counts.running ? `${counts.running} building · ${counts.ready} ready next` : counts.ready ? `${counts.ready} ready to work on` : counts.approval ? `${counts.approval} tasks waiting for your approval` : counts.review ? `${counts.review} finished attempts awaiting verification` : counts.eligibleIdeas ? `${counts.eligibleIdeas} ideas ready to become tasks` : counts.blocked ? `${counts.blocked} tasks need your review` : counts.waiting ? `${counts.waiting} tasks waiting for prerequisites` : counts.cooling ? `${counts.cooling} tasks waiting before retry` : counts.deferred ? `${counts.deferred} tasks deferred until later` : "Existing work is caught up");
  return { counts, taskStates, next: ordered.slice(0, 8).map(({ state }) => state), blocked: all.filter((row) => row.stage === "blocked").slice(0, 40), approval: all.filter((row) => row.stage === "approval").slice(0, 40), autoBuild: autoBuild !== false, paused, draining, mode: draining ? "backlog" : "balanced", waiting: hold, summary, nextRetryAt };
}

function retryTask(task, now = Date.now()) {
  const next = { ...task, status: "open", updatedAt: now, pin: true, pinAt: now };
  delete next.deferUntil;
  // duplicateOf goes too: Run anyway on a card waiting for its duplicate. Its
  // familyDecision stays, so the keeper does not ask about the family again.
  // ownerHold goes as well: Try again is the owner saying to go on after
  // their own stop.
  for (const name of ["runFailures", "startFailures", "providerFailures", "nextRunAt", "lastRunError", "verifyAttempts", "verification", "verificationReceiptId", "doneAt", "runId", "lease", "buildApproval", "loopGuard", "ownerHold", "autonomyBudgetHold", "duplicateOf", "dropped"]) delete next[name];
  // An outside-work hold is lifted too, but its evidence stays so the next
  // worker still reads what changed outside Studio.
  if (next.relevance && typeof next.relevance === "object" && ["checking", "ask"].includes(next.relevance.state)) {
    next.relevance = { ...next.relevance, state: "clear", released: { at: now, by: "owner" } };
  }
  // The owner's acknowledgement for the loop guard: the ledger restarts from
  // now, so outcomes logged before this retry are never counted again.
  next.loopLedger = { v: 1, at: now, n: 0, reasons: {} };
  // lastAttempt, remaining, refs, and logs are evidence, not retry switches.
  next.logs = [...rows(task.logs), { at: now, kind: "status", text: "Retry requested — previous result and remaining work retained" }].slice(-40);
  return next;
}

// A re-arm made for the owner, not by them: the desk or the assistant settled
// an ask under the owner's permission mode (main.cjs assistantIssueAction,
// origin "delegate"). retryTask is the owner saying "go on", so it lifts every
// brake; this lifts only what stands between a failed card and its next
// dispatch. It never lifts the owner's own stop, keeps the loop ledger, the
// duplicate link and the build approval, and leaves a parked card two
// failures from parking again. A loop hold stays in place even if the answer
// changes the approach. assistantRetries is the card's own record of
// these re-arms, so the per-card budget survives a restart.
const DELEGATE_PER_DAY = 2;
const DELEGATE_PARK_ROOM = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

function delegatedRetries(task, now = Date.now()) {
  return rows(task?.assistantRetries).filter((row) => Number(row.at) > now - DAY_MS && Number(row.at) <= now);
}

function delegateRetry(task, now = Date.now(), { by = "desk", kind = null } = {}) {
  if (!task || typeof task !== "object") return { ok: false, error: "That task is no longer on the board." };
  if (task.autonomyBudgetHold) return { ok: false, held: true, error: "This task is held for your review after its automatic decision budget was spent." };
  if (task.ownerHold && typeof task.ownerHold === "object" && !Array.isArray(task.ownerHold)) return { ok: false, held: true, error: "You stopped this card, so only you can resume it." };
  if (task.relevance?.state === "ask") return { ok: false, held: true, error: "Work done outside Studio may already cover this card, so only you can put it back in the queue." };
  if (completedTask(task) || task.status === "archived") return { ok: false, error: "This task is finished." };
  if (task.status === "active" || task.status === "running" || task.runId || task.lease) return { ok: false, error: "A worker holds this task." };
  const recent = delegatedRetries(task, now);
  if (recent.length >= DELEGATE_PER_DAY) return { ok: false, budget: true, error: `This card was already re-armed for you ${recent.length} times today.` };
  const next = { ...task, status: "open", updatedAt: now };
  for (const name of ["nextRunAt", "lastRunError", "startFailures", "providerFailures"]) delete next[name];
  if (Number(task.runFailures) >= 5) next.runFailures = 5 - DELEGATE_PARK_ROOM;
  if (["verify", "check-failed"].includes(kind) && (task.verification?.state === "failed" || Number(task.verifyAttempts) >= 3)) {
    delete next.verification;
    delete next.verificationReceiptId;
    next.verifyAttempts = Math.min(Number(task.verifyAttempts) || 0, 3 - DELEGATE_PARK_ROOM);
  }
  const who = String(by || "desk").slice(0, 20);
  next.assistantRetries = [...recent, { at: now, by: who, ...(kind ? { kind: String(kind).slice(0, 40) } : {}) }].slice(-10);
  next.logs = [...rows(task.logs), { at: now, kind: "status", text: `Re-armed for you by the ${who === "desk" ? "desk" : "assistant"} — failure budget and loop ledger kept` }].slice(-40);
  return { ok: true, task: next };
}

// The keeper stamps loop holds only on a host whose workState honours them:
// assistantKeeperJob passes hostCaps.loopHold from this.
const LOOP_HOLD = 1;
// Likewise the keeper asks the owner about duplicate families only on a host
// whose workState waits a linked card (duplicateState): hostCaps.duplicateWait.
const DUPLICATE_WAIT = 1;

module.exports = { workState, summarizeBacklog, retryTask, delegateRetry, delegatedRetries, DELEGATE_PER_DAY, dependencyState, dependencyIds, completedTask, droppedTask, validateDependencies, buildScope, hasBuildApproval, buildAllowed, LOOP_HOLD, DUPLICATE_WAIT };
