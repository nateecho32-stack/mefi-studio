"use strict";
// Electron's API for main.cjs, served by the Rust host (src-tauri). Stage 1
// of docs/rust-migration.md: the engine runs under plain Node as the host's
// sidecar, and main.cjs picks this module instead of require("electron") when
// MEFI_STUDIO_HOST=tauri. It covers what main.cjs and the helpers it passes
// Electron to actually use (the inventory in docs/rust-migration.md); a
// member Studio never used is absent, so a new use fails loudly here first.
//
// Two connections reach the host over one named pipe. The main one carries
// the page's invokes and sends, the engine's pushes, the window's events and
// calls that may answer later. The sync one (scripts/tauri-sync-worker.cjs)
// answers the calls Electron answered on the spot.
const net = require("node:net");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { Worker, MessageChannel, receiveMessageOnPort } = require("node:worker_threads");
const wire = require("./host-wire.cjs");

const PIPE = process.env.MEFI_HOST_PIPE;
const TOKEN = process.env.MEFI_HOST_TOKEN;
const INFO = (() => {
  try {
    return JSON.parse(process.env.MEFI_HOST_INFO || "{}");
  } catch {
    return {};
  }
})();
if (!PIPE || !TOKEN) {
  throw new Error("scripts/tauri-electron.cjs runs only under the Rust host (src-tauri), which sets MEFI_HOST_PIPE and MEFI_HOST_TOKEN.");
}
// Builders, CLIs and probes the engine starts must not inherit the link.
for (const name of ["MEFI_HOST_PIPE", "MEFI_HOST_TOKEN", "MEFI_HOST_INFO"]) delete process.env[name];

const preventable = (extra = {}) => ({
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
  ...extra,
});

// ---- the main connection ----

const link = (() => {
  const pending = new Map();
  let nextId = 1;
  let connected = false;
  let backlog = [];
  let readyResolve;
  const ready = new Promise((resolve) => (readyResolve = resolve));
  const socket = net.connect(PIPE);
  const write = (text) => {
    if (connected) socket.write(text);
    else backlog.push(text);
  };
  socket.on("connect", () => {
    socket.write(wire.frame({ t: "hello", role: "main", token: TOKEN, pid: process.pid }));
    connected = true;
    for (const text of backlog) socket.write(text);
    backlog = [];
  });
  socket.on("error", (error) => {
    console.error(`[tauri-host] link error: ${error.message}`);
  });
  // The host is the app: when it is gone there is nothing left to serve.
  socket.on("close", () => {
    for (const { reject } of pending.values()) reject(new Error("the Rust host closed the link"));
    pending.clear();
    process.exit(process.exitCode ?? 0);
  });
  const handlers = { welcome: null, invoke: null, send: null, event: null };
  socket.on("data", wire.createLineReader((line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch (error) {
      console.error(`[tauri-host] unreadable frame: ${error.message}`);
      return;
    }
    if (frame.t === "reply") {
      const waiter = pending.get(frame.id);
      if (!waiter) return;
      pending.delete(frame.id);
      if (frame.ok) waiter.resolve(frame.tagged ? wire.revive(frame.body) : frame.body);
      else waiter.reject(new Error(String(frame.error ?? "host call failed")));
      return;
    }
    if (frame.t === "welcome") {
      handlers.welcome?.(frame.body ?? {});
      readyResolve();
      return;
    }
    handlers[frame.t]?.(frame);
  }));
  return {
    ready,
    handlers,
    write,
    call(api, ...args) {
      const id = nextId++;
      const { json, tagged } = wire.encode(args);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        write(wire.frame({ t: "call", id, api, ...(tagged ? { tagged: true } : {}) }, json));
      });
    },
    cast(api, ...args) {
      const { json, tagged } = wire.encode(args);
      write(wire.frame({ t: "cast", api, ...(tagged ? { tagged: true } : {}) }, json));
    },
  };
})();

// ---- the blocking connection ----

const syncCall = (() => {
  let worker = null, port = null, flag = null;
  let nextId = 1;
  const start = () => {
    const signal = new SharedArrayBuffer(4);
    const channel = new MessageChannel();
    flag = new Int32Array(signal);
    port = channel.port2;
    worker = new Worker(require.resolve("./tauri-sync-worker.cjs"), {
      workerData: { pipe: PIPE, token: TOKEN, signal, port: channel.port1 },
      transferList: [channel.port1],
    });
    worker.unref();
    worker.on("error", (error) => console.error(`[tauri-host] sync worker: ${error.message}`));
  };
  return (api, ...args) => {
    if (!worker) start();
    const id = nextId++;
    Atomics.store(flag, 0, 0);
    worker.postMessage({ id, api, args });
    for (;;) {
      if (Atomics.wait(flag, 0, 0, 15000) === "timed-out") throw new Error(`the Rust host did not answer ${api} within 15 s`);
      const received = receiveMessageOnPort(port);
      if (!received) continue;
      const message = received.message;
      if (message.id !== id) continue;
      if (!message.ok) throw new Error(message.error);
      return wire.decode(message.json, message.tagged);
    }
  };
})();

