import test from "node:test";
import assert from "node:assert/strict";
import history from "../scripts/room-history.cjs";
import scopes from "../scripts/room-history-scopes.cjs";
const A = "studio:12345678-1234-4abc-8abc-123456789abc", B = "studio:87654321-4321-4abc-9abc-cba987654321";
const identity = (id) => ({ id, actorProtocol: "accounts.canonical.1" }), T = 1800000000000;
const message = (author, text) => ({ id: "123456789012345678", author: { id: author, viaStudio: true }, text, createdAt: T, sig: "signed_by_relay" });
test("canonical actors never import or overwrite the unbound legacy history file", async () => {
  const loads = [], writes = []; const scope = scopes.createHistoryScopes({ create: () => history.createRoomHistory({ now: () => T }), load: (name) => { loads.push(name); return null; }, save: async (name) => writes.push(name) });
  scope.select(identity(A)); scope.current().add("same_room", message(A, "A only")); await scope.persist();
  scope.select(identity(B)); assert.deepEqual(scope.current().page("same_room").messages, []);
  assert.ok(loads.every((name) => name !== "room-history.json")); assert.ok(writes.every((name) => name !== "room-history.json"));
  scope.select({ id: "123456789012345678", actorProtocol: null }); assert.equal(loads.at(-1), "room-history.json");
});
test("queued old-actor persistence captures the old path and survives a switch back", async () => {
  const writes = []; let release;
  const scope = scopes.createHistoryScopes({ create: () => history.createRoomHistory({ now: () => T }), load: () => null, save: async (name, snapshot) => { writes.push({ name, snapshot }); await new Promise((r) => { release = r; }); } });
  scope.select(identity(A)); scope.current().add("same_room", message(A, "A only")); const token = scope.token();
  scope.select(identity(B)); assert.equal(scope.isCurrent(token), false);
  await new Promise(setImmediate); assert.equal(writes[0].name, scopes.fileName(scopes.scopeOf(identity(A))));
  scope.select(identity(A)); assert.equal(scope.current().page("same_room").messages[0].text, "A only"); release(); await scope.flush();
});
test("disconnect invalidates late history and invalid actors cannot choose a path", () => {
  const scope = scopes.createHistoryScopes({ create: () => history.createRoomHistory({ now: () => T }), load: () => null, save: async () => {} });
  scope.select(identity(A)); const token = scope.token(); scope.select(null);
  assert.equal(scope.current(), null); assert.equal(scope.isCurrent(token), false);
  for (const id of ["studio:../legacy", "studio:foo", A.toUpperCase()]) assert.equal(scopes.scopeOf(identity(id)), null);
  assert.equal(scopes.fileName("../room-history.json"), null);
});