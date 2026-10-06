#!/usr/bin/env node
// Studio for other apps (docs/studio-api.md): the one file Claude Code, Codex,
// Cursor or a script runs to reach Mefi's Studio AI+ on this PC. Zero
// dependencies, so it runs under plain Node or under Studio's own program
// (ELECTRON_RUN_AS_NODE=1).
//
//   node scripts/studio-link.mjs mcp            an MCP server over stdio
//   node scripts/studio-link.mjs status         what the agents are doing
//   node scripts/studio-link.mjs needs          what waits on the owner
//   node scripts/studio-link.mjs made           built now, finished today
//   node scripts/studio-link.mjs say "text"     a message to Mefi; prints the reply
//   node scripts/studio-link.mjs task "Title" [--detail "text"]
//   node scripts/studio-link.mjs notify "text" [--title "text"] [--level info|done|warn]
//   node scripts/studio-link.mjs pause | resume
//   node scripts/studio-link.mjs setup          where Studio lives, its version, the docs
//   node scripts/studio-link.mjs skill          prints the Claude Code skill (SKILL.md)
//
// `--json` prints the whole answer; `--app <name>` (or MEFI_STUDIO_APP) names the
// caller in Studio's log. The address and key come from the key file Studio
// writes when the owner turns on Settings › Other apps
// (~/.mefi-studio/studio-api.json, or MEFI_STUDIO_API_FILE), read at every
// call, so a new key or port needs no change here.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROTOCOL = "2024-11-05";
export const VERSION = (() => { try { return String(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || "0.0.0"); } catch { return "0.0.0"; } })();
const SAY_TIMEOUT_MS = 200000;
const LOOK_TIMEOUT_MS = 20000;
const OFF = "Studio isn't reachable. Open Mefi's Studio AI+ on this PC and turn on Settings › Other apps › Let apps on this PC talk to Studio.";

export function keyFile(env = process.env, home = os.homedir()) {
  const chosen = String(env.MEFI_STUDIO_API_FILE ?? "").trim();
  return chosen ? path.resolve(chosen) : path.join(home, ".mefi-studio", "studio-api.json");
}

// Only a loopback address from the key file is ever called.
export function loopbackUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port ? url.origin : null;
  } catch {
    return null;
  }
}