// ---- nativeImage ----

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class NativeImage {
  constructor(bytes = Buffer.alloc(0), size = null) {
    this._bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    this._size = size;
  }
  _isPng() {
    return this._bytes.length > 24 && this._bytes.subarray(0, 8).equals(PNG_SIGNATURE);
  }
  isEmpty() {
    return this._bytes.length === 0;
  }
  getSize() {
    if (this.isEmpty()) return { width: 0, height: 0 };
    if (!this._size) {
      this._size = this._isPng()
        ? { width: this._bytes.readUInt32BE(16), height: this._bytes.readUInt32BE(20) }
        : syncCall("image.size", this._bytes);
    }
    return { ...this._size };
  }
  getAspectRatio() {
    const { width, height } = this.getSize();
    return height ? width / height : 1;
  }
  resize({ width, height, quality } = {}) {
    if (this.isEmpty()) return new NativeImage();
    const out = syncCall("image.resize", this._bytes, { width: width ?? null, height: height ?? null, quality: quality ?? "good" });
    return new NativeImage(out.png, { width: out.width, height: out.height });
  }
  crop({ x = 0, y = 0, width, height }) {
    if (this.isEmpty()) return new NativeImage();
    const out = syncCall("image.crop", this._bytes, { x, y, width, height });
    return new NativeImage(out.png, { width: out.width, height: out.height });
  }
  toPNG() {
    if (this.isEmpty() || this._isPng()) return Buffer.from(this._bytes);
    return syncCall("image.encode", this._bytes, { format: "png" });
  }
  toJPEG(quality = 90) {
    if (this.isEmpty()) return Buffer.alloc(0);
    return syncCall("image.encode", this._bytes, { format: "jpeg", quality });
  }
  toDataURL() {
    return `data:image/png;base64,${this.toPNG().toString("base64")}`;
  }
  // Raw pixels in Electron's order on Windows: B, G, R, A.
  toBitmap() {
    if (this.isEmpty()) return Buffer.alloc(0);
    return syncCall("image.bitmap", this._bytes);
  }
  getBitmap() {
    return this.toBitmap();
  }
}

const nativeImage = {
  createEmpty: () => new NativeImage(),
  createFromBuffer: (buffer) => new NativeImage(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])),
  createFromPath: (file) => {
    try {
      return new NativeImage(fs.readFileSync(file));
    } catch {
      return new NativeImage();
    }
  },
  createFromDataURL: (url) => {
    const match = /^data:[^;,]*;base64,(.*)$/s.exec(String(url ?? ""));
    return new NativeImage(match ? Buffer.from(match[1], "base64") : Buffer.alloc(0));
  },
};
const imageBytes = (image) => (image instanceof NativeImage ? image.toPNG() : typeof image === "string" ? nativeImage.createFromPath(image).toPNG() : null);

// ---- screen ----

let displays = Array.isArray(INFO.displays) ? INFO.displays : [];
const fallbackDisplay = () => ({
  id: 0, label: "", scaleFactor: 1, rotation: 0, internal: false,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  size: { width: 1920, height: 1080 }, workAreaSize: { width: 1920, height: 1040 },
});
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const screen = Object.assign(new EventEmitter(), {
  getAllDisplays: () => (displays.length ? displays.map((entry) => ({ ...entry })) : [fallbackDisplay()]),
  getPrimaryDisplay: () => ({ ...(displays.find((entry) => entry.primary) ?? displays[0] ?? fallbackDisplay()) }),
  getDisplayMatching(rect) {
    let best = null, bestArea = -1;
    for (const entry of screen.getAllDisplays()) {
      const area = overlap(entry.bounds, rect ?? { x: 0, y: 0, width: 0, height: 0 });
      if (area > bestArea) [best, bestArea] = [entry, area];
    }
    return bestArea > 0 ? best : screen.getPrimaryDisplay();
  },
  getDisplayNearestPoint(point) {
    return screen.getDisplayMatching({ x: point?.x ?? 0, y: point?.y ?? 0, width: 1, height: 1 });
  },
  getCursorScreenPoint: () => syncCall("screen.cursor"),
});

// ---- webContents and BrowserWindow ----

const windows = [];
let mainWindow = null;

function sessionStub(partition = "") {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    _partition: String(partition),
    // The host owns these policies in Rust (src-tauri/src/views.rs, docs/rust-migration.md parity table).
    webRequest: { onBeforeSendHeaders() {}, onBeforeRequest() {}, onHeadersReceived() {} },
    setDisplayMediaRequestHandler() {},
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    flushStorageData() {},
    clearStorageData: async () => {},
    clearCache: async () => {},
    closeAllConnections: async () => {},
  });
}
const defaultSession = sessionStub();

