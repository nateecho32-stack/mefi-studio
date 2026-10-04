// Attempt snapshots: the names, rules and parsers behind Changed files, Accept
// and Revert (docs/architecture.md "Attempt review"). At the start and at the
// end of every builder attempt Studio keeps a picture of the folder the run
// works in as a git commit that only a private ref points at:
//
//   refs/mefi/attempts/<task>/<n>/before             the folder when the run started
//   refs/mefi/attempts/<task>/<n>/after              the folder when it ended
//   refs/mefi/attempts/<task>/<n>/reverted-<time>    the folder just before a revert
//
// The files that changed are then read from git, so the list looks the same
// whichever builder did the work. This module holds everything that needs no
// machine: how a ref is named, how a commit message carries its facts, which
// files a snapshot leaves out (too big, too many), how git's raw diff, numstat
// and diff text read, which attempts to prune, and what a revert may touch and
// why it refuses. scripts/attempt-snapshots-host.cjs runs git and writes files.
//
// Pure module: no Electron, no filesystem, no network, no processes, no
// timers, no clock reads (time is injected).
//
// The refs are local. Nothing in Studio pushes them: every push names one
// branch, and a mirror or `--all` push would not carry refs/mefi either unless
// the owner sets it up on purpose. They never enter a problem report.
"use strict";

const NAMESPACE = "refs/mefi/attempts";
// Newest attempts kept per task, and newest tasks kept, so the refs stay a small set.
const KEEP_ATTEMPTS = 20;
const KEEP_TASKS = 300;
const MIB = 1024 * 1024;
const LIMITS = Object.freeze({
  // A file bigger than this is not copied into a snapshot, whatever it holds.
  textBytes: 5 * MIB,
  // A binary file (an image, an archive) counts against a smaller cap: nobody reads its diff.
  binaryBytes: 2 * MIB,
  // The new content one snapshot may add. Past it, the rest are left out and named.
  totalBytes: 64 * MIB,
  // More files than this changed or new at once: no snapshot, the folder is not a working tree to look at.
  candidates: 20000,
  // Left-out files named in a snapshot's message and in the answer.
  skippedListed: 50,
  // Files one answer lists (the totals always cover every file).
  listedFiles: 1000,
  // One file's diff: bytes and lines handed to the page.
  diffBytes: 200 * 1024,
  diffLines: 2500,
  // Files one revert may put back.
  revertFiles: 2000,
  // Paths kept in a revert receipt so the revert can be undone.
  receiptPaths: 500,
  pathChars: 1024,
});

// ---- names --------------------------------------------------------------------

// A task id becomes one path part of a ref: letters, digits, "_" and "-" stay,
// anything else is written as %xx of its UTF-8 bytes (so two ids never share a
// name, and a ref never holds a character git or Windows refuses). An id that
// is empty or would run past 120 characters has no snapshots.
function taskKey(taskId) {
  if (typeof taskId !== "string" || !taskId || taskId.length > 200) return null;
  let key = "";
  for (const byte of Buffer.from(taskId, "utf8")) {
    const char = String.fromCharCode(byte);
    key += /[A-Za-z0-9_-]/.test(char) ? char : `%${byte.toString(16).padStart(2, "0")}`;
  }
  return key.length <= 120 ? key : null;
}

// The run id is a flat token (executor-worktrees.cjs uses the same rule).
const safeRunId = (runId) => (typeof runId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(runId) ? runId : null);
const wholeNumber = (value) => (Number.isSafeInteger(value) && value >= 1 && value <= 999999 ? value : null);

// 20260930T151203123Z: sorts as time sorts and holds nothing git refuses in a ref.
function stampOf(ms) {
  const date = new Date(Number(ms));
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(".", "");
}

const PHASES = Object.freeze(["before", "after"]);

