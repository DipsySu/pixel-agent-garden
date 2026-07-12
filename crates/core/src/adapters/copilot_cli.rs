//! GitHub Copilot CLI adapter — reads `~/.copilot/session-state/<session-id>/`.
//!
//! ## Paths read (read-only, never written)
//!
//! - `~/.copilot/session-state/<session-id>/events.jsonl` — the authoritative
//!   per-session event log. One usage `AgentEvent` is emitted per model in a
//!   session because Copilot's token counters are cumulative per-model
//!   buckets; combining them under `currentModel` would misprice model
//!   switches.
//! - `~/.copilot/session-state/<session-id>/workspace.yaml` — flat
//!   `key: value` session metadata (`cwd`, `branch`, `repository`),
//!   used only as a fallback when the event log carries no workspace path.
//!
//! `~/.copilot/session-store.db` (SQLite) is deliberately NOT read: it is a
//! derived cross-session index rebuildable from the session files, and the
//! token usage it would offer already exists in `events.jsonl`.
//!
//! ## Upstream evidence (verified 2026-07-11)
//!
//! - GitHub Docs, "Copilot CLI configuration directory reference"
//!   (<https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference>):
//!   `session-state/` holds per-session subdirectories, each with an event log
//!   `events.jsonl` plus workspace artifacts; `session-store.db` is the
//!   cross-session SQLite index.
//! - github/copilot-cli issue #3520
//!   (<https://github.com/github/copilot-cli/issues/3520>): the bundled
//!   `session-events.schema.json` requires `type`, `data`, `id`, `timestamp`,
//!   `parentId`, `ephemeral` on every event — and CLI 1.0.54 shipped events
//!   *without* `ephemeral`, so this parser treats every envelope field except
//!   `type`/`timestamp` as optional.
//! - github/copilot-cli issue #3551
//!   (<https://github.com/github/copilot-cli/issues/3551>): event-type
//!   inventory (`session.start` with version/cwd/model, `user.message`,
//!   `assistant.message`, `tool.execution_start`/`complete`,
//!   `session.shutdown`, `session.compaction_*`, …).
//! - DamianEdwards/copilot-cli-cost (`src/core/session-events.js` and
//!   `fixtures/events.sample.jsonl`, fetched from the `main` branch
//!   2026-07-11; secondary/community evidence): metrics live on any event
//!   whose `data.modelMetrics` object is present — in practice
//!   `session.shutdown` — shaped
//!   `data.modelMetrics.<model>.usage.{inputTokens, cacheReadTokens,
//!   cacheWriteTokens, outputTokens, reasoningTokens}` plus
//!   `data.modelMetrics.<model>.requests.count` and `data.currentModel`;
//!   `inputTokens` INCLUDES cached input (uncached = `inputTokens -
//!   cacheReadTokens`); `workspace.yaml` is flat YAML with `cwd` / `branch` /
//!   `repository` keys. Its prompt-derived `name` is deliberately excluded.
//! - copilot-token-tracker (PyPI page, read 2026-07-11; secondary evidence):
//!   confirms the same `data.modelMetrics.<model>.usage.*` paths and that CLI
//!   sessions carry *server-reported* token counts. VS Code's ordinary chat
//!   history has a different contract (exact tokens are available only via
//!   its opt-in OTel stream), so this adapter deliberately reads CLI data only.
//!
//! ## Token precision
//!
//! API-reported (server-side counts persisted by the CLI), NOT
//! client-estimated. Counters inside `data.modelMetrics` are CUMULATIVE
//! session totals — this adapter keeps the richest (largest bucket-sum)
//! metrics snapshot per session instead of summing progress/shutdown rows,
//! then emits its model buckets independently. `reasoningTokens` is
//! not folded into the billable buckets (its containment in `outputTokens`
//! is unverified upstream); it is surfaced in `metadata.reasoning_tokens`.
//! `requests.count` (premium-request units, not USD) goes to
//! `metadata.premium_requests`; `cost_usd` stays `None`.
//!
//! ## Dedupe key
//!
//! Usage events use the session id plus model id as `metadata.uuid`. Every
//! collect() emits identical field values for an unchanged session, while two
//! model buckets from the same session remain distinct.
//!
//! ## Time attribution
//!
//! A cumulative session snapshot has no per-request input/cache timestamps.
//! Events therefore use the real `session.start` timestamp and preserve the
//! reporting/end timestamps in metadata. If a session crosses a UTC date,
//! `daily_token_attribution=unavailable` keeps the real all-time/model totals
//! while preventing `aggregate::daily_tokens` from inventing a per-day split.

