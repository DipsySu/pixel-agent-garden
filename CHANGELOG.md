# Changelog

## Unreleased

- Added cache-first desktop summary loading: Tauri startup now reads
  `~/.local-agent-garden/events.json` when possible, falls back to a fresh
  scan when the cache is missing or incompatible, and both Scan Now plus
  watcher updates refresh the cache.

## v0.1.0 - 2026-05-29

- Added season particles (Phase 2.5): autumn maple leaves, summer dusk/night fireflies, and winter snowflakes now spawn from manifest-driven transparent PNG sprites in `assets/sprites/season_particles/`. The particle layer is CSS-keyframed, cleared on re-render, and respects `data-season`, `data-time-mode`, `data-motion`, and `prefers-reduced-motion`.
- Added desktop tray + app menu controls (Phase 3): show/hide the garden window, run Scan Now through the existing watcher scan path, open `settings.toml`, open `~/.local-agent-garden`, and quit. Closing the main window now hides to the tray instead of exiting.
- Added GitHub Actions CI/CD (Phase 3.1). `ci.yml`: a rustfmt gate plus a clippy + test matrix across macOS/Windows/Linux on MSRV 1.85.0 (`cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`), with the Tauri 2 Linux deps and rust-cache. `release.yml`: a `v*` tag or manual `release_tag` runs a three-platform `tauri-action` build that attaches `.dmg` / `.deb` + AppImage / NSIS bundles to a draft GitHub Release.
- Enabled app bundling (Phase 3): `tauri.conf.json#bundle.active = true` with an explicit icon list and macOS metadata (category, copyright, short/long description, `minimumSystemVersion`). Generated the full icon set — `icon.icns` (through 512@2x) and `icon.ico` (16–256) from the 512px source — replacing the PNG-only placeholders. Verified `cargo tauri build` on macOS produces a valid unsigned `.dmg`.
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
