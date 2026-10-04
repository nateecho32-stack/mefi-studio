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
const start = main.indexOf("async function assistantMessage(raw, options = {}) {");
const guardFrom = main.indexOf("  const limit = 16000;", start);
const guardTo = main.indexOf("  await ensureAssistant();", guardFrom);
assert.ok(start > 0 && guardFrom > start && guardTo > guardFrom, "the guard is inside assistantMessage, before the assistant is loaded");
// The guard as a function of the text: null when it passes, the refusal when it does not.
const context = vm.createContext({});
const tooLong = vm.runInContext(`(text) => {\n${main.slice(guardFrom, guardTo)}\n  return null;\n}`, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("a message up to the limit passes and one over it is refused with its numbers", () => {
  assert.equal(tooLong("x".repeat(16000)), null, "exactly at the limit is fine");
  assert.equal(tooLong(""), null);
  const refused = plain(tooLong("y".repeat(23412)));
  assert.deepEqual(refused, {
    ok: false,
    error: "That message is 23,412 characters and Mefi reads up to 16,000 at once, so nothing was sent. Cut it down or send it in parts.",
    limit: 16000,
    length: 23412,
  });
});

test("assistantMessage refuses before it touches the thread, and no longer cuts what it keeps", () => {
  const body = main.slice(start);
  const head = body.slice(0, body.indexOf("assistantState.messages.push(user)"));
  assert.match(head, /if \(!text\) return \{ ok: false, error: "empty" \};\n[\s\S]*?const limit = 16000;\n  if \(text\.length > limit\) \{[\s\S]*?\n  \}\n  await ensureAssistant\(\);/, "the check comes before the assistant is even loaded");
  assert.match(head, /role: "user", text, via: "local"/, "the thread keeps the text as sent, not sliced");
  assert.doesNotMatch(head, /text\.slice\(0, 16000\)/);
});

test("the boxes show the refusal and keep what was typed", () => {
  const read = (file) => readFileSync(new URL(`../renderer/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // Each of these throws or shows result.error when ok is false, and clears the box only after success.
  assert.match(read("companion-ui.js"), /if \(!result\?\.ok\) throw new Error\(result\?\.error \|\| "The message could not be sent\."\);\n\s+input\.value = "";/);
});
