//! Gemini CLI adapter — reads saved chat recordings below `~/.gemini/tmp/`.
//!
//! Product status (verified 2026-07-11): Google no longer offers Login with
//! Google for Gemini CLI consumer accounts and directs those users to
//! Antigravity. This adapter remains valid for existing recordings and for
//! API-key, Vertex AI, Standard, and Enterprise usage; it is legacy coverage,
//! not the consumer growth path.
//!
//! Paths read (all READ-ONLY; nothing is ever written into `~/.gemini/`):
//!   - `~/.gemini/tmp/<project-id>/chats/session-*.jsonl` — append-only chat
//!     recordings, one JSON record per line (current format). `<project-id>`
//!     is a registry slug on current CLI versions and a sha256 hex of the
//!     project root on older ones; the adapter enumerates every subdirectory
//!     and never tries to reverse a hash.
//!   - `~/.gemini/tmp/<project-id>/chats/<parent-session-id>/<session-id>.jsonl`
//!     — subagent recordings (same record shapes, nested one directory deep).
//!   - `~/.gemini/tmp/<project-id>/chats/session-*.json` — legacy whole-file
//!     `ConversationRecord` checkpoints. The CLI migrates these by appending
//!     `l` to the filename and re-appending all records, and may leave the old
//!     `.json` behind, so a `.json` with a same-stem `.jsonl` sibling is
//!     skipped to avoid reading the session twice.
//!   - `~/.gemini/tmp/<project-id>/.project_root` — plain-text normalized
//!     project root written by the CLI's project registry; the primary,
//!     lossless `project_path` source (no hash guessing).
//!   - `~/.gemini/projects.json` — `{ "projects": { "<abs path>": "<slug>" } }`;
//!     inverted (slug → path) as a fallback `project_path` source. Legacy
//!     sha256-named dirs with neither marker nor registry entry yield
//!     `project_path: None` rather than a guess. A session-level `directories`
//!     array (workspace dirs, currently recorded for subagents) is used before
//!     both when present.
//!
//! Upstream evidence — google-gemini/gemini-cli, `main` branch, verified
//! 2026-07-11 (latest release at that date: v0.43.0):
//!   - `packages/core/src/services/chatRecordingService.ts`: appends one JSON
//!     record per line via `fs.appendFileSync`; first line is a metadata
//!     record `{ sessionId, projectHash, startTime, lastUpdated, kind?,
//!     directories? }`; message records are `{ id, timestamp, type:
//!     'user'|'gemini'|'system', content, model?, thoughts?, tokens?,
//!     toolCalls? }`; control records are `{ "$set": … }` and
//!     `{ "$rewindTo": <messageId> }`; filename is
//!     `session-<ISO-minute-timestamp>-<sessionId[0..8]>.jsonl`; `/resume`
//!     re-opens the same file and keeps the original `sessionId`; legacy
//!     `.json` files are migrated by appending `l` to the path.
//!   - `packages/core/src/services/chatRecordingTypes.ts`:
//!     `SESSION_FILE_PREFIX = 'session-'`; `TokensSummary = { input, output,
//!     cached, thoughts, tool, total }`; legacy `ConversationRecord` carries
//!     the full `messages` array plus `sessionId` / `projectHash` /
//!     `directories?`.
//!   - `packages/core/src/config/storage.ts`: project temp dir is
//!     `~/.gemini/tmp/<identifier>`; chats live in `<temp dir>/chats`.
//!   - `packages/core/src/config/projectRegistry.ts`: `projects.json` maps
//!     normalized absolute project paths to `[a-z0-9-]+` slugs; a
//!     `.project_root` marker file containing the plain normalized project
//!     path is written into each slug directory.
//!   - `packages/core/src/core/geminiChat.ts`: the recorded `model` string is
//!     the resolved concrete model id (`applyModelSelection` → `resolveModel`
//!     run before recording), not the `auto` display label.
//!
//! Token precision: API-reported and PER-MESSAGE (per-turn, not cumulative) —
//! the CLI copies `GenerateContentResponse.usageMetadata` onto each gemini
//! message (`input` = promptTokenCount, `output` = candidatesTokenCount,
//! `cached` = cachedContentTokenCount, `thoughts` = thoughtsTokenCount,
//! `tool` = toolUsePromptTokenCount, `total` = totalTokenCount). Mapping used
//! here: `cached` is a subset of the prompt count, so `input_tokens = input −
//! cached` and `cache_read_tokens = cached`; thinking tokens are billed as
//! output by the Gemini API, so `output_tokens = output + thoughts`;
//! `total_tokens` keeps the reported total, clamped up to the bucket sum so
//! downstream `total − split` math never underflows (tool-prompt tokens stay
//! inside the total as a blended remainder). Raw `thoughts` / `tool` counts
//! are preserved in `metadata`. No token count is ever inferred from text.
//!
//! Dedupe key: the native per-message uuid (`id`) is stored in
//! `metadata["uuid"]`, which `scan::dedupe_key` combines with source and
//! session id. Messages without an `id` get the stable synthetic key
//! `<session-id>#<message-ordinal>` (files are append-only, so ordinals are
//! stable across rescans and across the `.json` → `.jsonl` migration).

