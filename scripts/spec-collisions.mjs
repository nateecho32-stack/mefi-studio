// Guard against the duplicate-spec collisions that bit three sessions in a
// row: two spec files sharing a basename (Python's unittest discovery imports
// by basename, so two same-named specs anywhere under tools/ shadow each
// other), and a contract spec whose name the npm-test discovery pattern
// ("test_mefi_studio_*.py") never picks up, leaving it silently unrun unless
// a test_mefi_studio_* shim re-exports it. See CONTRIBUTING.md for the
// convention this enforces.
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SPEC_DIRS = ["tools", "tests"];

function isSpecFile(name) {
  return /\.test\.mjs$/.test(name) || /^test_.*\.(py|mjs|cjs|js)$/.test(name);
}

export function scanSpecs(packageRoot, specDirs = SPEC_DIRS) {
  const specs = [];
  const missing = [];
  for (const dir of specDirs) {
    const dirAbs = join(packageRoot, dir);
    let pending = [dirAbs];
    if (!statSyncSafe(dirAbs)) {
      missing.push(`${dir}/`);
      continue;
    }
    while (pending.length > 0) {
      const current = pending.pop();
      for (const name of readdirSync(current)) {
        const abs = join(current, name);
        const rel = `${dir}/${abs.slice(dirAbs.length + 1).split("\\").join("/")}`;
        let stats;
        try {
          stats = statSync(abs);
        } catch {
          continue;
        }
        if (stats.isDirectory()) pending.push(abs);
        else if (isSpecFile(name)) specs.push({ rel, name, base: name.replace(/\.[^.]+$/, "").toLowerCase() });
      }
    }
  }

  const byBase = new Map();
  for (const spec of specs) {
    if (!byBase.has(spec.base)) byBase.set(spec.base, []);
    byBase.get(spec.base).push(spec.rel);
  }
  const duplicates = [...byBase.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([base, files]) => ({ base, files }));

  // A tools/test_*.py contract outside the discovery pattern needs a
  // test_mefi_studio_<stem>.py shim, or npm test never runs it.
  const orphans = [];
  for (const spec of specs) {
    if (!/^tools\/test_.*\.py$/.test(spec.rel)) continue;
    if (/^tools\/test_mefi_studio_.*\.py$/.test(spec.rel)) continue;
    const stem = spec.rel.slice("tools/test_".length).replace(/\.py$/, "");
    const shim = `tools/test_mefi_studio_${stem}.py`;
    if (!specs.some((row) => row.rel === shim)) orphans.push({ spec: spec.rel, shim });
  }

  return { specs, missing, duplicates, orphans };
}

function statSyncSafe(abs) {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

export function main(argv = process.argv.slice(2)) {
  let packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const rootIdx = argv.indexOf("--package");
  if (rootIdx !== -1 && argv[rootIdx + 1]) packageRoot = resolve(argv[rootIdx + 1]);
  const { specs, missing, duplicates, orphans } = scanSpecs(packageRoot);
  for (const dir of missing) {
    console.error(`spec-collisions: MISSING spec directory: ${dir}`);
  }
  for (const { base, files } of duplicates) {
    console.error(`spec-collisions: DUPLICATE spec basename "${base}" (${files.length} files):`);
    for (const rel of files) console.error(`  ${rel}`);
  }
  for (const { spec, shim } of orphans) {
    console.error(`spec-collisions: ORPHAN spec not matched by "npm test" discovery: ${spec} (add shim ${shim})`);
  }
  const count = duplicates.length + orphans.length + missing.length;
  if (count > 0) {
    console.error(`spec-collisions: ${count} problem(s) — see CONTRIBUTING.md "Test file conventions"`);
    return 1;
  }
  console.log(`spec-collisions: ok (${specs.length} specs, unique basenames, no orphans)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main());
}
