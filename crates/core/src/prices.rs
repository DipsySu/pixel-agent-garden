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
//! totals are priced at an explicitly *blended* rate. Cache read/write tokens
//! are priced only when the table carries cache rates for that model; missing
//! cache rates stay zero rather than being guessed.

use crate::aggregate::GardenSummary;
use crate::error::Error;
use crate::event::TokenUsage;
use crate::storage;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Schema version of the `prices.json` shape (both the bundled defaults and
/// the user override use it). Bump on any backward-incompatible change.
///
/// v2 adds optional cache read/write rates. Older user files that only carry
/// input/output rates still load: known bundled models inherit shipped cache
/// rates, while custom models keep cache rates at zero.
pub const PRICES_SCHEMA_VERSION: u32 = 2;

/// Factory defaults, bundled at compile time. JSON cannot carry comments, so
/// the caveats live here instead: the seeded ids/rates are a small
/// best-effort snapshot of public Anthropic/OpenAI per-MTok USD API pricing at
/// release time. They exist to make the cost tab useful out of the box, not
/// to be authoritative — the whole table is user-editable and every derived
/// figure must be labeled an estimate ("以账单为准"). Refresh source notes live in
/// `docs/25-model-pricing-refresh.md`; Codex credit rates are intentionally not
/// converted to USD here.
const DEFAULT_PRICES_JSON: &str = include_str!("prices-default.json");

/// USD rates for one model, per million tokens.
///
/// `input_per_mtok` and `output_per_mtok` are the base rates.
/// `cache_read_per_mtok` and `cache_write_per_mtok` are separate because Claude
/// prompt caching has distinct read/write prices, while OpenAI exposes cached
/// input. A zero cache rate means "known but not priced", not "free forever".
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ModelPrice {
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
    #[serde(default)]
    pub cache_read_per_mtok: f64,
    #[serde(default)]
    pub cache_write_per_mtok: f64,
}

/// User-authored overlay shape. Cache fields are optional so a hand-written or
/// legacy v1 file can still override only input/output without breaking.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct PriceTablePatch {
    #[serde(default = "current_prices_schema_version")]
    schema_version: u32,
    #[serde(default)]
    prices: BTreeMap<String, ModelPricePatch>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
struct ModelPricePatch {
    input_per_mtok: Option<f64>,
    output_per_mtok: Option<f64>,
    cache_read_per_mtok: Option<f64>,
    cache_write_per_mtok: Option<f64>,
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
    let user: PriceTablePatch = serde_json::from_str(&text).map_err(|e| Error::json(path, e))?;
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
    for (model, patch) in user.prices {
        let Some(price) = merge_price_patch(table.prices.get(&model).copied(), patch) else {
            continue;
        };
        // A negative or non-finite user-supplied rate would yield nonsensical
        // cost (negative dollars, or NaN → serialized as `null`). Reject the bad
        // entry and keep whatever bundled default exists for that model rather
        // than letting one typo mis-price the whole tab.
        if !valid_price(&price) {
            continue;
        }
        table.prices.insert(model, price);
    }
    table.schema_version = PRICES_SCHEMA_VERSION;
    Ok(table)
}

fn merge_price_patch(base: Option<ModelPrice>, patch: ModelPricePatch) -> Option<ModelPrice> {
    let input = patch
        .input_per_mtok
        .or_else(|| base.map(|price| price.input_per_mtok))?;
    let output = patch
        .output_per_mtok
        .or_else(|| base.map(|price| price.output_per_mtok))?;
    Some(ModelPrice {
        input_per_mtok: input,
        output_per_mtok: output,
        cache_read_per_mtok: patch
            .cache_read_per_mtok
            .or_else(|| base.map(|price| price.cache_read_per_mtok))
            .unwrap_or(0.0),
        cache_write_per_mtok: patch
            .cache_write_per_mtok
            .or_else(|| base.map(|price| price.cache_write_per_mtok))
            .unwrap_or(0.0),
    })
}

fn valid_price(price: &ModelPrice) -> bool {
    [
        price.input_per_mtok,
        price.output_per_mtok,
        price.cache_read_per_mtok,
        price.cache_write_per_mtok,
    ]
    .into_iter()
    .all(|rate| rate.is_finite() && rate >= 0.0)
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
/// - `cache_read_tokens` / `cache_write_tokens` are priced at their own table
///   rates when present; a zero rate is an explicit counted-but-not-priced
///   value for unsupported or user-defined models.
/// - `*_per_mtok` fields echo the exact table rates this row was priced at.
///   The UI shows those rates from the result that produced `usd`, so displayed
///   prices cannot drift from the computed cost.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ModelCost {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub blended_tokens: u64,
    #[serde(default)]
    pub cache_read_tokens: u64,
    #[serde(default)]
    pub cache_write_tokens: u64,
    /// Backward-friendly aggregate for older UI/export readers.
    #[serde(default)]
    pub cache_tokens: u64,
    pub usd: f64,
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
    #[serde(default)]
    pub cache_read_per_mtok: f64,
    #[serde(default)]
    pub cache_write_per_mtok: f64,
}

/// Result of [`estimate`]. `unpriced_tokens` is the total tokens of every model
/// absent from the table (never converted to dollars); `unpriced_by_model`
/// keeps the per-model breakdown of that same figure so a UI can name which
/// models are unpriced (e.g. a brand-new model id) rather than showing only an
/// opaque aggregate. Invariant: `unpriced_tokens == sum(unpriced_by_model.values())`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CostEstimate {
    pub total_usd: f64,
    pub by_model: BTreeMap<String, ModelCost>,
    pub unpriced_tokens: u64,
    #[serde(default)]
    pub unpriced_by_model: BTreeMap<String, u64>,
}

