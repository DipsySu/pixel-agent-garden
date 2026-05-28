//! Cross-adapter contract.
//!
//! New agents (Cursor, Aider, Gemini CLI, …) plug into the garden by
//! implementing this trait and registering themselves in `registry::default_adapters`.
//! The trait is sync (per spec §Q3) so adapters live as plain library code,
//! callable from any context.

use crate::Error;
use crate::event::AgentEvent;
use std::path::PathBuf;

/// Per-scan context handed to every adapter. Keeps `discover` and `collect`
/// pure functions of (context, filesystem) — no global state.
#[derive(Debug, Clone)]
pub struct AdapterContext {
    /// User home directory. Adapters resolve agent dirs relative to this so
    /// tests can point at a synthetic home.
    pub home: PathBuf,
    /// Extra JSONL paths handed in via CLI / config — used by the
    /// `manual_jsonl` adapter as an escape hatch for agents without a
    /// native adapter yet.
    pub manual_jsonl: Vec<PathBuf>,
}

impl AdapterContext {
    /// Build a context rooted at the running user's $HOME (or %USERPROFILE%
    /// on Windows). Fallback to "/" matches Python's `Path.home()` behavior
    /// on misconfigured systems.
    pub fn from_env() -> Self {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"));
        Self {
            home,
            manual_jsonl: Vec::new(),
        }
    }

    pub fn with_home(home: impl Into<PathBuf>) -> Self {
        Self {
            home: home.into(),
            manual_jsonl: Vec::new(),
        }
    }

    pub fn with_manual_jsonl(mut self, paths: impl IntoIterator<Item = PathBuf>) -> Self {
        self.manual_jsonl = paths.into_iter().collect();
        self
    }
}

/// The cross-adapter contract.
///
/// Implementations live in `crate::adapters::*`. Each adapter is one file,
/// one impl, one set of tests — never call other adapters (modularity rule
/// #2 in the spec). Adapters MUST be cheap to construct so the registry
/// can instantiate them eagerly.
pub trait Adapter: Send + Sync {
    /// Stable name surfaced in CLI listings and inside `AgentEvent.source`.
    /// Mirrors the Python `name` class attribute (`"claude-code"`, `"codex"`,
    /// `"manual-jsonl"`).
    fn name(&self) -> &str;

    /// Cheap presence check — are the files this adapter cares about even
    /// in the filesystem? Used by `scan` to skip dormant adapters without
    /// reading their content.
    fn discover(&self, ctx: &AdapterContext) -> bool;

    /// Read raw files → normalized `AgentEvent`s. MUST tolerate partial /
    /// corrupt files (skip the row, keep the rest). I/O failures bubble up
    /// as `Error` so the caller can decide whether to fail the whole scan.
    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error>;

    /// Paths to watch for live updates. The Tauri layer subscribes to every
    /// path returned across all adapters and triggers a debounced rescan on
    /// change. Returning an empty Vec means this adapter doesn't support
    /// live updates (manual-jsonl, for instance — files are user-supplied
    /// and can be reloaded explicitly).
    fn watch_paths(&self, _ctx: &AdapterContext) -> Vec<PathBuf> {
        Vec::new()
    }
}
