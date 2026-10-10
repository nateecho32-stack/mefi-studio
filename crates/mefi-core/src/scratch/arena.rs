//! One project's arena: `arena.bin`, a memory-mapped blob store whose pages
//! are the only RAM the blobs occupy (the OS drops clean file pages under
//! pressure and reads them back from the drive), with its index, journal,
//! postings and lock beside it.
//!
//!   arena.bin     page 0 is the header (MFSC v1); blobs from page 1, in
//!                 buddy blocks; grows from 16 MiB by doubling, up to the cap
//!   index.log     what changed since the snapshot, one crc32'd line each
//!   index.snap    the live index, written to a temporary file and renamed
//!   postings.bin  the search index at snapshot time (rebuilt when stale)
//!   scratch.lock  the pid that holds the arena
//!
//! A put writes the block, appends its record, then flushes that block's
//! pages. Open loads the snapshot, replays the log past it (a record whose
//! bytes do not hash to its hash is a torn write and is dropped), and rebuilds
//! the buddy tree from the live blobs. Over the cap, evictable kinds leave
//! least-recently-touched first (expired run scratch before the rest, and
//! never `history`); still full, a put answers `full`. When free holes under
//! the high-water mark pass a quarter of it and 32 MiB, or on `compact`, the
//! live blobs are copied into `arena.bin.next`, which is renamed into place
//! with a fresh snapshot and the generation goes up.

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use memmap2::{MmapMut, MmapOptions};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::bm25::{self, Postings};
use super::buddy::{block_bytes, order_for, Buddy, PAGE};
use super::index::{hex, unhex, Blob, Entry, Hash, Index};
use super::journal::{self, LockOutcome, Log, Op, Record};
use crate::js;

const MAGIC: &[u8; 4] = b"MFSC";
const VERSION: u32 = 1;
/// The arena file's first length; it doubles from here.
pub const INITIAL_BYTES: u64 = 16 * 1024 * 1024;
/// The smallest cap: 16 pages.
pub const MIN_CAP_BYTES: u64 = 16 * PAGE;
/// The kind no eviction touches.
pub const HISTORY: &str = "history";
const SNAPSHOT_EVERY: u64 = 256;
const SNAPSHOT_LOG_BYTES: u64 = 4 * 1024 * 1024;
const COMPACT_DEAD_RATIO: f64 = 0.25;
const COMPACT_DEAD_MIN: u64 = 32 * 1024 * 1024;
const TRIM_FRACTION: usize = 4;

pub type Result<T> = std::result::Result<T, String>;

/// Why an open did not happen.
pub enum Refusal {
    Locked(u32),
    Io(String),
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Header {
    generation: u64,
    used_pages: u64,
    cap_bytes: u64,
    clean: bool,
}

fn header_bytes(header: &Header, order_max: u8) -> Vec<u8> {
    let mut out = vec![0u8; PAGE as usize];
    out[0..4].copy_from_slice(MAGIC);
    out[4..8].copy_from_slice(&VERSION.to_le_bytes());
    out[8..12].copy_from_slice(&(PAGE as u32).to_le_bytes());
    out[12..16].copy_from_slice(&u32::from(order_max).to_le_bytes());
    out[16..24].copy_from_slice(&header.used_pages.to_le_bytes());
    out[24..32].copy_from_slice(&header.generation.to_le_bytes());
    out[32..40].copy_from_slice(&header.cap_bytes.to_le_bytes());
    out[40] = u8::from(header.clean);
    let digest = Sha256::digest(&out[..64]);
    out[64..96].copy_from_slice(&digest);
    out
}

fn parse_header(bytes: &[u8]) -> Option<Header> {
    if bytes.len() < 96 || &bytes[0..4] != MAGIC {
        return None;
    }
    let digest = Sha256::digest(&bytes[..64]);
    if digest.as_slice() != &bytes[64..96] {
        return None;
    }
    let u32_at = |at: usize| -> Option<u32> { Some(u32::from_le_bytes(bytes[at..at + 4].try_into().ok()?)) };
    let u64_at = |at: usize| -> Option<u64> { Some(u64::from_le_bytes(bytes[at..at + 8].try_into().ok()?)) };
    if u32_at(4)? != VERSION || u32_at(8)? != PAGE as u32 {
        return None;
    }
    Some(Header { used_pages: u64_at(16)?, generation: u64_at(24)?, cap_bytes: u64_at(32)?, clean: bytes[40] == 1 })
}

fn header_of(path: &Path) -> Option<Header> {
    let mut file = File::open(path).ok()?;
    let mut page = vec![0u8; PAGE as usize];
    let mut read = 0usize;
    while read < page.len() {
        match file.read(&mut page[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(_) => return None,
        }
    }
    parse_header(&page[..read])
}

fn io(path: &Path, what: &str, error: std::io::Error) -> String {
    format!("cannot {what} {}: {error}", path.display())
}

/// The order of the tree covering `cap_bytes` (rounded up to whole pages).
fn order_max_for(cap_bytes: u64) -> u8 {
    let pages = cap_bytes.div_ceil(PAGE).max(2);
    (64 - (pages - 1).leading_zeros()) as u8
}

fn sha256(bytes: &[u8]) -> Hash {
    Sha256::digest(bytes).into()
}

/// Writes a whole file beside its target and renames it over.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut file = File::create(&temp).map_err(|error| io(&temp, "create", error))?;
    file.write_all(bytes).map_err(|error| io(&temp, "write", error))?;
    file.sync_data().map_err(|error| io(&temp, "flush", error))?;
    drop(file);
    std::fs::rename(&temp, path).map_err(|error| io(path, "replace", error))
}

fn read_snapshot(path: &Path) -> Option<Index> {
    let text = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    Index::from_snapshot(&value)
}

fn anon() -> Result<MmapMut> {
    MmapMut::map_anon(PAGE as usize).map_err(|error| format!("cannot map memory: {error}"))
}

pub struct Arena {
    dir: PathBuf,
    file: File,
    map: MmapMut,
    len: u64,
    cap: u64,
    used_pages: u64,
    buddy: Buddy,
    index: Index,
    postings: Postings,
    log: Log,
    since_snapshot: u64,
    opened: Value,
}

impl Arena {
    /// Opens or creates the arena in `dir` with `cap_bytes` of room.
    pub fn open(dir: &Path, cap_bytes: u64, now: f64) -> std::result::Result<Arena, Refusal> {
        std::fs::create_dir_all(dir).map_err(|error| Refusal::Io(io(dir, "create", error)))?;
        let lock = dir.join("scratch.lock");
        match journal::take_lock(&lock, now, &journal::process_alive) {
            LockOutcome::Taken => {}
            LockOutcome::Held(pid) => return Err(Refusal::Locked(pid)),
            LockOutcome::Failed(reason) => return Err(Refusal::Io(reason)),
        }
        match Arena::open_locked(dir, cap_bytes) {
            Ok(arena) => Ok(arena),
            Err(reason) => {
                journal::release_lock(&lock);
                Err(Refusal::Io(reason))
            }
        }
    }

