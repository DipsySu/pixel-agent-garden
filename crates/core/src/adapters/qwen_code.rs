//! Qwen Code adapter — reads persisted local chat recordings without touching
//! authentication, settings, prompts, responses, or debug logs.
//!
//! ## Upstream contract
//!
//! Verified against `QwenLM/qwen-code` commit
//! `8e6a57256297685761bb0554bd3458f05218399e` (package version `0.19.9`,
//! 2026-07-11):
//!
//! - `packages/core/src/services/chatRecordingService.ts` defines append-only
//!   `ChatRecord` JSONL rows. Each row has `uuid`, `parentUuid`, `sessionId`,
//!   `timestamp`, `type`, `cwd`, `version`, and optional `usageMetadata`,
//!   `model`, subagent fields, or `forkedFrom`. Formal recordings are
//!   `<runtime-base>/projects/<sanitized-cwd>/chats/<session-id>.jsonl`: this
//!   follows the executable `getProjectDir()` → `ensureChatsDir()` →
//!   `ensureConversationFile()` → `jsonl.writeLine()` path. Two nearby class
//!   comments still mention `tmp/`; those comments are stale and contradict
//!   the code that actually creates and resumes recordings.
//! - `packages/core/src/config/storage.ts` chooses the runtime base in this
//!   order: `QWEN_RUNTIME_DIR`, configured `advanced.runtimeOutputDir`, then
//!   the global Qwen directory. The global directory is `QWEN_HOME` when set,
//!   otherwise `<home>/.qwen`. `AdapterContext` currently carries neither
//!   Qwen override, so this adapter deliberately does not inspect process
//!   environment and scans only `<ctx.home>/.qwen`.
//! - On macOS/Linux that default is `~/.qwen`; on Windows it is
//!   `%USERPROFILE%\.qwen` (the platform home is already captured in
//!   `AdapterContext.home`). Qwen uses the same `projects/.../chats` layout
//!   below that root on every platform.
//! - Tags `v0.1.0` through `v0.3.0` used whole-file
//!   `ConversationRecord` JSON at
//!   `~/.qwen/tmp/<sha256-project-hash>/chats/session-*.json`. Version `v0.4.0`
//!   introduced the current tree-shaped JSONL schema and `projects/` layout.
//!   Old files can remain after an upgrade, so both layouts are read and a
//!   `(sessionId, message uuid)` collision prefers JSONL over legacy JSON.
//!
//! ## Token semantics
//!
//! Only persisted source counters are used; text is never tokenized or
//! estimated by this adapter. `recordAssistantTurn` copies the
//! provider-normalized
//! `GenerateContentResponseUsageMetadata` directly to the row. Qwen's own
//! `getUsageOutputTokenCountForPromptEstimate` treats
//! `totalTokenCount - promptTokenCount` as the unambiguous output total when
//! both are present because `thoughtsTokenCount` may overlap
//! `candidatesTokenCount` for OpenAI-compatible providers. This adapter uses
//! the same authoritative subtraction; without `totalTokenCount`, it keeps
//! `candidatesTokenCount` and exposes thoughts separately instead of guessing.
//! `cachedContentTokenCount` is contained in `promptTokenCount`, so cached
//! input is split into `cache_read_tokens` and subtracted from
//! `input_tokens`. Qwen folds Anthropic cache-creation input into the prompt
//! total and does not persist a distinct cache-write field, therefore
//! `cache_write_tokens` remains zero. `toolUsePromptTokenCount` and raw
//! thought counts are preserved in metadata. The persisted total is retained,
//! clamped only for internally inconsistent rows so downstream arithmetic
//! cannot underflow. Qwen's OpenAI converter can itself synthesize a 70/30
//! prompt/completion split when a provider returns only a total, so precision
//! is labelled `source_reported`, not `exact_api`; the adapter never adds a
//! second estimate.
//!
//! ## Dedupe, lineage, and privacy
//!
//! `metadata.uuid` is the native logical-message UUID; scan dedupe combines it
//! with source and session. Duplicate physical rows with the same UUID (Qwen
//! merges such fragments on resume) are collapsed without summing usage.
//! `/branch` copies carry `forkedFrom`; those inherited records are skipped so
//! already-consumed parent usage is not counted again, while genuinely new
//! child/subagent records remain visible. `parent_session`, `agentId`,
//! `agentName`, and `isSidechain` are retained only as non-content metadata.
//!
//! Recordings necessarily contain conversation content, but this module only
//! projects the allowlisted structural and usage fields described above. It
//! never enumerates or opens `settings.json`, `.env`, OAuth/API-key files,
//! `logs.json`, debug files, runtime status JSON, worktree sidecars, or any
//! path outside `projects/*/chats` and legacy `tmp/*/chats`. Source directories
//! are read-only and symlinked directories are not followed.

