import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { cascadeEquivalence, mergeResolution } from "../scripts/check-css.mjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(STUDIO, "scripts", "check-css.mjs");
const execFileP = promisify(execFile);

const BASE = ".card { color: black; padding: 4px; }\n.title { font-weight: bold; }\n";
const oursChange = BASE.replace("color: black;", "color: navy;");
const theirsChange = BASE.replace("padding: 4px;", "padding: 8px;");

test("mergeResolution: a resolution honoring both one-sided changes is clean", () => {
  const both = ".card { color: navy; padding: 8px; }\n.title { font-weight: bold; }\n";
  const { problems, decisions, diverged } = mergeResolution(BASE, oursChange, theirsChange, both);
  assert.equal(problems.length, 0);
  assert.equal(decisions.length, 0);
  assert.deepEqual(diverged, { ours: 1, theirs: 1 });
});

test("mergeResolution: reverting a one-sided change to the base value is a dropped winner", () => {
  const { problems } = mergeResolution(BASE, oursChange, theirsChange, BASE);
  assert.equal(problems.length, 2);
  assert.ok(problems.every((p) => p.kind === "dropped"));
  assert.deepEqual(new Set(problems.map((p) => p.side)), new Set(["ours", "theirs"]));
});

test("mergeResolution: a one-sided new winner must survive the resolution", () => {
  const oursAdded = oursChange + ".ours-only { top: 1px; }\n";
  const combined = ".card { color: navy; padding: 8px; }\n.title { font-weight: bold; }\n.ours-only { top: 1px; }\n";
  const kept = mergeResolution(BASE, oursAdded, theirsChange, combined);
  assert.equal(kept.problems.length, 0);
  const dropped = mergeResolution(BASE, oursAdded, theirsChange, combined.replace(".ours-only { top: 1px; }\n", ""));
  assert.equal(dropped.problems.length, 1);
  const hit = dropped.problems.find((p) => p.key.includes("ours-only"));
  assert.equal(hit.kind, "dropped");
  assert.equal(hit.side, "ours");
});

test("mergeResolution: a one-sided deletion must stay deleted", () => {
  const theirsDeleted = BASE.replace(".title { font-weight: bold; }\n", "");
  const honored = mergeResolution(BASE, oursChange, theirsDeleted, oursChange.replace(".title { font-weight: bold; }\n", ""));
  assert.equal(honored.problems.length, 0);
  const revived = mergeResolution(BASE, oursChange, theirsDeleted, oursChange);
  assert.equal(revived.problems.length, 1);
  assert.equal(revived.problems[0].kind, "undeleted");
  assert.equal(revived.problems[0].side, "theirs");
});

test("mergeResolution: both sides changing one key may pick either value, not the base", () => {
  const theirsToo = BASE.replace("color: black;", "color: teal;");
  const pickedOurs = mergeResolution(BASE, oursChange, theirsToo, oursChange);
  assert.equal(pickedOurs.problems.length, 0);
  assert.deepEqual(pickedOurs.decisions, [{ key: pickedOurs.decisions[0].key, picked: "ours", value: "navy" }]);
  const pickedTheirs = mergeResolution(BASE, oursChange, theirsToo, theirsToo);
  assert.equal(pickedTheirs.problems.length, 0);
  assert.equal(pickedTheirs.decisions[0].picked, "theirs");
  const pickedBase = mergeResolution(BASE, oursChange, theirsToo, BASE);
  assert.equal(pickedBase.problems.length, 1);
  assert.equal(pickedBase.problems[0].kind, "unresolved");
});

test("mergeResolution: both sides making the same change must keep it", () => {
  const same = BASE.replace("padding: 4px;", "padding: 8px;");
  const kept = mergeResolution(BASE, same, theirsChange, same);
  assert.equal(kept.problems.length, 0);
  const lost = mergeResolution(BASE, same, theirsChange, BASE);
  assert.equal(lost.problems.length, 1);
  assert.equal(lost.problems[0].kind, "unresolved");
});

