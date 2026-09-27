// Permission orchestration. The Electron host supplies storage, model calls
// and existing answer paths; fixtures can supply an isolated in-memory board.
"use strict";

const autonomy = require("./autonomy.cjs");
const desk = require("./desk-resolve.cjs");
const ledger = require("./decision-ledger.cjs");
const companion = require("./companion.cjs");
const backlog = require("./backlog.cjs");
const issues = require("./agent-issues.cjs");
const memory = require("./decision-memory.cjs");
const rows = (value) => Array.isArray(value) ? value : [];

function createAutonomyHost(io) {
  const now = io.now ?? Date.now;
  let busy = false, operations = 0, backoffUntil = 0, revision = 0, setting = Promise.resolve();
  const state = () => io.getState();
  const project = () => io.projectId();
  const idsFor = (question) => [...new Set([question.context?.taskId, ...rows(question.options).flatMap((option) => rows(option.action?.memberIds))].filter(Boolean))];
  const save = async () => { await io.save(); io.emit?.(); };

  async function view() {
    await io.ensure();
    return { ok: true, projectId: project(), ...autonomy.migrate(await io.readSettings()), categories: autonomy.ELEVATED,
      decisions: rows(state().decisions), todos: rows(state().todos) };
  }

  function set(payload = {}) {
    const run = setting.catch(() => {}).then(async () => {
      await io.ensure();
      if (payload.level !== undefined && !autonomy.LEVELS.includes(payload.level)) return { ok: false, error: "Choose one of the four permission modes." };
      const previous = autonomy.migrate(await io.readSettings());
      const elevated = { ...previous.elevated };
      for (const [id, value] of Object.entries(payload.elevated ?? {})) {
        const category = autonomy.ELEVATED.find((entry) => entry.id === id);
        if (!category || typeof value !== "boolean") return { ok: false, error: "Choose a valid elevated request switch." };
        if (category.warn && previous.elevated[id] && !value && !rows(payload.confirmed).includes(id)) return { ok: false, warning: id, error: category.warn };
        elevated[id] = value;
      }
      revision += 1; // an in-flight desk reply cannot act under the old policy
      const next = { level: payload.level ?? previous.level, elevated };
      await io.updateSettings((settings) => { settings.autonomy = next; });
      await io.setAutopilot({ autoBuild: !["ask", "accept"].includes(next.level) }, "autonomy");
      for (const question of rows(state().questions)) if (question.status === "open" && !question.context?.undoneFrom && question.context?.suggestion) delete question.context.suggestion;
      backoffUntil = 0;
      io.emit?.();
      return view();
    });
    setting = run;
    return run;
  }

  function notice(key, text, event) {
    const messages = state().messages;
    if (!Array.isArray(messages)) return;
    const existing = messages.find((row) => row.kind === "notice" && row.taskId === key);
    if (existing) { existing.text = text; existing.at = now(); }
    else messages.push({ id: io.id(), projectId: project(), at: now(), role: "assistant", kind: "notice", taskId: key, event, text, via: "local", intent: "status" });
    if (messages.length > 200) messages.splice(0, messages.length - 200);
  }

  async function notices(tasks = null) {
    tasks ??= await io.readTasks();
    const config = autonomy.migrate(await io.readSettings());
    const withApproval = tasks.map((task) => ({ ...task, needsApproval: backlog.workState(task, now(), { tasks, approve: (item) => autonomy.needsApproval(item, { ...config, tasks }) }).stage === "approval" }));
    const queue = companion.dropCleared(companion.queue({ questions: state().questions, tasks: withApproval, now: now(), project: io.projectName?.() }), await io.cleared?.() ?? {});
    state().needsYou = queue;
    const total = queue.counts.total;
    if (total || state().messages?.some((row) => row.taskId === "__needs_you__")) notice("__needs_you__", total ? `${total} item${total === 1 ? "" : "s"} need${total === 1 ? "s" : ""} you. Open Needs you to review them.` : "Nothing needs your decision right now.", "needs-you");
    const decisions = rows(state().decisions).filter((row) => !row.undone && !row.failed && !row.pending);
    if (decisions.length || state().messages?.some((row) => row.taskId === "__decided_for_you__")) notice("__decided_for_you__", decisions.length ? `Decided for you (${decisions.length}). ${decisions.at(-1).label}: ${decisions.at(-1).reason || "Open the decision to see why or undo it."}` : "Decided for you (0). All automatic decisions have been undone.", "decided");
    return queue;
  }

  async function undo({ id, projectId } = {}) {
    await io.ensure();
    if (projectId && projectId !== project()) return { ok: false, error: "The selected project changed." };
    const decision = rows(state().decisions).find((row) => row.id === id);
    if (!decision || decision.undone || decision.pending) return { ok: false, error: "That decision is no longer available to undo." };
    const result = await io.mutate((board) => {
      const restored = ledger.restore(board.tasks, decision, now());
      board.tasks = restored.tasks;
      return { ok: true, pending: restored.pending, conflicts: restored.conflicts ?? [] };
    });
    if (!result.ok) return result;
    decision.undoPending = result.pending;
    if (!result.pending) {
      decision.undone = now();
      let question = rows(state().questions).find((row) => row.id === decision.questionId);
      if (!question && decision.question) { question = JSON.parse(JSON.stringify(decision.question)); state().questions.push(question); }
      if (question) { question.status = "open"; question.answer = null; question.context = { ...question.context, undoneFrom: id }; }
      if (decision.todoId) state().todos = rows(state().todos).filter((row) => row.id !== decision.todoId);
      await io.correction?.(decision);
    }
    await notices();
    await save();
    return { ok: true, pending: result.pending, conflicts: result.conflicts, message: result.pending ? "Undo is queued until the worker finishes." : "Mefi's decision was undone. Its question is open again." };
  }

  async function todo({ id, action, projectId } = {}) {
    await io.ensure();
    if (projectId && projectId !== project()) return { ok: false, error: "The selected project changed." };
    const row = rows(state().todos).find((entry) => entry.id === id);
    if (!row || !["done", "not-mine"].includes(action)) return { ok: false, error: "Choose Done or Not mine on a current to-do." };
    row.doneAt = now(); row.dismissed = action === "not-mine";
    await save();
    return { ok: true };
  }

  async function apply(question, choice, config, { todoText = null, learned = null } = {}) {
    const projectId = project();
    if (question.status !== "open") return { ok: false, error: "That question has already changed." };
    if (JSON.stringify(autonomy.migrate(await io.readSettings())) !== JSON.stringify(config)) return { ok: false, error: "The permission mode changed; the answer was left for review." };
    const tasks = await io.readTasks();
    const ids = idsFor(question), affected = tasks.filter((task) => ids.includes(task.id));
    if (affected.some((task) => task.ownerHold || ledger.held(task))) return { ok: false, error: "This work is held by you or a worker." };
    if (affected.some((task) => backlog.delegatedRetries(task, now()).length >= 2)) return { ok: false, error: "This card has already been settled twice today." };
    if (project() !== projectId) return { ok: false, error: "The selected project changed." };
    const option = rows(question.options).find((row) => row.id === choice.optionId);
    if (!option && !todoText) return { ok: false, error: "That option is no longer offered." };
    const decision = { id: io.id(), at: now(), level: config.level, by: "desk", source: question.source, questionId: question.id,
      taskId: question.context?.taskId ?? ids[0] ?? null, kind: question.context?.issueKind ?? question.source,
      choice: choice.optionId, label: todoText ? "Added to your For you list" : option.label,
      reason: choice.reason, confidence: choice.confidence ?? 0, learnedFrom: learned, before: ledger.snapshot(tasks, ids), after: [], question: JSON.parse(JSON.stringify(question)), undone: null, pending: true };
    const reserved = await io.mutate((board) => {
      const current = board.tasks.filter((task) => ids.includes(task.id));
      if (current.some((task) => task.ownerHold || task.loopGuard?.by === "owner" || ledger.held(task) || task.autonomyPending || task.autonomyUndo || backlog.delegatedRetries(task, now()).length >= 2)) return { ok: false, error: "This work changed while Mefi was deciding." };
      decision.before = ledger.snapshot(board.tasks, ids);
      for (const task of current) task.autonomyPending = decision.id;
      return { ok: true };
    });
    if (!reserved?.ok) return reserved;
    state().decisions = [...rows(state().decisions), decision].slice(-300);
    await save(); // keep the intent even if the process exits during the answer
    if (JSON.stringify(autonomy.migrate(await io.readSettings())) !== JSON.stringify(config)) {
      decision.pending = false; decision.failed = true; decision.reason = "The permission mode changed before the answer was applied.";
      await save(); await release(decision.id);
      return { ok: false, error: decision.reason };
    }
    const result = todoText
      ? await io.answer({ id: question.id, optionId: choice.optionId, origin: "delegate", by: "desk", decisionId: decision.id, projectId, reason: choice.reason, recordOnly: true })
      : await io.answer({ id: question.id, optionId: choice.optionId, text: choice.text, origin: "delegate", by: "desk", decisionId: decision.id, projectId, reason: choice.reason });
    if (project() !== projectId) return { ok: false, error: "The selected project changed." };
    if (!result?.ok) {
      decision.pending = false; decision.failed = true; decision.reason = result?.error || "The answer did not apply.";
      await save();
      await release(decision.id);
      return result;
    }
    if (todoText) {
      decision.todoId = io.id();
      state().todos = [...rows(state().todos), { id: decision.todoId, taskId: decision.taskId, text: String(todoText).slice(0, 400), at: now(), doneAt: null }].slice(-50);
    }
    // Non-retry answers (family decisions, splits, holds) spend the same
    // persisted task budget. A re-arm already appended its own entry.
    await io.mutate((board) => {
      for (const task of board.tasks) {
        if (!ids.includes(task.id)) continue;
        if (!rows(task.assistantRetries).some((entry) => entry.at >= decision.at)) task.assistantRetries = [...backlog.delegatedRetries(task, now()), { at: now(), by: "desk", kind: decision.kind }].slice(-10);
      }
      const created = board.tasks.filter((task) => task.splitFrom === decision.taskId && task.origin?.by === "desk" && !tasks.some((old) => old.id === task.id));
      decision.createdTaskIds = created.map((task) => task.id);
      decision.after = board.tasks.filter((task) => ids.includes(task.id)).map((task) => task.autonomyApplied?.id === decision.id ? task.autonomyApplied.after : ledger.snapshot([task], [task.id])[0]);
      return { ok: true };
    });
    decision.pending = false;
    await save();
    await release(decision.id);
    await notices();
    await save();
    return { ok: true, decisionId: decision.id };
  }

  // Reaching the budget does not spend a third settle. Elevated mode records
  // a reversible hold instead, before any worker may take the card again.
  async function holdBudget(question, config) {
    const projectId = project(), tasks = await io.readTasks(), ids = idsFor(question);
    const targets = tasks.filter((task) => ids.includes(task.id) && !task.autonomyBudgetHold);
    if (!targets.length || targets.some((task) => task.ownerHold || ledger.held(task))) return;
    const decision = { id: io.id(), at: now(), level: config.level, by: "desk", source: "budget", questionId: question.id,
      taskId: question.context?.taskId ?? targets[0].id, kind: "budget", choice: "hold-budget", label: `Held: ${targets[0].title || "task"}`,
      reason: "Its two automatic decisions for today are spent. Review it, Undo the hold, or choose Try again.", before: ledger.snapshot(tasks, targets.map((task) => task.id)), after: [], question: JSON.parse(JSON.stringify(question)), pending: true };
    state().decisions = [...rows(state().decisions), decision].slice(-300);
    await save();
    const live = autonomy.migrate(await io.readSettings());
    const result = await io.mutate((board) => {
      const current = board.tasks.filter((task) => targets.some((target) => target.id === task.id));
      if (project() !== projectId || live.level !== "elevated" || current.some((task) => task.ownerHold || ledger.held(task) || task.autonomyPending || task.autonomyUndo)) return { ok: false };
      decision.before = ledger.snapshot(board.tasks, current.map((task) => task.id));
      for (const task of current) {
        task.autonomyBudgetHold = { at: now(), decisionId: decision.id, reason: decision.reason };
        task.autonomyPending = decision.id;
        task.autonomyApplied = { id: decision.id, after: ledger.snapshot([task], [task.id])[0] };
      }
      decision.after = ledger.snapshot(board.tasks, current.map((task) => task.id));
      return { ok: true };
    });
    decision.pending = false;
    if (!result?.ok) decision.failed = true;
    await save(); await release(decision.id);
  }

  async function release(id) {
    return io.mutate((board) => {
      for (const task of board.tasks) if (task.autonomyPending === id) delete task.autonomyPending;
      return { ok: true };
    });
  }

  async function recover(tasks) {
    for (const decision of rows(state().decisions).filter((row) => row.pending)) {
      const question = rows(state().questions).find((row) => row.id === decision.questionId);
      const proofs = tasks.filter((task) => task.autonomyApplied?.id === decision.id);
      decision.after = proofs.map((task) => task.autonomyApplied.after);
      decision.pending = false;
      decision.interrupted = true;
      if (!proofs.length && question?.status === "open") decision.failed = true;
      else if (!proofs.length) decision.after = decision.before;
      decision.reason = `${decision.reason || "Automatic decision"} (Recovered after an interrupted save; review before continuing.)`;
      if (question && question.status === "answered" && !proofs.length) { question.status = "open"; question.answer = null; question.context = { ...question.context, undoneFrom: decision.id }; }
      await save();
    }
    // A persisted completed decision releases its short reservation on restart.
    for (const id of new Set(tasks.map((task) => task.autonomyPending).filter(Boolean))) {
      const decision = rows(state().decisions).find((row) => row.id === id);
      if (!decision) {
        await io.mutate((board) => { for (const task of board.tasks) if (task.autonomyPending === id) { task.ownerHold = { at: now(), reason: "An automatic decision was interrupted before it was saved. Review this task." }; delete task.autonomyPending; } return { ok: true }; });
      } else if (!decision.pending) { await save(); await release(id); }
    }
  }

  async function decide() {
    if (busy || now() < backoffUntil || !project()) return null;
    busy = true;
    try {
      await io.ensure();
      const projectId = project(), passRevision = revision;
      const config = autonomy.migrate(await io.readSettings());
      for (const decision of rows(state().decisions).filter((row) => row.undoPending && !row.undone)) await undo({ id: decision.id, projectId });
      await recover(await io.readTasks());
      const tasks = await io.readTasks(), byId = new Map(tasks.map((task) => [task.id, task]));
      const queue = await notices(tasks);
      const cleared = await io.cleared?.() ?? {};
      const questions = rows(state().questions).filter((question) => question.status === "open" && Number(cleared[question.id] ?? -1) < Number(question.at));
      for (const item of queue.items.filter((entry) => ["parked", "held"].includes(entry.kind))) {
        const task = byId.get(item.taskId);
        // A card waiting on the owner's word about work done outside Studio
        // is not a failed run to re-ask about (outside-work.cjs).
        if (!task || task.ownerHold || task.loopGuard?.by === "owner" || task.relevance?.state === "ask" || questions.some((question) => question.context?.taskId === task.id)) continue;
        // An ask about this card that was already settled or left for review
        // since it parked covers this park: raising it again would put the
        // card the owner just dismissed straight back on their list. A card
        // that parks again later (a newer item.at) is asked about afresh.
        const settled = rows(state().questions).some((question) => question.context?.taskId === task.id && ["answered", "dismissed"].includes(question.status)
          && Number(question.answer?.at ?? question.at) >= Number(item.at));
        if (settled) continue;
        const kind = Number(task.verifyAttempts) >= 3 || task.verification?.state === "failed" ? "verify" : "run-failed";
        const question = io.question(issues.questionForIssue({ kind, source: "host", taskId: task.id, taskTitle: task.title, title: item.title, attempts: task.runFailures ?? 0 }, { now: now() }));
        if (question) questions.push(question);
      }
      let spent = 0;
      for (const question of questions) {
        if (spent >= desk.LIMITS.perPass || revision !== passRevision || project() !== projectId) break;
        const task = byId.get(question.context?.taskId) ?? null;
        const repair = issues.repairQuestion(question, { now: now(), attempts: task?.runFailures ?? 0 });
        if (repair) Object.assign(question, repair);
        const result = autonomy.sessionless(task ?? {});
        // Earlier versions saved this blanket refusal before attempting any
        // repair. Reconsider only that stale refusal, never an owner's Undo.
        if (result.eligible && !question.context?.undoneFrom
          && question.context?.suggestion?.reason === "I need recorded, named passing checks for this run before I can confirm it.") delete question.context.suggestion;
        if (question.context?.suggestion || question.context?.undoneFrom || task?.ownerHold) continue;
        if (result.eligible) {
          question.context = { ...question.context, sessionless: true };
          // Missing evidence forbids confirmation, not repair. Keep ordinary
          // retry/instruction options so Auto can obtain the missing checks.
          if (result.canConfirm) question.options = [{ id: "confirm-result", label: "Confirm the checked result", recommended: true, action: { kind: "confirm-result", taskId: task.id, runId: result.runId } }, { id: "hold", label: "Leave it for review", dismiss: true }];
        }
        const isAccepted = autonomy.accepted(task, { tasks });
        const humanClassify = question.context?.issueKind === "owner" && ["auto", "elevated"].includes(config.level);
        const initial = autonomy.route({ ...config, item: question, task, accepted: isAccepted });
        if (initial === "owner" && !humanClassify) continue;
        if (question.context?.raisedBy === "desk") continue;
        if (humanClassify) {
          // Reuse a current, explicit family decision; a model cannot invent
          // a merge or choose unrelated cards from their titles.
          const family = questions.find((row) => row !== question && row.status === "open" && row.source === "family" && row.options?.some((option) => option.action?.kind === "family" && option.action.memberIds?.includes(task?.id)));
          const merge = family?.options.find((option) => option.action?.choice === "keep-oldest");
          question.options = question.options.filter((option) => option.id !== "merge-family");
          if (merge) question.options.push({ ...structuredClone(merge), id: "merge-family", label: "Merge this duplicate family" });
        }
        const ids = idsFor(question);
        const affected = tasks.filter((row) => ids.includes(row.id));
        if (affected.some((row) => row.ownerHold || ledger.held(row))) continue;
        const key = task?.id ?? question.id;
        const room = desk.budget(state().decideHistory, key, now());
        if (!room.ok || affected.some((row) => backlog.delegatedRetries(row, now()).length >= 2)) {
          if (room.reason === "hour") break;
          if (config.level === "elevated") await holdBudget(question, config);
          continue;
        }
        if (humanClassify) {
          for (const verb of ["retry", "retry-deep", "split"]) {
            if (verb === "retry-deep" && config.elevated["pricier-model"]) continue;
            if (!question.options.some((option) => option.id === verb)) question.options.push({ id: verb, label: { retry: "Retry in Studio", "retry-deep": "Retry with a heavier model", split: "Split the work" }[verb], action: { kind: "issue", action: verb, payload: { taskId: task?.id, issueKind: "blocked", ask: question.title, detail: question.detail } } });
          }
        }
        const options = rows(question.options).filter((option) => {
          if (option.action?.choice === "keep-oldest" && config.elevated["drop-owned"] && affected.some((row) => row.origin?.by === "owner" && row.id !== option.action.keepId)) return false;
          if (humanClassify) return option.action?.action !== "retry-deep" || !config.elevated["pricier-model"];
          const elevated = autonomy.classify({ question, task, option });
          return !elevated || config.elevated[elevated] === false;
        });
        if (!options.length) continue;
        const learned = memory.advise(question.context?.issueKind ?? question.source, options, await io.learning?.() ?? []);
        const context = { ...await io.context?.(task?.id), ...(learned ? { learned, preference: `The owner usually picks ${learned.verb} for this kind of decision (${learned.count} of ${learned.n}; ${learned.scope}).` } : {}) };
        const prompt = desk.resolvePrompt({ question, task, options, context, classifyOwner: humanClassify });
        const response = await io.callDesk(prompt);
        if (revision !== passRevision || project() !== projectId) break;
        if (!response?.ok) { backoffUntil = now() + 5 * 60000; break; }
        const choice = desk.parseResolution(response.text, options);
        if (!choice) { backoffUntil = now() + 5 * 60000; break; }
        spent += 1;
        state().decideHistory = desk.spend(state().decideHistory, key, now());
        let option = options.find((row) => row.id === choice.optionId);
        choice.confidence = memory.confidence(choice.confidence, option, learned);
        let route = autonomy.route({ ...config, item: question, task, accepted: isAccepted, confidence: choice.confidence, learned, option });
        if (initial === "advise") route = "advise";
        if (humanClassify) {
          if (choice.classification === "human" && choice.confidence >= 0.7) {
            option = options.find((row) => row.id === "acknowledge");
            if (option) await apply(question, { ...choice, optionId: option.id }, config, { todoText: choice.text || question.detail || question.title, learned });
          } else if (choice.classification === "studio" && choice.confidence >= 0.7 && option && option.id !== "acknowledge" && !option.dismiss) {
            await apply(question, choice, config, { learned });
          } else {
            question.context = { ...question.context, suggestion: { optionId: null, reason: choice.reason || "This may be work Studio can handle. Please give a direction.", at: now() } };
          }
        } else {
          if (route === "mefi-safe" || choice.leave && config.level === "elevated") {
            option = options.find((row) => row.recommended && row.action?.action !== "instruct") ?? options.find((row) => row.dismiss || row.id === "hold");
          }
          if (!option || route === "advise" || route === "owner" || choice.leave && config.level !== "elevated") {
            question.context = { ...question.context, suggestion: { optionId: option?.id ?? null, reason: choice.reason || "I need your direction here.", at: now() } };
          } else {
            await apply(question, { ...choice, optionId: option.id }, config, { learned });
          }
        }
        await save();
      }
      await notices();
      await save();
      return { ok: true, spent };
    } finally { busy = false; }
  }

  const operation = (fn) => async (...args) => { operations++; try { return await fn(...args); } finally { operations--; } };
  return { state: view, set: operation(set), undo: operation(undo), todo: operation(todo), decide, notices, apply: operation(apply), get busy() { return busy || operations > 0; } };
}

module.exports = { createAutonomyHost };
