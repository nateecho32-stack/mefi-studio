// One-shot board reconciliation: runs the compaction and tidy rules over the
// live board without the app running. This is the migration pass that repairs
// a backlog left inconsistent by earlier versions — dangling idea→task links,
// stranded `planned` ideas on deleted plans, same-theme duplicate plans,
// duplicate task ids from the colliding plan generators — while keeping every
// distinct obligation represented.
//
// Usage:
//   node scripts/reconcile-board.mjs            # apply + write back
//   node scripts/reconcile-board.mjs --dry-run  # report only
//   node scripts/reconcile-board.mjs --scope-heal          # ONLY re-anchor stale saved file scopes
//   node scripts/reconcile-board.mjs --data=<dir>          # reconcile another install's data dir
//                                                          # (plain-file mode: no board store)
//
// The three board stores (requests, tasks, ideas) are applied through ONE
// boardMutate transaction — the compute happens inside the transaction on
// committed state, so a concurrent writer cannot interleave a read and a
// write (this script used to read the collections, compute, then write them
// back separately). Idle-time reconciliation is still the recommendation: the
// app mutates the same stores while it runs, and a repair computed against a
// moving board describes a board that no longer exists. Checkpoints are not a
// board store; they are read before and written after, unchanged in shape.

import path from "node:path";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultBoardConfig, enableBoardStore, boardMutate, boardEnabled, readJson, writeJson } from "./eyes.mjs";
import { compact, tidy } from "./assistant.mjs";
import taskContext from "./task-context.cjs";

const STUDIO_ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, "");
const dryRun = process.argv.includes("--dry-run");
const scopeOnly = process.argv.includes("--scope-heal");
const dataArg = process.argv.find((arg) => arg.startsWith("--data="));
const dataDir = dataArg ? path.resolve(dataArg.slice("--data=".length)) : path.join(STUDIO_ROOT, "data");

// --data points at a store another install owns (e.g. a portable build); its
// authority is the JSON files themselves, so the board store stays off and
// the pass reads and writes plain files.
if (!dataArg) enableBoardStore(defaultBoardConfig(STUDIO_ROOT));

// Folder names a stale-scope search never descends into — the same skip list
// the app's own locator uses (main.cjs SCOPE_WALK_SKIP).
const SCOPE_WALK_SKIP = new Set(["node_modules", ".git", "dist", "out", "build", "data", "__pycache__", "venv"]);

// Bounded breadth-first search for one basename under a project root, mirroring
// main.cjs's findBasenameUnderRoot. Shallowest match wins; every filesystem
// error reads as "not here". Returns an absolute path or null.
function findBasenameUnderRoot(root, base, { maxEntries = 20000, maxDepth = 6 } = {}) {
  const name = String(base ?? "").trim();
  const start = String(root ?? "").trim();
  if (!name || !start) return null;
  let stat;
  try { stat = statSync(start, { throwIfNoEntry: false }); } catch { return null; }
  if (!stat?.isDirectory()) return null;
  const queue = [[start, 0]];
  let seen = 0;
  let best = null;
  while (queue.length && seen < maxEntries && !best) {
    const [dir, depth] = queue.shift();
    let list;
    try { list = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const item of list) {
      if (++seen > maxEntries) break;
      if (item.isFile() && item.name === name) { best = path.join(dir, item.name); break; }
      if (item.isDirectory() && depth < maxDepth && !item.name.startsWith(".") && !SCOPE_WALK_SKIP.has(item.name.toLowerCase())) queue.push([path.join(dir, item.name), depth + 1]);
    }
  }
  return best;
}

const fileExists = (candidate) => { try { return statSync(candidate, { throwIfNoEntry: false })?.isFile() === true; } catch { return false; } };

const requestsPath = path.join(dataDir, "eyes-requests.json");
const tasksPath = path.join(dataDir, "eyes-tasks.json");
const ideasPath = path.join(dataDir, "eyes-feature-ideas.json");
const checkpointsPath = path.join(dataDir, "eyes-checkpoints.json");

