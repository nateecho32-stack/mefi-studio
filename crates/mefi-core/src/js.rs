//! JavaScript's rules, where a port must reproduce them exactly: what counts
//! as true, how a number prints, Math.round, toFixed, toISOString, string
//! lengths in UTF-16 units, and the order localeCompare gives ASCII text.
//! The engine's answers are JSON for JavaScript callers, so a value that
//! prints differently here is a different answer there.

use std::cmp::Ordering;

use serde_json::{Map, Value};

pub type Object = Map<String, Value>;

/// Date.now().
pub fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

/// A number as JavaScript would hand it to JSON: integers without a
/// fraction, NaN and the infinities as null.
pub fn num(value: f64) -> Value {
    if !value.is_finite() {
        Value::Null
    } else if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        Value::from(value as i64)
    } else {
        Value::from(value)
    }
}

/// `typeof value === "number"`, as an f64.
pub fn number(value: &Value) -> Option<f64> {
    value.as_f64()
}

/// `typeof value === "number" && Number.isFinite(value)`.
pub fn finite(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.is_finite())
}

/// `Number.isFinite(value) && value >= 0`.
pub fn finite_time(value: &Value) -> Option<f64> {
    finite(value).filter(|n| *n >= 0.0)
}

/// `Number.isSafeInteger(value)`.
pub fn safe_integer(value: &Value) -> Option<f64> {
    finite(value).filter(|n| n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0)
}

/// JavaScript truthiness.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// Property access with optional chaining: `value?.key`, None for undefined.
/// Only objects have properties here; a string's or array's own properties
/// are never what the engine reads.
pub fn get<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => map.get(key),
        _ => None,
    }
}

/// `value?.a?.b?.c`.
pub fn path<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().try_fold(value, |current, key| get(current, key))
}

/// `value ?? fallback` for a property that may be missing.
pub fn or_null(value: Option<&Value>) -> Value {
    match value {
        Some(Value::Null) | None => Value::Null,
        Some(other) => other.clone(),
    }
}

/// True for undefined or null (`value == null`).
pub fn nullish(value: Option<&Value>) -> bool {
    matches!(value, None | Some(Value::Null))
}

/// `String(number)`.
pub fn number_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if value == 0.0 {
        return "0".into();
    }
    let magnitude = value.abs();
    if (1e-6..1e21).contains(&magnitude) {
        if value.fract() == 0.0 {
            return format!("{value:.0}");
        }
        return format!("{value}");
    }
    // Exponent form, as JavaScript writes it: 1e+21, 1.5e-7.
    let text = format!("{value:e}");
    match text.split_once('e') {
        Some((mantissa, exponent)) if !exponent.starts_with('-') => format!("{mantissa}e+{exponent}"),
        _ => text,
    }
}

/// `String(value)`.
pub fn string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(n) => number_string(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| if item.is_null() { String::new() } else { string(item) })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// `Number(value)` for the shapes the engine passes.
pub fn to_number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                0.0
            } else if let Some(hex) = trimmed.strip_prefix("0x").or_else(|| trimmed.strip_prefix("0X")) {
                u64::from_str_radix(hex, 16).map(|n| n as f64).unwrap_or(f64::NAN)
            } else {
                match trimmed {
                    "Infinity" | "+Infinity" => f64::INFINITY,
                    "-Infinity" => f64::NEG_INFINITY,
                    _ if trimmed.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-')) => trimmed.parse().unwrap_or(f64::NAN),
                    _ => f64::NAN,
                }
            }
        }
        Some(Value::Array(items)) => match items.as_slice() {
            [] => 0.0,
            [only] => to_number(Some(&Value::String(string(only)))),
            _ => f64::NAN,
        },
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// Math.round: halves go toward +Infinity.
pub fn round(value: f64) -> f64 {
    if !value.is_finite() {
        return value;
    }
    let floor = value.floor();
    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// Number.prototype.toFixed: an exact tie rounds away from zero (the larger n).
pub fn to_fixed(value: f64, digits: usize) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value.abs() >= 1e21 || value.is_infinite() {
        return number_string(value);
    }
    // Rust prints the exact binary value to any precision; round it by hand.
    let exact = format!("{:.*}", digits + 30, value.abs());
    let (whole, fraction) = exact.split_once('.').unwrap_or((&exact, ""));
    let mut kept: Vec<u8> = whole.bytes().chain(fraction.bytes().take(digits)).collect();
    let rest = &fraction.as_bytes()[digits.min(fraction.len())..];
    if rest.first().is_some_and(|d| *d >= b'5') {
        let mut index = kept.len();
        loop {
            if index == 0 {
                kept.insert(0, b'1');
                break;
            }
            index -= 1;
            if kept[index] == b'9' {
                kept[index] = b'0';
            } else {
                kept[index] += 1;
                break;
            }
        }
    }
    let split = kept.len() - digits;
    let mut out = String::from_utf8(kept[..split].to_vec()).unwrap_or_default();
    if digits > 0 {
        out.push('.');
        out.push_str(std::str::from_utf8(&kept[split..]).unwrap_or_default());
    }
    // JavaScript keeps the sign of a negative value even when it rounds to zero.
    if value < 0.0 {
        out.insert(0, '-');
    }
    out
}

