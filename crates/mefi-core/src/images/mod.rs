//! Where a message's pictures live (scripts/image-store.cjs createImageStore):
//! one folder under the project's own data folder, two files per picture
//! (`<id>.<ext>` and its `<id>.json` record), written atomically. A message
//! carries ids, never paths; this is the only thing that turns an id into a
//! file. Pictures nobody sent go after a day, and the folder holds at most
//! 300 pictures and 300 MB.
//!
//! The engine's collaborators come first in every call: `dir()` (the folder;
//! a project switch moves it), optionally `keep()` (every id a message or a
//! task still names) and `thumbnail(bytes, mime)` (a small preview as a data
//! URL). What may be saved is `attach`.

pub mod attach;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use serde_json::{json, Value};

use crate::callbacks::{invoke, is_function, Callbacks};
use crate::js;
use crate::js_regex;

const HOUR_MS: f64 = 3_600_000.0;
const ORPHAN_MS: f64 = 24.0 * HOUR_MS;
const MAX_STORED: usize = 300;
const MAX_FOLDER_BYTES: f64 = 300.0 * 1024.0 * 1024.0;
const THUMB_MAX_CHARS: usize = 30000;
const THUMB_ORIGINAL_MAX_BYTES: usize = 12000;

/// When each folder was last tidied (the JavaScript store keeps this per store).
fn last_prune() -> &'static Mutex<HashMap<String, f64>> {
    static LAST: OnceLock<Mutex<HashMap<String, f64>>> = OnceLock::new();
    LAST.get_or_init(|| Mutex::new(HashMap::new()))
}

fn random_hex(count: usize) -> String {
    let mut bytes = vec![0u8; count.div_ceil(2)];
    #[cfg(windows)]
    {
        // BCryptGenRandom through the system RNG the standard library seeds HashMap with.
        use std::collections::hash_map::RandomState;
        use std::hash::{BuildHasher, Hasher};
        for chunk in bytes.chunks_mut(8) {
            let mut hasher = RandomState::new().build_hasher();
            hasher.write_u128(std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
            let value = hasher.finish().to_le_bytes();
            chunk.copy_from_slice(&value[..chunk.len()]);
        }
    }
    #[cfg(not(windows))]
    {
        use std::io::Read;
        if let Ok(mut file) = std::fs::File::open("/dev/urandom") {
            let _ = file.read_exact(&mut bytes);
        }
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>()[..count].to_string()
}

/// Node's words for a failed file call: `CODE: description`.
fn io_message(error: &std::io::Error) -> String {
    use std::io::ErrorKind::*;
    let (code, words) = match error.kind() {
        NotFound => ("ENOENT", "no such file or directory"),
        PermissionDenied => ("EPERM", "operation not permitted"),
        AlreadyExists => ("EEXIST", "file already exists"),
        _ => ("EIO", "i/o error"),
    };
    format!("{code}: {words}")
}

fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos() as f64 / 1e6).unwrap_or(0.0)
}

struct Store<'a> {
    collaborators: &'a Value,
    callbacks: &'a dyn Callbacks,
}

