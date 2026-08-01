# Changelog

## Unreleased

### Runtime performance

- Buffered atomic JSON serialization in 64 KiB chunks. Large `events.json`
  refreshes no longer issue a tiny filesystem write for nearly every serialized
  field; on a real 45.8 MiB cache this reduced an active Codex refresh from
  roughly 60–90 seconds to about 3 seconds while preserving atomic rename and
  owner-only state permissions.
- Automatic watcher, window, tray, and cost refreshes now persist the full
  event cache at most once every two hours while still scanning and publishing
  current summaries immediately. Missing or incompatible caches and explicit
  manual scans continue to write through at once, preventing multi-gigabyte
  overnight write amplification without sacrificing live garden updates.

## v2.2.0 - 2026-07-30

### Runtime hardening

- Serialized in-process cache refreshes and gave every atomic write a unique,
  exclusively created temp file, preventing startup, watcher, tray, and
  WebView scans from racing over one PID-scoped path. Event JSON now streams
  directly into that temp file instead of cloning the event vector and building
  a second full-size string; settings use the same atomic writer.
- Replaced the watcher's unbounded filesystem-event queue with a one-slot dirty
  signal, stopped registration mismatches from triggering five-second full-scan
  loops, and added a 60-second retry backoff for failed OS watches.
- Added per-adapter cache fingerprints and an incremental adapter hook. A
  changed Claude source no longer reparses unrelated Codex history, while the
  Claude Code adapter reuses unchanged session files and the Codex adapter
  reuses unchanged rollout rows by size/mtime; both reparse only changed files.
- Streamed shared JSONL parsing with an 8 MiB per-record ceiling so malformed
  tool-output rows cannot materialize an entire multi-gigabyte history in
  memory; later valid rows remain readable.
- Removed unused Codex thread titles, first-user-message fallbacks, session
  index names, and Cowork titles from normalized events. Raw-event cache schema
  v3 forces one rescan to purge older copies. New Unix state files are `0600`
  and `~/.local-agent-garden/` is tightened to `0700` on the next state write.
- Collapsed the classic wall's 366-image flowerbed into one persistent canvas
  painted from the same hand-authored flower sprites. Watcher refreshes now
  reuse that canvas and its decoded assets instead of rebuilding hundreds of
  image nodes and hover listeners.

## v2.1.0 - 2026-07-12

### Adapters and pricing

- Added three evidence-gated local adapters. `qwen-code` follows Qwen Code
  0.19.9's real `projects/*/chats/*.jsonl` serializer plus legacy whole-file
  recordings, preserves source-reported prompt/output/cache/thinking semantics,
  and skips fork-copied history; a real local 0.19.9 session confirmed the
  schema and normalized counters. `kiro` reads Kiro CLI 2.12.1's structural
  `~/.kiro/sessions/cli/*.json` metadata as activity-only, never opens sibling
  transcript JSONL, and accepts a `conversations_v2` database only when its
  safe identity/timestamp schema is present, so generic Kiro shell-history and
  auth/state databases cannot trigger false agent activity. `cursor` reads
  Cursor 3.11.13 foreground/local `composerHeaders` and workspace mappings as
  activity-only while excluding drafts, startup placeholders,
  background/cloud origins, transcript/body/checkpoint stores, titles, and
  mutable cumulative token state.
- Recorded a strict Windsurf no-go instead of shipping a guessed parser. The
  current official update endpoint now returns Devin Desktop, while a signed
  fixed Windsurf 2.3.15 package contains neither the community-claimed
  `cascade.sessionData` nor `cascade.chatdata` contract and exposes no proven
  content-free Cascade index. A native adapter now requires a fixed legacy
  two-workspace fixture that can bind session, timestamp, and project without
  reading protobuf trajectory content.
- Added a native `antigravity` activity adapter for the current Gemini consumer
  migration path. It prefers populated rows from Antigravity CLI 1.1.1's local
  summary index, but a real completed CLI session proved that table can remain
  empty; the truthful fallback uses `cache/last_conversations.json` and exact
  `conversations/<id>.db` files for workspace, native session id, step count,
  and database activity time. Titles, previews, protobuf blobs, transcripts,
  logs, app-data paths, config, and credentials are never read or watched.
  Token/model fields remain empty instead of being inferred from text;
  `gemini-cli` remains legacy/API-key/Vertex/Standard/Enterprise coverage.
- Added native `cline` and `goose` adapters for the first priority wave, based
  on current upstream serializers rather than inferred schemas. Cline reads
  current SDK `~/.cline/data/db/sessions.db` plus per-session message artifacts,
  then falls back to shared/VS Code-family legacy task records. Current
  per-turn metrics carve cache subsets out of full input; legacy parsing mirrors
  Cline's own accounting set (`api_req_started`, deleted request aggregates,
  and subagent usage), preserves recorded cost, and leaves aggregate rows
  unassigned to a model when the source does not identify one.
  Goose opens the platform `sessions/sessions.db` read-only and emits one event
  per `usage_ledger` row, carving cache subsets out of input to prevent double
  counting while retaining model, cost source, compaction, session type and
  parent session metadata. Pre-ledger JSONL session totals remain supported but
  are excluded from daily token charts because their original day is unknown.
  Both adapters avoid credentials, never estimate tokens from text, include
  current/legacy storage fixtures, corrupt-input and duplicate-store coverage,
  and keep `manual-jsonl` last in the registry.
- Hardened the first native adapter wave against false attribution. Copilot CLI
  now uses its real `session.start.data.context.cwd`, anchors cumulative usage
  to the real session start, emits one source-reported bucket per model, and
  omits multi-day cumulative totals from daily charts instead of inventing a
  day while preserving lifetime/model totals. Its modern fixture is redacted
  from a real local Copilot CLI 1.0.70 session. OpenCode now honors
  `XDG_DATA_HOME`, lets a valid legacy row recover from an unusable canonical
  row, and watches WAL creation through an exact-path filter that ignores
  credential siblings. Raw-event cache schema v2 forces one safe rescan so a
  v1 cache cannot preserve the old mixed-model Copilot interpretation.
- Completed three adversarial review passes across adapter truthfulness,
  aggregation, cache isolation, and live watching. Cumulative session totals
  that cannot be assigned to a day now contribute only one activity marker and
  never enter trailing-30-day token shares. A failing adapter no longer aborts
  healthy sources: the last cached partition for that adapter is retained,
  surfaced as an adapter-specific warning, and deliberately left stale so the
  next load retries it. The desktop watcher now reconciles newly created roots,
  session databases, and nested targets after launch; multi-level missing paths
  use bounded polling instead of recursively watching `$HOME`, while exact-path
  filtering still excludes credential siblings. Gemini's exact `projects.json`
  input participates in watching/fingerprinting. Goose derives pre-ledger
  residuals from authoritative SQLite session totals rather than leftover
  JSONL, and Qwen classifies native tool-result prompt tokens as input instead
  of output.
- Added a current Top 10 AI coding-agent coverage study, separating market
  adoption from local token feasibility. It recommends Goose and Cline as the
  next exact-usage adapters, moves Antigravity into evidence research, treats
  Cursor/Windsurf as schema research, and reclassifies Gemini CLI as
  legacy/enterprise/API-key coverage after Google's consumer OAuth deprecation.
- Added the evidence-first plan for the next native adapter wave. Gemini CLI,
  GitHub Copilot CLI, and OpenCode are the P0 fixture/research targets; Cline /
  Roo Code and Cursor follow only after their local schemas and token precision
  are proven with versioned redacted samples.
- Added the published GPT-5.6 Sol, Terra, and Luna Standard short-context API
  prices to the bundled local table, including GPT-5.6's explicit cached-input
  and cache-write rates. Sol Pro remains unpriced because the API pricing table
  does not publish a matching standard per-token row.
- Made the existing user price overlay discoverable: the app and tray menus now
  open `~/.local-agent-garden/prices.json`, creating an empty override table
  when absent so untouched factory models keep receiving release updates.
- Implemented the three P0 native adapters (`gemini-cli`, `copilot-cli`,
  `opencode`), researched from upstream source code and official docs because
  no local sample data existed on the development machine — each module doc
  states its evidence URLs, verified date, token-precision contract, and
  dedupe key. Gemini CLI reads `~/.gemini/tmp/<project>/chats/` recordings
  (per-message API usage incl. cached + thinking tokens; lossless project-path
  recovery via the CLI's own `projects.json` / `.project_root` records, never
  hash reversing). Copilot CLI reads `~/.copilot/session-state/*/events.jsonl`
  (cumulative per-session API totals from the richest metrics event; sessions
  without one degrade to activity-only; the derived `session-store.db` is
  never opened). OpenCode reads the XDG store across all three storage eras —
  current SQLite (opened read-only), flat-JSON, and the legacy
  per-project tree — with per-message tokens, cache splits, and recorded cost;
  credentials (`auth.json`) are never read or allowed to trigger scans. All three ship
  two-era temp-dir fixtures plus expanded truthfulness, cache-upgrade, XDG,
  WAL-filter, corrupt-input, and dedupe coverage (the workspace suite is now
  252), and register through
  `mod.rs` + the registry with `manual-jsonl` kept last as the catch-all.

## v2.0.2 - 2026-07-10

### Product page

- Rebuilt the GitHub Pages landing page as a static editorial pixel-garden
  story: the courtyard is now the first-viewport product signal, followed by
  growth mapping, Courtyard/Wall views, local architecture, privacy, install,
  and FAQ sections.
- Kept the page dependency-free while preserving English, Simplified Chinese,
  Traditional Chinese, and auto/paper/night themes. New local pixel fonts and
  courtyard specimen assets ship from `docs/` with no CDN or analytics.

## v2.0.1 - 2026-07-10

Post-2.0 work from two independent review passes (merged + cross-verified):
two PRD gaps closed, a new optional global hotkey, plus a batch of correctness /
privacy / release-governance hardening.

