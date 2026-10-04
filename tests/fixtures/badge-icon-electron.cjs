// Runs under Electron: decodes the PNGs scripts/badge-icon.cjs draws with
// Chromium's own image decoder (nativeImage.createFromBuffer, the call main.cjs
// hands win.setOverlayIcon), and writes what came back to report.json in the
// folder named by MEFI_BADGE_FIXTURE. tests/badge_icon_electron.test.mjs reads it.
const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const badge = require("../../scripts/badge-icon.cjs");

const folder = process.env.MEFI_BADGE_FIXTURE;
app.setPath("userData", path.join(folder, "user-data"));

app.whenReady().then(() => {
  const report = { pictures: [], failure: null };
  try {
    for (const [count, size] of [[1, 16], [7, 16], [42, 16], [99, 16], [3, 32], [99, 32]]) {
      const overlay = badge.overlay(count, { size });
      const picture = badge.render(count, { size });
      const image = nativeImage.createFromBuffer(overlay.png);
      const bitmap = image.toBitmap();
      // Chromium answers BGRA or RGBA by platform: the picture must match in one of the two orders.
      const mismatches = { bgra: 0, rgba: 0 };
      for (let pixel = 0; pixel < size * size; pixel += 1) {
        const at = pixel * 4;
        const alpha = bitmap[at + 3];
        if (alpha !== picture.rgba[at + 3]) { mismatches.bgra += 1; mismatches.rgba += 1; continue; }
        if (alpha !== 255) continue;
        if (bitmap[at] !== picture.rgba[at + 2] || bitmap[at + 1] !== picture.rgba[at + 1] || bitmap[at + 2] !== picture.rgba[at]) mismatches.bgra += 1;
        if (bitmap[at] !== picture.rgba[at] || bitmap[at + 1] !== picture.rgba[at + 1] || bitmap[at + 2] !== picture.rgba[at + 2]) mismatches.rgba += 1;
      }
      report.pictures.push({ count, size, empty: image.isEmpty(), width: image.getSize().width, height: image.getSize().height, mismatches: Math.min(mismatches.bgra, mismatches.rgba), bytes: bitmap.length });
    }
  } catch (error) {
    report.failure = String(error?.stack ?? error).slice(0, 2000);
  }
  fs.writeFileSync(path.join(folder, "report.json"), JSON.stringify(report));
  app.exit(report.failure ? 1 : 0);
});
