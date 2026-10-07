import test from "node:test";
import assert from "node:assert/strict";
import { alertProblem, hostCapacityAlert, requestsFromBriefing } from "../scripts/eyes.mjs";

// The four alerts that were filed as "Fix:" cards on the live board while the
// laptop sat under its memory floor: each ran into the hold it described.
const HOST = [
  { severity: "critical", title: "Critical memory pressure", detail: "Free memory is under the severe floor; new workers are refused.", sessionIds: ["ses_1"] },
  { severity: "warn", title: "Memory hold blocking new workers", detail: "Every start waits for free memory.", sessionIds: [] },
  { severity: "warn", title: "Machine responsiveness degraded", detail: "Lag readings stay high.", sessionIds: ["ses_2"] },
  { severity: "warn", title: "Machine lag blocks new starts", detail: "The lag hold is latched.", sessionIds: [] },
  // The processor's load is the machine's too: a QA run on 2026-10-06 found "Fix: High CPU usage" queued under Pause, unasked.
  { severity: "warn", title: "High CPU usage", detail: "CPU 97% for the last ten minutes.", sessionIds: ["ses_6"] },
  { severity: "critical", title: "CPU at 99% across the machine", detail: "Every core is busy.", sessionIds: [] },
  { severity: "warn", title: "Sustained processor load", detail: "Load stays near full.", sessionIds: [] },
];

test("alerts about the host's memory or lag are not filed as Fix requests", () => {
  for (const alert of HOST) assert.equal(hostCapacityAlert(alert), true, alert.title);
  assert.deepEqual(requestsFromBriefing({ alerts: HOST }, []), []);
});

test("code problems still become Fix requests, including a memory leak in a named file", () => {
  const alerts = [
    { severity: "warn", title: "main.cjs syntax error reported", detail: "node --check main.cjs fails.", sessionIds: ["ses_3"] },
    { severity: "warn", title: "Memory leak in renderer/idle.js", detail: "The callout cache grows on every frame.", sessionIds: ["ses_4"] },
    { severity: "warn", title: "Memory pressure from the scripts/eyes.mjs row cache", detail: "The row cache in scripts/eyes.mjs never evicts.", sessionIds: ["ses_5"] },
    { severity: "warn", title: "High CPU usage in renderer/tree3d.js", detail: "The frame loop in renderer/tree3d.js never sleeps.", sessionIds: ["ses_7"] },
  ];
  const requests = requestsFromBriefing({ alerts: [...HOST, ...alerts] }, []);
  assert.deepEqual(requests.map((request) => request.title), [
    "Fix: main.cjs syntax error reported",
    "Fix: Memory leak in renderer/idle.js",
    "Fix: Memory pressure from the scripts/eyes.mjs row cache",
    "Fix: High CPU usage in renderer/tree3d.js",
  ]);
  assert.ok(requests.every((request) => request.source === "fix"));
});

test("an earlier brief's boilerplate closing does not refuse an unrelated dup-worded alert", () => {
  const [first] = requestsFromBriefing({
    alerts: [{ severity: "warn", title: "Test suite fails on CI", detail: "Three suites time out.", sessionIds: ["ses_t"] }],
  });
  assert.equal(alertProblem(first).family, null, "fixture: the brief's closing instruction names no problem");
  const [refiled] = requestsFromBriefing(
    { alerts: [{ severity: "warn", title: "Duplicate session panel rows", detail: "The roster shows two rows for one session.", sessionIds: ["ses_d"] }] },
    [structuredClone(first)]
  );
  assert.ok(refiled, "filing admits the unrelated alert instead of refusing it on the boilerplate dup family");
  assert.equal(refiled.alertTitle, "Duplicate session panel rows");
});
