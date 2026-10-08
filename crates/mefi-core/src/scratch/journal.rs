//! The arena's append-only index log and its pid lock. One record per line:
//! eight hex digits of crc32 over the JSON that follows, a space, the JSON,
//! a newline. A line whose crc does not match, or that never got its
//! newline (a torn write), is dropped at replay; the lines before it stand.
//! The lock file holds the pid that opened the arena: a dead holder's lock is
//! taken over, a live one refuses the open, as scripts/segment-archive.cjs
//! does for its segments.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::js;

/// The IEEE 802.3 table (0xEDB88320 reflected), built once.
fn table() -> &'static [u32; 256] {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0u32; 256];
        for (n, slot) in table.iter_mut().enumerate() {
            let mut c = n as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            *slot = c;
        }
        table
    })
}

/// crc32 as zlib and PNG spell it.
pub fn crc32(bytes: &[u8]) -> u32 {
    let table = table();
    let mut c = 0xFFFF_FFFFu32;
    for byte in bytes {
        c = table[((c ^ u32::from(*byte)) & 0xFF) as usize] ^ (c >> 8);
    }
    c ^ 0xFFFF_FFFF
}

#[derive(Clone, Debug, PartialEq)]
pub enum Op {
    Put,
    Del,
}

/// One index change. A put names the key and its blob (hash, where it lies
/// and in which block order); a del names the key alone.
#[derive(Clone, Debug)]
pub struct Record {
    pub seq: u64,
    pub generation: u64,
    pub op: Op,
    pub key: String,
    pub hash: String,
    pub off: u64,
    pub len: u64,
    pub order: u8,
    pub kind: String,
    pub at: f64,
    pub meta: Value,
    pub ttl: Option<f64>,
    pub searchable: bool,
}

impl Record {
    pub fn encode(&self) -> String {
        let mut body = Map::new();
        body.insert("seq".into(), json!(self.seq));
        body.insert("gen".into(), json!(self.generation));
        body.insert(
            "op".into(),
            json!(match self.op {
                Op::Put => "put",
                Op::Del => "del",
            }),
        );
        body.insert("key".into(), json!(self.key));
        if self.op == Op::Put {
            body.insert("hash".into(), json!(self.hash));
            body.insert("off".into(), json!(self.off));
            body.insert("len".into(), json!(self.len));
            body.insert("order".into(), json!(self.order));
            body.insert("kind".into(), json!(self.kind));
            body.insert("at".into(), js::num(self.at));
            body.insert("meta".into(), self.meta.clone());
            body.insert("ttl".into(), self.ttl.map_or(Value::Null, js::num));
            body.insert("searchable".into(), json!(self.searchable));
        }
        let text = Value::Object(body).to_string();
        format!("{:08x} {text}\n", crc32(text.as_bytes()))
    }

    /// A line back into a record; None for a torn or foreign line.
    pub fn decode(line: &str) -> Option<Record> {
        let (crc, text) = line.split_once(' ')?;
        if crc.len() != 8 || u32::from_str_radix(crc, 16).ok()? != crc32(text.as_bytes()) {
            return None;
        }
        let body: Value = serde_json::from_str(text).ok()?;
        let num = |key: &str| body.get(key).and_then(Value::as_u64);
        let op = match body.get("op").and_then(Value::as_str)? {
            "put" => Op::Put,
            "del" => Op::Del,
            _ => return None,
        };
        let key = body.get("key").and_then(Value::as_str)?.to_string();
        let text_of = |name: &str| body.get(name).and_then(Value::as_str).unwrap_or_default().to_string();
        Some(Record {
            seq: num("seq")?,
            generation: num("gen")?,
            op,
            key,
            hash: text_of("hash"),
            off: num("off").unwrap_or(0),
            len: num("len").unwrap_or(0),
            order: num("order").unwrap_or(0).min(63) as u8,
            kind: text_of("kind"),
            at: body.get("at").and_then(Value::as_f64).unwrap_or(0.0),
            meta: body.get("meta").cloned().unwrap_or(Value::Null),
            ttl: body.get("ttl").and_then(Value::as_f64),
            searchable: body.get("searchable").and_then(Value::as_bool).unwrap_or(false),
        })
    }
}