### Product website

- Added a static GitHub Pages landing page under `docs/`, using the sanitized
  courtyard and wall screenshots as the product visuals. The page explains the
  local-only data flow, privacy boundary, visual modes, install path, and core
  features without loading CDN assets or app runtime code.
- Enabled GitHub Pages publishing from the `docs/` directory on `main`, plus a
  README link to the public product page.

### Desktop global hotkey (show / hide)

- Added an optional global hotkey that shows the window when hidden and hides
  it when visible (raising it if it was merely behind another app). It must be a
  global hotkey — an in-app key can't reach a hidden window to summon it back.
- Off by default, honoring the "quiet, respects the machine" posture: a global
  hotkey shares the OS-wide namespace and can clash with other apps, so nothing
  is registered until the user opts in. The settings panel offers a recommended
  combo (`⌘⇧G` / `Ctrl+Shift+G`) to one-tap enable, a recorder to bind your own
  (press the keys), and a clear button to disable.
- A taken or invalid combination surfaces as a `garden:error` toast ("pick a
  different combination") instead of failing silently. Registration lives in a
  narrow `shortcuts.rs` shell reconciled from `settings.toml` at startup and
  after each save (mirrors `autostart`); core never touches the OS.

### Pricing + Desktop Shell

- Refreshed the bundled default model price table from current OpenAI and
  Anthropic public API pricing. The table now includes current Claude ids
  (`claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5`,
  `claude-sonnet-4-6`) plus current OpenAI ids (`gpt-5.5`, `gpt-5.4`, and
  `gpt-5.3-codex`). The price-source note is recorded in
  `docs/25-model-pricing-refresh.md`; Codex credit rates are intentionally not
  converted into USD.
- Made the frameless desktop window draggable from the header. The app now uses
  an explicit `startDragging()` bridge for the non-interactive header area, plus
  a double-click-to-maximize gesture (the one the native drag region gave for
  free), granting only the needed `core:window:allow-start-dragging` and
  `core:window:allow-toggle-maximize` capabilities.
- Redesigned the tray status icon from a full stone-lantern silhouette into a
  compact pixel garden-gate mark with a centered lantern. The macOS template
  variants now keep an open doorway / lamp cutout so the icon stays readable
  after the system tints it in the menu bar, while Windows/Linux keep colored
  lit and unlit variants.
- Clarified cost rows for cache-heavy models: each priced model now shows cache
  read/write tokens inline with their own rates. `prices.json` schema v2 adds
  `cache_read_per_mtok` and `cache_write_per_mtok`, so cache-heavy Claude /
  OpenAI usage now contributes to the local estimate instead of being only
  counted in the total-token rollup.
- Taught the Codex adapter to read split token buckets from rollout
  `token_count` rows. Codex/OpenAI `cached_input_tokens` now feeds
  `cache_read_tokens`, while non-cached input is priced separately; the SQLite
  thread total remains the canonical total when present.

### Year Review + Weekly Recap (PRD §P3)

- Made the Year Review "growth" card real (PRD §P3-3 item 2). It was listed in
  the deck but fell through to the generic year overview; it now renders a
  vertical timeline of up to five curated ring moments (milestones and the
  earliest first-seen preferred, then filled by date, shown chronologically).
  It reads the core-owned rings book through `loadRings()` and shows a calm
  single-line fallback when the book is absent (demo/browser) or the year has
  no moments.
- Gave the Weekly Recap its "new growth" narrative (PRD §P3-1). The card now
  lists up to three ring moments that landed inside the week (reusing the
  return-diff memory) and swaps its closing line to "上周,庭院多了一盏灯。"
  when a tier or trinket was gained that week, keeping the quiet closing
  otherwise. Bookless/quiet weeks fall back to a calm growth line.
- Both share cards render ring moments through `ringEventTitle`/`ringDate`
  (localized, name/label-based) only — never a raw project path or internal
  key — so a shareable card cannot leak what the private Rings tab shows, and
  they re-read the book on each open so a moment recorded mid-session appears.

### Hardening

- Fixed a `size_strength` NaN: when the busiest project sat exactly on the
  10k-token floor (`max_tokens == 9999`) the ratio computed `0/0 = NaN`, which
  serde renders as `null` and the tray's `GardenSummary` re-parse then rejected.
- Stopped the CSV/JSON export from leaking on-disk project paths. `project_key`
  is the local path when known, so exports now emit an opaque per-project id plus
  the display name instead of the raw key, and neutralize spreadsheet formula
  injection (cells starting `= + - @`).
- Fixed Codex data loss: `extract_token_total` no longer sums a `total_tokens`
  together with the components it already includes (~2x inflation of every Codex
  row); `discover()` now recognizes rollout-only installs (`sessions/`), matching
  what `collect()` reads; and the threads DB opens by path instead of a `file:`
  URI that broke on `#` / `?` / `%` in the home path.
- Applied the source filter on cache hits, and stopped a filtered scan from
  persisting a subset into the shared `events.json` (previously served whole to
  later unfiltered reads).
- Rejected negative / non-finite user price rates instead of producing negative
  or `null` cost.
- Made the Cost and Projects tabs recompute their estimate when new data arrives
  (they had cached it for the whole session), moved the Rings tab's disk read off
  mount onto first open, and fixed an error-toast leak where a pruned toast's
  entry lingered on a detached node and swallowed later same-source errors.
- Gated releases behind a preflight job: a `v*` tag must now pass the
  zero-network / fmt / clippy / test / cargo-deny checks — and match the crate /
  bundle version — before any bundle is built or published (the release workflow
  previously bypassed CI entirely).

## v2.0.0 - 2026-07-08

- Started the v2.0 Agent Nursery promotion path. The source-share nursery first
  moved beyond query flags into the Appearance settings panel, then graduated to
  the new `auto` default; `?nursery=1` remains as a review override.
- Advanced the Agent Nursery toward the PRD 2.0 P2 acceptance shape: each plot
  now carries an explicit `lush` / `growing` / `fallow` state and hover/focus
  fills the existing scene info card with source name, recent share, recent
  tokens, lifetime tokens/events, and status instead of relying on a browser
  title tooltip.
- Graduated Agent Nursery from opt-in prototype to v2.0 `auto` default:
  multi-source gardens now show adapter plots and the matching flowerbed base
  automatically, single-source gardens stay visually quiet, and the Appearance
  setting still supports explicit enabled/disabled overrides.
- Started PRD 2.0 P3-2 Seasonal Moments in the Share drawer. A new local-only
  Seasonal Moment card maps the user's calendar to four deterministic moments
  (cherry, koi, autumn moon, first snow), rolls up season-to-date tokens from
  local `daily_tokens`, and exports through the same postcard save pipeline as
  the weekly and year cards.
- Wired the P3-2 scene-side seasonal offer. When the current local-calendar
  season has activity, the garden shows one quiet banner per season and opens
  the Seasonal Moment card directly; quiet seasons stay silent and demo mode
  never writes real offer flags.
- Started PRD 2.0 P3-3 Year in Review proper. The old single year-to-date
  card is now a five-card local deck (cover, growth, peak, companions, seed)
  with in-drawer preview navigation and one long PNG export.
- Added the P3-3 annual ritual gate: during the first local week of December,
  an active year gets one scene banner that opens the Year Review deck; empty
  years and already-offered years stay silent.
- Completed the P5-2 empty-state contract: the wood sign now consumes the
  existing local adapter discovery command and lights up installed sources in
  the supported-agent list, while browser/demo fallback stays static. The old
  hidden renderer-drawn `.pg6-empty` fallback was removed so the wood sign is
  the single empty-state surface.

## v1.9.0 - 2026-07-08

- Cost estimation is now single-source in `core`. `crate::prices::estimate`
  (+ a new `estimate_summary` producing a whole-garden `SummaryCost` with a
  per-project breakdown keyed by `project_key`) is the ONLY cost math; the
  hand-written JS mirror (`web/cost-estimate.js` `estimateCost`/`normalizeUsage`)
  is deleted. A thin `cost_estimate` Tauri command and a `cost` CLI subcommand
  (`--json`) expose it; the Cost tab and the per-project Insight cost labels
  consume the command output and only display/format. `ModelCost` echoes the
  `input_per_mtok`/`output_per_mtok` used, so the tab's rate line can't
  diverge from the number it priced; `CostEstimate.unpriced_by_model` keeps a
  named per-model breakdown so an unpriced (unknown) model still gets its own
  row rather than vanishing into the aggregate count. Cost is computed over
  the latest cache summary (the honest "total spent"), fetched once when the
  tab is first opened; demo/browser mode has no backend and shows the
  unavailable state, as before. (The `load_prices`/`save_prices` commands stay
  for a future price editor; the now-unused JS `loadPrices` wrapper was removed.)
- The Export tab now exports the core-produced cost estimate as CSV or JSON in
  addition to daily project tokens. Cost export lazy-loads `cost_estimate` only
  when clicked, uses the same local `SummaryCost` shown in the Cost/Projects
  tabs, includes garden + per-project model rows with named unpriced models,
  and keeps browser/demo mode explicit instead of writing an empty file.
- Post-v1.8 review fixes (privacy + share-card polish):
  - **doctor no longer leaks the home path.** The state-dir "not writable"
    branch now runs its message through the same home→`~` redactor every
    other check uses, so `doctor --json` stays paste-safe (README's promise)
    even on a permission-denied state dir.
  - **doctor stopped mutating the filesystem.** An absent state dir reports a
    Warn instead of `create_dir_all`-ing `~/.local-agent-garden/`, so running
    the diagnostic before ever launching the app leaves nothing behind; the
    writability probe also cleans up on every failure path.
  - **doctor classifies failures honestly.** A readable-but-unparseable file
    is still an Error ("invalid"), but a permission/IO failure is now a Warn
    ("unreadable"), so a valid-but-locked settings/prices/events/rings file no
    longer fails the whole run with corruption wording.
  - **doctor::run honors the context home**, deriving all state paths from the
    caller's `AdapterContext` instead of the process env, so a future
    `with_home(X)` caller gets a coherent report (no adapters-under-X +
    files-under-$HOME split); the home redactor is now a pure, env-free,
    boundary-aware helper (no more `/Users/su` mangling `/Users/superproj`).
  - **Year card layout no longer overprints.** With ≥5 projects the closing
    line now flows below the actual rows (derived, not a fixed 3-row rhythm),
    and the zero-token card shows the quiet-year line once, not twice.
  - **Shared card DNA unified.** The weekly/year date+stat helpers
    (`localCalendarDay`/`utcDayKey`/`sumWindow`/`toCount`/daily-totals) moved
    into `card-canvas.js`, the year title uses the shared `PAPER` constant,
    and both cards focus the export button only after the preview renders (it
    is disabled synchronously first, so focusing inline dropped to `<body>`).
  - **`fmtLocal` boundary fixed** — 999,950,000 reads as `1.0B`, not
    `1000.0M`; the year-card test is now timezone-independent (injected
    calendar-day anchor), and doctor's redaction test injects a home fixture
    instead of reading the real `$HOME`.

## v1.8.0 - 2026-07-08

- Added the local Year Review share artifact. The Share drawer now has a third
  flow next to Garden Postcard and Weekly Recap: a year-to-date 960×1280 card
  generated entirely from `GardenSummary.daily_tokens` and per-project
  `daily_tokens`. It shows month blocks, total tokens, active days, active
  projects, busiest day, and top projects without exposing project paths.
- Hoisted the data-card canvas primitives (`card-canvas.js`) so weekly recap
  and year review share the same card DNA: portrait dimensions, paper/ink
  frame, pixel fonts, one-line fitting and local PNG export path.
- Tightened README visual-mode documentation with the Wall-view screenshot and
  a clearer explanation of the vine-wall map, programming stickers and brick
  activity surface.

## v1.7.0 - 2026-07-08

- Added the local trust/support diagnostic command `agent-garden doctor`.
  The report checks only product-owned local state and cheap adapter discovery:
  state-dir writability, `settings.toml`, `prices.json`, `events.json`,
  `rings.json`, and adapter presence. It does not scan source logs and does
  not call the network. Human output is intended for terminal troubleshooting;
  `--json` gives a stable support shape for issue reports and future desktop
  health UI.
- Kept the distribution boundary explicit: `doctor` is implemented in
  `crates/core/src/doctor.rs` so CLI/Tauri can share it later without pulling
  shell or browser types into core. Fresh installs report missing cache/rings
  as warnings, malformed user state as errors, and return a failing exit code
  only when an error is present.

## v1.6.0 - 2026-07-08

- Opened the adapter-wave release line without guessing unstable third-party
  log formats. The CLI `adapters` command now uses each adapter's cheap
  `discover()` / `watch_paths()` contract instead of running a full scan just
  to list availability, and it gained `--json --watch-paths` output for
  redacted bug reports and adapter PRs. This gives contributors a local-only
  inventory shape without reading or publishing real session contents.
- Added the native adapter contribution path: `docs/23-adapter-development-guide.md`
  defines the source-shape evidence, `AgentEvent` mapping, dedupe expectations,
  fixture-test gate, manual JSONL bridge, and privacy checklist; GitHub now has
  an `adapter_request` issue template that asks for redacted paths, sample rows,
  token-accuracy level, and inventory output. README CLI examples point to the
  new adapter inventory and guide.

## v1.5.0 - 2026-07-08

- Completed the v1.5 Insight release line. Projects now show per-project local
  cost estimates from the same `prices.json` table as the Cost tab; the Data
  drawer gained a local Export tab for CSV/JSON daily tokens per project; and
  `GardenSummary` schema 9 adds adapter-source token rollups
  (`source_tokens`, `source_recent_tokens`) so the Composition tab and the
  new `?nursery=1` Agent Nursery prototype can answer "which local agent grew
  this garden?" by token share instead of event count. The bundled browser
  sample was upgraded to schema 9 with synthetic source-token data only.
- Bumped crate and Tauri package metadata to `1.5.0`, added the Wall-view
  screenshot and two-mode explanation to the README, and kept the new
  SignPath-ready code-signing policy linked from install notes for the release
  trust story.
- Landed PRD 2.0 §P3-1: the Postcard footer button grew into a **share
  drawer** (garden postcard + the new **Monday weekly recap card**); the
  postcard module became a drawer-hosted flow with its render/save pipeline
  untouched. The weekly card follows the §5.4-E card DNA (960×1280 paper/ink
  portrait, Silkscreen title bar, seven pixel day-bars, VT323 number line,
  product watermark) with an honest zero-week variant, and implements the
  §P3-1 boundary contract: the offer banner fires on the first open after
  LOCAL Monday (once per week, never for an empty week, new `weekly_recap`
  setting), while statistics use the previous ISO week's seven UTC day keys
  straight from `daily_tokens`. Post-merge corrections: the week anchor now
  uses the LOCAL calendar day so a UTC+8 Monday morning gets last week (not
  the week before last), and the drawer's menu classes were renamed off the
  composition tab's `pg6-share-*` bar classes they collided with. Top-3
  projects rank by the week's own per-project `daily_tokens`, never lifetime
  totals, and never show paths.
- Review pass over the drawer content wave (14 findings + 4 sweep addenda).
  Privacy: the shipped demo sample was rebuilt from the pre-leak public
  project set with a synthetic model split (the schema-8 regeneration had
  pulled 20 unpublished project names/paths into the public repo), and demo
  mode now gates loadRings/loadPrices so a desktop `?demo=1` session can
  never surface real garden memory or prices. Behavior: the drawer forwards
  watcher ticks only to the visible tab (hidden tabs replay the latest frame
  on activation), the Rings tab caches its book — re-reading only on tab
  activation instead of every tick — and the Cost tab retries a failed price
  load on activation instead of staying broken all session; `formatUsd` pins
  en grouping so EU locales can't read $1,235 as one dollar. Rings journal
  polish per §P1-3: localized month-grouped timeline with a "这座庭院 N 天了"
  age line, tier rows reuse the unlock-banner copy instead of raw
  `entity/to` tokens, sentinel subtitles ("seen"/"unlocked") dropped in
  favor of the first-seen project path, and PRD-defined future event types
  are pre-titled. Cleanup: composition sources use the shared friendly-name
  helper, `kpiCard`/`closeButton`/`sourceLabel` hoisted into
  render-helpers.js, the dead `savePrices` shim and the impossible
  `event_type` fallback (plus its fixture test) removed, and the stale
  garden_rings TODO replaced with a real doc comment.

- Filled the v1.5 data drawer content wave: Composition now shows model-token
  and adapter-source share, Cost reads the local price table for conservative
  estimates, and Rings consumes the durable garden memory file from the same
  drawer shell as Overview and Projects.

- Opened the v1.4.x/v1.5 line with two parallel worktrees. **Data drawer
  (PRD §8.1 landed):** the Insight and Dashboard footer buttons merged into
  one 数据/Data entry opening a tabbed drawer — 概览 hosts the dashboard
  content, 项目 hosts the insight list (sticky head + search intact), with
  pill tabs (action-green selected, roving tabindex, arrow keys), tab memory
  (`pg6.drawer.tab`), Escape-to-close, popover-group membership, and the
  mini heatmap strip now opening the 概览 tab; the two content modules
  became host-rendered providers with their shells deleted. **Cost core
  (P4-1 foundation):** per-model token rollups (`ProjectGrowth.model_tokens`
  + `GardenSummary.models` as full TokenUsage maps, `SUMMARY_SCHEMA_VERSION`
  7→8) and `core::prices` — bundled defaults overlaid by a user-editable
  `~/.local-agent-garden/prices.json` (schema 1, never quarantined:
  user-authored data), with three-tier honest estimates: input/output priced
  at table rates, unsplit totals (Codex) at an explicitly named blended
  rate, cache tokens counted but unpriced, unknown models bucketed as
  `unpriced_tokens` — never guessed. Thin `load_prices`/`save_prices`
  commands; the 成本/构成 tabs consume this in v1.5.

- Finished the v1.4 batch with I9, the first-run experience: the garden now
  grows in on first launch — stage (base svg) → vines → wall stickers →
  structures → creatures over ~3.5s of staged opacity (sprite transforms are
  anchoring, so the spec's landing bounce is deliberately dropped), one click
  skips to the final state, reduced motion renders instantly, and a
  "Welcome to your garden" banner closes the sequence. Runs once per install
  (`pg6.firstrun.done`), `?firstrun=1` forces a replay for doc-20 validation,
  and demo mode always replays without touching the real flag. A first-scan
  curtain ("Waking the garden…", z-200) arms before the summary promise and
  only appears when the first paint is slower than ~450ms — cold multi-GB
  scans get feedback, warm caches never see a flash; the watcher's
  `garden:scanning` adapter names enrich it when they arrive. The banner /
  reveal stillness rule moved to a shared `isMotionStill` helper in
  render-helpers.js.

- Sealed the state-semantics edges the batch review found: demo mode no
  longer mounts unlock moments (a canned garden diffed against the user's
  real seen-frame fired fake banners AND overwrote `pg6.seen.tiers`);
  `garden.js` now keeps `visibleSummary` and `latestSummary` apart so a
  settings tweak or renderer switch can no longer leak paused watcher data
  onto screen (resuming auto_rescan folds latest into visible deliberately);
  a banner wiped by a full repaint hands its slot to the next queued entry
  immediately via a childList observer; rings quarantine names get a numeric
  suffix on same-second collisions (Windows rename-onto-existing fails);
  and the tray's "No token activity yet" empty row joined `tr(en, zh)`.
- Landed the v1.4 watch-mode batch (PRD 2.0 §6.1, four parallel worktrees
  merged): **unlock banners** — a paper/ink SceneBanner rises from the scene
  when `summary.tiers` gains a tier (queue of 3 + "+N more changes" overflow,
  steps(6) motion with a reduced-motion fade, click pulses the object; frames
  persist at `pg6.seen.tiers` so a reinstall seeds silently instead of
  celebrating history); **tray lantern icon** goes two-state — lit when
  `tiers.lamp` is lit, unlit otherwise, with macOS template variants whose lit
  silhouette punches the lamp window out so monochrome stays readable;
  **launch-at-login** is now real — `tauri-plugin-autostart` reconciles the
  OS login item from `desktop.launch_at_login` at startup and after every
  settings save (settings.toml stays the single truth; unreadable settings
  skip rather than guess), with a Desktop-section checkbox; **empty state &
  demo** — a zero-project garden shows a CSS pixel wood-sign invitation, and
  `?demo=1` pins the page to the bundled sample summary with a "Demo data"
  freshness pill (watcher pushes muted so the canned garden can't be
  replaced); doc 20 gains the watch-mode validation section. 19 web tests +
  111 Rust tests green; banner and demo verified in the browser preview.

- Started the PRD 2.0 branch with the core garden-memory foundation. Core now
  owns `GardenSummary.tiers` (`SUMMARY_SCHEMA_VERSION` 7) with the former
  frontend unlock thresholds ported into Rust, and writes a local
  `rings.json` memory file from the cache/scan path. `events.json` remains the
  truthful replace-on-refresh accounting cache, while permanent courtyard
  unlocks (pavilion, willow, stone cat, low table/cushion, trinkets, cumulative
  counters) merge upward to their high-water mark so source-log rotation cannot
  visually demolish the garden. Live states stay live: cherry bloom follows
  recent activity and the lantern follows today's activity. A thin
  `garden_rings` Tauri command and `loadRings()` data boundary are in place for
  the future 年轮 UI; frontend tier rendering now trusts `summary.tiers` when
  present and falls back to the old JS derivation for browser/demo summaries.
- Hardened the PRD 2.0 garden-memory pass after review: corrupt or unwritable
  `rings.json` now logs and degrades to the current `GardenSummary` instead of
  blocking cache hits or refreshes; CLI summary views use the same rings
  high-water display layer as the desktop app; and `events.json` now shares the
  atomic temp-file + rename write helper used by rings.
- Closed the review's residual memory gap: a malformed `rings.json` no longer
  leaves garden memory silently dead forever — it is quarantined to a dated
  `rings.json.corrupt-*` sibling and rings restart from an empty book, while a
  future `schema_version` (written by a newer binary) still degrades without
  touching the file, so downgrades cannot destroy real history.
- Swept the remaining review findings: unknown tier strings (version skew —
  e.g. a snapshot written by a newer binary) are preserved by the high-water
  merge instead of silently ranking 0, and unorderable transitions never emit
  a tier_up event; the tray re-reads the cache just after each UTC midnight so
  the "today" glance line rolls over on quiet days; the UTC day-key format now
  has one greppable home (`aggregate::utc_day_key` / `day_key`) used by daily
  maps, rings, tray and CLI; `normalizeCoreTiers` dropped its dead camelCase
  tolerance so a wire-shape change fails loudly; the browser-demo
  `garden-summary.json` is regenerated at schema 7 with a `tiers` block; and
  the half-wired rings plumbing (`loadRings` / `garden_rings`) carries
  TODO(prd-2.0 §6.1 I7) markers pointing at the data-drawer 年轮 tab.
  Deliberately not done: a settings cache for the tray's per-event TOML reads —
  an invalidating cache adds coupling for negligible I/O (YAGNI).
- Localized the tray / system menu (en/zh via system locale, `sys-locale`,
  no settings field and no frontend push — native menus exist before the
  webview, so tray copy lives Rust-side as `tr(en, zh)` pairs; CLAUDE.md
  records the exception). The glance row now follows the PRD P1-1 narrative
  contract: lantern state comes from core `tiers.lamp`, and "new growth"
  counts today's ring events instead of "active projects", with a quiet
  `garden growing quietly` variant when the lantern is lit but no ring event
  landed yet.
- Started the PRD 2.0 tray-watch vertical slice. Settings now have a dedicated
  `[desktop]` section (`launch_at_login`, `close_to_tray`) and the settings
  panel round-trips `appearance`, `data`, `integrations`, and `desktop` without
  dropping untouched sections. `close_to_tray` is wired to the native close
  handler; launch-at-login stays stored but hidden until the autostart backend
  lands. The tray menu now opens with a quiet/lit garden status row and puts
  today's token total inside the Top Token Projects submenu instead of making
  raw numbers the system-layer headline.
- Post-review fix pass over the 07-06 commits. The biggest one is a timezone
  correctness bug: `daily_activity` keys are produced by core's `aggregate.rs`
  from `DateTime<Utc>`, but the flat renderer (and the new `garden-tiers.js`)
  looked "today" up with a local-date key, so between local midnight and UTC
  midnight (00:00–08:00 in UTC+8) the WALL view zeroed `todayActivity` and
  unlit the lantern while the 2.5D view stayed lit. All tier math now lives in
  one place: both renderers import `unlockTier` from `web/garden-tiers.js`
  (UTC day keys), their two diverged local copies are gone, and the orphaned
  `web/render-iso.js` prototype (399 lines, never imported) is deleted.
  Also from the review: sticker hover titles now go through the i18n layer
  (`sticker.title` en/zh + config `name` field) instead of hardcoded English;
  the 2.5D renderer clamps `isoDown` to the wall-face height so a config typo
  can't drop a sticker onto the lawn again; and the six hand-synchronized
  dark-scrollbar selector lists collapsed into one `.pg6-popover-scroll`
  marker class — which also fixes the paper-theme thumb color the insight
  list was missing.
- Locked the UTC today-key contract with a regression test: `unlockTier`
  now takes an injectable `now` (house style: parameterize time, never
  mock `Date`), and `web/tests/garden-tiers.test.mjs` asserts UTC-key
  lookups under plain `node --test` — a new `web-tests` CI job runs it.
  `web/package.json` exists only to mark `web/` as ESM for Node; the
  frontend still has zero npm dependencies and no bundler.
- Added the final 2.5D wall-sticker pass for the public-release courtyard:
  28 local PNG programming decals (Go, Rust, MySQL, Git, Terminal, Python,
  Ruby, Docker, Java, JavaScript/TypeScript, HTML/CSS, Linux, React, Vue,
  Node.js, npm, Vite, Next.js, Tailwind, Kubernetes, Redis, MongoDB,
  PostgreSQL, AWS/cloud) now render on both the classic wall and the 2.5D wall
  faces as muted, aged wall stickers. The generated source notes live in
  `assets/sprites/programming_stickers/SOURCES.md`; no runtime network fetches
  were added.
- Replaced the stone-cat guardian art with an octo-cat guardian statue in both
  renderers (`assets/sprites/octo_cat_statue/` and
  `assets/sprites/isometric_generated/octo_cat_statue_*`). Removed the now-unused
  old stone-cat and `trinket_lucky_cat` sprites so the sprite tree does not keep
  ambiguous duplicate cat statues around.
- Tightened footer popovers for the desktop release pass: Insight, Dashboard,
  Postcard, and Settings now join a tiny mutual-exclusion group so only one
  panel is open at a time. Insight also gained a sticky header/search/summary
  shell with only the project list scrolling, which keeps the "show all"
  affordance reachable on dense local datasets.
- Added a release verification checklist for the remaining desktop gate:
  `docs/20-release-validation-checklist.md` now spells out the true Tauri-window
  CSP pass, the Garden Postcard native-save pass, zero-network observation, and
  unsigned-bundle smoke checks to complete before tagging `v1.1.0`.
- Refreshed the README hero screenshot (`docs/images/garden.png`) to show the
  current 2.5D courtyard, wall stickers, octo-cat guardian, pavilion trinkets,
  water edge details, and footer controls instead of the older flat-wall scene.
- Bumped crate and Tauri package metadata from `0.1.2` to `1.1.0` so the first
  public release tag and generated desktop bundle filenames line up.

- Started the 2.5D courtyard branch and shipped an experimental renderer behind
  `?renderer=isometric`. `garden.js` now chooses a scene renderer through
  `web/renderers/renderer-factory.js`; default `classic` still wraps the
  existing wall renderer unchanged, while `isometric` renders a separate
  night-courtyard prototype: folded back walls, diamond floor grid, all project
  vines hanging from the wall ridge, and depth-seated pavilion / willow / cherry
  / stone cat / koi pond / bamboo / lantern sprites. Project hover/focus cards,
  roving keyboard navigation, Insight project selection, freshness states, and
  the existing HUD/panels continue to work. The dynamic renderer also gained
  `destroy()` so future renderer switches can tear down the long-lived
  garden-cat loop and sprite layers. See `docs/19-isometric-courtyard-plan.md`
  for the reviewed migration plan and remaining extraction work.
  Tauri desktop sessions now default to `isometric` on this branch because
  `tauri.conf.json` cannot pass the browser-only `?renderer=isometric` query
  into a `frontendDist` window. A footer `2.5D` / `Wall` toggle hot-swaps
  renderers and persists the choice in localStorage, while normal browser
  fallback still defaults to classic unless the query or stored toggle says
  otherwise.
  The isometric wall geometry was tightened after visual review: the two wall
  planes now use the courtyard floor's rear edges plus a single wall-height
  offset, so wall tops are parallel to wall bases instead of forming an
  independent paper-fold peak. Wall grid lines and vine anchors now share the
  same wall points.
  The 2.5D renderer now uses a dedicated PixelLab isometric asset pass for the
  main courtyard objects (`assets/sprites/isometric_generated/`): pavilion,
  koi pond, willow, cherry, stone cat, stone lantern, and low bamboo hedge.
- 2.5D 视图风格和谐化(v2 资产 + 房间升级)。首版等距场景混了三种视觉语言
  (64px 积木体被放大渲染、精绘背景、过平的程序化房间),整体读作"不和谐"。
  现以经典 WALL 视图/最初设计稿的精绘像素语言为准重做:主体 sprite 全部重新
  生成为高分辨率 `*_iso_v2_*`(分档对象一档一图:亭 small/mid/full、石猫
  small/full、柳 young/mature、樱 bud/bloom/petal、灯 lit/unlit——修掉白天
  灯亮;锦鲤回到正常比例;白玩具猫回归灰石猫语义;统一去掉自带底座,靠接地
  阴影落座)。房间侧:地板弃用调试网格改草斑/草丛、墙面画出顺砌砖层、栅栏补
  横栏、岛缘加涟漪光点、删除静止半空花瓣、夜/黄昏为石灯补暖光池。另为岛外
  水面补近景生命层(松屿/苔石礁、莲叶漂浮簇、锦鲤剪影+涟漪圈、低飞水鸟),
  填掉画面四角的空旷水域,形成"近景水面—庭院—远山"三层纵深;夜间水景减光、
  锦鲤水鸟隐去。生命层补完:项目藤蔓贴墙化(槽位收进墙面、藤冠降到帽沿下、
  新增砌体接触阴影),池塘移出樱竹丛到中前空地并改用无鱼静水 sprite——两条
  锦鲤成为活体(水流泳道循环,尊重 data-motion),并把经典视图的五亿
  token 庭院猫移植到 2.5D 地面(巡游/落座,精灵表同款,renderer destroy()
  负责拆循环)。动画自然化二轮:锦鲤从匀速 CSS 轨道改为鱼头朝向驱动的水流
  泳道(从池塘一端逆流游到另一端,短暂停顿,再顺水漂回起点循环);庭院猫改为
  预设庭院路线 + 转向限速的弧线漫步 + 池塘/雕像/亭子软避障,偶尔驻足观望;
  水面角落再添白鹭(立
  于右下礁石)、香蒲芦苇两丛与泊在左侧水面的小木船。四角水面第三轮再补
  `water_corner_lotus_v1.png` / `water_corner_reeds_v1.png` /
  `water_corner_moss_stones_v1.png`: 远角小而淡,近角更细,让沙盘四角不再是
  平铺水色。详见
  `docs/19-isometric-courtyard-plan.md` 的 Style Harmonization 小节。
  The old side-view courtyard sprites are no longer forced into the isometric
  renderer, which removes the earlier mixed-projection collage feel. The floor
  grid was also softened and each standing object gets a subtle local contact
  shadow so props read as sitting on the same ground plane.
  Follow-up visual polish tightened the 2.5D hover card into a compact
  pointer-following tooltip with a high scene z-index, so vines and props no
  longer cover project details. The isometric platform edge was also softened:
  the near side is shorter and warm-brown instead of near-black, and the floor
  grid is quieter so the garden reads less like an editor grid.
  The courtyard now reads as a UI sand-table rather than a floating island:
  a shallow warm-wood tray rim sits under the grass plane, with a restrained
  cast shadow and a slight downward scene placement so the model feels
  supported by the interface instead of suspended in the sky backdrop.
  The isometric projection constants were grouped and retuned after tilt
  review: the rear floor apex moved lower, the wall height dropped, and the
  front edge was pulled in slightly so the red-line area reads as a low garden
  wall rather than a tall peaked backdrop.
  Sky treatment now uses a quieter `sun.png` plus local weather variants
  (`sun_back_cloud`, `sun_cloudy`, `sun_overcast`, `sun_haze`,
  `sunset_glow`) so the 2.5D courtyard no longer shows the same literal
  yellow sun every day. Weather is chosen deterministically from local date and
  time, with `?weather=` as a visual QA override; no weather API or network
  request is involved. The open-water edge pass was also rebalanced: far-corner
  sprites are smaller and quieter, near-corner reeds/lotus are larger, and
  secondary stones/reeds/lotus clusters now soften the tray-to-water boundary.

- Replaced the courtyard path with stepping stones. The flagstone path was a
  tiled SVG pattern (`pg6PathTex`) drawn as a stepped trapezoid; on the new 2.5D
  floor it read as a flat grey grid that clashed with the pixel-art objects.
  It's now a row of discrete PixelLab stepping-stone sprites (飞石,
  `critters/stepping_stone.png`) placed via `depthToScreen` so the path recedes
  from the front lawn toward the pavilion (near = bigger + lower, far = smaller
  + higher), with low z so the standing furniture and the cat pass in front.

- 2.5D perspective courtyard floor. The flat front-facing grass band became a
  ground plane that recedes from the front (screen bottom, "near") back to the
  wall base ("far"): lawn rows whose heights compress toward the back, aerial
  haze (far rows lightened/cooled, near rows deep-shaded), grass blades taller
  and denser toward the front, a stepped-trapezoid flagstone path drifting
  toward the pavilion, and a wall-base contact shadow — all axis-aligned rects,
  so it stays pixel-crisp, and all greens still come from the season palette.
  A new `depthToScreen(d)` (exported from render-svg.js) is the shared contract:
  the floor and every courtyard sprite sit on the same plane — far objects
  higher up + smaller, near ones lower + bigger, z following the base. The koi
  pond was the driver: its top-down sprite finally reads correctly lying on a
  tilted plane, so it moved from behind the footer buttons (hidden) to the
  visible mid plane (relaxed squash 0.55→0.64), with the stone cat / lantern /
  cairn standing at its near bank (池畔). Trees + bamboo recede to the back near
  the wall; the pavilion lifts off the bottom edge onto the plane; the cat roams
  the near lawn in front of the water. Added a per-time-of-day `groundShade` so
  the lawn no longer stays day-bright at dusk/night. No core change, no schema
  bump.

- UI refresh, wave 3 — the composition + header density that actually make it
  read like the mockup (waves 1–2 only reskinned the chrome). The scene was
  re-proportioned: the wall used to fill ~61% of the frame and start near the
  top; it now starts lower (wall top 25% → 36%, bottom 86% → 75%), so the sky
  grows to ~30% and the courtyard band gets taller — much airier, less cramped.
  All wall-anchored bits (mountains, hanging/climbing vines, cornice, wall
  marks, the wall-edge cover) now read the wall top/bottom off scene-geometry
  constants + `scene.dataset.wallTop/BottomPct` + a `--wall-top-pct` CSS var,
  so the band can move without re-tuning each placement by hand. The brick
  palette was lifted from dark brown to a light tan ramp (matching the mockup's
  `#b8a079` body) with quieter weathering and a per-time-of-day `wallShade` so
  night/dusk don't glow. Header gained the descriptive subtitle line, a bigger
  title + 38px VT323 total, two-line season/solar-term + day-phase/clock chips,
  and a visible `EN`/`中` locale toggle (persists + reloads). Footer button
  labels moved to the pixel font. No core change, no schema bump.
- UI refresh, wave 1 — a retro pixel HUD, ported from a Claude Design mockup of
  the garden (the mockup itself stayed 2D side-view, not isometric; we took its
  visual language, not its layout). Added local pixel fonts — Silkscreen + VT323
  in `assets/fonts/`, served from the app's own assets so it stays zero-network
  under `font-src 'self'`; both are latin-only so CJK text falls back to the
  sans stack. The header now shows the token total as a big VT323 number (e.g.
  "5.2B") beneath the title, and the title no longer repeats the total. The
  season/time meta and the footer buttons became retro paper-on-ink chips with a
  2px hard drop-shadow (hover lifts, press sinks). No core change, no schema bump.
- UI refresh, wave 2 — the popover system. The hover info card and the
  Insight / Settings / Dashboard / Postcard panels were flipped from dark-glass
  to retro paper shells (paper bg, 2px ink border, hard drop-shadow, ink text),
  with VT323 numbers, a green source/health bar, retro chip toggles in Settings,
  and a status dot on the footer freshness. Done as a grouped CSS override block
  placed after each panel's base rules (per a Codex review) so it wins at equal
  specificity without rewriting the originals — and without touching the global
  `--color-text-*` tokens, so the header/scene/empty-state keep their light text.
  No core change, no schema bump.
- Added a koi pond as a new foreground garden feature (PixelLab sprite,
  `assets/sprites/critters/koi_pond.png`): a stone-rimmed pool with koi + lily
  pads in front of the pavilion like a 水榭 (water pavilion). The sprite is
  inherently top-down, which clashes with the pure side-view scene, so it's
  squashed vertically (scaleY 0.55 from the bottom edge) to read as a shallow
  pool at a low angle rather than a top-down sticker — the standard 2D way to
  show water. Placed right of the cat's roam band so the cat never stands on the
  water; z above the pavilion so the near bank overlaps its base. Always present,
  drawn via the existing addSprite path. No core change, no schema bump.
- Moved the stone cairn out of the cramped willow–pavilion gap (where it
  crowded the pavilion's front-left column / read as standing inside it) into a
  "stone-objects group" with the lantern on the path between the stone cat and
  the willow (lantern x=45→42, cairn x=70→48; each ~1.5-2% clear, 0% overlap).
  Per a layout decision: the right half is saturated, so a truly independent
  spot needed either shrinking a main anchor or this relocation — the pavilion
  now reads clean. No core change, no schema bump.
- Postcard "postcard treatment" (P1 from the Codex review): the export now has
  a pixel border framing the card, a season "stamp" top-right (season-tinted
  panel + season label + PIXEL GARDEN), and a circular postmark stamped over the
  stamp's corner (arced "LOCAL AGENT GARDEN" + the date) — so it reads as a
  mailed postcard, not a raw screenshot. All canvas-drawn with system fonts only
  (no web fonts / paper texture / handwriting, which are fragile across the
  Tauri webviews). Also renamed the toggle "include busiest project" → "include
  project name" for clearer privacy intent. No core change, no schema bump.
- Finished the procedural→sprite pass on the sky: the daytime/dusk clouds
  (previously 3 stacked rects each) are now a PixelLab pixel-art cloud sprite
  (`assets/sprites/critters/cloud.png`, 96x48), 4 across the sky via the same
  `critter()` helper. Scattered ground flowers were intentionally left alone —
  the base scene already has a full flowerbed sprite system (`flowerbedEnabled`
  mode, 366 flower sprites); the 2px dots are its lightweight off-mode fallback,
  not a gap. No core change, no schema bump.
- Began replacing the base scene's procedural decorations with PixelLab pixel-
  art sprites — the elements that still read as "not pixel art". The butterflies
  (previously a few flat rects that barely resembled butterflies) and the birds
  (previously `^` polylines) are now sprites in `assets/sprites/critters/`: two
  butterfly colorways (amber + powder-blue) alternating so the trio isn't one
  stamp, and a small bird silhouette (mirrored for variety). Both are now gated
  to daytime/dusk only — no butterflies or birds at night (fireflies own the
  night); the birds already were, the butterflies now match. Drawn as `<image>`
  in the base SVG, so the postcard export inlines them automatically. New
  `critter()` helper in `render-svg.js`. (Clouds + scattered ground flowers
  left for a follow-up.) No core change, no schema bump.
- Postcard export overhaul (P0 set from an adversarial Codex 5.5 review),
  turning a buggy screenshot into a trustworthy keepsake (`postcard.js`).
  (1) Completeness — the export silently dropped the live cat (a CSS sprite-
  sheet `<span>`, not a `.pg6-sprite`) and every season particle; both are now
  drawn. The cat is rendered as a deterministic FIXED sit frame (sheet row 2
  col 4) at its on-screen rect, so the export is never a half-stride walk frame
  regardless of when Export is pressed; particles honor their live opacity.
  (2) Caption — the single bottom line that i18n could ellipsis-truncate is now
  a two-line block on a solid dark scrim: `<season> · <time of day>` then
  `<N> vines · <tokens> [· busiest: <name>]`, with a CJK font fallback and
  per-line ellipsis, legible over any scene (bright day, snow, night).
  (3) Preview — the panel renders a live `<canvas>` preview (re-rendered when
  the include-project-name toggle changes) so you confirm framing AND
  anonymization before saving instead of saving blind; Save reuses the preview
  canvas (no re-render). Privacy: the busiest-project label can no longer fall
  back to `project_key` (a local path) — it uses `display_name` (a basename)
  only. No core change, no schema bump.
- Follow-up courtyard de-clutter from a second layout pass (`render-garden.js`).
  (1) Bamboo vs cherry: the grove [0.6,17.5] overlapped the cherry [10.1,25.9]
  by 7.4% (the mid cluster shoved into the cherry's left canopy). Pulled the
  grove into the left corner and narrowed it ([0,~12]) and stepped the cherry
  x=18→21 — now 0% overlap, cherry still clearing the stone cat. (2) Stone cairn:
  shrank + nudged it (x=72→70, full 38→30 / small 30→26) so it stops crowding
  the pavilion's front-left column and reads as a slim pagoda in the narrow
  willow–pavilion gap instead of jammed against the post. All overlaps
  re-measured to 0%. No core change, no schema bump.
- Fixed two courtyard placement regressions caught in a live layout check
  (`render-garden.js`). The mature willow had been moved to x=60 to clear the
  cherry, which parked it directly on top of the stone lantern (also x=60) —
  the lantern sat ENTIRELY inside the willow's canopy ([57.7,62.3] within
  [52.3,67.7]), hidden under the drooping branches. Moved the lantern into the
  empty ~14%-wide bay between the stone cat and the willow (x=45), now 0%
  overlap with ~5% clearance each side, lighting the path edge. Separately the
  stone cairn (x=78) stood INSIDE the pavilion footprint, planted on the floor
  beside the tea table like indoor furniture; moved it to the pavilion's
  front-left corner (x=72, clear of the willow) and downsized slightly
  (full 42→38 / small 32→30) so it reads as a courtyard pagoda at the eave
  corner, not a tea-room ornament. Verified live via measured bounding rects.
  No core change, no schema bump.
- Regenerated the courtyard's static decor — stone lantern (lit + unlit
  states), stone cairn (small + full tiers), bamboo grove (3 cluster
  variants) — via PixelLab `create_map_object` + `create_object_state`,
  matching the same warm-stone / vibrant-bamboo palette established by the
  trinket pass earlier. 7 generations total. PixelLab cloud now holds the
  ginger character + 1 lantern + 1 cairn + 1 bamboo grouped object set with
  their state variants.

  Same processing pipeline as before (tight crop to alpha bbox + 2 px,
  flood-fill stray-cluster scrub ≤6 px). All sprites came back ≤3 strays —
  one tiny anti-alias residue on lantern_lit from the glowing-window edit,
  zero on the rest. Aspect-ratio drift relative to the old Codex sprites:
  bamboo ±10%, cairn -22 to -28%, lantern -27%. Render-height % at the
  current configured widths goes up 10-44% — visible but not enough to
  blow out the scene at any tier (verified by working through the
  scene-pct math against the existing `width: <n>` calls).

- Fixed three real layout overlaps surfaced by a layout-audit workflow
  (2-dimension audit ⨯ per-finding skeptic verification; the verifier
  caught the auditor proposing fixes that didn't actually clear the
  problem, then computed the correct numbers itself):
  * Mature willow used to engulf the cherry tree at every recent-activity
    tier — bbox overlap ~59% of cherry-petal at peak. Moved cherry x
    23→18, willow x 48→60, capped mature willow width 125→105 (young
    95→88), so the two anchor trees now sit on opposite sides of the
    courtyard with clear breathing room.
  * Full stone_cat overlapped stone_lantern by ~60% of the lantern's
    footprint. Capped stone_cat full width 58→50; moved cairn x 68→78 to
    let the lantern read as a standalone landmark again.
  * The pavilion sprite was rendered at hardcoded x=82.5 / y=90.5 while
    `scene-config.js` pavilionAnchor was {cx_pct:81, bottom_pct:91} — so
    the pavilion-interior trinket math (which read from CONFIG) was 1.5
    scene-% off from the visible pavilion. Render-garden now reads from
    CONFIG, single source of truth. Three sleeping_cat overlap findings
    were rejected after verification: that trinket is supplanted at
    runtime by the live garden_cat (`skipSleepingCat` path in
    addPavilionTrinkets), so its config slot is never drawn.

- Regenerated all 5 pavilion trinket sprites via PixelLab (`create_map_object`,
  ~5 generations on the trial subscription). Each was authored in PixelLab's
  warm-wood palette to harmonize with the ginger calico cat that landed
  earlier this cycle — they now read as one cohesive courtyard set instead of
  the Codex-image-gen mixed bag they used to be. The trinkets:
    * `scroll` — hanging scroll with red-pavilion landscape painting, wooden
      end-rollers (63×122, side view)
    * `tea_set` — clay teapot + two cups on a wooden tray (84×55, high
      top-down)
    * `wind_chime` — pavilion-eave roof bar + 3 brass tubular chimes + clapper
      (46×107, side; first attempt came back too tall/thin — re-rolled with a
      "compact, NOT tall" brief to match the old 0.42 aspect ratio so the
      sheet doesn't blow out the pavilion's interior height budget at render
      time)
    * `incense` — bronze three-legged Chinese censer with a wisp of smoke
      (74×82, high top-down)
    * `sleeping_cat` — curled-loaf ginger calico (85×53, side) — color-matched
      to the main `garden_cat` so the unlock at 5e8 tokens reads as "the
      same cat decided to nap inside"
  All sprites tight-cropped to alpha bbox + 2px breathing room, run through
  the flood-fill stray-cluster scrubber (≤6px isolated islands → erased) —
  every sheet came back 0 strays, since the `create_map_object` pipeline is
  cleaner than the character-animation export that needed three scrub rounds
  for the cat. Aspect-ratio drift kept within ±25% on every sprite (incense
  -1%, tea_set +5%, scroll -13%, sleeping_cat +24%, wind_chime +2% after the
  re-roll) — `addTrinketSprite` sets only width and lets `<img>` auto-compute
  height, so out-of-range aspect changes would have warped the pavilion
  layout. Manifest `w` / `h` updated; PixelLab cloud now holds just the
  ginger character and the 6 trinket objects.

- Expanded the courtyard cat's rest behavior into three distinct postures
  matching rest length, generated from two more PixelLab template animations
  (1 generation each, south-only, on the existing ginger character). The rest
  state used to be one station: stand & look (col 4↔5 toggle). Now
  `beginRest()` picks one of:
    * 55% short alert pause (col 4-5, 0.8-2.2s) — heard something mid-yard
    * 20% alert held still (col 4-5, single frame, 1.3-2.9s)
    * 12% true sit (col 6-7, 2.5-5s) — `sitting` template, paws tucked under
    * 8% lie on belly (col 8-9, 4.5-9s) — `seated-on-belly-idle`, longer rest
    * 5% immediate next hop (no perceptible rest)
  Frame toggle interval scales with the rest's calmness — lie at 1.4-2.6s
  (breath-like), alert at 0.9-2.0s (quicker flick). Whole pacing slowed ~20%
  per user request: STRIDE 2.4→2.0, baseSpeed range 7.5-12.5→6.0-10.0,
  turnDur 260-340→360-480, hesitate 120-300→160-380, rest durations
  +30-40%. Row-2 cells 6-9 of the sheet were previously empty — now fully
  populated. Reduced-motion CSS keyframe (col 4↔5) untouched: already
  aligned with the new alert kind.

  Three rounds of pixel scrubbing along the way: PixelLab's image-gen export
  leaves stray fragments (anti-alias residue, etc) beyond the cat's body.
  The final scrub generalized to a flood-fill connected-component
  algorithm — any cluster ≤6 pixels in a sheet whose smallest legitimate
  body is 374 px is by definition an orphan, regardless of color or shape.
  That cleaned the last two-pixel cluster the user spotted in front of
  west walk frame 3 and is robust to any future PixelLab artifact shape.

- Replaced the courtyard cat sprite with a ginger-and-white calico (黄三花)
  Chinese-domestic cat generated via the PixelLab MCP (character
  `cdd47da3-d0d6-4798-a7c1-9d92bd73ae97`, side view, quadruped/cat template).
  The win: PixelLab produces genuine per-direction art, so we now have a real
  **east (walk-right)** and **west (walk-left)** 8-frame walk cycle instead of
  faking the turn with `scaleX(-1)` (the old "paper cat" flip). Repacked the
  PixelLab frames into the existing 10×3 sheet layout
  (`garden_cat/garden_cat.png`, now 680×204 with 68×68 cells) so the
  adversarially-tuned wander state machine in `render-garden.js` needs ZERO
  logic changes — `catFrameBg` uses relative background-position percentages,
  which are cell-size-agnostic. Row 0 = walk-right, row 1 = walk-left, row 2
  cols 0-3 = turn (a gentle SE→S→S→SW "glance toward camera" transition), cols
  4-5 = idle (front-facing "paused and watching"). Only CSS changed: the
  cat element's `aspect-ratio` 10/7 → 1/1 to match the square cell, and
  `CAT_W_FRAC` nudged 58→64/680 to keep the displayed body size. Manifest
  updated to the new frame geometry.

- Hardened the flowerbed view after a 4-dimension adversarial review (Claude
  reviewers ⨯ per-finding skeptic verification; 10 confirmed of 14, 4 rejected
  as false alarms). Fixes: (1) the build script shipped a 1.4 MB image-gen
  source PNG, the unused master spritesheet, and the `_brief/` authoring notes
  into every user's Tauri bundle — `build.rs` now skips `_source*` files,
  `flowers.png`, and any `_`-prefixed sprite subdir, so the mirror carries only
  the 20 runtime sliced flowers; (2) flowers ignored an OS `prefers-reduced-
  motion` preference under the default `motion: system` — added `.pg6-flower`
  to the global reduced-motion media query; (3) 366 flowers were each a
  keyboard tab stop, flooding navigation — flowers are no longer focusable (the
  flowerbed is an at-a-glance overview; its data is keyboard-reachable via the
  Dashboard heatmap); (4) with `auto_rescan` off, the mini-heatmap / dashboard
  refreshed on watcher ticks while the cached scene (and flowers) did not, so
  the two year-views diverged — all views now pause together. Also corrected
  two stale schema-version references (CLAUDE.md, cherry-petal spec said v4;
  actual is v6) and tightened the `flowerbed_level` docstring (it shares the
  log-ratio *formula* with `size_level` but uses a different baseline + band
  count). Earlier in the cycle, two promotion-gap bugs were also fixed: the
  settings normalizer dropped the `flowerbed` field on the desktop round-trip
  (so the toggle never took effect outside browser preview), and re-renders
  re-appended flowers without clearing the old set (stacking + DOM leak).

- Added a flowerbed contribution view (opt-in). When `appearance.flowerbed =
  enabled` (or URL `?flowerbed=enabled` for ad-hoc preview), the garden's
  ground band swaps the grass strips for a tilled dirt bed and 366 generated
  flower sprites bloom along the foreground — each one a day in the rolling
  year, with bloom intensity following `daily_activity`. Originally an
  isolated PoC branch grown with Codex 5.5 (image-gen produced the 5×4
  rose/daisy/tulip/wildflower spritesheet, then PIL chroma-keyed it to
  transparency); now promoted to main as a second visualization that
  coexists with the Dashboard heatmap (which renders honest tokens) — the
  flowerbed favors intensity-bursts-as-bloom so tool-heavy / low-token days
  still get visible flowers. Default is `disabled` so existing users see no
  change on upgrade. Bumped `SUMMARY_SCHEMA_VERSION` 5 → 6 to add
  `flowerbed_year: Vec<FlowerbedDay>` to `GardenSummary` alongside the
  existing `heatmap_year` and `hour_of_week`. Also reduced the bottom
  vignette (`.pg6-frame::after`) from 122px×0.9α → 84px×0.65α — it was wide
  and dark enough to swallow the bottom-most foreground at any view.
- Added activity Dashboard: GitHub-style year heatmap (365 days, self-relative
  5-band color scale) + hour-of-week punchcard (7×24 grid over the last 90
  days) + 6 KPI cards (total tokens, active projects, active days, this week
  vs last week, best day, longest streak). New `Dashboard` button sits next to
  Insight / Postcard / Settings in the footer. Bumped `SUMMARY_SCHEMA_VERSION`
  4 → 5 to add `heatmap_year` and `hour_of_week` to `GardenSummary` — both
  computed in `core/aggregate.rs` so the CLI's `export-web` ships with the
  same fields the desktop app uses.
- Added a mini-heatmap strip between the header and the scene: a 53-week
  wood-eave plaque that gives ambient awareness of the year-of-activity and
  opens the full Dashboard panel on click. Pure CSS gradient framing so it
  reads as part of the courtyard frame rather than a separate widget.
- Repixelated the courtyard wall and path so they read as deliberate, hand-
  crafted pixel art instead of smooth fills. New `web/scene-tiles.js` builds
  seamless pixel-art tiles rendered as SVG `<pattern>`s (drawn once, tiled by
  the renderer — efficient): a running-bond sandstone brick tile and a cool-gray
  flagstone tile, both on a tight palette ramp with NO blended in-between colors,
  dithered shading transitions, chunky 2-unit pixels, and crisp dark mortar
  joints. The warm-sandstone palette came out of a pixel-art design pass with
  Codex 5.5 (asked to *draw* the tiles — it reliably picked the ramp but couldn't
  hand-place a seam-continuous grid, so the grids are generated in code). The
  wall tile is tiled across the band with a sparse RANDOM weathering overlay
  (damp/sun-worn patches, moss, hairline cracks) on top so the ~160-unit repeat
  reads as one continuous aged wall rather than a stamp. The lawn's hard band
  stripes are dithered at the seams and the flat 2px specks are replaced by
  upright varied-shade grass blades. The faint 0.62-opacity `path_stones` sprite
  is gone (its placement removed in `render-garden.js`); the path is now the
  flagstone pattern tiled along a floor strip, with transparent gaps so the lawn
  shows between stones and sprites drawing over it so it recedes behind the
  willow/lantern. No new binary assets, no core change, no schema bump.
- Rebuilt the garden cat's roaming so it actually strolls the courtyard like a
  cat. The old wander was a fixed CSS keyframe — a ±116px sweep pinned to the
  right side that, being absolute pixels, shrank to a twitch on large displays
  and traced the same mechanical right→turn→left loop forever. It's now a JS
  state machine (`startCatWander` in `render-garden.js`) over `requestAnimation-
  Frame`, with a behavior model designed in an adversarial pass with Codex 5.5:
  destinations are weighted habit-zones + short heading-preserving patrols (not
  uniform-random across a rectangle — that "drone cutting across the yard" look
  was the biggest tell); each leg has subtle accel/decel zones (never easing to
  zero, so no moonwalk) while the walk-frame cadence stays distance-driven so
  feet never slide; a turn + brief hesitation precedes walking (anticipation
  reads as life); arrival plants a frame before sitting; and the rest menu is
  mostly short beats with rare long sits and "alert" stillness (animals aren't
  animated 100% of the time). The roam box is scene-relative (~30–72% of width,
  >2.5× the old span, scales with the window) with a subtle near/far scale.
  **No more teleporting:** the cat element is now long-lived across re-renders
  (removed from the dynamic-layer clear list) so a watcher tick no longer tears
  it down and respawns it at home mid-stroll; it's only rebuilt when it
  (un)locks or its motion-kind changes, and even then it resumes from its last
  position. Motion modes honored (full runs the loop; `reduced` keeps the CSS
  sit-blink; `off`/`prefers-reduced-motion` sit on one frame); rAF naturally
  pauses when the window is hidden and the dt clamp prevents a resume jump.
  Dropped the now-dead `pg6-cat-wander` / `pg6-cat-frames` keyframes. No core
  change, no schema bump.
- Re-tuned the pavilion trinket display and a courtyard ground-prop after an
  adversarial layout review (Claude visual+measured-rects ⨯ Codex 5.5 ⨯ a
  4-agent geometry workflow). Real bugs found and fixed: the incense burner sat
  ON the seat cushion at every pavilion tier; the hanging scroll dropped onto
  the cushion in the shorter small/mid interiors (the small tier shows ONLY the
  scroll, so this was the most-seen case); tea_set collided with the stool at
  the mid tier; and sleeping_cat sat on the stool at full unlock. Re-slotted all
  six trinkets in `scene-config.js` so the seat (interior center) stays clear —
  scroll high on the rear wall, wind-chime on the eave, tea_set + incense on the
  left floor, lucky_cat + sleeping_cat on the right — verified collision-free
  against the stool/cushion and pairwise across small/mid/full and 1-6 unlocks.
  Bumped trinket sizes ~1.35× (a larger bump was rejected — it re-introduced
  overlaps) so they're legible at 1× instead of 7-17px dust. Also fixed
  `path_stones`, whose `z=26` contradicted its own "should recede" comment by
  drawing the worn path in front of the pavilion/lantern/cairn, and whose
  `y=95.4` sank it ~4pp below the ground line — now `z=12` and `y=91.0`. Reworded
  the tea_set/incense i18n hints from "table" to "floor" (there is no table
  sprite; a new one was judged too expensive) and softened the now-proportionate
  trinket hover outline (2px→1.5px + glow). No core change, no schema bump.

- Added a project search box + "show all" toggle to the Insight panel so all
  20-37 projects are reachable, not just the top 10. The panel now renders every
  project into the DOM (rows past the top-N get an `is-extra` cap hidden by CSS);
  a live search filters by name / path / source / model across the full set —
  so a project ranked #23 surfaces the moment you type it — and a "show all (N
  more)" / "show top N" toggle lifts the cap. Pure client-side show/hide (the
  search keeps focus across watcher re-renders), reuses the existing
  row→vine-highlight wiring, all strings via i18n. No core change, no schema
  bump. Direction picked from a Codex 5.5 + multi-agent analysis pass; the wall
  stays intentionally token-ordered (no sort modes).
