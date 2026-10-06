// The host half of attempt snapshots (scripts/attempt-snapshots-host.cjs) over
// real throwaway git repositories: a picture of the folder at the start and the
// end of an attempt that touches nothing of the person's (index, HEAD, files),
// the change list (renamed, deleted, binary and ignored files), one file's diff,
// Revert file and Revert attempt with every refusal, the safety copy, the undo,
// the pruning, a run in a worktree, the kill switch, and that no ref is pushed.
//
// Run: node --test tests/attempt_snapshots_host.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import path from "node:path";
import { sync } from "../scripts/sync.mjs";

const require = createRequire(import.meta.url);
const { createAttemptSnapshots } = require("../scripts/attempt-snapshots-host.cjs");
const rules = require("../scripts/attempt-snapshots.cjs");

const PLAIN = process.platform !== "win32";
// Let background ref pruning and Git close handlers drain during Windows retries.
const cleanup = (t, dir) => t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));

// A git of the person's own: no global or system config leaks into a fixture.
function isolated(base) {
  const home = path.join(base, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, ".gitconfig"), "");
  return { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
}
const git = (env, cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

// A project folder that is a git repository with a first commit, and a host wired to it.
function project(t, files = { "a.txt": "one\n", "b.txt": "two\n", "sub/c.txt": "three\n", ".gitignore": "ignored.log\nnode_modules/\n" }, options = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "mefi-snap-host-"));
  cleanup(t, base);
  const env = isolated(base);
  const root = path.join(base, "project");
  mkdirSync(root);
  git(env, root, "init", "-q", "-b", "main", ".");
  for (const [key, value] of [["user.name", "Person"], ["user.email", "person@example.invalid"], ["commit.gpgsign", "false"], ...(options.config ?? [])]) git(env, root, "config", key, value);
  for (const [name, body] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), body); }
  if (options.commit !== false) { git(env, root, "add", "-A"); git(env, root, "commit", "-q", "-m", "First"); }
  const logs = [];
  const snaps = createAttemptSnapshots({ env: () => env, log: (line) => logs.push(line), ...(options.host ?? {}) });
  const at = (name) => path.join(root, name);
  const write = (name, body) => { mkdirSync(path.dirname(at(name)), { recursive: true }); writeFileSync(at(name), body); };
  const read = (name) => readFileSync(at(name), "utf8");
  const g = (...args) => git(env, root, ...args);
  const refs = () => g("for-each-ref", "--format=%(refname)", "refs/mefi").split("\n").filter(Boolean).sort();
  const tree = () => Object.fromEntries(walk(root).map((name) => [name, sha(at(name))]));
  return { base, env, root, snaps, logs, at, write, read, g, refs, tree };
}
function walk(root, prefix = "") {
  const out = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(root, rel)); else out.push(rel);
  }
  return out.sort();
}
const TASK = "task_0123456789abcdef";
// Windows cannot name a file with a double quote, so the odd names there use a single quote (git quotes both).
const QUOTED_NAME = process.platform === "win32" ? "weird 'quoted' name.txt" : 'weird "quoted" name.txt';
const LEAD_QUOTE = process.platform === "win32" ? "'lead quote.txt" : '"lead quote.txt';
async function ran(h, work, { taskId = TASK, runId = "run_1_1", ...more } = {}) {
  const start = await h.snaps.begin({ root: h.root, taskId, runId, ...more });
  assert.equal(start.ok, true, start.error);
  await work(h);
  const stop = await h.snaps.end({ root: h.root, taskId, n: start.n, runId, ...more });
  assert.equal(stop.ok, true, stop.error);
  return { start, stop };
}
const byPath = (list) => Object.fromEntries(list.files.map((file) => [file.path, file]));

