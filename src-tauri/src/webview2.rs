//! WebView2 features Tauri does not wrap, reached through `with_webview`:
//! page captures (Electron's capturePage), the Referer YouTube's embedded
//! player needs, how a navigation ended (did-finish-load or did-fail-load),
//! the page process failing (render-process-gone), DevTools protocol calls
//! (webContents.debugger), dropped files' paths (webUtils.getPathForFile),
//! and what the Media browser's view (src/views.rs) needs: history, mute,
//! playing audio, external links and its Ctrl+L.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::Webview;
use tokio::sync::oneshot;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2File, ICoreWebView2NavigationCompletedEventArgs2, ICoreWebView2WebMessageReceivedEventArgs2, ICoreWebView2_18,
    ICoreWebView2_22, ICoreWebView2_8, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, COREWEBVIEW2_KEY_EVENT_KIND,
    COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
    COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED, COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE, COREWEBVIEW2_WEB_ERROR_STATUS,
    COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT, COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT,
    COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED, COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID, COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED,
    COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS, COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
    COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET, COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED, COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
    COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED, COREWEBVIEW2_WEB_ERROR_STATUS_REDIRECT_FAILED, COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE,
    COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT, COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
};
use webview2_com::{
    take_pwstr, AcceleratorKeyPressedEventHandler, CallDevToolsProtocolMethodCompletedHandler, CapturePreviewCompletedHandler,
    ExecuteScriptCompletedHandler, HistoryChangedEventHandler, IsDocumentPlayingAudioChangedEventHandler, IsMutedChangedEventHandler,
    LaunchingExternalUriSchemeEventHandler, NavigationCompletedEventHandler, ProcessFailedEventHandler, SourceChangedEventHandler,
    WebMessageReceivedEventHandler, WebResourceRequestedEventHandler,
};
use windows::core::{Interface, BOOL, HSTRING, PWSTR};
use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

/// YouTube refuses to start an embedded player ("Error 153") without a
/// Referer naming the app; Studio's page sends none. The same value
/// main.cjs's nameStudioToEmbeds gave Electron's session.
const EMBED_REFERER: &str = "https://io.github.nateecho32-stack.mefi-studio/";
const EMBEDS: &[&str] = &["https://www.youtube-nocookie.com/embed/", "https://www.youtube.com/embed/"];

/// Where a webview's events go: an event name and its body.
pub type Emit = Arc<dyn Fn(&'static str, Value) + Send + Sync>;

type Reply<T> = Arc<Mutex<Option<oneshot::Sender<Result<T, String>>>>>;

fn answer<T>(slot: &Reply<T>, value: Result<T, String>) {
    if let Some(sender) = slot.lock().ok().and_then(|mut slot| slot.take()) {
        let _ = sender.send(value);
    }
}

fn core_of(platform: &tauri::webview::PlatformWebview) -> windows::core::Result<ICoreWebView2> {
    // SAFETY: the controller belongs to this live webview; called on its thread.
    unsafe { platform.controller().CoreWebView2() }
}

fn read_stream(stream: &IStream) -> Result<Vec<u8>, String> {
    // SAFETY: the stream is a memory stream this module created; the buffer
    // is sized from its own Stat.
    unsafe {
        let mut stat = STATSTG::default();
        stream.Stat(&mut stat, STATFLAG_NONAME).map_err(|error| error.message().to_string())?;
        stream.Seek(0, STREAM_SEEK_SET, None).map_err(|error| error.message().to_string())?;
        let mut bytes = vec![0u8; stat.cbSize as usize];
        let mut read = 0u32;
        stream
            .Read(bytes.as_mut_ptr().cast(), bytes.len() as u32, Some(&mut read))
            .ok()
            .map_err(|error| error.message().to_string())?;
        bytes.truncate(read as usize);
        Ok(bytes)
    }
}

/// The page as a PNG, at the webview's own pixel size.
pub async fn capture_png(webview: &Webview) -> Result<Vec<u8>, String> {
    let (sender, receiver) = oneshot::channel();
    let slot: Reply<Vec<u8>> = Arc::new(Mutex::new(Some(sender)));
    let started = slot.clone();
    webview
        .with_webview(move |platform| {
            let run = || -> windows::core::Result<()> {
                let core = core_of(&platform)?;
                // SAFETY: a fresh memory stream that frees its memory on release.
                let stream: IStream = unsafe { CreateStreamOnHGlobal(HGLOBAL::default(), true)? };
                let reading = stream.clone();
                let done = started.clone();
                let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                    answer(&done, result.map_err(|error| error.message().to_string()).and_then(|_| read_stream(&reading)));
                    Ok(())
                }));
                // SAFETY: stream and handler outlive the call (COM references).
                unsafe { core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler) }
            };
            if let Err(error) = run() {
                answer(&started, Err(format!("capture did not start: {}", error.message())));
            }
        })
        .map_err(|error| error.to_string())?;
    match tokio::time::timeout(std::time::Duration::from_secs(15), receiver).await {
        Ok(Ok(result)) => result,
        _ => Err("the page capture did not finish within 15 s".into()),
    }
}

