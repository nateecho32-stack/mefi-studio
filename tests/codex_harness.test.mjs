// The Codex app-server harness (scripts/codex-harness.cjs): a Codex worker
// over `codex app-server`'s JSON-RPC, behind a ChildProcess-shaped facade the
// executor reads exactly like `codex exec`. Each session runs against
// tests/fixtures/fake-codex-app-server.mjs, a scripted server whose record
// file shows what the harness sent. Message shapes follow codex-cli 0.154.0's
// `codex app-server generate-ts --experimental` bindings.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as assistant from "../scripts/assistant.mjs";
import harness from "../scripts/codex-harness.cjs";
import core from "../scripts/executor-core.cjs";
import cliAccounts from "../scripts/cli-accounts.cjs";
import usageTracker from "../scripts/usage-tracker.cjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-codex-app-server.mjs", import.meta.url));
const THREAD = "thr_1";
const TURN = "turn_1";
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
// The host's own MEFI_NEXT/MEFI_CALL reader, lifted from main.cjs with its constants.
const handoffHost = vm.createContext({ EXECUTOR_NEXT_MARK: "MEFI_NEXT:", EXECUTOR_CALL_MARK: "MEFI_CALL:", EXECUTOR_CALLABLE: new Set(["auditor", "reference"]) });
vm.runInContext(source.slice(source.indexOf("function parseExecutorHandoff("), source.indexOf("// assistant:run modes map")), handoffHost);
const parseHandoff = handoffHost.parseExecutorHandoff;

// The owner's ~/.codex/config.toml as config/read returns it: servers Studio
// never asked for.
const OWNER_CONFIG = { model: "gpt-6.1-sol", mcp_servers: { pixellab: { url: "https://example.invalid/mcp", enabled: true }, node_repl: { command: "node", args: ["repl.js"], enabled: true } } };
const DESK = { mefi_desk: { command: "C:\\Program Files\\Mefi's Studio AI+\\Mefi's Studio AI+.exe", args: ["C:\\app\\scripts\\desk-mcp.mjs"], env: { MEFI_DESK_TOKEN: "secret", ELECTRON_RUN_AS_NODE: "1" } } };

const item = (method, value) => ({ notify: method, params: { threadId: THREAD, turnId: TURN, item: value } });
const message = (text, phase = "final_answer") => item("item/completed", { type: "agentMessage", id: `m${text.length}`, text, phase, memoryCitation: null, delivery: null, questions: null });
const turnEnd = (status = "completed", error = null) => ({ notify: "turn/completed", params: { threadId: THREAD, turn: { id: TURN, items: [], itemsView: "summary", status, error, startedAt: null, completedAt: null, durationMs: null } } });
const call = (tool, args) => ({ request: "item/tool/call", params: { threadId: THREAD, turnId: TURN, callId: `call_${tool}`, namespace: null, tool, arguments: args } });

function scenario(turn = [], { on = {}, config = OWNER_CONFIG, ...rest } = {}) {
  return {
    on: {
      initialize: [{ respond: { userAgent: "fake/0.154.0", codexHome: "C:/fake/.codex", platformFamily: "windows", platformOs: "windows" } }],
      "config/read": [{ respond: { config, origins: {}, layers: null } }],
      "thread/start": [{ respond: { thread: { id: THREAD }, model: "gpt-6-astra", modelProvider: "openai" } }],
      "turn/start": [{ respond: { turn: { id: TURN, items: [], status: "inProgress", error: null } } }, ...turn],
      ...on,
    },
    ...rest,
  };
}

function lines(stream, into) {
  stream.setEncoding("utf8");
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) { into.push(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
  });
  stream.on("end", () => { if (buffer) into.push(buffer); });
}

