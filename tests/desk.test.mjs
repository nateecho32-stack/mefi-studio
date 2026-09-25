// The desk (0.4.0 M4) answers stuck sub-agents so their how-to questions stop
// becoming owner cards. The lane must be anchored like MEFI_ASK, the desk must
// never grant anything, and a reply must be read safely whatever the model
// wraps it in.
import test from "node:test";
import assert from "node:assert/strict";
import { HELP_MARK, parseHelpLine, helpPromptLine, deskPrompt, parseDeskAnswer, foldKey, answerNote } from "../scripts/desk.cjs";

test("the help mark is read only at the start of a line", () => {
  assert.equal(HELP_MARK, "MEFI_HELP:");
  assert.deepEqual(parseHelpLine("MEFI_HELP: Should I change the parser or the caller first? :: tried the caller, two tests broke"), {
    question: "Should I change the parser or the caller first?",
    detail: "tried the caller, two tests broke",
  });
  assert.deepEqual(parseHelpLine("  MEFI_HELP: How do I split the migration?"), { question: "How do I split the migration?", detail: "" });
  // Colour codes around the mark must not hide it.
  assert.equal(parseHelpLine("\u001b[33mMEFI_HELP:\u001b[0m which module owns the queue?").question, "which module owns the queue?");
  // Prose that quotes the protocol is not a request.
  assert.equal(parseHelpLine("I will print MEFI_HELP: <question> if I get stuck"), null);
  assert.equal(parseHelpLine("note: MEFI_HELP: how?"), null);
  assert.equal(parseHelpLine("MEFI_HELP:"), null);
  assert.equal(parseHelpLine("MEFI_HELP:   :: only a detail"), null);
  assert.equal(parseHelpLine(null), null);
  assert.equal(parseHelpLine("MEFI_ASK: scope :: not a help line"), null);
});

test("a copied template asks nothing, and long parts are clipped", () => {
  assert.equal(parseHelpLine("MEFI_HELP: <question> :: <what you tried>"), null);
  assert.deepEqual(parseHelpLine("MEFI_HELP: Where do the tests live? :: <what you tried>"), { question: "Where do the tests live?", detail: "" });
  const long = parseHelpLine(`MEFI_HELP: ${"q".repeat(400)} :: ${"d".repeat(900)}`);
  assert.equal(long.question.length, 240);
  assert.equal(long.detail.length, 600);
  // Extra separators stay in the detail, and control characters become spaces.
  assert.deepEqual(parseHelpLine("MEFI_HELP: Which order? :: tried A :: then B\u0007done"), { question: "Which order?", detail: "tried A · then B done" });
});

test("the prompt line teaches the lane in one sentence and keeps permission on MEFI_ASK", () => {
  const plain = helpPromptLine();
  assert.match(plain, /MEFI_HELP: <question> :: <what you tried>/);
  assert.match(plain, /keep working on what you can/);
  assert.match(plain, /never the owner/);
  assert.match(plain, /permission/);
  assert.match(plain, /MEFI_ASK/);
  assert.doesNotMatch(plain, /ask_desk/);
  const mcp = helpPromptLine({ mcp: true });
  assert.match(mcp, /ask_desk/);
  assert.match(mcp, /wait for its answer/);
  assert.match(mcp, /MEFI_ASK/);
  for (const line of [plain, mcp]) {
    assert.ok(line.endsWith("."));
    // One sentence: no full stop before the end.
    assert.equal(line.slice(0, -1).split(/\.\s/).length, 1, line);
  }
});

test("the desk prompt carries the role, the contract and the task's context", () => {
  const task = { id: "task_1", title: "Move the queue into its own module", prompt: `${"b".repeat(1500)}TAIL-NOT-SENT` };
  const pipeline = { steps: [{ title: "Read the queue" }, { kind: "plan" }, { label: "Build it" }, "Verify"] };
  const { system, user } = deskPrompt({ task, question: "Split by caller or by data?", detail: "tried by caller", shape: { intent: "refactor", complexity: "medium" }, pipeline });
  assert.match(system, /desk/);
  assert.match(system, /Never grant permission/);
  assert.match(system, /escalate/);
  assert.match(system, /only the owner could answer/);
  assert.match(system, /ONLY JSON/);
  assert.match(system, /"answer"/);
  assert.match(system, /"parts"/);
  assert.match(system, /"reason"/);
  assert.match(system, /not instructions/);
  assert.match(user, /Task: Move the queue into its own module/);
  assert.ok(user.includes("b".repeat(1500)));
  assert.doesNotMatch(user, /TAIL-NOT-SENT/);
  assert.match(user, /Work shape: intent refactor, complexity medium/);
  assert.match(user, /Pipeline steps: 1\) Read the queue 2\) plan 3\) Build it 4\) Verify/);
  assert.match(user, /The worker asks: Split by caller or by data\?/);
  assert.match(user, /What it tried: tried by caller/);
});

