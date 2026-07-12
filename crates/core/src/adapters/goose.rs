//! Goose adapter — reads the local session store without contacting Goose or
//! any model provider.
//!
//! Upstream evidence (github.com/block/goose, main commit
//! `9cec9f2f4f1f5d5c9bfce351423539b7f313dc9f`, 2026-07-10; verified
//! 2026-07-11):
//!   - `crates/goose/src/config/paths.rs` resolves the app data directory with
//!     etcetera's app strategy (`Block` / `goose`), retaining the macOS path
//!     `~/Library/Application Support/Block/goose/` for compatibility.
//!   - `crates/goose/src/session/session_manager.rs` stores current sessions in
//!     `sessions/sessions.db`. `usage_ledger` is append-only per inference and
//!     records model, input/output/total/cache tokens, cost, cost source and
//!     compaction status. Timestamps are epoch seconds.
//!   - `goose-provider-types/.../token_usage.rs` states that cache read/write
//!     are subsets of `input_tokens`. We therefore carve them out of the
//!     normalized input bucket; adding them on top would double count.
//!   - `crates/goose/src/session/legacy.rs` documents the pre-SQLite JSONL
//!     format: the first line is session metadata and may contain accumulated
//!     token/cost totals. SQLite migration leaves those JSONL files behind.
//!
//! Precision: SQLite events are source-recorded per inference. `cost_source`
//! says whether Goose received the price from the provider, estimated it, or
//! carried a pre-ledger cumulative balance forward. Legacy JSONL exposes only
//! session-level accumulated totals, so those events opt out of daily token
//! attribution instead of pretending the file update day is the usage day.
//!
//! Double counting: when `sessions.db` has a ledger it is authoritative and
//! legacy JSONL files beside it are ignored. Imported/pre-v15 session totals
//! are not eagerly backfilled into the ledger, so the adapter emits only the
//! positive residual between each session's accumulated columns and its
//! ledger sums as one carried-forward cumulative event. A pre-v15 DB with no
//! ledger table may still fall back to legacy JSONL totals.
//! Dedupe uses ledger row id (`metadata.uuid = usage:<id>`). The database is
//! opened read-only; config, credentials and request diagnostics are never
//! read or watched.

use crate::adapter::{Adapter, AdapterContext};
use crate::error::Error;
use crate::event::{AgentEvent, DAILY_TOKEN_ATTRIBUTION_KEY, DAILY_TOKEN_ATTRIBUTION_UNAVAILABLE};
use chrono::{DateTime, Utc};
use rusqlite::{OpenFlags, OptionalExtension};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

pub struct GooseAdapter;

const COST_RESIDUAL_EPSILON: f64 = 1e-9;

enum LedgerRead {
    Missing,
    Rows(Vec<AgentEvent>),
}

impl GooseAdapter {
    pub const NAME: &'static str = "goose";

    fn session_roots(ctx: &AdapterContext) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        let mut push = |path: PathBuf| {
            if !roots.contains(&path) {
                roots.push(path);
            }
        };

