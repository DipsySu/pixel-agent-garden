//! Antigravity adapter — reads local, content-free conversation indexes.
//!
//! Neighbor boundary: this adapter lives under `~/.gemini/antigravity-cli/`,
//! sharing the `~/.gemini` parent with the Gemini CLI adapter's
//! `~/.gemini/tmp/` subtree (see `adapters::gemini_cli`). The subtrees are
//! disjoint; keep discovery/watching scoped below `antigravity-cli/` so the
//! two adapters never react to each other's writes.
//!
//! Antigravity CLI 1.1.1 stores its summary index at
//! `~/.gemini/antigravity-cli/conversation_summaries.db`. CLI releases that do
//! not populate that index still maintain `cache/last_conversations.json` and
//! one SQLite database per conversation. Those databases are used only for the
//! safe `trajectory_meta.cascade_id` field and `COUNT(*)` over `steps`.
//!
//! Privacy boundary: this adapter never selects `title`, `preview`,
//! `app_data_dir`, payload/metadata blobs, transcript, log, config or
//! authentication data. SQLite is opened read-only, and the watcher targets
//! only explicitly known files and their WALs.
//!
//! Token precision is intentionally `activity_only`: the summary index has no
//! authoritative usage counters, and tokens must never be estimated from text.
//! Usage may be added in the future only after Antigravity's private
//! per-conversation SQLite/protobuf store has been verified to expose
//! authoritative, non-duplicated token records through a stable contract.

use crate::adapter::{Adapter, AdapterContext};
use crate::adapters::util::is_portable_absolute_path;
use crate::error::Error;
use crate::event::AgentEvent;
use chrono::{DateTime, NaiveDateTime, Utc};
use rusqlite::OpenFlags;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

pub struct AntigravityAdapter;

impl AntigravityAdapter {
    pub const NAME: &'static str = "antigravity";

    fn root(ctx: &AdapterContext) -> PathBuf {
        ctx.home.join(".gemini").join("antigravity-cli")
    }

    fn db_path(ctx: &AdapterContext) -> PathBuf {
        Self::root(ctx).join("conversation_summaries.db")
    }

    fn last_conversations_path(ctx: &AdapterContext) -> PathBuf {
        Self::root(ctx)
            .join("cache")
            .join("last_conversations.json")
    }

    fn conversations_dir(ctx: &AdapterContext) -> PathBuf {
        Self::root(ctx).join("conversations")
    }

