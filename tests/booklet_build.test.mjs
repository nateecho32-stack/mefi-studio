// Booklet build smoke: the real scripts/build-booklet.mjs runs against a
// fixture root — the committed template, styles and renderer scripts copied
// in, plus a tiny two-model catalog — and the assertions watch the artifacts
// it owes: a non-empty, self-contained renderer/booklet.html with every
// placeholder replaced, the baked catalog intact, and the atomic-write
// no-op on a rebuild. A renamed renderer file, a broken inline script or a
// half-wired build fails here, in `npm test`, instead of leaving a stale
// committed booklet behind. The CLI entry is a thin wrapper over the same
// build(), so this exercises the path `npm run build-booklet` takes.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../scripts/build-booklet.mjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RENDERER = path.join(STUDIO, "renderer");

// Keep in step with the inline list in scripts/build-booklet.mjs; the fixture
// only counts as faithful while it copies the same inputs the real build reads.
const INLINE_SCRIPTS = [
  "nav.js",
  "graph.js",
  "tree3d.js",
  "idle.js",
  "explorer.js",
  "analyzer.js",
  "tasks.js",
  "ideas.js",
  "overhead.js",
  "palette.js",
  "eyes.js",
  "boot.js",
  "booklet.js",
];

const FIXTURE_CATALOG = {
  hash: "fixture-hash-0f9e8d7c6b5a",
  models: [
    {
      id: "fixture-alpha",
      name: "Fixture Alpha",
      vendor: "Testbench",
      tags: ["fixture"],
      verdict: "First fixture model.",
      quality: { index: 90, declared: "AA", benchmarks: [] },
    },
    {
      id: "fixture-beta",
      name: "Fixture Beta",
      vendor: "Testbench",
      tags: ["fixture"],
      verdict: "Second fixture model.",
      quality: { index: null, declared: "none", benchmarks: [] },
    },
  ],
};

async function makeFixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "booklet-build-"));
  const renderer = path.join(root, "renderer");
  await mkdir(renderer, { recursive: true });
  await mkdir(path.join(root, "data"), { recursive: true });
  await copyFile(path.join(RENDERER, "booklet.template.html"), path.join(renderer, "booklet.template.html"));
  await copyFile(path.join(RENDERER, "styles.css"), path.join(renderer, "styles.css"));
  for (const name of INLINE_SCRIPTS) {
    await copyFile(path.join(RENDERER, name), path.join(renderer, name));
  }
  await writeFile(path.join(root, "data", "models.json"), `${JSON.stringify(FIXTURE_CATALOG, null, 2)}\n`);
  return root;
}

function bakedSection(html, pattern, label) {
  const match = html.match(pattern);
  assert.ok(match, `the built booklet must carry a ${label}`);
  return match[1];
}

test("booklet build on fixtures: the output exists, is non-empty and self-contained", async () => {
  const root = await makeFixtureRoot();
  try {
    const result = await build({ root });

    assert.equal(result.models, 2, "the build must report the fixture model count");
    assert.equal(result.hash, FIXTURE_CATALOG.hash);
    assert.equal(result.changed, true, "a first build must write the booklet");
    assert.equal(result.out, path.join(root, "renderer", "booklet.html"));

    const html = await readFile(result.out, "utf8");
    assert.ok(html.length > 0, "booklet.html must not be empty");
    for (const placeholder of ["__BOOKLET_DATA__", "__BOOKLET_CODE__", "__BOOKLET_STYLES__"]) {
      assert.ok(!html.includes(placeholder), `${placeholder} must be replaced`);
    }

    const styles = bakedSection(html, /<style id="booklet-styles">([\s\S]*?)<\/style>/, "styles block");
    const data = bakedSection(
      html,
      /<script id="booklet-data" type="application\/json">([\s\S]*?)<\/script>/,
      "catalog block"
    );
    const code = bakedSection(html, /<script>([\s\S]*?)<\/script>/, "code block");
    assert.ok(styles.trim().length > 0, "the baked styles must be non-empty");
    assert.ok(code.trim().length > 0, "the baked code must be non-empty");

    const baked = JSON.parse(data);
    assert.deepEqual(
      baked.models.map((model) => model.id),
      ["fixture-alpha", "fixture-beta"],
      "the baked catalog must be the fixture catalog"
    );
    assert.equal(baked.hash, FIXTURE_CATALOG.hash);

    // The point of the single-file build: no external references survive.
    assert.doesNotMatch(html, /<script[^>]+src=/);
    assert.doesNotMatch(html, /<link[^>]+href=/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("booklet build on fixtures: a rebuild over identical inputs is a no-op", async () => {
  const root = await makeFixtureRoot();
  try {
    const out = path.join(root, "renderer", "booklet.html");
    await build({ root });
    const html = await readFile(out, "utf8");

    const second = await build({ root });
    assert.equal(second.changed, false, "identical inputs must not rewrite the booklet");
    assert.equal(await readFile(out, "utf8"), html);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("booklet build on fixtures: a missing renderer input fails the build, writing nothing", async () => {
  const root = await makeFixtureRoot();
  try {
    await rm(path.join(root, "renderer", "palette.js"));
    await assert.rejects(build({ root }), { code: "ENOENT" });
    await assert.rejects(
      readFile(path.join(root, "renderer", "booklet.html"), "utf8"),
      { code: "ENOENT" },
      "a failed build must not leave an output behind"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
