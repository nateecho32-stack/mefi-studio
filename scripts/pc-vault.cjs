"use strict";

// Your PCs vault: one private GitHub repository, `<account>/mefi-studio-vault`,
// that only the owner's paired PCs can read, because every file in it is
// sealed with a key that never leaves those PCs (scripts/vault-crypto.cjs).
//
// - create() makes the private repository, writes a plain manifest (format and
//   key fingerprint, nothing else), keeps the key through the OS keystore and
//   hands back the pairing code once. pair() takes a code on another PC,
//   clones, and checks the fingerprint before keeping the key.
// - Every PC writes its own status (name, when it last synced, and per project
//   what is waiting) to pcs/<pcId>.json, so Friends › Your PCs can show all of
//   them.
// - Shelves hold what the owner chose to share between PCs. A shelf of one
//   PC's own evidence (how models did, what Mefi learned, preferences) keeps
//   each PC's copy in its own file, shelves/<shelf>/<pcId>--<id>.json, so the
//   owner's PCs never overwrite each other's; the older shared file is still
//   read. Before anything is
//   sealed it goes through scripts/share-review.cjs: a blocked finding (a key,
//   a token, a password, a login in a link, instructions aimed at an agent)
//   stops that item, and shelves marked `scrub` are scrubbed of paths,
//   emails, addresses and this PC's names first. Everything read back is
//   reviewed again, as received text, before main may use it: items that fail
//   come back as quarantined, never applied.
// - Keys and setup go in their own shelf, `secrets`. Writing it takes the
//   exact confirmation phrase from the owner, and reading it hands the values
//   to main only, which moves them into the keystore; they are never scrubbed
//   (they are the payload), never logged and never shown.
//
// - One call runs at a time. A status line landing while a share is half
//   written would otherwise find files it did not write, fail its rebase and
//   roll them back.
//
// Everything outside is injected: git and gh (run), the files, the keystore
// (protect/unprotect), the clock. Guarded by tests/pc_vault.test.mjs and
// tests/pc_vault_turns.test.mjs.
const path = require("node:path");
const crypto = require("node:crypto");
const sealing = require("./vault-crypto.cjs");
const review = require("./share-review.cjs");

const REPO_NAME = "mefi-studio-vault";
const SHELVES = Object.freeze({
  insights: { label: "How models did, by kind of task", scrub: true, perPc: true },
  learned: { label: "What Mefi learned about how you work", scrub: true, perPc: true },
  presets: { label: "Agent team setups", scrub: true },
  brains: { label: "Agent brains", scrub: true },
  recipes: { label: "Playbook recipes", scrub: true },
  "claude-memory": { label: "Claude Code memory notes", scrub: true },
  settings: { label: "Studio preferences (no keys)", scrub: true, perPc: true },
  work: { label: "Tasks, ideas and plans", scrub: false },
});
const SECRETS_CONFIRMATION = "I understand this shares my keys";
const ID = /^[A-Za-z0-9._-]{1,80}$/;
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const README = [
  "# Mefi's Studio vault",
  "",
  "This private repository is how the owner's PCs share Studio memory. Every",
  "file except manifest.json is sealed with AES-256-GCM using a key that only",
  "the paired PCs hold, so the contents are unreadable here without it.",
  "Do not make this repository public, and never add the pairing code to it.",
  "",
].join("\n");

