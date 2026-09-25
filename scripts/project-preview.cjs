// Project-local app previews, independent of executor jobs and completion.
// Own only servers started here. Observed loopback listeners may be opened,
// but never acquire a process claim and can never be killed through this API.
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { spawn } = require("./platform.cjs");
const { containsPath } = require("./path-scope.cjs");
const { cleanActivity } = require("./executor-activity.cjs");

function loopbackUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

function observedUrls(values) {
  const urls = new Set();
  for (const value of (Array.isArray(values) ? values : []).slice(0, 100)) {
    for (const match of String(value ?? "").slice(0, 8000).matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
      const url = loopbackUrl(match[0].replace(/[),.;]+$/, ""));
      if (url) urls.add(url);
      if (urls.size >= 4) return [...urls];
    }
  }
  return [...urls];
}

function probeUrl(value, { timeoutMs = 700, requireSuccess = true } = {}) {
  const url = loopbackUrl(value);
  if (!url) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const done = (ready) => { if (!settled) { settled = true; clearTimeout(timer); resolve(ready); } };
    const request = (url.startsWith("https:") ? https : http).get(url, {
      agent: false,
      // localhost is deliberately resolved here, never through mutable DNS.
      lookup: (_hostname, options, callback) => options?.all
        ? callback(null, [{ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }])
        : callback(null, options?.family === 6 ? "::1" : "127.0.0.1", options?.family === 6 ? 6 : 4),
      headers: { Connection: "close" },
    }, (response) => {
      done(!requireSuccess || (response.statusCode >= 200 && response.statusCode < 300));
      response.destroy(); // no response body or redirect is followed
    });
    request.on("upgrade", (_response, socket) => { done(!requireSuccess); socket.destroy(); });
    timer = setTimeout(() => { done(false); request.destroy(); }, timeoutMs);
    request.on("error", () => done(false));
  });
}

