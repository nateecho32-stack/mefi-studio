//! The engine's Rust half from the command line, for the parity tests
//! (tests/rust_parity_eyes.test.mjs) and for trying a port by hand.
//!
//!   mefi-core eyes <method> [json args]      one store read
//!   mefi-core eyes-batch < calls.json         [{ "method", "args" }, ...] in one process
//!   mefi-core eyes-dump --fixture <db> [--root <dir>] [--now <ms>] [--porcelain <text>]
//!   mefi-core repo-batch < calls.json         [{ "function": "sync.inspect", "args": [...] }, ...]
//!
//! Answers are JSON on stdout. A failed read is { "error": message } (exit 1
//! for a single read; batch entries carry their own { ok, value | error }).

use std::io::Read;

use serde_json::{json, Value};

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|arg| arg == name).and_then(|at| args.get(at + 1)).map(String::as_str)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        Some("eyes") => {
            let method = args.get(1).cloned().unwrap_or_default();
            let input: Value = args.get(2).and_then(|text| serde_json::from_str(text).ok()).unwrap_or_else(|| json!({}));
            match mefi_core::eyes::call(&method, &input) {
                Ok(value) => {
                    println!("{value}");
                    0
                }
                Err(error) => {
                    println!("{}", json!({ "error": error }));
                    1
                }
            }
        }
        Some("eyes-batch") => {
            let mut text = String::new();
            let _ = std::io::stdin().read_to_string(&mut text);
            let calls: Vec<Value> = serde_json::from_str(&text).unwrap_or_default();
            let answers: Vec<Value> = calls
                .iter()
                .map(|entry| {
                    let method = entry.get("method").and_then(Value::as_str).unwrap_or_default();
                    let input = entry.get("args").cloned().unwrap_or_else(|| json!({}));
                    let started = std::time::Instant::now();
                    // call_json is the host's path; the batch times that, then reads the text back.
                    let answer = mefi_core::eyes::call_json(method, &input);
                    let ms = started.elapsed().as_secs_f64() * 1000.0;
                    match answer.and_then(|text| serde_json::from_str::<Value>(&text).map_err(|error| error.to_string())) {
                        Ok(value) => json!({ "ok": true, "value": value, "ms": ms }),
                        Err(error) => json!({ "ok": false, "error": error, "ms": ms }),
                    }
                })
                .collect();
            println!("{}", Value::Array(answers));
            0
        }
        Some("repo-batch") => {
            // [{ "function": "sync.inspect", "args": [...] }, ...]; function
            // arguments must be constant handles ({ "$mefi": "const", "value" }).
            let mut text = String::new();
            let _ = std::io::stdin().read_to_string(&mut text);
            let calls: Vec<Value> = serde_json::from_str(&text).unwrap_or_default();
            let answers: Vec<Value> = calls
                .iter()
                .map(|entry| {
                    let function = entry.get("function").and_then(Value::as_str).unwrap_or_default();
                    let input = entry.get("args").and_then(Value::as_array).cloned().unwrap_or_default();
                    match mefi_core::repo::call(function, &input, &mefi_core::callbacks::NoCallbacks) {
                        Ok(value) => json!({ "ok": true, "value": value }),
                        Err(error) => json!({ "ok": false, "error": error }),
                    }
                })
                .collect();
            println!("{}", Value::Array(answers));
            0
        }
        Some("eyes-dump") => {
            let fixture = flag(&args, "--fixture").map(String::from).unwrap_or_else(mefi_core::eyes::default_db);
            let now = flag(&args, "--now").and_then(|text| text.parse::<f64>().ok()).unwrap_or_else(|| {
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
            });
            let porcelain = flag(&args, "--porcelain").map(|value| {
                if std::path::Path::new(value).exists() { std::fs::read_to_string(value).unwrap_or_default() } else { value.replace("\\n", "\n") }
            });
            match mefi_core::eyes::dump(&fixture, flag(&args, "--root"), now, &porcelain.unwrap_or_default()) {
                Ok(value) => {
                    println!("{}", serde_json::to_string_pretty(&value).unwrap_or_default());
                    0
                }
                Err(error) => {
                    eprintln!("{error}");
                    1
                }
            }
        }
        _ => {
            eprintln!("usage: mefi-core eyes <method> [json] | eyes-batch < calls.json | eyes-dump --fixture <db> [--root <dir>] [--now <ms>] [--porcelain <text>]");
            2
        }
    };
    std::process::exit(code);
}
