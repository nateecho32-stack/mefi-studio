// The engine's side of the Rust ports (scripts/rust-modules.cjs): which
// module functions and host factories Rust answers under the Rust host, the
// shape each call crosses in, the git-actions factory's promise that no
// method throws, and the MEFI_STUDIO_RUST_OFF kill switch. No Rust needed:
// the host is a recording stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PORTED, FACTORIES, withRust, factory, off } = require("../scripts/rust-modules.cjs");

function recordingHost(answer = async () => "rust") {
  const calls = [];
  return { calls, callWithFunctions: (api, args) => { calls.push({ api, args }); return answer(api, args); } };
}

function withEnv(value, run) {
  const before = process.env.MEFI_STUDIO_RUST_OFF;
  if (value === undefined) delete process.env.MEFI_STUDIO_RUST_OFF;
  else process.env.MEFI_STUDIO_RUST_OFF = value;
  try { return run(); } finally {
    if (before === undefined) delete process.env.MEFI_STUDIO_RUST_OFF;
    else process.env.MEFI_STUDIO_RUST_OFF = before;
  }
}

test("a ported module's listed functions call Rust, the rest stay JavaScript", async () => {
  const host = recordingHost();
  const module = { sync: async () => "js", inspect: async () => "js", projectCheck: () => "js-only" };
  const served = withEnv(undefined, () => withRust("scripts\\sync.mjs", module, host));
  assert.equal(await served.sync("C:\\repo", { check: null }), "rust");
  assert.deepEqual(host.calls, [{ api: "repo.sync.sync", args: ["C:\\repo", { check: null }] }]);
  assert.equal(served.projectCheck(), "js-only");
  assert.deepEqual(served.__rust, { module: "sync", functions: PORTED["scripts/sync.mjs"].functions });
  // Not a ported module, or no host: the module itself.
  assert.equal(withRust("scripts/other.mjs", module, host), module);
  assert.equal(withRust("scripts/sync.mjs", module, null), module);
});

test("the git-actions factory sends the collaborators first and answers like createGitActions", async () => {
  assert.ok(FACTORIES["git-actions"]);
  const host = recordingHost(async (api) => ({ api }));
  const collaborators = { env: () => process.env };
  const actions = withEnv(undefined, () => factory("git-actions", collaborators, host));
  assert.deepEqual(Object.keys(actions).sort(), ["account", "glance", "glanceMany", "identity", "link", "nameCheck", "owners", "preview", "publish", "publishPreview", "pushBranch", "save"]);
  await actions.glance("C:\\p");
  await actions.preview("C:\\p");
  await actions.save("C:\\p", { paths: ["a"] });
  await actions.nameCheck("octo", "app");
  await actions.owners();
  assert.deepEqual(host.calls.map((call) => call.api), ["core.git.glance", "core.git.preview", "core.git.save", "core.git.nameCheck", "core.git.owners"]);
  assert.ok(host.calls.every((call) => call.args[0] === collaborators), "the collaborators cross first, every call");
  assert.deepEqual(host.calls[0].args.slice(1), ["C:\\p", {}]);
  assert.deepEqual(host.calls[2].args.slice(1), ["C:\\p", { paths: ["a"] }]);
  assert.deepEqual(host.calls[3].args.slice(1), ["octo", "app"]);
});

test("a git-actions method never throws when the host fails", async () => {
  const host = recordingHost(async () => { throw new Error("the engine pipe closed at https://user:pw@example.com/x"); });
  const actions = factory("git-actions", {}, host);
  assert.equal(await actions.glance("C:\\p"), null);
  assert.deepEqual(await actions.glanceMany([{ id: "a", root: "C:\\p" }]), []);
  for (const method of ["preview", "save", "pushBranch", "publish", "link", "publishPreview"]) {
    assert.deepEqual(await actions[method]("C:\\p", {}), { ok: false, kind: "error", error: "Something went wrong: the engine pipe closed at https://example.com/x" }, method);
  }
  for (const method of ["owners", "account", "identity"]) assert.equal((await actions[method]()).kind, "error", method);
});

test("MEFI_STUDIO_RUST_OFF keeps a port on its JavaScript", () => {
  const host = recordingHost();
  const module = { sync: async () => "js" };
  withEnv("git-actions, sync", () => {
    assert.equal(off("git-actions"), true);
    assert.equal(off("project-files"), false);
    assert.equal(factory("git-actions", {}, host), null);
    assert.ok(factory("project-files", {}, host));
    assert.equal(withRust("scripts/sync.mjs", module, host), module);
  });
  withEnv("all", () => {
    assert.equal(factory("project-files", {}, host), null);
    assert.equal(withRust("scripts/worktrees.mjs", { listWorktrees: async () => [] }, host).__rust, undefined);
  });
  withEnv(undefined, () => assert.ok(factory("git-actions", {}, host)));
});
