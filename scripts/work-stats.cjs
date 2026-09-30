"use strict";

// Work stats: what one project's ledgers say about the work done in it, for
// the greeting card on Build's Home (renderer/builder.js; main.cjs
// "work:stats"). Every number is counted from a record, never estimated:
//   runs    the executor ledger (data/executor-log.jsonl): a run is its start
//           row, or its finish row when the start was trimmed; the route
//           label (`via`) names the worker, the finish says how it ended.
//   workers the Studio ledger's worker rows (model-performance.cjs, role
//           "worker"), which name a run's model by its runId and carry the
//           verifier's settled outcome: a win or a loss.
//   usage   token rows from both usage ledgers (usage-tracker.cjs
//           mergeLedgers): Studio's own calls and OpenCode's coding turns.
//   tasks   the board: tasks made, and those verified or confirmed done.
// A day is the machine's local calendar day, as usage-tracker.cjs counts
// them. A range is "all", "30d" or "7d"; "all" still reads only what the
// ledgers kept (the executor ledger trims itself past 4 MB).
// Pure module: no Electron, no filesystem, no network, no clock reads. The
// host reads the ledgers and passes their rows and `now` in.

const DAY_MS = 86400000;
const RANGES = Object.freeze({ all: null, "30d": 30, "7d": 7 });
const HEAT_DAYS = 22 * 7;

