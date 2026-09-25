"use strict";
// Studio's loopback desk endpoint (roadmap 0.4.0, M4): the other half of
// scripts/desk-mcp.mjs. It listens on 127.0.0.1 only, on a port the OS picks,
// and answers one route, POST /desk, for callers holding this process's
// random token. Each call is handed to `handle` (the Agent Brain's askDesk),
// which resolves when the desk has answered or sent the question to the owner.
//
// Per-run MCP config files name the server for the worker CLI: an OpenCode
// config (read through OPENCODE_CONFIG) and a Claude Code --mcp-config file.
// They are written to the OS temp folder, whose path holds no spaces or quotes
// that cmd.exe could mangle, and removed when the run ends.

const http = require("node:http");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");

const MAX_BODY = 16 * 1024;
const SAFE_PATH = /^[A-Za-z]:\\[^\s"'&|<>^%!]+$|^\/[^\s"'&|<>^%!]+$/;

function createDeskServer({ handle, token = crypto.randomBytes(24).toString("hex"), host = "127.0.0.1" } = {}) {
  if (typeof handle !== "function") throw new Error("createDeskServer needs handle(request)");
  let server = null;
  let listening = null;

  function respond(res, status, body) {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }

  function onRequest(req, res) {
    if (req.method !== "POST" || req.url !== "/desk") return respond(res, 404, { ok: false, answer: "Not here." });
    // Digests of equal length, so a header of the right length in odd bytes
    // can never make the comparison throw out of the request handler.
    const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();
    const same = crypto.timingSafeEqual(digest(req.headers["x-mefi-desk-token"] ?? ""), digest(token));
    if (!same) return respond(res, 403, { ok: false, answer: "Not allowed." });
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
      if (!body || typeof body.question !== "string" || !body.question.trim()) return respond(res, 400, { ok: false, answer: "Send one question." });
      try {
        const result = await handle({
          taskId: typeof body.taskId === "string" ? body.taskId.slice(0, 80) : null,
          runId: typeof body.runId === "string" ? body.runId.slice(0, 80) : null,
          question: body.question.trim().slice(0, 240),
          detail: typeof body.detail === "string" ? body.detail.slice(0, 600) : "",
        });
        respond(res, 200, { ok: result?.ok !== false, answer: String(result?.answer ?? ""), escalated: result?.escalated === true });
      } catch (error) {
        respond(res, 500, { ok: false, answer: `The desk failed: ${String(error?.message ?? error).slice(0, 120)}` });
      }
    });
  }

  async function start() {
    if (listening) return listening;
    listening = new Promise((resolve, reject) => {
      server = http.createServer(onRequest);
      server.on("error", reject);
      server.listen(0, host, () => {
        server.unref?.();
        resolve({ url: `http://${host}:${server.address().port}/desk`, token });
      });
    });
    return listening;
  }

  async function stop() {
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
    server = null;
    listening = null;
  }

  return { start, stop, token };
}

// The two per-run config files, and the environment the MCP server reads.
// Returns null when the temp folder's path is one cmd.exe could mangle.
async function writeRunConfigs({ url, token, taskId, runId, script, node = process.execPath, electron = Boolean(process.versions.electron), dir = os.tmpdir() }) {
  const safeRun = String(runId ?? "run").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || "run";
  const env = { MEFI_DESK_URL: url, MEFI_DESK_TOKEN: token, MEFI_DESK_TASK: String(taskId ?? ""), MEFI_DESK_RUN: String(runId ?? "") };
  // A private folder per run (mkdtemp picks an unused name, 0700 on POSIX):
  // no other user can read the token or plant a config the CLI would run.
  const probe = path.join(dir, `mefi-desk-${safeRun}-XXXXXX`);
  if (!SAFE_PATH.test(probe)) return null;
  const folder = await fsp.mkdtemp(path.join(dir, `mefi-desk-${safeRun}-`));
  const opencode = path.join(folder, "opencode.json");
  const claude = path.join(folder, "claude.json");
  if (!SAFE_PATH.test(opencode) || !SAFE_PATH.test(claude)) { await fsp.rm(folder, { recursive: true, force: true }).catch(() => {}); return null; }
  // Inside Studio the runtime is Electron's own binary, which ELECTRON_RUN_AS_NODE
  // turns into a plain node for the MCP server.
  const nodeEnv = electron ? { ...env, ELECTRON_RUN_AS_NODE: "1" } : env;
  const write = { encoding: "utf8", mode: 0o600, flag: "wx" };
  await fsp.writeFile(opencode, JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { mefi_desk: { type: "local", command: [node, script], environment: nodeEnv, enabled: true } } }, null, 2), write);
  await fsp.writeFile(claude, JSON.stringify({ mcpServers: { mefi_desk: { command: node, args: [script], env: nodeEnv } } }, null, 2), write);
  return { opencode, claude, folder };
}

async function removeRunConfigs(files) {
  for (const file of [files?.opencode, files?.claude]) if (file) await fsp.rm(file, { force: true }).catch(() => {});
  if (files?.folder) await fsp.rm(files.folder, { recursive: true, force: true }).catch(() => {});
}

module.exports = { createDeskServer, writeRunConfigs, removeRunConfigs, SAFE_PATH };
