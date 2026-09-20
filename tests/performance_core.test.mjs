import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/performance-core.js", import.meta.url), "utf8");
function fixture() {
  const window = {}; vm.runInNewContext(source, { window });
  let time = 0;
  const profiler = window.MefiPerformanceCore.create({ now: () => time, wallNow: () => 1000 + time });
  return { profiler, advance: (ms) => { time += ms; }, at: (ms) => { time = ms; }, snapshot: () => JSON.parse(JSON.stringify(profiler.snapshot())) };
}

test("disabled profiler does not collect work and preserves callback results/errors", async () => {
  const { profiler: p, snapshot } = fixture();
  assert.equal(p.begin("scope"), null);
  assert.equal(p.measure("scope", () => 42), 42);
  assert.equal(await p.measureAsync("scope", async () => 43), 43);
  const failure = new Error("private failure text");
  assert.throws(() => p.measure("scope", () => { throw failure; }), (error) => error === failure);
  p.frame(500); p.frame(1000); p.longTask(100, 600);
  assert.deepEqual(snapshot().spans, []); assert.equal(snapshot().frameCount, 0); assert.equal(snapshot().startedAt, null);
});

test("nested scopes attribute self time without double-counting and close after failures", () => {
  const { profiler: p, advance, snapshot } = fixture(); p.start();
  p.measure("outer", () => { advance(5); p.measure("inner", () => advance(20)); advance(7); });
  const rows = snapshot().spans;
  assert.equal(rows.find((row) => row.name === "outer").selfMs, 12);
  assert.equal(rows.find((row) => row.name === "outer").totalMs, 32);
  assert.equal(rows.find((row) => row.name === "inner").selfMs, 20);
  assert.throws(() => p.measure("failed", () => { advance(60); throw new Error("secret"); }));
  assert.equal(snapshot().spans.find((row) => row.name === "failed").errors, 1);
  assert.equal(JSON.stringify(snapshot()).includes("secret"), false);
  p.measure("next", () => advance(3));
  assert.equal(snapshot().spans.find((row) => row.name === "next").selfMs, 3);
});

test("frame percentiles, budgets and hitch counts use a rolling window with bounded incidents", () => {
  const { profiler: p, at, snapshot } = fixture(); p.start(); p.frame(0);
  let time = 0;
  for (let i = 0; i < 1100; i++) { time += i < 200 ? 100 : 20; at(time); p.frame(time); }
  const data = snapshot();
  assert.equal(data.frameCount, 1100); assert.equal(data.hitchCount, 200);
  assert.equal(data.frames.length, 900); assert.equal(data.incidents.length, 60);
  assert.equal(data.frameStats.p95Ms, 20); assert.equal(data.frameStats.maxMs, 20);
  assert.equal(data.frameStats.overBudget, 0);
  p.setBudget(60); assert.equal(snapshot().frameStats.overBudget, 900);
  p.setBudget(NaN); assert.equal(snapshot().budgetMs, 1000 / 60);
});

test("visibility suspend excludes hidden gaps and invalidates unfinished timings", () => {
  const { profiler: p, at, snapshot } = fixture(); p.start(); p.frame(0); at(20); p.frame(20);
  const token = p.begin("old"); p.suspend(); at(10000); p.end(token); p.frame(10000); at(10020); p.frame(10020);
  assert.equal(snapshot().frameCount, 2); assert.equal(snapshot().hitchCount, 0); assert.equal(snapshot().spans.length, 0);
});

test("stop freezes elapsed time and reset rejects stale sync and async completions", async () => {
  const { profiler: p, advance, snapshot } = fixture(); p.start();
  let resolve;
  const pending = p.measureAsync("old.async", () => new Promise((done) => { resolve = done; }));
  const oldToken = p.begin("old.sync"); advance(50); p.reset();
  resolve(); await pending; p.end(oldToken);
  assert.equal(snapshot().spans.length, 0);
  p.measure("fresh", () => advance(12)); p.stop(); const saved = snapshot(); advance(5000); p.frame(6000); p.longTask(90);
  assert.deepEqual(snapshot(), saved);
  p.reset(); assert.equal(snapshot().recording, false); assert.equal(snapshot().spans.length, 0);
  assert.equal(snapshot().startedAt, null);
});

test("async measurements include waiting but do not steal synchronous self time", async () => {
  const { profiler: p, advance, snapshot } = fixture(); p.start();
  let resolve;
  const pending = p.measureAsync("load", () => new Promise((done) => { resolve = done; }));
  p.measure("paint", () => advance(10)); advance(100); resolve(); await pending;
  const rows = snapshot().spans;
  assert.equal(rows.find((row) => row.name === "load").meanMs, 110);
  assert.equal(rows.find((row) => row.name === "load").selfMs, 0);
  assert.equal(rows.find((row) => row.name === "paint").selfMs, 10);
});

test("scope counts and rolling distributions remain bounded and snapshots are detached", () => {
  const { profiler: p, advance, snapshot } = fixture(); p.start();
  for (let i = 0; i < 300; i++) p.measure("paint", () => advance(i < 120 ? 100 : 2));
  for (let i = 0; i < 100; i++) p.measure(`scope.${i}`, () => advance(1));
  const result = snapshot();
  assert.equal(result.spans.length, 64); assert.equal(result.droppedScopes, 37);
  const paint = result.spans.find((row) => row.name === "paint");
  assert.equal(paint.p95Ms, 2); assert.equal(paint.maxMs, 100); assert.equal(paint.count, 300);
  const saved = p.snapshot(); saved.spans[0].count = -1; saved.incidents[0].name = "mutated"; saved.limits.frames = 1;
  assert.equal(snapshot().spans.find((row) => row.name === "paint").count, 300);
  assert.notEqual(snapshot().incidents[0].name, "mutated"); assert.equal(snapshot().limits.frames, 900);
});

test("long tasks omit pre-capture entries and attach nearby static scope evidence to hitches", () => {
  const { profiler: p, at, advance, snapshot } = fixture(); at(100); p.start(); p.frame(100);
  p.longTask(75, 20); p.longTask(30, 100); p.longTask(NaN, 100);
  p.measure("command.layout", () => advance(70)); p.frame(170); p.longTask(70, 100);
  const result = snapshot(); assert.equal(result.longTaskCount, 1);
  const hitch = result.incidents.find((row) => row.kind === "frame");
  assert.deepEqual(hitch.recentScopes, [{ name: "command.layout", durationMs: 70 }]);
  const mutable = p.snapshot(); mutable.incidents.find((row) => row.kind === "frame").recentScopes[0].name = "changed";
  assert.equal(snapshot().incidents.find((row) => row.kind === "frame").recentScopes[0].name, "command.layout");
  mutable.frames[0].durationMs = 9000;
  assert.equal(snapshot().frameStats.maxMs, 70);
});

test("misordered scope tokens discard the incomplete subtree instead of inventing self time", () => {
  const { profiler: p, advance, snapshot } = fixture(); p.start();
  const outer = p.begin("outer"), inner = p.begin("inner"); advance(5); p.end(outer); p.end(inner);
  assert.equal(snapshot().spans.length, 0);
  p.measure("next", () => advance(3)); assert.equal(snapshot().spans[0].selfMs, 3);
});