// The ref for an attempt's snapshot: phase "before", "after", or "reverted"
// with the stamp of the revert. Null when any part would not make a good ref.
function refName(taskId, n, phase, stamp = null) {
  const key = taskKey(taskId);
  const number = wholeNumber(n);
  if (!key || !number) return null;
  if (phase === "before" || phase === "after") return `${NAMESPACE}/${key}/${number}/${phase}`;
  if (phase === "reverted" && typeof stamp === "string" && /^\d{8}T\d{9}Z$/.test(stamp)) return `${NAMESPACE}/${key}/${number}/reverted-${stamp}`;
  return null;
}

// What `git for-each-ref` is asked for: enough to rebuild the attempt list without reading a commit.
const LIST_FORMAT = "%(refname)%09%(objectname)%09%(committerdate:unix)%09%(contents:subject)";

// One attempt snapshot's subject line: what a listing shows without opening the message.
function subjectOf({ n, phase, runId, stamp = null }) {
  return `Mefi attempt ${n} ${phase === "reverted" ? `reverted ${stamp}` : phase}: ${runId || "unknown run"}`;
}

const REF_ROW = /^refs\/mefi\/attempts\/([^/]+)\/(\d{1,6})\/(before|after|reverted-(\d{8}T\d{9}Z))$/;

// Rows of LIST_FORMAT, one per ref, as { ref, key, n, kind, stamp, sha, at, runId }.
function parseRefs(text) {
  const rows = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line) continue;
    const [ref, sha, unix, ...subject] = line.split("\t");
    const found = REF_ROW.exec(ref ?? "");
    if (!found || !/^[0-9a-f]{40,64}$/.test(sha ?? "")) continue;
    const runId = /: (\S+)$/.exec(subject.join("\t"))?.[1] ?? null;
    rows.push({ ref, key: found[1], n: Number(found[2]), kind: found[3].startsWith("reverted") ? "reverted" : found[3], stamp: found[4] ?? null, sha, at: (Number(unix) || 0) * 1000, runId: runId && runId !== "unknown" ? runId : null });
  }
  return rows;
}

// One task's rows as attempts, newest first: { n, runId, before, after, reverts: [...] }.
function attemptsOf(rows, key) {
  const byNumber = new Map();
  for (const row of rows) {
    if (row.key !== key) continue;
    const attempt = byNumber.get(row.n) ?? { n: row.n, runId: null, before: null, after: null, reverts: [] };
    if (row.kind === "before") attempt.before = row;
    else if (row.kind === "after") attempt.after = row;
    else attempt.reverts.push(row);
    attempt.runId = attempt.runId ?? row.runId;
    byNumber.set(row.n, attempt);
  }
  return [...byNumber.values()]
    .map((attempt) => ({ ...attempt, reverts: attempt.reverts.sort((a, b) => b.at - a.at || (a.stamp < b.stamp ? 1 : -1)), startedAt: attempt.before?.at ?? attempt.after?.at ?? 0, endedAt: attempt.after?.at ?? null }))
    .sort((a, b) => b.n - a.n);
}

// The number a new attempt of this task takes: one past the highest one any ref or evidence folder holds.
function nextAttempt(...numberLists) {
  let top = 0;
  for (const list of numberLists) for (const value of list ?? []) if (Number.isSafeInteger(value) && value > top) top = value;
  return top + 1;
}

// Refs to delete so that each task keeps its newest `keep` attempts and only
// the `keepTasks` most recently touched tasks keep any.
function prunePlan(rows, { keep = KEEP_ATTEMPTS, keepTasks = KEEP_TASKS } = {}) {
  const tasks = new Map();
  for (const row of rows) {
    const held = tasks.get(row.key) ?? { key: row.key, at: 0, rows: [] };
    held.at = Math.max(held.at, row.at);
    held.rows.push(row);
    tasks.set(row.key, held);
  }
  const doomed = [];
  const ordered = [...tasks.values()].sort((a, b) => b.at - a.at || (a.key < b.key ? -1 : 1));
  ordered.forEach((task, index) => {
    if (index >= keepTasks) { doomed.push(...task.rows.map((row) => row.ref)); return; }
    const numbers = [...new Set(task.rows.map((row) => row.n))].sort((a, b) => b - a);
    const keepNumbers = new Set(numbers.slice(0, Math.max(1, keep)));
    doomed.push(...task.rows.filter((row) => !keepNumbers.has(row.n)).map((row) => row.ref));
  });
  return doomed;
}