const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value, max = 120) => (typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

function dayKeyOf(at) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function startOfLocalDay(at) {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// The executor ledger's rows, one JSON object per line; a torn line is skipped.
function ledgerRows(ledger) {
  const rows = [];
  for (const line of String(ledger ?? "").split("\n")) {
    if (!line.trim()) continue;
    let row = null;
    try { row = JSON.parse(line); } catch { continue; }
    if (row && typeof row === "object" && typeof row.runId === "string" && row.runId && number(row.at) !== null) rows.push(row);
  }
  return rows;
}

// One record per run: when it started, what ran it, how it ended.
function runsOf(rows) {
  const runs = new Map();
  for (const row of rows) {
    let run = runs.get(row.runId);
    if (!run) { run = { runId: row.runId, task: null, at: null, firstAt: row.at, via: "", ok: null, seconds: null }; runs.set(row.runId, run); }
    if (typeof row.task === "string" && row.task) run.task = row.task;
    if (row.event === "start") { run.at = row.at; run.via = text(row.via) || run.via; }
    else if (row.event === "finish") { run.ok = row.ok === true; run.seconds = number(row.seconds); }
  }
  return [...runs.values()].map(({ firstAt, ...run }) => ({ ...run, at: run.at ?? firstAt }));
}

// A readable model name from a route label: "claude cli · main · heavy tier
// (opus)" reads "Claude Code (opus)", "opencode-go/glm-5.1 · fast tier" reads
// "glm-5.1". A worker row's own model wins over the label.
const CLI_WORDS = Object.freeze({ claude: "Claude Code", codex: "Codex", grok: "Grok", opencode: "OpenCode", agy: "Antigravity", antigravity: "Antigravity" });
function modelOf(via = "", worker = null) {
  const model = text(worker?.model);
  if (model) return model.split("/").pop();
  const label = text(via, 200);
  if (!label) return "";
  const head = label.split(" · ")[0].trim();
  const cli = /^([a-z]+)\s+(?:cli|default)\b/i.exec(head)?.[1]?.toLowerCase();
  if (cli) {
    const tier = /\(([^)]+)\)\s*$/.exec(label)?.[1];
    return `${CLI_WORDS[cli] || cli}${tier ? ` (${tier})` : ""}`;
  }
  return head.split("/").pop() || head;
}
const modelKey = (name) => String(name || "").toLowerCase().replace(/\s+/g, " ").trim();

function tokensOf(row) {
  const usage = row?.tokenUsage && typeof row.tokenUsage === "object" ? row.tokenUsage : {};
  const total = number(usage.totalTokens);
  if (total !== null) return total;
  const parts = ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens"].map((key) => number(usage[key]) ?? 0);
  const sum = parts.reduce((a, b) => a + b, 0);
  return sum > 0 ? sum : null;
}
const stampOf = (value) => number(value) ?? (typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null);
const doneStates = new Set(["done", "archived", "completed"]);

// The card for one range: totals, a day and an hour histogram, the models.
function workStats({ ledger = "", observations = [], usage = [], tasks = [], now, range = "all" } = {}) {
  const at = number(now);
  if (at === null) throw new TypeError("workStats needs `now`");
  const days = Object.prototype.hasOwnProperty.call(RANGES, range) ? RANGES[range] : null;
  const since = days === null ? 0 : startOfLocalDay(at) - (days - 1) * DAY_MS;
  // The heatmap always reaches back its twenty-two weeks, lighting only the range.
  const heatSince = Math.max(since, startOfLocalDay(at) - (HEAT_DAYS - 1) * DAY_MS);
  const inRange = (stamp) => stamp !== null && stamp >= since && stamp <= at + 60000;
  const byDay = new Map();
  const hours = new Array(24).fill(0);
  const bucket = (stamp) => {
    const key = dayKeyOf(stamp);
    let day = byDay.get(key);
    if (!day) { day = { day: key, count: 0, runs: 0, tasks: 0, tokens: 0 }; byDay.set(key, day); }
    return day;
  };
  const moment = (stamp, field) => {
    const day = bucket(stamp);
    day.count += 1;
    if (field) day[field] += 1;
    hours[new Date(stamp).getHours()] += 1;
  };

  const workers = new Map();
  for (const row of Array.isArray(observations) ? observations : []) {
    if (row && row.role === "worker" && typeof row.runId === "string" && row.runId) workers.set(row.runId, row);
  }
  const models = new Map();
  const model = (name) => {
    const key = modelKey(name);
    if (!key) return null;
    let entry = models.get(key);
    if (!entry) { entry = { name, runs: 0, tokens: 0, tokenRows: 0, wins: 0, losses: 0 }; models.set(key, entry); }
    return entry;
  };

  let runs = 0, succeeded = 0;
  for (const run of runsOf(ledgerRows(ledger))) {
    if (!inRange(run.at)) continue;
    runs += 1;
    if (run.ok === true) succeeded += 1;
    moment(run.at, "runs");
    const worker = workers.get(run.runId) ?? null;
    const entry = model(modelOf(run.via, worker));
    if (entry) {
      entry.runs += 1;
      if (worker?.outcome === "win") entry.wins += 1;
      else if (worker?.outcome === "loss") entry.losses += 1;
    }
  }

  let tokens = 0, tokenRows = 0;
  for (const row of Array.isArray(usage) ? usage : []) {
    const stamp = number(row?.at);
    if (!inRange(stamp)) continue;
    const count = tokensOf(row);
    if (count === null) continue;
    tokens += count; tokenRows += 1;
    bucket(stamp).tokens += count;
    const entry = model(text(row.model).split("/").pop());
    if (entry) { entry.tokens += count; entry.tokenRows += 1; }
  }

  let made = 0, verified = 0;
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const created = stampOf(task?.createdAt);
    if (inRange(created)) { made += 1; moment(created, "tasks"); }
    const finished = stampOf(task?.doneAt) ?? (doneStates.has(task?.status) ? stampOf(task?.verification?.at) : null);
    if (inRange(finished) && doneStates.has(task?.status) && !task?.dropped) {
      moment(finished, null);
      if (task.verification?.state === "verified" || task.verification?.state === "manual") verified += 1;
    }
  }

  // Day keys are zero-padded, so they compare as dates.
  const heatKey = dayKeyOf(heatSince);
  const heat = [...byDay.values()].filter((day) => day.day >= heatKey).sort((a, b) => (a.day < b.day ? -1 : 1));
  const activeDays = [...byDay.values()].filter((day) => day.count > 0).length;
  const peak = Math.max(...hours);
  const ranked = [...models.values()]
    .filter((entry) => entry.runs > 0 || entry.tokenRows > 0)
    .sort((a, b) => b.runs - a.runs || b.tokens - a.tokens || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map(({ tokenRows: rows, ...entry }) => ({ ...entry, tokens: rows ? entry.tokens : null }));
  return {
    range: days === null ? "all" : range,
    since: since || null,
    totals: { tasks: made, runs, succeeded, verified, tokens: tokenRows ? tokens : null, activeDays },
    days: heat,
    hours,
    peakHour: peak > 0 ? hours.indexOf(peak) : null,
    models: ranked,
  };
}

module.exports = { RANGES, HEAT_DAYS, ledgerRows, runsOf, modelOf, tokensOf, workStats, dayKeyOf };
