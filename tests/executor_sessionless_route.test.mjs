import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { executorHost } from "./fixtures/host_executor.mjs";

// The host's own model-id filters (main.cjs), lifted as they are: they are
// the only thing between a saved builder model and cmd.exe's command string.
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const lift = (name) => {
  const from = source.indexOf(`function ${name}(`), to = source.indexOf("\n}\n", from);
  assert.ok(from >= 0 && to > from, `host filter exists: ${name}`);
  return vm.runInNewContext(`${source.slice(from, to + 2)}\n${name}`);
};
const cliModelArg = lift("cliModelArg");
const agyModelArg = lift("agyModelArg");

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
  // sections the fixture lifts; lift the real one for the claude route.
  h.env.cliModelArg = cliModelArg;
  assert.equal(await h.env.spawnNextJob(), "spawned");
  const entry = h.autopilot.jobs[0];
  entry.child.stdout.emit("data", "MEFI_JOB_DONE\n");
  await entry.reap(0);
  return { h, entry };
}

test("the host's model-id filters keep real ids and refuse anything cmd.exe could read as a command", () => {
  for (const id of ["claude-opus-5-5", "gpt-6-luna", "opencode-go/kimi-k2.6", "mefi-zai/glm-5.3"]) assert.equal(cliModelArg(id), id);
  for (const id of ["x && del C:\\", "a b", 'm"', "m|more", "m>out", "m&calc", "", null, "m".repeat(81)]) assert.equal(cliModelArg(id), "", String(id));
  assert.equal(agyModelArg("Gemini 3.1 Pro (High)"), "Gemini 3.1 Pro (High)", "agy display names keep their spaces");
  for (const id of ['Gemini" & calc', "g|x", "g&x", "g>x"]) assert.equal(agyModelArg(id), "", id);
});

test("a hostile saved builder model never reaches the claude or codex command string", async () => {
  for (const cli of ["claude", "codex"]) {
    const h = executorHost({ tasks: [task("cli")] });
    h.env.executorRunEnv = async () => ({ cli, via: `${cli} cli`, model: "x && del /q C:\\work", modelArgs: "", env: {} });
    h.env.cliModelArg = cliModelArg;
    const commands = [];
    const spawn = h.env.spawn;
    h.env.spawn = (command, args, options) => { if (command === "cmd.exe") commands.push(args.join(" ")); return spawn(command, args, options); };
    assert.equal(await h.env.spawnNextJob(), "spawned");
    assert.equal(commands.length, 1);
    assert.doesNotMatch(commands[0], /del|&&|--model|\s-m\s/, commands[0]);
  }
});

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
