//! Cursor adapter — emits local foreground Agent activity without reading chat text.
//!
//! Evidence (verified against Cursor 3.11.13 on 2026-07-11):
//!   - Cursor's official history documentation says regular Agent history is
//!     stored locally in SQLite, while Background Agent history is remote:
//!     <https://docs.cursor.com/en/agent/chat/history>.
//!   - The shipped `out/main.js` creates content-free identity/timing columns
//!     in the `composerHeaders` index: `composerId`, `workspaceId`,
//!     `createdAt`, `lastUpdatedAt`, `isArchived`, `isSubagent`, `recency`, and
//!     `checkpointAt`. The adapter selects exactly those columns and evaluates
//!     the adjacent
//!     `value` object only through three SQLite JSON paths
//!     (`isDraft`, `createdFromBackgroundAgent.bcId`, `agentLocation.type`)
//!     needed to reject drafts/cloud activity. The full value is never
//!     returned to Rust, and nothing is selected from `cursorDiskKV`.
//!   - The shipped `workspaceProjectPaths.js` maps a workspace to
//!     `~/.cursor/projects/<sanitized-workspace>/agent-transcripts/`. Current
//!     transcripts are nested as `<composer-id>/<composer-id>.jsonl`; the
//!     loader also accepts nested/flat `.txt` and `.jsonl` legacy shapes.
//!   - `composerHeaderStorageUtils.js` identifies subagents separately and
//!     migrates older `composer.composerHeaders` JSON into the table. Legacy
//!     JSON is queried with SQLite JSON paths that project only structural
//!     allowlist fields; title/name/subtitle and conversation content are
//!     never returned to Rust.
//!
//! Precision: `activity_only`. Cursor's local header counters are context or
//! cumulative UI state, not an authoritative billable token ledger, so this
//! adapter never emits or estimates tokens.
//!
//! Dedupe key: foreground `composerId`, stored as `metadata.uuid`. The current
//! table, legacy indexes, workspace migrations, and transcript paths are
//! merged into one event per id using the newest structural timestamp.
//!
//! Privacy boundary: source databases are opened read-only; `cursorDiskKV`,
//! transcript contents, prompts, responses, auth/config, checkpoints and
//! artifacts are never read. Complete header values are never projected or
//! returned; SQLite evaluates only the structural JSON paths above. Symlinked
//! databases, workspace roots, project roots, transcript directories, and
//! transcript files are ignored.

use crate::adapter::{Adapter, AdapterContext};
use crate::error::Error;
use crate::event::AgentEvent;
use chrono::{DateTime, Utc};
use rusqlite::OpenFlags;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub struct CursorAdapter;

impl CursorAdapter {
    pub const NAME: &'static str = "cursor";

    fn user_roots(ctx: &AdapterContext) -> Vec<PathBuf> {
        let candidates = [
            ctx.home
                .join("Library")
                .join("Application Support")
                .join("Cursor")
                .join("User"),
            ctx.home.join(".config").join("Cursor").join("User"),
            ctx.home
                .join("AppData")
                .join("Roaming")
                .join("Cursor")
                .join("User"),
        ];
        let mut roots = Vec::new();
        for candidate in candidates {
            if !roots.contains(&candidate) {
                roots.push(candidate);
            }
        }
        roots
    }

    fn projects_root(ctx: &AdapterContext) -> PathBuf {
        ctx.home.join(".cursor").join("projects")
    }

    fn database_paths(ctx: &AdapterContext) -> Vec<PathBuf> {
        let mut paths = Vec::new();
        for root in Self::user_roots(ctx) {
            let global = root.join("globalStorage").join("state.vscdb");
            if is_regular_file(&global) {
                paths.push(global);
            }
            let workspace_storage = root.join("workspaceStorage");
            for workspace in direct_child_dirs(&workspace_storage) {
                let db = workspace.join("state.vscdb");
                if is_regular_file(&db) {
                    paths.push(db);
                }
            }
        }
        paths
    }
}

impl Adapter for CursorAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        // Reuse the content-free collector so an explicitly cloud/background
        // transcript cannot make discovery disagree with collection.
        self.collect(ctx)
            .map(|events| !events.is_empty())
            .unwrap_or(false)
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let workspaces = read_workspace_index(ctx);
        let mut transcripts = scan_transcripts(&Self::projects_root(ctx));
        assign_transcript_projects(&mut transcripts, &workspaces);

        let transcript_ids = transcripts.keys().cloned().collect::<HashSet<_>>();
        let mut sessions = HashMap::<String, Session>::new();
        let mut excluded_ids = HashSet::new();
        for db in Self::database_paths(ctx) {
            let (headers, excluded) = read_current_headers(&db, &workspaces, &transcript_ids);
            excluded_ids.extend(excluded);
            for header in headers {
                merge_session(&mut sessions, header);
            }
            for key in ["composer.composerHeaders", "composer.composerData"] {
                let (headers, excluded) = read_legacy_headers(&db, key, &workspaces);
                excluded_ids.extend(excluded);
                for header in headers {
                    merge_session(&mut sessions, header);
                }
            }
        }

        // A local transcript is itself durable foreground evidence. It is
        // used only by path and mtime; its contents are deliberately unopened.
        for transcript in transcripts.into_values() {
            if !excluded_ids.contains(&transcript.id) {
                merge_session(&mut sessions, transcript.into_session());
            }
        }
        // A current structural cloud/background/draft marker is authoritative
        // over a stale legacy index and must not be resurrected by migration.
        for id in excluded_ids {
            sessions.remove(&id);
        }

        let mut events = sessions
            .into_values()
            .map(Session::into_event)
            .collect::<Vec<_>>();
        events.sort_by(|left, right| {
            left.timestamp
                .cmp(&right.timestamp)
                .then_with(|| left.session_id.cmp(&right.session_id))
        });
        Ok(events)
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        let mut paths = Vec::new();
        for db in Self::database_paths(ctx) {
            paths.push(db.with_extension("vscdb-wal"));
            paths.push(db);
        }
        for root in Self::user_roots(ctx) {
            for workspace in direct_child_dirs(&root.join("workspaceStorage")) {
                let marker = workspace.join("workspace.json");
                if is_regular_file(&marker) {
                    paths.push(marker);
                }
            }
        }
        // Watch only transcript roots, not all of ~/.cursor/projects: sibling
        // canvas, MCP, and terminal state changes are ordinary IDE activity
        // and must not trigger agent rescans.
        for project in direct_child_dirs(&Self::projects_root(ctx)) {
            let transcripts = project.join("agent-transcripts");
            if is_real_dir(&transcripts) {
                paths.push(transcripts);
            }
        }
        paths
    }
}

