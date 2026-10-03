# Moving Studio to Rust

Started 3 October 2026. The owner asked to move the whole app to Rust and
chose, from three options:

- **Tauri 2, in stages** (not a clean rewrite, not a native Rust UI). The app
  keeps working at every step.
- **The UI stays HTML/JS.** `renderer/` runs unchanged in WebView2, and the 0.5
  `renderer2/` shell stays a web shell. Rust takes the host and, channel by
  channel, the engine.

Repository tooling (`npm run check`, the sync hook, the test runner, the
booklet build) stays in Node: it is not part of the shipped app.

## The three stages

| Stage | What runs where | Done when |
| --- | --- | --- |
| 1. Rust host | `src-tauri` is the app: window, tray, dialogs, the page's bridge, saved-key decryption. `main.cjs` runs unchanged under plain Node as the host's sidecar, behind the same 302 invoke and 39 push channels. | Every row of the parity table below is done, and a portable build ships with Node beside it. |
| 2. Engine to Rust | Channels move into Rust one by one. The host answers a moved channel itself and forwards the rest. One suite of channel contract tests runs against both engines. | No channel is forwarded. |
| 3. No sidecar | The release build, the updater and rollback carry only the Rust host. | `main.cjs` and the Node runtime leave the package. |

The first update from an Electron build to a Tauri build needs a bridge
release: today's rollback helper (`buildApplyScript` in
`scripts/release-updater.mjs`) only watches a staged build whose `main.cjs`
contains `boot-health.json`, which a stage-3 build no longer has.

## How stage 1 is put together

```
WebView2 page (renderer/booklet.html)          Rust host (src-tauri)                    Engine (node main.cjs)
  preload.cjs, unchanged, run by          invoke("ipc_invoke", bytes,             scripts/tauri-electron.cjs:
  src-tauri/src/init.js with a     ──▶    {mefi-ch})  ── named pipe ──▶          Electron's API for main.cjs
  stand-in require("electron")            frames passed as bytes,                 (app, BrowserWindow, ipcMain,
                                   ◀──    one Channel for pushes   ◀──           safeStorage, dialog, tray, ...)
                                          window / tray / dialogs  ◀── calls ──   scripts/tauri-sync-worker.cjs:
                                          DPAPI key, images, ...                  blocking calls (Atomics.wait)
```

- **Choosing the shim.** `main.cjs` requires `scripts/tauri-electron.cjs`
  instead of `electron` when `MEFI_STUDIO_HOST=tauri`. Nothing else in
  `main.cjs` changed: one line, plus the evidence window now gets the same
  `electron` object.
- **The page's bridge.** `src-tauri/src/init.js` is injected at document start
  into Studio's page only. It gives `preload.cjs` `contextBridge`,
  `ipcRenderer` and `webUtils`, then runs it as-is, so `window.mefiStudio` is
  built by the same code under both hosts (`tests/brains_store.test.mjs`
  already ran preload this way).
- **The page's origin.** The page is served at
  `http://mefi.localhost/renderer/booklet.html` by `src-tauri/src/protocol.rs`.
  It serves only what Electron's `file://` page loaded: `renderer/`,
  `assets/` and the catalogs under `data/`. Local pictures come through
  `/__file/<absolute path>` (picture extensions only), which
  `window.__mefiHost.fileUrl` builds; three renderer spots use it when
  present. The page's CSP gains Tauri's IPC endpoint on the way out.
