# Changelog

## Unreleased

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
