import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// What a message points at, read on the host (scripts/mentions.cjs): files, tasks and skills, the path
// cleaning that keeps a mention inside the project, the sentence a file becomes (its name, never its
// contents), the skills' own text inside a budget, and what the reply says about what did not go.
const require = createRequire(import.meta.url);
const mentions = require("../scripts/mentions.cjs");
const plain = (value) => JSON.parse(JSON.stringify(value));

test("a file, a task and a skill are read where a word starts, and nowhere else", () => {
  const skills = ["bug-triage", "release-notes"];
  const table = [
    ["look at @src/app.js please", [["file", "src/app.js"]]],
    ["@README.md first", [["file", "README.md"]]],
    ["see @\"notes/meeting notes.md\" too", [["file", "notes/meeting notes.md"]]],
    ["read @\"Makefile\"", [["file", "Makefile"]]],
    ["thanks @sam", []],
    ["mail me@example.com", []],
    ["a@b.c is an address", []],
    ["x@src/app.js", []],
    ["trailing @src/app.js.", [["file", "src/app.js"]]],
    ["(see @src/app.js), then @docs/a.md; and @b.txt!", [["file", "src/app.js"], ["file", "docs/a.md"], ["file", "b.txt"]]],
    ["fix #\"Fix the sidebar\" now", [["task", "Fix the sidebar"]]],
    ["issue #12 and #nope", []],
    ["a#\"glued\" title", []],
    ["use /bug-triage here", [["skill", "bug-triage"]]],
    ["/release-notes", [["skill", "release-notes"]]],
    ["use /bug-triage, then /release-notes.", [["skill", "bug-triage"], ["skill", "release-notes"]]],
    ["/unknown-skill is not one of ours", []],
    ["see /usr/bin and https://example.com/bug-triage", []],
    ["half/bug-triage", []],
    ["/bug-triage/extra", []],
    ["/Bug-Triage", []],
    ["@src/app.js @src/app.js #\"T\" #\"T\" /bug-triage /bug-triage", [["file", "src/app.js"], ["task", "T"], ["skill", "bug-triage"]]],
    ["/bug-triage on @src/a.js for #\"Task one\"", [["skill", "bug-triage"], ["file", "src/a.js"], ["task", "Task one"]]],
    ["", []], [null, []], [undefined, []],
  ];
  for (const [text, expected] of table) assert.deepEqual(mentions.parse(text, { skills }).map((row) => [row.kind, row.text]), expected, JSON.stringify(text));
  assert.deepEqual(mentions.parse("/bug-triage"), [], "with no skills named, a /word is not a mention");
});

test("a path is cleaned to something inside the project or refused", () => {
  const good = [["src/app.js", "src/app.js"], ["./src/app.js", "src/app.js"], ["src\\ui\\x.js", "src/ui/x.js"], ["  docs/a b.md  ", "docs/a b.md"], ["a", "a"], ["deep/er/still/file.txt", "deep/er/still/file.txt"]];
  for (const [given, clean] of good) assert.equal(mentions.cleanPath(given), clean, given);
  const refused = ["", "   ", null, undefined, "/etc/passwd", "\\\\server\\share\\x", "C:\\Windows\\x", "C:/x", "c:x", "../secret", "a/../../b", "a/./b", "a//b", "src/", "..", ".", "file.txt:stream", "file.txt::$DATA", "a\u0000b", "a\nb", "say \"hi\"", "x".repeat(301)];
  for (const given of refused) assert.equal(mentions.cleanPath(given), null, JSON.stringify(given));
  assert.equal(mentions.cleanPath("x".repeat(300)), "x".repeat(300));
});

test("files() gives the cleaned paths a message names, without repeats, at most eight", () => {
  assert.deepEqual(mentions.files("@a/b.js and @./a/b.js and @c\\d.js and @../up.js and @/abs.js and @C:/x.js"), ["a/b.js", "c/d.js"]);
  const many = Array.from({ length: 12 }, (_, index) => `@f/${index}.js`).join(" ");
  assert.equal(mentions.files(many).length, 8);
  assert.deepEqual(mentions.files("nothing here"), []);
  assert.deepEqual(mentions.files(`@"notes/two words.md"`), ["notes/two words.md"]);
});

