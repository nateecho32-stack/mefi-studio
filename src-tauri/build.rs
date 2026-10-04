use std::path::PathBuf;

// The Windows resource compiler cannot open a path with an apostrophe in it
// ("Mefi's Studio AI+"), so the window icon is copied into OUT_DIR first.
// scripts/rust-host.mjs keeps OUT_DIR (the target folder) on a plain path
// outside OneDrive.
fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"));
    let source = manifest.join("..").join("assets").join("icon.ico");
    println!("cargo:rerun-if-changed={}", source.display());
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("cargo sets OUT_DIR"));
    let icon = out.join("icon.ico");
    std::fs::copy(&source, &icon).expect("assets/icon.ico could not be copied");
    let windows = tauri_build::WindowsAttributes::new().window_icon_path(&icon);
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("tauri-build failed");
}
