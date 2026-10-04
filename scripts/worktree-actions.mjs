// Mefi's Studio AI+ - what a person may do to a worktree from Studio: merge its
// branch into the default branch, remove it, forget folders that are gone.
//
// scripts/worktrees.mjs only reads (`npm run worktrees`, the session hook). This
// is the module that writes, and it is loaded by Studio's host only, so the
// read-only promise of the table stays true. It writes in ways that lose
// nothing:
//
//   merge     fast-forward only, unless the caller asks for a merge commit. It
//             refuses while the worktree has uncommitted files (a merge takes
//             only what is committed), while the main checkout is on another
//             branch, has uncommitted files or is in the middle of a merge, and
//             while agents are changing files (unless the caller says anyway).
//             A merge that conflicts is aborted and changes nothing.
//   remove    refuses the main checkout, a locked worktree and a run that is
//             still using its folder. A folder with uncommitted files, or
//             commits that exist nowhere else, needs `force`, and even then a
//             copy is kept first as refs/mefi/rescue/<name>-<time> (git branch
//             <name> <that ref> brings it back). The branch stays unless it is
//             fully merged and the caller asked for it to go (`git branch -d`).
//   forget    `git worktree prune`: only folders that are gone.
//
// Neither ever pushes, fetches or forces anything on a shared branch. A path
// from the caller is only used when git lists it as one of the project's
// worktrees. Text that leaves passes through scrub (no credentials).
import { lstatSync, unlinkSync } from "node:fs";
import path from "node:path";
import { runGit, scrub } from "./sync.mjs";
import { inspectWorktree } from "./worktrees.mjs";

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const refuse = (error, extra = {}) => ({ ok: false, error: scrub(error), ...extra });
// A rescue that would have to copy a whole install (a project that does not ignore node_modules) is refused, not attempted.
const RESCUE_MAX_FILES = 3000;

