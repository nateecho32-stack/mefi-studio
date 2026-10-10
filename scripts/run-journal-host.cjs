// The run journal's files (docs/plans/scratch-tier.md, WP0-B): the journal a
// builder writes its output to, the tail the engine reads it back through,
// and the small JSON files beside it (the desk server's saved port and token).
// The rules are in scripts/run-journal.cjs; main.cjs "Run journal" wires this
// into spawnNextJob, the boot pass and the updater. The filesystem is
// injected (`fs`, a promises API) so the suites run it against a fake.
//
// A tail is what wire() in main.cjs reads instead of a pipe: it has
// setEncoding (a no-op), emits "data" with text and "end" once stopped, reads
// only the bytes past its offset (never the whole file again), keeps a
// multi-byte character split across reads whole, polls every `pollMs` and
// wakes early on fs.watch when the platform gives it. `drain()` reads what
// is there right now, for the moment the process has exited; `offset` is
// how far it has read, which the checkpoint records so the next engine
// resumes from there.

"use strict";

const path = require("node:path");
const { EventEmitter } = require("node:events");
const { StringDecoder } = require("node:string_decoder");
const journal = require("./run-journal.cjs");

const READ_CHUNK = 64 * 1024;
const POLL_MS = 500;
// A boot scan reads at most this much of a journal past its checkpoint.
const SCAN_MAX = 2 * 1024 * 1024;
// The executor log's tail read for a run's finish record.
const LOG_TAIL_MAX = 256 * 1024;

function createRunJournalHost({ fs = require("node:fs/promises"), watch = null, log = () => {} } = {}) {
  // The journal file for one run, opened for appending. The handle is the
  // builder's stdout and stderr (spawn's stdio takes its fd); the engine keeps
  // it open until the run ends so a fallback child appends to the same file.
  async function open({ dir, runId }) {
    const file = path.join(dir, journal.journalName(runId));
    await fs.mkdir(dir, { recursive: true });
    const handle = await fs.open(file, "a");
    return { path: file, fd: handle.fd, close: () => handle.close().catch(() => {}) };
  }

  function tail({ path: file, offset = 0, pollMs = POLL_MS } = {}) {
    const stream = new EventEmitter();
    const decoder = new StringDecoder("utf8");
    let at = Math.max(0, Number(offset) || 0);
    let handle = null;
    let timer = null;
    let watcher = null;
    let reading = null;
    let stopped = false;
    let ended = false;
    const read = async () => {
      if (stopped && ended) return;
      if (!handle) {
        try { handle = await fs.open(file, "r"); }
        catch { return; } // not there yet: the next poll looks again
      }
      let size = 0;
      try { size = (await handle.stat()).size; } catch { return; }
      if (size <= at) return;
      const buffer = Buffer.allocUnsafe(READ_CHUNK);
      while (at < size) {
        const want = Math.min(READ_CHUNK, size - at);
        let got = 0;
        try { got = (await handle.read(buffer, 0, want, at)).bytesRead; } catch { return; }
        if (!got) return;
        at += got;
        const text = decoder.write(buffer.subarray(0, got));
        if (text) stream.emit("data", text);
      }
    };
    const poll = () => {
      if (reading) return reading;
      reading = read().catch(() => {}).finally(() => { reading = null; });
      return reading;
    };
    const end = () => {
      if (ended) return;
      ended = true;
      const last = decoder.end();
      if (last) stream.emit("data", last);
      stream.emit("end");
    };
    stream.setEncoding = () => stream;
    stream.start = () => {
      if (timer || stopped) return stream;
      timer = setInterval(poll, Math.max(50, Number(pollMs) || POLL_MS));
      timer.unref?.();
      if (typeof watch === "function") {
        try { watcher = watch(file, () => { poll(); }); } catch { watcher = null; }
      }
      poll();
      return stream;
    };
    // What is there now, read to the end, then nothing more: the process has
    // exited. Bounded so a journal nobody can read never holds the settle.
    stream.drain = async ({ maxMs = 3000 } = {}) => {
      const waited = new Promise((resolve) => { const t = setTimeout(resolve, maxMs); t.unref?.(); });
      await Promise.race([poll().then(() => poll()), waited]);
      return stream.stop();
    };
    stream.stop = async () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      try { watcher?.close?.(); } catch {}
      watcher = null;
      if (reading) await reading;
      end();
      if (handle) { const h = handle; handle = null; await h.close().catch(() => {}); }
    };
    Object.defineProperty(stream, "offset", { get: () => at });
    return stream;
  }

  // The bytes of a journal past `offset`, bounded: the last `maxBytes` of
  // them when there are more, with `truncated` set so a reader knows the
  // start of the slice may be mid-line.
  async function readFrom(file, { offset = 0, maxBytes = SCAN_MAX } = {}) {
    let handle = null;
    try {
      handle = await fs.open(file, "r");
      const size = (await handle.stat()).size;
      let from = Math.max(0, Number(offset) || 0);
      if (size <= from) return { text: "", size, truncated: false };
      const truncated = size - from > maxBytes;
      if (truncated) from = size - maxBytes;
      const buffer = Buffer.allocUnsafe(size - from);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
      return { text: buffer.subarray(0, bytesRead).toString("utf8"), size, truncated };
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  // The last records of a JSON-lines file (the executor log), newest last; a
  // line that does not parse is skipped.
  async function readJsonlTail(file, { maxBytes = LOG_TAIL_MAX } = {}) {
    let slice;
    try { slice = await readFrom(file, { offset: 0, maxBytes }); }
    catch { return []; }
    const lines = slice.text.split("\n");
    if (slice.truncated) lines.shift();
    const out = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch {}
    }
    return out;
  }

  async function readJson(file) {
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch { return null; }
  }

  // Temp file plus rename, so a reader never sees a torn file.
  async function writeJsonAtomic(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value), "utf8");
    try { await fs.rename(temp, file); }
    catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
  }

  return { open, tail, readFrom, readJsonlTail, readJson, writeJsonAtomic, log };
}

module.exports = { createRunJournalHost, READ_CHUNK, POLL_MS, SCAN_MAX, LOG_TAIL_MAX };
