//! Tauri command handlers. Each one is a thin shim that delegates to
//! `local_agent_garden_core` — no business logic here (spec §10 rule #3).
//!
//! Heavy work runs inside `tokio::task::spawn_blocking` so it doesn't block
//! the WebView render thread. The `core` crate itself is sync (spec §Q3 —
//! Rust 1.85 doesn't need tokio for file I/O), so the only async cost is
//! the wrapping.

use local_agent_garden_core::adapter::AdapterContext;
use local_agent_garden_core::aggregate::GardenSummary;
use local_agent_garden_core::cache;
use local_agent_garden_core::registry;
use local_agent_garden_core::rings::{self, RingBook};
use local_agent_garden_core::settings::{self, Settings};
use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

/// Return the current garden summary from cache when possible, falling back to
/// a fresh scan that writes `~/.local-agent-garden/events.json`.
#[tauri::command]
pub async fn garden_summary() -> Result<GardenSummary, String> {
    tokio::task::spawn_blocking(|| {
        let ctx = AdapterContext::from_env();
        cache::summary_from_cache_or_scan(&ctx, None).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("garden_summary task panicked: {e}"))?
}

/// Force a fresh scan, update the cache, and return the new summary.
#[tauri::command]
pub async fn trigger_scan() -> Result<GardenSummary, String> {
    tokio::task::spawn_blocking(|| {
        let ctx = AdapterContext::from_env();
        cache::refresh_summary(&ctx, None).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("trigger_scan task panicked: {e}"))?
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

// TODO(prd-2.0 §6.1 I7): frontend caller arrives with the data-drawer 年轮 tab;
// until then this is read-only plumbing exercised by loadRings() in
// web/data-source.js.
#[tauri::command]
pub async fn garden_rings() -> Result<RingBook, String> {
    tokio::task::spawn_blocking(|| {
        let path = rings::default_rings_path();
        rings::load(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("garden_rings task panicked: {e}"))?
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

/// Open `path` in the user's configured terminal (tray row / insight panel
/// click). Thin shim: reads settings, delegates the platform-specific spawn to
/// `terminal::open`. The path comes from `ProjectGrowth.project_path`; an empty
/// path is rejected rather than opening a terminal at an unknown location.
#[tauri::command]
pub async fn open_in_terminal(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let settings_path = settings::default_settings_path();
        let settings = settings::load(&settings_path).map_err(|e| e.to_string())?;
        crate::terminal::open(&settings.integrations, &path)
    })
    .await
    .map_err(|e| format!("open_in_terminal task panicked: {e}"))?
}

/// Save a generated PNG postcard to a user-chosen path. The frontend provides
/// the already-rendered bytes; this command only owns the native save dialog
/// and the final write.
#[tauri::command]
pub async fn save_postcard(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    suggested_name: String,
) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let Some(file_path) = app
            .dialog()
            .file()
            .set_file_name(suggested_name)
            .add_filter("PNG", &["png"])
            .blocking_save_file()
        else {
            return Ok(false);
        };

        let mut path = file_path
            .into_path()
            .map_err(|e| format!("save dialog returned a non-file path: {e}"))?;
        if path.extension().is_none() {
            path.set_extension("png");
        }
        std::fs::write(&path, bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
        Ok(true)
    })
    .await
    .map_err(|e| format!("save_postcard task panicked: {e}"))?
}
