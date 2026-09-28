import test from "node:test";
import assert from "node:assert/strict";
import { createAutonomyHost } from "../scripts/autonomy-host.cjs";
import issues from "../scripts/agent-issues.cjs";
import backlog from "../scripts/backlog.cjs";
import ledger from "../scripts/decision-ledger.cjs";
import { emptyState, normalizeState } from "../scripts/assistant.mjs";

const NOW = 1800000000000;
function fixture({ level = "auto", kind = "scope", accepted = false, task: extra = {}, reply = { optionId: "narrow", confidence: 0.9, reason: "Keep the agreed scope." } } = {}) {
  let state = emptyState(NOW), time = NOW, project = "project";
  let settings = { autonomy: { level, elevated: {} } }, calls = 0, seq = 0;
  const task = { id: "task", title: "Fix the parser", status: "open", origin: { by: "owner" }, logs: [], ...extra };
  if (accepted) task.buildApproval = { version: 1, scope: backlog.buildScope(task), approvedAt: NOW };
  const board = { tasks: [task] }, answers = [], saves = [], corrections = [];
  const question = { ...issues.questionForIssue({ kind, taskId: "task", title: "A decision", source: "worker" }, { now: NOW }), id: "q", at: NOW, status: "open" };
  state.questions.push(question);
  const io = {
    now: () => time, getState: () => state, ensure: async () => {}, projectId: () => project, id: () => `d${++seq}`,
    readSettings: async () => structuredClone(settings), updateSettings: async (fn) => fn(settings),
    setAutopilot: async (prefs) => { settings.ui = { autopilot: prefs }; },
    readTasks: async () => structuredClone(board.tasks), mutate: async (fn) => fn(board),
    save: async () => saves.push(structuredClone(state)), cleared: async () => ({}),
    question: (row) => { const q = { ...row, id: `q${++seq}`, at: time, status: "open" }; state.questions.push(q); return q; },
    correction: async (decision) => corrections.push(decision.choice),
    callDesk: async () => { calls++; return typeof reply === "function" ? reply() : { ok: true, text: JSON.stringify(reply) }; },
    answer: async (payload) => {
      answers.push(payload);
      const q = state.questions.find((row) => row.id === payload.id);
      const option = q.options.find((row) => row.id === payload.optionId);
      if (!option) return { ok: false, error: "missing option" };
      if (!option.dismiss && option.id !== "acknowledge") {
        const next = backlog.delegateRetry(board.tasks[0], time, { by: "desk", kind: q.context.issueKind });
        if (!next.ok) return next;
        board.tasks[0] = next.task;
      }
      if (payload.decisionId) board.tasks[0].autonomyApplied = { id: payload.decisionId, after: ledger.snapshot(board.tasks, ["task"])[0] };
      q.status = option.dismiss ? "dismissed" : "answered";
      q.answer = { optionId: option.id, by: "desk" };
      return { ok: true };
    },
  };
  let host = createAutonomyHost(io);
  return {
    board, answers, saves, corrections, io, question,
    get host() { return host; }, get state() { return state; }, get settings() { return settings; }, get calls() { return calls; },
    advance: (ms) => { time += ms; }, switchProject: () => { project = "other"; },
    restart: () => { state = normalizeState(JSON.parse(JSON.stringify(state)), time); host = createAutonomyHost(io); },
  };
}

test("Always ask stores one suggestion durably and performs no action", async () => {
  const f = fixture({ level: "ask" });
  await f.host.decide();
  assert.equal(f.answers.length, 0);
  assert.equal(f.question.context.suggestion.optionId, "narrow");
  f.restart();
  await f.host.decide();
  assert.equal(f.calls, 1);
  assert.equal(f.state.questions[0].context.suggestion.reason, "Keep the agreed scope.");
});

test("Accept per task delegates only accepted task scopes", async () => {
  for (const accepted of [false, true]) {
    const f = fixture({ level: "accept", accepted });
    await f.host.decide();
    assert.equal(f.answers.length, accepted ? 1 : 0);
  }
});

