//! What a picture attached to a message must be (scripts/image-attach.cjs:
//! sniff, dimensions, cleanName, inspect, decode, isId, checkIds). The bytes
//! decide the type (PNG, JPEG, WebP or GIF); at most 5 MB and 25 megapixels;
//! at most four per message. The request shapes and the vision index stay
//! JavaScript: the engine builds requests with them on the spot. Pure.

use base64::Engine as _;
use serde_json::{json, Value};

use crate::js;
use crate::js_regex;

pub const MAX_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_PER_MESSAGE: usize = 4;
pub const MAX_PIXELS: f64 = 25_000_000.0;
const NAME_MAX: isize = 80;
/// The four types and their extensions, in the JavaScript table's order.
pub const TYPES: [(&str, &str); 4] = [("image/png", "png"), ("image/jpeg", "jpg"), ("image/webp", "webp"), ("image/gif", "gif")];

pub fn ext_of(mime: &str) -> Option<&'static str> {
    TYPES.iter().find(|(name, _)| *name == mime).map(|(_, ext)| *ext)
}

/// `(bytes / MiB).toFixed(bytes % MiB === 0 ? 0 : 1) + " MB"`.
fn say_megabytes(bytes: usize) -> String {
    let mib = 1024 * 1024;
    format!("{} MB", js::to_fixed(bytes as f64 / mib as f64, if bytes % mib == 0 { 0 } else { 1 }))
}

/// The type the first bytes say, or None.
pub fn sniff(b: &[u8]) -> Option<&'static str> {
    if b.len() < 12 {
        return None;
    }
    if b[..8] == [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] {
        return Some("image/png");
    }
    if b[..3] == [0xff, 0xd8, 0xff] {
        return Some("image/jpeg");
    }
    if b[..4] == [0x47, 0x49, 0x46, 0x38] && (b[4] == 0x37 || b[4] == 0x39) && b[5] == 0x61 {
        return Some("image/gif");
    }
    if b[..4] == [0x52, 0x49, 0x46, 0x46] && b[8..12] == [0x57, 0x45, 0x42, 0x50] {
        return Some("image/webp");
    }
    None
}

/// `b[at]` as JavaScript reads a Buffer: undefined past the end, which `|`
/// and `<<` turn into 0.
fn at(b: &[u8], index: usize) -> u32 {
    b.get(index).copied().unwrap_or(0) as u32
}

/// Width and height from the file's own header.
pub fn dimensions(b: &[u8], mime: &str) -> Option<(f64, f64)> {
    let be32 = |i: usize| ((at(b, i) << 24) | (at(b, i + 1) << 16) | (at(b, i + 2) << 8) | at(b, i + 3)) as f64;
    let le16 = |i: usize| (at(b, i) | (at(b, i + 1) << 8)) as f64;
    let le24 = |i: usize| (at(b, i) | (at(b, i + 1) << 8) | (at(b, i + 2) << 16)) as f64;
    match mime {
        "image/png" => (b.len() >= 24 && b[12..16] == [0x49, 0x48, 0x44, 0x52]).then(|| (be32(16), be32(20))),
        "image/gif" => (b.len() >= 10).then(|| (le16(6), le16(8))),
        "image/webp" => {
            let kind: Vec<u32> = (12..16).map(|i| at(b, i)).collect();
            let is = |text: &str| kind.iter().copied().eq(text.bytes().map(u32::from));
            if is("VP8 ") && b.len() >= 30 {
                Some(((le16(26) as u32 & 0x3fff) as f64, (le16(28) as u32 & 0x3fff) as f64))
            } else if is("VP8L") && b.len() >= 25 && b[20] == 0x2f {
                let bits = at(b, 21) | (at(b, 22) << 8) | (at(b, 23) << 16) | (at(b, 24) << 24);
                Some(((bits & 0x3fff) as f64 + 1.0, ((bits >> 14) & 0x3fff) as f64 + 1.0))
            } else if is("VP8X") && b.len() >= 30 {
                Some((le24(24) + 1.0, le24(27) + 1.0))
            } else {
                None
            }
        }
        "image/jpeg" => {
            let mut i = 2usize;
            while i + 9 < b.len() {
                if b[i] != 0xff {
                    i += 1;
                    continue;
                }
                let marker = b[i + 1];
                if marker == 0xff {
                    i += 1;
                    continue;
                }
                if marker == 0xd8 || (0xd0..=0xd7).contains(&marker) || marker == 0x01 || marker == 0x00 {
                    i += 2;
                    continue;
                }
                if (0xc0..=0xcf).contains(&marker) && marker != 0xc4 && marker != 0xc8 && marker != 0xcc {
                    return Some((((at(b, i + 7) << 8) | at(b, i + 8)) as f64, ((at(b, i + 5) << 8) | at(b, i + 6)) as f64));
                }
                let length = ((at(b, i + 2) << 8) | at(b, i + 3)) as usize;
                if length < 2 {
                    return None;
                }
                i += 2 + length;
            }
            None
        }
        _ => None,
    }
}