#[derive(Debug, Clone)]
struct WorkspaceInfo {
    id: String,
    path: String,
}

fn read_workspace_index(ctx: &AdapterContext) -> Vec<WorkspaceInfo> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for root in CursorAdapter::user_roots(ctx) {
        let workspace_storage = root.join("workspaceStorage");
        for workspace in direct_child_dirs(&workspace_storage) {
            let Some(id) = workspace
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(valid_id)
            else {
                continue;
            };
            let path = workspace.join("workspace.json");
            let Some(folder) = read_workspace_path(&path) else {
                continue;
            };
            let key = format!("{id}\0{folder}");
            if seen.insert(key) {
                output.push(WorkspaceInfo {
                    id: id.to_string(),
                    path: folder,
                });
            }
        }
    }
    output
}

fn read_workspace_path(path: &Path) -> Option<String> {
    if !is_regular_file(path) {
        return None;
    }
    let value = serde_json::from_slice::<serde_json::Value>(&std::fs::read(path).ok()?).ok()?;
    let object = value.as_object()?;
    // VS Code's workspace marker is a small path-only file. Read only the
    // documented structural path keys, never arbitrary nested strings.
    for key in ["folder", "workspace"] {
        if let Some(value) = object.get(key).and_then(|value| value.as_str()) {
            if let Some(path) = absolute_path(value) {
                return Some(path);
            }
        }
    }
    None
}

#[derive(Debug, Clone)]
struct Transcript {
    id: String,
    timestamp: DateTime<Utc>,
    path: PathBuf,
    project_slug: String,
    project_path: Option<String>,
}

impl Transcript {
    fn into_session(self) -> Session {
        Session {
            id: self.id,
            timestamp: self.timestamp,
            project_path: self.project_path,
            workspace_id: None,
            archived: None,
            raw_ref: self.path,
            storage_kind: "transcript_path",
            timestamp_source: "transcript_mtime",
        }
    }
}

fn scan_transcripts(projects_root: &Path) -> HashMap<String, Transcript> {
    let mut transcripts = HashMap::new();
    for project in direct_child_dirs(projects_root) {
        let Some(project_slug) = project
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(valid_id)
            .map(str::to_string)
        else {
            continue;
        };
        let root = project.join("agent-transcripts");
        if !is_real_dir(&root) {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_file() {
                if let Some(id) = transcript_file_id(&path, None) {
                    insert_transcript(&mut transcripts, id, path, &project_slug);
                }
                continue;
            }
            if !kind.is_dir() {
                continue;
            }
            let Some(directory_id) = entry
                .file_name()
                .to_str()
                .and_then(valid_id)
                .map(str::to_string)
            else {
                continue;
            };
            if directory_id == "subagents" || is_subagent_id(&directory_id) {
                continue;
            }
            let Ok(files) = std::fs::read_dir(&path) else {
                continue;
            };
            for file in files.flatten() {
                let Ok(file_kind) = file.file_type() else {
                    continue;
                };
                if !file_kind.is_file() || file_kind.is_symlink() {
                    continue;
                }
                let file_path = file.path();
                if let Some(id) = transcript_file_id(&file_path, Some(&directory_id)) {
                    insert_transcript(&mut transcripts, id, file_path, &project_slug);
                }
            }
        }
    }
    transcripts
}

