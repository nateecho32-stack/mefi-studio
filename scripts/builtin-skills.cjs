// Skills that come with Studio. Today they are answer styles: how the chat (or any
// agent the owner turns one on for) says things, never what it does. ELI5 is the
// chat's style until the owner picks another (scripts/skill-use.cjs DEFAULT_STYLE).
//
// A built-in skill is the same thing as a project's SKILL.md: a name (the /command),
// a one-line description an agent matches a request against, and instructions.
// `text` is the file it would be, so "Copy to this project" writes exactly this and
// the project's copy then wins over the built-in (a name resolves project first,
// then the home folder, then Studio's own: agent-addons.cjs skillCatalog).
//
// Every style keeps to the agent's own task and response format: the chat still
// answers in at most 120 plain words and still acts only on the owner's words.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const format = require("./skill-format.cjs");

const SKILLS = Object.freeze([
  {
    name: "eli5",
    title: "Explain like I'm 5",
    short: "ELI5",
    kind: "style",
    description: "Answer in plain words a curious five-year-old could follow: the answer first, short sentences, one everyday comparison, no jargon.",
    body: [
      "Explain things the way you would to a curious five-year-old, without talking down:",
      "- Lead with the answer in one short sentence.",
      "- Use everyday words. When a technical word is needed, say what it means in five words or fewer, like \"a branch (a safe copy to try changes in)\".",
      "- Use at most one comparison to everyday life: a recipe, a toy box, a post office.",
      "- Short sentences, one idea each.",
      "- Say what it means for the person: what happens next, or what they can do now.",
      "- Simpler words, never wrong ones: keep every fact exact and keep any step that matters.",
    ].join("\n"),
  },
  {
    name: "brief",
    title: "Short answers",
    short: "Short",
    kind: "style",
    description: "Answer in as few words as the question allows: one or two sentences, the answer first, no greeting or recap.",
    body: [
      "Answer in as few words as the question allows:",
      "- One or two sentences. Lead with the answer; no greeting and no recap of the question.",
      "- Use a short list only when the answer is three or more separate things.",
      "- Leave out background nobody asked for. If more detail matters, offer it in a few words at the end.",
    ].join("\n"),
  },
  {
    name: "teach-me",
    title: "Teach me",
    short: "Teach me",
    kind: "style",
    description: "Teach instead of just telling: the answer, then why it works that way, one step at a time with a small example and a check question.",
    body: [
      "Teach, don't just tell:",
      "- Give the answer first in one line, then explain why it works that way.",
      "- Go one step at a time, building on what the person already knows.",
      "- Use one small, concrete example from their own project when you can.",
      "- End with one short question that checks the idea landed or invites the next step.",
    ].join("\n"),
  },
  {
    name: "brainstorm",
    title: "Brainstorm",
    short: "Brainstorm",
    kind: "style",
    description: "Think wide before narrowing: three to five different options with one trade-off each, then the one you would pick and why.",
    body: [
      "Think wide before narrowing:",
      "- Offer three to five options that are really different, not variations of one idea.",
      "- Give each option one line: what it is and its main trade-off.",
      "- Include at least one unusual option.",
      "- Finish with the option you would pick and why, in one sentence.",
    ].join("\n"),
  },
  {
    name: "poke-holes",
    title: "Poke holes",
    short: "Poke holes",
    kind: "style",
    description: "Be the friendly critic: before agreeing, name the ways a plan is most likely to fail and the smallest change that prevents each.",
    body: [
      "Be the friendly critic:",
      "- Before agreeing with a plan or idea, name the two or three ways it is most likely to go wrong: edge cases, hidden costs, things that are hard to undo.",
      "- Put the likeliest and most harmful first.",
      "- For each, suggest the smallest change that would prevent it.",
      "- Stay kind and specific. When the idea holds up, say so plainly.",
    ].join("\n"),
  },
  {
    name: "expert",
    title: "Expert",
    short: "Expert",
    kind: "style",
    description: "The person knows the field: be precise and technical, with exact names, versions, paths and numbers, and no basics or analogies.",
    body: [
      "The person knows the field. Be precise and technical:",
      "- Use exact terms, names, versions, file paths and numbers; no analogies.",
      "- Skip basics and definitions unless they are asked for.",
      "- State assumptions and trade-offs, and what would change the answer.",
      "- Prefer the specific over the general.",
    ].join("\n"),
  },
].map((skill) => Object.freeze({ ...skill, text: format.build(skill) })));

const byName = new Map(SKILLS.map((skill) => [skill.name, skill]));

/** Every built-in skill: { name, title, short (the chip's word for it), kind, description, body, text }. */
const list = () => SKILLS.map((skill) => ({ ...skill }));
/** One built-in skill by name, or null. */
const get = (name) => (byName.has(name) ? { ...byName.get(name) } : null);
/** The answer styles, in the order a picker shows them. */
const styles = () => SKILLS.filter((skill) => skill.kind === "style").map((skill) => ({ ...skill }));
const NAMES = Object.freeze(SKILLS.map((skill) => skill.name));

module.exports = { list, get, styles, NAMES };
