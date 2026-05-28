//! Codex adapter.
//!
//! Three input sources (all under `~/.codex/`):
//!   1. `state_5.sqlite`  — the `threads` table (canonical thread records)
//!   2. `session_index.jsonl` — fallback session list (rows whose id isn't
//!      already in the SQLite output)
//!   3. `sessions/**/*.jsonl` + `archived_sessions/*.jsonl` — rollouts
//!      (per-message logs; rows whose session_id isn't already covered)
//!
//! Errors from any of these are swallowed at the row level and surface as
//! "no event" rather than a hard failure.

use crate::adapter::{Adapter, AdapterContext};
use crate::adapters::util::{JsonlRow, as_int_opt, parse_rfc3339_utc, read_jsonl};
use crate::error::Error;
use crate::event::AgentEvent;
use chrono::{DateTime, Utc};
use rusqlite::OpenFlags;
use rusqlite::types::{FromSql, FromSqlResult, ValueRef};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Lenient column reader — Codex's SQLite stores timestamps either as ISO
/// 8601 TEXT or as INTEGER epoch (sec or ms) depending on CLI version.
/// `rusqlite`'s default `Option<String>` extraction errors on INTEGER cells,
/// which we observed dropping whole `threads` rows on real data. This type
/// accepts any non-blob value and renders it as a string so `parse_codex_timestamp`
/// can take it from there.
#[derive(Debug, Default, Clone)]
struct FlexString(pub Option<String>);

impl FromSql for FlexString {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        Ok(Self(match value {
            ValueRef::Null => None,
            ValueRef::Text(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
            ValueRef::Integer(n) => Some(n.to_string()),
            ValueRef::Real(f) => {
                // Render with full precision; parse_codex_timestamp will
                // route to its float / ISO branch as needed.
                Some(format!("{f}"))
            }
            ValueRef::Blob(_) => None,
        }))
    }
}

/// Same idea for integer columns — accept TEXT-encoded numbers too.
#[derive(Debug, Default, Clone)]
struct FlexInt(pub Option<i64>);

/// Wrap an optional &str as a JSON value: Some → String, None → Null.
/// Used to keep metadata keys visible even when values are absent.
fn str_or_null(s: Option<&str>) -> serde_json::Value {
    match s {
        Some(v) => serde_json::Value::String(v.to_string()),
        None => serde_json::Value::Null,
    }
}

impl FromSql for FlexInt {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        Ok(Self(match value {
            ValueRef::Null => None,
            ValueRef::Integer(n) => Some(n),
            ValueRef::Real(f) => Some(f as i64),
            ValueRef::Text(bytes) => std::str::from_utf8(bytes)
                .ok()
                .and_then(|s| s.trim().parse::<i64>().ok()),
            ValueRef::Blob(_) => None,
        }))
    }
}

pub struct CodexAdapter;

impl CodexAdapter {
    pub const NAME: &'static str = "codex";

    fn root(ctx: &AdapterContext) -> PathBuf {
        ctx.home.join(".codex")
    }

    // ---- pass 1: threads SQLite ------------------------------------------
    fn read_threads_db(&self, db_path: &Path) -> Vec<AgentEvent> {
        if !db_path.is_file() {
            return Vec::new();
        }
        // SQLite errors here are intentionally swallowed: Codex's schema can
        // vary between versions and we'd rather return partial data than
        // refuse to render the garden.
        let uri = format!("file:{}?mode=ro", db_path.display());
        let conn = match rusqlite::Connection::open_with_flags(
            &uri,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        ) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };

        let sql = r#"
            SELECT id, rollout_path, created_at, updated_at, source, model_provider,
                   cwd, title, tokens_used, cli_version, model, reasoning_effort,
                   git_branch, first_user_message, archived
            FROM threads
        "#;
        let Ok(mut stmt) = conn.prepare(sql) else {
            return Vec::new();
        };