fn transcript_file_id(path: &Path, directory_id: Option<&str>) -> Option<String> {
    let extension = path.extension()?.to_str()?;
    if extension != "jsonl" && extension != "txt" {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    let id = valid_id(stem)?;
    if is_subagent_id(id) {
        return None;
    }
    if let Some(directory_id) = directory_id {
        // The current serializer writes `<id>/<id>.jsonl`. Refuse unrelated
        // files sitting beside it instead of treating every text file as chat.
        if id != directory_id {
            return None;
        }
    }
    Some(id.to_string())
}

fn insert_transcript(
    transcripts: &mut HashMap<String, Transcript>,
    id: String,
    path: PathBuf,
    project_slug: &str,
) {
    let Some(timestamp) = file_mtime(&path) else {
        return;
    };
    let candidate = Transcript {
        id: id.clone(),
        timestamp,
        path,
        project_slug: project_slug.to_string(),
        project_path: None,
    };
    match transcripts.get(&id) {
        Some(existing) if existing.timestamp >= timestamp => {}
        _ => {
            transcripts.insert(id, candidate);
        }
    }
}

fn assign_transcript_projects(
    transcripts: &mut HashMap<String, Transcript>,
    workspaces: &[WorkspaceInfo],
) {
    let mut by_slug = HashMap::<String, Option<String>>::new();
    for workspace in workspaces {
        let slug = cursor_project_slug(&workspace.path);
        if slug.is_empty() {
            continue;
        }
        match by_slug.get(&slug) {
            None => {
                by_slug.insert(slug, Some(workspace.path.clone()));
            }
            Some(Some(existing)) if existing != &workspace.path => {
                // Cursor's sanitizer is lossy. A collision means the path
                // cannot be assigned truthfully, so leave it unknown.
                by_slug.insert(slug, None);
            }
            _ => {}
        }
    }
    for transcript in transcripts.values_mut() {
        transcript.project_path = by_slug
            .get(&transcript.project_slug)
            .and_then(|path| path.clone());
    }
}

fn cursor_project_slug(path: &str) -> String {
    let mut output = String::new();
    let mut separator = false;
    for character in path.chars() {
        if character.is_ascii_alphanumeric() {
            if separator && !output.is_empty() {
                output.push('-');
            }
            output.push(character);
            separator = false;
        } else {
            separator = true;
        }
    }
    output
}

#[derive(Debug, Clone)]
struct Session {
    id: String,
    timestamp: DateTime<Utc>,
    project_path: Option<String>,
    workspace_id: Option<String>,
    archived: Option<bool>,
    raw_ref: PathBuf,
    storage_kind: &'static str,
    timestamp_source: &'static str,
}

impl Session {
    fn into_event(self) -> AgentEvent {
        let mut event = AgentEvent::new(CursorAdapter::NAME, self.timestamp);
        event.session_id = Some(self.id.clone());
        event.project_path = self.project_path;
        event.raw_ref = Some(self.raw_ref.display().to_string());
        event.metadata.insert(
            "uuid".to_string(),
            serde_json::Value::String(format!("composer:{}", self.id)),
        );
        event.metadata.insert(
            "token_precision".to_string(),
            serde_json::Value::String("activity_only".to_string()),
        );
        event.metadata.insert(
            "storage_kind".to_string(),
            serde_json::Value::String(self.storage_kind.to_string()),
        );
        event.metadata.insert(
            "timestamp_source".to_string(),
            serde_json::Value::String(self.timestamp_source.to_string()),
        );
        if let Some(workspace_id) = self.workspace_id {
            event.metadata.insert(
                "workspace_id".to_string(),
                serde_json::Value::String(workspace_id),
            );
        }
        if let Some(archived) = self.archived {
            event
                .metadata
                .insert("is_archived".to_string(), serde_json::Value::Bool(archived));
        }
        event
    }
}

fn merge_session(sessions: &mut HashMap<String, Session>, candidate: Session) {
    let Some(existing) = sessions.get_mut(&candidate.id) else {
        sessions.insert(candidate.id.clone(), candidate);
        return;
    };
    let existing_is_indexed = existing.storage_kind != "transcript_path";
    let candidate_is_indexed = candidate.storage_kind != "transcript_path";
    if (candidate_is_indexed && !existing_is_indexed)
        || (candidate_is_indexed == existing_is_indexed && candidate.timestamp > existing.timestamp)
    {
        existing.timestamp = candidate.timestamp;
        existing.timestamp_source = candidate.timestamp_source;
        existing.raw_ref = candidate.raw_ref.clone();
    }
    if existing.project_path.is_none() {
        existing.project_path = candidate.project_path;
    }
    if existing.workspace_id.is_none() {
        existing.workspace_id = candidate.workspace_id;
    }
    if existing.archived.is_none() {
        existing.archived = candidate.archived;
    }
    // Prefer a structural index label over the transcript fallback without
    // changing the newer timestamp/raw reference selected above.
    if !existing_is_indexed && candidate_is_indexed {
        existing.storage_kind = candidate.storage_kind;
    }
}

fn read_current_headers(
    path: &Path,
    workspaces: &[WorkspaceInfo],
    transcript_ids: &HashSet<String>,
) -> (Vec<Session>, HashSet<String>) {
    let Some(conn) = open_read_only(path) else {
        return (Vec::new(), HashSet::new());
    };
    let required = [
        "composerId",
        "workspaceId",
        "createdAt",
        "lastUpdatedAt",
        "isArchived",
        "isSubagent",
        "recency",
        "checkpointAt",
    ];
    let columns = table_columns(&conn, "composerHeaders");
    if !required.iter().all(|column| columns.contains(*column)) {
        return (Vec::new(), HashSet::new());
    }

    // The complete `value` is deliberately never returned. It contains names,
    // subtitles and other content-bearing header state in Cursor 3.11. SQLite
    // projects only three structural flags needed to reject non-local rows.
    let sql = r#"
        SELECT CAST(composerId AS TEXT), CAST(workspaceId AS TEXT),
               CAST(createdAt AS TEXT), CAST(lastUpdatedAt AS TEXT),
               CAST(isArchived AS TEXT), CAST(isSubagent AS TEXT),
               CAST(recency AS TEXT), CAST(checkpointAt AS TEXT),
               CASE WHEN json_valid(value)
                    THEN CAST(json_extract(value, '$.isDraft') AS TEXT) END,
               CASE WHEN json_valid(value)
                    THEN CAST(json_extract(value, '$.createdFromBackgroundAgent.bcId') AS TEXT) END,
               CASE WHEN json_valid(value)
                    THEN CAST(json_extract(value, '$.agentLocation.type') AS TEXT) END
        FROM composerHeaders
        WHERE composerId IS NOT NULL AND TRIM(CAST(composerId AS TEXT)) <> ''
    "#;
    let Ok(mut stmt) = conn.prepare(sql) else {
        return (Vec::new(), HashSet::new());
    };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok(CurrentHeaderRow {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            created_at: row.get(2)?,
            last_updated_at: row.get(3)?,
            is_archived: row.get(4)?,
            is_subagent: row.get(5)?,
            recency: row.get(6)?,
            checkpoint_at: row.get(7)?,
            is_draft: row.get(8)?,
            background_id: row.get(9)?,
            location_type: row.get(10)?,
        })
    }) else {
        return (Vec::new(), HashSet::new());
    };
    let mut sessions = Vec::new();
    let mut excluded = HashSet::new();
    for row in rows.flatten() {
        if let Some(id) = row.excluded_id() {
            excluded.insert(id);
            continue;
        }
        if let Some(session) = row.into_session(path, workspaces, transcript_ids) {
            sessions.push(session);
        }
    }
    (sessions, excluded)
}

