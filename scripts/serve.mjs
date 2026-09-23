// Mefi's Studio AI+ — dependency-free static server for browser-only use (npm run start:web).
// Loopback only, and only what the booklet needs: data/ holds the live app's
// private tasks, conversations and logs, so everything outside the allow-list
// is refused before the filesystem is touched.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MEFI_STUDIO_PORT || 4173);
const HOST = "127.0.0.1";
const SERVED_DIRS = new Set(["renderer", "assets"]);
// booklet.js refreshes the catalog from ../data/models.json on open; it is the tracked public catalog.
const SERVED_FILES = new Set(["data/models.json"]);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// The file a request path may read, or null when it is outside the allow-list.
function servedPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const segments = decoded.replace(/^\//, "").split("/");
  // No empty, dot or dotfile segments (.., .git, .env), and nothing Windows
  // would read as a separator, a drive or a stream once decoded.
  if (segments.some((segment) => !segment || segment.startsWith(".") || /[\\:\0]/.test(segment))) return null;
  const target = path.resolve(ROOT, ...segments);
  const inside = path.relative(ROOT, target);
  if (!inside || path.isAbsolute(inside) || inside === ".." || inside.startsWith(`..${path.sep}`)) return null;
  const relative = inside.split(path.sep).join("/");
  const allowed = SERVED_FILES.has(relative) || (relative.includes("/") && SERVED_DIRS.has(relative.split("/")[0]));
  return allowed ? target : null;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    const target = servedPath(url.pathname === "/" ? "/renderer/booklet.html" : url.pathname);
    if (!target) {
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
});

server.listen(PORT, HOST, () => {
  const { address, port } = server.address();
  console.log(`Mefi's Studio AI+ (web) — http://${address}:${port}`);
});
