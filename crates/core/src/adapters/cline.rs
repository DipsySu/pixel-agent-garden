//! Cline adapter — reads current SDK sessions and legacy task transcripts from
//! local storage only.
//!
//! Upstream evidence (github.com/cline/cline, main commit
//! `63099710895e24593554b1e77ec7852f6f16c05c`, 2026-07-11; verified
//! 2026-07-11):
//!   - Current SDK persistence uses `~/.cline/data/db/sessions.db` plus
//!     `~/.cline/data/sessions/**/*.messages.json`; `storage/paths.ts`,
//!     `sqlite-session-store.ts`, and `session-data.ts` define the paths and
//!     schema. Assistant messages carry stable ids, timestamps, modelInfo and
//!     per-turn `metrics`. Current `inputTokens` includes cache subsets, so the
//!     adapter carves cache read/write out before normalization.
//!   - `apps/vscode/src/core/storage/disk.ts` stores each legacy task under
//!     `{globalStorageFsPath}/tasks/<task-id>/`, with usage-bearing UI rows in
//!     `ui_messages.json` and model history in `task_metadata.json`.
//!   - `apps/vscode/src/standalone/vscode-context.ts` uses
//!     `~/.cline/data/` for CLI/standalone global storage. VS Code still uses
//!     its host-managed `.../globalStorage/saoudrizwan.claude-dev/` path; the
//!     migration source explicitly says task files have not moved yet.
//!   - `shared/getApiMetrics.ts` defines the authoritative accounting set:
//!     `api_req_started`, `deleted_api_reqs`, and `subagent_usage`. Each JSON
//!     payload carries `tokensIn`, `tokensOut`, `cacheWrites`, `cacheReads`
//!     and `cost`, and Cline sums all five categories exactly as done here.
//!   - `sdk/message-translator.ts::normalizeUsageEvent` converts provider
//!     input into disjoint uncached/cache-read/cache-write buckets before
//!     writing the transcript. We therefore sum the four stored token buckets
//!     directly and never infer tokens from message text.
//!   - `shared/HistoryItem.ts` records `cwdOnTaskInitialization` and `modelId`;
//!     `task_metadata.json` records timestamped model changes.
//!
//! Precision: source-recorded, per assistant turn or legacy request/aggregate
//! row. Cline's `cost` is
//! preserved verbatim; depending on provider it can be provider-reported or
//! Cline-calculated, so this adapter does not relabel it as provider billing.
//! `deleted_api_reqs` and `subagent_usage` are genuine aggregate rows that no
//! longer exist elsewhere in the parent transcript and are intentionally
//! counted, matching Cline's own `getApiMetrics` implementation.
//!
//! Dedupe key: current message id, or legacy task id + message timestamp +
//! array index, stored as `metadata.uuid`. Current SDK storage is scanned
//! before legacy/editor roots, so a migrated task is counted once. Reads and
//! watches are limited to the session DB/artifacts, `tasks/`, and the
//! non-secret `state/taskHistory.json`; Cline's `secrets.json`, config and
//! telemetry files are never touched.

use crate::adapter::{Adapter, AdapterContext};
use crate::adapters::util::as_int_opt;
use crate::error::Error;
use crate::event::{AgentEvent, DAILY_TOKEN_ATTRIBUTION_KEY, DAILY_TOKEN_ATTRIBUTION_UNAVAILABLE};
use chrono::{DateTime, Utc};
use rusqlite::OpenFlags;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

pub struct ClineAdapter;

impl ClineAdapter {
    pub const NAME: &'static str = "cline";

    fn storage_roots(ctx: &AdapterContext) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        let mut push = |path: PathBuf| {
            if !roots.contains(&path) {
                roots.push(path);
            }
        };

        // Current CLI/standalone/JetBrains shared store wins if a migration
        // leaves the same task in an editor host store too.
        push(ctx.home.join(".cline").join("data"));

