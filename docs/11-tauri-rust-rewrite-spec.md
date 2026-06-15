# Tauri + Rust Runtime Spec

> Status: Rust-only runtime. The Python prototype has been removed.

## Goals

- Keep all product logic in Rust.
- Use `crates/core` as the single source for adapters, scan orchestration,
  aggregation, cached summary loading, settings, and storage.
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
│       ├── cache.rs
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
carry a top-level `schema_version`, but their version constants are deliberately
split:

- `aggregate::SUMMARY_SCHEMA_VERSION` tracks the serialized `GardenSummary`
  shape.
- `storage::EVENTS_SCHEMA_VERSION` tracks the on-disk raw event cache.

Readers reject any event cache whose version exceeds what they know and fall
back to a fresh scan. Legacy unwrapped event arrays (pre-versioning) still load
so existing users don't pay a forced rescan on upgrade.

Bump the matching version constant on any backward-incompatible shape change
(renamed/removed field, semantic redefinition). Additive summary fields should
use `#[serde(default)]` so older summaries still deserialize.

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

- `garden_summary() -> GardenSummary`: load `~/.local-agent-garden/events.json`
  when it is **fresh**; if it is missing, malformed, from an incompatible future
  schema, carries no fingerprint, or its source fingerprint no longer matches
  the agent logs on disk, run a fresh scan and replace the cache. Freshness is a
  metadata-only check (total bytes + newest mtime + file count across adapter
  `watch_paths()`) — see `core::cache::source_fingerprint`; no source file is
  re-parsed just to decide staleness. Byte total is what catches in-place
  appends to an active session log within one coarse mtime tick.
- `trigger_scan() -> GardenSummary`: force a fresh scan, write
  `~/.local-agent-garden/events.json`, and return the new summary.
- `list_adapters() -> Vec<AdapterStatus>`
- `data_freshness() -> Option<String>`
- `get_settings() -> Settings`
- `set_settings(Settings) -> Settings`

Heavy work runs in `spawn_blocking`; `core` remains synchronous and UI-free.

## Tauri Events

- `garden:scanning`: emitted before tray-triggered and watcher-triggered
  rescans. Payload is `{ adapter?: string }`. The frontend uses this as a
  lightweight status signal, not a progress bar.
- `garden:updated`: emitted after a debounced watcher rescan.
- `garden:error`: emitted on watcher / scan / settings failures. Payload is
  `{ source: "watcher" | "scan" | "settings" | ..., message: string,
  adapter?: string }`. The frontend renders this as a bottom-right toast.

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
- `render-garden.js`: dynamic sprite rendering (`renderEverything`)
- `render-helpers.js`: shared render helpers

## Visual Scene Contract

The scene is a single SVG (`pg6-scene`) plus an absolutely-positioned
sprite layer. The base SVG is rebuilt by `render-svg.js#renderBaseScene`
on every settings change; sprite layers are rebuilt by
`render-garden.js#renderEverything` on every data change. Both functions
read the same `Settings` shape (see §Settings).

### Time resolution

`render-svg.js#resolveTimeScene(settings)` returns a palette for one of
three modes:

| Mode  | System hour range (local)            |
|-------|--------------------------------------|
| day   | `06:00 ≤ hour < 16:30`               |
| dusk  | `16:30 ≤ hour < 19:30`               |
| night | everything else                      |

If `settings.appearance.time_mode` is `system`, the mode comes from the
table above and the sun arcs along
`y = 72 − sin(((hour−6)/12) · π) · 42`,
`x = −20 + ((hour−6)/12) · 720`,
clamped to a reasonable horizon for `dusk`. If `time_mode` is one of
`day | dusk | night`, the sun/moon position is pinned to a fixed point
so the user sees a stable scene regardless of clock.

Each mode contributes: a three-stop sky linear gradient (top/mid/bottom),
cloud palette (day) or star field (night), wood-eave wood triplet,
sun/moon orb colors, and `mountain{Far,Near}Opacity`. The `skyMid` stop
is mandatory — without it the gradient ends up a visible seam at the old
y=70 boundary.

### Season resolution