test("a parked card's ask left for review stays off the list until the card parks again", async () => {
  for (const level of ["ask", "auto"]) {
    const f = fixture({ level, task: { runFailures: 5, parkedAt: NOW - 60000 }, reply: { optionId: null, confidence: 0.2, reason: "This needs you." } });
    f.question.status = "superseded";
    const raised = () => f.state.questions.filter((q) => q.context?.taskId === "task" && q !== f.question);
    await f.host.decide();
    assert.equal(raised().length, 1, `${level}: the parked card gets one ask`);
    const ask = raised()[0];
    ask.status = "dismissed";
    ask.answer = { at: NOW, optionId: "hold", label: "Leave it for review", via: "option" };
    f.advance(60000);
    await f.host.decide();
    await f.host.decide();
    assert.equal(raised().length, 1, `${level}: left for review, it is not raised again`);
    f.board.tasks[0].parkedAt = NOW + 120000;
    f.advance(120000);
    await f.host.decide();
    assert.equal(raised().length, 2, `${level}: parked again later, it is asked about afresh`);
  }
});

test("Auto saves its decision, Undo restores the parked budget and does not refund automatic retries", async () => {
  const f = fixture({ kind: "run-failed", task: { runFailures: 5 }, reply: { optionId: "retry", confidence: 0.9, reason: "The transient failure has cleared." } });
  await f.host.decide();
  assert.equal(f.board.tasks[0].runFailures, 3);
  assert.equal(f.state.decisions.length, 1);
  assert.equal(f.state.decisions[0].pending, false);
  f.restart();
  const result = await f.host.undo({ id: f.state.decisions[0].id, projectId: "project" });
  assert.equal(result.pending, false);
  assert.equal(f.board.tasks[0].runFailures, 5);
  assert.equal(f.board.tasks[0].assistantRetries.length, 1);
  assert.equal(f.state.questions[0].status, "open");
  assert.equal(f.corrections.length, 1);
  await f.host.decide();
  assert.equal(f.answers.length, 1, "an undone choice cannot immediately repeat");
});

test("low confidence advises in Auto and uses the safe recommendation in Elevated only", async () => {
  const auto = fixture({ reply: { optionId: "split", confidence: 0.2, reason: "Unclear scope." } });
  await auto.host.decide();
  assert.equal(auto.answers.length, 0);
  const elevated = fixture({ level: "elevated", reply: { optionId: "split", confidence: 0.2, reason: "Unclear scope." } });
  await elevated.host.decide();
  assert.equal(elevated.answers[0].optionId, "narrow");
});

test("elevated permissions stay with the owner and disabling grant requires its warning acknowledgement", async () => {
  const f = fixture({ level: "elevated", kind: "permission", reply: { optionId: "grant", confidence: 1 } });
  await f.host.decide();
  assert.equal(f.calls, 0);
  assert.equal((await f.host.set({ elevated: { grant: false } })).warning, "grant");
  assert.equal((await f.host.set({ elevated: { grant: false }, confirmed: ["grant"] })).ok, true);
  await f.host.decide();
  assert.equal(f.answers[0].optionId, "grant");
});

test("transport errors retry after backoff without spending or marking the card left", async () => {
  let ready = false;
  const f = fixture({ reply: () => ready ? { ok: true, text: '{"optionId":"narrow","confidence":1}' } : { ok: false, error: "offline" } });
  await f.host.decide();
  assert.equal(f.state.decideHistory.length, 0);
  assert.equal(f.question.context.suggestion, undefined);
  ready = true;
  f.advance(5 * 60000);
  await f.host.decide();
  assert.equal(f.answers.length, 1);
});

test("a mode change or project switch while the desk thinks discards its answer", async () => {
  for (const change of ["mode", "project"]) {
    let reply;
    const f = fixture({ reply: () => new Promise((resolve) => { reply = resolve; }) });
    const pass = f.host.decide();
    while (!reply) await new Promise((resolve) => setImmediate(resolve));
    if (change === "mode") await f.host.set({ level: "ask" }); else f.switchProject();
    reply({ ok: true, text: '{"optionId":"narrow","confidence":1}' });
    await pass;
    assert.equal(f.answers.length, 0, change);
  }
});

