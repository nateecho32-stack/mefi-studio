// Contracts for scripts/rotate-testruns.mjs (TESTRUNS.md self-compaction:
// the newest 20 live rows stay, older row blocks move verbatim into
// docs/archive/testruns-YYYY-MM.md), its hook in scripts/append-testruns-row.mjs
// (including the refusal to re-append a heading that already rotated out),
// and the one-shot tools/restructure_testruns_once.mjs migration. Synthetic
// fixture roots under the OS temp dir only - never the real notebook.
//
// Run: node --test tests/rotate_testruns.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendTestrunsRow, atomicReplace, main as appendMain } from "../scripts/append-testruns-row.mjs";
import { auditTestruns } from "../scripts/check-testruns.mjs";
import { main as rotateMain, mergeIntoArchive, planRotation, rotateTestruns } from "../scripts/rotate-testruns.mjs";
import { main as restructureMain, restructureTestruns, verifyNotArchived, verifyNothingLost } from "../tools/restructure_testruns_once.mjs";

const PREAMBLE = [
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
];

const GUIDE_AND_FROZEN_ARCHIVE = [
  "## Read Before Any Tests",
  "",
  "Guide body.",
  "",
  "## 2026-08-01 archive - frozen archived row (run_arch1)",
  "",
  "Archived first.",
  "",
  "## 2026-08-03 archive - second frozen row, oldest-first on purpose (run_arch2)",
  "",
  "Archived second.",
  "",
];