const [snapshotRequests, snapshotTasks, snapshotIdeas, checkpoints] = await Promise.all([
  readJson(requestsPath, []),
  readJson(tasksPath, []),
  readJson(ideasPath, []),
  readJson(checkpointsPath, {}),
]);

// The dry run reports against the snapshot; the apply pass recomputes inside
// the transaction so it lands on committed state, not on what the views
// happened to hold when the script started.
const reportOn = (board) => {
  // Heal legacy duplicate task ids first (two generators once minted the same
  // plan id): the richer copy wins, exactly like the title collapse. The
  // store's unique index refuses duplicate-id writes, so this must run before
  // anything else can put the collection back.
  const seen = new Map();
  const idDropped = new Set();
  for (const task of board.tasks) {
    const id = String(task?.id ?? "");
    if (!id) continue;
    const existing = seen.get(id);
    if (!existing) {
      seen.set(id, task);
      continue;
    }
    const keep = JSON.stringify(task).length > JSON.stringify(existing).length ? task : existing;
    idDropped.add(keep === task ? existing : task);
    seen.set(id, keep);
  }
  const tasks = idDropped.size ? board.tasks.filter((task) => !idDropped.has(task)) : board.tasks;
  // Re-anchor stale saved file scopes before anything judges those rows: a
  // collision's saved scope copies session edit records verbatim, and those
  // records keep a file's OLD absolute path after the project moved. A path
  // that still exists is kept as saved; a missing one is re-anchored to the
  // same basename under the task's project root; one that cannot be
  // re-anchored is kept and reported rather than dropped.
  const scopeHealed = [];
  const scopeMissing = [];
  const healedTasks = tasks.map((task) => {
    if (!task || (!Array.isArray(task.files) || !task.files.length) && !task.file) return task;
    let scope;
    try {
      scope = taskContext.resolveStaleFileScope(task, {
        exists: fileExists,
        locate: (base, ref) => findBasenameUnderRoot(ref?.projectPath || STUDIO_ROOT, base),
      });
    } catch {
      return task;
    }
    if (!scope.changed) return task;
    scopeHealed.push(...scope.healed);
    scopeMissing.push(...scope.missing);
    return { ...task, files: scope.files, ...(scope.file ? { file: scope.file } : {}) };
  });
  if (scopeOnly) {
    return {
      compacted: { report: { text: "skipped (--scope-heal)" } },
      tidied: { requests: board.requests, tasks: healedTasks, ideas: board.ideas, checkpoints, report: { text: "skipped (--scope-heal)" } },
      annotated: 0,
      idDropped: idDropped.size,
      scopeHealed,
      scopeMissing,
    };
  }
  const compacted = compact({ requests: board.requests, tasks: healedTasks, ideas: board.ideas, collisions: null, now: Date.now() });
  const tidied = tidy({
    tasks: compacted.tasks,
    ideas: compacted.ideas,
    requests: compacted.requests,
    checkpoints,
    nodeFolders: null,
    sessions: null,
    collisions: null,
    audit: null,
    duplicates: null,
    now: Date.now(),
    prefs: {},
  });

  // Mark uncertain historical completion as unverified — not done-and-proven.
  // Cards closed before evidence checks existed carry a stamp saying so; new
  // completions get a real verification from the housekeeping pass. This is an
  // annotation, not a reopen: finished history is not re-run, it just stops
  // claiming more certainty than its evidence supports.
  let annotated = 0;
  const stampAt = Date.now();
  tidied.tasks = tidied.tasks.map((task) => {
    if (task?.status !== "done" || task?.verification) return task;
    annotated += 1;
    return {
      ...task,
      verification: { state: "unverified", at: stampAt, note: "completed before evidence checks existed" },
    };
  });
  return { compacted, tidied, annotated, idDropped: idDropped.size, scopeHealed, scopeMissing };
};

