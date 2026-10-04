//! Webviews beside Studio's own page.
//!
//! - The Media browser (scripts/media-browser.cjs): Electron's
//!   WebContentsView, here a child webview of Studio's window with its own
//!   WebView2 profile. The engine's shim (scripts/tauri-electron.cjs) drives it
//!   with `view.*` casts and hears `view:*` events; the guards Electron ran in
//!   JavaScript (only http(s) pages, no pop-ups, downloads or permissions)
//!   run here, and what they refuse is reported so the page can say why.
//! - Evidence shots (scripts/evidence-window.cjs): Electron's offscreen
//!   window, here a hidden in-private window placed off every screen, opened
//!   by one `evidence.capture` call that answers like the JavaScript capture:
//!   { ok, png } or { ok: false, error }, never an exception.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, PermissionResponse, WebviewBuilder};
use tauri::{LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl, WebviewWindowBuilder};

use crate::engine::Engine;
use crate::webview2::Emit;

fn views() -> &'static Mutex<HashMap<u64, Webview>> {
    static VIEWS: OnceLock<Mutex<HashMap<u64, Webview>>> = OnceLock::new();
    VIEWS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn view(id: u64) -> Option<Webview> {
    views().lock().ok().and_then(|map| map.get(&id).cloned())
}

/// media-browser.cjs `browserURL` for a page the view may show: http(s) and
/// no credentials in the address.
fn web_page(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.username().is_empty() && url.password().is_none()
}

/// A WebView2 profile folder for an Electron session partition
/// ("persist:mefi-media-browser" keeps its cookies like Electron did).
fn profile_dir(engine: &Engine, partition: &str) -> PathBuf {
    let name: String = partition.trim_start_matches("persist:").chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
    engine.studio.user_data(&engine.app).join("WebView2").join(if name.is_empty() { "view".into() } else { name })
}

fn emitter(engine: &Arc<Engine>) -> Emit {
    let engine = engine.clone();
    Arc::new(move |name, body| engine.event(name, body))
}

/// view.create { id, partition }: a hidden child webview over Studio's page.
pub fn create(engine: &Arc<Engine>, body: &Value) -> Result<(), String> {
    let id = body.get("id").and_then(Value::as_u64).ok_or("view id missing")?;
    let window = engine.app.get_webview_window(crate::native::MAIN).ok_or("Studio's window is not open")?;
    let partition = body.get("partition").and_then(Value::as_str).unwrap_or("persist:mefi-media-browser");
    let emit = emitter(engine);
    let blank: Url = "about:blank".parse().map_err(|_| "bad blank page")?;
    let mut builder = WebviewBuilder::new(format!("view-{id}"), WebviewUrl::External(blank))
        .focused(false)
        .zoom_hotkeys_enabled(false)
        .on_permission_request(|_, _| PermissionResponse::Deny);
    if partition.starts_with("persist:") {
        builder = builder.data_directory(profile_dir(engine, partition));
    } else {
        builder = builder.data_directory(profile_dir(engine, "memory")).incognito(true);
    }
    let refused = emit.clone();
    builder = builder.on_navigation(move |url| {
        if web_page(url) || url.as_str() == "about:blank" {
            return true;
        }
        refused("view:will-navigate", json!({ "id": id, "url": url.as_str(), "isMainFrame": true }));
        false
    });
    let opened = emit.clone();
    builder = builder.on_new_window(move |url, _features| {
        opened("view:new-window", json!({ "id": id, "url": url.as_str() }));
        NewWindowResponse::Deny
    });
    let downloads = emit.clone();
    builder = builder.on_download(move |_, event| {
        if let DownloadEvent::Requested { .. } = event {
            downloads("view:will-download", json!({ "id": id }));
        }
        false
    });
    let titles = emit.clone();
    builder = builder.on_document_title_changed(move |_, title| titles("view:page-title-updated", json!({ "id": id, "title": title })));
    let loads = emit.clone();
    builder = builder.on_page_load(move |_, payload| {
        if let PageLoadEvent::Started = payload.event() {
            loads("view:did-start-loading", json!({ "id": id, "url": payload.url().as_str() }));
        }
    });
    let webview = window
        .as_ref()
        .window()
        .add_child(builder, LogicalPosition::new(0.0, 0.0), LogicalSize::new(1.0, 1.0))
        .map_err(|error| format!("could not open the view: {error}"))?;
    let _ = webview.hide();
    crate::webview2::watch_view(&webview, id, emit);
    views().lock().map_err(|_| "view table poisoned")?.insert(id, webview);
    Ok(())
}