class WebContents extends EventEmitter {
  constructor(owner) {
    super();
    this.id = owner.id;
    this._owner = owner;
    this._zoom = 1;
    this._loading = false;
    this._url = "";
    this._title = "";
    // Identity only: handlers compare event.senderFrame with this object.
    this.mainFrame = { routingId: 1, processId: 1, get url() { return owner.webContents?._url ?? ""; } };
    this.ipc = new EventEmitter();
    this.session = defaultSession;
    this.navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack() {}, goForward() {} };
    this.debugger = {
      attach() {},
      detach() {},
      isAttached: () => false,
      sendCommand: (method, params) => link.call("webContents.devtoolsCommand", { method, params: params ?? {} }),
    };
  }
  isDestroyed() {
    return this._owner._destroyed;
  }
  isLoading() {
    return this._loading;
  }
  isCrashed() {
    return false;
  }
  getURL() {
    return this._url;
  }
  getTitle() {
    return this._title;
  }
  send(channel, ...args) {
    if (this.isDestroyed()) return;
    const { json, tagged } = wire.encode(args);
    link.write(wire.frame({ t: "push", ch: String(channel), ...(tagged ? { tagged: true } : {}) }, json));
  }
  executeJavaScript(code) {
    return link.call("webContents.executeJavaScript", { code: String(code) });
  }
  async capturePage(rect) {
    const png = await link.call("webContents.capturePage", rect ?? null);
    return new NativeImage(png);
  }
  insertCSS(css) {
    return link.call("webContents.executeJavaScript", { code: `(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(String(css))}; document.head.append(s); return ""; })()` });
  }
  getZoomFactor() {
    return this._zoom;
  }
  setZoomFactor(factor) {
    const value = Number(factor);
    if (!Number.isFinite(value) || value <= 0) return;
    this._zoom = value;
    link.cast("window.setZoom", { factor: value });
  }
  reload() {
    link.cast("window.reload", { ignoreCache: false });
  }
  reloadIgnoringCache() {
    link.cast("window.reload", { ignoreCache: true });
  }
  focus() {
    link.cast("window.focus");
  }
  openDevTools() {
    link.cast("window.devtools", { open: true });
  }
  closeDevTools() {
    link.cast("window.devtools", { open: false });
  }
  toggleDevTools() {
    link.cast("window.devtools", { toggle: true });
  }
  // The host's own rules decide these in Rust: only Studio's page may load in
  // the window, and http(s) links open in the default browser.
  setWindowOpenHandler() {}
  setFrameRate() {}
  setAudioMuted() {}
  isAudioMuted() {
    return false;
  }
}

class BrowserWindow extends EventEmitter {
  static getAllWindows() {
    return windows.filter((entry) => !entry._destroyed);
  }
  static getFocusedWindow() {
    return BrowserWindow.getAllWindows().find((entry) => entry._state.focused) ?? null;
  }
  static fromWebContents(contents) {
    return BrowserWindow.getAllWindows().find((entry) => entry.webContents === contents) ?? null;
  }

  constructor(options = {}) {
    super();
    if (mainWindow && !mainWindow._destroyed) {
      throw new Error("The Rust host has one window; evidence shots take their hidden window through evidence.capture (scripts/rust-modules.cjs), and the Media browser is a child view.");
    }
    this.id = 1;
    this._destroyed = false;
    const width = Number(options.width) || 800;
    const height = Number(options.height) || 600;
    this._state = {
      visible: options.show !== false, focused: false, minimized: false, maximized: false, fullscreen: false,
      bounds: { x: Number.isFinite(options.x) ? options.x : 0, y: Number.isFinite(options.y) ? options.y : 0, width, height },
    };
    this.webContents = new WebContents(this);
    // Child views are webviews the host lays over the page (src-tauri/src/views.rs).
    this.contentView = {
      children: [],
      addChildView: (view) => {
        if (!(view instanceof WebContentsView) || this.contentView.children.includes(view)) return;
        this.contentView.children.push(view);
        view._attach();
      },
      removeChildView: (view) => {
        const at = this.contentView.children.indexOf(view);
        if (at < 0) return;
        this.contentView.children.splice(at, 1);
        view.setVisible(false);
      },
    };
    mainWindow = this;
    windows.push(this);
    const prefs = options.webPreferences ?? {};
    link.cast("window.create", {
      width, height,
      minWidth: Number(options.minWidth) || null, minHeight: Number(options.minHeight) || null,
      x: Number.isFinite(options.x) ? options.x : null, y: Number.isFinite(options.y) ? options.y : null,
      show: options.show !== false,
      title: String(options.title ?? ""),
      backgroundColor: typeof options.backgroundColor === "string" ? options.backgroundColor : null,
      icon: typeof options.icon === "string" ? options.icon : null,
      backgroundThrottling: prefs.backgroundThrottling !== false,
      autoplay: prefs.autoplayPolicy === "no-user-gesture-required",
    });
  }