use crate::adapter::{Adapter, AdapterContext};
use crate::error::Error;
use crate::event::AgentEvent;
use chrono::{DateTime, Utc};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

pub struct QwenCodeAdapter;

impl QwenCodeAdapter {
    pub const NAME: &'static str = "qwen-code";

    fn root(ctx: &AdapterContext) -> PathBuf {
        // Do not read QWEN_HOME/QWEN_RUNTIME_DIR from the process environment:
        // they are not captured by AdapterContext and would make fixture scans
        // depend on ambient mutable global state.
        ctx.home.join(".qwen")
    }

    fn projects_root(ctx: &AdapterContext) -> PathBuf {
        Self::root(ctx).join("projects")
    }

    fn legacy_tmp_root(ctx: &AdapterContext) -> PathBuf {
        Self::root(ctx).join("tmp")
    }
}

impl Adapter for QwenCodeAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        has_recordings(&Self::projects_root(ctx), Layout::Current)
            || has_recordings(&Self::legacy_tmp_root(ctx), Layout::Legacy)
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let mut candidates = Vec::new();

        collect_layout(&Self::projects_root(ctx), Layout::Current, &mut candidates);
        collect_layout(&Self::legacy_tmp_root(ctx), Layout::Legacy, &mut candidates);

        Ok(dedupe_candidates(candidates))
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        // Watch only the two recording roots. In particular, never watch the
        // broader ~/.qwen directory because it also contains credentials and
        // settings unrelated to scan activity.
        [Self::projects_root(ctx), Self::legacy_tmp_root(ctx)]
            .into_iter()
            .filter(|path| path.is_dir())
            .collect()
    }
}

fn has_recordings(root: &Path, layout: Layout) -> bool {
    child_directories(root)
        .into_iter()
        .any(|project| !recording_files(&project.join("chats"), layout).is_empty())
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum Layout {
    Legacy,
    Current,
}

#[derive(Clone)]
struct Candidate {
    event: AgentEvent,
    layout: Layout,
    richness: u64,
}

fn collect_layout(root: &Path, layout: Layout, out: &mut Vec<Candidate>) {
    for project_dir in child_directories(root) {
        let chats_dir = project_dir.join("chats");
        for path in recording_files(&chats_dir, layout) {
            match path.extension().and_then(|ext| ext.to_str()) {
                Some("jsonl") => collect_jsonl(&path, layout, out),
                Some("json") if layout == Layout::Legacy => collect_legacy_json(&path, out),
                _ => {}
            }
        }
    }
}

/// Direct child directories without following symlinks.
fn child_directories(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut paths = entries
        .flatten()
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|kind| kind.is_dir() && !kind.is_symlink())
                .map(|_| entry.path())
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

/// Current files live directly under `chats/` (plus `archive/`). Limit the
/// traversal depth and refuse symlink dirs so a hostile recording tree cannot
/// turn a local scan into arbitrary filesystem traversal.
fn recording_files(chats_dir: &Path, layout: Layout) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    push_recording_files(chats_dir, layout, 0, &mut paths);
    paths.sort();
    paths
}

fn push_recording_files(dir: &Path, layout: Layout, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() && !kind.is_symlink() && depth < 1 {
            push_recording_files(&path, layout, depth + 1, out);
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let extension = path.extension().and_then(|ext| ext.to_str());
        let current = extension == Some("jsonl");
        let legacy = layout == Layout::Legacy
            && extension == Some("json")
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("session-"));
        if current || legacy {
            out.push(path);
        }
    }
}

