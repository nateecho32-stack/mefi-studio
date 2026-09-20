// Explicit, offline task grouping. JSON files remain authoritative; this never
// enables the optional SQLite store, expires work, or admits new ideas.
// Preview: node scripts/group-board.mjs --data=<directory> --groups=<json-file>
// Apply with Studio closed: append --apply. Originals are backed up locally.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupTasks } from "./assistant.mjs";
import taskContext from "./task-context.cjs";

export function assertStudioClosed(dataDir) {
  // A broad process check is intentional: Electron launched with a relative
  // project path cannot reliably be assigned to one store from its command line.
  const output = process.platform === "win32"
    ? execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "@(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -eq 'Mefi Studio AI+' -or $_.ProcessName -eq 'electron' } | Select-Object -ExpandProperty Id) | ConvertTo-Json -Compress"], { encoding: "utf8", windowsHide: true }).trim()
    : execFileSync("ps", ["-A", "-o", "comm="], { encoding: "utf8" }).split(/\r?\n/).filter((name) => /^(?:electron|Mefi Studio AI\+)$/i.test(path.basename(name.trim()))).join("\n");
  if (output) throw new Error(`Close Studio and Electron test windows before grouping ${dataDir}. No board files were changed.`);
}

const countWork = (tasks) => tasks.filter((task) => ["open", "active"].includes(task?.status)).length;
const parseRows = (body, name) => {
  const value = JSON.parse(body);
  if (!Array.isArray(value)) throw new Error(`${name} must contain an array; nothing was changed.`);
  return value;
};

export async function groupBoardDirectory({ dataDir, groups, expectedHash = null, apply = false, now = Date.now(), assertIdle = assertStudioClosed } = {}) {
  if (!dataDir || !Array.isArray(groups)) throw new Error("An explicit data directory and groups array are required.");
  const directory = path.resolve(dataDir);
  if (apply) await assertIdle(directory);
  const files = ["eyes-tasks.json", "eyes-feature-ideas.json"];
  const bodies = await Promise.all(files.map((name) => readFile(path.join(directory, name), "utf8")));
  if (expectedHash && createHash("sha256").update(bodies[0]).digest("hex") !== expectedHash) throw new Error("Board changed since the grouping was reviewed; review it again before applying.");
  const [tasks, ideas] = bodies.map((body, index) => parseRows(body, files[index]));
  // A reviewed manifest may pin IDs as well as titles. Fail closed if its exact
  // source obligations were edited, renamed or removed before application.
  for (const group of groups) {
    if (!group || typeof group.title !== "string" || !Array.isArray(group.tasks)) throw new Error("Each group needs a title and task titles.");
    const ids = group.taskIds ?? group.ids;
    if (ids) {
      if (!Array.isArray(ids) || ids.length !== group.tasks.length) throw new Error("Group IDs must match its task titles.");
      ids.forEach((id, index) => {
        if (!tasks.some((task) => task.id === id && task.title === group.tasks[index])) throw new Error(`Reviewed task ${id} changed; review the grouping again.`);
      });
    }
  }
  const result = groupTasks({ tasks, ideas, groups, now, limits: { maxPlansPerPass: groups.length } });
  const previous = new Map(tasks.map((task) => [task.id, task]));
  const nextTasks = result.tasks.map((task) => previous.get(task.id) === task ? task : taskContext.recordTaskRevision(task, {
    previous: previous.get(task.id), kind: "grouped", note: "Related tasks grouped; full original requirements and history retained.", now,
  }));
  const summary = {
    before: countWork(tasks), after: countWork(nextTasks), absorbed: result.absorbed,
    plans: result.plans.map((plan) => ({ id: plan.id, title: plan.title, members: plan.members.map((member) => member.id) })),
    applied: false,
  };
  if (!apply || !result.absorbed) return summary;

  const next = [nextTasks, result.ideas];
  const changed = next.map((rows, index) => JSON.stringify(rows) !== JSON.stringify(index === 0 ? tasks : ideas));
  // Check both process state and the original bytes again immediately before
  // writing. This is an offline operation, not a cross-process board gateway.
  await assertIdle(directory);
  const fresh = await Promise.all(files.map((name) => readFile(path.join(directory, name), "utf8")));
  if (fresh.some((body, index) => body !== bodies[index])) throw new Error("Board changed during preview; nothing was written. Retry with Studio closed.");
  const backup = path.join(directory, "board-group-backups", `${now}-${randomUUID()}`);
  await mkdir(backup, { recursive: true });
  for (let index = 0; index < files.length; index += 1) await writeFile(path.join(backup, files[index]), bodies[index], { flag: "wx" });
  await writeFile(path.join(backup, "grouping.json"), JSON.stringify({ ...summary, groups }, null, 2) + "\n", { flag: "wx" });
  for (let index = 0; index < files.length; index += 1) {
    if (!changed[index]) continue;
    const target = path.join(directory, files[index]);
    const temporary = `${target}.tmp-${randomUUID()}`;
    await writeFile(temporary, JSON.stringify(next[index], null, 2) + "\n", { flag: "wx" });
    await rename(temporary, target);
  }
  return { ...summary, applied: true, backup };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => !/^--(?:data=|groups=|apply$)/.test(arg))) throw new Error("Usage: node scripts/group-board.mjs --data=<directory> --groups=<json-file> [--apply]");
    const dataDir = args.find((arg) => arg.startsWith("--data="))?.slice(7);
    const manifest = args.find((arg) => arg.startsWith("--groups="))?.slice(9);
    if (!manifest) throw new Error("Pass --groups=<json-file>; a dry run is the default.");
    const reviewed = JSON.parse(await readFile(path.resolve(manifest), "utf8"));
    const groups = Array.isArray(reviewed) ? reviewed : reviewed.groups;
    console.log(JSON.stringify(await groupBoardDirectory({ dataDir, groups, expectedHash: reviewed.sourceSha256, apply: args.includes("--apply") }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
