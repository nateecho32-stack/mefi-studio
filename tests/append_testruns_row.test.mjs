// Contracts for scripts/append-testruns-row.mjs, the write-side companion to
// the check-testruns gate: locked, atomic, newest-first row insertion into
// TESTRUNS.md. Synthetic fixture files under the OS temp dir only (never the
// repo tree); the live file is exercised by the row this helper itself wrote.
//
// Run: node --test tests/append_testruns_row.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appendTestrunsRow, lockPathFor, main, planInsertion, rowFromFields } from "../scripts/append-testruns-row.mjs";
import { auditTestruns } from "../scripts/check-testruns.mjs";

const scriptPath = fileURLToPath(new URL("../scripts/append-testruns-row.mjs", import.meta.url));

// The archive rows below the guide are deliberately oldest-first ("blessed"
// order the gate must keep ignoring) to prove insertion and audit touch only
// the live region.
const FIXTURE_LINES = [
  "# Test Runs",
  "",
  "## How to read this file",
  "",
  "Notebook preamble.",
  "",
  "### Known environmental failures",
  "",
  "| Suite | Symptom |",
  "| --- | --- |",
  "| flaky | timing |",
  "",
  "## 2026-09-20 evening - second run (run_b)",
  "",
  "Body b.",
  "",
  "## 2026-09-19 morning - first run (run_a)",
  "",
  "Body a.",
  "",
  "## Read Before Any Tests",
  "",
  "Guide body.",
  "",
  "## 2026-09-10 archive - first archived row (run_arch1)",
  "",
  "Archived first.",
  "",
  "## 2026-09-12 archive - second archived row (run_arch2)",
  "",
  "Archived second, deliberately newer above-older order is blessed here.",
  "",
];

function makeFixture(eol = "\n") {
  const root = mkdtempSync(join(tmpdir(), "append-testruns-"));
  writeFileSync(join(root, "TESTRUNS.md"), FIXTURE_LINES.join(eol));
  return root;
}

function read(root) {
  return readFileSync(join(root, "TESTRUNS.md"), "utf8").replace(/\r\n/g, "\n");
}

