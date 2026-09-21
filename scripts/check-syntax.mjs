// One in-process syntax pass over every source the package ships. It
// replaces the `node --check` chain that spawned about ninety Node processes
// in series: of the 15 s `npm run check` took, 13 s were those spawns and
// the real checks under 2 s. Each file is compiled the way Node would load
// it and never evaluated: CommonJS (.cjs, and .js outside a "type": "module"
// package) through the module wrapper, ES modules (.mjs, and .js under a
// "type": "module" package) as module source. scripts/check-targets.mjs
// treats this pass as covering everything discoverTargets finds, so a new
// script or renderer file cannot slip out of the gate.
//
// Module source needs vm.SourceTextModule, which Node keeps behind
// --experimental-vm-modules. Launched without it, the script relaunches
// itself once with the flag; if Node refuses the flag it falls back to a
// bounded pool of `node --check` processes, slower but the same verdicts.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import vm from "node:vm";

const CJS_PARAMS = ["exports", "require", "module", "__filename", "__dirname"];
const SOURCE_DIRS = [["scripts", [".mjs", ".cjs"]], ["renderer", [".js", ".mjs", ".cjs"]]];
const VM_MODULE_FLAGS = ["--experimental-vm-modules", "--disable-warning=ExperimentalWarning"];
const RELAUNCHED = "MEFI_CHECK_SYNTAX_RELAUNCHED";

