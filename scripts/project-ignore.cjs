// What Studio's own models may see of a project's files: the rules behind
// project_read, project_list and project_search (agent-tools.cjs,
// project-search.cjs). Which path a model may name, which names are private and
// never returned, which folders are noise a walk skips, what .gitignore says,
// and the glob a search can be narrowed with.
//
// Nothing here compiles a pattern from a model's or a repository's text into a
// regular expression: a .gitignore or a glob is matched name by name with a
// plain wildcard walk, so a hostile pattern costs a little time, never a hang.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const NOT_ALLOWED = "This project path is not allowed.";
const MAX_PATH = 500;
// A Windows device name is a device, not a file, in every folder and with any extension.
const DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;

/**
 * A path a model wrote, as clean segments, or the sentence that says why it is
 * refused. Empty means the project's own folder. Absolute, drive, network and
 * alternate-data-stream forms, "..", device names, wildcards and control
 * characters are refused on every platform, so a path is judged the same on
 * Linux as on Windows; both slashes are accepted and folded to "/".
 */
function cleanPath(value) {
  if (value === undefined || value === null || value === "") return { parts: [], relative: "" };
  if (typeof value !== "string") return { error: "The path must be text." };
  if (value.length > MAX_PATH) return { error: "This project path is too long." };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { error: NOT_ALLOWED };
  if (/^[\\/]/.test(value) || value.includes(":")) return { error: "Give a path inside the project, written from the project's folder (such as src/app.js): not an absolute, drive or network path." };
  const parts = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return { error: "This path leaves the project." };
    if (/[<>"|?*]/.test(part) || /[. ]$/.test(part) || DEVICE.test(part)) return { error: NOT_ALLOWED };
    parts.push(part);
  }
  if (parts.length > 40) return { error: "This project path is too deep." };
  return { parts, relative: parts.join("/") };
}

// ---- what is private ---------------------------------------------------------

const PRIVATE_DIR = /^(?:data|dist|node_modules)$/i;
// Keys, stores and state that are never a model's to read, whatever they are called.
const PRIVATE_EXT = /\.(?:pem|key|p12|pfx|jks|keystore|ppk|kdbx|db|sqlite|sqlite3|sqlitedb|mdb|ldb|tfstate|tfvars|ovpn|gpg|pgp|htpasswd|keytab)$/i;
const PRIVATE_FILE = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|auth\.json|kubeconfig|.*\.kubeconfig|wallet\.dat|service[-_]?account.*\.json|firebase[-_]adminsdk.*\.json|client[-_]secrets?.*\.json)$/i;
// A name that says what is inside is private when it is a data file: "secrets.yaml", "db-password.txt",
// "token.json", and a folder or file with no extension called secrets or credentials. Source files are
// code, not stores: token.ts or password.py stay readable (their lines are masked instead), and so does
// a plural "tokens.json", which is what a design system keeps.
const says = (words) => new RegExp(`(?:^|[._-])(?:${words})(?:[._-]|$)`, "i");
const SAYS_SECRET = says("secrets?|credentials?|passwords?|passwd|private[_-]?keys?");
const SAYS_TOKEN = says("token|(?:access|auth|api|refresh|bearer|session)[_-]?tokens?|api[_-]?keys?");
const DATA_EXT = /\.(?:json|ya?ml|toml|ini|txt|conf|cfg|properties|xml|env|csv|tsv|dat|bak)$/i;
const NO_EXT = /^[^.]*$/;

// One name (a file or a folder) that is private by what it is called.
const privateName = (name) => PRIVATE_EXT.test(name) || PRIVATE_FILE.test(name) || SAYS_SECRET.test(name) && (DATA_EXT.test(name) || NO_EXT.test(name)) || SAYS_TOKEN.test(name) && DATA_EXT.test(name);
/**
 * Whether a project-relative path is one models never see: hidden files and
 * folders (which holds .env, .git and Studio's own .mefi worktrees), Studio's
 * data and dist folders and node_modules at any depth, keys and databases by
 * extension, and files whose name says they hold credentials. The first three
 * are what project_read has always refused; the rest only adds obvious secrets.
 */
function denied(relative) {
  const text = String(relative);
  const parts = text.split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => part.startsWith(".") || PRIVATE_DIR.test(part))) return true;
  if (/(?:\.pem|\.key|\.db|credentials\.json|settings\.json)$/i.test(text)) return true;
  return parts.some(privateName);
}

// ---- what is noise ------------------------------------------------------------

// Never entered on a walk, wherever they are: dependencies, caches and coverage output.
const SKIP_ANYWHERE = /^(?:node_modules|__pycache__|bower_components|coverage)$/i;
// Build output and runtime folders, skipped at the top of the project (a source folder that happens to be called cache lower down stays).
const SKIP_TOP = /^(?:build|out|target|vendor|venv|env|tmp|temp|logs|cache)$/i;
/** Whether a walk does not enter this folder (a name and how many folders deep it is, the project's own folder being 0). */
const skipsFolder = (name, depth) => SKIP_ANYWHERE.test(name) || depth === 0 && SKIP_TOP.test(name);

