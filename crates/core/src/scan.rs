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
