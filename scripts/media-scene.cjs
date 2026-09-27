"use strict";

// Compare broad, overlapping regions of the displayed media scene. Only nine
// brightness values leave the host; no screenshot is saved or sent elsewhere.
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

function createSceneSampler(getWindow, now = Date.now) {
  let last = -Infinity, busy = false;
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
      const scores = sceneScores(image.toBitmap(), size.width, size.height, rect.coverageW, rect.coverageH);
      return scores ? { ok: true, scores } : { ok: false };
    } catch { return { ok: false }; }
    finally { busy = false; }
  };
}

module.exports = { sceneScores, createSceneSampler };
