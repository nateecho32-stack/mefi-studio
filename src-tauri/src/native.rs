//! What the engine's Electron objects ask the host for (scripts/tauri-electron.cjs).
//! `call` answers; `cast` only acts. Names follow the shim's: window.*,
//! dialog.*, shell.*, tray.*, image.*, power.*, app.*.

use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionKind, PermissionResponse};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, UserAttentionType, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;

use crate::engine::{engine, Engine};

pub const MAIN: &str = "main";
const PAGE_HOST: &str = "mefi.localhost";

// ---- values with tags (scripts/host-wire.cjs) ----

pub fn bytes_value(bytes: &[u8]) -> Value {
    json!({ "$mefi": "bytes", "b64": STANDARD.encode(bytes) })
}

fn bytes_arg(value: &Value) -> Option<Vec<u8>> {
    if value.get("$mefi").and_then(Value::as_str) == Some("bytes") {
        return value.get("b64").and_then(Value::as_str).and_then(|b64| STANDARD.decode(b64).ok());
    }
    None
}

pub fn holds_tag(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.contains_key("$mefi") || map.values().any(holds_tag),
        Value::Array(list) => list.iter().any(holds_tag),
        _ => false,
    }
}

fn arg(args: &Value, index: usize) -> &Value {
    args.get(index).unwrap_or(&Value::Null)
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

// ---- host state the engine's objects point at ----

#[derive(Default)]
struct HostState {
    accelerators: Vec<Value>,
    blockers: HashMap<u64, isize>,
    page_zoom: f64,
}

fn state() -> &'static Mutex<HostState> {
    static STATE: OnceLock<Mutex<HostState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(HostState { page_zoom: 1.0, ..Default::default() }))
}

// ---- calls ----

pub async fn call(engine: &Arc<Engine>, api: &str, args: Value) -> Result<Value, String> {
    let app = &engine.app;
    let first = arg(&args, 0).clone();
    match api {
        "safeStorage.key" => {
            let key = crate::oscrypt::key(&engine.studio.user_data(app))?;
            Ok(json!(STANDARD.encode(key)))
        }
        "dialog.open" => open_dialog(app, &first).await,
        "dialog.save" => save_dialog(app, &first).await,
        "dialog.message" => message_dialog(app, &first).await,
        "shell.openExternal" => {
            let url = text(&first, "url").unwrap_or_default();
            if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:")) {
                return Err(format!("refused to open '{url}' outside Studio"));
            }
            app.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())?;
            Ok(Value::Null)
        }
        "shell.openPath" => {
            let path = text(&first, "path").unwrap_or_default();
            Ok(json!(match app.opener().open_path(path, None::<&str>) {
                Ok(()) => String::new(),
                Err(error) => error.to_string(),
            }))
        }
        "shell.trashItem" => Err("moving files to the Recycle Bin is not ported to the Rust host yet".into()),
        "notification.show" => {
            let id = first.get("id").and_then(Value::as_u64).unwrap_or(0);
            let silent = first.get("silent").and_then(Value::as_bool).unwrap_or(false);
            crate::toast::show(engine, id, text(&first, "title").unwrap_or_default(), text(&first, "body").unwrap_or_default(), silent)?;
            Ok(Value::Null)
        }
        "webContents.executeJavaScript" => execute_javascript(engine, text(&first, "code").unwrap_or_default()).await,
        "webContents.capturePage" => capture_page(app, &first).await,
        "webContents.devtoolsCommand" => {
            let window = main_window(app).ok_or("Studio's window is not open")?;
            let method = text(&first, "method").unwrap_or_default().to_string();
            crate::webview2::devtools_command(&window, method, first.get("params").cloned().unwrap_or(json!({}))).await
        }
        "clipboard.readText" => Ok(json!(platform::clipboard_read_text().unwrap_or_default())),
        "screen.cursor" => {
            let point = app.cursor_position().map_err(|error| error.to_string())?;
            Ok(json!({ "x": point.x.round() as i64, "y": point.y.round() as i64 }))
        }
        "power.idleTime" => Ok(json!(platform::idle_seconds())),
        "power.idleState" => {
            let threshold = first.get("threshold").and_then(Value::as_f64).unwrap_or(0.0);
            Ok(json!(if platform::screen_locked() {
                "locked"
            } else if platform::idle_seconds() as f64 >= threshold {
                "idle"
            } else {
                "active"
            }))
        }
        "image.size" => {
            let bytes = bytes_arg(&first).ok_or("image bytes missing")?;
            let (width, height) = image::ImageReader::new(Cursor::new(&bytes))
                .with_guessed_format()
                .map_err(|error| error.to_string())?
                .into_dimensions()
                .map_err(|error| error.to_string())?;
            Ok(json!({ "width": width, "height": height }))
        }
        "image.resize" | "image.crop" | "image.encode" | "image.bitmap" => image_op(api, &first, arg(&args, 1)),
        "app.loginItem.get" => platform::login_item_get(&first),
        "app.loginItem.set" => platform::login_item_set(&first).map(|_| Value::Null),
        "app.metrics" => Ok(json!([{
            "pid": std::process::id(),
            "type": "Browser",
            "cpu": { "percentCPUUsage": 0, "idleWakeupsPerSecond": 0 },
            "memory": { "workingSetSize": platform::working_set_kb(), "peakWorkingSetSize": 0 },
        }])),
        "app.relaunch" => {
            let args = first.get("args").and_then(Value::as_array).map(|list| list.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<_>>());
            if let Ok(mut slot) = engine.relaunch.lock() {
                *slot = Some(args);
            }
            Ok(Value::Null)
        }
        other => Err(format!("the Rust host has no '{other}' yet")),
    }
}

// ---- casts ----

