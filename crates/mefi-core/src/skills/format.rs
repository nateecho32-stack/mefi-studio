//! The shape of a skill (scripts/skill-format.cjs): one SKILL.md whose front
//! matter names it and says when to use it, with the instructions below. The
//! name is the folder under `.agents/skills`, lowercase letters, numbers and
//! dashes up to 64; the file is at most 32,000 bytes. Front matter other than
//! name and description is kept exactly as it was found. Pure.

use serde_json::{json, Value};

use crate::js;
use crate::js_regex;

pub const DIR: &str = ".agents/skills";
pub const NAME_PATTERN_SOURCE: &str = "^[a-z0-9][a-z0-9-]{0,63}$";
pub const MAX_BYTES: usize = 32000;
pub const READ_BYTES: u64 = 64 * 1024;
pub const MAX_DESCRIPTION: usize = 300;
pub const AUTO_LOAD_CHARS: u64 = 16000;
pub const DESCRIBE_CHARS: usize = 140;
pub const NAME_PROBLEM: &str = "Use lowercase letters, numbers and dashes, up to 64 characters.";
const RESERVED_PROBLEM: &str = "Windows keeps that name for itself. Choose another.";

/// What is wrong with a name, in a sentence; None when it is a good one.
pub fn name_problem(name: &Value) -> Option<&'static str> {
    let Some(text) = name.as_str().filter(|text| !text.is_empty()) else {
        return Some("Give the skill a name.");
    };
    if !js_regex!(r"^[a-z0-9][a-z0-9-]{0,63}$", "").is_match(text) {
        return Some(NAME_PROBLEM);
    }
    js_regex!(r"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$", "").is_match(text).then_some(RESERVED_PROBLEM)
}

pub fn file_of(name: &str) -> String {
    format!("{DIR}/{name}/SKILL.md")
}

/// `text.trimEnd()`.
fn trim_end(text: &str) -> &str {
    text.trim_end_matches(js::is_space)
}

/// `text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text`.
fn clip(text: &str, limit: usize) -> String {
    if js::utf16_len(text) > limit {
        format!("{}…", trim_end(&js::slice(text, 0, Some(limit as isize - 1))))
    } else {
        text.to_string()
    }
}

/// `.replace(/\s+/g, " ").trim()`.
fn squash(text: &str) -> String {
    js::trim(&js_regex!(r"\s+", "g").replace_all(text, " ")).to_string()
}

/// A front-matter value as one line: plain, 'single' or "double" quoted, or a > or | block.
fn scalar(lines: &[String]) -> String {
    let first_line = lines.first().map(String::as_str).unwrap_or("");
    let first = js::trim(&js_regex!(r"^[^:]*:", "").replace(first_line, "")).to_string();
    let rest = &lines[1.min(lines.len())..];
    if js_regex!(r"^[>|][+-]?$", "").is_match(&first) {
        let kept: Vec<&str> = rest.iter().map(|line| js::trim(line)).filter(|line| !line.is_empty()).collect();
        return squash(&kept.join(" "));
    }
    let mut parts: Vec<&str> = vec![first.as_str()];
    parts.extend(rest.iter().map(|line| js::trim(line)));
    let joined = js::trim(&parts.into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" ")).to_string();
    if js_regex!(r#"^".*"$"#, "s").is_match(&joined) {
        return match serde_json::from_str::<Value>(&joined) {
            Ok(Value::String(text)) => squash(&text),
            Ok(other) => squash(&js::string(&other)),
            Err(_) => squash(&js::slice(&joined, 1, Some(-1))),
        };
    }
    if js_regex!(r"^'.*'$", "s").is_match(&joined) {
        return squash(&js::slice(&joined, 1, Some(-1)).replace("''", "'"));
    }
    squash(&joined)
}

pub struct Parsed {
    pub front_matter: bool,
    pub name: String,
    pub description: String,
    pub body: String,
    pub extra: String,
}

/// Normalised source: no BOM, `\n` line ends.
fn normal(text: &str) -> String {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    js_regex!(r"\r\n?", "g").replace_all(text, "\n").into_owned()
}

