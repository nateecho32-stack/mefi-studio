// Guard tests for scripts/vault-crypto.cjs, the Your PCs vault's sealing:
// pairing codes round-trip and catch typos, the fingerprint never reveals the
// key, and a sealed file opens only with the right key at its own path and
// only unaltered.
//
// Run: node --test tests/vault_crypto.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vault = require("../scripts/vault-crypto.cjs");

test("a pairing code carries the key, forgives case, spaces and look-alikes, and catches a typo", () => {
  const key = vault.newKey();
  assert.equal(key.length, 32);
  const code = vault.pairingCode(key);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{1,4}){13}$/);
  assert.ok(vault.readPairingCode(code).equals(key));
  assert.ok(vault.readPairingCode(` ${code.toLowerCase().replace(/-/g, " ")} `).equals(key));
  assert.ok(vault.readPairingCode(code.replace(/1/g, "l").replace(/0/g, "O")).equals(key), "l for 1 and O for 0 still read");
  for (let at = 0; at < code.length; at += 1) {
    if (code[at] === "-") continue;
    const other = code[at] === "A" ? "B" : "A";
    assert.equal(vault.readPairingCode(code.slice(0, at) + other + code.slice(at + 1)), null, `a changed character at ${at} is caught`);
  }
  for (const bad of ["", "hello", code.slice(0, 20), null, 42]) assert.equal(vault.readPairingCode(bad), null);
});

test("every mistyped character is refused, including the last one's unused bits", () => {
  // Many keys, so the last character takes many values: a change there that
  // only touches its unused bits used to decode to the same key.
  for (let round = 0; round < 200; round += 1) {
    const key = vault.newKey();
    const code = vault.pairingCode(key);
    const last = code.length - 1;
    for (const other of "0123456789ABCDEFGHJKMNPQRSTVWXYZ") {
      if (other === code[last]) continue;
      assert.equal(vault.readPairingCode(code.slice(0, last) + other), null, `last character ${code[last]} -> ${other}`);
    }
    assert.equal(vault.readPairingCode(`${code}0`), null, "an extra character is refused");
  }
});

test("the fingerprint names a key without revealing it", () => {
  const key = vault.newKey();
  const print = vault.fingerprint(key);
  assert.match(print, /^[0-9a-f]{20}$/);
  assert.equal(vault.fingerprint(Buffer.from(key)), print, "stable");
  assert.notEqual(vault.fingerprint(vault.newKey()), print);
  assert.ok(!key.toString("hex").includes(print) && !vault.pairingCode(key).includes(print));
  assert.throws(() => vault.fingerprint(Buffer.alloc(16)), /Not a vault key/);
});

test("a sealed file opens only with its key, at its own path, unaltered", () => {
  const key = vault.newKey();
  const where = "memory/insights/models.json";
  const value = { best: { coding: "model-a" }, runs: 12, note: "ünïcode ✓" };
  const sealed = vault.seal(key, where, value);
  assert.doesNotMatch(sealed, /model-a|runs|note/, "nothing readable leaks");
  assert.deepEqual(vault.open(key, where, sealed), value);
  assert.notEqual(vault.seal(key, where, value), sealed, "a fresh nonce every time");
  assert.throws(() => vault.open(vault.newKey(), where, sealed), /did not open/, "another key");
  assert.throws(() => vault.open(key, "memory/insights/other.json", sealed), /did not open/, "moved to another path");
  const box = JSON.parse(sealed);
  for (const field of ["data", "tag", "iv"]) {
    const changed = { ...box };
    const bytes = Buffer.from(changed[field], "base64");
    bytes[0] ^= 1;
    changed[field] = bytes.toString("base64");
    assert.throws(() => vault.open(key, where, JSON.stringify(changed)), /did not open|damaged/, `an edited ${field}`);
  }
  assert.throws(() => vault.open(key, where, "not json"), /not readable/);
  assert.throws(() => vault.open(key, where, JSON.stringify({ ...box, v: 2 })), /another version/);
});
