import test from "node:test";
import assert from "node:assert/strict";
import { formatUsage, mergeLedgers, rollupUsage, scopeUsage } from "../scripts/usage-tracker.cjs";

const storeRow = (id, at, sessionId, tokens, extra = {}) => ({ id, at, sessionId, provider: "opencode-go", model: "glm-5.3", tokens, ...extra });
const studioRow = (id, at, extra = {}) => ({ id, at, provider: "zai", model: "glm-5.3", status: "ok", tokenUsage: { inputTokens: 100, outputTokens: 20 }, ...extra });

test("an attempt is charged its own session window, never its predecessor's turns", () => {
  const rows = mergeLedgers({
    store: [
      storeRow("first-try", 1_000, "ses_a", { input: 900, output: 90 }),
      storeRow("second-try", 5_000, "ses_a", { input: 300, output: 30 }),
      storeRow("other-task", 5_100, "ses_b", { input: 7_000, output: 700 }),
    ],
  });
  // The same session is reused across attempts, so the window is what separates them.
  const retry = scopeUsage(rows, [{ sessionId: "ses_a", since: 4_000, until: 6_000 }]);
  assert.deepEqual(retry.map((row) => row.id), ["store:second-try"], "a retry must not inherit the earlier attempt's cost");

  const wholeTask = scopeUsage(rows, [
    { sessionId: "ses_a", since: 0, until: 2_000 },
    { sessionId: "ses_a", since: 4_000, until: 6_000 },
  ]);
  assert.equal(wholeTask.length, 2, "a task spanning two attempts sums both");
  assert.ok(!wholeTask.some((row) => row.id.includes("other-task")), "another task's session is never counted");
});

test("both ledgers reach one total without double counting", () => {
  const rows = mergeLedgers({
    studio: [studioRow("jev-call", 1_200, { runId: "run_1", costUsd: 0.004 }), studioRow("elsewhere", 1_200, { runId: "run_9" })],
    store: [storeRow("worker-turn", 1_100, "ses_a", { input: 12_300, output: 2_100, cacheRead: 1_100 }, { cost: 0.036 })],
  });
  const summary = rollupUsage(rows, [{ sessionId: "ses_a", runId: "run_1", since: 1_000, until: 2_000 }]);
  assert.equal(summary.calls, 2, "the worker's turn and Studio's own call, once each");
  assert.equal(summary.origins.studio, 1);
  assert.equal(summary.origins["opencode-cli"], 1);
  assert.equal(summary.usage.inputTokens.known, 12_400);
  assert.equal(summary.usage.cacheReadTokens.known, 1_100);
  assert.equal(Number(summary.usage.costUsd.known.toFixed(4)), 0.04);
});

test("a run id matches regardless of window, because Studio stamps its own calls", () => {
  const rows = mergeLedgers({ studio: [studioRow("late", 99_999, { runId: "run_1", costUsd: 0.01 })] });
  assert.equal(scopeUsage(rows, [{ runId: "run_1" }]).length, 1);
  assert.equal(scopeUsage(rows, [{ runId: "run_2" }]).length, 0);
});

test("a task with no attempt is charged nothing rather than everything", () => {
  const rows = mergeLedgers({ store: [storeRow("a", 1_000, "ses_a", { input: 5 })] });
  assert.deepEqual(scopeUsage(rows, []), [], "an empty scope must never fall through to the whole ledger");
  assert.deepEqual(scopeUsage(rows, [{}]), []);
  assert.equal(rollupUsage(rows, []).calls, 0);
});

test("an unpriced provider reads as unpriced, never as free", () => {
  // A plan bills nothing per call, so its cost is unknown — not zero.
  const rows = mergeLedgers({ studio: [studioRow("plan-call", 1_000, { runId: "run_1", provider: "opencode-go", costUsd: null })] });
  const summary = rollupUsage(rows, [{ runId: "run_1" }]);
  assert.equal(summary.usage.costUsd.known, null);
  assert.equal(summary.usage.costUsd.unknownRecords, 1);
  const line = formatUsage(summary);
  assert.match(line, /unpriced/, "showing $0.00 here would claim the task was free");
  assert.ok(!line.includes("$0"), line);
});

test("the compact line reads the way the Tracker's other numbers do", () => {
  const rows = mergeLedgers({ store: [storeRow("turn", 1_000, "ses_a", { input: 12_300, output: 2_100, cacheRead: 1_100, cacheWrite: 400 }, { cost: 0.04 })] });
  const line = formatUsage(rollupUsage(rows, [{ sessionId: "ses_a", since: 0, until: 2_000 }]));
  assert.equal(line, "in 12.3k · cached 1.1k · cache-wr 400 · out 2.1k · $0.0400");
  // Zero-valued cache fields are noise, so they are left out entirely.
  const plain = formatUsage(rollupUsage(mergeLedgers({ store: [storeRow("t", 1_000, "ses_b", { input: 40, output: 9 }, { cost: 0.5 })] }), [{ sessionId: "ses_b", since: 0, until: 2_000 }]));
  assert.equal(plain, "in 40 · out 9 · $0.5000");
  assert.equal(formatUsage(rollupUsage([], [])), "", "nothing measured prints nothing, not a row of zeroes");
});