    fn open_locked(dir: &Path, cap_bytes: u64) -> Result<Arena> {
        let arena_path = dir.join("arena.bin");
        let next_path = dir.join("arena.bin.next");
        let snap_path = dir.join("index.snap");
        let snap_next = dir.join("index.snap.next");
        let log_path = dir.join("index.log");

        // A compaction that did not finish: the old files are whole until
        // arena.bin.next has been renamed over arena.bin, so until then the
        // .next files are leftovers; after it, index.snap.next is the index.
        let mut header = header_of(&arena_path);
        if next_path.exists() {
            let _ = std::fs::remove_file(&next_path);
            let _ = std::fs::remove_file(&snap_next);
        } else if snap_next.exists() {
            let adopt = header.as_ref().is_some_and(|head| read_snapshot(&snap_next).is_some_and(|snap| snap.generation == head.generation));
            if adopt {
                std::fs::rename(&snap_next, &snap_path).map_err(|error| io(&snap_path, "adopt", error))?;
            } else {
                let _ = std::fs::remove_file(&snap_next);
            }
        }

        let file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(&arena_path).map_err(|error| io(&arena_path, "open", error))?;
        let mut len = file.metadata().map_err(|error| io(&arena_path, "stat", error))?.len();
        let snapshot = read_snapshot(&snap_path);
        let (mut index, snap_seq) = match (snapshot, header) {
            (Some(snap), Some(head)) if snap.generation == head.generation => {
                let seq = snap.seq;
                (snap, seq)
            }
            (Some(snap), None) => {
                // A bad header: the snapshot and log say what is there.
                let seq = snap.seq;
                (snap, seq)
            }
            (_, head) => (Index { generation: head.map_or(0, |head| head.generation), ..Index::default() }, 0),
        };
        if header.is_none() {
            header = Some(Header { generation: index.generation, used_pages: 1, cap_bytes, clean: false });
        }

        let mut cap = cap_bytes.max(MIN_CAP_BYTES).div_ceil(PAGE) * PAGE;
        if len < PAGE.max(INITIAL_BYTES.min(cap)) {
            len = PAGE.max(INITIAL_BYTES.min(cap));
            file.set_len(len).map_err(|error| io(&arena_path, "grow", error))?;
        }
        // SAFETY: the file is held open for the arena's life and this process
        // is its only writer (scratch.lock).
        let map = unsafe { MmapOptions::new().map_mut(&file) }.map_err(|error| io(&arena_path, "map", error))?;

        // Replay the log past the snapshot.
        let (records, torn) = Log::read_all(&log_path);
        let mut dropped = torn;
        let mut replayed = 0usize;
        let mut touched: Vec<String> = Vec::new();
        for record in records {
            if record.generation != index.generation || record.seq <= index.seq {
                continue;
            }
            index.seq = record.seq;
            match record.op {
                Op::Put => {
                    let Some(hash) = unhex(&record.hash) else {
                        dropped += 1;
                        continue;
                    };
                    if !index.blobs.contains_key(&hash) {
                        let end = record.off.saturating_add(record.len);
                        let whole = record.off >= PAGE && end <= len && record.len <= block_bytes(record.order) && sha256(&map[record.off as usize..end as usize]) == hash;
                        if !whole {
                            dropped += 1;
                            continue;
                        }
                        index.blobs.insert(hash, Blob { off: record.off, len: record.len, order: record.order, refs: 0 });
                    }
                    let entry = Entry { hash, kind: record.kind, at: record.at, put_at: record.at, meta: record.meta, ttl: record.ttl, searchable: record.searchable };
                    index.insert(record.key.clone(), entry);
                    touched.push(record.key);
                    replayed += 1;
                }
                Op::Del => {
                    index.remove(&record.key);
                    touched.push(record.key);
                    replayed += 1;
                }
            }
        }

        // The buddy tree from the live blobs; a blob past the cap widens it.
        let farthest = index.blobs.values().map(|blob| blob.off + block_bytes(blob.order)).max().unwrap_or(0);
        cap = cap.max(farthest);
        let order_max = order_max_for(cap);
        let mut buddy = Buddy::new(order_max);
        buddy.reserve(0, 0);
        buddy.reserve_tail(cap / PAGE);
        let mut bad: Vec<Hash> = Vec::new();
        let mut used_pages = 1u64;
        let mut blobs: Vec<(Hash, Blob)> = index.blobs.iter().map(|(hash, blob)| (*hash, blob.clone())).collect();
        blobs.sort_by_key(|(_, blob)| blob.off);
        for (hash, blob) in blobs {
            let end = blob.off + block_bytes(blob.order);
            if blob.off % PAGE != 0 || end > len || !buddy.reserve(blob.off / PAGE, blob.order) {
                bad.push(hash);
                continue;
            }
            used_pages = used_pages.max(end / PAGE);
        }
        if !bad.is_empty() {
            let keys: Vec<String> = index.keys.iter().filter(|(_, entry)| bad.contains(&entry.hash)).map(|(key, _)| key.clone()).collect();
            for key in keys {
                index.remove(&key);
                dropped += 1;
            }
            for hash in bad {
                index.blobs.remove(&hash);
            }
        }

        let mut arena =
            Arena { dir: dir.to_path_buf(), file, map, len, cap, used_pages, buddy, index, postings: Postings::default(), log: Log::open(&log_path)?, since_snapshot: 0, opened: Value::Null };
        let stored = std::fs::read(dir.join("postings.bin")).ok().and_then(|bytes| Postings::decode(&bytes, arena.index.generation, snap_seq));
        match stored {
            Some(postings) => {
                arena.postings = postings;
                for key in touched {
                    arena.reindex(&key);
                }
            }
            None => arena.rebuild_postings(),
        }
        arena.write_header(false);
        arena.opened = json!({ "ok": true, "generation": arena.index.generation, "keys": arena.index.keys.len(), "replayed": replayed, "dropped": dropped, "cleanShutdown": header.is_some_and(|head| head.clean) });
        Ok(arena)
    }

