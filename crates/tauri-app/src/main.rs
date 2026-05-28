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
mod watcher;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::garden_summary,
            commands::trigger_scan,
            commands::list_adapters,
            commands::data_freshness,
        ])
        .setup(|app| {
            // Kick off the file watcher in its own thread. It will emit
            // `garden:updated` to the frontend whenever an adapter watch path
            // changes (debounced — see watcher.rs).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(err) = watcher::run(handle) {
                    eprintln!("[watcher] failed to start: {err}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
