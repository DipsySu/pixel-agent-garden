//! Kiro CLI adapter — projects only local session metadata into events.
//!
//! Evidence and supported stores (verified 2026-07-11):
//!   - Kiro's official session-management documentation says every turn is
//!     saved locally, sessions are scoped by working directory, and session
//!     ids are UUIDs.
//!   - Current/classic CLI releases keep a session metadata snapshot at
//!     `~/.kiro/sessions/cli/<session>.json`; the allowlisted fields below are
//!     structural, while prompt-derived fields such as `title` are ignored.
//!     The sibling `.jsonl` contains prompts and responses and is deliberately
//!     never opened here.
//!   - TUI releases have used `data.sqlite3`, with safe identity/timing columns
//!     in `conversations_v2`: `key`, `conversation_id`, `created_at`, and
//!     `updated_at`. Its `value` column contains the conversation and is never
//!     selected. The legacy `conversations` table has no safe session id or
//!     timestamp outside `value`, so this adapter intentionally ignores it.
//!
//! Token precision is intentionally `activity_only`. Current releases may
//! serialize token-looking fields in private session state, but neither the
//! official storage contract nor a verified serializer establishes their
//! accounting semantics. SQLite's safe columns contain no usage counters.
//! Tokens are therefore never copied or estimated from private state, context
//! percentage, response size, or text.
//!
//! Privacy boundary: sibling `.jsonl` transcripts are never opened and SQLite
//! `value` is never selected. Metadata JSON is deserialized through an explicit
//! allowlist; unknown fields (including any future content-bearing fields) are
//! discarded and never emitted. SQLite databases are opened read-only. Watch
//! paths are limited to the CLI session directory and exact known database/WAL
//! files, never `~/.kiro/` itself.

use crate::adapter::{Adapter, AdapterContext};
use crate::error::Error;
use crate::event::AgentEvent;
use chrono::{DateTime, Utc};
use rusqlite::OpenFlags;
use serde::Deserialize;
use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub struct KiroAdapter;

impl KiroAdapter {
    pub const NAME: &'static str = "kiro";

    fn cli_sessions_dir(ctx: &AdapterContext) -> PathBuf {
        ctx.home.join(".kiro").join("sessions").join("cli")
    }

    fn database_paths(ctx: &AdapterContext) -> Vec<PathBuf> {
        let mut paths = Vec::new();
        let mut push = |path: PathBuf| {
            if !paths.contains(&path) {
                paths.push(path);
            }
        };

        // macOS native application-data location used by the TUI.
        push(
            ctx.home
                .join("Library")
                .join("Application Support")
                .join("kiro-cli")
                .join("data.sqlite3"),
        );

        // Linux/XDG location. Keep the deterministic fallback even when the
        // scan context supplies a custom XDG root so migrated stores remain
        // discoverable.
        if let Some(xdg) = &ctx.xdg_data_home {
            push(xdg.join("kiro-cli").join("data.sqlite3"));
        }
        push(
            ctx.home
                .join(".local")
                .join("share")
                .join("kiro-cli")
                .join("data.sqlite3"),
        );

        // Native Windows fallback. Some cross-platform builds still use the
        // Unix-style path above, so both exact paths are supported.
        push(
            ctx.home
                .join("AppData")
                .join("Roaming")
                .join("kiro-cli")
                .join("data.sqlite3"),
        );
        paths
    }

