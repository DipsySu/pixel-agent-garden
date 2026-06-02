//! Terminal launcher — the one place that turns a `TerminalKind` + project
//! path into a terminal opened at that directory.
//!
//! Modularity (spec §Deferred — launcher integration): this is the *only*
//! module that knows how to spawn a terminal, so swapping the mechanism (a new
//! terminal app, a different Linux strategy) touches this file alone. The
//! command construction is a pure function, `build_command`, so every OS and
//! branch is unit-tested without ever spawning a process; `open` is the thin
//! impure wrapper that actually spawns.
//!
//! This is the first place the app launches an external process. It runs only
//! on an explicit user action (tray row / panel button click), never during
//! scan or render — the privacy contract (no network, no writing source dirs)
//! is unaffected.

use local_agent_garden_core::settings::{Integrations, TerminalKind};
use std::process::Command;

/// Build target OS, chosen at compile time but representable as a value so the
/// pure builder can be tested for every platform on any host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetOs {
    MacOs,
    Windows,
    Linux,
}

impl TargetOs {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            TargetOs::MacOs
        } else if cfg!(target_os = "windows") {
            TargetOs::Windows
        } else {
            TargetOs::Linux
        }
    }
}

/// Build the `(program, args)` that opens `path` in the chosen terminal on
/// `os`. Pure: no spawning, no env, no filesystem — fully unit-testable.
///
/// A `Custom` template wins on any OS; `{path}` is substituted with a
/// shell-quoted project path and run through the platform shell. iTerm / Warp
/// are macOS-only, so on Windows / Linux the app-specific kinds fall back to
/// the platform's default-terminal strategy.
pub fn build_command(
    kind: TerminalKind,
    custom_template: &str,
    path: &str,
    os: TargetOs,
) -> Result<(String, Vec<String>), String> {
    if kind == TerminalKind::Custom {
        let tpl = custom_template.trim();
        if tpl.is_empty() {
            return Err("custom terminal selected but no command template set".into());
        }
        return Ok(shell_command(
            os,
            &tpl.replace("{path}", &quote_path(os, path)),
        ));
    }

    match os {
        TargetOs::MacOs => {
            let app = match kind {
                TerminalKind::System => "Terminal",
                TerminalKind::ITerm => "iTerm",
                TerminalKind::Warp => "Warp",
                TerminalKind::Custom => unreachable!("handled above"),
            };
            Ok(("open".into(), vec!["-a".into(), app.into(), path.into()]))
        }
        // Windows Terminal opens a new tab at the directory. iTerm/Warp don't
        // exist here, so every non-custom kind uses `wt`.
        TargetOs::Windows => Ok(("wt".into(), vec!["-d".into(), path.into()])),
        // x-terminal-emulator is the Debian-alternatives indirection most
        // distros provide; it honors the user's configured default terminal.
        TargetOs::Linux => Ok((
            "x-terminal-emulator".into(),
            vec!["--working-directory".into(), path.into()],
        )),
    }
}

fn shell_command(os: TargetOs, rendered: &str) -> (String, Vec<String>) {
    match os {
        TargetOs::Windows => ("cmd".into(), vec!["/C".into(), rendered.to_string()]),
        _ => ("/bin/sh".into(), vec!["-c".into(), rendered.to_string()]),
    }
}

fn quote_path(os: TargetOs, path: &str) -> String {
    match os {
        TargetOs::Windows => quote_windows_cmd_arg(path),
        _ => quote_posix_shell_arg(path),
    }
}

fn quote_posix_shell_arg(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn quote_windows_cmd_arg(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

/// Open `path` in the user's configured terminal. Thin impure wrapper around
/// `build_command` — the only function here that spawns a process. Returns a
/// human-readable error string suitable for the `garden:error` toast pipeline.
pub fn open(integrations: &Integrations, path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("no project path to open".into());
    }
    let (program, args) = build_command(
        integrations.terminal,
        &integrations.terminal_command,
        path,
        TargetOs::current(),
    )?;
    Command::new(&program)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("launch {program}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_maps_each_kind_to_open_dash_a() {
        let p = "/Users/me/proj";
        assert_eq!(
            build_command(TerminalKind::System, "", p, TargetOs::MacOs).unwrap(),
            (
                "open".into(),
                vec!["-a".into(), "Terminal".into(), p.into()]
            )
        );
        assert_eq!(
            build_command(TerminalKind::ITerm, "", p, TargetOs::MacOs).unwrap(),
            ("open".into(), vec!["-a".into(), "iTerm".into(), p.into()])
        );
        assert_eq!(
            build_command(TerminalKind::Warp, "", p, TargetOs::MacOs).unwrap(),
            ("open".into(), vec!["-a".into(), "Warp".into(), p.into()])
        );
    }

    #[test]
    fn custom_template_substitutes_path_via_shell() {
        let (prog, args) = build_command(
            TerminalKind::Custom,
            "alacritty --working-directory {path}",
            "/Users/me/Obsidian Vault",
            TargetOs::MacOs,
        )
        .unwrap();
        assert_eq!(prog, "/bin/sh");
        assert_eq!(
            args,
            vec![
                "-c",
                "alacritty --working-directory '/Users/me/Obsidian Vault'"
            ]
        );
    }

    #[test]
    fn custom_template_shell_quotes_single_quotes() {
        let (_, args) = build_command(
            TerminalKind::Custom,
            "open_here {path}",
            "/tmp/it's here",
            TargetOs::Linux,
        )
        .unwrap();
        assert_eq!(args, vec!["-c", "open_here '/tmp/it'\"'\"'s here'"]);
    }

    #[test]
    fn custom_template_uses_cmd_on_windows() {
        let (prog, args) = build_command(
            TerminalKind::Custom,
            "wt -d {path}",
            "C:/Users/me/My Project",
            TargetOs::Windows,
        )
        .unwrap();
        assert_eq!(prog, "cmd");
        assert_eq!(args, vec!["/C", "wt -d \"C:/Users/me/My Project\""]);
    }

    #[test]
    fn empty_custom_template_is_an_error() {
        let err = build_command(TerminalKind::Custom, "   ", "/a", TargetOs::MacOs).unwrap_err();
        assert!(err.contains("no command template"), "got: {err}");
    }

    #[test]
    fn windows_and_linux_fall_back_for_app_kinds() {
        // iTerm requested on Linux → x-terminal-emulator, not an error.
        assert_eq!(
            build_command(TerminalKind::ITerm, "", "/a/b", TargetOs::Linux).unwrap(),
            (
                "x-terminal-emulator".into(),
                vec!["--working-directory".into(), "/a/b".into()]
            )
        );
        // Warp requested on Windows → wt.
        assert_eq!(
            build_command(TerminalKind::Warp, "", "C:/p", TargetOs::Windows).unwrap(),
            ("wt".into(), vec!["-d".into(), "C:/p".into()])
        );
    }
}
