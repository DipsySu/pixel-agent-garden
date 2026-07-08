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

/// Top-level settings document. Most appearance fields default to a sentinel
/// ("system") meaning "follow the OS / current-time / default behavior".
/// Feature toggles default to the current product posture (for example the
/// v2.0 Agent Nursery uses `auto`, not the old disabled prototype state).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Settings {
    pub appearance: Appearance,
    pub data: DataSettings,
    pub integrations: Integrations,
    pub desktop: DesktopSettings,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Appearance {
    pub time_mode: TimeMode,
    pub season_mode: SeasonMode,
    pub motion: Motion,
    pub flowerbed: FlowerbedMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DataSettings {
    /// notify-driven live updates. When false, the frontend won't subscribe
    /// to `garden:updated` events — the user explicitly clicks "Refresh".
    pub auto_rescan: bool,
    /// Weekly recap offer (PRD 2.0 §P3-1). When true, the frontend offers
    /// last week's recap card once per week on the first open after a local
    /// Monday. Off silences the offer only — the share drawer still builds
    /// the card on demand (仪式感不等于强塞).
    pub weekly_recap: bool,
}

// Explicit Default for DataSettings — auto_rescan defaults to TRUE, matching
// the phase-1 behavior, and weekly_recap defaults to TRUE per the P3-1 spec
// ("静默可关" — opt-out, not opt-in). (`#[derive(Default)]` would give false
// for both.) Container-level `#[serde(default)]` routes files written before
// this field existed through this impl, so old settings.toml keep loading.
impl Default for DataSettings {
    fn default() -> Self {
        Self {
            auto_rescan: true,
            weekly_recap: true,
        }
    }
}

/// Desktop shell behavior. This is separate from `integrations` (terminal
/// launcher configuration) and from `appearance` (garden rendering choices).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DesktopSettings {
    /// Source of truth for the OS login item. The Tauri shell's `autostart`
    /// module reconciles OS state to this value at startup and after each
    /// settings save; core itself never touches the OS (spec §10 rule 1).
    pub launch_at_login: bool,
    /// When true, closing the main window hides it and keeps the tray resident.
    /// When false, the platform default close behavior is allowed.
    pub close_to_tray: bool,
}

/// Launcher integration settings (spec §Deferred — launcher integration).
/// Controls which terminal the tray / insight panel opens at a project root,
/// and how many top-token projects the tray lists. All additive over the
/// phase-1 schema; absent `[integrations]` falls back to these defaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Integrations {
    /// Which terminal app to launch.
    pub terminal: TerminalKind,
    /// Command template used only when `terminal == Custom`. `{path}` is
    /// replaced with the project root. Empty string = unset (Custom then
    /// errors at launch). A plain `String` (not `Option`) keeps TOML simple.
    pub terminal_command: String,
    /// How many top-token projects the tray lists.
    pub tray_top_n: usize,
}

// Explicit Default: terminal defaults to iTerm (project owner's choice), the
// custom template is empty, and the tray lists the top 5. `#[derive(Default)]`
// would give tray_top_n = 0 and the wrong terminal.
impl Default for Integrations {
    fn default() -> Self {
        Self {
            terminal: TerminalKind::ITerm,
            terminal_command: String::new(),
            tray_top_n: 5,
        }
    }
}

/// Terminal application to open a project root in. Unit variants serialize as
/// lowercase strings (`"iterm"`, `"warp"`, …); the custom command lives in
/// `Integrations::terminal_command`, so this stays a simple string enum in TOML.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalKind {
    /// macOS Terminal.app / platform default terminal.
    System,
    /// iTerm2 (macOS). Project default.
    #[default]
    ITerm,
    /// Warp (macOS).
    Warp,
    /// Use `Integrations::terminal_command` as a `{path}` template.
    Custom,
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

