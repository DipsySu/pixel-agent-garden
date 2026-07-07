//! Cross-adapter orchestration.

use crate::adapter::AdapterContext;
use crate::error::Error;
use crate::event::AgentEvent;
use crate::registry;
use std::collections::HashSet;

/// Run every built-in adapter whose `discover()` returns true, collect their
/// events, dedupe rows that multiple local ledgers expose, then return them in
/// deterministic chronological order.
pub struct ScanResult {
    pub events: Vec<AgentEvent>,
    pub active_sources: Vec<String>,
}

pub fn collect_events(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
) -> Result<ScanResult, Error> {
    let mut events = Vec::new();
    let mut active = Vec::new();
    for adapter in registry::default_adapters() {
        let name = adapter.name().to_string();
        if let Some(filter) = sources_filter {
            if !filter.iter().any(|s| s == &name) {
                continue;
            }
        }
        if !adapter.discover(ctx) {
            continue;
        }
        let mut got = adapter.collect(ctx)?;
        if !got.is_empty() {
            active.push(name);
        }
        events.append(&mut got);
    }
    Ok(ScanResult {
        events: dedupe_events(events),
        active_sources: active,
    })
}

fn dedupe_events(mut events: Vec<AgentEvent>) -> Vec<AgentEvent> {
    events.sort_by(|a, b| {
        (
            a.timestamp,
            a.source.as_str(),
            a.raw_ref.as_deref().unwrap_or(""),
        )
            .cmp(&(
                b.timestamp,
                b.source.as_str(),
                b.raw_ref.as_deref().unwrap_or(""),
            ))
    });

    let mut seen = HashSet::new();
    let mut unique = Vec::with_capacity(events.len());
    for event in events {
        let key = dedupe_key(&event);
        if seen.insert(key) {
            unique.push(event);
        }
    }
    unique
}

fn dedupe_key(event: &AgentEvent) -> String {
    if let Some(uuid) = event.metadata.get("uuid").and_then(|v| v.as_str()) {
        return format!(
            "uuid:{}:{}:{}",
            event.source,
            event.session_id.as_deref().unwrap_or(""),
            uuid
        );
    }
    format!(
        "row:{}:{}:{}:{}:{}:{}:{}",
        event.source,
        event.timestamp.to_rfc3339(),
        event.project_key(),
        event.session_id.as_deref().unwrap_or(""),
        event.event_type,
        event.usage.total_tokens,
        event.raw_ref.as_deref().unwrap_or("")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use serde_json::json;

    fn event(source: &str, second: u32, raw_ref: &str) -> AgentEvent {
        let mut event = AgentEvent::new(
            source,
            Utc.with_ymd_and_hms(2026, 5, 27, 9, 0, second).unwrap(),
        );
        event.project_path = Some(r"D:\code\demo-notes".to_string());
        event.session_id = Some("session-a".to_string());
        event.usage.total_tokens = 100;
        event.raw_ref = Some(raw_ref.to_string());
        event
    }

    fn mark_uuid(event: &mut AgentEvent, uuid: &str) {
        event.metadata.insert("uuid".to_string(), json!(uuid));
    }

    #[test]
    fn dedupe_events_collapses_uuid_within_source_and_session() {
        let mut kept = event("claude-cowork", 0, "a.jsonl:1");
        mark_uuid(&mut kept, "row-1");

        let mut duplicate = kept.clone();
        duplicate.raw_ref = Some("b.jsonl:2".to_string());
        duplicate.usage.total_tokens = 999;

        let mut other_session = kept.clone();
        other_session.session_id = Some("session-b".to_string());
        other_session.raw_ref = Some("c.jsonl:3".to_string());

        let mut other_source = kept.clone();
        other_source.source = "claude-code".to_string();
        other_source.raw_ref = Some("d.jsonl:4".to_string());

        let events = dedupe_events(vec![duplicate, other_session, other_source, kept]);

        assert_eq!(events.len(), 3);
        let same_session = events
            .iter()
            .find(|event| {
                event.source == "claude-cowork" && event.session_id.as_deref() == Some("session-a")
            })
            .unwrap();
        assert_eq!(same_session.raw_ref.as_deref(), Some("a.jsonl:1"));
        assert_eq!(same_session.usage.total_tokens, 100);
        assert!(events.iter().any(|event| {
            event.source == "claude-cowork" && event.session_id.as_deref() == Some("session-b")
        }));
        assert!(events.iter().any(|event| event.source == "claude-code"));
    }

    #[test]
    fn dedupe_events_uses_fallback_row_key_and_chronological_order() {
        let mut early = event("manual-source", 1, "manual.jsonl:1");
        early.project_path = Some("D:/code/demo-notes/".to_string());
        early.metadata.clear();

        let mut duplicate = early.clone();
        duplicate.project_path = Some(r"d:\code\demo-notes".to_string());

        let mut same_event_different_row = early.clone();
        same_event_different_row.raw_ref = Some("manual.jsonl:2".to_string());

        let mut later = event("manual-source", 2, "manual.jsonl:3");
        later.project_path = Some(r"D:\code\demo-notes".to_string());
        later.metadata.clear();

        let events = dedupe_events(vec![later, duplicate, same_event_different_row, early]);

        assert_eq!(events.len(), 3);
        let raw_refs: Vec<&str> = events
            .iter()
            .map(|event| event.raw_ref.as_deref().unwrap())
            .collect();
        assert_eq!(
            raw_refs,
            vec!["manual.jsonl:1", "manual.jsonl:2", "manual.jsonl:3"]
        );
    }
}
