//! JavaScript regular expressions, run by Rust's `regex` crate with
//! JavaScript's meaning. A port copies a pattern's source exactly as the
//! JavaScript writes it between the slashes, with its flags, and gets the
//! same matches:
//!
//! - `\b`, `\w` and `\d` are ASCII, as in a JavaScript pattern without the
//!   `u` flag (Rust's are Unicode).
//! - `\s` is JavaScript's set (it has U+FEFF and not U+0085, unlike Rust's).
//! - `.` stops at `\n`, `\r`, U+2028 and U+2029 (Rust's stops at `\n` only).
//! - `i` folds ASCII letters only: without `u`, JavaScript never matches
//!   `ſ` for `s` or the Kelvin sign for `k`, which Rust's Unicode `(?i)` does.
//!
//! What JavaScript has and Rust's engine does not (lookaround,
//! backreferences, `\B`) is refused when the pattern is built, so a port finds
//! out on its first run, never by a wrong answer. Rust's leftmost-first
//! matching gives the same match and groups as JavaScript's backtracking for
//! everything that is accepted.

use regex::{Regex, RegexBuilder};

const SPACE: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";
const WORD: &str = "0-9A-Za-z_";
const DIGIT: &str = "0-9";
const DOT: &str = r"[^\n\r\x{2028}\x{2029}]";

/// A pattern built once per call site: `js_regex!(r"\bgh_[A-Z]+", "i")`.
#[macro_export]
macro_rules! js_regex {
    ($source:expr, $flags:expr) => {{
        static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        RE.get_or_init(|| $crate::jsre::compile($source, $flags))
    }};
}

/// Builds a JavaScript pattern; panics on one Rust's engine cannot run the
/// same way (a programming error in a port, found by its first test).
pub fn compile(source: &str, flags: &str) -> Regex {
    let translated = translate(source, flags);
    RegexBuilder::new(&translated)
        .size_limit(64 << 20)
        .dfa_size_limit(64 << 20)
        .build()
        .unwrap_or_else(|error| panic!("/{source}/{flags} as {translated}: {error}"))
}

fn hex(chars: &[char], at: usize, count: usize) -> Option<u32> {
    let digits: String = chars.get(at..at + count)?.iter().collect();
    if digits.chars().all(|c| c.is_ascii_hexdigit()) {
        u32::from_str_radix(&digits, 16).ok()
    } else {
        None
    }
}

/// One character inside a class: printable ASCII escaped where Rust needs
/// it, anything else by its code point.
fn class_char(c: char) -> String {
    if c.is_ascii_graphic() || c == ' ' {
        regex::escape(&c.to_string())
    } else {
        format!("\\x{{{:X}}}", c as u32)
    }
}

/// One character as a Rust pattern, outside a class.
fn literal(c: char, fold: bool) -> String {
    if fold && c.is_ascii_alphabetic() {
        format!("[{}{}]", c.to_ascii_lowercase(), c.to_ascii_uppercase())
    } else {
        class_char(c)
    }
}

/// What an escape after a backslash stands for: a set (`\d`, `\s`, ...) or one character.
enum Escape {
    Set(String),
    Char(char),
    Boundary,
}

