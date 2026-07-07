//! Local model price table + cost estimation (PRD 2.0 §P4-1).
//!
//! Costs in this product are *answers*, not telemetry: everything is computed
//! from a local, user-editable price table and the token rollups already in
//! `GardenSummary`. No network fetch, ever — stale-but-local beats
//! fresh-but-phoning-home (privacy contract).
//!
//! Two layers, merged per model id:
//! - factory defaults bundled into the binary (`prices-default.json`, kept
//!   next to this module so the data ships with the code that defines its
//!   schema), refreshed with each release;
//! - the user override file at `~/.local-agent-garden/prices.json`. Entries
//!   there win for their model id; models the user never edited keep tracking
//!   the shipped defaults across upgrades (the PRD merge rule).
//!
//! Unlike `rings.json`, a broken `prices.json` is **never quarantined or
//! renamed**: rings are a product-owned cache we can restart, but prices are
//! user-authored data — destroying the file would throw away their edits.
//! Malformed or future-versioned files surface as typed errors and the file
//! is left exactly where it was; callers decide how to degrade.
//!
//! Honesty rules for the math (see [`estimate`]): rates only ever come from
//! the table, unknown models are bucketed as unpriced rather than guessed,
//! and precision is never invented — token counts that only exist as unsplit
//! totals are priced at an explicitly *blended* rate, and cache traffic is
//! counted but not priced (schema v1 carries no cache rates).

use crate::error::Error;
use crate::event::TokenUsage;
use crate::storage;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Schema version of the `prices.json` shape (both the bundled defaults and
/// the user override use it). Bump on any backward-incompatible change, e.g.
/// adding *required* per-model rate fields such as cache pricing.
pub const PRICES_SCHEMA_VERSION: u32 = 1;

/// Factory defaults, bundled at compile time. JSON cannot carry comments, so
/// the caveats live here instead: the seeded ids/rates are a small
/// best-effort snapshot of public Anthropic/OpenAI per-MTok pricing at
/// release time. They exist to make the cost tab useful out of the box, not
/// to be authoritative — the whole table is user-editable and every derived
/// figure must be labeled an estimate ("以账单为准").
const DEFAULT_PRICES_JSON: &str = include_str!("prices-default.json");

/// USD rates for one model, per million tokens. Both fields are required on
/// parse: a price entry missing either rate is malformed, not half-usable.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ModelPrice {
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
}

/// The `prices.json` document: `{ schema_version, prices: { <model-id>: … } }`.
///
/// Reads are lenient (`schema_version` missing → treated as current, `prices`
/// missing → empty) so a hand-written user file with just the entries they
/// care about is valid; writes always emit the full normalized shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PriceTable {
    #[serde(default = "current_prices_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub prices: BTreeMap<String, ModelPrice>,
}

fn current_prices_schema_version() -> u32 {
    PRICES_SCHEMA_VERSION
}

/// The factory table shipped inside the binary.
///
/// Panics only if the bundled asset itself is invalid — that is a build
/// defect, not a runtime condition (the asset is compile-time constant and
/// locked by `bundled_defaults_parse`), so no `Result` in the signature.
pub fn bundled_defaults() -> PriceTable {
    serde_json::from_str(DEFAULT_PRICES_JSON)
        .expect("bundled prices-default.json must parse (locked by bundled_defaults_parse test)")
}

/// Canonical location of the user override table, co-located with the rest
/// of the product state so "reset everything" stays one directory.
pub fn default_user_prices_path() -> PathBuf {
    storage::default_state_dir().join("prices.json")
}

