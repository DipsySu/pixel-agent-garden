//! User preferences (spec §2.4).
//!
//! Persisted at `~/.local-agent-garden/settings.toml`. Schema is
//! **intentionally narrow** — only switches that affect rendering or
//! scanning. Cosmetic options (palette, font size, …) live in a future
//! settings UI layer.
//!
//! Modularity (spec §10 rule 1): this module is `core`-only — no Tauri
//! types, no UI types. The Tauri shell exposes `get_settings` /
//! `set_settings` commands that call `load` / `save` here.

use crate::Error;
use crate::storage::default_state_dir;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Top-level settings document. Every field defaults to a sentinel
/// ("system") meaning "follow the OS / current-time / default behavior" —
/// so a fresh install with no settings.toml renders identically to phase-1.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Settings {
    pub appearance: Appearance,
    pub data: DataSettings,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Appearance {
    pub time_mode: TimeMode,
    pub season_mode: SeasonMode,
    pub motion: Motion,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DataSettings {
    /// notify-driven live updates. When false, the frontend won't subscribe
    /// to `garden:updated` events — the user explicitly clicks "Refresh".
    pub auto_rescan: bool,
}

// Explicit Default for DataSettings — auto_rescan defaults to TRUE, matching
// the phase-1 behavior. (`#[derive(Default)]` would give false.)
impl Default for DataSettings {
    fn default() -> Self {
        Self { auto_rescan: true }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimeMode {
    /// Render based on the system clock (sun position, palette, lamp).
    #[default]
    System,
    /// Force daytime palette regardless of clock.
    Day,
    /// Force dusk palette.
    Dusk,
    /// Force night palette (stars, lit lanterns, dark sky).
    Night,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SeasonMode {
    /// Pick season from the current date (Mar-May spring, Jun-Aug summer, …).
    #[default]
    System,
    Spring,
    Summer,
    Autumn,
    Winter,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Motion {
    /// Respect the OS / browser `prefers-reduced-motion` media query.
    #[default]
    System,
    /// Reduced motion — long transitions kept, particle effects disabled.
    Reduced,
    /// All motion disabled, including hover lift and vine sway.
    Off,
}

/// Default location for the settings file. Co-located with the event cache
/// so a future "reset everything" command can wipe one directory.
pub fn default_settings_path() -> PathBuf {
    default_state_dir().join("settings.toml")
}

/// Load settings from `path`. **Missing file is NOT an error** — returns
/// `Settings::default()` so the very first launch on a fresh machine works
/// without any setup.
pub fn load(path: &Path) -> Result<Settings, Error> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Settings::default());
        }
        Err(err) => return Err(Error::io(path, err)),
    };
    toml::from_str::<Settings>(&text).map_err(|source| Error::TomlParse {
        path: path.to_path_buf(),
        source,
    })
}

/// Write `settings` to `path`. Creates parent directories as needed.
/// The file is rewritten in full each call — there's no diffing layer.
pub fn save(path: &Path, settings: &Settings) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    }
    let text = toml::to_string_pretty(settings).map_err(|source| Error::TomlSerialize {
        path: path.to_path_buf(),
        source,
    })?;
    std::fs::write(path, text).map_err(|e| Error::io(path, e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_settings_path(suffix: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "lag-settings-{}-{}.toml",
            std::process::id(),
            suffix
        ))
    }

    #[test]
    fn missing_file_returns_default() {
        let path = tmp_settings_path("missing");
        let _ = std::fs::remove_file(&path);
        let got = load(&path).unwrap();
        assert_eq!(got, Settings::default());
        // Default appearance: everything "system"
        assert_eq!(got.appearance.time_mode, TimeMode::System);
        assert_eq!(got.appearance.season_mode, SeasonMode::System);
        assert_eq!(got.appearance.motion, Motion::System);
        // data.auto_rescan defaults to TRUE — explicit override of derived
        // Default to match phase-1 behavior.
        assert!(got.data.auto_rescan);
    }

    #[test]
    fn round_trip_preserves_values() {
        let path = tmp_settings_path("roundtrip");
        let s = Settings {
            appearance: Appearance {
                time_mode: TimeMode::Night,
                season_mode: SeasonMode::Winter,
                motion: Motion::Reduced,
            },
            data: DataSettings { auto_rescan: false },
        };
        save(&path, &s).unwrap();
        let back = load(&path).unwrap();
        assert_eq!(s, back);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn unknown_field_rejected() {
        // deny_unknown_fields keeps the TOML schema honest. If we drop a
        // field in v2, old settings files yell instead of silently losing
        // user intent.
        let path = tmp_settings_path("unknown");
        std::fs::write(
            &path,
            "[appearance]\ntime_mode = \"day\"\nflavor = \"chocolate\"\n",
        )
        .unwrap();
        let err = load(&path).unwrap_err();
        assert!(
            matches!(err, Error::TomlParse { .. }),
            "expected TomlParse, got {err:?}"
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn lowercase_serde_renames() {
        // Confirm the on-disk form uses lowercase, matching the spec doc.
        let s = Settings {
            appearance: Appearance {
                time_mode: TimeMode::Dusk,
                season_mode: SeasonMode::Autumn,
                motion: Motion::Off,
            },
            data: DataSettings { auto_rescan: true },
        };
        let text = toml::to_string(&s).unwrap();
        assert!(text.contains("time_mode = \"dusk\""), "got: {text}");
        assert!(text.contains("season_mode = \"autumn\""), "got: {text}");
        assert!(text.contains("motion = \"off\""), "got: {text}");
        assert!(text.contains("auto_rescan = true"), "got: {text}");
    }

    #[test]
    fn partial_file_uses_defaults_for_missing_sections() {
        let path = tmp_settings_path("partial");
        std::fs::write(&path, "[appearance]\ntime_mode = \"day\"\n").unwrap();
        let got = load(&path).unwrap();
        assert_eq!(got.appearance.time_mode, TimeMode::Day);
        // season_mode / motion default to System
        assert_eq!(got.appearance.season_mode, SeasonMode::System);
        assert_eq!(got.appearance.motion, Motion::System);
        // [data] section absent → DataSettings::default() → auto_rescan = true
        assert!(got.data.auto_rescan);
        std::fs::remove_file(&path).ok();
    }
}