fn collect_jsonl(path: &Path, layout: Layout, out: &mut Vec<Candidate>) {
    let Ok(file) = std::fs::File::open(path) else {
        return;
    };
    let fallback_session = file_stem(path);
    let mut rows = Vec::new();
    for (line_index, line) in BufReader::new(file).lines().enumerate() {
        let Ok(line) = line else {
            continue;
        };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        rows.push((line_index + 1, value));
    }

    let parent_session_id = rows.iter().find_map(|(_, value)| {
        (value.get("type").and_then(Value::as_str) == Some("system")
            && value.get("subtype").and_then(Value::as_str) == Some("parent_session"))
        .then(|| {
            value
                .get("systemPayload")
                .and_then(|payload| payload.get("parentSessionId"))
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .map(str::to_string)
        })
        .flatten()
    });

    let mut ordinal = 0usize;
    for (line_no, value) in rows {
        let Some(record_type) = value.get("type").and_then(Value::as_str) else {
            continue;
        };
        if record_type == "system" {
            continue;
        }
        ordinal += 1;

        // `/branch` copies old rows with their original usage. Those tokens
        // were consumed in the source session, not by the child session.
        if value.get("forkedFrom").is_some_and(Value::is_object) {
            continue;
        }

        let session_id =
            nonempty_string(value.get("sessionId")).unwrap_or_else(|| fallback_session.clone());
        let raw_ref = format!("{}:{line_no}", path.display());
        if let Some(candidate) = current_record_to_candidate(
            &value,
            record_type,
            &session_id,
            parent_session_id.as_deref(),
            &raw_ref,
            ordinal,
            layout,
        ) {
            out.push(candidate);
        }
    }
}

fn current_record_to_candidate(
    value: &Value,
    record_type: &str,
    session_id: &str,
    parent_session_id: Option<&str>,
    raw_ref: &str,
    ordinal: usize,
    layout: Layout,
) -> Option<Candidate> {
    let timestamp = parse_timestamp(value.get("timestamp")?)?;
    let mut event = AgentEvent::new(QwenCodeAdapter::NAME, timestamp);
    event.session_id = Some(session_id.to_string());
    event.project_path = nonempty_string(value.get("cwd"));
    event.event_type = record_type.to_string();
    event.model = nonempty_string(value.get("model"));
    event.raw_ref = Some(raw_ref.to_string());
    event.tool_calls = u32::from(record_type == "tool_result");

    let uuid =
        nonempty_string(value.get("uuid")).unwrap_or_else(|| format!("{session_id}#{ordinal}"));
    event
        .metadata
        .insert("uuid".to_string(), Value::String(uuid));
    event.metadata.insert(
        "recording_format".to_string(),
        Value::String("chat_record_jsonl".to_string()),
    );
    copy_string_metadata(value, "version", &mut event, "cli_version");
    copy_string_metadata(value, "agentId", &mut event, "agent_id");
    copy_string_metadata(value, "agentName", &mut event, "agent_name");
    if value.get("isSidechain").and_then(Value::as_bool) == Some(true) {
        event
            .metadata
            .insert("is_sidechain".to_string(), Value::Bool(true));
    }
    if let Some(parent) = parent_session_id {
        event.metadata.insert(
            "parent_session_id".to_string(),
            Value::String(parent.to_string()),
        );
    }

    let usage = value.get("usageMetadata").and_then(Value::as_object);
    let richness = if let Some(usage) = usage {
        apply_current_usage(&mut event, usage)
    } else {
        event.metadata.insert(
            "token_precision".to_string(),
            Value::String("activity_only".to_string()),
        );
        0
    };

    Some(Candidate {
        event,
        layout,
        richness,
    })
}

