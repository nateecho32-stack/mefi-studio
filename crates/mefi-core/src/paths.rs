//! Path rules the engine shares between modules, ported from
//! scripts/path-scope.cjs (`containsPath`) and scripts/eyes.mjs (`withinRoot`,
//! `fileKey`, `samePath`, `joinRoot`), with Node's path.resolve/join/normalize
//! behaviour for the platform: case-insensitive and separator-agnostic on
//! Windows, and a sibling folder that only shares a prefix never counts.

use serde_json::Value;

use crate::js;

#[cfg(windows)]
pub const SEP: char = '\\';
#[cfg(not(windows))]
pub const SEP: char = '/';

fn is_sep(c: char) -> bool {
    c == '/' || (cfg!(windows) && c == '\\')
}

/// Node's normalizeString: `.` dropped, `..` resolved, separators collapsed.
fn normalize_segments(tail: &str, absolute: bool) -> String {
    let mut stack: Vec<&str> = Vec::new();
    for segment in tail.split(is_sep) {
        match segment {
            "" | "." => {}
            ".." => {
                if stack.last().is_some_and(|last| *last != "..") {
                    stack.pop();
                } else if !absolute {
                    stack.push("..");
                }
            }
            other => stack.push(other),
        }
    }
    stack.join(&SEP.to_string())
}

/// (device, absolute, tail): `C:` / `\\server\share` / ``, then the rest.
#[cfg(windows)]
fn split_root(text: &str) -> (String, bool, String) {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() >= 2 && is_sep(chars[0]) && is_sep(chars[1]) {
        let rest: String = chars[2..].iter().collect();
        let parts: Vec<&str> = rest.split(is_sep).filter(|part| !part.is_empty()).collect();
        if parts.len() >= 2 {
            let device = format!("\\\\{}\\{}", parts[0], parts[1]);
            return (device, true, parts[2..].join("\\"));
        }
        return (String::new(), true, rest);
    }
    if chars.len() >= 2 && chars[0].is_ascii_alphabetic() && chars[1] == ':' {
        let device: String = chars[..2].iter().collect();
        if chars.len() > 2 && is_sep(chars[2]) {
            return (device, true, chars[3..].iter().collect());
        }
        return (device, false, chars[2..].iter().collect());
    }
    if chars.first().is_some_and(|c| is_sep(*c)) {
        return (String::new(), true, chars[1..].iter().collect());
    }
    (String::new(), false, text.to_string())
}

#[cfg(not(windows))]
fn split_root(text: &str) -> (String, bool, String) {
    match text.strip_prefix('/') {
        Some(rest) => (String::new(), true, rest.to_string()),
        None => (String::new(), false, text.to_string()),
    }
}

/// path.normalize.
pub fn normalize(text: &str) -> String {
    if text.is_empty() {
        return ".".into();
    }
    let (device, absolute, tail) = split_root(text);
    let trailing = tail.chars().last().is_some_and(is_sep);
    let mut body = normalize_segments(&tail, absolute);
    if body.is_empty() && !absolute {
        body.push('.');
    }
    if trailing && !body.is_empty() && body != "." {
        body.push(SEP);
    }
    format!("{device}{}{body}", if absolute { SEP.to_string() } else { String::new() })
}

/// path.resolve with one argument: absolute against the working folder, no
/// trailing separator except at a root.
pub fn resolve(text: &str) -> String {
    let (mut device, absolute, mut tail) = split_root(text);
    if !absolute {
        let cwd = std::env::current_dir().map(|dir| dir.to_string_lossy().into_owned()).unwrap_or_else(|_| SEP.to_string());
        let (cwd_device, _, cwd_tail) = split_root(&cwd);
        if device.is_empty() || device.eq_ignore_ascii_case(&cwd_device) {
            device = cwd_device;
            tail = format!("{cwd_tail}{SEP}{tail}");
        }
    } else if device.is_empty() && cfg!(windows) {
        let cwd = std::env::current_dir().map(|dir| dir.to_string_lossy().into_owned()).unwrap_or_default();
        device = split_root(&cwd).0;
    }
    let body = normalize_segments(&tail, true);
    format!("{device}{SEP}{body}")
}

/// path.join(a, b).
pub fn join(a: &str, b: &str) -> String {
    match (a.is_empty(), b.is_empty()) {
        (true, true) => ".".into(),
        (true, false) => normalize(b),
        (false, true) => normalize(a),
        (false, false) => normalize(&format!("{a}{SEP}{b}")),
    }
}

/// path-scope.cjs pathKey.
pub fn path_key(value: &str) -> String {
    let resolved = resolve(value);
    if cfg!(windows) {
        resolved.to_lowercase()
    } else {
        resolved
    }
}

