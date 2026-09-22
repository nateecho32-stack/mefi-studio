// One-shot migration that readies TESTRUNS.md for self-compaction by
// scripts/rotate-testruns.mjs. Run it once, by hand, from the repo root:
//
//   node tools/restructure_testruns_once.mjs --dry-run --out <dir>   preview
//   node tools/restructure_testruns_once.mjs                         apply
//
// Under one acquisition of the append helper's lock it:
//  (a) rescues the test guide text parked inside the oldest live row. Before
//      dated H2 rows existed the notebook opened on that guide (f5350b0: per-
//      suite coverage paragraphs, the Profiler H3, then the "This is the test
//      guide ..." lead-in right above "## Read Before Any Tests"), and every
//      later run paragraph was prepended above it, so the guide ended up at
//      the bottom of the oldest row, where rotation would archive it. The
//      span runs from the guide's first paragraph ("The eyes worker (" - the
//      newest opener, prepended above the f5350b0 "Chat admission
//      regressions" one) through the line before the anchor, and leaves the
//      row verbatim: the lead-in sentence goes directly under "## Read Before
//      Any Tests", the coverage paragraphs up to "Performance profiler
//      coverage" into a new "## Feature coverage" section, and the rest - that
//      intro, the Profiler H3 and what follows it - into "## Performance",
//      both just before "## Python contracts" (or at the end of the guide
//      when that heading is gone). The row's own run log above the span stays
//      and rotates; the validation notes inside the span stay with the
//      coverage they validate, as they always sat in the guide;
//  (b) registers `tools/test_mefi_studio_session_dedupe.py` and the contract
//      it re-exports, `tools/test_session_dedupe.py`, as a "## Python
//      contracts" table row when that section does not name the shim yet.
//      Its only mention is the coverage paragraph (a) rescues, and
//      scripts/auditor.mjs (plus the rotation's own guard) needs the literal
//      to stay in TESTRUNS.md. The coverage text comes from that paragraph;
//  (c) adds one sentence to "## How to read this file": rows go in through
//      the append helper, the live region keeps the newest 20, older rows
//      rotate into docs/archive/testruns-YYYY-MM.md, and the dated rows below
//      the guide are the frozen archive;
//  (d) repairs the PowerShell "`n" damage. Its exact shape: an inline
//      "`npm ...`" span whose backtick-n was expanded to a newline and whose
//      closing backtick-space escape collapsed to a plain space, leaving a
//      line that starts "pm run check" / "pm test" / "pm run audit" either
//      after a stray blank line (the original line break plus the expanded
//      one) or split off the previous line's trailing space. No backtick-n
//      survives in the file. The backticks come back and the stray break
//      goes; nothing else changes;
//  (e) calls rotateTestruns(root, { keep: 20, locked: true }), moving every
//      row beyond the newest 20 into docs/archive/.
// Every step is idempotent, so a re-run finds nothing left to do. Before any
// byte is written the whole outcome is planned in memory and verified: every
// paragraph of the original file (blank-line separated, EOL-normalized,
// headings on their own) must reappear in the new TESTRUNS.md or an archive
// file, the only exceptions being (b)'s grown table and (d)'s repaired
// paragraphs, each checked to be exactly that edit; no paragraph of the
// guide span (a) rescued may reach an archive file; every `tools/test_*.py`
// literal must still be in TESTRUNS.md; and both the restructured and the
// rotated file must pass check-testruns. Otherwise it aborts with no write.
// Writes are compare-and-swap against the bytes read under the lock, so a
// concurrent save aborts as well; --dry-run writes the would-be TESTRUNS.md
// and archive files under --out instead of touching the root.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicReplace, withTestrunsLock } from "../scripts/append-testruns-row.mjs";
import { auditTestruns } from "../scripts/check-testruns.mjs";
import { DEFAULT_KEEP, lostRegistrations, planArchives, planRotation, rotateTestruns } from "../scripts/rotate-testruns.mjs";