  _set(patch) {
    Object.assign(this._state, patch);
  }
  isDestroyed() {
    return this._destroyed;
  }
  isVisible() {
    return !this._destroyed && this._state.visible;
  }
  isMinimized() {
    return this._state.minimized;
  }
  isMaximized() {
    return this._state.maximized;
  }
  isFullScreen() {
    return this._state.fullscreen;
  }
  isFocused() {
    return !this._destroyed && this._state.focused;
  }
  getBounds() {
    return { ...this._state.bounds };
  }
  getContentBounds() {
    return { ...(this._state.contentBounds ?? this._state.bounds) };
  }
  getContentSize() {
    const bounds = this.getContentBounds();
    return [bounds.width, bounds.height];
  }
  getSize() {
    return [this._state.bounds.width, this._state.bounds.height];
  }
  getTitle() {
    return this._state.title ?? "";
  }
  show() {
    this._set({ visible: true, minimized: false });
    link.cast("window.show", { focus: true });
  }
  showInactive() {
    this._set({ visible: true });
    link.cast("window.show", { focus: false });
  }
  hide() {
    this._set({ visible: false });
    link.cast("window.hide");
  }
  focus() {
    link.cast("window.focus");
  }
  blur() {}
  minimize() {
    this._set({ minimized: true });
    link.cast("window.minimize");
  }
  restore() {
    this._set({ minimized: false, visible: true });
    link.cast("window.restore");
  }
  maximize() {
    this._set({ maximized: true, visible: true });
    link.cast("window.maximize");
  }
  unmaximize() {
    this._set({ maximized: false });
    link.cast("window.unmaximize");
  }
  setFullScreen(flag) {
    this._set({ fullscreen: Boolean(flag) });
    link.cast("window.fullscreen", { on: Boolean(flag) });
  }
  setTitle(title) {
    this._state.title = String(title ?? "");
    link.cast("window.setTitle", { title: this._state.title });
  }
  setBounds(bounds) {
    this._set({ bounds: { ...this._state.bounds, ...bounds } });
    link.cast("window.setBounds", this._state.bounds);
  }
  center() {
    link.cast("window.center");
  }
  flashFrame(flag) {
    link.cast("window.flash", { on: Boolean(flag) });
  }
  setProgressBar(progress) {
    link.cast("window.progress", { value: Number(progress) });
  }
  setOverlayIcon(image, description) {
    const png = image ? imageBytes(image) : null;
    link.cast("window.overlay", { png: png && png.length ? png : null, description: String(description ?? "") });
  }
  setSkipTaskbar(skip) {
    link.cast("window.skipTaskbar", { on: Boolean(skip) });
  }
  setAlwaysOnTop(flag) {
    link.cast("window.alwaysOnTop", { on: Boolean(flag) });
  }
  loadFile(file, options = {}) {
    return this._load({ file: String(file), query: options.query ?? {}, hash: options.hash ?? "" });
  }
  loadURL(url) {
    return this._load({ url: String(url) });
  }
  _load(target) {
    const contents = this.webContents;
    return new Promise((resolve, reject) => {
      const done = () => {
        contents.removeListener("did-fail-load", failed);
        resolve();
      };
      const failed = (_event, code, description) => {
        contents.removeListener("did-finish-load", done);
        reject(Object.assign(new Error(`${description} (${code})`), { code, errno: code }));
      };
      contents.once("did-finish-load", done);
      contents.once("did-fail-load", failed);
      link.cast("window.load", target);
    });
  }
  // Electron's close: a "close" listener may keep the window; otherwise it goes.
  close() {
    if (this._destroyed) return;
    const event = preventable();
    this.emit("close", event);
    if (!event.defaultPrevented) this.destroy();
  }
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._state.visible = false;
    link.cast("window.destroy");
    this.webContents.emit("destroyed");
    this.emit("closed");
    afterWindowClosed();
  }
}

// ---- app ----

const app = new EventEmitter();
let quitting = false;
let ready = false;
const exitWith = (code) => {
  // The host follows the engine's exit; hooks on process "exit" still run.
  process.exit(Number.isInteger(code) ? code : 0);
};
function afterWindowClosed() {
  if (quitting || BrowserWindow.getAllWindows().length) return;
  if (app.listenerCount("window-all-closed")) app.emit("window-all-closed", preventable());
  else app.quit();
}
Object.assign(app, {
  name: String(INFO.name ?? "Electron"),
  isPackaged: INFO.isPackaged === true,
  commandLine: { appendSwitch() {}, hasSwitch: () => false, getSwitchValue: () => "" },
  getName() {
    return this.name;
  },
  setName(name) {
    this.name = String(name);
  },
  getVersion() {
    return String(INFO.version ?? "0.0.0");
  },
  getLocale() {
    return String(INFO.locale ?? "en-US");
  },
  getAppPath() {
    return String(INFO.studioRoot ?? process.cwd());
  },
  getPath(name) {
    const value = INFO.paths?.[name];
    if (typeof value !== "string" || !value) throw new Error(`Failed to get '${name}' path`);
    return value;
  },
  setAppUserModelId(id) {
    link.cast("app.setAppUserModelId", { id: String(id) });
  },
  // The host holds the single-instance lock (tauri-plugin-single-instance)
  // and forwards a second launch as "second-instance".
  requestSingleInstanceLock: () => true,
  hasSingleInstanceLock: () => true,
  releaseSingleInstanceLock() {},
  isReady: () => ready,
  whenReady: () => link.ready.then(() => undefined),
  focus() {
    mainWindow?.focus();
  },
  getLoginItemSettings(options = {}) {
    return syncCall("app.loginItem.get", { path: options.path ?? null, args: options.args ?? [] });
  },
  setLoginItemSettings(settings = {}) {
    syncCall("app.loginItem.set", {
      openAtLogin: settings.openAtLogin === true, path: settings.path ?? null, args: settings.args ?? [], name: settings.name ?? null,
    });
  },
  getAppMetrics() {
    const usage = process.cpuUsage();
    const engine = { pid: process.pid, type: "Engine", cpu: { percentCPUUsage: 0, idleWakeupsPerSecond: 0, cumulativeCPUUsage: (usage.user + usage.system) / 1e6 }, memory: { workingSetSize: Math.round(process.memoryUsage().rss / 1024), peakWorkingSetSize: 0 } };
    let host = [];
    try {
      host = syncCall("app.metrics");
    } catch { /* the engine's own row still answers */ }
    return [...(Array.isArray(host) ? host : []), engine];
  },
  relaunch(options = {}) {
    // Recorded by the host, which starts the new copy once this one has gone.
    syncCall("app.relaunch", { args: Array.isArray(options.args) ? options.args.map(String) : null });
  },
  quit() {
    if (quitting) return;
    const before = preventable();
    app.emit("before-quit", before);
    if (before.defaultPrevented) return;
    quitting = true;
    for (const entry of BrowserWindow.getAllWindows()) {
      entry.close();
      if (!entry.isDestroyed()) {
        quitting = false;
        return;
      }
    }
    const will = preventable();
    app.emit("will-quit", will);
    if (will.defaultPrevented) {
      quitting = false;
      return;
    }
    app.emit("quit", preventable(), 0);
    exitWith(0);
  },
  exit(code = 0) {
    exitWith(code);
  },
});

