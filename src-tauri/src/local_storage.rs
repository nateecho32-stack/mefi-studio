//! The page's localStorage from the Electron build, carried over once.
//!
//! Electron kept it in userData's "Local Storage/leveldb" (Chromium's
//! LevelDB), under "_file://\0" + key for Studio's file:// page; WebView2
//! keeps its own for http://mefi.localhost. On the first launch of the Rust
//! host the items are handed to the page's start script (src/init.js), which
//! writes the keys the page does not have yet. Once the page has loaded,
//! a marker file stops the hand-over; the Electron copy is never changed.

use std::path::{Path, PathBuf};

use rusty_leveldb::{LdbIterator, Options, DB};
use serde_json::{Map, Value};

const MARKER: &str = "electron-local-storage.imported";
const PREFIX: &[u8] = b"_file://\x00";

fn marker(user_data: &Path) -> PathBuf {
    user_data.join("WebView2").join(MARKER)
}

/// Chromium's localStorage strings: a 0 byte then UTF-16LE, or a 1 byte then Latin-1.
fn decode(bytes: &[u8]) -> Option<String> {
    match bytes.split_first()? {
        (0, rest) if rest.len() % 2 == 0 => String::from_utf16(&rest.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect::<Vec<_>>()).ok(),
        (1, rest) => Some(rest.iter().map(|&byte| byte as char).collect()),
        _ => None,
    }
}

/// The items of Studio's file:// page in a Chromium localStorage LevelDB.
pub fn read(leveldb: &Path) -> Result<Map<String, Value>, String> {
    // A copy, so the LevelDB recovery never writes into Electron's folder
    // (and a running Electron's lock is no obstacle).
    let copy = std::env::temp_dir().join(format!("mefi-local-storage-{}", crate::engine::random_hex(6)));
    std::fs::create_dir_all(&copy).map_err(|error| error.to_string())?;
    let result = (|| {
        for entry in std::fs::read_dir(leveldb).map_err(|error| error.to_string())?.flatten() {
            let name = entry.file_name();
            if name == "LOCK" || !entry.file_type().map(|kind| kind.is_file()).unwrap_or(false) {
                continue;
            }
            std::fs::copy(entry.path(), copy.join(&name)).map_err(|error| error.to_string())?;
        }
        let options = Options { create_if_missing: false, ..Options::default() };
        let mut db = DB::open(&copy, options).map_err(|error| error.to_string())?;
        let mut items = Map::new();
        let mut iter = db.new_iter().map_err(|error| error.to_string())?;
        iter.seek(PREFIX);
        while let Some((key, value)) = iter.current() {
            if !key.starts_with(PREFIX) {
                break;
            }
            if let (Some(key), Some(value)) = (decode(&key[PREFIX.len()..]), decode(&value)) {
                items.insert(key, Value::String(value));
            }
            if !iter.advance() {
                break;
            }
        }
        Ok(items)
    })();
    let _ = std::fs::remove_dir_all(&copy);
    result
}

/// The items to hand over on this launch, or None once they were.
pub fn pending(user_data: &Path) -> Option<Map<String, Value>> {
    if marker(user_data).exists() {
        return None;
    }
    let leveldb = user_data.join("Local Storage").join("leveldb");
    if !leveldb.is_dir() {
        return None;
    }
    match read(&leveldb) {
        Ok(items) if !items.is_empty() => Some(items),
        Ok(_) => None,
        Err(error) => {
            eprintln!("[mefi-host] the Electron build's localStorage could not be read: {error}");
            None
        }
    }
}

/// The page loaded with the items: hand-over done.
pub fn done(user_data: &Path) {
    let file = marker(user_data);
    if file.exists() {
        return;
    }
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(file, b"The Rust host carried the Electron build's page localStorage over once.\n");
}

#[cfg(test)]
mod tests {
    use super::decode;

    #[test]
    fn strings_decode_like_chromium() {
        assert_eq!(decode(b"\x01mefiStudio.size"), Some("mefiStudio.size".into()));
        assert_eq!(decode(b"\x01caf\xe9"), Some("caf\u{e9}".into()));
        assert_eq!(decode(&[0, 0x3d, 0xd8, 0x00, 0xde]), Some("\u{1f600}".into()));
        assert_eq!(decode(&[0, 0x41]), None);
        assert_eq!(decode(&[2, 0x41]), None);
        assert_eq!(decode(&[]), None);
        assert_eq!(decode(b"\x01"), Some(String::new()));
    }
}
