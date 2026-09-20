import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createMachineLagGate } from "../scripts/assistant.mjs";

test("one lag spike is a resample signal and never a hold", () => {
  const gate = createMachineLagGate({ threshold: 100 });
  const first = gate(250);
  assert.equal(first.hold, false);
  assert.equal(first.resample, true);
  assert.equal(first.consecutive, 1);
});

test("two consecutive strictly-above samples hold the foreman", () => {
  const gate = createMachineLagGate({ threshold: 100 });
  gate(150);
  const second = gate(150);
  assert.equal(second.hold, true);
  assert.equal(second.resample, false);
  assert.equal(second.consecutive, 2);
});

test("a sample exactly at the threshold is responsive and resets the streak", () => {
  const gate = createMachineLagGate({ threshold: 100 });
  gate(300);
  const reset = gate(100);
  assert.equal(reset.hold, false, "a hold must not latch on the threshold itself");
  assert.equal(reset.resample, false);
  assert.equal(reset.consecutive, 0);
});

test("a healthy 0 ms recovery sample releases a latched hold", () => {
  const gate = createMachineLagGate({ threshold: 100 });
  gate(400);
  const latched = gate(400);
  assert.equal(latched.hold, true);
  const recovery = gate(0);
  assert.equal(recovery.hold, false, "the foreman must resume on the responsive reading");
  assert.equal(recovery.consecutive, 0);
});

test("non-finite lag readings are not lag evidence", () => {
  const gate = createMachineLagGate({ threshold: 100 });
  for (const reading of [NaN, Infinity, -Infinity]) {
    const result = gate(reading);
    assert.equal(result.hold, false);
    assert.equal(result.resample, false);
    assert.equal(result.consecutive, 0);
  }
});

test("custom requiredSamples widens the hold gate", () => {
  const gate = createMachineLagGate({ threshold: 100, requiredSamples: 3 });
  gate(200);
  assert.equal(gate(200).hold, false);
  const third = gate(200);
  assert.equal(third.hold, true);
  assert.equal(third.consecutive, 3);
});

test("--lag-gate-fixture replays the same state machine through the real CLI", async () => {
  const fixture = {
    options: { threshold: 100, requiredSamples: 2 },
    samples: [250, 150, 100, 0, 300, NaN, 350, 120],
  };
  const directory = await mkdtemp(join(tmpdir(), "mefi-lag-gate-"));
  try {
    const fixturePath = join(directory, "lag.json");
    await writeFile(fixturePath, JSON.stringify(fixture), "utf8");
    const studio = fileURLToPath(new URL("..", import.meta.url));
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(studio, "scripts", "assistant.mjs"), "--lag-gate-fixture", fixturePath], {
        cwd: studio,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "", err = "";
      child.stdout.on("data", (chunk) => { out += chunk; });
      child.stderr.on("data", (chunk) => { err += chunk; });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`assistant.mjs exited ${code}: ${err}`));
      });
    });
    const replay = JSON.parse(stdout);
    assert.deepEqual(replay, [
      { hold: false, resample: true, consecutive: 1 },
      { hold: true, resample: false, consecutive: 2 },
      { hold: false, resample: false, consecutive: 0 },
      { hold: false, resample: false, consecutive: 0 },
      { hold: false, resample: true, consecutive: 1 },
      { hold: false, resample: false, consecutive: 0 },
      { hold: false, resample: true, consecutive: 1 },
      { hold: true, resample: false, consecutive: 2 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
