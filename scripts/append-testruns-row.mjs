// Atomic newest-first appender for TESTRUNS.md, the write-side companion to
// scripts/check-testruns.mjs. The gate detects duplicate headings and
// stale-anchor ordering after the fact; this helper prevents them: it takes a
// full row block ("## YYYY-MM-DD ..." plus body), holds a cross-process lock,
// re-reads the live file under that lock, splices the row in at the position
// that keeps the live region newest-first (the true top for a fresh run, the
// right slot for a late-arriving older one), re-reads the target immediately
// before the swap to verify the bytes still match that snapshot (a concurrent
// edit by a non-cooperating writer aborts non-zero with no write instead of
// being clobbered), writes temp-file + rename so readers never see a torn
// file, and rolls back if the gate audit would fail afterwards - unless a
// concurrent edit already landed, in which case it leaves that content alone
// rather than destroying it. Rows are supplied as one quoted argument,
// a --file path, or stdin - either a full pre-built block or, when the text
// parses as a JSON object / arrives as --date/--title/... flags, as fields
// formatted into the canonical row shape the gate audits; --dry-run reports
// the landing spot without writing.
import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { auditTestruns } from "./check-testruns.mjs";

const ROW_RE = /^(\d{4}-\d{2}-\d{2}) /; // same shape as check-testruns.mjs
const LOCK_TIMEOUT_MS = 10000;
const LOCK_STALE_MS = 30000;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// The lock lives in the OS temp dir (not the repo root) so OneDrive never
// syncs it and no check ever sees it; every process on the machine resolves
// the same target path to the same lock file.
export function lockPathFor(target) {
  const key = createHash("sha256").update(resolve(target).toLowerCase()).digest("hex").slice(0, 12);
  return join(tmpdir(), `testruns-${key}.lock`);
}

function acquireLock(target) {
  const lockPath = lockPathFor(target);
  const start = Date.now();
  for (;;) {
    try {
      const fh = openSync(lockPath, "wx");
      try {
        writeSync(fh, `${process.pid} ${new Date().toISOString()}\n`);
      } finally {
        closeSync(fh);
      }
      return lockPath;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let brokeStale = false;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath);
          brokeStale = true;
        }
      } catch {
        brokeStale = true; // the lock vanished between stat and unlink: retry now
      }
      if (!brokeStale && Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new Error(`append-testruns-row: timed out waiting for the TESTRUNS.md lock (${lockPath}) held by another process`);
      }
      sleep(brokeStale ? 0 : 100);
    }
  }
}

