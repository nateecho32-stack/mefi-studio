// Self-compaction for TESTRUNS.md, the third piece beside the append helper
// (scripts/append-testruns-row.mjs) and the gate (scripts/check-testruns.mjs).
// Every run adds a dated "## YYYY-MM-DD ..." row block to the live region -
// the rows between the first dated H2 and "## Read Before Any Tests", newest
// first - so the notebook grew without bound (419 KB and ~20 KB an hour on
// 2026-09-22). This keeps the newest rows (20 by default) where they are and
// moves every older row block, whole and verbatim, into
// docs/archive/testruns-<YYYY-MM>.md: one file per month of the row's heading
// date, newest first. A block is the dated H2 line through the line before
// the next H2, so the H3 subsections and unheaded paragraphs inside a row
// travel with it; a block is never split.
//
// Nothing else in TESTRUNS.md moves: the preamble, the guide and the frozen
// archive below the anchor stay byte-identical (that archive is blessed as-is,
// see check-testruns.mjs), and the row format and the gate rules are
// unchanged. Work happens on raw "\n"-split lines that keep their own "\r", so
// a CRLF file stays CRLF; archive files take the notebook's line ending when
// created and keep their own afterwards.
//
// Safety mirrors the append helper. Under its lock, every archive is written
// first (temp file + rename), then TESTRUNS.md through the helper's
// compare-and-swap replace against the exact bytes the plan was built from,
// so a non-cooperating save aborts with no TESTRUNS.md write. An archive
// merge skips a row whose heading it already holds with the same content, so
// a crash between the two writes never duplicates on the re-run (the same
// heading with different content is refused, never overwritten or dropped).
// A rotation that makes the gate flag anything new is rolled back
// byte-for-byte, and one that would drop the last TESTRUNS.md mention of a
// `tools/test_*.py` registration (scripts/auditor.mjs and the tools/ contracts
// look for those literals there) is refused before anything is written.
//
// The append helper imports this module and calls rotateTestruns with
// locked: true after every append, handing over its own atomicReplace; the
// CLI and other unlocked callers load the helper's lock through a dynamic
// import, so the two modules never import each other statically.
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditTestruns } from "./check-testruns.mjs";

export const DEFAULT_KEEP = 20;
const ROW_RE = /^(\d{4}-\d{2}-\d{2}) /; // same shape as check-testruns.mjs
const GUIDE = "Read Before Any Tests";
const REGISTRATION_RE = /`tools\/test_[A-Za-z0-9_]+\.py`/g;

const chomp = (line) => (line.endsWith("\r") ? line.slice(0, -1) : line);
const eolOf = (text) => (text.includes("\r\n") ? "\r\n" : "\n");

// The live region's row blocks, located the way the gate and the append
// helper see them: headings compared after "\r" is chomped, the region
// bounded by the first dated H2 and the guide anchor.
function locateLive(text) {
  const lines = text.split("\n");
  let guideIdx = -1;
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const line = chomp(lines[i]);
    if (!line.startsWith("## ")) continue;
    if (line.slice(3) === GUIDE) {
      guideIdx = i;
      break;
    }
    heads.push({ line: i, text: line.slice(3) });
  }
  if (guideIdx === -1) {
    throw new Error('rotate-testruns: "## Read Before Any Tests" anchor heading is missing - live/archive boundary undefined, refusing to rotate');
  }
  const first = heads.findIndex((h) => ROW_RE.test(h.text));
  const live = first === -1 ? [] : heads.slice(first);
  const blocks = live.map((h, k) => {
    const m = h.text.match(ROW_RE);
    if (!m) {
      throw new Error(`rotate-testruns: non-row H2 inside the live run region (line ${h.line + 1}): ${h.text.slice(0, 70)} - refusing to guess row boundaries`);
    }
    return { start: h.line, end: k + 1 < live.length ? live[k + 1].line : guideIdx, heading: `## ${h.text}`, date: m[1] };
  });
  return { lines, guideIdx, blocks };
}

