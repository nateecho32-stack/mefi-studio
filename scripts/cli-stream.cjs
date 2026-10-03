// Live progress from the coding CLIs. Claude Code (`claude -p --output-format
// stream-json --verbose`) and Codex (`codex exec --json`) print one JSON event
// per line while they work, where their text modes said nothing until the end.
// createDecoder turns that stream back into the text lines the executor has
// always read (executorCore.readWorkerLine: the verdict sentinel, MEFI_RESULT,
// MEFI_NEXT and the rest, unchanged), plus side events that show a run's steps
// as they happen: the CLI's session, the tool it is running, its token usage so
// far and its todo list. applyEvent folds those events into the run's live
// state. See docs/agent-loop.md §4.
//
// A decoder hands back items, in stream order:
//   { line, stdout }  a text line for readWorkerLine. `stdout` is false for the
//                     CLI's own notices (its session start, its errors, lines
//                     outside its events), which are not the run reporting on
//                     its work, so they never cancel the silent-exit fallback.
//   { session: { id, cli, model } }
//   { tool: { id, name, summary, status } }   running | done | failed
//   { usage: { input, output, cacheRead, cacheCreate } }   the run's totals so
//                     far; `input` never counts cached tokens (Codex's
//                     input_tokens does, and is corrected here)
//   { todos: [{ content, status }] }   pending | in_progress | completed
//
// Pure module: no Electron, filesystem, network, processes, timers or clock
// reads (applyEvent is given the time).

"use strict";

const FORMATS = new Set(["claude", "codex"]);
const LABELS = { claude: "Claude Code", codex: "Codex" };
// A stream whose first 20 non-empty lines hold no event is not JSON at all (a
// CLI too old for the flag, a wrapper's banner): from then on every line is
// passed through as text, exactly as before.
const DETECT_LINES = 20;
// One event line is kept to 1 MiB (a tool result can be large; a longer line is
// dropped, never parsed half), a text line to 64 KiB, as wire() keeps it.
const EVENT_LINE_MAX = 1024 * 1024;
const TEXT_LINE_MAX = 65536;
const SUMMARY_MAX = 160;
const TODO_MAX = 40;
// Tool calls and messages remembered until their end or their last repeat.
const REMEMBERED = 64;

const object = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const string = (value) => (typeof value === "string" ? value : "");
const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
const add = (a, b) => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheCreate: a.cacheCreate + b.cacheCreate });
const less = (a, b) => ({ input: a.input - b.input, output: a.output - b.output, cacheRead: a.cacheRead - b.cacheRead, cacheCreate: a.cacheCreate - b.cacheCreate });

// One line of a summary: whitespace flattened, a long path kept by its end (the
// file name is what tells), anything else by its start.
function clip(value, max = SUMMARY_MAX) {
  const flat = string(value).replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return /[\\/]/.test(flat) && !flat.includes(" ") ? `…${flat.slice(-(max - 1))}` : `${flat.slice(0, max - 1)}…`;
}

// What a tool call is about, from its input: a shell command's own description
// before the command, then the file, pattern, address or query. Never a file's
// contents or an edit's text, which no listed field holds.
const SUMMARY_FIELDS = ["description", "command", "file_path", "notebook_path", "path", "pattern", "url", "query", "question", "prompt", "subagent_type"];
function summarize(input) {
  const fields = object(input);
  if (!fields) return "";
  for (const key of SUMMARY_FIELDS) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) return clip(value);
    if (Array.isArray(value) && value.length && value.every((part) => typeof part === "string")) return clip(value.join(" "));
  }
  return "";
}

// A todo list as the run's checkpoint keeps it: [{ content, status }].
const TODO_STATES = new Set(["pending", "in_progress", "completed", "cancelled"]);
function todoList(rows, read) {
  return list(rows).map((row) => {
    const item = object(row);
    const todo = item ? read(item) : null;
    const content = clip(todo?.content, 500);
    return content ? { content, status: TODO_STATES.has(todo.status) ? todo.status : "pending" } : null;
  }).filter(Boolean).slice(0, TODO_MAX);
}
// Codex's todo_list says only done or not: the first open item is the one
// being worked on, as it works through its plan in order.
function codexTodos(items) {
  const todos = todoList(items, (item) => ({ content: item.text, status: item.completed === true ? "completed" : "pending" }));
  const current = todos.find((todo) => todo.status === "pending");
  if (current) current.status = "in_progress";
  return todos;
}

