// Guard tests for scripts/git-actions.cjs, the host half of the GitHub link:
// the local glance behind the chip and the launch list, the save preview and
// the guarded save (only the checked paths, one path-limited commit, never
// `git add -A`), the branch push, publishing a folder as a private repository
// (idempotent on retry), linking to a listed repository, and the owner and
// name checks. Real git runs in throwaway folders, a local bare repository
// stands in for GitHub through a url.insteadOf rule, and `gh` is always a
// fake; nothing here reaches the network, a real GitHub account or the live
// tree.
//
// Run: node --test tests/git_actions.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFile as spawnFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpath as fsRealpath, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createGitActions, GLANCE_CAP_MS, GLANCE_CONCURRENCY, LOCK_DELAYS, MAX_FILES, parts } = require("../scripts/git-actions.cjs");
const rules = require("../scripts/git-link.cjs");

const MIB = 1024 * 1024;
// Built at run time so this file never holds a key-shaped line of its own.
const TOKEN = `ghp_${"a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6"}`;
const KEY_LINE = ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ");

// ---- fixtures ----------------------------------------------------------------------
// A private folder with its own global git config: no identity of yours, no
// hooks, no credential helper, master as the default branch (so an unborn
// repository starts on the branch Studio renames), and only the file protocol
// allowed, so a stray https address fails instead of leaving the machine.
function sandbox(t, { identity = true, autocrlf = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-gha-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const config = path.join(root, "gitconfig");
  const lines = ["[init]", "\tdefaultBranch = master", "[core]", `\tautocrlf = ${autocrlf}`, "[commit]", "\tgpgsign = false"];
  if (identity) lines.push("[user]", "\tname = Fixture Owner", "\temail = owner@fixture.invalid");
  writeFileSync(config, `${lines.join("\n")}\n`);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "file", GIT_TERMINAL_PROMPT: "0" };
  for (const name of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL", "GH_TOKEN", "GITHUB_TOKEN", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).replace(/\r?\n$/, "");
  const tryGit = (cwd, ...args) => { try { return git(cwd, ...args); } catch (error) { return `failed: ${error.stderr ?? error.message}`; } };
  const dir = (name) => { const target = path.join(root, name); mkdirSync(target, { recursive: true }); return target; };
  // https://github.com/<repo>.git is served from a local bare repository.
  const route = (repo, hub) => appendFileSync(config, `[url "${hub.replace(/\\/g, "/")}"]\n\tinsteadOf = https://github.com/${repo}.git\n`);
  const bare = (name) => { const target = path.join(root, name); git(root, "init", "-q", "--bare", "-b", "main", target); return target; };
  return { root, env, config, git, tryGit, dir, route, bare };
}

const put = (cwd, file, text = `${file}\n`) => { mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); writeFileSync(path.join(cwd, file), text); };

// A repository with one seed commit (the test helper may add everything; the module under test never does).
function repoWith(box, name, files = { "README.md": "# app\n" }, { branch = "main" } = {}) {
  const cwd = box.dir(name);
  box.git(cwd, "init", "-q", "-b", branch);
  for (const [file, text] of Object.entries(files)) put(cwd, file, text);
  box.git(cwd, "add", "-A");
  box.git(cwd, "commit", "-q", "-m", "seed");
  return cwd;
}

// What a commit changed, as "A\tpath" lines.
const changed = (box, cwd, rev = "HEAD") => box.git(cwd, "-c", "core.quotepath=false", "show", "--name-status", "--format=", rev).split(/\r?\n/).filter(Boolean).sort();
const status = (box, cwd) => box.git(cwd, "-c", "core.quotepath=false", "status", "--porcelain").split(/\r?\n/).filter(Boolean).sort();

// gh is never real: a table of answers, and any call it has no answer for fails the test.
function ghFake({ account = "octo-cat", orgs = [], views = {}, userId = "4242", create = null } = {}) {
  return (args, options) => {
    if (args[0] === "auth" && args[1] === "status") {
      return account
        ? { stdout: `github.com\n  \u2713 Logged in to github.com account ${account} (keyring)\n  - Token: gho_************************************\n` }
        : { fail: true, stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" };
    }
    if (args[0] === "api" && args[1] === "user/orgs") return { stdout: orgs.join("\n") };
    if (args[0] === "api" && args[1] === "user") return userId ? { stdout: `${account} ${userId}\n` } : { fail: true, stderr: "dial tcp: lookup api.github.com: no such host" };
    if (args[0] === "repo" && args[1] === "view") {
      const view = views[args[2]];
      if (view?.fail) return view;
      return view ? { stdout: JSON.stringify(view) } : { fail: true, stderr: `GraphQL: Could not resolve to a Repository with the name '${args[2]}'. (repository)` };
    }
    if (args[0] === "repo" && args[1] === "create" && create) return create(args, options);
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
}

// The module under test on top of a recording execFile: git runs for real, gh and fsutil are answered
// by the fakes, and `intercept` may answer (or fail) any call first.
function harness(t, box, { gh = ghFake(), intercept = null, statOf = null, fsutil = null, ...more } = {}) {
  const calls = [];
  const events = [];
  const sleeps = [];
  const unexpected = [];
  const execFile = (command, args, options, done) => {
    calls.push({ command, args: [...args], cwd: options.cwd, env: options.env, shell: options.shell, timeout: options.timeout });
    events.push(["run", command, ...args]);
    let answer = null;
    try {
      answer = intercept?.(command, args, options) ?? null;
      if (!answer && command === "gh") answer = gh(args, options);
      if (!answer && command === "fsutil") answer = fsutil?.(args) ?? { stdout: "File System Name : NTFS" };
    } catch (error) { unexpected.push(error.message); answer = { fail: true, stderr: error.message }; }
    if (!answer) return spawnFile(command, args, options, done);
    if (answer.fail) done(Object.assign(new Error(answer.message ?? answer.stderr ?? "failed"), { code: answer.code ?? 1, killed: answer.killed }), answer.stdout ?? "", answer.stderr ?? "");
    else done(null, answer.stdout ?? "", answer.stderr ?? "");
    return undefined;
  };
  const actions = createGitActions({
    execFile, exists: existsSync, readText: (file) => readFile(file, "utf8").catch(() => null),
    writeText: async (file, text) => { events.push(["write", path.basename(file)]); await writeFile(file, text, "utf8"); },
    mkdir, readdir, stat: async (file) => statOf?.(file) ?? stat(file),
    env: () => box.env, sleep: async (ms) => { sleeps.push(ms); }, ...more,
  });
  t.after(() => assert.deepEqual(unexpected, [], "every gh call has a fake answer"));
  return { actions, calls, events, sleeps, gitCalls: (word) => calls.filter((call) => call.command === "git" && call.args.includes(word)) };
}

// Sizes the fake stat reports for named files (the real files stay small).
const sizes = (map) => (file) => {
  const size = map[path.basename(file)];
  return size === undefined ? undefined : { size, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
};

// Whatever else a call did, it never forced, never skipped a hook, never added everything, never used a shell.
function assertGentle(calls) {
  for (const call of calls) {
    assert.ok(["git", "gh", "fsutil"].includes(call.command), `only git, gh and fsutil run (${call.command})`);
    assert.equal(call.shell, undefined, "no shell");
    assert.ok(Array.isArray(call.args), "argv arrays");
    for (const arg of call.args) assert.doesNotMatch(String(arg), /^(?:--force|--force-with-lease|-f|--no-verify|-n|--all|-A|--amend)$/, `${call.command} ${call.args.join(" ")}`);
    const sub = call.command === "git" ? call.args.find((arg) => !arg.startsWith("-") && !arg.startsWith("user.")) : null;
    if (sub === "add") assert.ok(call.args.includes("-N"), "add is only ever intent-to-add");
    if (sub === "commit") assert.ok(call.args.includes("--") || call.args.includes("--pathspec-from-file=-"), "a commit is always path-limited");
    if (call.command === "gh") assert.doesNotMatch(call.args.slice(0, 2).join(" "), /^auth (?:login|refresh|setup-git)$/, "gh never changes the account");
  }
}

// ---- glance ------------------------------------------------------------------------
test("a repository with no commits reads as unborn, not a detached HEAD, in two local spawns", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box);
  const cwd = box.dir("fresh");
  box.git(cwd, "init", "-q", "-b", "main");
  put(cwd, "README.md");
  const seen = await actions.glance(cwd);
  assert.deepEqual(seen, { isRepo: true, unborn: true, branch: "main", detached: false, dirty: 1, ahead: 0, behind: 0, upstream: null, remote: null, main: "main", onDefault: true, available: true });
  assert.equal(rules.describe({ glance: seen }).id, "no-commits");
  assert.deepEqual(calls.map((call) => call.args.slice(0, 2).join(" ")).sort(), ["remote get-url", "status --porcelain=v2"], "a status and a remote address, nothing else");
  assert.ok(calls.every((call) => call.env.GIT_OPTIONAL_LOCKS === "0"), "a look never takes the index lock");
  const other = box.dir("plain");
  box.git(other, "init", "-q");
  assert.equal((await actions.glance(other)).branch, "master", "the unborn branch is named as git names it");
});

test("a glance says where a checkout stands against GitHub without asking GitHub", async (t) => {
  const box = sandbox(t);
  const { actions } = harness(t, box);
  const local = repoWith(box, "local");
  const bare = await actions.glance(local);
  assert.equal(bare.remote, null);
  assert.equal(rules.describe({ glance: bare }).id, "no-remote");
  box.git(local, "remote", "add", "origin", `https://octo:${TOKEN}@github.com/octo-cat/app.git`);
  const linked = await actions.glance(local);
  assert.equal(linked.remote, "octo-cat/app", "a login in the address never comes along");
  assert.doesNotMatch(JSON.stringify(linked), /ghp_|octo:/);
  assert.equal(linked.upstream, null);
  assert.equal(rules.describe({ glance: linked }).id, "no-upstream");
  box.git(local, "remote", "set-url", "origin", "E:/mirror/app");
  assert.equal((await actions.glance(local)).remote, "other", "a non-GitHub address is left alone");

  const hub = box.bare("hub.git");
  const one = box.dir("pc1");
  box.git(box.root, "clone", "-q", hub, one);
  put(one, "a.txt");
  box.git(one, "add", "a.txt");
  box.git(one, "commit", "-q", "-m", "one");
  box.git(one, "push", "-q", "-u", "origin", "main");
  const two = path.join(box.root, "pc2");
  box.git(box.root, "clone", "-q", hub, two);
  put(one, "b.txt");
  box.git(one, "add", "b.txt");
  box.git(one, "commit", "-q", "-m", "two");
  box.git(one, "push", "-q");
  box.git(two, "fetch", "-q");
  put(two, "mine.txt");
  box.git(two, "add", "mine.txt");
  box.git(two, "commit", "-q", "-m", "mine");
  put(two, "loose.txt");
  const counted = await actions.glance(two);
  assert.deepEqual({ ahead: counted.ahead, behind: counted.behind, dirty: counted.dirty, upstream: counted.upstream, branch: counted.branch }, { ahead: 1, behind: 1, dirty: 1, upstream: "origin/main", branch: "main" });
  assert.equal(counted.onDefault, true);
});

test("a detached HEAD, a feature branch and an unpublished default each read as themselves", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box);
  const cwd = repoWith(box, "work");
  box.git(cwd, "remote", "add", "origin", "https://github.com/octo-cat/app.git");
  box.git(cwd, "checkout", "-q", "--detach");
  const detached = await actions.glance(cwd);
  assert.equal(detached.detached, true);
  assert.equal(detached.branch, null);
  assert.equal(detached.onDefault, false);
  assert.equal(rules.describe({ glance: detached }).label, "Not on a branch");
  box.git(cwd, "checkout", "-q", "-b", "feature");
  // origin/HEAD names the default: one more spawn, only for a branch that is not main or master.
  box.git(cwd, "update-ref", "refs/remotes/origin/develop", "HEAD");
  box.git(cwd, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
  const before = calls.length;
  const feature = await actions.glance(cwd);
  assert.equal(feature.main, "develop");
  assert.equal(feature.onDefault, false);
  assert.equal(calls.length - before, 3);
  assert.equal(calls.at(-1).args[0], "symbolic-ref");
});

test("a folder that is not a repository, is gone, or cannot be read never throws", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box);
  const plain = box.dir("plain");
  assert.deepEqual(await actions.glance(plain), { isRepo: false, unborn: false, branch: null, detached: false, dirty: 0, ahead: 0, behind: 0, upstream: null, remote: null, main: null, onDefault: true, available: true });
  const before = calls.length;
  const gone = await actions.glance(path.join(box.root, "missing"));
  assert.equal(gone.available, false);
  assert.equal(rules.describe({ glance: gone }).id, "folder-missing");
  assert.equal(calls.length, before, "a missing folder costs no spawn");
  assert.equal(await actions.glance(""), null);
  assert.equal(await actions.glance(42), null);
  const noGit = harness(t, box, { intercept: (command) => (command === "git" ? { fail: true, code: "ENOENT", message: "spawn git ENOENT" } : null) });
  assert.equal(await noGit.actions.glance(plain), null, "unknown is null, never a guess");
  const unreadable = harness(t, box, { intercept: (command, args) => (args[0] === "status" ? { fail: true, code: 128, stderr: "fatal: detected dubious ownership in repository at 'X'" } : null) });
  assert.equal(await unreadable.actions.glance(plain), null);
});

