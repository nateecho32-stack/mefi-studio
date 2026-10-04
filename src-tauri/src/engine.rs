//! The engine sidecar: main.cjs under plain Node, reached over a named pipe.
//! Stage 1 of docs/rust-migration.md keeps every one of the 302 channels in
//! JavaScript; this module only carries frames. When a channel moves into
//! Rust it is answered in `invoke` before the engine sees it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

use crate::{native, paths::Studio, wire};

type Writer = mpsc::UnboundedSender<Vec<u8>>;

pub struct Engine {
    pub app: AppHandle,
    pub studio: Studio,
    token: String,
    pipe_name: String,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Vec<u8>>>>,
    main: Mutex<Option<Writer>>,
    pushes: Mutex<Option<Channel<InvokeResponseBody>>>,
    pub evals: Mutex<HashMap<u64, oneshot::Sender<Result<String, String>>>>,
    /// Engine functions a ported module is waiting on (callback frames).
    callbacks: Mutex<HashMap<u64, std::sync::mpsc::Sender<Result<Value, String>>>>,
    /// Some(args) once the engine asked for app.relaunch; None args = same as this launch.
    pub relaunch: Mutex<Option<Option<Vec<String>>>>,
    exiting: AtomicBool,
}

pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    if getrandom::fill(&mut buf).is_err() {
        let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        for (i, byte) in buf.iter_mut().enumerate() {
            *byte = (seed >> ((i % 16) * 8)) as u8 ^ (std::process::id() as u8);
        }
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

impl Engine {
    pub fn new(app: AppHandle, studio: Studio) -> Arc<Self> {
        Arc::new(Engine {
            app,
            studio,
            token: random_hex(24),
            pipe_name: format!(r"\\.\pipe\mefi-studio-{}-{}", std::process::id(), random_hex(6)),
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            main: Mutex::new(None),
            pushes: Mutex::new(None),
            evals: Mutex::new(HashMap::new()),
            callbacks: Mutex::new(HashMap::new()),
            relaunch: Mutex::new(None),
            exiting: AtomicBool::new(false),
        })
    }

    fn main_writer(&self) -> Option<Writer> {
        self.main.lock().ok().and_then(|slot| slot.clone())
    }

    fn write_main(&self, frame: Vec<u8>) -> Result<(), String> {
        let writer = self.main_writer().ok_or("Studio's engine is not running")?;
        writer.send(frame).map_err(|_| "Studio's engine is not running".to_string())
    }

    /// A page invoke: the frame the engine answers with, as JSON text.
    pub async fn invoke(&self, channel: &str, tagged: bool, body: &[u8]) -> Result<String, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let frame = wire::with_body(&wire::head("invoke", Some(id), Some(channel), tagged), body)?;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().map_err(|_| "engine state poisoned")?.insert(id, tx);
        if let Err(error) = self.write_main(frame) {
            self.pending.lock().ok().map(|mut map| map.remove(&id));
            return Err(error);
        }
        let line = rx.await.map_err(|_| "Studio's engine stopped before it answered".to_string())?;
        String::from_utf8(line).map_err(|_| "the engine's answer was not UTF-8".into())
    }

    pub fn send(&self, channel: &str, tagged: bool, body: &[u8]) -> Result<(), String> {
        self.write_main(wire::with_body(&wire::head("send", None, Some(channel), tagged), body)?)
    }

    /// An event for the engine's Electron objects, `target:name` (window:focus, tray:click, ...).
    pub fn event(&self, name: &str, body: Value) {
        let frame = wire::value_frame(&json!({ "t": "event", "ch": name, "body": body }));
        let _ = self.write_main(frame);
    }

    pub fn set_push_channel(&self, channel: Channel<InvokeResponseBody>) {
        if let Ok(mut slot) = self.pushes.lock() {
            *slot = Some(channel);
        }
    }

    pub fn clear_push_channel(&self) {
        if let Ok(mut slot) = self.pushes.lock() {
            *slot = None;
        }
    }

    fn push(&self, line: Vec<u8>) {
        let channel = self.pushes.lock().ok().and_then(|slot| slot.clone());
        // Like Electron's webContents.send before the page listens: dropped.
        if let (Some(channel), Ok(text)) = (channel, String::from_utf8(line)) {
            let _ = channel.send(InvokeResponseBody::Json(text));
        }
    }

    pub fn is_exiting(&self) -> bool {
        self.exiting.load(Ordering::Relaxed)
    }

    // ---- starting ----

    pub fn start(self: &Arc<Self>, args: Vec<String>, info: Value) -> Result<(), String> {
        let first = tokio::net::windows::named_pipe::ServerOptions::new()
            .first_pipe_instance(true)
            .reject_remote_clients(true)
            .create(&self.pipe_name)
            .map_err(|error| format!("could not open the engine pipe: {error}"))?;
        let engine = self.clone();
        tauri::async_runtime::spawn(async move { engine.accept(first).await });

        let node = self.studio.node_executable();
        let mut command = tokio::process::Command::new(&node);
        command
            .arg(self.studio.root.join("main.cjs"))
            .args(&args)
            .current_dir(&self.studio.root)
            .env("MEFI_STUDIO_HOST", "tauri")
            .env("MEFI_HOST_PIPE", &self.pipe_name)
            .env("MEFI_HOST_TOKEN", &self.token)
            .env("MEFI_HOST_INFO", info.to_string())
            .env_remove("ELECTRON_RUN_AS_NODE")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let mut child = command
            .spawn()
            .map_err(|error| format!("could not start Studio's engine with {}: {error}", node.display()))?;
        for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)].into_iter().flatten() {
            tauri::async_runtime::spawn(relay_output(stream));
        }
        let engine = self.clone();
        tauri::async_runtime::spawn(async move {
            let code = match child.wait().await {
                Ok(status) => status.code().unwrap_or(1),
                Err(_) => 1,
            };
            engine.engine_exited(code);
        });
        Ok(())
    }

    fn engine_exited(&self, code: i32) {
        self.exiting.store(true, Ordering::Relaxed);
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
        let relaunch = self.relaunch.lock().ok().and_then(|slot| slot.clone());
        if let Some(args) = relaunch {
            native::relaunch_self(args);
        }
        eprintln!("[mefi-host] engine exited with code {code}");
        self.app.exit(code);
    }

    async fn accept(self: Arc<Self>, mut server: tokio::net::windows::named_pipe::NamedPipeServer) {
        loop {
            if server.connect().await.is_err() {
                return;
            }
            let next = match tokio::net::windows::named_pipe::ServerOptions::new()
                .reject_remote_clients(true)
                .create(&self.pipe_name)
            {
                Ok(next) => next,
                Err(_) => return,
            };
            let connected = std::mem::replace(&mut server, next);
            let engine = self.clone();
            tauri::async_runtime::spawn(async move { engine.serve(connected).await });
        }
    }

    async fn serve(self: Arc<Self>, pipe: tokio::net::windows::named_pipe::NamedPipeServer) {
        let (read, mut write) = tokio::io::split(pipe);
        let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
        tauri::async_runtime::spawn(async move {
            while let Some(bytes) = rx.recv().await {
                if write.write_all(&bytes).await.is_err() {
                    break;
                }
            }
        });
        let mut reader = BufReader::with_capacity(1 << 16, read);
        let mut line = Vec::with_capacity(1 << 12);
        let mut role: Option<String> = None;
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            while matches!(line.last(), Some(b'\n' | b'\r')) {
                line.pop();
            }
            if line.is_empty() {
                continue;
            }
            let head = match wire::parse_head(&line) {
                Ok(head) => head,
                Err(error) => {
                    eprintln!("[mefi-host] {error}");
                    continue;
                }
            };
            if role.is_none() {
                // The first frame must be the engine's hello with this launch's token.
                if head.t != "hello" || head.token.as_deref() != Some(self.token.as_str()) {
                    eprintln!("[mefi-host] refused a pipe client without the launch token");
                    return;
                }
                let kind = head.role.clone().unwrap_or_else(|| "main".into());
                if kind == "main" {
                    if let Ok(mut slot) = self.main.lock() {
                        *slot = Some(tx.clone());
                    }
                    let welcome = json!({ "t": "welcome", "body": { "displays": native::displays(&self.app) } });
                    let _ = tx.send(wire::value_frame(&welcome));
                }
                role = Some(kind);
                continue;
            }
            match head.t.as_str() {
                "result" => {
                    let waiter = head.id.and_then(|id| self.pending.lock().ok().and_then(|mut map| map.remove(&id)));
                    if let Some(waiter) = waiter {
                        let _ = waiter.send(line.clone());
                    }
                }
                "push" => self.push(line.clone()),
                "call" if head.api.as_deref().is_some_and(|api| api.starts_with("eyes.")) => {
                    // A store read moved into Rust: answered on a blocking
                    // thread, its JSON text sent back unparsed.
                    let id = head.id.unwrap_or(0);
                    let method = head.api.as_deref().unwrap_or_default().trim_start_matches("eyes.").to_string();
                    count_rust_call(&format!("eyes.{method}"));
                    let args = head.body.map(|raw| raw.get().to_string()).unwrap_or_else(|| "[]".into());
                    let reply_to = tx.clone();
                    tauri::async_runtime::spawn(async move {
                        let answer = tauri::async_runtime::spawn_blocking(move || {
                            let list: Value = serde_json::from_str(&args).unwrap_or(Value::Null);
                            let input = list.get(0).cloned().unwrap_or_else(|| json!({}));
                            mefi_core::eyes::call_json(&method, &input)
                        })
                        .await;
                        let frame = match answer {
                            Ok(Ok(text)) => wire::with_body(&format!("{{\"t\":\"reply\",\"id\":{id},\"ok\":true"), text.as_bytes())
                                .unwrap_or_else(|error| wire::value_frame(&json!({ "t": "reply", "id": id, "ok": false, "error": error }))),
                            Ok(Err(error)) => wire::value_frame(&json!({ "t": "reply", "id": id, "ok": false, "error": error })),
                            Err(error) => wire::value_frame(&json!({ "t": "reply", "id": id, "ok": false, "error": format!("the store read stopped: {error}") })),
                        };
                        let _ = reply_to.send(frame);
                    });
                }
                "call" if head.api.as_deref().is_some_and(|api| api.starts_with("repo.") || api.starts_with("core.")) => {
                    // A module function moved into Rust (scripts/rust-modules.cjs):
                    // run on a blocking thread, able to call the engine's
                    // function arguments back while it runs.
                    let id = head.id.unwrap_or(0);
                    let api = head.api.clone().unwrap_or_default();
                    count_rust_call(&api);
                    let function = api.strip_prefix("repo.").or_else(|| api.strip_prefix("core.")).unwrap_or(&api).to_string();
                    let args = head.body.map(|raw| raw.get().to_string()).unwrap_or_else(|| "[]".into());
                    let callbacks = HostCallbacks { engine: self.clone(), writer: tx.clone() };
                    let reply_to = tx.clone();
                    tauri::async_runtime::spawn(async move {
                        let answer = tauri::async_runtime::spawn_blocking(move || {
                            let list: Value = serde_json::from_str(&args).unwrap_or(Value::Null);
                            let list = list.as_array().cloned().unwrap_or_default();
                            mefi_core::dispatch(&function, &list, &callbacks).map(|value| value.to_string())
                        })
                        .await;
                        let frame = match answer {
                            Ok(Ok(text)) => wire::with_body(&format!("{{\"t\":\"reply\",\"id\":{id},\"ok\":true"), text.as_bytes())
                                .unwrap_or_else(|error| wire::value_frame(&json!({ "t": "reply", "id": id, "ok": false, "error": error }))),
                            Ok(Err(error)) => wire::value_frame(&json!({ "t": "reply", "id": id, "ok": false, "error": error })),
                            Err(error) => wire::value_frame(&json!({ "t": "reply", "id": id, "ok": false, "error": format!("the call stopped: {error}") })),
                        };
                        let _ = reply_to.send(frame);
                    });
                }
                "callback-reply" => {
                    let frame: Value = serde_json::from_slice(&line).unwrap_or(Value::Null);
                    let waiter = head.id.and_then(|id| self.callbacks.lock().ok().and_then(|mut map| map.remove(&id)));
                    if let Some(waiter) = waiter {
                        let _ = waiter.send(if frame["ok"] == json!(true) { Ok(frame["body"].clone()) } else { Err(frame["error"].as_str().unwrap_or("the engine function failed").to_string()) });
                    }
                }
                "call" => {
                    let id = head.id.unwrap_or(0);
                    let api = head.api.clone().unwrap_or_default();
                    let args = head.body.map(|raw| raw.get().to_string()).unwrap_or_else(|| "[]".into());
                    let engine = self.clone();
                    let reply_to = tx.clone();
                    tauri::async_runtime::spawn(async move {
                        let args: Value = serde_json::from_str(&args).unwrap_or(Value::Array(vec![]));
                        let result = native::call(&engine, &api, args).await;
                        let frame = match result {
                            Ok(value) => {
                                let tagged = native::holds_tag(&value);
                                json!({ "t": "reply", "id": id, "ok": true, "tagged": tagged, "body": value })
                            }
                            Err(error) => json!({ "t": "reply", "id": id, "ok": false, "error": error }),
                        };
                        let _ = reply_to.send(wire::value_frame(&frame));
                    });
                }
                "cast" => {
                    let api = head.api.clone().unwrap_or_default();
                    let args: Value = head.body.and_then(|raw| serde_json::from_str(raw.get()).ok()).unwrap_or(Value::Array(vec![]));
                    let engine = self.clone();
                    // Casts keep their order: the window's are applied on the main thread in turn.
                    native::cast(&engine, &api, args);
                }
                other => eprintln!("[mefi-host] unknown engine frame '{other}'"),
            }
        }
        if role.as_deref() == Some("main") {
            if let Ok(mut slot) = self.main.lock() {
                *slot = None;
            }
        }
    }
}

