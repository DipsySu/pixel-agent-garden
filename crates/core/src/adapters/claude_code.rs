//! Claude Code adapter — reads `~/.claude/projects/**/*.jsonl`.

use crate::adapter::{Adapter, AdapterContext};
use crate::adapters::util::{
    JsonlRow, as_int_opt, list_claude_session_files, parse_rfc3339_utc, project_from_claude_dir,
    read_jsonl,
};
use crate::error::Error;
use crate::event::AgentEvent;
use std::path::{Path, PathBuf};

pub struct ClaudeCodeAdapter;

impl ClaudeCodeAdapter {
    pub const NAME: &'static str = "claude-code";

    fn root(ctx: &AdapterContext) -> PathBuf {
        ctx.home.join(".claude").join("projects")
    }

    fn collect_session(
        &self,
        path: &Path,
        project_path: Option<&str>,
        fallback_session_id: &str,
    ) -> Vec<AgentEvent> {
        let mut events = Vec::new();
        for row in read_jsonl(path) {
            if let Some(event) = self.row_to_event(row, path, project_path, fallback_session_id) {
                events.push(event);
            }
        }
        events
    }

    fn row_to_event(
        &self,
        row: JsonlRow,
        path: &Path,
        project_path: Option<&str>,
        fallback_session_id: &str,
    ) -> Option<AgentEvent> {
        let value = row.value;
        // timestamp is required — without it, skip.
        let timestamp_str = value.get("timestamp")?.as_str()?;
        let timestamp = parse_rfc3339_utc(timestamp_str)?;

        let message = value.get("message").and_then(|m| m.as_object());
        let usage = message
            .and_then(|m| m.get("usage"))
            .and_then(|u| u.as_object());
        let content = message.and_then(|m| m.get("content"));

        let tool_calls = count_tool_uses(content);
        let input_tokens = as_int_opt(usage.and_then(|u| u.get("input_tokens")));
        let output_tokens = as_int_opt(usage.and_then(|u| u.get("output_tokens")));
        let cache_read = as_int_opt(usage.and_then(|u| u.get("cache_read_input_tokens")));
        let cache_write = as_int_opt(usage.and_then(|u| u.get("cache_creation_input_tokens")));

        // If there are no usage tokens AND no tool calls, only keep the row
        // if it's an actual user/assistant message; drop everything else
        // (system notes, tool_result echos, etc.).
        let has_any_signal = input_tokens > 0
            || output_tokens > 0
            || cache_read > 0
            || cache_write > 0
            || tool_calls > 0;
        if !has_any_signal {
            let row_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if row_type != "user" && row_type != "assistant" {
                return None;
            }
        }

        let session_id = value
            .get("sessionId")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| fallback_session_id.to_string());

        let event_type = value
            .get("type")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| "message".to_string());

        let model = message
            .and_then(|m| m.get("model"))
            .and_then(|v| v.as_str())
            .map(str::to_string);

        // cwd on the row overrides the inferred project_path. Empty string
        // falls through to the inferred path.
        let effective_project_path = value
            .get("cwd")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| project_path.map(str::to_string));

        let mut event = AgentEvent::new(Self::NAME, timestamp);
        event.project_path = effective_project_path;
        event.session_id = Some(session_id);
        event.event_type = event_type;
        event.usage.input_tokens = input_tokens;
        event.usage.output_tokens = output_tokens;
        event.usage.cache_read_tokens = cache_read;
        event.usage.cache_write_tokens = cache_write;
        event.tool_calls = tool_calls;
        event.model = model;
        event.raw_ref = Some(format!("{}:{}", path.display(), row.line_no));

        // Keep git_branch visible even when the source row has no branch.
        let branch_value = value
            .get("gitBranch")
            .and_then(|v| v.as_str())
            .map(|s| serde_json::Value::String(s.to_string()))
            .unwrap_or(serde_json::Value::Null);
        event
            .metadata
            .insert("git_branch".to_string(), branch_value);
        if let Some(uuid) = value.get("uuid").and_then(|v| v.as_str()) {
            event.metadata.insert(
                "uuid".to_string(),
                serde_json::Value::String(uuid.to_string()),
            );
        }

        event.normalize_totals();
        Some(event)
    }
}

impl Adapter for ClaudeCodeAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        Self::root(ctx).is_dir()
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let root = Self::root(ctx);
        let mut events = Vec::new();
        for (project_dir, session_path) in list_claude_session_files(&root) {
            let inferred_project_path = project_from_claude_dir(&project_dir);
            let session_id = session_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            events.extend(self.collect_session(
                &session_path,
                inferred_project_path.as_deref(),
                &session_id,
            ));
        }
        Ok(events)
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        let root = Self::root(ctx);
        if root.is_dir() {
            vec![root]
        } else {
            Vec::new()
        }
    }
}