test("many projects are glanced three at a time, each capped, in order, and nothing throws", async (t) => {
  assert.equal(GLANCE_CAP_MS, 1500);
  assert.equal(GLANCE_CONCURRENCY, 3);
  const box = sandbox(t);
  const active = new Set();
  let most = 0;
  const seen = [];
  const answers = (command, args, options, done) => {
    seen.push({ timeout: options.timeout, cwd: options.cwd });
    if (options.cwd.endsWith("hang")) return; // never answers
    active.add(options.cwd);
    most = Math.max(most, active.size);
    setTimeout(() => {
      active.delete(options.cwd);
      if (args[0] === "status") done(null, "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n", "");
      else done(Object.assign(new Error("no remote"), { code: 2 }), "", "error: No such remote 'origin'");
    }, 25);
  };
  const actions = createGitActions({ execFile: answers, exists: () => true, env: () => box.env, glanceCapMs: 400 });
  const list = Array.from({ length: 9 }, (_, index) => ({ id: `p${index}`, root: `/fake/p${index}` }));
  list.splice(4, 0, { id: "hang", root: "/fake/hang" }, { id: "junk" }, null);
  const started = Date.now();
  const result = await actions.glanceMany(list);
  assert.deepEqual(result.map((item) => item.id), list.map((item) => item?.id ?? null), "the order is kept");
  assert.ok(most <= 3, `at most three projects at once (saw ${most})`);
  assert.equal(result.find((item) => item.id === "hang").glance, null, "the one that never answers is unknown");
  assert.equal(result.find((item) => item.id === "junk").glance, null);
  assert.equal(result.find((item) => item.id === "p0").glance.branch, "main");
  assert.ok(Date.now() - started < 1400, "a stuck project costs its cap, not the whole list");
  assert.ok(seen.every((item) => item.timeout <= 400), "each spawn is given the project's remaining budget");
  assert.deepEqual(await actions.glanceMany("not a list"), []);
  const defaults = createGitActions({ execFile: answers, exists: () => true, env: () => box.env });
  const before = seen.length;
  await defaults.glanceMany([{ id: "a", root: "/fake/a" }]);
  assert.ok(seen.slice(before).every((item) => item.timeout <= GLANCE_CAP_MS), "the default cap is 1.5 s");
});

// ---- the save preview --------------------------------------------------------------------
test("a preview lists changed, new and deleted files and stops keys, secrets and generated folders", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box, { statOf: sizes({ "big.bin": 60 * MIB, "huge.bin": 120 * MIB }) });
  const cwd = repoWith(box, "app", { "README.md": "# app\n", "old.txt": "old\n", "settings.js": "export const a = 1;\n", "legacy.txt": `old ${TOKEN}\nplain\n` });
  put(cwd, "README.md", "# app\nmore\n");
  rmSync(path.join(cwd, "old.txt"));
  put(cwd, "settings.js", `export const a = 1;\nexport const token = "${TOKEN}";\n`);
  put(cwd, "legacy.txt", `old ${TOKEN}\nplain\nadded\n`);
  put(cwd, "notes.txt");
  put(cwd, "caf\u00e9 \u00e9.txt");
  put(cwd, ".env", "PASSWORD=hunter2hunter2\n");
  put(cwd, ".env.example", "PASSWORD=\n");
  put(cwd, "deploy/key.txt", `${KEY_LINE}\nabc\n`);
  put(cwd, "src/config.js", 'const password = "hunter2hunter2";\n');
  put(cwd, "node_modules/pkg/index.js", "module.exports = 1;\n");
  put(cwd, "big.bin", "x");
  put(cwd, "huge.bin", "x");
  const view = await actions.preview(cwd, { builders: true });
  assert.equal(view.ok, true);
  assert.equal(view.branch, "main");
  assert.equal(view.refusal, null);
  assert.equal(view.builders, true);
  assert.deepEqual(view.identity, { ok: true, name: "Fixture Owner", email: "owner@fixture.invalid", fromAccount: false });
  const row = (file) => view.files.find((item) => item.path === file);
  assert.deepEqual([row("README.md").status, row("old.txt").status, row("notes.txt").status, row("caf\u00e9 \u00e9.txt").status], ["changed", "deleted", "new", "new"]);
  assert.equal(row("README.md").include, true);
  assert.equal(row(".env").include, false);
  assert.equal(row(".env").blocked.text, "Stopped: an environment file in .env.");
  assert.equal(row(".env.example").include, true, "a template is fine");
  assert.equal(row("deploy/key.txt").blocked.label, "a private key", "an untracked folder is opened up and its files read");
  assert.equal(row("settings.js").blocked.text, "Stopped: an API key or token in settings.js.", "the lines a diff adds are read");
  assert.equal(row("legacy.txt").blocked, undefined, "a key that was already there is not this save's to stop");
  assert.equal(row("legacy.txt").include, true);
  assert.equal(row("src/config.js").include, true);
  assert.equal(row("src/config.js").warn.kind, "maybe-secret", "an assigned-looking value warns and does not stop");
  assert.equal(row("node_modules/").blocked.kind, "generated");
  assert.equal(row("big.bin").warn.label, "60 MB");
  assert.equal(row("big.bin").include, true);
  assert.equal(row("huge.bin").blocked.kind, "too-large");
  assert.match(row("huge.bin").blocked.text, /is 120 MB; GitHub refuses files over 100 MB/);
  assert.equal(row("old.txt").blocked, undefined);
  const included = view.files.filter((item) => item.include).length;
  assert.equal(view.message, `Studio save: ${included} files`);
  assert.ok(!view.files.some((item) => item.path.startsWith("node_modules/") && item.path !== "node_modules/"), "generated folders are never opened");
  assert.ok(!calls.some((call) => call.args.includes("ls-files") && call.args.includes("node_modules/")));
  assert.ok(!calls.some((call) => call.args.includes("add") || call.args.includes("commit")), "a preview changes nothing");
  assertGentle(calls);
});

test("a preview refuses a merge, a rebase, conflicts and a detached HEAD, and says why", async (t) => {
  const box = sandbox(t);
  const { actions } = harness(t, box);
  const conflicted = (name) => {
    const cwd = repoWith(box, name, { "a.txt": "base\n" });
    box.git(cwd, "checkout", "-q", "-b", "other");
    put(cwd, "a.txt", "other\n");
    box.git(cwd, "commit", "-q", "-am", "other");
    box.git(cwd, "checkout", "-q", "main");
    put(cwd, "a.txt", "mine\n");
    box.git(cwd, "commit", "-q", "-am", "mine");
    return cwd;
  };
  const merging = conflicted("merging");
  assert.match(box.tryGit(merging, "merge", "other"), /^failed|CONFLICT/);
  const merge = await actions.preview(merging);
  assert.equal(merge.refusal.kind, "merge");
  assert.match(merge.refusal.text, /merge is in progress/);
  assert.equal(merge.files.find((item) => item.path === "a.txt").status, "changed");

  const rebasing = conflicted("rebasing");
  box.tryGit(rebasing, "rebase", "other");
  assert.equal((await actions.preview(rebasing)).refusal.kind, "rebase");

  const picking = conflicted("picking");
  box.tryGit(picking, "cherry-pick", "other");
  const pick = await actions.preview(picking);
  assert.equal(pick.refusal.kind, "cherry-pick");
  assert.match(pick.refusal.text, /cherry-pick is in progress/);

  const stashed = repoWith(box, "stashed", { "a.txt": "base\n" });
  put(stashed, "a.txt", "stashed\n");
  box.git(stashed, "stash", "push", "-q");
  put(stashed, "a.txt", "changed elsewhere\n");
  box.git(stashed, "commit", "-q", "-am", "elsewhere");
  box.tryGit(stashed, "stash", "pop");
  assert.equal((await actions.preview(stashed)).refusal.kind, "unmerged", "conflicts with no merge running");

  const loose = repoWith(box, "loose");
  box.git(loose, "checkout", "-q", "--detach");
  put(loose, "a.txt");
  const detached = await actions.preview(loose);
  assert.equal(detached.refusal.kind, "detached");
  assert.equal(detached.branch, null);
  assert.equal(detached.detached, true);
  assert.equal(detached.files.find((item) => item.path === "a.txt").status, "new", "the files still show");

  const inner = path.join(loose, "sub");
  mkdirSync(inner);
  assert.equal((await actions.preview(inner)).refusal.kind, "nested", "a folder inside another project is that project's to save");
  const plain = box.dir("plain");
  const none = await actions.preview(plain);
  assert.deepEqual([none.ok, none.refusal.kind, none.files], [true, "not-repo", []]);
  assert.equal((await actions.preview(path.join(box.root, "gone"))).kind, "folder-missing");
});

// ---- saving ------------------------------------------------------------------------------
test("a save commits only the chosen paths and leaves everything else where it was", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box);
  // A folder named the way the owner's own is: an apostrophe, spaces and a plus.
  const cwd = repoWith(box, "Mefi's Studio AI+", { "README.md": "# app\n", "other.txt": "other\n", "old.txt": "old\n", "peer.txt": "peer\n" });
  put(cwd, "README.md", "# app\nedited\n");
  put(cwd, "other.txt", "other edited\n");
  put(cwd, "peer.txt", "peer staged\n");
  box.git(cwd, "add", "peer.txt");
  rmSync(path.join(cwd, "old.txt"));
  put(cwd, "new.txt");
  put(cwd, "untouched.txt");
  put(cwd, "caf\u00e9 \u00e9.txt");
  const saved = await actions.save(cwd, { paths: ["README.md", "new.txt", "old.txt", "caf\u00e9 \u00e9.txt"], message: "  Fix the readme  " });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.files, 4);
  assert.equal(saved.branch, "main");
  assert.equal(saved.sha, box.git(cwd, "rev-parse", "HEAD"), "the sha of the new commit");
  assert.equal(saved.short, saved.sha.slice(0, 7));
  assert.deepEqual(changed(box, cwd), ["A\tcaf\u00e9 \u00e9.txt", "A\tnew.txt", "D\told.txt", "M\tREADME.md"]);
  assert.equal(box.git(cwd, "log", "-1", "--format=%s"), "Fix the readme");
  assert.equal(box.git(cwd, "log", "-1", "--format=%an <%ae>"), "Fixture Owner <owner@fixture.invalid>");
  assert.deepEqual(status(box, cwd), [" M other.txt", "?? untouched.txt", "M  peer.txt"], "the second dirty file, the untracked one and a peer's staged file are untouched");
  // A message with quotes, a line break, a non-ASCII mark, or a leading dash is text, never a flag.
  put(cwd, "other.txt", "other edited again\n");
  const quoted = await actions.save(cwd, { paths: ["other.txt"], message: 'Say "hi" ✓\n\nSecond line' });
  assert.equal(quoted.ok, true, quoted.error);
  assert.equal(box.git(cwd, "log", "-1", "--format=%B").trim(), 'Say "hi" ✓\n\nSecond line');
  put(cwd, "other.txt", "other edited a third time\n");
  assert.equal((await actions.save(cwd, { paths: ["other.txt"], message: "--no-verify please" })).ok, true);
  assert.equal(box.git(cwd, "log", "-1", "--format=%s"), "--no-verify please");
  assertGentle(calls);
  const commit = calls.find((call) => call.args.includes("commit"));
  assert.deepEqual(commit.args.slice(0, 4), ["--literal-pathspecs", "commit", "-m", "Fix the readme"]);
  assert.ok(commit.args.includes("--"));
  assert.ok(!commit.args.includes("-c"), "no identity is set when git has one");
  assert.ok(!calls.some((call) => call.args.some((arg) => /^user\./.test(arg))));
});

test("an empty message gets the default, and a save is refused for anything the preview does not allow", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box, { statOf: sizes({ "huge.bin": 120 * MIB }) });
  const cwd = repoWith(box, "app", { "README.md": "# app\n" });
  put(cwd, "README.md", "# app\n2\n");
  put(cwd, "b.txt");
  put(cwd, ".env", "X=1\n");
  put(cwd, "huge.bin", "x");
  const head = box.git(cwd, "rev-parse", "HEAD");
  const missing = await actions.save(cwd, { paths: ["README.md", "nope.txt"] });
  assert.deepEqual([missing.ok, missing.kind], [false, "not-in-preview"]);
  assert.equal((await actions.save(cwd, { paths: ["../outside.txt"] })).kind, "not-in-preview");
  const secret = await actions.save(cwd, { paths: ["README.md", ".env"] });
  assert.deepEqual([secret.ok, secret.kind, secret.blocked.path], [false, "blocked", ".env"]);
  assert.equal(secret.error, "Stopped: an environment file in .env.");
  assert.equal(secret.refusal.state, "blocked-secret");
  assert.equal(rules.describe({ glance: { isRepo: true, unborn: false, branch: "main", dirty: 2, ahead: 0, behind: 0, upstream: "origin/main", remote: "octo-cat/app", main: "main", onDefault: true, available: true }, refusal: secret.refusal }).id, "blocked-secret", "the chip reads the refusal as it stands");
  const large = await actions.save(cwd, { paths: ["huge.bin"] });
  assert.deepEqual([large.kind, large.refusal.state, large.refusal.mb], ["blocked", "too-large", 120]);
  assert.equal((await actions.save(cwd, { paths: [] })).kind, "nothing");
  assert.equal((await actions.save(cwd, {})).kind, "nothing");
  assert.equal(box.git(cwd, "rev-parse", "HEAD"), head, "a refused save commits nothing");
  assert.ok(!status(box, cwd).some((line) => line.startsWith("A") || line.startsWith(" A")), "and leaves nothing half-added");
  assert.ok(!calls.some((call) => call.args.includes("commit")));
  const done = await actions.save(cwd, { paths: ["README.md", "b.txt"], message: "" });
  assert.equal(done.ok, true);
  assert.equal(box.git(cwd, "log", "-1", "--format=%s"), "Studio save: 2 files");
});

test("a save is refused in the middle of a merge, on a detached HEAD, and while agents build unless told otherwise", async (t) => {
  const box = sandbox(t);
  const { actions } = harness(t, box);
  const cwd = repoWith(box, "app", { "a.txt": "base\n" });
  box.git(cwd, "checkout", "-q", "-b", "other");
  put(cwd, "a.txt", "other\n");
  box.git(cwd, "commit", "-q", "-am", "other");
  box.git(cwd, "checkout", "-q", "main");
  put(cwd, "a.txt", "mine\n");
  box.git(cwd, "commit", "-q", "-am", "mine");
  box.tryGit(cwd, "merge", "other");
  put(cwd, "b.txt");
  const merging = await actions.save(cwd, { paths: ["b.txt"] });
  assert.deepEqual([merging.ok, merging.kind, merging.refusal.kind], [false, "merge", "merge"]);
  assert.match(merging.error, /merge is in progress/);
  box.git(cwd, "merge", "--abort");

  const busy = await actions.save(cwd, { paths: ["b.txt"], builders: true });
  assert.deepEqual([busy.ok, busy.kind], [false, "builders"]);
  assert.match(busy.error, /Agents are still changing files/);
  assert.equal((await actions.save(cwd, { paths: ["b.txt"], builders: true, ignoreBuilders: true })).ok, true);

  box.git(cwd, "checkout", "-q", "--detach");
  put(cwd, "c.txt");
  const detached = await actions.save(cwd, { paths: ["c.txt"] });
  assert.deepEqual([detached.ok, detached.kind], [false, "detached"]);
  assert.match(detached.error, /not on a branch/);
});