- **userData stays Electron's**: `%APPDATA%\Mefi's Studio AI+`, so
  `settings.json`, `auth.json` and the vault are read where they always were.
  `MEFI_STUDIO_USER_DATA` points a test run at a scratch folder.

### The wire

One frame is one line of JSON (`scripts/host-wire.cjs`,
`src-tauri/src/wire.rs`). The host reads only the head of a frame (`t`,
`id`, `api`) and forwards bodies as bytes, so a whole-board push costs one
scan in Rust and one parse in the page.

| Frame | Direction | Meaning |
| --- | --- | --- |
| `hello` / `welcome` | engine ⇄ host | First frame on each connection, carrying the launch token; `welcome` carries the displays. |
| `invoke` → `result` | host → engine → host | A page invoke and its answer (the answer goes back to the page as JSON text). |
| `send` | host → engine | `ipcRenderer.send` (only `eyes:assistant-sync`). |
| `push` | engine → host | `webContents.send`; the host hands it to the page's one Channel. |
| `event` | host → engine | `window:focus`, `window:close-requested`, `webContents:did-finish-load`, `tray:click`, `menu:click`, ... |
| `call` → `reply` | engine → host → engine | An Electron call that answers (dialogs, the saved-key key, images, idle state). |
| `cast` | engine → host | An Electron call that only acts (window show/hide, tray, overlay icon). |

Electron's IPC carried structured clones, so these travel tagged
(`{ "$mefi": ... }`) and the frame says `tagged: true`: bytes, `Date`,
NaN/Infinity, and `undefined` inside an argument list. The last one matters:
22 handlers are written `(_event, { id = null } = {})`, and JSON's `null`
would skip the default and throw.

Electron answered about 40 calls synchronously (all of `safeStorage`, the
clipboard, idle state, login items, every `nativeImage` method). The shim keeps
window and display state mirrored from the host's events and answers the
rest through a second pipe connection in a worker thread, with the main thread
waiting in `Atomics.wait`.

### Saved API keys

Electron's `safeStorage` on Windows is Chromium's OSCrypt: a random
AES-256-GCM key kept DPAPI-protected in userData's `Local State`
(`os_crypt.encrypted_key`), and ciphertext `v10` + 12-byte nonce + data + tag.
The host unprotects the key (`src-tauri/src/oscrypt.rs`) and the shim runs the
cipher. On 3 October a synthetic round trip passed both ways against Electron
44.4.1, in a scratch app folder: Node read Electron's ciphertext, and Electron
read the shim's. On a fresh install the host writes a key the same way, so an
Electron build can still read what the Rust host saved.

## Building, running, testing

```bash
npm run host:build      # cargo build, target folder outside the checkout
npm run host            # build and run Studio on the Rust host (source run)
npm run host:test       # the host's Rust unit tests
node --test tests/rust_host_bridge.test.mjs   # both halves of the bridge, no Rust needed
```

`scripts/rust-host.mjs` puts Cargo's target folder in
`%LOCALAPPDATA%\MefiStudio\rust-target`, for two reasons. The checkout may
sit in OneDrive, and a Tauri build is about 2 GB. Also, the Windows resource
compiler cannot open a path containing an apostrophe (`Mefi's Studio AI+`), so
`build.rs` copies the icon into the target folder first. It builds with 2 jobs
by default (`MEFI_RUST_JOBS` overrides), because each job can take about 1 GB
of memory.

A source run needs Rust stable (MSVC) and the Visual Studio 2022 Build Tools
C++ workload; WebView2 ships with Windows 11. The engine runs under the `node`
on PATH, or under `MEFI_STUDIO_NODE`, or under a `node.exe` placed beside the
host program (the portable layout).

`--smoke` works as before and is the quickest whole-app check:

```bash
MEFI_STUDIO_USER_DATA=<scratch folder> npm run host -- --smoke
```

It passed on 3 October (45 cards, models present, assistant tick 1, exit 0).

`MEFI_HOST_SELFTEST=<folder>` makes the host, once the page is up, save a
capture of it (`capture.png`) and what crossed the bridge (`selftest.json`:
invokes, channels listened to, pushes received); with
`MEFI_HOST_SELFTEST_TOAST=1` it also shows one notification. On 3 October it
recorded a 1825×1175 capture of the launch screen, 40 invokes, 29 channels
listened to, pushes on five of them, and a toast Windows accepted.

## Inventory: what the shim covers

The full inventory (every Electron member `main.cjs` and its helpers use, with
line numbers) was taken on 3 October 2026. In short:

