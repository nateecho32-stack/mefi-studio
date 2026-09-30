"use strict";
// Attempt snapshots, the host half: runs git and touches the project folder.
// scripts/attempt-snapshots.cjs (pure) names the refs, reads git's answers and
// decides what a revert may do; this module does the looking and the doing.
//
//   begin / end      a snapshot of the folder a builder works in, as a commit
//                    only refs/mefi/attempts/<task>/<n>/before|after points at
//   changes / diff   the files an attempt changed, and one file's diff
//   revert / undo    put files back to the "before" picture, or undo that
//   prune            keep each task's newest attempts
//
// The picture is made with a TEMPORARY index (a copy of the real one, named by
// GIT_INDEX_FILE): `git add -A` on the copy, `git write-tree`, `git commit-tree`,
// `git update-ref`. The person's index, HEAD, branch and working files are never
// touched by a snapshot, and .gitignore is honoured because git does the adding.
// A revert writes each file to a temporary name beside it and renames it over
// the original, only for files in the attempt's own change set, only while the
// file still holds what the attempt left, and only after a safety snapshot
// (reverted-<time>) of the folder as it was. Nothing here runs `git reset`,
// `git checkout .`, `git clean` or any other command that rewrites the tree.
//
// Git runs without a shell and without prompts, from argv arrays, with Studio's
// own credentials withheld (scripts/platform.cjs); everything that leaves is
// scrubbed of credentials, and no path of the person's leaves in a log line.
// Every public method answers, never throws. All IO is injected like
// scripts/git-actions.cjs; the defaults are the real ones. Guarded by
// tests/attempt_snapshots_host.test.mjs.
const { withholdCredentials } = require("./platform.cjs");
const { maskCredentials } = require("./redaction.cjs");
const rules = require("./attempt-snapshots.cjs");

const MIB = 1024 * 1024;
const REDIRECTS = new Set(["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"]);
const KILL_GRACE_MS = 5000;
const IDENTITY = Object.freeze({ GIT_AUTHOR_NAME: "Mefi's Studio", GIT_AUTHOR_EMAIL: "studio@invalid.local", GIT_COMMITTER_NAME: "Mefi's Studio", GIT_COMMITTER_EMAIL: "studio@invalid.local" });
// Config every call runs with: no quoting of names, no failing on line-ending
// conversions, no file-system monitor started on Studio's behalf, and no hooks
// (a reference-transaction hook would otherwise run for Studio's own private refs).
const configFor = (nowhere) => Object.freeze(["-c", "core.quotepath=false", "-c", "core.safecrlf=false", "-c", "core.fsmonitor=false", "-c", `core.hooksPath=${nowhere}`, "-c", "gc.auto=0"]);
const SNIFF_BYTES = 8000;
const STAT_CONCURRENCY = 32;

