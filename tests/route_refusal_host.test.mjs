// A provider that refuses this login's plan ends a run through no fault of
// its card: OpenCode Go answered a login with no Go subscription "An active
// OpenCode Go subscription is required to use Go models." and the host used to
// charge the card and retry the same dead route in 1, 20, 40 and 80 minutes
// before anyone was asked. The host's real finish() and spawnNextJob now read
// it as a route problem: the card is requeued uncharged on the outage backoff,
// the route is parked (5 minutes doubling to half an hour) so the other cards
// on it are not refused in turn, and the owner is told once, with the fix.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { executorHost } from "./fixtures/host_executor.mjs";
import executorCore from "../scripts/executor-core.cjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};

const MINUTE = 60000;
const REFUSED = "Error: Upstream request failed: An active OpenCode Go subscription is required to use Go models.";
const NOTICE = "OpenCode Go says this login has no active Go subscription. Pick another coding model in Team › Seats and models, or renew the plan.";
const GO = { cli: "opencode", env: {}, modelArgs: " --model opencode-go/deepseek-v4.1-flash", model: "opencode-go/deepseek-v4.1-flash", via: "opencode-go/deepseek-v4.1-flash" };
const task = (id, extra = {}) => ({ id, title: `Implement fixture ${id}`, prompt: `Implement ${id} and retain its full acceptance brief.`, status: "open", createdAt: extra.createdAt ?? 1, files: [`src/${id}.js`], ...extra });

function refusalHost(tasks, route = GO) {
  const h = executorHost({ tasks });
  h.env.executorRunEnv = async () => ({ ...route });
  const notices = [];
  h.env.assistantAppendReply = (text, via, intent, options = {}) => { if (options.notice === true) notices.push({ text, via, intent, notice: true }); return {}; };
  const asked = [];
  h.env.assistantBuildFailureQuestion = (job, failures, evidence) => { asked.push({ taskId: job.ref.id, failures, providerDown: evidence.providerDown }); return null; };
  // The command line each worker got, for the model it ran.
  const spawn = h.env.spawn;
  h.env.spawn = (command, args, options) => { const child = spawn(command, args, options); if (command === "cmd.exe") h.starts.at(-1).line = JSON.stringify(args); return child; };
  // The owner's Start this task, through the host's own Work on it.
  let sequence = 0;
  h.state.messages = [];
  Object.assign(h.env, {
    assistantFocus: async () => {}, assistantMessageId: () => `message-${++sequence}`, assistantCaps: () => ({ messages: 100 }),
    assistantTrim: (rows, limit) => rows.splice(0, Math.max(0, rows.length - limit)),
  });
  vm.runInContext(section("async function assistantWorkOn(", "// A tree click hands the assistant"), h.env);
  const start = (id) => h.env.assistantWorkOn({ kind: "task", id, projectId: "fixture", label: row(h, id).title, start: true });
  return { h, notices, asked, start };
}
const row = (h, id) => h.board().tasks.find((item) => item.id === id);
const routeFaults = (h) => h.logs.filter((line) => line === `[autopilot] executor route failed: ${NOTICE}`).length;