/// The log file, open for appending.
pub struct Log {
    file: File,
    path: PathBuf,
}

impl Log {
    pub fn open(path: &Path) -> Result<Log, String> {
        // Not append mode: a handle with only FILE_APPEND_DATA cannot be
        // truncated on Windows, so the writer seeks to the end itself.
        let file = OpenOptions::new().create(true).write(true).read(true).truncate(false).open(path).map_err(|error| format!("cannot open {}: {error}", path.display()))?;
        Ok(Log { file, path: path.to_path_buf() })
    }

    pub fn append(&mut self, record: &Record) -> Result<(), String> {
        let line = record.encode();
        self.file.seek(SeekFrom::End(0)).and_then(|_| self.file.write_all(line.as_bytes())).map_err(|error| format!("cannot append to {}: {error}", self.path.display()))
    }

    pub fn flush(&mut self) -> Result<(), String> {
        self.file.sync_data().map_err(|error| format!("cannot flush {}: {error}", self.path.display()))
    }

    pub fn bytes(&self) -> u64 {
        self.file.metadata().map(|meta| meta.len()).unwrap_or(0)
    }

    /// Empties the log once a snapshot holds everything it said.
    pub fn truncate(&mut self) -> Result<(), String> {
        self.file.set_len(0).map_err(|error| format!("cannot truncate {}: {error}", self.path.display()))
    }

    /// Every whole, intact record, in order. Torn and corrupt lines are
    /// skipped; `dropped` counts them.
    pub fn read_all(path: &Path) -> (Vec<Record>, usize) {
        let Ok(mut file) = File::open(path) else { return (Vec::new(), 0) };
        let mut bytes = Vec::new();
        if file.read_to_end(&mut bytes).is_err() {
            return (Vec::new(), 0);
        }
        let text = String::from_utf8_lossy(&bytes);
        let mut records = Vec::new();
        let mut dropped = 0;
        for (index, line) in text.split('\n').enumerate() {
            let last = index == text.split('\n').count() - 1;
            if line.is_empty() {
                continue;
            }
            if last {
                // No newline after it: the write never finished.
                dropped += 1;
                continue;
            }
            match Record::decode(line.trim_end_matches('\r')) {
                Some(record) => records.push(record),
                None => dropped += 1,
            }
        }
        (records, dropped)
    }
}

/// True while the process is around (an access-denied answer counts as alive, as
/// `process.kill(pid, 0)` throwing EPERM does).
pub fn process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED};
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        const STILL_ACTIVE: u32 = 259;
        // SAFETY: the handle is checked and closed; the exit code is a plain out-parameter.
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return GetLastError() == ERROR_ACCESS_DENIED;
            }
            let mut code: u32 = 0;
            let asked = GetExitCodeProcess(handle, &mut code);
            CloseHandle(handle);
            asked != 0 && code == STILL_ACTIVE
        }
    }
    #[cfg(not(windows))]
    {
        if Path::new("/proc").is_dir() {
            Path::new(&format!("/proc/{pid}")).exists()
        } else {
            std::process::Command::new("kill").arg("-0").arg(pid.to_string()).output().map(|out| out.status.success()).unwrap_or(true)
        }
    }
}

/// Who holds a lock file, if it reads.
fn holder(path: &Path) -> Option<u32> {
    let text = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    value.get("pid").and_then(Value::as_u64).and_then(|pid| u32::try_from(pid).ok())
}

pub enum LockOutcome {
    Taken,
    Held(u32),
    Failed(String),
}

