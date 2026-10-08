//! Full-text search over the searchable kinds: an inverted index of the
//! arena's documents, scored with BM25 (k1 1.2, b 0.75). Tokens are the
//! lowercased runs of letters and digits longer than two characters, with no
//! stemming. The postings stay under 32 MB of heap: past that the oldest
//! documents leave the index (never the arena). `postings.bin` is this
//! structure written at snapshot time; absent or stale, it is rebuilt from
//! the arena at open. The JavaScript twin (scripts/scratch-rules.cjs) ranks
//! the same way: score descending, then last touch descending, then key.

use std::collections::HashMap;

use super::journal::crc32;

pub const K1: f64 = 1.2;
pub const B: f64 = 0.75;
/// Heap the postings may take before old documents leave.
pub const BUDGET: usize = 32 * 1024 * 1024;
const MIN_TOKEN: usize = 3;
const SNIPPET_CHARS: usize = 160;
const SNIPPET_LEAD: usize = 40;
const MAGIC: &[u8; 4] = b"MFPS";

/// The index's tokens of a text, with each token's first character index.
pub fn tokens_at(text: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut start = 0usize;
    let mut count = 0usize;
    for (index, c) in text.chars().enumerate() {
        if c.is_alphanumeric() {
            if count == 0 {
                start = index;
            }
            current.extend(c.to_lowercase());
            count += 1;
        } else if count > 0 {
            if count >= MIN_TOKEN {
                out.push((std::mem::take(&mut current), start));
            } else {
                current.clear();
            }
            count = 0;
        }
    }
    if count >= MIN_TOKEN {
        out.push((current, start));
    }
    out
}

pub fn tokens(text: &str) -> Vec<String> {
    tokens_at(text).into_iter().map(|(token, _)| token).collect()
}

/// The query's terms, each once, in the order first seen.
pub fn query_terms(query: &str) -> Vec<String> {
    let mut seen = Vec::new();
    for token in tokens(query) {
        if !seen.contains(&token) {
            seen.push(token);
        }
    }
    seen
}

/// A window of the text around its first query term, whitespace folded.
pub fn snippet(text: &str, terms: &[String]) -> String {
    let chars: Vec<char> = text.chars().collect();
    let hit = tokens_at(text).into_iter().find(|(token, _)| terms.contains(token)).map(|(_, at)| at).unwrap_or(0);
    let mut start = hit.saturating_sub(SNIPPET_LEAD);
    while start > 0 && start < hit && !chars[start - 1].is_whitespace() {
        start += 1;
    }
    let window: String = chars.iter().skip(start).take(SNIPPET_CHARS).collect();
    window.split_whitespace().collect::<Vec<_>>().join(" ")
}

struct Doc {
    key: String,
    len: u32,
    alive: bool,
}

#[derive(Default)]
pub struct Postings {
    terms: HashMap<String, Vec<(u32, u32)>>,
    docs: Vec<Doc>,
    by_key: HashMap<String, u32>,
    alive: usize,
    total_len: u64,
    bytes: usize,
}

impl Postings {
    pub fn add(&mut self, key: &str, text: &str) {
        self.remove(key);
        let mut counts: HashMap<String, u32> = HashMap::new();
        let mut len = 0u32;
        for token in tokens(text) {
            *counts.entry(token).or_insert(0) += 1;
            len += 1;
        }
        let id = self.docs.len() as u32;
        self.docs.push(Doc { key: key.to_string(), len, alive: true });
        self.by_key.insert(key.to_string(), id);
        self.alive += 1;
        self.total_len += u64::from(len);
        self.bytes += key.len() + 48;
        for (term, tf) in counts {
            let list = self.terms.entry(term).or_default();
            if list.is_empty() {
                self.bytes += 64;
            }
            list.push((id, tf));
            self.bytes += 8;
        }
    }

    pub fn remove(&mut self, key: &str) {
        if let Some(id) = self.by_key.remove(key) {
            if let Some(doc) = self.docs.get_mut(id as usize) {
                if doc.alive {
                    doc.alive = false;
                    self.alive -= 1;
                    self.total_len -= u64::from(doc.len);
                }
            }
        }
    }

    pub fn contains(&self, key: &str) -> bool {
        self.by_key.contains_key(key)
    }

    pub fn alive(&self) -> usize {
        self.alive
    }

    pub fn dead(&self) -> usize {
        self.docs.len() - self.alive
    }

    pub fn bytes(&self) -> usize {
        self.bytes
    }

    pub fn over_budget(&self) -> bool {
        self.bytes > BUDGET
    }

    /// The live keys, oldest first.
    pub fn keys(&self) -> Vec<String> {
        self.docs.iter().filter(|doc| doc.alive).map(|doc| doc.key.clone()).collect()
    }

    /// Forgets the oldest `count` live documents.
    pub fn drop_oldest(&mut self, count: usize) -> Vec<String> {
        let keys: Vec<String> = self.keys().into_iter().take(count).collect();
        for key in &keys {
            self.remove(key);
        }
        keys
    }

