// Guard tests for scripts/sync.mjs, the multi-PC sync behind `npm run sync`,
// the Claude Code SessionStart hook and Friends › Your PCs. Two throwaway
// clones of a bare repository stand in for two PCs sharing GitHub; nothing
// touches the live tree or the network.
//
// Run: node --test tests/sync.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, inspect, pending, runGit, scrub, sync } from "../scripts/sync.mjs";

async function run(cwd, ...args) {
  const out = await runGit(cwd, args);
  assert.ok(out.ok, `git ${args.join(" ")}: ${out.stderr}`);
  return out.stdout;
}

async function configure(cwd) {
  for (const [key, value] of [["user.name", "Sync Fixture"], ["user.email", "sync@fixture.invalid"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) await run(cwd, "config", key, value);
}

async function commit(cwd, name) {
  writeFileSync(path.join(cwd, name), `${name}\n`);
  await run(cwd, "add", name);
  await run(cwd, "commit", "-q", "-m", `Add ${name}`);
}

async function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-sync-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const hub = path.join(root, "hub.git");
  const first = path.join(root, "pc1");
  const second = path.join(root, "pc2");
  await run(root, "init", "-q", "--bare", "-b", "main", hub);
  await run(root, "init", "-q", "-b", "main", first);
  await configure(first);
  await commit(first, "README.md");
  await run(first, "remote", "add", "origin", hub);
  await run(first, "push", "-q", "-u", "origin", "main");
  // Before checkout, or a global core.autocrlf=true leaves CRLF files that
  // read as edited once the fixture's own setting applies.
  await run(root, "clone", "-q", "-c", "core.autocrlf=false", hub, second);
  await configure(second);
  return { root, hub, first, second };
}

test("a commit pushed from one PC reaches the other as a fast-forward", async (t) => {
  const { first, second } = await fixture(t);
  await commit(first, "feature.txt");
  const pushed = await sync(first);
  assert.equal(pushed.ok, true);
  assert.deepEqual(pushed.actions, [{ kind: "pushed", commits: 1 }]);
  const pulled = await sync(second, { push: false });
  assert.deepEqual(pulled.actions, [{ kind: "pulled", commits: 1 }]);
  assert.equal(await run(second, "rev-parse", "HEAD"), await run(first, "rev-parse", "HEAD"));
  assert.equal(pulled.headline, "This PC matches GitHub main.");
  assert.deepEqual(pulled.pending, []);
  assert.match(describe(pulled, { hook: true }), /^Multi-PC sync \(scripts\/sync\.mjs, at session start\):\nThis PC matches GitHub main\.\n {2}- Pulled 1 commit from GitHub\.$/);
});

test("a look fetches but never moves main, and hook mode never pushes", async (t) => {
  const { first, second, hub } = await fixture(t);
  await commit(first, "one.txt");
  await sync(first);
  const head = await run(second, "rev-parse", "HEAD");
  const look = await sync(second, { pull: false, push: false });
  assert.equal(await run(second, "rev-parse", "HEAD"), head);
  assert.equal(look.headline, "GitHub has 1 commit this PC has not pulled yet.");
  await commit(first, "two.txt");
  const hook = await sync(first, { push: false });
  assert.equal(hook.state.ahead, 1);
  assert.notEqual(await run(hub, "rev-parse", "main"), await run(first, "rev-parse", "HEAD"));
  assert.deepEqual(hook.pending.map((item) => item.kind), ["unpushed"]);
});

test("diverged main is reported, never merged or pushed", async (t) => {
  const { first, second, hub } = await fixture(t);
  await commit(first, "one.txt");
  await sync(first);
  const remoteHead = await run(hub, "rev-parse", "main");
  await commit(second, "two.txt");
  const localHead = await run(second, "rev-parse", "HEAD");
  const result = await sync(second);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map((item) => item.kind), ["diverged"]);
  assert.match(result.headline, /^main changed on this PC and on GitHub/);
  assert.equal(await run(second, "rev-parse", "HEAD"), localHead);
  assert.equal(await run(hub, "rev-parse", "main"), remoteHead);
});