/// Reads a SKILL.md. A file with no front matter (or an unclosed one) is all body.
pub fn parse(text: &str) -> Parsed {
    let source = normal(text);
    let empty = || Parsed { front_matter: false, name: String::new(), description: String::new(), body: source.clone(), extra: String::new() };
    if !js_regex!(r"^---[ \t]*\n", "").is_match(&source) {
        return empty();
    }
    let lines: Vec<&str> = source.split('\n').collect();
    let Some(close) = (1..lines.len()).find(|index| js_regex!(r"^---[ \t]*$", "").is_match(lines[*index])) else {
        return empty();
    };
    let mut entries: Vec<(String, Vec<String>)> = Vec::new();
    for line in &lines[1..close] {
        if let Some(key) = js_regex!(r"^([A-Za-z_][\w-]*)\s*:", "").captures(line) {
            entries.push((key[1].to_string(), vec![line.to_string()]));
        } else if let Some(last) = entries.last_mut() {
            last.1.push(line.to_string());
        }
    }
    let (mut name, mut description) = (String::new(), String::new());
    let mut extra: Vec<String> = Vec::new();
    for (key, entry) in &entries {
        match key.as_str() {
            "name" => name = scalar(entry),
            "description" => description = scalar(entry),
            _ => extra.extend(entry.iter().cloned()),
        }
    }
    let body = lines[close + 1..].join("\n");
    let body = body.strip_prefix('\n').unwrap_or(&body).to_string();
    let extra = js_regex!(r"\s+$", "").replace(&extra.join("\n"), "").into_owned();
    Parsed { front_matter: true, name, description, body, extra }
}