pub fn cast(engine: &Arc<Engine>, api: &str, args: Value) {
    let app = engine.app.clone();
    let body = arg(&args, 0).clone();
    let result: Result<(), String> = (|| {
        match api {
            "window.create" => create_window(engine, &body),
            "window.load" => load_page(engine, &body),
            "app.setAppUserModelId" => {
                let id = text(&body, "id").unwrap_or_default();
                platform::set_app_user_model_id(id);
                let icon = engine.studio.root.join("assets").join("icon-256.png");
                crate::toast::set_app_id(id, &engine.studio.product, Some(&icon));
                Ok(())
            }
            "menu.setApplication" => {
                let list = accelerators(body.get("items").unwrap_or(&Value::Null));
                if let Ok(mut host) = state().lock() {
                    host.accelerators = list;
                }
                push_accelerators(&app);
                Ok(())
            }
            "tray.create" | "tray.image" | "tray.tooltip" | "tray.menu" | "tray.destroy" => tray(&app, api, &body),
            "power.block" => {
                let id = body.get("id").and_then(Value::as_u64).unwrap_or(0);
                let display = text(&body, "type") == Some("prevent-display-sleep");
                if let Some(handle) = platform::power_request(display) {
                    if let Ok(mut host) = state().lock() {
                        host.blockers.insert(id, handle);
                    }
                }
                Ok(())
            }
            "power.unblock" => {
                let id = body.get("id").and_then(Value::as_u64).unwrap_or(0);
                let handle = state().lock().ok().and_then(|mut host| host.blockers.remove(&id));
                if let Some(handle) = handle {
                    platform::power_release(handle);
                }
                Ok(())
            }
            "clipboard.writeText" => platform::clipboard_write_text(text(&body, "text").unwrap_or_default()),
            "shell.showItemInFolder" => app.opener().reveal_item_in_dir(text(&body, "path").unwrap_or_default()).map_err(|error| error.to_string()),
            "shell.beep" => Ok(()),
            "dialog.error" => {
                let title = text(&body, "title").unwrap_or_default().to_string();
                let content = text(&body, "content").unwrap_or_default().to_string();
                std::thread::spawn(move || {
                    rfd::MessageDialog::new().set_level(rfd::MessageLevel::Error).set_title(&title).set_description(&content).show();
                });
                Ok(())
            }
            "notification.close" => {
                crate::toast::close(body.get("id").and_then(Value::as_u64).unwrap_or(0));
                Ok(())
            }
            _ if api.starts_with("window.") => window_cast(engine, api, &body),
            other => Err(format!("the Rust host has no '{other}' yet")),
        }
    })();
    if let Err(error) = result {
        eprintln!("[mefi-host] {api}: {error}");
    }
}

// ---- the window ----

fn parse_color(text: &str) -> Option<tauri::window::Color> {
    let hex = text.strip_prefix('#')?;
    let value = u32::from_str_radix(hex, 16).ok()?;
    match hex.len() {
        6 => Some(tauri::window::Color((value >> 16) as u8, (value >> 8) as u8, value as u8, 255)),
        8 => Some(tauri::window::Color((value >> 16) as u8, (value >> 8) as u8, value as u8, (value >> 24) as u8)),
        _ => None,
    }
}

pub fn page_origin() -> String {
    format!("http://{PAGE_HOST}")
}

fn is_page_url(url: &Url) -> bool {
    url.host_str() == Some(PAGE_HOST) && url.path() == "/renderer/booklet.html"
}

fn init_script(engine: &Engine) -> String {
    let preload = std::fs::read_to_string(engine.studio.root.join("preload.cjs")).unwrap_or_else(|error| {
        format!("console.error({});", wire_string(&format!("[mefi-host] preload.cjs could not be read: {error}")))
    });
    include_str!("init.js").replace("/*__MEFI_PRELOAD__*/", &preload)
}

fn wire_string(text: &str) -> String {
    crate::wire::json_string(text)
}

fn create_window(engine: &Arc<Engine>, options: &Value) -> Result<(), String> {
    let app = engine.app.clone();
    if main_window(&app).is_some() {
        return Ok(());
    }
    let width = options.get("width").and_then(Value::as_f64).unwrap_or(1460.0);
    let height = options.get("height").and_then(Value::as_f64).unwrap_or(940.0);
    let mut builder = WebviewWindowBuilder::new(&app, MAIN, WebviewUrl::App("index.html".into()))
        .title(text(options, "title").filter(|t| !t.is_empty()).unwrap_or("Mefi's Studio AI+"))
        .inner_size(width, height)
        .visible(options.get("show").and_then(Value::as_bool).unwrap_or(true))
        .initialization_script(init_script(engine))
        // HTML drop events reach the page (Tauri's own handler would take them).
        .disable_drag_drop_handler()
        .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required");
    if let (Some(min_w), Some(min_h)) = (options.get("minWidth").and_then(Value::as_f64), options.get("minHeight").and_then(Value::as_f64)) {
        builder = builder.min_inner_size(min_w, min_h);
    }
    if let (Some(x), Some(y)) = (options.get("x").and_then(Value::as_f64), options.get("y").and_then(Value::as_f64)) {
        builder = builder.position(x, y);
    } else {
        builder = builder.center();
    }
    if let Some(color) = text(options, "backgroundColor").and_then(parse_color) {
        builder = builder.background_color(color);
    }
    if let Some(icon) = text(options, "icon").and_then(|path| std::fs::read(path).ok()).and_then(|bytes| Image::from_bytes(&bytes).ok()) {
        builder = builder.icon(icon).map_err(|error| error.to_string())?;
    }
    // Only Studio's own page loads in this window (Electron's will-navigate
    // guard); the boot page is where it starts.
    builder = builder.on_navigation(|url| is_page_url(url) || url.host_str() == Some("tauri.localhost") || url.scheme() == "tauri");
    // Electron's main session granted these without asking (Zen's audio input,
    // the desktop-audio capture, Paste); WebView2 would prompt every time.
    builder = builder.on_permission_request(|_webview, kind| match kind {
        PermissionKind::Microphone | PermissionKind::DisplayCapture | PermissionKind::ClipboardRead => PermissionResponse::Allow,
        _ => PermissionResponse::Default,
    });
    let opener_app = app.clone();
    builder = builder.on_new_window(move |url, _features| {
        if matches!(url.scheme(), "http" | "https") {
            let _ = opener_app.opener().open_url(url.as_str(), None::<&str>);
        }
        NewWindowResponse::Deny
    });
    let load_engine = engine.clone();
    builder = builder.on_page_load(move |window, payload| {
        if !is_page_url(payload.url()) {
            return;
        }
        let url = payload.url().to_string();
        match payload.event() {
            PageLoadEvent::Started => {
                load_engine.clear_push_channel();
                load_engine.event("webContents:did-start-navigation", json!({ "url": url }));
            }
            PageLoadEvent::Finished => {
                push_accelerators(window.app_handle());
                load_engine.event("webContents:did-finish-load", json!({ "url": url }));
                if let Some(dir) = std::env::var_os("MEFI_HOST_SELFTEST").map(PathBuf::from) {
                    self_test(load_engine.clone(), dir);
                }
            }
        }
    });
    let window = builder.build().map_err(|error| format!("could not open Studio's window: {error}"))?;
    let failure_engine = engine.clone();
    crate::webview2::install(&window, move |name, body| failure_engine.event(name, body));
    let events_engine = engine.clone();
    let watched = window.clone();
    window.on_window_event(move |event| window_event(&events_engine, &watched, event));
    send_state(engine, &window);
    Ok(())
}