fn collect_legacy_json(path: &Path, out: &mut Vec<Candidate>) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(root) = serde_json::from_str::<Value>(&text) else {
        return;
    };
    let session_id = nonempty_string(root.get("sessionId")).unwrap_or_else(|| file_stem(path));
    // Early ConversationRecord has no cwd. Honor a literal cwd only when a
    // producer persisted one; never reverse the projectHash/directory name.
    let project_path = nonempty_string(root.get("cwd"));
    let Some(messages) = root.get("messages").and_then(Value::as_array) else {
        return;
    };

    for (index, value) in messages.iter().enumerate() {
        let Some(record_type) = value.get("type").and_then(Value::as_str) else {
            continue;
        };
        let Some(timestamp) = value.get("timestamp").and_then(parse_timestamp) else {
            continue;
        };
        let mut event = AgentEvent::new(QwenCodeAdapter::NAME, timestamp);
        event.session_id = Some(session_id.clone());
        event.project_path = nonempty_string(value.get("cwd")).or_else(|| project_path.clone());
        event.event_type = match record_type {
            "qwen" => "assistant".to_string(),
            other => other.to_string(),
        };
        event.model = nonempty_string(value.get("model"));
        event.raw_ref = Some(format!("{}#{}", path.display(), index + 1));
        event.tool_calls = value
            .get("toolCalls")
            .and_then(Value::as_array)
            .map(|calls| u32::try_from(calls.len()).unwrap_or(u32::MAX))
            .unwrap_or(0);

        let uuid = nonempty_string(value.get("id"))
            .or_else(|| nonempty_string(value.get("uuid")))
            .unwrap_or_else(|| format!("{session_id}#{}", index + 1));
        event
            .metadata
            .insert("uuid".to_string(), Value::String(uuid));
        event.metadata.insert(
            "recording_format".to_string(),
            Value::String("legacy_conversation_json".to_string()),
        );

        let usage = value.get("tokens").and_then(Value::as_object);
        let richness = if let Some(usage) = usage {
            apply_legacy_usage(&mut event, usage)
        } else {
            event.metadata.insert(
                "token_precision".to_string(),
                Value::String("activity_only".to_string()),
            );
            0
        };

        out.push(Candidate {
            event,
            layout: Layout::Legacy,
            richness,
        });
    }
}

/// Current `GenerateContentResponseUsageMetadata` mapping. Returns a weight
/// used only to choose the richer duplicate physical row; counters are never
/// summed across rows with the same logical UUID.
fn apply_current_usage(event: &mut AgentEvent, usage: &Map<String, Value>) -> u64 {
    let prompt = count(usage.get("promptTokenCount"));
    let candidates = count(usage.get("candidatesTokenCount"));
    let cached_raw = count(usage.get("cachedContentTokenCount"));
    let cached = cached_raw.min(prompt);
    let thoughts = count(usage.get("thoughtsTokenCount"));
    let tool_prompt = count(usage.get("toolUsePromptTokenCount"));
    let reported_total = count(usage.get("totalTokenCount"));

    event.usage.input_tokens = prompt.saturating_sub(cached);
    event.usage.cache_read_tokens = cached;
    event.usage.cache_write_tokens = 0;
    event.usage.output_tokens = if reported_total > 0 && prompt > 0 {
        reported_total.saturating_sub(prompt)
    } else {
        // Candidate/thought overlap is provider-dependent. Candidate count is
        // the only safe non-estimated fallback when total is absent.
        candidates
    };
    let split = event
        .usage
        .input_tokens
        .saturating_add(event.usage.cache_read_tokens)
        .saturating_add(event.usage.output_tokens);
    event.usage.total_tokens = reported_total.max(split);

    event.metadata.insert(
        "token_precision".to_string(),
        Value::String("source_reported".to_string()),
    );
    event
        .metadata
        .insert("thoughts_tokens".to_string(), Value::from(thoughts));
    event
        .metadata
        .insert("tool_prompt_tokens".to_string(), Value::from(tool_prompt));
    if cached_raw > prompt {
        event.metadata.insert(
            "reported_cached_tokens".to_string(),
            Value::from(cached_raw),
        );
    }
    if reported_total > 0 && reported_total < split {
        event.metadata.insert(
            "reported_total_tokens".to_string(),
            Value::from(reported_total),
        );
    }

    prompt
        .saturating_add(candidates)
        .saturating_add(cached_raw)
        .saturating_add(thoughts)
        .saturating_add(tool_prompt)
        .saturating_add(reported_total)
}

