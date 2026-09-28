"use strict";

// The Your PCs vault's cryptography. Pure: no I/O, so tests pin every rule.
// - The key is 32 random bytes made on the first PC. It never goes into the
//   vault or to GitHub. Each paired PC keeps it through the OS keystore
//   (main's safeStorage); another PC joins by typing its pairing code.
// - A pairing code is the key in Crockford base32 with a 16-bit checksum, in
//   groups of four, so a typo is caught before anything is decrypted.
// - The fingerprint (a hash of the key, never the key) sits in the vault's
//   plain manifest, so a PC can tell it holds the right key.
// - Every file is sealed with AES-256-GCM under a fresh 96-bit nonce, and its
//   path in the vault is the additional authenticated data: a file that was
//   edited, swapped for another or moved to another path fails to open.
// Guarded by tests/vault_crypto.test.mjs.
const crypto = require("node:crypto");

const FORMAT = 1;
const KEY_BYTES = 32;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function newKey() { return crypto.randomBytes(KEY_BYTES); }

function isKey(key) { return Buffer.isBuffer(key) && key.length === KEY_BYTES; }

function fingerprint(key) {
  if (!isKey(key)) throw new Error("Not a vault key.");
  return crypto.createHash("sha256").update("mefi-vault-fingerprint:v1\0").update(key).digest("hex").slice(0, 20);
}

function base32(bytes) {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const checksum = (key) => crypto.createHash("sha256").update("mefi-vault-pairing:v1\0").update(key).digest().subarray(0, 2);

function pairingCode(key) {
  if (!isKey(key)) throw new Error("Not a vault key.");
  return base32(Buffer.concat([key, checksum(key)])).match(/.{1,4}/g).join("-");
}

// The key a typed pairing code stands for, or null. Case, spaces and dashes
// do not matter; the letters people confuse (I/L as 1, O as 0) are accepted.
function readPairingCode(code) {
  const text = String(code ?? "").toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (!/^[0-9A-Z]+$/.test(text)) return null;
  const bytes = unbase32(text);
  if (!bytes || bytes.length < KEY_BYTES + 2) return null;
  const key = bytes.subarray(0, KEY_BYTES);
  if (!crypto.timingSafeEqual(bytes.subarray(KEY_BYTES, KEY_BYTES + 2), checksum(key))) return null;
  // Only the exact code: the last character's unused bits must be zero, so
  // every mistyped character is refused, not just the ones that change data.
  if (base32(Buffer.concat([key, checksum(key)])) !== text) return null;
  return Buffer.from(key);
}

const aad = (relPath) => Buffer.from(`mefi-vault:v${FORMAT}:${String(relPath)}`, "utf8");

function seal(key, relPath, value) {
  if (!isKey(key)) throw new Error("Not a vault key.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(relPath));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${JSON.stringify({ v: FORMAT, alg: "A256GCM", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") })}\n`;
}

// The value inside a sealed file, or throws: never returns data that did not
// authenticate.
function open(key, relPath, sealed) {
  if (!isKey(key)) throw new Error("Not a vault key.");
  let box;
  try { box = JSON.parse(String(sealed)); } catch { throw new Error("The vault file is not readable."); }
  if (box?.v !== FORMAT || box.alg !== "A256GCM") throw new Error("The vault file is from another version.");
  const iv = Buffer.from(String(box.iv), "base64"), tag = Buffer.from(String(box.tag), "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("The vault file is damaged.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad(relPath));
  decipher.setAuthTag(tag);
  let text;
  try { text = Buffer.concat([decipher.update(Buffer.from(String(box.data), "base64")), decipher.final()]).toString("utf8"); }
  catch { throw new Error("The vault file did not open: wrong key, or it was changed."); }
  return JSON.parse(text);
}

module.exports = { FORMAT, KEY_BYTES, newKey, isKey, fingerprint, pairingCode, readPairingCode, seal, open };
