// Guard tests for scripts/worktrees.mjs, the table behind `npm run worktrees`:
// every worktree of a project with its branch, distance from the default
// branch, uncommitted and unpushed state, and what to do about it. Throwaway
// repositories stand in for GitHub and a PC; nothing touches the network or the
// live tree, and the module is read-only (the last test proves it).
//
// Run: node --test tests/worktrees.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGit } from "../scripts/sync.mjs";
import { classify, describeWorktrees, kindOf, listWorktrees, parseWorktrees } from "../scripts/worktrees.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "worktrees.mjs");

async function run(cwd, ...args) {
  const out = await runGit(cwd, args);
  assert.ok(out.ok, `git ${args.join(" ")}: ${out.stderr}`);
  return out.stdout;
}

async function configure(cwd) {
  for (const [key, value] of [["user.name", "Worktree Fixture"], ["user.email", "worktrees@fixture.invalid"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) await run(cwd, "config", key, value);
}

async function commit(cwd, name) {
  writeFileSync(path.join(cwd, name), `${name}\n`);
  await run(cwd, "add", name);
  await run(cwd, "commit", "-q", "-m", `Add ${name}`);
}

async function project(t, { remote = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-worktrees-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const repo = path.join(root, "repo");
  await run(root, "init", "-q", "-b", "main", repo);
  await configure(repo);
  await commit(repo, "README.md");
  if (remote) {
    const hub = path.join(root, "hub.git");
    await run(root, "init", "-q", "--bare", "-b", "main", hub);
    await run(repo, "remote", "add", "origin", hub);
    await run(repo, "push", "-q", "-u", "origin", "main");
  }
  return { root, repo };
}

test("porcelain output becomes entries, with detached, locked and prunable worktrees", () => {
  const text = [
    "worktree /work/repo", "HEAD 1111111111111111111111111111111111111111", "branch refs/heads/main", "",
    "worktree /work/wt-a", "HEAD 2222222222222222222222222222222222222222", "detached", "locked in use by a session", "",
    "worktree /work/wt-b", "HEAD 3333333333333333333333333333333333333333", "branch refs/heads/wip/topic", "prunable gitdir file points to non-existent location", "",
  ].join("\n");
  const entries = parseWorktrees(text);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].branch, "main");
  assert.equal(entries[1].detached, true);
  assert.equal(entries[1].locked, "in use by a session");
  assert.equal(entries[2].branch, "wip/topic");
  assert.match(entries[2].prunable, /non-existent/);
  assert.deepEqual(parseWorktrees(""), []);
});

test("kinds: the first is the primary checkout, mefi/* and .mefi/worktrees are task runs, the rest are dev or detached", () => {
  assert.equal(kindOf({ path: "/p", branch: "main" }, 0), "primary");
  assert.equal(kindOf({ path: "/p/.mefi/worktrees/run_1_1", branch: "mefi/run_1_1" }, 1), "run");
  assert.equal(kindOf({ path: "C:\\proj\\.mefi\\worktrees\\run_2_1", branch: null, detached: true }, 2), "run");
  assert.equal(kindOf({ path: "/w/x", branch: "wip/x", detached: false }, 3), "dev");
  assert.equal(kindOf({ path: "/w/y", branch: null, detached: true }, 4), "detached");
});

test("every state is found, worst first, with what to do about it", async (t) => {
  const { root, repo } = await project(t);
  // .mefi is where Studio puts task-run worktrees; a real project ignores it.
  writeFileSync(path.join(repo, ".git", "info", "exclude"), ".mefi/\n");
  const at = (name) => path.join(root, name);

  await run(repo, "worktree", "add", "-q", "-b", "feature/dev", at("wt-dev"));
  await configure(at("wt-dev"));
  await commit(at("wt-dev"), "one.txt");
  await commit(at("wt-dev"), "two.txt");

  await run(repo, "worktree", "add", "-q", "-b", "wip/pushed", at("wt-pushed"));
  await configure(at("wt-pushed"));
  await commit(at("wt-pushed"), "pushed.txt");
  await run(at("wt-pushed"), "push", "-q", "origin", "wip/pushed");

  await run(repo, "worktree", "add", "-q", "-b", "wip/merged", at("wt-merged"));
  mkdirSync(path.join(repo, ".mefi", "worktrees"), { recursive: true });
  await run(repo, "worktree", "add", "-q", "-b", "mefi/run_1_1", path.join(repo, ".mefi", "worktrees", "run_1_1"));

  await run(repo, "worktree", "add", "-q", "-b", "wip/dirty", at("wt-dirty"));
  writeFileSync(path.join(at("wt-dirty"), "scratch.txt"), "not saved\n");

  await run(repo, "worktree", "add", "-q", "--detach", at("wt-detached"));
  await configure(at("wt-detached"));
  await commit(at("wt-detached"), "loose.txt");

  await run(repo, "worktree", "add", "-q", "-b", "wip/gone", at("wt-gone"));
  rmSync(at("wt-gone"), { recursive: true, force: true });

  const result = await listWorktrees(repo);
  assert.equal(result.repo, true);
  assert.equal(result.main, "main");
  assert.equal(result.upstream, "origin/main");
  const by = Object.fromEntries(result.rows.map((row) => [row.name, row]));

  assert.deepEqual(result.rows.map((row) => row.name), ["repo", "wt-dirty", "wt-detached", "wt-dev", "wt-pushed", "wt-gone", "run_1_1", "wt-merged"],
    "the primary first, then work at risk, then on GitHub, then missing, then safe to remove; each group by name");

  assert.equal(by.repo.kind, "primary");
  assert.equal(by.repo.state, "primary");

  assert.equal(by["wt-dirty"].state, "dirty");
  assert.equal(by["wt-dirty"].dirty, 1);
  assert.match(by["wt-dirty"].action, /^1 uncommitted file: commit, stash or discard/);

  assert.equal(by["wt-dev"].kind, "dev");
  assert.equal(by["wt-dev"].state, "unpushed");
  assert.equal(by["wt-dev"].ahead, 2);
  assert.equal(by["wt-dev"].behind, 0);
  assert.equal(by["wt-dev"].pushed, false);
  assert.match(by["wt-dev"].action, /^2 commits only on this PC: push them \(git push origin HEAD:refs\/heads\/wip\/feature\/dev\) or land them\.$/);
  assert.equal(by["wt-dev"].last.subject, "Add two.txt");

  assert.equal(by["wt-detached"].kind, "detached");
  assert.equal(by["wt-detached"].state, "unpushed");
  assert.equal(by["wt-detached"].pushed, false);
  assert.match(by["wt-detached"].action, /^Detached HEAD with 1 commit on no branch: put them on a branch and push it\.$/);

  assert.equal(by["wt-pushed"].state, "on-github");
  assert.equal(by["wt-pushed"].pushed, true);
  assert.match(by["wt-pushed"].action, /^1 commit on GitHub, not merged into origin\/main: land it or leave it parked\.$/);

  assert.equal(by["wt-gone"].state, "missing");
  assert.equal(by["wt-gone"].missing, true);
  assert.match(by["wt-gone"].action, /git worktree prune/);

  assert.equal(by.run_1_1.kind, "run");
  assert.equal(by.run_1_1.branch, "mefi/run_1_1");
  assert.equal(by.run_1_1.state, "merged");
  assert.equal(by["wt-merged"].state, "merged");
  assert.match(by["wt-merged"].action, /^Merged into origin\/main and clean: safe to remove \(git worktree remove .*wt-merged\)\.$/);

  assert.deepEqual(result.summary, { total: 8, atRisk: 3, toLand: 1, safeToRemove: 2, missing: 1 });
  assert.equal(result.headline, "8 worktrees: 3 hold work that exists only on this PC, 1 is on GitHub but not merged, 2 are merged and safe to remove, 1 folder is gone.");

  const text = describeWorktrees(result).join("\n");
  assert.match(text, /^8 worktrees: 3 hold work/);
  assert.match(text, /^WORKTREE +BRANCH +VS MAIN +DIRTY +PUSHED +STATE +LAST COMMIT$/m);
  assert.match(text, /^wt-dev +feature\/dev +\+2\/-0 +0 +no +unpushed +\d{4}-\d{2}-\d{2} Add two\.txt$/m);
  assert.match(text, /\nWhat to do:\n/);
  assert.match(text, /^ {2}wt-dirty: 1 uncommitted file:/m);
  assert.doesNotMatch(text.split("What to do:")[1], /^ {2}repo:/m, "a clean primary checkout has nothing to do");
});

test("a branch that fell behind is shown with how far, and the primary checkout's own edits are reported", async (t) => {
  const { root, repo } = await project(t);
  await run(repo, "worktree", "add", "-q", "-b", "wip/old", path.join(root, "wt-old"));
  await commit(repo, "later.txt");
  await run(repo, "push", "-q", "origin", "main");
  writeFileSync(path.join(repo, "README.md"), "edited\n");
  const result = await listWorktrees(repo);
  const old = result.rows.find((row) => row.name === "wt-old");
  assert.equal(old.ahead, 0);
  assert.equal(old.behind, 1);
  assert.equal(old.state, "merged", "nothing on it that main lacks");
  const primary = result.rows.find((row) => row.kind === "primary");
  assert.equal(primary.dirty, 1);
  assert.match(describeWorktrees(result).join("\n"), /^ {2}repo: 1 uncommitted file in the main checkout\.$/m);
});

test("without a remote the local default branch is the comparison, and it says so", async (t) => {
  const { root, repo } = await project(t, { remote: false });
  await run(repo, "worktree", "add", "-q", "-b", "wip/local", path.join(root, "wt-local"));
  await configureAndCommit(path.join(root, "wt-local"));
  const result = await listWorktrees(repo);
  assert.equal(result.hasUpstream, false);
  const row = result.rows.find((item) => item.name === "wt-local");
  assert.equal(row.ahead, 1);
  assert.equal(row.state, "unpushed", "no remote means nothing is pushed");
  assert.match(result.headline, /\(There is no origin\/main to compare with, so the local default branch was used\.\)$/);
});

async function configureAndCommit(cwd) {
  await configure(cwd);
  await commit(cwd, "only-here.txt");
}

test("a folder that is not a repository is said so; a repository with no other worktree is one line", async (t) => {
  const plain = mkdtempSync(path.join(tmpdir(), "mefi-worktrees-plain-"));
  t.after(() => rmSync(plain, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const none = await listWorktrees(plain);
  assert.equal(none.repo, false);
  assert.deepEqual(describeWorktrees(none), ["This folder is not a Git repository."]);
  const cli = spawnSync(process.execPath, [SCRIPT, plain], { encoding: "utf8" });
  assert.equal(cli.status, 2);

  const { repo } = await project(t);
  const alone = await listWorktrees(repo);
  assert.equal(alone.rows.length, 1);
  assert.equal(alone.headline, "One checkout, no other worktrees.");
});

test("classify never asks for more than the row it is given", () => {
  const base = { kind: "dev", name: "x", branch: "wip/x", path: "/w/x", upstreamName: "origin/main", dirty: 0, ahead: 0, pushed: true, missing: false };
  assert.equal(classify(base).state, "merged");
  assert.equal(classify({ ...base, ahead: 3, pushed: true }).state, "on-github");
  assert.equal(classify({ ...base, ahead: 3, pushed: false }).state, "unpushed");
  assert.equal(classify({ ...base, dirty: 2, ahead: 3, pushed: false }).state, "dirty", "uncommitted files outrank everything but a missing folder");
  assert.equal(classify({ ...base, missing: true, dirty: 2 }).state, "missing");
  assert.equal(classify({ ...base, kind: "primary" }).state, "primary");
});

test("the command line prints the table and, with --json, the same rows; it changes nothing", async (t) => {
  const { root, repo } = await project(t);
  await run(repo, "worktree", "add", "-q", "-b", "wip/cli", path.join(root, "wt-cli"));
  const before = await run(repo, "for-each-ref", "--format=%(refname) %(objectname)");
  const stateBefore = await run(repo, "worktree", "list", "--porcelain");

  const table = execFileSync(process.execPath, [SCRIPT, repo], { encoding: "utf8" });
  assert.match(table, /^2 worktrees: 1 is merged and safe to remove\./);
  assert.match(table, /wt-cli +wip\/cli/);

  const json = JSON.parse(execFileSync(process.execPath, [SCRIPT, "--json", repo], { encoding: "utf8" }));
  assert.equal(json.repo, true);
  assert.deepEqual(json.rows.map((row) => row.name).sort(), ["repo", "wt-cli"]);
  assert.equal(json.summary.safeToRemove, 1);

  assert.equal(await run(repo, "for-each-ref", "--format=%(refname) %(objectname)"), before, "no ref moved");
  assert.equal(await run(repo, "worktree", "list", "--porcelain"), stateBefore, "no worktree was added, removed or pruned");
  assert.ok(existsSync(path.join(root, "wt-cli")));
});
