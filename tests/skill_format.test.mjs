import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// The one place the rules for a skill are written (scripts/skill-format.cjs): what a name may be,
// the front matter, the size the inventory accepts, what a picker shows beside a skill, and the
// starters. The Skills page, the host and an import all call this.
const require = createRequire(import.meta.url);
const format = require("../scripts/skill-format.cjs");

test("a skill's name is lowercase letters, numbers and dashes, 1 to 64, starting with a letter or number", () => {
  const good = ["a", "0", "bug-triage", "0day", "a-b-c", "x".repeat(64), "release-2"];
  const bad = ["", null, undefined, 7, "A", "Bug", "bug_triage", "-lead", "trail ", " lead", "a b", "a.b", "a/b", "a\\b", "..", ".hidden", "x".repeat(65), "é", "a\n", "a:b", "CON ", "a\u0000"];
  for (const name of good) assert.equal(format.nameProblem(name), null, `${JSON.stringify(name)} is allowed`);
  for (const name of bad) assert.match(format.nameProblem(name), /^(Give the skill a name\.|Use lowercase letters, numbers and dashes, up to 64 characters\.)$/, `${JSON.stringify(name)} is refused`);
  assert.equal(format.nameProblem(""), "Give the skill a name.");
  assert.equal(format.nameProblem("Bug"), "Use lowercase letters, numbers and dashes, up to 64 characters.");
  // Names Windows keeps for devices can not be folders there.
  for (const reserved of ["con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9"]) assert.equal(format.nameProblem(reserved), "Windows keeps that name for itself. Choose another.", reserved);
  for (const fine of ["console", "con-sole", "com", "com10", "lpt", "auxiliary", "nul-ler", "com0"]) assert.equal(format.nameProblem(fine), null, fine);
  assert.equal(format.fileOf("bug-triage"), ".agents/skills/bug-triage/SKILL.md");
});

test("what is built reads back exactly, for descriptions that could be mistaken for YAML", () => {
  const descriptions = [
    "Sort a bug report into severity and owner", "Colon: in the middle", "ends with a colon:", "has a # hash", "#starts with a hash", "\"quoted\" words", "it's a single quote",
    "yes", "true", "null", "12345", "3.14", "- a dash first", "[brackets] and {braces}", "a, b, c", "back\\slash", "tab\tinside", "ünïcödé — and a dash", "*starred", "&anchor", "!tag", "| pipe", "> fold", "%percent", "@at", "`tick`", "a   b", "(paren first)",
  ];
  for (const description of descriptions) {
    const text = format.build({ name: "x", description, body: "Do the thing.\n" });
    const read = format.parse(text);
    assert.equal(read.frontMatter, true);
    assert.equal(read.name, "x");
    assert.equal(read.description, description.replace(/\s+/g, " ").trim(), `${JSON.stringify(description)} survives a build and a parse`);
    assert.equal(read.body, "Do the thing.\n");
  }
  const text = format.build({ name: "bug-triage", description: "Sort a bug report", body: "\n\n1. Read it.\n2. Fix it.   \n\n\n" });
  assert.equal(text, "---\nname: bug-triage\ndescription: Sort a bug report\n---\n\n1. Read it.\n2. Fix it.\n", "the body loses the blank lines around it and ends with one newline");
});