test("a subscription refusal requeues the card uncharged, parks the route, and tells the owner once", async () => {
  const { h, notices, asked, start } = refusalHost([task("first", { createdAt: 1 }), task("second", { createdAt: 2 })]);
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 1);
  assert.equal(h.starts[0].taskId, "first");
  await h.finish("first", { code: 1, lines: ["Reading the brief", REFUSED] }); await h.pump();

  const first = row(h, "first");
  assert.equal(first.status, "open");
  assert.equal(first.runId, undefined);
  assert.equal(first.runFailures, undefined, "no attempt charged");
  assert.equal(first.providerFailures, 1);
  assert.equal(first.nextRunAt, h.now() + 5 * MINUTE, "the outage backoff, not the 1-minute retry");
  assert.equal(first.lastRunError, "OpenCode Go says this login has no active Go subscription");
  assert.equal(first.logs.at(-1).text, "provider unavailable (exit 1) · OpenCode Go says this login has no active Go subscription · requeued in 5m, no attempt charged");
  assert.ok(!first.logs.some((line) => /autopilot run failed/.test(line.text)), "no charged-failure line");
  assert.deepEqual(asked.map((call) => call.providerDown), [true], "the failure question hears it was not the card's doing");

  // One clear notice: the thread, the feed and the loop status.
  assert.deepEqual(notices, [{ text: NOTICE, via: "local", intent: "status", notice: true }]);
  assert.ok(h.autopilot.history.some((item) => item.kind === "warning" && item.text === NOTICE));

  // The freed slot does not hand the second card to the same dead route.
  assert.equal(h.starts.length, 1, "the parked route starts nothing");
  assert.match(h.autopilot.waiting ?? "", /^Worker connection unavailable: OpenCode Go says this login has no active Go subscription\./);
  h.advance(4 * MINUTE); h.wake(); await h.pump();
  assert.equal(h.starts.length, 1, "still parked inside its five minutes");
  assert.equal(row(h, "second").status, "open");
  assert.equal(row(h, "second").runId, undefined, "nothing was claimed");
  assert.equal(routeFaults(h), 1, "the route fault is logged once, not every pass");

  // Past the park the next card tries it; a second refusal says nothing new
  // and parks the route twice as long.
  h.advance(MINUTE + 1000); h.wake(); await h.pump();
  assert.equal(h.starts.length, 2);
  const next = h.starts[1].taskId;
  await h.finish(next, { code: 1, lines: [REFUSED] }); await h.pump();
  assert.equal(row(h, next).runFailures, undefined);
  assert.equal(notices.length, 1, "the owner was already told");
  assert.ok(h.logs.includes("[autopilot] OpenCode Go says this login has no active Go subscription · that route waits 10m before the next card tries it"));
  h.advance(9 * MINUTE); h.wake(); await h.pump();
  assert.equal(h.starts.length, 2, "the second park is ten minutes");

  // The owner's own Start tries the refused card itself: neither the route's
  // park nor the card's refusal wait holds it, so a renewed plan need not wait.
  const other = next === "first" ? "second" : "first";
  assert.ok(row(h, next).nextRunAt > h.now(), "the refused card is still waiting");
  const started = await start(next);
  assert.equal(started.dispatch.phase, "preparing", started.dispatch.message);
  assert.equal(h.starts.length, 3);
  assert.equal(h.starts[2].taskId, next);
  assert.equal(row(h, next).nextRunAt, undefined);
  assert.ok(row(h, next).providerFailures >= 1, "its streak stays");
  // It answers: the plan is back, the park is gone, and a later refusal is news again.
  await h.finish(next); await h.pump();
  assert.equal(h.autopilot.routeRefusals.size, 0);
  assert.equal(h.starts.length, 4, "the route is no longer parked");
  assert.equal(h.starts[3].taskId, other);
  await h.finish(other, { code: 1, lines: [REFUSED] }); await h.pump();
  assert.equal(notices.length, 2, "a refusal after the route answered is told again");
});

// A card that waits for any other reason still needs Retry: Start lifts only
// the wait a refused plan left.
test("Start keeps a card's own provider cooldown", async () => {
  const { h, start } = refusalHost([task("cooling", { nextRunAt: 2_000_000, providerFailures: 2 })]);
  const result = await start("cooling");
  assert.equal(result.dispatch.held, true);
  assert.equal(result.dispatch.reason, "cooling");
  assert.equal(row(h, "cooling").nextRunAt, 2_000_000);
  assert.equal(h.starts.length, 0);
});

// A plan that leaves out one model parks that model alone. A card routed to
// it runs on the route's default instead; with nothing left it sits out the
// fill, and the next card, on another model, still starts.
const PLAN_REFUSED = "Error: glm-6 is not included in your plan";
function planHost(tasks, defaultModel, picks) {
  const route = { cli: "opencode", env: {}, modelProvider: "opencode", model: defaultModel, modelArgs: ` --model opencode-go/${defaultModel}`, via: `opencode-go/${defaultModel}` };
  const host = refusalHost(tasks, route);
  host.h.env.applyModelRouting = async (asked, options) => {
    const model = picks[/Implement fixture (\w+)/.exec(options.task)[1]];
    return { ...asked, model, routingCandidates: ["glm-6", "kimi-k3"], routingDecision: { provider: asked.provider, model, method: "fixture" } };
  };
  return host;
}