    /// What `open` answers: the state found on disk.
    pub fn opened(&self) -> Value {
        self.opened.clone()
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn write_header(&mut self, clean: bool) {
        let header = Header { generation: self.index.generation, used_pages: self.used_pages, cap_bytes: self.cap, clean };
        let bytes = header_bytes(&header, self.buddy.order_max());
        if self.map.len() >= bytes.len() {
            self.map[..bytes.len()].copy_from_slice(&bytes);
        }
    }

    fn text_of(&self, blob: &Blob) -> String {
        let end = (blob.off + blob.len).min(self.len) as usize;
        let bytes = &self.map[blob.off as usize..end];
        String::from_utf8(bytes.to_vec()).unwrap_or_else(|_| String::from_utf8_lossy(bytes).into_owned())
    }

    fn text_for(&self, key: &str) -> Option<String> {
        let entry = self.index.keys.get(key)?;
        self.index.blobs.get(&entry.hash).map(|blob| self.text_of(blob))
    }

    fn reindex(&mut self, key: &str) {
        match self.index.keys.get(key).filter(|entry| entry.searchable).cloned() {
            Some(_) => {
                if let Some(text) = self.text_for(key) {
                    self.postings.add(key, &text);
                }
            }
            None => self.postings.remove(key),
        }
    }

    fn rebuild_postings(&mut self) {
        let keys: Vec<String> = self.index.keys.iter().filter(|(_, entry)| entry.searchable).map(|(key, _)| key.clone()).collect();
        let docs: Vec<(String, String)> = keys.into_iter().filter_map(|key| self.text_for(&key).map(|text| (key, text))).collect();
        self.postings.rebuild(docs);
    }

    /// Keeps the postings under their budget and free of too many tombstones.
    fn trim_postings(&mut self) {
        if self.postings.over_budget() {
            let count = self.postings.alive() / TRIM_FRACTION + 1;
            self.postings.drop_oldest(count);
            let docs: Vec<(String, String)> = self.postings.keys().into_iter().filter_map(|key| self.text_for(&key).map(|text| (key, text))).collect();
            self.postings.rebuild(docs);
        } else if self.postings.dead() > self.postings.alive() + 1024 {
            let docs: Vec<(String, String)> = self.postings.keys().into_iter().filter_map(|key| self.text_for(&key).map(|text| (key, text))).collect();
            self.postings.rebuild(docs);
        }
    }

    /// Makes the file at least `end` bytes long: doubling, within the cap.
    fn ensure_len(&mut self, end: u64) -> Result<()> {
        if end <= self.len {
            return Ok(());
        }
        let mut next = self.len.max(PAGE);
        while next < end {
            next = (next * 2).max(INITIAL_BYTES);
        }
        let next = next.min(self.cap.max(end));
        let path = self.dir.join("arena.bin");
        self.map = anon()?;
        self.file.set_len(next).map_err(|error| io(&path, "grow", error))?;
        // SAFETY: as in open; the previous map was dropped before the file grew.
        self.map = unsafe { MmapOptions::new().map_mut(&self.file) }.map_err(|error| io(&path, "map", error))?;
        self.len = next;
        self.write_header(false);
        Ok(())
    }

    fn append(&mut self, op: Op, key: &str, entry: Option<&Entry>, blob: Option<&Blob>) -> Result<()> {
        self.index.seq += 1;
        let record = Record {
            seq: self.index.seq,
            generation: self.index.generation,
            op,
            key: key.to_string(),
            hash: entry.map(|entry| hex(&entry.hash)).unwrap_or_default(),
            off: blob.map_or(0, |blob| blob.off),
            len: blob.map_or(0, |blob| blob.len),
            order: blob.map_or(0, |blob| blob.order),
            kind: entry.map(|entry| entry.kind.clone()).unwrap_or_default(),
            at: entry.map_or(0.0, |entry| entry.at),
            meta: entry.map(|entry| entry.meta.clone()).unwrap_or(Value::Null),
            ttl: entry.and_then(|entry| entry.ttl),
            searchable: entry.is_some_and(|entry| entry.searchable),
        };
        self.log.append(&record)?;
        self.since_snapshot += 1;
        Ok(())
    }

    fn release(&mut self, freed: Option<(Hash, Blob)>) {
        if let Some((_, blob)) = freed {
            self.buddy.free(blob.off / PAGE, blob.order);
        }
    }

    /// Drops one key: a record, the block if it was the last reference, the
    /// postings entry.
    fn drop_key(&mut self, key: &str) -> Result<bool> {
        if !self.index.keys.contains_key(key) {
            return Ok(false);
        }
        self.append(Op::Del, key, None, None)?;
        let freed = self.index.remove(key);
        self.release(freed);
        self.postings.remove(key);
        Ok(true)
    }

    /// The least valuable evictable key: expired run scratch first (oldest
    /// touch first), then the least recently touched of the rest; never
    /// `history`. None when nothing may go.
    fn eviction_choice(&self, now: f64) -> Option<String> {
        let mut best: Option<(bool, f64, &str)> = None;
        for (key, entry) in &self.index.keys {
            if entry.kind == HISTORY {
                continue;
            }
            let expired = entry.ttl.is_some_and(|ttl| ttl <= now);
            let candidate = (expired, entry.at, key.as_str());
            let better = match best {
                None => true,
                Some((best_expired, best_at, best_key)) => {
                    if expired != best_expired {
                        expired
                    } else if entry.at != best_at {
                        entry.at < best_at
                    } else {
                        key.as_str() < best_key
                    }
                }
            };
            if better {
                best = Some(candidate);
            }
        }
        best.map(|(_, _, key)| key.to_string())
    }

    fn evict_one(&mut self, now: f64) -> Result<bool> {
        match self.eviction_choice(now) {
            Some(key) => self.drop_key(&key),
            None => Ok(false),
        }
    }

    /// put: the text under `key`, deduplicated by content.
    pub fn put(&mut self, key: &str, kind: &str, text: &str, meta: Value, ttl_ms: Option<f64>, searchable: bool, now: f64) -> Result<Value> {
        let bytes = text.as_bytes();
        let hash = sha256(bytes);
        let dedup = self.index.blobs.contains_key(&hash);
        if !dedup {
            let order = order_for(bytes.len() as u64);
            if order > self.buddy.order_max() || block_bytes(order) + PAGE > self.cap {
                return Ok(json!({ "ok": false, "reason": "full" }));
            }
            let page = loop {
                match self.buddy.alloc(order) {
                    Some(page) => break page,
                    None => {
                        if !self.evict_one(now)? {
                            return Ok(json!({ "ok": false, "reason": "full" }));
                        }
                    }
                }
            };
            let off = page * PAGE;
            if let Err(error) = self.ensure_len(off + block_bytes(order)) {
                self.buddy.free(page, order);
                return Err(error);
            }
            let end = off as usize + bytes.len();
            self.map[off as usize..end].copy_from_slice(bytes);
            self.index.blobs.insert(hash, Blob { off, len: bytes.len() as u64, order, refs: 0 });
            self.used_pages = self.used_pages.max(page + (1u64 << order));
        }
        let blob = self.index.blobs.get(&hash).cloned().ok_or_else(|| "the blob vanished".to_string())?;
        let entry = Entry { hash, kind: kind.to_string(), at: now, put_at: now, meta, ttl: ttl_ms.map(|ttl| now + ttl), searchable };
        self.append(Op::Put, key, Some(&entry), Some(&blob))?;
        let freed = self.index.insert(key.to_string(), entry);
        self.release(freed);
        if !dedup {
            let path = self.dir.join("arena.bin");
            self.map.flush_range(blob.off as usize, blob.len.max(1) as usize).map_err(|error| io(&path, "flush", error))?;
        }
        if searchable {
            self.postings.add(key, text);
            self.trim_postings();
        } else {
            self.postings.remove(key);
        }
        self.maybe_snapshot();
        self.maybe_compact(now);
        Ok(json!({ "ok": true, "hash": hex(&hash), "bytes": bytes.len(), "dedup": dedup }))
    }

    /// get: by key (which refreshes the key's place in the LRU order), or by
    /// hash (the most recently touched key holding it, which stays where it is).
    pub fn get(&mut self, key: Option<&str>, hash: Option<&str>, now: f64) -> Value {
        let found: Option<String> = match (key, hash) {
            (Some(key), _) => self.index.keys.contains_key(key).then(|| key.to_string()),
            (None, Some(hash)) => unhex(hash).and_then(|hash| {
                self.index
                    .keys
                    .iter()
                    .filter(|(_, entry)| entry.hash == hash)
                    .max_by(|a, b| a.1.at.partial_cmp(&b.1.at).unwrap_or(std::cmp::Ordering::Equal).then_with(|| b.0.cmp(a.0)))
                    .map(|(key, _)| key.clone())
            }),
            _ => None,
        };
        let Some(found) = found else {
            self.index.misses += 1;
            return json!({ "ok": false, "reason": "missing" });
        };
        self.index.hits += 1;
        let Some(entry) = self.index.keys.get_mut(&found) else {
            return json!({ "ok": false, "reason": "missing" });
        };
        if key.is_some() {
            entry.at = now;
        }
        let entry = entry.clone();
        let text = self.index.blobs.get(&entry.hash).map(|blob| self.text_of(blob)).unwrap_or_default();
        json!({ "ok": true, "text": text, "kind": entry.kind, "at": js::num(entry.at), "meta": entry.meta })
    }

    pub fn has(&self, key: &str) -> Value {
        json!({ "ok": true, "has": self.index.keys.contains_key(key) })
    }

    fn matches(entry: &Entry, key: &str, prefix: Option<&str>, kind: Option<&str>) -> bool {
        prefix.is_none_or(|prefix| key.starts_with(prefix)) && kind.is_none_or(|kind| entry.kind == kind)
    }

    /// list: the most recently touched first, then by key.
    pub fn list(&self, prefix: Option<&str>, kind: Option<&str>, limit: usize) -> Value {
        let mut rows: Vec<(&String, &Entry)> = self.index.keys.iter().filter(|(key, entry)| Arena::matches(entry, key, prefix, kind)).collect();
        rows.sort_by(|a, b| b.1.at.partial_cmp(&a.1.at).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(b.0)));
        let items: Vec<Value> = rows
            .into_iter()
            .take(limit)
            .map(|(key, entry)| {
                let bytes = self.index.blobs.get(&entry.hash).map_or(0, |blob| blob.len);
                json!({ "key": key, "hash": hex(&entry.hash), "bytes": bytes, "kind": entry.kind, "at": js::num(entry.at) })
            })
            .collect();
        json!({ "ok": true, "items": items })
    }