test("real-world leftovers become bounded For you items and can be completed or undone", async () => {
  const f = fixture({ kind: "owner", reply: { optionId: "acknowledge", classification: "human", confidence: 0.95, text: "Connect the test device.", reason: "This requires physical access." } });
  await f.host.decide();
  assert.equal(f.state.todos[0].text, "Connect the test device.");
  assert.equal(f.question.status, "answered");
  assert.equal((await f.host.todo({ id: f.state.todos[0].id, action: "done" })).ok, true);
  assert.ok(f.state.todos[0].doneAt);
  await f.host.undo({ id: f.state.decisions[0].id });
  assert.equal(f.state.todos.length, 0);
});

test("Undo waits for a worker, then applies on the next pass without stopping that worker", async () => {
  const f = fixture();
  await f.host.decide();
  f.board.tasks[0].status = "active"; f.board.tasks[0].runId = "r";
  assert.equal((await f.host.undo({ id: f.state.decisions[0].id })).pending, true);
  assert.equal(f.board.tasks[0].runId, "r");
  f.board.tasks[0].status = "open"; delete f.board.tasks[0].runId;
  await f.host.decide();
  assert.ok(f.state.decisions[0].undone);
  assert.equal(f.board.tasks[0].autonomyUndo, undefined);
});


test("a decision reserves its task until the undo evidence is saved", async () => {
  const f = fixture();
  const answer = f.io.answer;
  f.io.answer = async (payload) => {
    assert.equal(backlog.workState(f.board.tasks[0]).blockedBy, "decision");
    const result = await answer(payload);
    assert.equal(backlog.workState(f.board.tasks[0]).stage, "blocked");
    return result;
  };
  await f.host.decide();
  assert.equal(backlog.workState(f.board.tasks[0]).stage, "ready");
  assert.equal(f.board.tasks[0].autonomyPending, undefined);
});

test("an interrupted answer is recovered from its task proof and remains undoable", async () => {
  const f = fixture({ kind: "run-failed", task: { runFailures: 5 }, reply: { optionId: "retry", confidence: 1, reason: "Retry with corrected configuration." } });
  const answer = f.io.answer;
  f.io.answer = async (payload) => { await answer(payload); throw new Error("simulated interruption after the board write"); };
  await assert.rejects(f.host.decide(), /simulated interruption/);
  assert.ok(f.board.tasks[0].autonomyPending);
  f.io.answer = answer;
  f.restart();
  await f.host.decide();
  assert.equal(f.state.decisions[0].pending, false);
  assert.equal(f.board.tasks[0].autonomyPending, undefined);
  await f.host.undo({ id: f.state.decisions[0].id });
  assert.equal(f.board.tasks[0].runFailures, 5);
});

test("daily card budgets survive restart and an owner hold never changes", async () => {
  for (const task of [{ assistantRetries: [{ at: NOW - 10, by: "desk" }, { at: NOW - 5, by: "desk" }] }, { ownerHold: { at: NOW - 5, reason: "wait" } }]) {
    const f = fixture({ task });
    f.restart(); await f.host.decide();
    assert.equal(f.answers.length, 0);
    assert.equal(f.calls, 0);
  }
});

test("sessionless results stay with the owner in Accept and without recorded checks", async () => {
  const task = { verifyAttempts: 3, verification: { state: "failed", reason: "codex runs leave no session the verifier can read" }, lastAttempt: { route: "codex", runId: "run1", code: 0, result: { parts: { remaining: "none" } } }, verificationRun: { key: "verify:run1", results: [{ command: "npm test", exitCode: 0, ok: true }] } };
  for (const [level, withChecks, expected] of [["accept", true, 0], ["auto", false, 0], ["auto", true, 1]]) {
    const f = fixture({ level, kind: "verify", accepted: true, task: { ...task, verificationRun: withChecks ? task.verificationRun : null }, reply: { optionId: "confirm-result", confidence: 1, reason: "The recorded check passed." } });
    await f.host.decide();
    assert.equal(f.answers.length, expected, `${level}: recorded=${withChecks}`);
  }
});


