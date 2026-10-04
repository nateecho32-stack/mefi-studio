// A small reader for .gitignore files: enough for a file picker to leave out what
// Git leaves out. It knows the rules a .gitignore is mostly made of:
//
//   blank lines and # comments, a trailing / (folders only), a leading ! (put it
//   back), a leading / or a / inside the pattern (anchored to the folder the
//   file sits in), * and ? and [abc] (none of them cross a /), and ** (any
//   number of folders: **/x, x/**, x/**/y).
//
// It is not Git: no .git/info/exclude, no global ignore file, and nothing is
// looked up on disk. A pattern it can not make sense of is skipped, never
// guessed at, so the worst a strange file does is leave a file in the list.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const escape = (char) => char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// One glob as regular-expression source. The glob is relative, with / as the separator.
function globSource(glob) {
  let out = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "\\" && index + 1 < glob.length) { out += escape(glob[index + 1]); index += 1; continue; }
    if (char === "*") {
      if (glob[index + 1] === "*") {
        const before = index === 0 || glob[index - 1] === "/";
        const after = index + 2 === glob.length || glob[index + 2] === "/";
        if (before && after) {
          if (glob[index + 2] === "/") { out += "(?:.*/)?"; index += 2; } else { out += ".*"; index += 1; }
          continue;
        }
        out += "[^/]*"; index += 1; continue;
      }
      out += "[^/]*"; continue;
    }
    if (char === "?") { out += "[^/]"; continue; }
    if (char === "[") {
      const close = glob.indexOf("]", index + 2);
      if (close > 0) {
        let set = glob.slice(index + 1, close);
        if (set.startsWith("!")) set = `^${set.slice(1)}`;
        out += `[${set.replace(/\\/g, "\\\\")}]`;
        index = close;
        continue;
      }
    }
    out += escape(char);
  }
  return out;
}

/** One line of a .gitignore as a rule, or null when it is blank, a comment or not understood. */
function rule(line) {
  let text = String(line ?? "").replace(/\r$/, "");
  if (!text.trim() || text.startsWith("#")) return null;
  // Trailing spaces do not count unless they are escaped.
  text = text.replace(/(?<!\\)\s+$/, "");
  if (!text) return null;
  let negate = false;
  if (text.startsWith("!")) { negate = true; text = text.slice(1); } else if (text.startsWith("\\!") || text.startsWith("\\#")) text = text.slice(1);
  let dirOnly = false;
  if (text.endsWith("/")) { dirOnly = true; text = text.slice(0, -1); }
  if (!text) return null;
  const anchored = text.includes("/");
  text = text.replace(/^\//, "");
  if (!text) return null;
  try { return { negate, dirOnly, anchored, regex: new RegExp(`^${globSource(text)}$`) }; } catch { return null; }
}

/** The rules of a .gitignore's text, in order. */
function parse(text) {
  return String(text ?? "").split("\n").map(rule).filter(Boolean);
}

/**
 * A decision for one path: matcher(rules)(relative, isDirectory) is true when the last rule that applies
 * ignores it, false when the last one puts it back, null when no rule applies. `relative` is the path from the
 * folder the .gitignore sits in, with / as the separator.
 */
function matcher(rules) {
  return (relative, isDirectory = false) => {
    const path = String(relative ?? "");
    const name = path.slice(path.lastIndexOf("/") + 1);
    let verdict = null;
    for (const item of rules) {
      if (item.dirOnly && !isDirectory) continue;
      if (item.regex.test(item.anchored ? path : name)) verdict = !item.negate;
    }
    return verdict;
  };
}

module.exports = { parse, rule, matcher };
