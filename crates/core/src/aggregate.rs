//! Project-level aggregation.
//!
//! All formulas (activity_score, stage cutoffs, recent_activity window,
//! cache_ratio, daily_activity bumping) are part of the frontend contract.
//!
//! Two distinct per-day maps exist, do not conflate them:
//! - `daily_activity`: an activity-intensity proxy (`max(1, tokens/1000 +
//!   tool_calls)`), used for the recent_activity window / liveliness.
//! - `daily_tokens`: honest per-day token totals, used for token
//!   heatmaps/sparklines. A dark `daily_activity` cell can mean "many tool
//!   calls", not "many tokens" — only `daily_tokens` answers the token question.

use crate::event::AgentEvent;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;

/// Whole-garden roll-up: one entry per project, plus top-level totals.
///
/// The JSON shape is the contract the frontend reads. Adding a field is
/// backward-compatible; renaming or removing one isn't — touch with care.
///
/// Spec §Schema Versioning: every persisted summary carries a `schema_version`
/// so consumers can detect incompatible caches. Bump on any backward-incompat
/// shape change (renamed/removed field, semantic redefinition).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GardenSummary {
    /// JSON schema version. Readers MUST refuse caches whose version exceeds
    /// what they know how to parse.
    #[serde(default = "current_schema_version")]
    pub schema_version: u32,
    pub projects: Vec<ProjectGrowth>,
    pub sources: BTreeMap<String, u64>,
    pub total_events: u64,
    pub total_tokens: u64,
    // Always emit (null when absent) to keep the JSON shape stable.
    #[serde(default, with = "opt_ts_serde")]
    pub first_seen: Option<DateTime<Utc>>,
    #[serde(default, with = "opt_ts_serde")]
    pub last_seen: Option<DateTime<Utc>>,
    pub active_projects: u64,
    /// Honest per-day token totals across all projects (UTC date "YYYY-MM-DD"
    /// → tokens). Distinct from per-project `daily_activity` (an intensity
    /// proxy); use this for token heatmaps/sparklines. Additive field —
    /// defaults to empty so older summaries still deserialize.
    #[serde(default)]
    pub daily_tokens: BTreeMap<String, u64>,
}

/// Schema version for the `GardenSummary` JSON shape. Independent from the
/// events cache (`storage::EVENTS_SCHEMA_VERSION`) so the summary shape can
/// evolve without invalidating cached raw events. Bump on any
/// backward-incompatible summary change (renamed/removed field, semantic
/// redefinition). Bumped to 2 for `daily_tokens`, to 3 for `size_level` /
/// `size_strength`.
pub const SUMMARY_SCHEMA_VERSION: u32 = 3;

fn current_schema_version() -> u32 {
    SUMMARY_SCHEMA_VERSION
}