// One session against the fake server, read the way spawnAttempt reads a child.
function session(script, options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "mefi-codex-harness-"));
  const scenarioPath = path.join(dir, "scenario.json");
  const recordPath = path.join(dir, "record.jsonl");
  writeFileSync(scenarioPath, JSON.stringify(script));
  const child = spawn(process.execPath, [FAKE, scenarioPath, recordPath], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const notes = [];
  const facade = harness.wrapChild(child, { prompt: "PROMPT", cwd: dir, model: "gpt-6-astra", mcpServers: DESK, startTimeoutMs: 8000, exitGraceMs: 1500, interruptGraceMs: 1500, log: (line) => notes.push(line), ...options });
  const out = [];
  const err = [];
  const events = [];
  lines(facade.stdout, out);
  lines(facade.stderr, err);
  facade.once("spawn", () => events.push("spawn"));
  facade.on("error", (error) => events.push(error));
  facade.on("exit", (code) => events.push(`exit ${code}`));
  const closed = new Promise((resolve) => facade.on("close", (code) => {
    setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }, 200);
    resolve(code);
  }));
  const record = () => (existsSync(recordPath) ? readFileSync(recordPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  // The record is read before the folder goes.
  const done = closed.then((code) => ({ code, record: record() }));
  return { facade, child, out, err, events, notes, done };
}

async function waitFor(check, ms = 8000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const sent = (record, method) => record.filter((entry) => entry.method === method);
const answerTo = (record, id) => record.find((entry) => entry.id === id && !entry.method);

// ---- the launch ---------------------------------------------------------------------

test("codexHarness app-server launches `codex app-server` on the exec route's shell path, stdin kept by the harness", () => {
  const modelArg = (value) => /^[A-Za-z0-9._:/-]{1,80}$/.test(String(value ?? "")) ? String(value) : "";
  const route = { model: "gpt-6", env: { CODEX_HOME: "C:\\logins\\b" } };
  const windows = core.cliInvocation(route, "codex", "PROMPT", { modelArg, desk: { servers: DESK }, codexHarness: "app-server" });
  assert.equal(windows.command, "cmd.exe");
  assert.deepEqual(windows.args, ["/d", "/s", "/c", "\"codex app-server\""], "codex is an npm .cmd shim: cmd.exe finds it, as it finds `codex exec`");
  assert.equal(windows.verbatim, true);
  assert.deepEqual(windows.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(windows.stdin, null, "the host writes nothing: the harness owns stdin");
  assert.equal(windows.harness, "codex-app-server");
  assert.deepEqual(windows.env, route.env, "a second login's CODEX_HOME rides along");
  assert.deepEqual(windows.dropped, [], "the desk's token travels over stdin, so nothing is dropped");
  assert.equal(windows.plan.prompt, "PROMPT");
  assert.equal(windows.plan.model, "gpt-6");
  assert.equal(windows.plan.sandbox, "danger-full-access");
  assert.equal(windows.plan.approvalPolicy, "never");
  assert.deepEqual(windows.plan.mcpServers, ["mefi_desk"]);
  assert.deepEqual(windows.plan.config["mcp_servers.mefi_desk"], { command: DESK.mefi_desk.command, args: DESK.mefi_desk.args, env: DESK.mefi_desk.env, enabled: true });
  assert.equal(windows.plan.config["features.apps"], false);
  assert.equal(windows.plan.config["features.plugins"], false);
  assert.ok(!JSON.stringify(windows.args).includes("PROMPT") && !JSON.stringify(windows.args).includes("secret"), "neither the brief nor a credential is an argument");

  const posix = core.cliInvocation(route, "codex", "PROMPT", { modelArg, platform: "linux", codexHarness: "app-server" });
  assert.deepEqual(posix.args, ["/d", "/s", "/c", "codex app-server"]);
  assert.equal(posix.verbatim, false);

  const exec = core.cliInvocation(route, "codex", "PROMPT", { modelArg, desk: { servers: DESK } });
  assert.match(exec.args[3], /^"codex exec /, "exec stays the default");
  assert.deepEqual(exec.dropped, ["mefi_desk"], "…where a credential cannot ride the command line");
  assert.equal(exec.harness, undefined);
  assert.equal(core.cliInvocation(route, "claude", "PROMPT", { modelArg, codexHarness: "app-server" }).harness, undefined, "the switch is Codex's alone");

  assert.equal(core.cliInvocation({ model: "x && del" }, "codex", "PROMPT", { modelArg, codexHarness: "app-server" }).plan.model, null, "the model goes through the same id filter");
  const odd = harness.appServerInvocation({}, "PROMPT", { desk: { servers: { "bad name": { command: "x" }, nocommand: { args: [] }, ok: { command: "y" } } }, platform: "linux" });
  assert.deepEqual(odd.dropped, ["bad name", "nocommand"]);
  assert.deepEqual(odd.plan.mcpServers, ["ok"]);
});

// ---- a session --------------------------------------------------------------------

test("a completed turn reads like `codex exec`: whole message lines, commands, file changes, exit 0", async () => {
  const run = session(scenario([
    item("item/started", { type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "PROMPT", text_elements: [] }] }),
    item("item/started", { type: "commandExecution", id: "c1", command: "npm test\n  -- --grep harness", cwd: "C:/x", status: "inProgress", commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null }),
    item("item/completed", { type: "commandExecution", id: "c1", command: "npm test", cwd: "C:/x", status: "failed", commandActions: [], aggregatedOutput: "1 failing", exitCode: 1, durationMs: 900 }),
    item("item/completed", { type: "fileChange", id: "f1", status: "completed", changes: [{ path: "src/a.js", kind: { type: "update", move_path: null }, diff: "" }, { path: "src/b.js", kind: { type: "add" }, diff: "" }, { path: "src/c.js", kind: { type: "update", move_path: "src/d.js" }, diff: "" }] }),
    message("Working on it.\r\nStill going.", "commentary"),
    { notify: "thread/tokenUsage/updated", params: { threadId: THREAD, turnId: TURN, tokenUsage: { total: { totalTokens: 1200, inputTokens: 1000, cachedInputTokens: 400, cacheWriteInputTokens: 0, outputTokens: 200, reasoningOutputTokens: 50 }, last: { totalTokens: 1200, inputTokens: 1000, cachedInputTokens: 400, cacheWriteInputTokens: 0, outputTokens: 200, reasoningOutputTokens: 50 }, modelContextWindow: 400000 } } },
    { notify: "account/rateLimits/updated", params: { rateLimits: { limitId: "codex", limitName: null, primary: { usedPercent: 99, windowDurationMins: 10080, resetsAt: 1791057540 }, secondary: null, credits: { hasCredits: false, unlimited: false, balance: null }, planType: "plus" } } },
    { notify: "account/rateLimits/updated", params: { rateLimits: { limitId: "codex", primary: { usedPercent: 99.5, windowDurationMins: 10080, resetsAt: 1791057540 }, planType: null } } },
    { notify: "account/rateLimits/updated", params: { rateLimits: { limitId: "codex_premium", primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: 1791000000 } } } },
    message("All done.\nMEFI_RESULT: done: wired the harness; remaining: none\nMEFI_JOB_DONE"),
    turnEnd(),
  ]));
  const { code, record } = await run.done;
  assert.equal(code, 0);
  assert.ok(run.events.includes("spawn"), "the real child's spawn is the facade's");
  assert.ok(run.events.includes("exit 0"));
  assert.deepEqual(run.out, ["$ npm test -- --grep harness", "  exit 1", "edited src/a.js", "added src/b.js", "moved src/c.js -> src/d.js", "Working on it.", "Still going.", "All done.", "MEFI_RESULT: done: wired the harness; remaining: none", "MEFI_JOB_DONE"]);
  assert.ok(!run.out.join("\n").includes("PROMPT"), "the user's own message is never echoed back into the sentinel reader");
  assert.equal(run.err[0], "codex app-server session thr_1 (model gpt-6-astra)");
  assert.equal(run.facade.pid, run.child.pid, "the stop path's taskkill targets the real process tree");
  assert.equal(run.facade.exitCode, 0);
  assert.equal(run.facade.codex.threadId, THREAD);
  assert.equal(run.facade.codex.turnId, TURN);
  assert.equal(run.facade.codex.usage.total.totalTokens, 1200);
  assert.deepEqual(harness.ledgerTokenUsage(run.facade.codex.usage), { inputTokens: 1000, outputTokens: 200, totalTokens: 1200, cacheReadTokens: 400, cacheWriteTokens: 0 }, "the model ledger's token fields");
  assert.equal(harness.ledgerTokenUsage(null), null);
  assert.equal(run.facade.codex.rateLimits.primary.usedPercent, 99.5, "the newest window");
  assert.equal(run.facade.codex.rateLimits.planType, "plus", "a sparse update keeps what it does not repeat");
  assert.equal(run.facade.codex.rateLimitsById.codex_premium.primary.usedPercent, 3, "another lane is kept apart");
  const limits = usageTracker.parseCodexRateLimits({ rateLimits: run.facade.codex.rateLimits }, { now: 1790000000000, source: "app-server" });
  assert.equal(limits.windows[0].percent, 99.5, "the facade's limits are what usage-tracker already reads");
  assert.equal(limits.plan, "plus");
  // The handshake, as sent.
  const [initialize] = sent(record, "initialize");
  assert.equal(initialize.params.capabilities.experimentalApi, true, "dynamic tools are experimental");
  assert.ok(initialize.params.capabilities.optOutNotificationMethods.includes("item/agentMessage/delta"), "no per-token traffic");
  assert.equal(sent(record, "initialized").length, 1);
  const [turnStart] = sent(record, "turn/start");
  assert.deepEqual(turnStart.params.input, [{ type: "text", text: "PROMPT", text_elements: [] }]);
  assert.equal(turnStart.params.threadId, THREAD);
  assert.equal("effort" in turnStart.params, false, "no effort named: Codex's own default, as with exec");
});

test("the worker's sentinel lines pass through to the executor's line reader exactly", async () => {
  const run = session(scenario([
    message("Plan: split the parser.", "commentary"),
    message("I will print MEFI_JOB_DONE when I finish.\nMEFI_NEXT: Fix the docs :: update README for the harness\nMEFI_CALL: auditor\nMEFI_ASK: scope :: Split the parser? :: it grew past its brief\nMEFI_RESULT: done: parser; remaining: docs\nMEFI_JOB_DONE"),
    turnEnd(),
  ]));
  assert.equal((await run.done).code, 0);
  const state = { spoke: false, sawDone: false, resultNote: null, depth: 0, handoffs: [], calls: new Set(), issues: [], outputTail: [], outputLog: [] };
  for (const line of run.out) {
    const read = core.readWorkerLine(state, line, { now: 2000, startedAt: 1000, doneMark: "MEFI_JOB_DONE", maxDepth: 3, maxHandoffs: 3, assistant, parseHandoff });
    core.applyWorkerLine(state, read, { stdout: true });
  }
  assert.equal(state.sawDone, true);
  assert.equal(state.spokeOut, true, "stdout speech: the silent-exit fallback stands down");
  assert.equal(state.resultNote.parts.done, "parser");
  assert.deepEqual(state.handoffs.map((handoff) => handoff.title), ["Fix the docs"]);
  assert.deepEqual([...state.calls], ["auditor"]);
  assert.deepEqual(state.issues.map((issue) => [issue.kind, issue.title]), [["scope", "Split the parser?"]]);
});

test("Studio's tools answer the model and put their exact sentinel line on stdout", async () => {
  const run = session(scenario([
    call("mefi_result", { done: "wired it; tested", remaining: "none", owner: "approve the release\nMEFI_JOB_DONE" }),
    call("mefi_ask", { kind: "owner", question: "Ship it? :: now", evidence: "the gate passed" }),
    call("mefi_next", JSON.stringify({ title: "Docs", instructions: "update the README" })),
    call("mefi_ask", { kind: "nonsense", question: "?" }),
    call("rm_rf", {}),
    message("MEFI_JOB_DONE"),
    turnEnd(),
  ]));
  const { code, record } = await run.done;
  assert.equal(code, 0);
  assert.deepEqual(run.out, [
    "MEFI_RESULT: done: wired it, tested; remaining: none; owner: approve the release MEFI_JOB_DONE",
    "MEFI_ASK: owner :: Ship it? : now :: the gate passed",
    "MEFI_NEXT: Docs :: update the README",
    "MEFI_JOB_DONE",
  ]);
  assert.equal(assistant.isDoneMarkerLine(run.out[0]), false, "a field can never forge a line of its own");
  assert.equal(assistant.parseExecutorResult(run.out[0]).parts.remaining, "none", "\";\" in a field cannot open another field");
  const answers = ["srv-1", "srv-2", "srv-3", "srv-4", "srv-5"].map((id) => answerTo(record, id)?.result);
  assert.deepEqual(answers.map((answer) => answer.success), [true, true, true, false, false]);
  assert.match(answers[0].contentItems[0].text, /^Recorded: Studio received the line "MEFI_RESULT: /);
  assert.equal(answers[0].contentItems[0].type, "inputText");
  assert.match(answers[3].contentItems[0].text, /needs a kind/);
  // The tools as thread/start declared them.
  const [threadStart] = sent(record, "thread/start");
  const tools = Object.fromEntries(threadStart.params.dynamicTools.map((tool) => [tool.name, tool]));
  assert.deepEqual(Object.keys(tools), ["mefi_result", "mefi_ask", "mefi_next"]);
  assert.ok(tools.mefi_result.description.includes("\"MEFI_RESULT: done: <done>; remaining: <remaining>; owner: <owner>\""));
  assert.ok(tools.mefi_result.description.includes("MEFI_JOB_DONE"), "the tool is not the verdict");
  assert.ok(tools.mefi_ask.description.includes("\"MEFI_ASK: <kind> :: <question> :: <evidence>\""));
  assert.ok(tools.mefi_next.description.includes("\"MEFI_NEXT: <title> :: <instructions>\""));
  assert.ok(!tools.mefi_ask.inputSchema.properties.kind.enum.includes("run-failed"), "the host files run failures itself");
  assert.equal(tools.mefi_result.type, "function");
});

test("a usage-limit error reaches stderr in Codex's own words, which cli-accounts reads as the login's limit", async () => {
  const words = "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Oct 3rd, 2026 1:59 PM.";
  const error = { message: words, codexErrorInfo: "usageLimitExceeded", additionalDetails: null, misalignment: null };
  const run = session(scenario([
    { notify: "error", params: { threadId: THREAD, turnId: TURN, willRetry: false, error } },
    turnEnd("failed", error),
  ]));
  assert.equal((await run.done).code, 1);
  const last = run.err.at(-1);
  assert.equal(last, `ERROR: ${words}`);
  assert.equal(run.err.filter((line) => line === last).length, 1, "the turn's own copy of the error is not printed twice");
  assert.equal(cliAccounts.isUsageLimit(last), true);
  const now = new Date(2026, 8, 29, 12, 0).getTime();
  assert.equal(cliAccounts.resetFrom(last, now), new Date(2026, 9, 3, 13, 59).getTime(), "the reset Codex named, in local time");
  // What finish() reads: the run's last words.
  const tail = [...run.out, ...run.err];
  assert.equal(assistant.isProviderOutage({ lastWords: core.lastWords(tail, "MEFI_JOB_DONE") }), true, "a limit is an outage, not the card's failure");
  assert.equal(run.facade.codex.status, "failed");
  // The same limit in other words still reads as one; a transient rate limit does not.
  assert.equal(cliAccounts.isUsageLimit(harness.errorLine({ message: "Quota exhausted for this plan.", codexErrorInfo: "usageLimitExceeded" })), true);
  assert.equal(harness.errorLine({ message: "Rate limit reached, slow down.", codexErrorInfo: "rateLimitExceeded" }), "ERROR: Rate limit reached, slow down.");
});

test("a failed turn exits 1 with its error last on stderr, and a retried error is only a notice", async () => {
  const error = { message: "stream disconnected before completion", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } }, additionalDetails: "upstream closed the connection", misalignment: null };
  const run = session(scenario([
    { notify: "error", params: { threadId: THREAD, turnId: TURN, willRetry: true, error: { message: "Reconnecting... 1/5", codexErrorInfo: null, additionalDetails: null } } },
    message("Halfway there.", "commentary"),
    turnEnd("failed", error),
  ]));
  assert.equal((await run.done).code, 1);
  assert.deepEqual(run.err.slice(1), ["codex: Reconnecting... 1/5 (retrying)", "ERROR: stream disconnected before completion (upstream closed the connection)"]);
  assert.deepEqual(run.out, ["Halfway there."]);
  assert.equal(run.facade.exitCode, 1);
});

