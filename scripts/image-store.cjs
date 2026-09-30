// Where a message's pictures live: one folder of files under the project's own
// data folder (data/projects/<id>/attachments), never in the repository and never
// part of a problem report. A picture is saved when it is attached, before the
// message is sent, and is named by an opaque id (`img_` and 24 hex digits): a
// message carries ids, never paths, and this module is the only thing that turns
// an id into a file.
//
// Each picture is two files, written atomically (a temporary file, then a
// rename): `<id>.<ext>` with the bytes, and `<id>.json` with its name, type and
// size, which is what makes the picture real: a picture without its record is
// not one, and a record whose bytes no longer say what it says is refused. A
// picture nobody sent is a leftover: prune removes it after a day, keeps every
// picture a message or a task still names, and holds the folder to a bounded
// count and size.
//
// The host gives this the folder (a function, because a project switch moves it)
// and, optionally, a way to make a small preview. What may be saved and how it is
// checked is scripts/image-attach.cjs.

"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const images = require("./image-attach.cjs");

const HOUR_MS = 3600000;
const ORPHAN_MS = 24 * HOUR_MS;
const MAX_STORED = 300;
const MAX_FOLDER_BYTES = 300 * 1024 * 1024;
// A preview is a bounded data URL: small enough to ride the answer and sit in a list.
const THUMB_MAX_CHARS = 30000;
const THUMB_ORIGINAL_MAX_BYTES = 12000;
const META = /^(img_[a-f0-9]{24})\.json$/;

