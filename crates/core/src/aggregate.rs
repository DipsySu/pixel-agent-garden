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
use chrono::{DateTime, Datelike, Timelike, Utc};
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
    /// Rolling-365-day calendar heatmap, oldest-first. Each entry has the
    /// ISO date, the day's token total, and a 5-band quantized `level` (0..=4)
    /// computed against this user's own 365-day max so the visualization
    /// stays self-relative regardless of scale. Empty days are filled with
    /// `value=0, level=0` so the front-end never has to fill gaps. Additive.
    #[serde(default)]
    pub heatmap_year: Vec<HeatmapEntry>,
    /// 7×24 hour-of-week event counts over a rolling window (90 days by
    /// default — enough to surface a stable weekly pattern, recent enough
    /// to track lifestyle changes). Row 0 = Monday, row 6 = Sunday;
    /// columns 0..23 are local-clock hours of the day. Counts events, not
    /// tokens — the punchcard answers "when am I active?", not
    /// "when do I burn tokens?". Additive.
    #[serde(default)]
    pub hour_of_week: Vec<Vec<u32>>,
    /// Rolling-366-day activity series driving the flowerbed view. Uses
    /// per-project `daily_activity` (intensity proxy: max(1, tokens/1k +
    /// tool_calls)), NOT raw tokens — semantically distinct from
    /// `heatmap_year` which is honest per-day tokens. The flowerbed favors
    /// "intensity bursts read as bloom" so the activity proxy is the right
    /// signal even on tool-call-heavy / low-token days. Level uses the same
    /// log-compressed size_level shape as project vines, so a lush flower
    /// matches the user's mental model of a vigorous vine. Additive.
    #[serde(default)]
    pub flowerbed_year: Vec<FlowerbedDay>,
}

/// One day in the rolling-year heatmap. `level` is the 5-band quantization
/// (0..=4) the front-end maps directly to a 5-step color scale; raw `value`
/// is kept so the tooltip can show the actual token total.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HeatmapEntry {
    pub date: String,
    pub value: u64,
    pub level: u8,
}

/// One day in the flowerbed contribution view. Separate from `HeatmapEntry`
/// because the flowerbed encodes `daily_activity` (intensity) rather than
/// `daily_tokens` (honest tokens) — the field name `activity` makes that
/// distinction explicit in the JSON.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FlowerbedDay {
    pub date: String,
    pub activity: u64,
    pub level: u8,
}

/// How many days of history the hour-of-week grid considers. 90 days is the
/// sweet spot — enough for a stable Mon/Tue/Wed pattern to emerge, short
/// enough that "you used to code on Sundays" doesn't drown out "you don't
/// anymore".
const HOUR_OF_WEEK_WINDOW_DAYS: i64 = 90;

/// Schema version for the `GardenSummary` JSON shape. Independent from the
/// events cache (`storage::EVENTS_SCHEMA_VERSION`) so the summary shape can
/// evolve without invalidating cached raw events. Bump on any
/// backward-incompatible summary change (renamed/removed field, semantic
/// redefinition). Bumped to 2 for `daily_tokens`, to 3 for `size_level` /
/// `size_strength`, to 4 for `path_inferred`, to 5 for `heatmap_year` +
/// `hour_of_week`, to 6 for `flowerbed_year`.
pub const SUMMARY_SCHEMA_VERSION: u32 = 6;

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
            heatmap_year: Vec::new(),
            hour_of_week: empty_hour_of_week(),
            flowerbed_year: Vec::new(),
        }
    }
}

