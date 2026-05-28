//! Persistence: events.json read/write.
//!
//! Per spec §Schema Versioning, the on-disk events cache carries a
//! `schema_version` envelope so a future readers that finds an unknown
//! version refuses the cache and rescans from source. The wrapper also
//! leaves room for adding sibling metadata (cache mtime, source hashes,
//! etc.) without renaming the events array.

use crate::aggregate::SCHEMA_VERSION;
use crate::error::Error;
use crate::event::AgentEvent;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Versioned events cache envelope. Saved as JSON to `events.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventsCache {
    pub schema_version: u32,
    pub events: Vec<AgentEvent>,
}

/// Default cache directory — `~/.local-agent-garden/`.
pub fn default_state_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"));
    home.join(".local-agent-garden")
}

/// Write events to disk wrapped in the versioned envelope.
pub fn save_events(events: &[AgentEvent], path: &Path) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    }
    let cache = EventsCache {
        schema_version: SCHEMA_VERSION,
        events: events.to_vec(),
    };
    let json = serde_json::to_string_pretty(&cache).map_err(|e| Error::json(path, e))?;
    std::fs::write(path, json).map_err(|e| Error::io(path, e))?;
    Ok(())
}

/// Read events from disk. Rejects caches with an unknown schema version so
/// the caller falls back to a fresh scan rather than misinterpreting fields.
/// Also accepts legacy unwrapped event arrays for backward compatibility with
/// caches written before versioning landed.
pub fn load_events(path: &Path) -> Result<Vec<AgentEvent>, Error> {
    let text = std::fs::read_to_string(path).map_err(|e| Error::io(path, e))?;
    // Try the wrapped form first; fall back to a bare array.
    match serde_json::from_str::<EventsCache>(&text) {
        Ok(cache) => {
            if cache.schema_version > SCHEMA_VERSION {
                return Err(Error::InvalidRecord {
                    context: path.display().to_string(),
                    message: format!(
                        "cache schema_version {} exceeds reader version {}; \
                         delete the cache to rescan",
                        cache.schema_version, SCHEMA_VERSION
                    ),
                });
            }
            Ok(cache.events)
        }
        Err(_) => serde_json::from_str::<Vec<AgentEvent>>(&text).map_err(|e| Error::json(path, e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::AgentEvent;
    use chrono::TimeZone;

    fn tmp(suffix: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "lag-storage-{}-{}.json",
            std::process::id(),
            suffix
        ))
    }

    fn sample_events() -> Vec<AgentEvent> {
        let ts = chrono::Utc.with_ymd_and_hms(2026, 5, 28, 12, 0, 0).unwrap();
        vec![AgentEvent::new("claude-code", ts)]
    }

    #[test]
    fn save_load_roundtrip_preserves_events() {
        let path = tmp("roundtrip");
        let _ = std::fs::remove_file(&path);
        save_events(&sample_events(), &path).unwrap();
        let back = load_events(&path).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].source, "claude-code");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn save_writes_schema_version() {
        let path = tmp("schema");
        let _ = std::fs::remove_file(&path);
        save_events(&sample_events(), &path).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["schema_version"], 1);
        assert!(parsed["events"].is_array());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn load_rejects_future_schema_version() {
        // A cache marked as v999 would predate this reader's understanding —
        // refuse it so we never misinterpret fields.
        let path = tmp("future");
        std::fs::write(&path, r#"{"schema_version":999,"events":[]}"#).unwrap();
        let err = load_events(&path).unwrap_err();
        assert!(
            matches!(err, Error::InvalidRecord { .. }),
            "expected InvalidRecord, got {err:?}"
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn load_accepts_legacy_bare_array() {
        // Caches written by older builds (pre-schema-version) were a flat
        // `[AgentEvent, ...]`. Still load them so we don't force a rescan on
        // every existing user the first time they pick up this build.
        let path = tmp("legacy");
        let ts = "2026-05-28T12:00:00Z";
        std::fs::write(
            &path,
            format!(
                r#"[{{"source":"claude-code","timestamp":"{ts}","event_type":"message","input_tokens":0,"output_tokens":0,"cache_read_tokens":0,"cache_write_tokens":0,"total_tokens":0,"tool_calls":0,"files_touched":[],"metadata":{{}}}}]"#
            ),
        )
        .unwrap();
        let back = load_events(&path).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].source, "claude-code");
        std::fs::remove_file(&path).ok();
    }
}
