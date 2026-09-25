// Replays one recorded day of work events (0.4.0 M1) against the executor
// ledger: what the stream saw, and whether its agents out and home match the
// ledger's run starts and finishes. The M5 tests use it to re-animate a day.
// Reads only; nothing is written.
//
// node tools/replay-events.mjs --day 2026-09-23 [--data <dir>] [--json] [--list]
//
// Exit 1 when the stream and the ledger disagree, 2 on bad arguments or an
// unreadable file, 0 otherwise.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import workEvents from "../scripts/work-events.cjs";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: node tools/replay-events.mjs --day YYYY-MM-DD [--data <dir>] [--json] [--list]";

export function parseArgs(argv) {
  const options = { day: null, data: path.join(studio, "data"), json: false, list: false, help: false };
  const args = [...(argv ?? [])];
  while (args.length) {
    const arg = String(args.shift());
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    const inline = name === arg ? null : arg.slice(eq + 1);
    const value = () => {
      const next = inline ?? args.shift();
      if (next == null || next === "" || (inline == null && String(next).startsWith("--"))) throw new Error(`${name} needs a value`);
      return String(next);
    };
    if (name === "--day") options.day = value();
    else if (name === "--data") options.data = path.resolve(value());
    else if (name === "--json" && inline == null) options.json = true;
    else if (name === "--list" && inline == null) options.list = true;
    else if ((name === "--help" || name === "-h") && inline == null) options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.day) throw new Error("--day is required");
  if (!workEvents.dayBounds(options.day)) throw new Error(`--day must be a real date as YYYY-MM-DD, got ${options.day}`);
  return options;
}

const pad = (value) => String(value).padStart(2, "0");

function offset(ms) {
  const sign = ms < 0 ? "-" : "+";
  const seconds = Math.floor(Math.abs(ms) / 1000);
  return `${sign}${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

// One line per event, timed from the first: "+mm:ss kind task step text".
export function formatList(events) {
  const list = Array.isArray(events) ? events.filter((event) => event && typeof event === "object") : [];
  if (!list.length) return "";
  const start = Number(list[0].at) || 0;
  const width = Math.max(...list.map((event) => String(event.kind ?? "").length));
  return list.map((event) => {
    const detail = [event.step, event.text ?? event.title].filter(Boolean).join(" ");
    return [offset((Number(event.at) || 0) - start), String(event.kind ?? "").padEnd(width), event.taskId ?? "-", detail].join(" ").trimEnd();
  }).join("\n");
}

const clock = (at) => {
  if (at == null) return "-";
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
const signed = (value) => (value > 0 ? `+${value}` : String(value));

function report({ day, data, summary, compare }) {
  const kinds = Object.entries(summary.byKind).map(([kind, count]) => `${kind} ${count}`).join(", ") || "none";
  return [
    `Work events for ${day} (${data})`,
    `  events: ${summary.total} across ${summary.tasks} task${summary.tasks === 1 ? "" : "s"}, ${clock(summary.firstAt)} to ${clock(summary.lastAt)}`,
    `  by kind: ${kinds}`,
    `  agents: ${summary.agentsOut} out, ${summary.agentsHome} home`,
    `Ledger: ${compare.ledger.starts} starts, ${compare.ledger.finishes} finishes`,
    compare.ok
      ? "  compare: ok"
      : `  compare: MISMATCH (agents out ${signed(compare.diff.out)} vs starts, home ${signed(compare.diff.home)} vs finishes)`,
  ].join("\n");
}

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const bounds = workEvents.dayBounds(options.day);
  let eventsText;
  let ledgerText;
  try {
    [eventsText, ledgerText] = await Promise.all([
      readText(path.join(options.data, "work-events.jsonl")),
      readText(path.join(options.data, "executor-log.jsonl")),
    ]);
  } catch (error) {
    process.stderr.write(`cannot read ${options.data}: ${error.message}\n`);
    return 2;
  }
  const events = workEvents.parseLines(eventsText).filter((event) => event.at >= bounds.since && event.at < bounds.until);
  const summary = workEvents.summarize(events);
  const compare = workEvents.compareWithLedger(events, ledgerText, bounds);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ summary, compare }, null, 2)}\n`);
  } else {
    if (options.list && events.length) process.stdout.write(`${formatList(events)}\n\n`);
    process.stdout.write(`${report({ day: options.day, data: options.data, summary, compare })}\n`);
  }
  return compare.ok ? 0 : 1;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
if (process.platform === "win32" ? entry.toLowerCase() === self.toLowerCase() : entry === self) {
  process.exitCode = await main(process.argv.slice(2));
}