        let mut events = Vec::new();
        let rows = stmt.query_map([], |row| {
            // Every column goes through Flex{String,Int} so we don't lose a
            // whole row to a single off-type cell. Codex's INTEGER-encoded
            // updated_at was the original offender — see commit notes.
            Ok(ThreadRow {
                id: row.get::<_, FlexString>(0)?.0.unwrap_or_default(),
                rollout_path: row.get::<_, FlexString>(1)?.0,
                created_at: row.get::<_, FlexString>(2)?.0,
                updated_at: row.get::<_, FlexString>(3)?.0,
                source: row.get::<_, FlexString>(4)?.0,
                model_provider: row.get::<_, FlexString>(5)?.0,
                cwd: row.get::<_, FlexString>(6)?.0,
                title: row.get::<_, FlexString>(7)?.0,
                tokens_used: row.get::<_, FlexInt>(8)?.0,
                cli_version: row.get::<_, FlexString>(9)?.0,
                model: row.get::<_, FlexString>(10)?.0,
                reasoning_effort: row.get::<_, FlexString>(11)?.0,
                git_branch: row.get::<_, FlexString>(12)?.0,
                first_user_message: row.get::<_, FlexString>(13)?.0,
                archived: row.get::<_, FlexInt>(14)?.0,
            })
        });
        let Ok(rows) = rows else { return events };

        for row in rows.flatten() {
            let ts_str = row.updated_at.as_deref().or(row.created_at.as_deref());
            let Some(ts_str) = ts_str else { continue };
            let Some(timestamp) = parse_codex_timestamp(ts_str) else {
                continue;
            };

            let mut event = AgentEvent::new(Self::NAME, timestamp);
            event.session_id = if row.id.is_empty() {
                None
            } else {
                Some(row.id.clone())
            };
            event.project_path = row.cwd.clone().filter(|s| !s.is_empty());
            event.event_type = "thread".to_string();
            event.usage.total_tokens = row.tokens_used.unwrap_or(0).max(0) as u64;
            event.model = row.model.clone();
            event.raw_ref = Some(
                row.rollout_path
                    .clone()
                    .unwrap_or_else(|| db_path.display().to_string()),
            );

            // Keep all source metadata keys visible even when the source row
            // had nothing for that field.
            event
                .metadata
                .insert("codex_source".into(), str_or_null(row.source.as_deref()));
            event.metadata.insert(
                "model_provider".into(),
                str_or_null(row.model_provider.as_deref()),
            );
            event.metadata.insert(
                "cli_version".into(),
                str_or_null(row.cli_version.as_deref()),
            );
            event.metadata.insert(
                "reasoning_effort".into(),
                str_or_null(row.reasoning_effort.as_deref()),
            );
            event
                .metadata
                .insert("git_branch".into(), str_or_null(row.git_branch.as_deref()));
            event.metadata.insert(
                "archived".into(),
                serde_json::Value::Bool(row.archived.unwrap_or(0) != 0),
            );
            let title_or_first = row
                .title
                .as_deref()
                .filter(|s| !s.is_empty())
                .or(row.first_user_message.as_deref());
            event.metadata.insert(
                "title".into(),
                shorten(title_or_first, 120)
                    .map(serde_json::Value::String)
                    .unwrap_or(serde_json::Value::Null),
            );
            event.normalize_totals();
            events.push(event);
        }
        events
    }

    // ---- pass 2: session_index.jsonl -------------------------------------
    fn read_session_index(&self, path: &Path, seen_sessions: &HashSet<String>) -> Vec<AgentEvent> {
        if !path.is_file() {
            return Vec::new();
        }
        let mut events = Vec::new();
        for row in read_jsonl(path) {
            let v = &row.value;
            let Some(session_id) = v.get("id").and_then(|s| s.as_str()) else {
                continue;
            };
            if seen_sessions.contains(session_id) {
                continue;
            }
            let Some(ts_str) = v.get("updated_at").and_then(|s| s.as_str()) else {
                continue;
            };
            let Some(timestamp) = parse_codex_timestamp(ts_str) else {
                continue;
            };
            let mut event = AgentEvent::new(Self::NAME, timestamp);
            event.session_id = Some(session_id.to_string());
            event.event_type = "session-index".to_string();
            event.raw_ref = Some(format!("{}:{}", path.display(), row.line_no));
            // Always emit `title`; missing thread_name → null.
            let title_value = v
                .get("thread_name")
                .and_then(|s| s.as_str())
                .and_then(|s| shorten(Some(s), 120))
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null);
            event.metadata.insert("title".into(), title_value);
            events.push(event);
        }
        events
    }

    // ---- pass 3: rollout JSONL files -------------------------------------
    fn read_rollouts(&self, root: &Path, seen_sessions: &HashSet<String>) -> Vec<AgentEvent> {
        let mut events = Vec::new();
        let mut paths: Vec<PathBuf> = Vec::new();
        collect_rollout_paths(&root.join("archived_sessions"), 1, &mut paths);
        collect_rollout_paths(&root.join("sessions"), 4, &mut paths);
        paths.sort();

        for path in paths {
            let session_id = session_id_from_rollout(&path);
            if seen_sessions.contains(&session_id) {
                continue;
            }
            if let Some(event) = parse_rollout(&path, &session_id) {
                events.push(event);
            }
        }
        events
    }
}