// Pure planning pass: keep the first `keep` row blocks (newest first) and cut
// the rest out whole. Every byte outside the rotated blocks is kept as-is;
// the plan re-assembles itself and refuses to return if that ever drifts.
export function planRotation(text, { keep = DEFAULT_KEEP } = {}) {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`rotate-testruns: keep must be a whole number of rows >= 1, got ${keep}`);
  }
  const source = String(text);
  const { lines, guideIdx, blocks } = locateLive(source);
  if (blocks.length <= keep) {
    return { keptText: source, rotated: [], liveRows: blocks.length, keptRows: blocks.length, rotatedRows: 0, headings: [] };
  }
  const tail = blocks.slice(keep);
  const cut = tail[0].start;
  const rotated = tail.map((b) => lines.slice(b.start, b.end).map((l) => `${l}\n`).join(""));
  const head = lines.slice(0, cut);
  const rest = lines.slice(guideIdx);
  const keptText = [...head, ...rest].join("\n");
  if (head.map((l) => `${l}\n`).join("") + rotated.join("") + rest.join("\n") !== source) {
    throw new Error("rotate-testruns: internal error - the planned split does not re-assemble the file, refusing to rotate");
  }
  return { keptText, rotated, liveRows: blocks.length, keptRows: keep, rotatedRows: tail.length, headings: tail.map((b) => b.heading) };
}

// A block's lines with "\r" chomped and its trailing blank separator lines
// dropped: the unit an archive stores and compares.
function blockLinesOf(blockText) {
  const lines = String(blockText).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

function archiveHeader(title) {
  return [
    `# ${title}`,
    "",
    "Rows that rotated out of the live region of `TESTRUNS.md` (the dated rows",
    "above its `## Read Before Any Tests` guide, where only the newest rows",
    "stay). `scripts/rotate-testruns.mjs` moves each row here verbatim as one",
    "block - heading, H3 subsections and unheaded paragraphs together - newest",
    "first. The frozen archive below the guide in `TESTRUNS.md` stays there.",
  ];
}

function archiveRows(lines) {
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const line = chomp(lines[i]);
    if (line.startsWith("## ")) heads.push({ i, text: line });
  }
  return heads.map((h, k) => {
    const m = h.text.slice(3).match(ROW_RE);
    return { start: h.i, end: k + 1 < heads.length ? heads[k + 1].i : lines.length, heading: h.text, date: m ? m[1] : null };
  });
}

function mergeArchive(archiveText, blocks, { title = "TESTRUNS.md archive", eol = null } = {}) {
  const creating = archiveText === null || archiveText === undefined;
  const outEol = creating ? (eol === "\r\n" ? "\r\n" : "\n") : eolOf(String(archiveText));
  const cr = outEol === "\r\n" ? "\r" : "";
  let lines = creating ? [...archiveHeader(title).map((l) => l + cr), ""] : String(archiveText).split("\n");
  let added = 0;
  let skipped = 0;
  // Oldest first, each landing above the first archived row with an equal or
  // older date: newer rows stack on top of their day group and a late
  // backfill still finds its newest-first slot.
  for (const blockLines of blocks.map(blockLinesOf).reverse()) {
    if (blockLines.length === 0) continue;
    const heading = blockLines[0];
    const m = heading.startsWith("## ") ? heading.slice(3).match(ROW_RE) : null;
    if (!m) throw new Error(`rotate-testruns: an archived block must start with a dated H2 row heading, got: ${heading.slice(0, 70)}`);
    const rows = archiveRows(lines);
    const same = rows.find((r) => r.heading === heading);
    if (same) {
      // Already archived (a re-run after a crash between the archive write and
      // the TESTRUNS.md write): skip it. The same heading with different text
      // is a real conflict - refused, so neither copy is lost.
      if (blockLinesOf(lines.slice(same.start, same.end).join("\n")).join("\n") === blockLines.join("\n")) {
        skipped++;
        continue;
      }
      throw new Error(`rotate-testruns: "${heading.slice(3, 90)}" is already archived with different content - reconcile the two copies by hand (nothing was written)`);
    }
    const rendered = blockLines.map((l) => l + cr);
    const slot = rows.find((r) => r.date !== null && r.date <= m[1]);
    if (slot) {
      lines = [...lines.slice(0, slot.start), ...rendered, cr, ...lines.slice(slot.start)];
    } else {
      let last = lines.length;
      while (last > 0 && chomp(lines[last - 1]).trim() === "") last--;
      lines = [...lines.slice(0, last), ...(last > 0 ? [cr] : []), ...rendered, ""];
    }
    added++;
  }
  return { text: lines.join("\n"), added, skipped };
}

// Merge row blocks (newest first, one month's worth) into an archive file's
// text, or start one - with a short header - when archiveText is null.
export function mergeIntoArchive(archiveText, blocks, { title, eol } = {}) {
  return mergeArchive(archiveText, blocks, { title, eol }).text;
}

export function archivePathFor(packageRoot, month) {
  return join(packageRoot, "docs", "archive", `testruns-${month}.md`);
}

