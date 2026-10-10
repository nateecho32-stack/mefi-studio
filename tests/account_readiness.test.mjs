import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import native from "../scripts/account-client.cjs";
import actor from "../scripts/actor-contract.cjs";

const T = 1800000000000, A = "studio:12345678-1234-4abc-8abc-123456789abc";
const session = () => ({ accountSession: "a".repeat(64), expiresAt: T + 3600000,
  actorProtocol: "accounts.canonical.1", user: { id: A, name: "Saved account" },
  state: "admitted", socialAccess: true, waitlistPosition: null });
const stored = (value = session()) => ({ selected: true, origin: "https://hub.example.test",
  encrypted: Buffer.from(JSON.stringify(value)).toString("base64") });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function pendingNative() {
  const disk = deferred(), calls = { reads: 0, writes: [], events: [], network: 0, browser: 0 };
  const client = native.createAccountClient({
    origin: "https://hub.example.test", enabled: true, canEncrypt: () => true, now: () => T,
    readStored: () => { calls.reads++; return disk.promise; },
    writeStored: async value => { calls.writes.push(value); },
    protect: value => Buffer.from(value).toString("base64"),
    unprotect: value => Buffer.from(value, "base64").toString(),
    onChange: value => calls.events.push(value),
    openExternal: async () => { calls.browser++; throw new Error("unexpected browser"); },
    fetch: async () => { calls.network++; throw new Error("unexpected fetch"); },
    http: { createServer: () => { calls.network++; throw new Error("unexpected listener"); } },
  });
  return { client, disk, calls };
}
test("async saved-state read is single-flight and cannot expose authority until ready", async () => {
  const h = pendingNative(); let delivered = false;
  const grant = h.client.accountSession().then(value => { delivered = true; return value; });
  assert.equal(h.client.isReady(), false);
  for (let i = 0; i < 10; i++) {
    const status = h.client.status();
    assert.equal(status.configured, false); assert.equal(status.linked, false);
    assert.equal(status.selected, true); assert.equal(status.user, null);
  }
  assert.equal(h.client.ready(), h.client.ready()); await settle();
  assert.equal(delivered, false); assert.equal(h.calls.reads, 1);
  h.disk.resolve(stored()); await h.client.ready();
  assert.equal(h.client.isReady(), true); assert.equal(h.client.status().user.id, A);
  assert.equal((await grant).accountSession, session().accountSession);
  assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.events.length, 0);
  await h.client.close();
});
test("async read failure or malformed saved encryption retains closed account mode", async () => {
  for (const malformed of [false, true]) {
    const h = pendingNative();
    if (malformed) h.disk.resolve({ ...stored(), encrypted: Buffer.from("invalid JSON").toString("base64") });
    else h.disk.reject(new Error("synthetic read failure"));
    await h.client.ready();
    assert.equal(h.client.isReady(), true); assert.equal(h.client.status().error, "storage");
    assert.equal(h.client.status().selected, true); assert.equal(h.client.status().linked, false);
    assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.events.length, 0);
    assert.equal(h.calls.network, 0); await h.client.close();
  }
});
test("retirement waits for the read and cannot restore a closed instance or write queued actions", async () => {
  const h = pendingNative(), signingIn = h.client.signIn(), signOut = h.client.signOut();
  let retired = false; const closing = h.client.close().then(() => { retired = true; });
  await settle(); assert.equal(retired, false); assert.equal(h.client.status().linked, false);
  h.disk.resolve(stored()); const [signInResult, signOutResult] = await Promise.all([signingIn, signOut, closing]);
  assert.equal(signInResult.error, "canceled"); assert.equal(signOutResult.error, "unavailable");
  assert.equal(retired, true); assert.equal(h.client.isReady(), false);
  assert.equal(h.client.status().linked, false); assert.equal(h.client.status().user, null);
  assert.equal((await h.client.accountSession()).error, "unavailable");
  assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.events.length, 0);
  assert.equal(h.calls.network, 0);
});
test("cancel while loading cancels a queued sign-in while preserving the saved existing account", async () => {
  const h = pendingNative(), signingIn = h.client.signIn(); await h.client.cancel();
  h.disk.resolve(stored()); await h.client.ready();
  assert.equal((await signingIn).error, "canceled");
  assert.equal(h.client.status().linked, true); assert.equal(h.client.status().user.id, A);
  assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.network, 0);
  await h.client.close();
});

