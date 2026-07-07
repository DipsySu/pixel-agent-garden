//! Garden history ("rings") persistence.
//!
//! Rings are the append-only memory of the garden. They are derived from the
//! core summary, stored under `~/.local-agent-garden/`, and never written by the
//! frontend. The summary remains the truthful current accounting surface; rings
//! provide high-water display tiers for permanent courtyard unlocks so source-log
//! rotation cannot visually demolish the garden.

use crate::aggregate::{GardenSummary, GardenTiers, PAVILION_TRINKETS};
use crate::error::Error;
use crate::storage;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub const RINGS_SCHEMA_VERSION: u32 = 1;

pub fn default_rings_path() -> PathBuf {
    storage::default_state_dir().join("rings.json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RingBook {
    pub schema_version: u32,
    #[serde(default)]
    pub snapshot: RingSnapshot,
    #[serde(default)]
    pub events: Vec<RingEvent>,
}

impl Default for RingBook {
    fn default() -> Self {
        Self {
            schema_version: RINGS_SCHEMA_VERSION,
            snapshot: RingSnapshot::default(),
            events: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RingSnapshot {
    #[serde(default)]
    pub tiers: GardenTiers,
    #[serde(default)]
    pub projects: BTreeMap<String, ProjectSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectSnapshot {
    pub display_name: String,
    #[serde(default, with = "crate::aggregate::opt_ts_serde")]
    pub first_seen: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RingEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub entity: String,
    pub utc_date: String,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub payload: BTreeMap<String, Value>,
}

/// Load rings from disk. Missing files produce an empty book; future schema
/// versions fail clearly so callers do not misinterpret the user's memory.
pub fn load(path: &Path) -> Result<RingBook, Error> {
    if !path.exists() {
        return Ok(RingBook::default());
    }
    let text = std::fs::read_to_string(path).map_err(|e| Error::io(path, e))?;
    let book: RingBook = serde_json::from_str(&text).map_err(|e| Error::json(path, e))?;
    if book.schema_version > RINGS_SCHEMA_VERSION {
        return Err(Error::InvalidRecord {
            context: path.display().to_string(),
            message: format!(
                "rings schema_version {} exceeds reader version {}; delete or migrate rings.json",
                book.schema_version, RINGS_SCHEMA_VERSION
            ),
        });
    }
    Ok(book)
}

/// Apply rings memory to `summary.tiers` without writing to disk. Used when a
/// fresh cache can be served directly and no new scan happened.
pub fn apply_snapshot_tiers(
    mut summary: GardenSummary,
    path: &Path,
) -> Result<GardenSummary, Error> {
    let book = load(path)?;
    if !book.events.is_empty() || !book.snapshot.projects.is_empty() {
        let observed = summary
            .tiers
            .clone()
            .unwrap_or_else(|| crate::aggregate::derive_tiers(&summary));
        summary.tiers = Some(merge_display_tiers(&book.snapshot.tiers, &observed));
    }
    Ok(summary)
}

/// Update `rings.json` from the current summary and return the display summary.
/// Permanent tiers merge with high-water state; daily/seasonal states stay live.
pub fn record_summary(
    mut summary: GardenSummary,
    path: &Path,
    now: DateTime<Utc>,
) -> Result<GardenSummary, Error> {
    let observed = summary
        .tiers
        .clone()
        .unwrap_or_else(|| crate::aggregate::derive_tiers_at(&summary, now));
    let mut book = load(path)?;
    let previous = book.snapshot.tiers.clone();
    let utc_date = now.format("%Y-%m-%d").to_string();

    let mut events = derive_project_events(&summary, &book.snapshot.projects, &utc_date);
    events.extend(derive_tier_events(&previous, &observed, &utc_date));
    events.extend(derive_trinket_events(&previous, &observed, &utc_date));
    append_unique_events(&mut book.events, events);

    book.snapshot.tiers = merge_display_tiers(&previous, &observed);
    for project in &summary.projects {
        book.snapshot
            .projects
            .entry(project.project_key.clone())
            .or_insert_with(|| ProjectSnapshot {
                display_name: project.display_name.clone(),
                first_seen: project.first_seen,
            });
    }

    save_atomic(&book, path)?;
    summary.tiers = Some(book.snapshot.tiers.clone());
    Ok(summary)
}

/// Merge permanent courtyard unlocks upward while preserving live states.
///
/// High-water:
/// - pavilion, willow, stone_cat, stool, cushion
/// - trinket list
/// - cumulative token/session counters
///
/// Live/current:
/// - cherry, lamp
/// - recent_activity, today_activity
pub fn merge_display_tiers(previous: &GardenTiers, observed: &GardenTiers) -> GardenTiers {
    let mut merged = observed.clone();
    merged.total_tokens = previous.total_tokens.max(observed.total_tokens);
    merged.max_project_tokens = previous.max_project_tokens.max(observed.max_project_tokens);
    merged.total_sessions = previous.total_sessions.max(observed.total_sessions);
    merged.pavilion = max_by_rank(
        &previous.pavilion,
        &observed.pavilion,
        &["small", "mid", "full"],
    );
    merged.willow = max_by_rank(&previous.willow, &observed.willow, &["young", "mature"]);
    merged.stone_cat = max_by_rank(
        &previous.stone_cat,
        &observed.stone_cat,
        &["hidden", "small", "full"],
    );
    merged.stool = max_by_rank(&previous.stool, &observed.stool, &["hidden", "visible"]);
    merged.cushion = max_by_rank(&previous.cushion, &observed.cushion, &["hidden", "visible"]);
    merged.pavilion_trinkets =
        union_trinkets(&previous.pavilion_trinkets, &observed.pavilion_trinkets);
    merged
}

fn derive_project_events(
    summary: &GardenSummary,
    seen: &BTreeMap<String, ProjectSnapshot>,
    utc_date: &str,
) -> Vec<RingEvent> {
    let mut out = Vec::new();
    for project in &summary.projects {
        if seen.contains_key(&project.project_key) {
            continue;
        }
        let mut payload = BTreeMap::new();
        payload.insert("project_key".to_string(), json!(project.project_key));
        payload.insert("total_tokens".to_string(), json!(project.total_tokens));
        if let Some(path) = &project.project_path {
            payload.insert("project_path".to_string(), json!(path));
        }
        if let Some(first_seen) = project.first_seen {
            payload.insert("first_seen".to_string(), json!(first_seen.to_rfc3339()));
        }
        out.push(RingEvent {
            id: event_id("first_seen_project", &project.project_key, "seen", utc_date),
            event_type: "first_seen_project".to_string(),
            entity: project.project_key.clone(),
            utc_date: utc_date.to_string(),
            from: None,
            to: Some("seen".to_string()),
            label: Some(project.display_name.clone()),
            payload,
        });
    }
    out
}

fn derive_tier_events(
    previous: &GardenTiers,
    observed: &GardenTiers,
    utc_date: &str,
) -> Vec<RingEvent> {
    [
        (
            "pavilion",
            &previous.pavilion,
            &observed.pavilion,
            &["small", "mid", "full"][..],
        ),
        (
            "willow",
            &previous.willow,
            &observed.willow,
            &["young", "mature"][..],
        ),
        (
            "stone_cat",
            &previous.stone_cat,
            &observed.stone_cat,
            &["hidden", "small", "full"][..],
        ),
        (
            "stool",
            &previous.stool,
            &observed.stool,
            &["hidden", "visible"][..],
        ),
        (
            "cushion",
            &previous.cushion,
            &observed.cushion,
            &["hidden", "visible"][..],
        ),
    ]
    .into_iter()
    .filter(|(_, from, to, order)| rank(to, order) > rank(from, order))
    .map(|(entity, from, to, _)| {
        let mut payload = BTreeMap::new();
        payload.insert("from".to_string(), json!(from));
        payload.insert("to".to_string(), json!(to));
        RingEvent {
            id: event_id("tier_up", entity, to, utc_date),
            event_type: "tier_up".to_string(),
            entity: entity.to_string(),
            utc_date: utc_date.to_string(),
            from: Some((*from).to_string()),
            to: Some((*to).to_string()),
            label: None,
            payload,
        }
    })
    .collect()
}

fn derive_trinket_events(
    previous: &GardenTiers,
    observed: &GardenTiers,
    utc_date: &str,
) -> Vec<RingEvent> {
    let before: BTreeSet<&str> = previous
        .pavilion_trinkets
        .iter()
        .map(String::as_str)
        .collect();
    observed
        .pavilion_trinkets
        .iter()
        .filter(|id| !before.contains(id.as_str()))
        .map(|id| {
            let mut payload = BTreeMap::new();
            payload.insert("trinket".to_string(), json!(id));
            RingEvent {
                id: event_id("trinket_unlocked", id, "unlocked", utc_date),
                event_type: "trinket_unlocked".to_string(),
                entity: id.clone(),
                utc_date: utc_date.to_string(),
                from: None,
                to: Some("unlocked".to_string()),
                label: Some(id.clone()),
                payload,
            }
        })
        .collect()
}

fn append_unique_events(existing: &mut Vec<RingEvent>, incoming: Vec<RingEvent>) {
    let mut seen: BTreeSet<String> = existing.iter().map(|event| event.id.clone()).collect();
    for event in incoming {
        if seen.insert(event.id.clone()) {
            existing.push(event);
        }
    }
}

fn save_atomic(book: &RingBook, path: &Path) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    }
    let json = serde_json::to_string_pretty(book).map_err(|e| Error::json(path, e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| Error::io(&tmp, e))?;
    std::fs::rename(&tmp, path).map_err(|e| Error::io(path, e))?;
    Ok(())
}

fn event_id(event_type: &str, entity: &str, to: &str, utc_date: &str) -> String {
    format!("{event_type}:{entity}:{to}:{utc_date}")
}

fn max_by_rank(previous: &str, observed: &str, order: &[&str]) -> String {
    if rank(previous, order) > rank(observed, order) {
        previous.to_string()
    } else {
        observed.to_string()
    }
}

fn rank(value: &str, order: &[&str]) -> usize {
    order.iter().position(|v| *v == value).unwrap_or(0)
}

fn union_trinkets(previous: &[String], observed: &[String]) -> Vec<String> {
    let set: BTreeSet<&str> = previous
        .iter()
        .chain(observed.iter())
        .map(String::as_str)
        .collect();
    let mut ordered: Vec<String> = PAVILION_TRINKETS
        .iter()
        .filter(|(id, _)| set.contains(id))
        .map(|(id, _)| (*id).to_string())
        .collect();
    for id in set {
        if !ordered.iter().any(|known| known == id) {
            ordered.push(id.to_string());
        }
    }
    ordered
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aggregate;
    use crate::event::AgentEvent;
    use chrono::TimeZone;

    fn tmp_path(suffix: &str) -> PathBuf {
        std::env::temp_dir().join(format!("lag-rings-{}-{suffix}.json", std::process::id()))
    }

    fn event(project: &str, tokens: u64, sessions: &str) -> AgentEvent {
        let mut event = AgentEvent::new(
            "manual-test",
            Utc.with_ymd_and_hms(2026, 7, 7, 10, 0, 0).unwrap(),
        );
        event.project_path = Some(project.to_string());
        event.session_id = Some(sessions.to_string());
        event.usage.total_tokens = tokens;
        event
    }

    #[test]
    fn record_summary_keeps_permanent_tiers_at_high_water() {
        let path = tmp_path("high-water");
        let _ = std::fs::remove_file(&path);
        let now = Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap();
        let big = aggregate::summarize_at(&[event("/repo/big", 120_000_000, "s1")], now);
        let big = record_summary(big, &path, now).unwrap();
        assert_eq!(big.tiers.as_ref().unwrap().pavilion, "full");
        assert!(
            big.tiers
                .as_ref()
                .unwrap()
                .pavilion_trinkets
                .contains(&"incense".to_string())
        );

        let shrunk = aggregate::summarize_at(&[event("/repo/big", 500, "s1")], now);
        let shrunk = record_summary(shrunk, &path, now).unwrap();

        let tiers = shrunk.tiers.as_ref().unwrap();
        assert_eq!(tiers.pavilion, "full");
        assert!(tiers.pavilion_trinkets.contains(&"incense".to_string()));
        // Live states still follow the current observation.
        assert_eq!(tiers.lamp, "lit");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn record_summary_appends_first_seen_and_unlock_events_once() {
        let path = tmp_path("events");
        let _ = std::fs::remove_file(&path);
        let now = Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap();
        let summary = aggregate::summarize_at(&[event("/repo/big", 120_000_000, "s1")], now);

        record_summary(summary.clone(), &path, now).unwrap();
        record_summary(summary, &path, now).unwrap();

        let book = load(&path).unwrap();
        let ids: Vec<&str> = book.events.iter().map(|event| event.id.as_str()).collect();
        assert!(ids.contains(&"first_seen_project:/repo/big:seen:2026-07-07"));
        assert!(ids.contains(&"tier_up:pavilion:full:2026-07-07"));
        assert!(ids.contains(&"trinket_unlocked:incense:unlocked:2026-07-07"));
        assert_eq!(
            ids.len(),
            ids.iter().copied().collect::<BTreeSet<_>>().len()
        );
        std::fs::remove_file(&path).ok();
    }
}
