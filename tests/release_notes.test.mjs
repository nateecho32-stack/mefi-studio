// scripts/release-notes.mjs: assets/whats-new.json from the changelog's version
// sections. A fixture CHANGELOG pins each rule (dated sections only, the bold
// lead, the label fallback, the markers that keep a bullet out, the sentence
// override, the caps and the order), the CLI's write and `--check` modes run for
// real against a temp checkout, and one test runs `--check` on this repository,
// so cutting a version without regenerating the file fails the gate.
//
// Run: node --test tests/release_notes.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTable, check, generate, parseChangelog, sentenceOf, serialize, skipReason } from "../scripts/release-notes.mjs";
import notes from "../scripts/whats-new.cjs";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(studio, "scripts", "release-notes.mjs");

const CHANGELOG = `# Changelog

Intro text that is not a section.

## [Unreleased]

- **This is next, and it is not a version yet.** Nothing here ships in the table.

## [0.4.4] - 2026-09-27

- **The Void collection is free.** Its four themes sit in every install.
- **Trace** (Live, beside Activity): Studio's logs as channels in one viewer. It searches and tails them.
- A bullet with no bold lead is written for maintainers, so it says nothing here.

## [0.5.0] - 2026-10-01

### Added

- **Windows tells you when something needs you.** It only speaks while Studio is in the background,
  and it never speaks inside quiet hours.
- **Report a problem builds a small zip you read first.** It is saved where you choose, with [a link](https://example.invalid) and \`code\` and *emphasis* in it.
- **The interface scale is remembered.** It walks the same 70% to 150% ladder as the slider.
- **New tab strip** beside the project picker: pin the pages you use, and the rest comes and goes.
- **Internal: the booklet builder reads a new file.** Only maintainers care.
- **Tests: the notes generator has a fixture.** Only maintainers care.
- **A marked bullet is left out.** <!-- internal -->
- **Custom words win.** The long sentence here is ignored. <!-- notes: Studio starts a little quicker. -->
- **A bullet that opts out.** <!-- notes: none -->
- **The updater lives in scripts/release-updater.mjs.** That names a file, so it is not for the person using the app.
- **Sixth.** Not a sentence with enough words? It is three words, so it stays out.
- **Seventh worthwhile change is listed.** It comes after the sixth bullet that counts.
- **Eighth worthwhile change is listed.** Cut by the cap.
- **Ninth worthwhile change is listed.** Cut by the cap.

### Internal

- **Everything under this heading is for maintainers.** It is never shown.

### Fixed

- **A fix the owner can feel.** It goes in the table.

## [0.3.9] - 2026-09-01

- Only bullets without a bold lead here, so this version has no notes and is left out.

## [0.4.5] - 2026-09-28

- **This one has a date but only an internal note.** <!-- internal -->

## [0.3.0] - 2026-08-01

- **Ancient change that is a real sentence.** Old text follows here.
- **Second ancient change is a real sentence.** More text.

## [0.2.9] - 2026-07-30

- **Older than the cap allows, so it drops out.** Extra text.

## [0.2.8] - 2026-07-29

- **Even older change that also drops out.** Extra text.

## [0.2.0] - 2026-07-01

- **Oldest change that certainly drops out.** Extra text.
`;

