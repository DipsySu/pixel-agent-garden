# Changelog

## Unreleased

- Removed the old Python prototype and made Rust the only product runtime.
- Added the Rust `claude-cowork` adapter for Claude Desktop Cowork local agent sessions.
- Added scan-level uuid dedupe so duplicate Cowork/Claude transcript rows are counted once.
- Added settings TOML support and Tauri `get_settings` / `set_settings` commands.

## v1.0.0 - 2026-05-28

- Added local-only adapters for Claude Code, Codex, and manual JSONL imports.
- Added normalized project summaries with tokens, sessions, cache ratio, models, recent activity, and source counts.
- Added CLI views for scanning, listing projects, inspecting one project, and rendering an ASCII garden.
- Added `export-web` for generating `web/data/garden-summary.json`.
- Added a sprite-based desktop pixel garden with one vine per project, token-scaled vine sizing, project chips, hover/focus details, pavilion unlock tiers, trinkets, stone cat, seasonal header text, and local-data freshness.
- Added generated pixel assets for vines, courtyard objects, pavilion trinkets, stone cat, and mountains.
- Kept the privacy boundary explicit: source directories are read-only and the app performs no network requests.
