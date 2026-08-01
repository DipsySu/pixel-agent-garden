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
use local_agent_garden_core::cache;
use local_agent_garden_core::registry;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, sync_channel};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const DEBOUNCE_MS: u64 = 800;
const RECONCILE_SECS: u64 = 5;
const REGISTRATION_RETRY_SECS: u64 = 60;

#[derive(Clone, Debug, Eq, PartialEq)]
struct WatchTarget {
    path: PathBuf,
    recursive: bool,
}

pub fn run(app: AppHandle) -> Result<(), String> {
    let ctx = AdapterContext::from_env();
    let initial_targets = collect_watch_targets(&ctx);

    // 2. Wire the OS watcher to a one-slot dirty signal. The consumer performs
    //    a blocking scan, so retaining every filesystem event would let an
    //    active agent grow an unbounded queue while that scan runs. One pending
    //    signal is enough: it means "something changed; scan once more".
    //
    // NOTE: we forward EVERY event kind here, including `Access` and `Other`.
    // macOS FSEvents reports mtime-only changes (what `touch` produces) as
    // `Other` or `Modify::Metadata`, both of which we were silently dropping
    // before — meaning `touch` correctly fired the OS event but our filter
    // ate it. Better to over-trigger and rely on the 800ms debounce than
    // miss real activity.
    let (tx, rx): (SyncSender<()>, Receiver<()>) = sync_channel(1);
    let error_app = app.clone();
    let callback_targets = Arc::new(RwLock::new(initial_targets.clone()));
    let event_targets = Arc::clone(&callback_targets);
    let mut watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            match res {
                Ok(ev) => {
                    // A target file such as `opencode.db-wal` may not exist
                    // when the app starts. We register its nearest existing
                    // parent, then filter here to the exact requested target.
                    // Sibling credentials therefore never trigger a scan or
                    // enter debug logs.
                    let Ok(targets) = event_targets.read() else {
                        return;
                    };
                    if !event_paths_match(&ev.paths, &targets) {
                        return;
                    }
                    // Debug only — set AGENT_GARDEN_DEBUG=1 to see every fs event.
                    if std::env::var_os("AGENT_GARDEN_DEBUG").is_some() {
                        eprintln!("[watcher] event: kind={:?} paths={:?}", ev.kind, ev.paths);
                    }
                    mark_dirty(&tx);
                }
                Err(err) => {
                    eprintln!("[watcher] notify error: {err}");
                    emit_watcher_error(&error_app, format!("notify error: {err}"));
                }
            }
        })
        .map_err(|e| format!("create watcher: {e}"))?;

    let mut registrations = BTreeMap::new();
    let mut failed_registrations = BTreeMap::new();
    apply_registrations(
        &mut watcher,
        &mut registrations,
        &mut failed_registrations,
        watch_registrations(&initial_targets),
        &app,
    );

    // 3. Debounce loop. Each batch starts with one event, then drains the
    //    channel for DEBOUNCE_MS before triggering a rescan. Subsequent
    //    events that arrive during the wait are absorbed into the same
    //    batch, so a noisy editor or a multi-file save → exactly one rescan.
    let debug = std::env::var_os("AGENT_GARDEN_DEBUG").is_some();
    loop {
        // Periodic reconciliation is required even with no registrations: an
        // adapter root or an enumerated session DB can appear after launch.
        let should_scan = match rx.recv_timeout(Duration::from_secs(RECONCILE_SECS)) {
            Ok(_) => {
                debounce_drain(&rx, Duration::from_millis(DEBOUNCE_MS));
                true
            }
            Err(RecvTimeoutError::Timeout) => false,
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        };

        let new_targets = collect_watch_targets(&ctx);
        let targets_changed = callback_targets
            .read()
            .map(|targets| *targets != new_targets)
            .unwrap_or(true);
        let desired_registrations = watch_registrations(&new_targets);
        let registrations_changed = registrations
            != desired_registrations
                .iter()
                .cloned()
                .collect::<BTreeMap<_, _>>();
        if targets_changed || registrations_changed {
            apply_registrations(
                &mut watcher,
                &mut registrations,
                &mut failed_registrations,
                desired_registrations,
                &app,
            );
            if let Ok(mut targets) = callback_targets.write() {
                *targets = new_targets;
            }
        }

        if !refresh_required(should_scan, targets_changed) {
            continue;
        }

        if let Err(err) = app.emit(GARDEN_SCANNING, &ScanningPayload { adapter: None }) {
            eprintln!("[watcher] emit scanning failed: {err}");
        }

        match run_incremental_summary_blocking() {
            Ok(refresh) => {
                for failure in &refresh.failures {
                    emit_adapter_error(&app, "watcher", failure);
                }
                let summary = refresh.summary;
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

        // A successful scan may reveal new enumerated targets immediately;
        // do not wait for the next polling interval to register them.
        let new_targets = collect_watch_targets(&ctx);
        let targets_changed = callback_targets
            .read()
            .map(|targets| *targets != new_targets)
            .unwrap_or(true);
        let desired_registrations = watch_registrations(&new_targets);
        let registrations_changed = registrations
            != desired_registrations
                .iter()
                .cloned()
                .collect::<BTreeMap<_, _>>();
        if targets_changed || registrations_changed {
            apply_registrations(
                &mut watcher,
                &mut registrations,
                &mut failed_registrations,
                desired_registrations,
                &app,
            );
            if let Ok(mut targets) = callback_targets.write() {
                *targets = new_targets;
            }
        }
    }
}

fn collect_watch_targets(ctx: &AdapterContext) -> Vec<WatchTarget> {
    let mut targets = BTreeMap::new();
    for adapter in registry::default_adapters() {
        for path in adapter.watch_paths(ctx) {
            let recursive = path.is_dir();
            targets
                .entry(path)
                .and_modify(|value| *value |= recursive)
                .or_insert(recursive);
        }
    }
    targets
        .into_iter()
        .map(|(path, recursive)| WatchTarget { path, recursive })
        .collect()
}

fn apply_registrations(
    watcher: &mut RecommendedWatcher,
    current: &mut BTreeMap<PathBuf, bool>,
    failed: &mut BTreeMap<PathBuf, Instant>,
    desired: Vec<(PathBuf, bool)>,
    app: &AppHandle,
) {
    let desired = desired.into_iter().collect::<BTreeMap<_, _>>();

    for path in current
        .keys()
        .filter(|path| desired.get(*path) != current.get(*path))
        .cloned()
        .collect::<Vec<_>>()
    {
        if let Err(err) = watcher.unwatch(&path) {
            eprintln!("[watcher] unwatch({}) failed: {err}", path.display());
            failed.insert(path.clone(), Instant::now());
            continue;
        }
        current.remove(&path);
        failed.remove(&path);
    }

    for (path, recursive) in &desired {
        if current.get(path) == Some(recursive) {
            continue;
        }
        if failed
            .get(path)
            .is_some_and(|last| last.elapsed() < Duration::from_secs(REGISTRATION_RETRY_SECS))
        {
            continue;
        }
        let mode = if *recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        if let Err(err) = watcher.watch(path, mode) {
            eprintln!("[watcher] watch({}) failed: {err}", path.display());
            emit_watcher_error(app, format!("watch {} failed: {err}", path.display()));
            failed.insert(path.clone(), Instant::now());
        } else {
            eprintln!("[watcher] watching {}", path.display());
            current.insert(path.clone(), *recursive);
            failed.remove(path);
        }
    }
    failed.retain(|path, _| desired.contains_key(path));
}

/// Build the smallest OS-level registrations that cover all logical targets.
/// A missing leaf may use its direct existing parent. If two or more path
/// components are absent, do not recursively watch a broad ancestor (which
/// could be the entire home directory); the periodic coordinator will discover
/// the new path within `RECONCILE_SECS` and register the narrow target then.
fn watch_registrations(targets: &[WatchTarget]) -> Vec<(PathBuf, bool)> {
    let mut registrations: BTreeMap<PathBuf, bool> = BTreeMap::new();
    for target in targets {
        let registration = if target.path.exists() {
            target.path.clone()
        } else {
            nearest_existing_parent(&target.path).unwrap_or_else(|| target.path.clone())
        };
        let recursive = target.path.exists() && target.recursive;
        if !target.path.exists()
            && target
                .path
                .strip_prefix(&registration)
                .map(|remaining| remaining.components().count() > 1)
                .unwrap_or(true)
        {
            continue;
        }
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
            changed == &target.path
                || (target.recursive && changed.starts_with(&target.path))
                || target.path.starts_with(changed)
        })
    })
}

