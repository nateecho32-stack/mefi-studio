import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import credentials from "../scripts/credentials.cjs";

const { ENV_KEYS, envKey, hasKey } = credentials;
const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = main.indexOf(start), to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `main boundary: ${start}`);
  return main.slice(from, to);
};

test("every encrypted settings field maps to the variable its headless setter reads", () => {
  for (const [field, names] of Object.entries(ENV_KEYS)) {
    assert.ok(field.endsWith("Encrypted"), field);
    assert.ok(names.length >= 1 && names[0].startsWith("MEFI_STUDIO_"), `${field}: ${names.join(", ")}`);
    // The `--set-*-key` commands read the same first name, so an operator
    // learns one variable per credential.
    if (field !== "githubTokenEncrypted") assert.ok(main.includes(`process.env.${names[0]}`), `${names[0]} is a setter variable`);
  }
});

test("an exported variable is read at call time and blank values do not count", () => {
  assert.equal(envKey("customApiKeyEncrypted", { MEFI_STUDIO_CUSTOM_KEY: "  sk-live  " }), "sk-live");
  assert.equal(envKey("customApiKeyEncrypted", { MEFI_STUDIO_CUSTOM_KEY: "   " }), null);
  assert.equal(envKey("customApiKeyEncrypted", {}), null);
  assert.equal(envKey("jevApiKeyEncrypted", { TYPESAFE_API_KEY: "ts-1" }), "ts-1", "the provider's own variable is the fallback");
  assert.equal(envKey("jevApiKeyEncrypted", { MEFI_STUDIO_JEV_KEY: "mefi-1", TYPESAFE_API_KEY: "ts-1" }), "mefi-1", "the Studio variable wins");
  assert.equal(envKey("notAField", { MEFI_STUDIO_KEY: "x" }), null);
});

test("a key is available from the environment without a keystore, and from settings only with one", () => {
  const saved = { apiKeyEncrypted: "Y2lwaGVy" };
  assert.equal(hasKey(saved, "apiKeyEncrypted", { env: {}, encryptionAvailable: true }), true);
  assert.equal(hasKey(saved, "apiKeyEncrypted", { env: {}, encryptionAvailable: false }), false, "ciphertext without the keystore that wrote it is unreadable");
  assert.equal(hasKey({}, "apiKeyEncrypted", { env: { MEFI_STUDIO_KEY: "k" }, encryptionAvailable: false }), true);
  assert.equal(hasKey(null, "apiKeyEncrypted", { env: {}, encryptionAvailable: true }), false);
});

test("the host reads the environment before the keystore and never gates an environment key on encryption", () => {
  const decrypt = section("function decryptKey(", "function keyAvailable(");
  assert.ok(decrypt.indexOf("credentials.envKey(field)") < decrypt.indexOf("safeStorage.isEncryptionAvailable()"), "the environment is consulted first");
  assert.ok(!/Encrypted\)\s*&&\s*safeStorage\.isEncryptionAvailable\(\)/.test(main), "no gate pairs a saved ciphertext with the keystore directly");
  assert.ok(section("async function runAssistant(", "const eyes = await getEyes();").includes("keyAvailable(settings, field)"), "the assistant's key gate accepts either source");
  assert.ok(section('ipcMain.handle("settings:get-key"', 'ipcMain.handle("settings:set-key"').includes('via: credentials.envKey(field) ? "env" : "settings"'), "the renderer learns which source holds the key, never the key");
});
