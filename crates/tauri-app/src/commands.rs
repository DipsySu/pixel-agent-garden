//! Tauri command handlers. Each one is a thin shim that delegates to
//! `local_agent_garden_core` — no business logic here (spec §10 rule #3).
//!
//! Heavy work runs inside `tokio::task::spawn_blocking` so it doesn't block
//! the WebView render thread. The `core` crate itself is sync (spec §Q3 —
//! Rust 1.85 doesn't need tokio for file I/O), so the only async cost is
//! the wrapping.

use local_agent_garden_core::adapter::AdapterContext;
use local_agent_garden_core::aggregate::{self, GardenSummary};
use local_agent_garden_core::registry;
use local_agent_garden_core::scan;
use local_agent_garden_core::settings::{self, Settings};
use serde::Serialize;

/// Return the current garden summary by running a fresh scan + aggregate.
/// Frontend calls this on startup and on demand.
#[tauri::command]
pub async fn garden_summary() -> Result<GardenSummary, String> {
    tokio::task::spawn_blocking(|| {
        let ctx = AdapterContext::from_env();
        let result = scan::collect_events(&ctx, None).map_err(|e| e.to_string())?;
        Ok(aggregate::summarize(&result.events))
    })
    .await
    .map_err(|e| format!("scan task panicked: {e}"))?
}

/// Force a fresh scan + summary. Same code path as `garden_summary` for
/// phase 2 day 1 (we don't cache yet). When caching lands, this bypasses
/// the cache; `garden_summary` reuses the cached value.
#[tauri::command]
pub async fn trigger_scan() -> Result<GardenSummary, String> {
    garden_summary().await
}

#[derive(Serialize)]
pub struct AdapterStatus {
    pub name: String,
    pub active: bool,
}

#[tauri::command]
pub async fn list_adapters() -> Result<Vec<AdapterStatus>, String> {
    tokio::task::spawn_blocking(|| {
        let ctx = AdapterContext::from_env();
        let mut out = Vec::new();
        for adapter in registry::default_adapters() {
            out.push(AdapterStatus {
                name: adapter.name().to_string(),
                active: adapter.discover(&ctx),
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("list_adapters task panicked: {e}"))?
}

/// Returns the last_seen timestamp across the whole garden — the frontend's
/// "updated N minutes ago" pill uses this when the summary is cached. ISO
/// 8601 string for easy JS Date parsing.
#[tauri::command]
pub async fn data_freshness() -> Result<Option<String>, String> {
    let summary = garden_summary().await?;
    Ok(summary.last_seen.map(|d| d.to_rfc3339()))
}

// ---- Settings (spec §2.4) ------------------------------------------------
// Read/write user preferences. Both commands hit disk each call — settings
// is not a hot path, no caching needed.

#[tauri::command]
pub async fn get_settings() -> Result<Settings, String> {
    tokio::task::spawn_blocking(|| {
        let path = settings::default_settings_path();
        settings::load(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("get_settings task panicked: {e}"))?
}

#[tauri::command]
pub async fn set_settings(settings: Settings) -> Result<Settings, String> {
    tokio::task::spawn_blocking(move || {
        let path = local_agent_garden_core::settings::default_settings_path();
        local_agent_garden_core::settings::save(&path, &settings).map_err(|e| e.to_string())?;
        Ok(settings)
    })
    .await
    .map_err(|e| format!("set_settings task panicked: {e}"))?
}
