// Mefi's Studio AI+ — the log core: Studio's log kept on disk, whole.
//
// Until 0.4.5 the studio log was a 5,000-line ring in memory (trace.cjs),
// which five builders filled in about 80 seconds, and nothing reached the
// disk. The log core keeps what the host logs as structured records, one
// JSON line each:
//
//   {t, lvl, ch, src, msg, run?, task?, data?}
//   t     ms since the epoch            lvl   error | warn | info | debug
//   ch    the channel: "studio", "assistant", "renderer"
//   src   the line's tag or its caller  msg   the line itself
//   run, task  the run and task it belongs to, when known
//   data  a small JSON value (8 KB at most)
//
// Credentials are masked before anything is written (redaction.cjs
// maskCredentials, and any string under a key that names a secret). Records
// under the level threshold (info by default) are not kept.
//
// Appends are batched: one async append every 250 ms, or at once past
// 256 KB, into segment-archive.cjs, which seals 4 MB, monthly and weekly
// segments into monthly gzip archives and never deletes one. flushSync()
// writes what is still pending before the process exits. readPage() reads
// newest first across the active segment and the archives, filtered by
// level, channel, source, run, task and text, with a cursor for the next
// page.
//
// Nothing here throws into a caller. log() never fails; a failed write keeps
// its batch (bounded) and tries again with a backoff, and troubles reach
// onError at most once a minute each. A folder that cannot be opened (made,
// locked by another Studio) switches the core off and says so once.

"use strict";

const { createSegmentArchive } = require("./segment-archive.cjs");
const { maskCredentials } = require("./redaction.cjs");

const LEVELS = Object.freeze(["error", "warn", "info", "debug"]);
const RANK = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });
const LIMITS = Object.freeze({
  flushMs: 250,
  flushBytes: 256 * 1024,
  msg: 8000,
  data: 8192,
  id: 120,
  channel: 40,
  source: 60,
  pendingRecords: 100000,
  pendingBytes: 32 * 1024 * 1024,
  reportMs: 60000,
  retryMs: Object.freeze([250, 1000, 5000, 15000, 60000]),
  page: 2000,
  depth: 6,
  entries: 200,
});
const SECRET_KEY = /pass(word)?|secret|token|api[_-]?key|authori[sz]ation|cookie|credential/i;

/** error | warn | info | debug from a level word; anything else is `fallback`. */
function levelOf(value, fallback = "info") {
  const word = String(value ?? "").trim().toLowerCase();
  if (word === "error" || word === "err" || word === "fatal") return "error";
  if (word === "warn" || word === "warning") return "warn";
  if (word === "debug" || word === "trace" || word === "verbose") return "debug";
  if (word === "info") return "info";
  return fallback;
}

function clipText(value, max) {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  const cut = code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
  return `${text.slice(0, cut)}… (${text.length - cut} more characters)`;
}
const token = (value, fallback, max) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return text || fallback;
};

/** A caller's record in the kept shape (nothing masked yet). */
function normalize(input, now) {
  const source = input && typeof input === "object" ? input : { msg: input };
  const time = Number(source.t);
  const record = {
    t: Number.isFinite(time) && time > 0 ? time : now,
    lvl: levelOf(source.lvl),
    ch: token(source.ch, "studio", LIMITS.channel),
    src: "",
    msg: clipText(source.msg ?? "", LIMITS.msg),
  };
  record.src = token(source.src, record.ch, LIMITS.source);
  if (source.run !== undefined && source.run !== null && source.run !== "") record.run = clipText(source.run, LIMITS.id);
  if (source.task !== undefined && source.task !== null && source.task !== "") record.task = clipText(source.task, LIMITS.id);
  if (source.data !== undefined && source.data !== null) record.data = source.data;
  return record;
}

function maskData(value, mask, depth = 0) {
  if (typeof value === "string") return mask(value);
  if (!value || typeof value !== "object") return value;
  if (depth >= LIMITS.depth) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, LIMITS.entries).map((item) => maskData(item, mask, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, LIMITS.entries)) {
    out[key] = typeof item === "string" && SECRET_KEY.test(key) ? "[redacted]" : maskData(item, mask, depth + 1);
  }
  return out;
}

