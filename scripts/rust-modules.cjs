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

// The kill switch: MEFI_STUDIO_RUST_OFF=git-actions,sync (or "all") keeps
// those ports on their JavaScript under the Rust host, read at each lookup.
function off(name, env = process.env) {
  return String(env.MEFI_STUDIO_RUST_OFF ?? "").split(",").map((item) => item.trim()).some((item) => item === name || item === "all");
}

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
  if (!entry || off(entry.key) || !host || typeof host.callWithFunctions !== "function") return module;
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
  // The Git chip's actions (scripts/git-actions.cjs createGitActions). git and
  // gh run from Rust; the engine's `env` is called back once per call, and a
  // push's `check`, link's `isListed` and publish's `onProgress` when used.
  // Like the JavaScript, every method answers and none throws.
  "git-actions": (collaborators, host) => {
    const call = (name, ...args) => host.callWithFunctions(`core.git.${name}`, [collaborators, ...args]);
    const failed = (error) => ({ ok: false, kind: "error", error: `Something went wrong: ${String(error?.message ?? error).replace(/(:\/\/)[^\s/]*@/g, "$1")}` });
    const guarded = (name) => (...args) => call(name, ...args).catch(failed);
    return Object.freeze({
      glance: (root, options = {}) => call("glance", root, options ?? {}).catch(() => null),
      glanceMany: (list) => call("glanceMany", list).catch(() => []),
      preview: (root, options = {}) => guarded("preview")(root, options ?? {}),
      save: (root, options = {}) => guarded("save")(root, options ?? {}),
      pushBranch: (root, options = {}) => guarded("pushBranch")(root, options ?? {}),
      publish: (root, options = {}) => guarded("publish")(root, options ?? {}),
      link: (root, options = {}) => guarded("link")(root, options ?? {}),
      owners: guarded("owners"),
      nameCheck: (owner, name) => guarded("nameCheck")(owner, name),
      publishPreview: (root, options = {}) => guarded("publishPreview")(root, options ?? {}),
      account: guarded("account"),
      identity: guarded("identity"),
    });
  },
  // Before and after shots (scripts/evidence-window.cjs createEvidenceWindow):
  // the host opens its own hidden window (src-tauri/src/views.rs
  // evidence.capture) and keeps the same request rule in Rust. Like the
  // JavaScript: one shot at a time, a failure is logged, and nothing throws.
  "evidence-window": (collaborators, host) => {
    const rules = require("./attempt-evidence.cjs");
    const log = typeof collaborators?.log === "function" ? collaborators.log : () => {};
    let tail = Promise.resolve();
    const one = async (url, { width = rules.LIMITS.width, height = rules.LIMITS.height, timeoutMs = rules.LIMITS.timeoutMs, settleMs = rules.LIMITS.settleMs, allow = null } = {}) => {
      const address = rules.loopback(url);
      if (!address || !allow?.host || allow.host !== address.host) return { ok: false, error: "not a local address" };
      try {
        const answer = await host.call("evidence.capture", address.url, { width, height, timeoutMs, settleMs, allow: { host: String(allow.host), secure: allow.secure === true } });
        if (answer?.ok && answer.png?.length) return { ok: true, png: Buffer.from(answer.png) };
        return { ok: false, error: String(answer?.error ?? "no picture").slice(0, 120) };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error).replace(/https?:\/\/\S+/g, "<address>").slice(0, 120) };
      }
    };
    return Object.freeze({
      capture(url, options = {}) {
        const next = tail.then(() => one(url, options), () => one(url, options));
        tail = next.then(() => {}, () => {});
        return next.then((result) => {
          if (!result.ok) log(`[review] shot not taken (${String(result.error ?? "unknown").slice(0, 60)})`);
          return result;
        });
      },
    });
  },
});

// The Rust-backed object for a host factory, or null to use the JavaScript one.
function factory(name, collaborators, host = rustHost()) {
  const make = FACTORIES[name];
  if (!make || off(name) || !host || typeof host.callWithFunctions !== "function") return null;
  return make(collaborators, host);
}

module.exports = { PORTED, FACTORIES, withRust, factory, off };