impl Default for GardenSummary {
    fn default() -> Self {
        Self {
            schema_version: SUMMARY_SCHEMA_VERSION,
            projects: Vec::new(),
            sources: BTreeMap::new(),
            total_events: 0,
            total_tokens: 0,
            first_seen: None,
            last_seen: None,
            active_projects: 0,
            daily_tokens: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectGrowth {
    pub project_key: String,
    pub display_name: String,
    // Always emit (null when absent) to keep the JSON shape stable.
    #[serde(default)]
    pub project_path: Option<String>,
    pub sources: BTreeMap<String, u64>,
    /// Public summaries expose a count; the builder keeps the actual HashSet
    /// during aggregation, then converts to a count for the public type.
    pub sessions: u64,
    #[serde(default, with = "opt_ts_serde")]
    pub first_seen: Option<DateTime<Utc>>,
    #[serde(default, with = "opt_ts_serde")]
    pub last_seen: Option<DateTime<Utc>>,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub tool_calls: u32,
    pub event_count: u64,
    pub daily_activity: BTreeMap<String, u64>,
    /// Honest per-day token totals for this project (UTC date → tokens).
    /// Unlike `daily_activity` (intensity proxy), this is real tokens summed
    /// from `AgentEvent.usage.total_tokens`. Additive — defaults to empty.
    #[serde(default)]
    pub daily_tokens: BTreeMap<String, u64>,
    pub models: BTreeMap<String, u64>,
    pub activity_score: u64,
    pub stage: u8,
    pub recent_activity: u64,
    pub cache_ratio: f64,
    /// Token→sprite size bucket (1..=5), distribution-relative on a log scale.
    /// A data abstraction the garden reads to size each project's vine; the
    /// frontend maps it (plus `size_strength`) to pixel width/opacity. Was
    /// computed in render-garden.js; moved here so it is testable and the
    /// rule lives in one place. Additive — defaults to 0 for older summaries,
    /// which signals the frontend to fall back to its own computation.
    #[serde(default)]
    pub size_level: u8,
    /// Normalized magnitude strength (0.0..=1.0) blending the project's log
    /// token mass with its rank in the distribution. Frontend turns this into
    /// vine width/opacity. Additive — defaults to 0.0 (frontend falls back).
    #[serde(default)]
    pub size_strength: f64,
}

/// Internal accumulator — holds the HashSet of session IDs during the build
/// phase. NOT public: callers see only the finalized `ProjectGrowth`.
#[derive(Debug, Clone, Default)]
struct Accumulator {
    project_key: String,
    display_name: String,
    project_path: Option<String>,
    sources: BTreeMap<String, u64>,
    sessions: HashSet<String>,
    first_seen: Option<DateTime<Utc>>,
    last_seen: Option<DateTime<Utc>>,
    total_tokens: u64,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    tool_calls: u32,
    event_count: u64,
    daily_activity: BTreeMap<String, u64>,
    daily_tokens: BTreeMap<String, u64>,
    models: BTreeMap<String, u64>,
}

impl Accumulator {
    fn finalize(self) -> ProjectGrowth {
        let activity_score = activity_score(
            self.total_tokens,
            self.event_count,
            self.sessions.len() as u64,
            u64::from(self.tool_calls),
        );
        let stage = stage_for_score(activity_score);
        let recent_activity = recent_activity_window(&self.daily_activity, Utc::now());
        let cache_ratio = cache_ratio(
            self.input_tokens,
            self.cache_read_tokens,
            self.cache_write_tokens,
        );
        ProjectGrowth {
            project_key: self.project_key,
            display_name: self.display_name,
            project_path: self.project_path,
            sources: self.sources,
            sessions: self.sessions.len() as u64,
            first_seen: self.first_seen,
            last_seen: self.last_seen,
            total_tokens: self.total_tokens,
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            cache_read_tokens: self.cache_read_tokens,
            cache_write_tokens: self.cache_write_tokens,
            tool_calls: self.tool_calls,
            event_count: self.event_count,
            daily_activity: self.daily_activity,
            daily_tokens: self.daily_tokens,
            models: self.models,
            activity_score,
            stage,
            recent_activity,
            cache_ratio,
            // Distribution-relative — filled by summarize_at once every
            // project's token total is known. Left at defaults here.
            size_level: 0,
            size_strength: 0.0,
        }
    }
}

/// Build a `GardenSummary` from raw events. Events are processed in
/// chronological order so first_seen / last_seen come out deterministic
/// even when input order varies.
pub fn summarize(events: &[AgentEvent]) -> GardenSummary {
    summarize_at(events, Utc::now())
}

/// Same as `summarize` but lets callers pin "now" — used by tests to make
/// recent_activity deterministic against fixture data.
pub fn summarize_at(events: &[AgentEvent], now: DateTime<Utc>) -> GardenSummary {
    let mut by_project: BTreeMap<String, Accumulator> = BTreeMap::new();
    let mut sources: BTreeMap<String, u64> = BTreeMap::new();
    let mut first_seen: Option<DateTime<Utc>> = None;
    let mut last_seen: Option<DateTime<Utc>> = None;
    let mut total_tokens: u64 = 0;
    let mut daily_tokens: BTreeMap<String, u64> = BTreeMap::new();

    let mut sorted: Vec<&AgentEvent> = events.iter().collect();
    sorted.sort_by_key(|e| e.timestamp);

    for event in sorted {
        let key = event.project_key();
        let accum = by_project
            .entry(key.clone())
            .or_insert_with(|| Accumulator {
                project_key: key.clone(),
                display_name: display_name(event.project_path.as_deref(), &key),
                project_path: event.project_path.clone(),
                ..Default::default()
            });

        *accum.sources.entry(event.source.clone()).or_insert(0) += 1;
        *sources.entry(event.source.clone()).or_insert(0) += 1;
        if let Some(sid) = event.session_id.as_ref() {
            accum.sessions.insert(sid.clone());
        }
        accum.first_seen = min_dt(accum.first_seen, event.timestamp);
        accum.last_seen = max_dt(accum.last_seen, event.timestamp);
        first_seen = min_dt(first_seen, event.timestamp);
        last_seen = max_dt(last_seen, event.timestamp);
        accum.total_tokens += event.usage.total_tokens;
        accum.input_tokens += event.usage.input_tokens;
        accum.output_tokens += event.usage.output_tokens;
        accum.cache_read_tokens += event.usage.cache_read_tokens;
        accum.cache_write_tokens += event.usage.cache_write_tokens;
        accum.tool_calls += event.tool_calls;
        accum.event_count += 1;
        total_tokens += event.usage.total_tokens;

        // daily_activity bump: max(1, total_tokens // 1000 + tool_calls)
        // Guarantees each event contributes at least 1 so sparse low-token
        // chats still register on the recent_activity window. This is an
        // intensity PROXY — not tokens. For honest token series see below.
        let bump = (event.usage.total_tokens / 1000) + u64::from(event.tool_calls);
        let bump = bump.max(1);
        let day_key = event.timestamp.format("%Y-%m-%d").to_string();
        *accum.daily_activity.entry(day_key.clone()).or_insert(0) += bump;

        // daily_tokens: honest per-day tokens, per-project and rolled up across
        // all projects. Drives token heatmaps/sparklines without the tool_call
        // contamination baked into daily_activity.
        *accum.daily_tokens.entry(day_key.clone()).or_insert(0) += event.usage.total_tokens;
        *daily_tokens.entry(day_key).or_insert(0) += event.usage.total_tokens;

        if let Some(model) = event.model.as_ref() {
            if !model.is_empty() {
                *accum.models.entry(model.clone()).or_insert(0) += 1;
            }
        }
    }

    let mut projects: Vec<ProjectGrowth> = by_project
        .into_values()
        .map(|a| {
            let mut p = a.finalize();
            // recompute recent_activity against the caller-supplied "now" — the
            // default Accumulator::finalize() uses Utc::now() which differs in
            // tests.
            p.recent_activity = recent_activity_window(&p.daily_activity, now);
            p
        })
        .collect();

    // Sort by activity first, latest activity second.
    let epoch = DateTime::<Utc>::from_timestamp(0, 0).expect("unix epoch is always representable");
    projects.sort_by(|a, b| {
        let a_key = (a.activity_score, a.last_seen.unwrap_or(epoch));
        let b_key = (b.activity_score, b.last_seen.unwrap_or(epoch));
        b_key.cmp(&a_key)
    });

    // Distribution-aware sprite sizing (formerly render-garden.js). `level`
    // and `strength` depend on the whole project set, so they are computed
    // here once all token totals are known. The frontend maps them to pixel
    // width/opacity — those presentation details stay out of core.
    let max_tokens = projects
        .iter()
        .map(|p| p.total_tokens)
        .max()
        .unwrap_or(0)
        .max(1);
    let mut sorted_tokens: Vec<u64> = projects
        .iter()
        .map(|p| p.total_tokens)
        .filter(|&t| t > 0)
        .collect();
    sorted_tokens.sort_unstable_by(|a, b| b.cmp(a));
    for p in &mut projects {
        p.size_level = size_level(p.total_tokens, max_tokens);
        p.size_strength = size_strength(p.total_tokens, max_tokens, &sorted_tokens);
    }

    let active_projects = projects.len() as u64;
    GardenSummary {
        schema_version: SUMMARY_SCHEMA_VERSION,
        projects,
        sources,
        total_events: events.len() as u64,
        total_tokens,
        first_seen,
        last_seen,
        active_projects,
        daily_tokens,
    }
}

/// Top `n` projects by total tokens, descending, with a deterministic
/// `project_key` tie-break. A reusable ranking primitive — it serves the
/// insight panel, README/demo data, and a future tray menu, so it is kept
/// general rather than tray-shaped. Sorting lives here; display formatting
/// (K/M) stays in the frontend.
pub fn top_by_tokens(summary: &GardenSummary, n: usize) -> Vec<&ProjectGrowth> {
    let mut ranked: Vec<&ProjectGrowth> = summary.projects.iter().collect();
    ranked.sort_by(|a, b| {
        b.total_tokens
            .cmp(&a.total_tokens)
            .then_with(|| a.project_key.cmp(&b.project_key))
    });
    ranked.truncate(n);
    ranked
}

// ---- formulas -------------------------------------------------------------

fn activity_score(total_tokens: u64, event_count: u64, sessions: u64, tool_calls: u64) -> u64 {
    let token_score: u64 = if total_tokens > 0 {
        // f64 → u64 truncates toward 0 for positive values.
        let v = (((total_tokens + 1) as f64).log10() * 18.0) as i64;
        v.max(0) as u64
    } else {
        0
    };
    let event_score = (event_count.saturating_mul(2)).min(260);
    let session_score = sessions.saturating_mul(10);
    let tool_score = (tool_calls.saturating_mul(3)).min(120);
    (token_score + event_score + session_score + tool_score).max(1)
}

fn stage_for_score(score: u64) -> u8 {
    if score < 35 {
        1
    } else if score < 75 {
        2
    } else if score < 125 {
        3
    } else if score < 210 {
        4
    } else if score < 360 {
        5
    } else {
        6
    }
}

/// Token→sprite size bucket (1..=5), distribution-relative on a log scale.
/// Bit-exact port of the former render-garden.js `tokenSizeLevel`, so vine
/// sizing is identical whether computed here or in the JS fallback. Both use
/// IEEE-754 f64 with the same operation order. `max_tokens` is the largest
/// project's token total, floored at 1 by the caller.
fn size_level(tokens: u64, max_tokens: u64) -> u8 {
    if tokens == 0 {
        return 1;
    }
    let min_log = 3.0_f64;
    let max_log = (min_log + 1.0).max(((max_tokens + 1) as f64).log10());
    let ratio = (((tokens + 1) as f64).log10() - min_log) / (max_log - min_log);
    (ratio * 5.0).ceil().clamp(1.0, 5.0) as u8
}

/// Normalized magnitude strength (0.0..=1.0): blends the project's log token
/// mass (68%) with its rank in the non-zero token distribution (32%). Bit-exact
/// port of the former render-garden.js strength formula. `sorted_tokens` is the
/// non-zero token totals sorted descending; a zero-token project is absent from
/// it, so its rank resolves to 0 (rank_strength 1.0) — a quirk preserved
/// deliberately to keep rendering identical.
fn size_strength(tokens: u64, max_tokens: u64, sorted_tokens: &[u64]) -> f64 {
    let count = sorted_tokens.len().max(1);
    let rank = sorted_tokens.iter().position(|&v| v == tokens).unwrap_or(0);
    let rank_strength = 1.0 - (rank as f64) / (count.saturating_sub(1).max(1) as f64);
    let log_strength = if tokens > 0 && max_tokens > 0 {
        ((((tokens + 1) as f64).log10() - 4.0) / (((max_tokens + 1) as f64).log10() - 4.0))
            .clamp(0.0, 1.0)
    } else {
        0.0
    };
    (log_strength * 0.68 + rank_strength * 0.32).clamp(0.0, 1.0)
}

fn cache_ratio(input_tokens: u64, cache_read_tokens: u64, cache_write_tokens: u64) -> f64 {
    let denom = input_tokens + cache_read_tokens + cache_write_tokens;
    if denom == 0 {
        0.0
    } else {
        cache_read_tokens as f64 / denom as f64
    }
}

/// Sum daily_activity values for the 7 days ending at `now` (UTC date).
fn recent_activity_window(daily_activity: &BTreeMap<String, u64>, now: DateTime<Utc>) -> u64 {
    let today = now.date_naive();
    let mut total: u64 = 0;
    for i in 0..7 {
        let day = today - chrono::Duration::days(i);
        let key = day.format("%Y-%m-%d").to_string();
        if let Some(v) = daily_activity.get(&key) {
            total += *v;
        }
    }
    total
}

// ---- helpers --------------------------------------------------------------

fn display_name(project_path: Option<&str>, fallback: &str) -> String {
    if let Some(p) = project_path.filter(|p| !p.is_empty()) {
        let name = Path::new(p)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if !name.is_empty() {
            return name.to_string();
        }
        return p.to_string();
    }
    fallback
        .strip_prefix("unknown:")
        .unwrap_or(fallback)
        .to_string()
}

fn min_dt(left: Option<DateTime<Utc>>, right: DateTime<Utc>) -> Option<DateTime<Utc>> {
    Some(match left {
        Some(l) if l < right => l,
        _ => right,
    })
}

fn max_dt(left: Option<DateTime<Utc>>, right: DateTime<Utc>) -> Option<DateTime<Utc>> {
    Some(match left {
        Some(l) if l > right => l,
        _ => right,
    })
}

/// Serialization helper that round-trips `Option<DateTime<Utc>>` through
/// the same ISO 8601 format `event.rs` uses for required timestamps.
mod opt_ts_serde {
    use chrono::{DateTime, Utc};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(dt: &Option<DateTime<Utc>>, s: S) -> Result<S::Ok, S::Error> {
        match dt {
            None => s.serialize_none(),
            Some(dt) => {
                let micros = dt.timestamp_subsec_micros();
                let formatted = if micros == 0 {
                    dt.format("%Y-%m-%dT%H:%M:%S+00:00").to_string()
                } else {
                    format!("{}.{:06}+00:00", dt.format("%Y-%m-%dT%H:%M:%S"), micros)
                };
                s.serialize_str(&formatted)
            }
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<DateTime<Utc>>, D::Error> {
        let s: Option<String> = Option::deserialize(d)?;
        let Some(s) = s else { return Ok(None) };
        let normalized = match s.strip_suffix('Z') {
            Some(stripped) => format!("{stripped}+00:00"),
            None => s,
        };
        DateTime::parse_from_rfc3339(&normalized)
            .map(|d| Some(d.with_timezone(&Utc)))
            .map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[derive(Clone)]
    struct EventFixture<'a> {
        source: &'a str,
        ts: DateTime<Utc>,
        project: Option<&'a str>,
        session: Option<&'a str>,
        input: u64,
        output: u64,
        cache_read: u64,
        tool_calls: u32,
        model: Option<&'a str>,
    }

    fn make_event(fixture: EventFixture<'_>) -> AgentEvent {
        let mut ev = AgentEvent::new(fixture.source, fixture.ts);
        ev.project_path = fixture.project.map(str::to_string);
        ev.session_id = fixture.session.map(str::to_string);
        ev.usage.input_tokens = fixture.input;
        ev.usage.output_tokens = fixture.output;
        ev.usage.cache_read_tokens = fixture.cache_read;
        ev.tool_calls = fixture.tool_calls;
        ev.model = fixture.model.map(str::to_string);
        ev.normalize_totals();
        ev
    }

    #[test]
    fn empty_input_yields_empty_summary() {
        let s = summarize(&[]);
        assert_eq!(s.projects.len(), 0);
        assert_eq!(s.total_events, 0);
        assert_eq!(s.total_tokens, 0);
        assert!(s.first_seen.is_none());
        assert!(s.last_seen.is_none());
    }

    #[test]
    fn aggregates_per_project() {
        let ts = Utc.with_ymd_and_hms(2026, 5, 27, 4, 5, 25).unwrap();
        let events = vec![
            make_event(EventFixture {
                source: "claude-code",
                ts,
                project: Some("/a/pay-module"),
                session: Some("s1"),
                input: 100,
                output: 50,
                cache_read: 0,
                tool_calls: 1,
                model: Some("m1"),
            }),
            make_event(EventFixture {
                source: "claude-code",
                ts: ts + chrono::Duration::seconds(1),
                project: Some("/a/pay-module"),
                session: Some("s1"),
                input: 200,
                output: 100,
                cache_read: 0,
                tool_calls: 2,
                model: Some("m1"),
            }),
            make_event(EventFixture {
                source: "codex",
                ts: ts + chrono::Duration::seconds(2),
                project: Some("/a/other"),
                session: Some("s2"),
                input: 50,
                output: 25,
                cache_read: 0,
                tool_calls: 0,
                model: Some("m2"),
            }),
        ];
        let s = summarize(&events);
        assert_eq!(s.projects.len(), 2);
        assert_eq!(s.total_events, 3);
        assert_eq!(s.total_tokens, 525); // 150 + 300 + 75
        assert_eq!(s.sources["claude-code"], 2);
        assert_eq!(s.sources["codex"], 1);
        // pay-module has more activity → first
        assert_eq!(s.projects[0].project_path.as_deref(), Some("/a/pay-module"));
        assert_eq!(s.projects[0].event_count, 2);
        assert_eq!(s.projects[0].input_tokens, 300);
        assert_eq!(s.projects[0].total_tokens, 450);
        assert_eq!(s.projects[0].tool_calls, 3);
        assert_eq!(s.projects[0].sessions, 1);
        assert_eq!(s.projects[0].sources["claude-code"], 2);
        assert_eq!(s.projects[0].models["m1"], 2);
        assert_eq!(s.projects[0].display_name, "pay-module");
    }

    #[test]
    fn activity_score_matches_reference_examples() {
        // pay-module: total_tokens=226_880_048, event_count=1724, sessions=8, tool_calls=481
        // Expected from real garden-summary.json: activity_score=610
        let score = activity_score(226_880_048, 1724, 8, 481);
        assert_eq!(score, 610);
    }

    #[test]
    fn stage_buckets_match_reference() {
        assert_eq!(stage_for_score(0), 1);
        assert_eq!(stage_for_score(34), 1);
        assert_eq!(stage_for_score(35), 2);
        assert_eq!(stage_for_score(74), 2);
        assert_eq!(stage_for_score(75), 3);
        assert_eq!(stage_for_score(124), 3);
        assert_eq!(stage_for_score(125), 4);
        assert_eq!(stage_for_score(209), 4);
        assert_eq!(stage_for_score(210), 5);
        assert_eq!(stage_for_score(359), 5);
        assert_eq!(stage_for_score(360), 6);
        assert_eq!(stage_for_score(9999), 6);
    }

    #[test]
    fn cache_ratio_handles_zero_denominator() {
        assert_eq!(cache_ratio(0, 0, 0), 0.0);
        assert_eq!(cache_ratio(100, 0, 0), 0.0); // no cache reads
        let r = cache_ratio(100, 50, 0);
        assert!((r - (50.0 / 150.0)).abs() < 1e-12);
    }

    #[test]
    fn recent_activity_window_covers_seven_days() {
        let now = Utc.with_ymd_and_hms(2026, 5, 27, 12, 0, 0).unwrap();
        let mut daily = BTreeMap::new();
        daily.insert("2026-05-27".to_string(), 10);
        daily.insert("2026-05-26".to_string(), 20);
        daily.insert("2026-05-21".to_string(), 5); // exactly 6 days ago (today - 6)
        daily.insert("2026-05-20".to_string(), 100); // 7 days ago — OUT of window
        daily.insert("2026-04-01".to_string(), 999); // old — OUT
        let r = recent_activity_window(&daily, now);
        assert_eq!(r, 10 + 20 + 5);
    }

    #[test]
    fn display_name_falls_back_to_unknown_strip() {
        assert_eq!(
            display_name(Some("/foo/pay-module"), "ignored"),
            "pay-module"
        );
        assert_eq!(display_name(None, "unknown:codex"), "codex");
        assert_eq!(display_name(Some(""), "unknown:claude-code"), "claude-code");
        assert_eq!(display_name(Some("/"), "fb"), "/"); // path with no basename
    }

    #[test]
    fn json_round_trip_preserves_shape() {
        // Smoke: serialize → parse → compare. Catches accidental shape drift.
        let ts = Utc.with_ymd_and_hms(2026, 5, 27, 4, 5, 25).unwrap();
        let events = vec![make_event(EventFixture {
            source: "claude-code",
            ts,
            project: Some("/a/x"),
            session: Some("s1"),
            input: 100,
            output: 50,
            cache_read: 10,
            tool_calls: 1,
            model: Some("m1"),
        })];
        let s = summarize(&events);
        let json = serde_json::to_string(&s).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["projects"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["total_events"], 1);
        assert_eq!(parsed["active_projects"], 1);
        // Timestamp shape: must end with "+00:00" not "Z"
        let first_seen = parsed["first_seen"].as_str().unwrap();
        assert!(first_seen.ends_with("+00:00"), "got: {}", first_seen);
    }

    #[test]
    fn daily_tokens_record_real_tokens_not_activity() {
        let day1 = Utc.with_ymd_and_hms(2026, 5, 26, 10, 0, 0).unwrap();
        let day2 = Utc.with_ymd_and_hms(2026, 5, 27, 10, 0, 0).unwrap();
        let events = vec![
            make_event(EventFixture {
                source: "claude-code",
                ts: day1,
                project: Some("/a/pay"),
                session: Some("s1"),
                input: 1000,
                output: 500,
                cache_read: 0,
                tool_calls: 9,
                model: Some("m1"),
            }),
            make_event(EventFixture {
                source: "claude-code",
                ts: day2,
                project: Some("/a/pay"),
                session: Some("s1"),
                input: 200,
                output: 100,
                cache_read: 0,
                tool_calls: 0,
                model: Some("m1"),
            }),
        ];
        let s = summarize(&events);
        let p = &s.projects[0];
        // Honest tokens: day1 = 1500, day2 = 300.
        assert_eq!(p.daily_tokens["2026-05-26"], 1500);
        assert_eq!(p.daily_tokens["2026-05-27"], 300);
        // Top-level rollup mirrors the single project.
        assert_eq!(s.daily_tokens["2026-05-26"], 1500);
        assert_eq!(s.daily_tokens["2026-05-27"], 300);
        // daily_activity is the intensity proxy: day1 = 1500/1000 + 9 = 10,
        // day2 = max(1, 300/1000 + 0) = 1 — provably NOT the token value.
        assert_eq!(p.daily_activity["2026-05-26"], 10);
        assert_eq!(p.daily_activity["2026-05-27"], 1);
        assert_ne!(p.daily_tokens["2026-05-26"], p.daily_activity["2026-05-26"]);
    }

    #[test]
    fn daily_tokens_rollup_sums_across_projects() {
        let day = Utc.with_ymd_and_hms(2026, 5, 27, 10, 0, 0).unwrap();
        let events = vec![
            make_event(EventFixture {
                source: "claude-code",
                ts: day,
                project: Some("/a/one"),
                session: Some("s1"),
                input: 1000,
                output: 0,
                cache_read: 0,
                tool_calls: 0,
                model: None,
            }),
            make_event(EventFixture {
                source: "codex",
                ts: day,
                project: Some("/a/two"),
                session: Some("s2"),
                input: 500,
                output: 0,
                cache_read: 0,
                tool_calls: 0,
                model: None,
            }),
        ];
        let s = summarize(&events);
        assert_eq!(s.daily_tokens["2026-05-27"], 1500);
        // Each project keeps its own honest share.
        let one = s.projects.iter().find(|p| p.display_name == "one").unwrap();
        let two = s.projects.iter().find(|p| p.display_name == "two").unwrap();
        assert_eq!(one.daily_tokens["2026-05-27"], 1000);
        assert_eq!(two.daily_tokens["2026-05-27"], 500);
    }

    #[test]
    fn top_by_tokens_ranks_and_truncates() {
        let ts = Utc.with_ymd_and_hms(2026, 5, 27, 10, 0, 0).unwrap();
        let mk = |proj: &'static str, input: u64| EventFixture {
            source: "claude-code",
            ts,
            project: Some(proj),
            session: Some(proj),
            input,
            output: 0,
            cache_read: 0,
            tool_calls: 0,
            model: None,
        };
        let events = vec![
            make_event(mk("/a/big", 5000)),
            make_event(mk("/a/mid", 2000)),
            make_event(mk("/a/small", 100)),
        ];
        let s = summarize(&events);
        let top2 = top_by_tokens(&s, 2);
        assert_eq!(top2.len(), 2);
        assert_eq!(top2[0].display_name, "big");
        assert_eq!(top2[1].display_name, "mid");
        // n larger than the project count is clamped, not an error.
        assert_eq!(top_by_tokens(&s, 10).len(), 3);
        // n = 0 yields an empty ranking.
        assert!(top_by_tokens(&s, 0).is_empty());
    }

    #[test]
    fn size_level_and_strength_match_js_reference() {
        // Reference values produced by running the former render-garden.js
        // formulas (tokenSizeLevel / strength) against this exact token set, so
        // the Rust port stays bit-for-bit visually identical.
        let ts = Utc.with_ymd_and_hms(2026, 5, 27, 10, 0, 0).unwrap();
        let mk = |proj: &'static str, input: u64| EventFixture {
            source: "claude-code",
            ts,
            project: Some(proj),
            session: Some(proj),
            input,
            output: 0,
            cache_read: 0,
            tool_calls: 0,
            model: None,
        };
        let events = vec![
            make_event(mk("/x/big", 226_880_048)),
            make_event(mk("/x/mid", 5000)),
            make_event(mk("/x/small", 100)),
            make_event(mk("/x/zero", 0)),
        ];
        let s = summarize(&events);
        let find = |name: &str| s.projects.iter().find(|p| p.display_name == name).unwrap();

        let big = find("big");
        assert_eq!(big.size_level, 5);
        assert!((big.size_strength - 1.0).abs() < 1e-12);

        let mid = find("mid");
        assert_eq!(mid.size_level, 1);
        assert!((mid.size_strength - 0.16).abs() < 1e-12);

        let small = find("small");
        assert_eq!(small.size_level, 1);
        assert!(small.size_strength.abs() < 1e-12);

        // Zero-token project: absent from the non-zero distribution, so its
        // rank resolves to 0 → rank_strength 1.0 → 0.32. Quirk preserved.
        let zero = find("zero");
        assert_eq!(zero.size_level, 1);
        assert!((zero.size_strength - 0.32).abs() < 1e-12);
    }

    #[test]
    fn size_helpers_handle_degenerate_distribution() {
        // Single project, max floored at 1: must not divide by zero or NaN.
        assert_eq!(size_level(0, 1), 1);
        let only = [42u64];
        let strength = size_strength(42, 42, &only);
        assert!(strength.is_finite());
        assert!((0.0..=1.0).contains(&strength));
    }
}
