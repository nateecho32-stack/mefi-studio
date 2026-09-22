import test from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, localReply, suggestWork } from "../scripts/assistant.mjs";

const facts = {
  tasks: [{ id: "existing", title: "Add an export button", status: "open" }],
  requests: [{ title: "Repair the saved filter", status: "running" }],
  executor: { enabled: true, running: [], queued: 1 },
};
const state = {
  status: "running",
  focus: { kind: "task", id: "existing", label: "Add an export button" },
  messages: [{ role: "assistant", text: 'Could work on "Add an export button" — say work on it.' }],
};

test("unrecognized lookups stay in chat instead of becoming additional work", () => {
  for (const text of [
    "Check the export button", "Please look into the saved filter", "Investigate this behavior",
    "Can you find the export button?", "Could you show me the export button?",
    "Inspect the saved filter", "Explain the export button", "Compare the two approaches",
  ]) {
    assert.equal(classifyIntent(text), "chat", text);
    const reply = localReply({ text, facts, state });
    assert.deepEqual(reply.actions, [], text);
    assert.equal(reply.request, null, text);
  }
});

test("questions mentioning work and service commands cannot run them", () => {
  for (const text of [
    "How can I fix the export button?", "Why is the queue stuck?", "What does cleanup do?",
    "Explain how to tidy old entries", "Would cleaning the queue help?", "Is the tree broken?",
    "When should I pause?", "How do I resume the work?", "Can the overseer fix this?",
    "Do you know why the tasks are stuck?", "Could you explain the tree layout?",
    "Check whether we should restart the interrupted work", "Find the broken export button",
    "Show me how to fix and build the export button", "Explain how to build then add a button",
    "Tree?", "The queue is a mess?",
  ]) {
    const reply = localReply({ text, facts, state });
    assert.deepEqual(reply.actions, [], `${text}: ${classifyIntent(text)}`);
    assert.equal(reply.request, null, text);
  }
});

test("builder questions report its state without silently compacting the queue", () => {
  for (const text of [
    "Why does the builder need a fix?", "How do I clean up the builder?",
    "Check the builder cleanup", "Can you explain how to clear the builder queue?",
    "Is the builder going to prune this?",
  ]) {
    assert.equal(classifyIntent(text), "builder", text);
    const reply = localReply({ text, facts, state });
    assert.deepEqual(reply.actions, [], text);
    assert.equal(reply.request, null, text);
    assert.match(reply.text, /No build worker is running/, text);
  }
  assert.deepEqual(localReply({ text: "Could you clean up the builder?", facts, state }).actions, ["compact"]);
});

test("explicit work remains actionable including polite questions and mixed lookup requests", () => {
  for (const text of [
    "Can you build the export button?", "Could you add a saved filter?",
    "Would you fix the task labels?", "Please update the saved filter", "Run the tests",
    "Show my plans and build the first one", "Show open tasks and add an export button",
    "Check the export button and fix the task labels", "Find the saved filter, then add a reset button",
    "Why is export slow? Add a cache.", "Is export cached? Please add a cache.",
  ]) {
    assert.equal(classifyIntent(text), "request", text);
    assert.deepEqual(localReply({ text, facts, state }).actions, ["queue-request", "agents"], text);
  }
});

test("saved-state queries and existing explicit service commands retain their routes", () => {
  for (const [text, intent] of [
    ["Check the status", "status"], ["Show tasks", "tasks"], ["What ideas do we have?", "ideas"],
    ["What are the agents doing?", "agents"], ["Read the log", "log"], ["Show my plans", "planning-status"],
    ["What should I work on?", "suggest"], ["Check collisions", "collisions"], ["Is the machine busy?", "machine"],
  ]) {
    assert.equal(classifyIntent(text), intent, text);
    assert.deepEqual(localReply({ text, facts, state }).actions, [], text);
  }
  for (const [text, intent, action] of [
    ["Clean up please", "tidy", "tidy"], ["Fix the problems", "fix", "fix"],
    ["Organise the tree", "organize", "organize"], ["Pause", "pause", "pause"],
    ["Resume", "resume", "resume"], ["Resume the work", "resume-work", "resume-work"],
    ["Oversee the assistant", "overseer", "overseer"], ["Clear the queue", "compact", "compact"],
  ]) {
    assert.equal(classifyIntent(text), intent, text);
    assert.deepEqual(localReply({ text, facts }).actions, [action], text);
  }
});

