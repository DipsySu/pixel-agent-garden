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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_jsonl(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "lag-manual-jsonl-{name}-{}-{unique}.jsonl",
            std::process::id()
        ))
    }

    #[test]
    fn discover_and_watch_paths_follow_manual_context() {
        let empty = AdapterContext::with_home(std::env::temp_dir());
        assert!(!ManualJsonlAdapter.discover(&empty));
        assert!(ManualJsonlAdapter.watch_paths(&empty).is_empty());

        let first = PathBuf::from("one.jsonl");
        let second = PathBuf::from("two.jsonl");
        let ctx = AdapterContext::with_home(std::env::temp_dir())
            .with_manual_jsonl([first.clone(), second.clone()]);

        assert!(ManualJsonlAdapter.discover(&ctx));
        assert_eq!(ManualJsonlAdapter.watch_paths(&ctx), vec![first, second]);
    }

    #[test]
    fn collect_maps_valid_rows_and_skips_bad_or_incomplete_rows() {
        let path = temp_jsonl("mapping");
        let missing_timestamp = json!({ "source": "aider" });
        let normalized_total = json!({
            "source": "aider",
            "timestamp": "2026-05-27T09:00:00Z",
            "project_path": "D:/code/demo/",
            "session_id": "s1",
            "event_type": "message",
            "input_tokens": "1200",
            "output_tokens": 400,
            "cache_read_tokens": 30,
            "cache_write_tokens": 20,
            "tool_calls": 3,
            "model": "manual-model",
            "ignored": "unknown fields are accepted but ignored"
        });
        let explicit_total = json!({
            "source": "gemini",
            "timestamp": "2026-05-27T09:00:01+00:00",
            "project_path": "/repo",
            "input_tokens": 10,
            "total_tokens": 99,
            "tool_calls": "2"
        });
        std::fs::write(
            &path,
            format!(
                "not-json\n\n{}\n{}\n{}\n",
                missing_timestamp, normalized_total, explicit_total
            ),
        )
        .unwrap();

        let ctx = AdapterContext::with_home(std::env::temp_dir()).with_manual_jsonl([path.clone()]);
        let events = ManualJsonlAdapter.collect(&ctx).unwrap();

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].source, "aider");
        assert_eq!(
            events[0].timestamp.to_rfc3339(),
            "2026-05-27T09:00:00+00:00"
        );
        assert_eq!(events[0].project_path.as_deref(), Some("D:/code/demo/"));
        assert_eq!(events[0].session_id.as_deref(), Some("s1"));
        assert_eq!(events[0].event_type, "message");
        assert_eq!(events[0].usage.input_tokens, 1200);
        assert_eq!(events[0].usage.output_tokens, 400);
        assert_eq!(events[0].usage.cache_read_tokens, 30);
        assert_eq!(events[0].usage.cache_write_tokens, 20);
        assert_eq!(events[0].usage.total_tokens, 1650);
        assert_eq!(events[0].tool_calls, 3);
        assert_eq!(events[0].model.as_deref(), Some("manual-model"));
        assert_eq!(
            events[0].raw_ref.as_deref(),
            Some(format!("{}:4", path.display()).as_str())
        );

        assert_eq!(events[1].source, "gemini");
        assert_eq!(events[1].usage.input_tokens, 10);
        assert_eq!(events[1].usage.total_tokens, 99);
        assert_eq!(events[1].tool_calls, 2);
        assert_eq!(
            events[1].raw_ref.as_deref(),
            Some(format!("{}:5", path.display()).as_str())
        );

        std::fs::remove_file(path).ok();
    }
}