        const HOSTS: &[&str] = &["Code", "Code - Insiders", "VSCodium", "Cursor", "Windsurf"];
        for host in HOSTS {
            push(
                ctx.home
                    .join("Library")
                    .join("Application Support")
                    .join(host)
                    .join("User")
                    .join("globalStorage")
                    .join("saoudrizwan.claude-dev"),
            );
            push(
                ctx.home
                    .join(".config")
                    .join(host)
                    .join("User")
                    .join("globalStorage")
                    .join("saoudrizwan.claude-dev"),
            );
            push(
                ctx.home
                    .join("AppData")
                    .join("Roaming")
                    .join(host)
                    .join("User")
                    .join("globalStorage")
                    .join("saoudrizwan.claude-dev"),
            );
        }
        roots
    }

    fn shared_root(ctx: &AdapterContext) -> PathBuf {
        ctx.home.join(".cline").join("data")
    }

    fn collect_current(root: &Path) -> Vec<AgentEvent> {
        let db = root.join("db").join("sessions.db");
        let sessions_root = root.join("sessions");
        let sessions = if db.is_file() {
            read_current_db(&db)
        } else {
            read_current_index(&sessions_root.join("sessions.index.json"))
        };
        let mut events = Vec::new();
        let mut seen_sessions = HashSet::new();
        for session in sessions {
            if !seen_sessions.insert(session.id.clone()) {
                continue;
            }
            events.extend(current_session_events(&session, &sessions_root));
        }
        events
    }

    fn collect_root(root: &Path, seen_tasks: &mut HashSet<String>) -> Vec<AgentEvent> {
        let history = read_history(root);
        let mut events = Vec::new();
        for task_dir in list_dirs(&root.join("tasks")) {
            let Some(task_id) = task_dir
                .file_name()
                .and_then(|s| s.to_str())
                .map(str::to_string)
            else {
                continue;
            };
            if !seen_tasks.insert(task_id.clone()) {
                continue;
            }

            let task_info = history.get(&task_id).cloned().unwrap_or_default();
            let models = read_model_history(&task_dir.join("task_metadata.json"));
            let ui_path = task_dir.join("ui_messages.json");
            let rows = read_ui_messages(&ui_path);
            let mut task_events = Vec::new();
            for (index, row) in rows.iter().enumerate() {
                let combined = combine_legacy_api_row(&rows, index).unwrap_or_else(|| row.clone());
                if let Some(event) =
                    usage_event(&task_id, index, &combined, &task_info, &models, &ui_path)
                {
                    task_events.push(event);
                }
            }

            // A real task with no completed usage row still represents local
            // activity. Keep it activity-only; never estimate its tokens.
            if task_events.is_empty() {
                if let Some(event) = activity_event(&task_id, &task_info, &ui_path, &rows) {
                    task_events.push(event);
                }
            }
            events.extend(task_events);
        }
        events
    }
}

impl Adapter for ClineAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        let shared = Self::shared_root(ctx);
        if shared.join("db").join("sessions.db").is_file()
            || shared
                .join("sessions")
                .join("sessions.index.json")
                .is_file()
        {
            return true;
        }
        Self::storage_roots(ctx)
            .into_iter()
            .any(|root| root.join("tasks").is_dir())
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let mut current = Self::collect_current(&Self::shared_root(ctx));
        let mut legacy = Vec::new();
        let mut seen_legacy_tasks = HashSet::new();
        for root in Self::storage_roots(ctx) {
            legacy.extend(Self::collect_root(&root, &mut seen_legacy_tasks));
        }

        let current_ids: HashSet<String> = current
            .iter()
            .filter_map(|event| event.session_id.clone())
            .collect();
        let current_usage_ids: HashSet<String> = current
            .iter()
            .filter(|event| has_recorded_usage(event))
            .filter_map(|event| event.session_id.clone())
            .collect();
        let legacy_usage_ids: HashSet<String> = legacy
            .iter()
            .filter(|event| has_recorded_usage(event))
            .filter_map(|event| event.session_id.clone())
            .collect();

        // Current source-recorded usage is authoritative for a migrated task.
        // An activity-only current marker is not: when legacy still carries
        // real usage, retain that usage and drop only the redundant marker.
        current.retain(|event| {
            event
                .session_id
                .as_ref()
                .is_none_or(|id| current_usage_ids.contains(id) || !legacy_usage_ids.contains(id))
        });
        legacy.retain(|event| {
            event.session_id.as_ref().is_none_or(|id| {
                !current_usage_ids.contains(id)
                    && (!current_ids.contains(id) || legacy_usage_ids.contains(id))
            })
        });
        current.extend(legacy);
        Ok(current)
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        let mut paths = Vec::new();
        let shared = Self::shared_root(ctx);
        let db = shared.join("db").join("sessions.db");
        if db.is_file() {
            paths.push(db.with_extension("db-wal"));
            paths.push(db);
        }
        let sessions = shared.join("sessions");
        if sessions.is_dir() {
            paths.push(sessions);
        }
        for root in Self::storage_roots(ctx) {
            let tasks = root.join("tasks");
            if tasks.is_dir() {
                paths.push(tasks);
            }
            let history = root.join("state").join("taskHistory.json");
            if history.is_file() {
                paths.push(history);
            }
        }
        paths
    }
}

fn has_recorded_usage(event: &AgentEvent) -> bool {
    event.usage.input_tokens > 0
        || event.usage.output_tokens > 0
        || event.usage.cache_read_tokens > 0
        || event.usage.cache_write_tokens > 0
        || event.usage.total_tokens > 0
        || event.cost_usd.is_some()
}

#[derive(Debug, Default, Clone)]
struct CurrentSession {
    id: String,
    started_at: Option<String>,
    updated_at: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    cwd: Option<String>,
    workspace_root: Option<String>,
    parent_session_id: Option<String>,
    is_subagent: bool,
    messages_path: Option<String>,
    metadata: Option<serde_json::Value>,
}

