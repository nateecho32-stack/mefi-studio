// Per-run git worktrees for executor dispatch.
//
// Concurrent executor runs in one repository share .git/index, so parallel
// `git add`/`git commit` sequences contend on index.lock and one session's
// staged files can be swept into another's commit. A per-run worktree gives
// every dispatch its own checkout and its own index; the only shared-tree
// git writes left are the serialized merge-backs in settle().
//
// Opt-in (MEFI_STUDIO_WORKTREE_RUNS=1) until the owner flips the default: a
// worktree starts from HEAD, so in-flight uncommitted work in the shared
// tree stays invisible to a run until it lands.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const GIT_TIMEOUT_MS = 120000;

function runGit(root, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("git", args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: String(error?.message ?? error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const close = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      close(-1);
    }, GIT_TIMEOUT_MS);
    timer.unref?.();
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      stderr += String(error?.message ?? error);
      close(-1);
    });
    child.on("close", (code) => close(code ?? -1));
  });
}

function enabled(env = process.env) {
  return Boolean(env && env.MEFI_STUDIO_WORKTREE_RUNS === "1");
}

// Run ids reach the filesystem (worktree dir) and a branch name; anything
// outside a flat token would be a path/branch injection.
function safeRunId(runId) {
  return typeof runId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(runId) ? runId : null;
}

async function isRepo(root) {
  const probe = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  return probe.code === 0 && probe.stdout.trim() === "true";
}

// The worktree root lives inside the repository; ignore it in the LOCAL
// exclude file so no tracked .gitignore (shared with every session) moves.
async function excludeWorktrees(root) {
  const where = await runGit(root, ["rev-parse", "--git-path", "info/exclude"]);
  if (where.code !== 0) return;
  const file = path.resolve(root, where.stdout.trim());
  try {
    const current = fs.readFileSync(file, "utf8");
    if (current.split(/\r?\n/).some((line) => line.trim() === ".mefi/worktrees/")) return;
    fs.appendFileSync(file, `${current.endsWith("\n") ? "" : "\n"}.mefi/worktrees/\n`);
  } catch {
    // A missing exclude file only costs status noise; it never blocks a run.
  }
}

async function worktreeExists(root, dir) {
  const list = await runGit(root, ["worktree", "list", "--porcelain"]);
  if (list.code !== 0) return false;
  const wanted = path.resolve(dir);
  return list.stdout.split(/\r?\n/).some((line) => line.startsWith("worktree ") && path.resolve(line.slice(9).trim()) === wanted);
}

async function prepare({ root, runId, base = "HEAD" } = {}) {
  const id = safeRunId(runId);
  if (!id || typeof root !== "string" || !root.trim()) throw new Error("worktree: invalid root or run id");
  if (!await isRepo(root)) throw new Error("worktree: root is not a git work tree");
  await excludeWorktrees(root);
  const dir = path.join(root, ".mefi", "worktrees", id);
  const branch = `mefi/${id}`;
  // A crashed previous attempt can leave the directory or branch behind. The
  // stale checkout is disposable; the branch may hold unmerged commits, so it
  // is renamed aside for inspection instead of deleted.
  if (await worktreeExists(root, dir)) {
    const removed = await runGit(root, ["worktree", "remove", "--force", dir]);
    if (removed.code !== 0) throw new Error(`worktree: cannot clear stale checkout: ${removed.stderr.trim().slice(0, 160)}`);
  }
  const branches = await runGit(root, ["branch", "--list", branch]);
  if (branches.code === 0 && branches.stdout.trim()) {
    const renamed = await runGit(root, ["branch", "-m", branch, `mefi/orphan/${id}/${Date.now()}`]);
    if (renamed.code !== 0) throw new Error(`worktree: cannot set aside stale branch: ${renamed.stderr.trim().slice(0, 160)}`);
  }
  const added = await runGit(root, ["worktree", "add", "-b", branch, dir, base]);
  if (added.code !== 0) throw new Error(`worktree: checkout failed: ${added.stderr.trim().slice(0, 160)}`);
  return { root, path: dir, branch, runId: id };
}

async function removeWorktree(worktree) {
  const soft = await runGit(worktree.root, ["worktree", "remove", worktree.path]);
  if (soft.code === 0) return true;
  const forced = await runGit(worktree.root, ["worktree", "remove", "--force", worktree.path]);
  return forced.code === 0;
}

// A run cancelled before its spawn: nothing was merged, so the checkout and
// the branch can simply go.
async function discard(worktree) {
  if (!worktree) return { discarded: true };
  const removed = await removeWorktree(worktree);
  await runGit(worktree.root, ["branch", "-D", worktree.branch]);
  return { discarded: removed };
}

const CONFLICT = /conflict|automatic merge failed|local changes|would be overwritten|uncommitted changes|not possible to fast-forward|need to merge/i;

async function mergeBack(worktree) {
  // One merge into the shared tree at a time from this process (settle's
  // queue); git's own index.lock serializes against other processes, and a
  // lock race retries. Every terminal state except success KEEPS the branch,
  // so no run outcome is ever silently dropped.
  for (const delay of [0, 250, 1500]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const merged = await runGit(worktree.root, ["merge", "--no-edit", worktree.branch]);
    if (merged.code === 0) {
      // Uncommitted edits left inside the worktree were never merged — the
      // checkout must survive for recovery, or the run's work evaporates.
      const dirty = await runGit(worktree.path, ["status", "--porcelain"]);
      if (dirty.code === 0 && dirty.stdout.trim()) {
        return { merged: true, keptWorktree: worktree.path, reason: "run left uncommitted edits in its worktree — kept for recovery" };
      }
      await removeWorktree(worktree);
      await runGit(worktree.root, ["branch", "-d", worktree.branch]);
      return { merged: true, upToDate: /already up to date/i.test(merged.stdout) };
    }
    await runGit(worktree.root, ["merge", "--abort"]); // no-op when no merge started
    if (/index\.lock/i.test(merged.stderr)) continue;
    const lines = merged.stderr.trim().split(/\r?\n/).filter((line) => line.trim());
    return { merged: false, reason: lines[0] || (CONFLICT.test(merged.stderr) ? "merge conflict" : "merge failed") };
  }
  return { merged: false, reason: "index.lock stayed busy through retries" };
}

// Serialized per repository: merge-backs from this process never overlap.
function settle(worktree) {
  if (!worktree) return Promise.resolve({ merged: true, upToDate: true });
  const previous = queues.get(worktree.root) ?? Promise.resolve();
  const task = previous.then(() => mergeBack(worktree));
  queues.set(worktree.root, task.then(() => {}, () => {}));
  return task;
}

const queues = new Map();

module.exports = { enabled, prepare, settle, discard, safeRunId };