test("mergeResolution: keys untouched by both sides are out of scope", () => {
  const untouchedEdit = ".card { color: navy; padding: 8px; }\n.title { font-weight: normal; }\n";
  const { problems, diverged } = mergeResolution(BASE, oursChange, theirsChange, untouchedEdit);
  assert.equal(problems.length, 0);
  assert.deepEqual(diverged, { ours: 1, theirs: 1 });
});

test("mergeResolution: a CRLF working-copy resolution against LF git sides stays clean (autocrlf)", () => {
  const bothCrlf = ".card { color: navy; padding: 8px; }\r\n.title { font-weight: bold; }\r\n";
  const clean = mergeResolution(BASE, oursChange, theirsChange, bothCrlf);
  assert.equal(clean.problems.length, 0);
  const revertedCrlf = bothCrlf.replace("color: navy;", "color: black;").replace("padding: 8px;", "padding: 4px;");
  const reverted = mergeResolution(BASE, oursChange, theirsChange, revertedCrlf);
  assert.equal(reverted.problems.length, 2);
  assert.ok(reverted.problems.every((p) => p.kind === "dropped"));
});

test("CLI --merge: honors a real conflicted-merge resolution, then flags a reverted one", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "check-css-merge-"));
  const sheet = path.join(dir, "styles.css");
  const git = (...args) => execFileP("git", ["-c", "user.email=studio@example.com", "-c", "user.name=Studio Test", ...args], { cwd: dir });
  const run = (args) => execFileP(process.execPath, [CLI, ...args], { cwd: dir }).catch((err) => err);
  try {
    await writeFile(sheet, BASE);
    await git("init", "-q", "-b", "main");
    await git("add", "-A");
    await git("commit", "-q", "-m", "base");
    await git("checkout", "-q", "-b", "side");
    await writeFile(sheet, theirsChange);
    await git("add", "-A");
    await git("commit", "-q", "-m", "theirs");
    await git("checkout", "-q", "main");
    await writeFile(sheet, oursChange);
    await git("add", "-A");
    await git("commit", "-q", "-m", "ours");
    await git("merge", "side").catch(() => {});
    const conflicted = await run(["--merge", "styles.css"]);
    assert.equal(conflicted.code ?? 0, 1);
    assert.match(conflicted.stdout, /MERGE-CSS-CONFLICT: conflict markers/);

    await writeFile(sheet, ".card { color: navy; padding: 8px; }\n.title { font-weight: bold; }\n");
    const ok = await run(["--merge", "styles.css"]);
    assert.equal(ok.code ?? 0, 0);
    assert.match(ok.stdout, /MERGE-CSS: styles\.css base=[0-9a-f]{8} ours=HEAD theirs=[0-9a-f]{8}/);
    assert.match(ok.stdout, /MERGE-CSS-RESOLVED: resolution honors every diverged winner \(ours 1, theirs 1/);

    await writeFile(sheet, BASE);
    const reverted = await run(["--merge", "styles.css"]);
    assert.equal(reverted.code, 1);
    assert.match(reverted.stdout, /MERGE-LOST ours winner "\.card##color##-"/);
    assert.match(reverted.stdout, /MERGE-LOST theirs winner "\.card##padding##-"/);
    assert.match(reverted.stdout, /MERGE-CSS-CONFLICT: 2 diverged winner key\(s\)/);

    await git("merge", "--abort");
    await writeFile(sheet, ".card { color: navy; padding: 8px; }\n.title { font-weight: bold; }\n");
    const explicit = await run(["--merge", "--theirs", "side", "styles.css"]);
    assert.equal(explicit.code ?? 0, 0);
    assert.match(explicit.stdout, /ours=HEAD theirs=side/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI --merge: no merge in progress is a skip with exit 0", async () => {
  const res = await execFileP(process.execPath, [CLI, "--merge"], { cwd: STUDIO }).catch((err) => err);
  assert.equal(res.code ?? 0, 0);
  assert.match(res.stdout, /MERGE-CSS-SKIP: no merge in progress/);
});

test("CLI --merge: merge mode coexists with the two-way cascadeEquivalence check", async () => {
  const { problems } = cascadeEquivalence(BASE, BASE);
  assert.equal(problems.length, 0);
});
