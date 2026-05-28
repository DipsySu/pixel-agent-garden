//! `AgentEvent` — the cross-adapter normalized event.
//!
//! The on-disk JSON layout MUST stay byte-compatible with the Python
//! implementation in `local_agent_garden/core/events.py`. The frontend
//! (`web/index.html`) reads the same shape via `garden-summary.json`, and the
//! phase-1 compatibility test diffs Rust vs Python output.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// One normalized event from any agent source. Adapters emit these; the
/// aggregator groups them by project.
///
/// Field ordering and naming mirror `local_agent_garden.core.events.AgentEvent`
/// exactly — do NOT reorder or rename without updating the compat test.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentEvent {
    pub source: String,

    /// Always serialized as UTC ISO 8601 with `+00:00` suffix, matching
    /// Python's `datetime.isoformat()` output. See `ts_serde` below.
    #[serde(with = "ts_serde")]
    pub timestamp: DateTime<Utc>,

    // None fields MUST serialize as `null` (not omitted) — Python's
    // `asdict()` always emits every field, and the compat test diffs on the
    // raw JSON. Do NOT add `skip_serializing_if` here.
    #[serde(default)]
    pub project_path: Option<String>,

    #[serde(default)]
    pub session_id: Option<String>,

    #[serde(default = "default_event_type")]
    pub event_type: String,

    /// Token counters live at the top level of the JSON, NOT nested under
    /// `usage`. `#[serde(flatten)]` keeps the struct internally tidy while
    /// preserving the Python wire shape.
    #[serde(flatten)]
    pub usage: TokenUsage,

    #[serde(default)]
    pub tool_calls: u32,

    #[serde(default)]
    pub model: Option<String>,

    #[serde(default)]
    pub files_touched: Vec<String>,

    #[serde(default)]
    pub cost_usd: Option<f64>,

    #[serde(default)]
    pub raw_ref: Option<String>,

    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenUsage {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_tokens: u64,
    #[serde(default)]
    pub cache_write_tokens: u64,
    #[serde(default)]
    pub total_tokens: u64,
}

fn default_event_type() -> String {
    "activity".to_string()
}

impl AgentEvent {
    /// Convenience builder: fill in the required fields, leave the rest
    /// defaulted. Used heavily by adapter code.
    pub fn new(source: impl Into<String>, timestamp: DateTime<Utc>) -> Self {
        Self {
            source: source.into(),
            timestamp,
            project_path: None,
            session_id: None,
            event_type: default_event_type(),
            usage: TokenUsage::default(),
            tool_calls: 0,
            model: None,
            files_touched: Vec::new(),
            cost_usd: None,
            raw_ref: None,
            metadata: BTreeMap::new(),
        }
    }

    /// If `total_tokens` is zero, fall back to the sum of the individual
    /// token counters. Mirrors Python `__post_init__`.
    pub fn normalize_totals(&mut self) {
        if self.usage.total_tokens == 0 {
            self.usage.total_tokens = self.usage.input_tokens
                + self.usage.output_tokens
                + self.usage.cache_read_tokens
                + self.usage.cache_write_tokens;
        }
    }

    /// Same key strategy as the Python aggregator: project_path when known,
    /// otherwise `unknown:<source>` so events still aggregate sensibly.
    pub fn project_key(&self) -> String {
        match self.project_path.as_deref().filter(|p| !p.is_empty()) {
            Some(path) => normalize_path(path),
            None => format!("unknown:{}", self.source),
        }
    }
}

fn normalize_path(p: &str) -> String {
    // Python does `Path(p).expanduser()` then `str(...)`. The expansion of
    // `~` is the only meaningful normalization. Tilde-prefixed paths in our
    // input data are rare (adapters generally read absolute paths), but
    // matching Python's behavior here keeps the project_key identical.
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = dirs_home() {
            let joined = home.join(rest);
            return joined.to_string_lossy().into_owned();
        }
    }
    if p == "~" {
        if let Some(home) = dirs_home() {
            return home.to_string_lossy().into_owned();
        }
    }
    p.to_string()
}

fn dirs_home() -> Option<std::path::PathBuf> {
    // Avoid pulling in the `dirs` crate for one function — std + env var is fine.
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(Into::into)
        .or_else(|| {
            // Fallback: drive root on weird Windows configs. Mirrors what
            // Path::home() degrades to in Python on those systems.
            Some(Path::new("/").to_path_buf())
        })
}

