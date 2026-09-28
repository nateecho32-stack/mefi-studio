// Guard tests for scripts/pc-vault.cjs taking turns and cleaning up: one call
// at a time, a rebase undone without throwing anything away unless two PCs
// really changed the same file (and then status names what went), each PC's
// own evidence in its own file with the older shared file still read, and a
// failed pair or create leaving nothing that blocks the next try. Real git
// against a bare repository; gh is faked as in tests/pc_vault.test.mjs.
//
// Run: node --test tests/pc_vault_turns.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createVault, SECRETS_CONFIRMATION } = require("../scripts/pc-vault.cjs");
const sealing = require("../scripts/vault-crypto.cjs");

const NO_GLOBAL_CONFIG = path.join(mkdtempSync(path.join(tmpdir(), "mefi-vault-git-")), "empty.gitconfig");
writeFileSync(NO_GLOBAL_CONFIG, "");
const exec = (command, args, options = {}) => new Promise((resolve) => {
  execFile(command, args, { windowsHide: true, timeout: options.timeout ?? 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: NO_GLOBAL_CONFIG } }, (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }));
});

function world(t) {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-vault-turns-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const hub = path.join(root, "github", "owner", "mefi-studio-vault.git");
  const calls = [];
  // beforePush: once, just before the next git push. failClone: the next
  // clone fails after leaving a half-made folder. isPrivate: gh repo view.
  const hooks = { beforePush: null, failClone: false, isPrivate: true };
  const run = async (command, args, options) => {
    calls.push([command, ...args].join(" "));
    if (command === "git" && args.includes("push") && hooks.beforePush) { const hook = hooks.beforePush; hooks.beforePush = null; await hook(); }
    if (command === "gh" && args[0] === "repo" && args[1] === "create") {
      if (existsSync(hub)) return { ok: false, stdout: "", stderr: "GraphQL: Name already exists on this account" };
      await mkdir(hub, { recursive: true });
      return exec("git", ["init", "-q", "--bare", "-b", "main", hub]);
    }
    if (command === "gh" && args[0] === "repo" && args[1] === "view") return existsSync(hub) ? { ok: true, stdout: `${hooks.isPrivate}\n`, stderr: "" } : { ok: false, stdout: "", stderr: "not found" };
    if (command === "gh" && args[0] === "repo" && args[1] === "clone") {
      if (hooks.failClone) { hooks.failClone = false; await mkdir(path.join(args[3], ".git"), { recursive: true }); return { ok: false, stdout: "", stderr: "connection reset" }; }
      if (args[2] !== "owner/mefi-studio-vault" || !existsSync(hub)) return { ok: false, stdout: "", stderr: "not found" };
      const cloned = await exec("git", ["clone", "-q", hub, args[3]]);
      if (cloned.ok) await exec("git", ["-C", args[3], "config", "core.autocrlf", "false"]);
      return cloned;
    }
    if (command === "git") return exec("git", args, options);
    return { ok: false, stdout: "", stderr: `unexpected ${command}` };
  };
  const files = {
    read: (file) => readFile(file, "utf8"),
    write: async (file, text) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); },
    list: (dir) => readdir(dir),
    remove: (file) => rm(file, { force: true }),
    removeDir: (dir) => rm(dir, { recursive: true, force: true }),
  };
  const pc = (name, { at = 1_800_000_000_000 } = {}) => {
    const home = path.join(root, name, "userData");
    const dir = path.join(home, "vault");
    return {
      home, dir,
      vault: createVault({
        dir, run, files,
        protect: (text) => `KEYSTORE(${Buffer.from(text).toString("hex")})`,
        unprotect: (text) => Buffer.from(String(text).slice(9, -1), "hex").toString(),
        hostname: () => name, now: () => at, account: async () => "owner",
      }),
    };
  };
  // Another checkout of GitHub's copy, for planting what an older build wrote.
  async function mirror(name = "mirror") {
    const dir = path.join(root, name);
    await exec("git", ["clone", "-q", hub, dir]);
    await exec("git", ["-C", dir, "config", "core.autocrlf", "false"]);
    const push = async (message) => {
      await exec("git", ["-C", dir, "add", "-A"]);
      await exec("git", ["-C", dir, "-c", "user.name=x", "-c", "user.email=x@x.invalid", "commit", "-qm", message]);
      return exec("git", ["-C", dir, "push", "-q", "origin", "HEAD:main"]);
    };
    return { dir, push };
  }
  return { root, hub, calls, hooks, pc, mirror };
}

