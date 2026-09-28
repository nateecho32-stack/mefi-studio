import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFile, access } from "node:fs/promises";
import { argumentsFor, run } from "../scripts/cli-text.cjs";

test("text adapters disable native actions and isolate Codex's user configuration", () => {
  assert.ok(argumentsFor("claude").includes("--tools="));
  assert.ok(argumentsFor("claude").includes("--strict-mcp-config"));
  assert.ok(argumentsFor("grok").includes("--tools="));
  assert.ok(argumentsFor("grok").includes("MCPTool"));
  const codex = argumentsFor("codex");
  for (const flag of ["--ignore-user-config", "--ignore-rules", "read-only", "features.shell_tool=false", "features.unified_exec=false", "features.multi_agent=false", "features.hooks=false", "mcp_servers={}", "web_search=disabled"]) assert.ok(codex.includes(flag), flag);
  assert.throws(() => argumentsFor("codex", "model & echo secret"));
  assert.throws(() => argumentsFor("unknown"));
});

function fixture(onStart) {
  const calls = [], prompts = [];
  return { calls, prompts, spawnImpl(command, args, options) {
    const child = Object.assign(new EventEmitter(), { pid: 12, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill() { queueMicrotask(() => child.emit("close", 1)); } });
    child.stdin.on("data", (data) => prompts.push(String(data)));
    calls.push({ command, args, options });
    setImmediate(() => onStart(child, { command, args, options, prompts }));
    return child;
  } };
}
test("Codex sends prompts through stdin in a disposable directory and cleans it", async () => {
  const f = fixture((child) => { child.stdout.write('{"type":"item.completed"}\n'); child.emit("close", 0); });
  const result = await run({ provider: "codex", system: "system", user: "private", platform: "linux", spawnImpl: f.spawnImpl });
  assert.equal(result.code, 0); assert.equal(f.prompts.join(""), "system\n\nprivate");
  assert.doesNotMatch(f.calls[0].args.join(" "), /private/);
  await assert.rejects(access(f.calls[0].options.cwd));
});
test("a second login's folder rides the child's environment, and without one the environment is inherited", async () => {
  for (const platform of ["win32", "linux"]) {
    const f = fixture((child) => { child.stdout.write('{"type":"result","result":"READY"}'); child.emit("close", 0); });
    await run({ provider: "claude", system: "system", user: "private", platform, spawnImpl: f.spawnImpl, env: { CLAUDE_CONFIG_DIR: "C:/logins/claude-a1b2" } });
    assert.equal(f.calls[0].options.env.CLAUDE_CONFIG_DIR, "C:/logins/claude-a1b2", platform);
    assert.equal(f.calls[0].options.env.PATH ?? f.calls[0].options.env.Path, process.env.PATH ?? process.env.Path, "the rest of the environment comes along");
    const inherited = fixture((child) => { child.emit("close", 0); });
    await run({ provider: "claude", system: "system", user: "private", platform, spawnImpl: inherited.spawnImpl });
    assert.equal(inherited.calls[0].options.env, undefined, `${platform}: no env option at all for the main login`);
  }
});
test("Antigravity with inherited tools receives no project prompt", async () => {
  const f = fixture((child) => { child.stdout.write(JSON.stringify({ event: "init", init: { agent: "mefi-text", tools: ["write_to_file"] } }) + "\n"); });
  const result = await run({ provider: "antigravity", system: "system", user: "private", platform: "linux", spawnImpl: f.spawnImpl });
  assert.match(result.error, /no-tools/); assert.deepEqual(f.prompts, []);
});
test("Antigravity waits for an empty tool roster before sending one prompt", async () => {
  let agent;
  const f = fixture(async (child, call) => {
    agent = await readFile(call.options.cwd + "/.agents/agents/mefi-text.md", "utf8");
    assert.deepEqual(call.prompts, []);
    child.stdout.write('{"event":"init","init":{"agent":"mefi-text","tools":[]}}\n');
    child.stdout.write('{"event":"result","result":{"status":"SUCCESS","response":"READY"}}\n');
    child.emit("close", 0);
  });
  const result = await run({ provider: "antigravity", system: "system", user: "private", platform: "linux", spawnImpl: f.spawnImpl });
  assert.match(agent, /tools: \[\]/); assert.match(agent, /mcpServers: \[\]/);
  assert.equal(JSON.parse(f.prompts.join("")).message.content, "system\n\nprivate");
  assert.equal(JSON.parse(result.stdout).response, "READY");
});

test("text sessions stop oversized protocol output before a prompt is sent", async () => {
  const f = fixture((child) => {
    child.stdout.write("x".repeat(1000001));
    child.stdout.write("x".repeat(1000001));
  });
  const result = await run({ provider: "antigravity", system: "system", user: "private", platform: "linux", spawnImpl: f.spawnImpl });
  assert.match(result.error, /size limit/);
  assert.deepEqual(f.prompts, []);
  await assert.rejects(access(f.calls[0].options.cwd));
});

test("timed out text sessions report a connection recovery and discard temporary files", async () => {
  const f = fixture(() => {});
  const result = await run({ provider: "codex", system: "system", user: "private", timeoutMs: 10, platform: "linux", spawnImpl: f.spawnImpl });
  assert.equal(result.timedOut, true);
  assert.match(result.error, /sign-in and usage limit/);
  await assert.rejects(access(f.calls[0].options.cwd));
});