/// Custom serializer matching Python's `datetime.isoformat()`:
///   - UTC
///   - `+00:00` suffix (NOT `Z`)
///   - Microsecond precision when fractional seconds present, omitted otherwise
///
/// Concretely:
///   - whole seconds:     `2026-05-27T04:05:25+00:00`
///   - with microseconds: `2026-04-30T13:47:52.012000+00:00`
mod ts_serde {
    use chrono::{DateTime, Utc};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(dt: &DateTime<Utc>, s: S) -> Result<S::Ok, S::Error> {
        let micros = dt.timestamp_subsec_micros();
        let formatted = if micros == 0 {
            dt.format("%Y-%m-%dT%H:%M:%S+00:00").to_string()
        } else {
            format!("{}.{:06}+00:00", dt.format("%Y-%m-%dT%H:%M:%S"), micros)
        };
        s.serialize_str(&formatted)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<DateTime<Utc>, D::Error> {
        let s = String::deserialize(d)?;
        // Accept both `+00:00` and `Z` suffixes on input — be lenient on
        // read, strict on write.
        let normalized = match s.strip_suffix('Z') {
            Some(stripped) => format!("{stripped}+00:00"),
            None => s,
        };
        DateTime::parse_from_rfc3339(&normalized)
            .map(|d| d.with_timezone(&Utc))
            .map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn timestamp_serializes_with_plus_zero_suffix() {
        let dt = Utc.with_ymd_and_hms(2026, 5, 27, 4, 5, 25).unwrap();
        let ev = AgentEvent::new("claude-code", dt);
        let json = serde_json::to_string(&ev).unwrap();
        assert!(
            json.contains("\"2026-05-27T04:05:25+00:00\""),
            "expected `+00:00` suffix, got: {}",
            json
        );
        assert!(
            !json.contains("\"2026-05-27T04:05:25Z\""),
            "must not use `Z` suffix"
        );
    }

    #[test]
    fn timestamp_keeps_microseconds_when_present() {
        let dt = Utc.with_ymd_and_hms(2026, 4, 30, 13, 47, 52).unwrap()
            + chrono::Duration::microseconds(12_000);
        let ev = AgentEvent::new("claude-code", dt);
        let json = serde_json::to_string(&ev).unwrap();
        assert!(
            json.contains("\"2026-04-30T13:47:52.012000+00:00\""),
            "got: {}",
            json
        );
    }

    #[test]
    fn token_usage_flattens_to_top_level() {
        let mut ev = AgentEvent::new(
            "claude-code",
            Utc.with_ymd_and_hms(2026, 5, 27, 0, 0, 0).unwrap(),
        );
        ev.usage.input_tokens = 100;
        ev.usage.output_tokens = 50;
        ev.normalize_totals();
        let json: serde_json::Value = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["input_tokens"], 100);
        assert_eq!(json["output_tokens"], 50);
        assert_eq!(json["total_tokens"], 150);
        // The token fields must NOT be nested under `usage`.
        assert!(json.get("usage").is_none(), "usage must be flattened");
    }

    #[test]
    fn normalize_totals_only_recomputes_when_zero() {
        let mut ev = AgentEvent::new(
            "claude-code",
            Utc.with_ymd_and_hms(2026, 5, 27, 0, 0, 0).unwrap(),
        );
        ev.usage.input_tokens = 100;
        ev.usage.total_tokens = 999; // pre-set, should NOT be touched
        ev.normalize_totals();
        assert_eq!(ev.usage.total_tokens, 999);

        let mut ev2 = AgentEvent::new(
            "claude-code",
            Utc.with_ymd_and_hms(2026, 5, 27, 0, 0, 0).unwrap(),
        );
        ev2.usage.input_tokens = 100;
        ev2.usage.cache_read_tokens = 7;
        // total_tokens still 0 → recompute
        ev2.normalize_totals();
        assert_eq!(ev2.usage.total_tokens, 107);
    }

    #[test]
    fn project_key_uses_path_when_present() {
        let mut ev = AgentEvent::new(
            "claude-code",
            Utc.with_ymd_and_hms(2026, 5, 27, 0, 0, 0).unwrap(),
        );
        ev.project_path = Some("/Users/dipsy/Developer/pay-module".to_string());
        assert_eq!(
            ev.project_key(),
            "/Users/dipsy/Developer/pay-module".to_string()
        );
    }

    #[test]
    fn none_option_fields_serialize_as_null_not_omitted() {
        // Python's asdict() always emits every field; the compat test diffs
        // raw JSON, so an omitted field (vs null) breaks byte-equality.
        let ev = AgentEvent::new(
            "claude-code",
            Utc.with_ymd_and_hms(2026, 5, 27, 0, 0, 0).unwrap(),
        );
        // project_path, session_id, model, cost_usd, raw_ref all default to None
        let json: serde_json::Value = serde_json::to_value(&ev).unwrap();
        let obj = json.as_object().unwrap();
        assert!(
            obj.contains_key("project_path"),
            "project_path must be present (null)"
        );
        assert!(obj.contains_key("session_id"));
        assert!(obj.contains_key("model"));
        assert!(obj.contains_key("cost_usd"));
        assert!(obj.contains_key("raw_ref"));
        assert!(obj["project_path"].is_null());
        assert!(obj["session_id"].is_null());
        assert!(obj["model"].is_null());
        assert!(obj["cost_usd"].is_null());
        assert!(obj["raw_ref"].is_null());
    }

    #[test]
    fn project_key_falls_back_to_unknown_source() {
        let ev = AgentEvent::new("codex", Utc.with_ymd_and_hms(2026, 5, 27, 0, 0, 0).unwrap());
        assert_eq!(ev.project_key(), "unknown:codex");
    }
}