test("kill() interrupts the turn, then ends the server", async () => {
  const run = session(scenario([message("Starting.", "commentary")], {
    on: { "turn/interrupt": [{ respond: {} }, turnEnd("interrupted")] },
  }));
  await waitFor(() => run.facade.codex.status === "running" && run.out.length > 0);
  assert.equal(run.facade.kill(), true);
  const { code, record } = await run.done;
  assert.equal(code, 1);
  assert.deepEqual(sent(record, "turn/interrupt").map((entry) => entry.params), [{ threadId: THREAD, turnId: TURN }]);
  assert.ok(run.err.includes("codex: turn interrupted"));
  assert.equal(run.facade.killed, true);
  assert.equal(run.facade.kill(), false, "an exited facade has nothing left to kill");
});

test("a server that ignores the interrupt is killed after the grace", async () => {
  const killed = [];
  const run = session(scenario([], { stayAlive: true, on: { "turn/interrupt": [] } }), {
    interruptGraceMs: 200,
    killTree: (child) => { killed.push(child.pid); child.kill(); },
  });
  await waitFor(() => run.facade.codex.status === "running");
  run.facade.kill();
  assert.equal(await run.done.then((result) => result.code), 1);
  assert.deepEqual(killed, [run.child.pid], "the injected tree-kill ends the real child");
});

