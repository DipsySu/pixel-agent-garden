//! Local diagnostics for release/support workflows.
//!
//! `doctor` is deliberately core-owned: it checks product-owned state files,
//! adapter discovery, and local price/settings/rings readability without
//! importing Tauri or frontend code. It never scans source logs and never calls
//! the network.

use crate::adapter::AdapterContext;
use crate::error::Error;
use crate::{prices, registry, rings, settings, storage};
use serde::{Deserialize, Serialize};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

/// Classify a state-file load failure. An I/O error (permission denied,
/// EISDIR, a disconnected network share) means the file may be perfectly
/// valid but unreadable right now — that is a Warn, not the corruption-flavored
/// Error that both fails the whole `doctor` run (non-zero exit) and, via the
/// "is invalid" wording, tempts a user to delete a healthy file. Only a parse
/// failure is genuine invalidity.
fn load_failure(subject: &str, err: &Error) -> (DoctorStatus, String) {
    match err {
        Error::Io { .. } => (
            DoctorStatus::Warn,
            format!("{subject} is unreadable (permissions or I/O)"),
        ),
        _ => (DoctorStatus::Error, format!("{subject} is invalid")),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DoctorStatus {
    Ok,
    Warn,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DoctorCheck {
    pub id: String,
    pub status: DoctorStatus,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DoctorReport {
    pub ok: bool,
    pub checks: Vec<DoctorCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoctorPaths {
    pub state_dir: PathBuf,
    pub settings_path: PathBuf,
    pub events_path: PathBuf,
    pub rings_path: PathBuf,
    pub prices_path: PathBuf,
}

impl DoctorPaths {
    /// Every product state file lives under one state dir (see storage.rs /
    /// settings.rs / rings.rs / prices.rs — all `default_state_dir().join(..)`).
    /// Deriving them from an explicit state dir lets `run` honor the caller's
    /// home instead of re-reading the process env, so the adapter half and the
    /// file half of a report can never point at two different homes.
    pub fn for_state_dir(state_dir: PathBuf) -> Self {
        Self {
            settings_path: state_dir.join("settings.toml"),
            events_path: state_dir.join("events.json"),
            rings_path: state_dir.join("rings.json"),
            prices_path: state_dir.join("prices.json"),
            state_dir,
        }
    }
}

impl Default for DoctorPaths {
    fn default() -> Self {
        Self::for_state_dir(storage::default_state_dir())
    }
}

pub fn run(ctx: &AdapterContext) -> DoctorReport {
    // Resolve state files under the SAME home the adapter checks use (ctx),
    // not the process env, so a caller built via AdapterContext::with_home(X)
    // gets a coherent report instead of adapters-under-X + files-under-$HOME.
    run_with_paths(
        ctx,
        &DoctorPaths::for_state_dir(ctx.home.join(".local-agent-garden")),
    )
}

pub fn run_with_paths(ctx: &AdapterContext, paths: &DoctorPaths) -> DoctorReport {
    let checks = vec![
        check_state_dir(&paths.state_dir),
        check_settings(&paths.settings_path),
        check_prices(&paths.prices_path),
        check_events_cache(&paths.events_path),
        check_rings(&paths.rings_path),
        check_adapters(ctx),
    ];
    let ok = !checks
        .iter()
        .any(|check| check.status == DoctorStatus::Error);
    DoctorReport { ok, checks }
}

fn check_state_dir(path: &Path) -> DoctorCheck {
    // A diagnostic must not materialize product state: an absent dir is a
    // benign "not created yet" (first run), not a failure, and we never
    // create_dir_all here (that would drop ~/.local-agent-garden/ onto a
    // machine that never launched the app).
    if !path.exists() {
        return check(
            "state_dir",
            DoctorStatus::Warn,
            "state directory is absent; it will be created on first run",
            Some(report_path(path)),
        );
    }
    match probe_writable(path) {
        Ok(()) => check(
            "state_dir",
            DoctorStatus::Ok,
            "state directory is writable",
            Some(report_path(path)),
        ),
        // Redact the probe message like every other check — it embeds the
        // home-rooted path and doctor output is meant to be paste-safe.
        Err(message) => check(
            "state_dir",
            DoctorStatus::Error,
            "state directory is not writable",
            Some(report_text(&message)),
        ),
    }
}

/// Confirm the (already-existing) state dir accepts a write, cleaning up the
/// probe on every exit path — a failed write/remove or a killed process must
/// not leave a `.doctor-write-*` orphan behind.
fn probe_writable(path: &Path) -> Result<(), String> {
    for n in 0..100u32 {
        let probe = path.join(format!(".doctor-write-{}-{n}", std::process::id()));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
        {
            Ok(mut file) => {
                let wrote = file.write_all(b"ok");
                drop(file);
                // Always attempt cleanup, then surface the write error if any.
                let removed = std::fs::remove_file(&probe);
                wrote.map_err(|err| format!("{}: {}", probe.display(), err))?;
                removed.map_err(|err| format!("{}: {}", probe.display(), err))?;
                return Ok(());
            }
            Err(err) if err.kind() == ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("{}: {}", probe.display(), err)),
        }
    }
    Err(format!(
        "{}: no available doctor probe filename",
        path.display()
    ))
}

fn check_settings(path: &Path) -> DoctorCheck {
    match settings::load(path) {
        Ok(_) if path.exists() => check(
            "settings",
            DoctorStatus::Ok,
            "settings.toml parses",
            Some(report_path(path)),
        ),
        Ok(_) => check(
            "settings",
            DoctorStatus::Ok,
            "settings.toml is absent; defaults will be used",
            Some(report_path(path)),
        ),
        Err(err) => {
            let (status, message) = load_failure("settings.toml", &err);
            check(
                "settings",
                status,
                &message,
                Some(report_text(&err.to_string())),
            )
        }
    }
}

fn check_prices(path: &Path) -> DoctorCheck {
    match prices::load_effective(path) {
        Ok(table) => check(
            "prices",
            DoctorStatus::Ok,
            "price table parses",
            Some(format!(
                "{} models; user file {}",
                table.prices.len(),
                if path.exists() { "present" } else { "absent" }
            )),
        ),
        Err(err) => {
            let (status, message) = load_failure("price table", &err);
            check(
                "prices",
                status,
                &message,
                Some(report_text(&err.to_string())),
            )
        }
    }
}

fn check_events_cache(path: &Path) -> DoctorCheck {
    if !path.exists() {
        return check(
            "events_cache",
            DoctorStatus::Warn,
            "events.json is absent; run scan to populate the garden",
            Some(report_path(path)),
        );
    }
    match storage::load_cache(path) {
        Ok(cache) => check(
            "events_cache",
            DoctorStatus::Ok,
            "events.json parses",
            Some(format!(
                "{} events; fingerprint {}",
                cache.events.len(),
                if cache.fingerprint.is_some() {
                    "present"
                } else {
                    "absent"
                }
            )),
        ),
        Err(err) => {
            let (status, message) = load_failure("events.json", &err);
            check(
                "events_cache",
                status,
                &message,
                Some(report_text(&err.to_string())),
            )
        }
    }
}

fn check_rings(path: &Path) -> DoctorCheck {
    if !path.exists() {
        return check(
            "rings",
            DoctorStatus::Warn,
            "rings.json is absent; garden memory starts after the next summary",
            Some(report_path(path)),
        );
    }
    match rings::load(path) {
        Ok(book) => check(
            "rings",
            DoctorStatus::Ok,
            "rings.json parses",
            Some(format!("{} memory events", book.events.len())),
        ),
        Err(err) => {
            let (status, message) = load_failure("rings.json", &err);
            check(
                "rings",
                status,
                &message,
                Some(report_text(&err.to_string())),
            )
        }
    }
}

fn check_adapters(ctx: &AdapterContext) -> DoctorCheck {
    let mut active = Vec::new();
    let mut watched = 0usize;
    let mut names = Vec::new();
    for adapter in registry::default_adapters() {
        names.push(adapter.name().to_string());
        if adapter.discover(ctx) {
            active.push(adapter.name().to_string());
            watched += adapter.watch_paths(ctx).len();
        }
    }
    if active.is_empty() {
        check(
            "adapters",
            DoctorStatus::Warn,
            "no local adapters discovered",
            Some(format!("available: {}", names.join(", "))),
        )
    } else {
        check(
            "adapters",
            DoctorStatus::Ok,
            "local adapters discovered",
            Some(format!(
                "active: {}; watch paths: {}",
                active.join(", "),
                watched
            )),
        )
    }
}

fn check(id: &str, status: DoctorStatus, message: &str, detail: Option<String>) -> DoctorCheck {
    DoctorCheck {
        id: id.to_string(),
        status,
        message: message.to_string(),
        detail,
    }
}

fn report_path(path: &Path) -> String {
    report_text(&path.display().to_string()).replace('\\', "/")
}

fn report_text(text: &str) -> String {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .and_then(|value| value.into_string().ok())
        .filter(|value| !value.is_empty());
    redact_home(text, home.as_deref())
}

/// Replace the home prefix with `~`, boundary-aware and env-free (so it is unit
/// testable without touching the process environment). Only a home occurrence
/// that ends a path component — followed by `/`, `\`, or end-of-string — is
/// redacted, so `HOME=/Users/su` no longer mangles `/Users/superproj` into
/// `~perproj`. A missing home returns the text unchanged.
fn redact_home(text: &str, home: Option<&str>) -> String {
    let Some(home) = home.filter(|value| !value.is_empty()) else {
        return text.to_string();
    };
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(idx) = rest.find(home) {
        let after = &rest[idx + home.len()..];
        let boundary = after
            .chars()
            .next()
            .map(|c| c == '/' || c == '\\')
            .unwrap_or(true);
        out.push_str(&rest[..idx]);
        if boundary {
            out.push('~');
        } else {
            out.push_str(home);
        }
        rest = after;
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::AgentEvent;
    use chrono::TimeZone;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("lag-doctor-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    fn paths(root: &Path) -> DoctorPaths {
        DoctorPaths {
            state_dir: root.to_path_buf(),
            settings_path: root.join("settings.toml"),
            events_path: root.join("events.json"),
            rings_path: root.join("rings.json"),
            prices_path: root.join("prices.json"),
        }
    }

    #[test]
    fn fresh_install_reports_warnings_but_no_errors() {
        let root = temp_root("fresh");
        let ctx = AdapterContext::with_home(root.join("home"));
        let report = run_with_paths(&ctx, &paths(&root));

        assert!(report.ok);
        // A never-launched install has no state dir yet — doctor must report
        // that as a Warn without creating the directory (it is a read-mostly
        // diagnostic), and confirm it left nothing behind.
        assert_eq!(status(&report, "state_dir"), DoctorStatus::Warn);
        assert!(!root.exists(), "doctor must not create the state dir");
        assert_eq!(status(&report, "settings"), DoctorStatus::Ok);
        assert_eq!(status(&report, "prices"), DoctorStatus::Ok);
        assert_eq!(status(&report, "events_cache"), DoctorStatus::Warn);
        assert_eq!(status(&report, "rings"), DoctorStatus::Warn);
        assert_eq!(status(&report, "adapters"), DoctorStatus::Warn);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn writable_state_dir_is_ok_and_leaves_no_probe() {
        let root = temp_root("writable");
        std::fs::create_dir_all(&root).unwrap();

        let report = run_with_paths(&AdapterContext::with_home(root.join("home")), &paths(&root));

        assert_eq!(status(&report, "state_dir"), DoctorStatus::Ok);
        let leftover: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".doctor-write"))
            .collect();
        assert!(leftover.is_empty(), "probe files must be cleaned up");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn malformed_settings_is_an_error() {
        let root = temp_root("bad-settings");
        let p = paths(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&p.settings_path, "not = [toml").unwrap();

        let report = run_with_paths(&AdapterContext::with_home(root.join("home")), &p);

        assert!(!report.ok);
        assert_eq!(status(&report, "settings"), DoctorStatus::Error);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn writable_probe_does_not_overwrite_existing_files() {
        let root = temp_root("probe");
        std::fs::create_dir_all(&root).unwrap();
        let existing = root.join(format!(".doctor-write-{}-0", std::process::id()));
        std::fs::write(&existing, "keep").unwrap();

        probe_writable(&root).unwrap();

        assert_eq!(std::fs::read_to_string(&existing).unwrap(), "keep");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn redact_home_is_boundary_aware_and_env_free() {
        // Injected home — no dependency on the process $HOME (a HOME-less CI
        // must still exercise redaction, not silently pass).
        assert_eq!(
            redact_home(
                "/Users/alice/.local-agent-garden/events.json",
                Some("/Users/alice")
            ),
            "~/.local-agent-garden/events.json"
        );
        // Bare home, and home inside an error message, both redact.
        assert_eq!(redact_home("/Users/alice", Some("/Users/alice")), "~");
        assert_eq!(
            redact_home("/Users/alice/x: Permission denied", Some("/Users/alice")),
            "~/x: Permission denied"
        );
        // Boundary-aware: a longer sibling dir is NOT mangled into ~perproj.
        assert_eq!(
            redact_home("/Users/superproj/x", Some("/Users/su")),
            "/Users/superproj/x"
        );
        // Missing/empty home leaves the text untouched.
        assert_eq!(redact_home("/Users/alice/x", None), "/Users/alice/x");
        assert_eq!(redact_home("/Users/alice/x", Some("")), "/Users/alice/x");
    }

    #[test]
    fn unreadable_file_warns_rather_than_errors() {
        // An I/O failure (here: the path is a directory, so load hits EISDIR)
        // is a Warn, not a corruption Error that would fail the whole run.
        let io_err = Error::io(
            PathBuf::from("/x"),
            std::io::Error::from(ErrorKind::PermissionDenied),
        );
        let (status, message) = load_failure("settings.toml", &io_err);
        assert_eq!(status, DoctorStatus::Warn);
        assert!(message.contains("unreadable"));
    }

    #[test]
    fn valid_cache_and_manual_adapter_are_ok() {
        let root = temp_root("ok");
        let p = paths(&root);
        let ts = chrono::Utc.with_ymd_and_hms(2026, 7, 8, 1, 0, 0).unwrap();
        storage::save_events(&[AgentEvent::new("manual-jsonl", ts)], &p.events_path).unwrap();
        let manual = root.join("manual.jsonl");
        std::fs::write(&manual, "").unwrap();
        let ctx = AdapterContext::with_home(root.join("home")).with_manual_jsonl([manual]);

        let report = run_with_paths(&ctx, &p);

        assert!(report.ok);
        assert_eq!(status(&report, "events_cache"), DoctorStatus::Ok);
        assert_eq!(status(&report, "adapters"), DoctorStatus::Ok);
        let _ = std::fs::remove_dir_all(root);
    }

    fn status(report: &DoctorReport, id: &str) -> DoctorStatus {
        report
            .checks
            .iter()
            .find(|check| check.id == id)
            .map(|check| check.status)
            .unwrap()
    }
}
