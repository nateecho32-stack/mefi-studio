// Guard tests for what scripts/sync.mjs counts as this PC's own: a file
// whose only difference is line endings Git would undo is not uncommitted
// work, a branch whose commits are all on some GitHub branch (gh-pages
// included) is not this PC's alone, and a look never takes Git's optional
// locks inside a worktree an agent is using. Throwaway repositories only.
//
// Run: node --test tests/sync_changes.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { changedFiles, inspect, runGit } from "../scripts/sync.mjs";

async function run(cwd, ...args) {
  const out = await runGit(cwd, args);
  assert.ok(out.ok, `git ${args.join(" ")}: ${out.stderr}`);
  return out.stdout;
}

async function repo(t, { autocrlf = "false" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-sync-changes-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const hub = path.join(root, "hub.git");
  const pc = path.join(root, "pc");
  await run(root, "init", "-q", "--bare", "-b", "main", hub);
  await run(root, "init", "-q", "-b", "main", pc);
  for (const [key, value] of [["user.name", "Sync Fixture"], ["user.email", "sync@fixture.invalid"], ["commit.gpgsign", "false"], ["core.autocrlf", autocrlf]]) await run(pc, "config", key, value);
  await commit(pc, "README.md");
  await run(pc, "remote", "add", "origin", hub);
  await run(pc, "push", "-q", "-u", "origin", "main");
  return { root, hub, pc };
}

async function commit(cwd, name, text = `${name}\n`) {
  writeFileSync(path.join(cwd, name), text);
  await run(cwd, "add", name);
  await run(cwd, "commit", "-q", "-m", `Add ${name}`);
}

test("line endings Git would undo are not uncommitted work; a real edit is", async (t) => {
  const { pc } = await repo(t, { autocrlf: "true" });
  await commit(pc, "notes.txt", "one\ntwo\n");
  writeFileSync(path.join(pc, "notes.txt"), "one\r\ntwo\r\n");
  assert.notEqual(await run(pc, "status", "--porcelain"), "", "git status alone lists the rewritten file");
  assert.equal(await changedFiles(pc), 0);
  assert.equal((await inspect(pc)).dirty, 0);

  writeFileSync(path.join(pc, "notes.txt"), "one\r\ntwo\r\nthree\r\n");
  writeFileSync(path.join(pc, "new.txt"), "new\n");
  writeFileSync(path.join(pc, "staged.txt"), "staged\n");
  await run(pc, "add", "staged.txt");
  assert.equal(await changedFiles(pc), 3, "an edit, an untracked file and a staged file");
  assert.equal((await inspect(pc)).dirty, 3);
});

test("a clean checkout costs one status and no diffs", async (t) => {
  const { pc } = await repo(t);
  const calls = [];
  const counted = await changedFiles(pc, { run: (cwd, args) => (calls.push(args[0]), runGit(cwd, args)) });
  assert.equal(counted, 0);
  assert.deepEqual(calls, ["status"]);
});

test("a diff Git refuses falls back to status's own count", async (t) => {
  const { pc } = await repo(t);
  writeFileSync(path.join(pc, "README.md"), "edited\n");
  const counted = await changedFiles(pc, { run: (cwd, args) => (args[0] === "diff" ? { ok: false, stdout: "", stderr: "no" } : runGit(cwd, args)) });
  assert.equal(counted, 1);
});

test("a branch already on gh-pages is not listed as this PC's alone; a local-only one is", async (t) => {
  const { pc } = await repo(t);
  await run(pc, "switch", "-q", "--orphan", "site");
  await commit(pc, "index.html");
  await run(pc, "push", "-q", "origin", "site:gh-pages");
  await run(pc, "switch", "-q", "main");
  await run(pc, "switch", "-q", "-c", "draft");
  await commit(pc, "draft.txt");
  await run(pc, "switch", "-q", "main");
  const look = await inspect(pc);
  assert.deepEqual(look.localBranches.map((item) => item.name), ["draft"]);
  assert.deepEqual(look.remoteBranches, [], "gh-pages is never listed as work to bring in");
});

test("git runs without optional locks", async (t) => {
  const { pc } = await repo(t);
  const out = await runGit(pc, ["-c", "alias.lockcheck=!echo \"locks=$GIT_OPTIONAL_LOCKS\"", "lockcheck"]);
  assert.ok(out.ok, out.stderr);
  assert.equal(out.stdout, "locks=0");
});
