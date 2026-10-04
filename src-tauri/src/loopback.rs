//! Zen's "desktop audio" (renderer/idle.js): the sound Windows is playing,
//! with no source picker. Electron's display-media handler answered the
//! page's getDisplayMedia with the screen and loopback audio; WebView2 can
//! only show its picker. So the host records the default output device in
//! loopback (WASAPI) and streams it to the page, which plays it into a
//! MediaStream (src/init.js): mono 32-bit float at the device's rate, about
//! 50 ms per message. Nothing is kept or written anywhere.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

const WAVE_FORMAT_PCM: u16 = 1;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

fn running() -> &'static Mutex<HashMap<u64, Arc<AtomicBool>>> {
    static RUNNING: OnceLock<Mutex<HashMap<u64, Arc<AtomicBool>>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone, Copy)]
enum Sample {
    Float32,
    Int16,
    Int32,
}

/// Start recording; answers { id, rate } once the device is open.
pub fn start(channel: Channel<InvokeResponseBody>) -> Result<Value, String> {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    running().lock().map_err(|_| "loopback table poisoned")?.insert(id, stop.clone());
    let (opened_tx, opened_rx) = std::sync::mpsc::channel::<Result<u32, String>>();
    std::thread::Builder::new()
        .name("mefi-loopback".into())
        .spawn(move || {
            // SAFETY: COM is initialised on this thread and released at its end;
            // every interface lives inside `record`.
            unsafe {
                let initialised = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
                if let Err(error) = record(&channel, &stop, &opened_tx) {
                    let _ = opened_tx.send(Err(error));
                }
                if initialised {
                    CoUninitialize();
                }
            }
            if let Ok(mut table) = running().lock() {
                table.remove(&id);
            }
        })
        .map_err(|error| error.to_string())?;
    match opened_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(rate)) => Ok(json!({ "id": id, "rate": rate })),
        Ok(Err(error)) => Err(error),
        Err(_) => {
            stop_one(id);
            Err("the sound device did not open within 5 s".into())
        }
    }
}

/// Studio's page navigated or reloaded: nobody listens any more.
pub fn stop_all() {
    if let Ok(table) = running().lock() {
        for flag in table.values() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

pub fn stop_one(id: u64) {
    if let Some(flag) = running().lock().ok().and_then(|table| table.get(&id).cloned()) {
        flag.store(true, Ordering::Relaxed);
    }
}

unsafe fn record(channel: &Channel<InvokeResponseBody>, stop: &AtomicBool, opened: &std::sync::mpsc::Sender<Result<u32, String>>) -> Result<(), String> {
    let fail = |what: &str, error: windows::core::Error| format!("{what}: {}", error.message());
    let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|error| fail("no sound devices", error))?;
    let device = devices.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|error| fail("no output device", error))?;
    let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(|error| fail("the output device did not open", error))?;
    let format_ptr = client.GetMixFormat().map_err(|error| fail("no mix format", error))?;
    let format: WAVEFORMATEX = std::ptr::read_unaligned(format_ptr);
    let tag = if format.wFormatTag == WAVE_FORMAT_EXTENSIBLE && format.cbSize >= 22 {
        let extensible: WAVEFORMATEXTENSIBLE = std::ptr::read_unaligned(format_ptr.cast());
        let sub = extensible.SubFormat;
        sub.data1 as u16
    } else {
        format.wFormatTag
    };
    let sample = match (tag, format.wBitsPerSample) {
        (WAVE_FORMAT_IEEE_FLOAT, 32) => Sample::Float32,
        (WAVE_FORMAT_PCM, 16) => Sample::Int16,
        (WAVE_FORMAT_PCM, 32) => Sample::Int32,
        (tag, bits) => {
            CoTaskMemFree(Some(format_ptr.cast()));
            return Err(format!("the output device's format is not supported ({tag}, {bits} bits)"));
        }
    };
    let channels = usize::from(format.nChannels.max(1));
    let rate = format.nSamplesPerSec;
    let block = usize::from(format.nBlockAlign.max(1));
    // A 200 ms buffer, read every 20 ms.
    let initialised = client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 2_000_000, 0, format_ptr, None);
    CoTaskMemFree(Some(format_ptr.cast()));
    initialised.map_err(|error| fail("loopback recording did not start", error))?;
    let capture: IAudioCaptureClient = client.GetService().map_err(|error| fail("no capture service", error))?;
    client.Start().map_err(|error| fail("loopback recording did not start", error))?;
    let _ = opened.send(Ok(rate));
    let chunk = (rate as usize / 20).max(256);
    let mut pending: Vec<f32> = Vec::with_capacity(chunk * 2);
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(20));
        loop {
            let packet = capture.GetNextPacketSize().map_err(|error| fail("loopback recording stopped", error))?;
            if packet == 0 {
                break;
            }
            let mut data = std::ptr::null_mut::<u8>();
            let mut frames = 0u32;
            let mut flags = 0u32;
            capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None).map_err(|error| fail("loopback recording stopped", error))?;
            let count = frames as usize;
            if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                pending.extend(std::iter::repeat_n(0.0, count));
            } else {
                let bytes = std::slice::from_raw_parts(data, count * block);
                for frame in bytes.chunks_exact(block) {
                    let mut sum = 0.0f32;
                    for index in 0..channels {
                        sum += match sample {
                            Sample::Float32 => f32::from_le_bytes(frame[index * 4..index * 4 + 4].try_into().unwrap_or([0; 4])),
                            Sample::Int16 => f32::from(i16::from_le_bytes(frame[index * 2..index * 2 + 2].try_into().unwrap_or([0; 2]))) / 32768.0,
                            Sample::Int32 => i32::from_le_bytes(frame[index * 4..index * 4 + 4].try_into().unwrap_or([0; 4])) as f32 / 2_147_483_648.0,
                        };
                    }
                    pending.push(sum / channels as f32);
                }
            }
            capture.ReleaseBuffer(frames).map_err(|error| fail("loopback recording stopped", error))?;
        }
        if pending.len() >= chunk {
            let bytes: Vec<u8> = pending.drain(..).flat_map(f32::to_le_bytes).collect();
            // The page is gone (reload, close): stop.
            if channel.send(InvokeResponseBody::Raw(bytes)).is_err() {
                break;
            }
        }
    }
    let _ = client.Stop();
    Ok(())
}