// ---- the rest of the module ----

const ipcHandlers = new Map();
const ipcMain = new EventEmitter();
ipcMain.handle = (channel, handler) => {
  if (ipcHandlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
  ipcHandlers.set(channel, handler);
};
ipcMain.handleOnce = (channel, handler) => {
  ipcMain.handle(channel, (...args) => {
    ipcHandlers.delete(channel);
    return handler(...args);
  });
};
ipcMain.removeHandler = (channel) => {
  ipcHandlers.delete(channel);
};

const shell = {
  openExternal: (url) => link.call("shell.openExternal", { url: String(url) }).then(() => undefined),
  openPath: (file) => link.call("shell.openPath", { path: String(file) }).then((error) => String(error ?? "")),
  showItemInFolder: (file) => link.cast("shell.showItemInFolder", { path: String(file) }),
  trashItem: (file) => link.call("shell.trashItem", { path: String(file) }).then(() => undefined),
  beep: () => link.cast("shell.beep"),
};

// dialog.x([window,] options): the window only parents the dialog.
const dialogArgs = (first, second) => (second === undefined && !(first instanceof BrowserWindow) && first !== null ? first : second) ?? {};
const dialog = {
  showOpenDialog: (first, second) => link.call("dialog.open", dialogArgs(first, second)),
  showSaveDialog: (first, second) => link.call("dialog.save", dialogArgs(first, second)),
  showMessageBox: (first, second) => link.call("dialog.message", dialogArgs(first, second)),
  showErrorBox: (title, content) => link.cast("dialog.error", { title: String(title ?? ""), content: String(content ?? "") }),
};

const clipboard = {
  readText: () => String(syncCall("clipboard.readText") ?? ""),
  writeText: (text) => link.cast("clipboard.writeText", { text: String(text ?? "") }),
};

const safeStorage = (() => {
  const V10 = Buffer.from("v10");
  let key = null;
  let failure = null;
  // Chromium's OSCrypt on Windows: an AES-256-GCM key kept DPAPI-protected in
  // userData's "Local State", and ciphertext "v10" + 12-byte nonce + data + tag.
  // The host reads (or, on a fresh install, writes) the key; the cipher runs here.
  const getKey = () => {
    if (key) return key;
    if (failure) throw failure;
    try {
      const bytes = Buffer.from(String(syncCall("safeStorage.key")), "base64");
      if (bytes.length !== 32) throw new Error("the saved encryption key is not 32 bytes");
      key = bytes;
      return key;
    } catch (error) {
      failure = error;
      throw error;
    }
  };
  return {
    isEncryptionAvailable() {
      try {
        return getKey().length === 32;
      } catch {
        return false;
      }
    },
    getSelectedStorageBackend: () => "dpapi",
    encryptString(text) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), nonce);
      const data = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
      return Buffer.concat([V10, nonce, data, cipher.getAuthTag()]);
    },
    decryptString(buffer) {
      const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
      if (bytes.length < 3 + 12 + 16 || !bytes.subarray(0, 3).equals(V10)) {
        throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
      }
      try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), bytes.subarray(3, 15));
        decipher.setAuthTag(bytes.subarray(bytes.length - 16));
        return Buffer.concat([decipher.update(bytes.subarray(15, bytes.length - 16)), decipher.final()]).toString("utf8");
      } catch {
        throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
      }
    },
  };
})();

const powerMonitor = Object.assign(new EventEmitter(), {
  getSystemIdleState: (threshold) => String(syncCall("power.idleState", { threshold: Number(threshold) || 0 })),
  getSystemIdleTime: () => Number(syncCall("power.idleTime")) || 0,
  isOnBatteryPower: () => false,
});

const powerSaveBlocker = (() => {
  let next = 1;
  const started = new Set();
  return {
    start(type) {
      const id = next++;
      started.add(id);
      link.cast("power.block", { id, type: String(type) });
      return id;
    },
    stop(id) {
      if (!started.delete(id)) return false;
      link.cast("power.unblock", { id });
      return true;
    },
    isStarted: (id) => started.has(id),
  };
})();

// Menus live here (click handlers are engine functions); the host draws the
// tray's, and the page matches the application menu's accelerators.
const menuItems = new Map();
let nextMenuItem = 1;
class Menu {
  static buildFromTemplate(template) {
    return new Menu(template);
  }
  static setApplicationMenu(menu) {
    link.cast("menu.setApplication", { items: menu instanceof Menu ? menu._wire() : [] });
  }
  constructor(template = []) {
    this.items = (Array.isArray(template) ? template : []).map((item) => {
      const id = nextMenuItem++;
      const entry = { ...item, id, submenu: item.submenu ? (item.submenu instanceof Menu ? item.submenu : new Menu(item.submenu)) : null };
      menuItems.set(id, entry);
      return entry;
    });
  }
  _wire() {
    return this.items.map((item) => ({
      id: item.id,
      label: typeof item.label === "string" ? item.label : "",
      type: item.type ?? (item.submenu ? "submenu" : "normal"),
      role: item.role ?? null,
      accelerator: typeof item.accelerator === "string" ? item.accelerator : null,
      enabled: item.enabled !== false,
      visible: item.visible !== false,
      checked: item.checked === true,
      submenu: item.submenu ? item.submenu._wire() : null,
    }));
  }
  popup() {}
}
function clickMenuItem(id) {
  const item = menuItems.get(Number(id));
  if (!item) return;
  if (typeof item.click === "function") return item.click(item, mainWindow, {});
  const contents = mainWindow?.webContents;
  if (item.role === "toggleDevTools" || item.role === "toggledevtools") contents?.toggleDevTools();
  else if (item.role === "togglefullscreen") mainWindow?.setFullScreen(!mainWindow.isFullScreen());
  else if (item.role === "reload") contents?.reload();
  else if (item.role === "forceReload" || item.role === "forcereload") contents?.reloadIgnoringCache();
  else if (item.role === "quit") app.quit();
  else if (item.role === "minimize") mainWindow?.minimize();
  else if (item.role === "close") mainWindow?.close();
}