// ---- the message a snapshot commit carries -----------------------------------------

const encode = (value) => encodeURIComponent(String(value ?? ""));
const decode = (value) => { try { return decodeURIComponent(value); } catch { return String(value); } };

// The commit message: a subject, then trailer lines. Paths are percent-encoded so a name with a line break cannot break a line.
function messageOf({ taskId, n, phase, runId, at, worktree = false, overlap = [], skipped = [], skippedCount = null, paths = [], stamp = null }) {
  const lines = [subjectOf({ n, phase, runId, stamp }), ""];
  const add = (key, value) => lines.push(`Mefi-${key}: ${value}`);
  add("Snapshot", phase);
  add("Task", encode(taskId));
  add("Attempt", n);
  add("Run", runId || "unknown");
  add("At", new Date(Number(at) || 0).toISOString());
  add("Worktree", worktree ? "yes" : "no");
  const others = (Array.isArray(overlap) ? overlap : []).map(safeRunId).filter(Boolean).slice(0, 20);
  if (others.length) add("Overlap", others.join(","));
  const left = (Array.isArray(skipped) ? skipped : []).slice(0, LIMITS.skippedListed);
  add("Skipped", Number.isFinite(skippedCount) ? skippedCount : left.length);
  for (const row of left) add("Skipped-File", `${row.reason} ${Number(row.size) || 0} ${encode(row.path)}`);
  for (const path of (Array.isArray(paths) ? paths : []).slice(0, LIMITS.receiptPaths)) add("Path", encode(path));
  return `${lines.join("\n")}\n`;
}

function parseMessage(text) {
  const facts = { phase: null, taskId: null, n: null, runId: null, at: null, worktree: false, overlap: [], skipped: [], skippedCount: 0, paths: [] };
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const found = /^Mefi-([A-Za-z-]+): (.*)$/.exec(line);
    if (!found) continue;
    const [, key, value] = found;
    if (key === "Snapshot") facts.phase = value;
    else if (key === "Task") facts.taskId = decode(value);
    else if (key === "Attempt") facts.n = wholeNumber(Number(value));
    else if (key === "Run") facts.runId = value === "unknown" ? null : safeRunId(value);
    else if (key === "At") facts.at = Date.parse(value) || null;
    else if (key === "Worktree") facts.worktree = value === "yes";
    else if (key === "Overlap") facts.overlap = value.split(",").map(safeRunId).filter(Boolean);
    else if (key === "Skipped") facts.skippedCount = Number(value) || 0;
    else if (key === "Skipped-File") {
      const part = /^(\S+) (\d+) (.*)$/.exec(value);
      if (part) facts.skipped.push({ reason: part[1], size: Number(part[2]), path: decode(part[3]) });
    } else if (key === "Path") facts.paths.push(decode(value));
  }
  return facts;
}

// ---- which files a snapshot leaves out ------------------------------------------------

// `candidates` are the files a snapshot would have to copy in: new ones and
// changed ones ({ path, size, binary }), stat'ed by the host. Everything else
// git already holds. Returns the paths to leave out and why; when there are too
// many candidates the snapshot is not made at all.
function planSnapshot(candidates, limits = LIMITS) {
  const list = (Array.isArray(candidates) ? candidates : []).filter((item) => item && typeof item.path === "string" && item.path);
  if (list.length > limits.candidates) return { tooMany: true, count: list.length, leaveOut: [], skipped: [], skippedCount: 0 };
  const skipped = [];
  let used = 0;
  for (const item of [...list].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const size = Math.max(0, Number(item.size) || 0);
    if (item.path.length > limits.pathChars) { skipped.push({ path: item.path, size, reason: "long-name" }); continue; }
    if (item.binary ? size > limits.binaryBytes : size > limits.textBytes) { skipped.push({ path: item.path, size, reason: item.binary ? "binary-too-large" : "too-large" }); continue; }
    if (used + size > limits.totalBytes) { skipped.push({ path: item.path, size, reason: "over-budget" }); continue; }
    used += size;
  }
  return { tooMany: false, count: list.length, leaveOut: skipped.map((row) => row.path), skipped: skipped.slice(0, limits.skippedListed), skippedCount: skipped.length, bytes: used };
}