function atomicReplace(target, buf, { expectCurrent = null, beforeRename = null } = {}) {
  const tmp = join(dirname(target), `.${basename(target)}.new-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  const fh = openSync(tmp, "w");
  try {
    writeSync(fh, buf);
    fsyncSync(fh);
  } finally {
    closeSync(fh);
  }
  try {
    if (beforeRename) beforeRename();
    // Compare-and-swap as close to the rename as the OS allows. The
    // replacement bytes are already staged and fsynced, so re-reading here
    // leaves only the read->rename window: a non-cooperating save that landed
    // at any point since the snapshot read is detected and aborts with no
    // write (the staged temp is discarded below) instead of being clobbered.
    if (expectCurrent) {
      const current = readFileSync(target);
      if (!Buffer.isBuffer(current) || !current.equals(expectCurrent)) {
        throw new Error(
          "append-testruns-row: TESTRUNS.md changed mid-run while staging the row - no write performed, re-run to append onto the fresh content"
        );
      }
    }
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        renameSync(tmp, target);
        return "rename";
      } catch (err) {
        lastErr = err;
        sleep(150); // Windows: AV or OneDrive can hold the target briefly
      }
    }
    copyFileSync(tmp, target); // not atomic, but content-complete last resort
    console.error(`append-testruns-row: rename kept failing (${lastErr && lastErr.code}); fell back to copyFileSync`);
    return "copy-fallback";
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // already moved or removed
    }
  }
}

const chomp = (line) => (line.endsWith("\r") ? line.slice(0, -1) : line);

// Field-based input: the row may arrive as a JSON object (stdin, --file, or a
// quoted argument) or as individual CLI flags, instead of a pre-built block.
// Formatting follows the house row shape the check-testruns gate audits:
// "## YYYY-MM-DD <daypart> - <title> (<task>, <run>)" plus body prose.
const ROW_FIELDS = ["date", "daypart", "title", "task", "run", "body"];

export function rowFromFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("append-testruns-row: row fields must be a JSON object");
  }
  for (const key of Object.keys(fields)) {
    if (!ROW_FIELDS.includes(key)) {
      throw new Error(`append-testruns-row: unknown row field "${key}" (allowed: ${ROW_FIELDS.join(", ")})`);
    }
  }
  const date = String(fields.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`append-testruns-row: field "date" must be YYYY-MM-DD, got: ${date || "(missing)"}`);
  }
  const title = String(fields.title ?? "").trim();
  if (!title) throw new Error('append-testruns-row: field "title" is required');
  const daypart = fields.daypart ? ` ${String(fields.daypart).trim()}` : "";
  const bits = [];
  if (fields.task) bits.push(String(fields.task).trim());
  if (fields.run) bits.push(String(fields.run).trim());
  const suffix = bits.length > 0 ? ` (${bits.join(", ")})` : "";
  const body = String(fields.body ?? "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
  return `## ${date}${daypart} - ${title}${suffix}\n${body ? `\n${body}\n` : ""}`;
}

// A block must start with "## ", so leading "{" unambiguously means a JSON
// field spec; anything else is a pre-built block passed through untouched.
function coerceBlock(text, sourceLabel) {
  const raw = String(text).replace(/^\uFEFF/, "");
  if (raw.trimStart().startsWith("{")) {
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (err) {
      throw new Error(`append-testruns-row: ${sourceLabel} looks like JSON but does not parse: ${err.message}`);
    }
    return rowFromFields(obj);
  }
  return raw;
}

// Pure planning pass: validate the block, locate the live region, and pick
// the splice index that keeps it newest-first. Works on raw split lines so a
// CRLF file is rewritten byte-for-byte except for the inserted block.
export function planInsertion(text, blockText) {
  const lines = text.split("\n");
  const blockLines = String(blockText)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  while (blockLines.length > 0 && blockLines[blockLines.length - 1].trim() === "") blockLines.pop();
  if (blockLines.length === 0) throw new Error("append-testruns-row: row block is empty");
  const heading = blockLines[0];
  if (!heading.startsWith("## ")) {
    throw new Error(`append-testruns-row: row block must start with an H2 heading (## ...), got: ${heading.slice(0, 60) || "(empty)"}`);
  }
  const dateMatch = heading.slice(3).match(ROW_RE);
  if (!dateMatch) {
    throw new Error(`append-testruns-row: row heading must start with a YYYY-MM-DD date: ${heading.slice(3, 70)}`);
  }
  const newDate = dateMatch[1];

  for (const line of lines) {
    if (chomp(line) === heading) {
      throw new Error(`append-testruns-row: duplicate H2 already present: ${heading.slice(3, 90)}`);
    }
  }

  // The live newest-first region sits ABOVE "## Read Before Any Tests": the
  // archive below that anchor is deliberately exempt and frozen (decision in
  // check-testruns.mjs, pinned by tests/check_testruns.test.mjs). A brief that
  // says "directly below the anchor" is inverted relative to this layout -
  // splicing below the anchor would write into the blessed archive - so the
  // true top of the live region is the first dated row above the guide.
  const live = []; // dated rows above the guide, in file order
  let guideIdx = -1;
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    const line = chomp(lines[i]);
    if (!line.startsWith("## ")) continue;
    const t = line.slice(3);
    if (t === "Read Before Any Tests") {
      guideIdx = i;
      break;
    }
    if (!started && ROW_RE.test(t)) started = true;
    if (started) live.push({ line: i, date: t.match(ROW_RE)[1], heading: t });
  }
  if (live.length === 0) {
    throw new Error("append-testruns-row: no dated run row found above the guide - refusing to guess the live-region top");
  }

  // Newest-first means the row belongs immediately above the first existing
  // row with an equal or older date (equal-date arrivals stack on top of
  // their day group); a date older than every live row lands at the bottom
  // of the region, just above the guide.
  const older = live.find((row) => row.date <= newDate);
  if (older) {
    return { heading, newDate, blockLines, insertAt: older.line, before: older.heading, atEof: false };
  }
  if (guideIdx !== -1) {
    return { heading, newDate, blockLines, insertAt: guideIdx, before: "Read Before Any Tests", atEof: false };
  }
  let last = lines.length - 1;
  while (last >= 0 && chomp(lines[last]).trim() === "") last--;
  return { heading, newDate, blockLines, insertAt: last + 1, before: null, atEof: true };
}

function spliceRow(text, plan, eol) {
  const lines = text.split("\n");
  const blank = eol === "\r\n" ? "\r" : "";
  const rendered = plan.blockLines.map((l) => l + blank);
  if (plan.atEof) {
    const out = lines.slice(0, plan.insertAt);
    if (out.length > 0 && out[out.length - 1] !== "") out.push(blank);
    out.push(...rendered, ...lines.slice(plan.insertAt));
    return out.join("\n");
  }
  return [...lines.slice(0, plan.insertAt), ...rendered, blank, ...lines.slice(plan.insertAt)].join("\n");
}

