import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import credentials from "../scripts/credentials.cjs";

const { ENV_KEYS, OWN_KEYS, SHARED_KEYS, envKey, ownKey, sharedKey, keySource, hasKey } = credentials;
const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = main.indexOf(start), to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `main boundary: ${start}`);
  return main.slice(from, to);
};
const withKeystore = { encryptionAvailable: true };

test("every encrypted settings field maps to the variable its headless setter reads", () => {
  for (const [field, own] of Object.entries(OWN_KEYS)) {
    assert.ok(field.endsWith("Encrypted"), field);
    assert.ok(own.startsWith("MEFI_STUDIO_"), `${field}: ${own}`);
    // The `--set-*-key` commands read the same name, so an operator learns one
    // variable per credential.
    if (field !== "githubTokenEncrypted") assert.ok(main.includes(`process.env.${own}`), `${own} is a setter variable`);
    assert.deepEqual(ENV_KEYS[field], [own, ...SHARED_KEYS[field]], `${field}: Studio's own name is listed first`);
  }
});

test("a value is read at call time, and a blank variable is not a value", () => {
  assert.equal(ownKey("customApiKeyEncrypted", { MEFI_STUDIO_CUSTOM_KEY: "  sk-live  " }), "sk-live");
  assert.equal(ownKey("customApiKeyEncrypted", { MEFI_STUDIO_CUSTOM_KEY: "   " }), null);
  assert.equal(ownKey("customApiKeyEncrypted", {}), null);
  assert.equal(ownKey("notAField", { MEFI_STUDIO_KEY: "x" }), null);
  assert.equal(sharedKey("jevApiKeyEncrypted", { TYPESAFE_API_KEY: "ts-1" }), "ts-1");
  assert.equal(sharedKey("apiKeyEncrypted", { MEFI_STUDIO_KEY: "k" }), null, "a Studio name is not a shared one");
  assert.equal(envKey("jevApiKeyEncrypted", { MEFI_STUDIO_JEV_KEY: "mefi-1", TYPESAFE_API_KEY: "ts-1" }), "mefi-1", "Studio's own name wins");
});

// The compatibility promise. An install that updates into this code must keep
// sending exactly the credential it sent before, and only an explicit Studio
// variable may change that.
test("Studio's own variable outranks a saved key; another tool's variable never does", () => {
  const saved = { githubTokenEncrypted: "Y2lwaGVy" };
  // A desktop that exports GH_TOKEN for the gh CLI keeps using the token its
  // owner saved in Settings: an update must not silently start sending someone
  // else's.
  assert.equal(keySource(saved, "githubTokenEncrypted", { ...withKeystore, env: { GH_TOKEN: "ambient" } }), "settings");
  assert.equal(keySource(saved, "githubTokenEncrypted", { ...withKeystore, env: { GITHUB_TOKEN: "ambient" } }), "settings");
  // With nothing saved, that same variable is what makes a headless host work.
  assert.equal(keySource({}, "githubTokenEncrypted", { ...withKeystore, env: { GH_TOKEN: "ambient" } }), "env");
  // Studio's own name is an explicit instruction, so it does take over.
  assert.equal(keySource(saved, "githubTokenEncrypted", { ...withKeystore, env: { MEFI_STUDIO_GITHUB_TOKEN: "mine" } }), "env");
  // And it still wins when the keystore cannot read what was saved.
  assert.equal(keySource(saved, "githubTokenEncrypted", { encryptionAvailable: false, env: { MEFI_STUDIO_GITHUB_TOKEN: "mine" } }), "env");
});

test("a key is available from the environment without a keystore, and from settings only with one", () => {
  const saved = { apiKeyEncrypted: "Y2lwaGVy" };
  assert.equal(hasKey(saved, "apiKeyEncrypted", { env: {}, ...withKeystore }), true);
  assert.equal(hasKey(saved, "apiKeyEncrypted", { env: {}, encryptionAvailable: false }), false, "ciphertext without the keystore that wrote it is unreadable");
  assert.equal(hasKey({}, "apiKeyEncrypted", { env: { MEFI_STUDIO_KEY: "k" }, encryptionAvailable: false }), true);
  assert.equal(hasKey(null, "apiKeyEncrypted", { env: {}, ...withKeystore }), false);
  assert.equal(keySource({}, "apiKeyEncrypted", { env: {}, ...withKeystore }), null, "nothing anywhere is no key, not a source");
});

test("the host reads the three sources in the documented order and never gates a Studio variable on the keystore", () => {
  const decrypt = section("function decryptKey(", "// Whether a credential field can produce");
  assert.match(
    decrypt,
    /credentials\.ownKey\(field\)\s*\?\?\s*savedKey\(settings, field\)\s*\?\?\s*credentials\.sharedKey\(field\)/,
    "own variable, then the saved key, then another tool's variable",
  );
  assert.ok(!decrypt.includes("safeStorage"), "only savedKey() touches the keystore");
  assert.ok(!/Encrypted\)\s*&&\s*safeStorage\.isEncryptionAvailable\(\)/.test(main), "no gate pairs a saved ciphertext with the keystore directly");
  assert.ok(section("async function runAssistant(", "const eyes = await getEyes();").includes("keyAvailable(settings, field)"), "the assistant's key gate accepts any source");
  assert.ok(
    section('ipcMain.handle("settings:get-key"', 'ipcMain.handle("settings:set-key"').includes("via: keySourceFor(settings, field)"),
    "the renderer learns which source holds the key, never the key",
  );
});

// Both helpers postdate builds that are already installed, so main.cjs must
// still launch when an install arrives without them.
test("the host falls back to settings-only credentials when the map is missing", () => {
  const guarded = section('const credentials = optionalHelper(', "const { createProjects }");
  assert.ok(guarded.includes('"./scripts/credentials.cjs"'), "the require is written out so the updater's scanner sees it");
  assert.ok(guarded.includes("ownKey: () => null") && guarded.includes("sharedKey: () => null"), "no environment source without the map");
  assert.match(guarded, /keySource: \(settings, field, \{ encryptionAvailable \} = \{\}\) => \(settings\?\.\[field\] && encryptionAvailable === true \? "settings" : null\)/);
});
