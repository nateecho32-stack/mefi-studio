//! Functions the engine passes to a ported module (sync's `check`, a
//! worktree action's `inUse`). They cannot cross as code, so they cross as
//! handles: `{ "$mefi": "fn", "id": n }` is a JavaScript function the host
//! calls back into the engine to run, and `{ "$mefi": "const", "value": v }`
//! is a function that always answers `v` (the parity tests use it, having no
//! engine to call back).

use std::time::Duration;

use serde_json::Value;

/// The error a call answers when its time ran out.
pub const TIMED_OUT: &str = "the engine did not answer in time";

/// Calls a `{ "$mefi": "fn" }` handle in whatever process owns it. A port may
/// work on several threads at once (three glances in parallel), so a caller
/// is shared between them.
pub trait Callbacks: Sync {
    fn call(&self, handle: &Value, args: Vec<Value>) -> Result<Value, String>;

    /// The same, giving up after `limit` with [`TIMED_OUT`]. Callers that
    /// cannot wait that long override it; the default waits as `call` does.
    fn call_within(&self, handle: &Value, args: Vec<Value>, _limit: Duration) -> Result<Value, String> {
        self.call(handle, args)
    }
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

/// Calls a function argument, giving up after `limit`.
pub fn invoke_within(callbacks: &dyn Callbacks, handle: &Value, args: Vec<Value>, limit: Duration) -> Result<Value, String> {
    match handle.get("$mefi").and_then(Value::as_str) {
        Some("fn") => callbacks.call_within(handle, args, limit),
        _ => invoke(callbacks, handle, args),
    }
}