test("the first commit of a repository with none goes through the same path-limited save", async (t) => {
  const box = sandbox(t);
  const { actions } = harness(t, box);
  const cwd = box.dir("fresh");
  box.git(cwd, "init", "-q", "-b", "main");
  put(cwd, "README.md");
  put(cwd, "b.txt");
  const saved = await actions.save(cwd, { paths: ["README.md"], message: "First" });
  assert.equal(saved.ok, true);
  assert.deepEqual(changed(box, cwd), ["A\tREADME.md"]);
  assert.deepEqual(status(box, cwd), ["?? b.txt"]);
});

test("a staged rename is two rows that save as one rename, and an earlier intent-to-add is picked up, not repeated", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box);
  const cwd = repoWith(box, "app", { "a.txt": "content that is long enough to be seen as a rename\n".repeat(6), "x.txt": "x\n" });
  box.git(cwd, "mv", "a.txt", "b.txt");
  put(cwd, "y.txt");
  box.git(cwd, "add", "-N", "y.txt");
  const view = await actions.preview(cwd);
  const row = (name) => view.files.find((file) => file.path === name);
  assert.deepEqual([row("b.txt").status, row("a.txt").status, row("y.txt").status, row("y.txt").untracked], ["changed", "deleted", "new", false]);
  const saved = await actions.save(cwd, { paths: ["a.txt", "b.txt", "y.txt"] });
  assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(changed(box, cwd), ["A\ty.txt", "R100\ta.txt\tb.txt"]);
  assert.deepEqual(status(box, cwd), []);
  assert.ok(!calls.some((call) => call.args.includes("-N")), "a file git already knows is not added again");
});

test("more changed files than a dialog can review are refused, never saved blind", async (t) => {
  const box = sandbox(t);
  const listing = `${["# branch.oid abc", "# branch.head main", ...Array.from({ length: MAX_FILES + 1 }, (_, index) => `? f${index}.txt`)].join("\0")}\0`;
  const { actions, calls } = harness(t, box, { intercept: (command, args) => (command === "git" && args[0] === "status" && args.includes("-z") ? { stdout: listing } : null) });
  const cwd = repoWith(box, "app");
  const view = await actions.preview(cwd);
  assert.deepEqual([view.ok, view.files.length, view.refusal.kind], [true, MAX_FILES, "too-many"]);
  assert.match(view.refusal.text, /More than 5000 files changed/);
  const saved = await actions.save(cwd, { paths: ["f1.txt"] });
  assert.deepEqual([saved.ok, saved.kind], [false, "too-many"]);
  assert.ok(!calls.some((call) => call.args.includes("commit")));
});

test("nothing throws, whatever the host's own calls do", async (t) => {
  const box = sandbox(t);
  const broken = createGitActions({ execFile: () => { throw new Error(`boom https://octo:${TOKEN}@github.com/x`); }, exists: () => { throw new Error("no disk"); }, env: () => box.env });
  const root = box.dir("app");
  assert.equal(await broken.glance(root), null);
  assert.deepEqual(await broken.glanceMany([{ id: "a", root }]), [{ id: "a", glance: null }]);
  for (const result of [await broken.preview(root), await broken.save(root, { paths: ["a"] }), await broken.pushBranch(root), await broken.publish(root, { owner: "o", name: "n" }), await broken.link(root, { repo: "o/n", isListed: () => true }), await broken.publishPreview(root, { owner: "o", name: "n" })]) {
    assert.deepEqual([result.ok, result.kind], [false, "error"]);
    assert.doesNotMatch(JSON.stringify(result), /ghp_|octo:/);
  }
  const noExec = createGitActions({ execFile: () => { throw new Error("spawn git ENOENT"); }, exists: () => true, env: () => box.env });
  assert.equal(await noExec.glance(root), null);
  assert.equal((await noExec.account()).ghInstalled, false);
});

test("git's own identity wins; without one Studio commits as the account for that commit only", async (t) => {
  const box = sandbox(t, { identity: false });
  const noAccount = harness(t, box, { gh: ghFake({ account: null }) });
  const cwd = box.dir("app");
  box.git(cwd, "init", "-q", "-b", "main");
  put(cwd, "a.txt");
  const view = await noAccount.actions.preview(cwd);
  assert.deepEqual(view.identity, { ok: false, fromAccount: false });
  const refused = await noAccount.actions.save(cwd, { paths: ["a.txt"] });
  assert.deepEqual([refused.ok, refused.kind], [false, "identity"]);
  assert.match(refused.error, /does not know who you are/);

  const given = harness(t, box, { gh: ghFake({ account: null }) });
  const passed = await given.actions.save(cwd, { paths: ["a.txt"], identity: { name: "octo-cat", email: "4242+octo-cat@users.noreply.github.com" } });
  assert.equal(passed.ok, true);
  assert.equal(box.git(cwd, "log", "-1", "--format=%an <%ae>|%cn <%ce>"), "octo-cat <4242+octo-cat@users.noreply.github.com>|octo-cat <4242+octo-cat@users.noreply.github.com>");
  const commit = given.gitCalls("commit")[0];
  assert.deepEqual(commit.args.slice(0, 5), ["--literal-pathspecs", "-c", "user.name=octo-cat", "-c", "user.email=4242+octo-cat@users.noreply.github.com"]);
  assert.equal(box.tryGit(cwd, "config", "--get", "user.name"), "failed: ", "nothing was written to the config");

  put(cwd, "b.txt");
  const derived = await harness(t, box).actions.save(cwd, { paths: ["b.txt"] });
  assert.equal(derived.ok, true);
  assert.equal(box.git(cwd, "log", "-1", "--format=%an <%ae>"), "octo-cat <octo-cat@users.noreply.github.com>", "from the signed-in login when nothing was passed");
  assert.deepEqual((await harness(t, box).actions.preview(cwd)).identity, { ok: true, name: "octo-cat", email: "octo-cat@users.noreply.github.com", fromAccount: true });

  const owned = sandbox(t);
  const own = harness(t, owned);
  const there = owned.dir("app");
  owned.git(there, "init", "-q", "-b", "main");
  put(there, "a.txt");
  assert.equal((await own.actions.save(there, { paths: ["a.txt"], identity: { name: "someone else", email: "else@example.invalid" } })).ok, true);
  assert.equal(owned.git(there, "log", "-1", "--format=%an"), "Fixture Owner", "a passed identity never overrides git's");
  assertGentle([...noAccount.calls, ...given.calls, ...own.calls]);
});

test("CRLF warnings on stderr do not fail a save: the exit code decides", async (t) => {
  const box = sandbox(t, { autocrlf: true });
  const { actions } = harness(t, box);
  const cwd = box.dir("app");
  box.git(cwd, "init", "-q", "-b", "main");
  put(cwd, "a.txt", "one\ntwo\n");
  const saved = await actions.save(cwd, { paths: ["a.txt"], message: "lf" });
  assert.equal(saved.ok, true);
  put(cwd, "a.txt", "one\ntwo\nthree\n");
  assert.equal((await actions.save(cwd, { paths: ["a.txt"], message: "more" })).ok, true);
});

test("a busy index is retried at 250 ms and 1.5 s, then the save says another session is committing", async (t) => {
  assert.deepEqual([...LOCK_DELAYS], [0, 250, 1500]);
  const box = sandbox(t);
  const lockText = "fatal: Unable to create 'X/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository";
  let lockedCommits = 2;
  const flaky = harness(t, box, { intercept: (command, args) => (args.includes("commit") && lockedCommits-- > 0 ? { fail: true, code: 128, stderr: lockText } : null) });
  const cwd = repoWith(box, "app");
  put(cwd, "README.md", "# app\nedited\n");
  put(cwd, "new.txt");
  const saved = await flaky.actions.save(cwd, { paths: ["README.md", "new.txt"] });
  assert.equal(saved.ok, true);
  assert.deepEqual(flaky.sleeps, [250, 1500]);
  assert.equal(flaky.gitCalls("commit").length, 3);
  assert.deepEqual(changed(box, cwd), ["A\tnew.txt", "M\tREADME.md"]);

  const stuck = harness(t, box, { intercept: (command, args) => (args.includes("commit") ? { fail: true, code: 128, stderr: lockText } : null) });
  put(cwd, "second.txt");
  const refused = await stuck.actions.save(cwd, { paths: ["second.txt"] });
  assert.deepEqual([refused.ok, refused.kind, refused.error], [false, "locked", "Another session is committing; try again."]);
  assert.equal(stuck.gitCalls("commit").length, 3);
  assert.deepEqual(status(box, cwd), ["?? second.txt"], "the file made known for the commit is let go again");
});

test("a real index.lock that clears in time lets the save through", async (t) => {
  const box = sandbox(t);
  const noSleep = harness(t, box, { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) });
  const cwd = repoWith(box, "app");
  put(cwd, "README.md", "# app\nedited\n");
  const lock = path.join(cwd, ".git", "index.lock");
  writeFileSync(lock, "");
  setTimeout(() => { try { unlinkSync(lock); } catch { /* already gone */ } }, 800);
  const saved = await noSleep.actions.save(cwd, { paths: ["README.md"] });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(noSleep.gitCalls("commit").length >= 2, true, "it did retry");
});

test("a very long list of paths goes to git on stdin, still one path-limited commit", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box);
  const cwd = repoWith(box, "app");
  const names = Array.from({ length: 300 }, (_, index) => `generated/some-long-directory-name-${index}/file-with-a-long-name-${index}.txt`);
  for (const name of names) put(cwd, name);
  put(cwd, "left.txt");
  const saved = await actions.save(cwd, { paths: names, message: "many" });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.files, 300);
  assert.equal(changed(box, cwd).length, 300);
  assert.deepEqual(status(box, cwd), ["?? left.txt"]);
  assert.ok(calls.some((call) => call.args.includes("--pathspec-from-file=-") && call.args.includes("commit")), "the commit read its paths from stdin");
  assert.ok(calls.some((call) => call.args.includes("--pathspec-from-file=-") && call.args.includes("add")));
  assertGentle(calls);
});

test("two saves of one folder never overlap", async (t) => {
  const box = sandbox(t);
  const { actions } = harness(t, box);
  const cwd = repoWith(box, "app");
  put(cwd, "one.txt");
  put(cwd, "two.txt");
  const [first, second] = await Promise.all([actions.save(cwd, { paths: ["one.txt"], message: "one" }), actions.save(cwd, { paths: ["two.txt"], message: "two" })]);
  assert.deepEqual([first.ok, second.ok], [true, true]);
  assert.deepEqual(box.git(cwd, "log", "--format=%s", "-2").split(/\r?\n/), ["two", "one"]);
});

// ---- pushing a branch ---------------------------------------------------------------------
async function pushFixture(t) {
  const box = sandbox(t);
  const hub = box.bare("hub.git");
  const work = box.dir("work");
  box.git(work, "init", "-q", "-b", "main");
  put(work, "a.txt");
  box.git(work, "add", "a.txt");
  box.git(work, "commit", "-q", "-m", "one");
  box.git(work, "remote", "add", "origin", hub);
  return { box, hub, work };
}

test("a branch is pushed with -u, after the check, and never forced", async (t) => {
  const { box, hub, work } = await pushFixture(t);
  const { actions, calls } = harness(t, box);
  const order = [];
  box.git(work, "checkout", "-q", "-b", "feature");
  put(work, "f.txt");
  box.git(work, "add", "f.txt");
  box.git(work, "commit", "-q", "-m", "two");
  const pushed = await actions.pushBranch(work, { check: async () => { order.push("check"); return { ok: true }; } });
  assert.deepEqual({ ok: pushed.ok, branch: pushed.branch, commits: pushed.commits, upstream: pushed.upstream }, { ok: true, branch: "feature", commits: 2, upstream: "origin/feature" });
  assert.equal(box.git(hub, "rev-parse", "feature"), box.git(work, "rev-parse", "HEAD"));
  assert.equal(box.git(work, "rev-parse", "--abbrev-ref", "feature@{upstream}"), "origin/feature");
  const push = calls.find((call) => call.args[0] === "push");
  assert.deepEqual(push.args, ["push", "-u", "origin", "feature"]);
  assert.equal(push.timeout, 10 * 60 * 1000, "a first or big push gets ten minutes");
  assert.deepEqual(order, ["check"]);
  assertGentle(calls);
  // The default branch's first push links it too.
  box.git(work, "checkout", "-q", "main");
  const first = await actions.pushBranch(work);
  assert.deepEqual([first.ok, first.branch, first.commits], [true, "main", 0], "its commit already reached GitHub with the feature branch");
  assert.equal(box.git(work, "rev-parse", "--abbrev-ref", "main@{upstream}"), "origin/main");
});