/// view.* casts: load, bounds, visible, back, forward, stop, mute, reload, focus, close.
pub fn command(engine: &Arc<Engine>, api: &str, body: &Value) -> Result<(), String> {
    let id = body.get("id").and_then(Value::as_u64).ok_or("view id missing")?;
    if api == "view.close" {
        if let Some(webview) = views().lock().ok().and_then(|mut map| map.remove(&id)) {
            webview.close().map_err(|error| error.to_string())?;
        }
        return Ok(());
    }
    let webview = view(id).ok_or("that view is closed")?;
    let done = |result: tauri::Result<()>| result.map_err(|error| error.to_string());
    match api {
        "view.load" => {
            let url: Url = body.get("url").and_then(Value::as_str).unwrap_or_default().parse().map_err(|_| "not a web address")?;
            if !web_page(&url) {
                return Err("only http and https pages open in the view".into());
            }
            done(webview.navigate(url))
        }
        "view.reload" => done(webview.reload()),
        "view.focus" => done(webview.set_focus()),
        "view.visible" => {
            if body.get("on").and_then(Value::as_bool).unwrap_or(false) {
                done(webview.show())
            } else {
                done(webview.hide())
            }
        }
        "view.bounds" => {
            let get = |key: &str| body.get(key).and_then(Value::as_f64).unwrap_or(0.0);
            done(webview.set_position(LogicalPosition::new(get("x"), get("y"))))?;
            done(webview.set_size(LogicalSize::new(get("width").max(1.0), get("height").max(1.0))))
        }
        "view.back" | "view.forward" | "view.stop" | "view.mute" => {
            let action = api.trim_start_matches("view.").to_string();
            crate::webview2::view_command(&webview, id, action, body.get("on").and_then(Value::as_bool).unwrap_or(false), emitter(engine))
        }
        other => Err(format!("the Rust host has no '{other}' yet")),
    }
}

/// Every child view goes with Studio's window.
pub fn close_all() {
    let all: Vec<Webview> = views().lock().map(|mut map| map.drain().map(|(_, webview)| webview).collect()).unwrap_or_default();
    for webview in all {
        let _ = webview.close();
    }
}

// ---- evidence shots ----

