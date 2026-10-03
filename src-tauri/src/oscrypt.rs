//! Electron's safeStorage key on Windows. Chromium's OSCrypt keeps a random
//! AES-256-GCM key in userData's "Local State" as
//! `os_crypt.encrypted_key` = base64("DPAPI" + CryptProtectData(key)).
//! Reading the same key lets the Rust host open every API key Studio saved
//! under Electron; on a fresh install it writes one the same way, so an
//! Electron build could still read what this host saved.

use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};

const PREFIX: &[u8] = b"DPAPI";

pub fn key(user_data: &Path) -> Result<Vec<u8>, String> {
    let file = user_data.join("Local State");
    let mut state: Value = match std::fs::read(&file) {
        Ok(bytes) => serde_json::from_slice(crate::paths::strip_bom(&bytes))
            .map_err(|error| format!("Local State is not readable JSON: {error}"))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(error) => return Err(format!("cannot read Local State: {error}")),
    };
    if let Some(saved) = state.pointer("/os_crypt/encrypted_key").and_then(Value::as_str) {
        let blob = STANDARD.decode(saved).map_err(|_| "Local State's key is not base64".to_string())?;
        let protected = blob.strip_prefix(PREFIX).ok_or("Local State's key is not DPAPI-protected")?;
        let key = dpapi::unprotect(protected)?;
        if key.len() != 32 {
            return Err(format!("Local State's key is {} bytes, not 32", key.len()));
        }
        return Ok(key);
    }
    let mut key = vec![0u8; 32];
    getrandom::fill(&mut key).map_err(|error| format!("no randomness for a new key: {error}"))?;
    let mut blob = PREFIX.to_vec();
    blob.extend(dpapi::protect(&key)?);
    if !state.is_object() {
        state = json!({});
    }
    let os_crypt = state.as_object_mut().unwrap().entry("os_crypt").or_insert_with(|| json!({}));
    if !os_crypt.is_object() {
        *os_crypt = json!({});
    }
    os_crypt["encrypted_key"] = json!(STANDARD.encode(blob));
    std::fs::create_dir_all(user_data).map_err(|error| format!("cannot create {}: {error}", user_data.display()))?;
    let temp = user_data.join(format!("Local State.{}.tmp", std::process::id()));
    std::fs::write(&temp, serde_json::to_vec(&state).unwrap_or_default()).map_err(|error| format!("cannot write Local State: {error}"))?;
    std::fs::rename(&temp, &file).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        format!("cannot replace Local State: {error}")
    })?;
    Ok(key)
}

#[cfg(windows)]
mod dpapi {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    fn run(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY: input points at `data` for the call; output is allocated by
        // the system and released with LocalFree below.
        let ok = unsafe {
            if protect {
                CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
            } else {
                CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
            }
        };
        if ok == 0 || output.pbData.is_null() {
            return Err(format!("DPAPI {} failed: {}", if protect { "protect" } else { "unprotect" }, std::io::Error::last_os_error()));
        }
        // SAFETY: the system wrote cbData bytes at pbData.
        let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
        unsafe { LocalFree(output.pbData as _) };
        Ok(bytes)
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        run(data, true)
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        run(data, false)
    }
}

#[cfg(not(windows))]
mod dpapi {
    pub fn protect(_: &[u8]) -> Result<Vec<u8>, String> {
        Err("safeStorage needs Windows DPAPI in this host".into())
    }
    pub fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> {
        Err("safeStorage needs Windows DPAPI in this host".into())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_key_is_written_and_read_back() {
        let dir = std::env::temp_dir().join(format!("mefi-oscrypt-{}", crate::engine::random_hex(6)));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Local State"), br#"{"browser":{"x":1}}"#).unwrap();
        let first = key(&dir).unwrap();
        let second = key(&dir).unwrap();
        assert_eq!(first.len(), 32);
        assert_eq!(first, second);
        let state: Value = serde_json::from_slice(&std::fs::read(dir.join("Local State")).unwrap()).unwrap();
        assert_eq!(state["browser"]["x"], 1, "other Local State keys are kept");
        std::fs::remove_dir_all(&dir).ok();
    }
}