const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const source = name => {
  const from = main.search(new RegExp("^(?:async )?function " + name + "\\(", "m"));
  assert.ok(from >= 0, "real main function exists: " + name);
  return main.slice(from, main.indexOf("\n}\n", from) + 3);
};
function mainPending({ saved = stored(), missing = false } = {}) {
  let currentSaved = saved, firstRead = true;
  const disk = deferred(), calls = { reads: 0, syncReads: 0, modules: [], writes: [], hubs: [], discord: 0, events: [], network: 0, work: 0 };
  const clients = [], options = [], context = vm.createContext({
    path, Buffer, Date, Promise, Object, URL, AbortController, clearTimeout, setTimeout,
    app: { getPath: () => "/synthetic/account" }, process: { env: { MEFI_STUDIO_GOOGLE_SIGNIN: "1" } },
    communitySetupCache: { hubUrl: "https://hub.example.test" },
    communityHubUrl: () => context.communitySetupCache.hubUrl, communityKeystore: () => true,
    readFileSync: () => { calls.syncReads++; throw new Error("synchronous read is forbidden"); },
    readFile: async (file, encoding) => {
      calls.reads++; assert.equal(file, path.join("/synthetic/account", "studio-account-auth.json")); assert.equal(encoding, "utf8");
      const snapshot = currentSaved;
      if (firstRead) { firstRead = false; await disk.promise; }
      if (missing) throw Object.assign(new Error("synthetic missing file"), { code: "ENOENT" });
      return JSON.stringify(snapshot);
    },
    authStore: { atomicWriteJson: async (_file, value) => calls.writes.push(value) },
    safeStorage: { encryptString: value => Buffer.from(value), decryptString: value => value.toString() },
    shell: { openExternal: async () => { calls.network++; throw new Error("no browser"); } },
    hubAccessToken: async () => { calls.discord++; return { ok: true, token: "synthetic-discord" }; },
    community: {}, communityClientId: () => "123456789012345678",
    communityRead: async () => { calls.discord++; return { state: { link: { userId: "123456789012345678" } } }; },
    readSettings: async () => ({}),
    hubClient: null, roomHistoryScopes: { select: () => {} }, roomHistoryStore: null,
    billingBrowserLinks: new Map(), commerceBrowserLinks: new Map(), pcsMemo: null,
    send: (...args) => calls.events.push(args), friendsHear: () => {}, pcsHear: () => {}, logLine: () => {},
    require: name => {
      calls.modules.push(name);
      if (name === "./scripts/actor-contract.cjs") return actor;
      assert.equal(name, "./scripts/account-client.cjs");
      return { createAccountClient: nativeOptions => {
        options.push(nativeOptions);
        const account = native.createAccountClient({ ...nativeOptions, now: () => T,
          fetch: async () => { calls.network++; throw new Error("no network"); },
          http: { createServer: () => { calls.network++; throw new Error("no listener"); } },
        });
        clients.push(account); return account;
      } };
    },
    hubModule: { configuredUrl: () => "https://hub.example.test", createHubClient: hubOptions => {
      calls.hubs.push(hubOptions);
      return { status: () => ({ state: "off", configured: true, user: null }), disconnect: async () => {} };
    } },
  });
  const start = main.indexOf("// Native Studio account sign-in."), end = main.indexOf("function retireStudioAccount()", start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(main.slice(start, end) + "\n" + ["retireStudioAccount", "studioAccountAction", "studioAccountLinked",
    "communitySetupReload", "hubInstance", "hubStatus", "hubCall"].map(source).join("\n")
    + "\nthis.api = { studioAccount, studioAccountReady, studioAccountAction, studioAccountLinked, communitySetupReload, hubInstance, hubStatus, hubCall, retireStudioAccount };", context);
  return { context, api: context.api, disk, calls, clients, options, saved: value => { currentSaved = value; } };
}
test("actual main hook lazily loads account code and waits before Hub creation or saved-account status", async () => {
  const h = mainPending();
  assert.deepEqual(h.calls.modules, ["./scripts/actor-contract.cjs"]); assert.equal(h.calls.reads, 0);
  assert.equal(h.api.hubInstance(), null); assert.equal(h.calls.hubs.length, 0);
  const pending = h.api.hubCall(async () => { h.calls.work++; return { ok: true }; });
  const status = h.api.studioAccountAction("status"), linked = h.api.studioAccountLinked();
  await settle(); assert.equal(h.calls.reads, 1); assert.equal(h.calls.syncReads, 0);
  assert.equal(h.calls.hubs.length, 0); assert.equal(h.calls.work, 0); assert.equal(h.calls.discord, 0);
  h.disk.resolve(); assert.equal((await status).status.user.id, A); assert.equal(await linked, true);
  assert.equal((await pending).ok, true); assert.equal(h.calls.work, 1); assert.equal(h.calls.hubs.length, 1);
  assert.equal(typeof h.calls.hubs[0].getAccountSession, "function");
  assert.equal((await h.calls.hubs[0].getAccountSession()).accountSession, session().accountSession);
  assert.equal(h.calls.discord, 0);
  assert.equal(h.calls.modules.filter(name => name.includes("account-client")).length, 1);
  await h.api.retireStudioAccount();
});
test("actual main permits legacy Discord only after an async ENOENT establishes no saved account mode", async () => {
  const h = mainPending({ missing: true });
  assert.equal(h.api.hubInstance(), null);
  const linked = h.api.studioAccountLinked(); await settle();
  assert.equal(h.calls.discord, 0); assert.equal(h.calls.hubs.length, 0);
  h.disk.resolve(); assert.equal(await linked, true);
  assert.equal(h.api.studioAccount().status().selected, false);
  h.api.hubInstance(); assert.equal(h.calls.hubs.length, 1);
  assert.equal(h.calls.hubs[0].getAccountSession, undefined); assert.equal(h.calls.discord, 1);
  assert.equal(h.calls.writes.length, 0); await h.api.retireStudioAccount();
});
test("actual main cancels a queued sign-in before storage readiness without starting OAuth", async () => {
  const h = mainPending(), signingIn = h.api.studioAccountAction("google");
  const cancel = h.api.studioAccountAction("cancel");
  // The real cancellation action may reconnect a previously committed account.
  // Its native Hub transport is stubbed to record that fact, never to send data.
  h.context.hubConnect = async () => ({ ok: true });
  await settle(); assert.equal(h.calls.network, 0); assert.equal(h.calls.writes.length, 0);
  h.disk.resolve(); const [old, canceled] = await Promise.all([signingIn, cancel]);
  assert.equal(old.error, "superseded"); assert.equal(canceled.ok, true);
  assert.equal(canceled.status.user.id, A); assert.equal(h.calls.network, 0);
  assert.equal(h.calls.writes.length, 0); await h.api.retireStudioAccount();
});
test("actual main replacement drains pending read and rejects old readiness before selecting a new instance", async () => {
  const h = mainPending(), old = h.api.studioAccount(), readiness = h.api.studioAccountReady();
  let replaced = false;
  const reload = h.api.communitySetupReload({ hubUrl: "https://next.example.test" }).then(() => { replaced = true; });
  await settle(); assert.equal(replaced, false); assert.equal(h.api.studioAccount(), old);
  assert.equal(h.api.hubInstance(), null); assert.equal(h.calls.hubs.length, 0);
  h.disk.resolve(); await reload; assert.equal(await readiness, null);
  assert.equal(old.status().linked, false); assert.equal(h.calls.events.length, 0);
  const nextSaved = { ...stored(), origin: "https://next.example.test" }; h.saved(nextSaved);
  const next = h.api.studioAccount(); await next.ready();
  assert.notEqual(next, old); assert.equal(next.status().linked, true);
  assert.equal(h.calls.modules.filter(name => name.includes("account-client")).length, 1);
  assert.equal(h.calls.reads, 2); assert.equal(h.calls.syncReads, 0);
  h.options[0].onChange({ linked: true, selected: true, user: { id: A }, error: null });
  assert.equal(h.calls.events.length, 0, "retired callbacks remain fenced");
  assert.equal(next.status().linked, true); assert.equal(h.calls.writes.length, 0);
  await h.api.retireStudioAccount();
});