/// Effective table = bundled defaults overlaid by the user file at `path`,
/// per model id. Missing file → defaults (first launch needs no setup).
///
/// A malformed or future-schema user file is a typed error and the file is
/// left untouched — never quarantined (user-authored data, see module docs).
/// Future-schema refusal mirrors the events cache: silently reading a shape
/// we do not understand could misprice everything.
pub fn load_effective(path: &Path) -> Result<PriceTable, Error> {
    let mut table = bundled_defaults();
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(table),
        Err(err) => return Err(Error::io(path, err)),
    };
    let user: PriceTable = serde_json::from_str(&text).map_err(|e| Error::json(path, e))?;
    if user.schema_version > PRICES_SCHEMA_VERSION {
        return Err(Error::InvalidRecord {
            context: path.display().to_string(),
            message: format!(
                "prices schema_version {} exceeds reader version {}; \
                 this file was written by a newer build and is left untouched",
                user.schema_version, PRICES_SCHEMA_VERSION
            ),
        });
    }
    for (model, price) in user.prices {
        table.prices.insert(model, price);
    }
    table.schema_version = PRICES_SCHEMA_VERSION;
    Ok(table)
}

/// Persist `table` as the user override file, atomically (shared
/// temp-file+rename helper — a crash never leaves half a JSON document).
///
/// The write is normalized to the current schema version. Note for callers:
/// whatever entries are saved here become *pinned* user overrides that stop
/// tracking shipped defaults, so a UI should save only the models the user
/// actually edited, not the whole effective table.
pub fn save_user(path: &Path, table: &PriceTable) -> Result<(), Error> {
    let normalized = PriceTable {
        schema_version: PRICES_SCHEMA_VERSION,
        prices: table.prices.clone(),
    };
    let json = serde_json::to_string_pretty(&normalized).map_err(|e| Error::json(path, e))?;
    storage::write_text_atomic(path, &json)
}

/// Cost breakdown for one priced model. Field names encode exactly how much
/// precision each component has, so the estimate never pretends precision it
/// lacks:
/// - `input_tokens` / `output_tokens` are priced at the table rates — the
///   precise part (Claude adapters report the full split).
/// - `blended_tokens` is the unsplit remainder (`total − input − output −
///   cache`), priced at `(input_per_mtok + output_per_mtok) / 2` — sources
///   like Codex report a single total, and inventing a split would be a lie.
/// - `cache_tokens` (read + write) are counted but **not** priced: schema v1
///   has no cache rates and provider cache multipliers differ; we do not
///   guess. Cache-heavy projects therefore under-estimate — the UI labels
///   every figure an estimate and bills remain the source of truth.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelCost {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub blended_tokens: u64,
    pub cache_tokens: u64,
    pub usd: f64,
}

/// Result of [`estimate`]. `unpriced_tokens` collects the *total* tokens of
/// every model absent from the table (including the aggregator's `"unknown"`
/// bucket) — surfaced as a count, never converted to dollars.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CostEstimate {
    pub total_usd: f64,
    pub by_model: BTreeMap<String, ModelCost>,
    pub unpriced_tokens: u64,
}

/// Estimate USD cost for per-model token usage (the `model_tokens` / `models`
/// rollups from `aggregate`) against a price table. Pure math, no I/O.
///
/// Models not present in the table go to `unpriced_tokens` and are absent
/// from `by_model` — callers who want a "未定价" row per model can diff their
/// rollup keys against `by_model`.
pub fn estimate(
    tokens_by_model: &BTreeMap<String, TokenUsage>,
    table: &PriceTable,
) -> CostEstimate {
    let mut by_model = BTreeMap::new();
    let mut total_usd = 0.0;
    let mut unpriced_tokens: u64 = 0;

    for (model, usage) in tokens_by_model {
        let Some(price) = table.prices.get(model) else {
            unpriced_tokens += usage.total_tokens;
            continue;
        };
        let cache_tokens = usage.cache_read_tokens + usage.cache_write_tokens;
        let split_tokens = usage.input_tokens + usage.output_tokens + cache_tokens;
        let blended_tokens = usage.total_tokens.saturating_sub(split_tokens);
        let blended_rate = (price.input_per_mtok + price.output_per_mtok) / 2.0;
        let usd = per_mtok(usage.input_tokens, price.input_per_mtok)
            + per_mtok(usage.output_tokens, price.output_per_mtok)
            + per_mtok(blended_tokens, blended_rate);
        total_usd += usd;
        by_model.insert(
            model.clone(),
            ModelCost {
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                blended_tokens,
                cache_tokens,
                usd,
            },
        );
    }

    CostEstimate {
        total_usd,
        by_model,
        unpriced_tokens,
    }
}