- Routed the project card's detail rows through i18n: the enriched card's labels
  (today / cache hit / activity / top model / sources / last active) and the
  relative "last active" string were hardcoded Chinese after the i18n layer
  landed, so an English-locale user saw Chinese on every card. They now use t()
  keys (relative time reuses the footer `fresh.*` keys); the "manual" source
  label is localized too.
- Enriched the project hover card into a mini profile: it now shows today's
  tokens, cache-hit %, sessions + tool calls, the dominant model, the
  source split (when more than one tool contributed), and a "last active N ago"
  line — all from fields `aggregate.rs` already computed but the card never
  surfaced. Each line omits itself when its value is zero, so sparse projects
  keep a clean card. Frontend-only, no schema change.
- Fixed `motion = "off"` hiding the entire garden: the setting's CSS rule was
  `display: none` on `.pg6-sprite` and `.pg6-info`, so choosing "no motion"
  blanked every vine, courtyard object, and the info card, leaving only the
  static wall. motion=off now stops animation/transition and removes only the
  ambient season particles; all content stays visible.
- Added source-fingerprint cache invalidation: the desktop app now refreshes the
  cached garden on startup when agent logs changed while it was closed, instead
  of showing stale data until the next watcher tick or manual scan. Freshness is
  decided metadata-only — total bytes, newest mtime, and file count across every
  adapter watch path — and the `events.json` envelope stores an optional
  `fingerprint` field so legacy caches refresh once.