fn apply_legacy_usage(event: &mut AgentEvent, usage: &Map<String, Value>) -> u64 {
    let prompt = count(usage.get("input"));
    let candidates = count(usage.get("output"));
    let cached_raw = count(usage.get("cached"));
    let cached = cached_raw.min(prompt);
    let thoughts = count(usage.get("thoughts"));
    let tool_prompt = count(usage.get("tool"));
    let reported_total = count(usage.get("total"));

    event.usage.input_tokens = prompt.saturating_sub(cached);
    event.usage.cache_read_tokens = cached;
    event.usage.cache_write_tokens = 0;
    event.usage.output_tokens = if reported_total > 0 && prompt > 0 {
        reported_total.saturating_sub(prompt)
    } else {
        candidates
    };
    let split = event
        .usage
        .input_tokens
        .saturating_add(event.usage.cache_read_tokens)
        .saturating_add(event.usage.output_tokens);
    event.usage.total_tokens = reported_total.max(split);
    event.metadata.insert(
        "token_precision".to_string(),
        Value::String("source_reported".to_string()),
    );
    event
        .metadata
        .insert("thoughts_tokens".to_string(), Value::from(thoughts));
    event
        .metadata
        .insert("tool_prompt_tokens".to_string(), Value::from(tool_prompt));

    prompt
        .saturating_add(candidates)
        .saturating_add(cached_raw)
        .saturating_add(thoughts)
        .saturating_add(tool_prompt)
        .saturating_add(reported_total)
}

fn dedupe_candidates(candidates: Vec<Candidate>) -> Vec<AgentEvent> {
    let mut by_logical_message: HashMap<(String, String), Candidate> = HashMap::new();
    for candidate in candidates {
        let session = candidate.event.session_id.clone().unwrap_or_default();
        let uuid = candidate
            .event
            .metadata
            .get("uuid")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let key = (session, uuid);
        match by_logical_message.get_mut(&key) {
            Some(existing)
                if candidate.layout > existing.layout
                    || (candidate.layout == existing.layout
                        && candidate.richness > existing.richness) =>
            {
                *existing = candidate;
            }
            Some(_) => {}
            None => {
                by_logical_message.insert(key, candidate);
            }
        }
    }

    let mut events = by_logical_message
        .into_values()
        .map(|candidate| candidate.event)
        .collect::<Vec<_>>();
    events.sort_by(|a, b| {
        a.timestamp
            .cmp(&b.timestamp)
            .then_with(|| a.session_id.cmp(&b.session_id))
            .then_with(|| {
                a.metadata
                    .get("uuid")
                    .and_then(Value::as_str)
                    .cmp(&b.metadata.get("uuid").and_then(Value::as_str))
            })
            .then_with(|| a.raw_ref.cmp(&b.raw_ref))
    });
    events
}

fn parse_timestamp(value: &Value) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value.as_str()?)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
}

fn count(value: Option<&Value>) -> u64 {
    value.and_then(Value::as_u64).unwrap_or(0)
}