function isoDay(start, back) {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

// Newest first, one day apart, starting at `start`.
function makeRows(count, start = "2026-09-30") {
  return Array.from({ length: count }, (_, i) => ({
    heading: `## ${isoDay(start, i)} evening - fixture row ${i} (run_${i})`,
    body: [`Body of row ${i}.`],
  }));
}

function notebookLines(rows, { preamble = PREAMBLE, tail = GUIDE_AND_FROZEN_ARCHIVE } = {}) {
  return [...preamble, ...rows.flatMap((r) => [r.heading, "", ...r.body, ""]), ...tail];
}

function makeRoot(rows, { eol = "\n", preamble, tail } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rotate-testruns-"));
  writeFileSync(join(root, "TESTRUNS.md"), notebookLines(rows, { preamble, tail }).join(eol));
  return root;
}

const target = (root) => join(root, "TESTRUNS.md");
const readRaw = (path) => readFileSync(path, "utf8");
const archive = (root, month) => join(root, "docs", "archive", `testruns-${month}.md`);
const bareLf = (text) => (text.match(/(?<!\r)\n/g) ?? []).length;
const count = (text, needle) => text.split(needle).length - 1;

function cleanup(...roots) {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

async function capturing(method, fn) {
  const logs = [];
  const orig = console[method];
  console[method] = (...args) => logs.push(args.join(" "));
  try {
    return { value: await fn(), logs };
  } finally {
    console[method] = orig;
  }
}

test("keeps the newest 20 row blocks; every byte outside the rotated rows is identical", async () => {
  const rows = makeRows(25, "2026-09-28");
  const root = makeRoot(rows);
  try {
    const text = readRaw(target(root));
    const plan = planRotation(text);
    assert.equal(plan.liveRows, 25);
    assert.equal(plan.keptRows, 20);
    assert.equal(plan.rotatedRows, 5);
    const cut = text.indexOf(rows[20].heading);
    const guide = text.indexOf("## Read Before Any Tests");
    assert.equal(plan.keptText, text.slice(0, cut) + text.slice(guide), "preamble, the 20 kept rows, the guide and the frozen archive are untouched");
    assert.equal(plan.rotated.join(""), text.slice(cut, guide), "the rotated blocks are exactly the bytes removed");
    assert.ok(plan.rotated[0].startsWith(rows[20].heading) && plan.rotated[4].startsWith(rows[24].heading), "rotated oldest-last, in file order");

    const res = await rotateTestruns(root);
    assert.equal(res.rotated, 5);
    assert.equal(res.kept, 20);
    assert.deepEqual(res.archives, [archive(root, "2026-09")]);
    assert.equal(readRaw(target(root)), plan.keptText);
    const audit = auditTestruns(root);
    assert.deepEqual(audit.problems, []);
    assert.equal(audit.rows, 20);
    const arch = readRaw(archive(root, "2026-09"));
    assert.ok(arch.startsWith("# TESTRUNS.md archive, 2026-09\n"), "archive opens with its header");
    const at = rows.slice(20).map((r) => arch.indexOf(r.heading));
    assert.ok(at.every((i, k) => i !== -1 && (k === 0 || at[k - 1] < i)), "all five rotated rows archived newest first");
    assert.ok(arch.endsWith("Body of row 24.\n") && !arch.endsWith("\n\n"), "archive ends with exactly one newline");
  } finally {
    cleanup(root);
  }
});

test("CRLF notebooks stay CRLF, and a new archive takes the notebook's line ending", async () => {
  const root = makeRoot(makeRows(23), { eol: "\r\n" });
  try {
    const before = readRaw(target(root));
    const plan = planRotation(before);
    await rotateTestruns(root);
    const after = readRaw(target(root));
    assert.equal(bareLf(after), 0, "no bare LF in TESTRUNS.md");
    assert.equal(after, plan.keptText);
    const arch = readRaw(archive(root, "2026-09"));
    assert.equal(bareLf(arch), 0, "no bare LF in the archive");
    assert.equal(count(arch, "\r\n## 2026-"), 3);
    assert.deepEqual(auditTestruns(root).problems, []);
  } finally {
    cleanup(root);
  }
});

test("a row's H3 subsections and unheaded paragraphs travel with it as one block", async () => {
  const rows = makeRows(22);
  rows[21].body = ["Body of row 21.", "", "### Sub-run detail", "", "Sub body.", "", "Unheaded follow-up paragraph, line one", "and line two."];
  const root = makeRoot(rows);
  try {
    await rotateTestruns(root);
    const kept = readRaw(target(root));
    assert.ok(!kept.includes("Sub-run detail") && !kept.includes("Unheaded follow-up"), "nothing of the rotated block stays behind");
    const arch = readRaw(archive(root, "2026-09"));
    const block = [rows[21].heading, "", ...rows[21].body].join("\n");
    assert.ok(arch.includes(`${block}\n`), "the whole block is archived contiguously and verbatim");
    assert.ok(arch.indexOf(rows[20].heading) < arch.indexOf(rows[21].heading));
  } finally {
    cleanup(root);
  }
});

test("rotated rows are grouped into one archive per month of their heading date", async () => {
  // 2026-09-22 back one day per row: rows 20-21 are 2026-09-02/01, rows 22-24 August.
  const rows = makeRows(25, "2026-09-22");
  const root = makeRoot(rows);
  try {
    const res = await rotateTestruns(root);
    assert.deepEqual(res.archives, [archive(root, "2026-09"), archive(root, "2026-08")]);
    const sep = readRaw(archive(root, "2026-09"));
    const aug = readRaw(archive(root, "2026-08"));
    assert.equal(count(sep, "\n## 2026-09-"), 2);
    assert.equal(count(sep, "## 2026-08-"), 0);
    assert.equal(count(aug, "\n## 2026-08-"), 3);
    assert.ok(aug.startsWith("# TESTRUNS.md archive, 2026-08"));
    assert.ok(aug.indexOf(rows[22].heading) < aug.indexOf(rows[23].heading) && aug.indexOf(rows[23].heading) < aug.indexOf(rows[24].heading), "newest first");
  } finally {
    cleanup(root);
  }
});

test("re-running is a no-op, and merging already-archived blocks changes nothing", async () => {
  const root = makeRoot(makeRows(24));
  try {
    const first = await rotateTestruns(root);
    assert.equal(first.rotated, 4);
    const kept = readRaw(target(root));
    const arch = readRaw(archive(root, "2026-09"));
    const again = await rotateTestruns(root);
    assert.equal(again.rotated, 0);
    assert.equal(readRaw(target(root)), kept);
    assert.equal(readRaw(archive(root, "2026-09")), arch);
    const blocks = planRotation(notebookLines(makeRows(24)).join("\n")).rotated;
    assert.equal(mergeIntoArchive(arch, blocks, { title: "ignored" }), arch, "idempotent merge");
  } finally {
    cleanup(root);
  }
});

test("an archive merge slots a late backfill newest-first and refuses a same-heading conflict", () => {
  const block = (date, body) => `## ${date} x - row (run_${date})\n\n${body}\n\n`;
  const arch = mergeIntoArchive(null, [block("2026-09-05", "five"), block("2026-09-03", "three")], { title: "TESTRUNS.md archive, 2026-09" });
  const merged = mergeIntoArchive(arch, [block("2026-09-04", "four")]);
  const at = ["05", "04", "03"].map((d) => merged.indexOf(`## 2026-09-${d}`));
  assert.ok(at[0] < at[1] && at[1] < at[2], "the 09-04 backfill lands between 09-05 and 09-03");
  assert.throws(() => mergeIntoArchive(merged, [block("2026-09-04", "four, edited")]), /already archived with different content/);
});

test("archive-first crash safety: a failed swap undoes the archive, a hard crash leaves copies the re-run never duplicates", async () => {
  const rows = makeRows(23);
  const root = makeRoot(rows);
  try {
    const pristine = readRaw(target(root));
    const failOnNotebook = (path, buf, opts) => {
      if (path.endsWith("TESTRUNS.md")) throw new Error("simulated failure of the TESTRUNS.md swap");
      return atomicReplace(path, buf, opts);
    };
    assert.throws(() => rotateTestruns(root, { locked: true, replace: failOnNotebook }), /was not rotated \(archive writes undone\)[\s\S]*simulated failure/);
    assert.equal(readRaw(target(root)), pristine, "TESTRUNS.md untouched");
    assert.equal(existsSync(archive(root, "2026-09")), false, "the archive this pass created was removed again");

    // A hard crash between the archive write and the TESTRUNS.md swap runs no
    // undo: the archive keeps the rows while TESTRUNS.md still has them too.
    mkdirSync(join(root, "docs", "archive"), { recursive: true });
    writeFileSync(archive(root, "2026-09"), mergeIntoArchive(null, planRotation(pristine).rotated, { title: "TESTRUNS.md archive, 2026-09" }));
    assert.equal(count(readRaw(archive(root, "2026-09")), "\n## 2026-"), 3, "the crashed pass had written the archive");

    const res = await rotateTestruns(root);
    assert.equal(res.rotated, 3);
    assert.equal(res.skipped, 3, "all three rows were already archived");
    const arch = readRaw(archive(root, "2026-09"));
    for (const r of rows.slice(20)) assert.equal(count(arch, r.heading), 1, `${r.heading} archived exactly once`);
    assert.equal(auditTestruns(root).rows, 20);
  } finally {
    cleanup(root);
  }
});

test("a concurrent save during the TESTRUNS.md swap aborts with no write, and the re-run absorbs it", async () => {
  const rows = makeRows(23);
  const root = makeRoot(rows);
  try {
    const pristine = readRaw(target(root));
    const intruder = pristine.replace(rows[0].heading, `## 2026-10-01 noon - intruder save (run_x)\n\nIntruder body.\n\n${rows[0].heading}`);
    const saveMidSwap = (path, buf, opts) =>
      atomicReplace(path, buf, path.endsWith("TESTRUNS.md") ? { ...opts, beforeRename: () => writeFileSync(path, intruder) } : opts);
    assert.throws(() => rotateTestruns(root, { locked: true, replace: saveMidSwap }), /changed while rotating[\s\S]*changed mid-run/);
    assert.equal(readRaw(target(root)), intruder, "the concurrent save survives unclobbered");

    const res = await rotateTestruns(root);
    assert.equal(res.rotated, 4, "the intruder row pushed one more row out");
    assert.equal(res.skipped, 0, "the aborted pass undid its archive writes, so nothing was archived twice");
    const arch = readRaw(archive(root, "2026-09"));
    for (const r of rows.slice(19)) assert.equal(count(arch, r.heading), 1);
    assert.ok(readRaw(target(root)).includes("intruder save"));
    assert.deepEqual(auditTestruns(root).problems, []);
  } finally {
    cleanup(root);
  }
});

test("a rotation that makes the gate flag something new is rolled back byte-for-byte", async () => {
  // The known-failures table parked inside an old row: rotating that row
  // away would leave the gate without its table.
  const rows = makeRows(21);
  rows[20].body = ["Body of row 20.", "", "### Known environmental failures", "", "| Suite | Symptom |", "| --- | --- |"];
  const root = makeRoot(rows, { preamble: PREAMBLE.slice(0, 6) });
  try {
    assert.deepEqual(auditTestruns(root).problems, []);
    const pristine = readRaw(target(root));
    await assert.rejects(rotateTestruns(root), /post-rotation gate check failed; TESTRUNS\.md restored to its prior bytes \(archive writes undone\)[\s\S]*Known environmental failures/);
    assert.equal(readRaw(target(root)), pristine);
    assert.equal(existsSync(archive(root, "2026-09")), false, "the rolled-back rotation leaves no archive copy behind");
    assert.deepEqual(auditTestruns(root).problems, []);
  } finally {
    cleanup(root);
  }
});

test("refuses to rotate away the last TESTRUNS.md mention of a tools/test_*.py registration", async () => {
  const rows = makeRows(21);
  rows[20].body = ["`tools/test_mefi_studio_widget.py` covers widgets."];
  const root = makeRoot(rows);
  try {
    const pristine = readRaw(target(root));
    await assert.rejects(rotateTestruns(root), /last TESTRUNS\.md mention of `tools\/test_mefi_studio_widget\.py`[\s\S]*nothing was written/);
    assert.equal(readRaw(target(root)), pristine);
    assert.ok(!existsSync(join(root, "docs")), "no archive was started");
  } finally {
    cleanup(root);
  }
});

test("the append helper rotates once the live region passes 20 rows", () => {
  const rows = makeRows(20, "2026-09-29");
  const root = makeRoot(rows);
  try {
    const res = appendTestrunsRow(root, "## 2026-09-30 noon - the 21st row (run_21)\n\nBody 21.\n");
    assert.equal(res.rows, 21, "the gate saw 21 rows right after the append");
    assert.deepEqual({ rotated: res.rotation.rotated, kept: res.rotation.kept }, { rotated: 1, kept: 20 });
    const audit = auditTestruns(root);
    assert.deepEqual(audit.problems, []);
    assert.equal(audit.rows, 20);
    const text = readRaw(target(root));
    assert.ok(text.includes("the 21st row") && !text.includes(rows[19].heading));
    assert.ok(readRaw(archive(root, "2026-09")).includes(rows[19].heading), "the oldest row moved to the archive");
  } finally {
    cleanup(root);
  }
});

test("the append still succeeds when its rotation throws", async () => {
  const root = makeRoot(makeRows(20, "2026-09-29"));
  try {
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "archive"), "a file where the archive folder should be\n");
    const { value: res, logs } = await capturing("error", () => appendTestrunsRow(root, "## 2026-09-30 noon - the 21st row (run_21)\n\nBody 21.\n"));
    assert.equal(res.rotation.rotated, 0);
    assert.match(res.rotation.error, /could not write/);
    assert.ok(logs.some((l) => /row appended; rotating older rows into docs\/archive\/ failed/.test(l)), "the failure is reported on stderr");
    const audit = auditTestruns(root);
    assert.deepEqual(audit.problems, []);
    assert.equal(audit.rows, 21, "the append stands, nothing rotated");
    assert.ok(readRaw(target(root)).includes("the 21st row"));
  } finally {
    cleanup(root);
  }
});

