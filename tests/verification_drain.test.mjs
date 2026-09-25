// The overseer's verification drain: bounded-parallel job execution and the
// coalesced settle kick after results land. Memory-only stores, no real child
// processes or timers.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import agentModes from "../scripts/agent-modes.cjs";
import platform from "../scripts/platform.cjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const from = source.indexOf("const verificationJobs = [];");
const to = source.indexOf("// A finished run's handoffs:", from);
assert.ok(from >= 0 && to > from, "the verification drain boundary exists");
const DRAIN = `${source.slice(from, to)}
globalThis.__queueVerification = (job) => verificationJobs.push(job);
globalThis.__verificationQueue = verificationJobs;`;

// `platform` is what the drain reads as process.platform; `shim` wraps the
// recording spawn the way main.cjs's spawn wraps node's (scripts/platform.cjs).
function drainHost({ tasks = [], requests = [], platform = "win32", shim = (spawn) => spawn } = {}) {
  let board = structuredClone({ tasks, requests });
  const logs = [];
  const spawns = [];
  const timers = [];
  const housekeeping = [];
  // Roots that would actually host an npm script; tests can change this to
  // verify that missing local scripts never borrow another project's checks.
  const pkgRoots = new Set(["C:/fixture-root", "C:/fixture-studio"]);
  const env = vm.createContext({
    process: { platform },
    // Every command is a controllable child: the test closes it by hand. A
    // check is spawn(command, [], options); a tree kill is spawn(exe, args, options).
    spawn: shim((command, argsOrOptions, maybeOptions) => {
      const options = Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions;
      const child = new EventEmitter();
      child.command = String(command);
      child.args = Array.isArray(argsOrOptions) ? [...argsOrOptions] : [];
      child.rawArgs = argsOrOptions;
      child.options = options;
      child.pid = 4100 + spawns.length;
      child.cwd = options?.cwd;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = false;
      child.kill = () => { child.killed = true; };
      child.close = (code, signal = null) => child.emit("close", code, signal);
      spawns.push(child);
      return child;
    }),
    setTimeout: (fn, delay) => {
      const timer = { fn, delay, cancelled: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => { if (timer) timer.cancelled = true; },
    mutateBoard: async (mutator) => {
      const next = structuredClone(board);
      const result = mutator(next);
      if (result) board = result;
      return structuredClone(board);
    },
    logLine: (text) => logs.push(String(text)),
    projectRoot: () => "C:/fixture-root",
    SOURCE_ROOT: "C:/fixture-studio",
    STUDIO_ROOT: "C:/fixture-payload",
    hasPackageJson: (dir) => pkgRoots.has(dir),
    agentModes,
    autopilotHousekeeping: async () => { housekeeping.push(true); },
  });
  vm.runInContext(DRAIN, env);
  return {
    env, spawns, timers, logs, housekeeping, pkgRoots,
    board: () => structuredClone(board),
    queue: (job) => env.__queueVerification(job),
    queued: () => env.__verificationQueue.length,
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    settleTimer: () => timers.find((timer) => timer.delay === 1000 && !timer.cancelled),
  };
}

test("verification jobs run two at a time so a done-report burst does not stack behind one check", async () => {
  const host = drainHost();
  for (const id of ["one", "two", "three"]) host.queue({ key: `k-${id}`, taskId: `t-${id}`, commands: [`check-${id}`] });
  const drain = host.env.runVerificationJobs();
  assert.deepEqual(host.spawns.map((child) => child.command), ["check-one", "check-two"], "the first pair starts together");
  host.spawns[0].close(0);
  await host.flush();
  assert.deepEqual(host.spawns.map((child) => child.command), ["check-one", "check-two", "check-three"], "the freed slot picks the next job up before the drain ends");
  host.spawns[1].close(0);
  host.spawns[2].close(0);
  await drain;
  assert.equal(host.queued(), 0, "the drain consumed the queue");
  assert.equal(host.logs.filter((line) => line.includes("verification run passed")).length, 3);
});

test("commands stay sequential inside a job and a failed check stamps the card", async () => {
  const host = drainHost({ tasks: [{ id: "t-one", title: "One", verificationRun: { key: "k-one", state: "queued" } }] });
  host.queue({ key: "k-one", taskId: "t-one", commands: ["npm run check", "node --test tests/one.test.mjs"] });
  const drain = host.env.runVerificationJobs();
  assert.deepEqual(host.spawns.map((child) => child.command), ["npm run check"], "the focused test waits for the check");
  host.spawns[0].stderr.emit("data", "1 failing test\n");
  host.spawns[0].close(1);
  await drain;
  assert.equal(host.spawns.length, 1, "the focused test never runs after the check fails");
  const task = host.board().tasks[0];
  assert.equal(task.verificationRun.state, "failed");
  assert.equal(task.verificationRun.results.length, 1);
  assert.match(task.verificationRun.results[0].tail, /1 failing test/);
  assert.equal(task.logs, undefined, "the stamp alone records the result: a task log line would cost a whole-task revision");
});

// Only tasks run, so only a task's attempt queues an overseer run. A result
// lands on the task it was queued for and nowhere else, not even on an inbox
// row an older build keyed the same way.
test("an overseer result stamps only the task it was queued for, never an inbox row", async () => {
  const request = { at: 7, prompt: "Do work", title: "Req", verificationRun: { key: "k-req", state: "queued" } };
  const host = drainHost({ tasks: [{ id: "t-req", title: "Req", verificationRun: { key: "k-task", state: "queued" } }], requests: [request] });
  host.queue({ key: "k-req", taskId: agentModes.requestKey(request), commands: ["npm run check"] });
  const legacy = host.env.runVerificationJobs();
  host.spawns[0].close(0);
  await legacy;
  assert.deepEqual(host.board().requests[0], request, "the inbox row is untouched");
  host.queue({ key: "k-task", taskId: "t-req", commands: ["npm run check"] });
  const drain = host.env.runVerificationJobs();
  host.spawns.at(-1).close(0);
  await drain;
  assert.equal(host.board().tasks[0].verificationRun.state, "passed");
});

test("a landed result kicks one coalesced housekeeping pass instead of waiting for the next autopilot tick", async () => {
  const host = drainHost();
  host.queue({ key: "k-a", taskId: "t-a", commands: ["check-a"] });
  host.queue({ key: "k-b", taskId: "t-b", commands: ["check-b"] });
  const drain = host.env.runVerificationJobs();
  host.spawns[0].close(0);
  host.spawns[1].close(0);
  await drain;
  assert.equal(host.housekeeping.length, 0, "the pass waits for its debounce timer");
  const timer = host.settleTimer();
  assert.ok(timer, "a settle timer was armed");
  assert.equal(host.timers.filter((row) => row.delay === 1000 && !row.cancelled).length, 1, "both results share one timer");
  timer.fn();
  await host.flush();
  assert.equal(host.housekeeping.length, 1, "one housekeeping pass settles the batch");
});

// Checking Studio cannot prove a different project's result. A misplaced npm
// command must fail explicitly in its own project without spawning elsewhere.
test("npm verification without a local package.json fails without checking the Studio checkout", async () => {
  const host = drainHost({ tasks: [{ id: "t-game", title: "Game fix", verificationRun: { key: "k-game", state: "queued" } }] });
  host.queue({ key: "k-game", taskId: "t-game", projectPath: "C:/game checkout", commands: ["npm run check"] });
  await host.env.runVerificationJobs();
  assert.equal(host.spawns.length, 0, "no command runs in Studio or the package-free project");
  const run = host.board().tasks[0].verificationRun;
  assert.equal(run.state, "failed");
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].command, "npm run check");
  assert.equal(run.results[0].cwd, "C:/game checkout");
  assert.equal(run.results[0].ok, false);
  assert.match(run.results[0].tail, /package\.json/i);
  assert.ok(host.logs.some((line) => line.includes("verification run failed")));
  assert.equal(host.logs.some((line) => line.includes("verification run passed")), false);
  assert.ok(host.settleTimer(), "the failed result is available to the normal settlement pass");
});