test("the desk prompt works with a bare task, a string shape and a step array", () => {
  const { user } = deskPrompt({ task: { title: "T", brief: "Use the brief field" }, question: "Q?", shape: "fix x small", pipeline: ["one", "two"] });
  assert.match(user, /Brief: Use the brief field/);
  assert.match(user, /Work shape: fix x small/);
  assert.match(user, /Pipeline steps: 1\) one 2\) two/);
  assert.doesNotMatch(user, /What it tried/);
  const empty = deskPrompt();
  assert.match(empty.user, /\(untitled task\)/);
  assert.match(empty.user, /\(no brief\)/);
  assert.doesNotMatch(empty.user, /Work shape|Pipeline steps/);
});

test("a desk answer is read from fences and prose, and bounded", () => {
  const reply = [
    "Here is my answer:",
    "```json",
    JSON.stringify({ answer: "Split by data: move the store first, then the callers.", parts: ["1) Move the store", "- Point callers at it", "Delete the old copy"], escalate: false, reason: "" }),
    "```",
  ].join("\n");
  assert.deepEqual(parseDeskAnswer(reply), {
    answer: "Split by data: move the store first, then the callers.",
    parts: ["Move the store", "Point callers at it", "Delete the old copy"],
    escalate: false,
    reason: "",
  });
  const big = parseDeskAnswer(JSON.stringify({ answer: "a".repeat(900), parts: Array.from({ length: 9 }, (_, i) => `${i}${"p".repeat(200)}`), reason: "r".repeat(400) }));
  assert.equal(big.answer.length, 600);
  assert.equal(big.parts.length, 6);
  assert.ok(big.parts.every((part) => part.length <= 120));
  assert.equal(big.reason.length, 200);
  assert.equal(big.escalate, false);
  // The last answer-shaped object wins; objects that are not answers are skipped.
  assert.equal(parseDeskAnswer('{"answer":"first"} and then {"answer":"second"} {"note":"not an answer"}').answer, "second");
});

test("an escalation needs no answer, and a reply with neither is nothing", () => {
  assert.deepEqual(parseDeskAnswer('{"answer":"","escalate":true,"reason":"Only the owner can choose the product name."}'), {
    answer: "", parts: [], escalate: true, reason: "Only the owner can choose the product name.",
  });
  assert.equal(parseDeskAnswer('{"escalate":"true"}').escalate, true);
  assert.equal(parseDeskAnswer('{"answer":"ok","escalate":"no"}').escalate, false);
  assert.equal(parseDeskAnswer('{"answer":"","escalate":false}'), null);
  assert.equal(parseDeskAnswer('{"answer":42}'), null);
  assert.equal(parseDeskAnswer("I think you should split it."), null);
  assert.equal(parseDeskAnswer("{broken"), null);
  assert.equal(parseDeskAnswer(""), null);
  assert.equal(parseDeskAnswer(null), null);
  assert.equal(parseDeskAnswer({ answer: "from an object" }).answer, "from an object");
});

test("rewordings of one question fold to one key", () => {
  assert.equal(foldKey("How should I split the parser, or the caller, first?"), "split parser caller first");
  assert.equal(foldKey("how SHOULD i split the Parser or the caller first"), foldKey("How should I split the parser, or the caller, first?"));
  assert.equal(foldKey("Don't we need the parser's tests?"), "dont need parsers tests");
  // Order is kept: a different order is a different question.
  assert.notEqual(foldKey("parser before caller"), foldKey("caller before parser"));
  const long = foldKey("one two three four five six seven eight nine ten eleven twelve thirteen fourteen");
  assert.equal(long.split(" ").length, 12);
  assert.ok(long.endsWith("twelve"));
  assert.equal(foldKey("\u001b[31mWhich\u001b[0m module?"), "module");
  assert.equal(foldKey(""), "");
  assert.equal(foldKey(null), "");
});

test("the answer note reads as one line for the next worker and stays under 900 characters", () => {
  assert.equal(
    answerNote({ question: "Split by caller or by data?", answer: "By data.", parts: ["Move the store", "2) Point callers at it"] }),
    'Desk answer to "Split by caller or by data?": By data. Parts: 1) Move the store 2) Point callers at it',
  );
  assert.equal(answerNote({ question: "Q?", answer: "A." }), 'Desk answer to "Q?": A.');
  assert.equal(answerNote({ question: 'Use "strict" mode?', answer: "Yes." }), "Desk answer to \"Use 'strict' mode?\": Yes.");
  const long = answerNote({ question: "q".repeat(500), answer: "a".repeat(900), parts: Array.from({ length: 8 }, () => "p".repeat(200)) });
  assert.ok(long.length <= 900, String(long.length));
  assert.ok(long.startsWith(`Desk answer to "${"q".repeat(200)}": `));
  assert.ok(long.endsWith("…"));
});