use crate::adapter::{Adapter, AdapterContext};
use crate::adapters::util::{JsonlRow, as_int_opt, parse_rfc3339_utc, read_jsonl};
use crate::error::Error;
use crate::event::AgentEvent;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Parameterized over source name/root for format-compatible fixtures or
/// forks. Qwen Code's current `ChatRecord`/`usageMetadata` schema has diverged
/// and requires its own adapter; it must not be registered through this type.
pub struct GeminiCliAdapter {
    name: &'static str,
    dot_dir: &'static str,
}

impl GeminiCliAdapter {
    pub const NAME: &'static str = "gemini-cli";

    pub fn new(name: &'static str, dot_dir: &'static str) -> Self {
        Self { name, dot_dir }
    }

    /// The Gemini CLI itself (`~/.gemini`).
    pub fn gemini() -> Self {
        Self::new(Self::NAME, ".gemini")
    }

    fn tmp_root(&self, ctx: &AdapterContext) -> PathBuf {
        ctx.home.join(self.dot_dir).join("tmp")
    }

    fn registry_path(&self, ctx: &AdapterContext) -> PathBuf {
        ctx.home.join(self.dot_dir).join("projects.json")
    }
}

impl Adapter for GeminiCliAdapter {
    fn name(&self) -> &str {
        self.name
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        self.tmp_root(ctx).is_dir()
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let root = self.tmp_root(ctx);
        let slug_to_path = load_registry(&self.registry_path(ctx));
        let mut events = Vec::new();
        let Ok(entries) = std::fs::read_dir(&root) else {
            return Ok(events);
        };
        let mut project_dirs: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        project_dirs.sort();

        for project_dir in project_dirs {
            // Lossless project_path recovery, in trust order: the CLI-written
            // `.project_root` marker, then the inverted registry. Both hold the
            // literal recorded path, so events are NOT marked path-inferred.
            let project_path = read_project_root_marker(&project_dir).or_else(|| {
                project_dir
                    .file_name()
                    .and_then(|n| n.to_str())
                    .and_then(|slug| slug_to_path.get(slug).cloned())
            });
            for file in list_chat_files(&project_dir.join("chats")) {
                events.extend(collect_chat_file(self.name, &file, project_path.as_deref()));
            }
        }
        Ok(events)
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        // One stable root: project dirs (and their chats/) appear and vanish
        // with projects, and recordings are appended in place, so watching
        // `~/.gemini/tmp` recursively covers every write the CLI makes.
        let root = self.tmp_root(ctx);
        if root.is_dir() {
            vec![root]
        } else {
            Vec::new()
        }
    }
}