    /// search: BM25 over the searchable keys the kind and prefix select,
    /// best first; ties by last touch (newest first), then key.
    pub fn search(&self, query: &str, kind: Option<&str>, prefix: Option<&str>, limit: usize) -> Value {
        let candidate = |key: &str| self.index.keys.get(key).is_some_and(|entry| Arena::matches(entry, key, prefix, kind));
        let mut hits: Vec<(String, f64, &Entry)> = self.postings.search(query, &candidate).into_iter().filter_map(|(key, score)| self.index.keys.get(&key).map(|entry| (key, score, entry))).collect();
        hits.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then_with(|| b.2.at.partial_cmp(&a.2.at).unwrap_or(std::cmp::Ordering::Equal)).then_with(|| a.0.cmp(&b.0)));
        let items: Vec<Value> = hits
            .into_iter()
            .take(limit)
            .map(|(key, score, entry)| {
                let text = self.index.blobs.get(&entry.hash).map(|blob| self.text_of(blob)).unwrap_or_default();
                json!({ "key": key, "hash": hex(&entry.hash), "score": js::num(score), "snippet": bm25::snippet(&text, query), "at": js::num(entry.at) })
            })
            .collect();
        json!({ "ok": true, "items": items })
    }

    fn used_extent(&self) -> u64 {
        self.used_pages.saturating_sub(1) * PAGE
    }

