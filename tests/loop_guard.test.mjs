import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_PREFS, LOOP_LIMITS, auditPass, classifyOutcomeLine, isProviderFailure, isProviderOutage } from "../scripts/assistant.mjs";

// The keeper's loop guard: the card's own log lines are classified, counted
// into task.loopLedger from the arm time (or the owner's last Try again), and a
// card that keeps ending attempts without verified progress is held — only when
// the host says its workState honours a hold. Everything here is the pure half
// in scripts/assistant.mjs; the host wiring has its own suites.

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const log = (minute, text) => ({ at: T0 + minute * MIN, kind: "status", text });
const card = (overrides = {}) => ({ id: "task_loop", title: "Restart dev app after repair", status: "open", updatedAt: T0, logs: [], ...overrides });
const unverified = (minute, reason = "no attributable edits and no named checks", retry = "1/3") => log(minute, `unverified — ${reason} · retry ${retry}`);
// One failed attempt, the way the host writes it: the run finishes, then the
// verifier cannot confirm it.
const attempt = (minute, reason) => [log(minute, "run finished (exit 0) — awaiting verification"), unverified(minute + 1, reason)];
const pass = (tasks, options = {}) => auditPass({ tasks, nodeFolders: {}, now: T0 + 10 * HOUR, armedAt: T0 - HOUR, hostCaps: { loopHold: true }, ...options });

test("the classifier sorts every host line it knows, and nothing else", () => {
  const table = [
    ["autopilot run failed (exit 1) · npm test failed · retry 1/5", "run"],
    ["autopilot run failed (exit ?) · retry 2/5", "run"],
    ["autopilot run failed (exit 1) · Usage limit reached · retry 1/5", "ignored"],
    ["autopilot run failed (exit 1) · \u001b[31mCannot connect to API\u001b[0m · retry 1/5", "ignored"],
    // A genuine failure that merely mentions a provider word is charged, and
    // the guard counts it the same.
    ["autopilot run failed (exit 1) · not ok 3 - the rate limiter returns 429 after ten calls · retry 1/5", "run"],
    ["autopilot run failed (exit 1) · I changed src/usage.js but the quota banner test still fails · retry 2/5", "run"],
    ["unverified — no attributable edits and no named checks · retry 1/3", "verify"],
    ["unverified — outstanding obligations remain · parked for manual review", "verify"],
    ["reopened — overseer check failed — recorded checks failed in the overseer's verification run · retry 2/3", "verify"],
    ["verification could not confirm completion (0 changed files) — no attributable edits and no named checks, retry 1/3", "verify"],
    ["reopened — overseer verification run failed — npm test exited 1 · parked for manual review", "verify"],
    ["unverified — recorded checks failed in the overseer's verification run (npm run check failed: 2 failing) · retry 2/3", "verify"],
    ["reopened — overseer check failed — recorded checks failed in the overseer's verification run (node --test tests/x.test.mjs failed — timed out: timed out after 10m) · parked for manual review", "verify"],
    ["run finished (exit 0) — awaiting verification · verifying: npm test", "attempt-end"],
    ["run finished (sentinel seen) — awaiting verification", "attempt-end"],
    ["verified — 2 changed file(s) in the attempt's session", "attempt-end"],
    ["provider unavailable (exit 1) · usage limit · requeued in 5m, no attempt charged", "ignored"],
    ["worker never started — the worker never started · requeued in 1m, no attempt charged (start 1/5)", "ignored"],
    ["stopped on request (unfinished) — progress saved; ready to resume", "ignored"],
    ["Studio resumed interrupted work from its saved progress", "ignored"],
    ["autopilot run lost — reopened", "ignored"],
    ["Retry requested — previous result and remaining work retained", null],
    ["archived by the assistant", null],
    ["", null],
  ];
  for (const [line, kind] of table) assert.equal(classifyOutcomeLine(line)?.kind ?? null, kind, line);
  assert.equal(classifyOutcomeLine("   unverified — x · retry 1/3")?.kind, "verify", "leading space is not a different line");
  assert.equal(classifyOutcomeLine("the verifier said unverified — x")?.kind ?? null, null, "anchored at the start of the line");
  assert.equal(classifyOutcomeLine("\u001b[33munverified — x · retry 1/3\u001b[0m")?.kind, "verify", "colour codes are stripped first");
});