fn window_event(engine: &Arc<Engine>, window: &WebviewWindow, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            // The engine's "close" listeners decide (tray parking, the
            // question before closing); it answers with window.destroy.
            if !engine.is_exiting() {
                api.prevent_close();
                engine.event("window:close-requested", Value::Null);
            }
        }
        WindowEvent::Focused(focused) => {
            send_state(engine, window);
            engine.event(if *focused { "window:focus" } else { "window:blur" }, Value::Null);
        }
        WindowEvent::Resized(_) => {
            let was = state_flag(window);
            send_state(engine, window);
            let now = window.is_minimized().unwrap_or(false);
            if now && !was.0 {
                engine.event("window:minimize", Value::Null);
            } else if !now && was.0 {
                engine.event("window:restore", Value::Null);
            }
            engine.event("window:resize", bounds_state(window));
        }
        WindowEvent::Moved(_) => engine.event("window:move", bounds_state(window)),
        _ => {}
    }
}

fn last_minimized() -> &'static Mutex<bool> {
    static FLAG: OnceLock<Mutex<bool>> = OnceLock::new();
    FLAG.get_or_init(|| Mutex::new(false))
}

fn state_flag(window: &WebviewWindow) -> (bool,) {
    let mut slot = last_minimized().lock().unwrap_or_else(|poison| poison.into_inner());
    let before = *slot;
    *slot = window.is_minimized().unwrap_or(false);
    (before,)
}

fn bounds_state(window: &WebviewWindow) -> Value {
    let scale = window.scale_factor().unwrap_or(1.0);
    let outer_pos = window.outer_position().map(|p| p.to_logical::<f64>(scale)).unwrap_or(LogicalPosition::new(0.0, 0.0));
    let outer_size = window.outer_size().map(|s| s.to_logical::<f64>(scale)).unwrap_or(LogicalSize::new(0.0, 0.0));
    let inner_pos = window.inner_position().map(|p| p.to_logical::<f64>(scale)).unwrap_or(outer_pos);
    let inner_size = window.inner_size().map(|s| s.to_logical::<f64>(scale)).unwrap_or(outer_size);
    let rect = |x: f64, y: f64, w: f64, h: f64| json!({ "x": x.round(), "y": y.round(), "width": w.round(), "height": h.round() });
    json!({
        "bounds": rect(outer_pos.x, outer_pos.y, outer_size.width, outer_size.height),
        "contentBounds": rect(inner_pos.x, inner_pos.y, inner_size.width, inner_size.height),
    })
}

fn send_state(engine: &Arc<Engine>, window: &WebviewWindow) {
    let mut body = bounds_state(window);
    body["visible"] = json!(window.is_visible().unwrap_or(false));
    body["focused"] = json!(window.is_focused().unwrap_or(false));
    body["minimized"] = json!(window.is_minimized().unwrap_or(false));
    body["maximized"] = json!(window.is_maximized().unwrap_or(false));
    body["fullscreen"] = json!(window.is_fullscreen().unwrap_or(false));
    engine.event("window:state", body);
}

fn load_page(engine: &Arc<Engine>, target: &Value) -> Result<(), String> {
    let window = main_window(&engine.app).ok_or("Studio's window is not open")?;
    let url = if let Some(file) = text(target, "file") {
        let relative = Path::new(file)
            .strip_prefix(&engine.studio.root)
            .map_err(|_| format!("{file} is not inside Studio's folder"))?
            .to_string_lossy()
            .replace('\\', "/");
        let mut url = Url::parse(&format!("{}/{relative}", page_origin())).map_err(|error| error.to_string())?;
        if let Some(query) = target.get("query").and_then(Value::as_object) {
            let mut pairs = url.query_pairs_mut();
            for (key, value) in query {
                pairs.append_pair(key, &value.as_str().map(String::from).unwrap_or_else(|| value.to_string()));
            }
        }
        url
    } else {
        Url::parse(text(target, "url").unwrap_or_default()).map_err(|error| error.to_string())?
    };
    window.navigate(url).map_err(|error| error.to_string())
}

fn window_cast(engine: &Arc<Engine>, api: &str, body: &Value) -> Result<(), String> {
    let window = match main_window(&engine.app) {
        Some(window) => window,
        None => return Ok(()),
    };
    let on = body.get("on").and_then(Value::as_bool).unwrap_or(false);
    let done = |result: tauri::Result<()>| result.map_err(|error| error.to_string());
    match api {
        "window.show" => {
            done(window.show())?;
            if window.is_minimized().unwrap_or(false) {
                done(window.unminimize())?;
            }
            if body.get("focus").and_then(Value::as_bool).unwrap_or(true) {
                let _ = window.set_focus();
            }
            engine.event("window:show", Value::Null);
        }
        "window.hide" => {
            done(window.hide())?;
            engine.event("window:hide", Value::Null);
        }
        "window.focus" => done(window.set_focus())?,
        "window.minimize" => done(window.minimize())?,
        "window.restore" => {
            done(window.unminimize())?;
            done(window.show())?;
        }
        "window.maximize" => {
            done(window.maximize())?;
            done(window.show())?;
            engine.event("window:maximize", Value::Null);
        }
        "window.unmaximize" => {
            done(window.unmaximize())?;
            engine.event("window:unmaximize", Value::Null);
        }
        "window.fullscreen" => done(window.set_fullscreen(on))?,
        "window.setTitle" => done(window.set_title(text(body, "title").unwrap_or_default()))?,
        "window.setBounds" => {
            let get = |key: &str| body.get(key).and_then(Value::as_f64);
            if let (Some(w), Some(h)) = (get("width"), get("height")) {
                done(window.set_size(LogicalSize::new(w, h)))?;
            }
            if let (Some(x), Some(y)) = (get("x"), get("y")) {
                done(window.set_position(LogicalPosition::new(x, y)))?;
            }
        }
        "window.center" => done(window.center())?,
        "window.flash" => done(window.request_user_attention(if on { Some(UserAttentionType::Informational) } else { None }))?,
        "window.progress" => {
            let value = body.get("value").and_then(Value::as_f64).unwrap_or(-1.0);
            let state = if value < 0.0 {
                tauri::window::ProgressBarState { status: Some(tauri::window::ProgressBarStatus::None), progress: None }
            } else {
                tauri::window::ProgressBarState { status: Some(tauri::window::ProgressBarStatus::Normal), progress: Some((value.min(1.0) * 100.0) as u64) }
            };
            done(window.set_progress_bar(state))?;
        }
        "window.overlay" => {
            let image = body.get("png").and_then(bytes_arg).and_then(|png| Image::from_bytes(&png).ok());
            done(window.set_overlay_icon(image))?;
        }
        "window.skipTaskbar" => done(window.set_skip_taskbar(on))?,
        "window.alwaysOnTop" => done(window.set_always_on_top(on))?,
        "window.destroy" => {
            done(window.destroy())?;
        }
        "window.setZoom" => {
            let factor = body.get("factor").and_then(Value::as_f64).unwrap_or(1.0);
            if let Ok(mut host) = state().lock() {
                host.page_zoom = factor;
            }
            done(window.set_zoom(factor))?;
        }
        "window.reload" => done(window.reload())?,
        "window.devtools" => {
            let toggle = body.get("toggle").and_then(Value::as_bool).unwrap_or(false);
            let open = body.get("open").and_then(Value::as_bool).unwrap_or(false);
            if (toggle && !window.is_devtools_open()) || (!toggle && open) {
                window.open_devtools();
            } else {
                window.close_devtools();
            }
        }
        other => return Err(format!("the Rust host has no '{other}' yet")),
    }
    Ok(())
}

