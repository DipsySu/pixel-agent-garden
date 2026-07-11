//! File watcher — runs in its own thread, subscribes to every path returned
//! by adapter.watch_paths(), debounces noisy event bursts, and emits a fresh
//! `garden:updated` to the frontend on change.
//!
//! Modularity contract (spec §10 rule #4): this module is adapter-logic
//! agnostic. It receives `Vec<PathBuf>` from the core registry and emits
//! "something changed → here's the new summary". It does NOT parse change
//! payloads itself.

use crate::events::{ErrorPayload, GARDEN_ERROR, GARDEN_SCANNING, GARDEN_UPDATED, ScanningPayload};
use local_agent_garden_core::adapter::AdapterContext;
use local_agent_garden_core::aggregate::GardenSummary;
use local_agent_garden_core::cache;
use local_agent_garden_core::registry;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const DEBOUNCE_MS: u64 = 800;

#[derive(Clone, Debug)]
struct WatchTarget {
    path: PathBuf,
    recursive: bool,
}

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
    let targets = watch_paths
        .iter()
        .map(|path| WatchTarget {
            path: path.clone(),
            recursive: path.is_dir(),
        })
        .collect::<Vec<_>>();
    let registrations = watch_registrations(&targets);

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
    let error_app = app.clone();
    let callback_targets = targets.clone();
    let mut watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            match res {
                Ok(ev) => {
                    // A target file such as `opencode.db-wal` may not exist
                    // when the app starts. We register its nearest existing
                    // parent, then filter here to the exact requested target.
                    // Sibling credentials therefore never trigger a scan or
                    // enter debug logs.
                    if !event_paths_match(&ev.paths, &callback_targets) {
                        return;
                    }
                    // Debug only — set AGENT_GARDEN_DEBUG=1 to see every fs event.
                    if std::env::var_os("AGENT_GARDEN_DEBUG").is_some() {
                        eprintln!("[watcher] event: kind={:?} paths={:?}", ev.kind, ev.paths);
                    }
                    let _ = tx.send(ev);
                }
                Err(err) => {
                    eprintln!("[watcher] notify error: {err}");
                    emit_watcher_error(&error_app, format!("notify error: {err}"));
                }
            }
        })
        .map_err(|e| format!("create watcher: {e}"))?;

    for (path, recursive) in &registrations {
        let mode = if *recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        if let Err(err) = watcher.watch(path, mode) {
            eprintln!("[watcher] watch({}) failed: {err}", path.display());
            emit_watcher_error(&app, format!("watch {} failed: {err}", path.display()));
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

        if let Err(err) = app.emit(GARDEN_SCANNING, &ScanningPayload { adapter: None }) {
            eprintln!("[watcher] emit scanning failed: {err}");
        }

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
                emit_watcher_error(&app, err);
            }
        }
    }
}

/// Build the smallest OS-level registrations that cover all logical targets.
/// Missing leaf files use a non-recursive parent registration so their later
/// creation is observable; callback filtering keeps unrelated siblings out.
fn watch_registrations(targets: &[WatchTarget]) -> Vec<(PathBuf, bool)> {
    let mut registrations: BTreeMap<PathBuf, bool> = BTreeMap::new();
    for target in targets {
        let registration = if target.path.exists() {
            target.path.clone()
        } else {
            nearest_existing_parent(&target.path).unwrap_or_else(|| target.path.clone())
        };
        let recursive = target.path.exists() && target.recursive;
        registrations
            .entry(registration)
            .and_modify(|value| *value |= recursive)
            .or_insert(recursive);
    }
    registrations.into_iter().collect()
}

fn nearest_existing_parent(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .skip(1)
        .find(|ancestor| ancestor.exists())
        .map(Path::to_path_buf)
}

fn event_paths_match(paths: &[PathBuf], targets: &[WatchTarget]) -> bool {
    paths.iter().any(|changed| {
        targets.iter().any(|target| {
            changed == &target.path || (target.recursive && changed.starts_with(&target.path))
        })
    })
}

fn emit_watcher_error(app: &AppHandle, message: impl Into<String>) {
    let payload = ErrorPayload::new("watcher", message);
    if let Err(emit_err) = app.emit(GARDEN_ERROR, &payload) {
        eprintln!("[watcher] emit error event failed: {emit_err}");
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

pub(crate) fn run_summary_blocking() -> Result<GardenSummary, String> {
    let ctx = AdapterContext::from_env();
    cache::refresh_summary(&ctx, None).map_err(|e| e.to_string())
}

// Keep `RecommendedWatcher` type referenced for clarity in docs. Without
// this, rustdoc strips the import.
#[allow(dead_code)]
type _W = RecommendedWatcher;

// NOTE: the watcher MUST be kept alive while we want to receive events.
// `notify::recommended_watcher` returns the watcher; dropping it stops the
// callbacks. Since `run()` loops forever (or until the channel closes), the
// watcher local stays alive for the whole app lifetime. Wired implicitly.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_wal_uses_parent_but_filters_credential_siblings() {
        let root =
            std::env::temp_dir().join(format!("lag-watcher-missing-wal-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let wal = root.join("opencode.db-wal");
        let targets = vec![WatchTarget {
            path: wal.clone(),
            recursive: false,
        }];

        assert_eq!(watch_registrations(&targets), vec![(root.clone(), false)]);
        assert!(event_paths_match(std::slice::from_ref(&wal), &targets));
        assert!(!event_paths_match(&[root.join("auth.json")], &targets));
        assert!(!event_paths_match(&[root.join("mcp-auth.json")], &targets));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn directory_target_matches_descendants_only() {
        let root = PathBuf::from("/tmp/example-storage");
        let targets = vec![WatchTarget {
            path: root.clone(),
            recursive: true,
        }];
        assert!(event_paths_match(&[root.join("message/a.json")], &targets));
        assert!(!event_paths_match(
            &[PathBuf::from("/tmp/auth.json")],
            &targets
        ));
    }
}
