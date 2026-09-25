// A provider outage (a usage limit, no connection to the API) ends a run
// through no fault of its card. The host's real settle requeues it on the
// outage backoff, 5m doubling to a 2h cap while the outage lasts, with no
// attempt charged, so a long outage cannot spend every card's five tries. An
// ordinary failure afterwards is charged as before and ends the streak. Only
// the provider's own error shapes in the run's last words count, and the grace
// is bounded (seven in a row, or the route finished a run since the card's last
// outage), so a genuine failure misread as an outage still parks.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { executorHost } from "./fixtures/host_executor.mjs";
import * as assistant from "../scripts/assistant.mjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const failureQuestion = section("function assistantBuildFailureQuestion(", "// ---- the done log");

const MINUTE = 60000;
const task = (id, extra = {}) => ({ id, title: `Implement fixture ${id}`, prompt: `Implement ${id} and retain its full acceptance brief.`, status: "open", createdAt: 1, files: [`src/${id}.js`], ...extra });

// The executor host with the real failure question beside settle: finish()
// asks it about every failed task run. The issue lane it would raise into is a
// recorder, so "nothing raised" is observed rather than assumed.
function outageHost(options) {
  const h = executorHost(options);
  vm.runInContext(failureQuestion, h.env);
  const asked = [], raised = [];
  const question = h.env.assistantBuildFailureQuestion;
  h.env.assistantBuildFailureQuestion = (job, failures, evidence) => {
    const result = question(job, failures, evidence);
    asked.push({ taskId: job.ref.id, failures, evidence, result });
    return result;
  };
  h.env.assistantRaiseIssue = async (issue) => { raised.push(issue); return null; };
  return { h, asked, raised };
}

// Starts the card's next run and ends it with these last words.
async function runAndFail(h, taskId, lines) {
  const before = h.starts.length;
  h.wake(); await h.pump();
  assert.equal(h.starts.length, before + 1, `${taskId} is dispatched`);
  assert.equal(h.starts.at(-1).taskId, taskId);
  await h.finish(taskId, { code: 1, lines }); await h.pump();
  return h.board().tasks.find((row) => row.id === taskId);
}

test("a run that ends on a usage limit or a lost connection is requeued uncharged on the outage backoff", async () => {
  for (const said of ["You've hit your usage limit", "Cannot connect to API"]) {
    const { h, asked, raised } = outageHost({ tasks: [task("outage", { runFailures: 2, lastRunError: "FAIL tests/board.test.mjs" })] });
    const row = await runAndFail(h, "outage", ["Reading the brief", said]);
    assert.equal(row.status, "open", said);
    assert.equal(row.runId, undefined);
    assert.equal(row.runFailures, 2, "the outage's try is not charged");
    assert.equal(row.providerFailures, 1);
    assert.equal(row.nextRunAt, h.now() + 5 * MINUTE, "it cools down for 5m");
    assert.equal(row.lastRunError, said);
    assert.equal(row.logs.at(-1).text, `provider unavailable (exit 1) · ${said} · requeued in 5m, no attempt charged`);
    assert.ok(!row.logs.some((line) => /autopilot run failed/.test(line.text)), "no charged-failure line");
    // The real failure question was asked about this run and raised nothing.
    assert.equal(asked.length, 1);
    assert.equal(asked[0].taskId, "outage");
    assert.equal(asked[0].result, null);
    assert.deepEqual(raised, []);
    // Nothing restarts it inside its cooldown.
    h.advance(5 * MINUTE - 1000); h.wake(); await h.pump();
    assert.equal(h.starts.length, 1);
  }
});

test("a second outage in a row doubles the cooldown, and an ordinary failure afterwards is charged and ends the streak", async () => {
  const { h, asked, raised } = outageHost({ tasks: [task("outage")] });
  let row = await runAndFail(h, "outage", ["You've hit your usage limit"]);
  assert.equal(row.providerFailures, 1);
  assert.equal(row.nextRunAt, h.now() + 5 * MINUTE);

  h.advance(5 * MINUTE);
  row = await runAndFail(h, "outage", ["Cannot connect to API"]);
  assert.equal(row.runFailures, undefined, "two outages charge nothing");
  assert.equal(row.providerFailures, 2);
  assert.equal(row.nextRunAt, h.now() + 10 * MINUTE, "the second outage in a row waits 10m");
  assert.equal(row.logs.at(-1).text, "provider unavailable (exit 1) · Cannot connect to API · requeued in 10m, no attempt charged");

  h.advance(10 * MINUTE);
  row = await runAndFail(h, "outage", ["npm test", "FAIL tests/board.test.mjs"]);
  assert.equal(row.status, "open");
  assert.equal(row.runFailures, 1, "an ordinary failure is charged");
  assert.equal(row.providerFailures, undefined, "and ends the outage streak");
  assert.equal(row.nextRunAt, h.now() + MINUTE);
  assert.equal(row.lastRunError, "FAIL tests/board.test.mjs");
  assert.equal(row.logs.at(-1).text, "autopilot run failed (exit 1) · FAIL tests/board.test.mjs · retry 1/5");
  assert.deepEqual(asked.map((call) => call.result === null), [true, true, true], "the ordinary failure gets an automatic repair attempt");
  assert.equal(raised.length, 0, "Ask waits until the five-try repair budget is spent");

  // The next outage starts its streak over, and the charged try stays charged.
  h.advance(MINUTE);
  row = await runAndFail(h, "outage", ["Error: Usage limit reached for this month"]);
  assert.equal(row.runFailures, 1);
  assert.equal(row.providerFailures, 1);
  assert.equal(row.nextRunAt, h.now() + 5 * MINUTE);
  assert.equal(raised.length, 0);
});

test("a long outage waits at most two hours between tries, and past seven in a row the try is charged", async () => {
  const { h, asked, raised } = outageHost({ tasks: [task("outage", { runFailures: 4, providerFailures: 5 })] });
  let row = await runAndFail(h, "outage", ["You've hit your usage limit"]);
  assert.equal(row.providerFailures, 6);
  assert.equal(row.runFailures, 4, "one try short of parked, and still one try short");
  assert.equal(row.nextRunAt, h.now() + 120 * MINUTE, "5m doubled five times is capped at 2h");
  assert.match(row.logs.at(-1).text, / · requeued in 120m, no attempt charged$/);
  assert.deepEqual(raised, []);
  h.advance(120 * MINUTE);
  row = await runAndFail(h, "outage", ["You've hit your usage limit"]);
  assert.equal(h.starts.length, 2, "it is tried again once the cooldown is over");
  assert.equal(row.providerFailures, 7, "seven in a row sit out 6.6h, past a 5-hour usage window");
  assert.equal(row.runFailures, 4);
  assert.deepEqual(raised, []);

  // The eighth in a row is charged: a genuine failure misread as an outage
  // still parks at five tries and reaches triage.
  h.advance(120 * MINUTE);
  row = await runAndFail(h, "outage", ["You've hit your usage limit"]);
  assert.equal(row.runFailures, 5);
  assert.equal(row.providerFailures, 8, "the streak runs on, so the next one is charged too");
  assert.equal(row.nextRunAt, undefined, "parked");
  assert.equal(row.logs.at(-1).text, "autopilot run failed (exit 1) · You've hit your usage limit · gave up after 5 tries");
  assert.equal(asked.at(-1).evidence.providerDown, false, "the failure question is handed settle's verdict");
  assert.equal(raised.length, 1);
  assert.equal(raised[0].kind, "run-failed");
  assert.equal(raised[0].attempts, 5);
});

test("a genuine failure that only mentions a provider word is charged and parks", async () => {
  const genuine = [
    ["npm test", "not ok 3 - the rate limiter returns 429 after ten calls"],
    ["TypeError: Cannot read properties of undefined (reading 'id')", "    at load (C:\\proj\\src\\server.js:429:15)"],
    ["I changed src/usage.js but the quota banner test still fails; stopping here."],
    ["Invoke-WebRequest : Unable to connect to the remote server"],
    // A provider error earlier in the run is not how it ended.
    ["Error: Usage limit reached for this month", "retrying", "FAIL tests/usage.test.mjs"],
  ];
  const { h, raised } = outageHost({ tasks: [task("genuine")] });
  for (const [index, lines] of genuine.entries()) {
    const row = await runAndFail(h, "genuine", lines);
    assert.equal(row.runFailures, index + 1, lines.at(-1));
    assert.equal(row.providerFailures, undefined);
    assert.match(row.logs.at(-1).text, /^autopilot run failed \(exit 1\) · /);
    assert.equal(assistant.classifyOutcomeLine(row.logs.at(-1).text).kind, "run", "the loop guard counts it");
    if (row.nextRunAt) h.advance(row.nextRunAt - h.now());
  }
  const parked = h.board().tasks[0];
  assert.equal(parked.nextRunAt, undefined, "parked after five tries");
  assert.match(parked.logs.at(-1).text, / · gave up after 5 tries$/);
  assert.equal(raised.length, 1, "only the fifth failure reaches Ask");
  assert.equal(raised[0].attempts, 5);
});

test("once the route has finished a run since the card's last outage, the next outage-looking failure is charged", async () => {
  // The other card cools down first, so the outage card runs first.
  const { h, raised } = outageHost({ tasks: [task("outage"), task("other", { nextRunAt: 1_000_000 + MINUTE })] });
  let row = await runAndFail(h, "outage", ["Error: Rate limit reached for requests"]);
  assert.equal(row.providerFailures, 1);
  assert.equal(row.runFailures, undefined);

  // A run that started after that outage finishes on the same route.
  h.advance(MINUTE);
  h.wake(); await h.pump();
  assert.equal(h.starts.at(-1).taskId, "other");
  await h.finish("other"); await h.pump();

  h.advance(5 * MINUTE);
  row = await runAndFail(h, "outage", ["Error: Rate limit reached for requests"]);
  assert.equal(row.runFailures, 1, "the provider was answering: this try is charged");
  assert.equal(row.providerFailures, 2);
  assert.equal(row.logs.at(-1).text, "autopilot run failed (exit 1) · Error: Rate limit reached for requests · retry 1/5");
  assert.equal(raised.length, 0, "the first charged failure still has repair attempts");

  // A finished run of its own ends the streak.
  h.advance(MINUTE);
  h.wake(); await h.pump();
  await h.finish("outage"); await h.pump();
  row = h.board().tasks.find((item) => item.id === "outage");
  assert.equal(row.status, "awaiting_verification");
  assert.equal(row.providerFailures, undefined);
});

test("a run that finished before the card's outage is no evidence the provider is back", async () => {
  // The other card finishes first; then the outage card fails twice with
  // nothing finishing in between: both tries stay uncharged.
  const { h, raised } = outageHost({ tasks: [task("other"), task("outage", { nextRunAt: 1_000_000 + MINUTE })] });
  h.wake(); await h.pump();
  assert.equal(h.starts.at(-1).taskId, "other");
  await h.finish("other"); await h.pump();
  h.advance(MINUTE);
  let row = await runAndFail(h, "outage", ["You've hit your usage limit"]);
  assert.equal(row.providerFailures, 1);
  h.advance(5 * MINUTE);
  row = await runAndFail(h, "outage", ["You've hit your usage limit"]);
  assert.equal(row.providerFailures, 2);
  assert.equal(row.runFailures, undefined);
  assert.deepEqual(raised, []);
});

// Only tasks run: an inbox request reaches a worker as its promoted card,
// with the tries it already spent, and an outage is settled the task's way.
test("an inbox request that hits an outage runs as its promoted task and is requeued the same way without spending its tries", async () => {
  const request = { title: "Implement inbox request", prompt: "Complete the inbox request and its tests", at: 1, source: "manual", pin: true, runFailures: 1 };
  const { h, asked, raised } = outageHost({ mode: "cluster", adaptiveParallel: true, requests: [request] });
  h.wake(); await h.pump();
  const card = h.board().tasks.find((row) => row.title === request.title);
  assert.ok(card, "the foreman promoted the request");
  assert.deepEqual(h.starts.map((row) => row.taskId), [card.id], "the card runs, never the inbox row");
  assert.equal(card.runFailures, 1, "promotion keeps the tries the request already spent");
  await h.finish(card.id, { code: 1, lines: ["You've hit your usage limit"] }); await h.pump();
  const saved = h.board().tasks.find((row) => row.id === card.id);
  assert.equal(saved.status, "open");
  assert.equal(saved.runId, undefined);
  assert.equal(saved.runFailures, 1, "the outage's try is not charged");
  assert.equal(saved.providerFailures, 1);
  assert.equal(saved.nextRunAt, h.now() + 5 * MINUTE);
  assert.equal(saved.lastRunError, "You've hit your usage limit");
  assert.equal(saved.logs.at(-1).text, "provider unavailable (exit 1) · You've hit your usage limit · requeued in 5m, no attempt charged");
  assert.equal(h.board().tasks.length, 1, "no second card is made from the inbox copy");
  assert.equal(asked.length, 1);
  assert.equal(asked[0].result, null, "the outage is put to no one");
  assert.deepEqual(raised, []);
});
