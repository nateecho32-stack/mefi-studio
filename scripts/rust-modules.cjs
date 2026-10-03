"use strict";
// Engine modules whose functions moved to Rust (crates/mefi-core;
// docs/rust-migration.md, stage 2). Under the Rust host, main.cjs's
// loadModule hands out such a module with those functions answered by Rust;
// everything else in it, and the module everywhere else (the Electron build,
// npm run sync, the tests), stays the JavaScript. Each list is held to its
// JavaScript by tests/rust_parity_<module>.test.mjs.
//
// A function argument (sync's `check`, a worktree action's `inUse`) crosses
// as a handle the host calls back while the call is in flight
// (scripts/tauri-electron.cjs __rust.callWithFunctions).

const PORTED = Object.freeze({
  "scripts/sync.mjs": Object.freeze({ key: "sync", functions: Object.freeze(["sync", "inspect", "remoteMoved", "changedFiles", "lostWork"]) }),
  "scripts/worktrees.mjs": Object.freeze({ key: "worktrees", functions: Object.freeze(["listWorktrees", "inspectWorktree"]) }),
  "scripts/worktree-actions.mjs": Object.freeze({ key: "worktree-actions", functions: Object.freeze(["mergeWorktree", "removeWorktree", "pruneWorktrees", "worktreeFolder"]) }),
});

function rustHost() {
  if (process.env.MEFI_STUDIO_HOST !== "tauri") return null;
  try {
    return require("./tauri-electron.cjs").__rust ?? null;
  } catch {
    return null;
  }
}

// The module as main.cjs should see it: the same exports, with the ported
// functions calling Rust. `host` is a seam for tests.
function withRust(rel, module, host = rustHost()) {
  const entry = PORTED[String(rel ?? "").replace(/\\/g, "/")];
  if (!entry || !host || typeof host.callWithFunctions !== "function") return module;
  const served = Object.create(null);
  Object.assign(served, module);
  for (const name of entry.functions) {
    if (typeof module[name] !== "function") continue;
    served[name] = (...args) => host.callWithFunctions(`repo.${entry.key}.${name}`, args);
  }
  served.__rust = Object.freeze({ module: entry.key, functions: entry.functions });
  return Object.freeze(served);
}

// Host factories whose whole object moved to Rust: the factory's
// collaborators (functions) stay in the engine and are called back per call.
// Each answers like the JavaScript factory of the same name.
const FACTORIES = Object.freeze({
  "project-files": (collaborators, host) => {
    const call = (name, ...args) => host.callWithFunctions(`core.files.${name}`, [collaborators, ...args]);
    return Object.freeze({
      search: (request = {}) => call("search", request ?? {}),
      resolve: (paths) => call("resolve", paths),
      forget: () => {
        host.callWithFunctions("core.files.forget", []).catch(() => {});
      },
    });
  },
});

// The Rust-backed object for a host factory, or null to use the JavaScript one.
function factory(name, collaborators, host = rustHost()) {
  const make = FACTORIES[name];
  if (!make || !host || typeof host.callWithFunctions !== "function") return null;
  return make(collaborators, host);
}

module.exports = { PORTED, FACTORIES, withRust, factory };