        // etcetera's platform-specific paths plus historical/fallback shapes.
        push(
            ctx.home
                .join("Library")
                .join("Application Support")
                .join("Block")
                .join("goose")
                .join("sessions"),
        );
        let xdg = ctx
            .xdg_data_home
            .clone()
            .unwrap_or_else(|| ctx.home.join(".local").join("share"));
        push(xdg.join("goose").join("sessions"));
        push(xdg.join("Block").join("goose").join("sessions"));
        push(
            ctx.home
                .join("AppData")
                .join("Roaming")
                .join("Block")
                .join("goose")
                .join("sessions"),
        );
        roots
    }

    fn read_db(path: &Path) -> Result<LedgerRead, Error> {
        let conn = rusqlite::Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|source| Error::sqlite(path, source))?;

        let has_ledger = conn
            .query_row(
                "SELECT 1 FROM sqlite_master
                  WHERE type = 'table' AND name = 'usage_ledger'
                  LIMIT 1",
                [],
                |_| Ok(()),
            )
            .optional()
            .map_err(|source| Error::sqlite(path, source))?
            .is_some();
        if !has_ledger {
            return Ok(LedgerRead::Missing);
        }

        let sql = r#"
            SELECT u.id, u.session_id, u.created_timestamp, u.model,
                   u.input_tokens, u.output_tokens, u.total_tokens,
                   u.cache_read_tokens, u.cache_write_tokens,
                   u.cost, u.cost_source, u.is_compaction,
                   s.working_dir, s.session_type, s.parent_session_id,
                   s.provider_name
              FROM usage_ledger u
              LEFT JOIN sessions s ON s.id = u.session_id
             ORDER BY u.id
        "#;
        let mut stmt = conn
            .prepare(sql)
            .map_err(|source| Error::sqlite(path, source))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(LedgerRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    timestamp: row.get(2)?,
                    model: row.get(3)?,
                    input: row.get(4)?,
                    output: row.get(5)?,
                    total: row.get(6)?,
                    cache_read: row.get(7)?,
                    cache_write: row.get(8)?,
                    cost: row.get(9)?,
                    cost_source: row.get(10)?,
                    is_compaction: row.get::<_, Option<i64>>(11)?.unwrap_or(0) != 0,
                    working_dir: row.get(12)?,
                    session_type: row.get(13)?,
                    parent_session_id: row.get(14)?,
                    provider_name: row.get(15)?,
                })
            })
            .map_err(|source| Error::sqlite(path, source))?;

        let mut events = Vec::new();
        for row in rows {
            // One malformed row must not erase valid neighboring inferences.
            // Database/schema/query failures above remain typed adapter errors.
            let Ok(row) = row else {
                continue;
            };
            if let Some(event) = row.into_event(path) {
                events.push(event);
            }
        }

        // `usage_ledger` can still provide exact rows when an older/forked
        // `sessions` table does not expose Goose's accumulated counters. In
        // that shape there is no source-backed residual to derive, so retain
        // the ledger instead of failing the whole adapter or consulting stale
        // legacy JSONL.
        let mut session_columns = HashSet::new();
        let mut columns = conn
            .prepare("PRAGMA table_info(sessions)")
            .and_then(|mut stmt| {
                stmt.query_map([], |row| row.get::<_, String>(1))?
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .map_err(|source| Error::sqlite(path, source))?;
        session_columns.extend(columns.drain(..));
        const RESIDUAL_COLUMNS: &[&str] = &[
            "updated_at",
            "accumulated_input_tokens",
            "accumulated_output_tokens",
            "accumulated_total_tokens",
            "accumulated_cache_read_tokens",
            "accumulated_cache_write_tokens",
            "accumulated_cost",
        ];
        if !RESIDUAL_COLUMNS
            .iter()
            .all(|column| session_columns.contains(*column))
        {
            return Ok(LedgerRead::Rows(events));
        }

        let residual_sql = r#"
            SELECT s.id,
                   COALESCE(CAST(strftime('%s', s.updated_at) AS INTEGER),
                            CAST(s.updated_at AS INTEGER), 0),
                   s.working_dir, s.session_type, s.parent_session_id,
                   s.provider_name,
                   MAX(COALESCE(s.accumulated_input_tokens, 0)
                       - COALESCE(SUM(u.input_tokens), 0), 0),
                   MAX(COALESCE(s.accumulated_output_tokens, 0)
                       - COALESCE(SUM(u.output_tokens), 0), 0),
                   MAX(COALESCE(s.accumulated_total_tokens, 0)
                       - COALESCE(SUM(u.total_tokens), 0), 0),
                   MAX(COALESCE(s.accumulated_cache_read_tokens, 0)
                       - COALESCE(SUM(u.cache_read_tokens), 0), 0),
                   MAX(COALESCE(s.accumulated_cache_write_tokens, 0)
                       - COALESCE(SUM(u.cache_write_tokens), 0), 0),
                   MAX(COALESCE(s.accumulated_cost, 0.0)
                       - COALESCE(SUM(u.cost), 0.0), 0.0)
              FROM sessions s
              LEFT JOIN usage_ledger u ON u.session_id = s.id
             GROUP BY s.id
            HAVING MAX(COALESCE(s.accumulated_input_tokens, 0)
                       - COALESCE(SUM(u.input_tokens), 0), 0) > 0
                OR MAX(COALESCE(s.accumulated_output_tokens, 0)
                       - COALESCE(SUM(u.output_tokens), 0), 0) > 0
                OR MAX(COALESCE(s.accumulated_total_tokens, 0)
                       - COALESCE(SUM(u.total_tokens), 0), 0) > 0
                OR MAX(COALESCE(s.accumulated_cache_read_tokens, 0)
                       - COALESCE(SUM(u.cache_read_tokens), 0), 0) > 0
                OR MAX(COALESCE(s.accumulated_cache_write_tokens, 0)
                       - COALESCE(SUM(u.cache_write_tokens), 0), 0) > 0
                OR MAX(COALESCE(s.accumulated_cost, 0.0)
                       - COALESCE(SUM(u.cost), 0.0), 0.0) > ?1
        "#;
        let mut stmt = conn
            .prepare(residual_sql)
            .map_err(|source| Error::sqlite(path, source))?;
        let residuals = stmt
            .query_map([COST_RESIDUAL_EPSILON], |row| {
                Ok(CarriedForwardRow {
                    session_id: row.get(0)?,
                    timestamp: row.get(1)?,
                    working_dir: row.get(2)?,
                    session_type: row.get(3)?,
                    parent_session_id: row.get(4)?,
                    provider_name: row.get(5)?,
                    input: row.get(6)?,
                    output: row.get(7)?,
                    total: row.get(8)?,
                    cache_read: row.get(9)?,
                    cache_write: row.get(10)?,
                    cost: row.get(11)?,
                })
            })
            .map_err(|source| Error::sqlite(path, source))?;
        for row in residuals.flatten() {
            if let Some(event) = row.into_event(path) {
                events.push(event);
            }
        }
        Ok(LedgerRead::Rows(events))
    }

    fn read_legacy(root: &Path) -> Vec<AgentEvent> {
        let mut files = list_files(root, "jsonl");
        files.sort();
        files
            .into_iter()
            .filter_map(|path| legacy_event(&path))
            .collect()
    }
}