const hubFiles = async (w, where) => (await exec("git", ["--git-dir", w.hub, "ls-tree", "-r", "--name-only", "main", where])).stdout.split("\n").filter(Boolean);

test("calls on one PC take turns: a status line waits for a share to be sent", async (t) => {
  const w = world(t);
  const desk = w.pc("DESK");
  await desk.vault.create();
  await desk.vault.publish("brains", [{ id: "reviewer", value: { name: "Reviewer", steps: ["look"] } }]);
  const start = w.calls.length;
  // Changing an item already there, while the heartbeat asks at the same moment.
  const [published, beat] = await Promise.all([
    desk.vault.publish("brains", [{ id: "reviewer", value: { name: "Reviewer", steps: ["look", "again"] } }]),
    desk.vault.heartbeat([{ repo: "owner/app", risk: 1, behind: 0 }]),
  ]);
  assert.equal(published.ok, true);
  assert.deepEqual(published.sent, ["reviewer"]);
  assert.equal(beat.ok, true);
  const calls = w.calls.slice(start);
  const shareCommit = calls.findIndex((call) => call.includes("commit -q -m DESK: brains"));
  const fetches = calls.map((call, index) => (call.includes(" fetch ") ? index : -1)).filter((index) => index >= 0);
  assert.ok(shareCommit >= 0 && fetches.length >= 2 && shareCommit < fetches[1], "the heartbeat's fetch comes after the share's commit");
  const log = await exec("git", ["--git-dir", w.hub, "log", "--format=%s", "main"]);
  assert.match(log.stdout, /DESK: brains \(1\)\n.*\n?DESK: brains \(1\)|DESK: status\nDESK: brains \(1\)\nDESK: brains \(1\)/, "both shares and the status line reached GitHub");
});

test("a rebase that fails without a clash is undone and throws nothing away", async (t) => {
  const w = world(t);
  const desk = w.pc("DESK"), laptop = w.pc("LAPTOP");
  const made = await desk.vault.create();
  await laptop.vault.pair(made.pairingCode);
  await laptop.vault.heartbeat([]);
  // An edit Git will not rebase over, and a commit of this PC's own that has
  // not gone out, while another PC moved on.
  await exec("git", ["-C", laptop.dir, "-c", "user.name=x", "-c", "user.email=x@x.invalid", "commit", "-q", "--allow-empty", "-m", "LAPTOP: not sent yet"]);
  await writeFile(path.join(laptop.dir, "README.md"), "edited here\n");
  await desk.vault.heartbeat([]);
  const seen = await laptop.vault.status();
  assert.equal(seen.offline, true, "the last copy answers");
  assert.equal(seen.dropped, null, "nothing was dropped");
  assert.equal(await readFile(path.join(laptop.dir, "README.md"), "utf8"), "edited here\n", "the edit is still there");
  const log = await exec("git", ["-C", laptop.dir, "log", "--format=%s", "-1"]);
  assert.equal(log.stdout.trim(), "LAPTOP: not sent yet", "and so is the commit");
  assert.equal(existsSync(path.join(laptop.dir, ".git", "rebase-merge")), false, "no rebase is left half done");
});

