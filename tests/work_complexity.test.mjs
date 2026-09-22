import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import backlog from "../scripts/backlog.cjs";
import * as classification from "../scripts/work-classification.mjs";
import {
  WORK_COMPLEXITIES,
  WORK_INTENTS,
  WORK_SHAPE_DEFAULT,
  WORK_WEIGHTS,
  WORK_WEIGHT_TABLE,
  interpretWorkShape,
  workShapeQuestions,
} from "../scripts/work-classification.mjs";

const answer = (intent, complexity) => ({ work_intent: { choice: intent }, work_complexity: { choice: complexity } });

// The real host selection, with the classifier transport and the board read as
// fixtures. Nothing here contacts a provider, spends a budget or starts work.
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host boundary: ${start}`);
  return source.slice(from, to);
};

function shapeHost({ tasks = [], reply = () => ({ ok: true, answers: answer("implement", "systemic"), model: "fixture-judge" }) } = {}) {
  const asked = [], charges = [];
  const client = {
    resolveJevRoute: () => "vercel",
    resolveApiKey: () => ({ key: "fixture-jev-key" }),
    gatewayConfig: () => ({ model: "typesafe-ai/jev", timeoutMs: 50 }),
    classify: async ({ state }) => {
      const title = /work title: (.*)/.exec(String(state))?.[1] ?? "";
      asked.push(title);
      return reply(title);
    },
  };
  const context = vm.createContext({
    TASKS_PATH: "fixture/eyes-tasks.json", backlog, autopilot: { autoBuild: true },
    readSettings: async () => ({}), decryptKey: () => null,
    getEyes: async () => ({ readJson: async () => structuredClone(tasks) }),
    loadModule: async (name) => (name === "scripts/decision-client.mjs" ? client : classification),
    flushJevCharges: async () => {}, chargeJevCall: async (result, kind) => charges.push(kind),
    policyRecord() {}, logLine() {}, assistantClip: (text, max) => String(text ?? "").slice(0, max),
  });
  vm.runInContext(section("const WORK_SHAPE_PER_PASS =", "function probeJev("), context);
  return { context, asked, charges, run: () => context.classifyPendingWork() };
}

// The board is stored newest-first and spawnNextJob picks oldest-first. Slicing
// the board's head paid to shape the cards furthest from running, while the
// ones about to be picked up stayed unshaped.
test("the classifier pays for the cards the dispatcher is about to run", async () => {
  // Newest first, exactly as the board holds them.
  const tasks = [5, 4, 3, 2, 1].map((n) => ({ id: `task-${n}`, title: `Work ${n}`, status: "open", createdAt: n }));
  const host = shapeHost({ tasks });
  assert.deepEqual((await host.run()).shaped, 3);
  assert.deepEqual(host.asked, ["Work 1", "Work 2", "Work 3"], "the three oldest ready cards are the next three to run");
});

test("work the dispatcher would not pick is not bought a shape", async () => {
  const now = Date.now();
  const host = shapeHost({ tasks: [
    { id: "cooling", title: "Cooling", status: "open", createdAt: 1, nextRunAt: now + 600000 },
    { id: "spent", title: "Spent", status: "open", createdAt: 2, runFailures: 5 },
    { id: "running", title: "Running", status: "active", createdAt: 3, runId: "run_1" },
    { id: "ready", title: "Ready", status: "open", createdAt: 4 },
  ] });
  await host.run();
  assert.deepEqual(host.asked, ["Ready"]);
});

// Not caching a refusal meant the same unanswerable card was re-asked, and
// re-charged, on every tick — and the cards behind it were never reached.
test("a card the classifier cannot answer backs off instead of being re-bought", async () => {
  const tasks = [3, 2, 1].map((n) => ({ id: `task-${n}`, title: `Work ${n}`, status: "open", createdAt: n }));
  const host = shapeHost({ tasks, reply: (title) => (title === "Work 1" ? { ok: false, error: "fixture refusal" } : { ok: true, answers: answer("document", "atomic"), model: "fixture-judge" }) });
  const first = await host.run();
  assert.equal(first.shaped, 2);
  assert.deepEqual(host.asked, ["Work 1", "Work 2", "Work 3"]);
  host.asked.length = 0;
  assert.equal((await host.run()).attempted, false, "nothing is left to ask, and the refusal is not re-bought");
  assert.deepEqual(host.asked, []);
});

test("an answered card is not re-bought while its shape is still held", async () => {
  const host = shapeHost({ tasks: [{ id: "task-1", title: "Work 1", status: "open", createdAt: 1 }] });
  await host.run();
  assert.equal(host.context.workShapeFor("task-1").weight, "deep");
  host.asked.length = 0;
  await host.run();
  assert.deepEqual(host.asked, []);
  assert.deepEqual(host.charges, ["jev-work-shape"], "one card, one paid call");
});

// A typed language would make the routing switch exhaustive at compile time.
// This is that guarantee's stand-in: adding a value to either axis fails here
// until its cells are filled in deliberately.
test("the routing table covers every cell of intent x complexity, and nothing else", () => {
  const expected = WORK_INTENTS.flatMap((intent) => WORK_COMPLEXITIES.map((complexity) => `${intent}:${complexity}`));
  assert.equal(expected.length, WORK_INTENTS.length * WORK_COMPLEXITIES.length);
  assert.deepEqual(Object.keys(WORK_WEIGHT_TABLE).sort(), [...expected].sort(), "add the new axis value's cells to WORK_WEIGHT_TABLE");
  for (const [cell, weight] of Object.entries(WORK_WEIGHT_TABLE)) {
    assert.ok(WORK_WEIGHTS.includes(weight), `${cell} routes to an unknown weight "${weight}"`);
  }
});

test("every cell resolves to a usable role", () => {
  for (const intent of WORK_INTENTS) {
    for (const complexity of WORK_COMPLEXITIES) {
      const shape = interpretWorkShape(answer(intent, complexity));
      assert.equal(shape.intent, intent);
      assert.equal(shape.complexity, complexity);
      assert.ok(["routine", "heavy"].includes(shape.role), `${intent}:${complexity} produced role "${shape.role}"`);
      assert.ok(shape.reason, "a route with no stated reason cannot be diagnosed later");
    }
  }
});

test("systemic scope and multi-file implementation reach for the capable model", () => {
  for (const intent of WORK_INTENTS) {
    const systemic = interpretWorkShape(answer(intent, "systemic"));
    if (intent === "document") {
      assert.equal(systemic.role, "routine", "a cross-cutting write-up is still prose");
      continue;
    }
    assert.equal(systemic.role, "heavy", `${intent} at systemic scope must not land on the cheap shortlist`);
  }
  assert.equal(interpretWorkShape(answer("implement", "compound")).role, "heavy", "multi-file edits are where a weak model costs most");
  assert.equal(interpretWorkShape(answer("implement", "atomic")).role, "routine");
  assert.equal(interpretWorkShape(answer("document", "atomic")).weight, "light");
  assert.equal(interpretWorkShape(answer("explore", "atomic")).weight, "light");
});

test("every failure degrades to today's routing, never to the cheap shortlist", () => {
  const cases = [
    [undefined, "no answer at all"],
    [{}, "an empty answer map"],
    [answer("implement", undefined), "a missing complexity"],
    [answer(undefined, "systemic"), "a missing intent"],
    [answer("refactor", "systemic"), "an intent the table does not know"],
    [answer("implement", "enormous"), "a complexity the table does not know"],
    [answer("IMPLEMENT", "SYSTEMIC"), "the right words in the wrong case"],
    [{ work_intent: "implement", work_complexity: "systemic" }, "answers that are not choice objects"],
  ];
  for (const [input, why] of cases) {
    const shape = interpretWorkShape(input);
    assert.deepEqual(shape, { ...WORK_SHAPE_DEFAULT }, `${why} must fall back cleanly`);
    assert.equal(shape.role, "routine", `${why} must route exactly as an unclassified task does today`);
  }
});

test("the questions name the work in the text and offer only the table's values", () => {
  const { questions, stateContext } = workShapeQuestions({ title: "Fold the board gateway", brief: "Touches main.cjs and scripts/board-gateway.cjs" });
  assert.equal(questions.length, 2);
  const [intent, complexity] = questions;
  assert.equal(intent.id, "work_intent");
  assert.equal(complexity.id, "work_complexity");
  for (const question of questions) {
    assert.equal(question.type, "choice");
    // The model never sees question ids, so the prompt must name the item itself.
    assert.match(question.prompt, /Fold the board gateway/, "a prompt that points instead of naming cannot be answered");
    assert.match(question.prompt, /board-gateway\.cjs/);
  }
  assert.deepEqual(intent.options, [...WORK_INTENTS], "the offered options and the table must not drift apart");
  assert.deepEqual(complexity.options, [...WORK_COMPLEXITIES]);
  assert.match(complexity.prompt, /answer systemic/, "ambiguity must resolve to the safer, larger answer");
  assert.match(stateContext, /Fold the board gateway/);
});

test("a work item with no brief still produces answerable questions", () => {
  const { questions, stateContext } = workShapeQuestions({ title: "Tidy the log tail" });
  for (const question of questions) {
    assert.match(question.prompt, /no brief beyond its title/, "the model must be told what it is missing, not left to guess");
    assert.match(question.prompt, /Tidy the log tail/);
  }
  assert.match(stateContext, /work brief: \(none\)/);
  assert.equal(workShapeQuestions().questions.length, 2, "an empty item must not throw");
});
