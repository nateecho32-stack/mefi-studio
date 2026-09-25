// An agent that hits a decision must reach the owner as a question about the
// WORK — the task, what it saw, and options that act on that task — and the
// two decisions nobody may automate (granting reach, accepting a risk) must
// stay the owner's whatever a brain map says.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ISSUE_MARK, ISSUE_KIND_IDS, ISSUE_KINDS, ISSUE_OPTIONS, ALWAYS_ASK, AUTO_ANSWERABLE, parseIssueLine, normalizeIssue, normalizePolicy,
  collectIssues, triageIssue, questionForIssue, runFailureIssue, issuePromptLine, ownerDirected, ownerResultIssue, repeatAsk,
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
  assert.match(question.title, /1 failing/);
  assert.doesNotMatch(question.detail, /1 failing/, "the title's line is not repeated as the last output");
  assert.doesNotMatch(question.detail, /The agent says/, "the host's account is not quoted as the agent's");
  assert.ok(question.options.some((option) => option.id === "retry-deep"));
});

test("a run failure is named by its cause, never by a protocol line or a bare exit", () => {
  const tail = ["running npm test", "Error: Cannot find module './board'", "at Module._resolve", "MEFI_RESULT: done=the view; remaining=the store", "MEFI_JOB_DONE"];
  const issue = runFailureIssue({ task: { id: "task_2", title: "Wire the board" }, failures: 5, error: "exit 1", outputTail: tail });
  assert.equal(issue.title, "Error: Cannot find module './board'");
  assert.deepEqual(issue.evidence, ["running npm test", "Error: Cannot find module './board'", "at Module._resolve"]);
  assert.match(issue.detail, /Its last report: done=the view; remaining=the store/);
  assert.equal(runFailureIssue({ task: { id: "t", title: "t" }, error: "killed after budget", outputTail: ["still editing"] }).title, "ran past its time budget and was stopped");
  assert.equal(runFailureIssue({ task: { id: "t", title: "t" }, outputTail: ["MEFI_RESULT: partial"] }).title, "it printed nothing and never reported done");
  assert.equal(runFailureIssue({ task: { id: "t", title: "t" }, error: "exited with code 2" }).title, "exited with code 2, with no output");
});

