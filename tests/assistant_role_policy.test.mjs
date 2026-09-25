// One table decides who runs when and who spends AI (AGENT_ROLES in
// scripts/assistant.mjs), and the overseer's paid review is gated on change.
// Pure module functions only: no host, timers, network or paid calls.
import test from "node:test";
import assert from "node:assert/strict";
import * as assistant from "../scripts/assistant.mjs";

const NOW = 1_700_000_000_000;
const MINUTE = 60000;

test("every seat has one policy row, and the host's lists derive from it", () => {
  for (const row of assistant.AGENT_ROLES) {
    assert.ok(["always", "when-usable", "never"].includes(row.spendsAi), `${row.role} says how it spends AI`);
    assert.ok(Array.isArray(row.gates) && row.gates.every((gate) => ["proactive", "growth", "backlog"].includes(gate)), `${row.role} names only known gates`);
    assert.equal(assistant.rolePolicy(row.role), row);
  }
  assert.equal(assistant.rolePolicy("ghost"), null);
  assert.deepEqual(assistant.CADENCE_ROLES, ["watcher", "machine", "auditor", "keeper", "compactor", "foreman", "thinker", "briefer", "overseer", "improver", "ideas", "grower"]);
  assert.deepEqual(assistant.AI_ROLES, ["briefer", "improver", "grower"], "the roles that are a model call");
  // The overseer and the ideas scan call only when the AI is usable, so the
  // pool counts them against the AI width only then; they used to be counted
  // one way by the table and another by the host.
  for (const role of ["overseer", "ideas", "responder"]) {
    assert.equal(assistant.roleSpendsAi(role, true), true, role);
    assert.equal(assistant.roleSpendsAi(role, false), false, role);
  }
  for (const role of ["briefer", "improver", "grower", "cluster-planner"]) assert.equal(assistant.roleSpendsAi(role, false), true, role);
  for (const role of ["watcher", "foreman", "thinker", "reference"]) assert.equal(assistant.roleSpendsAi(role, true), false, role);
  assert.deepEqual(assistant.AGENT_ROLES.filter((row) => assistant.roleGatedBy(row.role, "backlog")).map((row) => row.role), ["briefer", "improver", "ideas", "grower"], "backlog mode holds new planning");
  assert.deepEqual(assistant.AGENT_ROLES.filter((row) => assistant.roleGatedBy(row.role, "growth")).map((row) => row.role), ["improver", "grower"]);
  assert.equal(assistant.roleGatedBy("overseer", "proactive"), false, "the overseer runs 24/7");
});

test("dueRoles applies the table: keys hold the model-call roles, switches hold their gated roles", () => {
  const fresh = assistant.emptyState(NOW);
  const keyed = { ...fresh, ai: { ...fresh.ai, keyPresent: true, backoffUntil: 0 } };
  assert.deepEqual(assistant.dueRoles(keyed, NOW), assistant.CADENCE_ROLES, "with a key and Proactive on, every seat that never ran is due");
  const keyless = assistant.dueRoles(fresh, NOW);
  assert.ok(!["briefer", "improver", "grower"].some((role) => keyless.includes(role)), "the model-call roles wait for a key");
  assert.ok(keyless.includes("ideas") && keyless.includes("overseer"), "the when-usable roles run their local pass keyless");
  const quiet = assistant.dueRoles(keyed, NOW, { proactive: false });
  assert.ok(!["thinker", "briefer", "improver", "ideas", "grower"].some((role) => quiet.includes(role)), `Proactive off holds its gated roles ${quiet}`);
  assert.ok(quiet.includes("overseer") && quiet.includes("foreman"), "the overseer and the foreman never wait on Proactive");
  const draining = assistant.dueRoles(keyed, NOW, { backlogMode: true });
  assert.deepEqual(draining, assistant.CADENCE_ROLES.filter((role) => !["briefer", "improver", "ideas", "grower"].includes(role)), "backlog mode holds new planning in the cadence itself");
  const backingOff = assistant.dueRoles({ ...keyed, ai: { ...keyed.ai, backoffUntil: NOW + MINUTE } }, NOW);
  assert.ok(!backingOff.includes("briefer") && backingOff.includes("ideas"), "a backoff holds the model-call roles only");
});

function digestOf(patch = {}) {
  const state = { ...assistant.emptyState(NOW), ai: { keyPresent: true, online: true, failures: 0, backoffUntil: 0 }, ...patch };
  return assistant.overseerDigest(state, NOW);
}

