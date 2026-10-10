"use strict";
// Real account/actor/history modules for VM host slices. Disk state is explicitly
// absent; no production files, credentials, listener or browser are used.
const path = require("node:path");
const modules = new Map([
  ["./scripts/actor-contract.cjs", require("../../scripts/actor-contract.cjs")],
  ["./scripts/account-client.cjs", require("../../scripts/account-client.cjs")],
  ["./scripts/room-history-scopes.cjs", require("../../scripts/room-history-scopes.cjs")],
  ["./scripts/room-history.cjs", require("../../scripts/room-history.cjs")],
]);
function nativeModule(name) {
  if (!modules.has(name)) throw new Error("Unexpected native VM module: " + name);
  return modules.get(name);
}
function nativeHostPorts() {
  return {
    path, Buffer, JSON, Map, URL, AbortController,
    app: { getPath: () => "/synthetic/user-data" },
    communityKeystore: () => false,
    readFile: async () => { throw Object.assign(new Error("Synthetic absent account state"), { code: "ENOENT" }); },
    readSettings: async () => ({}),
    authStore: { atomicWriteJson: async () => { throw new Error("Unexpected native credential write"); } },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: async () => { throw new Error("Unexpected native browser opening"); } },
    require: nativeModule,
  };
}
module.exports = { nativeHostPorts, nativeModule };