    fn live_blocks(&self) -> u64 {
        self.index.blobs.values().map(|blob| block_bytes(blob.order)).sum()
    }

    fn dead_bytes(&self) -> u64 {
        self.used_extent().saturating_sub(self.live_blocks())
    }

    pub fn stats(&self) -> Value {
        json!({
            "ok": true,
            "bytes": self.len,
            "capBytes": self.cap,
            "liveBytes": self.index.live_bytes(),
            "deadBytes": self.dead_bytes(),
            "keys": self.index.keys.len(),
            "blobs": self.index.blobs.len(),
            "hits": self.index.hits,
            "misses": self.index.misses,
            "generation": self.index.generation,
            "lastCompactAt": self.index.last_compact_at.map_or(Value::Null, js::num),
        })
    }

    /// evict: every key under `prefix` goes.
    pub fn evict(&mut self, prefix: &str, now: f64) -> Result<Value> {
        let keys: Vec<String> = self.index.keys.keys().filter(|key| key.starts_with(prefix)).cloned().collect();
        let mut evicted = 0u64;
        for key in keys {
            if self.drop_key(&key)? {
                evicted += 1;
            }
        }
        self.maybe_snapshot();
        self.maybe_compact(now);
        Ok(json!({ "ok": true, "evicted": evicted }))
    }

    fn maybe_snapshot(&mut self) {
        if self.since_snapshot >= SNAPSHOT_EVERY || self.log.bytes() >= SNAPSHOT_LOG_BYTES {
            let _ = self.snapshot(false);
        }
    }

    /// Writes index.snap and postings.bin, then empties the log they cover.
    pub fn snapshot(&mut self, clean: bool) -> Result<()> {
        self.write_header(clean);
        write_atomic(&self.dir.join("index.snap"), self.index.snapshot().to_string().as_bytes())?;
        write_atomic(&self.dir.join("postings.bin"), &self.postings.encode(self.index.generation, self.index.seq))?;
        self.log.truncate()?;
        self.since_snapshot = 0;
        Ok(())
    }

    fn maybe_compact(&mut self, now: f64) {
        let dead = self.dead_bytes();
        if dead > COMPACT_DEAD_MIN && dead as f64 > COMPACT_DEAD_RATIO * self.used_extent() as f64 {
            let _ = self.compact(now);
        }
    }

