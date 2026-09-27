import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { parseClaudeCliResult } = require("../scripts/usage-tracker.cjs");
const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section: ${start}`);
  return source.slice(from, to);
}

function host(replies) {
  let queued = 0;
  const context = vm.createContext({
    Date, setTimeout, clearTimeout, parseClaudeCliResult,
    projectRoot: () => "fixture-project",
    spawn() {
      const reply = replies.shift();
      assert.ok(reply, "no unexpected paid-call attempt");
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { on() {}, write() {}, end() {
        queueMicrotask(() => {
          child.stdout.emit("data", reply.stdout);
          child.stderr.emit("data", reply.stderr || "");
          child.emit("close", reply.code);
        });
      } };
      return child;
    },
    assistantState: { prefs: {}, ai: { online: true, failures: 0, lastError: null, backoffUntil: 0 }, problems: [] },
    assistantCache: {}, assistantModule: null, assistantAiProbeAttempts: 0,
    clearAssistantAiProbe() {}, logError() {}, assistantLog() {},
    assistantSetProblems(kinds, list) {
      context.assistantState.problems = context.assistantState.problems.filter((row) => !kinds.includes(row.kind)).concat(list);
    },
    getEyes: async () => ({ requestsFromBriefing: () => ["fixture-request"] }),
    requestBaseline: async () => ({}),
    queueRequests: async () => { queued += 1; return 1; },
    assistantBriefCall: async () => {
      const result = await context.claudeCompletion("brief system", "fixture facts", "fixture-model");
      return result.ok ? { ok: true, briefing: { summary: result.text } } : result;
    },
  });
  vm.runInContext([
    section("function cliReply(", "// The Grok CLI"),
    section("function cliModelArg(", "// The Codex CLI"),
    section("function assistantAiOk()", "function assistantAiUsable()"),
    section("async function assistantBrieferJob(", "// The build half of the roster"),
  ].join("\n"), context);
  return { run: () => context.assistantBrieferJob(Date.now(), {}), state: context.assistantState, queued: () => queued };
}

const success = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Project brief", usage: { input_tokens: 10, output_tokens: 5 } });

for (const code of [0, 1]) {
  test(`briefer preserves Claude's actual error at exit ${code} and recovers on a later success`, async () => {
    const message = "Session limit reached; retry after the reset";
    const h = host([
      { code, stdout: JSON.stringify({ type: "result", subtype: "success", is_error: true, result: message }) },
      { code: 0, stdout: success },
    ]);
    const failed = await h.run();
    assert.equal(failed.ok, false);
    assert.equal(failed.error, `claude error: ${message} (backing off 5m)`);
    assert.equal(h.state.ai.lastError, `claude error: ${message}`);
    assert.equal(h.state.ai.failures, 1);
    assert.ok(h.state.ai.backoffUntil > Date.now());
    assert.equal(h.queued(), 0, "an error cannot create briefing requests");
    assert.equal((await h.run()).ok, true);
    assert.equal(h.state.ai.online, true);
    assert.equal(h.state.ai.lastError, null);
    assert.equal(h.state.ai.backoffUntil, 0);
    assert.equal(h.state.problems.length, 0);
    assert.equal(h.queued(), 1);
  });
}

for (const code of [1, null]) {
  for (const stdout of ["Login required", success]) {
    test(`briefer rejects ${stdout === success ? "JSON" : "plain text"} from an unsuccessful CLI exit ${code}`, async () => {
      const h = host([{ code, stdout, stderr: "CLI could not finish" }]);
      const result = await h.run();
      assert.equal(result.ok, false);
      assert.match(result.error, /claude.*CLI could not finish/);
      assert.equal(h.state.ai.online, false);
      assert.equal(h.queued(), 0);
    });
  }
}

test("a successful older CLI can still supply a plain-text brief", async () => {
  const h = host([{ code: 0, stdout: "Plain-text project brief" }]);
  assert.equal((await h.run()).text, "Plain-text project brief");
  assert.equal(h.queued(), 1);
});