test("a real clash keeps GitHub's version, sends nothing, and status names what went", async (t) => {
  const w = world(t);
  const desk = w.pc("DESK"), laptop = w.pc("LAPTOP");
  const made = await desk.vault.create();
  await laptop.vault.pair(made.pairingCode);
  w.hooks.beforePush = () => desk.vault.publish("brains", [{ id: "shared", value: { name: "From DESK" } }]);
  const clash = await laptop.vault.publish("brains", [{ id: "shared", value: { name: "From LAPTOP" } }]);
  assert.equal(clash.ok, false);
  assert.deepEqual(clash.sent, [], "a dropped change is not reported as sent");
  assert.match(clash.error, /its version was kept/);
  const seen = await laptop.vault.status();
  assert.deepEqual(seen.dropped, { at: 1_800_000_000_000, changes: ["LAPTOP: brains (1)"] });
  assert.deepEqual((await laptop.vault.read("brains")).items.map((item) => [item.id, item.from, item.value.name]), [["shared", "DESK", "From DESK"]]);
  assert.equal((await desk.vault.status()).dropped, null, "the PC whose version was kept lost nothing");
});

test("each PC's own evidence goes in its own file; the older shared file is still read", async (t) => {
  const w = world(t);
  const desk = w.pc("DESK", { at: 2000 }), laptop = w.pc("LAPTOP", { at: 3000 }), third = w.pc("THIRD");
  const made = await desk.vault.create();
  await laptop.vault.pair(made.pairingCode);
  await third.vault.pair(made.pairingCode);
  const key = sealing.readPairingCode(made.pairingCode);
  // What an older build wrote: one file for every PC, last writer wins.
  const old = await w.mirror();
  const flat = "shelves/insights/models.json";
  await mkdir(path.join(old.dir, "shelves", "insights"), { recursive: true });
  await writeFile(path.join(old.dir, flat), sealing.seal(key, flat, { id: "models", from: "DESK", at: 1000, value: { models: ["old desk"] } }));
  const oldLearned = "shelves/learned/decisions.json";
  await mkdir(path.join(old.dir, "shelves", "learned"), { recursive: true });
  await writeFile(path.join(old.dir, oldLearned), sealing.seal(key, oldLearned, { id: "decisions", from: "OLD-PC", at: 1000, value: { decisions: ["kept"] } }));
  assert.equal((await old.push("older build")).ok, true);

  assert.deepEqual((await desk.vault.publish("insights", [{ id: "models", value: { models: ["desk"] } }])).sent, ["models"]);
  assert.deepEqual((await laptop.vault.publish("insights", [{ id: "models", value: { models: ["laptop"] } }])).sent, ["models"]);
  const read = await third.vault.read("insights");
  assert.deepEqual(read.items.map((item) => [item.id, item.from, item.value.models[0]]).sort(), [["models", "DESK", "desk"], ["models", "LAPTOP", "laptop"]], "neither PC overwrote the other");
  const onGitHub = await hubFiles(w, "shelves/insights");
  assert.equal(onGitHub.length, 2);
  assert.ok(!onGitHub.includes(flat), "DESK's own copy in the shared file made way for its per-PC file");
  assert.ok(onGitHub.every((file) => /^shelves\/insights\/[0-9a-f-]{36}--models\.json$/.test(file)));
  assert.deepEqual((await third.vault.read("learned")).items.map((item) => [item.id, item.from]), [["decisions", "OLD-PC"]], "another PC's shared file is still read");
  // Brains and the rest stay one file per item.
  await desk.vault.publish("brains", [{ id: "reviewer", value: { name: "Reviewer" } }]);
  assert.deepEqual(await hubFiles(w, "shelves/brains"), ["shelves/brains/reviewer.json"]);
});