fn emit_watcher_error(app: &AppHandle, message: impl Into<String>) {
    let payload = ErrorPayload::new("watcher", message);
    if let Err(emit_err) = app.emit(GARDEN_ERROR, &payload) {
        eprintln!("[watcher] emit error event failed: {emit_err}");
    }
}

fn emit_adapter_error(
    app: &AppHandle,
    source: &'static str,
    failure: &local_agent_garden_core::scan::AdapterFailure,
) {
    let payload = ErrorPayload {
        source,
        message: failure.message.clone(),
        adapter: Some(failure.adapter.clone()),
    };
    if let Err(emit_err) = app.emit(GARDEN_ERROR, &payload) {
        eprintln!("[watcher] emit adapter error event failed: {emit_err}");
    }
}

fn mark_dirty(tx: &SyncSender<()>) {
    let _ = tx.try_send(());
}

fn refresh_required(dirty: bool, targets_changed: bool) -> bool {
    dirty || targets_changed
}

/// Drain everything that arrives within `window` of the call. Implemented
/// with a deadline rather than fixed sleep so a steady stream of events
/// doesn't extend the wait forever.
fn debounce_drain(rx: &Receiver<()>, window: Duration) {
    let deadline = Instant::now() + window;
    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(remaining) {
            Ok(_) => continue, // absorb and keep waiting
            Err(_) => return,
        }
    }
}