const BINARY_EXT = new Set(("png jpg jpeg gif bmp ico webp tif tiff psd ai heic heif avif icns cur svgz exr hdr dds tga " +
  "mp3 wav ogg oga flac aac m4a wma mid midi mp4 m4v mov avi mkv webm wmv flv " +
  "woff woff2 ttf otf eot " +
  "zip gz tgz bz2 xz 7z rar tar zst lz jar war ear apk aab ipa dmg iso " +
  "exe dll so dylib bin o obj a lib class pyc pyo wasm node pdb " +
  "pdf doc docx xls xlsx ppt pptx odt ods odp " +
  "glb fbx blend uasset umap pak bank unitypackage max 3ds " +
  "sqlite sqlite3 db mdb").split(" "));
/** Whether a file name is a binary type by its extension (a listing marks it; a search never opens it). */
const binaryName = (name) => { const dot = String(name).lastIndexOf("."); return dot > 0 && BINARY_EXT.has(name.slice(dot + 1).toLowerCase()); };

// ---- wildcards ----------------------------------------------------------------

const GLOBSTAR = Symbol("**");
const lower = (ch) => ch.toLowerCase();

// One segment of a pattern as tokens: a letter, ?, *, or a [set] of letters and ranges.
function tokens(segment) {
  const out = [];
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (ch === "*") { if (out.at(-1)?.t !== "star") out.push({ t: "star" }); continue; }
    if (ch === "?") { out.push({ t: "any" }); continue; }
    if (ch === "\\" && i + 1 < segment.length) { out.push({ t: "lit", c: segment[i += 1] }); continue; }
    if (ch === "[") {
      let end = i + 1;
      if (segment[end] === "!" || segment[end] === "^") end += 1;
      if (segment[end] === "]") end += 1;
      while (end < segment.length && segment[end] !== "]") end += segment[end] === "\\" ? 2 : 1;
      if (end < segment.length) {
        let body = segment.slice(i + 1, end); const negate = body[0] === "!" || body[0] === "^";
        if (negate) body = body.slice(1);
        const ranges = [];
        for (let k = 0; k < body.length; k += 1) {
          let lo = body[k]; if (lo === "\\" && k + 1 < body.length) lo = body[k += 1];
          if (body[k + 1] === "-" && k + 2 < body.length) { let hi = body[k + 2]; k += 2; if (hi === "\\" && k + 1 < body.length) hi = body[k += 1]; ranges.push([lo, hi]); } else ranges.push([lo, lo]);
        }
        out.push({ t: "set", negate, ranges }); i = end; continue;
      }
    }
    out.push({ t: "lit", c: ch });
  }
  return out;
}
function one(token, ch, fold) {
  if (token.t === "any") return true;
  if (token.t === "lit") return fold ? lower(token.c) === lower(ch) : token.c === ch;
  const inside = token.ranges.some(([lo, hi]) => (ch >= lo && ch <= hi) || fold && ((lower(ch) >= lower(lo) && lower(ch) <= lower(hi)) || (ch.toUpperCase() >= lo && ch.toUpperCase() <= hi)));
  return inside !== token.negate;
}
// The classic wildcard walk: a star remembers where it was and takes one more
// letter when a later token fails. Time is name length times token count.
function matchName(list, name, fold) {
  let p = 0, n = 0, star = -1, from = 0;
  while (n < name.length) {
    const token = list[p];
    if (token?.t === "star") { star = p; p += 1; from = n; continue; }
    if (token && one(token, name[n], fold)) { p += 1; n += 1; continue; }
    if (star < 0) return false;
    p = star + 1; from += 1; n = from;
  }
  while (list[p]?.t === "star") p += 1;
  return p === list.length;
}
// Whole-segment "**" matches any number of folders; a trailing one needs at least one thing inside.
function matchPath(segments, names, fold) {
  const seen = new Map();
  const go = (i, j) => {
    const key = i * 128 + j;
    if (seen.has(key)) return seen.get(key);
    let found;
    if (i === segments.length) found = j === names.length;
    else if (segments[i] === GLOBSTAR) {
      if (i === segments.length - 1) found = j < names.length;
      else { found = false; for (let k = j; k <= names.length && !found; k += 1) found = go(i + 1, k); }
    } else found = j < names.length && matchName(segments[i], names[j], fold) && go(i + 1, j + 1);
    seen.set(key, found);
    return found;
  };
  return go(0, 0);
}
const compileSegments = (pattern) => pattern.split("/").filter(Boolean).map((part) => (part === "**" ? GLOBSTAR : tokens(part)));

// ---- .gitignore -----------------------------------------------------------------

/**
 * A .gitignore (or .git/info/exclude) as rules: blank lines and # comments
 * skipped, "!" to bring a name back, a trailing "/" for folders only, a slash
 * at the start or in the middle to anchor a pattern to the file's own folder,
 * * ? [set] and ** as git reads them. Long files are read to 2,000 rules.
 */
