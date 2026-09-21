import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { cascadeEquivalence, cascadeWinners } from "../scripts/check-css.mjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(STUDIO, "scripts", "check-css.mjs");
const execFileP = promisify(execFile);

const BASE = `:root { --ink: #111; }
.a { color: red; color: blue; }
.b, .c { margin: 0; }
@media (min-width: 40em) { .a { color: green; } }
.a { color: teal !important; }
@keyframes spin { from { opacity: 0; } to { opacity: 1; } }
`;

test("identical stylesheets are cascade-equivalent", () => {
  const { problems, totalBase } = cascadeEquivalence(BASE, BASE);
  assert.equal(problems.length, 0);
  assert.ok(totalBase > 0);
});

test("winners collapse shadowed declarations: removing a dead duplicate is equivalent", () => {
  const { problems } = cascadeEquivalence(BASE, BASE.replace("color: red; color: blue;", "color: blue;"));
  assert.equal(problems.length, 0);
});

test("removing a live winner is a missing-winner mismatch", () => {
  const pruned = BASE.replace(".b, .c { margin: 0; }", "");
  const { problems } = cascadeEquivalence(BASE, pruned);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, "missing");
  assert.match(problems[0].key, /\.b\|\|\|\.c##margin##-/);
});

test("changed winner value is a changed mismatch", () => {
  const { problems } = cascadeEquivalence(BASE, BASE.replace("color: blue;", "color: purple;"));
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, "changed");
  assert.equal(problems[0].base, "blue");
  assert.equal(problems[0].head, "purple");
});

test("a brand-new winner in the candidate is reported", () => {
  const { problems } = cascadeEquivalence(BASE, BASE + ".zzz { top: 1px; }");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, "new");
});

test("@media context and importance tiers are separate cascade keys", () => {
  const winners = cascadeWinners(BASE);
  assert.equal(winners.get(".a##color##-").val, "blue");
  assert.equal(winners.get("@media (min-width: 40em)::.a##color##-").val, "green");
  assert.equal(winners.get(".a##color##!").val, "teal");
  assert.equal(winners.size, 5);
});

test("@keyframes internals are not treated as cascade winners", () => {
  const withoutKeyframes = cascadeEquivalence(BASE, BASE.replace("@keyframes spin { from { opacity: 0; } to { opacity: 1; } }", ""));
  assert.equal(withoutKeyframes.problems.length, 0);
});

test("selector list order does not matter, membership does", () => {
  const { problems } = cascadeEquivalence(".b, .c { margin: 0; }", ".c, .b { margin: 0; }");
  assert.equal(problems.length, 0);
});

test("comments and whitespace do not affect equivalence", () => {
  const { problems } = cascadeEquivalence(
    "/* lead */ .a { color: /* mid */ red; }",
    ".a {\n  color: red; /* trail */\n}"
  );
  assert.equal(problems.length, 0);
});

test("CRLF candidate is equivalent to its LF base (autocrlf checkouts)", () => {
  const { problems, totalBase, totalHead } = cascadeEquivalence(BASE, BASE.replace(/\n/g, "\r\n"));
  assert.equal(problems.length, 0);
  assert.equal(totalBase, totalHead);
});

test("a real winner change still diverges through CRLF line endings", () => {
  const { problems } = cascadeEquivalence(BASE, BASE.replace("color: blue;", "color: purple;").replace(/\n/g, "\r\n"));
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, "changed");
  assert.equal(problems[0].head, "purple");
});

test("CLI: equivalent pair exits 0, divergent pair exits 1, bad input exits 2", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "check-css-"));
  try {
    const base = path.join(dir, "base.css");
    const same = path.join(dir, "same.css");
    const diverged = path.join(dir, "diverged.css");
    await writeFile(base, BASE);
    await writeFile(same, BASE.replace("color: red; color: blue;", "color: blue;"));
    await writeFile(diverged, BASE.replace("margin: 0;", ""));

    const ok = await execFileP(process.execPath, [CLI, base, same]);
    assert.match(ok.stdout, /CASCADE-EQUIVALENT/);

    await assert.rejects(
      execFileP(process.execPath, [CLI, base, diverged]),
      (err) => err.code === 1 && /CASCADE-DIVERGED/.test(err.stderr + err.stdout)
    );

    await assert.rejects(
      execFileP(process.execPath, [CLI, base, path.join(dir, "nope.css")]),
      (err) => err.code === 2
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI: CRLF candidate file against an LF base file exits 0", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "check-css-crlf-"));
  try {
    const base = path.join(dir, "base.css");
    const crlf = path.join(dir, "crlf.css");
    await writeFile(base, BASE);
    await writeFile(crlf, BASE.replace(/\n/g, "\r\n"));
    const ok = await execFileP(process.execPath, [CLI, base, crlf]);
    assert.match(ok.stdout, /CASCADE-EQUIVALENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI: default mode compares renderer/styles.css against HEAD", async () => {
  const res = await execFileP(process.execPath, [CLI], { cwd: STUDIO }).catch((err) => err);
  const out = res.stdout + res.stderr;
  const code = res.code ?? 0;
  if (code === 0) assert.match(res.stdout, /CASCADE-EQUIVALENT/);
  else assert.equal(code, 1);
  assert.match(out, /CASCADE-(EQUIVALENT|DIVERGED)/);
});
