import test from "node:test";
import assert from "node:assert/strict";
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