impl Adapter for GooseAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        Self::session_roots(ctx).into_iter().any(|root| {
            root.join("sessions.db").is_file() || !list_files(&root, "jsonl").is_empty()
        })
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let mut events = Vec::new();
        let mut seen = HashSet::new();
        for root in Self::session_roots(ctx) {
            let db = root.join("sessions.db");
            let rows = if db.is_file() {
                match Self::read_db(&db)? {
                    // Pre-v15 databases have no usage_ledger. Goose keeps the
                    // imported JSONL source beside the DB, so retain its real
                    // cumulative totals until Goose itself migrates/backfills.
                    LedgerRead::Missing => Self::read_legacy(&root),
                    // A supported ledger plus DB-derived carried-forward
                    // residuals is authoritative even when the ledger itself
                    // is empty. Query/schema failures are errors, never
                    // permission to expose stale legacy totals.
                    LedgerRead::Rows(ledger) => ledger,
                }
            } else {
                Self::read_legacy(&root)
            };
            for event in rows {
                let key = (
                    event.session_id.clone(),
                    event.metadata.get("uuid").cloned(),
                );
                if seen.insert(key) {
                    events.push(event);
                }
            }
        }
        Ok(events)
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        let mut paths = Vec::new();
        for root in Self::session_roots(ctx) {
            let db = root.join("sessions.db");
            if db.is_file() {
                paths.push(db.with_extension("db-wal"));
                paths.push(db);
            } else if root.is_dir() {
                paths.push(root);
            }
        }
        paths
    }
}

#[derive(Debug)]
struct LedgerRow {
    id: i64,
    session_id: String,
    timestamp: i64,
    model: Option<String>,
    input: Option<i64>,
    output: Option<i64>,
    total: Option<i64>,
    cache_read: Option<i64>,
    cache_write: Option<i64>,
    cost: Option<f64>,
    cost_source: Option<String>,
    is_compaction: bool,
    working_dir: Option<String>,
    session_type: Option<String>,
    parent_session_id: Option<String>,
    provider_name: Option<String>,
}

#[derive(Debug)]
struct CarriedForwardRow {
    session_id: String,
    timestamp: i64,
    working_dir: Option<String>,
    session_type: Option<String>,
    parent_session_id: Option<String>,
    provider_name: Option<String>,
    input: i64,
    output: i64,
    total: i64,
    cache_read: i64,
    cache_write: i64,
    cost: f64,
}