/// MEFI_HOST_SELFTEST=<folder>: once the page is up, capture it, read what
/// crossed the bridge, and (MEFI_HOST_SELFTEST_TOAST=1) show one notification.
/// Writes capture.png and selftest.json there. A diagnostic, never on by default.
fn self_test(engine: Arc<Engine>, dir: PathBuf) {
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.set(()).is_err() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(8)).await;
        let Some(window) = main_window(&engine.app) else { return };
        let mut report = json!({ "at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) });
        #[cfg(windows)]
        match crate::webview2::capture_png(&window).await {
            Ok(png) => {
                report["capture"] = json!({ "bytes": png.len() });
                let _ = std::fs::write(dir.join("capture.png"), &png);
            }
            Err(error) => report["capture"] = json!({ "error": error }),
        }
        report["page"] = execute_javascript(&engine, "window.__mefiHost.stats()").await.unwrap_or_else(|error| json!({ "error": error }));
        // One page request that the engine answers from the OpenCode store
        // (which Rust reads now): sizes only, never contents.
        report["eyesState"] = execute_javascript(
            &engine,
            "window.mefiStudio.eyesState().then((r) => ({ ok: r.ok, sessions: r.sessions?.length ?? null, changes: r.changes?.length ?? null, todos: r.todos?.length ?? null, error: r.error ?? null }))",
        )
        .await
        .unwrap_or_else(|error| json!({ "error": error }));
        // And one answered by a module function that moved (worktrees.listWorktrees).
        // The Worktrees page needs an open project: the Studio folder itself.
        let open_and_list = format!(
            "window.mefiStudio.projectsAddPath({}).then(() => window.mefiStudio.worktreesList()).then(async (r) => {{ const files = await window.mefiStudio.projectFiles({{ query: \"rust\", limit: 5 }}); return {{ ok: r.ok, repo: r.repo ?? null, rows: r.rows?.length ?? null, error: r.error ?? null, files: files.ok ? files.files.length : files.error, scanned: files.scanned ?? null }}; }})",
            wire_string(&engine.studio.root.to_string_lossy())
        );
        report["worktrees"] = execute_javascript(&engine, &open_and_list)
        .await
        .unwrap_or_else(|error| json!({ "error": error }));
        #[cfg(windows)]
        if std::env::var("MEFI_HOST_SELFTEST_TOAST").as_deref() == Ok("1") {
            report["toast"] = json!(crate::toast::show(&engine, 9_000_000, "Mefi's Studio AI+", "Rust host self-test: notifications work.", true).err());
        }
        report["rustCalls"] = json!(crate::engine::rust_calls().lock().map(|calls| calls.clone()).unwrap_or_default());
        let _ = std::fs::write(dir.join("selftest.json"), report.to_string());
    });
}