fn per_mtok(tokens: u64, rate: f64) -> f64 {
    tokens as f64 / 1_000_000.0 * rate
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(suffix: &str) -> PathBuf {
        std::env::temp_dir().join(format!("lag-prices-{}-{suffix}.json", std::process::id()))
    }

    fn usage(input: u64, output: u64, cache_read: u64, cache_write: u64) -> TokenUsage {
        let mut u = TokenUsage {
            input_tokens: input,
            output_tokens: output,
            cache_read_tokens: cache_read,
            cache_write_tokens: cache_write,
            total_tokens: 0,
        };
        u.total_tokens = input + output + cache_read + cache_write;
        u
    }

    #[test]
    fn bundled_defaults_parse() {
        let table = bundled_defaults();
        assert_eq!(table.schema_version, PRICES_SCHEMA_VERSION);
        assert!(!table.prices.is_empty());
        // One anchor per provider so a botched regeneration can't silently
        // ship an empty or single-provider table.
        let sonnet = table.prices["claude-sonnet-4-5"];
        assert!(sonnet.input_per_mtok > 0.0 && sonnet.output_per_mtok > sonnet.input_per_mtok);
        assert!(table.prices.contains_key("gpt-5"));
    }

    #[test]
    fn load_effective_missing_file_returns_defaults() {
        let path = tmp("missing");
        let _ = std::fs::remove_file(&path);
        let table = load_effective(&path).unwrap();
        assert_eq!(table, bundled_defaults());
    }

    #[test]
    fn user_overlay_wins_per_model_and_keeps_unedited_defaults() {
        let path = tmp("overlay");
        std::fs::write(
            &path,
            r#"{
              "schema_version": 1,
              "prices": {
                "claude-sonnet-4-5": { "input_per_mtok": 9.9, "output_per_mtok": 19.9 },
                "my-local-model": { "input_per_mtok": 0.0, "output_per_mtok": 0.0 }
              }
            }"#,
        )
        .unwrap();
        let table = load_effective(&path).unwrap();
        // Edited entry wins…
        assert_eq!(table.prices["claude-sonnet-4-5"].input_per_mtok, 9.9);
        // …a brand-new user model is added…
        assert!(table.prices.contains_key("my-local-model"));
        // …and unedited factory entries keep tracking shipped defaults.
        assert_eq!(table.prices["gpt-5"], bundled_defaults().prices["gpt-5"]);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn user_file_without_schema_version_reads_as_current() {
        // Hand-written minimal file: just the one entry the user cares about.
        let path = tmp("bare");
        std::fs::write(
            &path,
            r#"{ "prices": { "gpt-5": { "input_per_mtok": 2.0, "output_per_mtok": 4.0 } } }"#,
        )
        .unwrap();
        let table = load_effective(&path).unwrap();
        assert_eq!(table.prices["gpt-5"].input_per_mtok, 2.0);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn malformed_user_file_errors_without_touching_it() {
        let path = tmp("malformed");
        let garbage = "{ not json";
        std::fs::write(&path, garbage).unwrap();
        let err = load_effective(&path).unwrap_err();
        assert!(matches!(err, Error::Json { .. }), "got {err:?}");
        // Never-quarantine contract: the file still exists, byte-identical,
        // and no `.corrupt-*` sibling appeared.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), garbage);
        let dir = path.parent().unwrap();
        let stem = path.file_name().unwrap().to_str().unwrap().to_string();
        let quarantined = std::fs::read_dir(dir).unwrap().any(|e| {
            let name = e.unwrap().file_name().to_string_lossy().into_owned();
            name.starts_with(&stem) && name.contains("corrupt")
        });
        assert!(!quarantined, "prices.json must never be quarantined");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn future_schema_errors_without_touching_it() {
        let path = tmp("future");
        let newer = r#"{ "schema_version": 999, "prices": {} }"#;
        std::fs::write(&path, newer).unwrap();
        let err = load_effective(&path).unwrap_err();
        assert!(matches!(err, Error::InvalidRecord { .. }), "got {err:?}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), newer);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn save_user_roundtrips_and_overlays() {
        let path = tmp("save");
        let _ = std::fs::remove_file(&path);
        let mut prices = BTreeMap::new();
        prices.insert(
            "claude-sonnet-4-5".to_string(),
            ModelPrice {
                input_per_mtok: 1.5,
                output_per_mtok: 7.5,
            },
        );
        let user = PriceTable {
            schema_version: PRICES_SCHEMA_VERSION,
            prices,
        };
        save_user(&path, &user).unwrap();
        // The written file is the normalized document shape…
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw["schema_version"], 1);
        // …and the effective view shows the override on top of defaults.
        let table = load_effective(&path).unwrap();
        assert_eq!(table.prices["claude-sonnet-4-5"].input_per_mtok, 1.5);
        assert_eq!(table.prices["gpt-5"], bundled_defaults().prices["gpt-5"]);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn estimate_prices_split_and_blends_only_the_remainder() {
        let mut prices = BTreeMap::new();
        prices.insert(
            "m-split".to_string(),
            ModelPrice {
                input_per_mtok: 3.0,
                output_per_mtok: 15.0,
            },
        );
        prices.insert(
            "m-total-only".to_string(),
            ModelPrice {
                input_per_mtok: 1.0,
                output_per_mtok: 3.0,
            },
        );
        let table = PriceTable {
            schema_version: PRICES_SCHEMA_VERSION,
            prices,
        };

        let mut by_model = BTreeMap::new();
        // Claude-style event: full split, cache-heavy.
        by_model.insert(
            "m-split".to_string(),
            usage(2_000_000, 1_000_000, 10_000_000, 0),
        );
        // Codex-style event: only total_tokens known.
        by_model.insert(
            "m-total-only".to_string(),
            TokenUsage {
                total_tokens: 4_000_000,
                ..TokenUsage::default()
            },
        );

        let est = estimate(&by_model, &table);

        let split = &est.by_model["m-split"];
        // input 2M×$3 + output 1M×$15 = $21; cache counted, not priced.
        assert!((split.usd - 21.0).abs() < 1e-9);
        assert_eq!(split.blended_tokens, 0);
        assert_eq!(split.cache_tokens, 10_000_000);

        let total_only = &est.by_model["m-total-only"];
        // 4M unsplit tokens at blended (1+3)/2 = $2/MTok → $8.
        assert!((total_only.usd - 8.0).abs() < 1e-9);
        assert_eq!(total_only.blended_tokens, 4_000_000);
        assert_eq!(total_only.input_tokens, 0);

        assert!((est.total_usd - 29.0).abs() < 1e-9);
        assert_eq!(est.unpriced_tokens, 0);
    }

    #[test]
    fn estimate_buckets_unknown_models_never_guesses() {
        let table = bundled_defaults();
        let mut by_model = BTreeMap::new();
        by_model.insert("some-future-model".to_string(), usage(500, 500, 0, 0));
        by_model.insert("unknown".to_string(), usage(0, 0, 0, 1_000));
        let est = estimate(&by_model, &table);
        assert_eq!(est.unpriced_tokens, 2_000);
        assert!(est.by_model.is_empty());
        assert_eq!(est.total_usd, 0.0);
    }

    #[test]
    fn estimate_zero_tokens_is_zero_cost() {
        let table = bundled_defaults();
        let est = estimate(&BTreeMap::new(), &table);
        assert_eq!(est.total_usd, 0.0);
        assert!(est.by_model.is_empty());
        assert_eq!(est.unpriced_tokens, 0);

        // A priced model with all-zero usage stays a zero-dollar row, not an
        // error and not an unpriced bucket.
        let mut by_model = BTreeMap::new();
        by_model.insert("gpt-5".to_string(), TokenUsage::default());
        let est = estimate(&by_model, &table);
        assert_eq!(est.total_usd, 0.0);
        assert_eq!(est.by_model["gpt-5"].usd, 0.0);
    }
}
