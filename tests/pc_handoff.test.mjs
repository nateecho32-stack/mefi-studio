import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const handoff = require("../scripts/pc-handoff.cjs");

const NOW = Date.UTC(2026, 9, 6, 14, 2);

// The injected git: a real git, no global config, a fixed identity.
function git(args, { cwd, env = {}, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd, windowsHide: true,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ...env },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}
const ok = async (args, cwd) => {
  const result = await git(args, { cwd });
  assert.equal(result.code, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
};

async function world() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pc-handoff-"));
  const remote = path.join(dir, "remote.git"), laptop = path.join(dir, "laptop"), desk = path.join(dir, "desk");
  await ok(["init", "--bare", "-b", "main", remote], dir);
  await ok(["clone", remote, laptop], dir);
  for (const [key, value] of [["core.autocrlf", "false"], ["user.name", "t"], ["user.email", "t@t"]]) await ok(["config", key, value], laptop);
  await writeFile(path.join(laptop, "a.js"), "one\n");
  await writeFile(path.join(laptop, "b.js"), "keep\n");
  await ok(["add", "."], laptop);
  await ok(["commit", "-m", "base"], laptop);
  await ok(["push", "origin", "main"], laptop);
  await ok(["clone", remote, desk], dir);
  await ok(["config", "core.autocrlf", "false"], desk);
  return { dir, remote, laptop, desk, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const meta = { v: 1, pc: "pc-laptop", pcName: "Laptop", why: "battery", level: 9, at: NOW, project: "game", tasks: [{ id: "task_1", title: "Fix the header", prompt: "Make the header sticky.", note: "Half done: CSS written, JS left." }] };

test("branch names and the message's trailer round-trip", () => {
  assert.equal(handoff.branchName("Echo's Laptop", NOW), "mefi/handoff/echo-s-laptop-20261006-1402");
  assert.equal(handoff.branchName("Laptop", NOW, ["mefi/handoff/laptop-20261006-1402"]), "mefi/handoff/laptop-20261006-1402-2");
  const text = handoff.message({ ...meta, base: "a".repeat(40) });
  assert.match(text, /^Handoff: Fix the header\n\nParked by Laptop at 9% battery, 2026-10-06 14:02 UTC/);
  assert.equal(handoff.parseMessage(text).tasks[0].prompt, "Make the header sticky.");
  assert.equal(handoff.parseMessage("just a commit"), null);
  assert.throws(() => handoff.message({ v: 1, tasks: [] }));
});

test("park pushes a branch and leaves the PC's own tree, index and HEAD alone", async () => {
  const w = await world();
  try {
    await writeFile(path.join(w.laptop, "a.js"), "two\n");
    await writeFile(path.join(w.laptop, "new.js"), "fresh\n");
    await writeFile(path.join(w.laptop, "mine.js"), "the owner's own edit\n");
    await unlink(path.join(w.laptop, "b.js"));
    await ok(["add", "mine.js"], w.laptop);
    const statusBefore = await ok(["status", "--porcelain"], w.laptop);
    const headBefore = await ok(["rev-parse", "HEAD"], w.laptop);
    const branch = handoff.branchName("Laptop", NOW);
    const gitDir = path.join(w.laptop, ".git");
    const parked = await handoff.park({ git, root: w.laptop, files: ["a.js", "new.js", "b.js", "../outside.js"], meta, branch, indexFile: handoff.indexPath(gitDir, NOW) });
    assert.equal(parked.ok, true, parked.error);
    assert.equal(parked.files, 3);
    assert.equal(await ok(["status", "--porcelain"], w.laptop), statusBefore);
    assert.equal(await ok(["rev-parse", "HEAD"], w.laptop), headBefore);
    // On GitHub: the three files changed, the owner's own edit is not there.
    const listed = await handoff.list({ git, root: w.desk });
    assert.deepEqual(listed.branches, [{ branch, sha: parked.sha }]);
    const names = await ok(["diff", "--name-status", headBefore, parked.sha], w.laptop);
    assert.deepEqual(names.split("\n").sort(), ["A\tnew.js", "D\tb.js", "M\ta.js"]);
    // Nothing changed: nothing parked.
    const empty = await handoff.park({ git, root: w.desk, files: ["a.js"], meta, branch: `${branch}-2`, indexFile: path.join(w.desk, ".git", "x.idx") });
    assert.equal(empty.empty, true);
  } finally {
    await w.cleanup();
  }
});

test("pick up claims the branch once and applies it to the other PC's tree", async () => {
  const w = await world();
  try {
    await writeFile(path.join(w.laptop, "a.js"), "two\n");
    const branch = handoff.branchName("Laptop", NOW);
    const parked = await handoff.park({ git, root: w.laptop, files: ["a.js"], meta, branch, indexFile: path.join(w.laptop, ".git", "h.idx") });
    const read = await handoff.read({ git, root: w.desk, branch, sha: parked.sha });
    assert.equal(read.meta.tasks[0].title, "Fix the header");
    assert.equal(read.meta.files.join(), "a.js");
    const taken = await handoff.pickUp({ git, root: w.desk, branch, sha: parked.sha });
    assert.equal(taken.ok, true, taken.error);
    assert.equal(await readFile(path.join(w.desk, "a.js"), "utf8"), "two\n");
    // Applied to the working tree only: nothing staged on the desk.
    assert.equal(await ok(["diff", "--cached", "--name-only"], w.desk), "");
    assert.deepEqual((await handoff.list({ git, root: w.desk })).branches, []);
    // A second PC cannot take it again.
    const again = await handoff.pickUp({ git, root: w.laptop, branch, sha: parked.sha });
    assert.equal(again.ok, false);
  } finally {
    await w.cleanup();
  }
});

test("a handoff that clashes with this PC's files stays on GitHub", async () => {
  const w = await world();
  try {
    await writeFile(path.join(w.laptop, "a.js"), "two\n");
    const branch = handoff.branchName("Laptop", NOW);
    const parked = await handoff.park({ git, root: w.laptop, files: ["a.js"], meta, branch, indexFile: path.join(w.laptop, ".git", "h.idx") });
    await writeFile(path.join(w.desk, "a.js"), "the desk's own edit\n");
    const taken = await handoff.pickUp({ git, root: w.desk, branch, sha: parked.sha });
    assert.equal(taken.ok, false);
    assert.match(taken.error, /do not apply here/);
    assert.equal(await readFile(path.join(w.desk, "a.js"), "utf8"), "the desk's own edit\n");
    assert.equal((await handoff.list({ git, root: w.desk })).branches.length, 1);
    // Drop needs the exact commit.
    assert.equal((await handoff.drop({ git, root: w.desk, branch, sha: "b".repeat(40) })).ok, false);
    assert.equal((await handoff.drop({ git, root: w.desk, branch, sha: parked.sha })).ok, true);
    assert.equal((await handoff.list({ git, root: w.desk })).branches.length, 0);
  } finally {
    await w.cleanup();
  }
});