test("the owner's MCP servers are off for the thread, and Studio's own ride its config with their credentials", async () => {
  const invocation = harness.appServerInvocation({ model: "gpt-6-astra" }, "PROMPT", { modelArg: (value) => value, desk: { servers: DESK }, platform: "linux" });
  const run = session(scenario([
    { notify: "mcpServer/startupStatus/updated", params: { threadId: THREAD, name: "mefi_desk", status: "failed", error: "spawn ENOENT", failureReason: null } },
    { notify: "mcpServer/startupStatus/updated", params: { threadId: THREAD, name: "pixellab", status: "failed", error: "ignored", failureReason: null } },
    message("MEFI_JOB_DONE"),
    turnEnd(),
  ]), { ...invocation.plan, mcpServers: invocation.plan.mcpServers });
  const { code, record } = await run.done;
  assert.equal(code, 0);
  const [configRead] = sent(record, "config/read");
  assert.equal(typeof configRead.params.cwd, "string", "read from the run's folder, so project layers count");
  const [threadStart] = sent(record, "thread/start");
  const params = threadStart.params;
  assert.equal(params.config["mcp_servers.pixellab.enabled"], false);
  assert.equal(params.config["mcp_servers.node_repl.enabled"], false);
  assert.equal(params.config["features.apps"], false, "the ChatGPT apps connector");
  assert.equal(params.config["features.plugins"], false, "every plugin's MCP server");
  assert.deepEqual(params.config["mcp_servers.mefi_desk"], { command: DESK.mefi_desk.command, args: DESK.mefi_desk.args, env: DESK.mefi_desk.env, enabled: true });
  assert.equal("mcp_servers.mefi_desk.enabled" in params.config, false);
  assert.equal(params.model, "gpt-6-astra", "Studio's model, never the config's gpt-6.1-sol");
  assert.equal(params.sandbox, "danger-full-access");
  assert.equal(params.approvalPolicy, "never");
  assert.equal(params.ephemeral, false, "the rollout is written, so the rollout usage reader keeps working");
  assert.match(params.developerInstructions, /MEFI_JOB_DONE/);
  assert.deepEqual(run.facade.codex.serversOff, ["pixellab", "node_repl"]);
  assert.ok(run.err.includes("codex: MCP server mefi_desk failed to start: spawn ENOENT"), "Studio's own server failing is said");
  assert.ok(!run.err.some((line) => line.includes("pixellab")), "the owner's is not Studio's business");
});

