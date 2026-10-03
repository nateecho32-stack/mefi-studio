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

pub mod callbacks;
pub mod eyes;
pub mod js;
pub mod paths;
pub mod repo;
