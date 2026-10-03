// The store client under the Rust host (scripts/eyes-client.cjs
// createHostEyesClient): the worker client's contract, served by the host's
// call instead of a worker thread. tests/rust_parity_eyes.test.mjs holds the
// Rust answers themselves to eyes.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createEyesClient, wrapEyes, EYES_WORKER_METHODS } = require("../scripts/eyes-client.cjs");

function fakeHost(answer = async () => ({ rows: 1 })) {
  const calls = [];
  return { calls, hostCall: (api, args) => (calls.push({ api, args }), answer(api, args)) };
}

test("a host client forwards each store read as eyes.<method> with its arguments", async () => {
  const host = fakeHost(async (api) => ({ answeredBy: api }));
  const client = createEyesClient({ studioRoot: ".", hostCall: host.hostCall });
  assert.deepEqual(await client.call("listSessions", { limit: 2, root: "C:/x" }), { answeredBy: "eyes.listSessions" });
  assert.deepEqual(host.calls, [{ api: "eyes.listSessions", args: { limit: 2, root: "C:/x" } }]);
  assert.equal(client.status().host, "rust");
  assert.equal(client.status().calls, 1);
  assert.equal(client.status().pending, 0);
});

test("only store reads cross, a failure or a timeout rejects and is counted, and close is final", async () => {
  const host = fakeHost(async (api) => {
    if (api === "eyes.collisions") throw new Error("no such table: part");
    return new Promise(() => {}); // never answers
  });
  const client = createEyesClient({ studioRoot: ".", hostCall: host.hostCall, timeoutMs: 30 });
  await assert.rejects(client.call("openDb", {}), /is not a store read/);
  assert.equal(host.calls.length, 0, "a method outside the list never reaches the host");
  await assert.rejects(client.call("collisions", {}), /no such table: part/);
  await assert.rejects(client.call("listTodos", {}), /listTodos: store read timed out after 30 ms/);
  assert.equal(client.status().failures, 2);
  assert.equal(client.status().pending, 0);
  client.restart("test");
  client.setVersion(3);
  assert.equal(client.status().restarts, 1);
  assert.equal(client.status().version, 3);
  await client.close();
  await assert.rejects(client.call("listSessions", {}), /closed/);
  assert.equal(client.status().running, false);
});

test("wrapEyes over a host client keeps every store read and still refuses openDb", async () => {
  const host = fakeHost();
  const client = createEyesClient({ studioRoot: ".", hostCall: host.hostCall });
  const module = Object.fromEntries(EYES_WORKER_METHODS.map((method) => [method, () => "local"]));
  const wrapped = wrapEyes({ ...module, readJson: () => "stays local" }, client);
  assert.deepEqual(await wrapped.usageLedger({ now: 1 }), { rows: 1 });
  assert.equal(wrapped.readJson(), "stays local");
  assert.throws(() => wrapped.openDb(), /unavailable on the main process/);
  assert.equal(wrapped.eyesWorkerStatus().host, "rust");
});

test("outside the Rust host the worker client is used, as before", () => {
  const previous = process.env.MEFI_STUDIO_HOST;
  delete process.env.MEFI_STUDIO_HOST;
  try {
    const client = createEyesClient({ studioRoot: "." });
    assert.equal(client.status().host, undefined);
    assert.equal(client.status().running, false, "no worker starts until a read");
  } finally {
    if (previous !== undefined) process.env.MEFI_STUDIO_HOST = previous;
  }
});
