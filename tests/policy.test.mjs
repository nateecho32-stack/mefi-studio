// The Policy Lab's policy contract (build brief PR1): the baseline is a
// faithful port of main.cjs's frozen ranking, the config surface is bounded
// and allowlisted, operator controls are inputs a policy cannot move, and the
// same observation always yields the same decision.
//
// Run: node --test tests/   (or npm test)

import test from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE_POLICY,
  BAND,
  POLICY_CONFIG_SPEC,
  baselineCompareWork,
  baselineTaskPriority,
  baselineWorkPriority,
  buildObservation,
  decide,
  defineConfigPolicy,
  intentKeyOf,
  policyIdentity,
  validatePolicyConfig,
  workActionId,
} from "../scripts/policy.mjs";

const HOUR = 3600 * 1000;
const task = (id, title, extra = {}) => ({ id, title, source: "a-eyes", createdAt: 1000, updatedAt: 1000, ...extra });

// ---- baseline parity: the port must match main.cjs's frozen rules ----------

test("baselineTaskPriority reproduces main.cjs's worth bands", () => {
  assert.equal(baselineTaskPriority({ title: "Overseer: tune the fold hours" }), 0);
  assert.equal(baselineTaskPriority(task("t1", "Add minimap", { source: "chat" })), 4);
  assert.equal(baselineTaskPriority(task("task_plan_1", "Plan: catalog — 3 ideas")), 3);
  assert.equal(baselineTaskPriority(task("t2", "Anything briefed")), 2);
  assert.equal(baselineTaskPriority(task("t3", "Anything", { source: "manual" })), 1);
  assert.equal(baselineWorkPriority(task("t4", "Plain", { pin: true })), 5);
});

test("baselineCompareWork: worth first, oldest inside a band, pins by recency", () => {
  const old = task("t1", "Old auto work", { createdAt: 1 });
  const older = task("t2", "Older auto work", { createdAt: 0 });
  const chat = task("t3", "A chat ask", { source: "chat", createdAt: 999 });
  const upkeep = task("t4", "Assistant: rotate logs", { createdAt: 0 });
  const ordered = [old, chat, upkeep, older].sort((a, b) => baselineCompareWork(a, b));
  assert.deepEqual(ordered.map((item) => item.id), ["t3", "t2", "t1", "t4"]);
  // pins outrank every band; the newest click wins among pins
  const pinOld = task("t5", "Pinned first", { pin: true, pinAt: 100 });
  const pinNew = task("t6", "Pinned second", { pin: true, pinAt: 200 });
  assert.equal(baselineCompareWork(pinNew, pinOld) < 0, true);
  assert.equal(baselineCompareWork(pinOld, chat) < 0, true);
  // requests use `at`, tasks createdAt/updatedAt — the same fallback chain
  assert.equal(baselineCompareWork({ title: "r", at: 5 }, { title: "r2", at: 9 }) < 0, true);
});

test("the baseline policy's decide() matches baselineCompareWork's ordering", () => {
  const now = 1000000;
  const items = [
    task("t1", "Assistant: stamp digest", { createdAt: now - 4 * HOUR }),
    task("t2", "Chat ask", { source: "chat", createdAt: now - 1 * HOUR }),
    task("t3", "Auto work", { createdAt: now - 3 * HOUR }),
    task("t4", "Older auto work", { createdAt: now - 8 * HOUR }),
  ];
  const actions = items.map((item, index) => ({
    id: item.id,
    intentKey: intentKeyOf(item.title),
    kind: "task",
    title: item.title,
    band: baselineWorkPriority(item),
    operatorLocked: false,
    age: now - item.createdAt,
    order: index,
  }));
  const observation = buildObservation({ at: now, actions, limits: { maxConcurrency: 4 } });
  const decision = decide(BASELINE_POLICY, observation);
  const expected = [...items].sort((a, b) => baselineCompareWork(a, b)).map((item) => item.id);
  assert.deepEqual(decision.order, expected);
  assert.equal(decision.batch[0], expected[0]);
  assert.equal(decision.reason.includes("band-rank"), true);
});

// ---- determinism ------------------------------------------------------------

test("same input (and seed) produce the same baseline decision", () => {
  const actions = [
    { id: "a", intentKey: "one", kind: "task", title: "One", band: 2, age: 500, order: 0 },
    { id: "b", intentKey: "two", kind: "task", title: "Two", band: 2, age: 100, order: 1 },
    { id: "c", intentKey: "three", kind: "request", title: "Three", band: 4, age: 900, order: 2 },
  ];
  const observation = buildObservation({ at: 42, actions, limits: { maxConcurrency: 2 } });
  const first = decide(BASELINE_POLICY, observation);
  const second = decide(BASELINE_POLICY, buildObservation({ at: 42, actions, limits: { maxConcurrency: 2 } }));
  assert.deepEqual(first, second);
  // band first, then the OLDEST work inside the band (largest age first)
  assert.deepEqual(first.order, ["c", "a", "b"]);
});

test("repeated observations cannot increase executable obligation count", () => {
  const actions = [
    { id: "a", intentKey: "one", kind: "task", title: "One", band: 1, age: 0, order: 0 },
    { id: "b", intentKey: "two", kind: "task", title: "Two", band: 1, age: 1, order: 1 },
  ];
  const once = buildObservation({ at: 1, actions, revealed: { one: { attempts: 1, failures: 1 } } });
  const twice = buildObservation({ at: 1, actions, revealed: { one: { attempts: 1, failures: 1 } } });
  assert.deepEqual(once, twice);
  assert.equal(once.actions.length, 2);
  // deciding repeatedly over the same observation is a fixed point too
  assert.deepEqual(decide(BASELINE_POLICY, once), decide(BASELINE_POLICY, twice));
});

