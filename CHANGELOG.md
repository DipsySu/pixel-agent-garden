# Changelog

## Unreleased

- Added one-shot entrance animations (Phase 2.5): newly-seen project vines grow in (`pg6-vine-grow-in`) and newly-unlocked pavilion trinkets drop in (`pg6-trinket-drop-in`). A persisted seen-set (localStorage, in-memory fallback) diffs each render so entrances never replay on settings toggles or watcher ticks; a first-run reveal cascades via per-item stagger delay. Both compose with the existing ambient loop and are gated by `data-motion` / `prefers-reduced-motion` (reduced and off skip the entrance entirely).
- Added inline settings panel in the footer — gear button reveals time / season / motion / auto-rescan controls with optimistic save and live scene re-paint.
- Added `garden:error` event pipeline: watcher and scan failures now surface as bottom-right toasts instead of dying silently in stderr.
- Made `auto_rescan` runtime-toggleable: the toggle now gates UI re-renders directly so users don't have to restart the app.
- Season setting now actually changes the scene: per-season ground palette, flower count + colors, and CSS hue/sepia tweaks for the cherry and willow sprites via `data-season`.
- Sky uses a 3-stop linear gradient with a soft wood-eave shadow, removing the hard horizontal seam at the old skyTop / skyBottom boundary.
- Implemented `schema_version: 1` on `GardenSummary` and the `events.json` envelope (spec §Schema Versioning). Caches with an unknown future version are rejected; legacy unwrapped arrays still load for upgrade compatibility.
- Cleaned up hardcoded placeholder strings (`春 · 谷雨`, `等待数据`, etc.) so loading and failure states no longer show stale demo text.
- The base scene now renders with default settings even when bootstrap fails, so the page never sits blank on a fetch error.

## v1.0.1

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
