// Guard tests for scripts/worktree-actions.mjs: what Studio may do to a
// worktree. Merge a branch into the default branch (fast-forward, or a merge
// commit when asked), remove a folder (with a kept copy when it would lose
// anything), forget folders that are gone. Every refusal is proven to change
// nothing. Throwaway repositories stand in for GitHub and a PC; nothing touches
// the network or the live tree.
//
// Run: node --test tests/worktree_actions.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runGit } from "../scripts/sync.mjs";
import { mergeWorktree, pruneWorktrees, removeWorktree, worktreeFolder } from "../scripts/worktree-actions.mjs";

async function run(cwd, ...args) {
  const out = await runGit(cwd, args);
  assert.ok(out.ok, `git ${args.join(" ")}: ${out.stderr}`);
  return out.stdout;
}

async function configure(cwd) {
  for (const [key, value] of [["user.name", "Worktree Fixture"], ["user.email", "worktrees@fixture.invalid"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) await run(cwd, "config", key, value);
}

async function commit(cwd, name, body = `${name}\n`) {
  writeFileSync(path.join(cwd, name), body);
  await run(cwd, "add", name);
  await run(cwd, "commit", "-q", "-m", `Add ${name}`);
}

async function project(t) {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-wt-actions-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const repo = path.join(root, "repo");
  const hub = path.join(root, "hub.git");
  await run(root, "init", "-q", "-b", "main", repo);
  await configure(repo);
  await commit(repo, "README.md");
  await run(root, "init", "-q", "--bare", "-b", "main", hub);
  await run(repo, "remote", "add", "origin", hub);
  await run(repo, "push", "-q", "-u", "origin", "main");
  // A project ignores where Studio keeps task runs and the link to its install.
  writeFileSync(path.join(repo, ".git", "info", "exclude"), ".mefi/\nnode_modules\n");
  const at = (name) => path.join(root, name);
  // A worktree on a new branch holding one commit.
  const branch = async (name, { file = `${name}.txt`, body } = {}) => {
    await run(repo, "worktree", "add", "-q", "-b", `wip/${name}`, at(name));
    await configure(at(name));
    if (file) await commit(at(name), file, body);
    return at(name);
  };
  return { root, repo, hub, at, branch, ref: (cwd, name) => run(cwd, "rev-parse", name) };
}

const heads = async (repo) => run(repo, "for-each-ref", "--format=%(refname) %(objectname)");
// A Windows temp folder is 8.3 short to Node and long to git: compare what is on disk.
const same = (left, right) => realpathSync.native(left).toLowerCase() === realpathSync.native(right).toLowerCase();

test("a branch is fast-forwarded into the default branch, and can be removed with it", async (t) => {
  const { repo, hub, branch, at } = await project(t);
  const wt = await branch("feature");
  const hubBefore = await run(hub, "rev-parse", "main");
  const merged = await mergeWorktree(repo, wt, { remove: true });
  assert.equal(merged.ok, true, merged.error);
  assert.equal(merged.how, "fast-forward");
  assert.equal(merged.into, "main");
  assert.equal(merged.branch, "wip/feature");
  assert.match(merged.note, /this PC only/, "it says plainly that nothing was pushed");
  assert.equal(await run(repo, "rev-parse", "--short", "HEAD"), merged.head);
  assert.ok(existsSync(path.join(repo, "feature.txt")), "the work is in the main checkout now");
  assert.equal(merged.removed.ok, true, merged.removed.error);
  assert.equal(merged.removed.branchDeleted, true, "a merged branch goes with its folder");
  assert.ok(!existsSync(at("feature")));
  assert.equal(await run(repo, "branch", "--list", "wip/feature"), "");
  assert.equal(await run(hub, "rev-parse", "main"), hubBefore, "merging never pushes");
});

test("without remove the folder and the branch stay", async (t) => {
  const { repo, branch } = await project(t);
  const wt = await branch("keep");
  const merged = await mergeWorktree(repo, wt);
  assert.equal(merged.ok, true, merged.error);
  assert.equal(merged.removed, undefined);
  assert.ok(existsSync(wt));
  assert.notEqual(await run(repo, "branch", "--list", "wip/keep"), "");
});

test("the merge is refused, and changes nothing, in every unsafe case", async (t) => {
  const { repo, branch, at } = await project(t);
  const wt = await branch("guarded");
  await run(repo, "branch", "elsewhere");
  const before = await heads(repo);
  const head = await run(repo, "rev-parse", "HEAD");
  const refused = async (target, pattern, options, extra = {}) => {
    const result = await mergeWorktree(repo, target, options);
    assert.equal(result.ok, false, "refused");
    assert.match(result.error, pattern);
    for (const [key, value] of Object.entries(extra)) assert.equal(result[key], value, key);
    assert.equal(await heads(repo), before, "no ref moved");
    assert.equal(await run(repo, "rev-parse", "HEAD"), head);
    return result;
  };

  await refused(at("never-heard-of"), /not one of this project's worktrees/);
  await refused(repo, /main checkout, so there is nothing to merge into main/);

  await refused(wt, /A run is still working in this worktree/, { inUse: (folder) => same(folder, wt) }, { busy: true });
  await refused(wt, /Agents are still changing files in this project\. Merge anyway\?/, { builders: true }, { needsAnyway: true });

  writeFileSync(path.join(wt, "scratch.txt"), "not saved\n");
  await refused(wt, /^It has 1 uncommitted file\. Commit them in the worktree first/, {}, { dirty: 1 });
  rmSync(path.join(wt, "scratch.txt"));

  writeFileSync(path.join(repo, "mine.txt"), "in the way\n");
  await refused(wt, /^The main checkout has 1 uncommitted file\./, {}, { primaryDirty: 1 });
  rmSync(path.join(repo, "mine.txt"));

  await run(repo, "checkout", "-q", "elsewhere");
  await refused(wt, /^The main checkout is on elsewhere, not main\. Switch it to main first\./, {}, { primaryBranch: "elsewhere" });
  await run(repo, "checkout", "-q", "main");

  writeFileSync(path.join(repo, ".git", "MERGE_HEAD"), `${head}\n`);
  await refused(wt, /^The main checkout is in the middle of a merge\./);
  rmSync(path.join(repo, ".git", "MERGE_HEAD"));

  await run(repo, "worktree", "add", "-q", "--detach", at("loose"));
  await refused(at("loose"), /It is on no branch/);

  // And with all of that cleared, it goes.
  const merged = await mergeWorktree(repo, wt);
  assert.equal(merged.ok, true, merged.error);
});

test("a branch already in the default branch has nothing to merge", async (t) => {
  const { repo, at } = await project(t);
  await run(repo, "worktree", "add", "-q", "-b", "wip/same", at("same"));
  const result = await mergeWorktree(repo, at("same"));
  assert.equal(result.ok, false);
  assert.equal(result.alreadyMerged, true);
  assert.match(result.error, /Nothing to merge: wip\/same has no commits that main lacks\./);
});

test("the count is against the local default branch, not GitHub's copy of it", async (t) => {
  const { repo, branch } = await project(t);
  const wt = await branch("landed");
  // The work is in local main already (merged by hand) but main is not pushed yet.
  await run(repo, "merge", "-q", "--ff-only", "wip/landed");
  const result = await mergeWorktree(repo, wt);
  assert.equal(result.ok, false);
  assert.equal(result.alreadyMerged, true, "GitHub still lacks these commits, but main does not");
});

test("when the default branch has moved on a plain merge is refused, and a merge commit is made only when asked", async (t) => {
  const { repo, branch } = await project(t);
  const wt = await branch("behind");
  await commit(repo, "elsewhere.txt");
  const before = await run(repo, "rev-parse", "HEAD");
  const plain = await mergeWorktree(repo, wt);
  assert.equal(plain.ok, false);
  assert.equal(plain.needsMergeCommit, true);
  assert.match(plain.error, /main has moved on since wip\/behind started, so it cannot be fast-forwarded/);
  assert.equal(await run(repo, "rev-parse", "HEAD"), before);

  const merged = await mergeWorktree(repo, wt, { mode: "merge" });
  assert.equal(merged.ok, true, merged.error);
  assert.equal(merged.how, "merge commit");
  assert.ok(existsSync(path.join(repo, "behind.txt")) && existsSync(path.join(repo, "elsewhere.txt")), "both sides are in main");
  assert.equal((await run(repo, "rev-list", "--parents", "-n", "1", "HEAD")).split(" ").length, 3, "a real merge commit with two parents");
});

test("a merge that conflicts is undone: nothing changes, no half-done merge is left behind", async (t) => {
  const { repo, branch } = await project(t);
  const wt = await branch("clash", { file: "shared.txt", body: "theirs\n" });
  await commit(repo, "shared.txt", "ours\n");
  const before = await run(repo, "rev-parse", "HEAD");
  const result = await mergeWorktree(repo, wt, { mode: "merge" });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.match(result.error, /wip\/clash: it conflicts with main\. Nothing was changed\./);
  assert.equal(await run(repo, "rev-parse", "HEAD"), before);
  assert.equal((await runGit(repo, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).ok, false, "the merge was aborted");
  assert.equal(await run(repo, "status", "--porcelain"), "", "the main checkout is clean again");
  assert.equal(readFileSync(path.join(repo, "shared.txt"), "utf8"), "ours\n");
});

test("agents changing files stop a merge until the caller says anyway", async (t) => {
  const { repo, branch } = await project(t);
  const wt = await branch("busy");
  assert.equal((await mergeWorktree(repo, wt, { builders: true })).needsAnyway, true);
  const merged = await mergeWorktree(repo, wt, { builders: true, anyway: true });
  assert.equal(merged.ok, true, merged.error);
});

test("a clean, merged worktree is removed; its branch goes only when asked and only when fully merged", async (t) => {
  const { repo, branch, at } = await project(t);
  await run(repo, "worktree", "add", "-q", "-b", "wip/done", at("done"));
  const first = await removeWorktree(repo, at("done"));
  assert.equal(first.ok, true, first.error);
  assert.equal(first.removed, true);
  assert.equal(first.rescued, null, "nothing was at risk, so no copy was needed");
  assert.equal(first.branchDeleted, undefined, "the branch stays unless asked");
  assert.ok(!existsSync(at("done")));
  assert.notEqual(await run(repo, "branch", "--list", "wip/done"), "");

  await run(repo, "worktree", "add", "-q", "-b", "wip/done2", at("done2"));
  const second = await removeWorktree(repo, at("done2"), { deleteBranch: true });
  assert.equal(second.branchDeleted, true);
  assert.equal(await run(repo, "branch", "--list", "wip/done2"), "");

  const wt = await branch("unmerged");
  const third = await removeWorktree(repo, wt, { deleteBranch: true });
  assert.equal(third.ok, true, "committed work in a branch is not lost by removing its folder");
  assert.equal(third.branchDeleted, false, "git refuses to delete a branch that is not merged");
  assert.match(third.branchKept, /^wip\/unmerged stays: /);
  assert.notEqual(await run(repo, "branch", "--list", "wip/unmerged"), "", "and the commits are still there");
});

test("uncommitted files need force, and a copy is kept as a ref before the folder goes", async (t) => {
  const { repo, branch } = await project(t);
  const wt = await branch("dirty");
  writeFileSync(path.join(wt, "notes.txt"), "only here\n");
  writeFileSync(path.join(wt, "dirty.txt"), "edited\n");
  const refs = await heads(repo);

  const asked = await removeWorktree(repo, wt);
  assert.equal(asked.ok, false);
  assert.equal(asked.needsForce, true);
  assert.equal(asked.dirty, 2);
  assert.match(asked.error, /^Removing it would lose 2 uncommitted files\. A copy is kept as a ref/);
  assert.ok(existsSync(wt), "nothing was removed");
  assert.equal(await heads(repo), refs);

  const forced = await removeWorktree(repo, wt, { force: true });
  assert.equal(forced.ok, true, forced.error);
  assert.match(forced.rescued, /^refs\/mefi\/rescue\/dirty-\d{8}T\d{6}$/);
  assert.ok(!existsSync(wt));
  // The copy has both files, and the branch still has its commit.
  assert.equal(await run(repo, "show", `${forced.rescued}:notes.txt`), "only here");
  assert.equal(await run(repo, "show", `${forced.rescued}:dirty.txt`), "edited");
  assert.equal(await run(repo, "rev-list", "--count", `main..${forced.rescued}`), "2", "the copy sits on the branch's own commit");
  assert.equal(await run(repo, "rev-list", "--count", "main..wip/dirty"), "1");
});

test("commits on no branch need force too, and the copy keeps them", async (t) => {
  const { repo, at } = await project(t);
  await run(repo, "worktree", "add", "-q", "--detach", at("loose"));
  await configure(at("loose"));
  await commit(at("loose"), "orphan.txt");
  const sha = await run(at("loose"), "rev-parse", "HEAD");
  const asked = await removeWorktree(repo, at("loose"));
  assert.equal(asked.ok, false);
  assert.equal(asked.orphaned, true);
  assert.match(asked.error, /would lose commits that are on no branch/);
  const forced = await removeWorktree(repo, at("loose"), { force: true });
  assert.equal(forced.ok, true, forced.error);
  assert.ok(!existsSync(at("loose")));
  assert.equal(await run(repo, "merge-base", "--is-ancestor", sha, forced.rescued).catch(() => "no"), "", "the loose commit is an ancestor of the kept copy");

  // A detached folder whose commit some branch already holds loses nothing.
  await run(repo, "worktree", "add", "-q", "--detach", at("held"), "main");
  const held = await removeWorktree(repo, at("held"));
  assert.equal(held.ok, true, held.error);
});

test("the main checkout, a locked worktree, a run in progress and a stranger are never removed", async (t) => {
  const { repo, branch, at } = await project(t);
  const wt = await branch("mine");
  const before = await heads(repo);
  assert.match((await removeWorktree(repo, repo)).error, /main checkout\. Studio never removes it/);
  assert.match((await removeWorktree(repo, at("stranger"), { force: true })).error, /not one of this project's worktrees/);
  assert.equal((await removeWorktree(repo, wt, { inUse: () => true })).busy, true);
  await run(repo, "worktree", "lock", "--reason", "a session is in it", wt);
  const locked = await removeWorktree(repo, wt, { force: true });
  assert.equal(locked.ok, false);
  assert.equal(locked.locked, true);
  assert.match(locked.error, /It is locked \(a session is in it\)/);
  assert.ok(existsSync(wt));
  assert.equal(await heads(repo), before);
});

test("the link a task run gets to the shared install goes as a link: the install itself survives", async (t) => {
  const { repo, branch, root } = await project(t);
  const shared = path.join(root, "shared-node-modules");
  mkdirSync(shared);
  writeFileSync(path.join(shared, "keep.txt"), "must survive\n");
  const wt = await branch("linked");
  symlinkSync(shared, path.join(wt, "node_modules"), "junction");
  assert.ok(lstatSync(path.join(wt, "node_modules")).isSymbolicLink());
  const removed = await removeWorktree(repo, wt);
  assert.equal(removed.ok, true, removed.error);
  assert.ok(!existsSync(wt));
  assert.equal(readFileSync(path.join(shared, "keep.txt"), "utf8"), "must survive\n");
});

test("folders that are gone are forgotten, and nothing else is", async (t) => {
  const { repo, branch, at } = await project(t);
  await branch("stays");
  const gone = await branch("gone");
  rmSync(gone, { recursive: true, force: true });
  const forgotten = await pruneWorktrees(repo);
  assert.equal(forgotten.ok, true, forgotten.error);
  assert.equal(forgotten.pruned, 1);
  assert.deepEqual(forgotten.names, ["gone"]);
  assert.match(await run(repo, "worktree", "list", "--porcelain"), /stays/);
  assert.doesNotMatch(await run(repo, "worktree", "list", "--porcelain"), /worktree .*gone/);
  assert.notEqual(await run(repo, "branch", "--list", "wip/gone"), "", "the branch and its commit stay");
  assert.ok(existsSync(at("stays")));
  assert.equal((await pruneWorktrees(repo)).pruned, 0);
  // Asking to remove a folder that is already gone is the same forgetting.
  const again = await branch("gone2");
  rmSync(again, { recursive: true, force: true });
  const viaRemove = await removeWorktree(repo, again);
  assert.equal(viaRemove.ok, true, viaRemove.error);
  assert.equal(viaRemove.pruned, 1);
});

test("Open only ever names a listed folder that exists", async (t) => {
  const { repo, branch, at } = await project(t);
  const wt = await branch("look");
  const opened = await worktreeFolder(repo, wt);
  assert.equal(opened.ok, true, opened.error);
  assert.ok(same(opened.path, wt));
  assert.equal((await worktreeFolder(repo, at("elsewhere"))).ok, false);
  assert.equal((await worktreeFolder(repo, path.join(wt, ".."))).ok, false, "a parent of a worktree is not one");
  rmSync(wt, { recursive: true, force: true });
  assert.match((await worktreeFolder(repo, wt)).error, /folder is gone/);
});

test("a folder that is not a repository is said so, and the module never reaches for the network", async (t) => {
  const plain = mkdtempSync(path.join(tmpdir(), "mefi-wt-plain-"));
  t.after(() => rmSync(plain, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  assert.match((await mergeWorktree(plain, plain)).error, /not a Git repository/);
  assert.match((await removeWorktree(plain, plain)).error, /not a Git repository/);
  assert.match((await pruneWorktrees(plain)).error, /not a Git repository/);
  const source = readFileSync(new URL("../scripts/worktree-actions.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /"(?:fetch|push|pull|clone|ls-remote)"/, "no network verb is ever spelled in a git call");
  assert.doesNotMatch(source, /--force-with-lease|push --force|reset --hard|clean -f|checkout --/, "nothing destructive on a shared branch");
});
