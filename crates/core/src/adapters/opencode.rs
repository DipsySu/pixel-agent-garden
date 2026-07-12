//! OpenCode adapter — reads OpenCode's local storage under the XDG data root
//! (`$XDG_DATA_HOME/opencode`, defaulting to `~/.local/share/opencode`).
//!
//! Three storage eras exist on user disks; all are supported behind this one
//! adapter, newest first:
//!   1. SQLite era (current): `opencode*.db` in the data root — the `session`
//!      table (id, project_id, parent_id, directory, title) and the `message`
//!      table (id, session_id, time_created, data JSON). The `data` column is
//!      the V1 message object minus its `id`/`sessionID` (stripped into
//!      columns by opencode's projector).
//!   2. Flat JSON era: `storage/session/{projectID}/{sessionID}.json` and
//!      `storage/message/{sessionID}/{messageID}.json`.
//!   3. Legacy per-project JSON era:
//!      `project/{slug}/storage/session/info/{sessionID}.json` and
//!      `project/{slug}/storage/session/message/{sessionID}/{messageID}.json`.
//!
//! Upstream evidence (github.com/sst/opencode, dev branch, commit
//! `9976269ab1accfc9f9dc98a4a688c516934de422`, 2026-07-10; verified 2026-07-11):
//!   - DB path: `packages/core/src/database/database.ts` (`path()` returns
//!     `join(Global.Path.data, "opencode.db")`, or `opencode-<channel>.db`
//!     for non-standard release channels — hence the `opencode*.db` glob).
//!   - Data root: `packages/core/src/global.ts` (`xdgData + "/opencode"`).
//!   - Table shapes: `packages/core/src/session/sql.ts` and the initial
//!     migration `20260127222353_familiar_lady_ursula.ts` (the columns this
//!     adapter selects exist since the first SQLite schema).
//!   - JSON eras: `packages/opencode/src/storage/storage.ts` — `file()` maps
//!     key arrays to `<data>/storage/<...>.json`; MIGRATIONS[0] documents the
//!     legacy `project/*/storage/session/{info,message}/…` tree it migrated
//!     from; opencode v0.6.3 `session/index.ts` wrote messages at
//!     `["message", sessionID, messageID]`.
//!   - Message token fields: `packages/schema/src/v1/session.ts` (`Assistant`
//!     struct: `tokens: { input, output, reasoning, cache: { read, write } }`,
//!     `cost`, `modelID`, `providerID`, `path: { cwd, root }`,
//!     `time: { created, completed? }` in epoch milliseconds).
//!
//! Token precision: **API-reported, per-message absolute values** (not
//! cumulative). In the SQLite era the buckets are documented non-overlapping
//! (`packages/llm/src/schema/events.ts`: `input` = non-cached prompt tokens,
//! `output` = visible output excluding reasoning, `reasoning` and both cache
//! buckets independent), so `input + output + reasoning + cache.read +
//! cache.write` is the exact API total. Legacy JSON eras stored raw AI-SDK
//! usage (`inputTokens`/`outputTokens`), where some providers report reasoning
//! as a subset of output and cached tokens as a subset of input — legacy rows
//! may therefore overcount slightly. Counts are never estimated from text.
//!
//! Double counting: parent sessions do NOT include sub-session usage —
//! opencode applies step usage only to the message's own session
//! (`packages/core/src/session/projector.ts` `applyUsage`, and migration
//! `20260510033149_session_usage.ts` backfills per-session totals from that
//! session's own messages only). Emitting one event per assistant message
//! across all sessions (parent and sub) therefore counts each token exactly
//! once; sub-session events carry `metadata.parent_session_id`.
//!
//! Dedupe key: session id + message id. The message id is stored in
//! `metadata.uuid`, so `scan::dedupe_key` yields `uuid:opencode:<session>:<msg>`
//! — stable across rescans and across storage eras. Within one collect pass
//! the same (session, message) pair surviving in two eras (SQLite migration
//! leaves the JSON tree behind) is skipped, SQLite winning.
//!
//! Read-only guarantees: the SQLite database is opened with
//! `SQLITE_OPEN_READ_ONLY`; JSON files are only read. `auth.json` and
//! `mcp-auth.json` live directly in the data root and are never read; watch
//! logical watch targets cover only db/WAL files and storage/project subtrees.
//! A missing WAL uses an exact-path filtered parent registration in the Tauri
//! shell, so credential siblings are never parsed, logged, or allowed to
//! trigger a scan.
//!
//! Not extracted: tool-call counts (would require reading the high-volume
//! `part` store) and user messages (every exchange already yields one
//! assistant message, which carries all usage).