function cleanup(...roots) {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

test("inserts a fresh run at the true top of the live region", () => {
  const root = makeFixture();
  try {
    const res = appendTestrunsRow(root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n");
    const lines = read(root).split("\n");
    assert.equal(lines[res.insertLine - 1], "## 2026-09-22 noon - helper run (run_c)");
    const tableIdx = lines.indexOf("| flaky | timing |");
    const prevTop = lines.indexOf("## 2026-09-20 evening - second run (run_b)");
    const guide = lines.indexOf("## Read Before Any Tests");
    assert.ok(tableIdx !== -1 && tableIdx < res.insertLine - 1, "lands below the known-failures table");
    assert.ok(res.insertLine - 1 < guide, "the live newest-first region is above the anchor, not below it (contrast the brief's inverted wording)");
    assert.equal(lines[prevTop - 1], "", "blank line separates the new block from the old top");
    assert.equal(lines[prevTop - 2], "Body c.");
    assert.ok(lines.indexOf("## 2026-09-10 archive - first archived row (run_arch1)") < lines.indexOf("## 2026-09-12 archive - second archived row (run_arch2)"), "archive order untouched");
    assert.deepEqual(auditTestruns(root).problems, []);
  } finally {
    cleanup(root);
  }
});

test("preserves CRLF: only the inserted block differs, no bare LF appears", () => {
  const root = makeFixture("\r\n");
  try {
    const before = readFileSync(join(root, "TESTRUNS.md"), "utf8");
    appendTestrunsRow(root, "## 2026-09-21 morning - crlf run (run_d)\n\nBody d, written with bare LF input.\n");
    const raw = readFileSync(join(root, "TESTRUNS.md"), "utf8");
    assert.equal((raw.match(/(?<!\r)\n/g) ?? []).length, 0, "every newline stays CRLF");
    const expected = before
      .replace(/## 2026-09-20 evening - second run \(run_b\)/, "## 2026-09-21 morning - crlf run (run_d)\r\n\r\nBody d, written with bare LF input.\r\n\r\n## 2026-09-20 evening - second run (run_b)");
    assert.equal(raw, expected, "spliced result is the prior bytes plus the rendered block");
  } finally {
    cleanup(root);
  }
});

test("a late-arriving older run lands at its newest-first slot, not the top", () => {
  const root = makeFixture();
  try {
    const res = appendTestrunsRow(root, "## 2026-09-19 evening - late backfill (run_late)\n\nBackfilled body.\n");
    const lines = read(root).split("\n");
    const runA = lines.indexOf("## 2026-09-19 morning - first run (run_a)");
    const runB = lines.indexOf("## 2026-09-20 evening - second run (run_b)");
    const guide = lines.indexOf("## Read Before Any Tests");
    assert.equal(lines[res.insertLine - 1], "## 2026-09-19 evening - late backfill (run_late)");
    assert.ok(runB < res.insertLine - 1 && res.insertLine - 1 < runA && runA < guide, "ordered 09-20, 09-19 late, 09-19, guide");
    assert.deepEqual(auditTestruns(root).problems, []);
  } finally {
    cleanup(root);
  }
});

test("a date older than every live row lands just above the guide", () => {
  const root = makeFixture();
  try {
    const res = appendTestrunsRow(root, "## 2026-09-18 night - oldest (run_old)\n\nOld body.\n");
    const lines = read(root).split("\n");
    const runA = lines.indexOf("## 2026-09-19 morning - first run (run_a)");
    const guide = lines.indexOf("## Read Before Any Tests");
    assert.ok(runA < res.insertLine - 1 && res.insertLine - 1 < guide);
    assert.equal(lines[guide - 2], "Old body.");
    assert.equal(lines[guide - 1], "", "one blank line before the guide");
    assert.deepEqual(auditTestruns(root).problems, []);
  } finally {
    cleanup(root);
  }
});

test("rejects malformed blocks and duplicate headings without touching the file", () => {
  const root = makeFixture();
  try {
    appendTestrunsRow(root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n");
    const pristine = readFileSync(join(root, "TESTRUNS.md"), "utf8");
    assert.throws(() => appendTestrunsRow(root, "### 2026-09-22 not an H2\n\nBody.\n"), /must start with an H2 heading/);
    assert.throws(() => appendTestrunsRow(root, "## no date here\n\nBody.\n"), /YYYY-MM-DD/);
    assert.throws(() => appendTestrunsRow(root, "   \n\n"), /row block is empty/);
    assert.throws(() => appendTestrunsRow(root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c again.\n"), /duplicate H2/);
    assert.equal(readFileSync(join(root, "TESTRUNS.md"), "utf8"), pristine, "refusals left the file byte-identical");
    assert.deepEqual(auditTestruns(root).problems, []);
  } finally {
    cleanup(root);
  }
});

test("repeated appends accumulate newest-first and a heading-only row is accepted", () => {
  const root = makeFixture();
  try {
    appendTestrunsRow(root, "## 2026-09-21 noon - first extra (run_e1)\n\nBody e1.\n");
    appendTestrunsRow(root, "## 2026-09-22 noon - second extra (run_e2)\n\nBody e2.\n");
    const text = read(root);
    const i22 = text.indexOf("## 2026-09-22 noon - second extra (run_e2)");
    const i21 = text.indexOf("## 2026-09-21 noon - first extra (run_e1)");
    const i20 = text.indexOf("## 2026-09-20 evening - second run (run_b)");
    assert.ok(i22 !== -1 && i21 !== -1 && i20 !== -1, "every append survives");
    assert.ok(i22 < i21 && i21 < i20, "later appends stack newest-first above earlier ones");
    assert.ok(text.includes("Body b.") && text.includes("Body e1.") && text.includes("Body e2."), "no earlier row body was dropped");
    assert.equal(text.indexOf("# Test Runs"), 0, "preamble untouched");
    assert.deepEqual(auditTestruns(root).problems, []);

    // A canonical row built with no body renders as a heading-only block.
    const headingOnly = rowFromFields({ date: "2026-09-23", title: "heading only" });
    assert.equal(headingOnly, "## 2026-09-23 - heading only\n");
    const res = appendTestrunsRow(root, headingOnly);
    const lines = read(root).split("\n");
    assert.equal(lines[res.insertLine - 1], "## 2026-09-23 - heading only");
    assert.equal(lines[res.insertLine], "", "one blank line separates the heading-only row from the next");
    assert.ok(res.insertLine - 1 < lines.indexOf("## 2026-09-22 noon - second extra (run_e2)"), "lands at the true top");
    assert.deepEqual(auditTestruns(root).problems, []);

    // A nonexistent package root is surfaced as the same refusal, not swallowed.
    assert.throws(() => appendTestrunsRow(join(root, "nope"), "## 2026-09-24 noon - x (run_x)\n\nb.\n"), /TESTRUNS\.md not found/);
    assert.equal(read(root).includes("(run_x)"), false, "the refused row never landed in the real file");
  } finally {
    cleanup(root);
  }
});

test("equal-date arrivals stack at the top of their day group, not below it", () => {
  const root = makeFixture();
  try {
    // run_b is 2026-09-20 evening. planInsertion's rule is "equal-date arrivals
    // stack on top of their day group", so a same-date row must outrank the
    // existing 09-20 row rather than land below it (which a plain "newest <
    // current" splice would do). Two same-date arrivals must keep that order.
    const first = appendTestrunsRow(root, "## 2026-09-20 morning - same-day earlier (run_sd1)\n\nBody sd1.\n");
    const second = appendTestrunsRow(root, "## 2026-09-20 late - same-day later (run_sd2)\n\nBody sd2.\n");
    const lines = read(root).split("\n");
    const i2 = lines.indexOf("## 2026-09-20 late - same-day later (run_sd2)");
    const i1 = lines.indexOf("## 2026-09-20 morning - same-day earlier (run_sd1)");
    const iB = lines.indexOf("## 2026-09-20 evening - second run (run_b)");
    const iA = lines.indexOf("## 2026-09-19 morning - first run (run_a)");
    assert.ok([i2, i1, iB, iA].every((i) => i !== -1), "every same-day row and both originals survive");
    assert.ok(i2 < i1 && i1 < iB && iB < iA, "same-day arrivals stack newest-on-top of the 09-20 group, above the older 09-19 row");
    assert.equal(second.insertLine - 1, i2, "the later same-day arrival reports landing at the top");
    assert.equal(first.insertLine - 1, 12, "the first same-day arrival landed at the true top when it was written");
    assert.equal(lines[i2 + 1], "", "one blank line separates the new heading from its body");
    assert.equal(lines[iB - 1], "", "one blank line separates the day group from the pre-existing row");
    assert.ok(lines.includes("Body a.") && lines.includes("Body b.") && lines.includes("Body sd1.") && lines.includes("Body sd2."), "no earlier row body was dropped");
    assert.deepEqual(auditTestruns(root).problems, []);
  } finally {
    cleanup(root);
  }
});

test("refuses cleanly when TESTRUNS.md is absent and creates nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "append-testruns-missing-"));
  try {
    assert.deepEqual(readdirSync(root), [], "fixture root starts empty");
    assert.throws(() => appendTestrunsRow(root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n"), /TESTRUNS\.md not found/);
    assert.equal(main(["--root", root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n"]), 1);
    assert.equal(existsSync(join(root, "TESTRUNS.md")), false, "neither the function nor the CLI created TESTRUNS.md");
    assert.deepEqual(readdirSync(root), [], "no staged temp / backup file was left beside where TESTRUNS.md would be");
  } finally {
    cleanup(root);
  }
});

test("refuses with no live row to anchor insertion, leaving the file untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "append-testruns-nolive-"));
  try {
    const target = join(root, "TESTRUNS.md");
    // (a) An empty notebook is refused by the pre-append gate audit.
    writeFileSync(target, "");
    assert.throws(() => appendTestrunsRow(root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n"), /refusing to append/);
    assert.equal(readFileSync(target, "utf8"), "", "empty file untouched");
    // (b) A file that passes the gate but has its only dated rows BELOW the
    // anchor has no live row to anchor the insertion: planInsertion must refuse
    // rather than guess the live-region top, and the bytes must survive.
    const archiveOnly = [
      "# Test Runs",
      "",
      "## How to read this file",
      "",
      "preamble",
      "",
      "### Known environmental failures",
      "",
      "| Suite | Symptom |",
      "| --- | --- |",
      "",
      "## Read Before Any Tests",
      "",
      "guide text",
      "",
      "## 2026-09-20 evening - archived run (run_a)",
      "",
      "Archived body.",
      "",
    ].join("\n");
    writeFileSync(target, archiveOnly);
    assert.deepEqual(auditTestruns(root).problems, [], "fixture passes the gate audit");
    const pristine = readFileSync(target, "utf8");
    assert.throws(
      () => appendTestrunsRow(root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n"),
      /no dated run row found above the guide/,
      "no live row above the anchor is refused, not guessed",
    );
    assert.equal(readFileSync(target, "utf8"), pristine, "refusal left the file byte-identical");
    assert.equal(main(["--root", root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n"]), 1);
    assert.equal(readFileSync(target, "utf8"), pristine, "CLI refusal also wrote nothing");
  } finally {
    cleanup(root);
  }
});

test("refuses to append while the gate already flags the file", () => {
  const root = makeFixture();
  try {
    const sibling = join(root, "TESTRUNS-DESKTOP (1).md");
    writeFileSync(sibling, "conflict copy\n");
    const pristine = readFileSync(join(root, "TESTRUNS.md"), "utf8");
    assert.throws(() => appendTestrunsRow(root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n"), /refusing to append[\s\S]*conflict-copy/);
    assert.equal(readFileSync(join(root, "TESTRUNS.md"), "utf8"), pristine);
    rmSync(sibling);
    appendTestrunsRow(root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n");
    assert.deepEqual(auditTestruns(root).problems, []);
  } finally {
    cleanup(root);
  }
});

test("dry-run reports the landing spot and leaves the file untouched", () => {
  const root = makeFixture();
  try {
    const pristine = readFileSync(join(root, "TESTRUNS.md"), "utf8");
    const res = appendTestrunsRow(root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n", { dryRun: true });
    assert.equal(res.dryRun, true);
    assert.equal(res.before, "2026-09-20 evening - second run (run_b)");
    assert.equal(readFileSync(join(root, "TESTRUNS.md"), "utf8"), pristine);
    assert.throws(() => planInsertion("no headings at all\n", "## 2026-09-22 x\n"), /no dated run row/, "no-guide no-rows file is refused");
  } finally {
    cleanup(root);
  }
});

test("CLI: positional block, --file block, and --dry-run all behave", () => {
  const root = makeFixture();
  const blocks = mkdtempSync(join(tmpdir(), "append-testruns-blocks-"));
  try {
    writeFileSync(join(blocks, "row.md"), "## 2026-09-22 noon - file-fed run (run_f)\n\nBody f.\n");
    assert.equal(main(["--root", root, "--file", join(blocks, "row.md")]), 0);
    assert.ok(read(root).includes("## 2026-09-22 noon - file-fed run (run_f)"));
    const pristine = readFileSync(join(root, "TESTRUNS.md"), "utf8");
    assert.equal(main(["--root", root, "--dry-run", "## 2026-09-23 early - positional (run_p)\n\nBody p.\n"]), 0);
    assert.equal(readFileSync(join(root, "TESTRUNS.md"), "utf8"), pristine);
    assert.equal(main(["--root", root, "## bad heading"]), 1);
    assert.equal(main(["--root", root, "--nope"]), 2);
    assert.equal(readFileSync(join(root, "TESTRUNS.md"), "utf8"), pristine);
  } finally {
    cleanup(root, blocks);
  }
});

test("two concurrent CLI appends both survive under the lock, newest-first", async () => {
  const root = makeFixture();
  const blocks = mkdtempSync(join(tmpdir(), "append-testruns-blocks-"));
  try {
    writeFileSync(join(blocks, "r1.md"), "## 2026-09-23 morning - concurrent one (run_c1)\n\nBody c1.\n");
    writeFileSync(join(blocks, "r2.md"), "## 2026-09-22 late - concurrent two (run_c2)\n\nBody c2.\n");
    const run = (f) =>
      new Promise((res, rej) => {
        const child = spawn(process.execPath, [scriptPath, "--root", root, "--file", join(blocks, f)]);
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (out += d));
        child.on("close", (code) => (code === 0 ? res(out) : rej(new Error(`exit ${code}: ${out}`))));
      });
    await Promise.all([run("r1.md"), run("r2.md")]);
    const text = read(root);
    const i23 = text.indexOf("## 2026-09-23 morning");
    const i22 = text.indexOf("## 2026-09-22 late - concurrent two");
    const i20 = text.indexOf("## 2026-09-20 evening");
    assert.ok(i23 !== -1 && i22 !== -1 && i20 !== -1, "both concurrent rows present");
    assert.ok(i23 < i22 && i22 < i20, "still newest-first regardless of arrival order");
    assert.deepEqual(auditTestruns(root).problems, []);
  } finally {
    cleanup(root, blocks);
  }
});

test("field flags and JSON specs both format the canonical house row shape", () => {
  const root = makeFixture();
  const blocks = mkdtempSync(join(tmpdir(), "append-testruns-blocks-"));
  try {
    // Flags build the same block rowFromFields produces for the JSON object.
    const fields = { date: "2026-09-22", daypart: "late evening", title: "field-fed run", task: "task_x", run: "run_y", body: "Field body." };
    const expected = rowFromFields(fields);
    assert.ok(expected.startsWith("## 2026-09-22 late evening - field-fed run (task_x, run_y)\n\nField body.\n"), `canonical heading shape, got: ${expected.split("\n")[0]}`);
    assert.equal(main(["--root", root, "--date", "2026-09-22", "--daypart", "late evening", "--title", "field-fed run", "--task", "task_x", "--run", "run_y", "--body", "Field body."]), 0);
    assert.ok(read(root).includes(expected.trimEnd()), "flag-fed row landed");
    // The same fields as a JSON object via --file land identically on a second row.
    writeFileSync(join(blocks, "row.json"), `${JSON.stringify({ ...fields, title: "json-fed run", date: "2026-09-23" })}\n`);
    assert.equal(main(["--root", root, "--file", join(blocks, "row.json")]), 0);
    const lines = read(root).split("\n");
    const jsonIdx = lines.indexOf("## 2026-09-23 late evening - json-fed run (task_x, run_y)");
    const flagIdx = lines.indexOf("## 2026-09-22 late evening - field-fed run (task_x, run_y)");
    assert.ok(jsonIdx !== -1 && flagIdx !== -1 && jsonIdx < flagIdx, "json-fed newer row sits above the flag-fed one");
    assert.deepEqual(auditTestruns(root).problems, []);
    // Malformed field specs are refused with no write.
    const pristine = readFileSync(join(root, "TESTRUNS.md"), "utf8");
    assert.throws(() => rowFromFields({ title: "no date" }), /date.*YYYY-MM-DD/);
    assert.throws(() => rowFromFields({ date: "2026-09-22" }), /title.*required/);
    assert.throws(() => rowFromFields({ date: "2026-09-22", title: "x", nope: 1 }), /unknown row field/);
    writeFileSync(join(blocks, "bad.json"), "{ not json");
    assert.equal(main(["--root", root, "--file", join(blocks, "bad.json")]), 1);
    assert.equal(main(["--root", root, "--date", "2026-09-22", "leftover positional"]), 2);
    assert.equal(readFileSync(join(root, "TESTRUNS.md"), "utf8"), pristine, "refusals left the file byte-identical");
  } finally {
    cleanup(root, blocks);
  }
});

test("a JSON row spec piped on real stdin inserts through the CLI", async () => {
  const root = makeFixture();
  try {
    const spec = JSON.stringify({ date: "2026-09-22", title: "stdin json run", body: "Piped body." });
    const { code, out } = await new Promise((res) => {
      const child = spawn(process.execPath, [scriptPath, "--root", root, "--file", "-"]);
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stdout += d));
      child.on("close", (c) => res({ code: c, out: stdout }));
      child.stdin.end(spec);
    });
    assert.equal(code, 0, out);
    assert.ok(read(root).includes("## 2026-09-22 - stdin json run"), "stdin JSON spec landed as a canonical row");
    assert.deepEqual(auditTestruns(root).problems, []);
  } finally {
    cleanup(root);
  }
});

test("a mid-run change to the file aborts with no write (read-verify-write)", () => {
  const root = makeFixture();
  try {
    const pristine = readFileSync(join(root, "TESTRUNS.md"), "utf8");
    // String(blockText) fires inside planInsertion - after the snapshot read,
    // before the pre-write verify - so this lands exactly in the mid-run
    // window a non-cooperating editor would save into.
    const block = {
      toString() {
        writeFileSync(join(root, "TESTRUNS.md"), `${pristine}## 2026-09-25 noon - concurrent editor saved mid-run (run_x)\n\nIntruder body.\n`);
        return "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n";
      },
    };
    assert.throws(() => appendTestrunsRow(root, block), /changed mid-run/);
    const after = readFileSync(join(root, "TESTRUNS.md"), "utf8");
    assert.ok(after.includes("concurrent editor saved mid-run"), "the concurrent editor's bytes survive unclobbered");
    assert.ok(!after.includes("(run_c)"), "the helper's row was never written");
  } finally {
    cleanup(root);
  }
});

test("a save landing after the row is staged is caught by the pre-swap verify, not clobbered", () => {
  const root = makeFixture();
  const target = join(root, "TESTRUNS.md");
  try {
    const pristine = readFileSync(target, "utf8");
    // beforeRename fires inside atomicReplace after the replacement temp is
    // fully written and fsynced, i.e. in the tightest window between the
    // snapshot and the swap - the last place a non-cooperating save can slip
    // in. It must abort with no write.
    assert.throws(
      () =>
        appendTestrunsRow(root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n", {
          hooks: {
            beforeRename: () =>
              writeFileSync(target, `${pristine}## 2026-09-24 noon - late intruder save (run_z)\n\nIntruder body.\n`),
          },
        }),
      /changed mid-run/,
    );
    const after = readFileSync(target, "utf8");
    assert.ok(after.includes("late intruder save"), "the concurrent save survives in the tight window");
    assert.ok(!after.includes("(run_c)"), "the helper's row never landed");
  } finally {
    cleanup(root);
  }
});

test("a save during a failed-rename retry is caught before the next attempt, not clobbered", () => {
  const root = makeFixture();
  const target = join(root, "TESTRUNS.md");
  try {
    const pristine = readFileSync(target, "utf8");
    let calls = 0;
    // The injected rename fails like a Windows AV/OneDrive hold on the first
    // attempt and lets a non-cooperating editor save during the retry sleep.
    // The next attempt must re-verify the snapshot and abort, not clobber it.
    const rename = (src, dst) => {
      calls++;
      writeFileSync(target, `${pristine}## 2026-09-24 noon - retry-window intruder (run_r)\n\nIntruder body.\n`);
      const err = new Error("EPERM: simulated rename hold");
      err.code = "EPERM";
      throw err;
    };
    assert.throws(
      () => appendTestrunsRow(root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n", { hooks: { rename } }),
      /changed mid-run/,
    );
    assert.equal(calls, 1, "the retry was aborted by the re-verify after the first failed swap");
    const after = readFileSync(target, "utf8");
    assert.ok(after.includes("retry-window intruder"), "the save during the retry window survives");
    assert.ok(!after.includes("(run_c)"), "the helper's row never landed via a later rename attempt");
  } finally {
    cleanup(root);
  }
});

test("a save landing on top of the append is not destroyed by the rollback path", () => {
  const root = makeFixture();
  const target = join(root, "TESTRUNS.md");
  try {
    const pristine = readFileSync(target, "utf8");
    // afterWrite lets a concurrent save land between the helper's own write
    // and its post-append gate audit. The appended row makes the gate red, but
    // restoring `raw` would destroy the concurrent bytes - so the helper must
    // leave the live content in place and report, never silently clobber.
    const written = { buf: null };
    assert.throws(
      () =>
        appendTestrunsRow(root, "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n", {
          hooks: {
            afterWrite: (buf) => {
              written.buf = buf;
              writeFileSync(target, `${buf.toString("utf8")}## 2026-09-20 evening - second run (run_b)\n`);
            },
          },
        }),
      /post-append gate check failed/,
    );
    const after = readFileSync(target, "utf8");
    assert.ok(after.includes("(run_c)"), "the helper did not roll back over the concurrent edit");
    assert.equal((after.match(/second run \(run_b\)/g) ?? []).length, 2, "the concurrent duplicate heading survived");
    assert.notEqual(after, pristine, "file is not the pre-write snapshot");
    assert.ok(written.buf !== null, "the write actually happened before the concurrent save");
  } finally {
    cleanup(root);
  }
});

test("--help names the live-region direction so the inverted brief wording cannot silently return", () => {
  const logs = [];
  const orig = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    assert.equal(main(["--help"]), 0);
  } finally {
    console.log = orig;
  }
  const help = logs.join("\n");
  assert.match(help, /Read Before Any Tests/, "help names the anchor heading");
  assert.match(help, /above/i, "help states rows land above the anchor (the true top)");
  assert.match(help, /below that anchor is frozen/i, "help flags the below-anchor wording as inverted/frozen");
});

test("a save landing while the helper waits for the lock is incorporated, not clobbered", async () => {
  const root = makeFixture();
  const blocks = mkdtempSync(join(tmpdir(), "append-testruns-blocks-"));
  const target = join(root, "TESTRUNS.md");
  const lockPath = lockPathFor(target);
  const takeLock = () => {
    const fh = openSync(lockPath, "wx");
    try {
      writeSync(fh, "held by test\n");
    } finally {
      closeSync(fh);
    }
  };
  try {
    writeFileSync(join(blocks, "r3.md"), "## 2026-09-22 noon - helper run (run_c)\n\nBody c.\n");
    takeLock(); // the child cannot take its snapshot until this is released
    const child = spawn(process.execPath, [scriptPath, "--root", root, "--file", join(blocks, "r3.md")]);
    const pristine = readFileSync(target, "utf8");
    writeFileSync(
      target,
      pristine.replace(
        "## 2026-09-20 evening - second run (run_b)",
        "## 2026-09-21 morning - parked-writer save (run_w)\n\nBody w.\n\n## 2026-09-20 evening - second run (run_b)",
      ),
    );
    unlinkSync(lockPath);
    const { code, stderr } = await new Promise((res) => {
      let err = "";
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (c) => res({ code: c, stderr: err }));
    });
    assert.equal(code, 0, `helper should succeed after the handoff: ${stderr}`);
    const text = read(root);
    const iw = text.indexOf("parked-writer save");
    const ic = text.indexOf("helper run (run_c)");
    const i20 = text.indexOf("## 2026-09-20 evening");
    assert.ok(iw !== -1 && ic !== -1, "both the parked save and the helper row are present");
    assert.ok(ic < iw && iw < i20, "newest-first holds across the lock handoff");
    assert.deepEqual(auditTestruns(root).problems, []);
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // child already removed it
    }
    cleanup(root, blocks);
  }
});
