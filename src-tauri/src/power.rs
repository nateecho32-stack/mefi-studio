//! Electron's powerMonitor events for the engine: suspend, resume,
//! lock-screen and unlock-screen. Suspend and resume come from a power
//! callback; lock and unlock from a message-only window registered for
//! session changes, on a thread of its own so Tauri's event loop is untouched.

use std::sync::{Arc, OnceLock};

use serde_json::Value;

use crate::engine::Engine;

static ENGINE: OnceLock<Arc<Engine>> = OnceLock::new();

fn tell(name: &str) {
    if let Some(engine) = ENGINE.get() {
        engine.event(name, Value::Null);
    }
}

pub fn watch(engine: Arc<Engine>) {
    if ENGINE.set(engine).is_err() {
        return;
    }
    #[cfg(windows)]
    std::thread::Builder::new()
        .name("mefi-power-watch".into())
        .spawn(|| unsafe { win::run() })
        .ok();
}

#[cfg(windows)]
mod win {
    use windows_sys::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Power::{PowerRegisterSuspendResumeNotification, DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS};
    use windows_sys::Win32::System::RemoteDesktop::{WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, TranslateMessage, DEVICE_NOTIFY_CALLBACK, HWND_MESSAGE, MSG,
        PBT_APMRESUMEAUTOMATIC, PBT_APMSUSPEND, WM_WTSSESSION_CHANGE, WNDCLASSW, WTS_SESSION_LOCK, WTS_SESSION_UNLOCK,
    };

    unsafe extern "system" fn on_power(_context: *const core::ffi::c_void, kind: u32, _setting: *const core::ffi::c_void) -> u32 {
        // RESUMEAUTOMATIC follows every wake (RESUMESUSPEND only one a person
        // caused), so it alone stands for Electron's single "resume".
        match kind {
            PBT_APMSUSPEND => super::tell("power:suspend"),
            PBT_APMRESUMEAUTOMATIC => super::tell("power:resume"),
            _ => {}
        }
        0
    }

    unsafe extern "system" fn on_message(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if message == WM_WTSSESSION_CHANGE {
            match wparam as u32 {
                WTS_SESSION_LOCK => super::tell("power:lock-screen"),
                WTS_SESSION_UNLOCK => super::tell("power:unlock-screen"),
                _ => {}
            }
        }
        DefWindowProcW(hwnd, message, wparam, lparam)
    }

    pub unsafe fn run() {
        // The registration lives as long as the process, so its parameters do too.
        let parameters = Box::leak(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS { Callback: Some(on_power), Context: std::ptr::null_mut() }));
        let mut registration = std::ptr::null_mut();
        PowerRegisterSuspendResumeNotification(DEVICE_NOTIFY_CALLBACK, parameters as *mut _ as HANDLE, &mut registration);

        let class: Vec<u16> = "MefiStudioPowerWatch\0".encode_utf16().collect();
        let instance = GetModuleHandleW(std::ptr::null());
        let window_class = WNDCLASSW {
            lpfnWndProc: Some(on_message),
            hInstance: instance,
            lpszClassName: class.as_ptr(),
            ..std::mem::zeroed()
        };
        RegisterClassW(&window_class);
        let hwnd = CreateWindowExW(0, class.as_ptr(), class.as_ptr(), 0, 0, 0, 0, 0, HWND_MESSAGE, std::ptr::null_mut(), instance, std::ptr::null());
        if hwnd.is_null() {
            return;
        }
        WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}