test("a failing check stops a push before anything is sent", async (t) => {
  const { box, hub, work } = await pushFixture(t);
  const { actions, calls } = harness(t, box);
  const stopped = await actions.pushBranch(work, { check: async () => ({ ok: false, detail: `npm run check: 2 failing https://octo:${TOKEN}@github.com/x` }) });
  assert.deepEqual([stopped.ok, stopped.kind], [false, "check-failed"]);
  assert.match(stopped.error, /The project's check failed, so nothing was pushed/);
  assert.doesNotMatch(JSON.stringify(stopped), /ghp_|octo:/);
  assert.ok(!calls.some((call) => call.args[0] === "push"));
  assert.match(box.tryGit(hub, "rev-parse", "--verify", "main"), /^failed/, "GitHub still has nothing");
  const thrown = await actions.pushBranch(work, { check: async () => { throw new Error("boom"); } });
  assert.deepEqual([thrown.ok, thrown.kind, thrown.detail], [false, "check-failed", "boom"]);
});

test("a refused push says what GitHub said, in the words the chip reads", async (t) => {
  const { box, hub, work } = await pushFixture(t);
  const { actions } = harness(t, box);
  box.git(work, "push", "-q", "-u", "origin", "main");
  const other = path.join(box.root, "other");
  box.git(box.root, "clone", "-q", hub, other);
  put(other, "theirs.txt");
  box.git(other, "add", "theirs.txt");
  box.git(other, "commit", "-q", "-m", "theirs");
  box.git(other, "push", "-q");
  put(work, "mine.txt");
  box.git(work, "add", "mine.txt");
  box.git(work, "commit", "-q", "-m", "mine");
  const late = await actions.pushBranch(work);
  assert.deepEqual([late.ok, late.kind, late.fix], [false, "non-fast-forward", "pull"]);
  assert.equal(late.error, "GitHub has newer work. Pull first.");
  assert.equal(late.refusal.state, "push-refused");
  const chip = rules.describe({ glance: { isRepo: true, unborn: false, branch: "main", dirty: 0, ahead: 1, behind: 0, upstream: "origin/main", remote: "octo-cat/app", main: "main", onDefault: true, available: true }, refusal: late.refusal });
  assert.deepEqual([chip.id, chip.sentence, chip.primary.id], ["push-refused", "GitHub has newer work. Pull first.", "pull"]);
  assert.equal(box.git(hub, "rev-parse", "main"), box.git(other, "rev-parse", "HEAD"), "GitHub's work was not replaced");
});

test("a push maps sign-in and network failures and never lets a login through", async (t) => {
  const { box, work } = await pushFixture(t);
  const auth = harness(t, box, { intercept: (command, args) => (args[0] === "push" ? { fail: true, code: 128, stderr: `fatal: Authentication failed for 'https://octo:${TOKEN}@github.com/octo-cat/app.git/'` } : null) });
  const refused = await auth.actions.pushBranch(work);
  assert.deepEqual([refused.ok, refused.kind, refused.fix], [false, "auth", "sign-in"]);
  assert.equal(refused.error, "GitHub did not accept this PC's sign-in.");
  assert.doesNotMatch(JSON.stringify(refused), /ghp_|octo:/);
  const offline = harness(t, box, { intercept: (command, args) => (args[0] === "push" ? { fail: true, code: 128, stderr: "fatal: unable to access 'https://github.com/x/': Could not resolve host: github.com" } : null) });
  assert.deepEqual([(await offline.actions.pushBranch(work)).kind], ["offline"]);
  const slow = harness(t, box, { intercept: (command, args) => (args[0] === "push" ? { fail: true, killed: true, code: null, stderr: "" } : null) });
  const waiting = await slow.actions.pushBranch(work);
  assert.deepEqual([waiting.ok, waiting.kind, waiting.error], [false, "timeout", "Still uploading."]);
});

test("a push needs a branch, a commit, a remote and a folder", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box);
  const fresh = box.dir("fresh");
  box.git(fresh, "init", "-q", "-b", "main");
  assert.equal((await actions.pushBranch(fresh)).kind, "no-commits");
  const local = repoWith(box, "local");
  assert.equal((await actions.pushBranch(local)).kind, "no-remote");
  box.git(local, "remote", "add", "origin", box.bare("hub.git"));
  box.git(local, "checkout", "-q", "--detach");
  const detached = await actions.pushBranch(local);
  assert.deepEqual([detached.kind, detached.refusal.kind], ["detached", "detached"]);
  assert.match(detached.error, /Start a branch here, then push/);
  assert.equal((await actions.pushBranch(path.join(box.root, "gone"))).kind, "folder-missing");
  assert.ok(!calls.some((call) => call.args[0] === "push"));
});

// ---- publishing --------------------------------------------------------------------------
// A gh that makes the repository by adding the https origin (as the real one does) and records it.
function publishFake(box, { onCreate = null, ...more } = {}) {
  const made = [];
  const gh = ghFake({
    ...more,
    create: (args, options) => {
      made.push({ args, cwd: options.cwd });
      const forced = onCreate?.(args, options);
      if (forced) return forced;
      box.git(options.cwd, "remote", "add", "origin", `https://github.com/${args[2]}.git`);
      return { stdout: `https://github.com/${args[2]}\n` };
    },
  });
  return { gh, made };
}

test("publishing writes .gitignore first, saves a first commit without the secrets, makes the repository and uploads", async (t) => {
  const box = sandbox(t);
  const hub = box.bare("hub.git");
  box.route("octo-cat/app", hub);
  const { gh, made } = publishFake(box);
  const { actions, events, calls } = harness(t, box, { gh });
  const cwd = box.dir("app");
  box.git(cwd, "init", "-q");
  put(cwd, "README.md", "# app\n");
  put(cwd, "src/app.js", "console.log(1);\n");
  put(cwd, ".env", "SECRET=1\n");
  put(cwd, "node_modules/pkg/index.js", "module.exports = 1;\n");
  put(cwd, "package.json", '{"name":"app"}\n');
  const progress = [];
  const published = await actions.publish(cwd, { owner: "octo-cat", name: "app", visibility: "private", description: "  My app  ", gitignore: true, license: "mit", onProgress: (step) => progress.push(`${step.id}:${step.state}`) });
  assert.equal(published.ok, true, published.error);
  assert.deepEqual(progress, published.steps.flatMap((step) => [`${step.id}:start`, `${step.id}:done`]), "the dialog hears each step start and finish, in order");
  assert.deepEqual([published.repo, published.url, published.visibility, published.branch], ["octo-cat/app", "https://github.com/octo-cat/app", "private", "main"]);
  assert.deepEqual(published.steps.map((step) => step.id), ["init", "ignore", "license", "save", "create", "push", "fetch", "upstream"]);
  assert.ok(published.steps.every((step) => step.ok && step.label && step.stage));
  assert.equal(published.left, undefined, "the .gitignore kept the secret out before it could be a finding");

  const firstAdd = events.findIndex((event) => event[0] === "run" && event.includes("add"));
  assert.ok(events.findIndex((event) => event[0] === "write" && event[1] === ".gitignore") < firstAdd, ".gitignore is written before the first add");
  assert.ok(events.findIndex((event) => event[0] === "write" && event[1] === "LICENSE") < firstAdd);
  assert.equal(box.git(cwd, "rev-parse", "--abbrev-ref", "HEAD"), "main", "the unborn master became main");
  assert.deepEqual(changed(box, cwd), [".gitignore", "LICENSE", "README.md", "package.json", "src/app.js"].map((name) => `A\t${name}`));
  assert.match(readFileSync(path.join(cwd, "LICENSE"), "utf8"), new RegExp(`^MIT License\\n\\nCopyright \\(c\\) ${new Date().getFullYear()} octo-cat\\n`));
  assert.match(readFileSync(path.join(cwd, ".gitignore"), "utf8"), /^\.env$/m);
  assert.equal(box.git(cwd, "log", "-1", "--format=%s"), "First commit from Studio");

  assert.equal(made.length, 1);
  assert.deepEqual(made[0].args, ["repo", "create", "octo-cat/app", "--private", "--source", ".", "--remote", "origin", "--description", "My app"]);
  assert.equal(calls.find((call) => call.command === "gh" && call.args[1] === "create").timeout, 120000);
  assert.equal(box.git(hub, "rev-parse", "main"), box.git(cwd, "rev-parse", "HEAD"), "GitHub (the bare repository) has the commit");
  assert.equal(box.git(cwd, "rev-parse", "--abbrev-ref", "main@{upstream}"), "origin/main");
  assert.equal(box.git(cwd, "config", "--get", "remote.origin.url"), "https://github.com/octo-cat/app.git");
  assert.equal(status(box, cwd).filter((line) => !line.startsWith("??")).length, 0);
  assertGentle(calls);
});

