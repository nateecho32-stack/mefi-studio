//! Mefi's Studio AI+, Rust host. Stage 1 of docs/rust-migration.md: this
//! program is the app (window, tray, dialogs, the page's bridge, saved-key
//! decryption), and the engine, main.cjs, runs beside it under Node until its
//! channels move here one by one.

mod bridge;
pub mod engine;
mod native;
mod oscrypt;
mod paths;
mod power;
mod protocol;
#[cfg(windows)]
mod toast;
#[cfg(windows)]
mod webview2;
mod wire;

use serde_json::json;
use tauri::{Manager, RunEvent};

use crate::engine::{engine_args, Engine};
use crate::paths::Studio;

/// Launches that never open a window: main.cjs's CLI_MODE flags, smoke boots
/// and the screenshot tour. They skip the single-instance lock, as before.
const HEADLESS_FLAGS: &[&str] = &[
    "--smoke", "--capture", "--capture-idle", "--set-key", "--set-zai-key", "--set-custom-key", "--set-gateway-key",
    "--set-jev-key", "--set-zen-key", "--set-openrouter-key", "--jev-probe", "--jev-status", "--jev-models",
    "--speed-probe", "--assistant-brief", "--assistant-improve", "--assistant-grow", "--assistant-audit",
    "--assistant-proactive", "--assistant-all",
];

fn fatal(message: &str) -> ! {
    eprintln!("[mefi-host] {message}");
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("Mefi's Studio AI+ could not start")
        .set_description(message)
        .show();
    std::process::exit(1);
}

/// app.relaunch: the new copy waits for the old one to let go of the lock.
fn wait_for_previous() {
    let Some(pid) = std::env::args().find_map(|arg| arg.strip_prefix("--relaunch-after=").and_then(|pid| pid.parse::<u32>().ok())) else {
        return;
    };
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
        // SAFETY: the handle is checked and closed.
        unsafe {
            let handle = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
            if !handle.is_null() {
                WaitForSingleObject(handle, 15_000);
                CloseHandle(handle);
            }
        }
    }
}

pub fn run() {
    wait_for_previous();
    let studio = Studio::locate().unwrap_or_else(|error| fatal(&error));
    let args = engine_args();
    let headless = args.iter().any(|arg| HEADLESS_FLAGS.contains(&arg.as_str()));

    let mut builder = tauri::Builder::default();
    if !headless {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            // A second launch that races this one's start finds no engine yet;
            // the window it would show is not open either.
            if let Some(engine) = app.try_state::<std::sync::Arc<Engine>>() {
                engine.event("app:second-instance", json!({ "argv": argv, "cwd": cwd }));
            }
        }));
    }
    let setup_studio = studio.clone();
    let app = builder
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol("mefi", protocol::handler(studio.root.clone()))
        .invoke_handler(tauri::generate_handler![
            bridge::ipc_invoke,
            bridge::ipc_send,
            bridge::ipc_subscribe,
            bridge::ipc_console,
            bridge::ipc_menu,
            bridge::ipc_eval_result,
            bridge::ipc_host,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let studio = setup_studio.clone();
            let engine = Engine::new(handle.clone(), studio.clone());
            app.manage(engine.clone());
            app.on_menu_event(|app, event| {
                if let Ok(item) = event.id().0.parse::<u64>() {
                    engine::engine(app).event("menu:click", json!({ "item": item }));
                }
            });
            let info = json!({
                "host": "tauri",
                "name": studio.product,
                "version": studio.version,
                "isPackaged": studio.packaged,
                "studioRoot": studio.root.to_string_lossy(),
                "hostExe": engine::exe_path().to_string_lossy(),
                "paths": studio.electron_paths(&handle),
                "displays": native::displays(&handle),
                "notifications": cfg!(windows),
            });
            // The pipe and the child belong to Tokio's runtime; setup runs outside it.
            let starting = engine.clone();
            let launch = args.clone();
            if let Err(error) = tauri::async_runtime::block_on(async move { starting.start(launch, info) }) {
                fatal(&error);
            }
            power::watch(engine.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| fatal(&format!("the window system did not start: {error}")));

    app.run(|app, event| {
        if let RunEvent::ExitRequested { code, api, .. } = event {
            // The last window closing is the engine's decision (tray, background
            // mode); the host leaves when the engine does.
            if code.is_none() && !app.state::<std::sync::Arc<Engine>>().is_exiting() {
                api.prevent_exit();
            }
        }
    });
}
