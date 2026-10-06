// Live progress on the real dispatch path (spawnNextJob in the executor host
// fixture, with main.cjs's "live progress" block loaded beside it): a Claude
// Code run streams stream-json under a session id Studio chose, the decoder
// hands wire()'s take() the same lines text mode gave, and the run's session,
// todos, tool and usage land on the entry and its checkpoint. The switch off
// keeps the text-mode command line, and Codex's app server is untouched.
// No real CLI, file or model request.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { executorHost } from "./fixtures/host_executor.mjs";

const require = createRequire(import.meta.url);
const cliStream = require("../scripts/cli-stream.cjs");
const executorCore = require("../scripts/executor-core.cjs");
const executorResume = require("../scripts/executor-resume.cjs");

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const liveBlock = section("// ---- live progress: Claude Code and Codex runs as event streams", "// ---- end of live progress");
const filters = section("function cliModelArg(", "// The Claude Code CLI as an assistant route");
const card = (id) => ({ id, title: `Fixture card ${id}`, prompt: `Build ${id} as its brief says.`, status: "open", createdAt: 1, files: [`src/${id}.js`] });
const opencodeFallback = { cli: "opencode", via: "opencode default", modelArgs: "", env: {} };
const jsonl = (...events) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";

function liveHost({ settings = null, env = {}, route = { via: "claude cli", cli: "claude", model: "sonnet", modelArgs: "", env: {}, opencode: opencodeFallback } } = {}) {
  const h = executorHost({ tasks: [card("lp")], ...(settings ? { savedSettings: settings } : {}) });
  vm.runInContext(filters, h.env);
  h.env.executorRunEnv = async () => route;
  h.env.cliStream = cliStream;
  h.env.process = { ...h.env.process, env: { ...(h.env.process?.env ?? {}), ...env } };
  vm.runInContext(liveBlock, h.env);
  const emitted = [];
  h.env.emitAutopilot = () => emitted.push(true);
  return { h, emitted };
}

test("a Claude Code run streams its steps: the session, todos, tool and usage land on the run, and its sentinel still counts", async () => {
  const { h, emitted } = liveHost();
  assert.equal(await h.env.spawnNextJob(), "spawned");
  const entry = h.autopilot.jobs[0];
  assert.equal(entry.liveProgress, true);
  assert.equal(entry.liveStream.format, "claude");
  assert.equal(entry.bufferedOutput, false, "a streaming Claude run keeps the start watchdog");
  const sessionId = "6f1d0c9e-2b8a-4a51-9a33-9d0c2f3e4b5a";
  // The stream arrives in chunks that cut an event mid-line.
  const opening = jsonl(
    { type: "system", subtype: "init", session_id: sessionId, model: "claude-sonnet-4-5" },
    { type: "assistant", message: { id: "m1", usage: { input_tokens: 4, output_tokens: 2, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
      content: [{ type: "tool_use", id: "todo", name: "TodoWrite", input: { todos: [{ content: "Fix", status: "completed" }, { content: "Test", status: "in_progress" }] } }] } },
    { type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "npm test", description: "Run the tests" } }] } },
  );
  entry.child.stdout.emit("data", opening.slice(0, -40));
  assert.ok(!entry.activeTool, "half an event is not read");
  entry.child.stdout.emit("data", opening.slice(-40));
  assert.equal(entry.cliSession.id, sessionId);
  assert.equal(entry.cliSession.model, "sonnet", "the model the route asked for, which a resume is compared with");
  assert.deepEqual(entry.todos, [{ content: "Fix", status: "completed" }, { content: "Test", status: "in_progress" }]);
  assert.equal(entry.progress, 0.5);
  assert.equal(entry.activeTool?.tool, "Bash");
  assert.equal(entry.activeTool?.description, "Run the tests");
  assert.deepEqual(entry.cliUsage, { input: 4, output: 2, cacheRead: 800, cacheCreate: 0 });
  assert.ok(emitted.length >= 2, "a tool and a todo list are pushed");
  const saved = executorResume.checkpoint(entry, 5);
  assert.equal(saved.cliSession.id, sessionId);
  assert.deepEqual(saved.usage, { input: 4, output: 2, cacheRead: 800, cacheCreate: 0 });
  assert.deepEqual(saved.todos.map((todo) => todo.status), ["completed", "in_progress"]);
  entry.child.stdout.emit("data", jsonl(
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b1", content: "ok" }] } },
    { type: "assistant", message: { id: "m3", content: [{ type: "text", text: "All green.\nMEFI_RESULT: done: fixed it; remaining: none\nMEFI_JOB_DONE" }] } },
    { type: "result", subtype: "success", result: "All green.\nMEFI_RESULT: done: fixed it; remaining: none\nMEFI_JOB_DONE", usage: { input_tokens: 9, output_tokens: 20, cache_read_input_tokens: 1600, cache_creation_input_tokens: 0 } },
  ));
  assert.equal(entry.activeTool, null, "the tool's result ends it");
  assert.equal(entry.sawDone, true, "the sentinel reached readWorkerLine through the decoder");
  assert.equal(entry.resultNote?.raw?.includes("done: fixed it"), true);
  assert.deepEqual(entry.cliUsage, { input: 9, output: 20, cacheRead: 1600, cacheCreate: 0 });
  await h.finish("lp", { lines: [] });
  const row = h.board().tasks.find((item) => item.id === "lp");
  assert.equal(row.lastAttempt.cliSession.id, sessionId, "the attempt keeps the CLI's own session");
  assert.deepEqual(row.lastAttempt.usage, { input: 9, output: 20, cacheRead: 1600, cacheCreate: 0 });
});