fn read_current_db(path: &Path) -> Vec<CurrentSession> {
    let Ok(conn) = rusqlite::Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT session_id, started_at, updated_at, provider, model, cwd,
                workspace_root, parent_session_id, is_subagent, messages_path,
                metadata_json
           FROM sessions ORDER BY started_at",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| {
        let metadata_text: Option<String> = row.get(10)?;
        Ok(CurrentSession {
            id: row.get(0)?,
            started_at: row.get(1)?,
            updated_at: row.get(2)?,
            provider: row.get(3)?,
            model: row.get(4)?,
            cwd: row.get(5)?,
            workspace_root: row.get(6)?,
            parent_session_id: row.get(7)?,
            is_subagent: row.get::<_, Option<i64>>(8)?.unwrap_or(0) != 0,
            messages_path: row.get(9)?,
            metadata: metadata_text
                .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok()),
        })
    }) else {
        return Vec::new();
    };
    rows.flatten()
        .filter(|session| !session.id.is_empty())
        .collect()
}

fn read_current_index(path: &Path) -> Vec<CurrentSession> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    let Some(sessions) = value.get("sessions").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    sessions
        .values()
        .filter_map(|row| {
            let id = row.get("sessionId")?.as_str()?.to_string();
            Some(CurrentSession {
                id,
                started_at: json_string(row.get("startedAt")),
                updated_at: json_string(row.get("updatedAt")),
                provider: json_string(row.get("provider")),
                model: json_string(row.get("model")),
                cwd: json_string(row.get("cwd")),
                workspace_root: json_string(row.get("workspaceRoot")),
                parent_session_id: json_string(row.get("parentSessionId")),
                is_subagent: row
                    .get("isSubagent")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                messages_path: json_string(row.get("messagesPath")),
                metadata: row.get("metadata").cloned(),
            })
        })
        .collect()
}

fn current_session_events(session: &CurrentSession, sessions_root: &Path) -> Vec<AgentEvent> {
    let path = safe_messages_path(session, sessions_root);
    let Some(path) = path else {
        return current_fallback_event(session, None).into_iter().collect();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return current_fallback_event(session, Some(&path))
            .into_iter()
            .collect();
    };
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&text) else {
        return current_fallback_event(session, Some(&path))
            .into_iter()
            .collect();
    };
    let Some(messages) = payload.get("messages").and_then(|v| v.as_array()) else {
        return current_fallback_event(session, Some(&path))
            .into_iter()
            .collect();
    };
    let file_updated = payload
        .get("updated_at")
        .and_then(|v| v.as_str())
        .and_then(parse_iso);
    let mut events = Vec::new();
    for (index, message) in messages.iter().enumerate() {
        if message.get("role").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        let Some(metrics) = message.get("metrics") else {
            continue;
        };
        let raw_input = as_int_opt(metrics.get("inputTokens"));
        let output = as_int_opt(metrics.get("outputTokens"));
        let cache_read = as_int_opt(metrics.get("cacheReadTokens"));
        let cache_write = as_int_opt(metrics.get("cacheWriteTokens"));
        let cost = metrics
            .get("cost")
            .and_then(|v| v.as_f64())
            .filter(|v| v.is_finite() && *v > 0.0);
        if raw_input == 0 && output == 0 && cache_read == 0 && cache_write == 0 && cost.is_none() {
            continue;
        }
        let exact_ts = json_i64(message.get("ts")).and_then(epoch);
        let timestamp = exact_ts
            .or(file_updated)
            .or_else(|| session.updated_at.as_deref().and_then(parse_iso))
            .or_else(|| session.started_at.as_deref().and_then(parse_iso));
        let Some(timestamp) = timestamp else { continue };
        let model_info = message.get("modelInfo");
        let message_id =
            json_string(message.get("id")).unwrap_or_else(|| format!("message-{index}"));

        let mut event = AgentEvent::new(ClineAdapter::NAME, timestamp);
        event.session_id = Some(session.id.clone());
        event.project_path = session
            .cwd
            .clone()
            .or_else(|| session.workspace_root.clone());
        event.event_type = "message".to_string();
        event.usage.input_tokens = raw_input.saturating_sub(cache_read.saturating_add(cache_write));
        event.usage.output_tokens = output;
        event.usage.cache_read_tokens = cache_read;
        event.usage.cache_write_tokens = cache_write;
        event.normalize_totals();
        event.model = model_info
            .and_then(|v| json_string(v.get("id")))
            .or_else(|| session.model.clone());
        event.cost_usd = cost;
        event.raw_ref = Some(format!("{}:messages:{}", path.display(), index + 1));
        event
            .metadata
            .insert("uuid".to_string(), serde_json::Value::String(message_id));
        event.metadata.insert(
            "raw_input_tokens".to_string(),
            serde_json::Value::from(raw_input),
        );
        event.metadata.insert(
            "token_precision".to_string(),
            serde_json::Value::String("source_recorded".to_string()),
        );
        insert_opt(
            &mut event.metadata,
            "provider_id",
            model_info
                .and_then(|v| json_string(v.get("provider")))
                .or_else(|| session.provider.clone()),
        );
        insert_opt(
            &mut event.metadata,
            "parent_session_id",
            session.parent_session_id.clone(),
        );
        event.metadata.insert(
            "is_subagent".to_string(),
            serde_json::Value::Bool(session.is_subagent),
        );
        if exact_ts.is_none() {
            event.metadata.insert(
                DAILY_TOKEN_ATTRIBUTION_KEY.to_string(),
                serde_json::Value::String(DAILY_TOKEN_ATTRIBUTION_UNAVAILABLE.to_string()),
            );
        }
        events.push(event);
    }

    // A migrated/older SDK session can have only cumulative primary usage in
    // metadata. Use it solely when no per-message metrics survived. Never read
    // aggregateUsage here: it includes child agents that have their own files.
    if events.is_empty() {
        if let Some(event) = current_fallback_event(session, Some(&path)) {
            events.push(event);
        }
    }
    events
}

