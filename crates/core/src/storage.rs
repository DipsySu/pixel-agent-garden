//! Persistence: events.json read/write.
//!
//! Per spec §Schema Versioning, the on-disk events cache carries a
//! `schema_version` envelope so a future readers that finds an unknown
//! version refuses the cache and rescans from source. The wrapper also
//! leaves room for adding sibling metadata (cache mtime, source hashes,
//! etc.) without renaming the events array.

use crate::error::Error;
use crate::event::AgentEvent;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Schema version for the on-disk events cache (`events.json`). Deliberately
/// independent from `aggregate::SUMMARY_SCHEMA_VERSION`: the summary JSON shape
/// can change without invalidating cached raw events, and vice-versa. Bump only
/// when the `EventsCache` / `AgentEvent` shape or interpretation changes
/// incompatibly. Version 3 removes prompt/title metadata from normalized
/// events and adds per-adapter fingerprints for incremental refreshes.
pub const EVENTS_SCHEMA_VERSION: u32 = 3;

static ATOMIC_WRITE_NONCE: AtomicU64 = AtomicU64::new(0);
const JSON_WRITE_BUFFER_BYTES: usize = 64 * 1024;

/// Fingerprint of the source files the cached events were built from. Used by
/// `crate::cache` to decide whether a cache is stale relative to the agent
/// logs on disk, without re-parsing them.
///
/// Three fields, because no single one catches every change to append-only
/// agent logs:
/// - `total_bytes`: sum of every source file's length → catches **in-place
///   appends** to an active session `.jsonl` (the dominant case), which change
///   neither the file count nor reliably the mtime within one coarse FS tick.
/// - `max_mtime_ms`: newest source-file mtime → catches touches / new files.
/// - `file_count`: number of source files → catches deletions (which can leave
///   `max_mtime_ms` unchanged when the newest file survives).
///
/// A mismatch in *any* field means the cache is stale. This is purely data;
/// computing it lives in `crate::cache` because it has to walk adapter
/// `watch_paths()` (storage stays adapter-agnostic, spec §10).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SourceFingerprint {
    /// Sum of source-file lengths in bytes. `#[serde(default)]` so a cache
    /// written before this field existed loads as 0 and is treated as stale
    /// (one safe refresh) rather than failing the whole envelope parse.
    #[serde(default)]
    pub total_bytes: u64,
    pub max_mtime_ms: i64,
    pub file_count: u64,
}

/// Versioned events cache envelope. Saved as JSON to `events.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventsCache {
    pub schema_version: u32,
    pub events: Vec<AgentEvent>,
    /// Source fingerprint at scan time. `#[serde(default)]` so caches written
    /// before this field existed (and CLI exports that don't compute it)
    /// deserialize as `None` — which `crate::cache` treats as "always stale",
    /// forcing one safe refresh rather than trusting an unknown-freshness cache.
    #[serde(default)]
    pub fingerprint: Option<SourceFingerprint>,
    /// Fingerprint for each collecting adapter. A stale cache can rescan only
    /// the adapters whose inputs changed and reuse the remaining partitions.
    #[serde(default)]
    pub source_fingerprints: BTreeMap<String, SourceFingerprint>,
}

#[derive(Serialize)]
struct EventsCacheRef<'a> {
    schema_version: u32,
    events: &'a [AgentEvent],
    fingerprint: Option<SourceFingerprint>,
    source_fingerprints: &'a BTreeMap<String, SourceFingerprint>,
}

/// Default cache directory — `~/.local-agent-garden/`.
pub fn default_state_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"));
    home.join(".local-agent-garden")
}

/// Atomically replace a UTF-8 state file with `text`.
///
/// The write happens through a sibling temp file followed by `rename`, so
/// readers never observe a half-written JSON document. This is intended for
/// product-owned cache/state files under `~/.local-agent-garden/`; tests also
/// use it with temp paths.
pub(crate) fn write_text_atomic(path: &Path, text: &str) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
        harden_state_dir(parent)?;
    }
    let (tmp, mut file) = create_atomic_tmp(path)?;
    if let Err(error) = file.write_all(text.as_bytes()) {
        let _ = std::fs::remove_file(&tmp);
        return Err(Error::io(&tmp, error));
    }
    drop(file);
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        Error::io(path, e)
    })?;
    Ok(())
}