#[derive(Debug)]
struct CurrentHeaderRow {
    id: Option<String>,
    workspace_id: Option<String>,
    created_at: Option<String>,
    last_updated_at: Option<String>,
    is_archived: Option<String>,
    is_subagent: Option<String>,
    recency: Option<String>,
    checkpoint_at: Option<String>,
    is_draft: Option<String>,
    background_id: Option<String>,
    location_type: Option<String>,
}

impl CurrentHeaderRow {
    fn excluded_id(&self) -> Option<String> {
        let id = self.id.as_deref().and_then(valid_id)?;
        if id == "empty-state-draft"
            || is_subagent_id(id)
            || parse_bool(self.is_subagent.as_deref()) == Some(true)
            || parse_bool(self.is_draft.as_deref()) == Some(true)
            || nonempty(self.background_id.as_deref()).is_some()
            || nonlocal_location(self.location_type.as_deref())
        {
            Some(id.to_string())
        } else {
            None
        }
    }

    fn into_session(
        self,
        db_path: &Path,
        workspaces: &[WorkspaceInfo],
        transcript_ids: &HashSet<String>,
    ) -> Option<Session> {
        let id = self.id.as_deref().and_then(valid_id)?.to_string();
        if self.excluded_id().is_some() {
            return None;
        }

        // The table intentionally omits the local/cloud marker. A matching
        // local transcript is therefore the hard foreground gate and also
        // filters Cursor's startup ghost heads and empty drafts.
        if !transcript_ids.contains(&id) {
            return None;
        }
        let (timestamp, timestamp_source) = newest_timestamp(&[
            (self.checkpoint_at.as_deref(), "checkpoint_at"),
            (self.last_updated_at.as_deref(), "last_updated_at"),
            (self.recency.as_deref(), "recency"),
            (self.created_at.as_deref(), "created_at"),
        ])?;
        let workspace_id = self
            .workspace_id
            .as_deref()
            .and_then(valid_id)
            .map(str::to_string);
        let project_path = workspace_id
            .as_deref()
            .and_then(|id| unique_workspace_path(workspaces, id));
        Some(Session {
            id,
            timestamp,
            project_path,
            workspace_id,
            archived: parse_bool(self.is_archived.as_deref()),
            raw_ref: db_path.to_path_buf(),
            storage_kind: "composer_headers_table",
            timestamp_source,
        })
    }
}

fn read_legacy_headers(
    path: &Path,
    storage_key: &str,
    workspaces: &[WorkspaceInfo],
) -> (Vec<Session>, HashSet<String>) {
    let Some(conn) = open_read_only(path) else {
        return (Vec::new(), HashSet::new());
    };
    let columns = table_columns(&conn, "ItemTable");
    if !columns.contains("key") || !columns.contains("value") {
        return (Vec::new(), HashSet::new());
    }

    // JSON1 projects an explicit structural allowlist. It never returns the
    // complete header object or content fields to Rust.
    let sql = r#"
        SELECT
          CAST(json_extract(entry.value, '$.composerId') AS TEXT),
          CAST(json_extract(entry.value, '$.workspaceIdentifier.id') AS TEXT),
          CAST(json_extract(entry.value, '$.createdAt') AS TEXT),
          CAST(json_extract(entry.value, '$.lastUpdatedAt') AS TEXT),
          CAST(json_extract(entry.value, '$.isArchived') AS TEXT),
          CAST(json_extract(entry.value, '$.isDraft') AS TEXT),
          CAST(json_extract(entry.value, '$.createdFromBackgroundAgent.bcId') AS TEXT),
          CAST(json_extract(entry.value, '$.agentLocation.type') AS TEXT),
          CAST(json_extract(entry.value, '$.subagentInfo.parentComposerId') AS TEXT),
          CAST(json_extract(entry.value, '$.workspaceIdentifier.uri.fsPath') AS TEXT),
          CAST(json_extract(entry.value, '$.workspaceIdentifier.uri.path') AS TEXT)
        FROM (
          SELECT value FROM ItemTable
          WHERE key = ?1 AND json_valid(value)
        ) AS source,
        json_each(source.value, '$.allComposers') AS entry
        WHERE json_type(entry.value, '$.composerId') = 'text'
    "#;
    let Ok(mut stmt) = conn.prepare(sql) else {
        return (Vec::new(), HashSet::new());
    };
    let Ok(rows) = stmt.query_map([storage_key], |row| {
        Ok(LegacyHeaderRow {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            created_at: row.get(2)?,
            last_updated_at: row.get(3)?,
            is_archived: row.get(4)?,
            is_draft: row.get(5)?,
            background_id: row.get(6)?,
            location_type: row.get(7)?,
            parent_id: row.get(8)?,
            workspace_fs_path: row.get(9)?,
            workspace_uri_path: row.get(10)?,
        })
    }) else {
        return (Vec::new(), HashSet::new());
    };
    let mut sessions = Vec::new();
    let mut excluded = HashSet::new();
    for row in rows.flatten() {
        if let Some(id) = row.excluded_id() {
            excluded.insert(id);
            continue;
        }
        if let Some(session) = row.into_session(path, storage_key, workspaces) {
            sessions.push(session);
        }
    }
    (sessions, excluded)
}