`render-svg.js#resolveSeasonScene(settings)` returns a palette for one
of four modes. If `settings.appearance.season_mode` is `system`:

| Mode   | Months (local)            |
|--------|---------------------------|
| spring | 3 – 5                     |
| summer | 6 – 8                     |
| autumn | 9 – 11                    |
| winter | 12, 1, 2                  |

Each palette contributes: a four-stop ground band, a grass-dot color, a
wildflower color list, and a flower count. The scene writes
`scene.dataset.season` and `scene.dataset.seasonLabel` so CSS in
`index.html` can tint the cherry, willow, and vine sprites without
rebuilding the sprite layer, while the header can display the resolved
season without re-deriving it.

### Motion policy

`settings.appearance.motion` controls ambient animation. The scene
writes `scene.dataset.motion` so all CSS rules can pivot off it.
It also writes `scene.dataset.timeMode` and `scene.dataset.timeLabel`;
dynamic sprite logic reads those resolved values instead of reading
settings directly.

| Setting   | Behavior                                                |
|-----------|---------------------------------------------------------|
| `system`  | follow `prefers-reduced-motion`                         |
| `reduced` | slow keyframes, no large translations                   |
| `off`     | no keyframes at all                                     |

Concrete animations defined today (all gated by
`@media (prefers-reduced-motion: no-preference)` and overridden by
`[data-motion="off"]` / `[data-motion="reduced"]` selectors):

| Keyframe              | Target                          | Duration |
|-----------------------|---------------------------------|----------|
| `pg6-trinket-nod`     | `.pg6-trinket-sprite`           | 3.6s     |
| `pg6-vine-sway`       | `.pg6-sprite.project.hanging`   | 4.2s     |
| `pg6-vine-breathe`    | `.pg6-sprite.project.climbing`  | 5.2s     |
| `pg6-lantern-pulse`   | `.pg6-sprite.decor-lantern.is-lit` | 2.2s  |
| `pg6-petal-fall`      | `.pg6-petal` (spring only)      | 7–12s    |
| `pg6-vine-grow-in`    | newly-seen project vines        | 700–760ms |
| `pg6-trinket-drop-in` | newly-unlocked pavilion trinkets | 640ms   |

Petals are gated on `[data-season="spring"]` via `display: none` for
the other seasons, so the cherry tree drops its blossom only when it
makes sense. Entrance animations are one-shot: `render-garden.js`
diffs `project_key`s and unlocked trinket ids against a persisted
localStorage seen-set, applies `.is-new` only on first sighting, then
lets CSS run the grow/drop keyframes. `data-motion="reduced"` skips
the entrance transform and keeps only slowed ambient loops;
`data-motion="off"` disables animation entirely.

### Lantern brightness

The lantern sprite has two states. The lit state applies when **either**:

- `tiers.lamp === 'lit'` (any activity today), or
- `time_mode` resolves to `dusk` or `night`.

Lit lanterns get full opacity and the `pg6-lantern-pulse` animation;
unlit lanterns render at 0.82 opacity with no animation. This double
trigger keeps the lantern lit at night even on quiet days.

### Empty / failure states

- No projects in `summary`: `renderEmptyState()` paints a single
  dashed placeholder vine and the info card switches to a
  "waiting for activity" label. No sprites are loaded.
- Bootstrap failure (manifest fetch, settings invoke): the base scene
  still renders with `settings: null` defaults so the page never sits
  blank. The failure is surfaced as a toast via `logGardenError`.
- Watcher / scan / settings errors from Rust surface via
  `garden:error` → `error-toast.js`. Toasts collapse by `source` so a
  burst from one call site does not flood the UI.
- Watcher / tray rescans surface `garden:scanning` before work starts.
  The footer switches to a pulsing scanning state and clears on the next
  `garden:updated`; if auto-rescan is off, the footer says the cache was
  updated while visual repaint remains paused.

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

### Phase 2.5: Visual Evolution

Done.

- Day / dusk / night palette with sun arc and star field at night.
- Spring / summer / autumn / winter ground band + flowers + sprite tint.
- Five ambient keyframes (`pg6-trinket-nod`, `pg6-vine-sway`,
  `pg6-vine-breathe`, `pg6-lantern-pulse`, `pg6-petal-fall`) gated by
  `data-motion` and `prefers-reduced-motion`.