/// Electron's capturePage([rect]): the rect is in DIPs, the capture in pixels.
async fn capture_page(app: &AppHandle, rect: &Value) -> Result<Value, String> {
    let window = main_window(app).ok_or("Studio's window is not open")?;
    let png = crate::webview2::capture_png(&window).await?;
    let Some(rect) = rect.as_object() else {
        return Ok(bytes_value(&png));
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let get = |key: &str| (rect.get(key).and_then(Value::as_f64).unwrap_or(0.0) * scale).round().max(0.0);
    let crop = json!({ "x": get("x"), "y": get("y"), "width": get("width").max(1.0), "height": get("height").max(1.0) });
    let out = image_op("image.crop", &bytes_value(&png), &crop)?;
    Ok(out.get("png").cloned().unwrap_or(Value::Null))
}

async fn execute_javascript(engine: &Arc<Engine>, code: &str) -> Result<Value, String> {
    let window = main_window(&engine.app).ok_or("Studio's window is not open")?;
    let id = rand_id();
    let (tx, rx) = tokio::sync::oneshot::channel();
    engine.evals.lock().map_err(|_| "eval state poisoned")?.insert(id, tx);
    let script = format!("window.__mefiHost && window.__mefiHost.evaluate({id}, {})", wire_string(code));
    window.eval(script).map_err(|error| error.to_string())?;
    let answer = tokio::time::timeout(Duration::from_secs(60), rx).await;
    engine.evals.lock().ok().map(|mut map| map.remove(&id));
    match answer {
        Ok(Ok(Ok(json_text))) => Ok(serde_json::from_str(&json_text).unwrap_or(Value::Null)),
        Ok(Ok(Err(error))) => Err(error),
        _ => Err("the page did not answer executeJavaScript within 60 s".into()),
    }
}

fn rand_id() -> u64 {
    let mut bytes = [0u8; 6];
    let _ = getrandom::fill(&mut bytes);
    bytes.iter().fold(0u64, |acc, byte| (acc << 8) | *byte as u64)
}

// ---- application menu accelerators (matched by the page, src/init.js) ----

fn accelerators(items: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    fn walk(items: &Value, out: &mut Vec<Value>) {
        for item in items.as_array().into_iter().flatten() {
            if item.get("visible").and_then(Value::as_bool) == Some(false) && item.get("accelerator").map_or(true, Value::is_null) {
                continue;
            }
            let role = text(item, "role").unwrap_or_default().to_ascii_lowercase();
            let accelerator = text(item, "accelerator").map(String::from).or_else(|| match role.as_str() {
                "toggledevtools" => Some("CmdOrCtrl+Shift+I".into()),
                "togglefullscreen" => Some("F11".into()),
                "reload" => Some("CmdOrCtrl+R".into()),
                "forcereload" => Some("CmdOrCtrl+Shift+R".into()),
                _ => None,
            });
            if let (Some(accelerator), Some(id)) = (accelerator, item.get("id").and_then(Value::as_u64)) {
                out.push(json!({ "id": id, "accelerator": accelerator }));
            }
            walk(item.get("submenu").unwrap_or(&Value::Null), out);
        }
    }
    walk(items, &mut out);
    out
}

fn push_accelerators(app: &AppHandle) {
    let list = state().lock().map(|host| host.accelerators.clone()).unwrap_or_default();
    if let Some(window) = main_window(app) {
        let _ = window.eval(format!("window.__mefiHost && window.__mefiHost.setAccelerators({})", Value::Array(list)));
    }
}

// ---- tray ----

fn tray_id(body: &Value) -> String {
    format!("tray-{}", body.get("id").and_then(Value::as_u64).unwrap_or(0))
}

fn menu_items(app: &AppHandle, items: &Value) -> tauri::Result<Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>>> {
    let mut out: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();
    for item in items.as_array().into_iter().flatten() {
        if item.get("visible").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        let id = item.get("id").and_then(Value::as_u64).unwrap_or(0).to_string();
        let label = text(item, "label").unwrap_or_default();
        let enabled = item.get("enabled").and_then(Value::as_bool).unwrap_or(true);
        match text(item, "type").unwrap_or("normal") {
            "separator" => out.push(Box::new(PredefinedMenuItem::separator(app)?)),
            "checkbox" | "radio" => out.push(Box::new(CheckMenuItem::with_id(app, id, label, enabled, item.get("checked").and_then(Value::as_bool).unwrap_or(false), None::<&str>)?)),
            "submenu" => {
                let children = menu_items(app, item.get("submenu").unwrap_or(&Value::Null))?;
                let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = children.iter().map(|child| child.as_ref()).collect();
                out.push(Box::new(Submenu::with_id_and_items(app, id, label, enabled, &refs)?));
            }
            _ => out.push(Box::new(MenuItem::with_id(app, id, label, enabled, None::<&str>)?)),
        }
    }
    Ok(out)
}

fn tray(app: &AppHandle, api: &str, body: &Value) -> Result<(), String> {
    let id = tray_id(body);
    let error = |error: tauri::Error| error.to_string();
    match api {
        "tray.create" => {
            let numeric = body.get("id").and_then(Value::as_u64).unwrap_or(0);
            let mut builder = TrayIconBuilder::with_id(&id).show_menu_on_left_click(false).on_tray_icon_event(move |tray, event| {
                let engine = engine(tray.app_handle());
                match event {
                    TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => engine.event("tray:click", json!({ "id": numeric })),
                    TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => engine.event("tray:double-click", json!({ "id": numeric })),
                    _ => {}
                }
            });
            if let Some(image) = body.get("png").and_then(bytes_arg).and_then(|png| Image::from_bytes(&png).ok()) {
                builder = builder.icon(image);
            } else if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            builder.build(app).map_err(error)?;
        }
        "tray.tooltip" => {
            if let Some(tray) = app.tray_by_id(&id) {
                tray.set_tooltip(Some(text(body, "text").unwrap_or_default())).map_err(error)?;
            }
        }
        "tray.image" => {
            if let Some(tray) = app.tray_by_id(&id) {
                let image = body.get("png").and_then(bytes_arg).and_then(|png| Image::from_bytes(&png).ok());
                tray.set_icon(image).map_err(error)?;
            }
        }
        "tray.menu" => {
            if let Some(tray) = app.tray_by_id(&id) {
                let items = menu_items(app, body.get("items").unwrap_or(&Value::Null)).map_err(error)?;
                let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items.iter().map(|item| item.as_ref()).collect();
                let menu = Menu::with_items(app, &refs).map_err(error)?;
                tray.set_menu(Some(menu)).map_err(error)?;
            }
        }
        "tray.destroy" => {
            let _ = app.remove_tray_by_id(&id);
        }
        _ => {}
    }
    Ok(())
}

// ---- dialogs ----

fn file_dialog(app: &AppHandle, options: &Value) -> rfd::AsyncFileDialog {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(title) = text(options, "title") {
        dialog = dialog.set_title(title);
    }
    if let Some(default) = text(options, "defaultPath").filter(|path| !path.is_empty()) {
        let path = Path::new(default);
        if path.is_dir() {
            dialog = dialog.set_directory(path);
        } else {
            if let Some(parent) = path.parent().filter(|parent| parent.is_dir()) {
                dialog = dialog.set_directory(parent);
            }
            if let Some(name) = path.file_name() {
                dialog = dialog.set_file_name(name.to_string_lossy());
            }
        }
    }
    for filter in options.get("filters").and_then(Value::as_array).into_iter().flatten() {
        let name = text(filter, "name").unwrap_or("Files");
        let extensions: Vec<String> = filter
            .get("extensions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(String::from)
            .collect();
        if !extensions.is_empty() {
            dialog = dialog.add_filter(name, &extensions);
        }
    }
    if let Some(window) = main_window(app) {
        dialog = dialog.set_parent(&window);
    }
    dialog
}

async fn open_dialog(app: &AppHandle, options: &Value) -> Result<Value, String> {
    let properties: Vec<&str> = options.get("properties").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect();
    let folders = properties.contains(&"openDirectory");
    let many = properties.contains(&"multiSelections");
    let dialog = file_dialog(app, options);
    let picked: Vec<PathBuf> = match (folders, many) {
        (true, true) => dialog.pick_folders().await.unwrap_or_default().into_iter().map(|h| h.path().to_path_buf()).collect(),
        (true, false) => dialog.pick_folder().await.into_iter().map(|h| h.path().to_path_buf()).collect(),
        (false, true) => dialog.pick_files().await.unwrap_or_default().into_iter().map(|h| h.path().to_path_buf()).collect(),
        (false, false) => dialog.pick_file().await.into_iter().map(|h| h.path().to_path_buf()).collect(),
    };
    Ok(json!({ "canceled": picked.is_empty(), "filePaths": picked.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>() }))
}

async fn save_dialog(app: &AppHandle, options: &Value) -> Result<Value, String> {
    let picked = file_dialog(app, options).save_file().await.map(|h| h.path().to_path_buf());
    Ok(match picked {
        Some(path) => json!({ "canceled": false, "filePath": path.to_string_lossy() }),
        None => json!({ "canceled": true, "filePath": "" }),
    })
}

async fn message_dialog(app: &AppHandle, options: &Value) -> Result<Value, String> {
    let buttons: Vec<String> = options.get("buttons").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(String::from).collect();
    // Electron's default cancelId: the button named Cancel or No, else the first.
    let cancel = options
        .get("cancelId")
        .and_then(Value::as_u64)
        .map(|id| id as usize)
        .or_else(|| buttons.iter().position(|label| matches!(label.to_ascii_lowercase().as_str(), "cancel" | "no")))
        .unwrap_or(0);
    let level = match text(options, "type") {
        Some("error") => rfd::MessageLevel::Error,
        Some("warning") | Some("question") => rfd::MessageLevel::Warning,
        _ => rfd::MessageLevel::Info,
    };
    let message = text(options, "message").unwrap_or_default();
    let detail = text(options, "detail").unwrap_or_default();
    let description = if detail.is_empty() { message.to_string() } else { format!("{message}\n\n{detail}") };
    let shown = match buttons.len() {
        0 => rfd::MessageButtons::Ok,
        1 => rfd::MessageButtons::OkCustom(buttons[0].clone()),
        2 => rfd::MessageButtons::OkCancelCustom(buttons[0].clone(), buttons[1].clone()),
        _ => rfd::MessageButtons::YesNoCancelCustom(buttons[0].clone(), buttons[1].clone(), buttons[2].clone()),
    };
    let mut dialog = rfd::AsyncMessageDialog::new()
        .set_level(level)
        .set_title(text(options, "title").unwrap_or("Mefi's Studio AI+"))
        .set_description(description)
        .set_buttons(shown);
    if let Some(window) = main_window(app) {
        dialog = dialog.set_parent(&window);
    }
    let response = match dialog.show().await {
        rfd::MessageDialogResult::Custom(label) => buttons.iter().position(|b| *b == label).unwrap_or(cancel),
        rfd::MessageDialogResult::Ok | rfd::MessageDialogResult::Yes => 0,
        rfd::MessageDialogResult::No => 1.min(buttons.len().saturating_sub(1)),
        rfd::MessageDialogResult::Cancel => cancel,
    };
    Ok(json!({ "response": response, "checkboxChecked": false }))
}

// ---- images (Electron's nativeImage work) ----

fn image_op(api: &str, bytes: &Value, options: &Value) -> Result<Value, String> {
    let bytes = bytes_arg(bytes).ok_or("image bytes missing")?;
    let picture = image::load_from_memory(&bytes).map_err(|error| format!("unreadable image: {error}"))?;
    let png = |picture: &image::DynamicImage| -> Result<Vec<u8>, String> {
        let mut out = Vec::new();
        picture.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png).map_err(|error| error.to_string())?;
        Ok(out)
    };
    match api {
        "image.resize" => {
            let (w0, h0) = (picture.width().max(1) as f64, picture.height().max(1) as f64);
            let width = options.get("width").and_then(Value::as_f64);
            let height = options.get("height").and_then(Value::as_f64);
            let (w, h) = match (width, height) {
                (Some(w), Some(h)) => (w, h),
                (Some(w), None) => (w, (w * h0 / w0).round()),
                (None, Some(h)) => ((h * w0 / h0).round(), h),
                (None, None) => (w0, h0),
            };
            let filter = match text(options, "quality") {
                Some("best") => image::imageops::FilterType::Lanczos3,
                Some("better") => image::imageops::FilterType::CatmullRom,
                _ => image::imageops::FilterType::Triangle,
            };
            let out = picture.resize_exact(w.max(1.0) as u32, h.max(1.0) as u32, filter);
            Ok(json!({ "png": bytes_value(&png(&out)?), "width": out.width(), "height": out.height() }))
        }
        "image.crop" => {
            let get = |key: &str| options.get(key).and_then(Value::as_f64).unwrap_or(0.0).max(0.0) as u32;
            let out = picture.crop_imm(get("x"), get("y"), get("width").max(1), get("height").max(1));
            Ok(json!({ "png": bytes_value(&png(&out)?), "width": out.width(), "height": out.height() }))
        }
        "image.encode" => {
            if text(options, "format") == Some("jpeg") {
                let quality = options.get("quality").and_then(Value::as_u64).unwrap_or(90).clamp(1, 100) as u8;
                let mut out = Vec::new();
                let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
                picture.to_rgb8().write_with_encoder(encoder).map_err(|error| error.to_string())?;
                Ok(bytes_value(&out))
            } else {
                Ok(bytes_value(&png(&picture)?))
            }
        }
        "image.bitmap" => {
            let mut pixels = picture.to_rgba8().into_raw();
            for pixel in pixels.chunks_exact_mut(4) {
                pixel.swap(0, 2);
            }
            Ok(bytes_value(&pixels))
        }
        _ => Err(format!("no image operation '{api}'")),
    }
}

// ---- displays (Electron's screen module, in DIPs) ----

pub fn displays(app: &AppHandle) -> Value {
    let primary = app.primary_monitor().ok().flatten().and_then(|m| m.name().cloned());
    let monitors = app.available_monitors().unwrap_or_default();
    Value::Array(
        monitors
            .iter()
            .enumerate()
            .map(|(index, monitor)| {
                let scale = monitor.scale_factor();
                let pos = monitor.position().to_logical::<f64>(scale);
                let size = monitor.size().to_logical::<f64>(scale);
                let work = monitor.work_area();
                let work_pos = work.position.to_logical::<f64>(scale);
                let work_size = work.size.to_logical::<f64>(scale);
                let rect = |x: f64, y: f64, w: f64, h: f64| json!({ "x": x.round(), "y": y.round(), "width": w.round(), "height": h.round() });
                json!({
                    "id": index,
                    "label": monitor.name().cloned().unwrap_or_default(),
                    "primary": monitor.name().cloned() == primary,
                    "scaleFactor": scale,
                    "rotation": 0,
                    "internal": false,
                    "bounds": rect(pos.x, pos.y, size.width, size.height),
                    "workArea": rect(work_pos.x, work_pos.y, work_size.width, work_size.height),
                    "size": { "width": size.width.round(), "height": size.height.round() },
                    "workAreaSize": { "width": work_size.width.round(), "height": work_size.height.round() },
                })
            })
            .collect(),
    )
}

// ---- restarting ----

pub fn relaunch_self(args: Option<Vec<String>>) {
    let exe = crate::engine::exe_path();
    let mut command = std::process::Command::new(exe);
    let args = args.unwrap_or_else(crate::engine::engine_args);
    // Electron's argv carried the app folder in a source run; the host finds it itself.
    command.args(args.iter().filter(|arg| !arg.ends_with("main.cjs") && arg.as_str() != "."));
    command.arg(format!("--relaunch-after={}", std::process::id()));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0000_0008); // DETACHED_PROCESS
    }
    if let Err(error) = command.spawn() {
        eprintln!("[mefi-host] relaunch failed: {error}");
    }
}