/// Date.prototype.toISOString for a millisecond time.
pub fn iso_string(ms: f64) -> Option<String> {
    if !ms.is_finite() || ms.abs() > 8.64e15 {
        return None;
    }
    let ms = ms as i64;
    let days = ms.div_euclid(86_400_000);
    let rest = ms.rem_euclid(86_400_000);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    if month <= 2 {
        year += 1;
    }
    let (hour, minute, second, milli) = (rest / 3_600_000, rest / 60_000 % 60, rest / 1000 % 60, rest % 1000);
    let year_text = if (0..=9999).contains(&year) { format!("{year:04}") } else { format!("{}{:06}", if year < 0 { '-' } else { '+' }, year.abs()) };
    Some(format!("{year_text}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z"))
}

/// `text.length`: UTF-16 code units.
pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `text.slice(start, end)` in UTF-16 code units; a negative start counts from the end.
pub fn slice(text: &str, start: isize, end: Option<isize>) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    let len = units.len() as isize;
    let clamp = |index: isize| if index < 0 { (len + index).max(0) } else { index.min(len) } as usize;
    let from = clamp(start);
    let to = end.map_or(units.len(), clamp);
    if from >= to {
        return String::new();
    }
    String::from_utf16_lossy(&units[from..to])
}

// ---- localeCompare ----
//
// V8 compares with ICU's root collation. For the ASCII text the engine sorts
// (session ids, file paths) that order is: whitespace, then punctuation and
// symbols in the order below, then digits, then letters with case ignored;
// a tie on that is broken lowercase-first, and a tie on that by code unit.

const PUNCTUATION: &str = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

fn primary(c: char) -> (u8, u32) {
    match c {
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' => (0, c as u32),
        _ if c.is_ascii_digit() => (2, c as u32),
        _ if c.is_ascii_alphabetic() => (3, c.to_ascii_lowercase() as u32),
        _ => match PUNCTUATION.find(c) {
            Some(index) => (1, index as u32),
            None if c.is_alphabetic() => (3, c.to_lowercase().next().unwrap_or(c) as u32),
            None => (1, 1000 + c as u32),
        },
    }
}

pub fn locale_compare(a: &str, b: &str) -> Ordering {
    let left: Vec<(u8, u32)> = a.chars().map(primary).collect();
    let right: Vec<(u8, u32)> = b.chars().map(primary).collect();
    left.cmp(&right)
        .then_with(|| {
            let case = |text: &str| text.chars().map(|c| u8::from(c.is_uppercase())).collect::<Vec<_>>();
            case(a).cmp(&case(b))
        })
        .then_with(|| a.encode_utf16().cmp(b.encode_utf16()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numbers_print_like_javascript() {
        assert_eq!(num(3.0), json!(3));
        assert_eq!(num(0.5), json!(0.5));
        assert_eq!(num(f64::NAN), Value::Null);
        assert_eq!(number_string(1e21), "1e+21");
        assert_eq!(number_string(1800000000000.0), "1800000000000");
        assert_eq!(number_string(0.1 + 0.2), "0.30000000000000004");
    }

    #[test]
    fn rounding_follows_math_round_and_to_fixed() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(0.49999999999999994), 0.0);
        assert_eq!(to_fixed(1.0625, 3), "1.063");
        assert_eq!(to_fixed(0.0, 3), "0.000");
        assert_eq!(to_fixed(12.34567, 3), "12.346");
        assert_eq!(to_fixed(-0.0001, 3), "-0.000");
        assert_eq!(to_fixed(-1.5, 3), "-1.500");
        assert_eq!(to_fixed(0.9995, 3), "1.000"); // 0.9995 is stored just above the tie
        assert_eq!(to_fixed(1.005, 2), "1.00"); // and 1.005 just below it
    }

    #[test]
    fn iso_strings_match_date() {
        assert_eq!(iso_string(1_800_000_000_000.0).unwrap(), "2027-01-15T08:00:00.000Z");
        assert_eq!(iso_string(0.0).unwrap(), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_string(1_791_063_811_258.0).unwrap(), "2026-10-03T21:43:31.258Z");
    }

    #[test]
    fn slices_count_utf16_units() {
        assert_eq!(utf16_len("a😀"), 3);
        assert_eq!(slice("abcdef", -2, None), "ef");
        assert_eq!(slice("abcdef", 0, Some(3)), "abc");
    }

    #[test]
    fn locale_order_is_icu_like() {
        assert_eq!(locale_compare("a", "B"), Ordering::Less);
        assert_eq!(locale_compare("a", "A"), Ordering::Less);
        assert_eq!(locale_compare("ses_b", "ses_a"), Ordering::Greater);
        assert_eq!(locale_compare("a_b", "a1"), Ordering::Less, "punctuation before digits");
        assert_eq!(locale_compare("file-2", "file.2"), Ordering::Less);
        assert_eq!(locale_compare("same", "same"), Ordering::Equal);
    }

    #[test]
    fn strings_and_numbers_convert_like_javascript() {
        assert_eq!(string(&json!([1, null, "x"])), "1,,x");
        assert_eq!(string(&json!({})), "[object Object]");
        assert_eq!(to_number(Some(&json!(" 12 "))), 12.0);
        assert!(to_number(Some(&json!("abc"))).is_nan());
        assert_eq!(to_number(Some(&Value::Null)), 0.0);
        assert!(to_number(None).is_nan());
    }
}
