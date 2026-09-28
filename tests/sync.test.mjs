// Guard tests for scripts/sync.mjs, the multi-PC sync behind `npm run sync`,
// the Claude Code SessionStart hook and Friends › Your PCs. Two throwaway
// clones of a bare repository stand in for two PCs sharing GitHub; nothing
// touches the live tree or the network.
//
// Run: node --test tests/sync.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { atRisk, describe, inspect, pending, projectCheck, runGit, scrub, sync } from "../scripts/sync.mjs";

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

test("a missing or renamed repository is a failure to show, never a quiet offline", async (t) => {
  const { second } = await fixture(t);
  await run(second, "remote", "set-url", "origin", path.join(tmpdir(), "mefi-sync-missing-remote.git"));
  const head = await run(second, "rev-parse", "HEAD");
  const result = await sync(second);
  assert.equal(result.ok, false, "GitHub may hold work this PC cannot see");
  assert.deepEqual(result.problems.map((item) => item.kind), ["fetch-failed"]);
  assert.match(result.headline, /^Couldn't check GitHub \(.+\)\. Sign in to GitHub again or check this project's GitHub address; nothing was changed\.$/);
  assert.equal(result.canRebase, false);
  assert.equal(await run(second, "rev-parse", "HEAD"), head);
});

test("a network failure or timeout is offline: a state, not a failure", async () => {
  for (const failure of [{ stderr: "fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com" }, { stderr: "", timedOut: true }]) {
    const fake = async (_cwd, args) => {
      if (args[0] === "fetch") return { ok: false, stdout: "", ...failure };
      const answers = { "rev-parse --show-toplevel": "/repo", "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main", "rev-parse --abbrev-ref HEAD": "main", "rev-list --left-right --count main...origin/main": "0\t0" };
      const key = args.join(" ");
      return { ok: true, stdout: answers[key] ?? "", stderr: "" };
    };
    const result = await sync("/repo", { run: fake });
    assert.equal(result.ok, true);
    assert.deepEqual(result.problems.map((item) => item.kind), ["offline"]);
    assert.equal(result.headline, "GitHub could not be reached. As of the last check, this PC matched GitHub.");
  }
  const auth = await sync("/repo", { run: async (_cwd, args) => (args[0] === "fetch"
    ? { ok: false, stdout: "", stderr: "remote: Invalid username or token.\nfatal: Authentication failed for 'https://github.com/a/b.git/'" }
    : { ok: true, stdout: { "rev-parse --show-toplevel": "/repo", "rev-parse --abbrev-ref HEAD": "main" }[args.join(" ")] ?? "", stderr: "" }) });
  assert.deepEqual(auth.problems.map((item) => item.kind), ["fetch-failed"], "a lapsed sign-in is not offline");
});

