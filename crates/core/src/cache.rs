//! Cached garden summary helpers.
//!
//! Tauri and other long-lived shells should start from the persisted
//! `events.json` cache when possible, then refresh it through the normal scan
//! path when the cache is absent, unreadable, or **stale** relative to the
//! agent logs on disk.
//!
//! Staleness is decided by a source fingerprint (total bytes + newest mtime +
//! file count across every adapter's `watch_paths()`), compared metadata-only —
//! no source file is re-parsed just to answer "is the cache current?". This is
//! the orchestration layer, so computing the fingerprint (which walks adapter
//! paths) lives here, not in `storage` (adapter-agnostic) or in any single
//! adapter (spec §10).

use crate::adapter::AdapterContext;
use crate::aggregate::{self, GardenSummary};
use crate::error::Error;
use crate::registry;
use crate::rings;
use crate::storage::SourceFingerprint;
use crate::{scan, storage};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug)]
pub struct RefreshResult {
    pub summary: GardenSummary,
    pub failures: Vec<scan::AdapterFailure>,
}

/// Default event cache path — `~/.local-agent-garden/events.json`.
pub fn default_events_path() -> PathBuf {
    storage::default_state_dir().join("events.json")
}

/// Load a cached summary when it's still fresh. The cache is used only when it
/// loads, carries a fingerprint, and that fingerprint matches the current
/// source files. Otherwise (missing / malformed / future-schema / no
/// fingerprint / sources changed) a fresh scan runs and replaces it.
pub fn summary_from_cache_or_scan(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
) -> Result<GardenSummary, Error> {
    Ok(summary_from_cache_or_scan_with_failures(ctx, sources_filter)?.summary)
}

pub fn summary_from_cache_or_scan_with_failures(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
) -> Result<RefreshResult, Error> {
    summary_from_cache_or_scan_at_with_failures(ctx, sources_filter, &default_events_path())
}

/// Same as `summary_from_cache_or_scan`, but lets tests or callers pin the
/// cache path.
pub fn summary_from_cache_or_scan_at(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    cache_path: &Path,
) -> Result<GardenSummary, Error> {
    Ok(summary_from_cache_or_scan_at_with_failures(ctx, sources_filter, cache_path)?.summary)
}

pub fn summary_from_cache_or_scan_at_with_failures(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    cache_path: &Path,
) -> Result<RefreshResult, Error> {
    if let Ok(cache) = storage::load_cache(cache_path) {
        // Only trust the cache if it carries a fingerprint AND that fingerprint
        // still matches the source files. A `None` fingerprint (legacy cache or
        // CLI export) is treated as stale → refresh once.
        if let Some(stored) = cache.fingerprint {
            if stored == source_fingerprint(ctx) {
                // Apply the caller's source filter to the cached view. The cache
                // always holds the FULL event set (see refresh_summary_at), so a
                // filtered request narrows it here instead of being ignored.
                let summary = summarize_filtered(&cache.events, sources_filter);
                return Ok(RefreshResult {
                    summary: rings::record_summary_best_effort(
                        summary,
                        &rings::path_for_events_cache(cache_path),
                        chrono::Utc::now(),
                    ),
                    failures: Vec::new(),
                });
            }
        }
    }
    refresh_summary_at_with_failures(ctx, sources_filter, cache_path)
}

/// Force a scan, persist the normalized event cache (with a fresh fingerprint),
/// and return the summary.
pub fn refresh_summary(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
) -> Result<GardenSummary, Error> {
    Ok(refresh_summary_with_failures(ctx, sources_filter)?.summary)
}

/// Force a scan while retaining adapter-local diagnostics for interactive
/// shells. Healthy adapters still refresh when one source is unreadable.
pub fn refresh_summary_with_failures(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
) -> Result<RefreshResult, Error> {
    refresh_summary_at_with_failures(ctx, sources_filter, &default_events_path())
}