fn atomic_tmp_path(path: &Path, nonce: u64) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("state");
    path.with_file_name(format!(".{file_name}.tmp-{}-{nonce}", std::process::id()))
}

fn create_atomic_tmp(path: &Path) -> Result<(PathBuf, std::fs::File), Error> {
    for _ in 0..32 {
        let nonce = ATOMIC_WRITE_NONCE.fetch_add(1, Ordering::Relaxed);
        let tmp = atomic_tmp_path(path, nonce);
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&tmp) {
            Ok(file) => return Ok((tmp, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(Error::io(&tmp, error)),
        }
    }
    Err(Error::InvalidRecord {
        context: path.display().to_string(),
        message: "could not allocate a unique atomic-write temp file".to_string(),
    })
}

fn harden_state_dir(path: &Path) -> Result<(), Error> {
    if path != default_state_dir() {
        return Ok(());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| Error::io(path, e))?;
    }
    Ok(())
}

/// Write events to disk wrapped in the versioned envelope, with no source
/// fingerprint. Used by callers (e.g. the CLI `scan --out`) that don't track
/// freshness; the resulting cache is treated as always-stale by `crate::cache`.
pub fn save_events(events: &[AgentEvent], path: &Path) -> Result<(), Error> {
    save_events_with_fingerprint(events, None, path)
}

/// Write events plus the source `fingerprint` they were built from. `crate::cache`
/// uses this on refresh so the next read can tell whether the cache is current.
pub fn save_events_with_fingerprint(
    events: &[AgentEvent],
    fingerprint: Option<SourceFingerprint>,
    path: &Path,
) -> Result<(), Error> {
    save_events_with_fingerprints(events, fingerprint, &BTreeMap::new(), path)
}

pub fn save_events_with_fingerprints(
    events: &[AgentEvent],
    fingerprint: Option<SourceFingerprint>,
    source_fingerprints: &BTreeMap<String, SourceFingerprint>,
    path: &Path,
) -> Result<(), Error> {
    let cache = EventsCacheRef {
        schema_version: EVENTS_SCHEMA_VERSION,
        events,
        fingerprint,
        source_fingerprints,
    };
    write_json_atomic(path, &cache)
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
        harden_state_dir(parent)?;
    }
    let (tmp, file) = create_atomic_tmp(path)?;
    if let Err(error) = write_json_buffered(&tmp, file, value) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error);
    }
    std::fs::rename(&tmp, path).map_err(|error| {
        let _ = std::fs::remove_file(&tmp);
        Error::io(path, error)
    })
}

fn write_json_buffered<T: Serialize, W: Write>(
    path: &Path,
    writer: W,
    value: &T,
) -> Result<(), Error> {
    let mut writer = BufWriter::with_capacity(JSON_WRITE_BUFFER_BYTES, writer);
    serde_json::to_writer(&mut writer, value).map_err(|error| Error::json(path, error))?;
    writer.flush().map_err(|error| Error::io(path, error))
}

/// Read the full cache envelope (events + fingerprint). Rejects any wrapped
/// cache from a different schema version so the caller rescans rather than
/// preserving stale semantics. Legacy unwrapped event arrays load with
/// `fingerprint: None`, which also forces a safe refresh in cache consumers.
pub fn load_cache(path: &Path) -> Result<EventsCache, Error> {
    let text = std::fs::read_to_string(path).map_err(|e| Error::io(path, e))?;
    // Try the wrapped form first; fall back to a bare array.
    match serde_json::from_str::<EventsCache>(&text) {
        Ok(cache) => {
            if cache.schema_version != EVENTS_SCHEMA_VERSION {
                return Err(Error::InvalidRecord {
                    context: path.display().to_string(),
                    message: format!(
                        "cache schema_version {} does not match reader version {}; \
                         delete the cache to rescan",
                        cache.schema_version, EVENTS_SCHEMA_VERSION
                    ),
                });
            }
            Ok(cache)
        }
        Err(_) => {
            let events =
                serde_json::from_str::<Vec<AgentEvent>>(&text).map_err(|e| Error::json(path, e))?;
            Ok(EventsCache {
                schema_version: EVENTS_SCHEMA_VERSION,
                events,
                fingerprint: None,
                source_fingerprints: BTreeMap::new(),
            })
        }
    }
}

