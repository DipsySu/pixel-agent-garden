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
use crate::adapters::util::{JsonlRow, as_int_opt, file_signature, parse_rfc3339_utc, read_jsonl};
use crate::error::Error;
use crate::event::{AgentEvent, TokenUsage};
use chrono::{DateTime, Utc};
use rusqlite::OpenFlags;
use rusqlite::types::{FromSql, FromSqlResult, ValueRef};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

const META_DB_UPDATED_AT: &str = "codex_db_updated_at";
const META_DB_TOTAL: &str = "codex_db_total";
const META_ROLLOUT_BYTES: &str = "codex_rollout_bytes";
const META_ROLLOUT_MTIME_MS: &str = "codex_rollout_mtime_ms";

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
    fn read_threads_db(
        &self,
        db_path: &Path,
        previous: &HashMap<String, &AgentEvent>,
    ) -> Vec<AgentEvent> {
        if !db_path.is_file() {
            return Vec::new();
        }
        // SQLite errors here are intentionally swallowed: Codex's schema can
        // vary between versions and we'd rather return partial data than
        // refuse to render the garden.
        // Open the path directly (not a `file:` URI): SQLITE_OPEN_READ_ONLY
        // already rejects writes, and a URI silently breaks when the home path
        // contains a `#`, `?`, or `%` — malforming the URI and dropping the
        // whole Codex source. A plain path has no such escaping hazard.
        let conn = match rusqlite::Connection::open_with_flags(
            db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };

        let sql = r#"
            SELECT id, rollout_path, created_at, updated_at, source, model_provider,
                   cwd, tokens_used, cli_version, model, reasoning_effort,
                   git_branch, archived
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
                tokens_used: row.get::<_, FlexInt>(7)?.0,
                cli_version: row.get::<_, FlexString>(8)?.0,
                model: row.get::<_, FlexString>(9)?.0,
                reasoning_effort: row.get::<_, FlexString>(10)?.0,
                git_branch: row.get::<_, FlexString>(11)?.0,
                archived: row.get::<_, FlexInt>(12)?.0,
            })
        });
        let Ok(rows) = rows else { return events };

        for row in rows.flatten() {
            let ts_str = row.updated_at.as_deref().or(row.created_at.as_deref());
            let Some(ts_str) = ts_str else { continue };
            let Some(timestamp) = parse_codex_timestamp(ts_str) else {
                continue;
            };
            let db_total = row.tokens_used.unwrap_or(0).max(0) as u64;
            let rollout_path = row
                .rollout_path
                .as_deref()
                .and_then(|path| resolve_rollout_path(path, db_path));
            if let Some(cached) = previous.get(&row.id).copied()
                && cached_thread_is_current(cached, ts_str, db_total, rollout_path.as_deref())
            {
                events.push(cached.clone());
                continue;
            }

            let mut event = AgentEvent::new(Self::NAME, timestamp);
            event.session_id = if row.id.is_empty() {
                None
            } else {
                Some(row.id.clone())
            };
            event.project_path = row.cwd.clone().filter(|s| !s.is_empty());
            event.event_type = "thread".to_string();
            event.usage = rollout_path
                .as_deref()
                .and_then(extract_rollout_usage)
                .unwrap_or_default();
            if db_total > 0 {
                // The SQLite thread row is Codex's canonical total and wins over
                // the rollout's own tally — but never DROPS BELOW the split
                // buckets it must contain. The total and the split come from two
                // stores that can disagree; clamping keeps `total >= input +
                // output + cache` so the cost math's `blended = total - split`
                // can't underflow and no bucket is ever priced beyond the total.
                let split = event.usage.input_tokens
                    + event.usage.output_tokens
                    + event.usage.cache_read_tokens
                    + event.usage.cache_write_tokens;
                event.usage.total_tokens = db_total.max(split);
            }
            event.model = row.model.clone();
            event.raw_ref = Some(
                rollout_path
                    .as_ref()
                    .map(|path| path.display().to_string())
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
            event.metadata.insert(
                META_DB_UPDATED_AT.into(),
                serde_json::Value::String(ts_str.to_string()),
            );
            event
                .metadata
                .insert(META_DB_TOTAL.into(), serde_json::Value::from(db_total));
            if let Some(path) = rollout_path.as_deref() {
                record_rollout_signature(&mut event, path);
            }
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
            events.push(event);
        }
        events
    }

    // ---- pass 3: rollout JSONL files -------------------------------------
    fn read_rollouts(
        &self,
        root: &Path,
        seen_sessions: &HashSet<String>,
        previous: &HashMap<String, &AgentEvent>,
    ) -> Vec<AgentEvent> {
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
            if let Some(cached) = previous.get(&session_id).copied()
                && cached_rollout_is_current(cached, &path)
            {
                events.push(cached.clone());
            } else if let Some(mut event) = parse_rollout(&path, &session_id) {
                record_rollout_signature(&mut event, &path);
                events.push(event);
            }
        }
        events
    }

    fn collect_with_previous(
        &self,
        ctx: &AdapterContext,
        previous: &[AgentEvent],
    ) -> Result<Vec<AgentEvent>, Error> {
        let root = Self::root(ctx);
        let previous = previous
            .iter()
            .filter_map(|event| event.session_id.as_ref().map(|id| (id.clone(), event)))
            .collect::<HashMap<_, _>>();
        let mut events = self.read_threads_db(&root.join("state_5.sqlite"), &previous);
        let mut seen: HashSet<String> =
            events.iter().filter_map(|e| e.session_id.clone()).collect();
        let index_events = self.read_session_index(&root.join("session_index.jsonl"), &seen);
        for event in &index_events {
            if let Some(session_id) = event.session_id.as_ref() {
                seen.insert(session_id.clone());
            }
        }
        events.extend(index_events);
        events.extend(self.read_rollouts(&root, &seen, &previous));
        Ok(events)
    }
}