/// Same as `refresh_summary`, but lets tests or callers pin the cache path.
pub fn refresh_summary_at(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    cache_path: &Path,
) -> Result<GardenSummary, Error> {
    Ok(refresh_summary_at_with_failures(ctx, sources_filter, cache_path)?.summary)
}

pub fn refresh_summary_at_with_failures(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    cache_path: &Path,
) -> Result<RefreshResult, Error> {
    // Fingerprint BEFORE scanning: if a source changes mid-scan, the stored
    // fingerprint will be slightly older than the data, so the next read sees
    // "newer source → stale" and refreshes again. That errs toward an extra
    // refresh, never toward serving stale data.
    //
    // NOTE: this metadata walk re-traverses the same tree the scan below
    // re-enumerates and parses. The redundancy is deliberate — the pre-scan
    // ordering is the safety property above, and the stat walk is orders of
    // magnitude cheaper than the parse. Do NOT "optimize" it by fingerprinting
    // after the scan: that reopens the staleness window.
    let fingerprint = source_fingerprint(ctx);
    // Scan the FULL set and persist that: there is one shared events.json and
    // the fingerprint is filter-independent, so writing a filtered subset would
    // be served whole to later unfiltered reads (cache pollution). A filtered
    // request stays a transient view computed from the full scan.
    let mut result = scan::collect_events(ctx, None)?;
    let stored_fingerprint = if result.failures.is_empty() {
        Some(fingerprint)
    } else {
        // Preserve the last known partition for failed adapters while healthy
        // adapters refresh. A missing fingerprint deliberately keeps this
        // cache stale so the next read retries the failed source.
        if let Ok(cache) = storage::load_cache(cache_path) {
            let failed = result
                .failures
                .iter()
                .map(|failure| failure.adapter.as_str())
                .collect::<HashSet<_>>();
            result.events.extend(
                cache
                    .events
                    .into_iter()
                    .filter(|event| failed.contains(event.source.as_str())),
            );
        }
        None
    };
    // A manual JSONL row may intentionally use the same source name as a
    // native adapter. When that native adapter fails, its retained cache
    // partition can therefore overlap freshly scanned manual rows. Re-run the
    // canonical cross-source dedupe after merging so partial recovery never
    // double-counts an identical logical event.
    result.events = scan::dedupe_events(result.events);
    storage::save_events_with_fingerprint(&result.events, stored_fingerprint, cache_path)?;
    let summary = summarize_filtered(&result.events, sources_filter);
    Ok(RefreshResult {
        summary: rings::record_summary_best_effort(
            summary,
            &rings::path_for_events_cache(cache_path),
            chrono::Utc::now(),
        ),
        failures: result.failures,
    })
}

/// Summarize `events`, optionally narrowed to a set of source (adapter) names.
/// The names match `AgentEvent.source` against the same adapter names
/// `scan::collect_events` filters on, so a cached (full) event set and a fresh
/// filtered scan agree.
fn summarize_filtered(
    events: &[crate::event::AgentEvent],
    sources_filter: Option<&[String]>,
) -> GardenSummary {
    match sources_filter {
        None => aggregate::summarize(events),
        Some(sources) => {
            let filtered: Vec<crate::event::AgentEvent> = events
                .iter()
                .filter(|e| sources.iter().any(|s| s == &e.source))
                .cloned()
                .collect();
            aggregate::summarize(&filtered)
        }
    }
}

/// Fingerprint every source file the active adapters watch: total bytes, newest
/// mtime, and file count (see `SourceFingerprint`). Metadata-only — never opens
/// a file for reading. Missing or unreadable paths are skipped so a half-present
/// source can't crash the read path. An empty environment yields the default
/// (zeroed) fingerprint, which matches a cache scanned from the same empty
/// environment.
///
/// The fingerprint is intentionally **filter-independent**: there is one shared
/// `events.json`, so freshness is judged against all sources regardless of any
/// `sources_filter` a caller passes to the summary/refresh entry points.
pub fn source_fingerprint(ctx: &AdapterContext) -> SourceFingerprint {
    let mut fp = SourceFingerprint::default();
    // Canonical paths of directories already walked — guards against symlink
    // cycles now that we follow symlinks (see `accumulate_path`).
    let mut visited = HashSet::new();
    for adapter in registry::default_adapters() {
        for path in adapter.watch_paths(ctx) {
            accumulate_path(&path, &mut fp, &mut visited);
        }
    }
    fp
}

