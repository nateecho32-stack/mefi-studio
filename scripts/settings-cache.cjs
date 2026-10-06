"use strict";
// readSettings' memory (main.cjs, the "Settings cache" block). readSettings
// read and parsed settings.json and auth.json on every call, and the host
// calls it for nearly every model call, dispatch and IPC read. This keeps the
// last merged view and answers from it while both files keep the same
// identity: device, inode, size and modification time in nanoseconds, from
// stat({ bigint: true }). Every caller gets its own structured clone, so an
// edit to one view never reaches another caller or the kept copy.
//
// It reads the files again when:
//   - either stat moved (any writer: this process, a CLI flag run, an editor);
//   - invalidate() ran. main.cjs calls it before and after its own writes, so
//     a write that leaves the stat as it was still cannot serve the old view;
//   - the read said it is not cacheable (settings.json unreadable and the view
//     a fallback, the read that migrates legacy ciphertext, an auth file with
//     content that read as no keys);
//   - a file was modified within `racyMs` of the read (git's "racily clean"
//     rule): FAT keeps modification times to 2 s and exFAT to 10 ms, so a
//     second write of the same size inside that window could keep the stat;
//   - a stat moved while the read ran (a write landed mid-read);
//   - a stat failed with anything but ENOENT. A missing file is a key of its
//     own: a fresh install has no auth.json.
// Concurrent misses on the same stat share one read.
//
// Pure module: no Electron, no filesystem, no network, no clock reads (time
// is injected). The host passes stat, read, clone and now.

const MISSING = "missing";
const RACY_MS = 2000;

/** One file's identity from a stat result; mtimeNs needs stat({ bigint: true }). */
function fileKey(stats) {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs ?? stats.mtimeMs].map(String).join(":");
}

/**
 * createSettingsCache({ files, stat, read, clone, now, racyMs })
 *   files   the paths whose stats key the cache (settings.json, auth.json)
 *   stat    (file) => Promise<Stats>; a rejection with code ENOENT is "missing"
 *   read    () => Promise<{ value, cacheable }>: the uncached merged view
 *   clone   structuredClone by default
 *   now     () => epoch ms; without it the racy guard is off
 * Returns { get, invalidate, hasContent, stats }.
 */
function createSettingsCache({ files = [], stat, read, clone = structuredClone, now = null, racyMs = RACY_MS } = {}) {
  if (typeof stat !== "function" || typeof read !== "function") throw new TypeError("settings cache needs stat and read");
  const paths = [...files];
  let entry = null; // { key, value }: value is never handed out, only clones of it
  let flight = null; // { key, generation, promise }: the read concurrent misses share
  let generation = 0;
  const counts = { hits: 0, misses: 0, joins: 0, stores: 0, invalidations: 0 };

  async function look(file) {
    try {
      const stats = await stat(file);
      return { key: fileKey(stats), mtime: Number(stats.mtimeMs) };
    } catch (error) {
      return error?.code === "ENOENT" ? { key: MISSING, mtime: null } : null;
    }
  }

  // Both files' keys as one, and whether either changed too recently to trust
  // its stat; null when a stat failed, which makes this read uncacheable.
  async function identify() {
    const at = typeof now === "function" ? Number(now()) : null;
    const seen = await Promise.all(paths.map(look));
    if (seen.some((item) => item === null)) return null;
    const racy = at !== null && seen.some((item) => item.mtime !== null && !(at - item.mtime >= racyMs));
    return { key: seen.map((item) => item.key).join("|"), racy };
  }

  async function load(before, startedAt) {
    const result = await read();
    const value = result?.value;
    let snapshot;
    try { snapshot = clone(value); } catch { snapshot = undefined; }
    if (snapshot !== undefined && before && !before.racy && result?.cacheable !== false && generation === startedAt) {
      const after = await identify();
      if (after && after.key === before.key && generation === startedAt) {
        entry = { key: before.key, value: snapshot };
        counts.stores += 1;
      }
    }
    return { value, snapshot };
  }

  async function get() {
    const startedAt = generation;
    const seen = await identify();
    if (seen && entry && entry.key === seen.key) {
      counts.hits += 1;
      return clone(entry.value);
    }
    if (entry && entry.key !== seen?.key) entry = null;
    if (seen && flight && flight.key === seen.key && flight.generation === startedAt) {
      const shared = flight.promise;
      try {
        const { snapshot } = await shared;
        if (snapshot !== undefined) {
          counts.joins += 1;
          return clone(snapshot);
        }
      } catch { /* the shared read failed; this caller reads for itself */ }
    }
    counts.misses += 1;
    const own = { key: seen?.key ?? null, generation: startedAt, promise: load(seen, startedAt) };
    if (seen) flight = own;
    try {
      return (await own.promise).value;
    } finally {
      if (flight === own) flight = null;
    }
  }

  // Forget the kept view and any read in flight: the next get() reads.
  function invalidate() {
    generation += 1;
    entry = null;
    flight = null;
    counts.invalidations += 1;
  }

  // Whether a file holds more than an empty object ("{}" is 2 bytes): an auth
  // file that does, yet read as no keys, was a failed read. A missing file
  // holds nothing; a file that cannot be stat'ed counts as holding something.
  async function hasContent(file) {
    try {
      return Number((await stat(file)).size) > 2;
    } catch (error) {
      return error?.code !== "ENOENT";
    }
  }

  return { get, invalidate, hasContent, stats: () => ({ ...counts, cached: entry !== null }) };
}

module.exports = { createSettingsCache, fileKey, MISSING, RACY_MS };
