// Mefi's Studio AI+ — builds a single self-contained renderer/booklet.html from
// booklet.template.html + data/models.json + the renderer scripts.
// Mirrors the repo's tools/motion viewer pattern: data and code are injected,
// so the booklet opens from file:// with no server and no external references.
//
//   node scripts/build-booklet.mjs                                      CLI (npm run build-booklet)
//   import { build } from "./build-booklet.mjs"; await build({ root })   scripts/updater.mjs

import { readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { buildBookletSourceManifest } = require("./booklet-source-location.cjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Emit order of the concatenated inline <script>. Keep in step with the
// Promise.all destructuring below and tests/booklet_build.test.mjs.
const CODE_SOURCES = [
  "stage-labels.js",
  "performance-core.js",
  "profiler.js",
  "task-groups.js",
  "nav.js",
  "sidebar.js",
  "graph.js",
  "model-lab.js",
  "tracker.js",
  "tree3d.js",
  "idle.js",
  "explorer.js",
  "analyzer.js",
  "tasks.js",
  "ideas.js",
  "overhead.js",
  "brains.js",
  "palette.js",
  "eyes.js",
  "boot.js",
  "startup.js",
  "workspace.js",
  "companion.js",
  "music.js",
  "planning.js",
  "onboarding.js",
  "community.js",
  "booklet.js",
];

export async function build({ root = ROOT } = {}) {
  const RENDERER = path.join(root, "renderer");
  const template = await readFile(path.join(RENDERER, "booklet.template.html"), "utf8");
  const catalog = await readFile(path.join(root, "data", "models.json"), "utf8");
  const parsed = JSON.parse(catalog);

  const [styles, musicStyles, planningStyles, brainStyles, taskGroups, nav, sidebar, graph, modelLab, tracker, tree, idle, explorer, analyzer, tasks, ideas, overhead, brains, palette, eyes, boot, startup, workspace, companion, music, planning, onboarding, community, booklet] = await Promise.all([
    readFile(path.join(RENDERER, "styles.css"), "utf8"),
    readFile(path.join(RENDERER, "music.css"), "utf8"),
    readFile(path.join(RENDERER, "planning.css"), "utf8"),
    readFile(path.join(RENDERER, "brains.css"), "utf8"),
    readFile(path.join(RENDERER, "task-groups.js"), "utf8"),
    readFile(path.join(RENDERER, "nav.js"), "utf8"),
    readFile(path.join(RENDERER, "sidebar.js"), "utf8"),
    readFile(path.join(RENDERER, "graph.js"), "utf8"),
    readFile(path.join(RENDERER, "model-lab.js"), "utf8"),
    readFile(path.join(RENDERER, "tracker.js"), "utf8"),
    readFile(path.join(RENDERER, "tree3d.js"), "utf8"),
    readFile(path.join(RENDERER, "idle.js"), "utf8"),
    readFile(path.join(RENDERER, "explorer.js"), "utf8"),
    readFile(path.join(RENDERER, "analyzer.js"), "utf8"),
    readFile(path.join(RENDERER, "tasks.js"), "utf8"),
    readFile(path.join(RENDERER, "ideas.js"), "utf8"),
    readFile(path.join(RENDERER, "overhead.js"), "utf8"),
    readFile(path.join(RENDERER, "brains.js"), "utf8"),
    readFile(path.join(RENDERER, "palette.js"), "utf8"),
    readFile(path.join(RENDERER, "eyes.js"), "utf8"),
    readFile(path.join(RENDERER, "boot.js"), "utf8"),
    readFile(path.join(RENDERER, "startup.js"), "utf8"),
    readFile(path.join(RENDERER, "workspace.js"), "utf8"),
    readFile(path.join(RENDERER, "companion.js"), "utf8"),
    readFile(path.join(RENDERER, "music.js"), "utf8"),
    readFile(path.join(RENDERER, "planning.js"), "utf8"),
    readFile(path.join(RENDERER, "onboarding.js"), "utf8"),
    readFile(path.join(RENDERER, "community.js"), "utf8"),
    readFile(path.join(RENDERER, "booklet.js"), "utf8"),
  ]);

  const [profilerStyles, performanceCore, profiler, stageLabels] = await Promise.all([
    readFile(path.join(RENDERER, "profiler.css"), "utf8"),
    readFile(path.join(RENDERER, "performance-core.js"), "utf8"),
    readFile(path.join(RENDERER, "profiler.js"), "utf8"),
    readFile(path.join(RENDERER, "stage-labels.js"), "utf8"),
  ]);
  const codeParts = [stageLabels, performanceCore, profiler, taskGroups, nav, sidebar, graph, modelLab, tracker, tree, idle, explorer, analyzer, tasks, ideas, overhead, brains, palette, eyes, boot, startup, workspace, companion, music, planning, onboarding, community, booklet];
  const code = codeParts.join("\n");
  const html = template
    .replace("__BOOKLET_DATA__", () => catalog.trim())
    .replace("__BOOKLET_STYLES__", () => `${styles}\n${musicStyles}\n${planningStyles}\n${brainStyles}\n${profilerStyles}`)
    .replace("__BOOKLET_CODE__", () => code);

  const out = path.join(RENDERER, "booklet.html");
  let previous = null;
  try {
    previous = await readFile(out, "utf8");
  } catch {}
  const changed = previous !== html;
  if (changed) {
    const temp = `${out}.tmp`;
    await writeFile(temp, html);
    await rename(temp, out);
  }

  // A sidecar source map so runtime error locations captured against the
  // concatenated bundle resolve back to renderer/<file>:<line>. It is derived
  // from the exact html written above (styles/data expansion included), never
  // guessed from filenames or source order.
  const manifest = buildBookletSourceManifest(
    html,
    code,
    CODE_SOURCES.map((source, index) => ({ source: `renderer/${source}`, content: codeParts[index] }))
  );
  const manifestOut = path.join(RENDERER, "booklet.sources.json");
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  let previousManifest = null;
  try {
    previousManifest = await readFile(manifestOut, "utf8");
  } catch {}
  if (previousManifest !== serialized) {
    const temp = `${manifestOut}.tmp`;
    await writeFile(temp, serialized);
    await rename(temp, manifestOut);
  }
  return { out, models: parsed.models.length, hash: parsed.hash, changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build()
    .then((result) => {
      console.log(`built ${path.relative(ROOT, result.out)} — ${result.models} models, hash ${result.hash.slice(0, 12)}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
