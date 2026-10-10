// Live progress from the coding CLIs (scripts/cli-stream.cjs): Claude Code's
// stream-json and Codex's --json (and its older { id, msg } stream) decoded
// back into the worker's text lines plus session, tool, usage and todo
// events, the text fallback for a CLI that prints no events, and applyEvent
// folding those events into a run the way watchJobProgress folds an OpenCode
// session's. The host's wiring is in executor_live_progress.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const cliStream = createRequire(import.meta.url)("../scripts/cli-stream.cjs");
const { createDecoder, applyEvent, liveProgressEnabled, summarize, DETECT_LINES, EVENT_LINE_MAX } = cliStream;

const jsonl = (...events) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";
const lines = (items) => items.filter((item) => typeof item.line === "string");
const kinds = (items) => items.map((item) => Object.keys(item).find((key) => key !== "stdout"));

// ---- Claude Code ------------------------------------------------------------------

const claudeRun = [
  { type: "system", subtype: "init", session_id: "0f8d6c1e-5b8a-4a51-9a33-9d0c2f3e4b5a", model: "claude-sonnet-4-5", mcp_servers: [{ name: "mefi_tools", status: "connected" }, { name: "docs", status: "failed" }] },
  { type: "assistant", message: { id: "msg_1", model: "claude-sonnet-4-5", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 },
    content: [{ type: "tool_use", id: "toolu_todo", name: "TodoWrite", input: { todos: [{ content: "Read the brief", status: "completed" }, { content: "Fix the bug", status: "in_progress" }, { content: "Run the tests", status: "pending" }] } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_todo", content: "ok" }] } },
  // Each content block repeats its message's usage: counted once.
  { type: "assistant", message: { id: "msg_2", model: "claude-sonnet-4-5", usage: { input_tokens: 3, output_tokens: 7, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    content: [{ type: "tool_use", id: "toolu_bash", name: "Bash", input: { command: "npm test -- --grep thing", description: "Run the focused tests" } }] } },
  { type: "assistant", message: { id: "msg_2", model: "claude-sonnet-4-5", usage: { input_tokens: 3, output_tokens: 7, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }, content: [] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_bash", is_error: true, content: "1 failing" }] } },
  { type: "assistant", message: { id: "msg_3", model: "claude-sonnet-4-5", content: [{ type: "text", text: "Fixed it.\nMEFI_RESULT: done: fixed the bug; remaining: none\nMEFI_JOB_DONE" }] } },
  { type: "result", subtype: "success", is_error: false, result: "Fixed it.\nMEFI_RESULT: done: fixed the bug; remaining: none\nMEFI_JOB_DONE", session_id: "0f8d6c1e-5b8a-4a51-9a33-9d0c2f3e4b5a",
    modelUsage: { "claude-sonnet-4-5": { inputTokens: 13, outputTokens: 12, cacheReadInputTokens: 1900, cacheCreationInputTokens: 100 }, "claude-haiku-4-5": { inputTokens: 2, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } },
];

test("a Claude Code run decodes into its text lines once, its session, tools, todos and usage", () => {
  const decoder = createDecoder("claude");
  const items = decoder.push(jsonl(...claudeRun));
  assert.equal(decoder.mode, "json");
  assert.deepEqual(lines(items).map((item) => [item.line, item.stdout]), [
    ["Claude Code session 0f8d6c1e-5b8a-4a51-9a33-9d0c2f3e4b5a started on claude-sonnet-4-5 · MCP not connected: docs (failed)", false],
    ["Fixed it.", true],
    ["MEFI_RESULT: done: fixed the bug; remaining: none", true],
    ["MEFI_JOB_DONE", true],
  ], "result.result repeats the last message and is never read again: the sentinel and MEFI lines count once");
  assert.deepEqual(items.find((item) => item.session).session, { id: "0f8d6c1e-5b8a-4a51-9a33-9d0c2f3e4b5a", cli: "claude", model: "claude-sonnet-4-5" });
  assert.deepEqual(items.filter((item) => item.todos).map((item) => item.todos), [[
    { content: "Read the brief", status: "completed" }, { content: "Fix the bug", status: "in_progress" }, { content: "Run the tests", status: "pending" },
  ]], "TodoWrite is the todo list, not a tool");
  assert.deepEqual(items.filter((item) => item.tool).map((item) => item.tool), [
    { id: "toolu_bash", name: "Bash", summary: "Run the focused tests", status: "running" },
    { id: "toolu_bash", name: "Bash", summary: "", status: "failed" },
  ]);
  const usage = items.filter((item) => item.usage).map((item) => item.usage);
  assert.deepEqual(usage[0], { input: 10, output: 5, cacheRead: 900, cacheCreate: 100 });
  assert.deepEqual(usage[1], { input: 13, output: 12, cacheRead: 1900, cacheCreate: 100 }, "a repeated message replaces its own share");
  assert.deepEqual(usage.at(-1), { input: 15, output: 13, cacheRead: 1900, cacheCreate: 100 }, "the result's per-model totals win");
  assert.equal(usage.length, 3, "the repeat with the same usage reports nothing new");
  assert.deepEqual(decoder.stats, { events: claudeRun.length, malformed: 0, text: 0 });
});

test("a failed Claude Code run says why once; a synthetic notice and a sub-agent's words are not the run's report", () => {
  const decoder = createDecoder("claude");
  const items = decoder.push(jsonl(
    { type: "system", subtype: "init", session_id: "s1", model: "m" },
    { type: "assistant", parent_tool_use_id: "toolu_task", message: { id: "sub", content: [{ type: "text", text: "MEFI_JOB_DONE" }, { type: "tool_use", id: "toolu_sub", name: "Read", input: { file_path: `C:/repo/src/${"deep/".repeat(40)}file-name.js` } }] } },
    { type: "assistant", message: { id: "syn", model: "<synthetic>", content: [{ type: "text", text: "API Error: 529 overloaded" }] } },
    { type: "result", subtype: "error_during_execution", is_error: true, result: "API Error: 529 overloaded", errors: [] },
  ));
  assert.deepEqual(lines(items).map((item) => [item.line, item.stdout]), [
    ["Claude Code session s1 started on m", false],
    ["API Error: 529 overloaded", false],
  ], "the sub-agent's sentinel never reaches readWorkerLine, and the same error is not said twice");
  const tool = items.find((item) => item.tool).tool;
  assert.equal(tool.name, "Read", "a sub-agent's tools are the run's activity");
  assert.ok(tool.summary.startsWith("…") && tool.summary.endsWith("file-name.js") && tool.summary.length === 160, "a long path keeps its end");
  const silent = createDecoder("claude").push(jsonl({ type: "system", subtype: "init", session_id: "s2" }, { type: "result", subtype: "error_max_turns", is_error: true }));
  assert.equal(lines(silent).at(-1).line, "Claude Code stopped: error_max_turns");
});

test("a line split across chunks, a CRLF line and an unterminated last line all decode", () => {
  const decoder = createDecoder("claude");
  const text = jsonl(claudeRun[0], claudeRun[6]).replace(/\n/g, "\r\n");
  const out = [];
  for (let at = 0; at < text.length; at += 7) out.push(...decoder.push(text.slice(at, at + 7)));
  assert.deepEqual(lines(out).slice(1).map((item) => item.line), ["Fixed it.", "MEFI_RESULT: done: fixed the bug; remaining: none", "MEFI_JOB_DONE"]);
  const last = createDecoder("claude");
  assert.deepEqual(last.push(JSON.stringify(claudeRun[0])), [], "nothing until the line ends");
  assert.equal(lines(last.end()).length, 1, "end() reads the last line");
});

test("a stream with no events in its first lines is text from then on, exactly as before", () => {
  const decoder = createDecoder("claude");
  const banner = Array.from({ length: DETECT_LINES }, (_, at) => `old claude ${at}`).join("\n") + "\nMEFI_JOB_DONE\n";
  const items = decoder.push(banner);
  assert.equal(decoder.mode, "text");
  assert.equal(items.length, DETECT_LINES + 1);
  assert.deepEqual(items.slice(0, DETECT_LINES - 1).map((item) => item.stdout), Array(DETECT_LINES - 1).fill(false), "undecided lines are not the run reporting");
  assert.deepEqual(items.slice(DETECT_LINES - 1).map((item) => item.stdout), [true, true]);
  assert.equal(items.at(-1).line, "MEFI_JOB_DONE", "the sentinel still reaches readWorkerLine");
  // A JSON line that is not one of this CLI's events does not switch a stream on.
  const other = createDecoder("claude");
  assert.deepEqual(other.push('{"level":"info","msg":"hello"}\n'), [{ line: '{"level":"info","msg":"hello"}', stdout: false }]);
  assert.equal(other.mode, "detect");
});

test("once decoding, a garbled or over-long event is dropped and counted, never read as text or half", () => {
  const decoder = createDecoder("claude");
  decoder.push(jsonl(claudeRun[0]));
  assert.deepEqual(decoder.push('{"type":"assistant","message":{"content":[{"type":"text","text":"MEFI_JOB_DONE"\n'), []);
  const huge = JSON.stringify({ type: "assistant", message: { id: "big", content: [{ type: "text", text: `${"x".repeat(EVENT_LINE_MAX)}\nMEFI_JOB_DONE` }] } });
  assert.deepEqual(decoder.push(huge.slice(0, 500000)), []);
  assert.deepEqual(decoder.push(`${huge.slice(500000)}\n`), [], "a line past 1 MiB is cut and so never parsed");
  assert.equal(decoder.stats.malformed, 2);
  assert.deepEqual(decoder.push("plain words from a wrapper\n"), [{ line: "plain words from a wrapper", stdout: false }]);
  assert.throws(() => createDecoder("grok"), /Unknown CLI stream format/);
});

// ---- Codex --------------------------------------------------------------------------

test("a codex exec --json run decodes its thread, items, todo list and usage, cached input apart", () => {
  const decoder = createDecoder("codex");
  const items = decoder.push(jsonl(
    { type: "thread.started", thread_id: "thr_1" },
    { type: "turn.started" },
    { type: "item.started", item: { id: "i1", type: "todo_list", items: [{ text: "Read", completed: true }, { text: "Fix", completed: false }, { text: "Test", completed: false }] } },
    { type: "item.started", item: { id: "c1", type: "command_execution", command: "bash -lc 'npm test'", status: "in_progress" } },
    { type: "item.completed", item: { id: "c1", type: "command_execution", command: "bash -lc 'npm test'", exit_code: 1, status: "failed" } },
    { type: "item.completed", item: { id: "f1", type: "file_change", changes: [{ path: "src/a.js", kind: "update" }, { path: "src/b.js", kind: "add" }], status: "completed" } },
    { type: "item.completed", item: { id: "r1", type: "reasoning", text: "thinking" } },
    { type: "item.completed", item: { id: "m1", type: "agent_message", text: "Done.\nMEFI_JOB_DONE" } },
    { type: "turn.completed", usage: { input_tokens: 5000, cached_input_tokens: 4200, output_tokens: 300 } },
  ));
  assert.deepEqual(lines(items).map((item) => [item.line, item.stdout]), [["Codex session thr_1 started", false], ["Done.", true], ["MEFI_JOB_DONE", true]]);
  assert.deepEqual(items.find((item) => item.todos).todos, [{ content: "Read", status: "completed" }, { content: "Fix", status: "in_progress" }, { content: "Test", status: "pending" }], "the first open item is the one being worked on");
  assert.deepEqual(items.filter((item) => item.tool).map((item) => [item.tool.name, item.tool.status, item.tool.summary]), [
    ["shell", "running", "bash -lc 'npm test'"], ["shell", "failed", "bash -lc 'npm test'"], ["edit", "done", "src/a.js, src/b.js"],
  ]);
  assert.deepEqual(items.find((item) => item.usage).usage, { input: 800, output: 300, cacheRead: 4200, cacheCreate: 0 }, "Codex's input_tokens includes the cached part");
  assert.deepEqual(kinds(createDecoder("codex").push(jsonl({ type: "turn.failed", error: { message: "rate limited" } }))), ["line"]);
});

test("the older Codex { id, msg } stream decodes the same way", () => {
  const items = createDecoder("codex").push(jsonl(
    { id: "0", msg: { type: "session_configured", session_id: "sess_old", model: "gpt-5" } },
    { id: "1", msg: { type: "plan_update", plan: [{ step: "Fix", status: "in_progress" }] } },
    { id: "1", msg: { type: "exec_command_begin", call_id: "x", command: ["npm", "test"] } },
    { id: "1", msg: { type: "exec_command_end", call_id: "x", exit_code: 0 } },
    { id: "1", msg: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 9 } } } },
    { id: "1", msg: { type: "agent_message", message: "MEFI_JOB_DONE" } },
  ));
  assert.deepEqual(items.find((item) => item.session).session, { id: "sess_old", cli: "codex", model: "gpt-5" });
  assert.deepEqual(items.filter((item) => item.tool).map((item) => item.tool.status), ["running", "done"]);
  assert.deepEqual(items.find((item) => item.usage).usage, { input: 40, output: 9, cacheRead: 60, cacheCreate: 0 });
  assert.equal(lines(items).at(-1).line, "MEFI_JOB_DONE");
});

// ---- applyEvent and the switch --------------------------------------------------------

test("applyEvent folds events into the run and says what changed", () => {
  const run = { liveStream: { cli: "claude", model: "sonnet", account: "work", cwd: "C:/repo" } };
  let changed = applyEvent(run, { session: { id: "s1", cli: "claude", model: "claude-sonnet-4-5" } }, 50);
  assert.equal(changed.session, true);
  assert.deepEqual(run.cliSession, { cli: "claude", id: "s1", model: "sonnet", reportedModel: "claude-sonnet-4-5", account: "work", cwd: "C:/repo", at: 50 });
  assert.equal(applyEvent(run, { session: { id: "s1" } }, 60).session, false, "the same session changes nothing");
  changed = applyEvent(run, { tool: { id: "t1", name: "Bash", summary: "Run tests", status: "running" } }, 70);
  assert.equal(changed.tool, true);
  assert.deepEqual(run.activeTool, { id: "t1", tool: "Bash", status: "running", startedAt: 70, updatedAt: 70, description: "Run tests" });
  assert.equal(applyEvent(run, { tool: { id: "other", status: "done" } }, 80).tool, false, "another call's end leaves the active tool");
  assert.equal(applyEvent(run, { tool: { id: "t1", status: "done" } }, 90).tool, true);
  assert.equal(run.activeTool, null);
  changed = applyEvent(run, { todos: [{ content: "a", status: "completed" }, { content: "b", status: "pending" }, { content: "", status: "pending" }] }, 100);
  assert.deepEqual([changed.todos, changed.progress, run.progress, run.todos.length, run.todosUpdatedAt], [true, true, 0.5, 2, 100]);
  assert.deepEqual(applyEvent(run, { todos: [{ content: "a", status: "completed" }, { content: "b", status: "pending" }] }, 110), { session: false, tool: false, todos: false, progress: false, usage: false });
  assert.equal(applyEvent(run, { usage: { input: 1.9, output: -3, cacheRead: 7 } }, 120).usage, true);
  assert.deepEqual(run.cliUsage, { input: 1, output: 0, cacheRead: 7, cacheCreate: 0 });
  assert.deepEqual(applyEvent(null, { usage: {} }, 1), { session: false, tool: false, todos: false, progress: false, usage: false });
});

// A resumed session (the host's `claude -p --resume <id>` / `codex exec
// resume <id>`, executor-resume resumable) answers under the id it was
// resumed with: the decoder reads it as any session, and applyEvent marks the
// record resumed when it is the one the host asked for.
test("a resumed stream's session id is read back, and marked as resumed when it is the one asked for", () => {
  const id = "0f8d6c1e-5b8a-4a51-9a33-9d0c2f3e4b5a";
  const items = createDecoder("claude").push(jsonl({ type: "system", subtype: "init", session_id: id, model: "claude-haiku-4-5" }));
  assert.deepEqual(items[0], { session: { id, cli: "claude", model: "claude-haiku-4-5" } });
  const run = { liveStream: { cli: "claude", model: "haiku", account: null, cwd: "C:/repo", resume: id } };
  assert.equal(applyEvent(run, items[0], 5).session, true);
  assert.equal(run.cliSession.resumed, true);
  assert.equal(run.cliSession.id, id);
  const other = { liveStream: { cli: "claude", model: "haiku", resume: "11111111-2222-4333-8444-555555555555" } };
  applyEvent(other, items[0], 5);
  assert.equal(other.cliSession.resumed, undefined, "a different session than the one asked for is a fresh one");
  const codex = createDecoder("codex").push(jsonl({ type: "thread.started", thread_id: "thread_42" }));
  const codexRun = { liveStream: { cli: "codex", model: "gpt-6", resume: "thread_42" } };
  applyEvent(codexRun, codex[0], 6);
  assert.deepEqual([codexRun.cliSession.id, codexRun.cliSession.resumed], ["thread_42", true]);
});

test("live progress is on unless settings.executor.liveProgress is false or MEFI_STUDIO_LIVE_PROGRESS=0", () => {
  assert.equal(liveProgressEnabled({}, {}), true);
  assert.equal(liveProgressEnabled(null, {}), true);
  assert.equal(liveProgressEnabled({ executor: { liveProgress: false } }, {}), false);
  assert.equal(liveProgressEnabled({ executor: { liveProgress: true } }, { MEFI_STUDIO_LIVE_PROGRESS: "0" }), false);
  assert.equal(liveProgressEnabled({}, { MEFI_STUDIO_LIVE_PROGRESS: "1" }), true);
});

test("a tool summary names the command, file or query, never a file's contents", () => {
  assert.equal(summarize({ command: "ls", description: "List files" }), "List files");
  assert.equal(summarize({ file_path: "src/a.js", content: "SECRET BODY" }), "src/a.js");
  assert.equal(summarize({ old_string: "a", new_string: "SECRET" }), "");
  assert.equal(summarize({ command: ["git", "status"] }), "git status");
  assert.equal(summarize(null), "");
});