const summarize = (result) => {
  const { compacted, tidied, annotated, idDropped } = result;
  const linked = tidied.ideas.filter((idea) => idea?.taskId).length;
  const taskIds = new Set(tidied.tasks.map((task) => task?.id).filter(Boolean));
  const stillDangling = tidied.ideas.filter((idea) => idea?.taskId && !taskIds.has(idea.taskId));
  console.log(`board: ${snapshotTasks.length} tasks, ${snapshotIdeas.length} ideas (${snapshotIdeas.filter((idea) => idea?.taskId).length} task-linked), ${snapshotRequests.length} requests`);
  if (idDropped) console.log(`ids: dropped ${idDropped} duplicate-id task row(s)`);
  console.log(`compact: ${compacted.report.text}`);
  console.log(`tidy: ${tidied.report.text}`);
  console.log(`after: ${tidied.tasks.length} tasks, ${tidied.ideas.length} ideas (${linked} task-linked, ${stillDangling.length} dangling)`);
  if (annotated) console.log(`verification: ${annotated} legacy done task(s) stamped unverified`);
  if (result.scopeHealed?.length) {
    console.log(`scope: ${result.scopeHealed.length} stale path(s) re-anchored`);
    for (const row of result.scopeHealed.slice(0, 10)) console.log(`  ${row.from} -> ${row.to}`);
  }
  if (result.scopeMissing?.length) console.log(`scope: ${result.scopeMissing.length} saved path(s) could not be re-anchored (kept as saved)`);
  if (stillDangling.length) {
    console.log("WARNING: ideas still link to tasks that are not on the board:");
    for (const idea of stillDangling.slice(0, 10)) console.log(`  ${idea.id} -> ${idea.taskId}`);
  }
  return stillDangling;
};

const preview = reportOn({ requests: snapshotRequests, tasks: snapshotTasks, ideas: snapshotIdeas });
summarize(preview);

if (!dryRun) {
  if (!boardEnabled()) {
    // Plain-file mode (--data): the target store's authority is the JSON
    // files themselves. Re-read fresh, compute on it, write back only what
    // the pass changed. Run it at idle time — the owning app re-reads these
    // files before every write, but a mid-pass write by the app is the one
    // interleaving this mode cannot fence.
    const [requests, tasks, ideas] = await Promise.all([
      readJson(requestsPath, []),
      readJson(tasksPath, []),
      readJson(ideasPath, []),
    ]);
    const result = reportOn({ requests, tasks, ideas });
    const written = [];
    for (const [file, before, after] of [
      [requestsPath, requests, result.tidied.requests],
      [tasksPath, tasks, result.tidied.tasks],
      [ideasPath, ideas, result.tidied.ideas],
    ]) {
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      await writeJson(file, after);
      written.push(path.basename(file));
    }
    if (preview.tidied.checkpoints !== checkpoints) await writeJson(checkpointsPath, preview.tidied.checkpoints);
    console.log(written.length ? `written back (plain files): ${written.join(", ")}` : "nothing changed — nothing written.");
  } else {
    const stillDangling = await boardMutate((board) => {
      const result = reportOn(board);
      const dangling = (() => {
        const taskIds = new Set(result.tidied.tasks.map((task) => task?.id).filter(Boolean));
        return result.tidied.ideas.filter((idea) => idea?.taskId && !taskIds.has(idea.taskId)).length;
      })();
      board.requests = result.tidied.requests;
      board.tasks = result.tidied.tasks;
      board.ideas = result.tidied.ideas;
      return { dangling };
    });
    if (stillDangling?.dangling) console.log(`WARNING: ${stillDangling.dangling} dangling link(s) survived the pass`);
    // Checkpoints are not a board store: tidy may still have reshaped them.
    if (preview.tidied.checkpoints !== checkpoints) await writeJson(checkpointsPath, preview.tidied.checkpoints);
    console.log("written back (one transaction).");
  }
} else {
  console.log("dry run — nothing written.");
}