/// Invert `projects.json` (`path → slug`) into `slug → path`.
fn load_registry(path: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(text) = std::fs::read_to_string(path) else {
        return map;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return map;
    };
    if let Some(projects) = value.get("projects").and_then(|v| v.as_object()) {
        for (project_path, slug) in projects {
            if let Some(slug) = slug.as_str() {
                map.insert(slug.to_string(), project_path.clone());
            }
        }
    }
    map
}

/// `.project_root` holds the plain normalized project path (one line, utf8).
fn read_project_root_marker(project_dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(project_dir.join(".project_root")).ok()?;
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Enumerate recordings under `chats/`: `.jsonl`/`.json` files at the top
/// level plus one nested level of subagent directories. A legacy `.json` is
/// dropped when its migrated same-stem `.jsonl` sibling exists (the CLI's
/// migration re-appends every record into the new file).
fn list_chat_files(chats_dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    push_chat_files(chats_dir, 0, &mut out);
    out.sort();
    out.retain(|p| {
        p.extension().and_then(|e| e.to_str()) != Some("json")
            || !p.with_extension("jsonl").is_file()
    });
    out
}

fn push_chat_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if depth < 1 {
                push_chat_files(&path, depth + 1, out);
            }
        } else if matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("jsonl") | Some("json")
        ) {
            out.push(path);
        }
    }
}

fn collect_chat_file(source: &str, path: &Path, project_path: Option<&str>) -> Vec<AgentEvent> {
    match path.extension().and_then(|e| e.to_str()) {
        Some("jsonl") => collect_session_jsonl(source, path, project_path),
        Some("json") => collect_session_json(source, path, project_path),
        _ => Vec::new(),
    }
}

/// Current append-only format: metadata head line, then message and control
/// records. Corrupt lines are skipped by `read_jsonl`; control records
/// (`$set` / `$rewindTo`) and headless metadata updates carry no activity and
/// are ignored.
fn collect_session_jsonl(source: &str, path: &Path, project_path: Option<&str>) -> Vec<AgentEvent> {
    let fallback_sid = file_stem(path);
    let mut session_id: Option<String> = None;
    let mut directories_fallback: Option<String> = None;
    let mut ordinal = 0usize;
    let mut events = Vec::new();

    for JsonlRow { line_no, value } in read_jsonl(path) {
        if value.get("$set").is_some() || value.get("$rewindTo").is_some() {
            continue;
        }
        if value.get("type").is_none() {
            // Head metadata record — `/resume` keeps appending to the same
            // file, so the first sessionId seen is the session's stable id.
            if session_id.is_none() {
                session_id = value
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
            }
            if directories_fallback.is_none() {
                directories_fallback = first_directory(&value);
            }
            continue;
        }
        ordinal += 1;
        let sid = session_id.as_deref().unwrap_or(&fallback_sid);
        let effective_path = directories_fallback.as_deref().or(project_path);
        if let Some(event) = message_to_event(
            source,
            &value,
            sid,
            effective_path,
            &format!("{}:{}", path.display(), line_no),
            ordinal,
        ) {
            events.push(event);
        }
    }
    events
}

/// Legacy whole-file `ConversationRecord` checkpoint (`{ sessionId,
/// projectHash, startTime, lastUpdated, messages: […] }`). A file that fails
/// to parse yields no events rather than an error.
fn collect_session_json(source: &str, path: &Path, project_path: Option<&str>) -> Vec<AgentEvent> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    let session_id = value
        .get("sessionId")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| file_stem(path));
    let directories_fallback = first_directory(&value);
    let effective_path = directories_fallback.as_deref().or(project_path);

    let Some(messages) = value.get("messages").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut events = Vec::new();
    for (idx, message) in messages.iter().enumerate() {
        let ordinal = idx + 1;
        if let Some(event) = message_to_event(
            source,
            message,
            &session_id,
            effective_path,
            &format!("{}#{}", path.display(), ordinal),
            ordinal,
        ) {
            events.push(event);
        }
    }
    events
}

