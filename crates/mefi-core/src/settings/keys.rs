//! Where a saved credential may come from besides its encrypted field: the
//! environment (scripts/credentials.cjs), and which fields are credentials at
//! all, so they live in auth.json and never in settings.json
//! (scripts/auth-store.cjs `authFields`).
//!
//!   own    - Studio's own MEFI_STUDIO_* name: outranks the saved field.
//!   shared - another tool's name for the same key: read only when no saved
//!            key can be read.

use serde_json::{json, Value};

/// Each credential field: Studio's own variable, then the shared ones.
pub const KEYS: [(&str, &str, &[&str]); 8] = [
    ("apiKeyEncrypted", "MEFI_STUDIO_KEY", &[]),
    ("zaiApiKeyEncrypted", "MEFI_STUDIO_ZAI_KEY", &[]),
    ("customApiKeyEncrypted", "MEFI_STUDIO_CUSTOM_KEY", &[]),
    ("gatewayApiKeyEncrypted", "MEFI_STUDIO_GATEWAY_KEY", &["AI_GATEWAY_API_KEY"]),
    ("jevApiKeyEncrypted", "MEFI_STUDIO_JEV_KEY", &["TYPESAFE_API_KEY"]),
    // opencode itself reads OPENCODE_API_KEY for Zen.
    ("zenApiKeyEncrypted", "MEFI_STUDIO_ZEN_KEY", &["OPENCODE_ZEN_API_KEY", "OPENCODE_API_KEY"]),
    ("openrouterApiKeyEncrypted", "MEFI_STUDIO_OPENROUTER_KEY", &["OPENROUTER_API_KEY"]),
    ("githubTokenEncrypted", "MEFI_STUDIO_GITHUB_TOKEN", &["GH_TOKEN", "GITHUB_TOKEN"]),
];

/// auth-store.cjs's fallback list, kept for an install whose credentials.cjs is older.
const FALLBACK_AUTH_FIELDS: [&str; 8] = [
    "apiKeyEncrypted",
    "zaiApiKeyEncrypted",
    "customApiKeyEncrypted",
    "gatewayApiKeyEncrypted",
    "jevApiKeyEncrypted",
    "zenApiKeyEncrypted",
    "openrouterApiKeyEncrypted",
    "githubTokenEncrypted",
];

/// The credential fields that belong in auth.json, nothing else.
pub fn auth_fields() -> Vec<&'static str> {
    let mut fields: Vec<&'static str> = KEYS.iter().map(|(field, _, _)| *field).collect();
    for field in FALLBACK_AUTH_FIELDS {
        if !fields.contains(&field) {
            fields.push(field);
        }
    }
    fields
}

fn entry(field: &str) -> Option<&'static (&'static str, &'static str, &'static [&'static str])> {
    KEYS.iter().find(|(name, _, _)| *name == field)
}

/// The first non-empty of a list of variables, trimmed, or None.
fn first_of(names: &[&str], env: &Value) -> Option<String> {
    names.iter().find_map(|name| {
        let value = match env.get(*name) {
            None | Some(Value::Null) => String::new(),
            Some(value) => crate::js::string(value),
        };
        let value = crate::js::trim(&value).to_string();
        (!value.is_empty()).then_some(value)
    })
}

pub fn own_key(field: &str, env: &Value) -> Option<String> {
    entry(field).and_then(|(_, own, _)| first_of(&[own], env))
}

pub fn shared_key(field: &str, env: &Value) -> Option<String> {
    entry(field).and_then(|(_, _, shared)| first_of(shared, env))
}

pub fn env_key(field: &str, env: &Value) -> Option<String> {
    own_key(field, env).or_else(|| shared_key(field, env))
}

/// Which source would answer for a field right now: "env", "settings", or None.
pub fn key_source(settings: &Value, field: &str, env: &Value, encryption_available: bool) -> Option<&'static str> {
    if own_key(field, env).is_some() {
        return Some("env");
    }
    if settings.get(field).is_some_and(crate::js::truthy) && encryption_available {
        return Some("settings");
    }
    shared_key(field, env).map(|_| "env")
}

/// The rules by name, for the parity tests.
pub fn call(function: &str, args: &[Value]) -> Option<Value> {
    let arg = |index: usize| args.get(index).cloned().unwrap_or(Value::Null);
    let field = crate::js::string(&arg(0));
    let opt = |value: Option<String>| value.map_or(Value::Null, Value::String);
    Some(match function {
        "authFields" => json!(auth_fields()),
        "envKeys" => Value::Object(KEYS.iter().map(|(field, own, shared)| (field.to_string(), json!(std::iter::once(*own).chain(shared.iter().copied()).collect::<Vec<_>>()))).collect()),
        "ownKey" => opt(own_key(&field, &arg(1))),
        "sharedKey" => opt(shared_key(&field, &arg(1))),
        "envKey" => opt(env_key(&field, &arg(1))),
        "keySource" | "hasKey" => {
            let options = arg(2);
            let found = key_source(&arg(0), &crate::js::string(&arg(1)), options.get("env").unwrap_or(&Value::Null), options.get("encryptionAvailable") == Some(&Value::Bool(true)));
            if function == "hasKey" {
                json!(found.is_some())
            } else {
                opt(found.map(String::from))
            }
        }
        _ => return None,
    })
}
