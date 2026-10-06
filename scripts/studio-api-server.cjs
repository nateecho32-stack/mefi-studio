"use strict";
// The Studio API's endpoint (docs/studio-api.md): the HTTP half that main.cjs
// "Other apps" starts when the owner turns it on. It listens on 127.0.0.1 only
// and answers a caller that holds the key from the key file
// (~/.mefi-studio/studio-api.json, beside the connectors' mcp.json), which
// scripts/studio-link.mjs and the owner's own scripts read. scripts/studio-api.cjs
// decides what a request may be; `handle` (main.cjs) does it.
//
// What it refuses before `handle` ever runs:
//   - a Host other than 127.0.0.1:<port> or localhost:<port>, so a web page
//     that points a name of its own at this PC (DNS rebinding) gets nothing;
//   - any request a browser marks with Origin or Sec-Fetch-Site: no web page
//     may call it, and it sends no CORS headers;
//   - a wrong or missing key (compared in constant time);
//   - a body over 64 KB, or one that is not a JSON object;
//   - more than RATE.all calls a minute, or RATE.work calls that start model
//     work (a message to Mefi, a new task).

const http = require("node:http");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");
const rules = require("./studio-api.cjs");

const MINUTE = 60 * 1000;

/** Where the key file lives: MEFI_STUDIO_API_FILE, else ~/.mefi-studio/studio-api.json. */
function keyFilePath(env = process.env, home = os.homedir()) {
  const chosen = String(env.MEFI_STUDIO_API_FILE ?? "").trim();
  return chosen ? path.resolve(chosen) : path.join(home, ".mefi-studio", rules.FILE_NAME);
}

const newKey = () => crypto.randomBytes(24).toString("hex");
const KEY = /^[a-f0-9]{48}$/;

/** The key file as saved, or null when it is missing or not one of Studio's. */
async function readKeyFile(file) {
  try {
    const value = JSON.parse(await fsp.readFile(file, "utf8"));
    return value && typeof value === "object" && KEY.test(String(value.token ?? "")) ? value : null;
  } catch {
    return null;
  }
}

/** Writes the key file whole (a temp file, then a rename), readable by this user only on POSIX. */
async function writeKeyFile(file, info) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(info, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await fsp.rename(temp, file);
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** Removes the key file, but only when it still holds this key: another Studio may have written its own since. */
async function removeKeyFile(file, token) {
  const saved = await readKeyFile(file);
  if (saved && token && saved.token !== token) return false;
  await fsp.rm(file, { force: true }).catch(() => {});
  return true;
}

function createApiServer({ handle, token, port = rules.DEFAULT_PORT, host = "127.0.0.1", now = () => Date.now() } = {}) {
  if (typeof handle !== "function") throw new Error("createApiServer needs handle(request)");
  if (!KEY.test(String(token ?? ""))) throw new Error("createApiServer needs a key");
  let key = String(token);
  let server = null;
  let listening = null;
  let boundPort = null;
  const calls = { all: [], work: [] };

  function respond(res, status, body, extra = {}) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra });
    res.end(JSON.stringify(body));
  }
  const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();
  const keyMatches = (value) => crypto.timingSafeEqual(digest(value), digest(key));

  // Calls in the last minute, per kind; a call over the limit is not counted.
  function allowed(kind) {
    const at = now();
    for (const list of Object.values(calls)) while (list.length && at - list[0] > MINUTE) list.shift();
    if (calls.all.length >= rules.RATE.all) return false;
    if (kind === "work" && calls.work.length >= rules.RATE.work) return false;
    calls.all.push(at);
    if (kind === "work") calls.work.push(at);
    return true;
  }

  function onRequest(req, res) {
    if (!rules.hostAllowed(req.headers.host, boundPort)) return respond(res, 421, { ok: false, error: "Studio answers only 127.0.0.1." });
    if (req.headers.origin || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "none")) return respond(res, 403, { ok: false, error: "Web pages can't call Studio." });
    if (!keyMatches(rules.presentedKey(req.headers))) return respond(res, 401, { ok: false, error: "Not allowed: send the key from the studio-api.json key file." });
    const found = rules.route(req.method, req.url);
    if (!found.route) return respond(res, found.status, { ok: false, error: found.error }, found.allow ? { allow: found.allow } : {});
    if (!allowed(found.route.work ? "work" : "all")) return respond(res, 429, { ok: false, error: "Too many calls. Try again in a minute." }, { "retry-after": "60" });
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on("data", (chunk) => {
      if (tooBig) return;
      size += chunk.length;
      if (size > rules.BODY_MAX) { tooBig = true; respond(res, 413, { ok: false, error: "That body is too big." }); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (tooBig) return;
      let body = {};
      if (size) {
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return respond(res, 400, { ok: false, error: "Send JSON." }); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return respond(res, 400, { ok: false, error: "Send a JSON object." });
      }
      const checked = rules.fields(found.route.name, body);
      if (!checked.ok) return respond(res, 400, { ok: false, error: checked.error });
      try {
        const result = await handle({ route: found.route.name, fields: checked.fields, app: rules.appName(req.headers["x-mefi-app"]) });
        const ok = result?.ok !== false;
        respond(res, ok ? 200 : Number(result?.status) || 503, { ok, text: String(result?.text ?? ""), ...(result?.data !== undefined ? { data: result.data } : {}) });
      } catch (error) {
        respond(res, 500, { ok: false, error: `Studio could not do that: ${String(error?.message ?? error).slice(0, 160)}` });
      }
    });
    req.on("error", () => {});
  }

  function listenOn(candidate) {
    return new Promise((resolve, reject) => {
      const next = http.createServer(onRequest);
      next.requestTimeout = 5 * MINUTE;
      next.headersTimeout = 20 * 1000;
      next.once("error", (error) => { next.close(); reject(error); });
      next.listen(candidate, host, () => {
        next.removeAllListeners("error");
        next.on("error", () => {});
        next.unref?.();
        resolve(next);
      });
    });
  }

  /** Listens on the fixed port, or any free one when another program holds it. */
  async function start() {
    if (listening) return listening;
    const attempt = (async () => {
      try {
        server = await listenOn(port);
      } catch (error) {
        if (error?.code !== "EADDRINUSE" && error?.code !== "EACCES") throw error;
        server = await listenOn(0);
      }
      boundPort = server.address().port;
      return { url: `http://127.0.0.1:${boundPort}`, port: boundPort };
    })();
    // A failed listen is forgotten, so the next start tries again.
    listening = attempt.catch((error) => {
      if (listening === guarded) { listening = null; server = null; }
      throw error;
    });
    const guarded = listening;
    return listening;
  }

  async function stop() {
    const current = server;
    server = null;
    listening = null;
    boundPort = null;
    if (current) await new Promise((resolve) => { current.close(() => resolve()); current.closeAllConnections?.(); });
  }

  return {
    start,
    stop,
    /** A new key takes effect at once; the caller saves it to the key file. */
    rekey(next) { if (!KEY.test(String(next ?? ""))) throw new Error("not a key"); key = String(next); },
    port: () => boundPort,
    running: () => Boolean(server && boundPort),
  };
}

module.exports = { createApiServer, keyFilePath, readKeyFile, writeKeyFile, removeKeyFile, newKey };
