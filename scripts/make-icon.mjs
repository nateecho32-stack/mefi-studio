// Wraps assets/icon-256.png into a single-entry PNG ICO for Windows shortcuts
// and the Electron window icon. Run: node scripts/make-icon.mjs
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const png = await readFile(path.join(STUDIO, "assets", "icon-256.png"));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
const entry = Buffer.alloc(16);
entry[0] = 0; // width 256
entry[1] = 0; // height 256
entry.writeUInt16LE(1, 4); // palette
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8); // payload size
entry.writeUInt32LE(22, 12); // payload offset
const icoPath = path.join(STUDIO, "assets", "icon.ico");
await writeFile(icoPath, Buffer.concat([header, entry, png]));
console.log(`wrote ${path.relative(STUDIO, icoPath)} (${png.length + 22} bytes)`);