    fn read_db(path: &Path) -> Vec<AgentEvent> {
        let Ok(conn) =
            rusqlite::Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        else {
            return Vec::new();
        };

        // Antigravity may add columns over time, and older indexes may lack
        // optional metadata. Build the projection only from known safe column
        // names; never use SELECT * because content-bearing columns live in
        // this same table.
        let columns = table_columns(&conn);
        if !columns.contains("conversation_id") {
            return Vec::new();
        }

        const SAFE_COLUMNS: &[&str] = &[
            "conversation_id",
            "last_user_input_time",
            "last_modified_time",
            "workspace_uris",
            "step_count",
            "status",
            "source",
            "project_id",
            "agent_name",
            "parent_conversation_id",
            "nesting_depth",
            "battle_id",
            "winning_conversation_id",
            "not_fully_idle",
            "killed",
            "last_user_input_step_index",
        ];
        let projection = SAFE_COLUMNS
            .iter()
            .map(|column| {
                if columns.contains(*column) {
                    // These identifiers come only from the constant allowlist.
                    format!("CAST(\"{column}\" AS TEXT)")
                } else {
                    "NULL".to_string()
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        let sql =
            format!("SELECT {projection} FROM conversation_summaries ORDER BY conversation_id");
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return Vec::new();
        };
        let Ok(rows) = stmt.query_map([], |row| {
            Ok(SummaryRow {
                conversation_id: row.get(0)?,
                last_user_input_time: row.get(1)?,
                last_modified_time: row.get(2)?,
                workspace_uris: row.get(3)?,
                step_count: row.get(4)?,
                status: row.get(5)?,
                source: row.get(6)?,
                project_id: row.get(7)?,
                agent_name: row.get(8)?,
                parent_conversation_id: row.get(9)?,
                nesting_depth: row.get(10)?,
                battle_id: row.get(11)?,
                winning_conversation_id: row.get(12)?,
                not_fully_idle: row.get(13)?,
                killed: row.get(14)?,
                last_user_input_step_index: row.get(15)?,
            })
        }) else {
            return Vec::new();
        };

        rows.flatten()
            .filter_map(|row| row.into_event(path))
            .collect()
    }

    fn read_conversation_db(path: &Path, projects: &HashMap<String, String>) -> Option<AgentEvent> {
        let conn =
            rusqlite::Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;

        // These are deliberately the only two queries made against the
        // per-conversation store. In particular, never project columns from
        // `steps`: releases store content-bearing protobuf/blob values there.
        let step_count = conn
            .query_row("SELECT COUNT(*) FROM steps", [], |row| row.get::<_, u64>(0))
            .ok()?;
        let file_id = path.file_stem()?.to_str()?.trim();
        if file_id.is_empty() {
            return None;
        }
        let session_id = conn
            .query_row(
                "SELECT CAST(cascade_id AS TEXT) FROM trajectory_meta WHERE cascade_id IS NOT NULL AND TRIM(CAST(cascade_id AS TEXT)) <> '' LIMIT 1",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
            .and_then(|value| nonempty(Some(value)))
            .unwrap_or_else(|| file_id.to_string());
        let timestamp = DateTime::<Utc>::from(std::fs::metadata(path).ok()?.modified().ok()?);

        let mut event = AgentEvent::new(Self::NAME, timestamp);
        event.session_id = Some(session_id.clone());
        event.project_path = projects
            .get(file_id)
            .or_else(|| projects.get(&session_id))
            .cloned();
        if event.project_path.is_some() {
            event.metadata.insert(
                "project_source".to_string(),
                serde_json::Value::String("last_conversations".to_string()),
            );
        }
        event.raw_ref = Some(path.display().to_string());
        event.metadata.insert(
            "uuid".to_string(),
            serde_json::Value::String(format!("conversation:{session_id}")),
        );
        event.metadata.insert(
            "timestamp_source".to_string(),
            serde_json::Value::String("conversation_db_mtime".to_string()),
        );
        event.metadata.insert(
            "storage_kind".to_string(),
            serde_json::Value::String("conversation_db".to_string()),
        );
        event.metadata.insert(
            "step_count".to_string(),
            serde_json::Value::from(step_count),
        );
        event.metadata.insert(
            "token_precision".to_string(),
            serde_json::Value::String("activity_only".to_string()),
        );
        Some(event)
    }
}

impl Adapter for AntigravityAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        Self::db_path(ctx).is_file()
            || Self::last_conversations_path(ctx).is_file()
            || !conversation_db_paths(&Self::conversations_dir(ctx)).is_empty()
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let mut events = Self::read_db(&Self::db_path(ctx));
        let mut seen_ids = events
            .iter()
            .filter_map(|event| event.session_id.clone())
            .collect::<HashSet<_>>();
        let projects = read_last_conversations(&Self::last_conversations_path(ctx));
        for path in conversation_db_paths(&Self::conversations_dir(ctx)) {
            let Some(event) = Self::read_conversation_db(&path, &projects) else {
                continue;
            };
            let file_id = path
                .file_stem()
                .and_then(|value| value.to_str())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let Some(session_id) = event.session_id.as_ref() else {
                continue;
            };
            // The summary index may use the conversation database filename
            // while trajectory_meta exposes a different cascade id.
            if seen_ids.contains(session_id)
                || file_id.is_some_and(|file_id| seen_ids.contains(file_id))
            {
                continue;
            }
            seen_ids.insert(session_id.clone());
            if let Some(file_id) = file_id {
                seen_ids.insert(file_id.to_string());
            }
            events.push(event);
        }
        Ok(events)
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        let db = Self::db_path(ctx);
        let mut paths = vec![
            db.with_extension("db-wal"),
            db,
            Self::last_conversations_path(ctx),
        ];
        for conversation_db in conversation_db_paths(&Self::conversations_dir(ctx)) {
            paths.push(conversation_db.with_extension("db-wal"));
            paths.push(conversation_db);
        }
        paths
    }
}

fn read_last_conversations(path: &Path) -> HashMap<String, String> {
    let Ok(bytes) = std::fs::read(path) else {
        return HashMap::new();
    };
    let Ok(serde_json::Value::Object(object)) = serde_json::from_slice(&bytes) else {
        return HashMap::new();
    };
    let mut projects = HashMap::new();
    for (workspace, conversation_id) in object {
        let serde_json::Value::String(conversation_id) = conversation_id else {
            // Reject the complete mapping rather than silently trusting a
            // valid-looking subset of an unexpected schema.
            return HashMap::new();
        };
        let trimmed_workspace = workspace.trim();
        let trimmed_id = conversation_id.trim();
        if workspace != trimmed_workspace
            || conversation_id != trimmed_id
            || workspace.contains('\0')
            || !is_portable_absolute_path(&workspace)
            || conversation_id.is_empty()
        {
            return HashMap::new();
        }
        projects
            .entry(conversation_id.to_string())
            .or_insert_with(|| workspace.to_string());
    }
    projects
}

fn conversation_db_paths(directory: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut paths = entries
        .flatten()
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            let path = entry.path();
            (file_type.is_file() && path.extension().is_some_and(|value| value == "db"))
                .then_some(path)
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

#[derive(Debug)]
struct SummaryRow {
    conversation_id: Option<String>,
    last_user_input_time: Option<String>,
    last_modified_time: Option<String>,
    workspace_uris: Option<String>,
    step_count: Option<String>,
    status: Option<String>,
    source: Option<String>,
    project_id: Option<String>,
    agent_name: Option<String>,
    parent_conversation_id: Option<String>,
    nesting_depth: Option<String>,
    battle_id: Option<String>,
    winning_conversation_id: Option<String>,
    not_fully_idle: Option<String>,
    killed: Option<String>,
    last_user_input_step_index: Option<String>,
}

impl SummaryRow {
    fn into_event(self, db: &Path) -> Option<AgentEvent> {
        let conversation_id = nonempty(self.conversation_id)?;
        let timestamp = self
            .last_user_input_time
            .as_deref()
            .and_then(parse_timestamp)
            .or_else(|| self.last_modified_time.as_deref().and_then(parse_timestamp))?;

        let mut event = AgentEvent::new(AntigravityAdapter::NAME, timestamp);
        event.session_id = Some(conversation_id.clone());
        event.project_path = self.workspace_uris.as_deref().and_then(workspace_path);
        event.raw_ref = Some(format!("{}:conversation:{}", db.display(), conversation_id));
        event.metadata.insert(
            "uuid".to_string(),
            serde_json::Value::String(format!("conversation:{conversation_id}")),
        );
        event.metadata.insert(
            "token_precision".to_string(),
            serde_json::Value::String("activity_only".to_string()),
        );

        insert_u64(&mut event.metadata, "step_count", self.step_count);
        insert_text(&mut event.metadata, "status", self.status);
        insert_text(&mut event.metadata, "source", self.source);
        insert_text(&mut event.metadata, "project_id", self.project_id);
        insert_text(&mut event.metadata, "agent_name", self.agent_name);
        insert_text(
            &mut event.metadata,
            "parent_conversation_id",
            self.parent_conversation_id,
        );
        insert_u64(&mut event.metadata, "nesting_depth", self.nesting_depth);
        insert_text(&mut event.metadata, "battle_id", self.battle_id);
        insert_text(
            &mut event.metadata,
            "winning_conversation_id",
            self.winning_conversation_id,
        );
        insert_bool(&mut event.metadata, "not_fully_idle", self.not_fully_idle);
        insert_bool(&mut event.metadata, "killed", self.killed);
        insert_u64(
            &mut event.metadata,
            "last_user_input_step_index",
            self.last_user_input_step_index,
        );
        Some(event)
    }
}

fn table_columns(conn: &rusqlite::Connection) -> HashSet<String> {
    let Ok(mut stmt) = conn.prepare("PRAGMA table_info(\"conversation_summaries\")") else {
        return HashSet::new();
    };
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) else {
        return HashSet::new();
    };
    rows.flatten().collect()
}

fn parse_timestamp(raw: &str) -> Option<DateTime<Utc>> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }

    if let Ok(value) = raw.parse::<i64>() {
        return epoch(value);
    }
    if let Ok(value) = DateTime::parse_from_rfc3339(raw) {
        return Some(value.with_timezone(&Utc));
    }
    for format in ["%Y-%m-%d %H:%M:%S%.f%:z", "%Y-%m-%dT%H:%M:%S%.f%:z"] {
        if let Ok(value) = DateTime::parse_from_str(raw, format) {
            return Some(value.with_timezone(&Utc));
        }
    }
    for format in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f"] {
        if let Ok(value) = NaiveDateTime::parse_from_str(raw, format) {
            return Some(value.and_utc());
        }
    }
    None
}