test("an attempt is two private refs under refs/mefi/attempts/<task>/<n>, and the next attempt takes the next number", async (t) => {
  const h = project(t);
  const first = await ran(h, (x) => x.write("a.txt", "one\nchanged\n"));
  assert.equal(first.start.n, 1);
  assert.deepEqual(h.refs(), [`refs/mefi/attempts/${TASK}/1/after`, `refs/mefi/attempts/${TASK}/1/before`]);
  const second = await ran(h, (x) => x.write("b.txt", "two\nmore\n"), { runId: "run_2_1" });
  assert.equal(second.start.n, 2);
  const third = await h.snaps.begin({ root: h.root, taskId: TASK, runId: "run_3_1", numbers: [7] });
  assert.equal(third.n, 8, "an evidence folder that already holds attempt 7 pushes the number on");
  const odd = await h.snaps.begin({ root: h.root, taskId: "task/x y", runId: "run_4_1" });
  assert.equal(odd.ok, true);
  assert.ok(h.refs().includes("refs/mefi/attempts/task%2fx%20y/1/before"), "an id with odd characters is written safely");
  const message = h.g("cat-file", "commit", `refs/mefi/attempts/${TASK}/1/after`);
  assert.match(message, /^parent [0-9a-f]{40}$/m, "the end picture hangs on the start picture");
  assert.match(message, /^author Mefi's Studio <studio@invalid\.local> /m, "Studio's own name, never the person's");
  assert.match(message, /^Mefi attempt 1 after: run_1_1$/m);
  assert.equal(h.g("rev-parse", `refs/mefi/attempts/${TASK}/1/before^`).trim(), h.g("rev-parse", "HEAD").trim(), "the start picture hangs on HEAD");
});

test("a snapshot never touches the person's index, HEAD, branch or files, staged work included", async (t) => {
  const h = project(t);
  h.write("staged.txt", "staged only\n"); h.g("add", "staged.txt");
  h.write("a.txt", "one\nstaged edit\n"); h.g("add", "a.txt");
  h.write("a.txt", "one\nstaged edit\nunstaged edit\n");
  h.write("loose.txt", "never added\n");
  const state = () => ({ status: h.g("status", "--porcelain=v2", "--branch"), cached: h.g("diff", "--cached"), head: h.g("rev-parse", "HEAD"), branch: h.g("branch", "--show-current"), index: sha(h.at(".git/index")), files: h.tree(), stash: h.g("stash", "list"), locks: existsSync(h.at(".git/index.lock")) });
  const before = state();
  await ran(h, (x) => { x.write("loose.txt", "edited by the run\n"); });
  await h.snaps.changes({ root: h.root, taskId: TASK });
  await h.snaps.diff({ root: h.root, taskId: TASK, path: "loose.txt" });
  const after = state();
  after.files["loose.txt"] = before.files["loose.txt"]; // the run's own edit is the only file that moved
  assert.deepEqual(after, before, "index bytes, staged diff, status, HEAD, branch, stash and every file are as they were");
  assert.equal(h.g("show", `refs/mefi/attempts/${TASK}/1/before:a.txt`), "one\nstaged edit\nunstaged edit\n", "the picture holds the folder's files, not the staged copy");
  assert.equal(h.g("show", `refs/mefi/attempts/${TASK}/1/before:staged.txt`), "staged only\n");
  assert.equal(h.g("show", `refs/mefi/attempts/${TASK}/1/before:loose.txt`), "never added\n", "a file git does not track yet is in the picture");
  assert.equal(existsSync(h.at(".git/index.lock")), false);
});

test("git ignores what .gitignore and the local exclude file name, and a tracked file stays in whatever it matches", async (t) => {
  const h = project(t, { "keep.txt": "k\n", ".gitignore": "ignored.log\nnode_modules/\n*.tmp\n", "tracked.tmp": "tracked though it matches\n" });
  h.g("add", "-f", "tracked.tmp"); h.g("commit", "-q", "-m", "a tracked file the ignore rules also match");
  writeFileSync(h.at(".git/info/exclude"), "local-only.txt\n");
  await ran(h, (x) => {
    x.write("ignored.log", "x\n"); x.write("node_modules/dep/index.js", "x\n"); x.write("scratch.tmp", "x\n"); x.write("local-only.txt", "x\n");
    x.write("tracked.tmp", "edited\n"); x.write("real.js", "x\n");
  });
  const list = await h.snaps.changes({ root: h.root, taskId: TASK });
  assert.deepEqual(list.files.map((file) => file.path), ["real.js", "tracked.tmp"], "only what git would see");
  assert.equal(h.g("ls-tree", "-r", "--name-only", `refs/mefi/attempts/${TASK}/1/after`).split("\n").some((name) => /ignored\.log|node_modules|scratch|local-only/.test(name)), false);
});

test("a huge ignored file is nobody's business: it is not a left-out file, and it does not count against the caps", async (t) => {
  const h = project(t);
  const started = await h.snaps.begin({ root: h.root, taskId: TASK, runId: "run_1_1" });
  writeFileSync(h.at("ignored.log"), Buffer.alloc(rules.LIMITS.textBytes + 10, 97));
  mkdirSync(h.at("node_modules/dep"), { recursive: true });
  writeFileSync(h.at("node_modules/dep/big.bin"), Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.alloc(rules.LIMITS.binaryBytes + 10, 7)]));
  h.write("a.txt", "one\nedited\n");
  const stopped = await h.snaps.end({ root: h.root, taskId: TASK, n: started.n, runId: "run_1_1" });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.skippedCount, 0, "git would not have added them, so Studio does not name them");
  const list = await h.snaps.changes({ root: h.root, taskId: TASK });
  assert.deepEqual([list.files.map((file) => file.path), list.skipped.count], [["a.txt"], 0]);
});

test("files over the caps are left out and named, and never listed or reverted", async (t) => {
  const h = project(t);
  const started = await h.snaps.begin({ root: h.root, taskId: TASK, runId: "run_1_1" });
  h.write("small.js", "ok\n");
  writeFileSync(h.at("huge.json"), Buffer.alloc(rules.LIMITS.textBytes + 10, 97));
  writeFileSync(h.at("photo.bin"), Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.alloc(rules.LIMITS.binaryBytes + 10, 7)]));
  h.write("a.txt", "one\nedited\n");
  const stopped = await h.snaps.end({ root: h.root, taskId: TASK, n: started.n, runId: "run_1_1" });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.skippedCount, 2);
  assert.deepEqual(stopped.skipped.map((row) => [row.path, row.reason]).sort(), [["huge.json", "too-large"], ["photo.bin", "binary-too-large"]]);
  const list = await h.snaps.changes({ root: h.root, taskId: TASK });
  assert.deepEqual(list.files.map((file) => file.path), ["a.txt", "small.js"], "the left-out files are not in the list");
  assert.equal(list.skipped.count, 2);
  assert.match(list.skipped.sentence, /^2 files were left out of the snapshot \(huge\.json, photo\.bin\)/);
  const reverted = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.equal(reverted.ok, true, reverted.error);
  assert.equal(existsSync(h.at("huge.json")), true, "a file Studio kept no copy of is not touched");
  assert.equal(existsSync(h.at("photo.bin")), true);
  assert.equal(existsSync(h.at("small.js")), false);
});

