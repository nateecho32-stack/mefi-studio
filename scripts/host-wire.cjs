"use strict";
// The wire between the engine (main.cjs under plain Node) and the Rust host
// (src-tauri). One frame is one line of JSON; see docs/rust-migration.md
// "The wire". Pure: no sockets, files or timers.
//
// Electron's IPC carried structured clones, so a few values that JSON loses
// crossed it intact: bytes (Buffer, Uint8Array, ArrayBuffer), Date,
// NaN/Infinity, and `undefined` inside an array. The last one matters most:
// `invoke(channel, undefined)` must reach a handler written as
// `(_event, { id = null } = {})` as undefined, because null skips the default
// and the destructuring throws. These travel as tagged objects
// ({ $mefi: "bytes", b64 }, { $mefi: "date", iso }, { $mefi: "num", v },
// { $mefi: "undef" }), and a frame that holds any says `tagged: true` so the
// reader only walks the frames that need it. Map and Set never crossed the
// old bridge (docs/rust-migration.md, "Inventory"); they go as JSON sends them.
// renderer side: src-tauri/src/init.js keeps the same rules.

const TAG = "$mefi";

function isBytes(value) {
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}

function bytesTag(value) {
  const view = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  return { [TAG]: "bytes", b64: Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("base64") };
}

// JSON text for one value, and whether it holds a tagged value. The replacer
// reads `this[key]`, the value before toJSON, because Buffer and Date both
// define toJSON and would reach it already flattened.
function encode(value) {
  if (value === undefined) return { json: `{"${TAG}":"undef"}`, tagged: true };
  let tagged = false;
  const json = JSON.stringify(value, function replacer(key, flattened) {
    const raw = this[key];
    if (raw === undefined) {
      if (!Array.isArray(this)) return undefined;
      tagged = true;
      return { [TAG]: "undef" };
    }
    if (typeof raw === "number" && !Number.isFinite(raw)) {
      tagged = true;
      return { [TAG]: "num", v: String(raw) };
    }
    if (raw instanceof Date) {
      tagged = true;
      return { [TAG]: "date", iso: Number.isNaN(raw.getTime()) ? null : raw.toISOString() };
    }
    if (isBytes(raw)) {
      tagged = true;
      return bytesTag(raw);
    }
    return flattened;
  });
  // A bare function or symbol stringifies to nothing; Electron sent it as undefined.
  return json === undefined ? { json: `{"${TAG}":"undef"}`, tagged: true } : { json, tagged };
}

// The reverse, applied only to frames marked tagged. Bytes come back as
// Buffer on the engine's side, the type Electron's IPC handed main.
function revive(value) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = revive(value[i]);
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (typeof value[TAG] === "string") {
    if (value[TAG] === "undef") return undefined;
    if (value[TAG] === "num") return Number(value.v);
    if (value[TAG] === "bytes" && typeof value.b64 === "string") return Buffer.from(value.b64, "base64");
    if (value[TAG] === "date") return new Date(value.iso ?? Number.NaN);
  }
  for (const key of Object.keys(value)) value[key] = revive(value[key]);
  return value;
}

function decode(json, tagged) {
  const value = JSON.parse(json);
  return tagged ? revive(value) : value;
}

// One frame as a line: the head fields as written, then `body` (already JSON
// text) last, so the host can forward a body without parsing it.
function frame(head, body) {
  const fields = JSON.stringify(head);
  if (body === undefined) return `${fields}\n`;
  return `${fields.slice(0, -1)}${fields.length > 2 ? "," : ""}"body":${body}}\n`;
}

// Splits a byte stream into lines. Chunks are kept as Buffers until a newline
// arrives, so a multi-byte character split across chunks is never decoded in
// halves.
function createLineReader(onLine) {
  let pending = [];
  let pendingBytes = 0;
  return (chunk) => {
    let start = 0;
    for (;;) {
      const end = chunk.indexOf(10, start);
      if (end === -1) break;
      const piece = chunk.subarray(start, end);
      const line = pendingBytes ? Buffer.concat([...pending, piece], pendingBytes + piece.length) : piece;
      pending = [];
      pendingBytes = 0;
      if (line.length) onLine(line.toString("utf8"));
      start = end + 1;
    }
    if (start < chunk.length) {
      const rest = chunk.subarray(start);
      pending.push(rest);
      pendingBytes += rest.length;
    }
  };
}

// What a rejected invoke looks like on the page. Electron wrapped a handler's
// error the same way, and some renderer code reads the text after the colon.
function invokeErrorMessage(channel, error) {
  const name = error?.name && error.name !== "Error" ? error.name : "Error";
  return `Error invoking remote method '${channel}': ${name}: ${error?.message ?? String(error)}`;
}

module.exports = { TAG, encode, decode, revive, frame, createLineReader, invokeErrorMessage };
