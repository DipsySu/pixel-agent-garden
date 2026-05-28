//! Event names emitted from Rust → frontend. Centralized here so the
//! constants are the only place a typo could happen.

/// Emitted whenever a scan completes successfully with new data.
/// Payload: `GardenSummary`.
pub const GARDEN_UPDATED: &str = "garden:updated";

/// Emitted while a scan is running. Lets the frontend show a spinner if
/// the rescan ever takes long enough to be noticeable.
/// Payload: `{ "adapter": null | "claude-code" | "codex" }`.
#[allow(dead_code)]
pub const GARDEN_SCANNING: &str = "garden:scanning";

/// Emitted when a scan fails.
/// Payload: `{ "message": "...", "adapter": null | "..." }`.
#[allow(dead_code)]
pub const GARDEN_ERROR: &str = "garden:error";