use crate::adapter::{Adapter, AdapterContext};
use crate::adapters::util::{JsonlRow, as_int_opt, parse_rfc3339_utc, read_jsonl};
use crate::error::Error;
use crate::event::{
    AgentEvent, DAILY_TOKEN_ATTRIBUTION_KEY, DAILY_TOKEN_ATTRIBUTION_UNAVAILABLE, TokenUsage,
};
use chrono::{DateTime, Utc};
use std::collections::{BTreeMap, btree_map::Entry};
use std::path::{Path, PathBuf};

pub struct CopilotCliAdapter;

impl CopilotCliAdapter {
    pub const NAME: &'static str = "copilot-cli";

    fn root(ctx: &AdapterContext) -> PathBuf {
        ctx.home.join(".copilot").join("session-state")
    }
}

impl Adapter for CopilotCliAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        Self::root(ctx).is_dir()
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let root = Self::root(ctx);
        let mut session_dirs: Vec<PathBuf> = match std::fs::read_dir(&root) {
            Ok(entries) => entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect(),
            Err(_) => Vec::new(),
        };
        session_dirs.sort();

        let mut events = Vec::new();
        for dir in session_dirs {
            events.extend(parse_session_dir(&dir));
        }
        Ok(events)
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        // The smallest stable set: session directories are created inside
        // `session-state/`, so watching the one root covers new sessions and
        // appended events alike.
        let root = Self::root(ctx);
        if root.is_dir() {
            vec![root]
        } else {
            Vec::new()
        }
    }
}

/// One source-reported model bucket inside a cumulative metrics snapshot.
#[derive(Default, Clone)]
struct ModelMetrics {
    usage: TokenUsage,
    reasoning_tokens: u64,
    premium_requests: u64,
}

impl ModelMetrics {
    fn weight(&self) -> u64 {
        self.usage
            .input_tokens
            .saturating_add(self.usage.output_tokens)
            .saturating_add(self.usage.cache_read_tokens)
            .saturating_add(self.usage.cache_write_tokens)
            .saturating_add(self.reasoning_tokens)
    }
}

/// Cumulative per-session, per-model token buckets extracted from one event.
#[derive(Default, Clone)]
struct SessionMetrics {
    models: BTreeMap<String, ModelMetrics>,
    current_model: Option<String>,
    reported_at: Option<DateTime<Utc>>,
}

impl SessionMetrics {
    /// Ordering weight mirroring copilot-cli-cost's "richest metrics event"
    /// selection: counters are cumulative, so the event with the largest
    /// bucket-sum supersedes earlier progress rows.
    fn weight(&self) -> u64 {
        self.models
            .values()
            .map(ModelMetrics::weight)
            .fold(0, u64::saturating_add)
    }
}

