// Attempt snapshots, JavaScript (scripts/attempt-snapshots-host.cjs with the
// rules of attempt-snapshots.cjs) against Rust (crates/mefi-core snapshots,
// docs/rust-migration.md stage 2): the same rules on the same inputs, and the
// same attempt run on two identical repositories makes the same commits (the
// clock is fixed), lists the same files, shows the same diffs, refuses and
// reverts the same way and leaves the same files and refs. Needs
// npm run host:core; skips without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { coreBinary } from "../scripts/rust-host.mjs";

const require = createRequire(import.meta.url);
const rules = require("../scripts/attempt-snapshots.cjs");
const { createAttemptSnapshots } = require("../scripts/attempt-snapshots-host.cjs");
const binary = coreBinary();
const skip = existsSync(binary) ? false : `mefi-core is not built (${binary}); run npm run host:core`;
const CONST = (value) => ({ $mefi: "const", value });
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

function rust(calls) {
  const result = spawnSync(binary, ["repo-batch"], { input: JSON.stringify(calls), encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).map((answer) => answer.ok ? answer.value : { thrown: answer.error });
}

function compare(cases) {
  const answers = rust(cases.map(([, fn, args]) => ({ function: `snapshots.rules.${fn}`, args })));
  cases.forEach(([label, , , expected], index) => assert.deepEqual(answers[index], plain(expected), label));
}

const SHA = (n) => String(n).repeat(40).slice(0, 40);
const LIST = [
  `refs/mefi/attempts/task_1/1/before\t${SHA(1)}\t1759590000\tMefi attempt 1 before: run_1_1`,
  `refs/mefi/attempts/task_1/1/after\t${SHA(2)}\t1759590100\tMefi attempt 1 after: run_1_1`,
  `refs/mefi/attempts/task_1/1/reverted-20261004T120000000Z\t${SHA(3)}\t1759590200\tMefi attempt 1 reverted 20261004T120000000Z: run_1_1`,
  `refs/mefi/attempts/task_1/1/reverted-20261004T120500000Z\t${SHA(4)}\t1759590200\tMefi attempt 1 reverted 20261004T120500000Z: unknown run`,
  `refs/mefi/attempts/task_1/2/before\t${SHA(5)}\t\tMefi attempt 2 before: unknown`,
  `refs/mefi/attempts/task%20two/3/after\t${SHA(6)}\t1759590300\tsubject\twith\ttabs: run_x`,
  `refs/mefi/attempts/task_1/1234567/before\t${SHA(7)}\t1\tx`,
  `refs/mefi/attempts/task_1/4/later\t${SHA(8)}\t1\tx`,
  `refs/mefi/attempts/task_1/5/before\tnot-a-sha\t1\tx`,
  "",
].join("\r\n");

test("snapshot rules: the same answers on the same inputs", { skip }, () => {
  const cases = [];
  const add = (fn, args, label = `${fn} ${JSON.stringify(args).slice(0, 60)}`) => cases.push([label, fn, args, rules[fn](...args)]);
  for (const id of ["task_1", "a b/c", "é ünï", "日本", "", 42, null, "x".repeat(120), "x".repeat(121), "é".repeat(30), "x".repeat(201)]) add("taskKey", [id]);
  for (const id of ["run_1_1", "bad id", "", null, "x".repeat(80), "x".repeat(81), "a-b_C9"]) add("safeRunId", [id]);
  for (const n of [1, 0, 1.5, 999999, 1000000, "3", -1, null]) add("wholeNumber", [n]);
  for (const ms of [0, 1759590723123, 1759579200000, null, 8.64e15, 8.64e15 + 1, -1, "123"]) add("stampOf", [ms]);
  for (const [task, n, phase, stamp] of [["task_1", 1, "before"], ["task_1", 2, "after"], ["task 1", 3, "reverted", "20261004T120000000Z"], ["task_1", 3, "reverted", "2026"], ["task_1", 0, "before"], ["", 1, "before"], ["task_1", 1, "other"], ["task_1", "1", "after"]]) add("refName", [task, n, phase, stamp ?? null]);
  add("parseRefs", [LIST]);
  add("parseRefs", [""]);
  const rows = rules.parseRefs(LIST);
  add("attemptsOf", [rows, "task_1"]);
  add("attemptsOf", [rows, "task%20two"]);
  add("attemptsOf", [rows, "none"]);
  add("nextAttempt", [[1, 2, 3], [7, 2.5, -1, "9"]]);
  add("nextAttempt", [[], null]);
  const many = [];
  for (const [key, count, base] of [["a", 25, 1000], ["b", 3, 5000], ["c", 4, 3000], ["d", 1, 3000]]) {
    for (let n = 1; n <= count; n += 1) for (const kind of ["before", "after"]) many.push({ ref: `refs/mefi/attempts/${key}/${n}/${kind}`, key, n, kind, at: base + n });
  }
  add("prunePlan", [many, {}]);
  add("prunePlan", [many, { keep: 2, keepTasks: 2 }]);
  add("prunePlan", [many, { keep: 0, keepTasks: 1 }]);
  const message = {
    taskId: "task é/1%", n: 3, phase: "reverted", runId: "run_3_1", at: 1759579200123, worktree: true, overlap: ["run_9", "bad id", 7, "run_8"],
    skipped: [{ path: "big file.bin", size: 9e6, reason: "binary-too-large" }, { path: "line\nbreak.txt", size: "12", reason: "too-large" }, { path: null, reason: "over-budget" }],
    skippedCount: 4, paths: ["a.txt", "sub/ü 100%.txt", "new\r\nline", null], stamp: "20261004T120000123Z",
  };
  add("messageOf", [message]);
  add("messageOf", [{ taskId: "t", n: "2", phase: "before", runId: null, at: null }]);
  add("messageOf", [{ taskId: null, n: 1, phase: "after", runId: 5, at: "1759579200000", overlap: "nope", skipped: "nope", paths: "nope", skippedCount: 2.5 }]);
  add("parseMessage", [rules.messageOf(message)]);
  add("parseMessage", [["Mefi-Task: %E0%A4%A", "Mefi-Attempt: 0", "Mefi-Run: unknown", "Mefi-At: 2026-10-04T12:00:00Z", "Mefi-Overlap: a,b c,,d", "Mefi-Skipped: x", "Mefi-Skipped-File: too-large x y", "Mefi-Path: %zz", "Mefi-Worktree: no", "Mefi-Other: 1"].join("\r\n")]);
  for (const at of ["2026-10-04T12:00:00.5Z", "2026-10-04T12:00Z", "2026-10-04T14:00:00+02:00", "1970-01-01T00:00:00.000Z", "garbage", "+012026-01-01T00:00:00.000Z"]) add("parseMessage", [`Mefi-At: ${at}`]);
  add("parseMessage", [null]);
  const candidates = [
    { path: "b.txt", size: 10 }, { path: "a.bin", size: 3 * 1024 * 1024, binary: true }, { path: "big.txt", size: 6 * 1024 * 1024 },
    { path: "ok.bin", size: 1024 * 1024, binary: true }, { path: "x".repeat(1025), size: 1 }, { path: "", size: 1 }, null, { path: 5 },
    ...Array.from({ length: 14 }, (_, index) => ({ path: `fill/${String(index).padStart(2, "0")}.txt`, size: 5 * 1024 * 1024 - index })),
    { path: "neg.txt", size: -5 }, { path: "nan.txt", size: "many" },
  ];
  add("planSnapshot", [candidates]);
  add("planSnapshot", [Array.from({ length: 20001 }, (_, index) => ({ path: `f${index}`, size: 1 }))], "planSnapshot too many");
  add("planSnapshot", ["nope"]);
  add("addPathspec", [["a b.txt", "sub/ü.bin"]]);
  add("addPathspec", [null]);
  const skippedRows = [{ path: "a" }, { path: "b" }, { path: "c" }, { path: "d" }];
  for (const [list, count] of [[skippedRows, null], [skippedRows.slice(0, 1), null], [skippedRows.slice(0, 1), 1], [[], 3], [skippedRows, 2], [[], null], [skippedRows.slice(0, 2), 9]]) add("skippedSentence", [list, count]);
  const raw = [
    `:100644 100644 ${SHA(1)} ${SHA(2)} M`, "a.txt",
    `:000000 100644 ${"0".repeat(40)} ${SHA(3)} A`, "new file.txt",
    `:100644 000000 ${SHA(4)} ${"0".repeat(40)} D`, "gone.txt",
    `:100644 100644 ${SHA(5)} ${SHA(5)} R100`, "sub/c.txt", "sub/d.txt",
    `:100644 100644 ${SHA(6)} ${SHA(7)} C075`, "src.txt", "copy.txt",
    `:100644 120000 ${SHA(8)} ${SHA(9)} T`, "link",
    `:160000 160000 ${SHA(1)} ${SHA(2)} M`, "module",
    `:100755 100755 ${SHA(3)} ${SHA(4)} M`, "run.sh",
    "garbage", `:100644 100644 ${SHA(1)} ${SHA(2)} M`, "",
  ].join("\0");
  const numstat = ["3\t1\ta.txt", "2\t0\tnew file.txt", "0\t4\tgone.txt", "0\t0\t", "sub/c.txt", "sub/d.txt", "-\t-\tbin.png", "1\t1\trun.sh", "junk", ""].join("\0");
  add("parseRaw", [raw]);
  add("parseRaw", [""]);
  cases.push(["parseNumstat", "parseNumstat", [numstat], [...rules.parseNumstat(numstat)].sort(([a], [b]) => (a < b ? -1 : 1))]);
  add("changeSet", [raw, numstat]);
  const entries = rules.changeSet(raw, numstat);
  add("totalsOf", [entries]);
  add("totalsOf", [null]);
  for (const entry of [...entries, { path: "x", status: "added" }]) add("publicEntry", [entry, null]);
  add("publicEntry", [entries[0], "can-revert"]);
  const diffText = ["diff --git a/a.txt b/a.txt", "index 1..2 100644", "--- a/a.txt", "+++ b/a.txt", "@@ -1,3 +1,4 @@ heading", " one", "-two", "+two!", "+three", "\\ No newline at end of file", " four", "@@ -10 +11 @@", "-x", "+y", "Binary files a/p.png and b/p.png differ", "odd line", ""].join("\n");
  add("parseDiff", [diffText, {}]);
  add("parseDiff", [diffText, { maxLines: 3 }]);
  add("parseDiff", [diffText, { maxBytes: 60 }]);
  add("parseDiff", ["GIT binary patch\nliteral 0\n", {}]);
  add("parseDiff", [`@@ -1 +1 @@\n+${"é".repeat(40)}\n`, { maxBytes: 20 }]);
  for (const name of ["a.txt", "sub/b.txt", "", "/abs", "a\\b", "C:/x", "a/../b", "./a", ".git/config", "sub/.GIT/x", "trail.", "trail ", "a//b", "new\nline", "x".repeat(1025), 5, null, "ü/日本.txt"]) add("safeRelative", [name]);
  const plan = (current, more = {}) => ({ entries, scope: "attempt", current, ...more });
  const all = Object.fromEntries(entries.flatMap((entry) => [entry.path, entry.oldPath].filter(Boolean)).map((name) => [name, { blob: null }]));
  const afterState = {
    "a.txt": { blob: SHA(2) }, "new file.txt": { blob: SHA(3) }, "gone.txt": { blob: null }, "sub/c.txt": { blob: null }, "sub/d.txt": { blob: SHA(5) },
    "copy.txt": { blob: SHA(7) }, "run.sh": { blob: SHA(4) },
  };
  add("planRevert", [plan(afterState)]);
  add("planRevert", [plan(afterState, { symlinks: true, partial: true })]);
  add("planRevert", [plan({ ...afterState, "a.txt": { blob: SHA(9) } })]);
  add("planRevert", [plan({ ...afterState, "a.txt": { blob: SHA(9) } }, { partial: true })]);
  add("planRevert", [plan({ ...afterState, "a.txt": { blob: SHA(1) }, "new file.txt": { blob: null }, "gone.txt": { blob: SHA(4) }, "sub/c.txt": { blob: SHA(5) }, "sub/d.txt": { blob: null } }, { partial: true })]);
  add("planRevert", [plan({ "a.txt": { blob: SHA(2) } }, { partial: true })]);
  add("planRevert", [plan(all, { partial: true })]);
  add("planRevert", [plan(afterState, { scope: "file", path: "sub/c.txt" })]);
  add("planRevert", [plan(afterState, { scope: "file", path: "nowhere" })]);
  add("planRevert", [plan(afterState, { scope: "file", path: null })]);
  add("planRevert", [plan(afterState, { scope: "both" })]);
  add("planRevert", [{ entries: [{ status: "modified", path: "../up", oldPath: null, oldBlob: SHA(1), newBlob: SHA(2) }, { status: "renamed", path: "ok.txt", oldPath: "C:/bad", oldBlob: SHA(1), newBlob: SHA(1) }], scope: "attempt", current: {} }]);
  add("planRevert", [{ entries: Array.from({ length: 2001 }, (_, index) => ({ status: "added", path: `f${index}`, newBlob: SHA(1) })), scope: "attempt", current: {} }], "planRevert too many");
  add("invertEntries", [entries]);
  add("invertEntries", ["nope"]);
  for (const [refusedRows, options] of [
    [[], {}],
    [[{ path: "a", reason: "changed-since" }], {}],
    [[{ path: "a", reason: "changed-since" }], { partial: true, restoring: 2 }],
    [[{ path: "a", reason: "unsafe-name" }], {}],
    [[{ path: "a", reason: "mystery" }], { partial: true }],
    [[{ path: "a", reason: "unknown" }, { path: "", reason: "unsupported" }, { path: "c", reason: "changed-since" }, { path: "d", reason: "x" }, { path: "e", reason: "x" }, { path: "f", reason: "x" }, { path: "g", reason: "x" }], {}],
    [[{ path: "a", reason: "changed-since" }, { path: "b", reason: "changed-since" }], { partial: true }],
  ]) add("refusalSentence", [refusedRows, options]);
  for (const reason of ["off", "not-a-repo", "nested", "git-missing", "too-many", "unreadable", "other"]) add("unavailable", [reason]);
  compare(cases);
});

// ---- the host on two identical repositories ----

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0, 123);
const SCALE = 6;
const TASK = "task_0123456789abcdef";

