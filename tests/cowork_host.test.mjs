import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

// main.cjs's "Cowork claims" block in a vm with a fake hub client: a run's
// files are claimed in the project's cowork room before it starts, another
// PC's claim defers it, a hub that is missing or slow never holds work up, a
// run that did its work keeps its claim until the next push, claims are
// renewed and a lost one is dropped, and other PCs' claims reach the
// dispatcher as held files. Then the room link and Set up this PC's list.

const require = createRequire(import.meta.url);
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("// ---- Cowork claims: agents on several PCs");
const to = main.indexOf("// ---- end of cowork claims", from);
assert.ok(from > 0 && to > from, "main.cjs has a Cowork claims block");
const block = main.slice(from, to);
const ME = "123456789012345678";
const ROOT = path.resolve("C:/work/app");
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

function host({ repo = "Owner/App", rooms = { "owner/app": "room_1" }, state = "ready", claim = null, linked = true, files = {} } = {}) {
  let settings = { cowork: { rooms, machineId: "pc-desk" } };
  const calls = [], logs = [];
  const client = {
    state,
    status() { return { state: this.state, user: { id: ME } }; },
    async connect() { calls.push(["connect"]); this.state = "ready"; },
    subscribe(roomId) { calls.push(["subscribe", roomId]); return true; },
    claim(roomId, fields) { calls.push(["claim", roomId, fields]); return claim ? claim(fields) : Promise.resolve({ ok: true, leaseId: `lease_${fields.runId}` }); },
    renewClaim(leaseId) { calls.push(["renew", leaseId]); return Promise.resolve(leaseId === "lease_gone" ? { ok: false, error: "gone" } : { ok: true }); },
    releaseClaim(leaseId, reason) { calls.push(["release", leaseId, reason]); return Promise.resolve({ ok: true }); },
  };
  const context = vm.createContext({
    require: (name) => (name === "./scripts/cowork.cjs" ? require("../scripts/cowork.cjs") : null),
    crypto: { randomUUID: () => "fresh-id" }, path,
    SMOKE: false, CAPTURE: false, CLI_MODE: false,
    setTimeout: (fn, ms) => { if (ms === 5000 && claim === "never") Promise.resolve().then(fn); return { unref() {} }; },
    clearTimeout: () => {}, setInterval: () => ({ unref() {} }),
    readSettings: async () => JSON.parse(JSON.stringify(settings)),
    updateSettings: async (mutate) => { const next = JSON.parse(JSON.stringify(settings)); await mutate(next); settings = next; },
    projects: { open: () => true },
    vaultProjectRepo: async () => repo,
    hubClient: client,
    hubInstance: () => client,
    communityRead: async () => ({ state: { link: linked ? { userId: ME } : null } }),
    logLine: (line) => logs.push(line),
    existsSync: (file) => Boolean(files[path.basename(file)]),
    vaultHome: () => "C:/userData/vault",
    communitySetupView: () => ({ linkReady: true, hubReady: false }),
    community: {},
  });
  if (claim === "never") client.claim = (roomId, fields) => { calls.push(["claim", roomId, fields]); return new Promise(() => {}); };
  vm.runInContext(`${block}\nthis.api = { coworkTick, coworkClaim, coworkRelease, coworkPushed, coworkHeldJobs, coworkHear, coworkLink, coworkView, pcSetupLinks, mine: () => coworkMine };`, context);
  return { api: context.api, calls, logs, client, settings: () => settings };
}
const run = (id, extra = {}) => ({ id, ...extra });

test("a run's files are claimed in the project's room before it starts; nothing is claimed without a room", async () => {
  const bare = host({ rooms: {} });
  await bare.api.coworkTick();
  assert.deepEqual({ ...(await bare.api.coworkClaim(run("run_1"), ROOT, ["src/app.js"], "Fix login")) }, { ok: true, skipped: true });
  assert.equal(bare.calls.filter(([kind]) => kind === "claim").length, 0);
  const h = host();
  await h.api.coworkTick();
  assert.deepEqual(h.calls.filter(([kind]) => kind === "subscribe"), [["subscribe", "room_1"]], "the repository's room, whatever its spelling");
  const answer = await h.api.coworkClaim(run("run_1"), ROOT, ["src/app.js", path.join(ROOT, "lib", "u.js"), path.resolve("C:/elsewhere/x.js")], "Fix login");
  assert.equal(answer.ok, true);
  const sent = h.calls.find(([kind]) => kind === "claim");
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), ["claim", "room_1", { machineId: "pc-desk", runId: "run_1", paths: ["src/app.js", "lib/u.js"], exclusive: true, title: "Fix login" }]);
});

