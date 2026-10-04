//! Where Studio's files are, and the folders Electron's app.getPath named.
//! The engine must keep reading the same settings.json and auth.json it
//! always did, so userData is Electron's: %APPDATA%\<productName>.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

#[derive(Clone)]
pub struct Studio {
    /// The folder holding main.cjs, preload.cjs, renderer/ and scripts/.
    pub root: PathBuf,
    /// True only when Studio's files ship beside this program (the portable
    /// build: <exe dir>/resources/app, where the Electron build keeps them
    /// too, or <exe dir> or <exe dir>/app). A source run, found through
    /// MEFI_STUDIO_ROOT or above the build folder, is what Electron's
    /// app.isPackaged called false for `npm start`.
    pub packaged: bool,
    pub version: String,
    pub product: String,
}

fn holds_studio(dir: &Path) -> bool {
    dir.join("main.cjs").is_file() && dir.join("preload.cjs").is_file() && dir.join("renderer").is_dir()
}

impl Studio {
    pub fn locate() -> Result<Studio, String> {
        let exe = std::env::current_exe().map_err(|error| format!("cannot find this program's path: {error}"))?;
        let root = match std::env::var_os("MEFI_STUDIO_ROOT") {
            Some(dir) if holds_studio(Path::new(&dir)) => PathBuf::from(dir),
            Some(dir) => return Err(format!("MEFI_STUDIO_ROOT={} has no main.cjs, preload.cjs and renderer/", PathBuf::from(dir).display())),
            None => exe
                .ancestors()
                .skip(1)
                .flat_map(|dir| [dir.join("resources").join("app"), dir.to_path_buf(), dir.join("app")])
                .find(|dir| holds_studio(dir))
                .ok_or_else(|| format!("no Studio files (main.cjs, preload.cjs, renderer/) above {}", exe.display()))?,
        };
        let root = dunce(root);
        let exe_dir = exe.parent().map(|dir| dunce(dir.to_path_buf())).unwrap_or_default();
        let packaged = std::env::var_os("MEFI_STUDIO_ROOT").is_none() && [exe_dir.join("resources").join("app"), exe_dir.clone(), exe_dir.join("app")].contains(&root);
        let package: Value = std::fs::read(root.join("package.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(strip_bom(&bytes)).ok())
            .unwrap_or(Value::Null);
        let version = package["version"].as_str().unwrap_or("0.0.0").to_string();
        let product = package["productName"]
            .as_str()
            .or_else(|| package["name"].as_str())
            .unwrap_or("Mefi's Studio AI+")
            .to_string();
        Ok(Studio { root, packaged, version, product })
    }

    /// Node for the engine: MEFI_STUDIO_NODE, a node.exe shipped beside this
    /// program (the portable build), or the one on PATH.
    pub fn node_executable(&self) -> PathBuf {
        if let Some(path) = std::env::var_os("MEFI_STUDIO_NODE") {
            return PathBuf::from(path);
        }
        if let Some(dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)) {
            for candidate in [dir.join("node").join("node.exe"), dir.join("node.exe")] {
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
        PathBuf::from("node")
    }

    /// MEFI_STUDIO_USER_DATA points a test or probe run at a scratch folder,
    /// so it never reads or writes the owner's settings and keys.
    pub fn user_data(&self, app: &AppHandle) -> PathBuf {
        match std::env::var_os("MEFI_STUDIO_USER_DATA") {
            Some(dir) if !dir.is_empty() => PathBuf::from(dir),
            _ => app_data(app).join(&self.product),
        }
    }

    /// app.getPath's names, as Electron resolved them on Windows.
    pub fn electron_paths(&self, app: &AppHandle) -> Map<String, Value> {
        let resolver = app.path();
        let user_data = self.user_data(app);
        let exe = std::env::current_exe().unwrap_or_default();
        let mut out = Map::new();
        let mut put = |name: &str, path: Option<PathBuf>| {
            if let Some(path) = path {
                out.insert(name.into(), json!(path.to_string_lossy()));
            }
        };
        put("home", resolver.home_dir().ok());
        put("appData", Some(app_data(app)));
        put("userData", Some(user_data.clone()));
        put("sessionData", Some(user_data.clone()));
        put("logs", Some(user_data.join("logs")));
        put("crashDumps", Some(user_data.join("Crashpad")));
        put("temp", Some(std::env::temp_dir()));
        put("exe", Some(exe.clone()));
        put("module", Some(exe));
        put("desktop", resolver.desktop_dir().ok());
        put("documents", resolver.document_dir().ok());
        put("downloads", resolver.download_dir().ok());
        put("music", resolver.audio_dir().ok());
        put("pictures", resolver.picture_dir().ok());
        put("videos", resolver.video_dir().ok());
        put("recent", resolver.data_dir().ok().map(|dir| dir.join("Microsoft").join("Windows").join("Recent")));
        out
    }
}

/// %APPDATA% (Roaming), Electron's appData.
fn app_data(app: &AppHandle) -> PathBuf {
    app.path()
        .data_dir()
        .ok()
        .or_else(|| std::env::var_os("APPDATA").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir)
}

pub fn strip_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes)
}

/// Canonical paths without the \\?\ prefix, which Node and git dislike.
fn dunce(path: PathBuf) -> PathBuf {
    let canonical = std::fs::canonicalize(&path).unwrap_or(path);
    let text = canonical.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => canonical,
    }
}