function isolated(base) {
  const home = path.join(base, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, ".gitconfig"), "");
  return { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
}

// The same project twice: same files, same first commit (fixed names and dates), so HEAD is the same commit.
function twin(base, name) {
  const env = isolated(path.join(base, name));
  const root = path.join(base, name, "project");
  mkdirSync(root, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, env: { ...env, GIT_AUTHOR_NAME: "Person", GIT_AUTHOR_EMAIL: "p@example.invalid", GIT_COMMITTER_NAME: "Person", GIT_COMMITTER_EMAIL: "p@example.invalid", GIT_AUTHOR_DATE: "2026-10-01T10:00:00Z", GIT_COMMITTER_DATE: "2026-10-01T10:00:00Z" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main", ".");
  git("config", "commit.gpgsign", "false");
  const files = { "a.txt": "one\ntwo\nthree\n", "b.txt": "bee\n", "sub/c.txt": "sea\n".repeat(20), "keep.txt": "keep\n", ".gitignore": "ignored.log\n" };
  for (const [file, body] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), body); }
  git("add", "-A");
  git("commit", "-q", "-m", "First");
  const at = (file) => path.join(root, file);
  return {
    env, root, git, at,
    write: (file, body) => { mkdirSync(path.dirname(at(file)), { recursive: true }); writeFileSync(at(file), body); },
    refs: () => git("for-each-ref", "--format=%(refname) %(objectname)", "refs/mefi").split("\n").filter(Boolean).sort(),
    files: () => walk(root).map((file) => `${file} ${createHash("sha256").update(readFileSync(at(file))).digest("hex").slice(0, 16)}`),
  };
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

// The attempt's own work, done the same way on both.
const work = [
  (h) => {
    h.write("a.txt", "one\ntwo, changed\nthree\nfour\n");
    h.write("new/added.txt", "fresh\n");
    unlinkSync(h.at("b.txt"));
    renameSync(h.at("sub/c.txt"), h.at("sub/d.txt"));
    h.write("pic.bin", Buffer.from([0, 1, 2, 3, 0, 255]));
    h.write("ignored.log", "noise\n");
  },
  // Someone edits a file after the attempt ended.
  (h) => h.write("a.txt", "the person's own edit\n"),
  // Someone edits the file the revert brought back.
  (h) => h.write("b.txt", "edited after the revert\n"),
];

test("snapshot host: the same attempt on two identical repositories gives the same answers, commits, files and refs", { skip, timeout: 240000 }, async (t) => {
  const base = mkdtempSync(path.join(tmpdir(), "mefi-snap-parity-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const js = twin(base, "js");
  const rs = twin(base, "rs");
  assert.equal(js.git("rev-parse", "HEAD"), rs.git("rev-parse", "HEAD"), "the twins start on the same commit");
  const outside = path.join(base, "plain");
  mkdirSync(outside);

  // Each step: [label, method, request (root and busy filled in), work to do before it].
  const steps = [
    ["probe", "probe", null],
    ["probe outside", "probe", outside],
    ["begin", "begin", { taskId: TASK, runId: "run_1_1", overlap: ["run_9_1", "bad id"], numbers: [] }],
    ["begin bad run", "begin", { taskId: TASK, runId: "bad id" }],
    ["attempts while running", "attempts", { taskId: TASK }],
    ["end", "end", { taskId: TASK, n: 1, runId: "run_1_1", overlap: ["run_9_1"] }, work[0]],
    ["end again", "end", { taskId: TASK, n: 1, runId: "run_1_1" }],
    ["end without a start", "end", { taskId: TASK, n: 5, runId: "run_5_1" }],
    ["changes", "changes", { taskId: TASK, attempt: 1 }],
    ["changes by run", "changes", { taskId: TASK, runId: "run_1_1" }],
    ["changes of nothing", "changes", { taskId: "task_none" }],
    ["diff a.txt", "diff", { taskId: TASK, attempt: 1, path: "a.txt" }],
    ["diff renamed", "diff", { taskId: TASK, attempt: 1, path: "sub/c.txt" }],
    ["diff binary", "diff", { taskId: TASK, attempt: 1, path: "pic.bin" }],
    ["diff not in it", "diff", { taskId: TASK, attempt: 1, path: "keep.txt" }],
    ["diff no path", "diff", { taskId: TASK, attempt: 1 }],
    ["revert while busy", "revert", { taskId: TASK, attempt: 1, scope: "attempt", busy: true }],
    ["revert attempt refused", "revert", { taskId: TASK, attempt: 1, scope: "attempt" }, work[1]],
    ["changes after an edit", "changes", { taskId: TASK, attempt: 1 }],
    ["revert one file", "revert", { taskId: TASK, attempt: 1, scope: "file", path: "b.txt" }],
    ["revert the rest", "revert", { taskId: TASK, attempt: 1, scope: "attempt", partial: true }],
    ["revert nothing left", "revert", { taskId: TASK, attempt: 1, scope: "file", path: "pic.bin" }],
    ["revert no scope", "revert", { taskId: TASK, attempt: 1 }],
    ["attempts after reverts", "attempts", { taskId: TASK }],
    ["undo refused", "undo", { taskId: TASK, attempt: 1, receipt: "20261004T120000123Z" }, work[2]],
    ["undo unknown", "undo", { taskId: TASK, attempt: 1, receipt: "20991231T000000000Z" }],
    ["undo bad receipt", "undo", { taskId: TASK, attempt: 1, receipt: "yesterday" }],
    ["second begin", "begin", { taskId: TASK, runId: "run_2_1", numbers: [3] }],
    ["drop it", "drop", { taskId: TASK, n: 4 }],
    ["drop an ended one", "drop", { taskId: TASK, n: 1 }],
    ["prune", "prune", {}],
    ["attempts at the end", "attempts", { taskId: TASK }],
  ];

  const logs = [];
  // Generous git time limits on both sides: on a loaded machine a 10 s `rev-parse HEAD` that times out on one
  // side only makes its start picture without a parent (same tree, another commit id).
  const host = createAttemptSnapshots({ env: () => js.env, now: () => NOW, log: (line) => logs.push(line), timeoutScale: SCALE });
  const expected = [];
  for (const [label, method, request, before] of steps) {
    before?.(js);
    const answer = method === "probe"
      ? await host.probe(request ?? js.root)
      : await host[method]({ root: js.root, ...request, busy: () => request.busy === true });
    expected.push([label, plain(answer)]);
  }
  // The JavaScript prunes in the background after a begin: let it finish before reading refs.
  await new Promise((resolve) => setTimeout(resolve, 500));
  // Two matching failures would prove nothing: the steps did what they say.
  const said = Object.fromEntries(expected);
  assert.equal(said.begin.n, 1);
  assert.equal(said.end.changed, true);
  assert.deepEqual(said.changes.files.map((file) => `${file.status} ${file.path} ${file.state}`), ["modified a.txt can-revert", "deleted b.txt can-revert", "added new/added.txt can-revert", "added pic.bin can-revert", "renamed sub/d.txt can-revert"]);
  assert.equal(said["diff a.txt"].lines.filter((line) => line.k === "+").length, 2);
  assert.equal(said["diff binary"].binary, true);
  assert.equal(said["revert while busy"].busy, true);
  assert.equal(said["revert attempt refused"].refused[0].reason, "changed-since");
  assert.equal(said["changes after an edit"].files[0].state, "changed");
  assert.deepEqual([said["revert one file"].ok, said["revert one file"].reverted, said["revert one file"].receipt], [true, 1, "20261004T120000123Z"]);
  assert.equal(said["undo refused"].refused[0].path, "b.txt");
  assert.equal(said["second begin"].n, 4);
  assert.equal(said["drop it"].dropped, true);

  const collaborators = { env: rs.env, now: CONST(NOW), disabled: CONST(false), log: CONST(null), timeoutScale: SCALE };
  let batch = [];
  const answers = [];
  const flush = () => { if (batch.length) answers.push(...rust(batch)); batch = []; };
  for (const [, method, request, before] of steps) {
    if (before) { flush(); before(rs); }
    const sent = method === "probe" ? request ?? rs.root : { root: rs.root, ...request, busy: CONST(request.busy === true) };
    batch.push({ function: `snapshots.${method}`, args: [collaborators, sent] });
  }
  flush();
  // Rust prunes on its own thread after a begin; the batch waits for nothing, so prune ran as its own step.
  steps.forEach(([label], index) => assert.deepEqual(answers[index], expected[index][1], label));
  assert.deepEqual(rs.refs(), js.refs(), "the same refs point at the same commits");
  assert.deepEqual(rs.files(), js.files(), "the same files are left");
  assert.equal(rs.git("status", "--porcelain"), js.git("status", "--porcelain"), "the same status");
});

test("snapshot host: the kill switch and a folder that is not a repository answer alike", { skip }, async (t) => {
  const base = mkdtempSync(path.join(tmpdir(), "mefi-snap-parity-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const h = twin(base, "one");
  const plainFolder = path.join(base, "plain");
  mkdirSync(path.join(h.root, "inner"), { recursive: true });
  mkdirSync(plainFolder);
  const cases = [
    ["off", { disabled: () => true }, "begin", { root: h.root, taskId: TASK, runId: "run_1_1" }],
    ["off changes", { disabled: () => true }, "changes", { root: h.root, taskId: TASK }],
    ["not a repo", {}, "begin", { root: plainFolder, taskId: TASK, runId: "run_1_1" }],
    ["nested", {}, "changes", { root: path.join(h.root, "inner"), taskId: TASK }],
    ["missing folder", {}, "attempts", { root: path.join(base, "nowhere"), taskId: TASK }],
    ["no root", {}, "diff", { taskId: TASK, path: "a.txt" }],
    ["bad task", {}, "attempts", { root: h.root, taskId: "" }],
  ];
  const calls = [];
  for (const [label, more, method, request] of cases) {
    const host = createAttemptSnapshots({ env: () => h.env, now: () => NOW, ...more });
    const expected = plain(await host[method](request));
    calls.push({ label, expected, call: { function: `snapshots.${method}`, args: [{ env: h.env, now: CONST(NOW), disabled: CONST(Boolean(more.disabled)) }, request] } });
  }
  const answers = rust(calls.map((item) => item.call));
  calls.forEach((item, index) => assert.deepEqual(answers[index], item.expected, item.label));
});
