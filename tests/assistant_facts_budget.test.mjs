// AI-pass facts are sent as JSON under a character budget. A plain slice cut
// mid-value (invalid JSON) and dropped the trailing keys first.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { boundedFactsJson } from "../scripts/assistant.mjs";

const facts = () => ({
  generatedAt: "2026-09-24T10:00:00.000Z",
  sessions: Array.from({ length: 40 }, (_, i) => ({ id: `ses_${i}`, title: `Session ${i} `.repeat(8), todos: Array.from({ length: 8 }, (_, t) => ({ content: `todo ${t} `.repeat(10), status: "pending" })) })),
  recentChanges: Array.from({ length: 60 }, (_, i) => ({ tool: "edit", file: `src/file_${i}.js`, additions: i, deletions: 1 })),
  notes: "n".repeat(9000),
  machine: { wait: false, exclusive: false, holders: [], runningTests: [], summary: ["no active test leases"] },
  work: [{ id: "w1", kind: "brief", text: "briefing" }],
  resumed: { at: 1, jobs: 2 },
  chatter: ["foreman: handed out 2"],
  inbox: ["overseer: look at the auditor"],
});

test("oversized facts stay valid JSON inside the budget and keep the small trailing keys", () => {
  const input = facts();
  const before = JSON.stringify(input);
  assert.ok(before.length > 40000);
  for (const limit of [14000, 6000, 2500]) {
    const text = boundedFactsJson(input, limit);
    assert.ok(text.length <= limit, `${text.length} <= ${limit}`);
    const parsed = JSON.parse(text);
    for (const key of ["generatedAt", "machine", "work", "resumed", "chatter", "inbox"]) assert.deepEqual(parsed[key], input[key], `${key} survives whole at ${limit}`);
    assert.ok(parsed.sessions.length >= 1 && parsed.sessions.length < 40, "the largest list loses its tail");
    assert.deepEqual(parsed.sessions[0].id, "ses_0", "rows are kept from the head");
    assert.ok(parsed.truncatedKeys.includes("sessions"));
    assert.ok(!parsed.truncatedKeys.includes("machine"));
  }
  assert.equal(JSON.stringify(input), before, "the caller's facts are not modified");
});

test("facts inside the budget are sent exactly as JSON.stringify renders them", () => {
  const small = { a: 1, list: [1, 2, 3], text: "hello" };
  assert.equal(boundedFactsJson(small, 14000), JSON.stringify(small));
  assert.equal(boundedFactsJson(undefined, 10), "null");
});

test("an AI pass reuses a fresh machine status instead of running its own resource pass", async () => {
  const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const from = source.indexOf("const MACHINE_FACTS_FRESH_MS"), to = source.indexOf("async function runAssistant(", from);
  assert.ok(from >= 0 && to > from);
  const now = Date.parse("2026-09-24T10:00:00.000Z");
  const status = (secondsAgo, extra = {}) => ({ updatedAt: new Date(now - secondsAgo * 1000).toISOString(), leases: { exclusive: false, holders: [] }, running: [], lines: [], ...extra });
  const env = vm.createContext({ Date, assistantCache: {}, machineReadCache: null });
  vm.runInContext(source.slice(from, to), env);
  assert.equal(env.freshMachineStatus(now), null, "nothing cached: the pass scans");
  env.assistantCache.machine = status(100, { from: "machine role" });
  assert.equal(env.freshMachineStatus(now).from, "machine role");
  env.machineReadCache = { at: now - 5000, status: status(5, { from: "ui read" }) };
  assert.equal(env.freshMachineStatus(now).from, "ui read", "the newest status wins");
  env.machineReadCache = null;
  env.assistantCache.machine = status(200);
  assert.equal(env.freshMachineStatus(now), null, "an old status is not reused");
  env.assistantCache.machine = { updatedAt: new Date(now).toISOString(), leases: {} };
  assert.equal(env.freshMachineStatus(now), null, "a status without the fields the facts read is not reused");
  const brief = source.slice(source.indexOf("async function runAssistant("), source.indexOf("// ---- the assistant service"));
  assert.match(brief, /freshMachineStatus\(\) \?\? \(await resourcePass\(/);
  assert.match(brief, /boundedFactsJson\(facts, 14000\)/);
});

test("long strings are clipped, not dropped, and many small keys still fit", () => {
  const text = boundedFactsJson({ summary: "s".repeat(20000), keep: "short" }, 1000);
  const parsed = JSON.parse(text);
  assert.ok(text.length <= 1000);
  assert.equal(parsed.keep, "short");
  assert.ok(parsed.summary.startsWith("sss") && parsed.summary.endsWith("…"));
  const wide = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`key_${i}`, i]));
  const bounded = boundedFactsJson(wide, 800);
  assert.ok(bounded.length <= 800);
  assert.equal(typeof JSON.parse(bounded), "object");
});
