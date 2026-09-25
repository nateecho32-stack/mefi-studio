#!/usr/bin/env node
// The desk worker as a tool a running worker can call and wait on (roadmap
// 0.4.0, M4): a zero-dependency MCP server over stdio that OpenCode and Claude
// Code start beside a builder run when the owner's agentBrain.deskTool switch
// is on. One tool, ask_desk, forwards the question to Studio's loopback desk
// endpoint (scripts/desk-server.cjs) and returns the desk's answer, so a stuck
// worker gets help mid-run instead of ending its run to ask.
//
// Studio passes where to reach it in the environment: MEFI_DESK_URL (always a
// 127.0.0.1 address), MEFI_DESK_TOKEN, and the run it serves (MEFI_DESK_TASK,
// MEFI_DESK_RUN). MCP's stdio transport is newline-delimited JSON-RPC 2.0.
import { pathToFileURL } from "node:url";

export const TOOL = Object.freeze({
  name: "ask_desk",
  description: "Ask Studio's desk worker for help when you are stuck on how to approach or split a step. It answers with the step's main parts. Not for permission or risky changes: those stay MEFI_ASK lines for the owner.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "What you need to know, in one sentence." },
      detail: { type: "string", description: "What you tried and where you are stuck." },
    },
    required: ["question"],
  },
});

const PROTOCOL = "2024-11-05";
const ASK_TIMEOUT_MS = 150000;

export function loopbackUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "http:" && url.hostname === "127.0.0.1" ? url.href : null;
  } catch {
    return null;
  }
}

// One JSON-RPC message in, zero or one out. `ask` reaches the desk and is
// injected so the protocol can be tested without a server.
export async function handleMessage(message, { ask }) {
  if (!message || typeof message !== "object") return null;
  const { id, method, params } = message;
  const reply = (result) => (id === undefined || id === null ? null : { jsonrpc: "2.0", id, result });
  const fail = (code, text) => (id === undefined || id === null ? null : { jsonrpc: "2.0", id, error: { code, message: text } });
  if (method === "initialize") {
    return reply({ protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "mefi-desk", version: "0.4.0" } });
  }
  if (typeof method === "string" && method.startsWith("notifications/")) return null;
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: [TOOL] });
  if (method === "tools/call") {
    if (params?.name !== TOOL.name) return fail(-32602, `Unknown tool: ${String(params?.name ?? "")}`);
    const question = String(params?.arguments?.question ?? "").trim().slice(0, 240);
    const detail = String(params?.arguments?.detail ?? "").trim().slice(0, 600);
    if (!question) return reply({ content: [{ type: "text", text: "Ask one question in `question`." }], isError: true });
    let answer;
    try {
      answer = await ask({ question, detail });
    } catch (error) {
      answer = { ok: false, answer: `The desk could not be reached (${String(error?.message ?? error).slice(0, 120)}). Carry on with what you can and print MEFI_HELP: ${question}` };
    }
    return reply({ content: [{ type: "text", text: String(answer?.answer ?? "The desk had no answer.") }], isError: answer?.ok === false && !answer?.escalated });
  }
  return fail(-32601, `Method not found: ${String(method ?? "")}`);
}

export function deskAsker(env = process.env, fetchImpl = globalThis.fetch) {
  const url = loopbackUrl(env.MEFI_DESK_URL);
  return async ({ question, detail }) => {
    if (!url) return { ok: false, answer: "The desk is not connected to this run." };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mefi-desk-token": String(env.MEFI_DESK_TOKEN ?? "") },
        body: JSON.stringify({ taskId: env.MEFI_DESK_TASK ?? null, runId: env.MEFI_DESK_RUN ?? null, question, detail }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) return { ok: false, answer: `The desk answered ${response.status}.` };
      return body;
    } finally {
      clearTimeout(timer);
    }
  };
}

function serve() {
  const ask = deskAsker();
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
      handleMessage(message, { ask }).then(write).catch(() => {});
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve();