- `app`: paths, `isPackaged`, version, quit/exit/relaunch with Electron's
  event order (`before-quit` and window `close` may veto), single instance
  (held by the host), login items (HKCU Run, written for the host's own
  program, never `node.exe`).
- `BrowserWindow` (one window) and `webContents`: show/hide/focus/minimize/
  maximize, bounds, title, flash, overlay icon, progress, zoom, reload,
  devtools, `executeJavaScript`, `send`, `ipc.on`, load events, console
  messages. `event.sender` is the same object as `window.webContents` and
  `event.senderFrame` the same as its `mainFrame`, because several handlers
  compare them.
- `ipcMain`: `handle` is a plain property, because `main.cjs` and the
  performance profiler replace it.
- `safeStorage`, `shell`, `dialog`, `clipboard` (text), `screen`,
  `powerMonitor.getSystemIdleState`, `powerSaveBlocker`, `Tray`, `Menu`
  (the tray draws it; the page matches the application menu's accelerators),
  `nativeImage` (PNG size read locally, the rest done by the host with the
  `image` crate, `toBitmap` in BGRA).

## Parity table

| Area | Status | Notes |
| --- | --- | --- |
| Window, page, bridge, pushes | done | smoke passes; launch screen renders |
| Saved API keys (`safeStorage`) | done | round trip with Electron 44 verified |
| Dialogs (open, save, message) | done | rfd; `message` and `detail` are joined; at most 3 buttons |
| Tray and its menu | done, not yet seen live | click, double-click, menu items |
| Close and quit order, tray parking | done | close request → engine decides → `window.destroy` |
| Engine exits when the host dies | done | the shim exits when the pipe closes |
| Login item (Start with Windows) | done, not yet seen live | value name `MefiStudio.StudioAIPlus` |
| Microphone / display capture permission | done | granted without a prompt, as Electron did |
| Local pictures in the page | done | `/__file/` route and `__mefiHost.fileUrl` |
| `capturePage` (Media scene sampler, capture tour) | done | WebView2 `CapturePreview` (`src-tauri/src/webview2.rs`); a rect is cropped in pixels |
| Windows notifications (alerts) | done | WinRT toasts (`src-tauri/src/toast.rs`) under `MefiStudio.StudioAIPlus`, whose display name and icon the host registers in `HKCU\Software\Classes\AppUserModelId` |
| `powerMonitor` suspend/resume/lock/unlock events | done, not yet seen live | power callback + message-only window (`src-tauri/src/power.rs`) |
| YouTube embeds' Referer (Error 153) | done, not yet seen live | WebView2 `WebResourceRequested` adds the same Referer Electron's session did |
| Media browser (`WebContentsView`) | todo | Tauri child webview; opening it reports "not ported" |
| Evidence shots (offscreen second window) | todo | reports "shot not taken" meanwhile |
| Dropped files' paths (`webUtils.getPathForFile`) | todo | WebView2 `postMessageWithAdditionalObjects` |
| Zen's desktop audio without a picker | todo | WebView2 shows its own picker meanwhile |
| Page `localStorage` from the Electron build | todo | read Electron's leveldb once, hand it to the page |
| Renderer crash and hang (`render-process-gone`, `unresponsive`) | done, not yet seen live | WebView2 `ProcessFailed`; `did-fail-load` is still todo |
| DevTools protocol (`debugger.sendCommand`) | done | WebView2 `CallDevToolsProtocolMethod` |
| Portable package with Node, release workflow, updater, rollback | todo | stage 1's last row |

## Rules for this work

- The engine's files are shared with the Electron build until stage 3, so a
  change to `main.cjs` or `preload.cjs` must keep both hosts working. The
  Electron build is still what ships.
- Keep `tests/rust_host_bridge.test.mjs` green; it needs no Rust.
- A channel moved into Rust in stage 2 keeps its exact payloads, so the page
  and the tests that pin them do not change.