impl Adapter for CodexAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        let root = Self::root(ctx);
        root.join("state_5.sqlite").is_file() || root.join("session_index.jsonl").is_file()
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let root = Self::root(ctx);
        let mut events = self.read_threads_db(&root.join("state_5.sqlite"));
        let mut seen: HashSet<String> =
            events.iter().filter_map(|e| e.session_id.clone()).collect();
        let index_events = self.read_session_index(&root.join("session_index.jsonl"), &seen);
        for e in &index_events {
            if let Some(sid) = e.session_id.as_ref() {
                seen.insert(sid.clone());
            }
        }
        events.extend(index_events);
        events.extend(self.read_rollouts(&root, &seen));
        Ok(events)
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        let root = Self::root(ctx);
        let mut paths = Vec::new();
        let candidates = [
            root.join("state_5.sqlite"),
            root.join("session_index.jsonl"),
            root.join("sessions"),
            root.join("archived_sessions"),
        ];
        for c in candidates {
            if c.exists() {
                paths.push(c);
            }
        }
        paths
    }
}

struct ThreadRow {
    id: String,
    rollout_path: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    source: Option<String>,
    model_provider: Option<String>,
    cwd: Option<String>,
    title: Option<String>,
    tokens_used: Option<i64>,
    cli_version: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    git_branch: Option<String>,
    first_user_message: Option<String>,
    archived: Option<i64>,
}

/// Codex timestamps are usually unix epoch (int or string-of-int) for SQLite
/// rows and ISO 8601 for session_index. Be lenient: try int seconds, int
/// milliseconds, then ISO 8601.
fn parse_codex_timestamp(s: &str) -> Option<DateTime<Utc>> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(n) = trimmed.parse::<i64>() {
        let normalized = normalize_epoch(n);
        return DateTime::<Utc>::from_timestamp(normalized, 0);
    }
    parse_rfc3339_utc(trimmed)
}

fn normalize_epoch(v: i64) -> i64 {
    // Values above 1e10 are treated as millisecond-like epochs and divided
    // by 1000.
    if v > 10_000_000_000 { v / 1000 } else { v }
}

/// Glob equivalent to `sessions/**/*.jsonl` (depth 4 — Codex stores
/// `sessions/YYYY/MM/DD/<rollout>.jsonl`) and `archived_sessions/*.jsonl`
/// (flat). Implemented as a recursive walk with a depth cap so we never
/// descend into something pathological.
fn collect_rollout_paths(root: &Path, max_depth: usize, out: &mut Vec<PathBuf>) {
    if !root.is_dir() {
        return;
    }
    walk_jsonl(root, 0, max_depth, out);
}

fn walk_jsonl(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
            out.push(path);
        } else if path.is_dir() && depth < max_depth {
            walk_jsonl(&path, depth + 1, max_depth, out);
        }
    }
}

/// Extract a stable session_id from a rollout filename. Codex names them
/// `rollout-YYYY-MM-DD-<uuid_5_segments>.jsonl`; we take the last 5
/// dash-separated segments (uuid) and rejoin them. Files that don't match
/// the pattern fall back to the bare stem.
fn session_id_from_rollout(path: &Path) -> String {
    let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
        return String::new();
    };
    if !stem.starts_with("rollout-") {
        return stem.to_string();
    }
    let parts: Vec<&str> = stem.split('-').collect();
    if parts.len() < 5 {
        return stem.to_string();
    }
    let tail = &parts[parts.len() - 5..];
    tail.join("-")
}