test("a project that defines its own npm scripts keeps its own root", async () => {
  const host = drainHost();
  host.queue({ key: "k-app", taskId: "t-app", projectPath: "C:/fixture-root", commands: ["npm run check"] });
  const drain = host.env.runVerificationJobs();
  host.spawns[0].close(0);
  await drain;
  assert.equal(host.spawns[0].cwd, "C:/fixture-root");
  assert.equal(host.logs.some((line) => line.includes("has no package.json")), false, "no move was logged");
});

// The project's own wrapper check is a relative -File, so the project itself
// must stay the cwd even where no package.json exists; moving the job to the
// Studio checkout made PowerShell exit 0xFFFD0000 hunting for test\run-check.ps1.
test("a project's own wrapper check keeps the project root even without package.json", async () => {
  const host = drainHost({ tasks: [{ id: "t-love", title: "Game fix", verificationRun: { key: "k-love", state: "queued" } }] });
  host.queue({ key: "k-love", taskId: "t-love", projectPath: "C:/game checkout", commands: ['powershell -NoProfile -ExecutionPolicy Bypass -File "test\\run-check.ps1"'] });
  const drain = host.env.runVerificationJobs();
  host.spawns[0].close(0);
  await drain;
  assert.equal(host.spawns[0].cwd, "C:/game checkout", "the relative wrapper resolves against the project, so it stays the cwd");
  assert.equal(host.logs.some((line) => line.includes("has no package.json")), false, "no move was logged");
  assert.equal(host.board().tasks[0].verificationRun.state, "passed", "the check itself still settles the card");
});