/// 7×24 zero grid. Kept as `Vec<Vec<u32>>` rather than a fixed `[[u32; 24]; 7]`
/// because serde + JSON cares about the dynamic representation; the shape is
/// always 7×24 (asserted in tests).
fn empty_hour_of_week() -> Vec<Vec<u32>> {
    (0..7).map(|_| vec![0u32; 24]).collect()
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
    /// True when EVERY contributing event's `project_path` was reverse-decoded
    /// from a Claude directory name (lossy/ambiguous; see
    /// `event::PATH_SOURCE_INFERRED`), i.e. no event carried a trustworthy
    /// `cwd`/selected-folder path. The `project_key` may therefore be a wrong
    /// or garbled guess: the frontend uses this to hide the "open in terminal"
    /// action and flag the row as approximate. Additive — defaults to false so
    /// older summaries deserialize as "trustworthy", matching prior behavior.
    #[serde(default)]
    pub path_inferred: bool,
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
    /// Count of contributing events whose path was reverse-decoded (inferred).
    /// A project is flagged `path_inferred` only when this equals
    /// `event_count` — i.e. NOT a single event had a trustworthy path.
    inferred_events: u64,
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
            // Inferred only if no contributing event had a trustworthy path.
            path_inferred: self.event_count > 0 && self.inferred_events == self.event_count,
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
        if event.path_is_inferred() {
            accum.inferred_events += 1;
        }
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
    let heatmap_year = build_heatmap_year(&daily_tokens, now);
    let hour_of_week = build_hour_of_week(events, now, HOUR_OF_WEEK_WINDOW_DAYS);
    let daily_activity_rollup = rollup_daily_activity(&projects);
    let flowerbed_year = build_flowerbed_year(&daily_activity_rollup, now);
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
        heatmap_year,
        hour_of_week,
        flowerbed_year,
    }
}

/// Sum each project's per-day activity into one whole-garden series.
/// Distinct from `daily_tokens` (which is honest tokens); this rolls up
/// the intensity proxy that already lives on every project.
fn rollup_daily_activity(projects: &[ProjectGrowth]) -> BTreeMap<String, u64> {
    let mut out: BTreeMap<String, u64> = BTreeMap::new();
    for project in projects {
        for (date, activity) in &project.daily_activity {
            *out.entry(date.clone()).or_insert(0) += *activity;
        }
    }
    out
}

/// Build a rolling-366-day activity series for the flowerbed view, oldest
/// first. Days with no activity get `activity=0, level=0`. Non-zero days
/// are quantized into levels 1..=4 with the same log-compressed shape as
/// `size_level` so a lush flower matches the user's mental model of a
/// vigorous vine.
fn build_flowerbed_year(
    daily_activity: &BTreeMap<String, u64>,
    now: DateTime<Utc>,
) -> Vec<FlowerbedDay> {
    let today = now.date_naive();
    let mut pairs: Vec<(String, u64)> = Vec::with_capacity(366);
    for offset in (0..366).rev() {
        let day = today - chrono::Duration::days(offset);
        let date = day.format("%Y-%m-%d").to_string();
        let activity = daily_activity.get(&date).copied().unwrap_or(0);
        pairs.push((date, activity));
    }
    let max_activity = pairs.iter().map(|(_, a)| *a).max().unwrap_or(0);
    pairs
        .into_iter()
        .map(|(date, activity)| FlowerbedDay {
            date,
            activity,
            level: flowerbed_level(activity, max_activity),
        })
        .collect()
}

/// Flowerbed level: 0 reserved for idle days; non-zero activity log-
/// compresses into 1..=4 using the same shape as `size_level`. Distinct
/// from `quantize_level` (used by `heatmap_year`) which is value/max
/// linear — the flowerbed wants intensity bursts to bloom visibly even
/// when one peak day dominates the year.
fn flowerbed_level(activity: u64, max_activity: u64) -> u8 {
    if activity == 0 || max_activity == 0 {
        return 0;
    }
    let min_log = 2.0_f64.log10();
    let max_log = (min_log + 1.0).max(((max_activity + 1) as f64).log10());
    let ratio = (((activity + 1) as f64).log10() - min_log) / (max_log - min_log);
    (ratio * 4.0).ceil().clamp(1.0, 4.0) as u8
}

/// Build a rolling-365-day calendar heatmap aligned to `now`'s UTC date.
/// Returns oldest-day-first so the front-end can iterate left-to-right.
///
/// Level quantization is self-relative: each day's `value / max_value` falls
/// into one of 4 non-zero bands at 0.25 / 0.5 / 0.75 / 1.0 cutoffs, mirroring
/// the 5-step GitHub contribution-graph scale. The "max value" is the largest
/// daily total within the 365-day window — so a user who never crosses 1k
/// tokens/day still sees a meaningful gradient, and a heavy user's gradient
/// doesn't get crushed by their own ceiling.
fn build_heatmap_year(
    daily_tokens: &BTreeMap<String, u64>,
    now: DateTime<Utc>,
) -> Vec<HeatmapEntry> {
    let today = now.date_naive();
    // Collect (date, value) pairs for the 365 days ending at today, oldest
    // first. Two-pass: gather values, compute max, then assign levels.
    let mut pairs: Vec<(String, u64)> = Vec::with_capacity(365);
    for i in (0..365).rev() {
        let day = today - chrono::Duration::days(i);
        let key = day.format("%Y-%m-%d").to_string();
        let value = daily_tokens.get(&key).copied().unwrap_or(0);
        pairs.push((key, value));
    }
    let max_value = pairs.iter().map(|(_, v)| *v).max().unwrap_or(0);
    pairs
        .into_iter()
        .map(|(date, value)| {
            let level = quantize_level(value, max_value);
            HeatmapEntry { date, value, level }
        })
        .collect()
}