impl LedgerRow {
    fn into_event(self, db: &Path) -> Option<AgentEvent> {
        let timestamp = epoch(self.timestamp)?;
        let raw_input = nonnegative(self.input);
        let cache_read = nonnegative(self.cache_read);
        let cache_write = nonnegative(self.cache_write);
        let uncached_input = raw_input.saturating_sub(cache_read.saturating_add(cache_write));

        let mut event = AgentEvent::new(GooseAdapter::NAME, timestamp);
        event.session_id = nonempty(Some(self.session_id.clone()));
        event.project_path = nonempty(self.working_dir);
        event.event_type = if self.is_compaction {
            "compaction".to_string()
        } else {
            "message".to_string()
        };
        event.usage.input_tokens = uncached_input;
        event.usage.output_tokens = nonnegative(self.output);
        event.usage.cache_read_tokens = cache_read;
        event.usage.cache_write_tokens = cache_write;
        let reported_total = nonnegative(self.total);
        let bucket_sum = event
            .usage
            .input_tokens
            .saturating_add(event.usage.output_tokens)
            .saturating_add(event.usage.cache_read_tokens)
            .saturating_add(event.usage.cache_write_tokens);
        event.usage.total_tokens = reported_total.max(bucket_sum);
        event.model = nonempty(self.model);
        event.cost_usd = self.cost.filter(|value| value.is_finite() && *value > 0.0);
        event.raw_ref = Some(format!("{}:usage_ledger:{}", db.display(), self.id));
        event.metadata.insert(
            "uuid".to_string(),
            serde_json::Value::String(format!("usage:{}", self.id)),
        );
        event.metadata.insert(
            "raw_input_tokens".to_string(),
            serde_json::Value::from(raw_input),
        );
        if reported_total < bucket_sum {
            event.metadata.insert(
                "reported_total_tokens".to_string(),
                serde_json::Value::from(reported_total),
            );
        }
        insert_opt(&mut event.metadata, "cost_source", self.cost_source);
        insert_opt(&mut event.metadata, "session_type", self.session_type);
        insert_opt(
            &mut event.metadata,
            "parent_session_id",
            self.parent_session_id,
        );
        insert_opt(&mut event.metadata, "provider_name", self.provider_name);
        event.metadata.insert(
            "is_compaction".to_string(),
            serde_json::Value::Bool(self.is_compaction),
        );
        Some(event)
    }
}

impl CarriedForwardRow {
    fn into_event(self, db: &Path) -> Option<AgentEvent> {
        let timestamp = epoch(self.timestamp)?;
        let raw_input = nonnegative(Some(self.input));
        let cache_read = nonnegative(Some(self.cache_read));
        let cache_write = nonnegative(Some(self.cache_write));
        let mut event = AgentEvent::new(GooseAdapter::NAME, timestamp);
        event.session_id = nonempty(Some(self.session_id.clone()));
        event.project_path = nonempty(self.working_dir);
        event.event_type = "session_usage".to_string();
        event.usage.input_tokens = raw_input.saturating_sub(cache_read.saturating_add(cache_write));
        event.usage.output_tokens = nonnegative(Some(self.output));
        event.usage.cache_read_tokens = cache_read;
        event.usage.cache_write_tokens = cache_write;
        let reported_total = nonnegative(Some(self.total));
        let bucket_sum = event
            .usage
            .input_tokens
            .saturating_add(event.usage.output_tokens)
            .saturating_add(event.usage.cache_read_tokens)
            .saturating_add(event.usage.cache_write_tokens);
        event.usage.total_tokens = reported_total.max(bucket_sum);
        event.cost_usd =
            (self.cost.is_finite() && self.cost > COST_RESIDUAL_EPSILON).then_some(self.cost);
        event.raw_ref = Some(format!("{}:sessions:{}", db.display(), self.session_id));
        event.metadata.insert(
            "uuid".to_string(),
            serde_json::Value::String(format!("carried-forward:{}", self.session_id)),
        );
        event.metadata.insert(
            "storage_format".to_string(),
            serde_json::Value::String("sqlite_carried_forward".to_string()),
        );
        event.metadata.insert(
            "cost_source".to_string(),
            serde_json::Value::String("carried_forward".to_string()),
        );
        if reported_total < bucket_sum {
            event.metadata.insert(
                "reported_total_tokens".to_string(),
                serde_json::Value::from(reported_total),
            );
        }
        event.metadata.insert(
            DAILY_TOKEN_ATTRIBUTION_KEY.to_string(),
            serde_json::Value::String(DAILY_TOKEN_ATTRIBUTION_UNAVAILABLE.to_string()),
        );
        insert_opt(&mut event.metadata, "session_type", self.session_type);
        insert_opt(
            &mut event.metadata,
            "parent_session_id",
            self.parent_session_id,
        );
        insert_opt(&mut event.metadata, "provider_name", self.provider_name);
        Some(event)
    }
}