use crate::adapter::{Adapter, AdapterContext};
use crate::adapters::util::as_int_opt;
use crate::error::Error;
use crate::event::AgentEvent;
use chrono::{DateTime, Utc};
use rusqlite::OpenFlags;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub struct OpenCodeAdapter;

/// Session-level context joined onto each message event.
#[derive(Debug, Default, Clone)]
struct SessionMeta {
    directory: Option<String>,
    parent_id: Option<String>,
}

impl OpenCodeAdapter {
    pub const NAME: &'static str = "opencode";

    fn data_root(ctx: &AdapterContext) -> PathBuf {
        ctx.xdg_data_home
            .clone()
            .unwrap_or_else(|| ctx.home.join(".local").join("share"))
            .join("opencode")
    }

    // ---- pass 1: SQLite databases -----------------------------------------
    fn read_sqlite_db(db_path: &Path, seen: &mut HashSet<(String, String)>) -> Vec<AgentEvent> {
        // SQLite errors are swallowed at the db/row level: opencode's schema
        // moves fast between releases and partial data beats an empty garden.
        let Ok(conn) =
            rusqlite::Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        else {
            return Vec::new();
        };

        // Columns limited to the set present since the initial migration
        // (20260127222353) so older databases don't fail the whole query.
        let mut sessions: HashMap<String, SessionMeta> = HashMap::new();
        if let Ok(mut stmt) = conn.prepare("SELECT id, parent_id, directory FROM session") {
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            });
            if let Ok(rows) = rows {
                for (id, parent_id, directory) in rows.flatten() {
                    let Some(id) = id.filter(|s| !s.is_empty()) else {
                        continue;
                    };
                    sessions.insert(
                        id,
                        SessionMeta {
                            directory: directory.filter(|s| !s.is_empty()),
                            parent_id: parent_id.filter(|s| !s.is_empty()),
                        },
                    );
                }
            }
        }

        let Ok(mut stmt) = conn.prepare("SELECT id, session_id, time_created, data FROM message")
        else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        });
        let Ok(rows) = rows else { return Vec::new() };

        let mut events = Vec::new();
        for (id, session_id, time_created, data) in rows.flatten() {
            let (Some(id), Some(session_id), Some(data)) = (id, session_id, data) else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&data) else {
                continue;
            };
            let key = (session_id.clone(), id.clone());
            if seen.contains(&key) {
                continue;
            }
            let raw_ref = format!("{}:message:{}", db_path.display(), id);
            if let Some(event) = message_to_event(
                &id,
                &session_id,
                &value,
                sessions.get(&session_id),
                time_created.filter(|timestamp| *timestamp > 0),
                raw_ref,
            ) {
                seen.insert(key);
                events.push(event);
            }
        }
        events
    }

    // ---- pass 2/3: JSON file trees ----------------------------------------
    /// Read one message tree (`<msg_root>/<sessionID>/<messageID>.json` — the
    /// layout both JSON eras share) against a session-id → meta map.
    fn read_message_tree(
        msg_root: &Path,
        sessions: &HashMap<String, SessionMeta>,
        seen: &mut HashSet<(String, String)>,
        events: &mut Vec<AgentEvent>,
    ) {
        for session_dir in list_dirs(msg_root) {
            let dir_session_id = file_name_string(&session_dir);
            for msg_file in list_json_files(&session_dir) {
                let Some(value) = read_json_file(&msg_file) else {
                    continue;
                };
                // Era-B files carry `id`/`sessionID` inline; fall back to the
                // path components which encode the same identifiers.
                let msg_id = value
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .unwrap_or_else(|| file_stem_string(&msg_file));
                let session_id = value
                    .get("sessionID")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .unwrap_or_else(|| dir_session_id.clone());
                if msg_id.is_empty() || session_id.is_empty() {
                    continue;
                }
                let key = (session_id.clone(), msg_id.clone());
                if seen.contains(&key) {
                    continue;
                }
                if let Some(event) = message_to_event(
                    &msg_id,
                    &session_id,
                    &value,
                    sessions.get(&session_id),
                    None,
                    msg_file.display().to_string(),
                ) {
                    seen.insert(key);
                    events.push(event);
                }
            }
        }
    }

    /// Flat JSON era: `storage/session/{projectID}/{sessionID}.json` +
    /// `storage/message/{sessionID}/{messageID}.json`.
    fn read_flat_json_store(store: &Path, seen: &mut HashSet<(String, String)>) -> Vec<AgentEvent> {
        let mut sessions: HashMap<String, SessionMeta> = HashMap::new();
        for project_dir in list_dirs(&store.join("session")) {
            for session_file in list_json_files(&project_dir) {
                if let Some((id, meta)) = parse_session_file(&session_file) {
                    sessions.insert(id, meta);
                }
            }
        }
        let mut events = Vec::new();
        Self::read_message_tree(&store.join("message"), &sessions, seen, &mut events);
        events
    }

    /// Legacy per-project JSON era: `project/{slug}/storage/session/info/*.json`
    /// + `project/{slug}/storage/session/message/{sessionID}/*.json`.
    fn read_legacy_project_stores(
        projects_root: &Path,
        seen: &mut HashSet<(String, String)>,
    ) -> Vec<AgentEvent> {
        let mut events = Vec::new();
        for project_dir in list_dirs(projects_root) {
            let session_root = project_dir.join("storage").join("session");
            let mut sessions: HashMap<String, SessionMeta> = HashMap::new();
            for session_file in list_json_files(&session_root.join("info")) {
                if let Some((id, meta)) = parse_session_file(&session_file) {
                    sessions.insert(id, meta);
                }
            }
            Self::read_message_tree(&session_root.join("message"), &sessions, seen, &mut events);
        }
        events
    }
}

