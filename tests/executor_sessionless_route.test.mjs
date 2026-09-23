import test from "node:test";
import assert from "node:assert/strict";
import { executorHost } from "./fixtures/host_executor.mjs";

// Builders other than OpenCode (claude, grok, codex, antigravity) write no
// OpenCode session, and verification only trusts session-attributed evidence.
// Such a run used to spend its three verification retries waiting for proof
// that can never appear, then park. It now parks for the owner at once, with
// a reason that says why, and is never blindly re-run.
const task = (id) => ({ id, title: `Sessionless fixture ${id}`, prompt: `Finish ${id}.`, status: "open", createdAt: 1, files: [`src/${id}.js`] });

async function runOnce(route) {
  const h = executorHost({ tasks: [task("cli"), task("next")] });
  h.env.executorRunEnv = async () => route;
  // The CLI command builder's model-argument filter sits outside the host
  // sections the fixture lifts; mirror it for the claude route.
  h.env.cliModelArg = (value) => /^[A-Za-z0-9._:/-]{1,80}$/.test(String(value ?? "")) ? String(value) : "";
  assert.equal(await h.env.spawnNextJob(), "spawned");
  const entry = h.autopilot.jobs[0];
  entry.child.stdout.emit("data", "MEFI_JOB_DONE\n");
  await entry.reap(0);
  return { h, entry };
}

test("a claude builder run that reports done parks for the owner instead of retrying", async () => {
  const { h } = await runOnce({ cli: "claude", via: "claude cli", modelArgs: "", env: {} });
  let row = h.board().tasks.find((item) => item.id === "cli");
  assert.equal(row.status, "awaiting_verification", "a reported finish is never done by itself");
  assert.equal(row.lastAttempt.route, "claude");
  h.advance(31000); h.wake(); await h.pump();
  row = h.board().tasks.find((item) => item.id === "cli");
  assert.equal(row.status, "open");
  assert.equal(row.verification.state, "failed");
  assert.match(row.verification.reason, /claude runs leave no session the verifier can read/);
  assert.equal(row.nextRunAt, undefined, "no scheduled blind retry");
  assert.equal(row.verifyAttempts, 1, "one attempt spent, not the whole budget");
  assert.ok(!h.starts.some((start) => start.taskId === "cli" && start !== h.starts[0]), "the parked task is not dispatched again");
});

test("an OpenCode run without a session keeps the ordinary bounded retry", async () => {
  const { h } = await runOnce({ via: "fixture", modelArgs: "", env: {} });
  assert.equal(h.board().tasks.find((item) => item.id === "cli").lastAttempt.route, "opencode");
  h.advance(31000); h.wake(); await h.pump();
  const row = h.board().tasks.find((item) => item.id === "cli");
  assert.equal(row.verification.state, "unverified");
  assert.match(row.verification.reason, /no session-attributed completion evidence/);
  assert.ok(row.nextRunAt > h.now(), "an OpenCode session can still appear, so it retries");
});