async function detectProject(root) {
  try {
    const manifestFile = path.join(root, "package.json");
    const info = await fs.stat(manifestFile);
    if (info.size > 1024 * 1024) throw new Error("manifest too large");
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    for (const script of ["preview", "dev", "start"]) {
      if (typeof manifest.scripts?.[script] === "string" && manifest.scripts[script].trim()) {
        const command = manifest.scripts[script];
        // Desktop launchers are not browser apps; starting another Studio or
        // Electron instance here would never produce a useful local URL.
        if (/(?:^|[\s;&|])(?:electron(?:-forge|-builder)?|love)(?:[\s.]|$)/i.test(command)) continue;
        const flags = /\b(?:vite|astro)\b/.test(command) ? " -- --host 127.0.0.1 --port"
          : /\bnext\s+(?:dev|start)\b/.test(command) ? " -- --hostname 127.0.0.1 --port" : null;
        return { kind: "script", commandLabel: `npm run ${script}`, script, flags };
      }
    }
  } catch { /* A static project needs no package manifest. */ }
  try { if ((await fs.stat(path.join(root, "index.html"))).isFile()) return { kind: "static", commandLabel: "Serve index.html locally" }; }
  catch {}
  return null;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8" };
const PRIVATE_SEGMENT = /^(?:data|config(?:uration)?s?|settings|auth(?:entication)?|credentials?|secrets?|private|backups?|node_modules|package(?:-lock)?|npm-shrinkwrap|service-account)(?:[._-]|$)/i;
const privatePath = (value) => String(value).split(/[\\/]/).some((part) => part.startsWith(".") || PRIVATE_SEGMENT.test(part));

async function staticServer(root) {
  const realRoot = await fs.realpath(root);
  const server = http.createServer(async (request, response) => {
    const fail = (code) => { response.writeHead(code, { "Cache-Control": "no-store" }); response.end(); };
    if (!["GET", "HEAD"].includes(request.method)) return fail(405);
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(request.headers.host || "")) return fail(403);
    try {
      const decoded = decodeURIComponent((request.url || "/").split("?")[0]);
      if (!decoded.startsWith("/") || /[\\\0]/.test(decoded) || privatePath(decoded)) return fail(403);
      let target = path.resolve(realRoot, `.${decoded}`);
      if (!containsPath(realRoot, target) || privatePath(path.relative(realRoot, target))) return fail(403);
      if ((await fs.stat(target)).isDirectory()) target = path.join(target, "index.html");
      target = await fs.realpath(target);
      if (!containsPath(realRoot, target) || privatePath(path.relative(realRoot, target))) return fail(403);
      const info = await fs.stat(target), type = TYPES[path.extname(target).toLowerCase()];
      if (!info.isFile() || !type || info.size > 32 * 1024 * 1024) return fail(403);
      const content = request.method === "HEAD" ? null : await fs.readFile(target);
      response.writeHead(200, { "Content-Type": type, "Content-Length": info.size, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(content);
    } catch { if (!response.headersSent) fail(404); else response.destroy(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server;
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function createProjectPreview({ onChange = () => {}, openExternal = async () => {}, spawnImpl = spawn, readinessMs = 12000, probeMs = 700, pollMs = 150, stopMs = 5000 } = {}) {
  const records = new Map();
  const record = (project) => {
    if (!project?.id || !project.path || project.placeholder) throw new Error("Open a project folder to preview its app.");
    const key = `${project.id}\0${path.resolve(project.path)}`;
    if (!records.has(key)) records.set(key, { projectId: project.id, root: path.resolve(project.path), version: 0, phase: "stopped", detection: null, url: null, owned: false, logs: [], error: null, message: "Preview is stopped.", child: null, server: null });
    return records.get(key);
  };
  const snapshot = (r, ok = true, error = r.error) => ({ ok, projectId: r.projectId, phase: r.phase, available: Boolean(r.detection || r.url), kind: r.detection?.kind || null, commandLabel: r.detection?.commandLabel || null, url: r.url, owned: r.owned, canStop: Boolean(r.child || r.server), message: r.message, error: error || null, logs: r.logs.map((line) => ({ ...line })), startedAt: r.startedAt || null, checkedAt: r.checkedAt || null });
  const publish = (r) => { try { onChange(snapshot(r)); } catch {} };
  const log = (r, text) => {
    const begins = /-----BEGIN .*PRIVATE KEY-----/.test(text), ends = /-----END .*PRIVATE KEY-----/.test(text);
    if (begins || r.privateKey) { r.privateKey = !ends; return; }
    const clean = cleanActivity(String(text).replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, "$1[redacted parameters]"));
    if (clean) { r.logs.push({ at: Date.now(), text: clean }); r.logs = r.logs.slice(-24); }
  };
  const probe = (url) => probeUrl(url, { timeoutMs: probeMs });
  // Readiness requires a successful app response. Shutdown must also notice
  // servers that remain alive but return an error, redirect or upgrade.
  const responds = (url) => probeUrl(url, { timeoutMs: probeMs, requireSuccess: false });
  async function observe(r, urls, starting = false) {
    const version = r.version;
    for (const url of observedUrls(urls)) {
      const ready = await probe(url);
      if (r.version !== version || r.stopPromise || (!starting && r.startPromise) || (starting && r.cancel)) return false;
      if (ready) { r.url = url; r.owned = false; r.phase = "ready"; r.error = null; r.message = "Existing local preview is reachable. Studio did not start it and cannot stop it."; r.checkedAt = Date.now(); return true; }
    }
    return false;
  }
  async function status(project, { urls = [] } = {}) {
    const r = record(project);
    const version = r.version;
    if (r.startPromise || r.stopPromise) return snapshot(r);
    r.detection = await detectProject(r.root);
    if (r.version !== version || r.startPromise || r.stopPromise) return snapshot(r);
    if (r.url) {
      const checkedUrl = r.url, ready = await probe(checkedUrl);
      const responding = ready || await responds(checkedUrl);
      if (r.version !== version || r.startPromise || r.stopPromise || r.url !== checkedUrl) return snapshot(r);
      r.checkedAt = Date.now();
      if (ready) { r.phase = "ready"; r.error = null; r.message = r.owned ? "Preview is running independently of build tasks." : "Existing local preview is reachable. Studio did not start it and cannot stop it."; }
      else { r.phase = "failed"; r.error = responding ? "The preview URL responds, but the app is not ready (HTTP error or redirect)." : "The preview URL is no longer responding."; r.message = r.error; if (!r.owned && !responding) r.url = null; }
    }
    if (!r.owned && r.phase !== "ready") {
      await observe(r, urls);
      if (r.version !== version || r.startPromise || r.stopPromise) return snapshot(r);
      if (!r.url && r.phase !== "failed") { r.phase = r.detection ? "stopped" : "unavailable"; r.message = r.detection ? "Ready to start a project preview." : "No preview, dev or start script, or index.html was found."; }
    }
    publish(r); return snapshot(r);
  }
  async function stopOwned(r) {
    const url = r.url;
    if (r.server) {
      const server = r.server;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Preview HTTP server did not finish closing. Try Stop again.")), stopMs);
        // Stop accepting first; draining before close can miss a connection
        // arriving between the two calls and leave shutdown waiting forever.
        server.close((error) => { clearTimeout(timer); error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve(); });
        server.closeAllConnections();
      });
      r.server = null;
    }
    if (r.child) {
      const child = r.child;
      if (child.exitCode === null && child.pid) await new Promise((resolve, reject) => {
        const killer = spawnImpl("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
        const timer = setTimeout(() => { try { killer.kill(); } catch {} reject(new Error("Preview stop timed out; its process is still owned.")); }, stopMs);
        killer.once("error", (error) => { clearTimeout(timer); reject(error); });
        killer.once("close", (code) => {
          clearTimeout(timer);
          const exited = () => r.child !== child || child.exitCode !== null || Boolean(child.signalCode);
          if (code === 0 || exited()) { resolve(); return; }
          // Windows can report a disappearing PID before Node delivers its
          // exit event. Confirm that event briefly; a still-live child remains
          // owned and receives an honest failed-stop result.
          let settleTimer;
          const settled = () => { clearTimeout(settleTimer); child.removeListener("exit", settled); exited() ? resolve() : reject(new Error("Preview process could not be stopped. Try Stop again.")); };
          child.once("exit", settled);
          settleTimer = setTimeout(settled, Math.min(stopMs, 500));
          if (exited()) settled();
        });
      });
      // A Windows descendant can retain inherited pipes after the launcher
      // exits. Retiring our stream handles must not keep Studio/test shutdown
      // alive indefinitely; never destroy them while a stop has failed.
      child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
      r.child = null;
    }
    // Close may already have released the launcher before startup failure
    // reaches cleanup. The last assigned URL still needs the same check.
    if (url && await responds(url)) {
      r.owned = false; r.url = url;
      throw new Error("The preview launcher stopped, but its URL still responds. Studio cannot safely claim or stop the remaining listener.");
    }
    r.owned = false; r.url = null;
  }
  function start(project, options = {}) {
    const r = record(project);
    if (r.startPromise) return r.startPromise;
    if (r.stopPromise) return r.stopPromise.then(() => start(project, options));
    r.version += 1;
    r.cancel = false;
    r.startPromise = (async () => {
      if (r.url && await probe(r.url)) { r.phase = "ready"; r.error = null; r.checkedAt = Date.now(); r.message = r.owned ? "Preview is running independently of build tasks." : "Existing local preview is reachable. Studio did not start it and cannot stop it."; publish(r); return snapshot(r); }
      if (r.url && !r.owned && await responds(r.url)) { r.phase = "failed"; r.error = "Existing local preview responds but is not ready. Studio did not start it; stop that server before starting another preview."; r.message = r.error; publish(r); return snapshot(r, false); }
      if (r.cancel) return snapshot(r);
      if (r.owned) await stopOwned(r);
      r.detection = await detectProject(r.root);
      if (r.cancel) return snapshot(r);
      if (await observe(r, options.urls || [], true)) { publish(r); return snapshot(r); }
      if (r.cancel) return snapshot(r);
      if (!r.detection) { r.phase = "unavailable"; r.message = "No supported local app preview was found."; publish(r); return snapshot(r, false, r.message); }
      r.phase = "starting"; r.error = null; r.logs = []; r.privateKey = false; r.candidates = null; r.message = "Starting preview and waiting for a reachable local URL…"; r.startedAt = Date.now(); publish(r);
      if (r.detection.kind === "static") {
        r.server = await staticServer(r.root); r.owned = true;
        r.url = `http://127.0.0.1:${r.server.address().port}/`;
      } else {
        const port = await freePort();
        if (r.cancel) return snapshot(r);
        const expectedUrl = `http://127.0.0.1:${port}/`;
        const command = `${r.detection.commandLabel}${r.detection.flags ? `${r.detection.flags} ${port}` : ""}`;
        const child = spawnImpl("cmd.exe", ["/d", "/s", "/c", command], { cwd: r.root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOST: "127.0.0.1", HOSTNAME: "127.0.0.1", PORT: String(port), BROWSER: "none" } });
        r.child = child; r.owned = true; r.url = expectedUrl; r.candidates = [expectedUrl];
        const wire = (stream) => {
          let buffer = "";
          stream?.on("data", (chunk) => {
            if (r.child !== child) return;
            buffer += String(chunk);
            const lines = buffer.split(/\r?\n/); buffer = lines.pop().slice(-8192);
            // Never claim an unrelated fixed-port listener from process text.
            // This launch owns the fresh PORT assigned above; unsupported
            // scripts that ignore PORT need an explicit observed URL instead.
            for (const line of lines) { log(r, line); r.candidates = [...new Set([...r.candidates, ...observedUrls([line]).filter((url) => new URL(url).port === String(port))])].slice(0, 4); }
            publish(r);
          });
        };
        wire(child.stdout); wire(child.stderr);
        child.once("exit", () => {
          // `close` waits for inherited stdio, unlike `exit`. Allow buffered
          // output to land, then retire only handles of a confirmed dead child.
          const timer = setTimeout(() => { child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy(); }, 1000);
          timer.unref?.();
        });
        child.once("error", (error) => { if (r.child === child) { r.error = cleanActivity(error.message); r.phase = "failed"; r.child = null; r.owned = false; r.url = null; publish(r); } });
        child.once("close", (code) => { if (r.child === child) { r.child = null; r.owned = false; if (!r.cancel) { r.phase = "failed"; r.error ||= `Preview process ended (code ${code ?? "unknown"}).`; r.message = r.error; /* Keep the last URL observable: a descendant may outlive its launcher. */ publish(r); } } });
      }
      const deadline = Date.now() + readinessMs;
      while (!r.cancel && Date.now() < deadline && r.owned) {
        for (const url of r.candidates || [r.url]) {
          if (await probe(url) && !r.cancel && r.owned) { r.url = url; r.phase = "ready"; r.checkedAt = Date.now(); r.message = "Preview is running independently of build tasks."; publish(r); return snapshot(r); }
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      if (r.cancel) return snapshot(r);
      throw new Error(r.error || "Preview did not become ready within the startup limit. Its script must bind to HOST and PORT supplied by Studio (or use the supported Vite, Astro or Next port flags). Check the preview log.");
    })().catch(async (error) => {
      r.error = cleanActivity(error.message) || "Preview could not start."; r.message = r.error;
      try { await stopOwned(r); } catch (stopError) { r.error = `${r.error} ${cleanActivity(stopError.message)}`; }
      r.phase = "failed"; r.message = r.error; publish(r); return snapshot(r, false);
    }).finally(() => { r.startPromise = null; });
    return r.startPromise;
  }
  function stop(project, { cleanup = false } = {}) {
    const r = record(project);
    if (r.stopPromise) return r.stopPromise;
    r.version += 1;
    r.cancel = true;
    r.stopPromise = (async () => {
      if (r.startPromise) await r.startPromise;
      if (!r.owned) {
        if (cleanup) { r.url = null; r.phase = "stopped"; r.error = null; r.message = "Preview tracking closed; externally started servers remain running."; publish(r); return snapshot(r); }
        if (r.url) return snapshot(r, false, "Studio did not start this preview and cannot stop its server.");
        r.phase = "stopped"; r.error = null; r.message = "Preview stopped."; publish(r); return snapshot(r);
      }
      r.phase = "stopping"; r.message = "Stopping Studio's preview process…"; publish(r);
      await stopOwned(r); r.phase = "stopped"; r.error = null; r.message = "Preview stopped."; publish(r); return snapshot(r);
    })().catch((error) => { r.phase = "failed"; r.error = cleanActivity(error.message); r.message = r.error; publish(r); return snapshot(r, false); }).finally(() => { r.stopPromise = null; });
    return r.stopPromise;
  }
  async function open(project, options) {
    const state = await status(project, options);
    if (state.phase !== "ready" || !loopbackUrl(state.url)) return { ...state, ok: false, error: "Start a reachable preview before opening it." };
    await openExternal(state.url); return state;
  }
  async function closeAll() { return Promise.all([...records.values()].map((r) => stop({ id: r.projectId, path: r.root }, { cleanup: true }))); }
  function disposeSync() {
    for (const r of records.values()) {
      r.cancel = true; r.server?.closeAllConnections(); r.server?.close();
      if (r.child?.pid) spawnImpl("taskkill", ["/pid", String(r.child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    }
  }
  return { status, start, stop, open, closeAll, disposeSync };
}

module.exports = { createProjectPreview, loopbackUrl, observedUrls, probeUrl, detectProject };