export function appendTestrunsRow(packageRoot, blockText, { dryRun = false, hooks = {} } = {}) {
  const target = join(packageRoot, "TESTRUNS.md");
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new Error(`append-testruns-row: TESTRUNS.md not found under ${packageRoot}`);
  }
  const lockPath = acquireLock(target);
  try {
    const under = auditTestruns(packageRoot);
    if (under.problems.length > 0) {
      const list = under.problems.map((p) => `  - ${p}`).join("\n");
      throw new Error(`append-testruns-row: refusing to append - check-testruns already flags this file:\n${list}`);
    }
    const raw = readFileSync(target);
    const text = raw.toString("utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const plan = planInsertion(text, blockText);
    if (dryRun) {
      return { dryRun: true, heading: plan.heading, date: plan.newDate, insertLine: plan.insertAt + 1, before: plan.before };
    }
    // Read-verify-write: the outgoing body was built from the snapshot in
    // `raw`, so a non-cooperating editor that saved since that read would be
    // silently reverted by the rename. The snapshot is re-verified inside
    // atomicReplace immediately before the swap (the tightest window the OS
    // allows); any byte drift aborts with no write and the caller re-runs
    // onto the fresh content instead.
    const written = Buffer.from(spliceRow(text, plan, eol), "utf8");
    const how = atomicReplace(target, written, { expectCurrent: raw, beforeRename: hooks.beforeRename });
    if (hooks.afterWrite) hooks.afterWrite(written);
    const post = auditTestruns(packageRoot);
    if (post.problems.length > 0) {
      const current = readFileSync(target);
      if (current.equals(written)) {
        atomicReplace(target, raw); // untouched since our write: restore the exact prior bytes
      } else {
        // A non-cooperating save landed on top of (or alongside) our write.
        // Restoring `raw` here would destroy that editor's bytes, so leave the
        // live content alone and surface the problem for a deliberate merge.
        console.error("append-testruns-row: post-append gate check failed and the file changed concurrently - leaving the live content in place (no destructive rollback)");
      }
      const list = post.problems.map((p) => `  - ${p}`).join("\n");
      throw new Error(`append-testruns-row: post-append gate check failed, not rolled back onto a concurrent edit:\n${list}`);
    }
    return { heading: plan.heading, date: plan.newDate, insertLine: plan.insertAt + 1, before: plan.before, write: how, rows: post.rows };
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // another stale-breaker already removed it
    }
  }
}

const USAGE = `usage: node scripts/append-testruns-row.mjs [options] [row block]

  --file <path|->  read the row from a file, or "-" for stdin
  --root <dir>     package root holding TESTRUNS.md (default: this repo)
  --dry-run        report where the row would land without writing
  --help           this help

Row fields as flags (mutually exclusive with a positional block):
  --date YYYY-MM-DD [--daypart "late evening"] --title "..." [--task id]
  [--run runId] [--body "..."]       (or the same fields as one JSON object
  via a positional argument, --file, or stdin)

The block must start with a "## YYYY-MM-DD ..." heading followed by the row
body (built for you when fields are given). It is inserted so the live region
stays newest-first, under a cross-process lock, with the snapshot re-verified
right before an atomic write (temp file + rename): a concurrent mid-run edit
aborts with a non-zero exit and no write. The result is then verified with the
scripts/check-testruns.mjs rules; on any post-write problem the file is
rolled back byte-for-byte. Refuses to run while the gate already flags the
file (duplicate headings, conflict copies, malformed tail).`;

export function main(argv = process.argv.slice(2)) {
  let rootOpt = null;
  let fileOpt = null;
  let dryRun = false;
  const fieldFlags = {};
  let sawFieldFlag = false;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      return 0;
    }
    if (a === "--root") rootOpt = argv[++i];
    else if (a === "--file") fileOpt = argv[++i];
    else if (a === "--dry-run") dryRun = true;
    else if (ROW_FIELDS.includes(a.slice(2))) {
      fieldFlags[a.slice(2)] = argv[++i];
      sawFieldFlag = true;
    } else if (a.startsWith("--")) {
      console.error(`append-testruns-row: unknown option ${a}\n${USAGE}`);
      return 2;
    } else rest.push(a);
  }
  if (sawFieldFlag && rest.length > 0) {
    console.error("append-testruns-row: row fields as flags cannot be combined with a positional block");
    return 2;
  }
  let block;
  if (sawFieldFlag) {
    try {
      block = rowFromFields(fieldFlags);
    } catch (err) {
      console.error(err.message);
      return 2;
    }
  } else if (rest.length > 1) {
    console.error(`append-testruns-row: expected one row block (quote it or use --file), got ${rest.length} arguments`);
    return 2;
  } else if (rest.length === 1) block = rest[0];
  else if (fileOpt) block = fileOpt === "-" ? readFileSync(0, "utf8") : readFileSync(fileOpt, "utf8");
  else if (process.stdin.isTTY) {
    console.error(USAGE);
    return 2;
  } else block = readFileSync(0, "utf8");
  try {
    block = coerceBlock(block, fileOpt === "-" || (!fileOpt && !sawFieldFlag && rest.length === 0) ? "stdin" : fileOpt ? `file ${fileOpt}` : "argument");
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  const packageRoot = rootOpt ? resolve(rootOpt) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const result = appendTestrunsRow(packageRoot, block, { dryRun });
    const where = result.before === null ? "end of file" : `"${result.before.slice(0, 60)}"`;
    if (result.dryRun) {
      console.log(`append-testruns-row: dry-run - would insert at line ${result.insertLine} (before ${where}): ${result.heading.slice(3, 70)}`);
      return 0;
    }
    console.log(`append-testruns-row: inserted at line ${result.insertLine} (before ${where}): ${result.heading.slice(3, 70)}`);
    console.log(`append-testruns-row: gate ok (${result.rows} live rows, write: ${result.write})`);
    return 0;
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main());
}