    /// compact: the live blobs copied into a fresh arena, which takes the
    /// old one's place with a new generation.
    pub fn compact(&mut self, now: f64) -> Result<Value> {
        let arena_path = self.dir.join("arena.bin");
        let next_path = self.dir.join("arena.bin.next");
        let snap_path = self.dir.join("index.snap");
        let snap_next = self.dir.join("index.snap.next");
        let before = self.used_extent();

        let mut buddy = Buddy::new(self.buddy.order_max());
        buddy.reserve(0, 0);
        buddy.reserve_tail(self.cap / PAGE);
        let mut blobs: Vec<(Hash, Blob)> = self.index.blobs.iter().map(|(hash, blob)| (*hash, blob.clone())).collect();
        blobs.sort_by_key(|(_, blob)| blob.off);
        let mut moved: Vec<(Hash, Blob)> = Vec::with_capacity(blobs.len());
        let mut used_pages = 1u64;
        for (hash, blob) in blobs {
            let page = buddy.alloc(blob.order).ok_or_else(|| "the compacted arena ran out of room".to_string())?;
            moved.push((hash, Blob { off: page * PAGE, len: blob.len, order: blob.order, refs: blob.refs }));
            used_pages = used_pages.max(page + (1u64 << blob.order));
        }
        let mut next_len = INITIAL_BYTES.min(self.cap).max(PAGE);
        while next_len < used_pages * PAGE {
            next_len *= 2;
        }
        let next_len = next_len.min(self.cap.max(used_pages * PAGE));

        let next = OpenOptions::new().read(true).write(true).create(true).truncate(true).open(&next_path).map_err(|error| io(&next_path, "create", error))?;
        next.set_len(next_len).map_err(|error| io(&next_path, "size", error))?;
        {
            // SAFETY: a fresh file this process alone has open.
            let mut map = unsafe { MmapOptions::new().map_mut(&next) }.map_err(|error| io(&next_path, "map", error))?;
            for (hash, blob) in &moved {
                let old = &self.index.blobs[hash];
                let (from, to) = (old.off as usize, blob.off as usize);
                let len = blob.len as usize;
                map[to..to + len].copy_from_slice(&self.map[from..from + len]);
            }
            let header = Header { generation: self.index.generation + 1, used_pages, cap_bytes: self.cap, clean: false };
            map[..PAGE as usize].copy_from_slice(&header_bytes(&header, buddy.order_max()));
            map.flush().map_err(|error| io(&next_path, "flush", error))?;
        }

        let mut index = Index { seq: self.index.seq, generation: self.index.generation + 1, hits: self.index.hits, misses: self.index.misses, last_compact_at: Some(now), ..Index::default() };
        for (hash, blob) in &moved {
            index.blobs.insert(*hash, Blob { refs: 0, ..blob.clone() });
        }
        for (key, entry) in &self.index.keys {
            index.insert(key.clone(), entry.clone());
        }
        write_atomic(&snap_next, index.snapshot().to_string().as_bytes())?;

        // Let go of the old file, then swap the files; the index.snap.next
        // adoption at open covers a crash between the two renames.
        self.map = anon()?;
        let old_file = std::mem::replace(&mut self.file, next);
        drop(old_file);
        if let Err(error) = std::fs::rename(&next_path, &arena_path) {
            let reopened = OpenOptions::new().read(true).write(true).open(&arena_path).map_err(|error| io(&arena_path, "reopen", error))?;
            self.file = reopened;
            // SAFETY: as in open.
            self.map = unsafe { MmapOptions::new().map_mut(&self.file) }.map_err(|error| io(&arena_path, "map", error))?;
            let _ = std::fs::remove_file(&next_path);
            let _ = std::fs::remove_file(&snap_next);
            return Err(io(&arena_path, "replace", error));
        }
        let _ = std::fs::rename(&snap_next, &snap_path);
        // SAFETY: as in open.
        self.map = unsafe { MmapOptions::new().map_mut(&self.file) }.map_err(|error| io(&arena_path, "map", error))?;
        self.len = next_len;
        self.buddy = buddy;
        self.index = index;
        self.used_pages = used_pages;
        self.since_snapshot = 0;
        let _ = self.log.truncate();
        let _ = write_atomic(&self.dir.join("postings.bin"), &self.postings.encode(self.index.generation, self.index.seq));
        self.write_header(false);
        Ok(json!({ "ok": true, "generation": self.index.generation, "freedBytes": before.saturating_sub(self.used_extent()) }))
    }

    /// Writes the final snapshot, marks a clean shutdown and lets the lock go.
    pub fn close(&mut self) -> Result<()> {
        let result = self.snapshot(true);
        let _ = self.map.flush();
        journal::release_lock(&self.dir.join("scratch.lock"));
        result
    }

