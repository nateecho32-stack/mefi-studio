// The Skills page's files, JavaScript (scripts/skills.cjs with skill-format.cjs)
// against Rust (crates/mefi-core skills, docs/rust-migration.md stage 2): the
// same format rules on the same text, and the same steps on two identical
// project trees must give the same answers and leave the same files. Needs
// npm run host:core; skips without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { coreBinary } from "../scripts/rust-host.mjs";

const require = createRequire(import.meta.url);
const format = require("../scripts/skill-format.cjs");
const { createSkills } = require("../scripts/skills.cjs");
const binary = coreBinary();
const skip = existsSync(binary) ? false : `mefi-core is not built (${binary}); run npm run host:core`;
const CONST = (value) => ({ $mefi: "const", value });

function rust(calls) {
  const result = spawnSync(binary, ["repo-batch"], { input: JSON.stringify(calls), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).map((answer) => {
    assert.equal(answer.ok, true, answer.error);
    return answer.value;
  });
}

const TEXTS = [
  "", "no front matter at all\n# Title\nbody", "---\nname: a\n", "---\r\nname: crlf-skill\r\ndescription: Works with CRLF\r\n---\r\n\r\nBody\r\n",
  "﻿---\nname: bom\ndescription: has a BOM\n---\nbody",
  "---\nname: \"quoted\"\ndescription: \"Say \\\"hi\\\" when asked\"\nallowed-tools: Bash, Read\n  - nested\n---\n\nSteps\n\n",
  "---\nname: 'single'\ndescription: 'It''s fine'\n---\nx",
  "---\nname: folded\ndescription: >\n  A long line\n  that folds\n---\n\n## Heading\n- item",
  "---\nname: literal\ndescription: |-\n  keep\n  this\nmodel: x\n---\n",
  "---\n  indented first\nname: late\n---\nbody", "---   \ndescription: no name\n---   \n\n\n# Just a heading\nThen words",
  "---\nname: bad\"json\ndescription: \"unclosed\n---\nx", "---\nname: x\ndescription: émoji 😀 and 日本語\n---\n" + "長い".repeat(200),
];
const DRAFTS = [
  { name: "good-one", description: "Use when good.", body: "Do it." },
  { name: "Bad Name", description: "x", body: "y" }, { name: "con", description: "x", body: "y" }, { name: "", description: "", body: "" },
  { name: "a".repeat(65), description: "x", body: "y" }, { name: "ok", description: "x".repeat(301), body: "y" },
  { name: "ok", description: "two\nlines", body: "y" }, { name: "ok", description: "bell\u0007", body: "y" }, { name: "ok", description: "tab\tok", body: "y" },
  { name: "ok", description: "has: colon", body: "y" }, { name: "ok", description: "yes", body: "y" }, { name: "ok", description: "#tag", body: "y" },
  { name: "ok", description: "(paren) start", body: "y" }, { name: "ok", description: " spaced ", body: "\n\n  body  \n\n" },
  { name: "ok", description: "x", body: "nul\u0000" }, { name: "ok", description: "x", body: "é".repeat(16001) }, { name: "ok", description: "x", body: "a".repeat(32001) },
  { name: "ok", description: "x", body: "b".repeat(31900) }, { name: "ok", description: "x", body: "y", extra: "allowed-tools: Bash\n\n" },
  { name: "ok", description: 42, body: ["not text"] }, { name: 7, description: "x", body: "y" },
];

test("skill-format reads, checks and describes the same in both languages", { skip }, () => {
  const names = ["good", "a", "a-b-1", "", "A", "-lead", "a_b", "con", "lpt9", "com0", "x".repeat(64), "x".repeat(65), null, 5];
  const calls = [
    ...TEXTS.map((text) => ({ function: "skills.format.parse", args: [text] })),
    ...TEXTS.map((text) => ({ function: "skills.format.describe", args: [text] })),
    ...DRAFTS.map((draft) => ({ function: "skills.format.check", args: [draft] })),
    ...names.map((name) => ({ function: "skills.format.nameProblem", args: [name] })),
  ];
  const answers = rust(calls);
  let at = 0;
  for (const text of TEXTS) assert.deepEqual(answers[at++], format.parse(text), `parse ${JSON.stringify(text).slice(0, 60)}`);
  for (const text of TEXTS) assert.equal(answers[at++], format.describe(text), `describe ${JSON.stringify(text).slice(0, 60)}`);
  for (const draft of DRAFTS) assert.deepEqual(answers[at++], format.check(draft), `check ${JSON.stringify(draft).slice(0, 80)}`);
  for (const name of names) assert.equal(answers[at++], format.nameProblem(name), `nameProblem ${name}`);
});

// One side's folders: the project, the safety folder, a folder to import from and a place to export to.
function side(base) {
  const project = path.join(base, "project");
  const backups = path.join(base, "backups");
  const source = path.join(base, "source");
  const elsewhere = path.join(base, "elsewhere");
  for (const dir of [project, source, path.join(source, "not-front"), elsewhere]) mkdirSync(dir, { recursive: true });
  const write = (relative, text) => {
    const file = path.join(project, ...relative.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  writeFileSync(path.join(source, "SKILL.md"), "---\nname: imported\ndescription: From a folder\nallowed-tools: Read\n---\n\nImported body\n");
  writeFileSync(path.join(source, "notes.txt"), "extra");
  writeFileSync(path.join(source, "not-front", "SKILL.md"), "just text");
  writeFileSync(path.join(elsewhere, "SKILL.md"), "---\nname: elsewhere\ndescription: x\n---\nx");
  return { project, backups, source, elsewhere, write };
}

const STEPS = [
  ["list"],
  ["create", { name: "first-skill", description: "Use for the first test.", body: "Step one.\nStep two." }],
  ["create", { name: "Bad Name", description: "x", body: "y" }],
  ["create", { name: "no-desc", description: "", body: "y" }],
  ["create", { name: "first-skill", description: "again", body: "dup" }],
  ["hand"],
  ["list"],
  ["read", "first-skill"], ["read", "missing-one"], ["read", "Nope"], ["read", "too-big"], ["read", "with-extra"],
  ["save", { name: "with-extra", description: "Now described", body: "New body" }],
  ["save", { name: "with-extra", description: "Now described", body: "New body" }],
  ["save", { name: "missing-one", description: "x", body: "y" }],
  ["save", { name: "first-skill", description: "", body: "y" }],
  ["delete", "no-front"], ["delete", "kept-file"], ["delete", "missing-one"],
  ["importFrom", "@source"], ["importFrom", "@source"], ["importFrom", "@source/not-front"], ["importFrom", "@source/notes.txt"], ["importFrom", "relative/path"],
  ["exportTo", { name: "first-skill", target: "@out/first" }], ["exportTo", { name: "first-skill", target: "@out/first" }],
  ["exportTo", { name: "first-skill", target: "relative" }], ["exportTo", { name: "first-skill", target: "@out/missing-parent/x" }],
  ["list"],
];

function prepareHand(write, project) {
  write(".agents/skills/no-front/SKILL.md", "plain text, no front matter\n");
  write(".agents/skills/mismatch/SKILL.md", "---\nname: other-name\ndescription: x\n---\nbody");
  write(".agents/skills/described-by-body/SKILL.md", "---\nname: described-by-body\n---\n\n## How to\nUse it when needed.");
  write(".agents/skills/too-big/SKILL.md", "x".repeat(70 * 1024));
  write(".agents/skills/over-limit/SKILL.md", `---\nname: over-limit\ndescription: big\n---\n${"y".repeat(40000)}`);
  write(".agents/skills/CamelCase/SKILL.md", "---\nname: CamelCase\ndescription: x\n---\nx");
  write(".agents/skills/with-extra/SKILL.md", "---\nname: with-extra\nallowed-tools: Bash, Read\nmodel: haiku\n---\n\nOld body\n");
  write(".agents/skills/kept-file/SKILL.md", "---\nname: kept-file\ndescription: x\n---\nx");
  write(".agents/skills/kept-file/script.sh", "echo hi");
  write(".agents/skills/.hidden/SKILL.md", "---\nname: hidden\ndescription: x\n---\nx");
  write(".agents/skills/stray.txt", "not a skill");
  mkdirSync(path.join(project, ".agents", "skills", "empty-folder"), { recursive: true });
  try { symlinkSync(path.join(project, "..", "elsewhere"), path.join(project, ".agents", "skills", "linked"), "junction"); } catch { /* no links on this file system */ }
}

test("the Skills page's files: the same answers and the same files from both languages", { skip }, async (t) => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "mefi-parity-skills-")));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const js = side(path.join(root, "js"));
  const rs = side(path.join(root, "rs"));
  const outOf = (base) => path.join(base, "out");
  for (const base of [path.join(root, "js"), path.join(root, "rs")]) mkdirSync(outOf(base), { recursive: true });
  const inventoryRows = (project) => [
    { file: path.join(project, ".agents", "skills", "first-skill", "SKILL.md"), name: "first-skill", scope: "project" },
    { file: path.join(project, ".claude", "skills", "claude-one", "SKILL.md"), name: "claude-one", scope: "project" },
    { file: path.join(root, "home", ".codex", "skills", "home-one", "SKILL.md"), name: "home-one", scope: "home" },
  ];
  const skills = createSkills({ root: () => js.project, backups: () => js.backups, inventory: async (real) => inventoryRows(real) });
  const collaborators = { root: CONST(rs.project), enabled: CONST(true), backups: CONST(rs.backups), inventory: CONST(inventoryRows(rs.project)) };
  const at = (base, value) => (typeof value === "string" ? value.replace(/^@source/, path.join(base, "source")).replace(/^@out/, outOf(base)) : value);
  const jsBase = path.join(root, "js"), rsBase = path.join(root, "rs");
  const mask = (value, base) => JSON.parse(JSON.stringify(value, (key, item) => (key === "updatedAt" && typeof item === "number" ? "<time>" : item))
    .split(JSON.stringify(base).slice(1, -1)).join("<base>").split(base.replace(/\\/g, "/")).join("<base>"));
  for (const [index, [method, raw]] of STEPS.entries()) {
    if (method === "hand") { prepareHand(js.write, js.project); prepareHand(rs.write, rs.project); continue; }
    const jsArg = typeof raw === "object" && raw ? { ...raw, ...(raw.target ? { target: at(jsBase, raw.target) } : {}) } : at(jsBase, raw);
    const rsArg = typeof raw === "object" && raw ? { ...raw, ...(raw.target ? { target: at(rsBase, raw.target) } : {}) } : at(rsBase, raw);
    const jsAnswer = await (method === "delete" ? skills.delete(jsArg) : skills[method](jsArg));
    const [rsAnswer] = rust([{ function: `skills.${method}`, args: [collaborators, rsArg] }]);
    assert.deepEqual(mask(rsAnswer, rsBase), mask(jsAnswer, jsBase), `step ${index} ${method} ${JSON.stringify(raw)}`);
  }
  // The same files on both sides afterwards (backups by count: their names carry the time).
  const tree = (dir) => {
    const out = {};
    const walk = (current, relative) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const next = path.join(current, entry.name), name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) out[name] = "<link>";
        else if (entry.isDirectory()) walk(next, name);
        else out[name] = readFileSync(next, "utf8");
      }
    };
    walk(dir, "");
    return out;
  };
  assert.deepEqual(tree(rs.project), tree(js.project), "the project's files");
  assert.deepEqual(Object.keys(tree(outOf(rsBase))), Object.keys(tree(outOf(jsBase))), "what was exported");
  const counts = (dir) => Object.fromEntries(readdirSync(dir).map((name) => [name, readdirSync(path.join(dir, name)).length]));
  assert.deepEqual(counts(rs.backups), counts(js.backups), "the safety copies, per skill");
});