pub mod platform {
    pub use super::win::*;
}

#[cfg(windows)]
mod win {
    use serde_json::{json, Value};
    use windows_sys::Win32::Foundation::{CloseHandle, GlobalFree, HANDLE};
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, SetClipboardData};
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows_sys::Win32::System::Ole::CF_UNICODETEXT;
    use windows_sys::Win32::System::Power::{PowerClearRequest, PowerCreateRequest, PowerRequestDisplayRequired, PowerRequestSystemRequired, PowerSetRequest};
    use windows_sys::Win32::System::Registry::{RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_SZ};
    use windows_sys::Win32::System::StationsAndDesktops::{CloseDesktop, GetUserObjectInformationW, OpenInputDesktop, DESKTOP_SWITCHDESKTOP, UOI_NAME};
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::System::Threading::{POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn set_app_user_model_id(id: &str) {
        #[link(name = "shell32")]
        extern "system" {
            fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
        }
        if id.is_empty() {
            return;
        }
        let id = wide(id);
        // SAFETY: a NUL-terminated UTF-16 string that outlives the call.
        unsafe { SetCurrentProcessExplicitAppUserModelID(id.as_ptr()) };
    }

    pub fn idle_seconds() -> u64 {
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        // SAFETY: info is a valid, sized LASTINPUTINFO.
        if unsafe { GetLastInputInfo(&mut info) } == 0 {
            return 0;
        }
        let now = unsafe { GetTickCount() };
        (now.wrapping_sub(info.dwTime) / 1000) as u64
    }

    /// Chromium's test: the input desktop is not "Default" while the workstation is locked.
    pub fn screen_locked() -> bool {
        // SAFETY: the handle is checked and closed; the name buffer is sized.
        unsafe {
            let desk = OpenInputDesktop(0, 0, DESKTOP_SWITCHDESKTOP);
            if desk.is_null() {
                return true;
            }
            let mut name = [0u16; 256];
            let mut needed = 0u32;
            let ok = GetUserObjectInformationW(desk as HANDLE, UOI_NAME, name.as_mut_ptr() as _, (name.len() * 2) as u32, &mut needed);
            CloseDesktop(desk);
            if ok == 0 {
                return false;
            }
            let len = name.iter().position(|c| *c == 0).unwrap_or(name.len());
            !String::from_utf16_lossy(&name[..len]).eq_ignore_ascii_case("Default")
        }
    }

    fn open_clipboard() -> bool {
        for _ in 0..10 {
            // SAFETY: no owner window; closed by the caller.
            if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        false
    }

    pub fn clipboard_read_text() -> Option<String> {
        if !open_clipboard() {
            return None;
        }
        // SAFETY: the clipboard is open; the handle is locked only while read.
        let text = unsafe {
            let handle = GetClipboardData(CF_UNICODETEXT as u32);
            if handle.is_null() {
                None
            } else {
                let data = GlobalLock(handle as _) as *const u16;
                if data.is_null() {
                    None
                } else {
                    let mut len = 0usize;
                    while *data.add(len) != 0 {
                        len += 1;
                    }
                    let text = String::from_utf16_lossy(std::slice::from_raw_parts(data, len));
                    GlobalUnlock(handle as _);
                    Some(text)
                }
            }
        };
        unsafe { CloseClipboard() };
        text
    }

    pub fn clipboard_write_text(text: &str) -> Result<(), String> {
        let data = wide(text);
        if !open_clipboard() {
            return Err("the clipboard is busy".into());
        }
        // SAFETY: the memory is sized for `data`; ownership passes to the
        // clipboard on success and is freed here otherwise.
        let ok = unsafe {
            EmptyClipboard();
            let memory = GlobalAlloc(GMEM_MOVEABLE, data.len() * 2);
            if memory.is_null() {
                false
            } else {
                let target = GlobalLock(memory) as *mut u16;
                std::ptr::copy_nonoverlapping(data.as_ptr(), target, data.len());
                GlobalUnlock(memory);
                if SetClipboardData(CF_UNICODETEXT as u32, memory as HANDLE).is_null() {
                    GlobalFree(memory);
                    false
                } else {
                    true
                }
            }
        };
        unsafe { CloseClipboard() };
        if ok {
            Ok(())
        } else {
            Err("could not write the clipboard".into())
        }
    }

    pub fn power_request(display: bool) -> Option<isize> {
        let mut reason_text = wide("Mefi's Studio AI+ is running agent work");
        let context = REASON_CONTEXT {
            Version: 0,
            Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
            Reason: REASON_CONTEXT_0 { SimpleReasonString: reason_text.as_mut_ptr() },
        };
        // SAFETY: context and its string live for the call.
        unsafe {
            let handle = PowerCreateRequest(&context);
            if handle.is_null() || handle as isize == -1 {
                return None;
            }
            PowerSetRequest(handle, PowerRequestSystemRequired);
            if display {
                PowerSetRequest(handle, PowerRequestDisplayRequired);
            }
            Some(handle as isize)
        }
    }

    pub fn power_release(handle: isize) {
        // SAFETY: a handle this module created and has not closed.
        unsafe {
            PowerClearRequest(handle as HANDLE, PowerRequestSystemRequired);
            PowerClearRequest(handle as HANDLE, PowerRequestDisplayRequired);
            CloseHandle(handle as HANDLE);
        }
    }

    pub fn working_set_kb() -> u64 {
        #[repr(C)]
        struct Counters {
            cb: u32,
            page_fault_count: u32,
            peak_working_set_size: usize,
            working_set_size: usize,
            rest: [usize; 6],
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GetCurrentProcess() -> HANDLE;
            fn K32GetProcessMemoryInfo(process: HANDLE, counters: *mut Counters, cb: u32) -> i32;
        }
        let mut counters = Counters { cb: std::mem::size_of::<Counters>() as u32, page_fault_count: 0, peak_working_set_size: 0, working_set_size: 0, rest: [0; 6] };
        // SAFETY: counters is sized as PROCESS_MEMORY_COUNTERS.
        if unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) } == 0 {
            return 0;
        }
        (counters.working_set_size / 1024) as u64
    }

    /// A REG_SZ value under HKCU, the key made when missing. Best effort.
    pub fn set_registry_string(path: &str, name: &str, value: &str) {
        let Some(key) = open(path, KEY_WRITE) else { return };
        let name = wide(name);
        let data = wide(value);
        // SAFETY: an open key and NUL-terminated UTF-16 strings.
        unsafe {
            RegSetValueExW(key, name.as_ptr(), 0, REG_SZ, data.as_ptr() as *const u8, (data.len() * 2) as u32);
            RegCloseKey(key);
        }
    }

    // ---- login items: HKCU\...\Run, as Electron wrote them ----

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    const DEFAULT_NAME: &str = "MefiStudio.StudioAIPlus";

    fn open(path: &str, access: u32) -> Option<HKEY> {
        let path = wide(path);
        let mut key: HKEY = std::ptr::null_mut();
        // SAFETY: valid strings and out pointer; closed by the caller.
        let status = unsafe { RegCreateKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, std::ptr::null(), 0, access, std::ptr::null(), &mut key, std::ptr::null_mut()) };
        (status == 0).then_some(key)
    }

    fn read_value(path: &str, name: &str) -> Option<Vec<u8>> {
        let key = open(path, KEY_READ)?;
        let name = wide(name);
        let mut size = 0u32;
        // SAFETY: size query, then a read into a buffer of that size.
        let out = unsafe {
            if RegQueryValueExW(key, name.as_ptr(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), &mut size) != 0 {
                None
            } else {
                let mut buf = vec![0u8; size as usize];
                (RegQueryValueExW(key, name.as_ptr(), std::ptr::null(), std::ptr::null_mut(), buf.as_mut_ptr(), &mut size) == 0).then(|| {
                    buf.truncate(size as usize);
                    buf
                })
            }
        };
        unsafe { RegCloseKey(key) };
        out
    }

    /// The command line Studio starts with at sign-in: this host, never node.exe.
    fn command_line(args: &Value) -> String {
        let exe = crate::engine::exe_path();
        let mut line = format!("\"{}\"", exe.display());
        for arg in args.as_array().into_iter().flatten().filter_map(Value::as_str) {
            // A source run passed the quoted app folder first; the host finds it itself.
            if arg.trim_matches('"').ends_with(".cjs") || std::path::Path::new(arg.trim_matches('"')).join("main.cjs").is_file() {
                continue;
            }
            line.push(' ');
            line.push_str(arg);
        }
        line
    }

    pub fn login_item_get(options: &Value) -> Result<Value, String> {
        let name = options.get("name").and_then(Value::as_str).unwrap_or(DEFAULT_NAME);
        let saved = read_value(RUN_KEY, name).map(|bytes| {
            let units: Vec<u16> = bytes.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).take_while(|c| *c != 0).collect();
            String::from_utf16_lossy(&units)
        });
        // StartupApproved's first byte is even when Task Manager left the entry enabled.
        let approved = read_value(APPROVED_KEY, name).map_or(true, |bytes| bytes.first().map_or(true, |b| b % 2 == 0));
        let wanted = command_line(options.get("args").unwrap_or(&Value::Null));
        let open_at_login = saved.as_deref().map_or(false, |line| line.eq_ignore_ascii_case(&wanted));
        Ok(json!({
            "openAtLogin": open_at_login,
            "executableWillLaunchAtLogin": open_at_login && approved,
            "launchItems": saved.map(|line| vec![json!({ "name": name, "path": line, "args": [], "scope": "user", "enabled": approved })]).unwrap_or_default(),
        }))
    }

    pub fn login_item_set(settings: &Value) -> Result<(), String> {
        let name = settings.get("name").and_then(Value::as_str).unwrap_or(DEFAULT_NAME);
        let key = open(RUN_KEY, KEY_WRITE).ok_or("cannot open the Run key")?;
        let wname = wide(name);
        // SAFETY: an open key and NUL-terminated strings.
        let status = unsafe {
            if settings.get("openAtLogin").and_then(Value::as_bool).unwrap_or(false) {
                let data = wide(&command_line(settings.get("args").unwrap_or(&Value::Null)));
                RegSetValueExW(key, wname.as_ptr(), 0, REG_SZ, data.as_ptr() as *const u8, (data.len() * 2) as u32)
            } else {
                let status = RegDeleteValueW(key, wname.as_ptr());
                if status == 2 { 0 } else { status } // ERROR_FILE_NOT_FOUND: already off
            }
        };
        unsafe { RegCloseKey(key) };
        if status == 0 {
            Ok(())
        } else {
            Err(format!("the Run key refused the change (error {status})"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_round_trip() {
        let value = bytes_value(b"\x89PNG");
        assert_eq!(bytes_arg(&value).unwrap(), b"\x89PNG");
        assert!(holds_tag(&json!({ "png": value })));
        assert!(!holds_tag(&json!({ "png": "plain" })));
    }

    #[test]
    fn accelerators_include_roles_and_skip_plain_items() {
        let items = json!([
            { "id": 1, "label": "View", "submenu": [
                { "id": 2, "label": "Reload", "accelerator": "CmdOrCtrl+R" },
                { "id": 3, "role": "toggleDevTools" },
                { "id": 4, "label": "No key" },
                { "id": 5, "label": "Hidden", "visible": false, "accelerator": "CmdOrCtrl+0" }
            ]}
        ]);
        let list = accelerators(&items);
        let ids: Vec<u64> = list.iter().map(|entry| entry["id"].as_u64().unwrap()).collect();
        assert_eq!(ids, vec![2, 3, 5]);
        assert_eq!(list[1]["accelerator"], "CmdOrCtrl+Shift+I");
    }

    #[test]
    fn page_url_is_only_the_booklet() {
        assert!(is_page_url(&Url::parse("http://mefi.localhost/renderer/booklet.html?smoke=0").unwrap()));
        assert!(!is_page_url(&Url::parse("http://mefi.localhost/renderer/other.html").unwrap()));
        assert!(!is_page_url(&Url::parse("https://example.com/renderer/booklet.html").unwrap()));
    }

    #[test]
    fn images_resize_and_encode() {
        let mut png = Vec::new();
        image::DynamicImage::new_rgba8(40, 20).write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        let out = image_op("image.resize", &bytes_value(&png), &json!({ "width": 10 })).unwrap();
        assert_eq!(out["width"], 10);
        assert_eq!(out["height"], 5);
        let jpeg = image_op("image.encode", &bytes_value(&png), &json!({ "format": "jpeg", "quality": 70 })).unwrap();
        assert_eq!(&bytes_arg(&jpeg).unwrap()[..2], &[0xFF, 0xD8]);
        let bitmap = image_op("image.bitmap", &bytes_value(&png), &Value::Null).unwrap();
        assert_eq!(bytes_arg(&bitmap).unwrap().len(), 40 * 20 * 4);
    }
}
