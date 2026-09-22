import assert from "node:assert/strict";
import test from "node:test";
import providerBreaker from "../scripts/provider-breaker.cjs";

const { createBreaker, BreakerOpenError } = providerBreaker;

// A hand-turned clock: the breaker takes `now`, so nothing here waits.
function clock(start = 1_000) {
  let value = start;
  return { now: () => value, advance: (ms) => { value += ms; } };
}

const build = (overrides = {}) => {
  const time = clock();
  const breaker = createBreaker({
    now: time.now,
    failureThreshold: 3,
    resetTimeoutMs: 30_000,
    halfOpenTolerance: 2,
    ...overrides,
  });
  return { breaker, time };
};

const fail = (breaker, key, times) => {
  for (let i = 0; i < times; i += 1) {
    const gate = breaker.enter(key);
    assert.ok(gate.allowed, `attempt ${i + 1} should be admitted`);
    gate.settle(false);
  }
};

test("a closed circuit admits every call", () => {
  const { breaker } = build();
  for (let i = 0; i < 10; i += 1) {
    const gate = breaker.enter("zai");
    assert.equal(gate.allowed, true);
    gate.settle(true);
  }
  assert.equal(breaker.state("zai"), "closed");
});

test("consecutive failures open the circuit and later calls are skipped", () => {
  const { breaker } = build();
  fail(breaker, "zai", 3);
  assert.equal(breaker.state("zai"), "open");

  const gate = breaker.enter("zai");
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "open");
  assert.ok(gate.retryInMs > 0);
});

test("a success resets the failure count before the threshold", () => {
  const { breaker } = build();
  fail(breaker, "zai", 2);
  breaker.enter("zai").settle(true);
  fail(breaker, "zai", 2);
  assert.equal(breaker.state("zai"), "closed");
});

test("breakers are independent per provider", () => {
  const { breaker } = build();
  fail(breaker, "zai", 3);
  assert.equal(breaker.state("zai"), "open");
  assert.equal(breaker.state("opencode"), "closed");
  assert.equal(breaker.enter("opencode").allowed, true);
});

test("the cool-down moves the circuit to half-open and admits one probe", () => {
  const { breaker, time } = build();
  fail(breaker, "zai", 3);

  time.advance(29_999);
  assert.equal(breaker.state("zai"), "open");
  assert.equal(breaker.enter("zai").allowed, false);

  time.advance(1);
  assert.equal(breaker.state("zai"), "half-open");

  const probe = breaker.enter("zai");
  assert.equal(probe.allowed, true);
  assert.equal(probe.reason, "half-open");

  // Only one probe at a time: a second caller is turned away while it runs.
  const second = breaker.enter("zai");
  assert.equal(second.allowed, false);
  assert.equal(second.reason, "probe-in-flight");

  probe.settle(true);
  assert.equal(breaker.state("zai"), "closed");
  assert.equal(breaker.enter("zai").allowed, true);
});

test("one failed probe is tolerated; the second re-opens the circuit", () => {
  const { breaker, time } = build();
  fail(breaker, "zai", 3);
  time.advance(30_000);

  const first = breaker.enter("zai");
  assert.equal(first.allowed, true);
  first.settle(false);
  assert.equal(breaker.state("zai"), "half-open", "a single blip must not re-open");

  const second = breaker.enter("zai");
  assert.equal(second.allowed, true);
  second.settle(false);
  assert.equal(breaker.state("zai"), "open");
  assert.ok(breaker.remainingMs("zai") > 0, "re-opening restarts the cool-down");
});

test("a successful probe after a tolerated failure closes the circuit", () => {
  const { breaker, time } = build();
  fail(breaker, "zai", 3);
  time.advance(30_000);
  breaker.enter("zai").settle(false);
  breaker.enter("zai").settle(true);
  assert.equal(breaker.state("zai"), "closed");

  // The tolerance budget is spent per recovery, not carried forward.
  time.advance(1);
  fail(breaker, "zai", 3);
  time.advance(30_000);
  breaker.enter("zai").settle(false);
  assert.equal(breaker.state("zai"), "half-open");
});