test("a folder that is not a git repository, is inside another one, has no git or is switched off has no snapshots and says why", async (t) => {
  const base = mkdtempSync(path.join(tmpdir(), "mefi-snap-none-"));
  cleanup(t, base);
  const env = isolated(base);
  const plain = path.join(base, "plain");
  mkdirSync(plain);
  writeFileSync(path.join(plain, "a.txt"), "x\n");
  const snaps = createAttemptSnapshots({ env: () => env });
  const answer = await snaps.begin({ root: plain, taskId: TASK, runId: "run_1_1" });
  assert.deepEqual([answer.ok, answer.reason], [false, "not-a-repo"]);
  assert.match(answer.error, /not a Git repository/);
  assert.deepEqual(readdirSync(plain), ["a.txt"], "nothing was created in the folder");
  const changes = await snaps.changes({ root: plain, taskId: TASK });
  assert.deepEqual([changes.ok, changes.available, changes.reason], [true, false, "not-a-repo"]);
  assert.deepEqual((await snaps.revert({ root: plain, taskId: TASK, scope: "attempt" })).reason, "not-a-repo");
  // A folder inside another project's repository.
  const h = project(t);
  mkdirSync(h.at("packages/web"), { recursive: true });
  const nested = await h.snaps.begin({ root: h.at("packages/web"), taskId: TASK, runId: "run_1_1" });
  assert.deepEqual([nested.ok, nested.reason], [false, "nested"]);
  assert.match(nested.error, /inside another Git project/);
  assert.deepEqual(h.refs(), []);
  // No git on the machine.
  const noGit = createAttemptSnapshots({ execFile: (_command, _args, _options, done) => { done(Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }), "", ""); return {}; } });
  assert.equal((await noGit.begin({ root: h.root, taskId: TASK, runId: "run_1_1" })).reason, "git-missing");
  assert.match((await noGit.changes({ root: h.root, taskId: TASK })).note, /Git is not installed/);
  // The kill switch, as a setting and as the environment variable.
  const off = createAttemptSnapshots({ env: () => h.env, disabled: () => true });
  assert.deepEqual(await off.begin({ root: h.root, taskId: TASK, runId: "run_1_1" }), { ok: false, reason: "off", error: rules.unavailable("off") });
  assert.equal((await off.end({ root: h.root, taskId: TASK, n: 1, runId: "run_1_1" })).reason, "off");
  assert.deepEqual([(await off.changes({ root: h.root, taskId: TASK })).available, (await off.revert({ root: h.root, taskId: TASK, scope: "attempt" })).reason], [false, "off"]);
  assert.deepEqual(h.refs(), [], "a switched-off host makes no ref");
  const previous = process.env.MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS;
  process.env.MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS = "1";
  try {
    const viaEnv = createAttemptSnapshots({ env: () => h.env });
    assert.equal((await viaEnv.begin({ root: h.root, taskId: TASK, runId: "run_1_1" })).reason, "off", "MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS=1 is the default kill switch");
  } finally { if (previous === undefined) delete process.env.MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS; else process.env.MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS = previous; }
  assert.deepEqual(h.refs(), []);
  const source = readFileSync(new URL("../scripts/attempt-snapshots-host.cjs", import.meta.url), "utf8");
  assert.match(source, /MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS === "1"/);
});

test("a folder with no commit yet still has attempts", async (t) => {
  const h = project(t, { "first.txt": "hello\n" }, { commit: false });
  await ran(h, (x) => { x.write("first.txt", "hello\nworld\n"); x.write("second.txt", "2\n"); });
  const list = await h.snaps.changes({ root: h.root, taskId: TASK });
  assert.deepEqual(list.files.map((file) => [file.path, file.status]), [["first.txt", "modified"], ["second.txt", "added"]]);
  const back = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.equal(back.ok, true, back.error);
  assert.equal(h.read("first.txt"), "hello\n");
  assert.equal(existsSync(h.at("second.txt")), false);
});

test("the change list reads added, modified, deleted, renamed, binary and odd-named files from git", async (t) => {
  const h = project(t, { "a.txt": "one\ntwo\nthree\n", "gone.txt": "bye\n", "sub/old name.txt": "a long enough body to be seen as a rename\nline 2\nline 3\n", "logo.png": "\0PNG-old", ".gitignore": "*.log\n" });
  await ran(h, (x) => {
    x.write("a.txt", "one\nTWO\nthree\nfour\n");
    rmSync(x.at("gone.txt"));
    nodeFs.renameSync(x.at("sub/old name.txt"), x.at("sub/new name.txt"));
    x.write("added.js", "new\n");
    x.write("logo.png", "\0PNG-new-and-longer");
    x.write(QUOTED_NAME, "q\n");
    x.write("ü/space dir/é.txt", "u\n");
    x.write("noise.log", "ignored\n");
  });
  const list = await h.snaps.changes({ root: h.root, taskId: TASK });
  const files = byPath(list);
  assert.deepEqual(Object.keys(files).sort(), ["a.txt", "added.js", "gone.txt", "logo.png", "sub/new name.txt", QUOTED_NAME, "ü/space dir/é.txt"].sort());
  assert.deepEqual([files["a.txt"].status, files["a.txt"].additions, files["a.txt"].deletions], ["modified", 2, 1]);
  assert.deepEqual([files["gone.txt"].status, files["gone.txt"].additions, files["gone.txt"].deletions], ["deleted", 0, 1]);
  assert.deepEqual([files["added.js"].status, files["added.js"].additions], ["added", 1]);
  assert.deepEqual([files["sub/new name.txt"].status, files["sub/new name.txt"].oldPath], ["renamed", "sub/old name.txt"]);
  assert.equal(files["logo.png"].binary, true);
  assert.equal(files["a.txt"].dir, "");
  assert.equal(files["ü/space dir/é.txt"].dir, "ü/space dir/");
  assert.deepEqual(list.totals, { files: 7, additions: 2 + 1 + 1 + 1, deletions: 1 + 1, binary: 1 });
  assert.equal(list.state, "ended");
  assert.equal(list.attempt, 1);
  assert.equal(list.runId, "run_1_1");
  assert.ok(list.files.every((file) => file.state === "can-revert"));
  assert.equal("oldBlob" in list.files[0], false, "no blob ids reach the page");
});

