// Mefi's Studio AI+ — builds a single self-contained renderer/booklet.html from
// booklet.template.html + data/models.json + the renderer scripts.
// Mirrors the repo's tools/motion viewer pattern: data and code are injected,
// so the booklet opens from file:// with no server and no external references.
//
//   node scripts/build-booklet.mjs                                      CLI (npm run build-booklet)
//   import { build } from "./build-booklet.mjs"; await build({ root })   scripts/updater.mjs

import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function build({ root = ROOT } = {}) {
  const RENDERER = path.join(root, "renderer");
  const template = await readFile(path.join(RENDERER, "booklet.template.html"), "utf8");
  const catalog = await readFile(path.join(root, "data", "models.json"), "utf8");
  const parsed = JSON.parse(catalog);

  const [styles, nav, graph, tree, idle, explorer, analyzer, tasks, ideas, overhead, palette, eyes, boot, workspace, booklet] = await Promise.all([
    readFile(path.join(RENDERER, "styles.css"), "utf8"),
    readFile(path.join(RENDERER, "nav.js"), "utf8"),
    readFile(path.join(RENDERER, "graph.js"), "utf8"),
    readFile(path.join(RENDERER, "tree3d.js"), "utf8"),
    readFile(path.join(RENDERER, "idle.js"), "utf8"),
    readFile(path.join(RENDERER, "explorer.js"), "utf8"),
    readFile(path.join(RENDERER, "analyzer.js"), "utf8"),
    readFile(path.join(RENDERER, "tasks.js"), "utf8"),
    readFile(path.join(RENDERER, "ideas.js"), "utf8"),
    readFile(path.join(RENDERER, "overhead.js"), "utf8"),
    readFile(path.join(RENDERER, "palette.js"), "utf8"),
    readFile(path.join(RENDERER, "eyes.js"), "utf8"),
    readFile(path.join(RENDERER, "boot.js"), "utf8"),
    readFile(path.join(RENDERER, "workspace.js"), "utf8"),
    readFile(path.join(RENDERER, "booklet.js"), "utf8"),
  ]);

  const html = template
    .replace("__BOOKLET_DATA__", () => catalog.trim())
    .replace("__BOOKLET_STYLES__", () => styles)
    .replace("__BOOKLET_CODE__", () => [nav, graph, tree, idle, explorer, analyzer, tasks, ideas, overhead, palette, eyes, boot, workspace, booklet].join("\n"));

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
