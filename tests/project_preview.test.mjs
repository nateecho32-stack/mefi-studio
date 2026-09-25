// Real local HTTP/process fixtures only: disposable projects, no user state,
// builders, external network, Electron windows, package installs or paid calls.
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { createProjectPreview, loopbackUrl, observedUrls, probeUrl, detectProject } from "../scripts/project-preview.cjs";
import { spawn } from "../scripts/platform.cjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const test = (name, run) => nodeTest(name, { timeout: 45000 }, run);
async function bounded(promise, ms, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function closeService(api) {
  try {
    const results = await bounded(api.closeAll(), 15000, "fixture preview cleanup timed out");
    assert.ok(results.every((result) => result.ok), JSON.stringify(results));
  } catch (error) { api.disposeSync(); throw error; }
}
async function closeServer(server) {
  await bounded(new Promise((resolve, reject) => {
    server.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
    server.closeAllConnections?.();
  }), 5000, "fixture HTTP cleanup timed out");
}
async function until(predicate, ms, message) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function project(t, files = { "index.html": "<h1>fixture app</h1>" }) {
  const root = await mkdtemp(path.join(tmpdir(), "mefi-preview-"));
  t.after(async () => {
    // Windows holds a running child's cwd open. Stop our services before the
    // fixture directory cleanup, regardless of after-hook registration order.
    for (const api of t.previewServices || []) await closeService(api);
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("mefi-preview-"));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  for (const [file, content] of Object.entries(files)) await writeFile(path.join(root, file), content);
  return { id: path.basename(root), path: root };
}
function service(t, options = {}) {
  const events = [], starts = [], opened = [];
  const { directNode = false, ...settings } = options;
  const api = createProjectPreview({ readinessMs: 20000, probeMs: 500, pollMs: 50,
    onChange: (state) => events.push(state), openExternal: async (url) => opened.push(url),
    spawnImpl: (...args) => { if (args[0] === "cmd.exe") { starts.push(args); if (directNode) return spawn(process.execPath, [path.join(args[2].cwd, "server.cjs")], args[2]); } return spawn(...args); }, ...settings });
  (t.previewServices ||= []).push(api);
  t.after(() => closeService(api));
  return { api, events, starts, opened };
}
const body = (url) => fetch(url, { signal: AbortSignal.timeout(5000) }).then((response) => response.text());
const rawRequest = (url, route, headers = {}) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const request = http.get({ host: target.hostname, port: target.port, path: route, headers, signal: AbortSignal.timeout(5000) }, (response) => { response.resume(); resolve(response.statusCode); });
  request.on("error", reject);
});

test("static preview starts once, opens, stops, restarts and remains separate per project", async (t) => {
  const first = await project(t), second = await project(t, { "index.html": "second project" });
  const { api, events, opened, starts } = service(t);
  const idle = await api.status(first);
  assert.equal(idle.phase, "stopped"); assert.equal(idle.kind, "static"); assert.equal(idle.url, null);
  const [a, duplicate] = await Promise.all([api.start(first), api.start(first)]);
  assert.equal(a.phase, "ready"); assert.equal(a.url, duplicate.url); assert.equal(a.owned, true); assert.equal(a.canStop, true);
  assert.match(await body(a.url), /fixture app/);
  assert.equal(await probeUrl(a.url.replace("127.0.0.1", "localhost")), true, "localhost resolves to fixed loopback addresses with Node's family-selection API");
  assert.equal((await api.open(first)).ok, true); assert.deepEqual(opened, [a.url]);
  const b = await api.start(second); assert.notEqual(a.url, b.url); assert.equal(await body(b.url), "second project");
  assert.equal((await api.stop(first)).phase, "stopped"); assert.equal(await probeUrl(a.url), false);
  assert.equal(await body(b.url), "second project", "stopping one project cannot terminate its neighbor");
  const restarted = await api.start(first); assert.equal(restarted.phase, "ready");
  assert.equal(starts.length, 0, "package-free HTML needs neither npm nor a builder");
  assert.ok(events.some((event) => event.phase === "starting"));
  await api.closeAll(); assert.equal(await probeUrl(restarted.url), false); assert.equal(await probeUrl(b.url), false);
});