fn legacy_event(path: &Path) -> Option<AgentEvent> {
    let first = std::fs::read_to_string(path)
        .ok()?
        .lines()
        .find(|line| !line.trim().is_empty())?
        .to_string();
    let value: serde_json::Value = serde_json::from_str(&first).ok()?;
    let usage = value.get("accumulated_usage");
    let raw_input =
        value_u64(usage, "input_tokens").max(value_u64(Some(&value), "accumulated_input_tokens"));
    let output =
        value_u64(usage, "output_tokens").max(value_u64(Some(&value), "accumulated_output_tokens"));
    let total =
        value_u64(usage, "total_tokens").max(value_u64(Some(&value), "accumulated_total_tokens"));
    let cache_read = value_u64(usage, "cache_read_input_tokens")
        .max(value_u64(Some(&value), "accumulated_cache_read_tokens"));
    let cache_write = value_u64(usage, "cache_write_input_tokens")
        .max(value_u64(Some(&value), "accumulated_cache_write_tokens"));
    let cost = value
        .get("accumulated_cost")
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite() && *v > 0.0);
    if raw_input == 0 && output == 0 && total == 0 && cost.is_none() {
        return None;
    }

    let timestamp = value
        .get("updated_at")
        .and_then(|v| v.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .or_else(|| {
            std::fs::metadata(path)
                .ok()?
                .modified()
                .ok()
                .map(DateTime::<Utc>::from)
        })?;
    let session_id = value
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| path.file_stem()?.to_str().map(str::to_string))?;

    let mut event = AgentEvent::new(GooseAdapter::NAME, timestamp);
    event.session_id = Some(session_id.clone());
    event.project_path = value
        .get("working_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    event.event_type = "session_usage".to_string();
    event.usage.input_tokens = raw_input.saturating_sub(cache_read.saturating_add(cache_write));
    event.usage.output_tokens = output;
    event.usage.cache_read_tokens = cache_read;
    event.usage.cache_write_tokens = cache_write;
    event.usage.total_tokens = total;
    event.normalize_totals();
    event.cost_usd = cost;
    event.raw_ref = Some(format!("{}:1", path.display()));
    event.metadata.insert(
        "uuid".to_string(),
        serde_json::Value::String(format!("legacy:{session_id}")),
    );
    event.metadata.insert(
        "storage_format".to_string(),
        serde_json::Value::String("legacy_jsonl".to_string()),
    );
    event.metadata.insert(
        DAILY_TOKEN_ATTRIBUTION_KEY.to_string(),
        serde_json::Value::String(DAILY_TOKEN_ATTRIBUTION_UNAVAILABLE.to_string()),
    );
    Some(event)
}

fn epoch(value: i64) -> Option<DateTime<Utc>> {
    if value <= 0 {
        return None;
    }
    if value > 10_000_000_000 {
        DateTime::<Utc>::from_timestamp_millis(value)
    } else {
        DateTime::<Utc>::from_timestamp(value, 0)
    }
}

fn nonnegative(value: Option<i64>) -> u64 {
    value.unwrap_or(0).max(0) as u64
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.filter(|s| !s.is_empty())
}

fn insert_opt(map: &mut BTreeMap<String, serde_json::Value>, key: &str, value: Option<String>) {
    if let Some(value) = nonempty(value) {
        map.insert(key.to_string(), serde_json::Value::String(value));
    }
}

fn value_u64(parent: Option<&serde_json::Value>, key: &str) -> u64 {
    parent
        .and_then(|v| v.get(key))
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
        .max(0) as u64
}