// The job carries its own card's project; a job without one (a request row
// with no project path) runs in the active root, whatever started the drain.
test("each job runs in its own project, and a pathless job in the active root", async () => {
  const host = drainHost();
  host.queue({ key: "k-own", taskId: "t-own", projectPath: "C:/game checkout", commands: ['powershell -NoProfile -File "test\\run-check.ps1"'] });
  host.queue({ key: "k-bare", taskId: "t-bare", projectPath: null, commands: ["npm run check"] });
  const drain = host.env.runVerificationJobs();
  host.spawns[0].close(0);
  host.spawns[1].close(0);
  await drain;
  assert.deepEqual(host.spawns.map((child) => child.cwd), ["C:/game checkout", "C:/fixture-root"]);
});

test("a missing Studio npm checkout never redirects project verification into the app payload", async () => {
  const host = drainHost({ tasks: [{ id: "t-orphan", title: "Other project", verificationRun: { key: "k-orphan", state: "queued" } }] });
  host.pkgRoots.delete("C:/fixture-studio");
  host.queue({ key: "k-orphan", taskId: "t-orphan", projectPath: "C:/game checkout", commands: ["npm run check"] });
  await host.env.runVerificationJobs();
  assert.equal(host.spawns.length, 0);
  const run = host.board().tasks[0].verificationRun;
  assert.equal(run.state, "failed");
  assert.equal(run.results[0].cwd, "C:/game checkout");
  assert.equal(run.results[0].ok, false);
  assert.match(run.results[0].tail, /package\.json/i);
});

test("a project with no supported verification command gets an explicit failed result", async () => {
  const host = drainHost({ tasks: [{ id: "t-empty", title: "Static project", verificationRun: { key: "k-empty", state: "queued" } }] });
  host.queue({ key: "k-empty", taskId: "t-empty", projectPath: "C:/static project", commands: [] });
  await host.env.runVerificationJobs();
  assert.equal(host.spawns.length, 0);
  assert.equal(host.queued(), 0);
  const run = host.board().tasks[0].verificationRun;
  assert.equal(run.state, "failed", "a zero-command job cannot remain queued or become a vacuous pass");
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].ok, false);
  assert.equal(run.results[0].cwd, "C:/static project");
  assert.match(run.results[0].tail, /no .*?(?:command|check)|(?:command|check).*?(?:missing|found|available|supported)/i);
  assert.ok(host.settleTimer());
});

test("a Node test command in a package-free project checks that project's files", async () => {
  const host = drainHost({ tasks: [{ id: "t-node", title: "Node game", verificationRun: { key: "k-node", state: "queued" } }] });
  host.queue({ key: "k-node", taskId: "t-node", projectPath: "C:/plain node project", commands: ["node --test tests/game.test.mjs"] });
  const drain = host.env.runVerificationJobs();
  assert.equal(host.spawns.length, 1);
  assert.equal(host.spawns[0].command, "node --test tests/game.test.mjs");
  assert.equal(host.spawns[0].cwd, "C:/plain node project");
  host.spawns[0].stdout.emit("data", "game rules passed\n");
  host.spawns[0].close(0);
  await drain;
  const run = host.board().tasks[0].verificationRun;
  assert.equal(run.state, "passed");
  assert.equal(run.results[0].cwd, "C:/plain node project");
  assert.equal(run.results[0].ok, true);
  assert.match(run.results[0].tail, /game rules passed/);
});