/// webContents.debugger.sendCommand: one DevTools protocol call, its JSON answer.
pub async fn devtools_command(webview: &Webview, method: String, params: Value) -> Result<Value, String> {
    let (sender, receiver) = oneshot::channel();
    let slot: Reply<String> = Arc::new(Mutex::new(Some(sender)));
    let started = slot.clone();
    webview
        .with_webview(move |platform| {
            let run = || -> windows::core::Result<()> {
                let core = core_of(&platform)?;
                let done = started.clone();
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
                    answer(&done, result.map(|_| json).map_err(|error| error.message().to_string()));
                    Ok(())
                }));
                // SAFETY: the strings and handler outlive the call.
                unsafe { core.CallDevToolsProtocolMethod(&HSTRING::from(method.as_str()), &HSTRING::from(params.to_string()), &handler) }
            };
            if let Err(error) = run() {
                answer(&started, Err(format!("DevTools call did not start: {}", error.message())));
            }
        })
        .map_err(|error| error.to_string())?;
    match tokio::time::timeout(std::time::Duration::from_secs(30), receiver).await {
        Ok(Ok(Ok(text))) => Ok(serde_json::from_str(&text).unwrap_or(Value::Null)),
        Ok(Ok(Err(error))) => Err(error),
        _ => Err("the DevTools call did not finish within 30 s".into()),
    }
}

/// One script in the webview's page, its result as JSON text (a promise is
/// not awaited: WebView2 answers with the promise object, "{}").
pub async fn execute_script(webview: &Webview, code: String) -> Result<String, String> {
    let (sender, receiver) = oneshot::channel();
    let slot: Reply<String> = Arc::new(Mutex::new(Some(sender)));
    let started = slot.clone();
    webview
        .with_webview(move |platform| {
            let run = || -> windows::core::Result<()> {
                let core = core_of(&platform)?;
                let done = started.clone();
                let handler = ExecuteScriptCompletedHandler::create(Box::new(move |result, json| {
                    answer(&done, result.map(|_| json).map_err(|error| error.message().to_string()));
                    Ok(())
                }));
                // SAFETY: the string and handler outlive the call.
                unsafe { core.ExecuteScript(&HSTRING::from(code.as_str()), &handler) }
            };
            if let Err(error) = run() {
                answer(&started, Err(format!("script did not start: {}", error.message())));
            }
        })
        .map_err(|error| error.to_string())?;
    match tokio::time::timeout(std::time::Duration::from_secs(15), receiver).await {
        Ok(Ok(result)) => result,
        _ => Err("the script did not finish within 15 s".into()),
    }
}