/// A name to show: no folders, no control characters, at most 80 characters.
pub fn clean_name(name: &Value, ext: &str) -> String {
    let text = if name.is_null() { String::new() } else { js::string(name) };
    let text = js_regex!(r"[\u0000-\u001f\u007f]", "g").replace_all(&text, " ");
    let last = js_regex!(r"[\\/]", "").split(&text).last().unwrap_or("").to_string();
    let squashed = js::trim(&js_regex!(r"\s+", "g").replace_all(&last, " ")).to_string();
    let base = js::trim(&js::slice(&squashed, 0, Some(NAME_MAX))).to_string();
    if !base.is_empty() && base != "." && base != ".." {
        base
    } else {
        format!("picture.{ext}")
    }
}

pub struct Verdict {
    pub mime: &'static str,
    pub ext: &'static str,
    pub width: f64,
    pub height: f64,
    pub bytes: usize,
    pub name: String,
}

fn refusal(error: impl Into<String>) -> Value {
    json!({ "ok": false, "error": error.into() })
}

/// The verdict on one file, or `{ ok: false, error }`.
pub fn inspect(name: &Value, mime: &Value, bytes: &[u8]) -> Result<Verdict, Value> {
    let length = bytes.len();
    if length == 0 {
        return Err(refusal("That file is empty."));
    }
    if length > MAX_BYTES {
        return Err(refusal(format!("That picture is {}; the limit is {}.", say_megabytes(length), say_megabytes(MAX_BYTES))));
    }
    let declared = if mime.is_null() { String::new() } else { js::trim(&js::string(mime).to_lowercase()).to_string() };
    if !declared.is_empty() && ext_of(&declared).is_none() {
        return Err(refusal("Pictures can be PNG, JPEG, WebP or GIF."));
    }
    let Some(real) = sniff(bytes) else {
        return Err(refusal("That file is not a PNG, JPEG, WebP or GIF picture, whatever its name says."));
    };
    let Some((width, height)) = dimensions(bytes, real).filter(|(width, height)| *width > 0.0 && *height > 0.0) else {
        return Err(refusal("That does not look like a complete picture."));
    };
    if width * height > MAX_PIXELS {
        return Err(refusal(format!(
            "That picture is {} by {} pixels; pictures up to {} megapixels are accepted.",
            js::number_string(width),
            js::number_string(height),
            js::number_string(MAX_PIXELS / 1_000_000.0)
        )));
    }
    let ext = ext_of(real).unwrap_or("png");
    Ok(Verdict { mime: real, ext, width, height, bytes: length, name: clean_name(name, ext) })
}

/// Node keeps whatever bits a last group has and wants no padding.
fn lenient() -> base64::engine::GeneralPurpose {
    let config = base64::engine::GeneralPurposeConfig::new()
        .with_decode_allow_trailing_bits(true)
        .with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent);
    base64::engine::GeneralPurpose::new(&base64::alphabet::STANDARD, config)
}

/// Node's lenient `Buffer.from(text, "base64")` for text the pattern already allowed.
fn from_base64(text: &str) -> Vec<u8> {
    let mut clean: String = text.chars().filter(|c| !js::is_space(*c)).collect();
    if let Some(end) = clean.find('=') {
        clean.truncate(end);
    }
    if clean.len() % 4 == 1 {
        clean.pop();
    }
    lenient().decode(clean.as_bytes()).unwrap_or_default()
}