/// attempt-evidence.cjs `allowRequest(url, allowed)`: the preview's own
/// origin (http/ws, or https/wss when it is secure) and data:/blob: pieces of
/// the page; nothing else, and never an address with credentials.
pub fn allow_request(request: &str, host: &str, secure: bool) -> bool {
    if host.is_empty() {
        return false;
    }
    let Ok(url) = Url::parse(request) else { return false };
    if url.scheme() == "data" || url.scheme() == "blob" || request == "about:blank" {
        return true;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let web: [&str; 2] = if secure { ["https", "wss"] } else { ["http", "ws"] };
    let url_host = match (url.host_str(), url.port()) {
        (Some(name), Some(port)) => format!("{name}:{port}"),
        (Some(name), None) => name.to_string(),
        _ => return false,
    };
    web.contains(&url.scheme()) && url_host == host
}

/// evidence.capture(url, { width, height, timeoutMs, settleMs, allow: { host, secure } }).
pub async fn capture(engine: &Arc<Engine>, url: &str, options: &Value) -> Value {
    let limit = options.get("timeoutMs").and_then(Value::as_u64).unwrap_or(15_000);
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let label = format!("evidence-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let result = tokio::time::timeout(Duration::from_millis(limit), shoot(engine, &label, url, options)).await;
    if let Some(window) = engine.app.get_webview_window(&label) {
        let _ = window.destroy();
    }
    match result {
        Ok(Ok(png)) => json!({ "ok": true, "png": crate::native::bytes_value(&png) }),
        Ok(Err(error)) => json!({ "ok": false, "error": error.chars().take(120).collect::<String>() }),
        Err(_) => json!({ "ok": false, "error": "timed out" }),
    }
}

async fn shoot(engine: &Arc<Engine>, label: &str, url: &str, options: &Value) -> Result<Vec<u8>, String> {
    let width = options.get("width").and_then(Value::as_f64).unwrap_or(1280.0);
    let height = options.get("height").and_then(Value::as_f64).unwrap_or(800.0);
    let settle = options.get("settleMs").and_then(Value::as_u64).unwrap_or(800);
    let allow = options.get("allow").cloned().unwrap_or(Value::Null);
    let host = allow.get("host").and_then(Value::as_str).unwrap_or_default().to_string();
    let secure = allow.get("secure").and_then(Value::as_bool).unwrap_or(false);
    let target: Url = url.parse().map_err(|_| "not a local address")?;
    if !allow_request(url, &host, secure) {
        return Err("not a local address".into());
    }
    let (loaded_tx, loaded_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let loaded = Arc::new(Mutex::new(Some(loaded_tx)));
    let navigation_host = host.clone();
    let blank: Url = "about:blank".parse().map_err(|_| "bad blank page")?;
    // Off every screen but shown, so WebView2 paints it; occlusion tracking
    // off, so Chromium does not treat it as hidden and stop drawing.
    let builder = WebviewWindowBuilder::new(&engine.app, label, WebviewUrl::External(blank))
        .title("Mefi's Studio AI+ evidence shot")
        .inner_size(width, height)
        .position(-32000.0, -32000.0)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .shadow(false)
        .visible(true)
        .incognito(true)
        .data_directory(profile_dir(engine, "evidence"))
        .additional_browser_args("--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --mute-audio")
        .zoom_hotkeys_enabled(false)
        .on_permission_request(|_, _| PermissionResponse::Deny)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .on_navigation(move |url| url.as_str() == "about:blank" || allow_request(url.as_str(), &navigation_host, secure))
        .on_page_load(move |_, payload| {
            if let PageLoadEvent::Finished = payload.event() {
                if payload.url().as_str() != "about:blank" {
                    if let Some(sender) = loaded.lock().ok().and_then(|mut slot| slot.take()) {
                        let _ = sender.send(Ok(()));
                    }
                }
            }
        });
    let window = builder.build().map_err(|error| format!("no window available: {error}"))?;
    let rule_host = host.clone();
    crate::webview2::filter_requests(window.as_ref(), Arc::new(move |request| allow_request(request, &rule_host, secure)))?;
    window.navigate(target).map_err(|error| error.to_string())?;
    loaded_rx.await.map_err(|_| "the page did not load")??;
    let webview = window.as_ref();
    // A shot is of the page, not of a scroll bar (Studio hides them everywhere too).
    let _ = crate::webview2::execute_script(
        webview,
        "(() => { const s = document.createElement('style'); s.textContent = 'html { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }'; (document.head || document.documentElement).append(s); return true; })()".into(),
    )
    .await;
    // A page says it loaded before its fonts and first paint are in: give it
    // a moment, and wait for its fonts (at most twice the settle time, 2 s).
    let fonts_by = tokio::time::Instant::now() + Duration::from_millis((settle * 2).min(2000));
    while tokio::time::Instant::now() < fonts_by {
        let status = crate::webview2::execute_script(webview, "document.fonts ? document.fonts.status : 'loaded'".into()).await.unwrap_or_default();
        if status.contains("loaded") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tokio::time::sleep(Duration::from_millis(settle)).await;
    let png = crate::webview2::capture_png(webview).await?;
    let (shot_width, shot_height) = image::ImageReader::new(std::io::Cursor::new(&png))
        .with_guessed_format()
        .map_err(|error| error.to_string())?
        .into_dimensions()
        .map_err(|error| error.to_string())?;
    if shot_width == 0 || shot_height == 0 {
        return Err("the window painted nothing".into());
    }
    if shot_width as f64 == width && shot_height as f64 == height {
        return Ok(png);
    }
    let resized = crate::native::resize_png(&png, width as u32, height as u32)?;
    if resized.is_empty() {
        return Err("no picture".into());
    }
    Ok(resized)
}

#[cfg(test)]
mod tests {
    use super::allow_request;

    #[test]
    fn requests_follow_attempt_evidence_rules() {
        assert!(allow_request("http://localhost:5173/app.js", "localhost:5173", false));
        assert!(allow_request("ws://localhost:5173/hmr", "localhost:5173", false));
        assert!(!allow_request("https://localhost:5173/", "localhost:5173", false));
        assert!(allow_request("https://127.0.0.1:8443/x", "127.0.0.1:8443", true));
        assert!(allow_request("wss://127.0.0.1:8443/x", "127.0.0.1:8443", true));
        assert!(allow_request("http://[::1]:3000/", "[::1]:3000", false));
        assert!(!allow_request("http://localhost:5174/", "localhost:5173", false));
        assert!(!allow_request("http://user:pw@localhost:5173/", "localhost:5173", false));
        assert!(!allow_request("https://example.com/", "localhost:5173", false));
        assert!(allow_request("data:image/png;base64,AA", "localhost:5173", false));
        assert!(allow_request("blob:http://localhost:5173/abc", "localhost:5173", false));
        assert!(allow_request("about:blank", "localhost:5173", false));
        assert!(!allow_request("file:///C:/x", "localhost:5173", false));
        assert!(!allow_request("not a url", "localhost:5173", false));
        assert!(!allow_request("http://localhost:5173/", "", false));
        assert!(allow_request("http://localhost/", "localhost", false));
        assert!(!allow_request("http://localhost:80/", "localhost:80", false));
    }
}
