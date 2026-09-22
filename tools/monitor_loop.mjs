// Watches the real agent loop run: dispatch, claim, the worker's output
// stream, settlement, verification and the foreman's hand-outs. The loop code
// is the real one — lifted out of main.cjs by tests/fixtures/host_executor.mjs —
// and only its boundaries are doubles: a virtual clock, fake child processes
// and memory stores. No Electron, no project files, no worker CLI, no network,
// no credentials, and nothing on disk is read or written except --json output.
//
// node tools/monitor_loop.mjs [--scenario steady] [--minutes 60] [--parallel 3]
//   [--tick 5] [--tasks 12] [--trace] [--json tools/logs/loop-steady.json]
//   [--scenario all] [--compare]
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { executorHost } from "../tests/fixtures/host_executor.mjs";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} needs a value`);
  return args[index + 1];
};
const number = (name, fallback, { min = 1, max = 100000 } = {}) => {
  const raw = Number(value(name, String(fallback)));
  if (!Number.isFinite(raw) || raw < min || raw > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return raw;
};

const MINUTE = 60000;
const STAGGER_MS = 3000;

// ---------------------------------------------------------------- scenarios
// Each scenario decides how the fake worker behaves for a given run: how long
// it takes, what it prints, what evidence its session leaves behind. That is
// the only thing the loop cannot know in advance, so it is the only knob.
const done = (files = 1, checks = true) => ({
  outcome: "done",
  lines: ["reading the task", "MEFI_RESULT: done: the change; tests: npm test passed; remaining: none", "MEFI_JOB_DONE"],
  files: Array.from({ length: files }, (_, i) => ({ file: `src/changed-${i}.js`, status: "completed" })),
  checks: checks ? [{ command: "npm test", status: "completed", exitCode: 0, passed: true }] : [],
});
// How long a worker takes to print its first line. This is the single number
// the wedged-start watchdog judges a run by: past the start budget with no
// line and no session, the run is killed as broken infrastructure however
// healthy it is. --first-output moves it for every scenario.
const FIRST_OUTPUT_MS = 20000;
const SCENARIOS = {
  // Every worker does the job and leaves evidence. The happy path — what the
  // loop's cadence costs when nothing goes wrong.
  steady: (index) => ({ durationMs: (3 + (index % 4)) * MINUTE, ...done() }),
  // Every worker hands the rest of its job on. Exercises MEFI_NEXT, the
  // handoff queue, depth limits and how fast handed-off work gets picked up.
  handoffs: (index) => ({
    durationMs: 3 * MINUTE,
    ...done(),
    lines: [
      "working",
      `MEFI_NEXT: Finish the second half of piece ${index}`,
      `MEFI_NEXT: Add tests for piece ${index}`,
      "MEFI_RESULT: done: the first half; tests: npm test passed; remaining: none",
      "MEFI_JOB_DONE",
    ],
  }),
  // The failure mode the real executor log is full of: the CLI never registers
  // a session and never prints, and the wedged-start watchdog kills it.
  wedged: (index) => (index % 3 === 0 ? { durationMs: 3 * MINUTE, ...done() } : { outcome: "wedged" }),
  // Reported done, nothing to show for it: no changed files, no checks. The
  // verification loop reopens these, which is the retry cost to measure.
  "no-evidence": (index) => ({ durationMs: 2 * MINUTE, ...done(0, false), outcome: "done" }),
  // Mixed reality: some succeed, some exit non-zero, some leave no evidence.
  flaky: (index) =>
    index % 4 === 1
      ? { durationMs: 2 * MINUTE, outcome: "fail", code: 1, lines: ["error: could not apply the change"], files: [], checks: [] }
      : index % 4 === 2
        ? { durationMs: 2 * MINUTE, ...done(0, false) }
        : { durationMs: (2 + (index % 3)) * MINUTE, ...done() },
};

// ------------------------------------------------------------------ monitor
function monitorHost(options) {
  const { tasks, parallel, adaptiveParallel, mode } = options;
  const h = executorHost({ tasks, parallel, adaptiveParallel, mode });
  const env = h.env;
  const timers = [];
  const counts = { boardWrites: 0, storeReads: new Map(), roleWakes: new Map(), timersArmed: 0, staggerMs: 0, kills: 0, checkRuns: 0 };
  const phases = new Map();
  const events = [];
  const record = (kind, text, extra = {}) => events.push({ at: h.now(), kind, text, ...extra });

  // A virtual clock: the host's timers are recorded, then fired in order as
  // simulated time passes. The 3s spawn stagger is charged to the clock but
  // fired at once, exactly as the test fixture does — a fill that blocked on
  // wall time would never return.
  env.setTimeout = (fn, delay) => {
    const timer = { fn, delay, at: h.now() + delay, fired: false, cancelled: false, unref() {} };
    timers.push(timer);
    counts.timersArmed += 1;
    if (delay === STAGGER_MS) { timer.fired = true; counts.staggerMs += delay; queueMicrotask(fn); }
    return timer;
  };
  env.clearTimeout = (timer) => { if (timer) timer.cancelled = true; };

  const time = async (name, fn) => {
    const started = process.hrtime.bigint();
    try { return await fn(); } finally {
      const spent = Number(process.hrtime.bigint() - started) / 1e6;
      const row = phases.get(name) ?? { calls: 0, ms: 0 };
      phases.set(name, { calls: row.calls + 1, ms: row.ms + spent });
    }
  };
  for (const name of ["autopilotHousekeeping", "promoteRequestsToTasks", "executeNextRequest", "spawnNextJob", "assistantForemanJob"]) {
    const original = env[name];
    if (typeof original !== "function") continue;
    env[name] = (...rest) => time(name, () => original(...rest));
  }
  const mutate = env.mutateBoard;
  env.mutateBoard = (...rest) => { counts.boardWrites += 1; return time("mutateBoard", () => mutate(...rest)); };
  const eyesOnce = env.getEyes;
  let wrappedEyes = null;
  env.getEyes = async () => {
    if (wrappedEyes) return wrappedEyes;
    const real = await eyesOnce();
    wrappedEyes = new Proxy(real, {
      get(target, key) {
        const hit = target[key];
        if (typeof hit !== "function") return hit;
        return (...rest) => {
          const label = key === "readJson" ? `readJson:${rest[0]}` : String(key);
          counts.storeReads.set(label, (counts.storeReads.get(label) ?? 0) + 1);
          return hit.apply(target, rest);
        };
      },
    });
    return wrappedEyes;
  };
  const wake = env.assistantEnqueueRole;
  env.assistantEnqueueRole = (role, ...rest) => { counts.roleWakes.set(role, (counts.roleWakes.get(role) ?? 0) + 1); return wake(role, ...rest); };

  // The overseer's own verification commands. The host decides which check to
  // run from the project's shape on disk; the monitor answers "a node project"
  // so the scheduled command is the real `npm run check`, then runs it as a
  // child that closes after --check-ms of simulated time. Without this the
  // whole overseer half of verification is invisible.
  env.existsSync = (target) => String(target).endsWith("package.json");
  env.SOURCE_ROOT = env.projectRoot();
  env.STUDIO_ROOT = env.projectRoot();
  const baseSpawn = env.spawn;
  env.spawn = (command, ...rest) => {
    if (command === "cmd.exe" || command === "taskkill") return baseSpawn(command, ...rest);
    counts.checkRuns += 1;
    record("check", String(command).slice(0, 60));
    const child = new EventEmitter();
    child.pid = 900 + counts.checkRuns;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { child.killed = true; };
    timers.push({ at: h.now() + options.checkMs, fired: false, cancelled: false, unref() {}, fn: () => child.emit("close", 0, null) });
    return child;
  };

  const drain = () => new Promise((resolve) => setImmediate(resolve));
  const fireDue = async (target) => {
    for (let guard = 0; guard < 5000; guard += 1) {
      const due = timers.filter((timer) => !timer.fired && !timer.cancelled && timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      h.advance(Math.max(0, due.at - h.now()));
      due.fired = true;
      try { due.fn(); } catch (error) { record("error", `timer failed: ${error.message}`); }
      await drain();
    }
    if (h.now() < target) h.advance(target - h.now());
    await drain();
  };
  // A kill leaves a taskkill child the fixture never closes; closing it with
  // status 0 is what "the process tree was removed" looks like to the host.
  const settleKills = async () => {
    for (const row of h.terminations) {
      if (row.closed) continue;
      row.closed = true;
      counts.kills += 1;
      row.child.emit("close", 0);
      await drain();
    }
  };
  return { h, env, counts, phases, events, record, fireDue, settleKills, drain, timers };
}

async function watch(options) {
  const { scenario, minutes, tickMinutes, taskCount } = options;
  const behaviorFor = SCENARIOS[scenario];
  const tasks = Array.from({ length: taskCount }, (_, i) => ({
    id: `task_${String(i + 1).padStart(2, "0")}`,
    title: `Fixture piece ${i + 1}`,
    prompt: `Implement fixture piece ${i + 1} with its acceptance checks.`,
    status: "open",
    createdAt: 1_000_000 - (taskCount - i) * 1000,
    files: [`src/piece-${i + 1}.js`],
  }));
  const monitor = monitorHost({ ...options, tasks });
  const { h, counts, phases, events, record, fireDue, settleKills, drain } = monitor;
  const started = h.now();
  const wallStart = process.hrtime.bigint();
  const live = new Map(); // runId -> { behavior, finishAt, taskId }
  const runs = [];
  const seenTask = new Map(); // taskId -> first claim time, for dispatch latency

  const adopt = async () => {
    for (const job of h.autopilot.jobs) {
      if (live.has(job.id) || job.finished) continue;
      const behavior = behaviorFor(runs.length) ?? {};
      const row = {
        runId: job.id, taskId: job.taskId, title: job.title, startedAt: h.now(),
        behavior: behavior.outcome ?? "done", promptChars: job.child?.prompt?.length ?? null,
      };
      const wedged = behavior.outcome === "wedged";
      live.set(job.id, {
        job, behavior, row,
        chatterAt: wedged ? Infinity : h.now() + (behavior.firstOutputMs ?? options.firstOutputMs),
        finishAt: wedged ? Infinity : h.now() + (behavior.durationMs ?? 3 * MINUTE),
      });
      runs.push(row);
      if (!seenTask.has(job.taskId ?? job.id)) seenTask.set(job.taskId ?? job.id, h.now());
      record("dispatch", `${job.title} (${behavior.outcome ?? "done"})`, { runId: job.id, taskId: job.taskId });
    }
  };
  const reapDue = async () => {
    for (const [runId, entry] of [...live]) {
      if (entry.job.finished) { live.delete(runId); continue; }
      // A working run talks: one line clears the wedged-start watchdog.
      if (h.now() >= entry.chatterAt && !entry.spoke) {
        entry.spoke = true;
        entry.job.child?.stdout?.emit?.("data", "working on it\n");
        await drain();
      }
      if (h.now() < entry.finishAt) continue;
      live.delete(runId);
      entry.row.finishedAt = h.now();
      entry.row.ranMs = h.now() - entry.row.startedAt;
      const behavior = entry.behavior;
      if (entry.job.taskId) {
        await h.finish(entry.job.taskId, {
          code: behavior.code ?? 0,
          lines: behavior.lines ?? ["MEFI_JOB_DONE"],
          files: behavior.files ?? [],
          observedChecks: (behavior.checks ?? []).map((check) => ({ startedAt: entry.row.startedAt + 60000, ...check })),
        });
      } else {
        for (const line of behavior.lines ?? ["MEFI_JOB_DONE"]) entry.job.child.stdout.emit("data", `${line}\n`);
        await entry.job.reap(behavior.code ?? 0);
      }
      record("finish", `${entry.row.title} · ${behavior.outcome ?? "done"} after ${Math.round(entry.row.ranMs / MINUTE)}m`, { runId });
      await drain();
    }
  };

  // Per-card timeline: every status change, when it happened. This is where
  // the loop's own overhead shows up — the gaps between a card going active,
  // reporting, and being judged.
  const seen = new Map();
  const transitions = [];
  const sample = () => {
    for (const task of h.board().tasks) {
      const previous = seen.get(task.id);
      if (previous === task.status) continue;
      seen.set(task.id, task.status);
      transitions.push({ at: h.now() - started, id: task.id, from: previous ?? "(seed)", to: task.status });
    }
  };

  const stepMs = 15000;
  const horizon = minutes * MINUTE;
  let nextTick = 0;
  const statusAt = [];
  for (let elapsed = 0; elapsed <= horizon; elapsed += stepMs) {
    if (elapsed >= nextTick) {
      // The 5-minute tick: in the app autopilotPass fires here and ends by
      // asking the foreman for work. Housekeeping and promotion run inside
      // the foreman pass, which is what the harness holds.
      h.wake("auto builder pass");
      nextTick += tickMinutes * MINUTE;
    }
    await h.pump();
    await adopt();
    await reapDue();
    await h.pump();
    await adopt();
    sample();
    await fireDue(started + elapsed + stepMs);
    await settleKills();
    await h.pump();
    await reapDue();
    await adopt();
    sample();
    if (elapsed % (5 * MINUTE) === 0) {
      const board = h.board();
      statusAt.push({
        at: elapsed,
        building: h.autopilot.jobs.length,
        open: board.tasks.filter((t) => t.status === "open").length,
        active: board.tasks.filter((t) => t.status === "active").length,
        verifying: board.tasks.filter((t) => t.status === "awaiting_verification").length,
        done: board.tasks.filter((t) => t.status === "done").length,
        parked: board.tasks.filter((t) => t.status === "blocked" || t.status === "needs_review").length,
        waiting: h.autopilot.waiting ?? null,
      });
    }
  }
  const wallMs = Number(process.hrtime.bigint() - wallStart) / 1e6;
  const board = h.board();
  const byStatus = new Map();
  for (const task of board.tasks) byStatus.set(task.status, (byStatus.get(task.status) ?? 0) + 1);
  const first = (id, to) => transitions.find((row) => row.id === id && row.to === to)?.at ?? null;
  const last = (id, to) => [...transitions].reverse().find((row) => row.id === id && row.to === to)?.at ?? null;
  const spans = board.tasks.map((task) => {
    const claimed = first(task.id, "active");
    const reported = first(task.id, "awaiting_verification");
    const settled = last(task.id, "done");
    return {
      id: task.id, status: task.status,
      queued: claimed, ran: reported != null && claimed != null ? reported - claimed : null,
      verified: settled != null && reported != null ? settled - reported : null,
      lead: settled,
    };
  });
  const dispatchLatency = spans.map((row) => row.queued).filter((n) => n != null);
  const leadTimes = spans.filter((row) => row.lead != null).map((row) => row.lead);
  const runSpans = spans.map((row) => row.ran).filter((n) => n != null);
  const verifySpans = spans.map((row) => row.verified).filter((n) => n != null);
  return {
    scenario, minutes, tickMinutes, parallel: options.parallel, adaptiveParallel: options.adaptiveParallel, firstOutputMs: options.firstOutputMs, checkMs: options.checkMs,
    tasksSeeded: taskCount,
    board: {
      total: board.tasks.length,
      status: Object.fromEntries(byStatus),
      requests: board.requests.length,
      verifyAttempts: board.tasks.reduce((sum, task) => sum + (task.verifyAttempts ?? 0), 0),
      runFailures: board.tasks.reduce((sum, task) => sum + (task.runFailures ?? 0), 0),
    },
    runs: {
      total: runs.length,
      finished: runs.filter((row) => row.finishedAt).length,
      wedged: runs.filter((row) => row.behavior === "wedged").length,
      meanRunMs: runs.filter((row) => row.ranMs).reduce((sum, row) => sum + row.ranMs, 0) / Math.max(1, runs.filter((row) => row.ranMs).length),
      promptChars: runs.map((row) => row.promptChars).filter(Boolean),
    },
    latency: {
      queueP50: percentile(dispatchLatency, 0.5), queueP90: percentile(dispatchLatency, 0.9),
      runP50: percentile(runSpans, 0.5), verifyP50: percentile(verifySpans, 0.5), verifyP90: percentile(verifySpans, 0.9),
      dispatchP50: percentile(dispatchLatency, 0.5), dispatchP90: percentile(dispatchLatency, 0.9),
      leadP50: percentile(leadTimes, 0.5), leadMax: leadTimes.length ? Math.max(...leadTimes) : null,
      doneCount: leadTimes.length,
    },
    cost: {
      wallMs, boardWrites: counts.boardWrites, timersArmed: counts.timersArmed, staggerMs: counts.staggerMs, kills: counts.kills, checkRuns: counts.checkRuns,
      storeReads: Object.fromEntries([...counts.storeReads].sort((a, b) => b[1] - a[1])),
      roleWakes: Object.fromEntries([...counts.roleWakes].sort((a, b) => b[1] - a[1])),
      phases: Object.fromEntries([...phases].map(([name, row]) => [name, { calls: row.calls, ms: Math.round(row.ms * 10) / 10 }]).sort((a, b) => b[1].ms - a[1].ms)),
      logLines: h.logs.length, policyRecords: h.records.length, historyRows: h.autopilot.history.length,
    },
    status: statusAt,
    spans, transitions,
    events,
    logs: h.logs,
    handoffs: board.requests.map((row) => row.prompt ?? row.title).slice(0, 12),
  };
}

const percentile = (rows, q) => {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const ms = (n) => (n == null ? "—" : n >= MINUTE ? `${(n / MINUTE).toFixed(1)}m` : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);

function report(result, { trace = false } = {}) {
  const lines = [];
  lines.push(`# ${result.scenario} · ${result.minutes}m of loop time · parallel=${result.parallel}${result.adaptiveParallel ? " (adaptive)" : ""} · tick=${result.tickMinutes}m · ${result.tasksSeeded} tasks`);
  lines.push(`board: ${Object.entries(result.board.status).map(([k, v]) => `${k}=${v}`).join(" ")} · requests=${result.board.requests} · verifyAttempts=${result.board.verifyAttempts} · runFailures=${result.board.runFailures}`);
  lines.push(`workers: first output at ${ms(result.firstOutputMs)} (wedged-start budget is 3m)`);
  lines.push(`runs: ${result.runs.total} started, ${result.runs.finished} finished, ${result.runs.wedged} wedged · mean run ${ms(result.runs.meanRunMs)} · prompt ${Math.round(Math.max(0, ...result.runs.promptChars))} chars max`);
  lines.push(`latency: queue→claim p50 ${ms(result.latency.queueP50)} p90 ${ms(result.latency.queueP90)} · claim→report p50 ${ms(result.latency.runP50)} · report→done p50 ${ms(result.latency.verifyP50)} p90 ${ms(result.latency.verifyP90)}`);
  lines.push(`          start→done p50 ${ms(result.latency.leadP50)} max ${ms(result.latency.leadMax)} (${result.latency.doneCount} of ${result.tasksSeeded} settled)`);
  lines.push(`overseer: ${result.cost.checkRuns} verification command run(s) at ${ms(result.checkMs)} each`);
  lines.push(`cost: ${result.cost.boardWrites} board transactions · ${Object.values(result.cost.storeReads).reduce((a, b) => a + b, 0)} store reads · ${result.cost.timersArmed} timers · ${result.cost.logLines} log lines · host cpu ${result.cost.wallMs.toFixed(0)}ms`);
  lines.push(`reads: ${Object.entries(result.cost.storeReads).slice(0, 6).map(([k, v]) => `${k}×${v}`).join(" ")}`);
  lines.push(`phases: ${Object.entries(result.cost.phases).map(([k, v]) => `${k} ${v.calls}×${v.ms}ms`).join(" · ")}`);
  lines.push(`roles woken: ${Object.entries(result.cost.roleWakes).map(([k, v]) => `${k}×${v}`).join(" ") || "—"}`);
  if (result.handoffs.length) lines.push(`queued handoffs: ${result.handoffs.length} · e.g. ${String(result.handoffs[0]).slice(0, 60)}`);
  lines.push("");
  lines.push("  time  building open active verifying done  waiting");
  for (const row of result.status) {
    lines.push(`  ${String(Math.round(row.at / MINUTE)).padStart(4)}m ${String(row.building).padStart(8)} ${String(row.open).padStart(4)} ${String(row.active).padStart(6)} ${String(row.verifying).padStart(9)} ${String(row.done).padStart(4)}  ${row.waiting ?? ""}`);
  }
  if (trace) {
    lines.push("");
    for (const event of result.events) lines.push(`  ${String(Math.round((event.at - 1_000_000) / 1000)).padStart(6)}s ${event.kind.padEnd(9)} ${event.text}`);
  }
  return lines.join("\n");
}