test("parse reads the forms real SKILL.md files come in", () => {
  const crlf = format.parse("---\r\nname: a\r\ndescription: one\r\n---\r\n\r\nBody\r\nmore\r\n");
  assert.deepEqual({ ...crlf }, { frontMatter: true, name: "a", description: "one", body: "Body\nmore\n", extra: "" }, "CRLF and a leading blank line are read");
  assert.equal(format.parse("\uFEFF---\nname: a\ndescription: d\n---\nB").name, "a", "a byte-order mark is ignored");
  assert.equal(format.parse("---\nname: a\ndescription: >\n  folded over\n  two lines\n---\nB").description, "folded over two lines", "a folded block becomes one line");
  assert.equal(format.parse("---\nname: a\ndescription: |-\n  kept\n  lines\n---\nB").description, "kept lines");
  assert.equal(format.parse("---\nname: 'a'\ndescription: 'it''s fine'\n---\nB").description, "it's fine", "single quotes double up");
  assert.equal(format.parse('---\nname: "a"\ndescription: "say \\"hi\\"\\nthere"\n---\nB').description, 'say "hi" there', "double quotes take JSON escapes");
  assert.equal(format.parse("---\nname: a\ndescription: long\n  continued here\n---\nB").description, "long continued here", "a plain value may run on");
  const other = format.parse("---\nname: a\ndescription: d\nallowed-tools:\n  - Read\n  - Grep\nmodel: sonnet\n---\nB");
  assert.equal(other.extra, "allowed-tools:\n  - Read\n  - Grep\nmodel: sonnet", "other front matter is kept verbatim");
  assert.equal(format.parse("no front matter\nat all").frontMatter, false);
  assert.equal(format.parse("no front matter\nat all").body, "no front matter\nat all");
  assert.equal(format.parse("---\nname: a\nnever closed\n").frontMatter, false, "an unclosed fence is not front matter");
  assert.equal(format.parse("---\nname: a\n---\nB").description, "", "a missing description reads as empty");
  assert.equal(format.parse(null).body, "");
  // What another tool's keys carry is built back in, so an edit here loses none of it.
  const edited = format.build({ name: "a", description: "new words", body: "New body", extra: other.extra });
  assert.equal(format.parse(edited).extra, other.extra);
  assert.match(edited, /^---\nname: a\ndescription: new words\nallowed-tools:\n {2}- Read\n {2}- Grep\nmodel: sonnet\n---\n\nNew body\n$/);
});

test("check is one table for a save, a create and an import", () => {
  const ok = { name: "bug-triage", description: "Sort a bug report", body: "1. Read it." };
  const table = [
    [ok, []],
    [{ ...ok, name: "" }, ["name"]],
    [{ ...ok, name: "Bug Triage" }, ["name"]],
    [{ ...ok, name: "../escape" }, ["name"]],
    [{ ...ok, name: "a/b" }, ["name"]],
    [{ ...ok, name: "x".repeat(65) }, ["name"]],
    [{ ...ok, description: "" }, ["description"]],
    [{ ...ok, description: "   " }, ["description"]],
    [{ ...ok, description: undefined }, ["description"]],
    [{ ...ok, description: "two\nlines" }, ["description"]],
    [{ ...ok, description: "bell\u0007" }, ["description"]],
    [{ ...ok, description: "d".repeat(301) }, ["description"]],
    [{ ...ok, description: "d".repeat(300) }, []],
    [{ ...ok, body: "" }, ["body"]],
    [{ ...ok, body: " \n\t " }, ["body"]],
    [{ ...ok, body: undefined }, ["body"]],
    [{ ...ok, body: "nul\u0000here" }, ["body"]],
    [{ name: "", description: "", body: "" }, ["name", "description", "body"]],
    [{}, ["name", "description", "body"]],
  ];
  for (const [draft, fields] of table) {
    const result = format.check(draft);
    assert.deepEqual(result.problems.map((problem) => problem.field), fields, JSON.stringify(draft).slice(0, 90));
    assert.equal(result.ok, fields.length === 0);
    assert.equal(result.text === "", fields.length > 0, "a file is offered only when there is nothing to fix");
  }
  assert.equal(format.check(ok).text, "---\nname: bug-triage\ndescription: Sort a bug report\n---\n\n1. Read it.\n");
});

