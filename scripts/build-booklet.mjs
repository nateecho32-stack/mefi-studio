// Mefi's Studio AI+ — builds a single self-contained renderer/booklet.html from
// booklet.template.html + data/models.json + the renderer scripts.
// Mirrors the repo's tools/motion viewer pattern: data and code are injected,
// so the booklet opens from file:// with no server and no external references.
//
//   node scripts/build-booklet.mjs                                      CLI (npm run build-booklet)
//   import { build } from "./build-booklet.mjs"; await build({ root })   scripts/updater.mjs

import { open, readFile as readText, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { buildBookletSourceManifest } = require("./booklet-source-location.cjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Git on Windows (core.autocrlf) checks the sources out with CRLF, and the
// join below uses "\n". Every input is read as LF, so the booklet is never
// mixed and the source manifest's offsets hold; the output is then written
// with the template's own line ending, so an unchanged rebuild is byte for
// byte what Git checked out instead of a same-text file at a new size.
const lf = (text) => text.replace(/\r\n?/g, "\n");
const readFile = async (file, encoding) => lf(await readText(file, encoding));

// One ordered inventory drives reads, emission, source attribution and fixtures.
// Keep this declaration JSON-compatible: audit({ root }) parses it as data,
// without importing or executing a build module from the audited tree.
export const BOOKLET_INPUTS = {
  "scripts": [
    "stage-labels.js",
    "node-visuals.js",
    "performance-core.js",
    "profiler.js",
    "task-groups.js",
    "studio-ui.js",
    "file-inputs.js",
    "motion.js",
    "card-layout.js",
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
    "daily-paper.js",
    "composer-pictures.js",
    "composer-picker.js",
    "workspace.js",
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
    "project-hub.js",
    "friends-front.js",
    "friends-mod.js",
    "planning.js",
    "onboarding.js",
    "community.js",
    "demo-panel.js",
    "autonomy-ui.js",
    "companion-ui.js",
    "companion-hub.js",
    "project-map-view.js",
    "agent-brain.js",
    "agents.js",
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
    "tabs.js",
    "sessions.js",
    "booklet.js"
  ],
  "styles": [
    "styles.css",
    "music.css",
    "planning.css",
    "brains.css",
    "profiler.css",
    "trace.css",
    "fleet.css",
    "config-dialog.css",
    "host-cards.css",
    "agent-brain.css",
    "agents.css",
    "companion-ui.css",
    "studio-ui.css",
    "companion-hub.css",
    "project-hub.css",
    "friends-front.css",
    "vibe.css",
    "today.css",
    "setup-helper.css",
    "git-sync.css",
    "builder.css",
    "composer-pictures.css",
    "composer-picker.css",
    "worktrees.css",
    "review.css",
    "skills.css",
    "size.css",
    "shell.css",
    "tabs.css",
    "sessions.css",
    "daily-paper.css",
    "chrome.css"
  ]
};
Object.freeze(BOOKLET_INPUTS.scripts);
Object.freeze(BOOKLET_INPUTS.styles);
Object.freeze(BOOKLET_INPUTS);

export function validateBookletInputs(inputs) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) ||
      Object.keys(inputs).some((key) => !["scripts", "styles"].includes(key))) {
    throw new Error("booklet input inventory must contain scripts and styles");
  }
  for (const [kind, extension] of [["scripts", ".js"], ["styles", ".css"]]) {
    const names = inputs[kind];
    if (!Array.isArray(names) || names.length === 0) throw new Error("booklet " + kind + " inventory must be a non-empty array");
    const seen = new Set();
    for (const name of names) {
      if (typeof name !== "string" || !/^[\w.-]+$/.test(name) || !name.endsWith(extension) || name.includes("..")) {
        throw new Error("invalid booklet " + kind + " input: " + String(name));
      }
      if (seen.has(name)) throw new Error("duplicate booklet " + kind + " input: " + name);
      seen.add(name);
    }
  }
  return inputs;
}

export function parseBookletInputs(buildSource) {
  if (!/export\s+const\s+BOOKLET_INPUTS\s*=/.test(buildSource)) return null;
  const declaration = buildSource.match(/export\s+const\s+BOOKLET_INPUTS\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!declaration) throw new Error("booklet input inventory declaration is malformed");
  return validateBookletInputs(JSON.parse(declaration[1]));
}

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

export async function build({ root = ROOT, inputs = BOOKLET_INPUTS } = {}) {
  validateBookletInputs(inputs);
  const RENDERER = path.join(root, "renderer");
  const rawTemplate = await readText(path.join(RENDERER, "booklet.template.html"), "utf8");
  const eol = /\r\n/.test(rawTemplate) ? "\r\n" : "\n";
  const template = lf(rawTemplate);
  const catalog = await readFile(path.join(root, "data", "models.json"), "utf8");
  const parsed = JSON.parse(catalog);

  const readInputs = (names) => Promise.all(names.map(async (name) => ({
    source: "renderer/" + name,
    content: await readFile(path.join(RENDERER, name), "utf8"),
  })));
  const [styleParts, codeParts] = await Promise.all([readInputs(inputs.styles), readInputs(inputs.scripts)]);
  const styles = styleParts.map((part) => part.content).join("\n");
  const code = codeParts.map((part) => part.content).join("\n");
  const html = template
    // "</" and "<!--" escaped: a fetched model name holding "</script>" would
    // otherwise end the data block and run as renderer script. JSON.parse
    // reads < back as "<"; a plain "<= 200K" is left as it was.
    .replace("__BOOKLET_DATA__", () => catalog.trim().replace(/<(?=\/|!--)/g, "\\u003c"))
    .replace("__BOOKLET_STYLES__", () => styles)
    .replace("__BOOKLET_CODE__", () => code);

  const out = path.join(RENDERER, "booklet.html");
  const written = eol === "\n" ? html : html.replace(/\n/g, eol);
  let previous = null;
  try {
    previous = await readText(out, "utf8");
  } catch {}
  const changed = previous !== written;
  if (changed) await writeBuildFile(out, written);

  // A sidecar source map so runtime error locations captured against the
  // concatenated bundle resolve back to renderer/<file>:<line>. It is derived
  // from the exact html written above (styles/data expansion included), never
  // guessed from filenames or source order. Lines count the same in LF and
  // CRLF, so the LF html gives the written file's line numbers.
  const manifest = buildBookletSourceManifest(
    html,
    code,
    codeParts
  );
  const manifestOut = path.join(RENDERER, "booklet.sources.json");
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  let previousManifest = null;
  try {
    previousManifest = await readText(manifestOut, "utf8");
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