test("publishing a folder with no git starts it as main; a master with commits is renamed only when it follows nothing", async (t) => {
  const box = sandbox(t);
  const hub = box.bare("hub.git");
  box.route("octo-cat/app", hub);
  const { gh } = publishFake(box);
  const first = harness(t, box, { gh });
  const plain = box.dir("plain");
  put(plain, "README.md");
  const one = await first.actions.publish(plain, { owner: "octo-cat", name: "app" });
  assert.equal(one.ok, true, one.error);
  assert.deepEqual(first.calls.find((call) => call.command === "git" && call.args[0] === "init").args, ["init", "-b", "main"]);
  assert.equal(box.git(plain, "rev-parse", "--abbrev-ref", "HEAD"), "main");

  const hub2 = box.bare("hub2.git");
  box.route("octo-cat/two", hub2);
  const second = harness(t, box, { gh: publishFake(box).gh });
  const old = repoWith(box, "old", { "README.md": "# old\n" }, { branch: "master" });
  const two = await second.actions.publish(old, { owner: "octo-cat", name: "two" });
  assert.equal(two.ok, true, two.error);
  assert.deepEqual(two.steps.map((step) => step.id), ["init", "ignore", "save", "create", "push", "fetch", "upstream"]);
  assert.deepEqual(second.calls.find((call) => call.command === "git" && call.args[0] === "branch").args, ["branch", "-m", "main"], "a rename, never the forcing -M");
  assert.equal(box.git(old, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.deepEqual(changed(box, old), [".gitignore"].map((name) => `A\t${name}`).concat([]), "only the file Studio wrote was saved");
  assert.equal(box.git(hub2, "log", "-1", "--format=%s", "main"), "Add .gitignore");

  const followed = repoWith(box, "followed", { "README.md": "# f\n" }, { branch: "master" });
  const upstream = box.bare("up.git");
  box.git(followed, "remote", "add", "upstream", upstream);
  box.git(followed, "push", "-q", "-u", "upstream", "master");
  const third = harness(t, box, { gh: publishFake(box).gh });
  const kept = await third.actions.publish(followed, { owner: "octo-cat", name: "three" });
  assert.deepEqual([kept.ok, kept.kind], [false, "has-upstream"]);
  assert.equal(box.git(followed, "rev-parse", "--abbrev-ref", "HEAD"), "master", "a branch that follows something is not renamed");
  assert.ok(!third.calls.some((call) => call.command === "gh" && call.args[1] === "create"));
  assert.ok(!existsSync(path.join(followed, ".gitignore")), "nothing was written");

  const loose = repoWith(box, "loose");
  box.git(loose, "checkout", "-q", "--detach");
  const detached = await harness(t, box).actions.publish(loose, { owner: "octo-cat", name: "loose" });
  assert.deepEqual([detached.ok, detached.kind], [false, "detached"]);
});

test("a public repository needs the typed owner/name, and nothing is written or made without it", async (t) => {
  const box = sandbox(t);
  const hub = box.bare("hub.git");
  box.route("octo-cat/app", hub);
  const { gh, made } = publishFake(box);
  const { actions, calls } = harness(t, box, { gh });
  const cwd = box.dir("app");
  put(cwd, "README.md");
  for (const confirmPublic of [undefined, "", "octo-cat", "octo-cat/App", "octo-cat/other", "yes"]) {
    const refused = await actions.publish(cwd, { owner: "octo-cat", name: "app", visibility: "public", confirmPublic });
    assert.deepEqual([refused.ok, refused.kind, refused.error], [false, "confirm-public", "Type octo-cat/app to make it public."], String(confirmPublic));
    assert.deepEqual(refused.steps, []);
  }
  assert.deepEqual(made, []);
  assert.ok(!existsSync(path.join(cwd, ".gitignore")) && !existsSync(path.join(cwd, ".git")), "the folder was left as it was");
  assert.ok(!calls.some((call) => call.command === "git" && ["init", "add", "commit"].includes(call.args[0])));
  const bad = await actions.publish(cwd, { owner: "octo-cat", name: "app", visibility: "secret" });
  assert.equal(bad.kind, "visibility");
  const odd = await actions.publish(cwd, { owner: "octo-cat", name: "bad name!" });
  assert.equal(odd.kind, "name");
  const opened = await actions.publish(cwd, { owner: "octo-cat", name: "app", visibility: "public", confirmPublic: " octo-cat/app " });
  assert.equal(opened.ok, true, opened.error);
  assert.deepEqual(made[0].args.slice(0, 4), ["repo", "create", "octo-cat/app", "--public"]);
});

test("publishing stops for a missing GitHub CLI, a signed-out account, an exFAT drive, another origin and a nested folder", async (t) => {
  const box = sandbox(t);
  const cwd = box.dir("app");
  put(cwd, "README.md");
  const missing = harness(t, box, { intercept: (command, args) => (command === "gh" ? { fail: true, code: "ENOENT", message: "spawn gh ENOENT" } : null) });
  const noGh = await missing.actions.publish(cwd, { owner: "octo-cat", name: "app" });
  assert.deepEqual([noGh.ok, noGh.kind, noGh.fix, noGh.error], [false, "gh-missing", "install-gh", "GitHub CLI is not installed on this PC."]);
  const signedOut = harness(t, box, { gh: ghFake({ account: null }) });
  const out = await signedOut.actions.publish(cwd, { owner: "octo-cat", name: "app" });
  assert.deepEqual([out.ok, out.kind, out.fix, out.error], [false, "not-signed-in", "sign-in", "Sign in to GitHub first."]);
  assert.ok(!existsSync(path.join(cwd, ".git")) && !existsSync(path.join(cwd, ".gitignore")), "nothing was made before the sign-in check");
  if (/^[A-Za-z]:/.test(cwd)) {
    const weak = harness(t, box, { fsutil: () => ({ stdout: "Volume Name : Backup\nFile System Name : exFAT\n" }) });
    const exfat = await weak.actions.publish(cwd, { owner: "octo-cat", name: "app" });
    assert.deepEqual([exfat.ok, exfat.kind], [false, "weak-drive"]);
    assert.match(exfat.error, /cannot keep a Git project reliably/);
    assert.ok(!existsSync(path.join(cwd, ".git")));
    assert.equal((await weak.actions.publishPreview(cwd, { owner: "octo-cat", name: "app" })).weakDrive, true);
  }
  const linked = repoWith(box, "linked");
  box.git(linked, "remote", "add", "origin", "https://github.com/someone/else.git");
  const { gh, made } = publishFake(box);
  const other = await harness(t, box, { gh }).actions.publish(linked, { owner: "octo-cat", name: "app" });
  assert.deepEqual([other.ok, other.kind], [false, "has-remote"]);
  assert.equal(box.git(linked, "config", "--get", "remote.origin.url"), "https://github.com/someone/else.git", "an existing origin is never replaced");
  assert.deepEqual(made, []);
  const inner = path.join(linked, "sub");
  mkdirSync(inner);
  assert.equal((await harness(t, box, { gh }).actions.publish(inner, { owner: "octo-cat", name: "app" })).kind, "nested");
  assert.equal((await harness(t, box).actions.publish(path.join(box.root, "gone"), { owner: "octo-cat", name: "app" })).kind, "folder-missing");
});

test("the first commit leaves out what it must, and says which files those were", async (t) => {
  const box = sandbox(t);
  const hub = box.bare("hub.git");
  box.route("octo-cat/app", hub);
  const { gh } = publishFake(box);
  const { actions } = harness(t, box, { gh, statOf: sizes({ "blob.bin": 120 * MIB }) });
  const cwd = box.dir("app");
  put(cwd, "README.md");
  put(cwd, "config.js", `${KEY_LINE}\nabc\n`);
  put(cwd, "blob.bin", "x");
  put(cwd, "ok.txt");
  const published = await actions.publish(cwd, { owner: "octo-cat", name: "app", gitignore: false });
  assert.equal(published.ok, true, published.error);
  assert.deepEqual(published.left.map((item) => item.path).sort(), ["blob.bin", "config.js"]);
  assert.match(published.left.find((item) => item.path === "config.js").why, /a private key/);
  assert.deepEqual(changed(box, cwd), ["A\tREADME.md", "A\tok.txt"]);
  const empty = harness(t, box, { gh, statOf: sizes({}) });
  const nothing = box.dir("nothing");
  put(nothing, ".env", "X=1\n");
  const none = await empty.actions.publish(nothing, { owner: "octo-cat", name: "nothing", gitignore: false });
  assert.deepEqual([none.ok, none.kind, none.steps.at(-1).id, none.steps.at(-1).ok], [false, "nothing", "save", false]);
});

test("publishing again after a half-finished try picks up where it stopped", async (t) => {
  const box = sandbox(t);
  const hub = box.bare("hub.git");
  box.route("octo-cat/app", hub);
  const { gh, made } = publishFake(box);
  let breakPush = true;
  const views = { "octo-cat/app": { nameWithOwner: "octo-cat/app", owner: { login: "octo-cat" }, isEmpty: true, isPrivate: true } };
  const { actions, calls } = harness(t, box, {
    gh: (args, options) => (args[1] === "view" ? { stdout: JSON.stringify(views[args[2]]) } : gh(args, options)),
    intercept: (command, args) => (breakPush && args[0] === "push" ? { fail: true, code: 128, stderr: "fatal: unable to access 'https://github.com/octo-cat/app.git/': Could not resolve host: github.com" } : null),
  });
  const cwd = box.dir("app");
  put(cwd, "README.md");
  const first = await actions.publish(cwd, { owner: "octo-cat", name: "app" });
  assert.deepEqual([first.ok, first.kind], [false, "offline"]);
  assert.equal(first.error, "GitHub could not be reached. Nothing was pushed.");
  assert.deepEqual(first.steps.map((step) => [step.id, step.ok]).slice(-2), [["create", true], ["push", false]]);
  assert.equal(made.length, 1);
  assert.equal(box.git(cwd, "config", "--get", "remote.origin.url"), "https://github.com/octo-cat/app.git");

  breakPush = false;
  const second = await actions.publish(cwd, { owner: "octo-cat", name: "app" });
  assert.equal(second.ok, true, second.error);
  assert.equal(made.length, 1, "the repository is not made twice");
  assert.deepEqual(second.steps.map((step) => step.id), ["ignore", "save", "push", "fetch", "upstream"], "no init, no create; the .gitignore and the commit are already true");
  assert.equal(box.git(hub, "rev-parse", "main"), box.git(cwd, "rev-parse", "HEAD"));
  assert.equal(box.git(cwd, "log", "--format=%s").split(/\r?\n/).length, 1, "no second first commit");
  const again = await actions.publish(cwd, { owner: "octo-cat", name: "app" });
  assert.equal(again.ok, true, "and once it is done, again is harmless");
  assertGentle(calls);

  // An origin that already points at the target, but at a repository of the other visibility, is refused before any step.
  views["octo-cat/app"].isPrivate = false;
  const mismatch = await actions.publish(cwd, { owner: "octo-cat", name: "app" });
  assert.deepEqual([mismatch.ok, mismatch.kind, mismatch.steps], [false, "visibility-mismatch", []]);
});

test("a name that is already the account's own empty repository is linked, and only then", async (t) => {
  const box = sandbox(t);
  const hub = box.bare("hub.git");
  box.route("octo-cat/app", hub);
  const taken = { fail: true, stderr: "GraphQL: Name already exists on this account (createRepository)" };
  const views = { "octo-cat/app": { nameWithOwner: "octo-cat/app", owner: { login: "octo-cat" }, isEmpty: true, isPrivate: true } };
  const { gh, made } = publishFake(box, { views, onCreate: () => taken });
  const { actions, calls } = harness(t, box, { gh });
  const cwd = box.dir("app");
  put(cwd, "README.md");
  const linked = await actions.publish(cwd, { owner: "octo-cat", name: "app" });
  assert.equal(linked.ok, true, linked.error);
  assert.equal(made.length, 1);
  assert.equal(linked.steps.find((step) => step.id === "create").ok, true);
  assert.equal(box.git(cwd, "config", "--get", "remote.origin.url"), "https://github.com/octo-cat/app.git", "origin was added over https");
  assert.equal(box.git(hub, "rev-parse", "main"), box.git(cwd, "rev-parse", "HEAD"));
  assertGentle(calls);

  const refuse = async (name, view) => {
    const there = box.dir(name);
    put(there, "README.md");
    const h = harness(t, box, { gh: publishFake(box, { views: { [`octo-cat/${name}`]: view }, onCreate: () => taken }).gh });
    return h.actions.publish(there, { owner: "octo-cat", name });
  };
  const full = await refuse("full", { nameWithOwner: "octo-cat/full", owner: { login: "octo-cat" }, isEmpty: false, isPrivate: true });
  assert.deepEqual([full.ok, full.kind, full.fix, full.error], [false, "name-taken", "link", "octo-cat/full already exists. Link to it, or pick another name."]);
  const theirs = await refuse("theirs", { nameWithOwner: "octo-cat/theirs", owner: { login: "someone-else" }, isEmpty: true, isPrivate: true });
  assert.equal(theirs.kind, "name-taken");
  const open = await refuse("open", { nameWithOwner: "octo-cat/open", owner: { login: "octo-cat" }, isEmpty: true, isPrivate: false });
  assert.deepEqual([open.ok, open.kind], [false, "visibility-mismatch"]);
  assert.match(open.error, /is public on GitHub, not private/);
});

test("failures from gh are named, and no login or token leaves in any of them", async (t) => {
  const box = sandbox(t);
  const cwd = box.dir("app");
  put(cwd, "README.md");
  const failing = (stderr, extra = {}) => harness(t, box, { gh: publishFake(box, { onCreate: () => ({ fail: true, stderr, ...extra }) }).gh });
  const offline = await failing(`error connecting to api.github.com https://octo:${TOKEN}@github.com/x`).actions.publish(cwd, { owner: "octo-cat", name: "app" });
  assert.deepEqual([offline.ok, offline.kind, offline.error], [false, "offline", "You're offline. Nothing was created."]);
  assert.doesNotMatch(JSON.stringify(offline), /ghp_|octo:/);
  const there = box.dir("two");
  put(there, "README.md");
  const org = await failing("GraphQL: octo-org: cannot create a repository for octo-org").actions.publish(there, { owner: "octo-org", name: "app" });
  assert.deepEqual([org.kind, org.fix], ["org-permission", "pick-owner"]);
  const scope = await failing(`HTTP 401: Bad credentials (https://api.github.com/graphql) ${TOKEN}`).actions.publish(box.dir("three"), { owner: "octo-cat", name: "app" });
  assert.equal(scope.kind, "not-signed-in");
  assert.doesNotMatch(JSON.stringify(scope), /ghp_/);
  const slow = await failing("", { killed: true, code: null }).actions.publish(box.dir("four"), { owner: "octo-cat", name: "app" });
  assert.equal(slow.kind, "timeout");
});

// ---- linking to a repository that exists --------------------------------------------------
async function linkFixture(t, { seed = "related" } = {}) {
  const box = sandbox(t);
  const hub = box.bare("hub.git");
  box.route("octo-cat/app", hub);
  const work = repoWith(box, "work", { "README.md": "# app\n" });
  if (seed === "related") {
    box.git(work, "push", "-q", hub, "main");
  } else if (seed === "unrelated") {
    const stranger = repoWith(box, "stranger", { "other.txt": "not ours\n" });
    box.git(stranger, "push", "-q", hub, "main");
  }
  return { box, hub, work };
}

test("linking takes only a listed repository and adds origin over https", async (t) => {
  const { box, work } = await linkFixture(t);
  const { actions, calls } = harness(t, box);
  for (const repo of ["octo-cat/other", "octo-cat/app; calc.exe", "", undefined, "https://evil.example/x.git"]) {
    const refused = await actions.link(work, { repo, isListed: (name) => name === "octo-cat/app" });
    assert.deepEqual([refused.ok, refused.kind, refused.error], [false, "not-listed", "Choose a repository from your list."], String(repo));
  }
  assert.equal((await actions.link(work, { repo: "octo-cat/app" })).kind, "not-listed", "with no allow-list nothing is allowed");
  assert.ok(!calls.some((call) => call.args.includes("remote")), "nothing ran for a repository that was not listed");
  const linked = await actions.link(work, { repo: "octo-cat/app", isListed: (name) => name === "octo-cat/app" });
  assert.deepEqual({ ok: linked.ok, repo: linked.repo, related: linked.related, empty: linked.empty, upstream: linked.upstream }, { ok: true, repo: "octo-cat/app", related: true, empty: false, upstream: true });
  assert.equal(box.git(work, "config", "--get", "remote.origin.url"), "https://github.com/octo-cat/app.git");
  assert.equal(box.git(work, "rev-parse", "--abbrev-ref", "main@{upstream}"), "origin/main");
  const held = harness(t, box, { isListed: new Set(["octo-cat/again"]) });
  assert.equal((await held.actions.link(work, { repo: "octo-cat/again" })).kind, "exists", "an origin is never replaced");
  assert.equal(box.git(work, "config", "--get", "remote.origin.url"), "https://github.com/octo-cat/app.git");
  assertGentle(calls);
  assert.ok(!calls.some((call) => ["rebase", "merge", "pull", "push", "reset"].includes(call.args[0])), "linking only adds a remote and fetches");
});

test("unrelated histories are refused and the link is undone, never rebased", async (t) => {
  const { box, work, hub } = await linkFixture(t, { seed: "unrelated" });
  const { actions, calls } = harness(t, box, { isListed: ["octo-cat/app"] });
  const head = box.git(work, "rev-parse", "HEAD");
  const refused = await actions.link(work, { repo: "octo-cat/app" });
  assert.deepEqual([refused.ok, refused.kind], [false, "unrelated"]);
  assert.equal(refused.error, "GitHub's copy of octo-cat/app is a different project (no shared history).");
  assert.equal(box.git(work, "remote").trim(), "", "origin is gone again");
  assert.equal(box.git(work, "rev-parse", "HEAD"), head);
  assert.ok(calls.some((call) => call.args[0] === "merge-base"));
  assert.ok(!calls.some((call) => ["rebase", "merge", "pull", "push", "reset", "checkout"].includes(call.args[0])));
  assert.match(box.git(hub, "log", "--format=%s", "main"), /seed/);
});

test("an empty repository is linked and left for the first push; a failed fetch leaves no origin behind", async (t) => {
  const { box, work } = await linkFixture(t, { seed: "empty" });
  const { actions } = harness(t, box, { isListed: () => true });
  const empty = await actions.link(work, { repo: "octo-cat/app" });
  assert.deepEqual({ ok: empty.ok, empty: empty.empty, upstream: empty.upstream }, { ok: true, empty: true, upstream: false });
  assert.equal(box.git(work, "config", "--get", "remote.origin.url"), "https://github.com/octo-cat/app.git");
  const chip = rules.describe({ glance: await actions.glance(work) });
  assert.ok(["no-upstream", "other-remote"].includes(chip.id));
  const lost = sandbox(t);
  lost.route("octo-cat/gone", path.join(lost.root, "no-such-hub.git"));
  const there = repoWith(lost, "work");
  const failing = await harness(t, lost, { isListed: () => true }).actions.link(there, { repo: "octo-cat/gone" });
  assert.equal(failing.ok, false);
  assert.equal(lost.git(there, "remote").trim(), "", "the failed link is undone");
  const offline = harness(t, lost, { isListed: () => true, intercept: (command, args) => (args[0] === "fetch" ? { fail: true, code: 128, stderr: "fatal: unable to access 'https://github.com/octo-cat/gone.git/': Could not resolve host: github.com" } : null) });
  const away = await offline.actions.link(there, { repo: "octo-cat/gone" });
  assert.deepEqual([away.ok, away.kind, away.fix], [false, "offline", "retry"]);
  assert.equal(lost.git(there, "remote").trim(), "");
  const fresh = lost.dir("fresh");
  lost.git(fresh, "init", "-q", "-b", "main");
  assert.equal((await harness(t, lost, { isListed: () => true }).actions.link(fresh, { repo: "octo-cat/gone" })).kind, "no-commits");
  assert.equal((await harness(t, lost, { isListed: () => true }).actions.link(lost.dir("plain"), { repo: "octo-cat/gone" })).kind, "not-repo");
});

// ---- account, owners, names and the publish preview -----------------------------------------
test("the account is a name and two flags, never a token", async (t) => {
  const box = sandbox(t);
  const signedIn = harness(t, box);
  const who = await signedIn.actions.account();
  assert.deepEqual(who, { ok: true, account: "octo-cat", ghInstalled: true, gitInstalled: true });
  assert.doesNotMatch(JSON.stringify(who), /gho_|Token/);
  assert.deepEqual(signedIn.calls.find((call) => call.command === "gh").args, ["auth", "status", "--hostname", "github.com"]);
  assert.deepEqual(await harness(t, box, { gh: ghFake({ account: null }) }).actions.account(), { ok: true, account: null, ghInstalled: true, gitInstalled: true });
  const none = harness(t, box, { intercept: (command) => (command === "gh" ? { fail: true, code: "ENOENT", message: "spawn gh ENOENT" } : null) });
  assert.deepEqual(await none.actions.account(), { ok: true, account: null, ghInstalled: false, gitInstalled: true });
});

test("owners are the account and its organizations; an identity is the login with GitHub's no-reply address", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box, { gh: ghFake({ orgs: ["octo-org", "bad name", "other-org"] }) });
  assert.deepEqual(await actions.owners(), { ok: true, account: "octo-cat", orgs: ["octo-org", "other-org"] });
  assert.deepEqual(calls.find((call) => call.args[1] === "user/orgs").args, ["api", "user/orgs", "--paginate", "--jq", ".[].login"]);
  const out = await harness(t, box, { gh: ghFake({ account: null }) }).actions.owners();
  assert.deepEqual([out.ok, out.kind, out.fix], [false, "not-signed-in", "sign-in"]);
  assert.deepEqual(await actions.identity(), { ok: true, name: "octo-cat", email: "4242+octo-cat@users.noreply.github.com" });
  const offline = harness(t, box, { gh: ghFake({ userId: null }) });
  assert.deepEqual(await offline.actions.identity(), { ok: true, name: "octo-cat", email: "octo-cat@users.noreply.github.com" });
});

