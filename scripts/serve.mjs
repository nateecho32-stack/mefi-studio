// Mefi's Studio AI+ — dependency-free static server for browser-only use (npm run start:web).

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MEFI_STUDIO_PORT || 4173);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${PORT}`);
    const relative = url.pathname === "/" ? "renderer/booklet.html" : url.pathname.replace(/^\/+/, "");
    const target = path.resolve(ROOT, relative);
    if (!target.startsWith(ROOT)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, {
      "content-type": MIME[path.extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
}).listen(PORT, () => {
  console.log(`Mefi's Studio AI+ (web) — http://localhost:${PORT}`);
});
