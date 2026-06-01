//! Cached garden summary helpers.
//!
//! Tauri and other long-lived shells should start from the persisted
//! `events.json` cache when possible, then refresh it through the normal scan
//! path when the cache is absent or unreadable.

use crate::adapter::AdapterContext;
use crate::aggregate::{self, GardenSummary};
use crate::error::Error;
use crate::{scan, storage};
use std::path::{Path, PathBuf};

/// Default event cache path — `~/.local-agent-garden/events.json`.
pub fn default_events_path() -> PathBuf {
    storage::default_state_dir().join("events.json")
}

/// Load a cached summary when possible. If the cache is missing, malformed, or
/// written with an incompatible future schema, run a fresh scan and replace it.
pub fn summary_from_cache_or_scan(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
) -> Result<GardenSummary, Error> {
    summary_from_cache_or_scan_at(ctx, sources_filter, &default_events_path())
}

/// Same as `summary_from_cache_or_scan`, but lets tests or callers pin the
/// cache path.
pub fn summary_from_cache_or_scan_at(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    cache_path: &Path,
) -> Result<GardenSummary, Error> {
    match storage::load_events(cache_path) {
        Ok(events) => Ok(aggregate::summarize(&events)),
        Err(_) => refresh_summary_at(ctx, sources_filter, cache_path),
    }
}

/// Force a scan, persist the normalized event cache, and return the summary.
pub fn refresh_summary(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
) -> Result<GardenSummary, Error> {
    refresh_summary_at(ctx, sources_filter, &default_events_path())
}

/// Same as `refresh_summary`, but lets tests or callers pin the cache path.
pub fn refresh_summary_at(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    cache_path: &Path,
) -> Result<GardenSummary, Error> {
    let result = scan::collect_events(ctx, sources_filter)?;
    storage::save_events(&result.events, cache_path)?;
    Ok(aggregate::summarize(&result.events))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::AgentEvent;
    use chrono::TimeZone;

    fn tmp_path(suffix: &str) -> PathBuf {
        std::env::temp_dir().join(format!("lag-cache-{}-{}.json", std::process::id(), suffix))
    }

    fn sample_event() -> AgentEvent {
        let mut event = AgentEvent::new(
            "manual-test",
            chrono::Utc.with_ymd_and_hms(2026, 5, 29, 12, 0, 0).unwrap(),
        );
        event.project_path = Some("D:/repo/pixel-agent-garden".to_string());
        event.usage.total_tokens = 42;
        event
    }

    #[test]
    fn summary_uses_existing_cache() {
        let path = tmp_path("existing");
        let _ = std::fs::remove_file(&path);
        storage::save_events(&[sample_event()], &path).unwrap();

        let ctx = AdapterContext::with_home(std::env::temp_dir().join("lag-cache-empty-home"));
        let summary = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();

        assert_eq!(summary.total_events, 1);
        assert_eq!(summary.total_tokens, 42);
        assert_eq!(summary.projects[0].display_name, "pixel-agent-garden");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_cache_scans_and_writes_empty_cache() {
        let path = tmp_path("missing");
        let _ = std::fs::remove_file(&path);

        let ctx = AdapterContext::with_home(std::env::temp_dir().join("lag-cache-empty-home"));
        let summary = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();

        assert_eq!(summary.total_events, 0);
        assert!(path.exists(), "cache should be created after fallback scan");
        let events = storage::load_events(&path).unwrap();
        assert!(events.is_empty());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn incompatible_cache_is_replaced_after_scan() {
        let path = tmp_path("future");
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, r#"{"schema_version":999,"events":[]}"#).unwrap();

        let ctx = AdapterContext::with_home(std::env::temp_dir().join("lag-cache-empty-home"));
        let summary = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();

        assert_eq!(summary.total_events, 0);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(
            text.contains(r#""schema_version": 1"#),
            "future cache should be replaced, got: {text}"
        );
        std::fs::remove_file(&path).ok();
    }
}