test("a verification reason is keyed without its retry tail and with digits as N", () => {
  const key = (line) => classifyOutcomeLine(line).reason;
  assert.equal(key("unverified — no attributable edits and no named checks · retry 1/3"), "no attributable edits and no named checks");
  assert.equal(key("unverified — no attributable edits and no named checks · parked for manual review"), "no attributable edits and no named checks");
  assert.equal(key("unverified — 3 recorded check(s) failed · retry 2/3"), key("unverified — 4 recorded check(s) failed · retry 1/3"), "a count in the reason is not a different reason");
  assert.equal(key("verification could not confirm completion (0 changed files) — outstanding obligations remain, retry 2/3"), "outstanding obligations remain");
  assert.match(key("reopened — overseer check failed — recorded checks failed · retry 1/3"), /^overseer check failed recorded checks failed$/);
  assert.equal(key("unverified — 3 recorded check(s) failed · retry 2/3"), "N recorded check s failed", "a parenthesis inside the reason is not the overseer's command");
});

test("the overseer's failing command and its output are no part of the reason key", () => {
  // main.cjs's overseerMiss appends " (<command> failed[ — timed out][: <tail>])"
  // before the retry or park tail; the tail is whatever the check printed.
  const key = (line) => classifyOutcomeLine(line).reason;
  const bare = "recorded checks failed in the overseer's verification run";
  const plain = key(`unverified — ${bare} · retry 1/3`);
  assert.equal(plain, "recorded checks failed in the overseer s verification run");
  const table = [
    `unverified — ${bare} (npm run check failed: Error: check-css found 2 unused rules | exit 1) · retry 2/3`,
    `unverified — ${bare} (npm run check failed: ✖ tests/alpha.test.mjs (4.2ms) — expected true) · retry 3/3`,
    `unverified — ${bare} (node --test tests/x.test.mjs failed: not ok 4 - y · retry 9, retry 1/2) · retry 1/3`,
    `unverified — ${bare} (npm run check failed — timed out: timed out after 10m) · retry 1/3`,
    `unverified — ${bare} (npm run check failed — timed out) · retry 1/3`,
    `unverified — ${bare} (npm run check failed) · parked for manual review`,
    `unverified — ${bare} (node -e "require('x')" failed: boom) · retry 2/3`,
    `unverified — ${bare} (python -m unittest tools.test_x failed: FAILED (failures=3)) · parked for manual review`,
  ];
  for (const line of table) assert.equal(key(line), plain, line);
  const reopened = key(`reopened — overseer check failed — ${bare} · retry 1/3`);
  assert.equal(reopened, "overseer check failed recorded checks failed in the overseer s verification run");
  for (const line of [
    `reopened — overseer check failed — ${bare} (node --test tests/x.test.mjs failed: not ok 1 - a) · retry 2/3`,
    `reopened — overseer check failed — ${bare} (npm run check failed — timed out: killed after budget) · parked for manual review`,
  ]) assert.equal(key(line), reopened, line);

  // Four attempts of one card that die on the same overseer check, each with
  // different output, are one reason repeated: the card is held.
  const outputs = ["not ok 1 - alpha", "not ok 2 - beta | exit 1", "✖ gamma (12ms)", "timed out after 10m"];
  const logs = outputs.flatMap((output, i) => attempt(i * 10, `${bare} (npm run check failed: ${output})`));
  const held = pass([card({ logs })]);
  assert.equal(held.tasks[0].loopGuard?.kind, "verify");
  assert.equal(held.tasks[0].loopGuard.reason, plain);
  assert.deepEqual(held.tasks[0].loopLedger.reasons, { [plain]: 4 });
});