function parseIgnore(text) {
  const rules = [];
  for (const raw of String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/).slice(0, 4000)) {
    if (raw.length > 400) continue;
    let line = raw.replace(/(?<!\\)[ \t]+$/, "");
    if (!line || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) { negate = true; line = line.slice(1); } else if (line.startsWith("\\#") || line.startsWith("\\!")) line = line.slice(1);
    let dirOnly = false;
    if (line.endsWith("/")) { dirOnly = true; line = line.replace(/\/+$/, ""); }
    if (!line || line.length > 300) continue;
    const anchored = line.includes("/");
    const segments = compileSegments(line.replace(/^\/+/, ""));
    if (segments.length) rules.push({ negate, dirOnly, anchored, segments });
    if (rules.length >= 2000) break;
  }
  return rules;
}
// A rule with a slash in it is a path from its own folder; one without is a name matched at any depth.
function matchRule(rule, names, fold) {
  if (rule.anchored) return matchPath(rule.segments, names, fold);
  const only = rule.segments[0];
  return only === GLOBSTAR ? true : matchName(only, names.at(-1), fold);
}
/**
 * Whether the rules of the .gitignore files above an entry ignore it. `sets`
 * is [{ base, rules }] from the project's folder down (base is the folder the
 * file sits in, "" for the top); the last matching rule wins, and a deeper
 * file speaks after a shallower one. `rel` is the entry's project-relative path.
 */
function ignoredBy(sets, rel, isDir, fold = false) {
  const names = rel.split("/");
  let ignored = false;
  for (const { base, rules } of sets) {
    const depth = base ? base.split("/").length : 0, prefix = names.slice(0, depth).join("/");
    if (depth >= names.length || (fold ? prefix.toLowerCase() !== base.toLowerCase() : prefix !== base)) continue;
    const local = names.slice(depth);
    for (const rule of rules) if ((!rule.dirOnly || isDir) && matchRule(rule, local, fold)) ignored = !rule.negate;
  }
  return ignored;
}

// ---- the glob a search is narrowed with ---------------------------------------------

// {a,b} written out: every alternative, at most 32 of them.
function expandBraces(pattern, budget = { left: 32 }) {
  const open = pattern.indexOf("{");
  let depth = 0, close = -1; const cuts = [];
  for (let i = open; open >= 0 && i < pattern.length; i += 1) {
    if (pattern[i] === "{") depth += 1;
    else if (pattern[i] === "}") { depth -= 1; if (depth === 0) { close = i; break; } }
    else if (pattern[i] === "," && depth === 1) cuts.push(i);
  }
  if (close < 0) {
    if ((budget.left -= 1) < 0) throw new Error("The glob has too many {a,b} alternatives.");
    return [pattern];
  }
  const inside = []; let at = open + 1;
  for (const cut of [...cuts, close]) { inside.push(pattern.slice(at, cut)); at = cut + 1; }
  return inside.flatMap((choice) => expandBraces(pattern.slice(0, open) + choice + pattern.slice(close + 1), budget));
}
/**
 * A search's `glob`: one pattern or a few, matched against the project-relative
 * path. A pattern with no "/" is a file name at any depth ("*.ts"); one with a
 * "/" is a path from the project's folder ("src/**\/*.js"); "!" excludes;
 * {a,b} lists alternatives. Returns { test(path) } or { error }.
 */
function globFilter(value, { fold = false } = {}) {
  const list = value === undefined || value === null || value === "" ? [] : Array.isArray(value) ? value : [value];
  if (list.length > 8) return { error: "Give at most eight glob patterns." };
  const include = [], exclude = [];
  try {
    for (const raw of list) {
      if (typeof raw !== "string" || !raw.trim() || raw.length > 200 || /[\u0000-\u001f\u007f]/.test(raw)) return { error: "A glob is 1 to 200 characters of plain text." };
      let text = raw.trim().replace(/\\/g, "/"); const negate = text.startsWith("!");
      if (negate) text = text.slice(1);
      for (const each of expandBraces(text)) {
        const bare = each.replace(/^\/+/, ""), segments = compileSegments(bare);
        if (!segments.length) return { error: "A glob is 1 to 200 characters of plain text." };
        (negate ? exclude : include).push({ anchored: each.startsWith("/") || bare.includes("/"), segments });
      }
    }
  } catch (error) { return { error: error.message }; }
  const hits = (rules, names) => rules.some((rule) => matchRule(rule, names, fold));
  return { empty: !include.length && !exclude.length, test: (path) => { const names = String(path).split("/"); return (!include.length || hits(include, names)) && !hits(exclude, names); } };
}

module.exports = { NOT_ALLOWED, MAX_PATH, cleanPath, denied, skipsFolder, binaryName, parseIgnore, ignoredBy, globFilter, expandBraces };