/// Walk a rollout JSONL file and aggregate it into ONE event.
fn parse_rollout(path: &Path, session_id: &str) -> Option<AgentEvent> {
    let mut last_ts: Option<String> = None;
    let mut meta_cwd: Option<String> = None;
    let mut meta_cli_version: Option<String> = None;
    let mut meta_timestamp: Option<String> = None;
    let mut model: Option<String> = None;
    let mut token_total: u64 = 0;
    let mut tool_calls: u32 = 0;

    for JsonlRow { value, .. } in read_jsonl(path) {
        if let Some(ts) = value.get("timestamp").and_then(|s| s.as_str()) {
            last_ts = Some(ts.to_string());
        }
        let row_type = value.get("type").and_then(|s| s.as_str()).unwrap_or("");
        let payload = value.get("payload");
        if row_type == "session_meta" {
            if let Some(p) = payload.and_then(|p| p.as_object()) {
                if let Some(c) = p.get("cwd").and_then(|s| s.as_str()) {
                    meta_cwd = Some(c.to_string());
                }
                if let Some(v) = p.get("cli_version").and_then(|s| s.as_str()) {
                    meta_cli_version = Some(v.to_string());
                }
                if let Some(t) = p.get("timestamp").and_then(|s| s.as_str()) {
                    meta_timestamp = Some(t.to_string());
                }
            }
        }
        if row_type == "turn_context" {
            if let Some(p) = payload.and_then(|p| p.as_object()) {
                if let Some(m) = p.get("model").and_then(|s| s.as_str()) {
                    model = Some(m.to_string());
                }
                if let Some(c) = p.get("cwd").and_then(|s| s.as_str()) {
                    meta_cwd = meta_cwd.or(Some(c.to_string()));
                }
            }
        }
        if row_type == "response_item" {
            if let Some(p) = payload.and_then(|p| p.as_object()) {
                if p.get("type").and_then(|s| s.as_str()) == Some("function_call") {
                    tool_calls = tool_calls.saturating_add(1);
                }
            }
        }
        if let Some(p) = payload {
            if p.get("type").and_then(|s| s.as_str()) == Some("token_count") {
                token_total = token_total.saturating_add(extract_token_total(p));
            }
            if let Some(info) = p.get("info") {
                if info.is_object() {
                    token_total = token_total.saturating_add(extract_token_total(info));
                }
            }
        }
    }

    let ts_str = last_ts.or(meta_timestamp)?;
    let timestamp = parse_codex_timestamp(&ts_str)?;
    let mut event = AgentEvent::new(CodexAdapter::NAME, timestamp);
    event.project_path = meta_cwd.filter(|s| !s.is_empty());
    event.session_id = Some(session_id.to_string());
    event.event_type = "rollout".to_string();
    event.usage.total_tokens = token_total;
    event.tool_calls = tool_calls;
    event.model = model;
    event.raw_ref = Some(path.display().to_string());
    // Always emit cli_version (null when absent).
    event.metadata.insert(
        "cli_version".into(),
        meta_cli_version
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    );
    Some(event)
}

/// Recursively sum common token-count keys, including a nested `usage` object.
fn extract_token_total(data: &serde_json::Value) -> u64 {
    let Some(obj) = data.as_object() else {
        return 0;
    };
    const KEYS: &[&str] = &[
        "total_tokens",
        "tokens_used",
        "input_tokens",
        "output_tokens",
        "cached_tokens",
    ];
    let mut total: u64 = 0;
    for k in KEYS {
        total = total.saturating_add(as_int_opt(obj.get(*k)));
    }
    if let Some(usage) = obj.get("usage") {
        if usage.is_object() {
            total = total.saturating_add(extract_token_total(usage));
        }
    }
    total
}