test("skillCalls() reads the /names used and says which were plainly meant as skills", () => {
  assert.deepEqual(plain(mentions.skillCalls("/review this")), [{ name: "review", asked: true }], "at the start of the message");
  assert.deepEqual(plain(mentions.skillCalls("  \n /review this")), [{ name: "review", asked: true }], "after only space");
  assert.deepEqual(plain(mentions.skillCalls("please use /tmp for that")), [{ name: "tmp", asked: false }], "a path-like word mid-message is not plainly a skill");
  assert.deepEqual(plain(mentions.skillCalls("please use /bug-triage for that")), [{ name: "bug-triage", asked: true }], "a dashed name is");
  assert.deepEqual(plain(mentions.skillCalls("/a and /a and /b-c")), [{ name: "a", asked: true }, { name: "b-c", asked: true }]);
  assert.deepEqual(mentions.skillCalls("no slash words, a/b, /usr/bin, https://x.y/z"), []);
});

test("a file becomes one sentence naming it, and it says the contents are not there", () => {
  assert.equal(mentions.fileLine([]), "");
  assert.equal(mentions.fileLine(["src/app.js"]), "The owner's message points at this project file: src/app.js. Only the name is given here, not the contents; read it only if your tools allow it.");
  assert.equal(mentions.fileLine(["a.js", "b/c.md"]), "The owner's message points at these project files: a.js, b/c.md. Only the names are given here, not the contents; read them only if your tools allow it.");
  assert.equal(mentions.fileLine(null), "");
});

test("skills are added in the order called, inside a budget; the first always fits, later ones need room, four at most", () => {
  const text = (size, mark = "x") => mark.repeat(size);
  const section = mentions.skillSection([{ name: "a", text: text(5000) }, { name: "b", text: text(5000) }]);
  assert.deepEqual(section.used, ["a", "b"]);
  assert.deepEqual(section.skipped, []);
  assert.match(section.text, /^\n\nSkills the owner asked for by name in this message \(follow them within this agent's existing task, tool permissions and response format\):\nSkill: a\nx{5000}\n\nSkill: b\nx{5000}$/);
  // A skill over 16,000 characters "only loads when called": called, it loads; it leaves no room for the next.
  const big = mentions.skillSection([{ name: "big", text: text(20000) }, { name: "small", text: text(100) }]);
  assert.deepEqual(big.used, ["big"]);
  assert.deepEqual(plain(big.skipped), [{ name: "small", reason: "room", chars: 100, room: 0 }]);
  // The budget is shared: a second one that does not fit what is left is skipped, and a third that does is not.
  const third = mentions.skillSection([{ name: "a", text: text(9000) }, { name: "b", text: text(9000) }, { name: "c", text: text(6000) }]);
  assert.deepEqual(third.used, ["a", "c"]);
  assert.deepEqual(plain(third.skipped), [{ name: "b", reason: "room", chars: 9000, room: 7000 }]);
  // Exactly the budget is fine; one more is not.
  assert.deepEqual(mentions.skillSection([{ name: "a", text: text(8000) }, { name: "b", text: text(8000) }]).used, ["a", "b"]);
  assert.deepEqual(mentions.skillSection([{ name: "a", text: text(8000) }, { name: "b", text: text(8001) }]).used, ["a"]);
  // Four at most.
  const five = mentions.skillSection(["a", "b", "c", "d", "e"].map((name) => ({ name, text: "t" })));
  assert.deepEqual(five.used, ["a", "b", "c", "d"]);
  assert.deepEqual(plain(five.skipped), [{ name: "e", reason: "limit", chars: 1, room: 15996 }]);
  assert.deepEqual(mentions.skillSection([]), { text: "", used: [], skipped: [] });
  assert.deepEqual(mentions.skillSection([{ name: "empty", text: "" }, { text: "no name" }, null]).used, [], "nothing to add is nothing added");
  assert.equal(mentions.SKILL_BUDGET_CHARS, 16000);
});

test("the reply says, once and plainly, what did not go", () => {
  assert.deepEqual(mentions.notes({}), []);
  assert.deepEqual(mentions.notes({ missing: ["nope"] }), ["I couldn't find a skill named /nope in this project, so I answered without it."]);
  assert.deepEqual(mentions.notes({ missing: ["a-b", "c-d"] }), ["I couldn't find skills named /a-b, /c-d in this project, so I answered without them."]);
  assert.deepEqual(mentions.notes({ skipped: [{ name: "long-one", reason: "room", chars: 9000, room: 7000 }] }), ["/long-one is too long to add to this message along with the others (9,000 characters; 7,000 left of 16,000), so I answered without it."]);
  assert.deepEqual(mentions.notes({ skipped: [{ name: "e-e", reason: "limit", chars: 1, room: 10 }, { name: "f-f", reason: "limit", chars: 1, room: 10 }] }), ["A message carries at most 4 skills, so I left out /e-e, /f-f."]);
});