const trays = new Map();
let nextTray = 1;
class Tray extends EventEmitter {
  constructor(image) {
    super();
    this._id = nextTray++;
    this._destroyed = false;
    trays.set(this._id, this);
    link.cast("tray.create", { id: this._id, png: imageBytes(image) });
  }
  setToolTip(text) {
    link.cast("tray.tooltip", { id: this._id, text: String(text ?? "") });
  }
  setImage(image) {
    link.cast("tray.image", { id: this._id, png: imageBytes(image) });
  }
  setContextMenu(menu) {
    link.cast("tray.menu", { id: this._id, items: menu instanceof Menu ? menu._wire() : [] });
  }
  isDestroyed() {
    return this._destroyed;
  }
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    trays.delete(this._id);
    link.cast("tray.destroy", { id: this._id });
  }
}

const notifications = new Map();
let nextNotification = 1;
class Notification extends EventEmitter {
  static isSupported() {
    return INFO.notifications !== false;
  }
  constructor(options = {}) {
    super();
    this._id = nextNotification++;
    this.title = String(options.title ?? "");
    this.body = String(options.body ?? "");
    this.silent = options.silent === true;
    this.icon = options.icon ?? null;
  }
  show() {
    notifications.set(this._id, this);
    link.call("notification.show", { id: this._id, title: this.title, body: this.body, silent: this.silent, png: this.icon ? imageBytes(this.icon) : null })
      .then(() => this.emit("show", {}))
      .catch((error) => {
        notifications.delete(this._id);
        this.emit("failed", {}, error.message);
      });
  }
  close() {
    link.cast("notification.close", { id: this._id });
  }
}

const desktopCapturer = { getSources: async () => [] };

// Electron's WebContentsView (the Media browser, scripts/media-browser.cjs): a
// child webview of Studio's window with its own WebView2 profile per
// partition. The host enforces what the view may load, opens no pop-ups and
// takes no downloads; it reports each of those so the engine's handlers run.
const views = new Map();
let nextView = 1;
class ViewContents extends EventEmitter {
  constructor(id, viewSession) {
    super();
    this.id = 1000 + id;
    this._view = id;
    this._destroyed = false;
    this._state = { url: "", title: "", loading: false, back: false, forward: false, muted: false, audible: false };
    this._openHandler = null;
    this.session = viewSession;
    this.navigationHistory = {
      canGoBack: () => this._state.back,
      canGoForward: () => this._state.forward,
      goBack: () => link.cast("view.back", { id: this._view }),
      goForward: () => link.cast("view.forward", { id: this._view }),
    };
  }
  _apply(body) {
    for (const key of ["url", "title", "back", "forward", "muted", "audible"]) if (body && key in body) this._state[key] = body[key];
  }
  isDestroyed() {
    return this._destroyed;
  }
  isLoading() {
    return this._state.loading;
  }
  isCrashed() {
    return false;
  }
  getURL() {
    return this._state.url;
  }
  getTitle() {
    return this._state.title;
  }
  isAudioMuted() {
    return this._state.muted;
  }
  isCurrentlyAudible() {
    return this._state.audible;
  }
  setAudioMuted(flag) {
    this._state.muted = Boolean(flag);
    link.cast("view.mute", { id: this._view, on: Boolean(flag) });
  }
  setWindowOpenHandler(handler) {
    this._openHandler = typeof handler === "function" ? handler : null;
  }
  // Resolves when the page finishes and rejects like Electron's (code, errno)
  // when it fails; a later navigation in the meantime aborts it (-3).
  loadURL(url) {
    if (this._destroyed) return Promise.reject(new Error("the view is closed"));
    const target = String(url);
    return new Promise((resolve, reject) => {
      const done = () => {
        this.removeListener("did-fail-load", failed);
        resolve();
      };
      const failed = (_event, code, description) => {
        this.removeListener("did-finish-load", done);
        reject(Object.assign(new Error(`${description} (${code}) loading '${target}'`), { code: description, errno: code, url: target }));
      };
      this.once("did-finish-load", done);
      this.once("did-fail-load", failed);
      // Electron reports a load as started the moment loadURL is called.
      this._state.loading = true;
      link.cast("view.load", { id: this._view, url: target });
    });
  }
  reload() {
    link.cast("view.reload", { id: this._view });
  }
  stop() {
    link.cast("view.stop", { id: this._view });
  }
  focus() {
    link.cast("view.focus", { id: this._view });
  }
  close() {
    if (this._destroyed) return;
    this._destroyed = true;
    views.delete(this._view);
    link.cast("view.close", { id: this._view });
    this.emit("destroyed");
  }
  setFrameRate() {}
}
class WebContentsView {
  constructor(options = {}) {
    const prefs = options.webPreferences ?? {};
    this._id = nextView++;
    this._created = false;
    this._session = prefs.session ?? defaultSession;
    this.webContents = new ViewContents(this._id, this._session);
    views.set(this._id, this);
  }
  _attach() {
    if (this._created || this.webContents.isDestroyed()) return;
    this._created = true;
    link.cast("view.create", { id: this._id, partition: this._session._partition || "persist:mefi-media-browser" });
  }
  setVisible(flag) {
    if (this._created && !this.webContents.isDestroyed()) link.cast("view.visible", { id: this._id, on: Boolean(flag) });
  }
  setBounds(bounds = {}) {
    if (!this._created || this.webContents.isDestroyed()) return;
    link.cast("view.bounds", { id: this._id, x: Number(bounds.x) || 0, y: Number(bounds.y) || 0, width: Number(bounds.width) || 0, height: Number(bounds.height) || 0 });
  }
  setBackgroundColor() {}
}