test("a name check says whether GitHub accepts a name and whether it is taken", async (t) => {
  const box = sandbox(t);
  const views = { "octo-cat/taken": { nameWithOwner: "octo-cat/taken" } };
  const { actions, calls } = harness(t, box, { gh: ghFake({ views }) });
  const bad = await actions.nameCheck("octo-cat", "bad name!");
  assert.deepEqual([bad.valid, bad.taken, bad.sanitized, bad.issue], [false, false, "bad-name", "Use letters, numbers, dots, dashes and underscores."]);
  assert.ok(!calls.some((call) => call.command === "gh"), "an invalid name is not asked about");
  assert.equal((await actions.nameCheck("octo-cat", "Mefi's Studio AI+")).sanitized, "Mefis-Studio-AI");
  const taken = await actions.nameCheck("octo-cat", "taken");
  assert.deepEqual([taken.valid, taken.taken, taken.suggestions], [true, true, ["taken-2", "taken-3", "taken-app"]]);
  const free = await actions.nameCheck("octo-cat", "free");
  assert.deepEqual([free.valid, free.taken, free.suggestions], [true, false, []]);
  const offline = await harness(t, box, { gh: () => ({ fail: true, stderr: `dial tcp: lookup api.github.com: no such host https://octo:${TOKEN}@github.com` }) }).actions.nameCheck("octo-cat", "free");
  assert.deepEqual([offline.ok, offline.taken, offline.kind], [true, null, "offline"]);
  assert.doesNotMatch(JSON.stringify(offline), /ghp_|octo:/);
  assert.deepEqual(calls.find((call) => call.command === "gh").args, ["repo", "view", "octo-cat/taken", "--json", "nameWithOwner"]);
});

test("the publish preview lists what would go in, what is stopped, and what publishing still has to do", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box, { statOf: sizes({ "movie.bin": 60 * MIB }), gh: ghFake({ views: { "octo-cat/taken": { nameWithOwner: "octo-cat/taken" } } }) });
  const cwd = box.dir("OneDrive/app");
  box.git(cwd, "init", "-q");
  put(cwd, "README.md");
  put(cwd, "src/app.js");
  put(cwd, ".env", "X=1\n");
  put(cwd, "keys/id.txt", `${KEY_LINE}\nabc\n`);
  put(cwd, "node_modules/pkg/index.js");
  put(cwd, "movie.bin", "x");
  put(cwd, "debug.log");
  const ignoring = await actions.publishPreview(cwd, { owner: "octo-cat", name: "app" });
  assert.equal(ignoring.ok, true);
  assert.deepEqual([ignoring.valid, ignoring.taken, ignoring.repo], [true, false, "octo-cat/app"]);
  assert.deepEqual(ignoring.files.map((file) => file.path).sort(), ["README.md", "keys/id.txt", "movie.bin", "src/app.js"], "the starting .gitignore keeps .env, node_modules and *.log out");
  assert.deepEqual(ignoring.blocked.map((item) => [item.path, item.kind]), [["keys/id.txt", "secret"]]);
  assert.deepEqual(ignoring.warn.map((item) => [item.path, item.label]), [["movie.bin", "60 MB"]]);
  assert.equal(ignoring.files[0].path, "keys/id.txt", "stopped files come first");
  assert.deepEqual([ignoring.oneDrive, ignoring.weakDrive, ignoring.renameBranch, ignoring.needsSignIn, ignoring.needsFirstCommit, ignoring.isRepo, ignoring.branch, ignoring.remote], [true, false, true, false, true, true, "master", null]);
  const bare = await actions.publishPreview(cwd, { owner: "octo-cat", name: "app", gitignore: false });
  assert.ok(bare.blocked.some((item) => item.path === ".env" && item.kind === "secret"), "with no .gitignore the .env is a finding");
  assert.ok(!bare.files.some((file) => file.path.startsWith("node_modules/")), "generated folders are never listed");
  const taken = await actions.publishPreview(cwd, { owner: "octo-cat", name: "taken" });
  assert.deepEqual([taken.taken, taken.suggestions], [true, ["taken-2", "taken-3", "taken-app"]]);
  const invalid = await actions.publishPreview(cwd, { owner: "octo-cat", name: "not valid" });
  assert.deepEqual([invalid.valid, invalid.taken, invalid.sanitized, invalid.nameIssue], [false, false, "not-valid", "Use letters, numbers, dots, dashes and underscores."]);
  assert.ok(!calls.some((call) => call.args.includes("add") || call.args.includes("commit") || call.args.includes("init")), "a preview changes nothing");
  assert.ok(!existsSync(path.join(cwd, ".gitignore")));

  const signedOut = await harness(t, box, { gh: ghFake({ account: null }) }).actions.publishPreview(box.dir("plain"), { owner: "octo-cat", name: "plain" });
  assert.deepEqual([signedOut.needsSignIn, signedOut.isRepo, signedOut.needsFirstCommit, signedOut.renameBranch, signedOut.account], [true, false, true, false, null]);
});

test("a folder with no git yet is walked with the starting .gitignore's rules, and a repository with history is read from git", async (t) => {
  const box = sandbox(t);
  const { actions } = harness(t, box);
  const plain = box.dir("plain");
  put(plain, "README.md");
  put(plain, "pkg/index.js");
  put(plain, "pkg/node_modules/dep/index.js");
  put(plain, "dist/out.js");
  put(plain, ".env", "X=1\n");
  put(plain, ".env.example", "X=\n");
  put(plain, "notes.log");
  put(plain, ".vscode/settings.json", "{}\n");
  const walked = await actions.publishPreview(plain, { owner: "octo-cat", name: "plain" });
  assert.deepEqual(walked.files.map((file) => file.path).sort(), [".env.example", "README.md", "pkg/index.js"]);
  assert.equal(walked.needsFirstCommit, true);
  const kept = box.dir("kept");
  put(kept, "README.md");
  put(kept, ".gitignore", "*.tmp\n");
  put(kept, "a.tmp");
  put(kept, "b.txt");
  assert.deepEqual((await actions.publishPreview(kept, { owner: "octo-cat", name: "kept" })).files.map((file) => file.path).sort(), [".gitignore", "README.md", "b.txt"], "an existing .gitignore is the one that counts");

  const history = repoWith(box, "history", { "README.md": "# h\n", "src/big.txt": "x".repeat(2048), ".env": "SECRET=1\n" }, { branch: "master" });
  const past = await actions.publishPreview(history, { owner: "octo-cat", name: "history" });
  assert.equal(past.needsFirstCommit, false);
  assert.equal(past.renameBranch, true);
  assert.equal(past.files.find((file) => file.path === "src/big.txt").bytes, 2048, "sizes come from the tree, not the disk");
  assert.deepEqual(past.blocked.map((item) => item.path), [".env"], "a committed secret file is still named");
  box.git(history, "remote", "add", "origin", "https://github.com/someone/else.git");
  const linked = await actions.publishPreview(history, { owner: "octo-cat", name: "history" });
  assert.deepEqual([linked.publishIssue.kind, linked.remote], ["has-remote", "someone/else"]);
  const same = await actions.publishPreview(history, { owner: "someone", name: "else" });
  assert.equal(same.publishIssue, null, "an origin that already points at the target is a retry");
});

// ---- the readers on their own ------------------------------------------------------------------
test("the status, diff and ignore readers hold their edge cases", () => {
  const { parseHeaders, parseStatusZ, addedLines, unquote, ignoreMatcher, pathspec, scanText } = parts;
  const zero = "0".repeat(40);
  const z = [
    "# branch.oid (initial)", "# branch.head main",
    `1 .M N... 100644 100644 100644 ${zero} ${zero} a file with spaces.txt`,
    `2 R. N... 100644 100644 100644 ${zero} ${zero} R100 new name.txt`, "old name.txt",
    `u UU N... 100644 100644 100644 100644 ${zero} ${zero} ${zero} clash.txt`,
    "? untracked dir/", "! ignored.txt", "",
  ].join("\0");
  assert.deepEqual(parseStatusZ(z), {
    head: { oid: "(initial)", branch: "main", upstream: null },
    entries: [
      { kind: "1", xy: ".M", path: "a file with spaces.txt" },
      { kind: "2", xy: "R.", path: "new name.txt", from: "old name.txt" },
      { kind: "u", xy: "UU", path: "clash.txt" },
      { kind: "?", xy: "??", path: "untracked dir/" },
    ],
  });
  assert.deepEqual(parseHeaders("# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -3\n1 .M x\n? y\n"), { oid: "abc", branch: "main", upstream: "origin/main", ab: { ahead: 2, behind: 3 }, entries: 2 });
  assert.equal(parseHeaders("# branch.oid abc\n# branch.head main\n# branch.upstream origin/gone\n").ab, null, "a gone upstream has no counts");

  // A line that starts with two pluses is a line, not a file header; a quoted name is unquoted; a deleted file adds nothing.
  const diff = [
    "diff --git a/x.txt b/x.txt", "--- a/x.txt", "+++ b/x.txt", "@@ -2 +2,2 @@", "-old", "+++ starts like a header", "+new",
    'diff --git "a/we\\"ird\\tname.txt" "b/we\\"ird\\tname.txt"', '--- "a/we\\"ird\\tname.txt"', '+++ "b/we\\"ird\\tname.txt"', "@@ -0,0 +1 @@", "+secret line",
    "diff --git a/sp ace.txt b/sp ace.txt", "--- a/sp ace.txt", "+++ b/sp ace.txt\t", "@@ -1 +1 @@", "-a", "+b", "\\ No newline at end of file",
    "diff --git a/gone.txt b/gone.txt", "--- a/gone.txt", "+++ /dev/null", "@@ -1 +0,0 @@", "-bye",
  ].join("\n");
  const added = addedLines(diff);
  assert.deepEqual([...added.keys()], ["x.txt", 'we"ird\tname.txt', "sp ace.txt"]);
  assert.equal(added.get("x.txt"), "++ starts like a header\nnew");
  assert.equal(added.get('we"ird\tname.txt'), "secret line");
  assert.equal(added.get("sp ace.txt"), "b");
  assert.equal(unquote('"caf\\303\\251 \\"q\\" \\\\ x"'), 'café "q" \\ x');

  const ignored = ignoreMatcher(["# comment", "", "node_modules/", "*.log", ".env", ".env.*", "!.env.example", "/build", "docs/*.tmp", "secrets/"].join("\n"));
  const cases = [
    ["node_modules", true, true], ["node_modules", false, false], ["a/node_modules", true, true], ["debug.log", false, true], ["logs/debug.log", false, true],
    [".env", false, true], [".env.local", false, true], [".env.example", false, false], ["build", true, true], ["src/build", true, false],
    ["docs/a.tmp", false, true], ["docs/deep/a.tmp", false, false], ["secrets", true, true], ["README.md", false, false],
  ];
  for (const [file, isDir, expected] of cases) assert.equal(ignored(file, isDir), expected, `${file}${isDir ? "/" : ""}`);

  assert.deepEqual(pathspec(["a", "b"]), { args: ["--", "a", "b"], input: null });
  const long = pathspec(Array.from({ length: 400 }, (_, index) => `some/long/directory/name/file-${index}.txt`));
  assert.deepEqual(long.args, ["--pathspec-from-file=-", "--pathspec-file-nul"]);
  assert.equal(long.input.split("\0").length, 401);

  assert.equal(scanText(`plain text\n${KEY_LINE}\n`).stop.id, "private-key");
  assert.equal(scanText(`x = "${TOKEN}"`).stop.id, "api-key");
  assert.equal(scanText("clone https://user:hunter2@example.com/x.git").stop.id, "url-credential");
  assert.equal(scanText('password = "hunter2hunter2"').maybe.id, "assigned-secret");
  assert.equal(scanText('password = "hunter2hunter2"').stop, null, "an assigned-looking value only warns");
  assert.deepEqual(scanText("nothing here, just words and a ghp_ short"), { stop: null, maybe: null });
});