fn safe_messages_path(session: &CurrentSession, sessions_root: &Path) -> Option<PathBuf> {
    let configured = session.messages_path.as_deref().map(PathBuf::from);
    let fallback = sessions_root
        .join(&session.id)
        .join(format!("{}.messages.json", session.id));
    let path = configured
        .filter(|path| path.starts_with(sessions_root))
        .unwrap_or(fallback);
    if path.extension().and_then(|s| s.to_str()) != Some("json") {
        return None;
    }
    // Refuse symlinks that resolve outside the dedicated session artifact tree.
    if path.exists() {
        let root = sessions_root.canonicalize().ok()?;
        let resolved = path.canonicalize().ok()?;
        if !resolved.starts_with(root) {
            return None;
        }
    }
    Some(path)
}

fn current_aggregate_event(
    session: &CurrentSession,
    raw_path: Option<&Path>,
) -> Option<AgentEvent> {
    let usage = session.metadata.as_ref()?.get("usage")?;
    let raw_input = as_int_opt(usage.get("inputTokens"));
    let output = as_int_opt(usage.get("outputTokens"));
    let cache_read = as_int_opt(usage.get("cacheReadTokens"));
    let cache_write = as_int_opt(usage.get("cacheWriteTokens"));
    let cost = usage
        .get("totalCost")
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite() && *v > 0.0);
    if raw_input == 0 && output == 0 && cache_read == 0 && cache_write == 0 && cost.is_none() {
        return None;
    }
    let timestamp = session
        .updated_at
        .as_deref()
        .and_then(parse_iso)
        .or_else(|| session.started_at.as_deref().and_then(parse_iso))?;
    let mut event = AgentEvent::new(ClineAdapter::NAME, timestamp);
    event.session_id = Some(session.id.clone());
    event.project_path = session
        .cwd
        .clone()
        .or_else(|| session.workspace_root.clone());
    event.event_type = "session_usage".to_string();
    event.usage.input_tokens = raw_input.saturating_sub(cache_read.saturating_add(cache_write));
    event.usage.output_tokens = output;
    event.usage.cache_read_tokens = cache_read;
    event.usage.cache_write_tokens = cache_write;
    event.normalize_totals();
    event.model = session.model.clone();
    event.cost_usd = cost;
    event.raw_ref = raw_path.map(|path| path.display().to_string());
    event.metadata.insert(
        "uuid".to_string(),
        serde_json::Value::String(format!("{}:aggregate", session.id)),
    );
    event.metadata.insert(
        "token_precision".to_string(),
        serde_json::Value::String("source_cumulative".to_string()),
    );
    event.metadata.insert(
        DAILY_TOKEN_ATTRIBUTION_KEY.to_string(),
        serde_json::Value::String(DAILY_TOKEN_ATTRIBUTION_UNAVAILABLE.to_string()),
    );
    insert_opt(&mut event.metadata, "provider_id", session.provider.clone());
    insert_opt(
        &mut event.metadata,
        "parent_session_id",
        session.parent_session_id.clone(),
    );
    Some(event)
}

fn current_fallback_event(session: &CurrentSession, raw_path: Option<&Path>) -> Option<AgentEvent> {
    if let Some(event) = current_aggregate_event(session, raw_path) {
        return Some(event);
    }
    let timestamp = session
        .updated_at
        .as_deref()
        .and_then(parse_iso)
        .or_else(|| session.started_at.as_deref().and_then(parse_iso))?;
    let mut event = AgentEvent::new(ClineAdapter::NAME, timestamp);
    event.session_id = Some(session.id.clone());
    event.project_path = session
        .cwd
        .clone()
        .or_else(|| session.workspace_root.clone());
    event.model = session.model.clone();
    event.raw_ref = raw_path.map(|path| path.display().to_string());
    event.metadata.insert(
        "uuid".to_string(),
        serde_json::Value::String(format!("{}:activity", session.id)),
    );
    event.metadata.insert(
        "token_precision".to_string(),
        serde_json::Value::String("activity_only".to_string()),
    );
    Some(event)
}

fn parse_iso(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

#[derive(Debug, Default, Clone)]
struct TaskInfo {
    timestamp_ms: Option<i64>,
    cwd: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Clone)]
struct ModelAt {
    timestamp_ms: i64,
    model: String,
    provider: Option<String>,
    mode: Option<String>,
}