#[derive(Debug)]
struct LegacyHeaderRow {
    id: Option<String>,
    workspace_id: Option<String>,
    created_at: Option<String>,
    last_updated_at: Option<String>,
    is_archived: Option<String>,
    is_draft: Option<String>,
    background_id: Option<String>,
    location_type: Option<String>,
    parent_id: Option<String>,
    workspace_fs_path: Option<String>,
    workspace_uri_path: Option<String>,
}

impl LegacyHeaderRow {
    fn excluded_id(&self) -> Option<String> {
        let id = self.id.as_deref().and_then(valid_id)?;
        if id == "empty-state-draft"
            || is_subagent_id(id)
            || parse_bool(self.is_draft.as_deref()) == Some(true)
            || nonempty(self.background_id.as_deref()).is_some()
            || nonempty(self.parent_id.as_deref()).is_some()
            || nonlocal_location(self.location_type.as_deref())
        {
            Some(id.to_string())
        } else {
            None
        }
    }

    fn into_session(
        self,
        db_path: &Path,
        storage_key: &str,
        workspaces: &[WorkspaceInfo],
    ) -> Option<Session> {
        let id = self.id.as_deref().and_then(valid_id)?.to_string();
        if self.excluded_id().is_some() {
            return None;
        }
        // A missing update is how current Cursor represents startup ghost
        // heads. Legacy sessions need an actual update, not creation alone.
        let timestamp = parse_timestamp(self.last_updated_at.as_deref())?;
        let workspace_id = self
            .workspace_id
            .as_deref()
            .and_then(valid_id)
            .map(str::to_string);
        let project_path = self
            .workspace_fs_path
            .as_deref()
            .and_then(absolute_path)
            .or_else(|| self.workspace_uri_path.as_deref().and_then(absolute_path))
            .or_else(|| {
                workspace_id
                    .as_deref()
                    .and_then(|id| unique_workspace_path(workspaces, id))
            });
        let storage_kind = if storage_key == "composer.composerHeaders" {
            "legacy_composer_headers"
        } else {
            "legacy_composer_data"
        };
        let _created_at = self.created_at;
        Some(Session {
            id,
            timestamp,
            project_path,
            workspace_id,
            archived: parse_bool(self.is_archived.as_deref()),
            raw_ref: db_path.to_path_buf(),
            storage_kind,
            timestamp_source: "last_updated_at",
        })
    }
}

fn unique_workspace_path(workspaces: &[WorkspaceInfo], id: &str) -> Option<String> {
    let mut matches = workspaces
        .iter()
        .filter(|workspace| workspace.id == id)
        .map(|workspace| workspace.path.clone());
    let first = matches.next()?;
    if matches.any(|path| path != first) {
        None
    } else {
        Some(first)
    }
}

fn open_read_only(path: &Path) -> Option<rusqlite::Connection> {
    if !is_regular_file(path) {
        return None;
    }
    rusqlite::Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
}

fn table_columns(conn: &rusqlite::Connection, table: &str) -> HashSet<String> {
    let allowed = match table {
        "composerHeaders" => Some("PRAGMA table_info(\"composerHeaders\")"),
        "ItemTable" => Some("PRAGMA table_info(\"ItemTable\")"),
        _ => None,
    };
    let Some(sql) = allowed else {
        return HashSet::new();
    };
    let Ok(mut stmt) = conn.prepare(sql) else {
        return HashSet::new();
    };
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) else {
        return HashSet::new();
    };
    rows.flatten().collect()
}

fn newest_timestamp<'a>(
    candidates: &[(Option<&str>, &'a str)],
) -> Option<(DateTime<Utc>, &'a str)> {
    candidates
        .iter()
        .filter_map(|(raw, source)| parse_timestamp(*raw).map(|time| (time, *source)))
        .max_by_key(|(time, _)| *time)
}

fn parse_timestamp(raw: Option<&str>) -> Option<DateTime<Utc>> {
    let raw = nonempty(raw)?;
    if let Ok(value) = raw.parse::<i64>() {
        let magnitude = value.unsigned_abs();
        if magnitude >= 100_000_000_000_000_000 {
            return DateTime::from_timestamp(
                value.div_euclid(1_000_000_000),
                value.rem_euclid(1_000_000_000) as u32,
            );
        }
        if magnitude >= 100_000_000_000_000 {
            return DateTime::from_timestamp(
                value.div_euclid(1_000_000),
                (value.rem_euclid(1_000_000) * 1_000) as u32,
            );
        }
        if magnitude >= 100_000_000_000 {
            return DateTime::from_timestamp_millis(value);
        }
        return DateTime::from_timestamp(value, 0);
    }
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn parse_bool(raw: Option<&str>) -> Option<bool> {
    match nonempty(raw)? {
        "1" | "true" | "TRUE" => Some(true),
        "0" | "false" | "FALSE" => Some(false),
        _ => None,
    }
}

fn nonlocal_location(raw: Option<&str>) -> bool {
    nonempty(raw).is_some_and(|location| location != "local")
}

fn nonempty(raw: Option<&str>) -> Option<&str> {
    raw.map(str::trim).filter(|value| !value.is_empty())
}

fn valid_id(raw: &str) -> Option<&str> {
    let raw = raw.trim();
    if raw.len() < 8
        || raw.len() > 200
        || raw.contains('\0')
        || !raw
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return None;
    }
    Some(raw)
}

fn is_subagent_id(id: &str) -> bool {
    id.starts_with("task-") || id.starts_with("subagent-")
}

fn is_real_dir(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_dir() && !metadata.file_type().is_symlink())
        .unwrap_or(false)
}

fn is_regular_file(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_file() && !metadata.file_type().is_symlink())
        .unwrap_or(false)
}

