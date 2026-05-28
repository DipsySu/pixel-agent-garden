# Tauri + Rust Runtime Spec

> Status: Rust-only runtime. The Python prototype has been removed.

## Goals

- Keep all product logic in Rust.
- Use `crates/core` as the single source for adapters, scan orchestration,
  aggregation, settings, and storage.
- Use `crates/cli` as the terminal interface.
- Use `crates/tauri-app` as the desktop shell and file watcher.
- Keep `web/` as the pixel garden frontend, with no scanner logic in JS.

## Non-Goals

- No Python runtime or package.
- No telemetry.
- No plugin system before v2.
- No i18n before the product shape settles.

## Workspace Layout

```text
Cargo.toml
crates/
├── core/
│   └── src/
│       ├── adapter.rs
│       ├── adapters/
│       │   ├── claude_code.rs
│       │   ├── claude_cowork.rs
│       │   ├── codex.rs
│       │   ├── manual_jsonl.rs
│       │   └── util.rs
│       ├── aggregate.rs
│       ├── event.rs
│       ├── registry.rs
│       ├── scan.rs
│       ├── settings.rs
│       └── storage.rs
├── cli/
└── tauri-app/
web/
assets/sprites/
```

## Adapter Contract

Adapters implement:

```rust
pub trait Adapter: Send + Sync {
    fn name(&self) -> &str;
    fn discover(&self, ctx: &AdapterContext) -> bool;
    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error>;
    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> { Vec::new() }
}
```

Rules:

- Adapters are read-only.
- Adapters do not call each other.
- Cross-source logic, including dedupe, lives in `scan.rs`.
- Bad rows are skipped; I/O and database failures return typed `Error`.
- Source-specific details go into `AgentEvent.metadata`.

## Built-In Adapters

- `claude-code`: reads Claude Code JSONL transcripts.
- `claude-cowork`: reads Claude Desktop Cowork embedded Claude Code transcripts.
- `codex`: reads Codex SQLite/session/rollout local state.
- `manual-jsonl`: escape hatch for local agents without native adapters.

## Schema Versioning

`GardenSummary` and the `events.json` cache envelope (`EventsCache`) both
carry a top-level `schema_version: 1` field (see `aggregate::SCHEMA_VERSION`).
Readers reject any cache whose version exceeds what they know and fall back
to a fresh scan. Legacy unwrapped event arrays (pre-versioning) still load
so existing users don't pay a forced rescan on upgrade.

Bump `SCHEMA_VERSION` on any backward-incompatible shape change
(renamed/removed field, semantic redefinition).

## Settings

User settings live at `~/.local-agent-garden/settings.toml`.

```toml
[appearance]
time_mode = "system"      # system | day | dusk | night
season_mode = "system"    # system | spring | summer | autumn | winter
motion = "system"         # system | reduced | off

[data]
auto_rescan = true
```

`core/src/settings.rs` is the only settings I/O entry point. Tauri exposes:

- `get_settings() -> Settings`
- `set_settings(Settings) -> Settings`

## Tauri Commands

- `garden_summary() -> GardenSummary`
- `trigger_scan() -> GardenSummary`
- `list_adapters() -> Vec<AdapterStatus>`
- `data_freshness() -> Option<String>`
- `get_settings() -> Settings`
- `set_settings(Settings) -> Settings`

Heavy work runs in `spawn_blocking`; `core` remains synchronous and UI-free.

## Tauri Events

- `garden:updated`: emitted after a debounced watcher rescan.
- `garden:error`: emitted on watcher / scan / settings failures. Payload is
  `{ source: "watcher" | "scan" | "settings" | ..., message: string,
  adapter?: string }`. The frontend renders this as a bottom-right toast.

Reserved (defined but not yet emitted):

- `garden:scanning`: future progress signal for long-running scans.

## Frontend Contract

`web/` is a static frontend. Runtime data comes from:

- Tauri: `window.__TAURI__.core.invoke("garden_summary")` and
  `garden:updated`.
- Browser fallback: `web/data/garden-summary.json`.

Module split:

- `garden.js`: entry
- `data-source.js`: Tauri/fetch data source (`loadSummary`, `loadSettings`,
  `setSettings`, `subscribeGardenUpdates`, `subscribeGardenErrors`)
- `settings-panel.js`: inline settings UI (gear button + form), debounced save
- `error-toast.js`: bottom-right toast layer for `garden:error` events and
  frontend `logGardenError` calls
- `scene-config.js`: thresholds and visual settings
- `render-svg.js`: static base scene
- `render-garden.js`: dynamic sprite rendering (`renderEverything`,
  `updateSettings`)
- `render-helpers.js`: shared render helpers

## Privacy

- No scan-time network requests.
- No analytics.
- No writes to source agent directories.
- Generated cache lives under `~/.local-agent-garden/`.

## Phase Plan

### Phase 1: Core + CLI

Done.

- Rust workspace.
- Native adapters for Claude Code, Claude Cowork, Codex, manual JSONL.
- Aggregation and ASCII garden.
- Python prototype removed.

### Phase 2: Desktop App

Done.

- Tauri shell.
- File watcher.
- Live garden updates.
- Modular web frontend.
- Basic settings commands.

### Phase 3: Distribution

Next.

- App menu and system integration.
- Status/menu bar behavior.
- UI error surface.
- Settings UI.
- Signed macOS `.dmg`, Windows installer, Linux AppImage.

### Phase 3.1: CI/CD + Auto-Update

- GitHub Actions matrix for macOS, Windows, Linux.
- `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
  and `cargo test --workspace`.
- Release artifacts uploaded to GitHub Releases.
- Tauri updater plugin once signing is ready.

## Modularity Rules

1. `core` must not depend on Tauri, Wry, or web APIs.
2. Adapter files must not call one another.
3. CLI and Tauri commands are thin wrappers around `core`.
4. Watcher subscribes to `Adapter::watch_paths()` and performs debounced
   rescans; it does not parse agent files.
5. JS stays in `web/`.
6. Public Rust APIs return typed `Error`, not `Box<dyn Error>`.
