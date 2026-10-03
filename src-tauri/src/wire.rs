//! The wire between this host and the engine (scripts/host-wire.cjs is the
//! engine's half). One frame is one line of JSON. Bodies the page or the
//! engine wrote are forwarded as bytes and never parsed here, so a large push
//! (a whole board) costs one scan, not a parse and a re-serialise.

use serde::Deserialize;
use serde_json::value::RawValue;

/// The fields this host reads from an engine frame. `body` stays raw.
#[derive(Deserialize)]
pub struct Head<'a> {
    pub t: String,
    #[serde(default)]
    pub id: Option<u64>,
    #[serde(default)]
    pub api: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default, borrow)]
    pub body: Option<&'a RawValue>,
}

pub fn parse_head(line: &[u8]) -> Result<Head<'_>, String> {
    serde_json::from_slice(line).map_err(|error| format!("unreadable engine frame: {error}"))
}

/// A frame whose body is JSON text someone else wrote. The body must be one
/// line; anything else would split the frame in two on the engine's side.
pub fn with_body(head: &str, body: &[u8]) -> Result<Vec<u8>, String> {
    if body.contains(&b'\n') {
        return Err("a frame body may not contain a newline".into());
    }
    let mut out = Vec::with_capacity(head.len() + body.len() + 12);
    out.extend_from_slice(head.as_bytes());
    out.extend_from_slice(b",\"body\":");
    out.extend_from_slice(if body.is_empty() { b"null" } else { body });
    out.extend_from_slice(b"}\n");
    Ok(out)
}

/// The opening of a frame, without its closing brace, for `with_body`.
pub fn head(t: &str, id: Option<u64>, ch: Option<&str>, tagged: bool) -> String {
    let mut text = format!("{{\"t\":{}", json_string(t));
    if let Some(id) = id {
        text.push_str(&format!(",\"id\":{id}"));
    }
    if let Some(ch) = ch {
        text.push_str(&format!(",\"ch\":{}", json_string(ch)));
    }
    if tagged {
        text.push_str(",\"tagged\":true");
    }
    text
}

/// A frame built entirely here, from parsed values.
pub fn value_frame(value: &serde_json::Value) -> Vec<u8> {
    let mut out = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    out.push(b'\n');
    out
}

pub fn json_string(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_is_forwarded_unparsed() {
        let frame = with_body(&head("invoke", Some(7), Some("projects:list"), false), br#"{"args":[1,"two"]}"#).unwrap();
        assert_eq!(
            std::str::from_utf8(&frame).unwrap(),
            "{\"t\":\"invoke\",\"id\":7,\"ch\":\"projects:list\",\"body\":{\"args\":[1,\"two\"]}}\n"
        );
    }

    #[test]
    fn newline_in_body_is_refused() {
        assert!(with_body(&head("send", None, Some("x"), false), b"[1,\n2]").is_err());
    }

    #[test]
    fn head_reads_without_parsing_body() {
        let line = br#"{"t":"result","id":3,"ok":true,"body":{"big":[1,2,3]}}"#;
        let parsed = parse_head(line).unwrap();
        assert_eq!(parsed.t, "result");
        assert_eq!(parsed.id, Some(3));
        assert_eq!(parsed.body.unwrap().get(), r#"{"big":[1,2,3]}"#);
    }

    #[test]
    fn channel_names_are_escaped() {
        assert_eq!(head("push", None, Some("a\"b"), true), "{\"t\":\"push\",\"ch\":\"a\\\"b\",\"tagged\":true");
    }
}