function createImageStore({ dir, keep = null, fs = fsp, thumbnail = null, now = Date.now, randomId = () => crypto.randomBytes(12).toString("hex") } = {}) {
  if (typeof dir !== "function") throw new TypeError("createImageStore needs a folder function");
  let lastPrune = 0;

  const folder = () => path.resolve(String(dir()));
  const fileOf = (id, ext) => path.join(folder(), `${id}.${ext}`);
  const metaOf = (id) => path.join(folder(), `${id}.json`);

  // Atomic: the whole file appears at once or not at all.
  async function write(target, body, mode = 0o600) {
    const temporary = `${target}.tmp-${process.pid}-${randomId().slice(0, 8)}`;
    try {
      await fs.writeFile(temporary, body, { mode });
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function readMeta(id) {
    if (!images.isId(id)) return null;
    let meta;
    try { meta = JSON.parse(await fs.readFile(metaOf(id), "utf8")); } catch { return null; }
    if (!meta || meta.id !== id || !images.TYPES[meta.mime] || images.TYPES[meta.mime] !== meta.ext) return null;
    return meta;
  }

  async function preview(bytes, mime) {
    try {
      const made = typeof thumbnail === "function" ? await thumbnail(bytes, mime) : null;
      if (typeof made === "string" && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(made) && made.length <= THUMB_MAX_CHARS) return made;
    } catch { /* a preview is a courtesy */ }
    // No preview could be made: a tiny original is its own preview, anything else has none.
    return bytes.length <= THUMB_ORIGINAL_MAX_BYTES ? `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` : null;
  }

  /** Save one picture: { ok, id, name, mime, bytes, width, height, thumb } or { ok: false, error }. */
  async function save({ name, mime, data } = {}) {
    const decoded = images.decode(data);
    if (!decoded.ok) return decoded;
    const verdict = images.inspect({ name, mime, bytes: decoded.bytes });
    if (!verdict.ok) return verdict;
    try {
      await fs.mkdir(folder(), { recursive: true, mode: 0o700 });
      // Tidied at most once an hour, and only when the host can say which pictures are still named.
      if (typeof keep === "function" && now() - lastPrune > HOUR_MS) await prune().catch(() => {});
      const stored = (await fs.readdir(folder()).catch(() => [])).filter((entry) => META.test(entry)).length;
      if (stored >= MAX_STORED) return { ok: false, error: "Too many pictures are saved. Send or remove some, and Studio clears the ones nobody sent after a day." };
      const id = `img_${randomId()}`;
      if (!images.isId(id)) throw new Error("the picture id was not usable");
      const meta = { id, name: verdict.name, mime: verdict.mime, ext: verdict.ext, bytes: verdict.bytes, width: verdict.width, height: verdict.height, at: now() };
      await write(fileOf(id, verdict.ext), decoded.bytes);
      try { await write(metaOf(id), JSON.stringify(meta)); } catch (error) { await fs.rm(fileOf(id, verdict.ext), { force: true }).catch(() => {}); throw error; }
      return { ok: true, id, name: meta.name, mime: meta.mime, bytes: meta.bytes, width: meta.width, height: meta.height, thumb: await preview(decoded.bytes, verdict.mime) };
    } catch (error) {
      return { ok: false, error: `The picture could not be saved: ${String(error?.message ?? error).slice(0, 120)}` };
    }
  }

  /**
   * The pictures a message names, as { id, name, mime, bytes, path } (no contents).
   * Each is checked to be a real file of the type its record says, so a record
   * cannot point at something else. { ok: false, error } if any one is gone.
   */
  async function resolve(value) {
    const checked = images.checkIds(value);
    if (!checked.ok) return checked;
    const found = [];
    for (const id of checked.ids) {
      const meta = await readMeta(id);
      const file = meta ? fileOf(id, meta.ext) : null;
      let info = null;
      try { info = file ? await fs.lstat(file) : null; } catch { info = null; }
      if (!meta || !info?.isFile() || info.size !== meta.bytes) return { ok: false, error: `${meta?.name ? `"${meta.name}" is` : "A picture is"} no longer saved. Attach it again.` };
      found.push({ id, name: meta.name, mime: meta.mime, bytes: meta.bytes, path: file });
    }
    return { ok: true, images: found };
  }

  /** One picture's contents as base64 for a request, after checking its bytes still say what its record says. */
  async function load(entry) {
    const bytes = await fs.readFile(entry.path);
    if (images.sniff(bytes) !== entry.mime) throw new Error(`"${entry.name}" is not the picture that was saved`);
    return { ...entry, base64: bytes.toString("base64") };
  }

  /** Take one picture away, its record last. Never fails for one that is already gone. */
  async function remove(id) {
    if (!images.isId(id)) return { ok: false, error: "That is not a picture Studio saved." };
    const meta = await readMeta(id);
    // A record nobody can read does not say which extension the bytes have: try each.
    for (const ext of meta ? [meta.ext] : Object.values(images.TYPES)) await fs.rm(fileOf(id, ext), { force: true }).catch(() => {});
    await fs.rm(metaOf(id), { force: true }).catch(() => {});
    return { ok: true };
  }

  /**
   * Clean the folder. `keep` (or the host's keep function) is every id a message
   * or a task still names: those stay. The rest goes when it is a day old (a
   * picture nobody sent), then oldest first while the folder holds more than 300
   * pictures or 300 MB. Records nobody can read, bytes with no record and leftover
   * temporary files go once they are a day old.
   */
  async function prune(options = {}) {
    lastPrune = now();
    const named = options.keep instanceof Set ? options.keep : typeof keep === "function" ? new Set(await keep()) : new Set();
    const names = await fs.readdir(folder()).catch(() => []);
    const rows = [];
    const recorded = new Set();
    for (const entry of names) {
      const match = META.exec(entry);
      if (!match) continue;
      recorded.add(match[1]);
      const meta = await readMeta(match[1]);
      rows.push({ id: match[1], meta, at: Number(meta?.at) || (await fs.stat(metaOf(match[1])).catch(() => null))?.mtimeMs || 0 });
    }
    let removed = 0;
    const drop = async (row) => { await remove(row.id); removed += 1; };
    // Bytes with no record and temporary files: what a save that never finished leaves behind.
    for (const entry of names) {
      const bare = /^(img_[a-f0-9]{24})\.(?:png|jpg|webp|gif)$/.exec(entry);
      if (!(bare && !recorded.has(bare[1])) && !/\.tmp-/.test(entry)) continue;
      const info = await fs.stat(path.join(folder(), entry)).catch(() => null);
      if (info && now() - info.mtimeMs > ORPHAN_MS) { await fs.rm(path.join(folder(), entry), { force: true }).catch(() => {}); removed += 1; }
    }
    const living = [];
    let held = 0, size = 0;
    for (const row of rows) {
      const old = now() - row.at > ORPHAN_MS;
      if (!row.meta) { if (old) await drop(row); continue; }
      if (named.has(row.id)) { held += 1; size += row.meta.bytes; continue; }
      if (old) { await drop(row); continue; }
      living.push(row);
      size += row.meta.bytes;
    }
    living.sort((a, b) => a.at - b.at);
    while (living.length && (living.length + held > MAX_STORED || size > MAX_FOLDER_BYTES)) {
      const oldest = living.shift();
      await drop(oldest);
      size -= oldest.meta.bytes;
    }
    return { ok: true, removed, kept: living.length + held };
  }

  return { save, resolve, load, remove, prune, folder };
}

module.exports = { createImageStore, THUMB_MAX_CHARS, MAX_STORED, MAX_FOLDER_BYTES, ORPHAN_MS };