fn epoch(value: i64) -> Option<DateTime<Utc>> {
    let magnitude = value.unsigned_abs();
    if magnitude >= 100_000_000_000_000_000 {
        let seconds = value.div_euclid(1_000_000_000);
        let nanos = value.rem_euclid(1_000_000_000) as u32;
        DateTime::from_timestamp(seconds, nanos)
    } else if magnitude >= 100_000_000_000_000 {
        let seconds = value.div_euclid(1_000_000);
        let nanos = (value.rem_euclid(1_000_000) * 1_000) as u32;
        DateTime::from_timestamp(seconds, nanos)
    } else if magnitude >= 100_000_000_000 {
        DateTime::from_timestamp_millis(value)
    } else {
        DateTime::from_timestamp(value, 0)
    }
}

fn workspace_path(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
        let mut candidates = Vec::new();
        collect_workspace_strings(&value, &mut candidates);
        return candidates
            .into_iter()
            .find_map(|value| absolute_path(&value));
    }
    absolute_path(raw)
}

fn collect_workspace_strings(value: &serde_json::Value, output: &mut Vec<String>) {
    match value {
        serde_json::Value::String(value) => output.push(value.clone()),
        serde_json::Value::Array(values) => {
            for value in values {
                collect_workspace_strings(value, output);
            }
        }
        // Some releases may wrap each URI in an object. Read only explicitly
        // URI-named fields, never labels or other arbitrary strings.
        serde_json::Value::Object(object) => {
            for key in ["uri", "workspace_uri", "workspaceUri"] {
                if let Some(value) = object.get(key) {
                    collect_workspace_strings(value, output);
                }
            }
        }
        _ => {}
    }
}