    fn read_session_metadata(path: &Path) -> Vec<AgentEvent> {
        let Ok(file) = std::fs::File::open(path) else {
            return Vec::new();
        };
        // Deserialize an explicit allowlist. Unknown fields are discarded;
        // conversation text lives in the sibling JSONL, which is never opened.
        let Ok(metadata) = serde_json::from_reader::<_, SessionMetadata>(file) else {
            return Vec::new();
        };

        let session_id = nonempty(metadata.session_id)
            .or_else(|| path.file_stem()?.to_str().and_then(nonempty_str));
        let Some(session_id) = session_id else {
            return Vec::new();
        };
        let project_path = nonempty(metadata.cwd);
        let updated_at = parse_json_timestamp(metadata.updated_at.as_ref());
        let created_at = parse_json_timestamp(metadata.created_at.as_ref());
        let file_timestamp = file_mtime(path);
        let model = metadata
            .session_state
            .as_ref()
            .and_then(|state| state.rts_model_state.as_ref())
            .and_then(|state| state.model_info.as_ref())
            .and_then(|info| nonempty(info.model_id.clone()));
        let turns = metadata
            .session_state
            .and_then(|state| state.conversation_metadata)
            .and_then(|metadata| metadata.user_turn_metadatas)
            .unwrap_or_default();

        if turns.is_empty() {
            return first_timestamp(&[
                (updated_at, "session_updated_at"),
                (created_at, "session_created_at"),
                (file_timestamp, "metadata_file_mtime"),
            ])
            .map(|(timestamp, timestamp_source)| {
                let mut event = session_event(
                    path,
                    &session_id,
                    project_path,
                    model,
                    timestamp,
                    "session",
                    "metadata_json",
                    "activity_only",
                    format!("session:{session_id}"),
                );
                set_timestamp_source(&mut event, timestamp_source);
                event
            })
            .into_iter()
            .collect();
        }

        turns
            .into_iter()
            .enumerate()
            .filter_map(|(index, turn)| {
                let (timestamp, timestamp_source) = first_timestamp(&[
                    (
                        parse_json_timestamp(turn.end_timestamp.as_ref()),
                        "turn_end_timestamp",
                    ),
                    (updated_at, "session_updated_at"),
                    (created_at, "session_created_at"),
                    (file_timestamp, "metadata_file_mtime"),
                ])?;
                let mut event = session_event(
                    path,
                    &session_id,
                    project_path.clone(),
                    model.clone(),
                    timestamp,
                    "message",
                    "metadata_json",
                    "activity_only",
                    format!("session:{session_id}:turn:{index}"),
                );
                set_timestamp_source(&mut event, timestamp_source);
                event.raw_ref = Some(format!("{}:turn:{index}", path.display()));
                if let Some(request_count) = json_u32(turn.total_request_count.as_ref()) {
                    event.metadata.insert(
                        "request_count".to_string(),
                        serde_json::Value::from(request_count),
                    );
                }
                Some(event)
            })
            .collect()
    }

    fn read_database(path: &Path) -> Vec<AgentEvent> {
        let Ok(conn) =
            rusqlite::Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        else {
            return Vec::new();
        };
        let columns = table_columns(&conn, "conversations_v2");
        if !columns.contains("key") || !columns.contains("conversation_id") {
            return Vec::new();
        }

        // These four names are the complete projection. In particular, never
        // add `value`: it contains prompts, responses and request metadata.
        let created = if columns.contains("created_at") {
            "CAST(created_at AS TEXT)"
        } else {
            "NULL"
        };
        let updated = if columns.contains("updated_at") {
            "CAST(updated_at AS TEXT)"
        } else {
            "NULL"
        };
        let sql = format!(
            "SELECT CAST(key AS TEXT), CAST(conversation_id AS TEXT), {created}, {updated} \
             FROM conversations_v2 ORDER BY conversation_id"
        );
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return Vec::new();
        };
        let Ok(rows) = stmt.query_map([], |row| {
            Ok(DbSession {
                project_path: row.get(0)?,
                session_id: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        }) else {
            return Vec::new();
        };
        let fallback = file_mtime(path);
        rows.flatten()
            .filter_map(|row| row.into_event(path, fallback))
            .collect()
    }

    fn supports_database(path: &Path) -> bool {
        let Ok(conn) =
            rusqlite::Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        else {
            return false;
        };
        let columns = table_columns(&conn, "conversations_v2");
        columns.contains("key") && columns.contains("conversation_id")
    }
}

impl Adapter for KiroAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        !session_metadata_paths(&Self::cli_sessions_dir(ctx)).is_empty()
            || Self::database_paths(ctx)
                .into_iter()
                .any(|path| path.is_file() && Self::supports_database(&path))
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let mut events = Vec::new();
        let mut seen_sessions = HashSet::new();