const GUIDE_H2 = "## Read Before Any Tests";
const PROFILER_H3 = "### Profiler-guided Command optimization";
// Paragraph openers of the parked guide, newest first: the earliest one found
// in the oldest live row starts the rescued span (the Profiler H3 is the last
// resort when neither coverage opener is there).
const GUIDE_OPENERS = [
  "The eyes worker (`scripts/eyes-worker.mjs`",
  "Chat admission regressions in `tests/assistant_chat_admission.test.mjs`",
];
const PERF_OPENERS = ["Performance profiler coverage runs through", PROFILER_H3];
const GUIDE_LEAD_IN = "This is the test guide for the standalone Mefi's Studio AI+ repository.";
const COVERAGE_H2 = "## Feature coverage";
const PERFORMANCE_H2 = "## Performance";
const SHIM = "`tools/test_mefi_studio_session_dedupe.py`";
const CONTRACT = "`tools/test_session_dedupe.py`";
const FALLBACK_COVERAGE =
  "session work accounting: normalized-title deduplication, one in-progress todo per active session, overflow requeueing, and the overseer digest using fresh watcher counts.";
const ROW_RE = /^## \d{4}-\d{2}-\d{2} /;
const DAMAGED_NPM = /^pm (run [\w:.-]+|test|ci|install)(?=[\s,.;:)]|$)/;

const chomp = (line) => (line.endsWith("\r") ? line.slice(0, -1) : line);
const crOf = (line) => (line.endsWith("\r") ? "\r" : "");
const isBlank = (line) => chomp(line).trim() === "";
const findLine = (lines, exact, from = 0) => {
  for (let i = from; i < lines.length; i++) if (chomp(lines[i]) === exact) return i;
  return -1;
};
const nextH2 = (lines, after) => {
  for (let i = after + 1; i < lines.length; i++) if (chomp(lines[i]).startsWith("## ")) return i;
  return -1;
};

// Paragraphs: maximal runs of non-blank lines, EOL-normalized; an ATX heading
// line is always a paragraph of its own (Markdown treats it as its own block),
// so moving a section never regroups its neighbours.
export function paragraphs(text) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (cur.length > 0) out.push(cur.join("\n"));
    cur = [];
  };
  for (const line of String(text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n")) {
    if (line.trim() === "") flush();
    else if (/^#{1,6} /.test(line)) {
      flush();
      out.push(line);
    } else cur.push(line);
  }
  flush();
  return out;
}

function countMap(list) {
  const m = new Map();
  for (const item of list) m.set(item, (m.get(item) ?? 0) + 1);
  return m;
}

function paragraphDiff(beforeText, afterText) {
  const a = countMap(paragraphs(beforeText));
  const b = countMap(paragraphs(afterText));
  const from = [];
  const to = [];
  for (const [p, n] of a) for (let k = b.get(p) ?? 0; k < n; k++) from.push(p);
  for (const [p, n] of b) for (let k = a.get(p) ?? 0; k < n; k++) to.push(p);
  return { from, to };
}

// Every paragraph of the original must survive (as a multiset) across the
// outputs, except those a documented edit replaced - and every paragraph an
// edit produced must be present in the outputs.
export function verifyNothingLost(originalText, outputTexts, edits = []) {
  const have = countMap(outputTexts.flatMap((t) => paragraphs(t)));
  const exempt = countMap(edits.flatMap((e) => e.from));
  const missing = [];
  for (const [p, n] of countMap(paragraphs(originalText))) {
    if (n - (have.get(p) ?? 0) - (exempt.get(p) ?? 0) > 0) missing.push(p);
  }
  for (const e of edits) for (const p of e.to) if (!have.has(p)) missing.push(`(edit ${e.step}) ${p}`);
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).map((p) => `  - ${p.replace(/\n/g, " / ").slice(0, 160)}`).join("\n");
    throw new Error(`restructure-testruns: ${missing.length} paragraph(s) would be lost - aborting with no write:\n${shown}`);
  }
}