/// Estimate USD cost for per-model token usage (the `model_tokens` / `models`
/// rollups from `aggregate`) against a price table. Pure math, no I/O.
///
/// Models not present in the table are absent from `by_model`; their tokens go
/// to `unpriced_tokens` and, per model, to `unpriced_by_model` so a UI can name
/// them without re-deriving from a separate rollup.
pub fn estimate(
    tokens_by_model: &BTreeMap<String, TokenUsage>,
    table: &PriceTable,
) -> CostEstimate {
    let mut by_model = BTreeMap::new();
    let mut unpriced_by_model = BTreeMap::new();
    let mut total_usd = 0.0;
    let mut unpriced_tokens: u64 = 0;

    for (model, usage) in tokens_by_model {
        let Some(price) = table.prices.get(model) else {
            if usage.total_tokens > 0 {
                unpriced_tokens += usage.total_tokens;
                unpriced_by_model.insert(model.clone(), usage.total_tokens);
            }
            continue;
        };
        let cache_tokens = usage.cache_read_tokens + usage.cache_write_tokens;
        let split_tokens = usage.input_tokens + usage.output_tokens + cache_tokens;
        let blended_tokens = usage.total_tokens.saturating_sub(split_tokens);
        let blended_rate = (price.input_per_mtok + price.output_per_mtok) / 2.0;
        let usd = per_mtok(usage.input_tokens, price.input_per_mtok)
            + per_mtok(usage.output_tokens, price.output_per_mtok)
            + per_mtok(blended_tokens, blended_rate)
            + per_mtok(usage.cache_read_tokens, price.cache_read_per_mtok)
            + per_mtok(usage.cache_write_tokens, price.cache_write_per_mtok);
        total_usd += usd;
        by_model.insert(
            model.clone(),
            ModelCost {
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                blended_tokens,
                cache_read_tokens: usage.cache_read_tokens,
                cache_write_tokens: usage.cache_write_tokens,
                cache_tokens,
                usd,
                input_per_mtok: price.input_per_mtok,
                output_per_mtok: price.output_per_mtok,
                cache_read_per_mtok: price.cache_read_per_mtok,
                cache_write_per_mtok: price.cache_write_per_mtok,
            },
        );
    }

    CostEstimate {
        total_usd,
        by_model,
        unpriced_tokens,
        unpriced_by_model,
    }
}