// Claude Code's usage block, and Codex's (whose input_tokens includes the
// cached part).
const claudeUsage = (usage) => ({ input: count(usage?.input_tokens), output: count(usage?.output_tokens), cacheRead: count(usage?.cache_read_input_tokens), cacheCreate: count(usage?.cache_creation_input_tokens) });
function codexUsage(usage) {
  const cached = count(usage?.cached_input_tokens);
  return { input: Math.max(0, count(usage?.input_tokens) - cached), output: count(usage?.output_tokens), cacheRead: cached, cacheCreate: 0 };
}

// Whether a parsed line is one of this CLI's events, which is what switches a
// fresh stream from detecting to decoding.
function recognized(format, event) {
  if (format === "claude") return ["system", "assistant", "user", "result", "stream_event"].includes(event.type);
  if (typeof event.type === "string") return /^(?:thread|turn|item)\./.test(event.type) || event.type === "error";
  return typeof object(event.msg)?.type === "string";
}

// An incremental decoder for one CLI's stdout. `push(chunk)` takes text as it
// arrives (a line may be split across chunks, and a chunk may end mid-line) and
// returns the items its complete lines hold; `end()` reads a last unterminated
// line. A malformed event line is dropped and counted (`stats`), never thrown.
function createDecoder(format) {
  if (!FORMATS.has(format)) throw new Error(`Unknown CLI stream format: ${format}`);
  const label = LABELS[format];
  let mode = "detect"; // "json" after the first event, "text" after DETECT_LINES without one
  let unseen = 0;
  let parts = [], size = 0, cut = false;
  let sessionId = null;
  let lastText = "";
  const tools = new Map(); // call id -> tool name, until the call ends
  const messages = new Map(); // Claude message id -> its usage (each content block repeats it)
  let summed = zero(); // Claude: the messages so far; Codex: the finished turns
  let reported = null;
  const stats = { events: 0, malformed: 0, text: 0 };

  const remember = (map, key, value) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > REMEMBERED) map.delete(map.keys().next().value);
  };
  const say = (out, text, stdout) => {
    for (const line of string(text).split(/\r?\n/)) if (line.trim()) out.push({ line: line.slice(0, TEXT_LINE_MAX), stdout });
  };
  const report = (out, totals) => {
    if (reported && ["input", "output", "cacheRead", "cacheCreate"].every((key) => reported[key] === totals[key])) return;
    reported = { ...totals };
    out.push({ usage: { ...totals } });
  };
  // The session's first event: its id, and one line saying the CLI is up,
  // which is also the run's first line (its start, for the start budget).
  const started = (out, id, model, note = "") => {
    if (!id || sessionId) return;
    sessionId = id;
    out.push({ session: { id, cli: format, ...(model ? { model } : {}) } });
    out.push({ line: `${label} session ${id} started${model ? ` on ${model}` : ""}${note}`, stdout: false });
  };
  const toolStarted = (out, id, name, summary) => {
    if (id) remember(tools, id, name);
    out.push({ tool: { id: id || null, name, summary, status: "running" } });
  };
  const toolEnded = (out, id, failed, known = null) => {
    const name = id ? tools.get(id) : null;
    if (!name && !known) return;
    if (id) tools.delete(id);
    out.push({ tool: { id: id || null, name: name || known.name, summary: known?.summary ?? "", status: failed ? "failed" : "done" } });
  };

  // ---- Claude Code: system/init, assistant, user (tool results), result ----
  function claude(event, out) {
    // A sub-agent's messages (Task) carry the tool call that started it: its
    // tools are the run's activity, its words are not the run's own lines.
    const nested = event.parent_tool_use_id !== undefined && event.parent_tool_use_id !== null;
    if (event.type === "system") {
      if (event.subtype !== "init") return;
      const down = list(event.mcp_servers).map(object).filter((server) => server && server.status && server.status !== "connected")
        .map((server) => `${string(server.name) || "?"} (${string(server.status)})`);
      started(out, string(event.session_id), string(event.model), down.length ? ` · MCP not connected: ${down.join(", ")}` : "");
      return;
    }
    if (event.type === "assistant") {
      const message = object(event.message);
      if (!message) return;
      const id = string(message.id);
      if (id && object(message.usage)) {
        const next = claudeUsage(message.usage);
        const before = messages.get(id);
        summed = add(before ? less(summed, before) : summed, next);
        remember(messages, id, next);
        report(out, summed);
      }
      // Claude Code's own messages (an API error, a login or usage-limit
      // notice) come as a "<synthetic>" model's: the run's last words, not its report.
      const synthetic = message.model === "<synthetic>";
      for (const block of list(message.content)) {
        const part = object(block);
        if (!part) continue;
        if (part.type === "text" && !nested) {
          say(out, part.text, !synthetic);
          if (string(part.text).trim()) lastText = string(part.text).trim();
        } else if (part.type === "tool_use") {
          const name = string(part.name) || "tool";
          if (name === "TodoWrite") {
            if (!nested) out.push({ todos: todoList(object(part.input)?.todos, (item) => ({ content: item.content, status: item.status })) });
          } else {
            toolStarted(out, string(part.id), name, summarize(part.input));
          }
        }
      }
      return;
    }
    if (event.type === "user") {
      for (const block of list(object(event.message)?.content)) {
        const part = object(block);
        if (part?.type === "tool_result") toolEnded(out, string(part.tool_use_id), part.is_error === true);
      }
      return;
    }
    if (event.type === "result") {
      // The whole run's totals, every model it used, replace the running sum.
      const models = Object.values(object(event.modelUsage) ?? {}).map(object).filter(Boolean);
      if (models.length) {
        summed = models.reduce((total, row) => add(total, { input: count(row.inputTokens), output: count(row.outputTokens), cacheRead: count(row.cacheReadInputTokens), cacheCreate: count(row.cacheCreationInputTokens) }), zero());
        report(out, summed);
      } else if (object(event.usage)) {
        summed = claudeUsage(event.usage);
        report(out, summed);
      }
      // The answer itself is never read again: result.result repeats the last
      // assistant message, and its MEFI_NEXT lines would count twice. A failed
      // run's error is read when it says something that message did not.
      const failed = event.is_error === true || (typeof event.subtype === "string" && event.subtype !== "success");
      if (!failed) return;
      const errors = list(event.errors).map((entry) => (typeof entry === "string" ? entry : string(object(entry)?.message))).filter((entry) => entry.trim());
      const detail = (errors[0] || string(event.result)).trim();
      if (!detail) say(out, `${label} stopped: ${string(event.subtype) || "error"}`, false);
      else if (detail !== lastText) say(out, detail, false);
    }
  }

  // ---- Codex: thread/turn/item events, and the older { id, msg } stream ----
  function codexTool(out, kind, item, name, summary) {
    const id = string(item.id);
    if (kind === "item.started") { toolStarted(out, id, name, clip(summary)); return; }
    if (kind !== "item.completed") return;
    const failed = item.status === "failed" || (Number.isInteger(item.exit_code) && item.exit_code !== 0) || Boolean(item.error);
    toolEnded(out, id, failed, { name, summary: clip(summary) });
  }
  function codexItem(out, kind, item) {
    if (!item) return;
    switch (item.type) {
      case "agent_message":
        if (kind === "item.completed") say(out, item.text, true);
        return;
      case "todo_list":
        out.push({ todos: codexTodos(item.items) });
        return;
      case "error":
        if (kind === "item.completed") say(out, string(item.message), false);
        return;
      case "command_execution":
        codexTool(out, kind, item, "shell", item.command);
        return;
      case "file_change":
        codexTool(out, kind, item, "edit", list(item.changes).map((change) => string(object(change)?.path)).filter(Boolean).join(", "));
        return;
      case "mcp_tool_call":
        codexTool(out, kind, item, [string(item.server), string(item.tool)].filter(Boolean).join("/") || "mcp", summarize(item.arguments));
        return;
      case "web_search":
        codexTool(out, kind, item, "web_search", item.query);
        return;
      default:
        // reasoning, and anything newer: nothing to show
    }
  }
  function codexLegacy(msg, out) {
    switch (msg.type) {
      case "session_configured":
        started(out, string(msg.session_id), string(msg.model));
        return;
      case "agent_message":
        say(out, msg.message, true);
        return;
      case "exec_command_begin":
        toolStarted(out, string(msg.call_id), "shell", clip(Array.isArray(msg.command) ? msg.command.join(" ") : msg.command));
        return;
      case "exec_command_end":
        toolEnded(out, string(msg.call_id), Number.isInteger(msg.exit_code) && msg.exit_code !== 0);
        return;
      case "plan_update":
        out.push({ todos: todoList(msg.plan, (item) => ({ content: item.step, status: item.status })) });
        return;
      case "token_count": {
        const total = object(object(msg.info)?.total_token_usage) ?? (Number.isFinite(msg.input_tokens) ? msg : null);
        if (total) report(out, codexUsage(total));
        return;
      }
      case "error":
      case "stream_error":
        say(out, string(msg.message), false);
        return;
      default:
        // task_complete repeats the last agent message; the rest is chatter
    }
  }
  function codex(event, out) {
    if (typeof event.type !== "string") {
      const legacy = object(event.msg);
      if (legacy) codexLegacy(legacy, out);
      return;
    }
    switch (event.type) {
      case "thread.started":
        started(out, string(event.thread_id), "");
        return;
      case "turn.completed":
        summed = add(summed, codexUsage(object(event.usage)));
        report(out, summed);
        return;
      case "turn.failed":
        say(out, string(object(event.error)?.message) || string(event.error) || `${label} turn failed`, false);
        return;
      case "error":
        say(out, string(event.message) || string(object(event.error)?.message) || `${label} reported an error`, false);
        return;
      case "item.started":
      case "item.updated":
      case "item.completed":
        codexItem(out, event.type, object(event.item));
        return;
      default:
        // turn.started and anything newer
    }
  }

  function take(line, truncated, out) {
    if (!line.trim()) return;
    if (mode === "text") {
      stats.text += 1;
      out.push({ line: line.slice(0, TEXT_LINE_MAX), stdout: true });
      return;
    }
    const opens = line.trimStart().startsWith("{");
    let event = null;
    if (opens && !truncated) {
      try { event = object(JSON.parse(line)); } catch { event = null; }
    }
    if (event && (mode === "json" || recognized(format, event))) {
      mode = "json";
      stats.events += 1;
      try { (format === "claude" ? claude : codex)(event, out); } catch { stats.malformed += 1; }
      return;
    }
    if (mode === "json") {
      // Cut short or garbled: an event is never read half, and never as text.
      if (opens) { stats.malformed += 1; return; }
      stats.text += 1;
      out.push({ line: line.slice(0, TEXT_LINE_MAX), stdout: false });
      return;
    }
    unseen += 1;
    if (unseen >= DETECT_LINES) mode = "text";
    stats.text += 1;
    out.push({ line: line.slice(0, TEXT_LINE_MAX), stdout: mode === "text" });
  }
  // Only the new chunk is split, and a line is assembled from its pieces once
  // it ends: re-splitting a growing buffer on every chunk is quadratic.
  const append = (piece) => {
    if (cut || !piece) return;
    if (size + piece.length > EVENT_LINE_MAX) {
      parts.push(piece.slice(0, EVENT_LINE_MAX - size));
      size = EVENT_LINE_MAX;
      cut = true;
      return;
    }
    parts.push(piece);
    size += piece.length;
  };
  const flush = (out) => {
    const raw = parts.length === 1 ? parts[0] : parts.join("");
    const truncated = cut;
    parts = [];
    size = 0;
    cut = false;
    take(raw.endsWith("\r") ? raw.slice(0, -1) : raw, truncated, out);
  };
  return {
    stats,
    get mode() { return mode; },
    push(chunk) {
      const out = [];
      const pieces = String(chunk ?? "").split("\n");
      append(pieces[0]);
      for (let index = 1; index < pieces.length; index += 1) {
        flush(out);
        append(pieces[index]);
      }
      return out;
    },
    end() {
      const out = [];
      if (size > 0) flush(out);
      return out;
    },
  };
}