// The guide span (a) rescued stays in TESTRUNS.md: none of its paragraphs -
// and, should (a) ever miss the span, no paragraph opening like the parked
// guide does - may ride a rotated row into an archive file.
export function verifyNotArchived(rescued, archivedTexts, openers = []) {
  const kept = new Set(rescued);
  const archived = archivedTexts.flatMap((t) => paragraphs(t));
  const leaked = [...new Set(archived.filter((p) => kept.has(p) || openers.some((o) => p.startsWith(o))))];
  if (leaked.length > 0) {
    const shown = leaked.slice(0, 5).map((p) => `  - ${p.replace(/\n/g, " / ").slice(0, 160)}`).join("\n");
    throw new Error(`restructure-testruns: ${leaked.length} paragraph(s) of the rescued test guide would rotate into docs/archive/ - aborting with no write:\n${shown}`);
  }
}

const trimBlank = (list) => {
  let from = 0;
  let to = list.length;
  while (from < to && isBlank(list[from])) from++;
  while (to > from && isBlank(list[to - 1])) to--;
  return list.slice(from, to);
};

// First line in [from, to) that opens a paragraph with one of `openers` (a
// heading opener must match the whole line).
function findOpener(lines, openers, from, to) {
  for (let i = from; i < to; i++) {
    const line = chomp(lines[i]);
    if (i > 0 && !isBlank(lines[i - 1])) continue;
    if (openers.some((o) => (o.startsWith("#") ? line === o : line.startsWith(o)))) return i;
  }
  return -1;
}

// A rescued section's body lands at the end of its own heading's section when
// the file already has one, otherwise under a new heading just before
// "## Python contracts" (or at the end of the guide when that is gone).
function placeSection(lines, heading, body, cr) {
  if (body.length === 0) return lines;
  const guide = findLine(lines, GUIDE_H2);
  const own = findLine(lines, heading);
  let at;
  let insert;
  if (own !== -1) {
    at = nextH2(lines, own);
    insert = [...body, cr];
  } else {
    const python = findLine(lines, "## Python contracts", guide);
    at = python !== -1 ? python : nextH2(lines, guide);
    insert = [`${heading}${cr}`, cr, ...body, cr];
  }
  if (at === -1) {
    let last = lines.length;
    while (last > 0 && isBlank(lines[last - 1])) last--;
    return [...lines.slice(0, last), cr, ...trimBlank(insert), ""];
  }
  return [...lines.slice(0, at), ...(at > 0 && !isBlank(lines[at - 1]) ? [cr] : []), ...insert, ...lines.slice(at)];
}