test("a task that already failed and was retried is not recommended the same retry", () => {
  const recommended = (question) => question.options.find((option) => option.recommended).id;
  const spent = questionForIssue(runFailureIssue({ task: { id: "task_2", title: "Wire the board" }, failures: 5, outputTail: ["FAIL tests/board.test.mjs"] }));
  assert.equal(recommended(spent), "retry-deep");
  const retry = spent.options.find((option) => option.id === "retry");
  assert.equal(retry.label, "Try again unchanged");
  assert.match(retry.description, /failed 5 times/);
  // No heavier model on offer: a one-line instruction is the change to make.
  assert.equal(recommended(questionForIssue(worker("verify", "no test shows it works", { attempts: 3 }))), "instruct");
  // A first ask keeps its kind's own pick.
  assert.equal(recommended(questionForIssue(worker("check-failed", "the css gate is red", { attempts: 0 }))), "retry");
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

// ---- the decision lane: splits carry the ask, the owner's own lane, repeats

test("every answer carries what was asked, and a split also carries what the agent saw", () => {
  const question = questionForIssue(worker("scope", "the store has to be written too", { detail: "the brief only covers the view" }));
  for (const option of question.options) assert.equal(option.action.payload.ask, "the store has to be written too", option.id);
  const split = question.options.find((option) => option.id === "split");
  assert.equal(split.action.payload.detail, "the brief only covers the view");
  assert.ok(question.options.filter((option) => option.id !== "split").every((option) => !("detail" in option.action.payload)));
  // Bounded: the ask like a title, the detail at 300.
  const long = questionForIssue(worker("scope", "x".repeat(400), { detail: "y".repeat(900) }));
  assert.equal(long.options[0].action.payload.ask.length, 140);
  assert.equal(long.options.find((option) => option.id === "split").action.payload.detail.length, 300);
  assert.ok(!("detail" in questionForIssue(worker("scope", "too much")).options.find((option) => option.id === "split").action.payload));
});

test("an issue knows how deep its card sits in a split chain", () => {
  assert.equal(worker("scope", "more").splitDepth, 0);
  assert.equal(worker("scope", "more", { splitDepth: 2 }).splitDepth, 2);
  // A chain split before splitDepth was recorded counts its title the way the host does.
  assert.equal(worker("scope", "more", { taskTitle: "Follow-up: Add the retry banner" }).splitDepth, 1);
  assert.equal(worker("scope", "more", { taskTitle: "Follow-up 3: Add the retry banner" }).splitDepth, 3);
  assert.equal(worker("scope", "more", { taskTitle: "Follow-up: Follow-up: Add the retry banner" }).splitDepth, 2);
  const huge = worker("scope", "more", { splitDepth: 1e9 }).splitDepth;
  assert.ok(Number.isInteger(huge) && huge <= 20, "bounded");
  assert.equal(worker("scope", "more", { splitFrom: "task_0" }).splitFrom, "task_0");
});

test("the split limit and the repeat rule are part of the policy, bounded, with safe defaults", () => {
  assert.equal(normalizePolicy({}).splitDepth, 3);
  assert.equal(normalizePolicy({ splitDepth: 0 }).splitDepth, 0, "zero is a real Split off, not a missing value");
  assert.equal(normalizePolicy({ splitDepth: 9 }).splitDepth, 5);
  assert.equal(normalizePolicy({ splitDepth: -2 }).splitDepth, 0);
  assert.equal(normalizePolicy({ splitDepth: "junk" }).splitDepth, 3);
  assert.equal(normalizePolicy({ splitDepth: null }).splitDepth, 3);
  assert.equal(normalizePolicy({}).repeatAsks, "fold");
  assert.equal(normalizePolicy({ repeatAsks: "ask" }).repeatAsks, "ask");
  assert.equal(normalizePolicy({ repeatAsks: "loud" }).repeatAsks, "fold");
});

test("Split is not offered where it could not land, and the card says why", () => {
  // No depth: the plain scope list is unchanged.
  assert.deepEqual(questionForIssue(worker("scope", "more")).options.map((option) => option.id), ["narrow", "split", "replan", "hold"]);
  assert.deepEqual(questionForIssue(worker("scope", "more", { splitDepth: 2 })).options.map((option) => option.id), ["narrow", "split", "replan", "hold"]);
  const deep = questionForIssue(worker("scope", "more", { splitDepth: 3, detail: "the store too" }));
  assert.deepEqual(deep.options.map((option) => option.id), ["narrow", "replan", "hold"]);
  assert.match(deep.detail, /the store too/);
  assert.match(deep.detail, /Split is not offered: this follow-up chain is already 3 deep\.$/);
  // The live map's limit decides, and 0 turns Split off everywhere.
  assert.ok(questionForIssue(worker("capability", "too big", { splitDepth: 3 }), { policy: { splitDepth: 5 } }).options.some((option) => option.id === "split"));
  const off = questionForIssue(worker("missing", "the key is not here"), { policy: { splitDepth: 0 } });
  assert.deepEqual(off.options.map((option) => option.id), ["instruct", "hold"]);
  assert.match(off.detail, /Split is turned off in the live brain map\.$/);
  // A long detail keeps the note whole inside the bound.
  const long = questionForIssue(worker("scope", "more", { splitDepth: 3, detail: "z".repeat(600) }));
  assert.ok(long.detail.length <= 400);
  assert.match(long.detail, /already 3 deep\.$/);
  // triageIssue hands the map's limit on.
  assert.ok(!triageIssue(worker("scope", "more", { splitDepth: 1 }), { policy: { splitDepth: 1 } }).question.options.some((option) => option.id === "split"));
});

test("something only the owner can do is its own kind: asked, acknowledged, never settled or split", () => {
  const owner = ISSUE_KINDS.owner;
  assert.equal(owner.ask, "policy");
  assert.equal(owner.autoAnswer, undefined);
  assert.deepEqual(owner.options, ["acknowledge", "instruct", "hold"]);
  assert.equal(owner.recommend, "acknowledge");
  assert.deepEqual([...ALWAYS_ASK].sort(), ["permission", "risk"]);
  assert.ok(!AUTO_ANSWERABLE.has("owner"));
  assert.equal(ISSUE_OPTIONS.acknowledge.verb, "acknowledge");
  assert.equal(ISSUE_OPTIONS.acknowledge.label, "I'll take care of it");
  assert.equal(normalizePolicy({ auto: ISSUE_KIND_IDS }).auto.includes("owner"), false);
  const triage = triageIssue(worker("owner", "reword the stored acceptance"), { policy: { auto: ISSUE_KIND_IDS, autoRetryLimit: 5 } });
  assert.equal(triage.decision, "ask");
  assert.match(triage.question.title, /"Add the retry banner" needs something only you can do: reword the stored acceptance/);
  assert.deepEqual(triage.question.options.map((option) => option.id), ["acknowledge", "instruct", "hold"]);
  assert.equal(triage.question.options.find((option) => option.recommended).id, "acknowledge");
  assert.equal(parseIssueLine(`${ISSUE_MARK} owner :: flip the landing card to done`).kind, "owner");
});

test("a question put to the owner, or naming a lane only the owner may touch, is the owner's", () => {
  for (const [title, detail] of [
    ["Will you correct the stored acceptance on task_delegate_b4f73d934d18f69906d57de9 to say \"above the anchor\"?", null],
    ["“Could you flip the landing card?", null],
    ["Should the owner land or unstage the four files another session left staged?", null],
    ["May Studio's stored acceptance be corrected?", null],
    ["May Studio’s task-store acceptance for the helper be corrected?", null],
    ["May owner/Studio correct the stored acceptance?", null],
    ["Flip task_c1cf337d66009c14 to done in Studio citing rows af88c20", null],
    ["sweep the stale recursive echo card task_0ced1d7f880a818a", null],
    ["May the worker correct `task_delegate_b4f73d934d18f69906d57de9`'s stored acceptance?", null],
    ["the acceptance is inverted", "only the stale task store says so"],
    ["the acceptance is inverted", "workers may not rewrite it"],
    ["the acceptance is inverted", "the worker cannot rewrite eyes-tasks.json"],
    ["the acceptance is inverted", "workers are barred from rewriting it"],
    ["the board flip is all that is left", "it is owner-side"],
    ["the card has to be closed", "only the owner can do that"],
  ]) assert.equal(ownerDirected(title, detail), true, `${title} / ${detail}`);
  for (const [title, detail] of [
    ["the store has to be written too", null],
    ["it needs to edit main.cjs", null],
    ["which of the two stores wins?", null],
    ["the view needs a store", "workers can rewrite the store module"],
    ["Should the host clamp the split depth too?", null],
    ["Should Studio's settings tab show the limit?", null],
    ["Can the renderer read answer.error?", null],
    ["the acceptance criteria name a test file that does not exist", null],
    ["close the reader before the file is renamed", null],
  ]) assert.equal(ownerDirected(title, detail), false, `${title} / ${detail}`);
});

test("an owner-directed ask filed under another kind is reclassified; a named grant or a risk never is", () => {
  for (const kind of ["scope", "missing", "conflict", "capability", "blocked"]) {
    assert.equal(worker(kind, "Will you reword the stored acceptance?").kind, "owner", kind);
    assert.equal(parseIssueLine(`${ISSUE_MARK} ${kind} :: Will you reword the stored acceptance?`).kind, "owner", `${kind} line`);
  }
  assert.equal(worker("permission", "Workers may not rewrite Studio's task store; will you correct it?").kind, "owner", "a permission naming none");
  assert.equal(worker("permission", "Will you let me edit main.cjs?", { permission: "write-files" }).kind, "permission", "a named grant stays a grant");
  assert.equal(worker("risk", "Will you accept dropping the table?").kind, "risk");
  assert.equal(worker("verify", "Will you look at the evidence?").kind, "verify");
  assert.equal(worker("scope", "the store has to be written too").kind, "scope");
  // A blocked ask that is really the owner's is no longer settled as a retry.
  assert.equal(triageIssue(worker("blocked", "Will you close task_c1cf337d66009c14?"), { policy: { auto: ["blocked"] } }).decision, "ask");
  // A host issue keeps its kind whatever its last words say.
  assert.equal(runFailureIssue({ task: { id: "task_2", title: "t" }, outputTail: ["Will you flip it?"] }).kind, "run-failed");
});

test("the prompt line teaches the owner kind as the owner's lane", () => {
  const line = issuePromptLine();
  assert.match(line, /\|owner>/);
  assert.match(line, /Use "owner" for something only the owner can do \(the board, Studio's task store, another session's files\); it reaches the owner once and makes no new card\./);
  assert.match(line, /not a way to end the job/);
  assert.ok(!line.includes("run-failed"));
});

test("the owner: part of a result is one owner issue, and a denial of it asks nothing", () => {
  assert.deepEqual(ownerResultIssue({ owner: "reword the stored acceptance" }), { kind: "owner", title: "reword the stored acceptance", source: "worker" });
  for (const owner of [undefined, "", "none", "None.", "nothing", "n/a", "N/A", "no", "not needed", "(none)", "<what only the owner can do, or leave it out>", "leave it out", " — "]) {
    assert.equal(ownerResultIssue({ owner }), null, String(owner));
  }
  assert.equal(ownerResultIssue(null), null);
  assert.equal(ownerResultIssue({ owner: "nobody but you can flip task_c1cf337d66009c14" })?.kind, "owner");
  assert.equal(normalizeIssue(ownerResultIssue({ owner: "x".repeat(400) })).title.length, 140);
});

const HOUR = 60 * 60 * 1000;
const card = (issue, { id = "q_1", at = 1_000, status = "open", answer = null } = {}) => ({ id, at, status, answer, ...questionForIssue(issue, { now: at }) });
const ACCEPTANCE = "Will you correct the stored acceptance on task_delegate_b4f73d934d18f69906d57de9?";

test("the same ask from another card is found by the cards it names or by its words", () => {
  const first = card(worker("scope", ACCEPTANCE, { taskId: "task_a" }), { id: "q_a" });
  assert.equal(first.context.issueKind, "owner");
  // Reworded around the same card, from another card.
  const reworded = worker("scope", "May Studio's stored acceptance for task_delegate_b4f73d934d18f69906d57de9 be corrected?", { taskId: "task_b" });
  assert.equal(repeatAsk(reworded, [first], { now: 2 * HOUR })?.id, "q_a");
  // Word for word, naming no card.
  const words = "Should the owner land or unstage the four staged files?";
  assert.equal(repeatAsk(worker("scope", words, { taskId: "task_b" }), [card(worker("scope", words, { taskId: "task_a" }), { id: "q_w" })], { now: HOUR })?.id, "q_w");
  // The newest match wins.
  const second = card(worker("owner", ACCEPTANCE, { taskId: "task_c" }), { id: "q_c", at: 5_000 });
  assert.equal(repeatAsk(reworded, [first, second], { now: 2 * HOUR })?.id, "q_c");
});

test("a different ask, an old one, an unanswered one, or a grant or a risk is not a repeat", () => {
  const first = card(worker("owner", ACCEPTANCE, { taskId: "task_a" }), { id: "q_a" });
  const again = worker("owner", ACCEPTANCE, { taskId: "task_b" });
  assert.equal(repeatAsk(again, [first], { now: HOUR })?.id, "q_a", "the control case folds");
  assert.equal(repeatAsk(again, [first], { now: 25 * HOUR + 1_000 }), null, "outside the day");
  assert.equal(repeatAsk(worker("owner", "Will you flip task_7b773505d7c6eb43 to done?", { taskId: "task_b" }), [first], { now: HOUR }), null, "other cards named");
  assert.equal(repeatAsk(worker("scope", "the store has to be written too", { taskId: "task_b" }), [card(worker("scope", "the view has to be written too", { taskId: "task_a" }))], { now: HOUR }), null);
  // The live pair (q_1790116769778_3, then q_1790118011668_1 from its split):
  // the same two gate cards, but a different question, so it is asked.
  const gate = card(worker("scope", "task_205dac636be4ef1d duplicates the parent gate card task_06f0123a487997e6 (both \"Post-commit quiet-tree gate rerun\"); repo evidence for both is green", { taskId: "task_205dac636be4ef1d" }), { id: "q_gate" });
  const addressed = worker("scope", "Both duplicate gate cards (task_205dac636be4ef1d and task_06f0123a487997e6) are already done, so the split-out work is fully addressed by them", { taskId: "task_816fd9b20bf2725a", splitFrom: "task_205dac636be4ef1d" });
  assert.equal(repeatAsk(addressed, [gate], { now: HOUR }), null, "same cards, different ask");
  const restated = worker("scope", "task_205dac636be4ef1d duplicates parent gate card task_06f0123a487997e6; the evidence for both is green", { taskId: "task_816fd9b20bf2725a", splitFrom: "task_205dac636be4ef1d" });
  assert.equal(repeatAsk(restated, [gate], { now: HOUR })?.id, "q_gate", "same cards, same ask reworded");
  // Only issue cards, only the same kind.
  assert.equal(repeatAsk(again, [{ ...first, source: "offer" }], { now: HOUR }), null);
  assert.equal(repeatAsk(worker("conflict", "which store wins for task_7b773505d7c6eb43", { taskId: "task_b" }), [card(worker("scope", "the store for task_7b773505d7c6eb43", { taskId: "task_a" }))], { now: HOUR }), null);
  // An expired or superseded card was never answered: ask again.
  for (const status of ["expired", "superseded"]) assert.equal(repeatAsk(again, [{ ...first, status }], { now: HOUR }), null, status);
  // An answer the host could not apply is no answer to carry over.
  assert.equal(repeatAsk(again, [{ ...first, status: "answered", answer: { optionId: "acknowledge", error: "That task is no longer on the board." } }], { now: HOUR }), null);
  // A run that stopped is about its own run.
  assert.equal(repeatAsk({ ...again, source: "host" }, [first], { now: HOUR }), null);
  // A grant or a risk belongs to the task that asked.
  for (const kind of ["permission", "risk"]) {
    const said = "landing task_7b773505d7c6eb43's refactor drops a table";
    const earlier = card(worker(kind, said, { taskId: "task_a", permission: "write-files" }), { status: "answered", answer: { optionId: kind === "risk" ? "proceed" : "grant" } });
    assert.equal(repeatAsk(worker(kind, said, { taskId: "task_b", permission: "write-files" }), [earlier], { now: HOUR }), null, kind);
  }
});

test("an ask about its own card or its split parent is not another card's ask", () => {
  const parent = card(worker("owner", "Will you flip task_parent00001 to done in the board?", { taskId: "task_parent00001" }), { id: "q_parent" });
  const child = worker("owner", "Will you flip task_child000001 to done in the board?", { taskId: "task_child000001", splitFrom: "task_parent00001" });
  assert.equal(repeatAsk(child, [parent], { now: HOUR }), null);
});

test("a card saved before asks rode on its options is still read by its title", () => {
  // The card's title as it was when it asked, and a card renamed since.
  for (const renamed of [null, "Renamed since it asked"]) {
    const legacy = card(worker("scope", ACCEPTANCE, { taskId: "task_a", taskTitle: "Follow-up: TESTRUNS append helper" }), { id: "q_old" });
    for (const option of legacy.options) delete option.action.payload.ask;
    // Filed before the owner kind existed.
    legacy.context.issueKind = "scope";
    legacy.title = legacy.title.replace("needs something only you can do", "is bigger than its brief");
    if (renamed) legacy.context.taskTitle = renamed;
    const again = worker("scope", "May Studio's stored acceptance for task_delegate_b4f73d934d18f69906d57de9 be corrected?", { taskId: "task_b" });
    assert.equal(repeatAsk(again, [legacy], { now: HOUR })?.id, "q_old", String(renamed));
    // Read by its words too: the same ask word for word folds with no card named.
    const words = card(worker("scope", "Should the owner land or unstage the staged files?", { taskId: "task_a", taskTitle: "Follow-up: TESTRUNS append helper" }), { id: "q_words" });
    for (const option of words.options) delete option.action.payload.ask;
    words.context.issueKind = "scope";
    words.title = words.title.replace("needs something only you can do", "is bigger than its brief");
    if (renamed) words.context.taskTitle = renamed;
    assert.equal(repeatAsk(worker("owner", "Should the owner land or unstage the staged files?", { taskId: "task_b" }), [words], { now: HOUR })?.id, "q_words", String(renamed));
  }
});
