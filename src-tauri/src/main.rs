// A release build has no console window; a debug build keeps one for the engine's log.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mefi_host::run();
}
