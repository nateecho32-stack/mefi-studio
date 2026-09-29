// The portable executable's stamp (scripts/stamp-exe.mjs): Studio's name,
// version, copyright and icon replace Electron's before anything signs the
// file. Pure helpers always run; the stamping itself runs against the real
// Electron runtime's files when node_modules/electron/dist is present (CI's
// check job has no Electron binary, so those tests skip there): a small
// unsigned DLL for the round trip and determinism, electron.exe for the icon
// group the portable build actually replaces, and a Microsoft-signed DLL for
// the refusal to stamp a signed file.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyrightLine, isWindowsExecutable, readExecutableIdentity, stampExecutable, versionParts } from "../scripts/stamp-exe.mjs";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(studio, "node_modules", "electron", "dist");
const unsignedDll = path.join(dist, "vulkan-1.dll");
const signedDll = path.join(dist, "d3dcompiler_47.dll");
const electronExe = path.join(dist, "electron.exe");
const identity = { productName: "Mefi's Studio AI+", version: "0.4.6-beta.2", fileName: "Mefi Studio AI+.exe", company: "MefiMaxi", copyright: "Copyright (c) 2026 MefiMaxi" };

test("version parts are four 16-bit numbers and a prerelease suffix stays out of them", () => {
  assert.deepEqual(versionParts("0.4.5"), [0, 4, 5, 0]);
  assert.deepEqual(versionParts("0.4.6-beta.2"), [0, 4, 6, 0]);
  assert.deepEqual(versionParts("1.2.3.4+build"), [1, 2, 3, 4]);
  assert.deepEqual(versionParts("70000.x"), [65535, 0, 0, 0]);
});

test("the copyright comes from the license's Copyright line", () => {
  assert.equal(copyrightLine("MIT License\n\nCopyright (c) 2026 MefiMaxi\n\nPermission is hereby granted"), "Copyright (c) 2026 MefiMaxi");
  assert.equal(copyrightLine("no notice here"), null);
});

test("only a file with a DOS header counts as a Windows executable", () => {
  assert.equal(isWindowsExecutable(Buffer.from("fixture")), false);
  assert.equal(isWindowsExecutable(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)])), true);
});

test("a stamped file names Studio, carries the icon and is byte-for-byte repeatable", { skip: !existsSync(unsignedDll) && "no Electron runtime" }, async () => {
  const source = await readFile(unsignedDll);
  const icon = await readFile(path.join(studio, "assets", "icon.ico"));
  const stamped = await stampExecutable(source, { ...identity, icon });
  const read = await readExecutableIdentity(stamped);
  assert.equal(read.strings.ProductName, "Mefi's Studio AI+");
  assert.equal(read.strings.FileDescription, "Mefi's Studio AI+", "Task Manager and SmartScreen show the description");
  assert.equal(read.strings.ProductVersion, "0.4.6-beta.2");
  assert.equal(read.strings.FileVersion, "0.4.6.0");
  assert.equal(read.fileVersion, "0.4.6.0");
  assert.equal(read.strings.OriginalFilename, "Mefi Studio AI+.exe");
  assert.equal(read.strings.CompanyName, "MefiMaxi");
  assert.equal(read.strings.LegalCopyright, "Copyright (c) 2026 MefiMaxi");
  assert.deepEqual(read.icons, [{ width: 256, height: 256 }]);
  assert.equal(read.signed, false);
  assert.ok((await stampExecutable(source, { ...identity, icon })).equals(stamped), "the packager skips an unchanged executable by its digest");
});

test("electron.exe's own icon group is replaced, not joined", { skip: !existsSync(electronExe) && "no Electron runtime", timeout: 60000 }, async () => {
  const before = await readExecutableIdentity(await readFile(electronExe));
  assert.equal(before.strings.ProductName, "Electron");
  assert.ok(before.icons.length > 1, "Electron ships a multi-size icon");
  const stamped = await stampExecutable(await readFile(electronExe), { ...identity, icon: await readFile(path.join(studio, "assets", "icon.ico")) });
  const after = await readExecutableIdentity(stamped);
  assert.deepEqual(after.icons, [{ width: 256, height: 256 }]);
  assert.equal(after.strings.ProductName, "Mefi's Studio AI+");
  assert.equal(after.strings.CompanyName, "MefiMaxi");
});

test("a signed file is refused: stamping after signing would break the signature", { skip: !existsSync(signedDll) && "no Electron runtime" }, async () => {
  const signed = await readFile(signedDll);
  assert.equal((await readExecutableIdentity(signed)).signed, true);
  await assert.rejects(stampExecutable(signed, identity), /already signed/);
  await assert.rejects(stampExecutable(Buffer.from("fixture"), identity), /not a Windows executable/);
});