// (a) The test guide parked in the oldest live row, out of the live region:
// lead-in under the guide heading, coverage and performance into sections.
function rescueGuide(lines) {
  const guide = findLine(lines, GUIDE_H2);
  if (guide === -1) throw new Error('restructure-testruns: "## Read Before Any Tests" anchor heading is missing');
  let oldestRow = -1;
  for (let i = 0; i < guide; i++) if (ROW_RE.test(chomp(lines[i]))) oldestRow = i;
  if (oldestRow === -1) return { changed: false };
  let start = findOpener(lines, GUIDE_OPENERS, oldestRow + 1, guide);
  if (start === -1) start = findOpener(lines, PERF_OPENERS, oldestRow + 1, guide);
  if (start === -1) return { changed: false };
  const span = lines.slice(start, guide);
  const cr = crOf(lines[guide]);

  // The lead-in sentence, a paragraph of its own, leaves the span first.
  let leadIn = [];
  const lead = span.findIndex((l, k) => chomp(l).startsWith(GUIDE_LEAD_IN) && (k === 0 || isBlank(span[k - 1])));
  let body = span;
  if (lead !== -1) {
    let end = lead;
    while (end < span.length && !isBlank(span[end])) end++;
    leadIn = span.slice(lead, end);
    body = [...span.slice(0, lead), ...span.slice(end)];
  }
  const perf = findOpener(body, PERF_OPENERS, 0, body.length);
  const coverage = trimBlank(perf === -1 ? body : body.slice(0, perf));
  const performance = perf === -1 ? [] : trimBlank(body.slice(perf));

  // lines[start - 1] is blank (findOpener), so the row keeps one separator.
  let out = [...lines.slice(0, start), ...lines.slice(guide)];
  if (leadIn.length > 0) {
    const g = findLine(out, GUIDE_H2);
    const blankAfter = g + 1 < out.length && isBlank(out[g + 1]);
    const at = blankAfter ? g + 2 : g + 1;
    out = [...out.slice(0, at), ...(blankAfter ? [] : [cr]), ...leadIn, cr, ...out.slice(at)];
  }
  out = placeSection(out, COVERAGE_H2, coverage, cr);
  out = placeSection(out, PERFORMANCE_H2, performance, cr);
  const into = [[leadIn, GUIDE_H2], [coverage, COVERAGE_H2], [performance, PERFORMANCE_H2]].filter(([part]) => part.length > 0).map(([, h]) => `"${h}"`);
  return {
    changed: true,
    lines: out,
    rescued: paragraphs(span.join("\n")),
    note: `moved ${span.length} line(s) of parked test guide text out of the oldest live row into ${into.join(", ")}`,
  };
}

function coverageFromParagraph(text) {
  for (const p of paragraphs(text)) {
    if (p.startsWith("|") || !p.includes(`${SHIM} covers `)) continue;
    const flat = p.replace(/\s*\n\s*/g, " ");
    return flat.slice(flat.indexOf(`${SHIM} covers `) + `${SHIM} covers `.length).trim();
  }
  return FALLBACK_COVERAGE;
}

// (b) session_dedupe registration row in the Python contracts table.
function registerSessionDedupe(lines) {
  const python = findLine(lines, "## Python contracts");
  if (python === -1) throw new Error('restructure-testruns: "## Python contracts" section is missing - cannot register the session_dedupe shim');
  const end = nextH2(lines, python) === -1 ? lines.length : nextH2(lines, python);
  if (lines.slice(python, end).some((l) => l.includes(SHIM))) return { changed: false };
  let lastRow = -1;
  for (let i = python + 1; i < end; i++) if (chomp(lines[i]).startsWith("|")) lastRow = i;
  if (lastRow === -1) throw new Error('restructure-testruns: "## Python contracts" has no table to extend');
  const coverage = coverageFromParagraph(lines.join("\n")).replace(/\|/g, "\\|");
  const row = `| ${SHIM} | npm-test discovery shim: re-exports the contracts in ${CONTRACT}, which cover ${coverage} |`;
  const out = [...lines.slice(0, lastRow + 1), row + crOf(lines[lastRow]), ...lines.slice(lastRow + 1)];
  return { changed: true, lines: out, row, note: "registered the session_dedupe shim in the Python contracts table" };
}

// (c) one sentence on rotation in "## How to read this file".
function addRotationSentence(lines, keep) {
  const how = findLine(lines, "## How to read this file");
  if (how === -1) throw new Error('restructure-testruns: "## How to read this file" section is missing');
  const end = nextH2(lines, how) === -1 ? lines.length : nextH2(lines, how);
  if (lines.slice(how, end).some((l) => l.includes("docs/archive/testruns-YYYY-MM.md"))) return { changed: false };
  let i = how + 1;
  while (i < end && isBlank(lines[i])) i++;
  while (i < end && !isBlank(lines[i]) && !chomp(lines[i]).startsWith("#")) i++;
  const cr = crOf(lines[how]);
  const sentence = [
    "Rows go in through `node scripts/append-testruns-row.mjs`; the live region",
    `keeps the newest ${keep} rows, older rows rotate verbatim into`,
    "`docs/archive/testruns-YYYY-MM.md` (newest first), and the dated rows below",
    "the guide are the frozen archive.",
  ].map((l) => l + cr);
  const after = i < lines.length && isBlank(lines[i]) ? [] : [cr];
  const out = [...lines.slice(0, i), cr, ...sentence, ...after, ...lines.slice(i)];
  return { changed: true, lines: out, note: 'added the rotation sentence to "## How to read this file"' };
}