/// Walk `path` (file or directory) folding total bytes, max mtime, and file
/// count into `fp`. Any I/O error on an entry is silently skipped — a freshness
/// probe must never fail the load.
///
/// Symlinks ARE followed (via `std::fs::metadata`, which resolves them), so the
/// probe sees the same tree the adapters read through `Path::is_dir()` /
/// `read_dir()`. A symlinked source root (e.g. `~/.claude/projects` pointing at
/// another volume) is therefore classified as the directory it targets and
/// walked, instead of being mistaken for a zero-byte file. Following symlinks
/// reintroduces the risk of cycles, so each directory is recorded by its
/// canonical path in `visited` and walked at most once.
fn accumulate_path(path: &Path, fp: &mut SourceFingerprint, visited: &mut HashSet<PathBuf>) {
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    if meta.is_dir() {
        // Cycle guard: only directories can form symlink loops. Skip a dir
        // whose resolved identity we've already counted. canonicalize() failure
        // (rare) falls back to the literal path — still progress, just a weaker
        // dedupe key for that one entry.
        let key = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        if !visited.insert(key) {
            return;
        }
        let Ok(entries) = std::fs::read_dir(path) else {
            return;
        };
        for entry in entries.flatten() {
            accumulate_path(&entry.path(), fp, visited);
        }
    } else if meta.is_file() {
        fp.file_count += 1;
        // Byte length is what makes appends detectable even within one mtime
        // tick. saturating_add so a pathological total can't wrap.
        fp.total_bytes = fp.total_bytes.saturating_add(meta.len());
        if let Ok(modified) = meta.modified() {
            let millis = match modified.duration_since(UNIX_EPOCH) {
                // Saturate instead of wrapping on an absurd far-future mtime:
                // a too-large value should still read as "newer" (→ refresh),
                // never wrap negative and look older.
                Ok(d) => i64::try_from(d.as_millis()).unwrap_or(i64::MAX),
                // mtime before the epoch (clock skew / odd FS) → clamp to 0.
                Err(_) => 0,
            };
            if millis > fp.max_mtime_ms {
                fp.max_mtime_ms = millis;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::AgentEvent;
    use chrono::TimeZone;

    fn tmp_path(suffix: &str) -> PathBuf {
        std::env::temp_dir().join(format!("lag-cache-{}-{}.json", std::process::id(), suffix))
    }

    fn sample_event() -> AgentEvent {
        let mut event = AgentEvent::new(
            "manual-test",
            chrono::Utc.with_ymd_and_hms(2026, 5, 29, 12, 0, 0).unwrap(),
        );
        event.project_path = Some("D:/repo/pixel-agent-garden".to_string());
        event.usage.total_tokens = 42;
        event
    }

    #[test]
    fn cached_hit_applies_sources_filter() {
        // A cache hit must narrow to the requested sources, not return the whole
        // cached set. Two sources cached; filtering to one yields only its
        // tokens, while an unfiltered read still sees both.
        let path = tmp_path("filter");
        let _ = std::fs::remove_file(&path);
        let ctx = AdapterContext::with_home(std::env::temp_dir().join("lag-cache-filter-home"));
        let fp = source_fingerprint(&ctx); // empty env → default {0,0}

        let mut a = AgentEvent::new(
            "manual-test",
            chrono::Utc.with_ymd_and_hms(2026, 5, 29, 12, 0, 0).unwrap(),
        );
        a.usage.total_tokens = 42;
        let mut b = AgentEvent::new(
            "codex",
            chrono::Utc.with_ymd_and_hms(2026, 5, 29, 13, 0, 0).unwrap(),
        );
        b.usage.total_tokens = 100;
        storage::save_events_with_fingerprint(&[a, b], Some(fp), &path).unwrap();

        let filter = ["manual-test".to_string()];
        let only = summary_from_cache_or_scan_at(&ctx, Some(&filter), &path).unwrap();
        assert_eq!(only.total_events, 1);
        assert_eq!(only.total_tokens, 42);

        let all = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();
        assert_eq!(all.total_events, 2);
        assert_eq!(all.total_tokens, 142);

        std::fs::remove_file(rings::path_for_events_cache(&path)).ok();
        std::fs::remove_file(&path).ok();
    }

    /// Write a Claude Code session fixture under `home/.claude/projects/<proj>/`
    /// so the claude-code adapter's `watch_paths` has a real file to fingerprint.
    fn write_session(home: &Path, proj: &str, file: &str, tokens: u64) -> PathBuf {
        let dir = home.join(".claude").join("projects").join(proj);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(file);
        let row = format!(
            r#"{{"timestamp":"2026-05-29T12:00:00Z","type":"assistant","sessionId":"s","message":{{"usage":{{"input_tokens":{tokens},"output_tokens":0}}}}}}"#
        );
        std::fs::write(&path, format!("{row}\n")).unwrap();
        path
    }

    #[test]
    fn fresh_cache_with_matching_fingerprint_is_reused() {
        // A cache whose fingerprint matches the current (empty) sources is used
        // verbatim — no rescan. We prove "reused, not rescanned" by stashing a
        // sentinel event the scan could never produce and seeing it come back.
        let path = tmp_path("fresh");
        let _ = std::fs::remove_file(&path);
        let ctx = AdapterContext::with_home(std::env::temp_dir().join("lag-cache-empty-home"));
        let fp = source_fingerprint(&ctx); // empty env → default {0,0}
        storage::save_events_with_fingerprint(&[sample_event()], Some(fp), &path).unwrap();

        let summary = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();

        assert_eq!(summary.total_events, 1);
        assert_eq!(summary.total_tokens, 42);
        assert_eq!(summary.projects[0].display_name, "pixel-agent-garden");
        assert!(
            rings::path_for_events_cache(&path).exists(),
            "fresh cache hits should seed rings.json from cached events"
        );
        std::fs::remove_file(rings::path_for_events_cache(&path)).ok();
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn corrupt_rings_does_not_block_fresh_cache_summary() {
        let path = tmp_path("corrupt-rings-hit");
        let _ = std::fs::remove_file(&path);
        let rings_path = rings::path_for_events_cache(&path);
        let _ = std::fs::remove_file(&rings_path);
        let ctx = AdapterContext::with_home(
            std::env::temp_dir().join(format!("lag-cache-corrupt-hit-home-{}", std::process::id())),
        );
        let fp = source_fingerprint(&ctx);
        storage::save_events_with_fingerprint(&[sample_event()], Some(fp), &path).unwrap();
        std::fs::write(&rings_path, "{not-valid-json").unwrap();

        let summary = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();

        assert_eq!(summary.total_events, 1);
        assert_eq!(summary.total_tokens, 42);
        std::fs::remove_file(&rings_path).ok();
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn corrupt_rings_does_not_block_refresh_summary() {
        let home = std::env::temp_dir().join(format!(
            "lag-cache-corrupt-refresh-home-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&home);
        write_session(&home, "proj-a", "s1.jsonl", 77);
        let ctx = AdapterContext::with_home(&home);
        let path = tmp_path("corrupt-rings-refresh");
        let _ = std::fs::remove_file(&path);
        let rings_path = rings::path_for_events_cache(&path);
        let _ = std::fs::remove_file(&rings_path);
        std::fs::write(&rings_path, "{not-valid-json").unwrap();

        let summary = refresh_summary_at(&ctx, None, &path).unwrap();

        assert_eq!(summary.total_events, 1);
        assert_eq!(summary.total_tokens, 77);
        assert!(path.exists(), "events cache should still be written");
        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_file(&rings_path).ok();
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn fingerprintless_cache_is_refreshed() {
        // Legacy / CLI caches carry no fingerprint → never trusted → one refresh.
        let path = tmp_path("nofp");
        let _ = std::fs::remove_file(&path);
        // save_events writes fingerprint: None.
        storage::save_events(&[sample_event()], &path).unwrap();

        let ctx = AdapterContext::with_home(std::env::temp_dir().join("lag-cache-empty-home-2"));
        let summary = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();

        // The sentinel (42 tokens) is discarded; the empty-env rescan wins.
        assert_eq!(summary.total_events, 0);
        std::fs::remove_file(rings::path_for_events_cache(&path)).ok();
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn cache_refreshes_when_a_source_file_is_added() {
        // Start from a real one-session source, build the cache, then add a
        // second session. The added file bumps file_count, so the fingerprint
        // no longer matches and the next read rescans to pick it up — even if
        // the filesystem's mtime granularity wouldn't have caught the change.
        let home = std::env::temp_dir().join(format!("lag-cache-src-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        write_session(&home, "proj-a", "s1.jsonl", 10);
        let ctx = AdapterContext::with_home(&home);
        let path = tmp_path("addsrc");
        let _ = std::fs::remove_file(&path);

        let first = refresh_summary_at(&ctx, None, &path).unwrap();
        assert_eq!(first.total_events, 1);

        // Stash a sentinel under the SAME fingerprint so a non-refreshing read
        // would return it — this guards against the test passing by accident.
        let stale_fp = source_fingerprint(&ctx);
        storage::save_events_with_fingerprint(&[sample_event()], Some(stale_fp), &path).unwrap();

        // Add a second source file → file_count changes → cache is now stale.
        write_session(&home, "proj-b", "s2.jsonl", 20);
        let after = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();

        assert_eq!(
            after.total_events, 2,
            "added source file should trigger rescan"
        );
        assert_eq!(after.total_tokens, 30);
        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn cache_refreshes_when_an_existing_file_is_appended() {
        // The append-only case: rows are written to the SAME session file, so
        // file_count never changes and the mtime may not advance within one
        // coarse FS tick. total_bytes is what catches this — without it the
        // appended rows would be silently dropped on a cold read.
        let home = std::env::temp_dir().join(format!("lag-cache-append-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let session = write_session(&home, "proj-a", "s1.jsonl", 10);
        let ctx = AdapterContext::with_home(&home);
        let path = tmp_path("append");
        let _ = std::fs::remove_file(&path);

        let first = refresh_summary_at(&ctx, None, &path).unwrap();
        assert_eq!(first.total_events, 1);

        // Stash a sentinel under the current fingerprint — a non-refreshing
        // read would return it.
        let fp_before = source_fingerprint(&ctx);
        storage::save_events_with_fingerprint(&[sample_event()], Some(fp_before), &path).unwrap();

        // Append a second row to the SAME file (file_count stays 1).
        let mut existing = std::fs::read_to_string(&session).unwrap();
        existing.push_str(
            r#"{"timestamp":"2026-05-29T13:00:00Z","type":"assistant","sessionId":"s","message":{"usage":{"input_tokens":20,"output_tokens":0}}}"#,
        );
        existing.push('\n');
        std::fs::write(&session, existing).unwrap();

        // total_bytes grew → fingerprint mismatch → rescan picks up both rows.
        let after = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();
        assert_eq!(after.total_events, 2, "append should trigger a rescan");
        assert_eq!(after.total_tokens, 30);
        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn cache_refreshes_when_a_source_file_is_deleted() {
        // Deletion is the case file_count exists for: removing the OLDER file
        // leaves max_mtime_ms held by the surviving newer file, so only the
        // count (and total_bytes) flag the change.
        let home = std::env::temp_dir().join(format!("lag-cache-del-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let older = write_session(&home, "proj-a", "s1.jsonl", 10);
        write_session(&home, "proj-b", "s2.jsonl", 20);
        let ctx = AdapterContext::with_home(&home);
        let path = tmp_path("del");
        let _ = std::fs::remove_file(&path);

        let first = refresh_summary_at(&ctx, None, &path).unwrap();
        assert_eq!(first.total_events, 2);

        // Sentinel under the current fingerprint guards against a false pass.
        let fp_before = source_fingerprint(&ctx);
        storage::save_events_with_fingerprint(&[sample_event()], Some(fp_before), &path).unwrap();

        // Delete one source file → file_count drops → cache is stale.
        std::fs::remove_file(&older).unwrap();
        let after = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();
        assert_eq!(after.total_events, 1, "deletion should trigger a rescan");
        assert_eq!(after.total_tokens, 20);
        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn fresh_cache_with_real_unchanged_sources_is_reused() {
        // Complements the empty-env reuse test: with REAL sources and a
        // non-trivial fingerprint, an untouched tree must reuse the cache
        // verbatim (no rescan). Proven by a sentinel the scan can't produce.
        let home = std::env::temp_dir().join(format!("lag-cache-reuse-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        write_session(&home, "proj-a", "s1.jsonl", 10);
        let ctx = AdapterContext::with_home(&home);
        let path = tmp_path("reuse");
        let _ = std::fs::remove_file(&path);

        refresh_summary_at(&ctx, None, &path).unwrap();
        let fp = source_fingerprint(&ctx);
        assert_ne!(
            fp,
            SourceFingerprint::default(),
            "real source → non-zero fp"
        );

        // Overwrite the cache with a sentinel under the SAME fingerprint.
        storage::save_events_with_fingerprint(&[sample_event()], Some(fp), &path).unwrap();

        // Source untouched → cache reused → sentinel returned (no rescan).
        let summary = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();
        assert_eq!(summary.total_events, 1);
        assert_eq!(
            summary.total_tokens, 42,
            "unchanged sources must reuse cache"
        );
        assert_eq!(summary.projects[0].display_name, "pixel-agent-garden");
        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn fingerprint_counts_files_and_ignores_missing_paths() {
        let home = std::env::temp_dir().join(format!("lag-cache-fp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let ctx = AdapterContext::with_home(&home);
        // No sources yet → zeroed fingerprint, no panic on missing dirs.
        assert_eq!(source_fingerprint(&ctx), SourceFingerprint::default());

        write_session(&home, "proj-a", "s1.jsonl", 1);
        let one = source_fingerprint(&ctx);
        assert_eq!(one.file_count, 1);
        assert!(one.max_mtime_ms > 0, "a real file should have a real mtime");
        assert!(one.total_bytes > 0, "a real file should contribute bytes");

        write_session(&home, "proj-a", "s2.jsonl", 1);
        let two = source_fingerprint(&ctx);
        assert_eq!(two.file_count, 2, "second file should be counted");
        assert!(
            two.total_bytes > one.total_bytes,
            "a second file should add bytes"
        );
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn missing_cache_scans_and_writes_empty_cache() {
        let path = tmp_path("missing");
        let _ = std::fs::remove_file(&path);

        let ctx = AdapterContext::with_home(std::env::temp_dir().join("lag-cache-empty-home"));
        let summary = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();

        assert_eq!(summary.total_events, 0);
        assert!(path.exists(), "cache should be created after fallback scan");
        let events = storage::load_events(&path).unwrap();
        assert!(events.is_empty());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_cache_with_missing_parent_scans_via_interactive_entrypoint() {
        // Regression for the Tauri command path:
        // garden_summary -> summary_from_cache_or_scan_with_failures.
        // A first launch can have neither ~/.local-agent-garden/ nor
        // events.json. That missing read must fall through to scan + cache
        // creation, not surface as "I/O error reading ... events.json".
        let root =
            std::env::temp_dir().join(format!("lag-cache-missing-parent-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let cache_path = root.join(".local-agent-garden").join("events.json");
        let ctx = AdapterContext::with_home(root.join("empty-home"));

        let refresh = summary_from_cache_or_scan_at_with_failures(&ctx, None, &cache_path)
            .expect("missing cache should trigger a fresh empty scan");

        assert_eq!(refresh.summary.total_events, 0);
        assert!(refresh.failures.is_empty());
        assert!(cache_path.exists(), "fallback scan should create the cache");
        let events = storage::load_events(&cache_path).unwrap();
        assert!(events.is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn incompatible_cache_is_replaced_after_scan() {
        let path = tmp_path("future");
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, r#"{"schema_version":999,"events":[]}"#).unwrap();

        let ctx = AdapterContext::with_home(std::env::temp_dir().join("lag-cache-empty-home"));
        let summary = summary_from_cache_or_scan_at(&ctx, None, &path).unwrap();

        assert_eq!(summary.total_events, 0);
        let text = std::fs::read_to_string(&path).unwrap();
        let expected = format!(r#""schema_version": {}"#, storage::EVENTS_SCHEMA_VERSION);
        assert!(
            text.contains(&expected),
            "future cache should be replaced, got: {text}"
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn failed_adapter_keeps_last_partition_but_forces_retry() {
        let home = std::env::temp_dir().join(format!(
            "lag-cache-partial-failure-home-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&home);
        let goose_root = home
            .join("Library")
            .join("Application Support")
            .join("Block")
            .join("goose")
            .join("sessions");
        std::fs::create_dir_all(&goose_root).unwrap();
        let conn = rusqlite::Connection::open(goose_root.join("sessions.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, working_dir TEXT);
             CREATE TABLE usage_ledger (
               id INTEGER PRIMARY KEY, session_id TEXT, created_timestamp INTEGER,
               model TEXT, input_tokens INTEGER, output_tokens INTEGER,
               total_tokens INTEGER, cache_read_tokens INTEGER,
               cache_write_tokens INTEGER, cost REAL, is_compaction INTEGER
             );",
        )
        .unwrap();
        drop(conn);
        write_session(&home, "healthy", "session.jsonl", 7);
        let manual_path = home.join("manual.jsonl");
        std::fs::write(
            &manual_path,
            r#"{"source":"goose","timestamp":"2026-05-29T12:00:00Z","project_path":"D:/repo/pixel-agent-garden","total_tokens":99}"#,
        )
        .unwrap();

        let cache_path = tmp_path("partial-failure");
        let mut old_goose = sample_event();
        old_goose.source = "goose".to_string();
        old_goose.usage.total_tokens = 99;
        old_goose.raw_ref = Some(format!("{}:1", manual_path.display()));
        storage::save_events_with_fingerprint(
            &[old_goose],
            Some(SourceFingerprint::default()),
            &cache_path,
        )
        .unwrap();

        let ctx = AdapterContext::with_home(&home).with_manual_jsonl([manual_path]);
        let refresh = refresh_summary_at_with_failures(&ctx, None, &cache_path).unwrap();
        assert_eq!(refresh.failures.len(), 1);
        assert_eq!(refresh.failures[0].adapter, "goose");
        assert_eq!(refresh.summary.source_tokens["goose"].total_tokens, 99);
        assert_eq!(
            refresh
                .summary
                .sources
                .get("goose")
                .copied()
                .unwrap_or_default(),
            1
        );
        assert_eq!(refresh.summary.source_tokens["claude-code"].total_tokens, 7);
        assert!(
            storage::load_cache(&cache_path)
                .unwrap()
                .fingerprint
                .is_none()
        );

        std::fs::remove_file(rings::path_for_events_cache(&cache_path)).ok();
        std::fs::remove_file(&cache_path).ok();
        std::fs::remove_dir_all(&home).ok();
    }
}