/** One call to Studio: `{ ok, text, data? }`, never a throw. */
export async function callStudio(routePath, { method = "GET", body = null, app = "An app", env = process.env, fetchImpl = globalThis.fetch, timeoutMs = LOOK_TIMEOUT_MS } = {}) {
  let info = null;
  try { info = JSON.parse(await readFile(keyFile(env), "utf8")); } catch { return { ok: false, text: OFF }; }
  const base = loopbackUrl(info?.url);
  if (!base || typeof info?.token !== "string") return { ok: false, text: OFF };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${base}${routePath}`, {
      method,
      headers: { authorization: `Bearer ${info.token}`, "x-mefi-app": String(app).slice(0, 40), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const answer = await response.json().catch(() => null);
    if (!answer) return { ok: false, text: `Studio answered ${response.status}.` };
    return { ok: response.ok && answer.ok !== false, text: String(answer.text || answer.error || ""), ...(answer.data !== undefined ? { data: answer.data } : {}) };
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, text: "Studio did not answer in time. It may still be working on it: look in Studio." };
    return { ok: false, text: OFF };
  } finally {
    clearTimeout(timer);
  }
}

// ---- the MCP tools -----------------------------------------------------------------------

export const TOOLS = Object.freeze([
  {
    name: "studio_status",
    description: "See what Mefi's Studio AI+ is doing on this PC: the open project, what its agents are building now, and how many things wait on the owner.",
    inputSchema: { type: "object", properties: {} },
    call: () => ["/v1/status"],
  },
  {
    name: "studio_needs",
    description: "List what waits on the owner in Studio (approvals, questions, held or stopped tasks). Read-only: the owner answers these in Studio.",
    inputSchema: { type: "object", properties: {} },
    call: () => ["/v1/needs"],
  },
  {
    name: "studio_made",
    description: "What Studio's agents are building now, and what finished or stopped today.",
    inputSchema: { type: "object", properties: {} },
    call: () => ["/v1/made"],
  },
  {
    name: "studio_message",
    description: "Send a message to Mefi, Studio's assistant, and get its reply. Mefi can file tasks (they wait for the owner's OK), leave notes, and pause or resume work. It can take a minute or two.",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "The message, in plain words." } }, required: ["text"] },
    call: (args) => ["/v1/say", { method: "POST", body: { text: String(args?.text ?? "") }, timeoutMs: SAY_TIMEOUT_MS }],
  },
  {
    name: "studio_add_task",
    description: "Hand a task to Studio's agents on the project open in Studio. It waits for the owner's OK in Studio before anything runs.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "One line: what should be done." },
        detail: { type: "string", description: "What to do and why, what done looks like, and anything the agents should know." },
      },
      required: ["title"],
    },
    call: (args) => ["/v1/tasks", { method: "POST", body: { title: String(args?.title ?? ""), detail: String(args?.detail ?? "") }, timeoutMs: SAY_TIMEOUT_MS }],
  },
  {
    name: "studio_notify",
    description: "Show the owner a short note inside Studio, for example that a long job you ran has finished.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The note, up to 400 characters." },
        title: { type: "string", description: "Optional short heading." },
        level: { type: "string", enum: ["info", "done", "warn"], description: "info (default), done or warn." },
      },
      required: ["text"],
    },
    call: (args) => ["/v1/notify", { method: "POST", body: { text: String(args?.text ?? ""), title: String(args?.title ?? ""), level: String(args?.level ?? "info") } }],
  },
  {
    name: "studio_setup_info",
    description: "Where Mefi's Studio AI+ is installed on this PC (its folder, app files, settings and data, the open project), its version, and which docs to read. Use it when helping the owner set Studio up.",
    inputSchema: { type: "object", properties: {} },
    call: () => ["/v1/setup"],
  },
  {
    name: "studio_control",
    description: "Pause Studio's agents (nothing new starts; running work finishes) or resume them.",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["pause", "resume"] } }, required: ["action"] },
    call: (args) => (["pause", "resume"].includes(args?.action) ? [`/v1/${args.action}`, { method: "POST" }] : null),
  },
]);

const listed = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
// A tool's answer: the words, and the data under them as JSON when there is any.
const toolText = (answer) => [answer.text, answer.data !== undefined && answer.ok ? `\n\`\`\`json\n${JSON.stringify(answer.data, null, 2)}\n\`\`\`` : ""].filter(Boolean).join("\n");

/** One JSON-RPC message in, zero or one out. `call` reaches Studio and is injected for tests. */
export async function handleMessage(message, { call, session = {} } = {}) {
  if (!message || typeof message !== "object") return null;
  const { id, method, params } = message;
  const reply = (result) => (id === undefined || id === null ? null : { jsonrpc: "2.0", id, result });
  const fail = (code, text) => (id === undefined || id === null ? null : { jsonrpc: "2.0", id, error: { code, message: text } });
  if (method === "initialize") {
    // The client's own name (claude-code, codex-mcp-client, cursor…) names it in Studio's log.
    const client = String(params?.clientInfo?.name ?? "").trim();
    if (client) session.app = client.slice(0, 40);
    return reply({
      protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "mefi-studio", version: VERSION },
      instructions: "Mefi's Studio AI+ is the agent studio running on this PC. Look with studio_status, studio_needs and studio_made; talk to its assistant with studio_message; hand work over with studio_add_task (it waits for the owner's OK). Approvals and settings stay in Studio.",
    });
  }
  if (typeof method === "string" && method.startsWith("notifications/")) return null;
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: listed });
  if (method === "tools/call") {
    const tool = TOOLS.find((row) => row.name === params?.name);
    if (!tool) return fail(-32602, `Unknown tool: ${String(params?.name ?? "")}`);
    const request = tool.call(params?.arguments ?? {});
    if (!request) return reply({ content: [{ type: "text", text: "Choose pause or resume." }], isError: true });
    const [routePath, options = {}] = request;
    let answer;
    try { answer = await call(routePath, { ...options, app: session.app || "An MCP app" }); } catch (error) { answer = { ok: false, text: `Studio could not be reached (${String(error?.message ?? error).slice(0, 120)}).` }; }
    return reply({ content: [{ type: "text", text: toolText(answer) || (answer.ok ? "Done." : OFF) }], isError: answer.ok === false });
  }
  return fail(-32601, `Method not found: ${String(method ?? "")}`);
}