pub(crate) fn run_summary_blocking() -> Result<cache::RefreshResult, String> {
    let ctx = AdapterContext::from_env();
    cache::refresh_summary_with_failures(&ctx, None).map_err(|e| e.to_string())
}

fn run_incremental_summary_blocking() -> Result<cache::RefreshResult, String> {
    let ctx = AdapterContext::from_env();
    cache::summary_from_cache_or_scan_throttled_with_failures(&ctx, None).map_err(|e| e.to_string())
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
    use std::sync::mpsc::TryRecvError;

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

    #[test]
    fn deeply_missing_target_waits_for_reconcile_instead_of_watching_broad_ancestor() {
        let root = std::env::temp_dir().join(format!("lag-watcher-nested-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let intermediate = root.join("level-one");
        let database = intermediate.join("level-two/session.db");
        let targets = vec![WatchTarget {
            path: database.clone(),
            recursive: false,
        }];

        assert!(watch_registrations(&targets).is_empty());
        assert!(event_paths_match(
            std::slice::from_ref(&intermediate),
            &targets
        ));
        assert!(event_paths_match(&[database], &targets));
        assert!(!event_paths_match(&[root.join("auth.json")], &targets));

        std::fs::create_dir_all(intermediate.join("level-two")).unwrap();
        assert_eq!(
            watch_registrations(&targets),
            vec![(intermediate.join("level-two"), false)]
        );
        std::fs::write(&targets[0].path, b"db").unwrap();
        assert_eq!(
            watch_registrations(&targets),
            vec![(targets[0].path.clone(), false)]
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn dirty_signal_coalesces_while_consumer_is_busy() {
        let (tx, rx) = sync_channel(1);
        for _ in 0..100 {
            mark_dirty(&tx);
        }

        assert_eq!(rx.try_recv(), Ok(()));
        assert_eq!(rx.try_recv(), Err(TryRecvError::Empty));
    }

    #[test]
    fn registration_mismatch_alone_does_not_request_scan() {
        assert!(!refresh_required(false, false));
        assert!(refresh_required(true, false));
        assert!(refresh_required(false, true));
    }
}
