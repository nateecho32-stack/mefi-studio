//! scripts/gitignore-lite.cjs: enough of .gitignore for a file picker to leave
//! out what Git leaves out. Blank lines and comments, a trailing / (folders
//! only), a leading ! (put back), anchoring by a / in the pattern, * ? [abc]
//! (none cross a /), and **. A pattern that does not compile is skipped.

use regex::Regex;

#[derive(Clone, Debug)]
pub struct Rule {
    negate: bool,
    dir_only: bool,
    anchored: bool,
    regex: Regex,
}

/// One glob as regular-expression source, relative, with / as the separator.
fn glob_source(glob: &[char]) -> String {
    let mut out = String::new();
    let mut index = 0;
    let literal = |c: char| regex::escape(&c.to_string());
    while index < glob.len() {
        let c = glob[index];
        if c == '\\' && index + 1 < glob.len() {
            out.push_str(&literal(glob[index + 1]));
            index += 2;
            continue;
        }
        if c == '*' {
            if glob.get(index + 1) == Some(&'*') {
                let before = index == 0 || glob[index - 1] == '/';
                let after = index + 2 == glob.len() || glob.get(index + 2) == Some(&'/');
                if before && after {
                    if glob.get(index + 2) == Some(&'/') {
                        out.push_str("(?:.*/)?");
                        index += 3;
                    } else {
                        out.push_str(".*");
                        index += 2;
                    }
                    continue;
                }
                out.push_str("[^/]*");
                index += 2;
                continue;
            }
            out.push_str("[^/]*");
            index += 1;
            continue;
        }
        if c == '?' {
            out.push_str("[^/]");
            index += 1;
            continue;
        }
        if c == '[' {
            // glob.indexOf("]", index + 2)
            if let Some(close) = (index + 2..glob.len()).find(|at| glob[*at] == ']') {
                let mut set: String = glob[index + 1..close].iter().collect();
                if let Some(rest) = set.strip_prefix('!') {
                    set = format!("^{rest}");
                }
                out.push('[');
                out.push_str(&set.replace('\\', "\\\\"));
                out.push(']');
                index = close + 1;
                continue;
            }
        }
        out.push_str(&literal(c));
        index += 1;
    }
    out
}

/// `text.replace(/(?<!\\)\s+$/, "")`: trailing white space unless escaped.
fn trim_unescaped_end(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut start = chars.len();
    while start > 0 && chars[start - 1].is_whitespace() {
        start -= 1;
    }
    // The leftmost white space in the run whose left neighbour is not a backslash.
    for at in start..chars.len() {
        if at == 0 || chars[at - 1] != '\\' {
            return chars[..at].iter().collect();
        }
    }
    text.to_string()
}

/// One line as a rule, or None for blank lines, comments and patterns not understood.
pub fn rule(line: &str) -> Option<Rule> {
    let text = line.strip_suffix('\r').unwrap_or(line);
    if text.trim().is_empty() || text.starts_with('#') {
        return None;
    }
    let mut text = trim_unescaped_end(text);
    if text.is_empty() {
        return None;
    }
    let mut negate = false;
    if let Some(rest) = text.strip_prefix('!') {
        negate = true;
        text = rest.to_string();
    } else if text.starts_with("\\!") || text.starts_with("\\#") {
        text = text[1..].to_string();
    }
    let mut dir_only = false;
    if let Some(rest) = text.strip_suffix('/') {
        dir_only = true;
        text = rest.to_string();
    }
    if text.is_empty() {
        return None;
    }
    let anchored = text.contains('/');
    let text = text.strip_prefix('/').unwrap_or(&text).to_string();
    if text.is_empty() {
        return None;
    }
    let chars: Vec<char> = text.chars().collect();
    let regex = Regex::new(&format!("^{}$", glob_source(&chars))).ok()?;
    Some(Rule { negate, dir_only, anchored, regex })
}

pub fn parse(text: &str) -> Vec<Rule> {
    text.split('\n').filter_map(rule).collect()
}

/// The last rule that applies: Some(true) ignored, Some(false) put back, None no rule.
pub fn verdict(rules: &[Rule], relative: &str, is_directory: bool) -> Option<bool> {
    let name = relative.rsplit('/').next().unwrap_or(relative);
    let mut answer = None;
    for item in rules {
        if item.dir_only && !is_directory {
            continue;
        }
        if item.regex.is_match(if item.anchored { relative } else { name }) {
            answer = Some(!item.negate);
        }
    }
    answer
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_follow_gitignore() {
        let rules = parse("# comment\n*.log\n!keep.log\nbuild/\n/root-only.txt\ndocs/**/draft.md\n\\#hash\nspace\\ \n");
        assert_eq!(verdict(&rules, "a/b/x.log", false), Some(true));
        assert_eq!(verdict(&rules, "keep.log", false), Some(false));
        assert_eq!(verdict(&rules, "build", true), Some(true));
        assert_eq!(verdict(&rules, "build", false), None);
        assert_eq!(verdict(&rules, "root-only.txt", false), Some(true));
        assert_eq!(verdict(&rules, "x/root-only.txt", false), None);
        assert_eq!(verdict(&rules, "docs/a/b/draft.md", false), Some(true));
        assert_eq!(verdict(&rules, "docs/draft.md", false), Some(true));
        assert_eq!(verdict(&rules, "#hash", false), Some(true));
        assert_eq!(verdict(&rules, "space ", false), Some(true));
    }

    #[test]
    fn trailing_space_needs_escaping() {
        assert_eq!(trim_unescaped_end("foo  "), "foo");
        assert_eq!(trim_unescaped_end("foo\\  "), "foo\\ ");
    }
}
