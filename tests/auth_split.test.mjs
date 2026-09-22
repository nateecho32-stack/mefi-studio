import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import authStore from "../scripts/auth-store.cjs";
import credentials from "../scripts/credentials.cjs";

const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = main.indexOf(start), to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `main boundary: ${start}`);
  return main.slice(from, to);
};

test("the auth field set is exactly the credential map's fields", () => {
  assert.deepEqual(
    [...authStore.authFields()].sort(),
    Object.keys(credentials.ENV_KEYS).sort(),
    "auth.json holds every encrypted credential field and nothing the env tiers do not know",
  );
});

test("splitAuthFields moves only credential fields and keeps plain preferences", () => {
  const { auth, plain } = authStore.splitAuthFields({
    theme: "dark",
    zaiApiKeyEncrypted: "AA==",
    githubTokenEncrypted: "BB==",
    routing: { provider: "zai" },
  });
  assert.deepEqual(auth, { zaiApiKeyEncrypted: "AA==", githubTokenEncrypted: "BB==" });
  assert.deepEqual(plain, { theme: "dark", routing: { provider: "zai" } });
});

test("mergeAuthFields reattaches only known auth fields onto a plain view", () => {
  const merged = authStore.mergeAuthFields({ theme: "dark" }, { zaiApiKeyEncrypted: "AA==", notAField: "x" });
  assert.deepEqual(merged, { theme: "dark", zaiApiKeyEncrypted: "AA==" });
});

test("a missing or unreadable auth file reads as no keys, never an error", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mefi-auth-"));
  try {
    assert.deepEqual(await authStore.readAuthStore(path.join(dir, "auth.json")), {}, "missing file");
    await writeFile(path.join(dir, "auth.json"), "{not json", "utf8");
    assert.deepEqual(await authStore.readAuthStore(path.join(dir, "auth.json")), {}, "torn file");
    await writeFile(path.join(dir, "auth.json"), "[1,2]", "utf8");
    assert.deepEqual(await authStore.readAuthStore(path.join(dir, "auth.json")), {}, "not an object");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeAuthStore replaces the store so a deleted key leaves disk, with no tmp residue", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mefi-auth-"));
  const file = path.join(dir, "auth.json");
  try {
    await authStore.writeAuthStore(file, { zaiApiKeyEncrypted: "AA==" });
    assert.deepEqual(await authStore.readAuthStore(file), { zaiApiKeyEncrypted: "AA==" });
    await authStore.writeAuthStore(file, {});
    assert.deepEqual(await authStore.readAuthStore(file), {}, "a delete from the merged view empties the store");
    assert.deepEqual(await readdir(dir), ["auth.json"], "atomic write leaves no tmp file behind");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the host splits storage: auth.json beside settings.json, merged view for callers", () => {
  assert.ok(main.includes('path.join(app.getPath("userData"), "auth.json")'), "AUTH_PATH is defined beside SETTINGS_PATH");
  assert.ok(main.includes('require("./scripts/auth-store.cjs")'), "the split logic loads through scripts/auth-store.cjs");
  const read = section("async function readSettings(", "async function writeSettings(");
  assert.ok(read.includes("authStore.splitAuthFields(settings)"), "legacy ciphertext is detected on read");
  assert.ok(read.includes("authStore.readAuthStore(AUTH_PATH)"), "saved keys come from the auth file");
  assert.ok(read.includes("authStore.mergeAuthFields("), "callers keep one merged settings view");
  const write = section("async function writeSettings(", "function send(channel, payload)");
  assert.ok(write.includes("authStore.splitAuthFields(next)"), "credential fields are split out before the preferences write");
  assert.ok(write.includes("authStore.writeAuthStore(AUTH_PATH, auth)"), "credential fields persist to auth.json");
  assert.ok(!write.includes("SETTINGS_PATH, { ...next"), "the preferences file is written from the plain slice, never the merged view");
});

// The migration order is the crash-safety contract: there is never a moment
// where the ciphertext exists nowhere on disk.
test("migration writes auth.json before stripping settings.json", () => {
  const read = section("async function readSettings(", "async function writeSettings(");
  const authWrite = read.indexOf("writeAuthStore(AUTH_PATH");
  const strip = read.indexOf("atomicWriteJson(SETTINGS_PATH");
  assert.ok(authWrite >= 0 && strip > authWrite, "the blobs land in auth.json first");
});

test("the keystore paths and IPC contracts are unchanged by the split", () => {
  const saved = section("function savedKey(", "// Three sources in one order");
  assert.match(saved, /safeStorage\.decryptString\(Buffer\.from\(settings\[field\], "base64"\)\)/, "savedKey still decrypts through the keystore");
  const decrypt = section("function decryptKey(", "// Whether a credential field can produce");
  assert.match(decrypt, /credentials\.ownKey\(field\)\s*\?\?\s*savedKey\(settings, field\)\s*\?\?\s*credentials\.sharedKey\(field\)/, "precedence: own env, saved key, shared env");
});