test("the size is the bytes of the file that would be written, against what the inventory accepts", () => {
  assert.equal(format.MAX_BYTES, 32000);
  const base = { name: "big", description: "d" };
  // The file is the front matter, a blank line, the body and one newline: the body has this much room.
  const room = 32000 - (format.bytesOf(format.build({ ...base, body: "" })) - 1) - 1;
  const fits = format.check({ ...base, body: "x".repeat(room) });
  assert.equal(fits.ok, true);
  assert.equal(fits.bytes, 32000, "exactly the limit is fine");
  const over = format.check({ ...base, body: "x".repeat(room + 1) });
  assert.equal(over.ok, false);
  assert.match(over.problems[0].message, /^This skill is 31\.3 KB; the most is 32 KB\.$/);
  assert.deepEqual(over.problems.map((problem) => problem.field), ["body"]);
  // Two-byte letters count twice: the limit is bytes, not characters.
  const pairs = Math.floor(room / 2);
  assert.equal(format.check({ ...base, body: "é".repeat(pairs) }).ok, true);
  assert.equal(format.check({ ...base, body: "é".repeat(pairs + 1) }).ok, false, "a body of the same number of characters is over once they take two bytes each");
  assert.equal(format.AUTO_LOAD_CHARS, 16000);
  assert.equal(format.READ_BYTES, 65536);
});

test("a huge body or description is refused with the one field named, and no file text comes out of it", () => {
  const huge = format.check({ name: "big", description: "d", body: "x".repeat(5_000_000) });
  assert.equal(huge.ok, false);
  assert.deepEqual(huge.problems.map((problem) => problem.field), ["body"]);
  assert.match(huge.problems[0].message, /^This skill is 4882\.8 KB; the most is 32 KB\.$/);
  assert.equal(huge.text, "", "no file is built from it");
  const long = format.check({ name: "big", description: "d".repeat(5_000_000), body: "b" });
  assert.deepEqual(long.problems.map((problem) => problem.field), ["description"]);
  assert.equal(long.problems[0].message, "Keep the description to 300 characters.");
  // Just over by length alone: a body of 32,001 characters is over however it is counted.
  assert.equal(format.check({ name: "big", description: "d", body: "y".repeat(32001) }).ok, false);
  assert.equal(format.check({ name: "big", description: "d", body: "y".repeat(31000) }).ok, true, "and a body well under it is fine");
});

test("the picker shows the description, else the first line that says something, in one line", () => {
  assert.equal(format.describe("---\nname: a\ndescription: Sort a bug report\n---\nBody"), "Sort a bug report");
  assert.equal(format.describe("---\nname: a\n---\n\n# Triage a bug\n\nmore"), "Triage a bug", "a heading stands in");
  assert.equal(format.describe("\n\n   \n- First real line here\nsecond"), "First real line here");
  assert.equal(format.describe("1. Read the report"), "Read the report");
  assert.equal(format.describe(""), "");
  assert.equal(format.describe("---\nname: a\n---\n"), "");
  const long = format.describe(`---\nname: a\ndescription: ${"word ".repeat(60)}\n---\n`);
  assert.ok(long.length <= format.DESCRIBE_CHARS && long.endsWith("…"), "a long one is cut with an ellipsis");
  assert.equal(format.describe("---\nname: a\ndescription: >\n  over\n  lines\n---\n"), "over lines");
});

test("every starter is a skill the page would accept as it stands, and they are few and small", () => {
  assert.ok(format.STARTERS.length >= 3 && format.STARTERS.length <= 6);
  assert.equal(new Set(format.STARTERS.map((starter) => starter.name)).size, format.STARTERS.length, "names are distinct");
  for (const starter of format.STARTERS) {
    const result = format.check(starter);
    assert.equal(result.ok, true, `${starter.name}: ${JSON.stringify(result.problems)}`);
    assert.ok(result.bytes < 2000, `${starter.name} is ${result.bytes} bytes`);
    assert.equal(format.parse(result.text).name, starter.name);
    assert.equal(format.describe(result.text), starter.description);
  }
  assert.ok(Object.isFrozen(format.STARTERS), "a caller cannot change the starters");
});
