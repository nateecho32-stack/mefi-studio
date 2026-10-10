import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import native from "../scripts/account-client.cjs";
import { readFile } from "node:fs/promises";
import { createDom } from "./fixtures/renderer-dom.mjs";
const source = await readFile(new URL("../renderer/account.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function harness(configured = false, onSignedIn, nativeClient) {
  const dom = createDom(), calls = [], listeners = [];
  const status = { configured, selected: false, linked: false, signingIn: false, user: null, error: null };
  const window = { mefiStudio: { studioAccount: async (action) => { calls.push(action); if (nativeClient) { const answer = action === "status" ? { ok: true } : await nativeClient.signIn({ link: action === "linkGoogle" }); return { ...answer, status: nativeClient.status() }; } return { ok: true, status }; }, onStudioAccount: (fn) => listeners.push(fn) } };
  vm.runInNewContext(source, { window, document: dom.document });
  const root = window.MefiAccount.card({ onSignedIn }); dom.document.body.append(root);
  return { root, calls, listeners, status, window, button: (label) => root.querySelectorAll("button").find((b) => b.textContent === label) };
}
test("reachable Google controls are explicitly unavailable without native configuration", async () => {
  const h = harness(); await flush(); assert.match(h.root.textContent, /not configured/);
  assert.equal(h.button("Sign in with Google").disabled, true); assert.deepEqual(h.calls, ["status"]);
});
test("renderer initiates named actions only and exposes explicit cancellation and sign-out", async () => {
  const h = harness(true); await flush(); await h.button("Sign in with Google").click(); await flush();
  assert.deepEqual(h.calls, ["status", "google"]); h.listeners[0]({ ...h.status, signingIn: true });
  assert.ok(h.button("Cancel Google sign-in")); await h.button("Cancel Google sign-in").click(); await flush();
  assert.equal(h.calls.at(-1), "cancel");
  h.listeners[0]({ ...h.status, selected: true, linked: true, user: { id: "studio:12345678-1234-4abc-8abc-123456789abc", name: "Member" } });
  assert.ok(h.button("Sign out of Studio")); assert.ok(h.button("Use my linked Discord account"));
  assert.doesNotMatch(h.root.textContent, /accountSession|codeVerifier|handoff/);
});
test("waitlist position above 1000 is visible and successful sign-in cannot open social UI", async () => {
  let opened = 0; const h = harness(true, () => opened++); await flush();
  Object.assign(h.status, { selected: true, linked: true, user: { name: "Waiting member" }, state: "waitlisted", socialAccess: false, waitlistPosition: 1001 });
  h.listeners[0](h.status); assert.match(h.root.textContent, /position 1001/);
  assert.match(h.root.textContent, /pending|admitted/);
  await h.button("Switch Google account").click(); await flush();
  assert.equal(opened, 0); assert.deepEqual(h.calls, ["status", "google"]);
});
test("actual native broker migration refusals reach account UI without creating a wallet or changing history", async () => {
  for (const code of ["legacy_account_migration_required", "legacy_wallet_migration_required"]) {
    const calls = [];
    const client = native.createAccountClient({
      origin: "https://hub.example.test", enabled: true, canEncrypt: () => true,
      protect: value => Buffer.from(value).toString("base64"), unprotect: value => Buffer.from(value, "base64").toString(),
      writeStored: async () => {}, openExternal: async () => { throw new Error("must not open"); },
      getDiscordAccessToken: async () => ({ ok: true, token: "discord_fixture" }),
      fetch: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ error: code }), { status: 401 }); },
    });
    let opened = 0; const h = harness(true, () => opened++, client); await flush();
    await h.button("Link Google to my existing account").click();
    for (let i = 0; i < 6; i++) await new Promise(setImmediate);
    assert.match(h.root.textContent, /history need[s]? migration and review/);
    assert.match(h.root.textContent, /saved account and history have been kept/);
    assert.equal(client.status().selected, false); assert.equal(opened, 0);
    assert.equal(calls.length, 1); assert.match(calls[0].url, /\/v1\/auth\/discord\/exchange$/);
    assert.deepEqual(h.calls, ["status", "linkGoogle"]);
    client.close();
  }
});