    /// For tests: the index's record count and the buddy's free pages.
    #[cfg(test)]
    pub fn probe(&self) -> (usize, usize, u64, u64) {
        (self.index.keys.len(), self.index.blobs.len(), self.buddy.free_pages(), self.index.seq)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("mefi-scratch-{name}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn open(dir: &Path, cap: u64) -> Arena {
        match Arena::open(dir, cap, 1_000.0) {
            Ok(arena) => arena,
            Err(Refusal::Io(reason)) => panic!("{reason}"),
            Err(Refusal::Locked(pid)) => panic!("locked by {pid}"),
        }
    }

    const MIB: u64 = 1024 * 1024;

    #[test]
    fn header_round_trip() {
        let header = Header { generation: 7, used_pages: 99, cap_bytes: 512 * MIB, clean: true };
        let bytes = header_bytes(&header, 17);
        assert_eq!(parse_header(&bytes), Some(header));
        let mut bent = bytes.clone();
        bent[20] ^= 1;
        assert_eq!(parse_header(&bent), None, "a changed field fails the header's sha");
        assert_eq!(order_max_for(512 * MIB), 17);
        assert_eq!(order_max_for(MIB), 8);
        assert_eq!(order_max_for(MIB + 1), 9);
    }

    #[test]
    fn put_get_dedup_and_replay_after_a_torn_log() {
        let dir = temp("replay");
        {
            let mut arena = open(&dir, 4 * MIB);
            let first = arena.put("run/1/a", "output", "hello scratch world", json!({ "n": 1 }), None, true, 1_000.0).expect("put");
            assert_eq!(first["ok"], true);
            assert_eq!(first["dedup"], false);
            assert_eq!(first["bytes"], 19);
            let again = arena.put("run/1/b", "output", "hello scratch world", Value::Null, None, false, 1_001.0).expect("put");
            assert_eq!(again["dedup"], true, "the same bytes add a key, not a copy");
            assert_eq!(again["hash"], first["hash"]);
            assert_eq!(arena.probe().1, 1);
            let third = arena.put("run/1/c", "output", "another text entirely", Value::Null, Some(5.0), false, 1_002.0).expect("put");
            assert_eq!(third["dedup"], false);
            let got = arena.get(Some("run/1/a"), None, 1_003.0);
            assert_eq!(got["text"], "hello scratch world");
            assert_eq!(got["meta"], json!({ "n": 1 }));
            assert_eq!(got["at"], 1_003.0);
            let by_hash = arena.get(None, first["hash"].as_str(), 1_004.0);
            assert_eq!(by_hash["ok"], true);
            assert_eq!(arena.get(Some("nope"), None, 1_005.0)["reason"], "missing");
            assert_eq!(arena.stats()["hits"], 2);
            assert_eq!(arena.stats()["misses"], 1);
            assert_eq!(arena.has("run/1/c")["has"], true);
            // No close: the log alone carries the index, as after a crash.
        }
        let log = dir.join("index.log");
        let len = std::fs::metadata(&log).expect("log").len();
        OpenOptions::new().write(true).open(&log).expect("log").set_len(len - 7).expect("tear the last record");
        journal::release_lock(&dir.join("scratch.lock"));
        {
            let mut arena = open(&dir, 4 * MIB);
            let opened = arena.opened();
            assert_eq!(opened["dropped"], 1, "the torn record is dropped");
            assert_eq!(opened["replayed"], 2);
            assert_eq!(arena.has("run/1/a")["has"], true);
            assert_eq!(arena.has("run/1/b")["has"], true);
            assert_eq!(arena.has("run/1/c")["has"], false, "the torn put never happened");
            assert_eq!(arena.get(Some("run/1/b"), None, 2_000.0)["text"], "hello scratch world");
            let found = arena.search("scratch", None, None, 10);
            assert_eq!(found["items"][0]["key"], "run/1/a", "postings were rebuilt from the arena");
            assert_eq!(found["items"].as_array().map(Vec::len), Some(1), "b is not searchable");
            arena.close().expect("close");
        }
        assert!(!dir.join("scratch.lock").exists());
        assert!(dir.join("index.snap").exists());
        assert!(dir.join("postings.bin").exists());
        {
            let arena = open(&dir, 4 * MIB);
            assert_eq!(arena.opened()["cleanShutdown"], true);
            assert_eq!(arena.opened()["keys"], 2);
            assert_eq!(arena.probe().2, 4 * MIB / PAGE - 2, "one blob block plus the header page are taken");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cap_eviction_order_and_full() {
        let dir = temp("cap");
        // 16 pages: the header and 15 for blobs, one page each.
        let mut arena = open(&dir, MIN_CAP_BYTES);
        let text = |n: usize| format!("{n:03}-{}", "x".repeat(100));
        for n in 0..15 {
            let kind = if n % 5 == 0 { HISTORY } else { "run" };
            let ttl = if n == 7 { Some(1.0) } else { None };
            let answer = arena.put(&format!("k/{n}"), kind, &text(n), Value::Null, ttl, false, 1_000.0 + n as f64).expect("put");
            assert_eq!(answer["ok"], true, "{n}");
        }
        assert_eq!(arena.probe().2, 0, "the arena is full");
        let answer = arena.put("k/15", "run", &text(15), Value::Null, None, false, 2_000.0).expect("put");
        assert_eq!(answer["ok"], true);
        assert_eq!(arena.has("k/7")["has"], false, "the expired run entry goes first");
        let answer = arena.put("k/16", "run", &text(16), Value::Null, None, false, 2_001.0).expect("put");
        assert_eq!(answer["ok"], true);
        assert_eq!(arena.has("k/1")["has"], false, "then the least recently touched run entry");
        assert_eq!(arena.has("k/0")["has"], true, "history stays");
        arena.get(Some("k/2"), None, 3_000.0);
        let answer = arena.put("k/17", "run", &text(17), Value::Null, None, false, 3_001.0).expect("put");
        assert_eq!(answer["ok"], true);
        assert_eq!(arena.has("k/2")["has"], true, "a get refreshes a key's place");
        assert_eq!(arena.has("k/3")["has"], false);
        for n in 18..40 {
            let answer = arena.put(&format!("k/{n}"), "run", &text(n), Value::Null, None, false, 4_000.0 + n as f64).expect("put");
            assert_eq!(answer["ok"], true, "{n}");
        }
        assert_eq!(arena.stats()["keys"], 15);
        let answer = arena.put("big", "run", &"y".repeat(200_000), Value::Null, None, false, 9_000.0).expect("put");
        assert_eq!(answer, json!({ "ok": false, "reason": "full" }), "larger than the cap: refused without evicting");
        assert_eq!(arena.stats()["keys"], 15);
        let evicted = arena.evict("k/", 9_001.0).expect("evict");
        assert_eq!(evicted["evicted"], 15, "evict by prefix takes the run keys and history alike");
        assert_eq!(arena.stats()["keys"], 0);
        for n in 0..15 {
            arena.put(&format!("h/{n}"), HISTORY, &text(n), Value::Null, None, false, 10_000.0).expect("put");
        }
        let answer = arena.put("h/15", HISTORY, &text(15), Value::Null, None, false, 10_001.0).expect("put");
        assert_eq!(answer, json!({ "ok": false, "reason": "full" }), "history never leaves");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn compaction_keeps_every_live_key() {
        let dir = temp("compact");
        let mut arena = open(&dir, 8 * MIB);
        let mut expected: Vec<(String, String)> = Vec::new();
        for n in 0..60 {
            let text = format!("blob {n} {}", "z".repeat(3000 * (n % 4 + 1)));
            arena.put(&format!("k/{n}"), "note", &text, json!(n), None, n % 2 == 0, 1_000.0 + n as f64).expect("put");
            if n % 3 == 0 {
                expected.push((format!("k/{n}"), text));
            } else {
                arena.evict(&format!("k/{n}"), 1_100.0).expect("evict");
            }
        }
        let before = arena.stats();
        assert!(before["deadBytes"].as_u64().unwrap_or(0) > 0);
        let answer = arena.compact(5_000.0).expect("compact");
        assert_eq!(answer["ok"], true);
        assert_eq!(answer["generation"], 1);
        assert!(answer["freedBytes"].as_u64().unwrap_or(0) > 0);
        assert!(!dir.join("arena.bin.next").exists());
        assert!(!dir.join("index.snap.next").exists());
        let after = arena.stats();
        assert_eq!(after["deadBytes"], 0);
        assert_eq!(after["keys"], expected.len());
        assert_eq!(after["lastCompactAt"], 5_000.0);
        for (key, text) in &expected {
            assert_eq!(arena.get(Some(key), None, 6_000.0)["text"], *text, "{key}");
        }
        assert_eq!(
            arena.search("blob", Some("note"), Some("k/"), 100)["items"].as_array().map(Vec::len),
            Some(expected.iter().filter(|(key, _)| key[2..].parse::<usize>().unwrap_or(1) % 2 == 0).count())
        );
        arena.put("k/new", "note", "after compaction", Value::Null, None, true, 7_000.0).expect("put");
        drop(arena);
        journal::release_lock(&dir.join("scratch.lock"));
        let mut arena = open(&dir, 8 * MIB);
        assert_eq!(arena.opened()["generation"], 1);
        assert_eq!(arena.stats()["keys"], expected.len() + 1);
        for (key, text) in &expected {
            assert_eq!(arena.get(Some(key), None, 8_000.0)["text"], *text, "{key} after reopening");
        }
        assert_eq!(arena.get(Some("k/new"), None, 8_000.0)["text"], "after compaction");
        assert_eq!(arena.search("compaction", None, None, 5)["items"][0]["key"], "k/new");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_ranks_with_tie_breaks_and_the_lock_refuses() {
        let dir = temp("search");
        let mut arena = open(&dir, 2 * MIB);
        arena.put("b", "note", "alpha beta", Value::Null, None, true, 10.0).expect("put");
        arena.put("a", "note", "alpha beta", Value::Null, None, true, 10.0).expect("put");
        arena.put("c", "note", "alpha beta", Value::Null, None, true, 20.0).expect("put");
        arena.put("d", "note", "alpha gamma delta epsilon", Value::Null, None, true, 30.0).expect("put");
        arena.put("e", "other", "alpha beta", Value::Null, None, true, 40.0).expect("put");
        let items = arena.search("alpha", Some("note"), None, 10);
        let keys: Vec<&str> = items["items"].as_array().expect("items").iter().filter_map(|item| item["key"].as_str()).collect();
        assert_eq!(keys, vec!["c", "a", "b", "d"], "same score: newest touch first, then key; the longer document last");
        assert_eq!(arena.search("alpha", None, None, 2)["items"].as_array().map(Vec::len), Some(2));
        assert_eq!(arena.search("alpha", None, Some("e"), 10)["items"][0]["key"], "e");
        assert_eq!(arena.search("alpha", None, None, 10)["items"][0]["snippet"], "alpha beta");
        assert_eq!(arena.list(None, None, 100)["items"][0]["key"], "e", "list is newest first");
        assert_eq!(arena.list(Some("a"), None, 100)["items"].as_array().map(Vec::len), Some(1));
        assert_eq!(arena.list(None, Some("other"), 100)["items"].as_array().map(Vec::len), Some(1));
        assert_eq!(arena.list(None, None, 2)["items"].as_array().map(Vec::len), Some(2));
        drop(arena);
        // Another live process holds the lock: refused. A dead holder's lock
        // (the one this arena just left) is taken over.
        let mut command = if cfg!(windows) { std::process::Command::new("cmd") } else { std::process::Command::new("sleep") };
        if cfg!(windows) {
            command.args(["/c", "ping", "-n", "4", "127.0.0.1"]);
        } else {
            command.arg("3");
        }
        let mut child = command.stdout(std::process::Stdio::null()).spawn().expect("a child process");
        std::fs::write(dir.join("scratch.lock"), format!(r#"{{"pid":{},"at":1}}"#, child.id())).expect("lock");
        match Arena::open(&dir, 2 * MIB, 50.0) {
            Err(Refusal::Locked(pid)) => assert_eq!(pid, child.id()),
            Err(Refusal::Io(reason)) => panic!("{reason}"),
            Ok(_) => panic!("a second process's open of a held arena is refused"),
        }
        let _ = child.kill();
        let _ = child.wait();
        let arena = open(&dir, 2 * MIB);
        assert_eq!(arena.stats()["keys"], 5, "a dead holder's lock is taken over");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
