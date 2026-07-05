# 2.5D Isometric Courtyard Plan

Status: Experimental 2.5D renderer landed on `codex/isometric-courtyard`.

## Intent

Move Pixel Agent Garden from a wall-first courtyard into a clearer 2.5D garden
space without losing the product's core: local agent activity becomes visible,
legible growth. The wall remains the project-history surface; the ground plane
becomes the long-lived courtyard for unlocked objects, daily activity, and
ambient life.

This is a renderer evolution, not a data-model rewrite. The first isometric
version must consume the existing `GardenSummary`.

## Reviewer Consensus

Codex and Claude Code both agreed on the same first cut:

- Do not keep adding 2.5D logic directly to `web/render-garden.js`.
- Add a renderer boundary before introducing a second visual implementation.
- Keep the existing wall renderer visually unchanged as `classic`.
- Use an experimental `isometric` renderer behind a URL flag until it is real.
- Do not change Rust schema for the first 2.5D version.

## Renderer Boundary

The frontend entry point should treat the scene renderer as replaceable:

```js
{
  paint(groups, summary, settings),
  repaintData(groups, summary),
  renderBase(settings),
  renderDynamic(groups, summary),
  showScanning(),
  showCached(summary),
  selectProjectByKey(projectKey),
  destroy()
}
```

`garden.js` owns data loading, settings, panels, watcher subscriptions, and
renderer selection. Renderers own scene drawing.

## Phase 0: Renderer Boundary

Files:

- `web/renderers/classic-wall-renderer.js`
- `web/renderers/isometric-renderer.js`
- `web/renderers/isometric-base.js`
- `web/renderers/renderer-factory.js`

Behavior:

- Default renderer is `classic`.
- `?renderer=isometric` selects the experimental 2.5D renderer.
- Unknown renderer values fall back to classic.
- Tauri desktop sessions default to `isometric` on this branch because the
  packaged `frontendDist` window cannot receive the browser query string.
- A footer `2.5D` / `Wall` toggle hot-swaps renderers and persists the choice in
  localStorage.
- Existing dynamic renderer gets a `destroy()` hook so future renderer switches
  can stop the long-lived cat animation loop and clear sprite layers.
- `render-svg.js` marks the default renderer with `data-renderer="classic"`;
  `isometric-base.js` marks the experimental renderer with
  `data-renderer="isometric"` so CSS and smoke tests can target each mode.

## Phase 1: Isometric MVP

The first real isometric renderer now includes:

- folded back wall carrying every project vine
- wall planes derived from the floor rear edges plus one wall-height offset, so
  wall tops remain parallel to wall bases
- density-adaptive wall vines so large project vines stay hoverable while all
  projects remain visible
- 2.5D ground plane with depth-seated sprites
- PixelLab isometric courtyard assets for pavilion, stone cat, willow, cherry,
  bamboo hedge, koi pond, and stone lantern
- stepping stones, with side-view-only classic objects intentionally withheld
  from the isometric renderer until matching isometric variants exist
- existing HUD, footer buttons, Insight, Dashboard, Settings, and Postcard
- project hover/focus card
- roving keyboard navigation and `selectProjectByKey` support from Insight rows

## Phase 2: Extract Shared Contracts

Move reusable logic out of the classic renderer:

- `depthToScreen` and scene constants -> `web/scene-geometry.js`
- shared sprite layer operations -> `web/render-layer-utils.js`
- visual data mapping (`unlockTier`, `tokenSizeProfile`, `vineHueShift`) ->
  `web/garden-visual-model.js`
- info-card model/content helpers -> shared card module

Keep each extraction behavior-preserving.

No Rust schema change is required.

## Data Semantics

Hard semantic bindings:

| Data | Visual |
| --- | --- |
| `projects` | wall vines |
| project `total_tokens`, `size_level`, `size_strength` | vine mass |
| project `sources` | vine hue |
| project `cache_ratio` | vine health tint |
| project `recent_activity` | fresh leaves / project vitality |
| total tokens | pavilion/trinket unlocks, HUD total |
| sessions | stone cat / cairn growth |
| today's activity | lantern lit state |
| `daily_tokens` / `heatmap_year` | Dashboard and heatmap views |