test("overseerSignature moves on a material change and holds still while the board only drifts", () => {
  const base = assistant.overseerSignature(digestOf());
  assert.equal(base, assistant.overseerSignature(digestOf()), "pure: the same digest signs the same");
  assert.equal(assistant.overseerSignature(assistant.overseerDigest({ ...assistant.emptyState(NOW), ai: { keyPresent: true } }, NOW + 5 * MINUTE)), base, "the clock alone is not a change");
  const problem = (kinds) => digestOf({ problems: kinds.map((kind, index) => ({ kind, text: `${kind} ${index}`, since: NOW })) });
  const oneAudit = assistant.overseerSignature(problem(["audit"]));
  assert.notEqual(oneAudit, base, "a new problem is a change");
  assert.equal(assistant.overseerSignature(problem(["audit", "audit"])), oneAudit, "a second problem of the same kind only drifts a count");
  assert.notEqual(assistant.overseerSignature(problem(["audit", "machine"])), oneAudit, "a new problem kind is a change");
  const failing = (role) => digestOf({ agents: assistant.emptyState(NOW).agents.map((row) => (row.role === role ? { ...row, status: "error", error: "boom" } : row)) });
  assert.notEqual(assistant.overseerSignature(failing("auditor")), base, "a role in error is a change");
  assert.notEqual(assistant.overseerSignature(failing("auditor")), assistant.overseerSignature(failing("briefer")), "which role is in error matters");
  const builders = (fails) => digestOf({ builderEvents: Array.from({ length: fails }, (_, index) => ({ at: NOW - index * 1000, role: "builder", ok: false, job: `job_${index}`, title: `task ${index}` })) });
  assert.notEqual(assistant.overseerSignature(builders(1)), base, "a builder failure appears");
  assert.equal(assistant.overseerSignature(builders(3)), assistant.overseerSignature(builders(1)), "more of the same failure is not new");
  assert.match(base, /^findings:.*\|problems:.*\|errors:.*\|band:\d$/);
});

test("overseerAiPlan pays for a review only when asked or when the signature moved", () => {
  const signature = "findings:|problems:|errors:|band:5";
  assert.deepEqual(assistant.overseerAiPlan({ signature, overseer: null, usable: false }), { call: false, reason: "AI not usable" });
  assert.deepEqual(assistant.overseerAiPlan({ signature, overseer: null, usable: true }), { call: true, reason: "no AI review yet" });
  const reviewed = { ...assistant.emptyOverseer(), ai: { lastAt: NOW, signature, reason: "no AI review yet" } };
  assert.deepEqual(assistant.overseerAiPlan({ signature, overseer: reviewed, usable: true }), { call: false, reason: "nothing changed since the last AI review" });
  assert.deepEqual(assistant.overseerAiPlan({ signature: "findings:auditor failing|problems:|errors:auditor|band:4", overseer: reviewed, usable: true }), { call: true, reason: "the board changed" });
  assert.deepEqual(assistant.overseerAiPlan({ signature, overseer: reviewed, usable: true, manual: true }), { call: true, reason: "asked for a review" });
  assert.equal(assistant.overseerAiPlan({ signature, overseer: reviewed, usable: false, manual: true }).call, false, "asking cannot mint a key");
});

test("the AI review record survives a merge, a save and a load; a merge without one keeps the old", () => {
  const record = { lastAt: NOW, signature: "findings:|problems:|errors:|band:5", reason: "no AI review yet", skippedAt: NOW + MINUTE, skipped: "nothing changed since the last AI review" };
  const merged = assistant.overseerMerge(assistant.emptyOverseer(), { summary: "fine", score: 100, findings: [] }, NOW, { ai: record });
  assert.deepEqual(merged.ai, record);
  assert.deepEqual(assistant.normalizeOverseer(JSON.parse(JSON.stringify(merged))).ai, record);
  assert.deepEqual(assistant.overseerMerge(merged, { summary: "again", findings: [] }, NOW + 2 * MINUTE).ai, record);
  assert.deepEqual(assistant.normalizeOverseer({ reviews: 3 }).ai, { lastAt: 0, signature: "", reason: "", skippedAt: 0, skipped: "" }, "a playbook saved before the record loads empty");
  assert.deepEqual(assistant.normalizeState({ version: 1 }, NOW).overseer.ai.lastAt, 0);
});

