import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { buildContext, estimateTokens } = createRequire(import.meta.url)("../scripts/context-manager.cjs");

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

test("context preview includes current requirements, grouped obligations and truthful prerequisite status without mutation", () => {
  const task = deepFreeze({ id: "build", projectId: "ours", title: "Finish grouped work", status: "open", prompt: "Keep the full current brief", members: [{ id: "member", title: "Member", prompt: "The member's original requirement" }], remaining: ["Wire the final button"], handoff: "Keep existing behavior", dependsOn: ["ready", "waiting", "missing"], refs: [{ path: "src/app.js" }], lastAttempt: { result: "Saved report" }, contextHistory: { entries: [{ snapshot: { prompt: "Obsolete requirement" } }] } });
  const tasks = deepFreeze([{ id: "ready", status: "done", doneAt: 5, projectId: "ours" }, { id: "waiting", title: "Pending prerequisite", status: "open", projectId: "ours" }]);
  const preview = buildContext({ task, tasks });
  assert.equal(preview.ok, true);
  assert.equal(preview.mode, "context-preview");
  assert.match(preview.text, /full current brief/);
  assert.match(preview.text, /original requirement/);
  assert.match(preview.text, /Wire the final button/);
  assert.match(preview.text, /Missing prerequisite/);
  assert.match(preview.text, /Pending prerequisite/);
  assert.ok(!preview.text.includes("Obsolete requirement"), "a preview must not roll the task back to historical requirements");
  assert.deepEqual(task.dependsOn, ["ready", "waiting", "missing"]);
});

test("oversized briefs preserve room for unresolved work and expose every omitted or excerpted section", () => {
  const task = { id: "large", title: "Large task", prompt: "Current requirement. ".repeat(10000), members: [{ title: "Grouped member", prompt: "Group requirement. ".repeat(5000) }], remaining: ["Unresolved acceptance check"], handoff: "Continue from the latest result", refs: ["reference ".repeat(5000)], lastAttempt: { result: "old report ".repeat(5000) } };
  const preview = buildContext({ task, budgetTokens: 2000 });
  assert.ok(preview.text.length <= 8000);
  assert.ok(preview.estimatedTokens <= 2000);
  assert.equal(preview.truncated, true);
  assert.match(preview.text, /Unresolved acceptance check/);
  assert.match(preview.text, /Continue from the latest result/);
  assert.ok(preview.sections.filter((section) => section.truncated).every((section) => section.reason && section.source));
  assert.ok(preview.sections.filter((section) => !section.included).every((section) => section.text === ""));
  assert.equal(task.prompt.length, "Current requirement. ".length * 10000);
});

test("all supported budgets include their headers and separators in the hard text bound", () => {
  for (const budgetTokens of [0, 1, 128, 129, 255, 1000, 6000, 32000, 999999, -2, NaN, Infinity, "500"]) {
    const preview = buildContext({ task: { id: "t".repeat(300), title: "A huge title ".repeat(10000), prompt: "Requirements ".repeat(50000), remaining: ["Work remains"], refs: ["saved reference"] }, budgetTokens });
    assert.ok(preview.text.length <= preview.budgetTokens * 4, `budget ${budgetTokens}`);
    assert.ok(preview.estimatedTokens <= preview.budgetTokens);
    assert.equal(preview.estimatedTokens, estimateTokens(preview.text));
    assert.match(preview.estimateMethod, /estimate|Estimated/);
    assert.match(preview.text, /not a model tokenizer/);
    assert.equal(preview.taskId, "t".repeat(300));
  }
});

test("a small budget prioritizes the current task over references and notes", () => {
  const preview = buildContext({ task: { id: "tiny", title: "Keep this brief", prompt: "Implement the actual requested work", refs: ["background source".repeat(500)] }, nodeFolder: { entries: [{ at: 1, text: "old unrelated chatter".repeat(500) }] }, budgetTokens: 128 });
  assert.equal(preview.sections[0].included, true);
  assert.match(preview.text, /Keep this brief/);
  assert.equal(preview.sections.find((section) => section.kind === "notes").included, false);
  assert.equal(preview.truncated, true);
});

test("notes use the newest saved records and preserve superseded warnings without changing the folder", () => {
  const folder = deepFreeze({ entries: Array.from({ length: 12 }, (_, index) => ({ at: index, kind: "note", text: `note-${index}`, superseded: index === 11 })).reverse() });
  const preview = buildContext({ task: { id: "task", title: "Context" }, nodeFolder: folder });
  const notes = preview.sections.find((section) => section.kind === "notes");
  assert.ok(notes.text.indexOf("note-11") < notes.text.indexOf("note-10"));
  assert.ok(!notes.text.includes("note-0\n"));
  assert.match(notes.text, /superseded: true/);
  assert.equal(notes.truncated, true, "retaining only recent notes is disclosed as an excerpt");
  assert.equal(folder.entries[0].at, 11);
});

test("foreign-project prerequisite records are not borrowed as proof of completion", () => {
  const preview = buildContext({ task: { id: "task", projectId: "ours", dependsOn: ["foreign"] }, tasks: [{ id: "foreign", status: "done", projectId: "theirs" }] });
  assert.match(preview.text, /Missing prerequisite/);
  assert.match(preview.text, /status: missing/);
  assert.ok(!preview.text.includes("All listed prerequisites"));
});

test("cycles and missing task inputs fail truthfully without resolving or executing anything", () => {
  const task = { id: "task", dependsOn: ["peer"] };
  const preview = buildContext({ task, tasks: [{ id: "peer", dependsOn: ["task"], status: "open" }] });
  assert.match(preview.text, /form a cycle/);
  for (const input of [undefined, null, {}, { task: null }, { task: {} }]) {
    const missing = buildContext(input);
    assert.equal(missing.ok, false);
    assert.equal(missing.text, "");
    assert.deepEqual(missing.sections, []);
  }
});

test("long display titles cannot consume the whole brief, and grouped idea detail remains available", () => {
  const preview = buildContext({ task: { id: "task", title: "Display label ".repeat(2000), prompt: "The real requirement stays visible", members: [{ title: "Idea", detail: "Original idea detail" }] }, budgetTokens: 1000 });
  assert.match(preview.text, /The real requirement stays visible/);
  assert.match(preview.text, /Original idea detail/);
  assert.equal(preview.sections[0].truncated, true);
  assert.equal(buildContext({ task: { id: "task" }, budgetTokens: Symbol("invalid") }).budgetTokens, 6000);
});

test("malformed cyclic saved values and long member collections stay bounded and are explicitly excerpted", () => {
  const context = { note: "Keep the saved circular value" }; context.circular = context;
  const task = { id: "legacy", title: "Old task", context, members: Array.from({ length: 1000 }, (_, index) => ({ title: `member-${index}`, prompt: "keep original detail" })) };
  const preview = buildContext({ task, budgetTokens: 1000 });
  assert.ok(preview.text.length <= 4000);
  assert.equal(preview.sections.find((section) => section.kind === "members").truncated, true);
  assert.equal(preview.sections.find((section) => section.kind === "obligations").truncated, true);
  assert.equal(task.members.length, 1000);
  assert.equal(task.context.circular, context);
});