test("refusals: no project, the switch off, and .agents as a link", { skip }, async (t) => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "mefi-parity-skills-refuse-")));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const project = path.join(root, "project"), elsewhere = path.join(root, "elsewhere");
  mkdirSync(project, { recursive: true });
  mkdirSync(elsewhere, { recursive: true });
  let linked = true;
  try { symlinkSync(elsewhere, path.join(project, ".agents"), "junction"); } catch { linked = false; }
  const cases = [
    { collaborators: { root: CONST(null) }, js: { root: () => null }, method: "list", arg: undefined },
    { collaborators: { root: CONST(path.join(root, "gone")) }, js: { root: () => path.join(root, "gone") }, method: "list", arg: undefined },
    { collaborators: { root: CONST(project), enabled: CONST(false) }, js: { root: () => project, enabled: () => false }, method: "create", arg: { name: "x", description: "y", body: "z" } },
    { collaborators: { root: CONST(project), enabled: CONST(false) }, js: { root: () => project, enabled: () => false }, method: "list", arg: undefined },
    ...(linked ? [
      { collaborators: { root: CONST(project) }, js: { root: () => project }, method: "list", arg: undefined },
      { collaborators: { root: CONST(project) }, js: { root: () => project }, method: "create", arg: { name: "x", description: "y", body: "z" } },
    ] : []),
  ];
  for (const [index, item] of cases.entries()) {
    const host = createSkills(item.js);
    const jsAnswer = await (item.arg === undefined ? host[item.method]() : host[item.method](item.arg));
    const [rsAnswer] = rust([{ function: `skills.${item.method}`, args: [item.collaborators, ...(item.arg === undefined ? [] : [item.arg])] }]);
    assert.deepEqual(rsAnswer, jsAnswer, `case ${index}`);
  }
});