test("focused followups carry quoted task titles and identities without parsing prose", () => {
  const title = 'Add "Export" button';
  const reply = localReply({ text: "work on it", facts: { tasks: [{ id: "export", title, status: "open" }] },
    state: { focus: { kind: "task", id: "task:export", label: title } } });
  assert.deepEqual(reply.actions, ["queue-request", "agents"]);
  assert.equal(reply.request.resolvedTitle, title);
  assert.deepEqual(reply.request.existingTarget, { kind: "task", id: "task:export" });
});

test("actual task picks retain full titles and IDs beyond their display labels", () => {
  const title = `Add keyboard accessible search ${"with saved filters and navigation ".repeat(3)}`.trim();
  const reply = localReply({ text: "work on it", facts: { tasks: [{ id: "search", title, status: "open" }] } });
  assert.equal(reply.request.resolvedTitle, title);
  assert.ok(reply.request.title.length < title.length);
  assert.deepEqual(reply.request.existingTarget, { kind: "task", id: "search" });
});

test("offers quoted from a pick keep its full title and identity past the display clip", () => {
  const title = `Add keyboard accessible search ${"with saved filters and navigation ".repeat(3)}`.trim();
  const facts = { tasks: [{ id: "search", title, status: "open" }] };
  const offered = suggestWork(facts)[0].title;
  assert.notEqual(offered, title, "the offer is a clipped display label");
  const state = { messages: [{ role: "assistant", text: `Could work on: "${offered}" — say work on one or name your own.` }] };
  for (const text of ["yes", "work on the first one"]) {
    const reply = localReply({ text, facts, state });
    assert.equal(reply.request.resolvedTitle, title, text);
    assert.deepEqual(reply.request.existingTarget, { kind: "task", id: "search" }, text);
  }
});

test("quoted offers and affirmations never inherit an unrelated focused task identity", () => {
  const offerState = { focus: { kind: "task", id: "other", label: "Another task" },
    messages: [{ role: "assistant", text: 'Could work on "Search the task board" — say work on it.' }] };
  for (const text of ["yes", "work on it"]) {
    const reply = localReply({ text, state: offerState });
    assert.equal(reply.request.resolvedTitle, "Search the task board");
    assert.equal(reply.request.existingTarget, undefined);
  }
});

test("standalone quoted work references retain their full title but added requirements retain scope", () => {
  for (const text of ['Work on "Fix the export button".', "Please work on 'Fix the export button'", 'Can you work on “Fix the export button”?']) {
    assert.equal(classifyIntent(text), "request");
    const reply = localReply({ text, state });
    assert.equal(reply.request.resolvedTitle, "Fix the export button");
    assert.equal(reply.request.existingTarget, undefined);
  }
  for (const text of ['Work on "Search the task board" and add CSV export', 'Work on "Search the task board". Add keyboard shortcuts.']) {
    assert.equal(classifyIntent(text), "request");
    const reply = localReply({ text, state });
    assert.deepEqual(reply.actions, ["queue-request", "agents"]);
    assert.equal(reply.request, null, "the host must retain the complete user instruction");
  }
});

// "What are the open issues currently in the project?" used to fall through
// to chat and answer with the focused node and a memory dump. Issues, tickets
// and bugs are the board plus the repo's own tracker.
test("open issues, tickets and bugs read as the tasks lookup and answer from the tracker facts", () => {
  for (const text of [
    "What are the open issues currently in the project?", "Any open issues?", "Which tickets are still open",
    "List the known bugs", "show me the open tickets", "what issues are left in the tracker",
  ]) assert.equal(classifyIntent(text), "tasks", text);
  assert.equal(classifyIntent("clear the backlog"), "compact", "queue cleaning keeps its own route");
  assert.equal(classifyIntent("fix the problems"), "fix", "the fix pass keeps its route");
  const withTracker = { ...facts, projectWork: { text: 'Issue tracker: local markdown under .scratch/ (docs/agents/issue-tracker.md). .scratch/calmer: map "Calmer" (2 decided, 3 in the fog), 3 open tickets (1 on the frontier), 1 resolved.' } };
  const reply = localReply({ text: "What are the open issues currently in the project?", facts: withTracker, state });
  assert.deepEqual(reply.actions, []);
  assert.match(reply.text, /1 open task: "Add an export button"/);
  assert.match(reply.text, /Issue tracker: local markdown under \.scratch\//);
  assert.match(reply.text, /3 open tickets \(1 on the frontier\)/);
  assert.doesNotMatch(reply.text, /Kept in the thread|Memory:/);
  const bare = localReply({ text: "What are the open issues currently in the project?", facts, state });
  assert.match(bare.text, /no issue tracker Studio can read/);
  assert.match(bare.text, /the board's open issues/);
});
