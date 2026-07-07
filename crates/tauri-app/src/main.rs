// Tauri 2.x bootstrap. The actual work lives in:
//   - commands.rs : #[tauri::command] handlers that delegate to core
//   - watcher.rs  : notify-based file watcher → garden:updated events
// This file just stitches them together.
//
// Modularity contract (spec §10): NOTHING here touches agent-specific
// parsing. All adapter logic lives in `local_agent_garden_core`.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod events;
mod terminal;
mod tray;
mod watcher;

use crate::events::{ErrorPayload, GARDEN_ERROR};
use tauri::{Emitter, Manager};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(tray::build_app_menu)
        .on_menu_event(tray::handle_menu_event)
        .on_window_event(tray::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::garden_summary,
            commands::trigger_scan,
            commands::garden_rings,
            commands::list_adapters,
            commands::data_freshness,
            commands::get_settings,
            commands::set_settings,
            commands::open_in_terminal,
            commands::save_postcard,
        ])
        .setup(|app| {
            tray::setup(app)?;
            if let Some(window) = app.get_webview_window(tray::WINDOW_LABEL) {
                window.set_decorations(false)?;
            }

            // Kick off the file watcher in its own thread. It will emit
            // `garden:updated` to the frontend whenever an adapter watch path
            // changes (debounced — see watcher.rs).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(err) = watcher::run(handle.clone()) {
                    eprintln!("[watcher] failed to start: {err}");
                    let payload =
                        ErrorPayload::new("watcher", format!("watcher startup failed: {err}"));
                    if let Err(emit_err) = handle.emit(GARDEN_ERROR, &payload) {
                        eprintln!("[watcher] emit startup error event failed: {emit_err}");
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