/// 5-band quantization (0..=4). 0 reserved for empty days; non-empty days
/// split into 4 bins by `value / max`. The cutoffs match GitHub's
/// contribution-graph behavior.
fn quantize_level(value: u64, max_value: u64) -> u8 {
    if value == 0 || max_value == 0 {
        return 0;
    }
    let ratio = value as f64 / max_value as f64;
    if ratio <= 0.25 {
        1
    } else if ratio <= 0.5 {
        2
    } else if ratio <= 0.75 {
        3
    } else {
        4
    }
}

/// Build a 7×24 hour-of-week event-count grid over the trailing
/// `window_days` window. Row 0 = Monday … row 6 = Sunday, columns 0..23
/// = hour of day. Uses event timestamps' UTC weekday/hour — local-time
/// shifting is a future enhancement once we settle on a settings story
/// for it (today the user's clock and UTC drift differently and we
/// don't want to make that opinion at the core layer).
fn build_hour_of_week(
    events: &[AgentEvent],
    now: DateTime<Utc>,
    window_days: i64,
) -> Vec<Vec<u32>> {
    let cutoff = now - chrono::Duration::days(window_days);
    let mut grid = empty_hour_of_week();
    for event in events {
        if event.timestamp < cutoff || event.timestamp > now {
            continue;
        }
        let dow = event.timestamp.weekday().num_days_from_monday() as usize;
        let hour = event.timestamp.hour() as usize;
        if dow < 7 && hour < 24 {
            grid[dow][hour] = grid[dow][hour].saturating_add(1);
        }
    }
    grid
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
    fn path_inferred_true_only_when_all_events_inferred() {
        let ts = Utc.with_ymd_and_hms(2026, 5, 27, 10, 0, 0).unwrap();
        // Project A: both events inferred → path_inferred = true.
        let mut a1 = make_event(EventFixture {
            source: "claude-code",
            ts,
            project: Some("/decoded/guess"),
            session: Some("s1"),
            input: 100,
            output: 0,
            cache_read: 0,
            tool_calls: 0,
            model: None,
        });
        a1.mark_path_inferred();
        let mut a2 = make_event(EventFixture {
            source: "claude-code",
            ts: ts + chrono::Duration::seconds(1),
            project: Some("/decoded/guess"),
            session: Some("s1"),
            input: 50,
            output: 0,
            cache_read: 0,
            tool_calls: 0,
            model: None,
        });
        a2.mark_path_inferred();
        // Project B: trustworthy cwd events → path_inferred = false.
        let b1 = make_event(EventFixture {
            source: "claude-code",
            ts,
            project: Some("/real/project"),
            session: Some("s2"),
            input: 100,
            output: 0,
            cache_read: 0,
            tool_calls: 0,
            model: None,
        });

        let s = summarize(&[a1, a2, b1]);
        let a = s
            .projects
            .iter()
            .find(|p| p.project_key == "/decoded/guess")
            .unwrap();
        let b = s
            .projects
            .iter()
            .find(|p| p.project_key == "/real/project")
            .unwrap();
        assert!(a.path_inferred, "all-inferred project must be flagged");
        assert!(
            !b.path_inferred,
            "trustworthy-cwd project must not be flagged"
        );
        // Schema carries the new field.
        let json = serde_json::to_value(&s).unwrap();
        assert!(json["projects"][0].get("path_inferred").is_some());
    }

    #[test]
    fn windows_path_spellings_collapse_to_one_project() {
        // Regression: the same Windows directory recorded under three different
        // spellings must aggregate into ONE project (one key), not three rows.
        // Only the merge (key + count) is asserted — display_name derives from
        // `Path::file_name`, which is separator-aware per build target, so it
        // differs between a Windows host and a Unix CI runner and isn't a stable
        // cross-platform assertion.
        let ts = Utc.with_ymd_and_hms(2026, 5, 27, 10, 0, 0).unwrap();
        let mk = |proj: &'static str| EventFixture {
            source: "claude-code",
            ts,
            project: Some(proj),
            session: Some(proj),
            input: 100,
            output: 0,
            cache_read: 0,
            tool_calls: 0,
            model: None,
        };
        let events = vec![
            make_event(mk(r"\\?\D:\code\xiaowo")),
            make_event(mk("D:/code/xiaowo/")),
            make_event(mk(r"d:\code\xiaowo")),
        ];
        let s = summarize(&events);
        assert_eq!(
            s.projects.len(),
            1,
            "all spellings must collapse to one key"
        );
        assert_eq!(s.projects[0].project_key, r"D:\code\xiaowo");
    }

    #[test]
    fn same_basename_different_parents_stay_distinct() {
        // Regression: distinct directories that merely share a basename
        // (`xiaowo_sport`) must NOT be merged — keying is on full path, never on
        // display name. Guards against an over-eager "merge by name" fix.
        let ts = Utc.with_ymd_and_hms(2026, 5, 27, 10, 0, 0).unwrap();
        let mk = |proj: &'static str| EventFixture {
            source: "claude-code",
            ts,
            project: Some(proj),
            session: Some(proj),
            input: 100,
            output: 0,
            cache_read: 0,
            tool_calls: 0,
            model: None,
        };
        let events = vec![
            make_event(mk("/Users/me/dev/xiaowo_sport")),
            make_event(mk("/Users/me/work/xiaowo_sport")),
        ];
        let s = summarize(&events);
        assert_eq!(s.projects.len(), 2, "different parents must stay distinct");
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

    // ===== heatmap_year + hour_of_week (schema_version 5) ===================

    #[test]
    fn heatmap_year_has_exactly_365_entries_ending_today() {
        let now = Utc.with_ymd_and_hms(2026, 6, 18, 12, 0, 0).unwrap();
        let s = summarize_at(&[], now);
        assert_eq!(s.heatmap_year.len(), 365);
        // Oldest first, today last.
        assert_eq!(s.heatmap_year[0].date, "2025-06-19");
        assert_eq!(s.heatmap_year[364].date, "2026-06-18");
        // No data → all zero / level 0.
        assert!(s.heatmap_year.iter().all(|e| e.value == 0 && e.level == 0));
    }

    #[test]
    fn heatmap_year_levels_self_relative_to_max() {
        // Pin `now` so the dates are deterministic. Place one event per day
        // for five distinct days with escalating token totals: 100 / 600 /
        // 1300 / 2100 / 4000. Max = 4000 → ratios 0.025, 0.15, 0.325, 0.525,
        // 1.0 → levels 1, 1, 2, 3, 4.
        let now = Utc.with_ymd_and_hms(2026, 6, 18, 12, 0, 0).unwrap();
        let make_day = |days_ago: i64, tokens: u64| {
            let ts = now - chrono::Duration::days(days_ago);
            make_event(EventFixture {
                source: "claude-code",
                ts,
                project: Some("/p"),
                session: Some("s"),
                input: tokens,
                output: 0,
                cache_read: 0,
                tool_calls: 0,
                model: None,
            })
        };
        let events = vec![
            make_day(4, 100),
            make_day(3, 600),
            make_day(2, 1300),
            make_day(1, 2100),
            make_day(0, 4000),
        ];
        let s = summarize_at(&events, now);
        // heatmap_year is oldest-first; the 5 most recent are at positions
        // 360..=364.
        let tail: Vec<u8> = s.heatmap_year[360..].iter().map(|e| e.level).collect();
        // ratios: 100/4000=0.025→1, 600/4000=0.15→1, 1300/4000=0.325→2,
        // 2100/4000=0.525→3, 4000/4000=1.0→4
        assert_eq!(tail, vec![1, 1, 2, 3, 4]);
    }

    #[test]
    fn hour_of_week_grid_is_7x24_zeros_when_empty() {
        let s = summarize(&[]);
        assert_eq!(s.hour_of_week.len(), 7);
        for row in &s.hour_of_week {
            assert_eq!(row.len(), 24);
            assert!(row.iter().all(|&c| c == 0));
        }
    }

    #[test]
    fn hour_of_week_buckets_by_weekday_and_hour() {
        // 2026-06-17 is a Wednesday (dow index 2 in Mon=0..Sun=6).
        // Build 3 events on that day at hour 14, then 1 event on Sunday
        // (dow 6) at hour 9. Both within the 90-day window.
        let now = Utc.with_ymd_and_hms(2026, 6, 18, 23, 59, 0).unwrap();
        let wed_14 = Utc.with_ymd_and_hms(2026, 6, 17, 14, 30, 0).unwrap();
        let sun_09 = Utc.with_ymd_and_hms(2026, 6, 14, 9, 5, 0).unwrap(); // 2026-06-14 is Sun
        let mk = |ts| {
            make_event(EventFixture {
                source: "claude-code",
                ts,
                project: Some("/p"),
                session: Some("s"),
                input: 10,
                output: 0,
                cache_read: 0,
                tool_calls: 0,
                model: None,
            })
        };
        let events = vec![mk(wed_14), mk(wed_14), mk(wed_14), mk(sun_09)];
        let s = summarize_at(&events, now);
        assert_eq!(s.hour_of_week[2][14], 3, "Wed 14:00 should be 3");
        assert_eq!(s.hour_of_week[6][9], 1, "Sun 09:00 should be 1");
        // Every other cell stays zero.
        let total: u32 = s.hour_of_week.iter().flatten().sum();
        assert_eq!(total, 4);
    }

    #[test]
    fn hour_of_week_drops_events_outside_window() {
        // 120 days back — outside the 90-day window — should not be counted.
        let now = Utc.with_ymd_and_hms(2026, 6, 18, 12, 0, 0).unwrap();
        let too_old = now - chrono::Duration::days(120);
        let events = vec![make_event(EventFixture {
            source: "claude-code",
            ts: too_old,
            project: Some("/p"),
            session: Some("s"),
            input: 10,
            output: 0,
            cache_read: 0,
            tool_calls: 0,
            model: None,
        })];
        let s = summarize_at(&events, now);
        let total: u32 = s.hour_of_week.iter().flatten().sum();
        assert_eq!(total, 0);
    }

    #[test]
    fn schema_version_is_six() {
        assert_eq!(SUMMARY_SCHEMA_VERSION, 6);
        let s = summarize(&[]);
        assert_eq!(s.schema_version, 6);
    }

    #[test]
    fn flowerbed_year_is_366_entries_oldest_first() {
        let now = Utc.with_ymd_and_hms(2026, 6, 18, 12, 0, 0).unwrap();
        let s = summarize_at(&[], now);
        assert_eq!(s.flowerbed_year.len(), 366);
        assert_eq!(s.flowerbed_year[0].date, "2025-06-18");
        assert_eq!(s.flowerbed_year[365].date, "2026-06-18");
        assert!(
            s.flowerbed_year
                .iter()
                .all(|e| e.activity == 0 && e.level == 0)
        );
    }

    #[test]
    fn flowerbed_level_log_compresses_activity() {
        // Activity per day: 1 / 8 / 80 / 800 / 8000 — log-compressed so
        // even a low day blooms a little (level >= 1), and even one giant
        // peak still leaves the moderate days in tiers 2-3 (not all bottom).
        let now = Utc.with_ymd_and_hms(2026, 6, 18, 12, 0, 0).unwrap();
        let make_day = |days_ago: i64, tokens: u64, tool_calls: u32| {
            let ts = now - chrono::Duration::days(days_ago);
            make_event(EventFixture {
                source: "claude-code",
                ts,
                project: Some("/p"),
                session: Some("s"),
                input: tokens,
                output: 0,
                cache_read: 0,
                tool_calls,
                model: None,
            })
        };
        // daily_activity bump = max(1, tokens/1000 + tool_calls)
        // To get activity 1/8/80/800/8000 we use plain tool_calls.
        let events = vec![
            make_day(4, 0, 1),
            make_day(3, 0, 8),
            make_day(2, 0, 80),
            make_day(1, 0, 800),
            make_day(0, 0, 8000),
        ];
        let s = summarize_at(&events, now);
        let tail: Vec<u8> = s.flowerbed_year[361..].iter().map(|e| e.level).collect();
        // Each non-zero day must land in 1..=4; trend monotonically non-decreasing.
        assert!(tail[0] >= 1);
        for i in 1..5 {
            assert!(
                tail[i] >= tail[i - 1],
                "level non-monotonic at idx {i}: {tail:?}"
            );
        }
        assert_eq!(tail[4], 4, "peak day should hit the top bucket");
    }
}