// The pathspec `git add -A --pathspec-from-file` reads: everything, minus the left-out files (each taken literally).
function addPathspec(leaveOut) {
  return [".", ...(Array.isArray(leaveOut) ? leaveOut : []).map((path) => `:(exclude,literal)${path}`)].map((entry) => `${entry}\0`).join("");
}

const SKIP_WORDS = Object.freeze({
  "too-large": "too large to keep a copy of",
  "binary-too-large": "a binary file too large to keep a copy of",
  "over-budget": "left out to keep the snapshot small",
  "long-name": "a name too long to keep",
});

function skippedSentence(skipped, count = null) {
  const rows = Array.isArray(skipped) ? skipped : [];
  const total = Number.isFinite(count) ? Math.max(count, rows.length) : rows.length;
  if (!total) return "";
  const names = rows.slice(0, 3).map((row) => row.path).join(", ");
  const more = total > Math.min(rows.length, 3) ? ` and ${total - Math.min(rows.length, 3)} more` : "";
  return `${total === 1 ? "1 file was" : `${total} files were`} left out of the snapshot (${names}${more}): too large to keep a copy of, so ${total === 1 ? "it is" : "they are"} not listed and cannot be reverted.`;
}

// ---- reading git's answers ---------------------------------------------------------------

const MODE_KIND = (mode) => (mode === "120000" ? "symlink" : mode === "160000" ? "submodule" : "file");

// `git diff --raw -z -M --no-abbrev A B`: records ":old new oldsha newsha S[score]" NUL path [NUL path2].
function parseRaw(text) {
  const parts = String(text ?? "").split("\0");
  const rows = [];
  for (let index = 0; index < parts.length; index += 1) {
    const head = /^:(\d{6}) (\d{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])(\d*)$/.exec(parts[index]);
    if (!head) continue;
    const [, oldMode, newMode, oldBlob, newBlob, letter, score] = head;
    const renamed = letter === "R" || letter === "C";
    const path = parts[index + (renamed ? 2 : 1)];
    const oldPath = renamed ? parts[index + 1] : null;
    index += renamed ? 2 : 1;
    if (typeof path !== "string" || !path) continue;
    const zero = /^0+$/;
    rows.push({
      status: letter === "A" ? "added" : letter === "D" ? "deleted" : letter === "R" ? "renamed" : "modified",
      path, oldPath: letter === "R" ? oldPath : null,
      oldMode, newMode,
      oldBlob: zero.test(oldBlob) ? null : oldBlob,
      newBlob: zero.test(newBlob) ? null : newBlob,
      typeChanged: letter === "T", score: score ? Number(score) : null,
      kind: MODE_KIND(zero.test(newBlob) ? oldMode : newMode),
    });
  }
  return rows;
}

// `git diff --numstat -z -M A B`: "add TAB del TAB path" NUL, or for a rename "add TAB del TAB" NUL old NUL new NUL.
function parseNumstat(text) {
  const parts = String(text ?? "").split("\0");
  const stats = new Map();
  for (let index = 0; index < parts.length; index += 1) {
    const found = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(parts[index]);
    if (!found) continue;
    const binary = found[1] === "-" || found[2] === "-";
    let path = found[3];
    if (!path) { path = parts[index + 2]; index += 2; }
    if (path) stats.set(path, { additions: binary ? 0 : Number(found[1]), deletions: binary ? 0 : Number(found[2]), binary });
  }
  return stats;
}