impl Store<'_> {
    fn has(&self, name: &str) -> bool {
        self.collaborators.get(name).is_some_and(is_function)
    }

    fn call(&self, name: &str, args: Vec<Value>) -> Result<Value, String> {
        let handle = self.collaborators.get(name).ok_or("no such collaborator")?;
        invoke(self.callbacks, handle, args)
    }

    /// `path.resolve(String(dir()))`.
    fn folder(&self) -> Result<PathBuf, String> {
        let dir = self.call("dir", vec![])?;
        Ok(PathBuf::from(crate::paths::resolve(&js::string(&dir))))
    }

    fn file_of(&self, folder: &Path, id: &str, ext: &str) -> PathBuf {
        folder.join(format!("{id}.{ext}"))
    }

    fn meta_of(&self, folder: &Path, id: &str) -> PathBuf {
        folder.join(format!("{id}.json"))
    }

    /// Atomic: the whole file appears at once or not at all.
    fn write(&self, target: &Path, body: &[u8]) -> std::io::Result<()> {
        let temporary = PathBuf::from(format!("{}.tmp-{}-{}", target.to_string_lossy(), std::process::id(), random_hex(8)));
        let result = std::fs::write(&temporary, body).and_then(|_| std::fs::rename(&temporary, target));
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result
    }

    fn read_meta(&self, folder: &Path, id: &str) -> Option<Value> {
        if !attach::is_id(&json!(id)) {
            return None;
        }
        let text = std::fs::read_to_string(self.meta_of(folder, id)).ok()?;
        let meta: Value = serde_json::from_str(text.strip_prefix('\u{feff}').unwrap_or(&text)).ok()?;
        let mime = meta.get("mime").and_then(Value::as_str)?;
        let ext = attach::ext_of(mime)?;
        (meta.get("id").and_then(Value::as_str) == Some(id) && meta.get("ext").and_then(Value::as_str) == Some(ext)).then_some(meta)
    }

    fn preview(&self, bytes: &[u8], mime: &str) -> Value {
        if self.has("thumbnail") {
            if let Ok(Value::String(made)) = self.call("thumbnail", vec![json!({ "$mefi": "bytes", "b64": attach::to_base64(bytes) }), json!(mime)]) {
                if js_regex!(r"^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$", "").is_match(&made) && js::utf16_len(&made) <= THUMB_MAX_CHARS {
                    return json!(made);
                }
            }
        }
        if bytes.len() <= THUMB_ORIGINAL_MAX_BYTES {
            json!(format!("data:{mime};base64,{}", attach::to_base64(bytes)))
        } else {
            Value::Null
        }
    }

    fn save(&self, request: &Value) -> Value {
        let bytes = match attach::decode(request.get("data").unwrap_or(&Value::Null)) {
            Ok(bytes) => bytes,
            Err(refused) => return refused,
        };
        let verdict = match attach::inspect(request.get("name").unwrap_or(&Value::Null), request.get("mime").unwrap_or(&Value::Null), &bytes) {
            Ok(verdict) => verdict,
            Err(refused) => return refused,
        };
        let saved = (|| -> Result<Value, String> {
            let folder = self.folder()?;
            std::fs::create_dir_all(&folder).map_err(|error| io_message(&error))?;
            let key = folder.to_string_lossy().into_owned();
            let last = last_prune().lock().ok().and_then(|map| map.get(&key).copied()).unwrap_or(0.0);
            if self.has("keep") && js::now_ms() - last > HOUR_MS {
                let _ = self.prune(&Value::Null);
            }
            let stored = std::fs::read_dir(&folder)
                .map(|entries| entries.flatten().filter(|entry| js_regex!(r"^(img_[a-f0-9]{24})\.json$", "").is_match(&entry.file_name().to_string_lossy())).count())
                .unwrap_or(0);
            if stored >= MAX_STORED {
                return Ok(json!({ "ok": false, "error": "Too many pictures are saved. Send or remove some, and Studio clears the ones nobody sent after a day." }));
            }
            let id = format!("img_{}", random_hex(24));
            let meta = json!({
                "id": id, "name": verdict.name, "mime": verdict.mime, "ext": verdict.ext, "bytes": verdict.bytes,
                "width": js::num(verdict.width), "height": js::num(verdict.height), "at": js::num(js::now_ms().floor()),
            });
            let file = self.file_of(&folder, &id, verdict.ext);
            self.write(&file, &bytes).map_err(|error| io_message(&error))?;
            if let Err(error) = self.write(&self.meta_of(&folder, &id), meta.to_string().as_bytes()) {
                let _ = std::fs::remove_file(&file);
                return Err(io_message(&error));
            }
            Ok(json!({
                "ok": true, "id": id, "name": meta["name"], "mime": meta["mime"], "bytes": meta["bytes"], "width": meta["width"], "height": meta["height"],
                "thumb": self.preview(&bytes, verdict.mime),
            }))
        })();
        saved.unwrap_or_else(|error| json!({ "ok": false, "error": format!("The picture could not be saved: {}", js::slice(&error, 0, Some(120))) }))
    }

    /// The pictures a message names, as `{ id, name, mime, bytes, path }`.
    fn resolve(&self, value: &Value) -> Value {
        let ids = match attach::check_ids(value) {
            Ok(ids) => ids,
            Err(refused) => return refused,
        };
        let Ok(folder) = self.folder() else { return json!({ "ok": false, "error": "A picture is no longer saved. Attach it again." }) };
        let mut found = Vec::new();
        for id in ids {
            let meta = self.read_meta(&folder, &id);
            let file = meta.as_ref().map(|meta| self.file_of(&folder, &id, &js::string(&meta["ext"])));
            let info = file.as_ref().and_then(|file| std::fs::symlink_metadata(file).ok());
            let real = match (&meta, &info) {
                (Some(meta), Some(info)) => !info.file_type().is_symlink() && info.is_file() && meta["bytes"].as_f64() == Some(info.len() as f64),
                _ => false,
            };
            if !real {
                let name = meta.as_ref().and_then(|meta| meta.get("name")).and_then(Value::as_str).filter(|name| !name.is_empty());
                let who = match name {
                    Some(name) => format!("\"{name}\" is"),
                    None => "A picture is".into(),
                };
                return json!({ "ok": false, "error": format!("{who} no longer saved. Attach it again.") });
            }
            let meta = meta.unwrap_or_default();
            found.push(json!({ "id": id, "name": meta["name"], "mime": meta["mime"], "bytes": meta["bytes"], "path": file.map(|file| file.to_string_lossy().into_owned()) }));
        }
        json!({ "ok": true, "images": found })
    }

    /// One picture's contents as base64, after checking its bytes still say what its record says.
    fn load(&self, entry: &Value) -> Result<Value, String> {
        let bytes = std::fs::read(js::string(&entry["path"])).map_err(|error| io_message(&error))?;
        if attach::sniff(&bytes).map(String::from) != entry["mime"].as_str().map(String::from) {
            return Err(format!("\"{}\" is not the picture that was saved", js::string(&entry["name"])));
        }
        let mut loaded = entry.clone();
        loaded["base64"] = json!(attach::to_base64(&bytes));
        Ok(loaded)
    }

    fn read(&self, id: &Value) -> Value {
        let found = self.resolve(&json!([id]));
        if found["ok"] != json!(true) {
            return found;
        }
        let Some(entry) = found["images"].get(0).cloned() else {
            return json!({ "ok": false, "error": "That is not a picture Studio saved." });
        };
        let loaded = match self.load(&entry) {
            Ok(loaded) => loaded,
            Err(error) => return json!({ "ok": false, "error": format!("The picture could not be read: {}", js::slice(&error, 0, Some(120))) }),
        };
        let meta = self.folder().ok().and_then(|folder| self.read_meta(&folder, &js::string(id)));
        let size = |key: &str| meta.as_ref().and_then(|meta| meta.get(key)).filter(|value| !value.is_null()).cloned().unwrap_or(Value::Null);
        json!({
            "ok": true, "id": id, "name": entry["name"], "mime": entry["mime"], "bytes": entry["bytes"], "width": size("width"), "height": size("height"),
            "dataUrl": format!("data:{};base64,{}", js::string(&entry["mime"]), js::string(&loaded["base64"])),
        })
    }

    /// Takes one picture away, its record last. Never fails for one that is already gone.
    fn remove(&self, id: &Value) -> Value {
        if !attach::is_id(id) {
            return json!({ "ok": false, "error": "That is not a picture Studio saved." });
        }
        let id = js::string(id);
        if let Ok(folder) = self.folder() {
            let exts: Vec<String> = match self.read_meta(&folder, &id) {
                Some(meta) => vec![js::string(&meta["ext"])],
                None => attach::TYPES.iter().map(|(_, ext)| ext.to_string()).collect(),
            };
            for ext in exts {
                let _ = std::fs::remove_file(self.file_of(&folder, &id, &ext));
            }
            let _ = std::fs::remove_file(self.meta_of(&folder, &id));
        }
        json!({ "ok": true })
    }

    /// Cleans the folder: named pictures stay; the rest goes when a day old, then
    /// oldest first while there are more than 300 or 300 MB.
    fn prune(&self, options: &Value) -> Value {
        let now = js::now_ms();
        let Ok(folder) = self.folder() else { return json!({ "ok": true, "removed": 0, "kept": 0 }) };
        if let Ok(mut map) = last_prune().lock() {
            map.insert(folder.to_string_lossy().into_owned(), now);
        }
        let named: HashSet<String> = match options.get("keep").and_then(Value::as_array) {
            Some(list) => list.iter().map(js::string).collect(),
            None if self.has("keep") => self.call("keep", vec![]).ok().and_then(|value| value.as_array().cloned()).unwrap_or_default().iter().map(js::string).collect(),
            None => HashSet::new(),
        };
        let mut names: Vec<String> = std::fs::read_dir(&folder).map(|entries| entries.flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
        names.sort_by(|a, b| js::utf16_cmp(a, b));
        struct Row {
            id: String,
            meta: Option<Value>,
            at: f64,
        }
        let mut rows: Vec<Row> = Vec::new();
        let mut recorded: HashSet<String> = HashSet::new();
        for entry in &names {
            let Some(found) = js_regex!(r"^(img_[a-f0-9]{24})\.json$", "").captures(entry) else { continue };
            let id = found[1].to_string();
            recorded.insert(id.clone());
            let meta = self.read_meta(&folder, &id);
            let at = meta.as_ref().map(|meta| js::to_number(meta.get("at"))).filter(|at| at.is_finite() && *at != 0.0)
                .or_else(|| std::fs::metadata(self.meta_of(&folder, &id)).ok().map(|info| mtime_ms(&info)).filter(|at| *at != 0.0))
                .unwrap_or(0.0);
            rows.push(Row { id, meta, at });
        }
        let mut removed = 0;
        for entry in &names {
            let bare = js_regex!(r"^(img_[a-f0-9]{24})\.(?:png|jpg|webp|gif)$", "").captures(entry).map(|found| found[1].to_string());
            let orphan = bare.is_some_and(|id| !recorded.contains(&id));
            if !orphan && !js_regex!(r"\.tmp-", "").is_match(entry) {
                continue;
            }
            if let Ok(info) = std::fs::metadata(folder.join(entry)) {
                if now - mtime_ms(&info) > ORPHAN_MS {
                    let _ = std::fs::remove_file(folder.join(entry));
                    removed += 1;
                }
            }
        }
        let mut living: Vec<Row> = Vec::new();
        let (mut held, mut size) = (0usize, 0.0f64);
        for row in rows {
            let old = now - row.at > ORPHAN_MS;
            let Some(meta) = &row.meta else {
                if old {
                    self.remove(&json!(row.id));
                    removed += 1;
                }
                continue;
            };
            let bytes = js::to_number(meta.get("bytes"));
            if named.contains(&row.id) {
                held += 1;
                size += bytes;
                continue;
            }
            if old {
                self.remove(&json!(row.id));
                removed += 1;
                continue;
            }
            size += bytes;
            living.push(row);
        }
        living.sort_by(|a, b| a.at.partial_cmp(&b.at).unwrap_or(std::cmp::Ordering::Equal));
        let mut living: std::collections::VecDeque<Row> = living.into();
        while !living.is_empty() && (living.len() + held > MAX_STORED || size > MAX_FOLDER_BYTES) {
            let Some(oldest) = living.pop_front() else { break };
            self.remove(&json!(oldest.id));
            removed += 1;
            size -= oldest.meta.as_ref().map(|meta| js::to_number(meta.get("bytes"))).unwrap_or(0.0);
        }
        json!({ "ok": true, "removed": removed, "kept": living.len() + held })
    }
}

/// `images.<function>(collaborators, ...args)`, as the engine's `image-store` factory calls it.
pub fn call(function: &str, args: &[Value], callbacks: &dyn Callbacks) -> Result<Value, String> {
    if let Some(rule) = function.strip_prefix("attach.") {
        return attach::call(rule, args).ok_or_else(|| format!("images.{function} has not moved to Rust"));
    }
    let arg = |index: usize| args.get(index).cloned().unwrap_or(Value::Null);
    let collaborators = arg(0);
    let store = Store { collaborators: &collaborators, callbacks };
    Ok(match function {
        "save" => store.save(&arg(1)),
        "resolve" => store.resolve(&arg(1)),
        "load" => store.load(&arg(1))?,
        "read" => store.read(&arg(1)),
        "remove" => store.remove(&arg(1)),
        "prune" => store.prune(&arg(1)),
        other => return Err(format!("images.{other} has not moved to Rust")),
    })
}