test("one PC's shared file and per-PC file count once, the newer one", async (t) => {
  const w = world(t);
  const desk = w.pc("DESK");
  const made = await desk.vault.create();
  const key = sealing.readPairingCode(made.pairingCode);
  const old = await w.mirror();
  await mkdir(path.join(old.dir, "shelves", "settings"), { recursive: true });
  for (const [where, at, theme] of [["shelves/settings/preferences.json", 1000, "old"], ["shelves/settings/0b7c-pc--preferences.json", 5000, "new"]]) {
    await writeFile(path.join(old.dir, where), sealing.seal(key, where, { id: "preferences", from: "LAPTOP", at, value: { settings: { theme } } }));
  }
  await old.push("both");
  const read = await desk.vault.read("settings");
  assert.deepEqual(read.items.map((item) => [item.from, item.value.settings.theme]), [["LAPTOP", "new"]]);
});

test("a refused pairing code leaves nothing behind; the right code then pairs", async (t) => {
  const w = world(t);
  const desk = w.pc("DESK"), laptop = w.pc("LAPTOP");
  const made = await desk.vault.create();
  const refused = await laptop.vault.pair(sealing.pairingCode(sealing.newKey()));
  assert.match(refused.error, /different vault/);
  assert.equal(existsSync(laptop.dir), false, "the clone is gone");
  w.hooks.failClone = true;
  assert.match((await laptop.vault.pair(made.pairingCode)).error, /could not be cloned/);
  assert.equal(existsSync(laptop.dir), false, "a half-made clone is gone too");
  const paired = await laptop.vault.pair(made.pairingCode);
  assert.equal(paired.ok, true, paired.error);
  assert.equal((await laptop.vault.status()).keyMatches, true);
});

test("a create that failed after GitHub made the repository carries on with it", async (t) => {
  const w = world(t);
  const desk = w.pc("DESK"), laptop = w.pc("LAPTOP");
  w.hooks.failClone = true;
  const failed = await desk.vault.create();
  assert.match(failed.error, /could not be cloned/);
  assert.equal(existsSync(desk.dir), false);
  assert.equal((await desk.vault.status()).linked, false);
  const made = await desk.vault.create();
  assert.equal(made.ok, true, made.error);
  assert.ok(made.pairingCode);
  assert.ok(w.calls.some((call) => call === "gh repo view owner/mefi-studio-vault --json isPrivate --jq .isPrivate"), "only a private repository is reused");
  assert.equal((await laptop.vault.pair(made.pairingCode)).ok, true);
});

test("create refuses a repository that has a vault in it, or is not private", async (t) => {
  const w = world(t);
  const desk = w.pc("DESK"), laptop = w.pc("LAPTOP");
  await desk.vault.create();
  const taken = await laptop.vault.create();
  assert.match(taken.error, /already exists\. Pair with it/);
  assert.equal(existsSync(laptop.dir), false, "the look inside leaves nothing behind");
  assert.equal(existsSync(path.join(laptop.home, "vault-key.bin")), false);

  const v = world(t);
  const first = v.pc("DESK");
  await mkdir(v.hub, { recursive: true });
  await exec("git", ["init", "-q", "--bare", "-b", "main", v.hub]);
  v.hooks.isPrivate = false;
  const open = await first.vault.create();
  assert.match(open.error, /already exists/);
  assert.ok(!v.calls.some((call) => call.startsWith("gh repo clone")), "a public repository is never cloned into the vault");
});

test("keys shared at once from two PCs: GitHub's stay, and the other PC is told which of its changes went", async (t) => {
  const w = world(t);
  const desk = w.pc("DESK"), laptop = w.pc("LAPTOP");
  const made = await desk.vault.create();
  await laptop.vault.pair(made.pairingCode);
  w.hooks.beforePush = () => desk.vault.shareSecrets(SECRETS_CONFIRMATION, { zai: "from-desk" });
  const clash = await laptop.vault.shareSecrets(SECRETS_CONFIRMATION, { zai: "from-laptop" });
  assert.equal(clash.ok, false);
  assert.deepEqual((await laptop.vault.status()).dropped.changes, ["LAPTOP: keys and setup"]);
  assert.ok(readdirSync(laptop.dir).includes("secrets.json"));
});