test("provider failures are recognised in every wording the executor logs", () => {
  for (const text of [
    // What opencode printed through the 09-22 outages, colour codes and all.
    "\u001b[91m\u001b[1mError: \u001b[0mUsage limit reached for 5 hour. Your limit will reset at 2026-09-23 00:20:38",
    "Error: Cannot connect to API: Unable to connect. Is the computer able to access the url?",
    "Error: Cannot connect to API: Was there a typo in the url or port?",
    "Error: Rate limit reached for requests",
    "Error: Provider response headers timed out after 300000ms",
    // The other CLIs' and APIs' own shapes.
    "Claude AI usage limit reached|1790100000",
    "5-hour limit reached \u2219 resets 3pm",
    "You've hit your usage limit. Upgrade to Pro or try again in 4 days 3 hours",
    "API Error: 429 {\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\"}}",
    "API Error: 529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}",
    "API Error: Connection error.",
    "stream error: exceeded retry limit, last status: 429 Too Many Requests",
    "You exceeded your current quota, please check your plan and billing details",
    "rate limit exceeded", "rate-limited",
  ]) assert.equal(isProviderFailure(text), true, text);
  // A bare provider word is not a provider error: these are test names, stack
  // frames, the worker's prose and a local service that is not running.
  for (const text of [
    "npm test failed", "exit 1", "TypeError: x is undefined", "", null, undefined,
    "not ok 3 - the rate limiter returns 429 after ten calls",
    "    at load (C:\\proj\\src\\server.js:429:15)",
    "I changed src/usage.js but the quota banner test still fails; stopping here.",
    "FAIL tests/usage.test.mjs > quota pill shows remaining quota",
    "I added rate-limit handling but the test still fails",
    "Invoke-WebRequest : Unable to connect to the remote server",
    "Error: cannot connect to the Docker daemon at unix:///var/run/docker.sock",
    "unable to connect to database: ECONNREFUSED",
    "\u2716 a run that ends on a usage limit or a lost connection is requeued uncharged on the outage backoff (12ms)",
    "HTTP 429", "model overloaded",
  ]) assert.equal(isProviderFailure(text), false, String(text));
});

test("an outage is read from the run's error and last words, never from a run that reported", () => {
  const usage = "Error: Usage limit reached for 5 hour. Your limit will reset at 2026-09-23 00:20:38";
  assert.equal(isProviderOutage({ lastWords: usage }), true);
  assert.equal(isProviderOutage({ error: "API Error: Connection error.", lastWords: "exiting" }), true);
  assert.equal(isProviderOutage({ lastWords: "FAIL tests/board.test.mjs" }), false);
  assert.equal(isProviderOutage({ lastWords: usage, sawDone: true }), false, "a run that printed its verdict was working");
  assert.equal(isProviderOutage({ lastWords: usage, resultNote: { raw: "MEFI_RESULT: done=half" } }), false, "so was one that gave its result");
  assert.equal(isProviderOutage({}), false);
  assert.equal(isProviderOutage(), false);
});

test("outcomes count from the arm time: history before it is never charged", () => {
  const history = [];
  for (let i = 0; i < 8; i += 1) history.push(log(i, "autopilot run failed (exit 1) · boom · retry 1/5"));
  const task = card({ logs: history });
  const armedLate = pass([task], { armedAt: T0 + HOUR });
  assert.equal(armedLate.tasks[0], task, "nothing after the arm time: the row keeps its identity");
  assert.equal(armedLate.report.loopsHeld, 0);
  const armedEarly = pass([task], { armedAt: T0 - HOUR });
  assert.equal(armedEarly.tasks[0].loopLedger.n, 8);
  assert.equal(armedEarly.tasks[0].loopLedger.at, T0 + 7 * MIN, "the ledger remembers the newest line it read");
  const unarmed = auditPass({ tasks: [task], nodeFolders: {}, now: T0 + HOUR, hostCaps: { loopHold: true } });
  assert.equal(unarmed.tasks[0], task, "no arm time means now: a first pass charges nothing");
});

test("the owner's Try again resets the baseline, and a pre-baseline verify still closes its attempt", () => {
  const logs = [...attempt(0), ...attempt(10), ...attempt(20), ...attempt(30), ...attempt(40), ...attempt(50)];
  const acked = card({ logs: [...logs, log(55, "Retry requested — previous result and remaining work retained")], loopLedger: { v: 1, at: T0 + 55 * MIN, n: 0, reasons: {} } });
  const result = pass([acked]);
  assert.equal(result.tasks[0], acked, "nothing new since the owner's acknowledgement");
  // The attempt open at the baseline already had its verify: a second verdict
  // on the same attempt after the reset is not a new failed attempt.
  const echo = card({ logs: [...attempt(0), unverified(20)], loopLedger: { v: 1, at: T0 + 10 * MIN, n: 0, reasons: {} } });
  assert.equal(pass([echo]).tasks[0], echo);
});

test("one verification failure per attempt, reset when the run finishes or verification passes", () => {
  const double = card({ logs: [...attempt(0), log(2, "reopened — overseer check failed — recorded checks failed · retry 2/3")] });
  assert.equal(pass([double]).tasks[0].loopLedger.n, 1, "the verifier speaking twice about one attempt is one failed attempt");
  const two = card({ logs: [...attempt(0), ...attempt(10)] });
  assert.equal(pass([two]).tasks[0].loopLedger.n, 2);
  const afterVerified = card({ logs: [unverified(0), log(5, "verified — 1 changed file(s) in the attempt's session"), log(9, "reopened — overseer check failed — recorded checks failed · retry 1/3")] });
  assert.equal(pass([afterVerified]).tasks[0].loopLedger.n, 2, "a verified attempt ends the attempt, so the overseer's later check counts");
});