Environment-only elements should stay quiet: sky, mountains, brick weathering,
basic grass texture, fish, stepping stones, and non-interactive atmospheric
particles.

## Risks

- Depth sorting and z-index hand tuning can spiral. The isometric renderer needs
  one depth-sorting rule, not scattered magic z values.
- Data meaning can get diluted if every decorative element appears to encode a
  metric.
- Mixed projection assets can clash. Manifest metadata will eventually need
  projection/anchor/depth-origin fields for true isometric assets.

## Asset Direction

The 2.5D renderer should prefer object sprites generated or authored for the
same low top-down / isometric projection. Side-view sprites from the classic
wall renderer are not a safe fallback for large props; if a matching isometric
asset is missing, the 2.5D scene should either omit that prop or use a small
neutral placeholder until a proper asset exists.

Current generated asset folder:

```text
assets/sprites/isometric_generated/
```

These are build-time assets. Runtime scan/render paths still read only local
agent data and local files.

## Style Harmonization (v2 sprite set)

User review of the first isometric cut: the frame mixed three visual
languages — chunky 64px voxel objects upscaled 1.6-2.5x at render time,
the painterly shared backdrop/vines, and a flat procedural room — plus
per-object defects (koi ~40% of pond width; the lantern's lit windows baked
into its only sprite, so it glowed at 8am; inconsistent baked-in plinths;
a white toy cat carrying the "stone cat" stat).

Resolution, in the detailed painterly language of the classic wall view /
original design mockup:

- **Assets** (`*_iso_v2_*.png`): full regeneration. Rules: native resolution
  ≥ 2× render width (nothing upscales); no baked base plates — objects seat
  via contact shadows; tiered objects ship one file PER TIER (pavilion
  small/mid/full, stone cat small/full, willow young/mature, cherry
  bud/bloom/petal, lantern lit/unlit) so growth reads in the art itself.
- **Prompt anchor** (PixelLab `create_map_object`, view "low top-down"):
  "detailed pixel art, isometric three-quarter view, muted earthy palette,
  soft dithered shading, subtle dark outline" + "isolated object on
  transparent background". Some generations still return an opaque uniform
  backdrop; those are keyed by a border flood-fill (removes only the region
  connected to the border, preserving interior same-color pixels).
- **isometric-renderer.js**: `ISO_ASSETS` became tier→file maps; the lantern
  picks lit/unlit from the existing `lit` bool; the willow moved out of the
  pavilion's occlusion; contact shadows slightly heavier (0.32) for trees /
  buildings / statue.
- **isometric-base.js**: the floor's u/v debug grid gave way to mottled
  patches + grass tufts; the walls render coursed masonry (running-bond
  joints + cap ticks) over the time-shaded gradients; the fence posts gained
  two rails; ripple rings + sparkles seat the island in the water; the 16
  static mid-air petals were removed (an animated spring layer can return as
  a DOM pass later); night/dusk paints a lantern light-pool mirroring the
  DOM lantern sprite seat (0.80, 0.61). The sky orb is now sprite-driven by
  local time + a deterministic date hash: a softened base sun, back-cloud sun,
  cloudy sun, overcast sun, haze sun, and sunset glow variant. This is
  atmosphere only: it does not call a weather API or encode usage data.
- **Water frame**: four-corner dressing uses the same near/far hierarchy as the
  tray. Far lotus/stones are smaller and lower-opacity; near reeds/lotus carry
  the foreground weight; secondary moss, reeds, and lotus clusters break the
  one-object-per-corner rhythm so the sand-table edge no longer feels pasted
  onto empty water.