const partitions = new Map();
const session = {
  defaultSession,
  fromPartition: (partition) => {
    const name = String(partition ?? "");
    if (!name.startsWith("persist:")) return sessionStub(name);
    if (!partitions.has(name)) partitions.set(name, sessionStub(name));
    return partitions.get(name);
  },
};

// The view's events from the host: { id, url, title, back, forward, muted, audible, ... }.
const viewEvents = {
  "did-start-loading": (contents) => {
    contents._state.loading = true;
    contents.emit("did-start-loading");
  },
  navigation: (contents, body) => {
    contents._state.loading = false;
    if (body.ok) {
      contents.emit("did-navigate", {}, contents._state.url, 200, "OK");
      contents.emit("dom-ready", {});
      contents.emit("did-finish-load", {});
    } else {
      contents.emit("did-fail-load", {}, Number(body.code ?? -2), String(body.description ?? "ERR_FAILED"), String(body.url ?? contents._state.url), true);
    }
    contents.emit("did-stop-loading");
  },
  "did-navigate-in-page": (contents) => contents.emit("did-navigate-in-page", {}, contents._state.url, true),
  "page-title-updated": (contents, body) => {
    contents._state.title = String(body.title ?? "");
    contents.emit("page-title-updated", preventable(), contents._state.title, false);
  },
  "audio-state-changed": (contents) => contents.emit("audio-state-changed", { audible: contents._state.audible }),
  state: (contents) => contents.emit("did-change-state"),
  "render-process-gone": (contents, body) => contents.emit("render-process-gone", {}, { reason: String(body.reason ?? "crashed"), exitCode: 0 }),
  unresponsive: (contents) => contents.emit("unresponsive"),
  // Refused in Rust already; told so the engine's guard says why.
  "will-navigate": (contents, body) => contents.emit("will-navigate", preventable({ url: String(body.url ?? ""), isMainFrame: body.isMainFrame !== false }), String(body.url ?? "")),
  "new-window": (contents, body) => {
    try {
      contents._openHandler?.({ url: String(body.url ?? ""), frameName: "", features: "", disposition: "new-window" });
    } catch (error) {
      console.error(`[tauri-host] window open handler failed: ${error?.message ?? error}`);
    }
  },
  "will-download": (contents) => contents.session?.emit?.("will-download", preventable(), {}, contents),
  "before-input-event": (contents, body) => contents.emit("before-input-event", preventable(), { type: "keyDown", key: String(body.key ?? ""), control: body.control === true, meta: false, shift: false, alt: false }),
};

// ---- what the host sends ----

link.handlers.welcome = (body) => {
  if (Array.isArray(body.displays)) displays = body.displays;
  ready = true;
};

const senderEvent = () => {
  const contents = mainWindow?.webContents ?? null;
  return { sender: contents, senderFrame: contents?.mainFrame ?? null, processId: 1, frameId: 1, ports: [] };
};

link.handlers.invoke = async (frame) => {
  const channel = String(frame.ch);
  let reply;
  try {
    const handler = ipcHandlers.get(channel);
    if (!handler) throw new Error(`No handler registered for '${channel}'`);
    const args = frame.tagged ? wire.revive(frame.body) : frame.body;
    const value = await handler(senderEvent(), ...(Array.isArray(args) ? args : []));
    const { json, tagged } = wire.encode(value);
    reply = wire.frame({ t: "result", id: frame.id, ok: true, ...(tagged ? { tagged: true } : {}) }, json);
  } catch (error) {
    reply = wire.frame({ t: "result", id: frame.id, ok: false, error: wire.invokeErrorMessage(channel, error) });
  }
  link.write(reply);
};

link.handlers.send = (frame) => {
  const args = frame.tagged ? wire.revive(frame.body) : frame.body;
  const list = Array.isArray(args) ? args : [];
  const event = senderEvent();
  mainWindow?.webContents.ipc.emit(String(frame.ch), event, ...list);
  ipcMain.emit(String(frame.ch), event, ...list);
};

const windowEvents = {
  state: (win, body) => win._set(body ?? {}),
  focus: (win) => (win._set({ focused: true }), win.emit("focus")),
  blur: (win) => (win._set({ focused: false }), win.emit("blur")),
  show: (win) => (win._set({ visible: true }), win.emit("show")),
  hide: (win) => (win._set({ visible: false }), win.emit("hide")),
  minimize: (win) => (win._set({ minimized: true }), win.emit("minimize")),
  restore: (win) => (win._set({ minimized: false }), win.emit("restore")),
  maximize: (win) => (win._set({ maximized: true }), win.emit("maximize")),
  unmaximize: (win) => (win._set({ maximized: false }), win.emit("unmaximize")),
  resize: (win, body) => (win._set(body ?? {}), win.emit("resize")),
  move: (win, body) => (win._set(body ?? {}), win.emit("move")),
  "close-requested": (win) => win.close(),
  "session-end": (win) => win.emit("session-end"),
  unresponsive: (win) => win.emit("unresponsive"),
  responsive: (win) => win.emit("responsive"),
};