- Cleaned up spec/onboarding drift after the public-launch feature batch:
  completed specs now say implemented, Postcard save-path questions are marked
  resolved, the CSP/Postcard desktop verification remains explicit as the next
  release gate, and sprite-rendering notes no longer claim project age currently
  drives vine length.
- Refreshed the README for public release: replaced the hero screenshot with the
  current full-window garden UI and updated both English and Chinese copy to
  cover locale-aware UI, Insight, Garden Postcard, return diff, and the local
  privacy boundary.
- Added a "While you were away" garden diff, a localStorage-backed frontend
  snapshot that shows a small return summary only when projects grew since the
  last viewed garden. It reuses `GardenSummary` and stays web-only: no schema
  change, no new permissions, no network, and no source-directory writes.
- Added Garden Postcard — a one-click, zero-network export of the current scene to
  a local PNG, the first way the garden can leave its window (the only privacy-safe
  growth channel a local-first app has). A new `web/postcard.js` rasterizes the base
  SVG (inlining the mountain sprite hrefs so they aren't blank), composites the DOM
  sprites onto a 2× canvas preserving each vine's CSS filter tint + opacity, draws
  the `.pg6-wall-edge-cover`, excludes transient particles, and adds a localized
  one-line caption (`season · N vines · tokens` + optional `busiest: …`). A footer
  button opens a small export panel whose anonymize default omits the busiest-project
  name (basenames leak directory paths). Saving uses a new `save_postcard` Tauri
  command (`tauri-plugin-dialog` save dialog + `std::fs::write`, `dialog:allow-save`
  only — no `tauri-plugin-fs`, no frontend fs permission) with a browser
  `<a download>` fallback; the save is user-initiated to a user-chosen path,
  consistent with the privacy contract, and the caption/labels go through the i18n
  layer. Spec + Claude↔codex review: `docs/18-garden-postcard-spec.md`. (Frontend
  raster verified in-browser; the Rust save command is compile-checked in CI; the
  native save dialog + the locked CSP still want one desktop `cargo tauri dev` pass
  before the next release.)
- Added a lightweight frontend i18n layer for the desktop garden UI. The web
  surface now defaults to English for non-Chinese systems, keeps Chinese for
  Chinese locales, and supports `?lang=en` / `?lang=zh` for release-check
  previews without adding a framework or touching core data contracts.
- Updated CI / release checkout steps to `actions/checkout@v6`, clearing the
  Node.js 20 deprecation warning before GitHub Actions moves JavaScript actions
  to Node 24 by default.
- Prepared the remaining public-launch release path: first-run empty state now
  stays user-facing and Chinese-only instead of showing a ghost
  `agent-garden scan` command, watcher startup/watch/notify failures emit
  `garden:error` to the desktop toast pipeline, `release.yml` now publishes real
  GitHub Releases instead of drafts, unsigned install notes live in
  `docs/unsigned-installs.md`, and the release workflow has guarded macOS /
  Windows signing hooks that activate only when the required secrets exist.
- Hardened and documented the zero-network guarantee for a public, unsigned launch.
  Added a `LICENSE` (MIT, matching `Cargo.toml`) and a `PRIVACY.md` with a "verify
  it yourself" recipe (watch egress with lsof / Little Snitch / TCPView → zero
  connections). Replaced `tauri.conf.json`'s `csp: null` with a locked policy
  (`default-src 'self'` … `connect-src 'self' ipc: http://ipc.localhost`) so the
  webview is runtime-prevented from reaching any external host while still allowing
  same-origin assets + Tauri IPC. Added a CI "zero-network gate" (`deny.toml` +
  `cargo deny check advisories bans sources` + a `Cargo.lock` scan) that fails if a
  new egress/telemetry crate is introduced — `reqwest`/`hyper`/`tokio` are baseline
  Tauri deps and intentionally not banned, so the honest proof stays runtime + CSP
  with the gate as defense-in-depth. The cargo-deny unmaintained-advisory check is
  scoped to direct workspace dependencies so Tauri's transitive gtk-rs GTK3 Linux
  baseline does not drown out the privacy gate; the `time` RFC2822 parser advisory is
  temporarily ignored with a reason because the patched release raises MSRV beyond
  the workspace's Rust 1.85 contract and the app does not directly parse untrusted
  RFC2822 input with `time`. Spec + Claude↔codex review:
  `docs/17-launch-trust-hardening-spec.md`.

