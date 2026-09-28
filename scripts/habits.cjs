// Mefi's Studio AI+ — habits: short rules of behaviour the owner turns on per
// agent (Agents › Setup, each role's Skills, tools & habits panel). A habit is
// one way of working ("explain changes"), with a few variants to choose from
// ("after", "first", "never") and three states: off; brief, one line in the
// agent's prompt; or full, the whole rule. Each shows what it costs in prompt
// tokens, so the owner can see what a habit adds to every call.
//
// The chosen habits reach every prompt the role's skills reach, through
// agent-addons.cjs instructions(). Stored as settings.agentHabits =
// { [role]: { [habitId]: { variant, mode } } }.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const ROLES = ["routine", "heavy", "companion", "scout", "overseer", "lead", "desk", "builder"];
const MODES = ["off", "brief", "full"];
const HABITS = Object.freeze([
  { id: "explain-changes", title: "Explain changes", fires: "when it changes code", fallback: "after", variants: {
    after: "Make the change first, then say what changed and why it has that shape, before you start the next piece of work.",
    first: "Before you write any code, say what you are going to change and why, then make the change.",
    never: "Let the change and its record speak; explain only a choice a reader could not work out for themselves.",
  } },
  { id: "test-changes", title: "Test changes", fires: "when it finishes a change", fallback: "touched", variants: {
    always: "After every change, run the project's relevant tests (or add one focused test) and report what ran and whether it passed.",
    touched: "Run the tests that cover the files you changed, and say which ones you ran.",
    never: "Run tests only when the brief asks for them, and say plainly that you did not run any.",
  } },
  { id: "small-steps", title: "Small steps", fires: "when a change starts to grow", fallback: "small", variants: {
    small: "Prefer the smallest change that meets the brief; stop and report before a change grows past what the brief asked for.",
    whole: "Make the whole change the brief needs in one pass, even when it touches several files.",
  } },
  { id: "match-style", title: "Match the code around it", fires: "whenever it writes code", fallback: "match", variants: {
    match: "Write code that reads like the code around it: its naming, its comment density and its idioms. Add no new pattern or dependency without saying why.",
    clearest: "Use the clearest idiom for each change, even where the surrounding code differs, and say where you departed from it.",
  } },
  { id: "report-shape", title: "Report shape", fires: "when it reports back", fallback: "plain", variants: {
    plain: "Report in short plain sentences: what changed, where, and how it was checked. No headings or tables.",
    sections: "Report in three short headed sections: Changed, Checked, Still open.",
  } },
  { id: "track-todos", title: "Track a to-do list", fires: "on work with several parts", fallback: "always", variants: {
    always: "Keep a short to-do list for any work with more than one part, and tick items off as you finish them.",
    never: "Keep no separate to-do list; work through the brief in order.",
  } },
]);
const byId = new Map(HABITS.map((habit) => [habit.id, habit]));

/** About how many prompt tokens a text costs (four characters a token). */
const tokens = (text) => Math.ceil(String(text ?? "").length / 4);
const firstSentence = (text) => String(text).split(/(?<=[.;])\s/)[0];

/** One habit's line in a prompt, for a variant and a mode ("" when off). */
function line(habitId, variant, mode) {
  const habit = byId.get(habitId);
  if (!habit || mode === "off" || !MODES.includes(mode)) return "";
  const rule = habit.variants[variant] ?? habit.variants[habit.fallback];
  return mode === "brief" ? `- ${habit.title}: ${firstSentence(rule)}` : `- ${habit.title}, ${habit.fires}: ${rule}`;
}
/** What one habit costs in each mode, for the editor's labels. */
function cost(habitId, variant) {
  return Object.fromEntries(MODES.map((mode) => [mode, tokens(line(habitId, variant, mode))]));
}
/** The habits block for one role's prompt, or "" when none is on. */
function instructions(chosen) {
  if (!chosen || typeof chosen !== "object") return "";
  const lines = HABITS.map((habit) => line(habit.id, chosen[habit.id]?.variant, chosen[habit.id]?.mode)).filter(Boolean);
  return lines.length ? `\n\nHabits the owner set for this agent (follow them within this task, its rules and its response format):\n${lines.join("\n")}` : "";
}
/** The prompt tokens a role's habits add to each call. */
function total(chosen) { return tokens(instructions(chosen)); }

/** An error for a malformed settings.agentHabits, or null. */
function validate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Invalid agent habits.";
  for (const [role, chosen] of Object.entries(value)) {
    if (!ROLES.includes(role) || !chosen || typeof chosen !== "object" || Array.isArray(chosen)) return "Habits belong to a known agent role.";
    for (const [habitId, pick] of Object.entries(chosen)) {
      const habit = byId.get(habitId);
      if (!habit || !pick || typeof pick !== "object" || !MODES.includes(pick.mode) || !Object.hasOwn(habit.variants, pick.variant)) return "Choose a listed habit, one of its variants, and off, brief or full.";
    }
  }
  return null;
}

/** The library as the editor shows it. */
function library() {
  return HABITS.map((habit) => ({ id: habit.id, title: habit.title, fires: habit.fires, fallback: habit.fallback, variants: Object.entries(habit.variants).map(([id, text]) => ({ id, text })) }));
}

module.exports = { ROLES, MODES, HABITS, tokens, line, cost, instructions, total, validate, library };