/// Aggregate one `session-state/<id>/` directory into a single event.
/// Returns no events when the directory has no parsable event log (no
/// `events.jsonl`, or no row with a valid timestamp).
fn parse_session_dir(dir: &Path) -> Vec<AgentEvent> {
    let events_path = dir.join("events.jsonl");
    let Some(session_id) = dir
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
    else {
        return Vec::new();
    };

    let mut first_ts: Option<DateTime<Utc>> = None;
    let mut last_ts: Option<DateTime<Utc>> = None;
    let mut session_start_ts: Option<DateTime<Utc>> = None;
    let mut session_start_cwd: Option<String> = None;
    let mut generic_event_cwd: Option<String> = None;
    let mut cli_version: Option<String> = None;
    let mut start_model: Option<String> = None;
    let mut last_model: Option<String> = None;
    let mut tool_calls: u32 = 0;
    let mut best_metrics: Option<SessionMetrics> = None;
    let mut saw_row = false;

    for JsonlRow { value, .. } in read_jsonl(&events_path) {
        saw_row = true;
        let row_ts = value
            .get("timestamp")
            .and_then(|s| s.as_str())
            .and_then(parse_rfc3339_utc);
        if let Some(ts) = row_ts {
            first_ts = Some(first_ts.map_or(ts, |first| first.min(ts)));
            last_ts = Some(last_ts.map_or(ts, |last| last.max(ts)));
        }
        let event_type = value.get("type").and_then(|s| s.as_str()).unwrap_or("");
        let data = value.get("data");

        if event_type == "session.start" {
            session_start_ts = row_ts.or(session_start_ts);
            if let Some(d) = data {
                session_start_cwd = session_start_cwd.or_else(|| extract_workspace_dir(d));
                cli_version = cli_version.or_else(|| {
                    ["copilotVersion", "version", "cliVersion"]
                        .iter()
                        .find_map(|k| d.get(k).and_then(|v| v.as_str()))
                        .map(str::to_string)
                });
                start_model = start_model
                    .or_else(|| d.get("model").and_then(|v| v.as_str()).map(str::to_string));
            }
        } else if event_type == "session.model_change" {
            last_model = data
                .and_then(|d| d.get("newModel"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .or(last_model);
        } else if matches!(event_type, "assistant.turn_start" | "assistant.message") {
            last_model = data
                .and_then(|d| d.get("model"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .or(last_model);
        } else if event_type == "tool.execution_start" {
            tool_calls = tool_calls.saturating_add(1);
        }

        if let Some(d) = data {
            if event_type != "session.start" {
                generic_event_cwd = generic_event_cwd.or_else(|| extract_workspace_dir(d));
            }
            if let Some(mut metrics) = extract_metrics(d) {
                metrics.reported_at = row_ts;
                let better = best_metrics
                    .as_ref()
                    .is_none_or(|prev| metrics.weight() >= prev.weight());
                if better {
                    best_metrics = Some(metrics);
                }
            }
        }
    }

    if !saw_row {
        return Vec::new();
    }
    let Some(timestamp) = session_start_ts.or(first_ts) else {
        return Vec::new();
    };
    let session_end = last_ts.unwrap_or(timestamp);

    // Fallback workspace metadata: `workspace.yaml` sits next to the event
    // log inside the same session dir (still a primary session file, not the
    // derived SQLite index).
    let workspace = parse_workspace_yaml(&dir.join("workspace.yaml"));

    // A session.start path is the event log's authoritative workspace. The
    // dedicated workspace snapshot is the next-best source. Other event cwd
    // fields are only a compatibility fallback and must never override either.
    let workspace_path = session_start_cwd
        .or_else(|| workspace.get("cwd").cloned())
        .or(generic_event_cwd)
        .filter(|s| !s.is_empty());
    let metrics = best_metrics.unwrap_or_default();
    let current_model = metrics.current_model.clone().or(last_model).or(start_model);
    let spans_utc_days = timestamp.date_naive() != session_end.date_naive();

    if metrics.models.is_empty() {
        let mut event = AgentEvent::new(CopilotCliAdapter::NAME, timestamp);
        event.session_id = Some(session_id.clone());
        event.event_type = "session".to_string();
        event.project_path = workspace_path;
        event.tool_calls = tool_calls;
        event.model = current_model;
        event.raw_ref = Some(events_path.display().to_string());
        add_common_metadata(
            &mut event,
            &session_id,
            None,
            cli_version.as_deref(),
            &workspace,
            timestamp,
            session_end,
            None,
            false,
        );
        return vec![event];
    }

    let tool_owner = current_model
        .as_ref()
        .filter(|model| metrics.models.contains_key(*model))
        .cloned()
        .or_else(|| metrics.models.keys().next().cloned());
    let model_count = metrics.models.len();
    let mut events = Vec::with_capacity(model_count);
    for (model, per_model) in metrics.models {
        let mut event = AgentEvent::new(CopilotCliAdapter::NAME, timestamp);
        event.session_id = Some(session_id.clone());
        event.event_type = "session".to_string();
        event.project_path = workspace_path.clone();
        event.usage = per_model.usage;
        event.model = Some(model.clone());
        event.tool_calls = if tool_owner.as_deref() == Some(model.as_str()) {
            tool_calls
        } else {
            0
        };
        event.raw_ref = Some(format!("{}#model:{model}", events_path.display()));
        add_common_metadata(
            &mut event,
            &session_id,
            Some(&model),
            cli_version.as_deref(),
            &workspace,
            timestamp,
            session_end,
            metrics.reported_at,
            spans_utc_days,
        );
        event.metadata.insert(
            "reasoning_tokens".into(),
            serde_json::Value::from(per_model.reasoning_tokens),
        );
        event.metadata.insert(
            "premium_requests".into(),
            serde_json::Value::from(per_model.premium_requests),
        );
        event.metadata.insert(
            "session_model_count".into(),
            serde_json::Value::from(model_count as u64),
        );
        event.normalize_totals();
        events.push(event);
    }
    events
}

#[allow(clippy::too_many_arguments)]
fn add_common_metadata(
    event: &mut AgentEvent,
    session_id: &str,
    model: Option<&str>,
    cli_version: Option<&str>,
    workspace: &BTreeMap<String, String>,
    session_start: DateTime<Utc>,
    session_end: DateTime<Utc>,
    usage_reported_at: Option<DateTime<Utc>>,
    spans_utc_days: bool,
) {
    let uuid = model.map_or_else(
        || format!("session:{session_id}:activity"),
        |model| format!("session:{session_id}:model:{model}"),
    );
    event.metadata.insert("uuid".into(), uuid.into());
    event.metadata.insert(
        "cli_version".into(),
        cli_version
            .map(|value| value.to_string().into())
            .unwrap_or(serde_json::Value::Null),
    );
    event.metadata.insert(
        "git_branch".into(),
        opt_string_value(workspace.get("branch")),
    );
    event.metadata.insert(
        "repository".into(),
        opt_string_value(workspace.get("repository")),
    );
    event
        .metadata
        .insert("usage_scope".into(), "session_cumulative".into());
    event
        .metadata
        .insert("timestamp_basis".into(), "session_start".into());
    event.metadata.insert(
        "session_started_at".into(),
        session_start.to_rfc3339().into(),
    );
    event
        .metadata
        .insert("session_ended_at".into(), session_end.to_rfc3339().into());
    event.metadata.insert(
        "usage_reported_at".into(),
        usage_reported_at
            .map(|ts| ts.to_rfc3339().into())
            .unwrap_or(serde_json::Value::Null),
    );
    if spans_utc_days {
        event.metadata.insert(
            DAILY_TOKEN_ATTRIBUTION_KEY.into(),
            DAILY_TOKEN_ATTRIBUTION_UNAVAILABLE.into(),
        );
    }
}

fn opt_string_value(v: Option<&String>) -> serde_json::Value {
    v.filter(|s| !s.is_empty())
        .map(|s| serde_json::Value::String(s.clone()))
        .unwrap_or(serde_json::Value::Null)
}

/// Workspace path from an event's `data` object. Key spellings vary across
/// CLI versions (observed leniency in copilot-cli-cost): `cwd`,
/// `workspaceDirectory`, or nested `workspace.current_dir`.
fn extract_workspace_dir(data: &serde_json::Value) -> Option<String> {
    for key in ["cwd", "workspaceDirectory"] {
        if let Some(s) = data.get(key).and_then(|v| v.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    for (object, key) in [("context", "cwd"), ("workspace", "current_dir")] {
        if let Some(value) = data
            .get(object)
            .and_then(|nested| nested.get(key))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            return Some(value.to_string());
        }
    }
    None
}

/// Read `data.modelMetrics` (cumulative per-model buckets) from a metrics
/// event. Returns None when the object is absent, so ordinary message/tool
/// events pass through untouched.
///
/// Copilot follows the OpenAI convention where `inputTokens` INCLUDES cached
/// input; the garden prices billable buckets, so cached input moves to
/// `cache_read_tokens` and is subtracted from `input_tokens`.
fn extract_metrics(data: &serde_json::Value) -> Option<SessionMetrics> {
    let model_metrics = data.get("modelMetrics")?.as_object()?;
    let mut metrics = SessionMetrics {
        current_model: data
            .get("currentModel")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        ..SessionMetrics::default()
    };
    for (model, per_model) in model_metrics {
        let usage = per_model.get("usage");
        let raw_input = as_int_opt(usage.and_then(|u| u.get("inputTokens")));
        let cache_read = as_int_opt(usage.and_then(|u| u.get("cacheReadTokens")));
        let bucket = ModelMetrics {
            usage: TokenUsage {
                input_tokens: raw_input.saturating_sub(cache_read),
                output_tokens: as_int_opt(usage.and_then(|u| u.get("outputTokens"))),
                cache_read_tokens: cache_read,
                cache_write_tokens: as_int_opt(usage.and_then(|u| u.get("cacheWriteTokens"))),
                total_tokens: 0,
            },
            reasoning_tokens: as_int_opt(usage.and_then(|u| u.get("reasoningTokens"))),
            premium_requests: as_int_opt(per_model.get("requests").and_then(|r| r.get("count"))),
        };
        match metrics.models.entry(model.clone()) {
            Entry::Vacant(entry) => {
                entry.insert(bucket);
            }
            Entry::Occupied(mut entry) if bucket.weight() >= entry.get().weight() => {
                entry.insert(bucket);
            }
            Entry::Occupied(_) => {}
        }
    }
    Some(metrics)
}

/// Minimal flat `key: value` YAML reader for `workspace.yaml`. Only structural
/// workspace fields are retained. In particular, `name` is an automatically
/// generated summary of the prompt when `user_named: false`, so retaining it
/// would copy conversation semantics into the garden cache.
fn parse_workspace_yaml(path: &Path) -> std::collections::BTreeMap<String, String> {
    let mut out = std::collections::BTreeMap::new();
    let Ok(raw) = std::fs::read_to_string(path) else {
        return out;
    };
    for line in raw.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if !matches!(key, "cwd" | "branch" | "repository") {
            continue;
        }
        let value = unquote(value.trim());
        if !value.is_empty() {
            out.insert(key.to_string(), value);
        }
    }
    out
}

fn unquote(v: &str) -> String {
    let stripped = v
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .or_else(|| v.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')));
    stripped.unwrap_or(v).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn session_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("lag-copilot-{tag}-{}", std::process::id()))
            .join(".copilot")
            .join("session-state")
            .join("0198c5a1-aaaa-bbbb-cccc-1234567890ab");
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn home_of(dir: &Path) -> PathBuf {
        // dir = <home>/.copilot/session-state/<id>
        dir.ancestors().nth(3).unwrap().to_path_buf()
    }

    fn cleanup(dir: &Path) {
        std::fs::remove_dir_all(home_of(dir)).ok();
    }

    /// Fixture 1 — redacted from a real local Copilot CLI 1.0.70 session on
    /// 2026-07-11. Prompt/tool payloads and the real cwd/session id are
    /// replaced, while envelope keys and API-reported metrics stay exact.
    fn write_modern_fixture(dir: &Path) {
        let rows = [
            json!({
                "type": "session.start",
                "id": "e-1", "parentId": null, "ephemeral": false,
                "timestamp": "2026-07-10T23:53:26.680Z",
                "data": {
                    "version": "1",
                    "copilotVersion": "1.0.70",
                    "context": { "cwd": "/Users/demo/dev/garden" }
                }
            }),
            json!({
                "type": "user.message",
                "id": "e-2", "parentId": null, "ephemeral": false,
                "timestamp": "2026-07-10T23:53:31.000Z",
                "data": { "content": "do the thing" }
            }),
            json!({
                "type": "tool.execution_start",
                "id": "e-3", "parentId": "e-2", "ephemeral": false,
                "timestamp": "2026-07-10T23:53:36.000Z",
                "data": { "toolName": "bash", "model": "gpt-5-mini", "arguments": {} }
            }),
            json!({
                "type": "tool.execution_complete",
                "id": "e-4", "parentId": "e-3", "ephemeral": false,
                "timestamp": "2026-07-10T23:53:38.000Z",
                "data": { "success": true }
            }),
            json!({
                "type": "tool.execution_start",
                "id": "e-5", "parentId": "e-2", "ephemeral": false,
                "timestamp": "2026-07-10T23:54:20.000Z",
                "data": { "toolName": "str_replace_editor", "model": "gpt-5-mini", "arguments": {} }
            }),
            json!({
                "type": "session.shutdown",
                "id": "e-6", "parentId": null, "ephemeral": false,
                "timestamp": "2026-07-10T23:58:18.191Z",
                "data": {
                    "currentModel": "gpt-5-mini",
                    "modelMetrics": {
                        "gpt-5-mini": {
                            "requests": { "count": 3 },
                            "usage": {
                                "inputTokens": 40377,
                                "cacheReadTokens": 26496,
                                "cacheWriteTokens": 0,
                                "outputTokens": 335,
                                "reasoningTokens": 128
                            }
                        }
                    }
                }
            }),
        ]
        .into_iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        std::fs::write(dir.join("events.jsonl"), format!("{rows}\n")).unwrap();
    }

    /// Fixture 2 — CLI 1.0.54-era shape (issue #3520): events written WITHOUT
    /// the schema-required `ephemeral`/`id`/`parentId` fields, no metrics
    /// event (session never shut down cleanly), workspace path only available
    /// via `workspace.yaml`. Must yield an activity-only event.
    fn write_legacy_fixture(dir: &Path) {
        let rows = [
            json!({
                "type": "session.start",
                "timestamp": "2026-04-01T09:00:00.000Z",
                "data": {}
            }),
            json!({
                "type": "tool.execution_start",
                "timestamp": "2026-04-01T09:00:05.000Z",
                "data": { "toolName": "grep" }
            }),
            json!({
                "type": "assistant.message",
                "timestamp": "2026-04-01T09:00:09.000Z",
                "data": { "content": "done" }
            }),
        ]
        .into_iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        std::fs::write(dir.join("events.jsonl"), format!("{rows}\n")).unwrap();
        std::fs::write(
            dir.join("workspace.yaml"),
            "id: 0198c5a1-aaaa-bbbb-cccc-1234567890ab\n\
             name: \"SECRET prompt-derived name\"\n\
             cwd: /Users/demo/dev/legacy-project\n\
             repository: demo/legacy-project\n\
             branch: main\n",
        )
        .unwrap();
    }

    #[test]
    fn modern_session_reports_cumulative_server_side_usage() {
        let dir = session_dir("modern");
        write_modern_fixture(&dir);

        let events = parse_session_dir(&dir);
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.source, "copilot-cli");
        assert_eq!(
            event.session_id.as_deref(),
            Some("0198c5a1-aaaa-bbbb-cccc-1234567890ab")
        );
        assert_eq!(event.event_type, "session");
        assert_eq!(
            event.project_path.as_deref(),
            Some("/Users/demo/dev/garden")
        );
        assert_eq!(event.model.as_deref(), Some("gpt-5-mini"));
        assert_eq!(event.tool_calls, 2);
        // inputTokens includes cached input → uncached = 40377 - 26496.
        assert_eq!(event.usage.input_tokens, 13881);
        assert_eq!(event.usage.cache_read_tokens, 26496);
        assert_eq!(event.usage.cache_write_tokens, 0);
        assert_eq!(event.usage.output_tokens, 335);
        // reasoningTokens (128) is NOT folded into the billable buckets.
        assert_eq!(event.usage.total_tokens, 13881 + 26496 + 335);
        assert_eq!(
            event.metadata.get("reasoning_tokens"),
            Some(&serde_json::Value::from(128u64))
        );
        assert_eq!(
            event.metadata.get("premium_requests"),
            Some(&serde_json::Value::from(3u64))
        );
        assert_eq!(
            event.metadata.get("cli_version"),
            Some(&serde_json::Value::String("1.0.70".into()))
        );
        // Session-level cumulative usage is anchored to the real start time;
        // the later report time remains explicit metadata.
        assert_eq!(
            event.timestamp,
            parse_rfc3339_utc("2026-07-10T23:53:26.680Z").unwrap()
        );
        assert_eq!(
            event.metadata.get("usage_reported_at"),
            Some(&json!("2026-07-10T23:58:18.191+00:00"))
        );

        cleanup(&dir);
    }

    #[test]
    fn legacy_session_without_metrics_is_activity_only() {
        let dir = session_dir("legacy");
        write_legacy_fixture(&dir);

        let events = parse_session_dir(&dir);
        assert_eq!(events.len(), 1);
        let event = &events[0];
        // No metrics event → zero usage, but the session still shows life.
        assert_eq!(event.usage.total_tokens, 0);
        assert_eq!(event.tool_calls, 1);
        assert!(event.model.is_none());
        // cwd falls back to workspace.yaml.
        assert_eq!(
            event.project_path.as_deref(),
            Some("/Users/demo/dev/legacy-project")
        );
        assert_eq!(
            event.metadata.get("git_branch"),
            Some(&serde_json::Value::String("main".into()))
        );
        assert!(!event.metadata.contains_key("title"));
        assert!(
            !serde_json::to_string(event)
                .unwrap()
                .contains("SECRET prompt-derived name")
        );
        assert_eq!(
            event.metadata.get("cli_version"),
            Some(&serde_json::Value::Null)
        );

        cleanup(&dir);
    }

    #[test]
    fn session_start_workspace_path_overrides_earlier_generic_event() {
        let dir = session_dir("path-session-start");
        let early = json!({
            "type": "system.message",
            "timestamp": "2026-05-06T10:59:59.000Z",
            "data": { "cwd": "/untrusted/early-event" }
        });
        let start = json!({
            "type": "session.start",
            "timestamp": "2026-05-06T11:00:00.000Z",
            "data": { "context": { "cwd": "/authoritative/session-start" } }
        });
        std::fs::write(dir.join("events.jsonl"), format!("{early}\n{start}\n")).unwrap();
        std::fs::write(
            dir.join("workspace.yaml"),
            "cwd: /authoritative/workspace-snapshot\n",
        )
        .unwrap();

        let events = parse_session_dir(&dir);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].project_path.as_deref(),
            Some("/authoritative/session-start")
        );
        cleanup(&dir);
    }

    #[test]
    fn workspace_snapshot_overrides_generic_event_when_start_has_no_path() {
        let dir = session_dir("path-workspace-snapshot");
        let early = json!({
            "type": "system.message",
            "timestamp": "2026-05-06T10:59:59.000Z",
            "data": { "cwd": "/untrusted/early-event" }
        });
        let start = json!({
            "type": "session.start",
            "timestamp": "2026-05-06T11:00:00.000Z",
            "data": {}
        });
        std::fs::write(dir.join("events.jsonl"), format!("{early}\n{start}\n")).unwrap();
        std::fs::write(
            dir.join("workspace.yaml"),
            "cwd: /authoritative/workspace-snapshot\n",
        )
        .unwrap();

        let events = parse_session_dir(&dir);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].project_path.as_deref(),
            Some("/authoritative/workspace-snapshot")
        );
        cleanup(&dir);
    }

    #[test]
    fn generic_event_workspace_is_last_resort() {
        let dir = session_dir("path-generic-fallback");
        let start = json!({
            "type": "session.start",
            "timestamp": "2026-05-06T11:00:00.000Z",
            "data": {}
        });
        let later = json!({
            "type": "system.message",
            "timestamp": "2026-05-06T11:00:01.000Z",
            "data": { "workspaceDirectory": "/compatibility/generic-event" }
        });
        std::fs::write(dir.join("events.jsonl"), format!("{start}\n{later}\n")).unwrap();

        let events = parse_session_dir(&dir);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].project_path.as_deref(),
            Some("/compatibility/generic-event")
        );
        cleanup(&dir);
    }

    #[test]
    fn corrupt_lines_are_skipped_without_error() {
        let dir = session_dir("corrupt");
        let good = json!({
            "type": "session.start",
            "timestamp": "2026-05-06T11:00:00.000Z",
            "data": { "cwd": "/Users/demo/dev/garden" }
        });
        let metrics = json!({
            "type": "session.shutdown",
            "timestamp": "2026-05-06T12:00:00.000Z",
            "data": { "modelMetrics": { "gpt-5.5": { "usage": { "inputTokens": 10, "outputTokens": 5 } } } }
        });
        std::fs::write(
            dir.join("events.jsonl"),
            format!("{good}\n{{truncated-json,,,\nnot json at all\n{metrics}\n"),
        )
        .unwrap();

        let events = parse_session_dir(&dir);
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(
            event.project_path.as_deref(),
            Some("/Users/demo/dev/garden")
        );
        assert_eq!(event.usage.input_tokens, 10);
        assert_eq!(event.usage.output_tokens, 5);
        assert_eq!(event.usage.total_tokens, 15);

        cleanup(&dir);
    }

    #[test]
    fn cumulative_metrics_are_not_summed_across_events() {
        // Two metrics events (mid-session progress + final shutdown) carry
        // CUMULATIVE counters; the session must report the richest one, not
        // the sum (which would double-count every earlier turn).
        let dir = session_dir("cumulative");
        let progress = json!({
            "type": "session.compaction_complete",
            "timestamp": "2026-05-06T11:30:00.000Z",
            "data": { "modelMetrics": { "gpt-5.5": { "usage": { "inputTokens": 100, "outputTokens": 10 } } } }
        });
        let shutdown = json!({
            "type": "session.shutdown",
            "timestamp": "2026-05-06T12:00:00.000Z",
            "data": {
                "currentModel": "gpt-5.5",
                "modelMetrics": { "gpt-5.5": {
                    "requests": { "count": 3 },
                    "usage": { "inputTokens": 250, "outputTokens": 40 }
                } }
            }
        });
        std::fs::write(
            dir.join("events.jsonl"),
            format!("{progress}\n{shutdown}\n"),
        )
        .unwrap();

        let events = parse_session_dir(&dir);
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.usage.input_tokens, 250);
        assert_eq!(event.usage.output_tokens, 40);
        assert_eq!(event.usage.total_tokens, 290);

        cleanup(&dir);
    }

    #[test]
    fn multi_model_cross_day_session_keeps_real_buckets_without_fake_day() {
        let dir = session_dir("multi-model-cross-day");
        let start = json!({
            "type": "session.start",
            "timestamp": "2026-05-06T23:55:00.000Z",
            "data": {
                "copilotVersion": "1.0.70",
                "context": { "cwd": "/Users/demo/dev/garden" }
            }
        });
        let tool = json!({
            "type": "tool.execution_start",
            "timestamp": "2026-05-07T00:01:00.000Z",
            "data": { "model": "gpt-5-mini", "toolName": "bash" }
        });
        let shutdown = json!({
            "type": "session.shutdown",
            "timestamp": "2026-05-07T00:05:00.000Z",
            "data": {
                "currentModel": "gpt-5-mini",
                "modelMetrics": {
                    "claude-sonnet-4-6": {
                        "requests": { "count": 1 },
                        "usage": {
                            "inputTokens": 1000, "cacheReadTokens": 400,
                            "outputTokens": 80, "reasoningTokens": 20
                        }
                    },
                    "gpt-5-mini": {
                        "requests": { "count": 2 },
                        "usage": {
                            "inputTokens": 2000, "cacheReadTokens": 1500,
                            "outputTokens": 120, "reasoningTokens": 30
                        }
                    }
                }
            }
        });
        std::fs::write(
            dir.join("events.jsonl"),
            format!("{start}\n{tool}\n{shutdown}\n"),
        )
        .unwrap();

        let events = parse_session_dir(&dir);
        assert_eq!(events.len(), 2);
        let claude = events
            .iter()
            .find(|event| event.model.as_deref() == Some("claude-sonnet-4-6"))
            .unwrap();
        let gpt = events
            .iter()
            .find(|event| event.model.as_deref() == Some("gpt-5-mini"))
            .unwrap();

        assert_eq!(claude.usage.input_tokens, 600);
        assert_eq!(claude.usage.cache_read_tokens, 400);
        assert_eq!(claude.usage.output_tokens, 80);
        assert_eq!(gpt.usage.input_tokens, 500);
        assert_eq!(gpt.usage.cache_read_tokens, 1500);
        assert_eq!(gpt.usage.output_tokens, 120);
        assert_eq!(claude.tool_calls + gpt.tool_calls, 1);
        assert_eq!(gpt.tool_calls, 1);
        assert_eq!(
            claude.timestamp,
            parse_rfc3339_utc("2026-05-06T23:55:00.000Z").unwrap()
        );
        assert_eq!(
            claude.metadata.get(DAILY_TOKEN_ATTRIBUTION_KEY),
            Some(&json!(DAILY_TOKEN_ATTRIBUTION_UNAVAILABLE))
        );
        assert_ne!(
            claude.metadata.get("uuid"),
            gpt.metadata.get("uuid"),
            "per-model rows must survive scan dedupe"
        );

        cleanup(&dir);
    }

    #[test]
    fn dedupe_key_inputs_are_stable_across_rescans() {
        // scan.rs's fallback row key is built from source, timestamp,
        // project, session_id, event_type, total_tokens, and raw_ref. Two
        // collects over an unchanged session dir must produce identical
        // events so re-scans dedupe to one row.
        let dir = session_dir("dedupe");
        write_modern_fixture(&dir);
        let ctx = AdapterContext::with_home(home_of(&dir));

        let first = CopilotCliAdapter.collect(&ctx).unwrap();
        let second = CopilotCliAdapter.collect(&ctx).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first, second);

        cleanup(&dir);
    }

    #[test]
    fn discover_and_watch_paths_track_session_state_dir() {
        let dir = session_dir("disc");
        let home = home_of(&dir);
        let ctx = AdapterContext::with_home(&home);
        assert!(CopilotCliAdapter.discover(&ctx));
        assert_eq!(
            CopilotCliAdapter.watch_paths(&ctx),
            vec![home.join(".copilot").join("session-state")]
        );

        let empty = std::env::temp_dir().join(format!("lag-copilot-empty-{}", std::process::id()));
        std::fs::create_dir_all(&empty).unwrap();
        let empty_ctx = AdapterContext::with_home(&empty);
        assert!(!CopilotCliAdapter.discover(&empty_ctx));
        assert!(CopilotCliAdapter.watch_paths(&empty_ctx).is_empty());
        std::fs::remove_dir_all(&empty).ok();

        cleanup(&dir);
    }

    #[test]
    fn session_dir_without_events_log_is_skipped() {
        let dir = session_dir("noevents");
        // Directory exists but holds no events.jsonl (e.g. a fresh session
        // that never wrote a log) → no event, no error.
        assert!(parse_session_dir(&dir).is_empty());
        cleanup(&dir);
    }
}
