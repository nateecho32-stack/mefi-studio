import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function extractCheckTargets(checkScript) {
  const targets = [];
  const re = /node\s+--check\s+([^\s&|;]+)/g;
  let m;
  while ((m = re.exec(checkScript)) !== null) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }
  return targets;
}

export function extractNodeRefs(scriptValue) {
  const refs = [];
  for (const raw of String(scriptValue).split("&&")) {
    const seg = raw.trim();
    if (!/^node(\s|$)/.test(seg)) continue;
    const args = seg.split(/\s+/).slice(1);
    let i = 0;
    while (i < args.length && args[i].startsWith("--")) i += 1;
    const file = args[i];
    if (!file || file.startsWith("-") || file.includes("*") || file.includes('"')) continue;
    if (!refs.includes(file)) refs.push(file);
  }
  return refs;
}

export function audit(packageRoot, checkScript) {
  const targets = extractCheckTargets(checkScript);
  const referenced = new Set(targets.map((t) => t.split("\\").join("/")));
  const missing = [];
  for (const rel of targets) {
    const abs = resolve(packageRoot, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) missing.push(rel);
  }

  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const scriptMissing = [];
  for (const [name, value] of Object.entries(pkg.scripts || {})) {
    if (name === "check") continue;
    for (const rel of extractNodeRefs(value)) {
      const abs = resolve(packageRoot, rel);
      if (!existsSync(abs) || !statSync(abs).isFile()) scriptMissing.push({ script: name, path: rel });
    }
  }

  const unreferenced = [];
  for (const [dir, ext] of [["scripts", ".mjs"], ["renderer", ".js"]]) {
    const dirAbs = join(packageRoot, dir);
    if (!existsSync(dirAbs)) {
      missing.push(dir + "/");
      continue;
    }
    for (const name of readdirSync(dirAbs)) {
      if (!name.endsWith(ext)) continue;
      const rel = `${dir}/${name}`;
      if (!referenced.has(rel)) unreferenced.push(rel);
    }
  }

  const mainEntry = pkg.main;
  if (mainEntry && /\.(cjs|js|mjs)$/.test(mainEntry) && !referenced.has(mainEntry.split("\\").join("/"))) {
    unreferenced.push(mainEntry);
  }

  return { targets, missing, scriptMissing, unreferenced };
}

export function main(argv = process.argv.slice(2)) {
  let packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const pkgIdx = argv.indexOf("--package");
  if (pkgIdx !== -1 && argv[pkgIdx + 1]) packageRoot = resolve(argv[pkgIdx + 1]);
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const checkScript = pkg.scripts && pkg.scripts.check;
  if (!checkScript) {
    console.error("check-targets: no scripts.check in package.json");
    return 1;
  }
  const { missing, scriptMissing, unreferenced } = audit(packageRoot, checkScript);
  for (const rel of missing) {
    console.error(`check-targets: MISSING target referenced by "check": ${rel}`);
  }
  for (const { script, path } of scriptMissing) {
    console.error(`check-targets: MISSING node target in script "${script}": ${path}`);
  }
  for (const rel of unreferenced) {
    console.error(`check-targets: NOT covered by "check" (add node --check ${rel}): ${rel}`);
  }
  if (missing.length > 0 || scriptMissing.length > 0 || unreferenced.length > 0) {
    console.error(`check-targets: ${missing.length + scriptMissing.length} missing, ${unreferenced.length} uncovered`);
    return 1;
  }
  console.log(`check-targets: ok (${extractCheckTargets(checkScript).length} targets, full coverage)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main());
}
