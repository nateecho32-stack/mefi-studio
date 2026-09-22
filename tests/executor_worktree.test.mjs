import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import worktrees from "../scripts/executor-worktrees.cjs";

const run = promisify(execFile);
const git = (dir, ...args) => run("git", ["-C", dir, ...args]);
const gitOut = async (dir, ...args) => (await git(dir, ...args)).stdout.trim();

async function makeRepo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-wt-"));
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "fixture@example.com");
  await git(dir, "config", "user.name", "Fixture");
  await writeFile(path.join(dir, "file.txt"), "one\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "init");
  return dir;
}

const commitAll = async (dir, message) => {
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", message);
};

test("the feature is opt-in and run ids stay flat tokens", () => {
  assert.equal(worktrees.enabled({}), false);
  assert.equal(worktrees.enabled({ MEFI_STUDIO_WORKTREE_RUNS: "0" }), false);
  assert.equal(worktrees.enabled({ MEFI_STUDIO_WORKTREE_RUNS: "1" }), true);
  assert.equal(worktrees.safeRunId("run_1790086546968_25"), "run_1790086546968_25");
  for (const bad of ["../evil", "a/b", "a b", "", null, undefined, "x".repeat(81)]) {
    assert.equal(worktrees.safeRunId(bad), null, `${JSON.stringify(bad)} must not reach the filesystem`);
  }
});

test("prepare checks a run out into its own worktree; settle merges a committed run back and cleans up", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo, { recursive: true, force: true }));
  const wt = await worktrees.prepare({ root: repo, runId: "run_1" });
  assert.ok(existsSync(path.join(wt.path, "file.txt")), "the checkout carries the committed tree");
  assert.equal(wt.branch, "mefi/run_1");
  assert.ok(wt.path.startsWith(path.join(repo, ".mefi", "worktrees")), "checkouts live under the ignored worktree root");
  const exclude = await readFile(path.join(repo, ".git", "info", "exclude"), "utf8");
  assert.match(exclude, /\.mefi\/worktrees\//);
  await writeFile(path.join(wt.path, "file.txt"), "two\n");
  await commitAll(wt.path, "run edit");
  const result = await worktrees.settle(wt);
  assert.equal(result.merged, true);
  assert.equal((await readFile(path.join(repo, "file.txt"), "utf8")).replace(/\r\n/g, "\n"), "two\n", "the run's commit reached the shared tree");
  assert.equal(existsSync(wt.path), false, "a clean merged checkout is removed");
  assert.equal(await gitOut(repo, "branch", "--list", "mefi/run_1"), "", "the merged branch is deleted");
});

test("a dirty shared tree blocks merge-back without losing the run's branch", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo, { recursive: true, force: true }));
  const wt = await worktrees.prepare({ root: repo, runId: "run_2" });
  await writeFile(path.join(wt.path, "file.txt"), "two\n");
  await commitAll(wt.path, "run edit");
  await writeFile(path.join(repo, "file.txt"), "dirty\n");
  const result = await worktrees.settle(wt);
  assert.equal(result.merged, false);
  assert.match(result.reason, /local changes|would be overwritten|merge/i);
  assert.equal((await readFile(path.join(repo, "file.txt"), "utf8")).replace(/\r\n/g, "\n"), "dirty\n", "the operator's uncommitted edit is untouched");
  assert.ok((await gitOut(repo, "branch", "--list", "mefi/run_2")).includes("mefi/run_2"), "the unmerged branch survives for a later retry");
});

test("settle keeps a worktree whose run left uncommitted edits", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo, { recursive: true, force: true }));
  const wt = await worktrees.prepare({ root: repo, runId: "run_3" });
  await writeFile(path.join(wt.path, "uncommitted.txt"), "draft\n");
  const result = await worktrees.settle(wt);
  assert.equal(result.merged, true);
  assert.equal(result.keptWorktree, wt.path, "nothing is destroyed while edits were never committed");
  assert.equal(await readFile(path.join(wt.path, "uncommitted.txt"), "utf8"), "draft\n");
});

test("concurrent settles from one process both land in the shared tree", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo, { recursive: true, force: true }));
  const first = await worktrees.prepare({ root: repo, runId: "run_4" });
  const second = await worktrees.prepare({ root: repo, runId: "run_5" });
  await writeFile(path.join(first.path, "a.txt"), "a\n");
  await commitAll(first.path, "a");
  await writeFile(path.join(second.path, "b.txt"), "b\n");
  await commitAll(second.path, "b");
  const [one, two] = await Promise.all([worktrees.settle(first), worktrees.settle(second)]);
  assert.equal(one.merged, true);
  assert.equal(two.merged, true);
  assert.equal(existsSync(path.join(repo, "a.txt")), true);
  assert.equal(existsSync(path.join(repo, "b.txt")), true);
  const log = await gitOut(repo, "log", "--oneline");
  assert.match(log, /(^|\n)[0-9a-f]+ a(\n|$)/, "both run commits reached HEAD (a merge commit may join them)");
});