// A burst of done reports schedules the same base check once per card. One
// execution that started at or after a job was created covers that job's
// edits, so it is shared; a job created after the check started is not.
test("identical base checks across a burst of done reports share one execution, focused tests stay per job", async () => {
  const host = drainHost({ tasks: [
    { id: "t-a", title: "A", verificationRun: { key: "k-a", state: "queued" } },
    { id: "t-b", title: "B", verificationRun: { key: "k-b", state: "queued" } },
  ] });
  const created = Date.now() - 1000;
  host.queue({ key: "k-a", taskId: "t-a", projectPath: "C:/fixture-root", commands: ["npm run check"], createdAt: created });
  host.queue({ key: "k-b", taskId: "t-b", projectPath: "C:/fixture-root", commands: ["npm run check", "node --test tests/b.test.mjs"], createdAt: created });
  const drain = host.env.runVerificationJobs();
  assert.deepEqual(host.spawns.map((child) => child.command), ["npm run check"], "the second job joins the base check already running for the first");
  host.spawns[0].close(0);
  await host.flush();
  assert.deepEqual(host.spawns.map((child) => child.command), ["npm run check", "node --test tests/b.test.mjs"], "the focused test still runs for its own job after the shared check");
  host.spawns[1].close(0);
  await drain;
  const [a, b] = host.board().tasks;
  assert.equal(a.verificationRun.state, "passed");
  assert.equal(b.verificationRun.state, "passed");
  assert.equal(b.verificationRun.results[0].shared, true, "the joined result is marked as shared");
  assert.equal(a.verificationRun.results[0].shared, undefined);
  assert.equal(host.logs.filter((line) => line.includes("verification run passed")).length, 2, "every card still gets its own settled run");
  assert.ok(host.logs.some((line) => line.includes("shared with a sibling run")));
  // A job created after that check started cannot borrow it: its edits are newer.
  host.queue({ key: "k-c", taskId: "t-c", projectPath: "C:/fixture-root", commands: ["npm run check"], createdAt: Date.now() + 5000 });
  const again = host.env.runVerificationJobs();
  assert.equal(host.spawns.length, 3, "a later attempt gets a fresh check");
  host.spawns[2].close(0);
  await again;
});

test("a base check that failed is shared as a failure, never re-run per card", async () => {
  const host = drainHost({ tasks: [
    { id: "t-a", title: "A", verificationRun: { key: "k-a", state: "queued" } },
    { id: "t-b", title: "B", verificationRun: { key: "k-b", state: "queued" } },
  ] });
  const created = Date.now() - 1000;
  host.queue({ key: "k-a", taskId: "t-a", projectPath: "C:/fixture-root", commands: ["npm run check"], createdAt: created });
  host.queue({ key: "k-b", taskId: "t-b", projectPath: "C:/fixture-root", commands: ["npm run check"], createdAt: created });
  const drain = host.env.runVerificationJobs();
  host.spawns[0].stderr.emit("data", "css merge failed\n");
  host.spawns[0].close(1);
  await drain;
  assert.equal(host.spawns.length, 1);
  for (const task of host.board().tasks) {
    assert.equal(task.verificationRun.state, "failed");
    assert.match(task.verificationRun.results[0].tail, /css merge failed/);
  }
});