function firstLine(text) {
  return String(text ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

// The link a task run gets to the shared node_modules must go as a link: removing
// the folder must never recurse into the shared install.
function dropNodeModulesLink(folder) {
  try {
    const link = path.join(folder, "node_modules");
    if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
  } catch {
    // No link, nothing to drop.
  }
}

async function midway(git, folder) {
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"]) {
    if ((await git(folder, ["rev-parse", "-q", "--verify", marker])).ok) return marker === "MERGE_HEAD" ? "a merge" : marker === "REVERT_HEAD" ? "a revert" : "a cherry-pick";
  }
  for (const dir of ["rebase-merge", "rebase-apply"]) {
    const where = await git(folder, ["rev-parse", "--git-path", dir]);
    if (where.ok) {
      try { lstatSync(path.resolve(folder, where.stdout)); return "a rebase"; } catch { /* not there */ }
    }
  }
  return null;
}

// One worktree found, or the reason it cannot be acted on.
async function find(root, target, run) {
  const found = await inspectWorktree(root, target, { run });
  if (!found.repo) return { error: refuse("This folder is not a Git repository.") };
  if (!found.row) return { error: refuse("That folder is not one of this project's worktrees.") };
  return { found };
}

export async function mergeWorktree(root, target, { mode = "ff", remove = false, builders = false, anyway = false, inUse = () => false, run = runGit } = {}) {
  const { found, error } = await find(root, target, run);
  if (error) return error;
  const { row, primary, main } = found;
  const git = (folder, args) => run(folder, args);
  if (!primary) return refuse(`That is the main checkout, so there is nothing to merge into ${main}.`);
  if (row.missing) return refuse("That worktree's folder is gone. Forget it first.");
  if (row.detached || !row.branch) return refuse("It is on no branch. Put its commits on a branch first, then merge.");
  if (inUse(row.path)) return refuse("A run is still working in this worktree. Wait for it to finish.", { busy: true });
  if (row.dirty) return refuse(`It has ${plural(row.dirty, "uncommitted file")}. Commit them in the worktree first: a merge only takes what is committed.`, { dirty: row.dirty });
  // Against the local default branch, which is what the merge goes into (the row's own
  // count is against GitHub's copy, which may be behind it).
  const toMerge = Number((await git(primary.path, ["rev-list", "--count", `${main}..${row.branch}`])).stdout) || 0;
  if (!toMerge) return refuse(`Nothing to merge: ${row.branch} has no commits that ${main} lacks.`, { alreadyMerged: true });
  if (primary.branch !== main) return refuse(`The main checkout is on ${primary.branch ?? "no branch"}, not ${main}. Switch it to ${main} first.`, { primaryBranch: primary.branch });
  if (primary.dirty) return refuse(`The main checkout has ${plural(primary.dirty, "uncommitted file")}. Commit or stash them first, so the merge does not mix with them.`, { primaryDirty: primary.dirty });
  const busyWith = await midway(git, primary.path);
  if (busyWith) return refuse(`The main checkout is in the middle of ${busyWith}. Finish or abort it first.`);
  if (builders && !anyway) return refuse("Agents are still changing files in this project. Merge anyway?", { needsAnyway: true });

  let how = "fast-forward";
  let merged = await git(primary.path, ["merge", "--ff-only", row.branch]);
  if (!merged.ok) {
    if (mode !== "merge") return refuse(`${main} has moved on since ${row.branch} started, so it cannot be fast-forwarded. Bring ${main} into the worktree first, or merge with a merge commit.`, { needsMergeCommit: true });
    how = "merge commit";
    merged = await git(primary.path, ["merge", "--no-edit", row.branch]);
    if (!merged.ok) {
      // Only this call's own half-done merge is undone (checked above that none was under way).
      if (await midway(git, primary.path)) await git(primary.path, ["merge", "--abort"]);
      const why = /conflict/i.test(`${merged.stdout}\n${merged.stderr}`) ? "it conflicts with" : "it could not be merged into";
      return refuse(`${row.branch}: ${why} ${main}. Nothing was changed.${firstLine(merged.stderr) && !/conflict/i.test(merged.stderr) ? ` (${firstLine(merged.stderr).slice(0, 160)})` : ""}`, { conflict: /conflict/i.test(`${merged.stdout}\n${merged.stderr}`) });
    }
  }
  const head = (await git(primary.path, ["rev-parse", "--short", "HEAD"])).stdout;
  const result = { ok: true, merged: true, branch: row.branch, into: main, head, how, note: `Merged on this PC only. Save and push, or run npm run sync, to put ${main} on GitHub.` };
  if (remove) result.removed = await removeWorktree(root, row.path, { deleteBranch: true, inUse, run });
  return result;
}

// A copy of everything a folder holds that no commit does, kept as a ref so a
// forced removal can always be undone.
async function rescue(row, run) {
  const git = (args) => run(row.path, args);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const name = row.name.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60) || "worktree";
  const ref = `refs/mefi/rescue/${name}-${stamp}`;
  if (row.dirty > RESCUE_MAX_FILES) return { ok: false, error: `${row.dirty} changed files is too many to keep a copy of.` };
  const head = await git(["rev-parse", "HEAD"]);
  if (!head.ok) return { ok: false, error: firstLine(head.stderr) || "It has no commit to keep a copy on." };
  const staged = await git(["add", "-A"]);
  if (!staged.ok) return { ok: false, error: firstLine(staged.stderr) };
  const tree = await git(["write-tree"]);
  if (!tree.ok) return { ok: false, error: firstLine(tree.stderr) };
  // A machine with no git identity still needs a commit object; borrow one only then.
  const known = (await git(["config", "user.email"])).stdout;
  const identity = known ? [] : ["-c", "user.name=Mefi's Studio", "-c", "user.email=studio@invalid.local"];
  const made = await git([...identity, "commit-tree", tree.stdout, "-p", head.stdout, "-m", `Kept before Studio removed the worktree ${row.name} (${row.branch ?? "no branch"})`]);
  if (!made.ok) return { ok: false, error: firstLine(made.stderr) };
  const saved = await git(["update-ref", ref, made.stdout]);
  if (!saved.ok) return { ok: false, error: firstLine(saved.stderr) };
  return { ok: true, ref };
}