test("a failed history save prevents the answer and keeps its task reserved until recovery", async () => {
  const f = fixture();
  const save = f.io.save;
  f.io.save = async () => { throw new Error("disk unavailable"); };
  await assert.rejects(f.host.decide(), /disk unavailable/);
  assert.equal(f.answers.length, 0);
  assert.ok(f.board.tasks[0].autonomyPending);
  f.io.save = save;
  await f.host.decide();
  assert.equal(f.state.decisions[0].failed, true);
  assert.equal(f.board.tasks[0].autonomyPending, undefined);
});


test("strong learned agreement raises confidence while disagreement leaves Auto with a suggestion", async () => {
  const preference = [{ kind: "scope", scope: "project", n: 8, verbs: [{ verb: "narrow", share: 0.875, count: 7 }] }];
  const match = fixture({ reply: { optionId: "narrow", confidence: 0.6, reason: "Matches the saved preference." } });
  match.io.learning = async () => preference;
  await match.host.decide();
  assert.equal(match.answers.length, 1); assert.equal(match.state.decisions[0].learnedFrom.verb, "narrow");
  const different = fixture({ reply: { optionId: "split", confidence: 0.99, reason: "Extra scope." } });
  different.io.learning = async () => preference;
  await different.host.decide();
  assert.equal(different.answers.length, 0); assert.equal(different.question.context.suggestion.optionId, "split");
});

test("Elevated holds an exhausted card durably with one reversible decision and no third settle", async () => {
  const f = fixture({ level: "elevated", task: { assistantRetries: [{ at: NOW - 1000, by: "desk" }, { at: NOW - 500, by: "desk" }] } });
  await f.host.decide();
  assert.equal(f.calls, 0);
  assert.equal(f.answers.length, 0);
  assert.equal(f.state.decisions.length, 1);
  assert.equal(f.state.decisions[0].choice, "hold-budget");
  assert.equal(backlog.workState(f.board.tasks[0], NOW).blockedBy, "decision-budget");
  assert.match(f.state.messages.find((row) => row.taskId === "__decided_for_you__").text, /Held: Fix the parser/);
  f.restart(); await f.host.decide();
  assert.equal(f.state.decisions.length, 1, "relaunch does not repeat the hold");
  assert.equal(f.board.tasks[0].assistantRetries.length, 2);
  await f.host.undo({ id: f.state.decisions[0].id });
  assert.equal(f.board.tasks[0].autonomyBudgetHold, undefined);
  assert.equal(f.board.tasks[0].assistantRetries.length, 2, "Undo never refunds the budget");
  await f.host.decide(); assert.equal(f.state.decisions.length, 1, "an undone hold stays with its owner");
});

test("Studio leftovers can reuse a named duplicate family without closing owner work", async () => {
  for (const protect of [true, false]) {
    const f = fixture({ kind: "owner", reply: { optionId: "merge-family", classification: "studio", confidence: 0.95, reason: "These cards duplicate the same brief." } });
    f.settings.autonomy.elevated["drop-owned"] = protect;
    f.board.tasks.push({ id: "keeper", title: "Keep this parser task", status: "open", origin: { by: "agent" } });
    f.state.questions.push({ id: "family", status: "open", at: NOW, source: "family", context: {}, options: [{ id: "keep-oldest", label: "Keep the original", action: { kind: "family", choice: "keep-oldest", keepId: "keeper", memberIds: ["keeper", "task"] } }] });
    f.io.answer = async (payload) => {
      f.answers.push(payload);
      const question = f.state.questions.find(row => row.id === payload.id);
      const option = question.options.find(row => row.id === payload.optionId);
      assert.deepEqual(option.action.memberIds, ["keeper", "task"]);
      question.status = "answered";
      return { ok: true };
    };
    await f.host.decide();
    assert.equal(f.answers.some(row => row.id === "q"), !protect);
    if (!protect) assert.deepEqual(f.state.decisions[0].before.map(row => row.id).sort(), ["keeper", "task"]);
  }
});