        // Current metadata wins over a migrated SQLite copy of the same UUID.
        for path in session_metadata_paths(&Self::cli_sessions_dir(ctx)) {
            let rows = Self::read_session_metadata(&path);
            let session_id = rows.first().and_then(|event| event.session_id.clone());
            let Some(session_id) = session_id else {
                continue;
            };
            if seen_sessions.insert(session_id) {
                events.extend(rows);
            }
        }
        for path in Self::database_paths(ctx) {
            if !path.is_file() || !Self::supports_database(&path) {
                continue;
            }
            for event in Self::read_database(&path) {
                let Some(session_id) = event.session_id.clone() else {
                    continue;
                };
                if seen_sessions.insert(session_id) {
                    events.push(event);
                }
            }
        }
        Ok(events)
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        let mut paths = Vec::new();
        let sessions = Self::cli_sessions_dir(ctx);
        if sessions.is_dir() {
            // This directory contains session snapshots/transcripts only and
            // is sufficiently narrow to detect newly created sessions. It is
            // not the credential-bearing ~/.kiro root.
            paths.push(sessions);
        }
        for db in Self::database_paths(ctx) {
            if db.is_file() && Self::supports_database(&db) {
                paths.push(wal_path(&db));
                paths.push(db);
            }
        }
        paths
    }
}

#[derive(Debug, Deserialize)]
struct SessionMetadata {
    session_id: Option<String>,
    cwd: Option<String>,
    created_at: Option<serde_json::Value>,
    updated_at: Option<serde_json::Value>,
    session_state: Option<SessionState>,
}

#[derive(Debug, Deserialize)]
struct SessionState {
    rts_model_state: Option<ModelState>,
    conversation_metadata: Option<ConversationMetadata>,
}

#[derive(Debug, Deserialize)]
struct ModelState {
    model_info: Option<ModelInfo>,
}

