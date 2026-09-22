// Structural gate for TESTRUNS.md, the shared lab notebook many sessions
// append to concurrently. The 2026-09-22 collision (resolved in ad5bba2)
// showed the failure modes: duplicate row headings from a clobbered append,
// rows inserted at a stale anchor below newer rows, and the risk of OneDrive
// conflict-copy siblings. This pass makes each of those a check failure
// instead of something a repair session has to discover by hand.
//
// Scope decision (2026-09-22, run_1790106278990_28): only the live region
// above `## Read Before Any Tests` must be newest-first. The archive below
// that anchor is BLESSED, not an oversight: it interleaves undated reference
// sections ("Python contracts", "App commands and captures", "Agent loop,
// Jev and startup regressions") with dated rows, and its tail runs
// oldest-first as a chronological narrative whose attempt/retry pair sharing
// run_1790085745914_2 was verified deliberate in ad5bba2. The failure modes
// this gate exists for (stale-anchor appends, duplicate rows, conflict
// copies) only ever land in the live region where new rows are inserted, so
// enforcing order on the frozen archive would churn verified history for
// nothing. Do not "fix" the skip back; tests/check_testruns.test.mjs pins
// it. The exemption is boundary-locked: a missing anchor heading fails the
// check loudly instead of silently enforcing or exempting the wrong region.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GUIDE_HEADING = "## Read Before Any Tests";
// Tested against the heading text with the "## " prefix already sliced off.
// The working tree checks out CRLF under core.autocrlf=true, so all line
// comparisons happen after \r\n normalization.
const ROW_RE = /^(\d{4}-\d{2}-\d{2}) /;

function hasUtf8Bom(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

export function auditTestruns(packageRoot) {
  const problems = [];
  const rel = "TESTRUNS.md";
  const abs = join(packageRoot, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    return { problems: [`${rel}: MISSING`], rows: 0 };
  }
  const buf = readFileSync(abs);
  if (hasUtf8Bom(buf)) problems.push(`${rel}: UTF-8 BOM (rewrite as UTF-8 without BOM)`);
  const text = buf.toString("utf8").replace(/^\uFEFF/, "").split("\r\n").join("\n");
  const lines = text.split("\n");

  // Conflict-copy siblings in the repo root: OneDrive sync and manual saves
  // produce "TESTRUNS-<host> (1).md"-style files whose content then gets
  // re-merged by hand. Surface them so the copy is reconciled deliberately.
  for (const name of readdirSync(packageRoot)) {
    if (name === rel || !/^TESTRUNS.+\.md$/i.test(name)) continue;
    if (statSync(join(packageRoot, name)).isFile()) {
      problems.push(`${name}: conflict-copy sibling of ${rel} - merge or delete it`);
    }
  }

  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) headings.push({ line: i + 1, text: lines[i].slice(3) });
  }
  if (headings.length === 0 || headings[0].text !== "How to read this file") {
    problems.push(`${rel}: preamble heading "## How to read this file" must be the first H2`);
  }
  if (!lines.some((l) => l === "### Known environmental failures")) {
    problems.push(`${rel}: "### Known environmental failures" table is missing`);
  }

  const seen = new Map();
  for (const h of headings) {
    if (seen.has(h.text)) {
      problems.push(`${rel}:${h.line}: duplicate H2 (first at line ${seen.get(h.text)}): ${h.text}`);
    } else {
      seen.set(h.text, h.line);
    }
  }

  const firstDated = headings.findIndex((h) => ROW_RE.test(h.text));
  const guideIdx = headings.findIndex((h) => h.text === "Read Before Any Tests");
  if (guideIdx === -1) {
    // The archive exemption is scoped by this anchor. Without it the split
    // between the enforced live region and the blessed archive is undefined,
    // so fail loudly instead of silently enforcing the whole file (the old
    // fallback) or exempting everything.
    problems.push(`${rel}: "## Read Before Any Tests" anchor heading is missing - live/archive boundary undefined`);
  }
  const liveEnd = guideIdx === -1 ? headings.length : guideIdx;
  if (firstDated === -1) {
    problems.push(`${rel}: no dated run rows found`);
  } else {
    for (let i = firstDated; i < liveEnd; i++) {
      const m = headings[i].text.match(ROW_RE);
      if (!m) {
        problems.push(`${rel}:${headings[i].line}: non-row H2 inside the live run region: ${headings[i].text}`);
        continue;
      }
      const prev = i > firstDated ? headings[i - 1].text.match(ROW_RE) : null;
      if (prev && m[1] > prev[1]) {
        problems.push(
          `${rel}:${headings[i].line}: row dated ${m[1]} sits below an older ${prev[1]} row - stale-anchor append, move it newest-first`
        );
      }
    }
  }

  if (!text.endsWith("\n") || text.endsWith("\n\n")) {
    problems.push(`${rel}: file must end with exactly one newline`);
  }

  return { problems, rows: Math.max(0, liveEnd - firstDated) };
}

export function main() {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { problems, rows } = auditTestruns(packageRoot);
  for (const p of problems) console.error(`check-testruns: ${p}`);
  if (problems.length > 0) {
    console.error(`check-testruns: ${problems.length} problem(s)`);
    return 1;
  }
  console.log(`check-testruns: ok (${rows} live rows, headings unique, newest-first, no conflict copies)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main());
}