test("a merge.autoStash setting never moves live edits during a pull", async (t) => {
  const { first, second } = await fixture(t);
  await run(second, "config", "merge.autoStash", "true");
  await edit(first, "README.md", "from the other PC\n");
  await sync(first);
  writeFileSync(path.join(second, "README.md"), "live edit\n");
  const result = await sync(second, { push: false });
  assert.deepEqual(result.problems.map((item) => item.kind), ["pull-refused"]);
  assert.deepEqual(result.actions, []);
  assert.equal(await run(second, "stash", "list"), "", "nothing was stashed");
  assert.equal(await run(second, "status", "--porcelain"), "M README.md", "the edit stays as it was, with no conflict");
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

async function edit(cwd, name, body) {
  writeFileSync(path.join(cwd, name), body);
  await run(cwd, "add", name);
  await run(cwd, "commit", "-q", "-m", `Edit ${name}`);
}

test("a failing project check stops the push and says why; a passing one lets it through", async (t) => {
  const { first, hub } = await fixture(t);
  const before = await run(hub, "rev-parse", "main");
  await commit(first, "feature.txt");
  let checks = 0;
  const failed = await sync(first, { check: async () => { checks += 1; return { ok: false, detail: "3 tests failed" }; } });
  assert.equal(checks, 1);
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.problems.map((item) => item.kind), ["check-failed"]);
  assert.equal(failed.headline, "The project's check failed, so nothing was pushed. Fix it, then sync again.");
  assert.ok(failed.lines.includes("npm run check: 3 tests failed"));
  assert.equal(await run(hub, "rev-parse", "main"), before, "nothing reached GitHub");
  const passed = await sync(first, { check: async () => ({ ok: true }) });
  assert.deepEqual(passed.actions, [{ kind: "pushed", commits: 1 }]);
  const quiet = await sync(first, { check: async () => { throw new Error("never called"); } });
  assert.deepEqual(quiet.actions, [], "no push, so no check");
});

test("put my commits on top: a clean rebase, then the check, then the push", async (t) => {
  const { first, second, hub } = await fixture(t);
  await commit(first, "theirs.txt");
  await sync(first);
  await commit(second, "mine.txt");
  const looked = await sync(second, { push: false });
  assert.equal(looked.canRebase, true, "diverged and nothing uncommitted");
  assert.match(looked.headline, /Put this PC's commits on top of GitHub's/);
  let checked = 0;
  const result = await sync(second, { rebase: true, check: async () => { checked += 1; return { ok: true }; } });
  assert.deepEqual(result.actions, [{ kind: "rebased", commits: 1 }, { kind: "pushed", commits: 1 }]);
  assert.equal(checked, 1);
  assert.equal(await run(hub, "rev-parse", "main"), await run(second, "rev-parse", "HEAD"));
  assert.equal(await run(second, "log", "-2", "--format=%s"), "Add mine.txt\nAdd theirs.txt");
  assert.equal(result.headline, "This PC matches GitHub main.");
});

test("a rebase that conflicts is abandoned and names the files; uncommitted files block it", async (t) => {
  const { first, second, hub } = await fixture(t);
  await edit(first, "README.md", "theirs\n");
  await sync(first);
  await edit(second, "README.md", "mine\n");
  const head = await run(second, "rev-parse", "HEAD");
  const remote = await run(hub, "rev-parse", "main");
  const conflicted = await sync(second, { rebase: true });
  assert.deepEqual(conflicted.problems.map((item) => item.kind), ["rebase-conflict"]);
  assert.deepEqual(conflicted.problems[0].files, ["README.md"]);
  assert.match(conflicted.headline, /both change README\.md\. Nothing was changed/);
  assert.equal(await run(second, "rev-parse", "HEAD"), head, "the rebase was abandoned");
  assert.equal(existsSync(path.join(second, ".git", "rebase-merge")) || existsSync(path.join(second, ".git", "rebase-apply")), false);
  assert.equal(await run(hub, "rev-parse", "main"), remote);
  writeFileSync(path.join(second, "notes.txt"), "draft\n");
  const dirty = await sync(second, { rebase: true });
  assert.equal(dirty.canRebase, false);
  assert.deepEqual(dirty.problems.map((item) => item.kind), ["diverged"]);
  assert.match(dirty.headline, /Commit or set aside the uncommitted files/);
  assert.equal(await run(second, "rev-parse", "HEAD"), head);
});

test("the project check is package.json's own, and its failure keeps only the telling lines", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-sync-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  assert.equal(await projectCheck(root), null, "no package.json");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "x" } }));
  assert.equal(await projectCheck(root), null, "no check script");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { check: "node check.mjs" } }));
  const seen = [];
  const passing = await projectCheck(root, { run: async (dir) => { seen.push(dir); return { ok: true, output: "" }; } });
  assert.deepEqual(await passing(), { ok: true });
  assert.deepEqual(seen, [root]);
  const failing = await projectCheck(root, { run: async () => ({ ok: false, output: "check-targets: ok\nspec: FAIL 2 orphans at https://me:pw@host/x\nmore noise" }) });
  assert.deepEqual(await failing(), { ok: false, detail: "spec: FAIL 2 orphans at https://host/x" });
  const slow = await projectCheck(root, { run: async () => ({ ok: false, output: "", timedOut: true }) });
  assert.equal((await slow()).detail, "npm run check did not finish in 10 minutes");
});

test("only work this PC alone holds counts as at risk", () => {
  const items = ["branch", "uncommitted", "unpushed", "stash", "worktree", "local-branch", "github-branch"].map((kind) => ({ kind }));
  assert.deepEqual(atRisk(items).map((item) => item.kind), ["uncommitted", "unpushed", "stash", "worktree", "local-branch"]);
  assert.deepEqual(atRisk(null), []);
});
