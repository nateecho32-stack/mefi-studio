//! The commands Studio's page calls (src/init.js). Bodies arrive as the
//! page's JSON bytes and go to the engine unparsed; answers come back as the
//! engine's JSON text, which Tauri hands the page already parsed.

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request, Response};
use tauri::State;

use crate::engine::Engine;

fn header<'a>(request: &'a Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|value| value.to_str().ok())
}

fn body(request: &Request<'_>) -> Vec<u8> {
    match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(value) => serde_json::to_vec(value).unwrap_or_else(|_| b"[]".to_vec()),
    }
}

#[tauri::command]
pub async fn ipc_invoke(request: Request<'_>, engine: State<'_, Arc<Engine>>) -> Result<Response, String> {
    let channel = header(&request, "mefi-ch").ok_or("an invoke needs its channel")?.to_string();
    let tagged = header(&request, "mefi-tagged") == Some("1");
    let reply = engine.invoke(&channel, tagged, &body(&request)).await?;
    Ok(Response::new(InvokeResponseBody::Json(reply)))
}

#[tauri::command]
pub fn ipc_send(request: Request<'_>, engine: State<'_, Arc<Engine>>) -> Result<(), String> {
    let channel = header(&request, "mefi-ch").ok_or("a send needs its channel")?;
    let tagged = header(&request, "mefi-tagged") == Some("1");
    engine.send(channel, tagged, &body(&request))
}

#[tauri::command]
pub fn ipc_subscribe(channel: Channel<InvokeResponseBody>, engine: State<'_, Arc<Engine>>) {
    engine.set_push_channel(channel);
}

#[tauri::command]
pub fn ipc_console(level: String, message: String, source: String, line: u32, engine: State<'_, Arc<Engine>>) {
    engine.event("webContents:console-message", json!({ "level": level, "message": message, "source": source, "line": line }));
}

#[tauri::command]
pub fn ipc_menu(item: u64, engine: State<'_, Arc<Engine>>) {
    engine.event("menu:click", json!({ "item": item }));
}

#[tauri::command]
pub fn ipc_eval_result(id: u64, ok: bool, value: String, engine: State<'_, Arc<Engine>>) {
    let waiter = engine.evals.lock().ok().and_then(|mut map| map.remove(&id));
    if let Some(waiter) = waiter {
        let _ = waiter.send(if ok { Ok(value) } else { Err(value) });
    }
}

/// Zen's desktop audio (src/loopback.rs): the system's sound, streamed to
/// the page as mono float samples; answers { id, rate }.
#[tauri::command]
pub async fn audio_loopback_start(channel: Channel<InvokeResponseBody>) -> Result<Value, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || crate::loopback::start(channel)).await.map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = channel;
        Err("desktop audio needs Windows".into())
    }
}

#[tauri::command]
pub fn audio_loopback_stop(id: u64) {
    #[cfg(windows)]
    crate::loopback::stop_one(id);
}

/// Kept for a page that wants the host's view of itself (Help › About).
#[tauri::command]
pub fn ipc_host(engine: State<'_, Arc<Engine>>) -> Value {
    json!({ "kind": "tauri", "version": engine.studio.version, "packaged": engine.studio.packaged })
}