test("thresholds: six attempts, or four of one verification reason", () => {
  const failures = (count) => Array.from({ length: count }, (_, i) => log(i, `autopilot run failed (exit 1) · attempt ${i} · retry 1/5`));
  assert.equal(pass([card({ logs: failures(LOOP_LIMITS.attempts - 1) })]).report.loopsHeld, 0, "five is not a loop");
  const six = pass([card({ logs: failures(LOOP_LIMITS.attempts) })]);
  assert.equal(six.report.loopsHeld, 1);
  assert.deepEqual({ kind: six.tasks[0].loopGuard.kind, count: six.tasks[0].loopGuard.count, by: six.tasks[0].loopGuard.by, at: six.tasks[0].loopGuard.at }, { kind: "attempts", count: 6, by: "keeper", at: T0 + 10 * HOUR });

  const same = (count) => Array.from({ length: count }, (_, i) => attempt(i * 10, "outstanding obligations remain")).flat();
  assert.equal(pass([card({ logs: same(LOOP_LIMITS.verifyReason - 1) })]).report.loopsHeld, 0, "three of one reason is not a loop");
  const four = pass([card({ logs: same(LOOP_LIMITS.verifyReason) })]);
  assert.equal(four.tasks[0].loopGuard.kind, "verify");
  assert.equal(four.tasks[0].loopGuard.reason, "outstanding obligations remain");
  assert.equal(four.tasks[0].loopGuard.remedy, "Read the last attempts, edit or split the brief, then choose Try again.");
  const mixed = Array.from({ length: 4 }, (_, i) => attempt(i * 10, `reason number ${"abcd"[i]}`)).flat();
  assert.equal(pass([card({ logs: mixed })]).report.loopsHeld, 0, "four different reasons are four attempts, below both limits");

  const noEdits = pass([card({ logs: same(0).concat(Array.from({ length: 4 }, (_, i) => attempt(i * 10)).flat()) })]);
  assert.equal(noEdits.tasks[0].loopGuard.remedy, "This card changes no files: give it a named check the verifier can run, or close it by hand.");
  assert.equal(four.report.cardsLooping.length, 1);
});

test("provider failures and host events are never charged", () => {
  const logs = [];
  for (let i = 0; i < 10; i += 1) logs.push(log(i * 2, "autopilot run failed (exit 1) · Usage limit reached · retry 1/5"));
  for (let i = 0; i < 3; i += 1) logs.push(log(30 + i, "Studio resumed interrupted work from its saved progress"), log(40 + i, "autopilot run lost — reopened"), log(50 + i, "stopped on request (unfinished) — progress saved; ready to resume"));
  const task = card({ logs });
  assert.equal(pass([task]).tasks[0], task, "an outage and a restart are not the card's loop");
});

test("holds need loopGuardApply and the host's loopHold; otherwise the card is counted as would-hold", () => {
  const logs = Array.from({ length: 6 }, (_, i) => log(i, "autopilot run failed (exit 1) · boom · retry 1/5"));
  const task = card({ logs });
  const noHost = pass([task], { hostCaps: {} });
  assert.equal(noHost.tasks[0].loopGuard, undefined, "an old host's workState would ignore the hold");
  assert.equal(noHost.report.wouldHold, 1);
  assert.equal(noHost.tasks[0].loopLedger.n, 6, "the count is still kept");
  assert.match(noHost.text, /would hold 1 looping card/);
  const applyOff = pass([task], { prefs: { loopGuardApply: false } });
  assert.equal(applyOff.tasks[0].loopGuard, undefined);
  assert.equal(applyOff.report.wouldHold, 1);
  const held = pass([task]);
  assert.equal(held.report.loopsHeld, 1);
  assert.match(held.text, /^held 1 looping card/);
  assert.deepEqual(held.report.cardsLooping.map((row) => [row.id, row.n]), [["task_loop", 6]]);
});