function serveMcp() {
  const session = {};
  const call = (routePath, options) => callStudio(routePath, options);
  const pending = new Set();
  let buffer = "";
  const write = (message) => { if (message) process.stdout.write(`${JSON.stringify(message)}\n`); };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      let message = null;
      try { message = JSON.parse(line); } catch { write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
      const job = handleMessage(message, { call, session }).then(write).catch(() => {});
      pending.add(job);
      job.finally(() => pending.delete(job));
    }
  });
  // The client closed its side: answer what is still on its way, then go.
  process.stdin.on("end", () => { Promise.allSettled([...pending]).then(() => process.exit(0)); });
}

// ---- the command line ------------------------------------------------------------------------

const HELP = `Talk to Mefi's Studio AI+ on this PC.

  status                     what the agents are doing
  needs                      what waits on the owner
  made                       built now, finished today
  say "text"                 a message to Mefi (use - to read it from stdin)
  task "Title" [--detail "text"]
  notify "text" [--title "text"] [--level info|done|warn]
  pause | resume
  setup                      where Studio lives, its version, the docs
  skill                      print the Claude Code skill (SKILL.md)
  mcp                        run as an MCP server over stdio

  --json                     print the whole answer as JSON
  --app <name>               how Studio's log names you (or MEFI_STUDIO_APP)

Studio must be open with Settings › Other apps › Let apps on this PC talk to Studio turned on.`;

/** argv → { command, words, flags }. Flags take the next word; --json stands alone. */
export function parseArgs(argv) {
  const words = [], flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index]);
    if (value === "--json") flags.json = true;
    else if (value === "--help" || value === "-h") flags.help = true;
    else if (/^--(detail|title|level|app)$/.test(value)) { flags[value.slice(2)] = String(argv[index + 1] ?? ""); index += 1; }
    else words.push(value);
  }
  return { command: words[0] ?? "", words: words.slice(1), flags };
}

async function readStdin() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** Runs one command; returns the exit code. `out`/`err` are injected for tests. */
export async function runCli(argv, { env = process.env, out = (text) => process.stdout.write(`${text}\n`), err = (text) => process.stderr.write(`${text}\n`), call = callStudio, stdin = readStdin } = {}) {
  const { command, words, flags } = parseArgs(argv);
  const app = flags.app || String(env.MEFI_STUDIO_APP ?? "").trim() || "Command line";
  if (!command || flags.help || command === "help") { out(HELP); return command || flags.help ? 0 : 2; }
  let request = null;
  switch (command) {
    case "status": case "needs": case "made": case "setup": case "hello": request = [`/v1/${command}`]; break;
    case "pause": case "resume": request = [`/v1/${command}`, { method: "POST" }]; break;
    case "say": {
      const text = words[0] === "-" ? await stdin() : words.join(" ");
      if (!text.trim()) { err("say needs a message."); return 2; }
      request = ["/v1/say", { method: "POST", body: { text }, timeoutMs: SAY_TIMEOUT_MS }];
      break;
    }
    case "task": {
      const title = words.join(" ").trim();
      if (!title) { err("task needs a title."); return 2; }
      request = ["/v1/tasks", { method: "POST", body: { title, detail: flags.detail ?? "" }, timeoutMs: SAY_TIMEOUT_MS }];
      break;
    }
    case "notify": {
      const text = words.join(" ").trim();
      if (!text) { err("notify needs the note's words."); return 2; }
      request = ["/v1/notify", { method: "POST", body: { text, title: flags.title ?? "", level: flags.level ?? "info" } }];
      break;
    }
    case "skill": {
      // The skill as Studio writes it, with this PC's command in it.
      const answer = await call("/v1/setup", { env, app });
      if (answer.ok && typeof answer.data?.skill === "string") { out(answer.data.skill.trimEnd()); return 0; }
      err(answer.text || OFF);
      return 1;
    }
    case "mcp": serveMcp(); return null;
    default: err(`Unknown command: ${command}\n\n${HELP}`); return 2;
  }
  const [routePath, options = {}] = request;
  const answer = await call(routePath, { ...options, env, app });
  if (flags.json) out(JSON.stringify(answer, null, 2));
  else (answer.ok ? out : err)(answer.text || (answer.ok ? "Done." : OFF));
  return answer.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((code) => { if (code !== null) process.exitCode = code; });
}
