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
  // The Skills page's files (scripts/skills.cjs createSkills): Rust reads and
  // writes the folders; the project root, the switch, the safety folder and
  // the inventory are called back, and so is the zip writer, with the
  // SKILL.md-only filter added here because a function cannot cross. `enabled`
  // and `OFF` stay the engine's own: main.cjs reads them without waiting.
  // Like the JavaScript, every method answers and none throws.
  "skills": (collaborators, host) => {
    const { OFF } = require("./skills.cjs");
    const zip = typeof collaborators?.zip === "function"
      ? (source, target, options = {}) => collaborators.zip(source, target, { ...options, include: (relative) => relative === "SKILL.md" })
      : undefined;
    const sent = { ...collaborators, zip };
    const call = (name, ...args) => host.callWithFunctions(`core.skills.${name}`, [sent, ...args])
      .catch((error) => ({ ok: false, error: `That could not be done (${String(error?.message ?? error).slice(0, 80)}).` }));
    const enabled = typeof collaborators?.enabled === "function" ? collaborators.enabled : () => true;
    return Object.freeze({
      list: () => call("list"),
      read: (name) => call("read", name),
      save: (draft = {}) => call("save", draft ?? {}),
      create: (draft = {}) => call("create", draft ?? {}),
      delete: (name) => call("delete", name),
      importFrom: (folder) => call("importFrom", folder),
      exportTo: (request = {}) => call("exportTo", request ?? {}),
      enabled,
      OFF,
    });
  },
  // A message's pictures (scripts/image-store.cjs createImageStore): Rust reads
  // and writes the attachments folder and checks every picture
  // (image-attach.cjs's rules). The folder, the ids still named and the
  // preview maker are called back; `keep` answers a Set, which cannot cross,
  // so it goes as an array, and a preview's bytes come back as a Buffer.
  // `folder` stays the engine's (main.cjs reads it without waiting).
  "image-store": (collaborators, host) => {
    const path = require("node:path");
    const bytesOf = (value) => (Buffer.isBuffer(value) || ArrayBuffer.isView(value) ? Buffer.from(value)
      : value?.$mefi === "bytes" ? Buffer.from(String(value.b64 ?? ""), "base64") : Buffer.alloc(0));
    const sent = {
      dir: collaborators.dir,
      ...(typeof collaborators.keep === "function" ? { keep: async () => [...((await collaborators.keep()) ?? [])] } : {}),
      ...(typeof collaborators.thumbnail === "function" ? { thumbnail: (bytes, mime) => collaborators.thumbnail(bytesOf(bytes), mime) } : {}),
    };
    const call = (name, ...args) => host.callWithFunctions(`core.images.${name}`, [sent, ...args]);
    const said = (lead) => (error) => ({ ok: false, error: `${lead}${String(error?.message ?? error).slice(0, 120)}` });
    return Object.freeze({
      save: (request = {}) => call("save", request ?? {}).catch(said("The picture could not be saved: ")),
      resolve: (value) => call("resolve", value ?? null).catch(said("")),
      load: (entry) => call("load", entry),
      read: (id) => call("read", id ?? null).catch(said("The picture could not be read: ")),
      remove: (id) => call("remove", id ?? null).catch(() => ({ ok: true })),
      prune: (options = {}) => call("prune", { ...(options?.keep instanceof Set ? { keep: [...options.keep] } : Array.isArray(options?.keep) ? { keep: options.keep } : {}) }),
      folder: () => path.resolve(String(collaborators.dir())),
    });
  },
  // The Git chip's host layer (scripts/git-host.cjs createGitHost) with the
  // actions under it: Rust keeps the chip's memory (each project's last sync,
  // the refusal still standing, the last action's outcome, the account as last
  // asked), runs the writers one at a time and the Git actions in-process, and
  // words the chip with git-link's describe. The engine's context, project
  // list, syncProject, send and pcSetup are called back. A project check is a
  // function, which cannot cross back: it is asked for (projectCheck) and run
  // (runCheck) on this side. The "Done" state's expiry stays a timer here: a
  // writer's answer names the outcome (__settle), and `later` asks Rust to draw
  // the chip again after it. Like the JavaScript, every method answers.
  "git-host": (collaborators, host) => {
    const OUTCOME_MS = 6000;
    const { actions, pcSetup, send, syncProject, context, listProjects, projectCheck, later, now } = collaborators ?? {};
    let last = null;
    const scrub = (value) => String(value?.message ?? value ?? "").replace(/(:\/\/)[^/@\s]+@/g, "$1").slice(0, 300);
    const call = async (name, payload = null) => {
      let held = null;
      const sent = {
        actions: actions ?? {},
        ...(typeof context === "function" ? { context } : {}),
        ...(typeof listProjects === "function" ? { listProjects } : {}),
        ...(typeof syncProject === "function" ? { syncProject } : {}),
        ...(typeof projectCheck === "function" ? {
          projectCheck: async (root) => { held = await projectCheck(root); return { present: typeof held === "function" }; },
          runCheck: async () => (typeof held === "function" ? held() : null),
        } : {}),
        ...(typeof pcSetup?.repos === "function" ? { pcRepos: () => pcSetup.repos() } : {}),
        ...(typeof pcSetup?.isListed === "function" ? { isListed: pcSetup.isListed } : {}),
        send: (channel, model) => { if (channel === "git:state") last = model; return typeof send === "function" ? send(channel, model) : undefined; },
        ...(typeof now === "function" ? { now } : {}),
      };
      const answer = await host.callWithFunctions(`core.git.host.${name}`, [sent, payload]);
      if (answer && typeof answer === "object" && !Array.isArray(answer) && answer.__settle) {
        const token = answer.__settle;
        delete answer.__settle;
        if (typeof later === "function") later(OUTCOME_MS + 250, () => { call("settle", token).catch(() => {}); });
      }
      if (name === "state" && answer?.ok && answer.model) last = answer.model;
      return answer;
    };
    const failed = (error) => ({ ok: false, error: scrub(error) || "Sync could not run." });
    const method = (name) => (payload = {}) => call(name, payload && typeof payload === "object" ? payload : {}).catch(failed);
    return Object.freeze({
      state: method("state"), check: method("check"), pull: method("pull"), push: method("push"), rebase: method("rebase"),
      savePreview: method("savePreview"), save: method("save"), publishPreview: method("publishPreview"), publish: method("publish"), link: method("link"),
      owners: () => call("owners").catch(failed),
      linkRepos: () => call("linkRepos").catch(failed),
      account: () => call("account").catch((error) => ({ ok: false, account: null, ghInstalled: false, gitInstalled: false, error: scrub(error) })),
      glance: (ids) => call("glance", Array.isArray(ids) ? ids : null).catch((error) => ({ ok: false, items: [], error: scrub(error) })),
      onSyncEvent: (result) => { call("onSyncEvent", result ?? null).catch(() => {}); },
      onProjectChanged: () => { last = null; call("onProjectChanged").catch(() => {}); },
      model: () => last,
    });
  },
  // settings.json and auth.json (main.cjs readSettings / writeSettings with
  // scripts/auth-store.cjs): Rust reads and writes both and keeps the file's
  // health (the last good copy, saves held while nothing good was ever read,
  // the bytes last copied aside), seeded from the engine's startup read until
  // a call has gone through. The project list goes with each call, as
  // projects.saved() answers it then; the log line is called back.
  "settings-store": (collaborators, host) => {
    let seeded = false;
    const call = async (name, ...args) => {
      const context = {
        settingsPath: collaborators.settingsPath,
        authPath: collaborators.authPath,
        projects: typeof collaborators.saved === "function" ? collaborators.saved() ?? null : null,
        ...(!seeded && typeof collaborators.seed === "function" ? { seed: collaborators.seed() } : {}),
        ...(typeof collaborators.log === "function" ? { log: collaborators.log } : {}),
      };
      const answer = await host.callWithFunctions(`core.settings.${name}`, [context, ...args]);
      seeded = true;
      return answer;
    };
    return Object.freeze({
      read: () => call("read"),
      write: async (next) => { await call("write", next ?? {}); },
    });
  },
  // Changed files, Accept and Revert (scripts/attempt-snapshots-host.cjs
  // createAttemptSnapshots): Rust runs git, makes the before and after
  // pictures and puts files back, with attempt-snapshots.cjs's rules. The
  // kill switch and the log line are called back; the engine's environment
  // goes with each call, and a revert's or an undo's `busy(root)` with its
  // request. Like the JavaScript, every method answers and none throws.
  "attempt-snapshots": (collaborators, host) => {
    const rules = require("./attempt-snapshots.cjs");
    const envNow = typeof collaborators?.env === "function" ? collaborators.env : () => process.env;
    const sent = {
      ...(typeof collaborators?.disabled === "function" ? { disabled: collaborators.disabled } : {}),
      ...(typeof collaborators?.log === "function" ? { log: collaborators.log } : {}),
      ...(typeof collaborators?.now === "function" ? { now: collaborators.now } : {}),
      ...(Number.isFinite(collaborators?.timeoutScale) ? { timeoutScale: collaborators.timeoutScale } : {}),
    };
    const failed = () => ({ ok: false, reason: "unreadable", error: rules.unavailable("unreadable") });
    const call = (name, request) => Promise.resolve()
      .then(() => host.callWithFunctions(`core.snapshots.${name}`, [{ ...sent, env: { ...(envNow() ?? process.env) } }, request]))
      .catch(failed);
    const method = (name) => (request = {}) => call(name, request ?? {});
    return Object.freeze({
      begin: method("begin"), end: method("end"), drop: method("drop"), changes: method("changes"), diff: method("diff"),
      revert: method("revert"), undo: method("undo"), prune: method("prune"), attempts: method("attempts"),
      probe: (root) => call("probe", root ?? null),
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