fn absolute_path(value: &str) -> Option<String> {
    let value = value.trim();
    let decoded = if let Some(rest) = value.strip_prefix("file://") {
        file_uri_path(rest)?
    } else {
        if value.contains("://") {
            return None;
        }
        value.to_string()
    };
    if decoded.contains('\0') || !is_portable_absolute_path(&decoded) {
        return None;
    }
    Some(decoded)
}

fn file_uri_path(rest: &str) -> Option<String> {
    let path = if rest.starts_with('/') {
        rest
    } else if let Some(path) = rest.strip_prefix("localhost/") {
        // Preserve the leading slash removed with the localhost authority.
        return percent_decode(&format!("/{path}"));
    } else {
        // A non-local URI authority is not a verifiable local project path.
        return None;
    };
    if path.contains('?') || path.contains('#') {
        return None;
    }
    percent_decode(path)
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = *bytes.get(index + 1)?;
            let low = *bytes.get(index + 2)?;
            decoded.push(hex(high)? * 16 + hex(low)?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn nonempty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn insert_text(
    metadata: &mut BTreeMap<String, serde_json::Value>,
    key: &str,
    value: Option<String>,
) {
    if let Some(value) = nonempty(value) {
        metadata.insert(key.to_string(), serde_json::Value::String(value));
    }
}

fn insert_u64(
    metadata: &mut BTreeMap<String, serde_json::Value>,
    key: &str,
    value: Option<String>,
) {
    if let Some(value) = value.and_then(|value| value.trim().parse::<u64>().ok()) {
        metadata.insert(key.to_string(), serde_json::Value::from(value));
    }
}

fn insert_bool(
    metadata: &mut BTreeMap<String, serde_json::Value>,
    key: &str,
    value: Option<String>,
) {
    let value = value
        .as_deref()
        .map(str::trim)
        .and_then(|value| match value {
            "1" | "true" | "TRUE" => Some(true),
            "0" | "false" | "FALSE" => Some(false),
            _ => None,
        });
    if let Some(value) = value {
        metadata.insert(key.to_string(), serde_json::Value::Bool(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::TokenUsage;
    use rusqlite::Connection;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    fn temp_home(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "agent-garden-antigravity-{label}-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn db_path(home: &Path) -> PathBuf {
        home.join(".gemini")
            .join("antigravity-cli")
            .join("conversation_summaries.db")
    }

    fn create_full_db(home: &Path) -> Connection {
        let path = db_path(home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY,
                title TEXT,
                preview TEXT,
                step_count INTEGER,
                last_modified_time datetime,
                workspace_uris TEXT,
                status TEXT,
                source TEXT,
                project_id TEXT,
                agent_name TEXT,
                parent_conversation_id TEXT,
                nesting_depth INTEGER,
                battle_id TEXT,
                winning_conversation_id TEXT,
                not_fully_idle INTEGER,
                killed INTEGER,
                last_user_input_time datetime,
                last_user_input_step_index INTEGER,
                app_data_dir TEXT
            );
            "#,
        )
        .unwrap();
        conn
    }

    fn conversation_db_path(home: &Path, id: &str) -> PathBuf {
        home.join(".gemini")
            .join("antigravity-cli")
            .join("conversations")
            .join(format!("{id}.db"))
    }

    fn create_conversation_db(home: &Path, file_id: &str, cascade_id: Option<&str>) -> PathBuf {
        let path = conversation_db_path(home, file_id);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE trajectory_meta (cascade_id TEXT, payload BLOB);
            CREATE TABLE steps (id INTEGER PRIMARY KEY, payload BLOB, metadata BLOB);
            "#,
        )
        .unwrap();
        conn.execute(
            "INSERT INTO trajectory_meta (cascade_id, payload) VALUES (?1, ?2)",
            rusqlite::params![cascade_id, b"SECRET TRAJECTORY BLOB"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO steps (payload, metadata) VALUES (?1, ?2)",
            rusqlite::params![b"SECRET STEP PAYLOAD", b"SECRET STEP METADATA"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO steps (payload, metadata) VALUES (?1, ?2)",
            rusqlite::params![b"SECRET TRANSCRIPT", b"SECRET AUTH"],
        )
        .unwrap();
        drop(conn);
        path
    }

    fn write_last_conversations(home: &Path, json: &str) -> PathBuf {
        let path = home
            .join(".gemini")
            .join("antigravity-cli")
            .join("cache")
            .join("last_conversations.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, json).unwrap();
        path
    }

    #[test]
    fn emits_one_activity_only_event_per_conversation_without_content() {
        let home = temp_home("activity");
        let conn = create_full_db(&home);
        conn.execute(
            r#"INSERT INTO conversation_summaries (
                conversation_id, title, preview, step_count,
                last_modified_time, last_user_input_time, workspace_uris,
                status, source, project_id, agent_name, nesting_depth,
                not_fully_idle, killed, app_data_dir
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"#,
            rusqlite::params![
                "conversation-1",
                "SECRET TITLE",
                "SECRET PREVIEW",
                8,
                "2026-07-10 10:00:00",
                "2026-07-11T12:34:56+00:00",
                r#"["/Users/example/project"]"#,
                "idle",
                "cli",
                "project-1",
                "default",
                0,
                0,
                0,
                "/SECRET/APP/DATA",
            ],
        )
        .unwrap();
        drop(conn);

        let events = AntigravityAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.source, "antigravity");
        assert_eq!(event.session_id.as_deref(), Some("conversation-1"));
        assert_eq!(event.timestamp.to_rfc3339(), "2026-07-11T12:34:56+00:00");
        assert_eq!(
            event.project_path.as_deref(),
            Some("/Users/example/project")
        );
        assert_eq!(event.event_type, "activity");
        assert_eq!(event.usage, TokenUsage::default());
        assert_eq!(event.tool_calls, 0);
        assert_eq!(event.model, None);
        assert_eq!(
            event.metadata.get("uuid").and_then(|value| value.as_str()),
            Some("conversation:conversation-1")
        );
        assert_eq!(
            event
                .metadata
                .get("token_precision")
                .and_then(|value| value.as_str()),
            Some("activity_only")
        );

        let serialized = serde_json::to_string(event).unwrap();
        assert!(!serialized.contains("SECRET TITLE"));
        assert!(!serialized.contains("SECRET PREVIEW"));
        assert!(!serialized.contains("SECRET/APP/DATA"));
        assert!(!event.metadata.contains_key("title"));
        assert!(!event.metadata.contains_key("preview"));
        assert!(!event.metadata.contains_key("app_data_dir"));
    }

    #[test]
    fn decodes_local_file_uri_and_rejects_relative_workspace() {
        assert_eq!(
            workspace_path(r#"["file:///Users/example/My%20Project/%E8%8A%B1%E5%9B%AD"]"#),
            Some("/Users/example/My Project/花园".to_string())
        );
        assert_eq!(
            workspace_path(r#"[{"uri":"file://localhost/Users/example/demo"}]"#),
            Some("/Users/example/demo".to_string())
        );
        assert_eq!(workspace_path(r#"["relative/project"]"#), None);
        assert_eq!(workspace_path(r#"["https://example.com/project"]"#), None);
        assert_eq!(workspace_path(r#"["file://server/share/project"]"#), None);
    }

    #[test]
    fn invalid_preferred_time_falls_back_and_fully_bad_time_is_skipped() {
        let home = temp_home("timestamps");
        let conn = create_full_db(&home);
        conn.execute(
            "INSERT INTO conversation_summaries (conversation_id, last_user_input_time, last_modified_time) VALUES (?1, ?2, ?3)",
            ("fallback", "not-a-time", "2026-07-10 10:00:00.123456"),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversation_summaries (conversation_id, last_user_input_time, last_modified_time) VALUES (?1, ?2, ?3)",
            ("bad", "still-not-a-time", "also-not-a-time"),
        )
        .unwrap();
        drop(conn);

        let events = AntigravityAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_id.as_deref(), Some("fallback"));
        assert_eq!(events[0].timestamp.timestamp_subsec_micros(), 123_456);
    }

    #[test]
    fn tolerates_older_minimal_schema_and_malformed_database() {
        let home = temp_home("old-schema");
        let path = db_path(&home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE conversation_summaries (conversation_id TEXT, last_modified_time TEXT);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversation_summaries VALUES (?1, ?2)",
            ("old", "2026-07-11 01:02:03"),
        )
        .unwrap();
        drop(conn);
        let events = AntigravityAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_id.as_deref(), Some("old"));

        std::fs::remove_file(&path).unwrap();
        std::fs::write(&path, "not sqlite").unwrap();
        assert!(
            AntigravityAdapter
                .collect(&AdapterContext::with_home(&home))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn falls_back_to_real_conversation_databases_without_reading_blobs() {
        let home = temp_home("conversation-fallback");
        let latest_db = create_conversation_db(&home, "latest-file-id", Some("latest-cascade-id"));
        let historical_db = create_conversation_db(&home, "historical-id", None);
        write_last_conversations(&home, r#"{"/Users/example/project":"latest-file-id"}"#);

        let events = AntigravityAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 2);

        let latest = events
            .iter()
            .find(|event| event.session_id.as_deref() == Some("latest-cascade-id"))
            .unwrap();
        assert_eq!(
            latest.project_path.as_deref(),
            Some("/Users/example/project")
        );
        assert_eq!(latest.raw_ref.as_deref(), latest_db.to_str());
        assert_eq!(
            latest.metadata.get("step_count").and_then(|v| v.as_u64()),
            Some(2)
        );
        assert_eq!(
            latest
                .metadata
                .get("timestamp_source")
                .and_then(|v| v.as_str()),
            Some("conversation_db_mtime")
        );
        assert_eq!(
            latest.metadata.get("storage_kind").and_then(|v| v.as_str()),
            Some("conversation_db")
        );
        assert_eq!(
            latest
                .metadata
                .get("project_source")
                .and_then(|v| v.as_str()),
            Some("last_conversations")
        );
        assert_eq!(
            latest
                .metadata
                .get("token_precision")
                .and_then(|v| v.as_str()),
            Some("activity_only")
        );
        assert_eq!(
            latest.timestamp,
            DateTime::<Utc>::from(std::fs::metadata(&latest_db).unwrap().modified().unwrap())
        );

        let historical = events
            .iter()
            .find(|event| event.session_id.as_deref() == Some("historical-id"))
            .unwrap();
        assert_eq!(historical.project_path, None);
        assert_eq!(historical.raw_ref.as_deref(), historical_db.to_str());

        let serialized = serde_json::to_string(&events).unwrap();
        for secret in [
            "SECRET TRAJECTORY BLOB",
            "SECRET STEP PAYLOAD",
            "SECRET STEP METADATA",
            "SECRET TRANSCRIPT",
            "SECRET AUTH",
        ] {
            assert!(!serialized.contains(secret));
        }
    }

    #[test]
    fn summary_event_wins_over_conversation_database_with_same_id() {
        let home = temp_home("summary-wins");
        let conn = create_full_db(&home);
        conn.execute(
            "INSERT INTO conversation_summaries (conversation_id, last_modified_time) VALUES (?1, ?2)",
            ("shared-id", "2026-07-11 01:02:03"),
        )
        .unwrap();
        drop(conn);
        create_conversation_db(&home, "shared-id", Some("shared-id"));

        let events = AntigravityAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_id.as_deref(), Some("shared-id"));
        assert!(!events[0].metadata.contains_key("storage_kind"));
        assert!(
            events[0]
                .raw_ref
                .as_deref()
                .unwrap()
                .contains("conversation_summaries.db")
        );
    }

    #[test]
    fn summary_file_id_alias_wins_without_dropping_unrelated_history() {
        let home = temp_home("summary-file-alias");
        let conn = create_full_db(&home);
        conn.execute(
            "INSERT INTO conversation_summaries (conversation_id, last_modified_time) VALUES (?1, ?2)",
            ("summary-file-id", "2026-07-11 01:02:03"),
        )
        .unwrap();
        drop(conn);
        create_conversation_db(&home, "summary-file-id", Some("different-cascade-id"));
        let historical_db =
            create_conversation_db(&home, "historical-file-id", Some("historical-cascade-id"));

        let events = AntigravityAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 2);

        let summary = events
            .iter()
            .find(|event| event.session_id.as_deref() == Some("summary-file-id"))
            .unwrap();
        assert!(!summary.metadata.contains_key("storage_kind"));
        assert!(
            summary
                .raw_ref
                .as_deref()
                .unwrap()
                .contains("conversation_summaries.db")
        );
        assert!(
            events
                .iter()
                .all(|event| event.session_id.as_deref() != Some("different-cascade-id"))
        );

        let historical = events
            .iter()
            .find(|event| event.session_id.as_deref() == Some("historical-cascade-id"))
            .unwrap();
        assert_eq!(historical.raw_ref.as_deref(), historical_db.to_str());
        assert_eq!(
            historical
                .metadata
                .get("storage_kind")
                .and_then(|value| value.as_str()),
            Some("conversation_db")
        );
    }

    #[test]
    fn rejects_entire_invalid_last_conversations_mapping() {
        let home = temp_home("invalid-mapping");
        create_conversation_db(&home, "mapped-id", Some("mapped-id"));
        write_last_conversations(
            &home,
            r#"{"/Users/example/project":"mapped-id","relative/project":"other-id"}"#,
        );

        let events = AntigravityAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].project_path, None);

        write_last_conversations(&home, r#"{"/Users/example/project":42}"#);
        let events = AntigravityAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].project_path, None);
    }

    #[test]
    fn discovery_and_watch_paths_are_limited_to_safe_exact_files() {
        let home = temp_home("privacy");
        let root = home.join(".gemini").join("antigravity-cli");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("auth.json"), "SECRET").unwrap();
        std::fs::write(root.join("config.json"), "SECRET").unwrap();
        assert!(!AntigravityAdapter.discover(&AdapterContext::with_home(&home)));

        let db = db_path(&home);
        let last_conversations = root.join("cache").join("last_conversations.json");
        assert_eq!(
            AntigravityAdapter.watch_paths(&AdapterContext::with_home(&home)),
            vec![
                db.with_extension("db-wal"),
                db.clone(),
                last_conversations.clone()
            ]
        );
        let paths = AntigravityAdapter.watch_paths(&AdapterContext::with_home(&home));
        assert!(!paths.contains(&root));
        assert!(!paths.contains(&root.join("cache")));
        assert!(!paths.contains(&root.join("conversations")));
        assert!(!paths.contains(&root.join("auth.json")));
        assert!(!paths.contains(&root.join("config.json")));

        let conversation_db = create_conversation_db(&home, "watch-id", Some("watch-id"));
        assert!(AntigravityAdapter.discover(&AdapterContext::with_home(&home)));
        let paths = AntigravityAdapter.watch_paths(&AdapterContext::with_home(&home));
        assert!(paths.contains(&conversation_db));
        assert!(paths.contains(&conversation_db.with_extension("db-wal")));
        assert!(paths.contains(&last_conversations));
        assert!(!paths.contains(&root.join("conversations")));
    }
}