test("stranded work is listed: uncommitted files, stashes, branches and worktrees", async (t) => {
  const { root, first, second } = await fixture(t);
  await run(first, "switch", "-q", "-c", "claude/cloud-work");
  await commit(first, "cloud.txt");
  await run(first, "push", "-q", "origin", "claude/cloud-work");
  await run(first, "switch", "-q", "main");
  await run(second, "fetch", "-q", "origin");
  await run(second, "switch", "-q", "-c", "local-only");
  await commit(second, "draft.txt");
  await run(second, "switch", "-q", "-c", "published");
  await commit(second, "shared.txt");
  await run(second, "push", "-q", "origin", "published");
  await run(second, "switch", "-q", "main");
  writeFileSync(path.join(second, "README.md"), "edited\n");
  writeFileSync(path.join(second, "scratch.txt"), "stash me\n");
  await run(second, "stash", "push", "-q", "--include-untracked", "--", "scratch.txt");
  const tree = path.join(root, "pc2-tree");
  await run(second, "worktree", "add", "-q", "-b", "claude/tree", tree);
  writeFileSync(path.join(tree, "wip.txt"), "wip\n");
  const items = pending(await inspect(second));
  assert.deepEqual(items.map((item) => item.text), [
    "1 uncommitted file in this checkout.",
    "1 stash saved on this PC.",
    "Worktree pc2-tree (claude/tree): 1 uncommitted file.",
    "Branch local-only on this PC: 1 commit not on main.",
    "Branch claude/cloud-work on GitHub: 1 commit not on main.",
    "Branch published on GitHub: 2 commits not on main.",
  ]);
  const result = await sync(second);
  assert.equal(result.headline, "Some work on this PC is not on GitHub yet.");
  assert.match(describe(result), /Before moving to another PC/);
});

test("an unreachable remote is reported and changes nothing", async (t) => {
  const { second } = await fixture(t);
  await run(second, "remote", "set-url", "origin", path.join(tmpdir(), "mefi-sync-missing-remote.git"));
  const head = await run(second, "rev-parse", "HEAD");
  const result = await sync(second);
  assert.equal(result.ok, true, "offline is a state, not a failure");
  assert.deepEqual(result.problems.map((item) => item.kind), ["offline"]);
  assert.equal(result.headline, "GitHub could not be reached. As of the last check, this PC matched GitHub.");
  assert.equal(await run(second, "rev-parse", "HEAD"), head);
});

test("folders without Git or without a remote explain themselves", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-sync-plain-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const plain = await sync(root);
  assert.equal(plain.ok, false);
  assert.match(plain.headline, /not a Git repository/);
  const local = path.join(root, "local");
  await run(root, "init", "-q", "-b", "main", local);
  const unlinked = await sync(local);
  assert.equal(unlinked.ok, false);
  assert.match(unlinked.headline, /no origin remote yet/);
});

test("credentials in remote URLs never reach a caller", async () => {
  assert.equal(scrub("fatal: unable to access 'https://user:ghp_secret@github.com/a/b.git/'"), "fatal: unable to access 'https://github.com/a/b.git/'");
  assert.equal(scrub("https://token@github.com and ssh://git@host/x"), "https://github.com and ssh://host/x");
  const calls = [];
  const fake = async (_cwd, args) => {
    calls.push(args.join(" "));
    if (args[0] === "fetch") return { ok: false, stdout: "", stderr: "fatal: could not read from 'https://me:pw@github.com/x.git'" };
    const answers = { "rev-parse --show-toplevel": "/repo", "remote get-url origin": "https://me:pw@github.com/x.git", "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main", "rev-parse --abbrev-ref HEAD": "main", "rev-list --left-right --count main...origin/main": "0\t0" };
    const key = args.join(" ");
    return key in answers || key.startsWith("rev-parse --verify") ? { ok: true, stdout: answers[key] ?? "", stderr: "" } : { ok: true, stdout: "", stderr: "" };
  };
  const result = await sync("/repo", { run: fake });
  assert.doesNotMatch(JSON.stringify(result), /pw@|me:pw/);
  assert.ok(calls.every((call) => !call.startsWith("push") && !call.startsWith("merge")), "offline never writes");
});
