import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as scanner from "../scripts/first-scan.mjs";
import * as mapper from "../scripts/first-map.mjs";
import * as judge from "../scripts/choice-judge.mjs";
import { createFirstRunService } from "../scripts/first-run-service.mjs";
import worktrees from "../scripts/executor-worktrees.cjs";

// platform.cjs promises that no child Studio starts inherits Studio's own
// MEFI_STUDIO_*_KEY / _TOKEN credentials. The children below used to reach
// node's spawn directly with the whole host environment. Each test starts a
// real process that reports what it was given; nothing is mocked but the
// command it runs.
const KEY = "MEFI_STUDIO_TEST_KEY";
const SECRET = "mefi-test-secret-4242";
// A non-credential MEFI_STUDIO_ setting, which must still pass through.
const SETTING = "MEFI_STUDIO_TEST_SETTING";
// cmd.exe's `set` and POSIX `env` print the environment they were started with.
const PRINT_ENV = process.platform === "win32" ? "set" : "env";

const run = promisify(execFile);
const git = (dir, ...args) => run("git", ["-C", dir, ...args]);

function hostEnv(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

function assertWithheld(result) {
  assert.equal(result.code, 0, result.error ?? result.stderr);
  assert.ok(result.stdout.includes(`${SETTING}=kept`), "the rest of the environment reaches the child");
  assert.ok(!result.stdout.includes(SECRET) && !result.stdout.includes(KEY), `${KEY} reached the child`);
}

// main.cjs's judge transport hands spawnExec { ...process.env, ...executorOpencodeEnv() }.
test("first-scan's spawnExec withholds Studio's credentials from an environment it is handed", async () => {
  const result = await scanner.spawnExec(PRINT_ENV, [], { env: { ...process.env, [KEY]: SECRET, [SETTING]: "kept" }, timeoutMs: 15000 });
  assertWithheld(result);
});

test("first-scan's spawnExec withholds them from its default, the host environment", async (t) => {
  hostEnv(t, { [KEY]: SECRET, [SETTING]: "kept" });
  assertWithheld(await scanner.spawnExec(PRINT_ENV, [], { timeoutMs: 15000 }));
});

// main.cjs builds the first-run service with neither `exec` nor `env`, so the
// scan and the first map run through scanner.spawnExec with process.env.
test("the first-run service's default exec and env withhold them", async (t) => {
  hostEnv(t, { [KEY]: SECRET, [SETTING]: "kept" });
  let seen = null;
  const probe = {
    ...scanner,
    async runFirstScan(options) {
      seen = await options.exec(PRINT_ENV, [], { env: options.env, platform: options.platform, timeoutMs: 15000 });
      // The rest of the scan answers as a machine without OpenCode would.
      return scanner.runFirstScan({ ...options, exec: async () => ({ code: 1, stdout: "", stderr: "", timedOut: false, error: "not installed" }) });
    },
  };
  const service = createFirstRunService({
    scanner: probe, mapper, judge,
    readSettings: async () => ({}),
    writeSettings: async () => {},
    projects: { current: () => ({ id: "project_1", name: "probe", path: os.tmpdir() }), open: () => false },
  });
  assert.equal((await service.scan()).ok, true);
  assertWithheld(seen);
});

// An executor worktree run's git children. The post-checkout hook that
// `git worktree add` fires inherits git's own environment and writes down
// what it received.
test("an executor worktree's git children inherit the host environment minus Studio's credentials", async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "mefi-cred-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await git(repo, "init", "-q");
  await git(repo, "config", "user.email", "fixture@example.com");
  await git(repo, "config", "user.name", "Fixture");
  await writeFile(path.join(repo, "file.txt"), "one\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-q", "-m", "init");
  const hooks = path.join(repo, ".git", "hooks");
  const out = path.join(repo, ".git", "hook-env.txt").replace(/\\/g, "/");
  await mkdir(hooks, { recursive: true });
  await writeFile(path.join(hooks, "post-checkout"),
    "#!/bin/sh\nprintf '%s|%s' \"${" + KEY + "-absent}\" \"${" + SETTING + "-absent}\" > '" + out + "'\n", { mode: 0o755 });
  // A machine-wide core.hooksPath would otherwise bypass .git/hooks.
  await git(repo, "config", "core.hooksPath", hooks.replace(/\\/g, "/"));

  hostEnv(t, { [KEY]: SECRET, [SETTING]: "kept" });
  const wt = await worktrees.prepare({ root: repo, runId: "run_cred" });
  t.after(() => worktrees.discard(wt));
  let written = null;
  try { written = await readFile(out, "utf8"); } catch {}
  assert.ok(written !== null, "the post-checkout hook ran under `git worktree add`");
  assert.equal(written, `absent|kept`);
});
