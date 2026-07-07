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

/// Sidecar rings path for an events cache.
///
/// The default product cache (`~/.local-agent-garden/events.json`) maps to the
/// canonical `rings.json`. Custom caches get a sibling `<stem>.rings.json`, so
/// tests and ad-hoc CLI views do not mutate the user's main garden memory.
pub fn path_for_events_cache(cache_path: &Path) -> PathBuf {
    if cache_path == storage::default_state_dir().join("events.json") {
        return default_rings_path();
    }
    let parent = cache_path.parent().map(Path::to_path_buf);
    let stem = cache_path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("events");
    parent
        .map(|p| p.join(format!("{stem}.rings.json")))
        .unwrap_or_else(default_rings_path)
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

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct RingSnapshot {
    #[serde(default)]
    pub tiers: GardenTiers,
    #[serde(default)]
    pub projects: BTreeMap<String, ProjectSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
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

/// Load rings for an update pass, quarantining malformed files.
///
/// A malformed `rings.json` (e.g. truncated before atomic writes existed)
/// would otherwise leave the memory layer silently dead forever behind the
/// best-effort callers: every load fails, nothing is ever written again. So
/// malformed JSON is renamed to a dated `.corrupt-*` sibling and memory
/// restarts from an empty book. I/O errors and future schema versions still
/// propagate: the former may be transient, and the latter is real history
/// written by a newer binary that a downgraded reader must not destroy.
fn load_for_update(path: &Path, now: DateTime<Utc>) -> Result<RingBook, Error> {
    match load(path) {
        Err(Error::Json { .. }) => {
            let quarantine = quarantine_path(path, now);
            match std::fs::rename(path, &quarantine) {
                Ok(()) => {
                    eprintln!(
                        "garden memory at {} is malformed; quarantined to {} and restarting rings",
                        path.display(),
                        quarantine.display()
                    );
                    Ok(RingBook::default())
                }
                Err(err) => Err(Error::io(path, err)),
            }
        }
        other => other,
    }
}

fn quarantine_path(path: &Path, now: DateTime<Utc>) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("rings.json");
    let stamp = now.format("%Y%m%d%H%M%S");
    let mut candidate = path.with_file_name(format!("{file_name}.corrupt-{stamp}"));
    // Same-second repeat corruption: on Windows, rename onto an existing
    // target fails, which would demote quarantine back to permanent degrade.
    // Bump a numeric suffix until the name is free.
    let mut n = 0u32;
    while candidate.exists() {
        n += 1;
        candidate = path.with_file_name(format!("{file_name}.corrupt-{stamp}-{n}"));
    }
    candidate
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
    let mut book = load_for_update(path, now)?;
    let previous = book.snapshot.tiers.clone();
    let utc_date = crate::aggregate::utc_day_key(now);

    let mut events = derive_project_events(&summary, &book.snapshot.projects, &utc_date);
    events.extend(derive_tier_events(&previous, &observed, &utc_date));
    events.extend(derive_trinket_events(&previous, &observed, &utc_date));
    let mut changed = append_unique_events(&mut book.events, events);

    let merged = merge_display_tiers(&previous, &observed);
    if book.snapshot.tiers != merged {
        book.snapshot.tiers = merged;
        changed = true;
    }
    for project in &summary.projects {
        if !book.snapshot.projects.contains_key(&project.project_key) {
            book.snapshot.projects.insert(
                project.project_key.clone(),
                ProjectSnapshot {
                    display_name: project.display_name.clone(),
                    first_seen: project.first_seen,
                },
            );
            changed = true;
        }
    }

    if changed {
        save(&book, path)?;
    }
    summary.tiers = Some(book.snapshot.tiers.clone());
    Ok(summary)
}

/// Record garden memory if possible; otherwise serve the current summary.
///
/// Rings are an auxiliary memory layer. A corrupt or unwritable `rings.json`
/// must never prevent the product from showing the freshly computed summary.
pub fn record_summary_best_effort(
    summary: GardenSummary,
    path: &Path,
    now: DateTime<Utc>,
) -> GardenSummary {
    match record_summary(summary.clone(), path, now) {
        Ok(summary) => summary,
        Err(err) => {
            eprintln!(
                "garden memory update failed at {}: {}; serving current summary",
                path.display(),
                err
            );
            summary
        }
    }
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
    .filter(
        |(_, from, to, order)| match (rank(from, order), rank(to, order)) {
            (Some(from_rank), Some(to_rank)) => to_rank > from_rank,
            // Unknown on either side means version skew; never celebrate a
            // transition this binary cannot actually order.
            _ => false,
        },
    )
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

fn append_unique_events(existing: &mut Vec<RingEvent>, incoming: Vec<RingEvent>) -> bool {
    let mut seen: BTreeSet<String> = existing.iter().map(|event| event.id.clone()).collect();
    let mut changed = false;
    for event in incoming {
        if seen.insert(event.id.clone()) {
            existing.push(event);
            changed = true;
        }
    }
    changed
}

fn save(book: &RingBook, path: &Path) -> Result<(), Error> {
    let json = serde_json::to_string_pretty(book).map_err(|e| Error::json(path, e))?;
    storage::write_text_atomic(path, &json)
}

fn event_id(event_type: &str, entity: &str, to: &str, utc_date: &str) -> String {
    format!("{event_type}:{entity}:{to}:{utc_date}")
}

fn max_by_rank(previous: &str, observed: &str, order: &[&str]) -> String {
    // A previous value this binary does not know is preserved, never demoted:
    // it is almost certainly high-water written by a NEWER binary (version
    // skew), and mapping it to rank 0 would silently shrink the garden for as
    // long as the user stays on the older build.
    let Some(prev_rank) = rank(previous, order) else {
        return previous.to_string();
    };
    match rank(observed, order) {
        Some(obs_rank) if obs_rank > prev_rank => observed.to_string(),
        Some(_) => previous.to_string(),
        // Observed values come from this binary's own derive_tiers, so an
        // unknown one is unreachable in practice; trust the fresh observation.
        None => observed.to_string(),
    }
}

fn rank(value: &str, order: &[&str]) -> Option<usize> {
    order.iter().position(|v| *v == value)
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

    #[test]
    fn malformed_rings_is_quarantined_and_memory_restarts() {
        let path = tmp_path("quarantine");
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, "{not-valid-json").unwrap();
        let now = Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap();
        let quarantine = quarantine_path(&path, now);
        let _ = std::fs::remove_file(&quarantine);
        let summary = aggregate::summarize_at(&[event("/repo/big", 120_000_000, "s1")], now);

        let served = record_summary(summary, &path, now).unwrap();

        assert_eq!(
            served.tiers.as_ref().map(|t| t.pavilion.as_str()),
            Some("full"),
            "summary must be served with fresh tiers after quarantine"
        );
        assert!(
            quarantine.exists(),
            "malformed file should be preserved as a dated .corrupt sibling"
        );
        let book = load(&path).unwrap();
        assert!(
            !book.events.is_empty(),
            "memory must restart accumulating after quarantine"
        );
        std::fs::remove_file(&path).ok();
        std::fs::remove_file(&quarantine).ok();
    }

    #[test]
    fn quarantine_survives_same_second_collision() {
        let path = tmp_path("quarantine-collision");
        let _ = std::fs::remove_file(&path);
        let now = Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap();
        let file_name = path.file_name().unwrap().to_str().unwrap().to_string();
        let base = path.with_file_name(format!("{file_name}.corrupt-20260707120000"));
        let suffixed = path.with_file_name(format!("{file_name}.corrupt-20260707120000-1"));
        std::fs::write(&base, "occupied").unwrap();
        let _ = std::fs::remove_file(&suffixed);
        std::fs::write(&path, "{not-valid-json").unwrap();
        let summary = aggregate::summarize_at(&[event("/repo/big", 42_000, "s1")], now);

        record_summary(summary, &path, now).unwrap();

        assert_eq!(
            std::fs::read_to_string(&base).unwrap(),
            "occupied",
            "an existing quarantine file must never be clobbered"
        );
        assert!(
            suffixed.exists(),
            "same-second corruption must quarantine under a bumped suffix"
        );
        std::fs::remove_file(&path).ok();
        std::fs::remove_file(&base).ok();
        std::fs::remove_file(&suffixed).ok();
    }

    #[test]
    fn future_schema_rings_degrades_without_touching_the_file() {
        let path = tmp_path("future-schema");
        let _ = std::fs::remove_file(&path);
        let future = format!(
            "{{\"schema_version\":{},\"snapshot\":{{}},\"events\":[]}}",
            RINGS_SCHEMA_VERSION + 1
        );
        std::fs::write(&path, &future).unwrap();
        let now = Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap();
        let summary = aggregate::summarize_at(&[event("/repo/big", 42_000, "s1")], now);

        let result = record_summary(summary.clone(), &path, now);

        assert!(result.is_err(), "future schema must not be overwritten");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            future,
            "a newer binary's history must survive a downgraded reader untouched"
        );
        let served = record_summary_best_effort(summary, &path, now);
        assert_eq!(served.total_tokens, 42_000);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn unknown_snapshot_tier_survives_a_downgraded_reader() {
        let path = tmp_path("version-skew");
        let _ = std::fs::remove_file(&path);
        // Simulate a snapshot written by a NEWER binary that knows a pavilion
        // tier above "full". This reader must neither demote it nor celebrate
        // a bogus tier_up over it.
        let mut book = RingBook::default();
        book.snapshot.tiers.pavilion = "giant".to_string();
        std::fs::write(&path, serde_json::to_string(&book).unwrap()).unwrap();
        let now = Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap();
        let summary = aggregate::summarize_at(&[event("/repo/big", 120_000_000, "s1")], now);

        let served = record_summary(summary, &path, now).unwrap();

        assert_eq!(
            served.tiers.as_ref().map(|t| t.pavilion.as_str()),
            Some("giant"),
            "unknown high-water must win the merge"
        );
        let reloaded = load(&path).unwrap();
        assert_eq!(reloaded.snapshot.tiers.pavilion, "giant");
        assert!(
            !reloaded
                .events
                .iter()
                .any(|event| event.event_type == "tier_up" && event.entity == "pavilion"),
            "no tier_up event may fire across an unorderable transition"
        );
        std::fs::remove_file(&path).ok();
    }
}