test("one file's diff comes on demand as numbered lines, marks a binary file, cuts a huge one and refuses a stranger", async (t) => {
  const h = project(t, { "a.txt": "one\ntwo\nthree\n", "old.txt": "a body long enough for git to see the rename\nsecond line\nthird line\n", "big.txt": `${Array.from({ length: 4000 }, (_, index) => `line ${index}`).join("\n")}\n`, "logo.png": "\0old" });
  await ran(h, (x) => {
    x.write("a.txt", "one\nTWO\nthree\nfour\n");
    x.write("big.txt", `${Array.from({ length: 4000 }, (_, index) => `changed ${index}`).join("\n")}\n`);
    x.write("logo.png", "\0new");
    nodeFs.renameSync(x.at("old.txt"), x.at("renamed.txt"));
  });
  const moved = await h.snaps.diff({ root: h.root, taskId: TASK, path: "renamed.txt" });
  assert.deepEqual([moved.ok, moved.status, moved.oldPath, moved.lines], [true, "renamed", "old.txt", []], "a pure rename has no lines to show");
  assert.equal((await h.snaps.diff({ root: h.root, taskId: TASK, path: "old.txt" })).status, "renamed", "either name finds it");
  const small = await h.snaps.diff({ root: h.root, taskId: TASK, path: "a.txt" });
  assert.equal(small.ok, true, small.error);
  assert.deepEqual(small.lines.map((line) => `${line.k}${line.a ?? ""}/${line.b ?? ""} ${line.t}`), ["h/ @@ -1,3 +1,4 @@", " 1/1 one", "-2/ two", "+/2 TWO", " 3/3 three", "+/4 four"]);
  assert.deepEqual([small.status, small.additions, small.deletions, small.truncated], ["modified", 2, 1, false]);
  const binary = await h.snaps.diff({ root: h.root, taskId: TASK, path: "logo.png" });
  assert.deepEqual([binary.ok, binary.binary, binary.lines], [true, true, []]);
  const big = await h.snaps.diff({ root: h.root, taskId: TASK, path: "big.txt" });
  assert.equal(big.ok, true);
  assert.equal(big.truncated, true, "a diff past the bounds is cut");
  assert.ok(big.lines.length <= rules.LIMITS.diffLines);
  assert.ok(Buffer.byteLength(JSON.stringify(big.lines)) < rules.LIMITS.diffBytes * 2, "and what reaches the page stays small");
  const stranger = await h.snaps.diff({ root: h.root, taskId: TASK, path: "sub/c.txt" });
  assert.deepEqual([stranger.ok, stranger.error], [false, "That file is not part of this attempt."]);
  assert.equal((await h.snaps.diff({ root: h.root, taskId: TASK, path: "" })).ok, false);
  assert.equal((await h.snaps.diff({ root: h.root, taskId: TASK, attempt: 9, path: "a.txt" })).ok, false, "an attempt that does not exist has no diff");
});

test("while a run is going the list is read from the folder as it is now, keeps no picture, and cannot be reverted", async (t) => {
  const h = project(t);
  const started = await h.snaps.begin({ root: h.root, taskId: TASK, runId: "run_1_1" });
  h.write("a.txt", "one\nlive\n");
  const live = await h.snaps.changes({ root: h.root, taskId: TASK, running: true });
  assert.equal(live.state, "running");
  assert.deepEqual(live.files.map((file) => file.path), ["a.txt"]);
  assert.equal(live.files[0].state, undefined, "no state per file before the run ends");
  assert.deepEqual(h.refs(), [`refs/mefi/attempts/${TASK}/${started.n}/before`], "reading a running attempt makes no ref");
  const diff = await h.snaps.diff({ root: h.root, taskId: TASK, path: "a.txt", running: true });
  assert.equal(diff.ok, true, diff.error);
  const refused = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /no end snapshot/);
  assert.equal(h.read("a.txt"), "one\nlive\n");
  const interrupted = await h.snaps.changes({ root: h.root, taskId: TASK });
  assert.equal(interrupted.state, "unfinished", "a start with no end and no run is an attempt that did not finish cleanly");
});

test("Revert file puts back that file alone; the safety copy, a receipt and the undo come with it", async (t) => {
  const h = project(t);
  await ran(h, (x) => { x.write("a.txt", "one\nchanged\n"); x.write("b.txt", "two\nchanged\n"); x.write("deep/er/new.js", "new\n"); });
  h.write("stranger.txt", "someone else's file\n");
  const result = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "file", path: "a.txt" });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.reverted, 1);
  assert.equal(h.read("a.txt"), "one\n");
  assert.equal(h.read("b.txt"), "two\nchanged\n", "the other files of the attempt stay");
  assert.equal(h.read("deep/er/new.js"), "new\n");
  assert.equal(h.read("stranger.txt"), "someone else's file\n", "a file outside the attempt is never touched");
  assert.match(result.receipt, /^\d{8}T\d{9}Z$/);
  const receipt = `refs/mefi/attempts/${TASK}/1/reverted-${result.receipt}`;
  assert.ok(h.refs().includes(receipt), "a safety copy of the folder as it was");
  assert.equal(h.g("show", `${receipt}:a.txt`), "one\nchanged\n", "…which still holds the reverted edit");
  assert.equal(h.g("rev-parse", `${receipt}^`).trim(), h.g("rev-parse", `refs/mefi/attempts/${TASK}/1/after`).trim());
  const list = await h.snaps.changes({ root: h.root, taskId: TASK });
  assert.deepEqual(list.files.map((file) => [file.path, file.state]), [["a.txt", "reverted"], ["b.txt", "can-revert"], ["deep/er/new.js", "can-revert"]]);
  assert.equal(list.attempts[0].reverts.length, 1);
  const again = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "file", path: "a.txt" });
  assert.deepEqual([again.ok, again.reverted, again.already], [true, 0, 1], "a file already back is not written again");
  const undone = await h.snaps.undo({ root: h.root, taskId: TASK, receipt: result.receipt });
  assert.equal(undone.ok, true, undone.error);
  assert.equal(h.read("a.txt"), "one\nchanged\n", "undo brings the attempt's copy back");
  assert.equal((await h.snaps.undo({ root: h.root, taskId: TASK, receipt: result.receipt })).reverted, 0, "and undoing twice is harmless");
  assert.equal((await h.snaps.undo({ root: h.root, taskId: TASK, receipt: "20200101T000000000Z" })).ok, false);
  assert.equal((await h.snaps.undo({ root: h.root, taskId: TASK, receipt: "nope" })).ok, false);
});