test("the command line streams with a fresh session id per attempt, and the switch off keeps text mode", async () => {
  const invocation = (live, sessionId) => executorCore.cliInvocation({ model: "sonnet", env: {} }, "claude", "PROMPT", { live, sessionId, platform: "linux" });
  const uuid = "6f1d0c9e-2b8a-4a51-9a33-9d0c2f3e4b5a";
  const on = invocation(true, uuid);
  assert.equal(on.stream, "claude");
  assert.ok(on.args.join(" ").includes(`-p --output-format stream-json --verbose --session-id ${uuid} --dangerously-skip-permissions`), on.args.join(" "));
  assert.equal(on.stdin, "PROMPT", "the prompt stays on stdin");
  const unsafe = invocation(true, "x; rm -rf /");
  assert.ok(!unsafe.args.includes("--session-id"), "only a real UUID reaches the command line");
  const off = invocation(false, uuid);
  assert.equal(off.stream, undefined);
  assert.ok(off.args.join(" ").includes("-p --output-format text --dangerously-skip-permissions"), off.args.join(" "));
  assert.ok(!off.args.includes("--session-id"));
  const codex = (live) => executorCore.cliInvocation({ model: "gpt-5", env: {} }, "codex", "PROMPT", { live, platform: "linux" });
  assert.equal(codex(true).stream, "codex");
  assert.match(codex(true).args.join(" "), /codex exec --json --dangerously-bypass-approvals-and-sandbox/);
  assert.ok(!codex(false).args.includes("--json"));
  assert.equal(codex(false).stream, undefined);

  const { h } = liveHost({ settings: { ui: { autopilot: { enabled: true, execute: true, autoBuild: true, mode: "swarm", parallel: 1, minutes: 5 } }, executor: { liveProgress: false } } });
  assert.equal(await h.env.spawnNextJob(), "spawned");
  const entry = h.autopilot.jobs[0];
  assert.equal(entry.liveProgress, false);
  assert.equal(entry.liveStream, null);
  assert.equal(entry.bufferedOutput, true, "a text-mode Claude run is silent until it ends, as before");
  entry.child.stdout.emit("data", "Fixed.\nMEFI_JOB_DONE\n");
  assert.equal(entry.sawDone, true);
  assert.equal(entry.cliSession, undefined);
});

test("MEFI_STUDIO_LIVE_PROGRESS=0 turns it off; two Claude attempts never share a session id", async () => {
  const { h } = liveHost({ env: { MEFI_STUDIO_LIVE_PROGRESS: "0" } });
  assert.equal(await h.env.spawnNextJob(), "spawned");
  assert.equal(h.autopilot.jobs[0].liveStream, null);
  assert.match(source, /sessionId: entry\.liveProgress === true && cli === "claude" \? crypto\.randomUUID\(\) : null,/, "one per attempt: Claude Code refuses a session id already in use");
  assert.match(source, /entry\.bufferedOutput = \(label === "claude" && !entry\.liveStream\) \|\| label === "antigravity";/);
});

test("a Codex app-server route is untouched by live progress", async () => {
  const codexHarness = require("../scripts/codex-harness.cjs");
  const { EventEmitter } = await import("node:events");
  const { h } = liveHost({ route: { via: "codex cli", cli: "codex", codex: true, model: "gpt-6.1-sol", codexHarness: "app-server", modelArgs: "", env: {}, opencode: opencodeFallback } });
  h.env.codexHarness = { ...codexHarness, wrapChild: (child) => Object.assign(new EventEmitter(), { pid: child.pid, stdout: child.stdout, stderr: child.stderr, stdin: child.stdin, codex: {} }) };
  assert.equal(await h.env.spawnNextJob(), "spawned");
  assert.equal(h.autopilot.jobs[0].liveStream, null, "the app server's facade already hands the executor its lines");
});
