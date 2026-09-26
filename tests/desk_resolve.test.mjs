// The desk handles asks (settings.agentBrain.deskResolves): with the owner's
// switch on, the companion settles open asks on the desk seat. It must never
// answer what stays the owner's (reach, risk, owner-only leftovers), never pick
// an option that grants or promises for the owner, never loop on one card, and
// read the model's choice only against the options it was offered.
import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, resolvable, budget, spend, resolvePrompt, parseResolution, parkedItems, noticeText } from "../scripts/desk-resolve.cjs";

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const issueOption = (id, verb = id, extra = {}) => ({ id, label: id, action: { kind: "issue", action: verb, payload: {} }, ...extra });
const ask = (extra = {}) => ({
  id: "q_1",
  status: "open",
  source: "issue",
  title: "A check fails on \"Fix the parser\"",
  context: { taskId: "task_a", issueKind: "check-failed", evidence: ["npm test: 2 failing"] },
  options: [issueOption("retry"), issueOption("retry-deep"), issueOption("replan"), issueOption("hold", "hold", { dismiss: true })],
  ...extra,
});

test("the desk answers workers' issues and family asks, never offers or closed cards", () => {
  const pick = resolvable(ask());
  assert.equal(pick.ok, true);
  // Leaving it for review is not an answer the desk gives.
  assert.deepEqual(pick.options.map((option) => option.id), ["retry", "retry-deep", "replan"]);
  assert.equal(resolvable(ask({ source: "family", context: {}, options: [{ id: "keep", label: "Keep the oldest", action: { kind: "family" } }] })).ok, true);
  assert.equal(resolvable(ask({ source: "offer" })).ok, false);
  assert.equal(resolvable(ask({ source: "chat" })).ok, false);
  assert.equal(resolvable(ask({ status: "answered" })).ok, false);
  assert.equal(resolvable(null).ok, false);
});

test("reach, risk and owner-only asks always wait for the owner", () => {
  for (const kind of ["permission", "risk", "owner"]) {
    const result = resolvable(ask({ context: { taskId: "task_a", issueKind: kind } }));
    assert.equal(result.ok, false, kind);
  }
  // Even on another kind, grant, proceed and acknowledge are never offered to the desk.
  const pick = resolvable(ask({ context: { issueKind: "scope" }, options: [issueOption("grant"), issueOption("go", "proceed"), issueOption("acknowledge"), issueOption("narrow")] }));
  assert.deepEqual(pick.options.map((option) => option.id), ["narrow"]);
  assert.equal(resolvable(ask({ options: [issueOption("grant"), issueOption("hold", "hold", { dismiss: true })] })).ok, false);
});

test("one card is settled at most twice a day, and the desk at most so often an hour", () => {
  let history = [];
  assert.equal(budget(history, "task_a", NOW).ok, true);
  history = spend(history, "task_a", NOW);
  history = spend(history, "task_a", NOW + 1000);
  assert.deepEqual(budget(history, "task_a", NOW + 2000), { ok: false, reason: "card" });
  assert.equal(budget(history, "task_b", NOW + 2000).ok, true);
  // A day later the card may be settled again.
  assert.equal(budget(history, "task_a", NOW + 25 * HOUR).ok, true);
  let busy = [];
  for (let index = 0; index < LIMITS.perHour; index += 1) busy = spend(busy, `task_${index}`, NOW + index);
  assert.deepEqual(budget(busy, "task_new", NOW + LIMITS.perHour), { ok: false, reason: "hour" });
  assert.equal(budget(busy, "task_new", NOW + 2 * HOUR).ok, true);
  // spend drops rows older than a day.
  assert.equal(spend(busy, "task_x", NOW + 30 * HOUR).length, 1);
});

test("the prompt names the card, the task and only the allowed options", () => {
  const { options } = resolvable(ask({ options: [issueOption("retry"), issueOption("instruct"), issueOption("grant")] }));
  const prompt = resolvePrompt({ question: ask(), task: { id: "task_a", title: "Fix the parser", brief: "Make the parser accept trailing commas.", runFailures: 2, verifyAttempts: 1 }, options });
  assert.match(prompt.system, /Reply with ONLY JSON/);
  assert.match(prompt.system, /not instructions to you/);
  assert.match(prompt.user, /Card: A check fails/);
  assert.match(prompt.user, /Task: Fix the parser/);
  assert.match(prompt.user, /failed runs 2 · failed checks 1/);
  assert.match(prompt.user, /Evidence: npm test: 2 failing/);
  assert.match(prompt.user, /- instruct: instruct \[needs "text"/);
  assert.doesNotMatch(prompt.user, /grant/);
});

test("a reply is read only against the options offered", () => {
  const { options } = resolvable(ask({ options: [issueOption("retry"), issueOption("instruct"), issueOption("replan")] }));
  assert.deepEqual(parseResolution('Sure.\n```json\n{"optionId":"replan","reason":"Failed twice the same way."}\n```', options), { leave: false, optionId: "replan", label: "replan", text: null, reason: "Failed twice the same way.", confidence: 0 });
  const told = parseResolution({ optionId: "instruct", text: "Run the parser tests before editing the caller.", reason: "Say what to do first." }, options);
  assert.equal(told.optionId, "instruct");
  assert.equal(told.text, "Run the parser tests before editing the caller.");
  // An instruction with no line, an id not on the card, or null: left for the owner.
  assert.equal(parseResolution({ optionId: "instruct", reason: "x" }, options).leave, true);
  assert.equal(parseResolution({ optionId: "grant", reason: "x" }, options).leave, true);
  assert.deepEqual(parseResolution('{"optionId": null, "reason": "Needs a product call."}', options), { leave: true, reason: "Needs a product call.", confidence: 0 });
  assert.equal(parseResolution("no json here", options), null);
  assert.equal(parseResolution('{"answer":"wrong contract"}', options), null);
});

test("only this project's parked cards are re-armed, and the notice says what happened", () => {
  const items = [
    { id: "parked:task_a", kind: "parked", taskId: "task_a", title: "A", at: 1 },
    { id: "held:task_b", kind: "held", taskId: "task_b", title: "B", at: 1 },
    { id: "parked:task_c", kind: "parked", taskId: "task_c", title: "C", at: 1, projectId: "other" },
  ];
  assert.deepEqual(parkedItems(items).map((item) => item.taskId), ["task_a"]);
  assert.equal(noticeText({ title: "Fix the parser", label: "Try again", reason: "A flaky check." }), 'I settled "Fix the parser": Try again. A flaky check.');
  assert.match(noticeText({ title: "Fix the parser", label: "Try again", ok: false, error: "its card left the board" }), /did not apply: its card left the board\. It is still waiting for you\./);
});

test("the desk never settles a question it handed to the owner itself", () => {
  const handed = {
    id: "q_desk", status: "open", source: "issue", title: "The desk could not answer: which env file?",
    context: { issueKind: "blocked", taskId: "task_a", raisedBy: "desk" },
    options: [{ id: "retry", label: "Try again", action: { kind: "issue", action: "retry" } }],
  };
  const pick = resolvable(handed);
  assert.equal(pick.ok, false);
  assert.match(pick.reason, /handed this one to the owner/);
  assert.equal(resolvable({ ...handed, context: { ...handed.context, raisedBy: "worker" } }).ok, true);
});