test("Revert attempt puts back every file: edits, deletions, renames, additions, binaries and odd names, leaving ignored and unrelated files alone", async (t) => {
  const bytes = Buffer.from([0, 1, 2, 255, 254, 0, 10, 13, 10]);
  const h = project(t, { "a.txt": "one\n", "gone.txt": "bye\n", "sub/old name.txt": "a long enough body to be seen as a rename\nline 2\nline 3\n", ".gitignore": "*.log\nnode_modules/\n" });
  writeFileSync(h.at("logo.png"), bytes); h.g("add", "logo.png"); h.g("commit", "-q", "-m", "logo");
  h.write("ignored.log", "keep me\n");
  const original = h.tree();
  await ran(h, (x) => {
    x.write("a.txt", "one\nchanged\n"); rmSync(x.at("gone.txt"));
    mkdirSync(x.at("moved/deeper"), { recursive: true });
    nodeFs.renameSync(x.at("sub/old name.txt"), x.at("moved/deeper/new name.txt"));
    x.write("added.js", "new\n"); x.write(LEAD_QUOTE, "q\n"); x.write("ü/é.txt", "u\n");
    writeFileSync(x.at("logo.png"), Buffer.from([0, 9, 9, 9]));
    x.write("ignored.log", "changed but ignored\n"); x.write("node_modules/x/y.js", "dep\n");
  });
  const count = (await h.snaps.changes({ root: h.root, taskId: TASK })).totals.files;
  const result = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.files >= count, true);
  const now = h.tree();
  assert.equal(readFileSync(h.at("logo.png")).equals(bytes), true, "a binary file comes back byte for byte");
  for (const name of Object.keys(original)) if (name !== "ignored.log") assert.equal(now[name], original[name], `${name} is as it was`);
  assert.equal(h.read("ignored.log"), "changed but ignored\n", "an ignored file is not the attempt's to undo");
  assert.equal(existsSync(h.at("node_modules/x/y.js")), true);
  assert.equal(existsSync(h.at("added.js")), false);
  assert.equal(existsSync(h.at(LEAD_QUOTE)), false, "a name that starts with a quote is handled");
  assert.equal(existsSync(h.at("moved")), false, "folders the attempt made and left empty go with it");
  assert.equal(existsSync(h.at("ü")), false);
  assert.equal(h.g("status", "--porcelain").trim(), "", "git sees a clean folder again");
  assert.deepEqual(readdirSync(h.at("sub")), ["old name.txt"]);
});

test("git's own line-ending conversion is honoured: a CRLF file comes back exactly as the person had it", async (t) => {
  const crlf = "line one\r\nline two\r\n";
  const h = project(t, { "win.txt": crlf }, { config: [["core.autocrlf", "true"]] });
  assert.equal(h.read("win.txt"), crlf, "the fixture keeps CRLF on disk");
  await ran(h, (x) => x.write("win.txt", `${crlf}line three\r\n`));
  const list = await h.snaps.changes({ root: h.root, taskId: TASK });
  assert.deepEqual([list.files[0].additions, list.files[0].deletions], [1, 0], "a line-ending conversion is not a change");
  const result = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.equal(result.ok, true, result.error);
  assert.equal(readFileSync(h.at("win.txt"), "utf8"), crlf);
});

test("a file edited since the attempt ended is never overwritten: the whole revert refuses, names it, and changes nothing", async (t) => {
  const h = project(t);
  await ran(h, (x) => { x.write("a.txt", "one\nattempt\n"); x.write("b.txt", "two\nattempt\n"); x.write("new.txt", "made by the attempt\n"); });
  h.write("b.txt", "two\nattempt\nand then the person kept editing\n");
  const before = h.tree();
  const refs = h.refs();
  const listed = await h.snaps.changes({ root: h.root, taskId: TASK });
  assert.deepEqual(listed.files.map((file) => [file.path, file.state]), [["a.txt", "can-revert"], ["b.txt", "changed"], ["new.txt", "can-revert"]], "the page can see which file was edited since");
  const refused = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.refused, [{ path: "b.txt", reason: "changed-since" }]);
  assert.match(refused.error, /^Nothing was reverted\. 1 file has changed since the attempt ended: b\.txt\./);
  assert.deepEqual(h.tree(), before, "not one file moved");
  assert.deepEqual(h.refs(), refs, "and no safety copy was needed");
  const one = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "file", path: "b.txt" });
  assert.equal(one.ok, false, "that file's own revert is refused too");
  assert.equal(h.read("b.txt"), "two\nattempt\nand then the person kept editing\n");
  // The choice that is offered: put back the others and leave that one.
  const rest = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt", partial: true });
  assert.equal(rest.ok, true, rest.error);
  assert.equal(rest.reverted, 2);
  assert.match(rest.note, /^2 put back\. 1 file was left alone because it changed since the attempt ended: b\.txt\.$/);
  assert.equal(h.read("a.txt"), "one\n");
  assert.equal(existsSync(h.at("new.txt")), false);
  assert.equal(h.read("b.txt"), "two\nattempt\nand then the person kept editing\n");
  // A file the attempt deleted, that was made again since, is the person's too.
  const g = project(t);
  await ran(g, (x) => rmSync(x.at("a.txt")));
  g.write("a.txt", "a new a\n");
  assert.equal((await g.snaps.revert({ root: g.root, taskId: TASK, scope: "attempt" })).ok, false);
  assert.equal(g.read("a.txt"), "a new a\n");
});

test("nothing is reverted while a builder works in the folder, or if one starts before the first byte moves", async (t) => {
  const h = project(t);
  await ran(h, (x) => x.write("a.txt", "one\nattempt\n"));
  const busy = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt", busy: () => true });
  assert.equal(busy.ok, false);
  assert.equal(busy.busy, true);
  assert.match(busy.error, /A builder is working in this folder/);
  assert.equal(h.read("a.txt"), "one\nattempt\n");
  assert.equal(h.refs().some((ref) => /reverted/.test(ref)), false, "it refused before making any copy");
  let calls = 0;
  const late = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt", busy: () => { calls += 1; return calls > 1; } });
  assert.equal(late.ok, false);
  assert.equal(late.busy, true, "the folder is looked at again after the safety copy");
  assert.equal(h.read("a.txt"), "one\nattempt\n");
  const undoBusy = await h.snaps.undo({ root: h.root, taskId: TASK, receipt: "20260101T000000000Z", busy: () => true });
  assert.equal(undoBusy.busy, true);
});

