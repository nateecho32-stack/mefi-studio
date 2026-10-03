// The Rust host's bridge (docs/rust-migration.md, stage 1), both halves,
// without Rust: the engine's Electron shim (scripts/tauri-electron.cjs) runs
// in a real Node child against a fake host on a real pipe, and the page's
// half (src-tauri/src/init.js with the real preload.cjs spliced in) runs in a
// vm against a fake window.__TAURI__.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = (await import("node:module")).createRequire(import.meta.url);
const wire = require("../scripts/host-wire.cjs");

test("host-wire keeps what Electron's structured clone kept", () => {
  const { json, tagged } = wire.encode([undefined, 2, { at: new Date("2026-10-03T00:00:00.000Z"), bytes: Buffer.from("hi"), gone: undefined }, Number.NaN]);
  assert.equal(tagged, true);
  const back = wire.decode(json, true);
  assert.equal(back.length, 4);
  assert.equal(back[0], undefined);
  assert.equal(back[1], 2);
  assert.ok(back[2].at instanceof Date && back[2].at.toISOString() === "2026-10-03T00:00:00.000Z");
  assert.ok(Buffer.isBuffer(back[2].bytes) && back[2].bytes.toString() === "hi");
  assert.equal("gone" in back[2], false, "an undefined property is left out, as JSON does");
  assert.ok(Number.isNaN(back[3]));
  assert.deepEqual(wire.encode({ plain: [1, "two"] }), { json: '{"plain":[1,"two"]}', tagged: false });
  assert.deepEqual(wire.encode(undefined), { json: '{"$mefi":"undef"}', tagged: true });
  assert.equal(wire.frame({ t: "push", ch: "x" }, "[1]"), '{"t":"push","ch":"x","body":[1]}\n');
});

test("host-wire's line reader joins split chunks and multi-byte characters", () => {
  const lines = [];
  const read = wire.createLineReader((line) => lines.push(line));
  const text = Buffer.from('{"a":"é"}\n{"b":2}\n{"c"');
  read(text.subarray(0, 7)); // splits the two bytes of é
  read(text.subarray(7));
  read(Buffer.from(":3}\n"));
  assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ a: "é" }, { b: 2 }, { c: 3 }]);
});

// ---- the engine's half against a fake host ----

const SCENARIO = `
const electron = require(${JSON.stringify(path.join(root, "scripts", "tauri-electron.cjs"))});
const { app, BrowserWindow, ipcMain, safeStorage, clipboard, nativeImage } = electron;
let win = null;
ipcMain.handle("echo", (event, ...args) => ({
  count: args.length, firstUndefined: args[0] === undefined, second: args[1],
  sender: event.sender === win.webContents, frame: event.senderFrame === win.webContents.mainFrame,
}));
ipcMain.handle("bytes", () => Buffer.from("hi"));
ipcMain.handle("boom", () => { throw new TypeError("bad thing"); });
const original = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => original(channel, (...args) => handler(...args)); // main.cjs wraps it the same way
ipcMain.handle("wrapped", () => "through the wrapper");
let kept = false;
app.on("window-all-closed", () => app.quit());
app.whenReady().then(() => {
  win = new BrowserWindow({ width: 800, height: 600, minWidth: 600, minHeight: 560, show: false, title: "Probe" });
  win.on("close", (event) => { if (!kept) { kept = true; event.preventDefault(); win.webContents.send("note", "kept once"); } });
  win.webContents.ipc.on("eyes:assistant-sync", () => win.webContents.send("note", "synced"));
  const secret = safeStorage.encryptString("synthetic secret");
  const tiny = nativeImage.createFromBuffer(Buffer.from("89504e470d0a1a0a0000000d4948445200000002000000030806000000", "hex"));
  win.webContents.send("ready", {
    userData: app.getPath("userData"), version: app.getVersion(), packaged: app.isPackaged,
    available: safeStorage.isEncryptionAvailable(), roundTrip: safeStorage.decryptString(secret), prefix: secret.subarray(0, 3).toString(),
    clip: clipboard.readText(), size: tiny.getSize(), blob: Buffer.from([1, 2, 3]),
  });
});
`;

