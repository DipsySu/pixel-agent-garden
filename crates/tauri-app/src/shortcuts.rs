//! Optional global hotkey for `settings.shortcuts` (desktop only).
//!
//! Narrow shell (spec §10 rule 3): it reads the already-loaded `Shortcuts`,
//! reconciles OS hotkey registration to it, and delegates the actual window
//! show/hide to [`crate::tray::toggle_main_window`]. Core never touches the OS;
//! this module is the ONLY place that talks to the global-shortcut plugin.
//!
//! Product posture: nothing is registered unless the user sets an accelerator
//! (an empty string means disabled, which is the default). A global hotkey
//! occupies the OS-wide namespace and can clash with other apps, so a failed or
//! unparseable registration is surfaced as a `garden:error` toast (source
//! `shortcut`) rather than swallowed — the user can then rebind or turn it off.
//!
//! A toggle must be a GLOBAL hotkey: an in-app key can't reach a hidden window
//! to summon it back. Registering from Rust (not the webview) needs no ACL
//! capability — capabilities gate IPC commands, which this feature never uses.

use crate::events::{ErrorPayload, GARDEN_ERROR};
use local_agent_garden_core::settings::Shortcuts;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Plugin handler wired once at build time. It fires for every registered
/// shortcut; we only ever register `toggle_window`, so a key-DOWN always means
/// "toggle the window". (If more actions are added later, match on `shortcut`.)
pub fn on_shortcut<R: Runtime>(
    app: &AppHandle<R>,
    _shortcut: &Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    // Fire on press only: some platforms deliver both press and release, and a
    // toggle must flip once per keystroke, not twice.
    if event.state() == ShortcutState::Pressed {
        crate::tray::toggle_main_window(app);
    }
}

/// Re-register the global hotkey to match `shortcuts`. Called at startup and
/// after every settings save (mirrors [`crate::autostart::reconcile`]): the
/// settings file is the source of truth, OS registration is reconciled to it.
///
/// Clears our previous registration first, then registers the current
/// accelerator if non-empty. An empty accelerator leaves nothing registered
/// (disabled). Failures are reported, never fatal — the garden stays usable.
pub fn reconcile<R: Runtime>(app: &AppHandle<R>, shortcuts: &Shortcuts) {
    let manager = app.global_shortcut();
    // We manage exactly one hotkey, so clearing all is the simplest correct
    // "drop the previous binding" and can never leak a stale registration.
    if let Err(err) = manager.unregister_all() {
        eprintln!("[shortcuts] unregister_all failed: {err}");
    }

    let accel = shortcuts.toggle_window.trim();
    if accel.is_empty() {
        return; // disabled — the default posture
    }

    match accel.parse::<Shortcut>() {
        Ok(shortcut) => {
            if let Err(err) = manager.register(shortcut) {
                emit_failure(app, accel, &err.to_string());
            }
        }
        Err(err) => emit_failure(app, accel, &err.to_string()),
    }
}

/// Surface a registration failure to the frontend toast. The message is
/// localized here (native/system-locale layer) because it originates below the
/// webview, matching how the tray builds its bilingual copy via `tray::tr`.
fn emit_failure<R: Runtime>(app: &AppHandle<R>, accel: &str, detail: &str) {
    eprintln!("[shortcuts] register {accel:?} failed: {detail}");
    let message = crate::tray::tr(
        "Shortcut registration failed — it may already be in use by another app. Pick a different combination in Settings.",
        "快捷键注册失败,可能已被其它应用占用。请在设置里换一个组合。",
    );
    let payload = ErrorPayload::new("shortcut", message);
    if let Err(emit_err) = app.emit(GARDEN_ERROR, &payload) {
        eprintln!("[shortcuts] emit error event failed: {emit_err}");
    }
}
