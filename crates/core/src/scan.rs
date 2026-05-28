//! Cross-adapter orchestration. The Python equivalent lives in
//! `local_agent_garden/core/scan.py`.

use crate::adapter::AdapterContext;
use crate::error::Error;
use crate::event::AgentEvent;
use crate::registry;

/// Run every built-in adapter whose `discover()` returns true, collect their
/// events, and return them in **adapter + file order** (NOT sorted).
///
/// The Python `collect_events` doesn't sort either — `events.json` reflects
/// the raw collection order, and only `aggregate::summarize` sorts on read.
/// Sorting here would re-order ties (events with identical timestamps) in
/// ways the byte-equality compat test catches.
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
        events,
        active_sources: active,
    })
}
