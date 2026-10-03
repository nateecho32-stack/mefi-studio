//! Functions the engine passes to a ported module (sync's `check`, a
//! worktree action's `inUse`). They cannot cross as code, so they cross as
//! handles: `{ "$mefi": "fn", "id": n }` is a JavaScript function the host
//! calls back into the engine to run, and `{ "$mefi": "const", "value": v }`
//! is a function that always answers `v` (the parity tests use it, having no
//! engine to call back).

use serde_json::Value;

/// Calls a `{ "$mefi": "fn" }` handle in whatever process owns it.
pub trait Callbacks {
    fn call(&self, handle: &Value, args: Vec<Value>) -> Result<Value, String>;
}

/// No engine to call back: only constant handles answer.
pub struct NoCallbacks;

impl Callbacks for NoCallbacks {
    fn call(&self, _handle: &Value, _args: Vec<Value>) -> Result<Value, String> {
        Err("this function cannot be called outside Studio's engine".into())
    }
}

/// True when the value stands for a function.
pub fn is_function(value: &Value) -> bool {
    matches!(value.get("$mefi").and_then(Value::as_str), Some("fn" | "const"))
}

/// Calls a function argument.
pub fn invoke(callbacks: &dyn Callbacks, handle: &Value, args: Vec<Value>) -> Result<Value, String> {
    match handle.get("$mefi").and_then(Value::as_str) {
        Some("const") => Ok(handle.get("value").cloned().unwrap_or(Value::Null)),
        Some("fn") => callbacks.call(handle, args),
        _ => Err("not a function".into()),
    }
}
