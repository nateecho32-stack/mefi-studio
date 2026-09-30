// scripts/badge-icon.cjs: the numbered disc Windows lays over Studio's taskbar
// button, drawn without a canvas or a dependency. The PNG is read back by a
// decoder written here from the format (chunk CRCs checked with node:zlib's own
// crc32, the image data inflated and unfiltered), the picture is pinned as text,
// and the two sizes (16 px, and 32 px for scaled displays) are compared.
//
// Run: node --test tests/badge_icon.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const icon = require("../scripts/badge-icon.cjs");

// A PNG reader from the format: signature, chunks with their CRCs, IHDR, IDAT.
function readPng(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "the PNG signature");
  const chunks = [];
  let at = 8;
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("ascii", at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + length);
    assert.equal(buffer.readUInt32BE(at + 8 + length), zlib.crc32(buffer.subarray(at + 4, at + 8 + length)), `${type} has its CRC`);
    chunks.push({ type, data });
    at += 12 + length;
  }
  assert.equal(at, buffer.length, "no bytes after the last chunk");
  assert.deepEqual(chunks.map((chunk) => chunk.type), ["IHDR", "IDAT", "IEND"]);
  const header = chunks[0].data;
  const info = { width: header.readUInt32BE(0), height: header.readUInt32BE(4), depth: header[8], colour: header[9], compression: header[10], filter: header[11], interlace: header[12] };
  const raw = zlib.inflateSync(chunks[1].data);
  assert.equal(raw.length, (info.width * 4 + 1) * info.height);
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let y = 0; y < info.height; y += 1) {
    assert.equal(raw[y * (info.width * 4 + 1)], 0, "filter type None on every row");
    raw.copy(rgba, y * info.width * 4, y * (info.width * 4 + 1) + 1, (y + 1) * (info.width * 4 + 1));
  }
  return { ...info, rgba };
}
const pixel = (picture, x, y) => { const at = (y * picture.width + x) * 4; return [...picture.rgba.subarray(at, at + 4)]; };
const inkCount = (text) => [...text].filter((char) => char === "#").length;

test("the number drawn is a whole number from 1 to 99; nothing is drawn for anything else", () => {
  assert.deepEqual([0, 1, 7, 10, 99, 100, 5000, 4.9, "12", -3, NaN, undefined, null, "x"].map(icon.shown), [0, 1, 7, 10, 99, 99, 99, 4, 12, 0, 0, 0, 0, 0]);
  for (const nothing of [0, -1, NaN, undefined, "no"]) {
    assert.equal(icon.render(nothing), null);
    assert.equal(icon.overlay(nothing), null);
    assert.equal(icon.ascii(nothing), "");
  }
  assert.equal(icon.MAX, 99);
});

test("a picture is 16 by 16, or 32 by 32 for a scaled display, straight RGBA", () => {
  const small = icon.render(3);
  assert.deepEqual([small.width, small.height, small.rgba.length], [16, 16, 16 * 16 * 4]);
  const large = icon.render(3, { size: 32 });
  assert.deepEqual([large.width, large.height, large.rgba.length], [32, 32, 32 * 32 * 4]);
  assert.equal(icon.render(3, { size: 24 }).width, 16, "any other size is the small one");
});

test("the PNG is a real PNG: chunk CRCs, 8-bit RGBA, and the pixels come back exactly", () => {
  for (const [count, size] of [[1, 16], [7, 16], [42, 16], [99, 32], [3, 32]]) {
    const picture = icon.render(count, { size });
    const decoded = readPng(icon.png(picture));
    assert.deepEqual([decoded.width, decoded.height, decoded.depth, decoded.colour, decoded.compression, decoded.filter, decoded.interlace], [size, size, 8, 6, 0, 0, 0]);
    assert.ok(decoded.rgba.equals(picture.rgba), `${count} at ${size}: the decoded pixels are the drawn ones`);
  }
  const overlay = icon.overlay(12);
  assert.ok(Buffer.isBuffer(overlay.png));
  assert.equal(readPng(overlay.png).width, 16);
  assert.deepEqual([overlay.count, overlay.description, overlay.size], [12, "12 waiting on you", 16]);
  assert.equal(icon.overlay(500, { size: 32 }).description, "99 waiting on you");
  assert.equal(icon.overlay(500, { size: 32 }).size, 32);
  assert.equal(icon.overlay(1).description, "1 waiting on you");
});

