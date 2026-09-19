// Bounded advisory work queue. Board admission and execution never wait on Jev.
import { intentKeyOf } from "./policy.mjs";
import { retrieveCandidate, relationshipQuestion } from "./work-classification.mjs";

export function planIntake(additions, { requests = [], tasks = [], limit = 3 } = {}) {
  const keyOf = (item) => intentKeyOf(item?.title ?? "");
  const closed = new Set(["done", "archived", "cancelled", "resolved"]);
  const admitted = new Set(requests.map(keyOf));
  const admittedTasks = new Set(tasks.filter((item) => item && !closed.has(item.status)).map((item) => item.id).filter(Boolean));
  const fresh = additions.filter((item) => keyOf(item) && (item.kind === "task" ? item.id && admittedTasks.has(item.id) : admitted.has(keyOf(item))));
  // An observation cannot be its own comparison. Exclude the whole incoming
  // batch from requests, while still allowing an existing task with its title.
  const incoming = new Set(additions.filter((item) => item.kind !== "task").map(keyOf));
  const incomingTasks = new Set(additions.filter((item) => item.kind === "task").map((item) => item.id));
  const candidates = [
    ...requests.filter((item) => item && !incoming.has(keyOf(item)) && !closed.has(item.status)).map((item) => ({ ...item, kind: "request" })),
    ...tasks.filter((item) => item && !incomingTasks.has(item.id) && !closed.has(item.status)).map((item) => ({ ...item, kind: "task" })),
  ];
  const comparisons = [];
  for (const addition of fresh) {
    const hit = retrieveCandidate({ title: addition.title, existing: candidates });
    if (hit) comparisons.push({ addition, hit });
    if (comparisons.length >= limit) break;
  }
  const questions = comparisons.map(({ addition, hit }, index) => ({
    ...relationshipQuestion({ observation: { text: addition.prompt || addition.title, source: addition.source }, candidate: hit.item }).question,
    id: `rel_${index}`,
  }));
  const state = comparisons.map(({ addition, hit }) =>
    `observation: ${String(addition.title).slice(0, 200)}; existing ${hit.item.kind}: ${String(hit.item.title).slice(0, 200)}`
  ).join("\n");
  return { comparisons, questions, state };
}

export function createJevQueue({ runBatch, minIntervalMs = 120000, backoffMs = 3600000, maxBatch = 3, maxPending = 48,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof runBatch !== "function") throw new TypeError("runBatch is required");
  const pending = new Map();
  let timer = null, inFlight = null, nextAt = 0, failures = 0, stopped = false, wakeVersion = 0;
  let last = { phase: "idle", lastRunAt: null, lastSuccessAt: null, lastError: null, calls: 0, proposals: 0, skipped: 0 };
  const status = () => ({ ...last, pending: pending.size, busy: Boolean(inFlight), nextAt: pending.size ? nextAt : null });
  function schedule() {
    if (stopped || timer !== null || inFlight || !pending.size) return;
    timer = setTimer(() => { timer = null; void flush(); }, Math.max(0, nextAt - now()));
    timer?.unref?.();
  }
  function enqueue(items) {
    if (stopped) return status();
    for (const item of items ?? []) {
      if (!item?.title) continue;
      const key = item.kind === "task" && item.id ? `task:${item.id}` : `${item.source ?? ""}:${intentKeyOf(item.title)}`;
      if (pending.has(key)) continue;
      if (pending.size >= maxPending) { last.skipped += 1; continue; }
      pending.set(key, { item, attempts: 0 });
    }
    schedule();
    return status();
  }
  function flush() {
    if (inFlight) return inFlight;
    if (stopped || !pending.size || now() < nextAt) { schedule(); return Promise.resolve(status()); }
    if (timer !== null) { clearTimer(timer); timer = null; }
    const batch = [...pending.entries()].slice(0, maxBatch);
    const version = wakeVersion;
    last.phase = "running";
    last.lastRunAt = now();
    inFlight = Promise.resolve().then(() => runBatch(batch.map(([, entry]) => entry.item))).then((result = {}) => {
      const attempted = result.attempted === true;
      if (attempted) last.calls += 1;
      if (result.defer) {
        last.phase = result.reason || "waiting";
        nextAt = now() + minIntervalMs;
        return;
      }
      nextAt = attempted ? now() + minIntervalMs : now();
      if (result.ok === false) {
        failures += 1;
        last.lastError = String(result.error || "classification failed").slice(0, 200);
        last.phase = "retrying";
        for (const [key, entry] of batch) {
          entry.attempts += 1;
          if (entry.attempts >= 3) { pending.delete(key); last.skipped += 1; }
        }
        if (failures >= 2) { nextAt = now() + backoffMs; last.phase = "backoff"; failures = 0; }
      } else {
        failures = 0;
        for (const [key] of batch) pending.delete(key);
        last.phase = attempted ? "ready" : "idle";
        last.lastError = null;
        if (attempted) last.lastSuccessAt = now();
        last.proposals += result.proposals ?? 0;
      }
    }, (error) => {
      // Unexpected local failures get the same bounded retry policy, never a
      // tight timer loop. Work itself remains on the board throughout.
      last.lastError = String(error?.message ?? error).slice(0, 200);
      last.phase = "backoff";
      nextAt = now() + backoffMs;
      for (const [key, entry] of batch) {
        entry.attempts += 1;
        if (entry.attempts >= 3) { pending.delete(key); last.skipped += 1; }
      }
    }).finally(() => {
      inFlight = null;
      if (version !== wakeVersion) { nextAt = 0; failures = 0; }
      schedule();
    });
    return inFlight;
  }
  // Explicit configuration changes can retry a previously unavailable route.
  function wake() { wakeVersion += 1; nextAt = 0; failures = 0; if (timer !== null) clearTimer(timer); timer = null; schedule(); }
  function stop() { stopped = true; if (timer !== null) clearTimer(timer); timer = null; }
  return { enqueue, flush, wake, stop, status };
}
