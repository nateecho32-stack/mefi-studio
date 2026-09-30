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

// Emit order of the concatenated inline <script>. Keep in step with the
// Promise.all destructuring below and tests/booklet_build.test.mjs.
const CODE_SOURCES = [
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
  "planning.js",
  "onboarding.js",
  "community.js",
  "demo-panel.js",
  "autonomy-ui.js", "companion-ui.js", "companion-hub.js", "project-map-view.js", "agent-brain.js",
  "agents.js",
  "setup-helper.js",
  "vibe-flow.js",
  "vibe-panels.js",
  "vibe.js",
  "key-tips.js",
  "patch.js",
  "panes.js",
  "builder.js",
  "worktrees.js",
  "review.js",
  "skills.js",
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
  const rawTemplate = await readText(path.join(RENDERER, "booklet.template.html"), "utf8");
  const eol = /\r\n/.test(rawTemplate) ? "\r\n" : "\n";
  const template = lf(rawTemplate);
  const catalog = await readFile(path.join(root, "data", "models.json"), "utf8");
  const parsed = JSON.parse(catalog);

  const [styles, musicStyles, planningStyles, brainStyles, taskGroups, nav, sidebar, graph, modelLab, tracker, nodeStyles, tree, idle, cameraTour, explorer, analyzer, tasks, ideas, overhead, brains, palette, eyes, boot, startup, workspace, mediaWindow, music, together, pcSync, planning, onboarding, community, demoPanel, agentBrain, booklet] = await Promise.all([
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
    readFile(path.join(RENDERER, "pc-sync.js"), "utf8"),
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
  const mediaBrowser = await readFile(path.join(RENDERER, "media-browser.js"), "utf8");
  const modelCommunity = await readFile(path.join(RENDERER, "model-community.js"), "utf8");
  const companionFriends = await readFile(path.join(RENDERER, "companion-friends.js"), "utf8");
  const roomsCode = await readFile(path.join(RENDERER, "rooms.js"), "utf8");
  const pcVault = await readFile(path.join(RENDERER, "pc-vault.js"), "utf8");
  const nodeVisuals = await readFile(path.join(RENDERER, "node-visuals.js"), "utf8");
  const projectMapView = await readFile(path.join(RENDERER, "project-map-view.js"), "utf8");
  const fileInputs = await readFile(path.join(RENDERER, "file-inputs.js"), "utf8");
  const [composerPictures, composerPicturesStyles] = await Promise.all([readFile(path.join(RENDERER, "composer-pictures.js"), "utf8"), readFile(path.join(RENDERER, "composer-pictures.css"), "utf8")]);
  const [composerPicker, composerPickerStyles] = await Promise.all([readFile(path.join(RENDERER, "composer-picker.js"), "utf8"), readFile(path.join(RENDERER, "composer-picker.css"), "utf8")]);
  const motion = await readFile(path.join(RENDERER, "motion.js"), "utf8");
  const cardLayout = await readFile(path.join(RENDERER, "card-layout.js"), "utf8");
  const treeDynamics = await readFile(path.join(RENDERER, "tree-dynamics.js"), "utf8");
  const autonomyUi = await readFile(path.join(RENDERER, "autonomy-ui.js"), "utf8");
  const vibeFlow = await readFile(path.join(RENDERER, "vibe-flow.js"), "utf8");
  const vibePanels = await readFile(path.join(RENDERER, "vibe-panels.js"), "utf8");
  const keyTips = await readFile(path.join(RENDERER, "key-tips.js"), "utf8");
  const patch = await readFile(path.join(RENDERER, "patch.js"), "utf8");
  const [panes, builder, builderStyles] = await Promise.all([readFile(path.join(RENDERER, "panes.js"), "utf8"), readFile(path.join(RENDERER, "builder.js"), "utf8"), readFile(path.join(RENDERER, "builder.css"), "utf8")]);
  const [worktrees, worktreesStyles] = await Promise.all([readFile(path.join(RENDERER, "worktrees.js"), "utf8"), readFile(path.join(RENDERER, "worktrees.css"), "utf8")]);
  const [review, reviewStyles] = await Promise.all([readFile(path.join(RENDERER, "review.js"), "utf8"), readFile(path.join(RENDERER, "review.css"), "utf8")]);
  const [skills, skillsStyles] = await Promise.all([readFile(path.join(RENDERER, "skills.js"), "utf8"), readFile(path.join(RENDERER, "skills.css"), "utf8")]);
  const [setupHelper, setupHelperStyles] = await Promise.all([readFile(path.join(RENDERER, "setup-helper.js"), "utf8"), readFile(path.join(RENDERER, "setup-helper.css"), "utf8")]);
  const [traceCode, traceStyles] = await Promise.all([readFile(path.join(RENDERER, "trace.js"), "utf8"), readFile(path.join(RENDERER, "trace.css"), "utf8")]);
  const [configCode, configStyles] = await Promise.all([readFile(path.join(RENDERER, "config-dialog.js"), "utf8"), readFile(path.join(RENDERER, "config-dialog.css"), "utf8")]);
  // Size and density (layout v2): the model, the page and the tokens the 0.5 panels size themselves with.
  const [sizeCode, sizeStyles] = await Promise.all([readFile(path.join(RENDERER, "size.js"), "utf8"), readFile(path.join(RENDERER, "size.css"), "utf8")]);
  const [fleetLayoutCode, fleetCode, fleetStyles] = await Promise.all([readFile(path.join(RENDERER, "fleet-layout.js"), "utf8"), readFile(path.join(RENDERER, "fleet.js"), "utf8"), readFile(path.join(RENDERER, "fleet.css"), "utf8")]);
  const [gitSyncCode, gitSyncStyles] = await Promise.all([readFile(path.join(RENDERER, "git-sync.js"), "utf8"), readFile(path.join(RENDERER, "git-sync.css"), "utf8")]);
  // What the host tells you (Notifications, Report a problem, What's new): their scripts and the one stylesheet they share.
  const [hostCardsStyles, whatsNewCode, reportCode, alertsCode] = await Promise.all([readFile(path.join(RENDERER, "host-cards.css"), "utf8"), readFile(path.join(RENDERER, "whats-new.js"), "utf8"), readFile(path.join(RENDERER, "report.js"), "utf8"), readFile(path.join(RENDERER, "alerts.js"), "utf8")]);
  const codeParts = [stageLabels, nodeVisuals, performanceCore, profiler, taskGroups, studioUi, fileInputs, motion, cardLayout, nav, sidebar, graph, modelLab, tracker, nodeStyles, tree, treeDynamics, idle, modelCommunity, cameraTour, gitSyncCode, explorer, analyzer, tasks, ideas, overhead, brains, palette, configCode, sizeCode, eyes, traceCode, fleetLayoutCode, fleetCode, boot, startup, composerPictures, composerPicker, workspace, mediaWindow, mediaBrowser, music, together, pcSync, pcVault, whatsNewCode, reportCode, alertsCode, companionFriends, roomsCode, planning, onboarding, community, demoPanel, autonomyUi, companionUi, companionHub, projectMapView, agentBrain, agents, setupHelper, vibeFlow, vibePanels, vibe, keyTips, patch, panes, builder, worktrees, review, skills, booklet];
  const code = codeParts.join("\n");
  const html = template
    // "</" and "<!--" escaped: a fetched model name holding "</script>" would
    // otherwise end the data block and run as renderer script. JSON.parse
    // reads < back as "<"; a plain "<= 200K" is left as it was.
    .replace("__BOOKLET_DATA__", () => catalog.trim().replace(/<(?=\/|!--)/g, "\\u003c"))
    .replace("__BOOKLET_STYLES__", () => `${styles}\n${musicStyles}\n${planningStyles}\n${brainStyles}\n${profilerStyles}\n${traceStyles}\n${fleetStyles}\n${configStyles}\n${hostCardsStyles}\n${agentBrainStyles}\n${agentsStyles}\n${companionStyles}\n${studioUiStyles}\n${companionHubStyles}\n${vibeStyles}\n${setupHelperStyles}\n${gitSyncStyles}\n${builderStyles}\n${composerPicturesStyles}\n${composerPickerStyles}\n${worktreesStyles}\n${reviewStyles}\n${skillsStyles}\n${sizeStyles}`)
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
    CODE_SOURCES.map((source, index) => ({ source: `renderer/${source}`, content: codeParts[index] }))
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
