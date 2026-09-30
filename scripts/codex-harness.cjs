// Codex app-server harness: a Codex worker run over `codex app-server`
// (newline-delimited JSON-RPC on stdio, the protocol `codex app-server
// generate-ts` describes) instead of `codex exec`, behind a facade shaped like
// the ChildProcess spawnAttempt already handles. The executor keeps reading
// what it always read: plain text lines on stdout and stderr (executor-core
// readWorkerLine: the MEFI_* sentinels and the done marker), the exit code,
// "spawn", "error" and "close", the pid its stop path hands to taskkill.
//
// Why a harness at all: `codex exec` takes the run's MCP servers as `-c`
// arguments, which anything that lists processes can read, so a server whose
// environment names a credential was left out (executor-core codexMcpArgs).
// Here they travel in thread/start's `config`, over stdin, and nothing is
// dropped. The same `config` turns off every MCP server Studio did not ask
// for: the owner's ~/.codex/config.toml loads its own servers, plugins and
// ChatGPT apps into every thread otherwise. The server also reports token use
// and the plan's rate limits live (facade.codex), and takes Studio's result,
// ask and hand-off lines as real tools (mefi_result, mefi_ask, mefi_next),
// each echoed on stdout as the sentinel line it stands for.
//
// appServerInvocation is pure (executor-core's cliInvocation returns it for
// `codexHarness: "app-server"`). wrapChild drives one session on a child the
// host spawned; its clock, logger and tree-kill are injected, so a test runs
// it against a scripted fake server with no Electron.
//
// Shapes checked against codex-cli 0.154.0's `codex app-server generate-ts
// --experimental` output and a live probe (initialize, config/read,
// thread/start and mcpServerStatus/list; no turn): see docs/code-map.md.

"use strict";

const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const agentIssues = require("./agent-issues.cjs");
const cliAccounts = require("./cli-accounts.cjs");

const HARNESS = "codex-app-server";
// error.code of the "error" a session that never got going emits: the host's
// cue to run the same attempt once more over `codex exec`.
const START_FAILED = "CODEX_APP_SERVER_START";
const DONE_MARK = "MEFI_JOB_DONE";
// One JSON-RPC line past this is not a message this harness can use (a turn
// summary carrying every item's output); it is skipped, not buffered forever.
const LINE_MAX = 32 * 1024 * 1024;
const SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ANSI = /\u001b\[[0-?]*[ -\/]*[@-~]/g;
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]+/g;

// What every Studio thread turns off: the ChatGPT apps connector (codex_apps)
// and every plugin's MCP server (computer use, code review, remote plugins).
// The owner's own [mcp_servers] are turned off by name once config/read has
// listed them (ownServerOverrides). Confirmed live on 0.154.0: with these
// keys mcpServerStatus/list for the thread shows only Studio's servers.
const ISOLATION = Object.freeze({ "features.apps": false, "features.plugins": false });

// Streaming notifications Studio never reads. Opting out at initialize keeps
// a long run's per-token traffic off the pipe (the executor renders whole
// items only, so a half line can never reach the sentinel reader).
const QUIET = Object.freeze([
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "command/exec/outputDelta",
  "process/outputDelta",
  "turn/diff/updated",
  "thread/started",
]);

