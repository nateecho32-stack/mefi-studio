import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createUpdater } from "../scripts/updater.mjs";

function signal() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function observed(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("deferred restart never retried")), 15000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-deferred-update-"));
  await writeFile(path.join(root, "main.cjs"), "// before update\n");
  const updater = createUpdater({ sourceRoot: root, watch: false, hidden: () => true,
    pollMs: 3600000, debounceMs: 30, restartQuietMs: 30, deferredRetryMs: 30,
    build: async () => {}, ...options });
  t.after(async () => { updater.stop(); await rm(root, { recursive: true, force: true }); });
  await updater.start();
  await writeFile(path.join(root, "main.cjs"), "// after update\n");
  return updater;
}

test("a deferred restart wakes after workers save results without another edit or visible poll", async (t) => {
  const saved = signal(), applied = signal();
  const job = { finished: false, settlementPending: false };
  const attempts = [];
  const updater = await fixture(t, { actions: { restart: async (files) => {
    attempts.push(files);
    if (!job.finished || job.settlementPending) {
      if (job.settlementPending) saved.resolve();
      return { deferred: true, reason: "build job finishing before update" };
    }
    return { ok: true };
  } }, onEvent: (event) => {
    if (event.phase === "watching" && attempts.length) applied.resolve();
  } });

  const pending = await updater.applyNow();
  assert.equal(pending.phase, "pending");
  assert.equal(attempts.length, 1);
  job.finished = true;
  job.settlementPending = true;
  await observed(saved.promise);
  assert.equal(updater.status().last, null, "unsaved results keep the update pending");
  job.settlementPending = false;
  await observed(applied.promise);
  assert.equal(updater.status().phase, "watching");
  assert.ok(attempts.length >= 3);
  assert.ok(attempts.every((files) => files.length === 1 && files[0] === "main.cjs"));
});

test("disabling automatic updates cancels deferred retries and releases the host hold reason", async (t) => {
  const applied = signal();
  let attempts = 0, workerRunning = true;
  const updater = await fixture(t, { actions: { restart: async () => {
    attempts += 1;
    return workerRunning ? { deferred: true, reason: "build job finishing before update" } : { ok: true };
  } }, onEvent: (event) => {
    if (event.phase === "watching" && attempts > 1) applied.resolve();
  } });
  await updater.applyNow();
  assert.equal((await updater.whenIdle()).phase, "pending", "deferred work does not block idle observers");
  updater.setAuto(false);
  assert.equal(updater.status().reason, "auto-restart is off");
  workerRunning = false;
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(attempts, 1, "automatic retries stop when the user disables updates");
  updater.setAuto(true);
  await observed(applied.promise);
  assert.equal(attempts, 2, "enabling updates applies the retained change");
});

test("stopping the watcher cancels its pending restart retry", async (t) => {
  let attempts = 0;
  const updater = await fixture(t, { actions: { restart: async () => {
    attempts += 1;
    return { deferred: true, reason: "Love2D is running" };
  } } });
  await updater.applyNow();
  updater.stop();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(attempts, 1);
  assert.equal(updater.status().watching, false);
});

test("a deferred manual apply with automatic updates off leaves dispatch unheld", async (t) => {
  let attempts = 0;
  const updater = await fixture(t, { auto: false, actions: { restart: async () => {
    attempts += 1;
    return { deferred: true, reason: "build job finishing before update" };
  } } });
  const pending = await updater.applyNow();
  assert.equal(pending.reason, "auto-restart is off", "the host clears its drain hold when no retry is scheduled");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(attempts, 1);
});

test("a deferred retry validates new source before applying the restart", async (t) => {
  const held = signal();
  let attempts = 0, sourceRoot;
  const updater = await fixture(t, { build: async ({ root }) => { sourceRoot = root; },
    actions: { restart: async () => {
      attempts += 1;
      return { deferred: true, reason: "build job finishing before update" };
    } }, onEvent: (event) => { if (event.phase === "held") held.resolve(event); } });
  await updater.applyNow();
  await writeFile(path.join(sourceRoot, "main.cjs"), "const broken = ;\n");
  const event = await observed(held.promise);
  assert.equal(event.reason, "syntax error");
  assert.equal(attempts, 1, "a later incomplete edit cannot reach the host restart action");
});