fn nonempty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn copy_string_metadata(value: &Value, source: &str, event: &mut AgentEvent, target: &str) {
    if let Some(value) = nonempty_string(value.get(source)) {
        event
            .metadata
            .insert(target.to_string(), Value::String(value));
    }
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    static FIXTURE_ID: AtomicU64 = AtomicU64::new(0);

    fn fixture_home(tag: &str) -> PathBuf {
        let id = FIXTURE_ID.fetch_add(1, Ordering::Relaxed);
        let home = std::env::temp_dir().join(format!("lag-qwen-{tag}-{}-{id}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        home
    }

    fn current_chats(home: &Path, project: &str) -> PathBuf {
        let chats = home
            .join(".qwen")
            .join("projects")
            .join(project)
            .join("chats");
        std::fs::create_dir_all(&chats).unwrap();
        chats
    }

    fn legacy_chats(home: &Path, project_hash: &str) -> PathBuf {
        let chats = home
            .join(".qwen")
            .join("tmp")
            .join(project_hash)
            .join("chats");
        std::fs::create_dir_all(&chats).unwrap();
        chats
    }

    fn write_jsonl(path: &Path, rows: &[Value]) {
        let contents = rows
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(path, format!("{contents}\n")).unwrap();
    }

    fn collect(home: &Path) -> Vec<AgentEvent> {
        QwenCodeAdapter
            .collect(&AdapterContext::with_home(home))
            .unwrap()
    }

    #[test]
    fn parses_current_chat_record_and_source_usage() {
        let home = fixture_home("current");
        let chats = current_chats(&home, "-Users-demo-garden");
        write_jsonl(
            &chats.join("11111111-1111-1111-1111-111111111111.jsonl"),
            &[
                json!({
                    "uuid": "user-1", "parentUuid": null,
                    "sessionId": "session-1", "timestamp": "2026-07-11T08:00:00Z",
                    "type": "user", "cwd": "/Users/demo/garden", "version": "0.19.9",
                    "message": { "role": "user", "parts": [{"text": "private"}] }
                }),
                json!({
                    "uuid": "assistant-1", "parentUuid": "user-1",
                    "sessionId": "session-1", "timestamp": "2026-07-11T08:00:03Z",
                    "type": "assistant", "cwd": "/Users/demo/garden", "version": "0.19.9",
                    "model": "qwen3-coder-plus",
                    "message": { "role": "model", "parts": [{"text": "secret answer"}] },
                    "usageMetadata": {
                        "promptTokenCount": 100, "candidatesTokenCount": 50,
                        "cachedContentTokenCount": 40, "thoughtsTokenCount": 30,
                        "toolUsePromptTokenCount": 7, "totalTokenCount": 180
                    }
                }),
                json!({
                    "uuid": "tool-1", "parentUuid": "assistant-1",
                    "sessionId": "session-1", "timestamp": "2026-07-11T08:00:04Z",
                    "type": "tool_result", "cwd": "/Users/demo/garden", "version": "0.19.9",
                    "toolCallResult": {"resultDisplay": "private tool output"}
                }),
            ],
        );

        let events = collect(&home);
        assert_eq!(events.len(), 3);
        let assistant = events
            .iter()
            .find(|event| event.event_type == "assistant")
            .unwrap();
        assert_eq!(
            assistant.project_path.as_deref(),
            Some("/Users/demo/garden")
        );
        assert_eq!(assistant.model.as_deref(), Some("qwen3-coder-plus"));
        assert_eq!(assistant.usage.input_tokens, 60);
        assert_eq!(assistant.usage.cache_read_tokens, 40);
        assert_eq!(assistant.usage.cache_write_tokens, 0);
        // Qwen's total-prompt rule avoids candidate/thought overlap guessing.
        assert_eq!(assistant.usage.output_tokens, 80);
        assert_eq!(assistant.usage.total_tokens, 180);
        assert_eq!(assistant.metadata.get("thoughts_tokens"), Some(&json!(30)));
        assert_eq!(
            assistant.metadata.get("tool_prompt_tokens"),
            Some(&json!(7))
        );
        assert_eq!(assistant.metadata.get("uuid"), Some(&json!("assistant-1")));
        assert!(!assistant.metadata.values().any(|value| {
            value.as_str() == Some("secret answer") || value.as_str() == Some("private")
        }));
        assert_eq!(
            events
                .iter()
                .find(|event| event.event_type == "tool_result")
                .unwrap()
                .tool_calls,
            1
        );

        std::fs::remove_dir_all(home).ok();
    }

    #[test]
    fn parses_legacy_whole_file_without_guessing_hash_path() {
        let home = fixture_home("legacy");
        let chats = legacy_chats(
            &home,
            "3f9a0c4b8de2517a6b0c9d8e7f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c",
        );
        let record = json!({
            "sessionId": "legacy-session", "projectHash": "opaque-hash",
            "startTime": "2025-11-01T10:00:00Z", "lastUpdated": "2025-11-01T10:01:00Z",
            "messages": [
                {"id": "old-user", "timestamp": "2025-11-01T10:00:00Z",
                 "type": "user", "content": [{"text": "private"}]},
                {"id": "old-qwen", "timestamp": "2025-11-01T10:00:02Z",
                 "type": "qwen", "model": "qwen3-coder-plus", "content": [],
                 "tokens": {"input": 90, "output": 20, "cached": 30,
                            "thoughts": 10, "tool": 4, "total": 125},
                 "toolCalls": [{"name": "read_file"}]}
            ]
        });
        std::fs::write(
            chats.join("session-2025-11-01T10-00-legacy12.json"),
            record.to_string(),
        )
        .unwrap();

        let events = collect(&home);
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|event| event.project_path.is_none()));
        let assistant = events
            .iter()
            .find(|event| event.event_type == "assistant")
            .unwrap();
        assert_eq!(assistant.session_id.as_deref(), Some("legacy-session"));
        assert_eq!(assistant.usage.input_tokens, 60);
        assert_eq!(assistant.usage.cache_read_tokens, 30);
        assert_eq!(assistant.usage.output_tokens, 35);
        assert_eq!(assistant.usage.total_tokens, 125);
        assert_eq!(assistant.tool_calls, 1);

        std::fs::remove_dir_all(home).ok();
    }

    #[test]
    fn skips_bad_lines_and_keeps_later_rows() {
        let home = fixture_home("bad-lines");
        let chats = current_chats(&home, "project");
        let path = chats.join("session.jsonl");
        std::fs::write(
            &path,
            concat!(
                "not json {\n",
                "{\"uuid\":\"missing-time\",\"sessionId\":\"s\",\"type\":\"assistant\",\"cwd\":\"/work\"}\n",
                "{\"uuid\":\"ok\",\"sessionId\":\"s\",\"timestamp\":\"2026-07-11T08:00:00Z\",\"type\":\"user\",\"cwd\":\"/work\"}\n"
            ),
        )
        .unwrap();

        let events = collect(&home);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].metadata.get("uuid"), Some(&json!("ok")));

        std::fs::remove_dir_all(home).ok();
    }

    #[test]
    fn migration_duplicate_prefers_current_jsonl_without_summing() {
        let home = fixture_home("migration-dedupe");
        let current = current_chats(&home, "project");
        write_jsonl(
            &current.join("session.jsonl"),
            &[json!({
                "uuid": "same-message", "parentUuid": null, "sessionId": "same-session",
                "timestamp": "2026-01-01T00:00:02Z", "type": "assistant", "cwd": "/real/path",
                "version": "0.19.9", "model": "qwen-current",
                "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5,
                                  "totalTokenCount": 15}
            })],
        );
        let legacy = legacy_chats(&home, "hash");
        std::fs::write(
            legacy.join("session-old.json"),
            json!({
                "sessionId": "same-session", "messages": [{
                    "id": "same-message", "timestamp": "2026-01-01T00:00:01Z",
                    "type": "qwen", "model": "qwen-legacy",
                    "tokens": {"input": 100, "output": 50, "total": 150}
                }]
            })
            .to_string(),
        )
        .unwrap();

        let events = collect(&home);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].model.as_deref(), Some("qwen-current"));
        assert_eq!(events[0].usage.total_tokens, 15);
        assert_eq!(
            events[0].metadata.get("recording_format"),
            Some(&json!("chat_record_jsonl"))
        );

        std::fs::remove_dir_all(home).ok();
    }

    #[test]
    fn parent_subagent_is_kept_but_forked_history_is_not_recounted() {
        let home = fixture_home("lineage");
        let chats = current_chats(&home, "project");
        write_jsonl(
            &chats.join("child.jsonl"),
            &[
                json!({
                    "uuid": "parent-marker", "parentUuid": null, "sessionId": "child",
                    "timestamp": "2026-07-11T08:00:00Z", "type": "system",
                    "subtype": "parent_session", "cwd": "/work", "version": "0.19.9",
                    "systemPayload": {"parentSessionId": "parent"}
                }),
                json!({
                    "uuid": "copied", "parentUuid": "parent-marker", "sessionId": "child",
                    "timestamp": "2026-07-11T08:00:01Z", "type": "assistant",
                    "cwd": "/work", "version": "0.19.9",
                    "forkedFrom": {"sessionId": "parent", "messageUuid": "copied"},
                    "usageMetadata": {"promptTokenCount": 100, "totalTokenCount": 120}
                }),
                json!({
                    "uuid": "new-child", "parentUuid": "copied", "sessionId": "child",
                    "timestamp": "2026-07-11T08:00:02Z", "type": "assistant",
                    "cwd": "/work", "version": "0.19.9", "agentId": "explore-7f3c",
                    "agentName": "Explore", "isSidechain": true,
                    "usageMetadata": {"promptTokenCount": 12, "totalTokenCount": 18}
                }),
            ],
        );

        let events = collect(&home);
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.metadata.get("uuid"), Some(&json!("new-child")));
        assert_eq!(
            event.metadata.get("parent_session_id"),
            Some(&json!("parent"))
        );
        assert_eq!(event.metadata.get("agent_id"), Some(&json!("explore-7f3c")));
        assert_eq!(event.metadata.get("is_sidechain"), Some(&json!(true)));
        assert_eq!(event.usage.total_tokens, 18);

        std::fs::remove_dir_all(home).ok();
    }

    #[test]
    fn duplicate_uuid_fragments_choose_richest_usage_and_rescan_stably() {
        let home = fixture_home("uuid-dedupe");
        let chats = current_chats(&home, "project");
        write_jsonl(
            &chats.join("session.jsonl"),
            &[
                json!({
                    "uuid": "logical", "parentUuid": null, "sessionId": "session",
                    "timestamp": "2026-07-11T08:00:00Z", "type": "assistant",
                    "cwd": "/work", "version": "0.19.9", "model": "qwen"
                }),
                json!({
                    "uuid": "logical", "parentUuid": null, "sessionId": "session",
                    "timestamp": "2026-07-11T08:00:01Z", "type": "assistant",
                    "cwd": "/work", "version": "0.19.9", "model": "qwen",
                    "usageMetadata": {"promptTokenCount": 20, "totalTokenCount": 30}
                }),
            ],
        );

        let first = collect(&home);
        let second = collect(&home);
        assert_eq!(first.len(), 1);
        assert_eq!(first, second);
        assert_eq!(first[0].usage.total_tokens, 30);
        assert_eq!(first[0].metadata.get("uuid"), Some(&json!("logical")));

        std::fs::remove_dir_all(home).ok();
    }

    #[test]
    fn watches_only_recording_roots_and_ignores_sensitive_json() {
        let home = fixture_home("watch-privacy");
        let qwen = home.join(".qwen");
        let projects = qwen.join("projects");
        let tmp = qwen.join("tmp");
        std::fs::create_dir_all(&projects).unwrap();
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(qwen.join("settings.json"), r#"{"apiKey":"secret"}"#).unwrap();
        std::fs::write(qwen.join("oauth_creds.json"), r#"{"token":"secret"}"#).unwrap();
        std::fs::write(tmp.join("logs.json"), r#"{"prompt":"private"}"#).unwrap();

        let ctx = AdapterContext::with_home(&home);
        let paths = QwenCodeAdapter.watch_paths(&ctx);
        assert_eq!(paths, vec![projects, tmp]);
        assert!(collect(&home).is_empty());
        assert!(paths.iter().all(|path| {
            !path.ends_with("settings.json")
                && !path.ends_with("oauth_creds.json")
                && !path.ends_with("logs.json")
        }));

        std::fs::remove_dir_all(home).ok();
    }

    #[test]
    fn empty_runtime_roots_and_logs_do_not_count_as_chat_activity() {
        let home = fixture_home("empty-runtime");
        let qwen = home.join(".qwen");
        std::fs::create_dir_all(qwen.join("projects")).unwrap();
        std::fs::create_dir_all(qwen.join("tmp").join("project-hash")).unwrap();
        std::fs::write(
            qwen.join("tmp").join("project-hash").join("logs.json"),
            r#"{"message":"not a chat recording"}"#,
        )
        .unwrap();

        assert!(!QwenCodeAdapter.discover(&AdapterContext::with_home(&home)));
        assert!(collect(&home).is_empty());

        std::fs::remove_dir_all(home).ok();
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_symlinked_project_directories() {
        use std::os::unix::fs::symlink;

        let home = fixture_home("symlink");
        let outside = fixture_home("outside");
        let outside_chats = outside.join("chats");
        std::fs::create_dir_all(&outside_chats).unwrap();
        write_jsonl(
            &outside_chats.join("session.jsonl"),
            &[json!({
                "uuid": "escaped", "sessionId": "s", "timestamp": "2026-07-11T08:00:00Z",
                "type": "user", "cwd": "/outside", "version": "0.19.9"
            })],
        );
        let projects = home.join(".qwen").join("projects");
        std::fs::create_dir_all(&projects).unwrap();
        symlink(&outside, projects.join("linked-project")).unwrap();

        assert!(collect(&home).is_empty());

        std::fs::remove_dir_all(home).ok();
        std::fs::remove_dir_all(outside).ok();
    }
}
