//! File watcher — runs in its own thread, subscribes to every path returned
//! by adapter.watch_paths(), debounces noisy event bursts, and emits a fresh
//! `garden:updated` to the frontend on change.
//!
//! Modularity contract (spec §10 rule #4): this module is adapter-logic
//! agnostic. It receives `Vec<PathBuf>` from the core registry and emits
//! "something changed → here's the new summary". It does NOT parse change
//! payloads itself.

use crate::events::{ErrorPayload, GARDEN_ERROR, GARDEN_UPDATED};
use local_agent_garden_core::adapter::AdapterContext;
use local_agent_garden_core::aggregate;
use local_agent_garden_core::registry;
use local_agent_garden_core::scan;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const DEBOUNCE_MS: u64 = 800;

pub fn run(app: AppHandle) -> Result<(), String> {
    let ctx = AdapterContext::from_env();

    // 1. Collect every path every active adapter cares about.
    let mut watch_paths = Vec::new();
    for adapter in registry::default_adapters() {
        watch_paths.extend(adapter.watch_paths(&ctx));
    }
    if watch_paths.is_empty() {
        eprintln!("[watcher] no adapter watch paths — running in static mode");
        return Ok(());
    }

    // 2. Wire the OS watcher to a synchronous channel. We don't need async
    //    here; the channel naturally serializes events, the debounce loop
    //    reads them off in batches.
    //
    // NOTE: we forward EVERY event kind here, including `Access` and `Other`.
    // macOS FSEvents reports mtime-only changes (what `touch` produces) as
    // `Other` or `Modify::Metadata`, both of which we were silently dropping
    // before — meaning `touch` correctly fired the OS event but our filter
    // ate it. Better to over-trigger and rely on the 800ms debounce than
    // miss real activity.
    let (tx, rx): (Sender<notify::Event>, Receiver<notify::Event>) = channel();
    let mut watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            match res {
                Ok(ev) => {
                    // Debug only — set AGENT_GARDEN_DEBUG=1 to see every fs event.
                    if std::env::var_os("AGENT_GARDEN_DEBUG").is_some() {
                        eprintln!("[watcher] event: kind={:?} paths={:?}", ev.kind, ev.paths);
                    }
                    let _ = tx.send(ev);
                }
                Err(err) => eprintln!("[watcher] notify error: {err}"),
            }
        })
        .map_err(|e| format!("create watcher: {e}"))?;

    for path in &watch_paths {
        if !path.exists() {
            continue;
        }
        let mode = if path.is_dir() {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        if let Err(err) = watcher.watch(path, mode) {
            eprintln!("[watcher] watch({}) failed: {err}", path.display());
        } else {
            eprintln!("[watcher] watching {}", path.display());
        }
    }

    // 3. Debounce loop. Each batch starts with one event, then drains the
    //    channel for DEBOUNCE_MS before triggering a rescan. Subsequent
    //    events that arrive during the wait are absorbed into the same
    //    batch, so a noisy editor or a multi-file save → exactly one rescan.
    let debug = std::env::var_os("AGENT_GARDEN_DEBUG").is_some();
    loop {
        // Block until at least one event arrives.
        let Ok(_first) = rx.recv() else {
            // Sender dropped → watcher gone, exit cleanly.
            return Ok(());
        };
        debounce_drain(&rx, Duration::from_millis(DEBOUNCE_MS));

        match run_summary_blocking() {
            Ok(summary) => {
                let active = summary.active_projects;
                let tokens = summary.total_tokens;
                match app.emit(GARDEN_UPDATED, &summary) {
                    Ok(()) => {
                        if debug {
                            eprintln!(
                                "[watcher] emitted garden:updated (active_projects={active}, total_tokens={tokens})"
                            );
                        }
                    }
                    Err(err) => eprintln!("[watcher] emit failed: {err}"),
                }
            }
            Err(err) => {
                eprintln!("[watcher] scan failed: {err}");
                // Surface the failure to the frontend toast — the watcher
                // path is silent otherwise and the user would just see stale
                // data with no hint that the rescan didn't happen.
                let payload = ErrorPayload::new("watcher", err);
                if let Err(emit_err) = app.emit(GARDEN_ERROR, &payload) {
                    eprintln!("[watcher] emit error event failed: {emit_err}");
                }
            }
        }
    }
}

/// Drain everything that arrives within `window` of the call. Implemented
/// with a deadline rather than fixed sleep so a steady stream of events
/// doesn't extend the wait forever.
fn debounce_drain(rx: &Receiver<notify::Event>, window: Duration) {
    let deadline = Instant::now() + window;
    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(remaining) {
            Ok(_) => continue, // absorb and keep waiting
            Err(_) => return,
        }
    }
}

fn run_summary_blocking() -> Result<aggregate::GardenSummary, String> {
    let ctx = AdapterContext::from_env();
    let result = scan::collect_events(&ctx, None).map_err(|e| e.to_string())?;
    Ok(aggregate::summarize(&result.events))
}

// Keep `RecommendedWatcher` type referenced for clarity in docs. Without
// this, rustdoc strips the import.
#[allow(dead_code)]
type _W = RecommendedWatcher;

// NOTE: the watcher MUST be kept alive while we want to receive events.
// `notify::recommended_watcher` returns the watcher; dropping it stops the
// callbacks. Since `run()` loops forever (or until the channel closes), the
// watcher local stays alive for the whole app lifetime. Wired implicitly.
