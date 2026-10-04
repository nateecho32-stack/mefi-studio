//! Mefi's Studio AI+ engine, moving from JavaScript to Rust one subsystem at a
//! time (docs/rust-migration.md, stage 2). Each module here replaces a
//! JavaScript module with the same answers for the same inputs; the parity
//! tests (tests/rust_parity_*.test.mjs) run both on the same fixtures.
//!
//! Moved so far:
//! - `eyes`: the OpenCode session-store reads and their git helpers
//!   (scripts/eyes.mjs's worker methods, behind scripts/eyes-client.cjs).
//! - `repo`: multi-PC sync and the worktree table and actions
//!   (scripts/sync.mjs, worktrees.mjs, worktree-actions.mjs, reached through
//!   main.cjs's loadModule).

//! - `files`: the @ picker's project file search (scripts/project-files.cjs
//!   with gitignore-lite.cjs), behind a Rust-backed factory.
//! - `git`: the Git chip's host actions (scripts/git-actions.cjs and the
//!   git-link.cjs rules they read), behind a Rust-backed factory.
//!
//! - `images`: a message's pictures (scripts/image-store.cjs and the checks
//!   of image-attach.cjs), behind a Rust-backed factory.
//! - `skills`: the Skills page's files (scripts/skills.cjs and
//!   skill-format.cjs), behind a Rust-backed factory.
//!
//! `jsre` runs JavaScript regular expressions with JavaScript's meaning.

pub mod callbacks;
pub mod eyes;
pub mod files;
pub mod git;
pub mod images;
pub mod js;
pub mod jsre;
pub mod paths;
pub mod repo;
pub mod skills;

/// Any ported module function by its `<module>.<function>` name.
pub fn dispatch(function: &str, args: &[serde_json::Value], callbacks: &dyn callbacks::Callbacks) -> Result<serde_json::Value, String> {
    match function.split_once('.') {
        Some(("files", name)) => files::call(name, args, callbacks),
        Some(("git", name)) => git::call(name, args, callbacks),
        Some(("skills", name)) => skills::call(name, args, callbacks),
        Some(("images", name)) => images::call(name, args, callbacks),
        _ => repo::call(function, args, callbacks),
    }
}