test("approval and input requests are declined with a line on stderr; the route runs unattended", async () => {
  const run = session(scenario([
    { request: "item/commandExecution/requestApproval", params: { threadId: THREAD, turnId: TURN, itemId: "c9", command: "git push --force", reason: null } },
    { request: "item/fileChange/requestApproval", params: { threadId: THREAD, turnId: TURN, itemId: "f9", reason: "write outside the root" } },
    { request: "item/permissions/requestApproval", params: { threadId: THREAD, turnId: TURN, itemId: "p9", reason: "network" } },
    { request: "item/tool/requestUserInput", params: { threadId: THREAD, turnId: TURN, itemId: "q9", questions: [{ id: "q", header: "DB", question: "Which database?", isOther: false, isSecret: false, options: null }], isBlocking: true, autoResolutionMs: null } },
    { request: "mcpServer/elicitation/request", params: { threadId: THREAD, turnId: TURN, serverName: "mefi_desk", mode: "url", url: "https://example.invalid", message: "log in", elicitationId: "e1", _meta: null } },
    { request: "account/chatgptAuthTokens/refresh", params: {} },
    message("MEFI_JOB_DONE"),
    turnEnd(),
  ]));
  const { code, record } = await run.done;
  assert.equal(code, 0);
  assert.deepEqual(answerTo(record, "srv-1").result, { decision: "decline" });
  assert.deepEqual(answerTo(record, "srv-2").result, { decision: "decline" });
  assert.deepEqual(answerTo(record, "srv-3").result, { permissions: {}, scope: "turn" });
  assert.deepEqual(answerTo(record, "srv-4").result, { answers: {} });
  assert.equal(answerTo(record, "srv-5").result.action, "decline");
  assert.equal(answerTo(record, "srv-6").error.code, -32601, "anything else is refused, never left hanging");
  assert.ok(run.err.includes("codex: declined an approval request (this route runs approval-free): git push --force"));
  assert.ok(run.err.includes("codex: declined a request for input (nobody is at the keyboard): Which database?"));
});

