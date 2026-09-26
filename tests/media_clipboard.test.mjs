import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { createMediaClipboardReader } = createRequire(import.meta.url)("../scripts/media-clipboard.cjs");

test("Media clipboard only exposes bounded web links to the focused Studio main frame", () => {
  let value = "https://youtu.be/dQw4w9WgXcQ", reads = 0, focused = true, destroyed = false;
  const contents = { mainFrame: {} };
  const window = { webContents: contents, isDestroyed: () => destroyed, isFocused: () => focused };
  const read = createMediaClipboardReader(() => window, { readText: () => { reads++; return value; } });
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.deepEqual(read({ sender: {}, senderFrame: contents.mainFrame }), { ok: false });
  assert.deepEqual(read({ sender: contents, senderFrame: {} }), { ok: false });
  focused = false; assert.deepEqual(read(event), { ok: false });
  focused = true; destroyed = true; assert.deepEqual(read(event), { ok: false });
  assert.equal(reads, 0);
  destroyed = false; assert.deepEqual(read(event), { ok: true, url: value });
  for (value of ["private clipboard text", "file:///C:/secret.mp4", "javascript:alert(1)", "https://user:password@example.com/movie.mp4", "https://example.com/a.mp4\nprivate", `https://example.com/${"x".repeat(8192)}`]) assert.deepEqual(read(event), { ok: true, url: "" });
  value = "  https://example.com/movie.mp4  "; assert.equal(read(event).url, value.trim());
});
