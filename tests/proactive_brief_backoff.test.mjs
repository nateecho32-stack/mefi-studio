import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const mainSource = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const start = mainSource.indexOf("let autopilotTickBriefAt = null;");
const end = mainSource.indexOf("// briefing.expand[] items become real queue entries", start);
assert.ok(start >= 0 && end > start, "main.cjs still has the tick brief");

function host({ replies }) {
  let now = 1_000_000;
  const calls = [];
  class FakeDate extends Date { static now() { return now; } }
  const env = {
    Date: FakeDate,
    Math,
    assistantState: { ai: { backoffUntil: 0 } },
    assistantModule: { nextBackoffMs: (failures) => Math.min(60, 5 * 2 ** (failures - 1)) * 60000 },
    runAssistant: async () => { calls.push(now); return replies.shift() ?? { ok: true, briefing: { alerts: [] } }; },
    getEyes: async () => ({ requestsFromBriefing: () => [] }),
    requestBaseline: async () => [],
    queueRequests: async () => 0,
    logLine: () => {},
  };
  vm.createContext(env);
  vm.runInContext(`${mainSource.slice(start, end)}\nglobalThis.pass = autopilotProactivePass;`, env);
  return { env, calls, advance: (minutes) => { now += minutes * 60000; }, at: () => now };
}

test("a failing keyless brief backs off 5, then 10 minutes, and a good brief resets it", async () => {
  const h = host({ replies: [{ ok: false, error: "route down" }, { ok: false, error: "route down" }, { ok: true, briefing: { alerts: [] } }] });
  assert.equal((await h.env.pass()).aiError, "route down");
  h.advance(4.6);
  assert.equal((await h.env.pass()).skipped, "ai backoff", "the cadence alone no longer re-asks a failing route");
  h.advance(0.5);
  await h.env.pass();
  assert.equal(h.calls.length, 2, "asked again once 5 minutes passed");
  h.advance(5.1);
  assert.equal((await h.env.pass()).skipped, "ai backoff", "the second failure waits 10 minutes");
  h.advance(5);
  assert.equal((await h.env.pass()).aiError, null);
  h.advance(4.6);
  await h.env.pass();
  assert.equal(h.calls.length, 4, "after a good brief the plain cadence applies again");
});

test("the shared AI backoff also holds the keyless brief", async () => {
  const h = host({ replies: [] });
  h.env.assistantState.ai.backoffUntil = h.at() + 10 * 60000;
  assert.equal((await h.env.pass()).skipped, "ai backoff");
  assert.equal(h.calls.length, 0);
  h.advance(10.1);
  await h.env.pass();
  assert.equal(h.calls.length, 1);
});