/// Whitespace-collapse + truncate.
fn shorten(value: Option<&str>, limit: usize) -> Option<String> {
    let v = value?;
    let collapsed: String = v.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    if collapsed.chars().count() <= limit {
        Some(collapsed)
    } else {
        let truncated: String = collapsed.chars().take(limit - 1).collect();
        Some(format!("{}...", truncated))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn session_id_extracts_uuid_from_rollout_name() {
        // Typical rollout: rollout-YYYY-MM-DD-<uuid>
        let p = Path::new("rollout-2026-05-27-aaaa-bbbb-cccc-dddd-eeee.jsonl");
        // Last 5 segments: aaaa-bbbb-cccc-dddd-eeee
        assert_eq!(session_id_from_rollout(p), "aaaa-bbbb-cccc-dddd-eeee");
    }

    #[test]
    fn session_id_for_non_rollout_name_is_stem() {
        let p = Path::new("misc.jsonl");
        assert_eq!(session_id_from_rollout(p), "misc");
    }

    #[test]
    fn extract_token_total_sums_nested_usage() {
        let v = json!({
            "total_tokens": 10,
            "input_tokens": 5,
            "usage": {
                "output_tokens": 7,
                "cached_tokens": 3
            }
        });
        // 10 + 5 (top level) + 7 + 3 (nested) = 25
        assert_eq!(extract_token_total(&v), 25);
    }

    #[test]
    fn shorten_truncates_and_collapses_whitespace() {
        assert_eq!(
            shorten(Some("  hello   world "), 120),
            Some("hello world".into())
        );
        assert_eq!(shorten(Some(""), 120), None);
        assert_eq!(shorten(None, 120), None);
        // Historical behavior: `text[..limit - 1] + "..."`, so total length
        // is limit + 2 when truncating.
        let long = "a".repeat(200);
        let out = shorten(Some(&long), 50).unwrap();
        assert_eq!(out.chars().count(), 52);
        assert!(out.ends_with("..."));
    }

    #[test]
    fn parse_codex_timestamp_handles_epoch_and_iso() {
        use chrono::Datelike;
        use chrono::Timelike;

        // ISO 8601 — verify by date components rather than raw epoch number
        // (less brittle than baking in the unix-second value).
        let iso = parse_codex_timestamp("2026-05-27T04:05:25Z").unwrap();
        assert_eq!(iso.year(), 2026);
        assert_eq!(iso.month(), 5);
        assert_eq!(iso.day(), 27);
        assert_eq!(iso.hour(), 4);
        assert_eq!(iso.minute(), 5);
        assert_eq!(iso.second(), 25);

        // Epoch seconds round-trip
        let s = parse_codex_timestamp("1748313925").unwrap();
        assert_eq!(s.timestamp(), 1748313925);
        // Epoch milliseconds — same time as above
        let ms = parse_codex_timestamp("1748313925000").unwrap();
        assert_eq!(ms.timestamp(), 1748313925);
        // Garbage → None
        assert!(parse_codex_timestamp("definitely-not-a-time").is_none());
        assert!(parse_codex_timestamp("").is_none());
    }

    #[test]
    fn discover_false_without_codex_dir() {
        let tmp = std::env::temp_dir().join(format!("lag-codex-disc-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let ctx = AdapterContext::with_home(&tmp);
        let adapter = CodexAdapter;
        assert!(!adapter.discover(&ctx));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn session_index_skips_already_seen_sessions() {
        let tmp = std::env::temp_dir().join(format!("lag-codex-idx-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let path = tmp.join("session_index.jsonl");
        let content = format!(
            "{}\n{}\n",
            json!({ "id": "already-seen", "updated_at": "2026-05-27T04:05:25Z" }),
            json!({ "id": "new-one", "updated_at": "2026-05-27T05:00:00Z", "thread_name": "hello" })
        );
        std::fs::write(&path, content).unwrap();

        let mut seen = HashSet::new();
        seen.insert("already-seen".to_string());
        let adapter = CodexAdapter;
        let events = adapter.read_session_index(&path, &seen);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_id.as_deref(), Some("new-one"));
        assert_eq!(
            events[0].metadata.get("title"),
            Some(&serde_json::Value::String("hello".into()))
        );
        std::fs::remove_dir_all(&tmp).ok();
    }
}
