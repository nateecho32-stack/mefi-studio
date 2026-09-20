#!/usr/bin/env node
// Normalized-path lock proof (A-Eyes overseer directive): two concurrent
// claims on the same file under two spellings of its path must yield exactly
// one rejection. Drives the real scripts/assistant.mjs write-lock registry
// (claimWrite / releaseWrite / heldWritePaths / claimWork) in-process.
//
// Run: node tools/test_normalized_path_lock.mjs   (exit 0 = proof holds)
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assistant = await import(
  pathToFileURL(path.join(ROOT, "scripts", "assistant.mjs")).href
);
const { claimWrite, releaseWrite, heldWritePaths, claimWork, writeClaimKey } = assistant;

const REL = "./tools/x.py";
const ABS_BACKSLASH_UPPER = `${ROOT.toUpperCase()}\\Tools\\X.PY`;
const ABS_SLASH = `${ROOT.replace(/\\/g, "/")}/tools/x.py`;

let failures = 0;
const check = async (name, run) => {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL - ${name}: ${error.message}`);
  }
};

await check("two concurrent claims on one normalized path yield one rejection", async () => {
  const outcomes = await Promise.all([
    claimWrite(REL, "session-a"),
    claimWrite(ABS_BACKSLASH_UPPER, "session-b"),
  ]);
  const refused = outcomes.filter((item) => item.action === "refuse");
  const proceeded = outcomes.filter((item) => item.action === "proceed");
  assert.equal(refused.length, 1, `exactly one refusal, got ${JSON.stringify(outcomes)}`);
  assert.equal(proceeded.length, 1, "the winner proceeds");
  assert.equal(refused[0].reason, "claimed");
  assert.ok(refused[0].advice.includes("already claimed"), refused[0].advice);
  assert.equal(heldWritePaths().length, 1, "one registry entry, not two");
});

// 2. The loser may take the path once the winner lets go.
await check("release lets the refused session back in", async () => {
  assert.equal(releaseWrite(REL, "session-a"), 1);
  const retry = claimWrite(ABS_BACKSLASH_UPPER, "session-b");
  assert.equal(retry.action, "proceed");
  releaseWrite(ABS_BACKSLASH_UPPER, "session-b");
  assert.equal(heldWritePaths().length, 0);
});

// 3. Same-owner re-claim is idempotent, another owner is still refused.
await check("same owner re-claims idempotently, other owners are refused", () => {
  assert.equal(claimWrite(ABS_SLASH, "session-a").action, "proceed");
  assert.equal(claimWrite(REL, "session-a").action, "proceed");
  assert.equal(heldWritePaths().length, 1);
  assert.equal(claimWrite(REL, "session-b").action, "refuse");
  releaseWrite(REL, "session-a");
});

// 4. Dispatch refuses while the registry holds the path, proceeds after release.
await check("claimWork defers a pick whose path the registry holds", () => {
  assert.equal(claimWrite(REL, "session-a").action, "proceed");
  const deferred = claimWork({ work: { title: "second", files: [ABS_BACKSLASH_UPPER] }, jobs: [] });
  assert.equal(deferred.action, "defer");
  assert.equal(deferred.reason, "claimed");
  const after = releaseWrite(REL, "session-a");
  assert.equal(after, 1);
  const free = claimWork({ work: { title: "second", files: [ABS_BACKSLASH_UPPER] }, jobs: [] });
  assert.equal(free.action, "proceed", String(free.reason));
});

// 5. A multi-file claim is all-or-nothing on its keys.
await check("multi-file claims refuse as a unit and release as a unit", () => {
  assert.equal(claimWrite(["a/one.py", "b/two.py"], "session-a").action, "proceed");
  const second = claimWrite(["b/TWO.py", "c/three.py"], "session-b");
  assert.equal(second.action, "refuse");
  assert.deepEqual(second.held, [writeClaimKey("b/two.py")].map((key) => key));
  assert.equal(heldWritePaths().some((key) => key.endsWith("c/three.py")), false, "nothing from the refused claim leaked");
  assert.equal(releaseWrite(["a/one.py", "b/two.py"], "session-a"), 2);
  assert.equal(heldWritePaths().length, 0);
});

// 6. Only the owner (or an explicit wildcard) releases a claim.
await check("a foreign owner cannot release someone else's claim", () => {
  assert.equal(claimWrite(REL, "session-a").action, "proceed");
  assert.equal(releaseWrite(REL, "session-b"), 0);
  assert.equal(heldWritePaths().length, 1);
  assert.equal(releaseWrite(REL, "session-a"), 1);
  assert.equal(heldWritePaths().length, 0);
});

if (failures) {
  console.error(`\n${failures} check(s) failed - the normalized-path lock does not hold.`);
  process.exit(1);
}
console.log("\nall checks passed - two concurrent claims on one normalized path yield exactly one rejection.");
