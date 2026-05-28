//! Manual JSONL adapter — escape hatch for agents without a native adapter.
//!
//! Users point this adapter at any JSONL file (Cursor, Aider, Gemini CLI, …)
//! and each row's fields map directly to AgentEvent.

use crate::adapter::{Adapter, AdapterContext};
use crate::adapters::util::{JsonlRow, as_int_opt, parse_rfc3339_utc, read_jsonl};
use crate::error::Error;
use crate::event::AgentEvent;
use std::path::PathBuf;

pub struct ManualJsonlAdapter;

impl ManualJsonlAdapter {
    pub const NAME: &'static str = "manual-jsonl";
}

impl Adapter for ManualJsonlAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        !ctx.manual_jsonl.is_empty()
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let mut events = Vec::new();
        for path in &ctx.manual_jsonl {
            for row in read_jsonl(path) {
                if let Some(event) = row_to_event(&row, path) {
                    events.push(event);
                }
            }
        }
        Ok(events)
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        ctx.manual_jsonl.clone()
    }
}

fn row_to_event(row: &JsonlRow, path: &std::path::Path) -> Option<AgentEvent> {
    let source = row.value.get("source").and_then(|v| v.as_str())?;
    let timestamp_str = row.value.get("timestamp").and_then(|v| v.as_str())?;
    let timestamp = parse_rfc3339_utc(timestamp_str)?;

    let mut event = AgentEvent::new(source, timestamp);
    event.project_path = row
        .value
        .get("project_path")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    event.session_id = row
        .value
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    if let Some(et) = row.value.get("event_type").and_then(|v| v.as_str()) {
        event.event_type = et.to_string();
    }
    event.usage.input_tokens = as_int_opt(row.value.get("input_tokens"));
    event.usage.output_tokens = as_int_opt(row.value.get("output_tokens"));
    event.usage.cache_read_tokens = as_int_opt(row.value.get("cache_read_tokens"));
    event.usage.cache_write_tokens = as_int_opt(row.value.get("cache_write_tokens"));
    event.usage.total_tokens = as_int_opt(row.value.get("total_tokens"));
    event.tool_calls = as_int_opt(row.value.get("tool_calls")) as u32;
    event.model = row
        .value
        .get("model")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    event.raw_ref = Some(format!("{}:{}", path.display(), row.line_no));
    event.normalize_totals();
    Some(event)
}