test("identical verification commands never share in-flight or cached results across project roots", async () => {
  const host = drainHost({ tasks: [
    { id: "t-first", title: "First", verificationRun: { key: "k-first", state: "queued" } },
    { id: "t-second", title: "Second", verificationRun: { key: "k-second", state: "queued" } },
    { id: "t-third", title: "Third", verificationRun: { key: "k-third", state: "queued" } },
  ] });
  const roots = ["C:/fixture-root", "C:/second project", "C:/third project"];
  for (const root of roots) host.pkgRoots.add(root);
  const createdAt = Date.now() - 1000;
  host.queue({ key: "k-first", taskId: "t-first", projectPath: roots[0], commands: ["npm run check"], createdAt });
  host.queue({ key: "k-second", taskId: "t-second", projectPath: roots[1], commands: ["npm run check"], createdAt });
  const drain = host.env.runVerificationJobs();
  assert.deepEqual(host.spawns.map((child) => child.cwd), roots.slice(0, 2), "the second project cannot join the first project's in-flight check");
  host.spawns[0].stdout.emit("data", "first project passed\n");
  host.spawns[1].stderr.emit("data", "second project failed\n");
  host.spawns[0].close(0);
  host.spawns[1].close(1);
  await drain;
  const [first, second] = host.board().tasks;
  assert.equal(first.verificationRun.state, "passed");
  assert.equal(second.verificationRun.state, "failed");
  for (const [index, task] of [first, second].entries()) {
    assert.equal(task.verificationRun.results[0].cwd, roots[index]);
    assert.equal(task.verificationRun.results[0].shared, undefined);
  }
  assert.match(second.verificationRun.results[0].tail, /second project failed/);
  host.queue({ key: "k-third", taskId: "t-third", projectPath: roots[2], commands: ["npm run check"], createdAt });
  const later = host.env.runVerificationJobs();
  assert.equal(host.spawns.length, 3, "a third project cannot borrow either cached result");
  assert.equal(host.spawns[2].cwd, roots[2]);
  host.spawns[2].close(0);
  await later;
  const third = host.board().tasks[2].verificationRun;
  assert.equal(third.state, "passed");
  assert.equal(third.results[0].cwd, roots[2]);
  assert.equal(third.results[0].shared, undefined);
});

// A shell check's work runs in grandchildren (npm, node, electron). Killing
// only cmd.exe left them holding the inherited pipes, so 'close' never came
// and the drain worker was held for good, with every later job queued behind.
const BUDGET_MS = 15 * 60 * 1000;
const GRACE_MS = 15 * 1000; // VERIFICATION_KILL_GRACE_MS
const graceTimers = (host) => host.timers.filter((timer) => timer.delay === GRACE_MS);
const hungCheck = () => {
  const host = drainHost({ tasks: [{ id: "t-hang", title: "Hang", verificationRun: { key: "k-hang", state: "queued" } }] });
  host.queue({ key: "k-hang", taskId: "t-hang", commands: ["npm run check"] });
  const drain = host.env.runVerificationJobs();
  const check = host.spawns[0];
  const budget = host.timers.find((timer) => timer.delay === BUDGET_MS);
  assert.ok(budget, "the check runs on its command budget");
  budget.fn();
  return { host, drain, check };
};

test("a timed-out check has its whole process tree ended, not just the shell", () => {
  const { host, check } = hungCheck();
  const killer = host.spawns[1];
  assert.equal(killer.command, "taskkill");
  assert.deepEqual(killer.args, ["/pid", String(check.pid), "/t", "/f"], "the tree kill the executor uses for its own workers");
  assert.equal(check.killed, false, "cmd.exe alone is not what gets killed");
  killer.emit("close", 128);
  assert.equal(check.killed, true, "a tree kill that failed still ends the shell");
});

test("a timed-out check whose close never arrives still settles, recorded as timed out", async () => {
  const { host, drain, check } = hungCheck();
  const [grace] = graceTimers(host);
  assert.ok(grace && !grace.cancelled, "a hard timer backs the tree kill");
  grace.fn();
  await drain;
  const task = host.board().tasks[0];
  assert.equal(task.verificationRun.state, "failed");
  assert.equal(task.verificationRun.results[0].timedOut, true);
  assert.equal(task.verificationRun.results[0].tail, "timed out after 15m");
  assert.ok(host.logs.some((line) => line.includes("npm run check failed (timed out)")));
  check.close(1);
  await host.flush();
  assert.equal(host.board().tasks[0].verificationRun.results.length, 1, "a late close changes nothing");
});

