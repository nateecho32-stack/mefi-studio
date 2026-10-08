//! The arena's index: keys to entries, and content-addressed blobs with a
//! reference count, so a put of bytes already stored adds a key and not a
//! copy. `index.snap` is this structure as JSON (a periodic checkpoint written
//! to a temporary file and renamed); `index.log` carries what changed since.

use std::collections::HashMap;

use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::js;

pub type Hash = [u8; 32];

#[derive(Clone, Debug)]
pub struct Entry {
    pub hash: Hash,
    pub kind: String,
    /// Last touched (put or get), in ms; the LRU order.
    pub at: f64,
    pub put_at: f64,
    pub meta: Value,
    /// When the entry's time is up, in ms.
    pub ttl: Option<f64>,
    pub searchable: bool,
}

#[derive(Clone, Debug)]
pub struct Blob {
    pub off: u64,
    pub len: u64,
    pub order: u8,
    pub refs: u32,
}

#[derive(Default)]
pub struct Index {
    pub keys: IndexMap<String, Entry>,
    pub blobs: HashMap<Hash, Blob>,
    pub seq: u64,
    pub generation: u64,
    pub hits: u64,
    pub misses: u64,
    pub last_compact_at: Option<f64>,
}

pub fn hex(hash: &Hash) -> String {
    hash.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn unhex(text: &str) -> Option<Hash> {
    if text.len() != 64 {
        return None;
    }
    let mut hash = [0u8; 32];
    for (index, slot) in hash.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&text[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(hash)
}

impl Index {
    /// Adds a key, counting its blob's reference; the blob must exist. A key
    /// replaced points its old blob's count down and hands back the blob that
    /// lost its last reference, if any. The same content under the same key
    /// only refreshes the entry.
    pub fn insert(&mut self, key: String, entry: Entry) -> Option<(Hash, Blob)> {
        if self.keys.get(&key).is_some_and(|old| old.hash == entry.hash) {
            self.keys.insert(key, entry);
            return None;
        }
        let freed = self.remove(&key);
        if let Some(blob) = self.blobs.get_mut(&entry.hash) {
            blob.refs += 1;
        }
        self.keys.insert(key, entry);
        freed
    }

    /// Drops a key; answers the blob nobody references any more.
    pub fn remove(&mut self, key: &str) -> Option<(Hash, Blob)> {
        let old = self.keys.shift_remove(key)?;
        let blob = self.blobs.get_mut(&old.hash)?;
        blob.refs = blob.refs.saturating_sub(1);
        if blob.refs == 0 {
            self.blobs.remove(&old.hash).map(|blob| (old.hash, blob))
        } else {
            None
        }
    }

    pub fn live_bytes(&self) -> u64 {
        self.blobs.values().map(|blob| blob.len).sum()
    }

    pub fn snapshot(&self) -> Value {
        let blobs: Vec<Value> = self.blobs.iter().map(|(hash, blob)| json!([hex(hash), blob.off, blob.len, blob.order])).collect();
        let keys: Vec<Value> = self
            .keys
            .iter()
            .map(|(key, entry)| json!([key, hex(&entry.hash), entry.kind, js::num(entry.at), js::num(entry.put_at), entry.ttl.map_or(Value::Null, js::num), entry.searchable, entry.meta]))
            .collect();
        let mut out = Map::new();
        out.insert("version".into(), json!(1));
        out.insert("generation".into(), json!(self.generation));
        out.insert("seq".into(), json!(self.seq));
        out.insert("hits".into(), json!(self.hits));
        out.insert("misses".into(), json!(self.misses));
        out.insert("lastCompactAt".into(), self.last_compact_at.map_or(Value::Null, js::num));
        out.insert("blobs".into(), Value::Array(blobs));
        out.insert("keys".into(), Value::Array(keys));
        Value::Object(out)
    }

    /// A snapshot back; None when it is not one of ours.
    pub fn from_snapshot(value: &Value) -> Option<Index> {
        if value.get("version").and_then(Value::as_u64) != Some(1) {
            return None;
        }
        let mut index = Index { seq: value.get("seq").and_then(Value::as_u64)?, generation: value.get("generation").and_then(Value::as_u64)?, ..Index::default() };
        index.hits = value.get("hits").and_then(Value::as_u64).unwrap_or(0);
        index.misses = value.get("misses").and_then(Value::as_u64).unwrap_or(0);
        index.last_compact_at = value.get("lastCompactAt").and_then(Value::as_f64);
        for blob in value.get("blobs").and_then(Value::as_array)? {
            let hash = unhex(blob.get(0).and_then(Value::as_str)?)?;
            let off = blob.get(1).and_then(Value::as_u64)?;
            let len = blob.get(2).and_then(Value::as_u64)?;
            let order = blob.get(3).and_then(Value::as_u64)?.min(63) as u8;
            index.blobs.insert(hash, Blob { off, len, order, refs: 0 });
        }
        for key in value.get("keys").and_then(Value::as_array)? {
            let name = key.get(0).and_then(Value::as_str)?.to_string();
            let hash = unhex(key.get(1).and_then(Value::as_str)?)?;
            if !index.blobs.contains_key(&hash) {
                continue;
            }
            let entry = Entry {
                hash,
                kind: key.get(2).and_then(Value::as_str).unwrap_or("note").to_string(),
                at: key.get(3).and_then(Value::as_f64).unwrap_or(0.0),
                put_at: key.get(4).and_then(Value::as_f64).unwrap_or(0.0),
                ttl: key.get(5).and_then(Value::as_f64),
                searchable: key.get(6).and_then(Value::as_bool).unwrap_or(false),
                meta: key.get(7).cloned().unwrap_or(Value::Null),
            };
            index.insert(name, entry);
        }
        index.blobs.retain(|_, blob| blob.refs > 0);
        Some(index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(hash: u8, at: f64) -> Entry {
        Entry { hash: [hash; 32], kind: "note".into(), at, put_at: at, meta: Value::Null, ttl: None, searchable: true }
    }

    #[test]
    fn references_follow_keys() {
        let mut index = Index::default();
        index.blobs.insert([1; 32], Blob { off: 4096, len: 3, order: 0, refs: 0 });
        assert!(index.insert("a".into(), entry(1, 1.0)).is_none());
        assert!(index.insert("b".into(), entry(1, 2.0)).is_none());
        assert_eq!(index.blobs[&[1; 32]].refs, 2);
        assert!(index.remove("a").is_none(), "b still points at the blob");
        assert_eq!(index.remove("b").map(|(hash, blob)| (hash, blob.off)), Some(([1; 32], 4096)), "the last reference frees it");
        assert!(index.blobs.is_empty());
        assert!(index.remove("zzz").is_none());
        index.blobs.insert([2; 32], Blob { off: 8192, len: 5, order: 0, refs: 0 });
        index.blobs.insert([3; 32], Blob { off: 12288, len: 5, order: 0, refs: 0 });
        index.insert("c".into(), entry(2, 3.0));
        assert_eq!(index.insert("c".into(), entry(3, 4.0)).map(|(hash, _)| hash), Some([2; 32]), "replacing a key's content frees the old blob");
        assert!(index.insert("c".into(), entry(3, 5.0)).is_none(), "the same content again only refreshes the entry");
        assert_eq!(index.blobs[&[3; 32]].refs, 1);
        assert_eq!(index.keys["c"].at, 5.0);
        let snap = index.snapshot();
        let back = Index::from_snapshot(&snap).expect("reads back");
        assert_eq!(back.keys.len(), 1);
        assert_eq!(back.blobs[&[3; 32]].refs, 1);
        assert_eq!(hex(&[0xAB; 32]).len(), 64);
        assert_eq!(unhex(&hex(&[0xAB; 32])), Some([0xAB; 32]));
        assert_eq!(unhex("zz"), None);
    }
}