// Folds one side event into the run's live state (the executor's entry), the
// way watchJobProgress folds an OpenCode session's: the todo list and its done
// fraction (`todos`, `todosUpdatedAt`, `progress`), the tool running now
// (`activeTool`, in the shape executorActivity.workerActivity reads), the CLI's
// own session (`cliSession`, with the route facts the host recorded at spawn in
// `liveStream`, which a later attempt must match to resume it) and the token
// totals (`cliUsage`). Returns what changed, so the host saves and emits only
// then. A text line is not an event: it goes to readWorkerLine.
function applyEvent(run, item, now) {
  const changed = { session: false, tool: false, todos: false, progress: false, usage: false };
  if (!run || !object(item)) return changed;
  const session = object(item.session);
  if (session && string(session.id) && run.cliSession?.id !== session.id) {
    const facts = object(run.liveStream) ?? {};
    run.cliSession = {
      cli: string(session.cli) || string(facts.cli) || null,
      id: session.id,
      // The model the route asked for ("" is the CLI's default), which is what
      // a later route is compared with; the one the CLI named rides beside it.
      model: typeof facts.model === "string" ? facts.model : "",
      ...(string(session.model) ? { reportedModel: session.model } : {}),
      account: string(facts.account) || null,
      cwd: string(facts.cwd) || null,
      at: now,
    };
    changed.session = true;
  }
  const tool = object(item.tool);
  if (tool) {
    if (tool.status === "running") {
      run.activeTool = { id: tool.id ?? null, tool: string(tool.name) || "tool", status: "running", startedAt: now, updatedAt: now, ...(string(tool.summary) ? { description: tool.summary } : {}) };
      changed.tool = true;
    } else if (run.activeTool && (run.activeTool.id ?? null) === (tool.id ?? null)) {
      run.activeTool = null;
      changed.tool = true;
    }
  }
  if (Array.isArray(item.todos)) {
    const todos = item.todos.map(object).filter((todo) => todo && string(todo.content)).slice(0, TODO_MAX).map((todo) => ({ content: todo.content, status: string(todo.status) || "pending" }));
    if (JSON.stringify(run.todos ?? null) !== JSON.stringify(todos)) {
      run.todos = todos;
      run.todosUpdatedAt = now;
      changed.todos = true;
    }
    const done = todos.filter((todo) => todo.status === "completed").length;
    const progress = todos.length ? done / todos.length : null;
    if (progress !== run.progress) {
      run.progress = progress;
      changed.progress = true;
    }
  }
  const usage = object(item.usage);
  if (usage) {
    const totals = { input: count(usage.input), output: count(usage.output), cacheRead: count(usage.cacheRead), cacheCreate: count(usage.cacheCreate) };
    if (JSON.stringify(run.cliUsage ?? null) !== JSON.stringify(totals)) {
      run.cliUsage = totals;
      changed.usage = true;
    }
  }
  return changed;
}

// The kill switches: settings.executor.liveProgress (on unless false) and the
// MEFI_STUDIO_LIVE_PROGRESS=0 environment variable. Off, every CLI keeps its
// text mode and nothing here runs.
function liveProgressEnabled(settings, env = {}) {
  if (env?.MEFI_STUDIO_LIVE_PROGRESS === "0") return false;
  return settings?.executor?.liveProgress !== false;
}

module.exports = { createDecoder, applyEvent, liveProgressEnabled, summarize, DETECT_LINES, EVENT_LINE_MAX, TEXT_LINE_MAX };