fn list_files(root: &Path, extension: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file() && path.extension().and_then(|s| s.to_str()) == Some(extension)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn temp_home(tag: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("lag-goose-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn root(home: &Path) -> PathBuf {
        home.join("Library")
            .join("Application Support")
            .join("Block")
            .join("goose")
            .join("sessions")
    }

    fn make_db(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY, working_dir TEXT, session_type TEXT,
                parent_session_id TEXT, provider_name TEXT, updated_at TEXT,
                accumulated_input_tokens INTEGER,
                accumulated_output_tokens INTEGER,
                accumulated_total_tokens INTEGER,
                accumulated_cache_read_tokens INTEGER,
                accumulated_cache_write_tokens INTEGER,
                accumulated_cost REAL
             );
             CREATE TABLE usage_ledger (
                id INTEGER PRIMARY KEY, session_id TEXT, created_timestamp INTEGER,
                model TEXT, input_tokens INTEGER, output_tokens INTEGER,
                total_tokens INTEGER, cache_read_tokens INTEGER,
                cache_write_tokens INTEGER, cost REAL, cost_source TEXT,
                is_compaction INTEGER
             );
             INSERT INTO sessions VALUES
               ('s1', '/tmp/demo', 'user', NULL, 'anthropic',
                '2026-07-12T00:00:00Z', 100, 20, 120, 70, 5, 0.012),
               ('s2', '/tmp/demo', 'sub_agent', 's1', 'openai',
                '2026-07-12T00:00:01Z', 50, 10, 60, 0, 0, 0.004);
             INSERT INTO usage_ledger VALUES
               (7, 's1', 1783814400, 'claude-sonnet-4-6', 100, 20, 120,
                70, 5, 0.012, 'provider_reported', 0),
               (8, 's2', 1783814401, 'gpt-5.2', 50, 10, 60,
                0, 0, 0.004, 'estimated', 1);",
        )
        .unwrap();
    }

    #[test]
    fn sqlite_ledger_emits_exact_disjoint_usage() {
        let home = temp_home("db");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        make_db(&sessions.join("sessions.db"));
        let ctx = AdapterContext::with_home(&home);
        assert!(GooseAdapter.discover(&ctx));
        let events = GooseAdapter.collect(&ctx).unwrap();
        assert_eq!(events.len(), 2);
        let event = &events[0];
        assert_eq!(event.source, "goose");
        assert_eq!(event.session_id.as_deref(), Some("s1"));
        assert_eq!(event.project_path.as_deref(), Some("/tmp/demo"));
        assert_eq!(event.model.as_deref(), Some("claude-sonnet-4-6"));
        assert_eq!(event.usage.input_tokens, 25);
        assert_eq!(event.usage.cache_read_tokens, 70);
        assert_eq!(event.usage.cache_write_tokens, 5);
        assert_eq!(event.usage.output_tokens, 20);
        assert_eq!(event.usage.total_tokens, 120);
        assert_eq!(event.cost_usd, Some(0.012));
        assert_eq!(
            event.metadata.get("cost_source").and_then(|v| v.as_str()),
            Some("provider_reported")
        );
        assert_eq!(events[1].event_type, "compaction");
        assert_eq!(
            events[1]
                .metadata
                .get("parent_session_id")
                .and_then(|v| v.as_str()),
            Some("s1")
        );
    }

    #[test]
    fn inconsistent_reported_total_is_clamped_to_disjoint_buckets() {
        let home = temp_home("total-clamp");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        let db = sessions.join("sessions.db");
        make_db(&db);
        let conn = Connection::open(&db).unwrap();
        conn.execute(
            "INSERT INTO usage_ledger VALUES
             (9, 's1', 1783814402, 'broken-total', 10, 5, 1,
              0, 0, 0.0, 'estimated', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE sessions SET accumulated_input_tokens = 110,
                                 accumulated_output_tokens = 25,
                                 accumulated_total_tokens = 121
              WHERE id = 's1'",
            [],
        )
        .unwrap();
        drop(conn);

        let events = GooseAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        let event = events
            .iter()
            .find(|event| event.model.as_deref() == Some("broken-total"))
            .unwrap();
        assert_eq!(event.usage.total_tokens, 15);
        assert_eq!(
            event.metadata.get("reported_total_tokens"),
            Some(&serde_json::json!(1))
        );

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn database_wins_over_leftover_legacy_jsonl() {
        let home = temp_home("precedence");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        make_db(&sessions.join("sessions.db"));
        std::fs::write(
            sessions.join("old.jsonl"),
            r#"{"id":"old","updated_at":"2026-07-11T00:00:00Z","accumulated_input_tokens":999,"accumulated_output_tokens":1}"#,
        )
        .unwrap();
        let events = GooseAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 2);
        assert!(
            events
                .iter()
                .all(|e| e.session_id.as_deref() != Some("old"))
        );
    }

    #[test]
    fn pre_ledger_database_falls_back_to_legacy_totals() {
        let home = temp_home("pre-ledger");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        let conn = Connection::open(sessions.join("sessions.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, working_dir TEXT);
             INSERT INTO sessions VALUES ('old', '/tmp/old');",
        )
        .unwrap();
        drop(conn);
        std::fs::write(
            sessions.join("old.jsonl"),
            r#"{"id":"old","working_dir":"/tmp/old","updated_at":"2026-07-11T00:00:00Z","accumulated_input_tokens":10,"accumulated_output_tokens":2,"accumulated_total_tokens":12}"#,
        )
        .unwrap();
        let events = GooseAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_id.as_deref(), Some("old"));
        assert!(!events[0].has_daily_token_attribution());
    }

    #[test]
    fn incompatible_modern_schema_errors_instead_of_exposing_legacy() {
        let home = temp_home("schema-drift");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        let conn = Connection::open(sessions.join("sessions.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY, working_dir TEXT, session_type TEXT,
                parent_session_id TEXT, provider_name TEXT
             );
             CREATE TABLE usage_ledger (
                id INTEGER PRIMARY KEY, session_id TEXT, created_timestamp INTEGER,
                model TEXT, input_tokens INTEGER, output_tokens INTEGER,
                total_tokens INTEGER, cache_read_tokens INTEGER,
                cache_write_tokens INTEGER, cost REAL,
                is_compaction INTEGER
             );
             INSERT INTO usage_ledger VALUES
               (9, 'live', 1783814400, 'claude-sonnet-4-6', 10, 2, 12,
                0, 0, 0.002, 0);",
        )
        .unwrap();
        drop(conn);
        std::fs::write(
            sessions.join("stale.jsonl"),
            r#"{"id":"stale","updated_at":"2026-07-11T00:00:00Z","accumulated_input_tokens":999,"accumulated_output_tokens":1}"#,
        )
        .unwrap();

        let result = GooseAdapter.collect(&AdapterContext::with_home(&home));
        assert!(matches!(result, Err(Error::Sqlite { .. })));
    }

    #[test]
    fn ledger_without_accumulated_session_columns_keeps_exact_rows_only() {
        let home = temp_home("ledger-only-schema");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        let conn = Connection::open(sessions.join("sessions.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY, working_dir TEXT, session_type TEXT,
                parent_session_id TEXT, provider_name TEXT
             );
             CREATE TABLE usage_ledger (
                id INTEGER PRIMARY KEY, session_id TEXT, created_timestamp INTEGER,
                model TEXT, input_tokens INTEGER, output_tokens INTEGER,
                total_tokens INTEGER, cache_read_tokens INTEGER,
                cache_write_tokens INTEGER, cost REAL, cost_source TEXT,
                is_compaction INTEGER
             );
             INSERT INTO sessions VALUES ('s1', '/tmp/demo', 'user', NULL, 'openai');
             INSERT INTO usage_ledger VALUES
               (1, 's1', 1783814400, 'gpt-5', 10, 2, 12,
                0, 0, 0.001, 'provider_reported', 0);",
        )
        .unwrap();
        drop(conn);
        std::fs::write(
            sessions.join("stale.jsonl"),
            r#"{"id":"stale","updated_at":"2026-07-11T00:00:00Z","accumulated_input_tokens":999}"#,
        )
        .unwrap();

        let events = GooseAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_id.as_deref(), Some("s1"));
        assert_eq!(events[0].usage.total_tokens, 12);
        assert!(events[0].has_daily_token_attribution());
    }

    #[test]
    fn empty_modern_ledger_uses_db_accumulated_residual_not_legacy() {
        let home = temp_home("empty-ledger");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        let db = sessions.join("sessions.db");
        make_db(&db);
        Connection::open(&db)
            .unwrap()
            .execute("DELETE FROM usage_ledger", [])
            .unwrap();
        std::fs::write(
            sessions.join("stale.jsonl"),
            r#"{"id":"stale","updated_at":"2026-07-11T00:00:00Z","accumulated_input_tokens":999,"accumulated_output_tokens":1}"#,
        )
        .unwrap();

        let events = GooseAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|event| {
            event
                .metadata
                .get("storage_format")
                .and_then(|v| v.as_str())
                == Some("sqlite_carried_forward")
                && !event.has_daily_token_attribution()
                && event.session_id.as_deref() != Some("stale")
        }));
        assert_eq!(
            events
                .iter()
                .map(|event| event.usage.total_tokens)
                .sum::<u64>(),
            180
        );
    }

    #[test]
    fn partial_ledger_emits_only_positive_session_residual() {
        let home = temp_home("partial-ledger");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        let db = sessions.join("sessions.db");
        make_db(&db);
        let conn = Connection::open(&db).unwrap();
        conn.execute(
            "UPDATE sessions SET accumulated_input_tokens = 130,
                                 accumulated_total_tokens = 150,
                                 accumulated_cost = 0.018
              WHERE id = 's1'",
            [],
        )
        .unwrap();
        drop(conn);

        let events = GooseAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 3);
        let carried = events
            .iter()
            .find(|event| {
                event.metadata.get("cost_source").and_then(|v| v.as_str())
                    == Some("carried_forward")
            })
            .unwrap();
        assert_eq!(carried.session_id.as_deref(), Some("s1"));
        assert_eq!(carried.usage.input_tokens, 30);
        assert_eq!(carried.usage.total_tokens, 30);
        assert!((carried.cost_usd.unwrap() - 0.006).abs() < 1e-9);
        assert!(!carried.has_daily_token_attribution());
    }

    #[test]
    fn fresh_empty_modern_database_emits_no_usage() {
        let home = temp_home("fresh-empty");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        let db = sessions.join("sessions.db");
        make_db(&db);
        let conn = Connection::open(&db).unwrap();
        conn.execute("DELETE FROM usage_ledger", []).unwrap();
        conn.execute("DELETE FROM sessions", []).unwrap();
        drop(conn);

        let events = GooseAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn null_residual_timestamp_and_float_dust_do_not_create_phantom_activity() {
        let home = temp_home("residual-dust");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        let db = sessions.join("sessions.db");
        make_db(&db);
        let conn = Connection::open(&db).unwrap();
        conn.execute(
            "UPDATE sessions SET accumulated_cost = accumulated_cost + 0.000000000001
              WHERE id = 's1'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE sessions SET updated_at = NULL,
                                 accumulated_input_tokens = accumulated_input_tokens + 1,
                                 accumulated_total_tokens = accumulated_total_tokens + 1
              WHERE id = 's2'",
            [],
        )
        .unwrap();
        drop(conn);

        let events = GooseAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|event| event.timestamp.timestamp() > 0));
        assert!(events.iter().all(|event| {
            event
                .metadata
                .get("cost_source")
                .and_then(|value| value.as_str())
                != Some("carried_forward")
        }));
        assert!(epoch(0).is_none());
    }

    #[test]
    fn wal_writer_keeps_committed_ledger_readable() {
        let home = temp_home("wal-reader");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        let db = sessions.join("sessions.db");
        make_db(&db);
        let mut writer = Connection::open(&db).unwrap();
        writer.pragma_update(None, "journal_mode", "WAL").unwrap();
        let tx = writer.transaction().unwrap();
        tx.execute(
            "INSERT INTO usage_ledger VALUES
             (99, 's1', 1783814402, 'pending', 1, 1, 2,
              0, 0, 0.0, 'estimated', 0)",
            [],
        )
        .unwrap();
        std::fs::write(
            sessions.join("stale.jsonl"),
            r#"{"id":"stale","updated_at":"2026-07-11T00:00:00Z","accumulated_input_tokens":999,"accumulated_output_tokens":1}"#,
        )
        .unwrap();

        let events = GooseAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 2);
        assert!(
            events
                .iter()
                .all(|event| event.session_id.as_deref() != Some("stale"))
        );
        drop(tx);
    }

    #[test]
    fn watch_paths_cover_db_and_wal_but_not_data_or_config_roots() {
        let home = temp_home("watch");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        make_db(&sessions.join("sessions.db"));
        let paths = GooseAdapter.watch_paths(&AdapterContext::with_home(&home));
        assert!(paths.contains(&sessions.join("sessions.db")));
        assert!(paths.contains(&sessions.join("sessions.db-wal")));
        assert!(!paths.contains(&sessions.parent().unwrap().to_path_buf()));
        assert!(paths.iter().all(|path| !path.ends_with("config.yaml")));
    }

    #[test]
    fn legacy_totals_are_kept_but_not_assigned_to_one_day() {
        let home = temp_home("legacy");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        std::fs::write(
            sessions.join("20260711_080000.jsonl"),
            r#"{"id":"legacy-1","working_dir":"/tmp/old","updated_at":"2026-07-11T00:00:00Z","accumulated_input_tokens":100,"accumulated_output_tokens":20,"accumulated_total_tokens":120,"accumulated_cache_read_tokens":60,"accumulated_cache_write_tokens":10,"accumulated_cost":0.02}
{"role":"user","created":1783814400,"content":[]}"#,
        )
        .unwrap();
        let events = GooseAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].usage.input_tokens, 30);
        assert_eq!(events[0].usage.total_tokens, 120);
        assert!(!events[0].has_daily_token_attribution());
    }

    #[test]
    fn corrupt_rows_and_negative_counts_are_tolerated() {
        let home = temp_home("corrupt");
        let sessions = root(&home);
        std::fs::create_dir_all(&sessions).unwrap();
        std::fs::write(sessions.join("bad.jsonl"), "not-json\n").unwrap();
        assert!(
            GooseAdapter
                .collect(&AdapterContext::with_home(&home))
                .unwrap()
                .is_empty()
        );
    }
}
