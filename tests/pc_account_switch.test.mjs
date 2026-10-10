import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const A = "studio:12345678-1234-4abc-8abc-123456789abc", B = "studio:87654321-4321-4abc-9abc-cba987654321";
function source(name) {
  const start = main.search(new RegExp("^(?:async )?function " + name + "\\(", "m"));
  assert.ok(start >= 0, name + " exists in native main");
  return main.slice(start, main.indexOf("\n}\n", start) + 3);
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness(names, extra = {}) {
  const sent = [], clients = [A, B].map(id => ({ status: () => ({ state: "ready", user: { id }, actorProtocol: "accounts.canonical.1" }), pcSend: async (...args) => { sent.push({ id, args }); return { ok: true }; } }));
  const c = vm.createContext({ hubClient: clients[0], Map, Set, Promise, JSON, Number, Boolean, String, Array, path, crypto, ...extra });
  vm.runInContext([source("pcsSessionFence"), ...names.map(source)].join("\n"), c);
  return { c, sent, clients, switch: () => { c.hubClient = clients[1]; }, guard: () => c.pcsSessionFence() };
}

test("real receive/start handler paused under A cannot admit work or dispatch through B", async () => {
  const key = deferred(), effects = [], peer = { id: "pc_peer", name: "Peer", relation: "mine", keys: {} };
  const body = { type: "start", reqId: "work", project: { key: "project" }, title: "Old account work", prompt: "Do it" };
  const h = harness(["pcsReceive", "pcsStartHear"], {
    pcsLibs() {}, pcTrust: { open: () => ({ ok: true, from: peer.id, body }) },
    coworkMachineId: async () => "local", pcsIdentity: async () => ({}), pcsPeers: async () => [peer],
    pcsMem: () => ({ seen: {} }), pcsNow: () => 1, logLine() {},
    projects: { open: () => ({ id: "project" }) }, pcFleet: { isProjectKey: () => true, cleanCard: v => v },
    pcsProjectKey: () => key.promise, pcsAdmitCards: async () => { effects.push("admit"); return [{ created: { id: "task" } }]; },
    pcsSendTo: async () => effects.push("send"), pcsNote: () => effects.push("note"),
    pcsPush: () => effects.push("push"), assistantAskForWork: () => effects.push("run"),
  });
  const pending = h.c.pcsReceive({ from: peer.id, fromUser: A, env: { k: "sealed" } });
  await flush(); h.switch(); key.resolve("project"); await pending;
  assert.deepEqual(effects, []); assert.deepEqual(h.sent, []);
});

test("queued real board admission checks the old actor at the mutation callback", async () => {
  const queued = deferred(), board = { tasks: [] }; let callback, admissions = 0;
  const h = harness(["pcsAdmitCards"], {
    pcsNow: () => 1, projects: { current: () => ({ id: "project" }) }, projectRoot: () => "/local/project",
    pcsMem: () => ({}), mutateBoard: work => { callback = work; return queued.promise; },
    workAdmission: { admitTask: () => { admissions++; return { created: { id: "bad" } }; } },
  });
  const pending = h.c.pcsAdmitCards([{ id: "old", title: "Old", prompt: "" }], { peer: { id: "peer", name: "Peer", relation: "mine" }, guard: h.guard() });
  h.switch(); queued.resolve(callback(board)); const result = await pending;
  assert.equal(result.length, 0); assert.equal(admissions, 0); assert.deepEqual(board.tasks, []);
});

test("independent local admission remains available without an account fence", async () => {
  let admissions = 0;
  const h = harness(["pcsAdmitCards"], {
    pcsNow: () => 1, projects: { current: () => ({ id: "project" }) }, projectRoot: () => "/local/project", pcsMem: () => ({}),
    mutateBoard: async work => work({ tasks: [] }), workAdmission: { admitTask: () => { admissions++; return { created: { id: "local" } }; } },
  });
  h.c.hubClient = null;
  const result = await h.c.pcsAdmitCards([{ id: "local", title: "Local", prompt: "" }], { peer: { id: "paired-device", name: "PC", relation: "mine" } });
  assert.equal(admissions, 1); assert.equal(result[0].created.id, "local");
});

test("real sealed sender never uses a new account after an identity await", async () => {
  const identity = deferred(), peer = { id: "peer", relation: "mine", keys: { sign: "s", box: "b" } }; let seals = 0;
  const h = harness(["pcsSendTo"], {
    pcsIdentity: () => identity.promise, pcsPeers: async () => [peer],
    pcsMem: () => ({ roster: [{ id: peer.id, keys: peer.keys }] }), pcsNow: () => 1,
    coworkMachineId: async () => "local", pcTrust: { seal: () => { seals++; return {}; } },
  });
  const pending = h.c.pcsSendTo(peer.id, { type: "start" }, h.guard());
  h.switch(); identity.resolve({}); assert.equal((await pending).reason, "not-paired");
  assert.equal(seals, 0); assert.deepEqual(h.sent, []);
});

test("queued pairing save keeps original durable state when its actor changes", async () => {
  const queue = deferred(), old = [{ id: "saved-peer" }], mem = { files: queue.promise, peers: old }, writes = [];
  const h = harness(["pcsWriteJson", "pcsPeersSave"], {
    pcsMem: () => mem, pcsHome: () => "/fixture/pcs", pcFleet: { cleanPeers: rows => rows.map(row => ({ ...row })) },
    mkdir: async () => writes.push("mkdir"), writeFile: async () => writes.push("write"), rename: async () => writes.push("rename"), process: { pid: 1 },
  });
  const pending = h.c.pcsPeersSave([{ id: "new-peer" }], h.guard()); h.switch(); queue.resolve();
  await pending; assert.deepEqual(writes, []); assert.equal(mem.peers, old);
});

test("late native PC status cannot publish old account data into B", async () => {
  const pendingStatus = deferred(), pushes = [];
  const h = harness(["pcsPush"], { pcsMem: () => ({ watchUntil: 100 }), pcsNow: () => 1, pcsStatus: () => pendingStatus.promise, send: (...args) => pushes.push(args) });
  h.c.pcsPush(h.guard()); h.switch(); pendingStatus.resolve({ ok: true, actor: A }); await flush();
  assert.deepEqual(pushes, []);
});

test("real queued existing-card updates do not modify the new account's view", async () => {
  const queued = deferred(), board = { tasks: [{ id: "task", status: "ready" }] }; let callback, changes = 0;
  const h = harness(["pcsOnCard"], {
    projects: { list: () => ({ projects: [{ id: "project" }] }), run: async (_project, work) => work() },
    getEyes: async () => ({ readJson: async () => board.tasks }), TASKS_PATH: "tasks",
    mutateBoard: work => { callback = work; return queued.promise; },
  });
  const pending = h.c.pcsOnCard("task", row => { changes++; row.status = "done"; }, h.guard());
  await flush(); h.switch(); queued.resolve(callback(board)); await pending;
  assert.equal(changes, 0); assert.equal(board.tasks[0].status, "ready");
});

test("community account IPC uses native named actions and waitlisted success never connects", async () => {
  const handlers = new Map(), actions = [], connects = [];
  const status = { selected: true, linked: true, state: "waitlisted", socialAccess: false, waitlistPosition: 1001, user: { id: A, name: "Waiting" }, error: null };
  const account = { status: () => status, signIn: async options => { actions.push(options ?? {}); return { ok: true }; } };
  const c = vm.createContext({ studioAccountActionGeneration: 0, studioAccount: () => account, hubConnect: async () => connects.push(true), ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, Object });
  vm.runInContext(source("studioAccountAction") + "\n" + main.split("\n").find(line => line.includes('ipcMain.handle("community:account"')), c);
  const invoke = handlers.get("community:account");
  assert.equal((await invoke({}, { action: "google" })).ok, true); assert.equal(connects.length, 0);
  assert.equal((await invoke({}, { action: "status" })).status.waitlistPosition, 1001);
  assert.equal((await invoke({}, { action: "url", url: "https://evil.test" })).error, "bad-request");
  assert.equal(actions.length, 1);
  status.state = "admitted"; status.socialAccess = true; status.waitlistPosition = null;
  await invoke({}, { action: "google" }); assert.equal(connects.length, 1);
});
test("real PC forget preserves local removal but never sends A's envelope through B", async () => {
  for (const phase of ["identity", "machine"]) {
    const deferredValue = deferred(), entered = deferred(), writes = [], effects = [];
    const peer = { id: "peer", name: "Old peer", relation: "borrower" };
    const h = harness(["pcsForget"], {
      pcsLibs() {}, pcsPeers: async () => [peer], pcsPeersSave: async rows => writes.push(rows),
      pcsIdentity: async () => { if (phase === "identity") { entered.resolve(); return deferredValue.promise; } return {}; },
      coworkMachineId: async () => { entered.resolve(); return deferredValue.promise; },
      pcsMem: () => ({ roster: [] }), pcsNow: () => 1,
      pcTrust: { pairEnvelope: () => { effects.push("envelope"); return {}; } },
      pcsNote: () => effects.push("note"), pcsPush: () => effects.push("push"),
    });
    const pending = h.c.pcsForget(peer.id); await entered.promise; h.switch();
    deferredValue.resolve(phase === "identity" ? {} : "local");
    assert.equal((await pending).ok, true);
    assert.equal(writes.length, 1); assert.equal(writes[0].length, 0);
    assert.deepEqual(h.sent, []); assert.deepEqual(effects, []);
  }
});

test("explicit local PC forgetting still removes the pairing while offline", async () => {
  const writes = [];
  const h = harness(["pcsForget"], {
    pcsLibs() {}, pcsPeers: async () => [{ id: "peer", name: "Peer", relation: "mine" }],
    pcsPeersSave: async rows => writes.push(rows),
    pcsIdentity: async () => { throw new Error("offline forget must not need signing"); },
  });
  h.c.hubClient = null;
  assert.equal((await h.c.pcsForget("peer")).ok, true);
  assert.equal(writes.length, 1); assert.equal(writes[0].length, 0); assert.deepEqual(h.sent, []);
});