test("a check that closes after its tree kill is recorded as timed out, not as an ordinary failure", async () => {
  const { host, drain, check } = hungCheck();
  check.close(1, null); // taskkill /f ends cmd.exe with a plain exit code
  await drain;
  const result = host.board().tasks[0].verificationRun.results[0];
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
  assert.equal(result.tail, "timed out after 15m");
  assert.equal(graceTimers(host).length, 1);
  assert.ok(graceTimers(host).every((timer) => timer.cancelled), "the hard timer is cleared once close lands");
});

// A check runs a script the worker may have just edited (the project's npm
// check, or a test file it listed as ran). spawn(command, options) put the
// options where scripts/platform.cjs does not filter, so the check inherited
// every MEFI_STUDIO_* credential Studio was started with.
test("a check hands spawn an explicit args array, so the platform shim withholds Studio's credentials from it", async () => {
  const bare = drainHost();
  bare.queue({ key: "k-env", taskId: "t-env", commands: ["npm run check"] });
  const first = bare.env.runVerificationJobs();
  const [check] = bare.spawns;
  assert.ok(Array.isArray(check.rawArgs) && check.rawArgs.length === 0, "not spawn(command, options)");
  assert.equal(check.options.shell, true);
  assert.equal(check.options.detached, false, "on Windows the check stays attached to Studio");
  check.close(0);
  await first;

  const shimmed = drainHost({ shim: (spawnImpl) => platform.createSpawn({ platform: "win32", spawnImpl, env: { PATH: "C:/bin", MEFI_STUDIO_ZAI_KEY: "own-zai" } }) });
  shimmed.queue({ key: "k-env", taskId: "t-env", commands: ["npm run check"] });
  const second = shimmed.env.runVerificationJobs();
  const [real] = shimmed.spawns;
  assert.deepEqual(real.options.env, { PATH: "C:/bin" }, "the child's environment has no Studio credential");
  assert.equal(real.options.cwd, "C:/fixture-root");
  real.close(0);
  await second;
});

// Off Windows the shim turns taskkill /t /f into kill(-pid): a signal to the
// process group the pid leads. A check spawned attached leads no group, so the
// group signal found nothing, the shell alone was killed, and npm, node and
// electron kept running with the pipes open.
test("off Windows a check leads its own process group, so the timeout's tree kill ends npm and node too", async () => {
  const kills = [];
  const host = drainHost({
    platform: "linux",
    tasks: [{ id: "t-hang", title: "Hang", verificationRun: { key: "k-hang", state: "queued" } }],
    shim: (spawnImpl) => platform.createSpawn({ platform: "linux", spawnImpl, env: {}, kill: (pid, signal) => {
      kills.push([pid, signal]);
      // POSIX: a negative pid names a process group, which only a detached
      // (setsid) child leads.
      if (pid < 0 && !host.spawns.find((child) => child.pid === -pid)?.options?.detached) throw Object.assign(new Error("no such process group"), { code: "ESRCH" });
    } }),
  });
  host.queue({ key: "k-hang", taskId: "t-hang", commands: ["npm run check"] });
  const drain = host.env.runVerificationJobs();
  const [check] = host.spawns;
  assert.equal(check.command, "npm run check", "a plain shell check passes through the shim");
  assert.equal(check.options.shell, true);
  assert.equal(check.options.detached, true, "the shell leads a group holding everything it starts");
  host.timers.find((timer) => timer.delay === BUDGET_MS).fn();
  assert.deepEqual(kills, [[-check.pid, "SIGKILL"]], "one signal to the whole group, not a fallback to the shell's own pid");
  assert.equal(host.spawns.length, 1, "taskkill is translated, never spawned");
  check.close(null, "SIGKILL");
  await drain;
  const result = host.board().tasks[0].verificationRun.results[0];
  assert.equal(result.timedOut, true);
  assert.equal(result.tail, "timed out after 15m");
});

test("the settle kick keeps the earliest requested moment and never arms a second timer", () => {
  const host = drainHost();
  host.env.kickVerificationSettlement(31000);
  host.env.kickVerificationSettlement(1000);
  host.env.kickVerificationSettlement(5000);
  const live = host.timers.filter((timer) => !timer.cancelled);
  assert.equal(live.length, 1, "one timer stays armed");
  assert.ok(live[0].delay <= 1000 && live[0].delay >= 900, `the earlier request wins (${live[0].delay}ms)`);
  assert.equal(host.timers.length, 2, "the later request was replaced, the still-later one folded in");
});