test("append --help names the archive destination and keeps the pinned direction wording", async () => {
  const { logs } = await capturing("log", () => appendMain(["--help"]));
  const help = logs.join("\n");
  assert.match(help, /beyond the newest 20[\s\S]*docs\/archive\/testruns-YYYY-MM\.md/);
  assert.match(help, /below that anchor is frozen/i);
});

test("CLI: --dry-run reports without writing, a real run prints one summary line, bad flags exit 2", async () => {
  const root = makeRoot(makeRows(22));
  try {
    const pristine = readRaw(target(root));
    const dry = await capturing("log", () => rotateMain(["--root", root, "--dry-run"]));
    assert.equal(dry.value, 0);
    assert.match(dry.logs.join("\n"), /dry-run - would rotate 2 row\(s\) into docs\/archive\/testruns-2026-09\.md \(20 live rows kept\)/);
    assert.equal(readRaw(target(root)), pristine);
    assert.ok(!existsSync(join(root, "docs")));
    const quiet = await capturing("error", async () => [await rotateMain(["--root", root, "--keep", "0"]), await rotateMain(["--nope"])]);
    assert.deepEqual(quiet.value, [2, 2]);
    const real = await capturing("log", () => rotateMain(["--root", root]));
    assert.equal(real.value, 0);
    assert.equal(real.logs.length, 1);
    assert.match(real.logs[0], /^rotate-testruns: rotated 2 row\(s\)/);
    const noop = await capturing("log", () => rotateMain(["--root", root]));
    assert.equal(noop.value, 0);
    assert.match(noop.logs[0], /nothing to rotate \(20 live rows/);
  } finally {
    cleanup(root);
  }
});

test("planRotation refuses a missing anchor, a non-row H2 in the live region and keep < 1", () => {
  const lines = notebookLines(makeRows(3));
  assert.throws(() => planRotation(lines.filter((l) => l !== "## Read Before Any Tests").join("\n")), /anchor heading is missing/);
  const withDoc = [...lines];
  withDoc.splice(withDoc.indexOf("## Read Before Any Tests"), 0, "## Python contracts", "", "doc", "");
  assert.throws(() => planRotation(withDoc.join("\n"), { keep: 1 }), /non-row H2 inside the live run region/);
  assert.throws(() => planRotation(lines.join("\n"), { keep: 0 }), /keep must be/);
  assert.equal(planRotation(lines.join("\n")).rotatedRows, 0, "few rows: nothing to rotate");
});

// A synthetic notebook with every shape the one-shot migration repairs: the
// test guide parked at the bottom of the oldest live row, below that row's own
// run log (the real notebook's shape since f5350b0 - coverage paragraphs, the
// performance intro, the Profiler H3, and the lead-in sentence right above the
// anchor), the session_dedupe shim named only in that guide text, and the
// "`n" damage below the guide.
const OLDEST_RUN_LOG = [
  "Oldest row body.",
  "",
  "Command view visual layer (2026-09-21, branch `command-visuals`): a dated run paragraph that rotates with its row.",
];
const GUIDE_COVERAGE = [
  "The eyes worker (`scripts/eyes-worker.mjs`, `scripts/eyes-client.cjs`) moves store reads",
  "off the main process; `tests/eyes_worker.test.mjs` covers it.",
  "",
  "Chat admission regressions in `tests/assistant_chat_admission.test.mjs` run the",
  "real responder against serialized memory stores.",
  "",
  "`tools/test_mefi_studio_session_dedupe.py` covers session work accounting:",
  "normalized-title deduplication and overflow requeueing.",
  "It runs without network.",
];
const GUIDE_PERFORMANCE = [
  "Performance profiler coverage runs through `npm test`, or directly with",
  "`node --test tests/performance_core.test.mjs tests/profiler_lifecycle.test.mjs`.",
  "",
  "### Profiler-guided Command optimization",
  "",
  "Run `node tools/profile_studio.mjs` for four workloads.",
  "",
  "Validated on 2026-09-21 (run_1789972006803_41, frames-path lag fix): profiler suites green.",
];
const GUIDE_LEAD_IN = "This is the test guide for the standalone Mefi's Studio AI+ repository. Run all commands from this repository root.";
const DAMAGED = [
  "Full-suite validation (fourth pass): with the tree reconciled, ran",
  "",
  "pm run check (77 targets, exit 0), the full",
  "",
  "pm test pipeline and ",
  "pm run audit (ok, zero findings). Node stage: 1,439",
  "tests, one flake.",
];
const REPAIRED = [
  "Full-suite validation (fourth pass): with the tree reconciled, ran",
  "`npm run check` (77 targets, exit 0), the full",
  "`npm test` pipeline and `npm run audit` (ok, zero findings). Node stage: 1,439",
  "tests, one flake.",
];

function restructureRoot() {
  const rows = makeRows(23, "2026-09-23");
  rows[22].body = [...OLDEST_RUN_LOG, "", ...GUIDE_COVERAGE, "", ...GUIDE_PERFORMANCE, "", GUIDE_LEAD_IN];
  const tail = [
    "## Read Before Any Tests",
    "",
    "Guide body.",
    "",
    "## Python contracts",
    "",
    "| Contract | Coverage |",
    "|---|---|",
    "| `tools/test_mefi_studio_catalog.py` | Catalog contract. |",
    "",
    "",
    "## Agent loop, Jev and startup regressions",
    "",
    ...DAMAGED,
    "",
    ...GUIDE_AND_FROZEN_ARCHIVE.slice(4),
  ];
  const root = mkdtempSync(join(tmpdir(), "restructure-testruns-"));
  writeFileSync(join(root, "TESTRUNS.md"), notebookLines(rows, { tail }).join("\r\n"));
  return { root, rows };
}

test("restructure dry-run: whole parked guide moved out of the row, shim registered, sentence added, damage repaired, rows rotated - root untouched", async () => {
  const { root, rows } = restructureRoot();
  const out = mkdtempSync(join(tmpdir(), "restructure-testruns-out-"));
  try {
    const pristine = readRaw(target(root));
    const { value: code, logs } = await capturing("log", () => restructureMain(["--root", root, "--dry-run", "--out", out]));
    assert.equal(code, 0, logs.join("\n"));
    assert.match(logs.join("\n"), /live rows 23 -> 20, 3 rotated/);
    assert.match(logs.join("\n"), /\(a\) test guide: moved 21 line\(s\) of parked test guide text out of the oldest live row into "## Read Before Any Tests", "## Feature coverage", "## Performance"/);
    assert.equal(readRaw(target(root)), pristine, "dry-run never writes the root");
    assert.ok(!existsSync(join(root, "docs")));

    const after = readRaw(join(out, "TESTRUNS.md"));
    assert.equal(bareLf(after), 0, "CRLF kept");
    const lines = after.split("\r\n");
    const guide = lines.indexOf("## Read Before Any Tests");
    assert.deepEqual(lines.slice(guide, guide + 5), ["## Read Before Any Tests", "", GUIDE_LEAD_IN, "", "Guide body."], "the lead-in sits directly under the guide heading");
    const coverage = lines.indexOf("## Feature coverage");
    const python = lines.indexOf("## Python contracts");
    assert.ok(guide < coverage && coverage < python, "the rescued sections sit in the guide, just before ## Python contracts");
    assert.deepEqual(
      lines.slice(coverage, python),
      ["## Feature coverage", "", ...GUIDE_COVERAGE, "", "## Performance", "", ...GUIDE_PERFORMANCE, ""],
      "the whole span moved verbatim: coverage from its first paragraph, then ## Performance opening on its intro",
    );
    for (const line of [...GUIDE_COVERAGE, ...GUIDE_PERFORMANCE, GUIDE_LEAD_IN].filter(Boolean)) {
      assert.equal(lines.filter((l) => l === line).length, 1, `exactly one copy stays in TESTRUNS.md: ${line}`);
    }
    const row = lines.find((l) => l.startsWith("| `tools/test_mefi_studio_session_dedupe.py` |"));
    assert.ok(row && row.includes("`tools/test_session_dedupe.py`") && row.includes("session work accounting: normalized-title deduplication and overflow requeueing. It runs without network."), `shim row: ${row}`);
    assert.equal(lines.indexOf(row), lines.indexOf("| `tools/test_mefi_studio_catalog.py` | Catalog contract. |") + 1, "appended to the table");
    assert.match(after, /Rows go in through `node scripts\/append-testruns-row\.mjs`; the live region\r\nkeeps the newest 20 rows/);
    assert.ok(after.indexOf("Rows go in through") < after.indexOf("### Known environmental failures"));
    const damage = lines.indexOf(REPAIRED[0]);
    assert.deepEqual(lines.slice(damage, damage + 4), REPAIRED, "npm spans restored, stray breaks removed");
    assert.ok(!lines.some((l) => /^pm (run|test)/.test(l)));
    const audit = auditTestruns(out);
    assert.deepEqual(audit.problems, []);
    assert.equal(audit.rows, 20);

    const arch = readRaw(join(out, "docs", "archive", "testruns-2026-09.md"));
    assert.equal(bareLf(arch), 0);
    for (const r of rows.slice(20)) assert.equal(count(arch, r.heading), 1);
    assert.ok(arch.endsWith(`${rows[22].heading}\r\n\r\n${OLDEST_RUN_LOG.join("\r\n")}\r\n`), "the oldest row's own run log rotated with it, and nothing below it");
    for (const line of [...GUIDE_COVERAGE, ...GUIDE_PERFORMANCE, GUIDE_LEAD_IN].filter(Boolean)) {
      assert.ok(!arch.includes(line), `no guide text reaches the archive: ${line}`);
    }
  } finally {
    cleanup(root, out);
  }
});

test("restructure apply matches its dry-run, and a second run finds nothing to do", () => {
  const { root } = restructureRoot();
  const out = mkdtempSync(join(tmpdir(), "restructure-testruns-out-"));
  try {
    restructureTestruns(root, { dryRun: true, out });
    const summary = restructureTestruns(root);
    assert.equal(summary.rotation.rotated, 3);
    assert.equal(readRaw(target(root)), readRaw(join(out, "TESTRUNS.md")));
    assert.equal(readRaw(archive(root, "2026-09")), readRaw(join(out, "docs", "archive", "testruns-2026-09.md")));
    const settled = readRaw(target(root));
    const again = restructureTestruns(root);
    assert.ok(again.notes.every((n) => n.endsWith("nothing to do")), again.notes.join("; "));
    assert.equal(again.rotation.rotated, 0);
    assert.equal(readRaw(target(root)), settled);
  } finally {
    cleanup(root, out);
  }
});

test("the nothing-lost verifier flags a dropped paragraph and accepts a documented edit", () => {
  assert.throws(() => verifyNothingLost("# T\n\nkept\n\ndropped\n", ["# T\n\nkept\n"]), /1 paragraph\(s\) would be lost[\s\S]*dropped/);
  verifyNothingLost("a\n\nold table\n", ["a\n\nold table\nnew row\n"], [{ step: "b", from: ["old table"], to: ["old table\nnew row"] }]);
  assert.throws(() => verifyNothingLost("a\n\nold\n", ["a\n"], [{ step: "b", from: ["old"], to: ["old\nnew"] }]), /edit b/);
});

test("the not-archived verifier refuses rescued guide text, or a guide opener it missed, in a rotated row", () => {
  const rowWith = (...body) => `## 2026-09-01 x - row (run_1)\r\n\r\n${body.join("\r\n\r\n")}\r\n`;
  verifyNotArchived(["Guide paragraph."], [rowWith("Row body.")], ["The eyes worker ("]);
  assert.throws(() => verifyNotArchived(["Guide paragraph."], [rowWith("Row body.", "Guide paragraph.")]), /1 paragraph\(s\) of the rescued test guide would rotate into docs\/archive\/[\s\S]*Guide paragraph\./);
  // The span start moved to the H3 only (the old bug): the coverage paragraph
  // above it would ride the row out, and the opener list still catches it.
  assert.throws(
    () => verifyNotArchived(["### Profiler-guided Command optimization"], [rowWith("Row body.", "The eyes worker (`scripts/eyes-worker.mjs`) moves reads.")], ["The eyes worker ("]),
    /rescued test guide would rotate[\s\S]*The eyes worker/,
  );
});

test("the restructure aborts with no write when guide text would still rotate out", async () => {
  // A parked guide the rescue does not recognise (no known coverage opener,
  // no Profiler H3) under a known lead-in: the verifier stops the rotation.
  const rows = makeRows(21, "2026-09-23");
  rows[20].body = ["Oldest row body.", "", "Unrecognised guide paragraph.", "", GUIDE_LEAD_IN];
  const tail = ["## Read Before Any Tests", "", "Guide body.", "", "## Python contracts", "", "| Contract | Coverage |", "|---|---|", "| `tools/test_mefi_studio_catalog.py` | Catalog contract. |", ""];
  const root = makeRoot(rows, { eol: "\r\n", tail });
  try {
    const pristine = readRaw(target(root));
    const { value: code, logs } = await capturing("error", () => restructureMain(["--root", root]));
    assert.equal(code, 1);
    assert.match(logs.join("\n"), /1 paragraph\(s\) of the rescued test guide would rotate into docs\/archive\/[\s\S]*This is the test guide/);
    assert.equal(readRaw(target(root)), pristine, "nothing written");
    assert.ok(!existsSync(join(root, "docs")));
  } finally {
    cleanup(root);
  }
});

test("a heading that already rotated into the archive is refused on re-append, leaving both files byte-identical", async () => {
  const rows = makeRows(20, "2026-09-29");
  const root = makeRoot(rows);
  const blocks = mkdtempSync(join(tmpdir(), "rotate-testruns-blocks-"));
  try {
    appendTestrunsRow(root, "## 2026-09-30 noon - the 21st row (run_21)\n\nBody 21.\n");
    const arch = archive(root, "2026-09");
    assert.ok(readRaw(arch).includes(rows[19].heading), "the oldest row rotated out");
    assert.ok(!readRaw(target(root)).includes(rows[19].heading));
    const notebook = readRaw(target(root));
    const archived = readRaw(arch);

    // A resumed run redoing its final append, with an amended body.
    const again = `${rows[19].heading}\n\nBody of row 19, amended on resume.\n`;
    assert.throws(() => appendTestrunsRow(root, again), /duplicate H2 already present: .*\(run_19\) \(rotated into docs\/archive\/testruns-2026-09\.md\)/);
    assert.throws(() => appendTestrunsRow(root, again, { dryRun: true }), /duplicate H2 already present/, "dry-run reports the refusal too");
    writeFileSync(join(blocks, "again.md"), again);
    const cli = await capturing("error", () => appendMain(["--root", root, "--file", join(blocks, "again.md")]));
    assert.equal(cli.value, 1, "the CLI exits non-zero instead of printing gate ok");
    assert.match(cli.logs.join("\n"), /duplicate H2 already present/);
    assert.equal(readRaw(target(root)), notebook, "TESTRUNS.md byte-identical");
    assert.equal(readRaw(arch), archived, "the archive byte-identical");

    // Rotation keeps working afterwards: the next fresh row pushes one more out.
    const next = appendTestrunsRow(root, "## 2026-09-30 night - the next row (run_22)\n\nBody 22.\n");
    assert.equal(next.rotation.rotated, 1);
    assert.equal(next.rotation.error, undefined);
    assert.equal(auditTestruns(root).rows, 20);
    assert.equal(count(readRaw(arch), rows[19].heading), 1);
  } finally {
    cleanup(root, blocks);
  }
});
