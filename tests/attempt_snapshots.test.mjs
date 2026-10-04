// The pure half of attempt snapshots (scripts/attempt-snapshots.cjs): how a ref
// is named, how a snapshot commit carries its facts, which files a snapshot
// leaves out, how git's raw diff, numstat and diff text are read, which attempts
// to prune, and what a revert may touch and why it refuses. No git runs here;
// tests/attempt_snapshots_host.test.mjs runs the real thing over temp repos.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const rules = require("../scripts/attempt-snapshots.cjs");
const SHA = (digit) => String(digit).repeat(40);

test("the module says it is pure and its refs live under one private namespace", () => {
  const source = readFileSync(new URL("../scripts/attempt-snapshots.cjs", import.meta.url), "utf8");
  assert.match(source.slice(0, 4000), /Pure module: no Electron, no filesystem, no network, no processes, no/);
  assert.equal(rules.NAMESPACE, "refs/mefi/attempts");
  assert.equal(rules.KEEP_ATTEMPTS, 20, "the newest twenty attempts per task are kept");
});

test("a task id becomes one safe part of a ref, and two ids never share a name", () => {
  assert.equal(rules.taskKey("task_ab12-CD"), "task_ab12-CD");
  assert.equal(rules.taskKey("task/1"), "task%2f1");
  assert.equal(rules.taskKey("a b"), "a%20b");
  assert.equal(rules.taskKey("..%"), "%2e%2e%25");
  assert.notEqual(rules.taskKey("a.b"), rules.taskKey("a_b"));
  assert.notEqual(rules.taskKey("a%2fb"), rules.taskKey("a/b"), "a literal %2f and a slash are different ids");
  assert.equal(rules.taskKey("é"), "%c3%a9", "written as the bytes of its UTF-8");
  for (const bad of ["", null, undefined, 7, "x".repeat(201), "é".repeat(50)]) assert.equal(rules.taskKey(bad), null, `no key for ${String(bad).slice(0, 12)}`);
  assert.equal(rules.taskKey("x".repeat(120)).length, 120);
  assert.equal(rules.taskKey("x".repeat(121)), null, "a name that would run past 120 characters has no snapshots");
});

test("ref names carry the task, the attempt number and the phase, and nothing else", () => {
  assert.equal(rules.refName("task_1", 3, "before"), "refs/mefi/attempts/task_1/3/before");
  assert.equal(rules.refName("task_1", 3, "after"), "refs/mefi/attempts/task_1/3/after");
  assert.equal(rules.refName("task_1", 3, "reverted", "20260930T151203123Z"), "refs/mefi/attempts/task_1/3/reverted-20260930T151203123Z");
  for (const args of [["", 1, "before"], ["t", 0, "before"], ["t", 1.5, "before"], ["t", -1, "after"], ["t", 1000000, "after"], ["t", 1, "during"], ["t", 1, "reverted"], ["t", 1, "reverted", "yesterday"], ["t", "1", "before"]]) {
    assert.equal(rules.refName(...args), null, JSON.stringify(args));
  }
  assert.equal(rules.stampOf(Date.UTC(2026, 8, 30, 15, 12, 3, 123)), "20260930T151203123Z");
  assert.equal(rules.stampOf("soon"), null);
  const later = rules.stampOf(Date.UTC(2026, 8, 30, 15, 12, 4, 0));
  assert.ok(later > rules.stampOf(Date.UTC(2026, 8, 30, 15, 12, 3, 999)), "a stamp sorts as time sorts");
});