#[derive(Debug, Deserialize)]
struct ModelInfo {
    model_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ConversationMetadata {
    user_turn_metadatas: Option<Vec<TurnMetadata>>,
}

#[derive(Debug, Deserialize)]
struct TurnMetadata {
    end_timestamp: Option<serde_json::Value>,
    total_request_count: Option<serde_json::Value>,
}

#[derive(Debug)]
struct DbSession {
    project_path: Option<String>,
    session_id: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
}

impl DbSession {
    fn into_event(self, path: &Path, fallback: Option<DateTime<Utc>>) -> Option<AgentEvent> {
        let session_id = nonempty(self.session_id)?;
        let (timestamp, timestamp_source) = first_timestamp(&[
            (
                self.updated_at.as_deref().and_then(parse_timestamp_str),
                "sqlite_updated_at",
            ),
            (
                self.created_at.as_deref().and_then(parse_timestamp_str),
                "sqlite_created_at",
            ),
            (fallback, "sqlite_file_mtime"),
        ])?;
        let mut event = session_event(
            path,
            &session_id,
            nonempty(self.project_path),
            None,
            timestamp,
            "session",
            "sqlite_v2",
            "activity_only",
            format!("session:{session_id}"),
        );
        set_timestamp_source(&mut event, timestamp_source);
        event.raw_ref = Some(format!("{}:conversations_v2:{session_id}", path.display()));
        Some(event)
    }
}

#[allow(clippy::too_many_arguments)]
fn session_event(
    path: &Path,
    session_id: &str,
    project_path: Option<String>,
    model: Option<String>,
    timestamp: DateTime<Utc>,
    event_type: &str,
    storage_kind: &str,
    token_precision: &str,
    uuid: String,
) -> AgentEvent {
    let mut event = AgentEvent::new(KiroAdapter::NAME, timestamp);
    event.session_id = Some(session_id.to_string());
    event.project_path = project_path;
    event.model = model;
    event.event_type = event_type.to_string();
    event.raw_ref = Some(path.display().to_string());
    event
        .metadata
        .insert("uuid".to_string(), serde_json::Value::String(uuid));
    event.metadata.insert(
        "storage_kind".to_string(),
        serde_json::Value::String(storage_kind.to_string()),
    );
    event.metadata.insert(
        "token_precision".to_string(),
        serde_json::Value::String(token_precision.to_string()),
    );
    event
}

fn first_timestamp(
    candidates: &[(Option<DateTime<Utc>>, &'static str)],
) -> Option<(DateTime<Utc>, &'static str)> {
    candidates
        .iter()
        .find_map(|(timestamp, source)| timestamp.as_ref().map(|value| (*value, *source)))
}

fn set_timestamp_source(event: &mut AgentEvent, source: &str) {
    event.metadata.insert(
        "timestamp_source".to_string(),
        serde_json::Value::String(source.to_string()),
    );
}

fn session_metadata_paths(directory: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut paths = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let is_file = entry.file_type().ok()?.is_file();
            (is_file && path.extension().is_some_and(|ext| ext == "json")).then_some(path)
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

fn table_columns(conn: &rusqlite::Connection, table: &str) -> HashSet<String> {
    // `table` is supplied only by the constant call site above.
    let Ok(mut stmt) = conn.prepare(&format!("PRAGMA table_info(\"{table}\")")) else {
        return HashSet::new();
    };
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) else {
        return HashSet::new();
    };
    rows.flatten().collect()
}

fn file_mtime(path: &Path) -> Option<DateTime<Utc>> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()
        .map(DateTime::<Utc>::from)
}

fn parse_json_timestamp(value: Option<&serde_json::Value>) -> Option<DateTime<Utc>> {
    match value? {
        serde_json::Value::String(value) => parse_timestamp_str(value),
        serde_json::Value::Number(value) => value.as_f64().and_then(timestamp_from_number),
        _ => None,
    }
}

fn parse_timestamp_str(value: &str) -> Option<DateTime<Utc>> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .or_else(|| value.parse::<f64>().ok().and_then(timestamp_from_number))
}

fn timestamp_from_number(value: f64) -> Option<DateTime<Utc>> {
    if !value.is_finite() {
        return None;
    }
    let milliseconds = if value.abs() < 1_000_000_000_000.0 {
        value * 1000.0
    } else {
        value
    };
    if milliseconds < i64::MIN as f64 || milliseconds > i64::MAX as f64 {
        return None;
    }
    DateTime::<Utc>::from_timestamp_millis(milliseconds.round() as i64)
}

fn json_u64(value: Option<&serde_json::Value>) -> u64 {
    match value {
        Some(serde_json::Value::Number(value)) => value
            .as_u64()
            .or_else(|| value.as_i64().map(|value| value.max(0) as u64))
            .unwrap_or(0),
        Some(serde_json::Value::String(value)) => value.parse::<u64>().unwrap_or(0),
        _ => 0,
    }
}

fn json_u32(value: Option<&serde_json::Value>) -> Option<u32> {
    u32::try_from(json_u64(value))
        .ok()
        .filter(|value| *value > 0)
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty() && !trimmed.contains('\0')).then(|| trimmed.to_string())
    })
}

fn nonempty_str(value: &str) -> Option<String> {
    nonempty(Some(value.to_string()))
}