export async function removeWorktree(root, target, { force = false, deleteBranch = false, inUse = () => false, run = runGit } = {}) {
  const { found, error } = await find(root, target, run);
  if (error) return error;
  const { row, primary, main } = found;
  const git = (folder, args) => run(folder, args);
  if (!primary) return refuse("That is the main checkout. Studio never removes it.");
  if (row.locked) return refuse(`It is locked${row.lockedReason ? ` (${row.lockedReason})` : ""}: another session may be using it. Unlock it with git worktree unlock first.`, { locked: true });
  if (inUse(row.path)) return refuse("A run is still working in this worktree. Wait for it to finish.", { busy: true });
  if (row.missing) return pruneWorktrees(root, { run });
  // A branch keeps its commits when its folder goes; only uncommitted files, and commits on
  // no branch at all (a detached HEAD no other ref holds), are lost with the folder.
  const orphaned = row.detached && Boolean(row.sha) && !(await git(root, ["for-each-ref", "--contains", row.sha, "--count=1", "--format=%(refname)"])).stdout;
  const risky = row.dirty > 0 || orphaned;
  if (risky && !force) {
    const lose = [row.dirty ? plural(row.dirty, "uncommitted file") : "", orphaned ? "commits that are on no branch" : ""].filter(Boolean).join(" and ");
    return refuse(`Removing it would lose ${lose}. A copy is kept as a ref if you remove it anyway.`, { needsForce: true, dirty: row.dirty, orphaned });
  }
  let kept = null;
  if (force && risky) {
    const saved = await rescue(row, run);
    if (!saved.ok) return refuse(`A copy could not be kept, so nothing was removed: ${saved.error}`);
    kept = saved.ref;
  }
  dropNodeModulesLink(row.path);
  let gone = await git(primary.path, ["worktree", "remove", ...(force ? ["--force"] : []), row.path]);
  if (!gone.ok) {
    // The rescue staged everything in a folder that is staying: put its index back.
    if (kept) await git(row.path, ["reset", "-q"]);
    const untracked = /modified or untracked|use --force/i.test(gone.stderr);
    return refuse(untracked ? "It holds files git does not track. Remove it anyway to keep a copy first." : `Git could not remove it: ${firstLine(gone.stderr).slice(0, 200)}`, { needsForce: untracked });
  }
  const result = { ok: true, removed: true, name: row.name, path: row.path, branch: row.branch, rescued: kept };
  if (deleteBranch && row.branch && row.branch !== main) {
    const deleted = await git(root, ["branch", "-d", row.branch]);
    result.branchDeleted = deleted.ok;
    if (!deleted.ok) result.branchKept = `${row.branch} stays: ${firstLine(deleted.stderr).slice(0, 160) || "it is not fully merged"}`;
  }
  return result;
}

// Folders that are gone: git forgets them. Nothing else is touched (a locked one is skipped by git).
export async function pruneWorktrees(root, { run = runGit } = {}) {
  const top = await run(root, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return refuse("This folder is not a Git repository.");
  const pruned = await run(root, ["worktree", "prune", "--verbose"]);
  if (!pruned.ok) return refuse(`Git could not forget them: ${firstLine(pruned.stderr).slice(0, 200)}`);
  const names = `${pruned.stdout}\n${pruned.stderr}`.split(/\r?\n/).map((line) => /^Removing (?:worktrees\/)?([^:]+):/.exec(line.trim())?.[1]).filter(Boolean);
  return { ok: true, pruned: names.length, names };
}

// The folder of a listed worktree, for "Open": nothing outside the list.
export async function worktreeFolder(root, target, { run = runGit } = {}) {
  const { found, error } = await find(root, target, run);
  if (error) return error;
  return found.row.missing ? refuse("That worktree's folder is gone.") : { ok: true, path: found.row.path };
}