fn read_escape(chars: &[char], at: usize, in_class: bool, source: &str) -> (Escape, usize) {
    let Some(&c) = chars.get(at) else { panic!("/{source}/ ends in a backslash") };
    let set = |inner: &str, negated: bool| Escape::Set(format!("[{}{inner}]", if negated { "^" } else { "" }));
    match c {
        'd' => (set(DIGIT, false), 1),
        'D' => (set(DIGIT, true), 1),
        'w' => (set(WORD, false), 1),
        'W' => (set(WORD, true), 1),
        's' => (set(SPACE, false), 1),
        'S' => (set(SPACE, true), 1),
        'b' if in_class => (Escape::Char('\u{8}'), 1),
        'b' => (Escape::Boundary, 1),
        'n' => (Escape::Char('\n'), 1),
        'r' => (Escape::Char('\r'), 1),
        't' => (Escape::Char('\t'), 1),
        'v' => (Escape::Char('\u{b}'), 1),
        'f' => (Escape::Char('\u{c}'), 1),
        '0' if !chars.get(at + 1).is_some_and(char::is_ascii_digit) => (Escape::Char('\0'), 1),
        'u' => match hex(chars, at + 1, 4).and_then(char::from_u32) {
            Some(found) => (Escape::Char(found), 5),
            None => panic!("/{source}/: \\u needs four hex digits (and no surrogate halves)"),
        },
        'x' => match hex(chars, at + 1, 2).and_then(char::from_u32) {
            Some(found) => (Escape::Char(found), 3),
            None => panic!("/{source}/: \\x needs two hex digits"),
        },
        'B' | 'c' | 'k' | 'p' | 'P' => panic!("/{source}/: \\{c} is not supported"),
        '1'..='9' => panic!("/{source}/: backreferences are not supported"),
        other => (Escape::Char(other), 1),
    }
}

/// `[...]` starting at `at`: the Rust class and how many characters it took.
fn read_class(chars: &[char], at: usize, fold: bool, source: &str) -> (String, usize) {
    let mut i = at + 1;
    let negated = chars.get(i) == Some(&'^');
    if negated {
        i += 1;
    }
    if chars.get(i) == Some(&']') {
        panic!("/{source}/: an empty class is not supported");
    }
    let mut items = String::new();
    let mut ranges: Vec<(char, char)> = Vec::new();
    loop {
        let Some(&c) = chars.get(i) else { panic!("/{source}/: a class is not closed") };
        if c == ']' {
            i += 1;
            break;
        }
        // One atom: a character or a set.
        let (atom, used) = if c == '\\' {
            let (escape, used) = read_escape(chars, i + 1, true, source);
            (escape, used + 1)
        } else {
            (Escape::Char(c), 1)
        };
        i += used;
        match atom {
            Escape::Set(set) => {
                // A set inside a class is a nested class in Rust: [a[^b]] is their union.
                items.push_str(&set);
            }
            Escape::Boundary => unreachable!("\\b in a class is a backspace"),
            Escape::Char(low) => {
                // "a-z" is a range unless the dash ends the class or the far end is a set.
                if chars.get(i) == Some(&'-') && chars.get(i + 1).is_some_and(|next| *next != ']') {
                    let (high, used) = if chars[i + 1] == '\\' {
                        let (escape, used) = read_escape(chars, i + 2, true, source);
                        (escape, used + 2)
                    } else {
                        (Escape::Char(chars[i + 1]), 2)
                    };
                    if let Escape::Char(high) = high {
                        if high < low {
                            panic!("/{source}/: a class range is out of order");
                        }
                        items.push_str(&format!("{}-{}", class_char(low), class_char(high)));
                        ranges.push((low, high));
                        i += used;
                        continue;
                    }
                    // "\d-x" or "a-\d": the dash is a character (Annex B); the set is read next round.
                    items.push_str(&class_char(low));
                    ranges.push((low, low));
                    items.push_str(&class_char('-'));
                    i += 1;
                    continue;
                }
                items.push_str(&class_char(low));
                ranges.push((low, low));
            }
        }
    }
    if fold {
        // ASCII letters match in either case.
        for (low, high) in ranges {
            for (from, to, shift) in [('a', 'z', -32i32), ('A', 'Z', 32)] {
                let start = low.max(from);
                let end = high.min(to);
                if start <= end {
                    let move_by = |c: char| char::from_u32((c as i32 + shift) as u32).unwrap_or(c);
                    items.push_str(&format!("{}-{}", move_by(start), move_by(end)));
                }
            }
        }
    }
    (format!("[{}{items}]", if negated { "^" } else { "" }), i - at)
}

