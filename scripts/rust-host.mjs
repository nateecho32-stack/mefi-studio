// Builds, tests and runs the Rust host (src-tauri), stage 1 of
// docs/rust-migration.md. Cargo's target folder goes to
// %LOCALAPPDATA%\MefiStudio\rust-target: the checkout may sit in OneDrive,
// which would sync gigabytes of build output, and the Windows resource
// compiler cannot open a path with an apostrophe ("Mefi's Studio AI+").
//
//   node scripts/rust-host.mjs build [--release]
//   node scripts/rust-host.mjs release-build           the host program a portable build ships
//                                                      (<target>/release/mefi-studio.exe, which
//                                                      package-portable.mjs --host tauri takes)
//   node scripts/rust-host.mjs test
//   node scripts/rust-host.mjs run [-- studio flags]
//   node scripts/rust-host.mjs core-build | core-test   the engine crate (crates/mefi-core)
//
// CARGO_BUILD_JOBS defaults to 2 here: a Tauri build holds about 1 GB per
// job, and the owner's laptop has little free memory (MEFI_RUST_JOBS overrides).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crate = join(root, "src-tauri");
const core = join(root, "crates", "mefi-core");

export function targetDir(env = process.env) {
  if (env.CARGO_TARGET_DIR) return env.CARGO_TARGET_DIR;
  const base = env.LOCALAPPDATA || join(homedir(), ".cache");
  return join(base, "MefiStudio", "rust-target");
}

/** The host program `release-build` writes, which a portable build ships. */
export function hostBinary(env = process.env, profile = "release") {
  return join(targetDir(env), profile, process.platform === "win32" ? "mefi-studio.exe" : "mefi-studio");
}

/** The mefi-core binary the parity tests run (MEFI_CORE_BIN overrides). */
export function coreBinary(env = process.env) {
  if (env.MEFI_CORE_BIN) return env.MEFI_CORE_BIN;
  return join(targetDir(env), "debug", process.platform === "win32" ? "mefi-core.exe" : "mefi-core");
}

function cargo() {
  const home = process.env.CARGO_HOME || join(homedir(), ".cargo");
  const local = join(home, "bin", process.platform === "win32" ? "cargo.exe" : "cargo");
  return existsSync(local) ? local : "cargo";
}

function main(argv) {
  const [command = "build", ...rest] = argv;
  const split = rest.indexOf("--");
  const own = split >= 0 ? rest.slice(0, split) : rest;
  const passed = split >= 0 ? rest.slice(split + 1) : [];
  const release = own.includes("--release");
  const args = {
    build: ["build", ...(release ? ["--release"] : [])],
    // custom-protocol: what the Tauri CLI turns on for a release (no dev-server code paths).
    "release-build": ["build", "--release", "-p", "mefi-studio-host", "--features", "custom-protocol"],
    test: ["test", "--lib"],
    check: ["check"],
    run: ["run", ...(release ? ["--release"] : []), "--", ...passed],
    "core-build": ["build", ...(release ? ["--release"] : [])],
    "core-test": ["test", "--lib"],
  }[command];
  if (!args) {
    console.error(`usage: node scripts/rust-host.mjs build|release-build|test|check|run|core-build|core-test [--release] [-- studio flags]`);
    return 2;
  }
  const env = {
    ...process.env,
    // A source run: the host finds Studio's files here, as `npm start` did.
    MEFI_STUDIO_ROOT: process.env.MEFI_STUDIO_ROOT || root,
    CARGO_TARGET_DIR: targetDir(),
    CARGO_BUILD_JOBS: process.env.MEFI_RUST_JOBS || process.env.CARGO_BUILD_JOBS || "2",
  };
  const child = spawn(cargo(), args, { cwd: command.startsWith("core-") ? core : crate, env, stdio: "inherit", windowsHide: true });
  child.on("exit", (code) => process.exit(code ?? 1));
  return null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = main(process.argv.slice(2));
  if (code !== null) process.exit(code);
}
