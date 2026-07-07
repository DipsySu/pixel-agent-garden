//! OS login-item reconciliation for `desktop.launch_at_login`.
//!
//! settings.toml is the single source of truth; the OS login item is a
//! projection of it. We **reconcile** (converge OS state toward the setting)
//! rather than toggle on UI clicks because the two sides drift: a reinstall
//! or manual `~/Library` cleanup drops the LaunchAgent while settings still
//! say "on", and an uninstall can strand a stale login item after a fresh
//! settings.toml defaults to "off". Reconciling at startup and after every
//! settings save heals both directions without any extra bookkeeping.
//!
//! Failures are logged to stderr with the `[autostart]` prefix (same pattern
//! as `[tray]` / `[watcher]`) and never abort the caller — a garden that
//! cannot register a login item must still open.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// Converge the OS login item to `enabled`.
///
/// Reads the current OS state first so agreement stays a no-op: this runs on
/// every settings save (debounced UI writes included), and skipping redundant
/// plist / registry mutations keeps those saves cheap and side-effect free.
pub fn reconcile(app: &AppHandle, enabled: bool) {
    let autolaunch = app.autolaunch();
    match autolaunch.is_enabled() {
        Ok(current) if current == enabled => return,
        Ok(_) => {}
        // Unreadable OS state: fall through and write anyway — the write is
        // idempotent and is our best remaining shot at convergence.
        Err(err) => eprintln!("[autostart] is_enabled failed: {err}"),
    }
    let result = if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    if let Err(err) = result {
        let verb = if enabled { "enable" } else { "disable" };
        eprintln!("[autostart] {verb} login item failed: {err}");
    }
}