// The change set: raw entries with their line counts, sorted by path.
function changeSet(rawText, numstatText) {
  const stats = parseNumstat(numstatText);
  return parseRaw(rawText)
    .map((entry) => ({ ...entry, ...(stats.get(entry.path) ?? { additions: 0, deletions: 0, binary: false }) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function totalsOf(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return {
    files: list.length,
    additions: list.reduce((sum, entry) => sum + (entry.additions || 0), 0),
    deletions: list.reduce((sum, entry) => sum + (entry.deletions || 0), 0),
    binary: list.filter((entry) => entry.binary).length,
  };
}

// What the page needs of one entry: names split into folder and file, no blob ids.
function publicEntry(entry, state = null) {
  const cut = entry.path.lastIndexOf("/");
  return {
    path: entry.path, dir: cut >= 0 ? entry.path.slice(0, cut + 1) : "", name: cut >= 0 ? entry.path.slice(cut + 1) : entry.path,
    oldPath: entry.oldPath ?? null, status: entry.status, additions: entry.additions ?? 0, deletions: entry.deletions ?? 0, binary: Boolean(entry.binary),
    kind: entry.kind ?? "file", ...(state ? { state } : {}),
  };
}

// A unified diff for one file, as lines a page can draw: { k: "h" | "+" | "-" | " ", t, a, b } with the old and new line numbers.
function parseDiff(text, { maxLines = LIMITS.diffLines, maxBytes = LIMITS.diffBytes } = {}) {
  const source = String(text ?? "");
  let truncated = source.length > maxBytes;
  const lines = [];
  let binary = false;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of (truncated ? source.slice(0, maxBytes) : source).split("\n")) {
    if (/^Binary files .* differ$|^GIT binary patch/.test(line)) { binary = true; continue; }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) { oldNo = Number(hunk[1]); newNo = Number(hunk[2]); inHunk = true; if (lines.length >= maxLines) { truncated = true; break; } lines.push({ k: "h", t: line }); continue; }
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    const mark = line[0];
    if (mark !== "+" && mark !== "-" && mark !== " ") continue;
    if (lines.length >= maxLines) { truncated = true; break; }
    if (mark === "+") { lines.push({ k: "+", t: line.slice(1), b: newNo }); newNo += 1; }
    else if (mark === "-") { lines.push({ k: "-", t: line.slice(1), a: oldNo }); oldNo += 1; }
    else { lines.push({ k: " ", t: line.slice(1), a: oldNo, b: newNo }); oldNo += 1; newNo += 1; }
  }
  return { binary, lines, truncated };
}

// ---- paths the host may write ---------------------------------------------------------------

// A path from git that is safe to join under the project folder: relative, no
// ".." or ".git" part, no drive letter or stream name, nothing Windows trims.
function safeRelative(path) {
  if (typeof path !== "string" || !path || path.length > LIMITS.pathChars) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes(":") || /[\0\r\n]/.test(path)) return false;
  return path.split("/").every((part) => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git" && !/[. ]$/.test(part));
}

// ---- what a revert may do ---------------------------------------------------------------------

const same = (a, b) => (a ?? null) === (b ?? null);

// Puts files back to how the attempt found them, and only those:
//   - only paths in the attempt's own change set (before -> after) are ever named;
//   - a file is written back only while it still holds what the attempt left
//     (its `after` content). One that was edited since is refused, and named;
//   - a file already as it was before the attempt needs nothing;
//   - a file the attempt added is removed, but only while it is still the copy the attempt left;
//   - a rename is undone both ways: the new name goes, the old one comes back.
// `entries`: the change set. `current[path]`: { blob } for what the folder holds now (blob null = no file).
// A whole-attempt revert with any refused file changes nothing (`partial: true` puts back the rest).
function planRevert({ entries, scope, path = null, current = {}, partial = false, symlinks = false, limits = LIMITS } = {}) {
  const set = Array.isArray(entries) ? entries : [];
  const now = (name) => (current && Object.hasOwn(current, name) ? current[name]?.blob ?? null : undefined);
  let chosen = set;
  if (scope === "file") {
    chosen = set.filter((entry) => entry.path === path || entry.oldPath === path);
    if (!chosen.length) return { ok: false, restore: [], already: [], refused: [{ path: String(path ?? ""), reason: "not-in-attempt" }], message: "That file is not part of this attempt, so Studio leaves it alone." };
  } else if (scope !== "attempt") {
    return { ok: false, restore: [], already: [], refused: [], message: "Choose one file or the whole attempt." };
  }
  if (chosen.length > limits.revertFiles) return { ok: false, restore: [], already: [], refused: [{ path: "", reason: "too-many" }], message: `This attempt changed ${chosen.length} files, more than Studio puts back at once. Revert it in Git instead.` };
  const restore = [];
  const already = [];
  const refused = [];
  const unsupported = (entry) => entry.kind === "submodule" || (entry.kind === "symlink" && !symlinks) || entry.typeChanged;
  for (const entry of chosen) {
    if (unsupported(entry)) { refused.push({ path: entry.path, reason: "unsupported", detail: entry.kind === "submodule" ? "a submodule" : entry.typeChanged ? "its type changed" : "a symbolic link" }); continue; }
    for (const name of [entry.path, entry.oldPath].filter(Boolean)) if (!safeRelative(name)) { refused.push({ path: name, reason: "unsafe-name" }); }
    if ([entry.path, entry.oldPath].filter(Boolean).some((name) => !safeRelative(name))) continue;
    const mode = entry.oldMode === "100755" ? 0o755 : 0o644;
    if (entry.status === "added") {
      const held = now(entry.path);
      if (held === undefined) { refused.push({ path: entry.path, reason: "unknown" }); continue; }
      if (held === null) already.push(entry.path);
      else if (same(held, entry.newBlob)) restore.push({ path: entry.path, action: "delete" });
      else refused.push({ path: entry.path, reason: "changed-since" });
    } else if (entry.status === "deleted") {
      const held = now(entry.path);
      if (held === undefined) { refused.push({ path: entry.path, reason: "unknown" }); continue; }
      if (held === null) restore.push({ path: entry.path, action: "write", blob: entry.oldBlob, mode });
      else if (same(held, entry.oldBlob)) already.push(entry.path);
      else refused.push({ path: entry.path, reason: "changed-since" });
    } else if (entry.status === "renamed") {
      const heldNew = now(entry.path);
      const heldOld = now(entry.oldPath);
      if (heldNew === undefined || heldOld === undefined) { refused.push({ path: entry.path, reason: "unknown" }); continue; }
      const newFine = heldNew === null || same(heldNew, entry.newBlob);
      const oldFine = heldOld === null || same(heldOld, entry.oldBlob);
      if (!newFine) refused.push({ path: entry.path, reason: "changed-since" });
      if (!oldFine) refused.push({ path: entry.oldPath, reason: "changed-since" });
      if (!newFine || !oldFine) continue;
      if (heldNew === null && same(heldOld, entry.oldBlob)) { already.push(entry.path); continue; }
      if (heldOld === null) restore.push({ path: entry.oldPath, action: "write", blob: entry.oldBlob, mode });
      if (heldNew !== null) restore.push({ path: entry.path, action: "delete" });
    } else {
      const held = now(entry.path);
      if (held === undefined) { refused.push({ path: entry.path, reason: "unknown" }); continue; }
      if (same(held, entry.oldBlob) && !same(entry.oldBlob, entry.newBlob)) already.push(entry.path);
      else if (same(held, entry.newBlob)) restore.push({ path: entry.path, action: "write", blob: entry.oldBlob, mode });
      else refused.push({ path: entry.path, reason: "changed-since" });
    }
  }
  const blocked = refused.length > 0;
  const go = blocked && !partial ? [] : restore;
  // Writes before deletes, so a moved file's new copy is never gone before its old one is back.
  const ordered = [...go.filter((row) => row.action === "write"), ...go.filter((row) => row.action === "delete")];
  // ok: the caller may go ahead (with an empty `restore` when every file is already as it was). A refused
  // file stops a whole-attempt revert; a partial one goes on with the rest, if there is any.
  return { ok: blocked ? partial && ordered.length > 0 : true, restore: ordered, already, refused, message: refusalSentence(refused, { partial, restoring: ordered.length }) };
}

// A change set read the other way round: what undoes a revert. A file the revert brought back is
// removed again, a file it removed is written again, an edited file gets the attempt's copy back.
function invertEntries(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    ...entry,
    status: entry.status === "added" ? "deleted" : entry.status === "deleted" ? "added" : entry.status,
    path: entry.status === "renamed" ? entry.oldPath : entry.path,
    oldPath: entry.status === "renamed" ? entry.path : null,
    oldBlob: entry.newBlob, newBlob: entry.oldBlob, oldMode: entry.newMode, newMode: entry.oldMode,
  }));
}

