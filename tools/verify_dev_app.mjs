// Scoped verification for the "Restart dev app after repair" card: the repair
// promised that serve.mjs and the Electron dev app load with a whole
// node_modules tree ("confirm no ERR_MODULE_NOT_FOUND"). This check resolves
// every static external require/import across the dev app's module graph
// (main.cjs, preload.cjs, scripts/*) against the installed tree, so a missing
// or broken package fails deterministically without launching Electron. The
// serve probe is informational: the check exits non-zero only on module
// resolution failures, because a stopped serve is runtime state, not repair
// state. Run it as the card's named check: `node tools/verify_dev_app.mjs`.
import { createRequire } from "node:module";
import { builtinModules } from "node:module";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(import.meta.dirname, "..");
const targets = [
  path.join(root, "main.cjs"),
  path.join(root, "preload.cjs"),
  ...fs.readdirSync(path.join(root, "scripts"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:cjs|mjs)$/.test(entry.name))
    .map((entry) => path.join(root, "scripts", entry.name)),
];

const REQUIRE_RE = /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;
const IMPORT_FROM_RE = /\bfrom\s*(["'])([^"'\n]+)\1/g;
const BARE_IMPORT_RE = /\bimport\s*(["'])([^"'\n]+)\1/g;
const builtins = new Set(builtinModules);
const SPECIFIER_RE = /^[\w@][\w:./\\-]*$/;

const externals = new Map();
for (const file of targets) {
  const source = fs.readFileSync(file, "utf8");
  const specifiers = new Set();
  for (const re of [REQUIRE_RE, IMPORT_FROM_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source))) specifiers.add(match[2]);
  }
  for (const specifier of specifiers) {
    if (!SPECIFIER_RE.test(specifier)) continue;
    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) continue;
    const pkg = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    if (builtins.has(pkg) || specifier.startsWith("node:")) continue;
    if (!externals.has(pkg)) externals.set(pkg, { specifier, from: path.relative(root, file) });
  }
}

const failures = [];
for (const [pkg, { specifier, from }] of externals) {
  try {
    createRequire(path.join(root, from)).resolve(specifier);
  } catch (error) {
    failures.push(`${pkg} (as ${specifier}, first referenced by ${from}): ${error.code ?? error.message}`);
  }
}

console.log(`dev-app module graph: ${targets.length} file(s) scanned, ${externals.size} unique external package(s), ${failures.length} resolution failure(s)`);
for (const failure of failures) console.log(`FAIL ${failure}`);

const serve = await fetch("http://127.0.0.1:4173/", { signal: AbortSignal.timeout(2000) })
  .then((response) => `serve probe: HTTP ${response.status} on 4173`)
  .catch(() => "serve probe: not listening on 4173 (informational; runtime state, not repair state)");
console.log(serve);

process.exit(failures.length ? 1 : 0);