/// Chromium's net error for WebView2's web error status, as Electron's
/// did-fail-load reports it (code, description).
fn net_error(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> (i64, &'static str) {
    match status {
        COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED => (-3, "ERR_ABORTED"),
        COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT => (-7, "ERR_TIMED_OUT"),
        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET => (-101, "ERR_CONNECTION_RESET"),
        COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT => (-102, "ERR_CONNECTION_REFUSED"),
        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED => (-103, "ERR_CONNECTION_ABORTED"),
        COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED => (-105, "ERR_NAME_NOT_RESOLVED"),
        COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED => (-106, "ERR_INTERNET_DISCONNECTED"),
        COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE => (-109, "ERR_ADDRESS_UNREACHABLE"),
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT => (-200, "ERR_CERT_COMMON_NAME_INVALID"),
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED => (-201, "ERR_CERT_DATE_INVALID"),
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED => (-206, "ERR_CERT_REVOKED"),
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID => (-207, "ERR_CERT_INVALID"),
        COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS => (-110, "ERR_SSL_CLIENT_AUTH_CERT_NEEDED"),
        COREWEBVIEW2_WEB_ERROR_STATUS_REDIRECT_FAILED => (-310, "ERR_TOO_MANY_REDIRECTS"),
        _ => (-2, "ERR_FAILED"),
    }
}

/// How a main-frame navigation ended: { url, ok } or { url, ok: false, code,
/// description }. An HTTP error page still loaded (Electron finishes those).
fn navigation_result(core: &ICoreWebView2, args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2NavigationCompletedEventArgs) -> windows::core::Result<Value> {
    // SAFETY: COM getters on live objects, inside their event.
    unsafe {
        let url = source_of(core);
        let mut success = BOOL::default();
        args.IsSuccess(&mut success)?;
        let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
        args.WebErrorStatus(&mut status)?;
        let mut http = 0i32;
        if let Ok(args2) = args.cast::<ICoreWebView2NavigationCompletedEventArgs2>() {
            let _ = args2.HttpStatusCode(&mut http);
        }
        if success.as_bool() || (status == COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN && http >= 400) {
            return Ok(json!({ "url": url, "ok": true }));
        }
        let (code, description) = net_error(status);
        Ok(json!({ "url": url, "ok": false, "code": code, "description": description }))
    }
}

fn source_of(core: &ICoreWebView2) -> String {
    let mut source = PWSTR::null();
    // SAFETY: WebView2 allocates the string; take_pwstr frees it.
    unsafe {
        if core.Source(&mut source).is_err() {
            return String::new();
        }
    }
    take_pwstr(source)
}

/// The Media browser's view state, read where its events fire.
fn view_state(core: &ICoreWebView2) -> Value {
    // SAFETY: COM getters on the live webview, on its thread.
    unsafe {
        let mut back = BOOL::default();
        let mut forward = BOOL::default();
        let _ = core.CanGoBack(&mut back);
        let _ = core.CanGoForward(&mut forward);
        let mut title = PWSTR::null();
        let title = if core.DocumentTitle(&mut title).is_ok() { take_pwstr(title) } else { String::new() };
        let (mut muted, mut audible) = (BOOL::default(), BOOL::default());
        if let Ok(core8) = core.cast::<ICoreWebView2_8>() {
            let _ = core8.IsMuted(&mut muted);
            let _ = core8.IsDocumentPlayingAudio(&mut audible);
        }
        json!({
            "url": source_of(core), "title": title, "back": back.as_bool(), "forward": forward.as_bool(),
            "muted": muted.as_bool(), "audible": audible.as_bool(),
        })
    }
}

fn with_state(core: &ICoreWebView2, id: u64, extra: Value) -> Value {
    let mut body = view_state(core);
    body["id"] = json!(id);
    if let (Some(body), Value::Object(extra)) = (body.as_object_mut(), extra) {
        body.extend(extra);
    }
    body
}

fn add_process_watch(core: &ICoreWebView2, emit: Emit, unresponsive: &'static str, gone: &'static str, extra: Value) {
    let mut token = Default::default();
    // SAFETY: COM registration on the webview's own thread with owned arguments.
    let watched = unsafe {
        core.add_ProcessFailed(
            &ProcessFailedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                args.ProcessFailedKind(&mut kind)?;
                let mut body = extra.clone();
                match kind {
                    COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE => emit(unresponsive, body),
                    COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED => {
                        body["reason"] = json!("crashed");
                        emit(gone, body)
                    }
                    COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED => {
                        body["reason"] = json!("launch-failed");
                        emit(gone, body)
                    }
                    _ => {}
                }
                Ok(())
            })),
            &mut token,
        )
    };
    if let Err(error) = watched {
        eprintln!("[mefi-host] process watch: {}", error.message());
    }
}

