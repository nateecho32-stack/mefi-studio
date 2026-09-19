// Keep the app's source, the selected workspace, and the optional game separate.
const { existsSync } = require("node:fs");
const path = require("node:path");

function resolveStudioPaths({ studioRoot, isPackaged, executablePath, env = process.env, exists = existsSync }) {
  studioRoot = path.resolve(studioRoot);
  const inPayload = path.basename(studioRoot) === "app" && path.basename(path.dirname(studioRoot)) === "resources";
  isPackaged ??= inPayload;
  let sourceRoot = studioRoot;
  if (isPackaged) {
    const executableDir = executablePath ? path.dirname(executablePath) : path.resolve(studioRoot, "..", "..");
    const candidate = path.resolve(executableDir, "..", "..");
    // A portable folder can be moved away from its checkout. In that case,
    // use its own payload instead of watching or writing to an unrelated parent.
    if (exists(path.join(candidate, "package.json")) &&
        exists(path.join(candidate, "main.cjs")) &&
        exists(path.join(candidate, "renderer", "booklet.template.html"))) {
      sourceRoot = candidate;
    }
  }
  const repoRoot = env.MEFI_STUDIO_REPO ? path.resolve(env.MEFI_STUDIO_REPO) : sourceRoot;
  const isGameRoot = (root) => exists(path.join(root, "main.lua")) && exists(path.join(root, "Run Game (LOVE2D).cmd"));
  const candidates = [repoRoot, path.join(path.dirname(sourceRoot), "2d Trippy Hell")];
  const gameRoot = env.MEFI_STUDIO_GAME_ROOT
    ? path.resolve(env.MEFI_STUDIO_GAME_ROOT)
    : candidates.find(isGameRoot) ?? null;
  return { sourceRoot, repoRoot, gameRoot };
}

module.exports = { resolveStudioPaths };
