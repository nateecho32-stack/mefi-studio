// What a click on a Windows notification tells the page (alerts:open): the
// first thing it named, and, only when it named several, how many. The 0.5
// shell opens the Inbox for a burst and the one task for a single thing
// (renderer/today.js openFromAlert), and it cannot tell them apart without
// the count. A single thing carries no count, so the payload every earlier
// reader was written against is the payload they still get
// (tests/alerts_host.test.mjs pins those shapes).
//
// Run: node --test tests/alerts_click_count.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { SECOND, world } from "./fixtures/alerts-host.mjs";

const digestOf = (...ids) => ({ total: ids.length, items: ids.map((id) => ({ kind: "question", questionId: id, taskId: `task_${id}` })) });

test("a burst of three is one notification whose click says it told three", async () => {
  const t = world({ digest: digestOf("a", "b", "c") });
  await t.host.start();
  t.host.question(t.ask({ id: "a", context: { taskId: "ta" } }));
  await t.advance(1 * SECOND);
  t.host.question(t.ask({ id: "b", context: { taskId: "tb" } }));
  await t.advance(1 * SECOND);
  t.host.question(t.ask({ id: "c", context: { taskId: "tc" } }));
  await t.advance(21 * SECOND);
  assert.equal(t.w.shown.length, 1, "one notification for the burst");
  t.w.shown[0].emit("click");
  assert.deepEqual(t.w.opened, [{ kind: "need", id: "ta", taskId: "ta", projectId: "project_a", count: 3 }], "the first of them, and how many there were");
});

test("one thing carries no count, so a single task still opens as it always did", async () => {
  const t = world({ digest: digestOf("q1") });
  await t.host.start();
  t.host.question(t.ask());
  await t.advance(21 * SECOND);
  t.w.shown[0].emit("click");
  assert.deepEqual(t.w.opened, [{ kind: "need", id: "t1", taskId: "t1", projectId: "project_a" }]);
  assert.ok(!("count" in t.w.opened[0]), "no count key at all for one");
});

test("the test notification and a click after a burst told one more each keep their own count", async () => {
  const t = world({ digest: digestOf("a") });
  await t.host.start();
  const sent = await t.host.test();
  assert.equal(sent.sent, true);
  t.w.shown.at(-1).emit("click");
  assert.deepEqual(t.w.opened.at(-1), { kind: "test", id: null, taskId: null, projectId: null }, "a test names nothing and counts nothing");
  t.host.question(t.ask({ id: "x", context: { taskId: "tx" } }));
  await t.advance(21 * SECOND);
  t.w.shown.at(-1).emit("click");
  assert.ok(!("count" in t.w.opened.at(-1)), "one thing later is still one thing");
});