test("only a card waiting for a worker can be held", () => {
  const logs = Array.from({ length: 6 }, (_, i) => log(i, "autopilot run failed (exit 1) · boom · retry 1/5"));
  for (const overrides of [{ status: "active", runId: "run_1" }, { lease: { pid: 1, at: T0 } }, { status: "absorbed", absorbedInto: "task_plan" }, { status: "done" }, { status: "awaiting_verification" }, { runId: "run_2" }]) {
    const result = pass([card({ logs, ...overrides })]);
    assert.equal(result.tasks[0].loopGuard, undefined, JSON.stringify(overrides));
    assert.equal(result.report.wouldHold, 0, JSON.stringify(overrides));
  }
});

test("loopGuard off releases the keeper's holds and counts nothing", () => {
  const keeperHold = card({ id: "task_a", loopGuard: { v: 1, at: T0, kind: "attempts", count: 6, reason: "x", remedy: "y", by: "keeper" } });
  const ownerHold = card({ id: "task_b", loopGuard: { v: 1, at: T0, kind: "attempts", count: 6, reason: "x", remedy: "y", by: "owner" } });
  const looping = card({ id: "task_c", logs: Array.from({ length: 8 }, (_, i) => log(i, "autopilot run failed (exit 1) · boom · retry 1/5")) });
  const off = pass([keeperHold, ownerHold, looping], { prefs: { loopGuard: false } });
  assert.equal(off.tasks[0].loopGuard, undefined);
  assert.equal(off.tasks[1], ownerHold, "a hold the keeper did not stamp is not the keeper's to release");
  assert.equal(off.tasks[2], looping, "no ledger while the guard is off");
  assert.equal(off.report.loopsReleased, 1);
  assert.match(off.text, /released 1 loop hold/);
  assert.equal(DEFAULT_PREFS.loopGuard && DEFAULT_PREFS.loopGuardApply && DEFAULT_PREFS.memoryAlign, true, "all three switches default on");
});

test("the pass is idempotent at one now, and writes only loopLedger and loopGuard", () => {
  const logs = [...Array.from({ length: 5 }, (_, i) => attempt(i * 10)).flat(), log(60, "autopilot run failed (exit 1) · boom · retry 1/5")];
  const quiet = card({ id: "task_quiet", logs: [log(1, "archived by the assistant")] });
  const tasks = [card({ logs }), quiet, card({ id: "task_done", status: "done", doneAt: T0 })];
  const first = pass(tasks);
  const second = pass(first.tasks);
  assert.deepEqual(second.tasks, first.tasks, "a second pass at the same now changes nothing");
  second.tasks.forEach((row, index) => assert.equal(row, first.tasks[index], "every row keeps its identity on the second pass"));
  assert.equal(first.tasks[1], quiet);
  const before = tasks[0];
  const after = first.tasks[0];
  const changed = Object.keys({ ...before, ...after }).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
  assert.deepEqual(changed, ["loopGuard", "loopLedger"]);
  assert.equal(after.updatedAt, before.updatedAt);
  assert.deepEqual(pass(tasks), first, "deterministic for a given now");
});

test("stalled review cards and duplicate families are reported, never written", () => {
  const stale = card({ id: "task_review", title: "Confirm the retirement survives a restart", status: "awaiting_verification", updatedAt: T0, logs: [log(0, "run finished (exit 0) — awaiting verification")] });
  const fresh = card({ id: "task_fresh", title: "Shared git index race", status: "awaiting_verification", updatedAt: T0 + 9 * HOUR });
  const handoff = card({ id: "task_wait", title: "Commit the rail accounting test", status: "awaiting_verification", updatedAt: T0 - 5 * HOUR, handoffState: { pending: 1, state: "waiting" } });
  const original = card({ id: "task_one", title: "Full-gate rerun on the quiet tree", parentTaskId: "task_p1" });
  const clone = card({ id: "task_two", title: "Full-gate rerun on the quiet tree — follow-up 6c5e94", originalTitle: "Full-gate rerun on the quiet tree", parentTaskId: "task_p2" });
  const split = card({ id: "task_three", title: "Follow-up: Follow-up 2: Full-gate rerun on the quiet tree", splitFrom: "task_one" });
  const finished = card({ id: "task_four", title: "Full-gate rerun on the quiet tree", status: "done", doneAt: T0 });
  const audits = [card({ id: "task_css1", title: "Audit: css" }), card({ id: "task_css2", title: "Audit: css" })];
  const result = pass([stale, fresh, handoff, original, clone, split, finished, ...audits], { now: T0 + 13 * HOUR });
  assert.equal(result.report.stalled, 2, "12 h untouched in review, or waiting on handed-off work");
  assert.equal(result.report.families, 1);
  assert.deepEqual(result.report.familyGroups[0].members.map((row) => [row.id, row.parentTaskId, row.splitFrom ?? null]), [["task_one", "task_p1", null], ["task_two", "task_p2", null], ["task_three", null, "task_one"]]);
  assert.equal(result.report.familyGroups[0].key, "full gate rerun on the quiet tree");
  assert.match(result.text, /2 stalled reviews · 1 duplicate family/);
  const byId = Object.fromEntries(result.findings.map((row) => [row.id, row]));
  assert.equal(byId.task_review.state, "stalled");
  assert.equal(byId.task_fresh.state, "review");
  assert.match(byId.task_wait.issue, /waiting on handed-off work/);
  assert.match(byId.task_two.issue, /duplicate family "full gate rerun on the quiet tree" \(3 open cards\)/);
  assert.equal(byId.task_four.state, "done");
  result.tasks.forEach((row, index) => assert.equal(row, [stale, fresh, handoff, original, clone, split, finished, ...audits][index]));
});