if (flag("--help")) {
  console.log(`node tools/monitor_loop.mjs [--scenario ${Object.keys(SCENARIOS).join("|")}|all] [--minutes 60] [--parallel 3] [--adaptive] [--tick 5] [--tasks 12] [--first-output 20000] [--trace] [--json FILE]`);
  process.exit(0);
}
const scenarioArg = value("--scenario", "steady");
const chosen = scenarioArg === "all" ? Object.keys(SCENARIOS) : [scenarioArg];
for (const name of chosen) if (!SCENARIOS[name]) throw new Error(`Unknown scenario "${name}" (have: ${Object.keys(SCENARIOS).join(", ")}, all)`);
const options = {
  minutes: number("--minutes", 60, { min: 5, max: 600 }),
  tickMinutes: number("--tick", 5, { min: 1, max: 60 }),
  parallel: number("--parallel", 3, { min: 1, max: 12 }),
  adaptiveParallel: flag("--adaptive"),
  taskCount: number("--tasks", 12, { min: 1, max: 200 }),
  checkMs: number("--check-ms", 60000, { min: 0, max: 900000 }),
  firstOutputMs: number("--first-output", FIRST_OUTPUT_MS, { min: 0, max: 900000 }),
  mode: value("--mode", "swarm"),
};
const results = [];
for (const scenario of chosen) {
  const result = await watch({ ...options, scenario });
  results.push(result);
  console.log(report(result, { trace: flag("--trace") }));
  console.log("");
}
const jsonPath = value("--json", null);
if (jsonPath) {
  const output = path.resolve(jsonPath);
  if (!output.startsWith(studio)) throw new Error("--json must stay inside the repository");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n`);
  console.log(`Record: ${path.relative(studio, output)}`);
}
