import test from "node:test";
import assert from "node:assert/strict";
import { buildFacts, classifyIntent, localReply, INTENTS } from "../scripts/assistant.mjs";

const summary = {
  total: 8, active: 5, ready: 2, converting: 1, converted: 3, truncated: 3,
  plans: [
    { id: "plan_export", title: "CSV export", status: "planning", destination: "Download the displayed rows", openQuestions: 2, unknowns: 1, readyQuestions: [{ id: "question_rows", question: "Which columns should be included?" }] },
    { id: "plan_settings", title: "Project settings", status: "ready", destination: "Edit local preferences", openQuestions: 0, unknowns: 0, readyQuestions: [] },
    { id: "plan_search", title: "Search", status: "converting", destination: "Find saved work", openQuestions: 0, unknowns: 0, readyQuestions: [] },
    { id: "plan_history", title: "History", status: "planning", destination: "Keep decisions", openQuestions: 1, unknowns: 0, readyQuestions: [{ id: "question_history", question: "How should revisions appear?" }] },
    { id: "plan_theme", title: "Theme", status: "converted", destination: "Customize the appearance", openQuestions: 0, unknowns: 0, readyQuestions: [] },
  ],
};

test("explicit saved-plan queries route to a read-only planning intent", () => {
  assert.ok(INTENTS.includes("planning-status"));
  for (const text of ["show my plans", "planning status", "what plans do I have?", "open questions in my plans", "Please show me my plans.", "Could you show the saved plans?", "What's the planning status?", "show me the open questions in my plans", "list our plans", "open Plans"]) {
    assert.equal(classifyIntent(text), "planning-status", text);
    const reply = localReply({ text, facts: buildFacts({ planning: summary }) });
    assert.deepEqual(reply.actions, [], `${text} cannot schedule work`);
    assert.equal(reply.request, null);
  }
});

test("planning mentions do not intercept implementation instructions or ordinary assistant intents", () => {
  for (const text of ["build the plans panel", "Implement planning status", "Please add a planning summary", "Create tasks from this plan", "write a plan for CSV exports", "fix the planning status page", "work on the plans", "show my plans and build the first one"]) {
    assert.equal(classifyIntent(text), "request", text);
  }
  for (const text of ["Plan and build this", "Plan an idea", "help me plan CSV exports", "The plan is to add a search box"]) {
    assert.notEqual(classifyIntent(text), "planning-status", text);
  }
  assert.equal(classifyIntent("what tasks are open?"), "tasks");
  assert.equal(classifyIntent("builder status"), "builder");
  assert.equal(classifyIntent("what ideas do we have?"), "ideas");
});

test("planning facts preserve whole-store counts and clone the bounded summary", () => {
  const input = structuredClone(summary);
  const facts = buildFacts({ planning: input });
  assert.deepEqual(facts.planning, input);
  assert.notEqual(facts.planning, input);
  assert.notEqual(facts.planning.plans[0], input.plans[0]);
  assert.notEqual(facts.planning.plans[0].readyQuestions[0], input.plans[0].readyQuestions[0]);
  input.plans[0].title = "Changed externally";
  input.plans[0].readyQuestions[0].question = "Changed question";
  assert.equal(facts.planning.plans[0].title, "CSV export");
  assert.equal(facts.planning.plans[0].readyQuestions[0].question, "Which columns should be included?");
  assert.equal(facts.planning.total, 8, "the summary contains five rows but retains all eight plans");
});

test("planning facts bound context without leaking full specifications or notes", () => {
  const input = { ...summary, total: 20, truncated: 10, plans: Array.from({ length: 10 }, (_, index) => ({
    ...summary.plans[0], id: `plan_${index}`, title: "t".repeat(1000), destination: "d".repeat(10000),
    spec: { text: "Private full spec" }, history: ["Full history"],
    readyQuestions: Array.from({ length: 6 }, (_, question) => ({ id: `question_${question}`, question: "q".repeat(10000), notes: ["Long discussion"] })),
  })) };
  const facts = buildFacts({ planning: input }).planning;
  assert.equal(facts.total, 20);
  assert.equal(facts.plans.length, 5);
  assert.equal(facts.truncated, 15);
  assert.ok(facts.plans[0].title.length <= 180);
  assert.ok(facts.plans[0].destination.length <= 400);
  assert.equal(facts.plans[0].readyQuestions.length, 2);
  assert.ok(facts.plans[0].readyQuestions[0].question.length <= 250);
  assert.equal(facts.plans[0].spec, undefined);
  assert.equal(facts.plans[0].history, undefined);
  assert.equal(facts.plans[0].readyQuestions[0].notes, undefined);
});

test("planning replies use actual counts, saved names and a ready question without claiming work started", () => {
  const reply = localReply({ text: "show my plans", facts: buildFacts({ planning: summary }) });
  assert.match(reply.text, /8 saved plans/);
  assert.match(reply.text, /5 active/);
  assert.match(reply.text, /2 ready to create tasks/);
  assert.match(reply.text, /1 creating tasks/);
  assert.match(reply.text, /3 handed to the task board/);
  assert.match(reply.text, /CSV export/);
  assert.match(reply.text, /Project settings/);
  assert.match(reply.text, /Which columns should be included/);
  assert.match(reply.text, /Open Plans/);
  assert.match(reply.text, /3 more saved plans/);
  assert.deepEqual(reply.actions, []);
  assert.equal(reply.request, null);
  assert.doesNotMatch(reply.text, /queued|worker.*started|completed|done|roster goes/);
});

test("empty planning state points to Plan an idea, while unavailable state stays unknown", () => {
  const empty = { total: 0, active: 0, ready: 0, converting: 0, converted: 0, plans: [], truncated: 0 };
  const reply = localReply({ text: "planning status", facts: buildFacts({ planning: empty }) });
  assert.match(reply.text, /No saved plans in this project/);
  assert.match(reply.text, /Plan an idea/);
  assert.deepEqual(reply.actions, []);
  for (const planning of [null, undefined, {}, { plans: [], total: NaN }, { plans: [], total: -1 }]) {
    const missing = localReply({ text: "planning status", facts: buildFacts({ planning }) });
    assert.match(missing.text, /could not read/);
    assert.doesNotMatch(missing.text, /No saved plans|0 saved/);
    assert.deepEqual(missing.actions, []);
  }
});

test("plans with only broad unknowns guide clarification without inventing a next question", () => {
  const planning = { total: 1, active: 1, ready: 0, converting: 0, converted: 0, truncated: 0, plans: [{ ...summary.plans[0], openQuestions: 0, unknowns: 3, readyQuestions: [] }] };
  const reply = localReply({ intent: "planning-status", facts: buildFacts({ planning }) });
  assert.match(reply.text, /3 unknowns to clarify/);
  assert.doesNotMatch(reply.text, /Next question/);
  assert.deepEqual(reply.actions, []);
});