test("open issue questions about a finished or missing card are handed back for superseding", () => {
  const questions = [
    { id: "q_done", source: "issue", status: "open", title: "Retry?", context: { taskId: "task_done" } },
    { id: "q_gone", source: "issue", status: "open", title: "Retry?", context: { taskId: "task_gone" } },
    { id: "q_live", source: "issue", status: "open", title: "Retry?", context: { taskId: "task_open" } },
    { id: "q_answered", source: "issue", status: "answered", title: "Retry?", context: { taskId: "task_done" } },
    { id: "q_chat", source: "assistant", status: "open", title: "Which one?", context: { taskId: "task_done" } },
    { id: "q_nocontext", source: "issue", status: "open", title: "Retry?" },
    // A scope ask offers a split, which files the uncovered work as a new card
    // and needs nothing re-armed: it stays while its card is on the board.
    { id: "q_scope", source: "issue", status: "open", title: "Bigger than its brief", context: { taskId: "task_done", issueKind: "scope" },
      options: [{ id: "narrow", label: "Keep to the brief" }, { id: "split", label: "Split the extra work out", action: { kind: "issue", action: "split" } }] },
    { id: "q_scope_gone", source: "issue", status: "open", title: "Bigger than its brief", context: { taskId: "task_gone", issueKind: "scope" },
      options: [{ id: "split", label: "Split the extra work out", action: { kind: "issue", action: "split" } }] },
  ];
  const result = pass([card({ id: "task_done", status: "archived", doneAt: T0 }), card({ id: "task_open" })], { questions });
  assert.deepEqual(result.supersedeQuestionIds, ["q_done", "q_gone", "q_scope_gone"]);
  assert.equal(result.report.questionsSuperseded, 3);
});

test("every classified log literal still exists in the code that writes it", async () => {
  // Rewording one of these lines blinds the guard with no failing test; this
  // pin makes the rewording and the classifier change land together.
  const source = async (file) => (await readFile(new URL(`../${file}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const main = await source("main.cjs");
  for (const literal of ["unverified — ${", "reopened — overseer check failed — ${", "autopilot run failed (exit ${", "run finished"]) assert.ok(main.includes(literal), `main.cjs no longer writes ${literal}`);
  // The overseer's failing command rides on both verify notes; the reason key
  // strips it by this shape: " (<command> failed[ — timed out][: <tail>])".
  for (const literal of ["${overseerMiss(doneRun)}${outcome(verdict)}", "${overseerMiss(overseerRunFor(task, attempt))}${outcome(verdict)}", '` (${bad.command} failed${bad.timedOut ? " — timed out" : ""}${bad.tail ? `: ${']) {
    assert.ok(main.includes(literal), `main.cjs no longer writes ${literal}`);
  }
  assert.ok((await source("scripts/executor-resume.cjs")).includes("Studio resumed interrupted work"), "executor-resume.cjs no longer writes its resume line");
  assert.ok((await source("scripts/assistant.mjs")).includes('"autopilot run lost — reopened"'), "housekeepingSweep no longer writes its lost-run line");
  // The lines the classifier ignores must be the ones the host writes too.
  for (const literal of ["worker never started — ${", "stopped on request (${", "verified — ${"]) assert.ok(main.includes(literal), `main.cjs no longer writes ${literal}`);
});