test("a listing of refs reads back as attempts, newest first, with their runs and reverts", () => {
  const row = (ref, sha, at, subject) => `${ref}\t${sha}\t${at}\t${subject}`;
  const text = [
    row("refs/mefi/attempts/task_1/1/before", SHA(1), 100, "Mefi attempt 1 before: run_10_1"),
    row("refs/mefi/attempts/task_1/1/after", SHA(2), 160, "Mefi attempt 1 after: run_10_1"),
    row("refs/mefi/attempts/task_1/2/before", SHA(3), 300, "Mefi attempt 2 before: run_20_1"),
    row("refs/mefi/attempts/task_1/1/reverted-20260930T151203123Z", SHA(4), 400, "Mefi attempt 1 reverted 20260930T151203123Z: run_10_1"),
    row("refs/mefi/attempts/task_9/1/before", SHA(5), 50, "Mefi attempt 1 before: unknown run"),
    row("refs/heads/main", SHA(6), 1, "not ours"),
    row("refs/mefi/attempts/task_1/x/before", SHA(7), 1, "bad number"),
    "garbage",
    "",
  ].join("\n");
  const rows = rules.parseRefs(text);
  assert.equal(rows.length, 5, "only well-formed attempt refs count");
  assert.equal(rows[0].at, 100000, "seconds become milliseconds");
  assert.equal(rows[4].runId, null, "an unknown run has none");
  const attempts = rules.attemptsOf(rows, "task_1");
  assert.deepEqual(attempts.map((item) => item.n), [2, 1], "newest attempt first");
  assert.equal(attempts[1].runId, "run_10_1");
  assert.equal(attempts[1].before.sha, SHA(1));
  assert.equal(attempts[1].after.sha, SHA(2));
  assert.equal(attempts[1].reverts[0].stamp, "20260930T151203123Z");
  assert.equal(attempts[0].after, null, "attempt 2 has no end yet");
  assert.equal(attempts[1].startedAt, 100000);
  assert.equal(attempts[1].endedAt, 160000);
  assert.deepEqual(rules.attemptsOf(rows, "task_9").map((item) => item.n), [1]);
  assert.deepEqual(rules.attemptsOf(rows, "nobody"), []);
});

test("the next attempt number is one past the highest anything holds", () => {
  assert.equal(rules.nextAttempt([]), 1);
  assert.equal(rules.nextAttempt([1, 2, 3]), 4);
  assert.equal(rules.nextAttempt([1, 2], [7]), 8, "an evidence folder that holds 7 counts too");
  assert.equal(rules.nextAttempt(null, undefined, ["x", 2.5, -3, 4]), 5, "only whole numbers count");
});