fn per_mtok(tokens: u64, rate: f64) -> f64 {
    tokens as f64 / 1_000_000.0 * rate
}

/// A whole-`GardenSummary` cost estimate: the garden `total` plus a
/// per-project `by_project` breakdown keyed by `ProjectGrowth.project_key`.
///
/// The point of this type is to make `core` the *single source* of the cost
/// math. Both the summary total and every per-project figure come from the
/// same [`estimate`] call over the same price table, so the "total spent"
/// number and the sum of the project rows can never disagree — the drift a
/// hand-written frontend mirror used to risk. The web layer only displays,
/// formats, and falls back; it does no arithmetic.
///
/// This is a *compute result* returned by a command, never written to disk, so
/// it carries no `schema_version` (unlike `GardenSummary` / the events cache).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SummaryCost {
    pub total: CostEstimate,
    pub by_project: BTreeMap<String, CostEstimate>,
}

/// Estimate cost for a whole summary in one pass: `total` over
/// `summary.models`, and one `by_project` entry per project over its
/// `model_tokens`. Reuses [`estimate`] for every layer — no second copy of the
/// pricing loop.
///
/// Projects whose `model_tokens` carry no tokens at all are skipped so the map
/// stays lean (a project that only ever logged tool calls contributes no cost
/// row). "No tokens" mirrors what [`estimate`] would see: every usage empty in
/// all count fields. Pure math, no I/O.
pub fn estimate_summary(summary: &GardenSummary, table: &PriceTable) -> SummaryCost {
    let total = estimate(&summary.models, table);
    let mut by_project = BTreeMap::new();
    for project in &summary.projects {
        let has_tokens = project.model_tokens.values().any(|u| {
            u.total_tokens > 0
                || u.input_tokens > 0
                || u.output_tokens > 0
                || u.cache_read_tokens > 0
                || u.cache_write_tokens > 0
        });
        if !has_tokens {
            continue;
        }
        by_project.insert(
            project.project_key.clone(),
            estimate(&project.model_tokens, table),
        );
    }
    SummaryCost { total, by_project }
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

    fn price(input: f64, output: f64) -> ModelPrice {
        ModelPrice {
            input_per_mtok: input,
            output_per_mtok: output,
            cache_read_per_mtok: 0.0,
            cache_write_per_mtok: 0.0,
        }
    }

    fn price_with_cache(input: f64, output: f64, cache_read: f64, cache_write: f64) -> ModelPrice {
        ModelPrice {
            input_per_mtok: input,
            output_per_mtok: output,
            cache_read_per_mtok: cache_read,
            cache_write_per_mtok: cache_write,
        }
    }

    #[test]
    fn bundled_defaults_parse() {
        let table = bundled_defaults();
        assert_eq!(table.schema_version, PRICES_SCHEMA_VERSION);
        assert!(!table.prices.is_empty());
        // One anchor per provider so a botched regeneration can't silently
        // ship an empty or single-provider table.
        let sonnet = table.prices["claude-sonnet-5"];
        assert!(sonnet.input_per_mtok > 0.0 && sonnet.output_per_mtok > sonnet.input_per_mtok);
        assert_eq!(sonnet.cache_read_per_mtok, 0.2);
        assert_eq!(sonnet.cache_write_per_mtok, 2.5);
        assert_eq!(table.prices["claude-opus-4-8"].input_per_mtok, 5.0);
        assert_eq!(table.prices["claude-opus-4-8"].cache_read_per_mtok, 0.5);
        assert_eq!(table.prices["gpt-5.6-sol"].input_per_mtok, 5.0);
        assert_eq!(table.prices["gpt-5.6-sol"].output_per_mtok, 30.0);
        assert_eq!(table.prices["gpt-5.6-sol"].cache_read_per_mtok, 0.5);
        assert_eq!(table.prices["gpt-5.6-sol"].cache_write_per_mtok, 6.25);
        assert_eq!(table.prices["gpt-5.6-terra"].input_per_mtok, 2.5);
        assert_eq!(table.prices["gpt-5.6-terra"].output_per_mtok, 15.0);
        assert_eq!(table.prices["gpt-5.6-terra"].cache_write_per_mtok, 3.125);
        assert_eq!(table.prices["gpt-5.6-luna"].input_per_mtok, 1.0);
        assert_eq!(table.prices["gpt-5.6-luna"].output_per_mtok, 6.0);
        assert_eq!(table.prices["gpt-5.6-luna"].cache_read_per_mtok, 0.1);
        assert_eq!(table.prices["gpt-5.5"].output_per_mtok, 30.0);
        assert_eq!(table.prices["gpt-5.5"].cache_read_per_mtok, 0.5);
        assert_eq!(table.prices["gpt-5.3-codex"].input_per_mtok, 1.75);
        assert_eq!(table.prices["gpt-5.3-codex"].cache_read_per_mtok, 0.175);
    }

    #[test]
    fn load_effective_missing_file_returns_defaults() {
        let path = tmp("missing");
        let _ = std::fs::remove_file(&path);
        let table = load_effective(&path).unwrap();
        assert_eq!(table, bundled_defaults());
    }

    #[test]
    fn negative_or_nonfinite_user_rate_is_rejected() {
        // A negative or non-finite rate would produce negative / NaN cost. The
        // bad entry is dropped (kept out of the effective table); a valid entry
        // in the same file still lands.
        let path = tmp("badrate");
        std::fs::write(
            &path,
            r#"{
              "prices": {
                "neg-model": { "input_per_mtok": -1.0, "output_per_mtok": 5.0 },
                "ok-model": { "input_per_mtok": 2.0, "output_per_mtok": 4.0 }
              }
            }"#,
        )
        .unwrap();
        let table = load_effective(&path).unwrap();
        assert!(!table.prices.contains_key("neg-model"));
        assert_eq!(table.prices["ok-model"].input_per_mtok, 2.0);
        std::fs::remove_file(&path).ok();
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
        // …while missing v1 cache fields inherit the bundled cache rates for a
        // known model instead of silently dropping cache pricing.
        assert_eq!(
            table.prices["claude-sonnet-4-5"].cache_read_per_mtok,
            bundled_defaults().prices["claude-sonnet-4-5"].cache_read_per_mtok
        );
        // …a brand-new user model is added…
        assert!(table.prices.contains_key("my-local-model"));
        // …but unknown user models do not get guessed cache pricing.
        assert_eq!(table.prices["my-local-model"].cache_read_per_mtok, 0.0);
        assert_eq!(table.prices["my-local-model"].cache_write_per_mtok, 0.0);
        // …and unedited factory entries keep tracking shipped defaults.
        assert_eq!(
            table.prices["gpt-5.5"],
            bundled_defaults().prices["gpt-5.5"]
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn user_file_without_schema_version_reads_as_current() {
        // Hand-written minimal file: just the one entry the user cares about.
        let path = tmp("bare");
        std::fs::write(
            &path,
            r#"{ "prices": { "gpt-5.5": { "input_per_mtok": 2.0, "output_per_mtok": 4.0 } } }"#,
        )
        .unwrap();
        let table = load_effective(&path).unwrap();
        assert_eq!(table.prices["gpt-5.5"].input_per_mtok, 2.0);
        assert_eq!(
            table.prices["gpt-5.5"].cache_read_per_mtok,
            bundled_defaults().prices["gpt-5.5"].cache_read_per_mtok
        );
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
        prices.insert("claude-sonnet-4-5".to_string(), price(1.5, 7.5));
        let user = PriceTable {
            schema_version: PRICES_SCHEMA_VERSION,
            prices,
        };
        save_user(&path, &user).unwrap();
        // The written file is the normalized document shape…
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw["schema_version"], 2);
        // …and the effective view shows the override on top of defaults.
        let table = load_effective(&path).unwrap();
        assert_eq!(table.prices["claude-sonnet-4-5"].input_per_mtok, 1.5);
        assert_eq!(
            table.prices["gpt-5.5"],
            bundled_defaults().prices["gpt-5.5"]
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn empty_user_table_keeps_every_bundled_default() {
        // The desktop "Open Model Prices" entry initializes a missing file
        // this way. It must remain an empty overlay rather than pinning a copy
        // of today's effective defaults into user-owned state.
        let path = tmp("empty-overlay");
        let _ = std::fs::remove_file(&path);
        let empty = PriceTable {
            schema_version: PRICES_SCHEMA_VERSION,
            prices: BTreeMap::new(),
        };
        save_user(&path, &empty).unwrap();

        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw["prices"].as_object().unwrap().len(), 0);
        assert_eq!(load_effective(&path).unwrap(), bundled_defaults());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn estimate_prices_split_cache_and_blends_only_the_remainder() {
        let mut prices = BTreeMap::new();
        prices.insert(
            "m-split".to_string(),
            price_with_cache(3.0, 15.0, 0.3, 3.75),
        );
        prices.insert("m-total-only".to_string(), price(1.0, 3.0));
        let table = PriceTable {
            schema_version: PRICES_SCHEMA_VERSION,
            prices,
        };

        let mut by_model = BTreeMap::new();
        // Claude-style event: full split, cache-heavy.
        by_model.insert(
            "m-split".to_string(),
            usage(2_000_000, 1_000_000, 10_000_000, 2_000_000),
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
        // input 2M×$3 + output 1M×$15 + cache read 10M×$0.3 +
        // cache write 2M×$3.75 = $31.5.
        assert!((split.usd - 31.5).abs() < 1e-9);
        assert_eq!(split.blended_tokens, 0);
        assert_eq!(split.cache_read_tokens, 10_000_000);
        assert_eq!(split.cache_write_tokens, 2_000_000);
        assert_eq!(split.cache_tokens, 12_000_000);
        assert_eq!(split.cache_read_per_mtok, 0.3);
        assert_eq!(split.cache_write_per_mtok, 3.75);

        let total_only = &est.by_model["m-total-only"];
        // 4M unsplit tokens at blended (1+3)/2 = $2/MTok → $8.
        assert!((total_only.usd - 8.0).abs() < 1e-9);
        assert_eq!(total_only.blended_tokens, 4_000_000);
        assert_eq!(total_only.input_tokens, 0);

        assert!((est.total_usd - 39.5).abs() < 1e-9);
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
        // The aggregate is also broken out per model so the UI can name them,
        // and the parts sum back to the scalar.
        assert_eq!(est.unpriced_by_model.get("some-future-model"), Some(&1_000));
        assert_eq!(est.unpriced_by_model.get("unknown"), Some(&1_000));
        assert_eq!(
            est.unpriced_by_model.values().sum::<u64>(),
            est.unpriced_tokens
        );
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
        by_model.insert("gpt-5.5".to_string(), TokenUsage::default());
        let est = estimate(&by_model, &table);
        assert_eq!(est.total_usd, 0.0);
        assert_eq!(est.by_model["gpt-5.5"].usd, 0.0);
    }

    // ---- estimate_summary: single source across summary + projects --------

    fn one(model: &str, u: TokenUsage) -> BTreeMap<String, TokenUsage> {
        let mut m = BTreeMap::new();
        m.insert(model.to_string(), u);
        m
    }

    fn project_with(
        key: &str,
        model_tokens: BTreeMap<String, TokenUsage>,
    ) -> crate::aggregate::ProjectGrowth {
        crate::aggregate::ProjectGrowth {
            project_key: key.to_string(),
            model_tokens,
            ..Default::default()
        }
    }

    /// Fixture GardenSummary — only the two fields `estimate_summary` reads
    /// (`models`, `projects`) carry data; the rest are inert defaults.
    /// `GardenSummary` has no `Default` impl (its shape is the frontend
    /// contract), so the fields are spelled out here rather than mocked.
    fn summary_with(
        models: BTreeMap<String, TokenUsage>,
        projects: Vec<crate::aggregate::ProjectGrowth>,
    ) -> GardenSummary {
        GardenSummary {
            schema_version: crate::aggregate::SUMMARY_SCHEMA_VERSION,
            projects,
            sources: BTreeMap::new(),
            source_tokens: BTreeMap::new(),
            source_recent_tokens: BTreeMap::new(),
            total_events: 0,
            total_tokens: 0,
            first_seen: None,
            last_seen: None,
            active_projects: 0,
            daily_tokens: BTreeMap::new(),
            heatmap_year: Vec::new(),
            hour_of_week: Vec::new(),
            flowerbed_year: Vec::new(),
            tiers: None,
            models,
        }
    }

    #[test]
    fn estimate_summary_total_is_bit_identical_to_estimate_over_models() {
        // The whole point: `total` is the SAME computation as `estimate`, so
        // "total spent" can never drift from the per-model rows.
        let mut prices = BTreeMap::new();
        prices.insert("m-split".to_string(), price(3.0, 15.0));
        let table = PriceTable {
            schema_version: PRICES_SCHEMA_VERSION,
            prices,
        };
        let models = one("m-split", usage(2_000_000, 1_000_000, 0, 0));
        let summary = summary_with(models.clone(), vec![]);

        let cost = estimate_summary(&summary, &table);
        assert_eq!(cost.total, estimate(&models, &table));
        assert!((cost.total.total_usd - 21.0).abs() < 1e-9);
        assert!(cost.by_project.is_empty());
    }

    #[test]
    fn estimate_summary_splits_projects_by_key_with_distinct_models() {
        let mut prices = BTreeMap::new();
        prices.insert("m-a".to_string(), price_with_cache(3.0, 15.0, 0.3, 3.75));
        prices.insert("m-b".to_string(), price(1.0, 3.0));
        let table = PriceTable {
            schema_version: PRICES_SCHEMA_VERSION,
            prices,
        };
        // demo-a: 2M×$3 + 1M×$15 = $21.  demo-b: 1M×$1 + 1M×$3 = $4.
        let proj_a = project_with("demo-a", one("m-a", usage(2_000_000, 1_000_000, 0, 0)));
        let proj_b = project_with("demo-b", one("m-b", usage(1_000_000, 1_000_000, 0, 0)));
        let mut models = BTreeMap::new();
        models.insert("m-a".to_string(), usage(2_000_000, 1_000_000, 0, 0));
        models.insert("m-b".to_string(), usage(1_000_000, 1_000_000, 0, 0));
        let summary = summary_with(models, vec![proj_a, proj_b]);

        let cost = estimate_summary(&summary, &table);
        assert_eq!(cost.by_project.len(), 2);
        assert!((cost.by_project["demo-a"].total_usd - 21.0).abs() < 1e-9);
        assert!((cost.by_project["demo-b"].total_usd - 4.0).abs() < 1e-9);
        assert!((cost.total.total_usd - 25.0).abs() < 1e-9);
    }

    #[test]
    fn estimate_summary_buckets_unknown_project_model_as_unpriced() {
        let table = bundled_defaults();
        let proj = project_with(
            "demo-unknown",
            one("some-future-model", usage(500, 500, 0, 0)),
        );
        let summary = summary_with(BTreeMap::new(), vec![proj]);

        let cost = estimate_summary(&summary, &table);
        let est = &cost.by_project["demo-unknown"];
        assert_eq!(est.unpriced_tokens, 1_000);
        assert!(est.by_model.is_empty());
        assert_eq!(est.total_usd, 0.0);
    }

    #[test]
    fn estimate_summary_keeps_cache_only_and_total_only_projects() {
        let mut prices = BTreeMap::new();
        prices.insert("m-blend".to_string(), price_with_cache(1.0, 3.0, 0.5, 1.25));
        let table = PriceTable {
            schema_version: PRICES_SCHEMA_VERSION,
            prices,
        };
        // Cache-only: carries tokens, so it is kept and priced when the table
        // has a cache read rate.
        let cache_only = project_with("demo-cache", one("m-blend", usage(0, 0, 4_000_000, 0)));
        // Total-only (Codex-style): one unsplit total, priced at blended $2/MTok.
        let total_only = project_with(
            "demo-total",
            one(
                "m-blend",
                TokenUsage {
                    total_tokens: 4_000_000,
                    ..TokenUsage::default()
                },
            ),
        );
        let summary = summary_with(BTreeMap::new(), vec![cache_only, total_only]);

        let cost = estimate_summary(&summary, &table);
        assert!((cost.by_project["demo-cache"].total_usd - 2.0).abs() < 1e-9);
        assert_eq!(
            cost.by_project["demo-cache"].by_model["m-blend"].cache_tokens,
            4_000_000
        );
        assert!((cost.by_project["demo-total"].total_usd - 8.0).abs() < 1e-9);
        assert_eq!(
            cost.by_project["demo-total"].by_model["m-blend"].blended_tokens,
            4_000_000
        );
    }

    #[test]
    fn estimate_summary_skips_projects_without_tokens() {
        let table = bundled_defaults();
        // Empty model_tokens map, and a map whose only usage is all-zero: both
        // contribute nothing, so neither appears in by_project (lean map).
        let empty_map = project_with("demo-empty", BTreeMap::new());
        let all_zero = project_with("demo-zero", one("gpt-5.5", TokenUsage::default()));
        let summary = summary_with(BTreeMap::new(), vec![empty_map, all_zero]);

        let cost = estimate_summary(&summary, &table);
        assert!(cost.by_project.is_empty());
    }

    #[test]
    fn estimate_summary_empty_summary_is_empty() {
        let table = bundled_defaults();
        let cost = estimate_summary(&summary_with(BTreeMap::new(), vec![]), &table);
        assert_eq!(cost.total.total_usd, 0.0);
        assert!(cost.total.by_model.is_empty());
        assert_eq!(cost.total.unpriced_tokens, 0);
        assert!(cost.by_project.is_empty());
    }

    #[test]
    fn estimate_echoes_the_rate_it_priced_at() {
        // The UI's "$X/$Y per MTok" line reads these back, so they must equal
        // the table rate that produced `usd` — in the total and per project.
        let mut prices = BTreeMap::new();
        prices.insert("m-a".to_string(), price_with_cache(3.0, 15.0, 0.3, 3.75));
        let table = PriceTable {
            schema_version: PRICES_SCHEMA_VERSION,
            prices,
        };
        let models = one("m-a", usage(1_000_000, 1_000_000, 500_000, 100_000));
        let summary = summary_with(models.clone(), vec![project_with("demo-a", models)]);

        let cost = estimate_summary(&summary, &table);
        let row = &cost.total.by_model["m-a"];
        assert_eq!(row.input_per_mtok, 3.0);
        assert_eq!(row.output_per_mtok, 15.0);
        assert_eq!(row.cache_read_per_mtok, 0.3);
        assert_eq!(row.cache_write_per_mtok, 3.75);
        assert_eq!(
            cost.by_project["demo-a"].by_model["m-a"].input_per_mtok,
            3.0
        );
    }
}
