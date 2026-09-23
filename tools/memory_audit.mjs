// Read-only memory audit: every card's memory folder against the board, the
// way the keeper's audit pass sees it. Loads a data folder's eyes-tasks.json
// and eyes-assistant.json, runs tidy() and auditPass() on in-memory copies,
// and prints each card grouped by state (done / doing / review / stopped /
// stalled / looping / would-hold / open) with what its memory says, where
// memory and board disagree, the duplicate families, the near-duplicate
// lessons, and how much of the completed cards' history the keeper's
// compaction (task-context compactHistory) could drop. Nothing in the data
// folder is ever written; --json writes only under tools/logs/.
//
// node tools/memory_audit.mjs [--data DIR] [--now MS] [--armed-at MS|now]
//   [--host-hold] [--json FILE]
//
// --data      the data folder (default: the portable app's live data under
//             dist/, beside this repository's tools/)
// --armed-at  count outcomes logged after this time (default: the saved
//             housekeeping.loopArmedAt, or every line in each card's log
//             window when the guard has not been armed yet)
// --host-hold report holds as stamped (the host honours loop holds) instead
//             of "would hold"
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPass, lessonGroups, normalizeState, tidy } from "../scripts/assistant.mjs";

const { compactHistory } = createRequire(import.meta.url)("../scripts/task-context.cjs");

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGS = path.join(studio, "tools", "logs");
const STATES = ["done", "doing", "review", "stopped", "stalled", "looping", "would-hold", "open"];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} needs a value`);
  return args[index + 1];
};
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

// --json FILE lands under tools/logs/: a bare name or a relative path is taken
// from tools/logs/ (a path that already starts with tools/logs/ from the
// repository root), and anything that resolves elsewhere is refused.
function jsonTarget(raw, dataDir) {
  const spelled = String(raw).replace(/\\/g, "/");
  const output = path.isAbsolute(raw) ? path.resolve(raw) : spelled.startsWith("tools/logs/") ? path.resolve(studio, spelled) : path.resolve(LOGS, spelled);
  if (!inside(LOGS, output) || output === LOGS) throw new Error("--json must name a file under tools/logs/");
  if (inside(dataDir, output)) throw new Error("--json must not write into the data folder");
  return output;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(`${path.basename(file)} is not readable JSON: ${error.message}`);
  }
}

const clip = (text, max) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const when = (ms) => (ms ? new Date(ms).toISOString() : "never");

function report(audit) {
  const { dataDir, now, armedAt, tasks, folders, legacyKeys, result, lessons, history } = audit;
  const lines = [];
  lines.push(`Memory audit — ${dataDir}`);
  lines.push(`now ${when(now)} · ${tasks} cards · ${folders} memory folders · outcomes counted ${armedAt ? `since ${when(armedAt)}` : "over each card's whole log window (the guard is not armed yet)"}`);
  lines.push(`Keeper summary: ${result.text || "nothing to say"}`);
  const counts = STATES.map((state) => [state, result.findings.filter((row) => row.state === state)]);
  lines.push(counts.map(([state, rows]) => `${state} ${rows.length}`).join(" · "));
  for (const [state, rows] of counts) {
    if (!rows.length) continue;
    // Settled work with nothing to say would drown the list: done cards show
    // only when they still have memory or an issue.
    const shown = state === "done" ? rows.filter((row) => row.issue || row.memory !== "no memory folder") : rows;
    lines.push("");
    lines.push(`${state} (${rows.length})${shown.length < rows.length ? ` — ${rows.length - shown.length} with no memory and nothing to report not listed` : ""}`);
    for (const row of shown) {
      lines.push(`  ${row.id}  "${clip(row.title, 60)}"`);
      lines.push(`      memory: ${row.memory}`);
      if (row.issue) lines.push(`      ! ${row.issue}`);
    }
  }
  const mismatches = result.findings.filter((row) => row.issue);
  lines.push("");
  lines.push(`Memory vs board: ${mismatches.length} card(s) with something to report`);
  if (legacyKeys.length) lines.push(`  legacy folder keys (merged into task:task:<id> on the next write): ${legacyKeys.join(", ")}`);
  const delta = result.memoryDelta;
  lines.push(`  alignment the keeper would apply: relabel ${delta.relabel.length} · append ${delta.append.length} · settle ${delta.settle.length}`);
  for (const row of delta.relabel) lines.push(`    relabel ${row.key}: "${clip(row.text, 70)}" → ${row.cell}`);
  for (const row of delta.append) lines.push(`    append ${row.key}: ${row.entry.cell} "${clip(row.entry.text, 80)}"`);
  for (const row of delta.settle) lines.push(`    settle ${row.key}: ${row.settled ?? "clear"}`);
  if (result.supersedeQuestionIds.length) lines.push(`  open issue questions about finished or missing cards: ${result.supersedeQuestionIds.join(", ")}`);
  lines.push("");
  lines.push(`Duplicate families (${result.report.familyGroups.length})`);
  for (const family of result.report.familyGroups) {
    lines.push(`  "${family.key}"`);
    for (const member of family.members) lines.push(`    ${member.id} ${member.status}${member.parentTaskId ? ` · parent ${member.parentTaskId}` : ""}${member.splitFrom ? ` · split from ${member.splitFrom}` : ""}  "${clip(member.title, 60)}"`);
  }
  lines.push("");
  lines.push(`Duplicate lessons (${lessons.length})`);
  for (const group of lessons) {
    lines.push(`  keeps "${clip(group[0].text, 90)}" (${group[0].hits} hits)`);
    for (const row of group.slice(1)) lines.push(`    folds "${clip(row.text, 90)}" (${row.hits} hits)`);
  }
  lines.push("");
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  lines.push(`history: ${plural(history.cards, "completed card")} could drop ${plural(history.revisions, "revision")} (${Math.round(history.bytes / 1024)} KB)${history.enabled ? "" : " · compaction is off (the compactHistory pref)"}`);
  return lines.join("\n");
}

async function main() {
  if (flag("--help")) {
    console.log("node tools/memory_audit.mjs [--data DIR] [--now MS] [--armed-at MS|now] [--host-hold] [--json FILE]");
    return 0;
  }
  const dataDir = path.resolve(value("--data", path.join(studio, "dist", "Mefi Studio AI+", "resources", "app", "data")));
  const jsonRaw = value("--json", null);
  const output = jsonRaw ? jsonTarget(jsonRaw, dataDir) : null;
  const now = Number(value("--now", String(Date.now())));
  if (!Number.isFinite(now) || now <= 0) throw new Error("--now must be a time in milliseconds");
  const rawTasks = await readJson(path.join(dataDir, "eyes-tasks.json"), null);
  const rawState = await readJson(path.join(dataDir, "eyes-assistant.json"), null);
  if (rawTasks === null && rawState === null) throw new Error(`no eyes-tasks.json or eyes-assistant.json in ${dataDir}`);
  const tasks = Array.isArray(rawTasks) ? rawTasks : Array.isArray(rawTasks?.tasks) ? rawTasks.tasks : [];
  const rawFolders = rawState?.nodeFolders && typeof rawState.nodeFolders === "object" ? rawState.nodeFolders : {};
  const state = normalizeState(rawState, now);
  const armedRaw = value("--armed-at", null);
  const armedAt = armedRaw === "now" ? now : armedRaw !== null ? Number(armedRaw) : state.housekeeping.loopArmedAt;
  if (!Number.isFinite(armedAt) || armedAt < 0) throw new Error("--armed-at must be a time in milliseconds or now");

  // In-memory copies only: tidy and the audit are pure, and nothing below
  // writes back to the data folder.
  const copy = (data) => JSON.parse(JSON.stringify(data));
  const tidied = tidy({ tasks: copy(tasks), nodeFolders: copy(rawFolders), sessions: null, now, prefs: state.prefs });
  const result = auditPass({
    tasks: tidied.tasks,
    nodeFolders: tidied.nodeFolders,
    questions: state.questions,
    now,
    prefs: state.prefs,
    armedAt,
    hostCaps: { loopHold: flag("--host-hold") },
  });
  // What the keeper's history compaction could drop from the completed cards
  // (it compacts each one once it is past the tidy clock, 20 a pass).
  // compactHistory is pure: the rows read are not changed.
  const history = { cards: 0, revisions: 0, bytes: 0, enabled: state.prefs.compactHistory !== false };
  for (const task of tasks) {
    const out = compactHistory(task, { now });
    if (!(out.dropped > 0)) continue;
    history.cards += 1;
    history.revisions += out.dropped;
    history.bytes += Math.max(0, out.bytesBefore - out.bytesAfter);
  }
  const audit = {
    dataDir,
    now,
    armedAt,
    tasks: tasks.length,
    folders: Object.keys(tidied.nodeFolders).length,
    legacyKeys: Object.keys(rawFolders).filter((key) => key.startsWith("task:") && !key.startsWith("task:task:")),
    tidy: tidied.report.text,
    result,
    lessons: lessonGroups(state.overseer.lessons).filter((group) => group.length > 1),
    history,
  };
  console.log(report(audit));
  if (output) {
    await mkdir(path.dirname(output), { recursive: true });
    const { result: body, ...head } = audit;
    await writeFile(output, `${JSON.stringify({ ...head, report: body.report, text: body.text, findings: body.findings, memoryDelta: body.memoryDelta, supersedeQuestionIds: body.supersedeQuestionIds }, null, 2)}\n`);
    console.log(`\nRecord: ${path.relative(studio, output)}`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`memory_audit: ${error.message}`);
    process.exit(1);
  },
);