// (d) the "`n" damage: restore "`npm ...`" and drop the stray break.
function repairNpmDamage(lines) {
  const out = [...lines];
  let repairs = 0;
  for (let i = 1; i < out.length; i++) {
    const line = chomp(out[i]);
    const m = line.match(DAMAGED_NPM);
    if (!m) continue;
    const fixed = `\`npm ${m[1]}\`${line.slice(m[0].length)}`;
    const prev = chomp(out[i - 1]);
    if (prev.trim() === "" && i >= 2 && !isBlank(out[i - 2]) && !chomp(out[i - 2]).startsWith("#")) {
      out.splice(i - 1, 2, fixed + crOf(out[i]));
    } else if (prev.trim() !== "" && prev.endsWith(" ") && !prev.startsWith("#")) {
      out.splice(i - 1, 2, prev + fixed + crOf(out[i - 1]));
    } else continue;
    i -= 1;
    repairs++;
  }
  if (repairs === 0) return { changed: false };
  return { changed: true, lines: out, note: `repaired ${repairs} "\`n"-damaged npm command line(s)` };
}

const repairShape = (s) => s.replace(/`npm /g, "pm ").replace(/`/g, "").replace(/\s+/g, " ").trim();

// Steps (a)-(d) on the text alone; returns the new text, the paragraph-level
// edits each step made (checked against what the step is allowed to do) and
// one note per step.
export function restructureText(text, { keep = DEFAULT_KEEP } = {}) {
  let lines = String(text).split("\n");
  const edits = [];
  const notes = [];
  let rescued = [];
  const steps = [
    ["a", "test guide", rescueGuide],
    ["b", "session_dedupe", registerSessionDedupe],
    ["c", "how-to sentence", (l) => addRotationSentence(l, keep)],
    ["d", "npm repair", repairNpmDamage],
  ];
  for (const [step, name, fn] of steps) {
    const beforeText = lines.join("\n");
    const res = fn(lines);
    if (!res.changed) {
      notes.push(`(${step}) ${name}: nothing to do`);
      continue;
    }
    const afterText = res.lines.join("\n");
    const diff = paragraphDiff(beforeText, afterText);
    const ok =
      step === "a" ? diff.from.length === 0 && diff.to.every((p) => p === COVERAGE_H2 || p === PERFORMANCE_H2)
      : step === "b" ? diff.from.length === 1 && diff.to.length === 1 && diff.to[0] === `${diff.from[0]}\n${res.row}`
      : step === "c" ? diff.from.length === 0 && diff.to.length === 1
      : diff.from.length > 0 && repairShape(diff.from.join(" ")) === repairShape(diff.to.join(" "));
    if (!ok) throw new Error(`restructure-testruns: step (${step}) ${name} changed more than it documents - aborting with no write`);
    lines = res.lines;
    if (res.rescued) rescued = res.rescued;
    edits.push({ step, ...diff });
    notes.push(`(${step}) ${name}: ${res.note}`);
  }
  return { text: lines.join("\n"), edits, notes, rescued };
}

