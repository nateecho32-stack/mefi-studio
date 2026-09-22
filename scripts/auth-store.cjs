"use strict";
// Credential ciphertext lives in its own file beside settings.json so the
// preferences file stays plain, copyable state: settings.json never carries a
// DPAPI-bound blob, and the auth file never carries a preference. The field
// set is owned by scripts/credentials.cjs (ENV_KEYS); the frozen fallback
// below keeps the split working when an install updates into a tree where
// that helper has not landed yet — the same contract main.cjs's
// optionalHelper gives the environment tiers.
const { mkdir, readFile, rename, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const credentials = require("./credentials.cjs");

const FALLBACK_AUTH_FIELDS = Object.freeze([
  "apiKeyEncrypted",
  "zaiApiKeyEncrypted",
  "customApiKeyEncrypted",
  "gatewayApiKeyEncrypted",
  "jevApiKeyEncrypted",
  "zenApiKeyEncrypted",
  "openrouterApiKeyEncrypted",
  "githubTokenEncrypted",
]);

let cachedFields = null;

// The credential fields that belong in the auth file, nothing else.
function authFields() {
  if (!cachedFields) {
    cachedFields = Object.freeze([...new Set([...Object.keys(credentials.ENV_KEYS ?? {}), ...FALLBACK_AUTH_FIELDS])]);
  }
  return cachedFields;
}

// Split a merged settings view: the credential slice, and a plain copy that
// never carries an auth field. An explicitly undefined value counts as
// absent, not as a blob to keep.
function splitAuthFields(settings) {
  const auth = {};
  const plain = { ...(settings ?? {}) };
  for (const field of authFields()) {
    if (!Object.prototype.hasOwnProperty.call(plain, field)) continue;
    if (plain[field] !== undefined) auth[field] = plain[field];
    delete plain[field];
  }
  return { auth, plain };
}

// The inverse of split: reattach the auth file's fields onto a plain settings
// object so callers keep reading one merged view (settings[field] answers).
function mergeAuthFields(plain, auth) {
  const merged = { ...(plain ?? {}) };
  for (const field of authFields()) {
    if (auth && Object.prototype.hasOwnProperty.call(auth, field) && auth[field] !== undefined) merged[field] = auth[field];
  }
  return merged;
}

// A missing, empty or unreadable auth file reads as "no keys saved". It is
// never an error: a fresh install simply has no credentials yet.
async function readAuthStore(authPath) {
  try {
    const parsed = JSON.parse(await readFile(authPath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Atomic rename so a reader never sees a torn document; the plain-write
// fallback covers filesystems that refuse a rename onto an open file.
async function atomicWriteJson(file, payload) {
  await mkdir(path.dirname(file), { recursive: true });
  const body = JSON.stringify(payload, null, 2);
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, body);
    try {
      await rename(tmp, file);
    } catch {
      await writeFile(file, body);
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

// The caller's slice becomes the whole store, so a field deleted from the
// merged settings view disappears from disk instead of surviving here.
async function writeAuthStore(authPath, store) {
  await atomicWriteJson(authPath, store);
}

module.exports = { FALLBACK_AUTH_FIELDS, authFields, splitAuthFields, mergeAuthFields, readAuthStore, writeAuthStore, atomicWriteJson };
