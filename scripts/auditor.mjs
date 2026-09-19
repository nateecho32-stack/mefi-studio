// Mefi's Studio AI+ — the Auditor: local wiring/gap checks for this app.
//
// Third agent alongside the assistant and the tree watcher. Pure file analysis,
// no network and no API key, so it runs on every proactive pass and in tests.
// Findings feed the request inbox (source: "audit").

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import studioPaths from "./paths.cjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RENDERER = path.join(STUDIO, "renderer");

// Test registration belongs to Studio's source, even when MEFI_STUDIO_REPO
// selects another workspace for the assistant to monitor and build.
const { sourceRoot: SOURCE_ROOT } = studioPaths.resolveStudioPaths({ studioRoot: STUDIO });

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

export async function audit() {
  const findings = [];
  const add = (level, area, message) => findings.push({ level, area, message });

  const packageText = await readIfExists(path.join(STUDIO, "package.json"));
  const buildText = await readIfExists(path.join(STUDIO, "scripts", "build-booklet.mjs")) ?? "";
  const mainText = await readIfExists(path.join(STUDIO, "main.cjs")) ?? "";
  const preloadText = await readIfExists(path.join(STUDIO, "preload.cjs")) ?? "";
  const templateText = await readIfExists(path.join(RENDERER, "booklet.template.html")) ?? "";
  const rendererFiles = ((await readdirOrNull(RENDERER)) ?? []).filter((name) => name.endsWith(".js"));

  // 1. every renderer script must be inlined by the build (or the app ships without it)
  const bundled = new Set(matchAll(buildText, /readFile\(path\.join\(RENDERER, "([\w.]+)"\)/g));
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

  // 3. getElementById targets must exist in the template
  const templateIds = new Set(matchAll(templateText, /id="([\w-]+)"/g));
  const scriptText = (await Promise.all(rendererFiles.map((name) => readIfExists(path.join(RENDERER, name))))).join("\n");
  const usedIds = new Set(matchAll(scriptText, /getElementById\("([\w-]+)"\)/g));
  for (const id of usedIds) {
    if (!templateIds.has(id)) add("error", "dom", `renderer looks up #${id} but the template has no such id`);
  }

  // 4. repo test registration (the project's own rule: TESTRUNS.md + test_sets.json)
  const root = SOURCE_ROOT;
  const guide = (await readIfExists(path.join(root, "TESTRUNS.md"))) ?? "";
  const sets = JSON.parse((await readIfExists(path.join(root, "tools", "test_sets.json"))) ?? "{}");
  const toolFiles = await readdirOrNull(path.join(root, "tools"));
  const studioTests = (toolFiles ?? []).filter(
    (name) => name.startsWith("test_mefi_studio_") && name.endsWith(".py")
  );
  if (toolFiles === null) add("warn", "tests", `repo tools/ not reachable from ${root} — registration check skipped`);
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
        if (!(await readIfExists(path.join(STUDIO, file)))) add("error", "scripts", `npm script "${name}" targets missing ${file}`);
      }
    }
  }

  // 6. stale markers
  const markers = [];
  for (const file of [...rendererFiles, "main.cjs", "preload.cjs"]) {
    const text = await readIfExists(path.join(RENDERER, file)) ?? (await readIfExists(path.join(STUDIO, file))) ?? "";
    for (const match of text.matchAll(/\b(TODO|FIXME|XXX)\b[^\n]*/g)) {
      markers.push({ file, text: match[0].slice(0, 100) });
    }
  }
  for (const marker of markers.slice(0, 12)) add("info", "markers", `${marker.file}: ${marker.text}`);

  // 7. data files must parse
  for (const dataFile of ["curated.json", "models.json"]) {
    const text = await readIfExists(path.join(STUDIO, "data", dataFile));
    try {
      JSON.parse(text ?? "null");
    } catch {
      add("error", "data", `data/${dataFile} does not parse`);
    }
  }

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