    /// Starts over from `docs` (key, text), oldest first.
    pub fn rebuild(&mut self, docs: Vec<(String, String)>) {
        *self = Postings::default();
        for (key, text) in docs {
            self.add(&key, &text);
        }
    }

    /// Every live document a term of the query appears in, with its score.
    pub fn search(&self, query: &str) -> Vec<(String, f64)> {
        let terms = query_terms(query);
        if terms.is_empty() || self.alive == 0 {
            return Vec::new();
        }
        let n = self.alive as f64;
        let avgdl = self.total_len as f64 / n;
        let mut scores: HashMap<u32, f64> = HashMap::new();
        for term in &terms {
            let Some(list) = self.terms.get(term) else { continue };
            let df = list.iter().filter(|(id, _)| self.docs[*id as usize].alive).count() as f64;
            if df == 0.0 {
                continue;
            }
            let idf = (1.0 + (n - df + 0.5) / (df + 0.5)).ln();
            for (id, tf) in list {
                let doc = &self.docs[*id as usize];
                if !doc.alive {
                    continue;
                }
                let tf = f64::from(*tf);
                let dl = f64::from(doc.len);
                let part = idf * (tf * (K1 + 1.0)) / (tf + K1 * (1.0 - B + B * dl / avgdl));
                *scores.entry(*id).or_insert(0.0) += part;
            }
        }
        scores.into_iter().map(|(id, score)| (self.docs[id as usize].key.clone(), score)).collect()
    }

