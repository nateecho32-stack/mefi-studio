// Trace: Studio's logs as channels. The rules (scripts/trace.cjs) that keep,
// read and filter them, and the sheet (renderer/trace.js) that shows them.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { createDom, templateIds } from "./fixtures/renderer-dom.mjs";

const require = createRequire(import.meta.url);
const trace = require("../scripts/trace.cjs");
const plain = (value) => JSON.parse(JSON.stringify(value));

test("a ring keeps the newest lines and the size of what it holds", () => {
  const ring = trace.ring(3);
  for (const text of ["one", "two", "three", "four"]) ring.push({ text });
  assert.deepEqual(ring.rows().map((row) => row.text), ["two", "three", "four"]);
  assert.equal(ring.size(), "twothreefour".length);
  assert.equal(ring.dropped(), 1);
});

test("a line's level and source are read from its words and its tag", () => {
  assert.equal(trace.levelOf("[error] the board could not be saved"), "error");
  assert.equal(trace.levelOf("[agents] worker failed to start"), "error");
  assert.equal(trace.levelOf("[agents] retrying the claim after a timeout"), "warn");
  assert.equal(trace.levelOf("[assistant] tick"), "info");
  assert.equal(trace.levelOf("quiet line", "warning"), "warn", "a stated level wins");
  assert.equal(trace.sourceOf("[tools:lead] ask_desk: completed"), "tools");
  assert.equal(trace.sourceOf("no tag here"), "studio");
});

test("each channel's rows come out in one shape", () => {
  const start = trace.executorRow({ at: 10, event: "start", title: "Pause polls", via: "mefi-zai/glm" });
  assert.deepEqual(plain(start), { at: 10, level: "info", source: "start", text: 'start  "Pause polls"  mefi-zai/glm' });
  const failed = trace.executorRow(JSON.stringify({ at: 20, event: "finish", title: "Pause polls", via: "x", ok: false, seconds: 12, error: "exit 1" }));
  assert.equal(failed.level, "error");
  assert.match(failed.text, /→ failed in 12s · exit 1/);
  assert.equal(trace.executorRow("not json"), null);
  assert.equal(trace.assistantRow({ at: 5, kind: "error", role: "keeper", text: "prune failed" }).level, "error");
  const opencode = trace.opencodeRow("WARN  2026-09-26T10:00:00 +12ms service=session slow response");
  assert.equal(opencode.level, "warn");
  assert.equal(opencode.source, "session");
  assert.equal(trace.opencodeRow("   "), null);
});

test("the query filters and tails, while counts and sources describe the whole channel", () => {
  const rows = [
    trace.studioRow("[agents] started pid 1", 1), trace.studioRow("[agents] worker failed", 2),
    trace.studioRow("[assistant] tick", 3), trace.studioRow("[updater] retrying download", 4), trace.studioRow("[agents] done", 5),
  ];
  const all = trace.query(rows, { tail: 2 });
  assert.deepEqual(all.rows.map((row) => row.at), [4, 5], "the tail is the newest lines");
  assert.deepEqual(plain(all.counts), { error: 1, warn: 1, info: 3 });
  assert.deepEqual(plain(all.sources), [["agents", 3], ["assistant", 1], ["updater", 1]]);
  assert.deepEqual(trace.query(rows, { problems: true }).rows.map((row) => row.at), [2, 4]);
  assert.deepEqual(trace.query(rows, { sources: ["agents"], text: "done" }).rows.map((row) => row.at), [5]);
  const narrowed = trace.query(rows, { level: "error" });
  assert.equal(narrowed.matched, 1);
  assert.equal(narrowed.total, 5);
});