/// First entry of the session-level `directories` array (workspace dirs the
/// CLI recorded for this session; currently written for subagent sessions).
fn first_directory(record: &serde_json::Value) -> Option<String> {
    record
        .get("directories")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// One `MessageRecord` → one `AgentEvent`. Rows without a parsable timestamp
/// are skipped; `system` rows are kept only when they carry usage or tool
/// calls (mirrors the claude-code adapter's signal gate).
fn message_to_event(
    source: &str,
    value: &serde_json::Value,
    session_id: &str,
    project_path: Option<&str>,
    raw_ref: &str,
    ordinal: usize,
) -> Option<AgentEvent> {
    let timestamp = parse_rfc3339_utc(value.get("timestamp")?.as_str()?)?;
    let msg_type = value.get("type")?.as_str()?;

    let tokens = value.get("tokens").and_then(|t| t.as_object());
    let raw_input = as_int_opt(tokens.and_then(|t| t.get("input")));
    let cached = as_int_opt(tokens.and_then(|t| t.get("cached")));
    let output = as_int_opt(tokens.and_then(|t| t.get("output")));
    let thoughts = as_int_opt(tokens.and_then(|t| t.get("thoughts")));
    let tool_prompt = as_int_opt(tokens.and_then(|t| t.get("tool")));
    let total = as_int_opt(tokens.and_then(|t| t.get("total")));
    let tool_calls = value
        .get("toolCalls")
        .and_then(|v| v.as_array())
        .map(|a| a.len() as u32)
        .unwrap_or(0);

    let has_signal = total > 0 || raw_input > 0 || output > 0 || tool_calls > 0;
    if !has_signal && msg_type != "user" && msg_type != "gemini" {
        return None;
    }

    let mut event = AgentEvent::new(source, timestamp);
    event.project_path = project_path.map(str::to_string);
    event.session_id = Some(session_id.to_string());
    event.event_type = msg_type.to_string();
    // See module docs: cached ⊆ input; thoughts are billed as output; the
    // reported total is clamped up to the bucket sum so `total − split`
    // stays non-negative downstream (tool-prompt tokens remain blended).
    event.usage.input_tokens = raw_input.saturating_sub(cached);
    event.usage.cache_read_tokens = cached;
    event.usage.output_tokens = output.saturating_add(thoughts);
    let split = event
        .usage
        .input_tokens
        .saturating_add(event.usage.output_tokens)
        .saturating_add(event.usage.cache_read_tokens);
    event.usage.total_tokens = total.max(split);
    event.tool_calls = tool_calls;
    event.model = value
        .get("model")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    event.raw_ref = Some(raw_ref.to_string());

    // Native message uuid drives scan's dedupe; the ordinal fallback stays
    // stable because recordings are append-only.
    let uuid = value
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{session_id}#{ordinal}"));
    event
        .metadata
        .insert("uuid".to_string(), serde_json::Value::String(uuid));
    if tokens.is_some() {
        // Raw usage components that have no top-level bucket of their own.
        event
            .metadata
            .insert("thoughts_tokens".to_string(), serde_json::json!(thoughts));
        event
            .metadata
            .insert("tool_tokens".to_string(), serde_json::json!(tool_prompt));
    }

    event.normalize_totals();
    Some(event)
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Fixture home with `~/.gemini/tmp/<project-id>/chats/` prepared.
    fn fixture_home(tag: &str, project_id: &str) -> (PathBuf, PathBuf) {
        let home = std::env::temp_dir().join(format!("lag-gemini-{tag}-{}", std::process::id()));
        let project_dir = home.join(".gemini").join("tmp").join(project_id);
        std::fs::create_dir_all(project_dir.join("chats")).unwrap();
        (home, project_dir)
    }

    fn collect_from(home: &Path) -> Vec<AgentEvent> {
        let ctx = AdapterContext::with_home(home);
        GeminiCliAdapter::gemini().collect(&ctx).unwrap()
    }

    #[test]
    fn parses_current_jsonl_session_with_usage() {
        let (home, project_dir) = fixture_home("jsonl", "pixel-agent-garden");
        std::fs::write(project_dir.join(".project_root"), "/Users/demo/garden\n").unwrap();
        let rows = [
            // Head metadata line, exactly as chatRecordingService appends it.
            json!({
                "sessionId": "0f6dc551-9e32-4a68-a0a8-a2b1f4d0c1aa",
                "projectHash": "a1b2c3",
                "startTime": "2026-07-10T09:30:00.000Z",
                "lastUpdated": "2026-07-10T09:30:00.000Z",
                "kind": "main"
            }),
            json!({
                "id": "msg-user-1",
                "timestamp": "2026-07-10T09:30:05.000Z",
                "type": "user",
                "content": [{ "text": "hello" }]
            }),
            json!({
                "id": "msg-gemini-1",
                "timestamp": "2026-07-10T09:30:09.000Z",
                "type": "gemini",
                "content": [{ "text": "hi" }],
                "model": "gemini-2.5-pro",
                "tokens": {
                    "input": 100, "output": 20, "cached": 40,
                    "thoughts": 5, "tool": 2, "total": 127
                },
                "toolCalls": [
                    { "name": "read_file", "args": {}, "status": "success" },
                    { "name": "shell", "args": {}, "status": "success" }
                ]
            }),
        ]
        .into_iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        std::fs::write(
            project_dir
                .join("chats")
                .join("session-2026-07-10T09-30-0f6dc551.jsonl"),
            format!("{rows}\n"),
        )
        .unwrap();

        let events = collect_from(&home);
        assert_eq!(events.len(), 2);

        let user = &events[0];
        assert_eq!(user.source, "gemini-cli");
        assert_eq!(user.event_type, "user");
        assert_eq!(user.project_path.as_deref(), Some("/Users/demo/garden"));
        // Recorded paths are literal — never marked inferred.
        assert!(!user.path_is_inferred());
        assert_eq!(
            user.session_id.as_deref(),
            Some("0f6dc551-9e32-4a68-a0a8-a2b1f4d0c1aa")
        );
        assert_eq!(user.usage.total_tokens, 0);

        let gemini = &events[1];
        assert_eq!(gemini.event_type, "gemini");
        assert_eq!(gemini.model.as_deref(), Some("gemini-2.5-pro"));
        assert_eq!(gemini.tool_calls, 2);
        // cached (40) split out of input (100); thoughts (5) folded into
        // output (20); reported total (127) ≥ split (60+25+40=125) → kept.
        assert_eq!(gemini.usage.input_tokens, 60);
        assert_eq!(gemini.usage.cache_read_tokens, 40);
        assert_eq!(gemini.usage.output_tokens, 25);
        assert_eq!(gemini.usage.cache_write_tokens, 0);
        assert_eq!(gemini.usage.total_tokens, 127);
        assert_eq!(gemini.metadata.get("thoughts_tokens"), Some(&json!(5)));
        assert_eq!(gemini.metadata.get("tool_tokens"), Some(&json!(2)));
        assert_eq!(gemini.metadata.get("uuid"), Some(&json!("msg-gemini-1")));

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn parses_legacy_json_checkpoint_without_project_marker() {
        // Older CLI versions: sha256-named project dir, whole-file
        // ConversationRecord, no .project_root, no registry → path is None,
        // never a guessed hash reversal.
        let hex_dir = "3f9a0c4b8de2517a6b0c9d8e7f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c";
        let (home, project_dir) = fixture_home("legacy", hex_dir);
        let record = json!({
            "sessionId": "legacy-session-1",
            "projectHash": hex_dir,
            "startTime": "2026-01-05T10:00:00.000Z",
            "lastUpdated": "2026-01-05T10:05:00.000Z",
            "messages": [
                {
                    "id": "m1",
                    "timestamp": "2026-01-05T10:00:01.000Z",
                    "type": "user",
                    "content": [{ "text": "hi" }]
                },
                {
                    "id": "m2",
                    "timestamp": "2026-01-05T10:00:04.000Z",
                    "type": "gemini",
                    "model": "gemini-2.5-flash",
                    "content": [{ "text": "hello" }],
                    "tokens": { "input": 10, "output": 4, "cached": 0,
                                "thoughts": 0, "tool": 0, "total": 14 }
                }
            ]
        });
        std::fs::write(
            project_dir
                .join("chats")
                .join("session-2026-01-05T10-00-legacy12.json"),
            record.to_string(),
        )
        .unwrap();

        let events = collect_from(&home);
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|e| e.project_path.is_none()));
        assert_eq!(events[0].session_id.as_deref(), Some("legacy-session-1"));
        assert_eq!(events[1].usage.input_tokens, 10);
        assert_eq!(events[1].usage.output_tokens, 4);
        assert_eq!(events[1].usage.total_tokens, 14);
        assert_eq!(events[1].model.as_deref(), Some("gemini-2.5-flash"));

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn skips_corrupt_lines_and_control_records() {
        let (home, project_dir) = fixture_home("corrupt", "proj");
        let content = format!(
            "{}\nnot-json-at-all {{{{\n{}\n{}\n{}\n{}\n",
            json!({ "sessionId": "s1", "projectHash": "h", "startTime": "2026-07-10T09:00:00Z" }),
            json!({ "$set": { "summary": "renamed" } }),
            json!({ "$rewindTo": "some-message-id" }),
            // Message missing a timestamp → skipped without error.
            json!({ "id": "no-ts", "type": "gemini", "content": [] }),
            json!({ "id": "ok-1", "timestamp": "2026-07-10T09:00:05Z",
                    "type": "user", "content": [{ "text": "still here" }] }),
        );
        std::fs::write(project_dir.join("chats").join("session-x.jsonl"), content).unwrap();

        let events = collect_from(&home);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].metadata.get("uuid"), Some(&json!("ok-1")));
        assert_eq!(events[0].session_id.as_deref(), Some("s1"));

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn dedupe_key_inputs_are_stable_across_rescans() {
        let (home, project_dir) = fixture_home("dedupe", "proj");
        let rows = format!(
            "{}\n{}\n{}\n",
            json!({ "sessionId": "sess-1", "projectHash": "h", "startTime": "2026-07-10T09:00:00Z" }),
            json!({ "id": "uuid-a", "timestamp": "2026-07-10T09:00:01Z",
                    "type": "user", "content": [] }),
            // No native id → synthetic session#ordinal key.
            json!({ "timestamp": "2026-07-10T09:00:02Z", "type": "gemini",
                    "content": [], "tokens": { "input": 1, "output": 1,
                    "cached": 0, "thoughts": 0, "tool": 0, "total": 2 } }),
        );
        std::fs::write(project_dir.join("chats").join("session-y.jsonl"), rows).unwrap();

        let first = collect_from(&home);
        let second = collect_from(&home);
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].metadata.get("uuid"), Some(&json!("uuid-a")));
        // Ordinal counts message records only (head metadata excluded), so the
        // second message is #2 and stays #2 on every rescan.
        assert_eq!(first[1].metadata.get("uuid"), Some(&json!("sess-1#2")));
        for (a, b) in first.iter().zip(second.iter()) {
            assert_eq!(a.metadata.get("uuid"), b.metadata.get("uuid"));
            assert_eq!(a.session_id, b.session_id);
            assert_eq!(a.raw_ref, b.raw_ref);
        }

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn migrated_json_is_skipped_when_jsonl_sibling_exists() {
        // The CLI's .json → .jsonl migration re-appends every record into the
        // new file and can leave the old one behind; reading both would double
        // the session.
        let (home, project_dir) = fixture_home("migrate", "proj");
        let chats = project_dir.join("chats");
        let legacy = json!({
            "sessionId": "s-mig",
            "messages": [{ "id": "m1", "timestamp": "2026-07-10T09:00:01Z",
                           "type": "user", "content": [] }]
        });
        std::fs::write(chats.join("session-z.json"), legacy.to_string()).unwrap();
        let migrated = format!(
            "{}\n{}\n",
            json!({ "sessionId": "s-mig", "projectHash": "h", "startTime": "2026-07-10T09:00:00Z" }),
            json!({ "id": "m1", "timestamp": "2026-07-10T09:00:01Z", "type": "user", "content": [] }),
        );
        std::fs::write(chats.join("session-z.jsonl"), migrated).unwrap();

        let events = collect_from(&home);
        assert_eq!(events.len(), 1);
        assert!(events[0].raw_ref.as_deref().unwrap().contains(".jsonl"));

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn registry_fallback_recovers_project_path_and_subagents_are_walked() {
        let (home, project_dir) = fixture_home("registry", "my-garden");
        // No .project_root marker; projects.json maps path → slug.
        std::fs::write(
            home.join(".gemini").join("projects.json"),
            json!({ "projects": { "/Users/demo/my-garden": "my-garden" } }).to_string(),
        )
        .unwrap();
        // Subagent recording lives one level below chats/.
        let sub_dir = project_dir.join("chats").join("parent-session-id");
        std::fs::create_dir_all(&sub_dir).unwrap();
        let rows = format!(
            "{}\n{}\n",
            json!({ "sessionId": "sub-1", "projectHash": "h",
                    "startTime": "2026-07-10T09:00:00Z", "kind": "subagent",
                    "directories": ["/Users/demo/my-garden"] }),
            json!({ "id": "sm1", "timestamp": "2026-07-10T09:00:01Z",
                    "type": "gemini", "content": [],
                    "tokens": { "input": 3, "output": 1, "cached": 0,
                                "thoughts": 0, "tool": 0, "total": 4 } }),
        );
        std::fs::write(sub_dir.join("sub-1.jsonl"), rows).unwrap();

        let events = collect_from(&home);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].project_path.as_deref(),
            Some("/Users/demo/my-garden")
        );
        assert_eq!(events[0].session_id.as_deref(), Some("sub-1"));

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn reported_total_is_clamped_up_to_bucket_sum() {
        // Two counters from one upstream struct can still disagree after our
        // bucket mapping; total must never drop below the split it contains.
        let value = json!({
            "id": "m", "timestamp": "2026-07-10T09:00:01Z", "type": "gemini",
            "tokens": { "input": 100, "output": 20, "cached": 40,
                        "thoughts": 5, "tool": 0, "total": 1 }
        });
        let event = message_to_event("gemini-cli", &value, "s", None, "r", 1).unwrap();
        // split = 60 + 25 + 40 = 125 > reported 1 → clamped to 125.
        assert_eq!(event.usage.total_tokens, 125);
    }

    #[test]
    fn signal_less_system_rows_are_dropped() {
        let value = json!({
            "id": "sys", "timestamp": "2026-07-10T09:00:01Z",
            "type": "system", "content": [{ "text": "banner" }]
        });
        assert!(message_to_event("gemini-cli", &value, "s", None, "r", 1).is_none());
    }

    #[test]
    fn discover_false_without_gemini_tmp_dir() {
        let home = std::env::temp_dir().join(format!("lag-gemini-disc-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        let ctx = AdapterContext::with_home(&home);
        assert!(!GeminiCliAdapter::gemini().discover(&ctx));
        std::fs::remove_dir_all(&home).ok();
    }
}