## v0.1.2 - 2026-06-06

- Added focused core test coverage for scan-level dedupe and the manual JSONL
  adapter. The new tests lock down UUID dedupe scoping, fallback row keys,
  chronological ordering, manual import field mapping, bad-row skipping,
  `raw_ref` line numbers, token normalization, and watch-path behavior.
- feat: Per-project `recent_activity` now spawns deterministic fresh
  `leaf_cluster` accents near each primary vine crown; see
  `docs/15-recent-activity-leaves-and-vine-age-spec.md`.
- Slimmed the shipped Tauri asset mirror by excluding dev-only sprite atlases and
  the preview HTML, pruned orphan courtyard rock/tuft sprites, placed stranded
  stone/plaster frames, and fixed the sprite preview for `w`/`h`-only entries
  (about 12 MB less bundle payload).
- Made the vine wall reflect per-project activity, wiring three render contracts
  that had their data in the summary but no consumer. (1) **Session count → strands:**
  `addIvyOverlay` rendered exactly one vine per project regardless of `sessions`;
  now each project grows `clamp(1+floor(log2(sessions)),1,cap)` strands — one
  primary interactive vine plus dimmer/narrower decorative strands — so a busy
  project visibly fans out while 1-session projects are unchanged. Only the primary
  strand is keyboard/hover/chip-interactive (decorative strands are
  `pointer-events:none` and stay out of the roving-vine model), and the cornice
  anchors off the primary only. (2) **All 8 vine frames reachable:** frame choice
  moved from `pickByToken` (which could only ever hit 3–5 of the 8 hand-authored
  hanging/vertical frames) to `pick(group, projectIndex+strandIndex)`; size stays
  token-driven. (3) **cache_ratio → health tint:** projects with `cache_ratio > 0`
  get a gentle saturation/brightness lift via new `--vine-health-*` CSS multipliers
  (default 1, threaded through the resting/hover/active/focus filters and the
  `pg6-vine-sway` keyframes so the animation can't clobber it); `cache_ratio == 0`
  stays neutral, since in practice `0.0` means "source reported no cache fields"
  rather than a cold cache. Pure frontend + deterministic (jitter/pick, no RNG); no
  core or schema change. Spec + Claude↔codex review log:
  `docs/13-garden-reflects-activity-spec.md`.
- Realized the cherry-blossom peak tier and activity-driven flower accents — two
  rendering contracts that had their data plumbed through core but no consuming
  render path. `unlockTier` already derived three cherry states from summed
  `recent_activity` (bud → bloom → petal ≥ 100k) and `addSpringPetals` already
  treated `petal` as the hotter state, but `addCourtyardObjects` only branched
  bud-vs-bloom, so the peak tier rendered identically to bloom. Added a derived
  `cherry_tree_petal` sprite (a fuller, more-saturated bloom at the same 313×315
  footprint) and a 3-way sprite/width branch with an explicit
  petal→bloom→`pickByToken` fallback chain so older asset sets still render.
  Separately, the four shipped-but-orphaned `flower_cluster` sprites are now
  placed as small accents at the cherry base, count scaled by the cherry tier
  (bud 0 / bloom 2 / petal 4), spring/summer only, deterministic (jitter, no
  RNG), and `pointer-events:none` so they never block vine/cat hover. Pure
  frontend + asset change — no core or schema touch. Spec + Claude↔codex review
  log: `docs/12-cherry-petal-and-flower-accents-spec.md`.

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
  Directory names like `D--code-demo-app` now decode to `D:\code\demo-app`; when a
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
  merges genuinely distinct directories (two real dirs named `demo-service`
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
