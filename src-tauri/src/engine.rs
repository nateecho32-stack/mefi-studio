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