    /// postings.bin: the live documents and their terms, with the snapshot's
    /// generation and sequence so a stale file is known at open.
    pub fn encode(&self, generation: u64, seq: u64) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.bytes + 64);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&1u32.to_le_bytes());
        out.extend_from_slice(&generation.to_le_bytes());
        out.extend_from_slice(&seq.to_le_bytes());
        let mut renumber: HashMap<u32, u32> = HashMap::new();
        let live: Vec<(u32, &Doc)> = self.docs.iter().enumerate().filter(|(_, doc)| doc.alive).map(|(id, doc)| (id as u32, doc)).collect();
        out.extend_from_slice(&(live.len() as u32).to_le_bytes());
        for (new_id, (old_id, doc)) in live.iter().enumerate() {
            renumber.insert(*old_id, new_id as u32);
            out.extend_from_slice(&(doc.key.len() as u32).to_le_bytes());
            out.extend_from_slice(doc.key.as_bytes());
            out.extend_from_slice(&doc.len.to_le_bytes());
        }
        let mut terms: Vec<(&String, Vec<(u32, u32)>)> =
            self.terms.iter().map(|(term, list)| (term, list.iter().filter_map(|(id, tf)| renumber.get(id).map(|new| (*new, *tf))).collect::<Vec<_>>())).filter(|(_, list)| !list.is_empty()).collect();
        terms.sort_by(|a, b| a.0.cmp(b.0));
        out.extend_from_slice(&(terms.len() as u32).to_le_bytes());
        for (term, list) in terms {
            out.extend_from_slice(&(term.len() as u32).to_le_bytes());
            out.extend_from_slice(term.as_bytes());
            out.extend_from_slice(&(list.len() as u32).to_le_bytes());
            for (id, tf) in list {
                out.extend_from_slice(&id.to_le_bytes());
                out.extend_from_slice(&tf.to_le_bytes());
            }
        }
        let crc = crc32(&out);
        out.extend_from_slice(&crc.to_le_bytes());
        out
    }

    /// Reads a postings file back when it is whole and carries the given
    /// generation and sequence.
    pub fn decode(bytes: &[u8], generation: u64, seq: u64) -> Option<Postings> {
        if bytes.len() < 32 || &bytes[..4] != MAGIC {
            return None;
        }
        let body = &bytes[..bytes.len() - 4];
        let crc = u32::from_le_bytes(bytes[bytes.len() - 4..].try_into().ok()?);
        if crc32(body) != crc {
            return None;
        }
        let mut at = 4usize;
        let u32_at = |at: &mut usize| -> Option<u32> {
            let value = u32::from_le_bytes(body.get(*at..*at + 4)?.try_into().ok()?);
            *at += 4;
            Some(value)
        };
        if u32_at(&mut at)? != 1 {
            return None;
        }
        let read_u64 = |at: &mut usize| -> Option<u64> {
            let value = u64::from_le_bytes(body.get(*at..*at + 8)?.try_into().ok()?);
            *at += 8;
            Some(value)
        };
        if read_u64(&mut at)? != generation || read_u64(&mut at)? != seq {
            return None;
        }
        let mut postings = Postings::default();
        let docs = u32_at(&mut at)? as usize;
        for id in 0..docs {
            let key_len = u32_at(&mut at)? as usize;
            let key = std::str::from_utf8(body.get(at..at + key_len)?).ok()?.to_string();
            at += key_len;
            let len = u32_at(&mut at)?;
            postings.by_key.insert(key.clone(), id as u32);
            postings.bytes += key.len() + 48;
            postings.total_len += u64::from(len);
            postings.docs.push(Doc { key, len, alive: true });
        }
        postings.alive = docs;
        let terms = u32_at(&mut at)? as usize;
        for _ in 0..terms {
            let term_len = u32_at(&mut at)? as usize;
            let term = std::str::from_utf8(body.get(at..at + term_len)?).ok()?.to_string();
            at += term_len;
            let count = u32_at(&mut at)? as usize;
            let mut list = Vec::with_capacity(count);
            for _ in 0..count {
                let id = u32_at(&mut at)?;
                let tf = u32_at(&mut at)?;
                if id as usize >= docs {
                    return None;
                }
                list.push((id, tf));
            }
            postings.bytes += 64 + 8 * count;
            postings.terms.insert(term, list);
        }
        (at == body.len()).then_some(postings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizer_rules() {
        assert_eq!(tokens("The quick-brown fox's 42 jumps, ÉTÉ à Zürich! ab abc"), vec!["the", "quick", "brown", "fox", "jumps", "été", "zürich", "abc"]);
        assert_eq!(tokens(""), Vec::<String>::new());
        assert_eq!(tokens("a b cd"), Vec::<String>::new());
        assert_eq!(tokens_at("  Hello, World"), vec![("hello".to_string(), 2), ("world".to_string(), 9)]);
        assert_eq!(query_terms("Fox fox FOX hound"), vec!["fox", "hound"]);
    }

    #[test]
    fn snippet_centres_on_the_first_term() {
        let text = format!("{} needle in the haystack {}", "lead ".repeat(30), "tail ".repeat(60));
        let out = snippet(&text, &["needle".to_string()]);
        assert!(out.starts_with("lead lead"), "{out}");
        assert!(out.contains("needle in the haystack"));
        assert!(out.chars().count() <= SNIPPET_CHARS);
        assert_eq!(snippet("short\n\ntext   here", &["zzz".to_string()]), "short text here");
    }

    fn corpus() -> Postings {
        let mut postings = Postings::default();
        postings.add("a", "the cat sat on the mat");
        postings.add("b", "the dog sat on the log near the cat");
        postings.add("c", "cats and dogs");
        postings.add("d", "a mat, a mat, a mat and nothing else at all for the record");
        postings.add("e", "unrelated words only here");
        postings
    }

    fn ranked(postings: &Postings, query: &str) -> Vec<(String, f64)> {
        let mut hits = postings.search(query);
        hits.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(&b.0)));
        hits
    }

    #[test]
    fn bm25_ranks_a_fixed_corpus() {
        let postings = corpus();
        let hits = ranked(&postings, "cat");
        assert_eq!(hits.iter().map(|(key, _)| key.as_str()).collect::<Vec<_>>(), vec!["a", "b"], "no stemming: cats is another word");
        assert!(hits[0].1 > hits[1].1, "the shorter document scores higher for the same tf");
        let hits = ranked(&postings, "mat");
        assert_eq!(hits.iter().map(|(key, _)| key.as_str()).collect::<Vec<_>>(), vec!["d", "a"], "tf 3 beats tf 1 even in a longer document");
        let hits = ranked(&postings, "sat log");
        assert_eq!(hits[0].0, "b");
        assert_eq!(hits.len(), 2);
        // The exact number, from the formula: one term, df 2 of 5, tf 1,
        // dl 5 ("on" is too short to count), avgdl 30 / 5.
        let n = 5.0_f64;
        let idf = (1.0 + (n - 2.0 + 0.5) / 2.5).ln();
        let expected = idf * (1.0 * 2.2) / (1.0 + 1.2 * (0.25 + 0.75 * 5.0 / 6.0));
        let hits = ranked(&postings, "cat");
        assert!((hits[0].1 - expected).abs() < 1e-12, "{} vs {expected}", hits[0].1);
        assert!(postings.search("zebra").is_empty());
        assert!(postings.search("").is_empty());
    }

    #[test]
    fn replace_remove_trim_and_the_file() {
        let mut postings = corpus();
        postings.add("a", "the parrot sat on the perch");
        assert_eq!(postings.alive(), 5);
        assert_eq!(postings.dead(), 1);
        assert!(ranked(&postings, "cat").iter().all(|(key, _)| key != "a"), "a replaced document loses its old terms");
        postings.remove("b");
        assert!(ranked(&postings, "cat").is_empty());
        assert_eq!(postings.drop_oldest(2), vec!["c", "d"]);
        assert_eq!(postings.keys(), vec!["e", "a"]);
        let bytes = postings.encode(4, 99);
        let back = Postings::decode(&bytes, 4, 99).expect("reads back");
        assert_eq!(back.keys(), vec!["e", "a"]);
        assert_eq!(ranked(&back, "parrot")[0].0, "a");
        assert!(Postings::decode(&bytes, 5, 99).is_none(), "another generation is stale");
        let mut bent = bytes.clone();
        bent[20] ^= 1;
        assert!(Postings::decode(&bent, 4, 99).is_none(), "a changed byte fails the crc");
        postings.rebuild(vec![("x".into(), "fresh start".into())]);
        assert_eq!(postings.keys(), vec!["x"]);
        assert_eq!(postings.dead(), 0);
        assert!(!postings.over_budget());
    }
}
