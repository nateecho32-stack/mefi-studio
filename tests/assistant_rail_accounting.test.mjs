import test from "node:test";
import assert from "node:assert/strict";
import { organize, sameOrganization } from "../scripts/assistant.mjs";

const HOUR = 3600000;
const now = 1790000000000;

const session = (id, title, hoursAgo) => ({ id, title, timeUpdated: now - hoursAgo * HOUR });
const todo = (sessionId, content, status) => ({ sessionId, content, status, position: 0 });

test("work accounting counts only active sessions' in-progress rows as in flight", () => {
  const org = organize({
    now,
    sessions: [session("ses_active", "Live accounting fixes", 0), session("ses_staleIP", "Quiet accounting fixes", 30)],
    todos: [todo("ses_active", "ship the fix", "in_progress"), todo("ses_staleIP", "ship the fix", "in_progress")],
  });
  assert.deepEqual(org.active, ["ses_active"]);
  assert.deepEqual(org.stale, ["ses_staleIP"]);
  assert.equal(org.inProgress, 1, "one in-flight todo on the active session only");
  assert.equal(org.requeuedTodos, 1, "the stale session's in-progress row is rot waiting for rescue, not work in flight");
  assert.ok(org.staleQuietMin >= 24 * 60, `staleQuietMin ${org.staleQuietMin}`);
});

test("an old session holding only never-started todos folds instead of raising a stale warning", () => {
  const org = organize({
    now,
    sessions: [session("ses_roadmap", "Paused roadmap", 30)],
    todos: [todo("ses_roadmap", "later phase", "pending")],
  });
  assert.deepEqual(org.stale, []);
  assert.ok(org.folded.includes("ses_roadmap"));
  assert.equal(org.inProgress, 0);
  assert.equal(org.requeuedTodos, 0);
});

test("the work-accounting numbers own sameOrganization so stored intel cannot drift from the digest", () => {
  const base = { now, sessions: [session("ses_active", "Live", 0)], todos: [todo("ses_active", "a", "in_progress")] };
  const first = organize(base);
  const stillFresh = organize(base);
  assert.equal(sameOrganization(first, stillFresh), true);
  const afterRescue = organize({ ...base, todos: [todo("ses_active", "a", "completed")] });
  assert.equal(sameOrganization(first, afterRescue), false);
});