// Group rotated blocks by the month of their heading date and plan each
// archive file's new text; reads the current archives, writes nothing.
export function planArchives(packageRoot, blocks, { eol = "\n" } = {}) {
  const byMonth = new Map();
  for (const block of blocks) {
    const heading = chomp(String(block).split("\n", 1)[0]);
    const m = heading.startsWith("## ") ? heading.slice(3).match(ROW_RE) : null;
    if (!m) throw new Error(`rotate-testruns: rotated block has no dated H2 heading: ${heading.slice(0, 70)}`);
    const month = m[1].slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(block);
  }
  const plans = [];
  for (const month of [...byMonth.keys()].sort().reverse()) {
    const path = archivePathFor(packageRoot, month);
    const prior = existsSync(path) ? readFileSync(path) : null;
    const merged = mergeArchive(prior === null ? null : prior.toString("utf8"), byMonth.get(month), { title: `TESTRUNS.md archive, ${month}`, eol });
    const changed = prior === null ? merged.added > 0 : merged.text !== prior.toString("utf8");
    plans.push({ path, month, prior, text: merged.text, added: merged.added, skipped: merged.skipped, changed });
  }
  return plans;
}

export function registrationLiterals(text) {
  return new Set(String(text).match(REGISTRATION_RE) ?? []);
}

export function lostRegistrations(before, after) {
  const kept = registrationLiterals(after);
  return [...registrationLiterals(before)].filter((literal) => !kept.has(literal)).sort();
}

// Gate problems carry line numbers that shift when rows leave; compare them
// without, so only a genuinely new problem counts as caused by the rotation.
const problemKey = (p) => p.replace(/^(TESTRUNS\.md):\d+:/, "$1:").replace(/\(first at line \d+\)/, "(first at line N)");

function rotateHeld(packageRoot, { keep, dryRun, replace }) {
  const target = join(packageRoot, "TESTRUNS.md");
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new Error(`rotate-testruns: TESTRUNS.md not found under ${packageRoot}`);
  }
  const raw = readFileSync(target);
  const text = raw.toString("utf8");
  const plan = planRotation(text, { keep });
  const result = { rotated: 0, kept: plan.keptRows, archives: [], skipped: 0, ...(dryRun ? { dryRun: true } : {}) };
  if (plan.rotatedRows === 0) return result;
  const lost = lostRegistrations(text, plan.keptText);
  if (lost.length > 0) {
    throw new Error(
      `rotate-testruns: rotating would drop the last TESTRUNS.md mention of ${lost.join(", ")} (scripts/auditor.mjs and the tools/ contracts look for it there) - register it in the "## Python contracts" table first; nothing was written`
    );
  }
  const archives = planArchives(packageRoot, plan.rotated, { eol: eolOf(text) });
  Object.assign(result, {
    rotated: plan.rotatedRows,
    archives: archives.filter((a) => a.changed).map((a) => a.path),
    skipped: archives.reduce((n, a) => n + a.skipped, 0),
  });
  if (dryRun) return result;
  if (typeof replace !== "function") {
    throw new Error("rotate-testruns: a locked rotation needs the append helper's compare-and-swap writer - pass replace: atomicReplace");
  }
  const before = new Set(auditTestruns(packageRoot).problems.map(problemKey));

  // 1. Archives first: until TESTRUNS.md is swapped the rows exist in both
  // places. If the swap does not happen, the archives written here are put
  // back (undoArchives), so a row that is later edited in TESTRUNS.md never
  // meets a stale archived copy of itself on the next rotation.
  const staged = [];
  const undoArchives = () => {
    const left = [];
    for (const a of staged) {
      try {
        const now = readFileSync(a.path);
        if (!now.equals(Buffer.from(a.text, "utf8"))) {
          left.push(a.path); // someone wrote it since: keep their bytes
          continue;
        }
        if (a.prior === null) unlinkSync(a.path);
        else replace(a.path, a.prior, { expectCurrent: now });
      } catch {
        left.push(a.path);
      }
    }
    return left.length ? ` (could not undo ${left.join(", ")}; a re-run skips identical copies)` : " (archive writes undone)";
  };
  for (const a of archives) {
    if (!a.changed) continue;
    try {
      mkdirSync(dirname(a.path), { recursive: true });
      if (a.prior === null && existsSync(a.path)) throw new Error("the file appeared while rotating");
      replace(a.path, Buffer.from(a.text, "utf8"), { expectCurrent: a.prior });
      staged.push(a);
    } catch (err) {
      const undone = undoArchives();
      throw new Error(`rotate-testruns: could not write ${a.path} - no TESTRUNS.md write performed${undone}: ${err && err.message ? err.message : err}`);
    }
  }

  // 2. TESTRUNS.md, compare-and-swap against the bytes the plan came from.
  const written = Buffer.from(plan.keptText, "utf8");
  try {
    replace(target, written, { expectCurrent: raw });
  } catch (err) {
    let moved = false;
    try {
      moved = !readFileSync(target).equals(raw);
    } catch {
      moved = true;
    }
    const why = moved ? "TESTRUNS.md changed while rotating (a concurrent save) - " : "";
    const undone = undoArchives();
    throw new Error(
      `rotate-testruns: ${why}TESTRUNS.md was not rotated${undone} (${err && err.message ? err.message : err})`
    );
  }

  // 3. The gate must not flag anything the rotation introduced.
  const post = auditTestruns(packageRoot);
  const fresh = post.problems.filter((p) => !before.has(problemKey(p)));
  if (fresh.length > 0) {
    let outcome = "TESTRUNS.md restored to its prior bytes";
    try {
      if (readFileSync(target).equals(written)) {
        replace(target, raw, { expectCurrent: written });
        outcome += undoArchives();
      } else outcome = "TESTRUNS.md changed concurrently, so the live content and the archive were left in place (no destructive rollback)";
    } catch (err) {
      outcome = `restoring TESTRUNS.md failed (${err && err.message ? err.message : err})`;
    }
    const list = fresh.map((p) => `  - ${p}`).join("\n");
    throw new Error(`rotate-testruns: post-rotation gate check failed; ${outcome}:\n${list}`);
  }
  return { ...result, liveRows: post.rows };
}