const contentsEvents = {
  "did-start-navigation": (contents, body) => {
    contents._loading = true;
    contents._url = String(body?.url ?? "");
    const details = preventable({ url: contents._url, isSameDocument: false, isMainFrame: true });
    contents.emit("did-start-navigation", details, contents._url, false, true);
  },
  "did-finish-load": (contents, body) => {
    contents._loading = false;
    if (body?.url) contents._url = String(body.url);
    contents.emit("did-navigate", {}, contents._url, 200, "OK");
    contents.emit("dom-ready", {});
    contents.emit("did-finish-load", {});
  },
  "did-fail-load": (contents, body) => {
    contents._loading = false;
    contents.emit("did-fail-load", {}, Number(body?.code ?? -2), String(body?.description ?? "failed"), String(body?.url ?? contents._url), true);
  },
  "console-message": (contents, body) => {
    const details = preventable({ level: body?.level === "error" ? "error" : body?.level === "warning" ? "warning" : "info", message: String(body?.message ?? ""), lineNumber: Number(body?.line ?? 0), sourceId: String(body?.source ?? "") });
    contents.emit("console-message", details);
  },
  "render-process-gone": (contents, body) => {
    contents.emit("render-process-gone", {}, { reason: String(body?.reason ?? "crashed"), exitCode: Number(body?.exitCode ?? 0) });
  },
  "title-changed": (contents, body) => {
    contents._title = String(body?.title ?? "");
  },
};

link.handlers.event = (frame) => {
  const body = frame.tagged ? wire.revive(frame.body) : frame.body;
  const [target, name] = String(frame.ch ?? "").split(":");
  try {
    if (target === "window" && mainWindow && !mainWindow._destroyed) windowEvents[name]?.(mainWindow, body);
    else if (target === "webContents" && mainWindow && !mainWindow._destroyed) contentsEvents[name]?.(mainWindow.webContents, body);
    else if (target === "app") {
      if (name === "second-instance") app.emit("second-instance", preventable(), body?.argv ?? [], body?.cwd ?? "");
      else if (name === "quit") app.quit();
    } else if (target === "tray") trays.get(Number(body?.id))?.emit(name, preventable(), {});
    else if (target === "menu" && name === "click") clickMenuItem(body?.item);
    else if (target === "notification") {
      const entry = notifications.get(Number(body?.id));
      if (entry) {
        if (name === "close" || name === "failed") notifications.delete(entry._id);
        if (name === "failed") entry.emit("failed", {}, String(body?.error ?? "failed"));
        else entry.emit(name, {});
      }
    } else if (target === "view") {
      const view = views.get(Number(body?.id));
      if (view && !view.webContents.isDestroyed()) {
        view.webContents._apply(body);
        viewEvents[name]?.(view.webContents, body ?? {});
      }
    } else if (target === "power") powerMonitor.emit(name);
    else if (target === "screen" && name === "displays" && Array.isArray(body)) displays = body;
  } catch (error) {
    console.error(`[tauri-host] ${frame.ch} listener failed: ${error?.stack ?? error}`);
  }
};

// ---- functions passed to Rust ----
// A ported module's function argument (sync's `check`, a worktree action's
// `inUse`) crosses as { $mefi: "fn", id }; while the call is in flight the
// host may ask for it to run ("callback" frames) and gets its answer back.
const callbackFunctions = new Map();
let nextCallback = 1;
function withHandles(value, held) {
  if (typeof value === "function") {
    const id = nextCallback++;
    callbackFunctions.set(id, value);
    held.push(id);
    return { $mefi: "fn", id };
  }
  if (Array.isArray(value)) return value.map((item) => withHandles(item, held));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withHandles(item, held)]));
  }
  return value;
}
function callWithFunctions(api, args) {
  const held = [];
  const encoded = (Array.isArray(args) ? args : []).map((arg) => withHandles(arg, held));
  return link.call(api, ...encoded).finally(() => {
    for (const id of held) callbackFunctions.delete(id);
  });
}
link.handlers.callback = async (frame) => {
  let reply;
  try {
    const fn = callbackFunctions.get(frame.fn);
    if (!fn) throw new Error("that function is no longer available");
    const args = frame.tagged ? wire.revive(frame.body) : frame.body;
    const value = await fn(...(Array.isArray(args) ? args : []));
    const { json, tagged } = wire.encode(value);
    reply = wire.frame({ t: "callback-reply", id: frame.id, ok: true, ...(tagged ? { tagged: true } : {}) }, json);
  } catch (error) {
    reply = wire.frame({ t: "callback-reply", id: frame.id, ok: false, error: String(error?.message ?? error) });
  }
  link.write(reply);
};

module.exports = {
  app, BrowserWindow, WebContentsView, ipcMain, safeStorage, shell, dialog, clipboard, desktopCapturer,
  powerSaveBlocker, powerMonitor, Tray, Menu, nativeImage, screen, Notification, session,
  // Not Electron: the engine modules that moved into Rust (crates/mefi-core)
  // are reached through here: the store reads in scripts/eyes-client.cjs,
  // and ported module functions through scripts/rust-modules.cjs.
  __rust: Object.freeze({ call: (api, ...args) => link.call(api, ...args), callWithFunctions }),
};