fn wal_path(path: &Path) -> PathBuf {
    let mut value: OsString = path.as_os_str().to_owned();
    value.push("-wal");
    PathBuf::from(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapter::Adapter;
    use rusqlite::Connection;
    use std::sync::atomic::{AtomicU64, Ordering};

    const SESSION_ID: &str = "f2946a26-3735-4b08-8d05-c928010302d5";
    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    fn temp_home(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "agent-garden-kiro-{label}-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn ctx(home: &Path) -> AdapterContext {
        AdapterContext::with_home(home)
    }

    fn sessions_dir(home: &Path) -> PathBuf {
        home.join(".kiro").join("sessions").join("cli")
    }

    fn write_current_session(home: &Path, id: &str, body: &str) -> PathBuf {
        let dir = sessions_dir(home);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{id}.json"));
        std::fs::write(&path, body).unwrap();
        path
    }

    fn db_path(home: &Path) -> PathBuf {
        home.join("Library")
            .join("Application Support")
            .join("kiro-cli")
            .join("data.sqlite3")
    }

    fn create_current_db(home: &Path) -> PathBuf {
        let path = db_path(home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE conversations_v2 (
                key TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                value TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
             );",
        )
        .unwrap();
        path
    }

    #[test]
    fn reads_current_metadata_as_activity_only() {
        let home = temp_home("current-metadata");
        let path = write_current_session(
            &home,
            SESSION_ID,
            &format!(
                r#"{{
                    "session_id":"{SESSION_ID}",
                    "cwd":"/Users/test/project",
                    "created_at":"2026-07-11T01:00:00Z",
                    "updated_at":"2026-07-11T01:02:00Z",
                    "session_state":{{
                      "rts_model_state":{{"model_info":{{"model_id":"claude-sonnet-4.6"}}}},
                      "conversation_metadata":{{"user_turn_metadatas":[
                        {{"input_token_count":0,"output_token_count":0,
                          "end_timestamp":1783731660,"total_request_count":2}},
                        {{"input_token_count":321,"output_token_count":45,
                          "end_timestamp":1783731720000,"total_request_count":1}}
                      ]}}
                    }},
                    "history":[{{"prompt":"SECRET PROMPT","response":"SECRET RESPONSE"}}]
                }}"#
            ),
        );
        // Sibling transcript is intentionally present and must not be needed.
        std::fs::write(
            path.with_extension("jsonl"),
            r#"{"kind":"Prompt","data":{"content":"TOP SECRET"}}"#,
        )
        .unwrap();

        let events = KiroAdapter.collect(&ctx(&home)).unwrap();
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|event| {
            event.session_id.as_deref() == Some(SESSION_ID)
                && event.project_path.as_deref() == Some("/Users/test/project")
                && event.model.as_deref() == Some("claude-sonnet-4.6")
        }));
        assert_eq!(events[0].usage.total_tokens, 0);
        assert_eq!(
            events[0].metadata["token_precision"],
            serde_json::Value::String("activity_only".to_string())
        );
        assert_eq!(events[1].usage.input_tokens, 0);
        assert_eq!(events[1].usage.output_tokens, 0);
        assert_eq!(events[1].usage.total_tokens, 0);
        assert_eq!(
            events[1].metadata["token_precision"],
            serde_json::Value::String("activity_only".to_string())
        );

        let serialized = serde_json::to_string(&events).unwrap();
        assert!(!serialized.contains("SECRET PROMPT"));
        assert!(!serialized.contains("SECRET RESPONSE"));
        assert!(!serialized.contains("TOP SECRET"));
    }

    #[test]
    fn sqlite_reads_only_safe_identity_and_timing_columns() {
        let home = temp_home("sqlite-safe");
        let path = create_current_db(&home);
        let conn = Connection::open(&path).unwrap();
        conn.execute(
            "INSERT INTO conversations_v2
             (key, conversation_id, value, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "/Users/test/sqlite-project",
                SESSION_ID,
                r#"{"history":[{"prompt":"DB SECRET","response":"AUTH SECRET"}],"access_token":"TOKEN SECRET"}"#,
                1_783_731_600_000_i64,
                1_783_731_720_000_i64,
            ],
        )
        .unwrap();
        drop(conn);

        let events = KiroAdapter.collect(&ctx(&home)).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_id.as_deref(), Some(SESSION_ID));
        assert_eq!(
            events[0].project_path.as_deref(),
            Some("/Users/test/sqlite-project")
        );
        assert_eq!(events[0].usage.total_tokens, 0);
        assert_eq!(events[0].model, None);
        assert_eq!(
            events[0].metadata["token_precision"],
            serde_json::Value::String("activity_only".to_string())
        );

        let serialized = serde_json::to_string(&events).unwrap();
        assert!(!serialized.contains("DB SECRET"));
        assert!(!serialized.contains("AUTH SECRET"));
        assert!(!serialized.contains("TOKEN SECRET"));
    }

    #[test]
    fn current_metadata_wins_when_sqlite_has_same_session() {
        let home = temp_home("dedupe-formats");
        write_current_session(
            &home,
            SESSION_ID,
            &format!(
                r#"{{"session_id":"{SESSION_ID}","cwd":"/current/project",
                    "updated_at":"2026-07-11T01:00:00Z"}}"#
            ),
        );
        let path = create_current_db(&home);
        let conn = Connection::open(&path).unwrap();
        conn.execute(
            "INSERT INTO conversations_v2 VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "/stale/project",
                SESSION_ID,
                "SECRET STALE BODY",
                1_783_731_600_000_i64,
                1_783_731_720_000_i64
            ],
        )
        .unwrap();
        drop(conn);

        let events = KiroAdapter.collect(&ctx(&home)).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].project_path.as_deref(), Some("/current/project"));
        assert_eq!(
            events[0].metadata["storage_kind"],
            serde_json::Value::String("metadata_json".to_string())
        );
    }

    #[test]
    fn malformed_metadata_and_database_are_skipped_independently() {
        let home = temp_home("malformed");
        write_current_session(&home, "broken", "{not json");
        let path = db_path(&home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"not sqlite and SECRET").unwrap();

        assert!(KiroAdapter.discover(&ctx(&home)));
        assert!(KiroAdapter.collect(&ctx(&home)).unwrap().is_empty());
    }

    #[test]
    fn sqlite_rows_are_deduplicated_by_session_id() {
        let home = temp_home("dedupe-rows");
        let path = create_current_db(&home);
        let conn = Connection::open(&path).unwrap();
        for project in ["/first", "/second"] {
            conn.execute(
                "INSERT INTO conversations_v2 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    project,
                    SESSION_ID,
                    "SECRET",
                    1_783_731_600_000_i64,
                    1_783_731_720_000_i64
                ],
            )
            .unwrap();
        }
        drop(conn);

        let events = KiroAdapter.collect(&ctx(&home)).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].project_path.as_deref(), Some("/first"));
    }

    #[test]
    fn discovery_and_watch_paths_stay_inside_session_artifacts() {
        let home = temp_home("watch");
        assert!(!KiroAdapter.discover(&ctx(&home)));
        assert!(KiroAdapter.watch_paths(&ctx(&home)).is_empty());

        write_current_session(
            &home,
            SESSION_ID,
            &format!(r#"{{"session_id":"{SESSION_ID}","updated_at":1783731720000}}"#),
        );
        let db = create_current_db(&home);
        let paths = KiroAdapter.watch_paths(&ctx(&home));
        assert_eq!(paths, vec![sessions_dir(&home), wal_path(&db), db.clone()]);
        assert!(!paths.contains(&home.join(".kiro")));
        assert!(!paths.contains(&home.join(".kiro").join("credentials")));
        assert!(!paths.contains(&home.join(".kiro").join("settings")));
        assert!(
            paths.iter().all(|path| {
                path == &sessions_dir(&home) || path == &db || path == &wal_path(&db)
            })
        );
    }

    #[test]
    fn xdg_database_path_is_supported_without_duplicates() {
        let home = temp_home("xdg");
        let xdg = home.join("xdg");
        let context = ctx(&home).with_xdg_data_home(&xdg);
        let path = xdg.join("kiro-cli").join("data.sqlite3");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE conversations_v2 (
               key TEXT, conversation_id TEXT, value TEXT,
               created_at INTEGER, updated_at INTEGER
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversations_v2 VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "/xdg/project",
                SESSION_ID,
                "SECRET",
                1_783_731_600_000_i64,
                1_783_731_720_000_i64
            ],
        )
        .unwrap();
        drop(conn);

        assert!(KiroAdapter.discover(&context));
        let events = KiroAdapter.collect(&context).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].project_path.as_deref(), Some("/xdg/project"));
    }

    #[test]
    fn shell_state_database_is_not_mistaken_for_agent_sessions() {
        let home = temp_home("shell-state");
        let path = db_path(&home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE auth_kv (key TEXT PRIMARY KEY, value TEXT);
             CREATE TABLE history (
               id INTEGER PRIMARY KEY, command TEXT, session_id TEXT,
               cwd TEXT, start_time INTEGER, end_time INTEGER
             );
             CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO history (command, session_id, cwd, start_time)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                "SECRET COMMAND",
                "shell-session",
                "/work",
                1_783_731_600_i64
            ],
        )
        .unwrap();
        drop(conn);

        let context = ctx(&home);
        assert!(!KiroAdapter.discover(&context));
        assert!(KiroAdapter.collect(&context).unwrap().is_empty());
        assert!(KiroAdapter.watch_paths(&context).is_empty());
    }
}