const REASONS = Object.freeze({
  "changed-since": "changed since the attempt ended",
  unsupported: "not a plain file",
  "unsafe-name": "has a name Studio will not write",
  unknown: "could not be read",
  "not-in-attempt": "is not part of this attempt",
});

// The sentence a refusal shows: which files, and that nothing destructive is offered.
function refusalSentence(refused, { partial = false, restoring = 0 } = {}) {
  const rows = Array.isArray(refused) ? refused : [];
  if (!rows.length) return "";
  const named = rows.slice(0, 5).map((row) => row.path).filter(Boolean).join(", ");
  const more = rows.length > 5 ? ` and ${rows.length - 5} more` : "";
  const changed = rows.every((row) => row.reason === "changed-since");
  const why = changed ? "changed since the attempt ended" : rows.length === 1 ? REASONS[rows[0].reason] ?? "cannot be put back" : "cannot be put back";
  const count = rows.length === 1 ? "1 file" : `${rows.length} files`;
  if (partial) return `${restoring ? `${restoring} put back. ` : ""}${count} ${rows.length === 1 ? "was" : "were"} left alone because ${rows.length === 1 ? "it" : "they"} ${why}: ${named}${more}.`;
  return `Nothing was reverted. ${count} ${rows.length === 1 ? "has" : "have"} ${changed ? "changed since the attempt ended" : `a problem (${why})`}: ${named}${more}. Studio does not overwrite work it did not make.`;
}

