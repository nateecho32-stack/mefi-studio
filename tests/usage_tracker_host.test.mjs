import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tracker = require("../scripts/usage-tracker.cjs");
const mainSource = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const preloadSource = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const modelLabSource = await readFile(new URL("../renderer/model-lab.js", import.meta.url), "utf8");
const idleSource = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const trackerSource = await readFile(new URL("../renderer/tracker.js", import.meta.url), "utf8");
const buildSource = await readFile(new URL("../scripts/build-booklet.mjs", import.meta.url), "utf8");

const code = mainSource.slice(mainSource.indexOf("const OPENCODE_USAGE_URL"), mainSource.indexOf("async function usageTrackerLimits()"));
const payload = { usage: { rolling: { status: "ok", percent: 12, resetsAt: "2026-08-22T17:00:00Z" }, weekly: { status: "ok", percent: 34 }, monthly: { status: "ok", percent: 56 } } };

function fixture({ key = "test-key", fetchImpl = null } = {}) {
  const calls = [];
  const context = vm.createContext({
    Date, AbortController, setTimeout, clearTimeout,
    readSettings: async () => (key ? { apiKeyEncrypted: "encrypted" } : {}),
    decryptKey: (settings, field) => (settings?.[field] ? key : null),
    parseOpencodeUsage: tracker.parseOpencodeUsage,
    describeOpencodeStatus: tracker.describeOpencodeStatus,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetchImpl ? fetchImpl(url, options) : { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
    },
  });
  vm.runInContext(code, context);
  return { calls, read: context.fetchOpencodeUsage };
}
const jsonResponse = (body, status) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

test("no saved key is a plain state and sends no request", async () => {
  const f = fixture({ key: null });
  const result = await f.read();
  assert.equal(result.ok, false);
  assert.equal(result.code, "no-key");
  assert.equal(f.calls.length, 0);
});

test("the account read uses the saved key as a bearer token and caches the success", async () => {
  const f = fixture();
  const first = await f.read();
  assert.equal(first.ok, true);
  assert.equal(first.usage.rolling.percent, 12);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://opencode.ai/zen/go/v1/usage");
  assert.equal(f.calls[0].options.headers.authorization, "Bearer test-key");
  const cached = await f.read();
  assert.equal(cached.ok, true);
  assert.equal(f.calls.length, 1, "a fresh success is not re-fetched");
  await f.read({ maxAgeMs: 0 });
  assert.equal(f.calls.length, 2, "an expired cache re-fetches");
});

test("concurrent readers share one in-flight request", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture({ fetchImpl: () => gate.then(() => jsonResponse(payload, 200)) });
  const first = f.read();
  const second = f.read();
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(f.calls.length, 1);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
});

test("a rejected key keeps the explanation and never returns the credential", async () => {
  const f = fixture({ fetchImpl: () => jsonResponse({ error: { message: "Unauthorized" } }, 401) });
  const result = await f.read();
  assert.equal(result.ok, false);
  assert.equal(result.code, "auth");
  assert.match(result.error, /rejected the saved Go key/);
  assert.doesNotMatch(JSON.stringify(result), /test-key/);
});

test("a provider error that echoes the key is redacted before it reaches the renderer", async () => {
  const f = fixture({ fetchImpl: () => jsonResponse({ error: { message: "rejected test-key" } }, 500) });
  const result = await f.read();
  assert.equal(result.ok, false);
  assert.equal(result.code, "http");
  assert.match(result.error, /redacted/);
  assert.doesNotMatch(JSON.stringify(result), /test-key/);
});

test("a transport failure is reported as a network state, not a spend", async () => {
  const f = fixture({ fetchImpl: () => { throw new Error("socket closed"); } });
  const result = await f.read();
  assert.equal(result.ok, false);
  assert.equal(result.code, "network");
  assert.match(result.error, /socket closed/);
});

test("the bridge, the IPC handlers and the bundle all carry the tracker", () => {
  assert.match(preloadSource, /usageTracker: \(\) => ipcRenderer\.invoke\("usage:tracker"/);
  assert.match(preloadSource, /opencodeCredits: \(\) => ipcRenderer\.invoke\("opencode:credits"/);
  assert.match(mainSource, /require\("\.\/scripts\/usage-tracker\.cjs"\)/);
  assert.match(mainSource, /ipcMain\.handle\("usage:tracker"/);
  assert.match(mainSource, /ipcMain\.handle\("opencode:credits"/);
  assert.match(mainSource, /modelPerformanceStore\(\)\.read\(\)/);
  assert.match(buildSource, /readFile\(path\.join\(RENDERER, "tracker\.js"\), "utf8"\)/);
  assert.match(buildSource, /modelLab, tracker, tree/);
});

test("both surfaces exist in the template and are driven by the tracker module", () => {
  for (const id of ["model-lab-tab-tracker", "model-lab-tracker", "model-lab-tracker-body", "model-lab-tracker-refresh", "cmd-usage", "cmd-usage-body", "cmd-usage-toggle", "cmd-usage-refresh", "cmd-usage-open"]) {
    assert.match(template, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(trackerSource, /window\.MefiUsageTracker = \{ refresh, tick, open, openTab, init \}/);
  assert.match(trackerSource, /bridge\.usageTracker\(\)/);
  assert.match(trackerSource, /bridge\.opencodeCredits/);
  assert.match(modelLabSource, /\["rankings", "usage", "context", "tracker", "compare"\]/);
  assert.match(modelLabSource, /window\.MefiUsageTracker\?\.refresh\?\.\(\)/);
  assert.match(idleSource, /window\.MefiUsageTracker\?\.open\?\.\(\)/);
  assert.match(idleSource, /MefiUsageTracker\?\.tick\?\.\(\)/);
});
