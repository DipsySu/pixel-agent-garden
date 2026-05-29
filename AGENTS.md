# AGENTS.md

Onboarding notes for AI coding agents working in this repository. This is the
tool-neutral version of `CLAUDE.md`: Codex, Claude Code, Cursor, and other
local agents should read this before touching code. Humans should start with
`README.md`.

## Product In One Line

Pixel Agent Garden turns local AI agent activity (Claude Code / Claude Cowork /
Codex / future adapters) into a digital garden:

`local source files` -> `AgentEvent` -> `GardenSummary` -> CLI ASCII wall /
Tauri desktop pixel garden.

Privacy is the product boundary: no network requests, no telemetry, and no
writes to source agent directories.

## Read First

1. `docs/11-tauri-rust-rewrite-spec.md` — architecture contract, modularity
   rules, phase plan, schema versioning.
2. `docs/architecture.md` — data flow and adapter contract.
3. `RUST.md` — Rust workspace and watcher notes.
4. `README.md` — user-facing CLI / Tauri usage.
5. `CHANGELOG.md` — current state of the project. Treat `## Unreleased` as the
   freshest source of truth.

## Workspace Map

```text
crates/
├── core/        # pure domain library: adapters, scan, aggregate, storage, settings
├── cli/         # agent-garden CLI
└── tauri-app/   # desktop shell, Tauri commands, tray/menu, file watcher
web/             # static frontend, vanilla HTML/CSS/JS modules, no build step
assets/sprites/  # source pixel-art assets
docs/            # specs, architecture notes, sprite/rendering docs
```

Things that should not appear:

- `tauri::`, `wry::`, or browser APIs inside `crates/core/`
- JS / TS inside `crates/`
- Python product runtime. The old prototype is gone; do not revive it.
- Network clients in scan/render paths.

## Common Commands

```bash
# Full Rust tests
cargo test --workspace

# Required before commit
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings

# CLI
cargo run --release -p local-agent-garden-cli -- adapters
cargo run --release -p local-agent-garden-cli -- scan --out ~/.local-agent-garden/events.json
cargo run --release -p local-agent-garden-cli -- garden
cargo run --release -p local-agent-garden-cli -- usage

# Desktop app
cd crates/tauri-app && cargo tauri dev

# Watcher logs
AGENT_GARDEN_DEBUG=1 cargo tauri dev

# Browser fallback preview
python3 -m http.server 8765
# open http://127.0.0.1:8765/web/index.html
```

If `cargo` is missing, try:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

## Architecture Rules

These are hard constraints. If a change violates one, redesign it.

1. `core` must not import Tauri, Wry, WebView, DOM, or frontend types.
2. Adapters do not call each other. Cross-adapter behavior belongs in
   `scan.rs`.
3. CLI and Tauri commands are thin shells. Business logic belongs in `core`.
4. Watcher watches paths and triggers rescans; it does not parse agent files.
5. JS lives only in `web/`.
6. Public Rust APIs return typed errors, not `Box<dyn Error>` / `anyhow`.
7. Local source directories are read-only. Cache/state writes go under
   `~/.local-agent-garden/`.

## Data Flow

Keep the flow one-way:

```text
agent local data -> Adapter -> AgentEvent -> scan/dedupe -> GardenSummary -> UI
```

Do not make downstream layers reach back into upstream source formats. Examples:

- UI must not depend on Claude/Codex raw JSON shapes.
- Adapters must not know frontend colors, sprite names, or layout decisions.
- Aggregation must not write to source directories.

## File Responsibilities

Each file should do one job:

| File | Responsibility |
|---|---|
| `crates/core/src/adapters/<name>.rs` | Read one source type and emit `AgentEvent` |
| `crates/core/src/scan.rs` | Run adapters, dedupe, combine events |
| `crates/core/src/aggregate.rs` | Pure event -> summary math |
| `crates/core/src/storage.rs` | Versioned `events.json` cache |
| `crates/core/src/settings.rs` | `settings.toml` load/save |
| `crates/tauri-app/src/commands.rs` | Tauri command wrappers |
| `crates/tauri-app/src/watcher.rs` | File changes -> scan -> events |
| `crates/tauri-app/src/tray.rs` | Desktop tray/menu/window shell |
| `web/data-source.js` | Tauri/fetch data boundary |
| `web/render-*.js` | Pure rendering logic |
| `web/settings-panel.js` | Settings UI only |

