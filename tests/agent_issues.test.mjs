// An agent that hits a decision must reach the owner as a question about the
// WORK — the task, what it saw, and options that act on that task — and the
// two decisions nobody may automate (granting reach, accepting a risk) must
// stay the owner's whatever a brain map says.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ISSUE_MARK, ISSUE_KIND_IDS, ALWAYS_ASK, parseIssueLine, normalizeIssue, normalizePolicy,
  collectIssues, triageIssue, questionForIssue, runFailureIssue, issuePromptLine,
} from "../scripts/agent-issues.cjs";

const worker = (kind, title, extra = {}) => normalizeIssue({ kind, title, source: "worker", taskId: "task_1", taskTitle: "Add the retry banner", ...extra });

test("the ask mark is read only at the start of a line", () => {
  assert.equal(parseIssueLine(`${ISSUE_MARK} scope :: the store is missing :: only the view is briefed`).kind, "scope");
  assert.equal(parseIssueLine(`I will print a ${ISSUE_MARK} line when I know`), null);
  assert.equal(parseIssueLine(`  ${ISSUE_MARK} blocked :: another agent holds main.cjs`).kind, "blocked");
  // Colour codes around the mark must not hide it, exactly like the verdict.
  assert.equal(parseIssueLine(`\u001b[32m${ISSUE_MARK}\u001b[0m risk :: this drops the table`).kind, "risk");
  assert.equal(parseIssueLine(ISSUE_MARK), null);
  assert.equal(parseIssueLine("MEFI_JOB_DONE"), null);
});

test("an unknown kind is heard as a plain conflict rather than dropped", () => {
  const issue = parseIssueLine(`${ISSUE_MARK} wibble :: which of the two stores wins?`);
  assert.equal(issue.kind, "conflict");
  assert.equal(issue.title, "wibble :: which of the two stores wins?".slice(0, issue.title.length));
});

test("JSON payloads carry evidence and the task they belong to", () => {
  const issue = parseIssueLine(`${ISSUE_MARK} {"kind":"check-failed","title":"board tests fail","taskId":"task_9","file":"tests/board.test.mjs","evidence":["FAIL tests/board.test.mjs","1 failing"]}`);
  assert.equal(issue.kind, "check-failed");
  assert.equal(issue.taskId, "task_9");
  assert.equal(issue.file, "tests/board.test.mjs");
  assert.deepEqual(issue.evidence, ["FAIL tests/board.test.mjs", "1 failing"]);
  assert.equal(issue.severity, "decision");
});

test("one run cannot flood Ask", () => {
  const lines = [
    `${ISSUE_MARK} scope :: one`,
    `${ISSUE_MARK} scope :: one`, // the CLI reprinting its own output
    `${ISSUE_MARK} blocked :: two`,
    `${ISSUE_MARK} missing :: three`,
    `${ISSUE_MARK} risk :: four`,
  ];
  assert.equal(collectIssues(lines).length, 3);
  assert.equal(collectIssues(lines, { max: 1 }).length, 1);
});

test("a permission or a risk is always the owner's, whatever the policy says", () => {
  for (const kind of ["permission", "risk"]) {
    assert.ok(ALWAYS_ASK.has(kind));
    const triage = triageIssue(worker(kind, "it wants main.cjs", { permission: "write-files" }), {
      policy: { auto: ISSUE_KIND_IDS, autoRetryLimit: 5 },
    });
    assert.equal(triage.decision, "ask", `${kind} must reach the owner`);
  }
  assert.deepEqual(normalizePolicy({ auto: ["permission", "risk", "blocked"] }).auto, ["blocked"]);
});

test("a retryable issue is settled by the assistant until the budget runs out", () => {
  const issue = worker("check-failed", "the css gate is red", { attempts: 0 });
  const first = triageIssue(issue, { policy: { auto: ["check-failed"], autoRetryLimit: 2 } });
  assert.equal(first.decision, "auto");
  assert.equal(first.answer.verb, "retry");
  const spent = triageIssue({ ...issue, attempts: 2 }, { policy: { auto: ["check-failed"], autoRetryLimit: 2 } });
  assert.equal(spent.decision, "ask");
  // A map that settles nothing sends even the retryable kinds to the owner.
  assert.equal(triageIssue(issue, { policy: { auto: [] } }).decision, "ask");
});

