//! Local diagnostics for release/support workflows.
//!
//! `doctor` is deliberately core-owned: it checks product-owned state files,
//! adapter discovery, and local price/settings/rings readability without
//! importing Tauri or frontend code. It never scans source logs and never calls
//! the network.

use crate::adapter::AdapterContext;
use crate::{prices, registry, rings, settings, storage};
use serde::{Deserialize, Serialize};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

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

impl Default for DoctorPaths {
    fn default() -> Self {
        let state_dir = storage::default_state_dir();
        Self {
            settings_path: settings::default_settings_path(),
            events_path: state_dir.join("events.json"),
            rings_path: rings::default_rings_path(),
            prices_path: prices::default_user_prices_path(),
            state_dir,
        }
    }
}

pub fn run(ctx: &AdapterContext) -> DoctorReport {
    run_with_paths(ctx, &DoctorPaths::default())
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
    match ensure_writable_dir(path) {
        Ok(()) => check(
            "state_dir",
            DoctorStatus::Ok,
            "state directory is writable",
            Some(report_path(path)),
        ),
        Err(message) => check(
            "state_dir",
            DoctorStatus::Error,
            "state directory is not writable",
            Some(message),
        ),
    }
}

fn ensure_writable_dir(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|err| format!("{}: {}", path.display(), err))?;
    for n in 0..100u32 {
        let probe = path.join(format!(".doctor-write-{}-{n}", std::process::id()));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
        {
            Ok(mut file) => {
                file.write_all(b"ok")
                    .map_err(|err| format!("{}: {}", probe.display(), err))?;
                drop(file);
                std::fs::remove_file(&probe)
                    .map_err(|err| format!("{}: {}", probe.display(), err))?;
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
        Err(err) => check(
            "settings",
            DoctorStatus::Error,
            "settings.toml is invalid",
            Some(report_text(&err.to_string())),
        ),
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
        Err(err) => check(
            "prices",
            DoctorStatus::Error,
            "price table is invalid",
            Some(report_text(&err.to_string())),
        ),
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
        Err(err) => check(
            "events_cache",
            DoctorStatus::Error,
            "events.json is invalid",
            Some(report_text(&err.to_string())),
        ),
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
        Err(err) => check(
            "rings",
            DoctorStatus::Error,
            "rings.json is invalid",
            Some(report_text(&err.to_string())),
        ),
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
    let Some(home) = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .and_then(|value| value.into_string().ok())
        .filter(|value| !value.is_empty())
    else {
        return text.to_string();
    };
    text.replace(&home, "~")
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
        assert_eq!(status(&report, "state_dir"), DoctorStatus::Ok);
        assert_eq!(status(&report, "settings"), DoctorStatus::Ok);
        assert_eq!(status(&report, "prices"), DoctorStatus::Ok);
        assert_eq!(status(&report, "events_cache"), DoctorStatus::Warn);
        assert_eq!(status(&report, "rings"), DoctorStatus::Warn);
        assert_eq!(status(&report, "adapters"), DoctorStatus::Warn);

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

        ensure_writable_dir(&root).unwrap();

        assert_eq!(std::fs::read_to_string(&existing).unwrap(), "keep");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn report_paths_redact_home_prefix() {
        let Some(home) = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
        else {
            return;
        };
        let path = home.join(".local-agent-garden").join("events.json");

        assert_eq!(report_path(&path), "~/.local-agent-garden/events.json");
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