test("pruning keeps the newest twenty attempts per task and the newest three hundred tasks", () => {
  const rows = [];
  for (let n = 1; n <= 25; n += 1) {
    rows.push({ ref: `refs/mefi/attempts/busy/${n}/before`, key: "busy", n, at: n * 1000 }, { ref: `refs/mefi/attempts/busy/${n}/after`, key: "busy", n, at: n * 1000 + 1 });
  }
  rows.push({ ref: "refs/mefi/attempts/busy/2/reverted-20260930T000000000Z", key: "busy", n: 2, at: 99999 });
  const doomed = rules.prunePlan(rows);
  assert.equal(doomed.length, 11, "attempts 1-5 lose before and after, and attempt 2 its revert receipt");
  assert.ok(doomed.every((ref) => /\/busy\/[1-5]\//.test(ref)));
  assert.ok(!doomed.some((ref) => /\/busy\/(?:6|20|25)\//.test(ref)), "the newest twenty stay");
  const many = Array.from({ length: 305 }, (_, index) => ({ ref: `refs/mefi/attempts/t${index}/1/before`, key: `t${index}`, n: 1, at: index * 10 }));
  const dropped = rules.prunePlan(many);
  assert.equal(dropped.length, 5, "five tasks past three hundred");
  assert.deepEqual(dropped.sort(), Array.from({ length: 5 }, (_, index) => `refs/mefi/attempts/t${index}/1/before`).sort(), "the least recently touched go");
  assert.deepEqual(rules.prunePlan(rows, { keep: 30 }), [], "a bigger keep keeps everything");
  assert.equal(rules.prunePlan(rows, { keep: 0 }).length, rows.length - 2, "there is always at least the newest attempt (its before and after)");
});

test("a snapshot commit's message round-trips its facts, and a name with a line break cannot break a line", () => {
  const skipped = [{ reason: "too-large", size: 9000000, path: "big/data file.json" }, { reason: "over-budget", size: 5, path: "new\nline.txt" }];
  const text = rules.messageOf({ taskId: "task/1 é", n: 4, phase: "after", runId: "run_1_2", at: Date.UTC(2026, 8, 30, 12, 0, 0), worktree: true, overlap: ["run_9_9", "bad run!", "run_8_8"], skipped, skippedCount: 7, paths: ["a b.txt", "x\ny"] });
  assert.match(text.split("\n")[0], /^Mefi attempt 4 after: run_1_2$/);
  assert.equal(text.split("\n").filter((line) => line.startsWith("Mefi-")).every((line) => !line.includes("\r")), true);
  const facts = rules.parseMessage(text);
  assert.equal(facts.phase, "after");
  assert.equal(facts.taskId, "task/1 é");
  assert.equal(facts.n, 4);
  assert.equal(facts.runId, "run_1_2");
  assert.equal(facts.at, Date.UTC(2026, 8, 30, 12, 0, 0));
  assert.equal(facts.worktree, true);
  assert.deepEqual(facts.overlap, ["run_9_9", "run_8_8"], "a run id that is not a flat token is dropped");
  assert.deepEqual(facts.skipped, skipped, "left-out files come back whole, even one with a line break in its name");
  assert.equal(facts.skippedCount, 7);
  assert.deepEqual(facts.paths, ["a b.txt", "x\ny"]);
  const nobody = rules.parseMessage(rules.messageOf({ taskId: "t", n: 1, phase: "before", runId: null, at: 0 }));
  assert.equal(nobody.runId, null);
  assert.deepEqual(rules.parseMessage("not a snapshot"), { phase: null, taskId: null, n: null, runId: null, at: null, worktree: false, overlap: [], skipped: [], skippedCount: 0, paths: [] });
});

test("a snapshot leaves out files over the caps and says so; too many files means no snapshot", () => {
  const MIB = 1024 * 1024;
  const plan = rules.planSnapshot([
    { path: "small.js", size: 1200, binary: false },
    { path: "big.json", size: 6 * MIB, binary: false },
    { path: "photo.png", size: 3 * MIB, binary: true },
    { path: "icon.png", size: 200 * 1024, binary: true },
    { path: "edge.txt", size: 5 * MIB, binary: false },
    { path: "x".repeat(1100), size: 3, binary: false },
  ]);
  assert.equal(plan.tooMany, false);
  assert.deepEqual(plan.skipped.map((row) => [row.reason, row.path.slice(0, 9)]), [["too-large", "big.json"], ["binary-too-large", "photo.png"], ["long-name", "xxxxxxxxx"]], "named in path order, each with its reason");
  assert.deepEqual(new Set(plan.leaveOut), new Set(["big.json", "photo.png", "x".repeat(1100)]));
  assert.equal(plan.skippedCount, 3);
  assert.equal(plan.bytes, 1200 + 200 * 1024 + 5 * MIB, "a file exactly at the cap is kept");
  const budget = rules.planSnapshot([{ path: "a", size: 6 }, { path: "b", size: 6 }, { path: "c", size: 6 }], { ...rules.LIMITS, totalBytes: 13 });
  assert.deepEqual(budget.skipped.map((row) => [row.path, row.reason]), [["c", "over-budget"]], "the budget runs out on the last file, in path order");
  const crowd = rules.planSnapshot(Array.from({ length: rules.LIMITS.candidates + 1 }, (_, index) => ({ path: `f${index}`, size: 1 })));
  assert.equal(crowd.tooMany, true);
  assert.equal(crowd.count, rules.LIMITS.candidates + 1);
  assert.equal(rules.planSnapshot([]).skippedCount, 0);
  assert.equal(rules.planSnapshot(null).tooMany, false);
  const many = rules.planSnapshot(Array.from({ length: 60 }, (_, index) => ({ path: `big${String(index).padStart(2, "0")}`, size: 9 * MIB })));
  assert.equal(many.skippedCount, 60);
  assert.equal(many.skipped.length, rules.LIMITS.skippedListed, "the list handed on is bounded, the count is not");
});

test("the pathspec git reads takes everything except the files left out, each taken literally", () => {
  assert.equal(rules.addPathspec([]), ".\0");
  assert.equal(rules.addPathspec(["a b.bin", "*.weird"]), ".\0:(exclude,literal)a b.bin\0:(exclude,literal)*.weird\0");
});

test("the sentence about left-out files names three and counts the rest", () => {
  assert.equal(rules.skippedSentence([], 0), "");
  assert.match(rules.skippedSentence([{ path: "a.bin" }]), /^1 file was left out of the snapshot \(a\.bin\): too large to keep a copy of, so it is not listed and cannot be reverted\.$/);
  assert.match(rules.skippedSentence([{ path: "a" }, { path: "b" }, { path: "c" }, { path: "d" }], 9), /^9 files were left out of the snapshot \(a, b, c and 6 more\)/);
});

test("git's raw diff reads as statuses, blobs and modes, with a rename carrying both names", () => {
  const raw = [
    `:100644 100644 ${SHA(1)} ${SHA(2)} M`, "a.txt",
    `:100644 000000 ${SHA(3)} ${"0".repeat(40)} D`, "b.txt",
    `:000000 100644 ${"0".repeat(40)} ${SHA(4)} A`, "new file.txt",
    `:100644 100644 ${SHA(5)} ${SHA(5)} R100`, "sub/c.txt", "sub/c2.txt",
    `:100644 100755 ${SHA(6)} ${SHA(6)} M`, "run.sh",
    `:100644 120000 ${SHA(7)} ${SHA(8)} T`, "link",
    `:000000 160000 ${"0".repeat(40)} ${SHA(9)} A`, "vendor/lib",
    "",
  ].join("\0");
  const rows = rules.parseRaw(raw);
  assert.deepEqual(rows.map((row) => [row.status, row.path, row.oldPath]), [["modified", "a.txt", null], ["deleted", "b.txt", null], ["added", "new file.txt", null], ["renamed", "sub/c2.txt", "sub/c.txt"], ["modified", "run.sh", null], ["modified", "link", null], ["added", "vendor/lib", null]]);
  assert.equal(rows[1].newBlob, null);
  assert.equal(rows[1].oldBlob, SHA(3));
  assert.equal(rows[2].oldBlob, null);
  assert.equal(rows[3].score, 100);
  assert.equal(rows[4].oldMode, "100644");
  assert.equal(rows[4].newMode, "100755");
  assert.equal(rows[5].typeChanged, true);
  assert.equal(rows[6].kind, "submodule");
  assert.equal(rows[1].kind, "file", "a deleted file's kind is read from the mode it had");
  assert.deepEqual(rules.parseRaw(""), []);
  assert.deepEqual(rules.parseRaw("junk\0more"), [], "anything that is not a raw record is skipped");
});

test("numstat reads line counts, binary files and renames, and joins onto the raw entries by path", () => {
  const numstat = ["1\t0\ta.txt", "0\t1\tb.txt", "-\t-\tlogo.png", "0\t0\t\0sub/c.txt\0sub/c2.txt", "12\t3\tdir/with space.js", ""].join("\0");
  const stats = rules.parseNumstat(numstat);
  assert.deepEqual(stats.get("a.txt"), { additions: 1, deletions: 0, binary: false });
  assert.deepEqual(stats.get("logo.png"), { additions: 0, deletions: 0, binary: true });
  assert.deepEqual(stats.get("sub/c2.txt"), { additions: 0, deletions: 0, binary: false }, "a rename is keyed by its new name");
  const raw = [`:100644 100644 ${SHA(1)} ${SHA(2)} M`, "z.txt", `:100644 100644 ${SHA(3)} ${SHA(4)} M`, "a.txt", `:000000 100644 ${"0".repeat(40)} ${SHA(5)} A`, "logo.png", ""].join("\0");
  const set = rules.changeSet(raw, numstat);
  assert.deepEqual(set.map((entry) => entry.path), ["a.txt", "logo.png", "z.txt"], "sorted by path");
  assert.equal(set[0].additions, 1);
  assert.equal(set[1].binary, true);
  assert.equal(set[2].additions, 0, "a file numstat did not list counts as no lines");
  assert.deepEqual(rules.totalsOf([{ additions: 3, deletions: 1 }, { additions: 0, deletions: 0, binary: true }, { additions: 2, deletions: 4 }]), { files: 3, additions: 5, deletions: 5, binary: 1 });
  assert.deepEqual(rules.totalsOf(null), { files: 0, additions: 0, deletions: 0, binary: 0 });
});

test("an entry goes to the page as a folder and a file name, with no blob ids", () => {
  const view = rules.publicEntry({ path: "src/ui/panel.js", status: "modified", additions: 2, deletions: 1, oldBlob: SHA(1), newBlob: SHA(2), oldMode: "100644" }, "can-revert");
  assert.deepEqual(view, { path: "src/ui/panel.js", dir: "src/ui/", name: "panel.js", oldPath: null, status: "modified", additions: 2, deletions: 1, binary: false, kind: "file", state: "can-revert" });
  assert.equal(rules.publicEntry({ path: "README.md", status: "added" }).dir, "");
  assert.equal("oldBlob" in view, false);
});

test("a unified diff reads as numbered lines, keeps only hunks, and bounds its size", () => {
  const text = ["diff --git a/a.txt b/a.txt", "index 1..2 100644", "--- a/a.txt", "+++ b/a.txt", "@@ -1,3 +1,4 @@ heading", " one", "-two", "+TWO", "+three-a", " three", "\\ No newline at end of file", "@@ -20 +21 @@", "-x", "+y", ""].join("\n");
  const parsed = rules.parseDiff(text);
  assert.equal(parsed.binary, false);
  assert.equal(parsed.truncated, false);
  assert.deepEqual(parsed.lines.map((line) => [line.k, line.t, line.a ?? null, line.b ?? null]), [
    ["h", "@@ -1,3 +1,4 @@ heading", null, null],
    [" ", "one", 1, 1],
    ["-", "two", 2, null],
    ["+", "TWO", null, 2],
    ["+", "three-a", null, 3],
    [" ", "three", 3, 4],
    ["h", "@@ -20 +21 @@", null, null],
    ["-", "x", 20, null],
    ["+", "y", null, 21],
  ]);
  assert.equal(rules.parseDiff("Binary files a/x.png and b/x.png differ\n").binary, true);
  const long = `@@ -1 +1 @@\n${Array.from({ length: 50 }, (_, index) => `+line ${index}`).join("\n")}\n`;
  const cut = rules.parseDiff(long, { maxLines: 10 });
  assert.equal(cut.lines.length, 10);
  assert.equal(cut.truncated, true);
  assert.equal(rules.parseDiff(long, { maxBytes: 40 }).truncated, true, "a diff past the byte limit is cut");
  assert.deepEqual(rules.parseDiff("").lines, []);
});

test("only a plain relative name is ever joined under the project folder", () => {
  for (const good of ["a.txt", "dir/a b.txt", "src/.gitignore", "é/ü.js", ".github/ci.yml", "a..b/c", "...x"]) assert.equal(rules.safeRelative(good), true, good);
  for (const bad of ["", "/etc/passwd", "../x", "a/../../x", "a/./b", "a//b", ".git/config", "a/.GIT/hooks/x", "a\\b", "C:/x", "file.txt:stream", "a\nb", "a\0b", "dir./x", "name ", "x".repeat(1100), null, 5]) assert.equal(rules.safeRelative(bad), false, JSON.stringify(bad));
});

// ---- what a revert may do ---------------------------------------------------------------------
const entry = (over) => ({ status: "modified", path: "a.txt", oldPath: null, oldBlob: SHA(1), newBlob: SHA(2), oldMode: "100644", newMode: "100644", kind: "file", ...over });
const held = (map) => Object.fromEntries(Object.entries(map).map(([name, blob]) => [name, { blob }]));

test("a modified file is put back only while it still holds what the attempt left", () => {
  const entries = [entry()];
  const back = rules.planRevert({ entries, scope: "attempt", current: held({ "a.txt": SHA(2) }) });
  assert.equal(back.ok, true);
  assert.deepEqual(back.restore, [{ path: "a.txt", action: "write", blob: SHA(1), mode: 0o644 }]);
  const edited = rules.planRevert({ entries, scope: "attempt", current: held({ "a.txt": SHA(7) }) });
  assert.equal(edited.ok, false);
  assert.deepEqual(edited.restore, [], "an edited file is never overwritten");
  assert.deepEqual(edited.refused, [{ path: "a.txt", reason: "changed-since" }]);
  assert.match(edited.message, /^Nothing was reverted\. 1 file has changed since the attempt ended: a\.txt\. Studio does not overwrite work it did not make\.$/);
  const already = rules.planRevert({ entries, scope: "attempt", current: held({ "a.txt": SHA(1) }) });
  assert.equal(already.ok, true);
  assert.deepEqual(already.restore, []);
  assert.deepEqual(already.already, ["a.txt"], "a file already as before needs nothing");
  const gone = rules.planRevert({ entries, scope: "attempt", current: held({ "a.txt": null }) });
  assert.equal(gone.ok, false, "a file someone deleted since is theirs");
  assert.equal(gone.refused[0].reason, "changed-since");
  assert.equal(rules.planRevert({ entries, scope: "attempt", current: {} }).refused[0].reason, "unknown", "a file nobody looked at is not touched");
});

test("a file the attempt added is removed only while it is still the copy the attempt left", () => {
  const entries = [entry({ status: "added", oldBlob: null, oldMode: "000000", path: "new.txt" })];
  assert.deepEqual(rules.planRevert({ entries, scope: "attempt", current: held({ "new.txt": SHA(2) }) }).restore, [{ path: "new.txt", action: "delete" }]);
  assert.deepEqual(rules.planRevert({ entries, scope: "attempt", current: held({ "new.txt": null }) }).already, ["new.txt"]);
  const edited = rules.planRevert({ entries, scope: "attempt", current: held({ "new.txt": SHA(9) }) });
  assert.equal(edited.ok, false);
  assert.equal(edited.refused[0].reason, "changed-since", "a file the attempt made and someone kept editing stays");
});

test("a file the attempt deleted comes back only where nothing else has taken its place", () => {
  const entries = [entry({ status: "deleted", newBlob: null, newMode: "000000", path: "old.txt", oldMode: "100755" })];
  assert.deepEqual(rules.planRevert({ entries, scope: "attempt", current: held({ "old.txt": null }) }).restore, [{ path: "old.txt", action: "write", blob: SHA(1), mode: 0o755 }]);
  assert.deepEqual(rules.planRevert({ entries, scope: "attempt", current: held({ "old.txt": SHA(1) }) }).already, ["old.txt"]);
  assert.equal(rules.planRevert({ entries, scope: "attempt", current: held({ "old.txt": SHA(5) }) }).refused[0].reason, "changed-since");
});

test("a rename is undone both ways, and a half-edited pair is refused whole", () => {
  const entries = [entry({ status: "renamed", path: "sub/c2.txt", oldPath: "sub/c.txt", oldBlob: SHA(1), newBlob: SHA(1) })];
  const plan = rules.planRevert({ entries, scope: "attempt", current: held({ "sub/c2.txt": SHA(1), "sub/c.txt": null }) });
  assert.deepEqual(plan.restore, [{ path: "sub/c.txt", action: "write", blob: SHA(1), mode: 0o644 }, { path: "sub/c2.txt", action: "delete" }], "the old name is written before the new one goes");
  assert.deepEqual(rules.planRevert({ entries, scope: "attempt", current: held({ "sub/c2.txt": null, "sub/c.txt": SHA(1) }) }).already, ["sub/c2.txt"]);
  const taken = rules.planRevert({ entries, scope: "attempt", current: held({ "sub/c2.txt": SHA(1), "sub/c.txt": SHA(6) }) });
  assert.equal(taken.ok, false);
  assert.deepEqual(taken.refused, [{ path: "sub/c.txt", reason: "changed-since" }], "the old name now holds something else");
  assert.deepEqual(taken.restore, []);
  const editedNew = rules.planRevert({ entries, scope: "attempt", current: held({ "sub/c2.txt": SHA(4), "sub/c.txt": null }) });
  assert.deepEqual(editedNew.refused.map((row) => row.path), ["sub/c2.txt"]);
});

test("one file's revert names only that file, and a rename is chosen by either of its names", () => {
  const entries = [entry({ path: "a.txt" }), entry({ path: "b.txt", oldBlob: SHA(3), newBlob: SHA(4) }), entry({ status: "renamed", path: "new.txt", oldPath: "old.txt" })];
  const current = held({ "a.txt": SHA(2), "b.txt": SHA(4), "new.txt": SHA(2), "old.txt": null });
  const one = rules.planRevert({ entries, scope: "file", path: "b.txt", current });
  assert.deepEqual(one.restore, [{ path: "b.txt", action: "write", blob: SHA(3), mode: 0o644 }]);
  const viaOld = rules.planRevert({ entries, scope: "file", path: "old.txt", current });
  assert.deepEqual(viaOld.restore.map((step) => step.path), ["old.txt", "new.txt"]);
  const stranger = rules.planRevert({ entries, scope: "file", path: "README.md", current: held({ "README.md": SHA(1) }) });
  assert.equal(stranger.ok, false);
  assert.deepEqual(stranger.restore, [], "a file outside the attempt's change set is never named");
  assert.equal(stranger.refused[0].reason, "not-in-attempt");
  assert.equal(rules.planRevert({ entries, scope: "everything", current }).ok, false);
});

test("a whole-attempt revert with one changed file changes nothing; partial puts back the rest and says what it left", () => {
  const entries = [entry({ path: "a.txt" }), entry({ path: "b.txt" }), entry({ path: "c.txt" })];
  const current = held({ "a.txt": SHA(2), "b.txt": SHA(8), "c.txt": SHA(2) });
  const whole = rules.planRevert({ entries, scope: "attempt", current });
  assert.equal(whole.ok, false);
  assert.deepEqual(whole.restore, []);
  assert.deepEqual(whole.refused.map((row) => row.path), ["b.txt"]);
  const partial = rules.planRevert({ entries, scope: "attempt", current, partial: true });
  assert.equal(partial.ok, true);
  assert.deepEqual(partial.restore.map((step) => step.path), ["a.txt", "c.txt"]);
  assert.match(partial.message, /^2 put back\. 1 file was left alone because it changed since the attempt ended: b\.txt\.$/);
  const allRefused = rules.planRevert({ entries: [entries[1]], scope: "attempt", current, partial: true });
  assert.equal(allRefused.ok, false, "a partial revert with nothing safe to do is not a success");
});

test("links, submodules, type changes and unsafe names are never written", () => {
  const link = entry({ path: "link", kind: "symlink" });
  assert.equal(rules.planRevert({ entries: [link], scope: "attempt", current: held({ link: SHA(2) }) }).refused[0].reason, "unsupported");
  assert.equal(rules.planRevert({ entries: [link], scope: "attempt", current: held({ link: SHA(2) }), symlinks: true }).ok, true, "a link is put back where the platform makes them");
  assert.equal(rules.planRevert({ entries: [entry({ path: "vendor", kind: "submodule" })], scope: "attempt", current: held({ vendor: SHA(2) }), symlinks: true }).refused[0].reason, "unsupported");
  assert.equal(rules.planRevert({ entries: [entry({ typeChanged: true })], scope: "attempt", current: held({ "a.txt": SHA(2) }) }).refused[0].reason, "unsupported");
  const unsafe = rules.planRevert({ entries: [entry({ path: "../../etc/x" }), entry({ path: ".git/hooks/pre-commit" })], scope: "attempt", current: {} });
  assert.deepEqual(unsafe.refused.map((row) => row.reason), ["unsafe-name", "unsafe-name"]);
  assert.deepEqual(unsafe.restore, []);
});

test("writes come before deletes, and a huge attempt is refused rather than half-done", () => {
  const entries = [entry({ status: "added", path: "z-new.txt", oldBlob: null }), entry({ path: "a.txt" })];
  const plan = rules.planRevert({ entries, scope: "attempt", current: held({ "z-new.txt": SHA(2), "a.txt": SHA(2) }) });
  assert.deepEqual(plan.restore.map((step) => step.action), ["write", "delete"]);
  const big = Array.from({ length: rules.LIMITS.revertFiles + 1 }, (_, index) => entry({ path: `f${index}.txt` }));
  const refusal = rules.planRevert({ entries: big, scope: "attempt", current: {} });
  assert.equal(refusal.ok, false);
  assert.equal(refusal.refused[0].reason, "too-many");
  assert.match(refusal.message, /more than Studio puts back at once/);
});

test("read the other way, a change set undoes a revert: added files come back, restored ones go, edits return", () => {
  const entries = [
    entry({ path: "mod.txt", oldBlob: SHA(1), newBlob: SHA(2) }),
    entry({ status: "added", path: "new.txt", oldBlob: null, newBlob: SHA(3), oldMode: "000000", newMode: "100644" }),
    entry({ status: "deleted", path: "gone.txt", oldBlob: SHA(4), newBlob: null, oldMode: "100644", newMode: "000000" }),
    entry({ status: "renamed", path: "n.txt", oldPath: "o.txt", oldBlob: SHA(5), newBlob: SHA(5) }),
  ];
  const inverse = rules.invertEntries(entries);
  assert.deepEqual(inverse.map((item) => [item.status, item.path, item.oldPath]), [["modified", "mod.txt", null], ["deleted", "new.txt", null], ["added", "gone.txt", null], ["renamed", "o.txt", "n.txt"]]);
  // After the revert: mod.txt holds the earlier copy (1), new.txt is gone, gone.txt is back (4), o.txt is back and n.txt is gone.
  const plan = rules.planRevert({ entries: inverse, scope: "attempt", current: held({ "mod.txt": SHA(1), "new.txt": null, "gone.txt": SHA(4), "o.txt": SHA(5), "n.txt": null }) });
  assert.equal(plan.ok, true, plan.message);
  assert.deepEqual(plan.restore.map((step) => `${step.action}:${step.path}`).sort(), ["delete:gone.txt", "delete:o.txt", "write:mod.txt", "write:n.txt", "write:new.txt"]);
  assert.equal(plan.restore.find((step) => step.path === "mod.txt").blob, SHA(2), "the attempt's own copy is what returns");
  assert.deepEqual(rules.invertEntries(null), []);
});

test("the words the page shows for a refusal and for a folder with no snapshots", () => {
  assert.match(rules.refusalSentence([{ path: "a", reason: "changed-since" }, { path: "b", reason: "changed-since" }]), /^Nothing was reverted\. 2 files have changed since the attempt ended: a, b\./);
  assert.match(rules.refusalSentence([{ path: "l", reason: "unsupported" }]), /a problem \(not a plain file\): l\./);
  assert.match(rules.refusalSentence(Array.from({ length: 8 }, (_, index) => ({ path: `f${index}`, reason: "changed-since" }))), /f0, f1, f2, f3, f4 and 3 more\./);
  assert.equal(rules.refusalSentence([]), "");
  for (const reason of ["off", "not-a-repo", "nested", "git-missing", "too-many", "unreadable"]) assert.match(rules.unavailable(reason), /\.$/, reason);
  assert.match(rules.unavailable("not-a-repo"), /not a Git repository/);
  assert.equal(rules.unavailable("something else"), rules.unavailable("unreadable"));
});