test("a mode change while saving the decision cancels the pending answer and releases its reservation", async () => {
  const f = fixture();
  const saved = f.io.save;
  let changed = false;
  f.io.save = async () => {
    await saved();
    if (!changed && f.state.decisions.some((row) => row.pending)) { changed = true; await f.host.set({ level: "ask" }); }
  };
  await f.host.decide();
  assert.equal(f.answers.length, 0);
  assert.equal(f.question.status, "open");
  assert.equal(f.state.decisions[0].failed, true);
  assert.equal(f.board.tasks[0].autonomyPending, undefined);
});


test("Auto repairs a legacy owner leftover without pretending missing sessionless checks passed", async () => {
  const f = fixture({ kind: "owner", task: {
    verification: { state: "failed", reason: "codex runs leave no session the verifier can read" },
    verifyAttempts: 3, lastAttempt: { route: "codex", runId: "run1", code: 0,
      result: { parts: { remaining: "none", owner: "reconcile concurrent Analyzer test failures and existing test-history archive conflict" } } },
  }, reply: { optionId: "retry", confidence: 0.95, reason: "Preserve concurrent edits, repair regressions, then rerun checks." } });
  for (const option of f.question.options) option.action.payload.ask = f.board.tasks[0].lastAttempt.result.parts.owner;
  f.question.context.suggestion = { optionId: null, reason: "I need recorded, named passing checks for this run before I can confirm it.", at: NOW - 1 };
  await f.host.decide();
  assert.equal(f.question.context.issueKind, "check-failed");
  assert.equal(f.answers.length, 1);
  assert.equal(f.answers[0].optionId, "retry");
  assert.equal(f.board.tasks[0].status, "open");
  assert.equal(f.board.tasks[0].assistantRetries.length, 1);
  assert.equal(f.state.todos.length, 0);
  assert.ok(!f.question.options.some(option => option.id === "confirm-result"));
});

test("a saved missing-evidence refusal allows a bounded Auto verification retry", async () => {
  const f = fixture({ kind: "verify", task: {
    verification: { state: "failed", reason: "codex runs leave no session the verifier can read" },
    verifyAttempts: 3, lastAttempt: { route: "codex", runId: "run1", code: 0 },
  }, reply: { optionId: "retry", confidence: 0.95, reason: "Run the named verification commands." } });
  f.question.context.suggestion = { optionId: null, reason: "I need recorded, named passing checks for this run before I can confirm it.", at: NOW - 1 };
  await f.host.decide();
  assert.equal(f.answers.length, 1);
  assert.equal(f.answers[0].optionId, "retry");
  assert.equal(f.board.tasks[0].assistantRetries.length, 1);
});


test("Auto clears agent proposals from Needs you; switching back restores the approval gate", async () => {
  const f = fixture({ task: { origin: { kind: "request", by: "overseer" } } });
  f.state.questions.length = 0;
  f.settings.autonomy.elevated["agent-filed"] = true;
  assert.equal((await f.host.notices()).counts.approval, 0);
  await f.host.set({ level: "elevated" });
  assert.equal((await f.host.notices()).counts.approval, 1);
  await f.host.set({ level: "auto" });
  assert.equal((await f.host.notices()).counts.total, 0);
});

test("a decision that failed to apply cannot be undone or taught as a correction", async () => {
  const f = fixture({ kind: "run-failed", task: { runFailures: 5 }, reply: { optionId: "retry", confidence: 0.9, reason: "The transient failure has cleared." } });
  await f.host.decide();
  f.state.decisions[0].failed = true;
  const result = await f.host.undo({ id: f.state.decisions[0].id, projectId: "project" });
  assert.equal(result.ok, false);
  assert.equal(f.corrections.length, 0, "no correction for a choice that never applied");
  assert.ok(!f.state.decisions[0].undone);
});