/** The record as written: masked, with `data` kept only while it stays small. */
function prepare(record, mask) {
  const out = { ...record, msg: mask(record.msg) };
  if (record.data !== undefined) {
    let text = null;
    try {
      out.data = maskData(record.data, mask);
      text = JSON.stringify(out.data);
    } catch {
      text = null;
    }
    if (typeof text !== "string") out.data = { unreadable: true };
    else if (text.length > LIMITS.data) out.data = { clipped: true, bytes: text.length };
  }
  return out;
}

// A filter as a record test, plus a raw-line test that skips lines which
// cannot match before they are parsed. Records are written with a fixed key
// order and no spaces, so `"ch":"studio"` appears exactly as written.
function compileFilter(filter = {}) {
  const set = (value) => {
    if (value === undefined || value === null || value === "") return null;
    return new Set((Array.isArray(value) ? value : [value]).map((item) => String(item)));
  };
  const lvl = set(filter.lvl), ch = set(filter.ch), src = set(filter.src), run = set(filter.run), task = set(filter.task);
  const needle = String(filter.text ?? "").trim().toLowerCase().slice(0, 200);
  const plain = (text) => !/["\\\u0000-\u001f]/.test(text);
  const fields = [["lvl", lvl], ["ch", ch], ["src", src], ["run", run], ["task", task]].filter(([, values]) => values);
  const words = needle.split(/\s+/).filter(Boolean);
  const match = (record) => (!lvl || lvl.has(record.lvl))
    && (!ch || ch.has(record.ch))
    && (!src || src.has(record.src))
    && (!run || run.has(record.run))
    && (!task || task.has(record.task))
    && (!needle || `${record.src ?? ""} ${record.msg ?? ""}`.toLowerCase().includes(needle));
  const prefilter = (line) => {
    for (const [key, values] of fields) {
      if (!values.size) return false;
      if ([...values].every(plain) && ![...values].some((value) => line.includes(`"${key}":"${value}"`))) return false;
    }
    if (words.length && words.every(plain)) {
      const lower = line.toLowerCase();
      if (!words.every((word) => lower.includes(word))) return false;
    }
    return true;
  };
  return { match, prefilter };
}

/**
 * The log core. Options: dir (active segments), archiveDir, clock, level
 * (threshold), mask (text -> text), kind (default "log"), onError(error,
 * where), and the archive's own options under `archive` (tests).
 */
function createLogCore(options = {}) {
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  const mask = typeof options.mask === "function" ? options.mask : maskCredentials;
  const flushMs = Number.isFinite(options.flushMs) && options.flushMs >= 0 ? options.flushMs : LIMITS.flushMs;
  const flushBytes = Number.isFinite(options.flushBytes) && options.flushBytes > 0 ? options.flushBytes : LIMITS.flushBytes;
  const onError = typeof options.onError === "function" ? options.onError : null;
  const reported = new Map();
  let threshold = RANK[levelOf(options.level)];
  let pending = [];
  let pendingBytes = 0;
  let dropped = 0;
  let failures = 0;
  let timer = null;
  let writing = Promise.resolve();
  let off = null; // null while on; the reason once off
  let closed = false;

  function report(error, where) {
    if (!onError) return;
    const last = reported.get(where) ?? -Infinity;
    const now = clock();
    if (where !== "open" && now - last < LIMITS.reportMs) return;
    reported.set(where, now);
    try {
      onError(error instanceof Error ? error : new Error(String(error)), where);
    } catch { /* a reporter never breaks the core */ }
  }

  const archive = createSegmentArchive({
    ...(options.archive ?? {}),
    dir: options.dir,
    archiveDir: options.archiveDir,
    kind: options.kind ?? "log",
    clock,
    // An open failure is reported once, below, as the core's own.
    onError: (error, where) => { if (where !== "open") report(error, where); },
  });
  const opened = archive.open().then(() => true, (error) => {
    stop(error?.message ?? String(error));
    report(error, "open");
    return false;
  });

  function stop(reason) {
    off = reason || "off";
    pending = [];
    pendingBytes = 0;
    clearTimeout(timer);
    timer = null;
  }
  function schedule(ms) {
    if (timer || off) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, ms);
    timer.unref?.();
  }
  // Bounded: past the cap the oldest waiting records go, and the next batch
  // says how many.
  function bound() {
    while (pending.length > LIMITS.pendingRecords || pendingBytes > LIMITS.pendingBytes) {
      const gone = pending.shift();
      if (!gone) break;
      pendingBytes -= gone.msg.length + 96;
      dropped += 1;
    }
  }

  /** Keep one record. Returns false when it was not kept (off, or under the threshold). */
  function log(input) {
    try {
      if (off) return false;
      const record = normalize(input, clock());
      if (RANK[record.lvl] > threshold) return false;
      pending.push(record);
      pendingBytes += record.msg.length + 96;
      bound();
      if (pendingBytes >= flushBytes) void flush();
      else schedule(flushMs);
      return true;
    } catch {
      return false;
    }
  }

  function batchOf(records) {
    const out = [];
    if (dropped) {
      out.push(prepare(normalize({ lvl: "warn", ch: "studio", src: "logs", msg: `[logs] ${dropped} line${dropped === 1 ? "" : "s"} could not be kept on disk` }, clock()), mask));
      dropped = 0;
    }
    for (const record of records) {
      try {
        out.push(prepare(record, mask));
      } catch { /* one bad record never holds up the rest */ }
    }
    return out;
  }

  /** Write what is waiting. Resolves once it is on disk (or kept for a retry). */
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (off || !pending.length) return writing;
    const batch = pending;
    pending = [];
    pendingBytes = 0;
    writing = writing.then(async () => {
      if (!(await opened) || off) return;
      try {
        await archive.append(batchOf(batch));
        failures = 0;
      } catch (error) {
        if (off) return;
        // Kept for the next try, ahead of anything logged since.
        pending = batch.concat(pending);
        pendingBytes = pending.reduce((sum, record) => sum + record.msg.length + 96, 0);
        bound();
        failures += 1;
        report(error, "append");
        schedule(LIMITS.retryMs[Math.min(failures, LIMITS.retryMs.length) - 1]);
      }
    });
    return writing;
  }

  /** The exit path: write everything still waiting, synchronously. Returns the count written. */
  function flushSync() {
    clearTimeout(timer);
    timer = null;
    if (off || !pending.length) return 0;
    const batch = pending;
    pending = [];
    pendingBytes = 0;
    try {
      return archive.appendSync(batchOf(batch));
    } catch (error) {
      report(error, "flushSync");
      return 0;
    }
  }

  /**
   * Records newest first: { rows, next, done }. `before` is a time in ms or
   * the `next` of the previous page; `filter` takes lvl, ch, src, run, task
   * (a value or a list of values) and text (in the source or the line).
   */
  async function readPage({ before = null, limit = 250, filter = {}, budget } = {}) {
    await flush();
    await writing;
    const { match, prefilter } = compileFilter(filter ?? {});
    return archive.readBackward({ before, limit: Math.max(1, Math.min(LIMITS.page, Math.floor(Number(limit) || 250))), budget, match, prefilter });
  }

  /** Stop keeping records (a settings switch); what is waiting is dropped. */
  function disable(reason = "switched off") {
    if (!off) stop(reason);
  }
  /** Keep records again after disable(); a core whose folder failed, or a closed one, stays off. */
  function enable() {
    if (off && !closed && !archive.status().failed) off = null;
  }

  async function close() {
    await flush();
    await writing;
    closed = true;
    stop("closed");
    await archive.close();
  }
  /** flushSync, then let go of the folder's lock: the last call before exit. */
  function closeSync() {
    const written = flushSync();
    closed = true;
    stop("closed");
    archive.closeSync();
    return written;
  }

  return {
    log,
    flush,
    flushSync,
    readPage,
    setLevel: (level) => { threshold = RANK[levelOf(level)]; },
    disable,
    enable,
    close,
    closeSync,
    opened: () => opened,
    dir: archive.dir,
    archiveDir: archive.archiveDir,
    status: () => ({ on: !off, reason: off, pending: pending.length, dropped, failures, level: LEVELS[threshold], archive: archive.status() }),
  };
}

module.exports = { LEVELS, LIMITS, levelOf, normalize, prepare, compileFilter, createLogCore };
