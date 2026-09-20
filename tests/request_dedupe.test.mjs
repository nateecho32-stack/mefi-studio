// Auto request deduplication: the compactor and the tidy pass collapse
// refiled copies of the same ask before the queue ever sees them. These lock
// the payload-key contract — one identity per ask, a running claim holds its
// slot, genuinely different asks survive, and the report counts what dropped
// so the host feed can name it.
//
// Run: node --test tests/request_dedupe.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { compact, tidy, requestPayloadKey } from "../scripts/assistant.mjs";

const MINUTE = 60 * 1000;
const now = 1700000000000;

test("requestPayloadKey is stable across reworded display text and punctuation", () => {
  const ask = { title: "Resume: eyes.mjs atomic write guards", prompt: "A-Eyes overseer: resume the atomic write guards.", source: "overseer", at: 1 };
  const refiled = { ...ask, title: "Atomic write guards: resume eyes.mjs", prompt: "a eyes overseer resume the atomic write guards" };
  assert.equal(requestPayloadKey(ask), requestPayloadKey(refiled));
  assert.equal(requestPayloadKey({ title: "No prompt" }), "");
  assert.equal(requestPayloadKey(null), "");
  assert.notEqual(requestPayloadKey(ask), requestPayloadKey({ ...ask, prompt: "A-Eyes overseer: resume the queue gates." }));
});

test("the compactor drops exact payload duplicates refiled under reworded titles", () => {
  const out = compact({
    now,
    tasks: [],
    requests: [
      { title: "Resume: eyes.mjs atomic write guards", prompt: "A-Eyes overseer: resume the atomic write guards.", source: "overseer", at: now - MINUTE },
      { title: "Atomic write guards: resume eyes.mjs", prompt: "a eyes overseer resume the atomic write guards", source: "overseer", at: now },
    ],
  });
  assert.equal(out.requests.length, 1, JSON.stringify(out.requests));
  assert.equal(out.requests[0].title, "Resume: eyes.mjs atomic write guards");
  assert.equal(out.report.duplicateRequests, 1);
  assert.match(out.report.text, /1 duplicate request/, `report text names the dropped copy: ${out.report.text}`);
});

test("a genuinely different ask from the same source still queues", () => {
  const out = compact({
    now,
    tasks: [],
    requests: [
      { title: "Resume: eyes.mjs atomic write guards", prompt: "resume the atomic write guards", source: "overseer", at: now },
      { title: "Resume: eyes.mjs queue gates", prompt: "resume the queue gates", source: "overseer", at: now },
    ],
  });
  assert.equal(out.requests.length, 2, JSON.stringify(out.requests.map((row) => row.title)));
});

test("a running claim holds its payload slot so a refiled copy cannot enqueue beside it", () => {
  const claim = { title: "Claimed copy", prompt: "resume the atomic write guards", source: "overseer", at: now - MINUTE, status: "running", runId: "run_live" };
  const refiled = { title: "Refiled copy", prompt: "resume the atomic write guards", source: "overseer", at: now };
  const out = compact({ now, tasks: [], requests: [claim, refiled] });
  assert.equal(out.requests.length, 1, JSON.stringify(out.requests));
  assert.equal(out.requests[0].runId, "run_live");
  assert.equal(out.report.duplicateRequests, 1);
});

test("tidy keeps only the newest auto copy of an exact duplicate prompt", () => {
  const out = tidy({
    now,
    tasks: [],
    ideas: [],
    requests: [
      { title: "Old copy", prompt: "resume the atomic write guards", source: "overseer", at: now - 2 * MINUTE },
      { title: "New copy", prompt: "resume the atomic write guards", source: "overseer", at: now },
    ],
  });
  assert.deepEqual(out.requests.map((row) => row.title), ["New copy"]);
  assert.equal(out.report.requestsCleared, 1);
  assert.match(out.report.text, /cleared 1 request/);
});

test("tidy keeps every manual copy and lets a manual ask supersede its auto duplicates", () => {
  const chat = { title: "Chat ask", prompt: "resume the atomic write guards", source: "chat", at: now - 2 * MINUTE };
  const chatAgain = { title: "Chat ask again", prompt: "resume the atomic write guards", source: "chat", at: now - MINUTE };
  const auto = { title: "Auto ask", prompt: "resume the atomic write guards", source: "overseer", at: now };
  const out = tidy({ now, tasks: [], ideas: [], requests: [chat, chatAgain, auto] });
  assert.deepEqual(out.requests.map((row) => row.title), ["Chat ask", "Chat ask again"]);
  assert.equal(out.report.requestsCleared, 1);
});
