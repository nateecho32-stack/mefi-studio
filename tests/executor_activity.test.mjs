import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import activity from "../scripts/executor-activity.cjs";

const { cleanActivity, recordOutput, workerActivity } = activity;
const controls = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

test("activity text removes terminal commands, hidden OSC payloads and bidi controls", () => {
  const line = "\u001b[32mWriting\u001b[0m\t snake.js\u001b]0;hidden-window-title\u0007\n"
    + "\u001b]8;;https://invalid.example/hidden-link\u001b\\tests\u001b]8;;\u001b\\"
    + "\u0000\u0008\u007f\u202e\u2066";
  const clean = cleanActivity(line);
  assert.match(clean, /Writing/);
  assert.match(clean, /snake\.js/);
  assert.match(clean, /tests/);
  assert.doesNotMatch(clean, /hidden-window-title|hidden-link|\[32m|\[0m/);
  assert.doesNotMatch(clean, controls);
});

test("activity redacts credentials before clipping them for display", () => {
  const secrets = [
    `sk-proj-${"a".repeat(36)}`,
    `ghp_${"b".repeat(36)}`,
    `github_pat_${"c".repeat(22)}_${"d".repeat(59)}`,
  ];
  for (const secret of secrets) {
    const clean = cleanActivity(`Connecting with ${secret}; waiting for worker`, 240);
    assert.doesNotMatch(clean, new RegExp(secret));
    assert.ok(!clean.includes(secret.slice(0, 20)), "a token prefix must not leak through redaction");
    const short = cleanActivity(`Connecting with ${secret}`, 36);
    assert.ok(!short.includes(secret.slice(0, 16)), "clipping must not hide the end from the sanitizer");
  }
  for (const authorization of ["Bearer synthetic-access-credential-123", "Basic c3ludGhldGljOnNlY3JldA=="]) {
    const clean = cleanActivity(`Authorization: ${authorization}`);
    assert.ok(!clean.includes(authorization.split(" ")[1]));
  }
});

test("activity text is bounded and harmless empty input stays empty", () => {
  for (const input of [null, undefined, "", "  \t\r\n  ", "\u001b[2K\u0000"]) {
    assert.equal(cleanActivity(input), "");
  }
  assert.ok(cleanActivity("Editing ".repeat(1000)).length <= 240);
  assert.ok(cleanActivity("Editing ".repeat(1000), 48).length <= 48);
  assert.equal(cleanActivity("Running tests", 240), "Running tests");
});

test("meaningful output records the observed update, while blank output does not reset its age", () => {
  const entry = {};
  assert.equal(recordOutput(entry, "\u001b[32mWriting snake.js\u001b[0m", 1000), true);
  assert.deepEqual(entry.activity, { text: "Writing snake.js", at: 1000 });
  assert.equal(entry.lastOutputAt, 1000);
  assert.equal(recordOutput(entry, "  \t\u001b[0m\r\n", 2000), false);
  assert.deepEqual(entry.activity, { text: "Writing snake.js", at: 1000 });
  assert.equal(entry.lastOutputAt, 1000);
  assert.equal(recordOutput(entry, "Running game checks", 3000), true);
  assert.deepEqual(entry.activity, { text: "Running game checks", at: 3000 });
  assert.equal(entry.lastOutputAt, 3000);
  assert.equal(recordOutput(entry, "Running game checks", 4000), true);
  assert.equal(entry.activity.at, 4000, "a repeated report is still a fresh observation");
  assert.equal(entry.lastOutputAt, 4000);
});

test("worker protocol records never replace the last human-readable activity", () => {
  const entry = {};
  recordOutput(entry, "Checking keyboard controls", 1000);
  const protocols = [
    "MEFI_JOB_DONE",
    'MEFI_RESULT: {"status":"done","summary":"synthetic result"}',
    'MEFI_NEXT: {"title":"synthetic follow-up"}',
    'MEFI_CALL: {"tool":"synthetic tool"}',
    'MEFI_ASK: {"question":"synthetic question"}',
  ];
  for (const [index, line] of protocols.entries()) {
    assert.equal(recordOutput(entry, line, 2000 + index), false);
    assert.equal(entry.activity.text, "Checking keyboard controls");
    assert.equal(entry.activity.at, 1000);
    assert.equal(entry.lastOutputAt, 2000 + index, "protocol output proves stream arrival, not a visible task step");
  }
  const emptyEntry = {};
  recordOutput(emptyEntry, "MEFI_JOB_DONE", 5000);
  assert.equal(workerActivity(emptyEntry).activity, null);
});

test("successful process boilerplate preserves meaningful activity without hiding stream arrival", () => {
  const entry = {};
  recordOutput(entry, "Checking keyboard controls", 1000);
  const boilerplate = ["EXIT=0", "exit_code=0", "Exit code: 0", "Process exited with code 0", "Process finished with exit code 0.", "Command completed successfully", "Success!", "Done"];
  for (const [index, line] of boilerplate.entries()) {
    assert.equal(recordOutput(entry, line, 2000 + index), false, line);
    assert.deepEqual(entry.activity, { text: "Checking keyboard controls", at: 1000 });
    assert.equal(entry.lastOutputAt, 2000 + index, "stream freshness must remain truthful");
  }
  const fresh = {};
  assert.equal(recordOutput(fresh, "EXIT=0", 3000), true, "without meaningful activity, show the actual observed output");
  assert.equal(workerActivity(fresh).activity, "EXIT=0");
});

test("nonzero exits, failures and substantive successful results replace previous activity", () => {
  for (const line of ["EXIT=1", "EXIT=-1", "Process exited with code 2", "Command failed", "EXIT=0; 2 checks failed", "20 tests passed", "Done: keyboard controls and collision tests"]) {
    const entry = {};
    recordOutput(entry, "Running game checks", 1000);
    assert.equal(recordOutput(entry, line, 2000), true, line);
    assert.deepEqual(entry.activity, { text: line, at: 2000 });
    assert.equal(entry.lastOutputAt, 2000);
  }
});

test("private-key output remains suppressed across stream lines and resumes after its end marker", () => {
  const entry = {};
  recordOutput(entry, "Inspecting project files", 1000);
  for (const [index, line] of [
    "-----BEGIN PRIVATE KEY-----",
    "U3ludGhldGljUHJpdmF0ZUtleUJvZHlGb3JUZXN0T25seQ==",
    "c2Vjb25kLXN5bnRoZXRpYy1wcml2YXRlLWtleS1saW5l",
    "-----END PRIVATE KEY-----",
  ].entries()) {
    recordOutput(entry, line, 2000 + index);
    assert.equal(entry.activity.text, "Inspecting project files");
    assert.doesNotMatch(JSON.stringify(workerActivity(entry)), /PRIVATE KEY|U3ludGhldGlj|c2Vjb25k/);
  }
  recordOutput(entry, "Checking collision rules", 3000);
  assert.equal(entry.activity.text, "Checking collision rules");
  assert.equal(entry.activity.at, 3000);
});

test("an unfinished key block never exposes its continuation as later activity", () => {
  const entry = {};
  recordOutput(entry, "-----BEGIN RSA PRIVATE KEY-----", 1000);
  recordOutput(entry, "synthetic-private-key-continuation", 2000);
  assert.equal(workerActivity(entry).activity, null);
});

test("worker details contain only reported route, output and current checklist step", () => {
  const entry = {
    routeLabel: "Codex CLI",
    activity: { text: "Running collision tests", at: 3000 },
    lastOutputAt: 4000,
    todosUpdatedAt: 2500,
    todos: [
      { status: "completed", content: "Create game board" },
      { status: "in_progress", content: "Check wall collisions" },
      { status: "pending", content: "Write README" },
    ],
    progress: { percent: 92, label: "almost done" },
  };
  const before = JSON.stringify(entry);
  assert.deepEqual(workerActivity(entry), {
    route: "Codex CLI", activity: "Running collision tests", activityAt: 3000,
    lastOutputAt: 4000, currentStep: "Check wall collisions", stepUpdatedAt: 2500,
  });
  assert.equal(JSON.stringify(entry), before, "reading status must not mutate the worker");
  assert.deepEqual(workerActivity({}), {
    route: null, activity: null, activityAt: null, lastOutputAt: null,
    currentStep: null, stepUpdatedAt: null,
  }, "absence of observations must not invent a completion claim or percentage");
});

test("worker details sanitize persisted values and recognize supported checklist labels", () => {
  for (const field of ["content", "label", "title", "text"]) {
    const result = workerActivity({
      routeLabel: `\u001b[32mWorker ${"x".repeat(600)}\u202e`,
      activity: { text: `Authorization: Bearer synthetic-token ${"y".repeat(600)}`, at: 1000 },
      todos: [{ status: "in_progress", [field]: `\u001b[31mCheck input ${"z".repeat(600)}\u2066` }],
      todosUpdatedAt: 500,
    });
    assert.match(result.currentStep, /^Check input/);
    for (const value of [result.route, result.activity, result.currentStep]) {
      assert.ok(value.length <= 240);
      assert.doesNotMatch(value, controls);
      assert.doesNotMatch(value, /synthetic-token/);
    }
    assert.equal(result.stepUpdatedAt, 500);
  }
});

test("invalid persisted timestamps stay unknown instead of becoming misleading update ages", () => {
  for (const value of [undefined, null, 0, -1, NaN, Infinity, "1000"]) {
    const result = workerActivity({ activity: { text: "Checking input", at: value }, lastOutputAt: value, todosUpdatedAt: value });
    assert.equal(result.activityAt, null);
    assert.equal(result.lastOutputAt, null);
    assert.equal(result.stepUpdatedAt, null);
  }
});

test("assistant board facts expose only the current project's last eight observed task events", () => {
  const host = readFileSync(new URL("../main.cjs", import.meta.url), "utf8");
  const start = host.indexOf("function assistantBoardFacts(");
  const end = host.indexOf("\nfunction projectScanFacts(", start);
  assert.ok(start >= 0 && end > start, "host facts function boundaries must exist");
  const currentEvents = Array.from({ length: 12 }, (_, index) => ({ kind: "started", taskId: `snake-${index}`, at: index }));
  const otherEvents = [{ kind: "done", taskId: "another-project" }];
  let currentProject = "snake";
  const errors = [];
  const context = vm.createContext({
    taskOversight: { boardDigest: () => ({ asks: [] }) },
    autopilot: { jobs: [], autoBuild: true },
    assistantState: { questions: [], taskEvents: [{ taskId: "obsolete-state-field" }] },
    compareWork: () => 0,
    projects: { current: () => ({ id: currentProject }) },
    taskEventTails: new Map([["snake", currentEvents], ["other", otherEvents]]),
    logError: (message) => errors.push(message),
  });
  vm.runInContext(host.slice(start, end), context);
  const facts = context.assistantBoardFacts({}, { tasks: [] }, {}, 1000);
  assert.deepEqual(facts.events, currentEvents.slice(-8));
  assert.equal(currentEvents.length, 12, "status reads must not consume event history");
  currentProject = "other";
  assert.deepEqual(context.assistantBoardFacts({}, { tasks: [] }, {}, 1000).events, otherEvents);
  currentProject = "new-project";
  assert.equal(context.assistantBoardFacts({}, { tasks: [] }, {}, 1000).events.length, 0);
  assert.deepEqual(errors, []);
});