test("JSON lines split across chunks, CRLF endings and non-JSON noise are read whole", async () => {
  const run = session(scenario([{
    chunks: [
      "{\"method\":\"item/comp",
      "leted\",\"params\":{\"threadId\":\"thr_1\",\"turnId\":\"turn_1\",\"item\":{\"type\":\"agentMessage\",\"id\":\"m1\",\"text\":\"first line\\nMEFI_JOB_",
      "DONE\",\"phase\":\"final_answer\"}}}\r\n",
      "not json at all\r\n\r\n{\"broken\": \r\n",
      "{\"method\":\"turn/completed\",\"params\":{\"threadId\":\"thr_1\",\"turn\":{\"id\":\"turn_1\",\"items\":[],\"status\":\"completed\",\"error\":null}}}\r",
      "\n",
    ],
    delay: 30,
  }], { start: [{ raw: "Codex starting (noise before any JSON)\n" }] }));
  assert.equal((await run.done).code, 0);
  assert.deepEqual(run.out, ["first line", "MEFI_JOB_DONE"]);
  assert.ok(run.notes.some((line) => line.includes("not JSON-RPC: not json at all")));
  assert.ok(run.notes.some((line) => line.includes("not JSON-RPC: Codex starting")));
  // The reader on its own: a line past the cap is skipped whole, the next is kept.
  const got = [];
  const reader = harness.lineReader((line) => got.push(line), { max: 8 });
  for (const chunk of ["short\nwaytoolong", "stillgoing", "\nok\r", "\ntail"]) reader.push(chunk);
  reader.flush();
  assert.deepEqual(got, ["short", "ok", "tail"]);
});