/// path-scope.cjs containsPath(root, value).
pub fn contains_path(root: &str, value: &Value) -> bool {
    if !js::truthy(value) {
        return false;
    }
    let root = path_key(root);
    let value = path_key(&js::string(value));
    if value == root {
        return true;
    }
    let prefix = if root.ends_with(SEP) { root } else { format!("{root}{SEP}") };
    value.starts_with(&prefix)
}

/// eyes.mjs withinRoot: a plain prefix test on separator-normalised text.
pub fn within_root(file: &str, root: Option<&str>) -> bool {
    let Some(root) = root.filter(|root| !root.is_empty()) else {
        return true;
    };
    let norm = |value: &str| {
        let mut out = String::new();
        let mut last_sep = false;
        for c in value.chars() {
            if c == '/' || c == '\\' {
                if !last_sep {
                    out.push(SEP);
                }
                last_sep = true;
            } else {
                out.push(c);
                last_sep = false;
            }
        }
        while out.ends_with(SEP) {
            out.pop();
        }
        let mut out = if cfg!(windows) { out.to_lowercase() } else { out };
        out.push(SEP);
        out
    };
    norm(file).starts_with(&norm(root))
}

/// eyes.mjs fileKey.
pub fn file_key(file: &Value) -> String {
    let text = if file.is_null() { String::new() } else { js::string(file) };
    let mut out = String::new();
    let mut last_sep = false;
    for c in text.chars() {
        if c == '/' || c == '\\' {
            if !last_sep {
                out.push('/');
            }
            last_sep = true;
        } else {
            out.push(c);
            last_sep = false;
        }
    }
    while out.ends_with('/') {
        out.pop();
    }
    out.to_lowercase()
}

/// eyes.mjs samePath.
pub fn same_path(a: &Value, b: &Value) -> bool {
    let left = file_key(a);
    let right = file_key(b);
    if left.is_empty() || right.is_empty() {
        return false;
    }
    left == right || left.ends_with(&format!("/{right}")) || right.ends_with(&format!("/{left}"))
}

/// eyes.mjs joinRoot.
pub fn join_root(root: Option<&str>, relative: &Value) -> String {
    let text = if relative.is_null() { String::new() } else { js::string(relative) };
    let mut name = String::new();
    let mut last_sep = false;
    for c in text.chars() {
        if c == '/' || c == '\\' {
            if !last_sep {
                name.push('/');
            }
            last_sep = true;
        } else {
            name.push(c);
            last_sep = false;
        }
    }
    match root.filter(|root| !root.is_empty()) {
        None => name,
        Some(root) => join(root, &name).replace('\\', "/"),
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn contains_path_matches_path_scope() {
        assert!(contains_path("C:/fixture", &json!("c:\\Fixture\\a.js")));
        assert!(contains_path("C:/fixture", &json!("C:/fixture")));
        assert!(!contains_path("C:/app", &json!("C:/app-neighbor/x")));
        assert!(!contains_path("C:/app", &json!("D:/app/x")));
        assert!(!contains_path("C:/app", &Value::Null));
        assert!(contains_path("C:/", &json!("C:/anything")));
        assert!(contains_path("C:/a/b/../c", &json!("C:/a/c/d")));
    }

    #[test]
    fn join_and_normalize_follow_node() {
        assert_eq!(join_root(Some("C:/repo"), &json!("mefi-studio/main.cjs")), "C:/repo/mefi-studio/main.cjs");
        assert_eq!(join_root(Some("C:/repo"), &json!("dir/")), "C:/repo/dir/");
        assert_eq!(join_root(None, &json!("a\\\\b")), "a/b");
        assert_eq!(normalize("C:/a/./b/../c"), "C:\\a\\c");
        assert_eq!(resolve("C:/x/"), "C:\\x");
        assert_eq!(resolve("C:/"), "C:\\");
    }

    #[test]
    fn within_root_is_a_prefix_test() {
        assert!(within_root("C:/Fixture/game.js", Some("c:\\fixture\\")));
        assert!(!within_root("C:/fixture2/game.js", Some("C:/fixture")));
        assert!(within_root("anything", None));
    }

    #[test]
    fn same_path_allows_a_relative_suffix() {
        assert!(same_path(&json!("C:/repo/a/b.js"), &json!("a/b.js")));
        assert!(!same_path(&json!("C:/repo/a/b.js"), &json!("")));
        assert!(same_path(&json!("C:\\Repo\\A.js"), &json!("c:/repo/a.js")));
    }
}
