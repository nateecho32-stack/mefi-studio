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

test("the evidence-window factory asks the host for a shot and answers like createEvidenceWindow", async () => {
  assert.ok(FACTORIES["evidence-window"]);
  const calls = [];
  let release = null;
  const host = {
    callWithFunctions: async () => { throw new Error("not used"); },
    call: (api, ...args) => {
      calls.push({ api, args });
      if (args[0].includes(":5174")) return new Promise((resolve) => { release = () => resolve({ ok: true, png: new Uint8Array([1, 2, 3]) }); });
      if (args[0].includes(":5175")) return Promise.reject(new Error("the host closed at http://localhost:5175/secret"));
      if (args[0].includes(":5176")) return Promise.resolve({ ok: false, error: "timed out" });
      return Promise.resolve({ ok: true, png: new Uint8Array([137, 80, 78, 71]) });
    },
  };
  const lines = [];
  const window = withEnv(undefined, () => factory("evidence-window", { log: (line) => lines.push(line) }, host));
  const shot = await window.capture("http://localhost:5173/", { allow: { host: "localhost:5173", secure: false } });
  assert.equal(shot.ok, true);
  assert.ok(Buffer.isBuffer(shot.png), "the PNG comes back as a Buffer, as Electron's toPNG gave");
  assert.deepEqual([...shot.png], [137, 80, 78, 71]);
  assert.deepEqual(calls[0], { api: "evidence.capture", args: ["http://localhost:5173/", { width: 1280, height: 800, timeoutMs: 15000, settleMs: 800, allow: { host: "localhost:5173", secure: false } }] });

  // The same refusals as the JavaScript, before the host is asked.
  assert.deepEqual(await window.capture("https://example.com/", { allow: { host: "example.com" } }), { ok: false, error: "not a local address" });
  assert.deepEqual(await window.capture("http://localhost:5173/", { allow: { host: "localhost:9999" } }), { ok: false, error: "not a local address" });
  assert.deepEqual(await window.capture("http://localhost:5173/", {}), { ok: false, error: "not a local address" });
  assert.equal(calls.length, 1);

  // One shot at a time: the second waits for the first.
  const first = window.capture("http://localhost:5174/", { allow: { host: "localhost:5174" } });
  const second = window.capture("http://localhost:5173/", { allow: { host: "localhost:5173" } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 2, "the second shot has not started");
  release();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(calls.length, 3);

  // Failures answer, never throw, carry no address, and are logged like the JavaScript's.
  assert.deepEqual(await window.capture("http://localhost:5175/", { allow: { host: "localhost:5175" } }), { ok: false, error: "the host closed at <address>" });
  assert.deepEqual(await window.capture("http://localhost:5176/", { allow: { host: "localhost:5176" } }), { ok: false, error: "timed out" });
  assert.deepEqual(lines.slice(-2), ["[review] shot not taken (the host closed at <address>)", "[review] shot not taken (timed out)"]);
  withEnv("evidence-window", () => assert.equal(factory("evidence-window", {}, host), null));
});

test("the skills factory sends the collaborators first, keeps enabled and OFF the engine's, and filters the zip to SKILL.md", async () => {
  assert.ok(FACTORIES.skills);
  const calls = [];
  const host = { callWithFunctions: async (api, args) => { calls.push({ api, args }); return { ok: true, api }; } };
  const zipped = [];
  const collaborators = { root: () => "C:\\p", enabled: () => false, zip: async (source, target, options) => zipped.push({ source, target, options }) };
  const skills = withEnv(undefined, () => factory("skills", collaborators, host));
  assert.equal(skills.enabled(), false, "answered by the engine, without waiting");
  assert.equal(skills.OFF, require("../scripts/skills.cjs").OFF);
  await skills.list();
  await skills.read("a");
  await skills.save({ name: "a" });
  await skills.delete("a");
  await skills.exportTo({ name: "a", target: "C:\\out", kind: "zip" });
  assert.deepEqual(calls.map((call) => call.api), ["core.skills.list", "core.skills.read", "core.skills.save", "core.skills.delete", "core.skills.exportTo"]);
  const sent = calls[0].args[0];
  assert.equal(sent.root, collaborators.root);
  assert.notEqual(sent.zip, collaborators.zip, "the zip writer is wrapped");
  await sent.zip("C:\\p\\.agents\\skills\\a", "C:\\out.zip.part", { rootName: "a" });
  assert.equal(zipped[0].options.rootName, "a");
  assert.equal(zipped[0].options.include("SKILL.md"), true);
  assert.equal(zipped[0].options.include("script.sh"), false, "only SKILL.md goes in the zip, as the JavaScript asked");
  const failing = factory("skills", {}, { callWithFunctions: async () => { throw new Error("pipe closed"); } });
  assert.deepEqual(await failing.list(), { ok: false, error: "That could not be done (pipe closed)." });
  withEnv("skills", () => assert.equal(factory("skills", {}, host), null));
});

test("the image-store factory turns the named-ids Set into an array, hands previews a Buffer and keeps folder the engine's", async () => {
  assert.ok(FACTORIES["image-store"]);
  const calls = [];
  const host = { callWithFunctions: async (api, args) => { calls.push({ api, args }); return { ok: true, api }; } };
  const thumbs = [];
  const collaborators = { dir: () => "C:\\data\\attachments", keep: async () => new Set(["img_aaaaaaaaaaaaaaaaaaaaaaaa"]), thumbnail: async (bytes, mime) => { thumbs.push([bytes, mime]); return null; } };
  const store = withEnv(undefined, () => factory("image-store", collaborators, host));
  assert.equal(store.folder(), "C:\\data\\attachments", "answered by the engine, without waiting");
  await store.save({ name: "a.png", data: "QUJD" });
  await store.resolve(undefined);
  await store.prune({ keep: new Set(["img_bbbbbbbbbbbbbbbbbbbbbbbb"]) });
  assert.deepEqual(calls.map((call) => call.api), ["core.images.save", "core.images.resolve", "core.images.prune"]);
  assert.equal(calls[1].args[1], null, "nothing to resolve crosses as null, not undefined");
  assert.deepEqual(calls[2].args[1], { keep: ["img_bbbbbbbbbbbbbbbbbbbbbbbb"] }, "a Set cannot cross; an array does");
  const sent = calls[0].args[0];
  assert.deepEqual(await sent.keep(), ["img_aaaaaaaaaaaaaaaaaaaaaaaa"]);
  await sent.thumbnail({ $mefi: "bytes", b64: Buffer.from("png!").toString("base64") }, "image/png");
  await sent.thumbnail(Buffer.from("jpg!"), "image/jpeg");
  assert.ok(thumbs.every(([bytes]) => Buffer.isBuffer(bytes)));
  assert.deepEqual(thumbs.map(([bytes, mime]) => [bytes.toString(), mime]), [["png!", "image/png"], ["jpg!", "image/jpeg"]]);
  const failing = factory("image-store", collaborators, { callWithFunctions: async () => { throw new Error("pipe closed"); } });
  assert.deepEqual(await failing.save({}), { ok: false, error: "The picture could not be saved: pipe closed" });
  assert.deepEqual(await failing.remove("img_x"), { ok: true }, "remove never fails, as in the JavaScript");
  await assert.rejects(failing.load({ path: "x" }), /pipe closed/, "load rejects, as the JavaScript's does");
  withEnv("image-store", () => assert.equal(factory("image-store", collaborators, host), null));
});
