// Behavioral regression tests for the temporal-overlap boundary cases in
// scripts/eyes.mjs: adjacent windows that touch at one instant, a gap of
// exactly overlapMs (inclusive) vs one just past it (excluded), a fully
// contained window intersecting to the inner session's span, a three-session
// nested group whose common intersection collapses to the innermost single
// instant, zero-length single-edit pairs, and overlapRangeOf's validation
// (corrupt/NaN/inverted windows normalize to null; zero-length stays real).
// Mirrors the Python boundary contract (tools/test_mefi_studio_eyes.py) at the
// npm-test layer, driving the real collisions() over a fixture OpenCode store.
//
// Run: node --test tests/eyes_overlap_boundaries.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collisions, overlapRangeOf, closeReadDb } from "../scripts/eyes.mjs";

const NOW = 1_800_000_000_000;
const OVERLAP_MS = 10 * 60 * 1000;

const dirs = [];

function edit(partId, sessionId, fileName, at) {
  return [
    partId,
    `msg_${partId}`,
    sessionId,
    at,
    at,
    JSON.stringify({
      type: "tool",
      tool: "edit",
      state: {
        status: "completed",
        input: { filePath: `C:/fixture/${fileName}` },
        metadata: { diff: "--- a\n+++ b\n@@\n+bound" },
      },
    }),
  ];
}

function boundaryDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "mefi-overlap-"));
  dirs.push(dir);
  const dbPath = path.join(dir, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    create table session (
      id text primary key, parent_id text, title text, agent text,
      model text, directory text, cost real, tokens_input integer,
      tokens_output integer, tokens_cache_read integer, summary_files integer,
      summary_additions integer, summary_deletions integer,
      time_created integer, time_updated integer
    );
    create table todo (
      session_id text, content text, status text, priority text,
      position integer, time_created integer, time_updated integer
    );
    create table part (
      id text primary key, message_id text, session_id text,
      time_created integer, time_updated integer, data text
    );
  `);
  const parts = [
    // Adjacent: s2 starts the instant s1 stops — the shared window is
    // zero-length but real.
    edit("b_adj_a1", "s1_adj", "adjacent.lua", NOW - 120_000),
    edit("b_adj_a2", "s1_adj", "adjacent.lua", NOW - 60_000),
    edit("b_adj_b1", "s2_adj", "adjacent.lua", NOW - 60_000),
    // Inclusive boundary: a gap of exactly overlapMs still collides, but the
    // windows share no point, so the overlap window is inverted.
    edit("b_exact_a", "s1_exact", "exactgap.lua", NOW - 1_200_000),
    edit("b_exact_b", "s2_exact", "exactgap.lua", NOW - 600_000),
    // One millisecond past overlapMs: a stale hand-off, not a collision.
    edit("b_past_a", "s1_past", "pastgap.lua", NOW - 1_200_001),
    edit("b_past_b", "s2_past", "pastgap.lua", NOW - 600_000),
    // Contained: the shared window is exactly the inner session's span.
    edit("b_cont_a1", "s1_cont", "contained.lua", NOW - 300_000),
    edit("b_cont_a2", "s1_cont", "contained.lua", NOW),
    edit("b_cont_b1", "s2_cont", "contained.lua", NOW - 200_000),
    edit("b_cont_b2", "s2_cont", "contained.lua", NOW - 150_000),
    // Nested three-session group: outer ⊃ mid ⊃ tip; the common intersection
    // is the innermost session's single instant.
    edit("b_nest_o1", "s3_outer", "nested3.lua", NOW - 300_000),
    edit("b_nest_o2", "s3_outer", "nested3.lua", NOW),
    edit("b_nest_m1", "s3_mid", "nested3.lua", NOW - 200_000),
    edit("b_nest_m2", "s3_mid", "nested3.lua", NOW - 50_000),
    edit("b_nest_t1", "s3_tip", "nested3.lua", NOW - 100_000),
    // Zero-length: two sessions edit at the same single instant.
    edit("b_inst_a", "s1_inst", "instant.lua", NOW - 45_000),
    edit("b_inst_b", "s2_inst", "instant.lua", NOW - 45_000),
  ];
  const insert = db.prepare("insert into part values (?,?,?,?,?,?)");
  for (const row of parts) insert.run(...row);
  db.close();
  return dbPath;
}

function groupByFile(groups, file) {
  return groups.find((group) => group.file === file);
}

test.after(() => {
  closeReadDb();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
});

test("temporal-overlap boundary cases collide, group and window exactly as pinned", () => {
  const groups = collisions({ dbPath: boundaryDb(), now: NOW });

  const adjacent = groupByFile(groups, "C:/fixture/adjacent.lua");
  assert.ok(adjacent, "adjacent windows touching at one instant stay a collision");
  assert.deepEqual(adjacent.overlap, { first: NOW - 60_000, last: NOW - 60_000 }, "the adjacent shared window is zero-length, not inverted");
  assert.ok(overlapRangeOf(adjacent), "a zero-length adjacent window is a real clash overlapRangeOf keeps");

  const exact = groupByFile(groups, "C:/fixture/exactgap.lua");
  assert.ok(exact, "a gap of exactly overlapMs is inside the window (inclusive boundary)");
  assert.ok(exact.overlap.first > exact.overlap.last, "an inclusive-gap pair never co-edited: its window is inverted");
  assert.equal(overlapRangeOf(exact), null, "an inverted window validates to null so prompts cite edit spans instead");

  assert.ok(!groupByFile(groups, "C:/fixture/pastgap.lua"), "a gap one ms past overlapMs is a stale hand-off, not a collision");

  const contained = groupByFile(groups, "C:/fixture/contained.lua");
  assert.ok(contained, "a fully contained window stays a collision");
  assert.deepEqual(contained.overlap, { first: NOW - 200_000, last: NOW - 150_000 }, "the contained shared window is the inner session's span, not the outer");

  const nested = groupByFile(groups, "C:/fixture/nested3.lua");
  assert.ok(nested, "a nested three-session group forms one collision");
  assert.equal(nested.sessions.length, 3, "all three nested sessions join one group");
  assert.deepEqual(nested.overlap, { first: NOW - 100_000, last: NOW - 100_000 }, "the nested group's common intersection is the innermost single instant");

  const instant = groupByFile(groups, "C:/fixture/instant.lua");
  assert.ok(instant, "two same-instant single edits are the smallest real collision");
  assert.deepEqual(instant.overlap, { first: NOW - 45_000, last: NOW - 45_000 });
  assert.deepEqual(overlapRangeOf(instant), { first: NOW - 45_000, last: NOW - 45_000 }, "a single-instant window survives validation");
});

test("overlapRangeOf normalizes corrupt windows to null and keeps real ones", () => {
  assert.equal(overlapRangeOf(null), null);
  assert.equal(overlapRangeOf(undefined), null);
  assert.equal(overlapRangeOf("nope"), null);
  assert.equal(overlapRangeOf({}), null, "a missing window is not a range");
  assert.equal(overlapRangeOf({ overlap: { first: NaN, last: NOW } }), null, "NaN first end normalizes to null");
  assert.equal(overlapRangeOf({ overlap: { first: NOW, last: "later" } }), null, "a non-numeric last end normalizes to null");
  assert.equal(overlapRangeOf({ overlap: { first: 200, last: 100 } }), null, "an inverted window is a hand-off span, not a shared window");
  assert.deepEqual(overlapRangeOf({ overlap: { first: 100, last: 100 } }), { first: 100, last: 100 }, "zero-length windows stay real");
  assert.deepEqual(overlapRangeOf({ overlap: { first: 100, last: 200 } }), { first: 100, last: 200 });
});