async fn relay_output(mut stream: Box<dyn tokio::io::AsyncRead + Unpin + Send>) {
    let mut buf = vec![0u8; 8192];
    loop {
        match stream.read(&mut buf).await {
            Ok(0) | Err(_) => return,
            Ok(n) => {
                use std::io::Write;
                let _ = std::io::stderr().write_all(&buf[..n]);
            }
        }
    }
}

/// Runs an engine function a ported module was handed, by asking the engine.
struct HostCallbacks {
    engine: Arc<Engine>,
    writer: Writer,
}

impl mefi_core::callbacks::Callbacks for HostCallbacks {
    fn call(&self, handle: &Value, args: Vec<Value>) -> Result<Value, String> {
        // sync's check runs the project's `npm run check`, up to 10 minutes.
        self.call_within(handle, args, std::time::Duration::from_secs(15 * 60))
    }

    fn call_within(&self, handle: &Value, args: Vec<Value>, limit: std::time::Duration) -> Result<Value, String> {
        let id = self.engine.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = std::sync::mpsc::channel();
        self.engine.callbacks.lock().map_err(|_| "engine state poisoned")?.insert(id, tx);
        // Bytes (a picture for a preview) cross tagged, as every other frame's do.
        let tagged = args.iter().any(native::holds_tag);
        let frame = wire::value_frame(&json!({ "t": "callback", "id": id, "fn": handle["id"], "tagged": tagged, "body": args }));
        if self.writer.send(frame).is_err() {
            self.engine.callbacks.lock().ok().map(|mut map| map.remove(&id));
            return Err("Studio's engine is not running".into());
        }
        let answer = rx.recv_timeout(limit);
        self.engine.callbacks.lock().ok().map(|mut map| map.remove(&id));
        answer.unwrap_or_else(|_| Err(mefi_core::callbacks::TIMED_OUT.into()))
    }
}

/// How many engine calls each moved module answered in Rust (the self-test reports it).
pub fn rust_calls() -> &'static Mutex<std::collections::BTreeMap<String, u64>> {
    static CALLS: std::sync::OnceLock<Mutex<std::collections::BTreeMap<String, u64>>> = std::sync::OnceLock::new();
    CALLS.get_or_init(|| Mutex::new(std::collections::BTreeMap::new()))
}

fn count_rust_call(name: &str) {
    if let Ok(mut calls) = rust_calls().lock() {
        *calls.entry(name.to_string()).or_insert(0) += 1;
    }
}

/// The engine handle every command and callback reaches through Tauri's state.
pub fn engine(app: &AppHandle) -> Arc<Engine> {
    app.state::<Arc<Engine>>().inner().clone()
}

/// The arguments this launch passes to the engine: the host's own, minus the
/// host-only ones, the same way Electron handed main its argv.
pub fn engine_args() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with("--relaunch-after="))
        .collect()
}

pub fn exe_path() -> PathBuf {
    std::env::current_exe().unwrap_or_else(|_| PathBuf::from("mefi-studio.exe"))
}