/// Studio's window: the embed Referer, the page-process watch, how each
/// navigation ended ("webContents:navigation", which native.rs turns into
/// did-finish-load or did-fail-load for Studio's own page) and dropped files'
/// paths (the page posts "mefi-drop:<id>" with the File objects; the answer
/// goes back to window.__mefiHost.dropReply).
pub fn install(webview: &Webview, emit: Emit) {
    let installed = webview.with_webview(move |platform| {
        let Ok(core) = core_of(&platform) else {
            eprintln!("[mefi-host] install: the webview has no core yet");
            return;
        };
        // SAFETY: COM calls on the webview's own thread with owned arguments.
        unsafe {
            for prefix in EMBEDS {
                let filter = HSTRING::from(format!("{prefix}*"));
                // Requests from iframes need the newer filter (WebView2 runtime 1.0.2420+).
                let added = match core.cast::<ICoreWebView2_22>() {
                    Ok(core22) => core22.AddWebResourceRequestedFilterWithRequestSourceKinds(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL),
                    Err(_) => core.AddWebResourceRequestedFilter(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL),
                };
                if let Err(error) = added {
                    eprintln!("[mefi-host] embed filter {prefix}: {}", error.message());
                }
            }
            let mut token = Default::default();
            let referer = core.add_WebResourceRequested(
                &WebResourceRequestedEventHandler::create(Box::new(|_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let request = args.Request()?;
                    let mut uri = PWSTR::null();
                    request.Uri(&mut uri)?;
                    let uri = take_pwstr(uri);
                    if !EMBEDS.iter().any(|prefix| uri.starts_with(prefix)) {
                        return Ok(());
                    }
                    let headers = request.Headers()?;
                    let name = HSTRING::from("Referer");
                    let mut present = BOOL::default();
                    headers.Contains(&name, &mut present)?;
                    if !present.as_bool() {
                        headers.SetHeader(&name, &HSTRING::from(EMBED_REFERER))?;
                    }
                    Ok(())
                })),
                &mut token,
            );
            if let Err(error) = referer {
                eprintln!("[mefi-host] embed Referer handler: {}", error.message());
            }
            add_process_watch(&core, emit.clone(), "window:unresponsive", "webContents:render-process-gone", json!({}));
            let navigation = emit.clone();
            let mut token = Default::default();
            let ended = core.add_NavigationCompleted(
                &NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                    let (Some(sender), Some(args)) = (sender, args) else { return Ok(()) };
                    navigation("webContents:navigation", navigation_result(&sender, &args)?);
                    Ok(())
                })),
                &mut token,
            );
            if let Err(error) = ended {
                eprintln!("[mefi-host] navigation watch: {}", error.message());
            }
            let mut token = Default::default();
            let drops = core.add_WebMessageReceived(
                &WebMessageReceivedEventHandler::create(Box::new(move |sender, args| {
                    let (Some(sender), Some(args)) = (sender, args) else { return Ok(()) };
                    let mut json_text = PWSTR::null();
                    args.WebMessageAsJson(&mut json_text)?;
                    // A string: Tauri's own handler runs first and stops the
                    // chain on anything else (it reads only strings).
                    let message: Value = serde_json::from_str(&take_pwstr(json_text)).unwrap_or(Value::Null);
                    let Some(id) = message.as_str().and_then(|text| text.strip_prefix("mefi-drop:")).and_then(|id| id.parse::<u64>().ok()) else {
                        return Ok(());
                    };
                    let mut paths = Vec::new();
                    if let Ok(args2) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() {
                        if let Ok(objects) = args2.AdditionalObjects() {
                            let mut count = 0u32;
                            objects.Count(&mut count)?;
                            for index in 0..count {
                                let Ok(object) = objects.GetValueAtIndex(index) else { continue };
                                let Ok(file) = object.cast::<ICoreWebView2File>() else {
                                    paths.push(Value::Null);
                                    continue;
                                };
                                let mut path = PWSTR::null();
                                paths.push(if file.Path(&mut path).is_ok() { json!(take_pwstr(path)) } else { Value::Null });
                            }
                        }
                    }
                    let script = format!("window.__mefiHost && window.__mefiHost.dropReply({id}, {})", Value::Array(paths));
                    sender.ExecuteScript(&HSTRING::from(script), None)?;
                    Ok(())
                })),
                &mut token,
            );
            if let Err(error) = drops {
                eprintln!("[mefi-host] drop watch: {}", error.message());
            }
        }
    });
    if let Err(error) = installed {
        eprintln!("[mefi-host] install: {error}");
    }
}

