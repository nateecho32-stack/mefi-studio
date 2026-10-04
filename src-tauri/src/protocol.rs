//! Studio's page over `mefi://` (http://mefi.localhost on Windows). Only the
//! folders Electron's file:// page loaded from are served (renderer/, assets/
//! and the two catalogs under data/, like scripts/serve.mjs), plus local
//! pictures under /__file/ for the page's evidence and image views.

use std::borrow::Cow;
use std::path::{Component, Path, PathBuf};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{UriSchemeContext, UriSchemeResponder, Wry};

const DATA_FILES: &[&str] = &["data/models.json", "data/curated.json", "data/speed-measurements.json"];
const PICTURES: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"];

pub fn handler(root: PathBuf) -> impl Fn(UriSchemeContext<'_, Wry>, Request<Vec<u8>>, UriSchemeResponder) + Send + Sync + 'static {
    move |_context, request, responder| {
        let root = root.clone();
        let path = request.uri().path().to_string();
        tauri::async_runtime::spawn(async move {
            responder.respond(serve(&root, &path).await);
        });
    }
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.to_ascii_lowercase()).as_deref() {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs" | "cjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("avif") => "image/avif",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn status(code: StatusCode, text: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(code)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Cow::Owned(text.as_bytes().to_vec()))
        .unwrap()
}

/// A request path as a file under the Studio folder, if it may be served.
pub fn resolve(root: &Path, url_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(url_path.trim_start_matches('/'))?;
    let relative = Path::new(&decoded);
    if relative.components().any(|part| !matches!(part, Component::Normal(_))) {
        return None;
    }
    let text = decoded.replace('\\', "/");
    let allowed = text.starts_with("renderer/") || text.starts_with("assets/") || DATA_FILES.contains(&text.as_str());
    allowed.then(|| root.join(relative))
}

/// A local picture named by its absolute path under /__file/.
pub fn resolve_picture(url_path: &str) -> Option<PathBuf> {
    let encoded = url_path.strip_prefix("/__file/")?;
    let decoded = percent_decode(encoded)?;
    let path = PathBuf::from(decoded.replace('/', "\\"));
    let picture = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| PICTURES.contains(&ext.to_ascii_lowercase().as_str()));
    (path.is_absolute() && picture && !path.components().any(|part| matches!(part, Component::ParentDir))).then_some(path)
}

/// Electron's page loaded from file:, and its CSP was written for that. Here
/// the page also has to reach Tauri's IPC endpoint.
pub fn adapt_page(html: &str) -> String {
    html.replacen("connect-src 'self'", "connect-src 'self' ipc: http://ipc.localhost", 1)
}

async fn serve(root: &Path, url_path: &str) -> Response<Cow<'static, [u8]>> {
    let file = if url_path.starts_with("/__file/") { resolve_picture(url_path) } else { resolve(root, url_path) };
    let Some(file) = file else {
        return status(StatusCode::NOT_FOUND, "not served");
    };
    let bytes = match tokio::fs::read(&file).await {
        Ok(bytes) => bytes,
        Err(_) => return status(StatusCode::NOT_FOUND, "not found"),
    };
    let kind = content_type(&file);
    let body = if kind.starts_with("text/html") {
        adapt_page(&String::from_utf8_lossy(&bytes)).into_bytes()
    } else {
        bytes
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, kind)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Cow::Owned(body))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_only_the_page_folders() {
        let root = Path::new(r"C:\studio");
        assert_eq!(resolve(root, "/renderer/booklet.html"), Some(root.join("renderer/booklet.html")));
        assert_eq!(resolve(root, "/data/models.json"), Some(root.join("data/models.json")));
        assert_eq!(resolve(root, "/data/settings.json"), None);
        assert_eq!(resolve(root, "/main.cjs"), None);
        assert_eq!(resolve(root, "/renderer/../main.cjs"), None);
        assert_eq!(resolve(root, "/renderer/%2e%2e/main.cjs"), None);
    }

    #[test]
    fn pictures_need_an_absolute_path_and_a_picture_extension() {
        assert_eq!(resolve_picture("/__file/C%3A%2Fshots%2Fa.png"), Some(PathBuf::from(r"C:\shots\a.png")));
        assert_eq!(resolve_picture("/__file/C%3A%2Fsecrets%2Fauth.json"), None);
        assert_eq!(resolve_picture("/__file/shots%2Fa.png"), None);
        assert_eq!(resolve_picture("/__file/C%3A%2Fa%2F..%2Fb.png"), None);
    }

    #[test]
    fn page_csp_admits_the_ipc_endpoint() {
        let html = r#"<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' file:;">"#;
        assert!(adapt_page(html).contains("connect-src 'self' ipc: http://ipc.localhost file:;"));
    }
}
