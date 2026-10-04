//! Skills on disk (scripts/skills.cjs createSkills): the host half of the
//! Skills page. List, read, save, create, delete, import and export the skills
//! of the open project, and nothing else. The only place this writes inside a
//! project is `<project>/.agents/skills/<name>/SKILL.md`; every path is built
//! here from the project root and a checked name, and nothing is followed
//! through a link. A save that replaces text and a delete keep the old text in
//! the safety folder the engine names first, ten per skill. Nothing answers
//! with an error: a refusal is `{ ok: false, error, ... }`.
//!
//! The engine's collaborators come in as the first argument of every call:
//! `root()` (the project folder or null), `enabled()`, `backups()` (the
//! safety folder or null), `inventory(realRoot)` (rows `{ file, name, scope }`)
//! and `zip(source, target, { rootName })`, which the engine's factory wraps
//! with the SKILL.md-only filter.

pub mod format;

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde_json::{json, Map, Value};

use crate::callbacks::{invoke, is_function, Callbacks};
use crate::js;

const MAX_LISTED: usize = 200;
const KEEP_BACKUPS: usize = 10;
pub const OFF: &str = "Editing skills is switched off on this PC.";
const INVENTORY_DIRS: &[&str] = &[".agents/skills", ".claude/skills", ".codex/skills", ".opencode/skills", ".config/opencode/skills"];

/// A refusal in its own words (with extra fields), or a failure of the
/// filesystem, which the caller turns into a plain sentence.
enum Fail {
    Refusal(String, Map<String, Value>),
    Io(String),
}
type Step<T> = std::result::Result<T, Fail>;

fn refuse(message: impl Into<String>) -> Fail {
    Fail::Refusal(message.into(), Map::new())
}
fn refuse_with(message: impl Into<String>, extra: Value) -> Fail {
    Fail::Refusal(message.into(), extra.as_object().cloned().unwrap_or_default())
}
fn exists(name: &str) -> Fail {
    refuse_with(format!("A skill named {name} already exists. Studio never overwrites one."), json!({ "exists": true }))
}

/// Node's error code for an I/O error, as `error.code` would say it.
fn code_of(error: &std::io::Error) -> String {
    use std::io::ErrorKind::*;
    match error.kind() {
        NotFound => "ENOENT".into(),
        AlreadyExists => "EEXIST".into(),
        PermissionDenied => "EPERM".into(),
        DirectoryNotEmpty => "ENOTEMPTY".into(),
        NotADirectory => "ENOTDIR".into(),
        IsADirectory => "EISDIR".into(),
        _ => match error.raw_os_error() {
            Some(32) | Some(33) => "EBUSY".into(),
            _ => "EIO".into(),
        },
    }
}
fn io(error: std::io::Error) -> Fail {
    Fail::Io(code_of(&error))
}

/// `{ ok: false, error, ...extra }` for a refusal, a plain sentence for anything else.
fn answer(result: Step<Value>) -> Value {
    match result {
        Ok(value) => value,
        Err(Fail::Refusal(message, extra)) => {
            let mut out = Map::new();
            out.insert("ok".into(), json!(false));
            out.insert("error".into(), json!(message));
            out.extend(extra);
            Value::Object(out)
        }
        Err(Fail::Io(code)) => json!({ "ok": false, "error": format!("That could not be done ({}).", js::slice(&code, 0, Some(80))) }),
    }
}

/// `fs.lstat`, with a missing path as None.
fn lstat(target: &Path) -> Step<Option<std::fs::Metadata>> {
    match std::fs::symlink_metadata(target) {
        Ok(meta) => Ok(Some(meta)),
        Err(error) if matches!(error.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) || error.raw_os_error() == Some(3) => Ok(None),
        Err(error) => Err(io(error)),
    }
}

fn is_link(meta: &std::fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}
fn is_dir(meta: &std::fs::Metadata) -> bool {
    !is_link(meta) && meta.is_dir()
}
fn is_file(meta: &std::fs::Metadata) -> bool {
    !is_link(meta) && meta.is_file()
}

/// `fs.realpath`: links resolved, without the `\\?\` prefix Node leaves out.
fn realpath(path: &Path) -> std::io::Result<PathBuf> {
    let canonical = std::fs::canonicalize(path)?;
    let text = canonical.to_string_lossy();
    Ok(match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        Some(rest) => PathBuf::from(format!(r"\\{}", &rest[4..])),
        None => canonical,
    })
}

