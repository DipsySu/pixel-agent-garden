//! Cross-adapter contract.
//!
//! New agents (Aider, Continue, Kilo Code, …) plug into the garden by
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
    /// XDG data root captured when the scan context is constructed. Keeping
    /// this in the context (instead of reading the process environment inside
    /// an adapter) preserves deterministic fixture tests and lets XDG-backed
    /// sources honor non-default installations.
    pub xdg_data_home: Option<PathBuf>,
    /// Extra JSONL paths handed in via CLI / config — used by the
    /// `manual_jsonl` adapter as an escape hatch for agents without a
    /// native adapter yet.
    pub manual_jsonl: Vec<PathBuf>,
}

impl AdapterContext {
    /// Build a context rooted at the running user's $HOME (or %USERPROFILE%
    /// on Windows). Fallback to "/" on misconfigured systems.
    pub fn from_env() -> Self {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"));
        let xdg_data_home = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute());
        Self {
            home,
            xdg_data_home,
            manual_jsonl: Vec::new(),
        }
    }

    pub fn with_home(home: impl Into<PathBuf>) -> Self {
        Self {
            home: home.into(),
            xdg_data_home: None,
            manual_jsonl: Vec::new(),
        }
    }

    /// Override the XDG data root for a synthetic context. Primarily used by
    /// adapter fixtures; callers should normally prefer [`Self::from_env`].
    pub fn with_xdg_data_home(mut self, path: impl Into<PathBuf>) -> Self {
        self.xdg_data_home = Some(path.into());
        self
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
    /// Examples: `"claude-code"`, `"claude-cowork"`, `"codex"`,
    /// `"manual-jsonl"`.
    fn name(&self) -> &str;

    /// Cheap presence check — are the files this adapter cares about even
    /// in the filesystem? Used by `scan` to skip dormant adapters without
    /// reading their content.
    fn discover(&self, ctx: &AdapterContext) -> bool;

    /// Read raw files → normalized `AgentEvent`s. MUST tolerate partial /
    /// corrupt files (skip the row, keep the rest). Source-level I/O/database
    /// failures bubble up as `Error`; `scan` isolates them per adapter and
    /// reports a structured warning while retaining healthy sources.
    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error>;

    /// Refresh this adapter while reusing its previous normalized partition
    /// when possible. Most adapters are cheap enough to use the default full
    /// collection. Large append-only sources can override this method and
    /// validate individual cached rows before reparsing changed files.
    fn collect_incremental(
        &self,
        ctx: &AdapterContext,
        _previous: &[AgentEvent],
    ) -> Result<Vec<AgentEvent>, Error> {
        self.collect(ctx)
    }

    /// Paths to watch for live updates. The Tauri layer subscribes to every
    /// path returned across all adapters and triggers a debounced rescan on
    /// change. Returning an empty Vec means this adapter doesn't support
    /// live updates (manual-jsonl, for instance — files are user-supplied
    /// and can be reloaded explicitly).
    fn watch_paths(&self, _ctx: &AdapterContext) -> Vec<PathBuf> {
        Vec::new()
    }
}