impl Adapter for CodexAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        // Match everything `collect()` and `watch_paths()` actually read: a
        // Codex install that only writes rollout logs (sessions/) — no SQLite
        // db, no session index — is still a real, collectable source. Omitting
        // the rollout dirs here made `scan` skip the whole adapter (it gates
        // collect on discover), so those installs rendered as an empty garden.
        let root = Self::root(ctx);
        root.join("state_5.sqlite").is_file()
            || root.join("session_index.jsonl").is_file()
            || root.join("sessions").is_dir()
            || root.join("archived_sessions").is_dir()
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        self.collect_with_previous(ctx, &[])
    }

    fn collect_incremental(
        &self,
        ctx: &AdapterContext,
        previous: &[AgentEvent],
    ) -> Result<Vec<AgentEvent>, Error> {
        self.collect_with_previous(ctx, previous)
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
    tokens_used: Option<i64>,
    cli_version: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    git_branch: Option<String>,
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

fn resolve_rollout_path(raw_path: &str, anchor: &Path) -> Option<PathBuf> {
    if raw_path.trim().is_empty() {
        return None;
    }
    let path = PathBuf::from(raw_path);
    Some(if path.is_absolute() {
        path
    } else {
        anchor.parent().map(|p| p.join(&path)).unwrap_or(path)
    })
}

fn metadata_u64(event: &AgentEvent, key: &str) -> Option<u64> {
    event.metadata.get(key).and_then(|value| value.as_u64())
}

fn cached_rollout_is_current(event: &AgentEvent, path: &Path) -> bool {
    if event.raw_ref.as_deref() != Some(path.to_string_lossy().as_ref()) {
        return false;
    }
    let Some((bytes, modified_ms)) = file_signature(path) else {
        return false;
    };
    metadata_u64(event, META_ROLLOUT_BYTES) == Some(bytes)
        && metadata_u64(event, META_ROLLOUT_MTIME_MS) == Some(modified_ms)
}

fn cached_thread_is_current(
    event: &AgentEvent,
    updated_at: &str,
    db_total: u64,
    rollout_path: Option<&Path>,
) -> bool {
    if event
        .metadata
        .get(META_DB_UPDATED_AT)
        .and_then(|value| value.as_str())
        != Some(updated_at)
        || metadata_u64(event, META_DB_TOTAL) != Some(db_total)
    {
        return false;
    }
    match rollout_path {
        Some(path) => cached_rollout_is_current(event, path),
        None => true,
    }
}

fn record_rollout_signature(event: &mut AgentEvent, path: &Path) {
    let Some((bytes, modified_ms)) = file_signature(path) else {
        return;
    };
    event
        .metadata
        .insert(META_ROLLOUT_BYTES.into(), serde_json::Value::from(bytes));
    event.metadata.insert(
        META_ROLLOUT_MTIME_MS.into(),
        serde_json::Value::from(modified_ms),
    );
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

fn extract_rollout_usage(path: &Path) -> Option<TokenUsage> {
    let mut usage = TokenUsage::default();
    for JsonlRow { value, .. } in read_jsonl(path) {
        let Some(payload) = value.get("payload") else {
            continue;
        };
        if payload.get("type").and_then(|s| s.as_str()) != Some("token_count") {
            continue;
        }
        if let Some(cumulative) = extract_cumulative_token_usage(payload) {
            if cumulative.total_tokens >= usage.total_tokens {
                usage = cumulative;
            }
        } else {
            add_token_usage(&mut usage, &extract_incremental_token_usage(payload));
        }
    }
    (usage.total_tokens > 0).then_some(usage)
}

/// Walk a rollout JSONL file and aggregate it into ONE event.
fn parse_rollout(path: &Path, session_id: &str) -> Option<AgentEvent> {
    let mut last_ts: Option<String> = None;
    let mut meta_cwd: Option<String> = None;
    let mut meta_cli_version: Option<String> = None;
    let mut meta_timestamp: Option<String> = None;
    let mut model: Option<String> = None;
    let mut token_usage = TokenUsage::default();
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
                if let Some(cumulative) = extract_cumulative_token_usage(p) {
                    if cumulative.total_tokens >= token_usage.total_tokens {
                        token_usage = cumulative;
                    }
                } else {
                    add_token_usage(&mut token_usage, &extract_incremental_token_usage(p));
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
    event.usage = token_usage;
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

/// Best-effort token usage for one usage-ish object.
///
/// A `total_tokens` (or `tokens_used`) value already accounts for its own
/// input/output/cache components, so summing a total TOGETHER with the parts it
/// summarizes double-counts — the previous version did exactly that (a standard
/// `{input_tokens, output_tokens, total_tokens}` usage object inflated every
/// Codex row by ~2x). Prefer an explicit total; fall back to the component sum
/// only when no total is present; consult nested usage-ish objects under the
/// same rule, and only when this level carried nothing of its own.
///
/// Codex/OpenAI `input_tokens` includes cached input as a subset. Internally we
/// price by billable buckets, so `cached_input_tokens` is moved to
/// `cache_read_tokens` and subtracted from `input_tokens`.
///
/// Codex's current `token_count` payload carries both cumulative
/// `total_token_usage` and per-turn `last_token_usage`. Rollout aggregation
/// prefers the cumulative shape so repeated progress rows do not inflate the
/// session total.
fn extract_token_usage(data: &serde_json::Value) -> TokenUsage {
    let Some(obj) = data.as_object() else {
        return TokenUsage::default();
    };
    let total = as_int_opt(obj.get("total_tokens")).max(as_int_opt(obj.get("tokens_used")));
    let raw_input = as_int_opt(obj.get("input_tokens"));
    let cache_read = as_int_opt(obj.get("cache_read_tokens"))
        .max(as_int_opt(obj.get("cached_input_tokens")))
        .max(as_int_opt(obj.get("cached_tokens")))
        .max(
            obj.get("input_token_details")
                .and_then(|v| v.get("cached_tokens"))
                .map_or(0, |v| as_int_opt(Some(v))),
        );
    let mut usage = TokenUsage {
        input_tokens: raw_input.saturating_sub(cache_read),
        output_tokens: as_int_opt(obj.get("output_tokens")),
        cache_read_tokens: cache_read,
        cache_write_tokens: as_int_opt(obj.get("cache_write_tokens")),
        total_tokens: total,
    };
    if usage.total_tokens == 0 {
        usage.total_tokens = usage
            .input_tokens
            .saturating_add(usage.output_tokens)
            .saturating_add(usage.cache_read_tokens)
            .saturating_add(usage.cache_write_tokens);
    }
    if usage.total_tokens == 0 {
        for key in ["usage", "total_token_usage", "last_token_usage"] {
            if let Some(nested) = obj.get(key).filter(|v| v.is_object()) {
                let nested_usage = extract_token_usage(nested);
                if nested_usage.total_tokens > 0 {
                    return nested_usage;
                }
            }
        }
    }
    usage
}

fn extract_cumulative_token_usage(payload: &serde_json::Value) -> Option<TokenUsage> {
    let info = payload.get("info").filter(|v| v.is_object());
    for value in [
        info.and_then(|v| v.get("total_token_usage")),
        payload.get("total_token_usage"),
    ]
    .into_iter()
    .flatten()
    {
        let usage = extract_token_usage(value);
        if usage.total_tokens > 0 {
            return Some(usage);
        }
    }
    None
}

fn extract_incremental_token_usage(payload: &serde_json::Value) -> TokenUsage {
    let info = payload.get("info").filter(|v| v.is_object());
    for value in [
        info.and_then(|v| v.get("last_token_usage")),
        payload.get("last_token_usage"),
        payload.get("usage"),
        info,
        Some(payload),
    ]
    .into_iter()
    .flatten()
    {
        let usage = extract_token_usage(value);
        if usage.total_tokens > 0 {
            return usage;
        }
    }
    TokenUsage::default()
}

fn add_token_usage(dst: &mut TokenUsage, src: &TokenUsage) {
    dst.input_tokens = dst.input_tokens.saturating_add(src.input_tokens);
    dst.output_tokens = dst.output_tokens.saturating_add(src.output_tokens);
    dst.cache_read_tokens = dst.cache_read_tokens.saturating_add(src.cache_read_tokens);
    dst.cache_write_tokens = dst
        .cache_write_tokens
        .saturating_add(src.cache_write_tokens);
    dst.total_tokens = dst.total_tokens.saturating_add(src.total_tokens);
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
    fn extract_token_usage_prefers_total_over_nested_components() {
        // A total already includes its parts — take it, never add the parts on
        // top (the old behavior summed 10+5+7+3 = 25 and inflated every row).
        let v = json!({
            "total_tokens": 10,
            "input_tokens": 5,
            "usage": { "output_tokens": 7, "cached_tokens": 3 }
        });
        let usage = extract_token_usage(&v);
        assert_eq!(usage.total_tokens, 10);
        assert_eq!(usage.input_tokens, 5);
        assert_eq!(usage.output_tokens, 0);
        assert_eq!(usage.cache_read_tokens, 0);

        // No total anywhere → sum the components at this level.
        let split = json!({ "input_tokens": 6, "output_tokens": 4 });
        let usage = extract_token_usage(&split);
        assert_eq!(usage.total_tokens, 10);
        assert_eq!(usage.input_tokens, 6);
        assert_eq!(usage.output_tokens, 4);

        // Nothing at this level → fall through to a nested `usage` object.
        let nested = json!({ "usage": { "total_tokens": 8 } });
        assert_eq!(extract_token_usage(&nested).total_tokens, 8);
    }

    #[test]
    fn extract_token_usage_moves_cached_input_to_cache_read_bucket() {
        let v = json!({
            "input_tokens": 100,
            "cached_input_tokens": 70,
            "output_tokens": 10,
            "total_tokens": 110
        });
        let usage = extract_token_usage(&v);
        assert_eq!(usage.input_tokens, 30);
        assert_eq!(usage.cache_read_tokens, 70);
        assert_eq!(usage.output_tokens, 10);
        assert_eq!(usage.total_tokens, 110);
    }

    #[test]
    fn parse_rollout_uses_cumulative_usage_without_double_counting() {
        let tmp = std::env::temp_dir().join(format!("lag-codex-roll-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let path = tmp.join("rollout-2026-06-13T09-58-42-aaaa-bbbb-cccc-dddd-eeee.jsonl");
        let rows = [
            json!({
                "timestamp": "2026-06-13T01:58:55Z",
                "type": "session_meta",
                "payload": {
                    "cwd": "/tmp/demo-project",
                    "cli_version": "1.2.3",
                    "timestamp": "2026-06-13T01:58:55Z"
                }
            }),
            json!({
                "timestamp": "2026-06-13T01:58:56Z",
                "type": "turn_context",
                "payload": { "model": "gpt-5.5", "cwd": "/tmp/demo-project" }
            }),
            json!({
                "timestamp": "2026-06-13T01:58:57Z",
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "info": {
                        "total_token_usage": {
                            "input_tokens": 100,
                            "cached_input_tokens": 40,
                            "output_tokens": 10,
                            "total_tokens": 110
                        },
                        "last_token_usage": {
                            "input_tokens": 100,
                            "cached_input_tokens": 40,
                            "output_tokens": 10,
                            "total_tokens": 110
                        }
                    }
                }
            }),
            // Duplicate cumulative rows happen when rate-limit metadata changes;
            // keeping the max cumulative total avoids charging the same turn
            // twice.
            json!({
                "timestamp": "2026-06-13T01:58:58Z",
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "info": {
                        "total_token_usage": {
                            "input_tokens": 100,
                            "cached_input_tokens": 40,
                            "output_tokens": 10,
                            "total_tokens": 110
                        },
                        "last_token_usage": {
                            "input_tokens": 100,
                            "cached_input_tokens": 40,
                            "output_tokens": 10,
                            "total_tokens": 110
                        }
                    }
                }
            }),
            json!({
                "timestamp": "2026-06-13T01:58:59Z",
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "info": {
                        "total_token_usage": {
                            "input_tokens": 160,
                            "cached_input_tokens": 70,
                            "output_tokens": 20,
                            "total_tokens": 180
                        },
                        "last_token_usage": {
                            "input_tokens": 60,
                            "cached_input_tokens": 30,
                            "output_tokens": 10,
                            "total_tokens": 70
                        }
                    }
                }
            }),
        ]
        .into_iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        std::fs::write(&path, format!("{rows}\n")).unwrap();

        let event = parse_rollout(&path, "aaaa-bbbb-cccc-dddd-eeee").unwrap();
        assert_eq!(event.project_path.as_deref(), Some("/tmp/demo-project"));
        assert_eq!(event.model.as_deref(), Some("gpt-5.5"));
        assert_eq!(event.usage.input_tokens, 90);
        assert_eq!(event.usage.cache_read_tokens, 70);
        assert_eq!(event.usage.output_tokens, 20);
        assert_eq!(event.usage.total_tokens, 180);

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn incremental_collect_reuses_unchanged_rollout_and_reparses_append() {
        use std::io::Write as _;

        let home =
            std::env::temp_dir().join(format!("lag-codex-incremental-{}", std::process::id()));
        let sessions = home.join(".codex/sessions/2026/06/13");
        std::fs::create_dir_all(&sessions).unwrap();
        let path = sessions.join("rollout-2026-06-13T09-58-42-aaaa-bbbb-cccc-dddd-eeee.jsonl");
        let initial = [
            json!({
                "timestamp": "2026-06-13T01:58:55Z",
                "type": "session_meta",
                "payload": {
                    "cwd": "/tmp/demo-project",
                    "timestamp": "2026-06-13T01:58:55Z"
                }
            }),
            json!({
                "timestamp": "2026-06-13T01:58:57Z",
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "info": { "total_token_usage": { "total_tokens": 10 } }
                }
            }),
        ];
        std::fs::write(
            &path,
            initial
                .iter()
                .map(serde_json::Value::to_string)
                .collect::<Vec<_>>()
                .join("\n")
                + "\n",
        )
        .unwrap();

        let adapter = CodexAdapter;
        let ctx = AdapterContext::with_home(&home);
        let mut first = adapter.collect(&ctx).unwrap();
        assert_eq!(first.len(), 1);
        first[0]
            .metadata
            .insert("reuse_probe".into(), serde_json::Value::Bool(true));

        let reused = adapter.collect_incremental(&ctx, &first).unwrap();
        assert_eq!(
            reused[0].metadata.get("reuse_probe"),
            Some(&serde_json::Value::Bool(true))
        );

        let appended = json!({
            "timestamp": "2026-06-13T01:59:00Z",
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": { "total_token_usage": { "total_tokens": 20 } }
            }
        });
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writeln!(file, "{appended}").unwrap();

        let refreshed = adapter.collect_incremental(&ctx, &reused).unwrap();
        assert_eq!(refreshed[0].usage.total_tokens, 20);
        assert!(!refreshed[0].metadata.contains_key("reuse_probe"));
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn threads_db_enriches_canonical_total_with_rollout_split_usage() {
        let tmp = std::env::temp_dir().join(format!("lag-codex-db-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let rollout_path = tmp.join("rollout-2026-06-13T09-58-42-aaaa-bbbb-cccc-dddd-eeee.jsonl");
        let rollout = json!({
            "timestamp": "2026-06-13T01:58:57Z",
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 160,
                        "cached_input_tokens": 70,
                        "output_tokens": 20,
                        "total_tokens": 180
                    }
                }
            }
        });
        std::fs::write(&rollout_path, format!("{rollout}\n")).unwrap();

        let db_path = tmp.join("state_5.sqlite");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute(
            r#"
            CREATE TABLE threads (
                id TEXT,
                rollout_path TEXT,
                created_at TEXT,
                updated_at TEXT,
                source TEXT,
                model_provider TEXT,
                cwd TEXT,
                title TEXT,
                tokens_used INTEGER,
                cli_version TEXT,
                model TEXT,
                reasoning_effort TEXT,
                git_branch TEXT,
                first_user_message TEXT,
                archived INTEGER
            )
            "#,
            [],
        )
        .unwrap();
        conn.execute(
            r#"
            INSERT INTO threads VALUES (
                'session-a', ?1, '2026-06-13T01:58:00Z',
                '2026-06-13T01:59:00Z', 'codex-cli', 'openai',
                '/tmp/demo-project', 'demo title', 181, '1.2.3',
                'gpt-5.5', 'medium', 'main', 'hello', 0
            )
            "#,
            [rollout_path.to_string_lossy().as_ref()],
        )
        .unwrap();

        let events = CodexAdapter.read_threads_db(&db_path, &HashMap::new());
        assert_eq!(events.len(), 1);
        let usage = &events[0].usage;
        assert_eq!(usage.total_tokens, 181);
        assert_eq!(usage.input_tokens, 90);
        assert_eq!(usage.cache_read_tokens, 70);
        assert_eq!(usage.output_tokens, 20);
        assert_eq!(usage.cache_write_tokens, 0);
        assert!(!events[0].metadata.contains_key("title"));

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn threads_db_total_never_drops_below_rollout_split() {
        // Canonical DB total and rollout split come from two stores. When the DB
        // undercounts (150 < the 180 the rollout's own buckets sum to), the total
        // clamps UP to the split so `blended = total - split` stays >= 0 and no
        // bucket is ever priced beyond the reported total.
        let tmp = std::env::temp_dir().join(format!("lag-codex-clamp-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let rollout_path = tmp.join("rollout-2026-06-13T09-58-42-aaaa-bbbb-cccc-dddd-eeee.jsonl");
        let rollout = json!({
            "timestamp": "2026-06-13T01:58:57Z",
            "type": "event_msg",
            "payload": { "type": "token_count", "info": { "total_token_usage": {
                "input_tokens": 160, "cached_input_tokens": 70,
                "output_tokens": 20, "total_tokens": 180
            } } }
        });
        std::fs::write(&rollout_path, format!("{rollout}\n")).unwrap();

        let db_path = tmp.join("state_5.sqlite");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE threads (id TEXT, rollout_path TEXT, created_at TEXT, \
             updated_at TEXT, source TEXT, model_provider TEXT, cwd TEXT, title TEXT, \
             tokens_used INTEGER, cli_version TEXT, model TEXT, reasoning_effort TEXT, \
             git_branch TEXT, first_user_message TEXT, archived INTEGER)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO threads VALUES ('session-a', ?1, '2026-06-13T01:58:00Z', \
             '2026-06-13T01:59:00Z', 'codex-cli', 'openai', '/tmp/demo', 't', 150, \
             '1.2.3', 'gpt-5.5', 'medium', 'main', 'hi', 0)",
            [rollout_path.to_string_lossy().as_ref()],
        )
        .unwrap();

        let events = CodexAdapter.read_threads_db(&db_path, &HashMap::new());
        assert_eq!(events.len(), 1);
        let usage = &events[0].usage;
        // db_total (150) < split (90 + 70 + 20 = 180) → clamped up to 180.
        assert_eq!(usage.total_tokens, 180);
        assert_eq!(usage.input_tokens, 90);
        assert_eq!(usage.cache_read_tokens, 70);
        assert_eq!(usage.output_tokens, 20);

        std::fs::remove_dir_all(&tmp).ok();
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
    fn discover_true_with_only_sessions_dir() {
        // A Codex install with only rollout logs (sessions/) — no SQLite db, no
        // session index — is still collectable; discover must not skip it, or
        // scan (which gates collect on discover) renders those installs empty.
        let tmp = std::env::temp_dir().join(format!("lag-codex-sess-{}", std::process::id()));
        std::fs::create_dir_all(tmp.join(".codex").join("sessions")).unwrap();
        let ctx = AdapterContext::with_home(&tmp);
        assert!(CodexAdapter.discover(&ctx));
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
        assert!(!events[0].metadata.contains_key("title"));
        std::fs::remove_dir_all(&tmp).ok();
    }
}