test("a call admitted before the trip cannot close the circuit behind it", () => {
  const { breaker } = build();
  // Admitted while still closed, settles last — the generation guard makes its
  // success describe a circuit that no longer exists.
  const straggler = breaker.enter("zai");
  assert.equal(straggler.allowed, true);

  fail(breaker, "zai", 3);
  assert.equal(breaker.state("zai"), "open");

  straggler.settle(true);
  assert.equal(breaker.state("zai"), "open", "a late success must not undo the trip");
});

test("settle is idempotent", () => {
  const { breaker } = build();
  const gate = breaker.enter("zai");
  gate.settle(false);
  gate.settle(false);
  gate.settle(false);
  assert.equal(breaker.state("zai"), "closed", "one call may only count once");
});

test("remainingMs counts down and reaches zero at the cool-down", () => {
  const { breaker, time } = build();
  assert.equal(breaker.remainingMs("zai"), 0);
  fail(breaker, "zai", 3);
  assert.equal(breaker.remainingMs("zai"), 30_000);
  time.advance(10_000);
  assert.equal(breaker.remainingMs("zai"), 20_000);
  time.advance(25_000);
  assert.equal(breaker.remainingMs("zai"), 0);
});

test("run resolves, records, and rejects with BreakerOpenError once open", async () => {
  const { breaker } = build();
  assert.equal(await breaker.run("zai", async () => "reply"), "reply");

  const boom = new Error("upstream refused");
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(() => breaker.run("zai", async () => { throw boom; }), /upstream refused/);
  }
  assert.equal(breaker.state("zai"), "open");

  let reached = false;
  await assert.rejects(
    () => breaker.run("zai", async () => { reached = true; }),
    (error) => error instanceof BreakerOpenError && error.code === "ERR_BREAKER_OPEN" && error.provider === "zai",
  );
  assert.equal(reached, false, "an open circuit must not call the provider");
});

test("run releases the half-open probe when its call throws", async () => {
  const { breaker, time } = build();
  fail(breaker, "zai", 3);
  time.advance(30_000);

  await assert.rejects(() => breaker.run("zai", async () => { throw new Error("still down"); }), /still down/);
  // The probe slot must be free again, or recovery would deadlock until the
  // next trip reset it.
  assert.equal(breaker.enter("zai").allowed, true);
});

test("reset clears one provider or all of them", () => {
  const { breaker } = build();
  fail(breaker, "zai", 3);
  fail(breaker, "grok", 3);

  breaker.reset("zai");
  assert.equal(breaker.state("zai"), "closed");
  assert.equal(breaker.state("grok"), "open");

  breaker.reset();
  assert.equal(breaker.state("grok"), "closed");
});

test("snapshot reports every seen provider without admitting a call", () => {
  const { breaker } = build();
  fail(breaker, "zai", 3);
  breaker.enter("opencode").settle(true);

  const view = breaker.snapshot();
  assert.deepEqual(Object.keys(view).sort(), ["opencode", "zai"]);
  assert.equal(view.zai.state, "open");
  assert.equal(view.zai.retryInMs, 30_000);
  assert.equal(view.opencode.state, "closed");

  // Reading the snapshot must not consume the single half-open probe.
  const { breaker: other, time } = build();
  fail(other, "zai", 3);
  time.advance(30_000);
  other.snapshot();
  assert.equal(other.enter("zai").allowed, true);
});

test("defaults are five failures and a thirty second cool-down", () => {
  const time = clock();
  const breaker = createBreaker({ now: time.now });
  fail(breaker, "zai", 4);
  assert.equal(breaker.state("zai"), "closed");
  fail(breaker, "zai", 1);
  assert.equal(breaker.state("zai"), "open");
  assert.equal(breaker.remainingMs("zai"), 30_000);
});