impl Adapter for OpenCodeAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        let root = Self::data_root(ctx);
        !list_db_files(&root).is_empty()
            || root.join("storage").is_dir()
            || root.join("project").is_dir()
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let root = Self::data_root(ctx);
        // SQLite first (canonical after migration), then the flat JSON tree,
        // then the legacy per-project tree. `seen` skips (session, message)
        // pairs an earlier, more authoritative store already produced.
        let mut seen: HashSet<(String, String)> = HashSet::new();
        let mut events = Vec::new();
        for db_path in list_db_files(&root) {
            events.extend(Self::read_sqlite_db(&db_path, &mut seen));
        }
        events.extend(Self::read_flat_json_store(&root.join("storage"), &mut seen));
        events.extend(Self::read_legacy_project_stores(
            &root.join("project"),
            &mut seen,
        ));
        Ok(events)
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        // Deliberately NOT the data root itself: it also holds auth.json /
        // mcp-auth.json (credentials) and log/ — outside the privacy contract.
        let root = Self::data_root(ctx);
        let mut paths = Vec::new();
        for db in list_db_files(&root) {
            // WAL-mode commits touch the -wal sidecar long before the main db
            // file. Return the target even before it exists; the Tauri watcher
            // installs an exact-path filtered parent watch for missing files.
            let wal = db.with_extension("db-wal");
            paths.push(wal);
            paths.push(db);
        }
        for dir in [root.join("storage"), root.join("project")] {
            if dir.is_dir() {
                paths.push(dir);
            }
        }
        paths
    }
}

