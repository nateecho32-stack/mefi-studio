// The chat boxes' 16,000-character limit (main.cjs assistantMessage): a message
// over it is refused whole, with the numbers, instead of being cut. Every box
// that sends one (Home, Vibe, the companion, Command's search, Build's task
// notes) already keeps what was typed when the answer is { ok: false }.
//
// Run: node --test tests/assistant_message_limit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const main = readFileSync(new URL("../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const from = main.indexOf("const ASSISTANT_MESSAGE_LIMIT = ");
const to = main.indexOf("\nasync function assistantMessage(raw, options = {}) {", from);
assert.ok(from > 0 && to > from, "the limit is defined just above assistantMessage");
const context = vm.createContext({});
vm.runInContext(`${main.slice(from, to)}\nthis.limit = ASSISTANT_MESSAGE_LIMIT; this.tooLong = assistantMessageTooLong;`, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("a message up to the limit passes and one over it is refused with its numbers", () => {
  assert.equal(context.limit, 16000);
  assert.equal(context.tooLong("x".repeat(16000)), null, "exactly at the limit is fine");
  assert.equal(context.tooLong(""), null);
  const refused = plain(context.tooLong("y".repeat(23412)));
  assert.deepEqual(refused, {
    ok: false,
    error: "That message is 23,412 characters and Mefi reads up to 16,000 at once, so nothing was sent. Cut it down or send it in parts.",
    limit: 16000,
    length: 23412,
  });
});

test("assistantMessage refuses before it touches the thread, and no longer cuts what it keeps", () => {
  const body = main.slice(main.indexOf("async function assistantMessage(raw, options = {}) {"));
  const start = body.slice(0, body.indexOf("assistantState.messages.push(user)"));
  assert.match(start, /if \(!text\) return \{ ok: false, error: "empty" \};\n  const tooLong = assistantMessageTooLong\(text\);\n  if \(tooLong\) return tooLong;\n  await ensureAssistant\(\);/, "the check comes before the assistant is even loaded");
  assert.match(start, /role: "user", text, via: "local"/, "the thread keeps the text as sent, not sliced");
  assert.doesNotMatch(start, /text\.slice\(0, 16000\)/);
});

test("the boxes show the refusal and keep what was typed", () => {
  const read = (file) => readFileSync(new URL(`../renderer/${file}`, import.meta.url), "utf8");
  // Each of these throws or shows result.error when ok is false, and clears the box only after success.
  assert.match(read("companion-ui.js"), /if \(!result\?\.ok\) throw new Error\(result\?\.error \|\| "The message could not be sent\."\);\n\s+input\.value = "";/);
});