test("static preview refuses traversal, hidden credentials, symlink escapes and hostile Host headers", async (t) => {
  const p = await project(t, { "index.html": "safe", ".env": "SECRET=fixture", "asset.js": "export const app = 1;" });
  for (const folder of ["data", "config", "assets"]) await mkdir(path.join(p.path, folder));
  for (const file of ["data/auth.json", "config/database.json", "settings.local.json", "credentials.json", "secrets.txt"]) await writeFile(path.join(p.path, file), "fixture private bytes");
  await writeFile(path.join(p.path, "assets", "level.json"), '{"level":1}');
  const outside = await project(t, { "secret.txt": "outside" });
  const { api } = service(t); const { url } = await api.start(p);
  assert.equal(await rawRequest(url, "/asset.js"), 200);
  assert.equal(await rawRequest(url, "/assets/level.json"), 200, "ordinary public JSON assets still work");
  for (const route of ["/data/auth.json", "/config/database.json", "/settings.local.json", "/credentials.json", "/secrets.txt"]) assert.equal(await rawRequest(url, route), 403, route);
  for (const route of ["/.env", "/%2e%2e/secret.txt", "/%2eenv", "/..%5csecret.txt", "/%00.txt"]) assert.equal(await rawRequest(url, route), 403, route);
  assert.equal(await rawRequest(url, "/", { Host: "attacker.example" }), 403);
  // Directory junctions work without Windows symlink privileges.
  await symlink(outside.path, path.join(p.path, "outside"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(await rawRequest(url, "/outside/secret.txt"), 403);
  await symlink(path.join(p.path, "data"), path.join(p.path, "public-alias"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(await rawRequest(url, "/public-alias/auth.json"), 403);
});

test("observed reachable loopback previews are reused without claiming or killing their server", async (t) => {
  const p = await project(t); const { api, starts, opened } = service(t);
  const external = http.createServer((_req, res) => res.end("external"));
  await new Promise((resolve) => external.listen(0, "127.0.0.1", resolve));
  t.after(() => closeServer(external));
  const url = `http://127.0.0.1:${external.address().port}/`;
  const read = await api.status(p, { urls: [`Preview: ${url}`] });
  assert.equal(read.phase, "ready"); assert.equal(read.owned, false); assert.equal(read.canStop, false);
  assert.match(read.message, /did not start/);
  const start = await api.start(p, { urls: [url] }); assert.equal(start.url, url); assert.equal(start.owned, false); assert.equal(starts.length, 0);
  assert.equal((await api.stop(p)).ok, false); assert.equal(await body(url), "external");
  await api.open(p); assert.deepEqual(opened, [url]);
  await api.closeAll(); assert.equal(await body(url), "external", "switch/close cleanup never kills an observed listener");
  await closeServer(external);
  assert.notEqual((await api.status(p, { urls: [url] })).phase, "ready");
  assert.equal((await api.open(p)).ok, false);
});

test("loopback validation rejects credentials, query tokens and outside URLs; probes never follow redirects and have a deadline", async (t) => {
  for (const value of ["file:///tmp/a", "http://example.com", "http://127.0.0.1.evil.test", "http://user:pass@localhost:99", "http://localhost:99/?token=secret", "http://localhost:99/#secret"]) assert.equal(loopbackUrl(value), null);
  assert.equal(loopbackUrl("http://localhost:1234"), "http://localhost:1234/");
  assert.deepEqual(observedUrls(["Open http://127.0.0.1:1234/. Outside https://example.com."]), ["http://127.0.0.1:1234/"]);
  let redirectedHits = 0;
  const redirect = http.createServer((req, res) => { if (req.url === "/target") redirectedHits++; res.writeHead(302, { Location: "/target" }); res.end(); });
  await new Promise((resolve) => redirect.listen(0, "127.0.0.1", resolve));
  t.after(() => closeServer(redirect));
  assert.equal(await probeUrl(`http://127.0.0.1:${redirect.address().port}/`), false); assert.equal(redirectedHits, 0);
  const sockets = new Set(), hung = net.createServer((socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => hung.listen(0, "127.0.0.1", resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); return closeServer(hung); });
  const at = Date.now(); assert.equal(await probeUrl(`http://127.0.0.1:${hung.address().port}/`, { timeoutMs: 100 }), false); assert.ok(Date.now() - at < 2000);
});

const serverScript = `setTimeout(() => process.exit(99), 30000).unref(); const http = require('node:http'); const server = http.createServer((_q,s) => s.end('script app')); server.listen(Number(process.env.PORT), process.env.HOST, () => console.log('Ready http://127.0.0.1:' + server.address().port + '/'));`;
test("a real npm preview process reaches readiness without an executor, coalesces starts and terminates its owned tree", async (t) => {
  const p = await project(t, { "package.json": JSON.stringify({ scripts: { start: "node server.cjs" } }), "server.cjs": serverScript });
  const { api, starts } = service(t);
  assert.equal((await detectProject(p.path)).commandLabel, "npm run start");
  const [state, duplicate] = await Promise.all([api.start(p), api.start(p)]);
  assert.equal(state.phase, "ready", JSON.stringify(state)); assert.equal(state.owned, true); assert.equal(state.url, duplicate.url); assert.equal(starts.length, 1);
  assert.equal(await body(state.url), "script app");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal((await api.status(p)).phase, "ready", "returning readiness leaves the preview process running");
  const stopped = await api.stop(p); assert.equal(stopped.ok, true, JSON.stringify(stopped)); assert.equal(stopped.phase, "stopped"); assert.equal(await probeUrl(state.url), false);
  assert.equal((await api.start(p)).phase, "ready"); assert.equal(starts.length, 2);
});

test("startup failure and timeout release owned children, sanitize logs, and allow a later retry", async (t) => {
  const p = await project(t, { "package.json": JSON.stringify({ scripts: { dev: "node server.cjs" } }), "server.cjs": "console.error('token=fixture-secret'); console.error('Authorization: Bearer fixtureBearerValue'); process.exit(2);" });
  // The short negative deadline tests the service, not npm's machine-dependent
  // cold launch time. Real npm ancestry has its own full-budget case above.
  const { api } = service(t, { readinessMs: 5000, directNode: true });
  const failed = await api.start(p); assert.equal(failed.ok, false); assert.equal(failed.phase, "failed"); assert.equal(failed.canStop, false);
  assert.doesNotMatch(JSON.stringify(failed), /fixture-secret|fixtureBearerValue/);
  await writeFile(path.join(p.path, "server.cjs"), "setTimeout(() => process.exit(99), 30000).unref(); setInterval(() => {}, 1000);");
  const timeout = await api.start(p); assert.equal(timeout.ok, false); assert.match(timeout.error, /startup limit/); assert.equal(timeout.canStop, false);
  await writeFile(path.join(p.path, "server.cjs"), serverScript);
  assert.equal((await api.start(p)).phase, "ready");
});

test("closing during startup cancels admission and leaves no late preview process", async (t) => {
  const p = await project(t, { "package.json": JSON.stringify({ scripts: { start: "node server.cjs" } }), "server.cjs": `setTimeout(() => { ${serverScript} }, 5000);` });
  const { api, events } = service(t);
  const pending = api.start(p);
  await until(() => events.some((state) => state.phase === "starting"), 10000, "fixture preview never entered starting");
  const closed = await api.stop(p);
  await pending;
  assert.equal(closed.phase, "stopped", JSON.stringify(closed)); assert.equal(closed.canStop, false);
  assert.equal(closed.message, "Preview stopped."); assert.equal(closed.error, null);
  assert.equal((await api.status(p)).phase, "stopped");
  assert.equal(events.some((state) => state.phase === "ready"), false);
});

test("a delayed observed-URL status read cannot overwrite a newer owned preview", async (t) => {
  const p = await project(t), { api } = service(t, { probeMs: 1500 });
  let arrived, release;
  const atRequest = new Promise((resolve) => { arrived = resolve; });
  const external = http.createServer((_req, res) => { release = () => res.end("external"); arrived(); });
  await new Promise((resolve) => external.listen(0, "127.0.0.1", resolve));
  t.after(() => closeServer(external));
  const reading = api.status(p, { urls: [`http://127.0.0.1:${external.address().port}/`] });
  await bounded(atRequest, 5000, "fixture observation request never arrived");
  const started = await api.start(p); release();
  const late = await reading;
  assert.equal(late.url, started.url); assert.equal(late.owned, true); assert.equal(late.phase, "ready");
});

test("a script ignoring the assigned PORT fails truthfully and its own server is still cleaned up", async (t) => {
  const p = await project(t, { "package.json": JSON.stringify({ scripts: { start: "node server.cjs" } }), "server.cjs": serverScript.replace("Number(process.env.PORT)", "0") });
  const { api } = service(t, { readinessMs: 5000, directNode: true });
  const failed = await api.start(p);
  assert.equal(failed.phase, "failed"); assert.equal(failed.canStop, false); assert.match(failed.error, /HOST and PORT/);
  const actual = observedUrls(failed.logs.map((line) => line.text));
  assert.equal(actual.length, 1, "the fixture really started its differently bound server");
  assert.equal(await probeUrl(actual[0]), false, "only the tree Studio created was cleaned up");
});

test("an exited launcher retires inherited pipe handles without waiting forever for close", async (t) => {
  const p = await project(t, { "package.json": JSON.stringify({ scripts: { start: "node server.cjs" } }) });
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
  let launched = false, closed = 0;
  for (const stream of [child.stdout, child.stderr]) stream.once("close", () => { if (++closed === 2) child.emit("close", 0); });
  const { api } = service(t, { readinessMs: 10000, spawnImpl: (command) => {
    assert.equal(command, "cmd.exe", "a confirmed exited launcher must not trigger an unrelated process kill");
    launched = true; return child;
  } });
  const pending = api.start(p);
  await until(() => launched, 5000, "fixture launcher never started");
  child.exitCode = 0; child.emit("exit", 0);
  // Model Windows descendants keeping inherited stdout/stderr open: close
  // does not arrive until Studio releases its own handles after launcher exit.
  const result = await bounded(pending, 5000, "exited launcher waited on inherited pipes");
  assert.equal(result.phase, "failed"); assert.equal(result.canStop, false);
  assert.equal(child.stdout.destroyed, true); assert.equal(child.stderr.destroyed, true);
});

for (const exits of [true, false]) test(`a nonzero kill result ${exits ? "waits for a confirmed launcher exit" : "retains ownership when the launcher stays alive"}`, async (t) => {
  const p = await project(t, { "package.json": JSON.stringify({ scripts: { start: "node server.cjs" } }) });
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
  let launched = false, retry = false;
  const { api } = service(t, { spawnImpl: (command) => {
    if (command === "cmd.exe") { launched = true; return child; }
    assert.equal(command, "taskkill");
    const killer = new EventEmitter();
    queueMicrotask(() => {
      killer.emit("close", retry ? 0 : 1);
      if (exits || retry) setTimeout(() => { child.exitCode = 0; child.emit("exit", 0); }, 25);
    });
    return killer;
  } });
  const pending = api.start(p); await until(() => launched, 5000, "fixture launcher never started");
  const stopped = await api.stop(p); await pending;
  assert.equal(stopped.ok, exits); assert.equal(stopped.owned, !exits); assert.equal(stopped.canStop, !exits);
  assert.equal(child.stdout.destroyed, exits); assert.equal(child.stderr.destroyed, exits);
  if (!exits) {
    assert.match(stopped.error, /could not be stopped/);
    retry = true; assert.equal((await api.stop(p)).ok, true);
  }
});

for (const survivingStatus of [200, 500, 302]) test(`a listener surviving its owned launcher stop with HTTP ${survivingStatus} is reported as unowned and is never killed`, async (t) => {
  const p = await project(t, { "package.json": JSON.stringify({ scripts: { start: "node server.cjs" } }) });
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
  let statusCode = 200;
  const external = http.createServer((_req, res) => { res.writeHead(statusCode, statusCode === 302 ? { Location: "/redirect-target" } : {}); res.end("surviving fixture listener"); });
  t.after(() => closeServer(external));
  const kills = []; let launches = 0;
  const { api } = service(t, { spawnImpl: (command, args, options) => {
    if (command === "cmd.exe") { launches++; external.listen(Number(options.env.PORT), "127.0.0.1"); return child; }
    assert.equal(command, "taskkill"); kills.push(args);
    const killer = new EventEmitter();
    queueMicrotask(() => { child.exitCode = 0; child.emit("exit", 0); killer.emit("close", 0); });
    return killer;
  } });
  const ready = await api.start(p); assert.equal(ready.phase, "ready");
  statusCode = survivingStatus;
  const stopped = await api.stop(p);
  assert.equal(stopped.ok, false); assert.equal(stopped.owned, false); assert.equal(stopped.canStop, false);
  assert.match(stopped.error, /URL still responds/); assert.equal(stopped.url, ready.url);
  assert.equal(child.stdout.destroyed, true); assert.equal(child.stderr.destroyed, true);
  assert.equal(await rawRequest(ready.url, "/"), survivingStatus);
  const observed = await api.status(p); assert.equal(observed.phase, survivingStatus === 200 ? "ready" : "failed"); assert.equal(observed.owned, false);
  assert.equal(observed.url, ready.url, "an HTTP error or redirect does not mean the listener disappeared");
  assert.equal((await api.stop(p)).ok, false);
  const restart = await api.start(p);
  assert.equal(restart.ok, survivingStatus === 200); assert.equal(restart.url, ready.url);
  assert.equal(launches, 1, "Start cannot launch a duplicate while an unowned HTTP error/redirect listener remains");
  await closeService(api);
  assert.deepEqual(kills, [["/pid", "12345", "/t", "/f"]], "only the original owned launcher can receive a kill request");
  assert.equal(await rawRequest(ready.url, "/"), survivingStatus);
});

test("natural launcher exit preserves a surviving URL through pipe close and never claims its server stopped", async (t) => {
  const p = await project(t, { "package.json": JSON.stringify({ scripts: { start: "node server.cjs" } }) });
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
  let closed = 0;
  for (const stream of [child.stdout, child.stderr]) stream.once("close", () => { if (++closed === 2) child.emit("close", 0); });
  const external = http.createServer((_req, res) => res.end("surviving fixture listener"));
  t.after(() => closeServer(external));
  const { api, events } = service(t, { spawnImpl: (command, _args, options) => {
    assert.equal(command, "cmd.exe", "an exited launcher gives Studio no right to kill another process");
    external.listen(Number(options.env.PORT), "127.0.0.1"); return child;
  } });
  const ready = await api.start(p); assert.equal(ready.phase, "ready");
  child.exitCode = 0; child.emit("exit", 0);
  await until(() => events.some((state) => state.phase === "failed"), 5000, "natural exit never reached close");
  assert.equal(closed, 2, "the inherited streams really closed before the ownership check");
  const stopBeforeCheck = await api.stop(p);
  assert.equal(stopBeforeCheck.ok, false); assert.equal(stopBeforeCheck.owned, false); assert.equal(stopBeforeCheck.canStop, false);
  assert.equal(stopBeforeCheck.url, ready.url); assert.match(stopBeforeCheck.error, /cannot stop/);
  const observed = await api.status(p);
  assert.equal(observed.phase, "ready"); assert.equal(observed.owned, false); assert.equal(observed.url, ready.url);
  assert.equal((await api.stop(p)).ok, false); assert.equal(await body(ready.url), "surviving fixture listener");
  await closeServer(external);
  const absent = await api.status(p);
  assert.equal(absent.phase, "failed"); assert.equal(absent.url, null); assert.match(absent.error, /no longer responding/);
  assert.equal((await api.stop(p)).phase, "stopped", "only a confirmed absent listener can return stopped");
});

test("launcher close during startup retains a responsive survivor after failure cleanup without a child handle", async (t) => {
  const p = await project(t, { "package.json": JSON.stringify({ scripts: { start: "node server.cjs" } }) });
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
  let closed = 0, launches = 0;
  for (const stream of [child.stdout, child.stderr]) stream.once("close", () => { if (++closed === 2) child.emit("close", 0); });
  const external = http.createServer((_req, res) => { res.writeHead(500); res.end("fixture starting error"); });
  t.after(() => closeServer(external));
  const { api } = service(t, { spawnImpl: (command, _args, options) => {
    assert.equal(command, "cmd.exe", "a vanished launcher cannot be killed through another PID");
    launches++;
    external.listen(Number(options.env.PORT), "127.0.0.1", () => { child.exitCode = 0; child.emit("exit", 0); });
    return child;
  } });
  const failed = await bounded(api.start(p), 5000, "startup close cleanup did not finish");
  assert.equal(closed, 2); assert.equal(failed.phase, "failed"); assert.equal(failed.owned, false); assert.equal(failed.canStop, false);
  assert.ok(failed.url); assert.match(failed.error, /URL still responds/); assert.equal(failed.message, failed.error);
  assert.equal(await rawRequest(failed.url, "/"), 500);
  assert.equal((await api.stop(p)).ok, false);
  const again = await api.start(p); assert.equal(again.ok, false); assert.equal(again.url, failed.url); assert.equal(launches, 1);
});

test("detection does not offer another Electron app as a browser preview", async (t) => {
  const p = await project(t, { "package.json": JSON.stringify({ scripts: { start: "electron ." } }) });
  const { api, starts } = service(t);
  const state = await api.status(p); assert.equal(state.available, false); assert.equal(state.phase, "unavailable");
  assert.equal((await api.start(p)).ok, false); assert.equal(starts.length, 0);
});