// ---- everything at once ---------------------------------------------------------------------
test("children get prompts off, Studio's own keys withheld and no shell; reads take no lock", async (t) => {
  const box = sandbox(t);
  box.env.MEFI_STUDIO_OPENROUTER_KEY = "sk-studio-secret";
  box.env.MEFI_STUDIO_DISCORD_TOKEN = "discord-secret";
  box.env.GH_TOKEN = "kept-because-gh-reads-it";
  const { actions, calls } = harness(t, box);
  const cwd = repoWith(box, "app");
  put(cwd, "README.md", "# app\nedited\n");
  await actions.glance(cwd);
  await actions.account();
  await actions.save(cwd, { paths: ["README.md"] });
  assert.ok(calls.length > 5);
  for (const call of calls) {
    assert.equal(call.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(call.env.GH_PROMPT_DISABLED, "1");
    assert.equal(call.env.GCM_INTERACTIVE, "never");
    assert.equal(call.env.MEFI_STUDIO_OPENROUTER_KEY, undefined);
    assert.equal(call.env.MEFI_STUDIO_DISCORD_TOKEN, undefined);
    assert.equal(call.env.GH_TOKEN, "kept-because-gh-reads-it", "names other tools read are kept, as platform.cjs does");
    assert.ok(call.env.PATH);
  }
  assert.ok(calls.filter((call) => call.args.includes("commit")).every((call) => call.env.GIT_OPTIONAL_LOCKS === undefined), "a write is an ordinary git");
  assert.ok(calls.filter((call) => call.command === "git" && call.args[0] === "status").every((call) => call.env.GIT_OPTIONAL_LOCKS === "0"));
  assert.doesNotMatch(JSON.stringify(calls.map((call) => call.args)), /sk-studio|discord-secret/);
});

test("a GIT_DIR or index left in the environment never points git at another repository", async (t) => {
  const box = sandbox(t);
  const other = repoWith(box, "other", { "x.txt": "x\n" }, { branch: "elsewhere" });
  const mine = repoWith(box, "mine");
  put(mine, "README.md", "# app\nedited\n");
  const clear = { ...box.env };
  box.env.GIT_DIR = path.join(other, ".git");
  box.env.GIT_INDEX_FILE = path.join(other, ".git", "index");
  box.env.GIT_WORK_TREE = other;
  const { actions, calls } = harness(t, box);
  assert.deepEqual([(await actions.glance(mine)).branch, (await actions.glance(mine)).dirty], ["main", 1]);
  const saved = await actions.save(mine, { paths: ["README.md"], message: "in mine" });
  assert.equal(saved.ok, true, saved.error);
  const log = (cwd) => execFileSync("git", ["log", "-1", "--format=%s"], { cwd, env: clear, encoding: "utf8" }).trim();
  assert.equal(log(mine), "in mine");
  assert.equal(log(other), "seed", "the other repository was not touched");
  assert.ok(calls.every((call) => ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"].every((name) => call.env[name] === undefined)));
});

// ---- the independent review's findings ------------------------------------------------------
// A junction on Windows (no rights needed), a plain symlink to a folder elsewhere.
const junction = (target, at) => symlinkSync(target, at, "junction");
const rowsUnder = (view, name) => view.files.filter((file) => file.path === name || file.path.startsWith(`${name}/`));

test("a link that leads out of the project never puts the other folder's files in a save", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box);
  const cwd = repoWith(box, "app");
  const outside = box.dir("outside");
  put(outside, "o.txt", "not this project's\n");
  put(outside, "deep/p.txt", "nor this\n");
  junction(outside, path.join(cwd, "junc"));
  put(cwd, "real/inside.txt");
  junction(path.join(cwd, "real"), path.join(cwd, "inner"));
  put(cwd, "mine.txt");
  const head = box.git(cwd, "rev-parse", "HEAD");
  const view = await actions.preview(cwd);
  assert.equal(view.ok, true, view.error);
  const leaving = rowsUnder(view, "junc");
  assert.ok(leaving.length >= 1, "git lists the link or the files behind it");
  for (const row of leaving) assert.deepEqual([row.include, row.blocked.kind], [false, "outside"], row.path);
  for (const row of [...rowsUnder(view, "inner"), ...rowsUnder(view, "real"), ...rowsUnder(view, "mine.txt")]) assert.equal(row.include, true, `${row.path} stays in the project`);
  const refused = await actions.save(cwd, { paths: leaving.map((row) => row.path) });
  assert.deepEqual([refused.ok, refused.kind], [false, "blocked"]);
  assert.equal(box.git(cwd, "rev-parse", "HEAD"), head, "nothing was committed");
  assert.ok(!status(box, cwd).some((line) => /^(?:A|.A)/.test(line)), "and nothing is left half-added");
  const saved = await actions.save(cwd, { paths: ["mine.txt"], message: "mine" });
  assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(changed(box, cwd), ["A\tmine.txt"]);
  assert.doesNotMatch(box.git(cwd, "ls-tree", "-r", "--name-only", "HEAD"), /o\.txt|p\.txt/);
  assertGentle(calls);
});

test("a symlink to a file outside the project is stopped; one inside it is not", async (t) => {
  const box = sandbox(t);
  const cwd = repoWith(box, "app");
  const outside = box.dir("outside");
  put(outside, "o.txt", "elsewhere\n");
  put(cwd, "inside.txt");
  put(cwd, "leak.txt", "stands in for a link to o.txt\n");
  put(cwd, "same.txt", "stands in for a link to inside.txt\n");
  // File symlinks need rights this account may not have: the two files answer as links, where they lead is told.
  const leads = { "leak.txt": path.join(outside, "o.txt"), "same.txt": path.join(cwd, "inside.txt") };
  const native = (file) => new Promise((resolve, reject) => fsRealpath.native(file, (error, found) => (error ? reject(error) : resolve(found))));
  const { actions } = harness(t, box, {
    lstat: async (file) => (leads[path.basename(file)] ? { isSymbolicLink: () => true } : lstat(file)),
    realpath: async (file) => (leads[path.basename(file)] ? native(leads[path.basename(file)]) : native(file)),
  });
  const view = await actions.preview(cwd);
  const row = (name) => view.files.find((file) => file.path === name);
  assert.deepEqual([row("leak.txt").include, row("leak.txt").blocked.kind], [false, "outside"]);
  assert.equal(row("same.txt").include, true, "a link that stays inside the project is the project's own");
  assert.equal(row("inside.txt").include, true);
  const refused = await actions.save(cwd, { paths: ["leak.txt", "inside.txt"] });
  assert.deepEqual([refused.ok, refused.kind], [false, "blocked"]);
  assert.equal((await actions.save(cwd, { paths: ["same.txt", "inside.txt"], message: "links" })).ok, true);
});

test("a diff.mnemonicPrefix or diff.noprefix setting does not blind the key scan of a changed file", async (t) => {
  const box = sandbox(t);
  const { actions } = harness(t, box);
  const cwd = repoWith(box, "app", { "README.md": "# app\n", "b/inner.txt": "b\n", "src/app.js": "x\n" });
  for (const setting of ["diff.mnemonicPrefix", "diff.noprefix"]) {
    box.git(cwd, "config", setting, "true");
    put(cwd, "src/app.js", `x\n// ${KEY_LINE}\n`);
    put(cwd, "b/inner.txt", `b\n${KEY_LINE}\n`);
    const view = await actions.preview(cwd);
    const row = (name) => view.files.find((file) => file.path === name);
    assert.equal(row("src/app.js").blocked?.rule, "private-key", `${setting}: a file under src/`);
    assert.equal(row("b/inner.txt").blocked?.rule, "private-key", `${setting}: a file under b/`);
    box.git(cwd, "config", "--unset", setting);
    put(cwd, "src/app.js", "x\n");
    put(cwd, "b/inner.txt", "b\n");
  }
});

test("keys are found in UTF-16 files and in big changed files; a big file that was not read says so", async (t) => {
  const box = sandbox(t);
  const { actions } = harness(t, box);
  const big = "lorem ipsum dolor sit amet\n".repeat(60000);
  assert.ok(big.length > MIB);
  const cwd = repoWith(box, "app", { "README.md": "# app\n", "big.log": big, "notes.txt": "plain\n" });
  // What PowerShell's > writes: UTF-16 with a byte order mark, a NUL between the letters.
  const utf16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  writeFileSync(path.join(cwd, "new16.txt"), utf16(`token\n${KEY_LINE}\n`));
  writeFileSync(path.join(cwd, "notes.txt"), utf16(`now with a key\n${KEY_LINE}\n`));
  put(cwd, "big.log", `${big}${KEY_LINE}\n`);
  put(cwd, "dump.json", big);
  writeFileSync(path.join(cwd, "photo.png"), Buffer.alloc(2 * MIB, 7));
  writeFileSync(path.join(cwd, "small.bin"), Buffer.from([0, 1, 2, 0, 0, 3, 4, 5, 6, 0, 255, 254, 7, 8, 9, 10]));
  const view = await actions.preview(cwd);
  const row = (name) => view.files.find((file) => file.path === name);
  assert.equal(row("new16.txt").blocked?.rule, "private-key", "a new UTF-16 file");
  assert.equal(row("notes.txt").blocked?.rule, "private-key", "a tracked file rewritten as UTF-16 (git calls it binary and shows no lines)");
  assert.equal(row("big.log").blocked?.rule, "private-key", "a changed file over 1 MiB is read from its diff");
  assert.deepEqual([row("dump.json").include, row("dump.json").warn?.kind], [true, "unscanned"], "a big text file that could not be read for keys says so");
  assert.equal(row("photo.png").warn, undefined, "a picture needs no such warning");
  assert.equal(row("small.bin").blocked, undefined);
  assert.equal(row("small.bin").warn, undefined);
});

test("a long dotted line cannot stall the key scan, and a login in a link after it is still found", () => {
  const dotted = "a.".repeat(200000);
  const started = Date.now();
  assert.equal(parts.scanText(dotted).stop, null);
  assert.ok(Date.now() - started < 3000, `scanning 400 KB took ${Date.now() - started} ms`);
  assert.equal(parts.scanText(`${dotted}https://user:pw123456@example.com/x`).stop?.id, "url-credential");
  assert.equal(parts.scanText("see http://user:secret1@host/path").stop?.id, "url-credential");
  assert.equal(parts.scanText("see https://example.com/path and mail@example.com").stop, null);
});

test("sign-in and key files are stopped by name, whatever the case of the folder around them (git-link's list, end to end)", async (t) => {
  const box = sandbox(t);
  const { actions } = harness(t, box);
  const cwd = repoWith(box, "app");
  for (const name of [".netrc", "deploy.p12", "certs/site.pfx", ".git-credentials", ".pgpass"]) put(cwd, name, "x\n");
  put(cwd, "ok.txt");
  const view = await actions.preview(cwd);
  for (const name of [".netrc", "deploy.p12", "certs/site.pfx", ".git-credentials", ".pgpass"]) {
    const row = view.files.find((file) => file.path === name);
    assert.deepEqual([name, row?.include, row?.blocked?.kind], [name, false, "secret"]);
  }
  assert.equal(view.files.find((file) => file.path === "ok.txt").include, true);
  if (process.platform === "win32") {
    put(cwd, "Node_Modules/pkg/index.js");
    put(cwd, "DIST/out.js");
    const cased = await actions.preview(cwd);
    assert.deepEqual(cased.files.filter((file) => /^(?:Node_Modules|DIST)\//.test(file.path)).map((file) => file.blocked?.kind), ["generated", "generated"], "on a drive that does not tell the cases apart, generated folders are still generated");
    assert.equal(cased.files.some((file) => file.path === "Node_Modules/pkg/index.js"), false, "and are one row, not a hundred thousand");
  }
});

test("values that look like options are words, never flags", async (t) => {
  const box = sandbox(t);
  const { actions, calls, events } = harness(t, box);
  for (const owner of ["-h", "-x", "--repo"]) {
    const check = await actions.nameCheck(owner, "app");
    assert.deepEqual([owner, check.valid, typeof check.issue], [owner, false, "string"]);
  }
  assert.ok(!calls.some((call) => call.command === "gh"), "no account name that starts with a dash reaches gh");
  const cwd = box.dir("app");
  put(cwd, "README.md");
  const refused = await actions.publish(cwd, { owner: "-x", name: "app" });
  assert.deepEqual([refused.ok, refused.kind, refused.steps], [false, "name", []]);
  const preview = await actions.publishPreview(cwd, { owner: "-x", name: "app" });
  assert.deepEqual([preview.valid, typeof preview.nameIssue], [false, "string"]);
  assert.ok(!events.some((event) => event[0] === "write") && !existsSync(path.join(cwd, ".git")), "nothing was written or started");
  const { work } = await pushFixture(t);
  for (const repo of ["-x/y", "octo-cat/..", "octo-cat/x.git", "octo-cat/a b", "octo-cat/x\ny"]) {
    const held = harness(t, box, { isListed: () => true });
    assert.equal((await held.actions.link(work, { repo })).kind, "not-listed", repo);
    assert.equal(held.calls.length, 0, `nothing ran for ${repo}`);
  }
  assertGentle(calls);
});

test("a branch named like a flag is not pushed, and a message or file name like a flag is text", async (t) => {
  const { box, work } = await pushFixture(t);
  const { actions, calls } = harness(t, box);
  // HEAD can be pointed at refs/heads/-f by hand: `git push -u origin -f` would be a forced push.
  box.git(work, "symbolic-ref", "HEAD", "refs/heads/-f");
  put(work, "f.txt");
  box.git(work, "add", "f.txt");
  box.git(work, "commit", "-q", "-m", "on a dash");
  const refused = await actions.pushBranch(work);
  assert.deepEqual([refused.ok, refused.kind], [false, "branch-name"]);
  assert.ok(!calls.some((call) => call.args[0] === "push"), "nothing was sent");

  const cwd = repoWith(box, "app");
  for (const name of ["-rf.txt", "--upload-pack=x.txt", "[x].txt", "x.txt"]) put(cwd, name);
  const saved = await actions.save(cwd, { paths: ["-rf.txt", "--upload-pack=x.txt", "[x].txt"], message: "a\u0000b" });
  assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(changed(box, cwd), ["A\t--upload-pack=x.txt", "A\t-rf.txt", "A\t[x].txt"].sort(), "exactly those names; the literal [x] did not pick up x.txt");
  assert.equal(box.git(cwd, "log", "-1", "--format=%s"), "ab");
  assert.deepEqual(status(box, cwd), ["?? x.txt"]);
  assertGentle(calls);
});

test("a login with an @ in its password leaves no tail of the password in any answer", async (t) => {
  const box = sandbox(t);
  const stderr = "error connecting to https://octo:p@a@s@s@w@o@r@d1@github.com/api/v3/user/orgs: connection refused";
  const base = ghFake();
  const { actions } = harness(t, box, { gh: (args, options) => (args[1] === "user/orgs" ? { fail: true, stderr } : base(args, options)) });
  const answer = await actions.owners();
  assert.equal(answer.ok, true);
  assert.ok(answer.orgsError, "the failure is reported");
  assert.doesNotMatch(JSON.stringify(answer), new RegExp("://[^/]*@"), "no address keeps any part of a login");
  assert.doesNotMatch(JSON.stringify(answer), /octo:|d1@/);
});

test("a very long line of command output is cleaned in linear time", async (t) => {
  const box = sandbox(t);
  const big = "a.".repeat(300000);
  const { actions } = harness(t, box, { gh: (args) => (args[1] === "view" ? { fail: true, stderr: `${big} https://u:p@a@ss@github.com/x` } : null) });
  const started = Date.now();
  const answer = await actions.nameCheck("octo-cat", "app");
  assert.ok(Date.now() - started < 3000, `cleaning 600 KB took ${Date.now() - started} ms`);
  assert.doesNotMatch(JSON.stringify(answer), new RegExp("://[^/]*@"));
});

test("publishing a folder with a link out of it leaves the other folder's files out of the first commit, and says so", async (t) => {
  const box = sandbox(t);
  const hub = box.bare("hub.git");
  box.route("octo-cat/app", hub);
  const outside = box.dir("outside");
  put(outside, "o.txt", "not this project's\n");
  const cwd = box.dir("app");
  put(cwd, "README.md");
  junction(outside, path.join(cwd, "junc"));
  const { gh } = publishFake(box);
  const { actions } = harness(t, box, { gh });
  const preview = await actions.publishPreview(cwd, { owner: "octo-cat", name: "app" });
  assert.equal(preview.ok, true, preview.error);
  assert.ok(!preview.files.some((file) => file.path === "junc/o.txt"), "the walk does not follow the link");
  const done = await actions.publish(cwd, { owner: "octo-cat", name: "app" });
  assert.equal(done.ok, true, done.error);
  assert.doesNotMatch(box.git(hub, "ls-tree", "-r", "--name-only", "main"), /o\.txt|junc/, "nothing from the other folder went up");
  assert.ok((done.left ?? []).every((item) => item.path === "junc" || item.path.startsWith("junc/")), "and what was left out is named");
});

test("a folder is one queue by any name, and a check that hangs or throws does not hold the next task", async (t) => {
  const { box, work } = await pushFixture(t);
  const alias = path.join(box.root, "alias");
  junction(work, alias);
  const { actions } = harness(t, box, { checkCapMs: 60 });
  let running = 0;
  let peak = 0;
  const check = async () => { running += 1; peak = Math.max(peak, running); await new Promise((resolve) => setTimeout(resolve, 40)); running -= 1; return { ok: true }; };
  const both = await Promise.all([actions.pushBranch(work, { check }), actions.pushBranch(alias, { check })]);
  assert.deepEqual(both.map((one) => one.ok), [true, true]);
  assert.equal(peak, 1, "the same folder through a junction waited for itself");

  const hung = actions.pushBranch(work, { check: () => new Promise(() => {}) });
  const thrown = actions.pushBranch(work, { check: () => { throw new Error("boom"); } });
  const after = actions.pushBranch(work, {});
  const [slow, bad, next] = await Promise.all([hung, thrown, after]);
  assert.deepEqual([slow.ok, slow.kind, slow.detail], [false, "check-failed", "the check took too long"]);
  assert.deepEqual([bad.ok, bad.kind, bad.detail], [false, "check-failed", "boom"]);
  assert.equal(next.ok, true, "the task behind them still ran");
});

test("a command that never answers is ended and the caller gets an answer", async (t) => {
  const box = sandbox(t);
  const cwd = repoWith(box, "app");
  const killed = [];
  const hang = () => ({ kill: (signal) => { killed.push(signal); return true; }, stdin: null });
  const actions = createGitActions({ execFile: hang, exists: existsSync, killGraceMs: 30, env: () => box.env });
  const started = Date.now();
  assert.equal(await actions.glance(cwd, { budgetMs: 1 }), null, "unknown is not a guess");
  assert.ok(Date.now() - started < 4000, "it did not wait for a command that will never end");
  assert.ok(killed.includes("SIGKILL"), "and the command was ended hard");
});

test("publishing refuses a whole drive or user folder, and never takes the name main from another branch", async (t) => {
  const box = sandbox(t);
  const cwd = box.dir("profile");
  put(cwd, "a.txt");
  const same = harness(t, box, { homes: () => [cwd] });
  const first = await same.actions.publish(cwd, { owner: "octo-cat", name: "app" });
  assert.deepEqual([first.ok, first.kind, first.steps], [false, "too-broad", []]);
  const above = harness(t, box, { homes: () => [path.join(cwd, "me")] });
  assert.equal((await above.actions.publish(cwd, { owner: "octo-cat", name: "app" })).kind, "too-broad", "a folder that holds the profile");
  assert.equal((await above.actions.publishPreview(cwd, { owner: "octo-cat", name: "app" })).publishIssue.kind, "too-broad");
  const drive = harness(t, box);
  assert.equal((await drive.actions.publish(path.parse(cwd).root, { owner: "octo-cat", name: "app" })).kind, "too-broad", "a drive root");
  assert.equal(drive.calls.length, 0, "no git ran there");
  assert.ok(!existsSync(path.join(cwd, ".git")) && !existsSync(path.join(cwd, ".gitignore")), "nothing was started or written");

  // master with commits, and a different branch already called main: -M would have taken main from it.
  const app = repoWith(box, "master-app", { "README.md": "# app\n" }, { branch: "master" });
  box.git(app, "branch", "main");
  put(app, "later.txt");
  box.git(app, "add", "later.txt");
  box.git(app, "commit", "-q", "-m", "later");
  const oldMain = box.git(app, "rev-parse", "main");
  const { gh, made } = publishFake(box);
  const held = harness(t, box, { gh });
  const refused = await held.actions.publish(app, { owner: "octo-cat", name: "master-app" });
  assert.deepEqual([refused.ok, refused.kind], [false, "branch-exists"]);
  assert.equal(box.git(app, "rev-parse", "main"), oldMain, "main is where it was");
  assert.equal(box.git(app, "symbolic-ref", "--short", "HEAD"), "master");
  assert.equal(made.length, 0);
  assert.ok(!held.calls.some((call) => call.args.includes("-M")));
});

test("publishing never writes over a file that turns up, or through a link left at its name", async (t) => {
  const box = sandbox(t);
  const hub = box.bare("hub.git");
  box.route("octo-cat/app", hub);
  const cwd = box.dir("app");
  put(cwd, "README.md");
  put(cwd, ".gitignore", "mine\n");
  // The look misses .gitignore (it turned up after), so the write is attempted: "wx" refuses it.
  const late = harness(t, box, { gh: publishFake(box).gh, writeText: undefined, exists: (file) => (path.basename(file) === ".gitignore" ? false : existsSync(file)), lstat: async () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } });
  const done = await late.actions.publish(cwd, { owner: "octo-cat", name: "app" });
  assert.equal(done.ok, true, done.error);
  assert.equal(readFileSync(path.join(cwd, ".gitignore"), "utf8"), "mine\n", "the owner's file is as it was");

  // A link at the name counts as a file there, even when it leads nowhere: writing would create its target.
  const other = box.dir("other");
  put(other, "README.md");
  const h2 = box.bare("hub2.git");
  box.route("octo-cat/other", h2);
  const linked = harness(t, box, {
    gh: publishFake(box).gh, exists: (file) => (path.basename(file) === ".gitignore" ? false : existsSync(file)),
    lstat: async (file) => (path.basename(file) === ".gitignore" ? { isSymbolicLink: () => true } : lstat(file)),
  });
  const second = await linked.actions.publish(other, { owner: "octo-cat", name: "other" });
  assert.equal(second.ok, true, second.error);
  assert.ok(!linked.events.some((event) => event[0] === "write" && event[1] === ".gitignore"), "no .gitignore was written");
  assert.ok(!existsSync(path.join(other, ".gitignore")));
});

test("an origin that turns up while a name is being claimed is not pushed to", async (t) => {
  const box = sandbox(t);
  const cwd = box.dir("app");
  put(cwd, "README.md");
  const taken = { fail: true, stderr: "GraphQL: Name already exists on this account (createRepository)" };
  const views = { "octo-cat/app": { nameWithOwner: "octo-cat/app", owner: { login: "octo-cat" }, isEmpty: true, isPrivate: true } };
  const { gh } = publishFake(box, { views, onCreate: () => { box.git(cwd, "remote", "add", "origin", "https://github.com/someone/else.git"); return taken; } });
  const { actions, calls } = harness(t, box, { gh });
  const answer = await actions.publish(cwd, { owner: "octo-cat", name: "app" });
  assert.deepEqual([answer.ok, answer.kind], [false, "has-remote"]);
  assert.equal(box.git(cwd, "config", "--get", "remote.origin.url"), "https://github.com/someone/else.git", "origin was not replaced");
  assert.ok(!calls.some((call) => call.args[0] === "push"), "and nothing was pushed to it");
});

test("linking a folder inside another project is refused, and an unrelated repository leaves no tags behind", async (t) => {
  const { box, hub, work } = await linkFixture(t, { seed: "unrelated" });
  const stranger = path.join(box.root, "stranger");
  box.git(stranger, "tag", "v9");
  box.git(stranger, "push", "-q", hub, "v9");
  const { actions, calls } = harness(t, box, { isListed: () => true });
  const refused = await actions.link(work, { repo: "octo-cat/app" });
  assert.equal(refused.kind, "unrelated");
  assert.equal(box.git(work, "tag", "--list"), "", "the other project's tag did not stay behind");
  assert.ok(calls.filter((call) => call.args[0] === "fetch").every((call) => call.args.includes("--no-tags")));

  const outer = repoWith(box, "outer");
  const inner = path.join(outer, "sub");
  put(inner, "x.txt");
  const nested = await actions.link(inner, { repo: "octo-cat/app" });
  assert.equal(nested.kind, "nested");
  assert.equal(box.git(outer, "remote").trim(), "", "the outer project was not given an address");
});

test("a save takes only what the preview lists when it is asked, however the paths are spelled", async (t) => {
  const box = sandbox(t);
  const { actions, calls } = harness(t, box);
  const cwd = repoWith(box, "app", { "README.md": "# app\n", "sub/keep.txt": "keep\n" });
  put(cwd, "README.md", "# app\nedited\n");
  put(cwd, "clean.txt", "fine\n");
  const head = box.git(cwd, "rev-parse", "HEAD");
  const shaped = [path.join(cwd, "README.md"), ":(top)README.md", ":/", ":!README.md", "*", "*.md", "sub", "sub/", ".", "README.md\n", "README.md\0", "./README.md", "sub/../README.md", "--", "-A", "--all"];
  for (const item of shaped) {
    const refused = await actions.save(cwd, { paths: [item] });
    assert.deepEqual([JSON.stringify(item), refused.ok, refused.kind], [JSON.stringify(item), false, "not-in-preview"]);
  }
  assert.equal(box.git(cwd, "rev-parse", "HEAD"), head, "nothing was committed");
  assert.ok(!calls.some((call) => call.args.includes("add") || call.args.includes("commit")), "and git was never asked to add or commit");

  // The preview is not trusted at save time: what changed since is judged again, and a key stops the file.
  const seen = await actions.preview(cwd);
  assert.equal(seen.files.find((file) => file.path === "clean.txt").include, true);
  put(cwd, "clean.txt", `fine\n${KEY_LINE}\n`);
  const late = await actions.save(cwd, { paths: ["clean.txt"] });
  assert.deepEqual([late.ok, late.kind], [false, "blocked"]);
  assert.equal(box.git(cwd, "rev-parse", "HEAD"), head);
  assert.ok(!status(box, cwd).some((line) => /^(?:A|.A)/.test(line)), "and nothing is left half-added");
});

test("keys of other kinds stop a save too: a payment key, a registry token, a bot token, a webhook, a cloud secret", () => {
  const seed = "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";
  const shapes = {
    payment: ["sk", "live", seed.slice(0, 24)].join("_"),
    registry: `${["npm"].join("")}_${seed}${seed.slice(0, 8)}`,
    bot: `${"MTAxMjM0NTY3ODkwMTIzNDU2"}.${"GAbCdE"}.${seed}${seed.slice(0, 4)}`,
    webhook: ["https://discord.com/api", "webhooks", "123456789012345678", seed + seed].join("/"),
    cloud: `aws_secret_access_key = "${seed}${seed.slice(0, 10)}"`,
  };
  for (const [kind, text] of Object.entries(shapes)) assert.ok(parts.scanText(`const x = '${text}';`).stop, `${kind} is stopped`);
  for (const text of ["const sk = 'live';", "npm install left-pad", "Mozilla.Firefox.Nightly", "https://discord.com/channels/1/2", "aws_region = us-east-1"]) assert.equal(parts.scanText(text).stop, null, text);
});

test("a listener that throws does not stop a publish half-way", async (t) => {
  const box = sandbox(t);
  const hub = box.bare("hub.git");
  box.route("octo-cat/app", hub);
  const { gh } = publishFake(box);
  const { actions } = harness(t, box, { gh });
  const cwd = box.dir("app");
  put(cwd, "README.md");
  const done = await actions.publish(cwd, { owner: "octo-cat", name: "app", onProgress: () => { throw new Error("the dialog closed"); } });
  assert.equal(done.ok, true, done.error);
  assert.equal(box.git(hub, "rev-parse", "main"), box.git(cwd, "rev-parse", "HEAD"));
});

test("nothing here forces, skips a hook, adds everything, uses a shell or changes the account", async () => {
  const source = readFileSync(new URL("../scripts/git-actions.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((line) => line.replace(/(^|\s)\/\/.*$/, "")).join("\n");
  assert.doesNotMatch(code, /--force|--no-verify|--amend|--hard|shell\s*:|(?<![.\w])exec\(|execSync|spawnSync|\bspawn\(|["']-A["']|["']--all["']|["']auth["']\s*,\s*["'](?:login|refresh|setup-git)["']/, "the code never forces, skips a hook, adds everything, opens a shell or signs in");
  assert.match(code, /GIT_TERMINAL_PROMPT/);
  assert.match(code, /withholdCredentials/);
  assert.doesNotMatch(code, /require\("node:(?:https?|net|dns|tls)"\)|\bfetch\(/, "no network of its own");
});