const source = await readFile(new URL("../renderer/trace.js", import.meta.url), "utf8");
async function sheet(logWriteFailures = []) {
  const calls = [];
  const rows = [{ at: Date.UTC(2026, 8, 26, 10, 0, 0), level: "error", source: "agents", text: "worker failed" }, { at: Date.UTC(2026, 8, 26, 10, 0, 1), level: "info", source: "assistant", text: "tick" }];
  const api = {
    traceChannels: async () => { calls.push(["channels"]); return { ok: true, channels: [{ id: "studio", label: "Studio log", area: "main", size: 2048, lines: 2, problems: 1, errors: 1, detail: "Everything" }, { id: "executor", label: "Runs", area: "agents", size: 0, lines: 0, problems: 0, errors: 0 }] }; },
    traceRead: async (payload) => { calls.push(["read", payload.channel, payload.problems, payload.level, payload.sources]); return { ok: true, logWriteFailures, channel: payload.channel, rows, total: 2, matched: 2, counts: { error: 1, warn: 0, info: 1 }, sources: [["agents", 1], ["assistant", 1]], size: 2048, file: payload.channel === "executor" ? "C:/data/executor-log.jsonl" : null }; },
    shellReveal: async (file) => { calls.push(["reveal", file]); return { ok: true }; },
  };
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("trace-")) });
  get("trace-overlay").hidden = true;
  get("trace-follow").checked = true;
  const window = { mefiStudio: api, MefiNav: { claim() {}, release() {}, close() {} }, addEventListener() {} };
  const context = vm.createContext({ window, document, console, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout() {}, Date });
  vm.runInContext(source, context);
  const settle = async () => { for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
  return { trace: window.MefiTrace, get, calls, settle };
}

test("the sheet lists the channels, reads one and draws its lines newest first", async () => {
  const { trace: sheetApi, get, calls, settle } = await sheet();
  sheetApi.open();
  await settle();
  assert.equal(get("trace-overlay").hidden, false);
  const channels = get("trace-channel-list").children.map((item) => item.children[0]);
  assert.equal(channels[0].getAttribute("aria-current"), "true");
  assert.equal(channels[0].children[1].textContent, "2.0 KB");
  assert.equal(channels[0].children[2].textContent, "1", "an error count on the channel");
  const lines = get("trace-lines").children;
  assert.deepEqual(lines.map((line) => line.children[3].textContent), ["tick", "worker failed"], "newest first");
  assert.equal(lines[1].className, "trace-line is-error");
  assert.deepEqual(get("trace-levels").children.map((chip) => chip.textContent), ["All 2", "Errors 1", "Warnings 0", "Info 1"]);
  get("trace-levels").children[1].click();
  await settle();
  assert.deepEqual(calls.at(-1), ["read", "studio", false, "error", null]);
  get("trace-sources").children[0].click();
  await settle();
  assert.deepEqual(plain(calls.at(-1)), ["read", "studio", false, "error", ["agents"]]);
  channels[1].click();
  await settle();
  assert.deepEqual(calls.at(-1), ["read", "executor", false, null, null], "a new channel starts unfiltered");
  assert.equal(get("trace-file").hidden, false, "the run ledger is a file");
  get("trace-file").click();
  await settle();
  assert.deepEqual(calls.at(-1), ["reveal", "C:/data/executor-log.jsonl"]);
  sheetApi.close();
  assert.equal(get("trace-overlay").hidden, true);
});

// The host side (main.cjs): the channels it lists and what a read returns.
const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const hostSource = main.slice(main.indexOf("const TRACE_CHANNELS = Object.freeze(["), main.indexOf("function logLine("));
function host(logWriteHealth) {
  const env = {
    logWriteHealth, trace, traceStudio: trace.ring(10), traceRenderer: trace.ring(10), assistantState: { log: [{ at: 1, kind: "error", role: "keeper", text: "prune failed" }] },
    projectDataPath: (file) => file, EXECUTOR_LOG_PATH: "C:/data/executor-log.jsonl",
    brainLedgerTail: async () => [{ at: 2, event: "finish", title: "A", via: "m", ok: false, seconds: 3 }],
    stat: async () => ({ size: 900 }),
    getEyes: async () => ({ tailLog: async () => "INFO  2026-09-26T10:00:00 service=bus ok\nERROR 2026-09-26T10:00:01 service=bus broke", DEFAULT_LOG: "C:/oc/opencode.log" }),
  };
  vm.runInNewContext(`${hostSource}; this.traceChannels = traceChannels; this.traceRead = traceRead;`, env);
  return env;
}

test("the host lists every channel with its size and problems, and reads one", async () => {
  const env = host();
  env.traceStudio.push(trace.studioRow("[agents] worker failed", 1));
  const listed = plain(await env.traceChannels());
  assert.deepEqual(listed.channels.map((channel) => [channel.id, channel.lines, channel.errors]), [["studio", 1, 1], ["assistant", 1, 1], ["executor", 1, 1], ["opencode", 2, 1], ["renderer", 0, 0]]);
  assert.equal(listed.channels.find((channel) => channel.id === "executor").size, 900);
  const runs = plain(await env.traceRead({ channel: "executor", tail: 50 }));
  assert.equal(runs.file, "C:/data/executor-log.jsonl");
  assert.equal(runs.rows[0].level, "error");
  assert.equal((await env.traceRead({ channel: "opencode", problems: true })).rows.length, 1);
  assert.equal((await env.traceRead({ channel: "nope" })).ok, false);
});

