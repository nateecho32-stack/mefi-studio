// npm run start:web must stay a loopback-only preview of the renderer: it
// listens on 127.0.0.1 and serves renderer/, assets/ and the public catalog,
// never the rest of data/ (the live app's tasks, history and logs), sources,
// dotfiles or anything a traversal can reach.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const studio = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let child;
let bound;

before(async () => {
  child = spawn(process.execPath, [join(studio, "scripts", "serve.mjs")], {
    cwd: studio,
    env: { ...process.env, MEFI_STUDIO_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bound = await new Promise((resolveBound, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`serve.mjs never reported its address:\n${output}`)), 10_000);
    const collect = (chunk) => {
      output += chunk;
      const match = /http:\/\/([^\s/]+):(\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolveBound({ host: match[1], port: Number(match[2]) });
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`serve.mjs exited with ${code}:\n${output}`));
    });
  });
});

after(() => child?.kill());

// Raw request paths, sent as written: fetch() would normalize the traversals away.
function get(rawPath) {
  return new Promise((resolveResponse, reject) => {
    const request = http.get({ host: "127.0.0.1", port: bound.port, path: rawPath }, (response) => {
      response.resume();
      response.on("end", () => resolveResponse({ status: response.statusCode, type: response.headers["content-type"] }));
    });
    request.on("error", reject);
  });
}

function reachable(host, port) {
  return new Promise((resolveReach) => {
    const socket = net.connect({ host, port });
    const settle = (reached) => {
      socket.destroy();
      resolveReach(reached);
    };
    socket.setTimeout(2000, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

test("listens on loopback only", async (t) => {
  assert.equal(bound.host, "127.0.0.1");
  assert.equal(await reachable("127.0.0.1", bound.port), true);
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && !entry.internal && entry.family === "IPv4")
    .map((entry) => entry.address);
  if (!lan.length) {
    t.diagnostic("no non-internal IPv4 interface to probe");
    return;
  }
  const reached = await Promise.all(lan.map((address) => reachable(address, bound.port)));
  assert.deepEqual(lan.filter((_, index) => reached[index]), [], "serve.mjs accepted connections off loopback");
});

test("serves the booklet, its assets and the public catalog", async () => {
  for (const [rawPath, type] of [
    ["/", "text/html"],
    ["/renderer/booklet.html", "text/html"],
    ["/assets/icon-256.png", "image/png"],
    ["/data/models.json?t=1", "application/json"],
  ]) {
    const response = await get(rawPath);
    assert.equal(response.status, 200, rawPath);
    assert.match(response.type, new RegExp(`^${type}`), rawPath);
  }
  assert.equal((await get("/renderer/no-such-file.js")).status, 404);
});

test("never serves local state, sources, dotfiles or traversals", async () => {
  const refused = [
    "/data/eyes-tasks.json",
    "/data/assistant-history.json",
    "/data/executor-log.jsonl",
    "/data/speed-measurements.json",
    "/data/curated.json",
    "/data/",
    "/data",
    "/package.json",
    "/main.cjs",
    "/scripts/serve.mjs",
    "/tests/serve_web.test.mjs",
    "/tools/verify_dev_app.mjs",
    "/.git/HEAD",
    "/.env",
    "/.gitignore",
    "/renderer/.hidden",
    "/../package.json",
    "/renderer/../data/eyes-tasks.json",
    "/renderer/../../package.json",
    "/renderer/%2e%2e/data/eyes-tasks.json",
    "/renderer/..%2fdata%2feyes-tasks.json",
    "/renderer/x%5c..%5c..%5cpackage.json",
    "/renderer/..\\..\\package.json",
    "/renderer/C:%5cWindows%5cwin.ini",
    "/renderer/booklet.html%00.png",
    "/renderer/%E0%A4%A",
    "/DATA/eyes-tasks.json",
    "/renderer",
  ];
  for (const rawPath of refused) {
    assert.equal((await get(rawPath)).status, 403, rawPath);
  }
});