/// Count `tool_use` / `server_tool_use` blocks in a message content array.
fn count_tool_uses(content: Option<&serde_json::Value>) -> u32 {
    let Some(items) = content.and_then(|v| v.as_array()) else {
        return 0;
    };
    let mut count = 0u32;
    for item in items {
        let Some(ty) = item.get("type").and_then(|v| v.as_str()) else {
            continue;
        };
        if ty == "tool_use" || ty == "server_tool_use" {
            count += 1;
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn write_fixture(dir: &Path, content: &str) -> PathBuf {
        let path = dir.join("session.jsonl");
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn parses_simple_assistant_message_with_usage() {
        let tmp = std::env::temp_dir().join(format!("lag-cc-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let row = json!({
            "timestamp": "2026-05-27T04:05:25Z",
            "type": "assistant",
            "sessionId": "abc-123",
            "cwd": "/Users/dipsy/Developer/pay-module",
            "gitBranch": "main",
            "message": {
                "model": "claude-sonnet-4-6",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "cache_read_input_tokens": 10,
                    "cache_creation_input_tokens": 5
                },
                "content": [
                    { "type": "tool_use", "name": "bash" },
                    { "type": "text", "text": "hi" }
                ]
            }
        });
        let path = write_fixture(&tmp, &format!("{}\n", row));
        let adapter = ClaudeCodeAdapter;
        let events = adapter.collect_session(&path, Some("/inferred/path"), "fallback-session");
        assert_eq!(events.len(), 1);
        let ev = &events[0];
        assert_eq!(ev.source, "claude-code");
        // cwd overrides inferred path
        assert_eq!(
            ev.project_path.as_deref(),
            Some("/Users/dipsy/Developer/pay-module")
        );
        assert_eq!(ev.session_id.as_deref(), Some("abc-123"));
        assert_eq!(ev.event_type, "assistant");
        assert_eq!(ev.usage.input_tokens, 100);
        assert_eq!(ev.usage.output_tokens, 50);
        assert_eq!(ev.usage.cache_read_tokens, 10);
        assert_eq!(ev.usage.cache_write_tokens, 5);
        assert_eq!(ev.usage.total_tokens, 165); // normalized sum
        assert_eq!(ev.tool_calls, 1);
        assert_eq!(ev.model.as_deref(), Some("claude-sonnet-4-6"));
        assert_eq!(
            ev.metadata.get("git_branch"),
            Some(&serde_json::Value::String("main".to_string()))
        );
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn skips_signal_less_non_message_rows() {
        // A row with no usage, no tool_calls, and type=system → must drop.
        let tmp = std::env::temp_dir().join(format!("lag-cc-skip-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let row = json!({
            "timestamp": "2026-05-27T04:05:25Z",
            "type": "system",
            "sessionId": "s"
        });
        let path = write_fixture(&tmp, &format!("{}\n", row));
        let adapter = ClaudeCodeAdapter;
        let events = adapter.collect_session(&path, None, "s");
        assert!(events.is_empty());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn keeps_user_or_assistant_rows_even_without_signal() {
        // A bare user/assistant ping (no tokens, no tools) still counts as
        // an event.
        let tmp = std::env::temp_dir().join(format!("lag-cc-keep-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let row = json!({
            "timestamp": "2026-05-27T04:05:25Z",
            "type": "user",
            "sessionId": "s"
        });
        let path = write_fixture(&tmp, &format!("{}\n", row));
        let adapter = ClaudeCodeAdapter;
        let events = adapter.collect_session(&path, None, "s");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].tool_calls, 0);
        assert_eq!(events[0].usage.total_tokens, 0);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn missing_timestamp_skips_row() {
        let tmp = std::env::temp_dir().join(format!("lag-cc-nots-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let row = json!({ "type": "assistant", "sessionId": "s" });
        let path = write_fixture(&tmp, &format!("{}\n", row));
        let adapter = ClaudeCodeAdapter;
        let events = adapter.collect_session(&path, None, "s");
        assert!(events.is_empty());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn discover_false_when_no_claude_dir() {
        let tmp = std::env::temp_dir().join(format!("lag-cc-nohome-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let ctx = AdapterContext::with_home(&tmp);
        let adapter = ClaudeCodeAdapter;
        assert!(!adapter.discover(&ctx));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn cwd_empty_falls_back_to_inferred_path() {
        let tmp = std::env::temp_dir().join(format!("lag-cc-cwd-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let row = json!({
            "timestamp": "2026-05-27T04:05:25Z",
            "type": "assistant",
            "cwd": "",
            "message": { "usage": { "input_tokens": 1 } }
        });
        let path = write_fixture(&tmp, &format!("{}\n", row));
        let adapter = ClaudeCodeAdapter;
        let events = adapter.collect_session(&path, Some("/inferred"), "s");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].project_path.as_deref(), Some("/inferred"));
        std::fs::remove_dir_all(&tmp).ok();
    }
}