/// A JavaScript pattern (source and flags) as a Rust pattern with the same meaning.
pub fn translate(source: &str, flags: &str) -> String {
    let fold = flags.contains('i');
    let dot_all = flags.contains('s');
    if flags.contains('u') || flags.contains('v') || flags.contains('m') || flags.contains('y') {
        panic!("/{source}/{flags}: only the g, i and s flags are supported");
    }
    let chars: Vec<char> = source.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '\\' => {
                let (escape, used) = read_escape(&chars, i + 1, false, source);
                out.push_str(&match escape {
                    Escape::Set(set) => set,
                    Escape::Boundary => r"(?-u:\b)".into(),
                    Escape::Char(found) => literal(found, fold),
                });
                i += 1 + used;
            }
            '[' => {
                let (class, used) = read_class(&chars, i, fold, source);
                out.push_str(&class);
                i += used;
            }
            '.' => {
                out.push_str(if dot_all { r"(?s:.)" } else { DOT });
                i += 1;
            }
            '(' if chars.get(i + 1) == Some(&'?') => match (chars.get(i + 2), chars.get(i + 3)) {
                (Some(':'), _) => {
                    out.push_str("(?:");
                    i += 3;
                }
                (Some('<'), Some(next)) if *next != '=' && *next != '!' => {
                    out.push_str("(?P<");
                    i += 3;
                }
                _ => panic!("/{source}/: lookaround is not supported"),
            },
            '{' => {
                // Only a quantifier: {n}, {n,} or {n,m}.
                let close = chars[i..].iter().position(|ch| *ch == '}').map(|offset| i + offset);
                let body: String = close.map(|end| chars[i + 1..end].iter().collect()).unwrap_or_default();
                let valid = !body.is_empty()
                    && body.split(',').count() <= 2
                    && body.split(',').next().is_some_and(|first| !first.is_empty() && first.chars().all(|d| d.is_ascii_digit()))
                    && body.split(',').nth(1).is_none_or(|second| second.chars().all(|d| d.is_ascii_digit()));
                if !valid {
                    panic!("/{source}/: a literal {{ must be escaped");
                }
                let end = close.expect("checked");
                out.extend(&chars[i..=end]);
                i = end + 1;
            }
            '(' | ')' | '|' | '^' | '$' | '*' | '+' | '?' => {
                out.push(c);
                i += 1;
            }
            other => {
                out.push_str(&literal(other, fold));
                i += 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_and_space_are_javascripts() {
        let re = compile(r"\bgh[pousr]_[A-Za-z0-9]{3,}\b", "");
        assert!(re.is_match("é ghp_abc"));
        // ASCII \b: an accented letter is not a word character in JavaScript.
        assert!(re.is_match("éghp_abc"));
        assert!(!compile(r"^\s$", "").is_match("\u{85}"));
        assert!(compile(r"^\s$", "").is_match("\u{feff}"));
        assert!(!compile(r"^a.b$", "").is_match("a\rb"));
        assert!(compile(r"^a[\s\S]b$", "").is_match("a\rb"));
    }

    #[test]
    fn case_folding_is_ascii() {
        let re = compile(r"^secret$", "i");
        assert!(re.is_match("SeCrEt"));
        assert!(!re.is_match("\u{17f}ecret"));
        assert!(compile(r"^[a-c]+$", "i").is_match("AbC"));
        assert!(compile(r"^[^a-z]$", "i").is_match("1"));
        assert!(!compile(r"^[^a-z]$", "i").is_match("Q"));
    }

    #[test]
    fn classes_and_quantifiers() {
        assert_eq!(translate(r"[A-Za-z0-9._-]{1,100}", ""), r"[A-Za-z0-9\._\-]{1,100}");
        assert!(compile(r"^[-.]+$", "").is_match("-.-"));
        assert!(compile(r"^\{(\w+)\}$", "").is_match("{abc}"));
        assert!(compile(r"^[\d.]+$", "").is_match("1.5"));
        assert!(compile(r"^[—―]{2,}$", "").is_match("——"));
        assert!(compile(r"^[̀-ͯ]$", "").is_match("\u{301}"));
        assert!(compile(r"^a.{1,500}?b$", "").is_match("axxb"));
    }

    #[test]
    #[should_panic(expected = "lookaround")]
    fn lookaround_is_refused() {
        compile(r"(?<![\w.-])x", "");
    }
}