/// Read just the events from disk. Thin wrapper over `load_cache` for callers
/// that don't care about freshness (CLI views, tests).
pub fn load_events(path: &Path) -> Result<Vec<AgentEvent>, Error> {
    load_cache(path).map(|cache| cache.events)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::AgentEvent;
    use chrono::TimeZone;
    use std::cell::Cell;
    use std::rc::Rc;

    struct CountingWriter {
        calls: Rc<Cell<usize>>,
        bytes: Rc<Cell<usize>>,
    }

    impl Write for CountingWriter {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.calls.set(self.calls.get() + 1);
            self.bytes.set(self.bytes.get() + buffer.len());
            Ok(buffer.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn tmp(suffix: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "lag-storage-{}-{}.json",
            std::process::id(),
            suffix
        ))
    }

    fn sample_events() -> Vec<AgentEvent> {
        let ts = chrono::Utc.with_ymd_and_hms(2026, 5, 28, 12, 0, 0).unwrap();
        vec![AgentEvent::new("claude-code", ts)]
    }

    #[test]
    fn save_load_roundtrip_preserves_events() {
        let path = tmp("roundtrip");
        let _ = std::fs::remove_file(&path);
        save_events(&sample_events(), &path).unwrap();
        let back = load_events(&path).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].source, "claude-code");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn fingerprint_survives_roundtrip() {
        // The whole freshness mechanism depends on a non-zero fingerprint
        // coming back as Some(fp) bit-equal after a disk round-trip. Pin it so
        // a future serde rename/shape change can't silently null it out (which
        // would make every cache read permanently stale).
        let path = tmp("fproundtrip");
        let _ = std::fs::remove_file(&path);
        let fp = SourceFingerprint {
            total_bytes: 4096,
            max_mtime_ms: 1_700_000_000_000,
            file_count: 7,
        };
        save_events_with_fingerprint(&sample_events(), Some(fp), &path).unwrap();
        let back = load_cache(&path).unwrap();
        assert_eq!(back.fingerprint, Some(fp));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn save_events_writes_no_fingerprint() {
        // The plain save_events (CLI export path) must produce a None
        // fingerprint so crate::cache treats it as always-stale.
        let path = tmp("nofp");
        let _ = std::fs::remove_file(&path);
        save_events(&sample_events(), &path).unwrap();
        let back = load_cache(&path).unwrap();
        assert!(back.fingerprint.is_none());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn legacy_fingerprint_without_total_bytes_loads() {
        // A cache written before total_bytes existed (only mtime + count) must
        // still deserialize — total_bytes defaults to 0 — rather than failing
        // the whole envelope parse.
        let path = tmp("legacyfp");
        std::fs::write(
            &path,
            format!(
                r#"{{"schema_version":{},"events":[],"fingerprint":{{"max_mtime_ms":123,"file_count":2}}}}"#,
                EVENTS_SCHEMA_VERSION
            ),
        )
        .unwrap();
        let back = load_cache(&path).unwrap();
        let fp = back.fingerprint.expect("fingerprint should deserialize");
        assert_eq!(fp.max_mtime_ms, 123);
        assert_eq!(fp.file_count, 2);
        assert_eq!(fp.total_bytes, 0, "missing total_bytes defaults to 0");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn save_writes_schema_version() {
        let path = tmp("schema");
        let _ = std::fs::remove_file(&path);
        save_events(&sample_events(), &path).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["schema_version"], EVENTS_SCHEMA_VERSION);
        assert!(parsed["events"].is_array());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn json_serialization_batches_small_writes() {
        let calls = Rc::new(Cell::new(0));
        let bytes = Rc::new(Cell::new(0));
        let writer = CountingWriter {
            calls: Rc::clone(&calls),
            bytes: Rc::clone(&bytes),
        };
        let payload = vec!["x".repeat(256); 4096];

        write_json_buffered(Path::new("counted.json"), writer, &payload).unwrap();

        assert!(bytes.get() > 1_000_000);
        assert!(
            calls.get() <= 32,
            "1 MiB JSON should be emitted in buffered chunks, got {} writes",
            calls.get()
        );
    }

    #[test]
    fn atomic_text_write_replaces_existing_file() {
        let path = tmp("atomic");
        let _ = std::fs::remove_file(&path);
        write_text_atomic(&path, "one").unwrap();
        write_text_atomic(&path, "two").unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "two");
        let prefix = format!(
            ".{}.tmp-{}-",
            path.file_name().unwrap().to_string_lossy(),
            std::process::id()
        );
        let temp_left = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().starts_with(&prefix));
        assert!(!temp_left, "temp file should not remain after rename");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn concurrent_atomic_writes_use_distinct_temp_files() {
        use std::sync::{Arc, Barrier};

        let path = tmp("atomic-concurrent");
        let _ = std::fs::remove_file(&path);
        let barrier = Arc::new(Barrier::new(12));
        let mut workers = Vec::new();
        for index in 0..12 {
            let path = path.clone();
            let barrier = Arc::clone(&barrier);
            workers.push(std::thread::spawn(move || {
                barrier.wait();
                write_text_atomic(&path, &format!(r#"{{"writer":{index}}}"#))
            }));
        }
        for worker in workers {
            worker.join().unwrap().unwrap();
        }

        let final_value = std::fs::read_to_string(&path).unwrap();
        let parsed = serde_json::from_str::<serde_json::Value>(&final_value).unwrap();
        assert!(parsed["writer"].as_u64().is_some());
        std::fs::remove_file(&path).ok();
    }

    #[cfg(unix)]
    #[test]
    fn atomic_state_files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let path = tmp("private-mode");
        let _ = std::fs::remove_file(&path);
        write_text_atomic(&path, "private").unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn load_rejects_future_schema_version() {
        // A cache marked as v999 would predate this reader's understanding —
        // refuse it so we never misinterpret fields.
        let path = tmp("future");
        std::fs::write(&path, r#"{"schema_version":999,"events":[]}"#).unwrap();
        let err = load_events(&path).unwrap_err();
        assert!(
            matches!(err, Error::InvalidRecord { .. }),
            "expected InvalidRecord, got {err:?}"
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn load_rejects_older_wrapped_schema_to_force_truthful_rescan() {
        let path = tmp("old-schema");
        std::fs::write(&path, r#"{"schema_version":1,"events":[]}"#).unwrap();
        let err = load_events(&path).unwrap_err();
        assert!(matches!(err, Error::InvalidRecord { .. }));
        assert!(err.to_string().contains(&format!(
            "does not match reader version {EVENTS_SCHEMA_VERSION}"
        )));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn load_accepts_legacy_bare_array() {
        // Caches written by older builds (pre-schema-version) were a flat
        // `[AgentEvent, ...]`. Still load them so we don't force a rescan on
        // every existing user the first time they pick up this build.
        let path = tmp("legacy");
        let ts = "2026-05-28T12:00:00Z";
        std::fs::write(
            &path,
            format!(
                r#"[{{"source":"claude-code","timestamp":"{ts}","event_type":"message","input_tokens":0,"output_tokens":0,"cache_read_tokens":0,"cache_write_tokens":0,"total_tokens":0,"tool_calls":0,"files_touched":[],"metadata":{{}}}}]"#
            ),
        )
        .unwrap();
        let back = load_events(&path).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].source, "claude-code");
        std::fs::remove_file(&path).ok();
    }
}