pub fn to_base64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// What a page sent as a picture's contents, as bytes: base64 text (a data:
/// URL is fine) or bytes (`{ $mefi: "bytes" }` on the wire).
pub fn decode(data: &Value) -> Result<Vec<u8>, Value> {
    if let Some(text) = data.as_str() {
        // `data.slice(data.indexOf(",") + 1)`: no comma is the whole text.
        let body = if text.starts_with("data:") { text.find(',').map(|comma| &text[comma + 1..]).unwrap_or(text) } else { text };
        let limit = ((MAX_BYTES as f64 * 4.0) / 3.0).ceil() as usize + 16;
        if js::utf16_len(body) > limit {
            return Err(refusal(format!("That picture is over the limit of {}.", say_megabytes(MAX_BYTES))));
        }
        if !js_regex!(r"^[A-Za-z0-9+/\s]*={0,2}\s*$", "").is_match(body) {
            return Err(refusal("The picture could not be read."));
        }
        return Ok(from_base64(body));
    }
    let bytes = match data.get("$mefi").and_then(Value::as_str) {
        Some("bytes") => data.get("b64").and_then(Value::as_str).map(|b64| base64::engine::general_purpose::STANDARD.decode(b64).unwrap_or_default()),
        _ => None,
    };
    let Some(bytes) = bytes else { return Err(refusal("The picture could not be read.")) };
    if bytes.len() > MAX_BYTES {
        return Err(refusal(format!("That picture is {}; the limit is {}.", say_megabytes(bytes.len()), say_megabytes(MAX_BYTES))));
    }
    Ok(bytes)
}

pub fn is_id(value: &Value) -> bool {
    value.as_str().is_some_and(|text| js_regex!(r"^img_[a-f0-9]{24}$", "").is_match(text))
}

/// The ids a message names, checked: only real ids, no repeats, at most four.
pub fn check_ids(value: &Value) -> Result<Vec<String>, Value> {
    if value.is_null() {
        return Ok(vec![]);
    }
    let Some(list) = value.as_array() else {
        return Err(refusal("The pictures were not sent in a form Studio can read."));
    };
    let mut ids: Vec<Value> = Vec::new();
    for item in list {
        let id = if item.is_string() { item.clone() } else { item.get("id").cloned().unwrap_or(Value::Null) };
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    if ids.len() > MAX_PER_MESSAGE {
        return Err(refusal(format!("A message can carry up to {MAX_PER_MESSAGE} pictures.")));
    }
    if ids.iter().any(|id| !is_id(id)) {
        return Err(refusal("One of the pictures is not one Studio saved."));
    }
    Ok(ids.iter().map(js::string).collect())
}

/// Bytes as the parity tests send them (`{ $mefi: "bytes" }`), with no limit applied.
fn raw(value: &Value) -> Vec<u8> {
    value.get("b64").and_then(Value::as_str).and_then(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok()).unwrap_or_default()
}

/// The rules as the parity tests compare them.
pub fn call(function: &str, args: &[Value]) -> Option<Value> {
    let arg = |index: usize| args.get(index).cloned().unwrap_or(Value::Null);
    Some(match function {
        "sniff" => sniff(&raw(&arg(0))).map(|mime| json!(mime)).unwrap_or(Value::Null),
        "dimensions" => {
            match dimensions(&raw(&arg(0)), &js::string(&arg(1))) {
                Some((width, height)) => json!({ "width": js::num(width), "height": js::num(height) }),
                None => Value::Null,
            }
        }
        "cleanName" => json!(clean_name(&arg(0), args.get(1).and_then(Value::as_str).unwrap_or("png"))),
        "inspect" => {
            let request = arg(0);
            let bytes = raw(request.get("bytes").unwrap_or(&Value::Null));
            match inspect(request.get("name").unwrap_or(&Value::Null), request.get("mime").unwrap_or(&Value::Null), &bytes) {
                Ok(v) => json!({ "ok": true, "mime": v.mime, "ext": v.ext, "width": js::num(v.width), "height": js::num(v.height), "bytes": v.bytes, "name": v.name }),
                Err(refused) => refused,
            }
        }
        "decode" => match decode(&arg(0)) {
            Ok(bytes) => json!({ "ok": true, "base64": to_base64(&bytes) }),
            Err(refused) => refused,
        },
        "checkIds" => match check_ids(&arg(0)) {
            Ok(ids) => json!({ "ok": true, "ids": ids }),
            Err(refused) => refused,
        },
        _ => return None,
    })
}