/// Takes `<dir>/scratch.lock` for this process: a lock nobody alive holds is
/// taken over, a live holder's is left alone. The lock of this very pid that
/// this process does not hold is a previous life's.
pub fn take_lock(path: &Path, now: f64, alive: &dyn Fn(u32) -> bool) -> LockOutcome {
    let own = std::process::id();
    for _ in 0..4 {
        match OpenOptions::new().write(true).create_new(true).open(path) {
            Ok(mut file) => {
                let text = json!({ "pid": own, "at": js::num(now) }).to_string();
                return match file.write_all(text.as_bytes()) {
                    Ok(()) => LockOutcome::Taken,
                    Err(error) => LockOutcome::Failed(format!("cannot write {}: {error}", path.display())),
                };
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return LockOutcome::Failed(format!("cannot create {}: {error}", path.display())),
        }
        match holder(path) {
            Some(pid) if pid != own && alive(pid) => return LockOutcome::Held(pid),
            _ => {
                if let Err(error) = std::fs::remove_file(path) {
                    if error.kind() != std::io::ErrorKind::NotFound {
                        return LockOutcome::Failed(format!("cannot take over {}: {error}", path.display()));
                    }
                }
            }
        }
    }
    LockOutcome::Failed(format!("{} could not be taken", path.display()))
}

/// Lets the lock go when this process holds it.
pub fn release_lock(path: &Path) {
    if holder(path) == Some(std::process::id()) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_vectors() {
        assert_eq!(crc32(b""), 0);
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b"The quick brown fox jumps over the lazy dog"), 0x414F_A339);
    }

    fn record(seq: u64) -> Record {
        Record {
            seq,
            generation: 3,
            op: Op::Put,
            key: format!("run/1/out-{seq}"),
            hash: "ab".repeat(32),
            off: 4096 * seq,
            len: 10,
            order: 0,
            kind: "output".into(),
            at: 1_700_000_000_000.0,
            meta: json!({ "n": seq }),
            ttl: Some(1_700_000_100_000.0),
            searchable: true,
        }
    }

    #[test]
    fn records_round_trip_and_torn_lines_drop() {
        let line = record(7).encode();
        let back = Record::decode(line.trim_end()).expect("decodes");
        assert_eq!(back.seq, 7);
        assert_eq!(back.key, "run/1/out-7");
        assert_eq!(back.off, 4096 * 7);
        assert_eq!(back.meta, json!({ "n": 7 }));
        assert_eq!(back.ttl, Some(1_700_000_100_000.0));
        assert!(back.searchable);
        let mut bent = line.trim_end().to_string();
        bent.replace_range(bent.len() - 3.., "9}");
        assert!(Record::decode(&bent).is_none(), "a changed body fails its crc");
        assert!(Record::decode("zz").is_none());

        let dir = std::env::temp_dir().join(format!("mefi-scratch-journal-{}-{}", std::process::id(), seq_tag()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("index.log");
        {
            let mut log = Log::open(&path).expect("open");
            for seq in 1..=3 {
                log.append(&record(seq)).expect("append");
            }
        }
        let (records, dropped) = Log::read_all(&path);
        assert_eq!(records.iter().map(|r| r.seq).collect::<Vec<_>>(), vec![1, 2, 3]);
        assert_eq!(dropped, 0);
        let len = std::fs::metadata(&path).expect("meta").len();
        let file = OpenOptions::new().write(true).open(&path).expect("reopen");
        file.set_len(len - 5).expect("truncate mid-record");
        drop(file);
        let (records, dropped) = Log::read_all(&path);
        assert_eq!(records.iter().map(|r| r.seq).collect::<Vec<_>>(), vec![1, 2], "the torn last record is dropped, the rest survives");
        assert_eq!(dropped, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn seq_tag() -> u64 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0)
    }

    #[test]
    fn lock_take_over_and_refusal() {
        let dir = std::env::temp_dir().join(format!("mefi-scratch-lock-{}-{}", std::process::id(), seq_tag()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("scratch.lock");
        std::fs::write(&path, r#"{"pid":4000000000,"at":1}"#).expect("stale lock");
        assert!(matches!(take_lock(&path, 5.0, &|_| false), LockOutcome::Taken), "a dead holder's lock is taken over");
        assert_eq!(holder(&path), Some(std::process::id()));
        release_lock(&path);
        assert!(!path.exists());
        std::fs::write(&path, r#"{"pid":77,"at":1}"#).expect("live lock");
        assert!(matches!(take_lock(&path, 5.0, &|pid| pid == 77), LockOutcome::Held(77)), "a live holder refuses");
        std::fs::write(&path, "not json").expect("broken lock");
        assert!(matches!(take_lock(&path, 5.0, &|_| true), LockOutcome::Taken), "an unreadable lock is a previous life's");
        assert!(process_alive(std::process::id()));
        assert!(!process_alive(0));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