// ---- operator controls --------------------------------------------------------

test("a paused executor always gets an empty batch, whatever the policy wants", () => {
  const observation = buildObservation({ at: 1, actions: [{ id: "a", intentKey: "one", kind: "task", title: "One", band: 5, age: 0, order: 0 }], limits: { paused: true } });
  const decision = decide(defineConfigPolicy("retry-2", { maxAttemptsPerIntent: 2 }), observation);
  assert.deepEqual(decision.batch, []);
  assert.equal(decision.concurrency, 0);
  assert.equal(decision.reason, "operator-pause");
});

test("locked (pinned) actions always sort first — no tunable can bury them", () => {
  const actions = [
    { id: "free", intentKey: "one", kind: "task", title: "Ordinary", band: 4, operatorLocked: false, age: 0, order: 0 },
    { id: "pin-old", intentKey: "two", kind: "task", title: "Pinned earlier", band: 1, operatorLocked: true, pinAt: 100, age: 0, order: 1 },
    { id: "pin-new", intentKey: "three", kind: "task", title: "Pinned later", band: 1, operatorLocked: true, pinAt: 900, age: 0, order: 2 },
  ];
  const decision = decide(defineConfigPolicy("slip", { failureSlipBands: 2, withinBandOrder: "stable" }), buildObservation({ at: 1, actions }));
  assert.deepEqual(decision.order, ["pin-new", "pin-old", "free"]);
  assert.equal(decision.batch[0], "pin-new");
});

test("requested concurrency is clamped to the maximum the runtime supplied", () => {
  const wide = defineConfigPolicy("wide", { concurrency: POLICY_CONFIG_SPEC.concurrency.max });
  const actions = [{ id: "a", intentKey: "one", kind: "task", title: "One", band: 2, age: 0, order: 0 }];
  assert.equal(decide(wide, buildObservation({ at: 1, actions, limits: { maxConcurrency: 2 } })).concurrency, 2);
  const beyond = decide(wide, buildObservation({ at: 1, actions, limits: { maxConcurrency: 12 } }));
  assert.ok(beyond.concurrency <= POLICY_CONFIG_SPEC.concurrency.max, "policy width never exceeds its own clamp");
});

// ---- bounded, allowlisted config ----------------------------------------------

test("config validation clamps to spec and rejects unknown tunables", () => {
  const bad = validatePolicyConfig({ withinBandOrder: "vibes", failureSlipBands: 99, maxAttemptsPerIntent: -1, sneakyRule: true });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((line) => line.includes("unknown tunable")));
  assert.ok(bad.errors.some((line) => line.includes("withinBandOrder")));
  assert.equal(bad.config.failureSlipBands, POLICY_CONFIG_SPEC.failureSlipBands.default, "out-of-clamp falls back to the default");
  const good = validatePolicyConfig({ withinBandOrder: "failures-then-age", failureSlipBands: 1, maxAttemptsPerIntent: 2, concurrency: 2 });
  assert.deepEqual(good, { ok: true, config: { withinBandOrder: "failures-then-age", failureSlipBands: 1, maxAttemptsPerIntent: 2, concurrency: 2 }, errors: [] });
});

test("policy identities are content-hashed and stable", () => {
  const one = policyIdentity(BASELINE_POLICY);
  assert.equal(one.hash, policyIdentity({ id: "baseline", version: 1, kind: "baseline", config: {} }).hash);
  const candidate = defineConfigPolicy("retry-2", { maxAttemptsPerIntent: 2 });
  assert.equal(candidate.hash, policyIdentity(candidate).hash);
  assert.notEqual(candidate.hash, one.hash);
  assert.throws(() => policyIdentity({ kind: "config", config: { nonsense: 1 } }), /invalid policy config/);
});

// ---- the retry cap: the mechanism the milestone candidate uses -----------------

test("a retry cap demotes exhausted intents and stops instead of retrying", () => {
  const actions = [
    { id: "beaten", intentKey: "tar", kind: "task", title: "Beaten path", band: 2, age: 50, order: 0 },
    { id: "fresh", intentKey: "new", kind: "task", title: "Fresh work", band: 2, age: 20, order: 1 },
  ];
  const revealed = { tar: { attempts: 2, failures: 2, spentMs: 1000 } };
  const observation = buildObservation({ at: 1, actions, revealed });
  const capped = decide(defineConfigPolicy("retry-2", { maxAttemptsPerIntent: 2 }), observation);
  // the older work would normally win (baseline below), but it is capped —
  // so the uncapped action goes first; the capped one stays visible, never
  // silently dropped
  assert.deepEqual(capped.order, ["fresh", "beaten"]);
  assert.equal(capped.batch[0], "fresh");
  // when ONLY capped work remains, the honest answer is an empty batch
  const alone = decide(defineConfigPolicy("retry-2", { maxAttemptsPerIntent: 2 }), buildObservation({ at: 1, actions: [actions[0]], revealed }));
  assert.deepEqual(alone.batch, []);
  assert.equal(alone.reason, "retry-budget-exhausted");
  // the baseline has no cap: the same exhausted intent stays first in line
  assert.equal(decide(BASELINE_POLICY, observation).batch[0], "beaten");
});

// ---- stable action ids ---------------------------------------------------------

test("request action ids are deterministic fingerprints; task ids pass through", () => {
  const request = { at: 123, prompt: "fix the thing", title: "Fix the thing" };
  assert.equal(workActionId("request", request), workActionId("request", { ...request }));
  assert.notEqual(workActionId("request", request), workActionId("request", { ...request, at: 456 }));
  assert.equal(workActionId("task", { id: "task_9" }), "task_9");
});