test("the thinker never claims a start it does not control", () => {
  const executor = { enabled: true, running: [], queued: 3 };
  const request = assistant.thinkPlan({ suggestions: [{ kind: "request", title: "Loose request", reason: "waiting in the request inbox" }], executor });
  assert.equal(request.act, null, "a request pick is only named");
  assert.match(request.thinking, /next up: "Loose request"/);
  assert.doesNotMatch(request.thinking, /starting work/);
  assert.equal(assistant.thinkPlan({ suggestions: [], executor }).act, null, "an idle queue with no pick is not a start either");
  const pick = [{ kind: "task", title: "Ready card", reason: "you asked for this", target: { kind: "task", id: "task_ready" } }];
  const plan = assistant.thinkPlan({ suggestions: pick, executor, backlog: { ready: ["task_ready", "task_first"], next: [{ id: "task_first" }] } });
  assert.deepEqual(plan.act, { kind: "pin", taskId: "task_ready", title: "Ready card", reason: "you asked for this" });
  assert.equal(assistant.thinkPlan({ suggestions: pick, executor: { ...executor, running: [{ title: "busy" }] }, backlog: { ready: ["task_ready"], next: [{ id: "task_first" }] } }).act, null, "a busy executor is left to its own order");
});

test("the thinker picks in the dispatcher's order and never pins ahead of the owner", () => {
  const executor = { enabled: true, running: [], queued: 0 };
  const taskPick = (id, title, reason = "open on the board") => ({ kind: "task", title, reason, target: { kind: "task", id } });
  // suggestWork ignores pins: its top pick was the older chat card while the
  // dispatcher had the composer card the owner just pinned first.
  const ownerPin = assistant.thinkPlan({
    suggestions: [taskPick("task_b", "Older chat card B", "you asked for this"), taskPick("task_a", "Composer card A", "you asked for this")],
    executor,
    backlog: { ready: ["task_b", "task_a"], next: [{ id: "task_a", kind: "task", pin: true, source: "chat" }, { id: "task_b", kind: "task", source: "chat" }] },
  });
  assert.equal(ownerPin.act, null, "the dispatcher's first pick is the owner's pin");
  // The owner's band leads (an idea promoted by hand): a roster card is only named.
  const ownerBand = assistant.thinkPlan({
    suggestions: [taskPick("task_eyes", "Scout card")],
    executor,
    backlog: { ready: ["task_idea", "task_eyes"], next: [{ id: "task_idea", kind: "task", source: "idea", origin: { kind: "idea", by: "owner" } }, { id: "task_eyes", kind: "task", source: "a-eyes" }] },
  });
  assert.equal(ownerBand.act, null, "a card in the owner's band leads");
  assert.match(ownerBand.thinking, /next up: "Scout card"/);
  // Nothing of the owner's leads: the pick the dispatcher ranks first among
  // the thinker's ready picks is the one put first.
  const agents = assistant.thinkPlan({
    suggestions: [taskPick("task_late", "Late scout card"), taskPick("task_early", "Early scout card"), taskPick("task_held", "Held card")],
    executor,
    backlog: { ready: ["task_old", "task_late", "task_early"], next: [{ id: "task_old", kind: "task" }, { id: "task_early", kind: "task", source: "a-eyes" }, { id: "task_late", kind: "task", source: "a-eyes" }] },
  });
  assert.deepEqual(agents.act, { kind: "pin", taskId: "task_early", title: "Early scout card", reason: "open on the board" });
  assert.match(agents.thinking, /putting first: "Early scout card"/);
});

test("roleHold is dueRoles' hold for one role by name", () => {
  const keyed = { keyPresent: true, backoffUntil: 0 };
  assert.equal(assistant.roleHold("ideas", { proactive: false }, keyed, NOW), "proactive");
  assert.equal(assistant.roleHold("thinker", { proactive: false }, keyed, NOW), "proactive");
  assert.equal(assistant.roleHold("overseer", { proactive: false }, keyed, NOW), "", "the overseer runs 24/7");
  assert.equal(assistant.roleHold("ideas", { backlogMode: true }, keyed, NOW), "backlog");
  assert.equal(assistant.roleHold("briefer", {}, { keyPresent: false }, NOW), "ai");
  assert.equal(assistant.roleHold("ideas", {}, { keyPresent: false }, NOW), "", "the ideas scan runs its local pass keyless");
  assert.equal(assistant.roleHold("ghost", { proactive: false }, keyed, NOW), "");
  for (const role of assistant.CADENCE_ROLES) {
    const due = assistant.dueRoles({ ...assistant.emptyState(NOW), ai: keyed }, NOW, { proactive: false }).includes(role);
    assert.equal(due, !assistant.roleHold(role, { proactive: false }, keyed, NOW), role);
  }
});