/// Node's `path.win32.isAbsolute`.
fn is_absolute(text: &str) -> bool {
    let units: Vec<char> = text.chars().take(3).collect();
    let separator = |c: char| c == '/' || c == '\\';
    match units.as_slice() {
        [first, ..] if separator(*first) => true,
        [letter, ':', third] => letter.is_ascii_alphabetic() && separator(*third),
        _ => false,
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// mtimeMs, as Node reports it.
fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_nanos() as f64 / 1e6)
        .unwrap_or(0.0)
}

fn random_id() -> String {
    let nanos = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mixed = (nanos ^ ((std::process::id() as u128) << 32)).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    format!("{:012x}", (mixed >> 16) as u64 & 0xffff_ffff_ffff)
}

struct Found {
    file: PathBuf,
    size: u64,
    mtime: f64,
    too_big: bool,
    text: String,
}

/// A JavaScript `string.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")` of a file's UTF-8 text.
fn read_text(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    crate::js_regex!(r"\r\n?", "g").replace_all(text, "\n").into_owned()
}

struct Skills<'a> {
    collaborators: &'a Value,
    callbacks: &'a dyn Callbacks,
}

impl Skills<'_> {
    fn call(&self, name: &str, args: Vec<Value>) -> Option<Value> {
        let handle = self.collaborators.get(name)?;
        if !is_function(handle) {
            return None;
        }
        invoke(self.callbacks, handle, args).ok()
    }

    fn enabled(&self) -> bool {
        match self.collaborators.get("enabled") {
            Some(handle) if is_function(handle) => self.call("enabled", vec![]).is_some_and(|value| js::truthy(&value)),
            _ => true,
        }
    }

    /// The project's real root and where its skills live.
    fn project(&self) -> Step<(PathBuf, PathBuf)> {
        let given = self.call("root", vec![]).filter(js::truthy).ok_or_else(|| refuse("Open a project first."))?;
        let real = realpath(Path::new(&js::string(&given))).map_err(|_| refuse("The project folder can't be reached."))?;
        let base = real.join(".agents").join("skills");
        Ok((real, base))
    }

    /// .agents and .agents/skills, as real folders. A link, or a file where a folder should be, is refused.
    fn skills_folder(&self, real: &Path, create: bool) -> Step<Option<PathBuf>> {
        let mut current = real.to_path_buf();
        for (part, label) in [(".agents", ".agents"), ("skills", format::DIR)] {
            current = current.join(part);
            let mut info = lstat(&current)?;
            if info.is_none() {
                if !create {
                    return Ok(None);
                }
                if let Err(error) = std::fs::create_dir(&current) {
                    if error.kind() != std::io::ErrorKind::AlreadyExists {
                        return Err(io(error));
                    }
                }
                info = lstat(&current)?;
            }
            match info {
                Some(meta) if is_link(&meta) => return Err(refuse(format!("{label} is a link, and Studio does not write through links."))),
                Some(meta) if meta.is_dir() => {}
                _ => return Err(refuse(format!("{label} is not a folder."))),
            }
        }
        Ok(Some(current))
    }

    /// One skill's SKILL.md as text, when it is a real file of a size that can be read.
    fn read_skill(&self, folder: &Path) -> Step<Option<Found>> {
        let file = folder.join("SKILL.md");
        let Some(info) = lstat(&file)? else { return Ok(None) };
        if !is_file(&info) {
            return Ok(None);
        }
        let (size, mtime) = (info.len(), mtime_ms(&info));
        if size > format::READ_BYTES {
            return Ok(Some(Found { file, size, mtime, too_big: true, text: String::new() }));
        }
        let bytes = std::fs::read(&file).map_err(io)?;
        Ok(Some(Found { file, size, mtime, too_big: false, text: read_text(&bytes) }))
    }

    /// One skill that exists, through real folders only.
    fn locate(&self, real: &Path, base: &Path, name: &str) -> Step<Option<Found>> {
        if self.skills_folder(real, false)?.is_none() {
            return Ok(None);
        }
        match lstat(&base.join(name))? {
            Some(meta) if is_dir(&meta) => self.read_skill(&base.join(name)),
            _ => Ok(None),
        }
    }

    fn row_of(&self, name: &str, found: &Found) -> Value {
        let parsed = (!found.too_big).then(|| format::parse(&found.text));
        let bytes = found.size;
        let mut problem: Option<String> = format::name_problem(&json!(name)).map(String::from);
        let kb = |digits: usize| js::to_fixed(bytes as f64 / 1024.0, digits);
        let most = js::number_string(js::round(format::MAX_BYTES as f64 / 1000.0));
        if problem.is_none() && found.too_big {
            problem = Some(format!("This file is {} KB; it is too big to open here (the most is {most} KB).", kb(0)));
        } else if problem.is_none() && bytes as usize > format::MAX_BYTES {
            problem = Some(format!("This file is {} KB. Agents skip anything over {most} KB; shorten it to use it.", kb(1)));
        } else if let (None, Some(parsed)) = (&problem, &parsed) {
            if !parsed.front_matter {
                problem = Some("It has no front matter. Saving adds a name and a description.".into());
            } else if !parsed.name.is_empty() && parsed.name != name {
                problem = Some(format!("Its front matter names it {}, but its folder is {name}. Saving makes them agree.", parsed.name));
            } else if parsed.description.is_empty() {
                problem = Some("It has no description, so nothing tells an agent when to use it.".into());
            }
        }
        let description = match &parsed {
            Some(parsed) if !parsed.description.is_empty() => parsed.description.clone(),
            Some(_) => format::describe(&found.text),
            None => String::new(),
        };
        let mut row = json!({
            "name": name, "bytes": bytes, "updatedAt": js::num(js::round(found.mtime)), "path": format::file_of(name),
            "description": description,
            "editable": format::name_problem(&json!(name)).is_none() && !found.too_big,
            "loadsByItself": bytes <= format::AUTO_LOAD_CHARS,
        });
        if let Some(problem) = problem {
            row["problem"] = json!(problem);
        }
        row
    }

    fn entry(&self, base: &Path, name: &str) -> Step<Value> {
        let folder = base.join(name);
        match lstat(&folder)? {
            Some(meta) if is_dir(&meta) => Ok(self.read_skill(&folder)?.map(|found| self.row_of(name, &found)).unwrap_or(Value::Null)),
            _ => Ok(Value::Null),
        }
    }

    /// Replaced text and deleted skills are kept aside first, ten per skill, outside the project.
    fn keep_copy(&self, name: &str, text: &str) -> Step<()> {
        let Some(place) = self.call("backups", vec![]).filter(js::truthy) else { return Ok(()) };
        let kept = (|| -> std::io::Result<()> {
            let folder = Path::new(&js::string(&place)).join(name);
            std::fs::create_dir_all(&folder)?;
            let stamp = js::iso_string(js::now_ms()).unwrap_or_default().replace([':', '.'], "-");
            let file = folder.join(format!("{stamp}-{}.md", &random_id()[..4]));
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            std::io::Write::write_all(&mut options.open(file)?, text.as_bytes())?;
            let mut names: Vec<String> = std::fs::read_dir(&folder)?
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .filter(|file| file.ends_with(".md"))
                .collect();
            names.sort_by(|a, b| js::utf16_cmp(a, b));
            let extra = names.len().saturating_sub(KEEP_BACKUPS);
            for old in &names[..extra] {
                let _ = std::fs::remove_file(folder.join(old));
            }
            Ok(())
        })();
        kept.map_err(|_| refuse("Studio could not keep a copy of the current file first, so nothing was changed."))
    }

    /// Temporary file, then rename; Windows may hold the target for a moment.
    fn replace_file(&self, file: &Path, bytes: &[u8]) -> Step<()> {
        let temporary = PathBuf::from(format!("{}.tmp-{}", path_text(file), random_id()));
        let result = (|| -> Step<()> {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            std::io::Write::write_all(&mut options.open(&temporary).map_err(io)?, bytes).map_err(io)?;
            for attempt in 0.. {
                match std::fs::rename(&temporary, file) {
                    Ok(()) => return Ok(()),
                    Err(error) => {
                        let code = code_of(&error);
                        if !["EPERM", "EBUSY", "EACCES"].contains(&code.as_str()) || attempt >= 4 {
                            return Err(Fail::Io(code));
                        }
                        std::thread::sleep(std::time::Duration::from_millis(20 * (attempt + 1)));
                    }
                }
            }
            Ok(())
        })();
        let _ = std::fs::remove_file(&temporary);
        result
    }

    fn gate(&self) -> Step<()> {
        if self.enabled() { Ok(()) } else { Err(refuse_with(OFF, json!({ "off": true }))) }
    }

    fn named(&self, value: &Value) -> Step<String> {
        let name = value.as_str().map(String::from).unwrap_or_default();
        match format::name_problem(&json!(name)) {
            Some(problem) => Err(refuse_with(problem, json!({ "field": "name" }))),
            None => Ok(name),
        }
    }

    fn refusal(checked: &format::Checked) -> Fail {
        let first = &checked.problems[0];
        refuse_with(js::string(&first["message"]), json!({ "problems": checked.problems, "field": first["field"] }))
    }

    /// The skills the inventory finds somewhere else: named, not edited here.
    fn others(&self, real: &Path, base: &Path) -> Vec<Value> {
        let Some(rows) = self.call("inventory", vec![json!(path_text(real))]) else { return vec![] };
        let base_text = path_text(base);
        rows.as_array()
            .into_iter()
            .flatten()
            .filter(|row| {
                let file = js::string(&row["file"]);
                let folder = Path::new(&file).parent().and_then(Path::parent).map(path_text).unwrap_or_default();
                folder != base_text
            })
            .take(MAX_LISTED)
            .map(|row| {
                let file = js::string(&row["file"]);
                let folder = Path::new(&file).parent().and_then(Path::parent).map(path_text).unwrap_or_default().replace('\\', "/");
                let source = INVENTORY_DIRS.iter().find(|dir| folder.ends_with(&format!("/{dir}"))).copied().unwrap_or("");
                json!({ "name": row.get("name").cloned().unwrap_or(Value::Null), "scope": row.get("scope").cloned().unwrap_or(Value::Null), "source": source })
            })
            .collect()
    }

    fn list(&self) -> Step<Value> {
        let (real, base) = self.project()?;
        let limits = json!({
            "maxBytes": format::MAX_BYTES, "autoLoadChars": format::AUTO_LOAD_CHARS, "maxDescription": format::MAX_DESCRIPTION,
            "namePattern": format::NAME_PATTERN_SOURCE, "nameProblem": format::NAME_PROBLEM,
        });
        let (folder, blocked) = match self.skills_folder(&real, false) {
            Ok(folder) => (folder, String::new()),
            Err(Fail::Refusal(message, _)) => (None, message),
            Err(other) => return Err(other),
        };
        let mut skills: Vec<Value> = Vec::new();
        if let Some(folder) = folder {
            let mut names: Vec<String> = std::fs::read_dir(&folder)
                .map(|entries| {
                    entries
                        .flatten()
                        .filter(|entry| entry.file_type().map(|kind| kind.is_dir() && !kind.is_symlink()).unwrap_or(false))
                        .map(|entry| entry.file_name().to_string_lossy().into_owned())
                        .filter(|name| !name.starts_with('.'))
                        .collect()
                })
                .unwrap_or_default();
            names.sort_by(|a, b| {
                let (x, y) = (a.to_lowercase(), b.to_lowercase());
                js::utf16_cmp(&x, &y).then_with(|| js::utf16_cmp(a, b))
            });
            for name in names.iter().take(MAX_LISTED) {
                if let Ok(row) = self.entry(&folder, name) {
                    if !row.is_null() {
                        skills.push(row);
                    }
                }
            }
        }
        let have: Vec<String> = skills.iter().map(|skill| js::string(&skill["name"])).collect();
        let starters: Vec<Value> = format::starters().into_iter().filter(|starter| !have.contains(&js::string(&starter["name"]))).collect();
        let mut out = json!({ "ok": true, "dir": format::DIR, "skills": skills, "others": self.others(&real, &base), "limits": limits, "writable": self.enabled() });
        if !blocked.is_empty() {
            out["blocked"] = json!(blocked);
        }
        out["starters"] = json!(starters);
        Ok(out)
    }

    fn read(&self, value: &Value) -> Step<Value> {
        let name = self.named(value)?;
        let (real, base) = self.project()?;
        let found = self.locate(&real, &base, &name)?.ok_or_else(|| refuse_with(format!("There is no skill named {name}."), json!({ "missing": true })))?;
        if found.too_big {
            return Err(refuse_with("That file is too big to open here.", json!({ "tooBig": true })));
        }
        let parsed = format::parse(&found.text);
        Ok(json!({
            "ok": true, "name": name, "description": parsed.description, "body": parsed.body, "hasExtra": !parsed.extra.is_empty(),
            "frontMatter": parsed.front_matter, "bytes": found.size, "path": format::file_of(&name), "skill": self.row_of(&name, &found),
        }))
    }

    fn save(&self, draft: &Value) -> Step<Value> {
        self.gate()?;
        let name = self.named(draft.get("name").unwrap_or(&Value::Null))?;
        let (real, base) = self.project()?;
        let found = self.locate(&real, &base, &name)?.ok_or_else(|| refuse_with(format!("There is no skill named {name} to save. Create it first."), json!({ "missing": true })))?;
        if found.too_big {
            return Err(refuse_with("That file is too big to open here, so it is not replaced.", json!({ "tooBig": true })));
        }
        let before = format::parse(&found.text);
        let checked = format::check(&json!(name), draft.get("description").unwrap_or(&Value::Null), draft.get("body").unwrap_or(&Value::Null), &before.extra);
        if !checked.ok {
            return Err(Self::refusal(&checked));
        }
        if checked.text == found.text {
            return Ok(json!({ "ok": true, "unchanged": true, "skill": self.row_of(&name, &found) }));
        }
        self.keep_copy(&name, &found.text)?;
        self.replace_file(&found.file, checked.text.as_bytes())?;
        Ok(json!({ "ok": true, "skill": self.entry(&base, &name)? }))
    }

    /// A new folder for a new skill: never one that is there already.
    fn new_folder(&self, real: &Path, base: &Path, name: &str) -> Step<PathBuf> {
        self.skills_folder(real, true)?;
        let folder = base.join(name);
        if lstat(&folder)?.is_some() {
            return Err(exists(name));
        }
        std::fs::create_dir(&folder).map_err(|error| if error.kind() == std::io::ErrorKind::AlreadyExists { exists(name) } else { io(error) })?;
        Ok(folder)
    }

    fn write_new(&self, folder: &Path, bytes: &[u8]) -> Step<()> {
        self.replace_file(&folder.join("SKILL.md"), bytes).inspect_err(|_| {
            let _ = std::fs::remove_dir(folder);
        })
    }

    fn create(&self, draft: &Value) -> Step<Value> {
        self.gate()?;
        let name = self.named(draft.get("name").unwrap_or(&Value::Null))?;
        let checked = format::check(&json!(name), draft.get("description").unwrap_or(&Value::Null), draft.get("body").unwrap_or(&Value::Null), "");
        if !checked.ok {
            return Err(Self::refusal(&checked));
        }
        let (real, base) = self.project()?;
        let folder = self.new_folder(&real, &base, &name)?;
        self.write_new(&folder, checked.text.as_bytes())?;
        Ok(json!({ "ok": true, "skill": self.entry(&base, &name)? }))
    }

    fn remove(&self, value: &Value) -> Step<Value> {
        self.gate()?;
        let name = self.named(value)?;
        let (real, base) = self.project()?;
        let found = self.locate(&real, &base, &name)?.ok_or_else(|| refuse_with(format!("There is no skill named {name}."), json!({ "missing": true })))?;
        if found.too_big {
            return Err(refuse_with("That file is too big to open here, so it is not deleted.", json!({ "tooBig": true })));
        }
        self.keep_copy(&name, &found.text)?;
        std::fs::remove_file(&found.file).map_err(io)?;
        // Only the file goes. A folder that holds anything else stays, and is said to.
        let left = std::fs::read_dir(base.join(&name)).map(|entries| entries.count()).unwrap_or(0);
        if left == 0 {
            let _ = std::fs::remove_dir(base.join(&name));
        }
        Ok(json!({ "ok": true, "name": name, "keptFiles": left }))
    }

    fn import_from(&self, chosen: &Value) -> Step<Value> {
        self.gate()?;
        let chosen = chosen.as_str().filter(|text| is_absolute(text)).ok_or_else(|| refuse("Choose a folder to import."))?;
        let source = realpath(Path::new(chosen)).map_err(|_| refuse("That folder can't be opened."))?;
        if !lstat(&source)?.is_some_and(|meta| meta.is_dir()) {
            return Err(refuse("Choose a folder, not a file."));
        }
        let found = self.read_skill(&source)?.ok_or_else(|| refuse("That folder has no SKILL.md."))?;
        let most = js::number_string(js::round(format::MAX_BYTES as f64 / 1000.0));
        if found.too_big {
            return Err(refuse(format!("SKILL.md is too big; the most is {most} KB.")));
        }
        if found.text.contains('\u{0}') {
            return Err(refuse("SKILL.md is not a text file."));
        }
        let parsed = format::parse(&found.text);
        if !parsed.front_matter {
            return Err(refuse("SKILL.md has no front matter. It needs a name and a description between two --- lines."));
        }
        let name = parsed.name.clone();
        let checked = format::check(&json!(name), &json!(parsed.description), &json!(parsed.body), &parsed.extra);
        if !checked.ok {
            let first = &checked.problems[0];
            return Err(refuse_with(format!("SKILL.md: {}", js::string(&first["message"])), json!({ "problems": checked.problems, "field": first["field"] })));
        }
        // The file goes in as it was written, once it is known to meet the rules.
        let bytes = found.text.as_bytes();
        if bytes.len() > format::MAX_BYTES {
            return Err(refuse(format!("SKILL.md is {} KB; the most is {most} KB.", js::to_fixed(bytes.len() as f64 / 1024.0, 1))));
        }
        let (real, base) = self.project()?;
        let folder = self.new_folder(&real, &base, &name)?;
        self.write_new(&folder, bytes)?;
        let others = std::fs::read_dir(&source).map(|entries| entries.flatten().filter(|entry| entry.file_name() != "SKILL.md").count()).unwrap_or(0);
        Ok(json!({ "ok": true, "skill": self.entry(&base, &name)?, "skipped": others }))
    }

    fn export_to(&self, request: &Value) -> Step<Value> {
        let name = self.named(request.get("name").unwrap_or(&Value::Null))?;
        let target = request.get("target").and_then(Value::as_str).filter(|text| is_absolute(text)).ok_or_else(|| refuse("Choose where to save it."))?;
        let kind = request.get("kind").and_then(Value::as_str).unwrap_or("folder");
        let (real, base) = self.project()?;
        let found = self.locate(&real, &base, &name)?.ok_or_else(|| refuse_with(format!("There is no skill named {name}."), json!({ "missing": true })))?;
        if found.too_big {
            return Err(refuse_with("That file is too big to open here.", json!({ "tooBig": true })));
        }
        let bytes = std::fs::read(&found.file).map_err(io)?;
        if kind == "zip" {
            if !self.collaborators.get("zip").is_some_and(is_function) {
                return Err(refuse("Zip files can't be made here."));
            }
            let file = if crate::js_regex!(r"\.zip$", "i").is_match(target) { target.to_string() } else { format!("{target}.zip") };
            let temporary = format!("{file}.part-{}", random_id());
            let made = (|| -> Step<()> {
                invoke(self.callbacks, &self.collaborators["zip"], vec![json!(path_text(&base.join(&name))), json!(temporary), json!({ "rootName": name })]).map_err(Fail::Io)?;
                std::fs::rename(&temporary, &file).map_err(io)
            })();
            let _ = std::fs::remove_file(&temporary);
            made?;
            return Ok(json!({ "ok": true, "where": file, "kind": "zip" }));
        }
        if let Err(error) = std::fs::create_dir(target) {
            return Err(match error.kind() {
                std::io::ErrorKind::AlreadyExists => refuse_with("That folder already exists. Choose a new name; nothing is replaced.", json!({ "exists": true })),
                std::io::ErrorKind::NotFound => refuse("The folder to put it in does not exist."),
                _ => io(error),
            });
        }
        self.replace_file(&Path::new(target).join("SKILL.md"), &bytes).inspect_err(|_| {
            let _ = std::fs::remove_dir(target);
        })?;
        Ok(json!({ "ok": true, "where": target, "kind": "folder" }))
    }
}

/// `skills.<function>(collaborators, ...args)`, as the engine's `skills` factory calls it.
pub fn call(function: &str, args: &[Value], callbacks: &dyn Callbacks) -> Result<Value, String> {
    let arg = |index: usize| args.get(index).cloned().unwrap_or(Value::Null);
    let collaborators = arg(0);
    let skills = Skills { collaborators: &collaborators, callbacks };
    Ok(match function {
        "list" => answer(skills.list()),
        "read" => answer(skills.read(&arg(1))),
        "save" => answer(skills.save(&arg(1))),
        "create" => answer(skills.create(&arg(1))),
        "delete" => answer(skills.remove(&arg(1))),
        "importFrom" => answer(skills.import_from(&arg(1))),
        "exportTo" => answer(skills.export_to(&arg(1))),
        // skill-format.cjs, for the parity tests.
        "format.parse" => format::parse_value(&js::string(&arg(0))),
        "format.check" => format::check_value(&arg(0)),
        "format.describe" => json!(format::describe(&js::string(&arg(0)))),
        "format.nameProblem" => format::name_problem(&arg(0)).map(|problem| json!(problem)).unwrap_or(Value::Null),
        other => return Err(format!("skills.{other} has not moved to Rust")),
    })
}