fn read_history(root: &Path) -> HashMap<String, TaskInfo> {
    let path = root.join("state").join("taskHistory.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return HashMap::new();
    };
    let Some(items) = value.as_array() else {
        return HashMap::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.to_string();
            Some((
                id,
                TaskInfo {
                    timestamp_ms: json_i64(item.get("ts")),
                    cwd: json_string(item.get("cwdOnTaskInitialization")),
                    model: json_string(item.get("modelId")),
                },
            ))
        })
        .collect()
}

fn read_model_history(path: &Path) -> Vec<ModelAt> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    let Some(items) = value.get("model_usage").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut models: Vec<ModelAt> = items
        .iter()
        .filter_map(|item| {
            Some(ModelAt {
                timestamp_ms: json_i64(item.get("ts"))?,
                model: item.get("model_id")?.as_str()?.to_string(),
                provider: json_string(item.get("model_provider_id")),
                mode: json_string(item.get("mode")),
            })
        })
        .collect();
    models.sort_by_key(|item| item.timestamp_ms);
    models
}

fn read_ui_messages(path: &Path) -> Vec<serde_json::Value> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
}

/// Classic Cline persisted request start/finish as two rows and its own UI
/// accounting first merged the finish payload into the start row. Newer SDK
/// translations already persist one usage-bearing start row. Supporting both
/// shapes here exactly mirrors `shared/combineApiRequests.ts`.
fn combine_legacy_api_row(rows: &[serde_json::Value], index: usize) -> Option<serde_json::Value> {
    let row = rows.get(index)?;
    if row.get("say").and_then(|v| v.as_str()) != Some("api_req_started") {
        return None;
    }
    let started_text = row.get("text").and_then(|v| v.as_str()).unwrap_or("{}");
    let mut started: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str::<serde_json::Value>(started_text)
            .ok()?
            .as_object()?
            .clone();
    if started.keys().any(|key| {
        matches!(
            key.as_str(),
            "tokensIn" | "tokensOut" | "cacheReads" | "cacheWrites" | "cost"
        )
    }) {
        return None;
    }
    for later in rows.iter().skip(index + 1) {
        let kind = later.get("say").and_then(|v| v.as_str());
        if kind == Some("api_req_started") {
            break;
        }
        if kind != Some("api_req_finished") {
            continue;
        }
        let finished_text = later.get("text").and_then(|v| v.as_str()).unwrap_or("{}");
        let finished = serde_json::from_str::<serde_json::Value>(finished_text).ok()?;
        for (key, value) in finished.as_object()? {
            started.insert(key.clone(), value.clone());
        }
        let mut combined = row.clone();
        combined.as_object_mut()?.insert(
            "text".to_string(),
            serde_json::Value::String(serde_json::Value::Object(started).to_string()),
        );
        return Some(combined);
    }
    None
}

fn usage_event(
    task_id: &str,
    index: usize,
    row: &serde_json::Value,
    task: &TaskInfo,
    models: &[ModelAt],
    ui_path: &Path,
) -> Option<AgentEvent> {
    if row.get("type").and_then(|v| v.as_str()) != Some("say") {
        return None;
    }
    let kind = row.get("say").and_then(|v| v.as_str())?;
    if !matches!(
        kind,
        "api_req_started" | "deleted_api_reqs" | "subagent_usage"
    ) {
        return None;
    }
    let text = row.get("text").and_then(|v| v.as_str())?;
    let payload: serde_json::Value = serde_json::from_str(text).ok()?;
    let input = as_int_opt(payload.get("tokensIn"));
    let output = as_int_opt(payload.get("tokensOut"));
    let cache_read = as_int_opt(payload.get("cacheReads"));
    let cache_write = as_int_opt(payload.get("cacheWrites"));
    let cost = payload
        .get("cost")
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite() && *v >= 0.0);
    if input == 0 && output == 0 && cache_read == 0 && cache_write == 0 && cost.is_none() {
        return None;
    }

    let ts_ms = json_i64(row.get("ts"))?;
    let timestamp = epoch(ts_ms)?;
    // Aggregate rows can cover deleted requests or child agents using other
    // models, so assigning the parent's current model would be false. Only a
    // concrete API request receives the timestamp-matched task model.
    let model_at = (kind == "api_req_started").then(|| {
        models
            .iter()
            .rev()
            .find(|candidate| candidate.timestamp_ms <= ts_ms)
            .or_else(|| models.last())
    });
    let mut event = AgentEvent::new(ClineAdapter::NAME, timestamp);
    event.session_id = Some(task_id.to_string());
    event.project_path = task.cwd.clone();
    event.event_type = match kind {
        "deleted_api_reqs" => "deleted_usage".to_string(),
        "subagent_usage" => "subagent_usage".to_string(),
        _ => "message".to_string(),
    };
    event.usage.input_tokens = input;
    event.usage.output_tokens = output;
    event.usage.cache_read_tokens = cache_read;
    event.usage.cache_write_tokens = cache_write;
    event.normalize_totals();
    event.model = if kind == "api_req_started" {
        model_at
            .flatten()
            .map(|item| item.model.clone())
            .or_else(|| task.model.clone())
    } else {
        None
    };
    event.cost_usd = cost.filter(|value| *value > 0.0);
    event.raw_ref = Some(format!("{}:{}", ui_path.display(), index + 1));
    event.metadata.insert(
        "uuid".to_string(),
        serde_json::Value::String(format!("{task_id}:{ts_ms}:{index}")),
    );
    event.metadata.insert(
        "usage_row_type".to_string(),
        serde_json::Value::String(kind.to_string()),
    );
    event.metadata.insert(
        "token_precision".to_string(),
        serde_json::Value::String("source_recorded".to_string()),
    );
    if let Some(model) = model_at.flatten() {
        insert_opt(&mut event.metadata, "provider_id", model.provider.clone());
        insert_opt(&mut event.metadata, "mode", model.mode.clone());
    }
    Some(event)
}