function gateCheck(text, label) {
  const dir = mkdtempSync(join(tmpdir(), "restructure-testruns-"));
  try {
    writeFileSync(join(dir, "TESTRUNS.md"), text);
    const { problems } = auditTestruns(dir);
    if (problems.length > 0) {
      throw new Error(`restructure-testruns: the ${label} file would fail check-testruns - aborting with no write:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The whole outcome, planned and verified in memory; writes nothing.
export function planRestructure(root, { keep = DEFAULT_KEEP } = {}) {
  const target = join(root, "TESTRUNS.md");
  const raw = readFileSync(target);
  const original = raw.toString("utf8");
  const pre = auditTestruns(root);
  if (pre.problems.length > 0) {
    throw new Error(`restructure-testruns: refusing to run - check-testruns already flags this file:\n${pre.problems.map((p) => `  - ${p}`).join("\n")}`);
  }
  const shaped = restructureText(original, { keep });
  const rotation = planRotation(shaped.text, { keep });
  const lost = lostRegistrations(original, rotation.keptText);
  if (lost.length > 0) {
    throw new Error(`restructure-testruns: ${lost.join(", ")} would leave TESTRUNS.md - aborting with no write`);
  }
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const archives = rotation.rotatedRows > 0 ? planArchives(root, rotation.rotated, { eol }) : [];
  const archiveDir = join(root, "docs", "archive");
  const planned = new Set(archives.map((a) => resolve(a.path)));
  let untouched = [];
  try {
    untouched = readdirSync(archiveDir)
      .filter((name) => /^testruns-\d{4}-\d{2}\.md$/.test(name) && !planned.has(resolve(archiveDir, name)))
      .map((name) => readFileSync(join(archiveDir, name), "utf8"));
  } catch {
    // no archive folder yet
  }
  verifyNothingLost(original, [rotation.keptText, ...archives.map((a) => a.text), ...untouched], shaped.edits);
  verifyNotArchived(shaped.rescued, rotation.rotated, [...GUIDE_OPENERS, ...PERF_OPENERS, GUIDE_LEAD_IN]);
  for (const a of archives) if (a.prior !== null) verifyNothingLost(a.prior.toString("utf8"), [a.text]);
  gateCheck(shaped.text, "restructured");
  gateCheck(rotation.keptText, "rotated");
  return { target, raw, original, shaped, rotation, archives, registrations: [...new Set(original.match(/`tools\/test_[A-Za-z0-9_]+\.py`/g) ?? [])].length };
}

export function restructureTestruns(root, { keep = DEFAULT_KEEP, dryRun = false, out = null } = {}) {
  const target = join(root, "TESTRUNS.md");
  return withTestrunsLock(target, () => {
    const plan = planRestructure(root, { keep });
    const summary = {
      dryRun,
      notes: plan.shaped.notes,
      bytesBefore: plan.raw.length,
      bytesAfter: Buffer.byteLength(plan.rotation.keptText, "utf8"),
      liveRowsBefore: plan.rotation.liveRows,
      liveRowsAfter: plan.rotation.keptRows,
      rotated: plan.rotation.rotatedRows,
      archives: plan.archives.map((a) => ({ path: a.path, bytes: Buffer.byteLength(a.text, "utf8"), added: a.added, skipped: a.skipped })),
      registrations: plan.registrations,
    };
    if (dryRun) {
      if (!out) throw new Error("restructure-testruns: --dry-run needs --out <dir> for the would-be files");
      const outRoot = resolve(out);
      mkdirSync(outRoot, { recursive: true });
      writeFileSync(join(outRoot, "TESTRUNS.md"), plan.rotation.keptText);
      summary.outputs = [join(outRoot, "TESTRUNS.md")];
      for (const a of plan.archives) {
        const dest = join(outRoot, relative(root, a.path));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, a.text);
        summary.outputs.push(dest);
      }
      return summary;
    }
    if (plan.shaped.text !== plan.original) {
      const written = Buffer.from(plan.shaped.text, "utf8");
      try {
        atomicReplace(target, written, { expectCurrent: plan.raw });
      } catch (err) {
        throw new Error(`restructure-testruns: TESTRUNS.md changed while restructuring - no write performed (${err.message})`);
      }
      const post = auditTestruns(root);
      if (post.problems.length > 0) {
        if (readFileSync(target).equals(written)) atomicReplace(target, plan.raw, { expectCurrent: written });
        throw new Error(`restructure-testruns: post-write gate check failed, restored:\n${post.problems.map((p) => `  - ${p}`).join("\n")}`);
      }
    }
    summary.rotation = rotateTestruns(root, { keep, locked: true, replace: atomicReplace });
    if (readFileSync(target, "utf8") !== plan.rotation.keptText) {
      console.error("restructure-testruns: note - the final TESTRUNS.md differs from the planned bytes; re-run with --dry-run to inspect");
    }
    return summary;
  });
}

const USAGE = `usage: node tools/restructure_testruns_once.mjs [--root <dir>] [--keep N] [--dry-run --out <dir>]

  --root <dir>   package root holding TESTRUNS.md (default: this repo)
  --keep N       live rows to keep after rotation (default: ${DEFAULT_KEEP})
  --dry-run      plan and verify only; write the would-be files under --out
  --out <dir>    where --dry-run puts TESTRUNS.md and docs/archive/*.md
  --help         this help

One-shot: moves the test guide text parked in the oldest live row out of it
(its lead-in under "## Read Before Any Tests", the coverage paragraphs into
"## Feature coverage", the profiler intro, Profiler-guided Command
optimization block and what follows into "## Performance"), registers the
session_dedupe shim in the Python contracts table, adds the rotation
sentence to "How to read this file",
repairs the "\`n"-damaged npm command lines, then rotates rows beyond the
newest N into docs/archive/testruns-YYYY-MM.md - all under the append
helper's lock, verified to lose no paragraph before anything is written.`;

export function main(argv = process.argv.slice(2)) {
  let rootOpt = null;
  let keep = DEFAULT_KEEP;
  let dryRun = false;
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      return 0;
    }
    if (a === "--root" && i + 1 < argv.length) rootOpt = argv[++i];
    else if (a === "--keep" && i + 1 < argv.length) keep = Number(argv[++i]);
    else if (a === "--out" && i + 1 < argv.length) out = argv[++i];
    else if (a === "--dry-run") dryRun = true;
    else {
      console.error(`restructure-testruns: unknown or incomplete argument ${a}\n${USAGE}`);
      return 2;
    }
  }
  if (!Number.isInteger(keep) || keep < 1) {
    console.error(`restructure-testruns: --keep must be a whole number >= 1, got ${keep}`);
    return 2;
  }
  if (dryRun !== Boolean(out)) {
    console.error("restructure-testruns: --dry-run and --out go together (the preview is written under --out)");
    return 2;
  }
  const root = rootOpt ? resolve(rootOpt) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const s = restructureTestruns(root, { keep, dryRun, out });
    for (const note of s.notes) console.log(`restructure-testruns: ${note}`);
    const archives = s.archives.map((a) => `${relative(root, a.path).split("\\").join("/")} ${a.bytes} B (+${a.added} row(s)${a.skipped ? `, ${a.skipped} already there` : ""})`).join("; ");
    console.log(
      `restructure-testruns: ${s.dryRun ? "dry-run - " : ""}TESTRUNS.md ${s.bytesBefore} B -> ${s.bytesAfter} B, live rows ${s.liveRowsBefore} -> ${s.liveRowsAfter}, ${s.rotated} rotated${archives ? ` into ${archives}` : ""}; ${s.registrations} tools/test_*.py literal(s) kept`
    );
    if (s.dryRun) {
      const { problems, rows } = auditTestruns(resolve(out));
      console.log(`restructure-testruns: would-be files under ${resolve(out)}; check-testruns on them: ${problems.length === 0 ? `ok (${rows} live rows)` : problems.join("; ")}`);
      return problems.length === 0 ? 0 : 1;
    }
    return 0;
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main());
}