test("Trace shows session write failures", async () => {
 const { trace: api, get, settle } = await sheet([{channel:"executor",count:2,lastFailureAt:123},{channel:"work-events",count:0,lastFailureAt:null}]); api.open(); await settle(); assert.match(get("trace-status").textContent,/History write failures this session: executor 2/); assert.equal(get("trace-status").dataset.tone,"bad"); assert.doesNotMatch(get("trace-status").textContent,/work-events/);
});
test("host returns detached failure metadata for successful and failed reads", async () => {
 const health = require("../scripts/log-write-health.cjs").createHealth({now:()=>123}); health.failure("executor"); const env=host(health); const result=plain(await env.traceRead({channel:"studio"})); assert.deepEqual(result.logWriteFailures,health.snapshot()); result.logWriteFailures[0].count=99; assert.equal(health.snapshot()[0].count,1); env.brainLedgerTail=async()=>{throw Error("unreadable fixture");}; const failed=plain(await env.traceRead({channel:"executor"})); assert.equal(failed.ok,false); assert.deepEqual(failed.logWriteFailures,health.snapshot());
});

// The studio log is kept on disk too (main.cjs "Log core"): Load older pages
// back through it above the live tail, pauses Follow, and a new filter starts
// from the tail again.
test("Load older pages the studio log from disk above the tail, pauses Follow, and resets with the filters", async () => {
  const calls = [];
  const tail = [{ at: 5000, level: "info", source: "autopilot", text: "newest" }];
  const pages = { first: [{ at: 3000, level: "warn", source: "release", text: "older b" }, { at: 4000, level: "info", source: "autopilot", text: "older c" }], second: [{ at: 1000, level: "error", source: "agents", text: "oldest a" }] };
  const api = {
    traceChannels: async () => ({ ok: true, channels: [{ id: "studio", label: "Studio log", area: "main", size: 10, detail: "Everything" }] }),
    traceRead: async (payload) => {
      calls.push(plain(payload));
      if (payload.before === 5000) return { ok: true, channel: "studio", page: true, rows: pages.first, next: "log.x.jsonl#3", done: false, older: true };
      if (payload.before === "log.x.jsonl#3") return { ok: true, channel: "studio", page: true, rows: pages.second, next: null, done: true, older: false };
      return { ok: true, channel: "studio", rows: tail, total: 1, matched: 1, counts: { error: 0, warn: 0, info: 1 }, sources: [["autopilot", 1]], size: 10, file: "C:/local/logs", older: true };
    },
  };
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("trace-")) });
  get("trace-overlay").hidden = true;
  get("trace-follow").checked = true;
  const window = { mefiStudio: api, MefiNav: { claim() {}, release() {}, close() {} }, addEventListener() {} };
  vm.runInContext(source, vm.createContext({ window, document, console, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout() {}, Date }));
  const settle = async () => { for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
  window.MefiTrace.open();
  await settle();
  assert.equal(get("trace-older").hidden, false, "the studio log has a folder on disk");
  get("trace-older").click();
  await settle();
  assert.equal(calls.at(-1).before, 5000, "the first page is what is older than the oldest line shown");
  assert.equal(get("trace-follow").checked, false, "Follow pauses so the pages stay put");
  assert.deepEqual(get("trace-lines").children.map((line) => line.children[3].textContent), ["newest", "older c", "older b"]);
  get("trace-older").click();
  await settle();
  assert.equal(calls.at(-1).before, "log.x.jsonl#3", "the next page continues from the cursor");
  assert.deepEqual(get("trace-lines").children.map((line) => line.children[3].textContent), ["newest", "older c", "older b", "oldest a"]);
  assert.equal(get("trace-older").hidden, true, "the start of the log");
  assert.match(get("trace-status").textContent, /and 3 older from the log on disk \(the start of the log\)/);
  assert.equal(window.MefiTrace.state().older, 3);
  get("trace-levels").children[1].click();
  await settle();
  assert.equal(window.MefiTrace.state().older, 0, "a new filter starts from the tail");
  assert.equal(calls.at(-1).before, undefined);
});