test("a file swapped for a link that leads out of the project is never written through", { skip: !PLAIN }, async (t) => {
  const h = project(t, { "d/f.txt": "one\n", "keep.txt": "k\n" });
  await ran(h, (x) => x.write("d/f.txt", "one\nattempt\n"));
  const outside = path.join(h.base, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "f.txt"), "one\nattempt\n"); // looks exactly like the attempt's copy
  rmSync(h.at("d"), { recursive: true });
  symlinkSync(outside, h.at("d"));
  const result = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.equal(result.ok, false);
  assert.equal(readFileSync(path.join(outside, "f.txt"), "utf8"), "one\nattempt\n", "the file outside was not touched");
  assert.equal(readdirSync(outside).length, 1, "and no temporary file was left there");
  assert.match(result.error, /could not be replaced/);
});

test("a write that fails part-way puts back the files already restored, and the safety copy stays", async (t) => {
  let renames = 0;
  const failing = { ...nodeFs, promises: { ...nodeFs.promises, rename: async (from, to) => { renames += 1; if (renames === 2) throw Object.assign(new Error("EPERM: the file is open in another program"), { code: "EPERM" }); return nodeFs.promises.rename(from, to); } } };
  const h = project(t, undefined, { host: { fs: failing } });
  await ran(h, (x) => { x.write("a.txt", "one\nattempt\n"); x.write("b.txt", "two\nattempt\n"); x.write("sub/c.txt", "three\nattempt\n"); });
  const before = h.tree();
  const result = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.equal(result.ok, false);
  assert.match(result.error, /could not be replaced \(EPERM: the file is open in another program\), so the files already put back were restored\. Nothing was changed\./);
  assert.deepEqual(h.tree(), before, "every file holds what the attempt left");
  assert.equal(walk(h.root).some((name) => name.includes(".mefi-restore")), false, "no temporary file is left behind");
  assert.ok(h.refs().some((ref) => /reverted-/.test(ref)), "the safety copy exists");
  assert.equal(result.receipt.length, 19);
});