test("what is drawn: a red disc with white digits, clear outside it and soft at its rim", () => {
  const picture = icon.render(8);
  assert.deepEqual(pixel(picture, 0, 0), [0, 0, 0, 0], "a corner is clear");
  assert.deepEqual(pixel(picture, 15, 15), [0, 0, 0, 0]);
  assert.deepEqual(pixel(picture, 3, 8), [209, 52, 56, 255], "the disc is red and solid inside");
  const ink = icon.ascii(8).split("\n");
  const whites = [];
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) if (ink[y][x] === "#") whites.push(pixel(picture, x, y));
  assert.ok(whites.length > 10 && whites.every((p) => p[0] === 255 && p[1] === 255 && p[2] === 255 && p[3] === 255), "the digits are flat white");
  const alphas = new Set();
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) alphas.add(pixel(picture, x, y)[3]);
  assert.ok([...alphas].some((alpha) => alpha > 0 && alpha < 255), "the rim is anti-aliased");
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) assert.equal(pixel(picture, x, y)[3], pixel(picture, 15 - x, y)[3], "the disc is symmetric");
});

test("the picture, pinned as text: 1, 3 and 10 at 16 px", () => {
  assert.equal(icon.ascii(1), [
    "......oooo......",
    "....oooooooo....",
    "...oooooooooo...",
    "..oooooooooooo..",
    ".oooooo#ooooooo.",
    ".ooooo##ooooooo.",
    "ooooooo#oooooooo",
    "ooooooo#oooooooo",
    "ooooooo#oooooooo",
    "ooooooo#oooooooo",
    ".ooooo###oooooo.",
    ".oooooooooooooo.",
    "..oooooooooooo..",
    "...oooooooooo...",
    "....oooooooo....",
    "......oooo......",
  ].join("\n"));
  assert.equal(icon.ascii(3), [
    "......oooo......",
    "....oooooooo....",
    "...oooooooooo...",
    "..oooooooooooo..",
    ".oooo####oooooo.",
    ".oooooooo#ooooo.",
    "ooooooooo#oooooo",
    "oooooo###ooooooo",
    "ooooooooo#oooooo",
    "ooooooooo#oooooo",
    ".oooo####oooooo.",
    ".oooooooooooooo.",
    "..oooooooooooo..",
    "...oooooooooo...",
    "....oooooooo....",
    "......oooo......",
  ].join("\n"));
  assert.equal(icon.ascii(10), [
    "......oooo......",
    "....oooooooo....",
    "...oooooooooo...",
    "..oooooooooooo..",
    ".ooo#oooo###ooo.",
    ".oo##ooo#ooo#oo.",
    "oooo#ooo#ooo#ooo",
    "oooo#ooo#ooo#ooo",
    "oooo#ooo#ooo#ooo",
    "oooo#ooo#ooo#ooo",
    ".oo###ooo###ooo.",
    ".oooooooooooooo.",
    "..oooooooooooo..",
    "...oooooooooo...",
    "....oooooooo....",
    "......oooo......",
  ].join("\n"));
});

test("every digit is drawn, two fit inside the disc, and a bigger count reads 99", () => {
  for (let digit = 0; digit <= 9; digit += 1) assert.ok(icon.FONT[digit].length === 7 && icon.FONT[digit].every((row) => row.length === 5), `${digit} is 5 by 7`);
  const seen = new Set();
  for (let digit = 1; digit <= 9; digit += 1) seen.add(icon.ascii(digit));
  assert.equal(seen.size, 9, "no two digits look alike");
  assert.notEqual(icon.ascii(10), icon.ascii(1));
  // Two digits, all of it inside the disc: no ink on the clear corners.
  for (const count of [10, 28, 67, 99]) {
    const picture = icon.render(count);
    for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15], [1, 2], [14, 2], [1, 13], [14, 13]]) assert.equal(pixel(picture, x, y)[3] < 255, true);
    const rows = icon.ascii(count).split("\n");
    assert.ok(rows.every((row) => !/^#|#$/.test(row)), `${count} stays off the edges`);
  }
  assert.equal(icon.ascii(100), icon.ascii(99));
  assert.equal(icon.ascii(1e9), icon.ascii(99));
});

test("the large picture has the same digits at twice the size, so a 150% display is as sharp as a 100% one", () => {
  for (const count of [1, 5, 10, 77]) {
    assert.equal(inkCount(icon.ascii(count, { size: 32 })), 4 * inkCount(icon.ascii(count)), `${count}: four pixels of ink for every one`);
  }
  const rows = icon.ascii(7, { size: 32 }).split("\n");
  assert.equal(rows.length, 32);
  assert.ok(rows.every((row) => row.length === 32));
});