function fakeHost(pipe, token) {
  const key = Buffer.alloc(32, 7).toString("base64");
  const frames = [];
  const waiters = [];
  let main = null;
  const offer = (frame) => {
    frames.push(frame);
    for (const waiter of waiters.slice()) {
      if (waiter.match(frame)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(frame);
      }
    }
  };
  const server = net.createServer((socket) => {
    let role = null;
    socket.on("data", wire.createLineReader((line) => {
      const frame = JSON.parse(line);
      if (!role) {
        assert.equal(frame.t, "hello");
        assert.equal(frame.token, token, "the engine sends the launch token first");
        role = frame.role;
        if (role === "main") {
          main = socket;
          socket.write(wire.frame({ t: "welcome" }, JSON.stringify({ displays: [{ id: 0, primary: true, scaleFactor: 1.5, bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0, width: 1280, height: 680 } }] })));
        }
        return;
      }
      if (frame.t === "call") {
        const answers = { "safeStorage.key": key, "clipboard.readText": "clip text" };
        const ok = frame.api in answers;
        socket.write(JSON.stringify(ok ? { t: "reply", id: frame.id, ok: true, body: answers[frame.api] } : { t: "reply", id: frame.id, ok: false, error: `no ${frame.api}` }) + "\n");
        return;
      }
      offer({ ...frame, role });
    }));
    socket.on("error", () => {});
  });
  return {
    frames,
    listen: () => new Promise((resolve) => server.listen(pipe, resolve)),
    close: () => new Promise((resolve) => server.close(resolve)),
    next: (match, label) => {
      const seen = frames.find(match);
      if (seen) {
        frames.splice(frames.indexOf(seen), 1);
        return Promise.resolve(seen);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${label} within 15 s; frames: ${JSON.stringify(frames).slice(0, 600)}`)), 15000);
        waiters.push({ match, resolve: (frame) => { clearTimeout(timer); frames.splice(frames.indexOf(frame), 1); resolve(frame); } });
      });
    },
    send: (frame) => main.write(JSON.stringify(frame) + "\n"),
  };
}

test("the engine's Electron shim talks to the host over the pipe", { timeout: 60000 }, async () => {
  const id = `${process.pid}-${Date.now()}`;
  const pipe = process.platform === "win32" ? `\\\\.\\pipe\\mefi-shim-test-${id}` : path.join(os.tmpdir(), `mefi-shim-test-${id}.sock`);
  const token = "test-token-" + id;
  const host = fakeHost(pipe, token);
  await host.listen();
  const info = { name: "Mefi's Studio AI+", version: "9.9.9", isPackaged: false, paths: { userData: path.join(os.tmpdir(), "mefi-shim-user-data"), temp: os.tmpdir(), documents: os.tmpdir() } };
  const child = spawn(process.execPath, ["-e", SCENARIO], {
    env: { ...process.env, MEFI_STUDIO_HOST: "tauri", MEFI_HOST_PIPE: pipe, MEFI_HOST_TOKEN: token, MEFI_HOST_INFO: JSON.stringify(info) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  try {
    const create = await host.next((f) => f.t === "cast" && f.api === "window.create", "window.create");
    assert.equal(create.body[0].minWidth, 600);
    assert.equal(create.body[0].show, false);

    const ready = await host.next((f) => f.t === "push" && f.ch === "ready", "the ready push");
    assert.equal(ready.tagged, true, "a push holding bytes is marked");
    const state = wire.revive(ready.body)[0];
    assert.equal(state.userData, info.paths.userData);
    assert.equal(state.version, "9.9.9");
    assert.equal(state.packaged, false);
    assert.equal(state.available, true);
    assert.equal(state.roundTrip, "synthetic secret");
    assert.equal(state.prefix, "v10", "Chromium's OSCrypt format");
    assert.equal(state.clip, "clip text");
    assert.deepEqual(state.size, { width: 2, height: 3 }, "a PNG's size is read without the host");
    assert.deepEqual([...state.blob], [1, 2, 3]);

    host.send({ t: "invoke", id: 1, ch: "echo", tagged: true, body: [{ $mefi: "undef" }, "two"] });
    const echo = await host.next((f) => f.t === "result" && f.id === 1, "echo's result");
    assert.deepEqual(echo.body, { count: 2, firstUndefined: true, second: "two", sender: true, frame: true });

    host.send({ t: "invoke", id: 2, ch: "bytes", body: [] });
    const bytes = await host.next((f) => f.t === "result" && f.id === 2, "bytes' result");
    assert.equal(bytes.tagged, true);
    assert.deepEqual(bytes.body, { $mefi: "bytes", b64: Buffer.from("hi").toString("base64") });

    host.send({ t: "invoke", id: 3, ch: "boom", body: [] });
    const boom = await host.next((f) => f.t === "result" && f.id === 3, "boom's result");
    assert.equal(boom.ok, false);
    assert.equal(boom.error, "Error invoking remote method 'boom': TypeError: bad thing");

    host.send({ t: "invoke", id: 4, ch: "missing", body: [] });
    const missing = await host.next((f) => f.t === "result" && f.id === 4, "a missing handler's result");
    assert.match(missing.error, /No handler registered for 'missing'/);

    host.send({ t: "invoke", id: 5, ch: "wrapped", body: [] });
    assert.equal((await host.next((f) => f.t === "result" && f.id === 5, "the wrapped handler")).body, "through the wrapper");

    host.send({ t: "send", ch: "eyes:assistant-sync", body: [] });
    assert.deepEqual((await host.next((f) => f.t === "push" && f.ch === "note", "the sync note")).body, ["synced"]);

    host.send({ t: "event", ch: "window:focus" });
    host.send({ t: "event", ch: "window:close-requested" });
    assert.deepEqual((await host.next((f) => f.t === "push" && f.ch === "note", "the kept note")).body, ["kept once"], "a close listener may keep the window");
    assert.equal(host.frames.some((f) => f.api === "window.destroy"), false);

    host.send({ t: "event", ch: "window:close-requested" });
    await host.next((f) => f.t === "cast" && f.api === "window.destroy", "window.destroy");
    assert.equal(await exited, 0, `the engine quits after its last window (output: ${output.slice(-800)})`);
  } finally {
    child.kill();
    await host.close();
  }
});

// ---- the page's half ----

function pageBridge() {
  const init = readFileSync(path.join(root, "src-tauri", "src", "init.js"), "utf8");
  const preload = readFileSync(path.join(root, "preload.cjs"), "utf8");
  assert.ok(init.includes("/*__MEFI_PRELOAD__*/"), "init.js keeps the preload marker the host replaces");
  const calls = [];
  const channels = [];
  const answers = new Map();
  const context = {
    console: { log() {}, warn() {}, error() {} },
    TextEncoder, TextDecoder, btoa, atob, Promise, Uint8Array, ArrayBuffer, JSON, Date, Number, String, Object, Array, Map, Error,
    location: { origin: "http://mefi.localhost" },
    document: { addEventListener() {} },
    addEventListener() {},
    reportError(error) { throw error; },
  };
  context.window = context;
  context.globalThis = context;
  context.__TAURI__ = {
    core: {
      Channel: class { constructor() { this.onmessage = null; channels.push(this); } },
      invoke: async (command, args, options) => {
        const decoded = args instanceof Uint8Array ? JSON.parse(new TextDecoder().decode(args)) : args;
        calls.push({ command, args: decoded, headers: options?.headers ?? {} });
        if (command !== "ipc_invoke") return null;
        const answer = answers.get(options.headers["mefi-ch"]);
        return answer ?? { t: "result", ok: true, body: null };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(init.replace("/*__MEFI_PRELOAD__*/", preload), context, { filename: "init.js" });
  return { context, calls, channels, answers };
}

test("the page's bridge builds window.mefiStudio from the real preload", async () => {
  const { context, calls, channels, answers } = pageBridge();
  const studio = context.mefiStudio;
  assert.ok(studio && Object.isFrozen(studio), "window.mefiStudio is defined and frozen");
  assert.equal(context.__mefiHost.kind, "tauri");
  assert.equal(channels.length, 1, "the push channel opens at document start");
  assert.equal(calls[0].command, "ipc_subscribe");

  answers.set("projects:list", { t: "result", ok: true, body: { projects: [{ id: "p1" }] } });
  assert.deepEqual(await studio.projectsList(), { projects: [{ id: "p1" }] });
  const listed = calls.find((call) => call.headers["mefi-ch"] === "projects:list");
  assert.deepEqual(listed.args, []);
  assert.equal(listed.headers["mefi-tagged"], "0");

  await studio.jevSetEnabled(undefined);
  const undefinedArg = calls.find((call) => call.headers["mefi-ch"] === "jev:set-enabled");
  assert.equal(undefinedArg.headers["mefi-tagged"], "1");
  assert.deepEqual(undefinedArg.args, [{ $mefi: "undef" }], "undefined survives the wire");

  answers.set("projects:remove", { t: "result", ok: false, error: "Error invoking remote method 'projects:remove': Error: nope" });
  await assert.rejects(studio.projectsRemove("p1"), /Error invoking remote method 'projects:remove': Error: nope/);

  const seen = [];
  studio.onProjects((data) => seen.push(data));
  studio.onProjects((data) => seen.push({ second: data }));
  channels[0].onmessage({ t: "push", ch: "projects:changed", body: [{ list: 1 }] });
  channels[0].onmessage({ t: "push", ch: "other:channel", body: [{ list: 2 }] });
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), [{ list: 1 }, { second: { list: 1 } }], "each subscriber gets the push once, in order");

  answers.set("eyes:assistant-state", { t: "result", ok: true, body: {} });
  studio.onAssistant(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  const sync = calls.find((call) => call.command === "ipc_send");
  assert.equal(sync?.headers["mefi-ch"], "eyes:assistant-sync", "the assistant listener asks for whole keys, as under Electron");

  const tagged = { t: "push", ch: "projects:changed", tagged: true, body: [{ shot: { $mefi: "bytes", b64: "aGk=" }, gone: { $mefi: "undef" } }] };
  channels[0].onmessage(tagged);
  const last = seen.at(-2);
  assert.ok(last.shot instanceof context.Uint8Array || ArrayBuffer.isView(last.shot));
  assert.equal(new TextDecoder().decode(last.shot), "hi");
  assert.equal(last.gone, undefined);

  assert.equal(context.__mefiHost.fileUrl("C:\\shots\\a #1.png"), "http://mefi.localhost/__file/C%3A%2Fshots%2Fa%20%231.png");
});