/// Normalize one message object into an event. Only assistant messages carry
/// usage (and one exists per exchange), so other roles yield None.
fn message_to_event(
    msg_id: &str,
    session_id: &str,
    data: &serde_json::Value,
    session: Option<&SessionMeta>,
    fallback_ts_ms: Option<i64>,
    raw_ref: String,
) -> Option<AgentEvent> {
    if data.get("role").and_then(|v| v.as_str()) != Some("assistant") {
        return None;
    }

    let time = data.get("time");
    let ts = time
        .and_then(|t| t.get("completed"))
        .and_then(json_epoch)
        .or_else(|| time.and_then(|t| t.get("created")).and_then(json_epoch))
        .or(fallback_ts_ms);
    let timestamp = epoch_to_datetime(ts?)?;

    let tokens = data.get("tokens");
    let get = |key: &str| as_int_opt(tokens.and_then(|t| t.get(key)));
    let cache = tokens.and_then(|t| t.get("cache"));
    let reasoning = get("reasoning");

    let mut event = AgentEvent::new(OpenCodeAdapter::NAME, timestamp);
    event.session_id = Some(session_id.to_string());
    event.event_type = "message".to_string();
    event.usage.input_tokens = get("input");
    // Reasoning is billed as output and (in the current era) stored carved out
    // of the visible-output bucket; recombining restores the API output total.
    event.usage.output_tokens = get("output").saturating_add(reasoning);
    event.usage.cache_read_tokens = as_int_opt(cache.and_then(|c| c.get("read")));
    event.usage.cache_write_tokens = as_int_opt(cache.and_then(|c| c.get("write")));
    event.model = data
        .get("modelID")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    event.cost_usd = data
        .get("cost")
        .and_then(|v| v.as_f64())
        .filter(|c| *c > 0.0);
    event.raw_ref = Some(raw_ref);

    // Project mapping: the session's start directory is the canonical project
    // per opencode's own grouping; per-message path.cwd / path.root cover the
    // legacy era where session records carry no directory. All are real
    // recorded paths (never reverse-decoded), so none is marked inferred.
    let path = data.get("path");
    event.project_path = session
        .and_then(|s| s.directory.clone())
        .or_else(|| json_string(path.and_then(|p| p.get("cwd"))))
        .or_else(|| json_string(path.and_then(|p| p.get("root"))));

    // Message id doubles as the dedupe uuid (see module doc).
    event.metadata.insert(
        "uuid".to_string(),
        serde_json::Value::String(msg_id.to_string()),
    );
    event.metadata.insert(
        "provider_id".to_string(),
        data.get("providerID")
            .and_then(|v| v.as_str())
            .map(|s| serde_json::Value::String(s.to_string()))
            .unwrap_or(serde_json::Value::Null),
    );
    event.metadata.insert(
        "reasoning_tokens".to_string(),
        serde_json::Value::from(reasoning),
    );
    event.metadata.insert(
        "parent_session_id".to_string(),
        session
            .and_then(|s| s.parent_id.clone())
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    );

    event.normalize_totals();
    Some(event)
}

/// Parse one session JSON file into (id, meta). Both JSON eras share the
/// relevant fields; era-A records simply lack `directory`.
fn parse_session_file(path: &Path) -> Option<(String, SessionMeta)> {
    let value = read_json_file(path)?;
    let id = value
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| file_stem_string(path));
    if id.is_empty() {
        return None;
    }
    Some((
        id,
        SessionMeta {
            directory: json_string(value.get("directory")),
            parent_id: json_string(value.get("parentID")),
        },
    ))
}