- **Open-water fill** (`renderWaterLife` in isometric-base.js): the frame
  corners around the island were flat gradient and read as a void. Near-field
  islets (`water_islet_iso_v2_pine/rocks.png`), drifting lotus pads
  (`water_lotus_iso_v2.png`), procedural koi silhouettes with ripple rings,
  and low waterbirds now layer the water — near-field > island > horizon
  islands gives three depth planes. Water decor dims at night; koi and birds
  are daytime/dusk only. A dark contact band hugs the slab waterline so the
  island presses into the water.

- **Life pass**: project vines fuse with the masonry (slots pulled onto the
  wall faces, crests anchored below the cap rim, a contact drop-shadow cast on
  the wall); the pond moved out of the cherry/bamboo cluster to the open
  front-left and swapped to a koi-less `koi_pond_iso_v2_calm.png` — its two
  koi are LIVE (`koi_iso_v2.png`); and the classic view's 500M-token garden
  cat now wanders the iso floor too (`addIsoGardenCat`: same
  spritesheet/unlock; long-lived element, torn down by the renderer's
  `destroy()`). The stone-cat statue remains — it is the sessions-tier data
  object; the live cat is the resident.
- **Believable motion**: the koi now follow two explicit current lanes. Each
  fish starts near one end of the pond, swims upstream toward the opposite end,
  pauses near the top water, then drifts back with the current before repeating.
  The visible fish head is rotated from the same sampled lane tangent that moves
  the sprite, so the body never reads as a sticker sliding sideways. This
  replaces both the old CSS orbit and the target-attraction feel that made fish
  look dragged through the water. The cat follows a few courtyard patrol routes
  instead of random points; limited-rate steering bends those routes around the
  pond / statue / pavilion / bamboo, with arrivals sometimes just standing and
  looking around instead of sitting. Both loops respect data-motion (off =
  resting, reduced = slowed) and stop with destroy(). Note: rAF pauses on hidden
  pages, so preview screenshots freeze mid-pose — motion is live in a foreground
  window. The koi use a regenerated 4-frame PixelLab swim cycle
  (`koi_iso_v3_f0..3.png`): the earlier bulky curved-tail fish was replaced
  with a slimmer koi and relaxed straight tail; upstream beats the tail faster,
  while the return leg slows the frame clock so it reads like being carried by
  water.
- **Corner dressing round 2**: an egret stands on the bottom-right rocks
  (`water_egret_iso_v2.png`), reed clumps flank both islets
  (`water_reeds_iso_v2.png`), and a moored rowboat drifts on the left water
  (`water_boat_iso_v2.png`).
- **Corner dressing round 3**: the four open-water corners gained smaller
  dedicated sprites so the 2.5D tray no longer floats in a flat gradient:
  far-left lotus (`water_corner_lotus_v1.png`), far-right moss stones
  (`water_corner_moss_stones_v1.png`), near-left reeds
  (`water_corner_reeds_v1.png`), and a near-right lotus echo. Far corners render
  smaller and quieter; near corners carry more detail.
- **Seasonal particles** (`addIsoSeasonParticles`): the classic view's four
  seasonal layers now run in 2.5D too — winter snow (18), autumn maple leaves
  (14), summer fireflies (dusk/night only), and spring petals shed from the
  ISO cherry's canopy. Same `.pg6-season-particle` / `.pg6-petal` CSS +
  manifest sprites as the wall view; particles carry `pg6-iso-dynamic` so
  repaints never stack them, and the whole layer respects data-motion /
  prefers-reduced-motion (off/reduced ⇒ none).
  Fall-distance fix: the shared keyframes' fixed 500/520/120px runs only
  reached mid-air at this scene's size, so leaves visibly dissolved halfway
  down and popped back in at the top. The keyframes now take
  `--particle-fall` / `--petal-fall` (old values as defaults ⇒ classic view
  unchanged); the iso renderer computes each particle's fall from the LIVE
  scene height so everything falls through the bottom edge (or, for petals,
  to the cherry's feet), with fade-out compressed into the last ~10% of the
  run and durations scaled up to keep the pace unhurried.

The v1 voxel sprites (`*_iso_01/02.png`) stay on disk until this pass is
accepted, then can be deleted.
