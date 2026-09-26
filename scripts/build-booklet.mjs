// Mefi's Studio AI+ — builds a single self-contained renderer/booklet.html from
// booklet.template.html + data/models.json + the renderer scripts.
// Mirrors the repo's tools/motion viewer pattern: data and code are injected,
// so the booklet opens from file:// with no server and no external references.
//
//   node scripts/build-booklet.mjs                                      CLI (npm run build-booklet)
//   import { build } from "./build-booklet.mjs"; await build({ root })   scripts/updater.mjs

import { open, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
  "node-visuals.js",
  "performance-core.js",
  "profiler.js",
  "task-groups.js",
  "studio-ui.js",
  "nav.js",
  "sidebar.js",
  "graph.js",
  "model-lab.js",
  "tracker.js",
  "node-styles.js",
  "tree3d.js",
  "idle.js",
  "camera-tour.js",
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
  "media-window.js",
  "music.js",
  "together.js",
  "planning.js",
  "onboarding.js",
  "community.js",
  "demo-panel.js",
  "companion-ui.js", "companion-hub.js", "project-map-view.js", "agent-brain.js",
  "agents.js",
  "vibe.js",
  "booklet.js",
];

async function writeBuildFile(out, content) {
  // The live updater and CLI can build together, even within one process.
  // An exclusive unique sibling keeps each writer's complete bytes its own;
  // the final path is replaced atomically, never truncated as a fallback.
  const temp = `${out}.${process.pid}-${randomUUID()}.tmp`;
  let ownsTemp = false;
  try {
    const file = await open(temp, "wx");
    ownsTemp = true;
    try {
      await file.writeFile(content, "utf8");
    } finally {
      await file.close();
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temp, out);
        break;
      } catch (error) {
        // Windows may briefly lock the destination while the view loads it.
        // Permanent errors retain their original code, source and destination.
        if (process.platform !== "win32" || !["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  } finally {
    // Cleanup must neither remove another build's temp nor mask the failure
    // that explains why the last complete output could not be replaced.
    if (ownsTemp) await rm(temp, { force: true }).catch(() => {});
  }
}

export async function build({ root = ROOT } = {}) {
  const RENDERER = path.join(root, "renderer");
  const template = await readFile(path.join(RENDERER, "booklet.template.html"), "utf8");
  const catalog = await readFile(path.join(root, "data", "models.json"), "utf8");
  const parsed = JSON.parse(catalog);

  const [styles, musicStyles, planningStyles, brainStyles, taskGroups, nav, sidebar, graph, modelLab, tracker, nodeStyles, tree, idle, cameraTour, explorer, analyzer, tasks, ideas, overhead, brains, palette, eyes, boot, startup, workspace, mediaWindow, music, together, planning, onboarding, community, demoPanel, agentBrain, booklet] = await Promise.all([
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
    readFile(path.join(RENDERER, "node-styles.js"), "utf8"),
    readFile(path.join(RENDERER, "tree3d.js"), "utf8"),
    readFile(path.join(RENDERER, "idle.js"), "utf8"),
    readFile(path.join(RENDERER, "camera-tour.js"), "utf8"),
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
    readFile(path.join(RENDERER, "media-window.js"), "utf8"),
    readFile(path.join(RENDERER, "music.js"), "utf8"),
    readFile(path.join(RENDERER, "together.js"), "utf8"),
    readFile(path.join(RENDERER, "planning.js"), "utf8"),
    readFile(path.join(RENDERER, "onboarding.js"), "utf8"),
    readFile(path.join(RENDERER, "community.js"), "utf8"),
    readFile(path.join(RENDERER, "demo-panel.js"), "utf8"),
    readFile(path.join(RENDERER, "agent-brain.js"), "utf8"),
    readFile(path.join(RENDERER, "booklet.js"), "utf8"),
  ]);

  const [profilerStyles, agentBrainStyles, performanceCore, profiler, stageLabels] = await Promise.all([
    readFile(path.join(RENDERER, "profiler.css"), "utf8"),
    readFile(path.join(RENDERER, "agent-brain.css"), "utf8"),
    readFile(path.join(RENDERER, "performance-core.js"), "utf8"),
    readFile(path.join(RENDERER, "profiler.js"), "utf8"),
    readFile(path.join(RENDERER, "stage-labels.js"), "utf8"),
  ]);
  const [studioUi, studioUiStyles, agents, agentsStyles, companionUi, companionStyles, companionHub, companionHubStyles, vibe, vibeStyles] = await Promise.all([
    readFile(path.join(RENDERER, "studio-ui.js"), "utf8"),
    readFile(path.join(RENDERER, "studio-ui.css"), "utf8"),
    readFile(path.join(RENDERER, "agents.js"), "utf8"),
    readFile(path.join(RENDERER, "agents.css"), "utf8"),
    readFile(path.join(RENDERER, "companion-ui.js"), "utf8"),
    readFile(path.join(RENDERER, "companion-ui.css"), "utf8"),
    readFile(path.join(RENDERER, "companion-hub.js"), "utf8"),
    readFile(path.join(RENDERER, "companion-hub.css"), "utf8"),
    readFile(path.join(RENDERER, "vibe.js"), "utf8"),
    readFile(path.join(RENDERER, "vibe.css"), "utf8"),
  ]);
  const nodeVisuals = await readFile(path.join(RENDERER, "node-visuals.js"), "utf8");
  const projectMapView = await readFile(path.join(RENDERER, "project-map-view.js"), "utf8");
  const codeParts = [stageLabels, nodeVisuals, performanceCore, profiler, taskGroups, studioUi, nav, sidebar, graph, modelLab, tracker, nodeStyles, tree, idle, cameraTour, explorer, analyzer, tasks, ideas, overhead, brains, palette, eyes, boot, startup, workspace, mediaWindow, music, together, planning, onboarding, community, demoPanel, companionUi, companionHub, projectMapView, agentBrain, agents, vibe, booklet];
  const code = codeParts.join("\n");
  const html = template
    .replace("__BOOKLET_DATA__", () => catalog.trim())
    .replace("__BOOKLET_STYLES__", () => `${styles}\n${musicStyles}\n${planningStyles}\n${brainStyles}\n${profilerStyles}\n${agentBrainStyles}\n${agentsStyles}\n${companionStyles}\n${studioUiStyles}\n${companionHubStyles}\n${vibeStyles}`)
    .replace("__BOOKLET_CODE__", () => code);

  const out = path.join(RENDERER, "booklet.html");
  let previous = null;
  try {
    previous = await readFile(out, "utf8");
  } catch {}
  const changed = previous !== html;
  if (changed) await writeBuildFile(out, html);

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
  if (previousManifest !== serialized) await writeBuildFile(manifestOut, serialized);
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