function createAttemptSnapshots({
  execFile = require("node:child_process").execFile,
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  env = () => process.env,
  now = () => Date.now(),
  platform = process.platform,
  // The kill switch: a function so the host can read its settings as well as the environment.
  disabled = () => process.env.MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS === "1",
  log = () => {},
  random = () => require("node:crypto").randomBytes(6).toString("hex"),
} = {}) {
  const fsp = fs.promises;
  const paths = platform === "win32" ? path.win32 : path.posix;
  const CONFIG = configFor(paths.join(os.tmpdir(), "mefi-no-hooks"));
  const off = () => { try { return disabled() === true; } catch { return false; } };
  const clock = () => (typeof now === "function" ? now() : Date.now());
  const envOf = () => (typeof env === "function" ? env() : env) ?? process.env;

  // ---- running git ------------------------------------------------------------------
  // No shell, prompts off, credentials withheld, a hard limit. A read never takes the index lock.
  function git(cwd, args, { input = null, timeout = 30000, extra = {}, buffer = false, maxBuffer = 16 * MIB, reads = false } = {}) {
    return new Promise((resolve) => {
      const set = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", LC_ALL: "C", ...(reads ? { GIT_OPTIONAL_LOCKS: "0" } : {}), ...extra };
      const upper = new Set(Object.keys(set).map((name) => name.toUpperCase()));
      const inherited = Object.fromEntries(Object.entries(envOf()).filter(([name]) => !REDIRECTS.has(name.toUpperCase()) && !upper.has(name.toUpperCase())));
      const options = withholdCredentials({ cwd, timeout, maxBuffer, windowsHide: true, encoding: buffer ? "buffer" : "utf8", env: { ...inherited, ...set } });
      let settled = false;
      let watchdog = null;
      let child = null;
      const done = (error, stdout, stderr) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        const overflow = error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        resolve({
          ok: !error, code: error ? (error.code ?? 1) : 0,
          stdout: buffer ? (stdout ?? Buffer.alloc(0)) : String(stdout ?? ""),
          stderr: clean(String(stderr ?? "").trim() || error?.message || ""),
          timedOut: Boolean(error?.killed) && !overflow, overflow,
          missing: error?.code === "ENOENT" || /\bENOENT\b/.test(String(error?.message ?? "")),
        });
      };
      if (Number.isFinite(timeout) && timeout > 0) {
        // A hook or filter git started can hold the pipes open past node's own timeout.
        watchdog = setTimeout(() => {
          try { child?.kill?.("SIGKILL"); } catch { /* already gone */ }
          done(Object.assign(new Error(`git did not stop after ${Math.round(timeout / 1000)} s`), { killed: true, code: "ETIMEDOUT" }), buffer ? Buffer.alloc(0) : "", "");
        }, timeout + KILL_GRACE_MS);
        watchdog.unref?.();
      }
      try { child = execFile("git", [...CONFIG, ...args], options, done); } catch (error) { done(error, "", ""); return; }
      if (input !== null) { child?.stdin?.on?.("error", () => {}); child?.stdin?.end?.(input); }
    });
  }
  const clean = (value) => maskCredentials(String(value ?? "").replace(/(:\/\/)[^\s/]*@/g, "$1"));
  const firstLine = (text, root = "") => {
    let line = String(text ?? "").split(/\r?\n/).map((part) => part.trim()).filter(Boolean)[0] ?? "";
    if (root) line = line.split(root).join("<project>");
    return line.replace(/^(fatal|error):\s*/i, "").slice(0, 160);
  };

  // ---- one writer at a time per folder ---------------------------------------------------
  const queues = new Map();
  const keyOf = (root) => { const resolved = paths.resolve(String(root)); return platform === "win32" ? resolved.toLowerCase() : resolved; };
  function serial(root, task) {
    const key = keyOf(root);
    const next = (queues.get(key) ?? Promise.resolve()).then(task, task);
    const tail = next.then(() => {}, () => {});
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return next;
  }
  // The heavy part (git reading a whole folder) may run for three folders at once and no more, so a
  // pool of builders starting together does not start three hundred git processes.
  const HEAVY = 3;
  let heavy = 0;
  const waiting = [];
  async function gated(task) {
    if (heavy >= HEAVY) await new Promise((resolve) => waiting.push(resolve));
    heavy += 1;
    try { return await task(); } finally { heavy -= 1; waiting.shift()?.(); }
  }
  // Every public method answers, never throws.
  const guard = (name, task) => async (...args) => {
    try { return await task(...args); } catch (error) {
      log(`[review] ${name} failed (${error?.code || error?.name || "error"})`);
      return { ok: false, reason: "unreadable", error: rules.unavailable("unreadable") };
    }
  };

  // ---- the folder ----------------------------------------------------------------------------
  const canonical = async (folder) => {
    let real = paths.resolve(String(folder));
    try { real = await fsp.realpath(real); } catch { /* not there: its own spelling */ }
    real = paths.resolve(real);
    return platform === "win32" ? real.toLowerCase() : real;
  };

  // Whether the folder is the top of a git working tree (the project's own repository, or a run's worktree).
  async function probe(root) {
    if (off()) return { ok: false, reason: "off" };
    if (typeof root !== "string" || !root) return { ok: false, reason: "not-a-repo" };
    const top = await git(root, ["rev-parse", "--show-toplevel"], { reads: true, timeout: 10000 });
    if (top.missing) return { ok: false, reason: "git-missing" };
    if (!top.ok) return { ok: false, reason: /not a git repository/i.test(top.stderr) ? "not-a-repo" : top.timedOut ? "unreadable" : /dubious ownership|safe\.directory/i.test(top.stderr) ? "unreadable" : "not-a-repo" };
    if ((await canonical(top.stdout.trim())) !== (await canonical(root))) return { ok: false, reason: "nested" };
    return { ok: true };
  }

  // ---- reading refs ----------------------------------------------------------------------------
  async function refsOf(root, key = null) {
    const listed = await git(root, ["for-each-ref", `--format=${rules.LIST_FORMAT}`, key ? `${rules.NAMESPACE}/${key}/` : `${rules.NAMESPACE}/`], { reads: true });
    return listed.ok ? rules.parseRefs(listed.stdout) : [];
  }
  async function readMessage(root, sha) {
    const shown = await git(root, ["cat-file", "commit", sha], { reads: true, timeout: 10000 });
    if (!shown.ok) return rules.parseMessage("");
    return rules.parseMessage(shown.stdout.split(/\r?\n\r?\n/).slice(1).join("\n\n"));
  }
  const resolveAttempt = (attempts, { attempt = null, runId = null } = {}) => {
    if (Number.isSafeInteger(attempt)) return attempts.find((item) => item.n === attempt) ?? null;
    if (runId) return attempts.find((item) => item.runId === runId) ?? null;
    return attempts.find((item) => item.before) ?? attempts[0] ?? null;
  };

  // ---- making a snapshot ------------------------------------------------------------------------
  const sniffBinary = async (file) => {
    let handle = null;
    try {
      handle = await fsp.open(file, "r");
      const buffer = Buffer.alloc(SNIFF_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
      return buffer.subarray(0, bytesRead).includes(0);
    } catch { return false; } finally { await handle?.close().catch(() => {}); }
  };
  async function mapLimit(items, limit, task) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) { const index = next; next += 1; out[index] = await task(items[index]); }
    }));
    return out;
  }
  const inFolder = (root, name) => paths.join(root, ...String(name).split("/"));

  // The folder's files as a git tree, built on a copy of the index. Returns { ok, tree, skipped, skippedCount, candidates } or { ok: false, reason }.
  async function snapshotTree(root, { deadline = clock() + 30000 } = {}) {
    const left = () => Math.max(1000, deadline - clock());
    const found = await git(root, ["ls-files", "-m", "-o", "--exclude-standard", "-z"], { reads: true, timeout: left() });
    if (!found.ok) return { ok: false, reason: found.missing ? "git-missing" : "unreadable", detail: firstLine(found.stderr, root) };
    const names = [...new Set(found.stdout.split("\0").filter(Boolean))];
    if (names.length > rules.LIMITS.candidates) return { ok: false, reason: "too-many", count: names.length };
    const stats = await mapLimit(names, STAT_CONCURRENCY, async (name) => {
      try {
        const info = await fsp.lstat(inFolder(root, name));
        if (!info.isFile()) return null;
        return { path: name, size: info.size, binary: info.size > 0 ? await sniffBinary(inFolder(root, name)) : false };
      } catch { return null; }
    });
    const plan = rules.planSnapshot(stats.filter(Boolean));
    if (plan.tooMany) return { ok: false, reason: "too-many", count: plan.count };
    const where = await git(root, ["rev-parse", "--git-path", "index"], { reads: true, timeout: 10000 });
    if (!where.ok) return { ok: false, reason: "unreadable", detail: firstLine(where.stderr, root) };
    const realIndex = paths.resolve(root, where.stdout.trim());
    const folder = await fsp.mkdtemp(paths.join(os.tmpdir(), "mefi-snapshot-"));
    const index = paths.join(folder, "index");
    try {
      // The copy keeps git's cached file stats, so only files that really changed are read again.
      try { await fsp.copyFile(realIndex, index); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      const extra = { GIT_INDEX_FILE: index };
      const added = await git(root, ["add", "-A", "--ignore-errors", "--pathspec-from-file=-", "--pathspec-file-nul"], { input: rules.addPathspec(plan.leaveOut), extra, timeout: left(), maxBuffer: 4 * MIB });
      // --ignore-errors adds what it can and still exits non-zero for a file it could not read; that is not a failed snapshot.
      const unreadable = added.ok ? 0 : (added.stderr.match(/^error: /gm) ?? []).length;
      if (!added.ok && !unreadable) return { ok: false, reason: added.timedOut ? "unreadable" : "unreadable", detail: firstLine(added.stderr, root) };
      const written = await git(root, ["write-tree"], { extra, timeout: left() });
      const tree = written.stdout.trim();
      if (!written.ok || !/^[0-9a-f]{40,64}$/.test(tree)) return { ok: false, reason: "unreadable", detail: firstLine(written.stderr, root) };
      return { ok: true, tree, skipped: plan.skipped, skippedCount: plan.skippedCount + unreadable, candidates: plan.count };
    } finally {
      await fsp.rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
    }
  }

  async function commitTree(root, tree, parents, message) {
    const args = ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-F", "-"];
    const made = await git(root, args, { input: message, extra: { ...IDENTITY, GIT_AUTHOR_DATE: new Date(clock()).toISOString(), GIT_COMMITTER_DATE: new Date(clock()).toISOString() }, timeout: 20000 });
    const sha = made.stdout.trim();
    return made.ok && /^[0-9a-f]{40,64}$/.test(sha) ? { ok: true, sha } : { ok: false, detail: firstLine(made.stderr, "") };
  }
  const headOf = async (root) => {
    const head = await git(root, ["rev-parse", "--verify", "-q", "HEAD"], { reads: true, timeout: 10000 });
    return head.ok && /^[0-9a-f]{40,64}$/.test(head.stdout.trim()) ? head.stdout.trim() : null;
  };
  // Create-only: an existing ref is never moved.
  const makeRef = (root, ref, sha) => git(root, ["update-ref", ref, sha, ""], { timeout: 15000 });

  // ---- begin and end of an attempt ------------------------------------------------------------------
  // The picture of the folder when a run starts. `numbers` are attempt numbers something else already holds (evidence folders).
  const begin = guard("begin", async ({ root, taskId, runId, worktree = false, overlap = [], numbers = [], budgetMs = 20000 } = {}) => {
    const key = rules.taskKey(taskId);
    if (!key || !rules.safeRunId(runId)) return { ok: false, reason: "unreadable", error: rules.unavailable("unreadable") };
    const ready = await probe(root);
    if (!ready.ok) return { ok: false, reason: ready.reason, error: rules.unavailable(ready.reason) };
    const shot = await gated(() => snapshotTree(root, { deadline: clock() + budgetMs }));
    if (!shot.ok) { log(`[review] no before snapshot (${shot.reason})`); return { ok: false, reason: shot.reason, error: rules.unavailable(shot.reason) }; }
    // Only the numbering waits its turn: two attempts starting together take two numbers.
    return serial(root, async () => {
      const head = await headOf(root);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const rows = await refsOf(root, key);
        const n = rules.nextAttempt(rows.map((row) => row.n), numbers);
        const ref = rules.refName(taskId, n, "before");
        const message = rules.messageOf({ taskId, n, phase: "before", runId, at: clock(), worktree, overlap, skipped: shot.skipped, skippedCount: shot.skippedCount });
        const made = await commitTree(root, shot.tree, head ? [head] : [], message);
        if (!made.ok) return { ok: false, reason: "unreadable", error: rules.unavailable("unreadable") };
        const set = await makeRef(root, ref, made.sha);
        if (set.ok) {
          pruneRefs(root).catch(() => {});
          return { ok: true, n, sha: made.sha, tree: shot.tree, skippedCount: shot.skippedCount, skipped: shot.skipped };
        }
        if (!/already exists|cannot lock ref/i.test(set.stderr)) return { ok: false, reason: "unreadable", error: rules.unavailable("unreadable") };
      }
      return { ok: false, reason: "unreadable", error: rules.unavailable("unreadable") };
    });
  });

  // The picture when it ends, parented on the "before" one. `changed` says whether the folder differs.
  const end = guard("end", async ({ root, taskId, n, runId, worktree = false, overlap = [], budgetMs = 30000 } = {}) => {
    const ref = rules.refName(taskId, n, "before");
    if (!ref || !rules.safeRunId(runId)) return { ok: false, reason: "unreadable", error: rules.unavailable("unreadable") };
    const ready = await probe(root);
    if (!ready.ok) return { ok: false, reason: ready.reason, error: rules.unavailable(ready.reason) };
    const before = await git(root, ["rev-parse", "--verify", "-q", ref], { reads: true, timeout: 10000 });
    const beforeSha = before.stdout.trim();
    if (!before.ok || !beforeSha) return { ok: false, reason: "no-before", error: "There is no snapshot of this attempt's start." };
    const shot = await gated(() => snapshotTree(root, { deadline: clock() + budgetMs }));
    if (!shot.ok) { log(`[review] no after snapshot (${shot.reason})`); return { ok: false, reason: shot.reason, error: rules.unavailable(shot.reason) }; }
    const message = rules.messageOf({ taskId, n, phase: "after", runId, at: clock(), worktree, overlap, skipped: shot.skipped, skippedCount: shot.skippedCount });
    const made = await commitTree(root, shot.tree, [beforeSha], message);
    if (!made.ok) return { ok: false, reason: "unreadable", error: rules.unavailable("unreadable") };
    const set = await makeRef(root, rules.refName(taskId, n, "after"), made.sha);
    if (!set.ok) return { ok: false, reason: "unreadable", error: rules.unavailable("unreadable") };
    const same = await git(root, ["diff", "--quiet", beforeSha, made.sha], { reads: true, timeout: 20000 });
    return { ok: true, n, sha: made.sha, changed: same.code === 1 ? true : same.ok ? false : null, skippedCount: shot.skippedCount, skipped: shot.skipped };
  });

  // ---- reading an attempt --------------------------------------------------------------------------------
  const rawFlags = ["--no-color", "--no-ext-diff", "--no-textconv", "-M", "--no-abbrev"];
  async function changeEntries(root, from, to) {
    const [raw, stat] = await Promise.all([
      git(root, ["diff", "--raw", "-z", ...rawFlags, from, to], { reads: true, timeout: 60000, maxBuffer: 32 * MIB }),
      git(root, ["diff", "--numstat", "-z", ...rawFlags.filter((flag) => flag !== "--no-abbrev"), from, to], { reads: true, timeout: 60000, maxBuffer: 32 * MIB }),
    ]);
    if (!raw.ok) return null;
    return rules.changeSet(raw.stdout, stat.ok ? stat.stdout : "");
  }

  // What the folder holds now for each path: { blob } ("" is never a blob; null: no file), the way `git add` would hash it.
  async function currentBlobs(root, names) {
    const current = {};
    const toHash = [];
    for (const name of names) {
      if (!rules.safeRelative(name)) { current[name] = { blob: "unsafe" }; continue; }
      let info = null;
      try { info = await fsp.lstat(inFolder(root, name)); } catch (error) { if (error?.code === "ENOENT" || error?.code === "ENOTDIR") { current[name] = { blob: null }; continue; } current[name] = { blob: "unreadable" }; continue; }
      if (info.isSymbolicLink()) {
        try { const target = await fsp.readlink(inFolder(root, name)); const hashed = await git(root, ["hash-object", "--stdin"], { input: target, reads: true, timeout: 10000 }); current[name] = { blob: hashed.ok ? hashed.stdout.trim() : "unreadable", kind: "symlink" }; } catch { current[name] = { blob: "unreadable" }; }
      } else if (!info.isFile()) current[name] = { blob: "not-a-file" };
      else if (info.size > 2 * rules.LIMITS.textBytes) current[name] = { blob: "too-large" };
      else if (/[\r\n]/.test(name)) current[name] = { blob: "odd-name" };
      else toHash.push(name);
    }
    for (let from = 0; from < toHash.length; from += 500) {
      const batch = toHash.slice(from, from + 500);
      // A name that starts with a quote would be read as C-style quoted text: quote it ourselves.
      const lines = batch.map((name) => (name.startsWith('"') ? `"${name.replace(/[\\"]/g, "\\$&")}"` : name));
      const hashed = await git(root, ["hash-object", "--stdin-paths"], { input: `${lines.join("\n")}\n`, reads: true, timeout: 60000 });
      const ids = hashed.ok ? hashed.stdout.split(/\r?\n/).filter(Boolean) : [];
      batch.forEach((name, index) => { current[name] = { blob: /^[0-9a-f]{40,64}$/.test(ids[index] ?? "") && ids.length === batch.length ? ids[index] : "unreadable" }; });
    }
    return current;
  }
  const namesOf = (entries) => [...new Set(entries.flatMap((entry) => [entry.path, entry.oldPath].filter(Boolean)))];

  // Which state each file is in, for the page: can be put back, already back, or changed since.
  function statesOf(entries, current) {
    const plan = rules.planRevert({ entries, scope: "attempt", current, partial: true });
    const refused = new Set(plan.refused.map((row) => row.path));
    const restoring = new Set(plan.restore.map((row) => row.path));
    const state = new Map();
    for (const entry of entries) {
      const own = [entry.path, entry.oldPath].filter(Boolean);
      state.set(entry.path, own.some((name) => refused.has(name)) ? "changed" : own.some((name) => restoring.has(name)) ? "can-revert" : "reverted");
    }
    return state;
  }

  const described = (attempts, chosen) => attempts.map((item) => ({ n: item.n, runId: item.runId, startedAt: item.startedAt, endedAt: item.endedAt, ended: Boolean(item.after), selected: item === chosen, reverts: item.reverts.map((row) => ({ stamp: row.stamp, at: row.at })) }));

  // A list read from a folder that is still changing is kept a few seconds: a page that asks
  // every time the board pushes must not make git read the whole folder every time.
  const LIVE_MS = 8000;
  const live = new Map();
  // The files an attempt changed. `running`: the run is still going, so the list is read from the folder as it is now.
  const changes = guard("changes", async ({ root, taskId, attempt = null, runId = null, running = false } = {}) => {
    const liveKey = `${keyOf(root)}\0${taskId}\0${attempt}\0${runId}\0${running}`;
    const kept = live.get(liveKey);
    if (kept && clock() - kept.at < LIVE_MS) return kept.value;
    const value = await readChanges({ root, taskId, attempt, runId, running });
    if (value?.ok && value.state !== "ended") live.set(liveKey, { at: clock(), value });
    else live.delete(liveKey);
    if (live.size > 40) live.delete(live.keys().next().value);
    return value;
  });
  const readChanges = async ({ root, taskId, attempt = null, runId = null, running = false } = {}) => {
    const key = rules.taskKey(taskId);
    if (!key) return { ok: true, available: false, reason: "unreadable", note: rules.unavailable("unreadable") };
    const ready = await probe(root);
    if (!ready.ok) return { ok: true, available: false, reason: ready.reason, note: rules.unavailable(ready.reason) };
    const rows = await refsOf(root, key);
    const attempts = rules.attemptsOf(rows, key);
    const chosen = resolveAttempt(attempts, { attempt, runId });
    if (!chosen || !chosen.before) return { ok: true, available: true, attempts: described(attempts, null), attempt: null, files: [], totals: rules.totalsOf([]), more: 0, skipped: { count: 0, files: [], sentence: "" }, state: "none", note: "" };
    let entries;
    let state = chosen.after ? "ended" : running ? "running" : "unfinished";
    let current = null;
    if (chosen.after) entries = await changeEntries(root, chosen.before.sha, chosen.after.sha);
    else {
      // No end picture: the folder as it is now against the start, without keeping one.
      const shot = await gated(() => snapshotTree(root, { deadline: clock() + 20000 }));
      entries = shot.ok ? await changeEntries(root, chosen.before.sha, shot.tree) : null;
    }
    if (entries === null) return { ok: true, available: false, reason: "unreadable", note: rules.unavailable("unreadable") };
    if (chosen.after) current = await currentBlobs(root, namesOf(entries.slice(0, rules.LIMITS.revertFiles)));
    const states = current ? statesOf(entries.slice(0, rules.LIMITS.revertFiles), current) : new Map();
    const beforeFacts = await readMessage(root, chosen.before.sha);
    const afterFacts = chosen.after ? await readMessage(root, chosen.after.sha) : null;
    const skippedRows = [...(beforeFacts.skipped ?? []), ...(afterFacts?.skipped ?? [])];
    const skippedCount = Math.max(beforeFacts.skippedCount, afterFacts?.skippedCount ?? 0, skippedRows.length);
    const listed = entries.slice(0, rules.LIMITS.listedFiles);
    const overlap = [...new Set([...(beforeFacts.overlap ?? []), ...(afterFacts?.overlap ?? [])])];
    return {
      ok: true, available: true, attempt: chosen.n, runId: chosen.runId, state,
      attempts: described(attempts, chosen),
      files: listed.map((entry) => rules.publicEntry(entry, states.get(entry.path) ?? null)),
      totals: rules.totalsOf(entries), more: Math.max(0, entries.length - listed.length),
      skipped: { count: skippedCount, files: skippedRows.slice(0, rules.LIMITS.skippedListed), sentence: rules.skippedSentence(skippedRows, skippedCount) },
      overlap, worktree: Boolean(beforeFacts.worktree),
      startedAt: chosen.startedAt, endedAt: chosen.endedAt,
    };
  };

  // One file's diff, on demand and bounded.
  const diff = guard("diff", async ({ root, taskId, attempt = null, runId = null, path: file, running = false } = {}) => {
    const key = rules.taskKey(taskId);
    if (!key || typeof file !== "string" || !file) return { ok: false, error: "Choose a file from the list." };
    const ready = await probe(root);
    if (!ready.ok) return { ok: false, reason: ready.reason, error: rules.unavailable(ready.reason) };
    const attempts = rules.attemptsOf(await refsOf(root, key), key);
    const chosen = resolveAttempt(attempts, { attempt, runId });
    if (!chosen?.before) return { ok: false, error: "That attempt has no snapshot to read." };
    let target = chosen.after?.sha ?? null;
    if (!target) {
      const shot = await gated(() => snapshotTree(root, { deadline: clock() + 20000 }));
      if (!shot.ok) return { ok: false, reason: shot.reason, error: rules.unavailable(shot.reason) };
      target = shot.tree;
    }
    const entries = await changeEntries(root, chosen.before.sha, target);
    const entry = entries?.find((item) => item.path === file || item.oldPath === file);
    if (!entry) return { ok: false, error: "That file is not part of this attempt." };
    const shown = await git(root, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "-U3", "-M", chosen.before.sha, target, "--", ...[entry.oldPath, entry.path].filter(Boolean).map((name) => `:(literal)${name}`)], { reads: true, timeout: 30000, maxBuffer: 32 * MIB });
    if (!shown.ok && !shown.overflow) return { ok: false, error: "Git could not read that file's diff." };
    const parsed = shown.overflow ? { binary: false, lines: [], truncated: true } : rules.parseDiff(shown.stdout);
    const view = rules.publicEntry(entry);
    return { ok: true, path: view.path, oldPath: view.oldPath, status: view.status, additions: view.additions, deletions: view.deletions, binary: parsed.binary || view.binary, lines: parsed.lines, truncated: parsed.truncated || shown.overflow };
  });

  // ---- writing files back ------------------------------------------------------------------------------------
  // The file's content as it goes to disk (git's own checkout conversions apply: line endings, attributes).
  async function blobBytes(root, blob, name) {
    const got = await git(root, ["cat-file", "--filters", `--path=${name}`, blob], { buffer: true, reads: true, timeout: 60000, maxBuffer: rules.LIMITS.textBytes * 2 + MIB });
    return got.ok ? got.stdout : null;
  }
  // A write goes only where the folder's own real path says it is inside the project: a link
  // inside the project cannot point a restored file (or a new sub-folder) somewhere else.
  const within = (rootReal, target) => {
    const relative = paths.relative(rootReal, target);
    return relative === "" || (!relative.startsWith("..") && !paths.isAbsolute(relative));
  };
  async function checkedFolder(root, folder) {
    const rootReal = await fsp.realpath(root);
    // The nearest folder that exists is the one a link could redirect.
    let nearest = folder;
    for (;;) {
      try { nearest = await fsp.realpath(nearest); break; } catch (error) {
        const up = paths.dirname(nearest);
        if (up === nearest || (error?.code !== "ENOENT" && error?.code !== "ENOTDIR")) throw new Error("outside");
        nearest = up;
      }
    }
    if (!within(rootReal, nearest)) throw new Error("outside");
  }
  async function writeAtomic(root, name, bytes, mode) {
    const target = inFolder(root, name);
    const folder = paths.dirname(target);
    await checkedFolder(root, folder);
    await fsp.mkdir(folder, { recursive: true });
    await checkedFolder(root, folder);
    try { const info = await fsp.lstat(target); if (info.isSymbolicLink() || info.isDirectory()) throw new Error("not a plain file"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    const temp = paths.join(folder, `.mefi-restore-${random()}.tmp`);
    try {
      await fsp.writeFile(temp, bytes, { flag: "wx" });
      if (platform !== "win32" && Number.isInteger(mode)) await fsp.chmod(temp, mode).catch(() => {});
      await fsp.rename(temp, target);
    } catch (error) { await fsp.rm(temp, { force: true }).catch(() => {}); throw error; }
  }
  async function removeFile(root, name) {
    const target = inFolder(root, name);
    await checkedFolder(root, paths.dirname(target));
    const info = await fsp.lstat(target);
    if (info.isDirectory()) throw new Error("not a plain file");
    await fsp.unlink(target);
    // The folders the attempt made, left empty: only empty ones go, up to the project folder.
    const top = paths.resolve(root);
    for (let dir = paths.dirname(target); paths.resolve(dir) !== top && paths.resolve(dir).startsWith(top); dir = paths.dirname(dir)) {
      try { await fsp.rmdir(dir); } catch { break; }
    }
  }

  // Applies a revert plan: the files' new content is read first, then each is swapped in. A failure part-way puts back the ones already done.
  async function apply(root, plan, before) {
    const bytes = new Map();
    for (const step of plan.restore) {
      if (step.action !== "write") continue;
      const content = step.blob ? await blobBytes(root, step.blob, step.path) : null;
      if (content === null) return { ok: false, error: `Git could not read the earlier copy of ${step.path}. Nothing was changed.` };
      bytes.set(step.path, content);
    }
    const done = [];
    try {
      for (const step of plan.restore) {
        const was = before.get(step.path);
        if (step.action === "write") await writeAtomic(root, step.path, bytes.get(step.path), step.mode);
        else await removeFile(root, step.path);
        done.push({ step, was });
      }
    } catch (error) {
      const stuck = plan.restore[done.length]?.path ?? "a file";
      for (const item of done.reverse()) {
        try { if (item.was === null) await removeFile(root, item.step.path); else await writeAtomic(root, item.step.path, item.was, item.step.mode); } catch { /* the safety snapshot still holds it */ }
      }
      return { ok: false, error: `${stuck} could not be replaced (${firstLine(error?.message ?? error)}), so the files already put back were restored. Nothing was changed.` };
    }
    return { ok: true, count: done.length };
  }
  // What each path holds right now, so a failed step can put it back.
  async function contentsNow(root, steps) {
    const held = new Map();
    for (const step of steps) {
      try { held.set(step.path, await fsp.readFile(inFolder(root, step.path))); } catch { held.set(step.path, null); }
    }
    return held;
  }

  // Puts files back to the "before" picture. `busy(root)` says a builder is working in the folder.
  const revert = guard("revert", async ({ root, taskId, attempt = null, runId = null, scope, path: file = null, partial = false, busy = () => false } = {}) => {
    const key = rules.taskKey(taskId);
    if (!key) return { ok: false, error: "Choose a task first." };
    const ready = await probe(root);
    if (!ready.ok) return { ok: false, reason: ready.reason, error: rules.unavailable(ready.reason) };
    return serial(root, async () => {
      if (await busy(root)) return { ok: false, busy: true, error: "A builder is working in this folder. Wait for it to finish or pause it, so nothing changes under it." };
      const attempts = rules.attemptsOf(await refsOf(root, key), key);
      const chosen = resolveAttempt(attempts, { attempt, runId });
      if (!chosen?.before || !chosen.after) return { ok: false, error: "This attempt has no end snapshot, so Studio cannot tell what it changed. Nothing was reverted." };
      const entries = await changeEntries(root, chosen.before.sha, chosen.after.sha);
      if (entries === null) return { ok: false, error: rules.unavailable("unreadable") };
      const wanted = scope === "file" ? entries.filter((entry) => entry.path === file || entry.oldPath === file) : entries;
      const current = await currentBlobs(root, namesOf(wanted));
      const plan = rules.planRevert({ entries, scope, path: file, current, partial, symlinks: platform !== "win32" });
      if (!plan.ok) return { ok: false, refused: plan.refused, error: plan.message || "Nothing to put back." };
      if (!plan.restore.length) return { ok: true, reverted: 0, already: plan.already.length, refused: plan.refused, note: plan.already.length ? "Those files are already as they were before the attempt." : "This attempt changed no files." };
      // The safety picture: the folder exactly as it is, before a byte moves.
      const stamp = rules.stampOf(clock());
      const shot = await gated(() => snapshotTree(root, { deadline: clock() + 30000 }));
      if (!shot.ok) return { ok: false, reason: shot.reason, error: `Studio could not keep a copy of the folder first, so it changed nothing. ${rules.unavailable(shot.reason)}` };
      const touched = plan.restore.map((step) => step.path);
      const message = rules.messageOf({ taskId, n: chosen.n, phase: "reverted", stamp, runId: chosen.runId, at: clock(), skipped: shot.skipped, skippedCount: shot.skippedCount, paths: touched });
      const made = await commitTree(root, shot.tree, [chosen.after.sha], message);
      const receiptRef = rules.refName(taskId, chosen.n, "reverted", stamp);
      if (!made.ok || !receiptRef || !(await makeRef(root, receiptRef, made.sha)).ok) return { ok: false, error: "Studio could not keep a copy of the folder first, so it changed nothing." };
      // The checks above and the copy took a moment: look again before a byte moves.
      if (await busy(root)) return { ok: false, busy: true, error: "A builder started working in this folder. Nothing was changed.", receipt: stamp };
      const held = await contentsNow(root, plan.restore);
      const applied = await apply(root, plan, held);
      if (!applied.ok) return { ok: false, error: applied.error, receipt: stamp };
      return { ok: true, reverted: applied.count, files: touched.length, already: plan.already.length, refused: plan.refused, receipt: stamp, note: plan.refused.length ? plan.message : "" };
    });
  });

  // Undoes a revert: the files it touched go back to what they held, only while they still hold what the revert wrote.
  const undo = guard("undo", async ({ root, taskId, attempt = null, runId = null, receipt, busy = () => false } = {}) => {
    const key = rules.taskKey(taskId);
    if (!key || typeof receipt !== "string" || !/^\d{8}T\d{9}Z$/.test(receipt)) return { ok: false, error: "Choose a revert to undo." };
    const ready = await probe(root);
    if (!ready.ok) return { ok: false, reason: ready.reason, error: rules.unavailable(ready.reason) };
    return serial(root, async () => {
      if (await busy(root)) return { ok: false, busy: true, error: "A builder is working in this folder. Wait for it to finish or pause it, so nothing changes under it." };
      const attempts = rules.attemptsOf(await refsOf(root, key), key);
      const chosen = resolveAttempt(attempts, { attempt, runId });
      const saved = chosen?.reverts.find((row) => row.stamp === receipt);
      if (!chosen?.before || !chosen.after || !saved) return { ok: false, error: "That revert can no longer be undone." };
      const facts = await readMessage(root, saved.sha);
      const entries = (await changeEntries(root, chosen.before.sha, chosen.after.sha)) ?? [];
      const touched = new Set(facts.paths);
      const inverse = rules.invertEntries(entries.filter((entry) => touched.has(entry.path) || touched.has(entry.oldPath)));
      if (!inverse.length) return { ok: false, error: "That revert can no longer be undone." };
      const current = await currentBlobs(root, namesOf(inverse));
      const plan = rules.planRevert({ entries: inverse, scope: "attempt", current, partial: false, symlinks: platform !== "win32" });
      if (!plan.ok) return { ok: false, refused: plan.refused, error: plan.message || "Nothing to put back." };
      if (!plan.restore.length) return { ok: true, reverted: 0, note: "Those files are already back." };
      if (await busy(root)) return { ok: false, busy: true, error: "A builder started working in this folder. Nothing was changed." };
      const held = await contentsNow(root, plan.restore);
      const applied = await apply(root, plan, held);
      return applied.ok ? { ok: true, reverted: applied.count } : { ok: false, error: applied.error };
    });
  });

  // ---- keeping the refs few ----------------------------------------------------------------------------------------
  async function pruneRefs(root) {
    const rows = await refsOf(root);
    const doomed = rules.prunePlan(rows);
    for (let from = 0; from < doomed.length; from += 100) {
      const batch = doomed.slice(from, from + 100);
      await git(root, ["update-ref", "--stdin"], { input: `${batch.map((ref) => `delete ${ref}`).join("\n")}\n`, timeout: 30000 });
    }
    return { ok: true, pruned: doomed.length };
  }

  // A listing for the host's own use (the run's number lookup, the receipts).
  const attemptsFor = guard("attempts", async ({ root, taskId } = {}) => {
    const key = rules.taskKey(taskId);
    const ready = key ? await probe(root) : { ok: false, reason: "unreadable" };
    if (!ready.ok) return { ok: false, reason: ready.reason, attempts: [] };
    return { ok: true, attempts: rules.attemptsOf(await refsOf(root, key), key) };
  });

  return { begin, end, changes, diff, revert, undo, prune: guard("prune", async ({ root } = {}) => pruneRefs(root)), attempts: attemptsFor, probe: guard("probe", probe) };
}

module.exports = { createAttemptSnapshots };