async function checkout(t, { changelog = CHANGELOG, notes = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "mefi-notes-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }));
  await writeFile(path.join(root, "CHANGELOG.md"), changelog);
  if (notes !== null) { await mkdir(path.join(root, "assets"), { recursive: true }); await writeFile(path.join(root, "assets", "whats-new.json"), notes); }
  return root;
}
const cli = (root, ...args) => spawnSync(process.execPath, [script, "--root", root, ...args], { encoding: "utf8" });

test("only dated version sections count, newest first, each with the sentences its bullets give", () => {
  const table = buildTable(CHANGELOG);
  assert.deepEqual(Object.keys(table), ["0.5.0", "0.4.4", "0.3.0", "0.2.9", "0.2.8"], "[Unreleased] is not a version, 0.3.9 and 0.4.5 have nothing to say, and the newest five stay");
  assert.deepEqual(table["0.4.4"], [
    "The Void collection is free.",
    "Trace (Live, beside Activity): Studio's logs as channels in one viewer.",
  ], "a bold sentence is the sentence; a bold label joins the bullet's first sentence; a bullet without a bold lead says nothing");
  assert.deepEqual(table["0.3.0"], ["Ancient change that is a real sentence.", "Second ancient change is a real sentence."]);
});

test("[Unreleased] never reaches the table, even when it would fit under the cap", () => {
  const table = buildTable("## [Unreleased]\n\n- **Next thing is not out yet.** More words.\n\n## [1.0.0] - 2026-01-01\n\n- **First release note is here.** More words.\n");
  assert.deepEqual(table, { "1.0.0": ["First release note is here."] });
  assert.deepEqual(buildTable("## [Unreleased]\n\n- **Only unreleased work exists so far.** More.\n"), {}, "and a changelog with nothing released yields an empty table");
  assert.deepEqual(buildTable("## [1.0.0]\n\n- **A section with no date is not released.** More.\n"), {}, "a version with no date is not released either");
});

test("a section reads its bullets across lines, strips markdown and keeps the changelog's order", () => {
  const section = parseChangelog(CHANGELOG).find((row) => row.version === "0.5.0");
  assert.equal(section.date, "2026-10-01");
  assert.match(section.bullets[0].text, /^\*\*Windows tells you when something needs you\.\*\* It only speaks while Studio is in the background, and it never speaks inside quiet hours\.$/, "a wrapped bullet is one line of text");
  assert.equal(section.bullets[0].sub, "Added");
  const table = buildTable(CHANGELOG);
  assert.equal(table["0.5.0"][0], "Windows tells you when something needs you.");
  assert.equal(table["0.5.0"][1], "Report a problem builds a small zip you read first.");
  assert.doesNotMatch(table["0.5.0"].join(" "), /[`*]|\]\(|<!--/, "no markdown reaches the app");
});

test("what is marked internal, names a file or has no sentence stays out; a notes comment says the sentence itself", () => {
  const table = buildTable(CHANGELOG);
  const said = table["0.5.0"].join("\n");
  assert.doesNotMatch(said, /booklet builder|notes generator|marked bullet|for maintainers|updater lives|This one has a date/i);
  assert.match(said, /Studio starts a little quicker\./, "<!-- notes: ... --> replaces the lead");
  assert.doesNotMatch(said, /Custom words win|The long sentence/);
  assert.doesNotMatch(said, /opts out/, "<!-- notes: none --> keeps a bullet out");
  assert.doesNotMatch(said, /Sixth\./, "a lead of fewer than three words is not a sentence");
  assert.equal(skipReason({ text: "**Internal: x.**", sub: "" }), "internal lead");
  assert.equal(skipReason({ text: "**Tests:** y", sub: "" }), "internal lead");
  assert.equal(skipReason({ text: "**Tests now run faster.** z", sub: "" }), null, "a sentence that starts with the word Tests is still a sentence");
  assert.equal(skipReason({ text: "**x.**", sub: "Internal" }), "internal heading");
  assert.equal(skipReason({ text: "**x.** <!-- INTERNAL -->", sub: "" }), "marked internal");
  assert.equal(sentenceOf({ text: "no bold at all", sub: "" }), null);
  assert.equal(sentenceOf({ text: "**Only a label**", sub: "" }), null, "a label with nothing after it says nothing");
});

test("each version keeps a few sentences, and the table keeps a few versions", () => {
  const table = buildTable(CHANGELOG);
  assert.equal(table["0.5.0"].length, 6, "six sentences at most, in changelog order");
  assert.equal(table["0.5.0"][5], "Seventh worthwhile change is listed.");
  assert.ok(!table["0.5.0"].includes("Eighth worthwhile change is listed."), "the eighth is cut by the cap");
  assert.equal(Object.keys(table).length, 5);
  assert.ok(!("0.2.0" in table), "the oldest falls out");
  const wide = buildTable(CHANGELOG, { versions: 2, cap: 1 });
  assert.deepEqual(wide, { "0.5.0": ["Windows tells you when something needs you."], "0.4.4": ["The Void collection is free."] });
});

test("a long label sentence is cut where a clause ends, not in the middle of a thought", () => {
  const long = `## [1.0.0] - 2026-01-01\n\n- **New app** beside the picker: name it and say what it should be, and Studio makes an empty folder under Mefi Apps in your home folder, starts git in it, opens it as the project and sends the description as the first request.\n`;
  const [line] = buildTable(long)["1.0.0"];
  assert.ok(line.length <= 200, `${line.length} characters`);
  assert.match(line, /^New app beside the picker: name it and say what it should be\.$|starts git in it\.$/);
  assert.doesNotMatch(line, /…$/);
});

test("the CLI writes the file, says when it changed, and --print writes nothing", async (t) => {
  const root = await checkout(t);
  const first = cli(root);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /assets[\\/]whats-new\.json: 0\.5\.0, 0\.4\.4, 0\.3\.0, 0\.2\.9, 0\.2\.8 \(updated\)/);
  const written = await readFile(path.join(root, "assets", "whats-new.json"), "utf8");
  assert.equal(written, serialize(buildTable(CHANGELOG)));
  assert.ok(written.endsWith("}\n"), "the file ends with a newline");
  const again = cli(root);
  assert.match(again.stdout, /already current/);
  const printed = cli(root, "--print");
  assert.equal(printed.stdout, written);
  const bare = await mkdtemp(path.join(tmpdir(), "mefi-notes-"));
  t.after(() => rm(bare, { recursive: true, force: true }));
  await writeFile(path.join(bare, "CHANGELOG.md"), CHANGELOG);
  const outcome = await generate({ root: bare });
  assert.equal(outcome.changed, true);
  assert.deepEqual(outcome.versions, ["0.5.0", "0.4.4", "0.3.0", "0.2.9", "0.2.8"]);
  await assert.rejects(() => generate({ root: path.join(bare, "nowhere") }), /CHANGELOG\.md not found/);
});

test("--check passes on a fresh file and fails, naming the versions, on a stale, missing or torn one", async (t) => {
  const root = await checkout(t);
  cli(root);
  const fine = cli(root, "--check");
  assert.equal(fine.status, 0, fine.stderr);
  assert.match(fine.stdout, /matches CHANGELOG\.md/);

  // A version cut into the changelog after the file was written.
  await writeFile(path.join(root, "CHANGELOG.md"), CHANGELOG.replace("## [Unreleased]", "## [0.6.0] - 2026-10-02\n\n- **A brand new version has been cut.** With text.\n\n## [Unreleased]"));
  const stale = cli(root, "--check");
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /out of date for .*0\.6\.0/);
  assert.match(stale.stderr, /node scripts\/release-notes\.mjs/, "and says how to fix it");
  assert.equal((await check({ root })).ok, false);
  cli(root);
  assert.equal(cli(root, "--check").status, 0, "regenerating puts it right");

  // A sentence edited by hand in the shipped file.
  const file = path.join(root, "assets", "whats-new.json");
  await writeFile(file, (await readFile(file, "utf8")).replace("Windows tells you", "Windows might tell you"));
  const edited = cli(root, "--check");
  assert.equal(edited.status, 1);
  assert.match(edited.stderr, /0\.5\.0/);

  await rm(file);
  assert.match(cli(root, "--check").stderr, /is missing/);
  await writeFile(file, "{ not json");
  assert.match(cli(root, "--check").stderr, /not readable JSON/);
  await writeFile(file, serialize(buildTable(CHANGELOG.replace("## [Unreleased]", "## [0.6.0] - 2026-10-02\n\n- **A brand new version has been cut.** With text.\n\n## [Unreleased]"))).replace(/\n$/, "\r\n"));
  assert.equal(cli(root, "--check").status, 0, "a Windows checkout's line endings do not make it stale");
  const bare = await mkdtemp(path.join(tmpdir(), "mefi-notes-"));
  t.after(() => rm(bare, { recursive: true, force: true }));
  assert.equal(cli(bare, "--check").status, 2, "no changelog at all is an error of its own");
});

test("this repository's committed assets/whats-new.json matches its CHANGELOG.md", async () => {
  const result = await check({ root: studio });
  assert.equal(result.ok, true, `assets/whats-new.json is stale for ${result.stale.join(", ") || "(format)"}: run node scripts/release-notes.mjs`);
  const table = JSON.parse(await readFile(path.join(studio, "assets", "whats-new.json"), "utf8"));
  assert.ok(Object.keys(table).length > 0, "the shipped file says something");
  for (const [version, lines] of Object.entries(table)) {
    assert.equal(notes.cleanVersion(version), version, "a canonical stable or prerelease version");
    assert.ok(lines.length >= 1 && lines.length <= 6, `${version} has ${lines.length} sentences`);
    assert.ok(lines.every((line) => typeof line === "string" && line.length >= 12 && line.length <= 200 && !/[`*]/.test(line)), `${version}: plain sentences`);
  }
});

test("packaging refreshes the notes before it copies assets/, and a missing generator never stops a package", async () => {
  const source = await readFile(path.join(studio, "scripts", "package-portable.mjs"), "utf8");
  const generates = source.indexOf('await import("./release-notes.mjs")');
  const copies = source.indexOf('for (const dir of ["renderer", "scripts", "assets"])');
  assert.ok(generates > 0, "the packager runs the generator");
  assert.ok(copies > generates, "and does it before the payload is copied, so the package carries this build's notes");
  const between = source.slice(generates, copies);
  assert.match(between, /await writeWhatsNew\(\{ root: STUDIO \}\)/, "it really writes the file for this checkout");
  assert.match(between, /catch \(error\) \{\s*console\.warn\(/, "a failure is a warning that keeps the file that is there");
  assert.doesNotMatch(source.slice(0, generates), /^import .* from "\.\/release-notes\.mjs"/m, "a package folder that lacks the generator still packages");
});