test("another PC holding a file defers the run; a slow or missing hub never holds it up", async () => {
  const clash = host({ claim: () => Promise.resolve({ ok: false, error: "conflict", conflicts: [{ title: "Refactor", overlapping: ["src/app.js"] }] }) });
  await clash.api.coworkTick();
  const held = await clash.api.coworkClaim(run("run_1"), ROOT, ["src/app.js"], "Fix login");
  assert.equal(held.ok, false);
  assert.match(held.note, /"Refactor" \(src\/app\.js\)/);
  const slow = host({ claim: "never" });
  await slow.api.coworkTick();
  assert.equal((await slow.api.coworkClaim(run("run_1"), ROOT, ["src/app.js"])).ok, true, "no answer in 5 s: the run goes ahead");
  assert.match(slow.logs.join("\n"), /no answer in time/);
  const offline = host({ state: "offline" });
  await offline.api.coworkTick();
  assert.deepEqual({ ...(await offline.api.coworkClaim(run("run_1"), ROOT, ["src/app.js"])) }, { ok: true, skipped: true });
});

test("a run that did its work keeps its claim until the next push; anything else lets go at once", async () => {
  const h = host();
  await h.api.coworkTick();
  await h.api.coworkClaim(run("run_done"), ROOT, ["a.js"]);
  await h.api.coworkClaim(run("run_quit"), ROOT, ["b.js"]);
  h.api.coworkRelease("run_done", { hold: true });
  h.api.coworkRelease("run_quit");
  await flush();
  assert.deepEqual(h.calls.filter(([kind]) => kind === "release").map(([, id]) => id), ["lease_run_quit"]);
  assert.equal(h.api.mine().has("run_done"), true, "held for the push");
  h.api.coworkPushed();
  await flush();
  assert.deepEqual(h.calls.filter(([kind]) => kind === "release").map(([, id]) => id), ["lease_run_quit", "lease_run_done"]);
  assert.equal(h.api.mine().size, 0);
});

test("claims are renewed each tick, a lost one is dropped, and a held one whose time is up lets go", async () => {
  const h = host();
  await h.api.coworkTick();
  await h.api.coworkClaim(run("run_1"), ROOT, ["a.js"]);
  h.api.mine().set("run_gone", { roomId: "room_1", leaseId: "lease_gone", holdUntil: null });
  h.api.mine().set("run_old", { roomId: "room_1", leaseId: "lease_old", holdUntil: 1 });
  await h.api.coworkTick();
  await flush();
  assert.ok(h.calls.some(([kind, id]) => kind === "renew" && id === "lease_run_1"));
  assert.equal(h.api.mine().has("run_gone"), false, "the hub no longer has it");
  assert.ok(h.calls.some(([kind, id]) => kind === "release" && id === "lease_old"), "held past its time");
  const off = host({ state: "off" });
  await off.api.coworkTick();
  assert.deepEqual(off.calls.slice(0, 2), [["connect"], ["subscribe", "room_1"]], "a linked room connects when Discord is linked");
  const unlinked = host({ state: "off", linked: false });
  await unlinked.api.coworkTick();
  assert.equal(unlinked.calls.some(([kind]) => kind === "connect"), false);
});

test("other PCs' claims reach the dispatcher as held files; this PC's never do", async () => {
  const h = host();
  await h.api.coworkTick();
  await h.api.coworkClaim(run("run_1"), ROOT, ["mine.js"]);
  const lease = (fields) => ({ leaseId: "l", memberId: ME, machineId: "pc-desk", paths: ["x.js"], exclusive: true, expiresAt: Date.now() + 60_000, title: "Work", ...fields });
  h.api.coworkHear({ type: "claims", roomId: "room_1", leases: [lease({ leaseId: "lease_run_1", paths: ["mine.js"] }), lease({ leaseId: "same-pc-other-run" }), lease({ leaseId: "laptop", machineId: "pc-laptop", paths: ["src/app.js"], title: "Refactor" })] });
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.coworkHeldJobs().map((job) => [job.leaseId, job.files, job.title]))), [["laptop", ["src/app.js"], "Refactor (on another PC)"]]);
  const view = await h.api.coworkView();
  assert.deepEqual(view.leases.map((item) => item.here), [true, true, false]);
});

test("a room links to the open project's repository; Set up this PC lists what links this PC", async () => {
  const h = host({ rooms: {} });
  const linked = await h.api.coworkLink("room_7");
  assert.equal(linked.roomId, "room_7");
  assert.deepEqual(h.settings().cowork.rooms, { "owner/app": "room_7" });
  assert.equal(h.settings().cowork.machineId, "pc-desk", "this PC's id stays");
  await h.api.coworkLink(null);
  assert.deepEqual(h.settings().cowork.rooms, {});
  assert.equal((await host({ repo: null }).api.coworkLink("room_7")).ok, false, "a project not on GitHub has nothing to share claims by");
  const links = await host({ files: { "vault.json": true, "vault-key.bin": true }, linked: false }).api.pcSetupLinks();
  assert.deepEqual(JSON.parse(JSON.stringify(links.map((item) => [item.id, item.done, item.action]))), [["vault", true, "vault"], ["link-id", true, "community"], ["discord", false, "community"], ["hub", false, "community"]]);
});
