// One-shot store-fork reconciliation. The repo working copy (data/) and the
// installed app (dist/<product>/resources/app/data) hold two separate boards
// on purpose (see AGENTS.md: both stores are preserved, never merged away).
// When ideas are promoted in one workspace the other fork misses the rows, so
// this pass syncs the missing slice INTO a target store using Studio's own
// helpers — never a hand-rewritten store:
//   * idea additions reuse the app's identity keys for dedupe (mergeIdeas'
//     rules, minus the ingestion-only chat-noise gate);
//   * each copied idea's drained task row is copied additively so every
//     idea→task link resolves (no dangling links, no touching existing rows);
//   * ideas that exist in the target but sit `keep`/unlinked are NOT copied —
//     they are drained through promoteIdeaBacklog, the pure core of main.cjs
//     admitBacklogIdeas, and only when the target queue has room, using the
//     app's exact admission rule (limit = max(0, 3 - occupied)).
// Both sides are read fresh, additions are id-skipped, and nothing existing is
// deleted or reordered. Run at idle time: the owning app re-reads these files
// before every write, but a mid-pass write by the app is the one interleaving
// plain-file mode cannot fence (same caveat as reconcile-board.mjs --data).
//
// Usage:
//   node scripts/reconcile-store-fork.mjs            # apply + write back
//   node scripts/reconcile-store-fork.mjs --dry-run  # report only
//   node scripts/reconcile-store-fork.mjs --source=<dir> --target=<dir>

import path from "node:path";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readJson, writeJson } from "./eyes.mjs";
import { ideaIdentityKeys, isExtractionArtifact, promoteIdeaBacklog } from "./assistant.mjs";
import backlog from "./backlog.cjs";

const STUDIO_ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, "");
const dryRun = process.argv.includes("--dry-run");
const argDir = (name) => {
  const arg = process.argv.find((value) => value.startsWith(`${name}=`));
  return arg ? path.resolve(arg.slice(name.length + 1)) : null;
};
const defaultTarget = path.join(STUDIO_ROOT, "dist", "Mefi Studio AI+", "resources", "app", "data");
const sourceDir = argDir("--source") ?? path.join(STUDIO_ROOT, "data");
const targetDir = argDir("--target") ?? defaultTarget;
for (const [label, dir] of [["source", sourceDir], ["target", targetDir]]) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`${label} data dir not found: ${dir}`);
    process.exit(1);
  }
}

// Transient run telemetry must not cross stores: the target board has no
// worker holding the copied task, so a carried runId/lease would describe a
// run that is not running there.
const transientTaskKeys = (task) => {
  const next = { ...task };
  for (const key of ["runId", "lease"]) delete next[key];
  return next;
};

const store = async (dir) => ({
  tasks: await readJson(path.join(dir, "eyes-tasks.json"), []),
  requests: await readJson(path.join(dir, "eyes-requests.json"), []),
  ideas: await readJson(path.join(dir, "eyes-feature-ideas.json"), []),
});

const source = await store(sourceDir);
const target = await store(targetDir);

const targetIdeaIds = new Set(target.ideas.map((idea) => String(idea?.id ?? "")).filter(Boolean));
const targetTaskIds = new Set(target.tasks.map((task) => String(task?.id ?? "")).filter(Boolean));
const sourceTasksById = new Map(source.tasks.map((task) => [String(task?.id ?? ""), task].filter(Boolean)));

// Ideas the authoritative board holds and the target lacks, plus the drained
// task rows that keep their links resolvable on the target board. Identity and
// dedupe reuse the app's own ideaIdentityKeys. The chat-noise gate does not
// apply here the way it does to ingestion: a row already drained on the
// authoritative board carries a taskId — it is a committed obligation (the
// app's promotion path never runs the narration gate), and a committed row
// must not re-cross a wording gate to sync, even though the gate's
// status-report arm is now main-clause scoped so conditional tails like
// "after contract tests pass" survive it.
const ideaAdditions = [];
const seenIdentity = new Set();
for (const idea of target.ideas) for (const key of ideaIdentityKeys(idea)) seenIdentity.add(key);
for (const idea of source.ideas) {
  if (!idea?.id || targetIdeaIds.has(String(idea.id))) continue;
  const keys = ideaIdentityKeys(idea);
  if (!keys.length || keys.some((key) => seenIdentity.has(key))) continue;
  if (!idea.taskId && isExtractionArtifact(idea)) continue;
  for (const key of keys) seenIdentity.add(key);
  ideaAdditions.push(idea);
}
const taskAdditions = [];
for (const idea of ideaAdditions) {
  const taskId = String(idea.taskId ?? "");
  if (!taskId || targetTaskIds.has(taskId)) continue;
  const task = sourceTasksById.get(taskId);
  if (task) taskAdditions.push(transientTaskKeys(task));
}

// The app's admission rule, verbatim: drain only while the queue has room.
const mergedTasks = [...target.tasks, ...taskAdditions];
const mergedIdeas = [...ideaAdditions, ...target.ideas];
const summary = backlog.summarizeBacklog({ tasks: mergedTasks, requests: target.requests, ideas: mergedIdeas, jobs: [], autoBuild: true });
const counts = summary.counts;
const occupied = counts.ready + counts.running + counts.review + counts.cooling + counts.waiting + counts.approval;
const limit = Math.max(0, 3 - occupied);

let drained = promoteIdeaBacklog({ tasks: mergedTasks, ideas: mergedIdeas, now: Date.now(), limit });
const finalTasks = drained.tasks;
const finalIdeas = drained.ideas;

console.log(`source: ${sourceDir}`);
console.log(`target: ${targetDir}`);
console.log(`board: ${target.tasks.length} tasks, ${target.ideas.length} ideas -> ${finalTasks.length} tasks, ${finalIdeas.length} ideas`);
console.log(`ideas: ${ideaAdditions.length} missing idea(s) found on the source board`);
for (const idea of ideaAdditions) console.log(`  + ${idea.id} "${idea.title}"${idea.taskId ? ` -> ${idea.taskId}` : " (unlinked)"}`);
if (taskAdditions.length) {
  console.log(`tasks: ${taskAdditions.length} drained task row(s) copied so the links resolve`);
  for (const task of taskAdditions) console.log(`  + ${task.id} "${task.title}"`);
}
console.log(`queue: occupied=${occupied} limit=${limit}${limit > 0 ? "" : " — no room; keep/unlinked ideas stay for the app's own drain (backlog mode)"}`);
if (drained.promoted) {
  console.log(`drain: ${drained.promoted} idea(s) admitted through the admitBacklogIdeas path`);
  for (const id of drained.taskIds) console.log(`  ~ ${id}`);
}
const eligibleLeft = finalIdeas.filter((idea) => !idea.taskId && ["keep", "new"].includes(String(idea.status ?? "new"))).map((idea) => idea.id);
if (eligibleLeft.length) console.log(`armed: ${eligibleLeft.join(", ")} remain keep/new and unlinked for the live app to drain when the queue frees`);

if (dryRun) {
  console.log("dry run — nothing written.");
} else {
  const written = [];
  for (const [file, before, after] of [
    [path.join(targetDir, "eyes-feature-ideas.json"), target.ideas, finalIdeas],
    [path.join(targetDir, "eyes-tasks.json"), target.tasks, finalTasks],
  ]) {
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    await writeJson(file, after);
    written.push(path.basename(file));
  }
  console.log(written.length ? `written back (plain files): ${written.join(", ")}` : "nothing changed — nothing written.");
}
