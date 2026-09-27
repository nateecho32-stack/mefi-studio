// `npm ci`'s postinstall step: fetch the Electron binary now.
// Electron 44 stopped downloading it on install; its package fetches the
// binary on the first require('electron') instead. That left a fresh clone
// with no node_modules/electron/dist, so the launcher kept saying "not
// installed yet" right after `npm ci`, and a first `npm start` offline or
// behind a proxy failed mid-launch. Electron's own installer returns at once
// when the binary is already there. An install without devDependencies
// (`npm ci --omit=dev`) has no Electron to fetch, so this skips quietly.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let installer;
try {
  installer = require.resolve("electron/install.js");
} catch {
  process.exit(0);
}
require(installer);
