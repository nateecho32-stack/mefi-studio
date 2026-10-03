"use strict";
// The blocking side of the Rust host link (scripts/tauri-electron.cjs).
// Electron answered some calls synchronously (safeStorage's key, the
// clipboard, idle state, image work, login items), and main.cjs uses those
// answers on the spot. This worker owns a second pipe connection; the main
// thread posts a call, sleeps in Atomics.wait, and wakes when the reply has
// been put on its port. Never imported by main.cjs directly.
const net = require("node:net");
const { workerData, parentPort } = require("node:worker_threads");
const wire = require("./host-wire.cjs");

const { pipe, token, signal, port } = workerData;
const flag = new Int32Array(signal);
const waiting = new Map();

function settle(id, message) {
  if (!waiting.delete(id)) return;
  port.postMessage({ id, ...message });
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

const socket = net.connect(pipe);
socket.write(wire.frame({ t: "hello", role: "sync", token, pid: process.pid }));
// The reply goes to the main thread as JSON text, decoded there, so bytes
// arrive as a Buffer (a posted Buffer would land as a plain Uint8Array).
socket.on("data", wire.createLineReader((line) => {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return;
  }
  if (frame.t !== "reply" || !waiting.has(frame.id)) return;
  settle(frame.id, frame.ok ? { ok: true, json: JSON.stringify(frame.body ?? null), tagged: frame.tagged === true } : { ok: false, error: String(frame.error ?? "host call failed") });
}));
const fail = (error) => {
  for (const id of [...waiting.keys()]) settle(id, { ok: false, error: `the Rust host is gone (${error?.message ?? "closed"})` });
};
socket.on("error", fail);
socket.on("close", () => fail(null));

parentPort.on("message", ({ id, api, args }) => {
  waiting.set(id, true);
  if (socket.destroyed) return fail(null);
  const { json, tagged } = wire.encode(args ?? []);
  socket.write(wire.frame({ t: "call", id, api, ...(tagged ? { tagged: true } : {}) }, json));
});