fn activity_event(
    task_id: &str,
    task: &TaskInfo,
    ui_path: &Path,
    rows: &[serde_json::Value],
) -> Option<AgentEvent> {
    let ts_ms = rows
        .iter()
        .rev()
        .find_map(|row| json_i64(row.get("ts")))
        .or(task.timestamp_ms)?;
    let mut event = AgentEvent::new(ClineAdapter::NAME, epoch(ts_ms)?);
    event.session_id = Some(task_id.to_string());
    event.project_path = task.cwd.clone();
    event.model = task.model.clone();
    event.raw_ref = Some(ui_path.display().to_string());
    event.metadata.insert(
        "uuid".to_string(),
        serde_json::Value::String(format!("{task_id}:activity")),
    );
    event.metadata.insert(
        "token_precision".to_string(),
        serde_json::Value::String("activity_only".to_string()),
    );
    Some(event)
}

fn epoch(value: i64) -> Option<DateTime<Utc>> {
    if value > 10_000_000_000 {
        DateTime::<Utc>::from_timestamp_millis(value)
    } else {
        DateTime::<Utc>::from_timestamp(value, 0)
    }
}

fn json_i64(value: Option<&serde_json::Value>) -> Option<i64> {
    value
        .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|n| n as i64)))
        .filter(|v| *v > 0)
}

fn json_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn insert_opt(map: &mut BTreeMap<String, serde_json::Value>, key: &str, value: Option<String>) {
    if let Some(value) = value.filter(|s| !s.is_empty()) {
        map.insert(key.to_string(), serde_json::Value::String(value));
    }
}

