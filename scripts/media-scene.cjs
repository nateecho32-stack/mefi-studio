"use strict";

// Compare broad, overlapping regions of the displayed media scene. Only nine
// brightness values, one overall brightness and one motion figure leave the
// host; no screenshot is saved or sent elsewhere.
function sceneScores(bitmap, width, height, coverageW = .72, coverageH = .72) {
  if (!bitmap || width < 3 || height < 3 || bitmap.length < width * height * 4) return null;
  const scores = [];
  const bounded = value => Number.isFinite(value) ? Math.max(.4, Math.min(.96, value)) : .72;
  const w = Math.max(1, Math.floor(width * bounded(coverageW))), h = Math.max(1, Math.floor(height * bounded(coverageH)));
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const x = Math.floor((width - w) * col / 2), y = Math.floor((height - h) * row / 2);
    const values = [];
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
      const at = (py * width + px) * 4;
      values.push((bitmap[at] * .0722 + bitmap[at + 1] * .7152 + bitmap[at + 2] * .2126) / 255);
    }
    // Discard highlights (nodes, labels) and deep outliers. A broad shadow
    // matters more than one dark pixel or a moving bright node.
    values.sort((a, b) => a - b);
    const middle = values.slice(Math.floor(values.length * .2), Math.ceil(values.length * .7));
    scores.push(middle.reduce((sum, value) => sum + value, 0) / middle.length);
  }
  return scores;
}

// Mean brightness of a coarse 48 x 48 grid. Two grids of the same region,
// seconds apart, say whether the picture itself is moving.
const GRID = 48;
function sceneCells(bitmap, width, height) {
  if (!bitmap || width < GRID || height < GRID || bitmap.length < width * height * 4) return null;
  const cells = new Float64Array(GRID * GRID);
  for (let row = 0; row < GRID; row++) for (let col = 0; col < GRID; col++) {
    const x0 = Math.floor(col * width / GRID), x1 = Math.floor((col + 1) * width / GRID);
    const y0 = Math.floor(row * height / GRID), y1 = Math.floor((row + 1) * height / GRID);
    let sum = 0;
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
      const at = (py * width + px) * 4;
      sum += (bitmap[at] * .0722 + bitmap[at + 1] * .7152 + bitmap[at + 2] * .2126) / 255;
    }
    cells[row * GRID + col] = sum / Math.max(1, (x1 - x0) * (y1 - y0));
  }
  return cells;
}
// Ignore the sparsest changes from tree nodes, labels and the pointer, while
// still detecting motion in a video with a largely stationary background.
// Finer cells avoid averaging away moving details within each region.
function sceneMotion(previous, next) {
  if (!previous || !next || previous.length !== next.length) return null;
  const changes = Array.from(next, (value, index) => Math.abs(value - previous[index])).sort((a, b) => a - b);
  return changes[Math.floor(changes.length * .85)];
}
const round = value => Math.round(value * 10000) / 10000;

function createSceneSampler(getWindow, now = Date.now) {
  let last = -Infinity, busy = false, previous = null;
  return async (event, rect) => {
    const window = getWindow();
    if (!window || window.isDestroyed() || !window.isVisible() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false };
    if (busy || now() - last < 4500 || !rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return { ok: false };
    const bounds = window.getContentBounds();
    const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
    const width = Math.min(4096, Math.floor(rect.w), bounds.width - x), height = Math.min(2160, Math.floor(rect.h), bounds.height - y);
    if (width < 160 || height < 160) return { ok: false };
    busy = true; last = now();
    try {
      const image = (await window.webContents.capturePage({ x, y, width, height })).resize({ width: 96, height: 96, quality: "good" });
      const size = image.getSize();
      const bitmap = image.toBitmap();
      const scores = sceneScores(bitmap, size.width, size.height, rect.coverageW, rect.coverageH);
      if (!scores) return { ok: false };
      const cells = sceneCells(bitmap, size.width, size.height);
      const key = `${x},${y},${width},${height}`;
      // Only a recent grid of the same region is a fair baseline.
      const motion = cells && previous?.key === key && last - previous.at <= 20000 ? sceneMotion(previous.cells, cells) : null;
      previous = cells ? { key, cells, at: last } : null;
      const light = cells ? cells.reduce((sum, value) => sum + value, 0) / cells.length : null;
      return { ok: true, scores, ...(Number.isFinite(light) ? { light: round(light) } : {}), ...(Number.isFinite(motion) ? { motion: round(motion) } : {}) };
    } catch { return { ok: false }; }
    finally { busy = false; }
  };
}

module.exports = { sceneScores, sceneCells, sceneMotion, createSceneSampler };