// Rotate TESTRUNS.md under packageRoot. With locked: true the caller already
// holds the append helper's lock (the helper itself, after an append) and
// passes the helper's atomicReplace as `replace`; the result comes back
// directly. Otherwise the helper's lock is taken here and a Promise of the
// same result is returned.
export function rotateTestruns(packageRoot, { keep = DEFAULT_KEEP, dryRun = false, locked = false, replace = null } = {}) {
  if (locked) return rotateHeld(packageRoot, { keep, dryRun, replace });
  return import("./append-testruns-row.mjs").then(({ atomicReplace, withTestrunsLock }) =>
    withTestrunsLock(join(packageRoot, "TESTRUNS.md"), () => rotateHeld(packageRoot, { keep, dryRun, replace: replace ?? atomicReplace }))
  );
}

const USAGE = `usage: node scripts/rotate-testruns.mjs [--keep N] [--dry-run] [--root <dir>]

  --keep N         live rows to keep in TESTRUNS.md (default: ${DEFAULT_KEEP})
  --dry-run        report what would rotate without writing
  --root <dir>     package root holding TESTRUNS.md (default: this repo)
  --help           this help

Keeps the newest N dated rows in the live region of TESTRUNS.md (the rows
above the "## Read Before Any Tests" guide; the frozen archive below that
anchor is never touched) and moves every older row block verbatim into
docs/archive/testruns-YYYY-MM.md, newest first, under the append helper's
lock. scripts/append-testruns-row.mjs runs this after every append; run it by
hand to preview (--dry-run) or to catch up.`;

export async function main(argv = process.argv.slice(2)) {
  let rootOpt = null;
  let keep = DEFAULT_KEEP;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      return 0;
    }
    if (a === "--root" && i + 1 < argv.length) rootOpt = argv[++i];
    else if (a === "--keep" && i + 1 < argv.length) keep = Number(argv[++i]);
    else if (a === "--dry-run") dryRun = true;
    else {
      console.error(`rotate-testruns: unknown or incomplete argument ${a}\n${USAGE}`);
      return 2;
    }
  }
  if (!Number.isInteger(keep) || keep < 1) {
    console.error(`rotate-testruns: --keep must be a whole number >= 1, got ${keep}`);
    return 2;
  }
  const packageRoot = rootOpt ? resolve(rootOpt) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const res = await rotateTestruns(packageRoot, { keep, dryRun });
    if (res.rotated === 0) {
      console.log(`rotate-testruns: nothing to rotate (${res.kept} live rows, keep ${keep})`);
      return 0;
    }
    const where = res.archives.map((p) => relative(packageRoot, p).split("\\").join("/")).join(", ") || "archives that already hold them";
    const already = res.skipped > 0 ? `, ${res.skipped} already archived` : "";
    console.log(`rotate-testruns: ${dryRun ? "dry-run - would rotate" : "rotated"} ${res.rotated} row(s) into ${where} (${res.kept} live rows kept${already})`);
    return 0;
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().then((code) => process.exit(code));
}