test("a model the plan leaves out falls back to the route's default model", async () => {
  const { h, notices } = planHost([task("first", { createdAt: 1 }), task("second", { createdAt: 2 })], "kimi-k3", { first: "glm-6", second: "glm-6" });
  h.wake(); await h.pump();
  assert.match(h.starts[0].line, /--model opencode-go\/glm-6/);
  await h.finish("first", { code: 1, lines: [PLAN_REFUSED] }); await h.pump();
  assert.equal(row(h, "first").runFailures, undefined, "no attempt charged");
  assert.deepEqual(notices.map((item) => item.text), ["OpenCode Go says glm-6 is not included in this login's plan. Pick another coding model in Team › Seats and models, or renew the plan."]);
  assert.equal(h.starts.length, 2, "the route still runs");
  assert.equal(h.starts[1].taskId, "second");
  assert.match(h.starts[1].line, /--model opencode-go\/kimi-k3/, "on its default, not the parked model");
  assert.ok(h.logs.includes(`[autopilot] OpenCode Go says glm-6 is not included in this login's plan · "Implement fixture second" runs on the default kimi-k3 instead`), h.logs.join("\n"));
});

test("a card with only the parked model left waits while the next card starts", async () => {
  const { h } = planHost([task("first", { createdAt: 1 }), task("second", { createdAt: 2 }), task("third", { createdAt: 3 })], "glm-6", { first: "glm-6", second: "glm-6", third: "kimi-k3" });
  h.wake(); await h.pump();
  await h.finish("first", { code: 1, lines: [PLAN_REFUSED] }); await h.pump();
  assert.equal(h.starts.length, 2);
  assert.equal(h.starts[1].taskId, "third", "a card on another model still starts");
  assert.match(h.starts[1].line, /--model opencode-go\/kimi-k3/);
  const second = row(h, "second");
  assert.equal(second.status, "open");
  assert.equal(second.runId, undefined, "nothing was claimed");
  assert.equal(second.runFailures, undefined, "nor charged");
  // With nothing else to try, the route's park is the reason given.
  await h.finish("third"); await h.pump();
  assert.equal(h.starts.length, 2);
  assert.match(h.autopilot.waiting ?? "", /^Worker connection unavailable: OpenCode Go says glm-6 is not included in this login's plan\./);
  const satOut = `[autopilot] OpenCode Go says glm-6 is not included in this login's plan · "Implement fixture second" sits out until that model is back: no other model is left for it`;
  assert.equal(h.logs.filter((line) => line === satOut).length, 1, "the feed says why once, not every fill");
});

// The owner's own pick of the parked model is not swapped for the default:
// "Try again with a heavier model" onto a model the plan leaves out ran the
// card on the default instead, where it failed, was charged and spent the
// choice. It sits out the fill uncharged with the choice kept, a card on
// another model still starts, and once the park lifts it runs the heavier
// model it was promised.
test("a heavier retry onto the parked model waits instead of running the default", async () => {
  const decided = { decisions: [{ at: 5, choice: "retry-deep", by: "owner", kind: "capability" }] };
  const { h } = planHost([task("first", { createdAt: 1 }), task("deep", { createdAt: 2, ...decided }), task("third", { createdAt: 3 })], "kimi-k3", { first: "glm-6", deep: "kimi-k3", third: "kimi-k3" });
  h.env.heavyRetryRoute = async (route) => {
    Object.assign(route, { model: "opencode-go/glm-6", modelArgs: " --model opencode-go/glm-6", modelProvider: null, via: "opencode-go/glm-6 · heavier retry" });
    return route.model;
  };
  h.wake(); await h.pump();
  assert.deepEqual(h.starts.map((start) => start.taskId), ["first"]);
  await h.finish("first", { code: 1, lines: [PLAN_REFUSED] }); await h.pump();
  assert.deepEqual(h.starts.map((start) => start.taskId), ["first", "third"], "a card on another model still starts");
  assert.match(h.starts[1].line, /--model opencode-go\/kimi-k3/);
  const held = () => row(h, "deep");
  assert.equal(held().status, "open");
  assert.equal(held().runId, undefined, "not run on the default");
  assert.equal(held().runFailures, undefined, "nor charged");
  assert.ok(!(held().logs ?? []).some((line) => /autopilot run failed/.test(line.text)));
  assert.equal(executorCore.heavyRetryPending(held()), true, "the owner's choice is kept");
  assert.ok(h.logs.includes(`[autopilot] OpenCode Go says glm-6 is not included in this login's plan · "Implement fixture deep" sits out until that model is back: its heavier retry asked for that model`), h.logs.join("\n"));
  assert.ok(!h.logs.some((line) => /runs on the default/.test(line)));
  // Alone, it waits on the route's park.
  await h.finish("third"); await h.pump();
  assert.equal(h.starts.length, 2);
  assert.match(h.autopilot.waiting ?? "", /^Worker connection unavailable: OpenCode Go says glm-6 is not included in this login's plan\./);
  assert.equal(executorCore.heavyRetryPending(held()), true);
  // Past the park the older card goes first; then the heavier model the
  // owner chose.
  h.advance(5 * MINUTE + 1000); h.wake(); await h.pump();
  assert.deepEqual(h.starts.map((start) => start.taskId), ["first", "third", "first"]);
  await h.finish("first"); await h.pump();
  assert.deepEqual(h.starts.map((start) => start.taskId), ["first", "third", "first", "deep"]);
  assert.match(h.starts[3].line, /--model opencode-go\/glm-6/);
});

// A subtask override naming the parked model is the owner's pick too.
test("a subtask override onto the parked model waits instead of running the default", async () => {
  const { h } = planHost([task("first", { createdAt: 1 }), task("sub", { createdAt: 2, delegatedFrom: { parentTaskId: "parent", scope: "s" } }), task("third", { createdAt: 3 })], "kimi-k3", { first: "glm-6", sub: "kimi-k3", third: "kimi-k3" });
  vm.runInContext(/^const OPENCODE_MODEL_ID = .*$/m.exec(source)[0], h.env);
  h.env.readAgentSettings = async () => ({ agentSubtasks: { cli: "auto", model: "opencode-go/glm-6" } });
  h.wake(); await h.pump();
  await h.finish("first", { code: 1, lines: [PLAN_REFUSED] }); await h.pump();
  assert.deepEqual(h.starts.map((start) => start.taskId), ["first", "third"]);
  assert.equal(row(h, "sub").runId, undefined, "not run on the default");
  assert.equal(row(h, "sub").runFailures, undefined);
  assert.ok(h.logs.includes(`[autopilot] OpenCode Go says glm-6 is not included in this login's plan · "Implement fixture sub" sits out until that model is back: its subtask override names that model`), h.logs.join("\n"));
});

test("an ordinary failure on the same route is charged and parks nothing", async () => {
  const { h, notices } = refusalHost([task("plain")]);
  h.wake(); await h.pump();
  await h.finish("plain", { code: 1, lines: ["npm test", "FAIL tests/billing.test.mjs"] }); await h.pump();
  const plain = row(h, "plain");
  assert.equal(plain.runFailures, 1);
  assert.equal(plain.nextRunAt, h.now() + MINUTE);
  assert.equal(plain.logs.at(-1).text, "autopilot run failed (exit 1) · FAIL tests/billing.test.mjs · retry 1/5");
  assert.deepEqual(notices, []);
  assert.equal(h.autopilot.routeRefusals, undefined);
});

test("a refusal after the run reported its verdict is the run's own", async () => {
  const { h, notices } = refusalHost([task("spoke")]);
  h.wake(); await h.pump();
  await h.finish("spoke", { code: 1, lines: ["MEFI_RESULT: done: nothing; remaining: all", REFUSED] }); await h.pump();
  assert.equal(row(h, "spoke").runFailures, 1, "a run that printed its result line was working");
  assert.deepEqual(notices, []);
});
