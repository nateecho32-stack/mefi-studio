// Mefi's Studio AI+ — the Auditor: local wiring/gap checks for this app.
//
// Third agent alongside the assistant and the tree watcher. Pure file analysis,
// no network and no API key, so it runs on every proactive pass and in tests.
// Findings feed the request inbox (source: "audit").

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import studioPaths from "./paths.cjs";
import { findUnusedSelectors, usageIndex } from "./check-css.mjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Test registration belongs to Studio's source, even when MEFI_STUDIO_REPO
// selects another workspace for the assistant to monitor and build.
const { sourceRoot: SOURCE_ROOT } = studioPaths.resolveStudioPaths({ studioRoot: STUDIO });
const STANDALONE_PAYLOAD = SOURCE_ROOT === STUDIO &&
  path.basename(STUDIO) === "app" && path.basename(path.dirname(STUDIO)) === "resources";

async function readdirOrNull(dir) {
  try {
    return await readdir(dir);
  } catch {
    return null;
  }
}

async function readIfExists(pathname) {
  try {
    return await readFile(pathname, "utf8");
  } catch {
    return null;
  }
}

function matchAll(text, pattern) {
  const results = [];
  for (const match of text.matchAll(pattern)) results.push(match[1]);
  return results;
}

export async function audit({ root = STUDIO } = {}) {
  const findings = [];
  const add = (level, area, message) => findings.push({ level, area, message });
  const RENDERER = path.join(root, "renderer");

  const packageText = await readIfExists(path.join(root, "package.json"));
  const buildText = await readIfExists(path.join(root, "scripts", "build-booklet.mjs")) ?? "";
  const mainText = await readIfExists(path.join(root, "main.cjs")) ?? "";
  const preloadText = await readIfExists(path.join(root, "preload.cjs")) ?? "";
  const templateText = await readIfExists(path.join(RENDERER, "booklet.template.html")) ?? "";
  const rendererFiles = ((await readdirOrNull(RENDERER)) ?? []).filter((name) => name.endsWith(".js"));

  // 1. every renderer script must be inlined by the build (or the app ships without it)
  const bundled = new Set(matchAll(buildText, /readFile\(path\.join\(RENDERER, "([\w.-]+)"\)/g));
  for (const file of rendererFiles) {
    if (!bundled.has(file)) add("error", "build", `renderer/${file} is not inlined by build-booklet.mjs`);
  }

  // 2. preload bridge <-> main IPC: every invoked channel needs a handler,
  //    every listened event needs a sender.
  const invokeChannels = new Set(matchAll(preloadText, /ipcRenderer\.invoke\("([^"]+)"/g));
  const listenEvents = new Set(matchAll(preloadText, /ipcRenderer\.on\("([^"]+)"/g));
  const handledChannels = new Set(matchAll(mainText, /ipcMain\.handle\("([^"]+)"/g));
  const sentEvents = new Set(matchAll(mainText, /send\("([^"]+)"/g));
  for (const channel of invokeChannels) {
    if (!handledChannels.has(channel)) add("error", "ipc", `preload invokes "${channel}" but main.cjs has no handler`);
  }
  for (const event of listenEvents) {
    if (!sentEvents.has(event)) add("warn", "ipc", `preload listens for "${event}" but main.cjs never sends it`);
  }
  for (const channel of handledChannels) {
    if (!invokeChannels.has(channel)) add("info", "ipc", `main.cjs handles "${channel}" but no preload method invokes it`);
  }

  // 3. id lookups must exist in the template or in renderer-built UI. Covers
  // getElementById (any quote style) and static querySelector(All) selectors;
  // backtick selectors are left alone because they interpolate at runtime.
  const templateIds = new Set(matchAll(templateText, /id="([\w-]+)"/g));
  const scriptText = (await Promise.all(rendererFiles.map((name) => readIfExists(path.join(RENDERER, name))))).join("\n");
  for (const id of matchAll(scriptText, /\.id\s*=\s*["'`]([\w-]+)["'`]/g)) templateIds.add(id);
  const usedIds = new Set(matchAll(scriptText, /getElementById\(\s*["'`]([\w-]+)["'`]\s*\)/g));
  for (const selector of [
    ...matchAll(scriptText, /querySelector(?:All)?\(\s*'([^']*)'\s*\)/g),
    ...matchAll(scriptText, /querySelector(?:All)?\(\s*"([^"]*)"\s*\)/g),
  ]) {
    for (const id of matchAll(selector, /#([\w-]+)/g)) usedIds.add(id);
  }
  for (const id of usedIds) {
    if (!templateIds.has(id)) add("error", "dom", `renderer looks up #${id} but the template has no such id`);
  }

  // 4. repo test registration (the project's own rule: TESTRUNS.md + test_sets.json)
  const testRoot = SOURCE_ROOT;
  const guide = (await readIfExists(path.join(testRoot, "TESTRUNS.md"))) ?? "";
  const sets = JSON.parse((await readIfExists(path.join(testRoot, "tools", "test_sets.json"))) ?? "{}");
  const toolFiles = await readdirOrNull(path.join(testRoot, "tools"));
  const studioTests = (toolFiles ?? []).filter(
    (name) => name.startsWith("test_mefi_studio_") && name.endsWith(".py")
  );
  // A downloadable app intentionally omits the source test suite. Reporting
  // that as a repairable warning would manufacture coding tasks inside every
  // fresh distribution. A source checkout (including a portable app linked
  // back to it) must still report unexpectedly missing test infrastructure.
  if (toolFiles === null) add(STANDALONE_PAYLOAD ? "info" : "warn", "tests", STANDALONE_PAYLOAD
    ? "Source test registration is not included in this standalone distribution."
    : `repo tools/ not reachable from ${testRoot} — registration check skipped`);
  const includePatterns = sets?.sets?.dev?.pythonInclude ?? [];
  for (const test of studioTests) {
    if (!guide.includes(`\`tools/${test}\``)) add("error", "tests", `tools/${test} is missing from TESTRUNS.md`);
    if (!includePatterns.some((pattern) => new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(test))) {
      add("error", "tests", `tools/${test} matches no dev-set pythonInclude pattern`);
    }
  }

  // 5. package scripts must point at real files
  if (packageText) {
    const scripts = JSON.parse(packageText).scripts ?? {};
    for (const [name, command] of Object.entries(scripts)) {
      for (const file of matchAll(command, /(?:node )([\w./-]+\.(?:mjs|cjs|js))/g)) {
        if (!(await readIfExists(path.join(root, file)))) add("error", "scripts", `npm script "${name}" targets missing ${file}`);
      }
    }
  }

  // 6. stale markers
  const markers = [];
  for (const file of [...rendererFiles, "main.cjs", "preload.cjs"]) {
    const text = await readIfExists(path.join(RENDERER, file)) ?? (await readIfExists(path.join(root, file))) ?? "";
    for (const match of text.matchAll(/\b(TODO|FIXME|XXX)\b[^\n]*/g)) {
      markers.push({ file, text: match[0].slice(0, 100) });
    }
  }
  for (const marker of markers.slice(0, 12)) add("info", "markers", `${marker.file}: ${marker.text}`);

  // 7. data files must parse — and the two shipped catalogs must agree. Only
  //    curated.json and models.json ship, and routing resolves curated model
  //    ids and endpointMap routes against models.json, so drift between the
  //    committed files breaks model routing silently. models.json may carry
  //    roster-only ids curated.json does not list; the reverse is drift.
  const dataFiles = {};
  for (const dataFile of ["curated.json", "models.json"]) {
    dataFiles[dataFile] = await readIfExists(path.join(root, "data", dataFile));
    try {
      JSON.parse(dataFiles[dataFile] ?? "null");
    } catch {
      add("error", "data", `data/${dataFile} does not parse`);
    }
  }
  let curatedData = null;
  let modelsData = null;
  try {
    curatedData = JSON.parse(dataFiles["curated.json"] ?? "null");
    modelsData = JSON.parse(dataFiles["models.json"] ?? "null");
  } catch {
    // Unparseable files were reported above; skip the cross-check.
  }
  if (curatedData && modelsData) {
    const validId = (id) => typeof id === "string" && id.trim().length > 0;
    const catalogIds = new Set(Array.isArray(modelsData.models) ? modelsData.models.map((model) => model?.id) : []);
    if (!Array.isArray(modelsData.models) || modelsData.models.some((model) => !validId(model?.id))) {
      add("error", "data", "data/models.json has no valid models array");
    }
    for (const id of Object.keys(curatedData.models ?? {})) {
      if (!catalogIds.has(id)) add("error", "data", `data/curated.json lists ${id} but data/models.json does not carry it`);
    }
    for (const [kind, ids] of Object.entries(curatedData.endpointMap ?? {})) {
      if (!curatedData.endpoints?.[kind]) add("error", "data", `data/curated.json endpointMap routes ${kind} but data/curated.json has no ${kind} endpoint`);
      for (const id of ids ?? []) {
        if (!catalogIds.has(id)) add("error", "data", `data/curated.json endpointMap ${kind} routes ${id} but data/models.json does not carry it`);
      }
    }
  }

  // 8. dead CSS selectors: rules that keep winner keys but whose classes never
  //    appear in renderer html/js/css usage. Cascade equivalence (check-css)
  //    only proves shadowing; this is the unused-rule half.
  const rendererEntries = (await readdirOrNull(RENDERER)) ?? [];
  const cssFiles = rendererEntries.filter((name) => name.endsWith(".css"));
  // renderer/booklet.html is generated by build-booklet.mjs and bakes in a copy
  // of every stylesheet and script. Counting it as usage lets a stale baked
  // copy mask classes that were already dropped from its sources, so the
  // orphan check only reports during the rebuild window. The template, scripts
  // and sibling stylesheets below already carry every class the booklet can
  // legitimately use, so the artifact itself stays out of the usage corpus.
  const htmlText = (await Promise.all(
    rendererEntries.filter((name) => name.endsWith(".html") && name !== "booklet.html").map((name) => readIfExists(path.join(RENDERER, name)))
  )).filter(Boolean).join("\n");
  const cssTexts = await Promise.all(cssFiles.map((name) => readIfExists(path.join(RENDERER, name))));
  // The html/js corpus and each sheet are indexed once; a sheet's usage is
  // their union minus itself (same result as re-reading the joined text).
  const sharedUsage = usageIndex([htmlText, scriptText]);
  const sheetUsage = cssTexts.map((text) => usageIndex(text ?? ""));
  cssFiles.forEach((name, i) => {
    const unused = findUnusedSelectors(cssTexts[i] ?? "", usageIndex([sharedUsage, ...sheetUsage.filter((_, j) => j !== i)]));
    for (const hit of unused.slice(0, 12)) {
      add("warn", "css", `renderer/${name} line ${hit.line}: selector "${hit.selector}" keeps winner keys but its classes (${hit.missing.join(" ")}) never appear in renderer html/js/css usage`);
    }
    if (unused.length > 12) add("warn", "css", `renderer/${name}: ${unused.length - 12} more selectors with unused classes not listed`);
  });

  const errors = findings.filter((finding) => finding.level === "error").length;
  const warnings = findings.filter((finding) => finding.level === "warn").length;
  return { ok: errors === 0, findings, errors, warnings, checkedAt: new Date().toISOString() };
}

export function auditRequests(result, existing = []) {
  return result.findings
    .filter((finding) => finding.level === "error" || finding.level === "warn")
    .map((finding) => ({
      title: `Audit: ${finding.area}`,
      prompt: `A-Eyes auditor found a ${finding.level}: ${finding.message}. Fix it and re-run: python -m unittest discover -s tools -p "test_mefi_studio_*.py".`,
      area: finding.area,
      source: "audit",
      at: Date.now(),
    }))
    .filter((request) => !existing.some((item) => item.source === "audit" && item.prompt === request.prompt));
}

async function cli() {
  const result = await audit();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}
