import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { sceneScores, createSceneSampler } = createRequire(import.meta.url)("../scripts/media-scene.cjs");

test("Scene analysis finds a broad dark region despite sparse bright node highlights", () => {
  const bitmap = Buffer.alloc(96 * 96 * 4, 255);
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
    const value = x < 55 && y < 55 ? 20 : 180;
    const at = (y * 96 + x) * 4;
    bitmap.fill((x + y) % 17 === 0 ? 255 : value, at, at + 3);
  }
  const scores = sceneScores(bitmap, 96, 96);
  assert.equal(scores.length, 9); assert.equal(scores.indexOf(Math.min(...scores)), 0);
  assert.ok(scores[8] - scores[0] > .15);
  assert.equal(sceneScores(Buffer.alloc(3), 96, 96), null);
});

test("Sampling is bounded, main-frame-only, rate-limited and never returns image data", async () => {
  let now = 10000, calls = 0, capture;
  const image = { resize: () => image, getSize: () => ({ width: 96, height: 96 }), toBitmap: () => Buffer.alloc(96 * 96 * 4, 90) };
  const contents = { mainFrame: {}, capturePage: async rect => { calls++; capture = rect; return image; } };
  const window = { webContents: contents, isDestroyed: () => false, isVisible: () => true, getContentBounds: () => ({ width: 800, height: 600 }) };
  const sample = createSceneSampler(() => window, () => now);
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal((await sample({ ...event, senderFrame: {} }, { x: 0, y: 0, w: 800, h: 600 })).ok, false);
  assert.equal((await sample(event, { x: NaN, y: 0, w: 800, h: 600 })).ok, false);
  const result = await sample(event, { x: -20, y: 10, w: 10000, h: 10000 });
  assert.deepEqual(Object.keys(result).sort(), ["ok", "scores"]);
  assert.deepEqual(capture, { x: 0, y: 10, width: 800, height: 590 });
  assert.equal((await sample(event, { x: 0, y: 0, w: 800, h: 600 })).ok, false);
  assert.equal(calls, 1); now += 5000;
  contents.capturePage = async () => { throw new Error("unavailable"); };
  assert.equal((await sample(event, { x: 0, y: 0, w: 800, h: 600 })).ok, false);
});

test("Scene footprints account for tree size and bound malformed coverage", () => {
  const bitmap = Buffer.alloc(96 * 96 * 4, 220);
  for (let y = 0; y < 45; y++) for (let x = 0; x < 45; x++) bitmap.fill(10, (y * 96 + x) * 4, (y * 96 + x) * 4 + 3);
  const small = sceneScores(bitmap, 96, 96, .4, .4), large = sceneScores(bitmap, 96, 96, .94, .94);
  assert.ok(small[0] < large[0], "a large tree must consider the bright pixels outside a small shadow");
  for (const size of [NaN, Infinity, -50, 500]) assert.ok(sceneScores(bitmap, 96, 96, size, size).every(Number.isFinite));
});
