// The page's half of the Rust host bridge (docs/rust-migration.md, "The wire").
// Injected at document start into Studio's own page only. It gives preload.cjs
// (spliced in below, unchanged) the three Electron objects it asks for, so
// window.mefiStudio is built by the same code under both hosts.
(() => {
  if (window.__mefiHost) return;
  const TAG = "$mefi";
  const encoder = new TextEncoder();
  const core = () => window.__TAURI__.core;

  // ---- the same tagging rules as scripts/host-wire.cjs ----
  const toBase64 = (view) => {
    let text = "";
    for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
    return btoa(text);
  };
  const fromBase64 = (b64) => {
    const text = atob(b64);
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
    return out;
  };
  const encode = (value) => {
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
      if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
        tagged = true;
        const view = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
        return { [TAG]: "bytes", b64: toBase64(view) };
      }
      return flattened;
    });
    return json === undefined ? { json: `{"${TAG}":"undef"}`, tagged: true } : { json, tagged };
  };
  const revive = (value) => {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) value[i] = revive(value[i]);
      return value;
    }
    if (!value || typeof value !== "object") return value;
    if (typeof value[TAG] === "string") {
      if (value[TAG] === "undef") return undefined;
      if (value[TAG] === "num") return Number(value.v);
      if (value[TAG] === "bytes" && typeof value.b64 === "string") return fromBase64(value.b64);
      if (value[TAG] === "date") return new Date(value.iso ?? Number.NaN);
    }
    for (const key of Object.keys(value)) value[key] = revive(value[key]);
    return value;
  };
  const bodyOf = (frame) => (frame.tagged ? revive(frame.body) : frame.body);

  // The Electron build's localStorage, on the Rust host's first launch
  // (src/local_storage.rs): only keys this page has not written itself.
  const imported = /*__MEFI_LOCAL_STORAGE__*/null;
  if (imported && typeof imported === "object" && location.hostname === "mefi.localhost") {
    try {
      for (const [key, value] of Object.entries(imported)) if (localStorage.getItem(key) === null) localStorage.setItem(key, String(value));
    } catch (error) {
      console.warn("[mefi-host] the Electron build's localStorage was not carried over", error);
    }
  }
  const request = (command, channel, args) => {
    const { json, tagged } = encode(args);
    return core().invoke(command, encoder.encode(json), { headers: { "mefi-ch": channel, "mefi-tagged": tagged ? "1" : "0" } });
  };

  // ---- pushes: one channel for the page, opened before any page script runs ----
  const listeners = new Map();
  const counts = { pushes: {}, invokes: 0 };
  const pushEvent = Object.freeze({ sender: null });
  const deliver = (frame) => {
    counts.pushes[frame.ch] = (counts.pushes[frame.ch] || 0) + 1;
    const list = listeners.get(frame.ch);
    if (!list || !list.length) return;
    const args = bodyOf(frame);
    for (const listener of list.slice()) {
      try {
        listener(pushEvent, ...(Array.isArray(args) ? args : []));
      } catch (error) {
        globalThis.reportError?.(error);
      }
    }
  };
  let subscribed = false;
  const subscribe = () => {
    if (subscribed || !window.__TAURI__?.core) return;
    subscribed = true;
    const channel = new (core().Channel)();
    channel.onmessage = (message) => deliver(typeof message === "string" ? JSON.parse(message) : message);
    core().invoke("ipc_subscribe", { channel }).catch((error) => console.error("[mefi-host] push channel", error));
  };

  const ipcRenderer = {
    invoke(channel, ...args) {
      subscribe();
      counts.invokes += 1;
      return request("ipc_invoke", String(channel), args).then((frame) => {
        const reply = typeof frame === "string" ? JSON.parse(frame) : frame;
        if (!reply.ok) throw new Error(String(reply.error ?? `Error invoking remote method '${channel}'`));
        return bodyOf(reply);
      });
    },
    send(channel, ...args) {
      subscribe();
      request("ipc_send", String(channel), args).catch((error) => console.error("[mefi-host] send", error));
    },
    on(channel, listener) {
      subscribe();
      const key = String(channel);
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(listener);
      return ipcRenderer;
    },
    removeListener(channel, listener) {
      const list = listeners.get(String(channel));
      const at = list ? list.indexOf(listener) : -1;
      if (at >= 0) list.splice(at, 1);
      return ipcRenderer;
    },
  };

  // A dropped file's path (webUtils.getPathForFile): WebView2 keeps it off
  // File objects. The first look at a drop, before any page handler, holds it
  // back and hands its files to the host (postMessageWithAdditionalObjects),
  // which answers with their paths (src/webview2.rs, dropReply below); then
  // the same drop goes on to its target with the same File objects.
  const filePaths = new WeakMap();
  const webUtils = { getPathForFile: (file) => (file && filePaths.get(file)) || null };
  const heldDrops = new Map();
  let nextDrop = 1;
  let tauriQuietUntil = 0;
  window.addEventListener("drop", (event) => {
    const transferIn = event.dataTransfer;
    const files = event.isTrusted && transferIn ? [...transferIn.files] : [];
    if (!files.length || typeof window.chrome?.webview?.postMessageWithAdditionalObjects !== "function") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    for (const type of transferIn.types) {
      if (type !== "Files") {
        try { transfer.setData(type, transferIn.getData(type)); } catch { /* a type the page cannot read */ }
      }
    }
    transfer.dropEffect = transferIn.dropEffect;
    transfer.effectAllowed = transferIn.effectAllowed;
    const init = {
      bubbles: true, cancelable: true, composed: true, dataTransfer: transfer,
      clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
    };
    const target = event.target;
    const id = nextDrop++;
    const release = () => {
      if (!heldDrops.delete(id)) return;
      (target?.isConnected ? target : document.body ?? document).dispatchEvent(new DragEvent("drop", init));
    };
    heldDrops.set(id, { files, release });
    // Without an answer the drop still arrives, only without paths.
    setTimeout(release, 1500);
    try {
      // A string message: Tauri's handler sees it first, cannot parse it as
      // an invoke and says so on the console (kept out of Trace below).
      tauriQuietUntil = Date.now() + 2000;
      window.chrome.webview.postMessageWithAdditionalObjects(`mefi-drop:${id}`, transferIn.files);
    } catch {
      release();
    }
  }, true);

  // Local images (evidence shots, pictures) through the host's file route.
  const fileUrl = (path) => `${location.origin}/__file/${encodeURIComponent(String(path).replace(/\\/g, "/"))}`;

  // ---- accelerators of the application menu (the menu bar itself stays hidden) ----
  let accelerators = [];
  const keyName = (event) => {
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    return key === "+" ? "Plus" : key;
  };
  const matches = (accel, event) => {
    const parts = accel.split("+").map((part) => part.trim()).filter(Boolean);
    const want = { ctrl: false, shift: false, alt: false, key: "" };
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (["cmdorctrl", "commandorcontrol", "ctrl", "control", "cmd", "command"].includes(lower)) want.ctrl = true;
      else if (lower === "shift") want.shift = true;
      else if (lower === "alt" || lower === "option") want.alt = true;
      else want.key = part.length === 1 ? part.toUpperCase() : part;
    }
    // "Plus" also answers to "=", the unshifted key that carries it.
    const key = keyName(event);
    const keyOk = want.key === key || (want.key === "Plus" && key === "=") || (want.key === "=" && key === "Plus");
    const shiftOk = want.key === "Plus" ? true : want.shift === event.shiftKey;
    return keyOk && want.ctrl === (event.ctrlKey || event.metaKey) && shiftOk && want.alt === event.altKey;
  };
  window.addEventListener("keydown", (event) => {
    if (!accelerators.length || event.repeat) return;
    const hit = accelerators.find((entry) => matches(entry.accelerator, event));
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    core().invoke("ipc_menu", { item: hit.id }).catch(() => {});
  }, true);

  // ---- the window's warnings and errors, for Trace (Electron's console-message) ----
  const forward = (level, values, source = "", line = 0) => {
    try {
      const message = values.map((value) => (value instanceof Error ? value.stack || value.message : typeof value === "string" ? value : (() => { try { return JSON.stringify(value); } catch { return String(value); } })())).join(" ");
      core().invoke("ipc_console", { level, message: message.slice(0, 4000), source: String(source).slice(0, 300), line: Number(line) || 0 }).catch(() => {});
    } catch { /* never let reporting break the page */ }
  };
  for (const [method, level] of [["warn", "warning"], ["error", "error"]]) {
    const original = console[method].bind(console);
    console[method] = (...values) => {
      original(...values);
      // Tauri's answer to a drop's message is not the page's error.
      if (Date.now() < tauriQuietUntil && typeof values[0] === "string" && /^(expected value|expected ident|invalid type|missing field|trailing characters|EOF while parsing)/.test(values[0])) return;
      if (window.__TAURI__?.core) forward(level, values);
    };
  }
  window.addEventListener("error", (event) => forward("error", [event.error ?? event.message], event.filename, event.lineno));
  window.addEventListener("unhandledrejection", (event) => forward("error", [event.reason]));

  window.__mefiHost = Object.freeze({
    kind: "tauri",
    fileUrl,
    // What crossed the bridge so far (the host's self-test reads it).
    stats: () => JSON.parse(JSON.stringify({ ...counts, listening: [...listeners.keys()].filter((key) => listeners.get(key).length) })),
    setAccelerators(list) {
      accelerators = Array.isArray(list) ? list.filter((entry) => entry && typeof entry.accelerator === "string") : [];
    },
    // The host's answer to a held drop (src/webview2.rs): one path per file, in order.
    dropReply(id, list) {
      const entry = heldDrops.get(id);
      if (!entry) return;
      entry.files.forEach((file, index) => {
        if (typeof list?.[index] === "string" && list[index]) filePaths.set(file, list[index]);
      });
      entry.release();
    },
    // webContents.executeJavaScript: the host evaluates CODE and gets the value back.
    evaluate(id, code) {
      Promise.resolve()
        .then(() => (0, eval)(code))
        .then(
          (value) => core().invoke("ipc_eval_result", { id, ok: true, value: encode(value).json }),
          (error) => core().invoke("ipc_eval_result", { id, ok: false, value: String(error?.stack || error) }),
        )
        .catch(() => {});
    },
  });

  // ---- preload.cjs, as Electron would run it ----
  const contextBridge = {
    executeInMainWorld: ({ func, args }) => func(...(args ?? [])),
    exposeInMainWorld: (key, value) => Object.defineProperty(window, key, { value, enumerable: true }),
  };
  const preloadRequire = (name) => {
    if (name === "electron") return { contextBridge, ipcRenderer, webUtils };
    throw new Error(`preload.cjs asked for '${name}', which the Rust host does not provide`);
  };
  const preloadModule = { exports: {} };
  (function (require, module, exports, __mefiHostFileUrl) {
/*__MEFI_PRELOAD__*/
  })(preloadRequire, preloadModule, preloadModule.exports, fileUrl);

  if (window.__TAURI__?.core) subscribe();
  else document.addEventListener("DOMContentLoaded", subscribe, { once: true });
})();