/// The Media browser's view: every change it reports as `view:<event>`
/// with { id, url, title, back, forward, muted, audible }.
pub fn watch_view(webview: &Webview, id: u64, emit: Emit) {
    let _ = webview.with_webview(move |platform| {
        let Ok(core) = core_of(&platform) else { return };
        // SAFETY: COM registrations on the webview's own thread with owned arguments.
        unsafe {
            add_process_watch(&core, emit.clone(), "view:unresponsive", "view:render-process-gone", json!({ "id": id }));
            let ended = emit.clone();
            let mut token = Default::default();
            let _ = core.add_NavigationCompleted(
                &NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                    let (Some(sender), Some(args)) = (sender, args) else { return Ok(()) };
                    let result = navigation_result(&sender, &args)?;
                    ended("view:navigation", with_state(&sender, id, result));
                    Ok(())
                })),
                &mut token,
            );
            let moved = emit.clone();
            let mut token = Default::default();
            let _ = core.add_SourceChanged(
                &SourceChangedEventHandler::create(Box::new(move |sender, args| {
                    let (Some(sender), Some(args)) = (sender, args) else { return Ok(()) };
                    let mut new_document = BOOL::default();
                    args.IsNewDocument(&mut new_document)?;
                    if !new_document.as_bool() {
                        moved("view:did-navigate-in-page", with_state(&sender, id, json!({})));
                    }
                    Ok(())
                })),
                &mut token,
            );
            let history = emit.clone();
            let mut token = Default::default();
            let _ = core.add_HistoryChanged(
                &HistoryChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(sender) = sender {
                        history("view:state", with_state(&sender, id, json!({})));
                    }
                    Ok(())
                })),
                &mut token,
            );
            if let Ok(core8) = core.cast::<ICoreWebView2_8>() {
                let audio = emit.clone();
                let mut token = Default::default();
                let _ = core8.add_IsDocumentPlayingAudioChanged(
                    &IsDocumentPlayingAudioChangedEventHandler::create(Box::new(move |sender, _| {
                        if let Some(sender) = sender {
                            audio("view:audio-state-changed", with_state(&sender, id, json!({})));
                        }
                        Ok(())
                    })),
                    &mut token,
                );
                let muted = emit.clone();
                let mut token = Default::default();
                let _ = core8.add_IsMutedChanged(
                    &IsMutedChangedEventHandler::create(Box::new(move |sender, _| {
                        if let Some(sender) = sender {
                            muted("view:state", with_state(&sender, id, json!({})));
                        }
                        Ok(())
                    })),
                    &mut token,
                );
            }
            // A link to another app (mailto:, zoommtg:, ...) never leaves the
            // view; Studio says "use Open in browser" instead.
            if let Ok(core18) = core.cast::<ICoreWebView2_18>() {
                let blocked = emit.clone();
                let mut token = Default::default();
                let _ = core18.add_LaunchingExternalUriScheme(
                    &LaunchingExternalUriSchemeEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()) };
                        args.SetCancel(true)?;
                        let mut uri = PWSTR::null();
                        args.Uri(&mut uri)?;
                        blocked("view:will-navigate", json!({ "id": id, "url": take_pwstr(uri), "isMainFrame": true }));
                        Ok(())
                    })),
                    &mut token,
                );
            }
            // Ctrl+L belongs to Studio's address field, as in Electron's before-input-event.
            let keys = emit.clone();
            let mut token = Default::default();
            let _ = platform.controller().add_AcceleratorKeyPressed(
                &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                    args.KeyEventKind(&mut kind)?;
                    let mut key = 0u32;
                    args.VirtualKey(&mut key)?;
                    let control = windows_sys::Win32::UI::Input::KeyboardAndMouse::GetKeyState(0x11) < 0;
                    if kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && control && key == u32::from(b'L') {
                        args.SetHandled(true)?;
                        keys("view:before-input-event", json!({ "id": id, "type": "keyDown", "key": "l", "control": true }));
                    }
                    Ok(())
                })),
                &mut token,
            );
        }
    });
}