/// A description as a front-matter value: plain when nothing in it could be read as YAML, else double-quoted.
fn yaml_value(text: &str) -> String {
    let plain = js_regex!(r"^[A-Za-z0-9(][^\n]*$", "").is_match(text)
        && !js_regex!(r#"(^|\s)#|:\s|:$|["'\\`{}\[\],&*!|>%@]"#, "").is_match(text)
        && !js_regex!(r"^(true|false|null|yes|no|on|off|~|[-+]?[0-9][0-9._]*)$", "i").is_match(text)
        && text == js::trim(text);
    if plain {
        text.to_string()
    } else {
        serde_json::to_string(text).unwrap_or_default()
    }
}

/// The file for a skill. The body loses trailing space and ends with one newline.
pub fn build(name: &str, description: &str, body: &str, extra: &str) -> String {
    let head = format!("name: {name}\ndescription: {}", yaml_value(js::trim(description)));
    let more = js_regex!(r"\s+$", "").replace(extra, "").into_owned();
    let body = js_regex!(r"\r\n?", "g").replace_all(body, "\n");
    let body = js_regex!(r"^\n+", "").replace(&body, "");
    let body = js_regex!(r"\s+$", "").replace(&body, "");
    format!("---\n{head}{}\n---\n\n{body}\n", if more.is_empty() { String::new() } else { format!("\n{more}") })
}

pub struct Checked {
    pub ok: bool,
    pub problems: Vec<Value>,
    pub text: String,
    pub bytes: usize,
}

/// The validation a save, a create and an import all share.
pub fn check(name: &Value, description: &Value, body: &Value, extra: &str) -> Checked {
    let mut problems: Vec<Value> = Vec::new();
    if let Some(bad) = name_problem(name) {
        problems.push(json!({ "field": "name", "message": bad }));
    }
    let about = description.as_str().map(js::trim).unwrap_or("");
    if about.is_empty() {
        problems.push(json!({ "field": "description", "message": "Say when to use it, in one line an agent can match a task against." }));
    } else if js::utf16_len(about) > MAX_DESCRIPTION {
        problems.push(json!({ "field": "description", "message": format!("Keep the description to {MAX_DESCRIPTION} characters.") }));
    } else if about.contains(['\r', '\n']) {
        problems.push(json!({ "field": "description", "message": "Keep the description to one line." }));
    } else if about.chars().any(|c| matches!(c as u32, 0..=8 | 0x0b | 0x0c | 0x0e..=0x1f | 0x7f)) {
        problems.push(json!({ "field": "description", "message": "The description has a character that is not text." }));
    }
    let words = body.as_str().unwrap_or("");
    if js::trim(words).is_empty() {
        problems.push(json!({ "field": "body", "message": "Write the instructions." }));
    } else if words.contains('\u{0}') {
        problems.push(json!({ "field": "body", "message": "Instructions are text; this has a character that is not." }));
    }
    let oversize = js::utf16_len(words) > MAX_BYTES;
    let text = if !problems.is_empty() || oversize { String::new() } else { build(name.as_str().unwrap_or(""), about, words, extra) };
    let bytes = if !text.is_empty() { text.len() } else if oversize { js::utf16_len(words) } else { words.len() };
    if oversize || (!text.is_empty() && bytes > MAX_BYTES) {
        problems.push(json!({ "field": "body", "message": format!("This skill is {} KB; the most is {} KB.", js::to_fixed(bytes as f64 / 1024.0, 1), js::number_string(js::round(MAX_BYTES as f64 / 1000.0))) }));
    }
    let ok = problems.is_empty();
    Checked { ok, problems, text: if ok { text } else { String::new() }, bytes }
}

/// What the picker shows beside a skill: its description, else the first line that says something; one line.
pub fn describe(text: &str) -> String {
    let parsed = parse(text);
    if !parsed.description.is_empty() {
        return clip(&parsed.description, DESCRIBE_CHARS);
    }
    for line in parsed.body.split('\n') {
        let words = js::trim(&js_regex!(r"^\s*(?:#{1,6}|[-*>]|\d+[.)])\s*", "").replace(line, "")).to_string();
        if !words.is_empty() {
            return clip(&words, DESCRIBE_CHARS);
        }
    }
    String::new()
}

pub fn starters() -> Vec<Value> {
    vec![
        json!({ "name": "bug-triage", "description": "Reproduce a bug, find the cause and propose the smallest fix.",
            "body": "1. Read the report and the files it names. Say in one line what should happen and what happens instead.\n2. Reproduce it: run the project's own check or the smallest command that shows the problem. If it does not reproduce, say so and stop.\n3. Find the cause before changing anything. Name the file and line.\n4. Propose the smallest change that fixes it, and the test that would have caught it.\n5. Report what you ran and what you saw. Do not claim a fix you did not run." }),
        json!({ "name": "review-a-change", "description": "Review a diff for bugs, missing tests and surprises before it is approved.",
            "body": "1. Read the whole diff first, then the files around each change.\n2. List anything that can break: edge cases, errors that are swallowed, changes of behaviour nobody asked for.\n3. Check that every changed behaviour has a test, and that the test would fail without the change.\n4. Say what is good, what must change and what is only a suggestion. Keep each point to two lines.\n5. End with one word: approve, or changes needed." }),
        json!({ "name": "release-notes", "description": "Turn a changelog section into short release notes in plain words.",
            "body": "1. Read the changelog section and the commits it covers.\n2. Write one bullet for each change a person using the app would notice. Say what changed for them, not how it was built.\n3. Put the most important change first. Leave out anything internal.\n4. Keep the notes under 15 lines and do not promise what is not in the release." }),
        json!({ "name": "explain-this-code", "description": "Explain how a file or function works, and what depends on it.",
            "body": "1. Read the file or function, then find what calls it and what it calls.\n2. Explain in plain words what it does and why it exists, then walk through the main path step by step.\n3. Point out anything surprising: hidden state, ordering that matters, limits.\n4. Finish with where to look if it breaks." }),
    ]
}

/// The parse as the parity tests compare it (skill-format.cjs parse's object).
pub fn parse_value(text: &str) -> Value {
    let parsed = parse(text);
    json!({ "frontMatter": parsed.front_matter, "name": parsed.name, "description": parsed.description, "body": parsed.body, "extra": parsed.extra })
}

/// The check as the parity tests compare it (skill-format.cjs check's object).
pub fn check_value(draft: &Value) -> Value {
    let extra = draft.get("extra").map(js::string).unwrap_or_default();
    let checked = check(draft.get("name").unwrap_or(&Value::Null), draft.get("description").unwrap_or(&Value::Null), draft.get("body").unwrap_or(&Value::Null), &extra);
    json!({ "ok": checked.ok, "problems": checked.problems, "text": checked.text, "bytes": checked.bytes })
}