function readPackage(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

// The package's entry, preload.cjs, and every script and renderer source: the
// files the explicit chain listed, plus preload.cjs, in a stable order.
export function discoverTargets(packageRoot) {
  const targets = [];
  const add = (rel) => {
    const key = rel.split("\\").join("/");
    if (!targets.includes(key)) targets.push(key);
  };
  const main = readPackage(packageRoot)?.main;
  if (typeof main === "string" && /\.(cjs|mjs|js)$/.test(main) && existsSync(join(packageRoot, main))) add(main);
  if (existsSync(join(packageRoot, "preload.cjs"))) add("preload.cjs");
  for (const [dir, exts] of SOURCE_DIRS) {
    const abs = join(packageRoot, dir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    for (const name of readdirSync(abs).sort()) {
      if (exts.includes(extname(name)) && statSync(join(abs, name)).isFile()) add(`${dir}/${name}`);
    }
  }
  return targets;
}

// Node's format rule: .cjs and .mjs say so themselves; .js follows the nearest
// package.json "type". A .js file under a package with no type is tried as
// CommonJS first and as a module when that fails, the way Node detects it.
export function formatFor(file) {
  const ext = extname(file);
  if (ext === ".cjs") return "commonjs";
  if (ext === ".mjs") return "module";
  let dir = dirname(resolve(file));
  for (;;) {
    if (existsSync(join(dir, "package.json"))) {
      const type = readPackage(dir)?.type;
      return type === "module" ? "module" : type === "commonjs" ? "commonjs" : "detect";
    }
    const parent = dirname(dir);
    if (parent === dir) return "detect";
    dir = parent;
  }
}

export const vmModulesAvailable = () => typeof vm.SourceTextModule === "function";

function compile(file, source, format) {
  // A hashbang is only legal at the very start of a script or module; the
  // CommonJS wrapper compiles a function body, so blank it in place.
  const code = source.replace(/^\uFEFF/, "").replace(/^#!/, "//");
  if (format === "module") new vm.SourceTextModule(code, { identifier: file });
  else vm.compileFunction(code, CJS_PARAMS, { filename: file });
}

// null when the source parses, otherwise the SyntaxError Node would report.
export function checkSource(file, source, format = formatFor(file)) {
  if (format === "detect") {
    try {
      compile(file, source, "commonjs");
      return null;
    } catch (error) {
      try {
        compile(file, source, "module");
        return null;
      } catch {
        return error;
      }
    }
  }
  try {
    compile(file, source, format);
    return null;
  } catch (error) {
    return error;
  }
}

// `file:line SyntaxError: message`, then the source line and caret Node
// prints, when the error carries them.
export function describeError(file, error) {
  const lines = String(error?.stack ?? "").split(/\r?\n/);
  const line = lines[0]?.match(/:(\d+)$/)?.[1];
  const head = lines.findIndex((text, index) => index > 0 && text.startsWith(`${error?.name}:`));
  const excerpt = head > 1 ? lines.slice(1, head).filter((text) => text.trim()) : [];
  return [`check-syntax: ${file}${line ? `:${line}` : ""} ${error?.name ?? "Error"}: ${error?.message ?? error}`, ...excerpt.map((text) => `  ${text}`)].join("\n");
}

// A SyntaxError from vm.SourceTextModule names no line. For the rare failing
// module file, ask `node --check` once and reshape its report (path:line,
// source line, caret, message) into the same stack layout compileFunction
// produces, so describeError prints both kinds alike.
function locateWithNode(packageRoot, rel, error) {
  const probe = spawnSync(process.execPath, ["--check", resolve(packageRoot, rel)], { cwd: packageRoot, encoding: "utf8" });
  if (probe.error || probe.status === 0) return error;
  const lines = String(probe.stderr ?? "").split(/\r?\n/);
  const at = lines.findIndex((text) => /:(\d+)\s*$/.test(text));
  const tail = lines.findIndex((text, index) => index > at && /^[A-Za-z]*Error:/.test(text));
  if (at < 0 || tail < 0) return error;
  const [, name, message] = lines[tail].match(/^([A-Za-z]*Error):\s*(.*)$/);
  const located = new Error(message);
  located.name = name;
  located.stack = [`${rel}:${lines[at].match(/:(\d+)\s*$/)[1]}`, ...lines.slice(at + 1, tail), `${name}: ${message}`].join("\n");
  return located;
}

export function checkFiles(packageRoot, files = discoverTargets(packageRoot)) {
  const failures = [];
  for (const rel of files) {
    const abs = resolve(packageRoot, rel);
    let source;
    try {
      source = readFileSync(abs, "utf8");
    } catch (error) {
      failures.push({ file: rel, error });
      continue;
    }
    const error = checkSource(abs, source);
    if (error) failures.push({ file: rel, error: /:\d+$/.test(String(error.stack ?? "").split(/\r?\n/)[0] ?? "") ? error : locateWithNode(packageRoot, rel, error) });
  }
  return failures;
}

// Without vm modules: `node --check` per file, a few at a time.
export function checkWithNode(packageRoot, files, concurrency = 4) {
  return new Promise((done) => {
    const failures = [];
    const queue = [...files];
    let running = 0;
    const launch = () => {
      if (!queue.length && !running) return done(failures);
      while (running < concurrency && queue.length) {
        const rel = queue.shift();
        running += 1;
        let settled = false;
        let stderr = "";
        const finish = (code, launchError) => {
          if (settled) return;
          settled = true;
          running -= 1;
          if (launchError || code !== 0) {
            const error = new Error(launchError ? launchError.message : stderr.trim() || `node --check exited with ${code}`);
            error.name = launchError ? "Error" : "SyntaxError";
            failures.push({ file: rel, error });
          }
          launch();
        };
        const child = spawn(process.execPath, ["--check", resolve(packageRoot, rel)], { cwd: packageRoot, stdio: ["ignore", "ignore", "pipe"] });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", (error) => finish(null, error));
        child.on("close", (code) => finish(code, null));
      }
    };
    launch();
  });
}

export async function main(argv = process.argv.slice(2)) {
  let packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const pkgIdx = argv.indexOf("--package");
  if (pkgIdx !== -1 && argv[pkgIdx + 1]) packageRoot = resolve(argv[pkgIdx + 1]);
  const explicit = argv.filter((arg, index) => !arg.startsWith("--") && argv[index - 1] !== "--package");
  const files = explicit.length ? explicit : discoverTargets(packageRoot);
  const needsModules = files.some((file) => formatFor(resolve(packageRoot, file)) !== "commonjs");
  let mode = "in-process";
  let failures;
  if (!needsModules || vmModulesAvailable()) {
    failures = checkFiles(packageRoot, files);
  } else if (!process.env[RELAUNCHED] && VM_MODULE_FLAGS.every((flag) => process.allowedNodeEnvironmentFlags.has(flag.split("=")[0]))) {
    const child = spawnSync(process.execPath, [...VM_MODULE_FLAGS, fileURLToPath(import.meta.url), ...argv], { stdio: "inherit", env: { ...process.env, [RELAUNCHED]: "1" } });
    if (!child.error && typeof child.status === "number") return child.status;
    mode = "node --check";
    failures = await checkWithNode(packageRoot, files);
  } else {
    mode = "node --check";
    failures = await checkWithNode(packageRoot, files);
  }
  for (const { file, error } of failures) console.error(describeError(file, error));
  if (failures.length) {
    console.error(`check-syntax: ${failures.length} of ${files.length} files failed (${mode})`);
    return 1;
  }
  console.log(`check-syntax: ok (${files.length} files, ${mode})`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(await main());
}