/// Flowerbed / Agent nursery view. `auto` is the v2.0 default: the web layer
/// shows the nursery when the summary has enough agent-source signal, while
/// still letting cautious users force it off. Old explicit `disabled` files
/// keep loading as disabled.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FlowerbedMode {
    #[default]
    Auto,
    Enabled,
    Disabled,
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
        source: Box::new(source),
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
        source: Box::new(source),
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
        assert_eq!(got.appearance.flowerbed, FlowerbedMode::Auto);
        // data.auto_rescan defaults to TRUE — explicit override of derived
        // Default to match phase-1 behavior. weekly_recap likewise (P3-1
        // is opt-out).
        assert!(got.data.auto_rescan);
        assert!(got.data.weekly_recap);
    }

    #[test]
    fn round_trip_preserves_values() {
        let path = tmp_settings_path("roundtrip");
        let s = Settings {
            appearance: Appearance {
                time_mode: TimeMode::Night,
                season_mode: SeasonMode::Winter,
                motion: Motion::Reduced,
                flowerbed: FlowerbedMode::Enabled,
            },
            data: DataSettings {
                auto_rescan: false,
                weekly_recap: false,
            },
            integrations: Integrations {
                terminal: TerminalKind::Warp,
                terminal_command: String::new(),
                tray_top_n: 8,
            },
            desktop: DesktopSettings {
                launch_at_login: true,
                close_to_tray: true,
            },
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
                flowerbed: FlowerbedMode::Disabled,
            },
            data: DataSettings {
                auto_rescan: true,
                weekly_recap: true,
            },
            integrations: Integrations {
                terminal: TerminalKind::ITerm,
                terminal_command: String::new(),
                tray_top_n: 5,
            },
            desktop: DesktopSettings {
                launch_at_login: false,
                close_to_tray: true,
            },
        };
        let text = toml::to_string(&s).unwrap();
        assert!(text.contains("time_mode = \"dusk\""), "got: {text}");
        assert!(text.contains("season_mode = \"autumn\""), "got: {text}");
        assert!(text.contains("motion = \"off\""), "got: {text}");
        assert!(text.contains("flowerbed = \"disabled\""), "got: {text}");
        assert!(text.contains("auto_rescan = true"), "got: {text}");
        assert!(text.contains("weekly_recap = true"), "got: {text}");
        assert!(text.contains("terminal = \"iterm\""), "got: {text}");
        assert!(text.contains("close_to_tray = true"), "got: {text}");
    }

    #[test]
    fn integrations_default_is_iterm_top5() {
        let d = Integrations::default();
        assert_eq!(d.terminal, TerminalKind::ITerm);
        assert!(d.terminal_command.is_empty());
        assert_eq!(d.tray_top_n, 5);
    }

    #[test]
    fn missing_integrations_section_uses_defaults() {
        // A phase-1 settings.toml has no [integrations]; it must load cleanly
        // and fall back to the defaults rather than erroring.
        let path = tmp_settings_path("no-integrations");
        std::fs::write(&path, "[appearance]\ntime_mode = \"day\"\n").unwrap();
        let got = load(&path).unwrap();
        assert_eq!(got.integrations, Integrations::default());
        assert_eq!(got.desktop, DesktopSettings::default());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn custom_terminal_round_trips() {
        let path = tmp_settings_path("custom-term");
        let s = Settings {
            integrations: Integrations {
                terminal: TerminalKind::Custom,
                terminal_command: "alacritty --working-directory {path}".to_string(),
                tray_top_n: 10,
            },
            ..Settings::default()
        };
        save(&path, &s).unwrap();
        assert_eq!(load(&path).unwrap(), s);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn data_section_without_weekly_recap_defaults_true() {
        // A settings.toml written before P3-1 has [data] with only
        // auto_rescan; it must load with weekly_recap = true (opt-out
        // default) instead of erroring or flipping the user to false.
        let path = tmp_settings_path("no-weekly-recap");
        std::fs::write(&path, "[data]\nauto_rescan = false\n").unwrap();
        let got = load(&path).unwrap();
        assert!(!got.data.auto_rescan);
        assert!(got.data.weekly_recap);
        std::fs::remove_file(&path).ok();
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
        assert_eq!(got.appearance.flowerbed, FlowerbedMode::Auto);
        // [data] section absent → DataSettings::default() → auto_rescan = true
        assert!(got.data.auto_rescan);
        std::fs::remove_file(&path).ok();
    }
}