If one file starts doing two unrelated jobs, split it.

## Adding An Adapter

1. Add `crates/core/src/adapters/<name>.rs`.
2. Implement the `Adapter` trait: `name`, `discover`, `collect`, and optionally
   `watch_paths`.
3. Export the module from `crates/core/src/adapters/mod.rs`.
4. Register it in `crates/core/src/registry.rs`.
5. Add fixture-based tests in the adapter module. Tests should create temporary
   files/directories; never scan the real home directory.
6. Put source-specific fields in `AgentEvent.metadata`, not top-level fields.

## Schema And Compatibility

`GardenSummary` and the `events.json` envelope have `schema_version` fields.
Any incompatible on-disk JSON shape change must bump
`aggregate::SCHEMA_VERSION`.

Compatibility defaults matter:

- New settings fields should use `#[serde(default)]`.
- Optional new summary/event fields should be `Option<T>` where possible.
- Old cache/settings files should fail clearly or load with defaults.

## Privacy Contract

Do not break this:

- No network requests during scan, aggregation, rendering, or telemetry.
- No analytics, telemetry, crash reporting, or remote logging.
- Source agent directories are read-only.
- Cache/state writes only go to `~/.local-agent-garden/`.
- Browser fallback mode must not call Tauri APIs. Use the existing runtime
  detection boundary.

## UI / Frontend Rules

- Frontend is vanilla modules loaded by `<script type="module">`.
- Do not introduce TS, JSX, bundlers, npm dependencies, or CDN dependencies.
- Preserve the pixel-garden visual direction; prefer sprite-based rendering
  over procedural organic art when polish matters.
- Respect `settings.toml`: time mode, season mode, motion, and `auto_rescan`.
- Motion must remain CSS-driven and respect reduced/off settings.

## Tauri Events

| Event | When | Payload |
|---|---|---|
| `garden:updated` | watcher or manual scan completed | `GardenSummary` |
| `garden:error` | watcher / scan / settings / tray failure | `{ source, message, adapter? }` |
| `garden:scanning` | manual scan or future progress signal | `{ adapter? }` |

Frontend subscription lives in `web/data-source.js`.

## Testing Expectations

Before committing code changes, run:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

For Tauri shell/bundling changes, also run:

```bash
cd crates/tauri-app && cargo tauri build
```

For frontend changes, at minimum run JS syntax checks and inspect the page in a
browser or generated screenshot workflow. Keep mobile secondary; this is a
desktop-first tool.

## Commit Style

- Use English conventional commit titles: `feat:`, `fix:`, `docs:`, `chore:`.
- Commit bodies should explain why the change exists.
- Do not use `--no-verify`.
- Preserve unrelated user changes. Never reset or checkout files you did not
  intentionally modify.
- If an AI assistant contributed materially, add an appropriate
  `Co-Authored-By:` line.

## Current Phase

Use `CHANGELOG.md` as the current phase ledger. As of this file:

- Core Rust runtime is the product runtime.
- Claude Code, Claude Cowork, Codex, and manual JSONL adapters exist.
- Tauri desktop shell, settings UI, error toast, watcher, tray/menu, app
  bundling, and CI/release workflows are in place.
- Remaining distribution work is mainly signing/notarization/updater polish and
  visual/ambient garden refinements.

## When Unsure

- Adapter behavior: read `docs/architecture.md`.
- Schema changes: read `docs/11-tauri-rust-rewrite-spec.md`.
- Visual rendering: inspect `web/render-garden.js`, `web/render-svg.js`, and
  `docs/sprite-rendering.md`.
- Latest project state: read `CHANGELOG.md`.
- Product tradeoff unclear: ask the user instead of silently choosing a path.
