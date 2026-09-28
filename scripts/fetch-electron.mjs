// `npm ci`'s postinstall step: fetch the Electron binary now.
// Electron 44 stopped downloading it on install; its package fetches the
// binary on the first require('electron') instead. That left a fresh clone
// with no node_modules/electron/dist, so the launcher kept saying "not
// installed yet" right after `npm ci`, and a first `npm start` offline or
// behind a proxy failed mid-launch. Electron's own installer returns at once
// when the binary is already there. An install without devDependencies
// (`npm ci --omit=dev`) has no Electron to fetch, so this skips quietly.
//
// On a CI runner (CI=true) the binary is left to the workflow. The hosted
// Windows runner is not a desktop like the one the render fixtures measure
// (fonts, scaling, frame timing), so without the binary those suites skip
// there, as they always have, and run on a real desktop instead
// (TESTRUNS.md). The release workflow fetches the binary itself.
import { createRequire } from "node:module";

if (process.env.CI === "true") process.exit(0);
const require = createRequire(import.meta.url);
let installer;
try {
  installer = require.resolve("electron/install.js");
} catch {
  process.exit(0);
}
require(installer);