function createVault({ dir, run, files, protect, unprotect, hostname, now = () => Date.now(), account }) {
  const configFile = path.join(dir, "..", "vault.json");
  const keyFile = path.join(dir, "..", "vault-key.bin");
  let key = null, config = null;
  // This PC's changes that a clash with another PC threw away, for status.
  let dropped = null;

  // Studio's own identity on every call: a commit and a rebase both need one,
  // and a new PC may have no git identity set up at all.
  const git = (args, options) => run("git", ["-C", dir, "-c", "user.name=Mefi's Studio", "-c", "user.email=vault@mefi-studio.invalid", ...args], options);
  const readJson = async (file) => { try { return JSON.parse(await files.read(file)); } catch { return null; } };
  async function load() {
    if (config === null) config = (await readJson(configFile)) ?? {};
    if (!key) {
      try { const stored = await files.read(keyFile); key = stored ? Buffer.from(unprotect(stored), "base64") : null; } catch { key = null; }
      if (key && !sealing.isKey(key)) key = null;
    }
    return { key, config };
  }
  async function keep(nextKey, nextConfig) {
    await files.write(keyFile, protect(nextKey.toString("base64")));
    await files.write(configFile, JSON.stringify(nextConfig, null, 2));
    key = nextKey; config = nextConfig;
  }
  async function commitAndPush(message) {
    await git(["add", "-A"]);
    const staged = await git(["diff", "--cached", "--quiet"]);
    if (staged.ok) return { ok: true, pushed: false };
    const committed = await git(["commit", "-q", "-m", message]);
    if (!committed.ok) return { ok: false, error: "The vault change could not be saved." };
    let pushed = await git(["push", "-q", "origin", "HEAD:main"], { timeout: 60000 });
    if (!pushed.ok) {
      // Another PC pushed first (its status line lands every few minutes):
      // put this commit on top of theirs and send it once more.
      const state = await sync();
      if (state === "dropped") return { ok: false, dropped: true, error: "Another PC changed the same thing at the same moment, and its version was kept. Try again." };
      if (state === "synced") pushed = await git(["push", "-q", "origin", "HEAD:main"], { timeout: 60000 });
    }
    return pushed.ok ? { ok: true, pushed: true } : { ok: false, error: "The vault could not reach GitHub. It will send this with the next sync." };
  }
  // GitHub's copy first, with this PC's own commits (a status line, a share
  // that did not go out yet) put back on top. Each PC writes its own files, so
  // that only conflicts when two PCs changed the same shelf item or the shared
  // keys at the same moment; then GitHub's version is kept and this PC's
  // change is dropped (and named in status), so the copy is in step again. A
  // fast-forward-only pull left such a copy stuck for good: it could neither
  // send nor receive. A rebase that fails for any other reason is undone and
  // nothing is thrown away. "synced", "dropped" or "offline".
  async function sync() {
    const fetched = await git(["fetch", "-q", "origin", "main"], { timeout: 60000 });
    if (!fetched.ok) return "offline";
    const rebased = await git(["rebase", "-q", "--no-autostash", "origin/main"]);
    if (rebased.ok) return "synced";
    const clashed = lines((await git(["diff", "--name-only", "--diff-filter=U"])).stdout).length > 0;
    await git(["rebase", "--abort"]);
    if (!clashed) return "offline";
    // A status line comes back with the next heartbeat; only name the rest.
    const lost = lines((await git(["log", "--format=%s", "origin/main..HEAD"])).stdout).filter((subject) => !subject.endsWith(": status"));
    const reset = await git(["reset", "-q", "--hard", "origin/main"]);
    if (!reset.ok) return "offline";
    if (lost.length) dropped = { at: now(), changes: lost.slice(0, 20) };
    return "dropped";
  }
  const pull = async () => (await sync()) !== "offline";

  async function status() {
    await load();
    if (!key || !config.repo) return { ok: true, linked: false, account: await account().catch(() => null) };
    // The other PCs' latest lines; offline, the last copy still answers.
    const fresh = await pull();
    const manifest = await readJson(path.join(dir, "manifest.json"));
    const pcs = [];
    for (const name of await files.list(path.join(dir, "pcs")).catch(() => [])) {
      if (!name.endsWith(".json")) continue;
      try { pcs.push({ ...sealing.open(key, `pcs/${name}`, await files.read(path.join(dir, "pcs", name))), self: name === `${config.pcId}.json` }); } catch {}
    }
    pcs.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    return { ok: true, linked: true, offline: !fresh, repo: config.repo, pcId: config.pcId, name: config.name, keyMatches: manifest?.fingerprint === sealing.fingerprint(key), pcs, dropped, shelves: Object.entries(SHELVES).map(([id, shelf]) => ({ id, label: shelf.label })) };
  }

  // Makes the private repository on the signed-in account and pairs this PC.
  async function create() {
    await load();
    if (key && config.repo) return { ok: false, error: "This PC is already paired with a vault." };
    const owner = await account().catch(() => null);
    if (!owner) return { ok: false, error: "Sign in to GitHub first (Set up this PC)." };
    const repo = `${owner}/${REPO_NAME}`;
    const taken = { ok: false, error: `${repo} already exists. Pair with it using its pairing code from a PC that has it.` };
    const made = await run("gh", ["repo", "create", repo, "--private", "--description", "Mefi's Studio vault: sealed, readable only on the owner's paired PCs"], { timeout: 60000 });
    if (!made.ok && !/already exists/i.test(made.stderr)) return { ok: false, error: "GitHub did not make the private repository. Check your sign-in and try again." };
    // Already there: an earlier try made it and then failed, which leaves it
    // private and empty. Carry on with that one; anything else is refused.
    if (!made.ok && !(await isPrivate(repo))) return taken;
    await files.removeDir(dir).catch(() => {});
    const cloned = await run("gh", ["repo", "clone", repo, dir, "--", "--quiet"], { timeout: 120000 });
    if (!cloned.ok) { await files.removeDir(dir).catch(() => {}); return { ok: false, error: "The new vault could not be cloned to this PC. Try again." }; }
    if (!made.ok && (await readJson(path.join(dir, "manifest.json")))) { await files.removeDir(dir).catch(() => {}); return taken; }
    const fresh = sealing.newKey();
    await files.write(path.join(dir, "manifest.json"), `${JSON.stringify({ format: sealing.FORMAT, fingerprint: sealing.fingerprint(fresh), createdAt: now() }, null, 2)}\n`);
    await files.write(path.join(dir, "README.md"), README);
    await keep(fresh, { repo, pcId: crypto.randomUUID(), name: hostname(), pairedAt: now() });
    const saved = await commitAndPush("Start the vault");
    if (!saved.ok) return saved;
    return { ok: true, repo, pairingCode: sealing.pairingCode(fresh) };
  }

  async function isPrivate(repo) {
    const seen = await run("gh", ["repo", "view", repo, "--json", "isPrivate", "--jq", ".isPrivate"], { timeout: 30000 });
    return seen.ok && seen.stdout.trim() === "true";
  }

  // Pairs this PC with an existing vault from a code typed by the owner. A
  // failed try leaves nothing behind, so the next one clones afresh.
  async function pair(code, repoName = null) {
    await load();
    if (key && config.repo) return { ok: false, error: "This PC is already paired with a vault." };
    const fresh = sealing.readPairingCode(code);
    if (!fresh) return { ok: false, error: "That pairing code is not right. Check each group of four and try again." };
    const owner = await account().catch(() => null);
    const repo = repoName ?? (owner ? `${owner}/${REPO_NAME}` : null);
    if (!repo || !REPO.test(repo)) return { ok: false, error: "Sign in to GitHub first (Set up this PC)." };
    await files.removeDir(dir).catch(() => {});
    const cloned = await run("gh", ["repo", "clone", repo, dir, "--", "--quiet"], { timeout: 120000 });
    if (!cloned.ok) { await files.removeDir(dir).catch(() => {}); return { ok: false, error: `${repo} could not be cloned. Is this PC signed in to the same GitHub account?` }; }
    const manifest = await readJson(path.join(dir, "manifest.json"));
    if (manifest?.fingerprint !== sealing.fingerprint(fresh)) { await files.removeDir(dir).catch(() => {}); return { ok: false, error: "That code belongs to a different vault. Nothing was kept." }; }
    await keep(fresh, { repo, pcId: crypto.randomUUID(), name: hostname(), pairedAt: now() });
    return { ok: true, repo };
  }

  // The pairing code again, for pairing another PC. Main shows it once, on
  // this PC's screen, after the owner asks.
  async function pairingCode() {
    await load();
    return key ? { ok: true, pairingCode: sealing.pairingCode(key) } : { ok: false, error: "This PC is not paired with a vault." };
  }

  // This PC's line in Your PCs: its name, when, and what waits per project.
  async function heartbeat(projects = []) {
    await load();
    if (!key || !config.repo) return { ok: false, error: "not-linked" };
    await pull();
    const at = now();
    const entry = { name: config.name, at, projects: (Array.isArray(projects) ? projects : []).slice(0, 50).map((item) => ({ repo: REPO.test(String(item?.repo ?? "")) ? item.repo : null, risk: Number.isInteger(item?.risk) ? item.risk : 0, behind: Number.isInteger(item?.behind) ? item.behind : 0 })).filter((item) => item.repo) };
    await files.write(path.join(dir, "pcs", `${config.pcId}.json`), sealing.seal(key, `pcs/${config.pcId}.json`, entry));
    return commitAndPush(`${config.name}: status`);
  }

  // Seals the owner's chosen items onto a shelf. Each item is { id, value }.
  // Returns what went, and what was stopped with the reasons.
  async function publish(shelf, items) {
    await load();
    if (!key || !config.repo) return { ok: false, error: "This PC is not paired with a vault." };
    const rule = SHELVES[shelf];
    if (!rule) return { ok: false, error: "Unknown shelf." };
    await pull();
    const sent = [], stopped = [];
    for (const item of (Array.isArray(items) ? items : []).slice(0, 500)) {
      if (!ID.test(String(item?.id ?? ""))) { stopped.push({ id: String(item?.id ?? ""), reasons: ["That item has no usable name."] }); continue; }
      const value = rule.scrub ? review.scrub(item.value) : item.value;
      const scan = review.scan(value, { received: true });
      if (!scan.ok) { stopped.push({ id: item.id, reasons: review.explain(scan.findings.filter((finding) => finding.level === "block")) }); continue; }
      const where = rule.perPc ? `shelves/${shelf}/${config.pcId}--${item.id}.json` : `shelves/${shelf}/${item.id}.json`;
      await files.write(path.join(dir, where), sealing.seal(key, where, { id: item.id, from: config.name, at: now(), value }));
      if (rule.perPc) await dropOwnFlatCopy(shelf, item.id);
      sent.push(item.id);
    }
    const saved = sent.length ? await commitAndPush(`${config.name}: ${shelf} (${sent.length})`) : { ok: true };
    return { ...saved, ok: saved.ok, sent: saved.dropped ? [] : sent, stopped };
  }
  // The shared file an older build wrote for every PC: this PC's own copy
  // there is replaced by its per-PC file; another PC's stays until it sends.
  async function dropOwnFlatCopy(shelf, id) {
    const where = `shelves/${shelf}/${id}.json`;
    let entry = null;
    try { entry = sealing.open(key, where, await files.read(path.join(dir, where))); } catch { return; }
    if (entry?.from === config.name) await files.remove(path.join(dir, where)).catch(() => {});
  }

  // Everything on a shelf, each reviewed again as received text. Items that
  // fail the review, or do not open, are quarantined and never handed on.
  async function read(shelf) {
    await load();
    if (!key || !config.repo) return { ok: false, error: "This PC is not paired with a vault." };
    if (!SHELVES[shelf]) return { ok: false, error: "Unknown shelf." };
    await pull();
    const items = [], quarantined = [];
    for (const name of await files.list(path.join(dir, "shelves", shelf)).catch(() => [])) {
      if (!name.endsWith(".json")) continue;
      const where = `shelves/${shelf}/${name}`;
      let entry;
      try { entry = sealing.open(key, where, await files.read(path.join(dir, where))); }
      catch { quarantined.push({ id: name.slice(0, -5), reasons: ["It did not open with this vault's key, so it may have been changed."] }); continue; }
      const scan = review.scan(entry.value, { received: true });
      if (!scan.ok) { quarantined.push({ id: entry.id, from: entry.from, reasons: review.explain(scan.findings.filter((finding) => finding.level === "block")) }); continue; }
      // The shared file and a per-PC file from one PC: the newer one counts.
      const twin = items.findIndex((row) => row.id === entry.id && row.from === entry.from);
      if (twin >= 0 && (items[twin].at ?? 0) >= (entry.at ?? 0)) continue;
      if (twin >= 0) items.splice(twin, 1);
      items.push({ id: entry.id, from: entry.from, at: entry.at, mine: entry.from === config.name, value: entry.value });
    }
    return { ok: true, items, quarantined };
  }

  // Keys and setup. Only with the exact phrase; the values are the payload
  // and are neither scrubbed nor logged.
  async function shareSecrets(confirmation, values) {
    await load();
    if (confirmation !== SECRETS_CONFIRMATION) return { ok: false, error: "Type the confirmation exactly to share keys." };
    if (!key || !config.repo) return { ok: false, error: "This PC is not paired with a vault." };
    const entries = Object.entries(values && typeof values === "object" ? values : {}).filter(([name, value]) => ID.test(name) && typeof value === "string" && value.length <= 8192);
    if (!entries.length) return { ok: false, error: "There is nothing to share." };
    await pull();
    await files.write(path.join(dir, "secrets.json"), sealing.seal(key, "secrets.json", { from: config.name, at: now(), values: Object.fromEntries(entries) }));
    const saved = await commitAndPush(`${config.name}: keys and setup`);
    return saved.ok ? { ok: true, shared: entries.map(([name]) => name) } : saved;
  }
  async function readSecrets() {
    await load();
    if (!key || !config.repo) return { ok: false, error: "This PC is not paired with a vault." };
    await pull();
    let raw;
    try { raw = await files.read(path.join(dir, "secrets.json")); } catch { return { ok: true, values: {} }; }
    try {
      const entry = sealing.open(key, "secrets.json", raw);
      return { ok: true, from: entry.from, at: entry.at, values: entry.values && typeof entry.values === "object" ? entry.values : {} };
    } catch { return { ok: false, error: "The shared keys did not open with this vault's key. Nothing was used." }; }
  }

  // Takes the shared keys back out once the other PCs have them. They stay
  // sealed in the repository's history, so a key that may have leaked is
  // replaced at its provider, not only removed here.
  async function clearSecrets() {
    await load();
    if (!key || !config.repo) return { ok: false, error: "This PC is not paired with a vault." };
    await pull();
    await files.remove(path.join(dir, "secrets.json")).catch(() => {});
    return commitAndPush(`${config.name}: took the shared keys out`);
  }

  // Forgets the vault on this PC only: the key and the local copy go; the
  // repository and the other PCs are untouched.
  async function unpair() {
    await files.remove(keyFile).catch(() => {});
    await files.remove(configFile).catch(() => {});
    await files.removeDir(dir).catch(() => {});
    key = null; config = {};
    return { ok: true };
  }

  let turn = Promise.resolve();
  const inTurn = (work) => (...args) => {
    const next = turn.then(() => work(...args));
    turn = next.catch(() => {});
    return next;
  };
  return Object.fromEntries(Object.entries({ status, create, pair, pairingCode, heartbeat, publish, read, shareSecrets, readSecrets, clearSecrets, unpair }).map(([name, work]) => [name, inTurn(work)]));
}

function lines(text) {
  return String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

module.exports = { REPO_NAME, SHELVES, SECRETS_CONFIRMATION, createVault };
