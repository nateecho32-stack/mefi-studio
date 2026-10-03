//! WebView2 features Tauri does not wrap, reached through `with_webview`:
//! page captures (Electron's capturePage), the Referer YouTube's embedded
//! player needs, the page process failing (render-process-gone), and DevTools
//! protocol calls (webContents.debugger).

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::WebviewWindow;
use tokio::sync::oneshot;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2_22, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, COREWEBVIEW2_PROCESS_FAILED_KIND,
    COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED, COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
    COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
};
use webview2_com::{take_pwstr, CallDevToolsProtocolMethodCompletedHandler, CapturePreviewCompletedHandler, ProcessFailedEventHandler, WebResourceRequestedEventHandler};
use windows::core::{Interface, BOOL, HSTRING, PWSTR};
use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

/// YouTube refuses to start an embedded player ("Error 153") without a
/// Referer naming the app; Studio's page sends none. The same value
/// main.cjs's nameStudioToEmbeds gave Electron's session.
const EMBED_REFERER: &str = "https://io.github.nateecho32-stack.mefi-studio/";
const EMBEDS: &[&str] = &["https://www.youtube-nocookie.com/embed/", "https://www.youtube.com/embed/"];

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
pub async fn capture_png(window: &WebviewWindow) -> Result<Vec<u8>, String> {
    let (sender, receiver) = oneshot::channel();
    let slot: Reply<Vec<u8>> = Arc::new(Mutex::new(Some(sender)));
    let started = slot.clone();
    window
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
pub async fn devtools_command(window: &WebviewWindow, method: String, params: Value) -> Result<Value, String> {
    let (sender, receiver) = oneshot::channel();
    let slot: Reply<String> = Arc::new(Mutex::new(Some(sender)));
    let started = slot.clone();
    window
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

/// The embed Referer and the page-process watch, once per window.
pub fn install(window: &WebviewWindow, on_failure: impl Fn(&'static str, Value) + Send + Sync + 'static) {
    let on_failure = Arc::new(on_failure);
    let _ = window.with_webview(move |platform| {
        let Ok(core) = core_of(&platform) else { return };
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
            let failure = on_failure.clone();
            let mut token = Default::default();
            let watched = core.add_ProcessFailed(
                &ProcessFailedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                    args.ProcessFailedKind(&mut kind)?;
                    match kind {
                        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE => failure("window:unresponsive", Value::Null),
                        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED => failure("webContents:render-process-gone", json!({ "reason": "crashed" })),
                        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED => failure("webContents:render-process-gone", json!({ "reason": "launch-failed" })),
                        _ => {}
                    }
                    Ok(())
                })),
                &mut token,
            );
            if let Err(error) = watched {
                eprintln!("[mefi-host] process watch: {}", error.message());
            }
        }
    });
}