test("only read-only git, a temporary index and private refs: never reset, clean, checkout, stash, commit or push, and Studio's keys stay home", async (t) => {
  const calls = [];
  const real = (await import("node:child_process")).execFile;
  const spy = (command, args, options, done) => { calls.push({ command, args: [...args], env: { ...(options?.env ?? {}) }, cwd: options?.cwd }); return real(command, args, options, done); };
  const h = project(t);
  const env = { ...h.env, MEFI_STUDIO_ZAI_KEY: "sk-secret-value", MEFI_STUDIO_HUB_TOKEN: "tok-secret", KEEP_ME: "yes" };
  const snaps = createAttemptSnapshots({ execFile: spy, env: () => env });
  const started = await snaps.begin({ root: h.root, taskId: TASK, runId: "run_1_1" });
  h.write("a.txt", "one\nattempt\n"); h.write("new.txt", "n\n");
  await snaps.end({ root: h.root, taskId: TASK, n: started.n, runId: "run_1_1" });
  await snaps.changes({ root: h.root, taskId: TASK });
  await snaps.diff({ root: h.root, taskId: TASK, path: "a.txt" });
  await snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  const subcommands = new Set(calls.map((call) => call.args.filter((arg, index, all) => !arg.startsWith("-") && all[index - 1] !== "-c")[0]));
  assert.deepEqual([...subcommands].sort(), ["add", "cat-file", "commit-tree", "diff", "for-each-ref", "hash-object", "ls-files", "rev-parse", "update-ref", "write-tree"], "the whole vocabulary");
  assert.equal(calls.every((call) => call.command === "git"), true, "no other program is started");
  for (const banned of ["reset", "clean", "checkout", "restore", "stash", "commit", "push", "fetch", "pull", "merge", "rebase", "rm", "mv", "gc", "prune", "config"]) assert.equal(subcommands.has(banned), false, banned);
  const adds = calls.filter((call) => call.args.includes("add"));
  assert.ok(adds.length >= 2);
  for (const call of adds) {
    assert.ok(call.env.GIT_INDEX_FILE, "every add names its own index");
    assert.ok(call.env.GIT_INDEX_FILE.startsWith(tmpdir()), "in the temp folder");
    assert.equal(path.resolve(call.env.GIT_INDEX_FILE) === path.resolve(h.root, ".git", "index"), false);
    assert.ok(call.args.includes("--pathspec-from-file=-"));
  }
  for (const call of calls.filter((entry) => !entry.args.includes("add") && !entry.args.includes("write-tree"))) assert.equal("GIT_INDEX_FILE" in call.env, false, `${call.args[0] === "-c" ? call.args.find((arg) => !arg.startsWith("-") && !arg.includes("=")) : call.args[0]} runs against the real index only for reads`);
  for (const call of calls) {
    assert.equal(call.env.MEFI_STUDIO_ZAI_KEY, undefined, "Studio's own keys are withheld");
    assert.equal(call.env.MEFI_STUDIO_HUB_TOKEN, undefined);
    assert.equal(call.env.KEEP_ME, "yes", "the rest of the environment passes");
    assert.equal(call.env.GIT_TERMINAL_PROMPT, "0", "no prompt can hold a run");
    assert.ok(call.args.some((arg) => /^core\.hooksPath=/.test(arg)), "no hook runs for Studio's refs");
  }
  const source = readFileSync(new URL("../scripts/attempt-snapshots-host.cjs", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /["'`](?:reset|clean|checkout|stash|push|fetch|restore)["'`]/, "the words are not in the module's argv at all");
  assert.doesNotMatch(source, /shell:\s*true|exec\(|execSync|spawnSync/, "no shell");
});

test("attempts past the newest twenty of a task lose their refs, and other tasks keep theirs", async (t) => {
  const h = project(t);
  await h.snaps.begin({ root: h.root, taskId: "other_task", runId: "run_9_9" });
  for (let round = 1; round <= 22; round += 1) {
    const start = await h.snaps.begin({ root: h.root, taskId: TASK, runId: `run_${round}_1` });
    assert.equal(start.n, round);
    if (round % 2) await h.snaps.end({ root: h.root, taskId: TASK, n: start.n, runId: `run_${round}_1` });
  }
  await h.snaps.prune({ root: h.root });
  const ours = h.refs().filter((ref) => ref.includes(`/${TASK}/`));
  const numbers = [...new Set(ours.map((ref) => Number(ref.split("/").at(-2))))].sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 20 }, (_, index) => index + 3), "attempts 3 to 22 stay, 1 and 2 are pruned");
  assert.ok(h.refs().includes("refs/mefi/attempts/other_task/1/before"), "another task is not affected");
  const list = await h.snaps.changes({ root: h.root, taskId: TASK });
  assert.equal(list.attempts.length, 20);
  assert.equal(list.attempt, 22, "the newest attempt is the one shown");
  const gone = await h.snaps.changes({ root: h.root, taskId: TASK, attempt: 1 });
  assert.equal(gone.attempt, null, "a pruned attempt is simply not there");
});

test("two attempts starting at once get different numbers, and different tasks never share one", async (t) => {
  const h = project(t);
  const [a, b, c] = await Promise.all([
    h.snaps.begin({ root: h.root, taskId: TASK, runId: "run_1_1" }),
    h.snaps.begin({ root: h.root, taskId: TASK, runId: "run_2_1" }),
    h.snaps.begin({ root: h.root, taskId: "task_other", runId: "run_3_1" }),
  ]);
  assert.deepEqual([a.ok, b.ok, c.ok], [true, true, true]);
  assert.deepEqual([a.n, b.n].sort(), [1, 2]);
  assert.equal(c.n, 1);
  assert.equal(h.refs().length, 3);
});

test("a start picture whose claim was cancelled is dropped; a picture with an end, or another attempt's, never is", async (t) => {
  const h = project(t);
  const cancelled = await h.snaps.begin({ root: h.root, taskId: TASK, runId: "run_1_1" });
  assert.deepEqual(h.refs(), [`refs/mefi/attempts/${TASK}/1/before`]);
  assert.deepEqual(await h.snaps.drop({ root: h.root, taskId: TASK, n: cancelled.n }), { ok: true, dropped: true });
  assert.deepEqual(h.refs(), [], "no empty attempt is left for the page to show");
  assert.deepEqual(await h.snaps.drop({ root: h.root, taskId: TASK, n: 1 }), { ok: true, dropped: false }, "nothing there: nothing dropped");
  const real = await ran(h, (x) => x.write("a.txt", "one\nchanged\n"));
  const kept = await h.snaps.drop({ root: h.root, taskId: TASK, n: real.start.n });
  assert.deepEqual([kept.ok, kept.dropped], [true, false], "an attempt that ended is not dropped");
  assert.equal(h.refs().length, 2);
  const other = await h.snaps.begin({ root: h.root, taskId: "task_other", runId: "run_2_1" });
  await h.snaps.drop({ root: h.root, taskId: TASK, n: other.n });
  assert.equal(h.refs().includes("refs/mefi/attempts/task_other/1/before"), true, "another task's picture is not touched");
  assert.deepEqual(await h.snaps.drop({ root: h.root, taskId: "", n: 1 }), { ok: false, dropped: false });
});

test("at most three folders are read at once, however many attempts begin together, and every one of them still gets its picture", async (t) => {
  const { execFile } = require("node:child_process");
  let active = 0;
  let peak = 0;
  // Every temporary-index `git add` (the heavy read of a folder) takes a moment, so overlapping ones are seen.
  const slow = (file, args, options, callback) => {
    if (!args.includes("add") || !options?.env?.GIT_INDEX_FILE) return execFile(file, args, options, callback);
    active += 1;
    peak = Math.max(peak, active);
    let child = null;
    const sent = [];
    const timer = setTimeout(() => {
      child = execFile(file, args, options, (...result) => { active -= 1; callback(...result); });
      child.stdin?.on?.("error", () => {});
      for (const data of sent) child.stdin?.end?.(data);
    }, 60);
    // The pathspec travels on stdin: hold it until the process exists.
    return { kill() { clearTimeout(timer); child?.kill?.(); }, stdin: { on() {}, end(data) { sent.push(data); } } };
  };
  const roots = Array.from({ length: 8 }, () => project(t));
  const shared = createAttemptSnapshots({ env: () => roots[0].env, execFile: slow });
  const started = await Promise.all(roots.map((one, index) => shared.begin({ root: one.root, taskId: TASK, runId: `run_${index}_1` })));
  assert.deepEqual(started.map((one) => one.ok), Array(8).fill(true));
  assert.equal(peak, 3, "three at a time, not one and not eight");
  assert.equal(active, 0);
  assert.ok(roots.every((one) => one.refs().length === 1), "each folder has its picture");
});

test("a run in its own worktree: refs are shared with the project, the list works from either folder, and Revert puts the merged files back in the project", async (t) => {
  const h = project(t);
  h.write(".gitignore", "ignored.log\nnode_modules/\n.mefi/\n"); h.g("add", ".gitignore"); h.g("commit", "-q", "-m", "ignore");
  const work = h.at(".mefi/worktrees/run_1_1");
  h.g("worktree", "add", "-q", "-b", "mefi/run_1_1", work);
  for (const [key, value] of [["user.name", "Run"], ["user.email", "run@example.invalid"], ["commit.gpgsign", "false"]]) git(h.env, work, "config", key, value);
  const start = await h.snaps.begin({ root: work, taskId: TASK, runId: "run_1_1", worktree: true });
  assert.equal(start.ok, true, start.error);
  writeFileSync(path.join(work, "a.txt"), "one\nfrom the worktree\n");
  writeFileSync(path.join(work, "made.txt"), "made in the worktree\n");
  git(h.env, work, "add", "-A"); git(h.env, work, "commit", "-q", "-m", "the run's own commit");
  writeFileSync(path.join(work, "b.txt"), "two\nleft uncommitted\n");
  const stop = await h.snaps.end({ root: work, taskId: TASK, n: start.n, runId: "run_1_1", worktree: true });
  assert.equal(stop.ok, true, stop.error);
  assert.deepEqual(h.refs(), [`refs/mefi/attempts/${TASK}/1/after`, `refs/mefi/attempts/${TASK}/1/before`], "the refs live in the shared repository");
  assert.equal(h.g("status", "--porcelain").includes("made.txt"), false, "the project's own tree was not touched");
  const fromWork = await h.snaps.changes({ root: work, taskId: TASK });
  assert.deepEqual(fromWork.files.map((file) => file.path), ["a.txt", "b.txt", "made.txt"], "committed and uncommitted work both count");
  assert.equal(fromWork.worktree, true);
  // Nothing of it is in the project folder yet, so there is nothing to put back there.
  const early = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.equal(early.ok, true);
  assert.deepEqual([early.reverted, early.already], [0, 3], "files that never reached the project are already as they were");
  // The run merges back (the commit; the uncommitted file is kept by Studio in the worktree), and the person reverts.
  h.g("merge", "--no-edit", "mefi/run_1_1");
  h.write("b.txt", "two\nleft uncommitted\n"); // the uncommitted edit, brought over by hand
  const inProject = await h.snaps.changes({ root: h.root, taskId: TASK });
  assert.deepEqual(inProject.files.map((file) => [file.path, file.state]), [["a.txt", "can-revert"], ["b.txt", "can-revert"], ["made.txt", "can-revert"]]);
  const reverted = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.equal(reverted.ok, true, reverted.error);
  assert.equal(h.read("a.txt"), "one\n");
  assert.equal(h.read("b.txt"), "two\n");
  assert.equal(existsSync(h.at("made.txt")), false);
  assert.equal(existsSync(work), true, "the run's own folder is untouched");
});

test("a mode-only change is listed and put back, on platforms that have modes", { skip: !PLAIN }, async (t) => {
  const h = project(t, { "run.sh": "#!/bin/sh\necho hi\n" });
  await ran(h, (x) => chmodSync(x.at("run.sh"), 0o755));
  const list = await h.snaps.changes({ root: h.root, taskId: TASK });
  assert.deepEqual(list.files.map((file) => [file.path, file.status, file.additions, file.deletions]), [["run.sh", "modified", 0, 0]]);
  const result = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.equal(result.ok, true, result.error);
  assert.equal(statSync(h.at("run.sh")).mode & 0o111, 0, "the executable bit is gone again");
});

test("a link in the change set is put back on platforms that make links", { skip: !PLAIN }, async (t) => {
  const h = project(t, { "a.txt": "one\n" });
  await ran(h, (x) => symlinkSync("a.txt", x.at("alias")));
  const list = await h.snaps.changes({ root: h.root, taskId: TASK });
  assert.deepEqual(list.files.map((file) => [file.path, file.kind, file.status]), [["alias", "symlink", "added"]]);
  const result = await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.equal(result.ok, true, result.error);
  assert.equal(existsSync(h.at("alias")), false);
});

test("no ref is pushed: Studio's own sync publishes the branch and leaves refs/mefi at home", async (t) => {
  const h = project(t);
  const origin = path.join(h.base, "origin.git");
  git(h.env, h.base, "init", "-q", "--bare", "-b", "main", origin);
  h.g("remote", "add", "origin", origin);
  h.g("push", "-q", "-u", "origin", "main");
  await ran(h, (x) => x.write("a.txt", "one\nattempt\n"));
  await h.snaps.revert({ root: h.root, taskId: TASK, scope: "attempt" });
  assert.ok(h.refs().length >= 3, "the refs exist here");
  h.write("later.txt", "a commit to publish\n"); h.g("add", "later.txt"); h.g("commit", "-q", "-m", "publish me");
  const result = await sync(h.root, { push: true, check: null, run: (cwd, args, opts) => runWith(h.env, cwd, args, opts) });
  assert.ok(result.actions.some((action) => action.kind === "pushed"), JSON.stringify(result.problems));
  const remote = git(h.env, h.base, "-C", origin, "for-each-ref", "--format=%(refname)").split("\n").filter(Boolean);
  assert.deepEqual(remote, ["refs/heads/main"], "GitHub's copy holds the branch and nothing of Studio's");
  assert.match(git(h.env, h.base, "-C", origin, "log", "--format=%s", "main"), /publish me/, "the branch itself arrived");
  const picture = h.g("rev-parse", `refs/mefi/attempts/${TASK}/1/after`).trim();
  assert.throws(() => git(h.env, h.base, "-C", origin, "cat-file", "-e", `${picture}^{commit}`), "and the snapshot commits did not travel with it");
});
function runWith(env, cwd, args, { timeout = 30000 } = {}) {
  try { return Promise.resolve({ ok: true, timedOut: false, stdout: execFileSync("git", args, { cwd, env, timeout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(), stderr: "" }); }
  catch (error) { return Promise.resolve({ ok: false, timedOut: false, stdout: String(error.stdout ?? "").trim(), stderr: String(error.stderr ?? error.message).trim() }); }
}

test("nothing in Studio pushes with a mirror, --all, --tags or a refs/ refspec", () => {
  const files = [...readdirSync(new URL("../scripts/", import.meta.url)).filter((name) => /\.(?:c|m)?js$/.test(name)).map((name) => `scripts/${name}`), "main.cjs"];
  const pushes = [];
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const match of text.matchAll(/\[[^\]\n]*["'`]push["'`][^\]\n]*\]/g)) pushes.push([file, match[0]]);
  }
  assert.ok(pushes.length >= 4, "the search finds Studio's pushes");
  // A branch may be named in full (My PCs' handoffs push refs/heads/mefi/handoff/*,
  // scripts/pc-handoff.cjs); every other ref, refs/mefi above all, stays at home.
  for (const [file, argv] of pushes) assert.doesNotMatch(argv, /--mirror|--all\b|--tags|--prune|refs\/(?!heads\/)|"\+|\*/, `${file}: ${argv}`);
});

test("timeoutScale stretches every git time limit, and nothing under 1 shortens them", async () => {
  const seen = [];
  const answer = (_command, _args, options, done) => { seen.push(options.timeout); done(Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }), "", ""); return {}; };
  for (const timeoutScale of [undefined, 3, 0.5, Number.NaN]) {
    await createAttemptSnapshots({ execFile: answer, timeoutScale }).probe("C:\\project");
  }
  assert.deepEqual(seen, [10000, 30000, 10000, 10000], "the probe's 10 s limit, tripled only by a scale above 1");
});