test("a crashed attempt's stale checkout goes and its branch is kept aside", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo, { recursive: true, force: true }));
  const stale = await worktrees.prepare({ root: repo, runId: "run_6" });
  await writeFile(path.join(stale.path, "file.txt"), "stranded\n");
  await commitAll(stale.path, "stranded work"); // commits the crashed run never merged back
  const fresh = await worktrees.prepare({ root: repo, runId: "run_6" });
  assert.equal(fresh.path, stale.path, "the same run slot is reused");
  assert.equal((await readFile(path.join(fresh.path, "file.txt"), "utf8")).replace(/\r\n/g, "\n"), "one\n", "the fresh checkout starts from HEAD, not the stranded edits");
  assert.ok((await gitOut(repo, "branch", "--list", "mefi/orphan/run_6/*")).length > 0, "the stranded commits stay reachable on a renamed branch");
  assert.ok((await gitOut(repo, "branch", "--list", "mefi/run_6")).includes("mefi/run_6"));
  await worktrees.discard(fresh);
  assert.equal(await gitOut(repo, "branch", "--list", "mefi/run_6"), "", "discard drops a never-run branch");
});

test("prepare refuses roots that are not git work trees", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-nowt-"));
  try {
    await assert.rejects(() => worktrees.prepare({ root: dir, runId: "run_x" }), /not a git work tree/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a checkout shares the root install through a junction and cleanup never deletes the shared node_modules", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo, { recursive: true, force: true }));
  await mkdir(path.join(repo, "node_modules", "probe-pkg"), { recursive: true });
  await writeFile(path.join(repo, "node_modules", "probe-pkg", "marker.txt"), "shared\n");
  const wt = await worktrees.prepare({ root: repo, runId: "run_7" });
  assert.equal(wt.nodeModules, "junction");
  assert.equal(
    await readFile(path.join(wt.path, "node_modules", "probe-pkg", "marker.txt"), "utf8"),
    "shared\n",
    "the run resolves the shared install through the link",
  );
  assert.equal(realpathSync(path.join(wt.path, "node_modules")), realpathSync(path.join(repo, "node_modules")));
  const result = await worktrees.settle(wt); // nothing committed: clean remove path
  assert.equal(result.merged, true);
  assert.equal(existsSync(wt.path), false, "the checkout is removed");
  assert.equal(
    await readFile(path.join(repo, "node_modules", "probe-pkg", "marker.txt"), "utf8"),
    "shared\n",
    "removing the checkout never recursed into the shared install",
  );
});

test("no shared install and no lockfile leaves the checkout unbuildable but runnable", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo, { recursive: true, force: true }));
  const wt = await worktrees.prepare({ root: repo, runId: "run_8" });
  assert.equal(wt.nodeModules, "missing", "no junction and no npm ci without a lockfile to install from");
  assert.equal(existsSync(path.join(wt.path, "node_modules")), false);
  await worktrees.discard(wt);
});

test("a lockfile without a shared install reaches for npm ci only when the kill-switch allows it", async (t) => {
  const repo = await makeRepo();
  t.after(() => rm(repo, { recursive: true, force: true }));
  await writeFile(path.join(repo, "package-lock.json"), `${JSON.stringify({ name: "fixture", lockfileVersion: 3, packages: {} }, null, 2)}\n`);
  const previous = process.env.MEFI_STUDIO_WORKTREE_NPM_CI;
  process.env.MEFI_STUDIO_WORKTREE_NPM_CI = "0";
  let wt;
  try {
    wt = await worktrees.prepare({ root: repo, runId: "run_9" });
    assert.equal(wt.nodeModules, "missing", "the opt-out keeps even a lockfile-carrying checkout from spawning npm ci");
    assert.equal(existsSync(path.join(wt.path, "node_modules")), false, "neither a junction nor an install appeared");
  } finally {
    if (previous === undefined) delete process.env.MEFI_STUDIO_WORKTREE_NPM_CI;
    else process.env.MEFI_STUDIO_WORKTREE_NPM_CI = previous;
  }
  await worktrees.discard(wt);
});
