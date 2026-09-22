// A circuit breaker for outbound provider calls, keyed by provider name.
//
// Adapted from BetterC0de (MIT), apps/backend/src/provider/circuitBreaker.ts.
// See THIRD_PARTY_NOTICES.md. The state machine is theirs; this is a factory
// with an injected clock and no module-level singleton, so it can be tested
// without timers and so two callers cannot share state by accident — the same
// shape as scripts/brains.cjs and scripts/context-manager.cjs.
//
// Why Studio wants one: `httpAssistantCall` walks AI_AUTO_PROVIDERS on every
// call and has no memory of what just failed, so a dead route is re-dialled
// (and re-waited-on, up to the 120 s abort in `chatCompletion`) for every
// assistant turn, every role job and every briefing. A breaker turns the
// second and later attempts into an immediate skip until a cool-down expires.
//
//   const gate = breaker.enter("zai");
//   if (!gate.allowed) continue;            // try the next provider now
//   try { const reply = await call(); gate.settle(true); }
//   catch (error) { gate.settle(false); throw error; }
//
// Three details from upstream that are easy to drop and worth keeping:
//
//  - A generation counter. A call admitted while the circuit was still closed
//    can land after a later failure has opened it; without the counter its
//    success would close the circuit behind that failure and undo the trip.
//  - Half-open tolerance. One failed probe might be a transient blip, so the
//    circuit re-opens only after two consecutive probe failures.
//  - One probe at a time. In half-open, concurrent callers would all be
//    admitted as probes and hammer a service that is still down.
//
// What this does NOT do: decide what counts as a failure. That is the caller's
// judgement, and it matters here — z.ai answers a refused key with HTTP 200
// carrying `{"code":401}` in the body, so a status-code check alone reports it
// as a success and the breaker never trips. Classify the body, then call
// `settle(false)`.

const CLOSED = "closed";
const OPEN = "open";
const HALF_OPEN = "half-open";

const DEFAULTS = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenTolerance: 2,
};

function createBreaker(options = {}) {
  const failureThreshold = Math.max(1, options.failureThreshold ?? DEFAULTS.failureThreshold);
  const resetTimeoutMs = Math.max(0, options.resetTimeoutMs ?? DEFAULTS.resetTimeoutMs);
  const halfOpenTolerance = Math.max(1, options.halfOpenTolerance ?? DEFAULTS.halfOpenTolerance);
  const now = typeof options.now === "function" ? options.now : Date.now;

  const entries = new Map();

  function entryFor(key) {
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        state: CLOSED,
        failures: 0,
        openedAt: 0,
        halfOpenFailures: 0,
        generation: 0,
        probeInFlight: false,
      };
      entries.set(key, entry);
    }
    return entry;
  }

  // The cool-down is read on every observation rather than scheduled, so the
  // module holds no timer and a caller that goes quiet for an hour still sees
  // the circuit reopen on its next call.
  function advance(entry) {
    if (entry.state === OPEN && now() - entry.openedAt >= resetTimeoutMs) {
      entry.state = HALF_OPEN;
      entry.probeInFlight = false;
    }
    return entry;
  }

  function trip(entry) {
    entry.state = OPEN;
    entry.openedAt = now();
    entry.halfOpenFailures = 0;
    entry.generation += 1;
  }

  function state(key) {
    return advance(entryFor(key)).state;
  }

  function remainingMs(key) {
    const entry = advance(entryFor(key));
    if (entry.state !== OPEN) return 0;
    const remaining = resetTimeoutMs - (now() - entry.openedAt);
    return remaining > 0 ? remaining : 0;
  }

  // Ask permission for one call. The returned gate carries the generation it
  // was admitted under, so a late settle cannot disturb a newer trip.
  function enter(key) {
    const entry = advance(entryFor(key));

    if (entry.state === OPEN) {
      return { allowed: false, reason: OPEN, retryInMs: remainingMs(key), settle() {} };
    }
    if (entry.state === HALF_OPEN && entry.probeInFlight) {
      return { allowed: false, reason: "probe-in-flight", retryInMs: 0, settle() {} };
    }

    const isProbe = entry.state === HALF_OPEN;
    if (isProbe) entry.probeInFlight = true;
    const generation = entry.generation;
    let settled = false;

    return {
      allowed: true,
      reason: isProbe ? HALF_OPEN : CLOSED,
      retryInMs: 0,
      settle(succeeded) {
        if (settled) return;
        settled = true;
        if (isProbe) entry.probeInFlight = false;
        // Admitted under a generation that has since been superseded: the
        // outcome describes a circuit that no longer exists.
        if (generation !== entry.generation) return;

        if (succeeded) {
          entry.state = CLOSED;
          entry.failures = 0;
          entry.halfOpenFailures = 0;
          return;
        }

        entry.failures += 1;
        if (entry.state === HALF_OPEN) {
          entry.halfOpenFailures += 1;
          if (entry.halfOpenFailures >= halfOpenTolerance) trip(entry);
          return;
        }
        if (entry.failures >= failureThreshold) trip(entry);
      },
    };
  }

  // Convenience wrapper. Rejects with a BreakerOpenError rather than calling
  // `fn` when the circuit is open; any other rejection is re-thrown untouched
  // so the caller's own error handling is unaffected.
  async function run(key, fn) {
    const gate = enter(key);
    if (!gate.allowed) throw new BreakerOpenError(key, gate.retryInMs, gate.reason);
    try {
      const result = await fn();
      gate.settle(true);
      return result;
    } catch (error) {
      gate.settle(false);
      throw error;
    }
  }

  function reset(key) {
    if (key === undefined) entries.clear();
    else entries.delete(key);
  }

  // For the status strip and the connection log: what the breaker believes
  // about every provider it has seen, without admitting a call.
  function snapshot() {
    const out = {};
    for (const key of entries.keys()) {
      out[key] = { state: state(key), retryInMs: remainingMs(key), failures: entryFor(key).failures };
    }
    return out;
  }

  return { enter, run, state, remainingMs, reset, snapshot };
}

class BreakerOpenError extends Error {
  constructor(key, retryInMs, reason) {
    super(`Provider ${key} is temporarily skipped after repeated failures; retrying in ${Math.ceil(retryInMs / 1000)}s.`);
    this.name = "BreakerOpenError";
    this.code = "ERR_BREAKER_OPEN";
    this.provider = key;
    this.retryInMs = retryInMs;
    this.reason = reason;
  }
}

module.exports = { createBreaker, BreakerOpenError, CLOSED, OPEN, HALF_OPEN };