// One line of text: no colour codes, no control characters, no line breaks
// (a break inside a sentinel's field would start a second, forged line).
function flat(value, max = 400) {
  return String(value ?? "").replace(ANSI, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// ---- the thread's MCP servers ---------------------------------------------------------

// The run's MCP servers (the attachment's table, { name: { command, args, env } }
// from agent-tool-configs prepare) as thread/start `config` entries. The
// table travels over stdin, so a server whose environment names a credential
// is carried like any other; only a name codex cannot key a table by, or a
// server with no command, is left out (`dropped`, which the host logs).
function threadConfig(servers) {
  const config = { ...ISOLATION };
  const names = [];
  const dropped = [];
  for (const [name, server] of Object.entries(servers && typeof servers === "object" ? servers : {})) {
    const command = typeof server?.command === "string" && server.command ? server.command : null;
    const args = Array.isArray(server?.args) ? server.args : [];
    const env = server?.env && typeof server.env === "object" ? Object.entries(server.env) : [];
    const usable = SERVER_NAME.test(name) && command && args.every((arg) => typeof arg === "string")
      && env.every(([key, value]) => ENV_NAME.test(key) && ["string", "number", "boolean"].includes(typeof value));
    if (!usable) { dropped.push(String(name).slice(0, 64)); continue; }
    config[`mcp_servers.${name}`] = { command, args: [...args], ...(env.length ? { env: Object.fromEntries(env.map(([key, value]) => [key, String(value)])) } : {}), enabled: true };
    names.push(name);
  }
  return { config, names, dropped };
}

// The owner's own MCP servers (config/read's effective `mcp_servers`, project
// layers included when it was read with the run's cwd) that Studio did not
// ask for, each switched off for this thread only. A name a dotted override
// path cannot spell stays on and is reported (`kept`).
function ownServerOverrides(effective, keep = []) {
  const servers = effective?.mcp_servers && typeof effective.mcp_servers === "object" ? effective.mcp_servers : {};
  const overrides = {};
  const off = [];
  const kept = [];
  for (const name of Object.keys(servers)) {
    if (keep.includes(name)) continue;
    if (!SERVER_NAME.test(name)) { kept.push(name); continue; }
    overrides[`mcp_servers.${name}.enabled`] = false;
    off.push(name);
  }
  return { overrides, off, kept };
}

// ---- Studio's tools -----------------------------------------------------------------

function developerInstructions({ doneMark = DONE_MARK } = {}) {
  return [
    "You are a Mefi's Studio worker running unattended: nobody answers approvals or questions, so never wait for input.",
    "Studio reads the plain text of your messages line by line.",
    "The tools mefi_result, mefi_ask and mefi_next record exactly what printing their MEFI_RESULT:, MEFI_ASK: and MEFI_NEXT: lines records; use the tool or print the line, never both.",
    `However you report, the last line of your final message must be the exact line ${doneMark}.`,
  ].join(" ");
}

function dynamicTools({ doneMark = DONE_MARK } = {}) {
  const kinds = agentIssues.ISSUE_KIND_IDS.filter((kind) => kind !== "run-failed");
  const text = (description) => ({ type: "string", description });
  return [
    {
      type: "function",
      name: "mefi_result",
      description: `Report your own account of this job to Mefi's Studio. Calling it is exactly the same as printing the line "MEFI_RESULT: done: <done>; remaining: <remaining>; owner: <owner>" at the start of a line: Studio receives that line. done: what you finished. remaining: what this task still owes, or "none". owner: only what the owner alone can do (a concrete human decision, missing access or a physical action); leave it out otherwise, and never put routine repairs or failing checks there. Studio keeps the first result of a run. It is attached context, not the verdict and not the end of the job: finish the work and still end your final message with the line ${doneMark}.`,
      inputSchema: {
        type: "object",
        properties: { done: text("What you finished."), remaining: text("What this task still owes, or \"none\"."), owner: text("What only the owner can do; omit when nothing.") },
        required: ["done", "remaining"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "mefi_ask",
      description: `Ask for a decision you cannot make yourself. Calling it is exactly the same as printing the line "MEFI_ASK: <kind> :: <question> :: <evidence>" at the start of a line: Studio receives that line and routes the question under the owner's permission mode. It does not end the job and nobody answers during this run: keep working on what you can. Use kind "owner" only for a concrete human decision, missing access or a physical action; test failures and concurrent edits are engineering work, not questions.`,
      inputSchema: {
        type: "object",
        properties: { kind: { type: "string", enum: kinds, description: "What sort of decision this is." }, question: text("The one-line question."), evidence: text("What you saw that raised it.") },
        required: ["kind", "question"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "mefi_next",
      description: `Hand follow-up work you did not do to another Studio agent. Calling it is exactly the same as printing the line "MEFI_NEXT: <title> :: <instructions>" at the start of a line: Studio receives that line and queues the work. Only when your brief allows hand-offs, within the number it names, and only for substantive unfinished work: never to close, update, verify or confirm a card.`,
      inputSchema: {
        type: "object",
        properties: { title: text("A short title for the follow-up."), instructions: text("What the next agent should do.") },
        required: ["title"],
        additionalProperties: false,
      },
    },
  ];
}

// The sentinel line one tool call stands for, and what the tool answers the
// model. A field cannot open a second field or line: ";" inside a result
// field reads as "," and "::" inside an ask or hand-off field as ":", the
// separators the host's own parsers split on.
function toolCall(tool, args) {
  let input = args;
  if (typeof input === "string") { try { input = JSON.parse(input); } catch { input = null; } }
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const noted = (line) => ({ ok: true, line, reply: `Recorded: Studio received the line "${line.slice(0, 200)}". Do not also print it.` });
  const refused = (reply) => ({ ok: false, line: null, reply });
  if (tool === "mefi_result") {
    const field = (value) => flat(value, 400).replace(/;/g, ",");
    const done = field(input.done), remaining = field(input.remaining), owner = field(input.owner);
    if (!done || !remaining) return refused("mefi_result needs done and remaining (write \"none\" when nothing remains).");
    return noted(`MEFI_RESULT: done: ${done}; remaining: ${remaining}${owner ? `; owner: ${owner}` : ""}`);
  }
  const part = (value, max) => flat(value, max).replace(/::+/g, ":");
  if (tool === "mefi_ask") {
    const kinds = agentIssues.ISSUE_KIND_IDS.filter((kind) => kind !== "run-failed");
    const kind = flat(input.kind, 40).toLowerCase();
    const question = part(input.question, 300), evidence = part(input.evidence, 400);
    if (!question) return refused("mefi_ask needs a question.");
    if (!kinds.includes(kind)) return refused(`mefi_ask needs a kind: one of ${kinds.join(", ")}.`);
    return noted(`MEFI_ASK: ${kind} :: ${question}${evidence ? ` :: ${evidence}` : ""}`);
  }
  if (tool === "mefi_next") {
    const title = part(input.title, 90), instructions = part(input.instructions, 600);
    if (!title) return refused("mefi_next needs a title.");
    return noted(`MEFI_NEXT: ${title}${instructions ? ` :: ${instructions}` : ""}`);
  }
  return refused(`Mefi's Studio has no tool named ${flat(tool, 60) || "(none)"}.`);
}

// An error in Codex's own words, so cli-accounts isUsageLimit/resetFrom and
// assistant isProviderOutage read it exactly as they read `codex exec`'s
// "ERROR: You've hit your usage limit. … try again at Oct 3rd, 2026 1:59 PM."
// A usage-limit error whose text says so in other words is tagged with the
// code the limit reader also knows.
function errorLine(error) {
  const message = flat(error?.message ?? error, 1200) || "codex reported an error";
  const details = flat(error?.additionalDetails, 400);
  const text = details && !message.includes(details) ? `${message} (${details})` : message;
  const unnamed = error?.codexErrorInfo === "usageLimitExceeded" && !cliAccounts.isUsageLimit(text);
  return `ERROR: ${text}${unnamed ? " (usage_limit_exceeded)" : ""}`;
}

// A thread's token use (thread/tokenUsage/updated's `tokenUsage`, the
// running total) in the model ledger's shape (model-performance.cjs
// TOKEN_FIELDS). Codex counts cached input inside inputTokens, and names its
// own total. Null when the run reported none.
function ledgerTokenUsage(usage) {
  const total = usage?.total;
  if (!total || typeof total !== "object") return null;
  const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
  return {
    inputTokens: count(total.inputTokens),
    outputTokens: count(total.outputTokens),
    totalTokens: count(total.totalTokens),
    cacheReadTokens: count(total.cachedInputTokens),
    cacheWriteTokens: count(total.cacheWriteInputTokens),
  };
}

// ---- the launch -------------------------------------------------------------------------

// How a Codex worker starts on this route: `codex app-server` through the
// same shell path `codex exec` takes (codex is an npm .cmd shim on Windows,
// so cmd.exe with a verbatim line; an sh line elsewhere), stdin kept by the
// harness (`stdin: null`: the host writes nothing), and the session `plan`
// wrapChild runs: the prompt, the model (held to real-id characters by the
// host's modelArg, and always sent when one is chosen, so the owner's config
// default never replaces Studio's pick), full access with approvals off (the
// bypass `codex exec` runs with), the developer note, and the thread config
// carrying the run's MCP servers. `launch` is executor-core's shellLaunch.
function appServerInvocation(route, prompt, { modelArg = () => "", desk = null, platform = "win32", shim = () => null, launch = null, doneMark = DONE_MARK } = {}) {
  void shim; // codex is always the npm shim: the shell line finds it on PATH
  const shell = launch ?? require("./executor-core.cjs").shellLaunch;
  const selected = modelArg(route?.model);
  const servers = threadConfig(desk?.servers);
  return {
    ...shell("codex", ["app-server"], platform),
    stdio: ["pipe", "pipe", "pipe"],
    stdin: null,
    env: route?.env,
    dropped: servers.dropped,
    harness: HARNESS,
    plan: {
      prompt,
      model: selected || null,
      effort: typeof route?.effort === "string" && route.effort ? route.effort : null,
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      developerInstructions: developerInstructions({ doneMark }),
      config: servers.config,
      mcpServers: servers.names,
      doneMark,
    },
  };
}

// ---- reading the server -------------------------------------------------------------------

// Newline-delimited lines out of arbitrary chunks. Only the new chunk is
// searched for a break (a growing buffer re-scanned per chunk was quadratic
// on a multi-megabyte item), CRLF reads as LF, and a line past `max` is
// dropped whole rather than parsed from its middle.
function lineReader(onLine, { max = LINE_MAX, onOverflow = () => {} } = {}) {
  let parts = [];
  let size = 0;
  let skipping = false;
  const emit = (line) => onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  return {
    push(chunk) {
      const text = String(chunk);
      let start = 0;
      let index;
      while ((index = text.indexOf("\n", start)) >= 0) {
        const piece = text.slice(start, index);
        const line = parts.length ? parts.join("") + piece : piece;
        parts = [];
        size = 0;
        start = index + 1;
        if (skipping) { skipping = false; continue; }
        emit(line);
      }
      if (start < text.length && !skipping) {
        parts.push(text.slice(start));
        size += text.length - start;
        if (size > max) { parts = []; size = 0; skipping = true; onOverflow(); }
      }
    },
    flush() {
      if (parts.length && !skipping) emit(parts.join(""));
      parts = [];
      size = 0;
      skipping = false;
    },
  };
}

// ---- the session ----------------------------------------------------------------------

// Wraps a spawned `codex app-server` child (appServerInvocation's command
// line) in a ChildProcess-compatible facade and drives one worker session:
// initialize → config/read (the owner's MCP servers, turned off) →
// thread/start → turn/start with the prompt. The facade has the child's pid,
// emits "spawn", "error", "exit" and "close", and carries plain text line
// streams on .stdout (the agent's messages as whole lines, "$ <command>",
// file changes, the sentinel line of each Studio tool call) and .stderr (the
// session line, Codex's errors in its own words, declined requests, the
// server's own stderr). .stdin is inert. facade.codex holds the thread and
// turn ids, the resolved model, the latest token usage and the latest
// "codex" plan rate limits (also emitted as "usage" and "rateLimits").
// Exit: 0 when the turn completed, 1 when it failed or was interrupted, the
// server's own nonzero code (else 1) when it died first. A session that never
// got going (no answer within `startTimeoutMs`, or a refused handshake)
// emits "error" with code CODEX_APP_SERVER_START, marks
// facade.codex.startFailed, and exits 1. kill() interrupts the turn, then
// ends the real child (`killTree`, else child.kill()).
function wrapChild(child, {
  prompt = "",
  cwd = null,
  model = null,
  effort = null,
  mcpServers = null,
  config = null,
  developerInstructions: developerText = null,
  sandbox = "danger-full-access",
  approvalPolicy = "never",
  doneMark = DONE_MARK,
  log = () => {},
  now = Date.now,
  startTimeoutMs = 90000,
  exitGraceMs = 5000,
  interruptGraceMs = 5000,
  killTree = null,
  clientVersion = "1",
} = {}) {
  const facade = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  facade.pid = child.pid;
  facade.stdout = stdout;
  facade.stderr = stderr;
  facade.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  facade.stdin.on("error", () => {});
  facade.stdio = [facade.stdin, stdout, stderr];
  facade.exitCode = null;
  facade.signalCode = null;
  facade.killed = false;
  facade.harness = HARNESS;
  facade.codex = { threadId: null, turnId: null, model: null, usage: null, rateLimits: null, rateLimitsAt: null, rateLimitsById: {}, status: "starting", startFailed: false, error: null, serversOff: [] };

  const studio = Array.isArray(mcpServers)
    ? { config: { ...ISOLATION, ...(config ?? {}) }, names: mcpServers.map(String) }
    : (() => { const built = threadConfig(mcpServers); return { config: { ...built.config, ...(config ?? {}) }, names: built.names }; })();
  const note = (text) => { try { log(`[codex app-server] ${text}`); } catch {} };

  // ---- facade output
  let streamsEnded = false;
  let lastErr = null;
  const write = (stream, text) => {
    for (const line of String(text ?? "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (streamsEnded) { note(`late ${stream === stdout ? "stdout" : "stderr"} line: ${flat(line, 200)}`); continue; }
      stream.write(`${line}\n`);
      if (stream === stderr) lastErr = line;
    }
  };
  const out = (text) => write(stdout, text);
  const err = (text) => write(stderr, text);

  // ---- JSON-RPC
  let nextId = 0;
  const pending = new Map();
  const send = (message) => {
    const pipe = child.stdin;
    if (!pipe || pipe.destroyed || pipe.writableEnded) return false;
    try { pipe.write(`${JSON.stringify(message)}\n`); return true; }
    catch (error) { note(`write failed: ${flat(error?.message ?? error, 160)}`); return false; }
  };
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    if (!send({ id, method, params })) {
      pending.delete(id);
      reject(new Error(`could not send ${method}`));
    }
  });
  child.stdin?.on?.("error", (error) => note(`stdin: ${flat(error?.message ?? error, 160)}`));

  // ---- lifecycle
  let phase = "starting"; // starting → running → ending → exited
  let stage = "initialize";
  let decided = null; // the facade's exit code, once known
  let realClosed = false;
  let exited = false;
  let startTimer = null;
  let graceTimer = null;
  let killTimer = null;
  let interruptTimer = null;
  const clear = () => { for (const timer of [startTimer, graceTimer, killTimer, interruptTimer]) if (timer) clearTimeout(timer); startTimer = graceTimer = killTimer = interruptTimer = null; };

  const endStreams = () => {
    if (streamsEnded) return;
    streamsEnded = true;
    stdout.end();
    stderr.end();
  };
  const drained = (stream) => new Promise((resolve) => {
    if (stream.readableEnded || stream.readableFlowing !== true) { resolve(); return; }
    const timer = setTimeout(resolve, 1000);
    stream.once("end", () => { clearTimeout(timer); resolve(); });
  });
  const emitExit = () => {
    if (exited) return;
    exited = true;
    phase = "exited";
    clear();
    const code = decided ?? 1;
    facade.exitCode = code;
    endStreams();
    facade.emit("exit", code, null);
    Promise.all([drained(stdout), drained(stderr)]).then(() => facade.emit("close", code, null));
  };
  // Hard stop: the real child's tree, then (should even that never close it)
  // the facade's own exit, so the host is never left holding a claim.
  const hardKill = () => {
    if (realClosed) { emitExit(); return; }
    try { if (typeof killTree === "function") killTree(child); else child.kill(); }
    catch (error) { note(`kill failed: ${flat(error?.message ?? error, 160)}`); }
    if (!killTimer) killTimer = setTimeout(() => { note("the server did not close after the kill; releasing the run"); emitExit(); }, exitGraceMs);
  };
  // Clean stop: end the server's stdin (it exits on EOF), and kill it if it
  // has not closed within the grace.
  const shutdown = () => {
    if (realClosed) { emitExit(); return; }
    try { child.stdin?.end?.(); } catch {}
    if (!graceTimer) graceTimer = setTimeout(hardKill, exitGraceMs);
  };
  const settle = (code) => {
    if (decided !== null) return;
    decided = code;
    phase = "ending";
    clear();
    endStreams();
    shutdown();
  };

  const startFailure = (reason) => {
    if (phase !== "starting" || realClosed || facade.killed) return;
    facade.codex.startFailed = true;
    facade.codex.status = "start-failed";
    facade.codex.error = reason;
    err(`codex app-server could not start: ${reason}`);
    const error = Object.assign(new Error(`codex app-server could not start: ${reason}`), { code: START_FAILED });
    settle(1);
    if (facade.listenerCount("error")) facade.emit("error", error);
    else note(error.message);
  };

  const seconds = (ms) => `${Math.round(ms / 100) / 10}s`;
  startTimer = setTimeout(() => startFailure(`no answer to ${stage} within ${seconds(startTimeoutMs)}`), startTimeoutMs);

  const ours = (params) => !params?.threadId || !facade.codex.threadId || params.threadId === facade.codex.threadId;

  // ---- notifications
  const itemStarted = (item) => {
    if (!item || typeof item !== "object") return;
    if (item.type === "commandExecution") out(`$ ${flat(item.command, 400)}`);
    else if (item.type === "mcpToolCall") out(`mcp ${flat(item.server, 60)}.${flat(item.tool, 80)}`);
  };
  const itemCompleted = (item) => {
    if (!item || typeof item !== "object") return;
    if (item.type === "agentMessage") out(item.text);
    else if (item.type === "commandExecution") {
      if (Number.isInteger(item.exitCode) && item.exitCode !== 0) out(`  exit ${item.exitCode}`);
      else if (item.status === "declined" || item.status === "failed") out(`  command ${item.status}`);
    } else if (item.type === "fileChange") {
      for (const change of Array.isArray(item.changes) ? item.changes : []) {
        const file = flat(change?.path, 300);
        const kind = change?.kind?.type;
        const moved = kind === "update" && change.kind.move_path ? ` -> ${flat(change.kind.move_path, 300)}` : "";
        const verb = item.status && item.status !== "completed" ? `patch ${flat(item.status, 20)}:` : kind === "add" ? "added" : kind === "delete" ? "deleted" : moved ? "moved" : "edited";
        if (file) out(`${verb} ${file}${moved}`);
      }
    } else if (item.type === "mcpToolCall" && item.error) out(`mcp ${flat(item.server, 60)}.${flat(item.tool, 80)} failed: ${flat(item.error.message ?? item.error, 300)}`);
  };
  const rateLimits = (snapshot) => {
    if (!snapshot || typeof snapshot !== "object") return;
    const id = typeof snapshot.limitId === "string" && snapshot.limitId ? snapshot.limitId : "codex";
    // A rolling update is sparse: a missing value keeps the last one seen.
    const merged = { ...(facade.codex.rateLimitsById[id] ?? {}) };
    for (const [key, value] of Object.entries(snapshot)) if (value !== null && value !== undefined) merged[key] = value;
    facade.codex.rateLimitsById[id] = merged;
    if (id !== "codex") return;
    facade.codex.rateLimits = merged;
    facade.codex.rateLimitsAt = now();
    facade.emit("rateLimits", merged);
  };
  const turnCompleted = (turn) => {
    if (decided !== null) return;
    if (facade.codex.turnId && turn?.id && turn.id !== facade.codex.turnId) return;
    facade.codex.turnId ??= turn?.id ?? null;
    const status = typeof turn?.status === "string" ? turn.status : "failed";
    facade.codex.status = status;
    if (status === "completed") { settle(0); return; }
    if (status === "interrupted") err(`codex: turn interrupted${turn?.error?.message ? `: ${flat(turn.error.message, 400)}` : ""}`);
    else {
      facade.codex.error = turn?.error?.message ?? "turn failed";
      const line = errorLine(turn?.error ?? { message: "the turn failed" });
      if (lastErr !== line) err(line);
    }
    settle(1);
  };
  const notification = (method, params) => {
    switch (method) {
      case "item/started": if (ours(params)) itemStarted(params.item); return;
      case "item/completed": if (ours(params)) itemCompleted(params.item); return;
      case "turn/started": if (ours(params)) facade.codex.turnId ??= params.turn?.id ?? null; return;
      case "turn/completed": if (ours(params)) turnCompleted(params.turn); return;
      case "thread/tokenUsage/updated":
        if (!ours(params)) return;
        facade.codex.usage = params.tokenUsage ?? null;
        facade.emit("usage", facade.codex.usage);
        return;
      case "account/rateLimits/updated": rateLimits(params.rateLimits); return;
      case "error":
        if (!ours(params)) return;
        if (params.willRetry) err(`codex: ${flat(params.error?.message ?? "error", 400)} (retrying)`);
        else err(errorLine(params.error));
        return;
      case "model/rerouted": if (ours(params)) err(`codex: model rerouted from ${flat(params.fromModel, 80)} to ${flat(params.toModel, 80)}`); return;
      case "mcpServer/startupStatus/updated":
        if (params.status === "failed" && studio.names.includes(params.name)) err(`codex: MCP server ${flat(params.name, 64)} failed to start${params.error ? `: ${flat(params.error, 300)}` : ""}`);
        return;
      case "warning": case "configWarning": case "deprecationNotice": case "guardianWarning":
        note(`${method}: ${flat(params.message ?? params.summary ?? JSON.stringify(params), 300)}`);
        return;
      default:
    }
  };

  // ---- requests from the server: this route runs approval-free and unattended
  const answer = (id, result) => send({ id, result });
  const serverRequest = (id, method, params) => {
    if (method === "item/tool/call") {
      const call = toolCall(params?.tool, params?.arguments);
      if (call.line) out(call.line);
      else note(`tool ${flat(params?.tool, 60)} refused: ${call.reply}`);
      answer(id, { success: call.ok, contentItems: [{ type: "inputText", text: call.reply }] });
      return;
    }
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      err(`codex: declined an approval request (this route runs approval-free)${params?.command ? `: ${flat(params.command, 200)}` : params?.reason ? `: ${flat(params.reason, 200)}` : ""}`);
      answer(id, { decision: "decline" });
      return;
    }
    if (method === "item/permissions/requestApproval") {
      err(`codex: declined a permission request (this route runs approval-free)${params?.reason ? `: ${flat(params.reason, 200)}` : ""}`);
      answer(id, { permissions: {}, scope: "turn" });
      return;
    }
    if (method === "execCommandApproval" || method === "applyPatchApproval") {
      err("codex: declined an approval request (this route runs approval-free)");
      answer(id, { decision: { denied: { rejection: "Mefi's Studio runs this worker unattended; approvals are off." } } });
      return;
    }
    if (method === "item/tool/requestUserInput") {
      const asked = (Array.isArray(params?.questions) ? params.questions : []).map((question) => flat(question?.question, 160)).filter(Boolean).join(" / ");
      err(`codex: declined a request for input (nobody is at the keyboard)${asked ? `: ${asked}` : ""}`);
      answer(id, { answers: {} });
      return;
    }
    if (method === "mcpServer/elicitation/request") {
      err(`codex: declined an MCP server's request for input${params?.serverName ? ` from ${flat(params.serverName, 64)}` : ""}`);
      answer(id, { action: "decline", content: null, _meta: null });
      return;
    }
    if (method === "currentTime/read") { answer(id, { currentTimeAt: Math.floor(now() / 1000) }); return; }
    note(`refused server request ${flat(method, 80)}`);
    send({ id, error: { code: -32601, message: `Mefi's Studio does not handle ${flat(method, 80)}` } });
  };

  const dispatch = (line) => {
    const text = line.trim();
    if (!text) return;
    let message = null;
    if (text.startsWith("{")) { try { message = JSON.parse(text); } catch { message = null; } }
    if (!message || typeof message !== "object") { note(`not JSON-RPC: ${flat(text, 160)}`); return; }
    const hasId = message.id !== undefined && message.id !== null;
    if (hasId && typeof message.method === "string") { serverRequest(message.id, message.method, message.params ?? {}); return; }
    if (hasId) {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.error) waiting.reject(Object.assign(new Error(flat(message.error.message ?? `${waiting.method} failed`, 400) || `${waiting.method} failed`), { rpc: message.error }));
      else waiting.resolve(message.result ?? {});
      return;
    }
    if (typeof message.method === "string") notification(message.method, message.params ?? {});
  };

  const serverOut = lineReader(dispatch, { onOverflow: () => note(`skipped a line longer than ${LINE_MAX} characters`) });
  const serverErr = lineReader((line) => err(line));
  child.stdout?.setEncoding?.("utf8");
  child.stderr?.setEncoding?.("utf8");
  child.stdout?.on?.("data", (chunk) => serverOut.push(chunk));
  child.stdout?.on?.("end", () => serverOut.flush());
  child.stderr?.on?.("data", (chunk) => serverErr.push(chunk));
  child.stderr?.on?.("end", () => serverErr.flush());

  child.once?.("spawn", () => facade.emit("spawn"));
  child.on?.("error", (error) => {
    if (exited) return;
    if (facade.listenerCount("error")) facade.emit("error", error);
    else note(`child error: ${flat(error?.message ?? error, 160)}`);
  });
  child.on?.("close", (code, signal) => {
    realClosed = true;
    serverOut.flush();
    serverErr.flush();
    for (const [, waiting] of pending) waiting.reject(new Error(`the server exited during ${waiting.method}`));
    pending.clear();
    if (decided === null) {
      if (phase === "starting") { facade.codex.startFailed = true; facade.codex.status = "start-failed"; }
      if (!facade.killed) err(`codex app-server exited (${code ?? signal ?? "no status"}) before the turn finished`);
      decided = Number.isInteger(code) && code !== 0 ? code : 1;
    }
    emitExit();
  });

  // ---- kill(): interrupt the turn, then end the real child
  facade.kill = (signal = "SIGTERM") => {
    void signal;
    if (exited) return false;
    facade.killed = true;
    const { threadId, turnId } = facade.codex;
    if (phase === "running" && decided === null && threadId && turnId) {
      request("turn/interrupt", { threadId, turnId }).catch((error) => note(`turn/interrupt: ${error.message}`));
      if (!interruptTimer) interruptTimer = setTimeout(() => { interruptTimer = null; if (decided === null) { decided = 1; phase = "ending"; endStreams(); } hardKill(); }, interruptGraceMs);
      return true;
    }
    if (decided === null) { decided = 1; phase = "ending"; endStreams(); }
    hardKill();
    return true;
  };
  facade.ref = () => facade;
  facade.unref = () => facade;

  // ---- the handshake
  const step = (name, params) => { stage = name; return request(name, params); };
  (async () => {
    await step("initialize", {
      clientInfo: { name: "mefi-studio", title: "Mefi's Studio AI+", version: String(clientVersion) },
      capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: [...QUIET] },
    });
    send({ method: "initialized" });
    let effective = null;
    try { effective = (await step("config/read", { includeLayers: false, cwd })).config ?? null; }
    catch (error) {
      if (realClosed || phase !== "starting") return;
      err(`codex: could not read the Codex config (${flat(error.message, 200)}); the owner's own MCP servers may load into this run`);
    }
    if (phase !== "starting") return;
    const own = ownServerOverrides(effective, studio.names);
    facade.codex.serversOff = own.off;
    if (own.off.length) note(`owner MCP servers off for this thread: ${own.off.join(", ")}`);
    if (own.kept.length) err(`codex: could not turn off MCP server(s) ${own.kept.join(", ")} for this run`);
    const started = await step("thread/start", {
      cwd, ...(model ? { model } : {}), sandbox, approvalPolicy,
      developerInstructions: developerText ?? developerInstructions({ doneMark }),
      config: { ...own.overrides, ...studio.config },
      ephemeral: false,
      dynamicTools: dynamicTools({ doneMark }),
    });
    if (phase !== "starting") return;
    const threadId = started?.thread?.id;
    if (!threadId) throw new Error("thread/start named no thread");
    facade.codex.threadId = threadId;
    facade.codex.model = started.model ?? model ?? null;
    err(`codex app-server session ${threadId} (model ${facade.codex.model ?? "default"}${effort ? `, effort ${effort}` : ""})`);
    const turn = await step("turn/start", {
      threadId,
      input: [{ type: "text", text: String(prompt ?? ""), text_elements: [] }],
      ...(effort ? { effort } : {}),
    });
    if (phase !== "starting") return;
    facade.codex.turnId ??= turn?.turn?.id ?? null;
    facade.codex.status = "running";
    phase = "running";
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
  })().catch((error) => startFailure(`${stage} failed: ${flat(error?.message ?? error, 300)}`));

  return facade;
}

module.exports = {
  HARNESS,
  START_FAILED,
  ISOLATION,
  QUIET,
  threadConfig,
  ownServerOverrides,
  developerInstructions,
  dynamicTools,
  toolCall,
  errorLine,
  ledgerTokenUsage,
  appServerInvocation,
  lineReader,
  wrapChild,
};
