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
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../scripts/build-booklet.mjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RENDERER = path.join(STUDIO, "renderer");

// Keep in step with the inline list in scripts/build-booklet.mjs; the fixture
// only counts as faithful while it copies the same inputs the real build reads.
const INLINE_SCRIPTS = [
  "file-inputs.js", "composer-pictures.js", "composer-picker.js", "motion.js", "card-layout.js", "autonomy-ui.js",
  "performance-core.js",
  "profiler.js",
  "stage-labels.js",
  "node-visuals.js",
  "task-groups.js", "studio-ui.js", "agents.js", "companion-ui.js", "companion-hub.js",
  "nav.js",
  "sidebar.js",
  "graph.js",
  "model-lab.js",
  "tracker.js",
  "node-styles.js",
  "tree3d.js",
  "tree-dynamics.js",
  "idle.js",
  "model-community.js",
  "camera-tour.js",
  "git-sync.js",
  "explorer.js",
  "analyzer.js",
  "tasks.js",
  "ideas.js",
  "overhead.js",
  "brains.js",
  "palette.js",
  "config-dialog.js",
  "size.js",
  "eyes.js",
  "trace.js",
  "fleet-layout.js",
  "fleet.js",
  "boot.js",
  "startup.js",
  "workspace.js",
  "planning.js",
  "media-window.js",
  "media-browser.js",
  "music.js",
  "together.js",
  "pc-sync.js",
  "pc-vault.js",
  "whats-new.js",
  "report.js",
  "alerts.js",
  "companion-friends.js",
  "rooms.js",
  "onboarding.js",
  "community.js",
  "demo-panel.js",
  "agent-brain.js",
  "project-map-view.js",
  "setup-helper.js",
  "vibe-flow.js",
  "vibe-panels.js",
  "vibe.js",
  "today.js",
  "key-tips.js",
  "patch.js",
  "panes.js",
  "builder.js",
  "worktrees.js",
  "review.js",
  "skills.js",
  "shell.js",
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
  await copyFile(path.join(RENDERER, "music.css"), path.join(renderer, "music.css"));
  await copyFile(path.join(RENDERER, "planning.css"), path.join(renderer, "planning.css"));
  await copyFile(path.join(RENDERER, "profiler.css"), path.join(renderer, "profiler.css"));
  await copyFile(path.join(RENDERER, "brains.css"), path.join(renderer, "brains.css"));
  await copyFile(path.join(RENDERER, "agent-brain.css"), path.join(renderer, "agent-brain.css"));
  for (const name of ["studio-ui.css", "agents.css", "companion-ui.css", "companion-hub.css", "vibe.css", "today.css", "trace.css", "fleet.css", "setup-helper.css", "config-dialog.css", "git-sync.css", "builder.css", "composer-pictures.css", "composer-picker.css", "worktrees.css", "review.css", "skills.css", "shell.css", "size.css", "host-cards.css"]) await copyFile(path.join(RENDERER, name), path.join(renderer, name));
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
    const groupHelper = await readFile(path.join(root, "renderer", "task-groups.js"), "utf8");
    const helperAt = code.indexOf(groupHelper);
    assert.ok(helperAt >= 0, "the shared task grouping helper is included in the built artifact");
    for (const consumer of ["idle.js", "workspace.js"]) {
      const consumerAt = code.indexOf(await readFile(path.join(root, "renderer", consumer), "utf8"));
      assert.ok(consumerAt > helperAt, `${consumer} loads after the shared grouping helper`);
    }

    // Brains assets ride along verbatim, exactly once: a build that appended
    // them twice or left a src/href reference behind fails here, mirroring the
    // committed-booklet contract in tools/test_mefi_studio_booklet.py.
    for (const asset of ["brains.css", "brains.js"]) {
      const source = await readFile(path.join(root, "renderer", asset), "utf8");
      assert.equal(
        html.split(source).length - 1,
        1,
        `${asset} must be inlined verbatim exactly once`
      );
      assert.ok(!html.includes(asset), `${asset} must leave no filename reference behind`);
    }

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

// Git on Windows checks the inputs out with CRLF (core.autocrlf) while the
// committed blobs are LF, and one editor may save a file either way.
async function setLineEndings(root, ending, { except = [] } = {}) {
  for (const dir of ["renderer", "data"]) {
    for (const name of await readdir(path.join(root, dir))) {
      if (name === "booklet.html" || name === "booklet.sources.json") continue;
      const file = path.join(root, dir, name);
      const text = (await readFile(file, "utf8")).replace(/\r\n?/g, "\n");
      await writeFile(file, except.includes(name) ? text : text.replace(/\n/g, ending));
    }
  }
}

test("booklet build on fixtures: CRLF inputs give an all-CRLF booklet that a rebuild leaves alone", async () => {
  const root = await makeFixtureRoot();
  try {
    // One LF file among CRLF ones: the booklet still comes out in one ending.
    await setLineEndings(root, "\r\n", { except: ["palette.js"] });
    const out = path.join(root, "renderer", "booklet.html");
    await build({ root });
    const bytes = await readFile(out);
    const text = bytes.toString("utf8");
    assert.ok(text.includes("\r\n"));
    assert.equal(text.replace(/\r\n/g, "").includes("\n"), false, "no bare LF: the booklet is not mixed");
    assert.equal(text.replace(/\r\n/g, "").includes("\r"), false, "no bare CR");

    const second = await build({ root });
    assert.equal(second.changed, false, "a rebuild over the same CRLF checkout is a no-op, not a size-only change");
    assert.deepEqual(await readFile(out), bytes);

    // The manifest's lines point at the real first line of each source in the written file.
    const manifest = JSON.parse(await readFile(path.join(root, "renderer", "booklet.sources.json"), "utf8"));
    const lines = text.split("\r\n");
    for (const name of ["task-groups.js", "palette.js", "booklet.js"]) {
      const segment = manifest.segments.find((entry) => entry.source === `renderer/${name}`);
      const first = (await readFile(path.join(root, "renderer", name), "utf8")).split(/\r?\n/)[0];
      assert.equal(lines[segment.startLine - 1], first, `${name} starts on its manifest line`);
    }

    // The same inputs checked out with LF (CI, core.autocrlf=false) build the same text with LF.
    await setLineEndings(root, "\n");
    assert.equal((await build({ root })).changed, true);
    const lfText = await readFile(out, "utf8");
    assert.equal(lfText.includes("\r"), false);
    assert.equal(lfText, text.replace(/\r\n/g, "\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overlapping booklet builds keep complete output and clean up their own temporary files", async () => {
  const root = await makeFixtureRoot();
  try {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => build({ root })));
    assert.deepEqual(results.filter((result) => result.status === "rejected"), [], "concurrent writers must not consume each other's temp files");
    const html = await readFile(path.join(root, "renderer", "booklet.html"), "utf8");
    const data = bakedSection(html, /<script id="booklet-data" type="application\/json">([\s\S]*?)<\/script>/, "catalog block");
    assert.deepEqual(JSON.parse(data), FIXTURE_CATALOG);
    assert.ok(JSON.parse(await readFile(path.join(root, "renderer", "booklet.sources.json"), "utf8")));
    assert.equal((await build({ root })).changed, false, "the final output is exactly the complete input snapshot");
    assert.deepEqual((await readdir(path.join(root, "renderer"))).filter((name) => name.endsWith(".tmp")), []);
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