- Vine grow-in for newly-seen `project_key`s, one-shot and persisted
  across settings toggles / watcher re-renders.
- Trinket drop-in for newly-unlocked pavilion thresholds, one-shot and
  persisted across settings toggles / watcher re-renders.
- Season particles: autumn maple leaves, summer-night fireflies,
  winter snowflakes. Particle sprites live in
  `assets/sprites/season_particles/`, render from the manifest groups
  `maple_leaf` / `firefly` / `snowflake`, and are gated by
  `data-season`, `data-time-mode`, `data-motion`, and
  `prefers-reduced-motion`.

### Phase 3: Desktop Integration + Distribution

In progress.

Done:

- UI error surface (`garden:error` → toast).
- Settings UI (inline footer panel backed by `settings.toml`).
- Bundling enabled: `tauri.conf.json#bundle.active = true` with
  `targets: "all"`, an explicit `icon` list, and macOS metadata
  (`category`, `copyright`, short/long description,
  `macOS.minimumSystemVersion`). Full icon set now ships — `icon.icns`
  (16→512@2x) and `icon.ico` (16→256) generated from the 512px source,
  replacing the PNG-only placeholders.
- First local unsigned macOS build verified: `cargo tauri build`
  produces `Local Agent Garden.app` and
  `Local Agent Garden_0.1.0_x64.dmg`; `hdiutil verify` passes.
- App menu and tray controls (`tauri::tray` + `tauri::menu`): show/hide
  the garden window, trigger a fresh scan, open `settings.toml`, open the
  local data folder, and quit. Closing the main window now hides it to the
  tray instead of exiting.
- Footer freshness state: cached summaries show relative data freshness;
  manual and watcher rescans show a pulsing scanning state.

Next:

- Signing / notarization for macOS distribution; Windows installer and
  Linux AppImage follow on their hosts.

### Phase 3.1: CI/CD + Auto-Update

In progress.

Done:

- GitHub Actions CI (`.github/workflows/ci.yml`): a `rustfmt` gate plus a
  `clippy + test` matrix across macOS, Windows, and Linux running
  `cargo clippy --workspace --all-targets -- -D warnings` and
  `cargo test --workspace` on the declared MSRV (`1.85.0`). The Linux job
  installs the Tauri 2 webkit2gtk-4.1 + GTK/appindicator/pkg-config stack;
  builds are cached with `Swatinem/rust-cache`.
- Release workflow (`.github/workflows/release.yml`): a `v*` tag (or manual
  dispatch with `release_tag`) drives a three-platform
  `tauri-apps/tauri-action` build that attaches `.dmg` / `.deb` + AppImage /
  NSIS bundles to a draft GitHub Release. Manual dispatch without
  `release_tag` is a bundle validation run. Per-OS `--bundles` keep each host
  to the formats it can produce.

Next:

- Tauri updater plugin once signing is ready (CI release job is the hook
  point: add signing keys + the `updater` artifact target there).

## Modularity Rules

1. `core` must not depend on Tauri, Wry, or web APIs.
2. Adapter files must not call one another.
3. CLI and Tauri commands are thin wrappers around `core`.
4. Watcher subscribes to `Adapter::watch_paths()` and performs debounced
   rescans; it does not parse agent files.
5. JS stays in `web/`.
6. Public Rust APIs return typed `Error`, not `Box<dyn Error>`.
7. Visual scene resolution (`resolveTimeScene` / `resolveSeasonScene`)
   lives only in `render-svg.js`. `render-garden.js` reads
   `scene.dataset.{timeMode,season,motion}` if it needs to branch — it
   never re-derives the mode from `settings` or `Date.now()`. This keeps
   the source of truth single and the two layers in sync.
8. Animation rules are CSS-only and gated by
   `[data-motion="reduced|off"]` selectors plus
   `@media (prefers-reduced-motion: reduce)`. JS never spawns
   `requestAnimationFrame` loops for ambient motion.
