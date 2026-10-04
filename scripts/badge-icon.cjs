// Mefi's Studio AI+ — the small numbered icon Windows lays over Studio's
// taskbar button (win.setOverlayIcon): a red disc with the count of what waits
// on the owner.
//
// Electron has no canvas in the main process and this app adds no dependency,
// so the disc and its digits are drawn here, straight into an RGBA buffer, and
// encoded as a PNG that nativeImage.createFromBuffer reads on every platform
// (a raw bitmap is BGRA on some and RGBA on others). The digits are a 5 by 7
// pixel font: at 16 px each font pixel is one pixel, at 32 px (a display scaled
// to 150% or more) two by two, so the count stays crisp at both. The edge of
// the disc is anti-aliased by sampling; the digits are flat white. One or two
// digits fit, so a count past 99 reads 99. Nothing is drawn for 0.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const zlib = require("node:zlib");
const { crc32 } = require("./zip-lite.cjs");

const MAX = 99;
const RED = Object.freeze([209, 52, 56]);
const WHITE = Object.freeze([255, 255, 255]);
const SAMPLES = 4;

// 5 by 7, one string per row, "#" is ink.
const FONT = Object.freeze({
  0: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  2: [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  3: ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  6: ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  7: ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  9: [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
});
const GLYPH_W = 5, GLYPH_H = 7, GAP = 1;

/** The number as drawn: a whole number from 1 to 99, or 0 for nothing. */
const shown = (count) => (Number.isFinite(Number(count)) && Number(count) >= 1 ? Math.min(MAX, Math.floor(Number(count))) : 0);

/**
 * The picture for `count`: { width, height, rgba } (premultiplied alpha is not
 * used: straight RGBA), or null when there is nothing to show. `size` is 16 or
 * 32 (anything else is 16).
 */
function render(count, { size = 16 } = {}) {
  const n = shown(count);
  if (!n) return null;
  const px = size === 32 ? 32 : 16;
  const scale = px / 16;
  const text = String(n);
  const rgba = Buffer.alloc(px * px * 4);
  // The ink, as a set of pixels.
  const width = text.length * GLYPH_W + (text.length - 1) * GAP;
  const left = Math.floor((px - width * scale) / 2);
  const top = Math.floor((px - GLYPH_H * scale) / 2);
  const ink = new Set();
  [...text].forEach((digit, index) => {
    const rows = FONT[digit];
    const x0 = left + index * (GLYPH_W + GAP) * scale;
    for (let y = 0; y < GLYPH_H; y += 1) for (let x = 0; x < GLYPH_W; x += 1) {
      if (rows[y][x] !== "#") continue;
      for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) ink.add((top + y * scale + dy) * px + x0 + x * scale + dx);
    }
  });
  const centre = px / 2, radius = px / 2 - 0.25;
  for (let y = 0; y < px; y += 1) for (let x = 0; x < px; x += 1) {
    // How much of this pixel the disc covers, by sampling a small grid in it.
    let covered = 0;
    for (let sy = 0; sy < SAMPLES; sy += 1) for (let sx = 0; sx < SAMPLES; sx += 1) {
      const dx = x + (sx + 0.5) / SAMPLES - centre, dy = y + (sy + 0.5) / SAMPLES - centre;
      if (dx * dx + dy * dy <= radius * radius) covered += 1;
    }
    const alpha = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
    if (!alpha) continue;
    const colour = ink.has(y * px + x) ? WHITE : RED;
    const at = (y * px + x) * 4;
    rgba[at] = colour[0]; rgba[at + 1] = colour[1]; rgba[at + 2] = colour[2]; rgba[at + 3] = alpha;
  }
  return { width: px, height: px, rgba };
}

// ---- PNG -------------------------------------------------------------------------------------------

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4, 8), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** A PNG (8-bit RGBA, no interlace) of a picture from render(). */
function png({ width, height, rgba }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); // filter byte 0 (None) stays
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * What win.setOverlayIcon needs for `count`: { count, png, description, size },
 * or null when there is nothing to show (the overlay is then cleared).
 */
function overlay(count, { size = 16 } = {}) {
  const picture = render(count, { size });
  if (!picture) return null;
  const n = shown(count);
  return { count: n, png: png(picture), description: `${n} waiting on you`, size: picture.width };
}

/** The picture as text, one row per line: "#" ink, "o" disc, "." clear. For tests and for looking at it. */
function ascii(count, { size = 16 } = {}) {
  const picture = render(count, { size });
  if (!picture) return "";
  const rows = [];
  for (let y = 0; y < picture.height; y += 1) {
    let row = "";
    for (let x = 0; x < picture.width; x += 1) {
      const at = (y * picture.width + x) * 4;
      row += picture.rgba[at + 3] < 128 ? "." : picture.rgba[at + 1] > 200 ? "#" : "o";
    }
    rows.push(row);
  }
  return rows.join("\n");
}

module.exports = { MAX, FONT, shown, render, png, overlay, ascii };
