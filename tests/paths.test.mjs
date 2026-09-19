import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import studioPaths from "../scripts/paths.cjs";
import { plan } from "../scripts/updater.mjs";

const { resolveStudioPaths } = studioPaths;
const studioRoot = path.resolve("fixtures", "Mefi's Studio AI+");
const packagedDir = path.join(studioRoot, "dist", "Mefi Studio AI+");
const payloadRoot = path.join(packagedDir, "resources", "app");
const executablePath = path.join(packagedDir, "Mefi Studio AI+.exe");
const sourceFiles = ["package.json", "main.cjs", "renderer/booklet.template.html"].map((file) => path.join(studioRoot, file));
const hasFiles = (files) => (file) => files.includes(file);
const gameFiles = (root) => [path.join(root, "main.lua"), path.join(root, "Run Game (LOVE2D).cmd")];

test("a standalone dev checkout owns its default workspace", () => {
  assert.deepEqual(resolveStudioPaths({ studioRoot, env: {}, exists: () => false }), {
    sourceRoot: studioRoot, repoRoot: studioRoot, gameRoot: null,
  });
});

test("a packaged app finds its checkout two directories above its executable", () => {
  const result = resolveStudioPaths({ studioRoot: payloadRoot, isPackaged: true, executablePath, env: {}, exists: hasFiles(sourceFiles) });
  assert.equal(result.sourceRoot, studioRoot);
  assert.equal(result.repoRoot, studioRoot);
});

test("script modules infer packaged source from their payload location", () => {
  const result = resolveStudioPaths({ studioRoot: payloadRoot, env: {}, exists: hasFiles(sourceFiles) });
  assert.equal(result.sourceRoot, studioRoot);
});

test("a relocated portable app uses its payload rather than an unrelated parent", () => {
  const result = resolveStudioPaths({ studioRoot: payloadRoot, isPackaged: true, executablePath, env: {}, exists: () => false });
  assert.equal(result.sourceRoot, payloadRoot);
  assert.equal(result.repoRoot, payloadRoot);
  assert.equal(result.gameRoot, null);
});

test("selecting another workspace does not redirect Studio source or updates", () => {
  const workspace = path.resolve("fixtures", "other-workspace");
  const result = resolveStudioPaths({ studioRoot: payloadRoot, env: { MEFI_STUDIO_REPO: workspace }, exists: hasFiles(sourceFiles) });
  assert.equal(result.sourceRoot, studioRoot);
  assert.equal(result.repoRoot, workspace);
});

test("a sibling game is optional and cannot change the builder workspace", () => {
  const gameRoot = path.join(path.dirname(studioRoot), "2d Trippy Hell");
  const result = resolveStudioPaths({ studioRoot, env: {}, exists: hasFiles(gameFiles(gameRoot)) });
  assert.equal(result.gameRoot, gameRoot);
  assert.equal(result.repoRoot, studioRoot);
});

test("an explicit game root wins without changing the selected workspace", () => {
  const gameRoot = path.resolve("fixtures", "game-elsewhere");
  const workspace = path.resolve("fixtures", "other-workspace");
  const result = resolveStudioPaths({ studioRoot, env: { MEFI_STUDIO_GAME_ROOT: gameRoot, MEFI_STUDIO_REPO: workspace }, exists: () => false });
  assert.equal(result.gameRoot, gameRoot);
  assert.equal(result.repoRoot, workspace);
  assert.equal(result.sourceRoot, studioRoot);
});

test("an existing game selected as workspace remains usable by the launcher", () => {
  const gameRoot = path.resolve("fixtures", "RuinsRunner");
  const result = resolveStudioPaths({ studioRoot, env: { MEFI_STUDIO_REPO: gameRoot }, exists: hasFiles(gameFiles(gameRoot)) });
  assert.equal(result.gameRoot, gameRoot);
  assert.equal(result.repoRoot, gameRoot);
  assert.equal(result.sourceRoot, studioRoot);
});

test("path changes restart the app before applying related modules or styles", () => {
  const update = plan(["scripts/paths.cjs", "scripts/analyzer.mjs", "renderer/styles.css"]);
  assert.equal(update.restart, true);
  assert.equal(update.reload, false);
  assert.equal(update.style, false);
  assert.deepEqual(update.modules, []);
  assert.equal(update.sync, true);
});
