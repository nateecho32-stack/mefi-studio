// Pins the scope decision of scripts/check-testruns.mjs (2026-09-22,
// run_1790106278990_28): newest-first ordering is enforced only in the live
// region above "## Read Before Any Tests"; the archive below that anchor is
// blessed to keep its historical order, including undated reference sections
// and oldest-first narrative tails. These tests exist so a future session
// cannot quietly "fix" the archive exemption back on.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditTestruns } from "../scripts/check-testruns.mjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function notebook(body) {
  return `# Test Runs

## How to read this file

preamble

### Known environmental failures

| Suite | Symptom |
| --- | --- |

${body}`;
}

// Live region newest-first (2026-09-22 above 2026-09-21); archive below the
// anchor runs oldest-first with an undated reference section interleaved -
// the exact pattern that must stay exempt.
const CLEAN = notebook(`## 2026-09-22 b

b body

## 2026-09-21 a

a body

## Read Before Any Tests

guide text

## 2026-09-19 z

z body

## Python contracts

doc text

## 2026-09-20 y

y body
`);

async function withRoot(t, text, extraFiles = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "check-testruns-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "TESTRUNS.md"), text, "utf8");
  for (const [name, content] of Object.entries(extraFiles)) {
    await writeFile(path.join(root, name), content, "utf8");
  }
  return root;
}

test("clean file passes with live rows counted above the anchor only", async (t) => {
  const root = await withRoot(t, CLEAN);
  const { problems, rows } = auditTestruns(root);
  assert.deepEqual(problems, []);
  assert.equal(rows, 2);
});

test("archive rows below the anchor are exempt from newest-first (the blessed skip)", async (t) => {
  // Same file, but the archive inversion is made flagrant: newest (09-22)
  // sits at the very bottom below oldest (09-19). Still must pass.
  const inverted = notebook(`## 2026-09-22 b

b body

## 2026-09-21 a

a body

## Read Before Any Tests

guide text

## 2026-09-19 z

z body

## 2026-09-20 y

y body

## 2026-09-22 newest-at-bottom

bottom body
`);
  const root = await withRoot(t, inverted);
  const { problems, rows } = auditTestruns(root);
  assert.deepEqual(problems, []);
  assert.equal(rows, 2);
});

test("stale-anchor append in the live region is flagged", async (t) => {
  const staleAnchor = notebook(`## 2026-09-21 a

a body

## 2026-09-22 b

b body

## Read Before Any Tests

guide text
`);
  const root = await withRoot(t, staleAnchor);
  const { problems } = auditTestruns(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /stale-anchor append, move it newest-first/);
});

test("undated H2 below the anchor is fine, but in the live region it fails", async (t) => {
  const liveDoc = notebook(`## 2026-09-22 b

b body

## Python contracts

doc in live region

## 2026-09-21 a

a body

## Read Before Any Tests

guide text
`);
  const root = await withRoot(t, liveDoc);
  const { problems } = auditTestruns(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /non-row H2 inside the live run region: Python contracts/);
});

test("missing anchor heading fails loudly instead of rescoping enforcement", async (t) => {
  const noAnchor = notebook(`## 2026-09-22 b

b body

## 2026-09-21 a

a body
`);
  const root = await withRoot(t, noAnchor);
  const { problems } = auditTestruns(root);
  assert.ok(problems.some((p) => /anchor heading is missing - live\/archive boundary undefined/.test(p)));
});

test("duplicate H2 headings are flagged wherever they sit", async (t) => {
  const dup = notebook(`## 2026-09-22 b

b body

## 2026-09-22 b

b body again

## 2026-09-21 a

a body

## Read Before Any Tests

guide text
`);
  const root = await withRoot(t, dup);
  const { problems } = auditTestruns(root);
  assert.ok(problems.some((p) => /duplicate H2/.test(p)));
});

test("OneDrive conflict-copy siblings are flagged", async (t) => {
  const root = await withRoot(t, CLEAN, { "TESTRUNS-DESKTOP-ABC (1).md": "stale copy" });
  const { problems } = auditTestruns(root);
  assert.ok(problems.some((p) => /conflict-copy sibling of TESTRUNS\.md/.test(p)));
});

test("the file must end with exactly one newline", async (t) => {
  const doubled = CLEAN + "\n";
  const root = await withRoot(t, doubled);
  const { problems } = auditTestruns(root);
  assert.ok(problems.some((p) => /must end with exactly one newline/.test(p)));
});

test("the real repository notebook passes the audit", () => {
  const { problems, rows } = auditTestruns(STUDIO);
  assert.deepEqual(problems, []);
  assert.ok(rows > 0);
});