fn json_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Epoch value from a JSON number (opencode writes `Date.now()` floats/ints).
fn json_epoch(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|f| f as i64))
        .filter(|v| *v > 0)
}

/// Opencode timestamps are epoch milliseconds; accept plain seconds too as a
/// defensive fallback (same 1e10 threshold as the codex adapter).
fn epoch_to_datetime(v: i64) -> Option<DateTime<Utc>> {
    if v > 10_000_000_000 {
        DateTime::<Utc>::from_timestamp_millis(v)
    } else {
        DateTime::<Utc>::from_timestamp(v, 0)
    }
}

/// `opencode*.db` files directly in the data root — `opencode.db` plus the
/// per-channel `opencode-<channel>.db` variants. Sidecars (`-wal`/`-shm`)
/// don't match the `.db` extension filter.
fn list_db_files(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension().and_then(|s| s.to_str()) == Some("db")
                && p.file_name()
                    .and_then(|s| s.to_str())
                    .is_some_and(|n| n.starts_with("opencode"))
        })
        .collect();
    out.sort();
    out
}

fn list_dirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    out.sort();
    out
}

fn list_json_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("json"))
        .collect();
    out.sort();
    out
}

fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn file_stem_string(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string()
}

fn file_name_string(path: &Path) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // 2026-06-01T00:00:05Z in epoch milliseconds.
    const TS_MS: i64 = 1_780_272_005_000;
    const TS_S: i64 = 1_780_272_005;

    fn temp_home(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lag-opencode-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn data_root(home: &Path) -> PathBuf {
        home.join(".local").join("share").join("opencode")
    }

    /// Assistant message data JSON as stored in the SQLite `data` column
    /// (no id/sessionID — those live in table columns).
    fn assistant_data() -> serde_json::Value {
        json!({
            "role": "assistant",
            "time": { "created": TS_MS - 5000, "completed": TS_MS },
            "parentID": "msg_user",
            "modelID": "claude-sonnet-4-6",
            "providerID": "anthropic",
            "mode": "build",
            "agent": "build",
            "path": { "cwd": "/tmp/demo-project/sub", "root": "/tmp/demo-project" },
            "cost": 0.042,
            "tokens": {
                "input": 100,
                "output": 40,
                "reasoning": 10,
                "cache": { "read": 70, "write": 5 }
            }
        })
    }

    fn make_db(db_path: &Path, rows: &[(&str, &str, serde_json::Value)]) {
        let conn = rusqlite::Connection::open(db_path).unwrap();
        // Column set of the initial opencode migration (20260127222353).
        conn.execute_batch(
            "CREATE TABLE session (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT,
                slug TEXT NOT NULL, directory TEXT NOT NULL, title TEXT NOT NULL,
                version TEXT NOT NULL, time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL
            );
            CREATE TABLE message (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
                data TEXT NOT NULL
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session VALUES
             ('ses_parent', 'proj_1', NULL, 'demo', '/tmp/demo-project', 'Demo', '1.0.0', ?1, ?1),
             ('ses_child', 'proj_1', 'ses_parent', 'demo-sub', '/tmp/demo-project', 'Sub', '1.0.0', ?1, ?1)",
            [TS_MS],
        )
        .unwrap();
        for (id, session_id, data) in rows {
            conn.execute(
                "INSERT INTO message VALUES (?1, ?2, ?3, ?3, ?4)",
                rusqlite::params![id, session_id, TS_MS, data.to_string()],
            )
            .unwrap();
        }
    }

    #[test]
    fn sqlite_era_emits_assistant_message_events() {
        let home = temp_home("db");
        let root = data_root(&home);
        std::fs::create_dir_all(&root).unwrap();
        make_db(
            &root.join("opencode.db"),
            &[
                ("msg_a", "ses_parent", assistant_data()),
                (
                    "msg_user",
                    "ses_parent",
                    json!({ "role": "user", "time": { "created": TS_MS } }),
                ),
                ("msg_b", "ses_child", assistant_data()),
            ],
        );

        let ctx = AdapterContext::with_home(&home);
        assert!(OpenCodeAdapter.discover(&ctx));
        let events = OpenCodeAdapter.collect(&ctx).unwrap();
        // User message dropped; two assistant messages survive.
        assert_eq!(events.len(), 2);

        let parent = events
            .iter()
            .find(|e| e.session_id.as_deref() == Some("ses_parent"))
            .unwrap();
        assert_eq!(parent.source, "opencode");
        assert_eq!(parent.event_type, "message");
        assert_eq!(parent.timestamp.timestamp(), TS_S);
        assert_eq!(parent.project_path.as_deref(), Some("/tmp/demo-project"));
        assert_eq!(parent.model.as_deref(), Some("claude-sonnet-4-6"));
        assert_eq!(parent.cost_usd, Some(0.042));
        assert_eq!(parent.usage.input_tokens, 100);
        // output (40) + reasoning (10) — reasoning is carved out of the
        // visible-output bucket upstream.
        assert_eq!(parent.usage.output_tokens, 50);
        assert_eq!(parent.usage.cache_read_tokens, 70);
        assert_eq!(parent.usage.cache_write_tokens, 5);
        assert_eq!(parent.usage.total_tokens, 225);
        assert_eq!(parent.metadata.get("uuid"), Some(&json!("msg_a")));
        assert_eq!(
            parent.metadata.get("provider_id"),
            Some(&json!("anthropic"))
        );
        assert_eq!(parent.metadata.get("reasoning_tokens"), Some(&json!(10)));
        assert_eq!(
            parent.metadata.get("parent_session_id"),
            Some(&serde_json::Value::Null)
        );

        // Sub-session event carries the parent link for downstream grouping.
        let child = events
            .iter()
            .find(|e| e.session_id.as_deref() == Some("ses_child"))
            .unwrap();
        assert_eq!(
            child.metadata.get("parent_session_id"),
            Some(&json!("ses_parent"))
        );

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn flat_json_era_parses_sessions_and_messages() {
        let home = temp_home("flat");
        let store = data_root(&home).join("storage");
        let session_dir = store.join("session").join("proj_1");
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(
            session_dir.join("ses_flat.json"),
            json!({
                "id": "ses_flat",
                "projectID": "proj_1",
                "directory": "/tmp/flat-project",
                "parentID": "ses_root",
                "title": "Flat era",
                "version": "0.13.4",
                "time": { "created": TS_MS, "updated": TS_MS }
            })
            .to_string(),
        )
        .unwrap();
        let msg_dir = store.join("message").join("ses_flat");
        std::fs::create_dir_all(&msg_dir).unwrap();
        // Era-B message files carry id + sessionID inline.
        let mut msg = assistant_data();
        msg["id"] = json!("msg_flat");
        msg["sessionID"] = json!("ses_flat");
        std::fs::write(msg_dir.join("msg_flat.json"), msg.to_string()).unwrap();

        let ctx = AdapterContext::with_home(&home);
        assert!(OpenCodeAdapter.discover(&ctx));
        let events = OpenCodeAdapter.collect(&ctx).unwrap();
        assert_eq!(events.len(), 1);
        let ev = &events[0];
        assert_eq!(ev.session_id.as_deref(), Some("ses_flat"));
        // Session directory wins over the message's own path.cwd.
        assert_eq!(ev.project_path.as_deref(), Some("/tmp/flat-project"));
        assert_eq!(ev.usage.total_tokens, 225);
        assert_eq!(ev.metadata.get("uuid"), Some(&json!("msg_flat")));
        assert_eq!(
            ev.metadata.get("parent_session_id"),
            Some(&json!("ses_root"))
        );

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn legacy_project_tree_era_falls_back_to_message_path() {
        let home = temp_home("legacy");
        let session_root = data_root(&home)
            .join("project")
            .join("demo-slug")
            .join("storage")
            .join("session");
        // Era-A session records have no `directory` field.
        std::fs::create_dir_all(session_root.join("info")).unwrap();
        std::fs::write(
            session_root.join("info").join("ses_old.json"),
            json!({
                "id": "ses_old",
                "title": "Legacy era",
                "version": "0.3.0",
                "time": { "created": TS_MS, "updated": TS_MS }
            })
            .to_string(),
        )
        .unwrap();
        let msg_dir = session_root.join("message").join("ses_old");
        std::fs::create_dir_all(&msg_dir).unwrap();
        let mut msg = assistant_data();
        msg["id"] = json!("msg_old");
        msg["sessionID"] = json!("ses_old");
        std::fs::write(msg_dir.join("msg_old.json"), msg.to_string()).unwrap();

        let ctx = AdapterContext::with_home(&home);
        let events = OpenCodeAdapter.collect(&ctx).unwrap();
        assert_eq!(events.len(), 1);
        // No session directory → message path.cwd fallback.
        assert_eq!(
            events[0].project_path.as_deref(),
            Some("/tmp/demo-project/sub")
        );
        assert_eq!(events[0].metadata.get("uuid"), Some(&json!("msg_old")));

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn malformed_rows_are_skipped_without_error() {
        let home = temp_home("bad");
        let root = data_root(&home);
        // Corrupt "database": not SQLite at all.
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("opencode.db"), b"definitely not sqlite").unwrap();
        // One corrupt message file, one valid one, one with no timestamp.
        let msg_dir = root.join("storage").join("message").join("ses_x");
        std::fs::create_dir_all(&msg_dir).unwrap();
        std::fs::write(msg_dir.join("msg_bad.json"), "{ this is not json").unwrap();
        std::fs::write(
            msg_dir.join("msg_nots.json"),
            json!({ "id": "msg_nots", "sessionID": "ses_x", "role": "assistant" }).to_string(),
        )
        .unwrap();
        let mut good = assistant_data();
        good["id"] = json!("msg_good");
        good["sessionID"] = json!("ses_x");
        std::fs::write(msg_dir.join("msg_good.json"), good.to_string()).unwrap();

        let ctx = AdapterContext::with_home(&home);
        let events = OpenCodeAdapter.collect(&ctx).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].metadata.get("uuid"), Some(&json!("msg_good")));

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn dedupe_key_is_stable_across_eras_and_rescans() {
        // The same (session, message) pair present in BOTH the SQLite store
        // and the leftover JSON tree (post-migration disks look like this)
        // must yield ONE event, and its identity must not change between
        // collect() calls — that identity feeds scan::dedupe_key.
        let home = temp_home("dedupe");
        let root = data_root(&home);
        std::fs::create_dir_all(&root).unwrap();
        make_db(
            &root.join("opencode.db"),
            &[("msg_a", "ses_parent", assistant_data())],
        );
        let msg_dir = root.join("storage").join("message").join("ses_parent");
        std::fs::create_dir_all(&msg_dir).unwrap();
        let mut msg = assistant_data();
        msg["id"] = json!("msg_a");
        msg["sessionID"] = json!("ses_parent");
        std::fs::write(msg_dir.join("msg_a.json"), msg.to_string()).unwrap();

        let ctx = AdapterContext::with_home(&home);
        let first = OpenCodeAdapter.collect(&ctx).unwrap();
        assert_eq!(first.len(), 1);
        // SQLite pass wins — the raw_ref points at the db, not the JSON file.
        assert!(first[0].raw_ref.as_deref().unwrap().contains("opencode.db"));

        let second = OpenCodeAdapter.collect(&ctx).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(
            first[0].metadata.get("uuid"),
            second[0].metadata.get("uuid")
        );
        assert_eq!(first[0].session_id, second[0].session_id);
        assert_eq!(first[0].source, second[0].source);

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn invalid_canonical_row_does_not_block_valid_legacy_fallback() {
        let home = temp_home("fallback-after-invalid");
        let root = data_root(&home);
        std::fs::create_dir_all(&root).unwrap();
        let db_path = root.join("opencode.db");
        make_db(
            &db_path,
            &[("msg_a", "ses_parent", json!({ "role": "assistant" }))],
        );
        // Simulate a partially projected SQLite row: it has the canonical id
        // but no usable message timestamp. The leftover JSON-era copy remains
        // complete and must be allowed to recover the real event.
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute("UPDATE message SET time_created = 0 WHERE id = 'msg_a'", [])
            .unwrap();
        drop(conn);

        let msg_dir = root.join("storage").join("message").join("ses_parent");
        std::fs::create_dir_all(&msg_dir).unwrap();
        let mut legacy = assistant_data();
        legacy["id"] = json!("msg_a");
        legacy["sessionID"] = json!("ses_parent");
        std::fs::write(msg_dir.join("msg_a.json"), legacy.to_string()).unwrap();

        let events = OpenCodeAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].metadata.get("uuid"), Some(&json!("msg_a")));
        assert!(
            events[0]
                .raw_ref
                .as_deref()
                .is_some_and(|raw| raw.ends_with("msg_a.json")),
            "the valid legacy row must win after the canonical row fails"
        );

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn xdg_data_home_override_is_the_canonical_root() {
        let home = temp_home("xdg-home");
        let xdg = home.join("custom-xdg-data");
        let root = xdg.join("opencode");
        std::fs::create_dir_all(&root).unwrap();
        make_db(
            &root.join("opencode.db"),
            &[("msg_xdg", "ses_parent", assistant_data())],
        );

        let ctx = AdapterContext::with_home(&home).with_xdg_data_home(&xdg);
        assert!(OpenCodeAdapter.discover(&ctx));
        let events = OpenCodeAdapter.collect(&ctx).unwrap();
        assert_eq!(events.len(), 1);
        assert!(
            events[0]
                .raw_ref
                .as_deref()
                .unwrap()
                .starts_with(root.join("opencode.db").to_string_lossy().as_ref())
        );

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn discover_false_without_opencode_data() {
        let home = temp_home("disc");
        let ctx = AdapterContext::with_home(&home);
        assert!(!OpenCodeAdapter.discover(&ctx));
        // A stray non-opencode db in the data root doesn't count either.
        let root = data_root(&home);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("other.db"), b"").unwrap();
        std::fs::write(root.join("auth.json"), b"{}").unwrap();
        assert!(!OpenCodeAdapter.discover(&ctx));
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn watch_paths_cover_stores_but_never_the_credential_root() {
        let home = temp_home("watch");
        let root = data_root(&home);
        std::fs::create_dir_all(root.join("storage")).unwrap();
        std::fs::write(root.join("opencode.db"), b"").unwrap();
        std::fs::write(root.join("opencode-dev.db"), b"").unwrap();
        std::fs::write(root.join("auth.json"), b"{}").unwrap();

        let ctx = AdapterContext::with_home(&home);
        let paths = OpenCodeAdapter.watch_paths(&ctx);
        assert!(paths.contains(&root.join("opencode.db")));
        assert!(paths.contains(&root.join("opencode.db-wal")));
        assert!(paths.contains(&root.join("opencode-dev.db")));
        assert!(paths.contains(&root.join("opencode-dev.db-wal")));
        assert!(paths.contains(&root.join("storage")));
        // The data root itself (holding auth.json) must never be watched.
        assert!(!paths.contains(&root));
        assert!(paths.iter().all(|p| p != &root.join("auth.json")));

        std::fs::remove_dir_all(&home).ok();
    }
}
