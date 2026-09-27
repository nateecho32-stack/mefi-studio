// Habits: short rules of behaviour per agent (scripts/habits.cjs), with their
// variants, off / brief / full and what each adds to a prompt. They reach the
// same prompts the agent's skills reach (agent-addons.cjs instructions) and
// ride a team snapshot like its skills (agent-profiles.cjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const habits = require("../scripts/habits.cjs");
const addons = require("../scripts/agent-addons.cjs");
const profiles = require("../scripts/agent-profiles.cjs");

test("a habit is off, one line, or the whole rule; its cost follows its length", () => {
  assert.equal(habits.line("explain-changes", "first", "off"), "");
  assert.equal(habits.line("explain-changes", "first", "brief"), "- Explain changes: Before you write any code, say what you are going to change and why, then make the change.");
  assert.match(habits.line("test-changes", "always", "full"), /^- Test changes, when it finishes a change: After every change/);
  assert.equal(habits.line("test-changes", "gone", "full"), habits.line("test-changes", "touched", "full"), "an unknown variant falls back");
  const cost = habits.cost("test-changes", "always");
  assert.equal(cost.off, 0);
  assert.ok(cost.brief > 0 && cost.brief < cost.full);
  assert.equal(cost.full, habits.tokens(habits.line("test-changes", "always", "full")));
});

test("a role's habits make one block, and none makes none", () => {
  assert.equal(habits.instructions(undefined), "");
  assert.equal(habits.instructions({ "explain-changes": { variant: "after", mode: "off" } }), "");
  const block = habits.instructions({ "report-shape": { variant: "sections", mode: "full" }, "explain-changes": { variant: "never", mode: "brief" } });
  assert.match(block, /^\n\nHabits the owner set for this agent/);
  assert.deepEqual(block.split("\n").slice(3).map((row) => row.split(/[:,]/)[0]), ["- Explain changes", "- Report shape"], "in the library's order");
  assert.equal(habits.total({ "report-shape": { variant: "sections", mode: "full" } }), habits.tokens(habits.instructions({ "report-shape": { variant: "sections", mode: "full" } })));
});

test("habits reach every prompt the role's skills reach", async () => {
  const text = await addons.instructions(null, { agentHabits: { builder: { "small-steps": { variant: "small", mode: "full" } } } }, "builder");
  assert.match(text, /Small steps, when a change starts to grow: Prefer the smallest change/);
  assert.equal(await addons.instructions(null, { agentHabits: { builder: { "small-steps": { variant: "small", mode: "full" } } } }, "desk"), "", "only the role they were set for");
});

test("a team snapshot carries habits, and a malformed one is refused", () => {
  assert.ok(profiles.FIELDS.includes("agentHabits"));
  assert.equal(habits.validate({ builder: { "explain-changes": { variant: "first", mode: "brief" } } }), null);
  assert.match(habits.validate({ builder: { "explain-changes": { variant: "sideways", mode: "brief" } } }), /listed habit/);
  assert.match(habits.validate({ builder: { "made-up": { variant: "x", mode: "full" } } }), /listed habit/);
  assert.match(habits.validate({ intern: {} }), /known agent role/);
  assert.match(habits.validate([]), /Invalid/);
});

test("the Agents panel shows each habit with its variants, off / brief / full and the total it adds", async () => {
  const source = await readFile(new URL("../renderer/agents.js", import.meta.url), "utf8");
  assert.match(source, /function habitsPanel\(id, config, saved\)/);
  assert.match(source, /\["off", "brief", "full"\]\.map/);
  assert.match(source, /These habits add about \$\{sum\} tokens to each of this agent's prompts\./);
  const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  assert.match(main, /habits = habitsLibrary\.library\(\)\.map\(\(habit\) => \(\{ \.\.\.habit, costs:/, "the host sends the library with each variant's cost");
});
