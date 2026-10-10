import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import nativeFixture from "./fixtures/native-account-host.cjs";

// main.cjs's pet (the "Rooms hub" block) in a vm: hub:pet hands the hub
// client the pet's own three fields only (or null, as for a pet that is off),
// and a room's pets from the hub client reach the renderer on hub:event as
// { type: "roomPets", roomId, pets }. Then the preload bridge, which copies
// the same three fields.

const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const preload = (await readFile(new URL("../preload.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("// ---- Rooms hub: listen together and now playing");
const to = main.indexOf("// ---- end of the rooms hub", from);
assert.ok(from > 0 && to > from, "main.cjs has a Rooms hub block");
const block = main.slice(from, to);
const plain = (value) => JSON.parse(JSON.stringify(value));

function host() {
  const pets = [];
  const sent = [];
  let created = null;
  const client = {
    status: () => ({ configured: true, state: "ready", error: null, user: null, readOnly: false, paused: false, rooms: [] }),
    setPet: (pet) => { pets.push(pet); return pet === null || pet.kind === "dragon"; },
  };
  const context = vm.createContext({
    ...nativeFixture.nativeHostPorts(),
    process: { env: {} }, Date, Boolean, Number, Object, String,
    community: {}, discordOAuth: {}, COMMUNITY_ACCESS_MARGIN_MS: 60_000, communityTokens: null,
    communityClientId: () => "1234567890",
    communityRead: async () => ({ state: { link: { userId: "42" } } }),
    checkCommunity: async () => ({ ok: true }), publishCommunity: async () => ({}),
    send: (channel, payload) => sent.push([channel, payload]), logLine: () => {},
    optionalHelper: () => ({ configuredUrl: () => "https://hub.example.test", createHubClient: (options) => { created = options; return client; } }),
  });
  vm.runInContext(`${block}\nthis.api = { hubPet, hubInstance, studioAccountReady };`, context);
  return { api: context.api, pets, sent, created: () => created };
}

test("hub:pet hands the hub client the pet's own three fields, or null", async () => {
  assert.match(main, /ipcMain\.handle\("hub:pet", async \(_event, payload\) => hubPet\(payload\?\.pet \?\? null\)\);/);
  const h = host();
  const answer = await h.api.hubPet({ kind: "dragon", skin: "frost", name: "Ember", on: true, size: 2, css: "x" });
  assert.equal(answer.ok, true);
  assert.ok(answer.status, "the hub's status comes back as with every hub call");
  await h.api.hubPet({ kind: "dragon", skin: "theme", name: "Ember", on: false });
  await h.api.hubPet(null);
  await h.api.hubPet("Ember");
  await h.api.hubPet({ kind: 7, skin: null });
  assert.deepEqual(plain(h.pets), [
    { kind: "dragon", skin: "frost", name: "Ember" },
    null,
    null,
    null,
    { kind: "7", skin: "", name: "" },
  ], "a pet that is off is none; anything else crosses as three strings, which the hub client checks");
});

test("a room's pets from the hub client reach the renderer on hub:event", async () => {
  const h = host();
  await h.api.studioAccountReady(); h.api.hubInstance();
  const event = { type: "roomPets", roomId: "room_a", pets: [{ id: "200000000000000001", userId: "200000000000000001", name: "Alice", pet: { kind: "dragon", skin: "theme", name: "Ember" } }] };
  h.created().onEvent(event);
  assert.deepEqual(plain(h.sent), [["hub:event", event]]);
});

test("the preload bridge copies the same three fields, and an off pet is none", () => {
  const line = preload.split("\n").find((text) => text.startsWith("  hubPet: (pet) => ipcRenderer.invoke(\"hub:pet\""));
  assert.ok(line, "preload.cjs has hubPet");
  const invoked = [];
  const context = vm.createContext({ ipcRenderer: { invoke: (channel, payload) => { invoked.push([channel, payload]); return Promise.resolve({ ok: true }); } } });
  const hubPet = vm.runInContext(`(${line.trim().replace(/^hubPet: /, "").replace(/,$/, "")})`, context);
  hubPet({ kind: "dragon", skin: "gold", name: `Ember${"x".repeat(80)}`, on: true, extra: { deep: 1 } });
  hubPet({ kind: "dragon", skin: "gold", name: "Ember", on: false });
  hubPet(null);
  hubPet("Ember");
  assert.deepEqual(plain(invoked), [
    ["hub:pet", { pet: { kind: "dragon", skin: "gold", name: `Ember${"x".repeat(59)}` } }],
    ["hub:pet", { pet: null }],
    ["hub:pet", { pet: null }],
    ["hub:pet", { pet: null }],
  ]);
});