fn direct_child_dirs(path: &Path) -> Vec<PathBuf> {
    if !is_real_dir(path) {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|kind| kind.is_dir() && !kind.is_symlink())
                .map(|_| entry.path())
        })
        .collect()
}

fn file_mtime(path: &Path) -> Option<DateTime<Utc>> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return None;
    }
    Some(DateTime::<Utc>::from(metadata.modified().ok()?))
}

fn absolute_path(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let decoded = if let Some(rest) = raw.strip_prefix("file://") {
        decode_file_uri(rest)?
    } else {
        if raw.contains("://") {
            return None;
        }
        percent_decode(raw)?
    };
    let normalized = if decoded.starts_with('/')
        && decoded.as_bytes().get(2) == Some(&b':')
        && decoded
            .as_bytes()
            .get(1)
            .is_some_and(u8::is_ascii_alphabetic)
    {
        decoded[1..].to_string()
    } else {
        decoded
    };
    if normalized.contains('\0') || !Path::new(&normalized).is_absolute() {
        return None;
    }
    Some(normalized)
}

fn decode_file_uri(rest: &str) -> Option<String> {
    let path = if let Some(path) = rest.strip_prefix("localhost/") {
        format!("/{path}")
    } else if rest.starts_with('/') || rest.as_bytes().get(1) == Some(&b':') {
        rest.to_string()
    } else {
        // Reject network hosts/UNC paths: they are not safely attributable to
        // a local workspace without platform-specific mount knowledge.
        return None;
    };
    percent_decode(&path)
}

fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex(bytes.get(index + 1).copied()?)?;
            let low = hex(bytes.get(index + 2).copied()?)?;
            output.push((high << 4) | low);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).ok()
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
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
            "agent-garden-cursor-{label}-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn user_root(home: &Path) -> PathBuf {
        home.join("Library")
            .join("Application Support")
            .join("Cursor")
            .join("User")
    }

    fn global_db(home: &Path) -> PathBuf {
        user_root(home).join("globalStorage").join("state.vscdb")
    }

    fn workspace_dir(home: &Path, id: &str) -> PathBuf {
        user_root(home).join("workspaceStorage").join(id)
    }

    fn create_db(path: &Path) -> Connection {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE composerHeaders (
                composerId TEXT PRIMARY KEY,
                workspaceId TEXT,
                createdAt INTEGER,
                lastUpdatedAt INTEGER,
                isArchived INTEGER,
                isSubagent INTEGER,
                recency INTEGER,
                checkpointAt INTEGER,
                value TEXT
            );
            CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB);
            CREATE TABLE cursorDiskKV (key TEXT UNIQUE, value BLOB);
            "#,
        )
        .unwrap();
        conn
    }

    fn write_workspace(home: &Path, id: &str, folder: &str) {
        let path = workspace_dir(home, id).join("workspace.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, serde_json::json!({ "folder": folder }).to_string()).unwrap();
    }

    fn write_transcript(home: &Path, project_slug: &str, id: &str, content: &str) -> PathBuf {
        let path = home
            .join(".cursor")
            .join("projects")
            .join(project_slug)
            .join("agent-transcripts")
            .join(id)
            .join(format!("{id}.jsonl"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn reads_current_safe_columns_and_real_transcript_only() {
        let home = temp_home("current");
        let workspace_id = "0123456789abcdef0123456789abcdef";
        write_workspace(&home, workspace_id, "file:///Users/example/My%20Project");
        let real_id = "11111111-1111-4111-8111-111111111111";
        write_transcript(
            &home,
            "Users-example-My-Project",
            real_id,
            "SECRET PROMPT AND RESPONSE",
        );
        let conn = create_db(&global_db(&home));
        conn.execute(
            "INSERT INTO composerHeaders VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            rusqlite::params![
                real_id,
                workspace_id,
                1_783_700_000_000_i64,
                1_783_700_001_000_i64,
                0,
                0,
                1_783_700_001_000_i64,
                1_783_700_002_000_i64,
                "SECRET TITLE SUBTITLE BODY AUTH TOKEN"
            ],
        )
        .unwrap();
        // Startup ghost and the special empty draft must not become activity.
        conn.execute(
            "INSERT INTO composerHeaders VALUES (?1,?2,?3,NULL,0,0,?3,NULL,?4)",
            rusqlite::params![
                "22222222-2222-4222-8222-222222222222",
                workspace_id,
                1_783_700_000_000_i64,
                "SECRET GHOST"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO composerHeaders VALUES ('empty-state-draft','empty-window',1,2,0,0,2,NULL,'SECRET DRAFT')",
            [],
        )
        .unwrap();
        drop(conn);

        let events = CursorAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.session_id.as_deref(), Some(real_id));
        assert_eq!(
            event.project_path.as_deref(),
            Some("/Users/example/My Project")
        );
        assert_eq!(event.usage, TokenUsage::default());
        assert_eq!(event.timestamp.timestamp_millis(), 1_783_700_002_000);
        assert_eq!(
            event
                .metadata
                .get("token_precision")
                .and_then(|v| v.as_str()),
            Some("activity_only")
        );
        let serialized = serde_json::to_string(event).unwrap();
        assert!(!serialized.contains("SECRET"));
        assert!(!serialized.contains("prompt"));
        assert!(!event.metadata.contains_key("title"));
        assert!(!event.metadata.contains_key("name"));
    }

    #[test]
    fn legacy_allowlist_excludes_draft_background_cloud_and_subagent() {
        let home = temp_home("legacy");
        let conn = create_db(&global_db(&home));
        let foreground = serde_json::json!({
            "type": "head",
            "composerId": "33333333-3333-4333-8333-333333333333",
            "createdAt": 1_783_700_000_000_i64,
            "lastUpdatedAt": 1_783_700_003_000_i64,
            "isDraft": false,
            "workspaceIdentifier": {
                "id": "legacy-workspace",
                "uri": { "fsPath": "/Users/example/legacy" }
            },
            "name": "SECRET TITLE",
            "subtitle": "SECRET PREVIEW",
            "conversationMap": { "SECRET": "SECRET RESPONSE" }
        });
        let draft = serde_json::json!({
            "type": "head", "composerId": "44444444-4444-4444-8444-444444444444",
            "lastUpdatedAt": 1_783_700_003_000_i64, "isDraft": true
        });
        let background = serde_json::json!({
            "type": "head", "composerId": "55555555-5555-4555-8555-555555555555",
            "lastUpdatedAt": 1_783_700_003_000_i64,
            "createdFromBackgroundAgent": { "bcId": "remote-run" }
        });
        let cloud = serde_json::json!({
            "type": "head", "composerId": "66666666-6666-4666-8666-666666666666",
            "lastUpdatedAt": 1_783_700_003_000_i64,
            "agentLocation": { "type": "cloud" }
        });
        let subagent = serde_json::json!({
            "type": "head", "composerId": "77777777-7777-4777-8777-777777777777",
            "lastUpdatedAt": 1_783_700_003_000_i64,
            "subagentInfo": { "parentComposerId": "33333333-3333-4333-8333-333333333333" }
        });
        for id in [
            "44444444-4444-4444-8444-444444444444",
            "55555555-5555-4555-8555-555555555555",
            "66666666-6666-4666-8666-666666666666",
            "77777777-7777-4777-8777-777777777777",
        ] {
            write_transcript(&home, "Users-example-legacy", id, "SECRET TRANSCRIPT");
        }
        conn.execute(
            "INSERT INTO ItemTable VALUES ('composer.composerHeaders', ?1)",
            [serde_json::json!({
                "allComposers": [foreground, draft, background, cloud, subagent]
            })
            .to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO cursorDiskKV VALUES (?1, ?2)",
            ("agentKv:bubble:SECRET", "SECRET AUTH PROMPT RESPONSE"),
        )
        .unwrap();
        drop(conn);

        let events = CursorAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].session_id.as_deref(),
            Some("33333333-3333-4333-8333-333333333333")
        );
        assert!(!events.iter().any(|event| {
            event.session_id.as_deref() == Some("55555555-5555-4555-8555-555555555555")
        }));
        assert_eq!(
            events[0].project_path.as_deref(),
            Some("/Users/example/legacy")
        );
        assert!(!serde_json::to_string(&events).unwrap().contains("SECRET"));
    }

    #[test]
    fn current_structural_flags_reject_nonlocal_rows_even_with_transcripts() {
        let home = temp_home("current-flags");
        let workspace_id = "feedfeedfeedfeedfeedfeedfeedfeed";
        write_workspace(&home, workspace_id, "file:///Users/example/flags");
        let rows = [
            (
                "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                serde_json::json!({ "isDraft": true, "agentLocation": { "type": "local" } }),
                0,
            ),
            (
                "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                serde_json::json!({
                    "isDraft": false,
                    "createdFromBackgroundAgent": { "bcId": "remote" },
                    "agentLocation": { "type": "local" }
                }),
                0,
            ),
            (
                "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                serde_json::json!({ "isDraft": false, "agentLocation": { "type": "cloud" } }),
                0,
            ),
            (
                "abababab-abab-4bab-8bab-abababababab",
                serde_json::json!({ "isDraft": false, "agentLocation": { "type": "local" } }),
                1,
            ),
        ];
        let conn = create_db(&global_db(&home));
        for (id, header, is_subagent) in rows {
            write_transcript(&home, "Users-example-flags", id, "SECRET TRANSCRIPT");
            conn.execute(
                "INSERT INTO composerHeaders VALUES (?1,?2,1000,2000,0,?3,2000,3000,?4)",
                rusqlite::params![id, workspace_id, is_subagent, header.to_string()],
            )
            .unwrap();
        }
        drop(conn);

        assert!(
            CursorAdapter
                .collect(&AdapterContext::with_home(&home))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn migration_duplicates_merge_by_id_and_newest_timestamp() {
        let home = temp_home("dedupe");
        let workspace_id = "abcdefabcdefabcdefabcdefabcdefab";
        write_workspace(&home, workspace_id, "file:///Users/example/repo");
        let id = "88888888-8888-4888-8888-888888888888";
        write_transcript(&home, "Users-example-repo", id, "SECRET TRANSCRIPT");

        let global = create_db(&global_db(&home));
        global
            .execute(
                "INSERT INTO composerHeaders VALUES (?1,?2,1000,2000,0,0,2000,3000,'SECRET')",
                (id, workspace_id),
            )
            .unwrap();
        drop(global);

        let workspace_db = workspace_dir(&home, workspace_id).join("state.vscdb");
        let workspace = create_db(&workspace_db);
        workspace
            .execute(
                "INSERT INTO composerHeaders VALUES (?1,?2,1000,4000,0,0,4000,5000,'SECRET')",
                (id, workspace_id),
            )
            .unwrap();
        drop(workspace);

        let events = CursorAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].timestamp.timestamp(), 5_000);
        assert_eq!(
            events[0].metadata.get("uuid").and_then(|v| v.as_str()),
            Some("composer:88888888-8888-4888-8888-888888888888")
        );
    }

    #[test]
    fn transcript_fallback_uses_only_path_and_mtime() {
        let home = temp_home("transcript-fallback");
        let id = "99999999-9999-4999-8999-999999999999";
        let path = write_transcript(
            &home,
            "Users-example-unknown",
            id,
            "SECRET PROMPT RESPONSE THAT MUST NEVER BE OPENED",
        );
        let expected = file_mtime(&path).unwrap();

        let events = CursorAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].timestamp, expected);
        assert_eq!(events[0].project_path, None);
        assert_eq!(events[0].raw_ref.as_deref(), path.to_str());
        assert!(!serde_json::to_string(&events).unwrap().contains("SECRET"));
    }

    #[test]
    fn malformed_database_and_workspace_are_skipped() {
        let home = temp_home("malformed");
        let db = global_db(&home);
        std::fs::create_dir_all(db.parent().unwrap()).unwrap();
        std::fs::write(&db, "not sqlite SECRET").unwrap();
        let workspace = workspace_dir(&home, "broken-workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::write(workspace.join("workspace.json"), "{broken SECRET").unwrap();

        assert!(!CursorAdapter.discover(&AdapterContext::with_home(&home)));
        assert!(
            CursorAdapter
                .collect(&AdapterContext::with_home(&home))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn discover_ignores_generic_cursor_database_until_activity_is_proven() {
        let home = temp_home("discover");
        let conn = create_db(&global_db(&home));
        conn.execute(
            "INSERT INTO composerHeaders VALUES (?1,?2,1000,NULL,0,0,1000,NULL,?3)",
            rusqlite::params![
                "ffffffff-ffff-4fff-8fff-ffffffffffff",
                "workspace-with-no-activity",
                serde_json::json!({ "isDraft": false }).to_string()
            ],
        )
        .unwrap();
        drop(conn);
        let ctx = AdapterContext::with_home(&home);
        assert!(!CursorAdapter.discover(&ctx));

        write_transcript(
            &home,
            "Users-example-project",
            "ffffffff-ffff-4fff-8fff-ffffffffffff",
            "SECRET",
        );
        assert!(CursorAdapter.discover(&ctx));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_project_database_and_transcript_file() {
        use std::os::unix::fs::symlink;

        let home = temp_home("symlink");
        let outside = temp_home("symlink-outside");
        let outside_project = outside.join("project");
        let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let outside_transcript = outside_project
            .join("agent-transcripts")
            .join(id)
            .join(format!("{id}.jsonl"));
        std::fs::create_dir_all(outside_transcript.parent().unwrap()).unwrap();
        std::fs::write(&outside_transcript, "SECRET OUTSIDE").unwrap();
        let projects = home.join(".cursor").join("projects");
        std::fs::create_dir_all(&projects).unwrap();
        symlink(&outside_project, projects.join("linked-project")).unwrap();

        let real_project = projects
            .join("real-project")
            .join("agent-transcripts")
            .join(id);
        std::fs::create_dir_all(&real_project).unwrap();
        symlink(
            &outside_transcript,
            real_project.join(format!("{id}.jsonl")),
        )
        .unwrap();

        let outside_db = outside.join("state.vscdb");
        drop(create_db(&outside_db));
        let global = global_db(&home);
        std::fs::create_dir_all(global.parent().unwrap()).unwrap();
        symlink(outside_db, global).unwrap();

        assert!(
            CursorAdapter
                .collect(&AdapterContext::with_home(&home))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn path_matrix_and_watch_paths_stay_narrow() {
        let home = temp_home("paths");
        let ctx = AdapterContext::with_home(&home);
        let roots = CursorAdapter::user_roots(&ctx);
        assert!(roots.contains(&home.join("Library/Application Support/Cursor/User")));
        assert!(roots.contains(&home.join(".config/Cursor/User")));
        assert!(roots.contains(&home.join("AppData/Roaming/Cursor/User")));

        let conn = create_db(&global_db(&home));
        drop(conn);
        let workspace_id = "watch-workspace";
        write_workspace(&home, workspace_id, "file:///Users/example/watch");
        let workspace_marker = workspace_dir(&home, workspace_id).join("workspace.json");
        let transcripts = home.join(".cursor/projects/project/agent-transcripts");
        std::fs::create_dir_all(&transcripts).unwrap();
        std::fs::create_dir_all(home.join(".cursor/projects/project/canvases")).unwrap();
        let watched = CursorAdapter.watch_paths(&ctx);
        assert!(watched.contains(&global_db(&home)));
        assert!(watched.contains(&workspace_marker));
        assert!(watched.contains(&transcripts));
        assert!(!watched.contains(&home.join(".cursor/projects")));
        assert!(!watched.contains(&home.join(".cursor/projects/project/canvases")));
        assert!(!watched.iter().any(|path| {
            let value = path.to_string_lossy().to_ascii_lowercase();
            value.contains("auth")
                || value.contains("cursordiskkv")
                || value.contains("checkpoint")
                || value.contains("artifact")
        }));
    }

    #[test]
    fn cursor_slug_matches_upstream_and_collisions_are_not_guessed() {
        assert_eq!(
            cursor_project_slug("/Users/dipsy/Developer/test"),
            "Users-dipsy-Developer-test"
        );
        assert_eq!(cursor_project_slug("C:\\dev\\my repo"), "C-dev-my-repo");

        let mut transcripts = HashMap::from([(
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".to_string(),
            Transcript {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".to_string(),
                timestamp: DateTime::from_timestamp(1, 0).unwrap(),
                path: PathBuf::from("/tmp/transcript.jsonl"),
                project_slug: "Users-a-b".to_string(),
                project_path: None,
            },
        )]);
        assign_transcript_projects(
            &mut transcripts,
            &[
                WorkspaceInfo {
                    id: "workspace-a".to_string(),
                    path: "/Users/a-b".to_string(),
                },
                WorkspaceInfo {
                    id: "workspace-b".to_string(),
                    path: "/Users/a/b".to_string(),
                },
            ],
        );
        assert_eq!(transcripts.values().next().unwrap().project_path, None);
    }
}