/// back, forward, stop and mute on a view; the new state follows as an event.
pub fn view_command(webview: &Webview, id: u64, action: String, on: bool, emit: Emit) -> Result<(), String> {
    webview
        .with_webview(move |platform| {
            let Ok(core) = core_of(&platform) else { return };
            // SAFETY: COM calls on the webview's own thread.
            unsafe {
                let _ = match action.as_str() {
                    "back" => core.GoBack(),
                    "forward" => core.GoForward(),
                    "stop" => core.Stop(),
                    "mute" => core.cast::<ICoreWebView2_8>().and_then(|core8| core8.SetIsMuted(on)),
                    _ => Ok(()),
                };
            }
            emit("view:state", with_state(&core, id, json!({})));
        })
        .map_err(|error| error.to_string())
}

/// The evidence window's request rule: every request the page makes goes
/// through `allow`; a refused one gets an empty 403 and never leaves.
pub fn filter_requests(webview: &Webview, allow: Arc<dyn Fn(&str) -> bool + Send + Sync>) -> Result<(), String> {
    webview
        .with_webview(move |platform| {
            let Ok(core) = core_of(&platform) else { return };
            // SAFETY: COM calls on the webview's own thread with owned arguments.
            unsafe {
                let filter = HSTRING::from("*");
                let _ = match core.cast::<ICoreWebView2_22>() {
                    Ok(core22) => core22.AddWebResourceRequestedFilterWithRequestSourceKinds(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL),
                    Err(_) => core.AddWebResourceRequestedFilter(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL),
                };
                let environment = core.cast::<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2>().and_then(|core2| core2.Environment());
                let mut token = Default::default();
                let _ = core.add_WebResourceRequested(
                    &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()) };
                        let mut uri = PWSTR::null();
                        args.Request()?.Uri(&mut uri)?;
                        if allow(&take_pwstr(uri)) {
                            return Ok(());
                        }
                        if let Ok(environment) = &environment {
                            let response = environment.CreateWebResourceResponse(None, 403, &HSTRING::from("Blocked"), &HSTRING::new())?;
                            args.SetResponse(&response)?;
                        }
                        Ok(())
                    })),
                    &mut token,
                );
            }
        })
        .map_err(|error| error.to_string())
}