// Why there is no change list, in the words the page shows.
const UNAVAILABLE = Object.freeze({
  off: "Before-and-after snapshots are switched off on this PC.",
  "not-a-repo": "This project is not a Git repository, so Studio has no before-and-after record of its files.",
  nested: "This folder is inside another Git project, so Studio leaves the list of changed files to that project.",
  "git-missing": "Git is not installed on this PC, so Studio cannot list the files an attempt changed.",
  "too-many": "Too many files changed at once to keep a snapshot. Ignore generated folders in a .gitignore.",
  unreadable: "Git could not read this folder just now.",
});
const unavailable = (reason) => UNAVAILABLE[reason] ?? UNAVAILABLE.unreadable;

module.exports = {
  NAMESPACE, KEEP_ATTEMPTS, KEEP_TASKS, LIMITS, PHASES, LIST_FORMAT, UNAVAILABLE,
  taskKey, safeRunId, wholeNumber, stampOf, refName, subjectOf, parseRefs, attemptsOf, nextAttempt, prunePlan,
  messageOf, parseMessage, planSnapshot, addPathspec, skippedSentence, SKIP_WORDS,
  parseRaw, parseNumstat, changeSet, totalsOf, publicEntry, parseDiff, safeRelative, planRevert, invertEntries, refusalSentence, unavailable,
};