fn list_dirs(path: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(path) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use serde_json::json;

    const TS: i64 = 1_783_814_400_000;

    fn temp_home(tag: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("lag-cline-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_json(path: &Path, value: &serde_json::Value) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    }

    fn shared_root(home: &Path) -> PathBuf {
        home.join(".cline").join("data")
    }

    fn fixture(root: &Path, task_id: &str) {
        write_json(
            &root.join("state").join("taskHistory.json"),
            &json!([{
                "id": task_id,
                "ts": TS - 1000,
                "cwdOnTaskInitialization": "/tmp/cline-project",
                "modelId": "fallback-model"
            }]),
        );
        let task = root.join("tasks").join(task_id);
        write_json(
            &task.join("task_metadata.json"),
            &json!({
                "files_in_context": [],
                "model_usage": [{
                    "ts": TS - 5000,
                    "model_id": "claude-sonnet-4-6",
                    "model_provider_id": "anthropic",
                    "mode": "act"
                }],
                "environment_history": []
            }),
        );
        write_json(
            &task.join("ui_messages.json"),
            &json!([
                {"ts": TS - 20, "type": "say", "say": "api_req_started", "text": "{\"request\":\"pending\"}"},
                {"ts": TS, "type": "say", "say": "api_req_started", "text": "{\"tokensIn\":25,\"tokensOut\":20,\"cacheReads\":70,\"cacheWrites\":5,\"cost\":0.012}"},
                {"ts": TS + 1, "type": "say", "say": "deleted_api_reqs", "text": "{\"tokensIn\":2,\"tokensOut\":3,\"cacheReads\":4,\"cacheWrites\":1,\"cost\":0.001}"},
                {"ts": TS + 2, "type": "say", "say": "subagent_usage", "text": "{\"source\":\"subagents\",\"tokensIn\":11,\"tokensOut\":7,\"cacheReads\":0,\"cacheWrites\":0,\"cost\":0.003}"},
                {"ts": TS + 3, "type": "say", "say": "text", "text": "not usage"}
            ]),
        );
    }

    fn current_fixture(home: &Path, session_id: &str) {
        let data = shared_root(home);
        let db_dir = data.join("db");
        let session_dir = data.join("sessions").join(session_id);
        std::fs::create_dir_all(&db_dir).unwrap();
        std::fs::create_dir_all(&session_dir).unwrap();
        let messages_path = session_dir.join(format!("{session_id}.messages.json"));
        write_json(
            &messages_path,
            &json!({
                "version": 1,
                "updated_at": "2026-07-11T00:00:01.000Z",
                "agent": "lead",
                "sessionId": session_id,
                "messages": [
                    {"role":"user","content":"hello"},
                    {
                        "id":"msg-current-1",
                        "role":"assistant",
                        "content":"done",
                        "modelInfo":{"id":"claude-sonnet-4-6","provider":"anthropic"},
                        "metrics":{"inputTokens":100,"outputTokens":20,"cacheReadTokens":70,"cacheWriteTokens":5,"cost":0.012},
                        "ts": TS
                    }
                ]
            }),
        );
        let conn = Connection::open(db_dir.join("sessions.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                session_id TEXT PRIMARY KEY, started_at TEXT, updated_at TEXT,
                provider TEXT, model TEXT, cwd TEXT, workspace_root TEXT,
                parent_session_id TEXT, is_subagent INTEGER, messages_path TEXT,
                metadata_json TEXT
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions VALUES (?1, '2026-07-11T00:00:00.000Z',
             '2026-07-11T00:00:01.000Z', 'anthropic', 'fallback-model',
             '/tmp/current-project', '/tmp/current-project', NULL, 0, ?2,
             '{\"usage\":{\"inputTokens\":100,\"outputTokens\":20,\"cacheReadTokens\":70,\"cacheWriteTokens\":5,\"totalCost\":0.012}}')",
            rusqlite::params![session_id, messages_path.to_string_lossy()],
        )
        .unwrap();
    }

    fn current_activity_fixture(home: &Path, session_id: &str) {
        let db_dir = shared_root(home).join("db");
        std::fs::create_dir_all(&db_dir).unwrap();
        let conn = Connection::open(db_dir.join("sessions.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                session_id TEXT PRIMARY KEY, started_at TEXT, updated_at TEXT,
                provider TEXT, model TEXT, cwd TEXT, workspace_root TEXT,
                parent_session_id TEXT, is_subagent INTEGER, messages_path TEXT,
                metadata_json TEXT
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions VALUES
             (?1, '2026-07-11T00:00:00.000Z', '2026-07-11T00:00:01.000Z',
              NULL, NULL, '/tmp/current-project', '/tmp/current-project',
              NULL, 0, NULL, NULL)",
            [session_id],
        )
        .unwrap();
    }

    fn legacy_activity_fixture(root: &Path, task_id: &str) {
        write_json(
            &root.join("state").join("taskHistory.json"),
            &json!([{
                "id": task_id,
                "ts": TS,
                "cwdOnTaskInitialization": "/tmp/legacy-project"
            }]),
        );
        write_json(
            &root.join("tasks").join(task_id).join("ui_messages.json"),
            &json!([{"ts": TS, "type": "say", "say": "text", "text": "done"}]),
        );
    }

    #[test]
    fn current_sdk_store_emits_per_turn_metrics_without_cache_double_count() {
        let home = temp_home("current");
        current_fixture(&home, "sdk-session");
        let events = ClineAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.session_id.as_deref(), Some("sdk-session"));
        assert_eq!(event.project_path.as_deref(), Some("/tmp/current-project"));
        assert_eq!(event.model.as_deref(), Some("claude-sonnet-4-6"));
        assert_eq!(event.usage.input_tokens, 25);
        assert_eq!(event.usage.cache_read_tokens, 70);
        assert_eq!(event.usage.cache_write_tokens, 5);
        assert_eq!(event.usage.output_tokens, 20);
        assert_eq!(event.usage.total_tokens, 120);
        assert_eq!(event.cost_usd, Some(0.012));
        assert!(event.has_daily_token_attribution());
    }

    #[test]
    fn current_sdk_session_wins_over_migrated_legacy_task() {
        let home = temp_home("current-precedence");
        current_fixture(&home, "same-task");
        fixture(&shared_root(&home), "same-task");
        let events = ClineAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].metadata.get("uuid").and_then(|v| v.as_str()),
            Some("msg-current-1")
        );
    }

    #[test]
    fn legacy_usage_replaces_current_activity_only_marker() {
        let home = temp_home("current-activity-legacy-usage");
        current_activity_fixture(&home, "same-task");
        fixture(&shared_root(&home), "same-task");

        let events = ClineAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 3);
        assert!(events.iter().all(has_recorded_usage));
        assert!(events.iter().all(|event| {
            event.metadata.get("uuid").and_then(|value| value.as_str())
                != Some("same-task:activity")
        }));
    }

    #[test]
    fn current_activity_wins_when_legacy_is_also_activity_only() {
        let home = temp_home("both-activity");
        current_activity_fixture(&home, "same-task");
        legacy_activity_fixture(&shared_root(&home), "same-task");

        let events = ClineAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert!(!has_recorded_usage(&events[0]));
        assert_eq!(
            events[0]
                .metadata
                .get("uuid")
                .and_then(|value| value.as_str()),
            Some("same-task:activity")
        );
    }

    #[test]
    fn file_index_fallback_uses_cumulative_usage_without_fake_day() {
        let home = temp_home("index");
        let sessions = shared_root(&home).join("sessions");
        write_json(
            &sessions.join("sessions.index.json"),
            &json!({
                "version": 1,
                "sessions": {
                    "file-session": {
                        "sessionId":"file-session",
                        "startedAt":"2026-07-10T00:00:00.000Z",
                        "updatedAt":"2026-07-11T00:00:00.000Z",
                        "provider":"openai",
                        "model":"gpt-5.2",
                        "cwd":"/tmp/file-project",
                        "workspaceRoot":"/tmp/file-project",
                        "isSubagent":false,
                        "metadata":{"usage":{"inputTokens":50,"outputTokens":10,"cacheReadTokens":20,"cacheWriteTokens":0,"totalCost":0.02}}
                    }
                }
            }),
        );
        let events = ClineAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "session_usage");
        assert_eq!(events[0].usage.input_tokens, 30);
        assert!(!events[0].has_daily_token_attribution());
    }

    #[test]
    fn current_watch_paths_never_include_cline_data_root_or_secrets() {
        let home = temp_home("watch");
        current_fixture(&home, "watch-session");
        let paths = ClineAdapter.watch_paths(&AdapterContext::with_home(&home));
        let data = shared_root(&home);
        assert!(paths.contains(&data.join("db").join("sessions.db")));
        assert!(paths.contains(&data.join("db").join("sessions.db-wal")));
        assert!(paths.contains(&data.join("sessions")));
        assert!(!paths.contains(&data));
        assert!(paths.iter().all(|path| !path.ends_with("secrets.json")));
    }

    #[test]
    fn collects_all_authoritative_usage_row_types() {
        let home = temp_home("usage");
        fixture(&shared_root(&home), "task-1");
        let ctx = AdapterContext::with_home(&home);
        assert!(ClineAdapter.discover(&ctx));
        let events = ClineAdapter.collect(&ctx).unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(
            events[0].project_path.as_deref(),
            Some("/tmp/cline-project")
        );
        assert_eq!(events[0].model.as_deref(), Some("claude-sonnet-4-6"));
        assert_eq!(events[0].usage.input_tokens, 25);
        assert_eq!(events[0].usage.cache_read_tokens, 70);
        assert_eq!(events[0].usage.cache_write_tokens, 5);
        assert_eq!(events[0].usage.output_tokens, 20);
        assert_eq!(events[0].usage.total_tokens, 120);
        assert_eq!(events[0].cost_usd, Some(0.012));
        assert_eq!(events[1].event_type, "deleted_usage");
        assert_eq!(events[2].event_type, "subagent_usage");
    }

    #[test]
    fn classic_start_finish_pair_is_combined_before_accounting() {
        let home = temp_home("combined");
        let root = shared_root(&home);
        let task = root.join("tasks").join("paired-task");
        write_json(
            &root.join("state").join("taskHistory.json"),
            &json!([{"id":"paired-task","ts":TS,"cwdOnTaskInitialization":"/tmp/paired"}]),
        );
        write_json(
            &task.join("ui_messages.json"),
            &json!([
                {"ts":TS,"type":"say","say":"api_req_started","text":"{\"request\":\"prompt\"}"},
                {"ts":TS + 1,"type":"say","say":"text","text":"working"},
                {"ts":TS + 2,"type":"say","say":"api_req_finished","text":"{\"tokensIn\":10,\"tokensOut\":4,\"cacheReads\":3,\"cacheWrites\":2,\"cost\":0.01}"}
            ]),
        );
        let events = ClineAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].usage.total_tokens, 19);
        assert_eq!(events[0].timestamp.timestamp_millis(), TS);
    }

    #[test]
    fn shared_store_wins_over_editor_copy() {
        let home = temp_home("precedence");
        fixture(&shared_root(&home), "same-task");
        let editor = home
            .join("Library")
            .join("Application Support")
            .join("Code")
            .join("User")
            .join("globalStorage")
            .join("saoudrizwan.claude-dev");
        fixture(&editor, "same-task");
        let events = ClineAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 3);
        let shared_prefix = shared_root(&home).display().to_string();
        assert!(events.iter().all(|event| {
            event
                .raw_ref
                .as_deref()
                .is_some_and(|path| path.starts_with(&shared_prefix))
        }));
    }

    #[test]
    fn task_without_usage_is_activity_only() {
        let home = temp_home("activity");
        let root = shared_root(&home);
        let task = root.join("tasks").join("no-usage");
        write_json(
            &root.join("state").join("taskHistory.json"),
            &json!([{"id":"no-usage","ts":TS,"cwdOnTaskInitialization":"/tmp/demo"}]),
        );
        write_json(
            &task.join("ui_messages.json"),
            &json!([{"ts":TS,"type":"say","say":"text","text":"hello"}]),
        );
        let events = ClineAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].usage.total_tokens, 0);
        assert_eq!(
            events[0]
                .metadata
                .get("token_precision")
                .and_then(|v| v.as_str()),
            Some("activity_only")
        );
    }

    #[test]
    fn malformed_transcript_does_not_scan_secrets_or_fail() {
        let home = temp_home("bad");
        let root = shared_root(&home);
        let task = root.join("tasks").join("bad-task");
        std::fs::create_dir_all(&task).unwrap();
        std::fs::write(task.join("ui_messages.json"), "not-json").unwrap();
        std::fs::write(root.join("secrets.json"), "not-json").unwrap();
        assert!(
            ClineAdapter
                .collect(&AdapterContext::with_home(&home))
                .unwrap()
                .is_empty()
        );
    }
}
