//! Persistence: events.json read/write.

use crate::error::Error;
use crate::event::AgentEvent;
use std::path::{Path, PathBuf};

/// Default cache directory — `~/.local-agent-garden/`.
pub fn default_state_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"));
    home.join(".local-agent-garden")
}

pub fn save_events(events: &[AgentEvent], path: &Path) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    }
    let json = serde_json::to_string_pretty(events).map_err(|e| Error::json(path, e))?;
    std::fs::write(path, json).map_err(|e| Error::io(path, e))?;
    Ok(())
}

pub fn load_events(path: &Path) -> Result<Vec<AgentEvent>, Error> {
    let text = std::fs::read_to_string(path).map_err(|e| Error::io(path, e))?;
    serde_json::from_str(&text).map_err(|e| Error::json(path, e))
}
