import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { groupBoardDirectory } from "../scripts/group-board.mjs";

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "studio-group-board-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const tasks = [
    { id: "one", title: "Guard retries", prompt: "Preserve the last acceptance check.", status: "open", acceptance: ["Original criterion"] },
    { id: "two", title: "Test retries", prompt: "Test the existing retry path.", status: "open" },
    { id: "busy", title: "Active task", status: "active", runId: "owned-run" },
  ];
  const ideas = [{ id: "idea", title: "Guard retries", taskId: "one", status: "planned" }];
  await writeFile(path.join(dataDir, "eyes-tasks.json"), JSON.stringify(tasks));
  await writeFile(path.join(dataDir, "eyes-feature-ideas.json"), JSON.stringify(ideas));
  const groups = [{ title: "Retry safeguards", taskIds: ["one", "two"], tasks: ["Guard retries", "Test retries"] }];
  return { dataDir, tasks, ideas, groups, assertIdle: () => {}, now: 1_000_000 };
}

test("offline grouping previews without writes and applies with exact backups, preserved work and history", async (t) => {
  const input = await fixture(t);
  const before = await readFile(path.join(input.dataDir, "eyes-tasks.json"), "utf8");
  const preview = await groupBoardDirectory(input);
  assert.equal(preview.before, 3);
  assert.equal(preview.after, 2);
  assert.equal(preview.absorbed, 2);
  assert.equal(preview.applied, false);
  assert.deepEqual((await readdir(input.dataDir)).sort(), ["eyes-feature-ideas.json", "eyes-tasks.json"]);
  const applied = await groupBoardDirectory({ ...input, apply: true });
  assert.equal(applied.applied, true);
  assert.equal(await readFile(path.join(applied.backup, "eyes-tasks.json"), "utf8"), before);
  const rows = JSON.parse(await readFile(path.join(input.dataDir, "eyes-tasks.json"), "utf8"));
  const plan = rows.find((row) => row.members);
  assert.equal(plan.members[0].prompt, input.tasks[0].prompt);
  assert.deepEqual(plan.members[0].acceptance, input.tasks[0].acceptance);
  const original = rows.find((row) => row.id === "one");
  assert.equal(original.status, "absorbed");
  assert.equal(original.absorbedInto, plan.id);
  assert.equal(original.contextHistory.entries[0].snapshot.status, "open");
  assert.deepEqual(rows.find((row) => row.id === "busy"), input.tasks[2]);
  const ideas = JSON.parse(await readFile(path.join(input.dataDir, "eyes-feature-ideas.json"), "utf8"));
  assert.equal(ideas[0].taskId, plan.id);
  const repeated = await groupBoardDirectory({ ...input, apply: true });
  assert.equal(repeated.absorbed, 0);
  assert.equal(repeated.applied, false);
});

test("offline grouping refuses running writers and changes between inspection and apply", async (t) => {
  const input = await fixture(t);
  await assert.rejects(groupBoardDirectory({ ...input, apply: true, assertIdle: () => { throw new Error("Studio is running"); } }), /Studio is running/);
  let checks = 0;
  const latest = [...input.tasks, { id: "new", title: "New user request", status: "open" }];
  await assert.rejects(groupBoardDirectory({ ...input, apply: true, assertIdle: async () => {
    if (++checks === 2) await writeFile(path.join(input.dataDir, "eyes-tasks.json"), JSON.stringify(latest));
  } }), /Board changed during preview/);
  assert.deepEqual(JSON.parse(await readFile(path.join(input.dataDir, "eyes-tasks.json"), "utf8")), latest);
  assert.equal((await readdir(input.dataDir)).includes("board-group-backups"), false);
});

test("reviewed IDs, source fingerprint and malformed stores cannot silently select changed scope", async (t) => {
  const input = await fixture(t);
  await assert.rejects(groupBoardDirectory({ ...input, expectedHash: "wrong" }), /Board changed since/);
  await assert.rejects(groupBoardDirectory({ ...input, groups: [{ ...input.groups[0], taskIds: ["wrong", "two"] }] }), /Reviewed task wrong changed/);
  await writeFile(path.join(input.dataDir, "eyes-feature-ideas.json"), "{}");
  await assert.rejects(groupBoardDirectory({ ...input, apply: true }), /must contain an array/);
  assert.deepEqual(JSON.parse(await readFile(path.join(input.dataDir, "eyes-tasks.json"), "utf8")), input.tasks);
});
