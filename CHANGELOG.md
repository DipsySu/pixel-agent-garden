# Changelog

## Unreleased

## v0.1.1 - 2026-06-04

- Decoded each Claude project directory name at most once per scan. The
  directory→path decode is invariant across a project's session files but now
  probes the filesystem (up to ~4096 `exists()` calls for hyphen-rich Windows
  names); `ClaudeCodeAdapter::collect` previously recomputed it per session, so
  it is memoized by directory to avoid repeating that work on every rescan.
- Routed the Cowork directory-name fallback through the shared
  `project_from_claude_dir` decoder instead of a second inline dash-split, so
  Cowork sessions also benefit from Windows drive-name decoding and the POSIX
  logic lives in one place.
- Added best-effort Windows decoding for Claude project directory fallbacks.
  Directory names like `D--code-xiaowo` now decode to `D:\code\xiaowo`; when a
  component may contain literal hyphens, the decoder chooses a single existing
  local path candidate if one is available, otherwise falls back to the
  separator-split form. These paths remain `path_source=inferred`: the UI still
  treats them as approximate and will not offer "open in terminal".
- Marked reverse-decoded project paths as inferred instead of treating them as
  real. When a Claude Code / Cowork session has no trustworthy `cwd` (or
  user-selected folder), the project path is reverse-engineered from the
  encoded directory name — a `/`→`-` mapping that is lossy and ambiguous, and
  on Windows often produces garbled names. Such events now carry
  `metadata["path_source"]="inferred"`, aggregation rolls this up into a new
  `ProjectGrowth.path_inferred` flag (true only when NO contributing event had
  a trustworthy path; `#[serde(default)]`, summary schema bumped 3 → 4), and the
  Insight panel hides the "open in terminal" action for such rows and tags them
  "≈ 推测路径". Deliberately conservative: this does NOT change `project_key`,
  does NOT merge paths, and does NOT promote directory-name fallbacks to
  trustworthy filesystem paths.
- Fixed duplicate project rows in the Insight panel caused by the same
  directory being recorded under different path spellings. `event.rs`
  `normalize_path()` now also does safe Windows normalization — strips the
  `\\?\` verbatim prefix, unifies `/`→`\`, drops trailing separators, and
  upper-cases the drive letter — so `\\?\D:\code\x`, `D:/code/x/`, and
  `d:\code\x` collapse to one aggregation key. This is spelling-only: it never
  merges genuinely distinct directories (two real dirs named `xiaowo_sport`
  stay separate), keeps POSIX paths and the dash-decoded Claude fallback
  untouched, and does not change any on-disk JSON shape (no `schema_version`
  bump). The lossy `-Users-foo-` directory-name fallback is intentionally left
  for separate, source-aware handling.
- Made the Insight panel disambiguate same-named projects: every row now
  carries its full path as a hover tooltip, and rows whose basename is
  duplicated show a muted path subtitle so distinct directories are
  distinguishable at a glance.
- Styled the Insight and Settings popovers' scrollbars to match the dark pixel
  theme (scoped `::-webkit-scrollbar` + Firefox `scrollbar-color`), so the
  light OS-default scrollbar no longer shows through. Scoped to those two
  containers — no global scrollbar override.
- Added cache-first desktop summary loading: Tauri startup now reads
  `~/.local-agent-garden/events.json` when possible, falls back to a fresh
  scan when the cache is missing or incompatible, and both Scan Now plus
  watcher updates refresh the cache.
- Added visible scan/freshness feedback in the desktop footer: watcher and
  tray-triggered scans emit `garden:scanning`, the footer pulses while local
  data is being read, and auto-rescan-disabled updates now show a clear
  "scanned, refresh paused" state instead of silently doing nothing.
- Added token insight foundations: `daily_tokens` now records honest per-day
  token totals separately from `daily_activity`, summary/events schema versions
  are split, and `top_by_tokens` provides a reusable core ranking primitive.
- Added gentle token insight UI: project info cards show a 14-day token
  sparkline, and a footer Insight panel lists top token projects with their own
  sparklines without turning the garden into a dashboard.
- Moved the token→vine size mapping into core as `size_level` / `size_strength`
  on each project (computed from the whole token distribution, schema v3). The
  port is a bit-exact replica of the former render-garden.js formula, so vine
  sizing is unchanged; the frontend now reads these fields and only maps them to
  pixel width/opacity, falling back to the local formula for summaries without
  the fields.
- Added a terminal launcher: a `[integrations]` settings section
  (`terminal` = system/iterm/warp/custom with a `{path}` template,
  `terminal_command`, `tray_top_n`, defaulting to iTerm / top 5), an
  `open_in_terminal` command, and a replaceable `terminal.rs` whose
  command-building is a pure, per-OS unit-tested function. The tray gained a
  "Top Token Projects" submenu (rebuilt on `garden:updated`) and the Insight
  panel rows gained an open-terminal button — both open the project root in the
  configured terminal. The frontend settings round-trip now preserves the
  `integrations` section instead of resetting it on save.

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