test("the card is about the task, and every option acts on it", () => {
  const question = questionForIssue(worker("scope", "the store has to be written too", {
    detail: "the brief only covers the view", file: "renderer/idle.js", evidence: ["no store for retry state"],
  }));
  assert.match(question.title, /"Add the retry banner" is bigger than its brief/);
  assert.match(question.detail, /the brief only covers the view/);
  assert.match(question.detail, /renderer\/idle\.js/);
  assert.equal(question.source, "issue");
  assert.equal(question.context.taskId, "task_1");
  assert.equal(question.context.issueKind, "scope");
  assert.deepEqual(question.options.map((option) => option.id), ["narrow", "split", "replan", "hold"]);
  assert.equal(question.options.filter((option) => option.recommended).length, 1);
  for (const option of question.options) {
    assert.equal(option.action.kind, "issue");
    assert.equal(option.action.payload.taskId, "task_1");
    assert.ok(option.description, `${option.id} says what it does`);
  }
  assert.equal(question.options.at(-1).dismiss, true);
});

test("a grant option names the reach it grants, and denying is what is recommended", () => {
  const question = questionForIssue(worker("permission", "it needs to edit main.cjs", { permission: "write-files" }));
  const grant = question.options.find((option) => option.id === "grant");
  assert.equal(grant.label, "Grant write-files for this task");
  assert.equal(grant.action.payload.permission, "write-files");
  assert.equal(question.options.find((option) => option.recommended).id, "deny");
});

test("a run that stopped becomes an issue with its own evidence, not a bare retry prompt", () => {
  const issue = runFailureIssue({
    task: { id: "task_2", title: "Commit the memory-cap telemetry" },
    failures: 3,
    outputTail: ["running npm test", "FAIL tests/board.test.mjs", "1 failing"],
    runId: "run_1",
  });
  assert.equal(issue.kind, "run-failed");
  assert.equal(issue.taskId, "task_2");
  assert.equal(issue.attempts, 3);
  assert.equal(issue.title, "1 failing");
  assert.deepEqual(issue.evidence, ["running npm test", "FAIL tests/board.test.mjs", "1 failing"]);
  const question = questionForIssue(issue);
  assert.match(question.title, /"Commit the memory-cap telemetry" stopped without finishing/);
  assert.match(question.detail, /Attempt 3/);
  assert.match(question.detail, /1 failing/);
  assert.ok(question.options.some((option) => option.id === "retry-deep"));
});

test("a failing named check is filed as a failing check, with the check named", () => {
  const issue = runFailureIssue({
    task: { id: "task_3", title: "Tidy the rail" },
    failures: 1,
    checks: [{ command: "npm run check:css", ok: false }],
    outputTail: ["check:css found 2 unused rules"],
  });
  assert.equal(issue.kind, "check-failed");
  assert.equal(issue.check, "npm run check:css");
  assert.match(questionForIssue(issue).detail, /npm run check:css/);
});

test("an issue with no title is nothing at all", () => {
  assert.equal(normalizeIssue({ kind: "scope", title: "   " }), null);
  assert.equal(triageIssue({ title: "" }).ok, false);
});

test("the prompt line teaches the protocol without offering it as a way out", () => {
  const line = issuePromptLine();
  assert.ok(line.includes(ISSUE_MARK));
  assert.match(line, /not a way to end the job/);
  assert.ok(!line.includes("run-failed"), "the host-only kind is not offered to workers");
});

test("the open-card budget queues rather than drops", () => {
  const triage = triageIssue(worker("scope", "too much"), { policy: { maxOpenAsks: 2 }, openAsks: 5 });
  assert.equal(triage.decision, "ask");
  assert.equal(triage.queued, true);
  assert.ok(triage.question, "the question still exists so nothing an agent asked is lost");
});
