// scripts/sync.mjs remoteMoved, the one-minute question behind "Keep this PC
// up to date": with real git, a bare repository standing in for GitHub and
// two clones for two PCs. It answers from one ls-remote without fetching.
//
// Run: node --test tests/sync_follow.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { remoteMoved } from "../scripts/sync.mjs";

const NO_GLOBAL_CONFIG = path.join(mkdtempSync(path.join(tmpdir(), "mefi-follow-git-")), "empty.gitconfig");
writeFileSync(NO_GLOBAL_CONFIG, "");
const git = (cwd, args) => new Promise((resolve) => {
  execFile("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: NO_GLOBAL_CONFIG } }, (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout).trim(), stderr: String(stderr) }));
});

test("another PC's push is noticed from one ls-remote, and a fetch settles it", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-follow-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const hub = path.join(root, "hub.git"), desk = path.join(root, "desk"), laptop = path.join(root, "laptop");
  await git(root, ["init", "-q", "--bare", "-b", "main", hub]);
  await git(root, ["clone", "-q", hub, desk]);
  writeFileSync(path.join(desk, "a.txt"), "one\n");
  await git(desk, ["add", "-A"]); await git(desk, ["commit", "-q", "-m", "one"]); await git(desk, ["push", "-q", "origin", "HEAD:main"]);
  await git(root, ["clone", "-q", hub, laptop]);
  assert.deepEqual({ ...(await remoteMoved(laptop)) }, { ok: true, moved: false, main: "main" }, "just cloned: in step");
  writeFileSync(path.join(desk, "a.txt"), "two\n");
  await git(desk, ["commit", "-q", "-am", "two"]); await git(desk, ["push", "-q", "origin", "HEAD:main"]);
  assert.equal((await remoteMoved(laptop)).moved, true, "DESK pushed");
  assert.equal((await git(laptop, ["rev-parse", "HEAD"])).stdout, (await git(laptop, ["rev-parse", "origin/main"])).stdout, "nothing was fetched or moved");
  await git(laptop, ["fetch", "-q", "origin"]);
  assert.equal((await remoteMoved(laptop)).moved, false, "a fetch settles it");
  await git(laptop, ["remote", "set-url", "origin", path.join(root, "missing.git")]);
  assert.equal((await remoteMoved(laptop)).ok, false, "a repository that is not there is not a move");
});
