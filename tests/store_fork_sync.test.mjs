import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "reconcile-store-fork.mjs");

const makeStore = (dir, { tasks, requests, ideas }) => {
  writeFileSync(path.join(dir, "eyes-tasks.json"), JSON.stringify(tasks, null, 2));
  writeFileSync(path.join(dir, "eyes-requests.json"), JSON.stringify(requests ?? [], null, 2));
  writeFileSync(path.join(dir, "eyes-feature-ideas.json"), JSON.stringify(ideas, null, 2));
};
const readStore = (dir) => ({
  tasks: JSON.parse(readFileSync(path.join(dir, "eyes-tasks.json"), "utf8")),
  ideas: JSON.parse(readFileSync(path.join(dir, "eyes-feature-ideas.json"), "utf8")),
});
const run = (source, target, ...extra) => execFileSync(process.execPath, [SCRIPT, `--source=${source}`, `--target=${target}`, ...extra], { encoding: "utf8" });

// The authoritative board holds a drained row whose detail trips the
// ingestion chat-noise gate ("contract tests pass") — a sync of committed
// work must still land it, while an undrained narration artifact must not.
const sourceIdeas = [
  { id: "idea_src_drained", title: "Register the world composition check", detail: "Add the check to test_sets after contract tests pass.", status: "planned", taskId: "task_src_0", at: 1 },
  { id: "idea_src_keep", title: "Live co-editing presence UI", detail: "Studio shows which sessions edit the same files.", status: "keep", at: 2 },
  { id: "idea_src_noise", title: "Okay so the tests pass now", detail: "everything is green", status: "new", at: 3 },
];
const sourceTasks = [
  { id: "task_src_0", title: "Register the world composition check", status: "open", ideas: ["idea_src_drained"], runId: "run_other_board", lease: { pid: 1 } },
];
const targetTasks = Array.from({ length: 4 }, (_, index) => ({ id: `busy_${index}`, title: `Busy work ${index}`, status: "open", createdAt: 1 }));
const targetIdeas = [{ id: "idea_tgt_existing", title: "Existing obligation", detail: "Keep exactly as saved.", status: "keep", at: 9 }];

test("store-fork sync copies drained ideas plus their task rows, keeps links resolvable, and is idempotent", () => {
  const root = mkdtempSync(path.join(tmpdir(), "store-fork-"));
  try {
    const source = path.join(root, "src"), target = path.join(root, "tgt");
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    makeStore(source, { tasks: sourceTasks, ideas: sourceIdeas });
    makeStore(target, { tasks: targetTasks, ideas: targetIdeas });
    const out = run(source, target);
    assert.match(out, /ideas: 2 missing idea/);
    assert.match(out, /tasks: 1 drained task row/);
    assert.match(out, /no room; keep\/unlinked ideas stay/);
    const { tasks, ideas } = readStore(target);
    assert.equal(tasks.length, 5);
    const copied = tasks.find((row) => row.id === "task_src_0");
    assert.ok(copied, "drained task row copied");
    assert.equal(copied.runId, undefined, "transient run telemetry does not cross stores");
    assert.equal(copied.lease, undefined);
    assert.equal(ideas.length, 3, "two additions plus the untouched existing row");
    const drained = ideas.find((row) => row.id === "idea_src_drained");
    assert.equal(drained.status, "planned");
    assert.ok(tasks.some((row) => row.id === drained.taskId), "copied link resolves on the target board");
    assert.equal(ideas.find((row) => row.id === "idea_src_noise"), undefined, "undrained narration artifacts still refuse to sync");
    assert.deepEqual(ideas.find((row) => row.id === "idea_tgt_existing"), targetIdeas[0], "existing rows pass through untouched");
    const kept = ideas.find((row) => row.id === "idea_src_keep");
    assert.equal(kept.status, "keep");
    assert.equal(kept.taskId, undefined, "keep rows wait for the queue, they are not copied");
    const again = run(source, target);
    assert.match(again, /nothing changed — nothing written\./);
    assert.deepEqual(readStore(target), { tasks, ideas }, "a second pass is a no-op");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("with queue room the pass drains keep ideas through the app's own admission rule", () => {
  const root = mkdtempSync(path.join(tmpdir(), "store-fork-room-"));
  try {
    const source = path.join(root, "src"), target = path.join(root, "tgt");
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    makeStore(source, { tasks: [], ideas: [] });
    makeStore(target, { tasks: [{ id: "done_old", title: "Finished", status: "done", doneAt: 1 }], ideas: [targetIdeas[0], sourceIdeas[1]] });
    const out = run(source, target);
    assert.match(out, /drain: 2 idea\(s\) admitted through the admitBacklogIdeas path/);
    const { tasks, ideas } = readStore(target);
    for (const id of ["idea_src_keep", "idea_tgt_existing"]) {
      const drained = ideas.find((row) => row.id === id);
      assert.equal(drained.status, "planned", `${id} drained`);
      const task = tasks.find((row) => row.id === drained.taskId);
      assert.ok(task, "drained idea points at a real task");
      assert.equal(task.source, "idea");
      assert.deepEqual(task.ideas, [id]);
    }
    assert.ok(run(source, target).includes("nothing changed"), "drain does not re-fire");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit --promote drains one named idea through the app's promote arm despite a saturated queue", () => {
  const root = mkdtempSync(path.join(tmpdir(), "store-fork-promote-"));
  try {
    const source = path.join(root, "src"), target = path.join(root, "tgt");
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    makeStore(source, { tasks: [], ideas: [] });
    makeStore(target, { tasks: targetTasks, ideas: [targetIdeas[0], sourceIdeas[1]] });
    const out = run(source, target, "--promote=idea_src_keep");
    assert.match(out, /explicit promote arm for idea_src_keep bypasses the queue gate/);
    assert.match(out, /drain: 1 idea\(s\) admitted through the admitBacklogIdeas path/);
    const { tasks, ideas } = readStore(target);
    const drained = ideas.find((row) => row.id === "idea_src_keep");
    assert.equal(drained.status, "planned", "the named idea drained");
    const task = tasks.find((row) => row.id === drained.taskId);
    assert.ok(task, "drained idea points at a real task");
    assert.equal(task.source, "idea");
    assert.deepEqual(task.ideas, ["idea_src_keep"]);
    const untouched = ideas.find((row) => row.id === "idea_tgt_existing");
    assert.equal(untouched.status, "keep", "the saturation rule still holds for every other keep row");
    assert.equal(untouched.taskId, undefined);
    assert.equal(tasks.length, 5, "four busy rows plus the one promoted task");
    assert.ok(run(source, target, "--promote=idea_src_keep").includes("nothing changed"), "a repeat promote is a no-op");
    const absent = run(source, target, "--promote=idea_missing");
    assert.match(absent, /not an eligible keep\/new unlinked idea/);
    assert.ok(absent.includes("nothing changed"), "an ineligible id writes nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