test("a server that never answers initialize hits the start timeout: an error the host falls back on, and exit 1", async () => {
  const run = session({ on: {} }, { startTimeoutMs: 300 });
  const { code, record } = await run.done;
  assert.equal(code, 1);
  const error = run.events.find((event) => event instanceof Error);
  assert.equal(error?.code, harness.START_FAILED);
  assert.match(error.message, /no answer to initialize within 0\.3s/);
  assert.equal(run.facade.codex.startFailed, true);
  assert.ok(run.err.at(-1).startsWith("codex app-server could not start"), run.err.join(" | "));
  assert.deepEqual(record.map((entry) => entry.method), ["initialize"], "no thread, no turn, nothing billed");
});

test("a refused handshake is a start failure; a server that dies during it exits with its own code", async () => {
  const refused = session(scenario([], { on: { "thread/start": [{ error: { code: -32600, message: "unknown model gpt-9" } }] } }));
  assert.equal((await refused.done).code, 1);
  const error = refused.events.find((event) => event instanceof Error);
  assert.equal(error?.code, harness.START_FAILED);
  assert.match(error.message, /thread\/start failed: unknown model gpt-9/);
  assert.equal(refused.out.length, 0);

  const gone = session({ on: { initialize: [{ stderr: "'codex' is not recognized as an internal or external command\n" }, { exit: 9 }] } });
  assert.equal((await gone.done).code, 9);
  assert.equal(gone.events.some((event) => event instanceof Error), false, "an early exit is the host's silent-exit fallback, not an error event");
  assert.equal(gone.facade.codex.startFailed, true);
  assert.ok(gone.err.includes("'codex' is not recognized as an internal or external command"), "the server's own stderr passes through");
  assert.equal(gone.err.at(-1), "codex app-server exited (9) before the turn finished");
});
